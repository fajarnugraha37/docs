# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-014.md

# Part 014 — Spring Boot Integration: Camunda Spring Boot Starter, Workers, Configuration, Profiles, and Testing

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `014`  
> Topik: Spring Boot Integration untuk Camunda 8 / Zeebe  
> Fokus: membuat aplikasi Java worker/process application yang production-grade dengan Spring Boot, Camunda Spring Boot Starter, configuration discipline, profile/environment strategy, testing, lifecycle, dan operational correctness.  
> Catatan versi: materi ini berorientasi pada Camunda 8.8+ dan 8.9+, tetapi tetap menjelaskan strategi untuk codebase lama yang masih memakai Spring Zeebe SDK / Zeebe Java Client.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami peran **Camunda Spring Boot Starter** dalam ekosistem Camunda 8 modern.
2. Membedakan integrasi lama berbasis **Spring Zeebe SDK** dengan integrasi baru berbasis **Camunda Java Client**.
3. Mendesain aplikasi Spring Boot worker yang:
   - aman secara lifecycle,
   - stabil terhadap retry,
   - observable,
   - bisa dikonfigurasi per environment,
   - mudah dites,
   - tidak mencampur domain logic dengan orchestration adapter.
4. Menggunakan worker annotation secara benar tanpa jatuh ke jebakan “handler method = business service”.
5. Menentukan boundary transaksi antara:
   - Zeebe job lifecycle,
   - Spring transaction,
   - database local transaction,
   - external API call,
   - outbox/inbox.
6. Mendesain profile, configuration, secrets, logging, metrics, health, graceful shutdown, dan deployment compatibility.
7. Membuat strategi testing yang masuk akal untuk:
   - unit test domain,
   - worker adapter test,
   - BPMN/process test,
   - integration test,
   - contract test variable,
   - failure path test.

---

## 1. Kenapa Spring Boot Integration Perlu Dibahas Serius?

Di Camunda 8, Java service task dieksekusi oleh **external job worker**. Dalam praktik enterprise Java, job worker sering dibangun sebagai aplikasi Spring Boot karena Spring menyediakan:

- dependency injection,
- configuration,
- lifecycle management,
- observability,
- transaction management,
- HTTP client integration,
- database integration,
- security,
- metrics,
- health checks,
- deployment-friendly packaging.

Namun, ada jebakan besar:

> Spring Boot membuat worker terlihat seperti aplikasi biasa, padahal worker adalah bagian dari distributed workflow execution. Kesalahan kecil dalam timeout, concurrency, retry, variable mapping, dan transaction boundary bisa menyebabkan duplicate side effect, incident storm, atau stuck process.

Jadi integrasi Spring Boot bukan sekadar:

```java
@JobWorker(type = "charge-payment")
public void handle(JobClient client, ActivatedJob job) {
    // do something
}
```

Yang perlu dipahami adalah:

```text
Zeebe job lease
    -> Spring bean lifecycle
        -> worker thread/concurrency
            -> domain service call
                -> local DB transaction
                    -> external API side effect
                        -> job completion/failure/BPMN error
```

Setiap boundary punya failure mode.

---

## 2. Posisi Camunda Spring Boot Starter di Camunda 8 Modern

Secara historis, banyak project Camunda 8 Java memakai:

```text
io.camunda.spring:spring-boot-starter-camunda-sdk
```

atau package lama seputar:

```text
io.camunda.zeebe.spring.client
```

Pada Camunda 8.8+, arah resminya berubah ke:

```text
io.camunda:camunda-spring-boot-starter
```

Starter baru ini memakai **Camunda Java Client** di bawahnya. REST menjadi default protocol, sementara gRPC masih dapat dikonfigurasi. Ini penting karena:

1. Zeebe Java Client lama menuju deprecation/removal path.
2. Spring Zeebe SDK lama juga menuju removal path.
3. API surface mulai bergerak ke unified Camunda APIs, bukan hanya Zeebe command API.
4. Java worker apps yang dibuat hari ini harus menghindari tight coupling ke class/package lama.

Mental model:

```text
Old world:
Spring Boot app
  -> Spring Zeebe SDK
      -> Zeebe Java Client
          -> Zeebe Gateway gRPC

Newer world:
Spring Boot app
  -> Camunda Spring Boot Starter
      -> Camunda Java Client
          -> Camunda Orchestration Cluster API
          -> REST default / gRPC configurable
```

Implikasinya:

- Jangan mendesain domain code bergantung langsung pada API client detail.
- Buat adapter boundary.
- Isolasi annotation worker dari domain service.
- Versikan contract worker.
- Siapkan migration layer jika masih punya code lama.

---

## 3. Peran Spring Boot App dalam Camunda 8

Aplikasi Spring Boot yang terhubung ke Camunda 8 dapat berperan sebagai:

1. **Process deployer**
   - deploy BPMN/DMN/form resource saat startup atau pipeline.
2. **Process starter**
   - menerima request bisnis lalu membuat process instance.
3. **Job worker**
   - mengaktifkan dan menyelesaikan service task.
4. **Message publisher**
   - menerima callback/event lalu publish message ke Camunda.
5. **Task application backend**
   - jika membangun custom task UI.
6. **Read-side integration**
   - membaca Operate/Tasklist/Orchestration API untuk kebutuhan terbatas.
7. **Administration/repair tool**
   - untuk operational action tertentu, biasanya sangat dikontrol.

Jangan campur semua peran tanpa sadar. Per role, failure mode berbeda.

Contoh pembagian yang lebih sehat:

```text
application-api-service
  - exposes REST API to business frontend
  - validates request
  - starts process instance
  - persists business aggregate

application-worker-service
  - runs Camunda job workers
  - calls internal/external services
  - idempotency + outbox

application-callback-service
  - receives external callback
  - validates signature
  - publishes Camunda message

application-task-service
  - custom inbox API
  - reads task/query projection
  - completes user task through API
```

Untuk sistem kecil, boleh disatukan. Untuk sistem enterprise, pemisahan deployment unit sering lebih aman.

---

## 4. Dependency Strategy

### 4.1 Maven Dependency Modern

Contoh konseptual:

```xml
<dependency>
  <groupId>io.camunda</groupId>
  <artifactId>camunda-spring-boot-starter</artifactId>
  <version>${camunda.version}</version>
</dependency>
```

Tambahan umum:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
</dependency>

<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>

<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-validation</artifactId>
</dependency>

<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-data-jdbc</artifactId>
</dependency>
```

Testing:

```xml
<dependency>
  <groupId>io.camunda</groupId>
  <artifactId>camunda-process-test-java</artifactId>
  <version>${camunda.version}</version>
  <scope>test</scope>
</dependency>

<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-test</artifactId>
  <scope>test</scope>
