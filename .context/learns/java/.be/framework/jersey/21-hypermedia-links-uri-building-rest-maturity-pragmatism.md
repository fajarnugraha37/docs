# Part 21 — Hypermedia, Links, URI Building, and REST Maturity Pragmatism

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Part: `21 / 32`  
File: `21-hypermedia-links-uri-building-rest-maturity-pragmatism.md`  
Scope: Java 8–25, Jersey 2.x/3.x/4.x, JAX-RS/Jakarta REST, production API design

---

## 0. Tujuan Part Ini

Di part sebelumnya kita membahas **API versioning dan compatibility**. Sekarang kita naik ke topik yang sering terlihat “tidak terlalu penting”, tetapi dalam production system sering menjadi sumber bug yang menyakitkan:

> bagaimana API membangun URI, link, `Location`, pagination link, dan resource relationship secara benar, terutama ketika aplikasi berjalan di balik reverse proxy, load balancer, API gateway, context path, servlet mapping, atau domain publik yang berbeda dari domain internal.

Banyak engineer bisa membuat endpoint:

```java
@POST
public Response create(CreateOrderRequest request) {
    Order order = service.create(request);
    return Response.created(URI.create("/orders/" + order.id())).build();
}
```

Tetapi engineer yang lebih matang akan bertanya:

- Apakah URI itu absolut atau relatif?
- Apakah path-nya benar ketika aplikasi di-deploy di `/api`?
- Apakah scheme-nya `https` ketika backend menerima traffic dari ALB via `http`?
- Apakah host-nya host internal pod, host container, atau public API domain?
- Apakah link tetap benar setelah gateway melakukan path rewrite?
- Apakah pagination link mempertahankan filter query user?
- Apakah link aman dari header spoofing?
- Apakah client memang membutuhkan hypermedia, atau cukup `Location` dan pagination links?

Part ini bukan dogma HATEOAS. Fokusnya adalah **URI correctness dan link pragmatism**.

---

## 1. Mental Model: URI dan Link adalah Bagian dari Kontrak API

REST API sering dipikirkan sebagai:

```text
request DTO -> business logic -> response DTO
```

Tetapi secara HTTP, response bukan hanya body. Response adalah:

```text
status code
headers
entity/body
links
cache metadata
resource identity
```

URI dan link adalah bagian dari **resource identity** dan **navigation contract**.

Dalam sistem enterprise, terutama case management / regulatory workflow, resource identity penting karena link sering dipakai untuk:

- hasil create resource: `Location: /cases/{caseId}`
- async operation: link ke job/status/progress
- pagination: `next`, `prev`, `first`, `last`
- document/download reference
- audit evidence reference
- relationship antar entity: case -> appeal -> correspondence -> document
- cross-module navigation
- email/correspondence callback
- external integration callback
- frontend routing bridge

Kalau link salah, efeknya bukan hanya UI rusak. Bisa terjadi:

- client diarahkan ke internal hostname
- external partner mendapat `http://localhost:8080/...`
- generated link kehilangan API gateway prefix
- pagination link menghapus query filter
- signed callback URL invalid
- audit record menyimpan URL yang tidak bisa dibuka
- created response mengarah ke resource yang tidak accessible oleh caller
- security leak karena internal topology terbuka

Top 1% engineer tidak memperlakukan URL sebagai string tempelan. Mereka memperlakukan URL sebagai **derived contract** yang harus dibangun dari runtime context yang benar.

---

## 2. Istilah Dasar yang Harus Dibedakan

### 2.1 URI, URL, URN

Dalam praktik API, kita sering menyebut semuanya URL. Secara teknis:

```text
URI = identifier umum
URL = URI yang juga menunjukkan lokasi/access mechanism
URN = URI nama tetap, bukan lokasi langsung
```

Contoh:

```text
URI: /cases/123
URL: https://api.example.com/cases/123
URN: urn:case:123
```

Di Jakarta REST/Jersey, class seperti `UriInfo` dan `UriBuilder` memakai istilah URI karena mereka membangun identifier/lokasi resource.

### 2.2 Absolute URI vs Relative URI

Absolute URI:

```text
https://api.example.com/v1/cases/123
```

Relative URI:

```text
/cases/123
cases/123
../cases/123
```

Untuk `Location` header pada `201 Created`, absolute URI sering lebih aman untuk integrasi eksternal, tetapi banyak framework/client modern menerima relative reference. Namun dalam enterprise integration, absolute public URI biasanya lebih jelas karena client tidak perlu menebak base.

### 2.3 Internal URI vs Public URI

Internal URI:

```text
http://aceas-case-service:8080/internal/cases/123
http://10.20.5.11:8080/app/cases/123
```

Public URI:

```text
https://api.example.gov.sg/aceas/v1/cases/123
```

Resource yang sama bisa punya dua alamat berbeda tergantung perspektif.

Kesalahan umum:

> menggunakan `uriInfo.getBaseUri()` lalu menganggap hasilnya pasti public URI.

Di balik proxy/gateway, `UriInfo` sering melihat request sebagaimana diterima container, bukan sebagaimana dilihat caller external.

---

## 3. Komponen URI dalam Jersey/Jakarta REST

Jersey menjalankan Jakarta REST di atas container. Untuk memahami link generation, kita perlu membedakan beberapa lapisan path.

Misal public request:

```text
GET https://api.example.com/aceas/api/v1/cases/123?include=documents
```

Di gateway, request di-rewrite menjadi:

```text
GET http://case-service:8080/app/cases/123?include=documents
```

Di aplikasi:

```java
@ApplicationPath("/api/v1")
public class CaseApplication extends ResourceConfig { }

@Path("/cases")
public class CaseResource {
    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") String id) { ... }
}
```

Tergantung deployment, ada beberapa path:

```text
Public gateway prefix     : /aceas
Application path          : /api/v1
Resource class path       : /cases
Resource method path      : /{id}
Query                     : ?include=documents
```

Tetapi backend bisa saja hanya melihat:

```text
Container context path    : /app
Servlet mapping           : /* or /api/*
Resource path             : /cases/123
```

Karena itu, link generation harus sadar konteks:

```text
public base URI != internal base URI
```

---

## 4. API Penting: `UriInfo`

`UriInfo` adalah injectable context object dari Jakarta REST untuk membaca informasi URI request.

Contoh:

```java
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.UriInfo;

@Path("/cases")
public class CaseResource {

    @Context
    UriInfo uriInfo;

    @GET
    @Path("/{id}")
    public Response get(@PathParam("id") String id) {
        URI requestUri = uriInfo.getRequestUri();
        URI baseUri = uriInfo.getBaseUri();
        List<PathSegment> segments = uriInfo.getPathSegments();
        MultivaluedMap<String, String> query = uriInfo.getQueryParameters();
        return Response.ok().build();
    }
}
```

Konsep penting:

```text
getRequestUri()        = full request URI as seen by runtime
getBaseUri()           = base URI of application
getAbsolutePath()      = request URI without query
getPath()              = request path relative to application
getPathSegments()      = path broken into segments
getQueryParameters()   = parsed query params
getMatchedURIs()       = matched URI stack
getMatchedResources()  = matched resource object stack
```

### 4.1 `UriInfo` Bukan Global Config

`UriInfo` merepresentasikan request saat ini.

Artinya:

- boleh dipakai di request scope
- tidak boleh disimpan di singleton field untuk dipakai nanti
- tidak boleh dipakai di background job setelah request selesai
- tidak boleh dianggap valid di async task tanpa context propagation yang benar

Anti-pattern:

```java
@Singleton
public class LinkService {
    @Context
    UriInfo uriInfo; // berbahaya: request-bound object di singleton service
}
```

Lebih baik:

```java
public class LinkService {
    public URI caseUri(UriInfo uriInfo, String id) {
        return uriInfo.getBaseUriBuilder()
            .path(CaseResource.class)
            .path(CaseResource.class, "get")
            .resolveTemplate("id", id)
            .build();
    }
}
```

Atau lebih baik lagi untuk sistem besar: gunakan explicit public base URI config, nanti dibahas.

---

## 5. API Penting: `UriBuilder`

`UriBuilder` adalah builder URI yang memahami template, path segment, query parameter, dan encoding.

Jangan membangun URI dengan string concatenation kecuali untuk kasus sangat sederhana dan terkontrol.

Buruk:

```java
URI uri = URI.create("/cases/" + id + "?include=" + include);
```

Masalah:

- `id` bisa mengandung karakter yang perlu di-encode
- query param tidak di-encode dengan benar
- double slash mudah terjadi
- base path mudah salah
- maintainability buruk

Lebih baik:

```java
URI uri = uriInfo.getBaseUriBuilder()
    .path(CaseResource.class)
    .path(CaseResource.class, "get")
    .resolveTemplate("id", id)
    .queryParam("include", include)
    .build();
```

### 5.1 `path(String)` vs `path(Class)` vs `path(Class, method)`

```java
uriInfo.getBaseUriBuilder()
    .path("cases")
    .path("{id}")
    .resolveTemplate("id", id)
    .build();
```

Ini eksplisit tetapi string-based.

```java
uriInfo.getBaseUriBuilder()
    .path(CaseResource.class)
    .path(CaseResource.class, "get")
    .resolveTemplate("id", id)
    .build();
```

Ini annotation-aware. Jika `@Path` di class/method berubah, builder ikut berubah.

Contoh resource:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    public Response get(@PathParam("id") String id) {
        ...
    }
}
```

Maka builder di atas membangun path:

```text
/cases/{id}
```

### 5.2 Risiko `path(Class, methodName)`

Kelebihan:

- mengurangi hardcoded path
- selaras dengan annotation
- cocok untuk refactoring tertentu

Risiko:

- method overload bisa membingungkan
- rename method bisa merusak builder jika tidak tertangkap test
- terlalu bergantung pada resource method sebagai link contract
- path generation bisa tidak jelas untuk dynamic sub-resource locator

Untuk public API besar, biasanya baik membuat `Links` utility/factory yang explicit dan dites.

---

## 6. API Penting: `Link`

Jakarta REST menyediakan `jakarta.ws.rs.core.Link` untuk merepresentasikan link HTTP.

Contoh:

```java
Link self = Link.fromUri(uri)
    .rel("self")
    .type("application/json")
    .build();

return Response.ok(dto)
    .links(self)
    .build();
```

Secara HTTP, ini dapat menghasilkan header:

```text
Link: <https://api.example.com/cases/123>; rel="self"; type="application/json"
```

### 6.1 Link Header vs Link di Body

Ada dua pola umum:

#### Header-based links

```http
Link: <https://api.example.com/cases?page=2>; rel="next"
Link: <https://api.example.com/cases?page=10>; rel="last"
```

Kelebihan:

- standar HTTP
- tidak mengubah body DTO
- cocok untuk pagination metadata

Kekurangan:

- tidak semua client mudah membaca header
- frontend kadang lebih nyaman dengan body metadata
- dokumentasi API harus jelas

#### Body-based links

```json
{
  "data": {
    "id": "C-1001",
    "status": "OPEN"
  },
  "links": {
    "self": "https://api.example.com/cases/C-1001",
    "documents": "https://api.example.com/cases/C-1001/documents"
  }
}
```

Kelebihan:

- mudah dipakai frontend
- eksplisit dalam DTO
- cocok untuk API yang memang consumer-nya body-centric

Kekurangan:

- body menjadi lebih besar
- perlu versioning terhadap shape link
- bisa mencampur domain data dan navigation metadata

Rekomendasi pragmatis:

```text
Internal enterprise API biasa:
  gunakan Location header untuk create,
  Link header/body untuk pagination atau long-running operation,
  body links hanya jika client benar-benar membutuhkan navigasi dinamis.

Public/partner API:
  buat link contract eksplisit dan stabil,
  jangan menaruh link internal,
  dokumentasikan rel semantics.
```

---

## 7. `Location` Header: Resource Identity Setelah Create

Untuk `POST` yang membuat resource, response lazim:

```http
HTTP/1.1 201 Created
Location: https://api.example.com/v1/cases/C-1001
Content-Type: application/json

