# Part 3 — Resource Model Internals: How Jersey Understands Resource Classes

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `03-resource-model-internals-how-jersey-understands-resource-classes.md`  
Status: Part 3 dari 32  
Target Java: 8 sampai 25  
Target Jersey: Jersey 2.x (`javax.ws.rs`), Jersey 3.x/4.x (`jakarta.ws.rs`)

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 0 kita menetapkan orientasi seri: Jersey dipelajari sebagai runtime, bukan sekadar library anotasi REST.

Pada Part 1 kita membangun mental model: Jakarta REST/JAX-RS adalah spesifikasi; Jersey adalah implementasi runtime yang membangun routing, injection, provider pipeline, client runtime, dan extension surface.

Pada Part 2 kita membahas bootstrap: `Application`, `ResourceConfig`, scanning, registration, auto-discovery, dan startup graph.

Part 3 ini masuk ke bagian yang sangat penting:

> Bagaimana Jersey membaca class Java dan mengubahnya menjadi resource model internal yang dapat dipakai untuk mencocokkan request HTTP ke method Java tertentu.

Ini bukan sekadar “beri `@Path` lalu jalan”. Jersey perlu menjawab banyak pertanyaan sebelum endpoint bisa dipanggil:

- Class mana yang dianggap root resource?
- Method mana yang dianggap resource method?
- Method mana yang dianggap sub-resource locator?
- Path mana yang membentuk resource tree?
- Annotation mana yang berlaku dari class, interface, superclass, atau method?
- Parameter apa saja yang bisa di-inject saat method dipanggil?
- Apakah ada ambiguity?
- Apakah model valid saat startup?
- Apakah resource class dibuat per request, singleton, CDI-managed, Spring-managed, atau HK2-managed?
- Apakah method tertentu bisa dipanggil melalui HTTP method tertentu dan media type tertentu?

Kalau kamu memahami resource model, kamu tidak hanya bisa menulis endpoint. Kamu bisa membaca API surface sebagai graph, menganalisis routing failure, menghindari ambiguity, mendesain resource class yang maintainable, dan men-debug error yang biasanya terlihat seperti “Jersey tiba-tiba tidak menemukan endpoint”.

---

## 1. Core Mental Model

### 1.1 Resource Class Bukan Controller Biasa

Dalam banyak framework, kita terbiasa menyebut class HTTP boundary sebagai “controller”. Di Jersey/JAX-RS, konsep yang lebih akurat adalah **resource class**.

Resource class bukan hanya tempat method HTTP. Ia adalah deklarasi terhadap:

```text
URI space + HTTP operation + representation contract + runtime injectable context
```

Contoh sederhana:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{caseId}")
    @Produces(MediaType.APPLICATION_JSON)
    public CaseResponse getCase(@PathParam("caseId") String caseId) {
        // ...
    }
}
```

Secara dangkal, kita melihat satu endpoint:

```text
GET /cases/{caseId}
```

Tetapi Jersey membaca ini sebagai model:

```text
Root resource:
  class: CaseResource
  class path: /cases

Resource method:
  Java method: getCase(String)
  HTTP method: GET
  method path: /{caseId}
  produced media types: application/json
  parameters:
    caseId <- URI path variable "caseId"
```

Lalu runtime menggunakan model ini untuk request matching.

### 1.2 Resource Model Adalah Graph, Bukan Daftar Endpoint Flat

Kesalahan umum: menganggap semua endpoint adalah daftar flat seperti OpenAPI paths.

Di Jersey, model internal lebih dekat ke graph/tree:

```text
Application
└── Root Resource: /cases
    ├── Resource Method: GET /cases
    ├── Resource Method: POST /cases
    ├── Resource Method: GET /cases/{caseId}
    └── Sub-resource Locator: /cases/{caseId}/documents
        └── DocumentResource
            ├── Resource Method: GET /cases/{caseId}/documents
            └── Resource Method: POST /cases/{caseId}/documents
```

Sub-resource locator membuat struktur ini menjadi dinamis. Ia bisa mengembalikan object resource lain saat request matching berjalan.

### 1.3 Jersey Melakukan Dua Hal Berbeda

Ada dua fase besar:

```text
Startup phase:
  - discover classes
  - inspect annotations
  - build resource model
  - validate obvious model problems
  - register providers/features/binders

Request phase:
  - match incoming URI/method/media type against resource model
  - instantiate or obtain resource object
  - inject parameters/context
  - call filters/interceptors/providers
  - invoke Java method
  - map output to HTTP response
```

Part 3 fokus pada bagian pertama dan hubungannya dengan request phase.

---

## 2. Sumber Kebenaran: Specification vs Jersey Behavior

Jersey mengimplementasikan Jakarta REST/JAX-RS. Banyak konsep resource class, root resource, resource method, sub-resource locator, parameter injection, dan request matching berasal dari spesifikasi Jakarta REST. Dokumentasi Jersey menjelaskan resource class sebagai POJO yang dianotasi dan membedakan resource method serta sub-resource locator; sub-resource locator adalah method yang memiliki `@Path` tetapi tidak memiliki HTTP method annotation seperti `@GET`/`@POST`. Referensi resmi Jersey dan Jakarta REST menjadi baseline, sementara detail internal seperti class model, validation message, auto-discovery, dan HK2 integration adalah wilayah implementasi Jersey.

Praktisnya:

```text
Spec menentukan kontrak konseptual.
Jersey menentukan detail implementasi runtime.
Container/DI menentukan lifecycle tambahan.
```

Contoh:

- `@Path` adalah bagian dari Jakarta REST/JAX-RS.
- Bagaimana class ditemukan melalui package scanning adalah behavior Jersey/bootstrap.
- Bagaimana resource object dibuat bisa bergantung pada HK2/CDI/Spring/container.
- Pesan error saat ambiguous resource bisa spesifik Jersey.

Untuk engineer production, pemisahan ini penting karena saat terjadi error kamu harus tahu layer mana yang salah.

---

## 3. Anatomy Resource Class

### 3.1 Root Resource Class

Root resource class adalah class yang punya `@Path` di level class dan terdaftar di aplikasi Jersey.

```java
@Path("/cases")
public class CaseResource {
}
```

Class ini menjadi entry point URI matching.

Root resource biasanya didaftarkan lewat:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(CaseResource.class);
    }
}
```

atau package scanning:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
    }
}
```

Dalam production, explicit registration sering lebih aman karena startup graph lebih deterministik.

### 3.2 Resource Method

Resource method adalah method yang memiliki HTTP method annotation:

```java
@GET
public Response listCases() {
    return Response.ok().build();
}
```

HTTP method annotation standar:

```text
@GET
@POST
@PUT
@PATCH  (tersedia di Jakarta REST modern; di era lama sering custom)
@DELETE
@HEAD
@OPTIONS
```

Resource method boleh punya `@Path` tambahan:

```java
@GET
@Path("/{caseId}")
public Response getCase(@PathParam("caseId") String caseId) {
    return Response.ok().build();
}
```

Jika class path adalah `/cases`, maka method path menjadi `/cases/{caseId}`.

### 3.3 Sub-resource Method vs Sub-resource Locator

Ada dua konsep yang sering membingungkan.

#### Resource method dengan path tambahan

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{caseId}/documents")
    public Response listDocuments(@PathParam("caseId") String caseId) {
        return Response.ok().build();
    }
}
```

Ini tetap resource method karena ada HTTP method annotation `@GET`.

#### Sub-resource locator

```java
@Path("/cases")
public class CaseResource {

    @Path("/{caseId}/documents")
    public DocumentResource documents(@PathParam("caseId") String caseId) {
        return new DocumentResource(caseId);
    }
}
```

Ini sub-resource locator karena ada `@Path`, tetapi tidak ada `@GET`, `@POST`, dan sebagainya.

Sub-resource locator tidak langsung memproses HTTP operation. Ia mengembalikan resource object/class yang kemudian lanjut dicocokkan dengan sisa path dan HTTP method.

