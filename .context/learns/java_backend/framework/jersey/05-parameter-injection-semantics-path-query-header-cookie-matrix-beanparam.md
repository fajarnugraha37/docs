# Part 5 — Parameter Injection Semantics: Path, Query, Header, Cookie, Matrix, BeanParam

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `05-parameter-injection-semantics-path-query-header-cookie-matrix-beanparam.md`  
Target: Java 8–25, Jersey 2.x/3.x/4.x, JAX-RS/Jakarta REST 2.x–4.x  
Status: Part 5 dari 32

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas bagaimana Jersey memahami resource class dan bagaimana request matching memilih resource method. Sekarang kita turun satu lapisan lebih detail: **apa yang terjadi setelah method terpilih dan Jersey harus mengisi parameter method / field / bean property dari request**.

Banyak developer menganggap parameter injection hanya sebagai shorthand:

```java
@GET
public Response search(@QueryParam("q") String q) {
    ...
}
```

Padahal di sistem production, parameter injection adalah **contract boundary**. Ia menentukan:

- apakah input dianggap wajib atau opsional,
- apakah nilai kosong sama dengan nilai tidak dikirim,
- apakah default value berarti business default atau transport default,
- apakah format input stabil lintas versi,
- apakah parsing error menjadi `400 Bad Request`,
- apakah query contract masih aman saat API berkembang,
- apakah resource method tetap terbaca setelah parameter bertambah,
- apakah tipe domain boleh langsung muncul di HTTP boundary,
- apakah validasi dilakukan di boundary atau domain layer.

Di level top-tier engineer, `@QueryParam`, `@PathParam`, `@HeaderParam`, `@CookieParam`, `@MatrixParam`, `@FormParam`, dan `@BeanParam` bukan sekadar annotation. Mereka adalah bagian dari **bahasa kontrak HTTP** yang harus didesain dengan intentionality.

---

## 1. Baseline Versi dan Namespace

Jersey mengikuti keluarga JAX-RS/Jakarta REST.

| Era | Namespace | Jersey umum | Java baseline konseptual |
|---|---|---:|---|
| Java EE / JAX-RS 2.x | `javax.ws.rs.*` | Jersey 2.x | Java 8 banyak ditemukan di legacy |
| Jakarta EE 9/10 | `jakarta.ws.rs.*` | Jersey 3.x | Java 11/17 tergantung stack |
| Jakarta EE 11 / Jakarta REST 4.0 | `jakarta.ws.rs.*` | Jersey 4.x | Jakarta REST 4.0 minimum Java SE 17 |

Contoh `javax` era Jersey 2:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.QueryParam;
```

Contoh `jakarta` era Jersey 3/4:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.QueryParam;
```

Secara konsep parameter injection-nya mirip, tetapi dependency dan namespace tidak boleh dicampur. Salah satu failure mode umum migrasi adalah classpath berisi campuran `javax.ws.rs-api` dan `jakarta.ws.rs-api`, lalu provider/filter/resource tidak dikenali runtime.

---

## 2. Mental Model: Parameter Injection sebagai Boundary Translator

Request HTTP datang dalam bentuk:

```text
GET /cases/CASE-2026-000123/tasks?status=OPEN&limit=50 HTTP/1.1
Host: api.example.gov
Accept: application/json
X-Correlation-Id: abc-123
Cookie: session=...
```

Resource method Java menginginkan bentuk:

```java
public Response listTasks(
        CaseId caseId,
        TaskStatus status,
        int limit,
        String correlationId) {
    ...
}
```

Parameter injection adalah mekanisme yang menjembatani dua dunia itu:

```text
HTTP request representation
        ↓
Jersey selected resource method
        ↓
parameter source lookup
        ↓
string extraction
        ↓
type conversion
        ↓
validation / defaulting / error handling
        ↓
Java method invocation
```

Ada beberapa prinsip penting:

1. **Parameter injection bukan domain validation penuh.**  
   Ia hanya mengubah input transport menjadi nilai Java awal.

2. **Parameter injection terjadi sebelum resource method body berjalan.**  
   Kalau parsing gagal, method tidak dipanggil.

3. **Nilai parameter mayoritas berasal dari string.**  
   Bahkan angka, boolean, enum, date, UUID, custom ID biasanya mulai dari string.

4. **Tipe parameter adalah bagian dari kontrak.**  
   Mengubah `String status` menjadi `TaskStatus status` bukan hanya refactor internal. Itu mengubah behavior parsing dan error.

5. **Absent, empty, blank, malformed, dan default adalah state berbeda.**  
   Banyak bug API berasal dari menyamakan semuanya.

---

## 3. Peta Annotation Parameter

| Annotation | Sumber HTTP | Cocok untuk | Risiko utama |
|---|---|---|---|
| `@PathParam` | URI template path | Identitas resource | parsing ID, encoded slash, regex mismatch |
| `@QueryParam` | query string | filter, sort, pagination, optional controls | contract bloat, ambiguous default |
| `@HeaderParam` | HTTP header | metadata request, correlation, auth-related metadata | spoofing, case/format mismatch |
| `@CookieParam` | cookie | browser session/state tertentu | coupling ke browser/session model |
| `@MatrixParam` | path segment parameter | segment-scoped metadata | jarang dipakai, proxy/tooling support lemah |
| `@FormParam` | `application/x-www-form-urlencoded` form body | legacy form submit, OAuth-like form requests | conflict dengan JSON body, body consumption |
| `@BeanParam` | aggregator dari param annotation lain | query object, command boundary object | hidden complexity, injection lifecycle |

Annotation ini dapat digunakan pada:

- resource method parameter,
- field resource class,
- bean property setter,
- field/property dalam `@BeanParam` object.

Namun, production guideline yang kuat:

> Untuk request-specific value, lebih aman gunakan method parameter atau `@BeanParam` method parameter daripada field injection pada singleton resource.

Alasannya: field injection request-scoped ke object yang lifecycle-nya panjang dapat menciptakan confusion thread-safety dan lifecycle, terutama bila resource class dibuat singleton oleh container/DI tertentu.

---

## 4. Injection Lifecycle: Kapan Nilai Diisi?

Secara konseptual:

```text
1. Jersey menemukan resource method yang cocok.
2. Jersey membangun daftar parameter yang dibutuhkan.
3. Untuk setiap parameter:
   a. tentukan source: path/query/header/cookie/matrix/form/context/entity
   b. ambil raw string value dari request
   c. jika absent, cek @DefaultValue
   d. konversi string ke tipe Java target
   e. jalankan validation jika Bean Validation aktif
4. Jika semua berhasil, resource method dipanggil.
5. Jika gagal, Jersey menghasilkan exception sebelum method body berjalan.
```

Contoh:

```java
@GET
@Path("/cases/{caseId}/tasks")
public Response listTasks(
        @PathParam("caseId") String caseId,
        @QueryParam("status") String status,
        @DefaultValue("50") @QueryParam("limit") int limit) {
    ...
}
```

Untuk request:

```text
GET /cases/CASE-1/tasks?limit=abc
```

`limit` gagal dikonversi ke `int`, sehingga method tidak dipanggil. Ini bukan error business layer; ini error transport-boundary parsing.

---

## 5. `@PathParam`: Identitas Resource, Bukan Filter

`@PathParam` mengambil nilai dari URI template.

