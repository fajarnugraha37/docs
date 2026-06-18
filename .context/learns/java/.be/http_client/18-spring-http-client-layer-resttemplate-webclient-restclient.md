# Part 18 — Spring HTTP Client Layer: RestTemplate, WebClient, RestClient

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `18-spring-http-client-layer-resttemplate-webclient-restclient.md`  
> Scope: Java 8–25, Spring Framework/Spring Boot ecosystem, production HTTP client engineering

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membedah HTTP client dari sisi engine yang relatif dekat dengan transport:

- JDK `java.net.http.HttpClient`
- OkHttp
- Retrofit
- Apache HttpClient 5

Part ini naik satu level ke **Spring HTTP client layer**.

Yang penting dipahami: Spring HTTP client bukan selalu transport engine. Sering kali Spring berada sebagai **abstraction layer** di atas engine lain.

Secara mental model:

```text
Application / Domain Service
        ↓
External API Client / Gateway / Adapter
        ↓
Spring HTTP abstraction
        ↓
Request factory / connector / exchange adapter
        ↓
Underlying HTTP engine
        ↓
DNS → TCP → TLS → HTTP exchange
```

Artinya, ketika memakai `RestTemplate`, `RestClient`, atau `WebClient`, kita tidak otomatis bebas dari masalah:

- timeout salah
- connection pool tidak dikontrol
- body leak
- retry storm
- blocking/reactive mismatch
- observability buruk
- error model kacau
- token refresh race
- sensitive header bocor di log
- overload downstream

Spring membantu menyederhanakan kode, tetapi tidak menghilangkan kebutuhan engineering.

---

## 1. Spring HTTP Client Landscape

Di Spring ecosystem, ada beberapa lapisan HTTP client utama:

```text
1. RestTemplate
   Classic synchronous/template-style HTTP client.

2. RestClient
   Modern synchronous/fluent HTTP client.

3. WebClient
   Reactive/non-blocking HTTP client.

4. HTTP Interface / HTTP Service Client
   Declarative Java interface client yang bisa memakai RestClient/WebClient sebagai adapter.

5. Lower-level request factory / connector
   Penghubung ke JDK, Apache HttpClient, Jetty, Reactor Netty, atau client lain.
```

Gambaran kasar:

```text
RestTemplate  → synchronous, older template API
RestClient    → synchronous, modern fluent API
WebClient     → reactive, non-blocking API
HTTP Interface→ declarative interface proxy
```

Namun pemilihan tidak boleh hanya berdasarkan “mana paling baru”. Pilihan harus ditentukan oleh:

- model concurrency aplikasi
- kebutuhan blocking vs reactive
- maturity codebase
- target Java version
- observability standard
- migration cost
- need for interface-driven client
- ability team memahami reactive chain
- underlying transport requirement

---

## 2. RestTemplate: Classic, Mature, Tapi Bukan Pilihan Ideal untuk Desain Baru

### 2.1 Apa itu RestTemplate?

`RestTemplate` adalah synchronous client dengan style template method. Ia menyediakan method seperti:

```java
getForObject(...)
postForObject(...)
exchange(...)
execute(...)
```

Mental model-nya:

```text
caller thread
   ↓
RestTemplate method
   ↓
HttpMessageConverter serialize body
   ↓
ClientHttpRequestFactory creates request
   ↓
underlying HTTP client executes blocking call
   ↓
HttpMessageConverter deserialize response
   ↓
returns object / throws exception
```

### 2.2 Kekuatan RestTemplate

RestTemplate masih berguna ketika:

- aplikasi legacy sudah banyak menggunakannya
- migrasi belum bernilai tinggi
- tim sudah punya wrapper yang stabil
- traffic tidak ekstrem
- synchronous model sudah cukup
- ada kebutuhan kompatibilitas Java 8 / Spring lama

### 2.3 Kelemahan RestTemplate

Masalah RestTemplate bukan berarti “tidak bisa production”. Masalahnya adalah API-nya cenderung membuat desain mudah menjadi tersebar dan sulit distandardisasi.

Contoh masalah:

```java
String result = restTemplate.getForObject(url, String.class);
```

Kode ini terlihat sederhana, tapi menyembunyikan banyak pertanyaan:

- timeout-nya berapa?
- connection pool dipakai atau tidak?
- error 404 dianggap exception atau domain result?
- response body error dibaca atau hilang?
- log redaction ada atau tidak?
- retry ada di mana?
- correlation ID dikirim atau tidak?
- circuit breaker membungkus call ini atau tidak?
- URL aman dari SSRF atau tidak?

### 2.4 RestTemplate Anti-Pattern

#### Anti-pattern 1 — Membuat RestTemplate baru per request

```java
public UserProfile getProfile(String userId) {
    RestTemplate rt = new RestTemplate();
    return rt.getForObject(baseUrl + "/users/" + userId, UserProfile.class);
}
```

Masalah:

- config tidak konsisten
- sulit observability
- request factory default bisa tidak sesuai production
- connection reuse/pooling tidak jelas
- sulit inject mock/test client

Lebih baik:

```java
@Configuration
class HttpClientConfig {

    @Bean
    RestTemplate partnerRestTemplate(RestTemplateBuilder builder) {
        return builder
            .connectTimeout(Duration.ofSeconds(2))
            .readTimeout(Duration.ofSeconds(3))
            .additionalInterceptors(new CorrelationIdInterceptor())
            .build();
    }
}
```

