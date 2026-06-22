# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 19 — Spring Boot + Camunda 8 Process Application Architecture

> Seri: **Java BPMN, Camunda, Process Orchestration Engineering**  
> Level: **Advanced / Production Architecture**  
> Fokus: **Spring Boot + Camunda 8 application architecture, worker topology, process boundary, reliability, security, observability, and Java 8–25 design considerations**

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 18, kita sudah membangun fondasi berikut:

1. BPMN bukan gambar, tetapi kontrak eksekusi.
2. Camunda 8 bukan embedded library seperti Camunda 7, tetapi orchestration cluster.
3. Zeebe menjalankan process state, sedangkan Java worker menjalankan business capability.
4. Worker harus idempotent karena job delivery secara praktis perlu diasumsikan at-least-once.
5. Process variable adalah data kontrak proses, bukan database domain.
6. Human workflow, DMN, message correlation, timer, parallelism, subprocess, saga, dan compensation sudah dipahami sebagai runtime pattern.

Part ini menjawab pertanyaan yang sangat praktis:

> Kalau saya membuat aplikasi Java/Spring Boot yang memakai Camunda 8, arsitektur aplikasinya harus seperti apa agar tidak berubah menjadi worker monolith, distributed spaghetti, atau sistem yang sulit di-debug saat production incident?

Camunda 8 menyediakan engine orchestration, API, client, Tasklist, Operate, Identity, Connectors, dan komponen pendukung. Tetapi kualitas sistem tetap sangat bergantung pada **arsitektur process application** yang kita bangun di sekitar engine.

Di level top engineer, pertanyaannya bukan lagi:

```text
Bagaimana cara membuat @JobWorker?
```

Tetapi:

```text
Apa boundary process application?
Apa yang menjadi tanggung jawab Camunda dan apa yang tetap menjadi tanggung jawab service domain?
Bagaimana worker di-scale, diamankan, dipantau, dan dipulihkan?
Bagaimana command, variable, event, idempotency, retry, audit, dan deployment versioning dirancang sejak awal?
```

---

## 1. Mental Model Utama: Process Application Bukan Sekadar Spring Boot App yang Punya Worker

Dalam Camunda 8, Spring Boot app biasanya menjalankan satu atau beberapa peran berikut:

1. **Process starter**  
   Menerima request/domain event lalu membuat process instance.

2. **Job worker host**  
   Menjalankan business logic untuk service task BPMN.

3. **Message publisher/correlator**  
   Mengirim message ke process instance yang sedang menunggu.

4. **Task backend**  
   Menyediakan API aplikasi untuk human task UI, claim/complete, form data, validation, dan authorization.

5. **Domain service**  
   Mengelola entity domain, transaction, invariant, permission, dan audit domain.

6. **Integration adapter**  
   Memanggil sistem eksternal seperti REST API, messaging system, file service, payment gateway, email service, atau registry pemerintah.

7. **Process observability contributor**  
   Menghasilkan log, metric, trace, dan business audit event yang menghubungkan process instance dengan domain entity.

Masalahnya: banyak project mencampur semua peran ini secara tidak disiplin dalam satu class `SomeWorker`. Hasilnya:

```text
BPMN service task
  -> @JobWorker
      -> parse variable
      -> validate business rule
      -> update DB
      -> call external API
      -> send email
      -> decide next path
      -> write audit
      -> publish event
      -> complete job
```

Ini terlihat cepat di awal, tetapi berbahaya karena worker menjadi:

- transaction boundary yang tidak jelas,
- domain service tersembunyi,
- integration adapter tersembunyi,
- audit producer tersembunyi,
- decision engine tersembunyi,
- dan compensation boundary yang tidak eksplisit.

Mental model yang lebih sehat:

```text
BPMN Model
  = orchestration contract

Camunda 8 / Zeebe
  = process state coordinator

Spring Boot Process Application
  = process-facing application layer

Domain Service
  = business invariant owner

Worker
  = adapter from Camunda job to application use case

Repository / External Gateway / Outbox / Audit
  = infrastructure behind application use case
```

Worker bukan tempat utama business architecture. Worker hanyalah **inbound adapter**.

---

## 2. Layered Architecture Untuk Spring Boot + Camunda 8

Arsitektur yang direkomendasikan bisa memakai gaya hexagonal/clean architecture, tetapi tidak perlu over-engineered. Yang penting adalah pemisahan responsibility.

```text
┌─────────────────────────────────────────────────────────────────────┐
│                            BPMN Process                              │
│  service task, user task, message event, timer, business rule task    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ job / message / task API
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Spring Boot Process Application                    │
│                                                                     │
│  inbound adapters:                                                   │
│    - Camunda job workers                                             │
│    - REST controllers for process start / task UI                    │
│    - message listeners / webhook handlers                            │
│                                                                     │
│  application layer:                                                  │
│    - use cases                                                       │
│    - command handlers                                                │
│    - idempotency boundary                                            │
│    - transaction script / orchestration local step                   │
│                                                                     │
│  domain layer:                                                       │
│    - aggregates/entities                                             │
│    - domain policies/invariants                                      │
│    - domain events                                                   │
│                                                                     │
│  outbound adapters:                                                  │
│    - repositories                                                    │
│    - external REST clients                                           │
│    - message producers                                               │
│    - document store                                                  │
│    - email/SMS gateway                                               │
│    - audit writer                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 Recommended Package Structure

Contoh struktur untuk process application regulatory licensing:

```text
com.acme.licensing
  ├── LicensingProcessApplication.java
  │
  ├── process
  │   ├── bpmn
  │   │   ├── ProcessDefinitionKeys.java
  │   │   ├── JobTypes.java
  │   │   ├── MessageNames.java
  │   │   ├── VariableNames.java
  │   │   └── ErrorCodes.java
  │   │
  │   ├── worker
  │   │   ├── ValidateApplicationWorker.java
  │   │   ├── GenerateAssessmentWorker.java
  │   │   ├── NotifyApplicantWorker.java
  │   │   └── RegisterLicenceWorker.java
  │   │
  │   ├── starter
  │   │   └── LicensingProcessStarter.java
  │   │
  │   ├── message
  │   │   ├── PaymentConfirmedMessagePublisher.java
  │   │   └── AgencyResponseMessagePublisher.java
  │   │
  │   ├── task
  │   │   ├── TaskQueryController.java
  │   │   ├── TaskCompletionController.java
  │   │   ├── TaskAuthorizationService.java
  │   │   └── TaskFormAssembler.java
  │   │
  │   └── variable
  │       ├── ApplicationReviewVariables.java
  │       ├── PaymentVariables.java
  │       ├── OfficerDecisionVariables.java
  │       └── VariableMapper.java
  │
  ├── application
  │   ├── command
  │   │   ├── ValidateApplicationCommand.java
  │   │   ├── GenerateAssessmentCommand.java
  │   │   └── CompleteOfficerReviewCommand.java
  │   │
  │   ├── handler
  │   │   ├── ValidateApplicationHandler.java
  │   │   ├── GenerateAssessmentHandler.java
  │   │   └── CompleteOfficerReviewHandler.java
  │   │
  │   ├── idempotency
  │   │   ├── IdempotencyService.java
  │   │   ├── CommandDedupRepository.java
  │   │   └── ProcessCommandKey.java
  │   │
  │   └── audit
  │       ├── BusinessAuditService.java
  │       └── AuditEventFactory.java
  │
  ├── domain
  │   ├── application
  │   │   ├── LicenceApplication.java
  │   │   ├── ApplicationStatus.java
  │   │   └── ApplicationPolicy.java
  │   │
  │   ├── assessment
  │   │   ├── Assessment.java
  │   │   └── AssessmentResult.java
  │   │
  │   └── event
  │       ├── ApplicationValidated.java
  │       └── LicenceIssued.java
  │
  ├── infrastructure
  │   ├── persistence
  │   ├── external
  │   ├── messaging
  │   ├── outbox
  │   ├── document
  │   └── security
  │
  └── observability
      ├── ProcessCorrelation.java
      ├── MetricsRecorder.java
      └── LoggingContext.java
