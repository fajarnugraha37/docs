# Part 20 — API Versioning and Compatibility with Jersey

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Previous: Part 19 — Validation Strategy  
Next: Part 21 — Hypermedia, Links, URI Building, and REST Maturity Pragmatism

---

## 0. Posisi Materi Ini dalam Series

Di part sebelumnya kita membahas validation sebagai boundary architecture: bagaimana request shape, API contract, domain invariant, workflow rule, persistence constraint, dan external constraint tidak boleh dicampur sembarangan.

Part ini membahas masalah yang muncul setelah API mulai dipakai oleh banyak client: **evolusi kontrak**.

API yang baik bukan hanya API yang bisa dipanggil hari ini. API yang baik adalah API yang bisa berubah tanpa merusak client lama secara tidak perlu.

Dalam konteks Jersey, versioning bukan hanya soal memilih URL seperti `/v1/...` atau `/v2/...`. Jersey memberi beberapa mekanisme yang bisa dipakai untuk memisahkan versi:

- resource class berbeda;
- package berbeda;
- `ResourceConfig` berbeda;
- media type berbeda melalui `@Produces` / `@Consumes`;
- header-based dispatch melalui filter/sub-resource;
- provider berbeda per versi;
- DTO berbeda per versi;
- exception mapper berbeda per versi;
- client module berbeda per versi;
- deployment berbeda per versi.

Target part ini: kamu bisa mendesain API Jersey yang **evolvable**, **compatible**, **observable**, dan **defensible** ketika client, frontend, partner system, mobile app, batch integration, atau regulatory consumer masih memakai kontrak lama.

---

## 1. Mental Model: Versioning Bukan Tujuan, Compatibility Adalah Tujuan

Kesalahan umum:

> “Kita butuh API versioning.”

Yang sebenarnya dibutuhkan biasanya:

> “Kita butuh mengubah API tanpa mematahkan client yang masih bergantung pada kontrak lama.”

Versioning hanyalah salah satu alat. Compatibility adalah tujuan.

```text
Business change
  ↓
API behavior needs to evolve
  ↓
Can old clients continue safely?
  ├─ yes → compatible change, no new version usually needed
  └─ no  → breaking change, versioning/deprecation/migration needed
```

Engineer top-tier tidak bertanya dulu “versinya pakai URI atau header?”

Mereka bertanya:

1. Perubahan ini breaking atau non-breaking?
2. Siapa client yang terdampak?
3. Apakah perubahan bisa dibuat additive?
4. Apakah behavior lama masih bisa dipertahankan?
5. Apakah error contract berubah?
6. Apakah semantic field berubah?
7. Apakah client punya migration window?
8. Apakah observability bisa membuktikan client lama sudah tidak memakai versi lama?

---

## 2. Apa Itu API Contract?

Banyak engineer mengira API contract hanya JSON schema atau OpenAPI spec. Itu terlalu sempit.

Kontrak API mencakup:

```text
HTTP method
URI pattern
query parameters
headers
request media type
request body shape
response status codes
response headers
response media type
response body shape
error shape
field meaning
field optionality
field nullability
field default behavior
sorting/filtering semantics
pagination semantics
authorization behavior
idempotency behavior
rate-limit behavior
timeout/retry expectation
side effects
ordering guarantee
consistency guarantee
deprecation policy
```

Contoh: field `status` bisa tampak sama secara JSON, tetapi kontraknya berubah jika meaning berubah.

```json
{
  "status": "APPROVED"
}
```

Jika sebelumnya `APPROVED` berarti “final decision issued”, lalu berubah menjadi “manager approved but pending legal review”, maka itu breaking secara semantic walaupun JSON shape tidak berubah.

Compatibility bukan hanya shape. Compatibility adalah **shape + behavior + meaning**.

---

## 3. Jenis Perubahan API

### 3.1 Additive Compatible Change

Biasanya aman:

- menambah optional response field;
- menambah optional request field;
- menambah endpoint baru;
- menambah enum value jika client didesain tolerant;
- menambah response header;
- memperluas filter query optional;
- menambah link baru;
- menambah error detail non-breaking jika struktur lama tetap ada.

Namun “biasanya aman” bukan berarti selalu aman.

Contoh menambah response field bisa breaking jika client memakai strict JSON deserialization.

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Kalau external client seperti itu, tambahan field bisa mematahkan client.

### 3.2 Breaking Change

Umumnya breaking:

- menghapus field response;
- mengganti nama field;
- mengganti tipe field;
- mengubah required field;
- mengubah semantic field;
- mengubah status code utama;
- mengubah error shape;
- mengubah pagination behavior;
- mengubah default sort;
- mengubah authorization rule;
- mengubah idempotency behavior;
- mengganti enum value;
- mempersempit accepted media type;
- memperketat validation pada field lama;
- mengubah endpoint dari sync menjadi async tanpa kompatibilitas;
- mengubah timezone/date format;
- mengubah precision number;
- mengubah null menjadi absent atau sebaliknya jika client membedakan.

### 3.3 Behavioral Breaking Change

Paling berbahaya karena tidak selalu terlihat di OpenAPI.

Contoh:

```text
GET /cases?status=OPEN
```

Dulu mengembalikan semua case open termasuk suspended. Sekarang `SUSPENDED` dikeluarkan dari hasil karena domain policy berubah.

Shape tetap sama, status code tetap `200`, tetapi report, dashboard, dan batch client bisa berubah hasil.

### 3.4 Operational Breaking Change

Contoh:

- timeout dari 60 detik menjadi 5 detik;
- pagination default page size dari 100 menjadi 20;
- rate limit lebih ketat;
- response size lebih besar;
- endpoint menjadi eventually consistent;
- file download berubah dari buffered ke streaming tanpa `Content-Length`;
- compression behavior berubah;
- cache header berubah.

Dalam enterprise system, operational contract sering sama pentingnya dengan JSON contract.

---

## 4. Jersey Versioning Surface

Jersey bisa melakukan versioning di beberapa permukaan.

```text
Jersey Application
  ├─ ResourceConfig / Application
  ├─ Resource class
  ├─ Resource method
  ├─ @Path
  ├─ @Consumes
  ├─ @Produces
  ├─ Provider registry
  ├─ MessageBodyReader/Writer
  ├─ ExceptionMapper
  ├─ Filter / DynamicFeature
  ├─ Injection binding
  └─ Client module
```

Versioning yang matang biasanya bukan satu mekanisme tunggal. Biasanya kombinasi:

```text
Public routing version
  + DTO version
  + error contract version
  + provider strategy
  + deprecation policy
  + usage telemetry
```

---

## 5. URI Versioning

### 5.1 Bentuk Umum

```text
/api/v1/cases
/api/v2/cases
```

Di Jersey:

```java
@Path("/v1/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CaseResourceV1 {
    @GET
    public List<CaseSummaryV1> search() {
        return List.of();
    }
}

@Path("/v2/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CaseResourceV2 {
    @GET
    public List<CaseSummaryV2> search() {
        return List.of();
    }
}
```

Atau pakai package:

```text
com.example.api.v1.caseapi.CaseResource
com.example.api.v2.caseapi.CaseResource
```

### 5.2 Kelebihan