Tetap lebih baik lagi: jangan expose `RestTemplate` ke semua service layer. Bungkus dalam API client khusus.

```java
public interface PartnerProfileClient {
    PartnerProfileResult getProfile(PartnerUserId id);
}
```

### 2.5 Kapan RestTemplate Masih Layak?

RestTemplate layak jika:

```text
existing codebase besar
+ migration risk tinggi
+ wrapper sudah ada
+ config centralized
+ observability memadai
+ tidak ada kebutuhan reactive
```

RestTemplate tidak ideal jika:

```text
new codebase
or banyak client baru
or ingin fluent API modern
or ingin interface-driven client
or ingin migration path ke Spring terbaru
```

---

## 3. RestClient: Modern Synchronous Client

### 3.1 Apa itu RestClient?

`RestClient` adalah synchronous HTTP client modern di Spring dengan fluent API.

Mental model:

```text
caller thread
   ↓
RestClient fluent request
   ↓
message converter / request factory
   ↓
underlying HTTP engine
   ↓
blocking response
   ↓
retrieve / exchange handler
   ↓
returns body / domain result / exception
```

Contoh dasar:

```java
UserDto user = restClient.get()
    .uri("/users/{id}", id)
    .retrieve()
    .body(UserDto.class);
```

Dibanding `RestTemplate`, `RestClient` lebih mudah dibaca karena request dibangun sebagai pipeline:

```text
method → uri → headers/body → retrieve/exchange → decode
```

### 3.2 RestClient Bukan Engine Baru

Kesalahan umum: menganggap `RestClient` selalu memiliki engine sendiri.

Lebih tepat:

```text
RestClient = Spring synchronous fluent facade
RequestFactory = layer yang membuat/mengeksekusi request
Underlying engine = JDK / Apache / Jetty / lainnya
```

Jadi, production behavior tetap bergantung pada request factory dan engine yang dipakai.

### 3.3 `retrieve()` vs `exchange()`

Ada dua gaya pemakaian penting.

#### `retrieve()`

Cocok untuk simple happy path:

```java
UserDto user = restClient.get()
    .uri("/users/{id}", id)
    .retrieve()
    .body(UserDto.class);
```

Tapi untuk client production, sering kali kita butuh kontrol error yang lebih eksplisit.

#### `exchange()`

Cocok untuk custom response classification:

```java
PartnerResult<UserDto> result = restClient.get()
    .uri("/users/{id}", id)
    .exchange((request, response) -> {
        int status = response.getStatusCode().value();

        if (status == 200) {
            UserDto body = objectMapper.readValue(response.getBody(), UserDto.class);
            return PartnerResult.success(body);
        }

        if (status == 404) {
            return PartnerResult.notFound();
        }

        if (status == 429 || status >= 500) {
            String errorBody = readSafely(response.getBody());
            return PartnerResult.retryableFailure(status, errorBody);
        }

        String errorBody = readSafely(response.getBody());
        return PartnerResult.nonRetryableFailure(status, errorBody);
    });
```

Untuk top-tier client engineering, `exchange()` sering lebih cocok karena kita bisa membuat error taxonomy sendiri.

### 3.4 RestClient Builder Pattern

Client sebaiknya dibuat per downstream, bukan satu global untuk semua.

```java
@Configuration
class PartnerClientConfig {

    @Bean
    RestClient partnerRestClient(RestClient.Builder builder) {
        return builder
            .baseUrl("https://api.partner.example")
            .defaultHeader("Accept", "application/json")
            .requestInterceptor(new CorrelationIdClientHttpRequestInterceptor())
            .build();
    }
}
```

Namun perhatikan: `baseUrl`, header, interceptor belum cukup. Kita perlu mengontrol transport.

Contoh dengan Apache HttpClient-backed request factory:

```java
@Bean
RestClient partnerRestClient() {
    PoolingHttpClientConnectionManager cm = PoolingHttpClientConnectionManagerBuilder.create()
        .setMaxConnTotal(200)
        .setMaxConnPerRoute(50)
        .build();

    RequestConfig requestConfig = RequestConfig.custom()
        .setConnectionRequestTimeout(Timeout.ofMilliseconds(200))
        .setResponseTimeout(Timeout.ofSeconds(3))
        .build();

    CloseableHttpClient apache = HttpClients.custom()
        .setConnectionManager(cm)
        .setDefaultRequestConfig(requestConfig)
        .evictExpiredConnections()
        .evictIdleConnections(TimeValue.ofSeconds(30))
        .build();

    ClientHttpRequestFactory factory = new HttpComponentsClientHttpRequestFactory(apache);

    return RestClient.builder()
        .baseUrl("https://api.partner.example")
        .requestFactory(factory)
        .requestInterceptor(new CorrelationIdClientHttpRequestInterceptor())
        .build();
}
```

Intinya:

```text
RestClient API bagus,
tapi production behavior tetap harus dikunci di request factory / engine.
```

---

## 4. WebClient: Reactive HTTP Client

### 4.1 Apa itu WebClient?

`WebClient` adalah client reactive/non-blocking di Spring WebFlux.

Mental model:

```text
caller builds reactive pipeline
   ↓
request is not necessarily executed immediately
   ↓
subscription triggers execution
   ↓
non-blocking I/O event loop handles network
   ↓
response body becomes Mono/Flux
   ↓
operators transform/error-handle/retry/timeout
```

Contoh:

```java
Mono<UserDto> mono = webClient.get()
    .uri("/users/{id}", id)
    .retrieve()
    .bodyToMono(UserDto.class);
```

Request belum benar-benar berjalan sampai ada subscription:

```java
UserDto user = mono.block();
```

atau pipeline dipakai oleh reactive runtime.

### 4.2 WebClient Bukan Sekadar Async RestTemplate

Kesalahan umum: memakai WebClient seperti ini:

```java
UserDto user = webClient.get()
    .uri("/users/{id}", id)
    .retrieve()
    .bodyToMono(UserDto.class)
    .block();
```

Ini tidak selalu salah. Tetapi jika dipakai tanpa sadar, kita dapat mengambil kompleksitas reactive tanpa manfaat reactive.

Pertanyaan desain:

```text
Apakah aplikasi kita reactive end-to-end?
Apakah kita perlu non-blocking I/O?
Apakah tim paham backpressure, scheduler, subscription, cancellation?
Apakah kita memblokir event loop?
Apakah kita hanya ingin fluent synchronous client?
```

Jika jawabannya “hanya ingin fluent synchronous client”, `RestClient` sering lebih cocok.

### 4.3 Event Loop dan Blocking Hazard

Dalam reactive client, event loop harus cepat dan non-blocking.

Anti-pattern:

```java
webClient.get()
    .uri("/users/{id}", id)
    .retrieve()
    .bodyToMono(UserDto.class)
    .map(user -> blockingRepository.save(user)); // berbahaya jika blocking di event loop
```

Lebih aman:

```java
webClient.get()
    .uri("/users/{id}", id)
    .retrieve()
    .bodyToMono(UserDto.class)
    .publishOn(Schedulers.boundedElastic())
    .map(user -> blockingRepository.save(user));
```

Tetapi ini juga bukan magic. Jika terlalu banyak blocking task masuk ke bounded elastic scheduler, sistem tetap bisa overload.

### 4.4 WebClient Error Handling

Basic:

```java
Mono<UserDto> mono = webClient.get()
    .uri("/users/{id}", id)
    .retrieve()
    .onStatus(status -> status.value() == 404,
        response -> Mono.error(new UserNotFoundException()))
    .onStatus(status -> status.value() == 429 || status.is5xxServerError(),
        response -> response.bodyToMono(String.class)
            .map(body -> new RetryablePartnerException(body)))
    .bodyToMono(UserDto.class);
```

Untuk production client, lebih baik jangan membiarkan semua error menjadi exception mentah. Gunakan classification:

```text
transport failure
protocol failure
HTTP status failure
semantic domain failure
retryable failure
non-retryable failure
```

### 4.5 WebClient Timeout

Timeout bisa berada di beberapa layer:

```text
Reactor operator timeout
Reactor Netty response timeout
TCP connect timeout
TLS handshake timeout
read/write timeout
pool acquisition timeout
operation deadline
```

Anti-pattern:

```java
webClient.get()
    .uri("/slow")
    .retrieve()
    .bodyToMono(String.class)
    .timeout(Duration.ofSeconds(5));
```

Ini hanya membatasi reactive operation, tapi belum tentu mengatur connect timeout, pool acquire timeout, TLS timeout, dan transport behavior secara lengkap.

Production design harus punya timeout policy eksplisit.

---

## 5. HTTP Interface / HTTP Service Client

### 5.1 Apa itu HTTP Interface Client?

Spring memungkinkan kita mendefinisikan remote HTTP service sebagai Java interface, lalu Spring membuat proxy implementasinya.

Contoh konseptual:

```java
@HttpExchange("/users")
public interface UserHttpApi {

    @GetExchange("/{id}")
    UserDto getUser(@PathVariable String id);
}
```

Lalu interface ini dapat diproxy menggunakan adapter yang berbasis `RestClient` atau `WebClient`.

Mental model:

```text
Java interface method
   ↓
annotation metadata
   ↓
proxy invocation
   ↓
HTTP request creation
   ↓
RestClient/WebClient adapter
   ↓
underlying HTTP engine
```

Ini mirip ide Retrofit/Feign: HTTP API dibuat type-safe lewat interface.

### 5.2 Kekuatan HTTP Interface

Kelebihan:

- mengurangi boilerplate
- kontrak API lebih eksplisit
- cocok untuk internal service SDK
- mudah dibaca
- memisahkan deklarasi endpoint dari business service
- mendukung synchronous/reactive style tergantung adapter

### 5.3 Bahaya HTTP Interface

Declarative client bisa menimbulkan ilusi aman.

Contoh:

```java
@GetExchange("/users/{id}")
UserDto getUser(@PathVariable String id);
```

Pertanyaan production tetap sama:

- timeout-nya di mana?
- retry-nya di mana?
- error 404 dimodelkan sebagai apa?
- auth refresh bagaimana?
- correlation header ditambahkan di mana?
- body error dibaca atau hilang?
- apakah DTO interface bocor ke domain?
- apakah URL/path encoding benar?
- bagaimana testing fault injection?