```java
@Path("/cases/{caseId}")
public class CaseResource {

    @GET
    public Response getCase(@PathParam("caseId") String caseId) {
        ...
    }
}
```

Request:

```text
GET /cases/CASE-2026-000123
```

`caseId = "CASE-2026-000123"`.

### 5.1 Mental Model `@PathParam`

Path parameter idealnya merepresentasikan **identity**, bukan search criteria.

Baik:

```text
/cases/{caseId}
/users/{userId}
/documents/{documentId}
/applications/{applicationId}/attachments/{attachmentId}
```

Kurang baik:

```text
/cases/status/{status}
/cases/year/{year}/month/{month}/status/{status}
```

Kenapa? Karena status/year/month lebih mirip query/filter:

```text
/cases?status=OPEN&year=2026&month=06
```

Path yang terlalu banyak memuat filter akan membuat routing meledak dan versioning susah.

### 5.2 Typed Path Parameter

Contoh:

```java
@GET
@Path("/cases/{id}")
public Response getCase(@PathParam("id") UUID id) {
    ...
}
```

Ini membuat invalid UUID gagal sebelum resource method berjalan.

Trade-off:

| Pilihan | Kelebihan | Kekurangan |
|---|---|---|
| `String id` | fleksibel, error bisa dikontrol manual | parsing tersebar, contract kurang kuat |
| `UUID id` | contract kuat, parsing otomatis | error shape perlu mapper bagus |
| custom `CaseId id` | domain boundary kuat | perlu converter jelas |

Untuk enterprise API, saya biasanya merekomendasikan custom ID type untuk domain penting, tetapi hanya jika tim siap menyediakan `ParamConverter`, error mapping, test, dan dokumentasi.

### 5.3 Path Regex

```java
@GET
@Path("/cases/{caseId: CASE-[0-9]{4}-[0-9]{6}}")
public Response getCase(@PathParam("caseId") String caseId) {
    ...
}
```

Regex di path berguna untuk membatasi route matching. Namun jangan terlalu banyak memindahkan domain validation ke path regex. Regex yang terlalu kompleks membuat API sulit dibaca dan debugging 404 menjadi membingungkan.

Rule of thumb:

- format kasar boleh di path regex,
- validitas business tetap di service/domain layer,
- error format user-friendly lebih baik lewat validation/exception mapper daripada sekadar 404.

### 5.4 Encoded Path dan Slash Problem

URI path memiliki encoding. Nilai `a%2Fb` secara tekstual mengandung slash yang di-encode. Di banyak stack, encoded slash bisa diperlakukan berbeda oleh proxy, servlet container, atau security layer.

Jangan desain ID yang membutuhkan slash literal di path.

Buruk:

```text
/documents/{folder}/{fileName}
/documents/finance/2026/report.pdf
```

Jika file name bisa mengandung slash, gunakan ID opaque:

```text
/documents/{documentId}
```

atau query untuk path-like metadata:

```text
/documents?path=/finance/2026/report.pdf
```

Tetapi hati-hati dengan path traversal jika nilai tersebut dipakai ke filesystem.

---

## 6. `@QueryParam`: Filter, Pagination, Sorting, dan Optional Controls

`@QueryParam` mengambil nilai dari query string.

```java
@GET
@Path("/cases")
public Response searchCases(
        @QueryParam("status") String status,
        @QueryParam("q") String keyword,
        @DefaultValue("0") @QueryParam("offset") int offset,
        @DefaultValue("50") @QueryParam("limit") int limit) {
    ...
}
```

Request:

```text
GET /cases?status=OPEN&q=licence&offset=0&limit=50
```

### 6.1 Query Parameter sebagai Search Contract

Query parameter cocok untuk:

- filtering,
- searching,
- sorting,
- pagination,
- projection,
- optional behavior flag.

Contoh:

```text
GET /cases?status=OPEN&assignedTo=me&sort=-createdAt&limit=50
```

Namun query param yang terlalu banyak bisa menandakan API search sudah perlu object contract atau dedicated search endpoint.

Contoh sederhana masih wajar:

```text
GET /cases?status=OPEN&priority=HIGH
```

Contoh yang mulai kompleks:

```text
GET /cases?status=OPEN&status=PENDING_REVIEW&from=2026-01-01&to=2026-06-30&agency=CEA&assignedTeam=ENFORCEMENT&hasAppeal=true&hasOutstandingPayment=false&sort=-riskScore,createdAt&include=documents,latestAction,assignee
```

Untuk query kompleks, pertimbangkan:

```text
POST /case-searches
Content-Type: application/json
```

atau:

```text
POST /cases/search
```

Trade-off-nya dibahas lebih dalam di Part 20 dan Part 31.

### 6.2 Absent vs Empty vs Blank

Request berbeda:

```text
GET /cases
GET /cases?status=
GET /cases?status=   
GET /cases?status=OPEN
```

Secara business, ini bisa berarti:

| Request | Makna potensial |
|---|---|
| no `status` | tidak filter status |
| `status=` | filter status kosong? invalid? treat as absent? |
| `status=   ` | blank invalid? trim lalu absent? |
| `status=OPEN` | filter OPEN |

Jangan biarkan interpretasi ini tidak disengaja.

Rekomendasi:

- Untuk query opsional, gunakan `String` lalu normalize eksplisit, atau gunakan request object dengan validation.
- Treat blank sebagai invalid untuk field yang punya domain meaning.
- Treat absent sebagai “not supplied”.
- Jangan menyamakan absent dengan default business tanpa dokumentasi.

Contoh helper:

```java
static Optional<String> normalizeOptionalText(String raw) {
    if (raw == null) {
        return Optional.empty();
    }
    String trimmed = raw.trim();
    if (trimmed.isEmpty()) {
        return Optional.empty(); // atau throw BadRequestException sesuai kontrak
    }
    return Optional.of(trimmed);
}
```

Untuk API publik/regulatory, saya lebih suka blank invalid untuk parameter penting, agar client error cepat terlihat.

### 6.3 Primitive Trap

```java
@GET
public Response list(@QueryParam("limit") int limit) {
    ...
}
```

Jika `limit` tidak dikirim, primitive `int` tidak bisa merepresentasikan absent. Runtime bisa memberi default Java primitive atau behavior yang tidak sesuai harapan tergantung aturan conversion/default. Ini berbahaya karena `0` bisa berarti:

- tidak dikirim,
- dikirim `limit=0`,
- default Java,
- business value valid.

Lebih jelas:

```java
@GET
public Response list(@QueryParam("limit") Integer limit) {
    int effectiveLimit = limit == null ? 50 : limit;
    ...
}
```

Atau lebih eksplisit:

```java
@GET
public Response list(@DefaultValue("50") @QueryParam("limit") int limit) {
    ...
}
```

Tapi ingat: `@DefaultValue("50")` adalah bagian dari HTTP contract, bukan sekadar internal default.

### 6.4 Pagination Contract

Buruk:

```java
@GET
public Response search(
        @QueryParam("page") Integer page,
        @QueryParam("size") Integer size) {
    ...
}
```

Masalah:

- apakah page mulai dari 0 atau 1?
- max size berapa?
- jika size absent?
- jika page absent tapi size ada?
- jika size = 100000?
- jika page negatif?

Lebih baik:

```java
public final class PageRequestParam {
    private final int offset;
    private final int limit;

    private PageRequestParam(int offset, int limit) {
        this.offset = offset;
        this.limit = limit;
    }

    public static PageRequestParam from(Integer offset, Integer limit) {
        int effectiveOffset = offset == null ? 0 : offset;
        int effectiveLimit = limit == null ? 50 : limit;

        if (effectiveOffset < 0) {
            throw new BadRequestException("offset must be >= 0");
        }
        if (effectiveLimit < 1 || effectiveLimit > 200) {
            throw new BadRequestException("limit must be between 1 and 200");
        }
        return new PageRequestParam(effectiveOffset, effectiveLimit);
    }

    public int offset() { return offset; }
    public int limit() { return limit; }
}
```

Resource:

```java
@GET
@Path("/cases")
public Response search(
        @QueryParam("offset") Integer offset,
        @QueryParam("limit") Integer limit) {

    PageRequestParam page = PageRequestParam.from(offset, limit);
    ...
}
```

Nanti bisa diperbaiki dengan `@BeanParam`.

---

## 7. Multi-Valued Query Parameter

Query string bisa punya parameter berulang:

```text
GET /cases?status=OPEN&status=PENDING_REVIEW&status=ESCALATED
```

Di resource:

```java
@GET
public Response search(@QueryParam("status") List<String> statuses) {
    ...
}
```

atau:

```java
@GET
public Response search(@QueryParam("status") Set<String> statuses) {
    ...
}
```

### 7.1 Repeated Param vs Comma-Separated Param

Dua gaya umum:

```text
/cases?status=OPEN&status=PENDING
```

versus:

```text
/cases?status=OPEN,PENDING
```

Repeated param biasanya lebih sesuai dengan model HTTP query dan lebih mudah diparse oleh framework.

Comma-separated terlihat ringkas, tetapi bermasalah saat value sendiri bisa mengandung comma atau membutuhkan escaping.

Rekomendasi:

```text
/cases?status=OPEN&status=PENDING_REVIEW
```

### 7.2 Empty List Semantics

Perhatikan beda:

```text
GET /cases
GET /cases?status=
GET /cases?status=OPEN&status=
```

Untuk collection, design decision harus jelas:

- absent berarti no filter,
- empty member berarti invalid,
- duplicate value boleh atau ditolak,
- order significant atau tidak.

Contoh normalisasi:

```java
static Set<TaskStatus> parseStatuses(List<String> rawValues) {
    if (rawValues == null || rawValues.isEmpty()) {
        return Set.of(); // Java 9+. Untuk Java 8 pakai Collections.emptySet()
    }

    Set<TaskStatus> result = new LinkedHashSet<>();
    for (String raw : rawValues) {
        if (raw == null || raw.trim().isEmpty()) {
            throw new BadRequestException("status must not be blank");
        }
        result.add(TaskStatus.valueOf(raw.trim().toUpperCase(Locale.ROOT)));
    }
    return result;
}
```

Java 8 version:

```java
return Collections.emptySet();
```

---

## 8. `@HeaderParam`: Metadata, Not Business Payload

`@HeaderParam` mengambil nilai dari HTTP header.

```java
@GET
@Path("/cases/{caseId}")
public Response getCase(
        @PathParam("caseId") String caseId,
        @HeaderParam("X-Correlation-Id") String correlationId,
        @HeaderParam("Accept-Language") String acceptLanguage) {
    ...
}
```

Header cocok untuk:

- correlation id,
- idempotency key,
- trace propagation,
- content negotiation metadata,
- client version metadata,
- language preference,
- conditional request headers,
- auth token metadata, meski auth biasanya diproses filter/security layer.

Header tidak cocok untuk business payload besar.

Buruk:

```text
X-Case-Status: OPEN
X-Applicant-Name: John
X-Application-Type: RENEWAL
```

Lebih baik:

```text
GET /cases?status=OPEN&applicationType=RENEWAL
```

atau JSON body untuk command.

### 8.1 Header Spoofing

Header dari client tidak otomatis trustworthy.

Contoh berbahaya:

```java
@HeaderParam("X-User-Id") String userId
```

Jika header ini datang dari internet client, user bisa memalsukannya. Header identity hanya boleh dipercaya jika:

- diset oleh trusted gateway,
- gateway menghapus incoming spoofed header,
- jalur network trusted,
- service memverifikasi token/signature,
- ada mTLS atau security boundary lain.

Untuk identity, lebih aman gunakan security context yang dibangun dari auth layer:

```java
@Context SecurityContext securityContext
```

Lalu ambil:

```java
Principal principal = securityContext.getUserPrincipal();
```

### 8.2 Correlation ID Pattern

Sebaiknya correlation id tidak dibaca manual di semua resource.

Kurang baik:

```java
@GET
public Response get(@HeaderParam("X-Correlation-Id") String correlationId) {
    log.info("correlationId={}", correlationId);
    ...
}
```

Lebih baik:

- baca di `ContainerRequestFilter`,
- validate/generate jika absent,
- simpan di request context/MDC,
- tambahkan ke response header,
- inject hanya jika resource benar-benar butuh.

Contoh filter konseptual:

```java
@Provider
@Priority(Priorities.AUTHENTICATION - 100)
public class CorrelationIdFilter implements ContainerRequestFilter, ContainerResponseFilter {

    public static final String HEADER = "X-Correlation-Id";
    public static final String PROPERTY = "correlationId";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String incoming = requestContext.getHeaderString(HEADER);
        String correlationId = normalizeOrGenerate(incoming);
        requestContext.setProperty(PROPERTY, correlationId);
        MDC.put(HEADER, correlationId);
    }

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        Object correlationId = requestContext.getProperty(PROPERTY);
        if (correlationId != null) {
            responseContext.getHeaders().putSingle(HEADER, correlationId.toString());
        }
        MDC.remove(HEADER);
    }

    private String normalizeOrGenerate(String incoming) {
        if (incoming == null || incoming.trim().isEmpty()) {
            return UUID.randomUUID().toString();
        }
        return incoming.trim();
    }
}
```

---

## 9. `@CookieParam`: Browser State Boundary

`@CookieParam` mengambil nilai dari cookie.

```java
@GET
@Path("/me/preferences")
public Response preferences(@CookieParam("ui_locale") String locale) {
    ...
}
```

Cookie cocok untuk:

- browser session id,
- preference ringan,
- CSRF-related token pattern,
- state kecil yang memang browser-scoped.

Tidak cocok untuk:

- authoritative identity tanpa server-side/session verification,
- large state,
- complex business payload,
- security-sensitive data tanpa proteksi.

### 9.1 Cookie Security Consideration

Jika Jersey app di belakang web/browser flow, cookie harus dipikirkan bersama:

- `HttpOnly`,
- `Secure`,
- `SameSite`,
- domain/path scoping,
- session fixation,
- CSRF,
- logout invalidation,
- gateway/proxy behavior.

Resource method sebaiknya tidak menjadikan cookie sebagai sumber kebenaran business. Cookie biasanya input ke security/session layer.

---

## 10. `@MatrixParam`: Segment-Scoped Parameter

Matrix parameter adalah parameter pada path segment.

Contoh URI:

```text
GET /cases;status=OPEN/tasks;type=INSPECTION
```

Resource:

```java
@GET
@Path("/cases/tasks")
public Response list(@MatrixParam("status") String status) {
    ...
}
```

