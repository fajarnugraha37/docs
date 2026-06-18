# learn-java-testing-benchmarking-performance-jvm-part-010

# Testing HTTP API, REST Resource, Serialization, Validation, dan Compatibility

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas persistence testing: database nyata, transaction boundary, isolation, locking, migration, query correctness, dan constraint behavior. Part ini naik satu boundary ke atas: **HTTP API boundary**.

HTTP API test sering terlihat sederhana:

```text
request masuk -> response keluar -> assert status code
```

Tetapi pada sistem enterprise, terutama sistem case-management, regulatory workflow, B2B integration, atau public-facing service, HTTP API bukan sekadar controller. Ia adalah **contract boundary** antara sistem kita dan dunia luar.

Boundary ini harus menjawab pertanyaan:

1. Apakah endpoint menerima input yang benar?
2. Apakah endpoint menolak input yang salah dengan error yang jelas?
3. Apakah response format stabil?
4. Apakah perubahan field tetap backward-compatible?
5. Apakah serialization/deserialization tidak mengubah makna data?
6. Apakah authorization diterapkan pada seluruh kombinasi role, state, dan ownership?
7. Apakah error mapping tidak membocorkan implementation detail?
8. Apakah API client eksternal bisa tetap berjalan setelah deploy baru?
9. Apakah dependency HTTP eksternal bisa disimulasikan secara deterministik?
10. Apakah test HTTP ini membuktikan contract, bukan hanya membuktikan framework bisa menerima request?

Part ini akan membahas HTTP API test dari perspektif **evidence engineering**: bukti apa yang ingin kita hasilkan pada setiap layer test.

Referensi utama:

- JUnit User Guide: https://docs.junit.org/6.1.0/overview.html
- Spring MockMvc reference: https://docs.spring.io/spring-framework/reference/testing/mockmvc.html
- Spring testing reference: https://docs.spring.io/spring-framework/reference/testing.html
- Spring REST Docs guide: https://spring.io/guides/gs/testing-restdocs
- WireMock stubbing documentation: https://wiremock.org/docs/stubbing/
- WireMock Java docs: https://wiremock.org/docs/
- REST Assured docs: https://rest-assured.io/docs
- Pact documentation: https://docs.pact.io/
- Pact JVM repository: https://github.com/pact-foundation/pact-jvm
- OpenAPI Specification: https://spec.openapis.org/oas/latest.html
- Jakarta Bean Validation specification: https://beanvalidation.org/
- Jackson documentation: https://github.com/FasterXML/jackson-docs

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan API test di level controller/resource slice, full-stack integration, client integration, contract, dan end-to-end.
2. Mendesain HTTP API test berdasarkan risiko contract, bukan sekadar berdasarkan layer framework.
3. Menguji request/response JSON secara robust.
4. Menguji serialization/deserialization edge case: null, absent, unknown field, enum, date/time, BigDecimal, timezone, binary payload, dan nested object.
5. Menguji validation error dengan struktur error yang stabil.
6. Menguji authorization matrix pada API boundary.
7. Menguji backward compatibility dan API evolution.
8. Menggunakan MockMvc, REST Assured, WireMock, dan Pact secara tepat sesuai boundary.
9. Menentukan kapan API test harus memakai mock dependency, fake dependency, real service via Testcontainers, atau contract test.
10. Menghindari anti-pattern seperti brittle JSON string assertion, over-mocking controller, E2E-only confidence, dan contract yang tidak dipakai.

---

## 2. Mental Model: HTTP API sebagai Contract Boundary

HTTP API adalah boundary yang memisahkan dua dunia:

```text
External Consumer / Browser / Integration Partner
        |
        | HTTP Method + URL + Header + Body
        v
API Boundary
        |
        | Parsing, validation, authn/authz, mapping, orchestration
        v
Application / Domain / Persistence / External Dependency
```

Pada boundary ini, banyak hal bisa rusak walaupun business logic internal benar:

- URL salah.
- HTTP method salah.
- header hilang.
- content type salah.
- field JSON berubah nama.
- enum value berubah.
- date format berubah.
- timezone berubah.
- decimal precision berubah.
- null dan absent diperlakukan sama padahal semestinya berbeda.
- validation error tidak konsisten.
- authorization bypass pada state tertentu.
- error response membocorkan stack trace.
- backward compatibility rusak karena field mandatory baru.
- consumer lama gagal setelah deploy.

Karena itu, API test bukan hanya:

```java
mockMvc.perform(get("/api/cases/1"))
       .andExpect(status().isOk());
```

API test harus membuktikan **contract behavior**:

```text
Given user with role CASE_OFFICER
And case exists in state SUBMITTED
When user requests GET /cases/{id}
Then API returns 200
And response contains stable case identifier
And status is SUBMITTED
And confidential fields are hidden unless permission allows
And audit-sensitive fields have expected shape
And unknown internal fields are not leaked
```

Top-tier API testing dimulai dari pertanyaan:

```text
Siapa consumer-nya?
Apa contract yang mereka andalkan?
Apa yang boleh berubah?
Apa yang tidak boleh berubah?
Apa failure mode paling mahal?
Apa evidence paling murah untuk menangkap failure itu?
```

---

## 3. API Test Layer Taxonomy

Tidak semua API test sama. Kita perlu membedakan scope-nya.

### 3.1 Controller / Resource Slice Test

Tujuan:

- Menguji web layer saja.
- Routing.
- HTTP method.
- request parameter binding.
- JSON mapping request/response.
- validation annotation.
- exception handler.
- security filter tertentu jika diaktifkan.

Biasanya dependency application service di-mock.

Contoh tools:

- Spring MVC: `MockMvc`.
- Spring WebFlux: `WebTestClient`.
- Jakarta/JAX-RS: Jersey Test Framework, RESTEasy test utilities, atau HTTP-level test dengan embedded container.

Kapan cocok:

- ingin memastikan request mapping benar.
- ingin cepat feedback untuk validation/error response.
- ingin testing API contract shape tanpa database.
- ingin menguji controller advice / exception mapper.

Kapan tidak cukup:

- tidak membuktikan transaction.
- tidak membuktikan DB constraint.
- tidak membuktikan full security chain jika filter tidak dimuat.
- tidak membuktikan serialization pada object nyata jika mapper terlalu dimock.
- tidak membuktikan integration dengan downstream.

---

### 3.2 Full-Stack API Integration Test

Tujuan:

- Menjalankan aplikasi hampir utuh.
- HTTP request masuk melalui real web server atau test client.
- Application service nyata.
- Persistence nyata.
- Transaction nyata.
- Security chain nyata.
- External dependency biasanya disimulasikan dengan WireMock/fake server.

Tools:

- Spring Boot `@SpringBootTest(webEnvironment = RANDOM_PORT)`.
- REST Assured.
- WebTestClient.
- Testcontainers DB/broker.
- WireMock untuk dependency HTTP.

Kapan cocok:

- critical API flow.
- integration-heavy behavior.
- authorization matrix.
- create/update workflow.
- idempotency.
- DB constraint.
- realistic serialization.
- deployment confidence.

Trade-off:

- lebih lambat.
- lebih mahal setup-nya.
- flakiness lebih mungkin jika environment tidak deterministic.

---

### 3.3 Consumer Client Test

Tujuan:

- Menguji client code kita saat memanggil API eksternal.
- Request yang dikirim benar.
- Header/token benar.
- Retry/timeout/error mapping benar.
- Response eksternal diparse benar.

Tools:

- WireMock.
- MockWebServer.
- HTTP client mock server.

Kapan cocok:

- service kita bergantung pada API eksternal.
- API eksternal lambat/tidak stabil.
- ingin simulasi 400/401/429/500/timeout/malformed JSON.

---

### 3.4 Contract Test

Tujuan:

- Membuktikan kesesuaian antara consumer expectation dan provider behavior.
- Mengurangi risiko provider deploy merusak consumer.

Tools:

- Pact.
- Spring Cloud Contract.
- OpenAPI contract validation.

Kapan cocok:

- banyak consumer.
- consumer dan provider dikelola tim berbeda.
- release cadence berbeda.
- backward compatibility penting.
- API eksternal/internal dipakai lintas sistem.

Contract test bukan pengganti integration test. Ia menjawab pertanyaan berbeda:

```text
Apakah provider masih memenuhi contract yang dipakai consumer?
```

bukan:

```text
Apakah seluruh sistem bisnis berjalan benar end-to-end?
```

---

### 3.5 End-to-End Test

Tujuan:

- Menguji user journey lintas UI/API/service/db/external integration.

Kapan cocok:

- journey paling kritikal.
- smoke test deployment.
- production-like acceptance.

Kapan berbahaya:

- dipakai sebagai satu-satunya bukti correctness.
- terlalu banyak, lambat, flaky.
- debugging sulit karena failure bisa dari mana saja.

Rule praktis:

```text
E2E test membuktikan sistem terhubung.
API integration test membuktikan boundary behavior.
Unit/domain test membuktikan decision logic.
Contract test membuktikan compatibility antar service.
```

---

## 4. Evidence Matrix untuk API Testing

Gunakan matrix ini untuk memilih jenis test.

| Risiko | Test yang Cocok | Evidence yang Dicari |
|---|---|---|
| URL/method salah | Controller slice | route ditemukan dan method sesuai |
| Request JSON tidak bisa diparse | Slice/integration | deserialization berhasil/gagal sesuai contract |
| Validation tidak jalan | Slice | 400 + error body stabil |
| Error mapping bocor stack trace | Slice/integration | error response aman |
| Authorization bypass | Full-stack integration/security test | role/state/ownership ditolak/diizinkan benar |
| Transaction partial commit | Full-stack integration | DB state tetap konsisten setelah error |
| API response berubah field | Contract/schema test | consumer contract masih terpenuhi |
| Downstream timeout | Client test dengan WireMock | timeout/retry/fallback benar |
| Rate limit downstream | Client test + resilience test | 429 handling benar |
| Date/time salah timezone | Serialization test + API integration | format dan timezone stabil |
| Decimal precision berubah | Serialization + domain/API test | nilai tidak kehilangan precision |
| Consumer lama rusak | Contract/backward compatibility test | additive change aman |
| Pagination salah | API integration + DB fixture | stable ordering dan page metadata benar |
| Unknown field dari client | Deserialization test | reject/ignore sesuai policy |

---

## 5. HTTP Semantics yang Harus Diuji

Banyak bug API terjadi karena engineer menganggap HTTP hanya transport. Untuk API boundary, HTTP semantics adalah bagian dari contract.

### 5.1 Method Semantics

| Method | Umum Dipakai Untuk | Test Penting |
|---|---|---|
| GET | read resource | no mutation, cache header jika relevan, 404 jika tidak ada |
| POST | create/action | idempotency jika disyaratkan, duplicate handling, 201/202/200 semantics |
| PUT | replace/upsert | full replacement semantics, missing field behavior |
| PATCH | partial update | absent vs null, patch conflict, validation partial |
| DELETE | delete/cancel/archive | idempotent delete, permission, terminal state |

Contoh failure:

```text
PATCH /cases/{id}
body: { "remarks": null }
```

Apakah ini berarti:

1. remarks dihapus?
2. remarks dibiarkan unchanged?
3. request invalid?

Test harus eksplisit. Kalau tidak, behavior akan berubah diam-diam saat refactor mapper.

---

### 5.2 Status Code Semantics

Status code bukan dekorasi. Ia adalah contract.

| Status | Makna Umum | Test |
|---|---|---|
| 200 | sukses dengan body | response body shape |
| 201 | resource created | Location header jika policy mengharuskan |
| 202 | accepted async | job id/status endpoint |
| 204 | sukses tanpa body | body kosong |
| 400 | invalid request syntax/validation | field error stabil |
| 401 | belum authenticated | no sensitive body |
| 403 | authenticated tapi forbidden | permission matrix |
| 404 | resource tidak ditemukan atau disamarkan | no data leakage |
| 409 | conflict | optimistic lock/state conflict |
| 412 | precondition failed | ETag/version guard |
| 415 | unsupported media type | content type validation |
| 422 | semantic validation error jika dipakai | domain validation |
| 429 | rate limit | retry-after semantics jika ada |
| 500 | unexpected error | generic safe error |
| 503 | dependency unavailable | retry/fallback behavior |

Rule penting:

```text
Jangan asal pakai 500 untuk semua error.
Jangan asal pakai 400 untuk authorization failure.
Jangan membocorkan apakah resource ada jika security policy melarang enumeration.
```

---

### 5.3 Header Semantics

Header yang sering menjadi bagian contract:

- `Content-Type`
- `Accept`
- `Authorization`
- `Correlation-Id` / `X-Request-Id`
- `Idempotency-Key`
- `If-Match`
- `ETag`
- `Location`
- `Cache-Control`
- `Retry-After`
- custom tenant/agency header
- locale/language header

Test penting:

```text
Given request without Idempotency-Key
When endpoint requires idempotency
Then API returns 400 with stable error code
```

atau:

```text
Given outdated If-Match version
When updating case
Then API returns 412 and does not change DB state
```

---

## 6. Request Body Testing

### 6.1 Positive Request

Jangan hanya test happy path minimal. Test harus membuktikan contract input.

Contoh JSON create case:

```json
{
  "applicantId": "APP-001",
  "caseType": "LICENCE_RENEWAL",
  "submittedAt": "2026-06-16T09:30:00+07:00",
  "amount": "1234.50",
  "remarks": "Initial submission"
}
```

Test yang perlu:

- semua mandatory field diterima.
- optional field boleh absent.
- optional field null sesuai policy.
- enum valid diterima.
- date format valid diterima.
- decimal precision tidak berubah.
- unknown field sesuai policy.

---

### 6.2 Negative Request

Negative request jauh lebih penting untuk API defensibility.

Kategori:

1. Missing mandatory field.
2. Null mandatory field.
3. Blank string.
4. String terlalu panjang.
5. Invalid enum.
6. Invalid date format.
7. Invalid timezone.
8. Decimal terlalu banyak precision.
9. Negative number ketika tidak boleh.
10. Invalid nested object.
11. Duplicate array item.
12. Unknown property.
13. Malformed JSON.
14. Unsupported content type.
15. Body terlalu besar.
16. Inconsistent fields.

Contoh:

```json
{
  "caseType": "UNKNOWN_TYPE",
  "submittedAt": "16/06/2026",
  "amount": 1234.56789
}
```

Expected evidence:

```text
HTTP 400
error code: VALIDATION_FAILED
field errors:
- applicantId: REQUIRED
- caseType: INVALID_ENUM
- submittedAt: INVALID_DATE_FORMAT
- amount: INVALID_SCALE
```

---

## 7. Response Body Testing

Response test harus berada di antara dua ekstrem:

```text
Terlalu lemah:
- hanya assert status 200

Terlalu rapuh:
- assert seluruh JSON string exact match tanpa alasan
```

Strategi yang lebih baik:

1. Assert contract fields yang penting.
2. Assert field yang tidak boleh ada.
3. Assert type/format.
4. Assert semantic value.
5. Gunakan JSON path atau object mapping.
6. Untuk contract stabil, gunakan schema/contract validation.

Contoh response:

```json
{
  "id": "CASE-2026-0001",
  "status": "SUBMITTED",
  "submittedAt": "2026-06-16T09:30:00+07:00",
  "applicant": {
    "id": "APP-001",
    "name": "PT Example"
  },
  "links": {
    "self": "/api/cases/CASE-2026-0001"
  }
}
```

Assertions:

```text
status == 200
$.id == CASE-2026-0001
$.status == SUBMITTED
$.submittedAt matches ISO_OFFSET_DATE_TIME
$.applicant.id == APP-001
$.internalWorkflowId does not exist
$.links.self exists
```

---

## 8. Serialization and Deserialization Edge Cases

Serialization bugs sangat berbahaya karena sering tidak terlihat di unit test domain.

### 8.1 Null vs Absent

JSON:

```json
{ "remarks": null }
```

berbeda dengan:

```json
{}
```

Untuk PATCH, perbedaan ini krusial.

Possible semantics:

| Input | Meaning |
|---|---|
| absent | leave unchanged |
| null | clear value |
| blank | invalid |

Test eksplisit:

```text
PATCH without remarks -> remarks unchanged
PATCH remarks=null -> remarks cleared
PATCH remarks="" -> 400 if blank forbidden
```

---

### 8.2 Unknown Property

Policy harus jelas:

```text
Strict API:
unknown field -> 400

Lenient API:
unknown field -> ignored
```

Strict cocok untuk:

- internal API dengan strong contract.
- safety-critical command endpoint.
- regulatory update command.

Lenient cocok untuk:

- public API yang perlu forward compatibility.
- consumer lama/baru berjalan paralel.

Test:

```json
{
  "applicantId": "APP-001",
  "caseType": "RENEWAL",
  "unknownField": "oops"
}
```

Expected sesuai policy.

---

### 8.3 Enum Evolution

Enum rentan breaking change.

Contoh:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Risiko:

- rename enum value.
- remove enum value.
- add enum value yang consumer lama tidak kenal.
- lowercase/uppercase mismatch.

Test:

- valid enum accepted.
- invalid enum rejected dengan error stabil.
- response enum tidak berubah tanpa versioning.

Untuk consumer client, pertimbangkan fallback:

```java
UNKNOWN
```

untuk menghindari client crash saat provider menambah enum baru.

---

### 8.4 Date/Time

Date/time API bug umum:

- timezone hilang.
- local date dianggap UTC.
- offset berubah.
- daylight saving issue.
- date-only vs date-time tertukar.
- nanosecond precision hilang.

Policy yang harus diuji:

| Data | Format Umum |
|---|---|
| instant event | `Instant` / ISO instant UTC |
| user local date | `LocalDate` |
| scheduled local time | `ZonedDateTime` atau local + zone |
| API offset timestamp | `OffsetDateTime` |

Contoh test:

```text
Given submittedAt = 2026-06-16T09:30:00+07:00
When serialized
Then response preserves offset or normalizes to documented UTC format
```

Jangan biarkan format date ditentukan implicit oleh default ObjectMapper tanpa test.

---

### 8.5 BigDecimal and Money

BigDecimal bug sering terjadi karena:

- JSON number diparse menjadi double.
- scale hilang.
- precision berubah.
- string vs number tidak konsisten.

Untuk money/regulatory fee, lebih aman menguji:

```json
{
  "amount": "1234.50"
}
```

atau jika number dipakai:

```json
{
  "amount": 1234.50
}
```

pastikan deserialization ke `BigDecimal`, bukan `double`.

Test:

```text
1234.50 tetap 1234.50
1234.567 ditolak jika scale maksimal 2
0.00 diterima/ditolak sesuai domain
-1.00 ditolak jika amount tidak boleh negatif
```

---

### 8.6 Boolean and Tri-State

Boolean API sering terlihat sederhana tetapi bisa misleading.

```json
{ "active": false }
```

berbeda dari:

```json
{}
```

Jika `Boolean` wrapper dipakai, ada tiga state:

```text
true
false
null/absent
```

Untuk command API, pastikan test membedakan ketiganya.

---

## 9. Validation Testing

Validation bukan hanya annotation. Validation adalah bagian dari external contract.

### 9.1 Bean Validation Level

Contoh DTO:

```java
public record SubmitCaseRequest(
        @NotBlank String applicantId,
        @NotNull CaseType caseType,
        @NotNull @PastOrPresent OffsetDateTime submittedAt,
        @NotNull @DecimalMin("0.00") @Digits(integer = 12, fraction = 2) BigDecimal amount,
        @Size(max = 1000) String remarks
) {}
```

Test:

- missing `applicantId`.
- blank `applicantId`.
- null `caseType`.
- invalid enum JSON.
- future `submittedAt` jika tidak boleh.
- amount negative.
- amount precision terlalu besar.
- remarks terlalu panjang.

---

### 9.2 Cross-Field Validation

Tidak semua validation bisa annotation per field.

Contoh:

```text
If caseType = APPEAL,
then appealReferenceId is required.
```

atau:

```text
If applicant is corporate,
then companyRegistrationNo is required.
```

Test harus menargetkan rule ini eksplisit.

---

### 9.3 Domain Validation vs DTO Validation

DTO validation menjawab:

```text
Apakah request shape valid?
```

Domain validation menjawab:

```text
Apakah command ini sah dalam kondisi bisnis saat ini?
```

Contoh:

```text
DTO valid:
POST /cases/{id}/approve
body: { "remarks": "ok" }

Domain invalid:
case masih DRAFT, jadi belum bisa approved.
```

Status code mungkin:

```text
409 CONFLICT
atau 422 UNPROCESSABLE ENTITY
```

tergantung API policy.

Test harus membedakan:

```text
Invalid request shape -> 400
Invalid business transition -> 409/422
Forbidden user -> 403
Not found -> 404
```

---

## 10. Error Response Contract

Error response harus stabil. Jangan biarkan framework default error body menjadi public contract tanpa sadar.

Contoh error body yang baik:

```json
{
  "errorId": "ERR-20260616-00001",
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed.",
  "details": [
    {
      "field": "applicantId",
      "code": "REQUIRED",
      "message": "Applicant id is required."
    },
    {
      "field": "amount",
      "code": "INVALID_SCALE",
      "message": "Amount must have at most 2 decimal places."
    }
  ]
}
```

Test:

- `code` stabil.
- `details[].field` benar.
- `details[].code` benar.
- no stack trace.
- no SQL error.
- no Java class name.
- `errorId`/correlation id ada jika policy.

Anti-pattern:

```json
{
  "timestamp": "...",
  "status": 500,
  "error": "Internal Server Error",
  "trace": "java.lang.NullPointerException..."
}
```

Untuk internal dev environment boleh ada trace, tetapi production API test harus memastikan trace tidak bocor.

---

## 11. Spring MVC API Testing dengan MockMvc

MockMvc cocok untuk web layer test karena menjalankan full Spring MVC request handling memakai mock request/response object, bukan real server.

### 11.1 Dependency Example

Maven contoh modern Spring Boot:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
```

Biasanya sudah mencakup JUnit Jupiter, AssertJ, Hamcrest, JSONassert, JsonPath, dan Spring Test.

---

### 11.2 Controller Example

```java
@RestController
@RequestMapping("/api/cases")
class CaseController {

    private final CaseApplicationService service;

    CaseController(CaseApplicationService service) {
        this.service = service;
    }

