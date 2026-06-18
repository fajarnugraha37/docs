# learn-java-reliability-part-003.md

# Part 003 — Exception Taxonomy for Enterprise Systems

> Seri: **Graceful Shutdown, Error Handling, Exceptions, and Reliability**  
> Target pembaca: Java engineer / tech lead yang ingin mendesain sistem backend yang defensible, observable, recoverable, dan production-grade.  
> Status seri: **Part 003 dari 030 — belum selesai**

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas semantik exception Java: `Throwable`, `Exception`, `RuntimeException`, `Error`, checked vs unchecked, propagation, cause chain, suppressed exception, dan resource-safety.

Bagian ini naik satu level: **bagaimana mengklasifikasikan exception dalam sistem enterprise**.

Masalah utama di sistem besar bukan sekadar ada exception. Masalah utamanya adalah:

1. exception tidak punya makna operasional yang jelas;
2. semua error diterjemahkan menjadi `500 Internal Server Error`;
3. exception teknis bocor ke domain/API;
4. exception domain bercampur dengan exception infrastruktur;
5. retry dilakukan pada error yang tidak boleh di-retry;
6. user error dianggap incident;
7. incident production dianggap validasi biasa;
8. invariant breach disembunyikan sebagai “bad request”;
9. error response tidak membantu client, operator, ataupun developer;
10. sistem kehilangan kemampuan menjawab: **apa yang sebenarnya gagal, siapa yang bisa memperbaiki, apakah aman diulang, dan apakah state sudah berubah?**

Di sistem kecil, `throw new RuntimeException("failed")` mungkin cukup untuk sementara. Di sistem enterprise, terutama sistem regulasi, keuangan, audit, enforcement, case management, atau workflow-heavy platform, exception harus menjadi **bahasa kegagalan sistem**.

Tujuan bagian ini adalah membangun taxonomy exception yang bisa dipakai untuk:

- desain domain service;
- desain API error contract;
- desain retry/fallback/circuit breaker;
- desain observability;
- desain incident response;
- desain audit trail;
- desain compensation/recovery;
- desain code review standard;
- desain production-readiness checklist.

---

## 1. Core Problem: Exception Tanpa Taxonomy Membuat Sistem Buta

Bayangkan sebuah endpoint:

```http
POST /applications/{applicationId}/approve
```

Endpoint ini bisa gagal karena banyak alasan:

1. `applicationId` formatnya salah.
2. application tidak ditemukan.
3. user tidak punya permission approve.
4. application status-nya bukan `PENDING_REVIEW`.
5. officer yang sama tidak boleh approve submission sendiri.
6. document wajib belum lengkap.
7. optimistic locking conflict.
8. database deadlock.
9. database connection pool habis.
10. external notification service timeout.
11. audit trail insert gagal.
12. state transition code punya bug dan menghasilkan impossible state.
13. pod sedang shutdown.
14. request duplicate karena client retry.
15. approval sudah berhasil commit, tapi response gagal dikirim.

Kalau semua ini dibungkus menjadi:

```java
throw new RuntimeException("Failed to approve application");
```

maka sistem kehilangan sinyal penting:

- Apakah client boleh memperbaiki request?
- Apakah user perlu action?
- Apakah operator harus alert?
- Apakah request boleh diulang?
- Apakah side effect sudah terjadi?
- Apakah ini bug?
- Apakah ini security event?
- Apakah ini business rule violation?
- Apakah response harus 400, 401, 403, 404, 409, 422, 429, 503, atau 500?
- Apakah harus dicatat sebagai audit trail?
- Apakah harus trigger incident?
- Apakah boleh fallback?
- Apakah retry otomatis aman?

Tanpa taxonomy, exception hanya menjadi “suara ledakan”, bukan informasi diagnostik.

---

## 2. Mental Model: Exception adalah Signal, Bukan Sekadar Control Flow

Exception dalam enterprise system sebaiknya dilihat sebagai **structured failure signal**.

Sebuah failure signal yang baik minimal menjawab:

```text
What failed?
Why did it fail?
Where did it fail?
Who can fix it?
Can it be retried?
Has state changed?
Is it expected?
Is it safe to expose?
Is it security-sensitive?
Is it operationally urgent?
```

Exception taxonomy adalah cara memberi struktur pada jawaban tersebut.

### 2.1 Exception sebagai Bahasa Antar-Layer

Setiap layer punya bahasa sendiri:

```text
HTTP/API layer       -> status code, error code, problem response
Application service -> use case failure, command rejection, conflict
Domain layer        -> invariant breach, business rule violation, illegal transition
Persistence layer   -> constraint violation, deadlock, stale update, connection failure
Integration layer   -> timeout, 429, 401, schema drift, provider unavailable
Infrastructure      -> shutdown, saturation, resource exhaustion
```

Kesalahan umum: satu layer membocorkan bahasanya ke layer lain.

Contoh buruk:

```java
public Application approve(UUID id) {
    try {
        return repository.approve(id);
    } catch (SQLException e) {
        throw new RuntimeException(e);
    }
}
```

Masalah:

- service layer tahu terlalu sedikit;
- API layer nanti tidak tahu ini deadlock, duplicate key, unavailable, atau bug;
- retry policy tidak bisa membedakan transient vs permanent;
- response code akan asal;
- log akan miskin konteks.

Contoh lebih baik:

```java
public Application approve(ApproveApplicationCommand command) {
    try {
        Application application = repository.findForUpdate(command.applicationId())
                .orElseThrow(() -> new ApplicationNotFoundException(command.applicationId()));

        application.approveBy(command.officerId(), clock.instant());

        repository.save(application);
        return application;
    } catch (OptimisticLockingFailureException e) {
        throw new ApplicationApprovalConflictException(command.applicationId(), e);
    } catch (DataAccessResourceFailureException e) {
        throw new ApplicationApprovalTemporarilyUnavailableException(command.applicationId(), e);
    }
}
```

Lebih baik bukan karena class-nya banyak, tetapi karena signal-nya lebih jelas.

---

## 3. Dimensi Taxonomy Exception

Exception bisa diklasifikasikan dari beberapa dimensi. Jangan hanya memakai satu dimensi seperti “checked vs unchecked”, karena itu terlalu rendah-level.

Dimensi yang penting:

1. **Source** — dari mana failure berasal?
2. **Nature** — apakah domain, technical, infrastructure, security, atau data?
3. **Expectation** — expected atau unexpected?
4. **Recoverability** — bisa dipulihkan atau tidak?
5. **Retryability** — aman di-retry atau tidak?
6. **Correctability** — siapa yang bisa memperbaiki?
7. **Exposure** — detail apa yang aman dikirim ke client?
8. **State impact** — apakah state sudah berubah?
9. **Operational severity** — perlu alert atau cukup log biasa?
10. **Consistency risk** — apakah ada risiko partial side effect?

Satu exception bisa punya beberapa atribut sekaligus.

Contoh:

```text
DuplicateApplicationSubmissionException
- Source: domain/application service
- Nature: business conflict
- Expected: yes
- Recoverable: yes, by user/client decision
- Retryable: no, unless using same idempotency key and deterministic response
- Correctable by: client/user
- Exposure: safe with business message
- State impact: maybe existing application already exists
- Operational severity: low
- Consistency risk: low if idempotency designed well
```

Contoh lain:

```text
AuditTrailPersistenceException
- Source: persistence/infrastructure
- Nature: compliance-critical technical failure
- Expected: no, but possible
- Recoverable: maybe by retry or operator
- Retryable: maybe, depends on cause
- Correctable by: operator/developer
- Exposure: generic 500/503 to client
- State impact: dangerous if business state committed without audit
- Operational severity: high
- Consistency risk: high
```

---

## 4. Primary Enterprise Exception Categories

Berikut taxonomy utama yang akan sering dipakai dalam sistem enterprise.

---

## 4.1 Validation Error

Validation error terjadi ketika input dari client/user tidak memenuhi kontrak input.

Contoh:

- field wajib kosong;
- tanggal tidak valid;
- email format salah;
- enum value tidak dikenal;
- `amount` negatif;
- list terlalu panjang;
- string melebihi panjang maksimum;
- kombinasi field tidak valid secara syntactic contract.

Validation error biasanya:

```text
Expected: yes
Client-correctable: yes
Retryable as-is: no
HTTP: 400 Bad Request atau 422 Unprocessable Content tergantung policy API
Severity: low
Alert: no
Expose detail: yes, field-level
```

Contoh class:

```java
public final class RequestValidationException extends ClientCorrectableException {
    private final List<FieldViolation> violations;

    public RequestValidationException(List<FieldViolation> violations) {
        super("Request validation failed");
        this.violations = List.copyOf(violations);
    }

    public List<FieldViolation> violations() {
        return violations;
    }
}
```