Atau dengan path segment tertentu melalui `PathSegment`:

```java
@GET
@Path("/cases/{caseSegment}/tasks")
public Response list(@PathParam("caseSegment") PathSegment caseSegment) {
    MultivaluedMap<String, String> matrix = caseSegment.getMatrixParameters();
    ...
}
```

### 10.1 Kapan Matrix Param Masuk Akal?

Secara teori, matrix param berguna jika metadata melekat pada segment tertentu:

```text
/flights/segment;from=SIN;to=CGK/passengers;type=adult
```

Namun di banyak production environment:

- developer jarang familiar,
- API gateway/proxy bisa memperlakukan semicolon berbeda,
- client tooling tidak selalu nyaman,
- observability/log parsing bisa bingung,
- security device bisa normalize/drop parameter.

Rekomendasi praktis:

> Gunakan matrix param hanya jika ada alasan kuat dan environment sudah diverifikasi end-to-end. Untuk kebanyakan API enterprise, query param lebih mudah dipahami dan lebih aman secara operasional.

---

## 11. `@FormParam`: Form Body, Bukan JSON Body

`@FormParam` mengambil nilai dari request body dengan media type form URL encoded:

```text
Content-Type: application/x-www-form-urlencoded
```

Contoh:

```java
@POST
@Path("/login")
@Consumes(MediaType.APPLICATION_FORM_URLENCODED)
public Response login(
        @FormParam("username") String username,
        @FormParam("password") String password) {
    ...
}
```

Request body:

```text
username=fajar&password=secret
```

### 11.1 `@FormParam` vs JSON Entity

Jangan campur mental model:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateCaseRequest request) {
    ...
}
```

versus:

```java
@POST
@Consumes(MediaType.APPLICATION_FORM_URLENCODED)
public Response submit(
        @FormParam("fieldA") String fieldA,
        @FormParam("fieldB") String fieldB) {
    ...
}
```

`@FormParam` cocok untuk:

- HTML form legacy,
- OAuth/token endpoint style,
- simple form-urlencoded integration.

Untuk command API modern, JSON DTO biasanya lebih maintainable.

### 11.2 Body Consumption Risk

Form parameter berasal dari body. Jika filter/interceptor membaca entity stream sebelum `@FormParam` diproses dan tidak mengembalikan stream, form injection bisa gagal.

Ini terkait dengan Part 10 nanti: membaca request body di filter harus dilakukan sangat hati-hati.

---

## 12. `@BeanParam`: Parameter Aggregator

`@BeanParam` memungkinkan beberapa parameter injection dikumpulkan ke satu object.

Contoh:

```java
public class CaseSearchParams {

    @QueryParam("status")
    private List<String> statuses;

    @QueryParam("assignedTo")
    private String assignedTo;

    @DefaultValue("0")
    @QueryParam("offset")
    private int offset;

    @DefaultValue("50")
    @QueryParam("limit")
    private int limit;

    @HeaderParam("X-Client-Version")
    private String clientVersion;

    public List<String> getStatuses() {
        return statuses;
    }

    public String getAssignedTo() {
        return assignedTo;
    }

    public int getOffset() {
        return offset;
    }

    public int getLimit() {
        return limit;
    }

    public String getClientVersion() {
        return clientVersion;
    }
}
```

Resource:

```java
@GET
@Path("/cases")
public Response search(@BeanParam CaseSearchParams params) {
    ...
}
```

### 12.1 Kelebihan `@BeanParam`

- Resource method tidak terlalu panjang.
- Query contract terkumpul di satu class.
- Bisa dipakai ulang untuk endpoint sejenis.
- Bisa diberi method normalisasi/validasi lokal.
- Bisa dites terpisah sebagai contract object.

Sebelum:

```java
public Response search(
        @QueryParam("status") List<String> status,
        @QueryParam("assignedTo") String assignedTo,
        @QueryParam("from") String from,
        @QueryParam("to") String to,
        @QueryParam("sort") String sort,
        @QueryParam("offset") Integer offset,
        @QueryParam("limit") Integer limit,
        @HeaderParam("X-Client-Version") String clientVersion) {
    ...
}
```

Sesudah:

```java
public Response search(@BeanParam CaseSearchParams params) {
    ...
}
```

### 12.2 Risiko `@BeanParam`

`@BeanParam` bisa menyembunyikan complexity.

Resource terlihat sederhana:

```java
public Response search(@BeanParam CaseSearchParams params) {
    ...
}
```

Tapi class `CaseSearchParams` bisa berisi 30 field dari query/header/cookie/path, plus default, plus validation. Ini bisa membuat API contract sulit dibaca jika tidak didokumentasikan.

Guideline:

- Gunakan `@BeanParam` untuk cohesive parameter set.
- Jangan gunakan sebagai “dumping ground semua input”.
- Pisahkan object untuk search, paging, sorting, identity, dan header metadata jika perlu.
- Tetap dokumentasikan field sebagai API contract.

### 12.3 BeanParam dengan Validation

Contoh:

```java
public class PageParams {

    @DefaultValue("0")
    @QueryParam("offset")
    @Min(0)
    private int offset;

    @DefaultValue("50")
    @QueryParam("limit")
    @Min(1)
    @Max(200)
    private int limit;

    public int getOffset() {
        return offset;
    }

    public int getLimit() {
        return limit;
    }
}
```

Resource:

```java
@GET
public Response search(@Valid @BeanParam PageParams page) {
    ...
}
```

Catatan: Bean Validation integration bergantung dependency dan konfigurasi runtime. Di Jersey/Jakarta stack production, pastikan module validation memang tersedia dan exception mapping-nya konsisten.

---

## 13. Type Conversion Rules

Parameter dari request biasanya string. Runtime kemudian mencoba mengubah ke tipe target.

Secara umum tipe yang lazim didukung:

- `String`,
- primitive/wrapper: `int`, `Integer`, `long`, `Long`, `boolean`, `Boolean`, dll,
- enum,
- tipe dengan factory/conversion tertentu,
- collection dari tipe convertible,
- custom type via `ParamConverterProvider`.

Contoh enum:

```java
public enum CaseStatus {
    OPEN,
    PENDING_REVIEW,
    CLOSED
}
```

```java
@GET
public Response search(@QueryParam("status") CaseStatus status) {
    ...
}
```

Request:

```text
GET /cases?status=OPEN
```

Works.

Request:

```text
GET /cases?status=open
```

Bisa gagal jika conversion enum case-sensitive. Jangan asumsikan case-insensitive kecuali kamu membuat converter sendiri.

### 13.1 Enum di Public API

Menggunakan enum langsung di API boundary nyaman, tetapi ada risiko:

- rename enum internal merusak API,
- casing Java bocor ke HTTP contract,
- unknown future value gagal parsing,
- client tergantung nama enum internal.

Untuk API publik/enterprise jangka panjang, pertimbangkan:

```java
public enum CaseStatusParam {
    OPEN("open"),
    PENDING_REVIEW("pending_review"),
    CLOSED("closed");

    private final String wireValue;

    CaseStatusParam(String wireValue) {
        this.wireValue = wireValue;
    }

