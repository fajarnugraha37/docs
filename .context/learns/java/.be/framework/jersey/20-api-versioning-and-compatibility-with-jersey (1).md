# Part 20 — API Versioning and Compatibility with Jersey

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> File: `20-api-versioning-and-compatibility-with-jersey.md`  
> Scope: Java 8–25, Jersey 2.x/3.x/4.x, JAX-RS/Jakarta REST, enterprise API lifecycle engineering  
> Status: Part 20 dari 32 — **belum part terakhir**

---

## 0. Tujuan Bagian Ini

Di part sebelumnya kita sudah membahas request matching, entity provider, JSON strategy, response engineering, exception mapping, filters, injection, client, resilience, async, streaming, multipart, security, dan validation.

Bagian ini membahas satu masalah yang sering terlihat sederhana, tetapi dalam sistem production bisa menjadi sumber biaya jangka panjang:

> Bagaimana membuat API Jersey bisa berevolusi tanpa mematahkan client lama, tanpa membuat resource class menjadi kacau, dan tanpa menciptakan kontrak yang tidak bisa dipertahankan?

API versioning bukan sekadar memilih URL seperti `/v1` atau `/v2`. Itu hanya permukaan. Yang lebih penting adalah:

- apa arti kompatibilitas;
- perubahan apa yang aman;
- perubahan apa yang breaking;
- bagaimana Jersey memilih resource/provider berdasarkan versi;
- bagaimana DTO, error shape, media type, validation, authorization, dan observability ikut berubah;
- bagaimana migration path dibuat sehingga client lama tidak rusak mendadak;
- bagaimana tim bisa menjaga banyak versi tanpa menggandakan seluruh sistem.

Target akhir bagian ini:

1. Kamu bisa memilih strategi versioning yang sesuai konteks, bukan ikut template.
2. Kamu bisa mendesain resource Jersey yang mendukung evolusi API dengan jelas.
3. Kamu bisa membedakan versioning pada route, representation, behavior, dan domain capability.
4. Kamu bisa menjaga backward compatibility secara disiplin.
5. Kamu bisa merancang deprecation/sunset lifecycle yang aman untuk enterprise/regulatory system.

---

## 1. Mental Model: API Versioning Bukan Naming, Tetapi Compatibility Contract

API adalah kontrak antara provider dan consumer.

```text
Consumer expectation
        |
        v
HTTP method + URI + headers + body + auth + response shape + error shape + semantics
        |
        v
Provider implementation
```

Versioning diperlukan ketika kontrak itu berubah dengan cara yang tidak bisa lagi dianggap kompatibel.

Kesalahan umum:

```text
"Kita ubah response field saja, nanti client menyesuaikan."
```

Dalam production, client mungkin:

- mobile app yang belum bisa dipaksa update;
- sistem agency lain;
- batch integration;
- frontend lama yang masih dipakai user tertentu;
- partner API;
- regulatory downstream report;
- integration test milik consumer yang tidak kamu lihat;
- script operasional yang dibuat manual oleh support team.

Karena itu, API versioning harus dilihat sebagai **lifecycle management**, bukan cosmetic route design.

---

## 2. Layer yang Bisa Berubah dalam API

Sebelum memilih strategi versioning, pahami dulu layer perubahan.

```text
API Contract Layers

1. Transport
   - HTTP method
   - URI
   - headers
   - query parameter
   - media type

2. Representation
   - JSON/XML field
   - enum value
   - nested object
   - date format
   - nullability
   - array/object shape

3. Semantics
   - arti field
   - arti status code
   - idempotency
   - sorting behavior
   - filtering behavior
   - pagination behavior

4. Error Contract
   - error code
   - error field path
   - problem type
   - validation error format

5. Authorization Contract
   - role requirement
   - tenant visibility
   - object-level permission

6. Operational Contract
   - rate limit
   - timeout expectation
   - retry behavior
   - async vs sync
   - deprecation window
```

Versioning yang matang harus mempertimbangkan semua layer ini.

Contoh perubahan yang tampak kecil tapi berbahaya:

```json
// Sebelumnya
{
  "status": "APPROVED"
}
```

```json
// Setelah perubahan
{
  "status": {
    "code": "APPROVED",
    "label": "Approved"
  }
}
```

Bagi manusia, ini hanya membuat status lebih kaya. Bagi client, ini breaking change karena tipe field berubah dari string menjadi object.

---

## 3. Compatibility Taxonomy

Tidak semua perubahan perlu versi baru. Kuncinya adalah membedakan perubahan kompatibel dan breaking.

### 3.1 Bias Umum

Dalam JSON API, perubahan berikut biasanya relatif aman jika client dirancang toleran:

- menambah field baru pada response object;
- menambah optional query parameter;
- menambah endpoint baru;
- menambah enum baru jika client memang dirancang fallback;
- menambah error code baru jika client tidak hardcode exhaustive list;
- menambah link baru;
- menambah metadata non-critical.

Namun “biasanya aman” bukan berarti selalu aman. Banyak client melakukan strict deserialization.

Contoh client Java strict:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Jika client menggunakan konfigurasi seperti ini, menambah field response bisa menjadi breaking change.

### 3.2 Perubahan yang Umumnya Breaking

```text
Breaking changes:

- menghapus field response
- mengganti nama field
- mengganti tipe field
- mengganti format date/time
- mengganti enum existing value
- mengganti arti status/field
- mengganti status code sukses/gagal yang relied upon
- mengganti URI existing
- mengganti HTTP method
- membuat optional field menjadi required
- membuat nullable field menjadi non-null tanpa compatibility window
- mengubah pagination model
- mengubah sorting default
- mengubah filtering semantics
- mengubah error format
- mengubah auth/role requirement secara backward-incompatible
- mengubah idempotency semantics
```

### 3.3 Compatibility Bukan Hanya Syntax

Misal endpoint lama:

```http
GET /applications?status=PENDING
```

Semula artinya:

```text
PENDING = application submitted but not yet assigned
```

Lalu domain berubah:

```text
PENDING = submitted, assigned, or waiting for external verification
```

URI dan response shape tidak berubah, tetapi semantics berubah. Bagi downstream reporting, ini bisa breaking.

Top engineer tidak hanya bertanya:

> Apakah JSON-nya masih bisa diparse?

Tapi juga:

> Apakah meaning yang dikonsumsi client tetap sama?

---

## 4. Empat Strategi Versioning Utama

