# Part 13 — REST API Engineering with Spring MVC and Boot

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `13-rest-api-engineering-with-spring.md`  
> Status seri: Part 13 dari 35 — **belum selesai**  
> Prasyarat utama: Part 12 — Spring Web MVC Runtime Internals

---

## 0. Tujuan Part Ini

Part sebelumnya membedah **runtime internal Spring Web MVC**: `DispatcherServlet`, `HandlerMapping`, `HandlerAdapter`, argument resolver, return value handler, message converter, exception resolver, filter, interceptor, async MVC, dan boundary Servlet.

Part ini naik satu level: dari **bagaimana request diproses Spring** menjadi **bagaimana mendesain REST API Spring yang tahan perubahan, aman, konsisten, mudah dites, mudah dimigrasikan, dan layak dipakai dalam sistem enterprise jangka panjang**.

Fokus part ini bukan:

- sekadar membuat `@RestController`,
- sekadar `@GetMapping`, `@PostMapping`, `@RequestBody`,
- sekadar CRUD generator,
- sekadar “return DTO dari service”.

Fokusnya adalah:

1. bagaimana membuat API contract yang stabil,
2. bagaimana memisahkan transport/API model dari domain model,
3. bagaimana menentukan HTTP method, status, header, dan body secara benar,
4. bagaimana membuat error semantics yang konsisten,
5. bagaimana menangani idempotency, concurrency, versioning, pagination, filtering, partial update, file, streaming, dan compatibility,
6. bagaimana Spring MVC/Boot membantu sekaligus bisa menyesatkan bila dipakai tanpa mental model.

Target akhirnya: Anda tidak hanya bisa membuat REST API dengan Spring, tetapi bisa **mendesain API platform** yang bisa hidup bertahun-tahun, dipakai banyak client, diaudit, dites, dimonitor, dan diubah tanpa menghancurkan compatibility.

---

## 1. Mental Model: REST API Bukan Controller, Tapi Contract Boundary

Kesalahan umum engineer Spring adalah menganggap REST API sebagai:

```java
@RestController
class UserController {
    @GetMapping("/users/{id}")
    User get(@PathVariable Long id) {
        return userService.get(id);
    }
}
```

Secara teknis ini berjalan. Secara arsitektural ini belum tentu API yang baik.

REST API adalah **boundary kontrak** antara sistem Anda dan aktor luar:

```text
Client
  ↓ HTTP method + URI + header + body
API Contract Boundary
  ↓ validation + authZ + mapping + command/query
Application Service
  ↓ transaction + domain orchestration
Domain / Persistence / Integration
```

Controller hanya salah satu implementasi teknis dari boundary tersebut.

Dalam sistem jangka panjang, API contract lebih stabil daripada implementasi internal. Domain model bisa berubah, database bisa berubah, service bisa dipecah, workflow bisa direvisi, tetapi API publik harus tetap predictable.

Maka rule pertama:

```text
Jangan mendesain REST API berdasarkan struktur table, entity, atau package internal.
Desain REST API berdasarkan capability, resource, operation semantics, dan client contract.
```

---

## 2. REST API dalam Spring: Tiga Lapisan yang Sering Tercampur

Dalam aplikasi Spring, REST API sering melibatkan tiga lapisan:

```text
┌────────────────────────────────────────────┐
│ API Layer                                  │
│ - URI                                     │
│ - HTTP method                             │
│ - request DTO                             │
│ - response DTO                            │
│ - status code                             │
│ - error model                             │
│ - validation                              │
└────────────────────────────────────────────┘
                  ↓
┌────────────────────────────────────────────┐
│ Application Layer                          │
│ - use case                                │
│ - command/query                           │
│ - transaction boundary                    │
│ - authorization decision                  │
│ - orchestration                           │
└────────────────────────────────────────────┘
                  ↓
┌────────────────────────────────────────────┐
│ Domain / Infrastructure Layer              │
│ - entity                                  │
│ - aggregate                               │
│ - repository                              │
│ - external system                         │
│ - event                                   │
└────────────────────────────────────────────┘
```

Banyak codebase buruk mencampur semuanya di controller:

```java
@PostMapping("/cases")
@Transactional
public CaseEntity create(@RequestBody CaseEntity request) {
    request.setStatus("DRAFT");
    request.setCreatedBy(SecurityContextHolder.getContext().getAuthentication().getName());
    return caseRepository.save(request);
}
```

Masalahnya:

1. entity bocor ke API,
2. transaction boundary ada di controller,
3. security context dibaca langsung di API layer,
4. status workflow ditanam hardcoded,
5. response mengikuti bentuk table,
6. validation tidak jelas,
7. client bisa mengirim field yang tidak seharusnya,
8. sulit versioning,
9. sulit audit,
10. sulit test per use case.

Bentuk yang lebih sehat:

```java
@RestController
@RequestMapping("/api/v1/cases")
final class CaseApiController {

    private final CaseApplicationService caseApplicationService;
    private final CaseApiMapper caseApiMapper;

    CaseApiController(
            CaseApplicationService caseApplicationService,
            CaseApiMapper caseApiMapper
    ) {
        this.caseApplicationService = caseApplicationService;
        this.caseApiMapper = caseApiMapper;
    }

    @PostMapping
    ResponseEntity<CaseCreatedResponse> createCase(
            @Valid @RequestBody CreateCaseRequest request,
            AuthenticatedUser user
    ) {
        CreateCaseCommand command = caseApiMapper.toCommand(request, user);
        CaseCreatedResult result = caseApplicationService.createCase(command);

        URI location = URI.create("/api/v1/cases/" + result.caseId());

        return ResponseEntity
                .created(location)
                .body(caseApiMapper.toCreatedResponse(result));
    }
}
```

Di sini controller hanya melakukan:

- menerima input HTTP,
- validasi boundary,
- mapping ke command/query,
- memanggil application service,
- mapping hasil ke response HTTP.

Ia tidak menjadi tempat utama business logic.

---

## 3. Resource Design: Jangan Semua Dijadikan CRUD

REST API sering diajarkan sebagai CRUD:

```text
GET    /users
POST   /users
GET    /users/{id}
PUT    /users/{id}
PATCH  /users/{id}
DELETE /users/{id}
```

CRUD berguna untuk resource sederhana, tetapi sistem enterprise biasanya memiliki workflow, state transition, approval, review, assignment, escalation, submission, cancellation, reopening, archiving, dan audit trail.

Kalau semuanya dipaksa menjadi update generic:

```http
PATCH /cases/{id}
{
  "status": "APPROVED"
}
```

maka API kehilangan semantics. Client bisa “mengubah status”, padahal dalam domain sebenarnya terjadi operasi:

```text
approve case
reject case
submit case
withdraw case
assign officer
escalate case
request clarification
close case
reopen case
```

API yang lebih jelas:

```http
POST /api/v1/cases/{caseId}/submission
POST /api/v1/cases/{caseId}/approval
POST /api/v1/cases/{caseId}/rejection
POST /api/v1/cases/{caseId}/assignment
POST /api/v1/cases/{caseId}/clarification-requests
POST /api/v1/cases/{caseId}/closure
POST /api/v1/cases/{caseId}/reopening
```

Ini bukan berarti selalu harus membuat endpoint command. Prinsipnya:

```text
Jika operasi hanya mengganti representasi resource secara langsung, PUT/PATCH cocok.
Jika operasi merepresentasikan business action dengan invariant, audit, side effect, authorization, atau workflow transition, buat endpoint operation/resource yang eksplisit.
```

Contoh buruk:

```http
PATCH /applications/123
{
  "status": "SUBMITTED"
}
```

Contoh lebih baik:

```http
POST /applications/123/submission
{
  "declarationAccepted": true,
  "remarks": "Submitted after completing mandatory documents."
}
```

