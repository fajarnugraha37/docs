# Part 30 — Migration Patterns: Legacy Client ke Modern Client

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `30-migration-patterns-legacy-client-to-modern-client.md`  
Target Java: 8 sampai 25  
Level: Advanced / production engineering

---

## 0. Tujuan Part Ini

Part ini membahas **cara memigrasikan HTTP client lama ke HTTP client modern secara aman**.

Yang dimaksud migrasi bukan hanya:

```java
// lama
HttpURLConnection connection = (HttpURLConnection) url.openConnection();

// baru
HttpClient client = HttpClient.newHttpClient();
```

Migrasi seperti itu terlalu dangkal. Dalam sistem production, HTTP client biasanya membawa banyak perilaku tersembunyi:

- timeout default,
- retry otomatis,
- redirect policy,
- proxy,
- cookie,
- TLS truststore,
- connection pooling,
- DNS cache,
- error mapping,
- body buffering,
- auth header,
- token refresh,
- logging,
- tracing,
- metric,
- custom exception,
- fallback,
- dan operational workaround yang tidak selalu terdokumentasi.

Karena itu, migrasi HTTP client harus diperlakukan sebagai **migration of behavior**, bukan hanya **migration of API**.

Tujuan akhirnya:

1. Mengganti client lama tanpa mengubah behavior bisnis secara tidak sengaja.
2. Memperbaiki kelemahan lama secara bertahap, bukan sekaligus membuat big-bang rewrite.
3. Membuat boundary client lebih eksplisit: timeout, retry, auth, error model, observability, security.
4. Menjaga rollback tetap mungkin.
5. Menghindari incident akibat perbedaan kecil seperti redirect, encoding, connection reuse, atau body close semantics.

---

## 1. Prinsip Utama: Jangan Migrasi Library, Migrasi Kontrak

Kesalahan paling umum adalah memulai dari pertanyaan:

> “Kita mau ganti `RestTemplate` ke `WebClient` atau `RestClient`?”

Pertanyaan yang lebih benar:

> “Kontrak outbound client kita apa, behavior production-nya apa, dan bagian mana yang harus dipertahankan, diperbaiki, atau dibuang?”

HTTP client lama biasanya sudah menjadi bagian dari kontrak sistem, bahkan jika tidak pernah ditulis secara eksplisit.

Contoh kontrak tersembunyi:

```text
- jika downstream timeout, caller mendapat ExternalServiceUnavailableException
- request POST tidak pernah di-retry
- 401 pertama akan trigger token refresh sekali
- 404 dianggap empty result untuk endpoint tertentu
- 409 dianggap business conflict, bukan technical failure
- response body maksimal 10 MB
- timeout 5 detik termasuk token refresh
- semua request membawa correlation-id
- proxy dipakai hanya di environment intranet
- redirect tidak boleh follow ke host berbeda
```

Jika kontrak ini hilang saat migrasi, sistem bisa tetap compile dan test sederhana bisa tetap hijau, tetapi production behavior berubah.

### Mental model migrasi

```text
legacy call site
    ↓
implicit behavior discovery
    ↓
explicit client contract
    ↓
compatibility wrapper
    ↓
new transport implementation
    ↓
shadow / dual validation
    ↓
progressive rollout
    ↓
cleanup legacy behavior
```

---

## 2. Legacy Client yang Umum Ditemui

### 2.1 `HttpURLConnection`

Biasanya ditemukan di aplikasi lama Java 6/7/8.

Karakteristik:

- API rendah level.
- Banyak boilerplate.
- Timeout harus diset manual.
- Body stream harus ditutup benar.
- Error stream perlu dibaca terpisah.
- Connection reuse bergantung pada cara stream dikonsumsi.
- Sulit observability.
- Sulit testability.

Contoh legacy:

```java
URL url = new URL(baseUrl + "/customers/" + customerId);
HttpURLConnection connection = (HttpURLConnection) url.openConnection();
connection.setRequestMethod("GET");
connection.setConnectTimeout(3000);
connection.setReadTimeout(5000);
connection.setRequestProperty("Authorization", "Bearer " + token);

int status = connection.getResponseCode();
InputStream stream = status >= 400
        ? connection.getErrorStream()
        : connection.getInputStream();

String body = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
```

Masalah utama:

- URL dibuat via string concatenation.
- Tidak ada typed DTO boundary.
- Error handling tersebar.
- Stream lifecycle rawan leak.
- Tidak ada central policy.

### 2.2 Apache HttpClient 4.x

Banyak dipakai di enterprise Java 8.

Karakteristik:

- Lebih kuat daripada `HttpURLConnection`.
- Pooling connection manager tersedia.
- Banyak custom config.
- Tetapi API package berbeda dari HttpClient 5.
- Banyak codebase punya wrapper sendiri.

Migrasi ke Apache 5 tidak selalu trivial karena namespace berubah dari `org.apache.http.*` ke `org.apache.hc.*`, dan beberapa konsep/config API ikut berubah.

### 2.3 Spring `RestTemplate`

Masih banyak dipakai.

Karakteristik:

- Synchronous.
- Familiar.
- Bisa memakai berbagai underlying request factory.
- Mudah dipakai, tetapi sering membuat HTTP concern tersebar di service layer.
- Spring modern menyediakan `RestClient` sebagai synchronous fluent API baru.

### 2.4 Custom `HttpClientUtil`

Ini sering lebih berbahaya daripada library legacy.

Contoh bentuk:

```java
public class HttpClientUtil {
    public static String get(String url) { ... }
    public static String postJson(String url, String body) { ... }
}
```

Masalah:

- Static global behavior.
- Sulit test.
- Tidak ada per-downstream policy.
- Tidak ada typed error.
- Timeout/retry/logging tersembunyi.
- Sering bocor credential di log.

### 2.5 Generated Client Lama

Misalnya generated OpenAPI/Swagger client lama.

Masalah umum:

- DTO generated dipakai langsung di domain.
- Transport setting tersembunyi.
- Error body tidak diparse konsisten.
- Regeneration risk tinggi.
- Custom patch manual di generated code.

### 2.6 Reactive Client yang Dipakai Secara Salah

Contoh:

```java
webClient.get()
    .uri("/customers/{id}", id)
    .retrieve()
    .bodyToMono(CustomerDto.class)
    .block();
```

Masalah bukan `.block()` itu selalu salah, tetapi sering terjadi:

- reactive stack dipakai di blocking application tanpa alasan jelas,
- timeout tidak eksplisit,
- event loop terblokir,
- retry reactive tersembunyi,
- error handling sulit dibaca,
- thread model tidak dipahami.

