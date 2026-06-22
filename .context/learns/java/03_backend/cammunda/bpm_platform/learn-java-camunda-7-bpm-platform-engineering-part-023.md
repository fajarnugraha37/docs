# learn-java-camunda-7-bpm-platform-engineering-part-023.md

# Part 023 — REST API, Client Architecture, OpenAPI, Remote Engine, dan API Governance

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Fokus: Camunda BPM Platform / Camunda 7 (`version <= 7`)  
> Target pembaca: Java engineer yang ingin naik dari “bisa pakai REST API Camunda” menjadi mampu mendesain boundary API, client architecture, security, reliability, dan governance untuk workflow platform production-grade.  
> Java scope: Java 8 hingga Java 25, dengan catatan compatibility mengikuti versi Camunda 7, Spring, servlet container, dan dependency runtime yang dipakai.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- engine internals,
- transaction boundary,
- job executor,
- database schema,
- variable serialization,
- delegation code,
- external task,
- message correlation,
- human task,
- history,
- incident,
- versioning,
- multi-tenancy,
- security,
- Spring Boot integration,
- Java EE/Jakarta EE runtime integration.

Bagian ini membahas layer yang sering kelihatan sederhana tetapi sangat berbahaya bila dipakai tanpa desain: **Camunda REST API**.

REST API Camunda 7 memberi akses luas ke engine:

- start process instance,
- query process definition,
- query process instance,
- correlate message,
- complete task,
- claim task,
- set variable,
- query history,
- inspect incidents,
- manage jobs,
- deploy BPMN/DMN,
- operate batch,
- evaluate decision,
- fetch external task,
- dan banyak lagi.

Dari sisi engineering, pertanyaan pentingnya bukan:

> “Bagaimana cara memanggil endpoint Camunda?”

Pertanyaan yang lebih senior adalah:

> “Siapa yang boleh memanggil endpoint engine, untuk use case apa, dengan payload apa, memakai identity apa, di boundary transaction mana, dengan audit apa, dan apa konsekuensi failure-nya?”

Itulah inti part ini.

---

## 2. Mental Model: Camunda REST API adalah Engine API, Bukan Domain API

Camunda REST API adalah HTTP surface untuk operasi process engine. Ia sangat berguna untuk:

- remote client,
- administration,
- operational tooling,
- custom UI,
- worker integration,
- platform gateway,
- automation,
- migration tooling,
- diagnostics,
- integration testing.

Tetapi ia **bukan otomatis domain API**.

Contoh endpoint seperti:

```http
POST /engine-rest/task/{id}/complete
```

secara teknis berarti:

> complete user task di engine.

Tetapi dalam domain regulatory workflow, aksi itu mungkin berarti:

- officer menyetujui application,
- reviewer menolak appeal,
- supervisor meng-endorse enforcement action,
- investigator menutup case,
- manager meminta rework,
- legal officer mengirim matter ke prosecution.

Itu bukan sekadar `complete task`. Itu adalah **business state transition**.

Domain API seharusnya berbicara dengan bahasa domain:

```http
POST /cases/{caseId}/review-decisions
POST /applications/{applicationId}/approve
POST /appeals/{appealId}/reject
POST /enforcement-cases/{caseId}/escalate
POST /inspections/{inspectionId}/submit-findings
```

Lalu domain/application service melakukan:

1. authenticate user,
2. load domain aggregate/read model,
3. validate authorization,
4. validate current state,
5. validate assignment/ownership,
6. validate four-eyes principle,
7. validate payload,
8. persist domain decision/audit,
9. call Camunda API,
10. handle rollback/failure,
11. publish/outbox event jika perlu.

Camunda REST API berada di bawah domain API, bukan menggantikannya.

---

## 3. Layering yang Sehat

### 3.1 Anti-pattern: frontend langsung ke Camunda REST

Bentuk buruk:

```text
Browser SPA
  -> Camunda REST API
      -> Process Engine
          -> Camunda DB
```

Risiko:

- frontend mengetahui task id internal,
- user bisa memanggil endpoint engine yang tidak dimaksudkan,
- authorization domain sulit diterapkan,
- variable arbitrary bisa dikirim dari browser,
- endpoint history/runtime bisa bocor data,
- REST API menjadi public attack surface,
- audit business decision tidak lengkap,
- tenant boundary rawan bocor,
- process model coupling ke frontend terlalu kuat,
- upgrade/migration engine berdampak langsung ke client.

### 3.2 Pattern yang lebih aman: domain API di depan engine

Bentuk lebih sehat:

```text
Browser SPA / Mobile / Partner Client
  -> Application/API Gateway
      -> Domain Application Service
          -> Authorization Policy
          -> Domain Audit
          -> Camunda Client Adapter
              -> Camunda REST API or Java API
                  -> Process Engine
                      -> Camunda DB
```

Prinsipnya:

- external client tidak bicara bahasa engine,
- domain service menjaga business invariant,
- Camunda menjadi durable workflow runtime,
- payload variable dikontrol,
- audit domain tidak bergantung penuh pada history Camunda,
- engine bisa diganti/migrasi lebih mudah.