Karena “submit” bukan sekadar status. Ia mungkin:

- validate mandatory documents,
- freeze editable fields,
- create audit trail,
- start SLA clock,
- notify officers,
- assign queue,
- publish domain event,
- reject duplicate submission,
- require declaration.

---

## 4. URI Design: Stable, Hierarchical, Tapi Tidak Terlalu Dalam

URI harus merepresentasikan resource atau capability yang stabil.

### 4.1 Gunakan noun untuk resource utama

Baik:

```text
/api/v1/cases
/api/v1/cases/{caseId}
/api/v1/applications
/api/v1/applications/{applicationId}/documents
/api/v1/officers/{officerId}/assignments
```

Kurang baik:

```text
/api/v1/getCase
/api/v1/createCase
/api/v1/doApproval
/api/v1/updateApplicationStatus
```

Namun rule “jangan pakai verb” tidak absolut. Untuk domain operation kompleks, endpoint bisa berbentuk action sub-resource:

```text
/api/v1/cases/{caseId}/approval
/api/v1/cases/{caseId}/withdrawal
/api/v1/cases/{caseId}/reopening
```

Yang penting bukan kosmetik noun/verb, tetapi apakah URI merepresentasikan kontrak domain dengan jelas.

### 4.2 Hindari nesting terlalu dalam

Buruk:

```text
/api/v1/agencies/{agencyId}/departments/{departmentId}/teams/{teamId}/officers/{officerId}/cases/{caseId}/documents/{documentId}
```

Masalah:

- sulit dipakai client,
- banyak path variable tidak selalu diperlukan,
- authorization bisa rancu,
- refactor organisasi merusak URL,
- cache key panjang tanpa manfaat.

Lebih sehat:

```text
/api/v1/cases/{caseId}/documents/{documentId}
/api/v1/documents/{documentId}
/api/v1/officers/{officerId}/cases
```

Relationship bisa diekspresikan lewat filter:

```text
GET /api/v1/cases?agencyId=CEA&officerId=U123&status=OPEN
```

### 4.3 Jangan expose internal identifier tanpa rencana

Identifier adalah bagian kontrak.

Pertimbangkan:

| ID Type | Kelebihan | Risiko |
|---|---|---|
| DB numeric ID | simpel | enumeration attack, coupling ke DB, susah merge/shard |
| UUID | globally unique | panjang, kurang user-friendly |
| ULID/KSUID | sortable-ish, distributed friendly | dependency format |
| business reference number | user-friendly | lifecycle/rules lebih kompleks |

Untuk API eksternal, biasanya lebih aman memakai stable public ID:

```text
/api/v1/cases/CASE-2026-000123
```

atau opaque ID:

```text
/api/v1/cases/01JZK6V7H5Y2R6E0V3B4A9M2QX
```

Jangan menganggap ID hanya technical detail. ID memengaruhi security, debugging, audit, migration, dan user experience.

---

## 5. HTTP Method Semantics

HTTP method bukan dekorasi. Ia membawa semantics penting untuk idempotency, caching, retry, dan client expectation.

| Method | Semantics | Safe | Idempotent | Umum Dipakai Untuk |
|---|---|---:|---:|---|
| GET | membaca representasi | ya | ya | query/detail |
| HEAD | metadata tanpa body | ya | ya | cache/check existence |
| POST | create/action/process | tidak | tidak secara default | create, command, submit |
| PUT | replace full resource | tidak | ya | full replacement/upsert hati-hati |
| PATCH | partial modification | tidak | tergantung desain | partial update |
| DELETE | remove/cancel/delete | tidak | ya secara semantics | delete/cancel/mark removed |
| OPTIONS | capability metadata | ya | ya | CORS/discovery |

### 5.1 GET tidak boleh punya side effect bisnis

Buruk:

```java
@GetMapping("/invoices/{id}/mark-as-read")
void markAsRead(@PathVariable String id) { ... }
```

Lebih baik:

```java
@PostMapping("/invoices/{id}/read-receipt")
void markAsRead(@PathVariable String id) { ... }
```

GET boleh menghasilkan technical side effect seperti access log, metrics, trace, cache warmup. Tetapi tidak boleh mengubah state domain yang client tidak ekspektasikan.

### 5.2 POST create vs POST action

Create collection member:

```http
POST /api/v1/cases
Content-Type: application/json

{
  "caseType": "COMPLIANCE",
  "subjectId": "EA-123"
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /api/v1/cases/CASE-2026-000123
```

Action:

```http
POST /api/v1/cases/CASE-2026-000123/approval
Content-Type: application/json

{
  "decision": "APPROVE",
  "remarks": "Requirements met."
}
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "caseId": "CASE-2026-000123",
  "status": "APPROVED",
  "approvedAt": "2026-06-21T07:15:30Z"
}
```

atau kalau async:

```http
HTTP/1.1 202 Accepted
Location: /api/v1/operations/OP-123
```

### 5.3 PUT harus dipakai hati-hati

PUT berarti client mengirim representasi lengkap untuk mengganti resource.

```http
PUT /api/v1/officers/U123/profile
{
  "displayName": "Fajar",
  "phoneNumber": "+62...",
  "notificationPreference": "EMAIL"
}
```

Jika field tidak dikirim, apakah field dihapus? Jika tidak, itu bukan PUT murni, melainkan partial update disguised as PUT.

### 5.4 PATCH harus punya patch semantics yang jelas

PATCH bisa berarti:

1. JSON Merge Patch,
2. JSON Patch,
3. custom partial update DTO.

Jangan membuat PATCH ambigu:

```http
PATCH /api/v1/users/123
{
  "name": null
}
```

Apakah `null` berarti:

- set name ke null?
- field tidak berubah?
- invalid?

Harus eksplisit.

---

## 6. HTTP Status Code sebagai Domain Semantics

Status code bukan hanya “200 kalau berhasil”. Ia bagian kontrak.

### 6.1 Success status

| Status | Makna | Contoh |
|---|---|---|
| 200 OK | berhasil dan response body tersedia | detail/query/action result |
| 201 Created | resource baru dibuat | create case/document |
| 202 Accepted | diterima untuk proses async | import besar, batch job |
| 204 No Content | berhasil tanpa body | delete, update tanpa representation |
| 206 Partial Content | range response | download sebagian |

### 6.2 Client error

| Status | Makna | Contoh |
|---|---|---|
| 400 Bad Request | request malformed/invalid umum | JSON rusak, parameter salah |
| 401 Unauthorized | belum terautentikasi | token tidak ada/invalid |
| 403 Forbidden | sudah autentikasi tapi tidak boleh | role/permission kurang |
| 404 Not Found | resource tidak ditemukan atau disembunyikan | case tidak ada / tidak visible |
| 409 Conflict | konflik state/resource | status tidak bisa berubah, duplicate active record |
| 412 Precondition Failed | ETag/version precondition gagal | optimistic concurrency |
| 415 Unsupported Media Type | content-type tidak didukung | XML dikirim ke JSON endpoint |
| 422 Unprocessable Content | syntactically valid tapi semantic invalid | business validation kompleks |
| 429 Too Many Requests | rate limit | throttling |

### 6.3 Server error

| Status | Makna | Contoh |
|---|---|---|
| 500 Internal Server Error | unexpected server failure | bug, null pointer, unknown failure |
| 502 Bad Gateway | upstream invalid response | external service gateway |
| 503 Service Unavailable | dependency unavailable/maintenance | DB down, service not ready |
| 504 Gateway Timeout | upstream timeout | dependency timeout |

### 6.4 Mapping domain failure ke HTTP

Contoh domain failure:

```text
Case cannot be approved because mandatory documents are missing.
```