Ada beberapa strategi umum.

```text
1. URI versioning
   /api/v1/applications
   /api/v2/applications

2. Header versioning
   X-API-Version: 2

3. Media type versioning
   Accept: application/vnd.company.application-v2+json

4. Capability/evolution versioning
   Tidak selalu global version; perubahan dipisah per resource/capability.
```

Tidak ada strategi universal. Setiap pilihan punya trade-off.

---

## 5. URI Versioning

Contoh:

```http
GET /api/v1/applications/123
GET /api/v2/applications/123
```

Di Jersey:

```java
@Path("/v1/applications")
public class ApplicationResourceV1 {
    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public ApplicationV1Response get(@PathParam("id") String id) {
        // ...
    }
}
```

```java
@Path("/v2/applications")
public class ApplicationResourceV2 {
    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public ApplicationV2Response get(@PathParam("id") String id) {
        // ...
    }
}
```

### 5.1 Kelebihan URI Versioning

- Mudah dipahami manusia.
- Mudah dites dengan browser/curl.
- Mudah dipisah di API Gateway.
- Mudah dibuat routing per version.
- Mudah diberi access control/path policy.
- Dokumentasi lebih sederhana.
- Consumer tidak perlu memahami content negotiation kompleks.

### 5.2 Kekurangan URI Versioning

- Version menjadi bagian identity URI.
- Bisa mendorong duplikasi resource class.
- Sulit jika hanya representation yang berubah, bukan resource identity.
- Bisa menciptakan “v1/v2/v3 graveyard”.
- Global version sering terlalu kasar.

### 5.3 Kapan URI Versioning Cocok

Cocok untuk:

- public API;
- partner API;
- mobile/backend API dengan banyak consumer;
- enterprise system dengan API Gateway;
- tim yang butuh operational simplicity;
- deployment yang perlu memisahkan traffic v1/v2;
- sistem dengan audit/deprecation lifecycle yang jelas.

### 5.4 Kapan URI Versioning Kurang Cocok

Kurang cocok jika:

- perubahan sering hanya di representation;
- resource identity secara filosofis ingin tetap sama;
- API sangat hypermedia/content-negotiation oriented;
- kamu ingin media type menjadi primary contract.

---

## 6. Header Versioning

Contoh:

```http
GET /api/applications/123
X-API-Version: 2
```

Atau:

```http
GET /api/applications/123
API-Version: 2026-06-01
```

Di Jersey, header bisa dipakai melalui filter atau resource method.

### 6.1 Simple Resource-Level Header Version

```java
@Path("/applications")
public class ApplicationResource {

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response get(
            @PathParam("id") String id,
            @HeaderParam("X-API-Version") @DefaultValue("1") String version) {

        if ("2".equals(version)) {
            ApplicationV2Response response = service.getV2(id);
            return Response.ok(response).build();
        }

        ApplicationV1Response response = service.getV1(id);
        return Response.ok(response).build();
    }
}
```

Ini mudah, tetapi cepat menjadi buruk jika banyak method.

### 6.2 Filter-Based Header Version Context

Lebih baik version diekstrak sekali di filter lalu disimpan sebagai request context.

```java
public final class ApiVersion {
    private final int major;

    private ApiVersion(int major) {
        this.major = major;
    }

    public static ApiVersion parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return new ApiVersion(1);
        }
        try {
            int value = Integer.parseInt(raw);
            if (value < 1 || value > 2) {
                throw new IllegalArgumentException("Unsupported API version");
            }
            return new ApiVersion(value);
        } catch (NumberFormatException ex) {
            throw new BadRequestException("Invalid API version");
        }
    }

    public int major() {
        return major;
    }
}
```

```java
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class ApiVersionFilter implements ContainerRequestFilter {

    public static final String PROPERTY_API_VERSION = "api.version";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String raw = requestContext.getHeaderString("X-API-Version");
        ApiVersion version = ApiVersion.parse(raw);
        requestContext.setProperty(PROPERTY_API_VERSION, version);
    }
}
```

```java
@Path("/applications")
public class ApplicationResource {

    @Context
    private ContainerRequestContext requestContext;

    @GET
    @Path("/{id}")
    public Response get(@PathParam("id") String id) {
        ApiVersion version = (ApiVersion) requestContext.getProperty(ApiVersionFilter.PROPERTY_API_VERSION);

        if (version.major() == 2) {
            return Response.ok(service.getV2(id)).build();
        }

        return Response.ok(service.getV1(id)).build();
    }
}
```

### 6.3 Kelebihan Header Versioning

- URI tetap bersih.
- Version bisa dianggap request metadata.
- Cocok untuk internal API/gateway-managed API.
- Bisa memakai date-based version.
- Bisa dipadukan dengan feature/capability negotiation.

### 6.4 Kekurangan Header Versioning

- Kurang discoverable.
- Sulit dites manual jika tooling kurang familiar.
- Caching/proxy harus memperhatikan header.
- Dokumentasi harus sangat jelas.
- Bisa tersembunyi dari log kalau header tidak dicatat.
- Routing gateway bisa lebih kompleks.

Jika response bervariasi berdasarkan header, caching harus benar. Minimal perlu memahami `Vary` header.

```http
Vary: X-API-Version
```

Tanpa ini, cache/proxy bisa menyajikan response versi salah kepada client lain.

---

## 7. Media Type Versioning

Contoh:

```http
GET /api/applications/123
Accept: application/vnd.acme.application-v1+json
```

```http
GET /api/applications/123
Accept: application/vnd.acme.application-v2+json
```

Di Jersey:

```java
@Path("/applications")
public class ApplicationResource {

    @GET
    @Path("/{id}")
    @Produces("application/vnd.acme.application-v1+json")
    public ApplicationV1Response getV1(@PathParam("id") String id) {
        return service.getV1(id);
    }

    @GET
    @Path("/{id}")
    @Produces("application/vnd.acme.application-v2+json")
    public ApplicationV2Response getV2(@PathParam("id") String id) {
        return service.getV2(id);
    }
}
```

Jersey/Jakarta REST request matching akan mempertimbangkan HTTP method, path, `@Consumes`, dan `@Produces` saat memilih resource method. Ini membuat media-type versioning bisa diekspresikan langsung sebagai resource method selection.

### 7.1 Kelebihan Media Type Versioning

