# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-015.md

# Part 015 — Worker Application Architecture: Hexagonal Boundaries, Ports, Adapters, and Contract Isolation

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `015 / 035`  
> Fokus: arsitektur aplikasi worker Java Camunda 8/Zeebe yang production-grade, maintainable, testable, idempotent, versionable, dan aman terhadap coupling BPMN-runtime.  
> Java: relevan untuk Java 8 sampai Java 25, dengan catatan khusus untuk record/sealed interface/virtual thread pada Java modern.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas Spring Boot integration. Di sana worker terlihat seperti method yang diberi annotation, misalnya:

```java
@JobWorker(type = "validate-application")
public Map<String, Object> validate(final ActivatedJob job) {
    // business logic
}
```

Itu cukup untuk demo, tetapi tidak cukup untuk sistem production.

Di production, job worker bukan sekadar method handler. Ia adalah adapter antara dua dunia:

1. **Dunia orchestration**: Camunda 8/Zeebe, BPMN, job type, variables, incident, retry, BPMN error, process instance key, tenant, correlation key.
2. **Dunia domain/business system**: validation, approval, payment, case lifecycle, regulatory decision, database, external service, audit, security, idempotency.

Kesalahan umum adalah menaruh seluruh business logic langsung di handler worker. Awalnya terasa cepat, tetapi hasil akhirnya biasanya:

- domain logic bergantung pada `ActivatedJob`;
- unit test sulit;
- variable name tersebar di banyak class;
- error mapping tidak konsisten;
- process version change memecahkan worker;
- idempotency jadi tambalan;
- observability tidak punya contract;
- migration dari Zeebe client ke Camunda Java Client menjadi sakit;
- business rule tidak bisa dipakai ulang di API, batch, atau event consumer lain.

Bagian ini membangun arsitektur worker yang benar: **worker sebagai adapter**, domain sebagai core, dan process contract sebagai boundary eksplisit.

---

## 1. Sumber Resmi dan Posisi Konsep

Beberapa fakta dasar dari Camunda 8 yang membentuk arsitektur ini:

1. Camunda Java Client dipakai untuk membangun job workers dan integration services yang menjalankan automated tasks serta memanggil API, database, dan file system eksternal.
2. Job workers di Camunda 8 mengaktifkan job, menjalankan business logic, lalu complete/fail/throw BPMN error.
3. Camunda best practice menekankan worker sebagai bagian dari integration architecture; service task memiliki task type, dan worker mengimplementasikan pekerjaan yang berkaitan dengan task tersebut.
4. Penanganan problem/exception di worker harus membedakan technical retry, incident, dan business-level process handling.
5. Variables di Camunda 8 adalah dynamic map yang menjadi data process instance, tetapi bukan tempat ideal untuk menyimpan seluruh state bisnis besar.
6. Camunda Spring Boot Starter menyediakan annotation-based worker model, tetapi annotation bukan arsitektur; ia hanya mekanisme wiring.

Implikasinya: struktur kode worker harus menjaga batas antara **process runtime contract** dan **business capability**.

---

## 2. Mental Model Utama: Worker Is an Adapter, Not the Application

Worker application sering disalahpahami sebagai “aplikasi Camunda”. Lebih tepatnya:

```text
Camunda 8 process instance
        |
        | job activation
        v
Worker adapter layer
        |
        | typed command/query
        v
Domain application layer
        |
        | port
        v
Infrastructure adapter
        |
        | HTTP / DB / Queue / File / Identity / Legacy
        v
External system / database
```

Worker adapter menerima job dari engine. Setelah itu ia harus secepat mungkin mengubah input Zeebe menjadi request domain yang typed dan tervalidasi.

Worker adapter tidak seharusnya menjadi tempat:

- decision rule utama;
- SQL kompleks;
- HTTP client detail;
- mapping DTO eksternal;
- retry policy eksternal yang tidak terkait Zeebe;
- audit persistence;
- idempotency persistence;
- permission model;
- business state machine.

Worker adapter seharusnya menangani:

- membaca `ActivatedJob`;
- mengambil variable yang dibutuhkan;
- validasi contract minimal;
- membentuk command/query domain;
- memanggil application service;
- memetakan hasil domain ke process variables;
- memetakan error ke `complete`, `fail`, atau `throwError`;
- menambahkan observability metadata.

Rule sederhananya:

> Bila class domain harus import package Camunda, boundary Anda bocor.

---

## 3. Mengapa Hexagonal Architecture Cocok untuk Worker Camunda 8

Hexagonal architecture atau ports-and-adapters cocok untuk worker karena Camunda 8 secara alami adalah external runtime yang berbicara dengan application code lewat protocol/client.

### 3.1 Bentuk hexagonal minimal

```text
                       +-------------------------+
                       |      Camunda 8/Zeebe     |
                       +------------+------------+
                                    |
                                    | Job
                                    v
+----------------------------------------------------------------+
| Worker Application                                               |
|                                                                |
|  +-------------------+       +-------------------------------+ |
|  | Inbound Adapter   | ----> | Application Service / Use Case | |
|  | Camunda Worker    |       +---------------+---------------+ |
|  +-------------------+                       |                 |
|                                              | Port             |
|  +-------------------+       +---------------v---------------+ |
|  | Outbound Adapter  | <---- | Domain Port Interface          | |
|  | HTTP/DB/Queue     |       +-------------------------------+ |
|  +-------------------+                                         |
|                                                                |
+----------------------------------------------------------------+
```

### 3.2 Kenapa bukan layered architecture biasa?

Layered architecture masih berguna, tetapi sering membuat worker seperti ini:

```text
Controller/Worker -> Service -> Repository -> External client
```

Masalahnya, `Service` sering menjadi dumping ground. Ia tahu Camunda variable, HTTP response eksternal, SQL entity, dan business rule sekaligus.

Ports-and-adapters memaksa boundary lebih tegas:

- inbound adapter tahu Camunda;
- application service tahu use case;
- domain model tahu business invariant;
- outbound port adalah abstraction;
- outbound adapter tahu protocol eksternal.

### 3.3 Apa yang didapat?

| Kebutuhan | Dengan hexagonal boundary |
|---|---|
| Test business logic tanpa Camunda | mudah |
| Ganti Zeebe Client ke Camunda Java Client | dampak di adapter |
| Ganti REST external API ke queue | dampak di outbound adapter |
| Versioning job variable | process contract package |
| Audit dan idempotency konsisten | application service/interceptor |
| Incident mapping konsisten | error mapper layer |
| Reuse business capability dari API/batch | application service tetap sama |

---

## 4. Boundary-Boundary Utama dalam Worker Application

Worker production-grade minimal memiliki boundary berikut:

```text
worker-app
├── process-adapter        -> Camunda-specific inbound adapter
├── process-contract       -> typed input/output schema for jobs
├── application            -> use case orchestration inside app
├── domain                 -> business invariants and model
├── ports                  -> outbound interfaces
├── infrastructure         -> DB/HTTP/queue/file implementation
├── idempotency            -> duplicate side-effect control
├── error                  -> domain/error taxonomy and mapping
├── observability          -> logs, metrics, tracing correlation
└── config                 -> Spring/runtime configuration
```

