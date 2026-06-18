# Part 8 — Response Engineering: Status, Headers, Entities, Streaming, Caching, Conditional Requests

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> File: `08-response-engineering-status-headers-entities-streaming-caching-conditional-requests.md`  
> Scope: Java 8 sampai Java 25, Jersey 2.x/3.x/4.x, JAX-RS/Jakarta REST, production-grade HTTP response engineering

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membedah:

1. bagaimana Jersey memahami resource,
2. bagaimana request dicocokkan ke method,
3. bagaimana parameter di-bind,
4. bagaimana entity body dibaca/ditulis oleh provider,
5. bagaimana JSON provider dipilih dan dikendalikan.

Sekarang kita berpindah ke sisi keluar dari boundary HTTP:

```text
client request
  -> routing
  -> parameter binding
  -> resource method
  -> application/service layer
  -> response construction
  -> entity provider
  -> filter/interceptor
  -> servlet/container output stream
  -> network
  -> client
```

Part ini fokus ke titik:

```text
resource method result -> HTTP response contract
```

Dalam aplikasi kecil, response sering dianggap sederhana:

```java
return dto;
```

atau:

```java
return Response.ok(dto).build();
```

Tetapi dalam sistem enterprise, response adalah kontrak penting yang menentukan:

- apakah operasi dianggap sukses atau gagal,
- apakah client boleh retry,
- apakah cache boleh menyimpan hasil,
- apakah browser/proxy/API gateway dapat memproses response dengan benar,
- apakah body boleh kosong,
- apakah file dapat diunduh aman,
- apakah ETag dapat mencegah lost update,
- apakah response dapat di-stream tanpa membuat JVM kehabisan memori,
- apakah error dan success semantics konsisten,
- apakah observability dan audit trail dapat menjelaskan hasil operasi.

Materi ini tidak mengulang HTTP basic secara panjang, tetapi akan memperdalam bagaimana Jersey/Jakarta REST merepresentasikan response dan bagaimana engineer harus memakai response sebagai **semantic boundary**.

---

## 1. Mental Model Utama: Response Bukan Sekadar Return Value

### 1.1 Response Adalah Tuple Semantik

Secara konseptual, HTTP response adalah tuple:

```text
Response = status + headers + entity/body + protocol metadata
```

Di Jersey/Jakarta REST, hal ini direpresentasikan terutama oleh:

```java
jakarta.ws.rs.core.Response
```

atau di Jersey 2.x legacy:

```java
javax.ws.rs.core.Response
```

Bentuk konseptualnya:

```text
Response
├── status code
├── reason/status family
├── headers
│   ├── Content-Type
│   ├── Location
│   ├── Cache-Control
│   ├── ETag
│   ├── Last-Modified
│   ├── Content-Disposition
│   ├── Set-Cookie
│   └── custom headers
├── entity
│   ├── DTO
│   ├── String
│   ├── byte[]
│   ├── InputStream
│   ├── File
│   ├── StreamingOutput
│   └── GenericEntity<T>
└── runtime processing
    ├── MessageBodyWriter selection
    ├── WriterInterceptor chain
    ├── ContainerResponseFilter chain
    └── container output stream
```

Resource method bukan hanya mengembalikan object. Resource method sedang membuat keputusan:

```text
Apa arti hasil operasi ini bagi client?
```

Contoh:

```java
@POST
public OrderResponse create(CreateOrderRequest request) {
    return service.create(request);
}
```

Secara teknis ini valid. Tetapi secara HTTP semantics, ia lemah:

- status default kemungkinan `200 OK`, padahal create biasanya lebih tepat `201 Created`,
- tidak ada `Location` untuk resource baru,
- tidak jelas apakah operasi synchronous atau asynchronous,
- tidak ada idempotency semantics,
- tidak ada cache semantics,
- tidak ada response metadata.

Versi yang lebih eksplisit:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(CreateOrderRequest request, @Context UriInfo uriInfo) {
    OrderResponse created = service.create(request);

    URI location = uriInfo.getAbsolutePathBuilder()
            .path(created.id())
            .build();

    return Response.created(location)
            .entity(created)
            .build();
}
```

Di sini response mengatakan:

```text
Operasi create berhasil.
Resource baru sudah ada.
URI resource baru adalah Location.
Body berisi representasi resource/result.
```

Itulah response engineering.

---

## 2. Return Value Model di Jersey

### 2.1 Resource Method Bisa Mengembalikan Berbagai Bentuk

Jersey/Jakarta REST resource method dapat mengembalikan beberapa bentuk umum:

```java
public CustomerDto get() { ... }
public Response get() { ... }
public void delete() { ... }
public CompletionStage<CustomerDto> getAsync() { ... } // tergantung versi/runtime support
public StreamingOutput download() { ... }
public GenericEntity<List<CustomerDto>> list() { ... }
```

Secara mental model:

```text
return plain object
  -> Jersey membuat response implisit
  -> status biasanya 200 jika entity non-null
  -> entity diproses oleh MessageBodyWriter

return Response
  -> aplikasi mengontrol status/header/entity secara eksplisit

return void
  -> response tanpa body
  -> status tergantung spec/runtime behavior; biasanya 204 No Content untuk void/null tertentu

throw exception
  -> exception mapping pipeline
```

### 2.2 Kapan Return DTO Langsung Boleh?

Return DTO langsung boleh jika:

- status selalu `200 OK`,
- tidak butuh header khusus,
- tidak butuh cache metadata,
- tidak butuh `Location`,
- tidak butuh custom status,
- tidak butuh conditional request handling,
- operasi bersifat read sederhana,
- failure ditangani oleh exception mapper.

Contoh cukup baik:

```java
@GET
@Path("/{id}")
@Produces(MediaType.APPLICATION_JSON)
public CustomerDto getById(@PathParam("id") UUID id) {
    return queryService.getCustomer(id);
}
```

Namun untuk API enterprise, banyak endpoint lebih baik memakai `Response` eksplisit.

### 2.3 Kapan Harus Return `Response`?

Gunakan `Response` jika perlu mengontrol:

- status selain 200,
- `Location`,
- `ETag`,
- `Last-Modified`,
- `Cache-Control`,
- `Content-Disposition`,
- cookie,
- streaming,
- generic entity type,
- conditional request,
- partial/no-content semantics,
- file download,
- asynchronous accepted job,
- idempotency metadata,
- deprecation/sunset header,
- versioning metadata.

Rule praktis:

```text
Jika response membawa arti protokol, bukan hanya data, return Response.
```

---

## 3. Response Builder: Cara Jersey Membentuk Response

### 3.1 API Dasar

```java
return Response.status(Response.Status.OK)
        .entity(dto)
        .type(MediaType.APPLICATION_JSON_TYPE)
        .header("X-Correlation-Id", correlationId)
        .build();
```

Builder umum:

```java
Response.ok()
Response.ok(entity)
Response.status(200)
Response.status(Response.Status.CREATED)
Response.created(uri)
Response.accepted()
Response.noContent()
Response.notModified()
Response.seeOther(uri)
Response.temporaryRedirect(uri)
Response.serverError()
```

### 3.2 Jangan Jadikan Builder Sebagai Tempat Business Logic

Buruk:

```java
return Response.status(order.isApproved() ? 200 : 409)
        .entity(order.isApproved() ? dto : errorDto)
        .build();