    @PostMapping
    ResponseEntity<CaseResponse> submit(@Valid @RequestBody SubmitCaseRequest request) {
        CaseResponse response = service.submit(request);
        URI location = URI.create("/api/cases/" + response.id());
        return ResponseEntity.created(location).body(response);
    }

    @GetMapping("/{id}")
    CaseResponse get(@PathVariable String id) {
        return service.get(id);
    }
}
```

DTO:

```java
record SubmitCaseRequest(
        @NotBlank String applicantId,
        @NotNull CaseType caseType,
        @NotNull OffsetDateTime submittedAt,
        @NotNull BigDecimal amount,
        @Size(max = 1000) String remarks
) {}

record CaseResponse(
        String id,
        String status,
        OffsetDateTime submittedAt,
        BigDecimal amount
) {}
```

---

### 11.3 Slice Test

```java
@WebMvcTest(CaseController.class)
class CaseControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private CaseApplicationService service;

    @Test
    void submit_returns201AndLocation_whenRequestIsValid() throws Exception {
        given(service.submit(any())).willReturn(new CaseResponse(
                "CASE-2026-0001",
                "SUBMITTED",
                OffsetDateTime.parse("2026-06-16T09:30:00+07:00"),
                new BigDecimal("1234.50")
        ));

        mockMvc.perform(post("/api/cases")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "applicantId": "APP-001",
                                  "caseType": "LICENCE_RENEWAL",
                                  "submittedAt": "2026-06-16T09:30:00+07:00",
                                  "amount": "1234.50",
                                  "remarks": "Initial submission"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/cases/CASE-2026-0001"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.id").value("CASE-2026-0001"))
                .andExpect(jsonPath("$.status").value("SUBMITTED"))
                .andExpect(jsonPath("$.amount").value(1234.50));
    }
}
```

Catatan:

- Test ini membuktikan controller mapping, status, header, dan response shape.
- Ia tidak membuktikan service benar.
- Ia tidak membuktikan DB state.
- Ia tidak membuktikan full security jika security config tidak dimuat.

---

### 11.4 Validation Error Test

```java
@Test
void submit_returns400_whenApplicantIdIsBlank() throws Exception {
    mockMvc.perform(post("/api/cases")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {
                              "applicantId": "",
                              "caseType": "LICENCE_RENEWAL",
                              "submittedAt": "2026-06-16T09:30:00+07:00",
                              "amount": "1234.50"
                            }
                            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.details[?(@.field == 'applicantId')]").exists());
}
```

Untuk membuat ini stabil, kamu perlu global exception handler.

---

### 11.5 Exception Handler Example

```java
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
        List<FieldErrorDetail> details = ex.getBindingResult()
                .getFieldErrors()
                .stream()
                .map(error -> new FieldErrorDetail(
                        error.getField(),
                        mapValidationCode(error),
                        "Invalid value."
                ))
                .toList();

        return ResponseEntity.badRequest().body(new ApiError(
                "VALIDATION_FAILED",
                "Request validation failed.",
                details
        ));
    }

    private String mapValidationCode(org.springframework.validation.FieldError error) {
        return switch (error.getCode()) {
            case "NotBlank" -> "REQUIRED";
            case "NotNull" -> "REQUIRED";
            case "Size" -> "INVALID_LENGTH";
            default -> "INVALID_VALUE";
        };
    }
}

record ApiError(String code, String message, List<FieldErrorDetail> details) {}
record FieldErrorDetail(String field, String code, String message) {}
```

Test error handler sebagai part of API contract. Jangan hanya berharap framework default cukup.

---

## 12. Full-Stack API Integration Test dengan REST Assured

REST Assured cocok untuk test HTTP API dengan syntax fluent.

### 12.1 Spring Boot Random Port Example

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class CaseApiIntegrationTest {

    @LocalServerPort
    int port;

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @BeforeEach
    void configureRestAssured() {
        RestAssured.port = port;
    }

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Test
    void submit_persistsCaseAndReturnsCreatedResponse() {
        given()
                .contentType(ContentType.JSON)
                .body("""
                        {
                          "applicantId": "APP-001",
                          "caseType": "LICENCE_RENEWAL",
                          "submittedAt": "2026-06-16T09:30:00+07:00",
                          "amount": "1234.50"
                        }
                        """)
        .when()
                .post("/api/cases")
        .then()
                .statusCode(201)
                .header("Location", startsWith("/api/cases/"))
                .body("id", notNullValue())
                .body("status", equalTo("SUBMITTED"));
    }
}
```

Test ini membuktikan lebih banyak daripada MockMvc slice:

- application context boot.
- HTTP stack lebih real.
- serialization config real.
- service real.
- DB real.
- transaction real.
- migration real jika Flyway/Liquibase aktif.

---

### 12.2 DB State Assertion

Jangan hanya assert response jika command seharusnya persist state.

```java
@Test
void submit_persistsAuditTrail() {
    String caseId = given()
            .contentType(ContentType.JSON)
            .body(validSubmitCaseJson())
    .when()
            .post("/api/cases")
    .then()
            .statusCode(201)
            .extract()
            .path("id");

    assertThat(jdbcTemplate.queryForObject(
            "select status from cases where id = ?",
            String.class,
            caseId
    )).isEqualTo("SUBMITTED");

    assertThat(jdbcTemplate.queryForObject(
            "select count(*) from audit_trail where entity_id = ? and action = ?",
            Integer.class,
            caseId,
            "CASE_SUBMITTED"
    )).isEqualTo(1);
}
```

Ini penting untuk regulatory system: response 201 tanpa audit bisa tetap salah.

---

## 13. Testing Jakarta/JAX-RS Resource

Karena seri sebelumnya sudah membahas Jakarta/JAX-RS, di sini kita fokus pada testing concern-nya.

Resource:

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final CaseApplicationService service;

    public CaseResource(CaseApplicationService service) {
        this.service = service;
    }

    @POST
    public Response submit(@Valid SubmitCaseRequest request) {
        CaseResponse response = service.submit(request);
        return Response
                .created(URI.create("/cases/" + response.id()))
                .entity(response)
                .build();
    }

    @GET
    @Path("/{id}")
    public CaseResponse get(@PathParam("id") String id) {
        return service.get(id);
    }
}
```

Testing options:

1. Resource unit test:
   - instantiate resource directly.
   - mock service.
   - assert `Response` object.
   - fast but does not prove serialization/routing.

2. In-memory JAX-RS container test:
   - Jersey Test Framework / RESTEasy embedded.
   - route and provider mapping are tested.

3. Full HTTP test:
   - start app/container.
   - REST Assured HTTP request.
   - closer to production.

Direct resource unit test:

```java
@Test
void submit_returnsCreatedResponse() {
    CaseApplicationService service = mock(CaseApplicationService.class);
    given(service.submit(any())).willReturn(new CaseResponse("CASE-1", "SUBMITTED"));

    CaseResource resource = new CaseResource(service);

    Response response = resource.submit(new SubmitCaseRequest("APP-1", CaseType.RENEWAL));

    assertThat(response.getStatus()).isEqualTo(201);
    assertThat(response.getLocation().toString()).isEqualTo("/cases/CASE-1");
}
```

Ini berguna, tetapi jangan berhenti di sini. Resource unit test tidak membuktikan JSON provider, exception mapper, filter, security context, atau validation integration.

---

## 14. Testing JSON Mapper Secara Terpisah

Untuk serialization yang critical, test ObjectMapper langsung.

### 14.1 ObjectMapper Round Trip

```java
class CaseJsonTest {

    private final ObjectMapper mapper = JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .build();