Interface hanya mengurangi boilerplate. Ia tidak menggantikan architecture.

### 5.4 Interface Client Harus Tetap Dibungkus Domain Port

Jangan inject HTTP interface langsung ke domain service jika kontraknya masih external DTO.

Kurang ideal:

```java
@Service
class PaymentService {
    private final PaymentPartnerHttpApi api;

    PaymentStatus check(String paymentId) {
        return api.getPayment(paymentId).status();
    }
}
```

Lebih baik:

```java
public interface PaymentGateway {
    PaymentLookupResult lookup(PaymentId id);
}

@Component
class SpringHttpPaymentGateway implements PaymentGateway {
    private final PaymentPartnerHttpApi api;

    @Override
    public PaymentLookupResult lookup(PaymentId id) {
        try {
            PaymentPartnerDto dto = api.getPayment(id.value());
            return PaymentLookupResult.found(map(dto));
        } catch (PartnerNotFoundException e) {
            return PaymentLookupResult.notFound();
        } catch (PartnerRetryableException e) {
            return PaymentLookupResult.temporarilyUnavailable(e.reason());
        }
    }
}
```

Layering yang lebih sehat:

```text
Domain Service
   ↓ depends on
PaymentGateway port
   ↓ implemented by
Spring HTTP adapter
   ↓ uses
HTTP interface / RestClient / WebClient
```

---

## 6. Request Factory dan Connector: Layer yang Sering Dilupakan

### 6.1 Kenapa Ini Penting?

Banyak engineer fokus pada API Spring:

```java
restClient.get().uri(...).retrieve().body(...)
```

Padahal production behavior sering ditentukan oleh layer bawah:

```text
RestClient / RestTemplate
   ↓
ClientHttpRequestFactory
   ↓
JDK HttpURLConnection / JDK HttpClient / Apache HttpClient / Jetty / others
```

atau:

```text
WebClient
   ↓
ClientHttpConnector
   ↓
Reactor Netty / Jetty / JDK / Apache / others
```

### 6.2 Transport Engine Menentukan Banyak Hal

Transport menentukan:

- connection pooling
- per-route connection limit
- HTTP/2 support
- TLS customization
- proxy behavior
- connect timeout
- read/write timeout
- pool acquire timeout
- idle eviction
- DNS behavior
- metric yang tersedia
- lifecycle shutdown

Spring API memberi abstraction, tapi engine memberi mechanics.

### 6.3 Decision Rule

Gunakan rule ini:

```text
Spring client API dipilih berdasarkan programming model.
Underlying engine dipilih berdasarkan transport requirement.
```

Contoh:

| Kebutuhan | API Spring | Engine yang masuk akal |
|---|---|---|
| synchronous simple new code | RestClient | JDK/Apache |
| legacy synchronous | RestTemplate | Apache/JDK |
| reactive end-to-end | WebClient | Reactor Netty |
| enterprise proxy/TLS/pool detail | RestClient/RestTemplate | Apache HttpClient |
| declarative internal SDK | HTTP Interface | RestClient/WebClient adapter |
| high fan-out non-blocking | WebClient | Reactor Netty |
| Java 21 virtual-thread blocking | RestClient | JDK/Apache |

---

## 7. Blocking, Reactive, Async, dan Virtual Threads

### 7.1 Empat Model yang Sering Tercampur

```text
Blocking synchronous
  Caller thread menunggu response.

Async future-based
  Caller mendapat Future/CompletableFuture.

Reactive non-blocking
  Caller membangun stream/pipeline; eksekusi terjadi saat subscription.

Blocking with virtual threads
  Kode terlihat blocking, tetapi thread-nya murah secara JVM scheduling.
```

### 7.2 RestTemplate / RestClient

Default mental model:

```text
one operation occupies caller thread until completion
```

Dengan platform thread:

```text
banyak blocked call → banyak thread blocked → memory/context-switch cost
```

Dengan virtual thread Java 21+:

```text
blocking style bisa lebih scalable
asalkan blocking operation tidak pinning carrier thread secara signifikan
asalkan downstream tetap dilindungi bulkhead/rate limit
```

Virtual thread tidak menghapus kebutuhan:

- timeout
- bulkhead
- connection pool limit
- retry budget
- backpressure
- observability

Virtual thread membuat thread lebih murah, bukan downstream lebih kuat.

### 7.3 WebClient

WebClient cocok jika:

```text
aplikasi reactive end-to-end
+ banyak concurrent I/O
+ tim paham reactive operator
+ tidak banyak blocking library di tengah pipeline
```

WebClient kurang ideal jika:

```text
semua call akhirnya .block()
+ tim tidak nyaman reactive debugging
+ service layer/domain masih imperative
+ kebutuhan utama hanya synchronous HTTP client modern
```

### 7.4 Decision Heuristic

```text
Java 8 legacy synchronous        → RestTemplate or Apache/OkHttp wrapper
Java 17/21 imperative service    → RestClient + controlled engine
Java 21 high concurrency blocking→ RestClient + virtual threads + bulkhead
Reactive service                 → WebClient
Declarative API client           → HTTP Interface / Retrofit / Feign-like style
```

---

## 8. Error Handling di Spring Client Layer