---

## 4. REST API Surface Camunda 7

Camunda REST API 7.24 dipublikasikan sebagai OpenAPI specification. Secara umum area endpoint mencakup:

| Area | Contoh Resource | Fungsi |
|---|---|---|
| Engine | `/engine` | daftar engine |
| Deployment | `/deployment` | deploy/read/delete deployment |
| Process Definition | `/process-definition` | query/start/suspend definition |
| Process Instance | `/process-instance` | query/suspend/delete/modify instance |
| Execution | `/execution` | query execution/correlate signal/message use cases tertentu |
| Task | `/task` | query/claim/complete/assign/delegate task |
| Variable | beberapa endpoint | read/set variable runtime/task/history |
| Message | `/message` | correlate message |
| Signal | `/signal` | broadcast signal |
| Job | `/job` | query/set retries/execute/delete job |
| Incident | `/incident` | query/resolve incident |
| External Task | `/external-task` | fetch-lock/complete/failure/BPMN error |
| History | `/history/*` | historic process/task/activity/variable/log |
| Authorization | `/authorization` | manage authorization |
| Identity | `/identity`, `/user`, `/group` | identity operations tergantung setup |
| Decision | `/decision-definition` | evaluate DMN |
| Batch | `/batch` | async batch operation |
| Metrics | `/metrics` | engine metrics |

Mental model:

- Runtime endpoints memengaruhi **live process state**.
- History endpoints membaca **historical projection**.
- Repository endpoints memengaruhi **deployed executable artifacts**.
- Management endpoints memengaruhi **operator-level runtime behavior**.
- Authorization/Identity endpoints memengaruhi **security model engine**.

Tidak semua endpoint punya risk level yang sama.

---

## 5. Risk Classification Endpoint

### 5.1 Read-only low/moderate risk

Contoh:

```http
GET /process-definition
GET /task?assignee=demo
GET /history/process-instance/{id}
```

Tetap berisiko karena bisa membuka:

- PII,
- confidential case data,
- variable payload,
- process metadata,
- user/task assignment,
- tenant data.

Read-only bukan berarti aman.

### 5.2 Runtime mutation high risk

Contoh:

```http
POST /process-definition/key/{key}/start
POST /task/{id}/complete
POST /message
PUT /process-instance/{id}/suspended
POST /process-instance/{id}/modification
```

Risiko:

- state transition tidak sah,
- bypass business rule,
- duplicate operation,
- wrong tenant,
- lost audit,
- variable injection,
- incident karena downstream failure,
- regulatory evidence rusak.

### 5.3 Operational/admin critical risk

Contoh:

```http
POST /deployment/create
DELETE /deployment/{id}
PUT /job/{id}/retries
POST /job/{id}/execute
DELETE /process-instance/{id}
POST /migration/execute
POST /batch
```

Endpoint seperti ini sebaiknya hanya bisa diakses operator/tooling terkontrol.

---

## 6. Remote Engine Architecture

Camunda 7 bisa dipakai embedded atau remote.

### 6.1 Embedded engine

```text
Application JVM
  - Spring Boot / Java EE app
  - ProcessEngine
  - Delegates
  - Job Executor
  - DB datasource
```

Kelebihan:

- Java API langsung,
- transaction integration lebih natural,
- low latency,
- delegate dekat dengan domain service,
- deployment sederhana untuk small/modular monolith.

Kekurangan:

- coupling engine dengan aplikasi,
- scaling engine mengikuti aplikasi,
- upgrade engine terkait release aplikasi,
- raw engine API mudah bocor ke layer lain.

### 6.2 Remote engine via REST

```text
Business Service / UI Gateway / Worker
  -> HTTP
      -> Camunda REST API
          -> Process Engine
              -> Camunda DB
```

Kelebihan:

- engine bisa dipisah sebagai platform,
- client polyglot,
- deployment lifecycle lebih terpisah,
- cocok untuk shared workflow platform,
- bisa membuat domain gateway khusus.

Kekurangan:

- network failure,
- authentication/authorization lebih kompleks,
- transaction tidak menyatu dengan caller DB,
- payload serialization perlu disiplin,
- client harus menangani retries/idempotency,
- governance API lebih penting.

### 6.3 Remote engine bukan berarti public engine

Remote engine sebaiknya tetap berada di network internal.

Pattern aman:

```text
External Client
  -> Public API Gateway
      -> Domain API
          -> Internal Camunda Gateway/Client
              -> Camunda REST API (private network)
```

Camunda REST jarang layak menjadi direct public API.

---

## 7. Camunda Client Adapter Pattern

Jangan menyebar HTTP call ke Camunda di seluruh codebase.

Buat adapter khusus:

```java
public interface WorkflowRuntime {
    StartedProcess startApplicationReview(StartApplicationReviewCommand command);
    void completeReviewTask(CompleteReviewTaskCommand command);
    void correlatePaymentReceived(PaymentReceivedEvent event);
    void cancelCase(CancelCaseCommand command);
}
```

Implementasi bisa memakai:

- Java API langsung,
- Camunda REST API,
- generated OpenAPI client,
- custom HTTP client,
- test fake.

Keuntungan:

- domain layer tidak bergantung ke Camunda DTO,
- payload variable bisa distandardisasi,
- idempotency bisa dipusatkan,
- logging/correlation id bisa konsisten,
- error mapping bisa eksplisit,
- migration ke Camunda 8/engine lain lebih realistis.

---

## 8. Generated OpenAPI Client vs Handwritten Client

Camunda 7 REST API punya OpenAPI spec. Ini membuka pilihan memakai generated client.

### 8.1 Generated client

Kelebihan:

- coverage endpoint luas,
- DTO sesuai spec,
- lebih cepat bootstrap,
- mengurangi typo path/field,
- cocok untuk admin tool.

Kekurangan:

- terlalu luas untuk domain app,
- raw DTO engine bisa bocor,
- error handling sering generik,
- payload variable masih butuh policy,
- generated code bisa berubah saat upgrade spec,
- client kadang terlalu teknis untuk business use case.

### 8.2 Handwritten minimal client

Kelebihan:

- hanya expose operasi yang dipakai,
- mudah diberi idempotency/logging/retry,
- domain-oriented,
- lebih mudah diuji,
- contract lebih stabil.

Kekurangan:

- coverage terbatas,
- maintenance manual,
- perlu disiplin dengan spec.

### 8.3 Rekomendasi praktis

Untuk enterprise platform:

- gunakan generated client di layer infrastructure/internal,
- bungkus dengan domain-specific adapter,
- jangan expose generated client langsung ke application service luas,
- jangan expose generated DTO ke controller/frontend.

---

## 9. Authentication untuk REST API

Camunda REST API perlu diamankan. Dalam distribusi tertentu, REST API tidak otomatis aman untuk production tanpa konfigurasi security tambahan.

Pilihan umum:

1. Basic authentication filter,
2. container-managed security,
3. reverse proxy authentication,
4. Spring Security wrapper,
5. OAuth2/OIDC gateway di depan Camunda,
6. mTLS internal service-to-service,
7. network segmentation + service identity.

Pertanyaan desain:

- Apakah caller adalah user manusia atau service account?
- Apakah identity user perlu diteruskan ke engine?
- Apakah Camunda authorization digunakan?
- Apakah audit user operation log butuh authenticated user id?
- Apakah endpoint hanya internal?
- Apakah REST API berada di balik gateway?

Untuk production, jangan mengandalkan “hanya internal network” sebagai satu-satunya kontrol.

---

## 10. User Identity Propagation

Salah satu masalah remote engine:

> Siapa user yang sedang melakukan operasi engine?

Jika domain API menerima JWT user lalu memanggil Camunda REST dengan satu service account, Camunda mungkin hanya melihat service account sebagai operator.

Dampaknya:

- Camunda user operation log tidak mencatat user asli,
- authorization engine tidak bisa menilai permission user asli,
- audit teknis kurang bermakna.

Ada beberapa strategi:

### 10.1 Service account only

```text
User -> Domain API -> Camunda as workflow-service
```

Cocok jika:

- authorization dilakukan penuh di domain API,
- domain audit mencatat user asli,
- Camunda authorization tidak menjadi primary business control.

Risiko:

- Camunda-level audit menunjukkan service account,
- operator harus melihat domain audit untuk user asli.

### 10.2 Per-user authentication to Camunda

```text
User token -> Domain API -> Camunda as same user
```

Cocok jika:

- Camunda authorization dipakai serius,
- user operation log penting,
- Camunda webapps juga memakai identity yang sama.

Risiko:

- integration security lebih kompleks,
- token propagation perlu hati-hati,
- domain authorization tetap tidak boleh hilang.

### 10.3 Hybrid

- domain API melakukan business authorization,
- Camunda call memakai service account,
- user asli disimpan di domain audit,
- optional variable/audit metadata menyimpan `actorUserId`, `actorRole`, `actorAgency`, `decisionId`.

Untuk regulatory platform, hybrid sering realistis, asalkan domain audit kuat.

---

## 11. Authorization Boundary

Camunda authorization menjawab pertanyaan seperti:

- apakah user boleh membaca task?
- apakah user boleh complete task?
- apakah user boleh start process definition?
- apakah user boleh access process instance?

Tetapi business authorization menjawab pertanyaan lebih kaya:

- apakah officer ini berada di agency yang benar?
- apakah ia boleh memproses case kategori ini?
- apakah ia sedang menjadi assignee valid?
- apakah ia punya conflict of interest?
- apakah ia mencoba approve keputusan yang ia buat sendiri?
- apakah case sedang berada pada status yang memungkinkan aksi ini?
- apakah SLA extension butuh supervisor?
- apakah document/evidence mandatory sudah lengkap?

Jangan campur dua layer ini.

Pattern:

```text
Controller
  -> AuthenticatedPrincipal
  -> DomainPolicy.check(command, principal, aggregate)
  -> DomainAudit.recordDecision(...)
  -> WorkflowRuntime.completeTask(...)
```