    @Test
    void serialize_preservesOffsetDateTimeFormat() throws Exception {
        CaseResponse response = new CaseResponse(
                "CASE-1",
                "SUBMITTED",
                OffsetDateTime.parse("2026-06-16T09:30:00+07:00"),
                new BigDecimal("1234.50")
        );

        String json = mapper.writeValueAsString(response);

        assertThatJson(json)
                .inPath("$.submittedAt")
                .isEqualTo("2026-06-16T09:30:00+07:00");
    }
}
```

Jika tidak memakai JSON assertion library, bisa parse ke tree:

```java
JsonNode root = mapper.readTree(json);
assertThat(root.get("submittedAt").asText())
        .isEqualTo("2026-06-16T09:30:00+07:00");
```

---

### 14.2 Unknown Field Policy Test

```java
@Test
void deserialize_rejectsUnknownField_whenApiIsStrict() {
    String json = """
            {
              "applicantId": "APP-001",
              "caseType": "LICENCE_RENEWAL",
              "unknown": "value"
            }
            """;

    assertThatThrownBy(() -> mapper.readValue(json, SubmitCaseRequest.class))
            .isInstanceOf(UnrecognizedPropertyException.class);
}
```

Untuk lenient API:

```java
@Test
void deserialize_ignoresUnknownField_whenForwardCompatibilityIsRequired() throws Exception {
    SubmitCaseRequest request = mapper.readValue("""
            {
              "applicantId": "APP-001",
              "caseType": "LICENCE_RENEWAL",
              "unknown": "value"
            }
            """, SubmitCaseRequest.class);

    assertThat(request.applicantId()).isEqualTo("APP-001");
}
```

---

## 15. JSON Assertion Strategy

### 15.1 Avoid Raw String Equality

Fragile:

```java
assertThat(responseBody).isEqualTo("{\"id\":\"CASE-1\",\"status\":\"SUBMITTED\"}");
```

Masalah:

- field order berubah.
- whitespace berubah.
- optional field tambahan bikin gagal.
- debugging sulit.

Lebih baik:

```java
JsonNode root = mapper.readTree(responseBody);
assertThat(root.get("id").asText()).isEqualTo("CASE-1");
assertThat(root.get("status").asText()).isEqualTo("SUBMITTED");
assertThat(root.has("internalWorkflowId")).isFalse();
```

Atau dengan JSON path:

```java
.andExpect(jsonPath("$.id").value("CASE-1"))
.andExpect(jsonPath("$.status").value("SUBMITTED"))
.andExpect(jsonPath("$.internalWorkflowId").doesNotExist());
```

---

### 15.2 When Exact JSON Is Valid

Exact JSON comparison boleh jika:

- API contract sangat stabil.
- response kecil.
- field order irrelevant jika library mendukung strict semantic comparison.
- snapshot/approval testing dipakai secara sadar.

Tetapi jangan jadikan exact JSON default untuk semua API test.

---

## 16. Authorization Matrix API Test

Authorization bug sering tidak terlihat jika test hanya happy path.

Contoh rule:

```text
CASE_OFFICER can view submitted case in own agency.
CASE_OFFICER cannot view case from other agency.
SUPERVISOR can approve case in own agency.
APPLICANT can view own application but not internal remarks.
ADMIN can view all but cannot approve if not assigned.
```

Matrix:

| Role | State | Ownership | Expected |
|---|---|---|---|
| Applicant | Own Draft | own | 200 |
| Applicant | Other Draft | other | 404/403 |
| Officer | Submitted | same agency | 200 |
| Officer | Submitted | other agency | 403/404 |
| Supervisor | Under Review | same agency | can approve |
| Supervisor | Approved | same agency | cannot approve, 409 |
| Admin | Any | any | view only depending policy |

Parameterized test:

```java
@ParameterizedTest
@MethodSource("authorizationCases")
void getCase_enforcesAuthorization(
        String role,
        String caseOwnerAgency,
        String userAgency,
        int expectedStatus
) {
    String token = tokenFor(role, userAgency);
    String caseId = createCaseOwnedBy(caseOwnerAgency);

    given()
            .auth().oauth2(token)
    .when()
            .get("/api/cases/{id}", caseId)
    .then()
            .statusCode(expectedStatus);
}

static Stream<Arguments> authorizationCases() {
    return Stream.of(
            arguments("CASE_OFFICER", "AGENCY-A", "AGENCY-A", 200),
            arguments("CASE_OFFICER", "AGENCY-B", "AGENCY-A", 403),
            arguments("APPLICANT", "AGENCY-A", "AGENCY-A", 403)
    );
}
```

Important design choice:

```text
403 vs 404
```

Jika resource existence harus disembunyikan, unauthorized access boleh mengembalikan 404. Tetapi test harus eksplisit agar behavior konsisten.

---

## 17. Testing API Versioning dan Backward Compatibility

API evolution rule:

```text
Provider boleh berubah internal.
Provider tidak boleh mematahkan consumer contract tanpa versioning/deprecation/migration plan.
```

### 17.1 Additive Change

Biasanya aman:

```json
{
  "id": "CASE-1",
  "status": "SUBMITTED",
  "newField": "value"
}
```

Tetapi bisa tidak aman jika consumer strict deserialization dan gagal pada unknown field.

Karena itu, contract test harus mempertimbangkan consumer behavior.

---

### 17.2 Breaking Changes

Breaking:

- remove field.
- rename field.
- change type.
- change enum value.
- change date format.
- make optional field mandatory.
- change error code.
- change status code.
- change pagination semantics.
- change authorization result.

Test compatibility harus menangkap ini.

---

### 17.3 Versioning Strategies

Common strategies:

```text
URI versioning:
/api/v1/cases
/api/v2/cases

Header versioning:
Accept: application/vnd.company.case.v1+json

Parameter versioning:
/api/cases?version=1
```

Setiap strategy punya trade-off. Yang penting: test harus menegakkan policy.

Example:

```java
@Test
void v1_getCase_doesNotExposeNewInternalReviewField() {
    given()
            .accept("application/vnd.company.case.v1+json")
    .when()
            .get("/api/cases/CASE-1")
    .then()
            .statusCode(200)
            .body("internalReviewScore", nullValue());
}
```

---

## 18. OpenAPI Contract Validation

OpenAPI specification berguna sebagai machine-readable API contract.

Namun ada jebakan:

```text
OpenAPI file yang tidak diuji = dokumentasi yang bisa bohong.
```

Gunakan OpenAPI untuk:

- generate docs.
- validate request/response schema.
- generate client.
- compare breaking changes.
- support contract testing.

Test yang berguna:

1. API implementation conforms to OpenAPI response schema.
2. OpenAPI examples valid.
3. No undocumented endpoint exposed jika policy ketat.
4. Breaking change detection pada PR.
5. Generated client compatibility.

OpenAPI bukan pengganti semantic test. Schema bisa bilang field `status` adalah string, tetapi tidak tahu apakah `APPROVED` boleh muncul saat state masih `DRAFT`.

---

## 19. Consumer-Driven Contract Testing dengan Pact

Pact cocok ketika consumer ingin mendefinisikan bagian provider API yang benar-benar dipakai.

Mental model:

```text
Consumer test generates pact file.
Provider verification checks provider can satisfy pact.
Broker shares contracts and verification status.
```

Flow:

```text
Consumer Team
  writes test against Pact mock provider
  generates pact contract
  publishes contract

Provider Team
  fetches contract
  runs provider verification
  proves provider still satisfies consumer expectation