- Secara REST, representation versioning lebih tepat.
- URI tetap resource-oriented.
- Cocok jika resource sama tetapi representation berubah.
- Jersey bisa memilih method berdasarkan `Accept`.
- Bisa sangat eksplisit untuk client yang paham content negotiation.

### 7.2 Kekurangan Media Type Versioning

- Lebih sulit dipahami banyak tim.
- Dokumentasi dan tooling lebih berat.
- API Gateway/logging/testing kadang kurang nyaman.
- Browser/manual testing kurang praktis.
- Consumer sering lupa mengirim `Accept` yang benar.
- Error `406 Not Acceptable` menjadi lebih sering jika negotiation tidak dipahami.

### 7.3 Vendor Media Type Pattern

```text
application/vnd.<company>.<resource>-v<version>+json
```

Contoh:

```text
application/vnd.aceas.application-v1+json
application/vnd.aceas.application-v2+json
application/vnd.aceas.case-summary-v1+json
```

Jangan membuat media type terlalu granular tanpa alasan. Kalau setiap minor perubahan membuat media type baru, consumer dan provider akan kewalahan.

---

## 8. Date-Based Versioning

Sebagian API memakai tanggal sebagai versi.

```http
X-API-Version: 2026-06-01
```

Atau:

```http
Accept: application/vnd.acme.application+json;version=2026-06-01
```

### 8.1 Kelebihan

- Cocok untuk API yang berevolusi kontinu.
- Lebih jelas kapan kontrak diperkenalkan.
- Bisa menghindari debat major/minor version.
- Cocok untuk platform API modern.

### 8.2 Kekurangan

- Lebih sulit secara mental bagi tim enterprise tradisional.
- Bisa menghasilkan terlalu banyak version branch.
- Perlu governance kuat.
- Harus jelas apakah tanggal berarti “behavior snapshot” atau “minimum API date”.

Contoh interpretasi yang harus diputuskan:

```text
X-API-Version: 2026-06-01
```

Apakah artinya:

1. client ingin behavior persis seperti 1 Juni 2026; atau
2. client kompatibel dengan fitur yang tersedia sejak 1 Juni 2026; atau
3. client memakai schema versi 2026-06-01 saja?

Tanpa definisi, date-based versioning bisa membingungkan.

---

## 9. Capability-Based Evolution

Tidak semua perubahan harus melalui global version.

Kadang lebih baik memakai capability flag.

```http
GET /applications/123
X-API-Capabilities: expanded-status,include-risk-score
```

Atau query explicit:

```http
GET /applications/123?include=riskScore,assignmentHistory
```

### 9.1 Cocok Untuk

- optional expansion;
- backward-compatible enrichment;
- expensive subresource;
- UI-specific detail;
- gradual rollout;
- field selection;
- sparse response.

### 9.2 Tidak Cocok Untuk

- breaking schema change;
- semantic change besar;
- security model berbeda;
- perubahan behavior yang harus stabil jangka panjang;
- perubahan yang membingungkan audit trail.

Capability bukan pengganti versioning. Capability adalah cara menghindari versioning ketika perubahan memang optional dan compatible.

---

## 10. Resource Design Pattern: Thin Versioned Adapter, Shared Use Case

Anti-pattern umum:

```text
ApplicationResourceV1 -> ApplicationServiceV1 -> RepositoryV1
ApplicationResourceV2 -> ApplicationServiceV2 -> RepositoryV2
```

Ini sering membuat duplikasi bisnis.

Pattern yang lebih sehat:

```text
HTTP Contract Layer
  ApplicationResourceV1
  ApplicationResourceV2
        |
        v
Application Use Case Layer
  GetApplicationUseCase
        |
        v
Domain / Persistence Layer
  ApplicationRepository
```

Versi berbeda terutama hidup di adapter/DTO/mapping layer.

```java
@Path("/v1/applications")
public class ApplicationResourceV1 {
    private final GetApplicationUseCase getApplication;
    private final ApplicationV1Mapper mapper;

    public ApplicationResourceV1(GetApplicationUseCase getApplication,
                                 ApplicationV1Mapper mapper) {
        this.getApplication = getApplication;
        this.mapper = mapper;
    }

    @GET
    @Path("/{id}")
    public ApplicationV1Response get(@PathParam("id") String id) {
        ApplicationView view = getApplication.get(id);
        return mapper.toResponse(view);
    }
}
```

```java
@Path("/v2/applications")
public class ApplicationResourceV2 {
    private final GetApplicationUseCase getApplication;
    private final ApplicationV2Mapper mapper;

    public ApplicationResourceV2(GetApplicationUseCase getApplication,
                                 ApplicationV2Mapper mapper) {
        this.getApplication = getApplication;
        this.mapper = mapper;
    }

    @GET
    @Path("/{id}")
    public ApplicationV2Response get(@PathParam("id") String id) {
        ApplicationView view = getApplication.get(id);
        return mapper.toResponse(view);
    }
}
```

Domain use case sama. Response contract beda.

---

## 11. DTO Versioning

DTO adalah kontrak. Jangan memperlakukan DTO response sebagai internal object.

### 11.1 Bad Pattern: Reusing Entity as Response

```java
@GET
@Path("/{id}")
public ApplicationEntity get(@PathParam("id") String id) {
    return repository.find(id);
}
```

Masalah:

- field database bocor ke API;
- lazy loading bisa error;
- rename DB column/domain field bisa breaking API;
- security field bisa terekspos;
- versioning hampir mustahil;
- JSON shape mengikuti persistence model, bukan contract.

### 11.2 Good Pattern: Versioned Response DTO

```java
public class ApplicationV1Response {
    public String id;
    public String status;
    public String submittedAt;
}
```

```java
public class ApplicationV2Response {
    public String id;
    public StatusDto status;
    public OffsetDateTime submittedAt;
    public RiskSummaryDto risk;
}
```

### 11.3 Domain View vs DTO

Buat object internal yang stabil untuk use case.

```java
public class ApplicationView {
    private String id;
    private ApplicationStatus status;
    private Instant submittedAt;
    private RiskScore riskScore;
    private AssignmentInfo assignment;

    // getters
}
```

Lalu mapping ke DTO versi berbeda.

```java
public class ApplicationV1Mapper {
    public ApplicationV1Response toResponse(ApplicationView view) {
        ApplicationV1Response response = new ApplicationV1Response();
        response.id = view.getId();
        response.status = view.getStatus().name();
        response.submittedAt = DateTimeFormatter.ISO_INSTANT.format(view.getSubmittedAt());
        return response;
    }
}
```

