# Part 15 — Spring HTTP Clients: RestTemplate, RestClient, WebClient, and HTTP Interface

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `15-spring-http-clients-restclient-webclient-http-interface.md`  
> Posisi: Part 15 dari 35  
> Fokus: outbound HTTP integration layer pada aplikasi Spring dari Java 8 sampai Java 25  
> Target: mampu mendesain HTTP client Spring yang eksplisit, resilient, observable, testable, dan aman untuk sistem produksi

---

## 0. Kenapa Part Ini Penting

Banyak sistem Spring terlihat “normal” di sisi inbound API, tetapi rapuh di sisi outbound integration.

Controller-nya rapi. Service-nya punya transaction boundary. Repository-nya cukup terstruktur. Tetapi begitu aplikasi memanggil sistem luar, sering muncul masalah seperti:

- tidak ada timeout;
- retry dilakukan sembarangan;
- error external API bocor ke domain model;
- downstream lambat membuat semua thread habis;
- JSON error body tidak dipahami;
- token OAuth2 refresh gagal diam-diam;
- correlation ID tidak diteruskan;
- client dibuat manual per call;
- pool connection tidak dikontrol;
- response besar diload ke memory;
- non-idempotent request di-retry berkali-kali;
- test hanya mock service, bukan contract HTTP;
- external DTO bocor sampai database entity;
- `WebClient.block()` dipakai di event loop;
- `RestTemplate` lama tetap dipakai tanpa governance;
- declarative HTTP interface dipakai seperti magic tanpa tahu underlying client.

Part ini membahas Spring HTTP client sebagai **integration boundary**, bukan sebagai sekadar “cara call API”.

Mental model utama:

```text
Outbound HTTP client adalah adapter keluar dari sistem.

Ia harus mengubah:
- perintah internal menjadi HTTP request,
- HTTP response menjadi hasil aplikasi,
- HTTP error menjadi failure semantics internal,
- latency eksternal menjadi timeout/retry/circuit decision,
- network uncertainty menjadi observability dan recovery model.
```

Dalam arsitektur serius, HTTP client bukan helper statis. Ia adalah boundary object yang punya kontrak, konfigurasi, retry policy, timeout, telemetry, security, dan test strategy.

---

## 1. Peta Besar HTTP Client di Spring

Spring memiliki beberapa generasi HTTP client utama:

```text
RestTemplate
    ↓ legacy synchronous client

RestClient
    ↓ modern synchronous fluent client

WebClient
    ↓ reactive/non-blocking client

HTTP Interface
    ↓ declarative client abstraction di atas RestClient/WebClient atau adapter lain
```

Secara ringkas:

| Client | Style | Stack | Cocok Untuk | Catatan |
|---|---|---|---|---|
| `RestTemplate` | imperative | blocking | legacy Java 8/Spring 5 | maintenance-style usage; jangan untuk desain baru jika tersedia alternatif modern |
| `RestClient` | imperative fluent | blocking | mayoritas Spring MVC modern | API lebih modern, readable, synchronous |
| `WebClient` | reactive | non-blocking | high concurrency, streaming, WebFlux, reactive composition | jangan dipakai asal jika seluruh app imperative dan blocking |
| HTTP Interface | declarative | adapter-based | client contract yang tipis dan typed | cocok untuk API client internal/eksternal dengan governance |

Prinsip utama:

```text
Pilih HTTP client berdasarkan execution model dan failure model,
bukan berdasarkan mana yang terlihat paling baru.
```

---

## 2. Evolusi Versi: Java 8 sampai Java 25

### 2.1 Java 8–11 Era

Pada era Java 8 dan Spring 5.x, banyak aplikasi memakai:

- `RestTemplate`;
- Apache HttpClient;
- OkHttp;
- Feign;
- manual `HttpURLConnection`;
- kadang `WebClient` jika sudah masuk WebFlux.

Keterbatasan umum:

- API `RestTemplate` cukup verbose;
- konfigurasi timeout sering tersebar;
- error handling sering manual;
- observability belum sekuat Micrometer Observation modern;
- reactive belum selalu cocok untuk tim yang masih full imperative;
- Java built-in HTTP client baru muncul di Java 11.

### 2.2 Java 17–21 Era

Dengan Spring Framework 6.x dan Spring Boot 3.x:

- baseline modern berpindah ke Java 17;
- `RestClient` hadir sebagai synchronous fluent client;
- HTTP interface mulai menjadi opsi declarative;
- observability Spring Boot/Micrometer lebih matang;
- virtual threads mulai relevan di Java 21;
- `jakarta.*` menggantikan `javax.*` pada banyak area.

### 2.3 Java 25 / Spring 7 / Boot 4 Era

Pada generasi Spring modern:

- Java 17 masih minimum pada Spring Framework 7/Boot 4;
- Java 25 menjadi target LTS modern;
- HTTP interface dan client abstraction semakin first-class;
- null-safety dan API ergonomics membaik;
- `RestClient` dan declarative HTTP clients menjadi pilihan default untuk banyak service-to-service call synchronous;
- WebClient tetap penting untuk reactive/non-blocking/streaming.

Implikasi untuk engineer:

```text
Untuk kode baru di Spring modern:
- default awal: RestClient atau HTTP Interface;
- pilih WebClient jika benar-benar butuh reactive/non-blocking/streaming composition;
- pertahankan RestTemplate hanya untuk legacy/migration path;
- jangan mencampur execution model tanpa alasan kuat.
```

---

## 3. HTTP Client sebagai Adapter, Bukan Utility

Kesalahan desain umum:

```java
@Service
class PaymentService {
    private final RestTemplate restTemplate = new RestTemplate();

    PaymentStatus getStatus(String id) {
        return restTemplate.getForObject("https://pay.example.com/status/" + id, PaymentStatus.class);
    }
}
```

Masalah:

- URL hardcoded;
- client dibuat manual;
- tidak ada timeout;
- tidak ada retry policy;
- tidak ada error mapping;
- tidak ada telemetry;
- tidak ada auth propagation;
- external DTO menjadi bagian service;
- sulit diuji;
- sulit dimigrasi.

Desain yang lebih sehat:

```text
Application Service
    ↓ calls port
PaymentGateway
    ↓ implemented by adapter
HttpPaymentGateway
    ↓ uses configured client
RestClient / WebClient / HTTP Interface
    ↓ downstream API
External Payment Provider
```

Contoh boundary:

```java
public interface PaymentGateway {
    PaymentProviderStatus fetchStatus(PaymentReference reference);
}
```

Adapter:

```java
@Component
final class HttpPaymentGateway implements PaymentGateway {

    private final PaymentApiClient client;
    private final PaymentApiMapper mapper;

    HttpPaymentGateway(PaymentApiClient client, PaymentApiMapper mapper) {
        this.client = client;
        this.mapper = mapper;
    }

    @Override
    public PaymentProviderStatus fetchStatus(PaymentReference reference) {
        PaymentStatusResponse response = client.getStatus(reference.value());
        return mapper.toDomain(response);
    }
}
```

Prinsip:

```text
External HTTP API adalah dependency volatile.
Jangan biarkan volatility itu masuk ke domain core.
```

---

## 4. RestTemplate: Legacy Synchronous Client

### 4.1 Apa Itu RestTemplate

`RestTemplate` adalah client synchronous tradisional Spring untuk melakukan HTTP request.

Contoh:

```java
RestTemplate restTemplate = new RestTemplate();
PaymentResponse response = restTemplate.getForObject(
    "https://api.example.com/payments/{id}",
    PaymentResponse.class,
    paymentId
);
```

Ia blocking, imperative, dan umum di codebase Spring lama.

### 4.2 Kapan Masih Masuk Akal

`RestTemplate` masih masuk akal ketika:

- aplikasi masih Spring 5 / Boot 2 / Java 8;
- banyak library internal masih berbasis `RestTemplate`;
- migrasi bertahap belum memungkinkan;
- tim membutuhkan perubahan minimal;
- behavior legacy sudah teruji dan risiko migrasi lebih besar daripada manfaatnya.

Namun untuk desain baru di Spring modern, gunakan `RestClient` atau HTTP interface.

### 4.3 Konfigurasi RestTemplate yang Benar

Jangan membuat `new RestTemplate()` sembarangan di service.

Gunakan `RestTemplateBuilder`:

```java
@Configuration
class ExternalClientConfiguration {

    @Bean
    RestTemplate paymentRestTemplate(RestTemplateBuilder builder) {
        return builder
            .rootUri("https://payment.example.com")
            .connectTimeout(Duration.ofSeconds(2))
            .readTimeout(Duration.ofSeconds(5))
            .additionalInterceptors(new CorrelationIdInterceptor())
            .build();
    }
}
```

Catatan:

- timeout harus eksplisit;
- root URI harus dari config;
- interceptor harus terdaftar centrally;
- error handling harus diputuskan;
- client harus reusable.

### 4.4 Error Handling RestTemplate

Default behavior `RestTemplate` akan melempar exception untuk status 4xx/5xx melalui `ResponseErrorHandler`.

Custom handler:

```java
final class PaymentErrorHandler implements ResponseErrorHandler {

    @Override
    public boolean hasError(ClientHttpResponse response) throws IOException {
        return response.getStatusCode().isError();
    }

    @Override
    public void handleError(ClientHttpResponse response) throws IOException {
        HttpStatusCode status = response.getStatusCode();
        String body = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);

        if (status.value() == 404) {
            throw new PaymentNotFoundException(body);
        }
        if (status.value() == 429) {
            throw new PaymentRateLimitedException(body);
        }
        if (status.is5xxServerError()) {
            throw new PaymentProviderUnavailableException(body);
        }
        throw new PaymentProviderException(status.value(), body);
    }
}
```

Namun hati-hati:

- jangan bocorkan raw body ke user;
- jangan log secret/token;
- jangan semua 4xx dianggap fatal domain error;
- jangan semua 5xx otomatis retry tanpa idempotency.

---

## 5. RestClient: Modern Synchronous Client

### 5.1 Mental Model

`RestClient` adalah synchronous HTTP client dengan fluent API. Ia cocok untuk aplikasi Spring MVC/imperative modern yang ingin API lebih expressive daripada `RestTemplate` tanpa masuk reactive model.

Contoh:

```java
@Component
final class PaymentApiClient {

    private final RestClient restClient;

    PaymentApiClient(RestClient.Builder builder, PaymentClientProperties properties) {
        this.restClient = builder
            .baseUrl(properties.baseUrl())
            .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
            .build();
    }

    PaymentStatusResponse getStatus(String paymentId) {
        return restClient.get()
            .uri("/payments/{paymentId}/status", paymentId)
            .retrieve()
            .body(PaymentStatusResponse.class);
    }
}
```

Kelebihan:

- synchronous dan mudah dipahami;
- fluent API;
- integrasi Spring message converter;
- cocok untuk Java 17+ modern;
- lebih natural untuk service MVC + virtual thread;
- mudah dipakai sebagai underlying declarative HTTP interface.

### 5.2 RestClient Builder sebagai Central Governance

Untuk sistem besar, jangan setiap client mengatur sendiri semua hal.

Gunakan builder customization:

```java
@Configuration
class HttpClientConfiguration {

    @Bean
    RestClientCustomizer correlationIdCustomizer(CorrelationIdProvider provider) {
        return builder -> builder.requestInterceptor((request, body, execution) -> {
            provider.currentCorrelationId()
                .ifPresent(id -> request.getHeaders().set("X-Correlation-ID", id));
            return execution.execute(request, body);
        });
    }
}
```

Kemudian client spesifik hanya mengatur base URL dan domain-specific behavior.