Contoh field violation:

```java
public record FieldViolation(
        String field,
        String code,
        String message
) {}
```

Contoh response:

```json
{
  "type": "https://errors.example.com/validation/request-invalid",
  "title": "Request validation failed",
  "status": 400,
  "code": "REQUEST_VALIDATION_FAILED",
  "violations": [
    {
      "field": "submittedDate",
      "code": "MUST_NOT_BE_FUTURE",
      "message": "submittedDate must not be in the future"
    }
  ],
  "correlationId": "01HV..."
}
```

### 4.1.1 Common Mistake

Jangan mencampur validation error dengan business rule violation.

Contoh:

```text
amount must be positive
```

Ini validation.

```text
application cannot be approved because it is already withdrawn
```

Ini bukan sekadar validation input; ini business/state rule.

---

## 4.2 Authentication Error

Authentication error terjadi ketika identitas caller tidak valid atau tidak dapat diverifikasi.

Contoh:

- missing token;
- expired token;
- invalid signature;
- malformed credential;
- session expired;
- identity provider unavailable saat login;
- mTLS client certificate invalid.

Karakteristik:

```text
Expected: yes
Client/user-correctable: sometimes
Retryable: depends; expired token -> refresh, invalid token -> no
HTTP: 401 Unauthorized
Severity: low to medium
Alert: only if abnormal spike
Expose detail: limited
Security-sensitive: yes
```

Contoh:

```java
public final class AuthenticationRequiredException extends SecurityExceptionBase {
    public AuthenticationRequiredException() {
        super("Authentication is required");
    }
}

public final class InvalidAccessTokenException extends SecurityExceptionBase {
    public InvalidAccessTokenException(Throwable cause) {
        super("Access token is invalid", cause);
    }
}
```

### 4.2.1 Security Rule

Jangan expose detail seperti:

```text
JWT signature invalid because key id abc not found
```

ke public client.

Detail itu boleh ada di internal logs dengan sanitasi, tapi response cukup:

```json
{
  "code": "AUTHENTICATION_FAILED",
  "message": "Authentication failed"
}
```

---

## 4.3 Authorization Error

Authorization error terjadi ketika caller sudah dikenali, tetapi tidak punya hak melakukan aksi.

Contoh:

- user tidak punya role;
- user bukan assignee case;
- officer tidak boleh approve case sendiri;
- agency mismatch;
- record berada di scope organisasi lain;
- permission revoked.

Karakteristik:

```text
Expected: yes
Client-correctable: rarely
User-correctable: maybe request access
Retryable: no
HTTP: 403 Forbidden
Severity: low to medium
Alert: only for suspicious pattern
Expose detail: careful
Security-sensitive: yes
```

Contoh:

```java
public final class ForbiddenActionException extends AuthorizationException {
    private final String action;
    private final String resourceType;

    public ForbiddenActionException(String action, String resourceType) {
        super("Current user is not allowed to perform this action");
        this.action = action;
        this.resourceType = resourceType;
    }
}
```

### 4.3.1 Avoid Enumeration Leak

Kalau user tidak punya akses ke resource, kadang response `404 Not Found` lebih aman daripada `403 Forbidden`, terutama untuk resource yang keberadaannya sensitif.

Contoh:

```text
GET /investigations/{id}
```

Jika resource ada tapi user tidak boleh tahu, `404` bisa lebih aman daripada `403`.

Namun untuk internal enterprise app, UX dan audit requirement bisa berbeda. Yang penting: policy harus konsisten.

---

## 4.4 Not Found Error

Not found terjadi ketika entity/resource tidak ditemukan dalam scope yang valid.

Contoh:

- application ID tidak ada;
- case ID tidak ada;
- document sudah dihapus;
- user mencari resource di agency yang salah;
- lookup reference data tidak ada.

Karakteristik:

```text
Expected: yes
Client-correctable: yes/no, depends
Retryable: no, unless eventual consistency/read replica lag
HTTP: 404 Not Found
Severity: low
Alert: no, except spike suspicious
Expose detail: safe if resource existence not sensitive
```

Contoh:

```java
public abstract class EntityNotFoundException extends DomainException {
    private final String entityType;
    private final String entityId;

    protected EntityNotFoundException(String entityType, String entityId) {
        super(entityType + " not found");
        this.entityType = entityType;
        this.entityId = entityId;
    }
}

public final class ApplicationNotFoundException extends EntityNotFoundException {
    public ApplicationNotFoundException(UUID applicationId) {
        super("Application", applicationId.toString());
    }
}
```

### 4.4.1 Not Found vs Authorization

Tidak semua `not found` berarti entity tidak ada secara database.

Kadang “not found” adalah security decision:

```text
Resource exists, but not in caller scope -> return 404
```

Taxonomy internal harus tetap bisa membedakan:

```text
ActualNotFound
ScopedNotFound
AccessHiddenAsNotFound
```

Namun external response boleh sama.

---

## 4.5 Business Rule Violation

Business rule violation terjadi ketika command/request secara syntactic valid, tetapi tidak diperbolehkan oleh aturan bisnis.

Contoh:

- application belum lengkap sehingga tidak bisa submit;
- appeal sudah melewati deadline;
- officer tidak boleh assign case ke dirinya sendiri;
- renewal hanya bisa dibuat 60 hari sebelum expiry;
- document wajib belum uploaded;
- case tidak boleh close jika outstanding action masih ada.

Karakteristik:

```text
Expected: yes
Client/user-correctable: usually yes
Retryable as-is: no
HTTP: often 409 Conflict atau 422 Unprocessable Content
Severity: low
Alert: no
Expose detail: yes, business-safe
```

Contoh:

```java
public abstract class BusinessRuleViolationException extends DomainException {
    private final String ruleCode;

    protected BusinessRuleViolationException(String ruleCode, String message) {
        super(message);
        this.ruleCode = ruleCode;
    }

    public String ruleCode() {
        return ruleCode;
    }
}

public final class ApplicationIncompleteException extends BusinessRuleViolationException {
    public ApplicationIncompleteException(UUID applicationId, List<String> missingItems) {
        super("APPLICATION_INCOMPLETE", "Application is incomplete");
        this.missingItems = List.copyOf(missingItems);
    }

    private final List<String> missingItems;

    public List<String> missingItems() {
        return missingItems;
    }
}
```

### 4.5.1 Business Rule Violation vs Validation

Input validation:

```text
submittedDate is not a valid date
```

Business rule:

```text
submittedDate cannot be earlier than license effective date
```

State rule:

```text
application in WITHDRAWN state cannot be approved
```

Semakin dekat ke domain state, semakin tidak tepat jika diperlakukan sebagai generic request validation.

---

## 4.6 State Conflict

State conflict terjadi ketika request valid, tetapi bertabrakan dengan state saat ini.

Contoh:

- optimistic locking conflict;
- entity sudah berubah sejak user melihat data;
- command duplicate;
- state transition sudah dilakukan;
- resource sedang diproses worker lain;
- concurrent approval;
- version mismatch.

Karakteristik:

```text
Expected: yes in concurrent systems
Client-correctable: yes, refresh/retry with latest state
Retryable as-is: usually no
HTTP: 409 Conflict
Severity: low to medium
Alert: only if spike
Expose detail: yes but safe
```

Contoh:

```java
public final class StaleApplicationVersionException extends StateConflictException {
    private final UUID applicationId;
    private final long expectedVersion;
    private final long actualVersion;

    public StaleApplicationVersionException(UUID applicationId, long expectedVersion, long actualVersion) {
        super("Application has been modified by another transaction");
        this.applicationId = applicationId;
        this.expectedVersion = expectedVersion;
        this.actualVersion = actualVersion;
    }
}
```

### 4.6.1 Conflict Harus Dipisah dari 500

Optimistic locking conflict bukan incident. Itu bagian normal dari sistem concurrent.

Buruk:

```java
catch (OptimisticLockException e) {
    throw new InternalServerErrorException(e);
}
```

Lebih baik:

```java
catch (OptimisticLockingFailureException e) {
    throw new StaleApplicationVersionException(applicationId, expectedVersion, actualVersion);
}
```

---

## 4.7 Idempotency Conflict / Duplicate Command

Duplicate command terjadi ketika request yang sama atau mirip dikirim lebih dari sekali.

Contoh:

- user double-click submit;
- client retry setelah timeout;
- gateway retry;
- message redelivery;
- batch job replay;
- webhook provider mengirim event yang sama berkali-kali.

Karakteristik:

```text
Expected: yes
Client-correctable: depends
Retryable: only if idempotency key semantics clear
HTTP: 200/201 with previous result, 202, atau 409 depending semantics
Severity: low
Alert: no, except abnormal duplicate rate
```