---

## 3. Target Modern Client: Pilihan dan Trade-Off

Tidak ada satu client terbaik untuk semua kasus.

### 3.1 Target: JDK `java.net.http.HttpClient`

Cocok jika:

- ingin dependency minimal,
- Java 11+,
- kebutuhan HTTP cukup standar,
- ingin sync/async built-in,
- tidak perlu fitur advanced seperti Retrofit interface atau OkHttp interceptor ecosystem.

Kelebihan:

- bawaan JDK,
- immutable reusable client,
- HTTP/1.1 dan HTTP/2,
- `send` dan `sendAsync`,
- integrasi `CompletableFuture`,
- cocok dengan virtual threads untuk blocking call.

Kekurangan:

- observability perlu wrapper sendiri,
- retry/rate/circuit perlu dibangun sendiri atau via Resilience4j/Failsafe,
- tidak seergonomis Retrofit untuk typed API interface,
- tidak sekaya Apache untuk enterprise route/pool controls tertentu.

### 3.2 Target: OkHttp

Cocok jika:

- butuh HTTP engine kuat,
- butuh interceptor chain,
- butuh `EventListener`,
- butuh TLS/certificate pinning yang ergonomic,
- memakai Retrofit,
- butuh behavior efisien dengan pooling dan HTTP/2.

Kelebihan:

- simple tapi kuat,
- connection pooling matang,
- interceptor sangat berguna,
- MockWebServer excellent untuk testing,
- cocok sebagai transport engine internal SDK.

Kekurangan:

- dependency tambahan,
- beberapa behavior otomatis perlu dipahami,
- API Kotlin-first di versi modern, meskipun Java tetap bisa.

### 3.3 Target: Retrofit

Cocok jika:

- external API punya banyak endpoint,
- ingin type-safe interface,
- ingin converter/call adapter,
- ingin boundary deklaratif.

Kelebihan:

- interface-driven,
- annotation jelas,
- cocok untuk SDK style,
- mudah test dengan MockWebServer,
- berdiri di atas OkHttp.

Kekurangan:

- bukan transport engine sendiri,
- error model default belum tentu sesuai domain,
- annotation bisa menyembunyikan runtime behavior,
- dynamic endpoint/multi-tenant harus dirancang hati-hati.

### 3.4 Target: Apache HttpClient 5

Cocok jika:

- enterprise stack sudah memakai Apache,
- butuh classic blocking dan async option,
- butuh connection manager detail,
- butuh proxy/route/TLS customization kuat,
- migrasi dari Apache 4.x.

Kelebihan:

- konfigurasi granular,
- per-route/total pool control,
- mature enterprise capability,
- migration path dari 4.x.

Kekurangan:

- API lebih kompleks,
- code bisa verbose,
- butuh discipline agar config tidak tersebar.

### 3.5 Target: Spring `RestClient`

Cocok jika:

- aplikasi Spring modern,
- ingin synchronous fluent API,
- ingin menggantikan `RestTemplate` tanpa pindah ke reactive,
- ingin integrasi conversion/observability Spring.

Kelebihan:

- modern synchronous API,
- familiar untuk Spring developer,
- bisa memakai underlying JDK/Apache/etc,
- migration dari `RestTemplate` relatif natural.

Kekurangan:

- tetap abstraction layer, bukan magic,
- underlying engine tetap harus dikonfigurasi,
- error mapping default perlu distandardisasi.

### 3.6 Target: Spring `WebClient`

Cocok jika:

- aplikasi reactive end-to-end,
- butuh non-blocking high concurrency,
- sudah memakai Reactor,
- streaming use case.

Kelebihan:

- reactive composition,
- backpressure model,
- cocok untuk streaming dan async pipeline.

Kekurangan:

- kompleksitas mental model tinggi,
- mismatch jika dipakai di aplikasi blocking tanpa pemahaman,
- debugging/cancellation bisa lebih sulit.

---

## 4. Migration Smell: Tanda Migrasi Akan Bermasalah

Migrasi berisiko tinggi jika ditemukan tanda berikut:

```text
- call HTTP tersebar langsung di service/domain layer
- timeout tidak terdokumentasi
- retry dilakukan di banyak tempat
- error 4xx/5xx diperlakukan tidak konsisten
- ada custom token refresh tanpa lock/single-flight
- body response tidak selalu ditutup
- URL dibangun dengan string concatenation
- credential muncul di log
- generated DTO dipakai sebagai domain object
- tidak ada contract test terhadap external API
- tidak ada metric per downstream
- tidak ada feature flag untuk rollout
- tidak ada rollback strategy
```

Semakin banyak smell, semakin migrasi tidak boleh dilakukan dengan big-bang rewrite.

---

## 5. Inventory Sebelum Migrasi

Sebelum menulis target client baru, lakukan inventory.

### 5.1 Inventory Call Site

Buat daftar semua outbound call:

| Item | Yang Dicatat |
|---|---|
| Downstream | Nama sistem/API |
| Endpoint | Method + path |
| Caller | Class/use case yang memanggil |
| Request body | JSON/form/multipart/stream |
| Response body | DTO/error model |
| Auth | Basic/Bearer/API key/mTLS/HMAC |
| Timeout | connect/read/call |
| Retry | jumlah, backoff, status/exception |
| Error mapping | exception/result |
| SLA | expected latency/failure tolerance |
| Observability | log/metric/trace |
| Side effect | read-only atau mutating |
| Idempotency | safe to retry atau tidak |

### 5.2 Inventory Behavior Tersembunyi

Cari behavior yang tidak terlihat dari call site.

Contoh:

```text
- RestTemplate memakai default SimpleClientHttpRequestFactory atau Apache factory?
- Apakah connection pooling aktif?
- Apakah redirect otomatis?
- Apakah cookie tersimpan?
- Apakah proxy otomatis dari JVM property?
- Apakah DNS cache forever?
- Apakah error stream dibaca?
- Apakah gzip otomatis didecompress?
- Apakah interceptor menambah Authorization header?
- Apakah retry otomatis library aktif?
```

### 5.3 Inventory Runtime Metrics

Sebelum migrasi, kumpulkan baseline:

```text
- request rate per downstream
- latency P50/P95/P99
- timeout count
- status code distribution
- retry count
- circuit breaker state jika ada
- pool active/idle/pending jika tersedia
- thread usage
- connection reset count
- TLS handshake error
- DNS/connect failure
```