```

Kelebihan:

- mencegah provider merusak consumer.
- hanya behavior yang dipakai consumer yang diuji.
- cocok untuk microservice/team boundary.

Keterbatasan:

- tidak menggantikan provider business tests.
- tidak membuktikan seluruh API benar.
- contract bisa terlalu sempit jika consumer test buruk.
- butuh governance.

Contoh expectation consumer:

```text
Given case CASE-1 exists
When GET /api/cases/CASE-1
Then response 200
And body contains id and status
```

Provider verification memastikan endpoint provider memenuhi contract itu.

---

## 20. Testing External HTTP Client dengan WireMock

Misal service kita memanggil external address API.

Client:

```java
class AddressClient {

    private final WebClient webClient;

    AddressClient(WebClient webClient) {
        this.webClient = webClient;
    }

    Address lookupPostalCode(String postalCode) {
        return webClient.get()
                .uri("/addresses/{postalCode}", postalCode)
                .retrieve()
                .bodyToMono(Address.class)
                .block(Duration.ofSeconds(2));
    }
}
```

WireMock test:

```java
class AddressClientTest {

    static WireMockServer wireMock = new WireMockServer(options().dynamicPort());

    @BeforeAll
    static void start() {
        wireMock.start();
    }

    @AfterAll
    static void stop() {
        wireMock.stop();
    }

    @BeforeEach
    void reset() {
        wireMock.resetAll();
    }

    @Test
    void lookupPostalCode_sendsExpectedRequestAndParsesResponse() {
        wireMock.stubFor(get(urlEqualTo("/addresses/123456"))
                .willReturn(okJson("""
                        {
                          "postalCode": "123456",
                          "street": "Main Street"
                        }
                        """)));

        AddressClient client = new AddressClient(WebClient.builder()
                .baseUrl(wireMock.baseUrl())
                .build());

        Address address = client.lookupPostalCode("123456");

        assertThat(address.postalCode()).isEqualTo("123456");
        assertThat(address.street()).isEqualTo("Main Street");

        wireMock.verify(getRequestedFor(urlEqualTo("/addresses/123456")));
    }
}
```

---

### 20.1 Testing Error Handling with WireMock

```java
@Test
void lookupPostalCode_maps404ToAddressNotFound() {
    wireMock.stubFor(get(urlEqualTo("/addresses/999999"))
            .willReturn(notFound().withBody("""
                    { "code": "NOT_FOUND" }
                    """)));

    AddressClient client = newClient(wireMock.baseUrl());

    assertThatThrownBy(() -> client.lookupPostalCode("999999"))
            .isInstanceOf(AddressNotFoundException.class);
}
```

---

### 20.2 Testing Timeout

```java
@Test
void lookupPostalCode_timesOut_whenProviderIsTooSlow() {
    wireMock.stubFor(get(urlEqualTo("/addresses/123456"))
            .willReturn(aResponse()
                    .withFixedDelay(3000)
                    .withHeader("Content-Type", "application/json")
                    .withBody("{}")));

    AddressClient client = newClientWithTimeout(wireMock.baseUrl(), Duration.ofMillis(500));

    assertThatThrownBy(() -> client.lookupPostalCode("123456"))
            .isInstanceOf(AddressProviderTimeoutException.class);
}
```

Test timeout harus deterministic. Jangan bergantung pada sleep acak dan timeout terlalu dekat.

---

### 20.3 Testing 429 Rate Limit

```java
@Test
void lookupPostalCode_retriesAfterRateLimit() {
    wireMock.stubFor(get(urlEqualTo("/addresses/123456"))
            .inScenario("rate-limit")
            .whenScenarioStateIs(STARTED)
            .willReturn(aResponse()
                    .withStatus(429)
                    .withHeader("Retry-After", "1"))
            .willSetStateTo("retry-success"));

    wireMock.stubFor(get(urlEqualTo("/addresses/123456"))
            .inScenario("rate-limit")
            .whenScenarioStateIs("retry-success")
            .willReturn(okJson("""
                    { "postalCode": "123456", "street": "Main Street" }
                    """)));

    Address address = client.lookupPostalCode("123456");

    assertThat(address.street()).isEqualTo("Main Street");

    wireMock.verify(2, getRequestedFor(urlEqualTo("/addresses/123456")));
}
```

Catatan: untuk production-grade retry test, gunakan fake clock/backoff abstraction agar test tidak lambat.

---

## 21. Testing Pagination, Sorting, and Filtering

Pagination bug umum:

- page 0 vs page 1 mismatch.
- sort tidak stable.
- duplicate/missing item antar page.
- total count salah.
- filter tidak konsisten.
- default sort berubah.

Response example:

```json
{
  "items": [
    { "id": "CASE-1", "status": "SUBMITTED" }
  ],
  "page": {
    "number": 0,
    "size": 20,
    "totalElements": 101,
    "totalPages": 6
  }
}
```

Test:

```text
GET /api/cases?page=0&size=2&sort=submittedAt,desc
returns first 2 newest cases
metadata totalElements correct
stable tie-breaker by id if submittedAt equal
```

Tie-breaker penting. Tanpa stable ordering, page 1 dan page 2 bisa overlap saat banyak row punya timestamp sama.

Recommended sort:

```sql
order by submitted_at desc, id desc
```

Test dataset harus memasukkan timestamp sama untuk membuktikan tie-breaker.

---

## 22. Testing Search API

Search/filter API perlu test kombinasi.

Contoh filters:

- status.
- applicant id.
- date range.
- agency.
- assigned officer.
- keyword.
- archived flag.

Jangan exhaustive cartesian product tanpa alasan. Pilih berdasarkan risk.

Test categories:

1. Single filter.
2. Combined filter high-value.
3. Empty result.
4. Invalid filter.
5. Boundary date range.
6. Authorization filter interaction.
7. Pagination + filter.
8. Sort + filter.

Critical regulatory test:

```text
Officer from agency A searches all submitted cases.
Result must not include agency B cases even if filter omits agency.
```

Ini bukan sekadar search correctness. Ini data isolation.

---

## 23. Testing File Upload/Download API

Walaupun I/O sudah dibahas di seri lain, API-level file behavior perlu test.

### 23.1 Upload Test

Risiko:

- wrong content type.
- oversized file.
- empty file.
- malicious filename.
- path traversal.
- virus scan pending.
- metadata mismatch.
- transaction issue: DB saved but file failed.

MockMvc multipart:

```java
@Test
void uploadDocument_acceptsPdfAndReturnsDocumentId() throws Exception {
    MockMultipartFile file = new MockMultipartFile(
            "file",
            "evidence.pdf",
            "application/pdf",
            "%PDF-1.4 fake content".getBytes(StandardCharsets.UTF_8)
    );

    mockMvc.perform(multipart("/api/cases/CASE-1/documents")
                    .file(file)
                    .param("documentType", "EVIDENCE"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.documentId").exists());
}
```

Negative tests:

- `.exe` rejected.
- missing file rejected.
- file too large rejected.
- filename `../../secret.txt` sanitized/rejected.

---

### 23.2 Download Test

Test:

- status 200.
- `Content-Type` correct.
- `Content-Disposition` correct.
- authorization enforced.
- not found behavior.
- range request if supported.
- no cache if sensitive.

```java
mockMvc.perform(get("/api/documents/DOC-1/download"))
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "application/pdf"))
        .andExpect(header().string("Content-Disposition", containsString("filename=\"evidence.pdf\"")));
