# learn-http-for-web-backend-perspective-part-009.md

# Part 009 — Validation, Parsing, and Defensive Boundaries

> Seri: `learn-http-for-web-backend-perspective`  
> Audience: Java software engineer  
> Fokus: bagaimana backend menerima input HTTP yang tidak tepercaya, mem-parse-nya, memvalidasinya, menjaga invariant, dan mengubah kegagalan validasi menjadi error contract yang aman dan konsisten.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membahas representation design dan content negotiation. Setelah server tahu format request/response yang didukung, pertanyaan berikutnya adalah:

> Apakah data yang dikirim client valid, aman, authorized, dan boleh mengubah state domain saat ini?

Banyak bug backend terjadi bukan karena engineer tidak tahu `@Valid`, tetapi karena tidak membedakan:

- parsing vs validation,
- valid secara JSON vs valid secara domain,
- field missing vs null vs blank,
- DTO boundary vs entity/domain object,
- validation vs authorization,
- application rule vs invariant domain,
- error client vs error server,
- safe rejection vs leaking internal detail.

Part ini membangun mental model agar validasi tidak sekadar menjadi dekorasi annotation, melainkan bagian dari desain boundary backend yang defensible.

---

## 1. Core Mental Model

### 1.1 Request is untrusted until proven otherwise

Setiap request HTTP harus dianggap tidak tepercaya, walaupun berasal dari frontend milik sendiri. Alasannya:

- browser bisa dimanipulasi,
- mobile app bisa versi lama,
- API bisa dipanggil langsung dengan curl/script,
- internal service bisa bug,
- gateway bisa salah konfigurasi,
- retry bisa menggandakan operasi,
- attacker tidak mengikuti UI flow.

Frontend validation adalah UX improvement. Backend validation adalah system protection.

---

### 1.2 Parsing is not validation

Pipeline konseptual input:

```text
bytes -> HTTP framing -> syntax -> DTO binding -> structural validation
      -> semantic validation -> authorization -> domain invariant -> persistence constraint
```

Contoh payload:

```json
{
  "caseType": "ENFORCEMENT",
  "reportedAt": "2026-06-18T10:00:00+07:00",
  "amount": "1000000.50"
}
```

Tahap-tahapnya:

| Tahap | Pertanyaan | Contoh failure |
|---|---|---|
| Framing | Body bisa dibaca sesuai HTTP? | `Content-Length` mismatch |
| Syntax | JSON valid? | koma ekstra |
| Binding | Cocok ke DTO? | amount object padahal string/decimal |
| Field validation | Required/range/length valid? | `caseType` kosong |
| Semantic validation | Masuk akal secara aplikasi? | tanggal di masa depan |
| Authorization | Actor boleh melakukan ini? | user biasa set priority urgent |
| Domain invariant | State transition sah? | closed case dimodifikasi |
| Persistence | Constraint DB terpenuhi? | duplicate external reference |

`@Valid` biasanya hanya menutup sebagian kecil dari pipeline.

---

### 1.3 Valid input is not necessarily allowed input

Payload ini mungkin valid secara schema:

```json
{
  "status": "APPROVED"
}
```

Tetapi belum tentu boleh, karena perlu menjawab:

- apakah actor adalah reviewer?
- apakah case sedang `UNDER_REVIEW`?
- apakah evidence mandatory lengkap?
- apakah reviewer bukan investigator yang sama?
- apakah approval membutuhkan second reviewer?

Backend harus membedakan:

```text
well-formed -> valid -> authenticated -> authorized -> allowed by current state -> committed
```

---

## 2. Defensive Boundary Pipeline

Sebuah endpoint production-grade idealnya punya boundary seperti ini:

```text
[Proxy/container limits]
        |
[HTTP method + route]
        |
[Header trust + content negotiation]
        |
[Body size/decompression limit]
        |
[Syntax parse]
        |
[DTO binding]
        |
[Structural validation]
        |
[Authentication]
        |
[Authorization]
        |
[Semantic/application validation]
        |
[Domain invariant]
        |
[Transaction + persistence]
        |
[Response/error mapping]
```

Urutan implementasi nyata bisa berbeda, tetapi tanggung jawabnya harus eksplisit. Kesalahan umum adalah menaruh semua aturan di controller atau membiarkan database menjadi validator utama.

---

## 3. Kategori Validasi

### 3.1 Transport dan framing validation

Ini terjadi sebelum JSON/XML dipahami:

- invalid request line,
- invalid header format,
- body terlalu besar,
- URI terlalu panjang,
- unsupported transfer encoding,
- decompression bomb,
- request timeout saat body belum selesai.

Biasanya ditangani oleh reverse proxy, servlet container, Netty, atau framework. Backend engineer tetap harus mengkonfigurasi limit agar konsisten antar-layer.

Hal yang perlu ditentukan:

- maksimum header size,
- maksimum body size per endpoint,
- maksimum multipart upload,
- maksimum JSON nesting jika relevan,
- limit sebelum dan sesudah decompression,
- response standar saat limit terlampaui.

