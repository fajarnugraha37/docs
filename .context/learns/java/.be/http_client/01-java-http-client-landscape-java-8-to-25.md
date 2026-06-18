# Part 1 — Java HTTP Client Landscape di Java 8–25

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `01-java-http-client-landscape-java-8-to-25.md`  
> Target pembaca: engineer Java yang sudah memahami Java core, concurrency, networking dasar, persistence, reliability, security, dan ingin naik ke level desain HTTP client production-grade.

---

## 1. Tujuan Part Ini

Part ini bukan tutorial `GET https://example.com`.

Tujuan kita adalah membangun **peta landscape**: di Java 8 sampai Java 25, pilihan HTTP client sangat banyak, tetapi masing-masing lahir dari konteks berbeda, punya model resource berbeda, failure behavior berbeda, dan cocok untuk problem berbeda.

Setelah menyelesaikan part ini, kamu harus bisa menjawab pertanyaan berikut dengan tajam:

1. Untuk aplikasi Java 8 legacy, client apa yang masuk akal?
2. Untuk Java 17/21/25 modern service, kapan cukup pakai JDK `HttpClient`?
3. Kapan OkHttp lebih unggul?
4. Kapan Retrofit memberi nilai tambah dibanding OkHttp mentah?
5. Kapan Apache HttpClient 5 masih menjadi pilihan terbaik?
6. Kapan Spring `RestTemplate`, `RestClient`, atau `WebClient` tepat?
7. Apa konsekuensi memilih blocking, async, reactive, atau virtual-thread-friendly client?
8. Apa risiko tersembunyi jika membuat abstraction HTTP client terlalu tipis atau terlalu tebal?
9. Bagaimana membuat keputusan library berdasarkan operational constraints, bukan preference pribadi?

Part ini adalah fondasi untuk semua part setelahnya.

---

## 2. Prinsip Utama: Jangan Pilih HTTP Client dari Contoh Kode

Banyak engineer memilih HTTP client karena contoh kode terlihat sederhana.

Contoh buruk:

```java
String response = client.get("https://api.partner.com/data");
```

Kelihatannya mudah. Tetapi keputusan production tidak boleh berhenti di situ.

Yang harus ditanyakan:

- Apakah client reusable dan aman dipakai lintas thread?
- Bagaimana connection pool-nya bekerja?
- Apakah HTTP/2 didukung?
- Bagaimana timeout dikonfigurasi?
- Apakah ada per-request timeout?
- Apakah response body harus ditutup manual?
- Apakah retry otomatis terjadi?
- Apakah retry itu aman untuk POST?
- Bagaimana tracing disisipkan?
- Bagaimana log body tanpa membocorkan credential?
- Bagaimana token refresh saat 200 thread mendapat 401 bersamaan?
- Bagaimana client behave saat DNS berubah?
- Bagaimana saat downstream lambat tapi tidak mati?
- Bagaimana saat service mesh atau proxy ada di tengah?
- Bagaimana testing slow response, connection reset, malformed JSON?

Pilihan HTTP client adalah keputusan **architecture + runtime + operations**.

---

## 3. Evolusi HTTP Client di Java

Secara historis, Java tidak punya satu HTTP client modern yang dominan dari awal.

### 3.1 Era Java 1.x–8: Built-in Ada, Tapi Tidak Cukup Nyaman

Java lama menyediakan:

- `java.net.URL`
- `URLConnection`
- `HttpURLConnection`

Ini built-in, tidak butuh dependency, tetapi API-nya tua dan kurang ergonomis untuk kebutuhan modern.

Contoh:

```java
URL url = new URL("https://api.example.com/users/123");
HttpURLConnection conn = (HttpURLConnection) url.openConnection();
conn.setRequestMethod("GET");
conn.setConnectTimeout(2_000);
conn.setReadTimeout(3_000);

try (InputStream in = conn.getInputStream()) {
    String body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
}
```

Untuk Java 8, `readAllBytes()` belum ada di `InputStream`, jadi kode harus lebih verbose.

Masalah umum `HttpURLConnection`:

- API mutable dan imperative.
- Error stream terpisah dari input stream.
- Sulit membuat reusable abstraction yang bersih.
- Tidak nyaman untuk interceptor, observability, retry, dan testability.
- Tidak ideal untuk API modern yang butuh JSON mapping, auth refresh, tracing, dan resilience policy.

Tetapi bukan berarti selalu salah. Untuk script kecil, bootstrap tool, atau environment yang melarang dependency, ia masih bisa dipakai.

### 3.2 Era Java 8 Enterprise: Apache HttpClient dan OkHttp Menjadi Dominan

Karena built-in client kurang nyaman, banyak aplikasi Java 8 memakai:

- Apache HttpClient 4.x
- OkHttp
- Jersey/RESTEasy client
- Spring `RestTemplate`
- Retrofit di atas OkHttp

Apache populer di enterprise karena configurable dan matang. OkHttp populer karena sederhana, efisien, dan API-nya bersih.

### 3.3 Java 11+: JDK HttpClient Menjadi First-Class API

Mulai Java 11, JDK menyediakan `java.net.http.HttpClient` sebagai API standar modern. Di Java 25, dokumentasi resminya menyatakan `HttpClient` dibuat via builder, dapat dikonfigurasi untuk preferensi HTTP/1.1 atau HTTP/2, redirect, proxy, authenticator, dan setelah dibuat bersifat immutable serta dapat dipakai untuk banyak request.

Artinya, untuk Java modern, pertanyaan “butuh dependency eksternal atau tidak?” menjadi lebih serius.

### 3.4 Java 21–25: Virtual Threads Mengubah Trade-Off

Sebelum virtual threads, blocking client sering dianggap mahal karena setiap request memegang platform thread.

Dengan virtual threads, blocking I/O menjadi jauh lebih scalable untuk banyak workload server-side, selama:

- operasi benar-benar blocking I/O, bukan CPU-bound;
- tidak ada synchronized pinning berat;
- concurrency tetap dibatasi;
- downstream tetap dilindungi dengan timeout, bulkhead, dan rate limit.

Ini membuat desain “blocking code yang sederhana + virtual threads + strict timeout” kembali sangat menarik.

Tetapi virtual threads tidak otomatis membuat semua masalah hilang. Jika kamu membuat 50.000 concurrent request ke downstream tanpa limit, kamu tetap bisa menghancurkan downstream, NAT, connection pool, atau database partner.

---

## 4. Kategori Besar HTTP Client di Java

Secara arsitektural, pilihan HTTP client bisa dibagi menjadi beberapa kategori.

```text
Java HTTP Client Landscape
│
├── Built-in low-level legacy
│   └── HttpURLConnection
│
├── Built-in modern JDK
│   └── java.net.http.HttpClient
│
├── General-purpose third-party client
│   ├── OkHttp
│   └── Apache HttpClient 5
│
├── Type-safe declarative client
│   ├── Retrofit
│   ├── OpenFeign
│   └── MicroProfile REST Client
│
├── Framework-integrated client
│   ├── Spring RestTemplate
│   ├── Spring RestClient
│   └── Spring WebClient
│
├── Generated client
│   └── OpenAPI-generated client
│
└── Specialized/runtime client
    ├── JAX-RS Client
    ├── Reactor Netty HttpClient
    ├── Jetty Client
    └── Vert.x WebClient
```

Part ini akan menempatkan masing-masing di peta keputusan.

---

## 5. Decision Axis: Cara Berpikir Sebelum Memilih Library

Jangan mulai dari “OkHttp atau JDK?”

