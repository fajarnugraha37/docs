# learn-java-reliability-part-006.md

# Part 006 — Exception Translation Layers

> Seri: **Graceful Shutdown, Error Handling, Exceptions, and Reliability**  
> Bagian: **006 / 030**  
> Status seri: **Belum selesai**  
> Fokus: merancang lapisan translasi exception agar failure dari framework, database, external dependency, messaging, dan domain dapat dipetakan menjadi semantics yang benar tanpa kehilangan cause, evidence, retryability, severity, dan operability.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas **API error contract**: bagaimana error keluar dari sistem sebagai kontrak yang stabil, aman, dan berguna untuk client maupun operator.

Bagian ini mundur satu lapisan ke dalam sistem: **bagaimana exception bergerak antar-layer sebelum akhirnya menjadi error response, retry decision, rollback decision, alert, audit entry, atau operational signal**.

Topik ini krusial karena banyak codebase Java enterprise memiliki masalah seperti ini:

```java
try {
    repository.save(entity);
} catch (Exception e) {
    throw new RuntimeException("Failed to save data");
}
```

atau:

```java
catch (SQLException e) {
    throw new BusinessException("Application failed");
}
```

atau:

```java
catch (HttpClientErrorException e) {
    throw new InternalServerErrorException(e.getMessage());
}
```

Sekilas terlihat “sudah di-handle”. Namun secara reliability, ini sering merusak sistem karena:

- root cause hilang;
- exception taxonomy menjadi kabur;
- retryability hilang;
- HTTP status salah;
- rollback behavior tidak jelas;
- client mendapat error yang misleading;
- operator tidak bisa triage;
- domain layer tercemar detail teknis;
- infrastructure exception bocor ke API;
- alert menjadi noise;
- recovery decision menjadi salah.

Target bagian ini:

> Kamu mampu mendesain **exception translation architecture**: mekanisme yang menerjemahkan failure dari satu boundary ke boundary lain tanpa menghancurkan makna kegagalannya.

---

## 1. Core Problem: Exception Tidak Sama Artinya di Semua Layer

Satu exception bisa memiliki arti yang berbeda tergantung layer.

Misalnya database melempar unique constraint violation:

```text
ORA-00001: unique constraint violated
```

Di persistence layer, ini adalah **database constraint exception**.

Di repository layer, ini bisa menjadi:

```text
DuplicateKeyException / DataIntegrityViolationException
```

Di domain/service layer, ini bisa berarti:

```text
ApplicationAlreadySubmittedException
DuplicateBusinessIdentifierException
IdempotencyConflictException
```

Di API layer, ini mungkin menjadi:

```http
409 Conflict
```

Dengan body:

```json
{
  "type": "https://errors.example.com/application/already-submitted",
  "title": "Application already submitted",
  "status": 409,
  "code": "APPLICATION_ALREADY_SUBMITTED",
  "correlationId": "7b4f..."
}
```

Artinya, translasi exception bukan sekadar mengganti class. Translasi adalah proses mengubah **representasi teknis** menjadi **makna yang sesuai dengan boundary berikutnya**.

### 1.1 Tanpa Translation Layer

Tanpa translation layer, sistem cenderung punya aliran seperti ini:

```text
Database SQLException
   ↓
JPA/Hibernate exception
   ↓
Service catch Exception
   ↓
RuntimeException("Failed")
   ↓
Controller catch RuntimeException
   ↓
500 Internal Server Error
```

Masalah:

- client mengira server error padahal mungkin conflict;
- retry bisa dilakukan padahal tidak akan pernah berhasil;
- support tidak tahu constraint apa yang gagal;
- domain behavior tidak eksplisit;
- incident dashboard penuh 500 palsu;
- root cause bisa hilang.

### 1.2 Dengan Translation Layer yang Benar

```text
Database unique constraint violation
   ↓
Persistence translator
   ↓
Duplicate key / data integrity violation
   ↓
Repository/service translator
   ↓
ApplicationAlreadySubmittedException
   ↓
API exception mapper
   ↓
409 Conflict + stable error code
```

Masalah yang sama sekarang memiliki makna yang benar:

- client tahu ini conflict;
- retry tanpa perubahan tidak berguna;
- operator bisa melihat domain code;
- root cause tetap tersimpan di cause chain;
- metrics bisa membedakan domain conflict vs platform failure.

---

## 2. Mental Model: Exception Translation sebagai Boundary Adapter

Bayangkan sistem sebagai rangkaian boundary:

```text
[Client]
   ↓ HTTP
[API Boundary]
   ↓ DTO / Command
[Application Service]
   ↓ Domain Operation
[Domain Model]
   ↓ Repository Port
[Persistence Adapter]
   ↓ JDBC/JPA/Driver
[Database]
```

Setiap boundary memiliki bahasa sendiri:

| Boundary | Bahasa Failure yang Cocok |
|---|---|
| Database | SQLState, vendor error code, constraint name, timeout, deadlock |
| Persistence adapter | data integrity, duplicate key, stale state, connection failure |
| Domain/application | business rule violation, conflict, invalid transition, invariant breach |
| API | HTTP status, problem type, error code, retryability, correlation ID |
| Operator | severity, component, dependency, runbook hint, impact |

Translation layer bertugas menjaga agar failure tidak bocor dengan bahasa yang salah.

### 2.1 Analogi

Exception translation mirip dengan anti-corruption layer.

Tanpa anti-corruption layer, domain kamu akan bicara bahasa database:

```java
if (e.getMessage().contains("ORA-00001")) {
    ...
}
```

Ini buruk karena domain menjadi tergantung pada vendor database.

Dengan translation:

```java
catch (DuplicateApplicationSubmissionException e) {
    ...
}
```

Domain bicara dalam bahasa domain.

### 2.2 Prinsip Utama

> Translate at boundaries, preserve causes, never erase semantics.

Artinya:

1. translasi dilakukan saat exception melewati boundary konseptual;
2. exception baru harus membawa cause exception lama;
3. informasi penting seperti retryability, error code, severity, dan correlation ID jangan hilang;
4. jangan menerjemahkan semua exception menjadi generic failure;
5. jangan membiarkan detail teknis bocor ke layer yang tidak perlu tahu.

---

## 3. Kenapa Exception Translation Layer Penting untuk Reliability

Exception translation bukan kosmetik arsitektur. Ia menentukan reliability behavior.

### 3.1 Menentukan Retry Decision

Contoh:

```text
SocketTimeoutException
SQLTransientConnectionException
DeadlockLoserDataAccessException
DuplicateKeyException
ConstraintViolationException
```

Tidak semua boleh di-retry.

| Failure | Retry? | Alasan |
|---|---:|---|
| Network timeout ke dependency | Kadang | transient, asal idempotent |
| DB deadlock | Kadang | bisa berhasil pada attempt berikutnya |
| Duplicate key | Tidak | kondisi deterministik kecuali input berubah |
| Validation error | Tidak | client harus memperbaiki input |
| Auth failure 401 karena expired token | Ya, dengan refresh | perlu token refresh, bukan blind retry |
| 403 forbidden | Tidak | privilege tidak cukup |
| 429 rate limited | Ya, setelah backoff/respect Retry-After | provider meminta throttle |

Jika translation salah, retry salah.

Retry salah bisa menyebabkan:

- duplicate side effect;
- retry storm;
- queue backlog;
- DB overload;
- external provider ban;
- data corruption.

### 3.2 Menentukan HTTP Status

Exception translation memengaruhi API response.

| Internal Semantics | HTTP Status Umum |
|---|---:|
| validation failure | 400 / 422 tergantung kontrak |
| auth missing/invalid | 401 |
| authenticated but not allowed | 403 |
| resource not found | 404 |
| state conflict / duplicate | 409 |
| precondition failed / ETag mismatch | 412 |
| rate limited | 429 |
| dependency failure | 502 / 503 / 504 |
| unexpected bug | 500 |

Kalau `DuplicateKeyException` menjadi `500`, client mungkin retry dan membuat beban makin besar.

Kalau dependency timeout menjadi `400`, client mengira request-nya salah.

Kalau authorization failure menjadi `404`, bisa benar untuk mencegah enumeration, tapi harus disengaja, bukan kebetulan.

### 3.3 Menentukan Rollback Behavior

Di Spring, rollback transaction secara default terjadi untuk unchecked exception dan `Error`; checked exception tidak otomatis menyebabkan rollback kecuali dikonfigurasi.

Implikasinya:

```java
@Transactional
public void submit(Command command) throws BusinessCheckedException {
    repository.save(...);
    throw new BusinessCheckedException("failed after save");
}
```

