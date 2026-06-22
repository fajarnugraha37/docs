# Part 17 — Apache HttpClient 5 Deep Dive

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `17-apache-httpclient-5-deep-dive.md`  
> Scope: Java 8–25, Apache HttpClient 5.x, classic blocking API, async API, connection management, TLS, proxy, timeout, interceptors, migration, production design.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas JDK `HttpClient`, OkHttp, dan Retrofit. Sekarang kita masuk ke **Apache HttpClient 5**, salah satu HTTP client JVM yang sangat penting untuk sistem enterprise karena memberikan kontrol sangat granular terhadap:

- connection manager,
- per-route connection pool,
- timeout dan request configuration,
- proxy dan route planning,
- TLS strategy,
- cookie/credential management,
- interceptor pipeline,
- classic blocking client,
- async client,
- migration dari Apache HttpClient 4.x.

Part ini bukan sekadar tutorial `GET` atau `POST`. Targetnya adalah memahami **Apache HttpClient 5 sebagai transport subsystem** yang cocok ketika aplikasi membutuhkan kontrol lebih eksplisit dibanding JDK `HttpClient`, dan lebih configurable untuk beberapa skenario enterprise dibanding OkHttp.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Menjelaskan kapan Apache HttpClient 5 lebih cocok daripada JDK `HttpClient`, OkHttp, atau Retrofit.
2. Mendesain `CloseableHttpClient` production-grade dengan connection pool, timeout, TLS, proxy, dan observability.
3. Memahami perbedaan classic API, fluent API, dan async API.
4. Menghindari bug umum seperti response entity leak, pool starvation, timeout salah tempat, dan nested retry.
5. Melakukan migrasi dari Apache HttpClient 4.x ke 5.x secara aman.
6. Membungkus Apache HttpClient dalam domain-safe API client, bukan menyebar detail library ke seluruh service layer.

---

## 2. Posisi Apache HttpClient 5 dalam Landscape Java HTTP Client

Secara sederhana:

```text
JDK HttpClient
  → built-in, cukup modern, dependency-free, cocok untuk banyak use case standar

OkHttp
  → compact, ergonomic, bagus untuk HTTP/2, interceptor, Android heritage, Retrofit engine

Retrofit
  → declarative typed API di atas transport seperti OkHttp

Apache HttpClient 5
  → enterprise-grade configurable HTTP stack dengan strong connection management, route/proxy/TLS control, classic + async model
```

Apache HttpClient 5 penting karena banyak aplikasi enterprise historis memakai Apache HttpClient 4.x. Ketika sistem mulai upgrade Java, Spring Boot, library security, atau platform runtime, migrasi ke 5.x sering menjadi bagian dari modernization.

Dokumentasi Apache HttpComponents menyebut HttpClient 5 menyediakan quick start untuk **classic, fluent, dan async API**, dan dokumentasi connection pooling menjelaskan adanya `PoolingHttpClientConnectionManager` untuk classic blocking I/O serta `PoolingAsyncClientConnectionManager` untuk async I/O. Keduanya mempertahankan limit total dan per-route, reuse idle persistent connection, TTL, dan idle expiry.

Mental model penting:

```text
Apache HttpClient 5 bukan hanya "library HTTP".
Ia adalah configurable HTTP execution engine.
```

Kalau kamu hanya perlu call API sederhana, JDK `HttpClient` atau OkHttp mungkin lebih cepat dipakai. Tetapi kalau kamu perlu kontrol per-route, proxy enterprise, credential provider, cookie store, custom route planner, atau migrasi legacy Apache 4.x, Apache HttpClient 5 sangat relevan.

---

## 3. Modul dan API Surface Penting

Apache HttpClient 5 berada dalam ekosistem **Apache HttpComponents**.

Secara praktis, artefak yang sering muncul:

```xml
<dependency>
  <groupId>org.apache.httpcomponents.client5</groupId>
  <artifactId>httpclient5</artifactId>
  <version>...</version>
</dependency>
```

Untuk fluent API:

```xml
<dependency>
  <groupId>org.apache.httpcomponents.client5</groupId>
  <artifactId>httpclient5-fluent</artifactId>
  <version>...</version>
</dependency>
```

Catatan versi:

- Apache HttpClient 5.x mendukung Java 8+.
- Pada aplikasi Java 17/21/25, ia tetap relevan, terutama saat membutuhkan kontrol connection manager yang eksplisit.
- Jika memakai Spring Boot, versi dependency sering dikelola oleh BOM Spring Boot, tetapi tetap harus dicek agar tidak ada konflik major version.

Package namespace berubah dari Apache 4.x:

```text
Apache HttpClient 4.x:
org.apache.http.*

Apache HttpClient 5.x:
org.apache.hc.client5.*
org.apache.hc.core5.*
```

Perubahan namespace ini memungkinkan 4.x dan 5.x berada berdampingan di classpath pada beberapa scenario migration.

---

## 4. Tiga Cara Utama Menggunakan Apache HttpClient 5

Apache HttpClient 5 menyediakan beberapa gaya penggunaan.

### 4.1 Classic Blocking API

Classic API adalah model paling familiar:

```text
thread caller
  → execute request
  → block sampai response tersedia
  → baca entity
  → close response
```

Cocok untuk:

- Java 8–17 synchronous application,
- Spring MVC blocking service,
- batch job,
- scheduler,
- worker pool,
- aplikasi Java 21+ dengan virtual threads,
- migrasi dari HttpClient 4.x.

Contoh konseptual:

```java
try (CloseableHttpClient client = HttpClients.createDefault()) {
    HttpGet request = new HttpGet("https://api.example.com/users/123");

    try (CloseableHttpResponse response = client.execute(request)) {
        int status = response.getCode();
        HttpEntity entity = response.getEntity();
        String body = entity != null ? EntityUtils.toString(entity) : "";
    }
}
```