```

Lebih sehat:

```java
ApprovalResult result = service.approve(command);

if (result.approved()) {
    return Response.ok(result.dto()).build();
}

throw new ConflictException("Order cannot be approved in current state");
```

Atau lebih structured:

```java
ApprovalResult result = service.approve(command);

return switch (result.outcome()) {
    case APPROVED -> Response.ok(result.dto()).build();
    case ALREADY_APPROVED -> Response.status(Response.Status.CONFLICT)
            .entity(problem("ORDER_ALREADY_APPROVED"))
            .build();
    case INVALID_STATE -> Response.status(Response.Status.CONFLICT)
            .entity(problem("ORDER_INVALID_STATE"))
            .build();
};
```

Untuk Java 8, gunakan `if/else` atau enum strategy.

### 3.3 Response Builder Harus Dekat Dengan HTTP Boundary

Ideal layering:

```text
Resource method
  - menerima HTTP input
  - memanggil application service
  - menerjemahkan result ke HTTP response

Application service
  - tidak tahu Response
  - tidak tahu status code
  - tidak tahu header HTTP
  - mengembalikan domain/application result
```

Buruk:

```java
public class OrderService {
    public Response create(CreateOrderRequest request) {
        // business logic + HTTP response campur
    }
}
```

Lebih baik:

```java
public class OrderService {
    public CreatedOrder create(CreateOrderCommand command) {
        // business logic only
    }
}
```

Resource:

```java
@POST
public Response create(CreateOrderRequest request, @Context UriInfo uriInfo) {
    CreatedOrder created = service.create(mapper.toCommand(request));

    URI location = uriInfo.getAbsolutePathBuilder()
            .path(created.id().toString())
            .build();

    return Response.created(location)
            .entity(mapper.toResponse(created))
            .build();
}
```

---

## 4. Status Code Engineering

### 4.1 Status Code Adalah Contract, Bukan Dekorasi

Status code memberi tahu client:

```text
Apa hasil operasi?
Client harus melakukan apa setelah ini?
Apakah boleh retry?
Apakah request salah?
Apakah server gagal?
Apakah ada konflik state?
Apakah resource berubah?
```

Salah satu kesalahan paling mahal di API enterprise adalah membuat semua response menjadi:

```text
200 OK
```

lalu menyimpan status sebenarnya di body:

```json
{
  "success": false,
  "errorCode": "VALIDATION_FAILED"
}
```

Ini membuat:

- API gateway sulit mengambil keputusan,
- client HTTP library sulit membedakan success/failure,
- retry policy salah,
- observability metrics menipu,
- cache/proxy tidak paham semantics,
- alerting berbasis status code tidak berguna.

### 4.2 Status Code untuk Read

#### 200 OK

Gunakan untuk GET berhasil dengan body.

```java
@GET
@Path("/{id}")
public Response get(@PathParam("id") UUID id) {
    CustomerDto dto = service.get(id);
    return Response.ok(dto).build();
}
```

#### 404 Not Found

Gunakan jika resource tidak ada atau tidak terlihat oleh caller.

```java
CustomerDto dto = service.find(id)
        .orElseThrow(() -> new NotFoundException("Customer not found"));
```

Dalam sistem security-sensitive, kadang 404 dipakai untuk menyembunyikan keberadaan resource yang caller tidak boleh lihat. Tetapi ini harus menjadi kebijakan sadar, bukan kebetulan.

#### 304 Not Modified

Gunakan untuk conditional GET saat representasi tidak berubah.

Akan dibahas detail di bagian conditional requests.

### 4.3 Status Code untuk Create

#### 201 Created

Gunakan jika resource baru berhasil dibuat.

```java
return Response.created(location)
        .entity(response)
        .build();
```

Header penting:

```text
Location: /orders/{id}
```

`201 Created` tanpa `Location` masih bisa terjadi, tetapi untuk resource-oriented API, `Location` sangat dianjurkan.

#### 202 Accepted

Gunakan jika request diterima tetapi belum selesai diproses.

Contoh:

```java
@POST
@Path("/exports")
public Response requestExport(ExportRequest request, @Context UriInfo uriInfo) {
    ExportJob job = exportService.submit(request);

    URI statusUri = uriInfo.getAbsolutePathBuilder()
            .path(job.id().toString())
            .build();

    return Response.accepted(new JobAcceptedResponse(job.id(), "QUEUED"))
            .location(statusUri)
            .build();
}
```

Mental model:

```text
202 Accepted != operasi selesai
202 Accepted == server menerima pekerjaan untuk diproses nanti
```

Cocok untuk:

- export report,
- document generation,
- bulk import,
- long-running workflow transition,
- asynchronous integration,
- message queue submission.

Jangan pakai 202 jika operasi sebenarnya sudah selesai synchronously.

### 4.4 Status Code untuk Update

#### 200 OK

Gunakan jika update berhasil dan response body berisi representasi baru.

```java
return Response.ok(updatedDto).build();
```

#### 204 No Content

Gunakan jika update berhasil tetapi tidak mengembalikan body.

```java
return Response.noContent().build();
```

Jangan mengembalikan body dengan `204`.

#### 409 Conflict

Gunakan jika request valid secara syntax tetapi konflik dengan state resource.

Contoh:

```text
Cannot approve case because current status is CLOSED.
```

```java
throw new ConflictException("Case is already closed");
```

#### 412 Precondition Failed

Gunakan jika conditional request gagal, misalnya `If-Match` tidak cocok dengan ETag saat update.

Ini lebih presisi daripada `409` untuk optimistic concurrency berbasis HTTP.

### 4.5 Status Code untuk Delete

#### 204 No Content

Umum untuk delete berhasil tanpa body.

```java
@DELETE
@Path("/{id}")
public Response delete(@PathParam("id") UUID id) {
    service.delete(id);
    return Response.noContent().build();
}
```

#### 200 OK

Boleh jika delete mengembalikan body, misalnya deleted representation atau deletion summary.

```java
return Response.ok(new DeleteResponse(id, "DELETED")).build();
```

#### 404 Not Found vs 204 Idempotent Delete

Ada dua pendekatan:

```text
DELETE resource tidak ada -> 404
```

atau:

```text
DELETE resource tidak ada -> 204 karena hasil akhirnya sama: resource tidak ada
```

Keduanya bisa defensible tergantung kontrak. Untuk API internal enterprise, sering lebih baik eksplisit:

- `404` jika caller perlu tahu resource memang tidak ada,
- `204` jika delete didesain idempotent dan client tidak peduli apakah resource sebelumnya ada.

Jangan campur tanpa dokumentasi.

### 4.6 Status Code untuk Validation dan Contract Failure

#### 400 Bad Request

Gunakan untuk request invalid secara umum:

- query param invalid,
- body malformed,
- enum tidak valid,
- format tanggal salah,
- field wajib hilang.

#### 422 Unprocessable Entity

Tidak ada di enum standar JAX-RS lama sebagai `Response.Status`, tetapi bisa dikirim via numeric status:

```java
return Response.status(422)
        .entity(problem)
        .build();