### 3.4 Sub-resource Class

```java
public class DocumentResource {

    private final String caseId;

    public DocumentResource(String caseId) {
        this.caseId = caseId;
    }

    @GET
    public Response listDocuments() {
        return Response.ok().build();
    }

    @POST
    public Response uploadDocument() {
        return Response.status(Response.Status.CREATED).build();
    }
}
```

Perhatikan: `DocumentResource` tidak harus punya `@Path` di level class jika ia hanya dipakai sebagai sub-resource dari locator.

Mental model:

```text
Root resource menemukan prefix path.
Sub-resource locator memilih object lanjutan.
Sub-resource object menangani sisa request.
```

---

## 4. Path Composition

### 4.1 Class Path + Method Path

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    public Response get(@PathParam("id") String id) {
        return Response.ok().build();
    }
}
```

Effective path:

```text
/cases/{id}
```

Jersey biasanya normal terhadap leading slash. Tetapi secara style, pilih satu standar. Saya sarankan:

```java
@Path("cases")
```

atau:

```java
@Path("/cases")
```

Keduanya bisa bekerja, tetapi konsistensi lebih penting.

### 4.2 Empty Method Path

```java
@Path("cases")
public class CaseResource {

    @GET
    public Response list() {
        return Response.ok().build();
    }
}
```

Effective path:

```text
GET /cases
```

### 4.3 Empty Sub-resource Locator Path

```java
@Path("cases")
public class CaseResource {

    @Path("")
    public CaseQueryResource queryResource() {
        return new CaseQueryResource();
    }
}
```

Ini advanced dan sering membingungkan. Empty sub-resource locator dapat membuat path matching sulit dibaca. Gunakan hanya jika ada alasan kuat, misalnya komposisi resource berdasarkan runtime state.

### 4.4 Path Segment vs Full Path

```java
@Path("cases/{caseId}/documents/{documentId}")
```

Ini mencampur beberapa level resource dalam satu class/method.

Alternatif:

```java
@Path("cases")
public class CaseResource {

    @Path("{caseId}/documents")
    public DocumentResource documents(@PathParam("caseId") String caseId) {
        return new DocumentResource(caseId);
    }
}
```

Pilihan bukan hanya teknis, tetapi desain:

- Flat method cocok untuk API kecil dan sederhana.
- Sub-resource cocok jika child resource punya banyak operasi dan lifecycle sendiri.
- Terlalu banyak sub-resource bisa membuat routing sulit dilacak.

---

## 5. Annotation Inheritance dan Override

### 5.1 Class, Interface, dan Superclass

JAX-RS/Jakarta REST memungkinkan annotation pada class, interface, atau method. Tetapi inheritance annotation bisa menjadi sumber kebingungan.

Contoh interface contract:

```java
@Path("cases")
public interface CaseApi {

    @GET
    @Path("{id}")
    @Produces(MediaType.APPLICATION_JSON)
    CaseResponse getCase(@PathParam("id") String id);
}
```

Implementasi:

```java
public class CaseResource implements CaseApi {

    @Override
    public CaseResponse getCase(String id) {
        return service.get(id);
    }
}
```

Ini bisa berguna untuk contract-first internal design. Tetapi ada trade-off:

- Annotation tersembunyi di interface.
- Developer yang membaca implementation mungkin tidak melihat routing langsung.
- OpenAPI generator atau scanner tertentu mungkin berperilaku berbeda.
- Override annotation di implementation bisa membingungkan.

Untuk tim enterprise, gunakan salah satu pendekatan secara konsisten:

```text
Approach A — Annotation dekat implementation:
  mudah dibaca oleh developer runtime/debugging.

Approach B — Annotation di interface contract:
  bagus untuk shared contract, tapi butuh discipline dan tooling.
```

### 5.2 Method Override Trap

Misalnya:

```java
public interface CaseApi {
    @GET
    @Path("{id}")
    CaseResponse getCase(@PathParam("id") String id);
}

@Path("cases")
public class CaseResource implements CaseApi {
    @Override
    @Path("by-id/{id}")
    public CaseResponse getCase(String id) {
        return service.get(id);
    }
}
```

Ini buruk karena pembaca harus memahami rule inheritance/override. Hindari mencampur annotation contract dan implementation override kecuali kamu punya test kontrak yang kuat.

### 5.3 Recommendation

Untuk production system yang banyak developer:

```text
Default recommendation:
  Letakkan @Path, @GET/@POST, @Consumes, @Produces di concrete resource class.

Gunakan interface annotation hanya jika:
  - contract dipakai lintas module,
  - ada generator/test yang memvalidasi,
  - tim sepakat style ini,
  - dokumentasi internal jelas.
```

---

## 6. Resource Method Signature

Resource method dapat menerima berbagai parameter:

```java
@GET
@Path("{caseId}")
public Response getCase(
        @PathParam("caseId") String caseId,
        @QueryParam("includeHistory") @DefaultValue("false") boolean includeHistory,
        @HeaderParam("X-Correlation-ID") String correlationId,
        @Context SecurityContext securityContext,
        @Context UriInfo uriInfo) {
    // ...
}
```

Jersey harus membangun parameter model untuk setiap parameter:

```text
Parameter 0:
  source: path
  name: caseId
  Java type: String

Parameter 1:
  source: query
  name: includeHistory
  Java type: boolean
  default: false

Parameter 2:
  source: header
  name: X-Correlation-ID
  Java type: String

Parameter 3:
  source: context
  type: SecurityContext

Parameter 4:
  source: context
  type: UriInfo
```

### 6.1 Entity Parameter

Resource method juga bisa punya body/entity parameter:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response createCase(CreateCaseRequest request) {
    // ...
}
```

`CreateCaseRequest` bukan `@Body` seperti di beberapa framework lain. Jersey/JAX-RS menyimpulkan bahwa parameter yang tidak diberi annotation tertentu adalah entity parameter.

Ini berarti signature berikut harus dibaca hati-hati:

```java
@POST
public Response createCase(CreateCaseRequest request, AuditContext auditContext) {
    // suspicious
}
```

Kalau `AuditContext` tidak diberi annotation injection/custom resolver, runtime bisa bingung atau menganggap ada lebih dari satu entity parameter.

Praktik aman:

```java
@POST
public Response createCase(
        CreateCaseRequest request,
        @Context SecurityContext securityContext) {
    // ...
}
```

atau gunakan injection field/constructor/service layer secara jelas.

### 6.2 Satu Entity Body Per Request

Secara HTTP, request body adalah satu stream. Secara model, resource method sebaiknya hanya punya satu entity parameter.

Buruk:

```java
@POST
public Response create(CreateCaseRequest request, Metadata metadata) {
    // which one comes from body?
}
```

Baik:

```java
public class CreateCaseRequest {
    public CasePayload payload;
    public Metadata metadata;
}

@POST
public Response create(CreateCaseRequest request) {
    // clear body contract
}
```

Untuk multipart, gunakan model multipart khusus, bukan dua entity JSON parameter.

---

## 7. Resource Model Validation Saat Startup

Jersey tidak menunggu semua problem sampai request pertama. Banyak model problem bisa diketahui saat startup.

Contoh problem:

- Duplicate resource method dengan path dan HTTP method sama.
- Ambiguous method selection.
- Invalid path template.
- Unsupported injection parameter.
- Missing provider tertentu.
- Resource class tidak bisa diinstansiasi.
- Constructor ambiguity.
- Dependency injection gagal.

Namun tidak semua problem pasti muncul saat startup.

Contoh yang bisa tertunda sampai request:

- MessageBodyReader tidak ditemukan untuk kombinasi runtime type + media type tertentu.
- MessageBodyWriter tidak ditemukan untuk response entity tertentu.
- Sub-resource locator mengembalikan object dengan state tertentu yang baru gagal pada request tertentu.
- Lazy initialization provider tertentu.
- Security/context-specific branch.

