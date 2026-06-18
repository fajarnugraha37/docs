# Part 14 — JDK `HttpClient` Deep Dive: `java.net.http` sebagai Native HTTP Client Modern Java

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `14-jdk-httpclient-deep-dive-java-net-http.md`  
> Scope: Java 11–25 untuk API `java.net.http`, dengan catatan migrasi dari Java 8  
> Level: Advanced / production engineering

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membangun fondasi:

1. HTTP client sebagai production subsystem.
2. Landscape client Java 8–25.
3. Lifecycle request end-to-end.
4. URI/URL/encoding/canonical request.
5. Header dan metadata contract.
6. Body handling.
7. Timeout engineering.
8. Connection pooling.
9. DNS/proxy/topology.
10. TLS/mTLS.
11. Authentication.
12. Retry, rate limiting, bulkhead, circuit breaker.

Part ini mulai masuk ke library spesifik: **JDK `HttpClient`**.

Tujuan bagian ini bukan hanya tahu cara menulis:

```java
HttpClient.newHttpClient()
    .send(request, BodyHandlers.ofString());
```

Itu terlalu dangkal. Targetnya adalah memahami **model desain, lifecycle, extension point, failure mode, dan batas operasional** JDK `HttpClient` sehingga kita tahu kapan ia cocok, kapan tidak, dan bagaimana membuatnya production-grade.

---

## 1. Mental Model Utama

JDK `HttpClient` adalah **native HTTP client modern bawaan JDK** yang berada di modul:

```java
java.net.http
```

Ia menyediakan API utama:

```text
HttpClient
HttpRequest
HttpResponse
HttpHeaders
WebSocket
```

Mental model paling penting:

```text
HttpClient  = reusable, immutable, configured transport engine
HttpRequest = immutable request descriptor
BodyPublisher = cara request body diproduksi sebagai stream byte
BodyHandler = keputusan bagaimana response body akan dikonsumsi
BodySubscriber = consumer aktual response body
send() = blocking exchange
sendAsync() = asynchronous exchange berbasis CompletableFuture
```

Jadi `HttpClient` bukan “object request”. Ia adalah **transport engine** yang sebaiknya dibuat sedikit, direuse banyak, dan dikonfigurasi sebagai policy boundary.

---

## 2. Evolusi Singkat: dari Java 8 ke Java 25

### 2.1 Java 8

Di Java 8, pilihan bawaan JDK yang umum adalah:

```java
HttpURLConnection
```

Masalahnya:

- API lama dan verbose.
- Sulit dikomposisi.
- Model timeout terbatas.
- Tidak nyaman untuk async.
- Tidak nyaman untuk HTTP/2.
- Sulit untuk instrumentation modern.
- Sulit untuk body streaming yang clean.

Karena itu banyak sistem Java 8 memakai:

- Apache HttpClient 4.x
- OkHttp
- Retrofit di atas OkHttp
- Spring `RestTemplate`

### 2.2 Java 9–10

HTTP client modern sempat muncul sebagai incubator API.

### 2.3 Java 11+

Mulai Java 11, `java.net.http.HttpClient` menjadi standard API.

Ia membawa:

- HTTP/1.1.
- HTTP/2.
- sync request.
- async request via `CompletableFuture`.
- WebSocket client.
- body publisher/subscriber abstraction.
- integration dengan `SSLContext`, `ProxySelector`, `CookieHandler`, `Authenticator`, dan `Executor`.

### 2.4 Java 17/21/25

Di era Java modern, JDK `HttpClient` menjadi lebih menarik karena:

- tersedia langsung tanpa dependency eksternal;
- cocok untuk aplikasi yang ingin dependency minimal;
- cocok dipakai dengan virtual threads untuk blocking-style concurrency;
- tetap bisa async dengan `CompletableFuture`;
- cukup baik untuk banyak use case service-to-service atau third-party API client.

Namun ia bukan selalu pilihan terbaik. Untuk kebutuhan tertentu, OkHttp atau Apache HttpClient 5 masih bisa lebih fleksibel.

---

## 3. Kapan Memakai JDK `HttpClient`?

Gunakan JDK `HttpClient` ketika:

1. **Aplikasi berjalan di Java 11+**.
2. Ingin **mengurangi dependency eksternal**.
3. Butuh HTTP/1.1 dan/atau HTTP/2 client standar.
4. Kebutuhan interceptor sangat sederhana atau bisa dibuat lewat wrapper sendiri.
5. Tidak membutuhkan fitur spesifik OkHttp seperti application/network interceptor chain yang kaya, certificate pinning built-in, atau MockWebServer ecosystem.
6. Tidak membutuhkan advanced Apache routing/pooling customization yang sangat granular.
7. Cocok dengan model `CompletableFuture` atau blocking + virtual threads.
8. Ingin API native yang stabil dan portable.

Jangan otomatis memilih JDK `HttpClient` jika:

1. Sistem masih Java 8.
2. Butuh Retrofit-style type-safe interface langsung.
3. Butuh interceptor ecosystem yang matang.
4. Butuh connection manager dengan konfigurasi per-route yang sangat eksplisit seperti Apache.
5. Butuh operational control yang sudah disediakan library lain secara built-in.
6. Tim sudah punya platform SDK berbasis OkHttp/Retrofit/Apache.

---

## 4. Objek Utama dan Relasinya

### 4.1 `HttpClient`

`HttpClient` adalah client reusable.

Contoh minimal:

```java
HttpClient client = HttpClient.newHttpClient();
```

Contoh builder:

```java
HttpClient client = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_2)
    .followRedirects(HttpClient.Redirect.NORMAL)
    .connectTimeout(Duration.ofSeconds(3))
    .build();
```

Karakter penting:

- Dibuat melalui builder.
- Immutable setelah dibuat.
- Bisa dipakai untuk banyak request.
- Menyimpan konfigurasi transport-level.
- Seharusnya tidak dibuat per request.

Kesalahan umum:

```java
// Anti-pattern
public String callApi(String url) throws Exception {
    HttpClient client = HttpClient.newHttpClient(); // dibuat tiap call
    HttpRequest request = HttpRequest.newBuilder(URI.create(url)).build();
    return client.send(request, BodyHandlers.ofString()).body();
}
```

Kenapa buruk?

- Potensi kehilangan manfaat reuse.
- Policy timeout/proxy/TLS tersebar.
- Sulit diobservasi.
- Sulit dites.
- Tidak ada ownership jelas.

Lebih baik:

```java
public final class ExternalApiHttpTransport {
    private final HttpClient client;

    public ExternalApiHttpTransport(HttpClient client) {
        this.client = Objects.requireNonNull(client);
    }

    public HttpResponse<String> send(HttpRequest request)
            throws IOException, InterruptedException {
        return client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }
}
```

---

### 4.2 `HttpRequest`

`HttpRequest` adalah immutable request descriptor.

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/v1/customers/123"))
    .timeout(Duration.ofSeconds(5))
    .header("Accept", "application/json")
    .GET()
    .build();