Masalah dari contoh di atas untuk production:

- client dibuat per operasi,
- tidak ada explicit timeout,
- tidak ada connection pool config,
- tidak ada classification error,
- tidak ada observability,
- response body langsung dibaca ke memory,
- belum ada redaction/logging policy.

Contoh quickstart baik untuk belajar API, bukan desain final production.

### 4.2 Fluent API

Fluent API membuat request sederhana lebih ringkas:

```java
String body = Request.get("https://api.example.com/users/123")
    .execute()
    .returnContent()
    .asString();
```

Kelebihan:

- cepat untuk script kecil,
- test utility,
- admin tool,
- prototyping.

Kekurangan:

- kurang eksplisit untuk production policy,
- mudah menyembunyikan timeout/pooling/detail error,
- tidak cocok jika sistem perlu client wrapper yang kuat.

Rule praktis:

```text
Fluent API boleh untuk simple tool.
Production service sebaiknya pakai explicit CloseableHttpClient + wrapper.
```

### 4.3 Async API

Async API memakai non-blocking I/O dan callback/future style.

Cocok untuk:

- high concurrency outbound call,
- streaming,
- gateway/proxy,
- aplikasi yang memang dibangun async,
- use case yang membutuhkan HTTP/2 support eksplisit pada stack Apache.

Namun async API juga punya complexity cost:

- lifecycle lebih kompleks,
- cancellation lebih penting,
- backpressure harus dipahami,
- callback/future error handling sering tersebar,
- debugging lebih sulit daripada blocking dengan virtual threads.

Pada Java 21+, blocking classic API di atas virtual threads sering cukup baik untuk banyak aplikasi service-to-service. Tetapi async API tetap relevan untuk gateway dan streaming-heavy workloads.

---

## 5. Mental Model Apache HttpClient 5 Architecture

Pikirkan Apache HttpClient 5 sebagai beberapa layer:

```text
Application Client Wrapper
  ↓
Request Construction
  ↓
Execution Chain / Interceptors
  ↓
Route Planning
  ↓
Connection Manager
  ↓
DNS / Proxy / TCP / TLS
  ↓
HTTP Protocol Exchange
  ↓
Response Entity Handling
  ↓
Connection Reuse / Release
```

Komponen penting:

| Komponen | Tanggung Jawab |
|---|---|
| `CloseableHttpClient` | entry point eksekusi request classic |
| `HttpClients.custom()` | builder untuk membuat client dengan policy eksplisit |
| `HttpGet`, `HttpPost`, etc. | representasi request method |
| `HttpEntity` | representasi body request/response |
| `RequestConfig` | timeout, redirect, cookie, config request-level |
| `ConnectionConfig` | connect timeout, socket timeout, TTL connection-level |
| `PoolingHttpClientConnectionManager` | pool koneksi classic blocking |
| `CredentialsProvider` | credential auth/proxy |
| `CookieStore` | state cookie |
| `HttpRoutePlanner` | route/proxy decision |
| `SSLContext` / TLS strategy | TLS/mTLS configuration |
| Interceptors | cross-cutting behavior |

Top 1% mental model:

```text
Apache HttpClient configuration bukan sekadar "builder chaining".
Setiap setting mempengaruhi lifecycle request pada fase berbeda.
```

Contoh:

- `connectionRequestTimeout` mempengaruhi menunggu koneksi dari pool.
- `connectTimeout` mempengaruhi TCP connect saat membuat koneksi baru.
- `responseTimeout` mempengaruhi menunggu response setelah request dikirim.
- pool max per route mempengaruhi concurrency ke downstream tertentu.
- max total mempengaruhi total outbound concurrency semua route.
- TTL mempengaruhi berapa lama koneksi boleh hidup walaupun reusable.
- idle eviction mempengaruhi stale connection dan resource cleanup.

---

## 6. Production-Grade Classic Client Skeleton

Berikut skeleton konseptual. Nama class bisa disesuaikan.

```java
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManager;
import org.apache.hc.core5.http.ClassicHttpResponse;
import org.apache.hc.core5.http.HttpEntity;
import org.apache.hc.core5.http.io.entity.EntityUtils;
import org.apache.hc.core5.util.Timeout;
import org.apache.hc.core5.util.TimeValue;

import java.io.IOException;

public final class ExternalApiTransport implements AutoCloseable {

    private final CloseableHttpClient client;

    public ExternalApiTransport() {
        PoolingHttpClientConnectionManager connectionManager =
            new PoolingHttpClientConnectionManager();

        connectionManager.setMaxTotal(200);
        connectionManager.setDefaultMaxPerRoute(50);

        RequestConfig requestConfig = RequestConfig.custom()
            .setConnectionRequestTimeout(Timeout.ofMilliseconds(200))
            .setResponseTimeout(Timeout.ofSeconds(2))
            .build();

        this.client = HttpClients.custom()
            .setConnectionManager(connectionManager)
            .setDefaultRequestConfig(requestConfig)
            .evictExpiredConnections()
            .evictIdleConnections(TimeValue.ofSeconds(30))
            .disableAutomaticRetries()
            .build();
    }

    public String getUser(String id) throws IOException {
        HttpGet request = new HttpGet("https://api.example.com/users/" + id);
        request.addHeader("Accept", "application/json");

        return client.execute(request, response -> {
            int status = response.getCode();
            HttpEntity entity = response.getEntity();
            String body = entity == null ? "" : EntityUtils.toString(entity);

            if (status >= 200 && status < 300) {
                return body;
            }

            throw new ExternalApiException(status, body);
        });
    }

    @Override
    public void close() throws IOException {
        client.close();
    }
}
```