Tidak harus persis seperti ini. Yang penting bukan nama folder, tetapi arah dependency-nya.

---

## 5. Dependency Rule

Arsitektur yang sehat punya aturan dependency satu arah.

```text
Camunda Adapter  ---> Application  ---> Domain
       |                 |
       |                 v
       |              Ports
       |                 ^
       v                 |
Infrastructure Adapter --+
```

Aturan:

1. `domain` tidak boleh bergantung pada Camunda, Spring, HTTP client, JPA, Jackson infrastructure, atau Zeebe class.
2. `application` boleh bergantung pada `domain` dan `ports`, tetapi tidak pada `ActivatedJob`.
3. `process-adapter` boleh bergantung pada Camunda client/starter.
4. `infrastructure` boleh bergantung pada framework/protocol detail.
5. `process-contract` boleh berisi DTO boundary, tetapi harus dijaga agar tidak menjadi tempat business rule berat.
6. Error mapping dari domain ke Zeebe command berada di adapter atau dedicated mapper, bukan di domain.

### 5.1 Dependency yang buruk

```java
public class EligibilityService {
    public Map<String, Object> validate(ActivatedJob job) {
        String applicantId = (String) job.getVariablesAsMap().get("applicantId");
        // business logic + camunda + http + db mixed here
    }
}
```

Masalah:

- domain service tahu `ActivatedJob`;
- variable name literal tersebar;
- sulit dites tanpa engine/client;
- error handling cenderung campur;
- contract tidak eksplisit.

### 5.2 Dependency yang lebih sehat

```java
public final class ValidateApplicationWorker {
    private final ValidateApplicationUseCase useCase;
    private final ValidateApplicationJobMapper mapper;
    private final WorkerErrorMapper errorMapper;

    public Map<String, Object> handle(final ActivatedJob job) {
        ValidateApplicationCommand command = mapper.toCommand(job);
        ValidateApplicationResult result = useCase.validate(command);
        return mapper.toVariables(result);
    }
}
```

`useCase` tidak tahu Camunda. Ia hanya tahu command domain.

---

## 6. Layer 1 — Process Adapter Layer

Process adapter adalah layer paling luar yang berbicara dengan Camunda 8.

Tanggung jawab:

1. Menerima job.
2. Membaca metadata:
   - job key;
   - process instance key;
   - process definition key;
   - BPMN process id;
   - element id;
   - job type;
   - tenant id;
   - retries;
   - deadline.
3. Membaca variables yang diperlukan.
4. Membentuk typed command.
5. Memanggil application service.
6. Mengubah result menjadi process variables output.
7. Mengubah exception menjadi:
   - job failure;
   - BPMN error;
   - incident;
   - no-retry failure;
   - technical retry.
8. Logging dan metrics dengan correlation context.

### 6.1 Adapter tidak boleh berisi business decision utama

Contoh buruk:

```java
@JobWorker(type = "screen-applicant")
public Map<String, Object> screen(ActivatedJob job) {
    Map<String, Object> vars = job.getVariablesAsMap();
    int age = (Integer) vars.get("age");
    boolean hasLicense = (Boolean) vars.get("hasLicense");

    if (age < 21 || !hasLicense) {
        return Map.of("screeningOutcome", "REJECTED");
    }

    return Map.of("screeningOutcome", "APPROVED");
}
```

Masalahnya bukan karena kodenya salah secara teknis. Masalahnya adalah screening rule sekarang terkunci di worker. Bila rule sama dibutuhkan di API preview, batch re-evaluation, atau manual review tool, logic akan digandakan.

Contoh lebih baik:

```java
@JobWorker(type = "screen-applicant")
public Map<String, Object> screen(ActivatedJob job) {
    ScreeningCommand command = mapper.toCommand(job);
    ScreeningDecision decision = screeningUseCase.screen(command);
    return mapper.toVariables(decision);
}
```

---

## 7. Layer 2 — Process Contract Layer

Process contract adalah salah satu boundary paling penting.

Ia menjawab pertanyaan:

> “Untuk job type tertentu, variable apa yang boleh diterima, tipe datanya apa, output-nya apa, dan error code apa yang bisa dilempar?”

### 7.1 Job type sebagai API contract

Service task BPMN dengan job type `validate-application` seharusnya diperlakukan seperti API endpoint.

```text
Job Type: validate-application
Input:
  - applicationId: string, required
  - applicantId: string, required
  - submittedAt: ISO-8601 string, required
  - validationMode: enum[AUTO, MANUAL_RECHECK], optional default AUTO
Output:
  - validationStatus: enum[VALID, INVALID, NEEDS_REVIEW]
  - validationReasonCodes: string[]
  - validationCompletedAt: ISO-8601 string
BPMN Errors:
  - APPLICATION_NOT_FOUND
  - APPLICANT_NOT_ELIGIBLE
Technical Failures:
  - downstream unavailable
  - schema invalid
  - timeout
```

Bila contract tidak ditulis, ia tetap ada secara implisit. Contract implisit adalah sumber bug.

### 7.2 Struktur package contract

Contoh:

```text
com.example.workflow.contract
├── validateapplication
│   ├── ValidateApplicationInput.java
│   ├── ValidateApplicationOutput.java
│   ├── ValidateApplicationVariables.java
│   ├── ValidateApplicationErrorCode.java
│   └── ValidateApplicationContract.java
├── requestdocuments
│   ├── RequestDocumentsInput.java
│   ├── RequestDocumentsOutput.java
│   └── RequestDocumentsErrorCode.java
└── common
    ├── ProcessVariableNames.java
    ├── TenantVariables.java
    ├── AuditVariables.java
    └── ContractViolationException.java
```

### 7.3 Jangan terlalu global

Kesalahan umum:

```java
public final class Variables {
    public static final String APPLICATION_ID = "applicationId";
    public static final String STATUS = "status";
    public static final String RESULT = "result";
    // grows forever...
}
```

Masalah:

- semua job bercampur;
- nama generic seperti `status` ambigu;
- refactoring sulit;
- versioning tidak jelas.

Lebih baik contract per job/use case.

```java
public final class ValidateApplicationVariables {
    public static final String APPLICATION_ID = "applicationId";
    public static final String APPLICANT_ID = "applicantId";
    public static final String VALIDATION_STATUS = "validationStatus";
    public static final String VALIDATION_REASON_CODES = "validationReasonCodes";

    private ValidateApplicationVariables() {
    }
}
```

---

## 8. Layer 3 — Mapping Layer

Mapping layer mengubah Zeebe/Camunda representation menjadi typed command/result.

### 8.1 Mengapa mapper perlu eksplisit?

Karena process variables adalah map dinamis. Java application butuh type safety.

Tanpa mapper:

```java
String applicationId = (String) job.getVariablesAsMap().get("applicationId");
```

Masalah:

- raw cast;
- runtime failure;
- null ambiguity;
- tidak ada validation message bagus;
- nama variable tersebar;
- sulit versioning.

Dengan mapper:

```java
public final class ValidateApplicationJobMapper {

    public ValidateApplicationCommand toCommand(ActivatedJob job) {
        Map<String, Object> vars = job.getVariablesAsMap();

        String applicationId = requiredString(vars, ValidateApplicationVariables.APPLICATION_ID);
        String applicantId = requiredString(vars, ValidateApplicationVariables.APPLICANT_ID);

        return new ValidateApplicationCommand(
            applicationId,
            applicantId,
            WorkerExecutionContext.from(job)
        );
    }

    public Map<String, Object> toVariables(ValidateApplicationResult result) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put(ValidateApplicationVariables.VALIDATION_STATUS, result.status().name());
        out.put(ValidateApplicationVariables.VALIDATION_REASON_CODES, result.reasonCodes());
        out.put("validationCompletedAt", result.completedAt().toString());
        return out;
    }
}
```

Untuk Java 8, ganti `record` dengan final class biasa.

### 8.2 Mapper harus melakukan contract validation, bukan business validation

Contract validation:

- variable wajib ada;
- tipe benar;
- enum dikenal;
- date parseable;
- list format benar;
- payload tidak melebihi batas internal;
- field tidak boleh null.

Business validation:

- applicant eligible;
- case boleh dilanjutkan;
- deadline masih berlaku;
- user punya authority;
- document lengkap.

Contract validation ada di mapper/contract layer. Business validation ada di domain/application layer.

---

## 9. Layer 4 — Application Service / Use Case Layer

Application service adalah pusat use case. Ia mengatur alur kerja internal aplikasi, tetapi bukan BPMN engine.

Contoh:

```java
public final class ValidateApplicationUseCase {
    private final ApplicationRepository applicationRepository;
    private final EligibilityPort eligibilityPort;
    private final IdempotencyService idempotencyService;
    private final AuditPort auditPort;
    private final Clock clock;

    public ValidateApplicationResult validate(ValidateApplicationCommand command) {
        return idempotencyService.execute(
            IdempotencyKey.forWorker(command.executionContext(), "validate-application"),
            () -> doValidate(command)
        );
    }

    private ValidateApplicationResult doValidate(ValidateApplicationCommand command) {
        Application application = applicationRepository.findById(command.applicationId())
            .orElseThrow(() -> new BusinessRejection("APPLICATION_NOT_FOUND"));

        EligibilityDecision decision = eligibilityPort.check(application.applicantId());

        ValidationStatus status = decision.isEligible()
            ? ValidationStatus.VALID
            : ValidationStatus.NEEDS_REVIEW;

        auditPort.recordValidation(application.id(), status, clock.instant());

        return new ValidateApplicationResult(status, decision.reasonCodes(), clock.instant());
    }
}
```

Application service boleh mengatur:

- transaction boundary;
- idempotency;
- audit;
- domain entity retrieval;
- call ke outbound port;
- business exception;
- result construction.

Application service tidak perlu tahu:

- BPMN element id;
- `ActivatedJob`;
- Zeebe client;
- `completeJob` command;
- process variable map.

---

## 10. Layer 5 — Domain Layer

Domain layer berisi konsep bisnis dan invariant.

Contoh domain concepts:

```text
Application
Applicant
CaseFile
EligibilityDecision
ValidationStatus
ReviewOutcome
EnforcementAction
AppealWindow
Deadline
RiskBand
```

Domain layer idealnya bebas dari framework.

### 10.1 Domain invariant

Contoh invariant:

```java
public final class AppealWindow {
    private final Instant startsAt;
    private final Instant endsAt;

    public AppealWindow(Instant startsAt, Instant endsAt) {
        if (!endsAt.isAfter startsAt)) {
            throw new IllegalArgumentException("appeal window end must be after start");
        }
        this.startsAt = startsAt;
        this.endsAt = endsAt;
    }

    public boolean isOpenAt(Instant now) {
        return !now.isBefore(startsAt) && now.isBefore(endsAt);
    }
}
```

Ada typo di atas? Ya. Seharusnya:

```java
if (!endsAt.isAfter(startsAt)) {
    throw new IllegalArgumentException("appeal window end must be after start");
}
```

Poinnya: domain invariant harus bisa dites tanpa Camunda.

### 10.2 Domain tidak melempar BPMN error

Jangan seperti ini:

```java
throw new ZeebeBpmnError("APPLICANT_NOT_ELIGIBLE");
```

Lebih baik:

```java
throw new BusinessRejection("APPLICANT_NOT_ELIGIBLE");
```

Lalu adapter memetakan `BusinessRejection` menjadi BPMN error bila memang model BPMN menanganinya.

---

## 11. Layer 6 — Ports

Port adalah interface yang dibutuhkan application/domain untuk berinteraksi dengan dunia luar.

Contoh:

```java
public interface EligibilityPort {
    EligibilityDecision check(String applicantId);
}

public interface ApplicationRepository {
    Optional<Application> findById(String applicationId);
    void save(Application application);
}

public interface AuditPort {
    void recordValidation(String applicationId, ValidationStatus status, Instant at);
}

public interface DocumentVerificationPort {
    DocumentVerificationResult verify(String documentId);
}
```

Port membuat use case stabil walaupun teknologi luar berubah.

### 11.1 Port harus memakai bahasa domain, bukan bahasa vendor

Buruk:

```java
public interface EligibilityPort {
    HttpResponse<String> callEligibilityApi(String applicantId);
}
```

Lebih baik:

```java
public interface EligibilityPort {
    EligibilityDecision check(String applicantId);
}
```

Kenapa? Karena application service tidak peduli apakah eligibility dicek lewat REST, database, queue, gRPC, atau rules engine.

---

## 12. Layer 7 — Infrastructure Adapters

Infrastructure adapter mengimplementasikan port.

Contoh REST adapter:

```java
public final class HttpEligibilityAdapter implements EligibilityPort {
    private final EligibilityHttpClient client;
    private final EligibilityResponseMapper mapper;

    @Override
    public EligibilityDecision check(String applicantId) {
        EligibilityResponse response = client.check(applicantId);
        return mapper.toDecision(response);
    }
}
```

Di sini boleh ada:

- HTTP client;
- retry HTTP spesifik;
- timeout;
- circuit breaker;
- response mapping;
- auth token;
- vendor error mapping;
- rate limit handling.

Tetapi adapter harus mengembalikan domain-friendly result atau exception.

---

## 13. Error Boundary dan Mapping

Camunda worker harus membuat keputusan error:

```text
Exception terjadi
      |
      v
Apakah contract invalid?
      |-- ya --> fail job no retry / incident, tergantung policy
      |
Apakah business rejection yang BPMN model handle?
      |-- ya --> throw BPMN error
      |
Apakah transient technical failure?
      |-- ya --> fail job with retries/backoff
      |
Apakah non-retryable technical corruption?
      |-- ya --> fail job no retry -> incident
```