Contoh exception:

```java
public final class IdempotencyKeyConflictException extends StateConflictException {
    private final String idempotencyKey;

    public IdempotencyKeyConflictException(String idempotencyKey) {
        super("Idempotency key was already used for a different request payload");
        this.idempotencyKey = idempotencyKey;
    }
}
```

Perbedaan penting:

```text
Same idempotency key + same payload + previous success
-> return previous deterministic response

Same idempotency key + different payload
-> 409 conflict

No idempotency key + duplicate business key
-> business conflict or duplicate resource conflict
```

---

## 4.8 External Dependency Failure

External dependency failure terjadi ketika sistem bergantung pada sistem lain dan batas itu gagal.

Contoh:

- REST API timeout;
- provider 500;
- provider 429;
- DNS failure;
- TLS handshake failure;
- token endpoint down;
- schema response berubah;
- invalid response body;
- external service lambat;
- provider mengembalikan status bisnis yang tidak dikenal.

Karakteristik umum:

```text
Expected: yes, because network/dependency unreliable
Client-correctable: no
Operator-correctable: sometimes
Retryable: depends on failure class
HTTP: 502/503/504 or domain-specific degraded response
Severity: medium to high depending dependency
Alert: yes if sustained or critical
Expose detail: limited
```

Contoh taxonomy lebih detail:

```java
public abstract class ExternalDependencyException extends ApplicationException {
    private final String dependencyName;
    private final boolean retryable;

    protected ExternalDependencyException(String dependencyName, boolean retryable, String message, Throwable cause) {
        super(message, cause);
        this.dependencyName = dependencyName;
        this.retryable = retryable;
    }
}

public final class ExternalDependencyTimeoutException extends ExternalDependencyException {
    public ExternalDependencyTimeoutException(String dependencyName, Throwable cause) {
        super(dependencyName, true, dependencyName + " timed out", cause);
    }
}

public final class ExternalDependencyRateLimitedException extends ExternalDependencyException {
    public ExternalDependencyRateLimitedException(String dependencyName, Throwable cause) {
        super(dependencyName, true, dependencyName + " rate limit exceeded", cause);
    }
}

public final class ExternalDependencyContractViolationException extends ExternalDependencyException {
    public ExternalDependencyContractViolationException(String dependencyName, Throwable cause) {
        super(dependencyName, false, dependencyName + " returned an invalid response", cause);
    }
}
```

### 4.8.1 Jangan Semua External Error Di-Retry

Retry boleh untuk:

- timeout transient;
- 503;
- 429 dengan backoff;
- connection reset;
- temporary DNS failure.

Retry berbahaya untuk:

- 400 dari provider;
- 401 karena credential salah;
- 403 forbidden;
- schema mismatch;
- business rejection;
- duplicate request tanpa idempotency;
- provider already processed but response lost.

---

## 4.9 Timeout Error

Timeout adalah kategori yang sangat penting karena timeout sering ambigu.

Timeout bisa berarti:

1. remote service belum menerima request;
2. remote service menerima tapi belum memproses;
3. remote service sudah memproses tapi response lambat;
4. remote service sudah commit side effect tapi response tidak sampai;
5. network path bermasalah;
6. local thread pool/pool queue penuh;
7. client sendiri membatalkan request.

Karakteristik:

```text
Expected: yes
Retryable: maybe
State impact: unknown if side effect crossed boundary
HTTP: 504 for gateway timeout, 503 for local dependency saturation, 408 for client timeout depending layer
Severity: medium if frequent
Expose detail: limited
```

Contoh:

```java
public final class DependencyTimeoutException extends ExternalDependencyException {
    private final Duration timeout;
    private final String operation;

    public DependencyTimeoutException(String dependencyName, String operation, Duration timeout, Throwable cause) {
        super(dependencyName, true, dependencyName + " operation timed out", cause);
        this.operation = operation;
        this.timeout = timeout;
    }
}
```

### 4.9.1 Timeout Tidak Sama dengan Failure Sederhana

Timeout adalah **unknown outcome** jika request sudah dikirim ke dependency yang punya side effect.

Contoh:

```text
POST /payments
-> timeout
```

Tidak boleh langsung asumsi payment gagal. Mungkin payment berhasil tapi response hilang.

Maka taxonomy harus bisa membawa metadata:

```text
outcome = UNKNOWN
safeToRetry = ONLY_WITH_IDEMPOTENCY_KEY
```

---

## 4.10 Data Integrity Violation

Data integrity violation terjadi ketika database menolak operasi karena constraint atau rule persistence.

Contoh:

- unique key violation;
- foreign key violation;
- not null violation;
- check constraint violation;
- data too long;
- numeric overflow;
- invalid enum mapping;
- duplicate business key.

Karakteristik:

```text
Expected: sometimes
Client-correctable: depends
Developer-correctable: if invariant should have been checked earlier
Retryable: usually no
HTTP: 409, 400, 422, or 500 depending meaning
Severity: low to high depending cause
```

Contoh:

```java
public final class DuplicateApplicationNumberException extends StateConflictException {
    private final String applicationNumber;

    public DuplicateApplicationNumberException(String applicationNumber, Throwable cause) {
        super("Application number already exists", cause);
        this.applicationNumber = applicationNumber;
    }
}
```

### 4.10.1 Constraint Violation Bisa Punya Banyak Makna

Unique constraint violation pada idempotency table:

```text
expected duplicate request -> normal conflict/idempotent response
```

Foreign key violation pada production data:

```text
possible bug or data corruption -> high severity
```

Not null violation untuk field yang harus selalu diisi service:

```text
bug/invariant breach -> 500 and alert
```

Jadi jangan mapping semua `DataIntegrityViolationException` menjadi response yang sama.

---

## 4.11 Resource Exhaustion / Saturation

Resource exhaustion terjadi ketika sistem tidak bisa menerima/menyelesaikan beban karena resource terbatas.

Contoh:

- connection pool exhausted;
- thread pool queue full;
- memory pressure;
- disk full;
- CPU saturated;
- file descriptor exhausted;
- rate limit internal;
- queue backlog terlalu tinggi;
- database session limit tercapai.

Karakteristik:

```text
Expected: possible under load
Client-correctable: no
Operator-correctable: yes
Retryable: only with backoff, not immediate
HTTP: 429, 503
Severity: medium to critical
Alert: yes
Expose detail: generic
```

Contoh:

```java
public final class LocalResourceSaturationException extends InfrastructureException {
    private final String resource;

    public LocalResourceSaturationException(String resource, Throwable cause) {
        super("Local resource is saturated: " + resource, cause);
        this.resource = resource;
    }
}
```

### 4.11.1 Saturation Harus Menghasilkan Backpressure

Jika sistem saturated tetapi tetap menerima work baru, maka error akan menyebar.

Signal yang benar:

```text
HTTP 503 + Retry-After
or
HTTP 429 + Retry-After
or
queue reject/nack with requeue policy
```

Bukan:

```text
500 Internal Server Error tanpa metadata
```

---

## 4.12 Invariant Violation / Impossible State

Invariant violation adalah kategori paling penting untuk membedakan **user error** dari **bug/system corruption**.

Invariant adalah aturan yang harus selalu benar jika sistem bekerja benar.

Contoh:

- approved application tidak punya approver;
- case status `CLOSED` tetapi masih punya active task wajib;
- payment status `PAID` tetapi paid amount null;
- state transition dari `DRAFT` langsung ke `APPROVED` padahal harus `SUBMITTED`;
- audit event dibuat tanpa actor;
- command handler menerima aggregate dengan version negatif;
- enum state dari database tidak dikenal.

Karakteristik:

```text
Expected: no
Client-correctable: no
Developer/operator-correctable: yes
Retryable: no, unless after repair
HTTP: 500
Severity: high
Alert: yes
Expose detail: no
State impact: potentially dangerous
```

Contoh:

```java
public final class DomainInvariantViolationException extends DomainException {
    private final String invariantCode;

    public DomainInvariantViolationException(String invariantCode, String message) {
        super(message);
        this.invariantCode = invariantCode;
    }
}
```

Contoh pemakaian:

```java
public void approveBy(UserId approverId, Instant approvedAt) {
    if (status != ApplicationStatus.PENDING_REVIEW) {
        throw new IllegalStateTransitionException(
                "APPLICATION_APPROVAL_REQUIRES_PENDING_REVIEW",
                id,
                status,
                ApplicationStatus.APPROVED
        );
    }

    if (approverId == null) {
        throw new DomainInvariantViolationException(
                "APPROVED_APPLICATION_REQUIRES_APPROVER",
                "Approved application must have an approver"
        );
    }

    this.status = ApplicationStatus.APPROVED;
    this.approvedBy = approverId;
    this.approvedAt = approvedAt;
}
```

