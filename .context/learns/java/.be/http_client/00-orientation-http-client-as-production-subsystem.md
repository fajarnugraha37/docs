# Part 0 — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility

Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
File: `00-orientation-http-client-as-production-subsystem.md`  
Target Java: 8 sampai 25  
Fokus: Java HTTP Client, OkHttp, Retrofit, Apache HttpClient, dan client-side HTTP engineering

---

## 0.1. Tujuan Part Ini

Banyak engineer memulai HTTP client dari pertanyaan seperti:

```java
How do I call this REST API?
```

Itu pertanyaan yang valid, tetapi terlalu kecil untuk sistem production.

Untuk sistem production, pertanyaan yang lebih tepat adalah:

```text
Bagaimana saya mendesain subsystem komunikasi keluar yang:
- benar secara protokol,
- aman terhadap failure,
- efisien terhadap resource,
- observable,
- testable,
- auditable,
- mudah dimigrasikan,
- dan tidak menyebarkan detail HTTP ke seluruh domain code?
```

Part ini membangun mental model tersebut.

Kita belum akan masuk terlalu dalam ke API spesifik seperti `HttpClient.newHttpClient()`, `OkHttpClient.Builder()`, atau `Retrofit.Builder()`. Itu akan dibahas di part khusus. Part ini bertugas memberi fondasi berpikir agar saat memakai library apa pun, desainnya tidak dangkal.

---

## 0.2. Posisi Materi Ini terhadap Series Sebelumnya

Kita sudah membahas banyak fondasi Java:

- Java core
- collections dan streams
- concurrency dan reactive
- data types
- reliability
- DSA
- IO/NIO/networking/data transfer
- HTTP/gRPC/protocol engineering
- file/filesystem/storage
- security/cryptography
- SQL/JDBC/HikariCP
- OOP/functional/reflection/codegen/modules
- testing/benchmarking/performance/JVM
- memory/buffer/off-heap/GC
- Jakarta stack
- JAX-RS, validation, persistence, CDI, servlet, security, batch, mail, pages
- build, deployment, mapper, ORM, MyBatis, migration tools

Maka series ini tidak akan mengulang:

- apa itu HTTP secara umum,
- apa itu TCP/TLS secara umum,
- basic JSON mapping,
- basic concurrency,
- basic testing,
- basic security,
- basic deployment.

Yang kita bahas di sini adalah **client-side HTTP sebagai engineering subsystem**.

Artinya, kita fokus pada keputusan seperti:

- client harus dibuat singleton atau per request?
- timeout mana yang harus ada?
- retry boleh dilakukan kapan?
- response body harus ditutup di mana?
- bagaimana menghindari pool exhaustion?
- bagaimana token refresh tidak menyebabkan thundering herd?
- bagaimana HTTP error diterjemahkan menjadi domain error?
- bagaimana log request tanpa membocorkan token/PII?
- bagaimana memilih JDK HttpClient vs OkHttp vs Retrofit vs Apache HttpClient?
- bagaimana membuat client yang bisa diaudit dan dioperasikan saat incident?

---

## 0.3. Kenapa HTTP Client Sering Menjadi Sumber Incident Tersembunyi

HTTP client terlihat sederhana karena API-nya sering sangat kecil:

```java
var response = client.send(request, BodyHandlers.ofString());
```

atau:

```java
Response response = okHttpClient.newCall(request).execute();
```

atau:

```java
Call<User> call = userApi.getUser(id);
User user = call.execute().body();
```

Tetapi di balik satu baris itu ada banyak subsistem:

```text
application thread
  -> request construction
  -> URI encoding
  -> DNS lookup
  -> connection pool lookup
  -> TCP connect
  -> TLS handshake
  -> protocol negotiation
  -> request header write
  -> request body write
  -> server processing wait
  -> response header read
  -> response body read/decode
  -> connection release/reuse
  -> error mapping
  -> metric/tracing/logging
  -> domain return value
```

Jika salah satu tahap itu tidak dikontrol, bug-nya bisa muncul sebagai:

- API lambat tanpa root cause jelas.
- Thread habis.
- CPU naik karena retry storm.
- Memory naik karena response body besar dibuffer penuh.
- Connection pool habis.
- NAT gateway port exhaustion.
- Load balancer melihat terlalu banyak koneksi baru.
- Downstream overload karena caller retry agresif.
- Token provider overload karena semua thread refresh token bersamaan.
- Incident sulit dianalisis karena tidak ada metric per downstream.
- Log bocor token/PII.
- Request duplikat menyebabkan side effect bisnis.

HTTP client yang buruk jarang terlihat buruk pada development environment. Ia biasanya terlihat normal sampai volume, latency, partial failure, atau perubahan jaringan muncul.

---

## 0.4. Mindset Utama: HTTP Client Adalah Boundary, Bukan Helper

Kesalahan umum adalah membuat utility seperti ini:

```java
public final class HttpUtils {
    public static String postJson(String url, String body) {
        // send HTTP request
    }
}
```

Masalahnya bukan karena utility selalu salah. Masalahnya adalah utility seperti itu sering menyembunyikan dimensi penting:

- timeout apa yang dipakai?
- retry apa yang dipakai?
- koneksi di-reuse atau tidak?
- header tracing dipasang atau tidak?
- error 400/500 dibedakan atau tidak?
- response body ditutup atau tidak?
- authentication dilakukan di mana?
- metric diberi label downstream apa?
- endpoint boleh dipanggil dari domain mana?
- apakah request idempotent?
- apakah body boleh dilog?

Dalam desain yang lebih matang, HTTP client diperlakukan sebagai **boundary adapter**.

Contoh mental model:

```text
Domain Service
  -> Port Interface
      -> External API Adapter
          -> Typed HTTP Client
              -> Low-level HTTP Engine
                  -> Network
```

Contoh:

```text
CaseAssignmentService
  -> OfficerDirectoryPort
      -> OfficerDirectoryHttpAdapter
          -> OfficerDirectoryClient
              -> OkHttp/JDK HttpClient/Apache HttpClient
```

Dengan model ini, domain tidak tahu:

- URL downstream,
- header HTTP,
- token,
- status code mentah,
- retry,
- JSON field vendor,
- library HTTP yang dipakai.

Domain hanya tahu kontrak bisnis:

```java
interface OfficerDirectoryPort {
    Optional<OfficerProfile> findOfficerById(OfficerId officerId);
}
```

HTTP detail ditempatkan di adapter:

```java
final class OfficerDirectoryHttpAdapter implements OfficerDirectoryPort {
    private final OfficerDirectoryApiClient client;

    @Override
    public Optional<OfficerProfile> findOfficerById(OfficerId officerId) {
        ExternalOfficerResponse response = client.getOfficer(officerId.value());
        return response.toDomainProfile();
    }
}
```

Inilah perbedaan mendasar antara engineer biasa dan engineer yang matang: bukan hanya bisa melakukan HTTP call, tetapi tahu di mana boundary seharusnya hidup.

---

## 0.5. Definisi Kerja: Apa Itu HTTP Client Subsystem?

Dalam series ini, **HTTP client subsystem** berarti gabungan dari beberapa layer:

```text
1. API-facing abstraction
   - interface/domain port
   - method name yang punya arti bisnis
   - input/output domain-safe

2. Client adapter
   - mapping domain request ke HTTP request
   - mapping HTTP response ke domain result
   - error translation

3. HTTP execution engine
   - JDK HttpClient
   - OkHttp
   - Apache HttpClient
   - Reactor Netty
   - Jetty client
   - dll.

4. Policy layer
   - timeout
   - retry
   - circuit breaker
   - rate limit
   - bulkhead
   - authentication
   - redirect policy

5. Resource layer
   - connection pool
   - thread/executor
   - buffer
   - DNS resolver
   - TLS context

6. Observability layer
   - logs
   - metrics
   - tracing
   - audit events

7. Test and operation layer
   - mock server
   - contract tests
   - runbook
   - production diagnosis
```