Jika tidak dikonfigurasi, checked exception dapat membuat transaksi commit. Ini bukan sekadar detail framework; ini reliability behavior.

Karena itu exception translation harus mempertimbangkan:

- apakah exception akan melewati boundary transaction;
- apakah exception harus trigger rollback;
- apakah exception adalah expected business rejection atau partial-failure;
- apakah exception terjadi sebelum atau setelah side effect.

### 3.4 Menentukan Observability

Kalau semua exception diterjemahkan menjadi:

```text
ApplicationException
```

maka metrics hanya punya satu kategori.

Padahal operator butuh membedakan:

```text
validation_error_rate
business_conflict_rate
db_deadlock_rate
db_connection_failure_rate
external_timeout_rate
idempotency_conflict_rate
unexpected_bug_rate
```

Translation layer yang baik membuat observability lebih tajam.

---

## 4. Layer-Layer Translasi Exception

Dalam aplikasi Java enterprise, minimal ada beberapa layer translasi.

```text
[Low-Level Technical Exception]
       ↓
[Infrastructure Translation]
       ↓
[Application/Domain Translation]
       ↓
[Interface/API Translation]
       ↓
[Client/Operator Contract]
```

Kita bahas satu per satu.

---

## 5. Persistence Exception Translation

Persistence adalah sumber exception yang sangat kaya tetapi sering vendor-specific.

Contoh sumber:

- JDBC driver;
- connection pool;
- JPA provider;
- Hibernate;
- database vendor;
- transaction manager;
- migration tool;
- ORM mapping.

### 5.1 Masalah Native Persistence Exception

Native exception biasanya membawa informasi seperti:

- SQLState;
- vendor code;
- constraint name;
- table name;
- column name;
- lock mode;
- timeout reason;
- connection failure;
- serialization failure.

Namun jika informasi ini langsung bocor ke service/API:

```java
catch (SQLException e) {
    if (e.getErrorCode() == 1) { // ORA-00001
        throw new DuplicateApplicationException(...);
    }
}
```

Maka service layer menjadi tahu detail Oracle.

Ini buruk untuk maintainability dan portability.

### 5.2 Spring DataAccessException

Spring menyediakan `DataAccessException` hierarchy sebagai abstraction untuk exception persistence. Mekanisme `PersistenceExceptionTranslator` menerjemahkan runtime exception dari persistence framework menjadi `DataAccessException` jika memungkinkan. `PersistenceExceptionTranslationPostProcessor` dapat menerapkan translasi ke bean repository yang sesuai.

Contoh hierarchy umum:

```text
DataAccessException
├── NonTransientDataAccessException
│   ├── DataIntegrityViolationException
│   ├── DuplicateKeyException
│   └── PermissionDeniedDataAccessException
├── TransientDataAccessException
│   ├── CannotAcquireLockException
│   ├── DeadlockLoserDataAccessException
│   └── QueryTimeoutException
└── RecoverableDataAccessException
```

Mental model:

- `TransientDataAccessException`: operasi mungkin berhasil jika diulang;
- `NonTransientDataAccessException`: retry tanpa perubahan biasanya tidak membantu;
- `RecoverableDataAccessException`: recovery step mungkin diperlukan;
- `DataIntegrityViolationException`: data/invariant/constraint bermasalah;
- `DuplicateKeyException`: unique constraint conflict.

Namun jangan berhenti di `DataAccessException`. Itu masih bahasa infrastructure. Untuk domain penting, translate lagi.

### 5.3 Translasi dari Persistence ke Domain

Contoh buruk:

```java
@Service
public class ApplicationService {
    public void submit(SubmitApplicationCommand command) {
        try {
            applicationRepository.save(...);
        } catch (DataIntegrityViolationException e) {
            throw e;
        }
    }
}
```

Masalah:

- API layer harus tahu `DataIntegrityViolationException`;
- tidak jelas constraint mana yang gagal;
- bisa salah mapping menjadi 500 atau 409;
- domain meaning hilang.

Contoh lebih baik:

```java
public final class ApplicationAlreadySubmittedException extends DomainConflictException {
    public ApplicationAlreadySubmittedException(String applicationNo, Throwable cause) {
        super(
            "APPLICATION_ALREADY_SUBMITTED",
            "Application has already been submitted: " + applicationNo,
            cause
        );
    }
}
```

```java
@Repository
public class JdbcApplicationRepository implements ApplicationRepository {

    public void insertSubmittedApplication(ApplicationRecord record) {
        try {
            jdbcTemplate.update("""
                insert into application_submission(application_no, applicant_id, submitted_at)
                values (?, ?, ?)
                """,
                record.applicationNo(),
                record.applicantId(),
                record.submittedAt()
            );
        } catch (DuplicateKeyException e) {
            throw new ApplicationAlreadySubmittedException(record.applicationNo(), e);
        }
    }
}
```

Di sini repository adapter menerjemahkan duplicate key menjadi domain conflict yang spesifik.

### 5.4 Constraint Name Based Translation

Dalam sistem enterprise, `DataIntegrityViolationException` terlalu umum. Unique constraint untuk application number berbeda makna dengan foreign key untuk missing parent.

Contoh:

```text
UK_APPLICATION_SUBMISSION__APPLICATION_NO
FK_APPLICATION_SUBMISSION__APPLICANT_ID
CK_APPLICATION_SUBMISSION__STATUS
```

Kita bisa menggunakan constraint name sebagai input translation.

```java
final class ConstraintViolationTranslator {

    DomainException translate(DataIntegrityViolationException ex, ApplicationRecord record) {
        String constraint = ConstraintNameExtractor.extract(ex);

        return switch (constraint) {
            case "UK_APPLICATION_SUBMISSION__APPLICATION_NO" ->
                new ApplicationAlreadySubmittedException(record.applicationNo(), ex);
            case "FK_APPLICATION_SUBMISSION__APPLICANT_ID" ->
                new ApplicantReferenceInvalidException(record.applicantId(), ex);
            case "CK_APPLICATION_SUBMISSION__STATUS" ->
                new InvalidApplicationStatusPersistedException(record.status(), ex);
            default ->
                new PersistenceInvariantException("DATA_INTEGRITY_VIOLATION", ex);
        };
    }
}
```

Catatan penting:

- constraint name harus stabil dan sengaja didesain;
- jangan parse message database secara rapuh kalau ada API/vendor method yang lebih kuat;
- jika harus parse message, bungkus di satu adapter, jangan disebar;
- default case harus tetap preserve cause dan diobservasi.

### 5.5 Anti-Pattern: Translasi Terlalu Cepat

Jangan semua `DataIntegrityViolationException` langsung menjadi `BadRequestException`.

Kenapa?

Karena data integrity violation bisa berarti:

- client mengirim referensi invalid;
- concurrent request membuat duplicate;
- bug aplikasi melewati validation;
- database constraint lebih strict dari domain model;
- migration salah;
- data corruption;
- race condition.

Mapping ke 400 hanya benar jika kegagalan memang client-correctable.

---

## 6. External Dependency Exception Translation

External dependency meliputi:

- REST API;
- SOAP API;
- gRPC service;
- message broker;
- identity provider;
- object storage;
- geocoding/address service;
- payment provider;
- internal microservice;
- third-party regulatory provider.

### 6.1 Jangan Bocorkan Client Library Exception

Contoh buruk:

```java
public UserProfile getProfile(String nric) {
    try {
        return myInfoClient.fetch(nric);
    } catch (WebClientResponseException e) {
        throw e;
    }
}
```

Service layer menjadi tergantung pada Spring WebClient.

Contoh lebih baik:

```java
public sealed class IdentityProviderException extends RuntimeException
        permits IdentityProviderUnavailableException,
                IdentityProviderUnauthorizedException,
                IdentityProviderRateLimitedException,
                IdentityProviderInvalidResponseException {

    private final String provider;
    private final boolean retryable;

    protected IdentityProviderException(
            String message,
            String provider,
            boolean retryable,
            Throwable cause
    ) {
        super(message, cause);
        this.provider = provider;
        this.retryable = retryable;
    }

    public String provider() {
        return provider;
    }

    public boolean retryable() {
        return retryable;
    }
}
```

