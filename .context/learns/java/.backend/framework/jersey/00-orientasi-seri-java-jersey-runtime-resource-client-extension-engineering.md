# Part 0 — Orientasi Seri Java Jersey: Scope, Mental Model, Versi, dan Cara Belajar

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> Target pembaca: Java engineer yang sudah memahami Java core, HTTP, Servlet, Jakarta/JAX-RS, JSON/XML, security, validation, observability, deployment, dan production troubleshooting.  
> Coverage Java: Java 8 sampai Java 25.  
> Coverage Jersey: Jersey 2.x, 3.x, 4.x, dengan fokus pada runtime behavior, extension point, deployment, client, dan production engineering.  
> Status seri: **belum selesai**. Ini adalah **Part 0 dari rencana 32 part**.

---

## 0.1. Kenapa Ada Part 0?

Part 0 bukan materi teknis Jersey yang langsung masuk ke `ResourceConfig`, `MessageBodyReader`, `ContainerRequestFilter`, atau Jersey Client. Part ini adalah **orientasi engineering**.

Tujuannya adalah membangun peta berpikir sebelum masuk ke detail.

Tanpa orientasi ini, belajar Jersey biasanya jatuh ke salah satu dari dua ekstrem:

1. **Terlalu dangkal**  
   Jersey dianggap hanya “framework untuk bikin REST API”. Akibatnya engineer hanya hafal `@Path`, `@GET`, `@POST`, `Response.ok()`, lalu bingung ketika production error terjadi: provider tidak ditemukan, `406`, `415`, stream body sudah consumed, mapper tidak jalan, injection gagal, connection leak, atau namespace `javax`/`jakarta` bentrok.

2. **Terlalu fragmentaris**  
   Engineer tahu banyak class Jersey secara terpisah, tetapi tidak punya mental model runtime. Ia tahu ada filter, interceptor, provider, binder, feature, client connector, tetapi tidak tahu kapan masing-masing dipilih, siapa yang membuat instance-nya, apa lifecycle-nya, bagaimana ordering-nya, dan bagaimana failure-nya terlihat di production.

Seri ini tidak akan mengikuti pola “tutorial endpoint CRUD”. Kita akan memperlakukan Jersey sebagai **HTTP runtime dan extension platform**.

---

## 0.2. Posisi Jersey di Ekosistem Java

Jersey adalah implementasi dari spesifikasi JAX-RS / Jakarta RESTful Web Services.

Mental model pertamanya:

```text
Specification        : JAX-RS / Jakarta RESTful Web Services
Implementation       : Jersey
Execution Container  : Servlet container, Grizzly, Jetty, JDK HTTP Server, Jakarta EE server, Spring Boot integration, dll.
Dependency System    : HK2, CDI, Spring, manual registration
Representation Layer : Jackson, JSON-B, JAXB, MOXy, custom MessageBodyReader/Writer
Outbound Client      : Jersey Client + connector provider
Production Surface   : logging, metrics, tracing, security, validation, timeout, deployment, migration
```

Jersey bukan hanya kumpulan annotation. Jersey adalah runtime yang melakukan pekerjaan berikut:

```text
HTTP request arrives
  -> container receives bytes
  -> Jersey container bridge receives request
  -> request context is created
  -> pre-matching filters may run
  -> resource matching happens
  -> post-matching filters run
  -> parameter binding happens
  -> entity body is read by MessageBodyReader
  -> resource method is invoked
  -> exception mapping may happen
  -> response entity is written by MessageBodyWriter
  -> response filters/interceptors run
  -> bytes are returned to container
```

Jersey Client memiliki pipeline sejenis di sisi outbound:

```text
application code builds request
  -> WebTarget / Invocation.Builder prepares invocation
  -> client request filters run
  -> entity body is written
  -> connector sends request
  -> remote response arrives
  -> client response filters run
  -> entity body is read
  -> caller receives response/domain object/error
```

Jadi, saat belajar Jersey, pertanyaan yang selalu harus diajukan adalah:

> “Di tahap pipeline mana behavior ini terjadi?”

Pertanyaan itu lebih kuat daripada sekadar:

> “Annotation apa yang harus saya pakai?”

---

## 0.3. Versi Besar yang Akan Dipakai

Seri ini membahas Java 8 sampai Java 25 dan Jersey lintas generasi. Karena itu versi harus dipahami sebagai **matriks kompatibilitas**, bukan hanya angka terbaru.

### 0.3.1. Generasi Namespace

Perubahan terbesar dalam ekosistem ini adalah migrasi dari `javax.*` ke `jakarta.*`.

```text
Jersey 2.x
  -> umumnya relevan untuk JAX-RS / javax.ws.rs
  -> banyak ditemukan di sistem Java EE legacy
  -> penting untuk Java 8/11 enterprise estate

Jersey 3.x
  -> menggunakan jakarta.ws.rs
  -> sejalan dengan Jakarta EE 9/10 era
  -> banyak dipakai untuk modernisasi dari javax ke jakarta

Jersey 4.x
  -> implementasi Jakarta REST 4.0
  -> bagian dari Jakarta EE 11 alignment
  -> relevan untuk platform modern yang bergerak ke Jakarta EE 11+
```

Catatan penting:

```text
javax.ws.rs.* dan jakarta.ws.rs.* bukan package yang kompatibel secara binary.
```

Artinya, ini bukan sekadar rename import di source code. Dampaknya bisa menyebar ke:

- servlet API,
- bean validation API,
- JSON binding,
- CDI,
- security API,
- application server,
- Maven dependency tree,
- transitive dependencies,
- test framework,
- generated code,
- platform libraries internal.

### 0.3.2. Matrix Ringkas

| Area | Legacy Track | Modern Track | Forward Track |
|---|---:|---:|---:|
| Java | 8 / 11 | 17 / 21 | 25 |
| REST API namespace | `javax.ws.rs` | `jakarta.ws.rs` | `jakarta.ws.rs` |
| Jersey family | 2.x | 3.x | 4.x |
| Enterprise context | Java EE / early Jakarta | Jakarta EE 9/10 | Jakarta EE 11+ |
| Migration risk | dependency conflict | namespace convergence | platform maturity & compatibility |

### 0.3.3. Cara Seri Ini Menangani Versi

Kita tidak akan menulis setiap materi dalam empat varian kode penuh untuk Java 8, Java 11, Java 21, dan Java 25. Itu tidak efisien.

Yang akan dilakukan:

1. **Konsep runtime dijelaskan sekali.**  
   Contoh: provider selection, filter ordering, entity stream lifecycle.

2. **Perbedaan versi disebut ketika berdampak nyata.**  
   Contoh: `javax` vs `jakarta`, module path, virtual threads, Java records, TLS defaults, HTTP client ecosystem, container support.

3. **Kode contoh dibuat dengan gaya yang mudah dimigrasikan.**  
   Kita menghindari style yang terlalu tergantung pada satu container kecuali sedang membahas deployment spesifik.

4. **Jika API berubah, akan ditandai.**  
   Misalnya: import package, dependency artifact, atau behavior yang berbeda antar Jersey 2/3/4.

---

## 0.4. Apa yang Tidak Akan Diulang

Karena seri sebelumnya sudah mencakup banyak fondasi, materi ini sengaja tidak mengulang panjang topik berikut:

- Java syntax dasar.
- Java collection, stream, concurrency, memory model.
- HTTP dasar: method, status code, header, content negotiation dasar.
- Servlet lifecycle dasar.
- JAX-RS annotation dasar seperti `@Path`, `@GET`, `@POST`, `@PUT`, `@DELETE`.
- JSON/XML dasar.
- Jackson dasar.
- Bean Validation dasar.
- Jakarta Security dasar.
- CDI dasar.
- Spring dasar.
- Maven/Gradle dasar.
- Docker/Kubernetes dasar.
- logging, tracing, metrics dasar.

Topik tersebut tetap mungkin muncul, tetapi hanya sebagai konteks untuk menjelaskan behavior Jersey yang lebih spesifik.

Contoh:

```java
@Path("/cases")
public class CaseResource {
    @GET
    public List<CaseSummaryDto> list() {
        return service.listCases();
    }
}
```

Seri ini tidak akan berhenti pada “ini endpoint GET”. Pertanyaan yang akan dibahas adalah:

- Bagaimana class ini ditemukan Jersey?
- Siapa yang membuat instance `CaseResource`?
- Apakah instance-nya per-request, singleton, atau dikontrol DI container?
- Kapan `service` diinjeksi?
- Bagaimana URI `/cases` di-resolve di balik servlet mapping dan reverse proxy?
- Provider mana yang menulis `List<CaseSummaryDto>` menjadi JSON?
- Apa yang terjadi kalau `CaseSummaryDto` punya lazy proxy, cyclic reference, atau field rahasia?
- Jika `service.listCases()` throw exception, mapper mana yang dipilih?
- Jika response besar, apakah seluruh entity dibuffer?
- Jika client disconnect, apa yang terjadi?
- Bagaimana latency endpoint ini diukur?
- Bagaimana endpoint ini dites supaya benar-benar melewati Jersey runtime?

Itulah level pembahasan seri ini.

---

## 0.5. Target Kompetensi Setelah Selesai Seri

Setelah menyelesaikan 32 part, targetnya bukan “bisa memakai Jersey”. Targetnya adalah memiliki **keluwesan engineering**.

Keluwesan berarti kamu bisa:

1. **Mendesain API boundary yang jelas**  
   Resource class tidak bocor menjadi business service, transaction script, atau dumping ground.

2. **Menjelaskan runtime behavior**  
   Kamu tahu request melewati tahap apa saja dari container sampai response.

3. **Men-debug masalah production**  
   Kamu bisa menelusuri `404`, `405`, `406`, `415`, injection failure, provider conflict, serialization failure, timeout, connection leak, dan memory issue secara sistematis.

4. **Membuat extension yang aman**  
   Kamu bisa membuat `Feature`, `DynamicFeature`, `ContainerRequestFilter`, `MessageBodyReader`, `ExceptionMapper`, custom binder, dan client filter tanpa menciptakan magic yang sulit dirawat.

5. **Memilih integration model**  
   Kamu tahu kapan memakai HK2 only, CDI, Spring integration, Servlet deployment, embedded Grizzly, atau Jakarta EE server.

6. **Mengelola outbound HTTP dengan benar**  
   Jersey Client tidak dipakai seperti utility stateless sekali pakai yang membuat connection leak dan timeout tak terkendali.

7. **Memahami migration risk**  
   Terutama migrasi Jersey 2 ke 3/4 dan migrasi `javax` ke `jakarta`.

8. **Menghubungkan framework dengan sistem enterprise**  
   Termasuk security, audit, validation, idempotency, observability, error contract, API compatibility, dan regulatory defensibility.

---

## 0.6. Cara Membaca Jersey: 8 Layer Mental Model

Untuk menjadi kuat di Jersey, kita perlu membagi Jersey menjadi delapan layer.

```text
Layer 1 — Bootstrap & Configuration
Layer 2 — Resource Model
Layer 3 — Request Matching
Layer 4 — Parameter & Entity Binding
Layer 5 — Invocation & Exception Mapping
Layer 6 — Filters, Interceptors, Providers
Layer 7 — Injection, Lifecycle, Extension
Layer 8 — Deployment, Client, Observability, Performance, Migration
```

Mari kita bahas satu per satu.

---

### Layer 1 — Bootstrap & Configuration

Pertanyaan utama:

> “Bagaimana aplikasi Jersey dibangun sebelum menerima request?”

Objek penting:

- `Application`
- `ResourceConfig`
- `Feature`
- `DynamicFeature`
- provider registration
- package scanning
- class registration
- instance registration
- configuration properties

Hal yang sering salah:

```text
Engineer menganggap jika class diberi annotation @Path atau @Provider, otomatis semuanya pasti ditemukan.
```

Dalam production, auto-scanning sering menjadi sumber ketidakpastian:

- class tidak masuk package scan,
- provider tidak ter-register,
- dependency transitive membawa provider lain,
- urutan discovery berubah,
- test environment berbeda dengan production,
- fat jar/shaded jar memengaruhi metadata,
- Jakarta namespace tidak cocok.

Pendekatan enterprise lebih sering membutuhkan registration yang eksplisit.

Contoh mental model:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(CaseResource.class);
        register(ProblemExceptionMapper.class);
        register(CorrelationIdFilter.class);
        register(JsonFeature.class);
        property("jersey.config.server.tracing.type", "OFF");
    }
}
```

Ini bukan sekadar style. Ini adalah cara membuat startup graph menjadi eksplisit.

---

### Layer 2 — Resource Model

Pertanyaan utama:

> “Bagaimana Jersey memahami class resource saya?”

Jersey tidak hanya memanggil method berdasarkan annotation. Jersey membangun model resource:

```text
Resource class
  -> root path
  -> resource methods
  -> sub-resource locators
  -> HTTP method annotations
  -> consumed media types
  -> produced media types
  -> parameter model
  -> name bindings
  -> validation metadata
```

Kesalahan umum:

```java
@Path("/cases")
public class CaseResource {
    @GET
    @Path("/{id}")
    public CaseDetailDto get(@PathParam("id") String id) { ... }

    @GET
    @Path("/{status}")
    public List<CaseSummaryDto> byStatus(@PathParam("status") String status) { ... }
}
```

Secara manusia, mungkin kamu tahu `id` dan `status` berbeda. Namun secara URI template, keduanya sama-sama satu path segment dinamis. Ini bisa menciptakan ambiguity atau routing yang tidak jelas.

Resource model harus didesain sebagai **routing graph**.

Better thinking:

```text
GET /cases/{caseId}
GET /cases?status=OPEN
GET /cases/statuses/{status}/cases       # jika memang butuh nested resource eksplisit
```

Resource design bukan sekadar estetika URL. Ia menentukan:

- diagnosability,
- compatibility,
- ambiguity,
- security boundary,
- cacheability,
- audit event classification.

---

### Layer 3 — Request Matching

Pertanyaan utama:

> “Kenapa request ini masuk ke method itu, atau tidak masuk ke mana pun?”

Request matching melibatkan beberapa dimensi:

```text
URI path
HTTP method
Content-Type
Accept
@Path template
@Consumes
@Produces
sub-resource locator
method specificity
```

Contoh failure:

```http
POST /cases
Content-Type: text/plain
Accept: application/json
```

Resource:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public CaseCreatedResponse create(CreateCaseRequest request) { ... }
```

Endpoint terlihat ada. Namun request bisa gagal dengan `415 Unsupported Media Type` karena `Content-Type` tidak cocok.