Kalau code Anda hanya punya layer nomor 3, artinya Anda baru punya transport library, belum punya production subsystem.

---

## 0.6. Library Landscape Singkat

### 0.6.1. `HttpURLConnection`

`HttpURLConnection` adalah API lama yang tersedia sejak lama di JDK. Ia masih bisa digunakan pada Java 8, tetapi ergonominya rendah untuk kebutuhan modern.

Biasanya cocok untuk:

- program kecil,
- environment sangat terbatas,
- dependency tidak boleh ditambah,
- call sederhana yang tidak high-throughput.

Namun untuk production client modern, ia sering tidak ideal karena:

- API verbose,
- error handling tidak nyaman,
- konfigurasi timeout dan streaming raw,
- observability dan extensibility terbatas,
- tidak seergonomis library modern.

### 0.6.2. JDK `java.net.http.HttpClient`

`java.net.http.HttpClient` adalah HTTP client modern bawaan JDK. Modul `java.net.http` mendefinisikan HTTP Client dan WebSocket API. Dokumentasi Java SE 25 menyatakan modul ini menyediakan API HTTP Client dan WebSocket, dengan tipe utama seperti `HttpClient`, `HttpRequest`, `HttpResponse`, dan `WebSocket`.[^jdk-http-module]

Karakter penting:

- tersedia sebagai standard JDK modern,
- mendukung HTTP/1.1 dan HTTP/2,
- mendukung request sync dan async,
- memakai `CompletableFuture` untuk async,
- immutable setelah dibuat,
- dapat dipakai untuk banyak request,
- tidak perlu dependency eksternal.

Cocok untuk:

- aplikasi Java 11+ yang ingin dependency minimal,
- service internal dengan kebutuhan HTTP cukup standar,
- client yang ingin integrasi natural dengan JDK,
- penggunaan bersama virtual threads pada Java modern.

Kurang cocok jika:

- butuh ecosystem interceptor seperti OkHttp,
- butuh Retrofit interface model,
- butuh fitur advanced Apache HttpClient,
- masih harus berjalan di Java 8 tanpa backport/library tambahan.

### 0.6.3. OkHttp

OkHttp adalah HTTP client populer dari Square. Dokumentasi resminya menekankan efisiensi default: HTTP/2 memungkinkan request ke host yang sama berbagi socket, connection pooling mengurangi latency bila HTTP/2 tidak tersedia, transparent GZIP mengurangi ukuran download, dan response caching bisa menghindari network untuk request berulang.[^okhttp-overview]

Karakter penting:

- mature,
- populer di JVM dan Android,
- API relatif bersih,
- interceptor sangat kuat,
- connection pooling bagus,
- HTTP/2 support,
- event listener untuk observability,
- certificate pinning support,
- mudah dipakai sebagai transport Retrofit.

Cocok untuk:

- Java 8+,
- aplikasi yang butuh client tangguh dengan dependency eksternal,
- client dengan interceptor chain,
- API client SDK,
- Retrofit-based client,
- kebutuhan observability di level event.

### 0.6.4. Retrofit

Retrofit bukan HTTP engine murni. Retrofit adalah type-safe HTTP API client berbasis interface. Dokumentasi resminya menjelaskan bahwa request dijelaskan lewat annotation pada method interface, mendukung URL parameter replacement, query parameter, konversi object ke request body, multipart, dan file upload.[^retrofit-intro]

Contoh gaya Retrofit:

```java
interface GitHubApi {
    @GET("users/{user}/repos")
    Call<List<Repo>> listRepos(@Path("user") String user);
}
```

Retrofit cocok ketika:

- ingin API client berbentuk interface,
- punya banyak endpoint,
- ingin mapping endpoint lebih deklaratif,
- ingin converter JSON/XML/protobuf,
- ingin generated-like client tetapi tetap manual dan terkontrol,
- ingin memakai OkHttp di bawahnya.

Retrofit kurang cocok jika:

- request sangat dinamis dan tidak cocok dengan annotation,
- perlu kontrol sangat detail pada protocol execution,
- tidak ingin dependency tambahan,
- domain membutuhkan abstraction lebih eksplisit daripada annotation interface.

### 0.6.5. Apache HttpClient 5

Apache HttpClient 5 adalah library enterprise-grade dari Apache HttpComponents. Dokumentasi resminya menyediakan classic, fluent, dan async API, serta arsitektur dan guide khusus.[^apache-overview] Dokumentasi connection management menyatakan HttpClient me-reuse persistent connections untuk mengurangi latency dan resource usage, dengan connection manager khusus untuk classic blocking dan async I/O.[^apache-connection-management]

Cocok untuk:

- enterprise integration,
- kebutuhan proxy/route/credentials/cookie kompleks,
- migration dari Apache HttpClient 4.x,
- kontrol connection manager yang detail,
- classic blocking maupun async client.

### 0.6.6. Spring `RestTemplate`, `WebClient`, `RestClient`

Dalam aplikasi Spring, sering ada layer tambahan:

- `RestTemplate` untuk blocking synchronous client lama.
- `WebClient` untuk reactive/non-blocking client.
- `RestClient` untuk synchronous fluent API modern di Spring Framework 6.1+.

Poin penting: Spring client bukan selalu engine final. Ia bisa memakai underlying HTTP client berbeda, misalnya JDK, Apache, Reactor Netty, atau Jetty tergantung konfigurasi.

Ini penting karena banyak engineer salah berpikir:

```text
Saya memakai WebClient, berarti semuanya otomatis non-blocking dan aman.
```

Belum tentu. Yang menentukan adalah:

- connector yang dipakai,
- apakah chain blocking di tengah,
- executor/thread model,
- timeout policy,
- pool policy,
- backpressure policy,
- cara konsumsi response body.

---

## 0.7. Evolusi Java 8 sampai Java 25: Dampaknya pada HTTP Client Design

### 0.7.1. Java 8

Pada Java 8, pilihan umum:

- `HttpURLConnection`
- Apache HttpClient 4.x/5.x
- OkHttp
- Retrofit
- Spring `RestTemplate`
- async library lain

Keterbatasan penting:

- tidak ada standard JDK modern `HttpClient`,
- concurrency biasanya memakai platform thread, executor, `CompletableFuture`, atau reactive library,
- blocking call mahal jika jumlahnya sangat besar,
- perlu hati-hati pada thread pool sizing.

### 0.7.2. Java 11+

Java 11 memperkenalkan baseline umum modern untuk JDK `HttpClient` sebagai API standard. Pada Java 11+, keputusan dependency berubah:

```text
Butuh HTTP client sederhana sampai menengah?
  JDK HttpClient cukup menarik.

Butuh interceptor rich, Retrofit, atau behavior OkHttp?
  OkHttp tetap relevan.

Butuh enterprise protocol knobs/proxy/route detail?
  Apache HttpClient tetap relevan.
```

### 0.7.3. Java 17

Java 17 sering menjadi LTS baseline enterprise. Banyak organisasi mulai standardisasi di Java 17. Pada titik ini:

- JDK HttpClient sudah matang untuk banyak use case.
- OkHttp/Retrofit tetap cocok untuk Java 8+ compatibility.
- Apache HttpClient 5 menjadi opsi enterprise kuat.
- Spring Boot 3 ecosystem mulai menuntut Java 17.