```java
@Component
final class CaseRegistryClient {

    private final RestClient client;

    CaseRegistryClient(RestClient.Builder builder, CaseRegistryProperties properties) {
        this.client = builder
            .baseUrl(properties.baseUrl())
            .build();
    }
}
```

Governance yang sebaiknya centralized:

- correlation ID;
- user agent;
- common headers;
- observation/metrics;
- object mapper policy;
- default timeouts;
- TLS/client factory;
- logging redaction.

Governance yang sebaiknya per-client:

- base URL;
- auth scheme;
- retry/idempotency policy;
- error mapping;
- SLA timeout;
- rate limit;
- fallback behavior.

---

## 6. WebClient: Reactive and Non-Blocking Client

### 6.1 Apa Itu WebClient

`WebClient` adalah client reactive/non-blocking dari Spring WebFlux.

Contoh:

```java
@Component
final class ReactivePaymentClient {

    private final WebClient webClient;

    ReactivePaymentClient(WebClient.Builder builder, PaymentClientProperties properties) {
        this.webClient = builder
            .baseUrl(properties.baseUrl())
            .build();
    }

    Mono<PaymentStatusResponse> getStatus(String paymentId) {
        return webClient.get()
            .uri("/payments/{paymentId}/status", paymentId)
            .retrieve()
            .bodyToMono(PaymentStatusResponse.class);
    }
}
```

Ia cocok ketika:

- aplikasi WebFlux;
- perlu non-blocking I/O end-to-end;
- high fan-out call dengan composition reactive;
- streaming response;
- Server-Sent Events;
- backpressure-aware processing;
- integrasi reactive datastore.

### 6.2 Kapan WebClient Tidak Cocok

WebClient sering dipakai hanya karena dianggap “lebih modern”, padahal:

- codebase sepenuhnya imperative;
- developer tidak memahami Reactor;
- semua call langsung `.block()`;
- JDBC/JPA tetap blocking;
- error handling reactive tidak konsisten;
- context propagation tidak dipahami;
- event loop terblokir.

Jika semua request akhirnya blocking dan tidak ada reactive composition, `RestClient` sering lebih tepat.

### 6.3 Bahaya `.block()`

Di aplikasi MVC, memakai `WebClient.block()` bisa masih masuk akal bila disengaja sebagai bridge blocking.

Di aplikasi WebFlux event loop, `.block()` sangat berbahaya.

```java
@GetMapping("/bad")
Mono<Response> bad() {
    PaymentStatus status = webClient.get()
        .uri("/status")
        .retrieve()
        .bodyToMono(PaymentStatus.class)
        .block(); // buruk di reactive pipeline

    return Mono.just(new Response(status));
}
```

Masalah:

- event loop bisa terblokir;
- throughput turun drastis;
- deadlock mungkin terjadi;
- backpressure rusak;
- stack trace sulit dibaca.

Correct reactive composition:

```java
@GetMapping("/good")
Mono<Response> good() {
    return webClient.get()
        .uri("/status")
        .retrieve()
        .bodyToMono(PaymentStatus.class)
        .map(Response::new);
}
```

### 6.4 WebClient Error Handling

```java
Mono<PaymentStatusResponse> getStatus(String id) {
    return webClient.get()
        .uri("/payments/{id}/status", id)
        .retrieve()
        .onStatus(HttpStatusCode::is4xxClientError, response ->
            response.bodyToMono(PaymentErrorResponse.class)
                .map(error -> new PaymentClientException(error.code(), error.message()))
        )
        .onStatus(HttpStatusCode::is5xxServerError, response ->
            response.bodyToMono(String.class)
                .map(body -> new PaymentProviderUnavailableException("Payment provider failed"))
        )
        .bodyToMono(PaymentStatusResponse.class);
}
```

Prinsip:

```text
Reactive error tetap error semantics.
Jangan biarkan semua menjadi WebClientResponseException mentah.
```

---

## 7. HTTP Interface: Declarative Client

### 7.1 Mental Model

HTTP interface memungkinkan kita mendefinisikan kontrak HTTP sebagai Java interface:

```java
@HttpExchange("/payments")
public interface PaymentHttpApi {

    @GetExchange("/{paymentId}/status")
    PaymentStatusResponse getStatus(@PathVariable String paymentId);

    @PostExchange
    PaymentCreateResponse create(@RequestBody PaymentCreateRequest request);
}
```

Lalu Spring membuat proxy implementation berdasarkan adapter HTTP client.

Mental model:

```text
HTTP Interface = contract-oriented proxy untuk outbound HTTP.
Ia bukan domain port otomatis.
Ia tetap adapter-level client.
```

Jangan langsung expose interface ini ke domain core jika external DTO masih mentah.

Lebih aman:

```text
Domain/Application code
    ↓
PaymentGateway port
    ↓
HttpPaymentGateway adapter
    ↓
PaymentHttpApi declarative client
    ↓
External API
```

### 7.2 Membuat HTTP Interface dengan RestClient Adapter

Contoh konfigurasi:

```java
@Configuration
class PaymentHttpInterfaceConfiguration {

    @Bean
    PaymentHttpApi paymentHttpApi(RestClient.Builder builder, PaymentClientProperties properties) {
        RestClient restClient = builder
            .baseUrl(properties.baseUrl())
            .build();

        RestClientAdapter adapter = RestClientAdapter.create(restClient);
        HttpServiceProxyFactory factory = HttpServiceProxyFactory
            .builderFor(adapter)
            .build();

        return factory.createClient(PaymentHttpApi.class);
    }
}
```

Untuk Spring Boot generasi modern, konfigurasi deklaratif semakin dipermudah, tetapi prinsipnya tetap sama:

```text
Interface adalah kontrak.
Proxy adalah runtime implementation.
Underlying client tetap harus dikonfigurasi.
```

### 7.3 Kelebihan HTTP Interface

Kelebihan:

- deklaratif;
- type-safe pada method signature;
- mengurangi boilerplate;
- mudah distandardisasi;
- cocok untuk internal service client;
- bisa digabung dengan generated API interface jika governance baik;
- mudah dimock sebagai interface.

### 7.4 Risiko HTTP Interface

Risiko:

- menyembunyikan network call seperti local method call;
- terlalu mudah membuat client tanpa timeout/error policy;
- external API contract bocor ke application service;
- annotation HTTP tercampur dengan domain port;
- retry/error/fallback tidak terlihat di method declaration;
- versioning external API kurang eksplisit.

Rule of thumb:

```text
HTTP Interface bagus sebagai low-level API adapter,
bukan pengganti application port.
```

---

## 8. Memilih Client: Decision Matrix

### 8.1 Matrix Utama

| Situasi | Pilihan Utama | Alasan |
|---|---|---|
| Legacy Spring 5/Java 8 | `RestTemplate` | kompatibilitas |
| Spring MVC modern | `RestClient` | synchronous, fluent, sederhana |
| Declarative service client | HTTP Interface + `RestClient` | kontrak jelas, boilerplate rendah |
| WebFlux application | `WebClient` | non-blocking end-to-end |
| Streaming/SSE | `WebClient` | reactive stream support |
| High fan-out non-blocking composition | `WebClient` | concurrency tanpa thread per call |
| Java 21+ MVC + blocking downstream | `RestClient` + virtual threads dapat dipertimbangkan | model sederhana, blocking lebih murah tapi tetap perlu pool/timeout |
| Library internal lintas app | HTTP Interface atau adapter wrapper | governance lebih mudah |

### 8.2 Pertanyaan Sebelum Memilih

Tanyakan:

1. Apakah aplikasi inbound-nya MVC atau WebFlux?
2. Apakah downstream call blocking atau streaming?
3. Apakah call perlu reactive composition?
4. Apakah tim memahami Reactor dengan baik?
5. Apakah database masih JDBC/JPA?
6. Apakah kita butuh declarative contract?
7. Apakah API external sering berubah?
8. Apakah ada strict SLA timeout?
9. Apakah butuh OAuth2/mTLS/custom TLS?
10. Apakah call aman untuk retry?
11. Apakah response besar?
12. Apakah perlu per-client observability?

---

## 9. Timeout Taxonomy

Timeout bukan satu angka.

Untuk HTTP client production, pahami minimal:

| Timeout | Makna | Failure yang Dicegah |
|---|---|---|
| connect timeout | batas waktu membuka koneksi TCP/TLS | downstream tidak reachable membuat thread menggantung |
| connection acquisition timeout | batas menunggu koneksi dari pool | pool exhaustion tersembunyi |
| read/response timeout | batas menunggu data response | downstream lambat menghabiskan worker |
| write timeout | batas mengirim request body | upload besar/network lambat |
| total call timeout | deadline end-to-end | retry/fallback melewati SLA |

### 9.1 Timeout Harus Lebih Kecil dari SLA Inbound

Jika API inbound punya SLA 2 detik, outbound timeout 10 detik adalah desain salah.

```text
Inbound SLA: 2s
    ├─ business processing budget: 300ms
    ├─ downstream A budget: 600ms
    ├─ downstream B budget: 500ms
    ├─ retry budget: 300ms
    └─ margin: 300ms
```

Timeout harus mengikuti budget, bukan feeling.

### 9.2 Timeout dan Retry Harus Satu Paket

Retry tanpa total deadline bisa memperburuk outage.

Buruk:

```text
read timeout 5s
retry 3x
worst-case = 15s + overhead
inbound timeout = 3s
```

Lebih baik:

```text
connect timeout 500ms
response timeout 800ms
max attempts 2
backoff 100ms
call deadline < inbound SLA
```

---

## 10. Connection Pooling

### 10.1 Kenapa Pool Penting

Membuat koneksi baru untuk setiap request mahal:

- TCP handshake;
- TLS handshake;
- socket allocation;
- kernel overhead;
- latency tambahan;
- risiko port exhaustion.

Connection pool memungkinkan reuse koneksi.

Namun pool juga bisa menjadi bottleneck.

### 10.2 Pool Sizing Mental Model

Pool size bukan “semakin besar semakin baik”.

Pertimbangkan:

```text
expected concurrent outbound calls
= inbound concurrency × probability call downstream × calls per request
```

Contoh:

```text
100 concurrent inbound requests
80% memanggil payment service
rata-rata 1 call
≈ 80 concurrent outbound calls
```

Jika pool hanya 20, request akan antre di pool.

Jika pool 1000, downstream bisa dihantam terlalu keras.

### 10.3 Pool sebagai Backpressure

Pool dapat menjadi mekanisme backpressure lokal:

```text
limited pool + acquisition timeout
= mencegah aplikasi sendiri menghancurkan downstream dan dirinya sendiri
```

Tapi harus diobservasi:

- active connections;
- idle connections;
- pending acquisition;
- acquisition timeout;
- response latency;
- error rate per downstream.

---

## 11. Retry Semantics

### 11.1 Retry Bukan Obat Umum

Retry hanya benar jika:

- failure transient;
- operation idempotent atau memiliki idempotency key;
- ada timeout pendek;
- ada backoff;
- ada max attempts;
- ada observability;
- tidak memperburuk overload.

Jangan retry:

- validation error 400;
- unauthorized 401 tanpa refresh token strategy;
- forbidden 403;
- conflict 409 yang butuh user/action;
- non-idempotent POST tanpa idempotency key;
- downstream sedang overload tanpa backoff.

### 11.2 Status Code dan Retry

| Status/Failure | Bias Retry? | Catatan |
|---|---:|---|
| connection timeout | mungkin | jika transient dan budget cukup |
| read timeout | mungkin | hati-hati: server mungkin sudah memproses request |
| 408 | mungkin | tergantung operation |
| 409 | biasanya tidak | kecuali optimistic retry domain-aware |
| 429 | mungkin | hormati `Retry-After` |
| 500 | mungkin | jika idempotent |
| 502/503/504 | mungkin | dengan backoff |
| 400/401/403/404 | biasanya tidak | kecuali ada semantic khusus |