Mulai dari constraint.

### 5.1 Axis 1 — Java Version

| Java Version | Pilihan Umum | Catatan |
|---|---|---|
| Java 8 | Apache HttpClient, OkHttp, Retrofit, RestTemplate | JDK modern `HttpClient` belum tersedia. |
| Java 11 | JDK HttpClient mulai tersedia | Bisa mengurangi dependency eksternal. |
| Java 17 | JDK HttpClient makin masuk akal untuk service modern | LTS banyak dipakai enterprise. |
| Java 21 | Virtual threads mengubah strategi blocking client | Blocking style jadi lebih kompetitif. |
| Java 25 | API JDK tetap relevan, ecosystem makin matang | Cocok untuk standardization. |

### 5.2 Axis 2 — Blocking vs Async vs Reactive

| Model | Cocok Untuk | Risiko |
|---|---|---|
| Blocking platform thread | Simpler service, low/medium concurrency | Thread exhaustion jika concurrency tinggi. |
| Blocking virtual thread | Java 21+, high concurrency I/O | Tetap butuh limit, timeout, bulkhead. |
| Async `CompletableFuture` | Fan-out, non-blocking orchestration | Callback complexity, cancellation sulit. |
| Reactive | End-to-end reactive pipeline | Complexity tinggi, debugging lebih sulit. |

### 5.3 Axis 3 — API Shape

| API Shape | Client Cocok |
|---|---|
| Satu-dua call sederhana | JDK HttpClient / OkHttp langsung |
| Banyak endpoint partner | Retrofit / OpenFeign / generated client |
| Contract OpenAPI kuat | OpenAPI-generated client + wrapper |
| Butuh kontrol pooling/proxy/TLS kompleks | Apache HttpClient 5 / OkHttp |
| Spring ecosystem heavy | RestClient / WebClient |

### 5.4 Axis 4 — Operational Maturity

Pertanyaan penting:

- Apakah client expose metrics?
- Apakah mudah memasang interceptor?
- Apakah mudah mengatur pool?
- Apakah error bisa diklasifikasi?
- Apakah library behavior retry/redirect jelas?
- Apakah bisa di-test dengan mock server?
- Apakah bisa distandardisasi untuk semua team?

Top engineer memilih berdasarkan konsekuensi production, bukan berdasarkan “API yang paling cantik”.

---

## 6. `HttpURLConnection`: Legacy Built-In Client

### 6.1 Posisi di Landscape

`HttpURLConnection` adalah built-in client lama. Ia ada hampir di semua Java runtime lama, termasuk Java 8.

Kelebihan:

- Tidak perlu dependency.
- Tersedia di Java lama.
- Cukup untuk call sederhana.
- Useful untuk bootstrap code atau minimal runtime.

Kekurangan:

- API verbose.
- Sulit diobservasi.
- Sulit diberi interceptor.
- Kurang nyaman untuk retry, auth refresh, tracing.
- Error handling canggung.
- Tidak ideal untuk domain client modern.

### 6.2 Kapan Masih Masuk Akal?

Gunakan hanya jika:

- Kode sangat kecil.
- Tidak boleh menambah dependency.
- Tidak perlu advanced pooling/observability.
- Environment sangat terbatas.
- Request dilakukan jarang.

Contoh:

```java
public final class SimpleHealthCheckClient {
    public boolean isUp(URL url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(1_000);
        conn.setReadTimeout(1_000);

        int status = conn.getResponseCode();
        return status >= 200 && status < 300;
    }
}
```

Untuk production API client yang serius, biasanya ini bukan pilihan utama.

### 6.3 Red Flag

Jika kamu melihat kode seperti ini tersebar di banyak service:

```java
new URL(url).openConnection();
```

lalu setiap caller mengatur timeout sendiri-sendiri, parsing error sendiri-sendiri, dan log sendiri-sendiri, itu tanda technical debt.

---

## 7. JDK `java.net.http.HttpClient`

### 7.1 Posisi di Landscape

JDK `HttpClient` adalah client standar modern di Java 11+.

Dokumentasi Java 25 menjelaskan bahwa `HttpClient`:

- dibuat melalui builder;
- dapat mengirim request dan menerima response;
- dapat dikonfigurasi dengan preferred protocol HTTP/1.1 atau HTTP/2;
- mendukung redirect, proxy, authenticator;
- immutable setelah dibuat;
- dapat digunakan untuk banyak request.

Ini membuatnya menarik untuk organisasi yang ingin mengurangi dependency eksternal.

### 7.2 Contoh Dasar

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2))
        .version(HttpClient.Version.HTTP_2)
        .build();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.example.com/users/123"))
        .timeout(Duration.ofSeconds(3))
        .header("Accept", "application/json")
        .GET()
        .build();

HttpResponse<String> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);
```

### 7.3 Strength

- Built-in Java 11+.
- Tidak perlu dependency eksternal.
- API relatif bersih.
- Mendukung sync dan async.
- Mendukung HTTP/2.
- Cocok untuk standard library approach.
- Integrasi natural dengan `CompletableFuture`.
- Cocok untuk Java 21+ virtual-thread style.

### 7.4 Limitation

Dibanding OkHttp/Apache, beberapa area bisa terasa lebih terbatas:

- Interceptor model tidak sekuat OkHttp.
- Observability custom kadang perlu wrapper sendiri.
- Fine-grained connection pool control tidak sejelas Apache HttpClient.
- Ecosystem converter/type-safe interface tidak built-in.
- Untuk complex authentication/retry/circuit breaker, tetap perlu layer tambahan.

### 7.5 Kapan Cocok?

JDK `HttpClient` cocok untuk:

- Java 11+ service yang ingin minim dependency.
- Internal microservice client sederhana-menengah.
- Tooling dan CLI berbasis Java modern.
- System yang ingin standar JDK-first.
- Virtual-thread based service di Java 21+.
- Integrasi yang tidak butuh DSL declarative.

### 7.6 Kapan Kurang Cocok?

Kurang ideal jika:

- Kamu butuh interceptor chain kaya seperti OkHttp.
- Kamu butuh type-safe interface client seperti Retrofit.
- Kamu butuh pooling/proxy/route management yang sangat detail.
- Kamu memakai Java 8.
- Organisasi sudah punya standard client di atas OkHttp/Apache.

---

## 8. OkHttp

### 8.1 Posisi di Landscape

OkHttp adalah general-purpose HTTP client untuk Java/JVM dan Android.

Dokumentasi resminya menekankan beberapa fitur efisiensi:

- HTTP/2 memungkinkan request ke host yang sama berbagi socket.
- Connection pooling mengurangi latency saat HTTP/2 tidak tersedia.
- Transparent GZIP mengurangi ukuran download.
- Response caching dapat menghindari network untuk repeated request.

### 8.2 Contoh Dasar

```java
OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(2))
        .readTimeout(Duration.ofSeconds(3))
        .writeTimeout(Duration.ofSeconds(3))
        .callTimeout(Duration.ofSeconds(5))
        .build();

Request request = new Request.Builder()
        .url("https://api.example.com/users/123")
        .header("Accept", "application/json")
        .get()
        .build();