Pilihan status:

- `400` jika request command tidak valid secara umum,
- `409` jika operasi bertentangan dengan state resource,
- `422` jika payload valid secara syntax tapi gagal semantic validation.

Dalam workflow/state machine, `409 Conflict` sering lebih tepat untuk invalid transition:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/invalid-case-transition",
  "title": "Invalid case transition",
  "status": 409,
  "detail": "Case CASE-2026-000123 cannot be approved from DRAFT state.",
  "instance": "/api/v1/cases/CASE-2026-000123/approval",
  "caseId": "CASE-2026-000123",
  "currentStatus": "DRAFT",
  "requiredStatus": "SUBMITTED"
}
```

---

## 7. DTO Boundary: Jangan Expose Entity

Expose entity langsung adalah salah satu dosa besar API Spring.

Buruk:

```java
@GetMapping("/cases/{id}")
CaseEntity getCase(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Risiko:

1. field internal bocor,
2. lazy loading error,
3. infinite recursion JSON,
4. accidental N+1,
5. API berubah saat entity berubah,
6. client bisa bergantung pada field internal,
7. security filtering sulit,
8. versioning sulit,
9. sensitive field leak,
10. audit field exposure tidak terkendali.

Gunakan DTO eksplisit:

```java
public record CaseDetailResponse(
        String caseId,
        String caseType,
        String status,
        String subjectName,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        List<DocumentSummaryResponse> documents,
        List<AvailableActionResponse> availableActions
) {}
```

Request DTO:

```java
public record CreateCaseRequest(
        @NotBlank String caseType,
        @NotBlank String subjectId,
        @Size(max = 4000) String description,
        List<@Valid CreateCaseDocumentRequest> documents
) {}
```

Command:

```java
public record CreateCaseCommand(
        String caseType,
        String subjectId,
        String description,
        List<CreateCaseDocumentCommand> documents,
        String requestedBy
) {}
```

Response DTO ≠ Entity.  
Request DTO ≠ Command.  
Command ≠ Entity.

Mapping memang menambah kode, tetapi kode tersebut adalah boundary protection.

---

## 8. Controller Thinness: Controller Tipis, Bukan Anemik

Controller yang baik bukan berarti tidak punya kode sama sekali. Controller harus berisi **HTTP-specific decision**.

Wajar di controller:

- membaca path/query/body/header,
- memilih status code,
- membentuk `Location` header,
- membaca `If-Match`, `Idempotency-Key`, `Accept-Language`,
- mapping request DTO ke command,
- mapping result ke response DTO,
- memilih response type,
- delegasi ke application service.

Tidak ideal di controller:

- transaction orchestration,
- domain state transition,
- repository access langsung,
- external API call langsung,
- business validation kompleks,
- audit construction manual,
- authorization object-level kompleks,
- workflow branching panjang.

Contoh sehat:

```java
@PostMapping("/{caseId}/approval")
ResponseEntity<CaseActionResponse> approve(
        @PathVariable String caseId,
        @Valid @RequestBody ApproveCaseRequest request,
        @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
        AuthenticatedUser user
) {
    ApproveCaseCommand command = new ApproveCaseCommand(
            caseId,
            request.remarks(),
            idempotencyKey,
            user.userId()
    );

    ApproveCaseResult result = caseApplicationService.approve(command);

    return ResponseEntity.ok(new CaseActionResponse(
            result.caseId(),
            result.newStatus(),
            result.actionedAt()
    ));
}
```

---

## 9. Request Validation: Boundary Validation vs Business Validation

Spring MVC mendukung validation pada `@RequestBody`, `@ModelAttribute`, path/query parameter, dan method validation. Tetapi validasi harus dipisahkan mental model-nya.

### 9.1 Syntactic/boundary validation

Dilakukan di API layer.

Contoh:

```java
public record CreateApplicationRequest(
        @NotBlank
        @Size(max = 100)
        String applicantName,

        @NotBlank
        @Pattern(regexp = "^[A-Z0-9-]{5,30}$")
        String licenceNumber,

        @NotNull
        LocalDate effectiveDate
) {}
```

Ini memvalidasi bentuk input:

- field wajib,
- panjang,
- format,
- tipe,
- struktur nested.

### 9.2 Semantic/business validation

Dilakukan di application/domain layer.

Contoh:

```text
Applicant cannot submit renewal if licence is suspended.
Case cannot be approved if mandatory document is missing.
Officer cannot be assigned to a case from another agency.
Effective date cannot be earlier than current licence expiry date.
```

Jangan memaksa semua business rule menjadi annotation Bean Validation. Annotation cocok untuk rule lokal terhadap field/object. Rule yang butuh database, workflow state, authorization, external system, atau temporal logic biasanya lebih sehat di application/domain service.

### 9.3 Validation response harus stabil

Contoh response validation error:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "Request contains invalid fields.",
  "instance": "/api/v1/applications",
  "errors": [
    {
      "field": "applicantName",
      "code": "NotBlank",
      "message": "Applicant name is required."
    },
    {
      "field": "licenceNumber",
      "code": "Pattern",
      "message": "Licence number format is invalid."
    }
  ]
}
```

Jangan mengembalikan raw exception message dari framework sebagai kontrak final.

---

## 10. Error Model dengan Problem Details

Spring modern menyediakan model `ProblemDetail` dan `ErrorResponse` untuk response error berbasis problem detail. Dalam Spring MVC, banyak exception web Spring sudah bisa diekspresikan sebagai RFC 9457 problem detail.

Mental model:

```text
Exception internal
  ↓ exception handler / ErrorResponse
ProblemDetail public contract
  ↓ JSON/XML via message converter
Client receives stable error structure
```

Contoh `@RestControllerAdvice`:

```java
@RestControllerAdvice
final class ApiExceptionHandler {