Tanpa baseline, setelah migrasi Anda tidak tahu apakah sistem membaik atau memburuk.

---

## 6. Strategi Migration: Big-Bang vs Strangler

### 6.1 Big-Bang Migration

Big-bang berarti semua call langsung diganti.

Cocok jika:

- code kecil,
- endpoint sedikit,
- behavior sederhana,
- test coverage kuat,
- rollback mudah,
- tidak critical.

Tidak cocok jika:

- banyak endpoint,
- high traffic,
- critical business flow,
- banyak custom retry/auth/error,
- tidak ada observability.

### 6.2 Strangler Migration

Strangler berarti membuat abstraction baru lalu memindahkan endpoint satu per satu.

```text
legacy call site
    ↓
new port/interface
    ↓
legacy adapter OR new adapter
    ↓
feature flag / routing decision
```

Contoh:

```java
public interface PaymentGateway {
    PaymentStatus getPaymentStatus(PaymentId paymentId);
    PaymentSubmissionResult submitPayment(PaymentCommand command);
}
```

Implementasi pertama masih memakai legacy client:

```java
public final class LegacyPaymentGateway implements PaymentGateway {
    // wraps RestTemplate / HttpURLConnection / old generated client
}
```

Implementasi baru memakai client modern:

```java
public final class ModernPaymentGateway implements PaymentGateway {
    // wraps JDK HttpClient / OkHttp / Retrofit / RestClient
}
```

Routing:

```java
public final class SwitchablePaymentGateway implements PaymentGateway {
    private final PaymentGateway legacy;
    private final PaymentGateway modern;
    private final FeatureFlag flags;

    @Override
    public PaymentStatus getPaymentStatus(PaymentId paymentId) {
        if (flags.useModernPaymentStatusClient()) {
            return modern.getPaymentStatus(paymentId);
        }
        return legacy.getPaymentStatus(paymentId);
    }

    @Override
    public PaymentSubmissionResult submitPayment(PaymentCommand command) {
        if (flags.useModernPaymentSubmitClient()) {
            return modern.submitPayment(command);
        }
        return legacy.submitPayment(command);
    }
}
```

Ini membuat migrasi per capability, bukan per library.

---

## 7. Compatibility Wrapper Pattern

Pattern paling aman: buat wrapper yang mempertahankan kontrak lama tetapi memakai engine baru di dalamnya.

### 7.1 Sebelum

```java
public CustomerDto findCustomer(String id) {
    ResponseEntity<CustomerDto> response = restTemplate.getForEntity(
            baseUrl + "/customers/" + id,
            CustomerDto.class
    );
    return response.getBody();
}
```

Masalah:

- URL concat.
- HTTP detail di service.
- Tidak ada error taxonomy.
- Tidak jelas timeout/retry/auth.

### 7.2 Sesudah: Port

```java
public interface CustomerDirectoryPort {
    CustomerSnapshot getCustomer(CustomerId id);
}
```

### 7.3 Adapter dengan kontrak eksplisit

```java
public final class CustomerDirectoryHttpAdapter implements CustomerDirectoryPort {
    private final CustomerDirectoryClient client;
    private final CustomerDirectoryMapper mapper;

    public CustomerDirectoryHttpAdapter(
            CustomerDirectoryClient client,
            CustomerDirectoryMapper mapper
    ) {
        this.client = client;
        this.mapper = mapper;
    }

    @Override
    public CustomerSnapshot getCustomer(CustomerId id) {
        ExternalCustomerResponse response = client.getCustomer(id.value());
        return mapper.toDomain(response);
    }
}
```

### 7.4 Transport client tersembunyi di bawah adapter

```java
public interface CustomerDirectoryClient {
    ExternalCustomerResponse getCustomer(String externalId);
}
```

Dengan cara ini, migration dari RestTemplate ke JDK/OkHttp/Retrofit tidak menyentuh domain/application layer.

---

## 8. Preserving Behavior: Checklist Perbedaan Library

Saat pindah library, cek perbedaan ini.

### 8.1 Timeout

| Concern | Legacy Bisa Berbeda |
|---|---|
| Connect timeout | default bisa infinite atau OS-dependent |
| Read timeout | sering diset tapi tidak termasuk total call |
| Call timeout | OkHttp punya, JDK perlu request timeout/CF deadline |
| Pool acquisition timeout | Apache punya explicit concept |
| DNS timeout | jarang eksplisit |
| TLS handshake timeout | sering ikut connect/read tergantung library |

Jangan hanya copy angka.

Salah:

```text
RestTemplate readTimeout 5000 → OkHttp readTimeout 5000
```

Lebih benar:

```text
Operation deadline 5000 ms
- connect max 1000 ms
- write max 1000 ms
- response wait max 3000 ms
- retry hanya jika masih ada remaining deadline
```

### 8.2 Redirect

Library bisa berbeda dalam:

- follow redirect default,
- follow HTTPS → HTTP downgrade,
- preserve method pada 307/308,
- drop Authorization header saat host berubah,
- maximum redirects.

Migration wajib menetapkan policy:

```text
- redirect disabled by default untuk mutating request
- redirect allowed hanya same-host untuk GET tertentu
- Authorization tidak boleh dipropagasi ke host berbeda
- HTTPS downgrade ditolak
```

### 8.3 Error Handling

Legacy mungkin menganggap:

```text
404 → null
400 → validation error
409 → domain conflict
500 → retryable technical error
```

Target client baru jangan langsung throw generic exception.

Buat mapping eksplisit:

```java
sealed interface ExternalCallResult<T> permits ExternalCallResult.Success, ExternalCallResult.Failure {
    record Success<T>(T value) implements ExternalCallResult<T> {}
    record Failure<T>(ExternalFailure failure) implements ExternalCallResult<T> {}
}
```

Untuk Java 8, gunakan class hierarchy biasa.

### 8.4 Body Semantics

Perbedaan penting:

- response body harus ditutup manual atau otomatis,
- error body tersedia sekali baca,
- body stream repeatable atau non-repeatable,
- multipart boundary generation,
- charset default,
- gzip decompression.

### 8.5 URL Encoding

Migrasi bisa mengubah encoding.

Contoh bug:

```text
legacy path: /customers/A%2FB
new path:    /customers/A/B
```

Atau:

```text
legacy query: q=a+b
new query:    q=a%2Bb
```

Untuk endpoint signed/HMAC, perubahan encoding/order query bisa membuat signature invalid.

### 8.6 Header Behavior

Cek:

- header case normalization,
- duplicate header,
- default User-Agent,
- Accept-Encoding otomatis,
- Content-Length vs chunked,
- Authorization propagation,
- correlation ID.

### 8.7 Connection Pool

Migrasi dari no-pool ke pool bisa menaikkan performance, tetapi juga mengubah failure mode:

```text
no pooling:
- lebih lambat
- banyak connect/TLS
- risiko port exhaustion tinggi saat traffic besar

pooling:
- lebih cepat
- risiko stale connection
- perlu idle timeout alignment dengan LB
- bisa pool starvation jika response body leak
```

### 8.8 Retry

Cek apakah library lama punya retry otomatis.

Contoh:

- Apache bisa punya retry strategy.
- OkHttp `retryOnConnectionFailure` menangani beberapa connectivity recovery.
- Custom wrapper mungkin retry semua exception.

Saat migrasi, bedakan:

```text
transport recovery != semantic retry
```

---

## 9. Migration dari `HttpURLConnection` ke JDK `HttpClient`

### 9.1 Sebelum

```java
public String getCustomerRaw(String id) throws IOException {
    URL url = new URL(baseUrl + "/customers/" + URLEncoder.encode(id, "UTF-8"));
    HttpURLConnection c = (HttpURLConnection) url.openConnection();
    c.setRequestMethod("GET");
    c.setConnectTimeout(1000);
    c.setReadTimeout(3000);
    c.setRequestProperty("Accept", "application/json");

    int status = c.getResponseCode();
    InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
    return new String(in.readAllBytes(), StandardCharsets.UTF_8);
}
```

### 9.2 Masalah yang Harus Diperbaiki

- `URLEncoder` bukan general path encoder; lebih cocok untuk form/query semantics.
- Tidak ada total timeout.
- Error status tidak typed.
- Tidak ada metric.
- Stream close tidak terlihat.

### 9.3 Sesudah dengan JDK `HttpClient`

```java
public final class JdkCustomerClient {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final ObjectMapper objectMapper;

    public JdkCustomerClient(URI baseUri, ObjectMapper objectMapper) {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(1))
                .version(HttpClient.Version.HTTP_2)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        this.baseUri = baseUri;
        this.objectMapper = objectMapper;
    }

    public ExternalCustomerResponse getCustomer(String id) {
        URI uri = baseUri.resolve("/customers/" + encodePathSegment(id));

        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(4))
                .header("Accept", "application/json")
                .GET()
                .build();

        try {
            HttpResponse<String> response = httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );

            return handleResponse(response);
        } catch (HttpTimeoutException e) {
            throw new ExternalTimeoutException("customer-directory timeout", e);
        } catch (IOException e) {
            throw new ExternalTransportException("customer-directory transport failure", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ExternalInterruptedException("customer-directory interrupted", e);
        }
    }

    private ExternalCustomerResponse handleResponse(HttpResponse<String> response) throws IOException {
        int status = response.statusCode();
        String body = response.body();

        if (status == 200) {
            return objectMapper.readValue(body, ExternalCustomerResponse.class);
        }
        if (status == 404) {
            throw new ExternalNotFoundException("customer not found");
        }
        if (status >= 500) {
            throw new ExternalServerException("customer-directory server error: " + status);
        }
        throw new ExternalProtocolException("unexpected status from customer-directory: " + status);
    }

    private static String encodePathSegment(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
                .replace("+", "%20")
                .replace("%2F", "%2F");
    }
}
```

Catatan: contoh encoder di atas disederhanakan untuk pembelajaran. Untuk production, lebih baik gunakan URI builder yang benar atau library seperti OkHttp `HttpUrl` jika kompleks.

---

## 10. Migration dari `HttpURLConnection` ke OkHttp

### 10.1 Target

```java
public final class OkHttpCustomerClient {
    private final OkHttpClient client;
    private final HttpUrl baseUrl;
    private final ObjectMapper objectMapper;

    public OkHttpCustomerClient(HttpUrl baseUrl, ObjectMapper objectMapper) {
        this.client = new OkHttpClient.Builder()
                .connectTimeout(Duration.ofSeconds(1))
                .readTimeout(Duration.ofSeconds(3))
                .writeTimeout(Duration.ofSeconds(1))
                .callTimeout(Duration.ofSeconds(4))
                .followRedirects(false)
                .build();
        this.baseUrl = baseUrl;
        this.objectMapper = objectMapper;
    }

    public ExternalCustomerResponse getCustomer(String id) {
        HttpUrl url = baseUrl.newBuilder()
                .addPathSegment("customers")
                .addPathSegment(id)
                .build();

        Request request = new Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .get()
                .build();

        try (Response response = client.newCall(request).execute()) {
            ResponseBody body = response.body();
            String text = body == null ? "" : body.string();

            if (response.isSuccessful()) {
                return objectMapper.readValue(text, ExternalCustomerResponse.class);
            }
            if (response.code() == 404) {
                throw new ExternalNotFoundException("customer not found");
            }
            if (response.code() >= 500) {
                throw new ExternalServerException("customer-directory server error: " + response.code());
            }
            throw new ExternalProtocolException("unexpected status: " + response.code());
        } catch (IOException e) {
            throw new ExternalTransportException("customer-directory call failed", e);
        }
    }
}
```

Poin penting:

- `HttpUrl` mengurangi bug encoding.
- `try-with-resources` memastikan response ditutup.
- `callTimeout` memberi upper bound total call.
- Error mapping eksplisit.

---

## 11. Migration dari Apache HttpClient 4.x ke 5.x

Apache sendiri merekomendasikan migrasi ke HttpClient 5.x classic API sebagai langkah awal untuk pengguna 4.x, setelah memastikan 4.x sudah mengikuti best practice. Migration guide resmi juga membahas perubahan package/API dan recipe migration. citeturn979766search1turn979766search15

### 11.1 Perubahan Besar

| Apache 4.x | Apache 5.x |
|---|---|
| `org.apache.http.*` | `org.apache.hc.*` |
| `CloseableHttpClient` package lama | package baru |
| `RequestConfig` API berbeda | timeout memakai `Timeout` |
| SSL setup lama | TLS strategy/SSL context API baru |
| pooling manager lama | pooling manager 5.x |

### 11.2 Strategi Aman

Jangan langsung ubah semua call site.

Buat adapter:

```java
public interface ExternalHttpExecutor {
    ExternalHttpResponse execute(ExternalHttpRequest request);
}
```

Implementasi lama:

```java
public final class Apache4HttpExecutor implements ExternalHttpExecutor {
    // wraps old Apache 4 client
}
```