```java
final class MyInfoExceptionTranslator {

    IdentityProviderException translate(Throwable ex) {
        if (ex instanceof WebClientResponseException.TooManyRequests e) {
            return new IdentityProviderRateLimitedException("MYINFO", retryAfter(e), e);
        }

        if (ex instanceof WebClientResponseException.Unauthorized e) {
            return new IdentityProviderUnauthorizedException("MYINFO", e);
        }

        if (ex instanceof WebClientResponseException.ServiceUnavailable e) {
            return new IdentityProviderUnavailableException("MYINFO", true, e);
        }

        if (ex instanceof WebClientRequestException e) {
            return new IdentityProviderUnavailableException("MYINFO", true, e);
        }

        if (ex instanceof JsonProcessingException e) {
            return new IdentityProviderInvalidResponseException("MYINFO", false, e);
        }

        return new IdentityProviderUnavailableException("MYINFO", false, ex);
    }
}
```

### 6.2 Dependency Error Classification

External dependency errors harus diklasifikasikan minimal berdasarkan:

| Category | Contoh | Retry? | API Mapping Internal Service |
|---|---|---:|---|
| authentication/token expired | 401 from provider | ya, setelah refresh token | biasanya 502/503 jika gagal recovery |
| authorization denied | 403 | tidak | 502/403 tergantung boundary |
| rate limited | 429 | ya, backoff | 503/429 tergantung public contract |
| provider validation error | 400 | tidak | 502 jika input internal seharusnya valid |
| provider not found | 404 | tergantung domain | 404/502 tergantung semantics |
| provider timeout | timeout | ya, idempotent only | 504 |
| provider 5xx | 500/502/503 | ya, bounded | 502/503 |
| schema drift | invalid JSON/unknown enum | tidak blind retry | 502 + alert |
| TLS/DNS failure | connect failure | ya, bounded | 503 |

### 6.3 Important Distinction: Provider 400 Bukan Selalu Client 400

Misalnya API internal menerima request valid:

```json
{
  "postalCode": "123456"
}
```

Lalu dependency address provider mengembalikan 400 karena kontrak provider berubah.

Jangan otomatis mapping ke 400 untuk client kamu. Itu bisa menjadi:

```text
ExternalProviderContractException -> 502 Bad Gateway
```

Karena dari perspektif client kamu, input bisa valid. Yang gagal adalah adapter antara sistem kamu dan provider.

### 6.4 Token Refresh Exception Translation

Contoh flow:

```text
Call provider
  ↓ 401
Refresh token
  ↓ success
Retry original call once
  ↓ success/fail
```

Jika refresh gagal:

```text
ProviderUnauthorizedException
  ↓
ProviderAuthenticationRecoveryFailedException
  ↓
503 Service Unavailable / 502 Bad Gateway
```

Jangan return 401 ke client kamu kecuali client kamu memang salah authentication terhadap sistem kamu.

401 dari provider adalah internal dependency failure, bukan selalu 401 untuk caller kamu.

---

## 7. Messaging Exception Translation

Message-driven system punya failure semantics berbeda dari HTTP.

Dalam HTTP, exception biasanya menghasilkan response.

Dalam message consumer, exception memengaruhi:

- ack;
- nack;
- requeue;
- dead letter;
- retry topic;
- poison message handling;
- offset commit;
- checkpoint;
- consumer shutdown;
- duplicate delivery.

### 7.1 Translation untuk Consumer

Contoh message handler:

```java
public void handle(Message message) {
    try {
        commandHandler.handle(toCommand(message));
        ack(message);
    } catch (DomainValidationException e) {
        deadLetter(message, e);
    } catch (TransientDependencyException e) {
        requeueWithBackoff(message, e);
    } catch (InvariantViolationException e) {
        quarantine(message, e);
        alert(e);
    } catch (Exception e) {
        retryOrDeadLetter(message, e);
    }
}
```

Yang penting: exception diterjemahkan menjadi **message disposition decision**.

### 7.2 Failure Semantics untuk Messaging

| Exception Semantics | Message Action |
|---|---|
| invalid payload schema | dead-letter / reject no requeue |
| unknown enum but compatible future value | quarantine / compatibility path |
| transient dependency down | retry with backoff / requeue |
| duplicate message | ack as already processed |
| optimistic lock conflict | retry bounded |
| poison message | dead-letter after attempts |
| invariant breach | quarantine + alert |
| shutdown cancellation | do not ack until safe |

### 7.3 Anti-Pattern: Catch Exception lalu Ack

```java
try {
    process(message);
} catch (Exception e) {
    log.error("failed", e);
}
ack(message);
```

Ini sangat berbahaya.

Efeknya:

- message hilang;
- side effect mungkin belum terjadi;
- tidak ada retry;
- tidak ada DLQ;
- operator melihat log error tetapi data sudah lost;
- reconciliation menjadi sulit.

### 7.4 Anti-Pattern: Semua Exception Requeue

```java
catch (Exception e) {
    nack(message, true);
}
```

Jika error adalah invalid payload permanen, ini membuat poison message loop.

Akibat:

- consumer sibuk memproses message yang sama;
- throughput turun;
- queue backlog naik;
- alert menjadi noisy;
- message valid tertahan di belakang poison message.

---

## 8. Domain Exception Translation

Domain exception adalah exception yang merepresentasikan aturan bisnis, state machine, invariant, dan command semantics.

Contoh:

```java
public abstract class DomainException extends RuntimeException {
    private final String code;
    private final DomainFailureCategory category;

    protected DomainException(String code, DomainFailureCategory category, String message) {
        super(message);
        this.code = code;
        this.category = category;
    }

    protected DomainException(String code, DomainFailureCategory category, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.category = category;
    }

    public String code() {
        return code;
    }

    public DomainFailureCategory category() {
        return category;
    }
}
```

```java
public enum DomainFailureCategory {
    VALIDATION,
    NOT_FOUND,
    CONFLICT,
    INVALID_STATE_TRANSITION,
    INVARIANT_BREACH,
    AUTHORIZATION,
    BUSINESS_RULE_REJECTION
}
```

### 8.1 Domain Exception Jangan Tahu HTTP

Buruk:

```java
public class ApplicationAlreadySubmittedException extends RuntimeException {
    private final int httpStatus = 409;
}
```

Domain tidak perlu tahu HTTP.

Lebih baik:

```java
public class ApplicationAlreadySubmittedException extends DomainException {
    public ApplicationAlreadySubmittedException(String applicationNo) {
        super(
            "APPLICATION_ALREADY_SUBMITTED",
            DomainFailureCategory.CONFLICT,
            "Application already submitted: " + applicationNo
        );
    }
}
```

Mapping ke HTTP dilakukan di API layer.

### 8.2 Domain Exception Tidak Harus Selalu Error Teknis

Beberapa domain exception adalah expected rejection.

Contoh:

```text
ApplicationCannotBeWithdrawnAfterApprovalException
AppealSubmissionWindowClosedException
DuplicateRenewalRequestException
CaseAlreadyAssignedException
```

Ini bukan bug. Ini adalah domain outcome negatif.

Implikasi:

- tidak selalu perlu error-level log;
- tidak selalu perlu alert;
- biasanya 4xx;
- harus punya stable code;
- bisa menjadi audit event;
- harus diuji dalam business scenario.

### 8.3 Invariant Breach Berbeda dari Business Rejection

Business rejection:

```text
User tries to submit application after deadline.
```

Invariant breach:

```text
Approved application has no approval date.
```

Business rejection dapat menjadi 409/422.

Invariant breach biasanya bug/data corruption dan harus menjadi 500/internal alert, meskipun akar masalahnya data.

```java
public final class ApplicationInvariantViolationException extends DomainException {
    public ApplicationInvariantViolationException(String code, String message) {
        super(code, DomainFailureCategory.INVARIANT_BREACH, message);
    }
}
```

---

## 9. API Exception Translation

API layer menerjemahkan internal exception menjadi public error contract.

Di Spring MVC, ini biasanya memakai:

- `@RestControllerAdvice`;
- `@ExceptionHandler`;
- `ProblemDetail`;
- `ResponseEntityExceptionHandler`;
- `ErrorResponse`.

Di JAX-RS/Jakarta REST, ini biasanya memakai:

- `ExceptionMapper<T>`;
- `@Provider`;
- `Response`.