Mental model:

```text
Startup validation catches structural problems.
Request-time execution catches contextual and data-dependent problems.
```

### 7.1 Mengapa Startup Validation Penting

Dalam production, endpoint yang gagal di request pertama setelah deployment adalah risiko besar. Semakin eksplisit resource registration dan provider registration, semakin besar peluang error tertangkap saat startup.

Strategi:

```text
- Hindari scanning terlalu luas.
- Register resource secara eksplisit untuk core API.
- Aktifkan integration test yang boot Jersey runtime.
- Test minimal request untuk setiap endpoint penting.
- Test provider JSON/error mapper/filter.
```

---

## 8. Request Matching dan Resource Model

Part 4 nanti akan membedah request matching secara detail. Tapi Part 3 perlu memahami kaitannya.

Saat request masuk:

```text
GET /cases/123/documents?includeDeleted=false
Accept: application/json
```

Jersey melihat resource model:

```text
Root resources:
  /cases
  /users
  /reports
```

Lalu cocokkan:

```text
/cases -> CaseResource
/123/documents -> method path or sub-resource path
GET -> resource method HTTP verb
Accept -> @Produces compatibility
Content-Type -> @Consumes compatibility, jika ada body
```

Resource model yang ambigu menghasilkan behavior yang sulit diprediksi atau gagal validasi.

---

## 9. Ambiguity: Musuh Utama Resource Model

### 9.1 Ambiguous Path

```java
@Path("cases")
public class CaseResource {

    @GET
    @Path("{id}")
    public Response getById(@PathParam("id") String id) {
        return Response.ok().build();
    }

    @GET
    @Path("{reference}")
    public Response getByReference(@PathParam("reference") String reference) {
        return Response.ok().build();
    }
}
```

Untuk URI:

```text
GET /cases/ABC123
```

Keduanya match. Secara manusia, `id` dan `reference` berbeda. Secara path template, keduanya sama-sama satu segment variable.

Jangan mengandalkan nama variable untuk membedakan route.

Perbaikan:

```java
@GET
@Path("by-id/{id}")
public Response getById(@PathParam("id") String id) { ... }

@GET
@Path("by-reference/{reference}")
public Response getByReference(@PathParam("reference") String reference) { ... }
```

Atau gunakan query:

```text
GET /cases?id=...
GET /cases?reference=...
```

Tapi ini juga perlu desain semantik yang jelas.

### 9.2 Literal vs Variable

```java
@GET
@Path("search")
public Response search() { ... }

@GET
@Path("{id}")
public Response get(@PathParam("id") String id) { ... }
```

Request:

```text
GET /cases/search
```

Secara teori, literal `search` lebih spesifik daripada `{id}`. Tetapi dari sisi desain, route seperti ini tetap rawan saat ada reserved words.

Jika `id` bisa bernilai `search`, kamu punya conflict semantik.

Lebih aman:

```text
GET /cases/{id}
GET /cases:search
```

atau:

```text
GET /cases/search-results
GET /cases/{id}
```

Namun style `:search` perlu disepakati karena tidak semua organisasi menyukainya.

### 9.3 Regex Path Template

```java
@GET
@Path("{id: \\d+}")
public Response getByNumericId(@PathParam("id") String id) { ... }

@GET
@Path("{reference: [A-Z]{3}-\\d+}")
public Response getByReference(@PathParam("reference") String reference) { ... }
```

Regex bisa mengurangi ambiguity. Tetapi terlalu banyak regex di path bisa membuat API sulit dibaca dan sulit dipelihara.

Gunakan regex untuk membedakan format yang benar-benar stabil, bukan untuk menyembunyikan desain URI yang buruk.

### 9.4 Ambiguous Media Type

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response createJson(CreateCaseRequest request) { ... }

@POST
@Consumes("application/*")
public Response createAnyApplicationType(String body) { ... }
```

Untuk:

```text
Content-Type: application/json
```

Keduanya bisa cocok. Runtime akan memilih yang paling spesifik, tetapi desain seperti ini bisa membingungkan.

Production recommendation:

```text
Jangan campur endpoint spesifik dan catch-all di path/method yang sama kecuali kamu benar-benar punya fallback strategy yang jelas.
```

### 9.5 Ambiguous Sub-resource Locator

```java
@Path("cases")
public class CaseResource {

    @GET
    @Path("{caseId}")
    public Response getCase(@PathParam("caseId") String caseId) { ... }

    @Path("{caseId}")
    public CaseSubResource locateCase(@PathParam("caseId") String caseId) {
        return new CaseSubResource(caseId);
    }
}
```

Ini berbahaya karena path yang sama punya resource method dan locator. Walaupun beberapa request bisa tetap diarahkan dengan sisa path, pembaca model akan bingung.

Lebih jelas:

```java
@GET
@Path("{caseId}")
public Response getCase(@PathParam("caseId") String caseId) { ... }

@Path("{caseId}/workflow")
public CaseWorkflowResource workflow(@PathParam("caseId") String caseId) { ... }

@Path("{caseId}/documents")
public DocumentResource documents(@PathParam("caseId") String caseId) { ... }
```

---

## 10. Resource Class Lifecycle

Resource model tidak hanya berisi route. Ia juga terkait lifecycle object.

### 10.1 Per-request Resource

Default umum JAX-RS: resource class dibuat per request, kecuali diatur lain oleh runtime/DI.

Keuntungan:

- State instance aman untuk request-local data.
- Lebih sedikit risiko thread-safety.
- Cocok dengan field injection request context.

Kekurangan:

- Object allocation per request.
- Constructor harus ringan.
- Jangan melakukan expensive initialization di constructor.

Contoh aman:

```java
@Path("cases")
public class CaseResource {

    private final CaseService caseService;

    public CaseResource(CaseService caseService) {
        this.caseService = caseService;
    }
}
```

Constructor hanya menerima dependency, bukan membuka koneksi DB atau load config besar.

### 10.2 Singleton Resource

Resource bisa didaftarkan sebagai instance:

```java
register(new CaseResource(caseService));
```

Ini berarti object yang sama bisa dipakai banyak request.

Risiko:

```java
@Path("cases")
public class CaseResource {
    private String currentCaseId; // dangerous in singleton

    @GET
    @Path("{id}")
    public Response get(@PathParam("id") String id) {
        this.currentCaseId = id;
        return Response.ok(service.get(this.currentCaseId)).build();
    }
}
```

Dalam singleton, field mutable seperti ini bisa race antar request.

Rule:

```text
Singleton resource harus stateless atau thread-safe.
Request-scoped state jangan disimpan di field singleton.
```

### 10.3 CDI/Spring-managed Resource

Jika Jersey diintegrasikan dengan CDI/Spring, lifecycle bisa berubah:

```java
@Component
@Path("cases")
public class CaseResource {
    private final CaseService service;

    public CaseResource(CaseService service) {
        this.service = service;
    }
}
```

Di sini resource mungkin dikelola Spring sebagai singleton. Maka rule thread-safety Spring singleton berlaku.

Jika menggunakan CDI `@RequestScoped`, resource bisa request-scoped.

Konsekuensi:

```text
Resource model menjelaskan route.
DI container menjelaskan object lifecycle.
Keduanya harus dibaca bersama.
```

---

## 11. Constructor, Field, dan Method Injection

### 11.1 Constructor Injection

Constructor injection bagus untuk dependency mandatory:

```java
@Path("cases")
public class CaseResource {

    private final CaseService caseService;

    @Inject
    public CaseResource(CaseService caseService) {
        this.caseService = caseService;
    }
}
```

Keuntungan:

- Dependency eksplisit.
- Object tidak bisa dibuat dalam state invalid.
- Test lebih mudah.

Risiko:

- Tergantung integration HK2/CDI/Spring.
- Constructor terlalu banyak parameter menandakan resource melakukan terlalu banyak hal.

### 11.2 Field Injection

```java
@Path("cases")
public class CaseResource {

