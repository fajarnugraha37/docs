# learn-java-microservices-patterns-advanced-engineering-05-synchronous-api-communication

# Part 5 — Communication Pattern: Synchronous APIs

> Seri: Java Microservices Patterns — Advanced Engineering  
> Target: Java 8 sampai Java 25  
> Fokus: synchronous API communication sebagai kontrak, coupling, latency path, dan failure boundary dalam microservices production-grade.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

1. **Part 0** — microservices bukan sekadar banyak service kecil.
2. **Part 1** — distributed systems punya partial failure, latency, timeout, retry, dan overload.
3. **Part 2** — service boundary adalah keputusan arsitektur paling mahal.
4. **Part 3** — domain model menentukan invariant, lifecycle, event, command, dan policy.
5. **Part 4** — architecture style menentukan cara service berkomunikasi dan berevolusi.

Sekarang kita masuk ke salah satu bentuk komunikasi paling umum di microservices:

```text
synchronous API communication
```

Contoh paling umum:

```text
Service A --HTTP/gRPC--> Service B
Service A waits for Service B response
```

Di permukaan terlihat sederhana: panggil endpoint, dapat response.

Tapi secara arsitektur, synchronous call adalah bentuk **runtime coupling** yang kuat.

Setiap synchronous call membawa konsekuensi:

```text
availability coupling
latency coupling
capacity coupling
security coupling
contract coupling
release compatibility coupling
failure propagation risk
```

Topik ini penting karena banyak distributed monolith lahir bukan dari jumlah service, tetapi dari terlalu banyak synchronous dependency yang tidak didesain sebagai dependency graph yang sehat.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari part ini, kamu diharapkan mampu:

1. Memahami synchronous API sebagai bentuk coupling, bukan sekadar teknik integrasi.
2. Mendesain API contract yang stabil, eksplisit, dan evolvable.
3. Menentukan kapan synchronous API tepat dan kapan harus diganti async/event/workflow.
4. Mendesain timeout, retry, error model, pagination, idempotency, dan versioning dengan benar.
5. Memahami perbedaan client stack Java 8–25 untuk synchronous API.
6. Menghindari anti-pattern seperti chatty API, generic endpoint, internal model leakage, dan temporal coupling.
7. Membuat API yang bisa dioperasikan dalam production: observable, secure, testable, versionable, dan failure-aware.

---

## 2. Mental Model Utama

Synchronous API bukan hanya:

```text
call method over network
```

Synchronous API adalah:

```text
A service asks another service for a result now,
and blocks or waits until the result is returned,
while both services become temporarily coupled in time.
```

Artinya:

```text
Caller cannot complete without callee.
Callee capacity affects caller capacity.
Callee latency affects caller latency.
Callee failure affects caller behavior.
Callee contract affects caller release safety.
```

Synchronous communication adalah **temporal dependency**.

Jika Service A memanggil Service B secara synchronous, maka pada saat request berjalan:

```text
Service A hidup bersama Service B
```

Walaupun repository berbeda, deployment berbeda, database berbeda, tetap ada runtime dependency.

---

## 3. Local Call vs Remote Call

Kesalahan besar engineer junior sampai mid-level adalah memperlakukan remote call seperti local function call.

Local call:

```java
Price price = pricingService.calculatePrice(order);
```

Remote call:

```java
Price price = pricingClient.calculatePrice(order);
```

Secara kode terlihat mirip.

Secara realitas sangat berbeda.

| Aspek | Local Call | Remote Call |
|---|---:|---:|
| Latency | ns/µs | ms/s |
| Failure | exception lokal | timeout, reset, DNS, TLS, 5xx, 4xx, partial failure |
| Type safety | compile-time | contract/runtime |
| Transaction | same process/DB mungkin | distributed, tidak otomatis atomic |
| Debugging | stack trace lokal | distributed trace |
| Capacity | same process | independent capacity |
| Versioning | same deployment | independent deployment |
| Security | memory boundary | network trust boundary |

Remote call tidak boleh disembunyikan terlalu dalam seolah-olah method biasa.

### Prinsip

```text
Make remote calls visible in design, timeout, tracing, and failure model.
```

Bukan berarti semua kode harus verbose. Tetapi arsitektur harus sadar bahwa itu remote dependency.

---

## 4. Kapan Synchronous API Tepat?

Synchronous API tepat ketika caller membutuhkan jawaban segera untuk melanjutkan proses.

Contoh:

```text
GET /applications/{id}
POST /eligibility-check
GET /users/{id}/profile-summary
POST /quote-preview
POST /validate-address
```

Biasanya cocok untuk:

1. Query interaktif user.
2. Validasi cepat.
3. Command yang hasilnya harus langsung diketahui.
4. Operasi dengan latency rendah dan dependency terbatas.
5. Integrasi yang butuh request-response semantic.
6. BFF ke backend service.
7. Internal API yang berada dalam bounded latency budget.

### Contoh tepat

User membuka halaman detail application.

```text
Frontend -> BFF -> Application Service -> Profile Summary Service
```

Jika profile summary dibutuhkan untuk render halaman, synchronous call masuk akal.

Tetapi hanya jika:

```text
latency predictable
failure behavior jelas
partial response bisa dikelola
fan-out terbatas
```

---

## 5. Kapan Synchronous API Tidak Tepat?

Synchronous API mulai berbahaya ketika operasi sebenarnya tidak perlu selesai sekarang, atau ketika workflow panjang dipaksa menjadi call chain.

Tidak cocok untuk:

1. Long-running workflow.
2. Cross-service transaction panjang.
3. Broadcast notification.
4. Heavy report generation.
5. Batch processing.
6. Multi-step approval lifecycle.
7. Operation yang harus tetap lanjut walaupun downstream sedang lambat.
8. Proses yang butuh retry jangka panjang.
9. Integrasi dengan external system unreliable.
10. High fan-out dependency.

### Contoh buruk

```text
Application Service
  -> Profile Service
  -> Payment Service
  -> Document Service
  -> Notification Service
  -> Audit Service
  -> Case Service
```

Semua synchronous dalam satu request user.

Masalah:

```text
Total latency = sum/critical path of dependencies
Availability = multiplication of dependency availability
Failure blast radius = besar
User menunggu proses yang seharusnya async
Retry bisa menggandakan side effect
```

Lebih baik:

```text
submit application
commit local transaction
publish event
return accepted/submitted
background workflow continues
```

---

