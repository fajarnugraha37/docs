# Part 1 — Jersey Mental Model: Spec, Implementation, Runtime, and Engineering Boundary

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Part: `01`  
Status: `Draft for learning`  
Target pembaca: Java engineer yang sudah memahami Java, HTTP, servlet, Jakarta REST/JAX-RS dasar, JSON/XML, DI, observability, dan deployment dasar.  
Rentang Java: Java 8 sampai Java 25.  
Fokus versi Jersey:

- Jersey 2.x untuk dunia `javax.ws.rs` / Java EE / Jakarta EE awal.
- Jersey 3.x untuk `jakarta.ws.rs` dan Jakarta EE 9/10.
- Jersey 4.x untuk Jakarta EE 11 / Jakarta REST 4.0.

> Catatan versi: situs resmi Jersey mencantumkan rilis terbaru per jalur utama: Jersey 2.48, Jersey 3.0.18, Jersey 3.1.11, dan Jersey 4.0.0. Jakarta RESTful Web Services 4.0 adalah rilis Jakarta EE 11, dengan minimum Java SE 17, dan rilis tersebut menghapus dependency JAXB dan ManagedBean support dari specification. Jersey 4.0.x adalah rilis yang compatible dengan Jakarta EE 11/Jakarta REST 4.0. JDK 25 mencapai General Availability pada 16 September 2025 dan merupakan Reference Implementation Java SE 25.

---

## 1. Tujuan Part Ini

Part ini bukan tutorial membuat endpoint pertama. Itu sudah terlalu dasar dan akan mengulang materi JAX-RS.

Part ini bertujuan membentuk mental model yang benar tentang **Jersey sebagai runtime**, bukan hanya sebagai kumpulan annotation seperti `@Path`, `@GET`, `@POST`, `@Produces`, atau `@Consumes`.

Setelah part ini, kamu harus bisa menjawab pertanyaan seperti:

1. Apa perbedaan Jakarta REST/JAX-RS dengan Jersey?
2. Apa yang sebenarnya dilakukan Jersey saat aplikasi start?
3. Apa yang dilakukan Jersey saat request masuk?
4. Di mana batas tanggung jawab Jersey, servlet container, DI container, JSON provider, security framework, dan business service?
5. Kenapa error seperti `404`, `405`, `406`, `415`, `500`, `No MessageBodyWriter`, atau injection failure tidak selalu berasal dari layer yang sama?
6. Kenapa desain Jersey yang tampak sederhana bisa menjadi rapuh di production jika boundary-nya salah?
7. Bagaimana berpikir tentang Jersey di Java 8 sampai Java 25?

Tujuan akhirnya:

> Kamu tidak hanya bisa memakai Jersey, tetapi bisa membaca, men-debug, meng-extend, dan menempatkannya dengan benar dalam sistem enterprise.

---

## 2. Core Mental Model

Jersey paling mudah dipahami sebagai **runtime yang mengubah HTTP exchange menjadi method invocation dan mengubah method result menjadi HTTP response**, dengan banyak extension point di sepanjang pipeline.

Secara sederhana:

```text
HTTP Request
   |
   v
Container / Servlet / Embedded Server
   |
   v
Jersey Runtime
   |
   +--> Request matching
   +--> Resource method selection
   +--> Parameter injection
   +--> Entity deserialization
   +--> Filter/interceptor execution
   +--> Dependency injection / context injection
   +--> Resource method invocation
   +--> Exception mapping
   +--> Entity serialization
   +--> Response filters/interceptors
   |
   v
HTTP Response
```

Namun mental model ini masih terlalu linear. Di production, Jersey sebenarnya adalah gabungan dari beberapa mesin kecil:

```text
Jersey Application
├── Resource model engine
│   ├── resource class discovery
│   ├── method model construction
│   ├── URI template model
│   └── validation of ambiguous resource definitions
│
├── Routing/matching engine
│   ├── path matching
│   ├── HTTP method selection
│   ├── media type negotiation
│   └── sub-resource resolution
│
├── Provider engine
│   ├── MessageBodyReader
│   ├── MessageBodyWriter
│   ├── ExceptionMapper
│   ├── ParamConverterProvider
│   ├── ContextResolver
│   └── Feature/DynamicFeature
│
├── Pipeline engine
│   ├── ContainerRequestFilter
│   ├── ContainerResponseFilter
│   ├── ReaderInterceptor
│   └── WriterInterceptor
│
├── Injection/context engine
│   ├── @Context
│   ├── HK2 binding
│   ├── CDI/Spring bridge depending on deployment
│   └── request/session/application contextual objects
│
├── Client engine
│   ├── Client
│   ├── WebTarget
│   ├── Invocation
│   ├── Client filters
│   ├── client providers
│   └── connector implementation
│
└── Container integration
    ├── Servlet container
    ├── Grizzly
    ├── Jakarta EE server
    ├── Spring Boot integration
    └── Kubernetes/container runtime boundary
```

Jadi, ketika kamu melihat kode seperti ini:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public CaseResponse getCase(@PathParam("id") String id) {
        return service.getCase(id);
    }
}
```

seorang engineer pemula melihat:

```text
GET /cases/{id} memanggil getCase().
```

seorang engineer yang lebih matang melihat:

```text
Sebuah resource method ikut masuk ke resource model Jersey.
Jersey akan membuat URI template untuk /cases/{id}, memilih method GET,
melakukan parameter conversion untuk id, memilih MessageBodyWriter untuk CaseResponse,
menjalankan filter/interceptor, memetakan exception, lalu menyerahkan response ke container.
```

seorang production engineer melihat lebih jauh:

```text
Apa lifecycle CaseResource?
Siapa yang membuat service?
Apakah response DTO aman diserialisasi?
Apakah lazy field bisa bocor?
Apakah error contract konsisten?
Apakah correlation id tersedia?
Apakah request logging membaca body dua kali?
Apakah timeout outbound dipasang?
Apakah route ambiguous?
Apakah API tetap kompatibel bila CaseResponse berubah?
Apakah endpoint defendable secara audit?
```

Part ini akan membangun cara berpikir ketiga.

---

## 3. Jersey Bukan Specification

Hal pertama yang harus dikunci:

> Jakarta REST/JAX-RS adalah specification. Jersey adalah implementation.

### 3.1 Apa itu specification?

Specification mendefinisikan kontrak API dan perilaku yang harus disediakan implementasi.

Untuk Jakarta REST, specification mendefinisikan hal-hal seperti:

- annotation resource: `@Path`, `@GET`, `@POST`, dan lain-lain;
- entity provider API: `MessageBodyReader`, `MessageBodyWriter`;
- exception mapping: `ExceptionMapper`;
- filter/interceptor API;
- client API;
- context object seperti `UriInfo`, `Request`, `HttpHeaders`, `SecurityContext`;
- aturan request matching;
- aturan media type negotiation;
- aturan response construction.

Specification tidak berarti semua hal internal sama di setiap implementasi.

RESTEasy, Jersey, CXF, dan implementation lain dapat sama-sama compliant terhadap specification, tetapi berbeda dalam:

- bootstrap API;
- extension internal;
- dependency injection integration;
- provider discovery detail;
- logging diagnostics;
- performance characteristics;
- container integration;
- edge-case behavior;
- bug history;
- module packaging;
- default property;
- test utility.

### 3.2 Apa itu Jersey?

Jersey adalah implementation dari JAX-RS/Jakarta REST yang juga menyediakan API dan extension tambahan.

Di dunia Jersey, kamu akan menemukan dua jenis API:

```text
Specification API
    jakarta.ws.rs.*        atau javax.ws.rs.*

Jersey-specific API
    org.glassfish.jersey.*
```

Contoh specification API:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
```

Contoh Jersey-specific API:

```java
import org.glassfish.jersey.server.ResourceConfig;
import org.glassfish.jersey.server.filter.RolesAllowedDynamicFeature;
import org.glassfish.jersey.server.ServerProperties;
```

Perbedaan ini sangat penting.

Jika kode kamu hanya memakai `jakarta.ws.rs.*`, secara teori kode resource lebih portable ke implementation lain.

Jika kode kamu memakai `org.glassfish.jersey.*`, kamu mulai mengikat diri ke Jersey. Ini bukan salah. Banyak production system memang perlu Jersey-specific features. Tetapi keputusan itu harus sadar.

---

## 4. Boundary Utama: Spec vs Jersey Runtime vs Container

Mari kita pecah sistem Jersey menjadi beberapa boundary.

```text
Client
  |
  | HTTP
  v
Reverse Proxy / API Gateway / Load Balancer
  |
  v
Servlet Container / Embedded Server
  |
  v
Jersey Runtime
  |
  v
Resource Layer
  |
  v
Application Service Layer
  |
  v
Domain / Persistence / Integration
```

Setiap layer punya tanggung jawab berbeda.

---

## 5. Tanggung Jawab Jakarta REST/JAX-RS Specification

Specification menjawab pertanyaan:

> API dan perilaku minimum apa yang harus tersedia agar developer bisa membuat RESTful service dengan Java secara portable?

Specification mengatur:

1. Bentuk annotation.
2. Bentuk resource class.
3. Parameter injection contract.
4. Request matching rule.
5. Content negotiation.
6. Entity provider contract.
7. Filter/interceptor contract.
8. Exception mapper contract.
9. Client API contract.
10. Context object contract.

Specification tidak terutama bertugas menentukan:

- cara scanning class dilakukan;
- detail startup optimization;
- format log internal;
- cara DI internal diimplementasikan;
- connector HTTP client mana yang digunakan;
- integrasi spesifik dengan Spring;
- semua property konfigurasi runtime;
- struktur internal resource model;
- algoritma optimisasi provider lookup;
- packaging dependency Jersey.

Itu wilayah implementation.

---

## 6. Tanggung Jawab Jersey Runtime

Jersey menjawab pertanyaan:

> Bagaimana specification itu benar-benar dijalankan di runtime?

Jersey bertanggung jawab untuk:

1. Membaca `Application` atau `ResourceConfig`.
2. Menemukan resource class dan provider.
3. Membangun resource model.
4. Memvalidasi resource model.
5. Menjalankan request matching.
6. Melakukan parameter binding.
7. Memilih `MessageBodyReader` untuk request body.
8. Memilih `MessageBodyWriter` untuk response body.
9. Menjalankan request/response filter.
10. Menjalankan reader/writer interceptor.
11. Menyediakan context injection.
12. Menghubungkan HK2/CDI/Spring tergantung konfigurasi.
13. Memetakan exception via `ExceptionMapper`.
14. Menyediakan client runtime.
15. Mengintegrasikan diri dengan servlet/Grizzly/container lain.

Jersey adalah runtime yang penuh state saat startup, tetapi harus aman dan efisien saat request berjalan.

---

## 7. Tanggung Jawab Servlet Container atau Embedded Server

Jika Jersey dijalankan di Servlet environment, container seperti Tomcat, Jetty, Payara, GlassFish, Open Liberty, atau container lain bertanggung jawab untuk:

1. Menerima koneksi HTTP.
2. Parsing HTTP request dasar.
3. Mengelola thread pool request.
4. Menjalankan servlet filter sebelum request masuk ke Jersey servlet/filter.
5. Menyediakan `HttpServletRequest` dan `HttpServletResponse`.
6. Mengelola session servlet jika digunakan.
7. Menyediakan async servlet support.
8. Menangani TLS jika terminasi dilakukan di container.
9. Menangani compression jika diaktifkan di container.
10. Menangani connector/network configuration.
11. Melakukan graceful shutdown pada level container.

Jersey tidak menggantikan servlet container. Jersey hidup di atasnya.

Kesalahan umum:

```text
Timeout terjadi -> langsung menyalahkan Jersey.
```

Padahal timeout bisa berasal dari:

- API gateway;
- load balancer;
- reverse proxy;
- servlet connector;
- servlet async timeout;
- Jersey async timeout;
- outbound client timeout;
- database timeout;
- thread pool starvation;
- client disconnect.

Production engineer harus memetakan layer sebelum menyimpulkan.

---

## 8. Tanggung Jawab DI Container

Jersey punya integration dengan HK2 dan bisa berintegrasi dengan CDI atau Spring. Ini sering menjadi sumber kebingungan.

Pertanyaan penting:

> Siapa yang membuat object ini?

Object bisa dibuat oleh:

1. Jersey/HK2.
2. CDI container.
3. Spring container.
4. Servlet container.
5. Manual registration sebagai instance.
6. Factory/custom binder.

Jika ownership tidak jelas, masalah yang muncul:

- injection gagal;
- lifecycle salah;
- singleton menyimpan request-scoped object;
- transaction annotation tidak jalan;
- security proxy tidak aktif;
- AOP/interceptor tidak terpanggil;
- duplicate instance;
- resource class tidak memakai bean yang kamu kira;
- test berbeda dari production.

Contoh problem mental model:

```java
@Path("/cases")
@Component
public class CaseResource {
    @Autowired
    private CaseService service;
}
```

Apakah resource ini dibuat oleh Spring atau Jersey?

Jika Jersey yang membuat, `@Autowired` bisa tidak berjalan kecuali integration benar.

Jika Spring yang membuat, Jersey harus dikonfigurasi agar memakai Spring-managed resource.

Masalahnya bukan annotation-nya. Masalahnya adalah ownership.

---

## 9. Tanggung Jawab JSON Provider

Jersey tidak otomatis berarti Jackson.

Jersey bisa bekerja dengan beberapa provider JSON, tergantung dependency dan registration:

- Jackson;
- JSON-B;
- MOXy, terutama pada era tertentu;
- custom `MessageBodyReader`/`MessageBodyWriter`.

Ketika method resource mengembalikan object:

```java
return new CaseResponse(...);
```

Jersey harus memilih provider yang bisa menulis object itu menjadi response body sesuai media type.

```text
CaseResponse
   |
   v
MessageBodyWriter<CaseResponse>
   |
   v
application/json bytes
```

Jika provider tidak tersedia, salah prioritas, atau media type tidak cocok, kamu bisa mendapat error seperti:

```text
MessageBodyWriter not found for media type=application/json
```

Masalah ini bukan business logic. Ini provider resolution.

---

## 10. Tanggung Jawab Security Framework

Jersey menyediakan abstraction seperti `SecurityContext` dan annotation seperti `@RolesAllowed` jika fitur terkait diaktifkan. Tetapi authentication nyata sering dilakukan oleh layer lain:

- servlet filter;
- Jakarta Security;
- Spring Security;
- custom bearer token filter;
- API gateway;
- mTLS termination layer;
- OIDC adapter;
- Keycloak adapter/custom integration;
- custom identity provider integration.

Production question:

```text
Kapan identity dibentuk?
Kapan principal tersedia?
Kapan role/authority dihitung?
Kapan tenant context dihitung?
Kapan authorization dilakukan?
Apakah object-level authorization ada?
Apakah denial masuk audit?
Apakah error-nya aman?
```

Jersey resource method sebaiknya tidak menjadi tempat tunggal untuk semua security decision.

Resource layer boleh menjadi boundary enforcement, tetapi policy computation sering lebih tepat diletakkan di service/security policy layer.

---

## 11. Jersey sebagai Adapter Layer

Dalam arsitektur enterprise, Jersey paling sehat diposisikan sebagai **HTTP adapter**.

```text
HTTP / JSON / Header / Query / Path
        |
        v
Jersey Resource Layer
        |
        v
Application Use Case / Service Layer
        |
        v
Domain / Workflow / Persistence / Integration
```

Resource class sebaiknya melakukan:

1. Menerima request.
2. Mengikat parameter/body.
3. Memanggil validation boundary.
4. Mengambil identity/context yang relevan.
5. Memanggil use case.
6. Mengubah result menjadi HTTP response.

Resource class sebaiknya tidak menjadi:

- tempat business rule utama;
- tempat query SQL panjang;
- tempat state machine domain;
- tempat orchestration besar;
- tempat retry/circuit breaker manual berantakan;
- tempat audit logic tersebar;
- tempat mapping entity JPA langsung ke response;
- tempat semua exception ditangkap manual.

Resource class adalah adapter, bukan domain engine.

---

## 12. Lapisan Jersey dalam Clean/Hexagonal Architecture

Pemetaan yang baik:

```text
External Actor
    |
    v
HTTP Contract
    |
    v
Jersey Resource
    |
    v
Request DTO / Command DTO
    |
    v
Application Service / Use Case
    |
    v
Domain Model / Domain Service
    |
    v
Repository / Gateway Port
    |
    v
Database / External System Adapter
```

Dalam model ini:

- Jersey resource adalah inbound adapter.
- Jersey client bisa menjadi outbound adapter.
- DTO adalah contract object.
- Domain model tidak tahu Jersey.
- Application service tidak seharusnya bergantung pada `jakarta.ws.rs.core.Response`.
- Exception domain sebaiknya tidak langsung berupa `WebApplicationException`, kecuali pada boundary sangat tipis.

Contoh boundary yang buruk:

```java
public class CaseService {
    public Response approveCase(String id) {
        // business logic
        return Response.ok(...).build();
    }
}
```

Masalah:

- service layer bergantung pada HTTP;
- sulit dipakai oleh batch/job/message consumer;
- sulit diuji tanpa JAX-RS;
- domain error bercampur dengan HTTP status;
- portability turun.

Boundary yang lebih baik:

```java
public class CaseService {
    public ApproveCaseResult approveCase(ApproveCaseCommand command) {
        // business logic
        return result;
    }
}
```

lalu resource:

```java
@POST
@Path("/{id}/approval")
public Response approve(@PathParam("id") String id, ApproveCaseRequest request) {
    ApproveCaseResult result = caseService.approveCase(mapToCommand(id, request));
    return Response.ok(mapToResponse(result)).build();
}
```

---

## 13. Request Lifecycle dari Sudut Pandang Jersey