    @Inject
    private CaseService caseService;
}
```

Mudah, tetapi kurang eksplisit. Untuk resource boundary yang penting, constructor injection lebih mudah dijaga.

### 11.3 `@Context` Injection

```java
@Context
private HttpHeaders headers;

@Context
private UriInfo uriInfo;

@Context
private SecurityContext securityContext;
```

Field `@Context` bisa terlihat praktis, tetapi hati-hati dengan lifecycle. Jika resource singleton, request context biasanya diproxy oleh runtime, tetapi jangan menyimpan hasil request-specific ke field mutable.

Aman:

```java
@GET
public Response list(@Context UriInfo uriInfo) {
    URI requestUri = uriInfo.getRequestUri();
    return Response.ok().build();
}
```

Lebih jelas karena context digunakan sebagai parameter method.

---

## 12. Resource Class Design: Boundary, Not Business Engine

Resource class sering menjadi tempat semua logic karena mudah.

Buruk:

```java
@Path("cases")
public class CaseResource {

    @POST
    public Response create(CreateCaseRequest request) {
        validateRequest(request);
        User user = parseJwt();
        CaseEntity entity = new CaseEntity();
        entity.setStatus("DRAFT");
        entity.setCreatedBy(user.getId());
        repository.save(entity);
        auditRepository.insert(...);
        emailClient.send(...);
        return Response.ok(...).build();
    }
}
```

Masalah:

- Resource menjadi transaction script besar.
- HTTP concern bercampur domain concern.
- Testing sulit.
- Reuse rendah.
- Error handling kacau.
- Audit/security boundary tidak jelas.

Lebih baik:

```java
@Path("cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final CaseCommandService commandService;
    private final CaseDtoMapper mapper;

    @Inject
    public CaseResource(CaseCommandService commandService, CaseDtoMapper mapper) {
        this.commandService = commandService;
        this.mapper = mapper;
    }

    @POST
    public Response createCase(
            CreateCaseRequest request,
            @Context SecurityContext securityContext,
            @Context UriInfo uriInfo) {

        CreateCaseCommand command = mapper.toCommand(request, securityContext.getUserPrincipal());
        CreatedCase result = commandService.create(command);

        URI location = uriInfo.getAbsolutePathBuilder()
                .path(result.caseId())
                .build();

        return Response.created(location)
                .entity(mapper.toResponse(result))
                .build();
    }
}
```

Resource bertugas:

```text
- menerima HTTP input
- mengambil context yang relevan
- melakukan mapping ke application command/query
- memanggil service layer
- membentuk HTTP response
```

Service layer bertugas:

```text
- domain rule
- transaction
- workflow transition
- audit semantic
- integration orchestration
```

---

## 13. Resource Model as API Surface Contract

Resource model adalah kontrak publik/internal. Jangan desain seperti struktur class biasa.

Contoh buruk:

```java
@Path("caseService")
public class CaseServiceResource {

    @POST
    @Path("createCase")
    public Response createCase(...) { ... }

    @POST
    @Path("updateCase")
    public Response updateCase(...) { ... }

    @POST
    @Path("deleteCase")
    public Response deleteCase(...) { ... }
}
```

Ini RPC-style over HTTP. Kadang valid untuk internal command endpoint, tetapi jangan mengklaim ini resource-oriented API.

Lebih resource-oriented:

```text
POST   /cases
GET    /cases/{caseId}
PATCH  /cases/{caseId}
DELETE /cases/{caseId}
```

Untuk workflow action:

```text
POST /cases/{caseId}/submission
POST /cases/{caseId}/approval
POST /cases/{caseId}/rejection
POST /cases/{caseId}/assignment
```

Atau command-style eksplisit:

```text
POST /cases/{caseId}:submit
POST /cases/{caseId}:approve
POST /cases/{caseId}:reject
```

Keduanya bisa dipilih. Yang penting: konsisten, jelas, dan defendable.

---

## 14. Designing Resource Boundaries for Complex Enterprise Domains

Untuk sistem enforcement/case management, resource boundary tidak boleh hanya mengikuti tabel database.

Contoh domain:

```text
Case
├── Parties
├── Documents
├── Allegations
├── Inspections
├── Notices
├── Decisions
├── Appeals
├── Assignments
├── Audit Trail
└── Workflow State
```

Resource design bisa seperti:

```text
/cases
/cases/{caseId}
/cases/{caseId}/parties
/cases/{caseId}/documents
/cases/{caseId}/notices
/cases/{caseId}/decisions
/cases/{caseId}/appeals
/cases/{caseId}/events
/cases/{caseId}/timeline
/cases/{caseId}/workflow
```

Tetapi jangan otomatis membuat sub-resource class untuk semuanya. Tanyakan:

```text
Apakah child resource punya banyak operation?
Apakah authorization berbeda?
Apakah audit berbeda?
Apakah transaction boundary berbeda?
Apakah DTO lifecycle berbeda?
Apakah team ownership berbeda?
Apakah testing perlu dipisah?
```

Jika ya, sub-resource/class terpisah masuk akal.

Jika tidak, method sederhana di parent resource cukup.

---

## 15. Sub-resource Locator: Kapan Dipakai?

Sub-resource locator powerful, tetapi jangan digunakan hanya karena terlihat rapi.

### 15.1 Cocok Dipakai Jika

```text
- Child resource punya banyak endpoint.
- Child resource perlu state dari parent path, misalnya caseId.
- Child resource bisa dipilih secara dinamis.
- Ada modularisasi resource berdasarkan domain area.
- Ada authorization/context yang diwariskan dari parent.
```

Contoh:

```java
@Path("cases")
public class CaseResource {

    private final DocumentResourceFactory documentResourceFactory;

    @Inject
    public CaseResource(DocumentResourceFactory documentResourceFactory) {
        this.documentResourceFactory = documentResourceFactory;
    }

    @Path("{caseId}/documents")
    public DocumentResource documents(@PathParam("caseId") String caseId) {
        return documentResourceFactory.create(caseId);
    }
}
```

### 15.2 Tidak Cocok Jika

```text
- Hanya ada satu method child.
- Membuat routing sulit dilacak.
- Lifecycle object tidak jelas.
- Factory membuat banyak dependency tersembunyi.
- Authorization parent/child menjadi kabur.
```

Buruk:

```java
@Path("cases")
public class CaseResource {
    @Path("{caseId}")
    public Object route(@PathParam("caseId") String caseId) {
        if (caseId.startsWith("A")) return new ACaseResource();
        if (caseId.startsWith("B")) return new BCaseResource();
        return new DefaultCaseResource();
    }
}
```

Ini membuat API surface terlalu dinamis dan sulit dianalisis.

### 15.3 Better Dynamic Routing Pattern

Jika variasi behavior berdasarkan type/status, pertimbangkan tetap route statis dan delegasi ke service strategy:

```java
@GET
@Path("{caseId}")
public CaseResponse get(@PathParam("caseId") String caseId) {
    return caseQueryService.get(caseId);
}
```

Lalu service menentukan strategy domain.

---

## 16. Resource Model dan Media Type Contract

Annotation `@Consumes` dan `@Produces` bisa di class atau method.

```java
@Path("cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    @POST
    public Response create(CreateCaseRequest request) { ... }

    @GET
    @Path("{id}")
    public CaseResponse get(@PathParam("id") String id) { ... }
}
```

Class-level media type menjadi default untuk method. Method-level bisa override.

```java
@GET
@Path("{id}/pdf")
@Produces("application/pdf")
public Response downloadPdf(@PathParam("id") String id) { ... }
```

Design recommendation:

```text
- Letakkan media type umum di class.
- Override di method hanya untuk endpoint yang benar-benar berbeda.
- Jangan biarkan default terlalu implicit untuk API publik.
```

Masalah umum:

```java
@Path("reports")
@Produces(MediaType.APPLICATION_JSON)
public class ReportResource {

