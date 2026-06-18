# Part 4 — Request Matching Deep Dive: URI Matching, Method Selection, Media Negotiation

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `04-request-matching-deep-dive-uri-method-media-negotiation.md`  
Status: Part 4 dari 32  
Target pembaca: Java engineer yang sudah memahami Java, HTTP, Servlet, JAX-RS/Jakarta REST dasar, dan ingin memahami Jersey pada level runtime/production engineering.  
Cakupan Java: Java 8 sampai Java 25  
Cakupan Jersey: Jersey 2.x (`javax.ws.rs`), Jersey 3.x/4.x (`jakarta.ws.rs`)

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas bagaimana Jersey membangun **resource model** dari class, method, annotation, parameter, provider, dan configuration.

Bagian ini menjawab pertanyaan yang lebih runtime-oriented:

> Ketika request HTTP masuk, bagaimana Jersey memutuskan method Java mana yang akan dipanggil?

Ini kelihatan sederhana ketika endpoint masih sedikit:

```java
@Path("/users")
public class UserResource {
    @GET
    public List<UserDto> list() { ... }
}
```

Tetapi dalam aplikasi enterprise, matching bisa menjadi sulit karena melibatkan:

- base URI dari servlet/container/gateway,
- `@ApplicationPath`,
- servlet mapping,
- class-level `@Path`,
- method-level `@Path`,
- sub-resource locator,
- HTTP method designator,
- path template,
- regex path variable,
- matrix parameter,
- query parameter,
- header,
- `Content-Type`,
- `Accept`,
- `@Consumes`,
- `@Produces`,
- `MessageBodyReader`,
- `MessageBodyWriter`,
- filters/interceptors,
- exception mapping,
- reverse proxy path rewrite.

Kesalahan matching sering muncul sebagai error yang tampaknya sederhana:

```text
404 Not Found
405 Method Not Allowed
406 Not Acceptable
415 Unsupported Media Type
```

Namun root cause-nya bisa sangat berbeda.

Tujuan bagian ini:

1. Membentuk mental model request matching Jersey.
2. Memahami urutan besar pemilihan resource class dan resource method.
3. Memahami beda antara path matching, method selection, entity consumption, dan response production.
4. Bisa menjelaskan kenapa sebuah request menghasilkan 404/405/406/415.
5. Bisa mendesain endpoint agar matching-nya deterministik dan mudah di-debug.
6. Bisa membuat checklist diagnosis saat endpoint “ada di code” tetapi tidak pernah terpanggil.

---

## 1. Big Picture: Request Matching Bukan Sekadar `@Path`

Secara mental, jangan membaca endpoint Jersey sebagai:

> URL dicocokkan ke method.

Itu terlalu sederhana.

Lebih tepat:

> Request HTTP masuk ke application runtime, lalu Jersey melakukan penyempitan kandidat secara bertahap: path candidate, resource candidate, method candidate, media type candidate, entity provider candidate, lalu baru menjalankan method dan menulis response.

Model sederhananya:

```text
HTTP Request
  |
  |-- container / servlet mapping
  |-- application path
  |-- root resource class matching
  |-- resource method / sub-resource locator matching
  |-- HTTP method selection
  |-- @Consumes selection using Content-Type
  |-- @Produces selection using Accept
  |-- request entity provider selection
  |-- parameter/entity binding
  |-- resource method invocation
  |-- response media type determination
  |-- response entity provider selection
  v
HTTP Response
```

Yang penting: beberapa status error terjadi di tahap yang berbeda.

```text
404 => path/resource candidate tidak ditemukan
405 => path cocok, tetapi HTTP method tidak cocok
415 => body Content-Type tidak dapat dikonsumsi oleh method/provider
406 => response yang bisa diproduksi tidak cocok dengan Accept
500 => method/provider gagal setelah kandidat dipilih
```

Tetapi ini rule of thumb. Pada detailnya, beberapa implementasi dan konfigurasi dapat memengaruhi bentuk error akhir.

---

## 2. Specification vs Jersey Runtime

Jakarta REST/JAX-RS specification menjelaskan algoritma request matching secara normatif. Implementasi tidak wajib memakai algoritma persis sama secara internal, tetapi hasilnya harus ekuivalen dengan algoritma specification.

Jersey sebagai implementasi dapat memiliki optimasi internal, model cache, tracing, dan diagnostic output sendiri. Namun ketika kita membahas semantics, sumber kebenarannya adalah Jakarta REST/JAX-RS specification.

Perbedaan namespace:

```text
Jersey 2.x  -> javax.ws.rs.*
Jersey 3.x+ -> jakarta.ws.rs.*
```

Contoh:

```java
// Jersey 2.x
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;

// Jersey 3.x / 4.x
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
```

Secara konsep request matching tetap mirip, tetapi migrasi namespace dapat menyebabkan resource tidak terdeteksi jika dependency dan annotation bercampur.

Contoh anti-pattern migrasi:

```java
// Aplikasi Jersey 3/4 memakai jakarta runtime,
// tetapi resource masih memakai javax annotation.
import javax.ws.rs.Path;
import javax.ws.rs.GET;

@Path("/orders")
public class OrderResource {
    @GET
    public String list() { return "ok"; }
}
```

Di runtime Jakarta, annotation `javax.ws.rs.Path` bukan annotation yang sama dengan `jakarta.ws.rs.Path`. Akibatnya class bisa tidak dianggap sebagai resource.

Diagnosis:

```text
Symptom:
  GET /orders -> 404

Padahal:
  Class OrderResource ada.

Root cause yang mungkin:
  Resource memakai javax annotation sementara runtime memakai jakarta Jersey.
```

---

## 3. Stage 0: Container Path Sebelum Masuk Jersey

Sebelum Jersey mencocokkan `@Path`, request harus melewati container.

Dalam deployment servlet, URL efektif dipengaruhi oleh:

1. Scheme/host/port.
2. Context path aplikasi.
3. Servlet mapping.
4. `@ApplicationPath` atau konfigurasi servlet init-param.
5. Reverse proxy / gateway rewrite.
6. Class-level dan method-level `@Path`.

Contoh:

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
    }
}
```

Resource:

```java
@Path("/users")
public class UserResource {
    @GET
    @Path("/{id}")
    public UserDto get(@PathParam("id") String id) { ... }
}
```

Jika aplikasi dideploy pada context path `/aceas`, endpoint public bisa menjadi:

```text
/aceas/api/users/{id}
```

Jika di balik gateway:

```text
Public URL:   /external/aceas/api/users/123
Gateway maps: /external/aceas -> /aceas
Backend sees: /aceas/api/users/123
Jersey sees:  /users/123 after application path is stripped
```

Problem umum:

```text
Developer test:
  GET /api/users/123

Actual deployment:
  GET /aceas/api/users/123