    @ExceptionHandler(CaseNotFoundException.class)
    ResponseEntity<ProblemDetail> handleCaseNotFound(
            CaseNotFoundException ex,
            HttpServletRequest request
    ) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://api.example.com/problems/case-not-found"));
        problem.setTitle("Case not found");
        problem.setDetail("Case " + ex.caseId() + " was not found.");
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("caseId", ex.caseId());

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(problem);
    }

    @ExceptionHandler(InvalidCaseTransitionException.class)
    ResponseEntity<ProblemDetail> handleInvalidTransition(
            InvalidCaseTransitionException ex,
            HttpServletRequest request
    ) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://api.example.com/problems/invalid-case-transition"));
        problem.setTitle("Invalid case transition");
        problem.setDetail(ex.getMessage());
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("caseId", ex.caseId());
        problem.setProperty("currentStatus", ex.currentStatus());
        problem.setProperty("attemptedAction", ex.attemptedAction());

        return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
    }
}
```

### 10.1 Error response principles

Error response harus:

1. stabil,
2. tidak membocorkan stack trace,
3. punya machine-readable code/type,
4. punya human-readable title/detail,
5. punya correlation/trace ID bila tersedia,
6. punya field errors untuk validation,
7. tidak bergantung pada class exception Java,
8. tidak mengandung sensitive data.

### 10.2 Jangan overexpose internal failure

Buruk:

```json
{
  "error": "org.hibernate.exception.ConstraintViolationException: ORA-00001: unique constraint violated"
}
```

Lebih baik:

```json
{
  "type": "https://api.example.com/problems/duplicate-application",
  "title": "Duplicate application",
  "status": 409,
  "detail": "An active application already exists for this licence.",
  "traceId": "4f9c2a1b..."
}
```

---

## 11. ResponseEntity: Kapan Perlu dan Kapan Tidak

Spring memungkinkan controller return langsung object:

```java
@GetMapping("/{caseId}")
CaseDetailResponse getCase(@PathVariable String caseId) {
    return service.getCase(caseId);
}
```

Ini baik untuk response sederhana `200 OK`.

Gunakan `ResponseEntity` bila perlu mengontrol:

- status code,
- header,
- `Location`,
- `ETag`,
- cache control,
- content type,
- empty body,
- conditional response.

Contoh create:

```java
@PostMapping
ResponseEntity<CaseCreatedResponse> create(@Valid @RequestBody CreateCaseRequest request) {
    CaseCreatedResult result = service.create(mapper.toCommand(request));

    return ResponseEntity
            .created(URI.create("/api/v1/cases/" + result.caseId()))
            .body(mapper.toCreatedResponse(result));
}
```

Contoh delete:

```java
@DeleteMapping("/{caseId}")
ResponseEntity<Void> delete(@PathVariable String caseId) {
    service.delete(caseId);
    return ResponseEntity.noContent().build();
}
```

Contoh cache header:

```java
@GetMapping("/{caseId}")
ResponseEntity<CaseDetailResponse> get(@PathVariable String caseId) {
    CaseDetailResponse response = service.get(caseId);

    return ResponseEntity.ok()
            .cacheControl(CacheControl.noCache())
            .eTag('"' + response.version() + '"')
            .body(response);
}
```

---

## 12. Idempotency: Salah Satu Hal Paling Penting untuk API Produksi

Distributed systems menghasilkan retry:

- client timeout,
- gateway retry,
- mobile network drop,
- browser double submit,
- message replay,
- load balancer retry,
- user klik dua kali,
- upstream tidak tahu request pertama sukses atau gagal.

Jika endpoint create/action tidak idempotent, retry bisa menghasilkan duplicate side effect.

### 12.1 Idempotency untuk POST

POST tidak idempotent secara default. Tetapi Anda bisa membuatnya idempotent menggunakan `Idempotency-Key`.

Request:

```http
POST /api/v1/payments
Idempotency-Key: 9f3b5f8a-4a8d-4e1d-9f77-01e92f1c1a9b
Content-Type: application/json

{
  "invoiceId": "INV-123",
  "amount": 100000
}
```

Server menyimpan kombinasi:

```text
idempotency_key
actor/client_id
request_fingerprint
status
response_status
response_body
created_at
expires_at
```

Jika request yang sama dikirim ulang:

- bila key sama dan fingerprint sama → return response yang sama,
- bila key sama tetapi fingerprint beda → `409 Conflict`,
- bila request pertama masih processing → `409 Conflict` atau `202 Accepted`, tergantung desain.

### 12.2 Contoh model service

```java
public interface IdempotencyService {

    <T> T execute(
            String key,
            String actorId,
            String requestFingerprint,
            Class<T> responseType,
            Supplier<T> operation
    );
}
```

Controller:

```java
@PostMapping
ResponseEntity<CaseCreatedResponse> create(
        @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
        @Valid @RequestBody CreateCaseRequest request,
        AuthenticatedUser user
) {
    CreateCaseCommand command = mapper.toCommand(request, user, idempotencyKey);
    CaseCreatedResult result = service.create(command);

    return ResponseEntity
            .created(URI.create("/api/v1/cases/" + result.caseId()))
            .body(mapper.toCreatedResponse(result));
}
```

Application service:

```java
@Transactional
public CaseCreatedResult create(CreateCaseCommand command) {
    return idempotencyService.execute(
            command.idempotencyKey(),
            command.requestedBy(),
            command.fingerprint(),
            CaseCreatedResult.class,
            () -> doCreate(command)
    );
}
```

### 12.3 Jangan pakai idempotency key global tanpa actor binding

Jika key hanya dicek global, user A bisa menabrak key user B. Binding minimal:

```text
tenant_id + actor_id/client_id + idempotency_key
```

### 12.4 Expiry

Idempotency record tidak harus disimpan selamanya. Umumnya TTL tergantung domain:

- payment: lebih lama,
- form submission: beberapa jam/hari,
- transient action: singkat.

Tetapi expiry adalah kontrak. Dokumentasikan.

---

## 13. Optimistic Concurrency dengan ETag dan If-Match

Masalah umum:

```text
User A membuka case version 3.
User B membuka case version 3.
User A update → version 4.
User B update berdasarkan version 3 → menimpa perubahan User A.
```

Solusi: optimistic concurrency.

### 13.1 ETag pada GET

Response:

```http
HTTP/1.1 200 OK
ETag: "case-CASE-2026-000123-v3"
Content-Type: application/json

{
  "caseId": "CASE-2026-000123",
  "status": "DRAFT",
  "description": "...",
  "version": 3
}
```

### 13.2 If-Match pada update

Request:

```http
PATCH /api/v1/cases/CASE-2026-000123
If-Match: "case-CASE-2026-000123-v3"
Content-Type: application/json

{
  "description": "Updated description"
}
```

Jika current version masih 3 → update sukses, version naik.

Jika current version sudah 4:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Resource version mismatch",
  "status": 412,
  "detail": "The case has changed since it was last retrieved.",
  "caseId": "CASE-2026-000123",
  "currentVersion": 4
}
```

### 13.3 ETag kuat vs lemah

Untuk concurrency control, gunakan ETag yang merepresentasikan versi resource secara kuat. Jangan memakai shallow ETag berbasis response body untuk concurrency domain. `ShallowEtagHeaderFilter` berguna untuk cache/bandwidth, tetapi karena ETag dihitung dari response setelah rendering, ia bukan mekanisme domain concurrency.

### 13.4 Controller example

```java
@PatchMapping("/{caseId}")
ResponseEntity<CaseDetailResponse> patchCase(
        @PathVariable String caseId,
        @RequestHeader("If-Match") String ifMatch,
        @Valid @RequestBody UpdateCaseRequest request
) {
    UpdateCaseCommand command = mapper.toCommand(caseId, ifMatch, request);
    CaseDetailResult result = service.update(command);

    return ResponseEntity.ok()
            .eTag(result.etag())
            .body(mapper.toResponse(result));
}
```

Application service tetap melakukan validasi versi dalam transaction.

---

## 14. Conditional GET, Cache-Control, dan HTTP Caching

Caching di HTTP berbeda dari Spring Cache abstraction. Ini caching di boundary protocol.

### 14.1 Cache-Control

Contoh static/reference data:

```java
@GetMapping("/reference/countries")
ResponseEntity<List<CountryResponse>> countries() {
    return ResponseEntity.ok()
            .cacheControl(CacheControl.maxAge(Duration.ofHours(12)).cachePublic())
            .body(referenceService.getCountries());
}
```

Contoh data sensitif:

```java
@GetMapping("/me/profile")
ResponseEntity<UserProfileResponse> me() {
    return ResponseEntity.ok()
            .cacheControl(CacheControl.noStore())
            .body(profileService.getCurrentUserProfile());
}
```

### 14.2 ETag + If-None-Match

Response pertama:

```http
HTTP/1.1 200 OK
ETag: "countries-v2026-06-01"
```

Request berikutnya:

```http
GET /api/v1/reference/countries
If-None-Match: "countries-v2026-06-01"
```

Jika tidak berubah:

```http
HTTP/1.1 304 Not Modified
```

Spring MVC menyediakan dukungan `checkNotModified` melalui `WebRequest`.

```java
@GetMapping("/reference/countries")
ResponseEntity<List<CountryResponse>> countries(WebRequest request) {
    String etag = referenceService.countryEtag();

    if (request.checkNotModified(etag)) {
        return null;
    }

    return ResponseEntity.ok()
            .eTag(etag)
            .body(referenceService.getCountries());
}
```

Dalam desain modern, lebih eksplisit bila controller/service memiliki utility response builder agar tidak banyak return `null`. Tetapi konsepnya: request bisa diakhiri lebih awal bila resource belum berubah.