try (Response response = client.newCall(request).execute()) {
    if (!response.isSuccessful()) {
        throw new IOException("Unexpected status: " + response.code());
    }

    ResponseBody body = response.body();
    String json = body != null ? body.string() : "";
}
```

Catatan penting: response harus ditutup. `try-with-resources` bukan kosmetik; itu bagian dari connection reuse.

### 8.3 Strength

- API elegan.
- Mature dan banyak dipakai.
- Interceptor model sangat kuat.
- `EventListener` berguna untuk observability low-level.
- Connection pooling baik.
- HTTP/2 support baik.
- TLS/certificate pinning support kuat.
- Cocok untuk Retrofit.
- Testability bagus dengan MockWebServer.

### 8.4 Limitation

- Dependency eksternal.
- Default behavior harus dipahami, terutama retry/follow-up/redirect.
- Jika dipakai langsung di banyak tempat tanpa wrapper, domain boundary bisa bocor.
- Untuk enterprise route/proxy management yang sangat kompleks, Apache bisa lebih fleksibel.

### 8.5 Kapan Cocok?

OkHttp cocok untuk:

- Java 8+ service yang butuh modern HTTP client.
- Client dengan interceptor-heavy needs.
- Client yang butuh certificate pinning.
- Retrofit-based API client.
- High-throughput API integration.
- Android/JVM shared client logic.
- Testing dengan MockWebServer.

### 8.6 Kapan Kurang Cocok?

Kurang ideal jika:

- Organisasi melarang dependency eksternal.
- Kamu ingin full standard JDK-only.
- Kamu butuh Apache-style route/proxy customization yang sangat detail.
- Kamu butuh declarative interface tapi tidak ingin Retrofit/OpenFeign.

---

## 9. Retrofit

### 9.1 Posisi di Landscape

Retrofit bukan sekadar HTTP transport client. Retrofit adalah **type-safe API client layer**.

Dokumentasi resminya menyatakan bahwa Retrofit mengubah HTTP API menjadi Java/Kotlin interface.

Contoh konsep:

```java
public interface UserApi {
    @GET("users/{id}")
    Call<UserResponse> getUser(@Path("id") String id);
}
```

Di bawahnya, Retrofit biasanya memakai OkHttp.

### 9.2 Contoh Dasar

```java
public interface PartnerApi {
    @GET("v1/customers/{customerId}")
    Call<CustomerDto> getCustomer(
            @Path("customerId") String customerId,
            @Header("Authorization") String authorization
    );
}

Retrofit retrofit = new Retrofit.Builder()
        .baseUrl("https://api.partner.com/")
        .client(okHttpClient)
        .addConverterFactory(JacksonConverterFactory.create(objectMapper))
        .build();

PartnerApi api = retrofit.create(PartnerApi.class);
```

### 9.3 Strength

- API client menjadi interface.
- Endpoint contract lebih eksplisit.
- Mengurangi boilerplate request construction.
- Converter pluggable.
- Call adapter pluggable.
- Sangat cocok untuk API dengan banyak endpoint.
- Kombinasi bagus dengan OkHttp interceptor.

### 9.4 Limitation

- Abstraction bisa menyembunyikan detail HTTP jika engineer tidak paham underlying behavior.
- Error body parsing perlu didesain sendiri.
- Dynamic URL/base URL butuh hati-hati.
- Generated/annotation client bisa membuat domain layer tergoda memakai DTO transport langsung.
- Untuk call sangat sedikit, mungkin overkill.

### 9.5 Kapan Cocok?

Retrofit cocok untuk:

- Partner API dengan banyak endpoint.
- Internal SDK berbasis interface.
- Team yang ingin contract client readable.
- API JSON/XML dengan converter jelas.
- Java 8+ codebase yang ingin typed client.
- Android/JVM shared API client.

### 9.6 Kapan Kurang Cocok?

Kurang ideal jika:

- API sangat dinamis dan tidak cocok dimodelkan sebagai interface.
- Kamu butuh full manual control per request.
- Kamu tidak ingin annotation-based contract.
- Kamu sudah menggunakan OpenAPI-generated client sebagai standard.

---

## 10. Apache HttpClient 5

### 10.1 Posisi di Landscape

Apache HttpClient adalah client yang lama, matang, dan banyak dipakai di enterprise.

Apache HttpClient 5 menyediakan classic, fluent, dan async API. Dokumentasi API-nya membedakan classic HTTP client implementation yang mendukung HTTP/1.1 transport dan asynchronous HTTP client API yang mendukung HTTP/2.

### 10.2 Contoh Classic Client

```java
RequestConfig requestConfig = RequestConfig.custom()
        .setConnectTimeout(Timeout.ofSeconds(2))
        .setResponseTimeout(Timeout.ofSeconds(3))
        .build();

try (CloseableHttpClient client = HttpClients.custom()
        .setDefaultRequestConfig(requestConfig)
        .build()) {

    HttpGet get = new HttpGet("https://api.example.com/users/123");
    get.addHeader("Accept", "application/json");

    try (CloseableHttpResponse response = client.execute(get)) {
        int status = response.getCode();
        String body = EntityUtils.toString(response.getEntity(), StandardCharsets.UTF_8);
    }
}
```

### 10.3 Strength

- Enterprise-proven.
- Sangat configurable.
- Connection manager kuat.
- Route/proxy/auth support matang.
- Cocok untuk environment corporate yang kompleks.
- Classic dan async flavor tersedia.
- Banyak library/framework mendukungnya.

### 10.4 Limitation

- API bisa terasa lebih verbose.
- Salah konfigurasi pooling bisa menyebabkan behavior buruk.
- Developer harus memahami entity consumption/release.
- Untuk use case sederhana, bisa terasa terlalu berat.

### 10.5 Kapan Cocok?

Apache HttpClient 5 cocok untuk:

- Enterprise integration yang butuh proxy kompleks.
- Per-route connection control.
- Custom TLS/proxy/auth behavior.
- Legacy migration dari Apache 4.x.
- Framework yang sudah expose Apache connector.
- Tim yang sudah punya operational standard Apache.

### 10.6 Kapan Kurang Cocok?

Kurang ideal jika:

- Kamu hanya butuh simple modern client.
- Kamu ingin API minimalis.
- Kamu ingin Retrofit-style interface.
- Kamu ingin dependency surface lebih kecil dan pakai Java 11+.

---

## 11. Spring `RestTemplate`, `RestClient`, dan `WebClient`

### 11.1 Posisi di Landscape

Dalam aplikasi Spring, banyak engineer tidak memilih HTTP client langsung. Mereka memilih Spring abstraction.

Ada tiga nama penting:

1. `RestTemplate`
2. `RestClient`
3. `WebClient`

### 11.2 `RestTemplate`

`RestTemplate` adalah synchronous blocking client lama di Spring.

Kelebihan:

- Banyak dipakai di legacy Spring app.
- Simple untuk request-response.
- Banyak contoh dan existing code.

Kekurangan:

- Bukan direction modern utama untuk new code.
- Abstraction kadang menyembunyikan underlying HTTP client.
- Error handling default perlu disesuaikan.

Cocok untuk:

- Legacy Spring application.
- Maintenance code.
- Migrasi bertahap.

### 11.3 `RestClient`

`RestClient` adalah synchronous client modern di Spring Framework 6.x.

Kelebihan:

- Fluent API modern.
- Cocok untuk blocking service.
- Lebih modern daripada `RestTemplate`.
- Bisa memakai underlying request factory.

Cocok untuk:

- Spring Boot 3.x service.
- Java 17/21+ blocking architecture.
- Tim yang ingin Spring-native API tanpa reactive complexity.

### 11.4 `WebClient`

`WebClient` adalah reactive HTTP client dari Spring WebFlux ecosystem.

Kelebihan:

- Non-blocking/reactive.
- Cocok untuk reactive pipeline.
- Powerful untuk streaming.
- Integrasi baik dengan Reactor.

Kekurangan:

- Complexity lebih tinggi.
- Jika langsung `.block()` di mana-mana, benefit reactive hilang dan bisa menambah complexity tanpa nilai.
- Debugging reactive chain lebih sulit untuk banyak team.

Cocok untuk:

- End-to-end reactive service.
- High concurrency streaming.
- Service yang sudah berbasis Reactor.

Tidak otomatis cocok hanya karena “modern”.

---

## 12. OpenFeign dan MicroProfile REST Client

### 12.1 OpenFeign

OpenFeign adalah declarative HTTP client yang populer di Spring Cloud ecosystem.

Konsepnya mirip: interface + annotation.

Cocok untuk:

- Spring Cloud service-to-service call.
- Declarative internal client.
- Integrasi dengan load balancing/service discovery di ecosystem tertentu.

Risiko:

- Magic terlalu banyak jika engineer tidak paham underlying client.
- Retry/load balancing/default error behavior harus diperiksa.
- Bisa mendorong service-to-service coupling yang terlalu mudah.

### 12.2 MicroProfile REST Client

MicroProfile REST Client umum di Jakarta EE / MicroProfile runtime.

Cocok untuk:

- Quarkus, Open Liberty, Payara, Helidon, atau MicroProfile-based runtime.
- Enterprise Java yang ingin standard-ish declarative client.
- Integrasi CDI/config/fault tolerance.

Risiko:

- Runtime-specific behavior perlu dipahami.
- Portability antar vendor tidak selalu sempurna untuk fitur advanced.

---

## 13. OpenAPI Generated Client

### 13.1 Posisi di Landscape

Jika API contract tersedia dalam OpenAPI, kamu bisa generate client.

Kelebihan:

- Cepat untuk banyak endpoint.
- Sinkron dengan contract.
- Mengurangi manual DTO dan endpoint declaration.
- Cocok untuk API eksternal besar.

Kekurangan:

- Generated code sering verbose.
- Error model sering generik.
- Retry/timeout/auth/observability biasanya perlu disisipkan.
- DTO generated bisa bocor ke domain layer.
- Customization template bisa menjadi beban governance.

### 13.2 Pattern yang Lebih Aman

Jangan langsung gunakan generated client di service/domain layer.

Lebih baik:

```text
Domain Service
    ↓