{
  "id": "C-1001",
  "status": "DRAFT"
}
```

Jersey:

```java
@POST
public Response create(CreateCaseRequest request, @Context UriInfo uriInfo) {
    CaseDto created = service.create(request);

    URI location = uriInfo.getBaseUriBuilder()
        .path(CaseResource.class)
        .path(CaseResource.class, "get")
        .resolveTemplate("id", created.id())
        .build();

    return Response.created(location)
        .entity(created)
        .build();
}
```

### 7.1 `Location` Harus Mengarah ke Resource yang Bisa Diambil

Buruk:

```http
Location: /cases/internal-db-row/998812
```

Kalau client tidak boleh access resource itu, `Location` misleading.

Lebih baik:

```http
Location: /cases/C-2026-000012
```

`Location` harus mengarah ke identifier publik/stabil, bukan internal implementation detail.

### 7.2 Create yang Menghasilkan Job

Jika `POST` tidak langsung membuat final resource, tetapi memulai proses async:

```http
HTTP/1.1 202 Accepted
Location: https://api.example.com/v1/jobs/J-1001
Retry-After: 5
```

Body:

```json
{
  "jobId": "J-1001",
  "status": "ACCEPTED",
  "links": {
    "self": "https://api.example.com/v1/jobs/J-1001",
    "result": "https://api.example.com/v1/cases/C-1001"
  }
}
```

Namun hati-hati: `result` belum tentu available. Bisa gunakan:

```json
{
  "links": {
    "self": ".../jobs/J-1001"
  }
}
```

Lalu `result` muncul setelah job selesai.

---

## 8. Pagination Links

Pagination adalah use case link paling umum.

Request:

```http
GET /cases?status=OPEN&assignedTo=me&page=3&size=20
```

Response body:

```json
{
  "data": [ ... ],
  "page": {
    "number": 3,
    "size": 20,
    "totalElements": 482,
    "totalPages": 25
  },
  "links": {
    "first": "https://api.example.com/v1/cases?status=OPEN&assignedTo=me&page=1&size=20",
    "prev": "https://api.example.com/v1/cases?status=OPEN&assignedTo=me&page=2&size=20",
    "self": "https://api.example.com/v1/cases?status=OPEN&assignedTo=me&page=3&size=20",
    "next": "https://api.example.com/v1/cases?status=OPEN&assignedTo=me&page=4&size=20",
    "last": "https://api.example.com/v1/cases?status=OPEN&assignedTo=me&page=25&size=20"
  }
}
```

### 8.1 Kesalahan Umum Pagination Link

#### Menghilangkan filter query

Buruk:

```text
/cases?page=4&size=20
```

Padahal request semula:

```text
/cases?status=OPEN&assignedTo=me&page=3&size=20
```

Akibatnya `next` bukan halaman berikutnya dari result set yang sama.

#### Mengubah sort tanpa sadar

```text
/cases?page=4&size=20
```

Jika sort default berubah, pagination tidak stabil.

#### Offset pagination untuk data yang berubah cepat

Offset pagination:

```text
?page=3&size=20
```

Masalah:

- item bisa muncul/hilang saat user berpindah halaman
- duplicate/missing record
- mahal untuk dataset besar

Cursor pagination:

```text
?cursor=eyJsYXN0SWQiOiJDLTEwMDEifQ&limit=20
```

Lebih stabil untuk feed besar, tetapi lebih kompleks.

### 8.2 Builder untuk Pagination Link

Contoh util sederhana:

```java
public final class PaginationLinks {

    private PaginationLinks() {}

    public static URI page(UriInfo uriInfo, int page, int size) {
        UriBuilder builder = uriInfo.getRequestUriBuilder();

        builder.replaceQueryParam("page", page);
        builder.replaceQueryParam("size", size);

        return builder.build();
    }
}
```

Usage:

```java
URI next = PaginationLinks.page(uriInfo, currentPage + 1, size);
```

Kenapa `getRequestUriBuilder()`?

Karena ingin mempertahankan query existing:

```text
status=OPEN&assignedTo=me&sort=createdAt,desc
```

Kemudian hanya mengganti `page` dan `size`.

### 8.3 Cursor Pagination Link

```java
public static URI cursor(UriInfo uriInfo, String cursor, int limit) {
    return uriInfo.getRequestUriBuilder()
        .replaceQueryParam("cursor", cursor)
        .replaceQueryParam("limit", limit)
        .build();
}
```

Jangan expose cursor raw kalau mengandung internal info sensitif. Cursor idealnya:

- opaque
- signed atau encrypted jika perlu
- tidak bisa dimodifikasi client untuk bypass authorization
- punya expiry jika relevan

---

## 9. HATEOAS: Jangan Dogmatis, Tapi Pahami Gunanya

HATEOAS sering disalahpahami sebagai:

> semua response harus punya banyak link.

Lebih tepat:

> representasi resource dapat memberi tahu client action/link apa yang valid berikutnya.

Contoh case management:

```json
{
  "id": "C-1001",
  "status": "PENDING_REVIEW",
  "links": {
    "self": "/cases/C-1001",
    "approve": "/cases/C-1001/approval",
    "reject": "/cases/C-1001/rejection",
    "documents": "/cases/C-1001/documents"
  }
}
```

Ini berguna jika:

- action valid bergantung pada state
- user authorization mempengaruhi action
- workflow kompleks
- frontend/partner tidak ingin hardcode seluruh transition

Namun tidak semua API perlu full hypermedia.

### 9.1 Hypermedia Cocok Untuk

```text
workflow/case management
approval systems
regulatory process lifecycle
long-running operation
document lifecycle
state machine API
public API yang ingin loosely coupled
```

### 9.2 Hypermedia Kurang Cocok Untuk

```text
simple CRUD internal API
high-performance low-level service-to-service API
client yang sudah strongly coupled ke API schema
batch endpoint yang tidak berbasis navigation
```

### 9.3 Pragmatic Rule

Gunakan link ketika link itu mengurangi coupling atau ambiguity.

Jangan gunakan link hanya agar API terlihat RESTful.

---

## 10. Link Relation: `self`, `next`, `prev`, dan Rel Custom

Link sebaiknya punya relation type (`rel`).

Common rel:

```text
self
next
prev
first
last
related
collection
item
up
edit
canonical
```

Custom rel bisa digunakan:

```text
approve
reject
submit
cancel
documents
audit-trail
correspondence
```

Namun custom rel harus stabil dan terdokumentasi.

Buruk:

```json
"links": {
  "doSomething": "...",
  "button1": "...",
  "goNext": "..."
}
```

Lebih baik:

```json
"links": {
  "submit": ".../submission",
  "withdraw": ".../withdrawal",
  "documents": ".../documents"
}
```

Dalam regulatory/case system, rel bisa menjadi bagian dari evidence/control surface:

```text
rel = allowed action under current state and actor permissions
```

Artinya link generation tidak boleh hanya berdasarkan state, tetapi juga authorization.

---

## 11. Link Generation di Balik Reverse Proxy dan API Gateway

Ini bagian paling sering menyebabkan production bug.

### 11.1 Problem

Client memanggil:

```text
https://api.example.com/aceas/v1/cases
```

Gateway meneruskan ke service:

```text
http://case-service.aceas.svc.cluster.local:8080/cases
```

Backend membuat `Location`:

```text
http://case-service.aceas.svc.cluster.local:8080/cases/C-1001
```

Client external tidak bisa membuka URI itu. Lebih buruk lagi, URI membocorkan internal hostname.

### 11.2 Header Forwarding

Proxy biasanya mengirim header seperti:

```http
X-Forwarded-Proto: https
X-Forwarded-Host: api.example.com
X-Forwarded-Port: 443
X-Forwarded-Prefix: /aceas/v1
Forwarded: proto=https;host=api.example.com
```

Namun:

- tidak semua container otomatis memproses header itu
- format header bisa berbeda
- header bisa dipalsukan jika datang langsung dari client
- trust boundary harus jelas

### 11.3 Jangan Percaya Forwarded Header dari Internet Langsung

Jika service bisa diakses langsung oleh client, client bisa mengirim:

```http
X-Forwarded-Host: attacker.example.com
```

Lalu backend membuat link:

```text
https://attacker.example.com/cases/C-1001
```

Ini bisa menjadi open redirect, phishing vector, atau poisoning link di email/audit.

Rule:

```text
Forwarded/X-Forwarded-* hanya boleh dipercaya jika request datang dari trusted proxy layer.
```

Di Kubernetes/enterprise deployment, biasanya:

- service tidak exposed langsung
- ingress/gateway menghapus incoming forwarded headers dari client
- gateway menulis forwarded headers baru
- backend/container dikonfigurasi untuk trust proxy tertentu

### 11.4 Public Base URI Config Pattern

Untuk API enterprise yang harus stabil, sering lebih aman menggunakan konfigurasi eksplisit:

```text
api.public-base-uri=https://api.example.com/aceas/v1
```

Lalu link builder memakai base itu, bukan `UriInfo.getBaseUri()` mentah.

Contoh:

```java
public final class PublicUriFactory {