### 8.1 Default Error Handling Bisa Tidak Sesuai Domain

HTTP client Spring sering punya default behavior yang mengubah 4xx/5xx menjadi exception.

Itu nyaman, tapi bisa merusak model jika:

- 404 adalah valid domain result
- 409 adalah business conflict, bukan technical failure
- 429 adalah retryable overload signal
- 422 adalah validation response yang perlu diteruskan
- 500 dari partner perlu mapped ke degraded state

### 8.2 Error Taxonomy yang Lebih Baik

Gunakan taxonomy:

```text
TransportError
  DNS failure, connect failure, TLS failure, timeout, connection reset

ProtocolError
  invalid status line, malformed header, unsupported content-type

HttpError
  4xx/5xx with status/body/header

PartnerSemanticError
  response syntactically OK, but business code indicates failure

ClientPolicyError
  rejected by local limiter/bulkhead/circuit breaker/deadline
```

Lalu map ke domain-safe result.

```java
sealed interface PartnerResult<T> permits PartnerSuccess, PartnerNotFound,
    PartnerRejected, PartnerTemporaryFailure, PartnerPermanentFailure {
}
```

### 8.3 Jangan Bocorkan Spring Exception ke Domain Layer

Kurang ideal:

```java
@Service
class AccountService {
    Account get(String id) {
        try {
            return restClient.get().uri("/accounts/{id}", id)
                .retrieve()
                .body(Account.class);
        } catch (HttpClientErrorException.NotFound e) {
            throw new AccountNotFoundException(id);
        }
    }
}
```

Lebih baik:

```java
@Component
class PartnerAccountGateway implements AccountGateway {

    public AccountLookupResult lookup(AccountId id) {
        PartnerResult<PartnerAccountDto> result = partnerClient.getAccount(id.value());
        return switch (result) {
            case PartnerSuccess<PartnerAccountDto> ok -> AccountLookupResult.found(map(ok.value()));
            case PartnerNotFound nf -> AccountLookupResult.notFound();
            case PartnerTemporaryFailure tf -> AccountLookupResult.temporarilyUnavailable(tf.reason());
            case PartnerPermanentFailure pf -> AccountLookupResult.failed(pf.reason());
            default -> AccountLookupResult.failed("unexpected result");
        };
    }
}
```

---

## 9. Interceptor, Filter, dan Cross-Cutting Concern

### 9.1 RestTemplate / RestClient Interceptor

Untuk synchronous Spring client, interceptor biasanya dipakai untuk:

- correlation ID
- request ID
- authentication header
- metrics
- logging
- redaction
- tenant header
- idempotency key

Contoh sederhana:

```java
class CorrelationIdInterceptor implements ClientHttpRequestInterceptor {

    @Override
    public ClientHttpResponse intercept(
        HttpRequest request,
        byte[] body,
        ClientHttpRequestExecution execution
    ) throws IOException {
        request.getHeaders().set("X-Correlation-ID", CorrelationContext.currentId());
        return execution.execute(request, body);
    }
}
```

Perhatikan parameter `byte[] body`. Pada beberapa model interceptor, body sudah buffered. Untuk payload besar, logging/interception body bisa mahal.

### 9.2 WebClient Filter

WebClient memakai `ExchangeFilterFunction`.

```java
ExchangeFilterFunction correlationFilter = (request, next) -> {
    ClientRequest newRequest = ClientRequest.from(request)
        .header("X-Correlation-ID", CorrelationContext.currentId())
        .build();
    return next.exchange(newRequest);
};
```

### 9.3 Interceptor Ordering

Urutan penting.

Contoh ordering yang masuk akal:

```text
1. request context enrichment
2. correlation / trace propagation
3. auth injection
4. idempotency key
5. metrics timing start
6. safe logging
7. execution
8. response classification
9. metrics timing stop
10. redacted log outcome
```

Namun retry biasanya tidak selalu ideal di interceptor karena:

- perlu policy domain/idempotency
- harus tahu operation deadline
- perlu avoid nested retry
- perlu classify error body
- bisa replay non-repeatable body

Lebih baik retry ada di client wrapper/policy layer, kecuali retry transport-level sangat terbatas.

---

## 10. Observability dengan Spring HTTP Clients

### 10.1 Yang Wajib Diukur

Per downstream client:

```text
request count
latency histogram
status code distribution
exception category
timeout count
retry attempt count
circuit breaker state
rate limit rejection
bulkhead rejection
pool acquire latency
active connections
in-flight requests
payload size bucket
```

### 10.2 Tag Cardinality

Jangan tag metric dengan full URL:

```text
BAD:
http.client.duration{url="/users/12345/orders/999"}
```

Gunakan route template:

```text
GOOD:
http.client.duration{client="payment", route="GET /users/{id}/orders/{orderId}"}
```

### 10.3 Logging

Log minimal:

```text
client=payment
operation=getPayment
method=GET
route=/payments/{id}
status=200
latency_ms=83
attempt=1
trace_id=...
correlation_id=...
```

Untuk error:

```text
client=payment
operation=getPayment
failure_category=TIMEOUT
phase=response_wait
timeout_ms=3000
retryable=true
attempt=2
elapsed_ms=6120
```

Jangan log:

- `Authorization`
- cookies
- API keys
- full token
- PII body
- password
- private key material
- sensitive query parameter

