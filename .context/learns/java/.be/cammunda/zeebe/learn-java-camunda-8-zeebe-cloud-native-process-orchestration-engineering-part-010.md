# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-010.md

# Part 010 — Process Instantiation, Business Keys, Correlation Keys, and Message Design

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `010`  
> Fokus: bagaimana proses dimulai, bagaimana instance diidentifikasi, bagaimana pesan dikorelasikan, bagaimana race condition dicegah, dan bagaimana Java application harus mendesain boundary antara request, domain identity, process identity, dan message identity.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- arsitektur Camunda 8/Zeebe;
- command path vs projection/read path;
- record stream, command, event, rejection;
- partition, ordering, replication;
- BPMN runtime semantics;
- Java client evolution;
- production-grade worker;
- idempotency dan duplicate execution;
- variable/data contract;
- BPMN modelling for distributed execution.

Part ini bergerak ke pertanyaan yang tampak sederhana tetapi sering menjadi sumber incident production:

> “Bagaimana sebuah process instance dimulai dan bagaimana event dari luar diarahkan ke instance yang benar?”

Di Camunda 7, banyak engineer terbiasa dengan pola:

- `RuntimeService.startProcessInstanceByKey(processDefinitionKey, businessKey, variables)`;
- query process instance by business key;
- correlate message memakai process variables;
- engine berada dekat dengan aplikasi Java dan database transaksi.

Di Camunda 8/Zeebe, cara berpikirnya berubah:

- process instance dibuat melalui command ke cluster;
- process instance mendapat key internal dari Zeebe;
- message correlation memakai `messageName` + `correlationKey`;
- message bisa buffered tergantung TTL;
- read visibility biasanya melalui projection seperti Operate/Elasticsearch/OpenSearch;
- business identity harus didesain eksplisit sebagai contract, bukan dianggap sama dengan engine identity;
- worker/application harus siap menghadapi duplicate request, duplicate message, timeout, command retry, dan projection lag.

Bagian ini akan membahas desain tersebut dari level mental model sampai Java implementation pattern.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. membedakan process instance key, process definition id, business identifier, business key/business id, correlation key, message id, request id, dan idempotency key;
2. memilih kapan memakai direct process creation dan kapan memakai message start event;
3. mendesain correlation key yang stabil, aman, tenant-aware, dan tidak ambigu;
4. memahami TTL message, message buffering, dan race condition “message datang sebelum process menunggu”;
5. membedakan publish message vs correlate message;
6. mendesain API Java/Spring yang aman untuk start process dan publish message;
7. menghindari anti-pattern seperti memakai processInstanceKey sebagai business identity utama;
8. membuat external-to-process integration yang bisa diaudit dan tahan retry;
9. membuat naming convention untuk BPMN id, message name, job type, variable, dan external reference;
10. membaca bug production dari gejala seperti duplicate process, uncorrelated message, wrong instance correlation, dan stale Operate view.

---

## 2. Mental Model Besar

### 2.1 Process Instance Bukan Domain Entity

Satu kesalahan besar adalah menganggap process instance sebagai domain entity utama.

Contoh salah:

```text
Order = ProcessInstance
Case = ProcessInstance
Application = ProcessInstance
Appeal = ProcessInstance
```

Secara domain, `Order`, `Case`, `Application`, atau `Appeal` adalah entity bisnis. Zeebe process instance adalah state machine orchestration yang mengatur lifecycle entity tersebut.

Model yang lebih sehat:

```text
Domain entity:
  Application(applicationId = APP-2026-000012)

Process instance:
  processInstanceKey = 2251799813689001
  bpmnProcessId = regulatory-application-review
  version = 12

Relationship:
  Application.applicationId is carried as process variable
  and/or attached as business identifier/business tag depending on platform feature/version
```

Domain entity harus tetap bisa hidup walaupun:

- process instance sudah selesai;
- process instance dibatalkan;
- process version berubah;
- workflow dimigrasikan;
- beberapa process instance terkait entity yang sama;
- Camunda projection sedang lag;
- process engine sedang unavailable.

**Prinsip:** process instance adalah durable orchestration state, bukan database utama domain.

---

### 2.2 Engine Key, Business ID, Correlation Key, dan Message ID Punya Fungsi Berbeda

Jangan mencampur semua identifier menjadi satu.

| Identifier | Dimiliki oleh | Fungsi utama | Stabil untuk bisnis? | Cocok untuk correlation? |
|---|---:|---|---:|---:|
| `processInstanceKey` | Zeebe | identifier internal instance | Tidak | Tidak langsung |
| `processDefinitionKey` | Zeebe | identifier internal deployed process version | Tidak | Tidak |
| `bpmnProcessId` | BPMN model | logical process id | Ya, jika governance baik | Untuk create command |
| `applicationId` / `orderId` / `caseId` | domain system | business entity identity | Ya | Ya, sering menjadi basis correlation |
| `correlationKey` | integration contract | routing message ke subscription/process | Ya, harus stabil | Ya |
| `messageId` | sender/integration | deduplication message publishing | Ya, per message event | Bukan correlation key |
| `requestId` | API boundary | trace/idempotency request | Ya, per request | Tidak selalu |
| `idempotencyKey` | application boundary | dedup command/side effect | Ya, per operation | Bisa berbeda |

Mental model sederhana:

```text
business id      = siapa entity bisnisnya?
correlation key  = ke process conversation mana message ini masuk?
message id       = apakah message ini duplicate?
process key      = instance internal mana yang dibuat engine?
request id       = panggilan API mana yang menghasilkan command ini?
```

Jika semua ini dicampur, sistem akan rapuh.

---

## 3. Cara Process Instance Dimulai di Camunda 8

Secara konseptual, ada dua cara besar memulai process instance:

1. **Direct create process instance command**
2. **Message start event**

Keduanya valid, tetapi digunakan untuk situasi berbeda.

---

## 4. Direct Create Process Instance

### 4.1 Mental Model

Direct create berarti aplikasi secara eksplisit berkata kepada Zeebe:

> “Buat instance baru untuk process definition ini dengan variables ini.”

Biasanya command menentukan:

- BPMN process id (`bpmnProcessId`);
- latest version atau version tertentu;
- variables awal;
- optional tenant context;
- optional result waiting mode.

Contoh konseptual:

```java
ProcessInstanceEvent event = client
    .newCreateInstanceCommand()
    .bpmnProcessId("regulatory-application-review")
    .latestVersion()
    .variables(Map.of(
        "applicationId", "APP-2026-000012",
        "applicantId", "UEN-201912345Z",
        "submittedAt", "2026-06-20T10:15:30+07:00"
    ))
    .send()
    .join();
```

Catatan:

- API detail bisa berbeda antara Zeebe Java Client legacy dan Camunda Java Client baru;
- mulai Camunda 8.8+, ekosistem mengarah ke Camunda Java Client;
- REST menjadi default communication protocol pada client baru, gRPC masih dapat dikonfigurasi untuk kebutuhan tertentu.

Yang penting di part ini bukan hanya method name, tetapi semantics.

---

### 4.2 Kapan Direct Create Cocok?

Direct create cocok ketika:

1. aplikasi command-side memang bertanggung jawab memulai workflow;
2. user melakukan action eksplisit seperti “Submit Application”;
3. tidak perlu menunggu external asynchronous message untuk membuat instance;
4. flow dimulai dari internal system boundary;
5. kamu ingin error create langsung terlihat di API call;
6. kamu punya idempotency layer di aplikasi sebelum mengirim command.