Implementasi baru:

```java
public final class Apache5HttpExecutor implements ExternalHttpExecutor {
    // wraps Apache 5 client
}
```

Setelah itu, pindahkan endpoint bertahap.

### 11.3 Hal yang Wajib Divalidasi

```text
- timeout equivalence
- pool max total/per route
- connection TTL
- idle eviction
- SSLContext/truststore
- proxy config
- cookie behavior
- retry behavior
- redirect behavior
- entity close/consume
- error body parse
```

### 11.4 Migration Smell

Bahaya jika code lama seperti ini tersebar:

```java
CloseableHttpClient client = HttpClients.createDefault();
```

Di setiap method.

Masalah:

- tidak reuse pool,
- resource leak,
- config tidak konsisten,
- sulit observability.

Targetnya:

```java
@Bean
CloseableHttpClient externalApiHttpClient(...) {
    // one configured client per downstream class of behavior
}
```

---

## 12. Migration dari `RestTemplate` ke `RestClient`

Spring mendokumentasikan `RestClient` sebagai synchronous HTTP client dengan fluent API di atas berbagai HTTP libraries, sementara `RestTemplate` adalah synchronous template-style client yang lebih lama dan masih dipakai banyak aplikasi existing. citeturn979766search2turn979766search7turn979766search8turn979766search9

### 12.1 Kapan Migrasi ke `RestClient`

Cocok jika:

```text
- aplikasi Spring MVC/blocking
- tidak perlu reactive end-to-end
- ingin API lebih modern
- ingin mempertahankan synchronous model
- ingin migration dari RestTemplate tanpa WebClient complexity
```

### 12.2 Sebelum

```java
ResponseEntity<CustomerDto> response = restTemplate.exchange(
        baseUrl + "/customers/{id}",
        HttpMethod.GET,
        new HttpEntity<>(headers),
        CustomerDto.class,
        id
);
```

### 12.3 Sesudah

```java
CustomerDto response = restClient.get()
        .uri("/customers/{id}", id)
        .accept(MediaType.APPLICATION_JSON)
        .retrieve()
        .body(CustomerDto.class);
```

### 12.4 Tapi Jangan Berhenti di Sini

Ini hanya migration syntax. Production migration perlu:

```java
public final class CustomerDirectoryRestClientAdapter implements CustomerDirectoryPort {
    private final RestClient restClient;

    @Override
    public CustomerSnapshot getCustomer(CustomerId id) {
        try {
            CustomerDto dto = restClient.get()
                    .uri("/customers/{id}", id.value())
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (request, response) -> {
                        if (response.getStatusCode().value() == 404) {
                            throw new ExternalNotFoundException("customer not found");
                        }
                        throw new ExternalClientErrorException("client error: " + response.getStatusCode());
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (request, response) -> {
                        throw new ExternalServerException("server error: " + response.getStatusCode());
                    })
                    .body(CustomerDto.class);

            return mapToDomain(dto);
        } catch (ResourceAccessException e) {
            throw new ExternalTransportException("customer-directory transport failure", e);
        }
    }
}
```

### 12.5 Underlying Engine Tetap Penting

`RestClient` bukan pengganti konfigurasi transport.

Anda tetap perlu memutuskan:

```text
- pakai JDK HttpClient?
- pakai Apache HttpClient?
- pakai Jetty/Reactor Netty?
- timeout dimana dikonfigurasi?
- connection pool bagaimana?
- TLS/proxy bagaimana?
```

---

## 13. Migration dari `RestTemplate` ke `WebClient`

Migrasi ke `WebClient` tidak otomatis lebih modern dalam semua konteks.

### 13.1 Cocok Jika

```text
- aplikasi reactive end-to-end
- banyak composition async
- streaming response/request
- butuh non-blocking high concurrency
- team memahami Reactor
```

### 13.2 Tidak Cocok Jika

```text
- aplikasi Spring MVC blocking biasa
- semua call akhirnya `.block()`
- tidak ada kebutuhan reactive composition
- debugging/ops team belum siap reactive stack
```

### 13.3 Risiko Migration Syntax

Sebelum:

```java
CustomerDto dto = restTemplate.getForObject(url, CustomerDto.class);
```

Sesudah yang sering terjadi:

```java
CustomerDto dto = webClient.get()
        .uri(url)
        .retrieve()
        .bodyToMono(CustomerDto.class)
        .block();
```

Ini belum tentu lebih baik.

Jika tetap blocking, pertimbangkan `RestClient` + virtual threads di Java 21+ daripada WebClient `.block()` tanpa alasan.

### 13.4 Jika Benar-Benar Reactive

```java
public Mono<CustomerSnapshot> getCustomer(CustomerId id) {
    return webClient.get()
            .uri("/customers/{id}", id.value())
            .accept(MediaType.APPLICATION_JSON)
            .retrieve()
            .onStatus(HttpStatusCode::is4xxClientError, response -> map4xx(response))
            .onStatus(HttpStatusCode::is5xxServerError, response -> map5xx(response))
            .bodyToMono(CustomerDto.class)
            .timeout(Duration.ofSeconds(4))
            .map(this::mapToDomain);
}
```

Perhatikan:

- timeout operator,
- error mapping reactive,
- cancellation,
- retry placement,
- scheduler/event-loop safety.

---

## 14. Migration dari Custom Utility ke Typed Client

### 14.1 Legacy

```java
String response = HttpUtil.postJson(
        paymentUrl,
        objectMapper.writeValueAsString(command),
        token
);
```

Masalah:

- stringly typed,
- tidak ada endpoint abstraction,
- auth manual,
- error tidak typed,
- timeout global.

### 14.2 Target

```java
public interface PaymentCommandPort {
    PaymentSubmission submit(PaymentCommand command);
}
```

```java
public final class PaymentHttpAdapter implements PaymentCommandPort {
    private final PaymentClient client;
    private final PaymentMapper mapper;

    @Override
    public PaymentSubmission submit(PaymentCommand command) {
        PaymentRequest request = mapper.toExternal(command);
        PaymentResponse response = client.submit(request);
        return mapper.toDomain(response);
    }
}
```

### 14.3 Benefit

```text
- domain tidak tahu HTTP
- migration transport bebas
- test lebih mudah
- error mapping centralized
- observability centralized
- auth centralized
- retry/idempotency bisa jelas
```

---

## 15. Migration ke Retrofit

### 15.1 Cocok Untuk

```text
- API banyak endpoint
- schema relatif stabil
- butuh typed interface
- ingin mengurangi boilerplate request construction
- OkHttp sudah dipakai
```