```

Atau sebaliknya:

```text
Gateway already strips /api,
application also expects /api,
so backend sees wrong path.
```

Mental model penting:

> Jersey tidak selalu melihat URL yang sama dengan URL yang dilihat client.

Dalam production, selalu bedakan:

```text
client-visible URI
proxy/gateway URI
container request URI
servlet path
path info
Jersey matched path
```

---

## 4. Stage 1: Root Resource Class Matching

Root resource class adalah class yang memiliki `@Path` pada level class.

```java
@Path("/orders")
public class OrderResource {
    ...
}
```

Jersey membangun kandidat root resource berdasarkan URI path yang tersisa setelah base/application path.

Contoh:

```text
Request path seen by Jersey:
  /orders/100/items

Root resource candidates:
  @Path("/orders")
  @Path("/customers")
  @Path("/reports")

Candidate selected:
  @Path("/orders")

Remaining unmatched path:
  /100/items
```

Specification menyebut tahap awal matching sebagai identifikasi kandidat root resource class yang cocok dengan request URI path.

---

## 5. Path Template Mental Model

`@Path` bukan sekadar string literal. Ia adalah template.

Contoh:

```java
@Path("/orders/{orderId}")
public class OrderResource {
    @GET
    public OrderDto get(@PathParam("orderId") String orderId) { ... }
}
```

Template:

```text
/orders/{orderId}
```

Cocok dengan:

```text
/orders/100
/orders/ABC-999
/orders/anything
```

Tidak cocok dengan:

```text
/orders
/orders/100/items
```

Kecuali ada method/sub-resource yang melanjutkan path.

### 5.1 Literal vs Variable

Bandingkan:

```java
@Path("/orders/search")
public Response search() { ... }

@Path("/orders/{id}")
public Response getById(@PathParam("id") String id) { ... }
```

Request:

```text
GET /orders/search
```

Secara desain, literal `search` harus lebih spesifik daripada variable `{id}`.

Namun jangan terlalu mengandalkan “kelihatannya obvious”. Dalam API besar, path seperti ini rawan ambiguity:

```text
/orders/{id}
/orders/search
/orders/status
/orders/{code}/history
/orders/{id}/items
```

Jika `id` bisa berupa string bebas, maka keyword seperti `search`, `status`, `summary`, `export` dapat tertangkap sebagai id oleh manusia yang membaca route, walaupun runtime dapat memilih literal yang lebih spesifik.

Desain yang lebih eksplisit:

```text
/orders/{orderId}
/orders:search
/orders:export
/order-searches
```

Atau:

```text
/orders/_search
/orders/_export
/orders/{orderId}
```

Tujuannya bukan dogma REST, tetapi mengurangi konflik mental dan risiko perubahan di masa depan.

---

## 6. Regex Path Parameter

JAX-RS/Jakarta REST mendukung regex pada path parameter.

```java
@Path("/orders/{orderId: \\d+}")
public class OrderResource {
    @GET
    public OrderDto get(@PathParam("orderId") long orderId) { ... }
}
```

Request cocok:

```text
/orders/123
```

Request tidak cocok:

```text
/orders/ABC
/orders/search
```

Regex membuat route lebih defensif.

Contoh untuk UUID:

```java
@Path("/cases/{caseId: [0-9a-fA-F\\-]{36}}")
public class CaseResource {
    @GET
    public CaseDto get(@PathParam("caseId") UUID caseId) { ... }
}
```

Namun hati-hati: regex yang terlalu kompleks membuat route sulit dibaca.

Rule praktis:

```text
Gunakan regex path jika:
  - literal endpoint rawan bentrok dengan variable endpoint
  - id punya format jelas
  - kamu ingin 404 untuk format path yang salah

Jangan gunakan regex path jika:
  - validasi domain lebih kompleks dari format URI
  - error yang diinginkan seharusnya 400 dengan pesan validation detail
```

Contoh:

```text
GET /orders/ABC
```

Jika route hanya menerima digit:

```text
404 Not Found
```

Karena path tidak cocok.

Jika route menerima string lalu validasi di method:

```text
400 Bad Request
{
  "code": "INVALID_ORDER_ID",
  "message": "orderId must be numeric"
}
```

Keduanya valid secara engineering tergantung contract.

---

## 7. Method-Level `@Path` Matching

Root resource class biasanya hanya tahap awal.

```java
@Path("/orders")
public class OrderResource {

    @GET
    public List<OrderDto> list() { ... }

    @GET
    @Path("/{orderId}")
    public OrderDto get(@PathParam("orderId") String orderId) { ... }

    @GET
    @Path("/{orderId}/items")
    public List<ItemDto> items(@PathParam("orderId") String orderId) { ... }
}
```

Request:

```text
GET /orders
```

Matches:

```text
class @Path("/orders")
method @GET no method path
```

Request:

```text
GET /orders/100
```

Matches:

```text
class @Path("/orders")
method @Path("/{orderId}")
```

Request:

```text
GET /orders/100/items
```

Matches:

```text
class @Path("/orders")
method @Path("/{orderId}/items")
```

Penting:

> Method tanpa `@Path` berarti menangani path persis pada class path, bukan wildcard.

Method ini:

```java
@GET
public List<OrderDto> list() { ... }
```

Bukan menangani semua path di bawah `/orders`. Ia hanya menangani `/orders` untuk HTTP GET.

---

## 8. HTTP Method Selection

Setelah path candidate ditemukan, Jersey memilih method berdasarkan HTTP method annotation:

```java
@GET
@POST
@PUT
@PATCH
@DELETE
@HEAD
@OPTIONS
```

Contoh:

```java
@Path("/orders/{orderId}")
public class OrderResource {

    @GET
    public OrderDto get(@PathParam("orderId") String id) { ... }

    @PUT
    public OrderDto replace(@PathParam("orderId") String id, ReplaceOrderRequest request) { ... }

    @DELETE
    public void delete(@PathParam("orderId") String id) { ... }
}
```

Request:

```text
GET /orders/100
```

Memilih `get`.

Request:

```text
POST /orders/100
```

Path cocok, tetapi method tidak ada.

Expected semantic:

```text
405 Method Not Allowed
Allow: GET, PUT, DELETE, HEAD, OPTIONS
```

Penting:

```text
404 = tidak ada resource path
405 = ada resource path, tetapi HTTP method tidak tersedia
```

Namun dalam aplikasi dengan sub-resource locator dan security filter, kadang response final bisa berubah tergantung filter/mapper.

---

## 9. HEAD dan OPTIONS

### 9.1 HEAD

Dalam REST runtime, HEAD biasanya terkait dengan GET. Jika GET tersedia, HEAD dapat diproses dengan semantics response header tanpa body.

Namun jangan terlalu mengandalkan default behavior jika API kamu butuh contract eksplisit.

Untuk endpoint download besar, HEAD bisa berguna:

```java
@HEAD
@Path("/documents/{id}/content")
public Response head(@PathParam("id") String id) {
    DocumentMeta meta = service.getMeta(id);
    return Response.ok()
            .type(meta.contentType())
            .header("Content-Length", meta.size())
            .build();
}
```

### 9.2 OPTIONS

OPTIONS sering dipakai untuk discovery/CORS/preflight. Dalam production, OPTIONS bisa ditangani oleh:

- Jersey runtime,
- CORS filter,
- servlet container,
- gateway,
- API management layer.

Jika CORS bermasalah, jangan hanya lihat resource method. Periksa juga filter chain dan gateway.

---

## 10. `@Consumes`: Matching Request Body Media Type

`@Consumes` menyatakan media type yang bisa diterima oleh resource method.

```java
@POST
@Path("/orders")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public OrderDto create(CreateOrderRequest request) { ... }
```

Request valid:

```http
POST /orders
Content-Type: application/json
Accept: application/json