Contoh lain:

```http
GET /cases/123
Accept: application/xml
```

Jika resource hanya `@Produces(application/json)`, request bisa gagal dengan `406 Not Acceptable`.

Engineer top-tier tidak hanya bertanya:

> “Kenapa method saya tidak kepanggil?”

Tapi memecahnya:

```text
1. Apakah servlet mapping benar?
2. Apakah application path benar?
3. Apakah root resource cocok?
4. Apakah method path cocok?
5. Apakah HTTP method cocok?
6. Apakah Content-Type cocok dengan @Consumes?
7. Apakah Accept cocok dengan @Produces?
8. Apakah ada filter pre-matching yang mengubah request?
9. Apakah exception terjadi sebelum invocation?
```

---

### Layer 4 — Parameter & Entity Binding

Pertanyaan utama:

> “Bagaimana data HTTP berubah menjadi object Java?”

Ada dua jalur besar:

```text
Parameter binding
  -> @PathParam
  -> @QueryParam
  -> @HeaderParam
  -> @CookieParam
  -> @MatrixParam
  -> @FormParam
  -> @BeanParam
  -> ParamConverter

Entity binding
  -> request body InputStream
  -> MessageBodyReader
  -> Java object
```

Keduanya berbeda dan punya failure mode berbeda.

Contoh parameter binding trap:

```java
@GET
public List<CaseDto> search(@QueryParam("page") int page) { ... }
```

Jika `page` tidak dikirim, primitive `int` dapat bernilai default `0`. Ini bisa terlihat normal, padahal secara contract mungkin `page` wajib atau default-nya harus `1`.

Better:

```java
@GET
public List<CaseDto> search(@QueryParam("page") Integer page) {
    int effectivePage = page == null ? 1 : page;
    ...
}
```

Atau gunakan request parameter object:

```java
public final class CaseSearchParams {
    @QueryParam("page")
    private Integer page;

    @QueryParam("status")
    private String status;
}
```

Entity binding trap:

```java
@POST
public Response create(CreateCaseRequest request) { ... }
```

Request body terlihat sederhana, tetapi di belakangnya ada provider selection:

```text
Content-Type: application/json
  -> find MessageBodyReader<CreateCaseRequest>
  -> check media type compatibility
  -> check generic type
  -> read InputStream
  -> deserialize JSON
  -> maybe validate
  -> pass object to resource method
```

Jika provider tidak ditemukan, resource method tidak pernah dipanggil.

---

### Layer 5 — Invocation & Exception Mapping

Pertanyaan utama:

> “Apa yang terjadi ketika resource method dipanggil atau gagal?”

Invocation bukan hanya `method.invoke()` dalam arti sederhana. Ada konteks:

- request scope,
- injection,
- filters/interceptors,
- validation,
- security,
- exception mapping,
- response writing.

Exception mapping sangat penting karena production API harus punya error contract.

Contoh buruk:

```json
{
  "error": "java.lang.NullPointerException"
}
```

Contoh lebih defendable:

```json
{
  "type": "https://api.example.com/problems/internal-error",
  "title": "Internal server error",
  "status": 500,
  "code": "CASE-500-001",
  "correlationId": "f6de2c7d0d0b4a52",
  "message": "The request could not be completed. Please contact support with the correlation id."
}
```

Mapper architecture harus membedakan:

```text
Client fault        -> 400, 404, 409, 412, 415, 422
Authentication      -> 401
Authorization       -> 403
Validation          -> 400 / 422 depending on policy
Concurrency conflict-> 409 / 412
Dependency failure  -> 502 / 503 / 504
Unexpected failure  -> 500
```

Top-tier engineer tidak membuat satu generic `ExceptionMapper<Throwable>` lalu menyembunyikan semua sinyal. Generic mapper boleh ada sebagai fallback, tetapi mapper spesifik harus menjaga semantic error.

---

### Layer 6 — Filters, Interceptors, Providers

Pertanyaan utama:

> “Bagian cross-cutting concern mana yang harus masuk filter, interceptor, atau provider?”

Perbedaan kasar:

```text
ContainerRequestFilter
  -> bekerja pada request metadata/context
  -> cocok untuk auth, correlation id, idempotency key, request metadata validation

ContainerResponseFilter
  -> bekerja pada response metadata/context
  -> cocok untuk response header, security header, correlation id response

ReaderInterceptor
  -> membungkus proses membaca request entity
  -> cocok untuk compression, encryption, body wrapping, controlled body logging

WriterInterceptor
  -> membungkus proses menulis response entity
  -> cocok untuk compression, signing, response wrapping tertentu

MessageBodyReader / Writer
  -> mengubah bytes <-> Java object
  -> cocok untuk custom media type atau format khusus

ExceptionMapper
  -> exception -> response
  -> cocok untuk error contract
```

Kesalahan umum:

```text
Semua hal dimasukkan ke filter.
```

Akibatnya:

- request body dibaca terlalu awal,
- stream habis sebelum `MessageBodyReader`,
- response entity dimodifikasi di tempat yang salah,
- sensitive payload ter-log,
- ordering kacau,
- error mapping tidak konsisten.

Rule of thumb:

```text
Metadata concern       -> filter
Entity stream concern  -> interceptor
Serialization concern  -> MessageBodyReader/Writer
Error shape concern    -> ExceptionMapper
Feature registration   -> Feature/DynamicFeature
Dependency binding     -> Binder/HK2/CDI/Spring
```

---

### Layer 7 — Injection, Lifecycle, Extension

Pertanyaan utama:

> “Siapa yang membuat object, kapan object dibuat, dan berapa lama object hidup?”

Ini salah satu area Jersey yang sering diremehkan.

Resource class bisa dibuat oleh:

- Jersey/HK2,
- CDI container,
- Spring container,
- manual instance registration.

Provider/filter/mapper juga punya lifecycle. Jika kamu salah memahami lifecycle, kamu bisa menciptakan bug seperti:

- request-specific state tersimpan di singleton,
- non-thread-safe object dipakai bersama,
- dependency tidak ter-inject karena ownership container berbeda,
- `@Context` dipakai di object yang dibuat manual di luar Jersey,
- transaction/security proxy tidak aktif,
- memory leak karena singleton menyimpan request object.

Contoh bahaya:

```java
@Singleton
public class AuditFilter implements ContainerRequestFilter {
    private String currentUser; // salah: shared mutable state

    @Override
    public void filter(ContainerRequestContext requestContext) {
        this.currentUser = requestContext.getSecurityContext().getUserPrincipal().getName();
    }
}
```

Filter singleton akan dipakai banyak request. Field `currentUser` bisa tertukar antar request.

Better:

```java
public class AuditFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        String currentUser = requestContext.getSecurityContext()
            .getUserPrincipal()
            .getName();

        requestContext.setProperty("currentUser", currentUser);
    }
}
```

Atau gunakan request-scoped context yang benar.

---

### Layer 8 — Deployment, Client, Observability, Performance, Migration

Pertanyaan utama:

> “Bagaimana Jersey berperilaku sebagai bagian dari sistem production?”

Di production, Jersey tidak berdiri sendiri. Ia hidup di dalam:

```text
load balancer
  -> API gateway / reverse proxy
  -> servlet container / embedded server
  -> Jersey runtime
  -> DI container
  -> service layer
  -> database / queue / external API
  -> logging/metrics/tracing system
```