### 14.3 Jangan cache response user-specific tanpa `Vary`/private/no-store

Contoh berbahaya:

```http
GET /api/v1/dashboard
Cache-Control: public, max-age=3600
```

Kalau response bergantung pada user/role/tenant, gunakan:

```http
Cache-Control: private, no-store
```

atau desain cache key/proxy policy dengan benar.

---

## 15. Pagination: Offset, Cursor, dan Contract Stability

Endpoint list tanpa pagination adalah bom waktu.

Buruk:

```http
GET /api/v1/cases
```

Lalu response mengembalikan 200 ribu row.

### 15.1 Offset pagination

Request:

```http
GET /api/v1/cases?page=0&size=50&sort=createdAt,desc
```

Response:

```json
{
  "items": [
    {
      "caseId": "CASE-2026-000123",
      "status": "OPEN"
    }
  ],
  "page": {
    "number": 0,
    "size": 50,
    "totalElements": 1250,
    "totalPages": 25
  }
}
```

Kelebihan:

- mudah dipahami,
- cocok untuk UI page-based,
- Spring Data `Pageable` mendukung.

Kekurangan:

- query count mahal,
- offset besar lambat,
- data berubah bisa membuat duplicate/missing item antar page.

### 15.2 Slice pagination

Tidak menghitung total.

```json
{
  "items": [...],
  "page": {
    "number": 0,
    "size": 50,
    "hasNext": true
  }
}
```

Lebih murah untuk list besar.

### 15.3 Cursor pagination

Request:

```http
GET /api/v1/cases?limit=50&cursor=eyJjcmVhdGVkQXQiOiIyMDI2LTA2..."
```

Response:

```json
{
  "items": [...],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA2..."
}
```

Kelebihan:

- lebih stabil untuk data besar,
- cocok infinite scroll,
- menghindari offset besar.

Kekurangan:

- lebih kompleks,
- sorting harus deterministic,
- cursor harus opaque,
- perubahan filter/sort invalidates cursor.

### 15.4 Jangan expose `Page<Entity>` langsung

Buruk:

```java
@GetMapping
Page<CaseEntity> list(Pageable pageable) {
    return repository.findAll(pageable);
}
```

Lebih baik:

```java
@GetMapping
CaseSearchResponse search(@Valid CaseSearchRequest request) {
    CaseSearchQuery query = mapper.toQuery(request);
    CaseSearchResult result = service.search(query);
    return mapper.toResponse(result);
}
```

Karena response pagination adalah kontrak API, bukan sekadar struktur Spring Data.

---

## 16. Filtering and Sorting Contract

Filtering harus eksplisit dan terkendali.

Buruk:

```http
GET /api/v1/cases?where=status='OPEN' and created_by='U123'
```

Risiko:

- injection,
- coupling ke database column,
- authorization bypass,
- query plan tidak terkendali,
- sulit audit.

Lebih baik:

```http
GET /api/v1/cases?status=OPEN&assignedTo=U123&createdFrom=2026-01-01&createdTo=2026-06-30
```

atau untuk query kompleks:

```http
POST /api/v1/case-searches
Content-Type: application/json

{
  "status": ["OPEN", "PENDING_CLARIFICATION"],
  "assignedTo": "U123",
  "createdDate": {
    "from": "2026-01-01",
    "to": "2026-06-30"
  },
  "page": {
    "size": 50,
    "cursor": null
  },
  "sort": [
    { "field": "createdAt", "direction": "DESC" }
  ]
}
```

POST untuk search bukan “REST dosa” bila query terlalu kompleks untuk URL, mengandung structured criteria, atau butuh audit/permission control. Yang penting operasi tetap read-only secara domain dan tidak membuat resource kecuali sengaja mendesain saved search.

### 16.1 Sort whitelist

Jangan langsung membiarkan client sort by any property.

```java
private static final Map<String, SortField> ALLOWED_SORTS = Map.of(
        "createdAt", SortField.CREATED_AT,
        "updatedAt", SortField.UPDATED_AT,
        "status", SortField.STATUS,
        "priority", SortField.PRIORITY
);
```

Risiko tanpa whitelist:

- expose internal property,
- SQL injection via unsafe mapper,
- expensive sort,
- sort by sensitive field,
- unpredictable index usage.

---

## 17. Partial Update: PATCH, Merge Patch, JSON Patch, atau Command Endpoint?

Partial update terlihat sederhana, tetapi penuh jebakan.

### 17.1 Custom partial DTO

```java
public record UpdateCaseRequest(
        Optional<String> description,
        Optional<String> priority,
        Optional<String> assignedOfficerId
) {}
```

Masalah: Jackson dan `Optional` field dalam DTO sering menimbulkan debat style. Alternatif adalah wrapper seperti `JsonNullable` atau custom tri-state field.

Kebutuhan tri-state:

```text
field absent      → jangan ubah
field present null→ set null / clear
field present val → set value
```

Java `null` biasa tidak cukup membedakan absent vs explicit null.

### 17.2 JSON Merge Patch

Request:

```http
PATCH /api/v1/cases/CASE-123
Content-Type: application/merge-patch+json

{
  "description": "New description",
  "assignedOfficerId": null
}
```

Semantics umum:

- field absent: tidak berubah,
- field null: hapus/set null,
- object field di-merge.

### 17.3 JSON Patch

Request:

```http
PATCH /api/v1/cases/CASE-123
Content-Type: application/json-patch+json

[
  { "op": "replace", "path": "/description", "value": "New description" },
  { "op": "remove", "path": "/assignedOfficerId" }
]
```

Lebih eksplisit tetapi lebih kompleks.

### 17.4 Command endpoint lebih baik untuk action domain

Jangan gunakan PATCH untuk workflow command:

```http
PATCH /cases/CASE-123
{ "status": "APPROVED" }
```

Lebih baik:

```http
POST /cases/CASE-123/approval
{ "remarks": "Approved." }
```

PATCH cocok untuk perubahan representasi. Workflow action cocok menjadi command endpoint.

---

## 18. API Versioning

API berubah. Pertanyaannya bukan apakah API akan berubah, tetapi bagaimana perubahan dikontrol.

Spring Framework 7 memperkenalkan dukungan API versioning di stack web Spring, dengan strategi versioning yang bisa dipakai server-side dan client-side. Spring Boot 4 menyediakan integrasi konfigurasi untuk fitur tersebut.

### 18.1 Jenis perubahan

| Perubahan | Biasanya Breaking? |
|---|---:|
| Tambah field response optional | tidak, jika client toleran |
| Hapus field response | ya |
| Ubah tipe field | ya |
| Ubah enum value | bisa breaking |
| Tambah required request field | ya |
| Ubah status code | bisa breaking |
| Ubah error structure | ya |
| Ubah semantics endpoint | ya |
| Tambah endpoint baru | tidak |

### 18.2 Versioning strategies

| Strategy | Contoh | Kelebihan | Kekurangan |
|---|---|---|---|
| URI path | `/api/v1/cases` | jelas, mudah routing | URL berubah, coarse-grained |
| Header | `API-Version: 1` | URL bersih | kurang terlihat, proxy/client handling |
| Media type | `Accept: application/vnd.company.v1+json` | HTTP-purist | kompleks |
| Query param | `?version=1` | mudah test | kurang ideal untuk API governance |

Untuk enterprise internal/external APIs, path versioning sering paling pragmatis:

```text
/api/v1/cases
/api/v2/cases
```

Namun jangan membuat version baru untuk setiap perubahan kecil. Version major hanya untuk breaking change.

### 18.3 Versioning bukan alasan untuk copy-paste controller

Buruk:

```text
CaseControllerV1
CaseControllerV2
CaseControllerV3
```

Lalu semua logic dicopy.

Lebih sehat:

```text
API V1 DTO/mapper/controller thin
API V2 DTO/mapper/controller thin
        ↓
shared application service
        ↓
domain model
```

### 18.4 Deprecation policy

Setiap version harus punya policy:

```text
Version: v1
Status: Deprecated
Deprecation Date: 2026-08-01
Sunset Date: 2027-02-01
Replacement: /api/v2/cases
```

Response header bisa membantu:

```http
Deprecation: true
Sunset: Tue, 01 Feb 2027 00:00:00 GMT
Link: </api/v2/cases>; rel="successor-version"
```

---

## 19. Content Negotiation and Media Types

Spring MVC memakai `HttpMessageConverter` dan content negotiation untuk menentukan cara membaca/menulis body.

Request body dipengaruhi oleh:

```text
Content-Type: application/json
```

Response dipengaruhi oleh:

```text
Accept: application/json
```

Controller bisa membatasi:

```java
@PostMapping(
        consumes = MediaType.APPLICATION_JSON_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE
)
ResponseEntity<CaseCreatedResponse> create(@Valid @RequestBody CreateCaseRequest request) {
    ...
}
```

### 19.1 Jangan diam-diam menerima semua media type

Jika endpoint hanya mendukung JSON, deklarasikan. Jika client kirim XML ke endpoint JSON, response harus `415 Unsupported Media Type`.

### 19.2 Problem Details media type

Untuk error:

```http
Content-Type: application/problem+json
```

Ini membantu client membedakan response error standar dari JSON biasa.

---

## 20. JSON Serialization Contract

Spring Boot biasanya auto-configure Jackson. Ini nyaman, tetapi berbahaya bila kontrak JSON tidak dikontrol.

### 20.1 Stable naming

Pilih naming strategy:

```json
{
  "caseId": "CASE-123",
  "createdAt": "2026-06-21T07:15:30Z"
}
```

atau snake_case:

```json
{
  "case_id": "CASE-123",
  "created_at": "2026-06-21T07:15:30Z"
}
```

Jangan campur tanpa alasan.

### 20.2 Date/time

Gunakan ISO-8601.

```json
{
  "createdAt": "2026-06-21T07:15:30Z",
  "effectiveDate": "2026-07-01"
}
```

Bedakan:

- `Instant`/`OffsetDateTime` untuk timestamp,
- `LocalDate` untuk tanggal tanpa waktu,
- jangan memakai epoch millis sebagai default API publik kecuali ada alasan kuat.

### 20.3 Unknown fields

Untuk backward compatibility, sering lebih baik request menolak unknown fields pada API sensitif:

```text
unknown field → 400 Bad Request
```

Namun untuk client evolution, ada yang memilih tolerate unknown fields. Pilihan ini harus menjadi policy, bukan default tidak sadar.

### 20.4 Null handling

Apakah response menampilkan field `null`?

```json
{
  "assignedOfficerId": null
}
```

atau omit?

```json
{}
```

Keduanya valid, tetapi semantics berbeda. Untuk API contract, tentukan policy:

- nullable field ditampilkan jika bermakna,
- absent field untuk not applicable,
- empty array `[]` lebih baik daripada `null` untuk collection.

---

## 21. File Upload and Download

File API sering diremehkan, padahal failure-nya banyak.

### 21.1 Upload multipart

```java
@PostMapping(
        path = "/{caseId}/documents",
        consumes = MediaType.MULTIPART_FORM_DATA_VALUE
)
ResponseEntity<DocumentUploadResponse> upload(
        @PathVariable String caseId,
        @RequestPart("metadata") @Valid UploadDocumentMetadata metadata,
        @RequestPart("file") MultipartFile file,
        AuthenticatedUser user
) {
    UploadDocumentCommand command = mapper.toCommand(caseId, metadata, file, user);
    DocumentUploadResult result = service.upload(command);

    return ResponseEntity
            .created(URI.create("/api/v1/cases/" + caseId + "/documents/" + result.documentId()))
            .body(mapper.toResponse(result));
}
```

Validation yang perlu:

- maximum size,
- media type allowlist,
- file extension tidak dipercaya,
- magic number/sniffing bila perlu,
- virus scanning bila domain mengharuskan,
- checksum,
- filename sanitization,
- storage key tidak memakai filename raw,
- authorization per case/document,
- audit trail.

### 21.2 Download

```java
@GetMapping("/{caseId}/documents/{documentId}/content")
ResponseEntity<Resource> download(
        @PathVariable String caseId,
        @PathVariable String documentId
) {
    DocumentContent content = service.getContent(caseId, documentId);

    return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(content.contentType()))
            .contentLength(content.size())
            .header(
                    HttpHeaders.CONTENT_DISPOSITION,
                    ContentDisposition.attachment()
                            .filename(content.safeFilename(), StandardCharsets.UTF_8)
                            .build()
                            .toString()
            )
            .body(content.resource());
}
```

### 21.3 Jangan load file besar penuh ke memory

Buruk:

```java
byte[] bytes = fileService.loadAllBytes(documentId);
return ResponseEntity.ok(bytes);
```

Untuk file besar, gunakan streaming/resource abstraction.

### 21.4 Range request

Untuk video/large file, pertimbangkan HTTP range support. Jangan implement manual kecuali perlu; gunakan kemampuan resource handler/container/object storage pre-signed URL bila cocok.

---

## 22. Streaming Response

Spring MVC bisa streaming response dengan beberapa mekanisme:

- `StreamingResponseBody`,
- `ResponseBodyEmitter`,
- `SseEmitter`,
- `Resource` streaming.

Contoh export CSV:

```java
@GetMapping(value = "/cases/export", produces = "text/csv")
StreamingResponseBody exportCases(@Valid CaseExportRequest request) {
    CaseExportQuery query = mapper.toQuery(request);

    return outputStream -> exportService.writeCasesAsCsv(query, outputStream);
}
```

Perhatikan:

- timeout,
- client disconnect,
- transaction boundary,
- DB cursor/resource cleanup,
- memory pressure,
- backpressure terbatas di Servlet MVC,
- observability durasi panjang,
- audit export.

Jangan membuka transaction besar sepanjang streaming kecuali benar-benar paham risikonya. Lebih baik desain export async untuk dataset besar:

```http
POST /api/v1/case-exports
→ 202 Accepted
Location: /api/v1/case-exports/EXPORT-123
```

Lalu download setelah selesai.

---

## 23. Long-Running Operation: 202 Accepted + Operation Resource

Jika operasi tidak selesai cepat, jangan paksa HTTP request menunggu.

Contoh:

```http
POST /api/v1/case-imports
Content-Type: multipart/form-data
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /api/v1/operations/OP-2026-000123
Retry-After: 10
```

Operation resource:

```http
GET /api/v1/operations/OP-2026-000123
```

Response:

```json
{
  "operationId": "OP-2026-000123",
  "type": "CASE_IMPORT",
  "status": "RUNNING",
  "progress": {
    "processed": 1250,
    "total": 10000
  },
  "createdAt": "2026-06-21T07:15:30Z",
  "links": {
    "result": null
  }
}
```

Selesai:

```json
{
  "operationId": "OP-2026-000123",
  "type": "CASE_IMPORT",
  "status": "COMPLETED",
  "result": {
    "createdCases": 9800,
    "failedRows": 200
  },
  "links": {
    "result": "/api/v1/case-imports/IMPORT-123/result"
  }
}
```

Pattern ini penting untuk:

- import/export,
- document generation,
- report generation,
- large validation,
- integration sync,
- bulk operation,
- AI/background processing.

---

## 24. Security Boundary in REST API