```

### 2.2 Kenapa Constants Untuk BPMN Contract Penting?

BPMN model berisi string seperti:

```text
process id
job type
message name
error code
variable name
candidate group
form id
```

String ini adalah kontrak lintas artifact:

```text
BPMN XML <-> Java worker <-> Task UI <-> test <-> monitoring <-> runbook
```

Kalau semua ditulis manual sebagai string literal, bug-nya sering halus:

```java
@JobWorker(type = "validate-aplication") // typo
```

BPMN memakai:

```text
validate-application
```

Akibatnya job tidak pernah diambil worker. Dari sisi operator, process tampak stuck.

Pola yang lebih baik:

```java
public final class JobTypes {
    private JobTypes() {}

    public static final String VALIDATE_APPLICATION = "validate-application";
    public static final String GENERATE_ASSESSMENT = "generate-assessment";
    public static final String NOTIFY_APPLICANT = "notify-applicant";
    public static final String REGISTER_LICENCE = "register-licence";
}
```

Lalu:

```java
@JobWorker(type = JobTypes.VALIDATE_APPLICATION)
public Map<String, Object> validateApplication(JobClient client, ActivatedJob job) {
    ...
}
```

Untuk project besar, constants saja belum cukup. Kita butuh **contract test** yang membaca BPMN XML dan memastikan semua `taskDefinition type` memiliki worker atau sengaja connector/external capability.

---

## 3. Process Application Boundary

Kesalahan paling umum adalah menganggap satu process = satu microservice. Ini tidak selalu benar.

Process application boundary harus mempertimbangkan:

1. **Business ownership**  
   Siapa pemilik proses dan perubahan policy?

2. **Runtime lifecycle**  
   Apakah worker harus deploy bersama domain service?

3. **Data ownership**  
   Entity domain mana yang dimiliki aplikasi?

4. **Operational responsibility**  
   Tim mana yang akan menerima alert saat worker gagal?

5. **Change frequency**  
   BPMN sering berubah? Worker sering berubah? UI task sering berubah?

6. **Security boundary**  
   Apakah task/action punya permission domain yang kompleks?

7. **Throughput profile**  
   Apakah job volume tinggi atau human workflow rendah-volume?

### 3.1 Boundary Option A — Monolithic Process Application

```text
licensing-process-app
  - starts processes
  - hosts all workers
  - serves task UI API
  - owns licensing DB
  - calls all external systems
```

Cocok untuk:

- team kecil,
- domain masih satu bounded context,
- proses belum terlalu banyak,
- dependency eksternal terbatas,
- butuh delivery cepat.

Risiko:

- semua worker scale bersama,
- coupling meningkat,
- satu deployment mempengaruhi seluruh process landscape,
- sulit memisahkan ownership.

### 3.2 Boundary Option B — Process App + Domain Services

```text
licensing-orchestrator-app
  - starts/correlates processes
  - hosts orchestration-facing workers
  - calls domain services

application-service
payment-service
document-service
notification-service
```

Cocok untuk:

- enterprise platform,
- banyak bounded context,
- domain service sudah ada,
- process melakukan orchestration lintas sistem.

Risiko:

- distributed failure meningkat,
- idempotency harus sangat disiplin,
- observability wajib matang,
- jangan sampai orchestration app menjadi god service.

### 3.3 Boundary Option C — Distributed Worker Apps Per Capability

```text
application-worker-app
payment-worker-app
document-worker-app
notification-worker-app
```

Cocok untuk:

- high-scale service task,
- ownership per team,
- capability reusable lintas proses,
- deployment independen.

Risiko:

- governance job type lebih sulit,
- tracing lintas worker wajib,
- version compatibility lebih kompleks,
- incident ownership harus jelas.

### 3.4 Rekomendasi Praktis

Untuk sistem regulatory/case management besar, pola yang sering sehat adalah:

```text
1 process orchestrator app per major domain/process family
+ worker capability split hanya jika volume/ownership menuntut
+ domain service tetap menjadi owner invariant/data
+ task UI backend dekat dengan domain authorization
```

Jangan memecah worker hanya karena ingin terlihat microservices. Pecah ketika ada alasan nyata:

- scale berbeda,
- ownership berbeda,
- deployment risk berbeda,
- security boundary berbeda,
- dependency footprint berbeda.

---

## 4. Spring Boot Starter vs Manual Java Client

Secara konseptual ada dua pendekatan:

1. **Spring Boot Starter**  
   Integrasi lebih idiomatis dengan Spring, autoconfiguration, annotation worker, properties, lifecycle management.

2. **Manual Camunda Java Client**  
   Kontrol lebih eksplisit atas client creation, lifecycle, worker registration, testing, dan custom runtime behavior.

Camunda Spring Boot Starter modern menggantikan Spring Zeebe SDK mulai 8.8 dan menggunakan Camunda Java Client di bawahnya. Default protocol modern adalah REST, sementara gRPC tetap dapat dikonfigurasi. Ini penting karena banyak blog/code lama masih memakai `spring-zeebe` atau `ZeebeClient` lama.

### 4.1 Kapan Memakai Spring Boot Starter?

Pilih starter ketika:

- aplikasi berbasis Spring Boot,
- ingin autoconfiguration,
- worker cocok dideklarasikan via annotation,
- deployment standard,
- tidak butuh kontrol ekstrim atas lifecycle worker,
- tim ingin convention-over-configuration.

### 4.2 Kapan Memakai Manual Client?

Pilih manual client ketika:

- ingin library non-Spring,
- worker lifecycle sangat custom,
- ingin multi-client/multi-cluster,
- ingin dynamic worker registration,
- ingin abstraksi internal sendiri,
- ingin transisi bertahap dari legacy SDK.

### 4.3 Pitfall Versioning

Jangan menyalin dependency dari tutorial lama tanpa memeriksa versi:

```text
Camunda 8.7 and earlier examples may mention Spring Zeebe SDK.
Camunda 8.8+ direction is Camunda Spring Boot Starter + Camunda Java Client.
Zeebe Java Client is deprecated path toward removal.
```

Prinsip aman:

```text
Gunakan dokumentasi Camunda version yang sama dengan runtime cluster.
Pin dependency version.
Jangan campur Zeebe old client dan Camunda new client tanpa alasan migrasi jelas.
```

---

## 5. Configuration Strategy

Process application harus bisa berjalan di environment berbeda:

```text
local
DEV
SIT
UAT
PREPROD
PROD
```

Perbedaan umum:

- Camunda endpoint,
- auth credentials,
- tenant id,
- worker enabled/disabled,
- max jobs active,
- timeout,
- retry default,
- tasklist/operate API endpoint,
- TLS setting,
- logging level,
- metrics tags,
- deployment mode.

### 5.1 Configuration Principle

Configuration harus menjawab:

```text
Aplikasi ini connect ke cluster mana?
Worker apa yang aktif?
Berapa concurrency-nya?
Apa identity aplikasi ini?
Bagaimana credential di-rotate?
Apa default timeout/backoff?
```

Contoh struktur properties konseptual:

```yaml
camunda:
  client:
    mode: self-managed
    auth:
      client-id: ${CAMUNDA_CLIENT_ID}
      client-secret: ${CAMUNDA_CLIENT_SECRET}
    zeebe:
      enabled: true
      gateway-url: ${CAMUNDA_GATEWAY_URL}
    operate:
      base-url: ${CAMUNDA_OPERATE_URL}
    tasklist:
      base-url: ${CAMUNDA_TASKLIST_URL}