```

Yang penting:

- Request punya URI.
- Request punya method.
- Request punya headers.
- Request bisa punya body.
- Request bisa punya per-request timeout.
- Request immutable setelah `build()`.

---

### 4.3 `HttpResponse<T>`

`HttpResponse<T>` adalah hasil exchange.

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());

int status = response.statusCode();
HttpHeaders headers = response.headers();
String body = response.body();
URI uri = response.uri();
HttpClient.Version version = response.version();
```

`T` tergantung `BodyHandler`.

Contoh:

```text
BodyHandlers.ofString()      -> HttpResponse<String>
BodyHandlers.ofByteArray()   -> HttpResponse<byte[]>
BodyHandlers.ofFile(path)    -> HttpResponse<Path>
BodyHandlers.discarding()    -> HttpResponse<Void>
BodyHandlers.ofInputStream() -> HttpResponse<InputStream>
```

---

### 4.4 `BodyPublisher`

`BodyPublisher` mendeskripsikan bagaimana request body dikirim.

Contoh:

```java
HttpRequest.BodyPublisher jsonBody = HttpRequest.BodyPublishers.ofString(
    "{\"name\":\"Fajar\"}",
    StandardCharsets.UTF_8
);
```

Pemakaian:

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/v1/customers"))
    .header("Content-Type", "application/json")
    .POST(jsonBody)
    .build();
```

Publisher umum:

```java
BodyPublishers.noBody()
BodyPublishers.ofString(...)
BodyPublishers.ofByteArray(...)
BodyPublishers.ofFile(...)
BodyPublishers.ofInputStream(...)
```

Mental model:

```text
BodyPublisher bukan DTO.
BodyPublisher adalah sumber byte untuk wire protocol.
```

---

### 4.5 `BodyHandler` dan `BodySubscriber`

`BodyHandler<T>` menentukan bagaimana response body akan diproses.

Contoh:

```java
HttpResponse.BodyHandler<String> handler = HttpResponse.BodyHandlers.ofString();
```

`BodyHandler` menerima metadata response seperti status code dan headers, lalu memilih `BodySubscriber`.

Ini penting untuk advanced behavior:

- hanya parse body jika status 2xx;
- buang body untuk status tertentu;
- stream body ke file;
- batasi ukuran body;
- decode error body secara berbeda;
- implementasi backpressure-aware consumer.

---

## 5. Sync vs Async

### 5.1 Blocking `send()`

```java
HttpResponse<String> response = client.send(
    request,
    HttpResponse.BodyHandlers.ofString()
);
```

Karakter:

- Thread pemanggil menunggu sampai response selesai.
- Exception dilempar langsung.
- Simpler reasoning.
- Cocok untuk service biasa, batch, command, atau virtual threads.

Exception umum:

```java
IOException
InterruptedException
IllegalArgumentException
SecurityException
```

Prinsip penting:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw e;
}
```

Jangan menelan interrupt.

Anti-pattern:

```java
try {
    return client.send(request, BodyHandlers.ofString()).body();
} catch (InterruptedException e) {
    return null; // buruk: interrupt hilang, caller tidak tahu cancellation
}
```

Lebih baik:

```java
try {
    return client.send(request, BodyHandlers.ofString()).body();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new ExternalCallInterruptedException("External API call interrupted", e);
}
```

---

### 5.2 Async `sendAsync()`

```java
CompletableFuture<HttpResponse<String>> future = client.sendAsync(
    request,
    HttpResponse.BodyHandlers.ofString()
);
```

Pemakaian:

```java
future.thenApply(HttpResponse::body)
      .thenAccept(System.out::println)
      .exceptionally(ex -> {
          ex.printStackTrace();
          return null;
      });
```

Karakter:

- Mengembalikan `CompletableFuture`.
- Cocok untuk fan-out/fan-in.
- Bisa dikomposisi.
- Exception dibungkus dalam completion failure.
- Cancellation harus dipikirkan.

Contoh fan-out sederhana:

```java
CompletableFuture<HttpResponse<String>> customerFuture = client.sendAsync(
    customerRequest,
    BodyHandlers.ofString()
);

CompletableFuture<HttpResponse<String>> orderFuture = client.sendAsync(
    orderRequest,
    BodyHandlers.ofString()
);

CompletableFuture<CustomerView> combined = customerFuture.thenCombine(orderFuture,
    (customerResponse, orderResponse) -> {
        return combine(customerResponse.body(), orderResponse.body());
    });
```

Masalah umum:

```java
CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
```

Ini bisa buruk jika:

- jumlah futures tidak dibatasi;
- timeout tidak jelas;
- error classification tidak ada;
- cancellation tidak dipropagasikan;
- downstream overload.

---

## 6. Executor: Jangan Diabaikan

`HttpClient.Builder` bisa menerima executor:

```java
ExecutorService executor = Executors.newFixedThreadPool(32);

HttpClient client = HttpClient.newBuilder()
    .executor(executor)
    .connectTimeout(Duration.ofSeconds(3))
    .build();
```

Mengapa ini penting?

Karena async completion dan internal task execution membutuhkan executor. Jika tidak disetel, implementation default dipakai.

Prinsip produksi:

1. Untuk aplikasi kecil, default bisa cukup.
2. Untuk sistem critical, pertimbangkan executor eksplisit.
3. Jangan pakai executor unbounded tanpa kontrol.
4. Jangan campur semua downstream berat dalam satu executor tanpa observability.
5. Ukur queue, active thread, rejection, dan latency.

Dengan Java 21+ virtual threads, blocking style bisa menjadi pilihan menarik:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<HttpResponse<String>> future = executor.submit(() ->
        client.send(request, BodyHandlers.ofString())
    );

    HttpResponse<String> response = future.get();
}
```

Namun jangan salah paham:

```text
Virtual threads mengurangi biaya thread blocking.
Virtual threads tidak menghilangkan kebutuhan timeout, rate limit, bulkhead, dan connection pool control.
```

Jika 10.000 virtual thread memanggil downstream yang sama tanpa limiter, downstream tetap bisa hancur.

---

## 7. HTTP Version: HTTP/1.1 vs HTTP/2

Konfigurasi:

```java
HttpClient client = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_2)
    .build();
```

Per request juga bisa:

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com"))
    .version(HttpClient.Version.HTTP_2)
    .GET()
    .build();
```

Penting:

- `HTTP_2` adalah preferensi, bukan jaminan absolut.
- Server dan TLS/ALPN menentukan apakah HTTP/2 bisa dipakai.
- Jika tidak tersedia, client dapat fallback sesuai behavior implementation.

Mental model:

```text
HTTP/1.1:
  satu koneksi biasanya melayani satu request aktif pada satu waktu.
  concurrency tinggi butuh banyak koneksi.

HTTP/2:
  satu koneksi dapat membawa banyak stream secara multiplexed.
  concurrency tinggi tidak selalu berarti banyak koneksi.
```