### 0.7.4. Java 21+

Java 21 membawa virtual threads sebagai fitur final. Ini mengubah cara berpikir blocking IO.

Sebelum virtual threads:

```text
blocking HTTP call = memakai platform thread selama menunggu network
```

Dengan virtual threads:

```text
blocking HTTP call bisa dibuat jauh lebih murah dari sisi thread occupancy,
tetapi bukan berarti downstream, connection pool, timeout, retry, dan rate limit otomatis aman.
```

Virtual threads tidak menghapus kebutuhan:

- timeout,
- bulkhead,
- concurrency limit,
- connection pool sizing,
- retry budget,
- rate limit,
- observability.

Virtual threads mengurangi rasa sakit thread-per-request, tetapi tidak mengubah hukum sistem terdistribusi.

### 0.7.5. Java 25

Pada Java 25, JDK `HttpClient` tetap menjadi pilihan standard bawaan JDK modern. Namun pilihan terbaik tetap bergantung pada context:

- dependency policy,
- Java baseline,
- framework,
- need for Retrofit-like interface,
- need for Apache advanced knobs,
- observability requirement,
- runtime model,
- operational maturity.

---

## 0.8. Mental Model Request Lifecycle

Setiap outbound call dapat dipikirkan sebagai pipeline:

```text
[1] Domain intent
    "Get officer profile"

[2] Client method
    officerClient.getOfficer(officerId)

[3] Request construction
    method, URI, header, body

[4] Policy application
    auth, tracing, timeout, retry, rate limit

[5] Network acquisition
    DNS, pool, TCP, TLS

[6] Protocol exchange
    write request, read response

[7] Body handling
    stream, buffer, decode, close

[8] Error classification
    success, retryable, non-retryable, domain error

[9] Mapping
    external DTO -> internal result

[10] Observability
     logs, metrics, traces, audit
```

Untuk engineer top-tier, setiap step punya pertanyaan desain.

### Step 1 — Domain Intent

Pertanyaan:

- Ini command atau query?
- Apakah idempotent?
- Apakah boleh retry?
- Apakah partial failure acceptable?
- Apakah response boleh stale?
- Apakah request punya regulatory/audit implication?

Contoh:

```text
GET postal-code geocoding
  -> query
  -> relatif aman retry
  -> bisa cache
  -> stale mungkin acceptable

POST payment settlement
  -> command
  -> retry berbahaya tanpa idempotency key
  -> perlu audit
  -> duplicate side effect mahal
```

### Step 2 — Client Method

Method harus mencerminkan contract, bukan sekadar HTTP.

Kurang baik:

```java
String post(String url, String body);
```

Lebih baik:

```java
AddressResolutionResult resolvePostalCode(PostalCode postalCode);
```

Kenapa?

Karena domain caller tidak perlu tahu downstream memakai:

- `GET /v1/search?postalCode=...`
- `POST /address/resolve`
- token header,
- retry,
- cache,
- JSON response vendor.

### Step 3 — Request Construction

Pertanyaan:

- URI encoding benar?
- Path variable aman?
- Query parameter optional bagaimana?
- Header mandatory apa?
- Content-Type sesuai?
- Accept sesuai?
- Body streaming atau buffered?
- Apakah request bisa diulang untuk retry?

### Step 4 — Policy Application

Policy tidak boleh tersebar random.

Contoh policy:

- timeout 2 detik,
- retry maksimal 2 kali untuk 502/503/504,
- no retry untuk 400/401/403/404,
- rate limit 250 request/menit,
- token refresh saat 401 dengan single-flight,
- correlation id selalu dikirim,
- Authorization tidak pernah dilog.

Jika policy tersebar di 20 service class, sistem akan sulit dikontrol.

### Step 5 — Network Acquisition

Pertanyaan:

- DNS lookup berapa lama?
- IP berubah tapi connection pool masih simpan koneksi lama?
- Pool penuh?
- TCP connect gagal?
- TLS handshake gagal?
- Proxy dipakai?
- NAT port habis?
- Load balancer idle timeout mismatch?

### Step 6 — Protocol Exchange

Pertanyaan:

- HTTP/1.1 atau HTTP/2?
- Connection reused?
- Request body besar?
- Server lambat kirim header?
- Server kirim response chunked?
- Redirect diikuti atau tidak?
- 100-continue dipakai atau tidak?

### Step 7 — Body Handling

Pertanyaan:

- Body dibaca penuh ke memory atau streaming?
- Response body selalu ditutup?
- Error body juga dibaca/ditutup?
- File download ditulis streaming ke disk?
- JSON parser bisa handle unknown field?
- Body terlalu besar dibatasi?

### Step 8 — Error Classification

Jangan semua exception dianggap sama.

Contoh taxonomy:

```text
Transport failure:
- DNS failure
- connect timeout
- connection refused
- connection reset
- TLS handshake failure

Protocol failure:
- invalid status line
- malformed header
- invalid compression
- response too large

HTTP status failure:
- 400 bad request
- 401 unauthorized
- 403 forbidden
- 404 not found
- 409 conflict
- 429 rate limited
- 500 internal server error
- 502 bad gateway
- 503 unavailable
- 504 gateway timeout

Semantic/domain failure:
- downstream returns 200 but business status = rejected
- response missing required business field
- duplicate transaction
- invalid workflow state
```

### Step 9 — Mapping

Mapping harus menghindari bocornya vendor DTO ke domain.

Kurang baik:

```java
ExternalOfficerJson json = officerApi.getOfficer(id);
caseService.assign(json.getOfficerCode(), json.getOrgUnitCode());
```

Lebih baik:

```java
OfficerProfile profile = officerDirectory.findOfficer(id)
    .orElseThrow(() -> new OfficerNotFoundException(id));
caseService.assign(profile.officerId(), profile.orgUnit());
```

### Step 10 — Observability

Setiap client seharusnya menjawab:

- downstream mana yang dipanggil?
- endpoint/method apa?
- latency berapa?
- status code apa?
- retry berapa kali?
- timeout terjadi di mana?
- pool sedang penuh atau tidak?
- correlation id apa?
- trace id apa?
- error body aman dibaca atau disensor?

---

## 0.9. “Sukses” HTTP Call Tidak Sama dengan “Benar”

HTTP call yang berhasil di local development belum tentu benar.

Contoh code:

```java
public String call(String url) throws IOException, InterruptedException {
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest request = HttpRequest.newBuilder(URI.create(url)).GET().build();
    return client.send(request, HttpResponse.BodyHandlers.ofString()).body();
}
```

Sekilas berhasil.

Masalah production:

- client dibuat per call, sehingga connection pooling tidak optimal,
- tidak ada timeout eksplisit,
- tidak ada error classification,
- tidak ada metric,
- tidak ada tracing,
- semua response dibaca sebagai string,
- tidak ada limit body,
- tidak ada retry policy,
- tidak ada redaction,
- URL bebas bisa menjadi SSRF jika input user,
- caller tidak tahu status code.

Versi production-minded akan memecah concern:

```java
public final class OfficerDirectoryClient {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final Duration requestTimeout;
    private final ObjectMapper objectMapper;

    public OfficerDirectoryClient(
            HttpClient httpClient,
            URI baseUri,
            Duration requestTimeout,
            ObjectMapper objectMapper
    ) {
        this.httpClient = Objects.requireNonNull(httpClient);
        this.baseUri = Objects.requireNonNull(baseUri);
        this.requestTimeout = Objects.requireNonNull(requestTimeout);
        this.objectMapper = Objects.requireNonNull(objectMapper);
    }

    public OfficerProfileResponse getOfficer(String officerId) {
        URI uri = baseUri.resolve("/api/officers/" + encodePathSegment(officerId));

        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(requestTimeout)
                .header("Accept", "application/json")
                .header("X-Correlation-Id", Correlation.currentId())
                .GET()
                .build();

        HttpResponse<String> response = send(request);
        return decode(response);
    }

    private HttpResponse<String> send(HttpRequest request) {
        try {
            return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (HttpTimeoutException e) {
            throw new DownstreamTimeoutException("officer-directory", e);
        } catch (IOException e) {
            throw new DownstreamTransportException("officer-directory", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new DownstreamInterruptedException("officer-directory", e);
        }
    }

    private OfficerProfileResponse decode(HttpResponse<String> response) {
        int status = response.statusCode();
        if (status == 404) {
            throw new OfficerNotFoundAtSourceException();
        }
        if (status >= 400 && status < 500) {
            throw new DownstreamClientErrorException("officer-directory", status, safeBody(response.body()));
        }
        if (status >= 500) {
            throw new DownstreamServerErrorException("officer-directory", status, safeBody(response.body()));
        }
        try {
            return objectMapper.readValue(response.body(), OfficerProfileResponse.class);
        } catch (JsonProcessingException e) {
            throw new DownstreamProtocolException("officer-directory", "Invalid JSON response", e);
        }
    }
}
```

Code ini belum sempurna, tetapi arahnya lebih benar karena mulai membedakan:

- dependency client reusable,
- timeout eksplisit,
- correlation id,
- status code classification,
- transport vs protocol vs domain error,
- interrupt handling,
- JSON parsing boundary.

---

## 0.10. Prinsip Pertama: Reuse Client, Jangan Buat Per Request

Banyak HTTP library mendesain client object sebagai container resource:

- connection pool,
- dispatcher/executor,
- DNS config,
- TLS config,
- proxy config,
- cookie/auth config,
- interceptor/policy chain.

Maka pola ini sering buruk:

```java
public Response call(Request request) {
    OkHttpClient client = new OkHttpClient();
    return client.newCall(request).execute();
}
```

Kenapa buruk?

Karena setiap client baru berpotensi punya pool/resource sendiri. Akibatnya:

- connection reuse rendah,
- TLS handshake lebih sering,
- latency naik,
- socket churn naik,
- CPU naik,
- load balancer melihat lebih banyak koneksi,
- resource leak lebih mudah.

Pola lebih baik:

```java
public final class ExternalApiClients {
    private final OkHttpClient sharedOkHttpClient;

    public ExternalApiClients(OkHttpClient sharedOkHttpClient) {
        this.sharedOkHttpClient = sharedOkHttpClient;
    }

    public PaymentClient paymentClient() {
        return new PaymentClient(sharedOkHttpClient);
    }

    public NotificationClient notificationClient() {
        return new NotificationClient(sharedOkHttpClient);
    }
}
```

Atau per downstream jika kebutuhannya berbeda:

```text
paymentClient
  timeout: strict
  retry: very limited
  pool: small but protected

searchClient
  timeout: medium
  retry: safe for GET
  pool: larger

reportingClient
  timeout: long
  retry: batch-aware
  pool: isolated
```

Top-tier thinking bukan selalu “satu client global untuk semua”. Yang benar adalah:

```text
Reuse client untuk mendapatkan pooling,
tetapi isolasi client jika policy/resource/failure domain berbeda.
```

---

## 0.11. Prinsip Kedua: Timeout Bukan Satu Angka

Banyak code hanya punya:

```text
timeout = 30 seconds
```

Pertanyaannya: timeout apa?

Kemungkinan:

- DNS timeout,
- connect timeout,
- TLS handshake timeout,
- write timeout,
- read timeout,
- response timeout,
- call timeout,
- pool acquisition timeout,
- total deadline,
- retry budget.

Timeout harus dipikirkan sebagai budget.

Contoh service chain:

```text
User request SLA: 2 seconds

Application service processing internal: 300 ms
Database budget: 500 ms
External API budget: 700 ms
Serialization/logging/margin: 500 ms
```

Jika external API client diberi timeout 30 detik, maka ia melanggar SLA caller. Itu bukan “aman”; itu membuat failure lebih lama, thread/resource lebih lama tertahan, dan user tetap gagal.

Better thinking:

```text
Total call deadline: 700 ms
Retry allowed: 1 retry only if safe
Attempt 1 timeout: 250 ms
Backoff: 50 ms
Attempt 2 timeout: 250 ms
Margin: 150 ms
```

Timeout tidak boleh diputuskan hanya dari feeling. Ia harus terkait dengan:

- upstream SLA,
- downstream SLO,
- retry policy,
- user journey,
- cost of failure,
- concurrency limit,
- business criticality.

---

## 0.12. Prinsip Ketiga: Retry Harus Berbasis Semantik, Bukan Exception Saja

Retry adalah salah satu sumber incident paling sering.

Naive retry:

```text
If failed, retry 3 times.
```

Masalah:

- request POST bisa dieksekusi dua kali,
- downstream overload makin parah,
- latency caller naik,
- thread tertahan lebih lama,
- 401 diretry tanpa refresh token,
- 400 diretry padahal request invalid,
- timeout setelah server memproses command bisa menyebabkan duplicate command.

Retry yang benar bertanya:

```text
1. Apakah operasi idempotent?
2. Apakah failure terjadi sebelum request diterima server?
3. Apakah server mungkin sudah memproses request?
4. Apakah status code retryable?
5. Apakah ada Retry-After?
6. Apakah masih ada deadline budget?
7. Apakah retry akan memperburuk overload?
8. Apakah ada idempotency key?
```

Contoh:

```text
GET /postal-code/123456
  retry: boleh, dengan backoff dan budget

POST /payments/settle
  retry: hanya jika ada idempotency key dan downstream contract mendukung

POST /email/send
  retry: hati-hati, bisa duplicate email

PUT /cases/{id}/assignment
  retry: mungkin aman jika replacement idempotent

PATCH /cases/{id}/status
  retry: tergantung transition model dan idempotency
```

Semantik bisnis menentukan retry, bukan hanya HTTP method.

---

## 0.13. Prinsip Keempat: Response Body Adalah Resource

Di banyak library, response body bukan sekadar string. Ia mewakili stream dari socket.

Jika body tidak dibaca atau ditutup:

- connection bisa tidak kembali ke pool,
- pool bisa habis,
- socket leak,
- latency request lain naik,
- production incident muncul sebagai “random timeout”.

OkHttp misalnya menggunakan `Response`/`ResponseBody` yang harus ditutup saat selesai. Pola aman:

```java
try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        throw new IOException("Unexpected status " + response.code());
    }
    return response.body().string();
}
```

JDK `HttpClient` dengan `BodyHandlers.ofString()` membaca body penuh ke string, sehingga lifecycle berbeda. Tetapi kalau memakai stream body handler, caller tetap bertanggung jawab mengonsumsi/menutup stream dengan benar.

Prinsipnya:

```text
Setiap response body harus punya owner lifecycle yang jelas.
```

Pertanyaan desain:

- siapa membaca body?
- siapa menutup body?
- apakah error body juga dibaca?
- body maksimal berapa MB?
- body streaming atau buffered?
- apakah body bisa dipakai ulang untuk retry? Biasanya tidak.

---

## 0.14. Prinsip Kelima: HTTP Status Bukan Domain Model

Jangan biarkan status code mentah menyebar ke domain.

Kurang baik:

```java
HttpResponse<String> response = paymentClient.call(...);
if (response.statusCode() == 409) {
    // business logic here
}
```

Lebih baik:

```java
PaymentSubmissionResult result = paymentGateway.submit(command);

switch (result.status()) {
    case ACCEPTED -> ...
    case DUPLICATE -> ...
    case REJECTED -> ...
    case TEMPORARILY_UNAVAILABLE -> ...
}
```

HTTP status adalah protocol-level signal. Domain membutuhkan business-level signal.

Mapping bisa seperti:

```text
HTTP 200 + { status: "APPROVED" }
  -> Approved

HTTP 200 + { status: "REJECTED", reason: "LIMIT_EXCEEDED" }
  -> Rejected(LIMIT_EXCEEDED)

HTTP 409
  -> DuplicateOrConflict, depending endpoint contract

HTTP 429
  -> TemporarilyRateLimited

HTTP 503
  -> DownstreamUnavailable
```

Top-tier client design selalu punya explicit translation boundary.

---

## 0.15. Prinsip Keenam: Observability Bukan Tambahan Belakangan

HTTP client tanpa observability adalah black box.

Minimal observability per downstream:

```text
Metrics:
- request count
- status code distribution
- latency histogram
- timeout count
- retry count
- circuit breaker state
- rate-limit rejection count
- connection pool usage if available

Logs:
- downstream name
- operation name
- status/failure type
- latency
- retry attempt
- correlation id
- sanitized error code

Tracing:
- span per outbound call
- peer service name
- HTTP method
- route/template, bukan full high-cardinality URL
- status/error
```

Jangan log sembarangan:

```text
Berbahaya:
- Authorization header
- Cookie
- Set-Cookie
- API key
- access token
- refresh token
- password
- client secret
- PII dalam request/response body
- full query string yang mengandung sensitive parameter
```

Observability yang baik bukan log sebanyak mungkin. Observability yang baik adalah **sinyal cukup untuk diagnosis tanpa membocorkan data**.

---

## 0.16. Prinsip Ketujuh: Client Harus Punya Failure Contract

Setiap HTTP client harus mendefinisikan failure contract.

Contoh buruk:

```java
public User getUser(String id) throws Exception;
```

Caller tidak tahu:

- user tidak ditemukan?
- downstream timeout?
- token invalid?
- response invalid?
- server error?
- rate limited?

Contoh lebih baik:

```java
public Optional<UserProfile> findUser(String id)
        throws UserDirectoryUnavailableException,
               UserDirectoryProtocolException;
```

Atau result type:

```java
sealed interface UserLookupResult permits
        UserLookupResult.Found,
        UserLookupResult.NotFound,
        UserLookupResult.TemporarilyUnavailable,
        UserLookupResult.InvalidResponse {

    record Found(UserProfile profile) implements UserLookupResult {}
    record NotFound(String userId) implements UserLookupResult {}
    record TemporarilyUnavailable(String reason) implements UserLookupResult {}
    record InvalidResponse(String reason) implements UserLookupResult {}
}
```

Dengan sealed interface Java 17+, caller dipaksa memikirkan semua state.

Untuk Java 8, bisa memakai:

- enum + payload,
- custom result class,
- exception hierarchy,
- Vavr/Either jika dependency diperbolehkan.

---

## 0.17. Prinsip Kedelapan: Jangan Campur Transport DTO dan Domain Model

External API sering berubah dengan cara yang tidak sesuai domain internal.

Contoh external response:

```json
{
  "officer_code": "A123",
  "dept": "ENF",
  "active_ind": "Y",
  "last_updated": "2026-06-18T10:15:30+08:00"
}
```

Jangan langsung jadikan ini domain model.

Buat boundary DTO:

```java
public final class OfficerDirectoryResponse {
    public String officer_code;
    public String dept;
    public String active_ind;
    public OffsetDateTime last_updated;
}
```

Lalu mapping ke domain:

```java
public OfficerProfile toDomain() {
    return new OfficerProfile(
            new OfficerId(officer_code),
            DepartmentCode.of(dept),
            "Y".equals(active_ind),
            last_updated
    );
}
```

Kenapa penting?

Karena external API bisa punya:

- snake_case,
- string flag `Y/N`,
- date format aneh,
- optional field tidak konsisten,
- enum value baru,
- field deprecated,
- nested structure vendor-specific.

Domain harus stabil. DTO external boleh kotor, domain jangan.

---

## 0.18. Prinsip Kesembilan: Security Boundary Dimulai dari URL

HTTP client adalah pintu keluar dari sistem. Ia bisa menjadi jalur serangan.

Risiko umum:

- SSRF,
- open redirect abuse,
- credential leakage,
- DNS rebinding,
- header injection,
- token in logs,
- weak TLS validation,
- trust-all certificate manager,
- query parameter sensitive,
- proxy bypass,
- unexpected internal host access.

Contoh berbahaya:

```java
public String fetch(String urlFromUser) {
    return http.get(urlFromUser);
}
```

Jika user bisa mengontrol URL, ia mungkin mencoba:

```text
http://localhost:8080/admin
http://169.254.169.254/latest/meta-data/
http://internal-service.namespace.svc.cluster.local
file:///etc/passwd
```

Defensive design:

```text
- jangan menerima full URL dari user jika tidak perlu,
- gunakan allowlist host,
- gunakan fixed base URL,
- validasi scheme http/https,
- tolak localhost/private IP jika tidak explicitly allowed,
- disable atau validasi redirect,
- jangan log full URL dengan query sensitive,
- jangan pernah pakai trust-all TLS di production.
```

---

## 0.19. Prinsip Kesepuluh: Configuration Harus Per Downstream, Bukan Global Buta

Anti-pattern:

```yaml
http:
  timeout: 30s
  retries: 3
```

Masalah:

- semua downstream dianggap sama,
- critical payment sama dengan optional analytics,
- GET cacheable sama dengan POST command,
- internal service sama dengan third-party API,
- latency SLA sama semua.

Better:

```yaml
clients:
  officer-directory:
    base-url: https://officer-directory.internal
    connect-timeout: 300ms
    call-timeout: 1200ms
    max-retries: 1
    retryable-statuses: [502, 503, 504]
    pool:
      max-idle: 20
      keep-alive: 5m

  payment-gateway:
    base-url: https://payment.example.com
    connect-timeout: 500ms
    call-timeout: 2000ms
    max-retries: 0
    idempotency-key-required: true

  notification-provider:
    base-url: https://notify.example.com
    connect-timeout: 500ms
    call-timeout: 3000ms
    max-retries: 2
    rate-limit-per-minute: 300
```

Per-downstream config membuat operasi lebih aman karena tiap dependency punya karakter berbeda.

---

## 0.20. Taxonomy HTTP Client Use Case

Tidak semua HTTP client sama.

### 0.20.1. Internal Microservice Client

Karakter:

- komunikasi service-to-service,
- latency rendah,
- service discovery/internal DNS,
- mTLS atau service mesh mungkin ada,
- tracing penting,
- version compatibility penting.

Concern utama:

- timeout pendek,
- pooling efisien,
- circuit breaker,
- tracing,
- deployment compatibility,
- error mapping antar service.

### 0.20.2. Third-Party API Client

Karakter:

- rate limit ketat,
- latency lebih variatif,
- SLA di luar kontrol,
- authentication/token rumit,
- error body vendor-specific,
- contract bisa berubah.

Concern utama:

- token refresh,
- retry hati-hati,
- rate limit,
- cache,
- robust parsing,
- audit,
- fallback/degradation,
- runbook.

### 0.20.3. Batch/ETL HTTP Client