Karena itu masalah Jersey sering terlihat sebagai masalah lain:

- `404` karena proxy path rewrite salah,
- `Location` header salah karena base URI tidak sadar `X-Forwarded-*`,
- latency tinggi karena JSON serialization,
- thread pool habis karena outbound client timeout tidak diatur,
- memory naik karena response besar dibuffer,
- API tampak lambat karena client connection pool exhausted,
- `ClassNotFoundException` karena `javax`/`jakarta` campur,
- request log hilang correlation id karena MDC tidak dipropagasi,
- test hijau karena tidak melewati Jersey runtime.

Top-tier Jersey engineer harus bisa berpikir lintas boundary.

---

## 0.7. Jersey Dibandingkan dengan Spring MVC dan JAX-RS Lain

Ini penting bukan untuk fanboying framework, tetapi untuk memahami desain.

### 0.7.1. Jersey vs Spring MVC

| Dimensi | Jersey | Spring MVC |
|---|---|---|
| Filosofi | Implementasi JAX-RS/Jakarta REST | Web framework bagian dari Spring ecosystem |
| Primary contract | Spec-driven REST API | Spring programming model |
| Injection default | HK2/Jersey, bisa CDI/Spring | Spring IoC |
| Extension model | Provider/filter/interceptor/feature | HandlerMapping, HandlerAdapter, Interceptor, Advice, Converter |
| Client | Jersey Client | RestTemplate/WebClient/RestClient |
| Cocok untuk | Jakarta/JAX-RS ecosystem, spec portability, custom provider pipeline | Spring-centric apps, integrated ecosystem |
| Risiko | DI ownership bisa membingungkan | Spring abstraction bisa menyembunyikan HTTP/runtime detail |

Jersey lebih terasa sebagai **runtime spesifikasi**. Spring MVC lebih terasa sebagai **application framework**.

### 0.7.2. Jersey vs RESTEasy

Keduanya implementasi JAX-RS/Jakarta REST. Perbedaannya lebih banyak di:

- extension API,
- container integration,
- provider behavior,
- client implementation,
- dependency ecosystem,
- application server default.

Seri ini tidak membandingkan RESTEasy secara panjang, tetapi mindset-nya penting:

```text
Spec behavior portable.
Implementation extension tidak selalu portable.
```

Jika kamu memakai Jersey-specific feature, itu valid, tetapi harus sadar bahwa portability ke implementasi lain menurun.

---

## 0.8. Scope Engineering: Apa yang Akan Dipelajari

Seri ini akan mendalami area berikut.

### 0.8.1. Server Runtime

- Application bootstrap.
- Resource model.
- Request matching.
- Parameter binding.
- Entity provider pipeline.
- Response construction.
- Exception mapping.
- Filters and interceptors.
- Security context.
- Validation.
- Async processing.
- SSE and streaming.
- Multipart/file handling.

### 0.8.2. Client Runtime

- Jersey Client lifecycle.
- Connector provider.
- Timeout.
- Pooling.
- TLS.
- Proxy.
- Filters.
- Entity provider.
- Error mapping.
- Retry/circuit breaker integration.
- Correlation propagation.

### 0.8.3. Composition and Extension

- HK2 binding.
- CDI integration.
- Spring integration.
- Custom injection.
- Feature.
- DynamicFeature.
- Name binding.
- Provider design.
- Internal platform module.

### 0.8.4. Production Engineering

- Observability.
- Metrics.
- Tracing.
- Logging and masking.
- Performance.
- Memory.
- Threading.
- Virtual threads.
- Deployment.
- Configuration.
- Testing.
- Migration.
- Failure modes.

### 0.8.5. Architecture

- Jersey as HTTP adapter.
- Resource boundary.
- DTO boundary.
- Command/query separation.
- Audit boundary.
- Authorization boundary.
- Idempotency boundary.
- Regulatory defensibility.

---

## 0.9. Scope yang Tidak Akan Menjadi Fokus Utama

Agar seri tetap tajam, beberapa hal tidak menjadi fokus utama:

1. **Membangun full CRUD app dari nol**  
   Kita akan memakai contoh kode, tetapi bukan tutorial CRUD generik.

2. **Mengajarkan REST dari dasar**  
   REST semantics hanya dibahas ketika berdampak pada Jersey behavior.

3. **Membahas Spring Boot secara dominan**  
   Spring Boot + Jersey akan dibahas, tetapi bukan menggantikan fokus Jersey.

4. **Mengajarkan Jackson dari nol**  
   Jackson dibahas sebagai provider dan production serialization strategy.

5. **Mengajarkan Kubernetes dari nol**  
   Deployment dibahas dari sisi konsekuensi ke Jersey.

6. **Membuat semua contoh kompatibel 100% dengan semua versi**  
   Kita akan memberi catatan versi, tetapi tidak semua contoh perlu punya varian `javax` dan `jakarta` sekaligus.

---

## 0.10. Prinsip Desain yang Akan Dipakai Sepanjang Seri

### Prinsip 1 — Resource Bukan Service Layer

Resource class adalah adapter HTTP.

Ia bertugas:

- menerima request,
- membaca identity/context,
- memvalidasi boundary dasar,
- memanggil application service,
- mengubah result menjadi response,
- membiarkan mapper/filter/provider menangani cross-cutting behavior.

Resource class tidak ideal jika berisi:

- query SQL panjang,
- orchestration domain kompleks,
- transaction manual,
- retry outbound kompleks,
- audit formatting detail,
- JSON serialization trick,
- security decision rumit yang tersebar.

Bad direction:

```java
@Path("/cases")
public class CaseResource {
    @POST
    public Response create(CreateCaseRequest request) {
        // validate manually 50 lines
        // check roles manually 30 lines
        // open transaction
        // call repository A/B/C
        // call external service
        // write audit
        // build JSON manually
        // catch all exceptions
    }
}
```

Better direction:

```java
@Path("/cases")
public class CaseResource {
    private final CaseApplicationService service;

    @POST
    public Response create(CreateCaseRequest request, @Context SecurityContext security) {
        CreateCaseCommand command = mapper.toCommand(request, security);
        CaseCreated result = service.create(command);

        return Response
            .created(uriInfo.getAbsolutePathBuilder().path(result.caseId()).build())
            .entity(mapper.toResponse(result))
            .build();
    }
}
```

### Prinsip 2 — Runtime Behavior Harus Eksplisit

Auto-discovery nyaman, tetapi production-grade system perlu determinisme.

Preferensi seri ini:

```text
Explicit registration > magical scanning
Explicit provider > accidental provider
Explicit error contract > ad-hoc exception response
Explicit timeout > default behavior
Explicit ownership > mixed DI confusion
```

### Prinsip 3 — Cross-Cutting Concern Harus Ditempatkan di Layer yang Benar

Contoh:

| Concern | Tempat yang Biasanya Tepat |
|---|---|
| Correlation ID | request/response filter |
| Authentication token parsing | request filter/security integration |
| Authorization policy | security layer/service policy, bisa didukung annotation/filter |
| Request body parsing | MessageBodyReader |
| Response body writing | MessageBodyWriter |
| Compression/signature | reader/writer interceptor |
| Error contract | ExceptionMapper |
| Metrics | filter/listener/interceptor depending granularity |
| Dependency binding | HK2/CDI/Spring config |
| Conditional registration | Feature/DynamicFeature |