Namun HTTP/2 bukan magic:

- satu connection bisa menjadi bottleneck;
- server punya max concurrent streams;
- head-of-line blocking TCP masih mungkin di bawah HTTP/2;
- flow control bisa mempengaruhi large streaming response;
- observability harus membedakan connection vs stream.

---

## 8. Redirect Policy

Konfigurasi:

```java
HttpClient client = HttpClient.newBuilder()
    .followRedirects(HttpClient.Redirect.NORMAL)
    .build();
```

Pilihan umum:

```java
HttpClient.Redirect.NEVER
HttpClient.Redirect.NORMAL
HttpClient.Redirect.ALWAYS
```

Design guidance:

- Untuk internal API: biasanya `NEVER` atau sangat terbatas.
- Untuk public web resource: `NORMAL` mungkin masuk akal.
- Untuk call yang membawa credential: hati-hati.
- Jangan follow redirect lintas host tanpa validasi.

Risiko:

```text
Original request:
  https://trusted.example.com/api

Redirect:
  https://attacker.example.net/collect
```

Jika header `Authorization` atau sensitive metadata ikut terkirim, itu bisa menjadi credential leak.

Prinsip production:

1. Default aman: jangan auto-follow redirect untuk API sensitif.
2. Validasi target host jika redirect diizinkan.
3. Jangan kirim ulang sensitive headers ke host berbeda.
4. Catat redirect count dan target domain secara aman.

---

## 9. Cookie Handling

JDK `HttpClient` bisa memakai `CookieHandler`:

```java
CookieManager cookieManager = new CookieManager();

HttpClient client = HttpClient.newBuilder()
    .cookieHandler(cookieManager)
    .build();
```

Kapan dipakai?

- Integrasi dengan sistem berbasis session cookie.
- Web login flow tertentu.
- Legacy enterprise API.

Kapan perlu dihindari?

- Service-to-service stateless API.
- Multi-tenant client dengan risiko cookie bleed antar tenant.
- API client yang harus eksplisit membawa bearer token atau mTLS.

Bahaya umum:

```text
Satu HttpClient + satu CookieManager dipakai untuk banyak tenant/user.
Cookie tenant A bisa ikut request tenant B jika boundary tidak jelas.
```

Prinsip:

- Cookie store harus punya ownership jelas.
- Jangan share cookie manager untuk trust domain berbeda.
- Audit cookie domain/path/secure/httpOnly behavior.

---

## 10. Proxy

Konfigurasi:

```java
HttpClient client = HttpClient.newBuilder()
    .proxy(ProxySelector.of(new InetSocketAddress("proxy.example.com", 8080)))
    .build();
```

Tanpa proxy:

```java
HttpClient client = HttpClient.newBuilder()
    .proxy(HttpClient.Builder.NO_PROXY)
    .build();
```

Proxy matters karena:

- corporate network sering memaksa HTTP proxy;
- HTTPS lewat proxy memakai CONNECT tunnel;
- proxy bisa punya authentication;
- proxy bisa melakukan TLS inspection;
- proxy bisa menjadi bottleneck;
- proxy bisa mengubah source IP yang dilihat downstream.

Production checklist:

- Apakah proxy per environment?
- Apakah proxy bypass untuk internal host?
- Apakah proxy membutuhkan credential?
- Apakah proxy mendukung CONNECT?
- Apakah proxy idle timeout diketahui?
- Apakah proxy logs mengandung sensitive path/query?

---

## 11. Authenticator

`Authenticator` dapat dipasang di client:

```java
Authenticator authenticator = new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication(
            "user",
            "password".toCharArray()
        );
    }
};

HttpClient client = HttpClient.newBuilder()
    .authenticator(authenticator)
    .build();
```

Biasanya dipakai untuk:

- Basic authentication;
- proxy authentication;
- legacy challenge-response mechanism.

Untuk bearer token/OAuth2/API key, sering lebih eksplisit memakai header builder/wrapper:

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(uri)
    .header("Authorization", "Bearer " + token)
    .GET()
    .build();
```

Namun untuk production jangan token injection tersebar di banyak tempat. Buat wrapper atau request factory.

---

## 12. TLS dan `SSLContext`

Konfigurasi:

```java
SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(keyManagers, trustManagers, secureRandom);

HttpClient client = HttpClient.newBuilder()
    .sslContext(sslContext)
    .build();
```

Gunakan ini untuk:

- custom truststore;
- mTLS;
- certificate chain khusus;
- test environment dengan CA internal;
- enterprise PKI.

Anti-pattern berbahaya:

```java
// Jangan lakukan di production
TrustManager[] trustAll = new TrustManager[] { ... accept everything ... };
```

Kenapa buruk?

- Menonaktifkan server authentication.
- Membuka risiko man-in-the-middle.
- Sering masuk production karena “sementara untuk test”.

Prinsip:

```text
TLS error adalah sinyal trust boundary gagal.
Jangan diselesaikan dengan mematikan validasi.
Selesaikan dengan memperbaiki trust chain, hostname, certificate, atau environment config.
```

---

## 13. Building Request dengan Aman

### 13.1 GET

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/v1/customers/123"))
    .header("Accept", "application/json")
    .timeout(Duration.ofSeconds(5))
    .GET()
    .build();
```

### 13.2 POST JSON

```java
String json = objectMapper.writeValueAsString(payload);

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/v1/customers"))
    .header("Accept", "application/json")
    .header("Content-Type", "application/json")
    .timeout(Duration.ofSeconds(5))
    .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
    .build();
```

### 13.3 PUT

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(uri)
    .header("Content-Type", "application/json")
    .PUT(HttpRequest.BodyPublishers.ofString(json))
    .build();
```

### 13.4 DELETE

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(uri)
    .DELETE()
    .build();
```

### 13.5 Custom Method

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(uri)
    .method("PATCH", HttpRequest.BodyPublishers.ofString(json))
    .header("Content-Type", "application/json")
    .build();
```

---

## 14. URI Construction: Jangan String Concatenation Sembarangan

Anti-pattern:

```java
URI uri = URI.create("https://api.example.com/search?q=" + keyword);
```

Masalah:

- spasi;
- `&`;
- `?`;
- slash;
- unicode;
- double encoding;
- injection query parameter.

JDK tidak menyediakan URI builder ergonomic seperti OkHttp `HttpUrl`. Untuk production, gunakan helper internal atau library yang benar.

Contoh helper sederhana:

```java
public final class Urls {
    private Urls() {}