```

Gunakan jika tim memilih membedakan:

```text
400 = syntax/request structure salah
422 = syntax benar, semantic validation gagal
```

Namun untuk konsistensi, pilih kebijakan satu kali untuk seluruh platform.

### 4.7 Status Code untuk Security

#### 401 Unauthorized

Arti praktis:

```text
Authentication missing/invalid.
```

Biasanya perlu `WWW-Authenticate` untuk skema tertentu.

#### 403 Forbidden

Arti praktis:

```text
Caller authenticated tetapi tidak punya hak.
```

Jangan membocorkan detail permission internal dalam body.

### 4.8 Status Code untuk Dependency/Server Failure

#### 500 Internal Server Error

Gunakan untuk bug/unexpected failure.

#### 502 Bad Gateway

Cocok jika aplikasi bertindak sebagai gateway/proxy dan upstream memberi response invalid.

#### 503 Service Unavailable

Cocok jika service sementara tidak tersedia, overload, maintenance, dependency critical down.

#### 504 Gateway Timeout

Cocok jika aplikasi/gateway menunggu upstream dan timeout.

Dalam microservice biasa, mapping dependency timeout ke `503` atau `504` harus konsisten dengan peran service. Jika service bukan gateway formal tetapi melakukan downstream call, banyak organisasi memakai `503` dengan error code `DEPENDENCY_TIMEOUT`.

---

## 5. Response Entity: Object, Type, GenericEntity, and Provider Resolution

### 5.1 Entity Adalah Input untuk `MessageBodyWriter`

Ketika response punya entity:

```java
return Response.ok(dto).build();
```

Jersey akan memilih `MessageBodyWriter` berdasarkan:

```text
entity runtime class
+ declared/generic type
+ annotations
+ selected media type
+ registered providers
+ provider priority
```

Response construction tidak langsung menulis JSON. Ia hanya menyimpan entity dan metadata. Penulisan terjadi kemudian di outbound pipeline.

### 5.2 Plain DTO

```java
return Response.ok(customerDto).build();
```

Cocok untuk object tunggal.

### 5.3 Collection dan Masalah Generic Type

Contoh umum:

```java
List<CustomerDto> customers = service.list();
return Response.ok(customers).build();
```

Dalam banyak kasus JSON provider tetap bisa menulis list. Tetapi generic type bisa hilang karena type erasure, terutama untuk provider/custom writer tertentu.

Untuk mempertahankan generic type:

```java
GenericEntity<List<CustomerDto>> entity = new GenericEntity<List<CustomerDto>>(customers) {};

return Response.ok(entity).build();
```

Mental model:

```text
List<CustomerDto> runtime class = ArrayList
Generic information CustomerDto bisa hilang
GenericEntity mempertahankan generic type untuk provider selection/serialization
```

### 5.4 Entity `null`

Hati-hati dengan `null`.

```java
return Response.ok(null).build();
```

Ini ambigu secara desain:

- Apakah resource ada tetapi body null?
- Apakah resource tidak ditemukan?
- Apakah operasi berhasil tanpa body?

Lebih eksplisit:

```java
return Response.noContent().build();
```

atau:

```java
throw new NotFoundException("Customer not found");
```

atau:

```java
return Response.ok(new NullableValueResponse(null)).build();
```

Jika `null` adalah nilai bisnis valid, bungkus dalam response DTO agar tidak ambigu.

### 5.5 Entity Type dan Media Type Harus Sinkron

Buruk:

```java
return Response.ok(dto)
        .type(MediaType.TEXT_PLAIN)
        .build();
```

Jika tidak ada writer untuk DTO sebagai `text/plain`, response gagal.

Lebih baik:

```java
return Response.ok(dto, MediaType.APPLICATION_JSON_TYPE).build();
```

atau annotation resource:

```java
@Produces(MediaType.APPLICATION_JSON)
```

### 5.6 Response Entity Jangan Berupa Domain Entity Mentah

Buruk:

```java
return Response.ok(orderJpaEntity).build();
```

Risiko:

- lazy loading saat serialization,
- infinite recursion,
- field internal bocor,
- schema tidak stabil,
- audit/security field terekspos,
- persistence model menjadi public API.

Lebih baik:

```java
OrderDto dto = mapper.toDto(order);
return Response.ok(dto).build();
```

---

## 6. Header Engineering

### 6.1 Header Adalah Bagian dari Contract

Header sering dipakai untuk metadata yang tidak cocok di body:

- content type,
- caching,
- resource location,
- conditional request,
- pagination link,
- correlation ID,
- request ID,
- rate limit,
- deprecation,
- download filename,
- cookie/session,
- security challenge.

Jangan membuat semua metadata masuk body jika metadata tersebut memang protocol-level concern.

### 6.2 Common Header Methods di Response Builder

```java
return Response.ok(entity)
        .type(MediaType.APPLICATION_JSON_TYPE)
        .language(Locale.ENGLISH)
        .encoding("gzip")
        .tag(new EntityTag(versionHash))
        .lastModified(Date.from(lastModifiedInstant))
        .cacheControl(cacheControl)
        .location(locationUri)
        .header("X-Correlation-Id", correlationId)
        .build();
```

### 6.3 `Content-Type`

Biasanya dikontrol oleh:

```java
@Produces(MediaType.APPLICATION_JSON)
```

atau:

```java
Response.ok(entity, MediaType.APPLICATION_JSON_TYPE)
```

Jangan membiarkan endpoint public tanpa `@Produces` jika contract harus stabil.

### 6.4 `Location`

Digunakan terutama untuk:

- `201 Created`,
- `202 Accepted` job status location,
- redirect response.

Contoh create:

```java
URI location = uriInfo.getAbsolutePathBuilder()
        .path(created.id().toString())
        .build();

return Response.created(location)
        .entity(created)
        .build();
```

Contoh accepted job:

```java
return Response.accepted(jobResponse)
        .location(jobStatusUri)
        .build();
```

### 6.5 `Content-Disposition` untuk Download

```java
return Response.ok(streamingOutput)
        .type("application/pdf")
        .header("Content-Disposition", "attachment; filename=\"report.pdf\"")
        .build();
```

Tetapi production-grade filename harus:

- tidak berasal langsung dari input user,
- dibersihkan dari CRLF injection,
- dibersihkan dari path separator,
- mempertimbangkan non-ASCII filename,
- tidak mengandung data sensitif.

Helper sederhana:

```java
public final class ContentDispositionNames {
    private ContentDispositionNames() {}

    public static String safeAttachment(String rawFilename) {
        String sanitized = rawFilename == null ? "download" : rawFilename;
        sanitized = sanitized.replace("\\", "_")
                .replace("/", "_")
                .replace("\r", "_")
                .replace("\n", "_")
                .replace("\"", "_");

        if (sanitized.isBlank()) {
            sanitized = "download";
        }

        return "attachment; filename=\"" + sanitized + "\"";
    }
}
```

Untuk Java 8, ganti `isBlank()` dengan trim:

```java
if (sanitized.trim().isEmpty()) {
    sanitized = "download";
}
```

### 6.6 Custom Headers Jangan Asal Dibuat

Contoh custom header yang masih masuk akal:

```text
X-Correlation-Id
X-Request-Id
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