## 6. Synchronous Call Sebagai Coupling

Ada beberapa coupling yang harus dianalisis.

### 6.1 Temporal Coupling

Caller dan callee harus tersedia pada waktu yang sama.

```text
A needs B now
```

Jika B down, A ikut terdampak.

### 6.2 Availability Coupling

Jika A harus memanggil B untuk menyelesaikan request, availability efektif A turun mengikuti B.

Misal:

```text
A availability = 99.9%
B availability = 99.9%
A depends on B synchronously
Approx combined availability = 99.8%
```

Semakin banyak dependency, semakin turun.

### 6.3 Latency Coupling

Latency A memasukkan latency B.

Jika B p95 naik dari 50 ms ke 800 ms, A ikut lambat.

### 6.4 Capacity Coupling

Jika A scale 10x tetapi B tidak, maka B menjadi bottleneck.

```text
A scale-up can overload B
```

### 6.5 Contract Coupling

Caller tergantung request/response schema, status code, error code, semantic behavior, pagination, dan versioning callee.

### 6.6 Release Coupling

Jika perubahan B memaksa A deploy bersamaan, maka independence hilang.

Microservices sehat harus menghindari:

```text
coordinated release for every small change
```

---

## 7. Golden Rule Synchronous API

```text
A synchronous API should expose a stable business capability,
not an internal implementation detail.
```

Buruk:

```http
GET /tables/application_header/123
GET /applicationEntity/findById?id=123
POST /executeQuery
POST /common/getData
```

Lebih baik:

```http
GET /applications/123
GET /applications/123/eligibility-summary
POST /applications/123/submission-checks
POST /applications/123/withdrawal-request
```

API harus merepresentasikan capability atau resource yang meaningful bagi consumer.

---

## 8. API Contract: Bukan Cuma URL dan JSON

API contract mencakup:

1. Endpoint path.
2. HTTP method.
3. Request headers.
4. Request body.
5. Response body.
6. Status code.
7. Error body.
8. Timeout expectation.
9. Idempotency behavior.
10. Pagination behavior.
11. Sorting/filtering behavior.
12. Authorization requirement.
13. Rate limit behavior.
14. Compatibility promise.
15. Deprecation policy.
16. Observability metadata.
17. Semantic meaning.

OpenAPI membantu mendeskripsikan HTTP API secara formal dan language-agnostic, tetapi contract sebenarnya tetap harus mencakup semantic behavior yang kadang tidak cukup hanya dengan schema.

---

## 9. Resource-Oriented vs Operation-Oriented API

Ada dua gaya umum.

### 9.1 Resource-Oriented

Cocok untuk entity/resource lifecycle.

```http
GET /applications/{applicationId}
PATCH /applications/{applicationId}
POST /applications/{applicationId}/withdrawal
GET /applications/{applicationId}/documents
```

Kelebihan:

```text
lebih konsisten
mudah dipahami
cocok dengan HTTP semantics
mudah di-cache untuk GET
```

### 9.2 Operation-Oriented

Cocok untuk domain operation yang bukan CRUD biasa.

```http
POST /eligibility-checks
POST /risk-assessments
POST /applications/{id}/submission-validation
POST /cases/{id}/escalation-evaluation
```

Kelebihan:

```text
lebih ekspresif untuk business action
menghindari CRUD palsu
lebih cocok untuk command semantic
```

### Prinsip

Jangan memaksa semua hal menjadi CRUD.

Microservices enterprise sering punya domain action:

```text
submit
approve
reject
withdraw
escalate
assign
reopen
suspend
resume
terminate
```

Lebih baik membuat action explicit daripada menyembunyikan business transition di `PATCH status`.

Buruk:

```http
PATCH /applications/123
{
  "status": "APPROVED"
}
```

Lebih baik:

```http
POST /applications/123/approval
{
  "decisionReason": "All checks passed",
  "decisionBy": "officer-01"
}
```

Kenapa?

Karena approval bukan sekadar update field. Approval punya:

```text
authorization
state transition guard
audit trail
notification
side effect
policy rule
versioned decision reason
```

---

## 10. HTTP Method Semantics

HTTP method harus dipakai berdasarkan semantic, bukan kebiasaan.

| Method | Typical Meaning | Safe | Idempotent |
|---|---|---:|---:|
| GET | Retrieve representation | Yes | Yes |
| HEAD | Retrieve metadata | Yes | Yes |
| OPTIONS | Communication options | Yes | Yes |
| PUT | Replace resource | No | Yes |
| DELETE | Delete resource | No | Yes |
| POST | Create/action/process | No | Not inherently |
| PATCH | Partial update | No | Depends on design |

Safe artinya tidak dimaksudkan mengubah state. Idempotent artinya satu request atau request yang sama berulang kali menghasilkan intended effect yang sama.

### Common mistake

```http
GET /applications/123/approve
```

Ini salah karena GET tidak boleh mengubah state.

### POST tidak otomatis non-idempotent

POST bisa dibuat idempotent dengan idempotency key.

```http
POST /payments
Idempotency-Key: 8b0f7d7c-3e62-4e2d-a661-d5f1e9db98ac
```

---

## 11. Designing Endpoint Names

Endpoint bukan sekadar estetika. Endpoint adalah bahasa publik service.

### 11.1 Good endpoint characteristics

Endpoint baik biasanya:

1. Stable.
2. Business meaningful.
3. Tidak expose table/class name.
4. Tidak terlalu generik.
5. Tidak terlalu chatty.
6. Mengandung ownership jelas.
7. Compatible dengan versioning.
8. Mudah diaudit.

### 11.2 Bad endpoint examples

```http
POST /process
POST /doAction
POST /submitData
GET /getApplicationInfo
POST /applicationController/approveApplication
GET /common/dropdown?type=APPLICATION_STATUS
POST /execute
```

Masalah:

```text
semantic tidak jelas
sulit versioning
sulit observability
sulit authorization mapping
sulit audit classification
```

### 11.3 Better examples

```http
GET /applications/{applicationId}
POST /applications/{applicationId}/submission
POST /applications/{applicationId}/approval
POST /applications/{applicationId}/rejection
GET /applications/{applicationId}/timeline
GET /reference-data/application-statuses
```

---

## 12. Request DTO Design

Request DTO adalah boundary object.

Jangan expose entity JPA/domain internal langsung.

Buruk:

```java
@PostMapping("/applications")
public ApplicationEntity create(@RequestBody ApplicationEntity entity) {
    return repository.save(entity);
}
```