Retrofit memetakan HTTP API ke Java/Kotlin interface dengan annotation seperti method HTTP, path, query, dan body; call dijalankan melalui underlying client seperti OkHttp. citeturn979766search4turn979766search11

### 15.2 Interface

```java
public interface CustomerDirectoryRetrofitApi {
    @GET("customers/{id}")
    Call<CustomerDto> getCustomer(@Path("id") String id);
}
```

### 15.3 Adapter

```java
public final class RetrofitCustomerDirectoryClient implements CustomerDirectoryClient {
    private final CustomerDirectoryRetrofitApi api;

    @Override
    public ExternalCustomerResponse getCustomer(String id) {
        try {
            Response<CustomerDto> response = api.getCustomer(id).execute();

            if (response.isSuccessful() && response.body() != null) {
                return map(response.body());
            }
            if (response.code() == 404) {
                throw new ExternalNotFoundException("customer not found");
            }
            if (response.code() >= 500) {
                throw new ExternalServerException("server error: " + response.code());
            }
            throw new ExternalProtocolException("unexpected status: " + response.code());
        } catch (IOException e) {
            throw new ExternalTransportException("customer-directory transport failure", e);
        }
    }
}
```

### 15.4 Migration Warning

Jangan biarkan Retrofit interface menjadi domain port langsung jika annotation HTTP mulai bocor ke application layer.

Kurang ideal:

```java
public interface CustomerDirectoryPort {
    @GET("customers/{id}")
    Call<CustomerDto> getCustomer(@Path("id") String id);
}
```

Lebih baik:

```text
Retrofit API interface = infrastructure detail
Domain/application port = pure business contract
```

---

## 16. Migration ke Generated OpenAPI Client

### 16.1 Pattern Aman

```text
OpenAPI generated client
    ↓
GeneratedClientWrapper
    ↓
AntiCorruptionMapper
    ↓
Domain Port
```

Jangan:

```text
domain service → generated API → generated DTO
```

Karena generated code bisa berubah saat spec berubah.

### 16.2 Governance

Pastikan generated client punya:

```text
- pinned generator version
- deterministic generation
- no manual patch in generated folder
- custom template jika perlu
- wrapper untuk timeout/auth/retry/observability
- contract tests
- compatibility test saat spec update
```

---

## 17. Dual-Run dan Shadow Validation

Untuk read-only endpoint, Anda bisa menjalankan legacy dan modern client paralel lalu membandingkan hasil.

### 17.1 Dual-Run Inline

```java
public CustomerSnapshot getCustomer(CustomerId id) {
    CustomerSnapshot legacyResult = legacy.getCustomer(id);

    if (flags.shadowModernCustomerClient()) {
        try {
            CustomerSnapshot modernResult = modern.getCustomer(id);
            comparator.compareAndRecord("customer.get", legacyResult, modernResult);
        } catch (Exception e) {
            metrics.increment("customer.modern.shadow.failure");
            log.warn("modern customer shadow call failed", e);
        }
    }

    if (flags.useModernCustomerClient()) {
        return modern.getCustomer(id);
    }
    return legacyResult;
}
```

Masalah:

- bisa menggandakan traffic,
- bisa memperlambat jika tidak async,
- tidak aman untuk mutating endpoint.

### 17.2 Shadow Async

```java
CustomerSnapshot legacyResult = legacy.getCustomer(id);

shadowExecutor.submit(() -> {
    try {
        CustomerSnapshot modernResult = modern.getCustomer(id);
        comparator.compareAndRecord("customer.get", legacyResult, modernResult);
    } catch (Exception e) {
        metrics.increment("shadow.failure");
    }
});

return legacyResult;
```

Tetap perlu rate limit agar shadow tidak membebani downstream.

### 17.3 Jangan Shadow Mutating Call Sembarangan

Tidak boleh dual-run untuk:

```text
- create payment
- submit application
- send email
- create case
- approve transaction
- update profile
```

Kecuali downstream punya dry-run/sandbox/idempotency semantics yang jelas.

---

## 18. Canary Rollout

Setelah shadow valid, lakukan canary.

### 18.1 Rollout Bertahap

```text
0% modern client
→ shadow read-only
→ 1% traffic modern
→ 5%
→ 25%
→ 50%
→ 100%
```

### 18.2 Segment Rollout

Bisa berdasarkan:

```text
- tenant
- user group
- endpoint
- environment
- traffic class
- request type
- region
```

### 18.3 Rollback Criteria

Definisikan sebelum rollout:

```text
rollback jika:
- timeout rate naik > X%
- 5xx dari downstream naik > Y%
- P95 latency naik > Z ms
- error mapping mismatch > threshold
- retry count naik tajam
- pool pending naik
- downstream complaint
```

---

## 19. Feature Flag Design untuk Migration

Feature flag harus granular.

Buruk:

```text
useNewHttpClient=true
```

Lebih baik:

```text
customerDirectory.getCustomer.transport=modern
customerDirectory.searchCustomer.transport=legacy
payment.submit.transport=legacy
payment.status.transport=modern
```

Atau:

```text
client.customerDirectory.read.enabled=true
client.customerDirectory.write.enabled=false
client.customerDirectory.shadow.enabled=true
client.customerDirectory.rolloutPercentage=5
```

### 19.1 Safe Default

Default harus konservatif:

```text
if flag unavailable → legacy
if config invalid → fail startup or safe fallback
if modern fails unexpectedly during canary → rollback possible
```

### 19.2 Flag Expiry

Migration flag harus punya expiry date.

Jika tidak, sistem akan punya permanent complexity:

```text
legacy + modern + switcher + comparator + duplicate config
```

Setelah stabil, hapus legacy path.

---

## 20. Compatibility Test Matrix

Buat test matrix sebelum cutover.

| Scenario | Expected Behavior |
|---|---|
| 200 JSON valid | mapped to domain success |
| 200 empty body | classified correctly |
| 204 | no-body success jika endpoint support |
| 400 validation error | domain validation failure |
| 401 | refresh token once or auth failure |
| 403 | authorization failure |
| 404 | not found atau empty sesuai endpoint |
| 409 | conflict domain error |
| 429 | rate limited, respect Retry-After jika policy |
| 500 | retryable server failure jika safe |
| 502/503/504 | retryable based on policy |
| malformed JSON | decode failure, no retry usually |
| slow response | timeout classification |
| connection reset | transport failure |
| TLS error | security/transport failure |
| redirect to same host | allow/deny sesuai policy |
| redirect to other host | deny |
| large body | stream/limit behavior |
| gzip body | decode behavior |
| multipart upload | boundary/body correctness |