    @GET
    @Path("{id}/export")
    public Response exportCsv(...) { ... } // lupa @Produces text/csv
}
```

Akibatnya response bisa diproses dengan writer yang salah atau client menerima content-type yang menyesatkan.

---

## 17. Resource Model dan HTTP Method Semantics

Resource method bukan hanya route. HTTP method annotation membawa semantik.

```text
GET     safe, idempotent, read representation
POST    create/process command/non-idempotent by default
PUT     replace/upsert, idempotent
PATCH   partial update, idempotency depends design
DELETE  remove/cancel, idempotency depends design but usually intended idempotent
```

Jersey tidak memaksa domain kamu benar. Kamu bisa membuat:

```java
@GET
@Path("{id}/approve")
public Response approve(@PathParam("id") String id) { ... }
```

Secara teknis bisa, tapi secara semantik buruk karena GET tidak boleh mengubah state.

Untuk workflow:

```java
@POST
@Path("{id}/approval")
public Response approve(@PathParam("id") String id, ApproveRequest request) { ... }
```

atau:

```java
@POST
@Path("{id}:approve")
public Response approve(@PathParam("id") String id, ApproveRequest request) { ... }
```

Resource model yang baik mencerminkan intensi operasi.

---

## 18. Resource Model dan HEAD/OPTIONS

Banyak developer lupa bahwa JAX-RS/Jersey punya behavior untuk `HEAD` dan `OPTIONS`.

Umumnya:

- `HEAD` dapat diproses berdasarkan `GET` tanpa response body.
- `OPTIONS` bisa dihasilkan runtime untuk allowed methods atau bisa diimplementasikan sendiri.

Implikasi:

```text
Jangan menganggap hanya method yang kamu tulis secara eksplisit yang bisa terlihat oleh client/proxy/tooling.
```

Jika API gateway/security policy memerlukan kontrol ketat, uji `OPTIONS` dan `HEAD` juga.

---

## 19. Resource Class Granularity

### 19.1 Terlalu Besar

```text
CaseResource.java
  3000 lines
  90 endpoints
  create/update/delete/search/export/assign/approve/reject/comment/document/email/audit/report
```

Masalah:

- Sulit review.
- Konflik merge tinggi.
- Authorization tersebar.
- Mapper terlalu banyak.
- Test berat.
- Resource model sulit dibaca.

### 19.2 Terlalu Kecil

```text
CreateCaseResource
UpdateCaseResource
DeleteCaseResource
GetCaseResource
SearchCaseResource
ApproveCaseResource
RejectCaseResource
```

Masalah:

- Terlalu banyak class.
- Navigasi sulit.
- Shared concern terduplikasi.
- Route grouping hilang.

### 19.3 Heuristic Granularity

Pisahkan resource class ketika ada perbedaan signifikan pada:

```text
- URI subtree
- authorization model
- DTO family
- workflow lifecycle
- transaction boundary
- team ownership
- operational profile
- provider/media type
- testing strategy
```

Contoh sehat:

```text
CaseResource
CaseDocumentResource
CaseWorkflowResource
CaseAssignmentResource
CaseTimelineResource
CaseExportResource
```

---

## 20. DTO Mapping dan Resource Model

Resource model jangan bocor ke persistence model.

Buruk:

```java
@GET
@Path("{id}")
public CaseEntity get(@PathParam("id") String id) {
    return repository.find(id);
}
```

Risiko:

- Lazy proxy serialization.
- Field internal bocor.
- Circular reference.
- Persistence schema menjadi API contract.
- Security leak.
- Versioning sulit.

Baik:

```java
@GET
@Path("{id}")
public CaseResponse get(@PathParam("id") String id) {
    CaseView view = queryService.getCaseView(id);
    return mapper.toResponse(view);
}
```

Resource method signature adalah API contract. Jangan isi dengan entity persistence kecuali untuk prototyping internal yang sangat terbatas.

---

## 21. Resource Model dan Authorization Boundary

Ada beberapa level authorization:

```text
1. Endpoint-level authorization
2. Resource instance-level authorization
3. Field-level/data-level authorization
4. Action/workflow-level authorization
```

Resource model membantu endpoint-level:

```java
@RolesAllowed("CASE_VIEWER")
@GET
@Path("{caseId}")
public CaseResponse get(@PathParam("caseId") String caseId) { ... }
```

Tetapi object-level harus di service/domain:

```java
caseAuthorization.assertCanView(user, caseId);
```

Jangan percaya resource model saja untuk enforcement domain.

Untuk regulatory-grade system, audit perlu tahu:

```text
- endpoint apa yang dipanggil
- user/principal siapa
- role/authority apa
- caseId/resourceId apa
- action apa
- outcome apa
- failure reason apa jika ditolak
```

Resource model menyediakan metadata route, tapi domain service menyediakan semantic action.

---

## 22. Resource Model dan Audit Trail

Audit filter bisa menangkap generic HTTP event:

```text
POST /cases/123/approval -> 200
```

Tapi audit bisnis butuh semantic event:

```text
CASE_APPROVED
caseId=123
approvedBy=userA
previousState=PENDING_REVIEW
newState=APPROVED
reasonCode=...
```

Jangan menaruh semua audit di filter. Filter bagus untuk technical access log. Domain audit harus di service layer.

Resource model tetap membantu sebagai source:

```text
http.method
matched.resource.class
matched.resource.method
path.template
correlation.id
principal
```

Pada Jersey, informasi matched resource/method bisa diakses melalui context/monitoring/event listener tergantung versi dan extension yang digunakan. Untuk Part observability nanti kita bahas lebih dalam.

---

## 23. Resource Model dan Transaction Boundary

Resource class sebaiknya bukan pemilik utama transaction complexity.

Buruk:

```java
@POST
@Path("{id}/approve")
@Transactional
public Response approve(...) {
    // many domain steps
}
```

Lebih baik:

```java
@POST
@Path("{id}/approval")
public Response approve(...) {
    ApproveCaseCommand command = mapper.toCommand(...);
    ApproveCaseResult result = caseWorkflowService.approve(command);
    return Response.ok(mapper.toResponse(result)).build();
}
```

`caseWorkflowService.approve` menjadi transaction boundary.

Kenapa?

- Resource method adalah transport boundary.
- Service method adalah application use-case boundary.
- Transaction harus mengikuti use-case, bukan HTTP class.
- Satu use-case bisa dipanggil dari HTTP, batch, message consumer, atau admin job.

---

## 24. Resource Model dan Package Organization

Package mempengaruhi scanning dan readability.

Contoh buruk:

```text
com.example.api
  CaseResource
  UserEntity
  EmailService
  AuditRepository
  JsonUtil
```

Lebih baik:

```text
com.example.caseapi
  resource
    CaseResource
    CaseDocumentResource
    CaseWorkflowResource
  dto
    CreateCaseRequest
    CaseResponse
    ApproveCaseRequest
  mapper
    CaseApiMapper
  error
    CaseErrorCode
```

Atau by domain:

```text
com.example.caseapp.cases.api
com.example.caseapp.cases.application
com.example.caseapp.cases.domain
com.example.caseapp.cases.infrastructure
```

Jersey scanning sebaiknya diarahkan ke package resource/provider, bukan seluruh application package.

```java
packages("com.example.caseapp.cases.api.resource");
```

Namun explicit registration lebih deterministik:

```java
register(CaseResource.class);
register(CaseDocumentResource.class);
register(CaseWorkflowResource.class);
```

---

## 25. How Jersey Sees a Resource Class: Step-by-Step Mental Simulation

Ambil contoh:

```java
@Path("cases")
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    @GET
    public List<CaseSummaryResponse> search(
            @QueryParam("status") List<String> statuses,
            @QueryParam("assignee") String assignee) {
        return List.of();
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    public Response create(CreateCaseRequest request, @Context UriInfo uriInfo) {
        URI location = uriInfo.getAbsolutePathBuilder().path("123").build();
        return Response.created(location).build();
    }

    @GET
    @Path("{caseId}")
    public CaseResponse get(@PathParam("caseId") String caseId) {
        return new CaseResponse();
    }

    @Path("{caseId}/documents")
    public CaseDocumentResource documents(@PathParam("caseId") String caseId) {
        return new CaseDocumentResource(caseId);
    }
}
```

Jersey membangun kira-kira:

```text
Root resource:
  path: cases
  class: CaseResource
  default produces: application/json