### 10.4 Distributed Tracing

Spring ecosystem biasanya dapat berintegrasi dengan Micrometer Observation/OpenTelemetry. Namun jangan hanya mengandalkan auto-instrumentation. Pastikan span punya nama yang stabil.

Contoh naming:

```text
HTTP GET partner-payment /payments/{id}
```

Bukan:

```text
HTTP GET https://partner.example/payments/928391029
```

---

## 11. Timeout, Pool, dan Engine Config di Spring

### 11.1 Timeout Tidak Cukup di Level Spring API

Ini tidak cukup:

```java
RestClient.builder()
    .baseUrl("https://api.example")
    .build();
```

Kita butuh policy:

```yaml
clients:
  payment:
    base-url: https://payment.example
    timeout:
      connect: 500ms
      pool-acquire: 200ms
      response: 2500ms
      operation: 3000ms
    pool:
      max-total: 200
      max-per-route: 50
      idle-evict: 30s
    retry:
      max-attempts: 2
      backoff: 100ms
      jitter: true
```

### 11.2 Config Per Downstream

Jangan satu global timeout untuk semua.

```text
payment API       → latency sensitive, short timeout
report API        → long-running, different pool
email API         → retryable but low priority
identity API      → strict auth, low timeout, no broad retry
file API          → streaming, different read timeout
```

### 11.3 Pooling Relation

Jika memakai Apache-backed Spring client:

```text
Spring RestClient
   ↓
HttpComponentsClientHttpRequestFactory
   ↓
Apache CloseableHttpClient
   ↓
PoolingHttpClientConnectionManager
```

Jika memakai WebClient/Reactor Netty:

```text
WebClient
   ↓
ReactorClientHttpConnector
   ↓
HttpClient / ConnectionProvider
   ↓
Netty event loop + pool
```

Yang harus dipastikan:

- max connection masuk akal
- pending acquire dibatasi
- idle timeout sinkron dengan LB
- response body selalu dikonsumsi/diclose
- shutdown lifecycle jelas

---

## 12. Spring Client Architecture: Jangan Sebar HTTP Call

### 12.1 Bad Architecture

```java
@Service
class OrderService {
    private final RestClient restClient;

    void submit(Order order) {
        restClient.post()
            .uri("https://payment.example/payments")
            .body(order)
            .retrieve()
            .body(String.class);
    }
}
```

Masalah:

- business service tahu URL partner
- DTO domain bisa bocor ke external API
- error model bercampur
- retry policy tersebar
- observability tidak konsisten
- sulit test failure scenario

### 12.2 Better Architecture

```text
OrderService
   ↓
PaymentGateway interface
   ↓
PaymentHttpClient implementation
   ↓
Spring RestClient/WebClient/HTTP Interface
   ↓
transport engine
```

Kode:

```java
public interface PaymentGateway {
    PaymentSubmissionResult submit(PaymentCommand command);
}

@Component
final class SpringPaymentGateway implements PaymentGateway {
    private final PaymentPartnerClient client;
    private final PaymentMapper mapper;

    @Override
    public PaymentSubmissionResult submit(PaymentCommand command) {
        PartnerPaymentRequest request = mapper.toPartnerRequest(command);
        PartnerResult<PartnerPaymentResponse> result = client.submitPayment(request);
        return mapper.toDomainResult(result);
    }
}
```

### 12.3 Per-Client Package Structure

```text
paymentclient/
  PaymentGateway.java                 # domain port
  SpringPaymentGateway.java           # adapter
  PaymentPartnerClient.java           # HTTP client wrapper
  PaymentPartnerHttpApi.java          # optional HTTP interface
  PaymentClientConfig.java            # RestClient/WebClient config
  PaymentClientProperties.java        # timeout/pool/auth config
  PaymentRequestDto.java
  PaymentResponseDto.java
  PaymentErrorDto.java
  PaymentMapper.java
  PaymentClientException.java
  PaymentClientMetrics.java
```

Prinsip:

```text
Domain tidak tahu Spring HTTP client.
Domain tidak tahu external DTO.
Domain tidak tahu HTTP status code detail.
```

---

## 13. Migration Strategy

### 13.1 RestTemplate ke RestClient

Jangan big bang.

Langkah:

```text
1. inventory semua RestTemplate usage
2. kelompokkan per downstream API
3. buat domain port/client wrapper
4. pindahkan config timeout/pool/interceptor ke centralized config
5. migrate endpoint satu per satu
6. pertahankan test contract
7. observability compare sebelum/sesudah
8. hapus direct RestTemplate injection dari service layer
```

Contoh sebelum:

```java
UserDto dto = restTemplate.getForObject(url, UserDto.class);
```

Sesudah:

```java
UserDto dto = restClient.get()
    .uri("/users/{id}", id)
    .retrieve()
    .body(UserDto.class);
```

Namun migration yang benar bukan hanya mengganti API. Yang benar:

```text
direct HTTP call → dedicated external client adapter
```

### 13.2 RestTemplate ke WebClient

Lakukan hanya jika memang butuh reactive/non-blocking atau sudah reactive end-to-end.

Jika semua berakhir dengan `.block()`, evaluasi ulang apakah `RestClient` lebih cocok.

### 13.3 RestClient ke HTTP Interface