process-app:
  deployment:
    auto-deploy: false
  worker:
    validate-application:
      enabled: true
      max-jobs-active: 16
      timeout: PT2M
      request-timeout: PT30S
    notify-applicant:
      enabled: true
      max-jobs-active: 8
      timeout: PT1M
  idempotency:
    ttl-days: 180
  observability:
    metrics-prefix: licensing_process
```

Catatan: property aktual dapat berubah mengikuti versi starter. Struktur di atas adalah desain konseptual agar jelas dimensi konfigurasinya.

### 5.2 Jangan Auto Deploy BPMN Sembarangan di Production

Auto-deploy BPMN saat app start berguna di local/dev. Tetapi di production, deployment process definition sebaiknya dikendalikan:

- via CI/CD release step,
- dengan approval,
- dengan version tagging,
- dengan compatibility check,
- dengan audit trail deployment,
- dengan rollback/migration plan.

Anti-pattern:

```text
Setiap worker app start otomatis deploy BPMN dari classpath.
```

Risiko:

- process definition berubah tanpa release governance,
- multiple apps deploy version berbeda,
- accidental deployment dari branch salah,
- worker belum compatible dengan BPMN baru,
- running instances sulit dikontrol.

Better pattern:

```text
BPMN deployment pipeline terpisah / eksplisit.
Worker deployment pipeline memastikan compatibility.
```

---

## 6. Process Definition Ownership and Deployment Architecture

Ada tiga pola umum.

### 6.1 BPMN Co-located With Worker App

```text
src/main/resources/bpmn/licensing-review.bpmn
src/main/java/.../ValidateApplicationWorker.java
```

Kelebihan:

- mudah untuk developer,
- BPMN dan worker version dekat,
- testing sederhana.

Kekurangan:

- deployment process tied to app release,
- business modeler collaboration mungkin terbatas,
- multi-app worker compatibility perlu disiplin.

### 6.2 BPMN Repository Terpisah

```text
process-models-repo
  licensing-review.bpmn
  payment-process.bpmn
  approval-subprocess.bpmn

worker-app-repo
  ValidateApplicationWorker.java
```

Kelebihan:

- process governance lebih jelas,
- bisa ada review BPMN khusus,
- modeler/business collaboration lebih mudah.

Kekurangan:

- contract drift antara BPMN dan worker,
- perlu contract testing lintas repo,
- release coordination lebih kompleks.

### 6.3 Hybrid

```text
Canonical BPMN stored in process repo.
Worker app consumes released BPMN artifact for testing.
Deployment pipeline deploys approved BPMN artifact.
```

Ini sering paling matang untuk enterprise.

### 6.4 Contract Artifacts

Setiap process release idealnya menghasilkan:

```text
- BPMN XML
- DMN XML
- form schemas
- process contract manifest
- variable schema
- job type list
- message name list
- error code list
- migration notes
- test scenario pack
```

Contoh manifest:

```yaml
processDefinitionId: licensing-review
version: 2026.06.17-1
jobTypes:
  - validate-application
  - generate-assessment
  - notify-applicant
messages:
  - payment-confirmed
  - agency-response-received
bpmnErrors:
  - APPLICATION_INCOMPLETE
  - PAYMENT_REJECTED
variables:
  input:
    - applicationId
    - applicantId
    - submissionChannel
  output:
    - finalDecision
    - licenceId
compatibility:
  minWorkerVersion: 3.12.0
  variableSchemaVersion: 2
```

---

## 7. Worker as Inbound Adapter

Worker harus tipis.

Bukan berarti worker tidak punya logic sama sekali, tetapi logic worker harus berupa:

- mapping job variables ke command,
- setup correlation/logging context,
- idempotency boundary,
- call application use case,
- classify result menjadi complete/fail/throw BPMN error,
- return process variables.

### 7.1 Bad Worker

```java
@JobWorker(type = "validate-application")
public Map<String, Object> validate(ActivatedJob job) {
    Map<String, Object> vars = job.getVariablesAsMap();

    String applicationId = (String) vars.get("applicationId");

    // loads entity
    ApplicationEntity entity = applicationRepository.findById(applicationId).orElseThrow();

    // complex business rule directly in worker
    if (entity.getDocuments().isEmpty() && entity.getType().equals("SPECIAL")) {
        entity.setStatus("INCOMPLETE");
        applicationRepository.save(entity);
        sendEmail(entity.getApplicantEmail(), "Missing docs");
        return Map.of("isComplete", false);
    }

    // external call directly in worker
    ExternalResult result = externalRegistryClient.check(entity.getCompanyId());

    entity.setRegistryStatus(result.status());
    applicationRepository.save(entity);

    auditRepository.save(...);

    return Map.of("isComplete", true, "registryStatus", result.status());
}
```

Masalah:

- worker terlalu gemuk,
- transaction/side-effect campur,
- sulit unit test,
- sulit reuse,
- error classification tersebar,
- compensation tidak jelas,
- idempotency tidak eksplisit.

### 7.2 Better Worker

```java
@JobWorker(type = JobTypes.VALIDATE_APPLICATION)
public Map<String, Object> validateApplication(ActivatedJob job) {
    ProcessJobContext context = ProcessJobContext.from(job);
    ValidateApplicationCommand command = variableMapper.toValidateApplicationCommand(job);

    ValidateApplicationResult result = idempotencyService.executeOnce(
        ProcessCommandKey.from(job),
        () -> validateApplicationHandler.handle(command, context)
    );

    return variableMapper.toVariables(result);
}
```

Domain logic ada di handler:

```java
@Service
public class ValidateApplicationHandler {