### 9.1 Spring Example

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(DomainException.class)
    ResponseEntity<ProblemDetail> handleDomainException(
            DomainException ex,
            HttpServletRequest request
    ) {
        HttpStatus status = switch (ex.category()) {
            case VALIDATION -> HttpStatus.BAD_REQUEST;
            case NOT_FOUND -> HttpStatus.NOT_FOUND;
            case CONFLICT, INVALID_STATE_TRANSITION -> HttpStatus.CONFLICT;
            case AUTHORIZATION -> HttpStatus.FORBIDDEN;
            case BUSINESS_RULE_REJECTION -> HttpStatus.UNPROCESSABLE_ENTITY;
            case INVARIANT_BREACH -> HttpStatus.INTERNAL_SERVER_ERROR;
        };

        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, safeDetail(ex));
        problem.setTitle(titleFor(ex));
        problem.setType(URI.create("https://errors.example.com/" + ex.code().toLowerCase(Locale.ROOT)));
        problem.setProperty("code", ex.code());
        problem.setProperty("correlationId", correlationId());
        problem.setProperty("path", request.getRequestURI());

        return ResponseEntity.status(status).body(problem);
    }
}
```

Catatan:

- API handler tidak perlu tahu `SQLException` jika lower layer sudah translate;
- invariant breach bisa sengaja dibuat 500;
- detail harus safe untuk client;
- full cause masuk log, bukan response;
- code harus stabil.

### 9.2 JAX-RS Example

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {

    @Override
    public Response toResponse(DomainException ex) {
        int status = switch (ex.category()) {
            case VALIDATION -> 400;
            case NOT_FOUND -> 404;
            case CONFLICT, INVALID_STATE_TRANSITION -> 409;
            case AUTHORIZATION -> 403;
            case BUSINESS_RULE_REJECTION -> 422;
            case INVARIANT_BREACH -> 500;
        };

        ApiError body = ApiError.builder()
            .code(ex.code())
            .title(titleFor(ex))
            .detail(safeDetail(ex))
            .correlationId(Correlation.currentId())
            .build();

        return Response.status(status)
            .type(MediaType.APPLICATION_JSON_TYPE)
            .entity(body)
            .build();
    }
}
```

### 9.3 Handler Ordering

Jangan punya generic handler yang menelan semua sebelum handler spesifik.

Buruk:

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<?> handle(Exception e) { ... }

@ExceptionHandler(DomainException.class)
public ResponseEntity<?> handle(DomainException e) { ... }
```

Di framework tertentu ordering bisa masih benar berdasarkan specificity, tetapi mental model yang aman:

1. handler spesifik;
2. handler kategori;
3. handler framework;
4. handler fallback.

Contoh urutan konseptual:

```text
ValidationException
DomainException
ExternalDependencyException
DataAccessException fallback
AccessDeniedException
AuthenticationException
Exception fallback
```

---

## 10. Exception Translation vs Exception Wrapping

Translation dan wrapping sering terlihat mirip, tapi beda tujuan.

### 10.1 Wrapping

Wrapping biasanya hanya membungkus exception agar sesuai signature/hierarchy.

```java
throw new RuntimeException("Failed to process", e);
```

Ini preserve cause tetapi tidak menambah semantic meaning.

### 10.2 Translation

Translation mengubah exception menjadi makna layer baru.

```java
throw new PaymentProviderTimeoutException("Payment provider timeout", provider, retryable, e);
```

Ini menambah:

- dependency name;
- failure category;
- retryability;
- domain/integration meaning;
- expected response/behavior.

### 10.3 Rule

> Semua translation adalah wrapping, tetapi tidak semua wrapping adalah translation.

Wrapping tanpa semantics sering hanya memindahkan kebingungan ke layer berikutnya.

---

## 11. Preserve Cause Chain

Salah satu dosa terbesar error handling adalah menghilangkan cause.

Buruk:

```java
catch (SQLException e) {
    throw new ApplicationException("Cannot save application");
}
```

Lebih baik:

```java
catch (SQLException e) {
    throw new ApplicationPersistenceException("Cannot save application", e);
}
```

Kenapa cause penting?

- stack trace asli tetap ada;
- vendor code masih bisa dilihat;
- root cause analysis lebih cepat;
- logging bisa mencetak full chain;
- testing bisa assert root cause jika perlu;
- observability tool bisa group exception lebih akurat.

### 11.1 Tapi Jangan Bocorkan Cause ke Client

Preserve cause internal bukan berarti expose cause ke API response.

```text
Internal exception chain:
ApplicationAlreadySubmittedException
  caused by DuplicateKeyException
    caused by SQLIntegrityConstraintViolationException
      ORA-00001