Contoh status:

| Failure | Status |
|---|---|
| Payload terlalu besar | `413 Payload Too Large` |
| URI terlalu panjang | `414 URI Too Long` |
| Header terlalu besar | sering `400` atau `431 Request Header Fields Too Large` |
| Timeout membaca body | sering `408`, `400`, atau connection close tergantung layer |

---

### 3.2 Media type validation

Untuk endpoint JSON:

```http
Content-Type: application/json
Accept: application/json
```

Jika client mengirim body dengan media type tidak didukung:

```text
415 Unsupported Media Type
```

Jika client meminta response yang tidak bisa server produksi:

```text
406 Not Acceptable
```

Dalam Spring:

```java
@PostMapping(
    path = "/cases",
    consumes = MediaType.APPLICATION_JSON_VALUE,
    produces = MediaType.APPLICATION_JSON_VALUE
)
```

Media type adalah bagian dari contract, bukan detail kosmetik.

---

### 3.3 Syntax validation

JSON valid atau tidak?

Invalid:

```json
{
  "name": "Alice",
}
```

Ini harus dianggap malformed request, biasanya:

```text
400 Bad Request
```

Jangan expose stack trace parser. Client cukup butuh error aman seperti:

```json
{
  "type": "https://api.example.com/problems/malformed-json",
  "title": "Malformed JSON request body",
  "status": 400,
  "detail": "Request body is not valid JSON.",
  "correlationId": "req-123"
}
```

---

### 3.4 DTO binding validation

JSON bisa valid, tetapi gagal di-bind ke DTO.

Payload:

```json
{
  "claimedAmount": "not-a-number",
  "reportedAt": "yesterday"
}
```

DTO:

```java
public record CreateCaseRequest(
    BigDecimal claimedAmount,
    OffsetDateTime reportedAt
) {}
```

Ini type/binding error. Umumnya `400 Bad Request`. Pastikan error mapper tidak mengubahnya menjadi `500`.

---

### 3.5 Structural constraint validation

Bean Validation cocok untuk aturan field-level:

```java
public record CreateCaseRequest(
    @NotBlank
    @Size(max = 50)
    String caseType,

    @NotBlank
    @Size(min = 20, max = 5000)
    String description,

    @NotNull
    @DecimalMin(value = "0.00", inclusive = false)
    @Digits(integer = 12, fraction = 2)
    BigDecimal claimedAmount,

    @NotNull
    OffsetDateTime reportedAt
) {}
```

Aturan seperti required, max length, min length, numeric range, collection size, dan format sederhana cocok berada di DTO boundary.

---

### 3.6 Semantic validation

Semantic validation butuh konteks aplikasi:

- `reportedAt` tidak boleh di masa depan,
- `endDate` harus setelah `startDate`,
- `caseType` tertentu membutuhkan field tambahan,
- `currency` harus cocok dengan jurisdiction,
- selected agency harus aktif,
- due date harus berada dalam SLA policy,
- external reference tidak boleh duplicate.

Sebagian bisa di custom validator, tetapi jika butuh repository, actor, state, atau policy version, biasanya lebih tepat di application service.

---

### 3.7 Authorization-sensitive validation

Validasi sering terkait hak akses.

Contoh field `priority`:

```json
{
  "priority": "URGENT"
}
```

Nilai `URGENT` valid, tetapi mungkin hanya supervisor yang boleh set. Ini bukan sekadar field validation. Ini authorization + policy validation.

Jangan lakukan semua validation dulu jika itu bisa membocorkan resource atau rule internal kepada actor yang tidak berhak.

---

### 3.8 Domain invariant validation

Domain invariant harus hidup di domain/application layer, bukan hanya controller.

Contoh invariant:

```text
Closed enforcement case cannot accept new evidence unless formally reopened.
```

Implementasi domain:

```java
public final class EnforcementCase {
    private CaseStatus status;

    public void addEvidence(Evidence evidence, Actor actor) {
        if (status == CaseStatus.CLOSED) {
            throw new DomainRuleViolation("closed_case_cannot_accept_evidence");
        }
        // mutate state
    }
}
```

Alasannya: domain bisa dipanggil dari HTTP, batch job, message consumer, admin tool, atau migration. Jika invariant hanya di controller, entry point lain bisa melanggarnya.

---

### 3.9 Persistence constraint validation

Database adalah safety net:

- unique constraint,
- foreign key,
- not null,
- check constraint,
- optimistic locking.

Tetapi DB error harus dipetakan ke API error yang aman.

Contoh duplicate external reference:

```text
409 Conflict
```

Response aman:

```json
{
  "type": "https://api.example.com/problems/duplicate-case-reference",
  "title": "Duplicate case reference",
  "status": 409,
  "detail": "A case with the provided external reference already exists.",
  "correlationId": "req-123"
}
```

Jangan return SQL error mentah.

---

## 4. Missing, Null, Empty, Blank

Empat hal ini berbeda:

```text
missing != null != empty != blank
```