### Prinsip 4 — HTTP Semantics Bukan Dekorasi

Status code, header, cache, conditional request, media type, idempotency, dan content negotiation adalah bagian dari contract.

Jangan treat HTTP hanya sebagai tunnel untuk JSON.

### Prinsip 5 — Failure Mode Harus Didesain, Bukan Baru Dipikirkan Saat Incident

Setiap fitur Jersey punya failure mode:

- filter bisa salah order,
- provider bisa konflik,
- mapper bisa shadowing,
- client bisa leak,
- stream bisa consumed,
- singleton bisa menyimpan state,
- async bisa menggantung,
- multipart bisa menghabiskan disk,
- SSE bisa bocor koneksi,
- migration bisa merusak binary compatibility.

Seri ini akan selalu menyertakan failure thinking.

---

## 0.11. Peta 32 Part Seri

Rencana seri final:

```text
Part 0  — Orientasi Seri Java Jersey: Scope, Mental Model, Versi, dan Cara Belajar
Part 1  — Jersey Mental Model: Spec, Implementation, Runtime, and Engineering Boundary
Part 2  — Jersey Application Bootstrap: ResourceConfig, Application, Auto Discovery, and Startup Graph
Part 3  — Resource Model Internals: How Jersey Understands Resource Classes
Part 4  — Request Matching Deep Dive: URI Matching, Method Selection, Media Negotiation
Part 5  — Parameter Injection Semantics: Path, Query, Header, Cookie, Matrix, BeanParam
Part 6  — Entity Provider Pipeline: MessageBodyReader, MessageBodyWriter, and Provider Selection
Part 7  — JSON in Jersey: Jackson, JSON-B, MOXy, and Production Serialization Strategy
Part 8  — Response Engineering: Status, Headers, Entities, Streaming, Caching, Conditional Requests
Part 9  — Exception Mapping Architecture: Failure Taxonomy, Mapper Resolution, and Error Contracts
Part 10 — Filters and Interceptors: Request/Response Pipeline Control
Part 11 — Jersey Injection Model: HK2, Binder, Factories, Scopes, and Lifecycle
Part 12 — CDI, Spring, and Jersey Integration: Choosing the Composition Model
Part 13 — Jersey Client Deep Dive: Invocation Pipeline, Connectors, Providers, and Configuration
Part 14 — Resilient Outbound Calls: Timeout, Retry, Circuit Breaker, Bulkhead, Idempotency
Part 15 — Async Server Processing: AsyncResponse, Suspension, Timeout, Cancellation
Part 16 — Server-Sent Events and Streaming APIs with Jersey
Part 17 — Multipart, File Upload, Download, and Large Payload Engineering
Part 18 — Security Integration: Authentication, Authorization, Principal, Roles, and Context
Part 19 — Validation Strategy: Bean Validation, Request Contract, Group, and Error Shape
Part 20 — API Versioning and Compatibility with Jersey
Part 21 — Hypermedia, Links, URI Building, and REST Maturity Pragmatism
Part 22 — Observability in Jersey: Logs, Metrics, Traces, Correlation, and Profiling
Part 23 — Performance Model: Threading, Allocation, Serialization, IO, and Provider Cost
Part 24 — Virtual Threads, Modern Java, and Jersey Runtime Compatibility Thinking
Part 25 — Deployment Models: Servlet Container, Grizzly, Embedded, Jakarta EE Server, Spring Boot
Part 26 — Configuration Engineering: Properties, Environments, Features, and Runtime Flags
Part 27 — Testing Jersey Applications: Unit, In-Memory, Container, Contract, and Failure Tests
Part 28 — Extension Engineering: Feature, DynamicFeature, Binder, Provider, and SPI Design
Part 29 — Migration Engineering: Jersey 2 to 3 to 4, javax to jakarta, Java 8 to 25
Part 30 — Production Failure Modes: Debugging Real Jersey Incidents
Part 31 — Architecture Patterns: Jersey as API Boundary in Enterprise Systems
Part 32 — Capstone: Building a Production-Grade Jersey Platform Module
```

Part 0 ini adalah orientasi. Part terakhir adalah Part 32, jadi seri **belum mencapai bagian terakhir**.

---

## 0.12. Cara Membaca Tiap Part Nanti

Setiap part akan memakai format konsisten:

```text
1. Problem statement
2. Mental model
3. Runtime flow
4. API/classes penting
5. Step-by-step implementation
6. Failure modes
7. Production trade-offs
8. Java 8–25 considerations
9. Design checklist
10. Review questions / exercises
```

Penjelasan tiap bagian:

### 1. Problem Statement

Bagian ini menjawab:

> “Masalah engineering apa yang sedang kita selesaikan?”

Contoh:

- Part 6 bukan sekadar “cara membuat MessageBodyReader”.
- Problem-nya adalah: bagaimana bytes dari HTTP request dipilih, dibaca, diubah menjadi object Java, divalidasi, dan gagal secara terkontrol.

### 2. Mental Model

Bagian ini membangun model sederhana yang bisa dipakai untuk reasoning.

Contoh untuk provider:

```text
Media type + Java type + annotations + provider priority -> selected reader/writer
```

### 3. Runtime Flow

Bagian ini menelusuri sequence.

Contoh:

```text
Content-Type received
  -> Jersey checks candidate MessageBodyReader
  -> media type compatibility evaluated
  -> generic type evaluated
  -> selected provider reads InputStream
  -> exception may be mapped
```

### 4. API/Classes Penting

Bagian ini menjelaskan class dan interface penting, bukan sebagai daftar hafalan, tetapi berdasarkan peran.

### 5. Step-by-Step Implementation

Bagian ini memberi contoh implementasi bertahap.

### 6. Failure Modes

Bagian ini menjawab:

> “Bagaimana ini biasanya rusak di production?”

### 7. Production Trade-Offs

Bagian ini membahas konsekuensi:

- performance,
- security,
- observability,
- maintainability,
- compatibility,
- operational risk.

### 8. Java 8–25 Considerations

Bagian ini menandai dampak versi Java.

Contoh:

- Java 8: legacy baseline, no records, no virtual threads.
- Java 11: banyak enterprise migration baseline.
- Java 17: modern LTS baseline.
- Java 21: virtual threads available, tetapi container/runtime support tetap perlu diperiksa.
- Java 25: LTS terbaru dari banyak vendor, relevan untuk forward planning.

### 9. Design Checklist

Checklist singkat untuk dipakai saat design/review.

### 10. Review Questions / Exercises

Pertanyaan untuk memastikan bukan hanya hafal syntax.

---

## 0.13. Standard Contoh Domain yang Akan Dipakai

Agar contoh konsisten dan tidak terus berganti domain, seri ini akan memakai beberapa domain contoh.

### 0.13.1. Case Management API

Domain utama:

```text
Case
Case Submission
Case Assignment
Case Review
Case Decision
Case Document
Case Audit Trail
Case Comment
Case Status Transition
```

Kenapa domain ini cocok?

Karena ia punya karakteristik enterprise nyata:

- role-based access,
- workflow/state transition,
- audit trail,
- document upload,
- long-running process,
- search and pagination,
- export,
- external integration,
- regulatory accountability.

### 0.13.2. External Registry Client

Untuk Jersey Client, kita pakai contoh:

```text
ExternalPartyRegistryClient
AddressLookupClient
DocumentVerificationClient
NotificationGatewayClient
```

Ini cocok untuk membahas:

- timeout,
- retry,
- circuit breaker,
- correlation propagation,
- error mapping,
- TLS,
- proxy,
- response closing,
- client lifecycle.

### 0.13.3. Platform Module

Untuk extension/capstone, kita akan membangun konsep:

```text
company-jersey-platform
  -> correlation
  -> problem error contract
  -> security context adapter
  -> audit hook
  -> request logging with masking
  -> JSON provider config
  -> client factory
  -> test utilities
```

Ini membantu melihat Jersey bukan sebagai per-project utility, tetapi sebagai reusable engineering platform.

---

## 0.14. Baseline Project Shapes

Seri ini akan memakai beberapa bentuk project.

### 0.14.1. Jakarta Namespace Shape

Untuk Jersey 3/4 style:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
```

### 0.14.2. Javax Namespace Shape

Untuk Jersey 2 style:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
```

### 0.14.3. Maven Dependency Shape: Jersey 2.x Conceptual

```xml
<dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet-core</artifactId>
    <version>${jersey.version}</version>
</dependency>

<dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Untuk JSON Jackson:

```xml
<dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

### 0.14.4. Maven Dependency Shape: Jersey 3/4 Conceptual

Artifact group masih sering berada di `org.glassfish.jersey.*`, tetapi API namespace menjadi `jakarta.*`.

```xml
<dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet-core</artifactId>
    <version>${jersey.version}</version>
</dependency>

<dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

API Jakarta REST dapat hadir dari platform/server atau dependency eksplisit, tergantung deployment model.

Contoh conceptual dependency API:

```xml
<dependency>
    <groupId>jakarta.ws.rs</groupId>
    <artifactId>jakarta.ws.rs-api</artifactId>
    <version>4.0.0</version>
    <scope>provided</scope>
</dependency>
```

Catatan:

```text
Jangan mencampur dependency javax.ws.rs dan jakarta.ws.rs sembarangan.
```

Itu bisa menghasilkan:

- compile berhasil tapi runtime gagal,
- `ClassCastException`,
- `NoSuchMethodError`,
- provider tidak terdeteksi,
- annotation tidak dibaca karena package berbeda,
- resource terlihat benar tapi tidak masuk model Jersey yang aktif.

---

## 0.15. Baseline Coding Style Seri Ini

Kita akan cenderung memakai gaya berikut.

### 0.15.1. Resource Tipis

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CaseResource {
    private final CaseApplicationService service;
    private final CaseRepresentationMapper mapper;

    public CaseResource(
            CaseApplicationService service,
            CaseRepresentationMapper mapper
    ) {
        this.service = service;
        this.mapper = mapper;
    }

    @POST
    public Response create(CreateCaseRequest request, @Context UriInfo uriInfo) {
        CaseCreated created = service.create(mapper.toCommand(request));

        URI location = uriInfo
                .getAbsolutePathBuilder()
                .path(created.caseId())
                .build();

        return Response.created(location)
                .entity(mapper.toCreatedResponse(created))
                .build();
    }
}
```

Catatan:

- Resource bertugas sebagai adapter.
- Service mengandung use case.
- Mapper memisahkan HTTP DTO dari domain/application model.
- `Response.created()` menjaga semantic `201 Created`.

### 0.15.2. Error Contract Konsisten

```java
public final class ProblemResponse {
    public String type;
    public String title;
    public int status;
    public String code;
    public String message;
    public String correlationId;
}
```

Kita tidak akan mengikat diri 100% pada RFC 7807, tetapi akan memakai problem-style response karena cocok untuk API enterprise.

### 0.15.3. Explicit Registration

```java
public final class CaseApiApplication extends ResourceConfig {
    public CaseApiApplication() {
        register(CaseResource.class);
        register(CorrelationIdFilter.class);
        register(ProblemExceptionMapper.class);
        register(ValidationExceptionMapper.class);
        register(JacksonFeature.class);
    }
}
```

### 0.15.4. Client Reuse

```java
public final class ExternalRegistryClient implements AutoCloseable {
    private final Client client;
    private final WebTarget baseTarget;

    public ExternalRegistryClient(Client client, URI baseUri) {
        this.client = client;
        this.baseTarget = client.target(baseUri);
    }

    public RegistryParty getParty(String partyId) {
        Response response = baseTarget
                .path("/parties/{partyId}")
                .resolveTemplate("partyId", partyId)
                .request(MediaType.APPLICATION_JSON_TYPE)
                .get();

        try {
            if (response.getStatus() == 404) {
                throw new PartyNotFoundException(partyId);
            }
            if (response.getStatusInfo().getFamily() != Response.Status.Family.SUCCESSFUL) {
                throw new RegistryClientException(response.getStatus());
            }
            return response.readEntity(RegistryParty.class);
        } finally {
            response.close();
        }
    }

    @Override
    public void close() {
        client.close();
    }
}
```

Catatan:

- `Client` tidak dibuat per request.
- `Response` harus ditutup jika tidak memakai try-with-resources atau langsung read entity dengan lifecycle yang jelas.
- Timeout/pooling akan dibahas detail di part client.

---

## 0.16. Minimal Vocabulary yang Perlu Konsisten

Seri ini akan memakai istilah berikut.

| Istilah | Arti dalam seri ini |
|---|---|
| Resource | Class/method yang menjadi HTTP entrypoint JAX-RS/Jersey |
| Provider | Komponen yang menyediakan behavior runtime, misalnya body reader/writer, mapper, filter |
| Entity | Body request/response, bukan JPA entity |
| Representation | Bentuk data yang dikirim lewat HTTP, misalnya JSON/XML/file |
| DTO | Object boundary untuk request/response |
| Application service | Use case service di belakang resource |
| Domain model | Model bisnis/internal, bukan objek HTTP |
| Filter | Komponen untuk request/response metadata/context pipeline |
| Interceptor | Komponen untuk membungkus read/write entity stream |
| Mapper | Bisa berarti DTO mapper atau exception mapper; konteks akan diperjelas |
| Connector | Implementasi transport Jersey Client |
| Runtime | Proses Jersey ketika bootstrap/request/client invocation berjalan |
| Container | Servlet/Grizzly/Jetty/Jakarta EE server yang menjalankan Jersey |

Penting: kata **entity** di JAX-RS/Jersey sering berarti HTTP body. Jangan otomatis menganggapnya JPA entity.

---

## 0.17. Common Misconceptions yang Akan Kita Bongkar

### Misconception 1 — “Jersey hanya JAX-RS annotation”

Salah. Annotation adalah input metadata. Jersey runtime yang membangun model, memilih method, menjalankan provider, mengatur context, dan menulis response.

### Misconception 2 — “Kalau pakai Jersey, semua otomatis portable”

Sebagian behavior JAX-RS/Jakarta REST portable. Tetapi Jersey-specific APIs seperti `ResourceConfig`, HK2 binding, monitoring extension, atau beberapa connector behavior tidak otomatis portable ke RESTEasy/CXF.

### Misconception 3 — “Filter bisa dipakai untuk semua cross-cutting concern”

Tidak. Body transformation lebih cocok ke interceptor/provider. Error response ke exception mapper. Registration logic ke feature. Binding ke DI configuration.

### Misconception 4 — “Resource boleh singleton supaya cepat”