    @Transactional
    public ValidateApplicationResult handle(
        ValidateApplicationCommand command,
        ProcessJobContext context
    ) {
        LicenceApplication application = applicationRepository.getRequired(command.applicationId());

        ValidationOutcome outcome = applicationPolicy.validate(application);

        application.recordValidation(outcome, context.actor());
        applicationRepository.save(application);

        auditService.recordApplicationValidated(application, outcome, context);

        return ValidateApplicationResult.from(outcome);
    }
}
```

Worker menjadi adapter. Handler menjadi application use case.

---

## 8. Command and Result Pattern

Untuk setiap job type, definisikan command dan result.

### 8.1 Command

```java
public record ValidateApplicationCommand(
    String applicationId,
    String processInstanceKey,
    String businessKey,
    int variableSchemaVersion
) {}
```

Command harus:

- immutable,
- typed,
- validatable,
- tidak membawa seluruh process variable map,
- merepresentasikan niat bisnis.

### 8.2 Result

```java
public sealed interface ValidateApplicationResult
    permits ValidateApplicationResult.Complete, ValidateApplicationResult.Incomplete {

    record Complete(String applicationId, String riskLevel) implements ValidateApplicationResult {}

    record Incomplete(String applicationId, List<String> missingDocumentCodes)
        implements ValidateApplicationResult {}
}
```

Untuk Java 8, gunakan class biasa atau enum + POJO. Untuk Java 17+, sealed interface membantu membuat result space eksplisit.

### 8.3 Mapping Result ke BPMN Variables

```java
public Map<String, Object> toVariables(ValidateApplicationResult result) {
    if (result instanceof ValidateApplicationResult.Complete complete) {
        return Map.of(
            "applicationValid", true,
            "riskLevel", complete.riskLevel()
        );
    }

    if (result instanceof ValidateApplicationResult.Incomplete incomplete) {
        return Map.of(
            "applicationValid", false,
            "missingDocumentCodes", incomplete.missingDocumentCodes()
        );
    }

    throw new IllegalStateException("Unknown validation result: " + result);
}
```

Jangan biarkan handler mengembalikan `Map<String,Object>` langsung. Itu membuat domain layer tergantung pada variable contract BPMN.

---

## 9. Job Completion Style

Ada dua gaya umum:

### 9.1 Return Map Dari Annotated Worker

```java
@JobWorker(type = JobTypes.VALIDATE_APPLICATION)
public Map<String, Object> validateApplication(ActivatedJob job) {
    ValidateApplicationResult result = handler.handle(...);
    return mapper.toVariables(result);
}
```

Kelebihan:

- simple,
- idiomatis,
- cocok untuk happy path.

Kekurangan:

- advanced completion/failure control lebih terbatas,
- error handling perlu dipahami sesuai starter behavior.

### 9.2 Explicit JobClient Complete/Fail/Error

```java
@JobWorker(type = JobTypes.VALIDATE_APPLICATION, autoComplete = false)
public void validateApplication(JobClient client, ActivatedJob job) {
    try {
        ValidateApplicationResult result = handler.handle(...);

        client.newCompleteCommand(job.getKey())
            .variables(mapper.toVariables(result))
            .send()
            .join();

    } catch (BusinessException ex) {
        client.newThrowErrorCommand(job.getKey())
            .errorCode(ex.errorCode())
            .errorMessage(ex.getMessage())
            .variables(Map.of("businessErrorMessage", ex.getMessage()))
            .send()
            .join();

    } catch (TransientTechnicalException ex) {
        client.newFailCommand(job.getKey())
            .retries(Math.max(job.getRetries() - 1, 0))
            .errorMessage(ex.getMessage())
            .retryBackoff(Duration.ofSeconds(30))
            .send()
            .join();
    }
}
```

Kelebihan:

- explicit control,
- mudah bedakan BPMN error vs technical fail,
- cocok untuk worker kritikal.

Kekurangan:

- lebih banyak boilerplate,
- perlu hati-hati agar tidak double complete,
- perlu standard wrapper.

### 9.3 Rekomendasi

Untuk production enterprise, buat wrapper/helper agar worker tidak copy-paste error handling.

```java
processJobExecutor.execute(job, client,
    JobTypes.VALIDATE_APPLICATION,
    ValidateApplicationCommand.class,
    command -> handler.handle(command),
    result -> mapper.toVariables(result)
);
```

Tujuannya:

- standard logging,
- standard metrics,
- standard idempotency,
- standard error classification,
- standard fail/throw/complete behavior.

---

## 10. Idempotency Boundary in Spring Boot

Idempotency tidak boleh hanya menjadi catatan konseptual. Harus ada implementasi eksplisit.

### 10.1 Idempotency Key Untuk Job Worker

Candidate key:

```text
processDefinitionId
processInstanceKey
elementId
elementInstanceKey
jobType
businessEntityId
commandVersion
```

Contoh:

```java
public record ProcessCommandKey(
    String processDefinitionId,
    long processInstanceKey,
    String elementId,
    long elementInstanceKey,
    String jobType,
    String businessEntityId,
    int commandVersion
) {
    public static ProcessCommandKey from(ActivatedJob job, String businessEntityId) {
        return new ProcessCommandKey(
            job.getBpmnProcessId(),
            job.getProcessInstanceKey(),
            job.getElementId(),
            job.getElementInstanceKey(),
            job.getType(),
            businessEntityId,
            1
        );
    }
}
```

### 10.2 Dedup Table

```sql
CREATE TABLE process_command_dedup (
    idempotency_key        VARCHAR(300) PRIMARY KEY,
    process_instance_key   BIGINT NOT NULL,
    element_instance_key   BIGINT NOT NULL,
    job_type               VARCHAR(150) NOT NULL,
    business_entity_id     VARCHAR(150),
    status                 VARCHAR(30) NOT NULL,
    result_json            CLOB,
    error_code             VARCHAR(100),
    created_at             TIMESTAMP NOT NULL,
    updated_at             TIMESTAMP NOT NULL
);
```

Status:

```text
STARTED
COMPLETED
FAILED_BUSINESS
FAILED_TECHNICAL
UNKNOWN_SIDE_EFFECT
```

### 10.3 Execute Once Pattern

```java
public <T> T executeOnce(ProcessCommandKey key, Supplier<T> action, Class<T> resultType) {
    Optional<StoredCommandResult> existing = repository.findCompleted(key);
    if (existing.isPresent()) {
        return deserialize(existing.get().resultJson(), resultType);
    }

    try {
        repository.insertStarted(key);
        T result = action.get();
        repository.markCompleted(key, serialize(result));
        return result;
    } catch (DuplicateKeyException duplicate) {
        StoredCommandResult stored = repository.waitAndRead(key);
        return deserialize(stored.resultJson(), resultType);
    } catch (RuntimeException ex) {
        repository.markFailed(key, classify(ex));
        throw ex;
    }
}
```

Real implementation perlu lebih hati-hati untuk race condition, transaction isolation, unknown side effect, dan partial failure. Tetapi pattern ini menunjukkan boundary-nya.

### 10.4 Idempotency Bukan Hanya DB Dedup

Idempotency juga perlu di external call:

```text
Payment API       -> idempotency key header
Document service  -> document generation request id
Email service     -> notification request id
Registry update   -> command id/correlation id
Message broker    -> event id
```

Kalau external system tidak mendukung idempotency key, gunakan local table untuk mencegah repeat call, atau buat reconciliation flow.

---

## 11. Transaction Handling

Dalam Camunda 8, worker app dan engine tidak berada dalam satu local ACID transaction.

Artinya ini bukan atomic:

```text
update local DB
complete Camunda job
```

Ada failure window:

```text
1. Worker update DB berhasil.
2. Worker crash sebelum complete job.
3. Job timeout.
4. Camunda memberikan job ke worker lain.
5. Worker kedua menjalankan side effect lagi jika tidak idempotent.
```

Karena itu setiap worker step harus diperlakukan seperti distributed transaction participant.

### 11.1 Local Transaction Scope

Yang boleh ada dalam satu `@Transactional`:

```text
- load aggregate
- validate invariant
- update local DB
- insert audit event
- insert outbox event
- update idempotency record
```

Yang sebaiknya tidak sembarang dicampur dalam transaction DB:

```text
- long external API call
- complete Camunda job
- send email directly
- publish Kafka directly without outbox
- upload large file directly
```

### 11.2 Pattern A — DB First, Then Complete Job

```text
worker receives job
  -> transaction: update DB + dedup result
  -> complete Camunda job
```

Failure:

```text
DB committed, complete job failed.
```

Mitigation:

- idempotency returns stored result on retry,
- retry worker completes job again,
- no duplicate side effect.

### 11.3 Pattern B — External Call With Idempotency, Then DB, Then Complete

```text
worker receives job
  -> call external API with idempotency key
  -> transaction: store external result + dedup result
  -> complete Camunda job
```

Failure:

```text
external call succeeded, worker crashed before DB store.
```

Mitigation:

- external idempotency key,
- query external status on retry,
- reconciliation path.

### 11.4 Pattern C — Outbox for External Side Effect

```text
worker receives job
  -> transaction: update DB + write outbox command
  -> complete Camunda job
  -> outbox publisher sends external request
  -> external response correlates message to process
```

Cocok jika side effect bisa dibuat asynchronous. Ini sering lebih robust untuk email, notification, document generation, external agency request.

---

## 12. Worker Topology

### 12.1 One App Hosting Many Workers

```text
licensing-worker-app
  - validate-application
  - generate-assessment
  - notify-applicant
  - register-licence
```

Kelebihan:

- simple deployment,
- shared config,
- easier local dev,
- good for moderate volume.

Kekurangan:

- noisy worker bisa mengganggu worker lain,
- scale all together,
- dependency bloat,
- blast radius besar.

### 12.2 One Worker App Per Capability

```text
validation-worker-app
assessment-worker-app
notification-worker-app
licence-registry-worker-app
```

Kelebihan:

- scale per capability,
- clearer ownership,
- smaller dependency set,
- smaller blast radius.

Kekurangan:

- more deployment units,
- more configuration,
- more observability complexity,
- more version coordination.

### 12.3 Worker Grouping Heuristic

Kelompokkan worker berdasarkan:

```text
same domain data owner
same scaling profile
same dependency profile
same operational owner
same security requirement
same release cadence
```

Jangan kelompokkan berdasarkan:

```text
same BPMN diagram only
same developer convenience only
random package structure
```

### 12.4 Example Regulatory Worker Split

```text
licensing-core-worker-app
  - validate-application
  - calculate-risk-level
  - persist-officer-decision