### 13.1 Error taxonomy

```java
public abstract class WorkerApplicationException extends RuntimeException {
    protected WorkerApplicationException(String message, Throwable cause) {
        super(message, cause);
    }
}

public final class ContractViolationException extends WorkerApplicationException {
    public ContractViolationException(String message) {
        super(message, null);
    }
}

public final class BusinessRejectionException extends WorkerApplicationException {
    private final String code;

    public BusinessRejectionException(String code, String message) {
        super(message, null);
        this.code = code;
    }

    public String code() {
        return code;
    }
}

public final class TransientDependencyException extends WorkerApplicationException {
    public TransientDependencyException(String message, Throwable cause) {
        super(message, cause);
    }
}

public final class NonRetryableSystemException extends WorkerApplicationException {
    public NonRetryableSystemException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

### 13.2 Worker error mapper

```java
public final class WorkerErrorMapper {

    public WorkerFailureDecision map(Throwable error, ActivatedJob job) {
        if (error instanceof BusinessRejectionException) {
            BusinessRejectionException e = (BusinessRejectionException) error;
            return WorkerFailureDecision.bpmnError(e.code(), e.getMessage());
        }

        if (error instanceof ContractViolationException) {
            return WorkerFailureDecision.failNoRetry("CONTRACT_VIOLATION", error.getMessage());
        }

        if (error instanceof TransientDependencyException) {
            return WorkerFailureDecision.failWithRetry("TRANSIENT_DEPENDENCY", error.getMessage());
        }

        return WorkerFailureDecision.failNoRetry("UNEXPECTED_WORKER_ERROR", safeMessage(error));
    }
}
```

Dalam Spring Boot Starter, annotation worker bisa auto-complete, tetapi untuk error control yang serius, manual completion sering lebih jelas.

---

## 14. Idempotency as an Architectural Service

Idempotency tidak boleh hanya menjadi `if` kecil di worker method. Ia adalah architectural capability.

### 14.1 Kenapa?

Camunda/Zeebe job delivery harus diperlakukan sebagai at-least-once dari perspektif worker. Job bisa dieksekusi ulang ketika:

- worker crash setelah side effect tetapi sebelum complete job;
- network failure saat complete command;
- job timeout terlalu pendek;
- gateway/broker/network interruption;
- deployment rolling restart;
- worker menerima duplicate scenario akibat retry.

### 14.2 Idempotency boundary

```text
Worker adapter
    -> typed command
    -> IdempotencyService.execute(key, requestHash, supplier)
        -> if completed with same requestHash: return stored result
        -> if in progress: reject/backoff/fail retryable
        -> if same key different requestHash: fail non-retryable
        -> else execute business operation
```

### 14.3 Idempotency key

Candidate key:

```text
worker:{jobType}:{processInstanceKey}:{elementInstanceKey}:{businessOperationId}
```

Tetapi key terbaik tergantung jenis side effect.

| Side effect | Idempotency key lebih baik |
|---|---|
| Create payment | business payment id/request id |
| Validate application | application id + validation version |
| Send email | notification id / template + recipient + business event id |
| Create external case | external correlation id generated before call |
| Update status | aggregate id + target status + version |

Jangan selalu memakai `jobKey`. Job key aman untuk dedup execution job tertentu, tetapi kadang tidak cukup untuk dedup business operation lintas retry/migration/re-drive.

### 14.4 Idempotency service interface

```java
public interface IdempotencyService {
    <T> T execute(IdempotencyCommand<T> command);
}

public final class IdempotencyCommand<T> {
    private final String key;
    private final String requestHash;
    private final Supplier<T> operation;
    private final Class<T> resultType;

    // constructor/getters
}
```

Implementation bisa memakai database table:

```sql
CREATE TABLE worker_idempotency (
    idempotency_key      VARCHAR(200) PRIMARY KEY,
    request_hash         VARCHAR(128) NOT NULL,
    status               VARCHAR(30)  NOT NULL,
    result_json          CLOB,
    error_code           VARCHAR(100),
    created_at           TIMESTAMP    NOT NULL,
    updated_at           TIMESTAMP    NOT NULL,
    locked_until         TIMESTAMP
);
```

Status:

```text
STARTED
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
```

---

## 15. Transaction Boundary

Salah satu pertanyaan paling sulit:

> “Haruskah worker complete job sebelum atau sesudah commit database?”

Jawaban: biasanya **commit business state dulu**, lalu complete job, tetapi harus idempotent.

### 15.1 Pattern umum

```text
1. Activate job
2. Validate variables
3. Begin DB transaction
4. Check idempotency
5. Apply business state / record outbox / audit
6. Commit DB transaction
7. Complete Zeebe job
```

Failure scenario:

```text
DB commit success
Complete job network failure
Zeebe retries job later
Worker sees idempotency completed
Worker returns same output
Complete job succeeds
```

Ini aman bila idempotency result disimpan.

### 15.2 Complete before commit?

```text
1. Complete Zeebe job
2. Then update DB
```

Ini bahaya karena process bergerak maju padahal business state belum commit. Bila DB update gagal setelah complete, engine sudah melewati step tersebut.

Ada kasus khusus di mana complete before side effect bisa diterima, tetapi hanya bila side effect tidak kritis atau ada downstream reconciliation kuat. Untuk business-critical workflow, jangan jadikan ini default.

---

## 16. Process Contract Versioning

Worker application harus mendukung evolusi BPMN dan variable schema.

### 16.1 Versi job type

Ada beberapa strategi:

#### Strategi A — job type tetap, schema backward-compatible

```text
validate-application
```

Cocok bila perubahan additive:

- tambah optional variable;
- tambah output variable yang tidak wajib;
- enum tambah nilai yang worker lama tidak perlu baca.

#### Strategi B — job type versioned

```text
validate-application.v1
validate-application.v2
```

Cocok bila breaking change:

- required input berubah;
- output semantic berubah;
- error code berubah;
- side effect berbeda;
- idempotency key berubah.

#### Strategi C — same job type, explicit contract version variable

```text
job type: validate-application
variable: validateApplicationContractVersion = 2
```

Cocok bila ingin satu worker menangani beberapa version.

### 16.2 Jangan campur tanpa governance

Anti-pattern:

```text
validate-application
validate-application-v2
ValidateApplication
validateApplication
validate-app
```

Tanpa naming convention, Operate/debugging/deployment menjadi kacau.

### 16.3 Naming convention yang disarankan

```text
<bounded-context>.<capability>.<action>[.vN]
```

Contoh:

```text
application.validation.validate.v1
application.screening.calculate-risk.v1
case.assignment.assign-reviewer.v1
notification.email.send.v1
external.onemap.resolve-postal-code.v1
```

Atau bila tim ingin lebih pendek:

```text
validate-application.v1
calculate-risk.v1
assign-reviewer.v1
send-email.v1
```

Yang penting konsisten.

---

## 17. Worker Package Structure: Contoh Production

Contoh struktur Maven/Spring Boot:

```text
src/main/java/com/acme/regflow/worker
├── RegflowWorkerApplication.java
├── camunda
│   ├── CamundaClientConfig.java
│   ├── WorkerProperties.java
│   └── WorkerMetadata.java
├── process
│   ├── common
│   │   ├── WorkerExecutionContext.java
│   │   ├── WorkerErrorMapper.java
│   │   ├── WorkerFailureDecision.java
│   │   └── VariableReader.java
│   ├── validateapplication
│   │   ├── ValidateApplicationWorker.java
│   │   ├── ValidateApplicationJobMapper.java
│   │   ├── ValidateApplicationVariables.java
│   │   ├── ValidateApplicationInput.java
│   │   ├── ValidateApplicationOutput.java
│   │   └── ValidateApplicationErrorCode.java
│   └── assigntoreviewer
│       ├── AssignToReviewerWorker.java
│       ├── AssignToReviewerJobMapper.java
│       └── AssignToReviewerVariables.java
├── application
│   ├── validateapplication
│   │   ├── ValidateApplicationUseCase.java
│   │   ├── ValidateApplicationCommand.java
│   │   └── ValidateApplicationResult.java
│   └── assigntoreviewer
│       ├── AssignToReviewerUseCase.java
│       ├── AssignToReviewerCommand.java
│       └── AssignToReviewerResult.java
├── domain
│   ├── application
│   ├── casefile
│   ├── reviewer
│   └── decision
├── port
│   ├── ApplicationRepository.java
│   ├── ReviewerDirectoryPort.java
│   ├── EligibilityPort.java
│   ├── AuditPort.java
│   └── NotificationPort.java
├── infrastructure
│   ├── persistence
│   ├── http
│   ├── audit
│   └── notification
├── idempotency
│   ├── IdempotencyService.java
│   ├── JdbcIdempotencyService.java
│   └── IdempotencyRecord.java
└── observability
    ├── WorkerLogContext.java
    ├── WorkerMetrics.java
    └── CorrelationIds.java