Method 1:
  kind: resource method
  http method: GET
  path: <empty>
  effective path: /cases
  produces: application/json
  params:
    statuses <- query status, List<String>
    assignee <- query assignee, String
  return:
    List<CaseSummaryResponse>

Method 2:
  kind: resource method
  http method: POST
  path: <empty>
  effective path: /cases
  consumes: application/json
  produces: application/json inherited
  params:
    request <- entity body CreateCaseRequest
    uriInfo <- context UriInfo
  return:
    Response

Method 3:
  kind: resource method
  http method: GET
  path: {caseId}
  effective path: /cases/{caseId}
  produces: application/json
  params:
    caseId <- path caseId
  return:
    CaseResponse

Method 4:
  kind: sub-resource locator
  path: {caseId}/documents
  effective prefix: /cases/{caseId}/documents
  params:
    caseId <- path caseId
  return:
    CaseDocumentResource
```

Jika request:

```text
GET /cases/123/documents
```

Flow:

```text
1. Match root /cases -> CaseResource
2. Remaining path: /123/documents
3. Match sub-resource locator {caseId}/documents
4. Invoke locator with caseId=123
5. Receive CaseDocumentResource
6. Continue matching inside CaseDocumentResource with remaining path empty
7. Match @GET method in CaseDocumentResource
```

---

## 26. Generic Return Types dan Resource Model

```java
@GET
public List<CaseSummaryResponse> search() { ... }
```

Return generic seperti `List<CaseSummaryResponse>` penting untuk `MessageBodyWriter`, terutama JSON provider. Karena Java type erasure, Jersey perlu mempertahankan generic type metadata dari method signature.

Jika kamu membungkus response manual:

```java
return Response.ok(list).build();
```

Kadang generic metadata bisa hilang tergantung provider dan runtime context.

Solusi jika perlu:

```java
GenericEntity<List<CaseSummaryResponse>> entity =
        new GenericEntity<List<CaseSummaryResponse>>(list) {};

return Response.ok(entity).build();
```

Ini akan dibahas lebih dalam di Part response/provider.

Untuk Part 3, pahami bahwa method signature bukan hanya compile-time Java. Ia juga memberi metadata runtime untuk provider selection.

---

## 27. Resource Model and Java 8–25 Considerations

### 27.1 Java 8

Di Java 8, resource class biasanya plain class dengan DTO biasa.

Constraints:

- Tidak ada records.
- Tidak ada sealed classes.
- Tidak ada module system.
- Parameter name reflection perlu compiler flag jika ingin memanfaatkan nama parameter di luar annotation eksplisit.
- Jersey 2.x banyak dipakai di era `javax.ws.rs`.

Recommendation:

```text
- Selalu gunakan explicit @PathParam/@QueryParam name.
- Gunakan DTO class biasa.
- Hindari dependency magic.
- Perhatikan classpath conflict.
```

### 27.2 Java 11

Java 11 membawa baseline runtime modern yang lebih baik, tapi resource model secara konsep sama.

Concern:

- TLS/JDK HTTP stack berubah dibanding Java 8.
- Module path mulai relevan, walau banyak aplikasi tetap classpath.
- JAXB tidak lagi built-in seperti Java 8, berpengaruh jika XML provider lama bergantung pada JAXB.

### 27.3 Java 17

Java 17 sering menjadi baseline untuk Jakarta EE 10/11 era.

Resource model impact:

- Records mulai realistis untuk DTO.
- Sealed class bisa muncul untuk domain/result type, tetapi hati-hati serialization.
- Strong encapsulation/module concern lebih nyata.

Contoh DTO record:

```java
public record CaseResponse(
        String caseId,
        String status,
        String title
) {}
```

Jersey resource method:

```java
@GET
@Path("{caseId}")
public CaseResponse get(@PathParam("caseId") String caseId) {
    return service.get(caseId);
}
```

Butuh JSON provider yang mendukung record dengan benar.

### 27.4 Java 21

Java 21 membawa virtual threads sebagai fitur final. Resource model tidak berubah, tetapi lifecycle/threading runtime bisa berubah tergantung container.

Concern:

- Jangan simpan request state di static/threadlocal tanpa propagasi jelas.
- MDC/correlation propagation harus diuji.
- Blocking service call bisa lebih scalable jika container mendukung virtual thread model, tetapi DB pool tetap bottleneck.

### 27.5 Java 25

Java 25 sebagai LTS modern memperkuat kebutuhan compatibility thinking:

- Apakah Jersey version mendukung target Java?
- Apakah container mendukung target Java?
- Apakah provider JSON/XML mendukung target Java?
- Apakah reflection/module access aman?
- Apakah build tool/test framework compatible?

Resource model tetap annotation/reflection-driven, sehingga module encapsulation dan dependency alignment semakin penting.

---

## 28. `javax.ws.rs` vs `jakarta.ws.rs` Resource Model

Secara mental model, konsep resource class tetap sangat mirip.

Perubahan besar:

```text
Jersey 2.x:
  javax.ws.rs.Path
  javax.ws.rs.GET
  javax.ws.rs.core.Response

Jersey 3.x/4.x:
  jakarta.ws.rs.Path
  jakarta.ws.rs.GET
  jakarta.ws.rs.core.Response
```

Jangan mencampur namespace.

Buruk:

```java
import javax.ws.rs.Path;
import jakarta.ws.rs.GET;
```

Atau dependency campur:

```text
jersey-server 3.x + javax.ws.rs-api 2.x
```

Gejala:

- Resource tidak terdeteksi.
- Annotation terlihat ada di source, tapi runtime tidak mengenalinya karena package berbeda.
- `ClassNotFoundException`.
- `NoSuchMethodError`.
- Provider tidak jalan.

Migration rule:

```text
Namespace harus konsisten secara total:
- resource annotations
- core types
- servlet API
- validation API
- JSON provider integration
- container runtime
```

---

## 29. Resource Model Anti-pattern Catalog

### 29.1 God Resource

```text
Satu resource class mengandung semua endpoint domain.
```

Akibat:

- sulit maintain
- route conflict mudah terjadi
- authorization scattered
- testing lambat

### 29.2 Repository Resource

```java
@GET
@Path("cases/{id}")
public CaseEntity find(...) { ... }
```

Resource hanya expose database.

Akibat:

- API mengikuti schema DB
- security leak
- lazy loading problem

### 29.3 Verb-based URI Everywhere

```text
/createCase
/updateCase
/deleteCase
/approveCase
/rejectCase
```

Kadang acceptable untuk internal command API, tetapi jangan campur dengan resource-oriented style tanpa rule.

### 29.4 Ambiguous Variable Routes

```text
/{id}
/{code}
/{name}
```

Dalam same path level, ini sering identik bagi matcher.

### 29.5 Dynamic Object Router

Sub-resource locator mengembalikan object berbeda berdasarkan banyak kondisi. Sulit dipahami, diuji, dan didokumentasikan.

### 29.6 Hidden Annotation in Interface Without Discipline

Routing annotation ada di interface, implementation terlihat kosong. Bisa baik jika contract-first, buruk jika tidak disepakati.

### 29.7 Business Transaction in Resource

Resource method terlalu banyak logic domain/transaction/integration.

### 29.8 Singleton With Mutable Request State

Thread-safety bug yang sering sangat sulit direproduksi.

### 29.9 Catch-all Resource

```java
@Path("{any: .*}")
public class CatchAllResource { ... }
```

Bisa berguna untuk SPA fallback atau proxy, tetapi berbahaya jika mencuri route API lain.

### 29.10 Overusing Regex Path

Regex path terlalu kompleks membuat API tidak intuitif.

---

## 30. Production Debugging: Resource Model Failure Checklist

Saat endpoint tidak terpanggil, gunakan checklist berikut.

### 30.1 Apakah Application Path Benar?

```text
Base URL:
  https://host/context-root/api