licensing-document-worker-app
  - generate-acknowledgement-letter
  - generate-licence-certificate
  - archive-case-documents

licensing-notification-worker-app
  - notify-applicant
  - notify-officer
  - notify-agency

licensing-integration-worker-app
  - check-company-registry
  - check-payment-status
  - send-external-agency-request
```

This split makes sense if dependencies and ownership really differ. If not, start simpler.

---

## 13. Worker Concurrency and Throughput Control

Worker concurrency is not just a performance setting. It is a correctness setting.

Important dimensions:

```text
max jobs active
job timeout
request timeout
polling/streaming behavior
thread pool size
connection pool size
external API rate limit
DB transaction capacity
idempotency lock contention
```

### 13.1 Capacity Chain

For each worker:

```text
Camunda job activation rate
  -> worker execution concurrency
      -> DB pool
          -> external API capacity
              -> downstream SLA
```

If `maxJobsActive = 100`, but DB connection pool = 10 and external API limit = 20/minute, the worker can create self-inflicted incidents.

### 13.2 Worker Settings Should Reflect Bottleneck

Example:

```yaml
process-app:
  worker:
    check-company-registry:
      max-jobs-active: 5
      timeout: PT3M
      downstream-rate-limit-per-minute: 60
    notify-applicant:
      max-jobs-active: 20
      timeout: PT1M
    generate-certificate:
      max-jobs-active: 3
      timeout: PT10M
```

### 13.3 Job Timeout Rule

Job timeout should be:

```text
greater than p99 normal execution time
less than unacceptable stuck duration
aligned with external timeout/retry budget
```

Too short:

- duplicate execution,
- timeout while still processing,
- conflicting side effects.

Too long:

- slow failure recovery,
- stuck jobs remain invisible too long,
- incident detection delayed.

### 13.4 Virtual Threads in Java 21+

Virtual threads can help if worker logic blocks on IO. But they do not remove downstream limits.

Virtual threads help with:

```text
many blocking REST calls
many waiting DB calls
simpler imperative code
```

Virtual threads do not solve:

```text
rate limit
idempotency
transaction isolation
external API correctness
job timeout
business compensation
```

For Java 8/11/17, use bounded executor/thread pool. For Java 21/25, virtual threads can simplify high-concurrency IO workers, but still apply explicit bulkhead and rate limit.

---

## 14. Security Architecture

Spring Boot process app needs at least four security dimensions.

### 14.1 Camunda Client Authentication

The app authenticates to Camunda cluster using credentials suitable for:

```text
- deploy process
- start process
- activate jobs
- complete jobs
- publish messages
- query tasks/operate if needed
```

Do not reuse human/admin credentials for worker apps.

Use:

- machine-to-machine identity,
- least privilege,
- secret manager,
- rotation,
- separate credentials per app/environment,
- audit for privileged operations.

### 14.2 Human Task Authorization

Do not rely only on candidate group stored in BPMN.

The backend completing a human task must check:

```text
- authenticated user
- role/group
- task visibility
- domain object permission
- action permission
- maker-checker rule
- assignment/claim status
- stale task status
- process status
```

Example:

```java
public void completeOfficerReview(String taskId, CompleteReviewRequest request, UserPrincipal user) {
    Task task = taskClient.getTask(taskId);

    authorizationService.assertCanComplete(task, user);

    LicenceApplication application = applicationRepository.getRequired(request.applicationId());
    authorizationService.assertCanDecide(application, user);
    makerCheckerPolicy.assertNotSameMaker(application, user);

    taskClient.complete(taskId, variablesFrom(request));
}
```

### 14.3 Variable Data Protection

Do not put unnecessary sensitive data into process variables.

Prefer:

```text
applicationId
applicantId
caseId
documentId
riskLevel
decisionCode
```

Avoid unless absolutely necessary:

```text
full address
ID number
bank account
medical data
full document content
raw payload from external system
```

For sensitive data:

- store in domain DB/document store,
- reference by ID,
- apply authorization there,
- avoid exposing via Operate/Tasklist to broad users,
- sanitize logs.

### 14.4 Worker Impersonation and Message Replay

Inbound webhooks or message listeners that publish Camunda messages must validate:

```text
signature
source identity
timestamp
nonce/event id
correlation key ownership
payload schema
business status transition
```

Otherwise attacker or buggy system can progress process instance incorrectly.

---

## 15. Task UI Backend Architecture

For enterprise apps, Tasklist can be used directly in some scenarios, but many regulatory/case-management systems need custom UI/backend because:

- domain authorization is complex,
- task form needs domain data,
- data entry has draft lifecycle,
- completion triggers validation,
- maker-checker rule is domain-specific,
- audit requirements are stricter,
- UI must merge task data with case/application data.

### 15.1 Recommended Flow

```text
Officer opens worklist
  -> backend queries tasks visible to user/group
  -> backend enriches with domain data
  -> UI shows task list

Officer opens task
  -> backend loads task metadata
  -> backend loads domain entity
  -> backend checks permission
  -> backend returns form view model

Officer saves draft
  -> backend saves draft to domain DB
  -> task not completed

Officer submits
  -> backend validates domain command
  -> backend writes decision/audit in DB
  -> backend completes Camunda user task with minimal variables
```

### 15.2 Task Completion Is a Command

Bad:

```http
POST /camunda/tasks/{taskId}/complete
{
  "approved": true,
  "remarks": "ok"
}
```

Better:

```http
POST /applications/{applicationId}/officer-review/submit
{
  "taskId": "...",
  "decision": "APPROVE",
  "reasonCode": "MEETS_REQUIREMENTS",
  "remarks": "All documents verified"
}
```

The endpoint is domain-oriented. It completes the task internally after domain validation.

### 15.3 Stale Task Protection

Before completing task:

```text
- task still exists
- task belongs to expected process instance
- task definition key matches expected step
- task assigned/claimable by current user
- application status still expects this task
- request version matches current entity version
```

This prevents users from completing outdated browser sessions.

---

## 16. Process Start Architecture

A process can be started by:

```text
REST command
message start event
scheduled timer
domain event
admin operation
migration/recovery script
```

### 16.1 Start Process From REST Command

Example:

```text
POST /applications/{id}/submit
  -> validate submit command
  -> update application status SUBMITTED
  -> start process instance licensing-review
  -> store processInstanceKey on application
```

Failure window:

```text
DB submitted, process start failed.
```

Mitigation:

- outbox command to start process,
- retryable process start dispatcher,
- unique business key/idempotency.

### 16.2 Start Process Via Outbox

```text
submit transaction:
  - update application status
  - insert outbox PROCESS_START_REQUESTED

outbox dispatcher:
  - starts Camunda process with business key/applicationId
  - stores processInstanceKey
  - marks outbox sent