### 4.12.1 Jangan Ubah Invariant Violation Menjadi 400

Buruk:

```java
catch (IllegalStateException e) {
    return badRequest(e.getMessage());
}
```

Kenapa buruk?

Karena `IllegalStateException` bisa berarti bug serius. Jika semua `IllegalStateException` jadi 400, production bug akan tampak seperti kesalahan user.

Lebih baik pisahkan:

```text
BusinessRuleViolationException -> 409/422
StateConflictException         -> 409
DomainInvariantViolation       -> 500 + alert
```

---

## 4.13 Shutdown / Draining Rejection

Saat aplikasi sedang graceful shutdown, ada request/work baru yang harus ditolak.

Contoh:

- pod menerima request setelah readiness false belum tersebar;
- worker sedang draining dan tidak boleh mengambil message baru;
- scheduler ingin start job baru saat app shutdown;
- executor menolak task karena shutdown.

Karakteristik:

```text
Expected: yes during deployment/termination
Client-correctable: retry later
Retryable: yes with backoff
HTTP: 503 Service Unavailable
Severity: low if during deployment, high if frequent outside deployment
Alert: depends
Expose detail: safe generic
```

Contoh:

```java
public final class ServiceDrainingException extends InfrastructureException {
    public ServiceDrainingException() {
        super("Service is draining and not accepting new work");
    }
}
```

Response:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 5
```

```json
{
  "code": "SERVICE_DRAINING",
  "message": "Service is temporarily unavailable. Please retry later.",
  "retryable": true
}
```

---

## 4.14 Audit / Compliance Failure

Audit/compliance failure terjadi ketika sistem gagal mencatat evidence yang diwajibkan.

Contoh:

- audit trail insert gagal;
- event compliance tidak terkirim;
- actor tidak tersedia;
- timestamp tidak valid;
- immutable log unavailable;
- redaction pipeline gagal;
- evidence hash mismatch.

Karakteristik:

```text
Expected: no, but must be planned
Client-correctable: no
Operator-correctable: yes
Retryable: depends
HTTP: 500/503 depending architecture
Severity: high
Alert: yes
Expose detail: generic
State impact: very important
```

Audit failure bukan sekadar technical logging failure.

Jika sistem regulasi melakukan state mutation tanpa audit evidence, maka masalahnya bukan hanya observability. Itu bisa menjadi masalah defensibility.

Pattern yang mungkin:

1. fail transaction jika audit wajib gagal;
2. write audit in same transaction;
3. use outbox untuk guaranteed delivery;
4. block high-risk operation ketika audit subsystem unavailable;
5. degrade only for non-critical telemetry, bukan audit wajib.

Contoh:

```java
public final class MandatoryAuditWriteException extends ComplianceException {
    public MandatoryAuditWriteException(String operation, Throwable cause) {
        super("Mandatory audit write failed for operation: " + operation, cause);
    }
}
```

---

## 4.15 Configuration / Deployment Error

Configuration error terjadi ketika aplikasi berjalan dengan konfigurasi yang salah, hilang, atau tidak konsisten.

Contoh:

- required env variable missing;
- SSM parameter tidak ada;
- invalid URL;
- invalid timeout value;
- invalid feature flag combination;
- migration belum jalan;
- incompatible schema version;
- secret expired;
- wrong endpoint per environment.

Karakteristik:

```text
Expected: no in healthy deployment
Client-correctable: no
Operator-correctable: yes
Retryable: no until config fixed
HTTP: 500/503
Severity: high
Alert: yes
Expose detail: no
Fail startup: often yes
```

Contoh:

```java
public final class InvalidRuntimeConfigurationException extends InfrastructureException {
    public InvalidRuntimeConfigurationException(String key, String reason) {
        super("Invalid runtime configuration for key: " + key + ", reason: " + reason);
    }
}
```

### 4.15.1 Fail Startup vs Fail Later

Untuk config wajib, lebih baik fail saat startup daripada gagal saat user request.

Buruk:

```java
String tokenEndpoint = System.getenv("TOKEN_ENDPOINT");
// null baru ketahuan saat login request
```

Lebih baik:

```java
@ConfigurationProperties(prefix = "integration.identity-provider")
@Validated
public record IdentityProviderProperties(
        @NotBlank String tokenEndpoint,
        @NotBlank String clientId,
        @NotBlank String secretParameterName
) {}
```

---

## 4.16 Serialization / Contract Error

Serialization/contract error terjadi ketika data tidak bisa dibaca/ditulis sesuai schema.

Contoh:

- JSON malformed dari client;
- unknown enum dari external provider;
- missing mandatory field dari provider;
- date format berubah;
- incompatible message schema;
- event version tidak didukung;
- binary payload rusak.

Karakteristik:

```text
Source client malformed: 400
Source external provider: 502 / dependency contract violation
Source internal event: incident / dead-letter
Retryable: usually no without change
Severity: depends source
```

Contoh:

```java
public final class ExternalPayloadContractViolationException extends ExternalDependencyException {
    public ExternalPayloadContractViolationException(String dependencyName, String payloadType, Throwable cause) {
        super(dependencyName, false, dependencyName + " returned invalid " + payloadType, cause);
    }
}
```

---

## 5. Cross-Cutting Classification Matrix

Exception category saja belum cukup. Tambahkan atribut operasional.

| Category | Expected? | Retryable? | Corrected By | Typical HTTP | Alert? | Expose Detail? |
|---|---:|---:|---|---:|---:|---:|
| Validation | Yes | No | Client/user | 400/422 | No | Yes |
| Authentication | Yes | Depends | User/client | 401 | Spike only | Limited |
| Authorization | Yes | No | Admin/user | 403/404 | Spike only | Limited |
| Not Found | Yes | No | Client/user | 404 | No | Usually |
| Business Rule | Yes | No | User/business process | 409/422 | No | Yes |
| State Conflict | Yes | Maybe after refresh | Client/user | 409 | Spike only | Yes |
| Idempotency Conflict | Yes | Depends | Client | 409/200/201 | No | Yes |
| External Timeout | Yes | Maybe | System/operator | 503/504 | If sustained | Limited |
| External 429 | Yes | Yes with backoff | System/operator | 503/429 | If sustained | Limited |
| DB Deadlock | Yes under concurrency | Yes with bounded retry | System | 503/409 | If sustained | No |
| Data Integrity | Sometimes | Usually no | Client/dev/operator | 409/422/500 | Depends | Depends |
| Resource Saturation | Yes under load | Later only | Operator/system | 429/503 | Yes | Limited |
| Invariant Violation | No | No | Developer/operator | 500 | Yes | No |
| Audit Failure | No | Depends | Operator/system | 500/503 | Yes | No |
| Config Error | No | No | Operator | 500/503 | Yes | No |
| Serialization Client | Yes | No | Client | 400 | No | Yes |
| Serialization Provider | No-ish | No | Provider/operator | 502 | Yes | Limited |
| Shutdown Rejection | Yes | Yes later | Client/system | 503 | Depends | Limited |

---

## 6. Designing an Exception Hierarchy

Exception hierarchy harus membantu code membuat keputusan. Jangan membuat hierarchy hanya agar terlihat “OOP”.

Tujuan hierarchy:

1. membedakan domain vs technical;
2. membedakan client-correctable vs non-client-correctable;
3. membedakan expected vs unexpected;
4. membawa metadata yang dibutuhkan API/observability;
5. preserve cause chain;
6. tidak mengikat domain ke HTTP;
7. tidak mengikat domain ke framework;
8. tidak terlalu granular sampai sulit digunakan.

---

## 6.1 Contoh High-Level Hierarchy

```text
ApplicationException
├── ClientCorrectableException
│   ├── RequestValidationException
│   ├── MalformedRequestException
│   └── UnsupportedOperationRequestException
│
├── SecurityExceptionBase
│   ├── AuthenticationExceptionBase
│   └── AuthorizationExceptionBase
│
├── DomainException
│   ├── EntityNotFoundException
│   ├── BusinessRuleViolationException
│   ├── StateConflictException
│   ├── IdempotencyException
│   └── DomainInvariantViolationException
│
├── IntegrationException
│   ├── ExternalDependencyTimeoutException
│   ├── ExternalDependencyUnavailableException
│   ├── ExternalDependencyRateLimitedException
│   └── ExternalPayloadContractViolationException
│
├── PersistenceFailureException
│   ├── PersistenceUnavailableException
│   ├── DataIntegrityMappingException
│   ├── DuplicateBusinessKeyException
│   └── StaleWriteException
│
├── InfrastructureException
│   ├── ServiceDrainingException
│   ├── LocalResourceSaturationException
│   ├── InvalidRuntimeConfigurationException
│   └── ShutdownInterruptedException
│
└── ComplianceException
    ├── MandatoryAuditWriteException
    └── EvidenceIntegrityException