Camunda authorization bisa menjadi tambahan, bukan satu-satunya kontrol.

---

## 12. Variable API Governance

Endpoint variable sangat kuat dan berbahaya.

Contoh mutation:

```http
PUT /process-instance/{id}/variables/{varName}
POST /task/{id}/complete
```

Dengan body berisi variables.

Risiko:

- client bisa mengubah routing variable,
- variable injection bisa memaksa gateway path,
- serialized object bisa menjadi classpath/security issue,
- large variable bisa membebani DB,
- PII bisa masuk history,
- malformed JSON bisa merusak downstream delegate,
- versioning variable tidak terkendali.

### 12.1 Variable allowlist

Untuk setiap use case, definisikan variable yang boleh ditulis.

Contoh:

```text
Complete review task allowed variables:
- reviewDecision: string enum {APPROVE, REJECT, REQUEST_INFO}
- reviewDecisionId: string
- reviewCommentSummary: string <= 500 chars
```

Tidak boleh:

```text
- assignee
- tenantId
- caseStatus
- approvedBySupervisor
- riskScore
- arbitrary JSON object
```

### 12.2 Variable write through domain command

Jangan menerima map arbitrary dari frontend:

```java
// buruk
completeTask(String taskId, Map<String, Object> variables)
```

Lebih baik:

```java
record CompleteReviewCommand(
    String caseId,
    String taskId,
    ReviewDecision decision,
    String comment,
    String idempotencyKey
) {}
```

Lalu mapper internal menentukan variable Camunda.

---

## 13. Task API Governance

Task endpoint sering dipakai custom Tasklist.

Common operations:

```http
GET /task
POST /task/{id}/claim
POST /task/{id}/unclaim
POST /task/{id}/complete
POST /task/{id}/delegate
POST /task/{id}/resolve
```

Risiko:

- task query tanpa tenant filter,
- candidate group spoofing,
- complete task tanpa domain validation,
- claim task milik orang lain,
- double completion,
- stale task id,
- wrong process definition/version,
- bypass custom UI policy.

### 13.1 Safer tasklist architecture

```text
Custom Tasklist UI
  -> Task API Facade
      -> query domain work queue projection
      -> enrich with Camunda task state if needed
      -> enforce user/tenant/role filters
      -> return DTO minimal
```

Jangan tampilkan semua raw task variable.

DTO yang lebih aman:

```json
{
  "workItemId": "WRK-123",
  "caseId": "CASE-2026-0001",
  "taskId": "camunda-task-id-hidden-or-opaque",
  "title": "Review application",
  "assignedToMe": true,
  "dueDate": "2026-06-25T10:00:00Z",
  "allowedActions": ["APPROVE", "REJECT", "REQUEST_INFO"]
}
```

---

## 14. Starting Process via REST

Common endpoint:

```http
POST /process-definition/key/{key}/start
```

Potential design bug:

- start duplicate process for same business object,
- wrong tenant,
- wrong process version,
- missing business key,
- variables not versioned,
- no idempotency,
- no domain record.

### 14.1 Safer start command

```java
record StartCaseWorkflowCommand(
    String caseId,
    String tenantId,
    String processKey,
    String idempotencyKey,
    String initiatedBy
) {}
```

Before calling Camunda:

1. check case exists,
2. check no active workflow for same case unless allowed,
3. persist domain workflow link,
4. decide business key,
5. set minimal startup variables,
6. record audit,
7. call Camunda.

### 14.2 Business key

Business key is not mandatory technically, but highly valuable operationally.

Use it for:

- correlation,
- support lookup,
- audit join,
- idempotency,
- user-facing traceability.

Do not put PII directly in business key.

---

## 15. Message Correlation via REST

Common endpoint:

```http
POST /message
```

Typical payload:

```json
{
  "messageName": "PaymentReceived",
  "businessKey": "APP-2026-00123",
  "processVariables": {
    "paymentReference": { "value": "PAY-987", "type": "String" }
  }
}
```

Risks:

- correlation ambiguity,
- early message before subscription,
- duplicate webhook,
- wrong tenant,
- arbitrary variable injection,
- remote caller treats correlation as queue.

Safer pattern:

```text
External System
  -> Inbound Event API
      -> Inbox table/idempotency
      -> Validate event
      -> Find business object
      -> Correlate Camunda message
      -> Store result
```

Never expose `/engine-rest/message` directly as public webhook.

---

## 16. Process Instance Modification API

Process instance modification is powerful.

It can:

- start before activity,
- cancel activity instance,
- cancel transition instance,
- set variables,
- modify running state.

It is useful for:

- operational repair,
- migration support,
- exceptional recovery,
- admin tool.

It is dangerous because:

- can bypass normal BPMN path,
- may violate domain invariant,
- may create impossible process state,
- can break audit narrative,
- can trigger side effects unexpectedly.

Governance:

- only available to privileged operator,
- require reason code,
- require approval/four-eyes for regulated process,
- log before/after state,
- test modification scenario in lower environment,
- prefer BPMN recovery path if repeatable business need exists.

---

## 17. Job and Incident REST Operations