Contoh:

```text
POST /applications/{applicationId}/submit
  -> validate application domain state
  -> mark application as SUBMITTED in domain DB
  -> start Camunda process regulatory-application-review
  -> return application submission response
```

Tetapi ini harus dirancang hati-hati: jika domain DB commit berhasil tetapi create process timeout, apa yang terjadi?

---

### 4.3 Direct Create Failure Modes

Direct create terlihat sederhana, tapi failure mode-nya banyak.

#### Failure mode A — command berhasil, client timeout

```text
API -> Zeebe create instance command
Zeebe -> instance created
network -> response lost / timeout
API -> thinks unknown
```

Aplikasi tidak boleh langsung menganggap process tidak dibuat.

Solusi:

- pakai idempotency key di application boundary;
- simpan submission command record;
- reconcile berdasarkan domain entity;
- jangan retry buta tanpa dedup;
- gunakan message start with idempotent correlation jika cocok;
- atau gunakan application table yang menyimpan `processInstanceKey` setelah diketahui.

#### Failure mode B — domain commit sukses, process creation gagal

```text
DB transaction commits Application.SUBMITTED
Create process command fails
No process instance exists
```

Solusi:

- transactional outbox: domain transaction menulis outbox `START_PROCESS`;
- async dispatcher mengirim command ke Zeebe;
- dispatcher idempotent;
- process key disimpan setelah command success;
- reconciliation job mendeteksi submitted application tanpa process.

#### Failure mode C — retry membuat duplicate process

```text
Request 1: create instance -> succeeds but response timeout
Request retry: create instance again -> creates second process
```

Solusi:

- deduplicate by business operation;
- message start with correlationKey if active-single-instance semantics is desired;
- application-level process registry;
- unique constraint on `(process_name, business_entity_id, lifecycle_phase)`.

---

## 5. Create Process Instance With Result

Camunda/Zeebe mendukung pola create instance lalu menunggu hasil tertentu dari process.

Mental model:

```text
create process instance
wait until process reaches completion/result
return selected variables/result
```

Pola ini menggoda karena membuat workflow terasa seperti function call.

Contoh konseptual:

```java
ProcessInstanceResult result = client
    .newCreateInstanceCommand()
    .bpmnProcessId("quick-eligibility-check")
    .latestVersion()
    .variables(requestVariables)
    .withResult()
    .send()
    .join();
```

### 5.1 Kapan Cocok?

Cocok untuk:

- short-running process;
- decision orchestration;
- synchronous API dengan bounded latency;
- process yang tidak melibatkan human task;
- process yang tidak menunggu message eksternal lama;
- timeout budget jelas.

Contoh:

```text
Check eligibility:
  validate applicant
  call internal risk score
  evaluate DMN
  return ACCEPT/REVIEW/REJECT
```

### 5.2 Kapan Berbahaya?

Berbahaya untuk:

- long-running workflow;
- user task;
- timer;
- external integration yang tidak predictable;
- process yang bisa incident;
- process yang butuh SLA jam/hari;
- public API yang punya timeout pendek.

Anti-pattern:

```text
POST /submit-application
  -> create process with result
  -> process waits for officer approval
  -> HTTP thread hangs / timeout
```

### 5.3 Rule of Thumb

Gunakan:

```text
create with result
```

hanya jika process itu secara realistis adalah:

```text
bounded synchronous orchestration
```

Bukan:

```text
business lifecycle orchestration
```

---

## 6. Message Start Event

### 6.1 Mental Model

Message start event berarti process dimulai ketika message tertentu diterima.

Konseptual:

```text
External system publishes message:
  name = ApplicationSubmitted
  correlationKey = APP-2026-000012
  variables = {...}

Zeebe finds process definition with matching message start event
and creates process instance.
```

Message start cocok ketika process dimulai oleh event, bukan command internal langsung.

Contoh:

- external portal mengirim `ApplicationSubmitted`;
- payment gateway mengirim `PaymentReceived`;
- upstream system mengirim `CaseCreated`;
- webhook masuk dan diterjemahkan menjadi BPMN message.

---

### 6.2 Message Start vs Direct Create

| Aspek | Direct create | Message start |
|---|---|---|
| Intent | command: create process now | event: something happened |
| Coupling | caller tahu BPMN process id | caller tahu message contract |
| Idempotency aktif single instance | harus custom | correlationKey bisa membantu single active instance untuk message start |
| Event-driven architecture | medium | kuat |
| Cocok untuk external event | bisa, tapi lebih coupled | sangat cocok |
| Cocok untuk internal UI submit | sangat cocok | bisa jika ingin event-first |
| Duplicate event handling | custom + message id | message id/correlation semantics bisa membantu |
| Observability | process command | message event + process start |

---

### 6.3 Message Start Idempotency

Dalam Camunda 8, message start event dengan `correlationKey` dapat digunakan untuk memastikan hanya satu active process instance per key untuk message start tertentu. Ini penting untuk event-driven idempotency.

Contoh:

```text
messageName     = ApplicationSubmitted
correlationKey  = APP-2026-000012
```

Jika message yang sama datang lagi selama instance masih active, desainnya harus mencegah duplicate active process untuk entity tersebut.

Namun jangan salah tafsir:

- ini bukan pengganti seluruh idempotency application;
- ini bukan business database unique constraint;
- ini berlaku pada semantics message start/process aktif;
- setelah process selesai, event baru dengan key sama bisa punya semantics berbeda tergantung model/version/TTL/design.

---

## 7. Publish Message vs Correlate Message

Pada Camunda 8 modern REST API, ada perbedaan penting antara:

1. **publish message**
2. **correlate message**

### 7.1 Publish Message

Publish message mengirim message ke engine. Jika belum ada subscription yang cocok, message bisa buffered tergantung TTL.

Mental model:

```text
publish message
  -> if matching subscription exists: correlate
  -> else if TTL > 0: buffer until subscription appears or TTL expires
  -> else discard/fail depending command semantics/version/API behavior
```

Publish message cocok ketika kamu ingin mendukung race condition:

```text
external event arrives before process reaches catch event
```

Contoh:

```text
Process:
  Submit Application
  Call External Verification
  Wait for VerificationCompleted message

Reality:
  External system returns callback very fast
  Callback arrives before process token reaches catch event
```

Dengan TTL > 0, message bisa menunggu subscription.

---

### 7.2 Correlate Message

Correlate message adalah operation yang mencoba mengkorelasikan message ke subscription sekarang dan tidak ditujukan untuk buffering.

Mental model:

```text
correlate message now
  -> if matching subscription exists: success
  -> else: not correlated
```

Ini cocok ketika caller ingin strong answer:

> “Apakah message ini benar-benar masuk ke process instance sekarang?”

Tetapi kurang cocok jika event bisa datang sebelum process siap.

---

### 7.3 Pilihan Praktis

| Situasi | Pilihan lebih cocok |
|---|---|
| Callback bisa datang sebelum process menunggu | publish message dengan TTL |
| Caller perlu tahu message correlated sekarang | correlate message |
| Event-driven external integration | publish message |
| Command-style synchronous repair | correlate message bisa cocok |
| Message start event | publish message lazim |
| Testing deterministic immediate subscription | correlate message membantu |

---

## 8. Correlation Key Design

Correlation key adalah salah satu desain paling penting di Camunda 8.