```

---

## 6.2 Base Exception dengan Metadata

Contoh base exception:

```java
public abstract class ApplicationException extends RuntimeException {
    private final String errorCode;
    private final ErrorCategory category;
    private final boolean retryable;
    private final boolean expected;
    private final ErrorCorrector corrector;

    protected ApplicationException(
            String errorCode,
            ErrorCategory category,
            boolean retryable,
            boolean expected,
            ErrorCorrector corrector,
            String message
    ) {
        super(message);
        this.errorCode = Objects.requireNonNull(errorCode);
        this.category = Objects.requireNonNull(category);
        this.retryable = retryable;
        this.expected = expected;
        this.corrector = Objects.requireNonNull(corrector);
    }

    protected ApplicationException(
            String errorCode,
            ErrorCategory category,
            boolean retryable,
            boolean expected,
            ErrorCorrector corrector,
            String message,
            Throwable cause
    ) {
        super(message, cause);
        this.errorCode = Objects.requireNonNull(errorCode);
        this.category = Objects.requireNonNull(category);
        this.retryable = retryable;
        this.expected = expected;
        this.corrector = Objects.requireNonNull(corrector);
    }

    public String errorCode() {
        return errorCode;
    }

    public ErrorCategory category() {
        return category;
    }

    public boolean retryable() {
        return retryable;
    }

    public boolean expected() {
        return expected;
    }

    public ErrorCorrector corrector() {
        return corrector;
    }
}
```

Enums:

```java
public enum ErrorCategory {
    VALIDATION,
    AUTHENTICATION,
    AUTHORIZATION,
    NOT_FOUND,
    BUSINESS_RULE,
    STATE_CONFLICT,
    IDEMPOTENCY,
    EXTERNAL_DEPENDENCY,
    PERSISTENCE,
    INFRASTRUCTURE,
    COMPLIANCE,
    INVARIANT,
    UNKNOWN
}

public enum ErrorCorrector {
    CLIENT,
    USER,
    OPERATOR,
    DEVELOPER,
    PROVIDER,
    SYSTEM,
    NONE
}
```

### 6.2.1 Catatan Desain

Jangan semua metadata harus ada di base class. Untuk sistem kecil, cukup `errorCode` dan `category`. Untuk sistem besar, atribut seperti `retryable`, `expected`, dan `corrector` sangat membantu.

Namun jangan masukkan HTTP status ke domain exception.

Buruk:

```java
public class BusinessRuleViolationException extends RuntimeException {
    private final int httpStatus = 409;
}
```

Lebih baik:

```java
BusinessRuleViolationException -> mapped by API layer to 409/422
```

Domain tidak perlu tahu HTTP.

---

## 7. Error Code Design

Exception class berguna di Java runtime. Error code berguna untuk API, logs, metrics, support, dan client automation.

### 7.1 Error Code Harus Stabil

Buruk:

```json
{
  "message": "Cannot approve this application because it is not in pending review status"
}
```

Client sulit membuat logic berdasarkan message.

Lebih baik:

```json
{
  "code": "APPLICATION_APPROVAL_INVALID_STATE",
  "message": "Application cannot be approved from its current state"
}
```

### 7.2 Naming Convention

Contoh pola:

```text
<DOMAIN>_<OPERATION>_<REASON>
<RESOURCE>_<CONDITION>
<DEPENDENCY>_<FAILURE_TYPE>
<SYSTEM>_<FAILURE_TYPE>
```

Contoh:

```text
APPLICATION_NOT_FOUND
APPLICATION_APPROVAL_INVALID_STATE
APPLICATION_APPROVAL_REQUIRES_COMPLETE_DOCUMENTS
APPLICATION_VERSION_CONFLICT
IDEMPOTENCY_KEY_PAYLOAD_MISMATCH
ONEMAP_RATE_LIMITED
IDENTITY_PROVIDER_TOKEN_EXPIRED
DATABASE_UNAVAILABLE
AUDIT_WRITE_FAILED
SERVICE_DRAINING
INTERNAL_INVARIANT_VIOLATION
```

### 7.3 Jangan Terlalu Banyak Error Code Acak

Error code harus cukup granular untuk action, tetapi tidak terlalu banyak hingga tidak bisa dikelola.

Rule praktis:

```text
Buat error code baru jika remediation/action berbeda.
Jangan buat error code baru hanya karena message sedikit berbeda.
```

Contoh:

```text
APPLICATION_MISSING_DOCUMENTS
```

cukup jika missing document list ada di detail.

Tidak perlu:

```text
APPLICATION_MISSING_NRIC_DOCUMENT
APPLICATION_MISSING_LICENSE_DOCUMENT
APPLICATION_MISSING_DECLARATION_DOCUMENT
```

kecuali setiap document punya remediation/workflow berbeda.

---

## 8. Exception to HTTP Mapping

Mapping harus dilakukan di boundary API.

Contoh mapping:

```text
RequestValidationException                -> 400
MalformedJsonException                    -> 400
AuthenticationRequiredException           -> 401
InvalidAccessTokenException               -> 401
ForbiddenActionException                  -> 403
ApplicationNotFoundException              -> 404
BusinessRuleViolationException            -> 409 or 422
StateConflictException                    -> 409
IdempotencyKeyConflictException           -> 409
ExternalDependencyTimeoutException        -> 504 or 503
ExternalDependencyUnavailableException    -> 503 or 502
ExternalPayloadContractViolationException -> 502
LocalResourceSaturationException          -> 503 or 429
ServiceDrainingException                  -> 503
DomainInvariantViolationException         -> 500
MandatoryAuditWriteException              -> 500 or 503
InvalidRuntimeConfigurationException      -> 500 or 503
Unknown Exception                         -> 500
```

### 8.1 409 vs 422

Banyak tim bingung antara `409 Conflict` dan `422 Unprocessable Content`.

Rule praktis:

```text
409 -> konflik dengan current state/resource/concurrency.
422 -> request syntactically valid tetapi semantically tidak dapat diproses karena aturan domain.
```

Namun di banyak enterprise system, semua business rule violation dipetakan ke `409` untuk menyederhanakan client behavior. Itu tidak selalu salah, asalkan konsisten.

Contoh:

```text
Application already approved      -> 409
Application missing mandatory doc -> 422 or 409 depending API policy
Version mismatch                  -> 409
Duplicate idempotency payload     -> 409
```

### 8.2 502 vs 503 vs 504

Praktis:

```text
502 Bad Gateway
-> dependency memberi response invalid/bad/unexpected

503 Service Unavailable
-> dependency/local service temporarily unavailable/saturated

504 Gateway Timeout
-> timeout menunggu dependency/upstream
```

Tetapi jika service bukan gateway formal, beberapa tim memilih `503` untuk semua dependency unavailable. Yang penting response body memiliki `code`, `retryable`, dan `dependency` internal di log.

---

## 9. Exception Translation by Layer

Exception taxonomy tidak akan bekerja jika setiap layer bebas melempar exception apa pun.

Gunakan prinsip:

```text
Lower-level exception may be caught and translated at boundary where semantic meaning is known.
```

---

## 9.1 Persistence Boundary

Persistence layer boleh menerima exception teknis dari JDBC/JPA/Spring Data.

Tapi application/domain service sebaiknya menerima exception yang lebih semantic.

Contoh:

```java
public void save(Application application) {
    try {
        jpaRepository.save(ApplicationEntity.fromDomain(application));
    } catch (ObjectOptimisticLockingFailureException e) {
        throw new StaleWriteException("Application", application.id().toString(), e);
    } catch (DuplicateKeyException e) {
        throw new DuplicateBusinessKeyException("Application", "applicationNumber", application.number(), e);
    } catch (DataAccessResourceFailureException e) {
        throw new PersistenceUnavailableException("ApplicationRepository", e);
    }
}
```

Catatan: Spring `DataAccessException` memang didesain sebagai hierarchy yang memungkinkan kode menangani jenis error data-access tanpa harus tahu API spesifik seperti JDBC. Ini bagus sebagai boundary teknis, tetapi sistem enterprise tetap perlu menerjemahkannya ke failure semantics yang lebih sesuai use case.

---

## 9.2 Integration Boundary

External client harus menerjemahkan HTTP/client exception ke exception internal.

Buruk:

```java
throw new RuntimeException("OneMap failed: " + response.body());
```

Lebih baik:

```java
public Address lookupPostalCode(String postalCode) {
    try {
        HttpResponse<OneMapResponse> response = client.lookup(postalCode);
        return mapper.toAddress(response.body());
    } catch (HttpTimeoutException e) {
        throw new ExternalDependencyTimeoutException("OneMap", e);
    } catch (RateLimitedResponseException e) {
        throw new ExternalDependencyRateLimitedException("OneMap", e);
    } catch (UnauthorizedResponseException e) {
        throw new ExternalDependencyAuthenticationException("OneMap", e);
    } catch (InvalidPayloadException e) {
        throw new ExternalPayloadContractViolationException("OneMap", "address lookup response", e);
    }
}
```

---

## 9.3 Domain Boundary

Domain object harus melempar domain exception, bukan HTTP exception.

Buruk:

```java
if (status != PENDING_REVIEW) {
    throw new ResponseStatusException(HttpStatus.CONFLICT, "Cannot approve");
}
```

Lebih baik:

```java
if (status != PENDING_REVIEW) {
    throw new ApplicationApprovalInvalidStateException(id, status);
}
```

API layer yang menentukan response.

---

## 10. Expected vs Unexpected Exceptions

Salah satu classification paling penting:

```text
Expected exception
-> bagian normal dari business/system operation.