{"customerId":"C001"}
```

Request bermasalah:

```http
POST /orders
Content-Type: text/plain
Accept: application/json

{"customerId":"C001"}
```

Expected semantic:

```text
415 Unsupported Media Type
```

Karena method tidak menyatakan bisa consume `text/plain`.

### 10.1 Method-Level vs Class-Level `@Consumes`

Class-level:

```java
@Path("/orders")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class OrderResource {

    @POST
    public OrderDto create(CreateOrderRequest request) { ... }

    @PUT
    @Path("/{id}")
    public OrderDto replace(ReplaceOrderRequest request) { ... }
}
```

Semua method mewarisi `application/json` kecuali override di method-level.

Method-level override:

```java
@POST
@Path("/import")
@Consumes("text/csv")
public ImportResult importCsv(String csv) { ... }
```

Mental model:

```text
method-level @Consumes lebih spesifik daripada class-level @Consumes
```

### 10.2 Tanpa `@Consumes`

Jika tidak ada `@Consumes`, method dianggap lebih terbuka. Tetapi ini bisa berbahaya.

```java
@POST
@Path("/orders")
public OrderDto create(CreateOrderRequest request) { ... }
```

Tanpa `@Consumes`, runtime akan bergantung pada provider yang tersedia dan `Content-Type` request.

Di production API, lebih baik eksplisit:

```java
@Consumes(MediaType.APPLICATION_JSON)
```

Alasannya:

1. Contract lebih jelas.
2. Error lebih deterministik.
3. Mengurangi accidental support untuk media type yang tidak direncanakan.
4. Memudahkan API documentation.
5. Memudahkan compatibility testing.

---

## 11. Request Entity Parameter dan `Content-Type`

Dalam JAX-RS/Jakarta REST, parameter method yang tidak diberi annotation khusus biasanya dianggap sebagai request entity.

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public OrderDto create(CreateOrderRequest request) {
    ...
}
```

`request` berasal dari body.

Hanya boleh ada satu entity parameter.

Contoh salah:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateOrderRequest request, AuditInput auditInput) {
    ...
}
```

Dua unannotated parameters membuat contract body ambigu.

Solusi:

```java
public record CreateOrderEnvelope(
    CreateOrderRequest order,
    AuditInput audit
) {}

@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateOrderEnvelope request) {
    ...
}
```

Atau audit input berasal dari header/context, bukan body:

```java
@POST
public Response create(
        @HeaderParam("X-Reason") String reason,
        CreateOrderRequest request) {
    ...
}
```

---

## 12. `@Produces`: Matching Response Media Type

`@Produces` menyatakan media type yang bisa dihasilkan oleh resource method.

```java
@GET
@Path("/orders/{id}")
@Produces(MediaType.APPLICATION_JSON)
public OrderDto get(@PathParam("id") String id) { ... }
```

Request valid:

```http
GET /orders/100
Accept: application/json
```

Request bermasalah:

```http
GET /orders/100
Accept: text/csv
```

Expected semantic:

```text
406 Not Acceptable
```

Karena client hanya menerima `text/csv`, sedangkan method hanya memproduksi `application/json`.

### 12.1 Tanpa Accept Header

Jika client tidak mengirim `Accept`, secara HTTP biasanya diasumsikan menerima apa saja (`*/*`).

```http
GET /orders/100
```

Method `@Produces(application/json)` tetap bisa dipilih.

### 12.2 Multiple `@Produces`

```java
@GET
@Path("/reports/{id}")
@Produces({"application/json", "text/csv"})
public Response getReport(@PathParam("id") String id) { ... }
```

Request:

```http
Accept: text/csv
```

Bisa menghasilkan CSV.

Request:

```http
Accept: application/json
```

Bisa menghasilkan JSON.

Tetapi method harus benar-benar menghasilkan entity yang sesuai.

Lebih jelas jika dipisah:

```java
@GET
@Path("/reports/{id}")
@Produces(MediaType.APPLICATION_JSON)
public ReportDto getJson(@PathParam("id") String id) { ... }

@GET
@Path("/reports/{id}")
@Produces("text/csv")
public Response getCsv(@PathParam("id") String id) { ... }
```

Namun ini bisa membawa ambiguity jika tidak dikelola dengan benar.

---

## 13. Accept Header Negotiation

`Accept` bukan string sederhana. Ia bisa memuat banyak media type dengan quality factor.

Contoh:

```http
Accept: application/json, text/csv;q=0.8, */*;q=0.1
```

Artinya client lebih memilih JSON, masih menerima CSV, dan fallback ke apa saja dengan prioritas rendah.

Resource:

```java
@GET
@Path("/export")
@Produces({"text/csv", "application/json"})
public Response export() { ... }
```

Runtime memilih media type berdasarkan compatibility antara `Accept` dan `@Produces`.

Namun jangan desain API critical dengan terlalu banyak implicit negotiation jika client ecosystem tidak disiplin.

Masalah umum:

```http
Accept: */*
```

Banyak HTTP client default mengirim `*/*`, sehingga server bebas memilih media type yang dianggap paling cocok. Jika method mendukung banyak format, hasil bisa tidak sesuai ekspektasi manusia.

Untuk export endpoint, kadang lebih jelas memakai path berbeda:

```text
GET /reports/{id}
GET /reports/{id}/export.csv
GET /reports/{id}/export.pdf
```

Atau query eksplisit:

```text
GET /reports/{id}/export?format=csv
```

Meskipun secara REST purist media negotiation lebih elegan, secara production engineering explicit format sering lebih operasional.

---

## 14. Relationship antara `@Produces` dan `MessageBodyWriter`

`@Produces` hanya menyatakan media type yang dapat dihasilkan method. Setelah method menghasilkan entity, runtime masih harus menemukan `MessageBodyWriter`.

Contoh:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public OrderDto get() {
    return new OrderDto(...);
}
```