</dependency>
```

Nama artifact bisa berubah mengikuti minor release. Karena itu, selalu kunci dependency melalui property/BOM yang eksplisit dan validasi dari dokumentasi versi yang dipakai.

### 4.2 Gradle Dependency Modern

Contoh konseptual:

```gradle
dependencies {
    implementation "io.camunda:camunda-spring-boot-starter:${camundaVersion}"

    implementation "org.springframework.boot:spring-boot-starter-web"
    implementation "org.springframework.boot:spring-boot-starter-actuator"
    implementation "org.springframework.boot:spring-boot-starter-validation"
    implementation "org.springframework.boot:spring-boot-starter-data-jdbc"

    testImplementation "io.camunda:camunda-process-test-java:${camundaVersion}"
    testImplementation "org.springframework.boot:spring-boot-starter-test"
}
```

### 4.3 Dependency Governance

Production rule:

```text
Spring Boot version, Java version, Camunda version, client protocol, and deployment runtime must be versioned together.
```

Jangan upgrade satu library Camunda tanpa mengecek:

- Camunda server/cluster version,
- Spring Boot compatibility,
- Java runtime,
- protocol default,
- package rename,
- deprecated SDK,
- testing library compatibility,
- serialization behavior,
- security/auth config.

Gunakan compatibility matrix internal:

| Item | Example |
|---|---|
| Java runtime | 17 / 21 / 25 |
| Spring Boot | 3.3.x / 3.4.x / 3.5.x |
| Camunda platform | 8.8.x / 8.9.x |
| Client | Camunda Java Client |
| Protocol | REST default or gRPC |
| Worker starter | Camunda Spring Boot Starter |
| Test runtime | Camunda Process Test |
| Deployment | SaaS / Self-managed |
| Auth mode | OAuth / self-managed |
| Notes | breaking changes, deprecated packages |

---

## 5. Java 8 sampai Java 25: Practical Compatibility View

Permintaan seri ini mencakup Java 8 hingga Java 25. Untuk Camunda 8 modern, realitasnya:

- Java 8 biasanya relevan untuk legacy worker atau legacy application yang ingin berinteraksi secara terbatas.
- Java 11/17 lebih realistis untuk enterprise transitional systems.
- Java 21 sering menjadi baseline modern untuk Spring Boot 3.x dan runtime cloud-native.
- Java 25 mulai relevan untuk platform/runtime terbaru, tetapi harus divalidasi dengan Camunda version dan Spring Boot support.

Prinsip:

```text
Do not design new Camunda 8 Spring Boot worker on Java 8 unless forced by legacy constraints.
```

Kenapa?

1. Spring Boot 3.x tidak mendukung Java 8.
2. Modern Camunda dependencies bergerak mengikuti ekosistem modern.
3. TLS, HTTP client, observability, container runtime, dan security library lebih sehat di Java modern.
4. Virtual threads bisa dipertimbangkan di Java 21+, walau tidak otomatis cocok untuk semua worker workload.

Namun materi tetap membahas strategi Java 8 karena banyak enterprise masih punya sistem lama.

### 5.1 Jika Masih Ada Java 8

Gunakan pendekatan bridge:

```text
Java 8 legacy service
  <- HTTP/JMS/Kafka/internal API ->
Java 17/21 Camunda worker adapter
  -> Camunda 8
```

Jangan paksa legacy Java 8 langsung menjadi Camunda 8 worker jika dependency tidak cocok.

Pattern:

```text
Camunda 8 worker service on Java 21
  - receives job
  - validates variables
  - calls legacy Java 8 service via stable API
  - handles idempotency
  - completes/fails job
```

Dengan begitu, orchestration runtime tetap modern, sementara legacy system tetap terisolasi.

### 5.2 Jika Menggunakan Java 21+

Pertimbangkan:

- records untuk DTO internal,
- sealed interfaces untuk error taxonomy,
- virtual threads untuk blocking IO worker,
- structured concurrency hanya jika platform dan style team siap,
- modern HTTP client,
- better GC defaults,
- better observability integration.

Tetapi jangan membuat worker correctness bergantung pada fitur bahasa. Correctness tetap berasal dari:

- idempotency,
- transaction boundary,
- retry policy,
- timeout,
- schema discipline,
- observability.

---

## 6. Configuration Model

Spring Boot memberi banyak cara konfigurasi. Untuk Camunda worker, konfigurasi harus diperlakukan sebagai runtime contract.

Contoh `application.yml` konseptual:

```yaml
spring:
  application:
    name: application-worker-service

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      probes:
        enabled: true

camunda:
  client:
    mode: self-managed
    auth:
      client-id: ${CAMUNDA_CLIENT_ID}
      client-secret: ${CAMUNDA_CLIENT_SECRET}
    cluster:
      rest-address: ${CAMUNDA_REST_ADDRESS}
      grpc-address: ${CAMUNDA_GRPC_ADDRESS:}
    worker:
      defaults:
        max-jobs-active: 32
        timeout: PT2M
        poll-interval: PT1S
```

Nama property aktual harus mengikuti versi starter yang dipakai. Yang penting adalah modelnya:

```text
Configuration must be externalized, explicit, version-controlled, and environment-specific.
```

### 6.1 Configuration Categories

Pisahkan:

1. **Connection config**
   - endpoint,
   - protocol,
   - auth,
   - TLS.
2. **Worker config**
   - max jobs active,
   - timeout,
   - stream enabled,
   - poll interval,
   - fetch variables.
3. **Business config**
   - retry limits,
   - SLA thresholds,
   - external API timeout.
4. **Operational config**
   - logging level,
   - metrics,
   - health probe,
   - graceful shutdown timeout.
5. **Security config**
   - secrets,
   - tenant,
   - OAuth audience,
   - certificate.

Jangan campur business constants dalam BPMN tanpa governance. Jangan hardcode worker timeout di annotation tanpa mempertimbangkan environment.

---

## 7. Profile Strategy

Spring profile biasanya dipakai seperti:

```text
local
dev
sit
uat
preprod
prod
```

Untuk Camunda 8, profile bukan hanya mengganti URL. Profile mempengaruhi:

- cluster endpoint,
- credentials,
- protocol,
- worker activation,
- auto deployment,
- logging,
- metrics,
- incident behavior,
- external API target,
- test fixtures,
- rate limit,
- worker concurrency.

### 7.1 Local Profile

Tujuan local:

- cepat menjalankan worker,
- bisa connect ke Camunda 8 Run / local docker,
- bisa deploy BPMN,
- bisa menjalankan scenario.

Contoh prinsip:

```yaml
spring:
  config:
    activate:
      on-profile: local

camunda:
  client:
    mode: self-managed
    auth:
      enabled: false
    cluster:
      rest-address: http://localhost:8080

app:
  workers:
    payment:
      enabled: true
      max-jobs-active: 4
  external:
    payment-api:
      base-url: http://localhost:9090
