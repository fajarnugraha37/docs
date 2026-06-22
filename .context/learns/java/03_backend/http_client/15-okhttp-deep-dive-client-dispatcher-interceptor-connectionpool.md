# Part 15 — OkHttp Deep Dive: Client, Dispatcher, Interceptor, ConnectionPool

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `15-okhttp-deep-dive-client-dispatcher-interceptor-connectionpool.md`  
> Scope: Java 8 hingga Java 25, JVM/backend-oriented, tetap relevan untuk Android tetapi fokus utama adalah production backend/service integration.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membangun mental model besar tentang lifecycle HTTP request, timeout, connection pool, DNS, TLS, authentication, retry, rate limiting, dan circuit breaker. Part ini memperdalam satu engine spesifik: **OkHttp**.

Tujuan utama part ini bukan agar kita hanya bisa menulis:

```java
OkHttpClient client = new OkHttpClient();
Request request = new Request.Builder()
    .url("https://api.example.com/users")
    .build();
Response response = client.newCall(request).execute();
```

Itu hanya permukaan. Engineer yang matang harus paham bahwa OkHttp adalah:

1. **HTTP engine** yang mengelola request lifecycle.
2. **Connection manager** yang melakukan reuse koneksi.
3. **Concurrency coordinator** lewat `Dispatcher`.
4. **Policy injection point** lewat interceptor.
5. **Observability source** lewat `EventListener`.
6. **TLS/network abstraction** lewat `Dns`, `Proxy`, `SocketFactory`, `SSLSocketFactory`, `CertificatePinner`, dan konfigurasi lain.
7. **Foundation layer** untuk Retrofit dan banyak SDK Java/Kotlin.

Mental model yang ingin dicapai:

```text
OkHttpClient
  bukan "object untuk call HTTP"
  tetapi "stateful reusable engine" yang membawa:
    - connection pool
    - dispatcher
    - timeout policy
    - DNS/proxy/TLS policy
    - interceptor chain
    - cache
    - cookie jar
    - event listener
    - retry/follow-up behavior
```

---

## 2. Kapan OkHttp Menjadi Pilihan yang Kuat?

OkHttp cocok ketika kita butuh:

- Java 8 compatibility.
- HTTP/1.1 dan HTTP/2 support tanpa bergantung pada Java 11+ `HttpClient`.
- Connection pooling yang matang.
- Interceptor chain yang fleksibel.
- Integrasi Retrofit.
- Custom DNS/proxy/TLS behavior.
- Request/response logging yang bisa dikontrol.
- Certificate pinning.
- Android compatibility, bila codebase berbagi client layer dengan Android/Kotlin ecosystem.
- SDK client yang bersih dan composable.

OkHttp tidak selalu pilihan terbaik bila:

- Kita ingin pure JDK dependency minimal pada Java 11+.
- Kita butuh Apache HttpClient-specific feature seperti route planner yang sangat kompleks, connection manager enterprise, atau integrasi legacy Apache stack.
- Kita sudah heavily invested di Spring `WebClient` reactive stack.
- Kita butuh streaming/reactive backpressure penuh di level framework.

Decision rule sederhana:

```text
Butuh Java 8 + production-grade HTTP + interceptor + Retrofit-friendly?
  OkHttp sangat kuat.

Butuh no external dependency di Java 11+?
  Pertimbangkan JDK HttpClient.

Butuh enterprise connection routing/proxy/client config detail-heavy?
  Pertimbangkan Apache HttpClient 5.

Butuh type-safe declarative API client?
  Retrofit + OkHttp.
```

---

## 3. Core Object Model OkHttp

Objek utama OkHttp:

| Object | Fungsi | Production meaning |
|---|---|---|
| `OkHttpClient` | Engine utama | Harus reusable/singleton per policy group |
| `OkHttpClient.Builder` | Builder config | Tempat policy default client dibuat |
| `Request` | Immutable HTTP request | Merepresentasikan method, URL, headers, body |
| `RequestBody` | Body outbound | Bisa repeatable atau one-shot tergantung implementasi |
| `Call` | Satu prepared request execution | Satu call hanya bisa dieksekusi sekali |
| `Response` | HTTP response | Harus ditutup agar resource kembali |
| `ResponseBody` | Stream body inbound | Boundary memory/streaming/leak |
| `Interceptor` | Middleware call chain | Auth, header, logging, retry, mapping tertentu |
| `Dispatcher` | Async/sync call coordinator | Concurrency limit dan queue control |
| `ConnectionPool` | Pool koneksi reusable | Latency/resource optimization |
| `EventListener` | Lifecycle telemetry hook | Observability per fase request |
| `Dns` | Hostname resolver abstraction | Custom DNS, testing, topology control |
| `CookieJar` | Cookie storage | Session/cookie policy |
| `Cache` | HTTP response cache | Conditional request/cache semantics |

---

## 4. `OkHttpClient`: Engine Harus Reusable

Kesalahan paling umum:

```java
public String call(String url) throws IOException {
    OkHttpClient client = new OkHttpClient(); // buruk
    Request request = new Request.Builder().url(url).build();
    try (Response response = client.newCall(request).execute()) {
        return response.body().string();
    }
}
```

Kenapa buruk?

Karena setiap `OkHttpClient` membawa state penting:

- connection pool,
- dispatcher,
- thread/executor behavior,
- cache,
- DNS/proxy/TLS config,
- cookie jar,
- interceptor chain.

Kalau client dibuat per request:

- connection reuse hilang,
- TLS handshake lebih sering,
- latency meningkat,
- socket churn naik,
- ephemeral port pressure naik,
- memory/thread overhead naik,
- observability menjadi tidak konsisten.

Pattern yang lebih benar:

```java
public final class ExternalApiHttpClientFactory {

    private final OkHttpClient sharedClient;

    public ExternalApiHttpClientFactory() {
        this.sharedClient = new OkHttpClient.Builder()
            .connectTimeout(java.time.Duration.ofSeconds(2))
            .readTimeout(java.time.Duration.ofSeconds(5))
            .writeTimeout(java.time.Duration.ofSeconds(5))
            .callTimeout(java.time.Duration.ofSeconds(8))
            .build();
    }

    public OkHttpClient client() {
        return sharedClient;
    }
}
```

Untuk Java 8, tergantung versi OkHttp, API timeout berbasis `long + TimeUnit` sering dipakai:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(2, java.util.concurrent.TimeUnit.SECONDS)
    .readTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
    .writeTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
    .callTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
    .build();
```

Prinsipnya:

```text
1 downstream policy group = 1 reusable OkHttpClient
```

Contoh policy group:

- `paymentClient`
- `identityProviderClient`
- `documentStorageClient`
- `notificationGatewayClient`
- `internalUserServiceClient`

Jangan membuat satu global client untuk semua downstream bila policy berbeda drastis:

- timeout berbeda,
- auth berbeda,
- TLS berbeda,
- proxy berbeda,
- rate limit berbeda,
- logging/redaction berbeda,
- cache berbeda.

---

## 5. `Request`: Immutable Intent, Bukan String URL

`Request` membawa:

- URL,
- method,
- headers,
- optional body,
- tag metadata.

Contoh:

```java
Request request = new Request.Builder()
    .url("https://api.example.com/v1/users/123")
    .header("Accept", "application/json")
    .header("X-Correlation-Id", correlationId)
    .get()
    .build();
```

Gunakan `HttpUrl` untuk konstruksi URL kompleks:

```java
HttpUrl url = new HttpUrl.Builder()
    .scheme("https")
    .host("api.example.com")
    .addPathSegment("v1")
    .addPathSegment("users")
    .addQueryParameter("status", "ACTIVE")
    .addQueryParameter("page", "1")
    .build();

Request request = new Request.Builder()
    .url(url)
    .build();
```

Kenapa penting?

Karena URL bukan string biasa. Salah encoding dapat menyebabkan:

- path berubah,
- query salah terbaca,
- signature mismatch,
- cache key salah,
- authorization bypass,
- SSRF validation bypass.

Rule:

```text
Gunakan builder untuk URL dinamis.
String literal boleh untuk URL statis sederhana.
```

---

## 6. `Call`: Satu Execution Unit

`Call` adalah binding antara `OkHttpClient` dan `Request`.

```java
Call call = client.newCall(request);
```

Satu `Call` hanya boleh dieksekusi sekali:

```java
Response response = call.execute();
// call.execute(); // tidak boleh dipakai ulang
```

Jika perlu retry manual, buat `Call` baru dari request yang sama:

```java
Call first = client.newCall(request);
Call second = client.newCall(request);
```

Tapi retry manual tidak boleh sembarang. Harus mempertimbangkan:

- method idempotency,
- body repeatability,
- timeout budget,
- retry budget,
- status code,
- exception type,
- side effect downstream.

---

## 7. Synchronous Execution

Contoh benar:

```java
Request request = new Request.Builder()
    .url("https://api.example.com/v1/users/123")
    .build();

try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        throw new IOException("Unexpected status: " + response.code());
    }

    ResponseBody body = response.body();
    if (body == null) {
        throw new IOException("Empty response body");
    }

    String json = body.string();
    return json;
}
```

`try-with-resources` penting karena `Response` harus ditutup. Menutup response akan menutup body stream dan memungkinkan resource dikembalikan/discard sesuai keadaan.

Anti-pattern:

```java
Response response = client.newCall(request).execute();
return response.body().string(); // response tidak ditutup eksplisit
```

Lebih buruk:

```java
Response response = client.newCall(request).execute();
InputStream stream = response.body().byteStream();
// stream tidak dibaca sampai selesai dan tidak ditutup
```

Dampak:

- connection tidak kembali ke pool,
- pool starvation,
- socket leak,
- latency naik,
- timeout meningkat,
- thread menunggu koneksi.

---

## 8. Asynchronous Execution dan `Dispatcher`

Async call:

```java
client.newCall(request).enqueue(new Callback() {
    @Override
    public void onFailure(Call call, IOException e) {
        // transport/cancellation failure
    }

    @Override
    public void onResponse(Call call, Response response) throws IOException {
        try (response) {
            if (!response.isSuccessful()) {
                // handle status
                return;
            }
            String body = response.body() != null ? response.body().string() : "";
            // process body
        }
    }
});
```

Async bukan berarti tanpa resource cost. Async call dikoordinasikan oleh `Dispatcher`.

`Dispatcher` mengatur:

- maksimum request berjalan global,
- maksimum request berjalan per host,
- queue request async,
- executor service.

Contoh konfigurasi:

```java
Dispatcher dispatcher = new Dispatcher();
dispatcher.setMaxRequests(128);
dispatcher.setMaxRequestsPerHost(32);

OkHttpClient client = new OkHttpClient.Builder()
    .dispatcher(dispatcher)
    .build();
```

Makna production:

```text
Dispatcher adalah concurrency control internal OkHttp.
Ia bukan pengganti rate limiter, bulkhead domain, atau admission control aplikasi.
```

Kalau `maxRequests` terlalu tinggi:

- thread meningkat,
- downstream bisa overload,
- pool/socket pressure naik,
- NAT pressure naik,
- memory queue naik.

Kalau terlalu rendah:

- throughput rendah,
- queue time tinggi,
- caller latency naik.

Gunakan dispatcher limit bersama:

- external API SLA,
- timeout budget,
- rate limit,
- downstream capacity,
- thread model aplikasi.

---

## 9. Dispatcher vs Bulkhead vs Rate Limiter

Jangan menyamakan semuanya.

| Mechanism | Mengontrol | Pertanyaan yang dijawab |
|---|---|---|
| Dispatcher | concurrent OkHttp async call | Berapa call OkHttp boleh aktif/queued? |
| ConnectionPool | idle/reusable connection | Berapa koneksi reusable disimpan? |
| Apache-like max per route | active connection route | Berapa koneksi aktif ke route? |
| Bulkhead | isolasi resource per dependency | Downstream A boleh memakai berapa resource? |
| Rate limiter | request per waktu | Berapa request/detik/menit boleh keluar? |
| Queue limit | backlog | Berapa request boleh menunggu? |
| Load shedding | reject early | Kapan harus gagal cepat? |

Pattern matang:

```text
incoming request
  → application bulkhead
  → rate limiter
  → retry/deadline policy
  → OkHttp call
  → dispatcher/pool internal