Runtime perlu writer untuk:

```text
Java type: OrderDto
Media type: application/json
```

Jika Jackson/JSON-B provider tidak tersedia:

```text
500 Internal Server Error atau error provider terkait
```

Bergantung fase dan implementasi.

Lebih spesifik:

```text
@Produces cocok dengan Accept,
tetapi MessageBodyWriter tidak ditemukan untuk entity type + selected media type.
```

Ini berbeda dengan:

```text
406 Not Acceptable
```

Yang berarti tidak ada media type yang bisa dinegosiasikan untuk response contract.

---

## 15. Relationship antara `@Consumes` dan `MessageBodyReader`

`@Consumes` menyatakan method bisa menerima media type tertentu. Tetapi runtime juga perlu `MessageBodyReader` untuk membaca body ke Java type.

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateOrderRequest request) { ... }
```

Runtime perlu reader untuk:

```text
Media type: application/json
Java type: CreateOrderRequest
```

Jika JSON provider tidak tersedia:

```text
415 Unsupported Media Type
```

Karena runtime tidak bisa membaca entity body untuk media type/type tersebut.

Jadi 415 bisa berarti:

1. `Content-Type` tidak cocok dengan `@Consumes`.
2. Cocok dengan `@Consumes`, tetapi tidak ada `MessageBodyReader` yang bisa membaca body tersebut ke Java type.

Diagnosis harus membedakan keduanya.

---

## 16. Path Parameter vs Query Parameter dalam Matching

Path parameter memengaruhi matching.

```java
@GET
@Path("/orders/{id}")
public OrderDto get(@PathParam("id") String id) { ... }
```

Query parameter tidak memengaruhi resource method selection secara langsung.

```java
@GET
@Path("/orders")
public List<OrderDto> list(@QueryParam("status") String status) { ... }
```

Request:

```text
GET /orders?status=OPEN
GET /orders?status=CLOSED
GET /orders
```

Semua masuk method yang sama.

Jangan membuat overload method hanya berbeda query param:

```java
@GET
@Path("/orders")
public List<OrderDto> listByStatus(@QueryParam("status") String status) { ... }

@GET
@Path("/orders")
public List<OrderDto> listByCustomer(@QueryParam("customerId") String customerId) { ... }
```

Ini ambigu secara resource model. Query param bukan discriminator method yang baik.

Desain lebih baik:

```java
@GET
@Path("/orders")
public List<OrderDto> search(@BeanParam OrderSearchParams params) {
    return service.search(params);
}
```

Atau command/query endpoint eksplisit:

```text
GET /orders?status=OPEN&customerId=C001
POST /order-searches
```

---

## 17. Header Parameter Tidak Ideal untuk Method Overload

Header bisa terlibat dalam media negotiation (`Accept`, `Content-Type`), authentication, conditional request, dan custom behavior. Tetapi jangan desain resource overload berdasarkan arbitrary custom header kecuali benar-benar bagian dari media type/versioning strategy.

Anti-pattern:

```java
@GET
@Path("/orders")
public List<OrderDto> listForMobile(@HeaderParam("X-Client") String client) { ... }

@GET
@Path("/orders")
public List<OrderDto> listForWeb(@HeaderParam("X-Client") String client) { ... }
```

Ini bukan method selection yang valid hanya karena header berbeda.

Lebih baik:

```java
@GET
@Path("/orders")
public List<OrderDto> list(@Context HttpHeaders headers) {
    ClientProfile profile = clientProfileResolver.resolve(headers);
    return service.list(profile);
}
```

Atau bedakan representasi dengan media type:

```http
Accept: application/vnd.example.mobile-order-list+json
Accept: application/vnd.example.web-order-list+json
```

Namun versioning/media-type negotiation punya trade-off sendiri.

---

## 18. Matrix Parameters

Matrix parameter adalah parameter yang melekat pada path segment:

```text
/books;lang=en/123
```

Contoh:

```java
@GET
@Path("/books/{id}")
public BookDto get(
        @PathParam("id") String id,
        @MatrixParam("lang") String lang) {
    ...
}
```

Dalam praktik modern API, matrix param jarang dipakai. Banyak gateway, proxy, security device, atau framework client tidak memperlakukannya secara konsisten.

Untuk API enterprise yang melewati API gateway, WAF, ALB, nginx, service mesh, dan client library heterogen, query parameter sering lebih aman secara operasional.

```text
/books/123?lang=en
```

Gunakan matrix parameter hanya jika kamu mengontrol seluruh client/proxy stack atau memang ada alasan kuat.

---

## 19. Sub-Resource Locator dan Matching Bertahap

Sub-resource locator adalah method `@Path` tanpa HTTP method annotation.

```java
@Path("/customers")
public class CustomerRootResource {

    @Path("/{customerId}/orders")
    public CustomerOrderResource orders(@PathParam("customerId") String customerId) {
        return new CustomerOrderResource(customerId);
    }
}
```

Sub-resource:

```java
public class CustomerOrderResource {
    private final String customerId;

    public CustomerOrderResource(String customerId) {
        this.customerId = customerId;
    }

    @GET
    public List<OrderDto> list() { ... }

    @GET
    @Path("/{orderId}")
    public OrderDto get(@PathParam("orderId") String orderId) { ... }
}
```

Request:

```text
GET /customers/C001/orders/O100
```

Matching:

```text
1. root resource /customers
2. sub-resource locator /{customerId}/orders
3. returned CustomerOrderResource
4. method /{orderId}
5. HTTP GET
```

Sub-resource locator berguna untuk:

- modularisasi resource,
- resource hierarchy,
- dynamic resource object,
- tenant/customer/case scoped resource,
- reusable nested resource.

Tetapi ada trade-off:

- matching lebih sulit dibaca,
- lifecycle object lebih kompleks,
- injection ownership lebih rentan,
- debugging 404 lebih sulit,
- resource graph tidak selalu tampak dari scanning awal.

Rule praktis:

```text
Gunakan sub-resource locator jika hierarchy benar-benar membantu.
Jangan gunakan hanya untuk menyembunyikan service lookup atau membuat pseudo-controller tree.
```

---

## 20. Ambiguity: Endpoint yang Secara Manusia Mirip, Secara Runtime Berbahaya

Contoh ambiguity:

```java
@Path("/files")
public class FileResource {

    @GET
    @Path("/{name}")
    public FileDto byName(@PathParam("name") String name) { ... }

    @GET
    @Path("/{id}")
    public FileDto byId(@PathParam("id") String id) { ... }
}
```

Bagi manusia, `name` dan `id` berbeda. Bagi runtime, keduanya template yang sama:

```text
/{variable}
/{variable}
```

Variable name tidak membuat path berbeda.

Solusi:

```java
@GET
@Path("/by-name/{name}")
public FileDto byName(@PathParam("name") String name) { ... }