Application path:
  /api

Resource path:
  /cases
```

Request yang benar mungkin:

```text
/context-root/api/cases
```

Bukan hanya:

```text
/cases
```

### 30.2 Apakah Resource Terdaftar?

Jika explicit registration:

```java
register(CaseResource.class);
```

Jika scanning:

```java
packages("com.example.api");
```

Pastikan class berada dalam package scan.

### 30.3 Apakah Namespace Cocok?

Cek import:

```java
import jakarta.ws.rs.Path;
```

vs:

```java
import javax.ws.rs.Path;
```

Jangan campur.

### 30.4 Apakah Path Cocok?

Cek:

- leading/trailing slash
- context root
- application path
- reverse proxy rewrite
- case sensitivity
- regex path
- reserved literal vs variable

### 30.5 Apakah HTTP Method Cocok?

Request `POST`, method hanya `GET` -> `405 Method Not Allowed`.

### 30.6 Apakah Media Type Cocok?

Request body dengan:

```text
Content-Type: application/json
```

Method punya:

```java
@Consumes("application/xml")
```

Maka bisa `415 Unsupported Media Type`.

Accept header:

```text
Accept: application/xml
```

Method hanya:

```java
@Produces("application/json")
```

Maka bisa `406 Not Acceptable`.

### 30.7 Apakah Sub-resource Locator Menghasilkan Object Benar?

Tambahkan log atau test pada locator.

Masalah umum:

- locator return `null`
- dependency sub-resource tidak injected
- constructor manual melewati DI
- path sisa tidak match di sub-resource

### 30.8 Apakah Security Filter Menghentikan Sebelum Resource?

Kadang “endpoint tidak terpanggil” karena request ditolak filter authentication/authorization.

Cek:

- filter priority
- pre-matching filter
- exception mapper
- log correlation ID

### 30.9 Apakah Exception Mapper Menyamarkan Error?

Generic mapper bisa mengubah injection failure menjadi `404`/`500` generic yang menyesatkan.

Pastikan log internal menyimpan root cause.

---

## 31. Example: Designing Resource Model for Case Management

Kita desain resource model untuk case management.

### 31.1 Requirements

```text
- User dapat search cases.
- User dapat create case.
- User dapat view case detail.
- User dapat update draft case.
- User dapat submit case.
- Reviewer dapat approve/reject case.
- User dapat upload/list/download document.
- Semua action harus audit-able.
- Authorization berbeda antara view, edit, approve, document access.
```

### 31.2 Candidate API

```text
GET    /cases
POST   /cases
GET    /cases/{caseId}
PATCH  /cases/{caseId}
POST   /cases/{caseId}/submission
POST   /cases/{caseId}/approval
POST   /cases/{caseId}/rejection
GET    /cases/{caseId}/documents
POST   /cases/{caseId}/documents
GET    /cases/{caseId}/documents/{documentId}
```

### 31.3 Resource Classes

```text
CaseResource
  GET    /cases
  POST   /cases
  GET    /cases/{caseId}
  PATCH  /cases/{caseId}

CaseWorkflowResource
  POST   /cases/{caseId}/submission
  POST   /cases/{caseId}/approval
  POST   /cases/{caseId}/rejection

CaseDocumentResource
  GET    /cases/{caseId}/documents
  POST   /cases/{caseId}/documents
  GET    /cases/{caseId}/documents/{documentId}
```

### 31.4 Implementation Sketch

```java
@Path("cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final CaseQueryService queryService;
    private final CaseCommandService commandService;
    private final CaseApiMapper mapper;

    @Inject
    public CaseResource(
            CaseQueryService queryService,
            CaseCommandService commandService,
            CaseApiMapper mapper) {
        this.queryService = queryService;
        this.commandService = commandService;
        this.mapper = mapper;
    }

    @GET
    public CaseSearchResponse search(@BeanParam CaseSearchParams params,
                                     @Context SecurityContext securityContext) {
        CaseSearchQuery query = mapper.toSearchQuery(params, securityContext);
        return mapper.toSearchResponse(queryService.search(query));
    }

    @POST
    public Response create(CreateCaseRequest request,
                           @Context SecurityContext securityContext,
                           @Context UriInfo uriInfo) {
        CreateCaseCommand command = mapper.toCreateCommand(request, securityContext);
        CreatedCase created = commandService.create(command);

        URI location = uriInfo.getAbsolutePathBuilder()
                .path(created.caseId())
                .build();

        return Response.created(location)
                .entity(mapper.toCreateResponse(created))
                .build();
    }

    @GET
    @Path("{caseId}")
    public CaseResponse get(@PathParam("caseId") String caseId,
                            @Context SecurityContext securityContext) {
        CaseView view = queryService.get(caseId, mapper.toActor(securityContext));
        return mapper.toCaseResponse(view);
    }

    @PATCH
    @Path("{caseId}")
    public CaseResponse updateDraft(@PathParam("caseId") String caseId,
                                    UpdateCaseRequest request,
                                    @Context SecurityContext securityContext) {
        UpdateCaseCommand command = mapper.toUpdateCommand(caseId, request, securityContext);
        return mapper.toCaseResponse(commandService.updateDraft(command));
    }
}
```

Workflow:

```java
@Path("cases/{caseId}")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseWorkflowResource {

    private final CaseWorkflowService workflowService;
    private final CaseWorkflowMapper mapper;

    @Inject
    public CaseWorkflowResource(CaseWorkflowService workflowService,
                                CaseWorkflowMapper mapper) {
        this.workflowService = workflowService;
        this.mapper = mapper;
    }

    @POST
    @Path("submission")
    public CaseWorkflowResponse submit(@PathParam("caseId") String caseId,
                                       SubmitCaseRequest request,
                                       @Context SecurityContext securityContext) {
        SubmitCaseCommand command = mapper.toSubmitCommand(caseId, request, securityContext);
        return mapper.toResponse(workflowService.submit(command));
    }

    @POST
    @Path("approval")
    public CaseWorkflowResponse approve(@PathParam("caseId") String caseId,
                                        ApproveCaseRequest request,
                                        @Context SecurityContext securityContext) {
        ApproveCaseCommand command = mapper.toApproveCommand(caseId, request, securityContext);
        return mapper.toResponse(workflowService.approve(command));
    }

    @POST
    @Path("rejection")
    public CaseWorkflowResponse reject(@PathParam("caseId") String caseId,
                                       RejectCaseRequest request,
                                       @Context SecurityContext securityContext) {
        RejectCaseCommand command = mapper.toRejectCommand(caseId, request, securityContext);
        return mapper.toResponse(workflowService.reject(command));
    }
}
```

Documents:

```java
@Path("cases/{caseId}/documents")
@Produces(MediaType.APPLICATION_JSON)
public class CaseDocumentResource {

    private final CaseDocumentService documentService;
    private final CaseDocumentMapper mapper;

    @Inject
    public CaseDocumentResource(CaseDocumentService documentService,
                                CaseDocumentMapper mapper) {
        this.documentService = documentService;
        this.mapper = mapper;
    }

    @GET
    public DocumentListResponse list(@PathParam("caseId") String caseId,
                                     @Context SecurityContext securityContext) {
        return mapper.toListResponse(documentService.list(caseId, mapper.toActor(securityContext)));
    }

    @POST
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    public Response upload(@PathParam("caseId") String caseId,
                           /* multipart body here */
                           @Context SecurityContext securityContext,
                           @Context UriInfo uriInfo) {
        // multipart detail discussed in later part
        return Response.status(Response.Status.CREATED).build();
    }