Masalah:

```text
internal persistence model bocor
field sensitif bisa ikut masuk
lazy relation bisa bocor
schema DB menjadi API contract
validasi domain tersebar
future refactor sulit
```

Lebih baik:

```java
public record SubmitApplicationRequest(
        String applicationType,
        String applicantId,
        List<SubmittedDocumentRequest> documents,
        String declarationVersion
) {}
```

Untuk Java 8:

```java
public final class SubmitApplicationRequest {
    private final String applicationType;
    private final String applicantId;
    private final List<SubmittedDocumentRequest> documents;
    private final String declarationVersion;

    public SubmitApplicationRequest(
            String applicationType,
            String applicantId,
            List<SubmittedDocumentRequest> documents,
            String declarationVersion) {
        this.applicationType = applicationType;
        this.applicantId = applicantId;
        this.documents = documents == null
                ? Collections.emptyList()
                : Collections.unmodifiableList(new ArrayList<>(documents));
        this.declarationVersion = declarationVersion;
    }

    public String getApplicationType() { return applicationType; }
    public String getApplicantId() { return applicantId; }
    public List<SubmittedDocumentRequest> getDocuments() { return documents; }
    public String getDeclarationVersion() { return declarationVersion; }
}
```

### DTO principles

1. DTO belongs to API boundary.
2. DTO should be stable.
3. DTO should avoid persistence annotation.
4. DTO should avoid domain behavior.
5. DTO should encode API-level validation.
6. DTO should tolerate additive change.
7. DTO should not expose internal enum blindly.

---

## 13. Response DTO Design

Response DTO harus consumer-oriented.

Buruk:

```json
{
  "id": 123,
  "statusCd": "P_APR",
  "createdDt": "2026-06-19T10:00:00",
  "updatedByUsrId": 88,
  "internalFlag": "Y"
}
```

Lebih baik:

```json
{
  "applicationId": "APP-2026-000123",
  "status": "PENDING_APPROVAL",
  "statusDisplayName": "Pending Approval",
  "submittedAt": "2026-06-19T10:00:00+07:00",
  "links": {
    "self": "/applications/APP-2026-000123",
    "timeline": "/applications/APP-2026-000123/timeline"
  }
}
```

### Response DTO considerations

1. Jangan expose internal ID kalau tidak perlu.
2. Gunakan stable business identifier.
3. Date-time harus explicit timezone/offset.
4. Enum harus dirancang untuk evolution.
5. Sertakan display field jika consumer UI banyak.
6. Jangan sertakan field sensitif.
7. Untuk partial response, jelaskan nullable/absent semantics.

---

## 14. Error Contract

Error contract sering lebih penting dari success contract.

Consumer production biasanya lebih sering bingung karena error tidak konsisten.

Buruk:

```json
{
  "message": "Error"
}
```

Buruk juga:

```json
{
  "timestamp": "...",
  "status": 500,
  "error": "Internal Server Error",
  "trace": "long stack trace..."
}
```

Lebih baik:

```json
{
  "type": "https://api.example.com/problems/application-invalid-state",
  "title": "Application cannot be approved from current state",
  "status": 409,
  "code": "APPLICATION_INVALID_STATE",
  "detail": "Application APP-2026-000123 is currently WITHDRAWN and cannot be approved.",
  "instance": "/applications/APP-2026-000123/approval",
  "correlationId": "01JZ9HTWPKW9M9Z3A8R2X2Q4V9",
  "errors": [
    {
      "field": "decisionReason",
      "code": "REQUIRED",
      "message": "Decision reason is required."
    }
  ]
}
```

### Error contract fields

| Field | Purpose |
|---|---|
| type | machine-readable problem type URI |
| title | short human-readable summary |
| status | HTTP status |
| code | application-specific stable code |
| detail | specific explanation |
| instance | request/resource reference |
| correlationId | tracing/support |
| errors | field-level/domain-level details |

### Stable error code

Consumer should not parse free text.

Buruk:

```text
if message contains "withdrawn"
```

Lebih baik:

```text
if code == APPLICATION_INVALID_STATE
```

---

## 15. HTTP Status Code Strategy

Status code harus konsisten.

| Status | Meaning in API Design |
|---:|---|
| 200 | Successful retrieval/action with response |
| 201 | Resource created |
| 202 | Accepted for asynchronous processing |
| 204 | Success without response body |
| 400 | Bad request syntax/shape |
| 401 | Not authenticated |
| 403 | Authenticated but not allowed |
| 404 | Resource not found or hidden |
| 409 | Conflict with current state/invariant |
| 412 | Precondition failed |
| 422 | Semantically invalid request, if adopted by API standard |
| 429 | Rate limited |
| 500 | Unexpected server error |
| 502 | Bad gateway/downstream error |
| 503 | Temporarily unavailable |
| 504 | Gateway timeout |

### 409 vs 400

Invalid JSON shape:

```http
400 Bad Request
```

Valid request shape, but illegal state transition:

```http
409 Conflict
```

Example:

```text
Cannot approve withdrawn application.
```

This is not syntax problem. It is state conflict.

### 202 Accepted

Use when work continues asynchronously.

```http
POST /applications/APP-123/submission
202 Accepted
Location: /operations/OP-987
```

Response:

```json
{
  "operationId": "OP-987",
  "status": "ACCEPTED",
  "statusUrl": "/operations/OP-987"
}
```

---

## 16. Timeout Contract

Every synchronous call needs timeout.

No timeout means:

```text
caller resources can be held forever
thread pool can saturate
connection pool can exhaust
request queue can grow
system can collapse under partial failure
```

### Types of timeout

| Timeout | Meaning |
|---|---|
| DNS resolution timeout | resolving host |
| connection timeout | TCP/TLS connection establishment |
| write timeout | sending request |
| read timeout | waiting for response data |
| response timeout | total response waiting |
| overall deadline | complete operation budget |

### Deadline mental model

Better than independent timeout everywhere:

```text
User request has 2s total budget.
BFF uses 300ms.
Service A has 1.5s remaining.
Service A gives Service B 500ms.
Service A gives Service C 300ms.
Remaining time reserved for fallback/response.
```

### Bad timeout

```text
API Gateway timeout: 30s
Service A timeout to B: 30s
Service B timeout to C: 30s
DB query timeout: none
```

This causes request pileup.

### Better timeout