Namun untuk API baru, jika ada header standar/de-facto yang baik, gunakan itu. Custom header harus terdokumentasi dan stabil.

---

## 7. URI Building dan Reverse Proxy Awareness

### 7.1 Jangan Hardcode URL

Buruk:

```java
URI location = URI.create("https://api.example.com/orders/" + id);
```

Masalah:

- environment dev/uat/prod berbeda,
- path rewrite oleh API gateway,
- domain migration,
- reverse proxy TLS termination,
- multi-tenant base URL,
- internal vs external URL berbeda.

Lebih baik:

```java
URI location = uriInfo.getAbsolutePathBuilder()
        .path(id.toString())
        .build();
```

### 7.2 Namun `UriInfo` Bisa Salah di Balik Proxy

Jika aplikasi berjalan di balik ALB/nginx/API gateway, aplikasi mungkin melihat:

```text
http://internal-service:8080
```

padahal client melihat:

```text
https://api.company.com
```

Dampaknya:

- `Location` salah,
- link pagination salah,
- redirect salah,
- callback URL salah.

Solusinya bergantung deployment:

- configure forwarded headers di servlet container/framework,
- gunakan gateway rewrite yang benar,
- set public base URL dari config untuk link external,
- bedakan internal URI dan public URI.

Pattern enterprise:

```java
public interface PublicUriFactory {
    URI resourceUri(String resourceType, String id);
}
```

Resource tidak perlu tahu detail proxy:

```java
URI location = publicUriFactory.orderUri(created.id());
return Response.created(location).entity(response).build();
```

---

## 8. Cookies dan Session-Related Response

### 8.1 Cookie di Jersey Response

```java
NewCookie cookie = new NewCookie.Builder("SESSION")
        .value(sessionId)
        .path("/")
        .httpOnly(true)
        .secure(true)
        .sameSite(NewCookie.SameSite.LAX)
        .build();

return Response.ok(response)
        .cookie(cookie)
        .build();
```

Catatan versi:

- API detail `NewCookie.Builder` dan `SameSite` bergantung versi Jakarta REST/JAX-RS yang dipakai.
- Jersey 2.x legacy API bisa berbeda dari Jakarta-era API.

### 8.2 Cookie Security Checklist

Untuk cookie auth/session:

```text
Secure      = true untuk HTTPS
HttpOnly    = true agar tidak mudah dibaca JS
SameSite    = Lax/Strict/None sesuai flow SSO/cross-site
Path        = sesempit mungkin
Domain      = hati-hati, jangan terlalu luas
Max-Age     = sesuai session policy
```

Jangan set token sensitif di cookie tanpa memahami:

- CSRF,
- SameSite,
- CORS,
- subdomain trust,
- front-channel logout,
- browser behavior.

---

## 9. Caching Response

### 9.1 Caching Bukan Hanya Performance

Caching memengaruhi correctness.

Salah cache bisa menyebabkan:

- user melihat data lama,
- data rahasia tersimpan di shared proxy,
- permission change tidak segera terlihat,
- regulatory data tidak konsisten,
- client melakukan update berdasarkan stale representation.

Response cache harus dianggap bagian dari data consistency model.

### 9.2 `Cache-Control`

Jakarta REST menyediakan `CacheControl`:

```java
CacheControl cache = new CacheControl();
cache.setMaxAge(60);
cache.setPrivate(true);

return Response.ok(dto)
        .cacheControl(cache)
        .build();
```

Artinya:

```text
Response boleh dicache selama 60 detik.
Cache bersifat private untuk user/client, bukan shared proxy.
```

### 9.3 No Cache untuk Data Sensitif

Untuk data sensitif:

```java
CacheControl cache = new CacheControl();
cache.setNoStore(true);
cache.setNoCache(true);
cache.setMustRevalidate(true);

return Response.ok(dto)
        .cacheControl(cache)
        .header("Pragma", "no-cache")
        .build();
```

`no-store` penting untuk mencegah cache menyimpan response.

Gunakan untuk:

- personal data,
- token response,
- case/enforcement details,
- sensitive document metadata,
- dashboard user-specific,
- permission-dependent result.

### 9.4 Public Cache untuk Static/Reference Data

Untuk reference data yang tidak sensitif:

```java
CacheControl cache = new CacheControl();
cache.setPublic(true);
cache.setMaxAge(3600);

return Response.ok(referenceData)
        .cacheControl(cache)
        .build();
```

Cocok untuk:

- country list,
- code tables,
- non-sensitive static configuration,
- public metadata.

Namun jika code table sering berubah dan berdampak legal/regulatory, max-age harus konservatif atau gunakan ETag.

### 9.5 Cache-Control Strategy Table

| Jenis Data | Header Strategy | Catatan |
|---|---|---|
| Token/session response | `no-store` | Jangan disimpan |
| User-specific dashboard | `private, no-cache` atau `no-store` | Tergantung sensitivitas |
| Case/enforcement detail | Biasanya `no-store` | Regulatory-sensitive |
| Public reference data | `public, max-age=N` | Tambahkan ETag jika bisa |
| Search result permission-dependent | `private` atau `no-store` | Jangan shared cache |
| File public immutable | `public, max-age besar, immutable` | Header `immutable` custom string jika diperlukan |
| Export personal report | `no-store` | File bisa sensitif |

---

## 10. ETag dan Conditional Request

### 10.1 Problem yang Diselesaikan ETag

ETag menyelesaikan dua problem besar:

1. **Efficient read**  
   Client tidak perlu download body jika representasi belum berubah.

2. **Optimistic concurrency**  
   Client tidak menimpa perubahan orang lain berdasarkan data lama.

Mental model:

```text
ETag = identifier versi representasi resource
```

Bukan selalu hash database row mentah. ETag harus merepresentasikan versi dari representation yang dikirim ke client.

### 10.2 Membuat ETag

```java
EntityTag tag = new EntityTag(customer.version().toString());

return Response.ok(dto)
        .tag(tag)
        .build();
```

Response header:

```text
ETag: "12345"
```

### 10.3 Strong vs Weak ETag

Strong ETag:

```java
new EntityTag("abc123", false)
```

Weak ETag:

```java
new EntityTag("abc123", true)
```

Konseptual:

```text
Strong ETag: representasi harus byte-equivalent untuk dianggap sama.
Weak ETag: representasi semantically equivalent, tetapi byte bisa berbeda.
```

Untuk optimistic concurrency update, strong ETag lebih aman.

### 10.4 Conditional GET dengan `If-None-Match`

Client:

```text
GET /customers/123
If-None-Match: "v7"
```

Server:

- jika resource masih versi `v7`, return `304 Not Modified`, tanpa body,
- jika berubah, return `200 OK` dengan body baru dan ETag baru.

Jersey menyediakan helper melalui `Request` context:

```java
@GET
@Path("/{id}")
@Produces(MediaType.APPLICATION_JSON)
public Response get(
        @PathParam("id") UUID id,
        @Context Request request
) {
    CustomerView view = service.getView(id);
    EntityTag etag = new EntityTag(view.versionTag());

    Response.ResponseBuilder precondition = request.evaluatePreconditions(etag);
    if (precondition != null) {
        return precondition.tag(etag).build();
    }

    return Response.ok(view.dto())
            .tag(etag)
            .build();
}
```

Mental model:

```text
evaluatePreconditions(etag) returns non-null jika conditional header membuat response pendek bisa dikembalikan.
```

### 10.5 Conditional GET dengan Last-Modified

```java
Date lastModified = Date.from(view.lastModifiedAt());

Response.ResponseBuilder precondition = request.evaluatePreconditions(lastModified);
if (precondition != null) {
    return precondition.lastModified(lastModified).build();
}

return Response.ok(view.dto())
        .lastModified(lastModified)
        .build();
```

ETag biasanya lebih presisi daripada Last-Modified karena timestamp resolution dan clock skew bisa menjadi masalah.

### 10.6 Conditional Update dengan `If-Match`

Problem:

```text
User A GET case version 7
User B GET case version 7
User A update -> version 8
User B update based on version 7 -> harus ditolak
```

Client:

```text
PUT /cases/123
If-Match: "v7"
```

Server:

```java
@PUT
@Path("/{id}")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response update(
        @PathParam("id") UUID id,
        UpdateCaseRequest body,
        @Context Request request
) {
    CaseVersion current = service.getCurrentVersion(id);
    EntityTag currentTag = new EntityTag(current.etag());

    Response.ResponseBuilder failed = request.evaluatePreconditions(currentTag);
    if (failed != null) {
        // For If-Match mismatch, this should result in 412 Precondition Failed.
        return failed.tag(currentTag).build();
    }

    UpdatedCase updated = service.update(id, body, current.version());
    EntityTag newTag = new EntityTag(updated.etag());

    return Response.ok(updated.dto())
            .tag(newTag)
            .build();
}
```

Namun hati-hati: precondition evaluation dan update harus tetap aman terhadap race condition. Jangan hanya check di resource lalu update tanpa database-level/version-level guard.

Lebih aman:

```text
HTTP If-Match check
  + service/database optimistic locking
  + affected row/version validation
```

Contoh service:

```java
public UpdatedCase update(UUID id, UpdateCaseRequest request, long expectedVersion) {
    int updatedRows = repository.updateIfVersionMatches(id, expectedVersion, request);
    if (updatedRows == 0) {
        throw new ConcurrentModificationException("Case was modified by another transaction");
    }
    return repository.getUpdated(id);
}
```

### 10.7 409 vs 412

Gunakan:

```text
412 Precondition Failed
```

jika client mengirim conditional header dan precondition gagal.

Gunakan:

```text
409 Conflict
```

jika konflik berasal dari business state, bukan conditional HTTP precondition.

Contoh:

```text
412: If-Match versi tidak cocok.
409: Case tidak bisa di-approve karena status CLOSED.
```

---

## 11. Streaming Response

### 11.1 Kenapa Streaming Penting

Tanpa streaming, aplikasi sering melakukan ini:

```java
byte[] file = reportService.generateHugeReport();
return Response.ok(file).build();
```

Masalah:

- seluruh file berada di heap,
- GC pressure tinggi,
- latency first byte buruk,
- risiko OOM,
- export besar mengganggu request lain,
- memory usage meningkat linear terhadap ukuran file dan concurrent request.

Streaming memungkinkan:

```text
generate/read chunk -> write chunk -> flush/continue
```

bukan:

```text
load all -> write all
```

### 11.2 `StreamingOutput`

```java
@GET
@Path("/{id}/download")
@Produces("application/pdf")
public Response download(@PathParam("id") UUID id) {
    ReportDescriptor report = reportService.prepare(id);

    StreamingOutput stream = output -> {
        reportService.writePdf(id, output);
    };

    return Response.ok(stream)
            .type("application/pdf")
            .header("Content-Disposition", "attachment; filename=\"report.pdf\"")
            .build();
}
```

Mental model:

```text
Resource method returns quickly with StreamingOutput object.
Actual bytes are written later by Jersey/container when response body is serialized.
```

### 11.3 Resource Lifecycle Trap

Buruk:

```java
@GET
public Response download() throws IOException {
    InputStream in = Files.newInputStream(path);

    StreamingOutput stream = output -> {
        in.transferTo(output); // Java 9+
    };

    return Response.ok(stream).build();
}
```

Masalah:

- stream dibuka sebelum response writing,
- jika error sebelum writing, resource bisa bocor,
- `transferTo` tidak ada di Java 8.

Lebih baik:

```java
StreamingOutput stream = output -> {
    try (InputStream in = Files.newInputStream(path)) {
        copy(in, output);
    }
};

return Response.ok(stream)
        .type("application/octet-stream")
        .build();
```

Helper Java 8 compatible:

```java
private static void copy(InputStream in, OutputStream out) throws IOException {
    byte[] buffer = new byte[8192];
    int read;
    while ((read = in.read(buffer)) != -1) {
        out.write(buffer, 0, read);
    }
}
```

### 11.4 StreamingOutput Error Semantics

Jika exception terjadi saat streaming sudah mulai, status code mungkin sudah terkirim ke client. Artinya server tidak selalu bisa mengubah response menjadi JSON error.

Contoh:

```text
HTTP/1.1 200 OK
Content-Type: application/pdf

<partial pdf bytes>
-- failure occurs --
connection closed
```

Konsekuensi:

- jangan melakukan validasi penting setelah mulai write,
- cek permission sebelum streaming,
- cek file existence sebelum streaming,
- cek metadata sebelum streaming,
- audit start dan failure secara jelas,
- client harus siap menghadapi truncated download.

### 11.5 Streaming Checklist

Sebelum menulis byte pertama:

```text
[ ] Authentication sudah valid
[ ] Authorization sudah valid
[ ] Resource existence sudah valid
[ ] File/object metadata sudah valid
[ ] Content-Type sudah diketahui
[ ] Filename aman
[ ] Audit download attempt tercatat
[ ] Response status final sudah benar
```

Saat streaming:

```text
[ ] InputStream dibuka lazy di dalam StreamingOutput
[ ] InputStream ditutup dengan try-with-resources
[ ] Buffer size wajar
[ ] Tidak menyimpan seluruh payload di heap
[ ] Exception dicatat dengan correlation ID
```

Setelah streaming:

```text
[ ] Success/failure metrics tercatat jika memungkinkan
[ ] Resource temporary dibersihkan
[ ] Tidak ada thread/task tertinggal
```

---

## 12. File Download Response

### 12.1 Basic Download

```java
@GET
@Path("/{documentId}/content")
public Response download(@PathParam("documentId") UUID documentId) {
    DocumentMeta meta = documentService.getMeta(documentId);

    StreamingOutput output = out -> documentService.writeContent(documentId, out);

    return Response.ok(output)
            .type(meta.contentType())
            .header("Content-Disposition", ContentDispositionNames.safeAttachment(meta.filename()))
            .build();
}
```