Belum tentu. Singleton resource bisa valid, tetapi harus thread-safe dan tidak menyimpan request state. Banyak bug subtle lahir dari singleton yang menyimpan mutable field.

### Misconception 5 — “Jersey Client boleh dibuat setiap request”

Secara teknis bisa, secara production sering buruk. Client biasanya membawa resource seperti connector, pool, configuration, provider registry. Membuat dan menutup sembarangan dapat menyebabkan overhead dan leak.

### Misconception 6 — “406/415 adalah bug JSON”

Sering kali bukan bug JSON, tetapi content negotiation atau media type mismatch.

### Misconception 7 — “javax ke jakarta hanya rename import”

Tidak. Itu boundary ekosistem dan binary compatibility. Transitive dependency harus selaras.

### Misconception 8 — “Async selalu lebih scalable”

Tidak. Async bisa membantu jika bottleneck-nya thread blocking tertentu dan resource dikontrol. Tetapi async juga bisa memperumit cancellation, context propagation, timeout, memory, dan back-pressure.

### Misconception 9 — “Observability bisa ditambahkan nanti”

Bisa, tetapi mahal. Filter, mapper, client, correlation, MDC, dan metrics harus didesain sebagai bagian dari platform sejak awal.

### Misconception 10 — “Test resource method langsung sudah cukup”

Tidak selalu. Banyak bug Jersey terjadi sebelum method dipanggil atau sesudah method return: matching, provider selection, filters, interceptors, mapper, serialization.

---

## 0.18. Failure-First Thinking

Setiap part akan memakai pola failure-first.

Contoh saat belajar `MessageBodyReader`:

Jangan hanya bertanya:

> “Bagaimana membuat custom reader?”

Tanya juga:

```text
1. Kapan reader dipilih?
2. Apa yang terjadi jika Content-Type tidak cocok?
3. Apa yang terjadi jika generic type tidak cocok?
4. Apa yang terjadi jika InputStream sudah dibaca filter?
5. Apa yang terjadi jika reader throw IOException?
6. Mapper mana yang mengubah exception menjadi response?
7. Apakah body besar dibuffer?
8. Apakah reader thread-safe?
9. Apakah reader punya dependency yang dikelola benar?
10. Bagaimana mengetes selection rule-nya?
```

Contoh saat belajar Jersey Client:

```text
1. Apa default timeout?
2. Apakah connection pool digunakan?
3. Apakah response selalu ditutup?
4. Apakah DNS/connect/read timeout dibedakan?
5. Apakah retry aman untuk method ini?
6. Apakah correlation id dipropagasi?
7. Apakah TLS config benar?
8. Apakah proxy environment berbeda?
9. Bagaimana remote 400/500 dimap ke domain error?
10. Bagaimana metrics outbound dicatat?
```

Ini adalah cara berpikir production engineer.

---

## 0.19. Java 8 sampai 25: Apa yang Berubah untuk Jersey Engineer?

### Java 8

Java 8 masih banyak ditemukan di sistem enterprise legacy. Untuk Jersey:

- Jersey 2.x sangat relevan.
- `javax.ws.rs` masih dominan.
- Tidak ada records, sealed classes, virtual threads.
- Async menggunakan model lama: executor, callback, `CompletionStage` jika tersedia di library tertentu.
- TLS/runtime default lebih tua.
- Dependency modernization lebih sulit.

Engineering implication:

```text
Prioritaskan stabilitas, explicit dependency, migration readiness, dan test coverage sebelum modernisasi besar.
```

### Java 11

Java 11 menjadi baseline modern awal untuk banyak enterprise.

Dampak:

- Java EE modules lama tidak lagi bundled seperti era Java 8.
- JAXB/activation dependency perlu eksplisit jika dibutuhkan.
- TLS/runtime behavior lebih modern.
- Container image lebih umum.

Engineering implication:

```text
Dependency tree harus lebih sadar. Jangan mengandalkan API lama hadir otomatis di JDK.
```

### Java 17

Java 17 sering menjadi baseline modern enterprise.

Dampak:

- Records tersedia.
- Pattern matching mulai berkembang.
- Stronger encapsulation berdampak pada reflection-heavy libraries jika dependency tua.
- Banyak framework modern menjadikan Java 17 baseline.

Engineering implication:

```text
DTO dengan records mulai menarik, tetapi serialization provider harus dikonfigurasi benar.
```

### Java 21

Java 21 membawa virtual threads sebagai fitur final.

Dampak untuk Jersey:

- Potensi meningkatkan scalability untuk blocking workloads.
- Namun dukungan aktual tergantung container/server integration.
- ThreadLocal/MDC/request context harus diperhatikan.
- Blocking JDBC/outbound client tetap perlu timeout dan pool control.

Engineering implication:

```text
Virtual threads bukan pengganti timeout, back-pressure, pooling, dan observability.
```

### Java 25

Java 25 relevan sebagai forward LTS planning dari banyak vendor.

Dampak:

- Cocok untuk strategi platform jangka panjang.
- Harus dilihat bersama dukungan framework/container/Jakarta EE stack.
- Migrasi ke Java 25 sering lebih aman jika sudah berada di Java 17/21 dan dependency modern.

Engineering implication:

```text
Jangan hanya upgrade JDK. Pastikan Jersey, servlet container, JSON provider, monitoring agent, security library, dan build plugin kompatibel.
```

---

## 0.20. Jersey Runtime Thinking untuk Sistem Regulatory / Case Management

Karena domain enterprise sering menuntut auditability, Jersey API boundary harus bisa menjawab pertanyaan:

```text
Who performed the action?
When did it happen?
Through which API route?
With which correlation id?
Against which case/entity?
Under which role/authority?
What input was accepted?
What validation failed?
What state transition happened?
What response/error was produced?
Which downstream dependency was called?
```

Dalam sistem biasa, endpoint mungkin cukup mengembalikan `200 OK`.

Dalam sistem regulatory-grade, endpoint adalah bagian dari evidence trail.

Implikasi desain:

- Correlation ID wajib konsisten.
- SecurityContext harus dipropagasi ke application service/audit layer.
- Error response tidak boleh membocorkan rahasia tetapi cukup untuk support.
- Validation error harus jelas dan defensible.
- Idempotency penting untuk command endpoint.
- Audit event tidak boleh bergantung pada log text bebas.
- Request/response logging harus masking PII/secret.
- DTO boundary harus mencegah over-posting dan over-sharing.
- State transition harus eksplisit, bukan hidden side-effect.

Contoh endpoint command:

```http
POST /cases/{caseId}/transitions/submit-for-review
Idempotency-Key: 7ef39f5b-6d10-4c11-b6d8-88d858c0a01e
Authorization: Bearer eyJ...
Content-Type: application/json
Accept: application/json
```

Ini bukan sekadar POST. Ini membawa banyak concern:

```text
route semantics
  -> command intent
identity
  -> actor
idempotency
  -> duplicate protection
authorization
  -> authority to transition
validation
  -> allowed state transition
body provider
  -> JSON parsing
service
  -> domain transition
transaction
  -> persistence consistency
audit
  -> evidence
response
  -> result/next state
observability
  -> correlation and latency
```

Jersey bisa menjadi boundary yang rapi jika concern ditempatkan benar.

---

## 0.21. Cara Menilai Kualitas Jersey Application