```

Untuk project besar, package per bounded context bisa lebih baik:

```text
com.acme.regflow.applicationvalidation
com.acme.regflow.caseassignment
com.acme.regflow.notification
com.acme.regflow.shared.worker
```

---

## 18. Multi-Worker Application vs One Worker App per Capability

Tidak semua job type harus punya aplikasi terpisah. Tapi satu aplikasi raksasa juga buruk.

### 18.1 Satu worker app untuk banyak job type

Kelebihan:

- deployment lebih sedikit;
- resource lebih efisien;
- shared library/config mudah;
- cocok untuk job kecil satu bounded context.

Kekurangan:

- blast radius besar;
- scaling kurang granular;
- release coupling;
- memory/thread contention;
- dependency membengkak.

### 18.2 Satu worker app per capability

Kelebihan:

- scaling granular;
- failure isolation;
- ownership jelas;
- deployment independen;
- security secret lebih minimal.

Kekurangan:

- operational overhead;
- banyak service;
- duplikasi boilerplate;
- config management lebih kompleks.

### 18.3 Rekomendasi praktis

Gunakan boundary berikut:

```text
Satu worker app per bounded context / ownership domain.
Bukan satu worker app untuk seluruh enterprise.
Bukan satu worker app untuk setiap service task kecil tanpa alasan.
```

Contoh:

```text
application-lifecycle-workers
case-assignment-workers
notification-workers
external-verification-workers
reporting-export-workers
```

---

## 19. Worker Concurrency sebagai Bagian dari Arsitektur

Worker architecture bukan hanya package. Ia juga runtime shape.

### 19.1 Pisahkan job type berdasarkan karakteristik

| Job type | Karakter | Deployment implication |
|---|---|---|
| DB-only validation | cepat, IO ringan | bisa sharing app |
| External API call | latency tinggi | concurrency/timeout khusus |
| File generation | CPU/memory tinggi | dedicated worker pool/app |
| Notification sending | rate-limited | dedicated throttling |
| Human task preparation | ringan | sharing app boleh |
| Bulk multi-instance item | volume tinggi | scaling khusus |

### 19.2 Jangan campur worker berat dan ringan tanpa kontrol

Jika job `generate-large-report` dan `validate-small-field` berada di app sama dengan thread pool sama, job berat bisa melambatkan job ringan.

Solusi:

- dedicated worker app;
- separate executor;
- worker override config;
- max jobs active per type;
- resource limit per deployment;
- queue/rate limit internal.

---

## 20. Observability Boundary

Worker adapter harus membuat process-aware observability context.

### 20.1 Metadata yang wajib masuk log

```text
jobType
jobKey
workerName
processInstanceKey
processDefinitionKey
bpmnProcessId
elementId
elementInstanceKey
tenantId
businessKey/correlationKey if available
applicationId/caseId if available
attempt/retries
idempotencyKey
```

### 20.2 Jangan log payload sembarangan

Variables bisa berisi PII/sensitive data. Log contract harus whitelist.

Buruk:

```java
log.info("job variables={}", job.getVariables());
```

Lebih baik:

```java
log.info("handling job type={} processInstanceKey={} applicationId={}",
    job.getType(),
    job.getProcessInstanceKey(),
    safe(applicationId));
```

### 20.3 Metrics per boundary

Metrics berguna:

```text
worker.job.started.count{jobType}
worker.job.completed.count{jobType}
worker.job.failed.count{jobType,errorClass}
worker.job.bpmn_error.count{jobType,errorCode}
worker.job.duration{jobType}
worker.idempotency.hit.count{jobType}
worker.idempotency.conflict.count{jobType}
worker.external.call.duration{dependency,operation}
worker.contract.violation.count{jobType,variable}
```

---

## 21. Security Boundary

Worker sering punya credential kuat karena memanggil internal API/database. Jangan memperlakukan worker sebagai “trusted blob” tanpa boundary.

### 21.1 Least privilege per worker app

Jika `notification-workers` hanya butuh SMTP/API notification, jangan beri akses database case penuh.

Jika `external-verification-workers` hanya butuh external verification API, jangan beri akses task admin.

### 21.2 Secret isolation

Pisahkan secret berdasarkan bounded context:

```text
/application-lifecycle-workers/db
/application-lifecycle-workers/camunda-client
/external-verification-workers/vendor-api
/notification-workers/smtp
```

### 21.3 Variable minimization

Worker tidak boleh mengambil semua variable bila hanya butuh 2 field. Gunakan variable fetch strategy yang ketat.

### 21.4 Tenant boundary

Untuk multi-tenant:

- tenant id harus masuk execution context;
- repository query harus tenant-scoped;
- outbound call harus tenant-aware;
- audit harus menyimpan tenant;
- idempotency key harus tenant-aware.

Contoh key:

```text
tenant:{tenantId}:worker:{jobType}:business:{operationId}
```

---

## 22. Worker as Contract Adapter for Regulatory Systems

Untuk sistem regulasi/case management, worker architecture harus mendukung defensibility.

### 22.1 Jangan simpan keputusan hanya sebagai variable transient

Keputusan penting harus persist di domain database/audit store.

Contoh:

```text
BPMN variable: reviewOutcome = APPROVED
Domain DB: review_decision table records reviewer, timestamp, reason, policy basis, evidence reference
Audit: immutable decision event
```

### 22.2 Worker harus mencatat why, bukan hanya what

Buruk:

```text
screeningStatus = FAILED
```

Lebih baik:

```text
screeningStatus = FAILED
screeningReasonCodes = ["MISSING_LICENSE", "EXPIRED_DOCUMENT"]
screeningPolicyVersion = "eligibility-policy-2026-04"
screeningDecisionRef = "SCR-2026-000123"
```

### 22.3 BPMN bukan database of record

Zeebe process state membantu orchestration, tetapi domain decision record tetap harus berada di domain system/audit store.

---

## 23. Practical Java Example — End-to-End Skeleton

### 23.1 Contract constants

```java
public final class ValidateApplicationVariables {
    public static final String APPLICATION_ID = "applicationId";
    public static final String APPLICANT_ID = "applicantId";
    public static final String VALIDATION_STATUS = "validationStatus";
    public static final String VALIDATION_REASON_CODES = "validationReasonCodes";
    public static final String VALIDATION_DECISION_REF = "validationDecisionRef";