```

Client cukup melihat:

```json
{
  "code": "APPLICATION_ALREADY_SUBMITTED",
  "status": 409,
  "correlationId": "..."
}
```

Operator bisa melihat full chain di log/traces.

---

## 12. Preserve Retryability

Retryability sering hilang saat exception diterjemahkan.

Buruk:

```java
catch (SocketTimeoutException e) {
    throw new ExternalServiceException("failed", e);
}
```

Lebih baik:

```java
throw new ExternalServiceTimeoutException(
    "ONEMAP",
    Retryability.RETRYABLE_IF_IDEMPOTENT,
    e
);
```

Model sederhana:

```java
public enum Retryability {
    NON_RETRYABLE,
    RETRYABLE,
    RETRYABLE_IF_IDEMPOTENT,
    RETRY_AFTER,
    RECOVERABLE_AFTER_TOKEN_REFRESH,
    UNKNOWN
}
```

Exception base:

```java
public interface ClassifiedFailure {
    String code();
    FailureCategory category();
    Retryability retryability();
}
```

Keuntungan:

- retry policy bisa berbasis semantics;
- API bisa menyertakan `retryable` jika memang bagian kontrak;
- logs/metrics bisa dikategorikan;
- message consumer bisa memutuskan requeue/DLQ;
- incident triage lebih cepat.

---

## 13. Preserve Severity dan Alertability

Tidak semua exception harus alert.

| Exception | Log Level | Alert? |
|---|---|---:|
| validation error | debug/info aggregated | tidak |
| domain conflict normal | info/none | tidak |
| auth failure expected | warn if spike | tidak per event |
| dependency timeout | warn/error | ya jika rate/SLO breach |
| invariant breach | error | ya |
| data corruption | error | ya |
| repeated retry exhausted | error | ya |
| poison message | error | ya jika DLQ rate naik |

Translation layer bisa membawa field:

```java
public enum Alertability {
    NEVER_PER_EVENT,
    RATE_BASED,
    IMMEDIATE,
    SECURITY_MONITORED
}
```

Ini tidak selalu perlu di-code sebagai enum di semua sistem, tapi mental model-nya penting.

---

## 14. Translasi Exception dan Transaction Boundary

Exception yang melewati transaction boundary menentukan rollback/commit behavior.

### 14.1 Spring Default Rollback Behavior

Secara umum, Spring transaction rollback default untuk `RuntimeException` dan `Error`. Checked exception tidak otomatis rollback kecuali aturan rollback dikonfigurasi.

Artinya, desain exception hierarchy punya efek langsung pada data consistency.

### 14.2 Business Exception: Rollback atau Tidak?

Tidak semua business exception sama.

Contoh 1: validation gagal sebelum write.

```java
@Transactional
public void submit(Command command) {
    validate(command); // throws ValidationException
    repository.save(...);
}
```

Rollback tidak relevan karena belum ada write.

Contoh 2: business rule gagal setelah intermediate mutation.

```java
@Transactional
public void approve(Command command) {
    Application app = repository.get(command.id());
    app.markReviewed();

    if (!app.canApprove()) {
        throw new CannotApproveApplicationException(app.id());
    }

    app.approve();
}
```

Jika exception unchecked, rollback terjadi. Jika checked tanpa rollback rule, `markReviewed()` bisa commit. Itu mungkin salah.

### 14.3 Rule Praktis

Untuk service transactional:

1. validation dan guard dilakukan sebelum mutation jika bisa;
2. business rejection yang terjadi setelah mutation harus rollback kecuali mutation memang intentional;
3. exception hierarchy harus sesuai rollback semantics;
4. jangan ubah checked/unchecked tanpa memikirkan transaction;
5. integration side effect jangan dilakukan di tengah transaction tanpa outbox/compensation.

---

## 15. Translation Placement: Di Mana Exception Harus Diterjemahkan?

Pertanyaan penting: translate di repository, service, adapter, atau controller?

Jawaban: tergantung boundary.

### 15.1 Repository Adapter

Cocok untuk:

- SQL/JPA/vendor exception ke persistence/domain-specific exception;
- constraint-specific translation;
- optimistic locking;
- duplicate key;
- stale state;
- missing row pada update.

Contoh:

```text
DuplicateKeyException -> ApplicationAlreadySubmittedException
OptimisticLockingFailureException -> ApplicationVersionConflictException
EmptyResultDataAccessException -> ApplicationNotFoundException
```

### 15.2 External Client Adapter

Cocok untuk:

- HTTP client exception ke provider exception;
- provider 401/429/5xx;
- parsing/contract drift;
- dependency timeout;
- token refresh failure.

Contoh:

```text
WebClientResponseException.TooManyRequests -> AddressProviderRateLimitedException
JsonMappingException -> AddressProviderInvalidResponseException
SocketTimeoutException -> AddressProviderTimeoutException
```

### 15.3 Application Service

Cocok untuk:

- menggabungkan beberapa low-level/domain signal menjadi use-case outcome;
- menentukan business meaning yang perlu context lebih luas;
- mengubah technical conflict menjadi command conflict;
- exception yang bergantung pada current state.

Contoh:

```text
ApplicationAlreadySubmittedException + idempotency key match -> return existing result
ApplicationAlreadySubmittedException + different payload -> IdempotencyConflictException
```

### 15.4 API Layer

Cocok untuk:

- internal exception ke HTTP status;
- internal code ke public code;
- safe message;
- correlation ID;
- content negotiation;
- RFC 9457/ProblemDetail;
- security redaction.

### 15.5 Jangan Translate Terlalu Banyak di Controller

Jika controller tahu semua exception teknis, layer menjadi bocor.

Buruk:

```java
@ExceptionHandler({SQLException.class, ConstraintViolationException.class, WebClientException.class})
```

Controller/advice boleh punya fallback untuk framework exception, tapi domain dan infrastructure adapter seharusnya sudah melakukan translation sebelumnya.

---

## 16. Designing an Exception Translation Matrix

Sebelum coding, buat matrix.

Contoh untuk persistence:

| Source Exception | Condition | Internal Exception | Category | Retryability | API Status | Log/Alert |
|---|---|---|---|---|---:|---|
| DuplicateKeyException | UK_APPLICATION_NO | ApplicationAlreadySubmittedException | conflict | no | 409 | no alert |
| DuplicateKeyException | UK_IDEMPOTENCY_KEY same hash | IdempotentReplayException | replay | no | 200/201 replay | no alert |
| DuplicateKeyException | UK_IDEMPOTENCY_KEY different hash | IdempotencyConflictException | conflict | no | 409 | no alert |
| DataIntegrityViolationException | unknown constraint | PersistenceInvariantException | invariant | no | 500 | alert |
| DeadlockLoserDataAccessException | any | TransientPersistenceException | transient | yes bounded | 503/500 after exhausted | rate alert |
| QueryTimeoutException | read query | PersistenceTimeoutException | timeout | maybe | 503/504 | rate alert |
| CannotGetJdbcConnectionException | any | DatabaseUnavailableException | dependency | yes bounded | 503 | alert |

Contoh untuk external API:

| Source | Condition | Internal Exception | Retryability | API Status |
|---|---|---|---|---:|
| 401 | token expired, refresh success | no final exception | retry once | original result |
| 401 | refresh failed | ProviderAuthRecoveryFailedException | no until config fixed | 503/502 |
| 403 | provider access denied | ProviderForbiddenException | no | 502/503 |
| 429 | Retry-After exists | ProviderRateLimitedException | retry-after | 503/429 |
| 5xx | provider error | ProviderUnavailableException | yes bounded | 502/503 |
| timeout | read timeout | ProviderTimeoutException | if idempotent | 504 |
| invalid JSON | schema drift | ProviderContractViolationException | no | 502 |

Matrix seperti ini membuat exception translation bisa direview secara arsitektural.

---

## 17. Code Pattern: Base Failure Model

Untuk sistem enterprise besar, exception bisa membawa metadata terbatas.

```java
public enum FailureCategory {
    VALIDATION,
    AUTHENTICATION,
    AUTHORIZATION,
    NOT_FOUND,
    CONFLICT,
    INVALID_STATE,
    INVARIANT_BREACH,
    DEPENDENCY_UNAVAILABLE,
    DEPENDENCY_TIMEOUT,
    RATE_LIMITED,
    DATA_INTEGRITY,
    TRANSIENT_INFRASTRUCTURE,
    INTERNAL_BUG
}
```

```java
public enum FailureOrigin {
    CLIENT_INPUT,
    DOMAIN_RULE,
    APPLICATION_STATE,
    DATABASE,
    EXTERNAL_DEPENDENCY,
    MESSAGE_BROKER,
    INFRASTRUCTURE,
    FRAMEWORK,
    UNKNOWN
}
```

```java
public enum RecoveryHint {
    DO_NOT_RETRY,
    RETRY_WITH_BACKOFF,
    RETRY_AFTER,
    REFRESH_TOKEN_THEN_RETRY_ONCE,
    SAFE_TO_REPLAY_IF_IDEMPOTENT,
    MANUAL_RECONCILIATION_REQUIRED,
    FIX_CONFIGURATION,
    ESCALATE_TO_ENGINEERING
}
```

```java
public abstract class ApplicationFailureException extends RuntimeException {

    private final String code;
    private final FailureCategory category;
    private final FailureOrigin origin;
    private final RecoveryHint recoveryHint;

    protected ApplicationFailureException(
            String code,
            FailureCategory category,
            FailureOrigin origin,
            RecoveryHint recoveryHint,
            String message,
            Throwable cause
    ) {
        super(message, cause);
        this.code = Objects.requireNonNull(code);
        this.category = Objects.requireNonNull(category);
        this.origin = Objects.requireNonNull(origin);
        this.recoveryHint = Objects.requireNonNull(recoveryHint);
    }

    public String code() {
        return code;
    }

    public FailureCategory category() {
        return category;
    }

    public FailureOrigin origin() {
        return origin;
    }

    public RecoveryHint recoveryHint() {
        return recoveryHint;
    }
}
```

Catatan desain:

- jangan terlalu banyak metadata jika tim belum siap;
- metadata harus benar-benar dipakai untuk mapping/logging/metrics;
- jangan masukkan PII;
- jangan masukkan raw SQL atau token;
- jangan menjadikan exception sebagai dumping ground.

---

## 18. Code Pattern: Persistence Translator

```java
@Component
public class ApplicationPersistenceExceptionTranslator {

    public RuntimeException translateSaveFailure(
            DataAccessException ex,
            ApplicationRecord record
    ) {
        if (ex instanceof DuplicateKeyException) {
            String constraint = ConstraintNameExtractor.extract(ex);

            if ("UK_APPLICATION__APPLICATION_NO".equals(constraint)) {
                return new ApplicationAlreadyExistsException(record.applicationNo(), ex);
            }

            if ("UK_APPLICATION__IDEMPOTENCY_KEY".equals(constraint)) {
                return new DuplicateIdempotencyKeyException(record.idempotencyKey(), ex);
            }
        }

        if (isDeadlock(ex)) {
            return new DatabaseTransientFailureException(
                "DATABASE_DEADLOCK",
                RecoveryHint.RETRY_WITH_BACKOFF,
                ex
            );
        }

        if (isConnectionFailure(ex)) {
            return new DatabaseUnavailableException(ex);
        }

        if (ex instanceof DataIntegrityViolationException) {
            return new PersistenceInvariantException(
                "UNKNOWN_DATA_INTEGRITY_VIOLATION",
                ex
            );
        }

        return new PersistenceFailureException("PERSISTENCE_FAILURE", ex);
    }
}
```

Repository usage:

```java
@Repository
public class JdbcApplicationRepository implements ApplicationRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ApplicationPersistenceExceptionTranslator exceptionTranslator;

    public void save(ApplicationRecord record) {
        try {
            jdbcTemplate.update(SQL_INSERT, toParams(record));
        } catch (DataAccessException ex) {
            throw exceptionTranslator.translateSaveFailure(ex, record);
        }
    }
}
```

Kenapa translator dipisah?

- logic mapping bisa dites unit;
- repository tidak penuh if-else;
- constraint mapping terpusat;
- migration database lebih mudah;
- observability bisa konsisten.

---

## 19. Code Pattern: External Client Translator

```java
@Component
public class AddressProviderExceptionTranslator {

    AddressProviderException translate(Throwable throwable) {
        if (throwable instanceof WebClientResponseException response) {
            return translateResponseException(response);
        }

        if (throwable instanceof WebClientRequestException requestException) {
            return new AddressProviderUnavailableException(
                "ADDRESS_PROVIDER_UNREACHABLE",
                RecoveryHint.RETRY_WITH_BACKOFF,
                requestException
            );
        }

        if (throwable instanceof DecodingException decodingException) {
            return new AddressProviderContractViolationException(
                "ADDRESS_PROVIDER_INVALID_RESPONSE",
                decodingException
            );
        }

        return new AddressProviderException(
            "ADDRESS_PROVIDER_UNKNOWN_FAILURE",
            FailureCategory.DEPENDENCY_UNAVAILABLE,
            RecoveryHint.ESCALATE_TO_ENGINEERING,
            throwable
        );
    }