Cocok jika:

- banyak endpoint dengan pola deklaratif
- ingin interface contract jelas
- ingin mengurangi boilerplate
- error handling bisa distandardisasi
- adapter tetap dibungkus domain port

---

## 14. Testing Spring HTTP Clients

### 14.1 Test Level

```text
Unit test mapper/error classifier
Unit test gateway domain mapping
HTTP client test with mock server
Contract test against provider contract
Integration test with real/staged downstream
Fault injection test
```

### 14.2 Mocking Terlalu Dalam vs Terlalu Dangkal

Kurang bagus:

```java
when(restClient.get()).thenReturn(...); // chain mocking rapuh
```

Lebih baik test client terhadap mock HTTP server:

```text
client sends expected method/path/header/body
server returns status/body/header
client maps response to domain-safe result
```

Tool:

- WireMock
- MockWebServer
- MockServer
- Spring test support

### 14.3 Fault Injection Cases

Minimal test:

```text
200 success
201 created
204 no content
400 validation error
401 auth failure
404 not found as domain result
409 conflict
422 semantic validation error
429 with Retry-After
500 retryable
503 retryable
malformed JSON
wrong Content-Type
slow response timeout
connection reset
empty body where body expected
large body
sensitive header redaction
```

---

## 15. Production Configuration Template

Contoh property model:

```java
@ConfigurationProperties(prefix = "external.clients.payment")
public record PaymentClientProperties(
    URI baseUrl,
    Timeout timeout,
    Pool pool,
    Retry retry,
    Auth auth
) {
    public record Timeout(
        Duration connect,
        Duration poolAcquire,
        Duration response,
        Duration operation
    ) {}

    public record Pool(
        int maxTotal,
        int maxPerRoute,
        Duration idleEvictAfter,
        Duration ttl
    ) {}

    public record Retry(
        int maxAttempts,
        Duration initialBackoff,
        boolean jitter
    ) {}

    public record Auth(
        String tokenParameterName
    ) {}
}
```

Validasi startup:

```java
@PostConstruct
void validate() {
    requirePositive(timeout.connect());
    requirePositive(timeout.response());

    if (timeout.operation().compareTo(timeout.response()) < 0) {
        throw new IllegalStateException("operation timeout must be >= response timeout");
    }

    if (pool.maxPerRoute() > pool.maxTotal()) {
        throw new IllegalStateException("maxPerRoute cannot exceed maxTotal");
    }
}
```

Prinsip:

```text
Bad config should fail fast at startup, not become production incident.
```

---

## 16. Decision Matrix

| Situation | Recommended Starting Point | Why |
|---|---|---|
| New imperative Spring service | `RestClient` | modern synchronous API, easier than RestTemplate |
| Existing large legacy app | keep `RestTemplate` behind wrapper, migrate gradually | lower risk |
| Reactive service end-to-end | `WebClient` | non-blocking pipeline consistent |
| Java 21+ high concurrency imperative | `RestClient` + virtual threads + bulkhead | simple code with scalable blocking |
| Strong enterprise transport control | `RestClient`/`RestTemplate` + Apache engine | pool/proxy/TLS config strong |
| Declarative internal SDK | HTTP Interface + RestClient/WebClient adapter | type-safe contract |
| Complex generated client need | consider OpenAPI client / Retrofit / HTTP Interface | governance dependent |
| Team weak in reactive | avoid WebClient unless necessary | reduce cognitive risk |
| Large file streaming | choose engine/config carefully; avoid naive body buffering | memory safety |
| Third-party API with rate limit | any client + explicit limiter/bulkhead/retry policy | policy matters more than API style |

---

## 17. Common Failure Modes

### 17.1 Using WebClient but Blocking Everywhere

Symptom:

```text
WebClient used, but every call ends with .block()
```

Consequence:

- reactive complexity without reactive benefit
- possible event loop blocking if misused
- harder stack traces/debugging

Possible fix:

```text
Use RestClient for imperative flow,
or make pipeline reactive end-to-end.
```

### 17.2 No Per-Downstream Client Config

Symptom:

```text
single RestClient/WebClient bean for all external APIs
```

Consequence:

- wrong timeout for some APIs
- pool contention across unrelated downstreams
- metrics cannot isolate dependency failure

Fix:

```text
one named client config per downstream/service/traffic class
```

### 17.3 Direct HTTP Calls in Business Services

Symptom:

```text
business service constructs URLs and handles HTTP status
```

Consequence:

- domain polluted by protocol details
- duplicated error handling
- hard testing
- inconsistent resilience policy

Fix:

```text
external client adapter/gateway layer
```

### 17.4 Interceptor Logs Sensitive Data

Symptom:

```text
request/response logging logs headers and body blindly
```

Consequence:

- token leak
- PII leak
- compliance incident

Fix:

```text
redaction-first logging design
```

### 17.5 Retry Hidden in Multiple Layers

Symptom:

```text
WebClient retryWhen + Resilience4j retry + engine retry + service mesh retry
```

Consequence:

- retry amplification
- downstream overload
- latency explosion

Fix:

```text
single owner of semantic retry policy
transport recovery only for narrow low-level cases
```

---

## 18. Design Review Checklist

Sebelum approve Spring HTTP client code, tanyakan:

### API and Architecture