Catatan penting:

1. Client dibuat sekali dan direuse.
2. Pool manager eksplisit.
3. Timeout eksplisit.
4. Automatic retry bisa dinonaktifkan agar semantic retry dilakukan di layer aplikasi/resilience policy.
5. Response entity dibaca/di-consume di dalam response handler.
6. Error status diklasifikasikan, bukan dibiarkan sebagai string random.

Namun skeleton ini belum final untuk sistem besar. Ia masih perlu:

- URI builder aman,
- auth injection,
- redaction,
- metrics,
- tracing,
- retry/circuit breaker wrapper,
- error taxonomy,
- test dengan fault injection,
- config externalization.

---

## 7. Connection Management Deep Dive

Apache HttpClient 5 sangat kuat di area connection management.

### 7.1 Kenapa Connection Manager Penting

Tanpa pooling, setiap request perlu:

```text
DNS
→ TCP handshake
→ TLS handshake
→ HTTP request
→ HTTP response
→ connection close
```

Dengan pooling:

```text
acquire existing connection
→ send request
→ receive response
→ release connection to pool
```

Ini mengurangi:

- latency,
- CPU TLS handshake,
- ephemeral port pressure,
- load balancer churn,
- downstream connection overhead.

Tetapi pooling juga membawa risiko:

- pool starvation,
- stale connection,
- idle timeout mismatch,
- wrong per-route limit,
- body leak yang membuat koneksi tidak kembali.

### 7.2 Per-Route vs Total Limit

Apache pool punya dua konsep penting:

```text
maxTotal
  → jumlah maksimal koneksi seluruh route

defaultMaxPerRoute
  → jumlah maksimal koneksi ke satu route/default target
```

Route biasanya dipengaruhi oleh:

- scheme: `http`/`https`,
- host,
- port,
- proxy route.

Contoh:

```java
PoolingHttpClientConnectionManager cm = new PoolingHttpClientConnectionManager();
cm.setMaxTotal(200);
cm.setDefaultMaxPerRoute(50);
```

Artinya:

```text
Seluruh downstream total maksimal 200 koneksi.
Setiap route default maksimal 50 koneksi.
```

Jika service kamu call 4 downstream utama, setting ini mungkin cukup. Tapi jika satu downstream sangat critical dan perlu limit lebih besar, kamu bisa set route-specific limit.

Mental model:

```text
Pool limit adalah concurrency control di layer koneksi,
bukan rate limiter dan bukan bulkhead lengkap.
```

Connection limit membatasi jumlah koneksi, bukan jumlah logical operation secara lengkap, apalagi kalau HTTP/2 multiplexing atau async model terlibat.

### 7.3 Connection Request Timeout

Ini timeout untuk menunggu koneksi dari pool.

```text
caller thread
  → request connection from pool
  → if all connection busy, wait
  → if wait exceeds connectionRequestTimeout, fail
```

Jika tidak dikonfigurasi dengan benar, saat downstream lambat:

```text
all connections busy
→ new requests queue waiting for connection
→ thread pile-up
→ memory pressure
→ request latency naik
→ service ikut down
```

`connectionRequestTimeout` adalah salah satu guard penting terhadap pool starvation.

Rule praktis:

```text
connectionRequestTimeout harus pendek.
Jika tidak dapat koneksi cepat, sistem sedang saturated.
```

Contoh:

```java
RequestConfig requestConfig = RequestConfig.custom()
    .setConnectionRequestTimeout(Timeout.ofMilliseconds(100))
    .setResponseTimeout(Timeout.ofSeconds(2))
    .build();
```

### 7.4 Idle Eviction dan Expired Connections

Koneksi idle tidak boleh hidup selamanya.

Risiko koneksi idle terlalu lama:

- server sudah menutup koneksi,
- load balancer sudah drop state,
- NAT mapping expired,
- DNS target sudah berubah,
- TLS/session state tidak lagi valid.

Apache builder menyediakan helper seperti:

```java
HttpClients.custom()
    .evictExpiredConnections()
    .evictIdleConnections(TimeValue.ofSeconds(30));
```

Rule praktis:

```text
Client idle timeout sebaiknya lebih pendek daripada load balancer idle timeout.
```

Jika LB idle timeout 60 detik, client idle eviction 30–50 detik sering lebih aman.

### 7.5 Connection TTL

TTL membatasi umur maksimum koneksi walaupun koneksi masih sehat.

Tujuannya:

- menghindari koneksi terlalu lama ke backend lama,
- membantu DNS/load balancer rotation,
- mengurangi risiko stale long-lived connection.

Trade-off:

- TTL terlalu pendek → handshake lebih sering.
- TTL terlalu panjang → lambat adaptasi ke topology change.

---

## 8. Timeout Model Apache HttpClient 5

Salah satu migration pain dari 4.x ke 5.x adalah timeout API berubah dan lebih eksplisit.

Timeout umum:

| Timeout | Makna |
|---|---|
| `connectionRequestTimeout` | waktu menunggu koneksi dari pool |
| `connectTimeout` | waktu membuka TCP connection baru |
| `responseTimeout` | waktu menunggu response dari server |
| socket timeout | batas inactivity I/O di level socket, tergantung konfigurasi connection/socket |

Jangan samakan semua timeout.

Contoh buruk:

```text
connectTimeout = 30s
connectionRequestTimeout = 30s
responseTimeout = 30s
retry 3x
```

Dampak:

```text
worst case bisa > 90s
thread tertahan lama
pool penuh
caller timeout duluan
retry storm
```

Contoh lebih baik:

```text
operation deadline: 2500 ms
connectionRequestTimeout: 100 ms
connectTimeout: 300 ms
responseTimeout: 1800 ms
retry: hanya jika masih ada budget
```