    private AddressProviderException translateResponseException(WebClientResponseException ex) {
        HttpStatusCode status = ex.getStatusCode();

        if (status.value() == 401) {
            return new AddressProviderAuthException(
                "ADDRESS_PROVIDER_AUTH_FAILED",
                RecoveryHint.REFRESH_TOKEN_THEN_RETRY_ONCE,
                ex
            );
        }

        if (status.value() == 429) {
            return new AddressProviderRateLimitedException(
                "ADDRESS_PROVIDER_RATE_LIMITED",
                retryAfter(ex),
                ex
            );
        }

        if (status.is5xxServerError()) {
            return new AddressProviderUnavailableException(
                "ADDRESS_PROVIDER_5XX",
                RecoveryHint.RETRY_WITH_BACKOFF,
                ex
            );
        }

        if (status.is4xxClientError()) {
            return new AddressProviderRejectedRequestException(
                "ADDRESS_PROVIDER_REJECTED_REQUEST",
                ex
            );
        }

        return new AddressProviderException(
            "ADDRESS_PROVIDER_HTTP_FAILURE",
            FailureCategory.DEPENDENCY_UNAVAILABLE,
            RecoveryHint.ESCALATE_TO_ENGINEERING,
            ex
        );
    }
}
```

### 19.1 Adapter Usage

```java
public AddressResult lookup(String postalCode) {
    try {
        return webClient.get()
            .uri(uriBuilder -> uriBuilder.path("/address").queryParam("postal", postalCode).build())
            .retrieve()
            .bodyToMono(AddressResult.class)
            .block(timeout);
    } catch (Throwable ex) {
        throw exceptionTranslator.translate(ex);
    }
}
```

Catatan:

- di reactive code murni, jangan asal `block`; contoh ini hanya untuk menunjukkan translation;
- tempatkan translation di adapter boundary;
- retry policy sebaiknya membaca exception hasil translation, bukan raw `WebClientException`.

---

## 20. Code Pattern: API Mapper

```java
@Component
public class FailureToHttpStatusMapper {

    HttpStatus map(ApplicationFailureException ex) {
        return switch (ex.category()) {
            case VALIDATION -> HttpStatus.BAD_REQUEST;
            case AUTHENTICATION -> HttpStatus.UNAUTHORIZED;
            case AUTHORIZATION -> HttpStatus.FORBIDDEN;
            case NOT_FOUND -> HttpStatus.NOT_FOUND;
            case CONFLICT, INVALID_STATE -> HttpStatus.CONFLICT;
            case RATE_LIMITED -> HttpStatus.TOO_MANY_REQUESTS;
            case DEPENDENCY_TIMEOUT -> HttpStatus.GATEWAY_TIMEOUT;
            case DEPENDENCY_UNAVAILABLE, TRANSIENT_INFRASTRUCTURE -> HttpStatus.SERVICE_UNAVAILABLE;
            case DATA_INTEGRITY, INVARIANT_BREACH, INTERNAL_BUG -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
    }
}
```

```java
@RestControllerAdvice
public class GlobalApiExceptionHandler {

    private final FailureToHttpStatusMapper statusMapper;