Port Interface
    ↓
PartnerGateway / Anti-Corruption Layer
    ↓
Generated OpenAPI Client
    ↓
HTTP Transport
```

Dengan cara ini, generated code menjadi detail transport, bukan pusat domain.

---

## 14. Reactor Netty, Jetty Client, Vert.x WebClient

Ini adalah client yang sering muncul sebagai underlying engine atau runtime-specific choice.

### 14.1 Reactor Netty

Biasanya dipakai di Spring WebClient default stack.

Cocok untuk:

- Reactive service.
- Event-loop architecture.
- High concurrency non-blocking workload.

Risiko:

- Blocking call di event loop bisa menghancurkan performa.
- Butuh pemahaman event loop, backpressure, scheduler.

### 14.2 Jetty Client

Cocok untuk:

- Jetty ecosystem.
- Advanced HTTP/2 use cases.
- Async client dengan model Jetty.

### 14.3 Vert.x WebClient

Cocok untuk:

- Vert.x application.
- Event-driven architecture.
- Non-blocking service.

Prinsipnya: gunakan runtime-native client jika aplikasi memang dibangun di runtime tersebut.

---

## 15. Java 8 vs Java 11 vs Java 17 vs Java 21/25: Strategi Berbeda

### 15.1 Java 8

Di Java 8, pilihan realistis:

- OkHttp
- Apache HttpClient 4.x/5.x jika kompatibel dengan setup
- Retrofit
- RestTemplate
- OpenFeign
- JAX-RS Client

Rekomendasi umum:

- Untuk simple general-purpose: OkHttp.
- Untuk enterprise/proxy/route complex: Apache.
- Untuk typed partner API: Retrofit.
- Untuk Spring legacy: RestTemplate dengan underlying Apache/OkHttp.

### 15.2 Java 11

Java 11 memperkenalkan JDK `HttpClient` sebagai pilihan serius.

Rekomendasi umum:

- Untuk dependency-minimal service: JDK `HttpClient`.
- Untuk interceptor-heavy client: OkHttp.
- Untuk declarative client: Retrofit/OpenFeign/generated.
- Untuk enterprise control: Apache HttpClient 5.

### 15.3 Java 17

Java 17 sebagai LTS banyak dipakai enterprise.

Pilihan matang:

- JDK `HttpClient`
- OkHttp
- Apache HttpClient 5
- Spring RestClient/WebClient jika Spring 6+/Boot 3+
- Generated OpenAPI client

Strategi:

- Standardisasi client factory.
- Jangan biarkan tiap team membuat wrapper sendiri tanpa governance.
- Mulai pikirkan migration dari RestTemplate/Apache 4.x.

### 15.4 Java 21

Java 21 membawa virtual threads sebagai fitur production-grade.

Strategi berubah:

- Blocking client + virtual threads bisa sangat menarik.
- Tidak semua workload harus reactive.
- Simplicity bisa menang jika concurrency dikontrol.
- Timeout dan bulkhead tetap wajib.

Contoh mental model:

```text
Before virtual threads:
High concurrency HTTP fan-out → async/reactive sering dipertimbangkan