```

### 7.2 Dev/SIT/UAT

Untuk shared non-prod:

- concurrency lebih rendah dari prod,
- logging bisa lebih verbose,
- auto deploy bisa diperbolehkan jika pipeline belum matang,
- secrets dari secret manager,
- external dependencies pakai sandbox/mock/stub.

### 7.3 Production

Untuk prod:

- no accidental auto-deploy dari developer jar,
- concurrency controlled,
- secrets only from secure store,
- logging no PII,
- health/readiness strict,
- worker graceful shutdown enabled,
- metrics mandatory,
- retry policy aligned with incident management.

Production profile should be boring.

---

## 8. Auto Deployment BPMN: Convenience vs Governance

Spring integration sering menyediakan kemampuan deploy BPMN dari classpath, misalnya file di:

```text
src/main/resources/*.bpmn
src/main/resources/processes/*.bpmn
```

Untuk local/dev, auto-deploy berguna.

Untuk production, hati-hati.

Masalah jika worker app auto-deploy BPMN saat startup:

1. Setiap restart bisa deploy ulang jika resource berubah.
2. Release worker dan release process menjadi terlalu melekat.
3. Rollback aplikasi bisa tidak otomatis rollback process version.
4. Process versioning menjadi sulit dikontrol.
5. Beberapa replica bisa deploy resource bersamaan jika tidak dikunci.
6. Approval workflow untuk BPMN bisa terlewati.

Pattern yang lebih matang:

```text
CI/CD process artifact pipeline
  -> validate BPMN
  -> review
  -> version
  -> deploy BPMN to Camunda
  -> deploy compatible workers
  -> run smoke test
```

Aplikasi worker tidak harus selalu menjadi deployer.

### 8.1 Kapan Auto-Deploy Boleh?

Boleh untuk:

- local development,
- tutorial,
- proof of concept,
- isolated small internal app,
- test runtime.

Tidak ideal untuk:

- regulated system,
- multi-team process ownership,
- large production cluster,
- strict release governance,
- high-risk long-running instances.

---

## 9. Worker Annotation Model

Dengan Spring Boot Starter, worker biasanya ditulis sebagai annotated bean.

Contoh konseptual:

```java
@Component
public class PaymentWorkers {

    private final PaymentApplicationService paymentService;

    public PaymentWorkers(PaymentApplicationService paymentService) {
        this.paymentService = paymentService;
    }

    @JobWorker(type = "charge-payment")
    public Map<String, Object> chargePayment(ActivatedJob job) {
        PaymentCommand command = PaymentCommand.from(job.getVariablesAsMap());

        PaymentResult result = paymentService.charge(command);

        return Map.of(
            "paymentStatus", result.status(),
            "paymentReference", result.reference()
        );
    }
}
```

Ini terlihat simpel. Tapi untuk production, jangan biarkan method ini menjadi tempat semua logic.

Lebih sehat:

```text
@JobWorker method
  -> parse and validate variables
  -> create command object
  -> call application service
  -> map result to variables
  -> map known domain error to BPMN error / fail job
```

Tidak sehat:

```text
@JobWorker method
  -> query DB
  -> call external API
  -> build SQL
  -> update many tables
  -> catch all Exception
  -> complete job anyway
```

### 9.1 Worker Method as Adapter

Worker method adalah adapter dari dunia Zeebe ke domain application.

```java
@Component
public final class ChargePaymentWorker {

    private final ChargePaymentUseCase useCase;
    private final JobVariableMapper variableMapper;
    private final WorkerErrorMapper errorMapper;

    public ChargePaymentWorker(
            ChargePaymentUseCase useCase,
            JobVariableMapper variableMapper,
            WorkerErrorMapper errorMapper
    ) {
        this.useCase = useCase;
        this.variableMapper = variableMapper;
        this.errorMapper = errorMapper;
    }

    @JobWorker(type = "payment.charge.v1")
    public Map<String, Object> handle(ActivatedJob job) {
        ChargePaymentCommand command = variableMapper.toChargePaymentCommand(job);

        try {
            ChargePaymentOutcome outcome = useCase.charge(command);
            return variableMapper.toVariables(outcome);
        } catch (KnownBusinessException ex) {
            throw errorMapper.toBpmnError(ex);
        } catch (TransientExternalException ex) {
            throw errorMapper.toRetryableFailure(ex);
        }
    }
}
```

Catatan:

- Class exception aktual bergantung starter/client API.
- Pada beberapa API, BPMN error/failure bisa dilakukan dengan client command, bukan hanya throw exception.
- Prinsipnya tetap sama: mapping error harus eksplisit.

---

## 10. Worker Type Naming Strategy

Job type adalah contract antara BPMN dan worker.

Jangan asal:

```text
send
process
validate
service-task
```

Lebih baik:

```text
application.validate-submission.v1
application.calculate-risk-score.v1
payment.reserve-funds.v1
notification.send-approval-email.v1
case.assign-reviewer.v1
```

Prinsip:

1. Nama mencerminkan business capability.
2. Tambahkan version jika contract bisa berubah.
3. Hindari nama terlalu teknis.
4. Hindari nama terlalu generic.
5. Konsisten antara BPMN, Java package, observability, dan documentation.

Mapping:

```text
BPMN service task
  type = "case.assign-reviewer.v1"

Java worker
  package = com.company.caseprocess.worker.assignment
  class = AssignReviewerWorker

Metric/log
  job_type = "case.assign-reviewer.v1"
```

---

## 11. Fetch Variables Strategy

Worker bisa mengambil semua variable atau subset tertentu. Production rule:

```text
Fetch only variables that the worker needs.
```

Kenapa?

1. Mengurangi payload.
2. Mengurangi leakage PII.
3. Mengurangi coupling.
4. Meningkatkan performance.
5. Membuat contract lebih jelas.

Contoh konseptual:

```java
@JobWorker(
    type = "case.assign-reviewer.v1",
    fetchVariables = {
        "caseId",
        "applicationType",
        "riskLevel",
        "region"
    }
)
public Map<String, Object> handle(ActivatedJob job) {
    ...
}
```

Jika worker mengambil semua variable, biasanya itu smell:

```text
Worker does not know its own contract.
```

Boleh fetch all untuk:

- early prototyping,
- diagnostic tool,
- generic audit exporter-like worker,
- migration bridge sementara.

Tapi jangan jadikan production default.

---

## 12. Auto Completion vs Manual Completion

Spring worker sering mendukung style:

1. Return value otomatis menjadi variables dan job completed.
2. Manual complete/fail via client.
3. Disable auto-completion untuk async processing.

### 12.1 Auto Completion

Cocok untuk simple synchronous worker:

```java
@JobWorker(type = "calculate-risk.v1")
public Map<String, Object> calculate(ActivatedJob job) {
    RiskResult result = service.calculate(...);
    return Map.of("riskScore", result.score());
}
```

Keuntungan:

- simple,
- less boilerplate,
- fewer accidental missing completion.

Risiko:

- kurang eksplisit untuk complex failure,
- sulit untuk async side effect,
- raw exception handling bisa terlalu implicit,
- bisa menyembunyikan mapping error.

### 12.2 Manual Completion

Cocok untuk explicit control:

```java
@JobWorker(type = "send-notification.v1", autoComplete = false)
public void sendNotification(JobClient client, ActivatedJob job) {
    try {
        NotificationResult result = service.send(...);

        client.newCompleteCommand(job.getKey())
            .variables(Map.of("notificationId", result.id()))
            .send()
            .join();

    } catch (TransientNotificationException ex) {
        client.newFailCommand(job.getKey())
            .retries(job.getRetries() - 1)
            .errorMessage(ex.getMessage())
            .send()
            .join();
    }
}
```

Keuntungan:

- explicit,
- cocok untuk error mapping,
- bisa set retries/backoff,
- bisa mengontrol completion timing.

Risiko:

- blocking `.join()` harus dipahami,
- bisa lupa complete/fail,
- error setelah complete command bisa membingungkan,
- harus hati-hati thread starvation.

### 12.3 Async Worker

Untuk long async flow, lebih baik desain BPMN dengan message callback daripada menahan job terlalu lama.

Bad:

```text
Worker activates job
  -> starts external long-running operation
  -> keeps job active for 30 minutes
  -> waits
```

Better:

```text
Service task: submit external request
  -> worker sends request, stores correlation id, completes job

Intermediate message catch event: wait external callback
  -> callback service publishes message
```

Jangan jadikan job timeout sebagai waiting mechanism untuk long-running external process.

---

## 13. Transaction Boundary dengan Spring `@Transactional`

Ini bagian yang sering menyebabkan bug mahal.

Misal worker:

```java
@JobWorker(type = "approve-application.v1")
@Transactional
public Map<String, Object> approve(ActivatedJob job) {
    repository.markApproved(caseId);
    externalApi.notifyApproval(caseId);
    return Map.of("approved", true);
}
```

Sekilas benar. Tetapi failure mode:

1. DB commit sukses, external API gagal.
2. External API sukses, DB rollback.
3. DB commit sukses, job complete gagal.
4. Job complete sukses, app crash sebelum response.
5. External API timeout, tapi di sisi provider sukses.

`@Transactional` hanya menjamin local DB transaction. Ia tidak menjamin Zeebe dan external API ikut atomic.

### 13.1 Rule of Thumb

```text
Never assume Spring transaction covers Zeebe job completion or external API side effects.
```

### 13.2 Safer Pattern: Idempotent Command + Outbox

Worker:

```text
1. Validate job.
2. Create idempotency key.
3. In DB transaction:
   - record worker execution attempt
   - update business state if not already processed
   - create outbox event/command if external call needed
4. Commit DB.
5. External dispatcher sends outbox event idempotently.
6. Worker completes job only after required effect is confirmed, or model async callback.
```

Ada dua design:

#### Design A — Worker Performs External Call Synchronously

Cocok jika:

- external call cepat,
- idempotent,
- low risk,
- retry semantics jelas.

Flow:

```text
Worker activated
  -> check idempotency
  -> call external API with idempotency key
  -> persist result
  -> complete job
```

#### Design B — Worker Submits Command, Process Waits Message

Cocok jika:

- external operation lama,
- callback-based,
- result asynchronous,
- perlu strong audit.

Flow:

```text
Service task submit
  -> worker stores request + sends external command
  -> complete job

Message catch event
  -> callback received
  -> publish message
  -> process continues
```

Design B biasanya lebih sehat untuk long-running enterprise integrations.

---

## 14. Exception Mapping dalam Worker

Jangan `catch (Exception)` lalu `fail job` tanpa taxonomy.

Buat kategori:

```text
BusinessError
  -> BPMN error
  -> process takes modeled path

TransientTechnicalError
  -> fail job with retry
  -> engine retries

PermanentTechnicalError
  -> fail job with no retries
  -> incident/manual repair

UnexpectedBug
  -> fail job or incident
  -> alert engineering

SecurityViolation
  -> incident or BPMN error depending context
  -> audit

ValidationContractError
  -> incident, because BPMN/worker contract broken
```

Contoh pseudo-code:

```java
try {
    Outcome outcome = useCase.execute(command);
    return outputMapper.toVariables(outcome);

} catch (BusinessRejectionException ex) {
    throw new BpmnBusinessError("APPLICATION_REJECTED", ex.safeMessage());

} catch (ExternalSystemUnavailableException ex) {
    throw new RetryableWorkerException("External system unavailable", ex);

} catch (InvalidProcessVariableException ex) {
    throw new NonRetryableWorkerException("Process contract invalid", ex);

} catch (Exception ex) {
    throw new UnexpectedWorkerException("Unexpected worker failure", ex);
}
```

Mapping aktual ke Camunda command/API harus mengikuti starter version.

---

## 15. Configuration Per Worker

Satu worker app bisa punya banyak worker. Jangan gunakan satu setting global untuk semua.

Contoh:

```yaml
app:
  camunda-workers:
    validate-application:
      enabled: true
      type: application.validate.v1
      max-jobs-active: 16
      timeout: PT1M
      fetch-variables:
        - applicationId
        - applicantType

    call-risk-engine:
      enabled: true
      type: risk.calculate.v1
      max-jobs-active: 4
      timeout: PT3M
      fetch-variables:
        - applicationId
        - riskContextId

    send-email:
      enabled: true
      type: notification.send-email.v1
      max-jobs-active: 32
      timeout: PT30S
      fetch-variables:
        - caseId
        - templateId
        - recipientRef
```

Kenapa?

- Email worker bisa high concurrency.
- Risk engine worker mungkin external dependency sempit.
- Validation worker mungkin CPU ringan.
- Payment worker harus sangat conservative.

Worker setting harus mengikuti:

```text
business risk + downstream capacity + expected latency + retry semantics
```

Bukan sekadar jumlah CPU pod.

---

## 16. Worker Enable/Disable Strategy

Di production, kamu butuh cara mematikan worker tertentu tanpa mematikan app seluruhnya.

Use cases:

1. Downstream API sedang maintenance.
2. Worker bug ditemukan.
3. Process version baru belum siap.
4. Traffic spike perlu dibatasi.
5. Tenant tertentu perlu dihentikan.
6. Deployment canary.

Pattern:

```yaml
app:
  workers:
    risk-calculate:
      enabled: false
```

Pada level lebih matang:

```text
Feature flag / config service
  -> enable worker type
  -> change max jobs active
  -> route tenant
```

Namun hati-hati: worker registration biasanya terjadi saat startup. Dynamic enable/disable perlu desain yang jelas.

Practical approach:

- config per deployment,
- scale deployment replica to zero untuk worker specific service,
- split high-risk worker into separate deployment,
- use Kubernetes HPA/replica strategy.

---

## 17. Worker Deployment Unit Strategy

Ada beberapa pola.

### 17.1 Monolith Worker App

```text
one Spring Boot app
  -> all workers
```

Keuntungan:

- simple,
- fewer deployments,
- easier local development.

Risiko:

- one bad worker impacts all,
- scaling tidak granular,
- memory/thread contention,
- release coupling,
- harder incident isolation.

Cocok untuk:

- small process app,
- low volume,
- early stage.

### 17.2 Worker App per Domain

```text
case-worker-service
payment-worker-service
notification-worker-service
document-worker-service
```

Keuntungan:

- domain boundary jelas,
- scaling lebih baik,
- ownership lebih jelas,
- failure blast radius lebih kecil.

Risiko:

- lebih banyak deployment,
- config lebih banyak,
- coordination lebih berat.

Cocok untuk enterprise.

### 17.3 Worker App per Critical Job Type

```text
payment-reservation-worker
risk-engine-worker
email-worker
```

Keuntungan:

- sangat granular,
- bagus untuk high-risk/high-throughput worker.

Risiko:

- operational overhead.

Cocok jika worker punya karakteristik sangat berbeda.

Rule:

```text
Split workers when they differ significantly in scaling, risk, ownership, dependency, or release cadence.
```

---

## 18. Spring Bean Lifecycle dan Client Lifecycle

Camunda client sebaiknya dikelola sebagai singleton Spring bean.

Prinsip:

1. Jangan create client per job.
2. Jangan create HTTP/gRPC channel per request.
3. Shutdown client saat application shutdown.
4. Pastikan worker berhenti menerima job sebelum app mati.
5. Gunakan lifecycle hook untuk graceful shutdown.

Spring Boot lifecycle:

```text
Application starting
  -> configuration loaded
  -> Camunda client initialized
  -> workers registered
  -> app ready

Application stopping
  -> readiness fails
  -> stop receiving traffic
  -> workers stop activation
  -> active jobs drain or timeout
  -> client closes
```

### 18.1 Graceful Shutdown

Kubernetes termination:

```text
SIGTERM
  -> Spring Boot graceful shutdown starts
  -> readiness probe fails
  -> stop accepting HTTP traffic
  -> worker should stop polling/activation
  -> active job handlers finish within grace period
  -> app exits
```

Bad:

```text
SIGTERM
  -> app killed immediately
  -> active jobs not completed
  -> jobs time out later
  -> duplicate execution
```

Production config:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 60s
```

Kubernetes:

```yaml
terminationGracePeriodSeconds: 90
```

Worker job timeout should be larger than expected handler time, but not so large that crash recovery is delayed excessively.

---

## 19. Timeout Discipline

Ada banyak timeout:

1. Zeebe job timeout.
2. Worker handler execution timeout.
3. HTTP client connect timeout.
4. HTTP client read timeout.
5. DB transaction timeout.
6. Kubernetes termination grace period.
7. Gateway/client command timeout.
8. BPMN timer.
9. Business SLA.
10. OAuth token timeout.

Jangan menyamakan semuanya.

Example:

```text
Job timeout: 2 minutes
HTTP client timeout: 5 seconds
DB transaction timeout: 10 seconds
Command timeout: 10 seconds
Business SLA: 3 days
Kubernetes grace: 90 seconds
```

Rule:

```text
External call timeout must be shorter than job timeout.
```

Kalau HTTP timeout 2 menit dan job timeout 1 menit, worker bisa masih bekerja setelah job lease expired. Itu membuka pintu duplicate execution.

---

## 20. Threading dan Concurrency dalam Spring Worker

Worker concurrency dipengaruhi oleh:

- maxJobsActive,
- number of worker instances,
- handler execution model,
- thread pool,
- blocking calls,
- downstream latency,
- CPU availability,
- gRPC/REST client behavior,
- pod replica count.

Rumus kasar:

```text
effective_concurrency = replicas * maxJobsActive_per_replica
```

Tetapi real throughput:

```text
throughput ≈ concurrency / average_processing_time
```

Jika:

```text
maxJobsActive = 32
replicas = 4
average_processing_time = 2s
```

Maka potensi throughput:

```text
(32 * 4) / 2 = 64 jobs/sec
```

Tapi downstream mungkin hanya sanggup 10 req/sec. Kalau tidak dikontrol, worker menjadi load amplifier.

### 20.1 Blocking IO Worker

Untuk worker yang banyak blocking IO:

- pakai connection pool yang benar,
- set timeout pendek,
- batasi concurrency,
- pertimbangkan virtual threads di Java 21+,
- jangan melebihi downstream capacity.

### 20.2 CPU-Bound Worker

Untuk CPU-bound:

- concurrency mendekati CPU cores,
- jangan maxJobsActive terlalu tinggi,
- hindari blocking queue besar,
- monitor CPU saturation.

### 20.3 Mixed Worker

Pisahkan worker berat dan ringan.

Bad:

```text
same app:
  - PDF generation CPU-heavy
  - email sending IO-heavy
  - payment worker high-risk
```

Better:

```text
pdf-worker-service
notification-worker-service
payment-worker-service
```

---

## 21. Virtual Threads untuk Java 21+

Virtual threads bisa membantu worker yang blocking IO. Tetapi tidak menyelesaikan:

- downstream rate limit,
- idempotency,
- DB connection pool limit,
- external API timeout,
- Zeebe backpressure,
- memory pressure,
- correctness.

Misalnya, virtual threads memungkinkan 1000 handler blocking. Tapi jika DB pool hanya 30, maka 970 akan menunggu.

Rule:

```text
Virtual threads improve thread scalability, not system capacity.
```

Gunakan virtual threads jika:

- banyak blocking IO,
- dependencies thread-safe,
- connection pools dikonfigurasi,
- observability siap,
- team memahami pinning/blocking behavior.

Jangan gunakan virtual threads sebagai alasan menaikkan maxJobsActive secara liar.

---

## 22. Rate Limiting dan Bulkhead

Worker adalah consumer. Jika engine punya banyak job, worker bisa menarik terlalu banyak beban ke downstream.

Gunakan:

1. maxJobsActive per worker.
2. Bulkhead per external system.
3. Rate limiter per tenant/API.
4. Circuit breaker.
5. Backoff saat downstream bermasalah.
6. Dedicated deployment untuk downstream sensitif.

Example architecture:

```text
Camunda job worker
  -> Bulkhead(payment-api, maxConcurrent=5)
  -> RateLimiter(payment-api, 50/min)
  -> Payment client
```

Dengan Resilience4j atau library internal, mapping error harus jelas:

```text
Rate limit exceeded locally
  -> fail job retry after backoff

Circuit open
  -> fail job retry after backoff

Business rejected
  -> BPMN error
```

---

## 23. Health Checks

Spring Boot Actuator menyediakan health endpoint. Tapi untuk Camunda worker, health perlu hati-hati.

Liveness:

```text
Is the process alive?
```

Readiness:

```text
Is it safe to route traffic / run workload?
```

Untuk worker app, readiness bisa mempertimbangkan:

- Camunda client connectivity,
- auth token availability,
- critical downstream availability,
- DB connectivity,
- migration status,
- configuration validity.

Namun jangan terlalu agresif:

Bad readiness:

```text
if external payment API briefly fails, mark pod unready
```

Itu bisa menyebabkan pod churn.

Better:

```text
readiness = app can safely operate
worker-specific circuit breaker controls downstream failure
```

Untuk worker-only app tanpa HTTP traffic, readiness tetap berguna untuk Kubernetes lifecycle dan deployment.

---

## 24. Metrics

Minimal metrics per worker:

```text
jobs_activated_total{job_type}
jobs_completed_total{job_type}
jobs_failed_total{job_type,error_category}
jobs_bpmn_error_total{job_type,error_code}
job_handler_duration_seconds{job_type}
job_variable_payload_bytes{job_type}
job_active_current{job_type}
job_retry_remaining{job_type}
job_incident_created_total{job_type}
external_call_duration_seconds{dependency}
external_call_failed_total{dependency,error_category}
idempotency_replay_total{job_type}
```

Tambahkan labels:

- process id,
- job type,
- worker name,
- tenant id jika aman,
- environment,
- app version.

Hindari label cardinality tinggi:

- jangan label dengan process instance key untuk metrics,
- jangan label dengan case id,
- jangan label dengan user id.

Gunakan logs/traces untuk high-cardinality correlation.

---

## 25. Logging

Setiap log worker penting harus membawa context:

```text
trace_id
span_id
process_instance_key
process_definition_key
bpmn_process_id
job_key
job_type
worker_name
tenant_id
business_key / case_id if allowed
attempt / retries
correlation_id
```

Example structured log concept:

```json
{
  "event": "camunda.worker.job.started",
  "jobType": "application.validate.v1",
  "jobKey": "2251799813685249",
  "processInstanceKey": "2251799813685001",
  "bpmnProcessId": "application-review",
  "caseId": "APP-2026-000123",
  "tenantId": "agency-a",
  "worker": "application-worker-service",
  "traceId": "..."
}
```

Rules:

1. Jangan log full variables.
2. Jangan log PII.
3. Log error category, not raw secret payload.
4. Log external reference id.
5. Log idempotency key hash, bukan data sensitif.
6. Log business decision code.

---

## 26. Tracing

Tracing untuk Camunda worker biasanya menghubungkan:

```text
incoming job handling span
  -> database span
  -> external API span
  -> job complete/fail command span
```

Problem:

- Zeebe job activation tidak selalu membawa distributed trace context natural seperti HTTP.
- Trace context harus dibuat/diteruskan melalui process variables atau headers jika diperlukan.
- Jangan menyimpan full trace payload sebagai business variable tanpa governance.

Pattern:

```text
process variable:
  correlationId = stable business/process correlation

worker creates span:
  job_type
  process_instance_key
  job_key
  correlation_id

external API call:
  propagates traceparent
```

Untuk regulated workflows, correlation ID lebih penting daripada trace ID yang ephemeral.

---

## 27. Security dan Secrets

Jangan letakkan secret di:

- BPMN variables,
- application.yml committed,
- logs,
- Operate-visible variables,
- Tasklist form variables,
- exception message.

Gunakan:

- Kubernetes Secret,
- AWS Secrets Manager / SSM Parameter Store,
- Vault,
- cloud IAM,
- workload identity,
- mTLS where needed.

Worker credentials harus least privilege:

```text
payment-worker-service
  -> can activate payment job types
  -> can complete/fail jobs
  -> cannot administer cluster
  -> cannot access unrelated tenant if avoidable
```

Jika platform belum mendukung fine-grained worker-level auth sesuai kebutuhan, enforce boundary via:

- network policy,
- separate credentials,
- separate cluster/tenant,
- deployment isolation,
- application-level guard.

---

## 28. Multi-Tenancy dalam Spring Worker

Jika Camunda tenant digunakan, worker perlu tenant-aware.

Risiko:

1. Worker memproses job tenant A tapi memanggil DB schema tenant B.
2. Variable tenant tidak cocok dengan auth token.
3. Shared cache bocor antar tenant.
4. Logs menggabungkan data tenant.
5. External API credential salah tenant.

Pattern:

```java
TenantContext tenant = TenantContext.from(job.getTenantId());

tenantGuard.assertSupported(tenant);
tenantDataSourceRouter.withTenant(tenant, () -> {
    useCase.execute(command);
});
```

Rule:

```text
Tenant id must become part of execution context before domain call.
```

Jangan biarkan tenant id hanya menjadi logging metadata.

---

## 29. Worker Header dan Custom Metadata

BPMN task headers bisa menyimpan metadata seperti:

```text
operation = verify-identity
schemaVersion = 1
riskLevel = high
downstream = myinfo
```

Gunakan header untuk metadata konfigurasi ringan yang melekat pada service task.

Jangan gunakan header untuk:

- secrets,
- large payload,
- dynamic business data,
- tenant-sensitive credential,
- data yang harus diaudit sebagai variable.

Worker bisa membaca custom headers untuk routing logic, tetapi hati-hati agar BPMN tidak menjadi scripting layer.

---

## 30. Input Validation

Setiap worker harus validate input sebelum domain call.

Tipe validation:

1. Structural:
   - variable exists,
   - type benar,
   - required fields.
2. Semantic:
   - amount positive,
   - status allowed,
   - date not impossible.
3. Contract:
   - schema version supported,
   - enum known,
   - tenant supported.
4. Security:
   - no forbidden tenant,
   - no PII leak,
   - user/task decision authorized if applicable.

Invalid variable contract biasanya bukan business rejection. Itu biasanya incident karena model/worker contract rusak.

```text
Missing applicationId
  -> incident / non-retryable failure

Application rejected due to ineligible applicant
  -> BPMN error / modelled business path
```

---

## 31. Output Variables

Worker output harus minimal.

Bad:

```json
{
  "riskEngineFullResponse": {
    "huge": "...",
    "rawPayload": "...",
    "debug": "...",
    "pii": "..."
  }
}
```

Better:

```json
{
  "riskAssessmentId": "RA-123",
  "riskScore": 72,
  "riskBand": "HIGH",
  "riskAssessedAt": "2026-06-21T10:15:30Z"
}
```

Untuk detail besar:

```text
store in domain DB/document store
put reference in process variable
```

---

## 32. Process Starter Controller

Spring Boot app sering menerima REST request lalu start process.

Example shape:

```java
@RestController
@RequestMapping("/applications")
public class ApplicationSubmissionController {

    private final ApplicationSubmissionService service;

    @PostMapping
    public ResponseEntity<SubmitApplicationResponse> submit(
            @Valid @RequestBody SubmitApplicationRequest request
    ) {
        SubmitApplicationResponse response = service.submit(request);
        return ResponseEntity.accepted().body(response);
    }
}
```

Service:

```text
1. Validate request.
2. Persist business aggregate.
3. Start process instance with stable business/correlation key.
4. Return application id + process instance key if allowed.
```

Important:

```text
Starting a process is a side effect. Make it idempotent.
```

If frontend retries POST due to network timeout, do not create duplicate process instances.

Pattern:

```text
idempotency key from client/request
  -> DB unique constraint
  -> if already submitted, return existing application id/process instance key
```

---

## 33. Publishing Messages from Spring Boot

Callback service:

```text
External system callback
  -> validate signature
  -> parse event
  -> deduplicate callback
  -> persist callback
  -> publish Camunda message
```

Do not publish directly without storing if callback is important.

Why?

1. Publish could fail.
2. Camunda may reject.
3. Duplicate callback may arrive.
4. Audit required.
5. Race condition with process wait state.

Better:

```text
transaction:
  insert callback_event if not exists
  mark as pending_publish

publisher:
  publish message with messageId
  mark published
```

Message publication must use:

- message name,
- correlation key,
- TTL,
- message ID for dedup where applicable,
- variables minimal.

---

## 34. Testing Strategy Overview

Spring Boot + Camunda 8 testing should not be one giant `@SpringBootTest` for everything.

Layered strategy:

```text
Domain unit test
  -> pure Java, no Camunda

Variable mapper test
  -> JSON/map conversion

Worker adapter test
  -> simulated ActivatedJob, mocked use case

Process test
  -> BPMN deployed into test runtime, workers mocked or real

Integration test
  -> Spring context + Camunda test runtime + DB/Testcontainers

End-to-end smoke
  -> real environment, minimal scenario
```

### 34.1 Domain Unit Test

Fast and pure:

```java
class RiskScoringServiceTest {

    @Test
    void shouldClassifyHighRiskApplication() {
        RiskResult result = service.calculate(...);

        assertThat(result.band()).isEqualTo(HIGH);
    }
}
```

No Camunda. No Spring unless necessary.

### 34.2 Variable Mapper Test

```java
class ChargePaymentVariableMapperTest {

    @Test
    void shouldMapRequiredVariables() {
        Map<String, Object> variables = Map.of(
            "paymentId", "PAY-123",
            "amount", "100.00",
            "currency", "SGD"
        );

        ChargePaymentCommand command = mapper.toCommand(variables);

        assertThat(command.paymentId()).isEqualTo("PAY-123");
    }

    @Test
    void shouldRejectMissingPaymentId() {
        Map<String, Object> variables = Map.of("amount", "100.00");

        assertThatThrownBy(() -> mapper.toCommand(variables))
            .isInstanceOf(InvalidProcessVariableException.class);
    }
}
```

### 34.3 Worker Adapter Test

Worker test verifies mapping and error behavior:

```java
class ChargePaymentWorkerTest {

    @Test
    void shouldReturnPaymentResultVariables() {
        // Arrange ActivatedJob-like fixture
        // Mock useCase
        // Assert returned variables
    }

    @Test
    void shouldMapBusinessRejectionToBpmnError() {
        // Arrange useCase throws BusinessRejectionException
        // Assert worker throws/makes BPMN error
    }
}
```

### 34.4 Process Test

Process test verifies BPMN path:

```text
Given process started with variables
When job "validate-application.v1" completes
Then process reaches user task "review-application"
```

Use Camunda Process Test or available starter test support.

Important test paths:

- happy path,
- BPMN error path,
- incident path,
- timer path,
- message correlation,
- multi-instance,
- call activity,
- versioned variable contract.

### 34.5 Integration Test

Use Testcontainers for:

- database,
- wiremock/mockserver,
- Camunda runtime if applicable,
- external dependencies.

Do not mock everything. At least test:

```text
worker -> DB -> outbox -> external stub -> job completion
```

---

## 35. Test Data Discipline

Process tests can become brittle if test variables are random maps.

Create fixtures:

```java
public final class ProcessVariablesFixture {

    public static Map<String, Object> validApplicationSubmission() {
        return Map.of(
            "applicationId", "APP-TEST-001",
            "applicantType", "INDIVIDUAL",
            "submittedAt", "2026-06-21T10:00:00Z",
            "schemaVersion", 1
        );
    }
}
```

Create object mother/builders:

```java
ApplicationSubmissionFixture.validHighRiskApplication()
ApplicationSubmissionFixture.validLowRiskApplication()
ApplicationSubmissionFixture.missingApplicantType()
```

Use stable test IDs. Avoid date `now()` unless injected clock is controlled.

---

## 36. BPMN Resource Testing

BPMN files are code.

Validate:

1. BPMN deploys.
2. Service task types are known.
3. Required variables are documented.
4. Error boundary references valid error codes.
5. Message names follow convention.
6. Timer expressions parse.
7. Call activity target process exists.
8. User task candidate groups are valid.
9. Form references exist.
10. Process id naming correct.

Create model validation test:

```text
For each BPMN:
  parse XML
  assert process id naming convention
  assert service task type not blank
  assert no forbidden connector in prod
  assert no hardcoded secret
```

---

## 37. Contract Testing Between BPMN and Worker

A service task has a contract:

```text
jobType: application.validate.v1
input variables:
  - applicationId: string required
  - applicantType: enum required
output variables:
  - validationStatus: enum required
errors:
  - APPLICATION_INVALID
  - DUPLICATE_APPLICATION
```

Represent contract as documentation and test.

Possible format:

```yaml
jobType: application.validate.v1
version: 1
inputs:
  applicationId:
    type: string
    required: true
  applicantType:
    type: string
    required: true
outputs:
  validationStatus:
    type: string
    required: true
bpmnErrors:
  - APPLICATION_INVALID
  - DUPLICATE_APPLICATION
```

Then test mapper against it.

This prevents silent breakage when BPMN changes variable names.

---

## 38. Local Developer Workflow

A productive local workflow:

```text
1. Start Camunda 8 local runtime.
2. Start mock external APIs.
3. Start local DB.
4. Run Spring Boot worker.
5. Deploy BPMN.
6. Start process instance.
7. Inspect Operate/Tasklist.
8. Run test scenario.
```

Keep commands documented:

```powershell
.\scripts\local\start-camunda.ps1
.\scripts\local\start-dependencies.ps1
.\mvnw spring-boot:run -Dspring-boot.run.profiles=local
.\scripts\local\start-process.ps1
```

For Windows-heavy team, provide PowerShell scripts.

---

## 39. Production Deployment Checklist for Spring Worker

Before deploying:

### Build

- [ ] Java version pinned.
- [ ] Spring Boot version pinned.
- [ ] Camunda starter version pinned.
- [ ] Dependency vulnerability scan done.
- [ ] Container image immutable tag.
- [ ] SBOM generated if required.

### Config

- [ ] Endpoint per environment.
- [ ] Auth secret resolved from secret manager.
- [ ] Worker config explicit.
- [ ] Timeouts explicit.
- [ ] No secret in config repo.
- [ ] Production profile disables dev-only behavior.

### Worker

- [ ] Job types documented.
- [ ] Fetch variables minimal.
- [ ] Idempotency implemented for side effects.
- [ ] Retry taxonomy implemented.
- [ ] BPMN errors mapped.
- [ ] Incident behavior intentional.
- [ ] Graceful shutdown tested.

### Observability

- [ ] Metrics exported.
- [ ] Logs structured.
- [ ] Correlation fields present.
- [ ] Alerts defined.
- [ ] Dashboard exists.
- [ ] Runbook exists.

### Testing

- [ ] Unit tests pass.
- [ ] Mapper tests pass.
- [ ] Worker adapter tests pass.
- [ ] BPMN process tests pass.
- [ ] Integration tests pass.
- [ ] Failure path tested.

### Release

- [ ] BPMN version compatibility checked.
- [ ] Worker version compatibility checked.
- [ ] Rollback plan documented.
- [ ] Smoke scenario ready.
- [ ] Incident owner assigned.

---

## 40. Common Anti-Patterns

### Anti-Pattern 1 — Worker Method Contains Everything

```java
@JobWorker(type = "process")
public Map<String, Object> process(ActivatedJob job) {
    // 300 lines of business, SQL, HTTP, error handling
}
```

Fix:

```text
worker adapter -> application use case -> domain/infrastructure ports
```

### Anti-Pattern 2 — Fetching All Variables

```text
fetchVariables = all
```

Fix:

```text
declare required input variables per worker
```

### Anti-Pattern 3 — Auto-Deploy in Production Without Governance

Fix:

```text
separate process deployment pipeline
```

### Anti-Pattern 4 — `@Transactional` Around External Call and Job Completion

Fix:

```text
idempotency + outbox + explicit completion semantics
```

### Anti-Pattern 5 — Same Concurrency for Every Worker

Fix:

```text
per-worker config based on downstream capacity and risk
```

### Anti-Pattern 6 — Retry Everything

Fix:

```text
error taxonomy:
  business error
  transient technical
  permanent technical
  contract bug
```

### Anti-Pattern 7 — No Graceful Shutdown

Fix:

```text
termination grace + stop activation + drain active jobs
```

### Anti-Pattern 8 — Treating Process Test as Only Happy Path

Fix:

```text
test errors, timers, messages, incidents, migration-sensitive path
```

### Anti-Pattern 9 — Logging Full Variables

Fix:

```text
structured safe logs, no PII
```

### Anti-Pattern 10 — Worker App Starts Process and Handles All Workers Without Idempotency

Fix:

```text
idempotent process starter + worker idempotency + stable correlation key
```

---

## 41. Recommended Package Structure

Example:

```text
com.company.applicationprocess
  ApplicationWorkerApp.java

com.company.applicationprocess.camunda
  CamundaClientConfig.java
  CamundaWorkerConfig.java
  CamundaProcessStarter.java
  CamundaMessagePublisher.java

com.company.applicationprocess.worker
  validation
    ValidateApplicationWorker.java
    ValidateApplicationVariableMapper.java
    ValidateApplicationErrorMapper.java
  assignment
    AssignReviewerWorker.java
    AssignReviewerVariableMapper.java
  notification
    SendNotificationWorker.java

com.company.applicationprocess.usecase
  ValidateApplicationUseCase.java
  AssignReviewerUseCase.java
  SendNotificationUseCase.java

com.company.applicationprocess.domain
  Application.java
  RiskBand.java
  ReviewDecision.java
  BusinessRuleViolation.java

com.company.applicationprocess.port
  ApplicationRepository.java
  RiskEnginePort.java
  NotificationPort.java
  IdempotencyPort.java
  OutboxPort.java

com.company.applicationprocess.adapter
  db
    JdbcApplicationRepository.java
  risk
    HttpRiskEngineClient.java
  notification
    EmailNotificationClient.java

com.company.applicationprocess.contract
  variables
    ValidateApplicationInput.java
    ValidateApplicationOutput.java
  errors
    ApplicationBpmnErrors.java
  jobtypes
    JobTypes.java

com.company.applicationprocess.observability
  WorkerLogContext.java
  WorkerMetrics.java

com.company.applicationprocess.config
  WorkerProperties.java
  ExternalApiProperties.java
```

Key point:

```text
Camunda-specific code stays near adapter layer.
Domain does not import Camunda classes.
```

---

## 42. Example: Production-Grade Worker Flow

Pseudo-flow:

```text
Job activated: application.validate.v1

1. Build log context from job metadata.
2. Extract tenant id.
3. Fetch and validate required variables.
4. Build command object.
5. Compute idempotency key:
   application.validate.v1 + processInstanceKey + applicationId + schemaVersion
6. Check idempotency store.
7. If already completed:
   return stored result variables.
8. Execute use case.
9. In local transaction:
   persist validation result.
   persist idempotency success.
10. Return output variables to complete job.
11. Metrics/log success.
```

Failure:

```text
Business invalid:
  -> throw BPMN error APPLICATION_INVALID

External validation system unavailable:
  -> fail job retry with backoff

Variable missing:
  -> fail job non-retryable / incident

Unexpected exception:
  -> fail job with retry until exhausted, alert
```

---

## 43. Example Worker Skeleton

Conceptual code:

```java
@Component
public final class ValidateApplicationWorker {

    private final ValidateApplicationUseCase useCase;
    private final ValidateApplicationVariableMapper variables;
    private final WorkerErrorMapper errors;
    private final WorkerMetrics metrics;

    public ValidateApplicationWorker(
            ValidateApplicationUseCase useCase,
            ValidateApplicationVariableMapper variables,
            WorkerErrorMapper errors,
            WorkerMetrics metrics
    ) {
        this.useCase = useCase;
        this.variables = variables;
        this.errors = errors;
        this.metrics = metrics;
    }

    @JobWorker(
        type = JobTypes.APPLICATION_VALIDATE_V1,
        fetchVariables = {
            "applicationId",
            "applicantType",
            "submittedAt",
            "schemaVersion"
        }
    )
    public Map<String, Object> handle(ActivatedJob job) {
        WorkerContext context = WorkerContext.from(job);

        try {
            metrics.jobStarted(context);

            ValidateApplicationCommand command = variables.toCommand(job, context);
            ValidateApplicationResult result = useCase.validate(command);

            Map<String, Object> output = variables.toOutput(result);

            metrics.jobCompleted(context);
            return output;

        } catch (ApplicationInvalidException ex) {
            metrics.bpmnError(context, "APPLICATION_INVALID");
            throw errors.bpmn("APPLICATION_INVALID", ex.safeMessage());

        } catch (ExternalDependencyUnavailableException ex) {
            metrics.jobRetryableFailure(context, "EXTERNAL_DEPENDENCY_UNAVAILABLE");
            throw errors.retryable("External validation dependency unavailable", ex);

        } catch (InvalidProcessContractException ex) {
            metrics.jobNonRetryableFailure(context, "INVALID_PROCESS_CONTRACT");
            throw errors.nonRetryable("Invalid process variable contract", ex);

        } catch (Exception ex) {
            metrics.jobUnexpectedFailure(context);
            throw errors.unexpected("Unexpected validation worker failure", ex);
        }
    }
}
```

Again: exact exception classes and API calls depend on the Camunda Spring Boot Starter version. Treat this as architecture skeleton.

---

## 44. Example Process Starter with Idempotency

```java
@Service
public class SubmitApplicationService {

    private final ApplicationRepository repository;
    private final ProcessStarter processStarter;

    @Transactional
    public SubmitApplicationResponse submit(SubmitApplicationRequest request) {
        IdempotencyKey key = IdempotencyKey.from(request.clientRequestId());

        ExistingSubmission existing = repository.findByIdempotencyKey(key);
        if (existing != null) {
            return existing.toResponse();
        }

        Application application = Application.create(request);

        repository.insert(application, key);

        ProcessStartResult process = processStarter.startApplicationReview(
            application.id(),
            Map.of(
                "applicationId", application.id().value(),
                "applicantType", application.applicantType().name(),
                "schemaVersion", 1
            )
        );

        repository.attachProcessInstance(application.id(), process.processInstanceKey());

        return new SubmitApplicationResponse(
            application.id().value(),
            process.processInstanceKey()
        );
    }
}
```

But careful: process start command is outside DB transaction atomicity unless you design outbox.

More robust:

```text
DB transaction:
  insert application
  insert outbox START_PROCESS command

outbox dispatcher:
  sends create process instance command
  stores process instance key
```

This avoids:

```text
DB committed but process not started
process started but DB rolled back
```

Choose based on risk.

---

## 45. Process Deployment from Pipeline

Recommended production flow:

```text
git commit BPMN
  -> validate BPMN
  -> run process tests
  -> build artifact
  -> manual/automated approval
  -> deploy BPMN to target environment
  -> deploy worker version
  -> smoke test
  -> monitor incidents
```

Store metadata:

```text
process id
process version
deployment id/key
git commit
model checksum
worker app version
release ticket
approver
deployment timestamp
```

For regulated systems, this metadata is valuable evidence.

---

## 46. Handling Multiple Process Versions

Worker may receive jobs from old and new process versions.

Example:

```text
process v1 emits job type application.validate.v1
process v2 emits job type application.validate.v2
```

Option 1: maintain two workers:

```java
@JobWorker(type = "application.validate.v1")
public Map<String, Object> validateV1(...) {}

@JobWorker(type = "application.validate.v2")
public Map<String, Object> validateV2(...) {}
```

Option 2: one worker supports both schema versions:

```java
@JobWorker(type = "application.validate")
public Map<String, Object> validate(ActivatedJob job) {
    int schemaVersion = getSchemaVersion(job);
    return switch (schemaVersion) {
        case 1 -> handleV1(job);
        case 2 -> handleV2(job);
        default -> throw unsupportedContract(...);
    };
}
```

For high-risk changes, prefer explicit versioned job type.

Rule:

```text
Do not deploy BPMN that emits a job type unsupported by currently deployed workers.
```

---

## 47. Migration from Spring Zeebe SDK to Camunda Spring Boot Starter

Migration concerns:

1. Dependency artifact changes.
2. Package/class import changes.
3. Client bean type changes.
4. Configuration property changes.
5. REST default instead of gRPC default.
6. Authentication property differences.
7. Worker annotation compatibility.
8. Test library updates.
9. Error handling behavior differences.
10. Metrics/actuator behavior differences.

Migration approach:

```text
1. Inventory current usage.
2. Identify direct ZeebeClient references.
3. Wrap client usage behind internal interface.
4. Upgrade dependency in branch.
5. Fix imports/config.
6. Run worker adapter tests.
7. Run BPMN process tests.
8. Validate protocol behavior.
9. Validate auth behavior.
10. Deploy to lower env with canary worker.
11. Monitor job activation/completion/failure.
```

Do not combine this migration with BPMN redesign unless necessary.

---

## 48. Design Review Questions

For every Spring Boot Camunda worker app, ask:

1. What job types does this app own?
2. Are job types versioned?
3. What variables does each worker fetch?
4. Are variables validated?
5. What is the idempotency key?
6. What happens if handler succeeds but job completion fails?
7. What happens if external API succeeds but worker times out?
8. What errors become BPMN errors?
9. What errors become retryable failures?
10. What errors become incidents?
11. What is maxJobsActive per worker?
12. Is downstream capacity known?
13. What are HTTP/DB/job timeouts?
14. How does graceful shutdown work?
15. Are logs structured and safe?
16. Are metrics available per job type?
17. Is process deployment governed?
18. Can worker process old process versions?
19. Is tenant context enforced?
20. How is this tested?

If the team cannot answer these, the worker is not production-ready.

---

## 49. Mini Case Study: Regulatory Application Review Worker App

Scenario:

```text
Applicant submits license application.
Process:
  validate submission
  check duplicate
  calculate risk
  assign reviewer
  wait human review
  send decision
```

Spring Boot services:

```text
application-api-service
  - submit application
  - idempotent process starter

application-worker-service
  - validate submission
  - check duplicate
  - calculate risk
  - assign reviewer
  - send notification

application-callback-service
  - receives external screening result
  - publishes Camunda message
```

Workers:

```text
application.validate-submission.v1
application.check-duplicate.v1
risk.calculate-score.v1
case.assign-reviewer.v1
notification.send-decision.v1
```

Per-worker config:

```yaml
app:
  workers:
    validate-submission:
      max-jobs-active: 16
      timeout: PT1M

    check-duplicate:
      max-jobs-active: 8
      timeout: PT2M

    calculate-risk:
      max-jobs-active: 4
      timeout: PT3M

    assign-reviewer:
      max-jobs-active: 16
      timeout: PT30S

    send-decision:
      max-jobs-active: 32
      timeout: PT30S
```

Error mapping:

```text
Missing applicationId
  -> incident

Duplicate application found
  -> BPMN error DUPLICATE_APPLICATION

Risk engine unavailable
  -> retryable fail

Risk engine returns invalid response
  -> incident

Reviewer pool empty
  -> BPMN error NO_REVIEWER_AVAILABLE or escalation user task, depending business design
```

Observability:

```text
dashboard:
  - jobs completed by type
  - failures by error category
  - incidents by process id
  - risk API latency
  - duplicate check DB latency
  - notification failures
  - process SLA breach
```

This is how Spring Boot worker integration becomes part of serious case lifecycle engineering.

---

## 50. Final Mental Model

Spring Boot is not the process engine. It is the **execution adapter runtime** for business capabilities.

Camunda owns:

```text
durable orchestration state
process instance progression
job creation
wait states
incidents
message correlation
timer scheduling
```

Spring Boot worker owns:

```text
business execution
external side effects
local transactions
idempotency
validation
error mapping
observability
operational behavior
```

The boundary is the job contract:

```text
BPMN service task
  -> job type
  -> input variables
  -> worker handler
  -> domain use case
  -> output variables / BPMN error / job failure
```

If this boundary is clean, the system stays evolvable.

If this boundary is messy, Camunda becomes an expensive distributed bug amplifier.

---

## 51. References

Primary references used for this part:

1. Camunda Docs — Camunda Spring Boot Starter Getting Started  
   `https://docs.camunda.io/docs/apis-tools/camunda-spring-boot-starter/getting-started/`

2. Camunda Docs — Java Client Getting Started  
   `https://docs.camunda.io/docs/apis-tools/java-client/getting-started/`

3. Camunda Docs — Job Worker  
   `https://docs.camunda.io/docs/apis-tools/java-client/job-worker/`

4. Camunda Docs — Migrate to Camunda Spring Boot Starter  
   `https://docs.camunda.io/docs/apis-tools/migration-manuals/migrate-to-camunda-spring-boot-starter/`

5. Camunda Docs — Testing Process Definitions  
   `https://docs.camunda.io/docs/components/best-practices/development/testing-process-definitions/`

6. Camunda Docs — Camunda Process Test  
   `https://docs.camunda.io/docs/apis-tools/testing/getting-started/`

7. Camunda Docs — Job Workers Concept  
   `https://docs.camunda.io/docs/components/concepts/job-workers/`

8. Camunda Docs — Variables  
   `https://docs.camunda.io/docs/components/concepts/variables/`

9. Camunda Docs — Dealing with Problems and Exceptions  
   `https://docs.camunda.io/docs/components/best-practices/development/dealing-with-problems-and-exceptions/`

---

## 52. Ringkasan

Bagian ini membahas integrasi Spring Boot dengan Camunda 8 bukan sebagai “cara pakai annotation”, tetapi sebagai production engineering discipline.

Key takeaways:

1. Camunda Spring Boot Starter modern menggantikan Spring Zeebe SDK lama pada jalur Camunda 8.8+.
2. Spring worker adalah adapter, bukan domain core.
3. Worker type adalah contract.
4. Fetch variables harus minimal dan eksplisit.
5. `@Transactional` tidak membuat Zeebe job completion dan external API call menjadi atomic.
6. Idempotency wajib untuk side effect.
7. Per-worker concurrency harus mengikuti downstream capacity dan business risk.
8. Auto-deploy BPMN di production perlu governance.
9. Observability harus process-aware.
10. Testing harus layered: domain, mapper, worker, process, integration, failure path.
11. Java 8 lebih cocok sebagai legacy service di belakang modern worker bridge, bukan baseline baru untuk Camunda 8 Spring worker.
12. Production worker harus bisa menjawab: timeout, retry, error taxonomy, graceful shutdown, metrics, logs, tenant, version compatibility, dan rollback.

---

## 53. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-015.md
```

Judul:

```text
Part 015 — Worker Application Architecture: Hexagonal Boundaries, Ports, Adapters, and Contract Isolation
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-013.md">⬅️ Part 013 — User Tasks, Tasklist, Forms, Assignment, Candidate Groups, and Human Workflow Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-015.md">Part 015 — Worker Application Architecture: Hexagonal Boundaries, Ports, Adapters, and Contract Isolation ➡️</a>
</div>