Ketika request masuk, Jersey melakukan banyak hal sebelum method resource dipanggil.

Contoh request:

```http
POST /api/cases/CASE-001/approval HTTP/1.1
Content-Type: application/json
Accept: application/json
Authorization: Bearer <token>
X-Correlation-Id: abc-123

{
  "decision": "APPROVE",
  "comment": "Looks valid"
}
```

Lifecycle konseptual:

```text
1. Container menerima HTTP request.
2. Container mapping request ke Jersey servlet/filter.
3. Jersey membungkus request menjadi internal request context.
4. Pre-matching request filters berjalan.
5. Jersey melakukan URI matching.
6. Jersey memilih resource class dan resource method.
7. Jersey melakukan HTTP method matching.
8. Jersey melakukan media type negotiation.
9. Post-matching request filters berjalan.
10. Reader interceptors berjalan.
11. MessageBodyReader membaca JSON menjadi request DTO.
12. Parameter injection dilakukan.
13. Resource instance disiapkan sesuai lifecycle.
14. Context injection tersedia.
15. Resource method dipanggil.
16. Jika sukses, result diproses menjadi response.
17. Jika exception, ExceptionMapper dicari.
18. MessageBodyWriter menulis response entity.
19. Writer interceptors berjalan.
20. Container response filters berjalan.
21. Response dikirim kembali ke servlet container.
22. Container mengirim bytes ke network.
```

Dari lifecycle ini, kita bisa lihat bahwa error dapat terjadi di banyak titik.

---

## 14. Failure Mapping Berdasarkan Tahap

### 14.1 Request tidak sampai ke Jersey

Kemungkinan:

- DNS salah;
- load balancer salah route;
- API gateway path rewrite salah;
- TLS termination gagal;
- servlet mapping salah;
- app belum ready;
- container tidak expose port;
- network policy Kubernetes memblokir.

Gejala:

- connection refused;
- gateway timeout;
- 502/503 dari proxy;
- log Jersey kosong.

Kesimpulan:

> Jangan debug resource method jika request belum sampai Jersey.

### 14.2 Request sampai Jersey tetapi resource tidak cocok

Kemungkinan:

- `@ApplicationPath` salah;
- servlet mapping salah;
- `@Path` class/method tidak sesuai;
- trailing slash behavior tidak sesuai ekspektasi;
- regex path tidak match;
- sub-resource locator tidak menghasilkan resource;
- package scanning tidak mendaftarkan resource;
- explicit registration lupa.

Gejala:

- 404 dari Jersey;
- access log container ada;
- resource method tidak terpanggil.

### 14.3 Path cocok tetapi method HTTP tidak cocok

Kemungkinan:

- endpoint hanya punya `@GET`, request memakai `POST`;
- CORS preflight `OPTIONS` tidak ditangani;
- method override tidak didukung;
- resource method ambiguous.

Gejala:

- 405 Method Not Allowed.

### 14.4 Method cocok tetapi media negotiation gagal

Kemungkinan:

- `Content-Type` tidak cocok dengan `@Consumes`;
- `Accept` tidak cocok dengan `@Produces`;
- client mengirim content-type aneh;
- wildcard media type dipahami salah;
- provider ada tetapi media type tidak didukung.

Gejala:

- 406 Not Acceptable;
- 415 Unsupported Media Type.

### 14.5 Body tidak bisa dibaca

Kemungkinan:

- JSON invalid;
- DTO tidak bisa dibuat;
- missing no-args constructor pada style tertentu;
- Jackson/JSON-B config salah;
- generic type hilang;
- body stream sudah dibaca filter sebelumnya;
- provider tidak tersedia.

Gejala:

- 400;
- 415;
- 500;
- `MessageBodyReader not found`;
- JSON parse exception.

### 14.6 Resource method terpanggil tetapi business error

Kemungkinan:

- domain invariant gagal;
- authorization gagal;
- entity tidak ditemukan;
- state transition invalid;
- optimistic lock conflict;
- dependency gagal;
- database timeout.

Gejala:

- tergantung `ExceptionMapper`;
- bisa 400/403/404/409/422/500/503.

### 14.7 Response tidak bisa ditulis

Kemungkinan:

- `MessageBodyWriter` tidak ada;
- DTO mengandung circular reference;
- lazy proxy gagal diserialisasi;
- stream sudah tertutup;
- output connection putus;
- JSON provider error.

Gejala:

- 500;
- partial response;
- client disconnect;
- serialization exception.

---

## 15. Jersey sebagai Resource Model Builder

Sebelum request bisa diproses, Jersey harus membangun resource model.

Resource model adalah representasi internal dari:

- resource class;
- path class;
- method path;
- HTTP method;
- consumes/produces;
- parameter binding;
- sub-resource locator;
- provider binding;
- name binding;
- dynamic features.

Contoh:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public CaseResponse get(@PathParam("id") String id) {
        return service.get(id);
    }

    @POST
    @Path("/{id}/approval")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public ApprovalResponse approve(
            @PathParam("id") String id,
            ApprovalRequest request) {
        return service.approve(id, request);
    }
}
```

Jersey melihat ini kira-kira sebagai:

```text
Root resource: /cases
  GET /{id}
    produces: application/json
    path param: id -> String
    response entity: CaseResponse

  POST /{id}/approval
    consumes: application/json
    produces: application/json
    path param: id -> String
    entity param: ApprovalRequest
    response entity: ApprovalResponse
```

Ini berarti resource class bukan hanya class biasa. Ia adalah input untuk compiler kecil milik Jersey yang membangun routing graph.

Jika kamu menulis resource class sembarangan, kamu sedang memberi input buruk ke routing graph.

---

## 16. Jersey sebagai Provider Registry

Provider registry adalah salah satu inti Jersey.

Provider bukan hanya JSON serializer. Provider mencakup banyak extension point:

```text
Provider Registry
├── MessageBodyReader<T>
├── MessageBodyWriter<T>
├── ExceptionMapper<E>
├── ParamConverterProvider
├── ContextResolver<T>
├── ContainerRequestFilter
├── ContainerResponseFilter
├── ReaderInterceptor
├── WriterInterceptor
├── Feature
├── DynamicFeature
└── Binder / Injection support
```

Saat runtime, Jersey berkali-kali bertanya:

```text
Provider mana yang paling cocok untuk situasi ini?
```

Contoh pertanyaan:

```text
Siapa yang bisa membaca application/json menjadi ApprovalRequest?
Siapa yang bisa menulis CaseResponse menjadi application/json?
Siapa yang bisa memetakan DomainConflictException?
Filter mana yang harus jalan untuk method ini?
Interceptor mana yang harus membungkus entity stream?
ParamConverter mana yang bisa mengubah path segment menjadi CaseId?
ContextResolver mana yang memberi ObjectMapper?
```

Karena itu, banyak bug Jersey sebenarnya adalah bug registration dan provider selection.

---

## 17. Jersey sebagai Pipeline Runtime

Pipeline Jersey dapat dilihat seperti middleware berlapis.

```text
Incoming request
   |
   v
Pre-matching filters
   |
   v
Resource matching
   |
   v
Post-matching filters
   |
   v
Reader interceptors
   |
   v
MessageBodyReader
   |
   v
Resource method
   |
   v
ExceptionMapper if needed
   |
   v
MessageBodyWriter
   |
   v
Writer interceptors
   |
   v
Response filters
   |
   v
Outgoing response
```

Setiap titik bisa menjadi extension point, tetapi setiap extension point juga bisa menjadi sumber failure.

Contoh:

- Request logging filter membaca body, lalu resource tidak bisa membaca body lagi.
- Authentication filter berjalan setelah authorization feature.
- Response filter menghapus header penting.
- Writer interceptor melakukan compression ganda dengan proxy/container.
- ExceptionMapper generic menangkap semua exception dan menyembunyikan security error.

Pipeline harus didesain, bukan ditambal.

---

## 18. Jersey sebagai Client Runtime

Banyak orang mempelajari Jersey hanya sebagai server runtime. Padahal Jersey Client juga besar.

Jersey Client mengubah:

```java
client.target(baseUrl)
      .path("/cases/{id}")
      .resolveTemplate("id", id)
      .request(MediaType.APPLICATION_JSON)
      .get(CaseResponse.class);