```

---

## 24. Testing Idempotent HTTP Commands

For command endpoint:

```http
POST /api/cases
Idempotency-Key: abc-123
```

Test scenarios:

1. First request succeeds.
2. Same key + same body returns same result.
3. Same key + different body returns 409.
4. Concurrent same key creates only one resource.
5. Failed request behavior is defined.
6. Key expiration behavior is defined.

Example:

```java
@Test
void submit_withSameIdempotencyKey_returnsSameCase() {
    String key = "idem-123";
    String body = validSubmitCaseJson();

    String firstId = given()
            .header("Idempotency-Key", key)
            .contentType(ContentType.JSON)
            .body(body)
    .when()
            .post("/api/cases")
    .then()
            .statusCode(201)
            .extract().path("id");

    String secondId = given()
            .header("Idempotency-Key", key)
            .contentType(ContentType.JSON)
            .body(body)
    .when()
            .post("/api/cases")
    .then()
            .statusCode(201)
            .extract().path("id");

    assertThat(secondId).isEqualTo(firstId);
}
```

Concurrent idempotency test belongs in integration/concurrency part, but API-level scenario should still exist.

---

## 25. Testing Optimistic Locking and ETag

For update endpoint:

```http
PUT /api/cases/CASE-1
If-Match: "v3"
```

Scenarios:

1. Matching version -> update success.
2. Missing `If-Match` -> 428 Precondition Required or policy-specific error.
3. Stale version -> 412 Precondition Failed.
4. Response returns new ETag.

Example:

```java
@Test
void update_returns412_whenETagIsStale() {
    given()
            .header("If-Match", "\"v2\"")
            .contentType(ContentType.JSON)
            .body(updateRequestJson())
    .when()
            .put("/api/cases/CASE-1")
    .then()
            .statusCode(412)
            .body("code", equalTo("STALE_VERSION"));
}
```

This test protects against lost update.

---

## 26. Security-Sensitive API Test Cases

Minimal security API test categories:

1. No token -> 401.
2. Invalid token -> 401.
3. Expired token -> 401.
4. Valid token without role -> 403.
5. Valid role wrong tenant/agency -> 403/404.
6. Valid role wrong resource state -> 409/403 depending rule.
7. Sensitive field hidden.
8. Mass assignment blocked.
9. Over-posting blocked.
10. CORS policy if browser-facing.
11. CSRF if cookie-based auth.
12. Rate limit if relevant.

### 26.1 Mass Assignment Test

Request:

```json
{
  "applicantId": "APP-001",
  "caseType": "RENEWAL",
  "status": "APPROVED",
  "approvedBy": "attacker"
}
```

Expected:

```text
status field ignored or rejected
created case must not become APPROVED
```

Test:

```java
@Test
void submit_rejectsClientProvidedStatus() {
    given()
            .contentType(ContentType.JSON)
            .body("""
                    {
                      "applicantId": "APP-001",
                      "caseType": "RENEWAL",
                      "status": "APPROVED"
                    }
                    """)
    .when()
            .post("/api/cases")
    .then()
            .statusCode(400)
            .body("code", equalTo("UNKNOWN_OR_FORBIDDEN_FIELD"));
}
```

If policy is ignore unknown field, then assert DB state:

```text
case.status == SUBMITTED, not APPROVED
```

---

## 27. API Testing and Observability

A top-tier API test can also assert observability side effects for critical boundaries.

Examples:

- correlation id propagated.
- audit trail created.
- metric incremented.
- structured log contains request id.
- external call includes trace header.

Be careful: logging tests can be brittle. Only test observability if it is a compliance/operational contract.

Example:

```text
Given X-Correlation-Id header
When submitting case
Then audit trail stores same correlation id
And response includes X-Correlation-Id
```

This is valuable in regulatory systems because it connects user action, API request, domain event, and audit evidence.

---

## 28. Java 8–25 Compatibility Notes

### 28.1 Java 8

- No text blocks; JSON strings are verbose.
- No records; DTOs are classes.
- JUnit 5 can run on Java 8 for many versions, but latest JUnit 6 requires Java 17+.
- Mockito version compatibility must be checked.
- Spring Boot 2.x common for Java 8 legacy.
- Jakarta namespace often still `javax.*` in older stacks.

JSON request in Java 8:

```java
String json = "{"
        + "\"applicantId\":\"APP-001\","
        + "\"caseType\":\"RENEWAL\""
        + "}";
```

Better: load from test resource file.

---

### 28.2 Java 11

- Still no text blocks until Java 15.
- Good baseline for many enterprise migrations.
- HTTP Client available in JDK for client testing, but many projects use Apache HttpClient, OkHttp, WebClient, or RestTemplate.

---

### 28.3 Java 17

- Records stable and useful for DTOs.
- Text blocks available.
- JUnit 6 requires Java 17+.
- Spring Boot 3 baseline requires Java 17+.
- Jakarta namespace migration relevant.

---

### 28.4 Java 21

- Virtual threads can affect API service architecture.
- Tests involving blocking HTTP clients and thread assumptions need review.
- ThreadLocal/security context propagation should be tested carefully.

---

### 28.5 Java 25

- Treat as modern JDK baseline for long-lived systems.
- Verify build plugin, test framework, bytecode target, Mockito/Byte Buddy compatibility, JaCoCo compatibility, and container images.
- Run API compatibility test matrix for libraries that rely on instrumentation.

---

## 29. Build Tool Structure

Recommended naming:

```text
src/test/java
  unit and slice tests

src/integrationTest/java
  full-stack API integration tests

src/contractTest/java
  provider/consumer contract tests
```

Gradle source sets example:

```kotlin
sourceSets {
    create("integrationTest") {
        java.srcDir("src/integrationTest/java")
        resources.srcDir("src/integrationTest/resources")
        compileClasspath += sourceSets.main.get().output + configurations.testRuntimeClasspath.get()
        runtimeClasspath += output + compileClasspath
    }
}