```text
API Gateway: 3s
BFF -> Application Service: 2s
Application -> Profile: 300ms
Application -> Eligibility: 500ms
DB query: 200ms/500ms depending endpoint
```

---

## 17. Retry Contract

Retry is not free.

Retry can:

```text
recover from transient failure
increase success rate
but also amplify load
create duplicate side effects
cause retry storm
hide dependency degradation
```

### Retry only when safe

Retry is usually safe for:

```text
GET with no side effect
idempotent PUT
idempotent DELETE
POST with idempotency key
network timeout before response only if operation is idempotent/deduplicated
```

Retry dangerous for:

```text
non-idempotent POST
payment-like operation
approval action
notification sending
external side effect
```

### Retry policy should define

1. Which errors are retryable.
2. Maximum attempts.
3. Backoff strategy.
4. Jitter strategy.
5. Total retry budget.
6. Whether request is idempotent.
7. Whether caller deadline still allows retry.
8. Observability tag for retry attempt.

### Retry example

```text
attempts: 3 max
base delay: 50ms
max delay: 500ms
jitter: full jitter
retry on: connection reset, 502, 503, 504
never retry on: 400, 401, 403, 404, 409, validation errors
respect total deadline: yes
```

---

## 18. Idempotency Contract for Synchronous API

Idempotency is mandatory for robust distributed APIs.

### Why?

Caller might not know whether callee processed request.

Scenario:

```text
Caller sends approval request.
Callee approves application.
Response lost due to network timeout.
Caller retries.
```

Without idempotency:

```text
duplicate approval
duplicate audit
duplicate notification
invalid state error that confuses caller
```

With idempotency:

```text
same idempotency key returns same business result
```

### Example

```http
POST /applications/APP-123/approval
Idempotency-Key: approve-APP-123-decision-789
```

Request:

```json
{
  "decisionReason": "All checks passed",
  "decisionReference": "DEC-789"
}
```

Server stores:

```text
idempotency_key
request_hash
business_operation_id
response_status
response_body
created_at
expires_at
```

On duplicate:

```text
same key + same request hash -> return same response
same key + different request hash -> 409 idempotency key conflict
```

### Java pseudo-code

```java
public ApprovalResponse approve(String applicationId,
                                String idempotencyKey,
                                ApprovalRequest request) {
    RequestHash requestHash = RequestHash.from(request);

    Optional<StoredIdempotencyResult> existing =
            idempotencyRepository.find(applicationId, idempotencyKey);

    if (existing.isPresent()) {
        StoredIdempotencyResult result = existing.get();
        if (!result.requestHash().equals(requestHash)) {
            throw new IdempotencyConflictException(idempotencyKey);
        }
        return result.toApprovalResponse();
    }

    return transactionTemplate.execute(tx -> {
        Application application = applicationRepository.lockById(applicationId)
                .orElseThrow(() -> new ApplicationNotFoundException(applicationId));

        ApprovalResult approvalResult = application.approve(request.reason());
        applicationRepository.save(application);

        ApprovalResponse response = ApprovalResponse.from(approvalResult);

        idempotencyRepository.save(
                applicationId,
                idempotencyKey,
                requestHash,
                response
        );

        return response;
    });
}
```

---

## 19. Pagination Contract

Unbounded list endpoint is production risk.

Buruk:

```http
GET /applications
```

Tanpa limit, endpoint bisa:

```text
menghabiskan memory
melakukan full table scan
membuat timeout
mengganggu DB shared resource
menghasilkan response terlalu besar
```

### Offset pagination

```http
GET /applications?page=3&size=50
```

Cocok untuk:

```text
small/medium dataset
admin UI sederhana
stable sorting less critical
```

Masalah:

```text
large offset mahal
data berubah bisa duplicate/skip
```

### Cursor pagination

```http
GET /applications?limit=50&cursor=eyJsYXN0SWQiOiJB...
```

Cocok untuk:

```text
large dataset
infinite scroll
stable pagination
high-volume listing
```

Response:

```json
{
  "items": [],
  "nextCursor": "eyJsYXN0SWQiOiJB...",
  "hasMore": true
}
```

### Pagination contract should define

1. Default limit.
2. Maximum limit.
3. Sorting rule.
4. Stable tie-breaker.
5. Cursor expiration.
6. Consistency expectation.
7. Total count availability.
8. Filtering semantics.

### Total count caution

```text
SELECT COUNT(*) over huge filtered dataset
```

Can be expensive.

Alternative:

```json
{
  "items": [],
  "hasMore": true
}
```

Not always need total count.

---

## 20. Filtering and Sorting Contract

Filtering must be controlled.

Dangerous:

```http
GET /applications?where=status='PENDING' OR 1=1
```

Also dangerous:

```http
POST /search
{
  "sql": "select * from applications"
}
```

Better:

```http
GET /applications?status=PENDING_APPROVAL&submittedFrom=2026-01-01&submittedTo=2026-01-31&sort=submittedAt:desc&limit=50
```

### Filtering rules

1. Whitelist filter fields.
2. Define data type.
3. Define timezone behavior.
4. Define max date range.
5. Define index-backed query constraints.
6. Reject expensive arbitrary filters.
7. Avoid exposing DB column names.
8. Avoid exposing internal enum codes unless stable.

---

## 21. Versioning Strategy

API versioning is about compatibility, not just URL prefix.

### 21.1 Avoid breaking change when possible

Safe additive changes:

```text
add optional response field
add optional request field with default
add new enum value only if consumers are tolerant
add new endpoint
add new error code if documented fallback exists
```

Breaking changes:

```text
remove field
rename field
change field type
change requiredness
change semantic meaning
change status code behavior relied on by consumers
change enum set without tolerant consumers
```

### 21.2 URL versioning

```http
/api/v1/applications
/api/v2/applications
```

Pros:

```text
simple
visible
routing easy
```

Cons:

```text
coarse-grained
can create duplicate API surface
encourages big-bang versions
```

### 21.3 Header versioning

```http
Accept: application/vnd.example.application+json;version=2
```

Pros:

```text
more HTTP-ish
can version representation
```

Cons:

```text
harder to debug manually
less visible
```

### 21.4 Evolution without new major version

Prefer compatibility-first:

```text
additive changes
tolerant readers
strict writers
consumer-driven contract tests
deprecation window
usage telemetry
```

---

## 22. Tolerant Reader and Strict Writer

### Tolerant reader

Consumer should ignore unknown response fields.