    private ValidateApplicationVariables() {
    }
}
```

### 23.2 Execution context

```java
public final class WorkerExecutionContext {
    private final long jobKey;
    private final long processInstanceKey;
    private final String bpmnProcessId;
    private final String elementId;
    private final String jobType;
    private final String tenantId;

    public WorkerExecutionContext(
            long jobKey,
            long processInstanceKey,
            String bpmnProcessId,
            String elementId,
            String jobType,
            String tenantId) {
        this.jobKey = jobKey;
        this.processInstanceKey = processInstanceKey;
        this.bpmnProcessId = bpmnProcessId;
        this.elementId = elementId;
        this.jobType = jobType;
        this.tenantId = tenantId;
    }

    public static WorkerExecutionContext from(ActivatedJob job) {
        return new WorkerExecutionContext(
            job.getKey(),
            job.getProcessInstanceKey(),
            job.getBpmnProcessId(),
            job.getElementId(),
            job.getType(),
            job.getTenantId()
        );
    }

    public long jobKey() { return jobKey; }
    public long processInstanceKey() { return processInstanceKey; }
    public String bpmnProcessId() { return bpmnProcessId; }
    public String elementId() { return elementId; }
    public String jobType() { return jobType; }
    public String tenantId() { return tenantId; }
}
```

For Java 16+, this can be a `record`:

```java
public record WorkerExecutionContext(
    long jobKey,
    long processInstanceKey,
    String bpmnProcessId,
    String elementId,
    String jobType,
    String tenantId
) {
    public static WorkerExecutionContext from(ActivatedJob job) {
        return new WorkerExecutionContext(
            job.getKey(),
            job.getProcessInstanceKey(),
            job.getBpmnProcessId(),
            job.getElementId(),
            job.getType(),
            job.getTenantId()
        );
    }
}
```

### 23.3 Command

```java
public final class ValidateApplicationCommand {
    private final String applicationId;
    private final String applicantId;
    private final WorkerExecutionContext executionContext;

    public ValidateApplicationCommand(
            String applicationId,
            String applicantId,
            WorkerExecutionContext executionContext) {
        this.applicationId = applicationId;
        this.applicantId = applicantId;
        this.executionContext = executionContext;
    }

    public String applicationId() { return applicationId; }
    public String applicantId() { return applicantId; }
    public WorkerExecutionContext executionContext() { return executionContext; }
}
```

### 23.4 Result

```java
public final class ValidateApplicationResult {
    private final ValidationStatus status;
    private final List<String> reasonCodes;
    private final String decisionReference;
    private final Instant completedAt;

    public ValidateApplicationResult(
            ValidationStatus status,
            List<String> reasonCodes,
            String decisionReference,
            Instant completedAt) {
        this.status = status;
        this.reasonCodes = Collections.unmodifiableList(new ArrayList<>(reasonCodes));
        this.decisionReference = decisionReference;
        this.completedAt = completedAt;
    }

    public ValidationStatus status() { return status; }
    public List<String> reasonCodes() { return reasonCodes; }
    public String decisionReference() { return decisionReference; }
    public Instant completedAt() { return completedAt; }
}
```

### 23.5 Mapper

```java
public final class ValidateApplicationJobMapper {

    public ValidateApplicationCommand toCommand(ActivatedJob job) {
        Map<String, Object> vars = job.getVariablesAsMap();

        String applicationId = requiredString(vars, ValidateApplicationVariables.APPLICATION_ID);
        String applicantId = requiredString(vars, ValidateApplicationVariables.APPLICANT_ID);

        return new ValidateApplicationCommand(
            applicationId,
            applicantId,
            WorkerExecutionContext.from(job)
        );
    }

    public Map<String, Object> toVariables(ValidateApplicationResult result) {
        Map<String, Object> variables = new LinkedHashMap<>();
        variables.put(ValidateApplicationVariables.VALIDATION_STATUS, result.status().name());
        variables.put(ValidateApplicationVariables.VALIDATION_REASON_CODES, result.reasonCodes());
        variables.put(ValidateApplicationVariables.VALIDATION_DECISION_REF, result.decisionReference());
        variables.put("validationCompletedAt", result.completedAt().toString());
        return variables;
    }

    private static String requiredString(Map<String, Object> vars, String name) {
        Object value = vars.get(name);
        if (!(value instanceof String) || ((String) value).trim().isEmpty()) {
            throw new ContractViolationException("Missing or invalid variable: " + name);
        }
        return (String) value;
    }
}
```

### 23.6 Worker adapter

```java
@Component
public final class ValidateApplicationWorker {
    private final ValidateApplicationUseCase useCase;
    private final ValidateApplicationJobMapper mapper;

    public ValidateApplicationWorker(
            ValidateApplicationUseCase useCase,
            ValidateApplicationJobMapper mapper) {
        this.useCase = useCase;
        this.mapper = mapper;
    }