tasks.register<Test>("integrationTest") {
    description = "Runs integration tests."
    group = "verification"
    testClassesDirs = sourceSets["integrationTest"].output.classesDirs
    classpath = sourceSets["integrationTest"].runtimeClasspath
    shouldRunAfter(tasks.test)
}
```

Maven common approach:

- Surefire for unit/slice tests.
- Failsafe for integration tests.
- Naming:
  - `*Test.java`
  - `*IT.java`

---

## 30. Anti-Patterns

### 30.1 Only Status Code Assertion

Bad:

```java
.andExpect(status().isOk());
```

Better:

```java
.andExpect(status().isOk())
.andExpect(jsonPath("$.id").value("CASE-1"))
.andExpect(jsonPath("$.status").value("SUBMITTED"))
.andExpect(jsonPath("$.internalWorkflowId").doesNotExist());
```

---

### 30.2 Controller Test with Everything Mocked

Bad:

```text
controller mocked
service mocked
mapper mocked
validator mocked
exception handler not loaded
security disabled
```

This proves almost nothing.

---

### 30.3 E2E as Only API Confidence

If all API confidence comes from E2E:

- slow feedback.
- flaky test.
- hard debugging.
- few edge cases.
- bad local developer experience.

Use E2E sparingly.

---

### 30.4 Ignoring Negative Cases

API happy path is usually the easiest path. Production incidents often happen in:

- invalid input.
- duplicate request.
- timeout.
- unauthorized access.
- stale update.
- invalid state transition.
- downstream partial failure.

---

### 30.5 Snapshot Everything

Snapshot tests can help but often create lazy assertions.

Bad snapshot:

```text
500-line JSON snapshot fails, nobody knows why.
```

Good snapshot:

```text
stable API contract response for documented endpoint, reviewed intentionally.
```

---

### 30.6 Ignoring Unknown Fields

Default lenient deserialization may allow malicious/accidental fields.

For command APIs, unknown fields can indicate:

- client bug.
- version mismatch.
- attempted mass assignment.

Make policy explicit and test it.

---

### 30.7 No Test for Error Response

If error response is not tested, it will drift.

Consumers often depend on:

- error code.
- field error path.
- conflict code.
- retryability signal.

---

### 30.8 Mocking HTTP Client Instead of HTTP Boundary

Bad:

```java
when(addressClient.lookup("123456")).thenReturn(address);
```

This is fine for application service unit test, but it does not test HTTP client behavior.

For client adapter test, use WireMock/MockWebServer so you verify:

- URL.
- method.
- headers.
- request body.
- timeout.
- response parsing.

---

## 31. Practical API Test Checklist

For every important endpoint, ask:

### Request

- [ ] Is method correct?
- [ ] Is URL/path binding correct?
- [ ] Is content type enforced?
- [ ] Is accept header handled?
- [ ] Are mandatory fields validated?
- [ ] Are null/absent/blank semantics tested?
- [ ] Are enum/date/decimal edge cases tested?
- [ ] Are unknown fields handled according to policy?
- [ ] Is body size/file type tested if relevant?

### Response

- [ ] Is status code semantically correct?
- [ ] Is response body shape stable?
- [ ] Are sensitive fields absent?
- [ ] Are date/time formats stable?
- [ ] Is decimal precision preserved?
- [ ] Are headers correct?
- [ ] Is pagination metadata correct?

### Error

- [ ] Validation error body stable?
- [ ] Domain conflict mapped correctly?
- [ ] Authorization failure correct?
- [ ] Not found behavior correct?
- [ ] Unexpected error safe?
- [ ] No stack trace/class/sql leak?

### Security

- [ ] No token?
- [ ] Invalid token?
- [ ] Expired token?
- [ ] Wrong role?
- [ ] Wrong tenant/agency?
- [ ] Wrong resource ownership?
- [ ] State-sensitive permission?
- [ ] Mass assignment blocked?

### Compatibility

- [ ] Backward-compatible response?
- [ ] Version-specific behavior tested?
- [ ] Contract test exists for external consumers?
- [ ] OpenAPI examples valid?
- [ ] Breaking change detection in CI?

### Dependency

- [ ] Downstream success tested?
- [ ] Downstream 4xx tested?
- [ ] Downstream 5xx tested?
- [ ] Timeout tested?
- [ ] Retry/rate limit tested?
- [ ] Malformed response tested?

---

## 32. Step-by-Step Strategy for a New Endpoint

Suppose endpoint:

```http
POST /api/cases/{id}/approve
```

### Step 1: Define Contract

```text
Authenticated supervisor approves an under-review case in same agency.
```

### Step 2: Define Request

```json
{
  "remarks": "Approved after review.",
  "decisionDate": "2026-06-16"
}
```

### Step 3: Define Success Response

```text
200 OK
status = APPROVED
approvedAt exists
audit id exists
```

### Step 4: Define Error Cases

- missing remarks if required -> 400.
- case not found -> 404.
- wrong role -> 403.
- wrong agency -> 403/404.
- case still DRAFT -> 409.
- already APPROVED -> idempotent 200 or 409 depending policy.
- stale version -> 412 if ETag used.

### Step 5: Choose Test Layers

```text
Controller slice:
- route
- validation
- error mapping

Domain/application test:
- approve transition logic
- audit event
- invariant

Full-stack API integration:
- real DB state changes
- authorization
- audit persisted

Contract test:
- if external consumer depends on approve API
```

### Step 6: Write Minimal but Strong Tests

Slice:

```java
@Test
void approve_returns400_whenRemarksBlank() throws Exception {
    mockMvc.perform(post("/api/cases/CASE-1/approve")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {
                              "remarks": "",
                              "decisionDate": "2026-06-16"
                            }
                            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
}
```

Integration:

```java
@Test
void approve_changesStatusAndPersistsAudit_whenSupervisorOwnsCase() {
    String token = tokenForSupervisor("AGENCY-A");
    String caseId = seedCase("UNDER_REVIEW", "AGENCY-A");

    given()
            .auth().oauth2(token)
            .contentType(ContentType.JSON)
            .body("""
                    {
                      "remarks": "Approved after review.",
                      "decisionDate": "2026-06-16"
                    }
                    """)
    .when()
            .post("/api/cases/{id}/approve", caseId)
    .then()
            .statusCode(200)
            .body("status", equalTo("APPROVED"));

    assertCaseStatus(caseId, "APPROVED");
    assertAuditExists(caseId, "CASE_APPROVED");
}
```

Authorization:

```java
@Test
void approve_returns403_whenSupervisorFromOtherAgency() {
    String token = tokenForSupervisor("AGENCY-B");
    String caseId = seedCase("UNDER_REVIEW", "AGENCY-A");

    given()
            .auth().oauth2(token)
            .contentType(ContentType.JSON)
            .body(validApproveJson())
    .when()
            .post("/api/cases/{id}/approve", caseId)
    .then()
            .statusCode(403);

    assertCaseStatus(caseId, "UNDER_REVIEW");
    assertNoAudit(caseId, "CASE_APPROVED");
}
```

---

## 33. Top 1% Engineer Notes

A strong Java engineer does not ask:

```text
Do we have API tests?
```

They ask:

```text
Which API contracts are protected?
Which consumers are protected?
Which error semantics are guaranteed?
Which security boundaries are tested?
Which compatibility promises are enforced before deploy?
Which production incidents would still escape this test suite?
```

Key principles:

1. **HTTP is a contract, not a transport detail.**
2. **Status code, header, body, and error shape are all public behavior.**
3. **Validation test is not enough; domain conflict and authorization require separate tests.**
4. **MockMvc is fast but not full-stack evidence.**
5. **REST Assured/full-stack tests are stronger but must be selective.**
6. **WireMock tests HTTP client behavior; Mockito does not.**
7. **Pact protects consumer-provider compatibility, not business correctness.**
8. **OpenAPI documents contract; tests must prove implementation follows it.**
9. **Unknown fields, null/absent, enum evolution, date/time, and decimal precision are compatibility traps.**
10. **API tests should prevent production ambiguity, not merely increase coverage percentage.**

---

## 34. Summary

Di part ini kita membahas HTTP API testing sebagai contract engineering.

Poin utama:

- API boundary harus diuji berdasarkan risiko consumer, compatibility, security, validation, dan failure semantics.
- Controller/resource slice test cepat dan berguna untuk route, validation, and error mapping.
- Full-stack API integration test memberi evidence lebih kuat untuk service, DB, transaction, security, dan serialization nyata.
- HTTP client test dengan WireMock membuktikan request/response interaction terhadap dependency eksternal.
- Contract testing dengan Pact/OpenAPI membantu mencegah provider merusak consumer.
- Serialization edge cases seperti null vs absent, unknown field, enum, date/time, dan BigDecimal harus diuji eksplisit.
- Error response adalah contract, bukan afterthought.
- Authorization matrix harus diuji di API boundary karena banyak bypass terjadi saat role, ownership, tenant, dan state digabung.
- E2E penting, tetapi tidak boleh menjadi satu-satunya sumber confidence.

Part berikutnya akan membahas:

```text
Part 011 — Testing Messaging, Event Flow, Outbox, Scheduler, dan Async Processing
```

Status seri: **belum selesai**.

Progress saat ini: **Part 010 dari 031 selesai**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Testing Persistence: JDBC, JPA, Transaction, Isolation, Locking, dan Migration](./learn-java-testing-benchmarking-performance-jvm-part-009.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Testing Messaging, Event Flow, Outbox, Scheduler, dan Async Processing](./learn-java-testing-benchmarking-performance-jvm-part-011.md)