```json
{
  "applicationId": "APP-1",
  "status": "PENDING",
  "newFieldAddedLater": "value"
}
```

Consumer should not fail just because `newFieldAddedLater` exists.

### Strict writer

Producer should not send ambiguous or undocumented fields.

For request validation:

```text
reject unknown fields if API requires strict client correctness
or tolerate unknown fields only when compatibility strategy says so
```

For response:

```text
only expose documented stable fields
```

### Enum evolution problem

Consumer code often does:

```java
switch (status) {
    case PENDING: ...
    case APPROVED: ...
    case REJECTED: ...
    default: throw new IllegalStateException();
}
```

If provider adds:

```text
SUSPENDED
```

Consumer breaks.

Better:

```java
switch (status) {
    case PENDING: ...
    case APPROVED: ...
    case REJECTED: ...
    default:
        return UnknownStatusView.from(status);
}
```

---

## 23. Consumer-Driven Contract Testing

Synchronous API must be tested at contract boundary.

Problem:

```text
Provider tests itself.
Consumer tests mock.
But mock does not match provider.
Production fails.
```

Consumer-driven contract:

```text
Consumer defines expectation.
Provider verifies it still satisfies expectation.
```

What should be covered:

1. Request path.
2. Method.
3. Required headers.
4. Request body shape.
5. Response body shape.
6. Status codes.
7. Error response shape.
8. Optional field behavior.
9. Backward compatibility.
10. Important semantic examples.

Contract testing does not replace integration test. It prevents accidental breaking API changes.

---

## 24. Client-Side API Design in Java

Java service-to-service client should be explicit, typed, and policy-aware.

Bad:

```java
String response = restTemplate.getForObject(url, String.class);
```

Problems:

```text
hardcoded URL
timeout unclear
error handling unclear
tracing unclear
retry unclear
contract unclear
response parsing manual
```

Better:

```java
public interface EligibilityClient {
    EligibilityResult checkEligibility(EligibilityRequest request, RequestContext context);
}
```

Implementation handles:

```text
base URL
timeout
auth
correlation id
serialization
error mapping
retry policy
metrics
tracing
```

Business service uses interface:

```java
public final class ApplicationSubmissionService {
    private final EligibilityClient eligibilityClient;

    public SubmissionResult submit(SubmitApplicationCommand command) {
        EligibilityResult eligibility = eligibilityClient.checkEligibility(
                EligibilityRequest.from(command),
                RequestContext.current()
        );

        if (!eligibility.allowed()) {
            throw new ApplicationNotEligibleException(eligibility.reasonCode());
        }

        // continue local transaction / workflow
    }
}
```

---

## 25. Java Client Stack: Java 8–25

### 25.1 Java 8

Common options:

```text
HttpURLConnection
Apache HttpClient
OkHttp
Spring RestTemplate
JAX-RS Client
```

Limitations:

```text
no standard modern JDK HttpClient
more reliance on libraries
blocking model dominant
manual CompletableFuture possible but less ergonomic
```

### 25.2 Java 11+

JDK introduced standard `java.net.http.HttpClient`.

Useful for:

```text
plain Java service
lightweight internal client
HTTP/2 support
sync and async send
CompletableFuture integration
```

Example:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(300))
        .version(HttpClient.Version.HTTP_2)
        .build();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://profile-service/profiles/123"))
        .timeout(Duration.ofMillis(500))
        .header("Accept", "application/json")
        .header("X-Correlation-Id", correlationId)
        .GET()
        .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
```

### 25.3 Spring ecosystem

Spring supports several client styles:

```text
RestTemplate legacy synchronous client
RestClient modern synchronous fluent client
WebClient reactive/non-blocking client
HTTP Interface client declarative proxy style
```

RestClient is synchronous and fluent. WebClient is more suitable for reactive/non-blocking pipelines. HTTP Interface can reduce boilerplate but still must not hide timeout/error/resilience policy.

### 25.4 MicroProfile REST Client

MicroProfile REST Client provides type-safe REST invocation based on Jakarta RESTful Web Services style.

Example style:

```java
@Path("/profiles")
@RegisterRestClient(configKey = "profile-api")
public interface ProfileClient {
    @GET
    @Path("/{id}")
    ProfileSummary getProfile(@PathParam("id") String id);
}
```

Good for Jakarta/MicroProfile runtimes when aligned with Config, Fault Tolerance, JWT, Health, OpenAPI, and Telemetry.

### 25.5 Java 21–25 and virtual threads

Virtual threads make blocking synchronous code cheaper in terms of thread scalability.

But virtual threads do **not** remove distributed systems problems.

They do not remove:

```text
timeout need
retry risk
connection pool limit
remote capacity limit
DB bottleneck
idempotency requirement
error contract
latency budget
```

Virtual threads help you avoid reactive complexity for many blocking workloads, but architecture still needs bounded concurrency and deadline propagation.

---

## 26. Server-Side API Layer Design

Server-side API should be thin but not dumb.

Controller/resource responsibility:

```text
parse request
validate API-level constraint
extract identity/context
call application service
map result to response
map exception to error contract
emit API metrics/tracing
```

Controller should not:

```text
implement business workflow
contain domain rules
call five repositories directly
publish random events manually
construct SQL
hide authorization decisions
```

### Example Spring-style controller

```java
@RestController
@RequestMapping("/applications/{applicationId}/approval")
public final class ApplicationApprovalController {
    private final ApplicationApprovalUseCase approvalUseCase;