    private final URI publicBaseUri;

    public PublicUriFactory(URI publicBaseUri) {
        this.publicBaseUri = publicBaseUri;
    }

    public UriBuilder baseBuilder() {
        return UriBuilder.fromUri(publicBaseUri);
    }

    public URI caseUri(String caseId) {
        return baseBuilder()
            .path("cases")
            .path("{id}")
            .resolveTemplate("id", caseId)
            .build();
    }
}
```

Kelebihan:

- deterministic
- tidak tergantung header forwarding
- aman untuk email/callback/external integration
- bisa berbeda per environment

Kekurangan:

- perlu config per environment
- multi-tenant domain lebih kompleks
- tidak otomatis mengikuti request host

### 11.5 Request-Aware Public URI Pattern

Untuk multi-tenant atau multi-domain:

```text
tenant-a.api.example.com
tenant-b.api.example.com
```

Kita mungkin perlu request-aware public base.

Tetapi tetap validasi host:

```java
public URI resolvePublicBase(UriInfo uriInfo, HttpHeaders headers) {
    String host = headers.getHeaderString("X-Forwarded-Host");

    if (!allowedHosts.contains(host)) {
        throw new BadRequestException("Invalid forwarded host");
    }

    String proto = headers.getHeaderString("X-Forwarded-Proto");
    if (!"https".equals(proto)) {
        proto = "https";
    }

    return UriBuilder.newInstance()
        .scheme(proto)
        .host(host)
        .path("/aceas/v1")
        .build();
}
```

Namun ini harus diletakkan di boundary yang jelas dan dites.

---

## 12. API Gateway Path Rewrite Problem

Gateway public path:

```text
/aceas/v1/cases
```

Backend path:

```text
/cases
```

Jika backend memakai:

```java
uriInfo.getBaseUriBuilder().path(CaseResource.class)
```

Mungkin hasilnya:

```text
http://case-service:8080/cases/C-1001
```

Bukan:

```text
https://api.example.com/aceas/v1/cases/C-1001
```

Solusi:

1. Configure container/gateway forwarded prefix support jika tersedia dan aman.
2. Gunakan public base URI config.
3. Buat `PublicUriFactory` terpusat.
4. Jangan hardcode prefix di tiap resource.

Buruk:

```java
URI.create("https://api.example.com/aceas/v1/cases/" + id)
```

Lebih baik:

```java
publicUriFactory.caseUri(id)
```

---

## 13. Link Factory sebagai Boundary Arsitektur

Untuk aplikasi kecil, membangun URI langsung di resource method masih masuk akal.

Untuk aplikasi besar, gunakan dedicated link factory.

```java
public interface CaseLinks {
    URI self(String caseId);
    URI documents(String caseId);
    URI appeal(String caseId, String appealId);
    URI auditTrail(String caseId);
}
```

Implementasi:

```java
public final class DefaultCaseLinks implements CaseLinks {

    private final URI publicBaseUri;

    public DefaultCaseLinks(URI publicBaseUri) {
        this.publicBaseUri = publicBaseUri;
    }

    @Override
    public URI self(String caseId) {
        return UriBuilder.fromUri(publicBaseUri)
            .path("cases")
            .path("{caseId}")
            .resolveTemplate("caseId", caseId)
            .build();
    }

    @Override
    public URI documents(String caseId) {
        return UriBuilder.fromUri(publicBaseUri)
            .path("cases")
            .path("{caseId}")
            .path("documents")
            .resolveTemplate("caseId", caseId)
            .build();
    }

    @Override
    public URI appeal(String caseId, String appealId) {
        return UriBuilder.fromUri(publicBaseUri)
            .path("cases")
            .path("{caseId}")
            .path("appeals")
            .path("{appealId}")
            .resolveTemplate("caseId", caseId)
            .resolveTemplate("appealId", appealId)
            .build();
    }

    @Override
    public URI auditTrail(String caseId) {
        return UriBuilder.fromUri(publicBaseUri)
            .path("cases")
            .path("{caseId}")
            .path("audit-trail")
            .resolveTemplate("caseId", caseId)
            .build();
    }
}
```

Benefit:

- link rules terpusat
- testable tanpa container
- tidak tersebar string path
- cocok untuk email/correspondence/audit
- bisa support public/internal base URI berbeda
- bisa version-aware

---

## 14. Resource Link vs UI Link

Jangan campur API resource link dengan frontend route link.

API link:

```text
https://api.example.com/aceas/v1/cases/C-1001
```

UI link:

```text
https://portal.example.com/cases/C-1001/overview
```

Keduanya berbeda kontrak.

Dalam enterprise system, email ke user biasanya perlu UI link, bukan API link.

Maka buat factory terpisah:

```java
public interface ApiLinks {
    URI caseResource(String caseId);
}

public interface PortalLinks {
    URI caseOverview(String caseId);
    URI caseTask(String caseId, String taskId);
}
```

Jangan melakukan ini di service domain:

```java
String url = "https://portal.example.com/cases/" + caseId;
```

Karena domain service menjadi tahu deployment/UI routing.

Lebih baik application layer/integration layer yang menyusun link.

---

## 15. Link dan Authorization

Dalam workflow system, link sering merepresentasikan action.

Contoh:

```json
{
  "id": "C-1001",
  "status": "PENDING_APPROVAL",
  "links": {
    "self": ".../cases/C-1001",
    "approve": ".../cases/C-1001/approval",
    "reject": ".../cases/C-1001/rejection"
  }
}
```

Pertanyaan penting:

> Apakah semua user boleh melihat link `approve`?

Jika tidak, link generation harus mempertimbangkan authorization.

```java
public CaseRepresentation toRepresentation(Case c, Actor actor) {
    Map<String, URI> links = new LinkedHashMap<>();
    links.put("self", linksFactory.self(c.id()));
    links.put("documents", linksFactory.documents(c.id()));

    if (authorization.canApprove(actor, c)) {
        links.put("approve", linksFactory.approve(c.id()));
    }

    if (authorization.canReject(actor, c)) {
        links.put("reject", linksFactory.reject(c.id()));
    }

    return new CaseRepresentation(c.id(), c.status(), links);
}
```

Tetapi jangan salah kaprah:

```text
Menyembunyikan link bukan authorization.
```

Endpoint tetap harus melakukan authorization saat dipanggil.

Link filtering hanya meningkatkan UX dan mengurangi invalid action discovery, bukan security boundary utama.

---

## 16. Link dan State Machine

Untuk case/workflow API, link yang baik bisa menjadi proyeksi state machine.

State:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED/REJECTED
```

