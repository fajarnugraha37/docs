# Part 13 — Jersey Client Deep Dive: Invocation Pipeline, Connectors, Providers, and Configuration

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `13-jersey-client-deep-dive-invocation-pipeline-connectors-providers-configuration.md`  
Status seri: **belum selesai**  
Target pembaca: Java engineer yang sudah memahami Java, HTTP, Jakarta REST/JAX-RS, JSON, observability, deployment, dan production troubleshooting.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah melihat Jersey dari sisi **server runtime**: resource model, request matching, provider pipeline, response engineering, exception mapping, filter/interceptor, injection, dan integrasi DI.

Bagian ini berpindah ke sisi lain Jersey yang sering diremehkan:

> **Jersey Client bukan sekadar wrapper HTTP. Jersey Client adalah runtime outbound HTTP yang punya pipeline, provider registry, connector abstraction, lifecycle, configuration hierarchy, entity conversion, filter/interceptor, dan failure mode sendiri.**

Banyak sistem production gagal bukan karena endpoint server salah, tetapi karena outbound HTTP client salah dikelola:

- membuat `Client` baru per request;
- tidak menutup `Response`;
- tidak mengatur timeout;
- pool connection habis;
- membaca entity stream dua kali;
- provider JSON berbeda antara server dan client;
- retry dilakukan di tempat yang salah;
- TLS/proxy/redirect/cookie tidak dipahami;
- request filter menghilangkan header penting;
- connection leak tersembunyi sampai traffic naik;
- error remote service diperlakukan seperti local exception biasa.

Tujuan bagian ini adalah membangun mental model Jersey Client yang production-grade.

Setelah selesai, kamu harus bisa menjawab:

1. Apa beda `Client`, `WebTarget`, `Invocation.Builder`, dan `Invocation`?
2. Di mana provider, filter, interceptor, property, timeout, dan connector bekerja?
3. Kenapa `Client` harus direuse dan `Response` harus ditutup?
4. Bagaimana outbound entity body dipilih `MessageBodyWriter`-nya?
5. Bagaimana inbound response body dipilih `MessageBodyReader`-nya?
6. Apa yang terjadi saat request gagal sebelum response diterima?
7. Apa yang terjadi saat response diterima tetapi body gagal dibaca?
8. Bagaimana memilih connector?
9. Bagaimana membangun reusable client factory yang aman untuk production?
10. Apa failure mode Jersey Client yang paling sering muncul di incident nyata?

---

## 1. Posisi Jersey Client dalam Arsitektur

Jersey Client adalah implementasi Jakarta REST Client API. Ia menyediakan API fluent untuk mengakses resource HTTP dari aplikasi Java.

Namun secara arsitektur, jangan pikirkan seperti ini:

```text
Java code -> HTTP call
```

Pikirkan seperti ini:

```text
Application service
  -> Outbound API adapter
    -> Jersey Client runtime
      -> Client filters
      -> Writer interceptors
      -> MessageBodyWriter
      -> Connector
      -> Network / TLS / Proxy / DNS
      -> Remote service
      -> Connector response
      -> Client response filters
      -> Reader interceptors
      -> MessageBodyReader
    -> Remote DTO / mapped error
  -> Domain/application flow
```

Jersey Client adalah **boundary runtime** antara internal application code dan dunia luar.

Boundary ini harus jelas karena remote call berbeda dari local method call:

| Local call | Remote HTTP call |
|---|---|
| Sangat cepat | Latency tidak stabil |
| Failure biasanya exception lokal | Failure bisa DNS, TLS, timeout, 4xx, 5xx, reset, partial body |
| Tidak perlu serialization | Perlu serialization/deserialization |
| Tidak perlu network resource | Memakai socket, pool, TLS session |
| Transactional expectation sering kuat | Tidak boleh diasumsikan atomic |
| Biasanya synchronous in-memory | Bisa blocking, async, streaming |
| Retrying local call jarang relevan | Retry harus dipikirkan hati-hati |

Mental model penting:

> **Jersey Client harus diperlakukan sebagai adapter infrastruktur, bukan utility class.**

---

## 2. Core Object Model

Jakarta REST Client API memiliki beberapa object utama:

```text
ClientBuilder
  -> Client
    -> WebTarget
      -> Invocation.Builder
        -> Invocation
          -> Response / Entity
```

Masing-masing punya fungsi berbeda.

---

## 3. `ClientBuilder`

`ClientBuilder` adalah builder untuk membuat `Client`.

Contoh sederhana:

```java
Client client = ClientBuilder.newBuilder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .build();
```

Pada API modern Jakarta REST, `ClientBuilder` menyediakan cara standar untuk membuat client dan mengatur beberapa konfigurasi seperti SSL context, hostname verifier, executor service, scheduled executor service, connect timeout, dan read timeout.

Mental model:

```text
ClientBuilder = tempat merakit runtime client sebelum digunakan
```

Jangan mencampur:

```text
ClientBuilder = factory sementara
Client = runtime reusable
```

`ClientBuilder` biasanya tidak disimpan sebagai dependency utama. Yang disimpan adalah `Client` atau wrapper yang mengelola `Client`.

---

## 4. `Client`

`Client` adalah runtime utama Jersey Client.

Ia memegang:

- provider registry;
- feature registration;
- filter/interceptor registration;
- connector configuration;
- SSL configuration;
- executor configuration;
- property configuration;
- lifecycle resource;
- connection management melalui connector;
- runtime state tertentu.

Contoh:

```java
Client client = ClientBuilder.newBuilder()
    .register(JacksonFeature.class)
    .register(CorrelationIdClientFilter.class)
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .build();
```

Hal terpenting:

> **`Client` sebaiknya direuse. Jangan membuat `Client` baru untuk setiap outbound request.**

Kenapa?

Karena `Client` dapat membawa resource mahal:

- connection pool;
- thread/executor;
- SSL context;
- provider registry;
- connector runtime;
- DNS/proxy/TLS behavior;
- metrics/tracing hooks.

Anti-pattern:

```java
public UserDto getUser(String id) {
    Client client = ClientBuilder.newClient(); // buruk jika dipanggil tiap request
    return client.target(baseUrl)
        .path("/users/{id}")
        .resolveTemplate("id", id)
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get(UserDto.class);
}
```

Pattern lebih benar:

```java
public final class UserApiClient implements AutoCloseable {
    private final Client client;
    private final WebTarget baseTarget;

    public UserApiClient(URI baseUri) {
        this.client = ClientBuilder.newBuilder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .register(JacksonFeature.class)
            .build();

        this.baseTarget = client.target(baseUri);
    }

    public UserDto getUser(String id) {
        return baseTarget
            .path("users/{id}")
            .resolveTemplate("id", id)
            .request(MediaType.APPLICATION_JSON_TYPE)
            .get(UserDto.class);
    }

    @Override
    public void close() {
        client.close();
    }
}
```

Dalam aplikasi server, lifecycle `Client` biasanya dikelola oleh DI container:

```text
Application startup -> create Client
Application runtime -> reuse Client
Application shutdown -> close Client
```

---

## 5. `WebTarget`

`WebTarget` merepresentasikan target URI yang bisa dikembangkan secara immutable/fluent.

Contoh:

```java
WebTarget api = client.target("https://api.example.com");
WebTarget users = api.path("users");
WebTarget userById = users.path("{id}").resolveTemplate("id", "123");
```

Mental model:

```text
WebTarget = URI template + configuration layer
```

`WebTarget` bukan request yang sudah dikirim. Ia hanya target.

Karakteristik penting:

- dapat dibuat dari `Client`;
- dapat diberi path tambahan;
- dapat diberi query parameter;
- dapat diberi matrix parameter;
- dapat resolve template;
- dapat memiliki konfigurasi turunan;
- biasanya aman untuk disimpan sebagai base target;
- tidak mengirim network call sampai invocation dilakukan.

Contoh query:

```java
List<UserDto> result = baseTarget
    .path("users")
    .queryParam("status", "ACTIVE")
    .queryParam("limit", 50)
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get(new GenericType<List<UserDto>>() {});
```

Perhatikan bahwa `queryParam` mengembalikan target baru. Jangan berasumsi ia memodifikasi target lama secara mutable.