Security bukan hanya filter chain. API contract juga harus mencegah misuse.

### 24.1 Jangan percaya client-supplied actor/tenant

Buruk:

```json
{
  "createdBy": "admin",
  "tenantId": "CEA"
}
```

Server harus derive dari security context/token/session:

```java
CreateCaseCommand command = new CreateCaseCommand(
        request.caseType(),
        request.subjectId(),
        authenticatedUser.userId(),
        authenticatedUser.tenantId()
);
```

### 24.2 Object-level authorization

Endpoint:

```http
GET /api/v1/cases/CASE-123
```

Tidak cukup memeriksa role `OFFICER`. Harus cek apakah officer boleh melihat case tersebut.

```java
public CaseDetailResult getCase(GetCaseQuery query) {
    CaseAccessDecision decision = authorizationService.canViewCase(
            query.actor(),
            query.caseId()
    );

    if (!decision.allowed()) {
        throw new CaseNotFoundOrNotVisibleException(query.caseId());
    }

    return caseReader.getCase(query.caseId());
}
```

Kadang untuk resource sensitif, `404` lebih aman daripada `403` agar tidak mengungkap keberadaan resource. Ini harus menjadi policy.

### 24.3 Mass assignment

Buruk:

```java
public record UpdateUserRequest(
        String displayName,
        String role,
        Boolean admin,
        String status
) {}
```

Jika endpoint profile update menerima DTO yang juga berisi role/admin/status, client bisa mencoba privilege escalation.

Pisahkan DTO per use case:

```java
public record UpdateOwnProfileRequest(
        @NotBlank String displayName,
        @Email String email
) {}
```

Role update harus endpoint berbeda dengan authorization berbeda.

---

## 25. Rate Limiting and Abuse Control

Spring MVC sendiri bukan rate limiter lengkap. Tetapi API design harus mendukungnya.

Response saat limit tercapai:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "Too many requests. Try again later."
}
```

Rate limit key bisa berdasarkan:

- client ID,
- user ID,
- tenant ID,
- IP address,
- endpoint group,
- operation type.

Jangan memakai IP saja untuk enterprise API karena NAT/proxy bisa membuat banyak user berbagi IP.

---

## 26. API Compatibility Testing

REST API harus dites sebagai contract, bukan hanya controller unit test.

### 26.1 Controller slice test

```java
@WebMvcTest(CaseApiController.class)
class CaseApiControllerTest {

    @Autowired MockMvc mockMvc;
    @MockitoBean CaseApplicationService service;