Representation:

```json
{
  "id": "C-1001",
  "status": "DRAFT",
  "links": {
    "self": ".../cases/C-1001",
    "submit": ".../cases/C-1001/submission",
    "edit": ".../cases/C-1001"
  }
}
```

Setelah submitted:

```json
{
  "id": "C-1001",
  "status": "SUBMITTED",
  "links": {
    "self": ".../cases/C-1001",
    "withdraw": ".../cases/C-1001/withdrawal"
  }
}
```

Untuk regulatory defensibility, ini membantu karena API tidak hanya memberi data, tetapi juga mencerminkan action yang valid saat itu.

Namun desain tetap harus hati-hati:

- link tidak boleh menggantikan validasi state transition
- link tidak boleh menggantikan permission check
- link generation harus konsisten dengan command handler
- test harus memastikan link dan transition policy tidak divergen

Pattern yang baik:

```text
same policy object used by:
  - command validation
  - link generation
  - UI action availability
```

---

## 17. URI Building untuk Nested Resource

Contoh nested resource:

```text
/cases/{caseId}/documents/{documentId}
/cases/{caseId}/appeals/{appealId}
/cases/{caseId}/correspondences/{correspondenceId}
```

Builder:

```java
public URI document(String caseId, String documentId) {
    return UriBuilder.fromUri(publicBaseUri)
        .path("cases")
        .path("{caseId}")
        .path("documents")
        .path("{documentId}")
        .resolveTemplate("caseId", caseId)
        .resolveTemplate("documentId", documentId)
        .build();
}
```

### 17.1 Jangan Over-nesting

Nested path bagus jika ownership/containment jelas.

Bagus:

```text
/cases/{caseId}/documents/{documentId}
```

Terlalu dalam:

```text
/agencies/{agencyId}/departments/{departmentId}/officers/{officerId}/cases/{caseId}/documents/{documentId}/versions/{versionId}
```

Masalah:

- URL sulit dipakai
- authorization makin kompleks
- path param banyak
- link builder rawan salah
- resource identity terlalu tergantung traversal path

Kadang lebih baik:

```text
/documents/{documentId}
/cases/{caseId}/documents
```

Dengan authorization memastikan document memang milik case/actor yang tepat.

---

## 18. URI Encoding dan Template Trap

Jangan menggabungkan path dengan value raw.

Misal ID:

```text
CASE/2026/001
```

Jika string concatenation:

```java
URI.create("/cases/" + id)
```

Hasil:

```text
/cases/CASE/2026/001
```

Itu berubah menjadi beberapa segment.

Dengan template:

```java
UriBuilder.fromPath("/cases/{id}")
    .resolveTemplate("id", id)
    .build();
```

Builder dapat melakukan encoding sesuai konteks.

Namun penting: jika ID publik berpotensi mengandung slash, lebih baik pertimbangkan desain ID.

Rekomendasi:

```text
Public resource ID sebaiknya URL-safe.
```

Misal:

```text
C-2026-000001
DOC-2026-000999
```

Bukan:

```text
CASE/2026/000001
```

---

## 19. Matrix Parameter: Ada, Tapi Gunakan Hati-hati

Jakarta REST mendukung matrix parameter:

```text
/cases;status=OPEN;priority=HIGH/assigned-to/me
```

Injection:

```java
@MatrixParam("status") String status
```

Namun dalam banyak production stack, matrix param sering bermasalah karena:

- proxy/gateway mungkin menormalisasi atau menolak semicolon
- security filter bisa menganggapnya suspicious
- observability/search log tidak familiar
- client umum jarang menggunakannya

Untuk API enterprise modern, query parameter biasanya lebih pragmatis:

```text
/cases?status=OPEN&priority=HIGH
```

Gunakan matrix param hanya jika ada alasan kuat dan semua layer mendukung.

---

## 20. Base URI Strategy: Tiga Pilihan

### 20.1 Request-derived Base URI

```java
uriInfo.getBaseUriBuilder()
```

Cocok jika:

- aplikasi tidak di balik path rewrite rumit
- proxy/container correctly configured
- link hanya untuk caller request saat ini
- security terhadap forwarded header sudah benar

Risiko:

- salah host/scheme/prefix di balik gateway
- header spoofing jika trust boundary buruk

### 20.2 Configured Public Base URI

```text
api.public-base-uri=https://api.example.com/aceas/v1
```

Cocok jika:

- public API domain stabil
- email/callback butuh URL absolut
- deployment gateway path known
- ingin deterministic behavior

Risiko:

- perlu config benar per environment
- multi-tenant butuh tambahan logic

### 20.3 Hybrid Base URI

```text
configured allowed domains + request-derived tenant/domain
```

Cocok jika:

- multi-tenant
- white-label domain
- regional domain
- request host memang bagian dari contract

Risiko:

- validasi lebih kompleks
- perlu allowlist
- forwarded header trust wajib rapi

---

## 21. Implementation Pattern: `LinkContext`

Untuk menghindari passing terlalu banyak object, kita bisa membuat context eksplisit.

```java
public record LinkContext(
    URI publicBaseUri,
    Locale locale,
    String tenantId
) {}
```

Factory:

```java
public final class LinkContextFactory {

    private final URI defaultPublicBaseUri;

    public LinkContextFactory(URI defaultPublicBaseUri) {
        this.defaultPublicBaseUri = defaultPublicBaseUri;
    }

    public LinkContext fromRequest(UriInfo uriInfo, HttpHeaders headers) {
        return new LinkContext(
            defaultPublicBaseUri,
            resolveLocale(headers),
            resolveTenant(headers)
        );
    }

    private Locale resolveLocale(HttpHeaders headers) {
        return headers.getAcceptableLanguages().isEmpty()
            ? Locale.ENGLISH
            : headers.getAcceptableLanguages().get(0);
    }

    private String resolveTenant(HttpHeaders headers) {
        return headers.getHeaderString("X-Tenant-Id");
    }
}
```

Link factory:

```java
public final class CaseLinkFactory {

    public URI self(LinkContext ctx, String caseId) {
        return UriBuilder.fromUri(ctx.publicBaseUri())
            .path("cases")
            .path("{caseId}")
            .resolveTemplate("caseId", caseId)
            .build();
    }
}
```

Resource:

```java
@GET
@Path("/{id}")
public Response get(
    @PathParam("id") String id,
    @Context UriInfo uriInfo,
    @Context HttpHeaders headers
) {
    Case c = service.get(id);
    LinkContext linkContext = linkContextFactory.fromRequest(uriInfo, headers);
    CaseRepresentation rep = assembler.toRepresentation(c, linkContext);
    return Response.ok(rep).build();
}
```