```

This is robust when process start must be consistent with domain commit.

### 16.3 Duplicate Start Prevention

Use local uniqueness:

```sql
CREATE UNIQUE INDEX ux_application_process
ON application_process_link(application_id, process_definition_id, active_flag);
```

And process variables:

```json
{
  "applicationId": "APP-2026-0001",
  "businessKey": "APP-2026-0001",
  "startCommandId": "SUBMIT-APP-2026-0001-v3"
}
```

If message start event supports idempotency by correlation key in the chosen model, still keep domain-level duplicate prevention.

---

## 17. Message Publisher / Correlator Architecture

Process applications often receive external events:

```text
payment confirmed
payment rejected
external agency response
document uploaded
applicant resubmitted
appeal submitted
case reopened
```

A healthy architecture does not publish messages directly from controllers without validation/dedup.

### 17.1 Inbound Event Table

```sql
CREATE TABLE inbound_process_event (
    event_id             VARCHAR(150) PRIMARY KEY,
    event_type           VARCHAR(100) NOT NULL,
    correlation_key      VARCHAR(150) NOT NULL,
    payload_json         CLOB NOT NULL,
    status               VARCHAR(30) NOT NULL,
    received_at          TIMESTAMP NOT NULL,
    processed_at         TIMESTAMP NULL,
    process_instance_key BIGINT NULL,
    error_message        VARCHAR(1000)
);
```

Statuses:

```text
RECEIVED
VALIDATED
CORRELATED
IGNORED_DUPLICATE
IGNORED_STALE
FAILED_RETRYABLE
FAILED_PERMANENT
```

### 17.2 Correlation Flow

```text
receive external event
  -> authenticate source
  -> validate schema
  -> deduplicate event_id
  -> map to message name + correlation key
  -> publish Camunda message with TTL
  -> update inbound event status
```

### 17.3 Correlation Is Not Business Validation

Message correlation only tells Camunda:

```text
A process instance waiting for this message can continue.
```

It does not prove:

```text
this event is business valid
this user was authorized
this payload is fresh
this state transition is legal
```

That validation belongs in application/domain layer before publishing the message, or in the worker immediately after message continuation, depending on design.

---

## 18. Variable Mapping Architecture

Do not scatter variable parsing across workers.

Bad:

```java
String applicationId = (String) job.getVariablesAsMap().get("applicationId");
Boolean approved = (Boolean) job.getVariablesAsMap().get("approved");
```

Better:

```java
@Component
public class LicensingVariableMapper {

    public ValidateApplicationCommand toValidateApplicationCommand(ActivatedJob job) {
        ApplicationReviewVariables vars = job.getVariablesAsType(ApplicationReviewVariables.class);
        return new ValidateApplicationCommand(
            vars.applicationId(),
            String.valueOf(job.getProcessInstanceKey()),
            vars.businessKey(),
            vars.schemaVersion()
        );
    }

    public Map<String, Object> fromValidationResult(ValidateApplicationResult result) {
        ...
    }
}
```

### 18.1 Variable DTO Principles

```java
public record ApplicationReviewVariables(
    int schemaVersion,
    String applicationId,
    String applicantId,
    String businessKey,
    String submissionChannel,
    String riskLevel,
    Boolean applicationValid,
    List<String> missingDocumentCodes
) {}
```

Rules:

- include schema version,
- use stable names,
- avoid storing large nested domain objects,
- use nullable intentionally,
- map to command explicitly,
- validate required fields.

### 18.2 Variable Validation

If required variable missing:

```text
technical failure or incident?
```

Usually this is technical/model contract failure, not BPMN business error.

Example:

```java
if (vars.applicationId() == null || vars.applicationId().isBlank()) {
    throw new ProcessContractException("Missing required variable applicationId");
}
```

Then worker wrapper should fail job with retry maybe 0 depending classification. Missing required variable is often non-retryable until repaired.

---

## 19. Error Classification Architecture

Every worker should classify exceptions into:

```text
Business BPMN error
Retryable technical failure
Non-retryable technical failure / incident
Security violation
Process contract violation
Unknown side-effect ambiguity
```

### 19.1 Exception Types

```java
public sealed class WorkerExecutionException extends RuntimeException
    permits BusinessBpmnException,
            RetryableTechnicalException,
            NonRetryableTechnicalException,
            ProcessContractException,
            SecurityProcessException,
            UnknownSideEffectException {
    ...
}
```

For Java 8, use class hierarchy without sealed classes.

### 19.2 Mapping Matrix

| Exception Type | Camunda Action | Reason |
|---|---:|---|
| BusinessBpmnException | throw BPMN error | Process has modeled business path |
| RetryableTechnicalException | fail job with retries/backoff | Temporary failure expected to recover |
| NonRetryableTechnicalException | fail job retries 0 | Requires operator repair |
| ProcessContractException | fail job retries 0 | BPMN/variable/app version mismatch |
| SecurityProcessException | fail job retries 0 + alert | Potential abuse/config issue |
| UnknownSideEffectException | fail job retries 0 + reconciliation | Unsafe to retry blindly |

### 19.3 Worker Executor Wrapper

```java
public final class ProcessJobExecutor {

    public <C, R> void execute(
        JobClient client,
        ActivatedJob job,
        Class<C> commandType,
        Function<ActivatedJob, C> commandMapper,
        Function<C, R> handler,
        Function<R, Map<String, Object>> resultMapper
    ) {
        try {
            ProcessLoggingContext.put(job);

            C command = commandMapper.apply(job);
            R result = handler.apply(command);
            Map<String, Object> variables = resultMapper.apply(result);

            client.newCompleteCommand(job.getKey())
                .variables(variables)
                .send()
                .join();

        } catch (BusinessBpmnException ex) {
            throwBpmnError(client, job, ex);
        } catch (RetryableTechnicalException ex) {
            failWithRetry(client, job, ex);
        } catch (ProcessContractException ex) {
            failNoRetry(client, job, ex);
        } finally {
            ProcessLoggingContext.clear();
        }
    }
}
```

---

## 20. Observability Architecture

A process application without observability is operational debt.

### 20.1 Correlation Fields

Every log related to job processing should include:

```text
processDefinitionId
processInstanceKey
elementId
elementInstanceKey
jobKey
jobType
businessKey
businessEntityId
correlationId
idempotencyKey
attempt/retries
```

Example MDC:

```java
MDC.put("processInstanceKey", String.valueOf(job.getProcessInstanceKey()));
MDC.put("elementInstanceKey", String.valueOf(job.getElementInstanceKey()));
MDC.put("jobKey", String.valueOf(job.getKey()));
MDC.put("jobType", job.getType());
MDC.put("businessKey", businessKey);
```

### 20.2 Metrics

Worker metrics:

```text
jobs activated
jobs completed
jobs failed
jobs thrown as BPMN error
job duration p50/p95/p99
external call duration
idempotency duplicate count
retry count
incident-producing failures
```

Business process metrics:

```text
process started
process completed
process cancelled
SLA breached
task aging
approval duration
rework count
manual repair count
```

### 20.3 Tracing

Trace should connect:

```text
REST request / message event
  -> process start / message publish
  -> job worker execution
  -> domain DB update
  -> external API call
  -> outbox event
```

Camunda process instance key and business key should be added as span attributes where possible.

### 20.4 Audit vs Log

Do not confuse log with audit.

Log:

```text
technical diagnostic, may be rotated, noisy, not business-certified
```

Audit:

```text
business/legal record, structured, retained, queryable, defensible
```

Worker may emit both, but audit should be written through explicit audit service.

---

## 21. Health Checks and Readiness

A Spring Boot process app should expose health/readiness for:

```text
Camunda connectivity
DB connectivity
external critical dependency
worker registration state
outbox backlog
inbound event backlog
```

But be careful: health check should not overload Camunda or external systems.

### 21.1 Liveness vs Readiness

Liveness:

```text
Is this JVM alive and not deadlocked?
```

Readiness:

```text
Can this instance safely receive traffic / activate jobs?
```

If Camunda is temporarily unreachable, you may mark readiness down so Kubernetes stops routing HTTP traffic, but worker activation behavior must be understood. For worker-only apps, readiness can control rollout, but jobs are pulled by worker itself.

### 21.2 Graceful Shutdown

On shutdown:

```text
stop accepting new HTTP requests
stop activating new jobs
let in-flight jobs complete within grace period
fail/let timeout for unfinished jobs depending safety
flush logs/metrics
close client
```

Do not kill worker immediately while it holds activated jobs unless idempotency is rock-solid.

---

## 22. Deployment Topology

### 22.1 Local Development

```text
developer machine
  - Camunda 8 Run / local environment
  - Spring Boot app
  - local DB/Testcontainers