Unexpected exception
-> sesuatu yang tidak seharusnya terjadi jika sistem sehat dan code benar.
```

### 10.1 Expected Exceptions

Contoh:

- validation failed;
- not found;
- forbidden;
- duplicate command;
- invalid state transition karena user action;
- optimistic lock conflict;
- dependency rate limited;
- service draining.

Expected bukan berarti “baik”. Expected berarti sistem didesain untuk menghadapinya.

Expected exception biasanya:

- tidak perlu stack trace di warning/error log untuk setiap kejadian;
- tidak perlu alert per event;
- perlu response yang jelas;
- perlu metric aggregated;
- bisa menjadi product/UX signal.

### 10.2 Unexpected Exceptions

Contoh:

- null pointer pada service;
- unknown enum dari database internal;
- invariant violation;
- impossible state;
- failed mandatory audit write;
- invalid runtime configuration;
- unhandled persistence failure;
- serialization failure pada event internal.

Unexpected exception biasanya:

- perlu stack trace;
- perlu error log;
- perlu alert jika berdampak;
- perlu correlation ID;
- perlu investigation;
- jangan expose detail ke client.

### 10.3 Logging Difference

Buruk:

```java
log.error("Failed", validationException);
```

Jika validation error normal, stack trace akan membuat log noise.

Lebih baik:

```java
log.info("Request validation failed: code={}, violationCount={}, correlationId={}",
        exception.errorCode(),
        exception.violations().size(),
        correlationId);
```

Untuk invariant:

```java
log.error("Domain invariant violated: code={}, aggregateId={}, correlationId={}",
        exception.errorCode(),
        applicationId,
        correlationId,
        exception);
```

---

## 11. Recoverable vs Retryable

Recoverable dan retryable sering disamakan, padahal berbeda.

```text
Recoverable
-> sistem bisa kembali sehat melalui suatu tindakan.

Retryable
-> operasi yang sama boleh dicoba ulang secara otomatis/semi-otomatis.
```

Contoh:

```text
Invalid request body
Recoverable: yes, user can fix input
Retryable as-is: no
```

```text
Database temporarily unavailable
Recoverable: yes, operator/system may recover
Retryable: yes with backoff, if operation idempotent
```

```text
Unknown enum persisted in DB
Recoverable: yes, data repair/deploy fix
Retryable: no until repaired
```

```text
Timeout after sending payment request
Recoverable: maybe
Retryable: only with idempotency key or status inquiry
```

Rule:

```text
Never mark retryable without considering side effects and idempotency.
```

---

## 12. Correctability: Siapa yang Bisa Memperbaiki?

Exception harus membantu routing tindakan.

Kategori corrector:

```text
CLIENT     -> client application must change request
USER       -> human user must change input/action/state
ADMIN      -> admin must change permission/config/business setup
OPERATOR   -> infrastructure/operator must fix runtime condition
DEVELOPER  -> code defect/design issue
PROVIDER   -> external dependency/provider must fix
SYSTEM     -> automatic recovery may work
NONE       -> cannot be corrected directly
```

Contoh:

| Exception | Corrector |
|---|---|
| `RequestValidationException` | CLIENT/USER |
| `ForbiddenActionException` | ADMIN/USER |
| `ApplicationIncompleteException` | USER |
| `PersistenceUnavailableException` | OPERATOR/SYSTEM |
| `ExternalPayloadContractViolationException` | PROVIDER/DEVELOPER |
| `DomainInvariantViolationException` | DEVELOPER/OPERATOR |
| `MandatoryAuditWriteException` | OPERATOR |
| `InvalidRuntimeConfigurationException` | OPERATOR |

Kenapa penting?

Karena response dan runbook bisa lebih tepat:

```json
{
  "code": "APPLICATION_VERSION_CONFLICT",
  "message": "The application has changed. Refresh and try again.",
  "corrector": "USER",
  "retryable": false
}
```

Untuk public API, `corrector` mungkin tidak perlu diekspos. Tetapi internal error model tetap bisa memilikinya.

---

## 13. State Impact: Apakah State Sudah Berubah?

Ini sering diabaikan.

Exception bukan hanya tentang operasi gagal. Pertanyaan yang lebih penting:

```text
Apakah state sudah berubah sebelum exception dilempar?
```

Kategori outcome:

```text
NO_CHANGE
PARTIAL_CHANGE
COMMITTED
UNKNOWN
COMPENSATED
```

Contoh:

```text
Validation failed before transaction
-> NO_CHANGE

DB constraint violation before commit
-> NO_CHANGE or rolled back

External POST timeout
-> UNKNOWN

Local DB commit succeeded, notification failed
-> COMMITTED_WITH_SECONDARY_FAILURE

Batch processed 7 of 10 items, then failed
-> PARTIAL_CHANGE
```

### 13.1 Exception Metadata untuk Outcome

Untuk operasi tertentu, pertimbangkan exception yang membawa outcome.

```java
public enum OperationOutcome {
    NO_CHANGE,
    PARTIAL_CHANGE,
    COMMITTED,
    UNKNOWN,
    COMPENSATED
}

public interface OutcomeAwareFailure {
    OperationOutcome outcome();
}
```

Contoh:

```java
public final class ExternalCommandUnknownOutcomeException
        extends ExternalDependencyException
        implements OutcomeAwareFailure {

    public ExternalCommandUnknownOutcomeException(String dependencyName, Throwable cause) {
        super(dependencyName, false, dependencyName + " command outcome is unknown", cause);
    }

    @Override
    public OperationOutcome outcome() {
        return OperationOutcome.UNKNOWN;
    }
}
```

Ini sangat penting untuk retry, compensation, dan incident response.

---

## 14. Exception Design in Workflow / State Machine Systems

Untuk sistem enforcement, licensing, case management, atau regulatory workflow, taxonomy harus state-aware.

### 14.1 State Transition Exceptions

Contoh hierarchy:

```text
WorkflowException
├── InvalidTransitionException
├── TransitionGuardFailedException
├── TransitionConflictException
├── TransitionAlreadyAppliedException
├── TransitionSideEffectFailedException
└── WorkflowInvariantViolationException
```

Contoh:

```java
public final class InvalidCaseTransitionException extends BusinessRuleViolationException {
    private final CaseStatus from;
    private final CaseStatus to;
    private final String transition;

    public InvalidCaseTransitionException(CaseStatus from, CaseStatus to, String transition) {
        super("CASE_INVALID_TRANSITION", "Case cannot transition from " + from + " to " + to);
        this.from = from;
        this.to = to;
        this.transition = transition;
    }
}
```

### 14.2 Guard Failure vs Invariant Violation

Guard failure:

```text
User tries to approve case but mandatory document missing.
Expected business rejection.
```

Invariant violation:

```text
Case is CLOSED but has no closure date.
Unexpected corrupted state.
```

Jangan samakan.

---

## 15. Exception Design for Batch Processing

Batch berbeda dari request/response biasa.

Failure bisa terjadi per item, per chunk, atau seluruh job.

Taxonomy batch:

```text
BatchJobConfigurationException
BatchInputValidationException
BatchItemValidationException
BatchItemProcessingException
BatchChunkCommitException
BatchPartialFailureException
BatchPoisonRecordException
BatchRetryExhaustedException
BatchCheckpointFailureException
```

Contoh:

```java
public final class BatchPartialFailureException extends ApplicationException {
    private final int totalItems;
    private final int succeededItems;
    private final int failedItems;