```

menjadi:

```text
Outbound HTTP request
├── URI construction
├── header construction
├── entity serialization if body exists
├── client request filters
├── connector execution
├── TLS/proxy/pool/timeout behavior
├── response status handling
├── client response filters
├── entity deserialization
└── connection lifecycle
```

Production risk terbesar Jersey Client:

1. `Client` dibuat per request.
2. Response tidak ditutup.
3. Timeout tidak dikonfigurasi.
4. Pooling tidak dipahami.
5. Retry dilakukan tanpa idempotency.
6. Error body tidak dibaca secara aman.
7. Correlation ID tidak dipropagasi.
8. TLS config tersebar.
9. Provider server dan client tidak konsisten.
10. Dependency connector tidak cocok dengan runtime.

Karena itu, Jersey Client harus dianggap runtime serius, bukan helper kecil.

---

## 19. Perbedaan Jersey dengan Spring MVC

Karena banyak Java engineer familiar dengan Spring, penting membandingkan mental model.

### 19.1 Spring MVC

Spring MVC biasanya dipahami sebagai bagian dari Spring application framework.

```text
Spring Boot Application
├── Spring container owns beans
├── DispatcherServlet
├── HandlerMapping
├── HandlerAdapter
├── Controller
├── HttpMessageConverter
├── HandlerInterceptor
├── ExceptionHandler/ControllerAdvice
└── Spring Security integration
```

Spring container biasanya adalah pusat dunia.

### 19.2 Jersey

Jersey lebih dekat dengan:

```text
JAX-RS/Jakarta REST implementation runtime
├── ResourceConfig/Application
├── Resource model
├── Provider registry
├── Request matching
├── MessageBodyReader/Writer
├── ExceptionMapper
├── Filters/Interceptors
├── HK2/CDI/Spring integration depending setup
└── Client API
```

Dalam Jersey, pusat dunianya adalah resource model dan provider pipeline.

### 19.3 Perbandingan praktis

| Aspek | Spring MVC | Jersey |
|---|---|---|
| Basis utama | Spring framework | Jakarta REST/JAX-RS specification implementation |
| Controller/resource | `@Controller`, `@RestController` | `@Path` resource |
| Serialization | `HttpMessageConverter` | `MessageBodyReader/Writer` |
| Error mapping | `@ExceptionHandler`, `@ControllerAdvice` | `ExceptionMapper` |
| Filter/interceptor | Servlet filter, Spring interceptor, advice | Container filter, reader/writer interceptor |
| DI utama | Spring container | HK2/CDI/Spring tergantung setup |
| Portability | erat dengan Spring | resource API lebih portable jika hanya spec API |
| Client | `RestTemplate`, `WebClient`, HTTP interfaces | JAX-RS/Jersey Client |

Tidak ada yang mutlak lebih baik. Yang penting adalah mengetahui modelnya.

Kesalahan umum adalah membawa asumsi Spring ke Jersey tanpa sadar. Misalnya menganggap semua object pasti Spring-managed, semua exception bisa ditangani `@ControllerAdvice`, atau semua JSON behavior mengikuti `ObjectMapper` Spring Boot global.

---

## 20. Perbedaan Jersey dengan RESTEasy dan CXF

RESTEasy, Jersey, dan CXF sama-sama dapat menjadi Jakarta REST/JAX-RS implementation.

Secara konseptual:

```text
Jakarta REST API
     |
     +-- Jersey
     +-- RESTEasy
     +-- Apache CXF
     +-- implementasi lain
```

Resource yang hanya memakai specification API relatif portable:

```java
@Path("/hello")
public class HelloResource {
    @GET
    public String hello() {
        return "hello";
    }
}
```

Tetapi begitu memakai API spesifik:

```java
public class MyApplication extends ResourceConfig {
    public MyApplication() {
        register(MyFeature.class);
    }
}
```

maka portability turun karena `ResourceConfig` adalah Jersey-specific.

Portability bukan selalu tujuan. Banyak sistem enterprise lebih butuh reliability, observability, dan determinism daripada theoretical portability.

Prinsip yang baik:

```text
Gunakan specification API untuk resource contract.
Gunakan Jersey-specific API secara sadar untuk bootstrap, extension, dan production controls.
Dokumentasikan titik vendor lock-in.
```

---

## 21. Java 8 sampai Java 25: Cara Berpikir Versi

Seri ini membahas Java 8 sampai Java 25, tetapi tidak berarti satu kombinasi dependency bisa berjalan sama di semua versi.

Kamu harus berpikir dalam beberapa era.

### 21.1 Era Java 8

Ciri umum:

- banyak aplikasi masih memakai Jersey 2.x;
- namespace `javax.ws.rs`;
- deployment WAR di servlet container lama;
- Java EE style masih umum;
- module system belum ada;
- TLS/cipher/runtime default berbeda dari Java modern;
- reflection lebih bebas;
- virtual thread belum ada;
- monitoring/profiling modern sering belum terintegrasi.

Risiko:

- dependency lama;
- CVE library transitive;
- old servlet API;
- Jackson lama;
- TLS compatibility;
- migration besar ke `jakarta.*`.

### 21.2 Era Java 11

Ciri umum:

- Java 11 menjadi baseline LTS penting selama bertahun-tahun;
- banyak aplikasi mulai containerized;
- module system sudah ada, walau banyak aplikasi tetap classpath;
- Jersey 2.x dan 3.x bisa muncul tergantung stack;
- javax/jakarta transition mulai terasa.

Risiko:

- split package/classpath issue;
- illegal reflective access warning;
- dependency yang diasumsikan ada di JDK 8 sudah hilang;
- JAXB tidak lagi built-in seperti era lama.

### 21.3 Era Java 17

Ciri umum:

- baseline modern untuk banyak enterprise;
- Jakarta EE 10 banyak memakai Java 11 sebagai minimum, tetapi runtime Java 17 umum;
- sealed class, records, pattern matching mulai relevan untuk DTO/domain design;
- GC dan runtime observability jauh lebih matang;
- strong encapsulation lebih nyata.

Risiko:

- reflection/proxy library lama bermasalah;
- JSON provider perlu support record jika dipakai;
- dependency lama bisa gagal.

### 21.4 Era Java 21

Ciri umum:

- virtual threads menjadi fitur final;
- structured concurrency masih preview/incubating dalam beberapa fase;
- banyak diskusi tentang blocking server model;
- container support menentukan apakah virtual thread benar-benar digunakan untuk request handling.

Risiko:

- mengira virtual thread otomatis mempercepat semua hal;
- thread-local context propagation salah;
- blocking DB/HTTP tetap menjadi bottleneck dependency;
- pinning atau synchronized hotspot;
- container belum memakai virtual thread untuk request handling.

### 21.5 Era Java 25

Ciri umum:

- JDK 25 adalah Java SE 25 Reference Implementation dan mencapai GA pada 16 September 2025;
- banyak vendor memperlakukan JDK 25 sebagai LTS;
- fitur seperti Scoped Values, Structured Concurrency preview, JFR improvement, compact object headers, dan AOT-related features masuk radar engineering;
- Jakarta EE 11/Jakarta REST 4.0 minimum Java SE 17, jadi dunia Jersey 4.x sudah bergerak ke baseline modern.

Risiko:

- mengejar fitur JDK baru sebelum framework/container/library siap;
- mengaktifkan preview feature untuk production tanpa governance;
- dependency lama belum compatible;
- behavior observability berubah.

### 21.6 Kesimpulan versi

Jangan berpikir:

```text
Java 8 sampai 25 berarti semua sama.
```

Berpikirlah:

```text
Java version menentukan baseline runtime.
Jersey major version menentukan namespace dan compatibility.
Jakarta REST version menentukan specification contract.
Servlet/container version menentukan deployment behavior.
JSON/DI/security provider menentukan behavior konkret.
```

---

## 22. Jersey 2.x, 3.x, dan 4.x

### 22.1 Jersey 2.x

Karakter utama:

- umumnya `javax.ws.rs`;
- cocok untuk banyak legacy Java EE/JAX-RS system;
- masih relevan untuk aplikasi Java 8/11 lama;
- migrasi dari 2.x ke 3.x bukan sekadar bump version karena perubahan namespace.

Contoh import:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.core.Response;
```

### 22.2 Jersey 3.x

Karakter utama:

- pindah ke `jakarta.ws.rs`;
- relevan untuk Jakarta EE 9/10;
- migrasi besar dari `javax.*` ke `jakarta.*`;
- banyak dependency sekitar juga harus pindah: servlet, validation, injection, annotation, JAXB, dan lain-lain.

Contoh import:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
```

### 22.3 Jersey 4.x

Karakter utama:

- aligned dengan Jakarta EE 11/Jakarta REST 4.0;
- minimum Java modern mengikuti Jakarta REST 4.0/Jakarta EE 11 ecosystem;
- ada API breakage;
- beberapa module/container/connector lama dihapus;
- lebih cocok untuk sistem baru atau modernization yang memang menuju Jakarta EE 11.

### 22.4 Prinsip migrasi major version

Jangan lakukan:

```text
Update dependency Jersey lalu berharap semua jalan.
```

Lakukan:

```text
1. Petakan namespace: javax vs jakarta.
2. Petakan servlet/container version.
3. Petakan validation API.
4. Petakan JSON provider.
5. Petakan CDI/Spring/HK2 integration.
6. Petakan Jersey-specific extension.
7. Jalankan contract test.
8. Jalankan provider/filter/mapper regression test.
9. Jalankan deployment smoke test.
```

---

## 23. Resource Class adalah Boundary, Bukan Tempat Semua Hal

Jersey memudahkan kita menulis resource class. Kemudahan ini sering menjebak.

Bad pattern:

```java
@Path("/cases")
public class CaseResource {