```java
public class ApplicationV2Mapper {
    public ApplicationV2Response toResponse(ApplicationView view) {
        ApplicationV2Response response = new ApplicationV2Response();
        response.id = view.getId();
        response.status = new StatusDto(view.getStatus().name(), view.getStatus().label());
        response.submittedAt = OffsetDateTime.ofInstant(view.getSubmittedAt(), ZoneOffset.UTC);
        response.risk = RiskSummaryDto.from(view.getRiskScore());
        return response;
    }
}
```

---

## 12. Request DTO Versioning

Request DTO lebih sensitif daripada response DTO.

Menambah required field pada request adalah breaking.

### 12.1 V1 Request

```json
{
  "name": "ABC Pte Ltd",
  "postalCode": "123456"
}
```

```java
public class CreateApplicationV1Request {
    @NotBlank
    public String name;

    @Pattern(regexp = "\\d{6}")
    public String postalCode;
}
```

### 12.2 V2 Request

```json
{
  "name": "ABC Pte Ltd",
  "postalCode": "123456",
  "declaredBusinessActivity": "REAL_ESTATE"
}
```

```java
public class CreateApplicationV2Request {
    @NotBlank
    public String name;

    @Pattern(regexp = "\\d{6}")
    public String postalCode;

    @NotBlank
    public String declaredBusinessActivity;
}
```

Jika `declaredBusinessActivity` menjadi mandatory, jangan ubah V1 request DTO. Buat V2 contract.

---

## 13. Validation Per Version

Validation sering ikut berubah antar versi.

```java
@Path("/v1/applications")
public class ApplicationResourceV1 {
    @POST
    public Response create(@Valid CreateApplicationV1Request request) {
        // ...
    }
}
```

```java
@Path("/v2/applications")
public class ApplicationResourceV2 {
    @POST
    public Response create(@Valid CreateApplicationV2Request request) {
        // ...
    }
}
```

Jangan memaksa satu DTO memakai banyak conditional validation kalau perbedaan kontraknya besar.

Bad:

```java
public class CreateApplicationRequest {
    public String apiVersion;

    @NotBlank(groups = V1.class)
    public String name;

    @NotBlank(groups = V2.class)
    public String declaredBusinessActivity;
}
```

Validation group berguna, tetapi jika object mulai penuh conditional branch, itu tanda versi kontrak perlu dipisah.

---

## 14. Error Contract Versioning

Banyak tim versioning success response tetapi lupa error response.

Padahal client sering bergantung pada error code.

### 14.1 V1 Error

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid request"
}
```

### 14.2 V2 Error

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request contains invalid fields.",
  "instance": "/applications",
  "correlationId": "01J...",
  "violations": [
    {
      "field": "postalCode",
      "code": "INVALID_POSTAL_CODE",
      "message": "Postal code must contain 6 digits."
    }
  ]
}
```

V2 bisa memakai Problem Details style, tetapi jangan tiba-tiba mengubah V1 error shape.

### 14.3 Versioned ExceptionMapper Pattern

Ada beberapa pendekatan.

#### Pendekatan A: Mapper membaca API version context

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {

    @Context
    private ContainerRequestContext requestContext;

    @Override
    public Response toResponse(DomainException exception) {
        ApiVersion version = (ApiVersion) requestContext.getProperty(ApiVersionFilter.PROPERTY_API_VERSION);

        if (version != null && version.major() >= 2) {
            return Response.status(exception.status())
                    .entity(toProblemDetails(exception))
                    .type("application/problem+json")
                    .build();
        }

        return Response.status(exception.status())
                .entity(toLegacyError(exception))
                .type(MediaType.APPLICATION_JSON_TYPE)
                .build();
    }
}
```

Kelebihan:

- satu mapper;
- mudah menjaga consistency.

Kekurangan:

- mapper menjadi aware version;
- branch bisa membesar.

#### Pendekatan B: Error factory per version

```java
public interface ErrorResponseFactory {
    Response validationError(ValidationFailure failure);
    Response domainError(DomainFailure failure);
}
```

```java
public class V1ErrorResponseFactory implements ErrorResponseFactory { }
public class V2ProblemDetailsFactory implements ErrorResponseFactory { }
```

Mapper memilih factory berdasarkan version.

Ini lebih bersih jika error evolution cukup besar.

---

## 15. Provider Per Version

Jersey provider bisa dibuat berbeda per versi, tetapi hati-hati.

Contoh media type versioning dengan writer berbeda:

```java
@Provider
@Produces("application/vnd.acme.application-v1+json")
public class ApplicationV1Writer implements MessageBodyWriter<ApplicationView> {
    // write ApplicationView as v1 JSON
}
```

```java
@Provider
@Produces("application/vnd.acme.application-v2+json")
public class ApplicationV2Writer implements MessageBodyWriter<ApplicationView> {
    // write ApplicationView as v2 JSON
}
```

Ini powerful, tetapi sering terlalu magic. Untuk kebanyakan enterprise API, mapping eksplisit ke DTO lebih mudah dipahami dan dites.

Rekomendasi:

```text
Default: explicit DTO mapper per version.
Advanced: provider per media type hanya jika benar-benar membangun representation framework.
```

---

## 16. Media Type Versioning dengan DTO Berbeda

Contoh praktis:

```java
@Path("/applications")
public class ApplicationResource {

    private final GetApplicationUseCase getApplication;
    private final ApplicationV1Mapper v1Mapper;
    private final ApplicationV2Mapper v2Mapper;

    @GET
    @Path("/{id}")
    @Produces("application/vnd.acme.application-v1+json")
    public ApplicationV1Response getV1(@PathParam("id") String id) {
        return v1Mapper.toResponse(getApplication.get(id));
    }