### 8.1 Definisi Praktis

Correlation key adalah string/value yang dipakai untuk mencocokkan message dengan waiting subscription/process conversation.

Biasanya dibentuk dari domain identity.

Contoh:

```text
applicationId = APP-2026-000012
paymentId     = PAY-998877
caseId        = CASE-2026-000054
appealId      = APL-2026-000003
```

Tetapi correlation key harus menjawab:

> “Conversation mana yang seharusnya menerima message ini?”

Bukan hanya:

> “Entity apa yang terkait?”

Kadang satu entity punya lebih dari satu conversation.

---

### 8.2 Simple Correlation Key

Contoh paling sederhana:

```text
correlationKey = applicationId
```

Cocok jika:

- hanya ada satu active process conversation untuk application;
- semua message untuk application masuk ke process yang sama;
- tidak ada parallel subprocess yang menunggu message dengan key sama secara ambigu.

---

### 8.3 Composite Correlation Key

Jika entity punya beberapa conversation, gunakan composite key.

Contoh:

```text
applicationId + ":" + verificationType
```

Misalnya:

```text
APP-2026-000012:ADDRESS_VERIFICATION
APP-2026-000012:BACKGROUND_CHECK
APP-2026-000012:DOCUMENT_VALIDATION
```

Cocok untuk parallel checks.

---

### 8.4 Tenant-Aware Correlation Key

Dalam sistem multi-tenant, jangan mengandalkan ID yang mungkin sama antar tenant.

Buruk:

```text
correlationKey = CASE-000012
```

Lebih aman:

```text
correlationKey = tenantId + ":" + caseId
```

Contoh:

```text
CEA:CASE-000012
CPDS:CASE-000012
```

Atau jika tenant sudah ditangani oleh Camunda tenant context, tetap pastikan external integration tidak salah route.

---

### 8.5 Lifecycle-Aware Correlation Key

Kadang satu business entity bisa melewati beberapa workflow lifecycle berbeda.

Contoh:

```text
application submission
application review
application renewal
application appeal
application enforcement
```

Jika semua memakai `applicationId`, message bisa ambigu.

Lebih aman:

```text
APP-2026-000012:INITIAL_REVIEW
APP-2026-000012:APPEAL-1
APP-2026-000012:RENEWAL-2027
```

---

### 8.6 Correlation Key Anti-Patterns

#### Anti-pattern 1 — menggunakan random UUID setiap publish

```text
correlationKey = UUID.randomUUID()
```

Masalah:

- process tidak bisa tahu key tersebut;
- message tidak akan correlate;
- debugging sulit.

Random UUID boleh dipakai sebagai `messageId`, bukan correlation key, kecuali process memang menyimpan UUID itu sebelumnya sebagai conversation id.

#### Anti-pattern 2 — menggunakan processInstanceKey sebagai external correlation key

```text
correlationKey = processInstanceKey
```

Kadang bisa bekerja jika external system tahu processInstanceKey. Tetapi ini membuat external system tergantung pada internal engine identity.

Masalah:

- process key bukan domain identity;
- migration/replace engine lebih sulit;
- external system harus menyimpan internal key;
- multi-process relation menjadi rumit;
- command timeout bisa membuat key tidak diketahui.

Lebih baik:

```text
correlationKey = stable domain conversation id
```

#### Anti-pattern 3 — memakai email/nama manusia sebagai correlation key

```text
correlationKey = applicantEmail
```

Masalah:

- bisa berubah;
- tidak unique;
- PII exposure;
- buruk untuk audit/security;
- case sensitivity/normalization issue.

#### Anti-pattern 4 — key terlalu broad

```text
correlationKey = applicantId
```

Jika satu applicant bisa punya banyak application, message bisa masuk ke workflow yang salah.

#### Anti-pattern 5 — key terlalu granular

```text
correlationKey = applicationId + ":" + timestamp + ":" + random"
```

Jika process tidak menyimpan exact key, message tidak pernah correlate.

---

## 9. Message Name Design

Correlation tidak hanya berdasarkan key. Message name juga penting.

### 9.1 Message Name Sebagai Contract

Message name harus merepresentasikan event bisnis, bukan detail transport.

Baik:

```text
ApplicationSubmitted
PaymentReceived
VerificationCompleted
DocumentUploadCompleted
AppealFiled
CaseEscalationRequested
```

Kurang baik:

```text
PostCallback
ApiResponse
WebhookEvent
KafkaMessage
UpdateStatus
Message1
```

Message name adalah bagian dari ubiquitous language orchestration.

---

### 9.2 Naming Convention

Gunakan event past tense untuk sesuatu yang sudah terjadi:

```text
ApplicationSubmitted
PaymentAuthorized
ReviewCompleted
DocumentsVerified
```

Gunakan command-like name hanya jika memang semantics-nya command:

```text
CancelCaseRequested
EscalateCaseRequested
```

Untuk banyak organisasi, standard sederhana:

```text
<DomainNoun><PastTenseVerb>
```

atau:

```text
<DomainNoun><Action>Requested
```

Contoh:

```text
ApplicationSubmitted
ApplicationWithdrawn
VerificationCompleted
EnforcementNoticeIssued
AppealDecisionRecorded
```

---

### 9.3 Versioning Message Name

Jangan cepat-cepat menaruh version di message name.

Buruk jika belum perlu:

```text
ApplicationSubmittedV1
```

Lebih baik versioning di payload schema:

```json
{
  "schemaVersion": 1,
  "applicationId": "APP-2026-000012"
}
```

Tetapi jika semantics berubah secara breaking, message name baru bisa benar:

```text
ApplicationSubmitted
ApplicationResubmittedAfterRework
```

atau:

```text
ApplicationSubmittedV2
```

jika benar-benar perlu coexistence.

---

## 10. Message ID Design

Message ID berbeda dari correlation key.

### 10.1 Fungsi Message ID

Message ID dipakai untuk deduplication message publishing.

Contoh:

```text
messageId = upstreamEventId
messageName = VerificationCompleted
correlationKey = APP-2026-000012:ADDRESS_VERIFICATION
```

Jika sender retry publish message yang sama, message ID membantu engine/application mencegah duplicate message effect.

### 10.2 Message ID Harus Stabil Per Event

Buruk:

```java
messageId = UUID.randomUUID().toString(); // generated on every retry
```

Jika retry menghasilkan UUID baru, deduplication tidak bekerja.

Baik:

```java
messageId = externalEvent.getEventId();
```

atau:

```java
messageId = sha256(sourceSystem + ":" + sourceEventId + ":" + messageName);
```

### 10.3 Message ID Bukan Business ID

Satu application bisa punya banyak messages:

```text
ApplicationSubmitted
DocumentUploaded
VerificationCompleted
ReviewCompleted
AppealFiled
```

Jangan pakai hanya `applicationId` sebagai message ID untuk semua event, karena event berbeda bisa dianggap duplicate.

Lebih baik:

```text
APP-2026-000012:ApplicationSubmitted:submission-1
APP-2026-000012:DocumentUploaded:doc-7788
APP-2026-000012:VerificationCompleted:address-check-998
```

---

## 11. TTL Design

TTL menentukan berapa lama message boleh disimpan menunggu subscription.

### 11.1 TTL = 0

TTL 0 berarti message tidak dibuffer.

Cocok jika:

- message hanya valid jika process sekarang sedang menunggu;
- duplicate start harus dicegah dengan immediate semantics tertentu;
- caller ingin fail fast;
- event sudah bisa dikirim ulang nanti.

### 11.2 TTL > 0

TTL > 0 berarti message dapat menunggu subscription.

Cocok jika:

- external callback bisa lebih cepat dari process token;
- process mungkin belum deploy/subscribe ketika event tiba;
- event valid untuk beberapa menit/jam/hari;
- kamu ingin mengurangi race condition.

Contoh:

```text
VerificationCompleted callback valid for 24 hours
TTL = PT24H
```

### 11.3 TTL Terlalu Pendek

Masalah:

```text
TTL = 10 seconds
external event arrives
process delayed by worker/backpressure for 30 seconds
message expires
process waits forever
```

### 11.4 TTL Terlalu Panjang

Masalah:

```text
TTL = 30 days
wrong correlation key message sits buffered
future process accidentally catches stale message
```

TTL harus mengikuti business validity.

### 11.5 TTL Decision Table

| Event | Suggested TTL logic |
|---|---|
| Payment callback | berdasarkan payment authorization validity |
| External verification result | berdasarkan validity result dan retry window |
| User confirmation email clicked | berdasarkan link expiry |
| Application submitted event | TTL 0 atau short TTL tergantung duplicate semantics |
| Cancellation requested | short TTL jika hanya valid untuk active case |
| Appeal filed | sesuai statutory filing window, tapi tetap hati-hati stale event |

---

## 12. Race Condition Patterns

### 12.1 Message Arrives Before Catch Event

Process:

```text
Service Task: request external verification
Intermediate Catch Event: wait VerificationCompleted
```

Timeline:

```text
T1 process calls external verification
T2 external system processes instantly
T3 external callback publishes VerificationCompleted
T4 process token has not reached catch event yet
```

Jika message tidak buffered, process bisa stuck.

Solusi:

- publish message dengan TTL > expected process delay;
- design external callback handler idempotent;
- store callback in domain DB and let worker/checker correlate later;
- use outbox/inbox bridge.

---

### 12.2 Duplicate Start Request

Timeline:

```text
T1 user clicks Submit
T2 API starts process
T3 browser retries due timeout
T4 API starts second process
```

Solusi:

- unique domain transition: DRAFT -> SUBMITTED only once;
- idempotency key per submit action;
- process registry unique key;
- message start with correlationKey if event-driven;
- return previous submission result on duplicate.

---

### 12.3 Wrong Correlation Due Broad Key

Process A and B both wait for:

```text
messageName = VerificationCompleted
correlationKey = applicantId
```

Applicant has multiple active applications.

Callback for Application 2 may correlate to Application 1.

Solusi:

```text
correlationKey = applicationId + ":" + verificationType
```

---

### 12.4 Stale Message Caught by Future Process

Timeline:

```text
T1 message published with long TTL and wrong key
T2 no process waits
T3 weeks later process starts and waits with same key
T4 stale message correlates
```

Solusi:

- sensible TTL;
- payload validation in worker/process;
- event timestamp checks;
- source event version;
- domain state validation after correlation;
- avoid overly broad keys.

---

### 12.5 Projection Lag Confused as Missing Instance

Timeline:

```text
T1 create process success
T2 API queries Operate immediately
T3 Operate projection not updated yet
T4 API thinks process missing
```

Solusi:

- command response is source for immediate result;
- do not require Operate projection immediately after command;
- store processInstanceKey from command response;
- design read-after-write expectations explicitly.

---

## 13. Business Key / Business ID in Camunda 8 Mindset

### 13.1 Camunda 7 Habit

In Camunda 7, business key was commonly attached to process instance and queryable in relational runtime/history tables.

Typical mental model:

```java
runtimeService.startProcessInstanceByKey(
    "orderProcess",
    orderId,
    variables
);
```

Then query:

```java
runtimeService
    .createProcessInstanceQuery()
    .processInstanceBusinessKey(orderId)
    .singleResult();
```

This pattern relied on relational engine storage.

---

### 13.2 Camunda 8 Shift

In Camunda 8, process instances are not primarily managed as relational rows. The engine is distributed and log/state based. Therefore, do not assume the same business-key-query style as Camunda 7.

Design business identity explicitly:

1. as process variable;
2. as correlation key;
3. as external domain DB link;
4. as process registry table;
5. as tag/business identifier if supported by your target Camunda version/platform capability;
6. as search projection field in external read model if needed.

### 13.3 Practical Process Registry

A production system often needs its own process registry.

Example table:

```sql
CREATE TABLE workflow_instance_registry (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    domain_type VARCHAR(100) NOT NULL,
    domain_id VARCHAR(200) NOT NULL,
    lifecycle VARCHAR(100) NOT NULL,
    bpmn_process_id VARCHAR(200) NOT NULL,
    process_instance_key VARCHAR(100),
    process_definition_key VARCHAR(100),
    process_version INT,
    status VARCHAR(50) NOT NULL,
    start_request_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    UNIQUE (domain_type, domain_id, lifecycle)
);
```

This registry helps answer:

- has workflow started for this application?
- which process instance key belongs to this case?
- did command timeout after creation?
- can we retry start safely?
- which process version was used?
- what is the lifecycle phase?

---

## 14. Start Process Safely from a Java API

### 14.1 Unsafe Naive Implementation

```java
@PostMapping("/applications/{id}/submit")
public ResponseEntity<?> submit(@PathVariable String id) {
    Application app = applicationRepository.findById(id).orElseThrow();
    app.submit();
    applicationRepository.save(app);

    ProcessInstanceEvent event = client.newCreateInstanceCommand()
        .bpmnProcessId("regulatory-application-review")
        .latestVersion()
        .variables(Map.of("applicationId", id))
        .send()
        .join();

    return ResponseEntity.ok(Map.of("processInstanceKey", event.getProcessInstanceKey()));
}
```

Masalah:

- DB commit dan Zeebe command tidak atomic;
- retry bisa duplicate;
- no idempotency;
- no process registry;
- no reconciliation;
- no explicit status for unknown outcome.

---

### 14.2 Better Pattern: Domain Transition + Outbox

```text
HTTP request
  -> validate idempotency key
  -> DB transaction:
       application DRAFT -> SUBMITTED
       insert outbox START_WORKFLOW
       insert/update process registry status START_PENDING
  -> return 202 Accepted or stable result

Outbox dispatcher
  -> reads START_WORKFLOW
  -> sends create process command
  -> updates registry with processInstanceKey
  -> marks outbox SENT
```

Pseudo-code:

```java
@Transactional
public SubmitApplicationResult submit(String applicationId, String requestId) {
    IdempotencyRecord existing = idempotencyService.find(requestId);
    if (existing != null) {
        return existing.replayAs(SubmitApplicationResult.class);
    }

    Application app = applicationRepository.getForUpdate(applicationId);
    app.submit();

    WorkflowRegistry registry = workflowRegistry.startPending(
        "APPLICATION",
        applicationId,
        "INITIAL_REVIEW",
        "regulatory-application-review",
        requestId
    );

    outboxRepository.insert(OutboxEvent.startWorkflow(
        requestId,
        "regulatory-application-review",
        Map.of(
            "applicationId", applicationId,
            "submissionRequestId", requestId
        )
    ));

    SubmitApplicationResult result = new SubmitApplicationResult(
        applicationId,
        registry.status()
    );

    idempotencyService.storeSuccess(requestId, result);
    return result;
}
```