    @ExceptionHandler(ApplicationFailureException.class)
    ResponseEntity<ProblemDetail> handle(ApplicationFailureException ex, HttpServletRequest req) {
        HttpStatus status = statusMapper.map(ex);

        ProblemDetail body = ProblemDetail.forStatus(status);
        body.setTitle(publicTitle(ex));
        body.setDetail(publicDetail(ex));
        body.setType(errorType(ex.code()));
        body.setProperty("code", publicCode(ex));
        body.setProperty("correlationId", Correlation.currentId());
        body.setProperty("retryable", isPubliclyRetryable(ex));
        body.setProperty("path", req.getRequestURI());

        return ResponseEntity.status(status).body(body);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> handleUnexpected(Exception ex, HttpServletRequest req) {
        String correlationId = Correlation.currentId();
        log.error("Unexpected exception. correlationId={}", correlationId, ex);

        ProblemDetail body = ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
        body.setTitle("Internal server error");
        body.setDetail("An unexpected error occurred.");
        body.setType(URI.create("https://errors.example.com/internal/unexpected"));
        body.setProperty("code", "INTERNAL_UNEXPECTED_ERROR");
        body.setProperty("correlationId", correlationId);
        body.setProperty("path", req.getRequestURI());

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
    }
}
```

---

## 21. Logging Rules for Translated Exceptions

Exception translation sering menyebabkan duplicate logging.

Anti-pattern:

```java
catch (DataAccessException e) {
    log.error("DB failed", e);
    throw new ApplicationSaveFailedException(e);
}
```

Lalu API layer:

```java
catch (ApplicationSaveFailedException e) {
    log.error("Request failed", e);
}
```

Hasilnya satu failure muncul berkali-kali.

### 21.1 Rule Praktis: Log Once at Ownership Boundary

- Jangan log lalu throw kecuali ada konteks penting yang tidak akan muncul di boundary atas.
- Untuk expected domain exception, sering tidak perlu error log per event.
- Untuk unexpected exception, log di outer boundary dengan correlation ID.
- Untuk dependency exception, log/metric di adapter atau boundary observability, tapi jangan duplicate.
- Untuk message consumer, log saat final disposition: dead-letter/quarantine/retry exhausted.

### 21.2 Tambahkan Context, Bukan Noise

Buruk:

```java
log.error("error", e);
```

Lebih baik:

```java
log.warn(
    "Address provider rate limited. provider={}, retryAfter={}, correlationId={}",
    provider,
    retryAfter,
    correlationId,
    e
);
```

Namun hati-hati:

- jangan log PII;
- jangan log token;
- jangan log full request body sensitif;
- jangan log raw SQL parameter sensitif;
- jangan log stack trace untuk expected validation per request dalam volume tinggi.

---

## 22. Metrics Rules for Translated Exceptions

Exception translation harus menghasilkan metrics yang meaningful.

Contoh metric label:

```text
application_failures_total{
  code="APPLICATION_ALREADY_SUBMITTED",
  category="CONFLICT",
  origin="DOMAIN_RULE"
}
```

```text
dependency_failures_total{
  dependency="ONEMAP",
  code="PROVIDER_RATE_LIMITED",
  category="RATE_LIMITED"
}
```

```text
database_failures_total{
  code="DATABASE_DEADLOCK",
  category="TRANSIENT_INFRASTRUCTURE"
}
```

### 22.1 Cardinality Warning

Jangan jadikan value dinamis sebagai label metrics:

Buruk:

```text
error_message="Application 2026-ABC-123 already submitted"
```

Baik:

```text
code="APPLICATION_ALREADY_SUBMITTED"
```

Metrics label harus low-cardinality.

---

## 23. Testing Exception Translation

Exception translation harus dites sebagai contract, bukan incidental behavior.

### 23.1 Unit Test Translator

```java
@Test
void shouldTranslateDuplicateApplicationNumberToDomainConflict() {
    DuplicateKeyException source = duplicateKey("UK_APPLICATION__APPLICATION_NO");
    ApplicationRecord record = sampleRecord("APP-001");

    RuntimeException translated = translator.translateSaveFailure(source, record);

    assertThat(translated).isInstanceOf(ApplicationAlreadyExistsException.class);
    assertThat(translated).hasCause(source);
    assertThat(((ApplicationFailureException) translated).code())
        .isEqualTo("APPLICATION_ALREADY_EXISTS");
}
```

### 23.2 API Contract Test

```java
@Test
void shouldMapApplicationAlreadyExistsTo409() throws Exception {
    mockMvc.perform(post("/applications")
            .contentType(MediaType.APPLICATION_JSON)
            .content(validDuplicateApplicationJson()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("APPLICATION_ALREADY_EXISTS"))
        .andExpect(jsonPath("$.correlationId").exists())
        .andExpect(jsonPath("$.status").value(409));
}
```

### 23.3 Dependency Translation Test

```java
@Test
void shouldTranslate429ToRateLimitedProviderException() {
    WebClientResponseException.TooManyRequests source = tooManyRequests("Retry-After", "30");

    AddressProviderException ex = translator.translate(source);

    assertThat(ex).isInstanceOf(AddressProviderRateLimitedException.class);
    assertThat(ex.recoveryHint()).isEqualTo(RecoveryHint.RETRY_AFTER);
    assertThat(ex.getCause()).isSameAs(source);
}
```

### 23.4 Message Disposition Test

```java
@Test
void shouldDeadLetterInvalidPayloadException() {
    Message message = invalidMessage();
    when(handler.handle(any())).thenThrow(new InvalidMessagePayloadException(...));

    consumer.consume(message);

    verify(deadLetterPublisher).publish(eq(message), any());
    verify(acknowledger).ack(message);
    verifyNoInteractions(requeueScheduler);
}
```

---

## 24. Failure Scenarios Walkthrough

### 24.1 Duplicate Submit Request

```text
Client sends submit application
  ↓
Service validates command
  ↓
Repository insert hits unique constraint
  ↓
Spring translates SQL exception to DuplicateKeyException
  ↓
Repository translator maps constraint to ApplicationAlreadySubmittedException
  ↓
API mapper returns 409 APPLICATION_ALREADY_SUBMITTED
  ↓
Metrics increments domain conflict, not 500
```

Correct behavior:

- no alert per event;
- cause preserved;
- client sees conflict;
- no blind retry;
- support can search correlation ID.

### 24.2 Provider Timeout

```text
Service calls external provider
  ↓
HTTP client read timeout
  ↓
Adapter translator creates ProviderTimeoutException
  ↓
Retry policy checks idempotency and retry budget
  ↓
After retry exhausted, API returns 504/503
  ↓
Metrics increments dependency timeout
  ↓
Alert only if SLO/rate threshold breached
```

Correct behavior:

- not mapped to 500 generic;
- not treated as client validation error;
- retry bounded;
- no infinite wait;
- dependency name visible internally.

### 24.3 Provider 400 Due to Contract Drift

```text
Client sends valid request
  ↓
Internal adapter calls provider
  ↓
Provider returns 400 unknown parameter after provider contract change
  ↓
Adapter maps to ProviderRejectedRequestException or ProviderContractException
  ↓
Internal API returns 502, not client 400
  ↓
Alert to engineering
```

Correct behavior:

- client not blamed incorrectly;
- engineering sees provider contract drift;
- no blind retry;
- adapter boundary owns the mismatch.

### 24.4 Message Poison Payload

```text
Consumer receives event
  ↓
Schema validation fails permanently
  ↓
Translator maps to InvalidMessagePayloadException
  ↓
Consumer sends DLQ
  ↓
Ack original message
  ↓
Metrics increments DLQ count
```

Correct behavior:

- no infinite requeue;
- message not silently lost;
- operator can inspect DLQ;
- valid messages continue flowing.

### 24.5 Unknown Data Integrity Violation

```text
Repository save fails DataIntegrityViolationException
  ↓
Constraint name unknown
  ↓
Translator maps to PersistenceInvariantException
  ↓
API returns 500
  ↓
Error log includes cause and constraint
  ↓
Alert triggered
```

Correct behavior:

- not misclassified as user 400;
- unknown constraint investigated;
- cause preserved;
- system does not hide possible bug/data corruption.

---

## 25. Anti-Patterns

### 25.1 Catch-All and Throw Generic RuntimeException

```java
catch (Exception e) {
    throw new RuntimeException("Failed");
}
```

Damage:

- cause lost if not passed;
- semantics lost;
- retryability lost;
- observability poor;
- API mapping generic.

### 25.2 Catch-All and Return Null

```java
catch (Exception e) {
    return null;
}
```

Damage:

- failure becomes ambiguous data;
- NPE may occur later;
- root cause hidden;
- caller cannot distinguish not found vs failure.

### 25.3 Translate Everything to BusinessException

```java
catch (Exception e) {
    throw new BusinessException("Operation failed", e);
}
```

Damage:

- technical failure looks like business rule;
- API may return 4xx for system bug;
- alerting wrong;
- client blamed for server issue.

### 25.4 Let Low-Level Exception Escape to API

```json
{
  "error": "org.hibernate.exception.ConstraintViolationException"
}
```

Damage:

- internal leakage;
- security risk;
- unstable contract;
- client coupled to implementation.

### 25.5 Parse Exception Message Everywhere

```java
if (e.getMessage().contains("ORA-00001")) { ... }
```

Damage:

- brittle;
- duplicated;
- hard to migrate;
- locale/version dependent.

If unavoidable, isolate in one translator.

### 25.6 Convert InterruptedException Incorrectly

```java
catch (InterruptedException e) {
    throw new RuntimeException(e);
}
```

Better:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationInterruptedException(e);
}
```

Interruption is a cancellation signal. Losing interrupt status can break shutdown behavior.

### 25.7 Swallow During Shutdown

```java
try {
    worker.stop();
} catch (Exception ignored) {
}
```

Shutdown failures matter. They can mean:

- message not acked;
- lock not released;
- buffer not flushed;
- transaction uncertain;
- checkpoint not persisted.

Log with context and design recovery.

---

## 26. Production Checklist

Gunakan checklist ini saat review codebase.

### 26.1 General Translation

- [ ] Apakah setiap boundary punya failure language yang jelas?
- [ ] Apakah low-level exception tidak bocor ke API/domain?
- [ ] Apakah domain exception tidak tahu HTTP/framework?
- [ ] Apakah cause chain dipertahankan?
- [ ] Apakah retryability tidak hilang?
- [ ] Apakah severity/alertability tidak disamakan semua?
- [ ] Apakah expected domain rejection tidak dilog sebagai incident?
- [ ] Apakah unexpected invariant breach tidak disembunyikan sebagai 400?

### 26.2 Persistence

- [ ] Apakah database constraint punya nama yang stabil dan meaningful?
- [ ] Apakah duplicate key diterjemahkan sesuai domain?
- [ ] Apakah unknown data integrity violation menjadi alert/invariant signal?
- [ ] Apakah deadlock/timeout/connection failure dibedakan?
- [ ] Apakah optimistic locking menjadi conflict, bukan generic 500?
- [ ] Apakah transaction rollback behavior sesuai exception hierarchy?

### 26.3 External Dependency

- [ ] Apakah 401 provider dibedakan dari 401 client?
- [ ] Apakah 429 provider membawa retry-after/backoff info?
- [ ] Apakah provider 400 tidak otomatis menjadi client 400?
- [ ] Apakah timeout, DNS/TLS failure, invalid response dibedakan?
- [ ] Apakah token refresh failure punya kategori sendiri?
- [ ] Apakah dependency name tersedia di log/metric?

### 26.4 API

- [ ] Apakah semua public error response memakai schema konsisten?
- [ ] Apakah stable error code tersedia?
- [ ] Apakah correlation ID tersedia?
- [ ] Apakah response tidak membocorkan stack trace/internal class?
- [ ] Apakah mapping status sesuai semantics?
- [ ] Apakah generic fallback 500 aman?

### 26.5 Messaging

- [ ] Apakah exception diterjemahkan menjadi ack/nack/DLQ/retry decision?
- [ ] Apakah invalid payload tidak infinite requeue?
- [ ] Apakah transient failure tidak langsung DLQ?
- [ ] Apakah duplicate message safe?
- [ ] Apakah shutdown cancellation tidak menyebabkan false ack?

### 26.6 Observability

- [ ] Apakah metrics memakai low-cardinality code/category?
- [ ] Apakah log terjadi sekali di boundary yang tepat?
- [ ] Apakah alert berbasis severity/rate/SLO, bukan semua exception?
- [ ] Apakah root cause bisa ditelusuri dari correlation ID?

---

## 27. Design Heuristics

### 27.1 Translate Only When You Add Meaning

Jangan translate exception hanya untuk mengganti nama.

Buruk:

```text
IOException -> MyIOException
```

Baik:

```text
SocketTimeoutException -> PaymentProviderTimeoutException
```

Karena yang kedua menambah meaning: dependency, timeout, recovery behavior.

### 27.2 Keep Technical Detail Inside, Public Meaning Outside

Internal:

```text
ORA-00001, constraint UK_APPLICATION__APPLICATION_NO
```

Public:

```text
APPLICATION_ALREADY_SUBMITTED
```

### 27.3 Unknown Should Stay Suspicious

Jika translator tidak mengenali exception, jangan asal jadikan validation error.

Unknown failure lebih aman sebagai:

```text
internal failure + alert + preserved cause
```

daripada false 400.

### 27.4 Translation Is Part of API and Reliability Contract

Jika kamu mengubah mapping:

```text
DuplicateApplication -> 409
```

menjadi:

```text
DuplicateApplication -> 400
```

itu bukan refactor kecil. Itu perubahan contract.

### 27.5 Make Failure Classifications Reviewable

Exception translation matrix harus bisa direview seperti API contract atau DB schema.

Pertanyaan review:

- Apa source failure-nya?
- Apa meaning di layer ini?
- Apakah retry boleh?
- Apakah rollback terjadi?
- Apa status API?
- Apa log level?
- Apa metric label?
- Apakah alert?
- Apakah client bisa memperbaiki?
- Apakah operator bisa memulihkan?

---

## 28. Mini Case Study: Submit Application

### 28.1 Requirement

Command:

```text
Submit application
```

Rules:

- application ID harus valid;
- application hanya boleh submitted sekali;
- applicant harus ada;
- external eligibility provider harus dicek;
- jika provider timeout, request boleh retry jika idempotency key sama;
- jika duplicate submit dengan idempotency key sama, return previous result;
- jika duplicate submit dengan payload berbeda, return conflict;
- audit trail harus tercatat setelah successful submit.

### 28.2 Possible Failures

| Step | Failure | Translation |
|---|---|---|
| parse request | invalid JSON | framework validation -> 400 |
| validate command | missing applicant ID | DomainValidationException -> 400 |
| load application | not found | ApplicationNotFoundException -> 404 |
| check state | already approved/withdrawn | InvalidApplicationStateException -> 409 |
| external eligibility | timeout | EligibilityProviderTimeoutException -> retry/504 |
| save submission | duplicate application no | ApplicationAlreadySubmittedException -> idempotency decision |
| save idempotency | duplicate key same hash | replay previous result |
| save idempotency | duplicate key different hash | IdempotencyConflictException -> 409 |
| audit insert | audit persistence failure | depends: fail request or async outbox |

### 28.3 Service Flow

```java
@Transactional
public SubmitResult submit(SubmitApplicationCommand command) {
    validate(command);

    IdempotencyDecision decision = idempotencyService.check(command.idempotencyKey(), command.payloadHash());
    if (decision.isReplay()) {
        return decision.previousResult();
    }

    Application application = applicationRepository.findById(command.applicationId())
        .orElseThrow(() -> new ApplicationNotFoundException(command.applicationId()));

    application.ensureCanBeSubmitted();

    EligibilityResult eligibility = eligibilityClient.check(application.applicantId());
    application.applyEligibility(eligibility);
    application.submit(clock.now());

    try {
        applicationRepository.saveSubmission(application);
        idempotencyService.recordSuccess(command, application.result());
        auditOutbox.recordApplicationSubmitted(application);
        return application.result();
    } catch (ApplicationAlreadySubmittedException e) {
        return idempotencyService.resolveDuplicateSubmission(command, e);
    }
}
```

### 28.4 Reliability Questions

1. Jika eligibility provider timeout setelah request diterima, apakah client boleh retry?
2. Jika provider call sukses tapi DB commit gagal, apakah provider side effect ada?
3. Jika DB commit sukses tapi HTTP response gagal, apakah retry aman?
4. Jika duplicate key terjadi, apakah itu user conflict atau idempotent replay?
5. Jika audit insert gagal, apakah submission harus gagal?
6. Jika pod menerima SIGTERM saat submit, apakah transaction selesai atau rollback?
7. Jika exception diterjemahkan ke 500, apakah client akan retry dan membuat duplicate?

Exception translation membantu menjawab semua pertanyaan ini secara sistematis.

---

## 29. Reference Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ API Layer                                                     │
│ - @ControllerAdvice / ExceptionMapper                        │
│ - ProblemDetail / ApiError                                   │
│ - HTTP status mapping                                        │
│ - public-safe message                                        │
└──────────────────────────────▲───────────────────────────────┘
                               │ Domain/Application exceptions
┌──────────────────────────────┴───────────────────────────────┐
│ Application Service                                            │
│ - use-case semantics                                           │
│ - transaction boundary                                         │
│ - idempotency decision                                         │
│ - command conflict                                             │
└───────────────▲───────────────────────────────▲───────────────┘
                │                               │
     persistence/domain exceptions       dependency exceptions
                │                               │
┌───────────────┴───────────────┐   ┌───────────┴───────────────┐
│ Persistence Adapter            │   │ External Client Adapter    │
│ - DataAccessException           │   │ - WebClient/HTTP exception │
│ - constraint mapping            │   │ - status mapping           │
│ - optimistic lock mapping       │   │ - timeout/rate limit       │
│ - vendor detail isolation       │   │ - token failure            │
└───────────────▲───────────────┘   └───────────▲───────────────┘
                │                               │
        SQL/JPA/vendor exception          network/provider exception
                │                               │
┌───────────────┴───────────────┐   ┌───────────┴───────────────┐
│ Database                       │   │ External Dependency        │
└───────────────────────────────┘   └───────────────────────────┘
```

Rule arsitektur:

- API layer tidak tahu SQL/vendor details.
- Domain layer tidak tahu HTTP status.
- Persistence adapter boleh tahu database details.
- External adapter boleh tahu provider details.
- Application service boleh tahu domain semantics dan use-case decision.
- Observability layer harus menerima classification yang stabil.

---

## 30. Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman:

1. Apa bedanya exception wrapping dan exception translation?
2. Kenapa `DuplicateKeyException` tidak selalu otomatis berarti 409?
3. Kenapa provider 400 tidak selalu boleh menjadi client 400?
4. Mengapa cause chain harus dipertahankan tetapi tidak boleh diekspos ke client?
5. Di layer mana sebaiknya `SQLException` diterjemahkan?
6. Di layer mana sebaiknya domain exception dipetakan ke HTTP status?
7. Apa bahaya menerjemahkan semua exception menjadi `BusinessException`?
8. Bagaimana exception translation memengaruhi retry behavior?
9. Bagaimana exception translation memengaruhi rollback behavior?
10. Apa hubungan exception translation dengan observability?
11. Bagaimana message consumer harus memperlakukan invalid payload vs transient dependency failure?
12. Mengapa unknown data integrity violation sebaiknya dianggap suspicious?
13. Apa risiko parse exception message di banyak tempat?
14. Apa bedanya expected domain rejection dan invariant breach?
15. Bagaimana cara membuat translation matrix untuk external dependency?

---

## 31. Key Takeaways

1. **Exception translation adalah boundary design**, bukan kosmetik class.
2. Exception harus diterjemahkan ketika melewati bahasa failure dari satu layer ke layer lain.
3. Translation yang baik menambah meaning: category, origin, retryability, severity, recovery hint, dan public contract.
4. Cause chain harus dipertahankan untuk evidence, tetapi detail internal harus disembunyikan dari client.
5. Persistence exception sebaiknya diterjemahkan dari vendor/framework detail menuju domain/use-case semantics.
6. External dependency exception harus membedakan timeout, rate limit, auth failure, provider 5xx, provider 4xx, dan contract drift.
7. API exception mapper adalah tempat mapping internal failure ke public HTTP/error contract.
8. Domain exception tidak boleh tahu HTTP; API layer yang tahu HTTP.
9. Translation yang salah dapat menyebabkan retry salah, rollback salah, alert salah, dan client behavior salah.
10. Unknown failure harus tetap suspicious, bukan dipaksa menjadi validation error.
11. Message consumer exception translation harus menghasilkan disposition decision: ack, retry, requeue, DLQ, quarantine.
12. Exception translation matrix adalah artefak desain yang layak direview seperti API contract.

---

## 32. Referensi

Referensi utama untuk bagian ini:

1. Oracle Java Documentation — `Throwable`, `Exception`, cause chain, suppressed exception, dan Java exception model.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html

2. Spring Framework Documentation — `PersistenceExceptionTranslator` dan translasi native persistence exception ke `DataAccessException`.  
   https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/dao/support/PersistenceExceptionTranslator.html

3. Spring Framework Documentation — `@ControllerAdvice` dan `@ExceptionHandler` untuk centralized exception handling.  
   https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-advice.html

4. Spring Framework Documentation — Error Responses, `ProblemDetail`, dan `ErrorResponse`.  
   https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html

5. Jakarta RESTful Web Services API — `ExceptionMapper`.  
   https://jakarta.ee/specifications/restful-ws/3.1/apidocs/jakarta.ws.rs/jakarta/ws/rs/ext/exceptionmapper

6. RFC 9457 — Problem Details for HTTP APIs.  
   https://www.rfc-editor.org/rfc/rfc9457.html

---

## 33. Status Seri

```text
Part 006 / 030 completed
Seri belum selesai.
```

Bagian berikutnya:

```text
Part 007 — Validation, Preconditions, Invariants, and Illegal States
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-reliability-part-005.md](./learn-java-reliability-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-007.md](./learn-java-reliability-part-007.md)