```

Jadi dispatcher berada di bawah application policy, bukan satu-satunya policy.

---

## 10. Interceptor Chain: Middleware yang Sangat Powerful

OkHttp interceptor bisa:

- membaca request,
- menambah/mengubah header,
- mencatat log,
- melakukan timing,
- memodifikasi response,
- mengimplementasikan auth,
- melakukan retry tertentu,
- short-circuit request,
- mengubah URL,
- inject trace context.

Interface dasar:

```java
public final class CorrelationIdInterceptor implements Interceptor {
    @Override
    public Response intercept(Chain chain) throws IOException {
        Request original = chain.request();
        String correlationId = CorrelationContext.currentOrCreate();

        Request enriched = original.newBuilder()
            .header("X-Correlation-Id", correlationId)
            .build();

        return chain.proceed(enriched);
    }
}
```

Register:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .addInterceptor(new CorrelationIdInterceptor())
    .build();
```

---

## 11. Application Interceptor vs Network Interceptor

OkHttp punya dua jenis interceptor:

```java
.addInterceptor(...)         // application interceptor
.addNetworkInterceptor(...)  // network interceptor
```

Perbedaan konseptual:

| Aspect | Application interceptor | Network interceptor |
|---|---|---|
| Level | Logical call | Actual network exchange |
| Redirect/retry internal | Melihat sebagai satu call logical | Bisa melihat network follow-up |
| Cache | Bisa short-circuit/cache-level behavior | Lebih dekat ke wire |
| Connection info | Tidak selalu punya | Bisa akses koneksi |
| Use case | auth, correlation, logging logical, domain policy | wire-level logging, headers setelah network transform, diagnostics |

Rule praktis:

```text
Default gunakan application interceptor.
Network interceptor hanya bila benar-benar butuh melihat network-level exchange.
```

Contoh application interceptor untuk bearer token:

```java
public final class BearerTokenInterceptor implements Interceptor {
    private final TokenProvider tokenProvider;

    public BearerTokenInterceptor(TokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        String token = tokenProvider.currentToken();

        Request request = chain.request().newBuilder()
            .header("Authorization", "Bearer " + token)
            .build();

        return chain.proceed(request);
    }
}
```

---

## 12. Interceptor Ordering

Ordering menentukan semantics.

Contoh chain:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .addInterceptor(new CorrelationIdInterceptor())
    .addInterceptor(new AuthInterceptor(tokenProvider))
    .addInterceptor(new RedactedLoggingInterceptor())
    .build();
```

Pertanyaan penting:

- Logging terjadi sebelum atau sesudah auth header ditambahkan?
- Redaction dijamin terjadi setelah sensitive header ada?
- Retry interceptor membungkus auth refresh atau sebaliknya?
- Trace header ditambahkan sebelum signing HMAC atau setelah?

Untuk HMAC signing, ordering bisa menentukan valid/tidaknya signature:

```text
correlation/header enrichment
  → canonicalization/signing
  → logging redacted
  → proceed
```

Kalau header ditambah setelah signing, signature bisa mismatch.

---

## 13. Auth Refresh di Interceptor: Hati-Hati

Naive implementation:

```java
public Response intercept(Chain chain) throws IOException {
    Request request = withToken(chain.request(), tokenProvider.currentToken());
    Response response = chain.proceed(request);

    if (response.code() == 401) {
        response.close();
        String newToken = tokenProvider.refreshToken();
        Request retried = withToken(chain.request(), newToken);
        return chain.proceed(retried);
    }

    return response;
}
```

Masalah:

- Banyak request paralel 401 bisa refresh token bersamaan.
- Response pertama harus ditutup sebelum retry.
- Body request harus repeatable.
- Retry 401 untuk POST bisa menduplikasi side effect bila server sebenarnya sudah memproses sebagian.
- Infinite loop jika token baru tetap invalid.
- Refresh call sendiri jangan memakai client yang interceptor-nya memanggil refresh lagi tanpa guard.

Pattern lebih aman:

```text
401 received
  → close response
  → refresh dengan single-flight lock
  → retry maksimal 1 kali
  → hanya untuk request yang body-nya repeatable/aman
  → emit metric auth.refresh.count / auth.retry.count
```

Pseudo-pattern:

```java
public final class TokenRefreshingInterceptor implements Interceptor {
    private final TokenProvider tokenProvider;

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request original = chain.request();
        Request first = authorize(original, tokenProvider.currentToken());

        Response firstResponse = chain.proceed(first);
        if (firstResponse.code() != 401) {
            return firstResponse;
        }

        firstResponse.close();

        String refreshed = tokenProvider.refreshSingleFlight();
        Request second = authorize(original, refreshed);
        return chain.proceed(second);
    }

    private Request authorize(Request request, String token) {
        return request.newBuilder()
            .header("Authorization", "Bearer " + token)
            .build();
    }
}
```

Tetap perlu guard tambahan:

- skip auth untuk token endpoint,
- max retry count,
- idempotency check,
- exception classification,
- token expiry skew.

---

## 14. Logging Interceptor: Useful tapi Berbahaya

Request/response logging membantu diagnosis, tetapi bisa membocorkan:

- access token,
- API key,
- cookie,
- personal data,
- request body sensitif,
- response body sensitif,
- signed URL,
- query parameter rahasia.

Bad logging:

```java
logger.info("Request: {} headers={} body={}", request.url(), request.headers(), body);
```

Better:

```text
method=POST
host=api.example.com
path=/v1/payment
status=502
duration_ms=823
correlation_id=...
retry_attempt=1
error_class=downstream_5xx
```

Redaction helper:

```java
private static final Set<String> SENSITIVE_HEADERS = Set.of(
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key"
);