    public BatchPartialFailureException(int totalItems, int succeededItems, int failedItems) {
        super(
                "BATCH_PARTIAL_FAILURE",
                ErrorCategory.INFRASTRUCTURE,
                true,
                true,
                ErrorCorrector.SYSTEM,
                "Batch completed with partial failures"
        );
        this.totalItems = totalItems;
        this.succeededItems = succeededItems;
        this.failedItems = failedItems;
    }
}
```

Batch rule:

```text
Per-item expected failure should not necessarily fail the whole job.
Systemic failure should stop the job.
Poison record should be isolated.
Checkpoint failure is high severity.
```

---

## 16. Exception Design for Message Consumers

Message consumers punya failure semantics khusus.

Pertanyaan utama:

```text
Should this message be acked, retried, delayed, dead-lettered, parked, or poison-isolated?
```

Taxonomy:

```text
MessageValidationException      -> DLQ or discard depending source
MessageSchemaException          -> DLQ + alert
MessageDuplicateException       -> ack safely
MessageProcessingTransientException -> retry
MessageProcessingPermanentException -> DLQ
MessagePoisonException          -> DLQ/quarantine
MessageSideEffectUnknownException -> reconciliation needed
```

Contoh:

```java
public interface MessageFailurePolicyAware {
    MessageFailureAction failureAction();
}

public enum MessageFailureAction {
    ACK,
    RETRY,
    RETRY_LATER,
    DEAD_LETTER,
    QUARANTINE,
    STOP_CONSUMER
}
```

Exception:

```java
public final class PoisonMessageException extends ApplicationException implements MessageFailurePolicyAware {
    public PoisonMessageException(String messageType, Throwable cause) {
        super(
                "MESSAGE_POISON",
                ErrorCategory.INFRASTRUCTURE,
                false,
                true,
                ErrorCorrector.DEVELOPER,
                "Message cannot be processed safely: " + messageType,
                cause
        );
    }

    @Override
    public MessageFailureAction failureAction() {
        return MessageFailureAction.DEAD_LETTER;
    }
}
```

---

## 17. Anti-Patterns

### 17.1 Catch-All and Wrap-All

```java
try {
    service.process(command);
} catch (Exception e) {
    throw new RuntimeException("Failed to process", e);
}
```

Masalah:

- kehilangan category;
- kehilangan retryability;
- kehilangan corrector;
- semua jadi 500;
- expected exception menjadi unexpected;
- log/alert noisy.

---

### 17.2 Swallowing Exception

```java
try {
    auditService.write(event);
} catch (Exception ignored) {
}
```

Untuk audit wajib, ini fatal.

Kalau audit optional telemetry, masih perlu metric:

```java
catch (TelemetryWriteException e) {
    metrics.counter("telemetry.write.failed").increment();
    log.debug("Optional telemetry write failed", e);
}
```

---

### 17.3 Throwing Generic RuntimeException Everywhere

```java
throw new RuntimeException("Invalid status");
```

Masalah:

- invalid status karena user action?
- invalid status karena corrupted DB?
- invalid status karena unsupported enum dari provider?
- invalid status karena coding bug?

Tidak jelas.

---

### 17.4 Using HTTP Exception Inside Domain

```java
throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid transition");
```

Domain menjadi tergantung web layer.

---

### 17.5 Logging and Throwing at Every Layer

```java
catch (Exception e) {
    log.error("Repository failed", e);
    throw e;
}
```

Lalu service log lagi, controller log lagi. Satu failure menghasilkan 3-5 stack trace.

Rule:

```text
Log where you handle, enrich, suppress, or terminate.
Do not log merely because you caught and rethrew.
```

---

### 17.6 Treating All Business Failures as Exceptions Internally

Kadang expected domain outcome lebih cocok sebagai result object daripada exception.

Contoh:

```java
sealed interface ApprovalResult permits ApprovalAccepted, ApprovalRejected {}
```

Jika rejection adalah bagian normal decision flow yang sering terjadi, result object bisa lebih jelas.

Namun untuk command-style service, domain exception masih umum dipakai.

Rule:

```text
Use exception for abnormal interruption of requested operation.
Use result type for expected branching that caller is meant to inspect as normal flow.
```

---

## 18. When Not to Create a Custom Exception

Jangan membuat custom exception untuk semua hal.

Tidak perlu custom exception jika:

1. exception hanya dipakai sekali dan tidak ada special handling;
2. tidak membawa metadata tambahan;
3. tidak mengubah mapping response;
4. tidak mengubah retry/failure policy;
5. tidak membantu observability;
6. hanya mengganti nama `IllegalArgumentException` tanpa makna domain.

Contoh tidak perlu:

```java
public class NameIsNullException extends RuntimeException {}
```

Cukup:

```java
Objects.requireNonNull(name, "name must not be null");
```

Perlu custom exception jika:

1. error code berbeda;
2. response mapping berbeda;
3. retryability berbeda;
4. corrector berbeda;
5. severity berbeda;
6. membawa domain metadata;
7. sering ditangani di boundary;
8. penting untuk support/runbook.

---

## 19. Practical Implementation Pattern in Spring Boot

### 19.1 Exception Base

```java
public abstract class ApiMappableException extends RuntimeException {
    private final String code;
    private final ErrorCategory category;
    private final boolean retryable;

    protected ApiMappableException(String code, ErrorCategory category, boolean retryable, String message) {
        super(message);
        this.code = code;
        this.category = category;
        this.retryable = retryable;
    }

    protected ApiMappableException(String code, ErrorCategory category, boolean retryable, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.category = category;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public ErrorCategory category() {
        return category;
    }

    public boolean retryable() {
        return retryable;
    }
}
```

### 19.2 Problem Response

```java
public record ApiProblem(
        String type,
        String title,
        int status,
        String code,
        String message,
        boolean retryable,
        String correlationId,
        Map<String, Object> details
) {}
```

### 19.3 Exception Mapper

```java
@RestControllerAdvice
public final class ApiExceptionHandler {

    @ExceptionHandler(RequestValidationException.class)
    ResponseEntity<ApiProblem> handleValidation(RequestValidationException e, HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, e, Map.of("violations", e.violations()));
    }

    @ExceptionHandler(EntityNotFoundException.class)
    ResponseEntity<ApiProblem> handleNotFound(EntityNotFoundException e, HttpServletRequest request) {
        return problem(HttpStatus.NOT_FOUND, e, Map.of());
    }

    @ExceptionHandler(BusinessRuleViolationException.class)
    ResponseEntity<ApiProblem> handleBusinessRule(BusinessRuleViolationException e) {
        return problem(HttpStatus.CONFLICT, e, Map.of("ruleCode", e.ruleCode()));
    }

    @ExceptionHandler(StateConflictException.class)
    ResponseEntity<ApiProblem> handleConflict(StateConflictException e) {
        return problem(HttpStatus.CONFLICT, e, Map.of());
    }

    @ExceptionHandler(ServiceDrainingException.class)
    ResponseEntity<ApiProblem> handleDraining(ServiceDrainingException e) {
        return ResponseEntity
                .status(HttpStatus.SERVICE_UNAVAILABLE)
                .header(HttpHeaders.RETRY_AFTER, "5")
                .body(toProblem(HttpStatus.SERVICE_UNAVAILABLE, e, Map.of()));
    }