    public static CaseStatusParam fromWireValue(String raw) {
        for (CaseStatusParam value : values()) {
            if (value.wireValue.equals(raw)) {
                return value;
            }
        }
        throw new BadRequestException("Unsupported case status: " + raw);
    }
}
```

Lalu gunakan converter.

---

## 14. Custom Domain Parameter Type

Misalnya kita tidak ingin `caseId` sekadar `String`.

```java
public final class CaseId {
    private static final Pattern PATTERN = Pattern.compile("CASE-[0-9]{4}-[0-9]{6}");

    private final String value;

    private CaseId(String value) {
        this.value = value;
    }

    public static CaseId parse(String raw) {
        if (raw == null || !PATTERN.matcher(raw).matches()) {
            throw new IllegalArgumentException("Invalid caseId");
        }
        return new CaseId(raw);
    }

    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
```

Resource ideal:

```java
@GET
@Path("/cases/{caseId}")
public Response getCase(@PathParam("caseId") CaseId caseId) {
    ...
}
```

Agar Jersey tahu cara mengubah string menjadi `CaseId`, kita buat `ParamConverter`.

---

## 15. `ParamConverter` dan `ParamConverterProvider`

`ParamConverter<T>` bertugas mengubah:

```text
String → T
T → String
```

`ParamConverterProvider` bertugas menyediakan converter untuk tipe tertentu.

### 15.1 Implementasi Converter

```java
public class CaseIdParamConverter implements ParamConverter<CaseId> {

    @Override
    public CaseId fromString(String value) {
        try {
            return CaseId.parse(value);
        } catch (IllegalArgumentException ex) {
            throw new BadRequestException("Invalid caseId format");
        }
    }

    @Override
    public String toString(CaseId value) {
        return value == null ? null : value.value();
    }
}
```

Provider:

```java
@Provider
public class DomainParamConverterProvider implements ParamConverterProvider {

    private static final ParamConverter<CaseId> CASE_ID_CONVERTER = new CaseIdParamConverter();