### 11.3 Idempotency Key

Untuk POST yang bisa diulang, gunakan idempotency key jika downstream mendukung.

```java
CreatePaymentResponse createPayment(CreatePaymentCommand command) {
    String idempotencyKey = command.requestId().value();

    return restClient.post()
        .uri("/payments")
        .header("Idempotency-Key", idempotencyKey)
        .body(toRequest(command))
        .retrieve()
        .body(CreatePaymentResponse.class);
}
```

Prinsip:

```text
Retry adalah keputusan correctness, bukan hanya reliability.
```

---

## 12. Circuit Breaker, Rate Limiter, Bulkhead

Spring sendiri menyediakan integrasi dengan ekosistem resilience seperti Resilience4j melalui Spring Cloud Circuit Breaker atau integrasi langsung.

### 12.1 Circuit Breaker

Circuit breaker berguna ketika downstream mengalami kegagalan tinggi.

State mental model:

```text
CLOSED      → normal call
OPEN        → reject cepat, jangan panggil downstream
HALF_OPEN   → coba sebagian call untuk cek recovery
```

Gunanya:

- melindungi aplikasi;
- melindungi downstream;
- mengurangi tail latency;
- menghindari thread starvation.

Risiko:

- fallback salah bisa menyembunyikan data stale;
- threshold terlalu sensitif membuat false open;
- per-endpoint breaker lebih baik daripada global breaker terlalu kasar;
- breaker harus punya metrics.

### 12.2 Rate Limiter

Rate limiter berguna ketika:

- downstream punya quota;
- external API membatasi request per minute;
- cost per request mahal;
- ingin fairness antar tenant.

Rate limit bisa:

- per application instance;
- distributed via Redis;
- per tenant;
- per downstream;
- per operation.

### 12.3 Bulkhead

Bulkhead mencegah satu downstream menghabiskan semua resource.

Contoh:

```text
Thread pool utama: 200
Payment client bulkhead: 30
Notification client bulkhead: 20
Report client bulkhead: 10
```

Tanpa bulkhead, satu downstream lambat bisa menghabiskan semua thread.

---

## 13. Error Mapping: External Failure to Internal Semantics

Jangan biarkan exception external mentah naik ke application service.

Buruk:

```java
throw new WebClientResponseException(...)
```

lalu domain service harus tahu HTTP status provider.

Lebih baik:

```java
sealed interface PaymentGatewayFailure permits
    PaymentGatewayFailure.NotFound,
    PaymentGatewayFailure.RateLimited,
    PaymentGatewayFailure.TemporarilyUnavailable,
    PaymentGatewayFailure.InvalidProviderResponse {

    record NotFound(String paymentId) implements PaymentGatewayFailure {}
    record RateLimited(Duration retryAfter) implements PaymentGatewayFailure {}
    record TemporarilyUnavailable(String reason) implements PaymentGatewayFailure {}
    record InvalidProviderResponse(String reason) implements PaymentGatewayFailure {}
}
```

Atau exception internal:

```java
class PaymentProviderUnavailableException extends RuntimeException {
    PaymentProviderUnavailableException(String provider, Throwable cause) {
        super("Payment provider unavailable: " + provider, cause);
    }
}
```

### 13.1 Mapping Table

| External Condition | Internal Meaning | Action |
|---|---|---|
| 404 payment not found | provider has no record | map to NotFound if valid business case |
| 401 | credential/token issue | refresh once or fail operationally |
| 403 | integration misconfiguration/permission | alert, do not retry blindly |
| 409 | state conflict | domain-aware resolution |
| 429 | quota/rate limited | backoff, respect Retry-After |
| 5xx | provider unavailable | retry if safe, circuit breaker |
| invalid JSON | contract mismatch | alert, fail fast |
| timeout | unknown outcome | retry only if idempotent |

---

## 14. Authentication and Authorization for Outbound Calls

Outbound HTTP often needs:

- API key;
- bearer token;
- OAuth2 client credentials;
- user token relay;
- mTLS;
- signed request;
- custom HMAC;
- session cookie for legacy system.

### 14.1 API Key

```java
RestClient client = builder
    .baseUrl(properties.baseUrl())
    .defaultHeader("X-API-Key", properties.apiKey())
    .build();
```

Risiko:

- key masuk log;
- key hardcoded;
- key sama untuk semua env;
- rotation tidak dipikirkan.

### 14.2 Bearer Token Static

```java
request.getHeaders().setBearerAuth(tokenProvider.currentToken());
```

Token provider harus menangani:

- caching;
- expiration;
- refresh;
- clock skew;
- concurrent refresh deduplication;
- failure metrics.

### 14.3 OAuth2 Client Credentials

Untuk service-to-service:

```text
service A
    → token endpoint
    → access token
    → downstream resource server
```

Engineering concern:

- token cache;
- retry token endpoint;
- avoid token request stampede;
- scope/audience correctness;
- secret rotation;
- 401 retry once after refresh;
- never infinite refresh loop.

### 14.4 User Token Relay

User token relay lebih sensitif:

```text
inbound user identity → outbound downstream call
```

Risiko:

- confused deputy;
- privilege propagation salah;
- leaking user token to wrong downstream;
- background job tidak punya user context;
- audit ambiguity.

Rule:

```text
Token relay harus explicit per downstream dan per use case.
Jangan semua outbound client otomatis meneruskan Authorization header.
```

---

## 15. Correlation ID and Context Propagation

Outbound client wajib meneruskan observability context.

Common headers:

```text
X-Correlation-ID
X-Request-ID
traceparent
tracestate
baggage
```