- sangat jelas untuk manusia;
- mudah dites;
- mudah dilihat di log;
- mudah di-route oleh gateway;
- mudah dipisah di dokumentasi;
- mudah dikomunikasikan ke client;
- cocok untuk external API;
- cocok untuk breaking change besar.

### 5.3 Kekurangan

- URL menjadi membawa konsep versi;
- bisa mendorong copy-paste resource class;
- sulit jika hanya satu endpoint yang berubah;
- bisa menciptakan banyak versi hidup sekaligus;
- kadang menyebabkan service layer ikut bercabang jika boundary tidak rapi.

### 5.4 Kapan Cocok

URI versioning cocok ketika:

- API dipakai external/partner;
- breaking change signifikan;
- client tidak bisa update bersamaan;
- dokumentasi perlu jelas;
- API gateway butuh route per versi;
- monitoring per versi penting;
- support/deprecation window panjang.

### 5.5 Kapan Tidak Cocok

Kurang ideal jika:

- perubahan sangat kecil dan additive;
- versi hanya beda response field optional;
- API internal dan semua consumer bisa update bersama;
- kamu belum punya governance sehingga `/v1`, `/v2`, `/v3` akan menjadi copy-paste chaos.

### 5.6 ResourceConfig untuk URI Versioning

Untuk versi besar, kamu bisa tetap satu `ResourceConfig`:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(CaseResourceV1.class);
        register(CaseResourceV2.class);
        register(GlobalExceptionMapper.class);
    }
}
```

Atau explicit package registration:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages(
            "com.example.api.v1",
            "com.example.api.v2"
        );
    }
}
```

Namun untuk production-grade API, explicit registration sering lebih mudah diaudit:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        registerV1();
        registerV2();
        registerSharedProviders();
    }

    private void registerV1() {
        register(com.example.api.v1.CaseResource.class);
        register(com.example.api.v1.DocumentResource.class);
    }

    private void registerV2() {
        register(com.example.api.v2.CaseResource.class);
    }

    private void registerSharedProviders() {
        register(CorrelationIdFilter.class);
        register(ApiExceptionMapper.class);
    }
}
```

---

## 6. Header Versioning

### 6.1 Bentuk Umum

```http
GET /api/cases
X-API-Version: 2
```

Atau:

```http
GET /api/cases
API-Version: 2026-06-01
```

### 6.2 Implementasi Sederhana dengan Resource Method Dispatch Manual

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final CaseApiV1Adapter v1;
    private final CaseApiV2Adapter v2;

    public CaseResource(CaseApiV1Adapter v1, CaseApiV2Adapter v2) {
        this.v1 = v1;
        this.v2 = v2;
    }

    @GET
    public Response search(@HeaderParam("X-API-Version") String version) {
        if (version == null || version.equals("1")) {
            return Response.ok(v1.search()).build();
        }
        if (version.equals("2")) {
            return Response.ok(v2.search()).build();
        }
        throw new NotAcceptableException("Unsupported API version: " + version);
    }
}
```

Ini mudah, tetapi cepat menjadi berantakan jika banyak endpoint.

### 6.3 Implementasi dengan Filter

Filter bisa membaca versi dan menyimpannya sebagai request property.

```java
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class ApiVersionFilter implements ContainerRequestFilter {

    public static final String API_VERSION_PROPERTY = "api.version";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String version = requestContext.getHeaderString("X-API-Version");

        if (version == null || version.isBlank()) {
            version = "1";
        }

        if (!version.equals("1") && !version.equals("2")) {
            throw new NotAcceptableException("Unsupported API version");
        }

        requestContext.setProperty(API_VERSION_PROPERTY, version);
    }
}
```

Lalu resource bisa membaca:

```java
@Context
ContainerRequestContext requestContext;

private String apiVersion() {
    return (String) requestContext.getProperty(ApiVersionFilter.API_VERSION_PROPERTY);
}
```

Namun hati-hati: ini tidak membuat Jersey otomatis memilih method berbeda. Ini hanya memberi context ke kode kamu.

### 6.4 Kelebihan

- URI tetap bersih;
- cocok untuk version berbasis tanggal;
- bisa dipakai gateway/client policy;
- bisa menjaga resource identity tetap sama.

### 6.5 Kekurangan

- kurang visible di browser/log URL;
- caching proxy harus memperhatikan `Vary`;
- dokumentasi bisa kurang jelas;
- debugging lebih sulit;
- method dispatch tidak otomatis berbasis custom header kecuali kamu rancang sendiri;
- bisa menyembunyikan breaking change.

### 6.6 Wajib Pikirkan `Vary`

Jika response berbeda karena header version, response harus memberi sinyal ke cache:

```java
return Response.ok(dto)
    .header("Vary", "X-API-Version")
    .build();
```

Jika tidak, cache/proxy bisa menyajikan response versi 1 ke client versi 2 atau sebaliknya.

---

## 7. Media Type Versioning

### 7.1 Bentuk Umum

```http
Accept: application/vnd.example.case-v2+json
Content-Type: application/vnd.example.case-v2+json
```

Resource Jersey:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Produces("application/vnd.example.case-v1+json")
    public List<CaseSummaryV1> searchV1() {
        return List.of();
    }

    @GET
    @Produces("application/vnd.example.case-v2+json")
    public List<CaseSummaryV2> searchV2() {
        return List.of();
    }
}
```

Jersey/Jakarta REST sudah punya mekanisme method selection berdasarkan `@Produces`, `@Consumes`, `Accept`, dan `Content-Type`. Ini membuat media type versioning terasa “native” terhadap model JAX-RS/Jakarta REST.

### 7.2 Request Body Versioning

Untuk command endpoint:

```java
@Path("/cases")
public class CaseCommandResource {

    @POST
    @Consumes("application/vnd.example.create-case-v1+json")
    @Produces("application/vnd.example.case-v1+json")
    public Response createV1(CreateCaseRequestV1 request) {
        return Response.status(Response.Status.CREATED).build();
    }

    @POST
    @Consumes("application/vnd.example.create-case-v2+json")
    @Produces("application/vnd.example.case-v2+json")
    public Response createV2(CreateCaseRequestV2 request) {
        return Response.status(Response.Status.CREATED).build();
    }
}
```

### 7.3 Kelebihan

- cocok dengan HTTP content negotiation;
- bisa membedakan representation dari resource yang sama;
- Jersey method selection bisa memanfaatkan `@Produces/@Consumes`;
- bagus untuk API yang sangat representation-oriented;
- dapat menjaga URI stabil.

### 7.4 Kekurangan

- lebih sulit untuk client sederhana;
- kurang terlihat di URL;
- custom media type perlu governance;
- dokumentasi harus disiplin;
- gateway/logging harus menangkap Accept/Content-Type;
- sebagian tooling lebih nyaman dengan URI versioning;
- human debugging via browser kurang nyaman.

### 7.5 Media Type Versioning dan Provider

Kamu bisa membuat provider khusus untuk media type tertentu:

```java
@Provider
@Produces("application/vnd.example.case-v2+json")
public class CaseSummaryV2Writer implements MessageBodyWriter<CaseSummaryV2> {
    @Override
    public boolean isWriteable(
            Class<?> type,
            Type genericType,
            Annotation[] annotations,
            MediaType mediaType) {
        return CaseSummaryV2.class.isAssignableFrom(type);
    }