| Bentuk | Contoh | Makna potensial |
|---|---|---|
| Missing | `{}` | client tidak mengirim field |
| Null | `{ "x": null }` | client eksplisit mengosongkan atau unknown |
| Empty | `{ "x": "" }` | string kosong |
| Blank | `{ "x": "   " }` | hanya whitespace |

Untuk create request, semua selain meaningful value mungkin invalid.

Untuk PATCH:

| Bentuk | Makna umum |
|---|---|
| missing | jangan ubah |
| null | clear/remove field |
| empty | set empty atau invalid, harus eksplisit |
| blank | biasanya invalid untuk text meaningful |

Jangan biarkan Jackson/framework menentukan semantics bisnis secara kebetulan.

---

## 5. Unknown Fields: Reject, Ignore, or Capture

Payload:

```json
{
  "description": "...",
  "adminOnly": true
}
```

Pilihan server:

### 5.1 Ignore unknown fields

Kelebihan: lebih tolerant terhadap evolusi.  
Risiko: typo dan field malicious bisa tersembunyi.

### 5.2 Reject unknown fields

Kelebihan: strict, typo cepat ketahuan, cocok untuk command kritis.  
Risiko: perubahan API lebih mudah breaking.

### 5.3 Capture extension fields

Gunakan area eksplisit:

```json
{
  "description": "...",
  "extensions": {
    "externalSystemCode": "ABC"
  }
}
```

Rekomendasi:

| Endpoint | Policy |
|---|---|
| Critical command | reject unknown |
| Payment/order/case transition | reject unknown |
| Query endpoint | reject unknown query params atau documented ignore |
| Event ingestion flexible | capture in `extensions` |
| Response consumed by client | client should ignore unknown response fields |

Jackson example:

```java
@JsonIgnoreProperties(ignoreUnknown = false)
public record CreateCaseRequest(...) {}
```

Atau global:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
```

Hati-hati dengan konfigurasi global karena tidak semua endpoint butuh strictness yang sama.

---

## 6. DTO Is a Boundary Object

Anti-pattern:

```java
@PostMapping("/users")
public User create(@RequestBody User user) {
    return userRepository.save(user);
}
```

Masalah:

- entity persistence bocor ke API,
- client bisa set field internal,
- mass assignment,
- domain invariant dilewati,
- API evolution terikat schema DB,
- authorization field-level sulit.

Lebih baik:

```java
public record CreateUserRequest(
    @NotBlank String name,
    @Email String email
) {}

public record UserResponse(
    String id,
    String name,
    String email,
    String status
) {}
```

Mapping explicit:

```java
public User createUser(CreateUserRequest request, Actor actor) {
    return User.register(request.name(), request.email(), actor);
}
```

Jangan pakai blind copy untuk boundary object:

```java
BeanUtils.copyProperties(request, entity); // dangerous at boundary
```

---

## 7. Mass Assignment and Over-Posting

Entity:

```java
public class User {
    private String name;
    private String email;
    private boolean admin;
    private AccountStatus status;
}
```

Payload malicious:

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "admin": true,
  "status": "ACTIVE"
}
```

Defense:

1. DTO per operation.
2. Reject unknown fields for command endpoint.
3. Explicit mapping.
4. Field-level authorization.
5. Domain methods instead of setters.

Good:

```java
user.changeProfile(request.name(), request.email());
```

Bad:

```java
mapper.updateEntityFromRequest(request, user); // if it copies all matching fields blindly
```

---

## 8. Query Parameter Validation

Query params adalah input yang sama berbahayanya dengan body.

Contoh:

```http
GET /cases?page=0&size=50&sort=createdAt,desc&status=OPEN
```

Validasi:

- `page >= 0`,
- `size` maximum,
- `sort` field allowlist,
- enum valid,
- date range bounded,
- filter authorized,
- query tidak memicu full table scan besar.

Pagination DTO:

```java
public record SearchCasesRequest(
    @Min(0) Integer page,
    @Min(1) @Max(100) Integer size,
    CaseStatus status,
    LocalDate from,
    LocalDate to
) {}
```

Sort allowlist:

```java
private static final Set<String> ALLOWED_SORT_FIELDS = Set.of(
    "createdAt", "updatedAt", "caseNumber", "priority"
);
```

Jangan langsung meneruskan sort/filter mentah ke query builder.

---

## 9. Path Variable Validation

Path variable bukan otomatis aman.

```http
GET /cases/{caseId}
```

Validasi:

1. format ID valid,
2. canonical representation,
3. resource exists,
4. actor boleh melihat resource,
5. response 404 vs 403 sesuai information disclosure policy.

UUID path:

```java
@GetMapping("/cases/{id}")
public CaseResponse get(@PathVariable UUID id) {
    return service.getCase(id);
}
```

Untuk business key:

```java
private static final Pattern CASE_NUMBER =
    Pattern.compile("^CASE-\\d{4}-\\d{6}$");
```

Pastikan regex sederhana dan input length dibatasi.

---