Useful endpoints include:

```http
GET /job
PUT /job/{id}/retries
POST /job/{id}/execute
GET /incident
DELETE /incident/{id}
```

Operator use cases:

- inspect failed job,
- increase retries after downstream recovery,
- execute job manually,
- resolve incident,
- correlate incident with deployment/process/business object.

Design concern:

- setting retries blindly can create retry storm,
- executing job manually can duplicate side effects,
- resolving incident without fixing root cause hides failure,
- deleting/altering runtime state may destroy traceability.

Operator tooling should show:

- process instance id,
- business key,
- process definition key/version,
- job id,
- activity id,
- exception message,
- retries,
- due date,
- lock owner,
- lock expiration,
- incident id,
- tenant id,
- last deployment,
- relevant domain case id.

---

## 18. History REST API and Reporting

History endpoints are tempting for reporting:

```http
GET /history/process-instance
GET /history/activity-instance
GET /history/task
GET /history/variable-instance
GET /history/detail
```

But direct reporting from Camunda operational DB has risks:

- large scans,
- expensive joins,
- variable/history detail explosion,
- PII exposure,
- operational DB load,
- history cleanup changes data availability,
- query semantics tied to engine schema/version.

For serious analytics:

```text
Camunda History
  -> ETL/CDC/export
      -> Reporting Store / Warehouse / Search Index
          -> BI / dashboards / SLA reports
```

Operational UI may query history directly for one case/process instance. Enterprise reporting should usually use projection.

---

## 19. Pagination, Sorting, and Query Cost

Camunda REST query endpoints often support:

- filters,
- pagination,
- sorting,
- POST query variants for complex filters.

Governance principles:

- always paginate,
- never expose unlimited search,
- force tenant/agency filter,
- avoid variable-based broad search without index/read model,
- avoid sorting by expensive fields at scale,
- cap page size,
- use domain projection for high-volume worklists,
- measure SQL generated by high-frequency endpoints.

Bad endpoint design:

```http
GET /api/tasks?search=anything&pageSize=10000
```

Better:

```http
GET /api/work-items?queue=MY_TEAM&status=OPEN&limit=50&cursor=...
```

---

## 20. Error Mapping for Camunda REST Client

REST client should not leak raw HTTP exceptions everywhere.

Map errors into meaningful categories:

| Condition | Client Error Type | Typical Handling |
|---|---|---|
| 400 bad request | InvalidWorkflowCommand | bug/input validation |
| 401/403 | WorkflowAccessDenied | security failure |
| 404 task/process not found | WorkflowObjectNotFound | stale UI/id mismatch |
| 409 conflict | WorkflowConcurrencyConflict | reload/retry depending action |
| 500 engine error | WorkflowEngineFailure | retry/incident/operator |
| timeout | WorkflowTransportFailure | retry with idempotency |
| connection refused | WorkflowUnavailable | circuit breaker/fallback |

Example adapter style:

```java
try {
    camundaTaskApi.complete(taskId, request);
} catch (CamundaRestConflictException e) {
    throw new WorkflowConcurrencyConflict("Task was already completed or changed", e);
} catch (CamundaRestNotFoundException e) {
    throw new WorkflowObjectNotFound("Task no longer exists", e);
} catch (CamundaRestServerException e) {
    throw new WorkflowEngineFailure("Camunda failed while completing task", e);
}
```

---

## 21. Retry Policy for REST Client

Do not retry every POST blindly.

Classify operation:

### 21.1 Safe to retry with idempotency

- start process with business key/idempotency guard,
- correlate event with inbox deduplication,
- complete task with domain decision idempotency,
- set retries with operator command idempotency.

### 21.2 Dangerous to retry blindly

- complete task with side-effect downstream synchronous path,
- start process without uniqueness guard,
- deployment create,
- process instance modification,
- job execute,
- signal broadcast.

### 21.3 Transport timeout ambiguity

If client times out, request may have:

- not reached Camunda,
- reached Camunda but failed,
- reached Camunda and committed,
- committed but response lost.

Therefore idempotency should be controlled at domain level.

---

## 22. Circuit Breaker and Bulkhead

Remote engine calls should be protected.

Use:

- connection timeout,
- read timeout,
- bounded connection pool,
- retry with jitter for transient failure,
- circuit breaker for prolonged outage,
- bulkhead per operation type,
- backpressure for high-volume operations,
- rate limiting for external clients,
- graceful degradation for read-only dashboards.

But do not hide process failure.

For mutation:

- fail fast if engine unavailable,
- persist pending command/outbox if architecture supports it,
- show user clear state,
- avoid duplicate resubmission.

---

## 23. REST API in Java 8–25

Client choices vary by Java version.

### 23.1 Java 8

Common options:

- Apache HttpClient,
- OkHttp,
- Spring RestTemplate,
- Feign,
- Jersey/JAX-RS client,
- Retrofit.

Java 8 lacks standard `java.net.http.HttpClient`.

### 23.2 Java 11+

Java provides standard HTTP client:

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(3))
    .build();