Benefit:

- link generation eksplisit
- tidak menyimpan `UriInfo`
- test mudah
- bisa extend tenant/locale/version

---

## 22. Representation Assembler Pattern

Jangan biarkan resource method terlalu gemuk.

Buruk:

```java
@GET
@Path("/{id}")
public Response get(@PathParam("id") String id, @Context UriInfo uriInfo) {
    Case c = service.get(id);
    Map<String, String> links = new HashMap<>();
    links.put("self", uriInfo.getBaseUriBuilder().path("cases").path(id).build().toString());
    links.put("documents", uriInfo.getBaseUriBuilder().path("cases").path(id).path("documents").build().toString());
    return Response.ok(new CaseDto(..., links)).build();
}
```

Lebih baik:

```java
public final class CaseRepresentationAssembler {

    private final CaseLinkFactory links;
    private final CaseAuthorization authorization;

    public CaseRepresentationAssembler(CaseLinkFactory links, CaseAuthorization authorization) {
        this.links = links;
        this.authorization = authorization;
    }

    public CaseRepresentation toRepresentation(Case c, Actor actor, LinkContext ctx) {
        Map<String, URI> linkMap = new LinkedHashMap<>();
        linkMap.put("self", links.self(ctx, c.id()));
        linkMap.put("documents", links.documents(ctx, c.id()));

        if (authorization.canSubmit(actor, c)) {
            linkMap.put("submit", links.submit(ctx, c.id()));
        }

        return new CaseRepresentation(
            c.id(),
            c.status(),
            linkMap
        );
    }
}
```

Resource menjadi boundary tipis:

```java
@GET
@Path("/{id}")
public Response get(
    @PathParam("id") String id,
    @Context UriInfo uriInfo,
    @Context HttpHeaders headers,
    @Context SecurityContext securityContext
) {
    Actor actor = actorResolver.from(securityContext);
    Case c = service.getVisibleCase(id, actor);
    LinkContext ctx = linkContextFactory.fromRequest(uriInfo, headers);

    return Response.ok(assembler.toRepresentation(c, actor, ctx)).build();
}
```

---

## 23. Hypermedia Format Pilihan

Tidak ada satu format wajib.

### 23.1 Simple Links Object

```json
{
  "id": "C-1001",
  "links": {
    "self": "https://api.example.com/cases/C-1001",
    "documents": "https://api.example.com/cases/C-1001/documents"
  }
}
```

Cocok untuk internal/enterprise API.

### 23.2 Array of Link Objects

```json
{
  "id": "C-1001",
  "links": [
    { "rel": "self", "href": "https://api.example.com/cases/C-1001" },
    { "rel": "documents", "href": "https://api.example.com/cases/C-1001/documents" }
  ]
}
```

Cocok jika butuh metadata per link:

```json
{
  "rel": "download",
  "href": "...",
  "method": "GET",
  "type": "application/pdf"
}
```

### 23.3 HAL-like

```json
{
  "id": "C-1001",
  "_links": {
    "self": { "href": "https://api.example.com/cases/C-1001" },
    "documents": { "href": "https://api.example.com/cases/C-1001/documents" }
  }
}
```

Cocok jika ekosistem client mendukung HAL.

### 23.4 JSON:API-like

```json
{
  "data": {
    "type": "cases",
    "id": "C-1001",
    "links": {
      "self": "https://api.example.com/cases/C-1001"
    }
  }
}
```

Cocok jika organisasi memakai JSON:API style.

Rekomendasi pragmatis:

```text
Jangan pilih format hypermedia berat kecuali ada manfaat nyata.
Untuk enterprise internal API, simple links object sering cukup.
```

---

## 24. Link dan HTTP Method

Link sendiri biasanya hanya URI + rel. Tetapi untuk action link, client juga perlu tahu method.

Contoh:

```json
{
  "rel": "submit",
  "href": "https://api.example.com/cases/C-1001/submission",
  "method": "POST"
}
```

Ini berguna untuk frontend dynamic action.

Namun berhati-hati:

- jangan menjadikan API seperti RPC instruction dump
- method/action tetap harus didokumentasikan
- body schema tetap perlu contract

Untuk action state machine, representation bisa:

```json
{
  "actions": [
    {
      "rel": "submit",
      "href": "https://api.example.com/cases/C-1001/submission",
      "method": "POST",
      "requiresConfirmation": true
    }
  ]
}
```

Ini cocok untuk UI orchestration, tetapi bisa overkill untuk service-to-service.

---

## 25. Avoiding Internal Topology Leak

Jangan expose:

```text
http://localhost:8080
http://case-service:8080
http://10.0.14.31:8080
http://pod-name.namespace.svc.cluster.local
```

Tempat yang sering tidak sengaja leak:

- `Location` header
- `Link` header
- response body `links`
- error response `instance`
- email notification
- audit export
- generated PDF with link
- callback registration response
- OpenAPI server URL

Mitigasi:

- central public URI factory
- environment config validation saat startup
- integration test behind proxy simulation
- scan response headers/body di API tests
- jangan pakai `InetAddress.getLocalHost()` untuk link
- jangan pakai request server name secara buta

---

## 26. Testing Link Generation

### 26.1 Unit Test Link Factory

```java
@Test
void buildsCaseSelfLink() {
    CaseLinkFactory factory = new CaseLinkFactory();
    LinkContext ctx = new LinkContext(
        URI.create("https://api.example.com/aceas/v1"),
        Locale.ENGLISH,
        "tenant-a"
    );

    URI uri = factory.self(ctx, "C-1001");

    assertEquals("https://api.example.com/aceas/v1/cases/C-1001", uri.toString());
}
```

### 26.2 Encoding Test

```java
@Test
void encodesPathTemplateValue() {
    URI uri = UriBuilder.fromUri("https://api.example.com/v1")
        .path("cases")
        .path("{id}")
        .resolveTemplate("id", "C 1001")
        .build();

    assertEquals("https://api.example.com/v1/cases/C%201001", uri.toString());
}
```

### 26.3 Pagination Query Preservation Test

```java
@Test
void preservesFiltersWhenBuildingNextPage() {
    // Use Jersey Test Framework or mock UriInfo carefully.
    // Assert status/sort/filter remain while page changes.
}
```

### 26.4 Proxy Simulation Test

Test bahwa response tidak mengandung internal host:

```text
Given request through simulated gateway
When POST /cases
Then Location starts with https://api.example.com/aceas/v1
And Location does not contain localhost/internal svc host
```

### 26.5 Contract Test

Untuk public API:

```text
- Location exists for 201
- Location points to retrievable resource
- Link rel names are stable
- Pagination links preserve filter/sort
- No internal hostname appears in response
- Deprecated endpoint includes deprecation/sunset links if applicable
```