## 10. Header Validation

Header adalah input.

Contoh yang perlu divalidasi:

- `Authorization`,
- `Content-Type`,
- `Accept`,
- `Idempotency-Key`,
- `If-Match`,
- `X-Request-ID`,
- `Forwarded`,
- `X-Forwarded-For`,
- `Range`.

### 10.1 Correlation ID

Jangan menerima correlation ID sembarang panjang.

```java
public String normalizeRequestId(String incoming) {
    if (incoming == null || !incoming.matches("^[A-Za-z0-9._-]{1,64}$")) {
        return UUID.randomUUID().toString();
    }
    return incoming;
}
```

### 10.2 Idempotency-Key

Untuk endpoint seperti payment/case submission:

- required jika operation non-idempotent,
- max length,
- allowed chars,
- scoped by tenant/user/operation,
- no sensitive data,
- stored with request fingerprint.

### 10.3 Forwarded headers

`X-Forwarded-For` hanya boleh dipercaya dari trusted proxy. Edge proxy harus menghapus spoofed incoming forwarding headers. Jangan gunakan forwarding header mentah untuk rate limit/auth tanpa trust model.

---

## 11. Date and Time Validation

Time bugs sering subtle.

Gunakan tipe sesuai meaning:

| Meaning | Java type |
|---|---|
| absolute timestamp | `Instant` |
| timestamp with offset from client | `OffsetDateTime` |
| date only | `LocalDate` |
| local wall-clock | `LocalDateTime` with caution |
| duration | `Duration` |

Bad:

```json
{ "reportedAt": "2026-06-18T10:00:00" }
```

Ambiguous timezone.

Better:

```json
{ "reportedAt": "2026-06-18T10:00:00+07:00" }
```

Or UTC:

```json
{ "reportedAt": "2026-06-18T03:00:00Z" }
```

Gunakan `Clock` agar testable:

```java
private final Clock clock;

if (request.reportedAt().toInstant().isAfter(clock.instant())) {
    throw new ValidationException("reported_at_in_future");
}
```

Hati-hati precision mismatch antara client, Java, dan database. Untuk concurrency, lebih baik gunakan ETag/version daripada timestamp mentah.

---

## 12. Numeric Validation

### 12.1 Money must not be double

Bad:

```java
public record PaymentRequest(double amount) {}
```

Good:

```java
public record PaymentRequest(
    @NotNull
    @DecimalMin(value = "0.00", inclusive = false)
    @Digits(integer = 12, fraction = 2)
    BigDecimal amount,

    @NotBlank
    String currency
) {}
```

Untuk uang, pertimbangkan decimal string di JSON:

```json
{
  "amount": "1000000.50",
  "currency": "IDR"
}
```

### 12.2 Overflow and bounds

Client bisa mengirim angka ekstrem. Binding failure harus menjadi 400, bukan 500. Semua numeric input perlu min/max yang masuk akal.

---

## 13. Enum Validation and Evolution

Request enum unknown biasanya harus ditolak:

```json
{ "status": "MAGIC" }
```

Response enum perlu policy:

- closed enum: value baru adalah breaking change,
- open enum: client harus siap unknown value.

Jangan otomatis bocorkan nama enum Java sebagai API contract jika nama internal bisa berubah.

Internal:

```java
AWAITING_L2_SUPERVISOR_REVIEW_INTERNAL
```

External lebih stabil:

```json
"awaiting_supervisor_review"
```

Gunakan mapping eksplisit.

---

## 14. String Validation

Setiap string input butuh policy:

- required/optional,
- min/max length,
- blank handling,
- allowed characters,
- Unicode normalization,
- control character rejection,
- trim atau preserve,
- sensitive data handling.

Max length wajib:

```java
public record CommentRequest(
    @NotBlank
    @Size(max = 5000)
    String comment
) {}
```

Tanpa max length:

- memory pressure,
- DB bloat,
- index bloat,
- log explosion,
- downstream message too large.

Trim tidak selalu benar. Untuk email/identifier mungkin perlu normalisasi. Untuk legal statement/evidence text, whitespace bisa meaningful.

---

## 15. Collection Validation

Payload:

```json
{
  "caseIds": ["a", "b", "c"]
}
```

Validasi:

- array required?
- boleh empty?
- max size?
- duplicates allowed?
- order meaningful?
- setiap element valid?
- semua element authorized?
- atomic atau partial success?

DTO:

```java
public record BulkActionRequest(
    @NotEmpty
    @Size(max = 100)
    List<@NotNull UUID> caseIds
) {}
```

Duplicate policy harus eksplisit. Untuk command, reject duplicate biasanya lebih aman.

---

## 16. Cross-Field Validation

Field individual bisa valid, kombinasi invalid.

```json
{
  "from": "2026-06-18",
  "to": "2026-01-01"
}
```

Custom constraint bisa digunakan:

```java
@ValidDateRange
public record SearchCasesRequest(
    LocalDate from,
    LocalDate to
) {}
```