Dispatcher:

```java
public void dispatchStartWorkflow(OutboxEvent event) {
    StartWorkflowPayload payload = event.payloadAs(StartWorkflowPayload.class);

    WorkflowRegistry registry = workflowRegistry.findByRequestId(event.requestId());
    if (registry.hasProcessInstanceKey()) {
        outboxRepository.markSent(event.id());
        return;
    }

    ProcessInstanceEvent created = client.newCreateInstanceCommand()
        .bpmnProcessId(payload.bpmnProcessId())
        .latestVersion()
        .variables(payload.variables())
        .send()
        .join();

    workflowRegistry.markStarted(
        registry.id(),
        String.valueOf(created.getProcessInstanceKey()),
        String.valueOf(created.getProcessDefinitionKey()),
        created.getVersion()
    );

    outboxRepository.markSent(event.id());
}
```

This is more complex, but production-safe.

---

### 14.3 Alternative: Message Start from Outbox

Instead of direct create, the outbox dispatcher can publish a BPMN message:

```text
messageName = ApplicationSubmitted
correlationKey = tenantId + ":" + applicationId
messageId = requestId
variables = {...}
TTL = PT0S or business-defined
```

Benefits:

- event-driven contract;
- message start idempotency can help;
- process can be started by the same event consumed by other systems;
- less coupling to BPMN process id.

Trade-off:

- caller may not immediately know processInstanceKey;
- process start visibility may be eventually known via registry/projection;
- you must manage message contract carefully.

---

## 15. API Response Semantics

### 15.1 Do Not Always Return processInstanceKey

For long-running workflows, returning processInstanceKey as main API result can leak engine internals.

Better response:

```json
{
  "applicationId": "APP-2026-000012",
  "submissionStatus": "ACCEPTED",
  "workflowStatus": "START_PENDING",
  "trackingId": "REQ-2026-778899"
}
```

If internal clients need process key, include it as optional technical metadata:

```json
{
  "applicationId": "APP-2026-000012",
  "workflow": {
    "status": "STARTED",
    "processInstanceKey": "2251799813689001"
  }
}
```

### 15.2 Public API Should Prefer Domain Tracking

External clients should track:

```text
applicationId
caseId
submissionId
trackingNumber
```

Not:

```text
processInstanceKey
```

---

## 16. Message Payload Design

### 16.1 Payload Should Be Minimal

Do not put full domain aggregate into message variables.

Bad:

```json
{
  "application": {
    "allFields": "...",
    "documents": [...],
    "history": [...],
    "attachmentsBase64": "..."
  }
}
```

Better:

```json
{
  "schemaVersion": 1,
  "applicationId": "APP-2026-000012",
  "submittedAt": "2026-06-20T10:15:30+07:00",
  "submissionChannel": "PORTAL"
}
```

### 16.2 Include Schema Version

```json
{
  "schemaVersion": 2,
  "eventId": "EVT-778899",
  "sourceSystem": "PORTAL",
  "applicationId": "APP-2026-000012"
}
```

### 16.3 Include Source Metadata

Useful fields:

```json
{
  "eventId": "EVT-778899",
  "sourceSystem": "MYINFO_ADAPTER",
  "sourceTimestamp": "2026-06-20T03:15:30Z",
  "receivedAt": "2026-06-20T03:15:31Z",
  "schemaVersion": 1
}
```

### 16.4 Avoid PII Unless Needed

Do not put NRIC/passport/email/address as process variables unless necessary.

Prefer:

```json
{
  "applicantRef": "APPLICANT-778899",
  "applicationId": "APP-2026-000012"
}
```

Then workers load sensitive data from authorized domain service when needed.

---

## 17. Intermediate Message Catch Event Design

### 17.1 The Process Must Know the Correlation Key Before Waiting

A message catch event can only correlate if the process has the correct key expression/value available.

Example process variables:

```json
{
  "applicationId": "APP-2026-000012",
  "addressVerificationCorrelationKey": "APP-2026-000012:ADDRESS"
}
```

Message catch event:

```text
messageName = AddressVerificationCompleted
correlationKey expression = =addressVerificationCorrelationKey
```

### 17.2 Generate Conversation ID Before External Request

For external request/response integration:

```text
1. process enters service task RequestAddressVerification
2. worker generates verificationRequestId
3. worker sends request to external system with verificationRequestId
4. worker stores verificationRequestId/correlation key as variable
5. process waits for AddressVerificationCompleted
6. callback publishes message with same correlation key
```

But careful: if the process waits only after service task completes, the callback might arrive before wait state exists. Use TTL or store callback.

---

## 18. External Callback Handler Pattern

### 18.1 Naive Callback Handler

```java
@PostMapping("/callbacks/verification")
public void callback(@RequestBody VerificationCallback callback) {
    client.newPublishMessageCommand()
        .messageName("VerificationCompleted")
        .correlationKey(callback.applicationId())
        .variables(callback)
        .send()
        .join();
}
```

Problems:

- no authentication shown;
- no dedup;
- no payload validation;
- no stable message id;
- correlation key too broad;
- no inbox/audit;
- no retry strategy;
- callback may be lost if publish fails;
- external system may retry causing duplicates.

---

### 18.2 Production Callback Handler

Better pattern:

```text
HTTP callback
  -> authenticate sender
  -> validate payload schema/signature
  -> compute stable event id/message id
  -> insert into inbox with unique event id
  -> respond 202/200 to sender after durable storage
  -> async dispatcher publishes message to Zeebe with TTL
  -> mark inbox published
  -> reconcile failed publishes
```

Pseudo-code:

```java
@PostMapping("/callbacks/address-verification")
public ResponseEntity<?> receive(@RequestBody AddressVerificationCallback callback) {
    callbackAuth.verifySignature(callback);
    callbackValidator.validate(callback);

    String messageId = callback.sourceSystem() + ":" + callback.eventId();
    String correlationKey = callback.applicationId() + ":ADDRESS_VERIFICATION";

    inboxService.recordIfAbsent(new InboxMessage(
        messageId,
        "AddressVerificationCompleted",
        correlationKey,
        callback.toVariables(),
        Instant.now()
    ));

    return ResponseEntity.accepted().body(Map.of(
        "status", "ACCEPTED",
        "messageId", messageId
    ));
}
```

Dispatcher:

```java
public void publishPendingInboxMessage(InboxMessage msg) {
    client.newPublishMessageCommand()
        .messageName(msg.messageName())
        .correlationKey(msg.correlationKey())
        .messageId(msg.messageId())
        .timeToLive(Duration.ofHours(24))
        .variables(msg.variables())
        .send()
        .join();

    inboxService.markPublished(msg.messageId());
}
```

This separates external reliability from Zeebe availability.

---

## 19. Domain State Validation After Correlation

Even if message correlates, worker/process must validate domain state.

Example:

```text
VerificationCompleted received for APP-2026-000012
Process continues
Next worker loads Application
Checks:
  application.status == UNDER_VERIFICATION
  verificationRequestId matches
  result not expired
  source is trusted
```

Correlation is routing, not full correctness proof.

### 19.1 Why?

Because:

- stale message can correlate;
- wrong upstream event can be sent;
- duplicate can arrive;
- process may be in different lifecycle;
- external system may send callback after cancellation;
- key may be reused incorrectly.

---

## 20. Designing Single Active Instance per Business Entity