```

Useful for lightweight clients.

### 23.3 Java 17/21/25

Modern runtime advantages:

- better TLS defaults,
- better GC choices,
- virtual threads from Java 21,
- structured concurrency in newer Java previews/incubators depending version,
- better observability integrations.

But Camunda 7 compatibility is not “any Java works”. Always check:

- Camunda minor version,
- servlet container,
- Spring Boot version,
- `javax`/`jakarta` namespace,
- JDBC driver,
- generated client dependency.

### 23.4 Virtual threads caution

Virtual threads can help remote client concurrency, but they do not remove:

- Camunda DB bottleneck,
- job executor contention,
- task query cost,
- API rate limits,
- transaction boundary problems.

Use virtual threads as concurrency implementation detail, not architecture excuse.

---

## 24. Example: Domain API Completing a Review Task

### 24.1 Public endpoint

```http
POST /cases/{caseId}/review-decision
```

Payload:

```json
{
  "taskId": "opaque-task-token-or-id",
  "decision": "APPROVE",
  "comment": "All required documents verified.",
  "idempotencyKey": "8f7718fd-0a8f-4db1-88bb-2cf4d7e5e3a1"
}
```

### 24.2 Application service flow

```java
@Transactional
public ReviewDecisionResult submitReviewDecision(
    String caseId,
    SubmitReviewDecisionRequest request,
    Principal principal
) {
    CaseRecord caseRecord = caseRepository.getForUpdate(caseId);

    authorizationPolicy.assertCanReview(principal, caseRecord);
    taskPolicy.assertTaskBelongsToCase(request.taskId(), caseRecord);
    reviewPolicy.assertDecisionAllowed(caseRecord, request.decision());

    DecisionRecord decision = decisionRepository.insertIfAbsent(
        request.idempotencyKey(),
        caseId,
        principal.userId(),
        request.decision(),
        request.comment()
    );

    if (decision.alreadySubmitted()) {
        return ReviewDecisionResult.alreadyAccepted(decision.id());
    }

    workflowRuntime.completeReviewTask(new CompleteReviewTaskCommand(
        request.taskId(),
        caseId,
        decision.id(),
        request.decision(),
        principal.userId()
    ));

    auditTrail.record("CASE_REVIEW_DECISION_SUBMITTED", caseId, principal.userId(), decision.id());

    return ReviewDecisionResult.accepted(decision.id());
}
```

### 24.3 Adapter maps to Camunda variables

```java
Map<String, CamundaVariable> variables = Map.of(
    "reviewDecision", CamundaVariable.string(command.decision().name()),
    "reviewDecisionId", CamundaVariable.string(command.decisionId()),
    "reviewedBy", CamundaVariable.string(command.actorUserId())
);

camundaTaskClient.complete(command.taskId(), variables);
```

Notice what is **not** sent:

- arbitrary user profile,
- full comment body if stored in domain audit,
- raw document/evidence payload,
- privilege flags,
- tenant override.

---

## 25. Example: Inbound Webhook to Message Correlation

Bad:

```text
Payment Gateway -> /engine-rest/message
```

Better:

```text
Payment Gateway
  -> /payments/events
      -> verify signature
      -> insert inbox event
      -> deduplicate by provider event id
      -> find application/payment record
      -> correlate Camunda message
      -> mark event processed
```

Pseudo-flow:

```java
@Transactional
public void handlePaymentWebhook(PaymentWebhook webhook) {
    signatureVerifier.verify(webhook);

    InboxEvent event = inbox.insertIfAbsent(webhook.providerEventId(), webhook.payload());
    if (event.alreadyProcessed()) {
        return;
    }

    Payment payment = paymentRepository.findByReference(webhook.paymentReference());

    workflowRuntime.correlatePaymentReceived(new PaymentReceivedCommand(
        payment.applicationId(),
        payment.businessKey(),
        payment.reference(),
        webhook.providerEventId()
    ));

    inbox.markProcessed(event.id());
}
```

Design advantage:

- duplicate webhook safe,
- signature verified before engine call,
- early/late event can be handled explicitly,
- domain audit exists,
- Camunda variable payload is controlled.

---

## 26. Custom Camunda Gateway Service

For large organizations, create a workflow gateway.

```text
Domain Services
  -> Workflow Gateway
      -> Camunda REST API
```

Responsibilities:

- centralize Camunda client,
- enforce endpoint allowlist,
- normalize error handling,
- manage authentication to Camunda,
- add correlation id,
- add metrics,
- hide raw Camunda endpoint,
- centralize DTO mapping,
- implement retry/idempotency policy,
- expose domain-ish workflow operations.

But beware:

- gateway can become god service,
- avoid putting all business logic there,
- keep domain policy in owning domain service,
- gateway should not become a second process engine.

---

## 27. API Gateway and Network Controls

Production layout:

```text
Internet / Intranet Client
  -> Edge Gateway / WAF
      -> Domain APIs
          -> Internal Network
              -> Camunda REST