After virtual threads:
High concurrency HTTP fan-out → blocking code bisa tetap simple,
asal concurrency downstream dibatasi dan timeout benar
```

### 15.5 Java 25

Untuk Java 25, keputusan biasanya bukan soal “bisa atau tidak”, tetapi soal standardisasi:

- Apakah organisasi ingin JDK-first?
- Apakah existing platform sudah OkHttp/Retrofit?
- Apakah Spring abstraction lebih konsisten?
- Apakah generated client diperlukan?
- Apakah observability/resilience layer sudah seragam?

---

## 16. Comparative Matrix

### 16.1 Matrix Umum

| Client | Java 8 | Java 11+ | HTTP/2 | Sync | Async | Declarative | Interceptor | Best Fit |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `HttpURLConnection` | Ya | Ya | Terbatas/tidak ideal | Ya | Tidak nyaman | Tidak | Lemah | Minimal legacy call |
| JDK `HttpClient` | Tidak | Ya | Ya | Ya | Ya | Tidak | Perlu wrapper | Standard JDK modern |
| OkHttp | Ya | Ya | Ya | Ya | Ya | Tidak | Kuat | General-purpose modern client |
| Retrofit | Ya | Ya | Via OkHttp | Ya | Ya | Ya | Via OkHttp | Typed API client |
| Apache HttpClient 5 | Tergantung versi/runtime | Ya | Ya di async stack | Ya | Ya | Tidak | Ada | Enterprise configurable client |
| RestTemplate | Ya | Ya | Via underlying | Ya | Tidak | Tidak | Spring interceptor | Spring legacy blocking |
| RestClient | Tidak untuk old Spring | Ya | Via underlying | Ya | Tidak | Tidak | Spring interceptor | Spring modern blocking |
| WebClient | Ya/tergantung Spring | Ya | Via Reactor Netty/connector | Bisa block tapi bukan tujuan | Ya | Tidak | Filter | Reactive Spring |
| OpenFeign | Ya | Ya | Via underlying | Ya | Bisa tergantung setup | Ya | Ada | Spring Cloud declarative |
| OpenAPI generated | Ya | Ya | Via chosen lib | Tergantung generator | Tergantung generator | Generated | Tergantung | Contract-first SDK |

### 16.2 Matrix Berdasarkan Use Case

| Use Case | Rekomendasi Awal |
|---|---|
| Java 8 legacy service, API sedikit | OkHttp atau Apache |
| Java 8, API banyak dan typed | Retrofit + OkHttp |
| Java 11+ minimal dependency | JDK `HttpClient` |
| Java 21+ blocking simple service | JDK `HttpClient` / OkHttp + virtual threads |
| Spring Boot 3 blocking service | Spring `RestClient` |
| Spring reactive pipeline | `WebClient` |
| Corporate proxy/mTLS complex | Apache HttpClient 5 / OkHttp |
| Partner API dengan OpenAPI spec | Generated client + wrapper |
| Internal platform SDK | Retrofit/OpenFeign/generated + standardized transport |
| High-throughput with strict observability | OkHttp or Apache with custom instrumentation |

---

## 17. Hidden Cost dari Setiap Pilihan

### 17.1 JDK HttpClient Hidden Cost

- Kamu harus membangun sendiri higher-level abstraction.
- Interceptor/tracing/retry pattern tidak se-native OkHttp.
- Error mapping harus disiplin.
- Per-client config governance harus dibuat.

### 17.2 OkHttp Hidden Cost

- Behavior default harus dipahami.
- Interceptor bisa menjadi tempat logic liar jika tidak dikontrol.
- Response body lifecycle harus disiplin.
- Banyak team bisa membuat OkHttpClient berbeda-beda tanpa standard.

### 17.3 Retrofit Hidden Cost

- Interface bisa terlihat seperti domain contract padahal transport contract.
- Error body parsing sering dilupakan.
- DTO transport mudah bocor ke domain.
- Dynamic auth/tenant/base URL bisa kompleks.

### 17.4 Apache Hidden Cost

- Configuration complexity.
- Verbosity.
- Migration antar major version.
- Pool tuning membutuhkan pemahaman lebih.

### 17.5 WebClient Hidden Cost

- Reactive complexity.
- `.block()` sembarangan.
- Debugging stack trace lebih rumit.
- Event loop blocking bug.
- Backpressure tidak otomatis benar jika design salah.

---

## 18. Anti-Pattern Landscape

### 18.1 Membuat Client Baru per Request

```java
public String call(String url) {
    OkHttpClient client = new OkHttpClient(); // buruk
    // ...
}
```

Masalah:

- Pool tidak reusable.
- TLS handshake berulang.
- Latency naik.
- Resource leak risk.
- Observability config tidak konsisten.

Yang benar:

```java
public final class PartnerHttpClient {
    private final OkHttpClient client;

    public PartnerHttpClient(OkHttpClient client) {
        this.client = client;
    }
}
```

Client dibuat sekali per configuration profile, bukan per request.

### 18.2 Satu Global Client untuk Semua Downstream Tanpa Policy

Ini juga buruk.

```text
same client
├── payment API
├── notification API
├── map API
├── identity API
└── reporting API
```

Masalah:

- Timeout semua sama.
- Pool bercampur.
- Metrics bercampur.
- Auth logic bercampur.
- Retry policy bercampur.

Lebih baik:

```text
HttpClientFactory
├── paymentClient      timeout=2s retry=strict pool=small
├── notificationClient timeout=5s retry=limited pool=medium
├── mapClient          timeout=3s rateLimit=250/min
├── identityClient     timeout=2s mTLS=true
└── reportingClient    timeout=30s streaming=true
```

### 18.3 Memilih Reactive Karena “Modern”

Reactive bagus jika seluruh pipeline memang reactive.

Buruk jika:

```java
webClient.get()
    .uri(url)
    .retrieve()
    .bodyToMono(String.class)
    .block();
```

lalu digunakan di semua tempat tanpa memahami scheduler, timeout, dan connection provider.

Reactive bukan dekorasi modern. Reactive adalah model eksekusi.

### 18.4 Generated Client Langsung Dipakai di Domain

Buruk:

```java
public void approveCase(OpenApiGeneratedCaseResponse response) {
    // domain logic tergantung generated DTO
}
```

Lebih baik:

```java
ExternalCaseDto generated = generatedClient.getCase(id);
CaseSnapshot snapshot = mapper.toDomainSnapshot(generated);
domainService.evaluate(snapshot);
```

### 18.5 Semua Failure Dijadikan `Exception`

Buruk:

```java
throw new RuntimeException("API call failed");
```

Lebih baik:

```text
ExternalCallFailure
├── TransportFailure
│   ├── DnsFailure
│   ├── ConnectTimeout
│   ├── ReadTimeout
│   └── TlsFailure
├── ProtocolFailure
│   ├── Http4xx
│   ├── Http5xx
│   └── MalformedResponse
└── DomainFailure
    ├── RejectedByPartner
    ├── DuplicateRequest
    └── InvalidBusinessState
```

---

## 19. Blocking, Async, Reactive, Virtual Threads: Decision Model

### 19.1 Blocking Client

Blocking client berarti thread menunggu sampai response diterima.

Kelebihan:

- Mudah dibaca.
- Mudah di-debug.
- Mudah dipahami team.
- Cocok untuk transaction-like flow.

Kekurangan:

- Platform thread mahal jika concurrency tinggi.
- Tanpa virtual threads, thread pool bisa habis.

### 19.2 Async Client

Async client mengembalikan future/callback.

Kelebihan:

- Tidak menahan caller thread.
- Cocok untuk fan-out/fan-in.
- Bisa compose beberapa call.

Kekurangan:

- Cancellation lebih sulit.
- Timeout propagation sering salah.
- Error handling tersebar.
- Debugging lebih rumit.

### 19.3 Reactive Client

Reactive client cocok untuk stream dan pipeline non-blocking.

Kelebihan:

- Efficient untuk high concurrency non-blocking.
- Backpressure model tersedia.
- Cocok untuk streaming.

Kekurangan:

- Complexity tinggi.
- Butuh disiplin agar tidak blocking event loop.
- Mental model berbeda.

### 19.4 Virtual Threads

Virtual threads memberi jalan tengah:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Customer> customer = executor.submit(() -> customerClient.get(id));
    Future<Account> account = executor.submit(() -> accountClient.get(id));

    return aggregate(customer.get(), account.get());
}
```

Kelebihan:

- Kode tetap blocking dan sederhana.
- Scalable untuk I/O wait.
- Cocok untuk Java 21+.

Risiko:

- Bisa menciptakan concurrency berlebihan.
- Downstream tetap bisa overload.
- Timeout tetap wajib.
- Bulkhead tetap wajib.

### 19.5 Rule of Thumb

```text
Jika team belum mature reactive:
    jangan pilih reactive hanya karena concurrency.

Jika Java 21+:
    pertimbangkan blocking + virtual threads + strict limit.

Jika pipeline sudah Reactor end-to-end:
    WebClient masuk akal.

Jika harus parallel fan-out di Java 8:
    CompletableFuture atau async OkHttp bisa dipakai,
    tapi desain cancellation dan timeout dengan hati-hati.
```

---

## 20. Library Selection by Architecture Style

### 20.1 Internal Microservice Call

Pilihan:

- JDK `HttpClient`
- OkHttp
- Spring `RestClient`
- OpenFeign
- WebClient jika reactive

Fokus:

- timeout pendek;
- tracing wajib;
- metrics per downstream;
- circuit breaker;
- mTLS/service mesh jika ada;
- version compatibility.

Rekomendasi:

- Java 21 + Spring Boot 3 blocking: `RestClient` atau JDK/OkHttp wrapped client.
- Non-Spring Java service: JDK `HttpClient` atau OkHttp.
- Spring Cloud ecosystem: OpenFeign bisa masuk akal.

### 20.2 Third-Party Partner API

Pilihan:

- Retrofit + OkHttp
- OpenAPI generated + wrapper
- Apache HttpClient 5
- JDK `HttpClient` custom wrapper

Fokus:

- auth/token refresh;
- rate limit;
- idempotency;
- retry budget;
- error body parsing;
- audit log;
- partner SLA;
- API versioning.

Rekomendasi:

- Banyak endpoint dan stable contract: Retrofit atau generated.
- Contract OpenAPI resmi: generated + anti-corruption wrapper.
- Proxy/mTLS kompleks: Apache/OkHttp.

### 20.3 Batch Integration

Pilihan:

- Apache HttpClient 5
- OkHttp
- JDK `HttpClient`

Fokus:

- throughput;
- concurrency control;
- backoff;
- checkpointing;
- partial failure;
- resumability;
- streaming body.

Rekomendasi:

- Jangan hanya parallel stream lalu call API.
- Gunakan worker pool, rate limiter, retry budget, dan checkpoint.

### 20.4 Latency-Sensitive Gateway

Pilihan:

- OkHttp
- Apache async
- Reactor Netty
- JDK HttpClient dengan tuning

Fokus:

- P99 latency;
- pool warm-up;
- connection reuse;
- timeout budget;
- hedging jika benar-benar perlu;
- minimal allocation;
- observability granular.

Rekomendasi:

- Pilih client dengan instrumentation kuat.
- Jangan aktifkan retry agresif di gateway latency-sensitive.

### 20.5 Regulated/Auditable System

Pilihan:

- Bukan cuma library; desain wrapper wajib.

Fokus:

- request ID;
- audit event;
- redaction;
- deterministic error mapping;
- retention policy;
- replay/idempotency;
- evidence of external call.

Rekomendasi:

- Pakai `ExternalApiGateway` layer.
- Jangan log raw body tanpa klasifikasi.
- Simpan metadata call, bukan semua payload sensitif.

---

## 21. Practical Decision Framework

Gunakan pertanyaan berurutan ini.

### Step 1 — Java Version

```text
Apakah masih Java 8?
    Ya  → JDK HttpClient tidak tersedia. Pertimbangkan OkHttp/Apache/Retrofit.
    Tidak → Java 11+ bisa mempertimbangkan JDK HttpClient.
```

### Step 2 — Framework Runtime

```text
Apakah aplikasi Spring Boot 3+?
    Ya → RestClient/WebClient bisa menjadi layer idiomatik.

Apakah aplikasi Jakarta/MicroProfile?
    Ya → MicroProfile REST Client bisa masuk.

Apakah runtime custom/non-framework?
    Ya → JDK HttpClient/OkHttp/Apache langsung lebih natural.
```

### Step 3 — API Complexity

```text
Endpoint sedikit dan sederhana?
    JDK HttpClient / OkHttp langsung cukup.

Endpoint banyak dan contract stabil?
    Retrofit / OpenFeign / OpenAPI generated.

OpenAPI spec resmi tersedia?
    Generated client + wrapper.
```

### Step 4 — Operational Complexity

```text
Butuh proxy/mTLS/route control advanced?
    Apache HttpClient 5 atau OkHttp.

Butuh interceptor dan event lifecycle kuat?
    OkHttp.

Butuh JDK-only minimal dependency?
    JDK HttpClient.
```

### Step 5 — Concurrency Model

```text
Java 21+ dan team lebih nyaman imperative?
    Blocking client + virtual threads + limit.

End-to-end reactive?
    WebClient/Reactor Netty.

Java 8 fan-out async?
    CompletableFuture/OkHttp async, dengan timeout/cancellation disiplin.
```

### Step 6 — Governance

```text
Apakah banyak team akan memakai client ini?
    Buat standard client module/factory.

Apakah hanya satu service kecil?
    Wrapper tipis cukup.

Apakah regulated/external partner critical?
    Buat gateway layer lengkap + runbook.
```

---

## 22. Reference Architecture: Standardized HTTP Client Layer

Untuk organisasi/team serius, jangan biarkan setiap developer membuat HTTP client sendiri-sendiri.

Buat struktur seperti ini:

```text
application-service
│
├── domain
│   └── business logic tanpa HTTP detail
│
├── port
│   └── PartnerProfilePort
│
├── adapter-http
│   ├── PartnerProfileGateway
│   ├── PartnerApiClient
│   ├── PartnerRequestMapper
│   ├── PartnerResponseMapper
│   ├── PartnerErrorMapper
│   └── PartnerClientConfig
│
└── platform-http
    ├── HttpClientFactory
    ├── TimeoutPolicy
    ├── RetryPolicy
    ├── RateLimitPolicy
    ├── TraceInterceptor
    ├── RedactionPolicy
    └── MetricsBinder
```

### 22.1 Kenapa Dibagi Seperti Ini?

Karena concern berbeda:

| Layer | Tanggung Jawab |
|---|---|
| Domain | Business decision |
| Port | Kebutuhan domain terhadap external capability |
| Gateway | Translasi domain ke external API |
| API Client | Detail HTTP endpoint |
| Platform HTTP | Reusable policy: timeout, retry, metrics, TLS |

Ini membuat library bisa diganti tanpa mengguncang domain.

---

## 23. Example: Same Use Case, Different Client Style

Use case:

> Ambil customer profile dari partner API.

### 23.1 Dengan JDK HttpClient

```java
public final class PartnerProfileJdkClient {
    private final HttpClient client;
    private final URI baseUri;
    private final ObjectMapper objectMapper;

    public PartnerProfileJdkClient(HttpClient client, URI baseUri, ObjectMapper objectMapper) {
        this.client = client;
        this.baseUri = baseUri;
        this.objectMapper = objectMapper;
    }

    public PartnerProfileDto getProfile(String customerId, String token) throws IOException, InterruptedException {
        URI uri = baseUri.resolve("/v1/customers/" + URLEncoder.encode(customerId, StandardCharsets.UTF_8));

        HttpRequest request = HttpRequest.newBuilder()
                .uri(uri)
                .timeout(Duration.ofSeconds(3))
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + token)
                .GET()
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() >= 200 && response.statusCode() < 300) {
            return objectMapper.readValue(response.body(), PartnerProfileDto.class);
        }

        throw PartnerHttpException.from(response.statusCode(), response.body());
    }
}
```

Strength:

- Dependency minimal.
- Explicit.

Weakness:

- Banyak boilerplate.
- Error mapping harus dibuat.
- URI encoding harus sangat hati-hati.

### 23.2 Dengan OkHttp

```java
public final class PartnerProfileOkHttpClient {
    private final OkHttpClient client;
    private final HttpUrl baseUrl;
    private final ObjectMapper objectMapper;

    public PartnerProfileOkHttpClient(OkHttpClient client, HttpUrl baseUrl, ObjectMapper objectMapper) {
        this.client = client;
        this.baseUrl = baseUrl;
        this.objectMapper = objectMapper;
    }

    public PartnerProfileDto getProfile(String customerId, String token) throws IOException {
        HttpUrl url = baseUrl.newBuilder()
                .addPathSegment("v1")
                .addPathSegment("customers")
                .addPathSegment(customerId)
                .build();

        Request request = new Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + token)
                .get()
                .build();

        try (Response response = client.newCall(request).execute()) {
            ResponseBody body = response.body();
            String rawBody = body != null ? body.string() : "";

            if (response.isSuccessful()) {
                return objectMapper.readValue(rawBody, PartnerProfileDto.class);
            }

            throw PartnerHttpException.from(response.code(), rawBody);
        }
    }
}
```