Common requirement:

> “There must be only one active review process for an application.”

Do not rely on one mechanism only.

Layered design:

1. domain status transition prevents duplicate submission;
2. DB unique constraint prevents duplicate active workflow registry;
3. API idempotency key replays duplicate requests;
4. message start correlation key prevents duplicate active start in event-driven path;
5. reconciliation detects anomalies;
6. Operate is used for support, not primary uniqueness enforcement.

Example registry unique constraint:

```sql
UNIQUE (domain_type, domain_id, lifecycle)
```

For application review:

```text
domain_type = APPLICATION
domain_id   = APP-2026-000012
lifecycle   = INITIAL_REVIEW
```

---

## 21. Process Instance Lookup Strategy

### 21.1 Do Not Depend on Projection for Command Critical Path

Avoid:

```text
create process
query Operate until visible
then continue API response
```

Operate is read/projection path and can lag.

### 21.2 Recommended Lookup Layers

| Need | Recommended source |
|---|---|
| Immediate create result | command response |
| Domain workflow relation | process registry/domain DB |
| Operational debugging | Operate |
| Analytics | Optimize/custom projection |
| Human task inbox | Tasklist/custom task projection |
| Audit/compliance | exported records + domain audit |

---

## 22. Mapping Identifier Strategy for Regulatory Systems

For regulatory case/application systems, identifier design must survive audits.

Example domain:

```text
Application
Appeal
Case
EnforcementAction
Inspection
Document
Payment
```

Suggested identifiers:

| Concept | Example | Usage |
|---|---|---|
| `applicationId` | `APP-2026-000012` | domain identity |
| `caseId` | `CASE-2026-000054` | case identity |
| `reviewProcessKey` | `2251799813689001` | internal engine link |
| `submissionId` | `SUB-2026-778899` | request/idempotency |
| `correlationKey` | `CEA:APP-2026-000012:INITIAL_REVIEW` | message routing |
| `messageId` | `PORTAL:EVT-998877` | message dedup |
| `auditCorrelationId` | `REQ-abc-123` | trace and audit |

### 22.1 Example Message Contract

```json
{
  "schemaVersion": 1,
  "messageName": "ApplicationSubmitted",
  "messageId": "PORTAL:EVT-998877",
  "correlationKey": "CEA:APP-2026-000012:INITIAL_REVIEW",
  "variables": {
    "tenantId": "CEA",
    "applicationId": "APP-2026-000012",
    "submissionId": "SUB-2026-778899",
    "submittedAt": "2026-06-20T10:15:30+07:00",
    "submissionChannel": "PORTAL"
  }
}
```

---

## 23. BPMN Design Implications

### 23.1 Start Events

Use none start event when internal command starts process:

```text
[None Start] -> Validate -> Review -> Decision
```

Use message start event when business event starts process:

```text
[Message Start: ApplicationSubmitted] -> Validate -> Review -> Decision
```

### 23.2 Intermediate Catch Events

Message catch event should have:

- specific message name;
- stable correlation key expression;
- clear timeout boundary if waiting should not be indefinite;
- post-correlation validation.

Example:

```text
Request External Verification
Wait for VerificationCompleted message
  boundary timer: PT48H -> Escalate external provider
Continue if result valid
```

### 23.3 Event-Based Gateway

Use when process waits for one of multiple external outcomes:

```text
Wait for:
  PaymentReceived
  PaymentFailed
  PaymentExpired timer
```

Design correlation keys so each outcome is scoped to same payment attempt.

```text
paymentAttemptId = PAYATT-778899
```

---

## 24. Java Contract Types

A clean Java system should model these explicitly.

```java
public record StartWorkflowCommand(
    String requestId,
    String bpmnProcessId,
    String domainType,
    String domainId,
    String lifecycle,
    Map<String, Object> variables
) {}
```

```java
public record BpmnMessageCommand(
    String messageName,
    String correlationKey,
    String messageId,
    Duration ttl,
    Map<String, Object> variables
) {}
```

```java
public record WorkflowInstanceRef(
    String bpmnProcessId,
    String processInstanceKey,
    String processDefinitionKey,
    Integer processVersion
) {}
```

```java
public record CorrelationIdentity(
    String tenantId,
    String domainType,
    String domainId,
    String conversation
) {
    public String asKey() {
        return tenantId + ":" + domainType + ":" + domainId + ":" + conversation;
    }
}
```

This avoids scattering string concatenation throughout the codebase.

---

## 25. Correlation Key Builder

Example:

```java
public final class CorrelationKeys {
    private CorrelationKeys() {}

    public static String applicationReview(String tenantId, String applicationId) {
        return normalize(tenantId) + ":APPLICATION:" + normalize(applicationId) + ":INITIAL_REVIEW";
    }

    public static String verification(String tenantId, String applicationId, String verificationType) {
        return normalize(tenantId)
            + ":APPLICATION:"
            + normalize(applicationId)
            + ":VERIFICATION:"
            + normalize(verificationType);
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Correlation key component must not be blank");
        }
        return value.trim().toUpperCase(Locale.ROOT);
    }
}
```

Guidelines:

- centralize key construction;
- validate components;
- normalize case if domain allows;
- avoid PII;
- keep keys readable for operations;
- avoid extremely long keys;
- version key format carefully.

---

## 26. Idempotent Start Workflow Service

```java
public final class WorkflowStartService {
    private final WorkflowRegistryRepository registryRepository;
    private final OutboxRepository outboxRepository;
    private final Clock clock;

    @Transactional
    public WorkflowStartAccepted startApplicationReview(
        String tenantId,
        String applicationId,
        String requestId
    ) {
        Optional<WorkflowRegistry> existing = registryRepository
            .findByDomainAndLifecycle("APPLICATION", applicationId, "INITIAL_REVIEW");

        if (existing.isPresent()) {
            WorkflowRegistry registry = existing.get();
            return new WorkflowStartAccepted(
                applicationId,
                registry.status(),
                registry.processInstanceKey().orElse(null)
            );
        }

        String correlationKey = CorrelationKeys.applicationReview(tenantId, applicationId);

        WorkflowRegistry registry = WorkflowRegistry.startPending(
            "APPLICATION",
            applicationId,
            "INITIAL_REVIEW",
            "regulatory-application-review",
            requestId,
            Instant.now(clock)
        );

        registryRepository.insert(registry);

        outboxRepository.insert(OutboxEvent.publishMessage(
            requestId,
            "ApplicationSubmitted",
            correlationKey,
            requestId,
            Duration.ZERO,
            Map.of(
                "tenantId", tenantId,
                "applicationId", applicationId,
                "applicationReviewCorrelationKey", correlationKey,
                "submissionRequestId", requestId
            )
        ));

        return new WorkflowStartAccepted(applicationId, "START_PENDING", null);
    }
}
```

This starts via message start event.

Why this is robust:

- duplicate calls find existing registry;
- outbox is transactional with domain/registry;
- message id is stable;
- correlation key is stable;
- workflow start can be retried by dispatcher;
- public API does not depend on immediate Zeebe response.

---

## 27. Process Instance Creation by Version

### 27.1 Latest Version

```java
client.newCreateInstanceCommand()
    .bpmnProcessId("regulatory-application-review")
    .latestVersion()
    .variables(vars)
    .send();
```

Pros:

- simple;
- automatically uses latest deployed model;
- common for many systems.

Cons:

- deployment changes immediately affect new instances;
- caller may not know which version starts;
- harder for controlled rollout.

### 27.2 Specific Version / Definition Key

Use when:

- canary release;
- regulated deployment;
- rollback safety;
- process version chosen by domain rule;
- migration testing.

Record in registry:

```text
bpmnProcessId
processDefinitionKey
processVersion
processInstanceKey
```

This becomes important for support and audit.

---

## 28. Process Start and Transaction Boundaries

### 28.1 There Is No Distributed Transaction with Zeebe

Do not design as if this exists:

```text
BEGIN TRANSACTION
  update domain DB
  create Zeebe process instance
COMMIT BOTH
```

Zeebe command and your database transaction are separate.

### 28.2 Use Reliable Messaging Patterns

Common options:

| Pattern | Use when |
|---|---|
| Transactional outbox | domain DB is source of business command/event |
| Inbox | external callbacks/events need durable ingestion |
| Process registry | need mapping domain entity to process instance |
| Reconciliation job | need eventual repair for unknown outcomes |
| Idempotency table | public/API commands can be retried |

---

## 29. Reconciliation Patterns

### 29.1 Submitted but No Workflow Started

Query domain DB:

```sql
SELECT application_id
FROM application
WHERE status = 'SUBMITTED'
AND NOT EXISTS (
  SELECT 1
  FROM workflow_instance_registry r
  WHERE r.domain_type = 'APPLICATION'
  AND r.domain_id = application.application_id
  AND r.lifecycle = 'INITIAL_REVIEW'
  AND r.status IN ('START_PENDING', 'STARTED')
);
```

Action:

- create missing registry;
- enqueue start workflow outbox;
- alert if too old.

### 29.2 Registry START_PENDING Too Long

```sql
SELECT *
FROM workflow_instance_registry
WHERE status = 'START_PENDING'
AND created_at < CURRENT_TIMESTAMP - INTERVAL '10' MINUTE;
```

Action:

- check outbox status;
- retry dispatch;
- verify if process was actually created but registry update failed;
- escalate if unknown.

### 29.3 Published Callback Not Correlated

Inbox state:

```text
RECEIVED -> PUBLISHED -> CORRELATED? -> EXPIRED?
```

Depending on API and tracking ability, you may not always know final correlation from publish command if buffered. In that case, design domain-level confirmation downstream.

---

## 30. Observability for Instantiation and Message Correlation

Every start/publish/correlate operation should log structured fields.

### 30.1 Start Process Logs

```json
{
  "event": "workflow.start.requested",
  "requestId": "REQ-778899",
  "bpmnProcessId": "regulatory-application-review",
  "domainType": "APPLICATION",
  "domainId": "APP-2026-000012",
  "lifecycle": "INITIAL_REVIEW",
  "correlationKey": "CEA:APPLICATION:APP-2026-000012:INITIAL_REVIEW"
}
```

Success:

```json
{
  "event": "workflow.start.succeeded",
  "requestId": "REQ-778899",
  "processInstanceKey": "2251799813689001",
  "processDefinitionKey": "2251799813687001",
  "processVersion": 12
}
```

### 30.2 Publish Message Logs

```json
{
  "event": "bpmn.message.publish.requested",
  "messageName": "VerificationCompleted",
  "messageId": "VERIFY:EVT-998877",
  "correlationKey": "CEA:APPLICATION:APP-2026-000012:VERIFICATION:ADDRESS",
  "ttlSeconds": 86400,
  "sourceSystem": "ADDRESS_VERIFY"
}
```

### 30.3 Metrics

Useful metrics:

```text
workflow_start_requested_total
workflow_start_succeeded_total
workflow_start_failed_total
workflow_start_unknown_total
bpmn_message_publish_requested_total
bpmn_message_publish_succeeded_total
bpmn_message_publish_failed_total
bpmn_message_duplicate_total
bpmn_message_expired_total
workflow_registry_start_pending_age_seconds
inbox_unpublished_age_seconds
```

---

## 31. Security Considerations

### 31.1 Do Not Trust Incoming Correlation Key Blindly

External callback may include correlation key, but your system should derive/validate it.

Bad:

```java
String correlationKey = callback.correlationKey();
```

Better:

```java
String correlationKey = CorrelationKeys.verification(
    callback.tenantId(),
    callback.applicationId(),
    callback.verificationType()
);
```

### 31.2 Avoid PII in Keys

Bad:

```text
correlationKey = NRIC:S1234567A
```

Better:

```text
correlationKey = CEA:APPLICATION:APP-2026-000012:INITIAL_REVIEW
```

### 31.3 Validate Tenant Boundary

If callback says:

```json
{
  "tenantId": "CEA",
  "applicationId": "APP-2026-000012"
}
```

Your handler should verify application belongs to tenant `CEA` before publishing message.

### 31.4 AuthN/AuthZ for Start Commands

Starting process is a business action. It must be authorized at domain layer.

Do not rely only on Camunda API auth.

Example:

```text
User can submit application only if:
  application belongs to user's organization
  application status == DRAFT
  required documents complete
  submission window open
```

Only then start workflow.

---

## 32. Testing Instantiation and Correlation

### 32.1 Unit Tests

Test:

- correlation key builder;
- message ID builder;
- idempotency service;
- process registry logic;
- payload validation;
- TTL decision.

Example:

```java
@Test
void applicationReviewCorrelationKeyIsTenantAware() {
    String key = CorrelationKeys.applicationReview("cea", "app-1");
    assertEquals("CEA:APPLICATION:APP-1:INITIAL_REVIEW", key);
}
```

### 32.2 Integration Tests

Test with engine:

1. deploy process with message start;
2. publish message;
3. verify process instance created;
4. publish duplicate message;
5. verify no duplicate active instance if expected;
6. publish message before catch event;
7. verify TTL buffering works;
8. verify expired message does not correlate;
9. verify wrong correlation key fails/stays unmatched.

### 32.3 Contract Tests

For external callbacks:

- required fields;
- schema version;
- event id;
- tenant id;
- domain id;
- timestamp;
- result enum;
- signature headers;
- replay handling.

---

## 33. Production Incident Playbook

### 33.1 Duplicate Process Instance Created

Ask:

1. Was direct create retried after timeout?
2. Is there an idempotency table?
3. Is there a process registry unique constraint?
4. Was start via message start without correlation key?
5. Did the first process already complete before duplicate message arrived?
6. Was version deployment involved?

Immediate action:

- identify correct active instance;
- cancel duplicate if safe;
- repair domain registry;
- add dedup guard;
- review retry logic.

### 33.2 Message Not Correlated

Ask:

1. message name correct?
2. correlation key exact match?
3. process already waiting?
4. TTL expired?
5. tenant context mismatch?
6. payload expression failed?
7. message was published to correct cluster/environment?
8. process version has expected catch event?

### 33.3 Message Correlated to Wrong Instance

Ask:

1. was correlation key too broad?
2. were multiple instances waiting with same message/key?
3. were tenant/lifecycle missing from key?
4. was stale buffered message caught?
5. was message name reused across different semantics?

### 33.4 API Returned Workflow Missing

Ask:

1. did command succeed but projection lag?
2. is registry updated?
3. are you querying Operate too soon?
4. did exporter lag occur?
5. did process start but immediately complete/fail?

---

## 34. Design Checklist

Before approving a Camunda 8 start/message design, answer:

### 34.1 Process Start