```

Controls:

- Camunda REST not public,
- restrict by network/security group,
- mTLS or service identity,
- authentication required,
- request size limit,
- timeout limit,
- rate limit,
- audit access log,
- block dangerous endpoints for non-admin callers,
- separate admin route from application route.

Endpoint groups:

```text
/application-workflow/*   -> allowed for app service accounts
/operations-workflow/*    -> operator-only
/admin-workflow/*         -> platform-admin-only
/raw-engine-rest/*        -> avoid or heavily restrict
```

---

## 28. REST API Versioning and Upgrade Discipline

Camunda REST API changes across versions, especially documentation location and generated OpenAPI details.

Upgrade discipline:

1. pin Camunda version,
2. pin OpenAPI spec version,
3. regenerate client in branch,
4. run compile checks,
5. run integration tests,
6. run contract tests against real engine,
7. verify error response mapping,
8. verify authentication filter behavior,
9. verify variable serialization,
10. verify task/message endpoints,
11. verify admin tooling.

Do not upgrade generated client independently from server without testing.

---

## 29. Contract Tests for Camunda REST Integration

Contract tests should verify:

- start process works,
- duplicate start guarded,
- task query returns expected task,
- task complete maps variables correctly,
- validation rejects arbitrary variable,
- message correlation succeeds,
- duplicate message safe,
- not found maps correctly,
- conflict maps correctly,
- timeout/retry behavior safe,
- authentication failure handled,
- tenant filter enforced,
- history query limited.

Use real Camunda engine in test where possible.

Testcontainers or Docker Compose can help for:

- Camunda container,
- PostgreSQL/MySQL if matching production,
- app service,
- integration test runner.

---

## 30. REST API Observability

Every Camunda REST call from application code should include:

- correlation id,
- trace id,
- business key,
- process definition key,
- process instance id when known,
- task id when known,
- operation name,
- user/service principal,
- tenant id,
- latency,
- HTTP status,
- Camunda exception message/class if available,
- retry count.

Example structured log:

```json
{
  "event": "camunda_rest_call",
  "operation": "complete_review_task",
  "caseId": "CASE-2026-0001",
  "taskId": "abc123",
  "tenantId": "agency-a",
  "httpStatus": 204,
  "latencyMs": 83,
  "traceId": "..."
}
```

Do not log full variable payload blindly.

---

## 31. REST API and Data Protection

Sensitive data can leak through:

- variables,
- history variable details,
- task names/descriptions,
- business key,
- incident stack traces,
- external task error details,
- deployment resources,
- form fields,
- authorization/user/group endpoints.

Policy:

- minimize variable payload,
- store documents/evidence outside Camunda,
- store references not full content,
- mask logs,
- restrict history endpoints,
- restrict incident detail access,
- avoid PII in business key,
- avoid secrets in variables,
- avoid raw stack traces to non-operators.

---

## 32. REST API and Multi-Tenancy

For multi-tenant systems, every operation should answer:

- which tenant is targeted?
- is tenant id derived from authenticated user, not request body?
- does query filter by tenant?
- are shared definitions allowed?
- can caller see no-tenant data?
- can message correlation cross tenant?
- can history query cross tenant?
- can admin endpoint cross tenant?

Never trust client-supplied `tenantId` without deriving/validating against identity.

---

## 33. REST API and Deployment Governance

Deployment endpoint is extremely powerful:

```http
POST /deployment/create
```

BPMN/DMN is executable behavior.

Governance:

- no ad-hoc deployment from random clients,
- deploy only via CI/CD or controlled admin tool,
- validate BPMN model before deployment,
- enforce modelling convention,
- require version tag/release note,
- record deployment artifact checksum,
- link deployment to change request,
- support rollback/disable strategy,
- avoid redeploying identical resource unintentionally.

---

## 34. Raw Camunda REST vs Domain Workflow API: Decision Table

| Use Case | Raw REST Direct? | Recommended Boundary |
|---|---:|---|
| Internal admin diagnostic | Sometimes | Operator tool with restricted access |
| Custom business UI task completion | No | Domain API |
| External webhook message correlation | No | Inbound event API + inbox |
| External task worker | Yes, controlled | Worker service account + topic policy |
| Deployment from CI/CD | Yes, controlled | CI/CD deployment service |
| Business reporting | Usually no | Projection/reporting store |
| Incident recovery | Sometimes | Operator workflow with audit |
| Process start from user action | No | Domain API |
| Process migration | No public direct | Privileged migration tool |
| DMN evaluation internal service | Maybe | Decision adapter/gateway |

---

## 35. Common Anti-Patterns

### 35.1 Exposing `/engine-rest` to frontend

Symptom:

- frontend completes tasks directly,
- business logic in JS,
- variables arbitrary.

Fix:

- introduce domain API,
- hide engine ids or map to opaque ids,
- enforce business policy server-side.

### 35.2 Using Camunda as public integration API

Symptom:

- external systems call `/message` directly.

Fix:

- create ingestion API,
- verify signatures,
- inbox/dedup,
- correlate internally.

### 35.3 Passing full domain object as variable

Symptom:

- huge JSON/object variables,
- history bloat,
- serialization compatibility problems.

Fix:

- references + small routing facts + versioned snapshots only when justified.

### 35.4 Generated client everywhere

Symptom:

- any service can call any Camunda endpoint.

Fix:

- hide generated client behind `WorkflowRuntime` adapter.

### 35.5 Treating REST call timeout as failure

Symptom:

- user clicks retry,
- duplicate process/task completion/event.

Fix:

- idempotency key,
- query/reconcile after ambiguous timeout,
- command table/outbox.

### 35.6 Reporting from operational REST API

Symptom:

- dashboards run heavy history queries.

Fix:

- export/projection/reporting DB.

---

## 36. Production Checklist

Before exposing or using Camunda REST API in production, verify:

### Security

- REST API is authenticated.
- REST API is not public unless intentionally protected by gateway/security.
- Endpoint allowlist exists.
- Admin endpoints restricted.
- Tenant filter enforced.
- Variables are allowlisted.
- Sensitive data logging is masked.

### Architecture

- Domain API exists for business actions.
- Camunda client is wrapped in adapter/gateway.
- Generated client is not leaked widely.
- Frontend does not call raw engine API.
- External systems do not call `/message` directly.

### Reliability

- Idempotency exists for start/complete/correlate.
- Timeout ambiguity is handled.
- Retry policy is operation-specific.
- Circuit breaker/bulkhead configured.
- Backpressure exists for high-volume calls.

### Observability

- Structured logs include operation, business key, tenant, latency, status.
- Metrics exist per operation.
- Error mapping is explicit.
- Trace/correlation id propagated.

### Governance

- Deployment endpoint controlled by CI/CD or admin process.
- Process migration endpoint restricted.
- Process modification requires reason/audit.
- History/reporting strategy exists.
- Contract tests cover critical endpoints.

---

## 37. Top 1% Mental Model

A beginner sees Camunda REST API as:

> “An HTTP API to start processes and complete tasks.”

A strong engineer sees it as:

> “A remote control surface for a durable transactional state machine.”

A top-tier platform engineer sees it as:

> “A privileged engine boundary that must be wrapped by domain policy, identity propagation, idempotency, observability, data minimization, endpoint governance, and operational recovery design.”

That distinction matters.

In production, the hard problem is rarely how to call:

```http
POST /task/{id}/complete
```

The hard problem is proving:

- the right person completed the right task,
- in the right tenant,
- at the right process state,
- with the right business authority,
- with valid payload,
- with defensible audit,
- with no duplicate side effect,
- and with recoverability if the engine/network/downstream failed halfway.

That is the engineering standard this series is targeting.

---

## 38. What You Should Be Able to Do After This Part

After this part, you should be able to:

1. Explain why Camunda REST API is not a domain API.
2. Design a domain API facade for task completion.
3. Design a safe inbound webhook-to-message-correlation flow.
4. Classify Camunda REST endpoints by operational/security risk.
5. Decide when to use generated OpenAPI client vs handwritten adapter.
6. Apply idempotency to start/complete/correlate operations.
7. Avoid arbitrary variable injection from frontend/client.
8. Build governance around process modification, deployment, job, and incident endpoints.
9. Design REST client error mapping and retry policy.
10. Explain how remote engine changes transaction and failure semantics.
11. Protect Camunda REST in a multi-tenant regulatory platform.
12. Plan contract tests for Camunda REST integration.

---

## 39. Referensi

- Camunda 7.24 REST API OpenAPI documentation: https://docs.camunda.org/rest/camunda-bpm-platform/7.24/
- Camunda 7 Manual — Process Engine API: https://docs.camunda.org/manual/7.24/user-guide/process-engine/process-engine-api/
- Camunda 7 Manual — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda 7 Manual — Security Instructions: https://docs.camunda.org/manual/7.24/user-guide/security/
- Camunda 7 Manual — Authorization Service: https://docs.camunda.org/manual/7.24/user-guide/process-engine/authorization-service/
- Camunda 7 Manual — Variables: https://docs.camunda.org/manual/7.24/user-guide/process-engine/variables/
- Camunda 7 Manual — External Tasks: https://docs.camunda.org/manual/7.24/user-guide/process-engine/external-tasks/
- Camunda 7 Manual — Message Events: https://docs.camunda.org/manual/7.24/reference/bpmn20/events/message-events/
- Camunda 7 Manual — Process Instance Modification: https://docs.camunda.org/manual/7.24/user-guide/process-engine/process-instance-modification/
- Camunda Forum — Revamped Camunda 7 REST API Documentation: https://forum.camunda.io/t/revamped-camunda-7-rest-api-documentation/43380

---

## 40. Status Seri

Part ini selesai.

Seri belum selesai. Lanjut ke:

`learn-java-camunda-7-bpm-platform-engineering-part-024.md` — **DMN/CMMN in Camunda 7: Decision Automation, Case Management, and When Not to Use Them**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-022.md">⬅️ Part 022 — Jakarta EE / Java EE Runtime Integration: Shared Engine, Container Transactions, JNDI, Classloading</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-024.md">DMN/CMMN in Camunda 7: Decision Automation, Case Management, and When Not to Use Them ➡️</a>
</div>