---

## 27. Java 8–25 Considerations

### Java 8

- Tidak ada `record`, gunakan POJO DTO untuk link representation.
- `URI`, `UriBuilder`, `UriInfo` tetap relevan.
- Banyak legacy Jersey 2.x menggunakan `javax.ws.rs`.
- Hati-hati dependency conflict jika mulai mencampur `jakarta`.

### Java 11

- TLS/runtime modern lebih baik.
- Masih banyak enterprise Jersey 2.x/3.x berjalan di Java 11.
- Bisa mulai memperbaiki link factory/test design tanpa memerlukan fitur bahasa baru.

### Java 17

- Baseline penting untuk Jakarta EE modern.
- Bisa memakai `record` untuk immutable link DTO jika framework JSON mendukung.

```java
public record LinkDto(String rel, URI href, String method) {}
```

### Java 21

- Virtual threads tidak langsung mengubah link generation.
- Namun context propagation makin penting jika link dibuat di async/virtual-thread task.
- Jangan menyimpan request-scoped `UriInfo` ke task asynchronous.

### Java 25

- Sama seperti Java 21 dari sisi konsep Jersey link generation.
- Fokus pada compatibility runtime/container/Jersey version.
- Gunakan immutable DTO dan explicit context agar aman di concurrency modern.

---

## 28. Jersey 2.x vs 3.x vs 4.x Considerations

### Jersey 2.x

Namespace:

```java
javax.ws.rs.core.UriInfo
javax.ws.rs.core.UriBuilder
javax.ws.rs.core.Link
```

Cocok dengan Java EE/JAX-RS era lama.

### Jersey 3.x/4.x

Namespace:

```java
jakarta.ws.rs.core.UriInfo
jakarta.ws.rs.core.UriBuilder
jakarta.ws.rs.core.Link
```

Migrasi utama:

```text
javax.ws.rs.* -> jakarta.ws.rs.*
```

Konsep link generation tidak berubah drastis, tetapi dependency alignment berubah besar.

Checklist migrasi:

- update imports
- update Jersey modules
- update JSON provider namespace
- update servlet namespace
- update validation namespace
- run link contract tests
- verify generated absolute URI behind gateway

---

## 29. Anti-Patterns

### 29.1 String Concatenation Everywhere

```java
String url = base + "/cases/" + id;
```

Masalah:

- encoding salah
- slash ganda
- prefix hilang
- refactoring sulit

### 29.2 `localhost` in Location

```http
Location: http://localhost:8080/cases/C-1001
```

Biasanya tanda app tidak aware terhadap public base URI.

### 29.3 Link Menggunakan Internal ID

```text
/cases/982377192
```

Jika `982377192` adalah DB surrogate key internal, bisa berbahaya atau tidak stabil.

### 29.4 Link Action Tidak Sesuai Authorization

Menampilkan:

```json
"approve": ".../approval"
```

ke user yang tidak boleh approve.

Ini bukan bug keamanan utama jika endpoint tetap aman, tetapi UX dan contract buruk.

### 29.5 Link Generation Mengulang Business Rules

```java
if (case.status().equals("DRAFT") && user.role().equals("MAKER")) {
    links.put("submit", ...);
}
```

Kalau command handler punya rule berbeda, akan drift.

Lebih baik pakai policy yang sama.

### 29.6 URI Builder di Domain Entity

Buruk:

```java
public class Case {
    public String selfUrl() { ... }
}
```

Domain entity tidak boleh tahu HTTP deployment.

### 29.7 Percaya `X-Forwarded-Host` Tanpa Trust Boundary

Bisa menyebabkan malicious generated link.

### 29.8 Pagination Link Tidak Stable

`next` link tidak mempertahankan sort/filter.

### 29.9 Hypermedia Overengineering

Menambahkan `_links`, `_embedded`, action schema, dynamic forms, tetapi client tidak menggunakannya.

Overengineering membuat API lebih berat tanpa manfaat.

---

## 30. Production Checklist

### URI correctness

- [ ] `Location` mengarah ke public resource URI.
- [ ] Tidak ada `localhost`, pod hostname, service DNS, atau private IP di response.
- [ ] Base URI benar di balik gateway/proxy.
- [ ] Path prefix gateway dipertahankan.
- [ ] Query parameter dipertahankan untuk pagination/filter.
- [ ] URI value di-encode dengan benar.

### Security

- [ ] Forwarded headers hanya dipercaya dari trusted proxy.
- [ ] Host allowlist diterapkan jika memakai request-derived host.
- [ ] Link tidak mengekspos internal ID/topology.
- [ ] Action links difilter berdasarkan authorization jika digunakan untuk UI.
- [ ] Endpoint tetap authorize walau link disembunyikan.

### Compatibility

- [ ] Link rel names stabil.
- [ ] Deprecation lifecycle terdokumentasi.
- [ ] Versioned base URI jelas.
- [ ] Link format tidak berubah tanpa compatibility plan.

### Testing

- [ ] Unit test link factory.
- [ ] Integration test behind simulated proxy/gateway.
- [ ] Contract test untuk `Location` dan pagination links.
- [ ] Negative test untuk malicious forwarded host.
- [ ] Regression test untuk path rewrite.

### Architecture

- [ ] Link factory terpusat untuk API besar.
- [ ] API links dan UI links dipisah.
- [ ] Domain entity tidak membangun URL.
- [ ] Link generation memakai policy yang sama dengan command authorization/state transition.

---

## 31. Mini Case Study: Case Management API

### Requirement

Ketika user membuat case:

```http
POST /cases
```

API harus mengembalikan:

- `201 Created`
- `Location` ke case baru
- body dengan `self`, `documents`, dan action `submit` jika user boleh submit
- tidak boleh expose internal host
- harus bekerja di balik gateway `/aceas/v1`

### Design

Config:

```text
api.public-base-uri=https://api.example.gov.sg/aceas/v1
portal.public-base-uri=https://portal.example.gov.sg/aceas
```

Factory:

```java
public final class CaseLinkFactory {

    private final URI apiBase;

    public CaseLinkFactory(URI apiBase) {
        this.apiBase = apiBase;
    }

    public URI self(String caseId) {
        return UriBuilder.fromUri(apiBase)
            .path("cases")
            .path("{caseId}")
            .resolveTemplate("caseId", caseId)
            .build();
    }

    public URI documents(String caseId) {
        return UriBuilder.fromUri(apiBase)
            .path("cases")
            .path("{caseId}")
            .path("documents")
            .resolveTemplate("caseId", caseId)
            .build();
    }

    public URI submit(String caseId) {
        return UriBuilder.fromUri(apiBase)
            .path("cases")
            .path("{caseId}")
            .path("submission")
            .resolveTemplate("caseId", caseId)
            .build();
    }
}
```

Representation:

```java
public record CaseResponse(
    String id,
    String status,
    Map<String, URI> links
) {}
```

Assembler:

```java
public final class CaseAssembler {

    private final CaseLinkFactory links;
    private final CaseAuthorization authorization;

    public CaseAssembler(CaseLinkFactory links, CaseAuthorization authorization) {
        this.links = links;
        this.authorization = authorization;
    }

    public CaseResponse created(Case c, Actor actor) {
        Map<String, URI> linkMap = new LinkedHashMap<>();
        linkMap.put("self", links.self(c.id()));
        linkMap.put("documents", links.documents(c.id()));

        if (authorization.canSubmit(actor, c)) {
            linkMap.put("submit", links.submit(c.id()));
        }

        return new CaseResponse(c.id(), c.status().name(), linkMap);
    }
}
```

Resource:

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final CaseService service;
    private final CaseAssembler assembler;
    private final CaseLinkFactory links;
    private final ActorResolver actorResolver;

    public CaseResource(
        CaseService service,
        CaseAssembler assembler,
        CaseLinkFactory links,
        ActorResolver actorResolver
    ) {
        this.service = service;
        this.assembler = assembler;
        this.links = links;
        this.actorResolver = actorResolver;
    }

    @POST
    public Response create(
        CreateCaseRequest request,
        @Context SecurityContext securityContext
    ) {
        Actor actor = actorResolver.from(securityContext);
        Case created = service.create(request, actor);
        CaseResponse response = assembler.created(created, actor);

        return Response.created(links.self(created.id()))
            .entity(response)
            .build();
    }

    @GET
    @Path("/{caseId}")
    public Response get(@PathParam("caseId") String caseId) {
        ...
    }
}
```

Result:

```http
HTTP/1.1 201 Created
Location: https://api.example.gov.sg/aceas/v1/cases/C-2026-000001
Content-Type: application/json
```

```json
{
  "id": "C-2026-000001",
  "status": "DRAFT",
  "links": {
    "self": "https://api.example.gov.sg/aceas/v1/cases/C-2026-000001",
    "documents": "https://api.example.gov.sg/aceas/v1/cases/C-2026-000001/documents",
    "submit": "https://api.example.gov.sg/aceas/v1/cases/C-2026-000001/submission"
  }
}
```

This is simple, deterministic, testable, and proxy-safe.

---

## 32. Decision Framework

Saat mendesain link di Jersey API, tanyakan:

### Apakah client butuh link?

Jika tidak, jangan tambah hypermedia hanya karena terlihat RESTful.

### Apakah link harus absolute?

Gunakan absolute untuk:

- `Location` ke external client
- email/callback
- cross-domain integration
- public/partner API

Relative bisa cukup untuk:

- internal API
- frontend yang sudah tahu base
- body links ringan

### Dari mana base URI berasal?

```text
request-derived   -> praktis tapi proxy-sensitive
configured public -> deterministic dan aman
hybrid            -> multi-tenant tapi kompleks
```

### Apakah link action state/authorization aware?

Jika link merepresentasikan action, harus sinkron dengan policy.

### Apakah link format stabil?

Jika client mengandalkan link, perubahan link adalah breaking change.

---

## 33. Latihan

### Latihan 1 — Location Header

Buat endpoint `POST /applications` yang mengembalikan `201 Created` dan `Location` public URI.

Constraint:

- public base URI dari config
- ID harus di-encode aman
- response body punya `self` link

### Latihan 2 — Pagination Link

Buat utility yang menerima `UriInfo` dan menghasilkan `first`, `prev`, `self`, `next`, `last`.

Constraint:

- pertahankan query filter existing
- replace hanya `page` dan `size`
- tidak menghasilkan `prev` jika page pertama
- tidak menghasilkan `next` jika page terakhir

### Latihan 3 — Gateway Prefix

Simulasikan backend menerima path `/cases`, tetapi public API ada di `/aceas/v1/cases`.

Buktikan dengan test bahwa generated `Location` memakai `/aceas/v1`.

### Latihan 4 — Authorization-Aware Action Link

Case status `DRAFT` boleh `submit` hanya untuk owner. Buat assembler yang hanya menampilkan `submit` link jika actor adalah owner dan case masih `DRAFT`.

Pastikan endpoint `POST /cases/{id}/submission` tetap melakukan authorization ulang.

### Latihan 5 — Host Header Attack

Buat test untuk request dengan:

```http
X-Forwarded-Host: attacker.example.com
```

Pastikan API tidak menghasilkan link ke attacker host.

---

## 34. Ringkasan Part 21

Di part ini kita mempelajari bahwa:

- URI dan link adalah bagian dari kontrak API.
- `UriInfo` berguna, tetapi merepresentasikan request sebagaimana dilihat runtime/container.
- `UriBuilder` harus dipakai untuk menghindari string concatenation dan encoding bug.
- `Link` dapat dipakai untuk HTTP link header, tetapi body links sering lebih praktis untuk frontend.
- `Location` harus mengarah ke resource publik yang bisa diakses caller.
- Pagination links harus mempertahankan filter dan sort.
- HATEOAS berguna untuk workflow/state machine, tetapi tidak harus diterapkan secara dogmatis.
- Reverse proxy/API gateway dapat membuat generated URI salah jika public base URI tidak dikelola.
- Forwarded headers hanya boleh dipercaya dari trusted proxy.
- Untuk API besar, link generation sebaiknya dipusatkan di link factory/assembler.
- API links dan UI links harus dipisahkan.
- Link action harus sinkron dengan authorization dan state transition policy.
- Test link generation sama pentingnya dengan test response body.

Mental model utama:

```text
Jangan bangun URL sebagai string.
Bangun URI sebagai kontrak runtime yang sadar base URI, encoding, deployment, versioning, authorization, dan resource identity.
```

---

## 35. Referensi

- Jakarta RESTful Web Services API — `UriInfo`, `UriBuilder`, `Link`, `Response`
- Jakarta RESTful Web Services Specification 4.0
- Eclipse Jersey User Guide
- RFC 9110 — HTTP Semantics
- RFC 8288 — Web Linking
- MDN — X-Forwarded-For and proxy header considerations

---

## 36. Status Seri

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
Part 14 — selesai
Part 15 — selesai
Part 16 — selesai
Part 17 — selesai
Part 18 — selesai
Part 19 — selesai
Part 20 — selesai
Part 21 — selesai
Part 22 — berikutnya
...
Part 32 — target akhir / capstone
```

Seri belum selesai. Berikutnya:

> Part 22 — Observability in Jersey: Logs, Metrics, Traces, Correlation, and Profiling

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 20 — API Versioning and Compatibility with Jersey](./20-api-versioning-and-compatibility-with-jersey.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 22 — Observability in Jersey: Logs, Metrics, Traces, Correlation, and Profiling](./22-observability-in-jersey-logs-metrics-traces-correlation-profiling.md)

</div>