### 12.2 Jangan Percaya MIME dari User

Jika file di-upload user, jangan percaya:

```text
Content-Type dari upload
filename extension
```

Gunakan kombinasi:

- server-side detected MIME,
- whitelist allowed type,
- metadata tersimpan,
- antivirus/malware scan result,
- security policy.

### 12.3 `Content-Length`

Jika ukuran diketahui:

```java
return Response.ok(output)
        .type(meta.contentType())
        .header("Content-Length", meta.sizeBytes())
        .build();
```

Manfaat:

- client bisa menampilkan progress,
- proxy bisa mengelola response lebih baik,
- monitoring bisa memperkirakan transfer.

Namun jangan set `Content-Length` jika ukuran tidak pasti atau stream bisa berubah.

### 12.4 Range Request

Range request berguna untuk:

- resume download,
- video/audio streaming,
- file besar.

Jakarta REST/Jersey tidak otomatis membuat semua endpoint mendukung Range. Jika perlu, implementasikan secara sadar:

```text
Request:  Range: bytes=1000-1999
Response: 206 Partial Content
Headers:  Content-Range, Accept-Ranges, Content-Length
```

Untuk dokumen biasa di enterprise, Range sering tidak wajib. Untuk object storage, lebih baik memanfaatkan signed URL/presigned URL jika arsitektur mengizinkan.

---

## 13. Response Envelope: Perlu atau Tidak?

### 13.1 Pola Envelope

```json
{
  "data": {
    "id": "123",
    "name": "Alice"
  },
  "meta": {
    "correlationId": "abc"
  }
}
```

Keuntungan:

- konsisten untuk pagination/meta,
- mudah menambahkan metadata,
- client punya shape seragam.

Kerugian:

- tidak selalu cocok untuk file/streaming,
- bisa menduplikasi HTTP semantics,
- error/success bisa bercampur,
- membuat API kurang natural,
- client harus unwrap.

### 13.2 Jangan Sembunyikan Status HTTP di Envelope

Buruk:

```json
{
  "success": false,
  "status": 404,
  "message": "Not found"
}
```

dengan HTTP:

```text
200 OK
```

Lebih baik:

```text
404 Not Found
Content-Type: application/problem+json
```

Body:

```json
{
  "type": "https://api.example.com/problems/resource-not-found",
  "title": "Resource not found",
  "status": 404,
  "code": "CUSTOMER_NOT_FOUND",
  "correlationId": "abc"
}
```

### 13.3 Rekomendasi Pragmatik

Gunakan envelope untuk:

- paginated list,
- search result,
- bulk operation summary,
- response yang memang punya `data + meta`.

Jangan paksa envelope untuk:

- file download,
- `204 No Content`,
- redirect,
- streaming,
- plain health endpoint,
- error jika sudah memakai problem details.

---

## 14. Pagination Response

### 14.1 Pagination Bukan Hanya Body

Response list sebaiknya punya:

- data,
- pagination metadata,
- links,
- cache policy,
- stable ordering contract.

Body:

```json
{
  "data": [
    { "id": "1" },
    { "id": "2" }
  ],
  "page": {
    "limit": 50,
    "nextCursor": "eyJpZCI6IjIifQ"
  }
}
```

Header Link:

```text
Link: </customers?cursor=abc&limit=50>; rel="next"
```

### 14.2 Jersey Response Example

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public Response search(@BeanParam CustomerSearchParams params, @Context UriInfo uriInfo) {
    SearchResult<CustomerDto> result = service.search(params);

    Response.ResponseBuilder builder = Response.ok(new SearchResponse<>(
            result.items(),
            new PageMeta(params.limit(), result.nextCursor())
    ));

    if (result.nextCursor() != null) {
        URI next = uriInfo.getAbsolutePathBuilder()
                .replaceQueryParam("cursor", result.nextCursor())
                .replaceQueryParam("limit", params.limit())
                .build();

        builder.link(next, "next");
    }

    return builder.build();
}
```

### 14.3 Pagination Failure Mode

Offset pagination:

```text
?page=10&size=50
```

bisa bermasalah jika data berubah saat user berpindah page.

Cursor pagination lebih stabil untuk data besar:

```text
?cursor=...
```

Tetapi cursor harus:

- opaque,
- signed jika perlu,
- punya expiry jika mengandung state,
- tidak membocorkan internal ordering sensitif.

---

## 15. Idempotency Metadata dalam Response

Untuk POST yang didukung idempotency key:

Request:

```text
POST /payments
Idempotency-Key: abc-123
```

Response pertama:

```text
201 Created
Location: /payments/pay_001
Idempotency-Key: abc-123
```

Response replay:

```text
200 OK atau 201 Created sesuai kontrak
Idempotency-Key: abc-123
Idempotency-Replayed: true
```

Jersey example:

```java
return Response.status(result.replayed() ? Response.Status.OK : Response.Status.CREATED)
        .location(paymentUri)
        .entity(result.response())
        .header("Idempotency-Key", result.key())
        .header("Idempotency-Replayed", result.replayed())
        .build();
```

Yang penting:

```text
Idempotency bukan hanya request processing.
Response juga harus konsisten dan replay-safe.
```

---

## 16. Response Filter dan Header Global

Banyak header sebaiknya tidak diset manual di setiap resource.

Contoh:

- correlation ID,
- security headers,
- cache default,
- server timing,
- deprecation warning,
- API version.

Gunakan `ContainerResponseFilter`:

```java
@Provider
public class CorrelationResponseFilter implements ContainerResponseFilter {
    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        String correlationId = (String) requestContext.getProperty("correlationId");
        if (correlationId != null) {
            responseContext.getHeaders().putSingle("X-Correlation-Id", correlationId);
        }
    }
}
```

Security header example:

```java
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter {
    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        responseContext.getHeaders().putSingle("X-Content-Type-Options", "nosniff");
        responseContext.getHeaders().putSingle("X-Frame-Options", "DENY");
        responseContext.getHeaders().putSingle("Referrer-Policy", "no-referrer");
    }
}
```

Hati-hati:

```text
Global filter jangan override header spesifik endpoint tanpa aturan jelas.
```

Buruk:

```java
responseContext.getHeaders().putSingle("Cache-Control", "no-store");
```

Jika dilakukan global, endpoint public cacheable kehilangan caching.

Lebih baik:

```java
if (!responseContext.getHeaders().containsKey("Cache-Control")) {
    responseContext.getHeaders().putSingle("Cache-Control", "no-store");
}
```

atau gunakan annotation/name binding untuk policy berbeda.

---

## 17. Writer Interceptor Impact terhadap Response

Response entity akan melewati writer interceptor sebelum `MessageBodyWriter` final menulis output.

Use case:

- compression,
- payload signing,
- encryption,
- checksum,
- audit hash,
- response body wrapping.

Tetapi writer interceptor berbahaya jika tidak memahami stream.

Conceptual pipeline:

```text
resource method result
  -> ContainerResponseFilter
  -> WriterInterceptor 1
  -> WriterInterceptor 2
  -> MessageBodyWriter
  -> OutputStream