    @Override
    public void writeTo(
            CaseSummaryV2 value,
            Class<?> type,
            Type genericType,
            Annotation[] annotations,
            MediaType mediaType,
            MultivaluedMap<String, Object> httpHeaders,
            OutputStream entityStream) throws IOException {
        // serialize explicitly or delegate to ObjectMapper
    }
}
```

Namun ini jarang perlu untuk JSON biasa. Biasanya cukup DTO berbeda + Jackson/JSON-B provider standar.

### 7.6 `application/json;version=2`

Ada juga pola:

```http
Accept: application/json; version=2
```

Secara HTTP valid, tetapi sering kurang didukung tooling dibanding vendor media type eksplisit. Jika dipilih, pastikan client, gateway, OpenAPI, dan test suite mendukungnya.

---

## 8. Date-Based Versioning

Beberapa API memakai tanggal:

```http
X-API-Version: 2026-06-01
```

Atau:

```text
/api/2026-06-01/cases
```

Ini berguna jika API berubah berdasarkan release date, bukan angka mayor.

Kelebihan:

- jelas kapan kontrak berlaku;
- cocok untuk platform API dengan banyak incremental change;
- migration window bisa berbasis tanggal;
- bisa menghindari debat v2/v3 untuk perubahan kecil.

Kekurangan:

- bisa membingungkan jika terlalu banyak tanggal;
- tidak otomatis menunjukkan breaking severity;
- butuh policy kuat;
- butuh dokumentasi historis.

Untuk enterprise internal, date-based versioning cocok jika tim punya API governance matang. Jika tidak, URI mayor version sering lebih sederhana.

---

## 9. Resource Class Versioning Pattern

### 9.1 Pattern: Versioned Resource, Shared Service

```text
/api/v1/cases  → CaseResourceV1 → CaseApplicationService → Domain
/api/v2/cases  → CaseResourceV2 → CaseApplicationService → Domain
```

Resource dan DTO berbeda, service domain sama.

```java
@Path("/v1/cases")
public class CaseResourceV1 {
    private final CaseApplicationService service;
    private final CaseMapperV1 mapper;

    @GET
    public List<CaseSummaryV1> search() {
        return service.searchCases().stream()
            .map(mapper::toSummary)
            .toList();
    }
}

@Path("/v2/cases")
public class CaseResourceV2 {
    private final CaseApplicationService service;
    private final CaseMapperV2 mapper;

    @GET
    public CaseSearchResponseV2 search() {
        List<CaseRecord> cases = service.searchCases();
        return mapper.toSearchResponse(cases);
    }
}
```

Ini pattern yang sering paling sehat.

Kenapa?

- API boundary boleh berubah;
- domain model tidak perlu ikut versioned;
- service layer tetap reusable;
- mapping layer menahan perbedaan kontrak;
- migration lebih terkendali.

### 9.2 Anti-Pattern: Versioned Domain

```text
CaseV1Entity
CaseV2Entity
CaseV3Entity
```

Hindari jika perbedaan hanya API representation. Domain boleh berubah karena domain evolution, bukan karena API versioning.

### 9.3 Anti-Pattern: One Resource with Massive `if version`

```java
@GET
public Response search(@HeaderParam("X-API-Version") String version) {
    if (version.equals("1")) {
        // v1 query, v1 validation, v1 mapping, v1 error
    } else if (version.equals("2")) {
        // v2 query, v2 validation, v2 mapping, v2 error
    } else if (version.equals("3")) {
        // more branches
    }
}
```

Ini biasanya menjadi sulit dites, sulit dibaca, dan rawan salah mapping.

Gunakan branch kecil hanya untuk perubahan kecil. Untuk breaking besar, pisahkan resource/adapter.

---

## 10. DTO Versioning

### 10.1 Jangan Pakai Entity sebagai API DTO

Jika entity langsung jadi response:

```java
@GET
public CaseEntity getCase() {
    return repository.findById(id);
}
```

Maka schema database, lazy loading, field internal, dan API contract bercampur.

Untuk versioning, ini buruk karena perubahan entity bisa breaking API.

Lebih baik:

```java
public record CaseSummaryV1(
    String id,
    String status,
    String applicantName
) {}

public record CaseSummaryV2(
    String id,
    String status,
    String applicantName,
    String riskLevel,
    Instant lastActionAt
) {}
```

### 10.2 Additive Field Strategy

Menambah field response biasanya aman jika:

- field optional;
- client tolerant terhadap unknown field;
- field tidak mengubah semantic field lama;
- dokumentasi jelas;
- contract test memastikan field lama tetap ada.

```java
public record CaseSummaryV2(
    String id,
    String status,
    String applicantName,
    String riskLevel // new field
) {}
```

### 10.3 Null vs Absent

Ini sering dianggap detail kecil, padahal kontrak penting.

```json
{
  "riskLevel": null
}
```

Berbeda dengan:

```json
{
  "id": "C-001",
  "status": "OPEN"
}
```

Pertanyaan desain:

- Apakah `null` berarti unknown?
- Apakah absent berarti tidak didukung versi ini?
- Apakah absent berarti tidak punya permission?
- Apakah absent berarti tidak applicable?

Untuk API eksternal, lebih baik eksplisit dalam kontrak.

Contoh:

```json
{
  "riskLevel": null,
  "riskLevelReason": "NOT_ASSESSED"
}
```

Atau:

```json
{
  "riskAssessment": {
    "available": false,
    "reason": "NOT_ASSESSED"
  }
}
```

### 10.4 Request DTO Versioning

Request lebih sensitif daripada response.

Menambah optional field request bisa aman. Menambah required field request ke versi lama hampir pasti breaking.

Buruk:

```java
public record CreateCaseRequestV1(
    @NotBlank String applicantName,
    @NotBlank String caseType,
    @NotBlank String riskCategory // added later as required
) {}
```

Lebih aman:

```java
public record CreateCaseRequestV2(
    @NotBlank String applicantName,
    @NotBlank String caseType,
    @NotBlank String riskCategory
) {}
```

Lalu v1 tetap diberi default/domain inference jika masih didukung:

```java
public CreateCaseCommand toCommand(CreateCaseRequestV1 request) {
    return new CreateCaseCommand(
        request.applicantName(),
        request.caseType(),
        RiskCategory.UNSPECIFIED
    );
}
```

---

## 11. Enum Evolution

Enum sangat berbahaya untuk compatibility.

### 11.1 Response Enum

Jika v1 response:

```json
{
  "status": "OPEN"
}
```

Lalu kamu menambah:

```json
{
  "status": "SUSPENDED"
}
```

Client lama mungkin gagal jika enum strict:

```java
enum CaseStatus {
    OPEN,
    CLOSED
}
```

### 11.2 Strategi Aman

Untuk external API:

- dokumentasikan bahwa enum bisa bertambah;
- client harus handle unknown value;
- pertimbangkan fallback field;
- gunakan status category jika perlu.

Contoh response lebih evolvable:

```json
{
  "status": "SUSPENDED",
  "statusCategory": "OPEN_LIKE"
}
```

Client lama bisa memakai `statusCategory` untuk behavior umum.

### 11.3 Jangan Mengganti Meaning Enum Lama

Mengganti meaning `APPROVED` lebih berbahaya daripada menambah `PENDING_LEGAL_REVIEW`.

Jika meaning berubah, buat value baru.

Buruk:

```text
APPROVED dulu final approval
APPROVED sekarang preliminary approval
```

Lebih baik:

```text
PRELIMINARY_APPROVED
FINAL_APPROVED
```

---

## 12. Error Contract Versioning

Error sering dilupakan.

Padahal client banyak bergantung pada:

- status code;
- error code;
- field path;
- message;
- retryable flag;
- validation detail;
- correlation ID;
- business error category.

### 12.1 Stable Error Shape

Contoh:

```java
public record ApiError(
    String code,
    String message,
    String correlationId,
    List<ApiErrorDetail> details
) {}