    @GET
    @Path("/{id}")
    @Produces("application/vnd.acme.application-v2+json")
    public ApplicationV2Response getV2(@PathParam("id") String id) {
        return v2Mapper.toResponse(getApplication.get(id));
    }
}
```

Request:

```http
GET /applications/APP-001
Accept: application/vnd.acme.application-v1+json
```

Response:

```http
Content-Type: application/vnd.acme.application-v1+json
```

Request:

```http
GET /applications/APP-001
Accept: application/vnd.acme.application-v2+json
```

Response:

```http
Content-Type: application/vnd.acme.application-v2+json
```

Di sini Jersey method selection membantu versioning berdasarkan `Accept`.

---

## 17. `Vary` Header dan Cache Correctness

Jika output berubah berdasarkan `Accept`, `Accept-Language`, `X-API-Version`, atau header lain, response perlu memberi tahu cache.

Contoh media type versioning:

```http
Vary: Accept
```

Contoh header versioning:

```http
Vary: X-API-Version
```

Contoh version + language:

```http
Vary: X-API-Version, Accept-Language
```

Di Jersey response filter:

```java
@Provider
public class ApiVersionVaryResponseFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        if (requestContext.getHeaderString("X-API-Version") != null) {
            responseContext.getHeaders().add("Vary", "X-API-Version");
        }
    }
}
```

Namun jangan asal menambah banyak `Vary`, karena akan mengurangi cache hit rate.

---

## 18. Versioning dan Pagination

Pagination contract sering diremehkan.

### 18.1 Offset Pagination V1

```http
GET /v1/cases?page=1&size=20
```

Response:

```json
{
  "items": [],
  "page": 1,
  "size": 20,
  "total": 123
}
```

### 18.2 Cursor Pagination V2

```http
GET /v2/cases?cursor=eyJ...&limit=20
```

Response:

```json
{
  "items": [],
  "nextCursor": "eyJ...",
  "hasMore": true
}
```

Mengubah offset ke cursor adalah breaking change. Bahkan jika endpoint path sama, semantics berubah total.

Jangan ubah pagination model diam-diam.

---

## 19. Versioning dan Enum

Enum adalah jebakan.

```json
{
  "status": "PENDING"
}
```

Client sering menulis:

```java
switch (status) {
    case PENDING -> ...;
    case APPROVED -> ...;
    case REJECTED -> ...;
}
```

Jika server menambah:

```text
PENDING_EXTERNAL_VERIFICATION
```

Client lama bisa gagal.

### 19.1 Strategi Aman

Untuk V1, pertahankan enum lama:

```java
public class ApplicationV1Mapper {
    public String mapStatus(ApplicationStatus status) {
        return switch (status) {
            case PENDING_EXTERNAL_VERIFICATION -> "PENDING";
            case PENDING_ASSIGNMENT -> "PENDING";
            case APPROVED -> "APPROVED";
            case REJECTED -> "REJECTED";
        };
    }
}
```

Untuk V2, expose status lebih detail:

```json
{
  "status": {
    "code": "PENDING_EXTERNAL_VERIFICATION",
    "category": "PENDING",
    "label": "Pending External Verification"
  }
}
```

Ini menjaga V1 compatible sambil memberi V2 detail lebih kaya.

---

## 20. Versioning dan Date/Time Format

Perubahan date format hampir selalu breaking.

V1:

```json
{
  "submittedAt": "2026-06-16T10:15:30Z"
}
```

V2:

```json
{
  "submittedAt": "2026-06-16T18:15:30+08:00"
}
```

Keduanya ISO-like, tetapi semantics timezone bisa berbeda.

Rekomendasi:

```text
- Gunakan UTC instant untuk machine contract.
- Jangan ubah format field existing.
- Jika perlu format baru, tambah field baru atau version baru.
- Dokumentasikan timezone dan precision.
- Hindari date string lokal untuk API machine-to-machine.
```

---

## 21. Versioning dan Authorization

Perubahan authorization bisa breaking walaupun API shape sama.

Contoh:

V1:

```text
Role CASE_OFFICER bisa GET /cases/{id}
```

V2:

```text
Role CASE_OFFICER hanya bisa GET jika assigned officer.
```

Ini mungkin benar secara security, tetapi bagi client internal bisa breaking.

Untuk security tightening, kadang tidak bisa menunggu versioning. Namun tetap perlu:

- impact assessment;
- migration notice;
- audit rationale;
- feature flag jika feasible;
- exception handling yang jelas;
- logging consumer yang terdampak.

Jangan menyebut semua auth change sebagai “hanya policy”. Banyak policy change adalah API behavior change.

---

## 22. Versioning dan Idempotency

Endpoint command sering punya behavior idempotency.

V1:

```http
POST /v1/applications
```

Jika retry, bisa create duplicate.

V2:

```http
POST /v2/applications
Idempotency-Key: 01J...
```

Jika retry dengan key sama, result sama.

Ini bukan cuma header tambahan. Ini mengubah operational contract.

V2 response bisa:

```http
201 Created
Location: /v2/applications/APP-001
Idempotency-Replayed: false
```

Replay response:

```http
200 OK
Idempotency-Replayed: true
```

Atau tetap `201` tergantung contract. Yang penting harus terdokumentasi.

---

## 23. Versioning dan Long-Running Operation

V1 synchronous:

```http
POST /v1/reports/export
```

Response:

```http
200 OK
Content-Type: application/octet-stream
```

V2 asynchronous:

```http
POST /v2/reports/export-jobs
```

Response:

```http
202 Accepted
Location: /v2/report-jobs/JOB-001
```

Ini breaking behavior. Client lama yang menunggu file langsung tidak bisa memakai V2 tanpa perubahan.

Jangan mengganti endpoint sync menjadi async diam-diam.

---

## 24. Deprecation dan Sunset Lifecycle

Versioning tanpa lifecycle akan menghasilkan kuburan versi lama.

Lifecycle sehat:

```text
1. Introduce new version
2. Document migration path
3. Support both versions
4. Observe usage per consumer
5. Announce deprecation
6. Freeze old version except security/critical fixes
7. Send Sunset signal
8. Block new onboarding to old version
9. Migrate remaining consumer
10. Remove old version after agreed date
```

### 24.1 Header untuk Deprecation/Sunset

HTTP memiliki mekanisme `Sunset` header yang didefinisikan oleh RFC 8594 untuk memberi tahu bahwa URI kemungkinan tidak tersedia setelah waktu tertentu.

Contoh:

```http
Deprecation: true
Sunset: Wed, 31 Dec 2027 23:59:59 GMT
Link: <https://docs.example.com/migration/v1-to-v2>; rel="deprecation"
```

Catatan:

- `Sunset` memberi sinyal waktu akhir.
- Dokumentasi migration tetap wajib.
- Header saja tidak cukup untuk enterprise change management.

### 24.2 Jersey Response Filter untuk Deprecated Version

```java
@Provider
public class DeprecationHeaderFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        String path = requestContext.getUriInfo().getPath();

        if (path.startsWith("v1/")) {
            responseContext.getHeaders().putSingle("Deprecation", "true");
            responseContext.getHeaders().putSingle("Sunset", "Wed, 31 Dec 2027 23:59:59 GMT");
            responseContext.getHeaders().add(
                    "Link",
                    "<https://docs.example.com/migration/v1-to-v2>; rel=\"deprecation\""
            );
        }
    }
}
```

---

## 25. Observability untuk Versioning

Tidak cukup hanya punya `/v1` dan `/v2`. Kamu harus tahu siapa memakai versi apa.

Metric minimum:

```text
api_requests_total{version="v1", resource="applications", method="GET", status="200"}
api_request_duration_ms{version="v1", resource="applications"}
api_errors_total{version="v1", error_code="VALIDATION_ERROR"}
api_deprecated_requests_total{version="v1", client_id="partner-a"}
```

Log minimum:

```json
{
  "correlationId": "01J...",
  "clientId": "partner-a",
  "apiVersion": "v1",
  "method": "GET",
  "pathTemplate": "/v1/applications/{id}",
  "status": 200,
  "deprecated": true
}
```

Tanpa observability, kamu tidak bisa menjawab:

- apakah v1 masih dipakai?
- consumer mana yang belum migrasi?
- endpoint v1 mana yang paling aktif?
- apakah error rate v2 lebih tinggi?
- apakah client tertentu mengirim wrong Accept header?

---

## 26. Jersey Path Template Logging untuk Versioned API

Untuk metric, jangan log raw path saja:

```text
/v1/applications/APP-001
/v1/applications/APP-002
/v1/applications/APP-003
```

Ini high-cardinality.

Lebih baik log template:

```text
/v1/applications/{id}
```

Di Jersey, akses matched URI/resource info bisa dilakukan melalui `UriInfo`/Jersey extended APIs tergantung versi. Secara portable, kamu bisa set property manual di resource/filter atau memakai naming convention.

Pattern sederhana:

```java
@NameBinding
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface ApiOperation {
    String value();
    String version();
}
```

```java
@ApiOperation(value = "GetApplication", version = "v1")
@GET
@Path("/{id}")
public ApplicationV1Response get(@PathParam("id") String id) {
    // ...
}
```

Lalu dynamic feature/filter bisa mengambil metadata annotation untuk metric/logging.

---

## 27. Testing Compatibility

Versioning tanpa compatibility test adalah ilusi.

### 27.1 Golden File Test

Simpan contoh response sebagai file kontrak.

```text
src/test/resources/contracts/v1/get-application-response.json
src/test/resources/contracts/v2/get-application-response.json
```

Test:

```java
@Test
void v1ResponseShouldRemainCompatible() {
    ApplicationView view = sampleApplication();
    ApplicationV1Response response = mapper.toResponse(view);

    assertThatJson(response)
            .isEqualToContract("contracts/v1/get-application-response.json");
}
```

### 27.2 Unknown Field Tolerance Test

Untuk client SDK internal:

```java
@Test
void clientShouldIgnoreUnknownFields() throws Exception {
    String json = """
        {
          "id": "APP-001",
          "status": "PENDING",
          "newServerField": "ignored"
        }
        """;

    ApplicationClientDto dto = objectMapper.readValue(json, ApplicationClientDto.class);

    assertEquals("APP-001", dto.id());
}
```

### 27.3 Consumer-Driven Contract

Untuk partner/internal consumer penting, pertimbangkan consumer-driven contract.

Tujuannya bukan membuat semua test dimiliki provider, tetapi membuat breaking expectation terlihat sebelum deploy.

---

## 28. OpenAPI Per Version

Jika menggunakan OpenAPI, jangan campur semua version dalam satu spec tanpa struktur.

Opsi:

```text
/openapi/v1.yaml
/openapi/v2.yaml
```

Atau satu spec dengan grouping jelas:

```text
paths:
  /v1/applications/{id}:
  /v2/applications/{id}:
```

Rekomendasi enterprise:

```text
- Publish spec per major version.
- Freeze old spec setelah deprecated kecuali critical correction.
- Include error schema per version.
- Include auth requirement per operation.
- Include deprecation/sunset metadata dalam docs.
```

---

## 29. Versioning dan API Gateway

Jika Jersey berada di balik API Gateway, versioning juga operational issue.

Gateway bisa melakukan:

- route `/v1/**` ke deployment lama;
- route `/v2/**` ke deployment baru;
- enforce client quota per version;
- reject deprecated version for new clients;
- inject `X-Client-Id`;
- validate JWT audience/scope;
- add deprecation warning;
- traffic shadowing;
- canary per version.

Tapi jangan menaruh semua compatibility logic di gateway. Gateway tahu routing dan policy; Jersey tetap harus menjaga contract behavior.

---

## 30. Versioning dan Deployment Strategy

Ada dua pendekatan besar.

### 30.1 Same Deployment, Multi-Version Code

```text
One app deployment:
  /v1/resources
  /v2/resources
```

Kelebihan:

- simple operation;
- shared domain/service code;
- easier transaction consistency;
- single release pipeline.

Kekurangan:

- old version code tetap ikut release baru;
- regression risk;
- dependency upgrade harus compatible semua version;
- binary/classpath conflict jika provider lama butuh dependency lama.

### 30.2 Separate Deployment Per Version

```text
app-api-v1 deployment
app-api-v2 deployment
```

Kelebihan:

- isolation kuat;
- v1 bisa freeze;
- v2 bisa memakai dependency/runtime baru;
- gateway routing jelas.

Kekurangan:

- operational overhead;
- duplicate infra;
- data migration/consistency lebih sulit;
- bug fix harus backport;
- observability harus digabung.

### 30.3 Rekomendasi Praktis

```text
Internal/team API kecil:
  same deployment, URI/header versioning sederhana.

Public/partner API besar:
  URI versioning + gateway routing + observability per client.

Representation-heavy mature API:
  media type versioning jika tim dan consumer memahami content negotiation.

Long-lived regulatory API:
  versioned adapter + explicit DTO + deprecation/sunset lifecycle + audit trail.
```

---

## 31. Java 8–25 Considerations

### 31.1 Java 8

- Banyak legacy Jersey 2.x masih Java 8.
- Namespace biasanya `javax.ws.rs`.
- Tidak ada records/sealed classes.
- DTO biasanya POJO mutable.
- Date/time sudah bisa pakai `java.time`, tetapi pastikan JSON provider module benar.

### 31.2 Java 11/17

- Java 11 sering menjadi baseline modern legacy.
- Java 17 penting untuk Jakarta EE 10/11 ecosystem.
- Records bisa dipakai di Java 16+, tetapi framework serialization harus mendukung.
- Stronger encapsulation/module concerns bisa mempengaruhi reflection.

### 31.3 Java 21/25

- Records/sealed classes lebih matang untuk DTO/domain modeling.
- Virtual threads bisa membantu outbound/blocking workload, tetapi API contract versioning tetap tidak berubah.
- Pattern matching membantu mapper code lebih jelas.
- JDK upgrade bisa mempengaruhi provider dependency, bytecode level, dan container compatibility.

### 31.4 Namespace Split

Jersey 2.x:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
```

Jersey 3.x/4.x:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
```

Jika versioning API bersamaan dengan migrasi `javax` ke `jakarta`, pisahkan dua jenis perubahan:

```text
API contract versioning != implementation namespace migration
```

Jangan mengubah external API hanya karena package Java internal berubah.

---

## 32. Decision Framework

Gunakan pertanyaan ini sebelum memilih strategi.

### 32.1 Consumer

```text
- Siapa consumer API?
- Apakah consumer internal atau external?
- Apakah client bisa dipaksa update?
- Apakah client strict terhadap unknown field?
- Apakah ada SDK resmi?
- Apakah ada batch/script legacy?
```

### 32.2 Change Type

```text
- Apakah perubahan hanya menambah field optional?
- Apakah mengubah tipe/arti field?
- Apakah mengubah pagination/filter/sorting?
- Apakah mengubah error shape?
- Apakah mengubah auth requirement?
- Apakah mengubah sync menjadi async?
```

### 32.3 Operational

```text
- Apakah gateway perlu route per version?
- Apakah butuh canary per version?
- Apakah butuh sunset date?
- Apakah ada SLA untuk old version?
- Apakah metric per version tersedia?
```

### 32.4 Team

```text
- Apakah tim bisa maintain dua resource class?
- Apakah mapper per version tersedia?
- Apakah test contract ada?
- Apakah docs per version dijaga?
```

---

## 33. Recommended Default untuk Enterprise Jersey API

Untuk kebanyakan enterprise Jersey API, terutama yang butuh maintainability dan clarity:

```text
1. Gunakan URI major version untuk breaking changes.
2. Gunakan explicit DTO per version.
3. Gunakan shared use case/domain layer.
4. Gunakan mapper per version.
5. Jangan expose entity persistence langsung.
6. Version-kan error contract jika berubah.
7. Tambahkan observability per version/client.
8. Gunakan deprecation/sunset lifecycle.
9. Gunakan media type versioning hanya jika tim/consumer matang.
10. Jangan buat version baru untuk perubahan additive yang benar-benar compatible.
```

Blueprint:

```text
api
 ├── v1
 │   ├── ApplicationResourceV1
 │   ├── dto
 │   │   ├── ApplicationV1Response
 │   │   └── CreateApplicationV1Request
 │   └── mapper
 │       └── ApplicationV1Mapper
 │
 ├── v2
 │   ├── ApplicationResourceV2
 │   ├── dto
 │   │   ├── ApplicationV2Response
 │   │   └── CreateApplicationV2Request
 │   └── mapper
 │       └── ApplicationV2Mapper
 │
 ├── error
 │   ├── V1ErrorResponseFactory
 │   └── V2ProblemDetailsFactory
 │
 └── filter
     ├── ApiVersionFilter
     ├── DeprecationHeaderFilter
     └── ApiVersionMetricsFilter

application
 └── GetApplicationUseCase

domain
 └── Application
```

---

## 34. End-to-End Example

### 34.1 V1 Resource

```java
@Path("/v1/applications")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ApplicationResourceV1 {

    private final GetApplicationUseCase getApplication;
    private final CreateApplicationUseCase createApplication;
    private final ApplicationV1Mapper mapper;

    public ApplicationResourceV1(GetApplicationUseCase getApplication,
                                 CreateApplicationUseCase createApplication,
                                 ApplicationV1Mapper mapper) {
        this.getApplication = getApplication;
        this.createApplication = createApplication;
        this.mapper = mapper;
    }

    @GET
    @Path("/{id}")
    public ApplicationV1Response get(@PathParam("id") String id) {
        return mapper.toResponse(getApplication.get(id));
    }

    @POST
    public Response create(@Valid CreateApplicationV1Request request,
                           @Context UriInfo uriInfo) {
        CreateApplicationCommand command = mapper.toCommand(request);
        ApplicationView created = createApplication.create(command);

        URI location = uriInfo.getAbsolutePathBuilder()
                .path(created.getId())
                .build();

        return Response.created(location)
                .entity(mapper.toResponse(created))
                .build();
    }
}
```

### 34.2 V2 Resource

```java
@Path("/v2/applications")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ApplicationResourceV2 {

    private final GetApplicationUseCase getApplication;
    private final CreateApplicationUseCase createApplication;
    private final ApplicationV2Mapper mapper;

    public ApplicationResourceV2(GetApplicationUseCase getApplication,
                                 CreateApplicationUseCase createApplication,
                                 ApplicationV2Mapper mapper) {
        this.getApplication = getApplication;
        this.createApplication = createApplication;
        this.mapper = mapper;
    }

    @GET
    @Path("/{id}")
    public ApplicationV2Response get(@PathParam("id") String id) {
        return mapper.toResponse(getApplication.get(id));
    }

    @POST
    public Response create(@Valid CreateApplicationV2Request request,
                           @HeaderParam("Idempotency-Key") String idempotencyKey,
                           @Context UriInfo uriInfo) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new BadRequestException("Idempotency-Key is required for v2 create application");
        }

        CreateApplicationCommand command = mapper.toCommand(request, idempotencyKey);
        ApplicationView created = createApplication.create(command);

        URI location = uriInfo.getAbsolutePathBuilder()
                .path(created.getId())
                .build();

        return Response.created(location)
                .entity(mapper.toResponse(created))
                .header("Idempotency-Key", idempotencyKey)
                .build();
    }
}
```

Perhatikan:

- V1 tidak dipaksa memakai idempotency key.
- V2 bisa menambahkan mandatory operational contract baru.
- Use case internal bisa sama, tetapi command mapping berbeda.

---

## 35. Failure Modes

### 35.1 Accidental Breaking Change

Gejala:

- client lama error setelah deployment;
- API test provider pass;
- consumer strict deserialization gagal.

Penyebab:

- field dihapus/rename;
- enum ditambah tanpa fallback;
- date format berubah;
- error shape berubah.

Mitigasi:

- golden contract test;
- consumer-driven contract;
- DTO per version;
- changelog discipline.

### 35.2 Version Branch Explosion

Gejala:

- `if (version == ...)` tersebar di semua service;
- bug fix harus dilakukan di banyak tempat;
- developer takut menyentuh API.

Penyebab:

- versioning masuk domain layer;
- tidak ada mapper boundary;
- version terlalu granular.

Mitigasi:

- thin adapter;
- shared use case;
- mapper per version;
- major version only untuk breaking changes.

### 35.3 Cache Serving Wrong Version

Gejala:

- client A menerima response shape client B;
- bug hanya muncul di environment dengan proxy/cache.

Penyebab:

- header/media type versioning tanpa `Vary`.

Mitigasi:

- `Vary: Accept`;
- `Vary: X-API-Version`;
- cache test;
- API Gateway config review.

### 35.4 Deprecated Version Never Dies

Gejala:

- v1 masih aktif bertahun-tahun;
- v1 menghambat upgrade dependency;
- security fix harus backport terus.

Penyebab:

- tidak ada sunset date;
- tidak ada metric per consumer;
- tidak ada migration enforcement.

Mitigasi:

- deprecation policy;
- consumer tracking;
- sunset header;
- onboarding block;
- formal migration plan.

---

## 36. Checklist Desain API Versioning Jersey

Sebelum membuat versi baru:

```text
[ ] Apakah perubahan benar-benar breaking?
[ ] Apakah bisa diselesaikan dengan additive field?
[ ] Apakah bisa diselesaikan dengan optional include/capability?
[ ] Apakah consumer lama diketahui?
[ ] Apakah OpenAPI/spec lama tersedia?
[ ] Apakah response DTO dipisah per version?
[ ] Apakah request DTO dipisah per version?
[ ] Apakah validation behavior dipisah jelas?
[ ] Apakah error contract ikut dipertimbangkan?
[ ] Apakah auth behavior berubah?
[ ] Apakah pagination/filter/sorting berubah?
[ ] Apakah idempotency/retry behavior berubah?
[ ] Apakah observability per version tersedia?
[ ] Apakah deprecation/sunset lifecycle didefinisikan?
[ ] Apakah test contract tersedia?
[ ] Apakah gateway/cache `Vary` behavior benar?
```

---

## 37. Mini Exercise

### Exercise 1

Endpoint saat ini:

```http
GET /v1/cases/{id}
```

Response:

```json
{
  "id": "CASE-001",
  "status": "OPEN",
  "assignedOfficer": "u123"
}
```

Requirement baru:

```text
assignedOfficer harus berubah menjadi object:
{
  "id": "u123",
  "name": "Alice Tan",
  "team": "Compliance"
}
```

Pertanyaan:

- Apakah ini breaking?
- Apakah perlu v2?
- Apa alternatif compatible?

Jawaban yang baik:

```text
Ini breaking jika field existing `assignedOfficer` berubah dari string menjadi object.
Alternatif compatible: tambahkan field baru `assignedOfficerDetail` dan pertahankan `assignedOfficer`.
Jika ingin membersihkan contract, buat v2 dengan object representation.
```

### Exercise 2

V1 memakai offset pagination. Requirement baru ingin cursor pagination untuk performa.

Pertanyaan:

- Apakah boleh mengganti behavior di endpoint yang sama?

Jawaban:

```text
Tidak ideal. Pagination model adalah contract. Buat v2 endpoint atau endpoint/capability terpisah, lalu dokumentasikan semantics cursor.
```

### Exercise 3

V1 error:

```json
{
  "code": "INVALID_REQUEST",
  "message": "Invalid request"
}
```

V2 ingin Problem Details.

Pertanyaan:

- Di mana perubahan paling aman dilakukan?

Jawaban:

```text
Gunakan error response factory/exception mapper yang version-aware. Jangan mengubah V1 error shape. Untuk V2, return `application/problem+json` atau documented JSON error contract baru.
```

---

## 38. Ringkasan

API versioning di Jersey bukan sekadar menentukan apakah path memakai `/v1`.

Inti sebenarnya:

```text
Versioning = compatibility management + lifecycle governance + runtime routing + representation discipline.
```

Prinsip penting:

1. Jangan expose persistence entity sebagai API contract.
2. Pisahkan DTO per version jika contract berubah.
3. Pertahankan shared domain/use case layer.
4. Hindari branch version tersebar di service/domain.
5. Version-kan error contract, validation, pagination, dan operational behavior jika berubah.
6. Gunakan `Vary` ketika response bergantung pada header/media negotiation.
7. Observability per version wajib untuk migration.
8. Deprecation tanpa sunset akan membuat legacy hidup selamanya.
9. Jangan buat version baru untuk perubahan additive yang benar-benar compatible.
10. Jangan menganggap perubahan semantic sebagai non-breaking hanya karena JSON shape sama.

Dengan pola ini, Jersey resource tidak menjadi kumpulan endpoint historis yang rapuh, tetapi menjadi adapter layer yang bisa berevolusi secara disiplin.

---

## 39. Status Seri

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
Part 21 — berikutnya
...
Part 32 — target akhir / capstone
```

Part berikutnya:

> **Part 21 — Hypermedia, Links, URI Building, and REST Maturity Pragmatism**

---

## 40. Referensi

Referensi utama yang relevan untuk bagian ini:

- Jakarta RESTful Web Services 4.0 Specification — resource methods, request matching, media type negotiation, response API.
- Eclipse Jersey Documentation — Jersey runtime, resource configuration, providers, filters, and implementation behavior.
- RFC 9110 — HTTP Semantics, termasuk method/status/header semantics.
- RFC 8594 — Sunset HTTP Header Field untuk lifecycle deprecation/sunset.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./19-validation-strategy-bean-validation-request-contract-group-error-shape.md">⬅️ Part 19 — Validation Strategy: Bean Validation, Request Contract, Group, and Error Shape</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./20-api-versioning-and-compatibility-with-jersey.md">Part 20 — API Versioning and Compatibility with Jersey ➡️</a>
</div>