Jika memakai Micrometer Tracing/OpenTelemetry, trace context biasanya bisa dipropagasi otomatis oleh instrumentation, tetapi business correlation ID tetap sering butuh header eksplisit.

Interceptor contoh RestClient:

```java
final class CorrelationIdClientHttpRequestInterceptor implements ClientHttpRequestInterceptor {

    private final CorrelationIdProvider provider;

    CorrelationIdClientHttpRequestInterceptor(CorrelationIdProvider provider) {
        this.provider = provider;
    }

    @Override
    public ClientHttpResponse intercept(
        HttpRequest request,
        byte[] body,
        ClientHttpRequestExecution execution
    ) throws IOException {
        provider.currentCorrelationId()
            .ifPresent(id -> request.getHeaders().set("X-Correlation-ID", id));
        return execution.execute(request, body);
    }
}
```

Untuk WebClient:

```java
ExchangeFilterFunction correlationFilter(CorrelationIdProvider provider) {
    return (request, next) -> {
        ClientRequest.Builder builder = ClientRequest.from(request);
        provider.currentCorrelationId()
            .ifPresent(id -> builder.header("X-Correlation-ID", id));
        return next.exchange(builder.build());
    };
}
```

Catatan:

- ThreadLocal tidak otomatis aman di reactive pipeline;
- virtual threads juga tetap butuh context strategy yang jelas;
- jangan mengandalkan MDC sebagai satu-satunya source of truth.

---

## 16. Request and Response DTO Boundary

External DTO sebaiknya tidak menjadi domain DTO.

Buruk:

```java
class CaseService {
    void process(PaymentProviderResponse response) {
        // domain logic directly depends on provider response shape
    }
}
```

Lebih baik:

```java
record PaymentProviderResponse(
    String status,
    String providerReference,
    String updatedAt
) {}

record PaymentProviderStatus(
    PaymentState state,
    String externalReference,
    Instant observedAt
) {}

@Component
final class PaymentProviderMapper {

    PaymentProviderStatus toDomain(PaymentProviderResponse response) {
        return new PaymentProviderStatus(
            mapState(response.status()),
            response.providerReference(),
            Instant.parse(response.updatedAt())
        );
    }
}
```

Prinsip:

```text
External DTO mengikuti provider.
Internal model mengikuti kebutuhan sistem.
Mapper adalah anti-corruption layer.
```

---

## 17. JSON Serialization and Deserialization Risk

Outbound client sering gagal karena JSON contract berubah.

Risiko:

- field baru;
- field hilang;
- enum value baru;
- date format berubah;
- number jadi string;
- nullable field;
- polymorphic payload;
- error body berbeda dari success body.

Strategi:

1. DTO external harus explicit.
2. Unknown field handling harus diputuskan.
3. Enum unknown value harus dipikirkan.
4. Date/time harus pakai ISO atau formatter explicit.
5. Error body punya DTO sendiri.
6. Contract test harus ada untuk provider penting.

Contoh enum defensif:

```java
enum ProviderPaymentStatus {
    PAID,
    PENDING,
    FAILED,
    UNKNOWN;

    static ProviderPaymentStatus from(String value) {
        try {
            return ProviderPaymentStatus.valueOf(value.toUpperCase(Locale.ROOT));
        } catch (RuntimeException ex) {
            return UNKNOWN;
        }
    }
}
```

Untuk status yang mempengaruhi uang/legal decision, jangan silent unknown. Lebih aman fail closed:

```text
Unknown provider status → manual review / integration error
```

---

## 18. Large Payload and Streaming

Jangan semua response diload ke memory.

Masalah:

```java
byte[] file = restClient.get()
    .uri("/large-report")
    .retrieve()
    .body(byte[].class);
```

Untuk file besar, gunakan streaming extraction.

Dengan `RestTemplate`, bisa memakai `execute`:

```java
restTemplate.execute(
    url,
    HttpMethod.GET,
    null,
    response -> {
        try (InputStream in = response.getBody();
             OutputStream out = Files.newOutputStream(target)) {
            in.transferTo(out);
        }
        return target;
    }
);
```

Dengan WebClient, gunakan data buffer stream dengan hati-hati:

```java
Flux<DataBuffer> buffers = webClient.get()
    .uri("/large-report")
    .retrieve()
    .bodyToFlux(DataBuffer.class);
```

Perhatikan:

- memory limit;
- backpressure;
- temporary file cleanup;
- checksum;
- timeout lebih panjang tapi bounded;
- resume support jika perlu;
- virus scanning/security jika file dari external system.

---

## 19. Observability for HTTP Clients

Outbound call harus terukur minimal:

- downstream name;
- operation name;
- method;
- status outcome;
- latency;
- timeout count;
- retry count;
- circuit breaker state;
- rate limit rejection;
- error type;
- request size/response size jika relevan;
- trace ID;
- correlation ID.

### 19.1 Hindari High Cardinality Tag

Buruk:

```text
uri=/payments/123456789/status
```

Lebih baik:

```text
uri=/payments/{paymentId}/status
```

High cardinality akan merusak metrics backend.

### 19.2 Log yang Aman

Jangan log:

- Authorization header;
- API key;
- cookie;
- full personal data;
- full request body pembayaran/PII;
- raw error body tanpa redaction.

Log yang baik:

```text
paymentClient getStatus failed
provider=PaymentProviderA
operation=getStatus
httpStatus=503
errorType=provider_unavailable
correlationId=...
latencyMs=812
retryAttempt=2
```

---

## 20. Testing HTTP Clients

### 20.1 Unit Test Mapper

Mapper external DTO ke internal model harus diuji tanpa Spring context.

```java
class PaymentProviderMapperTest {

    @Test
    void mapsPaidStatus() {
        PaymentProviderMapper mapper = new PaymentProviderMapper();

        PaymentProviderStatus result = mapper.toDomain(
            new PaymentProviderResponse("PAID", "ext-1", "2026-06-21T10:15:30Z")
        );

        assertThat(result.state()).isEqualTo(PaymentState.PAID);
    }
}
```