```

Goal:

- rapid feedback,
- model deployment,
- simple worker testing.

### 22.2 DEV/SIT/UAT

```text
Kubernetes namespace
  - process app pods
  - domain DB
  - Camunda 8 cluster or shared env
  - observability stack
```

Important:

- environment-specific credentials,
- test data isolation,
- clear process cleanup strategy,
- ability to inspect Operate/Tasklist.

### 22.3 Production

```text
multiple replicas
pod disruption budget
resource requests/limits
secret rotation
network policy
audit logging
metric alerts
runbooks
release approval
```

Worker app deployment must be coordinated with BPMN version compatibility.

---

## 23. CI/CD Pipeline for Process Application

A mature pipeline has multiple gates.

### 23.1 Build Gates

```text
compile
unit tests
worker handler tests
variable mapper tests
BPMN XML validation
DMN validation
contract test: job types exist
contract test: messages exist
contract test: BPMN errors handled
static analysis
container build
SBOM/security scan
```

### 23.2 Integration Gates

```text
start local/test Camunda
 deploy BPMN
 start process instance
 complete happy path
 test BPMN error path
 test incident path
 test timer/message path
 verify worker idempotency
```

### 23.3 Release Gates

```text
version manifest generated
migration notes prepared
runbook updated
dashboard/alert exists
rollback plan documented
compatibility with running instances reviewed
```

---

## 24. Testing Architecture Preview

Part 20 will go deeper, but here are architecture-level principles.

Test types:

```text
1. Worker unit test
2. Handler unit test
3. Variable mapper test
4. BPMN contract test
5. Process path integration test
6. Idempotency retry test
7. External adapter test
8. Human task API test
9. Migration/version compatibility test
```

### 24.1 Worker Test Focus

Worker test should assert:

```text
given job variables
when worker runs
then command mapped correctly
and handler called
and complete variables correct
and exception maps to correct Camunda action
```

### 24.2 Handler Test Focus

Handler test should assert:

```text
given domain state
when command handled
then invariant preserved
and entity state changed correctly
and audit/outbox/dedup written
```

### 24.3 BPMN Contract Test Focus

Contract test should parse BPMN and verify:

```text
all service task job types known
all message names known
all BPMN error codes known
all called processes exist
all required variable mappings documented
no banned element/pattern appears
```

---

## 25. Java 8 to Java 25 Considerations

The user requirement is Java 8 through 25. In practice, Camunda 8 ecosystem versions may require modern Java depending on component/version, but application architecture concepts can be adapted.

### 25.1 Java 8

Use:

```text
POJO DTO
CompletableFuture carefully
bounded thread pools
classic switch
class hierarchy for result/error
manual validation
```

Avoid assuming:

```text
record
sealed class
pattern matching
virtual threads
structured concurrency
```

### 25.2 Java 11/17

Good baseline for many enterprise apps.

Use:

```text
var where helpful
records if Java 16+
sealed classes if Java 17+
modern HTTP client if needed
better GC options
container-aware runtime
```

### 25.3 Java 21/25

Useful for process applications because many workers are IO-heavy.

Potential tools:

```text
virtual threads
structured concurrency
pattern matching
records
sealed types
modern switch
ZGC improvements
```

But architecture remains the same:

```text
virtual threads do not replace idempotency
structured concurrency does not replace compensation
records do not replace variable governance
modern switch does not replace error taxonomy
```

### 25.4 Cross-Version Library Strategy

If supporting multiple Java versions:

```text
core contract module Java 8 compatible
modern worker implementation Java 17/21
avoid leaking modern language features into shared artifacts if legacy consumers exist
publish separate artifacts if necessary
```

---

## 26. Example End-to-End Architecture: Licence Application Review

### 26.1 BPMN Process

```text
Start: application submitted
  -> validate application [service task]
  -> if incomplete: request missing docs [user/applicant task/message]
  -> calculate risk [DMN/business rule task]
  -> if high risk: senior officer review [user task]
  -> collect payment [message wait]
  -> issue licence [service task]
  -> notify applicant [service task]
  -> end
```

### 26.2 Application Components

```text
licensing-api
  - submit application
  - task form APIs
  - officer decision APIs

licensing-worker
  - validate-application
  - calculate-risk
  - issue-licence
  - notify-applicant

licensing-domain
  - application aggregate
  - licence aggregate
  - policy services

licensing-integration
  - payment gateway
  - document service
  - notification service
```

### 26.3 Submit Flow

```text
POST /applications/{id}/submit
  -> authorize applicant
  -> validate application editable
  -> transaction:
       application.status = SUBMITTED
       outbox PROCESS_START_REQUESTED
       audit APPLICATION_SUBMITTED
  -> return accepted

outbox dispatcher
  -> start process licensing-review with applicationId
  -> store processInstanceKey
```

### 26.4 Validate Application Worker

```text
activate validate-application job
  -> map variables to ValidateApplicationCommand
  -> execute idempotently
  -> load application
  -> run validation policy
  -> write validation result/audit
  -> complete job with applicationValid + missingDocumentCodes
```

### 26.5 Officer Review Task

```text
officer opens task
  -> backend verifies candidate group + domain permission
  -> returns form with application summary

officer submits decision
  -> transaction:
       persist decision
       audit decision
  -> complete Camunda task with decisionCode
```

### 26.6 Payment Confirmation

```text
payment webhook received
  -> validate signature
  -> dedup eventId
  -> verify application/payment relation
  -> publish Camunda message payment-confirmed with correlationKey applicationId
  -> process continues
```

### 26.7 Licence Issuance Worker

```text
activate issue-licence job
  -> idempotency key = applicationId + issueLicence + elementInstanceKey
  -> transaction:
       create licence if not exists
       update application status APPROVED
       write audit
       write outbox notification
  -> complete job with licenceId