    @JobWorker(type = "application.validation.validate.v1", autoComplete = true)
    public Map<String, Object> handle(ActivatedJob job) {
        ValidateApplicationCommand command = mapper.toCommand(job);
        ValidateApplicationResult result = useCase.validate(command);
        return mapper.toVariables(result);
    }
}
```

Auto-complete ini bagus untuk case sederhana. Untuk error mapping yang lebih eksplisit, gunakan manual completion.

---

## 24. Manual Completion Pattern

Manual completion memberi kontrol penuh.

```java
@JobWorker(type = "application.validation.validate.v1", autoComplete = false)
public void handle(ActivatedJob job, JobClient client) {
    try {
        ValidateApplicationCommand command = mapper.toCommand(job);
        ValidateApplicationResult result = useCase.validate(command);
        Map<String, Object> variables = mapper.toVariables(result);

        client.newCompleteCommand(job.getKey())
            .variables(variables)
            .send()
            .join();

    } catch (BusinessRejectionException e) {
        client.newThrowErrorCommand(job.getKey())
            .errorCode(e.code())
            .errorMessage(e.getMessage())
            .send()
            .join();

    } catch (ContractViolationException e) {
        client.newFailCommand(job.getKey())
            .retries(0)
            .errorMessage(e.getMessage())
            .send()
            .join();

    } catch (TransientDependencyException e) {
        int remainingRetries = Math.max(job.getRetries() - 1, 0);
        client.newFailCommand(job.getKey())
            .retries(remainingRetries)
            .errorMessage(e.getMessage())
            .send()
            .join();
    }
}
```

Catatan:

- code ini skeleton;
- production code perlu timeout pada future/join boundary;
- error message harus aman dari PII;
- retry backoff harus dipertimbangkan;
- command failure saat complete/fail/throwError juga perlu observability.

---

## 25. Handling Framework Differences Across Java 8–25

### 25.1 Java 8 baseline

Gunakan:

- final class immutable;
- constructor validation;
- `Optional` secukupnya;
- `CompletableFuture` bila perlu async;
- no records;
- no sealed classes;
- no virtual threads.

### 25.2 Java 11/17 baseline

Java 17 adalah baseline modern yang nyaman:

- records bisa dipakai bila project sudah Java 16+;
- sealed interface bisa untuk error taxonomy;
- switch expression bisa memperjelas mapping;
- text block untuk JSON test fixture.

### 25.3 Java 21/25

Java 21+ membuka opsi:

- virtual threads untuk blocking IO worker, tetapi tetap harus menghormati downstream capacity;
- structured concurrency bila digunakan secara hati-hati;
- pattern matching untuk cleaner mapper/error mapping;
- records untuk command/result.

Namun jangan salah paham:

> Virtual thread tidak menghapus kebutuhan idempotency, timeout, rate limit, dan backpressure.

Virtual thread membuat concurrency murah di JVM, bukan membuat external API/database tak terbatas.

---

## 26. Testing Architecture

Arsitektur ini membuat testing jauh lebih jelas.

### 26.1 Domain test

Tanpa Camunda, tanpa Spring.

```text
EligibilityPolicyTest
AppealWindowTest
ReviewDecisionTest
```

### 26.2 Application service test

Mock/fake ports.

```text
ValidateApplicationUseCaseTest
- application not found -> BusinessRejection
- eligible applicant -> VALID
- external eligibility unavailable -> TransientDependencyException
- duplicate idempotency key -> replay result
```

### 26.3 Mapper/contract test

```text
ValidateApplicationJobMapperTest
- missing applicationId -> ContractViolation
- invalid applicantId type -> ContractViolation
- valid variables -> command
- result -> variables
```

### 26.4 Worker adapter test

Test mapping from exception to Camunda action.

```text
ValidateApplicationWorkerTest
- BusinessRejection -> throw BPMN error
- ContractViolation -> fail no retry
- TransientDependency -> fail with retry
- Success -> complete variables
```

### 26.5 Process integration test

Test BPMN path:

```text
- deploy process
- create instance
- worker completes validate task
- BPMN reaches next expected element
- BPMN error path routes to manual review
- incident created for bad contract
```

---

## 27. Configuration Architecture

Worker config harus externalized dan per job type.

Contoh YAML konseptual:

```yaml
camunda:
  client:
    mode: self-managed
    grpc-address: http://zeebe-gateway:26500
    rest-address: http://camunda-api:8080
    auth:
      client-id: ${CAMUNDA_CLIENT_ID}
      client-secret: ${CAMUNDA_CLIENT_SECRET}

worker:
  application-validation:
    enabled: true
    max-jobs-active: 32
    timeout: PT2M
    request-timeout: PT10S
    idempotency:
      ttl: P30D
    dependencies:
      eligibility:
        timeout: PT3S
        max-concurrency: 16
```

Desain config harus menjawab:

- worker mana yang aktif di environment ini?
- concurrency per worker berapa?
- timeout job berapa?
- external timeout berapa?
- retry/backoff policy apa?
- apakah tenant tertentu diaktifkan?
- secret mana yang dipakai?

---

## 28. Deployment Unit Strategy

Arsitektur kode harus sejalan dengan deployment.

### 28.1 Worker app image

Image harus immutable:

```text
registry/acme/application-lifecycle-workers:1.8.3
```

### 28.2 Deployment labels

```text
app=application-lifecycle-workers
component=camunda-worker
bounded-context=application-lifecycle
version=1.8.3
```

### 28.3 Environment variables

```text
CAMUNDA_CLIENT_ID
CAMUNDA_CLIENT_SECRET
CAMUNDA_REST_ADDRESS
CAMUNDA_GRPC_ADDRESS
WORKER_VALIDATE_APPLICATION_ENABLED
WORKER_VALIDATE_APPLICATION_MAX_JOBS_ACTIVE
```

### 28.4 Readiness

Worker readiness tidak cukup hanya “Spring Boot started”. Ia harus mengecek:

- config valid;
- secret tersedia;
- database reachable bila wajib;
- external dependency optional/required jelas;
- Camunda client configured;
- worker registrations successful.

---

## 29. Anti-Patterns

### 29.1 God Worker

```java
@JobWorker(type = "process-everything")
public Map<String, Object> handle(ActivatedJob job) {
    // 800 lines
}
```

Dampak:

- tidak testable;
- tidak observable;
- sulit retry;
- sulit versioning;
- high blast radius.

### 29.2 Domain imports Camunda

```java
import io.camunda.zeebe.client.api.response.ActivatedJob;
```

Jika domain import Camunda, architecture boundary bocor.

### 29.3 Variable string literal everywhere

```java
vars.get("applicationId")
vars.get("applicant_id")
vars.get("applicationID")
```

Dampak: bug runtime.

### 29.4 All variables fetched by default

Worker mengambil semua variable, lalu log semua. Ini buruk untuk performance dan security.

### 29.5 Business rejection as technical retry

Applicant tidak eligible tidak akan berubah hanya karena retry 3 kali.

### 29.6 External API DTO leaks into process variables

Jangan menaruh response vendor mentah ke Zeebe variable.

### 29.7 Worker app owns process flow

Worker tidak boleh membuat flow decision yang seharusnya tampak di BPMN bila decision tersebut business-significant.

### 29.8 No idempotency for side-effect worker

Worker yang mengirim email/payment/external create tanpa idempotency adalah incident waiting to happen.

### 29.9 No versioning

BPMN berubah, worker tidak berubah, lalu incident muncul di production.

---

## 30. Design Review Checklist

Gunakan checklist ini saat review worker design.

### 30.1 Contract

- [ ] Job type jelas dan konsisten.
- [ ] Input variables terdokumentasi.
- [ ] Output variables terdokumentasi.
- [ ] Error codes terdokumentasi.
- [ ] Required/optional field jelas.
- [ ] Contract version strategy jelas.

### 30.2 Boundary

- [ ] Domain tidak import Camunda.
- [ ] Application service tidak menerima `ActivatedJob`.
- [ ] Mapper khusus tersedia.
- [ ] External API DTO tidak bocor ke process variable.
- [ ] Business decision utama ada di domain/use case.

### 30.3 Correctness

- [ ] Worker idempotent.
- [ ] Side effect punya dedup key.
- [ ] DB transaction boundary jelas.
- [ ] Complete job dilakukan setelah durable business state bila critical.
- [ ] Duplicate execution aman.

### 30.4 Error handling

- [ ] Business rejection dipetakan ke BPMN error bila model menangani.
- [ ] Transient dependency dipetakan ke fail/retry.
- [ ] Contract violation tidak diretry membabi buta.
- [ ] Error message aman dari PII.
- [ ] Incident punya troubleshooting info cukup.

### 30.5 Runtime

- [ ] Timeout job masuk akal.
- [ ] External timeout lebih kecil dari job timeout.
- [ ] Max jobs active sesuai downstream capacity.
- [ ] Worker shutdown aman.
- [ ] Heavy job dipisah dari light job bila perlu.

### 30.6 Observability

- [ ] Log punya processInstanceKey/jobKey/jobType.
- [ ] Metrics per job type tersedia.
- [ ] Idempotency hit/conflict termonitor.
- [ ] External dependency latency termonitor.
- [ ] No raw variables in logs.

### 30.7 Security

- [ ] Least privilege secret.
- [ ] Tenant-aware bila multi-tenant.
- [ ] PII minimization.
- [ ] Sensitive output tidak masuk variable bila tidak perlu.
- [ ] Audit record untuk decision penting.

---

## 31. Reference Architecture: Regulatory Validation Worker

Contoh high-level:

```text
BPMN Service Task: application.validation.validate.v1