Tetapi jika rule butuh database, actor, current resource state, atau policy version, letakkan di application service.

---

## 17. Validation Placement

Layering sehat:

```text
Controller / HTTP adapter
  - bind request
  - field validation
  - HTTP-specific extraction
  - map response status

Application service
  - use-case orchestration
  - semantic validation needing repositories/current actor
  - authorization-sensitive rules
  - transaction boundary

Domain model
  - invariants
  - state transitions
  - business rules valid across all entry points

Database
  - race-safe uniqueness
  - referential integrity
  - optimistic locking
```

Bad controller:

```java
@PostMapping("/cases/{id}/approve")
public CaseResponse approve(@PathVariable UUID id) {
    Case c = repository.findById(id).orElseThrow();
    c.setStatus(APPROVED);
    repository.save(c);
    return mapper.toResponse(c);
}
```

Better:

```java
@PostMapping("/cases/{id}/approval")
public CaseResponse approve(@PathVariable UUID id, Authentication auth) {
    return caseApplicationService.approveCase(id, Actor.from(auth));
}
```

Domain:

```java
public void approve(Actor actor, Instant approvedAt) {
    if (status != CaseStatus.UNDER_REVIEW) {
        throw new InvalidCaseTransition(status, CaseStatus.APPROVED);
    }
    this.status = CaseStatus.APPROVED;
    this.approvedAt = approvedAt;
    this.approvedBy = actor.id();
}
```

---

## 18. Fail-Fast vs Aggregate Errors

| Validation type | Recommended behavior |
|---|---|
| malformed syntax | fail-fast |
| body too large | fail-fast |
| authentication failure | fail-fast |
| authorization failure | fail-fast |
| Bean Validation field errors | aggregate when safe |
| domain invariant | fail-fast |
| expensive semantic validation | staged/fail-fast |

Aggregate field errors bagus untuk UX. Tetapi jangan aggregate authorization-sensitive errors yang membocorkan keberadaan resource atau rule internal.

---

## 19. Validation Error Response Shape

Gunakan error response machine-readable:

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "Request contains invalid fields.",
  "correlationId": "req-123",
  "invalidParams": [
    {
      "name": "description",
      "reason": "must not be blank",
      "code": "NotBlank"
    },
    {
      "name": "claimedAmount",
      "reason": "must be greater than 0",
      "code": "Positive"
    }
  ]
}
```

Prinsip:

- `code` stabil untuk machine handling,
- `reason` untuk manusia,
- `name` memakai field path eksternal,
- `correlationId` untuk debugging,
- jangan expose rejected value untuk field sensitif,
- jangan expose class name, SQL error, stack trace, atau parser internals.

Nested path examples:

```text
applicant.address.postalCode
evidenceIds[3]
```

---

## 20. Status Code Mapping

| Condition | Typical status |
|---|---|
| malformed JSON | `400` |
| type mismatch | `400` |
| missing required field | `400` |
| validation failed | `400` atau `422` |
| unsupported media type | `415` |
| not acceptable response format | `406` |
| resource state conflict | `409` |
| duplicate external reference | `409` |
| conditional request failed | `412` |
| missing required precondition | `428` |
| payload too large | `413` |
| URI too long | `414` |
| rate limited | `429` |

Tentang `400` vs `422`: pilih policy, dokumentasikan, dan konsisten. Banyak API memakai `400` untuk semua invalid request. `422` berguna jika ingin membedakan syntax valid tetapi content semantically invalid.

---

## 21. Spring MVC Implementation Pattern

DTO:

```java
public record CreateCaseRequest(
    @NotBlank @Size(max = 50)
    String caseType,

    @NotBlank @Size(min = 20, max = 5000)
    String description,

    @NotNull @DecimalMin(value = "0.00", inclusive = false)
    @Digits(integer = 12, fraction = 2)
    BigDecimal claimedAmount,

    @NotNull
    OffsetDateTime reportedAt
) {}
```

Controller:

```java
@RestController
@RequestMapping("/cases")
public class CaseController {
    private final CaseApplicationService service;

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE,
                 produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<CaseResponse> create(
            @Valid @RequestBody CreateCaseRequest request,
            Authentication authentication
    ) {
        CaseResponse response = service.createCase(request, Actor.from(authentication));
        return ResponseEntity
            .created(URI.create("/cases/" + response.id()))
            .body(response);
    }
}
```

Exception handler:

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemResponse> handleValidation(
            MethodArgumentNotValidException ex,
            HttpServletRequest request
    ) {
        List<InvalidParam> invalidParams = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .map(error -> new InvalidParam(
                error.getField(),
                error.getDefaultMessage(),
                error.getCode()
            ))
            .toList();

        return ResponseEntity.badRequest().body(
            ProblemResponse.validationFailed(request.getRequestURI(), invalidParams)
        );
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ProblemResponse> handleUnreadableBody(
            HttpMessageNotReadableException ex,
            HttpServletRequest request
    ) {
        return ResponseEntity.badRequest().body(
            ProblemResponse.malformedJson(request.getRequestURI())
        );
    }

    @ExceptionHandler(DomainRuleViolation.class)
    public ResponseEntity<ProblemResponse> handleDomainRule(
            DomainRuleViolation ex,
            HttpServletRequest request
    ) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(
            ProblemResponse.domainConflict(request.getRequestURI(), ex.publicCode())
        );
    }
}
```