Karakter:

- volume besar,
- throughput penting,
- pagination,
- checkpoint,
- resumability,
- long-running job.

Concern utama:

- backpressure,
- rate limit,
- pagination abstraction,
- retry with checkpoint,
- memory streaming,
- partial failure,
- resumable processing.

### 0.20.4. User-Facing Request Path Client

Karakter:

- ada user menunggu,
- latency budget ketat,
- failure langsung mempengaruhi UX,
- retry bisa memperpanjang response time.

Concern utama:

- strict deadline,
- fast failure,
- fallback,
- partial response,
- concurrency protection,
- observability.

### 0.20.5. Regulatory/Auditable Client

Karakter:

- request/response mungkin jadi bukti,
- keputusan harus defensible,
- data sensitive,
- audit trail penting.

Concern utama:

- correlation id,
- immutable audit record,
- redaction,
- non-repudiation where needed,
- deterministic error mapping,
- retention policy,
- access control.

---

## 0.21. Decision Matrix Awal

| Kebutuhan | JDK HttpClient | OkHttp | Retrofit | Apache HttpClient 5 | Spring WebClient/RestClient |
|---|---:|---:|---:|---:|---:|
| Java 8 support | Tidak native | Ya | Ya | Ya | Tergantung Spring version |
| Dependency minimal | Sangat baik | Perlu dependency | Perlu dependency | Perlu dependency | Dalam ekosistem Spring |
| HTTP/2 | Ya | Ya | Via OkHttp | Ya | Tergantung connector |
| Interface-based API | Manual | Manual | Sangat kuat | Manual | Manual/declarative via framework lain |
| Interceptor ecosystem | Terbatas | Sangat kuat | Via OkHttp | Kuat | Filter/interceptor Spring |
| Enterprise proxy/route/cookie/credential control | Sedang | Sedang | Bergantung OkHttp | Sangat kuat | Tergantung connector |
| Android heritage | Tidak | Sangat kuat | Sangat kuat | Tidak utama | Tidak utama |
| Async API | CompletableFuture | Callback | Call adapter | Classic + async | Reactive/non-blocking |
| Best for typed third-party SDK | Bisa | Bisa | Sangat cocok | Bisa | Bisa |
| Best for no external dependency | Sangat cocok | Tidak | Tidak | Tidak | Tidak |

Matrix ini bukan aturan mutlak. Ia hanya orientasi awal.

Pilihan bagus bergantung pada constraint:

```text
Java 8 mandatory?
  OkHttp/Retrofit/Apache.

Java 17+ dan dependency minimal?
  JDK HttpClient.

Banyak endpoint dan ingin interface annotation?
  Retrofit.

Butuh proxy/route/connection manager advanced?
  Apache HttpClient 5.

Aplikasi Spring reactive?
  WebClient, dengan perhatian pada connector dan blocking boundary.

Aplikasi Spring sync modern?
  RestClient bisa menarik.
```

---

## 0.22. Top 1% Lens: Pertanyaan Design Review untuk HTTP Client

Saat review HTTP client, jangan hanya tanya “jalan atau tidak”.

Tanya:

### Contract

```text
- Apa operasi bisnis yang direpresentasikan client ini?
- Apakah method client mencerminkan domain intent?
- Apakah HTTP detail bocor ke domain service?
- Apakah external DTO bocor ke domain model?
```

### Resource

```text
- Apakah client reusable?
- Apakah pool config jelas?
- Apakah response body selalu ditutup?
- Apakah large body streaming atau dibuffer?
- Apakah ada risiko memory blow-up?
```

### Timeout

```text
- Timeout mana yang dikonfigurasi?
- Apakah timeout sesuai upstream SLA?
- Apakah retry memperhitungkan total deadline?
- Apakah ada infinite wait?
```

### Retry

```text
- Operasi ini idempotent?
- Status/exception apa yang retryable?
- Apakah ada backoff dan jitter?
- Apakah ada retry budget?
- Apakah retry bisa menyebabkan duplicate side effect?
```

### Security

```text
- Base URL fixed atau user-controlled?
- Apakah redirect aman?
- Apakah TLS validation benar?
- Apakah token/header sensitive tidak dilog?
- Apakah ada allowlist host?
```

### Observability

```text
- Apakah ada metric per downstream dan operation?
- Apakah latency histogram tersedia?
- Apakah retry count terlihat?
- Apakah status code distribution terlihat?
- Apakah trace context dikirim?
- Apakah logs aman dari PII/token?
```

### Error Model

```text
- Apakah 4xx/5xx dibedakan?
- Apakah timeout/transport/protocol/domain error dibedakan?
- Apakah caller bisa mengambil keputusan benar?
- Apakah error body diparse secara aman?
```

### Operation

```text
- Jika downstream lambat, apa yang terjadi?
- Jika token provider down, apa yang terjadi?
- Jika DNS berubah, apa yang terjadi?
- Jika pool penuh, apa yang terjadi?
- Jika rate limit kena, apa yang terjadi?
- Apa mitigasi cepat saat incident?
```

---

## 0.23. Anti-Pattern Catalog Awal

### Anti-Pattern 1 — Client Dibuat Per Request

```java
new OkHttpClient().newCall(request).execute();
```

Dampak:

- pooling hilang,
- socket churn,
- TLS handshake berulang,
- latency naik.

### Anti-Pattern 2 — Tidak Ada Timeout Eksplisit

```java
client.send(request, BodyHandlers.ofString());
```

tanpa timeout yang jelas.

Dampak:

- request menggantung,
- thread/resource tertahan,
- failure propagation lambat.

### Anti-Pattern 3 — Retry Semua Error

```java
catch (Exception e) {
    retry();
}
```

Dampak:

- duplicate side effect,
- overload amplification,
- latency memburuk.

### Anti-Pattern 4 — Semua Error Jadi `RuntimeException`

```java
throw new RuntimeException("API failed");
```

Dampak:

- caller tidak bisa membedakan not found, timeout, invalid response, unauthorized, rate limited.

### Anti-Pattern 5 — Log Full Request/Response

```java
log.info("request={} response={}", requestBody, responseBody);
```

Dampak:

- token leakage,
- PII leakage,
- compliance issue.

### Anti-Pattern 6 — Domain Bergantung pada Vendor DTO

```java
ExternalPaymentResponse response = paymentApi.submit(...);
caseService.process(response.vendorStatusCode);
```

Dampak:

- vendor contract bocor ke domain,
- migration sulit,
- testing domain menjadi tergantung external schema.

### Anti-Pattern 7 — URL dari User Langsung Dipanggil

```java
http.get(userInputUrl);
```

Dampak:

- SSRF,
- internal network exposure,
- metadata endpoint exposure.

### Anti-Pattern 8 — Pool Global Tanpa Isolasi

```text
Semua downstream memakai client/pool yang sama tanpa limit/failure domain.
```

Dampak:

- satu downstream lambat menghabiskan resource untuk semua downstream.

### Anti-Pattern 9 — Async Tanpa Backpressure

```java
ids.forEach(id -> client.sendAsync(requestFor(id), handler));
```

Dampak:

- ribuan request paralel,
- downstream overload,
- memory naik,
- executor pressure.

### Anti-Pattern 10 — Trust-All TLS

```java
TrustManager[] trustAll = ...
```

Dampak:

- MITM risk,
- compliance failure,
- false sense of security.

---

## 0.24. Reference Architecture: Production-Grade HTTP Client Layer

Struktur package yang lebih matang:

```text
com.example.integration.officerdirectory
  ├── OfficerDirectoryPort.java
  ├── OfficerDirectoryHttpAdapter.java
  ├── OfficerDirectoryClient.java
  ├── OfficerDirectoryConfig.java
  ├── OfficerDirectoryAuthInterceptor.java
  ├── OfficerDirectoryErrorMapper.java
  ├── OfficerDirectoryRequestFactory.java
  ├── OfficerDirectoryResponseMapper.java
  ├── dto
  │   ├── OfficerDirectoryOfficerResponse.java
  │   └── OfficerDirectoryErrorResponse.java
  ├── exception
  │   ├── OfficerDirectoryUnavailableException.java
  │   ├── OfficerDirectoryRateLimitedException.java
  │   ├── OfficerDirectoryProtocolException.java
  │   └── OfficerDirectoryUnauthorizedException.java
  └── test
      ├── OfficerDirectoryClientTest.java
      ├── OfficerDirectoryContractTest.java
      └── OfficerDirectoryMockServerFixtures.java
```

Layering:

```text
Domain Service
  depends on OfficerDirectoryPort

OfficerDirectoryHttpAdapter
  implements OfficerDirectoryPort
  depends on OfficerDirectoryClient

OfficerDirectoryClient
  knows HTTP library
  knows request/response protocol
  does not contain domain workflow

ErrorMapper
  maps HTTP/protocol/vendor error to internal error

ResponseMapper
  maps external DTO to internal domain-safe object
```

---

## 0.25. Minimal Production Checklist

Sebelum sebuah HTTP client dianggap production-ready, minimal jawab ini:

```text
Contract:
[ ] Client method berbasis domain operation, bukan generic URL call.
[ ] External DTO tidak bocor ke domain.
[ ] Error model eksplisit.

Resource:
[ ] HTTP client object reused.
[ ] Response body lifecycle jelas.
[ ] Large body tidak selalu dibuffer penuh.
[ ] Connection pool policy diketahui.

Timeout:
[ ] Connect timeout ada.
[ ] Read/call/request timeout ada.
[ ] Timeout sesuai SLA caller.
[ ] Tidak ada infinite wait.

Retry:
[ ] Retry hanya untuk operasi aman/retryable.
[ ] Backoff/jitter ada jika retry digunakan.
[ ] Retry mempertimbangkan deadline.
[ ] Command non-idempotent dilindungi idempotency key atau tidak diretry.

Security:
[ ] Base URL controlled.
[ ] Redirect policy aman.
[ ] TLS validation tidak dimatikan.
[ ] Sensitive header/body tidak dilog.
[ ] Token/secret source aman.

Observability:
[ ] Metric per downstream.
[ ] Latency histogram.
[ ] Status code/failure classification.
[ ] Correlation/trace propagation.
[ ] Log redaction.

Testing:
[ ] Unit test mapping.
[ ] Mock server test.
[ ] Timeout/failure test.
[ ] Error body parsing test.
[ ] Contract compatibility test jika downstream kritikal.

Operation:
[ ] Config per environment.
[ ] Runbook failure tersedia.
[ ] Rate limit/bulkhead dipertimbangkan.
[ ] Circuit breaker/fallback dipertimbangkan untuk dependency kritikal.
```

---

## 0.26. Contoh Evolusi dari Naive ke Mature

### Level 0 — Naive Utility

```java
String body = HttpUtils.get("https://api.example.com/users/123");
```

Masalah:

- generic,
- tidak ada contract,
- tidak ada timeout eksplisit,
- tidak ada error model.

### Level 1 — Reusable Low-Level Client

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(500))
        .build();
```

Lebih baik karena client reusable dan timeout mulai ada.

Tetapi masih belum cukup.

### Level 2 — Typed Client

```java
UserResponse user = userDirectoryClient.getUser("123");
```

Lebih baik karena caller tidak tahu URL mentah.

### Level 3 — Domain Port

```java
Optional<UserProfile> user = userDirectory.findUser(UserId.of("123"));
```

Lebih baik karena domain tidak tahu external schema.

### Level 4 — Policy-Aware Client

```text
UserDirectoryClient:
- timeout budget
- retry only for safe cases
- token refresh single-flight
- metric/tracing
- error mapper
- redaction
```

### Level 5 — Operable Subsystem

```text
UserDirectory integration:
- config per environment
- contract tests
- dashboard
- alert
- runbook
- canary migration support
- fallback/degradation policy
```

Level 5 adalah target kita dalam series ini.

---

## 0.27. Cara Berpikir Saat Memilih Library

Jangan mulai dari fanatisme library.

Mulai dari constraint.

### Pertanyaan 1 — Java baseline apa?

```text
Java 8:
  JDK HttpClient modern tidak tersedia native.
  OkHttp, Retrofit, Apache HttpClient lebih realistis.

Java 11+:
  JDK HttpClient masuk opsi kuat.

Java 17/21/25:
  JDK HttpClient + virtual threads menjadi kombinasi menarik,
  tetapi OkHttp/Retrofit/Apache tetap relevan sesuai kebutuhan.
```

### Pertanyaan 2 — API contract seperti apa?

```text
Banyak endpoint stabil dengan schema jelas:
  Retrofit menarik.

Endpoint sangat dinamis:
  OkHttp/JDK/Apache manual lebih fleksibel.

OpenAPI tersedia dan governance kuat:
  generated client + wrapper bisa cocok.
```

### Pertanyaan 3 — Resource/failure requirement seperti apa?

```text
Butuh kontrol connection manager sangat detail:
  Apache HttpClient 5.

Butuh interceptor ergonomic dan event listener:
  OkHttp.

Butuh standard JDK minimal dependency:
  JDK HttpClient.
```

### Pertanyaan 4 — Framework apa?

```text
Spring MVC blocking:
  RestClient/JDK/Apache/OkHttp bisa.

Spring WebFlux reactive:
  WebClient natural, tetapi hati-hati blocking boundary.

Non-Spring service:
  JDK HttpClient/OkHttp/Apache/Retrofit langsung.
```

### Pertanyaan 5 — Operability requirement apa?

```text
Regulated system:
  explicit error model, audit, redaction, deterministic mapping.

High throughput:
  pooling, concurrency limit, backpressure, body streaming.

Third-party constrained API:
  rate limit, retry-after, token refresh, idempotency.