public record ApiErrorDetail(
    String field,
    String code,
    String message
) {}
```

Jangan sembarangan ubah menjadi:

```json
{
  "error": {
    "reason": "..."
  }
}
```

jika client lama membaca `code` di root.

### 12.2 Versioned Exception Mapper

Jika v1 dan v2 punya error shape berbeda, kamu perlu strategi.

#### Opsi A — Satu Mapper, Bentuk Error Berdasarkan Version Context

```java
@Provider
public class ApiExceptionMapper implements ExceptionMapper<DomainException> {

    @Context
    ContainerRequestContext requestContext;

    @Override
    public Response toResponse(DomainException exception) {
        String version = (String) requestContext.getProperty("api.version");

        if ("2".equals(version)) {
            return Response.status(409)
                .entity(toV2Error(exception))
                .type(MediaType.APPLICATION_JSON)
                .build();
        }

        return Response.status(409)
            .entity(toV1Error(exception))
            .type(MediaType.APPLICATION_JSON)
            .build();
    }
}
```

#### Opsi B — Pisah Application per Major Version

```text
/api/v1/* → ResourceConfigV1 → ExceptionMapperV1
/api/v2/* → ResourceConfigV2 → ExceptionMapperV2
```

Ini lebih bersih, tetapi deployment/config lebih kompleks.

#### Opsi C — Pertahankan Error Contract Selama Mungkin

Ini sering paling praktis: jangan version error shape kecuali benar-benar perlu.

### 12.3 Error Code Harus Stabil

Jangan ubah:

```text
CASE_ALREADY_ASSIGNED
```

menjadi:

```text
CASE_CONFLICT
```

jika client memakai code lama untuk behavior.

Lebih baik tambahkan category:

```json
{
  "code": "CASE_ALREADY_ASSIGNED",
  "category": "CONFLICT",
  "message": "Case is already assigned.",
  "correlationId": "..."
}
```

---

## 13. Status Code Compatibility

Mengubah status code juga bisa breaking.

Contoh:

```text
v1: duplicate submit returns 400
v2: duplicate submit returns 409
```

Secara HTTP, `409 Conflict` mungkin lebih benar. Tetapi client lama mungkin hanya menangani `400`.

Strategi:

- untuk v1, pertahankan `400`;
- untuk v2, gunakan `409`;
- atau tambah error code stabil agar client tidak hanya bergantung pada status code.

```java
if (apiVersion.equals("1")) {
    return Response.status(400).entity(error).build();
}
return Response.status(409).entity(error).build();
```

Namun jangan terlalu sering membuat semantic berbeda antar versi karena support cost naik.

---

## 14. Provider per Version

Kadang versi membutuhkan serialization behavior berbeda.

Contoh:

- v1 tanggal sebagai string `yyyy-MM-dd HH:mm:ss`;
- v2 tanggal sebagai ISO-8601 `Instant`;
- v1 enum uppercase;
- v2 enum object;
- v1 field null tetap ditampilkan;
- v2 null field dihilangkan.

### 14.1 Pisahkan DTO Lebih Baik daripada Provider Aneh

Lebih sehat:

```java
public record CaseV1(String createdAt) {}
public record CaseV2(Instant createdAt) {}
```

Daripada satu DTO dengan serializer branching.

### 14.2 Custom ObjectMapper per Version

Jika memang perlu:

```java
@Provider
@Produces("application/vnd.example.v1+json")
@Consumes("application/vnd.example.v1+json")
public class ObjectMapperProviderV1 implements ContextResolver<ObjectMapper> {
    private final ObjectMapper mapper;

    public ObjectMapperProviderV1() {
        this.mapper = new ObjectMapper();
        this.mapper.findAndRegisterModules();
        // configure v1 legacy behavior
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

Untuk v2:

```java
@Provider
@Produces("application/vnd.example.v2+json")
@Consumes("application/vnd.example.v2+json")
public class ObjectMapperProviderV2 implements ContextResolver<ObjectMapper> {
    private final ObjectMapper mapper;

    public ObjectMapperProviderV2() {
        this.mapper = new ObjectMapper();
        this.mapper.findAndRegisterModules();
        // configure v2 modern behavior
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

Tetapi hati-hati: provider selection berdasarkan media type dan type harus benar-benar dites.

### 14.3 Jangan Terlalu Banyak Serialization Policy

Semakin banyak provider per versi, semakin sulit debugging.

Rule praktis:

```text
Prefer versioned DTO.
Use versioned provider only when representation rules truly differ globally.
```

---

## 15. Versioned Mapping Layer

Mapping layer adalah tempat paling sehat untuk menahan perbedaan API.

```text
Domain model
  ↓
V1 mapper → V1 DTO
V2 mapper → V2 DTO
```

Contoh:

```java
public class CaseMapperV1 {
    public CaseSummaryV1 toSummary(CaseRecord caseRecord) {
        return new CaseSummaryV1(
            caseRecord.id().value(),
            caseRecord.status().name(),
            caseRecord.applicant().displayName()
        );
    }
}

public class CaseMapperV2 {
    public CaseSummaryV2 toSummary(CaseRecord caseRecord) {
        return new CaseSummaryV2(
            caseRecord.id().value(),
            mapStatus(caseRecord.status()),
            caseRecord.applicant().displayName(),
            caseRecord.riskProfile().level().name(),
            caseRecord.lastActionAt()
        );
    }
}
```

Mapping layer harus eksplisit. Jangan biarkan Jackson/MapStruct/lazy entity otomatis menentukan kontrak API tanpa governance.

---

## 16. Command Versioning: Create/Update/Patch Lebih Sulit daripada GET

GET response evolution relatif mudah. Command endpoint lebih sulit karena punya side effect.

### 16.1 Create Request

v1:

```json
{
  "applicantName": "Alice",
  "caseType": "LICENSE"
}
```

v2:

```json
{
  "applicantName": "Alice",
  "caseType": "LICENSE",
  "riskCategory": "LOW"
}
```

Jika `riskCategory` wajib di domain baru, v1 masih perlu strategi:

- default ke `UNASSESSED`;
- infer dari rule lama;
- reject v1 setelah deprecation deadline;
- migrasi client;
- buat `/v2` required.

### 16.2 PUT Compatibility

PUT biasanya berarti replace representation. Jika representation berubah, compatibility lebih tricky.

Jika v1 client melakukan PUT tanpa field baru, apakah field baru hilang?

Contoh v2 resource punya `riskCategory`. v1 PUT tidak tahu field itu.

Risiko:

```text
v2 state has riskCategory=HIGH
v1 client sends PUT old shape
server replaces entire resource
riskCategory becomes null/default accidentally
```

Strategi:

- jangan pakai full PUT untuk resource yang banyak berubah;
- gunakan PATCH dengan explicit operation semantics;
- bagi endpoint command spesifik;
- untuk v1 PUT, preserve fields yang tidak dikenal v1;
- dokumentasikan replace semantics secara jelas.

### 16.3 PATCH Compatibility

PATCH lebih kompleks karena partial update.

Pertanyaan:

- Apakah absent berarti tidak berubah?
- Apakah null berarti clear value?
- Apakah client boleh patch field baru?
- Apakah field patchable berbeda per versi?
- Apakah patch operation idempotent?

Contoh DTO:

```java
public record PatchCaseRequestV2(
    OptionalField<String> applicantName,
    OptionalField<String> riskCategory
) {}
```

Jangan gunakan `Optional<T>` secara sembarangan untuk JSON DTO jika provider behavior tidak jelas. Kadang lebih baik membuat wrapper eksplisit.

```java
public final class OptionalField<T> {
    private final boolean present;
    private final T value;

    private OptionalField(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> OptionalField<T> absent() {
        return new OptionalField<>(false, null);
    }

    public static <T> OptionalField<T> of(T value) {
        return new OptionalField<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    public T value() {
        return value;
    }
}
```

---

## 17. Pagination, Sorting, and Filtering Compatibility

Pagination adalah kontrak.

### 17.1 Page Number vs Cursor

v1:

```text
GET /cases?page=1&size=20
```

v2:

```text
GET /cases?cursor=eyJpZCI6...
```

Ini breaking karena client logic berubah.

Strategi:

- buat endpoint v2;
- atau tambahkan cursor sebagai optional tanpa mematikan page number;
- pertahankan default sort v1;
- dokumentasikan consistency.

### 17.2 Default Sort Change

Mengubah default sort bisa breaking.

```text
v1 default: createdAt desc
v2 default: priority desc, createdAt desc
```

Client yang mengambil page pertama akan melihat hasil berbeda.

Lebih baik:

- jangan ubah default sort versi lama;
- tambah parameter explicit;
- buat v2 jika default baru harus berlaku.

### 17.3 Filter Meaning Change

```text
GET /cases?status=ACTIVE
```

Jika meaning `ACTIVE` berubah, itu breaking semantic.

Lebih baik:

- tambah filter baru;
- tambah enum value baru;
- buat status category;
- dokumentasikan mapping.

---

## 18. Authorization Compatibility

Authorization juga bagian dari kontrak.

Contoh:

```text
v1: officer can view all assigned cases
v2: officer can view only assigned cases in same branch
```

Secara security mungkin benar, tetapi client behavior berubah. Jika perubahan karena security fix, mungkin harus dilakukan tanpa versioning. Namun tetap butuh:

- release note;
- incident/exception handling;
- error code stabil;
- observability;
- support readiness.

Jangan menganggap semua authorization change bisa “disembunyikan” sebagai non-breaking. Untuk client, bisa jadi breaking.

---

## 19. Idempotency Compatibility

Jika endpoint command berubah idempotency behavior, client bisa rusak.

Contoh:

```text
POST /cases/{id}/submit
```

v1:

```text
Second submit returns 200 with current state
```

v2:

```text
Second submit returns 409 CASE_ALREADY_SUBMITTED
```

Ini breaking untuk client yang retry ketika network timeout.

Strategi:

- gunakan idempotency key;
- pertahankan old behavior pada v1;
- dokumentasikan retry behavior;
- pisahkan command semantics baru ke v2.

---

## 20. Versioning with Sub-Resource Locators

Sub-resource locator bisa membantu modularisasi versi.

```java
@Path("/api")
public class ApiRootResource {

    private final CaseResourceV1 caseV1;
    private final CaseResourceV2 caseV2;

    @Path("/v1/cases")
    public CaseResourceV1 casesV1() {
        return caseV1;
    }

    @Path("/v2/cases")
    public CaseResourceV2 casesV2() {
        return caseV2;
    }
}
```

Namun jangan over-engineer. ResourceConfig explicit registration biasanya cukup.

Sub-resource locator cocok ketika:

- ada root context bersama;
- resource tree dinamis;
- version module disusun sebagai object graph;
- multi-tenant/organization context dipilih lebih dulu.

---

## 21. Versioning with Separate Applications

Kadang versi besar layak dipisah sebagai aplikasi Jersey berbeda.

```text
/v1/* → ApiV1Application
/v2/* → ApiV2Application
```

Contoh servlet mapping:

```xml
<servlet>
    <servlet-name>api-v1</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.ApiV1Application</param-value>
    </init-param>
</servlet>

<servlet-mapping>
    <servlet-name>api-v1</servlet-name>
    <url-pattern>/api/v1/*</url-pattern>
</servlet-mapping>
```

Programmatic config bisa berbeda tergantung container.

Kelebihan:

- provider/mappers/filter terpisah;
- dependency graph lebih jelas;
- migration besar lebih aman;
- v1 bisa freeze.

Kekurangan:

- lebih banyak config;
- cross-version shared code harus hati-hati;
- deployment/test lebih berat;
- observability perlu konsisten.

---

## 22. Versioning with Feature Modules

Buat `Feature` untuk mendaftarkan versi.

```java
public class ApiV1Feature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CaseResourceV1.class);
        context.register(DocumentResourceV1.class);
        context.register(ApiV1ExceptionMapper.class);
        return true;
    }
}

public class ApiV2Feature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CaseResourceV2.class);
        context.register(DocumentResourceV2.class);
        context.register(ApiV2ExceptionMapper.class);
        return true;
    }
}
```

Lalu:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(new ApiV1Feature());
        register(new ApiV2Feature());
        register(SharedPlatformFeature.class);
    }
}
```

Ini bagus untuk platform internal jika setiap versi punya modul yang bisa di-enable/disable.

---

## 23. Deprecation Strategy

Versioning tanpa deprecation policy akan menciptakan kuburan versi lama.

### 23.1 Lifecycle

```text
Active
  ↓
Deprecated
  ↓
Sunset announced
  ↓
Read-only / restricted
  ↓
Removed
```

### 23.2 Header Deprecation

Kamu bisa menambahkan header:

```java
@Provider
public class DeprecationHeaderFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        String path = request.getUriInfo().getPath();

        if (path.startsWith("v1/")) {
            response.getHeaders().putSingle("Deprecation", "true");
            response.getHeaders().putSingle("Sunset", "Wed, 31 Dec 2027 23:59:59 GMT");
            response.getHeaders().putSingle("Link", "</api/v2/docs>; rel=\"successor-version\"");
        }
    }
}
```

Header saja tidak cukup. Butuh komunikasi, telemetry, dashboard usage, dan migration guide.

### 23.3 Deprecation Message Jangan Mengubah Body

Jangan tiba-tiba menambahkan warning ke body response jika client strict.

Buruk:

```json
{
  "warning": "v1 deprecated",
  "data": [...]
}
```

Jika sebelumnya body adalah array:

```json
[
  { "id": "C-001" }
]
```

itu breaking.

Gunakan header untuk metadata deprecation.

---

## 24. Observability per Version

Tidak mungkin menghapus v1 dengan aman jika kamu tidak tahu siapa yang masih memakainya.

Minimal tag metrics:

```text
api.version
resource
method
status
client.id
consumer.system
error.code
```

Filter:

```java
@Provider
public class ApiVersionTelemetryFilter implements ContainerRequestFilter, ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext request) {
        String version = extractVersion(request);
        request.setProperty("api.version", version);
    }

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        String version = (String) request.getProperty("api.version");
        String clientId = request.getHeaderString("X-Client-Id");

        // metrics.counter("http.server.requests", tags...).increment();
        // logging MDC / OpenTelemetry attributes can be set elsewhere.
    }

    private String extractVersion(ContainerRequestContext request) {
        String path = request.getUriInfo().getPath();
        if (path.startsWith("v2/")) {
            return "2";
        }
        if (path.startsWith("v1/")) {
            return "1";
        }
        return "unknown";
    }
}
```

Untuk deprecation, dashboard penting:

```text
v1 requests per day by client
v1 error rate by client
v1 endpoint usage
v1 last seen timestamp
v1 deprecated endpoint still used by batch job
```

---

## 25. Contract Testing for Version Compatibility

### 25.1 Golden Contract Tests

Simpan sample request/response per versi.

```text
contracts/
  v1/
    create-case-request.json
    create-case-response.json
    validation-error-response.json
  v2/
    create-case-request.json
    create-case-response.json
    validation-error-response.json
```

Test:

```java
@Test
void v1SearchResponseShouldRemainBackwardCompatible() {
    Response response = target("/v1/cases")
        .request(MediaType.APPLICATION_JSON)
        .get();

    assertEquals(200, response.getStatus());

    String json = response.readEntity(String.class);
    assertThat(json).contains("applicantName");
    assertThat(json).contains("status");
}
```

Lebih baik gunakan JSON assertion yang tidak rapuh terhadap ordering.

### 25.2 Strict Contract Test untuk Breaking Detection

Contoh dengan JSON schema atau snapshot.

Namun hati-hati: snapshot terlalu strict bisa menghambat additive change.

Strategi:

```text
For compatibility tests:
  assert required old fields still exist
  assert old field type unchanged
  assert old status code unchanged
  assert old error code unchanged
  allow additive fields when policy allows
```

### 25.3 Consumer-Driven Contract

Jika banyak consumer, consumer-driven contract membantu.

Model:

```text
consumer defines expectation
provider verifies expectation in CI
breaking changes caught before release
```

Untuk Jersey, contract test harus menjalankan Jersey runtime, bukan hanya unit mapper, supaya `@Produces`, mapper, filter, exception mapper, validation, dan provider ikut diuji.

---

## 26. OpenAPI Strategy

Setiap versi sebaiknya punya OpenAPI spec yang jelas.

```text
openapi-v1.yaml
openapi-v2.yaml
```

Atau satu spec dengan versioned path:

```yaml
paths:
  /api/v1/cases:
    get: ...
  /api/v2/cases:
    get: ...
```

Untuk external API, pisah spec per major version sering lebih mudah.

OpenAPI bukan sumber kebenaran tunggal jika implementasi tidak dites. Gunakan:

```text
Jersey runtime tests
  + OpenAPI validation
  + contract samples
  + compatibility checklist
```

---

## 27. API Gateway and Versioning

Jika ada gateway, versioning bisa terjadi di gateway dan Jersey.

```text
Client
  ↓
API Gateway
  ↓ route /api/v1/*
Jersey app
```

Gateway bisa menangani:

- routing versi;
- auth policy;
- rate limit per versi;
- deprecation warning;
- traffic shadowing;
- canary release;
- header normalization;
- request size limit.

Namun jangan meletakkan semantic API versioning hanya di gateway jika Jersey app tetap tidak sadar versi. App tetap perlu tahu versi untuk:

- DTO mapping;
- error contract;
- metrics;
- behavior differences;
- support logs;
- audit.

---

## 28. Backward Compatibility Rules Praktis

Gunakan aturan berikut sebagai baseline.

### 28.1 Biasanya Compatible

```text
Add optional response field
Add optional request field with safe default
Add new endpoint
Add new optional query parameter
Add new response header
Increase max page size if old behavior still works
Add new error detail while preserving old fields
Add new link relation
```

### 28.2 Biasanya Breaking

```text
Remove response field
Rename field
Change field type
Change field format
Change date/time format
Change number precision
Change enum meaning
Remove enum value
Add required request field
Make optional field required
Change default sort
Change pagination model
Change status code expected by clients
Change error code
Change error body shape
Tighten validation on existing accepted values
Change authorization visibility
Change idempotency/retry behavior
Change consistency guarantee
```

### 28.3 Depends, Analyze Carefully

```text
Add enum value
Add validation rule for previously accepted bad data
Change null to absent
Change absent to null
Change 200 empty list to 204
Change 404 to 403 for security
Change synchronous operation to 202 async
Change response order
Change cache header
Change rate limit
```

---

## 29. Java 8–25 Considerations

### 29.1 Java 8

Java 8 legacy Jersey systems often use:

```text
Jersey 2.x
javax.ws.rs
Servlet 3.x/4.x
Jackson older versions
non-record DTO classes
```

Compatibility challenges:

- no records;
- weaker date/time defaults if using old Jackson config;
- older TLS/runtime behavior;
- more legacy clients;
- `javax` namespace.

DTO style:

```java
public class CaseSummaryV1 {
    private String id;
    private String status;
    private String applicantName;

    public CaseSummaryV1() {
    }

    public CaseSummaryV1(String id, String status, String applicantName) {
        this.id = id;
        this.status = status;
        this.applicantName = applicantName;
    }

    public String getId() { return id; }
    public String getStatus() { return status; }
    public String getApplicantName() { return applicantName; }
}
```

### 29.2 Java 17+

Java 17+ lets you use records more naturally:

```java
public record CaseSummaryV2(
    String id,
    String status,
    String applicantName,
    Instant lastActionAt
) {}
```

But records make constructor shape explicit. Adding a record component changes constructor and may affect internal code/tests, although JSON response compatibility depends on serialized fields.

### 29.3 Java 21/25

Modern Java improves runtime ergonomics, but API compatibility remains a contract problem.

Virtual threads do not solve versioning. Pattern matching does not solve contract governance. Better runtime does not excuse unstable API design.

Java 21/25 consideration:

- records are mature;
- sealed interfaces can model internal domain states;
- do not leak sealed hierarchy directly as public JSON unless contract is controlled;
- use `Instant`, `OffsetDateTime`, or explicit date format consistently;
- ensure Jackson/JSON-B provider supports chosen language features;
- watch module path and reflective serialization configuration.

---

## 30. Jersey 2.x vs 3.x vs 4.x Versioning Considerations

### 30.1 Jersey 2.x

Typical:

```text
javax.ws.rs.*
JAX-RS 2.x era
Java 8 compatible deployments common
```

If API versioning is being added to Jersey 2.x legacy app, keep versioning architecture independent from `javax` namespace so migration to Jakarta later is easier.

### 30.2 Jersey 3.x

Typical:

```text
jakarta.ws.rs.*
Jakarta REST 3.x
Jakarta EE 9/10 era
```

Migration from v1 `javax` application to v2 `jakarta` application can accidentally become both API versioning and platform migration. Do not conflate them.

### 30.3 Jersey 4.x

Typical:

```text
Jakarta REST 4.0
Jakarta EE 11 alignment
Java 17+ baseline in Jakarta REST 4.0 ecosystem
```

When moving to Jersey 4/Jakarta REST 4, separate concerns:

```text
Platform migration:
  javax → jakarta
  dependency alignment
  Java baseline

API contract migration:
  /v1 → /v2
  DTO/error behavior
  consumer migration
```

Do not force client-visible API version bump purely because package namespace changed internally, unless behavior/contract changes.

---

## 31. Versioning Decision Framework

Gunakan decision tree ini.

```text
Does the change affect existing client-visible contract?
  ├─ no
  │   └─ internal refactor, no API version needed
  │
  └─ yes
      ↓
Is it additive and tolerant by existing clients?
  ├─ yes
  │   └─ no major version; update docs/tests
  │
  └─ no / unsure
      ↓
Can old behavior be preserved behind same endpoint?
  ├─ yes
  │   └─ preserve old behavior; maybe feature flag/header only internally
  │
  └─ no
      ↓
Is this external or long-lived API?
  ├─ yes
  │   └─ create explicit version + deprecation/migration plan
  │
  └─ no
      ↓
Can all consumers migrate atomically?
  ├─ yes
  │   └─ coordinated breaking change may be acceptable
  │
  └─ no
      └─ create explicit version
```

---

## 32. Recommended Strategy for Enterprise Jersey APIs

Untuk kebanyakan enterprise Jersey API, strategi paling praktis:

```text
1. URI major version for breaking external contract
2. Versioned DTOs
3. Shared service/domain layer
4. Explicit mapper per version
5. Stable error contract for as long as possible
6. Header/media type versioning only when justified
7. Deprecation headers + migration guide
8. Metrics by api.version and client.id
9. Contract tests per version
10. Freeze old versions except critical fixes
```

Struktur package:

```text
com.example.api
  platform
    CorrelationIdFilter
    ApiExceptionMapper
    SecurityContextFilter
    JsonFeature
  v1
    CaseResourceV1
    CaseDtoV1
    CaseMapperV1
  v2
    CaseResourceV2
    CaseDtoV2
    CaseMapperV2
  application
    CaseApplicationService
  domain
    Case
    CaseStatus
```

Atau:

```text
com.example.caseapi
  resource
    v1
    v2
  dto
    v1
    v2
  mapper
    v1
    v2
  service
  domain
```

Yang penting: versioning berada di boundary, bukan menyebar acak ke seluruh domain.

---

## 33. Worked Example: Case Search v1 to v2

### 33.1 Requirement Baru

v1:

```http
GET /api/v1/cases
```

Response:

```json
[
  {
    "id": "C-001",
    "status": "OPEN",
    "applicantName": "Alice"
  }
]
```

Requirement baru:

- response harus berisi `riskLevel`;
- response harus berisi `lastActionAt` ISO timestamp;
- pagination metadata harus ditambahkan;
- default sort berubah ke priority desc;
- client lama tidak boleh rusak.

### 33.2 Analisis Compatibility

```text
Add riskLevel            → maybe compatible if added to same object
Add lastActionAt         → maybe compatible
Add pagination wrapper   → breaking, array berubah jadi object
Change default sort      → behavioral breaking
```

Maka v2 diperlukan.

### 33.3 v1 DTO

```java
public record CaseSummaryV1(
    String id,
    String status,
    String applicantName
) {}
```

### 33.4 v2 DTO

```java
public record CaseSearchResponseV2(
    List<CaseSummaryV2> items,
    PageMetaV2 page
) {}

public record CaseSummaryV2(
    String id,
    String status,
    String applicantName,
    String riskLevel,
    Instant lastActionAt
) {}

public record PageMetaV2(
    int page,
    int size,
    long totalElements,
    int totalPages
) {}
```

### 33.5 Resources

```java
@Path("/api/v1/cases")
@Produces(MediaType.APPLICATION_JSON)
public class CaseResourceV1 {

    private final CaseApplicationService service;
    private final CaseMapperV1 mapper;

    @GET
    public List<CaseSummaryV1> search(
            @QueryParam("page") @DefaultValue("1") int page,
            @QueryParam("size") @DefaultValue("20") int size) {

        CaseSearchResult result = service.search(new CaseSearchCommand(
            page,
            size,
            SortPolicy.CREATED_AT_DESC
        ));

        return result.items().stream()
            .map(mapper::toSummary)
            .toList();
    }
}
```

```java
@Path("/api/v2/cases")
@Produces(MediaType.APPLICATION_JSON)
public class CaseResourceV2 {

    private final CaseApplicationService service;
    private final CaseMapperV2 mapper;

    @GET
    public CaseSearchResponseV2 search(
            @QueryParam("page") @DefaultValue("1") int page,
            @QueryParam("size") @DefaultValue("20") int size) {

        CaseSearchResult result = service.search(new CaseSearchCommand(
            page,
            size,
            SortPolicy.PRIORITY_DESC_THEN_CREATED_AT_DESC
        ));

        return mapper.toResponse(result);
    }
}
```

### 33.6 Key Point

Service sama. API adapter berbeda.

```text
v1 resource controls v1 contract
v2 resource controls v2 contract
application service controls use case
mapper controls representation
```

---

## 34. Worked Example: Error Contract v1 to v2

v1 error:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Invalid request",
  "fields": {
    "applicantName": "must not be blank"
  }
}
```

v2 error:

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "correlationId": "01HX...",
  "violations": [
    {
      "field": "applicantName",
      "code": "NOT_BLANK",
      "message": "must not be blank"
    }
  ]
}
```

Jika v2 memakai Problem Details-like shape, jangan ubah v1 mapper.

Pattern:

```java
public interface ErrorPresenter {
    Response validationFailed(ValidationFailure failure);
}

public class ErrorPresenterV1 implements ErrorPresenter {
    @Override
    public Response validationFailed(ValidationFailure failure) {
        return Response.status(400)
            .entity(toV1(failure))
            .build();
    }
}

public class ErrorPresenterV2 implements ErrorPresenter {
    @Override
    public Response validationFailed(ValidationFailure failure) {
        return Response.status(400)
            .entity(toV2(failure))
            .build();
    }
}
```

Resource/application chooses based on version boundary.

---

## 35. Testing Matrix

Untuk setiap versi aktif:

```text
Routing
  - /api/v1/cases routes to v1 resource
  - /api/v2/cases routes to v2 resource

Media negotiation
  - v1 Accept works
  - v2 Accept works
  - unsupported Accept returns 406
  - unsupported Content-Type returns 415

Response contract
  - required fields present
  - old field types unchanged
  - error shape stable

Behavior
  - default sort unchanged in v1
  - pagination unchanged in v1
  - status code unchanged in v1

Observability
  - api.version tag present
  - client.id captured
  - deprecation header emitted for v1

Security
  - authorization behavior expected per version
  - no data leak from new fields into v1
```

---

## 36. Common Failure Modes

### 36.1 Copy-Paste Versioning

v2 resource copied from v1, then both diverge unpredictably.

Mitigation:

```text
Keep resource thin.
Share application service.
Separate mapper.
Test both versions.
```

### 36.2 Hidden Breaking Change

Developer adds field, changes default sort, or tightens validation without version analysis.

Mitigation:

```text
API compatibility checklist in PR.
Contract tests.
OpenAPI diff.
Consumer review.
```

### 36.3 Error Contract Drift

Exception mapper changed globally and breaks v1.

Mitigation:

```text
Error contract tests per version.
Do not change global mapper blindly.
```

### 36.4 Provider Conflict

Custom provider for v2 accidentally applies to v1.

Mitigation:

```text
Constrain @Produces/@Consumes.
Test provider selection.
Avoid global ObjectMapper behavior changes.
```

### 36.5 No Telemetry

Team wants to remove v1 but cannot prove usage.

Mitigation:

```text
Version/client metrics from day one.
Deprecation dashboard.
```

### 36.6 Domain Versioning Leak

API versions infect domain model.

Mitigation:

```text
Version DTOs and mappers, not domain unless domain truly changed.
```

### 36.7 Header Versioning with Broken Cache

Different versions served from same URI but missing `Vary` header.

Mitigation:

```text
Add Vary: X-API-Version or Vary: Accept.
Test cache behavior.
```

---

## 37. Production Checklist

Sebelum merilis versi API baru:

```text
[ ] Change classified as compatible/breaking/behavioral/operational
[ ] Versioning strategy selected deliberately
[ ] v1 contract remains tested
[ ] v2 contract tested
[ ] DTOs separated per major version
[ ] Mapping layer explicit
[ ] Error shape reviewed
[ ] Status code behavior reviewed
[ ] Validation changes reviewed
[ ] Authorization changes reviewed
[ ] Idempotency/retry behavior reviewed
[ ] Pagination/sorting/filtering reviewed
[ ] Media type and Content-Type behavior tested
[ ] OpenAPI updated
[ ] Deprecation plan defined if old version will be retired
[ ] Metrics include api.version
[ ] Logs include api.version and client identity if allowed
[ ] Gateway route/config aligned
[ ] Documentation and migration guide published
[ ] Support team knows expected errors and timeline
```

---

## 38. Design Heuristics

### 38.1 Prefer Additive Evolution

Jika bisa menambah tanpa merusak, lakukan itu.

### 38.2 Version Boundary Harus Dekat API Boundary

Resource, DTO, mapper, error presenter adalah tempat natural untuk versioning.

### 38.3 Jangan Version Semua Hal

Tidak semua perubahan butuh `/v2`.

### 38.4 Jangan Hindari Versioning Saat Breaking

Jika breaking, akui. Jangan sembunyikan di header internal atau feature flag tanpa governance.

### 38.5 Freeze Old Versions

Setelah v2 ada, v1 sebaiknya hanya menerima:

- security fix;
- critical bug fix;
- compatibility-preserving fix;
- deprecation header;
- observability improvement.

### 38.6 Buat Migration Path, Bukan Sekadar Endpoint Baru

Client perlu tahu:

- apa yang berubah;
- kenapa berubah;
- kapan v1 berhenti;
- bagaimana mapping v1 ke v2;
- error baru apa yang muncul;
- behavior retry/idempotency berubah atau tidak.

---

## 39. Mini Exercise

### Exercise 1

Sebuah endpoint v1:

```text
GET /api/v1/applications?status=PENDING
```

mengembalikan array aplikasi berdasarkan `createdAt desc`.

Requirement baru:

- response harus wrapped dalam object dengan `items` dan `total`;
- default sort harus `priority desc`;
- enum status baru `PENDING_SUPERVISOR_REVIEW` ditambahkan;
- field `assignedOfficerName` ditambahkan.

Pertanyaan:

1. Mana yang compatible?
2. Mana yang breaking?
3. Apakah butuh v2?
4. Bagaimana resource dan DTO sebaiknya dipisah?

### Exercise 2

Endpoint command:

```text
POST /api/v1/cases/{id}/submit
```

Dulu second submit mengembalikan `200`. Sekarang product owner ingin second submit mengembalikan `409`.

Pertanyaan:

1. Apakah ini breaking?
2. Bagaimana dampaknya terhadap retry?
3. Apakah harus v2?
4. Bagaimana error code dibuat stabil?

### Exercise 3

API kamu memakai header:

```http
X-API-Version: 2
```

Response v1 dan v2 berbeda untuk URI yang sama.

Pertanyaan:

1. Header response apa yang perlu dipikirkan untuk cache?
2. Metric tag apa yang wajib ada?
3. Bagaimana test memastikan v1 tidak menerima response v2?

---

## 40. Ringkasan

API versioning di Jersey bukan sekadar menaruh `/v1` di path. Versioning adalah disiplin menjaga compatibility ketika kontrak API berubah.

Mental model utama:

```text
Versioning is a routing mechanism.
Compatibility is the real engineering goal.
```

Dalam Jersey, versioning bisa dilakukan melalui:

- URI path;
- header;
- media type;
- resource class;
- ResourceConfig/Application;
- Feature module;
- provider;
- DTO;
- mapper;
- exception mapper;
- client module.

Strategi paling sehat untuk enterprise API biasanya:

```text
URI major version
  + versioned DTO
  + shared application service
  + explicit mapper
  + stable error contract
  + deprecation policy
  + telemetry per version
  + contract tests
```

Jangan version domain hanya karena API berubah. Jangan membuat satu resource penuh `if version`. Jangan mengubah error/status/pagination/default sort tanpa compatibility analysis.

Top-tier engineer memperlakukan API sebagai kontrak jangka panjang. Mereka tidak hanya membuat endpoint berjalan, tetapi membuat endpoint bisa berevolusi dengan aman, terukur, terdokumentasi, dan dapat dipertanggungjawabkan.

---

## 41. Referensi

- Jakarta RESTful Web Services 4.0 Specification: https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0
- Jakarta RESTful Web Services API Docs: https://jakarta.ee/specifications/restful-ws/4.0/apidocs/
- Eclipse Jersey User Guide: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/user-guide.html
- Jersey User Guide — Representations and Java Types / Media Types: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/user-guide.html
- Zalando RESTful API Guidelines: https://opensource.zalando.com/restful-api-guidelines/
- Microsoft Azure Architecture Center — Web API Design Best Practices: https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110
- RFC 8594 — The Sunset HTTP Header Field: https://www.rfc-editor.org/rfc/rfc8594
- RFC 7807 / RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./20-api-versioning-and-compatibility-with-jersey (1).md">⬅️ Part 20 — API Versioning and Compatibility with Jersey</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./21-hypermedia-links-uri-building-rest-maturity-pragmatism.md">Part 21 — Hypermedia, Links, URI Building, and REST Maturity Pragmatism ➡️</a>
</div>