- What exact event/command starts the process?
- Is process start direct command or message start?
- Is duplicate start possible?
- What prevents duplicate active instance?
- What is returned to API caller?
- What happens if Zeebe command times out?
- What happens if DB commit succeeds but Zeebe command fails?
- Is there an outbox/reconciliation plan?

### 34.2 Business Identity

- What is the domain identity?
- Is processInstanceKey exposed externally?
- Is business identity stored as variable?
- Is there a process registry?
- How do support teams find the process from business ID?

### 34.3 Correlation

- What is the message name?
- What is the correlation key?
- Is key tenant-aware?
- Is key lifecycle-aware?
- Can multiple active instances share the same key accidentally?
- Can stale messages be caught?
- What is TTL and why?

### 34.4 Message Dedup

- What is message ID?
- Is it stable across retry?
- Is it unique per event, not per entity?
- Does callback handler use inbox?
- Does sender retry safely?

### 34.5 Security

- Is incoming callback authenticated?
- Is tenant ownership verified?
- Are PII fields excluded from key/variables?
- Are variables minimized?

---

## 35. Practical Heuristics

1. **Use domain ID for business tracking, not processInstanceKey.**
2. **Use processInstanceKey for technical operation, not public contract.**
3. **Use correlationKey for routing process conversation, not dedup.**
4. **Use messageId for dedup, not routing.**
5. **Use TTL based on business validity, not arbitrary duration.**
6. **Use outbox when DB transition and workflow start must eventually align.**
7. **Use inbox when external callbacks must not be lost.**
8. **Use process registry when support/audit needs domain-to-workflow mapping.**
9. **Do not query Operate as part of immediate command correctness.**
10. **Do not start long-running workflow with `withResult`.**
11. **Do not trust caller-provided correlation key without validation.**
12. **Do not put PII in correlation keys.**
13. **Do not use one generic message name like `StatusUpdated`.**
14. **Do not make correlation key too broad.**
15. **Do not make correlation key unknowable by the process.**

---

## 36. Mini Reference Architecture

```text
[External/User/API]
        |
        v
[Application API]
  - authZ
  - validate domain state
  - idempotency
  - DB transaction
        |
        +--> [Domain DB]
        |      - application/case state
        |      - workflow registry
        |      - idempotency record
        |      - outbox
        |
        v
[Outbox Dispatcher]
  - create process OR publish BPMN message
  - retry safely
  - update registry
        |
        v
[Camunda 8 / Zeebe]
  - process instance
  - message subscription
  - jobs
        |
        v
[Java Workers]
  - idempotent execution
  - domain services
  - external systems
        |
        v
[Operate/Tasklist/Optimize]
  - projection/read side
  - support and analytics
```

External callback path:

```text
[External System Callback]
        |
        v
[Callback API]
  - authenticate
  - validate
  - derive correlation key
  - insert inbox
        |
        v
[Inbox Dispatcher]
  - publish BPMN message with messageId + TTL
        |
        v
[Zeebe Message Subscription]
        |
        v
[Process Continues]
```

---

## 37. Common Design Examples

### 37.1 Application Submission

```text
Start style:
  direct create or message start

Recommended for enterprise/regulatory:
  domain transition + outbox + message start

messageName:
  ApplicationSubmitted

correlationKey:
  <tenant>:APPLICATION:<applicationId>:INITIAL_REVIEW

messageId:
  <sourceSystem>:<submissionEventId>

TTL:
  0 or short, depending duplicate active instance semantics
```

### 37.2 External Verification Callback

```text
messageName:
  AddressVerificationCompleted

correlationKey:
  <tenant>:APPLICATION:<applicationId>:VERIFICATION:ADDRESS

messageId:
  ADDRESS_VERIFY:<externalEventId>

TTL:
  24h if callback may arrive before process wait state

post-correlation validation:
  verify request id/status/source timestamp
```

### 37.3 Payment Attempt

```text
messageName:
  PaymentAuthorized
  PaymentFailed

correlationKey:
  <tenant>:PAYMENT_ATTEMPT:<paymentAttemptId>

messageId:
  PSP:<pspEventId>

TTL:
  payment authorization validity window
```

### 37.4 Appeal Filing

```text
messageName:
  AppealFiled

correlationKey:
  <tenant>:CASE:<caseId>:APPEAL:<appealNo>

messageId:
  PORTAL:<appealSubmissionId>

TTL:
  based on filing event validity, not statutory period blindly
```

---

## 38. What Top 1% Engineers Pay Attention To

Average implementation asks:

> “Which Java method starts the process?”

Strong implementation asks:

> “What does it mean if process creation outcome is unknown?”

Average implementation asks:

> “What value should I use as correlation key?”

Strong implementation asks:

> “Which conversation is this message intended to continue, and can another active conversation accidentally match it?”

Average implementation asks:

> “How do I correlate callback?”

Strong implementation asks:

> “How do I durably ingest callback, deduplicate it, publish it with correct TTL, validate domain state after correlation, and audit the whole path?”

Average implementation asks:

> “Can I query Operate to check if process started?”

Strong implementation asks:

> “Which system owns immediate truth, which projection is eventually consistent, and what does support need to diagnose mismatch?”

This is the difference between API usage and production workflow engineering.

---

## 39. Summary

Core lessons:

1. Camunda 8 process instance is orchestration state, not domain entity.
2. Direct create and message start solve different problems.
3. Business identity, correlation key, message ID, request ID, and process instance key must be separated.
4. Correlation key routes messages; message ID deduplicates messages.
5. TTL is a business validity decision and race-condition control.
6. Publish message can support buffering; correlate message is immediate correlation semantics.
7. Long-running workflow start should usually be idempotent and asynchronous.
8. Use process registry/outbox/inbox for production-grade reliability.
9. Do not treat Operate projection as immediate command truth.
10. Regulatory/case-management systems need explicit identity, audit, and lifecycle-aware correlation design.

---

## 40. References

Primary references used while preparing this part:

- Camunda 8 Docs — Process instance creation: `https://docs.camunda.io/docs/components/concepts/process-instance-creation/`
- Camunda 8 Docs — Messages: `https://docs.camunda.io/docs/components/concepts/messages/`
- Camunda 8 Docs — Message events: `https://docs.camunda.io/docs/components/modeler/bpmn/message-events/`
- Camunda 8 Docs — Orchestration Cluster REST API, correlate message: `https://docs.camunda.io/docs/apis-tools/orchestration-cluster-api-rest/specifications/correlate-message/`
- Camunda 8 Docs — Java client examples, create process instance: `https://docs.camunda.io/docs/8.7/apis-tools/java-client-examples/process-instance-create/`
- Camunda Forum — Business key feature in Camunda 8: `https://forum.camunda.io/t/business-key-feature-in-camunda-8/40055`
- Camunda 7 Javadoc — RuntimeService business key semantics, used only as migration contrast: `https://docs.camunda.org/javadoc/camunda-bpm-platform/7.6/org/camunda/bpm/engine/RuntimeService.html`

---

## 41. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-011.md
```

Judul:

```text
Part 011 — Error Handling Semantics: BPMN Error, Job Failure, Incident, Escalation, and Business Rejection
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-009.md">⬅️ Part 009 — BPMN Modelling for Distributed Execution: Advanced Patterns and Anti-Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-011.md">Part 011 — Error Handling Semantics: BPMN Error, Job Failure, Incident, Escalation, and Business Rejection ➡️</a>
</div>