    @PostMapping
    public ResponseEntity<ApprovalResponse> approve(
            @PathVariable String applicationId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody ApprovalRequest request,
            Principal principal) {

        ApprovalCommand command = new ApprovalCommand(
                applicationId,
                idempotencyKey,
                request.decisionReason(),
                principal.getName()
        );

        ApprovalResult result = approvalUseCase.approve(command);

        return ResponseEntity.ok(ApprovalResponse.from(result));
    }
}
```

### Example JAX-RS style

```java
@Path("/applications/{applicationId}/approval")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public final class ApplicationApprovalResource {
    private final ApplicationApprovalUseCase approvalUseCase;

    @POST
    public Response approve(@PathParam("applicationId") String applicationId,
                            @HeaderParam("Idempotency-Key") String idempotencyKey,
                            @Valid ApprovalRequest request,
                            @Context SecurityContext securityContext) {

        ApprovalCommand command = new ApprovalCommand(
                applicationId,
                idempotencyKey,
                request.getDecisionReason(),
                securityContext.getUserPrincipal().getName()
        );

        ApprovalResult result = approvalUseCase.approve(command);
        return Response.ok(ApprovalResponse.from(result)).build();
    }
}
```

---

## 27. Correlation, Causation, and Trace Headers

Every synchronous API should propagate request context.

Minimum:

```text
Correlation ID
Traceparent / tracing context
Caller service identity
User/actor identity where appropriate
Tenant/agency context where appropriate
Request deadline if supported
```

Example headers:

```http
X-Correlation-Id: 01JZ9JQCE9D9F6X1S5EBY1H4AK
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
X-Caller-Service: application-service
X-Tenant-Id: agency-a
```

Do not invent unlimited headers without governance. Standardize what matters.

### Why this matters

When incident happens:

```text
user says submission failed
frontend has request id
BFF logs same correlation id
Application service logs same correlation id
Profile service logs same trace
DB slow query can be connected to API request
```

Without correlation, debugging distributed systems becomes archaeology.

---

## 28. Authentication and Authorization in Synchronous API

This series already has dedicated authN/authZ materials, so here we focus only on communication implications.

Questions every synchronous API should answer:

1. Who is the caller?
2. Is this user identity, service identity, or both?
3. Is token meant for this audience?
4. Can caller perform this operation?
5. Is authorization checked at gateway, service, or both?
6. Are downstream calls allowed to propagate original user token?
7. Are internal services trusting headers blindly?
8. Is actor captured in audit?

### Dangerous pattern

```http
X-User-Id: admin
```

If internal services trust this without authentication, any compromised service can impersonate user.

Better:

```text
verified JWT / mTLS service identity / token exchange / signed internal context
```

### Authorization and error code

Sometimes use `404` instead of `403` to avoid resource existence leakage.

But this must be a deliberate API policy.

---

## 29. Rate Limiting and Quotas

Synchronous APIs need rate limit to protect capacity.

Rate limit dimensions:

```text
per user
per tenant
per client application
per service
per endpoint
per IP at edge
```

Response:

```http
429 Too Many Requests
Retry-After: 10
```

Body:

```json
{
  "code": "RATE_LIMITED",
  "detail": "Too many requests for application submission validation.",
  "retryAfterSeconds": 10,
  "correlationId": "01JZ9..."
}
```

### Internal rate limit

Internal services also need protection.

Example:

```text
BFF fan-out to Application Search API
limit expensive search per tenant
limit background caller separately from user UI
```

---

## 30. API Composition and Fan-Out Risk

A synchronous API often calls multiple downstream APIs.

Example:

```text
GET /application-dashboard
  -> Application Service
  -> Profile Service
  -> Case Service
  -> Payment Service
  -> Document Service