private String safeHeader(String name, String value) {
    if (SENSITIVE_HEADERS.contains(name.toLowerCase(Locale.ROOT))) {
        return "<redacted>";
    }
    return value;
}
```

Guideline:

```text
Log metadata by default.
Log body only under explicit safe/debug mode with size limit and redaction.
Never log secrets.
```

---

## 15. `EventListener`: Observability Fase Lifecycle

Interceptor bagus untuk logical request/response. `EventListener` lebih cocok untuk lifecycle-level telemetry.

EventListener dapat mengamati fase seperti:

- call start,
- DNS start/end,
- connect start/end,
- secure connect start/end,
- connection acquired,
- request headers start/end,
- request body start/end,
- response headers start/end,
- response body start/end,
- connection released,
- call end/failure.

Contoh sederhana:

```java
public final class MetricsEventListener extends EventListener {
    private final long callStartNanos = System.nanoTime();

    @Override
    public void dnsStart(Call call, String domainName) {
        // record phase start
    }

    @Override
    public void connectStart(Call call, InetSocketAddress inetSocketAddress, Proxy proxy) {
        // record connect phase
    }

    @Override
    public void callEnd(Call call) {
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - callStartNanos);
        Metrics.record("http.client.duration", durationMs);
    }

    @Override
    public void callFailed(Call call, IOException ioe) {
        Metrics.increment("http.client.failure", "exception", ioe.getClass().getSimpleName());
    }
}
```

Register factory:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .eventListenerFactory(call -> new MetricsEventListener())
    .build();
```

Kenapa factory?

Karena tiap call butuh listener instance sendiri untuk menyimpan state timing fase.

Observability mature:

```text
interceptor = logical metadata, trace headers, status, business classification
EventListener = network phase timing, DNS/connect/TLS/pool lifecycle
```

---

## 16. `ConnectionPool`: Reuse dan Resource Control

OkHttp menggunakan `ConnectionPool` untuk reuse koneksi HTTP/1.1 dan HTTP/2.

Default biasanya cukup untuk banyak aplikasi, tetapi sistem high-throughput perlu memahami behavior-nya.

Contoh konfigurasi:

```java
ConnectionPool pool = new ConnectionPool(
    50,                    // max idle connections
    5, TimeUnit.MINUTES    // keep alive duration
);

OkHttpClient client = new OkHttpClient.Builder()
    .connectionPool(pool)
    .build();
```

Makna parameter:

- `maxIdleConnections`: jumlah koneksi idle yang disimpan.
- `keepAliveDuration`: berapa lama koneksi idle boleh dipertahankan sebelum dievict.

Penting:

```text
ConnectionPool mengatur idle reusable connection,
bukan secara langsung membatasi semua active in-flight request.
```

Untuk concurrency aktif, lihat `Dispatcher`, request volume, HTTP/2 stream concurrency, dan downstream behavior.

---

## 17. HTTP/1.1 vs HTTP/2 di OkHttp

HTTP/1.1:

```text
1 connection biasanya melayani 1 active request pada satu waktu.
Connection reuse terjadi setelah response selesai.
```

HTTP/2:

```text
1 connection dapat membawa banyak stream concurrent ke host yang sama.
Multiplexing mengurangi kebutuhan banyak socket.
```

Implikasi:

- HTTP/2 dapat menurunkan connection count.
- Tapi satu koneksi HTTP/2 bisa menjadi shared fate untuk banyak stream.
- Pool metrics harus dibaca dengan memahami protocol.
- Per-host dispatcher limit masih penting.
- Flow control dan stream reset bisa menjadi failure mode.

OkHttp memilih protocol berdasarkan:

- server support,
- TLS ALPN,
- client protocol config,
- platform capability.

Contoh membatasi protocol:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .protocols(List.of(Protocol.HTTP_2, Protocol.HTTP_1_1))
    .build();
```

Jangan disable HTTP/2 tanpa alasan. Tapi pada beberapa environment legacy/proxy/TLS inspection, HTTP/2 bisa perlu dimatikan sementara untuk diagnosis.

---

## 18. Response Body Lifecycle

`ResponseBody` adalah stream. Ia bukan sekadar string.

Cara aman untuk body kecil:

```java
try (Response response = client.newCall(request).execute()) {
    String body = response.body() != null ? response.body().string() : "";
}
```

Untuk body besar:

```java
try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        throw new IOException("Unexpected status: " + response.code());
    }

    ResponseBody body = response.body();
    if (body == null) {
        throw new IOException("Empty body");
    }

    try (InputStream in = body.byteStream();
         OutputStream out = Files.newOutputStream(targetPath)) {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
    }
}
```

Anti-pattern:

```java
String body1 = response.body().string();
String body2 = response.body().string(); // salah: body sudah consumed
```

`ResponseBody.string()` membaca seluruh body ke memory dan hanya bisa dikonsumsi sekali.

Rule:

```text
Small body → string()/bytes() boleh dengan limit.
Large body → stream.
Always close response/body.
```

---

## 19. Request Body: Repeatable vs One-Shot

Request body bisa berupa:

- JSON string,
- byte array,
- file,
- streaming source,
- multipart,
- form body.

JSON small body:

```java
MediaType JSON = MediaType.get("application/json; charset=utf-8");
RequestBody body = RequestBody.create(jsonString, JSON);