Berikut maturity model sederhana.

### Level 1 — Endpoint Works

Ciri:

- Resource method bisa dipanggil.
- JSON masuk/keluar.
- Basic status code.

Kelemahan:

- Error tidak konsisten.
- Timeout client tidak jelas.
- Resource terlalu gemuk.
- Observability minim.

### Level 2 — Basic Production API

Ciri:

- Explicit resource registration.
- JSON provider jelas.
- Exception mapper dasar.
- Logging dasar.
- Validation dasar.
- Security context dasar.

Kelemahan:

- Failure taxonomy masih kasar.
- Client resilience belum matang.
- Provider/filter ordering belum terdokumentasi.

### Level 3 — Controlled Runtime

Ciri:

- Request pipeline dipahami.
- Provider selection dikontrol.
- Error contract konsisten.
- Correlation ID end-to-end.
- Client lifecycle dan timeout benar.
- Test melewati Jersey runtime.

### Level 4 — Platformized Jersey

Ciri:

- Internal platform module.
- Reusable filters/mappers/features/client factory.
- Observability baked in.
- Security/audit integration standar.
- Migration strategy jelas.
- Failure checklist tersedia.

### Level 5 — Top-Tier Engineering

Ciri:

- Bisa memodifikasi/memperluas Jersey behavior secara aman.
- Bisa menganalisis production incident lintas layer.
- Bisa memimpin migrasi Jersey 2 -> 3/4.
- Bisa menimbang Spring/CDI/HK2 ownership.
- Bisa mendesain API boundary yang stable, observable, secure, defensible, dan evolvable.

Target seri ini adalah Level 5.

---

## 0.22. Latihan Awal: Self-Assessment

Sebelum masuk Part 1, coba jawab pertanyaan berikut. Tidak perlu sempurna sekarang. Ini akan menjadi baseline.

### Runtime

1. Apa bedanya `Application` dan `ResourceConfig`?
2. Kapan Jersey melakukan resource model validation?
3. Kenapa resource method bisa tidak terpanggil walaupun path terlihat benar?
4. Apa perbedaan `404`, `405`, `406`, dan `415` dari sudut pandang Jersey matching?
5. Apa yang terjadi jika filter membaca entity stream sebelum body reader?

### Provider

6. Bagaimana Jersey memilih `MessageBodyReader`?
7. Apa yang membuat provider custom kalah dari provider default?
8. Apa perbedaan `ReaderInterceptor` dan `MessageBodyReader`?
9. Kenapa `GenericEntity` kadang diperlukan?
10. Bagaimana mencegah JSON provider mengekspose field internal?

### Lifecycle

11. Siapa yang membuat instance resource class?
12. Apa risiko singleton resource?
13. Apa bedanya HK2 injection, CDI injection, dan Spring injection dalam aplikasi Jersey?
14. Kenapa mixing DI container bisa berbahaya?
15. Bagaimana cara mendeteksi dependency yang dibuat oleh container yang salah?

### Client

16. Apakah aman membuat `Client` per request?
17. Kenapa `Response.close()` penting?
18. Timeout apa saja yang perlu dipikirkan dalam outbound HTTP?
19. Kapan retry aman?
20. Bagaimana cara membawa correlation id ke downstream API?

### Production

21. Bagaimana mendesain error contract yang aman untuk user dan berguna untuk support?
22. Apa failure mode umum multipart upload?
23. Bagaimana reverse proxy bisa membuat URI/link salah?
24. Bagaimana mengetes filter/mapper/provider secara realistis?
25. Apa risiko migrasi `javax.ws.rs` ke `jakarta.ws.rs`?

Jika sebagian besar belum bisa dijawab, itu normal. Seri ini akan membangun jawabannya bertahap.

---

## 0.23. Checklist Sebelum Masuk Part 1

Pastikan peta berpikir berikut sudah jelas.

```text
[ ] Jersey adalah implementasi JAX-RS/Jakarta REST, bukan sekadar annotation set.
[ ] Ada perbedaan besar antara spec API dan Jersey-specific extension.
[ ] javax.ws.rs dan jakarta.ws.rs adalah boundary migrasi serius.
[ ] Resource class sebaiknya dipahami sebagai HTTP adapter.
[ ] Request Jersey melewati pipeline: filter -> matching -> binding -> invocation -> mapper/provider -> response.
[ ] Entity berarti HTTP body, bukan JPA entity.
[ ] Provider selection adalah sumber banyak bug serialization/deserialization.
[ ] Filter tidak cocok untuk semua cross-cutting concern.
[ ] Lifecycle dan DI ownership harus eksplisit.
[ ] Jersey Client harus diperlakukan sebagai runtime client dengan lifecycle, timeout, pooling, dan observability.
[ ] Production Jersey harus didesain dengan failure mode, bukan hanya happy path.
```

---

## 0.24. Referensi Resmi dan Rujukan Utama

Referensi yang akan menjadi baseline seri:

1. **Eclipse Jersey official site**  
   Jersey adalah framework open-source production quality untuk RESTful Web Services dan implementasi JAX-RS/Jakarta REST.

2. **Eclipse Jersey User Guide**  
   Rujukan utama untuk deployment, `ResourceConfig`, client API, entity provider, security, monitoring, testing, dan migration.

3. **Jakarta RESTful Web Services specification**  
   Rujukan untuk behavior portable yang berasal dari specification.

4. **Jakarta RESTful Web Services 4.0 API**  
   Rujukan untuk Jakarta REST 4.0/Jakarta EE 11 era.

5. **OpenJDK/JDK release documentation**  
   Rujukan untuk Java 8–25 compatibility thinking, terutama Java 21 dan Java 25.

Catatan penting:

```text
Jika ada konflik antara tutorial internet dan dokumentasi resmi, seri ini akan lebih mengutamakan dokumentasi resmi, specification, dan observed runtime behavior.
```

---

## 0.25. Ringkasan Part 0

Part 0 menetapkan fondasi seri:

- Jersey dipelajari sebagai runtime dan extension platform.
- Fokus bukan CRUD tutorial, tetapi runtime behavior dan production engineering.
- Seri membahas Java 8 sampai 25.
- Seri membedakan Jersey 2.x (`javax`) dari Jersey 3/4 (`jakarta`).
- Resource class dipahami sebagai HTTP adapter.
- Provider, filter, interceptor, mapper, binder, feature, dan client akan dipelajari sebagai bagian dari pipeline.
- Failure mode dan production trade-off akan selalu dibahas.
- Target akhir adalah mampu membangun, memperluas, men-debug, mengoptimalkan, dan memigrasikan Jersey application secara enterprise-grade.

Status seri:

```text
Part saat ini : Part 0
Total rencana : 32 part
Status        : Belum selesai
Part terakhir : Part 32 — Capstone: Building a Production-Grade Jersey Platform Module
```

---

## 0.26. Transisi ke Part 1

Part berikutnya:

```text
Part 1 — Jersey Mental Model: Spec, Implementation, Runtime, and Engineering Boundary
```

Part 1 akan masuk lebih dalam ke pertanyaan utama:

```text
Apa sebenarnya Jersey itu?
Apa yang berasal dari specification?
Apa yang berasal dari Jersey-specific implementation?
Apa yang berasal dari servlet/container?
Apa yang berasal dari DI container?
Apa konsekuensinya untuk design, debugging, testing, dan migration?
```