Dengan retry:

```text
attempt 1 max 800ms
backoff 100ms
attempt 2 max 800ms
remaining budget checked
```

Timeout harus dikaitkan ke:

- SLA caller,
- SLA downstream,
- retry count,
- pool capacity,
- user-facing timeout,
- queueing budget.

---

## 9. Request Execution Patterns

### 9.1 Response Handler Pattern

Apache HttpClient 5 mendorong penggunaan response handler.

```java
String result = client.execute(request, response -> {
    int code = response.getCode();
    String body = response.getEntity() == null
        ? ""
        : EntityUtils.toString(response.getEntity());

    if (code >= 200 && code < 300) {
        return body;
    }
    throw new ExternalHttpException(code, body);
});
```

Keuntungan:

- response lifecycle lebih terkendali,
- entity dikonsumsi di satu tempat,
- error mapping konsisten,
- mudah ditambahkan metric.

### 9.2 Manual Response Handling

Jika memakai manual response:

```java
try (CloseableHttpResponse response = client.execute(request)) {
    // must consume/close entity
}
```

Wajib:

- close response,
- consume entity jika ingin connection reuse,
- jangan return `InputStream` tanpa lifecycle jelas,
- jangan lupa handle error body.

### 9.3 Streaming Response

Untuk file besar, jangan gunakan `EntityUtils.toString()`.

Gunakan streaming:

```java
client.execute(request, response -> {
    int code = response.getCode();
    if (code < 200 || code >= 300) {
        String error = response.getEntity() == null ? "" : EntityUtils.toString(response.getEntity());
        throw new ExternalHttpException(code, error);
    }

    HttpEntity entity = response.getEntity();
    if (entity == null) {
        throw new IOException("Empty response body");
    }

    try (InputStream in = entity.getContent();
         OutputStream out = Files.newOutputStream(targetPath)) {
        in.transferTo(out); // Java 9+
    }
    return targetPath;
});
```

Untuk Java 8, gunakan loop buffer manual.

---

## 10. Request Body dan Entity Model

Apache HttpClient memakai `HttpEntity` untuk body.

Jenis umum:

| Entity | Use Case |
|---|---|
| `StringEntity` | JSON/text kecil |
| `ByteArrayEntity` | binary kecil/medium yang sudah di memory |
| `InputStreamEntity` | streaming upload |
| `FileEntity` | upload file |
| multipart entity | multipart/form-data |
| form encoded entity | application/x-www-form-urlencoded |

### 10.1 JSON Body

```java
HttpPost post = new HttpPost("https://api.example.com/orders");
post.addHeader("Content-Type", "application/json");
post.addHeader("Accept", "application/json");
post.setEntity(new StringEntity(json, ContentType.APPLICATION_JSON));
```

Hal yang harus diperhatikan:

- charset,
- content type,
- body repeatability,
- retry safety,
- payload size,
- redaction.

### 10.2 Repeatable vs Non-Repeatable Entity

Body repeatable bisa dikirim ulang. Body non-repeatable tidak selalu bisa.

Contoh:

```text
StringEntity       → repeatable
ByteArrayEntity    → repeatable
FileEntity         → biasanya repeatable jika file masih tersedia
InputStreamEntity  → sering non-repeatable
```

Ini penting untuk retry.

Jika request body non-repeatable dan connection gagal setelah sebagian body terkirim, retry bisa:

- mustahil secara teknis,
- berbahaya secara bisnis,
- menyebabkan duplicate side effect.

Rule:

```text
Jangan retry request body streaming kecuali kamu punya idempotency key dan mekanisme replay aman.
```

---

## 11. Redirect Handling

Redirect bukan sekadar follow URL baru.

Risiko redirect:

- token bocor ke host lain,
- method berubah,
- body hilang,
- request keluar dari allowlist,
- HTTP downgrade,
- redirect loop,
- signed request menjadi invalid.

Apache HttpClient dapat mengatur redirect behavior melalui request config/client config.

Policy production:

```text
Internal service-to-service:
  usually disable redirect or allow same-host only.

Third-party API:
  allow only documented redirect behavior.

File download:
  validate redirected host and scheme.

Auth request:
  never propagate Authorization blindly across host changes.
```

---

## 12. Authentication dan CredentialsProvider

Apache HttpClient punya `CredentialsProvider` untuk credential-based authentication.

Use case:

- Basic auth,
- Digest auth,
- proxy auth,
- NTLM/Kerberos-like enterprise scenario,
- credential scoping.

Contoh konseptual Basic Auth:

```java
BasicCredentialsProvider credentialsProvider = new BasicCredentialsProvider();
credentialsProvider.setCredentials(
    new AuthScope("api.example.com", 443),
    new UsernamePasswordCredentials("client", "secret".toCharArray())
);

CloseableHttpClient client = HttpClients.custom()
    .setDefaultCredentialsProvider(credentialsProvider)
    .build();
```

Namun untuk bearer token/OAuth2, sering lebih baik memakai request interceptor/wrapper yang menambahkan header:

```text
Authorization: Bearer <token>
```

Dengan policy:

- token cache,
- expiry skew,
- single-flight refresh,
- redaction,
- no token in query parameter,
- no propagation to redirected host.

---

## 13. Proxy dan Route Planning

Apache HttpClient kuat untuk enterprise proxy.

Proxy scenario:

```text
application
  → corporate HTTP proxy
  → CONNECT tunnel for HTTPS
  → external API
```

Atau:

```text
internal service
  → egress proxy
  → allowlisted destination
```

Route planning concern:

- direct vs proxy,
- per-host proxy rule,
- no-proxy list,
- proxy auth,
- TLS inspection,
- CONNECT tunnel timeout,
- DNS resolution side: client-side or proxy-side,
- audit requirement.