```

This creates fan-out risk.

### Availability multiplication

If each dependency has 99.9% availability and all are required:

```text
combined availability ≈ 0.999^5 = 99.5%
```

### Latency amplification

If parallel:

```text
latency tends toward slowest dependency
```

If sequential:

```text
latency accumulates
```

### Better design

1. Parallelize independent calls carefully.
2. Use partial response when acceptable.
3. Use cached/materialized view for dashboard.
4. Apply per-dependency timeout.
5. Limit fan-out count.
6. Avoid nested fan-out.
7. Make dependency criticality explicit.

Example partial response:

```json
{
  "application": {...},
  "profile": {...},
  "payment": null,
  "warnings": [
    {
      "code": "PAYMENT_SUMMARY_UNAVAILABLE",
      "message": "Payment summary is temporarily unavailable."
    }
  ]
}
```

---

## 31. API Gateway and Synchronous APIs

API gateway can help with:

```text
routing
TLS termination
authentication
rate limiting
request size limit
edge observability
coarse authorization
protocol translation
```

But gateway should not become hidden business orchestrator.

Bad:

```text
Gateway performs approval rules
Gateway calls 8 services to complete submission
Gateway mutates business state
Gateway has service-specific domain logic
```

Better:

```text
Gateway handles edge concerns
BFF handles experience composition
Domain services own business behavior
Workflow/process manager handles long-running orchestration
```

---

## 32. Caching Synchronous API Responses

GET APIs may be cacheable, but cache must respect:

```text
authorization
tenant
data freshness
privacy
invalidation
sensitivity
```

### Cache headers

```http
Cache-Control: private, max-age=60
ETag: "application-123-v7"
```

### Conditional request

```http
GET /applications/APP-123
If-None-Match: "application-123-v7"
```

Response if unchanged:

```http
304 Not Modified
```

### Microservices internal cache caution

If Service A caches Service B response:

```text
who owns freshness?
what is stale tolerance?
how is cache invalidated?
is response user-specific?
is response tenant-specific?
```

Cache is not just performance optimization. It changes consistency semantics.

---

## 33. Request Size, Response Size, and Payload Design

Large payload can kill synchronous APIs.

Risks:

```text
memory pressure
slow serialization
slow network transfer
long GC pause
large logs accidentally capturing PII
gateway body limit
client timeout
```

### Rules

1. Set max request body size.
2. Avoid returning huge arrays.
3. Use pagination.
4. Use streaming/download endpoint for large file.
5. Avoid base64 large document in JSON unless justified.
6. Do not log full payload by default.
7. Use compression carefully.
8. Separate metadata API from file content API.

Bad:

```json
{
  "applicationId": "APP-123",
  "documentBase64": "...100MB..."
}
```

Better:

```json
{
  "applicationId": "APP-123",
  "documentId": "DOC-456",
  "downloadUrl": "/documents/DOC-456/content"
}
```

---

## 34. Synchronous API and Database Transactions

Do not keep DB transaction open while calling remote service unless there is a very strong reason.

Bad:

```java
@Transactional
public void submit(...) {
    applicationRepository.save(application);
    profileClient.updateProfile(...); // remote call inside transaction
    paymentClient.reserve(...);       // remote call inside transaction
}
```

Problems:

```text
DB locks held during network wait
remote timeout causes transaction rollback ambiguity
connection pool exhaustion
deadlock risk
long transaction
cannot atomically rollback remote side effect
```

Better:

```text
validate local command
commit local transaction
write outbox event
async workflow continues
```

Or if synchronous validation is required:

```text
call remote validation before opening DB transaction
then open short local transaction
```

Pattern:

```java
public SubmissionResult submit(SubmitCommand command) {
    EligibilityResult eligibility = eligibilityClient.check(command.toEligibilityRequest());

    if (!eligibility.allowed()) {
        throw new NotEligibleException(eligibility.reasonCode());
    }

    return transactionTemplate.execute(tx -> {
        Application application = Application.submit(command);
        applicationRepository.save(application);
        outboxRepository.save(ApplicationSubmittedEvent.from(application));
        return SubmissionResult.from(application);
    });
}
```

---

## 35. Choosing Sync vs Async

Use this decision table.

| Question | If Yes | Preferred |
|---|---|---|
| Does caller need answer immediately? | yes | sync possible |
| Is operation long-running? | yes | async/workflow |
| Is downstream unreliable/slow? | yes | async or cached read model |
| Is side effect irreversible? | yes | idempotency + workflow/saga |
| Is fan-out high? | yes | materialized view/API composition carefully |
| Is user waiting interactively? | yes | sync with strict timeout |
| Is operation notification/broadcast? | yes | async event/message |
| Is strong invariant local? | yes | local transaction |
| Is invariant cross-service? | yes | redesign boundary/reservation/saga |

### Simple rule

```text
Use synchronous APIs for immediate decisions and bounded queries.
Use asynchronous messaging/workflow for durable progress and long-running side effects.
```

---

## 36. Synchronous API Anti-Patterns

### 36.1 Chatty API

```text
A calls B 30 times to render one screen.
```

Fix:

```text
coarser endpoint
BFF
read model
batch endpoint
projection
```

### 36.2 Generic API

```http
POST /common/execute
```

Fix:

```text
explicit capability endpoint
```

### 36.3 Shared Entity API

```text
Service exposes JPA entity directly.
```

Fix:

```text
API DTO
mapping layer
contract versioning
```

### 36.4 Hidden Remote Call

```java
application.getApplicant().getProfile().getAddress()
```

But internally each getter calls remote service.

Fix:

```text
explicit client call
explicit dependency in use case
```

### 36.5 Synchronous Saga Chain

```text
A -> B -> C -> D -> E all mutate state synchronously
```

Fix:

```text
workflow orchestration
outbox
saga
compensation
```

### 36.6 No Timeout

Fix:

```text
set connect/read/response/deadline timeouts
```

### 36.7 Retry Without Idempotency

Fix:

```text
idempotency key
retry only safe operations
```

### 36.8 Endpoint Mirrors Database

```http
GET /application_header
GET /application_detail
```

Fix:

```text
resource/capability-oriented API
```

### 36.9 One API for Everyone

Same endpoint tries to serve:

```text
mobile UI
admin UI
batch export
partner integration
internal workflow
```

Fix:

```text
separate representation/BFF/export API
```

### 36.10 Status Code Chaos

Same error sometimes returns:

```text
200 with error body
400
500
```

Fix:

```text
standard error taxonomy
```

---

## 37. Production Readiness Checklist

A synchronous API is production-ready only if these are answered.

### Contract

- [ ] Is endpoint business meaningful?
- [ ] Is request schema documented?
- [ ] Is response schema documented?
- [ ] Is error schema documented?
- [ ] Are status codes standardized?
- [ ] Are enum evolution rules defined?
- [ ] Is OpenAPI/contract available?
- [ ] Are breaking change rules defined?

### Runtime

- [ ] Is connect timeout set?
- [ ] Is read/response timeout set?
- [ ] Is total deadline considered?
- [ ] Is connection pool configured?
- [ ] Is max request size configured?
- [ ] Is max response/list size configured?
- [ ] Is rate limit configured?
- [ ] Is backpressure/load shedding considered?

### Reliability

- [ ] Is retry policy explicit?
- [ ] Is retry limited?
- [ ] Is jitter used?
- [ ] Are non-idempotent calls not retried blindly?
- [ ] Is idempotency key used for unsafe side effects?
- [ ] Is fallback behavior defined?
- [ ] Is partial response allowed?
- [ ] Is downstream failure mapped correctly?

### Security

- [ ] Is caller identity verified?
- [ ] Is user/service identity model clear?
- [ ] Is authorization enforced in owning service?
- [ ] Are sensitive fields excluded?
- [ ] Are error messages safe?
- [ ] Is tenant isolation enforced?
- [ ] Are headers trusted only after verification?

### Observability

- [ ] Is correlation ID propagated?
- [ ] Is trace context propagated?
- [ ] Are latency metrics collected?
- [ ] Are status/error code metrics collected?
- [ ] Are retry metrics collected?
- [ ] Are timeout metrics collected?
- [ ] Are dependency metrics visible?
- [ ] Can one request be traced across services?

### Evolution

- [ ] Are consumer contract tests in place?
- [ ] Is deprecation policy defined?
- [ ] Is compatibility tested before release?
- [ ] Is usage telemetry available before removing fields?
- [ ] Are clients generated or manually maintained deliberately?

---

## 38. Design Review Questions

Use these questions in architecture review.

1. Why is this call synchronous?
2. What happens if callee is slow?
3. What happens if callee is down?
4. What happens if response is lost after callee processed request?
5. Is the operation idempotent?
6. What is the timeout budget?
7. Who owns the data returned by this API?
8. Is the API exposing business capability or internal table/class structure?
9. How many downstream calls does this endpoint make?
10. Is there nested fan-out?
11. Can the caller continue with partial data?
12. What status code is returned for invalid state transition?
13. What error code can consumer rely on?
14. What fields can be added without breaking consumer?
15. How do we know whether consumers still use old fields?
16. Is authorization checked in the owning service?
17. Is correlation ID visible in all logs/traces?
18. Can this API be load tested independently?
19. Can this API be rolled back safely?
20. Is this API a sign of wrong service boundary?

---

## 39. Case Study: Application Approval API

### Scenario

A regulatory system has application lifecycle:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> PENDING_APPROVAL -> APPROVED / REJECTED / WITHDRAWN
```

Officer approves application.

### Bad API

```http
PATCH /applications/APP-123
{
  "status": "APPROVED"
}
```

Problems:

```text
approval treated as field update
authorization unclear
audit reason unclear
state transition guard unclear
idempotency unclear
side effect unclear
error semantics unclear
```

### Better API

```http
POST /applications/APP-123/approval
Idempotency-Key: decision-DEC-2026-0009
Authorization: Bearer <token>
X-Correlation-Id: 01JZ...
```

Request:

```json
{
  "decisionReference": "DEC-2026-0009",
  "decisionReason": "All mandatory checks passed.",
  "declarationVersion": "2026.1"
}
```

Success:

```http
200 OK
```

```json
{
  "applicationId": "APP-123",
  "status": "APPROVED",
  "approvedAt": "2026-06-19T14:15:00+07:00",
  "approvedBy": "officer-01",
  "decisionReference": "DEC-2026-0009"
}
```

Invalid state:

```http
409 Conflict
```

```json
{
  "code": "APPLICATION_INVALID_STATE",
  "status": 409,
  "detail": "Application APP-123 is WITHDRAWN and cannot be approved.",
  "correlationId": "01JZ..."
}
```

Duplicate same request:

```http
200 OK
```

Same response as original.

Duplicate same key different body:

```http
409 Conflict
```

```json
{
  "code": "IDEMPOTENCY_KEY_CONFLICT",
  "status": 409,
  "detail": "Idempotency key decision-DEC-2026-0009 was already used with a different request payload.",
  "correlationId": "01JZ..."
}
```

---

## 40. Java Implementation Sketch: Client Wrapper With Policy

```java
public final class ProfileHttpClient implements ProfileClient {
    private final HttpClient httpClient;
    private final URI baseUri;
    private final ObjectMapper objectMapper;

    public ProfileHttpClient(HttpClient httpClient, URI baseUri, ObjectMapper objectMapper) {
        this.httpClient = Objects.requireNonNull(httpClient);
        this.baseUri = Objects.requireNonNull(baseUri);
        this.objectMapper = Objects.requireNonNull(objectMapper);
    }

    @Override
    public ProfileSummary getProfileSummary(String applicantId, RequestContext context) {
        URI uri = baseUri.resolve("/profiles/" + encode(applicantId) + "/summary");

        HttpRequest request = HttpRequest.newBuilder()
                .uri(uri)
                .timeout(Duration.ofMillis(500))
                .header("Accept", "application/json")
                .header("X-Correlation-Id", context.correlationId())
                .header("X-Caller-Service", "application-service")
                .GET()
                .build();

        try {
            HttpResponse<String> response = httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString()
            );

            int status = response.statusCode();

            if (status == 200) {
                return objectMapper.readValue(response.body(), ProfileSummary.class);
            }

            if (status == 404) {
                throw new ProfileNotFoundException(applicantId);
            }

            if (status == 429 || status == 503 || status == 504) {
                throw new ProfileServiceTemporarilyUnavailableException(status);
            }

            if (status >= 400 && status < 500) {
                throw new ProfileClientRequestException(status, response.body());
            }

            throw new ProfileServiceException(status, response.body());
        } catch (HttpTimeoutException e) {
            throw new ProfileServiceTimeoutException(applicantId, e);
        } catch (IOException e) {
            throw new ProfileServiceNetworkException(applicantId, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ProfileServiceInterruptedException(applicantId, e);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
```

Notes:

1. Remote call is wrapped behind domain-specific client.
2. Timeout is explicit.
3. Error mapping is explicit.
4. Correlation ID is propagated.
5. Caller does not parse raw HTTP everywhere.
6. Client exception taxonomy can be used by resilience layer.

---

## 41. Advanced Mental Model: API as Capability Boundary

For top-tier engineering, do not ask only:

```text
What endpoint should we expose?
```

Ask:

```text
What capability are we promising?
Who owns this capability?
What invariant does it protect?
What latency can it guarantee?
What failure behavior does it expose?
What data is authoritative?
What can change without breaking consumers?
What must be audited?
What does caller do if this API is unavailable?
```

An API is not a controller method.

An API is a durable promise between teams and systems.

---

## 42. Summary

Synchronous API communication is useful but dangerous.

It is useful because:

```text
simple mental model
natural for query/request-response
easy integration
low operational complexity for small dependency graph
```

It is dangerous because:

```text
it creates temporal coupling
it propagates latency
it propagates failure
it can create distributed monolith
it can hide wrong boundaries
it can force coordinated releases
```

A production-grade synchronous API requires:

```text
clear contract
explicit timeout
safe retry
idempotency for side effects
consistent error model
pagination and payload limit
versioning and compatibility discipline
observability propagation
security boundary clarity
consumer-driven tests
```

The top 1% mindset is not “use REST” or “use gRPC”.

The top 1% mindset is:

```text
Treat every synchronous call as an architectural dependency with cost,
then design the contract, runtime behavior, and failure mode intentionally.
```

---

## 43. Practical Exercises

### Exercise 1 — Dependency Graph

Pick one endpoint in your system.

Draw:

```text
Frontend -> Gateway -> BFF -> Service A -> Service B -> DB
                              -> Service C -> DB
```

Answer:

1. Which dependencies are synchronous?
2. Which are required vs optional?
3. What is total timeout budget?
4. What happens if each dependency is slow?
5. What is the fallback behavior?

### Exercise 2 — Error Contract

Design error response for:

1. Invalid JSON.
2. Validation error.
3. Resource not found.
4. Unauthorized access.
5. Invalid state transition.
6. Downstream timeout.
7. Rate limit.

### Exercise 3 — Idempotency

Take one POST endpoint.

Answer:

1. Can client retry safely?
2. What is the idempotency key?
3. Where is request hash stored?
4. What response is returned on duplicate?
5. What happens if same key has different body?

### Exercise 4 — Versioning

Take one response DTO.

Classify possible changes:

```text
safe additive
unsafe breaking
requires new endpoint
requires deprecation
requires consumer migration
```

### Exercise 5 — Sync vs Async

Take one workflow.

Split steps into:

```text
must be synchronous
can be asynchronous
must be local transaction
requires saga/process manager
requires event notification
```

---

## 44. Referensi

- RFC 9110 — HTTP Semantics.
- OpenAPI Specification — standard language-agnostic description for HTTP APIs.
- Spring Framework Documentation — REST Clients: RestClient, WebClient, HTTP Interface Client.
- MicroProfile REST Client 4.0 specification.
- AWS Builders Library — timeout, retry, backoff, jitter principles.
- Google SRE Book — cascading failure and overload handling.
- Martin Fowler — Microservices and distributed system design trade-offs.
- Microservices.io — API Composition, Saga, Transactional Outbox, Database per Service.

---

# Status Seri

Part ini adalah **Part 5 dari 35**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 6 — Communication Pattern: Asynchronous Messaging
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-06-asynchronous-messaging.md
```