    @POST
    @Path("/{id}/approval")
    public Response approve(@PathParam("id") String id, ApprovalRequest request) {
        // parse identity manually
        // validate request manually
        // query database manually
        // check state transition manually
        // call external service manually
        // write audit manually
        // catch all exceptions manually
        // return response manually
    }
}
```

Resource menjadi god method.

Better pattern:

```java
@Path("/cases")
public class CaseResource {

    private final ApproveCaseUseCase approveCase;
    private final CaseHttpMapper mapper;

    @POST
    @Path("/{id}/approval")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response approve(
            @PathParam("id") String id,
            ApprovalRequest request,
            @Context SecurityContext securityContext) {

        ApproveCaseCommand command = mapper.toCommand(id, request, securityContext);
        ApproveCaseResult result = approveCase.execute(command);

        return Response.ok(mapper.toResponse(result)).build();
    }
}
```

Resource tetap penting, tetapi tipis dan jelas.

---

## 24. Jersey dalam Sistem Regulatory / Case Management

Dalam sistem regulatory, enforcement, licensing, compliance, atau case management, API bukan hanya jalur data. API adalah bagian dari evidence trail.

Pertanyaan production-grade:

```text
Siapa melakukan action?
Atas authority apa?
Pada case/entity apa?
Dari channel mana?
Request input apa yang diterima?
Validasi apa yang diterapkan?
State transition apa yang terjadi?
External dependency apa yang dipanggil?
Response apa yang dikembalikan?
Correlation id apa?
Audit event apa?
Apakah error-nya bisa dijelaskan?
```

Dalam konteks ini, Jersey resource layer harus mendukung:

- identity propagation;
- correlation ID;
- audit hook;
- request validation;
- object-level authorization;
- consistent error contract;
- idempotency;
- deterministic mapping;
- traceability;
- logging yang aman dari PII/secrets;
- failure classification.

Jersey sendiri tidak memberi semua policy tersebut out-of-the-box. Tetapi Jersey menyediakan extension points untuk membangunnya.

---

## 25. Cara Membaca Jersey dalam Production Incident

Saat incident terjadi, jangan langsung masuk ke code resource. Gunakan diagnostic tree.

```text
1. Apakah request sampai ke service?
   ├── Tidak -> network/proxy/container/deployment
   └── Ya

2. Apakah request sampai ke Jersey?
   ├── Tidak -> servlet mapping/filter/container
   └── Ya

3. Apakah resource matching berhasil?
   ├── Tidak -> path/application path/scanning/registration
   └── Ya

4. Apakah method dan media type cocok?
   ├── Tidak -> 405/406/415/Consumes/Produces/Accept/Content-Type
   └── Ya

5. Apakah request entity bisa dibaca?
   ├── Tidak -> MessageBodyReader/JSON provider/body stream/DTO
   └── Ya

6. Apakah resource invocation berhasil?
   ├── Tidak -> business/security/dependency/domain exception
   └── Ya

7. Apakah response entity bisa ditulis?
   ├── Tidak -> MessageBodyWriter/serialization/lazy proxy/stream
   └── Ya

8. Apakah client menerima response?
   ├── Tidak -> network/proxy/client disconnect/timeout
   └── Ya -> selesai
```

Ini mental model yang jauh lebih kuat daripada:

```text
Endpoint error, coba debug controller.
```

---

## 26. Minimal Jersey Application: Bukan untuk Tutorial, Tapi untuk Mental Model

Contoh paling minimal dengan Jersey 3/4 style:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/health")
public class HealthResource {

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public HealthResponse health() {
        return new HealthResponse("UP");
    }
}
```

```java
public record HealthResponse(String status) {}
```

Bootstrap Jersey-specific:

```java
import org.glassfish.jersey.server.ResourceConfig;

public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
    }
}
```

Yang terjadi:

```text
ApiApplication dibuat.
ResourceConfig mendaftarkan HealthResource.
Jersey membangun resource model untuk /health GET.
Saat GET /health masuk, Jersey memilih method health().
Return value HealthResponse diberikan ke MessageBodyWriter.
JSON provider menulis response body.
```

Jika JSON provider tidak tersedia, resource method mungkin sukses, tetapi response gagal ditulis.

Ini contoh kecil yang menunjukkan pemisahan:

```text
Resource invocation != response serialization.
```

---

## 27. Explicit Registration vs Package Scanning

Jersey memungkinkan package scanning:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
    }
}
```

Ini nyaman, tetapi production-grade system sering lebih suka explicit registration:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
        register(CaseResource.class);
        register(AuditResource.class);

        register(JsonFeature.class);
        register(ErrorMapper.class);
        register(CorrelationIdFilter.class);
        register(SecurityFilter.class);
    }
}
```

Trade-off:

| Pendekatan | Kelebihan | Risiko |
|---|---|---|
| Package scanning | cepat, ringkas | startup tidak deterministik, resource/provider tidak sengaja terdaftar, classpath/module issue |
| Explicit registration | deterministik, mudah audit | lebih verbose, perlu disiplin update |

Untuk sistem enterprise yang butuh defensibility, explicit registration sering lebih mudah dijelaskan.

---

## 28. ResourceConfig sebagai Composition Root

Dalam Jersey, `ResourceConfig` sering menjadi composition root HTTP layer.

Composition root artinya tempat kamu menyusun:

- resource;
- provider;
- filter;
- interceptor;
- feature;
- binder;
- property;
- integration.

Contoh konseptual:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication(AppConfig config) {
        // Resources
        register(CaseResource.class);
        register(DocumentResource.class);
        register(HealthResource.class);

        // Serialization
        register(JacksonFeature.class);
        register(ObjectMapperProvider.class);

        // Error contract
        register(ApiExceptionMapper.class);
        register(ValidationExceptionMapper.class);
        register(NotFoundExceptionMapper.class);

        // Pipeline
        register(CorrelationIdFilter.class);
        register(AuthenticationFilter.class);
        register(AuditFilter.class);

        // DI
        register(new ApplicationBinder(config));

        // Runtime properties
        property("jersey.config.server.tracing.type", "OFF");
    }
}
```

Jangan biarkan composition root tersebar di banyak tempat tanpa struktur. Kalau registration tersebar, debugging runtime behavior menjadi sulit.

---

## 29. Jersey-Specific API: Kapan Dipakai?

Gunakan Jakarta REST API untuk contract umum:

```java
import jakarta.ws.rs.Path;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.core.Response;
```

Gunakan Jersey-specific API ketika butuh:

- `ResourceConfig` bootstrap;
- server property tertentu;
- Jersey Test Framework;
- Jersey-specific feature;
- HK2 binder integration;
- Jersey client connector config;
- monitoring/tracing extension Jersey;
- multipart extension Jersey;
- SSE implementation Jersey;
- advanced provider registration;
- container-specific integration.

Prinsip:

```text
Jangan takut vendor-specific API.
Takutlah pada vendor-specific API yang tidak sadar, tidak terdokumentasi, dan tidak dites.
```

---

## 30. Common Misconceptions

### 30.1 “Jersey itu sama dengan REST API.”

Tidak. Jersey adalah runtime Java untuk Jakarta REST/JAX-RS.

REST API adalah contract/protocol-level design. Jersey adalah salah satu cara implementasinya.

### 30.2 “Kalau method resource terpanggil, response pasti aman.”

Tidak. Response masih harus melewati writer/interceptor/filter/container/network.

### 30.3 “Kalau JSON error, berarti DTO salah.”

Belum tentu. Bisa provider tidak terdaftar, media type salah, body stream sudah dibaca, ObjectMapper salah, generic type hilang, atau lazy proxy bermasalah.

### 30.4 “ExceptionMapper global cukup.”

Tidak selalu. Mapper generic yang terlalu agresif dapat menyembunyikan security error, validation error, not found, conflict, dan dependency failure.

### 30.5 “Resource class boleh langsung return entity JPA.”

Secara teknis bisa. Secara desain sering buruk.

Risiko:

- lazy loading saat serialization;
- circular reference;
- overexposed field;
- persistence schema bocor ke API contract;
- compatibility sulit;
- security data leakage.

### 30.6 “Jersey Client boleh dibuat setiap call.”

Tidak ideal. `Client` biasanya mahal dan sebaiknya reusable, dengan lifecycle jelas.

### 30.7 “Virtual thread otomatis membuat Jersey lebih cepat.”

Tidak. Virtual thread dapat membantu beban blocking tertentu, tetapi efektivitasnya tergantung container, connector, blocking point, thread-local usage, database driver, HTTP client, dan back-pressure.

---

## 31. Jersey Runtime Ownership Map

Gunakan map ini saat desain:

| Concern | Owner utama | Jersey role |
|---|---|---|
| HTTP socket | container/proxy | menerima request setelah container dispatch |
| Servlet mapping | servlet container | terikat pada Jersey servlet/filter |
| URI matching | Jersey | core runtime responsibility |
| Resource method | application code | dipanggil oleh Jersey |
| Parameter binding | Jersey + converter | mengisi argument method |
| JSON parse/write | provider seperti Jackson/JSON-B | dipilih oleh Jersey |
| Authentication | filter/security framework/gateway | Jersey dapat menyediakan filter/context |
| Authorization | app/security policy | Jersey dapat enforce di boundary |
| Business rule | application/domain service | bukan tanggung jawab Jersey |
| Transaction | service/persistence layer/container | Jersey hanya boundary caller |
| Error contract | ExceptionMapper + error design | Jersey memilih mapper |
| Audit | app/platform filter/service | Jersey bisa hook request context |
| Metrics/tracing | observability stack | Jersey filter/interceptor/client instrumentation |
| Outbound HTTP | Jersey Client/other client | jika memakai Jersey Client |
| Deployment | container/platform | Jersey integrated ke dalamnya |

---

## 32. Desain Layer yang Direkomendasikan

Untuk sistem enterprise, struktur package yang sehat bisa seperti ini:

```text
com.example.caseapi
├── bootstrap
│   └── ApiApplication.java
│
├── resource
│   ├── CaseResource.java
│   ├── DocumentResource.java
│   └── HealthResource.java
│
├── dto
│   ├── request
│   │   └── ApproveCaseRequest.java
│   └── response
│       └── CaseResponse.java
│
├── mapper
│   └── CaseHttpMapper.java
│
├── filter
│   ├── CorrelationIdFilter.java
│   ├── AuthenticationFilter.java
│   └── AuditFilter.java
│
├── provider
│   ├── ObjectMapperProvider.java
│   ├── ApiExceptionMapper.java
│   ├── ValidationExceptionMapper.java
│   └── DomainExceptionMapper.java
│
├── client
│   ├── ExternalRegistryClient.java
│   ├── JerseyClientFactory.java
│   └── OutboundClientFeature.java
│
├── config
│   └── ApiConfig.java
│
└── injection
    └── ApplicationBinder.java