Contoh fixed proxy:

```java
HttpHost proxy = new HttpHost("http", "proxy.company.local", 8080);

CloseableHttpClient client = HttpClients.custom()
    .setProxy(proxy)
    .build();
```

Untuk policy lebih kompleks, gunakan route planner.

Production checklist proxy:

- Apakah proxy berlaku untuk semua host?
- Apakah internal host harus bypass proxy?
- Apakah credential proxy di-redact?
- Apakah TLS interception CA masuk truststore?
- Apakah Authorization header aman saat redirect via proxy?
- Apakah metric membedakan direct vs proxy route?

---

## 14. TLS dan mTLS di Apache HttpClient 5

TLS configuration di HttpClient 5 banyak berubah dibanding 4.x. Pada 5.x, konfigurasi SSL/TLS sering dilakukan melalui connection manager/TLS strategy, bukan sekadar `setSSLSocketFactory` seperti pola lama.

Use case umum:

- custom truststore,
- mTLS client certificate,
- TLS version restriction,
- hostname verification,
- corporate CA,
- certificate rotation.

Mental model:

```text
truststore
  → siapa yang client percaya sebagai server

keystore
  → identitas client saat mTLS

hostname verifier
  → apakah certificate cocok dengan hostname target

TLS strategy/socket factory
  → bagaimana koneksi TLS dibuat untuk route
```

Anti-pattern berbahaya:

```java
TrustStrategy trustAll = (chain, authType) -> true;
```

atau hostname verifier yang selalu true.

Dampak:

- MITM protection hilang,
- compliance failure,
- production traffic bisa diintercept,
- audit finding.

Rule:

```text
Never disable certificate validation in production.
```

Untuk mTLS, desain yang baik:

- cert/key dari secure store,
- rotation plan,
- expiry monitoring,
- environment-specific trust,
- no private key in repository,
- no debug logging key material,
- test handshake failure explicitly.

---

## 15. Cookie Store dan Stateful HTTP

Apache HttpClient mendukung cookie management.

Use case:

- login session ke legacy system,
- CSRF token flow,
- stateful third-party web endpoint,
- scraping-like internal automation.

Namun pada backend service modern, cookie sering tidak ideal.

Risiko:

- shared cookie store antar tenant,
- session leak,
- sticky state tidak terlihat,
- sulit di-scale,
- race condition jika client singleton menyimpan cookie global.

Rule:

```text
Jika client singleton dipakai multi-user/multi-tenant,
jangan gunakan shared mutable CookieStore tanpa isolation.
```

Lebih aman:

- stateless token header,
- cookie store per session/tenant,
- explicit state object,
- wrapper yang jelas.

---

## 16. Interceptors dan Execution Chain

Apache HttpClient mendukung interceptor di request/response execution chain.

Use case:

- add correlation ID,
- add user-agent,
- add auth header,
- redact logging,
- measure latency,
- enforce header policy,
- response classification.

Namun jangan jadikan interceptor sebagai tempat semua business logic.

Layering yang baik:

```text
Transport interceptor:
  correlation, user-agent, low-level logging, metrics tags

Auth component:
  token injection, refresh coordination

Resilience wrapper:
  retry, circuit breaker, timeout budget

Domain client:
  DTO mapping, error taxonomy, semantic handling
```

Anti-pattern:

```text
Interceptor melakukan:
- parsing business response,
- retry semantic POST,
- refresh token tanpa concurrency guard,
- logging full body sensitif,
- swallow exception.
```

---

## 17. Automatic Retry vs Semantic Retry

Apache HttpClient bisa memiliki mekanisme retry tertentu. Tetapi production-grade client sebaiknya membedakan:

```text
transport retry
  → recovery dari low-level failure tertentu sebelum request jelas terkirim

semantic retry
  → retry berdasarkan status code/domain semantics/idempotency
```

Untuk sistem kritikal, sering lebih aman:

```java
HttpClients.custom()
    .disableAutomaticRetries()
    .build();
```

Lalu retry dilakukan di wrapper dengan policy eksplisit:

- hanya method aman/idempotent,
- status code tertentu,
- exception tertentu,
- body repeatable,
- deadline-aware,
- retry budget,
- metrics.

Contoh decision:

| Scenario | Retry? |
|---|---|
| DNS NXDOMAIN | tidak, kecuali transient infra case |
| Connect timeout | mungkin, jika budget cukup |
| TLS handshake failed | biasanya tidak |
| 401 expired token | refresh token sekali, lalu retry |
| 403 | tidak |
| 404 | biasanya tidak |
| 408 | mungkin |
| 429 + Retry-After | mungkin jika budget dan policy mengizinkan |
| 500/502/503/504 | mungkin untuk idempotent request |
| POST payment tanpa idempotency key | tidak |
| POST command dengan idempotency key | mungkin |

---

## 18. Error Modelling dengan Apache HttpClient

Jangan expose exception Apache langsung ke domain layer.

Buruk:

```java
public OrderResponse createOrder(OrderRequest request) throws IOException
```

Lebih baik:

```java
public CreateOrderResult createOrder(CreateOrderCommand command)
```

Dengan internal taxonomy:

```text
ExternalApiFailure
  ├── TransportFailure
  │   ├── DnsFailure
  │   ├── ConnectFailure
  │   ├── TimeoutFailure
  │   ├── TlsFailure
  │   └── ConnectionResetFailure
  ├── ProtocolFailure
  │   ├── InvalidStatusFailure
  │   ├── MalformedBodyFailure
  │   └── UnsupportedContentTypeFailure
  ├── RemoteServiceFailure
  │   ├── RateLimited
  │   ├── Unauthorized
  │   ├── Forbidden
  │   ├── NotFound
  │   └── ServerError
  └── DomainFailure
      ├── RejectedByProvider
      ├── DuplicateRequest
      └── ValidationRejected
```