@GET
@Path("/by-id/{id}")
public FileDto byId(@PathParam("id") String id) { ... }
```

Atau regex:

```java
@GET
@Path("/{id: \\d+}")
public FileDto byId(@PathParam("id") long id) { ... }

@GET
@Path("/{name: [a-zA-Z][a-zA-Z0-9_-]*}")
public FileDto byName(@PathParam("name") String name) { ... }
```

Namun regex overlap tetap bisa membuat bingung.

Lebih defensif:

```text
/files/id/{id}
/files/name/{name}
```

---

## 21. Status Code Diagnosis: 404 vs 405 vs 406 vs 415

### 21.1 404 Not Found

Biasanya berarti path tidak cocok dengan resource manapun.

Kemungkinan root cause:

```text
- salah context path
- salah application path
- salah servlet mapping
- gateway rewrite salah
- class tidak ter-scan
- resource tidak diregister
- javax/jakarta annotation mismatch
- path template tidak cocok
- regex path parameter menolak input
- sub-resource locator tidak cocok
- trailing slash behavior tidak sesuai ekspektasi
```

Checklist:

```text
1. Apakah URL yang dilihat Jersey sama dengan URL yang kamu panggil?
2. Apakah ResourceConfig mendaftarkan package/class resource?
3. Apakah annotation namespace sesuai runtime?
4. Apakah class-level @Path cocok?
5. Apakah method/sub-resource @Path cocok?
6. Apakah ada regex yang menolak segment?
7. Apakah gateway/container mengubah path?
```

### 21.2 405 Method Not Allowed

Biasanya berarti path cocok, tetapi HTTP method tidak tersedia.

Contoh:

```text
GET /orders/100  -> ada
POST /orders/100 -> 405
```

Checklist:

```text
1. Apakah path benar-benar cocok?
2. Apakah HTTP method annotation tersedia?
3. Apakah method-level @Path sama dengan yang dimaksud?
4. Apakah client mengirim method yang benar?
5. Apakah gateway mengubah method?
6. Apakah CORS preflight OPTIONS ditangani?
```

### 21.3 406 Not Acceptable

Biasanya berarti server tidak bisa menghasilkan media type yang diterima client.

Contoh:

```text
Resource produces: application/json
Client Accept:     text/csv
Result:            406
```

Checklist:

```text
1. Apa nilai Accept header sebenarnya?
2. Apakah client library mengirim Accept default yang tidak kamu sadari?
3. Apakah @Produces method/class cocok?
4. Apakah ada beberapa method dengan path sama tapi produces berbeda?
5. Apakah response entity writer tersedia?
```

### 21.4 415 Unsupported Media Type

Biasanya berarti server tidak bisa menerima request body media type.

Contoh:

```text
Resource consumes: application/json
Client Content-Type: text/plain
Result: 415
```

Checklist:

```text
1. Apa nilai Content-Type sebenarnya?
2. Apakah request punya body?
3. Apakah @Consumes method/class cocok?
4. Apakah JSON provider tersedia?
5. Apakah entity parameter type bisa dibaca provider?
6. Apakah multipart provider sudah diregister jika multipart?
```

---

## 22. Trailing Slash

Path:

```java
@Path("/orders")
```

Client:

```text
/orders
/orders/
```

Trailing slash behavior bisa menjadi sumber bug, terutama di balik gateway atau reverse proxy.

Sebagai API design, pilih satu canonical style.

Biasanya:

```text
Canonical: /orders
Avoid:     /orders/
```

Mitigasi:

1. Dokumentasikan canonical path.
2. Normalisasi di gateway jika perlu.
3. Jangan membuat dua endpoint berbeda hanya karena trailing slash.
4. Test dua-duanya jika client ecosystem tidak disiplin.

---

## 23. Case Sensitivity

URI path pada umumnya case-sensitive.

```text
/orders
/Orders
/ORDERS
```

Jangan buat API yang bergantung pada case-insensitive matching kecuali ada normalisasi eksplisit di gateway.

Best practice:

```text
lowercase path segments
hyphen for multi-word resource name
no camelCase in path
```

Contoh:

```text
/case-files
/audit-events
/document-templates
```

Bukan:

```text
/CaseFiles
/auditEvents
/documentTemplates
```

---

## 24. URL Encoding dan Path Segment

Path variable dapat mengandung karakter encoded.

Contoh:

```text
/files/report%202026.pdf
```

Secara logis:

```text
report 2026.pdf
```

Masalah muncul jika id mengandung slash.

```text
/files/folder/a.txt
```

Jika kamu berharap `{fileKey}` berisi `folder/a.txt`, path template biasa tidak cocok karena slash memisahkan segment.

Solusi:

1. Jangan taruh arbitrary path sebagai path parameter.
2. Gunakan query parameter:

```text
/files/content?key=folder/a.txt
```

3. Gunakan encoded key yang tidak mengandung slash.
4. Gunakan wildcard/regex dengan hati-hati jika benar-benar perlu.

Untuk storage key seperti S3 object key, query parameter sering lebih aman secara API boundary:

```text
GET /documents/content?objectKey=folder/a.txt
```

Atau gunakan id internal:

```text
GET /documents/{documentId}/content
```

---

## 25. Resource Matching dan Security Filter

Security filter bisa berjalan sebelum resource method.

Contoh:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        ...
    }
}
```

Jika filter menolak request:

```text
401 Unauthorized
403 Forbidden
```

Maka resource matching mungkin belum sampai invocation.

Pre-matching filter bahkan dapat berjalan sebelum resource method dipilih.

```java
@Provider
@PreMatching
public class PathRewriteFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        ...
    }
}
```

Ini powerful tetapi berbahaya.

Pre-matching filter dapat:

- mengubah method,
- mengubah URI,
- mengubah header,
- memengaruhi route selection.

Rule:

```text
Gunakan pre-matching filter hanya untuk concern yang benar-benar harus terjadi sebelum matching,
misalnya method override, path normalization, atau proxy metadata normalization.
```

Jangan letakkan business rule di pre-matching filter.

---

## 26. Request Matching dan Reverse Proxy

Di enterprise deployment, Jersey sering berada di balik:

- API Gateway,
- AWS ALB,
- nginx,
- Apache HTTPD,
- service mesh,
- ingress controller,
- WAF.

Masalah yang sering terjadi:

```text
Public path:  /api/v1/orders
Backend path: /orders
App expects:  /api/orders
```

Atau:

```text
Gateway strips /v1
Jersey also uses @ApplicationPath("/v1")
```

Checklist path production:

```text
1. Apa public URL?
2. Apa gateway route rule?
3. Apakah gateway strip prefix?
4. Apa backend context path?
5. Apa servlet mapping?
6. Apa @ApplicationPath?
7. Apa class-level @Path?
8. Apa method-level @Path?
```

Untuk debugging, log secara aman:

```java
@Provider
@Priority(Priorities.AUTHENTICATION - 100)
public class RequestPathDebugFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        UriInfo uri = ctx.getUriInfo();
        log.debug("requestUri={}, baseUri={}, path={}",
                uri.getRequestUri(),
                uri.getBaseUri(),
                uri.getPath());
    }
}
```

Jangan aktifkan debug path/body logging secara luas di production tanpa masking dan sampling.

---

## 27. API Versioning dan Matching

Versioning dapat ditempatkan pada:

1. URI path:

```text
/v1/orders
/v2/orders
```

2. Header:

```http
X-API-Version: 2
```

3. Media type:

```http
Accept: application/vnd.example.order.v2+json
```

4. Hostname:

```text
v1.api.example.com
v2.api.example.com
```

Dalam Jersey, URI path versioning paling mudah dimodelkan:

```java
@Path("/v1/orders")
public class OrderResourceV1 { ... }

@Path("/v2/orders")
public class OrderResourceV2 { ... }
```

Atau jika `@ApplicationPath("/v1")`:

```java
@ApplicationPath("/v1")
public class ApiV1Application extends ResourceConfig { ... }
```

Media type versioning:

```java
@GET
@Path("/orders/{id}")
@Produces("application/vnd.example.order.v1+json")
public OrderV1Dto getV1(...) { ... }

@GET
@Path("/orders/{id}")
@Produces("application/vnd.example.order.v2+json")
public OrderV2Dto getV2(...) { ... }
```

Ini lebih elegant secara representation negotiation, tetapi lebih sulit untuk operasi, dokumentasi, gateway, dan debugging.

Rule praktis:

```text
Untuk enterprise internal/public APIs dengan banyak client heterogen,
URI versioning sering lebih sederhana dan lebih mudah diobservasi.

Untuk mature API platform dengan client yang disiplin,
media type versioning bisa dipertimbangkan.
```

---

## 28. Designing Deterministic Routes

Route deterministik punya ciri:

1. Literal path tidak mudah tertangkap variable.
2. Variable punya nama domain yang jelas.
3. Format id jelas.
4. Query param tidak dipakai sebagai method discriminator.
5. `@Consumes` dan `@Produces` eksplisit.
6. Endpoint command/search/export tidak bentrok dengan entity id.
7. API versioning konsisten.
8. Path tidak bergantung pada trailing slash.
9. Gateway path rewrite terdokumentasi.
10. Contract test mencakup negative case.

Contoh buruk:

```java
@Path("/cases")
public class CaseResource {
    @GET
    @Path("/{value}")
    public CaseDto get(String value) { ... }

    @GET
    @Path("/search")
    public List<CaseDto> search(...) { ... }

    @GET
    @Path("/export")
    public Response export(...) { ... }
}
```

Lebih baik:

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    @GET
    @Path("/{caseId: [A-Z]{3}-\\d{6}}")
    public CaseDto get(@PathParam("caseId") String caseId) { ... }

    @GET
    public CaseSearchResult search(@BeanParam CaseSearchParams params) { ... }

    @GET
    @Path("/exports/{exportId}")
    public Response getExport(@PathParam("exportId") String exportId) { ... }

    @POST
    @Path("/exports")
    public Response createExport(CaseExportRequest request) { ... }
}
```

Atau command style:

```text
POST /case-searches
POST /case-exports
GET  /case-exports/{exportId}/content
```

---

## 29. Matching Table Example

Resource:

```java
@Path("/orders")
@Produces(MediaType.APPLICATION_JSON)
public class OrderResource {

    @GET
    public List<OrderDto> list(@BeanParam OrderSearchParams params) { ... }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    public Response create(CreateOrderRequest request) { ... }

    @GET
    @Path("/{orderId: \\d+}")
    public OrderDto get(@PathParam("orderId") long orderId) { ... }

    @PUT
    @Path("/{orderId: \\d+}")
    @Consumes(MediaType.APPLICATION_JSON)
    public OrderDto replace(
            @PathParam("orderId") long orderId,
            ReplaceOrderRequest request) { ... }

    @GET
    @Path("/exports/{exportId}")
    @Produces("text/csv")
    public Response downloadExport(@PathParam("exportId") String exportId) { ... }
}
```

Matching examples:

| Request | Result | Reason |
|---|---:|---|
| `GET /orders` + `Accept: application/json` | 200 | list method |
| `GET /orders?status=OPEN` | 200 | query param does not change method selection |
| `POST /orders` + `Content-Type: application/json` | 201/200 | create method |
| `POST /orders` + `Content-Type: text/plain` | 415 | `@Consumes` mismatch |
| `GET /orders/100` | 200 | regex `\d+` matches |
| `GET /orders/ABC` | 404 | regex `\d+` rejects path |
| `POST /orders/100` | 405 | path exists but POST not defined on `/{orderId}` |
| `GET /orders/exports/E1` + `Accept: text/csv` | 200 | export method produces CSV |
| `GET /orders/exports/E1` + `Accept: application/json` | 406 | only CSV produced by export method |

---

## 30. Debugging Workflow: Endpoint Ada, Tapi Tidak Terpanggil

Gunakan workflow ini secara berurutan.

### Step 1 — Pastikan Request Benar-Benar Masuk Aplikasi

Cek:

```text
- access log gateway
- access log container
- application request filter log
- trace id/correlation id
```

Jika tidak ada log di aplikasi, masalah bukan Jersey resource matching. Kemungkinan:

```text
DNS / gateway / load balancer / ingress / route / security group / WAF
```

### Step 2 — Pastikan URL yang Dilihat Jersey

Tambahkan debug filter sementara:

```java
@Provider
public class UriDebugFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        UriInfo uri = ctx.getUriInfo();
        log.info("method={}, requestUri={}, baseUri={}, path={}",
                ctx.getMethod(),
                uri.getRequestUri(),
                uri.getBaseUri(),
                uri.getPath());
    }
}
```

### Step 3 — Pastikan Resource Terdaftar

Jika memakai explicit registration:

```java
public class ApiConfig extends ResourceConfig {
    public ApiConfig() {
        register(OrderResource.class);
    }
}
```

Jika package scanning:

```java
packages("com.example.api");
```

Periksa:

```text
- package benar?
- class public?
- annotation namespace benar?
- jar masuk classpath?
- module export/open issue pada Java 9+?
```

### Step 4 — Cocokkan Path Secara Manual

Tulis kombinasi:

```text
context path       = ?
servlet mapping    = ?
application path   = ?
class @Path        = ?
method @Path       = ?
```

Gabungkan.

Contoh:

```text
context path       = /aceas
application path   = /api
class @Path        = /orders
method @Path       = /{id}