---

## 21. Regression Risk: Perbedaan Status Code Handling

Salah satu sumber bug migration paling sering adalah `retrieve()` atau helper API yang otomatis throw exception pada 4xx/5xx.

Contoh:

```java
restClient.get()
    .uri("/customers/{id}", id)
    .retrieve()
    .body(CustomerDto.class);
```

Ini ringkas, tetapi jika tidak dikontrol, status error bisa berubah menjadi exception default.

Untuk API client serius, lebih baik eksplisit:

```java
.retrieve()
.onStatus(status -> status.value() == 404, (request, response) -> {
    throw new ExternalNotFoundException("customer not found");
})
.onStatus(HttpStatusCode::is5xxServerError, (request, response) -> {
    throw new ExternalServerException("server error");
})
```

Atau gunakan exchange-style API yang memberi akses status/body secara penuh.

---

## 22. Regression Risk: Body Close Semantics

### 22.1 OkHttp

Wajib close `Response` atau `ResponseBody`:

```java
try (Response response = client.newCall(request).execute()) {
    // consume body
}
```

Jika tidak, connection bisa tidak kembali ke pool.

### 22.2 Apache

Pastikan entity dikonsumsi/response ditutup.

### 22.3 JDK HttpClient

Jika memakai `BodyHandlers.ofInputStream()`, stream harus dibaca/ditutup.

```java
HttpResponse<InputStream> response = client.send(request, BodyHandlers.ofInputStream());
try (InputStream in = response.body()) {
    // read stream
}
```

Migration yang mengubah body handler dari string ke stream bisa memperkenalkan leak jika lifecycle tidak jelas.

---

## 23. Regression Risk: Auth dan Token Refresh

Saat migrasi, jangan reimplement token refresh secara naive.

Buruk:

```java
if (response.code() == 401) {
    token = authClient.getToken();
    return executeAgain(requestWith(token));
}
```

Masalah:

- semua thread refresh bersamaan,
- request mutating bisa dikirim ulang tanpa idempotency,
- 401 karena permission issue dianggap expired token,
- retry tidak menghormati deadline.

Lebih baik:

```text
- token cache dengan expiry skew
- single-flight refresh
- refresh-on-401 maksimal sekali
- retry hanya jika request safe/replayable
- auth failure diklasifikasi jelas
```

---

## 24. Regression Risk: Observability Hilang

Migrasi sering membuat metric berubah nama, hilang, atau cardinality meledak.

Sebelum:

```text
external.customer.latency
external.customer.error
```

Sesudah buruk:

```text
http.client.requests{uri="/customers/12345"}
```

Masalah: URI mengandung ID, cardinality tinggi.

Target:

```text
http.client.duration{client="customer-directory", operation="getCustomer", status_class="2xx"}
http.client.errors{client="customer-directory", operation="getCustomer", failure_type="timeout"}
```

Migration harus menjaga dashboard dan alert tetap bermakna.

---

## 25. Regression Risk: Security Posture Berubah

Cek apakah migrasi mengubah:

```text
- TLS protocol/cipher
- truststore source
- hostname verification
- mTLS certificate
- certificate pinning
- proxy route
- redirect policy
- Authorization header propagation
- request logging
- query token leakage
```

Contoh regression fatal:

```text
legacy client: hostname verification strict
new client: custom trust manager accepts all
```

Atau:

```text
legacy: redirect disabled
new: follow redirect, Authorization ikut ke host lain
```

---

## 26. Java 8 sampai 25: Migration Path

### 26.1 Java 8

Tidak ada JDK `java.net.http.HttpClient` modern.

Pilihan praktis:

```text
- OkHttp
- Apache HttpClient 5 jika kompatibel dengan target runtime yang digunakan
- Retrofit + OkHttp
- Spring RestTemplate / WebClient tergantung Spring version
```

Untuk Java 8, migrasi sering lebih realistis ke OkHttp/Apache/Retrofit daripada JDK HttpClient.

### 26.2 Java 11+

JDK `HttpClient` tersedia sebagai pilihan dependency-light.

Cocok untuk:

```text
- simple/moderate HTTP client
- internal service calls
- dependency minimization
- async with CompletableFuture
```

### 26.3 Java 17

Stabil sebagai LTS modern. Banyak stack Spring Boot 3 berjalan di Java 17+.

Cocok untuk:

```text
- RestClient/WebClient modern Spring
- JDK HttpClient
- OkHttp/Retrofit
- Apache 5
```

### 26.4 Java 21+

Virtual threads mengubah trade-off.

Untuk banyak use case blocking I/O:

```text
simple blocking code + bounded concurrency + virtual threads
```

bisa lebih maintainable daripada reactive code yang dipakai hanya untuk concurrency.

### 26.5 Java 25

Gunakan sebagai target modern untuk API JDK terbaru, tetapi perhatikan runtime production organization.

JDK `HttpClient` tetap reusable, immutable setelah dibangun, dan mendukung banyak request via builder-configured client. citeturn979766search5

---

## 27. Migration Decision Matrix

| Legacy | Target Disarankan | Catatan |
|---|---|---|
| `HttpURLConnection` kecil | JDK HttpClient | jika Java 11+ dan kebutuhan standar |
| `HttpURLConnection` Java 8 | OkHttp atau Apache | JDK modern tidak tersedia |
| Apache 4.x enterprise | Apache 5 classic | migration path natural |
| RestTemplate blocking Spring | RestClient | modern synchronous path |
| RestTemplate butuh reactive | WebClient | hanya jika reactive end-to-end |
| Custom util banyak endpoint | Port + typed client | jangan langsung library swap |
| External API besar | Retrofit/OpenAPI client wrapper | typed interface/generated support |
| Need enterprise proxy/TLS/route | Apache 5 | granular config |
| Need lightweight dependency-free | JDK HttpClient | Java 11+ |
| Need interceptor/testing ecosystem | OkHttp | strong engine + MockWebServer |

---

## 28. Step-by-Step Migration Plan

### Step 1 — Inventory

```text
- endpoint
- caller
- method
- side effect
- timeout
- retry
- auth
- error mapping
- observability
- config
```

### Step 2 — Define Target Contract

```java
public interface DownstreamPort {
    DomainResult execute(DomainCommand command);
}
```

### Step 3 — Wrap Legacy

```text
Existing behavior becomes explicit through legacy adapter.
```