Dengan taxonomy ini, kamu bisa menentukan:

- retryable atau tidak,
- alert atau tidak,
- user-facing message,
- audit event,
- fallback behavior,
- circuit breaker classification.

---

## 19. Observability: Apa yang Harus Diukur

Apache HttpClient tidak otomatis membuat sistem observable. Kamu perlu wrapper/interceptor/metric layer.

Metric minimum:

```text
http.client.requests.total
http.client.duration
http.client.errors.total
http.client.timeouts.total
http.client.retries.total
http.client.pool.leased
http.client.pool.available
http.client.pool.pending
http.client.pool.max
```

Dimensi yang aman:

```text
client_name
route_name logical, bukan full URL
method
status_family
outcome
exception_type normalized
retry_attempt
```

Hindari cardinality tinggi:

```text
full URL dengan ID
query parameter
user ID
raw exception message berisi host dinamis/token
request body hash tanpa policy
```

Logging minimum:

- method,
- logical endpoint,
- status,
- duration,
- attempt,
- correlation ID,
- retry decision,
- timeout type,
- redacted error summary.

Jangan log:

- Authorization,
- API key,
- cookie,
- personal data,
- full request/response body tanpa redaction,
- client certificate/private key detail.

---

## 20. Threading dan Java 8–25

### 20.1 Java 8–17

Classic Apache client memblokir thread caller.

Artinya kamu perlu:

- thread pool sizing,
- short timeout,
- bounded queue,
- bulkhead,
- no unbounded fan-out,
- pool limit matching.

### 20.2 Java 21+ Virtual Threads

Dengan virtual threads, blocking I/O menjadi lebih murah dari sisi thread-per-request model.

Namun virtual threads **tidak menghilangkan**:

- downstream capacity limit,
- connection pool limit,
- rate limit,
- timeout budget,
- retry storm,
- memory pressure dari payload,
- NAT/ephemeral port pressure.

Rule:

```text
Virtual threads mengurangi biaya blocking thread,
bukan menghapus kebutuhan bulkhead dan timeout.
```

### 20.3 Async API

Async API cocok jika:

- concurrency sangat tinggi,
- gateway/proxy,
- streaming,
- HTTP/2 multiplexing eksplisit,
- existing architecture async.

Tetapi jangan memilih async hanya karena terlihat modern. Complexity harus sepadan dengan workload.

---

## 21. Apache HttpClient 5 vs JDK HttpClient vs OkHttp

| Area | Apache HttpClient 5 | JDK HttpClient | OkHttp |
|---|---|---|---|
| Dependency | external | built-in JDK 11+ | external |
| Java 8 support | yes | no native JDK API | yes |
| Classic blocking | strong | yes | yes |
| Async | yes | CompletableFuture | callback/call |
| Connection manager control | very strong | limited/less exposed | moderate/simple |
| Per-route pool limit | strong | less explicit | per-host dispatcher/pool behavior |
| Proxy enterprise | strong | decent | decent |
| TLS customization | strong but verbose | SSLContext | strong ergonomic |
| Interceptors | yes | not as ergonomic | excellent |
| Retrofit integration | indirect/custom | not standard | default/common |
| Migration from legacy enterprise | excellent | rewrite often needed | rewrite often needed |
| Ergonomics | verbose | moderate | high |
| Governance/configurability | high | moderate | high but simpler |

Decision summary:

```text
Use JDK HttpClient:
  when dependency-free Java 11+ standard client is enough.

Use OkHttp:
  when you want ergonomic client, interceptors, Retrofit, HTTP/2, compact configuration.

Use Retrofit:
  when API contract is best represented as typed interface.

Use Apache HttpClient 5:
  when you need enterprise connection/proxy/TLS/route/config control, or migrate from Apache 4.x.
```

---

## 22. Migration dari Apache HttpClient 4.x ke 5.x

Dokumentasi Apache merekomendasikan migrasi ke classic API sebagai langkah pertama ketika berpindah dari 4.x ke 5.x. Ini masuk akal karena classic API paling dekat dengan mental model 4.x.

### 22.1 Perubahan Besar

| Area | 4.x | 5.x |
|---|---|---|
| Package | `org.apache.http.*` | `org.apache.hc.*` |
| Timeout types | int milliseconds umum | `Timeout`, `TimeValue` |
| TLS config | banyak via socket factory lama | lebih banyak via connection manager/TLS strategy |
| Classic API | familiar | similar but updated |
| Async API | ada, tapi berbeda | redesigned/lebih modern |
| URL normalization | berbeda detail | perlu test ulang |
| Maven coordinates | berbeda | bisa coexist dengan 4.x |

### 22.2 Migration Strategy

Jangan migrasi dengan find-replace import saja.

Langkah aman:

```text
1. Inventory semua usage HttpClient 4.x.
2. Kelompokkan berdasarkan external API/downstream.
3. Identifikasi timeout/pool/retry/auth behavior existing.
4. Buat shared HttpClient 5 factory.
5. Migrasi satu client/domain adapter dulu.
6. Tambahkan contract test dan fault test.
7. Bandingkan behavior status/error/redirect/encoding.
8. Rollout bertahap.
9. Remove HttpClient 4.x dependency setelah semua clear.
```

### 22.3 Migration Trap

Trap umum:

- lupa set timeout karena API berubah,
- SSL config lama tidak lagi berlaku,
- response entity tidak dikonsumsi,
- redirect behavior berubah,
- URL encoding/normalization berubah,
- exception type berubah sehingga retry classifier rusak,
- pool default berbeda dari asumsi lama,
- dependency conflict dengan library lain.