### 20.2 Mock HTTP Server Test

Gunakan mock HTTP server untuk memverifikasi:

- path;
- method;
- headers;
- body;
- query params;
- response mapping;
- error mapping;
- timeout behavior jika memungkinkan.

Untuk `RestTemplate`, Spring menyediakan `MockRestServiceServer`.

```java
MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();

server.expect(requestTo("https://payment.example.com/payments/p-1/status"))
    .andExpect(method(HttpMethod.GET))
    .andRespond(withSuccess("{\"status\":\"PAID\"}", MediaType.APPLICATION_JSON));
```

Untuk `WebClient`, opsi umum:

- mock `ExchangeFunction`;
- mock web server;
- WireMock;
- Testcontainers dengan fake provider;
- contract test.

### 20.3 Contract Test

Untuk downstream kritikal, test bukan hanya client logic.

Test harus menjawab:

```text
Apakah request kita masih sesuai contract provider?
Apakah response provider masih bisa kita parse?
Apakah error body provider masih bisa kita mapping?
Apakah enum/date/nullability berubah?
```

Contract test bisa consumer-driven atau provider-driven.

### 20.4 Avoid Over-Mocking

Jika hanya mock Java interface:

```java
when(paymentHttpApi.getStatus("p-1")).thenReturn(...)
```

maka Anda tidak menguji:

- URL;
- HTTP method;
- header;
- serialization;
- deserialization;
- error body;
- status mapping.

Mock interface berguna untuk application service test, tetapi client adapter tetap butuh HTTP-level test.

---

## 21. Pattern: Typed Client + Adapter + Port

Recommended layering:

```text
application service
    ↓
port interface
    ↓
adapter implementation
    ↓
typed HTTP client
    ↓
RestClient/WebClient/HTTP Interface
```

Contoh lengkap ringkas:

```java
public interface AddressLookupGateway {
    AddressLookupResult lookupPostalCode(PostalCode postalCode);
}
```

```java
@Component
final class HttpAddressLookupGateway implements AddressLookupGateway {

    private final AddressLookupApi api;
    private final AddressLookupMapper mapper;

    HttpAddressLookupGateway(AddressLookupApi api, AddressLookupMapper mapper) {
        this.api = api;
        this.mapper = mapper;
    }

    @Override
    public AddressLookupResult lookupPostalCode(PostalCode postalCode) {
        try {
            AddressLookupResponse response = api.lookup(postalCode.value());
            return mapper.toResult(response);
        } catch (AddressProviderRateLimitedException ex) {
            throw new AddressLookupTemporarilyUnavailableException(ex);
        } catch (AddressProviderInvalidResponseException ex) {
            throw new AddressLookupFailedException("Invalid provider response", ex);
        }
    }
}
```

```java
@HttpExchange("/addresses")
interface AddressLookupApi {

    @GetExchange("/postal/{postalCode}")
    AddressLookupResponse lookup(@PathVariable String postalCode);
}
```

Prinsip:

```text
Application service tidak tahu HTTP.
HTTP adapter tidak memutuskan business workflow.
Mapper tidak melakukan network call.
Client tidak berisi domain policy berat.
```

---

## 22. Anti-Patterns

### 22.1 New Client per Request

```java
new RestTemplate().getForObject(...)
```

Masalah:

- tidak reuse config;
- tidak reuse connection pool;
- observability hilang;
- timeout default tidak jelas.

### 22.2 No Timeout

```java
RestClient.create("https://api.example.com")
```

tanpa underlying timeout policy.

Masalah:

- thread starvation;
- request menggantung;
- cascading failure.

### 22.3 Retry Everything

```text
retry all exceptions 5 times
```

Masalah:

- memperparah outage;
- duplicate side effect;
- melewati SLA;
- downstream makin overload.

### 22.4 External DTO Leakage

```java
PaymentProviderResponse response = paymentClient.getStatus(id);
caseEntity.setPaymentStatus(response.status());
```

Masalah:

- provider vocabulary masuk ke domain;
- migrasi provider sulit;
- unknown enum bisa merusak state.

### 22.5 Blocking in Reactive Pipeline

```java
mono.map(x -> restClient.get()...body(...))
```

atau:

```java
webClient.get()...block()
```

di event loop.

Masalah:

- event loop blocked;
- throughput collapse.

### 22.6 Silent Fallback

```java
catch (Exception ex) {
    return PaymentStatus.PAID;
}
```

Ini bukan resilience. Ini data corruption.

Fallback harus business-safe.

### 22.7 Logging Sensitive Data

```java
log.info("Request body: {}", request);
log.info("Headers: {}", headers);
```

Masalah:

- token leakage;
- PII leakage;
- compliance incident.

### 22.8 One Global Client for All Downstreams

Satu client dengan satu timeout/retry policy untuk semua provider biasanya salah.

Setiap downstream punya:

- SLA berbeda;
- auth berbeda;
- retry semantics berbeda;
- payload size berbeda;
- failure handling berbeda.

---

## 23. Production Checklist

Sebelum HTTP client dianggap production-ready:

### Contract

- [ ] Ada typed client atau adapter khusus per downstream.
- [ ] External DTO tidak bocor ke domain core.
- [ ] Error body dimapping.
- [ ] Unknown enum/nullability dipikirkan.
- [ ] Versioning downstream jelas.

### Timeout and Pool

- [ ] Connect timeout eksplisit.
- [ ] Response/read timeout eksplisit.
- [ ] Pool size eksplisit jika memakai pooling.
- [ ] Acquisition timeout eksplisit.
- [ ] Timeout sesuai inbound SLA.

### Retry and Resilience

- [ ] Retry hanya untuk operation aman.
- [ ] Idempotency key untuk retry POST jika perlu.
- [ ] Backoff ada.
- [ ] Max attempts bounded.
- [ ] Circuit breaker/rate limiter/bulkhead dipertimbangkan.
- [ ] `Retry-After` dihormati untuk 429/503 jika relevan.