    @Test
    void createCaseReturns201AndLocation() throws Exception {
        given(service.create(any()))
                .willReturn(new CaseCreatedResult("CASE-123", Instant.parse("2026-06-21T07:15:30Z")));

        mockMvc.perform(post("/api/v1/cases")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "caseType": "COMPLIANCE",
                                  "subjectId": "EA-123",
                                  "description": "Test"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/v1/cases/CASE-123"))
                .andExpect(jsonPath("$.caseId").value("CASE-123"));
    }
}
```

### 26.2 Error contract test

```java
@Test
void validationErrorUsesProblemDetailShape() throws Exception {
    mockMvc.perform(post("/api/v1/cases")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {
                              "caseType": "",
                              "subjectId": ""
                            }
                            """))
            .andExpect(status().isBadRequest())
            .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
            .andExpect(jsonPath("$.type").exists())
            .andExpect(jsonPath("$.title").value("Validation failed"))
            .andExpect(jsonPath("$.errors").isArray());
}
```

### 26.3 Snapshot/golden contract

Untuk API publik, simpan contoh request/response sebagai golden files:

```text
src/test/resources/contracts/cases/create-case.request.json
src/test/resources/contracts/cases/create-case.response.201.json
src/test/resources/contracts/cases/create-case.validation-error.400.json
```

Tujuannya bukan menggantikan OpenAPI, tetapi mencegah perubahan response tidak sengaja.

---

## 27. OpenAPI: Dokumentasi Bukan Sumber Kebenaran Tunggal

OpenAPI sangat penting, tetapi jangan menganggap generate OpenAPI otomatis membuat API bagus.

OpenAPI membantu:

- dokumentasi endpoint,
- client generation,
- schema review,
- API governance,
- contract testing,
- mock server,
- breaking change detection.

Namun OpenAPI tidak otomatis menjamin:

- business semantics benar,
- authorization benar,
- transaction boundary benar,
- idempotency benar,
- error model konsisten,
- pagination efisien,
- backward compatibility aman.

Idealnya:

```text
API design review
  ↓
OpenAPI contract
  ↓
Controller implementation
  ↓
Contract tests
  ↓
Compatibility diff in CI
```

Bukan:

```text
Controller asal jadi
  ↓
Generate OpenAPI
  ↓
Anggap sebagai design
```

---

## 28. API Governance untuk Codebase Besar

Dalam organisasi besar, API consistency tidak bisa bergantung pada ingatan tiap developer.

Buat standard internal untuk:

1. URI naming,
2. versioning,
3. pagination,
4. sorting/filtering,
5. error model,
6. validation error shape,
7. idempotency key,
8. correlation ID,
9. date/time format,
10. enum naming,
11. `null` vs absent,
12. file upload/download,
13. async operation,
14. deprecation/sunset,
15. security response policy,
16. rate limit response,
17. OpenAPI rules.

### 28.1 Shared API library/starter

Untuk Spring platform internal, buat starter yang menyediakan:

- common error handler,
- `ProblemDetail` factory,
- validation error mapper,
- correlation ID filter,
- request logging policy,
- pagination DTO,
- idempotency abstraction,
- API response builder,
- Jackson configuration,
- OpenAPI common customizer,
- security-safe exception mapper.

Tapi hati-hati: shared starter tidak boleh menyembunyikan business decision.

---

## 29. Controller Design Patterns

### 29.1 Query endpoint

```java
@GetMapping("/{caseId}")
CaseDetailResponse getCase(
        @PathVariable String caseId,
        AuthenticatedUser user
) {
    CaseDetailResult result = service.getCase(new GetCaseQuery(caseId, user));
    return mapper.toDetailResponse(result);
}
```

### 29.2 Collection search endpoint

```java
@GetMapping
CaseSearchResponse searchCases(@Valid CaseSearchRequest request, AuthenticatedUser user) {
    CaseSearchQuery query = mapper.toQuery(request, user);
    CaseSearchResult result = service.search(query);
    return mapper.toSearchResponse(result);
}
```

### 29.3 Command endpoint

```java
@PostMapping("/{caseId}/approval")
CaseActionResponse approve(
        @PathVariable String caseId,
        @Valid @RequestBody ApproveCaseRequest request,
        @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
        AuthenticatedUser user
) {
    ApproveCaseCommand command = mapper.toCommand(caseId, request, idempotencyKey, user);
    CaseActionResult result = service.approve(command);
    return mapper.toActionResponse(result);
}
```

### 29.4 Create endpoint

```java
@PostMapping
ResponseEntity<CaseCreatedResponse> create(
        @Valid @RequestBody CreateCaseRequest request,
        @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
        AuthenticatedUser user
) {
    CreateCaseCommand command = mapper.toCommand(request, idempotencyKey, user);
    CaseCreatedResult result = service.create(command);

    return ResponseEntity
            .created(URI.create("/api/v1/cases/" + result.caseId()))
            .body(mapper.toCreatedResponse(result));
}
```

### 29.5 Async operation endpoint

```java
@PostMapping("/imports")
ResponseEntity<OperationAcceptedResponse> importCases(
        @RequestPart("file") MultipartFile file,
        AuthenticatedUser user
) {
    OperationAcceptedResult result = service.startImport(file, user);

    return ResponseEntity
            .accepted()
            .location(URI.create("/api/v1/operations/" + result.operationId()))
            .body(new OperationAcceptedResponse(result.operationId(), result.status()));
}
```

---

## 30. Failure Model REST API Spring

REST API production failure biasanya bukan hanya exception. Berikut failure model yang harus dipikirkan.

### 30.1 Input failure

| Failure | Mitigasi |
|---|---|
| malformed JSON | `400` dengan problem detail |
| unknown field | policy reject/tolerate |
| invalid enum | stable error message |
| invalid type | jangan expose Jackson internals |
| large payload | size limit + `413` |
| unsupported media type | `415` |

### 30.2 Domain failure

| Failure | Mitigasi |
|---|---|
| invalid state transition | `409 Conflict` |
| semantic validation gagal | `422` atau `400` sesuai policy |
| duplicate active resource | `409 Conflict` |
| not visible | `404` atau `403` sesuai policy |
| stale update | `412 Precondition Failed` |

### 30.3 Infrastructure failure

| Failure | Mitigasi |
|---|---|
| DB timeout | `503`/`500` tergantung context, trace ID |
| external service timeout | `504` atau domain-specific degraded response |
| message publish gagal | outbox, retry, transaction boundary |
| file storage gagal | `503`, cleanup partial state |
| serialization failure | test contract, fail safe |

### 30.4 Client behavior failure

| Failure | Mitigasi |
|---|---|
| duplicate submit | idempotency key |
| retry storm | rate limit/backoff |
| old version client | versioning/deprecation |
| partial rollout client | compatibility discipline |
| invalid cache | ETag/cache control |

---

## 31. Production Checklist

Sebelum endpoint REST dianggap production-ready, cek:

```text
[ ] URI stabil dan tidak expose struktur internal.
[ ] HTTP method sesuai semantics.
[ ] Status code success/error jelas.
[ ] Request DTO terpisah dari entity/domain.
[ ] Response DTO terpisah dari entity/domain.
[ ] Validation boundary jelas.
[ ] Business validation tidak dipaksa ke annotation field.
[ ] Error response memakai shape konsisten.
[ ] Sensitive error tidak bocor.
[ ] Authorization object-level dipikirkan.
[ ] Tenant/actor tidak dipercaya dari request body.
[ ] Idempotency dipertimbangkan untuk POST/action.
[ ] Optimistic concurrency dipertimbangkan untuk update penting.
[ ] Pagination wajib untuk list.
[ ] Sort/filter memakai whitelist.
[ ] Date/time format stabil.
[ ] Null/absent policy jelas.
[ ] File upload/download aman jika ada.
[ ] Long-running operation tidak menahan request terlalu lama.
[ ] OpenAPI/contract tersedia.
[ ] Controller test mencakup success/error.
[ ] Contract test mencegah accidental breaking change.
[ ] Observability mencatat trace/correlation ID.
[ ] Rate limiting/abuse control dipertimbangkan.
[ ] Versioning/deprecation policy jelas.
```

---

## 32. Review Heuristics: Bedakan API Pemula dan API Senior

API pemula biasanya:

```text
Controller langsung return entity.
Endpoint = table CRUD.
Semua sukses 200.
Semua error 500 atau raw message.
Tidak ada idempotency.
Tidak ada versioning.
Pagination mengikuti Page Spring Data mentah.
PATCH ambigu.
Authorization hanya role-level.
DTO mengikuti entity.
OpenAPI hanya hasil generate.
```

API senior/top-tier biasanya:

```text
Endpoint merepresentasikan capability/domain operation.
DTO contract stabil dan eksplisit.
Controller tipis tetapi sadar HTTP semantics.
Error model konsisten dan machine-readable.
Idempotency didesain untuk operasi berisiko.
Concurrency memakai version/ETag bila perlu.
Pagination/filter/sort menjadi contract, bukan kebocoran repository.
Versioning punya policy.
Security object-level dan tenant boundary jelas.
Long-running operation memakai operation resource.
OpenAPI/contract test menjadi governance.
Failure model dipikirkan sejak desain.
```

---

## 33. Hubungan dengan Part Berikutnya

Part ini sengaja membahas API REST dalam stack MVC/Boot secara mendalam. Namun belum masuk ke reactive stack. Part berikutnya akan membahas:

```text
14-webflux-reactive-spring-architecture.md
```

Di sana kita akan membedah:

- Reactive Streams contract,
- `Mono`/`Flux` dalam konteks Spring,
- WebFlux runtime,
- event loop,
- blocking detection,
- WebClient,
- backpressure,
- context propagation,
- kapan WebFlux masuk akal,
- kapan MVC + virtual threads lebih masuk akal,
- failure model reactive API.

---

## 34. Ringkasan Inti

REST API engineering dengan Spring bukan soal menulis annotation controller. Annotation hanyalah entry point. Yang menentukan kualitas API adalah kontrak.

Pahami urutan ini:

```text
Client intent
  ↓
HTTP semantics
  ↓
API contract
  ↓
Request validation
  ↓
Authorization
  ↓
Application command/query
  ↓
Transaction/domain/integration
  ↓
Response mapping
  ↓
Error/observability/compatibility
```

Jika API hanya mengikuti entity dan repository, maka Spring membuat Anda cepat menghasilkan endpoint tetapi lambat membayar technical debt.

Jika API didesain sebagai boundary kontrak, Spring MVC/Boot memberi Anda banyak mekanisme kuat:

- request mapping,
- validation,
- conversion,
- message converter,
- exception handling,
- problem detail,
- cache header,
- ETag,
- file/streaming support,
- testing,
- OpenAPI integration via ecosystem,
- observability via Boot/Actuator/Micrometer.

Top-tier Spring engineer tidak hanya bertanya:

```text
Bagaimana membuat endpoint ini jalan?
```

Tetapi bertanya:

```text
Apa semantics endpoint ini?
Apa invariant-nya?
Apa failure mode-nya?
Apa contract untuk client?
Apa yang terjadi saat retry?
Apa yang terjadi saat concurrent update?
Apa yang terjadi saat API berubah?
Apa yang boleh diketahui client?
Apa yang tidak boleh bocor?
Apa yang bisa dites sebagai contract?
```

Itulah perbedaan antara API yang sekadar bekerja dan API yang layak menjadi fondasi sistem enterprise.

---

## 35. Referensi Resmi dan Bacaan Lanjutan

Gunakan referensi resmi berikut saat memperdalam atau memverifikasi detail:

1. Spring Framework Reference — Web MVC
   - `https://docs.spring.io/spring-framework/reference/web/webmvc.html`
2. Spring Framework Reference — Error Responses and Problem Details
   - `https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html`
3. Spring Framework Javadoc — `ProblemDetail`
   - `https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/ProblemDetail.html`
4. Spring Framework Reference — API Versioning
   - `https://docs.spring.io/spring-framework/reference/web/webmvc-versioning.html`
5. Spring Blog — API Versioning in Spring
   - `https://spring.io/blog/2025/09/16/api-versioning-in-spring`
6. Spring Framework Reference — HTTP Caching
   - `https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-caching.html`
7. Spring Framework Javadoc — `ShallowEtagHeaderFilter`
   - `https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/filter/ShallowEtagHeaderFilter.html`
8. Spring Framework Reference — Spring MVC Validation
   - `https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-validation.html`

---

## 36. Status Seri

```text
Part saat ini : 13 dari 35
Status        : belum selesai
Berikutnya    : 14-webflux-reactive-spring-architecture.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./12-spring-webmvc-runtime-internals.md">⬅️ Part 12 — Spring Web MVC Runtime Internals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./14-webflux-reactive-spring-architecture.md">Part 14 — WebFlux and Reactive Spring Architecture ➡️</a>
</div>