### 22.4 Coexistence Pattern

Karena namespace berbeda, 4.x dan 5.x bisa coexist dalam transisi. Tetapi jangan biarkan permanen tanpa governance.

Buat migration tracker:

```text
client_name | current_library | target_library | owner | risk | test_status | rollout_status
```

---

## 23. Wrapper Architecture yang Disarankan

Jangan expose Apache HttpClient ke service layer.

Buruk:

```java
class OrderService {
    private final CloseableHttpClient httpClient;

    public void submit() {
        HttpPost post = new HttpPost(...);
        // auth, JSON, timeout, error parsing tersebar di sini
    }
}
```

Baik:

```text
OrderService
  → PaymentGatewayPort
      → ApachePaymentGatewayClient
          → ApacheHttpTransport
              → CloseableHttpClient
```

Contoh struktur:

```text
external/payment/
  PaymentGatewayPort.java
  PaymentGatewayClient.java
  PaymentClientConfig.java
  PaymentAuthProvider.java
  PaymentErrorMapper.java
  PaymentDtoMapper.java
  ApacheHttpTransport.java
  PaymentClientMetrics.java
```

Keuntungan:

- domain tidak tergantung Apache,
- migrasi library lebih mudah,
- error taxonomy konsisten,
- retry policy domain-aware,
- observability terpusat,
- test lebih mudah.

---

## 24. Production Configuration Pattern

Contoh config logical:

```yaml
clients:
  payment:
    base-url: https://api.payment.example
    connection-request-timeout-ms: 100
    connect-timeout-ms: 300
    response-timeout-ms: 1500
    max-total-connections: 100
    max-connections-per-route: 50
    idle-evict-seconds: 30
    ttl-seconds: 300
    retry:
      max-attempts: 2
      backoff-ms: 100
      jitter: true
    circuit-breaker:
      enabled: true
      failure-rate-threshold: 50
    proxy:
      enabled: false
```

Startup validation:

- timeout tidak boleh nol/infinite kecuali sengaja,
- response timeout < caller deadline,
- retry max attempts masuk budget,
- max per route <= max total,
- base URL scheme harus HTTPS untuk external API,
- secret tidak boleh kosong,
- cert expiry warning.

---

## 25. Testing Apache HttpClient Client

Testing layer:

```text
Unit test:
  mapper, error classifier, retry decider

HTTP contract test:
  WireMock / MockServer / local test server

Fault test:
  timeout, 429, 500, malformed body, connection reset

Integration test:
  real sandbox downstream

Load test:
  pool behavior, latency, saturation
```

Test cases wajib:

1. 2xx valid response.
2. 4xx with error body.
3. 5xx retryable.
4. 429 with `Retry-After`.
5. malformed JSON.
6. empty body.
7. slow response timeout.
8. connection refused.
9. TLS handshake failure.
10. response body large.
11. auth token redaction.
12. pool saturation.

Untuk pool saturation test, buat server lambat lalu kirim concurrency > max per route. Pastikan:

- pending connection tidak infinite,
- `connectionRequestTimeout` terjadi,
- metric pool pending terlihat,
- caller tidak hang.

---

## 26. Failure Playbook

### 26.1 Symptom: Banyak Timeout

Tanya:

```text
Timeout jenis apa?
- connection request timeout?
- connect timeout?
- response timeout?
- socket inactivity timeout?
```

Diagnosis:

| Timeout | Kemungkinan Penyebab |
|---|---|
| connection request timeout | pool penuh, response body leak, downstream slow |
| connect timeout | network path, firewall, DNS target mati, LB issue |
| response timeout | downstream lambat, query lambat, overloaded service |
| socket timeout | slow streaming, idle connection issue |

### 26.2 Symptom: Pool Exhausted

Cek:

- leased connection,
- available connection,
- pending connection,
- max per route,
- response body close,
- latency downstream,
- concurrency caller,
- retry amplification.

Mitigasi:

- turunkan concurrency,
- buka circuit breaker,
- kurangi retry,
- tambah timeout? hati-hati, bisa memperburuk pool occupancy,
- naikkan pool hanya jika downstream mampu,
- perbaiki body leak.

### 26.3 Symptom: TLS Failure

Cek:

- cert expired,
- hostname mismatch,
- missing intermediate CA,
- wrong truststore,
- mTLS client cert expired,
- TLS protocol/cipher mismatch,
- proxy TLS inspection.

### 26.4 Symptom: 401 Spike

Cek:

- token expired,
- refresh failure,
- clock skew,
- credential rotated,
- redirect kehilangan header,
- auth server down,
- thundering herd refresh.

---

## 27. Anti-Pattern yang Harus Dihindari

### 27.1 Membuat Client Per Request

Buruk:

```java
try (CloseableHttpClient client = HttpClients.createDefault()) {
    client.execute(request, handler);
}
```

Dampak:

- pool tidak efektif,
- TLS handshake berulang,
- latency naik,
- resource churn.

Baik:

```text
Buat client per downstream/config profile, reuse sepanjang lifecycle aplikasi.
```

### 27.2 Tidak Mengatur Timeout

Dampak:

- thread hang,
- pool penuh,
- cascading failure.

### 27.3 Tidak Consume Entity

Dampak:

- connection tidak kembali ke pool,
- pool starvation,
- timeout di request berikutnya.

### 27.4 Retry di Banyak Layer

```text
Apache automatic retry
+ custom interceptor retry
+ Resilience4j retry
+ service mesh retry
+ upstream retry
= outage multiplier
```

### 27.5 Trust-All TLS

Dampak:

- security boundary hilang,
- compliance failure.

### 27.6 Logging Full Body

Dampak:

- data leak,
- PII exposure,
- token leak,
- log cost spike.