    @GET
    @Path("{documentId}")
    public Response download(@PathParam("caseId") String caseId,
                             @PathParam("documentId") String documentId,
                             @Context SecurityContext securityContext) {
        // streaming detail discussed later
        return Response.ok().build();
    }
}
```

### 31.5 Why This Model Is Better

```text
CaseResource:
  general case lifecycle

CaseWorkflowResource:
  state transition commands

CaseDocumentResource:
  file/media lifecycle
```

Separation follows operational and domain differences, not arbitrary class size.

---

## 32. Resource Model Testing

Jangan hanya unit test service. Minimal ada test yang boot Jersey runtime.

### 32.1 Test Route Exists

```java
public class CaseResourceTest extends JerseyTest {

    @Override
    protected Application configure() {
        return new ResourceConfig()
                .register(CaseResource.class)
                .register(TestBinder.class)
                .register(JsonProvider.class)
                .register(ApiExceptionMapper.class);
    }

    @Test
    public void shouldGetCase() {
        Response response = target("cases/123")
                .request(MediaType.APPLICATION_JSON)
                .get();

        assertEquals(200, response.getStatus());
    }
}
```

### 32.2 Test Ambiguity Prevention

Buat tests untuk reserved route:

```text
GET /cases/search
GET /cases/123
GET /cases/by-reference/ABC
```

Pastikan tidak saling makan.

### 32.3 Test Media Type

```text
POST /cases Content-Type: application/json -> expected success/validation error
POST /cases Content-Type: text/plain -> 415
GET /cases Accept: application/xml -> 406 jika XML tidak didukung
```

### 32.4 Test Sub-resource

```text
GET /cases/123/documents
POST /cases/123/documents
GET /cases/123/documents/999
```

Jika menggunakan locator, pastikan locator benar-benar dipanggil dan state `caseId` benar.

---

## 33. Design Checklist

Sebelum merge resource class baru, review checklist ini.

### 33.1 Routing

```text
[ ] Apakah path tidak ambigu?
[ ] Apakah literal route tidak conflict dengan variable route?
[ ] Apakah path variable punya nama yang konsisten?
[ ] Apakah regex path benar-benar perlu?
[ ] Apakah application path + resource path jelas?
```

### 33.2 HTTP Semantics

```text
[ ] GET tidak mengubah state?
[ ] POST/PUT/PATCH/DELETE dipilih dengan alasan jelas?
[ ] Status response sesuai?
[ ] Location header disediakan untuk creation jika relevan?
```

### 33.3 Media Type

```text
[ ] @Consumes eksplisit untuk body endpoint?
[ ] @Produces eksplisit untuk response?
[ ] File/binary endpoint override media type?
[ ] Error response tetap konsisten?
```

### 33.4 Signature

```text
[ ] Hanya satu entity body parameter?
[ ] Semua path/query/header parameter diberi annotation eksplisit?
[ ] @Context digunakan secara jelas?
[ ] Tidak ada dependency/service sebagai unannotated method parameter?
```

### 33.5 Lifecycle

```text
[ ] Resource stateless?
[ ] Tidak ada mutable request state di field singleton?
[ ] Constructor ringan?
[ ] DI ownership jelas: HK2/CDI/Spring?
```

### 33.6 Architecture

```text
[ ] Resource tidak berisi business transaction besar?
[ ] DTO tidak memakai entity persistence langsung?
[ ] Authorization endpoint dan object-level jelas?
[ ] Audit semantic ada di service/domain, bukan hanya filter?
[ ] Mapping request/response jelas?
```

### 33.7 Testing

```text
[ ] Jersey runtime test ada untuk route utama?
[ ] 404/405/406/415 behavior diuji?
[ ] Sub-resource diuji?
[ ] Exception mapper diuji?
[ ] Security context diuji?
```

---

## 34. Mini Exercises

### Exercise 1 — Identify Ambiguity

Diberikan:

```java
@Path("users")
public class UserResource {

    @GET
    @Path("{id}")
    public Response getById(@PathParam("id") String id) { ... }

    @GET
    @Path("{username}")
    public Response getByUsername(@PathParam("username") String username) { ... }
}
```

Pertanyaan:

```text
Apa problemnya?
Bagaimana memperbaikinya?
```

Jawaban ideal:

```text
Kedua path identik secara matcher karena sama-sama satu variable segment.
Perbaiki dengan literal prefix:
  /users/by-id/{id}
  /users/by-username/{username}
atau gunakan query/search endpoint:
  /users?id=...
  /users?username=...
```

### Exercise 2 — Resource vs Service Boundary

Diberikan resource method 150 baris yang melakukan validation, state transition, DB update, audit insert, email send, dan response mapping.

Pertanyaan:

```text
Apa yang harus tetap di resource?
Apa yang harus pindah ke service/application layer?
```

Jawaban ideal:

```text
Resource:
  - HTTP parameter/body/context extraction
  - request DTO to command mapping
  - call use-case service
  - result to response mapping

Service/application:
  - domain validation
  - transaction
  - state transition
  - audit semantic
  - integration orchestration
```

### Exercise 3 — Sub-resource Locator Decision

Diberikan endpoint:

```text
/cases/{caseId}/documents
/cases/{caseId}/documents/{documentId}
/cases/{caseId}/documents/{documentId}/download
/cases/{caseId}/documents/{documentId}/metadata
```

Pertanyaan:

```text
Apakah cocok dipisah menjadi CaseDocumentResource?
```

Jawaban:

```text
Ya, karena subtree documents punya beberapa operasi, media type berbeda, authorization/file handling khusus, dan failure modes berbeda dari CaseResource umum.
```

---

## 35. Key Takeaways

1. Resource model adalah cara Jersey memahami API surface kamu.
2. Resource class bukan sekadar controller; ia adalah kombinasi URI, HTTP operation, media contract, parameter model, context injection, dan lifecycle.
3. Jersey membangun model saat startup dan menggunakannya saat request matching.
4. Resource method punya HTTP method annotation; sub-resource locator punya `@Path` tanpa HTTP method annotation.
5. Ambiguity biasanya berasal dari variable path yang secara manusia berbeda tetapi secara matcher sama.
6. Sub-resource locator powerful, tetapi harus digunakan dengan disiplin.
7. Resource class sebaiknya menjadi HTTP adapter boundary, bukan business engine.
8. Lifecycle resource harus dipahami: per-request, singleton, CDI-managed, Spring-managed, atau HK2-managed.
9. Namespace `javax.ws.rs` dan `jakarta.ws.rs` tidak boleh dicampur.
10. Untuk production, resource model harus diuji sebagai runtime model, bukan hanya unit test method Java biasa.

---

## 36. Referensi Resmi dan Bacaan Lanjutan

- Eclipse Jersey Documentation — JAX-RS Application, Resources and Sub-Resources.
- Jakarta RESTful Web Services 4.0 Specification.
- Jakarta RESTful Web Services API Javadocs.
- Eclipse Jersey User Guide, terutama bagian resources, sub-resources, providers, dan application model.

---

## 37. Status Seri

Part ini selesai.

Progress:

```text
Part 0  — Orientasi Seri — selesai
Part 1  — Jersey Mental Model — selesai
Part 2  — Application Bootstrap — selesai
Part 3  — Resource Model Internals — selesai
Part 4  — Request Matching Deep Dive — berikutnya
...
Part 32 — Capstone — target akhir
```

Seri belum selesai. Bagian berikutnya adalah:

```text
Part 4 — Request Matching Deep Dive: URI Matching, Method Selection, Media Negotiation
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 1 — Jersey Mental Model: Spec, Implementation, Runtime, and Engineering Boundary](./01-jersey-mental-model-spec-implementation-runtime-engineering-boundary.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 4 — Request Matching Deep Dive: URI Matching, Method Selection, Media Negotiation](./04-request-matching-deep-dive-uri-method-media-negotiation.md)

</div>