---

## 22. WebFlux Implementation Pattern

Reactive stack membutuhkan disiplin tambahan karena body consumption, validation, dan error muncul dalam reactive pipeline.

```java
@RestController
@RequestMapping("/cases")
public class ReactiveCaseController {
    private final ReactiveCaseService service;

    @PostMapping
    public Mono<ResponseEntity<CaseResponse>> create(
            @Valid @RequestBody Mono<CreateCaseRequest> body,
            Authentication authentication
    ) {
        return body
            .flatMap(request -> service.createCase(request, Actor.from(authentication)))
            .map(response -> ResponseEntity
                .created(URI.create("/cases/" + response.id()))
                .body(response));
    }
}
```

Perhatikan:

- jangan blocking di event loop,
- jangan consume body dua kali,
- batasi memory/body size,
- map validation errors ke shape yang sama dengan MVC,
- cancellation/client disconnect harus dipahami,
- semantic validation async harus tetap menjaga transaction/invariant.

---

## 23. PATCH Validation

PATCH rawan ambiguity karena missing/null/no-change/clear berbeda.

Bad generic DTO:

```java
public record UpdateCaseRequest(
    String description,
    String priority
) {}
```

Masalah:

- missing dan null sulit dibedakan,
- clear field tidak eksplisit,
- field-level authorization sulit,
- state-dependent validation sulit,
- concurrency sering terlupakan.

Alternatif:

### 23.1 JSON Merge Patch

```http
PATCH /cases/{id}
Content-Type: application/merge-patch+json
```

```json
{
  "description": "Updated",
  "priority": null
}
```

Policy: missing = no change, null = remove/clear.

### 23.2 JSON Patch

```http
PATCH /cases/{id}
Content-Type: application/json-patch+json
```

```json
[
  { "op": "replace", "path": "/description", "value": "Updated" }
]
```

Validasi:

- allowed ops,
- allowed paths,
- max operations,
- per-path authorization,
- value validation after applying patch,
- concurrency with ETag/If-Match.

### 23.3 Command-specific endpoint

Untuk workflow-heavy domain, command endpoint sering lebih jelas:

```http
POST /cases/{id}/priority-change
```

```json
{
  "newPriority": "HIGH",
  "reason": "SLA risk"
}
```

Lebih verbose, tetapi lebih defensible.

---

## 24. Validation and Authorization Ordering

Urutan aman bergantung endpoint, tetapi prinsipnya:

1. lakukan cheap protocol checks,
2. authenticate early,
3. jangan membocorkan resource existence,
4. authorize sebelum semantic validation yang memakai resource sensitif,
5. validate domain state dalam transaction,
6. map failure secara konsisten.

Contoh: jika user tidak boleh melihat case, response mungkin `404` daripada `403` sesuai policy. Jangan validasi detail body sampai memberi error spesifik yang membantu attacker memahami resource tersembunyi.

---

## 25. Validation in Workflow-Heavy Systems