### Step 4 — Build Modern Adapter

```text
Use chosen library, but expose same port.
```

### Step 5 — Add Compatibility Tests

```text
Mock server tests covering status/body/error/timeout/auth.
```

### Step 6 — Add Shadow for Safe Reads

```text
Compare outputs without affecting user response.
```

### Step 7 — Canary

```text
Small percentage / tenant / endpoint.
```

### Step 8 — Monitor

```text
Latency, error, retry, pool, thread, downstream response.
```

### Step 9 — Rollback If Needed

```text
Feature flag back to legacy.
```

### Step 10 — Remove Legacy

```text
After stable period, delete old path and migration flags.
```

---

## 29. Example: Full Migration Architecture

```text
Application Service
    ↓
CustomerDirectoryPort
    ↓
SwitchableCustomerDirectoryAdapter
    ├── LegacyCustomerDirectoryAdapter
    │       ↓
    │   RestTemplate / HttpURLConnection
    │
    └── ModernCustomerDirectoryAdapter
            ↓
        CustomerDirectoryHttpClient
            ↓
        OkHttp / JDK HttpClient / RestClient
```

Dengan observability:

```text
ModernCustomerDirectoryAdapter
    ↓
ClientPolicy
    - timeout
    - retry
    - rate limit
    - circuit breaker
    - auth
    - redaction
    ↓
Transport
    ↓
Event/metric/log/trace sink
```

---

## 30. Migration Anti-Patterns

### 30.1 Big-Bang Rewrite Tanpa Baseline

```text
Tidak tahu latency/error sebelum migrasi → tidak tahu apakah memburuk.
```

### 30.2 Library Swap di Service Layer

```text
Domain service langsung tahu OkHttp/RestClient/WebClient.
```

### 30.3 Copy Timeout Tanpa Memahami Semantics

```text
read timeout lama bukan berarti call timeout baru.
```

### 30.4 Menganggap Retry Library Sama Dengan Business Retry

```text
transport retry bisa aman, POST retry belum tentu aman.
```

### 30.5 Error Model Berubah Diam-Diam

```text
404 yang dulu empty sekarang exception → behavior bisnis berubah.
```

### 30.6 Observability Hilang

```text
Dashboard lama mati setelah metric name berubah.
```

### 30.7 Manual Patch Generated Code

```text
Regenerate berikutnya menghapus patch.
```

### 30.8 Tidak Menghapus Legacy Setelah Stabil

```text
Sistem punya dua implementation selamanya.
```

---

## 31. Production Readiness Checklist

Sebelum cutover penuh:

```text
[ ] Semua endpoint terinventarisasi
[ ] Timeout policy eksplisit
[ ] Retry policy eksplisit
[ ] Idempotency decision eksplisit
[ ] Redirect policy eksplisit
[ ] Error mapping kompatibel
[ ] Auth/token refresh diuji
[ ] TLS/proxy/truststore kompatibel
[ ] URL encoding diuji
[ ] Header propagation diuji
[ ] Body close lifecycle aman
[ ] Large payload behavior jelas
[ ] Metrics/log/tracing tersedia
[ ] Sensitive data redacted
[ ] Mock server tests lengkap
[ ] Contract tests tersedia untuk endpoint penting
[ ] Shadow/canary plan ada
[ ] Rollback flag ada
[ ] Alert threshold ada
[ ] Runbook update
[ ] Legacy cleanup plan ada
```

---

## 32. Design Review Questions

Gunakan pertanyaan ini saat review migrasi:

```text
1. Behavior lama apa yang sengaja dipertahankan?
2. Behavior lama apa yang sengaja diubah?
3. Apakah perubahan itu terdokumentasi?
4. Apakah timeout baru setara secara semantic?
5. Apakah retry baru aman terhadap side effect?
6. Apakah error mapping tetap kompatibel dengan caller?
7. Apakah URL encoding berubah?
8. Apakah redirect/auth propagation aman?
9. Apakah response body selalu ditutup?
10. Apakah observability minimal sama baiknya dengan sebelumnya?
11. Apakah canary bisa rollback tanpa deploy ulang?
12. Apakah generated DTO atau HTTP annotation bocor ke domain?
13. Apakah ada test untuk 400/401/404/409/429/500/timeout/malformed body?
14. Apakah downstream akan menerima beban tambahan saat shadow/dual-run?
15. Kapan legacy code akan dihapus?
```

---

## 33. Ringkasan Mental Model

Migrasi HTTP client bukan pekerjaan mekanis.

Yang dimigrasikan adalah:

```text
transport API
+ connection behavior
+ timeout semantics
+ retry semantics
+ auth lifecycle
+ body lifecycle
+ error taxonomy
+ security posture
+ observability contract
+ operational rollback path
```

Engineer biasa mengganti library.

Engineer kuat mengganti library sambil menjaga behavior.

Engineer top-tier menjadikan migrasi sebagai kesempatan untuk memperjelas boundary, menghapus implicit behavior, menambah observability, memperbaiki failure model, dan menurunkan operational risk.

---

## 34. Hubungan dengan Part Berikutnya

Part ini membahas pola migrasi dari client lama ke modern client.

Part berikutnya akan membahas **advanced patterns** yang sering muncul setelah client architecture matang:

```text
- fan-out aggregator
- token refresh single-flight
- request coalescing
- in-flight deduplication
- client-side cache
- stale-while-revalidate
- idempotent command client
- outbox + HTTP delivery
- polling client
- long-running operation client
- pagination iterator abstraction
```

Dengan kata lain:

```text
Part 30 = bagaimana berpindah dari legacy ke modern secara aman
Part 31 = bagaimana membangun pola client kompleks setelah fondasinya benar
```

---

## 35. Referensi Resmi dan Relevan

- Oracle Java SE 25 — `java.net.http` module dan `HttpClient` API.
- Apache HttpClient 5.x — migration guide dari 4.x ke 5.x.
- Spring Framework — REST Clients, `RestClient`, `RestTemplate`, `WebClient`.
- OkHttp official documentation — overview, connection reuse, `OkHttpClient` reuse.
- OpenRewrite Apache HttpClient migration recipes sebagai contoh tooling migrasi otomatis.



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 29 — Production Failure Playbook: Diagnosis and Incident Response](./29-production-failure-playbook-diagnosis-incident-response.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 31 — Advanced Patterns: Fan-Out Aggregator, Token Single-Flight, Client-Side Cache, Idempotent Command](./31-advanced-patterns-fanout-token-singleflight-cache-idempotent-command.md)