Full path expected = /aceas/api/orders/{id}
```

### Step 5 — Cek HTTP Method

```text
GET vs POST vs PUT vs PATCH vs DELETE
```

Periksa client/gateway tidak mengubah method.

### Step 6 — Cek `Content-Type`

Untuk request dengan body:

```text
Content-Type harus cocok dengan @Consumes
```

Contoh curl benar:

```bash
curl -X POST 'http://localhost:8080/api/orders' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{"customerId":"C001"}'
```

### Step 7 — Cek `Accept`

```text
Accept harus cocok dengan @Produces
```

Jika ragu:

```bash
curl -v 'http://localhost:8080/api/orders/100' \
  -H 'Accept: application/json'
```

### Step 8 — Cek Provider

Jika matching sudah benar tapi body gagal:

```text
- JSON provider ada?
- multipart provider ada?
- custom MessageBodyReader/Writer terdaftar?
- provider conflict?
```

### Step 9 — Cek Filter/ExceptionMapper

Filter bisa mengubah hasil:

```text
- auth filter mengembalikan 401/403
- pre-matching filter mengubah URI
- exception mapper mengubah body/status
- CORS filter menangani OPTIONS
```

---

## 31. Curl Test Matrix untuk Matching

Untuk endpoint baru, buat minimal test matrix.

Contoh endpoint:

```text
POST /api/orders
Consumes: application/json
Produces: application/json
```

Test:

```bash
# happy path
curl -i -X POST 'http://localhost:8080/api/orders' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{"customerId":"C001"}'

# missing content type
curl -i -X POST 'http://localhost:8080/api/orders' \
  -H 'Accept: application/json' \
  -d '{"customerId":"C001"}'

# wrong content type
curl -i -X POST 'http://localhost:8080/api/orders' \
  -H 'Content-Type: text/plain' \
  -H 'Accept: application/json' \
  -d '{"customerId":"C001"}'

# unacceptable response
curl -i -X POST 'http://localhost:8080/api/orders' \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/csv' \
  -d '{"customerId":"C001"}'

# wrong method
curl -i -X GET 'http://localhost:8080/api/orders' \
  -H 'Accept: application/json'
```

Untuk endpoint GET by id:

```bash
# valid id
curl -i 'http://localhost:8080/api/orders/100' \
  -H 'Accept: application/json'

# invalid regex id
curl -i 'http://localhost:8080/api/orders/ABC' \
  -H 'Accept: application/json'

# wrong accept
curl -i 'http://localhost:8080/api/orders/100' \
  -H 'Accept: text/csv'
```

---

## 32. Integration Test Pattern dengan Jersey Test

Kita akan membahas testing lebih lengkap di Part 27. Namun untuk request matching, test harus melewati Jersey runtime, bukan hanya memanggil method Java langsung.

Contoh konseptual:

```java
public class OrderResourceMatchingTest extends JerseyTest {

    @Override
    protected Application configure() {
        return new ResourceConfig()
                .register(OrderResource.class)
                .register(JacksonFeature.class)
                .register(ApiExceptionMapper.class);
    }

    @Test
    public void getOrder_withNumericId_returns200() {
        Response response = target("orders/100")
                .request(MediaType.APPLICATION_JSON)
                .get();

        assertEquals(200, response.getStatus());
    }

    @Test
    public void getOrder_withNonNumericId_returns404() {
        Response response = target("orders/ABC")
                .request(MediaType.APPLICATION_JSON)
                .get();

        assertEquals(404, response.getStatus());
    }

    @Test
    public void createOrder_withWrongContentType_returns415() {
        Response response = target("orders")
                .request(MediaType.APPLICATION_JSON)
                .post(Entity.entity("{}", MediaType.TEXT_PLAIN));

        assertEquals(415, response.getStatus());
    }
}
```

Kenapa test seperti ini penting?

Karena unit test langsung:

```java
resource.get("ABC");
```

Tidak menguji:

```text
- path regex
- HTTP method selection
- @Consumes
- @Produces
- MessageBodyReader
- MessageBodyWriter
- exception mapping
- filter behavior
```

---

## 33. Java 8 sampai Java 25 Consideration

Request matching concept relatif stabil lintas Java version. Namun ada beberapa hal penting.

### 33.1 Java 8

Typical stack:

```text
Jersey 2.x
javax.ws.rs
Servlet 3.x/4.x
Java EE style deployment
```

Risiko:

```text
- old dependency versions
- Jersey 1 vs Jersey 2 confusion
- javax namespace
- older JSON provider behavior
- fat jar/classpath conflict
```

### 33.2 Java 11

Perubahan besar:

```text
- JAXB tidak lagi bundled di JDK
- module awareness mulai terasa
- TLS/default runtime behavior berubah dibanding Java 8
```

Untuk Jersey, dampaknya sering muncul sebagai dependency/provider issue, bukan path matching murni.

### 33.3 Java 17

Java 17 sering menjadi baseline modern enterprise.

Untuk Jakarta EE 10/11 stack, Java 17 sangat relevan.

Dampak:

```text
- stronger encapsulation
- module path considerations jika dipakai
- runtime diagnostics lebih baik
- record DTO mulai umum
```

### 33.4 Java 21

Virtual threads mulai tersedia sebagai fitur final.

Request matching tetap sama, tetapi threading model container dapat berubah jika server mendukung.

Perlu hati-hati dengan:

```text
- ThreadLocal usage
- MDC propagation
- request scope assumption
- blocking provider serialization
```

### 33.5 Java 25

Java 25 sebagai LTS modern membuat migrasi dependency menjadi isu utama.

Untuk Jersey:

```text
- pastikan versi Jersey/container kompatibel
- pastikan javax/jakarta namespace bersih
- pastikan JSON provider modern
- pastikan build tool tidak menarik dependency lama
```

Request matching tetap konsep yang sama, tetapi runtime stack yang salah dapat membuat resource tidak terdeteksi sama sekali.

---

## 34. Common Anti-Patterns

### Anti-Pattern 1 — Query Param Overload

```java
@GET
@Path("/applications")
public List<ApplicationDto> byStatus(@QueryParam("status") String status) { ... }

@GET
@Path("/applications")
public List<ApplicationDto> byApplicant(@QueryParam("applicant") String applicant) { ... }
```

Masalah:

```text
Query param bukan method discriminator.
```

Solusi:

```java
@GET
@Path("/applications")
public ApplicationSearchResult search(@BeanParam ApplicationSearchParams params) { ... }
```

### Anti-Pattern 2 — Catch-All Path Terlalu Awal

```java
@GET
@Path("/{anything}")
public Response catchAll(@PathParam("anything") String anything) { ... }
```

Masalah:

```text
Membuat route sulit diprediksi dan berisiko bentrok dengan endpoint literal.
```

### Anti-Pattern 3 — Tidak Eksplisit `@Consumes/@Produces`

```java
@POST
public Response create(CreateRequest request) { ... }
```

Masalah:

```text
Contract kabur, error negotiation sulit ditebak.
```

Solusi:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(CreateRequest request) { ... }
```