Request request = new Request.Builder()
    .url(url)
    .post(body)
    .build();
```

File upload:

```java
MediaType OCTET = MediaType.get("application/octet-stream");
RequestBody fileBody = RequestBody.create(file, OCTET);

Request request = new Request.Builder()
    .url(uploadUrl)
    .put(fileBody)
    .build();
```

Multipart:

```java
RequestBody multipart = new MultipartBody.Builder()
    .setType(MultipartBody.FORM)
    .addFormDataPart("metadata", metadataJson)
    .addFormDataPart(
        "file",
        file.getName(),
        RequestBody.create(file, MediaType.get("application/pdf"))
    )
    .build();
```

Critical question untuk retry:

```text
Apakah body bisa dikirim ulang dengan aman?
```

Streaming one-shot body mungkin tidak bisa retry setelah sebagian bytes terkirim. Jangan retry otomatis upload/POST streaming tanpa explicit idempotency design.

---

## 20. Timeout di OkHttp

OkHttp punya timeout utama:

- `connectTimeout`
- `readTimeout`
- `writeTimeout`
- `callTimeout`

Contoh:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .writeTimeout(5, TimeUnit.SECONDS)
    .callTimeout(8, TimeUnit.SECONDS)
    .build();
```

Makna:

| Timeout | Mengontrol |
|---|---|
| connect timeout | waktu membuat TCP connection |
| read timeout | idle time saat membaca response/socket |
| write timeout | idle time saat menulis request body |
| call timeout | total waktu logical call dari start sampai selesai |

`callTimeout` penting sebagai guard total. Tanpa call timeout, kombinasi redirect/retry/follow-up bisa membuat operasi lebih lama dari budget bisnis.

Pattern:

```text
connectTimeout < readTimeout <= callTimeout
retry total budget <= caller deadline
```

Contoh tidak sehat:

```text
connect=30s
read=60s
retry=3
caller SLA=2s
```

Itu bukan resilience. Itu delayed failure.

---

## 21. Per-Request Timeout dengan Interceptor Chain

OkHttp memungkinkan interceptor mengatur timeout chain pada call tertentu:

```java
public final class FastEndpointTimeoutInterceptor implements Interceptor {
    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();

        if (request.url().encodedPath().startsWith("/fast")) {
            return chain
                .withConnectTimeout(500, TimeUnit.MILLISECONDS)
                .withReadTimeout(1, TimeUnit.SECONDS)
                .withWriteTimeout(1, TimeUnit.SECONDS)
                .proceed(request);
        }

        return chain.proceed(request);
    }
}
```

Gunakan dengan disiplin. Jangan membuat policy tersebar tanpa governance.

Lebih baik:

```text
per downstream client default policy
+ optional explicit per endpoint override
+ documented reason
+ metrics tag endpoint class
```

---

## 22. Retry Internal OkHttp vs Application Retry

OkHttp punya behavior recovery tertentu, misalnya terhadap connection failure. Ini berguna, tetapi tidak sama dengan business retry.

OkHttp-level retry/recovery:

- koneksi gagal,
- alternate IP address,
- stale pooled connection,
- beberapa route/proxy issue,
- follow-up redirect/auth tertentu.

Application-level retry:

- 429,
- 503,
- 504,
- business transient error,
- idempotency key,
- retry budget,
- correlation metric,
- custom backoff/jitter.

Rule:

```text
OkHttp recovery = transport convenience.
Application retry = semantic policy.
```

Jangan berasumsi `retryOnConnectionFailure(true)` sudah cukup untuk resilience.

---

## 23. Redirect Behavior

OkHttp dapat follow redirect secara default.

Konfigurasi:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .followRedirects(true)
    .followSslRedirects(true)
    .build();
```

Security considerations:

- redirect dari HTTPS ke HTTP,
- redirect ke host tidak diizinkan,
- Authorization header leakage,
- signed URL leakage,
- SSRF via redirect,
- redirect loop.

Untuk regulated/internal system, sering lebih aman:

```text
- disable redirect otomatis untuk sensitive client, atau
- validate redirect target host/scheme sebelum follow.
```

---

## 24. DNS Customization

OkHttp `Dns` memungkinkan custom hostname resolution.

Contoh untuk testing:

```java
Dns fixedDns = hostname -> {
    if (hostname.equals("api.example.test")) {
        return List.of(InetAddress.getByName("127.0.0.1"));
    }
    return Dns.SYSTEM.lookup(hostname);
};

OkHttpClient client = new OkHttpClient.Builder()
    .dns(fixedDns)
    .build();
```

Use case:

- testing,
- custom resolver,
- service discovery integration,
- DNS telemetry,
- failover experiment,
- split horizon handling.

Hati-hati:

- jangan bypass DNS TTL sembarangan,
- jangan hardcode IP production tanpa rotation strategy,
- TLS hostname verification tetap berdasarkan hostname URL,
- custom DNS dapat merusak load balancing jika salah.

---

## 25. Proxy Configuration

Proxy selector:

```java
Proxy proxy = new Proxy(
    Proxy.Type.HTTP,
    new InetSocketAddress("proxy.internal", 8080)
);

OkHttpClient client = new OkHttpClient.Builder()
    .proxy(proxy)
    .build();
```

Proxy authenticator:

```java
Authenticator proxyAuthenticator = (route, response) -> {
    String credential = Credentials.basic("user", "password");
    return response.request().newBuilder()
        .header("Proxy-Authorization", credential)
        .build();
};

OkHttpClient client = new OkHttpClient.Builder()
    .proxy(proxy)
    .proxyAuthenticator(proxyAuthenticator)
    .build();