State machine:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> ESCALATED -> DECIDED -> CLOSED
```

Endpoint:

```http
POST /cases/{id}/submission
```

Validasi submission:

- case exists,
- actor can submit,
- current state is `DRAFT`,
- required fields complete,
- required evidence attached,
- no duplicate open case,
- conflict-of-interest declaration completed,
- SLA clock can start,
- transition audit event recorded.

Payload bisa valid, tetapi operation invalid karena current state. Ini biasanya `409 Conflict`, bukan `400`.

---

## 26. Validation, Auditability, and Observability

Untuk regulated systems, validasi harus bisa dijelaskan:

- rule apa yang diterapkan,
- rule version,
- actor,
- resource,
- rejection reason,
- correlation ID,
- timestamp,
- endpoint/operation.

Audit event aman:

```json
{
  "eventType": "CASE_SUBMISSION_REJECTED",
  "caseId": "case-123",
  "actorId": "user-456",
  "reasonCode": "MISSING_REQUIRED_EVIDENCE",
  "ruleVersion": "submission-policy-v3",
  "occurredAt": "2026-06-18T03:00:00Z",
  "correlationId": "req-789"
}
```

Observability metrics:

```text
api.validation.failed{endpoint="create_case", reason="NotBlank"}
api.validation.failed{endpoint="create_case", reason="MalformedJson"}
```

Hindari high-cardinality label seperti raw field value, case ID, full error message, atau user input.

---

## 27. Security-Sensitive Validation

Validation bukan pengganti security, tetapi bagian dari defense-in-depth.

### 27.1 URL input and SSRF

Jika backend menerima URL lalu melakukan request keluar:

```json
{ "callbackUrl": "http://localhost:8080/admin" }
```

Defense:

- scheme allowlist (`https`),
- host allowlist jika memungkinkan,
- reject private IP/localhost/link-local,
- safe DNS resolution,
- protect against DNS rebinding,
- no unsafe redirect,
- strict timeout,
- egress firewall.

Regex URL tidak cukup.

### 27.2 Path traversal

Jangan menerima filesystem path mentah. Pakai opaque file ID, canonical path check, base directory enforcement, dan authorization per file.

### 27.3 Regex DoS

Batasi length sebelum regex, gunakan regex sederhana, compile once, dan test worst-case input.

### 27.4 Duplicate JSON keys

Payload:

```json
{
  "role": "user",
  "role": "admin"
}
```

Parser bisa berbeda behavior. Untuk endpoint kritis, pertimbangkan reject duplicate keys. Dengan Jackson, duplicate detection bisa diaktifkan di level parser/factory tergantung versi.

---

## 28. Compatibility: Validation Rules Are API Contract

Memperketat validasi bisa breaking change.

Breaking examples:

- field baru menjadi required,
- max length diperkecil,
- enum value dihapus,
- format date diperketat,
- unknown field policy berubah dari ignore ke reject,
- nullable menjadi non-nullable,
- semantic rule berubah tanpa versioning,
- default value berubah.

Sebelum memperketat:

1. observasi traffic aktual,
2. beri deprecation/warning period jika perlu,
3. update contract docs,
4. lakukan consumer-driven contract testing,
5. sediakan migration window.

---

## 29. Testing Strategy

Test invalid input secara sistematis.

| Category | Example |
|---|---|
| malformed body | invalid JSON |
| wrong media type | `text/plain` to JSON endpoint |
| missing field | no `description` |
| null field | `description: null` |
| blank string | `"   "` |
| too long string | 5001 chars |
| invalid enum | `"MAGIC"` |
| invalid date | future timestamp |
| invalid range | `from > to` |
| large collection | 100000 ids |
| duplicate items | duplicate IDs |
| unauthorized field | setting admin-only property |
| state conflict | modifying closed case |
| DB conflict | duplicate key |
| unknown field | typo or malicious extra field |

MockMvc example:

```java
@Test
void createCaseRejectsBlankDescription() throws Exception {
    mockMvc.perform(post("/cases")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "caseType": "ENFORCEMENT",
                  "description": "   ",
                  "claimedAmount": "100.00",
                  "reportedAt": "2026-06-18T10:00:00+07:00"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.type").value("https://api.example.com/problems/validation-failed"))
        .andExpect(jsonPath("$.invalidParams[0].name").value("description"));
}
```

For critical parsers, consider fuzz/property tests:

- random JSON shapes,
- huge strings,
- invalid Unicode,
- extreme numbers,
- duplicate keys,
- deep nesting,
- strange dates,
- control characters.

Goal:

- no crash,
- no 500 for client input,
- bounded latency,
- safe error response,
- no internal leakage.

---

## 30. Decision Table

| Input area | Validation | Typical layer |
|---|---|---|
| Method | allowed method | router/gateway |
| Path | format/canonical ID | controller/router |
| Query | range/allowlist/defaults | controller/application |
| Header | presence/format/trust | filter/interceptor/controller |
| Content-Type | supported media type | framework/controller |
| Body size | max size | proxy/container/framework |
| Body syntax | parse validity | framework/parser |
| DTO structure | type binding | framework |
| Field constraints | Bean Validation | controller/framework |
| Cross-field | custom validator | controller/application |
| Actor permission | authorization | security/application |
| Resource state | workflow rule | application/domain |
| Invariant | always-true rule | domain |
| Uniqueness | race-safe constraint | DB + mapped error |

---

## 31. Case Study: Create Enforcement Case

Endpoint:

```http
POST /cases
Content-Type: application/json
Accept: application/json
Idempotency-Key: create-case-20260618-abc
```

Payload:

```json
{
  "caseType": "ENFORCEMENT",
  "respondentId": "resp-123",
  "description": "Detailed report of suspected violation...",
  "reportedAt": "2026-06-18T10:00:00+07:00",
  "claimedAmount": "1000000.50",
  "currency": "IDR",
  "externalReference": "EXT-2026-0001"
}
```

Validation pipeline:

1. Method `POST` allowed.
2. Route `/cases` matched.
3. `Content-Type` is JSON.
4. `Accept` can be satisfied.
5. Body under size limit.
6. JSON syntax valid.
7. DTO binding succeeds.
8. Unknown fields rejected.
9. Required fields present.
10. String lengths valid.
11. `reportedAt` has offset and is not future.
12. `claimedAmount` positive decimal.
13. `currency` supported.
14. `respondentId` format valid.
15. Actor authenticated.
16. Actor authorized for jurisdiction/tenant.
17. Respondent exists and visible.
18. Duplicate external reference checked.
19. Domain creates valid initial case.
20. DB uniqueness protects race.
21. Response `201 Created` with `Location`.

Failure mapping:

| Failure | Status |
|---|---|
| malformed JSON | `400` |
| missing description | `400` |
| unsupported content type | `415` |
| future reportedAt | `400` or `422` |
| unauthorized actor | `403` |
| hidden respondent | `404` or `403` |
| duplicate external reference | `409` |
| missing required idempotency key | `400` or `428` depending policy |
| payload too large | `413` |

---

## 32. Common Anti-Patterns

1. Trusting frontend validation.
2. Binding request directly to entity.
3. Blind property copying.
4. No max length on string fields.
5. No max size on arrays.
6. Treating validation exception as `500`.
7. Returning parser/SQL/stack trace internals.
8. Inconsistent error shape per controller.
9. Domain invariant only in controller.
10. Ignoring unknown fields everywhere.
11. Rejecting unknown fields everywhere without compatibility plan.
12. Using `double` for money.
13. Using `LocalDateTime` for global event time.
14. Accepting forwarded headers without trusted proxy model.
15. Logging raw request bodies with sensitive data.

---

## 33. Production Checklist

### Input boundary

- [ ] Method allowed explicitly.
- [ ] URI route unambiguous.
- [ ] Path variables validated.
- [ ] Query params validated.
- [ ] Headers validated.
- [ ] `Content-Type` enforced for body endpoints.
- [ ] `Accept` behavior defined.
- [ ] Body size limit defined.
- [ ] Multipart limit defined.
- [ ] Compression/decompression behavior defined.

### DTO and parsing

- [ ] Request DTO separate from entity.
- [ ] Response DTO separate from entity.
- [ ] Unknown field policy defined.
- [ ] Required vs optional fields documented.
- [ ] Missing vs null semantics documented.
- [ ] Empty vs blank semantics documented.
- [ ] Enum evolution policy defined.
- [ ] Date/time format defined.
- [ ] Numeric precision defined.

### Validation logic

- [ ] Field constraints added.
- [ ] Cross-field validation added.
- [ ] Semantic validation placed correctly.
- [ ] Authorization-sensitive validation ordered safely.
- [ ] Domain invariant enforced outside controller.
- [ ] DB constraints mapped to controlled errors.

### Error and observability

- [ ] Malformed body maps to safe `400`.
- [ ] Unsupported media type maps to `415`.
- [ ] Validation error shape consistent.
- [ ] Error codes stable.
- [ ] Sensitive values not leaked.
- [ ] Correlation ID included.
- [ ] Validation failures counted without high-cardinality labels.
- [ ] Tests cover invalid inputs.

---

## 34. Exercises

### Exercise 1 — Evidence upload metadata

Design validation for:

```http
POST /cases/{caseId}/evidence
```

```json
{
  "fileId": "file-123",
  "evidenceType": "PHOTO",
  "description": "...",
  "capturedAt": "2026-06-18T10:00:00+07:00"
}
```

Define:

1. path validation,
2. body validation,
3. semantic validation,
4. authorization validation,
5. domain invariant,
6. status codes.

### Exercise 2 — PATCH semantics

For `PATCH /cases/{caseId}`, define missing/null/empty behavior for:

- description,
- priority,
- dueDate,
- assignedInvestigatorId.

### Exercise 3 — Validation error response

Create a safe error response for:

```json
{
  "caseType": "",
  "claimedAmount": "-10.00",
  "reportedAt": "2099-01-01T00:00:00Z"
}
```

### Exercise 4 — Unknown field policy

Choose reject/ignore/capture for:

1. `POST /cases`
2. `PATCH /cases/{id}`
3. `POST /events/external-ingestion`
4. `GET /cases?status=OPEN`
5. `POST /payments`

Explain the trade-off.

---

## 35. Key Takeaways

1. Parsing, validation, authorization, and domain invariants are different responsibilities.
2. HTTP input remains untrusted even when coming from your own frontend.
3. DTO is a boundary object; entity/domain object should not be request body.
4. Missing, null, empty, and blank need explicit semantics.
5. Unknown field policy is an API design decision.
6. Bean Validation is useful but not enough for domain correctness.
7. Domain invariants must live where all entry points obey them.
8. Validation errors must be safe, consistent, observable, and machine-readable.
9. Validation rules are part of compatibility; tightening them can be breaking.
10. Good validation protects invariants under retries, old clients, abuse, malformed input, and evolving contracts.

---

## 36. What Comes Next

Part berikutnya:

```text
learn-http-for-web-backend-perspective-part-010.md
```

Topik:

```text
Error Response Design and Problem Details
```

Kita akan membahas bagaimana membangun error response contract yang konsisten, machine-readable, aman, traceable, cocok untuk Spring MVC/WebFlux, dan bisa digunakan untuk validation, auth, domain conflict, downstream failure, serta incident diagnosis.

---

## Status Seri

Saat ini selesai:

```text
Part 009 dari 032
```

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-008.md">⬅️ Part 008 — Content Negotiation and Representation Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-010.md">Part 010 — Error Response Design and Problem Details ➡️</a>
</div>