```

Application/core layer sebaiknya terpisah:

```text
com.example.casecore
├── usecase
├── domain
├── repository
├── policy
├── audit
└── integrationport
```

Jersey package tidak menjadi pusat business logic.

---

## 33. Boundary Contoh: Approval Case

Misalnya endpoint:

```http
POST /cases/{caseId}/approval
```

Resource boundary:

```java
@POST
@Path("/{caseId}/approval")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response approve(
        @PathParam("caseId") String caseId,
        ApprovalRequest request,
        @Context SecurityContext securityContext,
        @Context HttpHeaders headers) {

    ApproveCaseCommand command = mapper.toCommand(
            caseId,
            request,
            securityContext,
            headers
    );

    ApproveCaseResult result = approveCase.execute(command);

    return Response.ok(mapper.toResponse(result)).build();
}
```

Application use case:

```java
public ApproveCaseResult execute(ApproveCaseCommand command) {
    identityPolicy.assertCanApprove(command.actor(), command.caseId());

    CaseAggregate aggregate = caseRepository.getRequired(command.caseId());
    aggregate.approve(command.actor(), command.comment(), command.now());

    caseRepository.save(aggregate);
    auditSink.record(CaseApprovedEvent.from(aggregate, command.actor()));

    return ApproveCaseResult.from(aggregate);
}
```

Exception mapper:

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    @Override
    public Response toResponse(DomainException exception) {
        ApiError error = ApiError.from(exception);
        return Response.status(error.httpStatus())
                .entity(error)
                .type(MediaType.APPLICATION_JSON)
                .build();
    }
}
```

Mental model:

```text
Jersey menangani HTTP boundary.
Use case menangani business transition.
Mapper menangani error contract.
Audit service menangani evidence.
Security policy menangani authorization.
DTO mapper menangani translation.
```

---

## 34. Kenapa Resource Tidak Boleh Terlalu Pintar?

Resource method berjalan di boundary dengan banyak concern:

- HTTP;
- serialization;
- validation;
- identity;
- authorization;
- observability;
- audit;
- error mapping;
- response semantics.

Jika business logic besar diletakkan di sana, coupling meningkat.

Dampak buruk:

1. Sulit reuse logic untuk batch/job/event consumer.
2. Sulit test business logic tanpa HTTP runtime.
3. Exception menjadi HTTP-specific.
4. Transaction boundary kabur.
5. Audit tersebar.
6. Authorization tersebar.
7. Resource method menjadi panjang.
8. Refactoring API merusak domain logic.

Rule of thumb:

```text
Resource method boleh tahu HTTP.
Use case tidak perlu tahu HTTP.
Domain tidak boleh tahu HTTP.
```

---

## 35. Jersey dan HTTP Semantics

Jersey memudahkan HTTP mapping, tetapi tidak menyelamatkan desain HTTP yang buruk.

Contoh buruk:

```http
GET /cases/approve?id=123
```

Masalah:

- GET seharusnya safe;
- approval mengubah state;
- cache/proxy bisa salah;
- audit semantics buruk.

Lebih baik:

```http
POST /cases/123/approval
```

atau jika approval adalah state transition command:

```http
POST /cases/123/transitions
Content-Type: application/json

{
  "action": "APPROVE",
  "comment": "Valid"
}
```

Jersey tidak memaksa kamu mendesain HTTP dengan benar. Engineer harus memahami semantics.

---

## 36. Jersey dan Error Semantics

HTTP status bukan sekadar angka.

Contoh taxonomy:

| Situation | Status yang mungkin | Catatan |
|---|---:|---|
| JSON invalid | 400 | request syntactically invalid |
| validation gagal | 400 atau 422 | tergantung API policy |
| tidak authenticated | 401 | perlu challenge/auth info bila sesuai |
| authenticated tapi tidak authorized | 403 | jangan bocorkan detail sensitif |
| resource tidak ditemukan | 404 | bisa juga dipakai untuk hide existence |
| state conflict | 409 | cocok untuk invalid transition/optimistic lock |
| media type salah | 415 | `Content-Type` tidak didukung |
| accept tidak bisa dipenuhi | 406 | `Accept` tidak cocok |
| dependency down | 503 | jika temporary/unavailable |
| unexpected bug | 500 | jangan bocorkan stack trace |

Jersey memberi `ExceptionMapper`, tetapi taxonomy harus kamu desain.

---

## 37. Jersey dan Provider Selection sebagai Sumber Bug

Provider selection adalah invisible mechanism. Karena invisible, sering dilupakan.

Contoh:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public List<CaseResponse> listCases() {
    return service.list();
}
```

Masalah potensial:

- generic type hilang jika return lewat raw `Response` tanpa `GenericEntity` dalam beberapa kasus;
- writer tidak tahu element type;
- JSON provider tidak support object tertentu;
- `CaseResponse` punya field yang tidak bisa diserialisasi;
- ada dua JSON provider dan yang salah menang.

Contoh explicit generic response:

```java
List<CaseResponse> cases = service.list();
GenericEntity<List<CaseResponse>> entity = new GenericEntity<>(cases) {};
return Response.ok(entity).build();
```

Mental model:

```text
Return value bukan langsung bytes.
Return value harus melewati provider selection.
```

---

## 38. Jersey dan Context

Jersey menyediakan context object seperti:

- `UriInfo`;
- `HttpHeaders`;
- `Request`;
- `SecurityContext`;
- `Configuration`;
- `Application`;
- servlet-specific context jika module/container mendukung.

Contoh:

```java
@GET
public Response get(
        @Context UriInfo uriInfo,
        @Context HttpHeaders headers,
        @Context SecurityContext securityContext) {
    // use context
}
```

Context object adalah request-aware view terhadap runtime.

Bahaya:

```java
@Singleton
public class MyService {
    @Context
    private UriInfo uriInfo;
}
```

Jika object singleton menyimpan request-scoped context secara field, lifecycle bisa membingungkan. Beberapa injection mechanism memakai proxy, beberapa tidak sesuai ekspektasi. Lebih aman pass context value dari resource ke use case dalam bentuk command/context object yang eksplisit.

---

## 39. Jersey dan Thread Safety

Resource lifecycle memengaruhi thread safety.

Beberapa kemungkinan:

- resource instance dibuat per request;
- resource singleton;
- resource dibuat oleh DI container dengan scope tertentu;
- provider/filter sering singleton;
- service singleton;
- context object request-scoped/proxy.

Rule:

```text
Jangan simpan mutable request state di singleton provider/filter/resource.
```

Contoh buruk:

```java
@Provider
public class BadFilter implements ContainerRequestFilter {
    private String currentUser;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        this.currentUser = extractUser(requestContext);
    }
}
```

Provider bisa dipakai banyak request concurrently. Field `currentUser` bisa tercampur antar request.

Lebih baik:

```java
@Provider
public class GoodFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        String currentUser = extractUser(requestContext);
        requestContext.setProperty("currentUser", currentUser);
    }
}
```

Atau gunakan request-scoped context yang benar.

---

## 40. Jersey dan Observability Boundary

Observability di Jersey harus menangkap tahap-tahap penting:

```text
Request received
Resource matched
Authentication completed
Authorization completed
Entity read completed
Resource method duration
Outbound call duration
Exception mapped
Entity write completed
Response sent
```

Minimal production signal:

- correlation ID;
- method;
- path template, bukan hanya raw path;
- status;
- latency;
- exception class;
- error code;
- actor/tenant jika aman;
- request size;
- response size jika tersedia;
- outbound dependency latency;
- trace id/span id.

Path template penting karena raw path bisa high-cardinality:

```text
Buruk untuk metrics:
/cases/CASE-001
/cases/CASE-002
/cases/CASE-003