    public static String encodeQueryParam(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
            .replace("+", "%20");
    }
}
```

Pemakaian:

```java
String q = Urls.encodeQueryParam(keyword);
URI uri = URI.create("https://api.example.com/search?q=" + q);
```

Catatan: `URLEncoder` historically untuk form encoding, bukan universal URI component encoding. Untuk sistem serius, buat URI builder yang membedakan path segment dan query parameter.

---

## 15. Body Handling Strategy

### 15.1 `ofString()`

```java
HttpResponse<String> response = client.send(
    request,
    BodyHandlers.ofString(StandardCharsets.UTF_8)
);
```

Cocok untuk:

- JSON kecil/sedang;
- error body kecil;
- debug/test;
- API response biasa.

Tidak cocok untuk:

- file besar;
- streaming response;
- response tidak terpercaya dengan ukuran tak terbatas.

### 15.2 `ofByteArray()`

```java
HttpResponse<byte[]> response = client.send(
    request,
    BodyHandlers.ofByteArray()
);
```

Cocok untuk binary kecil.

Bahaya:

```text
Response besar -> byte[] besar -> heap pressure -> GC spike -> OOM.
```

### 15.3 `ofFile()`

```java
Path output = Path.of("download.bin");

HttpResponse<Path> response = client.send(
    request,
    BodyHandlers.ofFile(output)
);
```

Cocok untuk download file.

Perhatikan:

- lokasi file;
- overwrite behavior;
- atomic write;
- partial file jika gagal;
- permission;
- disk full;
- checksum.

### 15.4 `ofInputStream()`

```java
HttpResponse<InputStream> response = client.send(
    request,
    BodyHandlers.ofInputStream()
);

try (InputStream in = response.body()) {
    process(in);
}
```

Penting:

```text
InputStream harus ditutup.
Jika tidak, connection/resource bisa bocor.
```

---

## 16. Status Code Handling: Jangan Body Dulu, Baru Pikir Status

Anti-pattern:

```java
String body = client.send(request, BodyHandlers.ofString()).body();
Customer customer = objectMapper.readValue(body, Customer.class);
```

Masalah:

- status 404 mungkin diparse sebagai Customer;
- status 500 dengan HTML error jadi JSON parse error;
- retryability hilang;
- error body tidak dibedakan;
- observability buruk.

Lebih baik:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());

int status = response.statusCode();
String body = response.body();

if (status >= 200 && status < 300) {
    return objectMapper.readValue(body, Customer.class);
}

if (status == 404) {
    throw new CustomerNotFoundException(customerId);
}

if (status == 429 || status == 503 || status == 504) {
    throw new RetryableExternalApiException(status, body);
}

throw new NonRetryableExternalApiException(status, body);
```

Production-grade client harus punya error taxonomy.

---

## 17. Custom BodyHandler untuk Error-Aware Handling

Kadang kita ingin memilih body handling berdasarkan status.

Contoh konsep:

```java
HttpResponse.BodyHandler<String> handler = responseInfo -> {
    int status = responseInfo.statusCode();

    if (status == 204) {
        return HttpResponse.BodySubscribers.replacing("");
    }

    return HttpResponse.BodySubscribers.ofString(StandardCharsets.UTF_8);
};
```

Ini berguna untuk:

- 204 No Content;
- large error body discard;
- status tertentu disimpan ke file;
- limit body size;
- metrics berdasarkan response info.

---

## 18. Timeout: Client-Level vs Request-Level

Client connect timeout:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(3))
    .build();
```

Request timeout:

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(uri)
    .timeout(Duration.ofSeconds(5))
    .GET()
    .build();
```

Mental model:

```text
connectTimeout = batas waktu membuat koneksi baru.
request timeout = batas waktu request exchange per request.
```

Namun timeout harus tetap menjadi bagian dari total budget:

```text
caller SLA: 2s
  internal processing: 200ms
  downstream A: 600ms
  downstream B: 800ms
  retry/fallback buffer: 300ms
  safety margin: 100ms
```

Jangan memasang request timeout 30s pada endpoint yang caller-nya punya SLA 2s.

---

## 19. Cancellation dan Interruption

Untuk async:

```java
CompletableFuture<HttpResponse<String>> future = client.sendAsync(
    request,
    BodyHandlers.ofString()
);

future.cancel(true);
```

Cancellation harus dipahami sebagai:

- sinyal dari caller bahwa hasil tidak dibutuhkan;
- kesempatan membebaskan resource;
- bagian dari deadline propagation;
- bukan sekadar “ignore result”.

Untuk blocking:

```java
try {
    return client.send(request, BodyHandlers.ofString());
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new RequestCancelledException(e);
}
```

Dalam structured concurrency/virtual threads, cancellation propagation menjadi semakin penting.

---

## 20. Header Management

Contoh:

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(uri)
    .header("Accept", "application/json")
    .header("Authorization", "Bearer " + token)
    .header("X-Correlation-Id", correlationId)
    .GET()
    .build();
```

Masalah jika header disusun ad hoc di semua call:

- inconsistent correlation ID;
- lupa redaction;
- token stale;
- duplicate headers;
- content negotiation kacau;
- sulit audit.

Lebih baik buat request factory:

```java
public final class ExternalApiRequestFactory {
    private final URI baseUri;
    private final TokenProvider tokenProvider;

    public ExternalApiRequestFactory(URI baseUri, TokenProvider tokenProvider) {
        this.baseUri = baseUri;
        this.tokenProvider = tokenProvider;
    }

    public HttpRequest getCustomer(String customerId, String correlationId) {
        URI uri = baseUri.resolve("/v1/customers/" + encodePathSegment(customerId));

        return HttpRequest.newBuilder()
            .uri(uri)
            .timeout(Duration.ofSeconds(5))
            .header("Accept", "application/json")
            .header("Authorization", "Bearer " + tokenProvider.currentToken())
            .header("X-Correlation-Id", correlationId)
            .GET()
            .build();
    }
}
```

---

## 21. Interceptor Tidak Built-in seperti OkHttp

Salah satu perbedaan besar:

```text
OkHttp punya interceptor chain built-in.
JDK HttpClient tidak punya interceptor abstraction built-in yang setara.
```

Artinya jika ingin cross-cutting behavior seperti:

- logging;
- metrics;
- tracing;
- auth injection;
- retry;
- redaction;
- circuit breaker;
- rate limiting;

kita biasanya membuat wrapper sendiri.

Contoh minimal:

```java
public interface HttpTransport {
    <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler)
        throws IOException, InterruptedException;
}
```

Implementasi dasar:

```java
public final class JdkHttpTransport implements HttpTransport {
    private final HttpClient client;

    public JdkHttpTransport(HttpClient client) {
        this.client = client;
    }

    @Override
    public <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler)
            throws IOException, InterruptedException {
        return client.send(request, handler);
    }
}
```

Decorator metrics:

```java
public final class MetricsHttpTransport implements HttpTransport {
    private final HttpTransport delegate;
    private final HttpMetrics metrics;

    public MetricsHttpTransport(HttpTransport delegate, HttpMetrics metrics) {
        this.delegate = delegate;
        this.metrics = metrics;
    }