Input variables:
  applicationId
  applicantId
  validationRequestId
  tenantId

Worker:
  ValidateApplicationWorker

Use case:
  ValidateApplicationUseCase

Ports:
  ApplicationRepository
  EligibilityPort
  DocumentVerificationPort
  AuditPort
  IdempotencyService

Infrastructure:
  OracleApplicationRepository
  HttpEligibilityAdapter
  S3DocumentVerificationAdapter
  JdbcAuditAdapter
  JdbcIdempotencyService

Output variables:
  validationStatus
  validationReasonCodes
  validationDecisionRef
  validationCompletedAt

BPMN errors:
  APPLICATION_NOT_FOUND
  APPLICANT_NOT_ELIGIBLE
  DOCUMENT_INVALID

Technical incidents:
  CONTRACT_VIOLATION
  ELIGIBILITY_API_UNAVAILABLE_AFTER_RETRIES
  IDEMPOTENCY_CONFLICT
```

Mental model:

```text
BPMN decides what step exists.
Worker adapter translates the step.
Use case executes business capability.
Domain protects invariant.
Ports hide infrastructure.
Idempotency protects side effects.
Audit explains the decision.
Camunda moves the process forward.
```

---

## 32. What Top 1% Engineers Notice

Engineer biasa bertanya:

> “Bagaimana cara buat worker?”

Engineer lebih senior bertanya:

> “Apa contract job ini, apa invariant-nya, bagaimana duplicate execution dikendalikan, bagaimana process version berubah tanpa incident, dan bagaimana saya membuktikan keputusan ini 6 bulan kemudian?”

Hal-hal yang diperhatikan engineer kuat:

1. Worker adalah adapter, bukan domain.
2. Job type adalah API contract.
3. Variable map harus segera diubah menjadi typed command.
4. Business rejection bukan technical failure.
5. Retry bukan strategi memperbaiki data buruk.
6. Complete job bukan commit business transaction.
7. Idempotency adalah architecture capability.
8. Operate bagus untuk debugging, tetapi domain audit tetap dibutuhkan.
9. Versioning harus didesain sebelum breaking change pertama.
10. Security boundary harus mengikuti worker capability, bukan cluster-wide trust.
11. Observability harus process-aware.
12. Worker deployment boundary harus mengikuti throughput dan failure isolation.

---

## 33. Latihan Desain

Ambil satu service task dari proses nyata, misalnya:

```text
verify-supporting-documents
```

Jawab:

1. Apa job type finalnya?
2. Apa input variable wajib?
3. Apa output variable?
4. Apa BPMN error code?
5. Apa technical failure yang retryable?
6. Apa technical failure yang non-retryable?
7. Apa idempotency key?
8. Apa side effect eksternal?
9. Apa domain decision yang harus diaudit?
10. Apakah worker perlu dedicated app atau bisa sharing?
11. Apa timeout job?
12. Apa max jobs active?
13. Apa external dependency timeout?
14. Apa data yang tidak boleh masuk log?
15. Bagaimana contract berubah untuk v2?

Jika Anda bisa menjawab semua ini sebelum coding, Anda sudah mendesain worker sebagai production component, bukan sekadar handler.

---

## 34. Ringkasan

Bagian ini menempatkan worker application sebagai komponen arsitektur yang serius.

Inti pemahaman:

1. Camunda worker adalah inbound adapter dari orchestration engine ke aplikasi bisnis.
2. Domain dan application service harus bebas dari Camunda-specific classes.
3. Process contract harus eksplisit: input, output, error, version.
4. Mapper adalah boundary penting antara dynamic variables dan typed Java code.
5. Idempotency harus menjadi service arsitektural.
6. Error mapping harus membedakan business rejection, transient failure, contract violation, dan non-retryable corruption.
7. Deployment boundary harus mengikuti bounded context, scaling need, dependency, dan blast radius.
8. Observability harus selalu membawa process/job metadata.
9. Security dan tenant boundary harus diterapkan di worker, bukan diasumsikan oleh BPMN.
10. Untuk regulatory/case management, worker harus menghasilkan audit trail yang menjelaskan keputusan, bukan hanya menggerakkan token BPMN.

Dengan arsitektur seperti ini, aplikasi worker akan tetap sehat ketika:

- proses bertambah banyak;
- job type berubah;
- Camunda client berevolusi;
- BPMN version naik;
- worker di-scale horizontal;
- external system lambat/gagal;
- auditor meminta bukti keputusan;
- team member baru harus memahami codebase.

---

## 35. Koneksi ke Part Berikutnya

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-016.md
```

Judul:

```text
Part 016 — Connectors, Integration Patterns, and When Java Workers Are Still Better
```

Kita akan membahas kapan memakai Camunda Connectors, kapan memakai custom Java worker, kapan hybrid, dan bagaimana membuat keputusan integration architecture yang tidak sekadar mengikuti hype low-code/no-code.

---

## Status Seri

Seri belum selesai. Kita baru menyelesaikan:

```text
Part 015 / 035
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-014.md">⬅️ Part 014 — Spring Boot Integration: Camunda Spring Boot Starter, Workers, Configuration, Profiles, and Testing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-016.md">Part 016 — Connectors, Integration Patterns, and When Java Workers Are Still Better ➡️</a>
</div>