```java
WebTarget t1 = client.target(baseUri).path("users");
WebTarget t2 = t1.queryParam("status", "ACTIVE");

// t1 tetap tanpa status
// t2 punya query status=ACTIVE
```

Mental model immutability ini penting untuk menghindari bug concurrent.

---

## 6. `Invocation.Builder`

`Invocation.Builder` dibuat dari `WebTarget.request(...)`.

Contoh:

```java
Invocation.Builder builder = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .header("X-Correlation-Id", correlationId)
    .acceptLanguage(Locale.ENGLISH);
```

Mental model:

```text
Invocation.Builder = request metadata builder
```

Ia mengatur:

- `Accept` header;
- `Content-Type` melalui entity;
- custom headers;
- cookies;
- cache control;
- language;
- accepted encodings;
- property per request;
- synchronous/async invocation construction.

Contoh GET:

```java
UserDto dto = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .header("X-Correlation-Id", correlationId)
    .get(UserDto.class);
```

Contoh POST:

```java
CreateUserResponse response = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .post(Entity.entity(requestDto, MediaType.APPLICATION_JSON_TYPE), CreateUserResponse.class);
```

---

## 7. `Invocation`

`Invocation` adalah request yang sudah dibangun tetapi belum tentu dikirim.

Contoh:

```java
Invocation invocation = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .buildGet();

Response response = invocation.invoke();
```

Kapan berguna?

- ketika request ingin disiapkan lalu dieksekusi kemudian;
- ketika ingin API lebih eksplisit;
- ketika membangun wrapper retry/manual orchestration;
- ketika ingin menggunakan async invocation;
- ketika butuh memisahkan request construction dan execution untuk testing.

Namun di banyak kasus, shortcut `.get()`, `.post()`, `.put()`, `.delete()` cukup.

---

## 8. `Response`

`Response` adalah object yang merepresentasikan HTTP response mentah + entity stream.

Contoh:

```java
Response response = target.request().get();
```

Response membawa:

- status code;
- reason phrase;
- headers;
- cookies;
- media type;
- entity stream;
- metadata;
- link information.

Hal penting:

> **Jika kamu mengambil `Response` secara eksplisit, kamu bertanggung jawab memastikan response ditutup.**

Pattern aman:

```java
try (Response response = target.request(MediaType.APPLICATION_JSON_TYPE).get()) {
    if (response.getStatus() == 200) {
        return response.readEntity(UserDto.class);
    }

    String body = response.hasEntity()
        ? response.readEntity(String.class)
        : "";

    throw new RemoteApiException(response.getStatus(), body);
}
```

Kenapa harus ditutup?

Karena entity stream terhubung ke connection. Jika tidak dibaca atau ditutup, connection bisa tidak kembali ke pool. Pada traffic rendah mungkin tidak terlihat. Pada traffic tinggi, pool habis dan semua request berikutnya timeout.

Shortcut seperti ini biasanya membaca entity dan menutup response secara otomatis sesuai behavior implementasi:

```java
UserDto user = target.request().get(UserDto.class);
```

Tapi ketika kamu perlu inspect status/header/body secara manual, gunakan `try-with-resources`.

---

## 9. Pipeline Outbound Jersey Client

Saat kamu menjalankan:

```java
UserDto user = target
    .path("users/{id}")
    .resolveTemplate("id", id)
    .request(MediaType.APPLICATION_JSON_TYPE)
    .header("X-Correlation-Id", correlationId)
    .get(UserDto.class);
```

Secara konseptual pipeline-nya seperti ini:

```text
Application code
  -> WebTarget builds URI
  -> Invocation.Builder builds request metadata
  -> ClientRequestFilter(s)
  -> WriterInterceptor(s), if entity exists
  -> MessageBodyWriter, if entity exists
  -> Connector sends request
  -> Network/TLS/proxy/remote service
  -> Connector receives response
  -> ClientResponseFilter(s)
  -> ReaderInterceptor(s), if readEntity invoked
  -> MessageBodyReader, if readEntity invoked
  -> Application DTO / exception
```

Untuk GET tanpa entity, tidak ada `MessageBodyWriter`. Untuk POST/PUT/PATCH dengan body, outbound entity harus ditulis oleh `MessageBodyWriter`.

Inbound response body tidak langsung selalu dibaca. Body dibaca ketika:

```java
response.readEntity(...)
```

atau ketika shortcut method dipakai:

```java
target.request().get(UserDto.class)
```

---

## 10. Provider Registry pada Client

Sisi client juga memakai provider seperti server:

- `MessageBodyReader`;
- `MessageBodyWriter`;
- `ReaderInterceptor`;
- `WriterInterceptor`;
- `ClientRequestFilter`;
- `ClientResponseFilter`;
- `Feature`;
- custom provider lain.

Ini berarti JSON provider yang tersedia di server belum tentu tersedia di client.

Contoh:

```java
Client client = ClientBuilder.newBuilder()
    .register(JacksonFeature.class)
    .build();
```

Tanpa provider JSON yang sesuai, request POST DTO bisa gagal karena tidak ada `MessageBodyWriter`, atau response DTO gagal dibaca karena tidak ada `MessageBodyReader`.

Contoh failure:

```text
MessageBodyProviderNotFoundException:
MessageBodyWriter not found for media type=application/json, type=class CreateUserRequest
```

atau:

```text
MessageBodyProviderNotFoundException:
MessageBodyReader not found for media type=application/json, type=class UserDto
```

Mental model:

```text
Server provider registry != Client provider registry
```

Jika kamu membangun internal platform, buat provider strategy konsisten:

```java
public final class JerseyClientFactory {
    public Client create(ApiClientConfig config) {
        return ClientBuilder.newBuilder()
            .connectTimeout(config.connectTimeout())
            .readTimeout(config.readTimeout())
            .register(JacksonFeature.class)
            .register(new ObjectMapperContextResolver(config.objectMapper()))
            .register(CorrelationIdClientFilter.class)
            .build();
    }
}
```

---

## 11. Entity Outbound: `Entity<T>`

Untuk request yang punya body, Jersey memakai `Entity<T>`.

Contoh:

```java
CreateUserRequest request = new CreateUserRequest("Alice");

CreateUserResponse response = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .post(Entity.entity(request, MediaType.APPLICATION_JSON_TYPE), CreateUserResponse.class);
```

`Entity` memberi tahu Jersey:

```text
value object + media type
```

Media type penting karena provider dipilih berdasarkan:

- Java type;
- generic type;
- annotation;
- media type.

Shortcut:

```java
Entity.json(request)
```

Contoh:

```java
CreateUserResponse response = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .post(Entity.json(request), CreateUserResponse.class);
```

Namun di sistem enterprise, explicit media type sering lebih bagus karena kontrak lebih jelas:

```java
private static final MediaType API_JSON = MediaType.APPLICATION_JSON_TYPE;
```

---

## 12. Inbound Generic Type

Masalah klasik Java: generic type hilang karena type erasure.

Jika response adalah list:

```json
[
  { "id": "1", "name": "Alice" },
  { "id": "2", "name": "Bob" }
]
```

Jangan begini:

```java
List users = target.request().get(List.class);
```

Itu menghasilkan list raw map/object, bukan `List<UserDto>`.

Gunakan `GenericType`:

```java
List<UserDto> users = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get(new GenericType<List<UserDto>>() {});
```

Untuk response manual:

```java
try (Response response = target.request().get()) {
    List<UserDto> users = response.readEntity(new GenericType<List<UserDto>>() {});
}
```

Mental model:

```text
Class<T> cukup untuk non-generic
GenericType<T> dibutuhkan untuk generic/nested generic
```

Contoh nested:

```java
GenericType<ApiResponse<List<UserDto>>> type =
    new GenericType<ApiResponse<List<UserDto>>>() {};

ApiResponse<List<UserDto>> result = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get(type);
```

---

## 13. Configuration Hierarchy

Jakarta REST Client API memiliki configurable types. Secara umum konfigurasi bisa berada di:

```text
ClientBuilder
Client
WebTarget
Invocation.Builder/request property
```

Mental model:

```text
Client-level config = default global untuk client itu
WebTarget-level config = override/extension untuk target tertentu
Request-level config = override/metadata untuk invocation tertentu
```

Contoh:

```java
Client client = ClientBuilder.newBuilder()
    .register(JacksonFeature.class)
    .property("client.name", "customer-api")
    .build();

WebTarget target = client
    .target("https://api.example.com")
    .property("api.domain", "customer");

Response response = target
    .path("users")
    .request()
    .property("request.operation", "list-users")
    .get();
```

Tidak semua property distandardisasi. Banyak property bersifat implementation-specific Jersey atau connector-specific. Karena itu dokumentasikan property yang kamu gunakan.

---

## 14. Timeout: Connect Timeout dan Read Timeout

Dua timeout minimum yang hampir selalu wajib:

```java
Client client = ClientBuilder.newBuilder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .build();
```

Makna umum:

| Timeout | Makna |
|---|---|
| Connect timeout | batas waktu membangun koneksi ke remote endpoint |
| Read timeout | batas waktu menunggu data response setelah request terkirim / saat membaca |

Tanpa timeout, outbound call bisa menggantung jauh lebih lama dari SLA aplikasi.

Namun timeout production sebenarnya lebih kaya:

```text
DNS lookup timeout
TCP connect timeout
TLS handshake timeout
connection acquisition timeout dari pool
write timeout
read timeout
full request deadline
total operation timeout
```

Jakarta REST API standar terutama mengekspos connect/read timeout. Connector tertentu bisa memiliki property tambahan untuk pooling, connection request timeout, socket config, proxy, dan lain-lain.

Prinsip penting:

> **Timeout harus ditentukan berdasarkan budget SLA, bukan angka random.**

Contoh reasoning:

```text
Endpoint aplikasi harus selesai <= 2 detik.
Endpoint memanggil 2 remote service serial.
Budget internal processing: 300 ms.
Budget observability/security/mapping: 100 ms.
Sisa remote budget: 1600 ms.
Masing-masing remote call maksimal 800 ms.
Connect timeout: 100-200 ms di intranet, lebih tinggi untuk internet.
Read timeout: 600-700 ms.
Retry? Hanya jika masih muat dalam total deadline.
```

Jika read timeout 10 detik pada endpoint yang SLA-nya 2 detik, timeout tersebut tidak melindungi user journey.

---

## 15. Response Closing dan Connection Leak

Ini salah satu top failure mode Jersey Client.

Buruk:

```java
Response response = target.request().get();
if (response.getStatus() != 200) {
    throw new RuntimeException("failed"); // response tidak ditutup
}
return response.readEntity(UserDto.class);
```

Lebih baik:

```java
try (Response response = target.request().get()) {
    if (response.getStatus() != 200) {
        String errorBody = response.hasEntity()
            ? response.readEntity(String.class)
            : "";
        throw new RemoteApiException(response.getStatus(), errorBody);
    }
    return response.readEntity(UserDto.class);
}
```

Kenapa buruk?

Karena pada path error, entity stream belum dibaca dan response tidak ditutup. Connection bisa tertahan.

Gejala incident:

```text
Traffic naik
-> beberapa remote response non-200
-> error path tidak close response
-> connection pool makin habis
-> request baru menunggu connection
-> latency naik
-> timeout
-> retry memperparah
-> dependency dianggap down padahal client pool leak
```

Checklist:

- Jika method return DTO langsung: aman dalam banyak kasus.
- Jika method return `Response`: caller harus tahu wajib close.
- Jika wrapper membaca status manual: gunakan try-with-resources.
- Jika membaca body error: baca sebagai string sekali, lalu map.
- Jangan mengembalikan `Response` keluar dari adapter kecuali memang desainnya streaming dan lifecycle jelas.

---

## 16. Jangan Membaca Entity Dua Kali

Entity stream umumnya hanya bisa dibaca sekali.

Buruk:

```java
try (Response response = target.request().get()) {
    String raw = response.readEntity(String.class);
    UserDto user = response.readEntity(UserDto.class); // bisa gagal / kosong
    return user;
}
```

Jika perlu logging raw body dan parsing DTO, ada beberapa pilihan:

### Pilihan 1 — baca string lalu parse sendiri

```java
try (Response response = target.request().get()) {
    String raw = response.readEntity(String.class);
    log.debug("remote body={}", mask(raw));
    return objectMapper.readValue(raw, UserDto.class);
}
```

Trade-off:

- mudah;
- body tersimpan di memory;
- tidak cocok untuk response besar.

### Pilihan 2 — gunakan buffering dengan hati-hati

Beberapa implementasi menyediakan kemampuan buffer entity sehingga bisa dibaca lebih dari sekali.

Namun ini harus dipakai hati-hati karena buffering response besar bisa menyebabkan memory pressure.

Prinsip:

> **Jangan logging full body untuk payload besar atau sensitive. Gunakan masking, truncation, dan sampling.**

---

## 17. Client Request Filter

`ClientRequestFilter` berjalan sebelum request dikirim connector.

Contoh correlation ID:

```java
@Provider
public class CorrelationIdClientFilter implements ClientRequestFilter {
    @Override
    public void filter(ClientRequestContext requestContext) {
        String correlationId = Correlation.currentId()
            .orElseGet(Correlation::newId);

        requestContext.getHeaders().putSingle("X-Correlation-Id", correlationId);
    }
}
```

Kegunaan umum:

- correlation ID propagation;
- authentication header;
- idempotency key;
- user-agent standardization;
- tenant header;
- request signing;
- logging metadata;
- metrics start marker;
- custom routing header.

Hati-hati:

- jangan logging token;
- jangan overwrite header caller tanpa sadar;
- jangan melakukan blocking remote call tambahan di filter;
- jangan membaca entity stream sembarangan;
- jangan memasukkan mutable global state.

---

## 18. Client Response Filter

`ClientResponseFilter` berjalan setelah response diterima tetapi sebelum entity dibaca oleh application code.

Contoh:

```java
@Provider
public class RemoteStatusMetricsFilter implements ClientResponseFilter {
    @Override
    public void filter(
        ClientRequestContext requestContext,
        ClientResponseContext responseContext
    ) {
        String method = requestContext.getMethod();
        int status = responseContext.getStatus();
        URI uri = requestContext.getUri();

        RemoteMetrics.record(method, sanitizeUri(uri), status);
    }
}
```

Kegunaan:

- metrics status code;
- response header inspection;
- rate limit header reading;
- trace header reading;
- response logging;
- error classification awal.

Hati-hati:

- entity body belum tentu aman dibaca;
- jika membaca entity stream di filter, kamu bisa menghabiskan stream untuk caller;
- kalau perlu body logging, wrap stream dengan benar atau gunakan controlled buffering;
- jangan throw exception tanpa memastikan observability cukup.

---

## 19. Reader dan Writer Interceptor di Client

Sama seperti server, client juga bisa memakai:

- `WriterInterceptor` untuk outbound body;
- `ReaderInterceptor` untuk inbound body.

Use case:

- compression;
- encryption;
- signing;
- checksum;
- envelope wrapping;
- payload metrics;
- controlled logging;
- backward compatibility transform.

Contoh konseptual writer interceptor:

```java
@Provider
public class PayloadSizeWriterInterceptor implements WriterInterceptor {
    @Override
    public void aroundWriteTo(WriterInterceptorContext context)
        throws IOException, WebApplicationException {

        Object entity = context.getEntity();
        String type = entity == null ? "none" : entity.getClass().getSimpleName();

        long start = System.nanoTime();
        try {
            context.proceed();
        } finally {
            long durationNanos = System.nanoTime() - start;
            PayloadMetrics.recordWrite(type, durationNanos);
        }
    }
}
```

Peringatan:

> Interceptor berada di jalur panas request/response. Kesalahan kecil bisa berdampak ke semua outbound call.

---

## 20. Connectors: Abstraction di Bawah Jersey Client

Jersey Client tidak harus selalu langsung memakai satu transport implementation. Ia memakai konsep connector/provider connector.

Mental model:

```text
Jersey Client API
  -> Jersey client runtime
    -> Connector abstraction
      -> concrete HTTP transport
```

Connector menentukan detail seperti:

- bagaimana request dikirim;
- bagaimana connection dikelola;
- dukungan pooling;
- proxy support;
- TLS details;
- redirect behavior;
- streaming behavior;
- async support;
- HTTP version support;
- dependency eksternal yang dipakai.

Contoh connector yang umum dalam ekosistem Jersey:

- default connector;
- Apache connector;
- JDK connector;
- Jetty connector;
- Grizzly connector.

Nama dan dukungan spesifik tergantung versi Jersey dan dependency yang digunakan.

Prinsip:

> **Connector adalah keputusan production, bukan detail kecil.**

Untuk service internal dengan traffic tinggi, pooling dan timeout behavior sangat penting.

---

## 21. Default Connector: Kapan Cukup, Kapan Tidak

Default connector biasanya cukup untuk:

- aplikasi sederhana;
- traffic rendah;
- prototyping;
- integration test;
- internal tool;
- outbound call jarang.

Namun untuk production high-throughput, tanyakan:

1. Apakah connection pooling jelas?
2. Apakah timeout lengkap?
3. Apakah proxy/TLS behavior sesuai?
4. Apakah ada metric pool?
5. Apakah connection acquisition timeout tersedia?
6. Apakah behavior redirect/cookie sesuai?
7. Apakah connector cocok untuk Java version dan deployment container?

Jika jawabannya tidak jelas, jangan asal pakai default tanpa uji.

---

## 22. Apache Connector

Apache connector menggunakan Apache HTTP client di bawahnya.

Kelebihan umum:

- mature;
- pooling kuat;
- proxy support baik;
- konfigurasi detail;
- cocok untuk production enterprise;
- banyak engineer familiar.

Contoh konseptual Jersey 2/3 style:

```java
ClientConfig config = new ClientConfig();
config.connectorProvider(new ApacheConnectorProvider());
config.property(ClientProperties.CONNECT_TIMEOUT, 2_000);
config.property(ClientProperties.READ_TIMEOUT, 5_000);

Client client = ClientBuilder.newClient(config);
```

Catatan:

- package class dan artifact bisa berbeda antara Jersey 2 (`javax`) dan Jersey 3/4 (`jakarta`);
- pastikan versi connector selaras dengan versi Jersey core;
- pastikan dependency Apache HTTP client tidak bentrok;
- property pooling bisa connector-specific;
- selalu cek dokumentasi versi yang dipakai.

Production consideration:

```text
Apache connector bagus jika kamu butuh kontrol connection pool yang eksplisit.
```

Namun jangan hanya register connector tanpa mengerti pool configuration.

---

## 23. JDK Connector

JDK connector memakai fasilitas HTTP di JDK.

Pertimbangan:

- dependency lebih sedikit;
- lebih dekat ke platform JDK;
- cocok untuk aplikasi yang menghindari dependency ekstra;
- behavior dapat berbeda antar JDK version;
- fitur pooling/config detail mungkin tidak sama dengan Apache connector.

Dengan Java 11+, JDK memiliki `java.net.http.HttpClient`. Namun integrasi Jersey connector spesifik harus dilihat berdasarkan versi Jersey.

Prinsip:

```text
JDK connector menarik untuk simplicity dan modern JDK alignment,
tetapi tetap validasi timeout, pooling, TLS, proxy, redirect, dan observability.
```

---

## 24. Grizzly dan Jetty Connector

Connector lain bisa berguna bila:

- aplikasi sudah memakai Grizzly/Jetty stack;
- butuh async/network behavior tertentu;
- butuh integrasi lebih dekat dengan runtime tertentu;
- testing environment memakai stack yang sama.

Namun untuk enterprise backend umum, keputusan biasanya berkisar:

```text
default vs Apache vs JDK connector
```

Pilih berdasarkan:

- requirement pooling;
- TLS/proxy;
- operational familiarity;
- dependency policy;
- observability support;
- compatibility Java/Jersey;
- behavior under load.

---

## 25. Connection Pooling

Connection pool menyimpan reusable connection ke remote host agar tidak membuat TCP/TLS connection baru setiap request.

Tanpa pooling:

```text
request 1 -> TCP connect -> TLS handshake -> HTTP -> close
request 2 -> TCP connect -> TLS handshake -> HTTP -> close
request 3 -> TCP connect -> TLS handshake -> HTTP -> close
```

Dengan pooling:

```text
request 1 -> create connection -> use -> return to pool
request 2 -> reuse connection -> return to pool
request 3 -> reuse connection -> return to pool
```

Manfaat:

- latency lebih rendah;
- CPU lebih rendah;
- TLS handshake lebih sedikit;
- remote service tidak dibanjiri connection churn;
- throughput lebih stabil.

Risiko pool:

- pool terlalu kecil -> wait/timeout;
- pool terlalu besar -> remote overwhelmed;
- connection leak -> pool habis;
- stale connection -> intermittent failure;
- idle timeout mismatch dengan proxy/LB;
- per-host limit salah;
- global limit salah.

Rule of thumb awal:

```text
pool size harus didesain dari concurrency outbound, bukan dari jumlah thread aplikasi saja.
```

Contoh reasoning:

```text
Aplikasi menerima 200 concurrent request.
30% request memanggil Customer API.
Setiap request Customer API rata-rata 1 call, p95 latency 300 ms.
Target tidak menunggu pool pada normal load.
Pool Customer API mungkin mulai dari 60-100 max per route,
lalu divalidasi dengan load test dan limit remote service.
```

Namun jangan menjadikan angka ini dogma. Ukur dengan traffic nyata.

---

## 26. TLS Configuration

Jersey Client bisa dikonfigurasi dengan SSL context dan hostname verifier melalui `ClientBuilder`.

Contoh konseptual:

```java
SSLContext sslContext = buildSslContextFromTrustStore();

Client client = ClientBuilder.newBuilder()
    .sslContext(sslContext)
    .hostnameVerifier((hostname, session) -> {
        // contoh saja; jangan disable verification di production
        return HttpsURLConnection.getDefaultHostnameVerifier()
            .verify(hostname, session);
    })
    .build();
```

Jangan lakukan ini di production:

```java
.hostnameVerifier((host, session) -> true)
```

Itu mematikan hostname verification dan membuka risiko man-in-the-middle.

TLS checklist:

- truststore jelas;
- certificate chain valid;
- hostname verification aktif;
- mTLS jika diperlukan;
- key rotation plan;
- expiry monitoring;
- TLS protocol/cipher policy;
- environment-specific trust;
- jangan hardcode secret path/password;
- observability untuk TLS failure.

Common failure:

```text
SSLHandshakeException
PKIX path building failed
No subject alternative names matching IP address
certificate expired
unknown_ca
bad_certificate for mTLS
protocol_version
```

Diagnose TLS dengan membedakan:

```text
trust problem != hostname problem != client certificate problem != protocol/cipher problem
```

---

## 27. Proxy Configuration

Dalam enterprise, outbound call sering melewati proxy.

Proxy concern:

- HTTP proxy;
- HTTPS tunneling;
- no-proxy host list;
- authenticated proxy;
- corporate MITM proxy;
- proxy timeout;
- proxy connection pool;
- proxy rewrite;
- proxy certificate trust;
- audit logging.

Jersey connector-specific property sering diperlukan.

Prinsip desain:

```text
Proxy config adalah bagian dari environment config,
bukan hardcoded di client adapter.
```

Contoh config object:

```java
public record ProxyConfig(
    boolean enabled,
    String host,
    int port,
    Optional<String> username,
    Optional<String> password,
    List<String> noProxyHosts
) {}
```

---

## 28. Redirect Behavior

HTTP redirect tidak selalu aman untuk otomatis diikuti.

Pertanyaan sebelum enable redirect:

1. Method apa yang redirect? GET saja atau POST juga?
2. Apakah Authorization header ikut ke host lain?
3. Apakah body dikirim ulang?
4. Apakah redirect cross-domain diperbolehkan?
5. Apakah audit mencatat final URL?
6. Apakah redirect bisa menciptakan loop?

Untuk API internal, redirect sering lebih baik dianggap misconfiguration daripada behavior normal.

Prinsip:

```text
Untuk backend-to-backend API, automatic redirect harus eksplisit dan dibatasi.
```

---

## 29. Cookies

Jersey Client bisa menangani cookies, tetapi backend service-to-service biasanya lebih baik memakai token/header eksplisit daripada cookie stateful.

Cookie relevan jika:

- memanggil legacy system;
- session-based integration;
- CSRF-protected form flow;
- SSO browser-like simulation;
- testing web app.

Risiko:

- session leakage;
- shared cookie jar antar tenant/user;
- concurrency issue;
- state sulit diprediksi;
- horizontal scaling behavior aneh;
- security audit lebih sulit.

Prinsip:

```text
Jika client dipakai untuk banyak user/tenant, jangan biarkan cookie state global bercampur.
```

---

## 30. Authentication Header Pattern

Untuk service-to-service call, authentication biasanya dilakukan via header.

Contoh static bearer token dari config:

```java
public class BearerTokenFilter implements ClientRequestFilter {
    private final TokenProvider tokenProvider;

    public BearerTokenFilter(TokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    @Override
    public void filter(ClientRequestContext requestContext) {
        String token = tokenProvider.currentToken();
        requestContext.getHeaders().putSingle("Authorization", "Bearer " + token);
    }
}
```

Token provider harus memperhatikan:

- caching token;
- expiry;
- refresh race;
- failed refresh;
- clock skew;
- 401 retry policy;
- secret storage;
- observability tanpa logging token.

Jangan begini:

```java
log.info("Authorization={}", token);
```

Gunakan masking:

```java
log.debug("Authorization=Bearer ***{}", tokenSuffix(token));
```

---

## 31. Header Propagation

Tidak semua header inbound boleh dipropagate outbound.

Header yang sering dipropagate:

- correlation ID;
- traceparent;
- baggage tertentu;
- tenant ID;
- locale;
- idempotency key untuk command chain tertentu.

Header yang biasanya jangan asal dipropagate:

- `Authorization` user ke service yang tidak seharusnya menerima;
- `Cookie`;
- `Host`;
- hop-by-hop headers;
- internal gateway headers;
- raw IP headers;
- security-sensitive headers.

Mental model:

```text
Header propagation adalah security decision, bukan convenience.
```

---

## 32. User-Agent dan Client Identity

Outbound client harus memiliki identity yang jelas.

Contoh:

```java
requestContext.getHeaders().putSingle(
    "User-Agent",
    "aceas-case-service/1.42.0 jersey-client"
);
```

Manfaat:

- remote service bisa trace caller;
- traffic bisa dibedakan;
- debugging lebih mudah;
- rate limit lebih akurat;
- incident coordination lebih cepat.

Jangan gunakan User-Agent default tanpa alasan di enterprise integration.

---

## 33. Mapping Remote Response

Jangan biarkan seluruh application service langsung bergantung pada Jersey `Response`.

Buruk:

```java
public Response callRemote() {
    return target.request().get();
}
```

Lebih baik:

```java
public CustomerSnapshot getCustomer(String customerId) {
    try (Response response = target
        .path("customers/{id}")
        .resolveTemplate("id", customerId)
        .request(MediaType.APPLICATION_JSON_TYPE)
        .get()) {

        int status = response.getStatus();

        if (status == 200) {
            return response.readEntity(CustomerSnapshot.class);
        }

        if (status == 404) {
            throw new CustomerNotFoundRemoteException(customerId);
        }

        String body = safeReadBody(response);
        throw new CustomerApiException(status, body);
    }
}
```

Remote API adapter harus menerjemahkan:

```text
HTTP concern -> application-level remote result/error
```

Contoh mapping:

| Remote status | Adapter behavior |
|---|---|
| 200 | return DTO |
| 201 | return created result |
| 202 | return accepted/pending result |
| 204 | return void/success marker |
| 400 | map to invalid remote request/config bug |
| 401/403 | map to auth integration failure |
| 404 | maybe domain not found, maybe remote route wrong |
| 409 | conflict/concurrency condition |
| 429 | rate limited, maybe retryable later |
| 500 | dependency failure |
| 502/503/504 | dependency unavailable/timeout/gateway |

Jangan otomatis menyamakan semua non-2xx.

---

## 34. `WebApplicationException` pada Client

Shortcut seperti:

```java
UserDto user = target.request().get(UserDto.class);
```

dapat melempar exception untuk response tertentu tergantung API method dan behavior. Dalam Jakarta REST client, ada exception hierarchy seperti `ProcessingException`, `ResponseProcessingException`, dan `WebApplicationException`/subclass untuk beberapa status path.

Prinsip production:

```text
Untuk adapter penting, lebih baik ambil Response manual,
inspect status, baca body secara aman, lalu map ke exception/domain result sendiri.
```

Kenapa?

Karena kamu ingin kontrol:

- error body;
- status mapping;
- logging;
- metric;
- retry classification;
- audit;
- response closing;
- correlation.

---

## 35. Failure Type dalam Jersey Client

Outbound failure minimal dibagi menjadi beberapa kategori:

```text
A. Request construction failure
B. Serialization failure before network call
C. Connection failure
D. TLS/proxy/DNS failure
E. Timeout before response
F. HTTP response non-2xx
G. Response body deserialization failure
H. Response stream interrupted
I. Client lifecycle/config failure
```

### A. Request construction failure

Contoh:

- invalid URI;
- template belum di-resolve;
- header invalid;
- query value tidak sesuai;
- base URL config kosong.

Ini biasanya bug aplikasi/config.

### B. Serialization failure

Contoh:

- DTO tidak bisa diserialize;
- tidak ada `MessageBodyWriter`;
- field menyebabkan infinite recursion;
- `ObjectMapper` salah config.

Ini terjadi sebelum atau saat request body ditulis.

### C. Connection failure

Contoh:

- connection refused;
- no route to host;
- remote down;
- pool exhausted;
- connection reset.

### D. TLS/proxy/DNS failure

Contoh:

- certificate invalid;
- DNS lookup gagal;
- proxy authentication required;
- TLS handshake failure.

### E. Timeout before response

Contoh:

- connect timeout;
- read timeout;
- pool acquisition timeout connector-specific;
- total deadline exceeded external wrapper.

### F. HTTP non-2xx

Remote service menjawab. Ini bukan network failure. Ini remote semantic response.

### G. Deserialization failure

Remote menjawab body, tetapi client gagal membaca:

- schema berubah;
- enum unknown;
- date format beda;
- content-type salah;
- body HTML error tetapi client mencoba parse JSON;
- no `MessageBodyReader`.

### H. Stream interrupted

Response mulai dibaca, lalu koneksi putus.

### I. Lifecycle/config failure

Contoh:

- client sudah closed;
- provider tidak registered;
- connector dependency hilang;
- classpath conflict `javax`/`jakarta`.

---

## 36. Remote API Adapter Pattern

Pattern yang direkomendasikan:

```text
Application service
  -> interface RemoteCustomerGateway
    -> JerseyCustomerGateway implementation
      -> Jersey Client/WebTarget
      -> maps HTTP to domain/application result
```

Interface:

```java
public interface CustomerGateway {
    CustomerSnapshot getCustomer(CustomerId id);
}
```

Implementation:

```java
public final class JerseyCustomerGateway implements CustomerGateway {
    private final WebTarget baseTarget;

    public JerseyCustomerGateway(WebTarget baseTarget) {
        this.baseTarget = baseTarget;
    }

    @Override
    public CustomerSnapshot getCustomer(CustomerId id) {
        try (Response response = baseTarget
            .path("customers/{id}")
            .resolveTemplate("id", id.value())
            .request(MediaType.APPLICATION_JSON_TYPE)
            .get()) {

            return switch (response.getStatus()) {
                case 200 -> response.readEntity(CustomerSnapshot.class);
                case 404 -> throw new CustomerNotFoundException(id);
                case 401, 403 -> throw new CustomerGatewayAuthException(id);
                case 429 -> throw new CustomerGatewayRateLimitedException(id);
                default -> throw mapUnexpected(response);
            };
        }
    }

    private RuntimeException mapUnexpected(Response response) {
        String body = safeReadBody(response);
        return new CustomerGatewayException(response.getStatus(), body);
    }

    private String safeReadBody(Response response) {
        if (!response.hasEntity()) {
            return "";
        }
        try {
            return response.readEntity(String.class);
        } catch (RuntimeException ex) {
            return "<unreadable-response-body>";
        }
    }
}
```

Untuk Java 8, ganti switch expression:

```java
int status = response.getStatus();
if (status == 200) {
    return response.readEntity(CustomerSnapshot.class);
}
if (status == 404) {
    throw new CustomerNotFoundException(id);
}
if (status == 401 || status == 403) {
    throw new CustomerGatewayAuthException(id);
}
if (status == 429) {
    throw new CustomerGatewayRateLimitedException(id);
}
throw mapUnexpected(response);
```