### Security

- [ ] Token/API key tidak hardcoded.
- [ ] Secret tidak masuk log.
- [ ] Token refresh strategy jelas.
- [ ] mTLS/TLS config jika perlu.
- [ ] User token relay explicit.

### Observability

- [ ] Metrics per downstream dan operation.
- [ ] Trace propagation aktif.
- [ ] Correlation ID diteruskan.
- [ ] Log error aman dan structured.
- [ ] High-cardinality tags dihindari.

### Testing

- [ ] Mapper unit tested.
- [ ] HTTP-level client test ada.
- [ ] Error mapping tested.
- [ ] Timeout/retry behavior tested minimal untuk critical provider.
- [ ] Contract test untuk downstream kritikal.

### Operations

- [ ] Config per environment.
- [ ] Base URL tidak hardcoded.
- [ ] Feature flag/fallback strategy jika perlu.
- [ ] Dashboard downstream latency/error.
- [ ] Alert untuk error rate/timeout/rate limit.
- [ ] Runbook outage downstream.

---

## 24. Java 8–25 Practical Guidance

### Java 8 / Spring 5 Legacy

Gunakan:

- `RestTemplate` dengan builder/config central;
- Apache HttpClient/OkHttp jika butuh pool/timeout advanced;
- explicit error handler;
- wrapper adapter;
- contract tests.

Jangan:

- membuat `new RestTemplate()` per call;
- menganggap default timeout aman;
- mencampur WebClient tanpa skill reactive.

### Java 17 / Spring 6 / Boot 3

Gunakan:

- `RestClient` untuk synchronous client baru;
- `WebClient` untuk reactive/non-blocking;
- HTTP interface untuk declarative clients;
- Micrometer Observation;
- config properties untuk per-client config.

### Java 21–25 / Spring 7 / Boot 4

Gunakan:

- `RestClient` + HTTP interface sebagai default synchronous modern;
- virtual threads untuk MVC blocking workload jika sesuai;
- WebClient untuk streaming/reactive composition;
- stronger platform-level starter untuk outbound clients;
- clear migration path dari `RestTemplate`.

Peringatan:

```text
Virtual threads membuat blocking lebih murah,
tetapi tidak menghilangkan kebutuhan timeout, pool, backpressure, dan downstream protection.
```

---

## 25. Review Rubric untuk Senior/Staff Engineer

Ketika review PR HTTP client, jangan hanya lihat apakah kode compile.

Tanyakan:

1. Apakah client ini punya owner/domain jelas?
2. Apakah base URL, timeout, auth, retry berasal dari config?
3. Apakah operation ini aman di-retry?
4. Apakah ada idempotency key?
5. Apa yang terjadi jika downstream timeout?
6. Apa yang terjadi jika downstream return 429?
7. Apa yang terjadi jika response body berubah?
8. Apakah external DTO bocor ke service/domain?
9. Apakah error provider dimapping ke internal semantics?
10. Apakah observability cukup untuk incident?
11. Apakah log aman dari secret/PII?
12. Apakah test memverifikasi HTTP method/path/header/body?
13. Apakah connection pool bisa habis?
14. Apakah downstream bisa dihantam retry storm?
15. Apakah call ini berada di transaction boundary yang salah?
16. Apakah call ini dilakukan di event loop?
17. Apakah fallback business-safe?
18. Apakah behavior berbeda antar environment?
19. Apakah provider SLA kompatibel dengan inbound SLA?
20. Apakah ada runbook jika downstream outage?

---

## 26. Mental Model Akhir

Spring HTTP client engineering bukan tentang memilih `RestTemplate`, `RestClient`, `WebClient`, atau HTTP interface secara stylistic.

Ia tentang memodelkan boundary:

```text
Internal certainty
    bertemu
External uncertainty
```

HTTP call selalu memiliki uncertainty:

- request mungkin tidak sampai;
- response mungkin tidak kembali;
- server mungkin sudah memproses walau client timeout;
- body bisa berubah;
- token bisa expired;
- network bisa lambat;
- downstream bisa overload;
- retry bisa menduplikasi side effect;
- fallback bisa membuat data salah;
- log bisa membocorkan data.

Engineer top-tier tidak hanya menulis:

```java
client.get().uri(...).retrieve().body(...)
```

Engineer top-tier mendesain:

```text
contract
+ timeout
+ retry semantics
+ idempotency
+ error mapping
+ security
+ observability
+ testing
+ operational recovery
```

Itulah perbedaan antara “bisa call API” dan “bisa membangun integration boundary yang bertahan di production”.

---

## 27. Ringkasan Part 15

Kita telah membahas:

1. evolusi HTTP client Spring dari `RestTemplate` ke `RestClient`, `WebClient`, dan HTTP interface;
2. kapan memilih client yang tepat;
3. outbound client sebagai adapter, bukan utility;
4. timeout taxonomy;
5. connection pooling;
6. retry dan idempotency;
7. circuit breaker, rate limiter, bulkhead;
8. error mapping external-to-internal;
9. authentication dan token propagation;
10. correlation ID dan observability;
11. DTO boundary;
12. large payload/streaming;
13. testing strategy;
14. anti-pattern umum;
15. checklist production readiness;
16. guidance Java 8–25.

Part berikutnya akan masuk ke:

```text
16-validation-binding-conversion-data-boundary.md
```

Fokusnya adalah bagaimana Spring mengubah input mentah menjadi object aplikasi melalui conversion, binding, validation, method validation, dan data boundary yang aman.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./14-webflux-reactive-spring-architecture.md">⬅️ Part 14 — WebFlux and Reactive Spring Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./16-validation-binding-conversion-data-boundary.md">Part 16 — Validation, Binding, Conversion, and Data Boundary ➡️</a>
</div>