```

Jika interceptor membaca/men-buffer seluruh body, streaming bisa berubah menjadi non-streaming dan OOM.

Rule:

```text
Jangan memasang writer interceptor global yang mem-buffer body besar tanpa size limit.
```

---

## 18. Error Response vs Success Response

Part 9 akan membahas exception mapping detail. Namun response engineering harus memahami boundary ini.

### 18.1 Success Response Jangan Mengandung Error Semantics

Buruk:

```java
return Response.ok(new ApiResponse(false, "ORDER_CLOSED")).build();
```

Lebih baik:

```java
return Response.status(Response.Status.CONFLICT)
        .entity(problem("ORDER_CLOSED"))
        .build();
```

### 18.2 Error Response Harus Stabil

Error response minimal:

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "correlationId": "01HX...",
  "errors": [
    {
      "field": "email",
      "message": "must be a valid email"
    }
  ]
}
```

Jangan leak:

- stack trace,
- SQL,
- table name,
- internal class name,
- downstream raw error,
- token/secret,
- PII yang tidak perlu.

---

## 19. Java 8 sampai Java 25 Considerations

### 19.1 Namespace

Java version bukan satu-satunya concern. Jersey generation juga penting:

```text
Jersey 2.x -> javax.ws.rs.*
Jersey 3.x/4.x -> jakarta.ws.rs.*
```

Jangan mencampur:

```java
javax.ws.rs.core.Response
```

dengan:

```java
jakarta.ws.rs.core.Response
```

di aplikasi Jakarta-era.

### 19.2 Java 8

Keterbatasan/pertimbangan:

- tidak ada `InputStream.transferTo`,
- tidak ada records,
- tidak ada switch expression,
- date/time API sudah ada (`java.time`),
- banyak legacy Jersey 2.x masih berjalan di Java 8,
- gunakan helper copy manual untuk streaming.

### 19.3 Java 11/17

Pertimbangan:

- modern TLS default lebih baik,
- container baseline banyak pindah ke 11/17,
- Jakarta EE 10/11 umumnya punya Java baseline lebih tinggi,
- gunakan `var` lokal dengan tetap menjaga readability,
- module path bisa memunculkan reflective access issue.

### 19.4 Java 21/25

Pertimbangan:

- virtual threads bisa membantu blocking IO jika container mendukung dan dikonfigurasi benar,
- streaming endpoint tetap harus hati-hati karena koneksi lama menahan resource,
- ThreadLocal/MDC context propagation perlu diperhatikan,
- structured concurrency lebih relevan di service/client orchestration daripada response builder langsung,
- modern GC seperti ZGC membantu latency, tapi tidak memperbaiki desain yang men-buffer file besar di heap.

Rule:

```text
Java modern membantu runtime, tetapi tidak menggantikan response semantics yang benar.
```

---

## 20. Production Patterns

### 20.1 Created Resource Pattern

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request, @Context UriInfo uriInfo) {
    CreatedCustomer created = service.create(request);

    URI location = uriInfo.getAbsolutePathBuilder()
            .path(created.id().toString())
            .build();

    return Response.created(location)
            .entity(created.response())
            .tag(new EntityTag(created.etag()))
            .build();
}
```

### 20.2 No Content Update Pattern

```java
@PUT
@Path("/{id}/status")
@Consumes(MediaType.APPLICATION_JSON)
public Response updateStatus(@PathParam("id") UUID id, UpdateStatusRequest request) {
    service.updateStatus(id, request.status());
    return Response.noContent().build();
}
```

### 20.3 Accepted Job Pattern

```java
@POST
@Path("/exports")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response export(ExportRequest request, @Context UriInfo uriInfo) {
    ExportJob job = service.submitExport(request);

    URI jobUri = uriInfo.getAbsolutePathBuilder()
            .path(job.id().toString())
            .build();

    return Response.accepted(new JobResponse(job.id(), job.status()))
            .location(jobUri)
            .build();
}
```

### 20.4 Conditional GET Pattern

```java
@GET
@Path("/{id}")
@Produces(MediaType.APPLICATION_JSON)
public Response get(@PathParam("id") UUID id, @Context Request request) {
    CustomerView view = service.getView(id);
    EntityTag tag = new EntityTag(view.etag());

    Response.ResponseBuilder conditional = request.evaluatePreconditions(tag);
    if (conditional != null) {
        return conditional.tag(tag).build();
    }

    CacheControl cache = new CacheControl();
    cache.setPrivate(true);
    cache.setMaxAge(60);

    return Response.ok(view.dto())
            .tag(tag)
            .cacheControl(cache)
            .build();
}
```

### 20.5 Secure Download Pattern

```java
@GET
@Path("/{id}/content")
public Response download(@PathParam("id") UUID id) {
    DocumentMeta meta = documentService.authorizeAndGetMeta(id);

    StreamingOutput output = out -> documentService.writeContent(id, out);

    CacheControl cache = new CacheControl();
    cache.setNoStore(true);

    return Response.ok(output)
            .type(meta.contentType())
            .cacheControl(cache)
            .header("Content-Disposition", ContentDispositionNames.safeAttachment(meta.filename()))
            .header("Content-Length", meta.size())
            .build();
}
```

---

## 21. Common Failure Modes

### 21.1 `204 No Content` Tetapi Ada Body

Buruk:

```java
return Response.noContent()
        .entity(dto)
        .build();
```

Kontrak `204` adalah no body. Jangan menaruh entity.

### 21.2 `201 Created` Tanpa Location

Tidak selalu invalid, tetapi sering kurang lengkap.

Buruk:

```java
return Response.status(Response.Status.CREATED)
        .entity(dto)
        .build();
```

Lebih baik:

```java
return Response.created(location)
        .entity(dto)
        .build();