---

## 37. Client Factory Pattern

Untuk banyak remote service, jangan copy-paste `ClientBuilder` di semua adapter.

Buat factory:

```java
public final class JerseyClientFactory {
    private final ObjectMapper objectMapper;
    private final List<ClientRequestFilter> globalRequestFilters;
    private final List<ClientResponseFilter> globalResponseFilters;

    public JerseyClientFactory(
        ObjectMapper objectMapper,
        List<ClientRequestFilter> globalRequestFilters,
        List<ClientResponseFilter> globalResponseFilters
    ) {
        this.objectMapper = objectMapper;
        this.globalRequestFilters = globalRequestFilters;
        this.globalResponseFilters = globalResponseFilters;
    }

    public Client create(ApiClientConfig config) {
        ClientBuilder builder = ClientBuilder.newBuilder()
            .connectTimeout(config.connectTimeout().toMillis(), TimeUnit.MILLISECONDS)
            .readTimeout(config.readTimeout().toMillis(), TimeUnit.MILLISECONDS);

        Client client = builder.build();

        client.register(JacksonFeature.class);
        client.register(new ObjectMapperContextResolver(objectMapper));

        for (ClientRequestFilter filter : globalRequestFilters) {
            client.register(filter);
        }
        for (ClientResponseFilter filter : globalResponseFilters) {
            client.register(filter);
        }

        return client;
    }
}
```

Config:

```java
public record ApiClientConfig(
    String name,
    URI baseUri,
    Duration connectTimeout,
    Duration readTimeout,
    Optional<ProxyConfig> proxy,
    Optional<TlsConfig> tls
) {}
```

Untuk Java 8, gunakan class biasa, bukan record.

---

## 38. Managing Multiple Remote APIs

Jika aplikasi memanggil banyak remote service, jangan pakai satu `Client` global tanpa berpikir.

Pilihan desain:

### Option A — One Client per remote service

```text
CustomerApiClient -> Client A -> pool A
PaymentApiClient  -> Client B -> pool B
DocumentApiClient -> Client C -> pool C
```

Kelebihan:

- isolasi pool;
- config timeout berbeda;
- auth berbeda;
- observability lebih jelas;
- shutdown/lifecycle jelas.

Kekurangan:

- lebih banyak resource;
- perlu lifecycle management lebih rapi.

### Option B — Shared Client, multiple targets

```text
Shared Client -> target customer
              -> target payment
              -> target document
```

Kelebihan:

- sederhana;
- resource lebih sedikit;
- cocok untuk low traffic.

Kekurangan:

- pool contention;
- config sulit dibedakan;
- auth/filter bisa bercampur;
- timeout per service lebih sulit;
- incident satu dependency bisa mempengaruhi semua.

Rekomendasi enterprise:

```text
Gunakan satu managed Client per remote dependency penting,
dengan config, pool, auth, dan metric identity masing-masing.
```

---

## 39. `WebTarget` as Dependency

Daripada menyuntikkan `Client` ke semua adapter, sering lebih baik menyuntikkan `WebTarget` base yang sudah disiapkan.

```java
public JerseyCustomerGateway(WebTarget customerBaseTarget) {
    this.customerBaseTarget = customerBaseTarget;
}
```

Keuntungan:

- adapter tidak perlu tahu base URL;
- adapter tidak perlu register provider;
- testing lebih mudah;
- konfigurasi centralized;
- target identity jelas.

Namun pastikan `WebTarget` berasal dari `Client` yang lifecycle-nya dikelola.

---

## 40. Async Client API

Jersey Client mendukung async invocation.

Contoh:

```java
Future<UserDto> future = target
    .request(MediaType.APPLICATION_JSON_TYPE)
    .async()
    .get(UserDto.class);
```

Callback style:

```java
target.request(MediaType.APPLICATION_JSON_TYPE)
    .async()
    .get(new InvocationCallback<UserDto>() {
        @Override
        public void completed(UserDto user) {
            handleUser(user);
        }

        @Override
        public void failed(Throwable throwable) {
            handleFailure(throwable);
        }
    });
```

Async bukan otomatis lebih cepat. Async berguna jika:

- banyak remote call bisa overlap;
- thread blocking mahal;
- ada executor yang benar;
- cancellation/deadline jelas;
- context propagation diatur;
- error aggregation dipikirkan.

Risiko async:

- callback hell;
- kehilangan MDC/correlation;
- executor starvation;
- exception tertelan;
- timeout tidak menyeluruh;
- response lifecycle kurang jelas;
- back-pressure tidak ada.

Dengan Java 21+, virtual threads sering membuat blocking style lebih sederhana dibanding callback async untuk banyak kasus backend.

---

## 41. Jersey Client dan Virtual Threads

Java 21 memperkenalkan virtual threads sebagai fitur final. Java 25 melanjutkan era modern Java/LTS.

Bagaimana relevansinya untuk Jersey Client?

Jika connector melakukan blocking IO, virtual threads bisa membantu scalability dari sisi thread utilization:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<CustomerSnapshot> f1 = executor.submit(() -> customerGateway.getCustomer(id));
    Future<AccountSnapshot> f2 = executor.submit(() -> accountGateway.getAccount(id));

    CustomerSnapshot customer = f1.get();
    AccountSnapshot account = f2.get();
}
```

Namun virtual threads tidak menyelesaikan:

- remote latency;
- remote capacity;
- connection pool limit;
- rate limit;
- TLS failure;
- serialization cost;
- body memory pressure;
- missing timeout;
- retry storm.

Mental model:

```text
Virtual threads reduce cost of waiting threads.
They do not remove the need for timeout, pool, back-pressure, and resilience.
```

Jika pool hanya 50 connection, menjalankan 5.000 virtual threads tidak membuat remote call magically concurrent 5.000 secara sehat. Yang terjadi bisa:

```text
virtual threads menunggu pool -> latency naik -> timeout -> retry storm
```

---

## 42. Java 8 sampai 25 Consideration

### Java 8

- masih umum di legacy Jersey 2.x;
- tidak ada records, switch expression, virtual threads;
- TLS default dan root CA behavior lebih tua;
- dependency modern mungkin tidak support;
- gunakan explicit executor dan pooling;
- hati-hati dengan old Jackson/module support.

### Java 11

- modern baseline untuk banyak library;
- ada `java.net.http.HttpClient`;
- TLS/runtime lebih modern;
- masih belum virtual threads.

### Java 17

- baseline penting untuk banyak Jakarta-era runtime;
- sealed class/record tersedia;
- cocok sebagai minimum modern enterprise baseline.

### Java 21

- virtual threads final;
- structured concurrency masih preview/incubator tergantung versi;
- bagus untuk blocking HTTP client orchestration jika connector/container mendukung pola blocking sehat.

### Java 25

- LTS terbaru di era setelah Java 21;
- pikirkan migration dari Java 17/21 dengan compatibility library;
- jangan hanya upgrade JDK tanpa menguji connector, TLS, reflection, module/classpath, dan performance.

Prinsip:

```text
Jersey Client compatibility bukan hanya source code compile.
Yang harus diuji: connector behavior, TLS, timeout, provider, reflection, JSON, classpath/module path, dan load behavior.
```

---

## 43. Module Path dan Classpath

Dengan Java 9+, module system bisa mempengaruhi aplikasi.

Masalah yang sering muncul:

- automatic module names;
- split packages;
- reflective access;
- provider discovery;
- service loader;
- dependency yang belum modular;
- `javax`/`jakarta` collision;
- duplicate API jar.

Untuk Jersey 2 vs 3/4:

```text
Jersey 2.x -> javax.ws.rs
Jersey 3.x/4.x -> jakarta.ws.rs
```

Jangan mencampur:

```text
javax.ws.rs-api + jersey 3.x
jakarta.ws.rs-api + jersey 2.x
```

Gejala:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
LinkageError
MessageBodyProviderNotFoundException karena provider namespace berbeda
```

---

## 44. Observability untuk Jersey Client

Outbound call harus observable.

Minimum metrics:

- request count by remote service, operation, method, status category;
- latency histogram;
- timeout count;
- connection failure count;
- deserialization failure count;
- response size if available;
- in-flight calls;
- pool metrics jika connector mendukung;
- retry count nanti di Part 14.

Minimum logs:

- remote service name;
- operation name;
- method;
- sanitized URI template, bukan full sensitive URL;
- status;
- duration;
- correlation ID;
- failure category;
- truncated/masked error body bila aman.

Jangan log:

- access token;
- full PII body;
- password/secret;
- cookie/session;
- full document/file payload.

Contoh filter sederhana:

```java
public class OutboundTimingFilter implements ClientRequestFilter, ClientResponseFilter {
    private static final String START = "outbound.startNanos";

    @Override
    public void filter(ClientRequestContext requestContext) {
        requestContext.setProperty(START, System.nanoTime());
    }

    @Override
    public void filter(
        ClientRequestContext requestContext,
        ClientResponseContext responseContext
    ) {
        Object value = requestContext.getProperty(START);
        if (value instanceof Long startNanos) {
            long durationNanos = System.nanoTime() - startNanos;
            OutboundMetrics.record(
                requestContext.getMethod(),
                sanitize(requestContext.getUri()),
                responseContext.getStatus(),
                durationNanos
            );
        }
    }
}
```

Untuk Java 8:

```java
Object value = requestContext.getProperty(START);
if (value instanceof Long) {
    long startNanos = (Long) value;
    long durationNanos = System.nanoTime() - startNanos;
    // record metric
}
```

---

## 45. URI Sanitization

Jangan memakai full URL mentah sebagai metric tag.

Buruk:

```text
https://api.example.com/users/1234567890/orders?token=abc
https://api.example.com/users/9876543210/orders?token=def
```

Masalah:

- high cardinality;
- PII leak;
- token leak;
- metric backend mahal;
- dashboard sulit dibaca.

Lebih baik:

```text
remote=customer-api
operation=get-user-orders
method=GET
route=/users/{id}/orders
status=200
```

Karena Jersey Client tidak selalu tahu template route setelah `resolveTemplate`, platform wrapper sebaiknya menyimpan operation name secara eksplisit.

Contoh:

```java
try (Response response = baseTarget
    .path("users/{id}/orders")
    .resolveTemplate("id", userId)
    .request(MediaType.APPLICATION_JSON_TYPE)
    .property("operation", "get-user-orders")
    .get()) {
    ...
}
```

---

## 46. Handling Error Body

Error body sering punya format berbeda dari success body.

Success:

```json
{
  "id": "C123",
  "name": "Alice"
}
```

Error:

```json
{
  "code": "CUSTOMER_NOT_FOUND",
  "message": "Customer not found"
}
```

Atau bahkan HTML:

```html
<html><body>502 Bad Gateway</body></html>
```

Jangan parse semua response sebagai DTO success.

Buruk:

```java
CustomerDto dto = target.request().get(CustomerDto.class);
```

Untuk API penting, gunakan manual mapping:

```java
try (Response response = target.request(MediaType.APPLICATION_JSON_TYPE).get()) {
    int status = response.getStatus();
    MediaType mediaType = response.getMediaType();

    if (status == 200) {
        return response.readEntity(CustomerDto.class);
    }

    String errorBody = safeReadLimited(response, 8192);
    throw mapError(status, mediaType, errorBody);
}
```

`safeReadLimited` idealnya membatasi ukuran body yang dibaca/log.

---

## 47. Designing a Remote Error Contract

Internal exception sebaiknya menyimpan:

```java
public final class RemoteCallException extends RuntimeException {
    private final String remoteService;
    private final String operation;
    private final int status;
    private final String responseBodySnippet;
    private final String correlationId;
    private final boolean retryable;

    // constructor/getters
}
```

Namun jangan expose semua ke user response.

Internal log:

```text
remote=customer-api operation=get-customer status=503 retryable=true correlation=abc duration=721ms body=<truncated>
```

External API response:

```json
{
  "type": "https://example.com/problems/dependency-unavailable",
  "title": "Dependency temporarily unavailable",
  "status": 503,
  "correlationId": "abc"
}
```

---

## 48. Client Lifecycle in DI Containers

### HK2/Jersey server

Bind `Client` as singleton:

```java
bindFactory(CustomerClientFactory.class)
    .to(Client.class)
    .in(Singleton.class);
```

Tapi pastikan shutdown close.

### Spring

```java
@Bean(destroyMethod = "close")
public Client customerApiJerseyClient(CustomerApiProperties props) {
    return ClientBuilder.newBuilder()
        .connectTimeout(props.connectTimeout())
        .readTimeout(props.readTimeout())
        .register(JacksonFeature.class)
        .build();
}

@Bean
public WebTarget customerApiTarget(Client customerApiJerseyClient, CustomerApiProperties props) {
    return customerApiJerseyClient.target(props.baseUri());
}
```

### CDI

Gunakan producer dan disposer:

```java
@ApplicationScoped
public class CustomerClientProducer {
    @Produces
    @ApplicationScoped
    public Client customerClient() {
        return ClientBuilder.newBuilder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .build();
    }

    public void close(@Disposes Client client) {
        client.close();
    }
}
```

Prinsip:

```text
Client dibuat saat startup, direuse, dan ditutup saat shutdown.
```

---

## 49. Testing Jersey Client Adapter

Testing outbound adapter punya beberapa level.

### Level 1 — Unit test mapping logic

Mock `Response` atau pisahkan mapper:

```java
RemoteErrorMapper mapper = new RemoteErrorMapper();
```

Cocok untuk status/error mapping.

### Level 2 — Mock HTTP server

Gunakan mock HTTP server untuk menguji real Jersey Client:

```text
Test -> JerseyCustomerGateway -> Jersey Client -> Mock HTTP Server
```

Validasi:

- method;
- path;
- query;
- headers;
- body;
- timeout;
- response mapping;
- error body mapping;
- content type behavior.

### Level 3 — Contract test

Jika remote API punya OpenAPI/contract, validasi DTO compatibility.

### Level 4 — Failure test

Simulasikan:

- slow response;
- connection reset;
- 500 HTML body;
- malformed JSON;
- large response;
- 429;
- 401;
- wrong content type.

### Level 5 — Load/saturation test

Validasi:

- pool size;
- leak;
- timeout;
- p95/p99;
- behavior under remote slowness;
- retry amplification nanti di Part 14.

---

## 50. Production Client Wrapper Blueprint

Berikut blueprint minimal untuk production-style Jersey client wrapper.

```java
public final class RemoteApiClient implements AutoCloseable {
    private final String remoteName;
    private final Client client;
    private final WebTarget baseTarget;

    public RemoteApiClient(String remoteName, URI baseUri, Client client) {
        this.remoteName = remoteName;
        this.client = client;
        this.baseTarget = client.target(baseUri);
    }

    public <T> T get(
        String operation,
        String path,
        Map<String, Object> templates,
        GenericType<T> responseType
    ) {
        WebTarget target = baseTarget.path(path);
        for (Map.Entry<String, Object> entry : templates.entrySet()) {
            target = target.resolveTemplate(entry.getKey(), entry.getValue());
        }

        long start = System.nanoTime();
        try (Response response = target
            .request(MediaType.APPLICATION_JSON_TYPE)
            .property("remote.name", remoteName)
            .property("remote.operation", operation)
            .get()) {

            int status = response.getStatus();
            if (status >= 200 && status < 300) {
                return response.readEntity(responseType);
            }

            throw mapFailure(operation, response, start);
        } catch (ProcessingException ex) {
            throw mapProcessingFailure(operation, ex, start);
        }
    }

    private RuntimeException mapFailure(String operation, Response response, long start) {
        String body = safeReadBody(response);
        long durationNanos = System.nanoTime() - start;
        return new RemoteApiException(
            remoteName,
            operation,
            response.getStatus(),
            body,
            durationNanos
        );
    }

    private RuntimeException mapProcessingFailure(
        String operation,
        ProcessingException ex,
        long start
    ) {
        long durationNanos = System.nanoTime() - start;
        return new RemoteTransportException(remoteName, operation, durationNanos, ex);
    }

    private String safeReadBody(Response response) {
        if (!response.hasEntity()) {
            return "";
        }
        try {
            return response.readEntity(String.class);
        } catch (RuntimeException ex) {
            return "<unreadable-response-body>";
        }
    }

    @Override
    public void close() {
        client.close();
    }
}
```