    @ExceptionHandler(DomainInvariantViolationException.class)
    ResponseEntity<ApiProblem> handleInvariant(DomainInvariantViolationException e) {
        log.error("Domain invariant violation: code={}", e.errorCode(), e);
        return genericInternalError();
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiProblem> handleUnknown(Exception e) {
        log.error("Unhandled exception", e);
        return genericInternalError();
    }

    private ResponseEntity<ApiProblem> problem(HttpStatus status, ApiMappableException e, Map<String, Object> details) {
        return ResponseEntity.status(status).body(toProblem(status, e, details));
    }
}
```

Catatan:

- expected exception tidak selalu perlu stack trace error log;
- unexpected exception harus log dengan stack trace;
- public response untuk 500 harus generic;
- correlation ID harus selalu ada.

---

## 20. Code Review Checklist

Gunakan checklist ini saat review PR.

### 20.1 Taxonomy

- Apakah exception yang dilempar punya kategori jelas?
- Apakah expected vs unexpected dibedakan?
- Apakah domain exception tidak tergantung HTTP/framework?
- Apakah technical exception diterjemahkan di boundary yang tepat?
- Apakah cause chain dipertahankan?

### 20.2 Retryability

- Apakah exception yang retryable benar-benar aman di-retry?
- Apakah idempotency dipertimbangkan?
- Apakah timeout dianggap unknown outcome jika side effect sudah melewati boundary?
- Apakah retry tidak dilakukan untuk validation/business rejection?

### 20.3 Response Contract

- Apakah error code stabil?
- Apakah response tidak bocor internal detail?
- Apakah field-level validation detail tersedia?
- Apakah conflict response actionable?
- Apakah `Retry-After` diberikan untuk saturation/draining/rate limit bila perlu?

### 20.4 Observability

- Apakah expected exception tidak menghasilkan log noise?
- Apakah unexpected exception menghasilkan stack trace dan correlation ID?
- Apakah metric category tersedia?
- Apakah error code bisa dipakai untuk dashboard/support?

### 20.5 Security/Compliance

- Apakah authentication/authorization error tidak membocorkan detail?
- Apakah audit failure tidak di-swallow?
- Apakah PII/token tidak masuk message exception?
- Apakah invariant breach tidak dikembalikan sebagai 400?

---

## 21. Design Exercise

Ambil use case:

```text
Officer approves an application.
```

Kemungkinan failure:

| Failure | Category | HTTP | Retryable | Corrector |
|---|---|---:|---:|---|
| Missing applicationId | Validation | 400 | No | Client |
| Application not found | Not Found | 404 | No | User/client |
| Officer not allowed | Authorization | 403 | No | Admin/user |
| Application already withdrawn | Business Rule / State | 409 | No | User/process |
| Version mismatch | State Conflict | 409 | After refresh | User/client |
| Duplicate approval request | Idempotency | 200/409 | Depends | Client |
| DB deadlock | Persistence transient | 503/409 | Yes bounded | System |
| DB unavailable | Persistence unavailable | 503 | Yes later | Operator/system |
| Notification timeout after approval | External dependency | 202/500/compensate depends design | Maybe | System/operator |
| Audit write failed | Compliance | 500 | Maybe | Operator |
| Approved state without approver | Invariant | 500 | No | Developer/operator |
| Service shutting down | Infrastructure | 503 | Yes later | System/client |

Pertanyaan desain:

1. Mana yang harus dicek sebelum transaksi?
2. Mana yang harus berada di domain aggregate?
3. Mana yang harus diterjemahkan dari persistence exception?
4. Mana yang boleh di-retry otomatis?
5. Mana yang harus alert?
6. Mana yang harus masuk audit trail?
7. Mana yang harus menghasilkan support-friendly error code?
8. Mana yang tidak boleh expose detail?

---

## 22. Practical Heuristics

### Heuristic 1 — Name the Failure by Decision, Not by Technology

Buruk:

```text
SQLException
HttpClientException
RuntimeException
```

Lebih baik:

```text
DuplicateApplicationNumberException
ExternalDependencyTimeoutException
MandatoryAuditWriteException
```

### Heuristic 2 — Expected Exception Should Be Actionable

Jika expected exception tidak memberi tahu user/client apa yang harus dilakukan, taxonomy-nya belum cukup baik.

### Heuristic 3 — Unexpected Exception Should Preserve Evidence

Jangan hilangkan cause, stack trace, correlation ID, entity ID, operation name.

### Heuristic 4 — Retryability Is a Dangerous Boolean

`retryable=true` harus didukung oleh:

- transient failure classification;
- idempotency;
- bounded attempts;
- backoff/jitter;
- no unsafe duplicate side effect.

### Heuristic 5 — Invariant Breach Is Never User Error

Jika sistem masuk impossible state, jangan salahkan user.

### Heuristic 6 — Exception Message Is Not API Contract

Message boleh berubah. Error code harus stabil.

### Heuristic 7 — Every Exception Category Should Map to Operational Behavior

Jika taxonomy tidak memengaruhi response, log, metric, retry, alert, atau recovery, mungkin taxonomy itu terlalu akademis.

---

## 23. Minimal Taxonomy untuk Project Nyata

Kalau ingin mulai sederhana, gunakan taxonomy minimal:

```text
ValidationException
AuthenticationException
AuthorizationException
NotFoundException
BusinessRuleViolationException
ConflictException
ExternalDependencyException
PersistenceException
InfrastructureException
InvariantViolationException
```

Kemudian tambahkan subclass hanya ketika ada kebutuhan.

Minimal metadata:

```text
code
message
category
retryable
cause
```

Untuk regulated/complex workflow system, tambahkan:

```text
operation
resourceType
resourceId
actorId internal only
outcome
corrector
severity
```

---

## 24. Summary

Exception taxonomy adalah fondasi reliability.

Tanpa taxonomy:

- semua error terlihat sama;
- retry menjadi berbahaya;
- API contract tidak stabil;
- operator sulit investigasi;
- user mendapat message yang tidak actionable;
- business error bercampur dengan incident;
- invariant breach disembunyikan;
- audit/compliance failure dianggap log biasa;
- sistem kehilangan evidence.

Dengan taxonomy yang baik:

- domain failure bisa dibedakan dari technical failure;
- expected bisa dibedakan dari unexpected;
- retryable bisa dibedakan dari non-retryable;
- client-correctable bisa dibedakan dari operator/developer-correctable;
- HTTP response menjadi konsisten;
- log dan metrics lebih meaningful;
- incident response lebih cepat;
- recovery strategy lebih aman;
- sistem lebih defensible.

Inti bagian ini:

```text
Exception bukan sekadar class.
Exception adalah structured failure signal.

Taxonomy yang baik membantu sistem menjawab:
- apa yang gagal,
- kenapa gagal,
- siapa yang bisa memperbaiki,
- apakah aman diulang,
- apakah state sudah berubah,
- apakah ini bug atau expected rejection,
- dan bagaimana sistem harus merespons.
```

---

## 25. Review Questions

1. Apa perbedaan validation error dan business rule violation?
2. Apa perbedaan business rule violation dan invariant violation?
3. Kenapa optimistic locking conflict tidak boleh diperlakukan sebagai generic 500?
4. Kenapa timeout sering berarti unknown outcome?
5. Apa bedanya recoverable dan retryable?
6. Kenapa domain exception tidak boleh bergantung pada HTTP status?
7. Kapan custom exception layak dibuat?
8. Apa risiko `catch (Exception e) { throw new RuntimeException(e); }`?
9. Kenapa audit failure berbeda dari telemetry/logging failure?
10. Bagaimana cara menentukan apakah sebuah error perlu alert?
11. Mengapa error code harus stabil?
12. Apa informasi minimal yang harus dibawa exception untuk production system?
13. Bagaimana taxonomy exception membantu graceful shutdown?
14. Bagaimana taxonomy exception membantu message consumer menentukan ack/retry/DLQ?
15. Mengapa invariant breach tidak boleh dikembalikan sebagai 400?

---

## 26. Production Checklist Ringkas

Sebelum menyebut sistem “production-ready”, pastikan:

- [ ] Ada taxonomy exception yang disepakati.
- [ ] Domain exception terpisah dari HTTP/framework exception.
- [ ] Technical exception diterjemahkan di boundary yang tepat.
- [ ] Expected vs unexpected exception dibedakan.
- [ ] Business rejection tidak menjadi 500.
- [ ] Invariant breach tidak menjadi 400.
- [ ] Retryable error benar-benar aman di-retry.
- [ ] Timeout dianggap unknown outcome bila side effect mungkin sudah terjadi.
- [ ] Error code stabil dan terdokumentasi.
- [ ] API error response konsisten.
- [ ] Sensitive detail tidak bocor ke client.
- [ ] Cause chain dipertahankan.
- [ ] Expected error tidak membuat log noise.
- [ ] Unexpected error punya stack trace dan correlation ID.
- [ ] Audit/compliance failure tidak di-swallow.
- [ ] Shutdown/draining rejection menghasilkan 503/retryable signal.
- [ ] Message consumer punya policy untuk retry/DLQ/ack.
- [ ] Exception taxonomy terhubung ke metrics/alert/runbook.

---

## 27. Posisi Bagian Ini dalam Seri

Kita sudah menyelesaikan:

```text
Part 000 — Series Orientation and Operating Model
Part 001 — Mental Model of Failure
Part 002 — Java Exception Semantics Deep Dive
Part 003 — Exception Taxonomy for Enterprise Systems
```

Seri belum selesai.

Bagian berikutnya:

```text
Part 004 — Error Handling Philosophy: Fail Fast, Fail Safe, Fail Closed, Fail Open
```

Di bagian berikutnya kita akan membahas cara memilih strategi failure. Setelah tahu jenis exception, pertanyaan berikutnya adalah:

```text
Haruskah sistem menghentikan operasi?
Haruskah reject?
Haruskah fallback?
Haruskah degrade?
Haruskah fail closed?
Haruskah fail open?
Haruskah retry?
Haruskah alert?
```

Itulah inti dari error handling philosophy.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 002 — Java Exception Semantics Deep Dive](./learn-java-reliability-part-002.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 004 — Error Handling Philosophy: Fail Fast, Fail Safe, Fail Closed, Fail Open](./learn-java-reliability-part-004.md)