```

Risiko:

- credential proxy bocor ke origin server bila salah header,
- TLS inspection memengaruhi truststore,
- proxy idle timeout berbeda,
- proxy bisa mengubah header,
- proxy bisa downgrade protocol.

---

## 26. TLS, mTLS, Certificate Pinning di OkHttp

Certificate pinning:

```java
CertificatePinner certificatePinner = new CertificatePinner.Builder()
    .add("api.example.com", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
    .build();

OkHttpClient client = new OkHttpClient.Builder()
    .certificatePinner(certificatePinner)
    .build();
```

Pinning harus dipakai hati-hati:

- rotation certificate bisa membuat outage,
- perlu backup pin,
- environment berbeda perlu pin berbeda,
- proxy TLS inspection akan gagal,
- operational runbook wajib jelas.

mTLS memakai `SSLSocketFactory` dan `X509TrustManager`. Pattern detail sudah dibahas di Part 9. Di OkHttp, pastikan trust manager yang diberikan sesuai dengan socket factory.

Rule:

```text
Jangan pernah memakai trust-all manager di production.
Jangan disable hostname verification untuk “fix SSL”.
```

---

## 27. Cache di OkHttp

OkHttp mendukung HTTP response cache.

```java
Cache cache = new Cache(new File("/var/cache/my-client"), 50L * 1024L * 1024L);

OkHttpClient client = new OkHttpClient.Builder()
    .cache(cache)
    .build();
```

Cache efektif bila server mengirim header yang benar:

- `Cache-Control`,
- `ETag`,
- `Last-Modified`,
- `Expires`,
- `Vary`.

Risiko:

- caching response yang tenant-specific,
- caching data personal,
- stale authorization-dependent response,
- cache key salah karena header `Vary`,
- disk growth/config permission.

Backend service biasanya lebih sering memakai explicit domain cache dibanding HTTP cache otomatis, tetapi HTTP cache tetap berguna untuk API yang memang cache-friendly.

---

## 28. CookieJar

Default OkHttp tidak menyimpan cookie secara persistent seperti browser.

Untuk cookie/session API:

```java
CookieJar cookieJar = new CookieJar() {
    private final Map<String, List<Cookie>> store = new ConcurrentHashMap<>();

    @Override
    public void saveFromResponse(HttpUrl url, List<Cookie> cookies) {
        store.put(url.host(), cookies);
    }

    @Override
    public List<Cookie> loadForRequest(HttpUrl url) {
        return store.getOrDefault(url.host(), List.of());
    }
};

OkHttpClient client = new OkHttpClient.Builder()
    .cookieJar(cookieJar)
    .build();
```

Production caution:

- isolate cookie jar per tenant/user/session,
- avoid sharing user session cookies across requests,
- secure persistence if needed,
- clear cookies on logout,
- do not mix machine-to-machine client with browser-like cookie state unless required.

---

## 29. Retrofit di Atas OkHttp

Retrofit memakai OkHttp sebagai default HTTP engine. OkHttp client config tetap menentukan:

- timeout,
- pooling,
- interceptors,
- TLS,
- proxy,
- cache,
- dispatcher,
- event listener.

Contoh:

```java
OkHttpClient okHttp = new OkHttpClient.Builder()
    .addInterceptor(new CorrelationIdInterceptor())
    .addInterceptor(new BearerTokenInterceptor(tokenProvider))
    .callTimeout(8, TimeUnit.SECONDS)
    .build();

Retrofit retrofit = new Retrofit.Builder()
    .baseUrl("https://api.example.com/")
    .client(okHttp)
    .addConverterFactory(JacksonConverterFactory.create(objectMapper))
    .build();
```

Mental model:

```text
Retrofit = typed API facade.
OkHttp = transport engine.
```

Jangan menaruh semua policy di Retrofit interface. Transport policy tetap di OkHttp/client wrapper layer.

---

## 30. Production-Grade Wrapper Pattern

Jangan expose raw OkHttp ke seluruh aplikasi.

Buruk:

```java
@Service
public class UserService {
    @Autowired OkHttpClient client;

    public User getUser(String id) {
        // build URL, parse JSON, handle error, auth, retry semua di sini
    }
}
```

Lebih matang:

```text
Domain service
  → port/interface
  → external API client adapter
  → OkHttp transport wrapper
  → OkHttpClient
```

Contoh:

```java
public interface IdentityClient {
    IdentityUser getUserById(String userId) throws IdentityClientException;
}

public final class OkHttpIdentityClient implements IdentityClient {
    private final OkHttpClient client;
    private final HttpUrl baseUrl;
    private final ObjectMapper mapper;

    public OkHttpIdentityClient(OkHttpClient client, HttpUrl baseUrl, ObjectMapper mapper) {
        this.client = client;
        this.baseUrl = baseUrl;
        this.mapper = mapper;
    }

    @Override
    public IdentityUser getUserById(String userId) throws IdentityClientException {
        HttpUrl url = baseUrl.newBuilder()
            .addPathSegment("v1")
            .addPathSegment("users")
            .addPathSegment(userId)
            .build();

        Request request = new Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .get()
            .build();

        try (Response response = client.newCall(request).execute()) {
            return handleUserResponse(response);
        } catch (IOException e) {
            throw IdentityClientException.transportFailure(e);
        }
    }

    private IdentityUser handleUserResponse(Response response) throws IOException, IdentityClientException {
        int code = response.code();
        ResponseBody body = response.body();

        if (code == 404) {
            throw IdentityClientException.notFound();
        }
        if (code == 429) {
            throw IdentityClientException.rateLimited(response.header("Retry-After"));
        }
        if (code >= 500) {
            throw IdentityClientException.downstreamFailure(code);
        }
        if (code < 200 || code >= 300) {
            throw IdentityClientException.unexpectedStatus(code);
        }
        if (body == null) {
            throw IdentityClientException.invalidResponse("empty body");
        }

        return mapper.readValue(body.byteStream(), IdentityUser.class);
    }
}
```

Keuntungan:

- domain tidak tahu OkHttp,
- error taxonomy terkendali,
- JSON parsing terisolasi,
- URL construction aman,
- test lebih mudah,
- policy per downstream jelas.

---

## 31. Error Taxonomy dengan OkHttp

OkHttp dapat menghasilkan:

- `IOException` untuk transport failure,
- HTTP response dengan status non-2xx,
- body parse exception,
- timeout exception,
- TLS exception,
- unknown host/connect exception,
- cancellation exception.

Jangan mapping semua menjadi `RuntimeException` generik.

Contoh taxonomy:

```text
TransportFailure
  - DNS_FAILURE
  - CONNECT_TIMEOUT
  - READ_TIMEOUT
  - CONNECTION_RESET
  - TLS_HANDSHAKE_FAILURE

HttpFailure
  - UNAUTHORIZED
  - FORBIDDEN
  - NOT_FOUND
  - RATE_LIMITED
  - DOWNSTREAM_5XX
  - BAD_GATEWAY
  - SERVICE_UNAVAILABLE

ProtocolFailure
  - EMPTY_BODY
  - MALFORMED_JSON
  - UNSUPPORTED_CONTENT_TYPE
  - MISSING_REQUIRED_FIELD

DomainFailure
  - BUSINESS_REJECTED
  - INVALID_STATE
```

Classification drives:

- retry decision,
- circuit breaker recording,
- fallback decision,
- user-facing error,
- alert severity,
- audit trail.

---

## 32. Cancellation

Sync call:

```java
Call call = client.newCall(request);

Future<?> future = executor.submit(() -> {
    try (Response response = call.execute()) {
        // handle
    } catch (IOException e) {
        // if canceled, IOException may be thrown
    }
});

// later
call.cancel();
```

Async call:

```java
Call call = client.newCall(request);
call.enqueue(callback);

// later
call.cancel();
```

Cancellation matters for:

- client request aborted by caller,
- deadline exceeded,
- user disconnect,
- structured concurrency cancellation,
- shutdown.

Policy:

```text
If caller no longer needs result, cancel outbound call.
Do not let orphan HTTP calls continue consuming resources.
```

---

## 33. Virtual Threads and OkHttp

OkHttp synchronous API works well with Java 21+ virtual threads for many backend use cases:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<User> future = executor.submit(() -> identityClient.getUserById("123"));
    User user = future.get();
}
```

But virtual threads do not remove need for:

- timeout,
- rate limit,
- bulkhead,
- connection pool awareness,
- downstream capacity planning,
- cancellation,
- observability.

Virtual threads reduce cost of blocked Java threads, but they do not make downstream infinite.

Rule:

```text
Virtual threads solve thread scalability pressure.
They do not solve downstream overload, retry storm, NAT exhaustion, or bad timeout policy.
```

---

## 34. Testing OkHttp Clients

OkHttp ecosystem provides `MockWebServer`, useful for client testing.

Example shape:

```java
MockWebServer server = new MockWebServer();
server.enqueue(new MockResponse()
    .setResponseCode(200)
    .setHeader("Content-Type", "application/json")
    .setBody("{\"id\":\"123\",\"name\":\"Alice\"}"));
server.start();

HttpUrl baseUrl = server.url("/");
IdentityClient client = new OkHttpIdentityClient(okHttpClient, baseUrl, objectMapper);

IdentityUser user = client.getUserById("123");

RecordedRequest recorded = server.takeRequest();
assertEquals("GET", recorded.getMethod());
assertEquals("/v1/users/123", recorded.getPath());
```

Test cases yang wajib:

- 200 valid body,
- 204 empty body,
- 400 error body,
- 401 token refresh,
- 403 forbidden,
- 404 not found,
- 429 with Retry-After,
- 500/502/503/504,
- malformed JSON,
- slow response/read timeout,
- connection disconnect,
- large body,
- sensitive header redaction,
- retry max attempt,
- response body closed.

---

## 35. Shutdown and Lifecycle

Jika aplikasi memakai singleton OkHttpClient, biasanya lifecycle mengikuti process. Tapi untuk aplikasi yang membuat custom dispatcher/executor/cache, perhatikan shutdown.

Contoh eksplisit:

```java
client.dispatcher().executorService().shutdown();
client.connectionPool().evictAll();

Cache cache = client.cache();
if (cache != null) {
    cache.close();
}
```

Gunakan saat:

- integration test cleanup,
- short-lived CLI process,
- dynamic tenant client disposal,
- application shutdown hook,
- avoiding file lock cache.

Jangan sering `evictAll()` di runtime normal karena menghancurkan manfaat pooling.

---

## 36. Anti-Pattern Besar OkHttp

### 36.1 Membuat client per request

Dampak: connection reuse hilang, socket churn naik.

### 36.2 Tidak menutup response

Dampak: pool starvation, socket leak.

### 36.3 Logging full body/header di production

Dampak: secret/PII leakage.

### 36.4 Retry POST tanpa idempotency

Dampak: duplicate side effect.

### 36.5 Menaruh semua logic di interceptor

Dampak: policy tersembunyi, ordering kacau, sulit test.

### 36.6 Trust-all SSL

Dampak: MITM vulnerability.

### 36.7 Dispatcher dianggap cukup sebagai rate limiter

Dampak: tidak ada time-based quota control.

### 36.8 Timeout disamakan semua endpoint

Dampak: endpoint cepat gagal lambat; endpoint lambat terlalu agresif.

### 36.9 `response.body().string()` untuk payload besar

Dampak: memory blow-up.

### 36.10 Raw OkHttp tersebar di service layer

Dampak: duplicate policy, inconsistent error model.

---

## 37. Reference Architecture

```text
Application Service
  |
  v
Domain Port Interface
  |
  v
External API Adapter
  - request mapping
  - response mapping
  - error taxonomy
  - domain-safe exception
  |
  v
Resilience Layer
  - deadline
  - retry
  - circuit breaker
  - rate limiter
  - bulkhead
  |
  v
OkHttp Transport Wrapper
  - request execution
  - response close discipline
  - raw status/body handling
  |
  v
OkHttpClient
  - dispatcher
  - connection pool
  - DNS/proxy/TLS
  - interceptors
  - event listener
  - cache/cookie
```

---

## 38. Minimal Production OkHttp Setup

```java
public final class OkHttpClients {

    public static OkHttpClient createExternalApiClient(
        TokenProvider tokenProvider,
        EventListener.Factory eventListenerFactory
    ) {
        Dispatcher dispatcher = new Dispatcher();
        dispatcher.setMaxRequests(100);
        dispatcher.setMaxRequestsPerHost(20);

        ConnectionPool connectionPool = new ConnectionPool(
            50,
            5, TimeUnit.MINUTES
        );

        return new OkHttpClient.Builder()
            .dispatcher(dispatcher)
            .connectionPool(connectionPool)
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .writeTimeout(5, TimeUnit.SECONDS)
            .callTimeout(8, TimeUnit.SECONDS)
            .followRedirects(false)
            .addInterceptor(new CorrelationIdInterceptor())
            .addInterceptor(new BearerTokenInterceptor(tokenProvider))
            .addInterceptor(new SafeMetadataLoggingInterceptor())
            .eventListenerFactory(eventListenerFactory)
            .retryOnConnectionFailure(true)
            .build();
    }
}
```

Catatan:

- `followRedirects(false)` tidak selalu wajib, tetapi sering lebih aman untuk API sensitif.
- `retryOnConnectionFailure(true)` bukan pengganti semantic retry.
- `SafeMetadataLoggingInterceptor` harus melakukan redaction.
- Dispatcher limit harus disesuaikan dengan sistem nyata.
- Timeout harus berasal dari SLA/deadline, bukan angka random.

---

## 39. Design Review Checklist

Sebelum menggunakan OkHttp client di production, tanyakan:

### Lifecycle

- Apakah `OkHttpClient` reusable/singleton per policy group?
- Apakah response selalu ditutup?
- Apakah client lifecycle/shutdown jelas untuk test/CLI/dynamic client?

### Timeout

- Ada connect/read/write/call timeout?
- Timeout sesuai SLA caller?
- Retry total masih dalam deadline?

### Connection

- Apakah pool default cukup?
- Ada LB idle timeout mismatch?
- Ada NAT/ephemeral port concern?
- HTTP/2 behavior dipahami?

### Concurrency

- Dispatcher limit explicit atau default diterima dengan sadar?
- Ada bulkhead/rate limiter di atas client?
- Ada queue bound/load shedding?

### Security

- TLS validation normal?
- Tidak ada trust-all/hostname verifier disabled?
- Header/token tidak bocor ke log?
- Redirect aman?
- Proxy credential aman?

### Auth

- Token refresh single-flight?
- 401 retry maksimal sekali?
- Refresh endpoint tidak kena interceptor loop?

### Retry

- Retry semantic terpisah dari OkHttp transport recovery?
- POST/PUT/PATCH punya idempotency policy?
- Backoff/jitter ada?

### Observability

- Ada metric status/duration/error?
- Ada phase timing via `EventListener` bila dibutuhkan?
- Ada correlation/trace propagation?
- Cardinality terkendali?

### Testing

- Ada MockWebServer/WireMock test?
- Timeout/failure diuji?
- 429/5xx/malformed response diuji?
- Body close/leak dicegah?

---

## 40. Mental Model Akhir

OkHttp harus dipahami seperti ini:

```text
OkHttpClient adalah transport engine.
Call adalah satu execution unit.
Request adalah immutable protocol intent.
ResponseBody adalah stream yang wajib dikelola.
Dispatcher mengatur concurrency internal.
ConnectionPool mengoptimalkan reuse koneksi.
Interceptor mengubah logical/network call path.
EventListener memberi telemetry lifecycle.
```

Engineer biasa memakai OkHttp untuk “hit API”.

Engineer kuat memakai OkHttp sebagai:

- controlled transport boundary,
- observable dependency client,
- secure credential carrier,
- resilient but bounded caller,
- reusable SDK foundation,
- diagnosable production subsystem.

Perbedaan levelnya bukan pada hafalan method, tetapi pada kemampuan menjawab:

```text
Apa yang terjadi pada socket, thread, timeout, token, body, metric, retry,
dan downstream saat satu request ini gagal, lambat, dibatalkan, atau diulang?
```

Kalau pertanyaan itu bisa dijawab jelas, desain OkHttp client sudah jauh lebih matang.

---

## 41. Ringkasan Part 15

Kita sudah membahas:

- peran OkHttp dalam landscape Java HTTP client,
- `OkHttpClient` sebagai reusable engine,
- `Request`, `Call`, `Response`, dan `ResponseBody`,
- sync dan async execution,
- `Dispatcher`,
- application vs network interceptor,
- interceptor ordering,
- token refresh pattern,
- logging/redaction,
- `EventListener`,
- `ConnectionPool`,
- HTTP/1.1 vs HTTP/2,
- timeout,
- retry internal vs application retry,
- redirect, DNS, proxy, TLS, cache, cookie,
- Retrofit relation,
- wrapper architecture,
- error taxonomy,
- cancellation,
- virtual threads,
- testing,
- shutdown,
- anti-pattern,
- production checklist.

Part berikutnya akan membahas **Retrofit Deep Dive**: bagaimana membangun type-safe API client di atas OkHttp tanpa kehilangan kontrol atas error model, retry, observability, DTO boundary, dan production policy.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./14-jdk-httpclient-deep-dive-java-net-http.md">⬅️ Part 14 — JDK `HttpClient` Deep Dive: `java.net.http` sebagai Native HTTP Client Modern Java</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./16-retrofit-deep-dive-type-safe-api-client-over-okhttp.md">Part 16 — Retrofit Deep Dive: Type-Safe API Client di Atas OkHttp ➡️</a>
</div>