Catatan:

- Ini blueprint, bukan final platform.
- Part 14 akan menambahkan retry/circuit breaker/bulkhead.
- Part 22 akan memperdalam observability.
- Part 27 akan memperdalam test harness.
- Part 32 akan menggabungkan semua sebagai platform module.

---

## 51. Anti-Pattern Catalogue

### Anti-pattern 1 — Membuat client per request

```java
ClientBuilder.newClient().target(url).request().get();
```

Dampak:

- connection reuse hilang;
- resource leak;
- overhead tinggi;
- shutdown sulit.

### Anti-pattern 2 — Tidak menutup response

```java
Response r = target.request().get();
throw new RuntimeException();
```

Dampak:

- connection pool leak;
- timeout cascade.

### Anti-pattern 3 — Semua non-2xx dianggap sama

```java
if (status != 200) throw new RuntimeException("failed");
```

Dampak:

- 404, 409, 429, 500, 503 kehilangan makna;
- retry salah;
- user error dan dependency error tercampur.

### Anti-pattern 4 — Timeout tidak dikonfigurasi

Dampak:

- thread tertahan;
- SLA rusak;
- incident sulit dikontrol.

### Anti-pattern 5 — Logging full request/response body

Dampak:

- PII leak;
- token leak;
- biaya log tinggi;
- memory pressure.

### Anti-pattern 6 — Menggunakan full URI sebagai metric tag

Dampak:

- high cardinality;
- metric backend overload;
- data sensitive bocor.

### Anti-pattern 7 — Shared cookie/session antar user

Dampak:

- security bug;
- user context tercampur;
- audit sulit.

### Anti-pattern 8 — Provider registry tidak konsisten

Dampak:

- server bisa serialize DTO, client tidak bisa;
- enum/date format mismatch;
- production only failure.

### Anti-pattern 9 — Retry di filter tanpa budget

Dampak:

- retry storm;
- duplicate command;
- latency meningkat;
- dependency makin down.

### Anti-pattern 10 — Mengembalikan `Response` ke layer bisnis

Dampak:

- HTTP concern bocor;
- lifecycle close tidak jelas;
- test sulit;
- domain logic tercampur transport.

---

## 52. Debugging Checklist

Saat Jersey Client bermasalah, jangan langsung menyimpulkan remote service down. Ikuti checklist:

### Step 1 — Request construction

- base URL benar?
- path benar?
- template resolved?
- query encoded benar?
- method benar?
- header benar?
- content type benar?
- accept header benar?

### Step 2 — Provider

- JSON provider registered?
- DTO bisa diserialize?
- generic type benar?
- media type cocok?
- `javax`/`jakarta` namespace cocok?

### Step 3 — Network

- DNS resolve?
- connect timeout?
- proxy?
- route/firewall/security group?
- TLS handshake?
- certificate?

### Step 4 — Connector/pool

- pool habis?
- response leak?
- max per route terlalu kecil?
- stale connection?
- idle timeout mismatch?

### Step 5 — Remote response

- status berapa?
- content type apa?
- body apa?
- error contract berubah?
- HTML error dari gateway?

### Step 6 — Deserialization

- field baru?
- enum baru?
- date format berubah?
- null unexpected?
- unknown properties behavior?

### Step 7 — Observability

- correlation ID terkirim?
- traceparent terkirim?
- remote log bisa dicari?
- client metric ada?
- duration terlihat?
- failure category jelas?

---

## 53. Mental Model Ringkas

Simpan model ini:

```text
ClientBuilder builds Client.
Client owns runtime configuration and lifecycle.
WebTarget represents URI and target-level config.
Invocation.Builder represents request metadata.
Entity carries outbound body and media type.
Connector sends bytes over network.
Provider converts Java object <-> bytes.
Filter modifies/observes request/response metadata.
Interceptor wraps entity read/write.
Response owns status, headers, and entity stream.
Response must be closed if manually handled.
```

Dan model failure ini:

```text
Not every client failure is an HTTP failure.
Not every HTTP error is a transport failure.
Not every timeout means remote service is down.
Not every deserialization failure means server is wrong.
Not every retry is safe.
```

---

## 54. Design Checklist untuk Production Jersey Client

Sebelum approve client adapter, cek:

```text
[ ] Client direuse, bukan dibuat per request.
[ ] Client ditutup saat shutdown.
[ ] Timeout connect/read dikonfigurasi.
[ ] Pool/connector strategy jelas.
[ ] Base URI externalized config.
[ ] JSON provider registered eksplisit.
[ ] ObjectMapper/JSON-B config konsisten.
[ ] Response manual selalu try-with-resources.
[ ] Non-2xx dimapping dengan taxonomy.
[ ] Error body dibaca aman, dibatasi, dan dimasking.
[ ] Correlation/trace propagation ada.
[ ] Token/header sensitive tidak dilog.
[ ] URI metric tidak high-cardinality.
[ ] Auth/token refresh lifecycle jelas.
[ ] Proxy/TLS config jelas bila diperlukan.
[ ] Generic response memakai GenericType.
[ ] Test mencakup 2xx, 4xx, 5xx, timeout, malformed JSON.
[ ] Classpath javax/jakarta tidak tercampur.
[ ] Java version dan connector compatibility diuji.
```

---

## 55. Mini Exercises

### Exercise 1 — Diagnose Connection Leak

Kamu melihat gejala:

```text
- p95 outbound latency naik perlahan
- error "timeout waiting for connection from pool"
- remote service log normal
- CPU aplikasi normal
- traffic error 4xx meningkat sebelum incident
```

Pertanyaan:

1. Apa hipotesis paling kuat?
2. Di mana cari bug di code?
3. Apa fix paling mungkin?

Jawaban yang diharapkan:

```text
Kemungkinan besar error path tidak menutup Response atau tidak membaca entity.
Cari code yang memanggil target.request().get() lalu throw exception sebelum close.
Fix dengan try-with-resources dan safe body read.
```

### Exercise 2 — Status Mapping

Remote API mengembalikan:

```text
200 success
404 customer not found
409 customer locked
429 rate limited
503 maintenance
```

Desain exception/result mapping yang membedakan:

- domain absence;
- concurrency/business conflict;
- retryable dependency condition;
- non-retryable client bug.

### Exercise 3 — Generic Type

Kenapa code ini buruk?

```java
List<CustomerDto> customers = target.request().get(List.class);
```

Perbaiki dengan `GenericType`.

### Exercise 4 — Header Propagation

Dari inbound request, header mana yang aman dipropagate ke remote service?

```text
Authorization
Cookie
X-Correlation-Id
traceparent
X-Forwarded-For
Idempotency-Key
```

Jawaban harus mempertimbangkan security boundary, bukan hanya teknis.

### Exercise 5 — Timeout Budget

Endpoint user-facing punya SLA 1500 ms. Ia memanggil dua remote service serial. Tentukan connect/read timeout awal yang masuk akal dan jelaskan reasoning.

---

## 56. Hubungan dengan Part Berikutnya

Part ini membahas Jersey Client sebagai runtime outbound dasar.

Namun production client tidak cukup hanya dengan timeout dan response mapping. Ia membutuhkan resilience:

- retry;
- backoff;
- jitter;
- circuit breaker;
- bulkhead;
- rate limiting;
- idempotency;
- cancellation;
- deadline propagation.

Itu akan dibahas di:

```text
Part 14 — Resilient Outbound Calls: Timeout, Retry, Circuit Breaker, Bulkhead, Idempotency
```

---

## 57. Status Seri

Progress saat ini:

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — selesai
Part 10 — selesai
Part 11 — selesai
Part 12 — selesai
Part 13 — selesai
Part 14 — berikutnya
...
Part 32 — target akhir / capstone
```

Seri **belum selesai**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./12-cdi-spring-and-jersey-integration-choosing-composition-model.md">⬅️ Part 12 — CDI, Spring, and Jersey Integration: Choosing the Composition Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./14-resilient-outbound-calls-timeout-retry-circuit-breaker-bulkhead-idempotency.md">Part 14 — Resilient Outbound Calls: Timeout, Retry, Circuit Breaker, Bulkhead, Idempotency ➡️</a>
</div>