    @Override
    public <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler)
            throws IOException, InterruptedException {
        long start = System.nanoTime();
        try {
            HttpResponse<T> response = delegate.send(request, handler);
            metrics.recordSuccess(request.uri(), response.statusCode(), System.nanoTime() - start);
            return response;
        } catch (IOException | RuntimeException e) {
            metrics.recordFailure(request.uri(), e, System.nanoTime() - start);
            throw e;
        }
    }
}
```

Ini lebih verbose daripada OkHttp interceptor, tetapi lebih eksplisit dan bisa disesuaikan.

---

## 22. Production-Grade JDK HttpClient Wrapper Architecture

Struktur yang sehat:

```text
ExternalApiClient
  -> ExternalApiRequestFactory
  -> JdkHttpTransport / HttpTransport
  -> Resilience layer
  -> Observability layer
  -> HttpClient
```

Contoh package:

```text
com.example.integration.payment
  PaymentClient.java
  PaymentClientConfig.java
  PaymentRequestFactory.java
  PaymentResponseMapper.java
  PaymentErrorMapper.java
  PaymentHttpTransport.java
  PaymentException.java
  RetryablePaymentException.java
  NonRetryablePaymentException.java
```

Jangan seperti ini:

```text
OrderService
  langsung build URI
  langsung set Authorization
  langsung call HttpClient
  langsung parse JSON
  langsung interpret 500
```

Karena service layer menjadi terlalu tahu detail external protocol.

---

## 23. Example: Production-Oriented Typed Client

### 23.1 Domain-facing interface

```java
public interface CustomerDirectoryClient {
    CustomerProfile getCustomer(String customerId, RequestContext context);
}
```

### 23.2 Implementation

```java
public final class JdkCustomerDirectoryClient implements CustomerDirectoryClient {
    private final HttpTransport transport;
    private final CustomerRequestFactory requestFactory;
    private final ObjectMapper objectMapper;

    public JdkCustomerDirectoryClient(
            HttpTransport transport,
            CustomerRequestFactory requestFactory,
            ObjectMapper objectMapper) {
        this.transport = Objects.requireNonNull(transport);
        this.requestFactory = Objects.requireNonNull(requestFactory);
        this.objectMapper = Objects.requireNonNull(objectMapper);
    }

    @Override
    public CustomerProfile getCustomer(String customerId, RequestContext context) {
        HttpRequest request = requestFactory.getCustomer(customerId, context);

        HttpResponse<String> response;
        try {
            response = transport.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CustomerDirectoryUnavailableException("Customer lookup interrupted", e);
        } catch (IOException e) {
            throw new CustomerDirectoryUnavailableException("Customer directory transport failure", e);
        }

        return mapResponse(customerId, response);
    }

    private CustomerProfile mapResponse(String customerId, HttpResponse<String> response) {
        int status = response.statusCode();
        String body = response.body();

        try {
            if (status >= 200 && status < 300) {
                CustomerProfileDto dto = objectMapper.readValue(body, CustomerProfileDto.class);
                return CustomerProfile.from(dto);
            }

            if (status == 404) {
                throw new CustomerNotFoundException(customerId);
            }

            if (status == 429 || status == 502 || status == 503 || status == 504) {
                throw new RetryableCustomerDirectoryException(status, safeSnippet(body));
            }

            throw new NonRetryableCustomerDirectoryException(status, safeSnippet(body));
        } catch (JsonProcessingException e) {
            throw new CustomerDirectoryProtocolException("Invalid customer directory response", e);
        }
    }
}
```

### 23.3 Request context

```java
public record RequestContext(
    String correlationId,
    String tenantId,
    Instant deadline
) {}
```

### 23.4 Request factory

```java
public final class CustomerRequestFactory {
    private final URI baseUri;
    private final TokenProvider tokenProvider;
    private final Duration timeout;

    public CustomerRequestFactory(URI baseUri, TokenProvider tokenProvider, Duration timeout) {
        this.baseUri = baseUri;
        this.tokenProvider = tokenProvider;
        this.timeout = timeout;
    }

    public HttpRequest getCustomer(String customerId, RequestContext context) {
        URI uri = baseUri.resolve("/v1/customers/" + encodePathSegment(customerId));

        return HttpRequest.newBuilder()
            .uri(uri)
            .timeout(timeout)
            .header("Accept", "application/json")
            .header("Authorization", "Bearer " + tokenProvider.currentToken())
            .header("X-Correlation-Id", context.correlationId())
            .header("X-Tenant-Id", context.tenantId())
            .GET()
            .build();
    }