```

### 21.3 Semua Error Jadi `200 OK`

Merusak observability, retry, gateway behavior.

### 21.4 File Besar Di-load ke Memory

Buruk:

```java
byte[] data = Files.readAllBytes(path);
return Response.ok(data).build();
```

Lebih baik streaming.

### 21.5 Cache Sensitif Tidak Dikontrol

Jika tidak ada cache header, browser/proxy mungkin menyimpan response tergantung konteks.

Untuk sensitive API, set policy eksplisit.

### 21.6 ETag Dibuat dari Timestamp Tidak Stabil

Buruk:

```java
new EntityTag(String.valueOf(System.currentTimeMillis()))
```

Ini berubah setiap request, sehingga conditional GET tidak berguna.

ETag harus berasal dari version/hash representasi yang stabil.

### 21.7 Location Salah di Balik Proxy

Jika `Location` berisi internal hostname, client/gateway flow bisa rusak.

### 21.8 Response Header Mengandung User Input Mentah

Contoh berbahaya:

```java
.header("Content-Disposition", "attachment; filename=\"" + userInput + "\"")
```

Risiko:

- header injection,
- broken download,
- filename spoofing.

### 21.9 Streaming Error Setelah Status Terkirim

Jangan berharap exception mapper selalu bisa mengubah error menjadi JSON jika bytes sudah mulai dikirim.

### 21.10 Generic Type Hilang

Jika provider/custom writer membutuhkan generic type, gunakan `GenericEntity`.

---

## 22. Design Checklist

### 22.1 General Response Checklist

```text
[ ] Status code sesuai semantics operasi
[ ] Body sesuai status code
[ ] Content-Type eksplisit untuk public API
[ ] Header penting diset eksplisit
[ ] Error tidak disembunyikan di 200 OK
[ ] Response tidak membocorkan internal detail
[ ] Correlation ID tersedia
[ ] Cache policy jelas
[ ] DTO bukan domain entity mentah
[ ] Generic collection aman jika perlu
```

### 22.2 Create Endpoint Checklist

```text
[ ] Gunakan 201 jika resource dibuat synchronously
[ ] Gunakan Location untuk resource baru
[ ] Body berisi representation/result jika berguna
[ ] ETag dikembalikan jika resource versioned
[ ] Idempotency policy jelas jika POST bisa retry
```

### 22.3 Update Endpoint Checklist

```text
[ ] 200 jika mengembalikan body baru
[ ] 204 jika tidak ada body
[ ] 409 untuk business conflict
[ ] 412 untuk conditional precondition failure
[ ] Optimistic locking tidak hanya di HTTP layer
```

### 22.4 Download/Streaming Checklist

```text
[ ] Authorization sebelum stream dimulai
[ ] Metadata diketahui sebelum body dikirim
[ ] Content-Type benar
[ ] Content-Disposition aman
[ ] Cache policy sesuai sensitivitas
[ ] Tidak load seluruh file ke heap
[ ] Stream dibuka lazy dan ditutup
[ ] Error streaming tercatat
```

### 22.5 Cache/Conditional Checklist

```text
[ ] Sensitive data memakai no-store/private policy
[ ] Public reference data punya max-age/ETag jika cocok
[ ] ETag stabil terhadap representasi
[ ] If-None-Match mendukung 304 untuk read
[ ] If-Match mendukung 412 untuk update jika perlu
[ ] Last-Modified tidak digunakan sebagai satu-satunya concurrency guard jika presisi penting
```

---

## 23. Mini Exercises

### Exercise 1 — Create Response

Ubah endpoint ini agar lebih benar secara HTTP:

```java
@POST
public CustomerDto create(CreateCustomerRequest request) {
    return service.create(request);
}
```

Target:

- status `201 Created`,
- `Location`,
- body DTO,
- optional ETag.

### Exercise 2 — Secure Download

Desain endpoint download dokumen yang:

- tidak load file ke memory,
- set content type,
- set filename aman,
- set no-store,
- mencatat audit attempt sebelum streaming.

### Exercise 3 — Conditional GET

Tambahkan ETag pada endpoint:

```java
@GET
@Path("/{id}")
public CustomerDto get(@PathParam("id") UUID id) {
    return service.get(id);
}
```

Target:

- response `200 OK` jika berubah,
- response `304 Not Modified` jika ETag cocok,
- ETag dikirim di response.

### Exercise 4 — Status Code Taxonomy

Tentukan status code yang tepat untuk kasus berikut:

1. request JSON malformed,
2. order tidak bisa dibatalkan karena sudah shipped,
3. update ditolak karena `If-Match` tidak cocok,
4. export report diterima dan akan diproses background,
5. delete berhasil tanpa body,
6. user authenticated tapi tidak punya permission,
7. downstream document service timeout.

---

## 24. Review Questions

1. Apa bedanya return DTO langsung dengan return `Response`?
2. Kenapa `201 Created` sebaiknya punya `Location`?
3. Kapan memakai `202 Accepted`?
4. Kenapa `204 No Content` tidak boleh punya body?
5. Apa peran `GenericEntity`?
6. Apa risiko mengembalikan JPA entity langsung sebagai response?
7. Apa beda `409 Conflict` dan `412 Precondition Failed`?
8. Kenapa streaming error sulit dimapping menjadi JSON error?
9. Bagaimana ETag membantu optimistic concurrency?
10. Apa risiko `Location` yang dibangun dari `UriInfo` di balik reverse proxy?
11. Kapan response perlu `no-store`?
12. Kenapa semua error tidak boleh dikirim sebagai `200 OK`?

---

## 25. Ringkasan Mental Model

Response engineering di Jersey adalah kemampuan untuk menerjemahkan hasil aplikasi menjadi HTTP response yang benar secara:

```text
semantic
+ protocol
+ runtime
+ security
+ observability
+ performance
+ compatibility
```

Jersey memberi API:

```text
Response
ResponseBuilder
EntityTag
CacheControl
Request.evaluatePreconditions
StreamingOutput
GenericEntity
ContainerResponseFilter
WriterInterceptor
```

Tetapi API tersebut hanya alat. Yang penting adalah keputusan desain:

```text
Status apa yang paling jujur?
Header apa yang menjadi bagian kontrak?
Body apa yang aman dan stabil?
Apakah response boleh dicache?
Apakah update butuh concurrency guard?
Apakah payload harus streaming?
Apakah response tetap benar di balik proxy/gateway?
Apakah client bisa mengambil keputusan otomatis dari response ini?
```

Engineer top-level tidak sekadar membuat endpoint “jalan”. Ia membuat response yang bisa dipahami oleh:

- client,
- gateway,
- cache,
- browser,
- monitoring,
- auditor,
- operator,
- dan engineer lain yang akan men-debug incident 6 bulan kemudian.

---

## 26. Apa yang Berikutnya

Part berikutnya:

```text
Part 9 — Exception Mapping Architecture: Failure Taxonomy, Mapper Resolution, and Error Contracts
```

Part 8 membahas response sukses dan response semantics umum. Part 9 akan memperdalam sisi failure:

- `ExceptionMapper`,
- mapper resolution,
- domain vs infrastructure error,
- validation error,
- security error,
- problem details,
- error code taxonomy,
- correlation ID,
- stack trace leakage prevention,
- observability saat failure.

Status seri setelah Part 8:

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
Part 9  — berikutnya
...
Part 32 — target akhir / capstone
```

Seri belum selesai.

---

## 27. Referensi Resmi dan Teknis

Referensi yang relevan untuk part ini:

- Jakarta RESTful Web Services 4.0 Specification
- Jakarta RESTful Web Services 4.0 API Docs
- Jakarta REST `Response`, `Response.ResponseBuilder`, `EntityTag`, `CacheControl`, `Request`, `StreamingOutput`, `GenericEntity`
- Jersey User Guide — Message Body Workers / Entity Providers
- Jersey User Guide — Filters and Interceptors
- RFC 9110 — HTTP Semantics
- RFC 9111 — HTTP Caching
- RFC 7807 — Problem Details for HTTP APIs
- RFC 9457 — Problem Details update

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./07-json-in-jersey-jackson-jsonb-moxy-production-serialization-strategy.md">⬅️ Part 7 — JSON in Jersey: Jackson, JSON-B, MOXy, and Production Serialization Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./09-exception-mapping-architecture-failure-taxonomy-mapper-resolution-error-contracts.md">Part 9 — Exception Mapping Architecture: Failure Taxonomy, Mapper Resolution, and Error Contracts ➡️</a>
</div>