### Anti-Pattern 4 — Menggunakan Path untuk Semua Filter Search

```text
/orders/status/open/customer/C001/date/2026-01-01
```

Lebih baik:

```text
/orders?status=OPEN&customerId=C001&fromDate=2026-01-01
```

Atau untuk search kompleks:

```text
POST /order-searches
```

### Anti-Pattern 5 — Endpoint Export Bentrok dengan ID

```text
GET /reports/{id}
GET /reports/export
```

Jika id string bebas, `export` terlihat seperti id.

Solusi:

```text
GET /reports/{reportId}
POST /report-exports
GET /report-exports/{exportId}/content
```

---

## 35. Production Design Checklist

Sebelum merge endpoint baru, jawab:

```text
Path contract:
  [ ] Apakah full path jelas dari gateway sampai resource method?
  [ ] Apakah class-level dan method-level @Path tidak ambigu?
  [ ] Apakah variable path punya format/domain jelas?
  [ ] Apakah literal path tidak bentrok dengan variable path?
  [ ] Apakah trailing slash behavior sudah dites?

HTTP method:
  [ ] Apakah method sesuai semantics? GET/POST/PUT/PATCH/DELETE?
  [ ] Apakah wrong method menghasilkan 405?
  [ ] Apakah OPTIONS/CORS ditangani layer yang benar?

Media type:
  [ ] Apakah @Consumes eksplisit untuk body endpoint?
  [ ] Apakah @Produces eksplisit?
  [ ] Apakah wrong Content-Type menghasilkan 415?
  [ ] Apakah unacceptable Accept menghasilkan 406?
  [ ] Apakah JSON/multipart/provider tersedia?

Parameter:
  [ ] Apakah query param tidak dipakai sebagai overload discriminator?
  [ ] Apakah path param regex dipakai jika perlu?
  [ ] Apakah invalid id harus 404 atau 400?

Deployment:
  [ ] Apakah context path/application path/gateway rewrite terdokumentasi?
  [ ] Apakah resource terdaftar deterministic?
  [ ] Apakah javax/jakarta namespace bersih?

Testing:
  [ ] Happy path tested through Jersey runtime?
  [ ] Negative matching tested?
  [ ] Content negotiation tested?
  [ ] Provider missing/conflict considered?
```

---

## 36. Mental Model Final

Cara berpikir yang paling berguna:

```text
Request matching adalah proses penyempitan kandidat.

Bukan:
  URL -> method

Tetapi:
  visible URL
  -> container path
  -> application path
  -> root resource candidate
  -> resource method/sub-resource candidate
  -> HTTP method candidate
  -> request media type candidate
  -> response media type candidate
  -> entity provider candidate
  -> invocation
  -> response writer
```

Jika terjadi error, tanyakan:

```text
Di tahap mana request berhenti?
```

Mapping kasar:

```text
Belum sampai resource path      -> 404
Path cocok, method salah        -> 405
Body media type tidak diterima  -> 415
Accept tidak bisa dipenuhi      -> 406
Provider gagal membaca/menulis  -> 415/500 tergantung fase
Method throw exception          -> mapped error / 500
Filter menolak                  -> 401/403/custom
Gateway/container salah route   -> bisa 404 sebelum Jersey
```

Top 1% engineer tidak hanya hafal annotation. Ia bisa melihat endpoint sebagai runtime decision tree dan bisa menemukan titik berhenti request secara sistematis.

---

## 37. Mini Exercises

### Exercise 1

Diberikan resource:

```java
@Path("/documents")
public class DocumentResource {
    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public DocumentDto get(@PathParam("id") String id) { ... }

    @GET
    @Path("/search")
    @Produces(MediaType.APPLICATION_JSON)
    public List<DocumentDto> search(@QueryParam("q") String q) { ... }
}
```

Pertanyaan:

```text
Apa risiko desain ini jika id dapat berupa string bebas?
Bagaimana redesign-nya?
```

Jawaban yang diharapkan:

```text
/search bisa terlihat seperti id secara mental dan berisiko konflik desain.
Redesign bisa memakai /documents/{documentId: regex}, /documents?query=..., /document-searches, atau /documents/_search.
```

### Exercise 2

Request:

```http
POST /orders
Content-Type: application/json
Accept: text/csv
```

Resource:

```java
@POST
@Path("/orders")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public OrderDto create(CreateOrderRequest request) { ... }
```

Pertanyaan:

```text
Status apa yang paling mungkin?
```

Jawaban:

```text
406 Not Acceptable, karena Content-Type cocok tetapi Accept tidak cocok dengan @Produces.
```

### Exercise 3

Request:

```http
POST /orders
Content-Type: text/plain
Accept: application/json
```

Resource sama seperti exercise 2.

Jawaban:

```text
415 Unsupported Media Type, karena Content-Type tidak cocok dengan @Consumes.
```

### Exercise 4

Resource:

```java
@GET
@Path("/cases/{caseId: CASE-\\d+}")
public CaseDto get(@PathParam("caseId") String caseId) { ... }
```

Request:

```text
GET /cases/ABC-123
```

Jawaban:

```text
404 Not Found, karena path regex tidak cocok.
```

---

## 38. Referensi

- Jakarta RESTful Web Services 4.0 Specification — request matching, media type, entity provider semantics.  
  https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

- Jakarta RESTful Web Services 4.0 Release Page — Jakarta EE 11, Java SE 17 minimum, REST 4.0 changes.  
  https://jakarta.ee/specifications/restful-ws/4.0/

- Eclipse Jersey official site — Jersey 2.x, 3.x, 4.x documentation/version families.  
  https://jersey.github.io/

- Jersey User Guide — resource classes, sub-resources, representations, providers, filters, testing, and Jersey-specific runtime behavior.  
  https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/user-guide.html

---

## 39. Status Seri

Bagian ini selesai.

Progress:

```text
Part 0  — Orientasi Seri — selesai
Part 1  — Jersey Mental Model — selesai
Part 2  — Application Bootstrap — selesai
Part 3  — Resource Model Internals — selesai
Part 4  — Request Matching Deep Dive — selesai
Part 5  — Parameter Injection Semantics — berikutnya
...
Part 32 — Capstone — target akhir
```

Seri belum selesai. Bagian berikutnya adalah:

> Part 5 — Parameter Injection Semantics: Path, Query, Header, Cookie, Matrix, BeanParam

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 3 — Resource Model Internals: How Jersey Understands Resource Classes](./03-resource-model-internals-how-jersey-understands-resource-classes.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 5 — Parameter Injection Semantics: Path, Query, Header, Cookie, Matrix, BeanParam](./05-parameter-injection-semantics-path-query-header-cookie-matrix-beanparam.md)

</div>