    @Override
    @SuppressWarnings("unchecked")
    public <T> ParamConverter<T> getConverter(
            Class<T> rawType,
            Type genericType,
            Annotation[] annotations) {

        if (rawType.equals(CaseId.class)) {
            return (ParamConverter<T>) CASE_ID_CONVERTER;
        }
        return null;
    }
}
```

Register:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(DomainParamConverterProvider.class);
        packages("com.example.api");
    }
}
```

### 15.2 Error Handling dalam Converter

Jangan biarkan exception internal bocor:

Buruk:

```java
throw new IllegalArgumentException("Pattern CASE-[0-9]{4}-[0-9]{6} mismatch in CaseId.parse at line...");
```

Lebih baik:

```java
throw new BadRequestException("Invalid caseId format");
```

Nanti `ExceptionMapper<BadRequestException>` atau mapper umum dapat membentuk error response konsisten.

### 15.3 Converter Tidak Boleh Terlalu Pintar

Converter sebaiknya hanya parsing format transport.

Jangan lakukan ini:

```java
public CaseId fromString(String value) {
    CaseId id = CaseId.parse(value);
    if (!caseRepository.exists(id)) {
        throw new NotFoundException();
    }
    return id;
}
```

Kenapa buruk?

- converter menjadi bergantung repository,
- parameter parsing melakukan IO/database call,
- error 404 terjadi sebelum authorization/service layer,
- sulit observability,
- sulit test,
- lifecycle provider menjadi berat,
- bisa membuat request matching/injection unexpectedly expensive.

Converter hanya boleh menjawab:

> “Apakah string ini bisa menjadi tipe Java X secara format?”

Bukan:

> “Apakah object ini valid secara business dan ada di database?”

---

## 16. Default Value Semantics

`@DefaultValue` dipakai ketika parameter tidak tersedia.

```java
@GET
public Response list(
        @DefaultValue("0") @QueryParam("offset") int offset,
        @DefaultValue("50") @QueryParam("limit") int limit) {
    ...
}
```

### 16.1 Default Value adalah Kontrak API

Jika kamu menulis:

```java
@DefaultValue("50")
```

maka kamu sedang berkata:

> “Jika client tidak mengirim `limit`, server akan menganggap `limit=50`.”

Ini harus masuk dokumentasi API.

Jangan gunakan default value hanya untuk menghindari `null` tanpa memikirkan makna.

### 16.2 Default untuk Header

```java
@HeaderParam("X-Client-Version")
@DefaultValue("unknown")
String clientVersion
```

Hati-hati: `unknown` bisa masuk log, metric, audit, atau business rule. Kadang lebih baik absent tetap `null` lalu ditangani eksplisit.

### 16.3 Default dan Converter

Jika default value diberikan untuk custom type, runtime perlu mengonversi default string tersebut ke target type. `ParamConverter` API memiliki konsep lazy conversion untuk default value melalui annotation tertentu pada converter. Ini penting kalau conversion mahal atau bergantung context, meskipun dalam desain yang baik converter sebaiknya ringan.

---

## 17. Optional: Apakah Boleh Pakai `Optional<T>`?

Di Java 8+, `Optional<T>` sering menggoda:

```java
public Response search(@QueryParam("status") Optional<String> status) {
    ...
}
```

Namun dukungan `Optional` pada parameter injection tidak selalu menjadi pilihan yang paling portable lintas versi/runtime/config. Selain itu, `Optional` sebagai parameter method sendiri masih diperdebatkan dalam gaya Java.

Rekomendasi praktis untuk Jersey production:

- Untuk resource boundary, gunakan wrapper nullable (`String`, `Integer`, `Long`) atau `@BeanParam` object.
- Normalisasi ke `Optional` di dalam object/method helper.

Contoh:

```java
public class CaseSearchParams {

    @QueryParam("assignedTo")
    private String assignedTo;

    public Optional<String> assignedTo() {
        if (assignedTo == null || assignedTo.trim().isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(assignedTo.trim());
    }
}
```

Java 8 compatible.

---

## 18. Field Injection vs Method Parameter Injection

Contoh field injection:

```java
@Path("/cases/{caseId}")
public class CaseResource {

    @PathParam("caseId")
    private String caseId;

    @GET
    public Response get() {
        ...
    }
}
```

Contoh method parameter injection:

```java
@Path("/cases/{caseId}")
public class CaseResource {

    @GET
    public Response get(@PathParam("caseId") String caseId) {
        ...
    }
}
```

Rekomendasi:

> Untuk parameter request, method parameter lebih eksplisit dan lebih aman terhadap lifecycle confusion.

Field injection terlihat rapi jika banyak method memakai parameter yang sama, tetapi hati-hati:

- resource lifecycle bisa per-request atau singleton tergantung konfigurasi/container,
- field request-specific pada singleton berbahaya,
- test lebih tidak eksplisit,
- method signature tidak menunjukkan dependency input.

Gunakan field injection terutama untuk context/provider tertentu jika memang sudah paham lifecycle, bukan default habit.

---

## 19. Constructor Injection dan Resource Lifecycle

Jersey mendukung berbagai model injection tergantung HK2/CDI/Spring integration. Namun parameter annotation seperti `@QueryParam` pada constructor lebih jarang dipakai dan bisa membingungkan.

Contoh yang mungkin terlihat menarik:

```java
@Path("/cases/{caseId}")
public class CaseResource {

    private final String caseId;

    public CaseResource(@PathParam("caseId") String caseId) {
        this.caseId = caseId;
    }
}
```

Masalahnya:

- lifecycle resource harus jelas,
- injection timing harus jelas,
- integration dengan DI container lain bisa rumit,
- sub-resource locator bisa punya semantics berbeda.

Production guideline:

- Constructor injection untuk service dependency: baik.
- Method parameter / `@BeanParam` untuk request parameter: lebih jelas.

Contoh:

```java
@Path("/cases")
public class CaseResource {

    private final CaseService caseService;

    @Inject
    public CaseResource(CaseService caseService) {
        this.caseService = caseService;
    }

    @GET
    @Path("/{caseId}")
    public Response get(@PathParam("caseId") String caseId) {
        ...
    }
}
```

---

## 20. `@Context` Berbeda dari `@*Param`

`@Context` bukan mengambil string parameter. Ia menginject object runtime context.

Contoh:

```java
@GET
public Response get(
        @Context UriInfo uriInfo,
        @Context HttpHeaders headers,
        @Context Request request,
        @Context SecurityContext securityContext) {
    ...
}
```

Common context:

| Context | Fungsi |
|---|---|
| `UriInfo` | informasi URI, path, query, base URI |
| `HttpHeaders` | semua header request |
| `Request` | conditional request, preconditions |
| `SecurityContext` | principal, role, scheme |
| `ContainerRequestContext` | filter-level request context |

Gunakan `@Context` ketika butuh object runtime, bukan sekadar nilai satu parameter.

Contoh saat query dynamic:

```java
@GET
public Response search(@Context UriInfo uriInfo) {
    MultivaluedMap<String, String> query = uriInfo.getQueryParameters();
    ...
}
```

Tapi jangan jadikan `UriInfo` sebagai excuse untuk parsing manual semua hal. Untuk contract stabil, annotation parameter lebih self-documenting.

---

## 21. Designing Parameter Objects

Untuk API yang mulai kompleks, buat object parameter yang memisahkan:

- raw injected value,
- normalized value,
- validation,
- semantic conversion.

Contoh:

```java
public class CaseSearchParams {

    @QueryParam("status")
    private List<String> rawStatuses;

    @QueryParam("assignedTo")
    private String rawAssignedTo;

    @QueryParam("from")
    private String rawFrom;

    @QueryParam("to")
    private String rawTo;

    @DefaultValue("0")
    @QueryParam("offset")
    private int offset;

    @DefaultValue("50")
    @QueryParam("limit")
    private int limit;

    public CaseSearchCriteria toCriteria() {
        return new CaseSearchCriteria(
                parseStatuses(rawStatuses),
                normalizeOptionalText(rawAssignedTo),
                parseOptionalDate(rawFrom, "from"),
                parseOptionalDate(rawTo, "to"),
                PageRequestParam.from(offset, limit)
        );
    }

    private Set<CaseStatus> parseStatuses(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            return Collections.emptySet();
        }
        Set<CaseStatus> result = new LinkedHashSet<>();
        for (String value : raw) {
            if (value == null || value.trim().isEmpty()) {
                throw new BadRequestException("status must not be blank");
            }
            try {
                result.add(CaseStatus.valueOf(value.trim().toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException ex) {
                throw new BadRequestException("Unsupported status: " + value);
            }
        }
        return result;
    }

    private Optional<String> normalizeOptionalText(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(trimmed);
    }

    private Optional<LocalDate> parseOptionalDate(String raw, String fieldName) {
        if (raw == null || raw.trim().isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(LocalDate.parse(raw.trim()));
        } catch (DateTimeParseException ex) {
            throw new BadRequestException(fieldName + " must use ISO-8601 date format yyyy-MM-dd");
        }
    }
}
```

Resource:

```java
@GET
@Path("/cases")
public Response search(@BeanParam CaseSearchParams params) {
    CaseSearchCriteria criteria = params.toCriteria();
    SearchResult<CaseSummary> result = caseQueryService.search(criteria);
    return Response.ok(result).build();
}
```

Di sini resource tetap tipis, tetapi semantics jelas.

---

## 22. Parameter Boundary vs Domain Boundary

Jangan langsung masukkan injected parameter ke repository query tanpa normalisasi.

Buruk:

```java
@GET
public Response search(@QueryParam("status") String status) {
    return Response.ok(caseRepository.findByStatus(status)).build();
}
```

Masalah:

- blank tidak jelas,
- casing tidak jelas,
- unsupported value bocor ke SQL/domain,
- error tidak konsisten,
- audit/debug sulit.

Lebih baik:

```java
@GET
public Response search(@BeanParam CaseSearchParams params) {
    CaseSearchCriteria criteria = params.toCriteria();
    return Response.ok(caseQueryService.search(criteria)).build();
}
```

Boundary chain:

```text
HTTP query string
    ↓
Jersey parameter injection
    ↓
API parameter object
    ↓
normalized application criteria
    ↓
service layer
    ↓
domain/repository
```

Ini menjaga domain layer tidak tergantung bentuk HTTP.

---

## 23. Validation Layering

Ada beberapa level validation:

| Level | Contoh | Tempat |
|---|---|---|
| Syntax/format | `limit` harus integer | Jersey conversion / converter |
| Transport contract | `limit` 1..200 | Bean Validation / param object |
| Cross-field request | `from <= to` | param object / validator |
| Authorization-aware | user boleh akses agency X | service/security layer |
| Domain invariant | case CLOSED tidak bisa diedit | domain/service layer |
| Persistence constraint | unique key, FK | database/repository |

Jangan campur semuanya ke resource method.

Contoh cross-field validation:

```java
public CaseSearchCriteria toCriteria() {
    Optional<LocalDate> from = parseOptionalDate(rawFrom, "from");
    Optional<LocalDate> to = parseOptionalDate(rawTo, "to");

    if (from.isPresent() && to.isPresent() && from.get().isAfter(to.get())) {
        throw new BadRequestException("from must be before or equal to to");
    }

    ...
}
```

---

## 24. Failure Modes Umum Parameter Injection

### 24.1 `400 Bad Request` Sebelum Method Masuk

Gejala:

- log dalam method tidak muncul,
- client dapat 400,
- stack trace menunjukkan conversion failure.

Penyebab umum:

- `@QueryParam("limit") int limit` menerima `limit=abc`,
- enum tidak cocok,
- custom converter throw exception,
- default value tidak bisa dikonversi.

Solusi:

- pasang exception mapper yang konsisten,
- test invalid input,
- gunakan error message yang aman.

### 24.2 Parameter Selalu Null

Penyebab umum:

- nama param salah:

```java
@QueryParam("case_status") String status
```

request:

```text
?status=OPEN
```

- param di path template beda:

```java
@Path("/cases/{id}")
public Response get(@PathParam("caseId") String caseId)
```

- header berbeda karena gateway mengganti/menghapus,
- form content-type salah,
- resource method tidak sesuai path yang dikira.

### 24.3 `@BeanParam` Tidak Terisi

Penyebab:

- tidak ada no-arg constructor,
- field private tanpa akses yang didukung runtime tertentu,
- setter salah nama,
- annotation dipasang di object yang tidak dipakai,
- lifecycle/DI container conflict.

Guideline:

- buat `@BeanParam` sebagai simple POJO,
- no-arg constructor,
- field injection sederhana atau setter jelas,
- jangan terlalu clever dengan final field jika runtime tidak mendukung.

### 24.4 Header Hilang di Production tapi Ada di Local

Penyebab:

- API gateway drop header,
- nginx/ALB tidak forward header tertentu,
- CORS preflight berbeda,
- browser tidak mengirim custom header tanpa izin CORS,
- security layer strip header.

Solusi:

- cek request di edge/gateway,
- cek access log container,
- jangan hanya debug resource method.

### 24.5 Matrix Param Hilang

Penyebab:

- proxy normalize semicolon,
- servlet container setting,
- security filter reject semicolon,
- client encode berbeda.

Solusi:

- hindari matrix param kecuali environment sudah diverifikasi.

---

## 25. Error Response Strategy untuk Parameter Error

Parameter error harus menghasilkan response yang dapat dipakai client memperbaiki request.

Contoh Problem Details style:

```json
{
  "type": "https://api.example.gov/problems/invalid-request-parameter",
  "title": "Invalid request parameter",
  "status": 400,
  "detail": "One or more request parameters are invalid.",
  "instance": "/cases?limit=abc",
  "correlationId": "abc-123",
  "errors": [
    {
      "field": "limit",
      "message": "limit must be an integer between 1 and 200"
    }
  ]
}
```

Jangan bocorkan:

```text
java.lang.NumberFormatException: For input string: "abc"
```

Resource method tidak bisa menangkap semua injection error karena method belum dipanggil. Jadi strategi error harus lewat `ExceptionMapper`.

Exception mapping akan dibahas mendalam di Part 9, tetapi dari Part 5 kita sudah harus berpikir bahwa parameter contract membutuhkan error contract.

---

## 26. Java 8–25 Considerations

### 26.1 Java 8

- Tidak ada `List.of`, `Set.of`, `Map.of`.
- `Optional` ada, tetapi sebaiknya tidak berlebihan sebagai injection parameter.
- `java.time` sudah ada dan sebaiknya digunakan daripada `Date`/`Calendar` untuk API date/time.
- Records belum ada, sehingga `@BeanParam` biasanya POJO mutable.

Java 8 style:

```java
public class PageParams {
    @DefaultValue("0")
    @QueryParam("offset")
    private int offset;

    @DefaultValue("50")
    @QueryParam("limit")
    private int limit;

    public int getOffset() { return offset; }
    public int getLimit() { return limit; }
}
```

### 26.2 Java 11–17

- `var` bisa membantu local readability, tapi jangan mengaburkan boundary type.
- Java 17 menjadi baseline penting untuk banyak modern Jakarta stack.
- Sealed class bisa berguna untuk domain/result modelling, bukan langsung untuk query param.

### 26.3 Java 21–25

- Records menggoda untuk parameter object:

```java
public record PageParams(int offset, int limit) {}
```

Namun `@BeanParam` injection tradisional biasanya membutuhkan mutable bean/no-arg + field/setter injection. Jadi record lebih cocok sebagai normalized object hasil transformasi:

```java
public record PageRequest(int offset, int limit) {}
```

`@BeanParam` raw object:

```java
public class PageParams {
    @DefaultValue("0")
    @QueryParam("offset")
    private int offset;

    @DefaultValue("50")
    @QueryParam("limit")
    private int limit;

    public PageRequest toPageRequest() {
        return new PageRequest(offset, limit);
    }
}
```

- Pattern matching/switch bisa membantu converter/normalizer.
- Virtual threads tidak mengubah semantics parameter injection secara langsung.
- ThreadLocal/MDC untuk correlation tetap harus hati-hati di async/virtual-thread context.

---

## 27. Design Patterns

### 27.1 Thin Resource + Parameter Object + Criteria

```text
HTTP request
    ↓
@BeanParam SearchParams
    ↓
SearchCriteria normalized immutable object
    ↓
Application service
```

Contoh:

```java
@GET
@Path("/cases")
public Response search(@BeanParam CaseSearchParams params) {
    CaseSearchCriteria criteria = params.toCriteria();
    return Response.ok(caseQueryService.search(criteria)).build();
}
```

### 27.2 Typed ID Boundary

```java
@GET
@Path("/cases/{caseId}")
public Response get(@PathParam("caseId") CaseId caseId) {
    return Response.ok(caseService.get(caseId)).build();
}
```

Syarat:

- custom converter,
- error mapper,
- tests.

### 27.3 Header as Infrastructure Context

```text
X-Correlation-Id
    ↓
ContainerRequestFilter
    ↓
MDC/request property
    ↓
response header/log/trace
```

Bukan manual di setiap endpoint.

### 27.4 Explicit Default Policy

```java
@DefaultValue("50") @QueryParam("limit") int limit
```

Jika default adalah API contract.

```java
@QueryParam("limit") Integer limit
```

Jika ingin membedakan absent dari explicit value.

---

## 28. Anti-Patterns

### 28.1 Resource Method dengan Terlalu Banyak Parameter

```java
public Response search(String a, String b, String c, String d, String e, String f, String g) {
    ...
}
```

Solusi: `@BeanParam` + normalized criteria.

### 28.2 Primitive untuk Optional Input

```java
@QueryParam("limit") int limit
```

Solusi:

```java
@DefaultValue("50") @QueryParam("limit") int limit
```

atau:

```java
@QueryParam("limit") Integer limit
```

### 28.3 Converter Melakukan Database Lookup

Converter harus parsing, bukan business validation.

### 28.4 Header untuk Business Payload

Gunakan query/body sesuai semantics.

### 28.5 Matrix Param Tanpa Verifikasi Infrastruktur

Semicolon handling bisa berubah di proxy/container/security.

### 28.6 `@BeanParam` sebagai Dumping Ground

Parameter object harus cohesive.

### 28.7 Membiarkan Blank Value Diam-diam Jadi Null

Tentukan policy explicit.

---

## 29. Testing Parameter Contract

Test bukan hanya happy path.

Checklist test:

### PathParam

- valid ID,
- invalid format,
- unknown ID,
- encoded character,
- path mismatch.

### QueryParam

- absent,
- empty,
- blank,
- valid single,
- valid multiple,
- invalid enum,
- invalid number,
- below min,
- above max,
- duplicate.

### HeaderParam

- absent header,
- invalid format,
- gateway-like stripped header,
- multiple header value.

### CookieParam

- absent cookie,
- malformed cookie,
- untrusted cookie.

### FormParam

- correct content type,
- wrong content type,
- malformed body,
- body consumed by filter scenario.

### BeanParam

- all field injected,
- default applied,
- validation triggered,
- transformation to criteria correct.

Contoh conceptual Jersey Test:

```java
@Test
public void shouldRejectInvalidLimit() {
    Response response = target("cases")
            .queryParam("limit", "abc")
            .request()
            .get();

    assertEquals(400, response.getStatus());
}
```

Testing mendalam Jersey Test Framework akan dibahas di Part 27.

---

## 30. Production Checklist

Sebelum endpoint dianggap production-ready, jawab pertanyaan ini:

1. Untuk setiap `@PathParam`, apakah ia benar-benar identity?
2. Apakah format ID jelas dan stabil?
3. Untuk setiap `@QueryParam`, apakah absent/empty/blank semantics jelas?
4. Apakah optional numeric memakai wrapper atau default eksplisit?
5. Apakah pagination punya min/max?
6. Apakah sorting allowlist, bukan raw SQL field?
7. Apakah enum wire value stabil?
8. Apakah header yang dipercaya benar-benar berasal dari trusted boundary?
9. Apakah cookie tidak dijadikan authoritative identity tanpa verification?
10. Apakah `@FormParam` hanya dipakai untuk form content type?
11. Apakah `@BeanParam` cohesive dan terdokumentasi?
12. Apakah custom converter ringan dan tidak melakukan IO?
13. Apakah parsing error menghasilkan 400 dengan error shape konsisten?
14. Apakah validation error tidak membocorkan stack trace/internal class?
15. Apakah parameter contract dites untuk invalid input?
16. Apakah behavior sama di local, test, gateway, dan production?

---

## 31. Mini Case Study: Regulatory Case Search API

Misalnya kita membangun endpoint:

```text
GET /cases?status=OPEN&status=ESCALATED&assignedTo=me&from=2026-01-01&to=2026-06-30&offset=0&limit=50
```

Naive implementation:

```java
@GET
@Path("/cases")
public Response search(
        @QueryParam("status") List<String> statuses,
        @QueryParam("assignedTo") String assignedTo,
        @QueryParam("from") String from,
        @QueryParam("to") String to,
        @QueryParam("offset") Integer offset,
        @QueryParam("limit") Integer limit) {

    return Response.ok(repository.search(statuses, assignedTo, from, to, offset, limit)).build();
}
```

Masalah:

- parsing date tersebar,
- `assignedTo=me` adalah semantic alias yang harus diketahui service,
- status raw string masuk repository,
- pagination bisa unlimited,
- error tidak konsisten,
- audit criteria tidak normalized.

Lebih baik:

```java
@GET
@Path("/cases")
public Response search(@BeanParam CaseSearchParams params,
                       @Context SecurityContext securityContext) {

    UserIdentity actor = identityFrom(securityContext);
    CaseSearchCriteria criteria = params.toCriteria(actor);
    SearchResult<CaseSummary> result = caseQueryService.search(criteria);
    return Response.ok(result).build();
}
```

Parameter object:

```java
public class CaseSearchParams {

    @QueryParam("status")
    private List<String> rawStatuses;

    @QueryParam("assignedTo")
    private String rawAssignedTo;

    @QueryParam("from")
    private String rawFrom;

    @QueryParam("to")
    private String rawTo;

    @DefaultValue("0")
    @QueryParam("offset")
    private int offset;

    @DefaultValue("50")
    @QueryParam("limit")
    private int limit;

    public CaseSearchCriteria toCriteria(UserIdentity actor) {
        Set<CaseStatus> statuses = parseStatuses(rawStatuses);
        Optional<AssigneeFilter> assignee = parseAssignedTo(rawAssignedTo, actor);
        Optional<LocalDate> from = parseDate(rawFrom, "from");
        Optional<LocalDate> to = parseDate(rawTo, "to");
        PageRequestParam page = PageRequestParam.from(offset, limit);

        if (from.isPresent() && to.isPresent() && from.get().isAfter(to.get())) {
            throw new BadRequestException("from must be before or equal to to");
        }

        return new CaseSearchCriteria(statuses, assignee, from, to, page);
    }

    private Optional<AssigneeFilter> parseAssignedTo(String raw, UserIdentity actor) {
        if (raw == null || raw.trim().isEmpty()) {
            return Optional.empty();
        }
        String value = raw.trim();
        if ("me".equalsIgnoreCase(value)) {
            return Optional.of(AssigneeFilter.user(actor.userId()));
        }
        return Optional.of(AssigneeFilter.user(UserId.parse(value)));
    }

    // parseStatuses and parseDate omitted for brevity
}
```

Notice:

- Resource tetap tipis.
- HTTP-specific raw string berhenti di parameter object.
- Service menerima criteria yang sudah meaningful.
- Error invalid request terjadi di boundary.
- Identity dari security context, bukan header/query.

---

## 32. Key Takeaways

1. Parameter injection adalah **API contract boundary**, bukan sekadar convenience annotation.
2. `@PathParam` idealnya untuk identity.
3. `@QueryParam` idealnya untuk filter/search/pagination/sort optional controls.
4. `@HeaderParam` untuk metadata, bukan business payload utama.
5. `@CookieParam` harus diperlakukan sebagai browser/session boundary yang tidak otomatis trustworthy.
6. `@MatrixParam` powerful tetapi jarang praktis di modern enterprise deployment.
7. `@FormParam` hanya untuk form body, bukan JSON body.
8. `@BeanParam` bagus untuk cohesive parameter object, tetapi buruk jika menjadi dumping ground.
9. Primitive parameter untuk optional input sering menciptakan ambiguity.
10. `@DefaultValue` adalah API contract, bukan sekadar null avoidance.
11. Custom `ParamConverter` harus ringan, deterministic, dan tidak melakukan IO/database lookup.
12. Absent, empty, blank, malformed, dan default harus dibedakan secara sadar.
13. Error parameter harus dimapping menjadi response yang aman dan actionable.
14. Resource method harus menerima input yang sudah cukup jelas, lalu menyerahkan normalized criteria ke service layer.

---

## 33. Latihan

### Latihan 1

Desain endpoint:

```text
GET /applications/{applicationId}/documents?type=SUPPORTING&uploadedBy=me&limit=20
```

Tentukan:

- mana path param,
- mana query param,
- mana butuh custom type,
- absent/empty/blank policy,
- error response jika invalid.

### Latihan 2

Buat `@BeanParam` untuk search endpoint dengan field:

- `status` multi-value,
- `fromDate`,
- `toDate`,
- `sort`,
- `offset`,
- `limit`.

Tambahkan rule:

- `limit` max 200,
- `fromDate <= toDate`,
- `sort` hanya boleh field allowlist.

### Latihan 3

Buat `ParamConverter` untuk `ApplicationId` dengan format:

```text
APP-YYYY-NNNNNN
```

Pastikan converter:

- tidak melakukan DB lookup,
- menghasilkan 400 untuk format invalid,
- punya `toString` yang stabil.

### Latihan 4

Analisis risiko endpoint berikut:

```java
@GET
@Path("/cases")
public Response search(
        @HeaderParam("X-User-Id") String userId,
        @QueryParam("status") String status,
        @QueryParam("limit") int limit) {
    ...
}
```

Temukan minimal 5 masalah production.

---

## 34. Referensi

- Jakarta RESTful Web Services 4.0 Specification — resource method parameters, parameter annotations, conversion, and matching semantics.
- Jakarta RESTful Web Services API 4.0 — `ParamConverter`, `ParamConverterProvider`, `BeanParam`, `QueryParam`, `PathParam` API docs.
- Eclipse Jersey User Guide — JAX-RS resources, parameter annotations, `@BeanParam`, injection behavior, Jersey-specific runtime context.
- Jersey API docs — provider registration and extension behavior across Jersey 2.x/3.x/4.x.

---

## 35. Posisi Kita dalam Series

Selesai:

```text
Part 0 — Orientasi Seri
Part 1 — Jersey Mental Model
Part 2 — Application Bootstrap
Part 3 — Resource Model Internals
Part 4 — Request Matching Deep Dive
Part 5 — Parameter Injection Semantics
```

Berikutnya:

```text
Part 6 — Entity Provider Pipeline: MessageBodyReader, MessageBodyWriter, and Provider Selection
```

Series belum selesai. Target akhir tetap Part 32 — Capstone.