```

---

## 0.28. Di Mana Top 1% Engineer Berbeda?

Engineer biasa sering berhenti di:

```text
Saya bisa call API dan parse JSON.
```

Engineer lebih matang berpikir:

```text
Saya tahu bagaimana call ini gagal,
bagaimana failure itu menyebar,
bagaimana membatasinya,
bagaimana mengobservasinya,
bagaimana mengetesnya,
bagaimana memigrasikannya,
dan bagaimana menjelaskan ke auditor/incident commander apa yang terjadi.
```

Perbedaannya bukan hafalan API. Perbedaannya adalah model mental.

Top-tier HTTP client engineering meliputi:

1. **Protocol correctness**  
   URI, header, method semantics, body lifecycle, status code, TLS.

2. **Resource correctness**  
   connection pool, socket, stream, executor, memory, backpressure.

3. **Failure correctness**  
   timeout, retry, idempotency, circuit breaker, rate limit, fallback.

4. **Boundary correctness**  
   external DTO tidak bocor, HTTP detail tidak bocor, domain tetap bersih.

5. **Security correctness**  
   SSRF, token leakage, TLS validation, redirect, allowlist.

6. **Operational correctness**  
   metrics, tracing, logs, redaction, dashboard, runbook.

7. **Evolution correctness**  
   versioning, generated client, migration, compatibility, deprecation.

---

## 0.29. Running Example untuk Series Ini

Agar materi tidak abstrak, sepanjang series kita akan memakai beberapa running example.

### Example A — Postal Code Geocoding Client

Karakter:

- query/read operation,
- cacheable,
- rate limited,
- third-party API,
- safe retry dengan batas tertentu,
- response bisa stale dalam beberapa skenario.

Digunakan untuk membahas:

- GET request,
- query encoding,
- cache,
- rate limit,
- retry,
- fallback,
- observability.

### Example B — Payment/Settlement Client

Karakter:

- command/write operation,
- non-idempotent jika tidak dirancang,
- audit critical,
- token/auth penting,
- retry berbahaya.

Digunakan untuk membahas:

- POST request,
- idempotency key,
- error model,
- timeout budget,
- audit log,
- duplicate prevention.

### Example C — Internal Officer Directory Client

Karakter:

- internal microservice,
- low-latency,
- service-to-service auth,
- domain mapping penting,
- tracing penting.

Digunakan untuk membahas:

- typed client architecture,
- mTLS/service mesh,
- domain port,
- circuit breaker,
- internal versioning.

### Example D — Batch Document Download Client

Karakter:

- large response body,
- streaming,
- resumability,
- checksum/integrity,
- memory sensitive.

Digunakan untuk membahas:

- streaming body,
- file download,
- backpressure,
- retry partial failure,
- checksum.

---

## 0.30. Suggested Baseline Project Structure

Untuk latihan sepanjang series, kita bisa membayangkan modul seperti ini:

```text
learn-java-http-client-engineering
  ├── build.gradle / pom.xml
  ├── src/main/java
  │   └── com/example/httpclient
  │       ├── common
  │       │   ├── HttpClientFactory.java
  │       │   ├── Downstream.java
  │       │   ├── DownstreamException.java
  │       │   ├── RetryPolicy.java
  │       │   ├── TimeoutBudget.java
  │       │   └── Redaction.java
  │       ├── geocoding
  │       ├── payment
  │       ├── officerdirectory
  │       └── documentdownload
  └── src/test/java
      └── com/example/httpclient
          ├── geocoding
          ├── payment
          ├── officerdirectory
          └── documentdownload
```

Tetapi di part awal, kita akan tetap library-neutral dulu. Setelah mental model kuat, baru masuk JDK HttpClient, OkHttp, Retrofit, Apache, Spring layer, dan case study.

---

## 0.31. Vocabulary Penting

### Downstream

Service/API yang dipanggil oleh aplikasi kita.

### Upstream

Caller dari aplikasi kita.

### Deadline

Batas waktu total yang tersisa untuk menyelesaikan operasi.

### Timeout

Batas waktu untuk tahap tertentu atau attempt tertentu.

### Retry Budget

Batas total retry yang diperbolehkan agar retry tidak menghabiskan SLA/resource.

### Idempotency

Properti bahwa operasi yang sama dapat dijalankan lebih dari sekali tanpa mengubah hasil akhir secara tidak diinginkan.

### Connection Pool

Kumpulan koneksi yang disimpan untuk reuse agar tidak perlu TCP/TLS handshake baru setiap request.

### Backpressure

Mekanisme agar producer tidak mengirim pekerjaan lebih cepat dari kemampuan consumer/downstream.

### Bulkhead

Isolasi resource agar kegagalan satu dependency tidak menghabiskan resource semua dependency.

### Circuit Breaker

Mekanisme menghentikan sementara call ke dependency yang sedang buruk untuk mencegah kerusakan lebih luas.

### Anti-Corruption Layer

Layer yang menerjemahkan model eksternal ke model internal agar domain tidak tercemar konsep/vendor luar.

---

## 0.32. Latihan Berpikir

Ambil satu HTTP client yang pernah Anda buat. Jawab pertanyaan berikut:

```text
1. Apakah client object dibuat per request atau reusable?
2. Timeout apa saja yang dikonfigurasi?
3. Apakah retry ada? Jika ya, apakah operasi benar-benar idempotent?
4. Apakah response body selalu ditutup?
5. Apakah error 400, 401, 404, 409, 429, 500, 503 dibedakan?
6. Apakah domain service melihat HTTP status code langsung?
7. Apakah external DTO bocor ke domain?
8. Apakah token/header sensitive bisa muncul di log?
9. Apakah metric per downstream tersedia?
10. Jika downstream lambat 10x, apa yang terjadi pada aplikasi Anda?
11. Jika downstream down total, apa mitigasi otomatisnya?
12. Jika rate limit kena, apakah client menghormati Retry-After?
13. Jika DNS berubah, apakah client bisa recover?
14. Jika response body 100 MB, apakah memory aman?
15. Jika request timeout setelah server memproses command, apakah duplicate bisa terjadi?
```

Jika banyak jawaban belum jelas, itu normal. Itulah alasan series ini dibuat.

---

## 0.33. Ringkasan Part 0

Part ini membangun fondasi utama:

```text
HTTP client bukan utility kecil.
HTTP client adalah production subsystem.
```

Kita memetakan HTTP client sebagai gabungan dari:

- domain-facing contract,
- adapter,
- transport engine,
- policy layer,
- resource management,
- observability,
- testing,
- operation.

Kita juga menetapkan prinsip dasar:

1. Reuse client, jangan buat per request.
2. Timeout adalah budget, bukan satu angka random.
3. Retry harus berbasis semantik dan idempotency.
4. Response body adalah resource.
5. HTTP status bukan domain model.
6. Observability harus didesain dari awal.
7. Client harus punya failure contract.
8. External DTO tidak boleh mencemari domain.
9. Security boundary dimulai dari URL.
10. Config harus per downstream, bukan global buta.

Jika hanya mengingat satu hal dari part ini, ingat ini:

```text
Outbound HTTP call adalah dependency boundary yang membawa risiko latency,
resource, security, correctness, dan operability.
Desainnya harus diperlakukan setara seriusnya dengan database connection,
message broker, dan transaction boundary.
```

---

## 0.34. Apa yang Akan Dibahas di Part 1

Part berikutnya:

```text
01-java-http-client-landscape-java-8-to-25.md
```

Fokus Part 1:

- landscape HTTP client Java 8–25,
- perbandingan `HttpURLConnection`, JDK `HttpClient`, OkHttp, Retrofit, Apache HttpClient 5, Spring client,
- compatibility matrix,
- decision matrix yang lebih detail,
- migration pressure dari legacy client,
- bagaimana memilih library berdasarkan constraint nyata.

---

## References

[^jdk-http-module]: Oracle Java SE 25 API Documentation, module `java.net.http`, “Defines the HTTP Client and WebSocket APIs.” https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/module-summary.html

[^okhttp-overview]: OkHttp Official Documentation, overview page, describing HTTP/2 socket sharing, connection pooling, transparent GZIP, and response caching. https://square.github.io/okhttp/

[^retrofit-intro]: Retrofit Official Documentation, introduction page, describing interface annotations, URL parameter replacement, query support, object conversion, multipart, and file upload. https://square.github.io/retrofit/

[^apache-overview]: Apache HttpComponents Client 5.6.x Documentation, overview page, listing classic, fluent, and async APIs plus architecture and guides. https://hc.apache.org/httpcomponents-client-5.6.x/

[^apache-connection-management]: Apache HttpComponents Client 5.6.x Documentation, connection management guide, describing persistent connection reuse and connection managers for classic and async I/O. https://hc.apache.org/httpcomponents-client-5.6.x/connection-management.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./01-java-http-client-landscape-java-8-to-25.md">Part 1 — Java HTTP Client Landscape di Java 8–25 ➡️</a>
</div>