```

---

## 27. Common Anti-patterns

### 27.1 Worker Monolith

Symptom:

```text
One worker method has 300+ lines and does validation, persistence, external call, audit, and process decision.
```

Fix:

```text
worker -> command -> handler -> domain service -> infrastructure
```

### 27.2 BPMN String Chaos

Symptom:

```text
job type/message/error/variable names repeated as literal strings across code.
```

Fix:

```text
contract constants + manifest + BPMN contract tests
```

### 27.3 Process Variable Database

Symptom:

```text
entire application payload stored as process variable.
```

Fix:

```text
store domain data in domain DB; process variable keeps IDs and routing facts
```

### 27.4 Completion Without Idempotency

Symptom:

```text
worker performs side effect and completes job, but duplicate job repeats side effect.
```

Fix:

```text
idempotency key + dedup table + external idempotency key/reconciliation
```

### 27.5 Direct Tasklist Completion From Browser

Symptom:

```text
frontend completes user task directly with process variables.
```

Fix:

```text
backend domain endpoint validates permission/invariant then completes task
```

### 27.6 Auto Deployment in Production

Symptom:

```text
worker app startup deploys BPMN unexpectedly.
```

Fix:

```text
explicit BPMN deployment pipeline and process release governance
```

### 27.7 No Ownership for Incidents

Symptom:

```text
Operate shows incidents but nobody knows which team owns the job type.
```

Fix:

```text
job type registry with owner, runbook, dashboard, alert route
```

---

## 28. Production Readiness Checklist

### 28.1 Process Contract

- [ ] BPMN process id stable.
- [ ] Job types documented.
- [ ] Message names documented.
- [ ] BPMN error codes documented.
- [ ] Variable schema documented.
- [ ] Called processes documented.
- [ ] DMN/form versions documented.
- [ ] Contract test parses BPMN.

### 28.2 Worker Architecture

- [ ] Worker is thin adapter.
- [ ] Business logic is in handler/domain layer.
- [ ] Worker has idempotency boundary.
- [ ] Worker has explicit error classification.
- [ ] Job timeout configured intentionally.
- [ ] Max jobs active aligned with downstream capacity.
- [ ] Graceful shutdown tested.

### 28.3 Data and Transaction

- [ ] Process variables minimal.
- [ ] Domain state stored in domain DB.
- [ ] Outbox/inbox used where needed.
- [ ] External side effect idempotency handled.
- [ ] Duplicate process start prevented.
- [ ] Stale task completion prevented.

### 28.4 Security

- [ ] Machine credentials least privilege.
- [ ] Secrets stored securely.
- [ ] Task authorization enforced in backend.
- [ ] Sensitive variables minimized.
- [ ] Inbound messages authenticated/deduplicated.
- [ ] Privileged operations audited.

### 28.5 Observability

- [ ] Logs include process and business correlation.
- [ ] Metrics per job type.
- [ ] Alerts for failed jobs/incidents/backlog.
- [ ] Dashboard for process SLA/task aging.
- [ ] Audit events structured.
- [ ] Trace context propagated.

### 28.6 Deployment and Operations

- [ ] BPMN deployment governed.
- [ ] Worker/process compatibility checked.
- [ ] Runbook per critical job type.
- [ ] Incident ownership clear.
- [ ] Manual repair path documented.
- [ ] Rollback/migration limitations known.

---

## 29. Design Review Questions

Saat review arsitektur Spring Boot + Camunda 8, tanyakan:

1. Apa yang menjadi process state dan apa yang menjadi domain state?
2. Siapa owner setiap job type?
3. Apakah worker bisa dieksekusi dua kali dengan aman?
4. Apa yang terjadi jika DB commit berhasil tetapi job completion gagal?
5. Apa yang terjadi jika external API berhasil tetapi worker crash?
6. Apakah task completion melewati domain authorization?
7. Apakah process variable berisi data sensitif yang tidak perlu?
8. Apakah semua BPMN string punya contract constant/test?
9. Bagaimana process start dicegah dari duplicate?
10. Bagaimana event/message dicegah dari replay/stale correlation?
11. Apakah timer/SLA menggunakan business calendar yang benar?
12. Apakah worker concurrency sesuai downstream capacity?
13. Bagaimana cara operator memperbaiki incident?
14. Apakah audit bisa menjelaskan keputusan bisnis dua tahun kemudian?
15. Apakah BPMN deployment dan worker deployment compatible?
16. Bagaimana running instance lama ditangani saat process version berubah?
17. Apa yang terjadi saat worker app rolling restart?
18. Apa yang terjadi saat Camunda cluster unreachable?
19. Apakah dashboard menunjukkan backlog/task aging/SLA breach?
20. Apakah design ini masih bisa dimengerti oleh engineer baru enam bulan lagi?

---

## 30. Top 1% Mental Model

Spring Boot + Camunda 8 architecture yang matang tidak ditentukan oleh banyaknya annotation atau cepatnya membuat demo.

Yang membedakan engineer biasa dan engineer top-level adalah kemampuan melihat boundary:

```text
BPMN controls process flow.
Camunda stores process state.
Worker adapts process job to application command.
Application service protects business invariant.
Domain DB stores source of truth.
Outbox/inbox protects distributed side effects.
Task backend protects human authorization.
Observability connects all runtime facts.
Audit explains business decisions defensibly.
```

Jangan pernah menjadikan Camunda sebagai:

```text
- domain database
- authorization engine utama
- generic message broker
- dumping ground variable
- magic distributed transaction coordinator
- replacement for domain model
```

Gunakan Camunda sebagai:

```text
- explicit long-running process coordinator
- wait-state manager
- human/system orchestration engine
- process visibility layer
- incident/operation surface
- bridge between business model and runtime execution
```

Jika mental model ini kuat, Spring Boot app yang dibangun di atas Camunda 8 akan lebih mudah:

- dikembangkan,
- dites,
- di-scale,
- diamankan,
- dioperasikan,
- dimigrasikan,
- dan dipertanggungjawabkan.

---

## 31. Ringkasan

Dalam Part 19 ini kita membahas:

1. Process application bukan sekadar Spring Boot app yang punya worker.
2. Worker harus diperlakukan sebagai inbound adapter.
3. Business logic sebaiknya masuk ke application/domain layer.
4. BPMN contract harus distabilkan melalui constants, manifest, dan contract tests.
5. Idempotency boundary wajib eksplisit.
6. Local DB transaction dan Camunda job completion bukan satu ACID transaction.
7. Outbox/inbox penting untuk side effect dan event correlation.
8. Human task completion harus melewati backend domain authorization.
9. Process variables harus minimal, typed, versioned, dan governed.
10. Worker concurrency harus mengikuti downstream capacity.
11. Security meliputi machine identity, task authorization, variable protection, dan message validation.
12. Observability harus menghubungkan process instance, job, domain entity, correlation ID, dan audit event.
13. Deployment process definition harus governed, terutama di production.
14. Java 8–25 mempengaruhi syntax/runtime option, tetapi tidak mengubah prinsip architecture.

---

## 32. Referensi Resmi dan Bacaan Lanjutan

Referensi utama untuk bagian ini:

1. Camunda 8 Docs — Camunda Spring Boot Starter Getting Started  
   https://docs.camunda.io/docs/apis-tools/camunda-spring-boot-starter/getting-started/

2. Camunda 8 Docs — Camunda Spring Boot Starter Configuration  
   https://docs.camunda.io/docs/apis-tools/camunda-spring-boot-starter/configuration/

3. Camunda 8 Docs — Java Client Getting Started  
   https://docs.camunda.io/docs/apis-tools/java-client/getting-started/

4. Camunda 8 Docs — Job Worker  
   https://docs.camunda.io/docs/apis-tools/java-client/job-worker/

5. Camunda 8 Docs — Writing Good Workers  
   https://docs.camunda.io/docs/components/best-practices/development/writing-good-workers/

6. Camunda 8 Docs — Run your first Spring Boot or Node.js project with Camunda 8  
   https://docs.camunda.io/docs/guides/getting-started-example/

7. Camunda Blog — Upcoming API Changes in Camunda 8  
   https://camunda.com/blog/2024/12/api-changes-in-camunda-8-a-unified-and-streamlined-experience/

8. Camunda Blog — Exploring New Features in Camunda 8 for Java Developers  
   https://camunda.com/blog/2024/12/exploring-the-new-features-in-camunda-8-for-java-developers/

---

## 33. Status Seri

Selesai sejauh ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
- Part 6 — Java Client Engineering: From API Call to Production-grade Worker
- Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs
- Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance
- Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation
- Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization
- Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic
- Part 12 — Message Correlation and Event-driven Process Design
- Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior
- Part 14 — Multi-instance, Parallelism, Fan-out/Fan-in, and Concurrency Control
- Part 15 — Subprocess, Call Activity, Reusable Process, and Process Composition
- Part 16 — Saga and Long-running Transaction Engineering with BPMN
- Part 17 — Camunda 7 Deep Dive: Embedded Engine, Job Executor, Transactions, and Spring Boot
- Part 18 — Camunda 8 Deep Dive: Zeebe, Workers, Operate, Tasklist, Optimize, Identity
- Part 19 — Spring Boot + Camunda 8 Process Application Architecture

Seri belum selesai.

Berikutnya:

**Part 20 — Testing BPMN and Camunda Applications**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-bpmn-camunda-part-18-camunda-8-zeebe-workers-operate-tasklist-optimize-identity.md">⬅️ Learn Java BPMN + Camunda Process Orchestration Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-bpmn-camunda-part-20-testing-bpmn-and-camunda-applications.md">Part 20 — Testing BPMN and Camunda Applications ➡️</a>
</div>