    private static String encodePathSegment(String raw) {
        // Placeholder: production code should use a component-aware URI encoder.
        return URLEncoder.encode(raw, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
```

---

## 24. JSON Mapping Boundary

JDK `HttpClient` tidak menyediakan JSON mapper.

Artinya:

```text
HttpClient hanya transport.
JSON mapping adalah tanggung jawab aplikasi/library lain.
```

Biasanya pakai:

- Jackson;
- Gson;
- JSON-B;
- Moshi;
- custom parser.

Prinsip:

- Jangan parse langsung ke domain object jika contract eksternal tidak stabil.
- Gunakan DTO boundary.
- Handle unknown field secara sadar.
- Handle missing/null field secara sadar.
- Error body punya DTO berbeda dari success body.

Contoh:

```java
record CustomerProfileDto(
    String id,
    String name,
    String status
) {}
```

Mapping:

```java
public static CustomerProfile from(CustomerProfileDto dto) {
    return new CustomerProfile(
        CustomerId.of(dto.id()),
        CustomerName.of(dto.name()),
        CustomerStatus.parse(dto.status())
    );
}
```

---

## 25. Multipart dan Form dengan JDK HttpClient

JDK `HttpClient` tidak punya high-level multipart builder built-in seperti OkHttp.

Untuk form URL encoded:

```java
String form = "grant_type=client_credentials"
    + "&client_id=" + encode(clientId)
    + "&client_secret=" + encode(clientSecret);

HttpRequest request = HttpRequest.newBuilder()
    .uri(tokenEndpoint)
    .header("Content-Type", "application/x-www-form-urlencoded")
    .POST(HttpRequest.BodyPublishers.ofString(form))
    .build();
```

Untuk multipart, kita bisa:

1. Menulis builder sendiri.
2. Menggunakan library tambahan.
3. Memilih OkHttp/Apache jika multipart kompleks.

Design heuristic:

```text
Jika banyak multipart upload/download kompleks,
OkHttp atau Apache sering lebih ergonomis daripada JDK HttpClient murni.
```

---

## 26. File Upload dan Download

### 26.1 Upload file

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(uploadUri)
    .header("Content-Type", "application/octet-stream")
    .POST(HttpRequest.BodyPublishers.ofFile(Path.of("payload.bin")))
    .build();
```

Hal yang perlu dipikirkan:

- file exists;
- permission;
- content length;
- retryability;
- checksum;
- idempotency;
- streaming failure halfway;
- server partial receive.

### 26.2 Download file

```java
HttpResponse<Path> response = client.send(
    request,
    HttpResponse.BodyHandlers.ofFile(Path.of("output.bin"))
);
```

Production concern:

- jangan overwrite file penting;
- pakai temporary file;
- rename atomically setelah sukses;
- validasi checksum;
- validasi content type;
- validasi content length;
- cleanup partial file.

---

## 27. WebSocket API Overview

JDK `java.net.http` juga menyediakan WebSocket client.

Contoh sangat sederhana:

```java
HttpClient client = HttpClient.newHttpClient();

WebSocket webSocket = client.newWebSocketBuilder()
    .buildAsync(URI.create("wss://example.com/socket"), new WebSocket.Listener() {
        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            System.out.println(data);
            webSocket.request(1);
            return null;
        }
    })
    .join();

webSocket.sendText("hello", true);
```

Yang harus dipahami:

- WebSocket bukan request/response biasa.
- Ada lifecycle connection.
- Ada backpressure via `request(n)`.
- Ada ping/pong.
- Ada close handshake.
- Ada reconnect policy yang harus dibuat sendiri.
- Observability berbeda dari HTTP request biasa.

Untuk sistem enterprise, WebSocket client harus punya:

- reconnect policy;
- heartbeat;
- authentication refresh;
- message ordering policy;
- deduplication;
- backpressure;
- poison message handling;
- metrics per connection.

---

## 28. Connection Pool dan Keep-Alive di JDK HttpClient

JDK `HttpClient` memiliki connection reuse internal. Namun API public-nya tidak se-eksplicit Apache `PoolingHttpClientConnectionManager` atau OkHttp `ConnectionPool`.

Implikasi:

- Kita tidak mengatur max idle connection secara ergonomic seperti OkHttp.
- Kita tidak mengatur per-route pool limit seperti Apache dengan cara yang sama.
- Beberapa behavior dikontrol lewat system properties.
- Operational control lebih terbatas.

Design implication:

```text
Jika butuh pooling control sangat granular,
Apache HttpClient 5 atau OkHttp mungkin lebih cocok.
```

Namun untuk banyak service biasa, JDK `HttpClient` cukup jika:

- client direuse;
- timeout benar;
- concurrency dibatasi di layer aplikasi;
- metrics cukup;
- downstream tidak membutuhkan konfigurasi pool khusus.

---

## 29. System Properties: Powerful tapi Harus Governance

JDK `HttpClient` memiliki beberapa system properties untuk behavior implementation.

Contoh kategori:

- keep-alive timeout;
- HTTP/2 behavior;
- frame size/window size;
- retry/redirect related implementation detail;
- logging internal tertentu.

Prinsip governance:

1. Jangan ubah system property global tanpa design review.
2. Catat di deployment manifest/runbook.
3. Pahami bahwa system property bisa berdampak ke semua JDK HttpClient dalam JVM.
4. Jangan menjadikan system property sebagai pengganti desain client wrapper.
5. Validasi di load test.

Contoh risiko:

```text
Mengubah keepalive timeout global untuk memperbaiki satu downstream
bisa mempengaruhi semua downstream lain dalam JVM.
```

---

## 30. Observability dengan JDK HttpClient

Karena tidak ada interceptor built-in, observability sebaiknya ada di wrapper.

Metric minimum:

```text
http.client.requests.total
http.client.request.duration
http.client.errors.total
http.client.timeouts.total
http.client.retries.total
http.client.active.calls
http.client.inflight.by.downstream
http.client.response.status
```

Tag yang aman:

```text
downstream = payment-api
operation = create-payment
method = POST
status_class = 2xx / 4xx / 5xx
exception_type = ConnectException / HttpTimeoutException / SSLHandshakeException
```

Tag yang berbahaya:

```text
full_url = /customers/123456789/orders?token=secret
raw_query = ...
customer_id = high cardinality
authorization = never
```

Log minimum:

```text
operation
method
sanitized_uri_template
status
latency_ms
correlation_id
attempt
exception category
retryable flag
```

Jangan log:

- bearer token;
- API key;
- password;
- client secret;
- full PII body;
- sensitive query parameter;
- raw certificate private material.

---

## 31. Error Taxonomy untuk JDK HttpClient

Transport/protocol exception examples:

```text
UnknownHostException         -> DNS failure
ConnectException             -> TCP connect failure/refused
HttpTimeoutException         -> request timeout
SSLHandshakeException        -> TLS trust/handshake failure
IOException                  -> broad I/O failure
InterruptedException         -> cancellation/interruption
CompletionException          -> async wrapper
```

Status code failure:

```text
400 -> caller/request contract bug or validation failure
401 -> credential missing/expired/wrong
403 -> authenticated but not allowed
404 -> not found or wrong endpoint/resource
409 -> conflict/state issue
412 -> precondition failed
422 -> semantic validation error
429 -> rate limited
500 -> downstream internal failure
502 -> gateway/upstream failure
503 -> unavailable/overloaded/maintenance
504 -> gateway timeout
```

Mapping contoh:

```java
public enum ExternalFailureKind {
    DNS_FAILURE,
    CONNECT_FAILURE,
    TLS_FAILURE,
    TIMEOUT,
    CANCELLED,
    RATE_LIMITED,
    DOWNSTREAM_5XX,
    AUTH_FAILURE,
    CLIENT_CONTRACT_FAILURE,
    RESPONSE_MAPPING_FAILURE,
    UNKNOWN_TRANSPORT_FAILURE
}
```

Top-tier client tidak hanya throw `RuntimeException`. Ia mengklasifikasi failure agar retry, alert, fallback, dan user response benar.

---

## 32. Retry dengan JDK HttpClient

JDK `HttpClient` tidak menyediakan application-level retry policy yang kaya.

Artinya:

- retry harus dibuat di wrapper;
- atau memakai Resilience4j/Failsafe;
- atau memakai framework di atasnya.

Pseudo-code:

```java
public <T> HttpResponse<T> sendWithRetry(
        HttpRequest request,
        BodyHandler<T> handler,
        RetryPolicy policy) throws IOException, InterruptedException {

    int attempt = 0;
    while (true) {
        attempt++;
        try {
            HttpResponse<T> response = client.send(request, handler);
            if (!policy.shouldRetry(response.statusCode(), attempt)) {
                return response;
            }
        } catch (IOException e) {
            if (!policy.shouldRetry(e, attempt)) {
                throw e;
            }
        }

        Thread.sleep(policy.delayFor(attempt).toMillis());
    }
}
```

Tapi production version harus memperhatikan:

- deadline;
- idempotency;
- body repeatability;
- interrupt handling;
- jitter;
- retry budget;
- `Retry-After`;
- metrics per attempt;
- cancellation.

---

## 33. Rate Limiting dan Bulkhead di Atas JDK HttpClient

Karena JDK `HttpClient` tidak memberi `Dispatcher` seperti OkHttp, concurrency control biasanya dibuat di aplikasi.

Contoh semaphore bulkhead:

```java
public final class BulkheadHttpTransport implements HttpTransport {
    private final HttpTransport delegate;
    private final Semaphore semaphore;

    public BulkheadHttpTransport(HttpTransport delegate, int maxConcurrent) {
        this.delegate = delegate;
        this.semaphore = new Semaphore(maxConcurrent);
    }

    @Override
    public <T> HttpResponse<T> send(HttpRequest request, BodyHandler<T> handler)
            throws IOException, InterruptedException {
        if (!semaphore.tryAcquire(100, TimeUnit.MILLISECONDS)) {
            throw new BulkheadRejectedException("HTTP client bulkhead full");
        }

        try {
            return delegate.send(request, handler);
        } finally {
            semaphore.release();
        }
    }
}
```

Catatan:

- Jangan hanya mengandalkan thread pool.
- Batasi per downstream.
- Batasi per operation jika perlu.
- Ukur rejected count.
- Integrasikan dengan fallback bila aman.

---

## 34. Testing JDK HttpClient

Testing strategy:

```text
unit test mapper/request factory
integration test dengan local HTTP server
fault injection test
contract test dengan sample payload
load test untuk timeout/pool/concurrency
```

Pilihan test server:

- JDK built-in lightweight HTTP server untuk simple test.
- WireMock.
- MockWebServer dari OkHttp meskipun client-nya JDK.
- MockServer.
- Testcontainers untuk real dependency.

Contoh sederhana dengan JDK server:

```java
HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
server.createContext("/hello", exchange -> {
    byte[] response = "ok".getBytes(StandardCharsets.UTF_8);
    exchange.sendResponseHeaders(200, response.length);
    try (OutputStream os = exchange.getResponseBody()) {
        os.write(response);
    }
});
server.start();

int port = server.getAddress().getPort();
URI uri = URI.create("http://localhost:" + port + "/hello");
```

Fault cases yang wajib dites:

- 200 valid JSON.
- 204 no body.
- 400 error JSON.
- 401 expired token.
- 404 not found.
- 429 with `Retry-After`.
- 500.
- malformed JSON.
- slow response.
- connection reset.
- large response.
- unexpected content type.

---

## 35. JDK HttpClient vs OkHttp vs Apache vs Retrofit

### 35.1 JDK HttpClient unggul ketika

- Dependency minimal penting.
- Java 11+ tersedia.
- Kebutuhan HTTP relatif standar.
- Blocking + virtual thread cukup.
- Async `CompletableFuture` cukup.
- Tim ingin API JDK-native.
- Tidak butuh interceptor chain yang kompleks.

### 35.2 OkHttp unggul ketika

- Butuh interceptor chain matang.
- Butuh ergonomi connection pool, timeout, event listener.
- Butuh certificate pinning built-in.
- Butuh MockWebServer ecosystem.
- Banyak codebase sudah memakai OkHttp/Retrofit.

### 35.3 Apache HttpClient 5 unggul ketika

- Butuh connection manager granular.
- Butuh route/proxy/cookie/credentials strategy kompleks.
- Butuh classic dan async HTTP stack enterprise.
- Migrasi dari Apache 4.
- Butuh kontrol per-route pool limit yang eksplisit.

### 35.4 Retrofit unggul ketika

- Ingin type-safe declarative API interface.
- Banyak endpoint external API.
- Ingin annotation-based mapping.
- Ingin converter/call adapter ecosystem.
- Bisa menerima dependency OkHttp/Retrofit.

---

## 36. Production Checklist JDK HttpClient

Sebelum client masuk production, jawab ini:

### Client lifecycle

- Apakah `HttpClient` direuse?
- Apakah dibuat sebagai singleton/per downstream/per config boundary?
- Apakah tidak dibuat per request?

### Timeout

- Apakah ada connect timeout?
- Apakah ada request timeout?
- Apakah timeout sesuai SLA caller?
- Apakah timeout per operation bisa berbeda?

### URI/header/body

- Apakah URI dibangun dengan encoding benar?
- Apakah sensitive query dihindari?
- Apakah `Content-Type` dan `Accept` benar?
- Apakah body besar tidak dibuffer sembarangan?

### Auth/security

- Apakah token injection terpusat?
- Apakah token tidak dilog?
- Apakah TLS validation tidak dimatikan?
- Apakah redirect aman?
- Apakah proxy behavior diketahui?

### Error handling

- Apakah status code diklasifikasi?
- Apakah transport exception diklasifikasi?
- Apakah parse error dibedakan dari 5xx?
- Apakah retryability eksplisit?

### Resilience

- Apakah retry policy ada jika diperlukan?
- Apakah idempotency diperiksa?
- Apakah rate limit/bulkhead ada?
- Apakah circuit breaker ada untuk downstream critical?

### Observability

- Apakah latency metric ada?
- Apakah status distribution ada?
- Apakah timeout/error metric ada?
- Apakah correlation ID dipropagasikan?
- Apakah logs disanitasi?

### Testing

- Apakah happy path dites?
- Apakah 4xx/5xx dites?
- Apakah timeout dites?
- Apakah malformed body dites?
- Apakah large body dites?
- Apakah cancellation/interrupt behavior dites?

---

## 37. Common Anti-Patterns

### 37.1 Membuat `HttpClient` per request

```java
HttpClient.newHttpClient().send(request, BodyHandlers.ofString());
```

Buruk karena lifecycle dan policy tersebar.

### 37.2 Tidak punya request timeout

```java
HttpRequest.newBuilder().uri(uri).GET().build();
```

Bisa membuat caller menunggu terlalu lama.

### 37.3 Semua error dianggap sama

```java
throw new RuntimeException("API failed");
```

Menghilangkan retryability dan diagnosis.

### 37.4 Parse body sebelum cek status

```java
CustomerDto dto = mapper.readValue(response.body(), CustomerDto.class);
```

Bisa salah jika body adalah error envelope.

### 37.5 Logging full URL dan body

```java
log.info("Calling {} with body {}", request.uri(), rawBody);
```

Bisa membocorkan token/PII.

### 37.6 Menggunakan `sendAsync()` tanpa limit

```java
ids.stream()
   .map(id -> client.sendAsync(request(id), BodyHandlers.ofString()))
   .toList();
```

Bisa overload caller, downstream, proxy, DNS, NAT, atau heap.

### 37.7 Menelan interrupt

```java
catch (InterruptedException e) {
    // ignore
}
```

Merusak cancellation semantics.

---

## 38. Design Heuristics Level Senior/Principal

1. **Treat `HttpClient` as infrastructure, not utility.**
2. **Use wrapper boundaries so transport concern tidak bocor ke domain service.**
3. **Make timeout a budget, not a random config.**
4. **Classify failures before deciding retry/fallback.**
5. **Do not rely on async to solve overload. Async without limiter is just faster overload.**
6. **Use virtual threads for simpler blocking style, but still enforce concurrency control.**
7. **Do not parse success DTO before validating status and content type.**
8. **Do not log what you cannot safely disclose.**
9. **Do not disable TLS validation to fix environment problems.**
10. **Prefer typed domain-facing client interface over direct `HttpClient` usage everywhere.**
11. **Test the ugly cases, not only the happy path.**
12. **If you need rich interceptor/pooling control, consider OkHttp/Apache instead of forcing JDK client.**

---

## 39. Minimal Production Template

```java
public final class HttpClients {
    private HttpClients() {}

    public static HttpClient externalApiClient(Duration connectTimeout) {
        return HttpClient.newBuilder()
            .connectTimeout(connectTimeout)
            .followRedirects(HttpClient.Redirect.NEVER)
            .version(HttpClient.Version.HTTP_2)
            .build();
    }
}
```

```java
public interface ExternalApiTransport {
    <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler)
        throws IOException, InterruptedException;
}
```

```java
public final class JdkExternalApiTransport implements ExternalApiTransport {
    private final HttpClient client;

    public JdkExternalApiTransport(HttpClient client) {
        this.client = Objects.requireNonNull(client);
    }

    @Override
    public <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler)
            throws IOException, InterruptedException {
        return client.send(request, handler);
    }
}
```

```java
public final class SafeHttpLogger {
    public void logResult(HttpRequest request, int status, long latencyMillis) {
        String safeTarget = request.uri().getScheme() + "://" + request.uri().getHost() + request.uri().getPath();
        System.out.printf("http_client target=%s status=%d latency_ms=%d%n", safeTarget, status, latencyMillis);
    }
}
```

---

## 40. Latihan Praktis

### Latihan 1 — Basic typed client

Buat client untuk endpoint:

```text
GET /v1/customers/{id}
```

Syarat:

- menggunakan JDK `HttpClient`;
- ada request timeout;
- ada bearer token;
- ada correlation ID;
- 404 menjadi `CustomerNotFoundException`;
- 429/503/504 menjadi retryable exception;
- invalid JSON menjadi protocol exception.

### Latihan 2 — Timeout budget

Diberikan SLA caller 1500 ms. Buat budget untuk:

```text
customer-api
order-api
payment-api
```

Lalu tentukan:

- timeout per downstream;
- boleh retry atau tidak;
- max attempts;
- fallback behavior.

### Latihan 3 — Async fan-out dengan limit

Buat fan-out 100 customer lookup, tapi batasi concurrent request ke 10.

Syarat:

- jangan kirim semua sekaligus;
- collect success/failure;
- timeout per request;
- cancellation jika parent deadline habis.

### Latihan 4 — File download safe

Buat downloader yang:

- download ke temporary file;
- validasi status 200;
- validasi content type;
- validasi checksum;
- rename atomically setelah sukses;
- cleanup jika gagal.

### Latihan 5 — Observability wrapper

Buat decorator `HttpTransport` yang mencatat:

- latency;
- status class;
- exception category;
- correlation ID;
- sanitized URL.

---

## 41. Ringkasan

JDK `HttpClient` adalah pilihan kuat untuk Java modern karena:

- native di JDK;
- immutable dan reusable;
- mendukung HTTP/1.1 dan HTTP/2;
- mendukung sync dan async;
- terintegrasi dengan TLS, proxy, authenticator, cookie handler, executor;
- cocok dengan virtual threads;
- cukup untuk banyak use case production.

Namun untuk menjadi production-grade, kita tidak cukup hanya memakai API-nya. Kita perlu membangun layer di sekelilingnya:

```text
request factory
→ auth provider
→ transport wrapper
→ timeout policy
→ retry/rate limit/bulkhead/circuit breaker
→ error mapper
→ DTO mapper
→ observability
→ testing harness
```

Perbedaan engineer biasa dan engineer top-tier bukan pada kemampuan menulis `client.send()`, tetapi pada kemampuan menjawab:

```text
Apa yang terjadi jika DNS lambat?
Apa yang terjadi jika TLS gagal?
Apa yang terjadi jika response body 500 MB?
Apa yang terjadi jika 1000 request async dikirim bersamaan?
Apa yang terjadi jika token expired di semua thread sekaligus?
Apa yang terjadi jika downstream mengembalikan 429?
Apa yang terjadi jika caller membatalkan request?
Apa yang terjadi jika redirect mengarah ke host lain?
Apa yang terjadi jika status 200 tapi body invalid?
Apa metric yang membuktikan client sehat?
```

Jika pertanyaan-pertanyaan itu bisa dijawab dari desain client, maka JDK `HttpClient` bukan sekadar API bawaan JDK. Ia sudah menjadi bagian dari platform engineering yang defensible.

---

## 42. Referensi Utama

- Oracle Java SE 25 API — `java.net.http` module.
- Oracle Java SE 25 API — `HttpClient`.
- Oracle Java SE 25 API — `HttpRequest` dan `BodyPublishers`.
- Oracle Java SE 25 API — `HttpResponse`, `BodyHandlers`, dan `BodySubscribers`.
- OpenJDK HTTP Client introduction.
- Oracle JSSE Reference Guide untuk TLS/SSL context.
- Java networking properties documentation untuk system properties terkait `java.net.http`.

---

## 43. Status Series

Selesai:

```text
Part 0  — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
Part 1  — Java HTTP Client Landscape di Java 8–25
Part 2  — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body
Part 3  — URI, URL, Encoding, Query Parameter, dan Canonical Request
Part 4  — Headers, Content Negotiation, Compression, dan Metadata Contract
Part 5  — Body Handling: JSON, Form, Multipart, Streaming, File Upload/Download
Part 6  — Timeout Engineering: Connect, Read, Write, Call, Pool, DNS, TLS
Part 7  — Connection Pooling, Keep-Alive, HTTP/2 Multiplexing, dan Resource Reuse
Part 8  — DNS, Proxy, Load Balancer, NAT, dan Network Topology Awareness
Part 9  — TLS, mTLS, Trust Store, Key Store, ALPN, Certificate Pinning
Part 10 — Authentication Client-Side: Basic, Bearer, OAuth2, API Key, HMAC, Token Refresh
Part 11 — Retry Engineering: Idempotency, Backoff, Jitter, Retry Budget, dan Hedging
Part 12 — Rate Limiting, Throttling, Bulkhead, dan Client-Side Load Shedding
Part 13 — Circuit Breaker, Timeout, Retry, dan Fallback Composition
Part 14 — JDK HttpClient Deep Dive
```

Berikutnya:

```text
Part 15 — OkHttp Deep Dive: Client, Dispatcher, Interceptor, ConnectionPool
File: 15-okhttp-deep-dive-client-dispatcher-interceptor-connectionpool.md
```


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 13 — Circuit Breaker, Timeout, Retry, dan Fallback Composition](./13-circuit-breaker-timeout-retry-fallback-composition.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 15 — OkHttp Deep Dive: Client, Dispatcher, Interceptor, ConnectionPool](./15-okhttp-deep-dive-client-dispatcher-interceptor-connectionpool.md)