Baik:
/cases/{caseId}
```

Jakarta REST 4.0 menambahkan method terkait matched resource template pada `UriInfo`, sehingga observability berbasis template menjadi makin relevan di stack modern.

---

## 41. Jersey dan Testing Mental Model

Testing Jersey tidak cukup dengan unit test service.

Jenis behavior yang hanya terlihat jika Jersey runtime berjalan:

- request matching;
- parameter binding;
- `@Consumes`/`@Produces` negotiation;
- provider selection;
- exception mapper selection;
- filter ordering;
- interceptor behavior;
- validation integration;
- context injection;
- JSON serialization;
- multipart handling;
- SSE/async behavior.

Karena itu testing perlu beberapa lapis:

```text
Unit test
  - domain/service/mapper murni

Resource unit-ish test
  - resource method dengan mock service

Jersey runtime test
  - Jersey Test Framework / embedded container

Contract test
  - request/response JSON and status compatibility

Integration test
  - DB/external dependency/container/proxy where needed
```

Jika semua test memanggil method resource langsung:

```java
resource.approve("CASE-001", request);
```

maka kamu tidak mengetes Jersey behavior seperti media type, provider, filter, dan mapper.

---

## 42. Jersey dan Backward Compatibility

API backward compatibility bukan hanya Java method compatibility.

Untuk Jersey API, compatibility mencakup:

- path tetap;
- method HTTP tetap;
- request field compatibility;
- response field compatibility;
- enum evolution;
- error code stability;
- status code stability;
- header contract;
- pagination contract;
- sorting/filtering contract;
- idempotency behavior;
- authentication/authorization behavior;
- media type versioning.

Jersey membantu routing dan serialization, tetapi tidak otomatis menjaga compatibility.

Contoh breaking change yang sering tidak disadari:

```java
public record CaseResponse(
    String id,
    String status
) {}
```

berubah menjadi:

```java
public record CaseResponse(
    String id,
    CaseStatus status
) {}
```

Jika JSON output berubah dari:

```json
{
  "id": "CASE-001",
  "status": "APPROVED"
}
```

menjadi:

```json
{
  "id": "CASE-001",
  "status": {
    "code": "APPROVED",
    "label": "Approved"
  }
}
```

itu breaking untuk client walaupun Java code terlihat lebih kaya.

---

## 43. Jersey dan API Gateway / Reverse Proxy

Banyak behavior Jersey tampak salah padahal root cause ada di proxy.

Contoh:

- `UriInfo.getBaseUri()` menghasilkan internal host, bukan public host;
- generated link memakai `http` bukan `https`;
- path hilang karena rewrite;
- large upload dipotong proxy;
- SSE buffering oleh nginx;
- timeout lebih pendek di ALB daripada aplikasi;
- header `Authorization` tidak diteruskan;
- `X-Forwarded-*` tidak diproses;
- CORS preflight ditangani gateway, bukan Jersey.

Production mental model:

```text
Public HTTP contract mungkin berbeda dari internal servlet request.
```

Karena itu, saat membuat link, redirect, Location header, atau absolute URI, jangan hanya percaya internal request tanpa memahami proxy configuration.

---

## 44. Jersey dan Native/Cloud Runtime

Walaupun seri ini bukan tentang GraalVM/native image, cloud runtime penting untuk mental model.

Jersey banyak memakai:

- reflection;
- annotation scanning;
- provider discovery;
- DI integration;
- dynamic registration;
- JSON reflection;
- service loader.

Dalam cloud/container environment:

- startup time penting;
- memory footprint penting;
- classpath scanning bisa mahal;
- explicit registration lebih menarik;
- health/readiness endpoint penting;
- graceful shutdown penting;
- connection pool lifecycle penting;
- logging harus structured;
- metrics/tracing harus konsisten.

Dalam native image environment, reflection dan dynamic discovery perlu perhatian khusus. Walaupun tidak semua Jersey app menargetkan native image, explicit runtime graph tetap membuat aplikasi lebih predictable.

---

## 45. Minimal Production Checklist untuk Jersey App

Sebelum menyebut aplikasi Jersey production-ready, minimal jawab ini:

### 45.1 Bootstrap

- Apakah resource/provider registration deterministic?
- Apakah package scanning sengaja dipakai?
- Apakah dependency `javax`/`jakarta` konsisten?
- Apakah startup failure fail-fast?
- Apakah config divalidasi saat startup?

### 45.2 Request handling

- Apakah path/method/media type jelas?
- Apakah validation boundary jelas?
- Apakah body size limit ada?
- Apakah file upload aman?
- Apakah request body logging tidak merusak stream?

### 45.3 Response handling

- Apakah response status konsisten?
- Apakah error contract stabil?
- Apakah JSON provider dikontrol?
- Apakah entity JPA tidak langsung terekspos?
- Apakah streaming endpoint cleanup aman?

### 45.4 Security

- Apakah authentication jelas owner-nya?
- Apakah authorization tidak hanya role-level?
- Apakah object-level authorization ada bila perlu?
- Apakah security failure tidak bocor detail?
- Apakah audit event terbentuk?

### 45.5 Observability

- Apakah correlation ID selalu ada?
- Apakah trace propagated ke outbound call?
- Apakah metrics memakai path template?
- Apakah error code dan exception class tercatat?
- Apakah log masking aman?

### 45.6 Client

- Apakah Jersey Client reusable?
- Apakah timeout eksplisit?
- Apakah response selalu ditutup?
- Apakah retry idempotent?
- Apakah pool dikonfigurasi?
- Apakah TLS/proxy config jelas?

### 45.7 Deployment

- Apakah health/readiness endpoint benar?
- Apakah graceful shutdown diuji?
- Apakah proxy path/base URI benar?
- Apakah timeout proxy/container/app selaras?
- Apakah dependency version locked?

---

## 46. Cara Berpikir “Top 1%” terhadap Jersey

Engineer biasa bertanya:

```text
Annotation apa yang harus dipakai?
```

Engineer kuat bertanya:

```text
Runtime behavior apa yang akan terjadi?
```

Engineer top-tier bertanya:

```text
Apa invariant boundary-nya?
Apa failure mode-nya?
Apa ownership-nya?
Apa observability-nya?
Apa migration path-nya?
Apa compatibility contract-nya?
Apa konsekuensi production-nya?
```

Untuk Jersey, ini berarti:

1. Memahami resource model, bukan hanya resource class.
2. Memahami provider selection, bukan hanya JSON dependency.
3. Memahami pipeline, bukan hanya filter.
4. Memahami lifecycle, bukan hanya injection.
5. Memahami container boundary, bukan hanya endpoint.
6. Memahami error taxonomy, bukan hanya exception mapper.
7. Memahami client runtime, bukan hanya `.get()` dan `.post()`.
8. Memahami compatibility, bukan hanya passing test.
9. Memahami deployment reality, bukan hanya local run.
10. Memahami security/audit semantics, bukan hanya `@RolesAllowed`.

---

## 47. Mini Case Study: “Endpoint Ada Tapi 404”

Masalah:

```text
GET /api/cases/123 menghasilkan 404.
Developer yakin CaseResource punya @GET /cases/{id}.
```

Jangan langsung bilang resource salah. Gunakan layer reasoning.

Kemungkinan:

```text
Client calls:       /api/cases/123
API gateway rewrites to: /cases/123 or /api/cases/123?
Servlet mapping:   /api/* or /*?
ApplicationPath:   /api or /?
Resource class:    /cases
Method path:       /{id}
Package scanned?   yes/no?
Resource registered? yes/no?
Jersey app loaded? yes/no?
```

Contoh kombinasi salah:

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.wrongpackage");
    }
}
```

`CaseResource` ada, tetapi tidak terdaftar karena package salah.

Atau:

```text
Gateway sudah strip /api sebelum masuk app.
ApplicationPath juga /api.
```

Client memanggil:

```text
/api/cases/123
```

Gateway meneruskan:

```text
/cases/123
```

Tetapi Jersey berharap:

```text
/api/cases/123
```

Hasil: 404.

Moral:

```text
404 bisa berasal dari routing boundary, bukan resource method.
```

---

## 48. Mini Case Study: “Endpoint Sukses Lokal, 415 di UAT”

Masalah:

```text
POST /cases/123/approval bekerja di local, tetapi UAT menghasilkan 415 Unsupported Media Type.
```

Kemungkinan:

1. Client tidak mengirim `Content-Type: application/json`.
2. Gateway menghapus atau mengganti header.
3. Resource punya `@Consumes("application/json")`, tetapi client mengirim `application/json;charset=UTF-8` dan provider/config bermasalah.
4. UAT tidak punya JSON provider dependency.
5. Deployment UAT memakai Jersey/Jackson version berbeda.
6. Request body dikirim sebagai form-data.
7. Ada filter yang mengubah content type.

Diagnostic:

```text
Cek raw request di gateway/access log.
Cek Content-Type aktual yang sampai container.
Cek resource @Consumes.
Cek provider registration.
Cek dependency tree UAT.
Cek apakah body stream dibaca sebelumnya.
```

Moral:

```text
415 adalah media/entity pipeline problem, bukan otomatis business logic problem.
```

---

## 49. Mini Case Study: “No MessageBodyWriter for List”

Masalah:

```text
Endpoint return List<CaseResponse>, tetapi runtime gagal menulis JSON.
```

Kemungkinan:

1. JSON provider tidak ada.
2. Media type tidak `application/json`.
3. Return type generic hilang karena dibungkus Response secara raw.
4. Ada provider custom yang override provider JSON.
5. DTO mengandung field unsupported.
6. Dependency Jackson/JSON-B conflict.

Solusi tergantung akar masalah.

Jika generic hilang:

```java
List<CaseResponse> cases = service.listCases();
GenericEntity<List<CaseResponse>> entity = new GenericEntity<>(cases) {};
return Response.ok(entity).build();
```

Jika provider tidak ada:

```java
register(JacksonFeature.class);
```

atau gunakan provider JSON-B sesuai strategi aplikasi.

Moral:

```text
Jersey tidak menulis object secara magic.
Ia memilih MessageBodyWriter berdasarkan type, generic type, annotation, dan media type.
```

---

## 50. Design Heuristics

Gunakan heuristik ini saat mendesain Jersey API:

1. Resource adalah HTTP adapter.
2. Use case tidak return `Response`.
3. Domain tidak import `jakarta.ws.rs`.
4. DTO request/response stabil dan eksplisit.
5. Entity persistence tidak langsung diserialisasi.
6. Error contract dipusatkan di mapper.
7. Filter untuk cross-cutting concern, bukan business logic.
8. Interceptor untuk entity stream concern, bukan authorization umum.
9. Provider registration harus eksplisit untuk production-critical behavior.
10. Jersey Client harus reusable dan punya timeout.
11. Jangan baca request body dua kali tanpa buffering strategy.
12. Jangan simpan request state di singleton provider.
13. Jangan campur DI ownership tanpa aturan.
14. Jangan mengandalkan default provider tanpa mengetahui dependency.
15. Jangan menunggu incident baru menambahkan correlation ID.
16. Jangan membuat API compatibility bergantung pada internal entity shape.
17. Jangan treat 500 sebagai semua error.
18. Jangan treat 404/403 tanpa security policy.
19. Jangan expose raw exception message ke client.
20. Jangan deploy tanpa contract test untuk resource behavior penting.

---

## 51. Checklist Pemahaman Part 1

Kamu dianggap memahami Part 1 jika bisa menjawab:

1. Apa beda Jakarta REST specification dan Jersey implementation?
2. Apa beda `jakarta.ws.rs.*` dan `org.glassfish.jersey.*`?
3. Apa itu resource model?
4. Apa itu provider registry?
5. Apa itu request pipeline?
6. Di tahap mana `MessageBodyReader` bekerja?
7. Di tahap mana `MessageBodyWriter` bekerja?
8. Kenapa `ExceptionMapper` bukan pengganti error taxonomy?
9. Kenapa resource class sebaiknya tipis?
10. Kenapa service layer tidak sebaiknya return `Response`?
11. Kenapa `Client` Jersey sebaiknya reusable?
12. Kenapa 404 bisa berasal dari proxy/application path/scanning?
13. Kenapa 415 bisa berasal dari content-type/provider?
14. Kenapa injection problem sering merupakan ownership problem?
15. Kenapa Java 8 sampai 25 harus dipikir sebagai era runtime berbeda?
16. Apa konsekuensi `javax.ws.rs` vs `jakarta.ws.rs`?
17. Kenapa Jersey-specific API boleh dipakai tetapi harus sadar?
18. Apa minimal production checklist untuk Jersey app?
19. Bagaimana membaca Jersey dalam regulatory/case-management system?
20. Apa bedanya debugging resource method dengan debugging Jersey runtime?

---

## 52. Latihan Praktis

### Latihan 1 — Boundary Classification

Ambil satu endpoint existing, lalu klasifikasikan setiap concern:

```text
Concern                         Owner
------------------------------------------------
Path/method mapping             ?
Request DTO                     ?
Validation                      ?
Authentication                  ?
Authorization                   ?
Business transition             ?
Transaction                     ?
Audit                           ?
Error mapping                   ?
Response DTO                    ?
Serialization                   ?
Logging                         ?
Metrics/tracing                 ?
```

Jika lebih dari lima concern besar ada langsung di resource method, resource terlalu gemuk.

### Latihan 2 — Failure Stage Mapping

Untuk setiap error berikut, tentukan kemungkinan stage:

```text
404
405
406
415
400 JSON parse error
No MessageBodyWriter
Unsatisfied dependency
ConstraintViolationException
Client timeout
Connection pool exhausted
LazyInitializationException saat response
```

Tujuannya bukan hafalan, tetapi membiasakan mapping error ke pipeline.

### Latihan 3 — Vendor Lock-in Audit

Cari semua import:

```text
jakarta.ws.rs.*
javax.ws.rs.*
org.glassfish.jersey.*
```

Kelompokkan:

```text
Portable spec API
Jersey-specific API
Legacy javax API
Mixed namespace risk
```

### Latihan 4 — Resource Thinness Review

Untuk satu resource method, hitung:

- jumlah baris;
- jumlah dependency yang dipanggil;
- apakah ada SQL/repository langsung;
- apakah ada authorization manual;
- apakah ada audit manual;
- apakah ada try-catch besar;
- apakah return `Response` dibuat di banyak cabang;
- apakah domain logic bisa dipindahkan ke use case.

### Latihan 5 — Response Serialization Risk

Untuk satu DTO response, cek:

- apakah field-nya semua aman untuk public API;
- apakah ada entity JPA;
- apakah ada lazy property;
- apakah ada circular reference;
- apakah ada sensitive data;
- apakah ada enum yang mungkin berubah;
- apakah null handling jelas;
- apakah backward compatibility aman.

---

## 53. Ringkasan Part 1

Jersey harus dipahami sebagai runtime, bukan annotation library.

Mental model penting:

```text
Jakarta REST/JAX-RS = specification.
Jersey = implementation + runtime + extension ecosystem.
Servlet/container = HTTP execution environment.
DI container = object lifecycle owner.
JSON provider = entity serialization/deserialization engine.
Resource class = HTTP adapter.
Application service = use case owner.
Domain = business invariant owner.
ExceptionMapper = error translation boundary.
Filter/interceptor = pipeline extension, bukan tempat semua logic.
Jersey Client = outbound HTTP runtime, bukan helper disposable.
```

Part ini adalah fondasi untuk seluruh seri. Jika mental model ini kuat, part berikutnya tentang `ResourceConfig`, bootstrap, scanning, provider registration, dan startup graph akan jauh lebih mudah dipahami.

---

## 54. Referensi

- Eclipse Jersey official site — release lines and project overview: https://jersey.github.io/
- Eclipse Jersey 4.0.0 project release page — Jakarta EE 11/Jakarta REST 4.0 compatibility and major release notes: https://projects.eclipse.org/projects/ee4j.jersey/releases/4.0.0-0
- Jakarta RESTful Web Services 4.0 official specification page: https://jakarta.ee/specifications/restful-ws/4.0/
- Jakarta RESTful Web Services 4.0.0 project release page: https://projects.eclipse.org/projects/ee4j.rest/releases/4.0.0
- OpenJDK JDK 25 project page: https://openjdk.org/projects/jdk/25/

---

## 55. Status Series

Seri belum selesai.

Part yang sudah dibuat:

- Part 0 — Orientasi Seri Java Jersey Runtime Resource Client Extension Engineering
- Part 1 — Jersey Mental Model: Spec, Implementation, Runtime, and Engineering Boundary

Part berikutnya:

- Part 2 — Jersey Application Bootstrap: ResourceConfig, Application, Auto Discovery, and Startup Graph

Part terakhir yang direncanakan:

- Part 32 — Capstone: Building a Production-Grade Jersey Platform Module

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 0 — Orientasi Seri Java Jersey: Scope, Mental Model, Versi, dan Cara Belajar](./00-orientasi-seri-java-jersey-runtime-resource-client-extension-engineering.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 3 — Resource Model Internals: How Jersey Understands Resource Classes](./03-resource-model-internals-how-jersey-understands-resource-classes.md)

</div>