---

## 28. Top 1% Heuristics untuk Apache HttpClient 5

Engineer biasa bertanya:

```text
Bagaimana cara call API pakai Apache HttpClient?
```

Engineer senior bertanya:

```text
Apa timeout setiap fase?
Apa pool limit per downstream?
Apa retry semantics?
Apa body repeatable?
Apa yang terjadi kalau response body tidak habis dibaca?
Apa error taxonomy-nya?
Apa metric pool-nya?
Apa credential lifecycle-nya?
Apa proxy/TLS route-nya?
Apa migration risk dari 4.x?
```

Heuristics:

1. **Client harus reused**, bukan dibuat per call.
2. **Pool harus bounded**, bukan default tanpa dipahami.
3. **Connection request timeout harus pendek** untuk mendeteksi saturation.
4. **Response body harus dikonsumsi/ditutup**.
5. **Retry harus domain-aware**, bukan automatic blind retry.
6. **TLS validation tidak boleh dimatikan**.
7. **Proxy dan redirect harus dianggap security boundary**.
8. **Apache object tidak boleh bocor ke domain layer**.
9. **Timeout harus mengikuti deadline**, bukan angka random.
10. **Metric pool wajib ada** untuk diagnosis production.
11. **Migration dari 4.x perlu behavior test**, bukan hanya compile fix.
12. **Virtual threads bukan alasan menghapus bulkhead**.

---

## 29. Design Review Checklist

Gunakan checklist ini sebelum approve HTTP client berbasis Apache HttpClient 5.

### 29.1 Lifecycle

- [ ] `CloseableHttpClient` dibuat singleton/per downstream config.
- [ ] Client ditutup saat application shutdown.
- [ ] Tidak ada client creation per request.

### 29.2 Pool

- [ ] `PoolingHttpClientConnectionManager` digunakan untuk production throughput.
- [ ] `maxTotal` diset eksplisit.
- [ ] `defaultMaxPerRoute` diset eksplisit.
- [ ] Idle eviction dikonfigurasi.
- [ ] Expired connection eviction dikonfigurasi.
- [ ] Pool metrics tersedia.

### 29.3 Timeout

- [ ] `connectionRequestTimeout` diset.
- [ ] `connectTimeout` diset di connection config/manager layer.
- [ ] `responseTimeout` diset.
- [ ] Timeout sesuai operation deadline.
- [ ] Retry tidak membuat total durasi melewati caller timeout.

### 29.4 Body

- [ ] Response entity selalu dikonsumsi/ditutup.
- [ ] Large response tidak dibaca seluruhnya ke memory.
- [ ] Request body repeatability dipahami.
- [ ] Multipart/file upload punya timeout dan size limit.

### 29.5 Auth/Security

- [ ] Authorization header di-redact.
- [ ] Token refresh concurrency-safe.
- [ ] Redirect tidak membocorkan credential ke host lain.
- [ ] TLS validation tidak dimatikan.
- [ ] Truststore/keystore dikelola aman.
- [ ] Proxy credential aman.

### 29.6 Resilience

- [ ] Automatic retry dipahami atau dimatikan.
- [ ] Semantic retry berada di wrapper/policy layer.
- [ ] Circuit breaker/bulkhead/rate limiter terintegrasi.
- [ ] Failure classifier jelas.

### 29.7 Observability

- [ ] Metrics latency/status/error tersedia.
- [ ] Pool metrics tersedia.
- [ ] Correlation ID dikirim.
- [ ] Trace context dipropagasi jika digunakan.
- [ ] Log tidak mengandung secret/PII.

### 29.8 Testing

- [ ] 2xx/4xx/5xx diuji.
- [ ] Timeout diuji.
- [ ] 429 diuji.
- [ ] malformed body diuji.
- [ ] pool saturation diuji.
- [ ] TLS/proxy scenario diuji jika relevan.

---

## 30. Ringkasan Mental Model

Apache HttpClient 5 adalah pilihan kuat ketika kamu membutuhkan HTTP client yang:

- configurable,
- explicit,
- enterprise-friendly,
- mature,
- connection-manager-oriented,
- compatible dengan Java 8+,
- cocok untuk migration dari Apache 4.x,
- bisa dipakai dalam classic maupun async style.

Tetapi kekuatannya datang dengan konsekuensi:

```text
Lebih banyak kontrol berarti lebih banyak tanggung jawab desain.
```

Jika kamu tidak mengatur pool, timeout, TLS, retry, entity lifecycle, dan observability dengan benar, Apache HttpClient 5 tidak otomatis membuat sistemmu production-grade.

Final mental model:

```text
Apache HttpClient 5 = configurable HTTP transport engine.
Production-grade API client = Apache transport + domain wrapper + timeout budget + resilience policy + observability + security boundary + test harness.
```

---

## 31. Transisi ke Part Berikutnya

Part ini menyelesaikan pembahasan library-level deep dive untuk Apache HttpClient 5.

Part berikutnya akan membahas **Spring HTTP Client Layer: RestTemplate, WebClient, RestClient**.

Di sana fokusnya bukan sekadar API Spring, tetapi bagaimana Spring membungkus transport client seperti JDK HttpClient, Apache HttpClient, Reactor Netty, dan Jetty; serta bagaimana memilih blocking/reactive/client connector yang tepat dalam aplikasi Spring modern.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./16-retrofit-deep-dive-type-safe-api-client-over-okhttp.md">⬅️ Part 16 — Retrofit Deep Dive: Type-Safe API Client di Atas OkHttp</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./18-spring-http-client-layer-resttemplate-webclient-restclient.md">Part 18 — Spring HTTP Client Layer: RestTemplate, WebClient, RestClient ➡️</a>
</div>