```text
[ ] Apakah HTTP call dibungkus client/gateway khusus?
[ ] Apakah domain layer tidak bergantung langsung pada RestClient/WebClient/RestTemplate?
[ ] Apakah external DTO tidak bocor ke domain model?
[ ] Apakah base URL tidak hardcoded di service method?
```

### Transport

```text
[ ] Underlying engine jelas?
[ ] Timeout connect/response/pool/operation jelas?
[ ] Connection pool limit jelas?
[ ] Idle eviction/TTL jelas?
[ ] Shutdown lifecycle jelas?
```

### Failure

```text
[ ] 4xx/5xx dimodelkan eksplisit?
[ ] 404/409/422 punya semantic mapping?
[ ] 429/503 retryable dengan budget?
[ ] Transport failure dan HTTP failure dibedakan?
[ ] Error body dibaca secara aman?
```

### Resilience

```text
[ ] Retry policy explicit dan idempotency-aware?
[ ] Timeout total membatasi retry?
[ ] Circuit breaker/bulkhead/rate limiter tidak nested sembarangan?
[ ] Tidak ada retry di banyak layer tanpa governance?
```

### Security

```text
[ ] Authorization/token tidak dilog?
[ ] Sensitive query/body redacted?
[ ] Redirect policy aman?
[ ] Host/base URL allowlist jika input user mempengaruhi URL?
[ ] TLS/mTLS config production-safe?
```

### Observability

```text
[ ] Metrics per downstream client?
[ ] Route template bukan full URL high-cardinality?
[ ] Trace context propagated?
[ ] Failure category visible?
[ ] Retry attempt visible?
```

### Testing

```text
[ ] Ada test untuk success/error/timeout/malformed body?
[ ] Ada test untuk header auth/correlation?
[ ] Ada test untuk retry/idempotency behavior?
[ ] Ada test untuk redaction?
```

---

## 19. Mental Model Final

Spring HTTP client layer harus dipandang seperti ini:

```text
RestTemplate / RestClient / WebClient bukan “cara call API”.
Mereka adalah facade untuk membangun HTTP client boundary.
```

Perbedaan utama:

```text
RestTemplate:
  old synchronous template API, cocok untuk legacy dengan wrapper baik.

RestClient:
  modern synchronous fluent API, pilihan default bagus untuk imperative Spring app baru.

WebClient:
  reactive/non-blocking API, cocok jika aplikasi memang reactive atau butuh high-concurrency non-blocking I/O.

HTTP Interface:
  declarative contract layer, cocok untuk type-safe SDK/client, tapi tetap perlu policy dan wrapper.
```

Keahlian top-tier bukan memilih library paling baru, tetapi mampu menjawab:

```text
Bagaimana request ini gagal?
Berapa lama ia boleh hidup?
Resource apa yang ia pegang?
Apa yang terjadi saat downstream lambat?
Apakah retry aman?
Apakah error-nya bermakna bagi domain?
Apakah observability cukup untuk incident?
Apakah token/data sensitif aman?
Apakah design ini masih benar pada 10x traffic?
```

---

## 20. Ringkasan

Part ini membahas Spring HTTP client layer secara production-oriented:

- `RestTemplate` masih relevan untuk legacy, tetapi sebaiknya tidak menjadi default desain baru.
- `RestClient` adalah modern synchronous fluent client yang cocok untuk banyak aplikasi imperative Spring modern.
- `WebClient` cocok untuk reactive/non-blocking, tetapi tidak boleh dipakai hanya karena “lebih modern”.
- HTTP Interface memberi declarative type-safe client, tetapi tetap butuh domain wrapper dan resilience policy.
- Underlying engine/request factory/connector menentukan banyak aspek production: timeout, pooling, TLS, proxy, dan lifecycle.
- Virtual threads membuat blocking style lebih murah, tetapi tidak menghilangkan bulkhead, timeout, rate limit, dan pool control.
- Error model harus dipisahkan dari raw Spring exception.
- Observability, redaction, testing, dan failure taxonomy harus menjadi bagian dari client design sejak awal.

---

## 21. Referensi Resmi dan Lanjutan

- Spring Framework Reference — REST Clients
- Spring Framework Reference — HTTP Service Client / HTTP Interface Client
- Spring Framework Javadoc — `RestTemplate`
- Spring Framework Javadoc — `RestClient`
- Spring Boot Reference — Calling REST Services
- Spring blog — The State of HTTP Clients in Spring
- Reactor Netty Reference
- Micrometer Observation / Spring Observability documentation
- Apache HttpClient 5 documentation
- JDK `java.net.http.HttpClient` documentation

---

## 22. Status Series

Selesai:

```text
Part 18 — Spring HTTP Client Layer: RestTemplate, WebClient, RestClient
```

Series belum selesai.

Part berikutnya:

```text
Part 19 — API Client Architecture: Port, Adapter, Gateway, SDK, Anti-Corruption Layer
File: 19-api-client-architecture-port-adapter-gateway-sdk-acl.md
```


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 17 — Apache HttpClient 5 Deep Dive](./17-apache-httpclient-5-deep-dive.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 19 — API Client Architecture: Port, Adapter, Gateway, SDK, Anti-Corruption Layer](./19-api-client-architecture-port-adapter-gateway-sdk-acl.md)