Strength:

- `HttpUrl` aman untuk path segment.
- Interceptor bisa handle auth/tracing.
- Response lifecycle jelas.

Weakness:

- Tetap manual untuk endpoint banyak.

### 23.3 Dengan Retrofit

```java
public interface PartnerProfileApi {
    @GET("v1/customers/{customerId}")
    Call<PartnerProfileDto> getProfile(
            @Path("customerId") String customerId,
            @Header("Authorization") String authorization
    );
}
```

Wrapper:

```java
public final class PartnerProfileRetrofitGateway {
    private final PartnerProfileApi api;

    public PartnerProfileRetrofitGateway(PartnerProfileApi api) {
        this.api = api;
    }

    public PartnerProfileDto getProfile(String customerId, String token) throws IOException {
        Response<PartnerProfileDto> response = api.getProfile(customerId, "Bearer " + token).execute();

        if (response.isSuccessful() && response.body() != null) {
            return response.body();
        }

        String errorBody = response.errorBody() != null ? response.errorBody().string() : "";
        throw PartnerHttpException.from(response.code(), errorBody);
    }
}
```

Strength:

- Endpoint contract ringkas.
- Cocok untuk API besar.

Weakness:

- Error semantics tetap harus dirapikan di wrapper.

---

## 24. Top 1% Heuristics untuk Memilih HTTP Client

### 24.1 Mereka Tidak Bertanya “Library Mana yang Terbaik?”

Mereka bertanya:

- Apa failure mode downstream?
- Berapa latency budget?
- Apakah call idempotent?
- Berapa concurrency limit?
- Apakah perlu HTTP/2?
- Apakah perlu mTLS?
- Apakah harus melewati proxy?
- Bagaimana tracing/logging/redaction?
- Bagaimana testing failure?
- Bagaimana rollback jika client behavior bermasalah?

### 24.2 Mereka Memisahkan Transport, Protocol, dan Domain

```text
Transport failure:
    DNS, TCP, TLS, timeout, reset

Protocol failure:
    HTTP status, malformed response, invalid content-type

Domain failure:
    partner rejects business request, duplicate, invalid state
```

Library HTTP hanya menyelesaikan sebagian kecil. Engineering maturity ada di mapping dan policy.

### 24.3 Mereka Membuat Default Aman

Default production client harus punya:

- connect timeout;
- read/response timeout;
- call/deadline timeout jika tersedia;
- connection pooling yang sadar downstream;
- tracing header;
- user-agent/service identity;
- redacted logging;
- metrics;
- retry hanya jika aman;
- rate limit jika partner punya limit;
- typed error mapping.

### 24.4 Mereka Tidak Over-Abstract

Wrapper buruk:

```java
interface HttpService {
    String get(String url);
    String post(String url, String body);
}
```

Ini terlalu generik dan kehilangan semantics.

Wrapper lebih baik:

```java
interface CustomerProfilePort {
    CustomerProfileSnapshot getProfile(CustomerId id);
}
```

Ini domain-aware.

### 24.5 Mereka Tidak Under-Abstract

Buruk:

```java
orderService.approve() {
    okhttp.newCall(...).execute();
}
```

HTTP detail bocor ke business logic.

Lebih baik:

```java
orderService.approve() {
    PartnerDecision decision = partnerRiskPort.evaluate(order);
}
```

---

## 25. Recommended Baseline per Era

### 25.1 Java 8 Baseline

Untuk Java 8 service baru/legacy:

```text
Default general-purpose:
    OkHttp

Typed partner client:
    Retrofit + OkHttp

Enterprise proxy/mTLS heavy:
    Apache HttpClient

Spring legacy:
    RestTemplate backed by Apache/OkHttp
```

### 25.2 Java 11/17 Baseline

```text
Default simple/medium client:
    JDK HttpClient

Interceptor-heavy or Retrofit needs:
    OkHttp

Enterprise configurable:
    Apache HttpClient 5

Spring modern:
    RestClient or WebClient depending execution model
```

### 25.3 Java 21/25 Baseline

```text
Default imperative service:
    JDK HttpClient or OkHttp with virtual threads

Spring Boot 3 imperative:
    RestClient with configured underlying client

Reactive service:
    WebClient/Reactor Netty

Typed partner SDK:
    Retrofit/OpenAPI generated + wrapper

Complex enterprise networking:
    Apache HttpClient 5 or OkHttp with explicit TLS/proxy config
```

---

## 26. Practical Recommendation untuk Series Ini

Dalam series ini, kita akan memperlakukan beberapa client sebagai “main actors”:

1. **JDK `HttpClient`**  
   Karena ini standard modern Java 11–25.

2. **OkHttp**  
   Karena sangat kuat sebagai production HTTP transport library.

3. **Retrofit**  
   Karena memberi typed API client model di atas OkHttp.

4. **Apache HttpClient 5**  
   Karena masih sangat relevan untuk enterprise-grade control.

5. **Spring RestClient/WebClient**  
   Karena banyak sistem Java modern berbasis Spring.

Kita tidak akan membahas semua library secara sama dalam setiap part. Kita akan memilih berdasarkan relevansi topik.

Contoh:

- Timeout: JDK, OkHttp, Apache, Spring.
- Interceptor: OkHttp, Spring, Apache.
- Declarative client: Retrofit, OpenFeign, generated.
- Reactive: WebClient/Reactor Netty.
- TLS/mTLS: JDK SSLContext, OkHttp, Apache.
- Testing: MockWebServer, WireMock, MockServer.

---

## 27. Checklist Memilih Client untuk Satu Downstream

Sebelum implementasi, isi checklist ini.

```text
Downstream name:
Owner:
Environment:
Base URL:
Java version:
Framework:

API style:
[ ] Few endpoints
[ ] Many endpoints
[ ] OpenAPI available
[ ] Streaming
[ ] Multipart
[ ] Long polling

Auth:
[ ] None
[ ] Basic
[ ] API Key
[ ] Bearer token
[ ] OAuth2 client credentials
[ ] mTLS
[ ] HMAC signing

Networking:
[ ] Direct
[ ] Proxy
[ ] Service mesh
[ ] Corporate gateway
[ ] Private network
[ ] Internet

Timeout:
Connect timeout:
Read/response timeout:
Write timeout:
Whole-call timeout/deadline:

Reliability:
[ ] Retry allowed
[ ] Idempotency key available
[ ] Rate limit known
[ ] Circuit breaker needed
[ ] Bulkhead needed
[ ] Fallback possible

Observability:
[ ] Metrics per endpoint
[ ] Trace propagation
[ ] Correlation ID
[ ] Redacted request log
[ ] Redacted response log
[ ] Error classification

Security:
[ ] URL allowlist
[ ] TLS validation
[ ] Secret redaction
[ ] Redirect policy
[ ] SSRF defense

Testing:
[ ] Mock server test
[ ] Timeout test
[ ] 4xx test
[ ] 5xx test
[ ] Malformed response test
[ ] Slow response test
[ ] Token refresh test
```

Jika checklist ini terasa “terlalu banyak”, artinya kamu sedang menyadari bahwa HTTP client production memang bukan utility kecil.

---

## 28. Common Decision Examples

### Example 1 — Java 8 Legacy, Partner API Banyak Endpoint

Decision:

```text
Retrofit + OkHttp
```

Why:

- Java 8 tidak punya JDK `HttpClient` modern.
- Banyak endpoint lebih rapi sebagai interface.
- OkHttp memberi transport kuat.
- Interceptor bisa handle auth/tracing.

Caveat:

- Error body harus diparse sendiri.
- Jangan expose Retrofit DTO ke domain.

### Example 2 — Java 21 Internal Service, Endpoint Sedikit

Decision:

```text
JDK HttpClient + virtual threads + wrapper domain gateway
```

Why:

- Dependency minimal.
- Blocking code sederhana.
- Virtual threads membantu scalability I/O.
- Endpoint sedikit tidak butuh Retrofit.

Caveat:

- Buat observability wrapper.
- Tetap batasi concurrency.

### Example 3 — Spring Boot 3 Service, Synchronous Business Flow

Decision:

```text
Spring RestClient + configured underlying client
```

Why:

- Spring-native.
- Fluent blocking API.
- Mudah integrasi config/observability Spring.

Caveat:

- Pastikan underlying client dikonfigurasi benar.
- Jangan default timeout kosong.

### Example 4 — Reactive Gateway

Decision:

```text
WebClient / Reactor Netty
```

Why:

- End-to-end reactive.
- High concurrency non-blocking.
- Streaming support.

Caveat:

- Jangan block event loop.
- Pastikan connection provider dan timeout benar.

### Example 5 — Corporate Proxy + mTLS + Route Policy

Decision:

```text
Apache HttpClient 5 or OkHttp with explicit TLS/proxy configuration
```

Why:

- Butuh kontrol network/TLS/proxy detail.
- Apache sering kuat di enterprise route/proxy management.

Caveat:

- Config harus distandardisasi.
- Test di environment mirip production.

---

## 29. Kesalahan Mental Model yang Harus Dihindari

### 29.1 “JDK HttpClient Membuat OkHttp Tidak Perlu”

Salah.

JDK `HttpClient` bagus, tetapi OkHttp tetap punya value:

- interceptor chain;
- EventListener;
- Retrofit ecosystem;
- ergonomics;
- certificate pinning;
- MockWebServer ecosystem.

### 29.2 “Reactive Selalu Lebih Scalable”

Salah.

Reactive bisa scalable jika pipeline benar. Tetapi virtual threads membuat blocking style juga scalable untuk banyak I/O workload. Reactive yang salah bisa lebih buruk daripada blocking yang benar.

### 29.3 “Generated Client Berarti Selesai”

Salah.

Generated client hanya menyelesaikan DTO dan endpoint binding. Production concern tetap ada:

- timeout;
- retry;
- auth;
- metrics;
- redaction;
- error mapping;
- versioning;
- domain isolation.

### 29.4 “Satu HTTP Client Factory Cukup”

Setengah benar.

Factory boleh satu, tetapi policy harus per downstream.

```text
same factory, different configured clients
```

Bukan:

```text
same client, all downstream
```

### 29.5 “Timeout Bisa Diatur Belakangan”

Salah besar.

Timeout adalah bagian dari contract. Tanpa timeout, satu downstream lambat bisa mengunci thread, request queue, connection pool, dan akhirnya seluruh service.

---

## 30. Minimal Production Client Standard

Apapun library yang dipilih, minimal harus ada standard ini:

```text
Client lifecycle:
[ ] reusable singleton per downstream/policy
[ ] graceful shutdown jika perlu

Timeout:
[ ] connect timeout
[ ] read/response timeout
[ ] whole-call timeout/deadline

Resource:
[ ] connection pool configured
[ ] response body always closed/consumed
[ ] max concurrency controlled

Reliability:
[ ] retry explicit, not accidental
[ ] retry only idempotent or idempotency-key protected
[ ] backoff + jitter
[ ] circuit breaker if critical
[ ] rate limit if downstream requires

Security:
[ ] TLS validation
[ ] no unsafe trust-all
[ ] secret redaction
[ ] redirect policy controlled
[ ] URL allowlist for dynamic URL

Observability:
[ ] request duration metric
[ ] status code metric
[ ] exception classification
[ ] retry count metric
[ ] timeout metric
[ ] trace/correlation propagation

Testing:
[ ] success
[ ] 4xx
[ ] 5xx
[ ] timeout
[ ] malformed response
[ ] slow response
[ ] auth refresh
```

Jika library tidak membantu melakukan ini, buat wrapper/platform layer.

---

## 31. Ringkasan Inti

Landscape Java HTTP client dari Java 8 sampai Java 25 bisa dipahami seperti ini:

```text
Java 8:
    third-party client adalah kebutuhan praktis.

Java 11+:
    JDK HttpClient menjadi pilihan standar yang layak.

Java 21+:
    virtual threads membuat blocking client kembali sangat kompetitif.

OkHttp:
    kuat sebagai transport modern dengan interceptor, pooling, HTTP/2, TLS, Retrofit ecosystem.

Retrofit:
    kuat untuk typed declarative API client, bukan transport layer murni.

Apache HttpClient 5:
    kuat untuk enterprise configurability, proxy, route, TLS, classic/async model.

Spring clients:
    pilih sesuai execution model: RestClient untuk blocking modern, WebClient untuk reactive.

Generated clients:
    bagus untuk contract-first, tapi harus dibungkus agar domain tidak tergantung generated DTO.
```

Keputusan terbaik bukan “library paling populer”, tetapi library yang paling cocok dengan:

- versi Java;
- runtime framework;
- API shape;
- operational constraints;
- concurrency model;
- security requirement;
- observability standard;
- testing strategy;
- team maturity.

---

## 32. Latihan Desain

Ambil satu external API nyata di sistemmu, lalu jawab:

1. Java version apa yang dipakai?
2. Apakah API endpoint sedikit atau banyak?
3. Apakah ada OpenAPI spec?
4. Apakah auth memakai token, API key, mTLS, atau HMAC?
5. Apakah API boleh di-retry?
6. Apakah semua operation idempotent?
7. Berapa timeout budget end-to-end?
8. Berapa rate limit downstream?
9. Apa error 4xx yang business-significant?
10. Apa error 5xx yang retryable?
11. Apakah response body boleh dilog?
12. Apakah perlu audit trail external call?
13. Library apa yang paling cocok?
14. Apa wrapper architecture-nya?
15. Apa test failure yang wajib ada sebelum production?

Jawaban dari latihan ini akan membuat pilihan client menjadi grounded, bukan preference subjektif.

---

## 33. Penutup Part 1

Part ini memetakan landscape HTTP client Java 8–25.

Kita belum masuk detail lifecycle request, connection pooling, timeout, retry, TLS, observability, dan testing. Itu akan dibahas di part berikutnya secara jauh lebih dalam.

Hal paling penting dari part ini:

> HTTP client bukan dipilih karena contoh kodenya pendek. HTTP client dipilih karena behavior-nya cocok dengan failure mode, runtime, dan operational contract sistem.

---

## Status Series

Selesai:

- Part 0 — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility
- Part 1 — Java HTTP Client Landscape di Java 8–25

Belum selesai. Lanjut berikutnya:

- Part 2 — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body

File berikutnya:

```text
02-http-request-lifecycle-from-call-to-response.md
```


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 0 — Orientation: HTTP Client sebagai Production Subsystem, Bukan Utility](./00-orientation-http-client-as-production-subsystem.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 2 — Request Lifecycle Deep Dive: Dari Method Call Sampai Response Body](./02-http-request-lifecycle-from-call-to-response.md)
