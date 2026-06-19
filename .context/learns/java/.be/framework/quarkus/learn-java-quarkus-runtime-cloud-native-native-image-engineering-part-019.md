# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-019

# Part 019 — Messaging II: Event-Driven Architecture, Outbox, CDC, Saga, and Process Boundary

> Seri: **learn-java-quarkus-runtime-cloud-native-native-image-engineering**  
> Level: Advanced / top 1% engineering track  
> Fokus: Quarkus sebagai runtime untuk event-driven system yang reliable, auditable, dan operable  
> Status: Part 019 dari maksimal 035  

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas messaging dari sisi mekanik Quarkus: channel, connector, Kafka/RabbitMQ/AMQP, ack/nack, failure strategy, dead-letter, retry, ordering, idempotent consumer, dan observability.

Part ini naik satu lapis ke **arsitektur**.

Topik utamanya bukan lagi:

> “Bagaimana cara consume Kafka message di Quarkus?”

Melainkan:

> “Kapan sistem harus event-driven, event apa yang layak dipublish, bagaimana event diproduksi secara reliable, bagaimana consistency dijaga, bagaimana replay aman, bagaimana proses lintas service dikelola, dan bagaimana failure-nya dapat dipertanggungjawabkan?”

Quarkus memberi banyak building block untuk ini:

- SmallRye Reactive Messaging,
- Kafka connector,
- AMQP/RabbitMQ connector,
- Narayana/JTA transaction,
- Hibernate ORM,
- Hibernate Reactive,
- Debezium Outbox extension,
- Dev Services,
- OpenTelemetry,
- Micrometer,
- Kubernetes-native runtime,
- native image readiness.

Tetapi building block bukan arsitektur. Banyak sistem event-driven gagal bukan karena Kafka-nya salah, tetapi karena **event boundary**, **transaction boundary**, dan **process boundary** tidak jelas.

---

## 1. Mental Model: Event-Driven Architecture Bukan “Semua Hal Dikirim ke Kafka”

Event-driven architecture sering disederhanakan menjadi:

```text
service A -> publish event -> service B consume event
```

Itu terlalu dangkal.

Mental model yang lebih tepat:

```text
A service owns a state transition.
When that transition becomes durable,
it may emit a fact about the transition.
Other services may react asynchronously,
with their own consistency, retry, deduplication, and audit rules.
```

Dalam bahasa sederhana:

1. **Service pemilik state melakukan perubahan lokal.**
2. **Perubahan itu disimpan secara durable.**
3. **Fakta tentang perubahan itu dipublikasikan.**
4. **Service lain bereaksi tanpa mengubah fakta historis.**
5. **Setiap consumer bertanggung jawab atas idempotency dan recovery-nya sendiri.**

Event bukan remote method call.
Event bukan command tersembunyi.
Event bukan database row yang dilempar ke broker tanpa model.
Event adalah **fakta domain yang sudah terjadi**.

Contoh:

```text
Bad:
- ProcessApplication
- ValidateUser
- SendEmailNow
- UpdateCaseStatus

Better:
- ApplicationSubmitted
- ApplicantIdentityVerified
- CaseEscalated
- AppealRejected
- LicenceRenewalApproved
- PaymentReceived
```

Perhatikan perbedaannya:

| Bentuk | Makna | Problem |
|---|---|---|
| `ProcessApplication` | perintah | consumer dipaksa melakukan sesuatu |
| `ApplicationSubmitted` | fakta | consumer bebas bereaksi |
| `UpdateCaseStatus` | mutasi teknis | coupling ke model internal |
| `CaseEscalated` | transisi domain | lebih stabil dan auditable |

Top 1% engineer tidak bertanya “pakai Kafka atau RabbitMQ?”, tetapi bertanya:

> “Apa fakta domain yang layak menjadi kontrak antar boundary?”

---

## 2. Event vs Command vs Message vs Notification

Sebelum mendesain sistem event-driven, empat istilah ini harus dipisahkan.

### 2.1 Command

Command adalah instruksi untuk melakukan sesuatu.

```text
ApproveApplication
GenerateInvoice
SendReminderEmail
RecalculateRiskScore
```

Karakteristik:

- ada target handler,
- biasanya imperative,
- bisa gagal karena precondition,
- memiliki maksud dari pengirim,
- sering membutuhkan response atau status.

Command menjawab:

> “Tolong lakukan X.”

### 2.2 Event

Event adalah fakta bahwa sesuatu sudah terjadi.

```text
ApplicationApproved
InvoiceGenerated
ReminderEmailSent
RiskScoreRecalculated
```

Karakteristik:

- immutable,
- past tense,
- bisa memiliki banyak consumer,
- publisher tidak perlu tahu siapa consumer,
- tidak boleh “dibatalkan”; hanya bisa dikompensasi oleh event baru.

Event menjawab:

> “X sudah terjadi.”

### 2.3 Message

Message adalah envelope transport.

Message dapat membawa:

- command,
- event,
- notification,
- raw payload,
- integration record,
- retry instruction.

Message menjawab:

> “Ini data yang dikirim melalui channel.”

### 2.4 Notification

Notification adalah sinyal ringan bahwa sesuatu perlu diperhatikan.

Contoh:

```text
CaseChangedNotification
DocumentReadyNotification
NewTaskAvailableNotification
```

Biasanya notification tidak membawa semua data domain, hanya pointer.

```json
{
  "notificationId": "ntf-001",
  "type": "CaseChanged",
  "caseId": "CASE-2026-0001",
  "changedAt": "2026-06-20T10:15:00Z"
}
```

Consumer kemudian fetch detail dari source of truth.

Trade-off:

| Pattern | Kelebihan | Kekurangan |
|---|---|---|
| Fat event | consumer lebih mandiri | schema berat, PII risk |
| Thin event/notification | schema kecil, aman | consumer harus fetch data |
| Command message | intent jelas | coupling ke receiver |
| Domain event | scalable, decoupled | eventual consistency |

---

## 3. Domain Event vs Integration Event

Ini pemisahan penting.

### 3.1 Domain Event

Domain event adalah event internal dalam bounded context.

Contoh:

```text
ApplicationSubmitted
ApplicantAssigned
OfficerReviewedApplication
CaseEscalatedToSupervisor
```

Domain event biasanya:

- kaya makna domain,
- dipakai untuk rules internal,
- bisa dekat dengan aggregate,
- belum tentu stabil untuk external consumer.

### 3.2 Integration Event

Integration event adalah kontrak antar sistem/service.

Contoh:

```text
application.submitted.v1
case.escalated.v1
licence.renewal.approved.v2
payment.received.v1
```

Integration event harus:

- backward compatible,
- versioned,
- tidak membocorkan model internal,
- memiliki metadata operasional,
- memiliki semantic contract jelas,
- didokumentasikan.

### 3.3 Mapping Domain Event ke Integration Event

Jangan otomatis publish semua domain event ke broker eksternal.

Model yang lebih sehat:

```text
Domain operation
  -> domain events generated internally
  -> transaction commits aggregate changes
  -> integration event(s) derived
  -> outbox stores integration event
  -> relay/CDC publishes to broker
```

Contoh:

```text
Internal domain events:
- EligibilityChecked
- DuplicateProfileDetected
- RiskScoreCalculated
- ApplicationSubmitted

Published integration event:
- application.submitted.v1
```

Kenapa tidak semua domain event dipublish?

Karena:

- terlalu noisy,
- membuat consumer bergantung pada detail internal,
- sulit evolve,
- membocorkan PII/process internal,
- memperbesar blast radius perubahan domain.

Invariant:

> Domain event adalah bahasa internal bounded context. Integration event adalah kontrak antar boundary.

---

## 4. Kenapa Publish Event Langsung dari Service Method Berbahaya

Contoh kode buruk:

```java
@Transactional
public void approve(ApproveCommand command) {
    Application app = repository.findById(command.applicationId());
    app.approve(command.officerId());

    kafkaEmitter.send(new ApplicationApprovedEvent(app.id(), app.status()));
}
```

Sekilas terlihat benar. Tetapi ada race/failure besar.

### 4.1 Failure Scenario

```text
1. DB update berhasil.
2. Kafka publish gagal.
3. Transaction commit tetap terjadi.
4. Consumer tidak pernah tahu application approved.
```

Atau sebaliknya:

```text
1. Kafka publish berhasil.
2. DB transaction rollback.
3. Consumer menerima ApplicationApproved.
4. Source DB sebenarnya tidak approved.
```

Keduanya berbahaya.

Ini disebut **dual-write problem**.

```text
Write DB + Write Broker
```

Dua resource berbeda, dua failure mode berbeda, satu business operation.

### 4.2 Kenapa XA Tidak Selalu Jawaban

Secara teori, distributed transaction/XA bisa menyatukan DB dan broker dalam satu transaction coordinator.

Tetapi di microservice/cloud-native architecture, XA sering bermasalah:

- konfigurasi kompleks,
- latency lebih tinggi,
- availability menurun,
- recovery sulit,
- tidak semua broker/client cocok,
- coupling infrastructure kuat,
- debugging incident lebih berat.

Quarkus menyediakan Narayana/JTA untuk transaction management, tetapi desain event-driven modern sering memilih **transactional outbox** dibanding distributed XA untuk publish event lintas broker.

---

## 5. Transactional Outbox Pattern

Transactional outbox adalah pattern untuk menghindari dual-write problem.

Idenya:

> Dalam transaction database yang sama dengan perubahan domain, tulis juga record event ke tabel outbox. Setelah commit, proses terpisah mem-publish outbox ke broker.

Flow:

```text
┌────────────────────┐
│ Application Service│
└─────────┬──────────┘
          │
          │ one DB transaction
          ▼
┌──────────────────────────────────┐
│ DB                               │
│ - application table updated       │
│ - outbox_event row inserted       │
└──────────────────────────────────┘
          │
          │ after commit
          ▼
┌────────────────────┐
│ Outbox relay / CDC │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Kafka/RabbitMQ/etc │
└────────────────────┘
```

### 5.1 Outbox Table Concept

Contoh struktur konseptual:

```sql
create table outbox_event (
    id varchar(64) primary key,
    aggregate_type varchar(100) not null,
    aggregate_id varchar(100) not null,
    event_type varchar(200) not null,
    event_version integer not null,
    payload jsonb not null,
    headers jsonb null,
    occurred_at timestamp not null,
    created_at timestamp not null,
    published_at timestamp null,
    status varchar(30) not null,
    retry_count integer not null default 0
);
```

Untuk Oracle, `jsonb` diganti sesuai kemampuan DB/version:

- `CLOB` untuk JSON payload,
- `BLOB` untuk encoded payload,
- native JSON type jika tersedia dan cocok.

### 5.2 Application Code Pattern

```java
@ApplicationScoped
public class ApplicationApprovalService {

    @Inject ApplicationRepository applications;
    @Inject OutboxRepository outbox;
    @Inject EventIdGenerator eventIds;

    @Transactional
    public void approve(ApproveApplicationCommand command) {
        Application application = applications.requireById(command.applicationId());

        ApplicationApproved approved = application.approve(
                command.officerId(),
                command.reason(),
                command.now()
        );

        applications.persist(application);

        outbox.persist(OutboxEvent.from(
                eventIds.next(),
                "Application",
                application.id().value(),
                "application.approved",
                1,
                approved.toIntegrationPayload(),
                OutboxHeaders.from(command.correlationId(), command.actor())
        ));
    }
}
```

Yang penting:

- domain update dan outbox insert berada dalam transaction yang sama,
- event dipublish setelah commit,
- event id stabil,
- payload adalah integration contract, bukan entity dump,
- correlation/audit metadata disimpan.

### 5.3 Invariant Outbox

Transactional outbox memiliki invariant:

```text
If the business state is committed,
the intent to publish the integration event is also committed.
```

Bukan invariant:

```text
If DB commits, broker already has the event.
```

Eventual publication masih asynchronous.

---

## 6. Outbox Relay: Polling Publisher vs CDC

Setelah outbox row committed, harus ada mekanisme publish.

Ada dua pendekatan utama.

### 6.1 Polling Publisher

Aplikasi/job membaca tabel outbox secara berkala.

Flow:

```text
select unpublished events
publish to broker
mark as published
```

Contoh:

```java
@Scheduled(every = "5s")
void publishOutboxBatch() {
    List<OutboxEvent> events = outbox.lockNextBatch(100);

    for (OutboxEvent event : events) {
        try {
            publisher.publish(event);
            outbox.markPublished(event.id());
        } catch (Exception e) {
            outbox.markFailedAttempt(event.id(), e);
        }
    }
}
```

Kelebihan:

- sederhana,
- tidak perlu CDC infrastructure,
- mudah dipahami,
- cocok untuk volume sedang.

Kekurangan:

- polling delay,
- perlu locking/claiming,
- risk duplicate publish,
- high volume bisa membebani DB,
- publisher crash setelah publish sebelum mark published bisa duplicate.

### 6.2 CDC with Debezium

CDC membaca database transaction log, lalu menerbitkan perubahan outbox ke broker.

Flow:

```text
DB commit -> transaction log -> Debezium connector -> Kafka topic
```

Kelebihan:

- tidak polling table secara manual,
- latency rendah,
- scalable,
- menangkap committed changes,
- cocok untuk event volume besar.

Kekurangan:

- infrastructure lebih kompleks,
- butuh akses log database,
- schema/table design harus disiplin,
- debugging melibatkan DB log + connector + broker,
- perlu governance topic routing dan serialization.

Quarkus ecosystem memiliki Debezium Quarkus Outbox extension yang tujuannya memfasilitasi pattern outbox secara reusable dan configurable bersama pipeline CDC Debezium. Dokumentasi Debezium menyatakan extension ini membantu aplikasi Quarkus menerapkan outbox pattern untuk berbagi data secara reliable dan asynchronous via CDC connector pipeline.

### 6.3 Comparison

| Aspect | Polling Publisher | CDC/Debezium |
|---|---|---|
| Complexity | rendah-sedang | sedang-tinggi |
| Latency | tergantung interval | rendah |
| Throughput | terbatas polling/DB | tinggi |
| Infra dependency | rendah | tinggi |
| Operational skill | app + DB | app + DB log + Debezium + broker |
| Duplicate risk | ada | tetap ada di consumer side |
| Best for | moderate systems | high-volume integration/event backbone |

Rule praktis:

- Untuk sistem kecil-menengah, polling publisher bisa cukup.
- Untuk event backbone enterprise, CDC lebih kuat.
- Untuk regulatory system, pilih yang paling bisa dioperasikan tim, bukan yang paling trendi.

---

## 7. Exactly-Once Delivery: Mitos yang Harus Diluruskan

Banyak engineer berharap:

> “Saya ingin event saya exactly once.”

Dalam distributed system, yang biasanya bisa dijamin bukan exactly-once end-to-end business effect, tetapi kombinasi terbatas seperti:

- producer idempotence,
- broker transaction,
- offset transaction,
- database uniqueness,
- consumer idempotency,
- deterministic processing.

End-to-end business operation tetap harus diasumsikan:

```text
At-least-once delivery + idempotent consumer
```

### 7.1 Kenapa Duplicate Tetap Mungkin

Duplicate bisa muncul karena:

- producer retry setelah timeout,
- broker ack hilang,
- consumer process berhasil lalu crash sebelum ack,
- outbox relay publish berhasil tapi gagal mark published,
- CDC connector restart,
- manual replay,
- DLQ reprocess,
- consumer group rebalance.

Jadi consumer wajib punya deduplication strategy.

### 7.2 Idempotent Consumer Pattern

Contoh tabel:

```sql
create table processed_message (
    consumer_name varchar(100) not null,
    message_id varchar(100) not null,
    processed_at timestamp not null,
    primary key (consumer_name, message_id)
);
```

Consumer:

```java
@Transactional
public void handle(ApplicationApprovedEvent event) {
    if (processedMessages.alreadyProcessed("licence-service", event.eventId())) {
        return;
    }

    Licence licence = licences.createFromApproval(event.applicationId());
    licences.persist(licence);

    processedMessages.markProcessed("licence-service", event.eventId());
}
```

Lebih aman:

```java
@Transactional
public void handle(ApplicationApprovedEvent event) {
    boolean claimed = processedMessages.tryClaim("licence-service", event.eventId());

    if (!claimed) {
        return;
    }

    Licence licence = licences.createFromApproval(event.applicationId());
    licences.persist(licence);
}
```

Dengan unique constraint, duplicate event tidak menghasilkan duplicate side effect.

### 7.3 Idempotency by Natural Key

Kadang dedup table tidak cukup. Gunakan natural business key.

Contoh:

```text
applicationId + licenceType -> one active licence
```

Maka database constraint:

```sql
unique(application_id, licence_type)
```

Idempotency paling kuat adalah ketika business invariant juga dilindungi oleh database constraint.

---

## 8. Event Envelope Design

Payload event tidak boleh hanya data domain mentah.

Gunakan envelope.

```json
{
  "eventId": "evt-20260620-000001",
  "eventType": "application.approved",
  "eventVersion": 1,
  "occurredAt": "2026-06-20T10:15:30Z",
  "publishedAt": "2026-06-20T10:15:31Z",
  "producer": "application-service",
  "aggregateType": "Application",
  "aggregateId": "APP-2026-0001",
  "correlationId": "corr-abc-123",
  "causationId": "cmd-xyz-789",
  "tenantId": "cea",
  "actor": {
    "type": "USER",
    "id": "officer-001"
  },
  "data": {
    "applicationId": "APP-2026-0001",
    "approvedAt": "2026-06-20T10:15:30Z",
    "approvedBy": "officer-001",
    "licenceType": "EA"
  }
}
```

### 8.1 Required Metadata

| Field | Purpose |
|---|---|
| `eventId` | deduplication |
| `eventType` | routing/handler selection |
| `eventVersion` | schema evolution |
| `occurredAt` | domain time |
| `publishedAt` | transport time |
| `producer` | ownership |
| `aggregateType` | grouping |
| `aggregateId` | per-aggregate ordering |
| `correlationId` | trace business flow |
| `causationId` | event chain analysis |
| `tenantId` | tenant isolation |
| `actor` | audit/security context |
| `data` | event-specific payload |

### 8.2 Correlation vs Causation

Correlation ID:

```text
All messages belonging to the same user/business request.
```

Causation ID:

```text
The command/event that directly caused this event.
```

Example:

```text
HTTP request correlationId = C1
ApproveApplicationCommand commandId = CMD1
ApplicationApproved eventId = EVT1, causationId = CMD1, correlationId = C1
LicenceCreated eventId = EVT2, causationId = EVT1, correlationId = C1
NotificationSent eventId = EVT3, causationId = EVT2, correlationId = C1
```

Ini sangat penting untuk incident analysis.

---

## 9. Event Versioning and Schema Evolution

Event adalah kontrak jangka panjang. Begitu publish ke consumer eksternal, kamu tidak bisa sembarangan mengubahnya.

### 9.1 Compatible Changes

Biasanya aman:

- menambah optional field,
- menambah enum value jika consumer tolerant,
- menambah metadata,
- memperluas object optional.

Berisiko:

- rename field,
- delete field,
- ubah type,
- ubah semantic field,
- ubah timezone meaning,
- ubah id format,
- ubah eventType meaning.

### 9.2 Versioning Strategy

Ada beberapa pendekatan:

#### A. Version in event type

```text
application.approved.v1
application.approved.v2
```

Kelebihan:

- routing jelas,
- consumer eksplisit.

Kekurangan:

- topic/handler bisa proliferasi.

#### B. Version in envelope

```json
{
  "eventType": "application.approved",
  "eventVersion": 2
}
```

Kelebihan:

- topic stabil,
- handler bisa branching.

Kekurangan:

- consumer harus lebih disiplin.

#### C. Topic per major version

```text
application.approved.v1
application.approved.v2
```

Cocok jika perubahan breaking besar.

### 9.3 Event Evolution Rule

Rule yang sehat:

```text
Minor evolution: additive and backward-compatible.
Major evolution: new event version with migration window.
```

Jangan melakukan silent breaking change.

---

## 10. Topic and Routing Design

Topic bukan sekadar nama queue. Topic adalah boundary kontrak.

### 10.1 Topic by Entity vs Topic by Event Type

Entity topic:

```text
application.events
case.events
licence.events
```

Event type topic:

```text
application.submitted
application.approved
application.rejected
case.escalated
```

### 10.2 Trade-Off

| Strategy | Kelebihan | Kekurangan |
|---|---|---|
| Entity topic | ordering per aggregate lebih mudah | consumer harus filter banyak event |
| Event type topic | consumer sederhana | topic banyak, ordering lintas event sulit |
| Domain topic | bounded context jelas | perlu envelope type discipline |

Untuk sistem kompleks, sering lebih sehat:

```text
<bounded-context>.<stream>

application.lifecycle.events
case.lifecycle.events
licence.lifecycle.events
payment.events
notification.events
```

### 10.3 Partition Key

Kafka ordering hanya terjamin dalam partition.

Partition key harus dipilih berdasarkan ordering yang dibutuhkan.

Contoh:

| Event | Key yang masuk akal |
|---|---|
| Application lifecycle event | `applicationId` |
| Case transition event | `caseId` |
| Applicant profile event | `applicantId` |
| Tenant-wide event | hati-hati, bisa hot partition |

Rule:

```text
Choose key based on the entity whose event order must be preserved.
```

Jangan pilih random UUID jika kamu butuh ordering per aggregate.

---

## 11. Ordering: Jangan Mengasumsikan Global Order

Distributed event system jarang memberi global order yang berguna.

Yang biasanya realistis:

```text
Per-key order
Per-partition order
Per-aggregate order
```

### 11.1 Failure Karena Salah Asumsi Ordering

Misalnya consumer menerima:

```text
ApplicationApproved
ApplicationSubmitted
```

Kalau consumer mengasumsikan order global, ia gagal.

Penyebab:

- berbeda partition,
- replay sebagian,
- DLQ reprocess,
- producer berbeda,
- event version migration,
- consumer lag.

### 11.2 Design untuk Out-of-Order

Gunakan version/sequence.

```json
{
  "aggregateId": "APP-1",
  "aggregateVersion": 7,
  "eventType": "application.approved"
}
```

Consumer bisa:

- reject older version,
- buffer missing version,
- fetch current state,
- rebuild projection,
- tolerate duplicate/stale event.

### 11.3 Projection Table Example

```sql
create table application_projection (
    application_id varchar(100) primary key,
    status varchar(50) not null,
    last_event_id varchar(100) not null,
    last_aggregate_version bigint not null,
    updated_at timestamp not null
);
```

Consumer:

```java
@Transactional
public void apply(ApplicationEvent event) {
    ApplicationProjection projection = projections.find(event.aggregateId());

    if (projection != null && event.aggregateVersion() <= projection.lastAggregateVersion()) {
        return;
    }

    projections.upsert(event.toProjectionUpdate());
}
```

Invariant:

> A projection must know the version of the source aggregate it represents.

---

## 12. Saga: Managing Long-Running Cross-Service Process

Saga adalah cara mengelola proses lintas service tanpa distributed transaction global.

Ada dua tipe besar:

1. Choreography.
2. Orchestration.

### 12.1 Choreography Saga

Setiap service publish event dan service lain bereaksi.

```text
ApplicationSubmitted
  -> ScreeningService consumes
  -> ScreeningCompleted
      -> CaseService consumes
      -> CaseCreated
          -> NotificationService consumes
          -> NotificationSent
```

Kelebihan:

- decoupled,
- tidak ada central orchestrator,
- cocok untuk proses sederhana.

Kekurangan:

- flow tersembunyi,
- debugging sulit,
- cyclic dependency mudah muncul,
- kompensasi menyebar,
- sulit melihat status end-to-end.

### 12.2 Orchestration Saga

Satu process manager mengontrol flow.

```text
ApplicationProcessManager
  -> command ScreeningService
  <- event ScreeningCompleted
  -> command CaseService
  <- event CaseCreated
  -> command NotificationService
  <- event NotificationSent
```

Kelebihan:

- flow eksplisit,
- state proses jelas,
- audit lebih mudah,
- timeout/compensation centralized,
- cocok untuk regulatory workflow.

Kekurangan:

- orchestrator bisa menjadi coupling point,
- butuh desain state machine matang,
- failure handling lebih kompleks di satu tempat.

### 12.3 Kapan Pakai Choreography vs Orchestration

| Kondisi | Pilihan lebih cocok |
|---|---|
| Flow sederhana, low risk | Choreography |
| Banyak step dan timeout | Orchestration |
| Butuh audit proses end-to-end | Orchestration |
| Consumer optional | Choreography |
| Regulatory defensibility | Orchestration/process manager |
| Tim kecil, flow sederhana | Choreography hati-hati |
| Banyak bounded context | Hybrid |

Untuk case management/regulatory system, orchestration sering lebih defensible karena alur keputusan harus dapat dijelaskan.

---

## 13. Process Manager Pattern

Process manager adalah stateful component yang menyimpan progress dari proses lintas boundary.

Contoh tabel:

```sql
create table application_process_instance (
    process_id varchar(100) primary key,
    application_id varchar(100) not null,
    state varchar(50) not null,
    version bigint not null,
    correlation_id varchar(100) not null,
    started_at timestamp not null,
    updated_at timestamp not null,
    completed_at timestamp null,
    last_error_code varchar(100) null,
    last_error_message varchar(1000) null
);
```

State machine:

```text
STARTED
  -> WAITING_FOR_SCREENING
  -> WAITING_FOR_CASE_CREATION
  -> WAITING_FOR_NOTIFICATION
  -> COMPLETED
  -> FAILED_COMPENSATION_REQUIRED
```

Handler:

```java
@Transactional
public void on(ScreeningCompleted event) {
    ProcessInstance process = processes.requireByApplicationId(event.applicationId());

    if (!process.isWaitingForScreening()) {
        return; // idempotent duplicate/stale event
    }

    process.markScreeningCompleted(event.result());

    outbox.persist(commandEvent(
            "case.create-requested",
            new CreateCaseRequested(process.applicationId(), process.processId())
    ));
}
```

Yang penting:

- process state persisted,
- transition guarded,
- duplicate event tolerated,
- command/event output via outbox,
- timeout detectable,
- compensation explicit.

---

## 14. Compensation: Bukan Rollback Distributed

Saga tidak melakukan rollback seperti DB transaction.

Saga melakukan **compensating action**.

Contoh:

```text
Step 1: Reserve quota
Step 2: Create licence
Step 3: Send notification fails permanently
```

Kamu tidak bisa selalu rollback licence. Mungkin yang benar:

- create follow-up task,
- mark notification pending,
- alert operator,
- retry later,
- send alternative channel,
- record partial completion.

Compensation adalah business decision.

### 14.1 Bad Compensation

```text
If anything fails, delete all data.
```

Ini sering salah karena:

- menghapus audit trail,
- melanggar legal traceability,
- menghilangkan evidence,
- membuat status inconsistent.

### 14.2 Good Compensation

```text
If notification failed after approval,
keep approval,
mark notification as PENDING_RETRY,
create operational task,
and emit NotificationDeliveryFailed.
```

Dalam sistem regulatory, failure tidak selalu berarti undo. Sering berarti **explicit exceptional state**.

---

## 15. Eventual Consistency: Desain UX dan Operasi Harus Mengakuinya

Event-driven system membawa eventual consistency.

Contoh:

```text
Application approved at 10:00:00
Licence projection updated at 10:00:03
Notification sent at 10:00:05
Search index updated at 10:00:10
```

Jika UI/API mengasumsikan semua langsung sinkron, user akan melihat inconsistency.

### 15.1 Pattern UX

Gunakan status eksplisit:

```text
APPROVED_PROCESSING
APPROVED_PENDING_NOTIFICATION
APPROVED_COMPLETED
```

Atau return:

```json
{
  "applicationId": "APP-1",
  "status": "APPROVED",
  "downstreamProcessing": {
    "licenceCreation": "PENDING",
    "notification": "PENDING"
  }
}
```

### 15.2 Read-Your-Writes Problem

Setelah command berhasil, projection/read model mungkin belum update.

Solusi:

- return write model state directly,
- wait for projection with timeout,
- show processing indicator,
- use command status endpoint,
- keep critical reads on source of truth.

Top 1% engineer tidak menyembunyikan eventual consistency; ia mendesain UX dan observability untuknya.

---

## 16. Replay Safety

Replay adalah kemampuan memproses ulang event lama.

Replay berguna untuk:

- rebuild projection,
- memperbaiki bug consumer,
- backfill data,
- migrate schema,
- audit investigation.

Tetapi replay berbahaya jika consumer punya side effect eksternal.

### 16.1 Replay-Safe Consumer

Replay-safe jika:

- idempotent,
- output deterministic,
- tidak mengirim email ulang sembarangan,
- tidak charge payment ulang,
- tidak membuat duplicate task,
- tidak overwrite data baru dengan data lama,
- mampu membedakan live processing vs replay.

### 16.2 Side Effect Classification

| Side effect | Replay policy |
|---|---|
| Update projection | safe jika versioned/idempotent |
| Insert audit read model | safe jika eventId unique |
| Send email | tidak replay otomatis |
| Charge payment | tidak replay otomatis |
| Call external agency API | butuh idempotency key/approval |
| Create task | safe jika natural key unique |

### 16.3 Replay Mode

Consumer bisa diberi mode:

```text
LIVE
REPLAY
BACKFILL
DRY_RUN
```

Dalam replay mode:

- external side effect disabled,
- projection writes allowed,
- audit flagged as replay,
- metrics separated,
- offset tidak dicampur dengan live consumer group.

---

## 17. Poison Message and Dead Letter Governance

Poison message adalah message yang terus gagal diproses.

Penyebab:

- schema invalid,
- missing reference data,
- business precondition gagal,
- bug consumer,
- external dependency down,
- data corruption,
- unauthorized tenant,
- incompatible event version.

### 17.1 Failure Classification

| Failure | Retry? | DLQ? | Human action? |
|---|---:|---:|---:|
| temporary DB down | yes | after budget | maybe |
| external API timeout | yes | after budget | maybe |
| invalid schema | no | yes | yes |
| duplicate event | no | no | no |
| stale version | no | no | maybe metric |
| missing reference | maybe | yes | yes |
| permission/tenant violation | no | security DLQ | yes |

Quarkus Kafka/Reactive Messaging mendukung failure strategy seperti fail, ignore, dan dead-letter queue; dokumentasi Quarkus juga menjelaskan bahwa dead-letter topic menyimpan message gagal agar bisa dianalisis dan diputuskan apakah retry, skip, atau tindakan lain diperlukan.

### 17.2 DLQ Event Envelope

DLQ message harus membawa:

```json
{
  "originalTopic": "application.lifecycle.events",
  "originalPartition": 3,
  "originalOffset": 991827,
  "eventId": "evt-001",
  "eventType": "application.approved",
  "failureClass": "VALIDATION_ERROR",
  "failureMessage": "missing applicationId",
  "failedAt": "2026-06-20T10:20:00Z",
  "consumer": "licence-service",
  "correlationId": "corr-001"
}
```

DLQ tanpa metadata bukan operational tool; itu hanya tempat sampah.

### 17.3 DLQ Runbook

Setiap DLQ perlu runbook:

1. Bagaimana melihat message gagal?
2. Bagaimana mengklasifikasi error?
3. Apakah aman reprocess?
4. Apakah perlu patch data?
5. Apakah perlu deploy fix?
6. Bagaimana memastikan tidak duplicate side effect?
7. Bagaimana menutup incident?

---

## 18. Quarkus Implementation Blueprint: Outbox + Kafka

Bagian ini bukan full project, tetapi blueprint konseptual.

### 18.1 Dependencies Konseptual

Untuk Quarkus JVM/blocking ORM:

```text
quarkus-rest
quarkus-rest-jackson
quarkus-hibernate-orm
quarkus-jdbc-postgresql / jdbc-oracle / jdbc-mysql
quarkus-narayana-jta
quarkus-messaging-kafka
quarkus-scheduler optional for polling relay
quarkus-opentelemetry
quarkus-micrometer
```

Untuk Debezium Outbox:

```text
io.debezium:debezium-quarkus-outbox
```

Quarkus extension registry mencantumkan Debezium Quarkus Outbox sebagai extension untuk reliable microservices data exchange dengan Debezium dan CDC.

### 18.2 Event Interface

```java
public interface IntegrationEvent {
    String eventId();
    String eventType();
    int eventVersion();
    String aggregateType();
    String aggregateId();
    Instant occurredAt();
    String correlationId();
}
```

### 18.3 Envelope

```java
public record EventEnvelope<T>(
        String eventId,
        String eventType,
        int eventVersion,
        String producer,
        String aggregateType,
        String aggregateId,
        Long aggregateVersion,
        Instant occurredAt,
        Instant publishedAt,
        String correlationId,
        String causationId,
        String tenantId,
        ActorRef actor,
        T data
) {}
```

### 18.4 Outbox Entity

```java
@Entity
@Table(name = "outbox_event")
public class OutboxEventEntity {

    @Id
    @Column(name = "id", nullable = false, length = 100)
    public String id;

    @Column(name = "aggregate_type", nullable = false, length = 100)
    public String aggregateType;

    @Column(name = "aggregate_id", nullable = false, length = 100)
    public String aggregateId;

    @Column(name = "event_type", nullable = false, length = 200)
    public String eventType;

    @Column(name = "event_version", nullable = false)
    public int eventVersion;

    @Lob
    @Column(name = "payload", nullable = false)
    public String payload;

    @Lob
    @Column(name = "headers")
    public String headers;

    @Column(name = "occurred_at", nullable = false)
    public Instant occurredAt;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "status", nullable = false, length = 30)
    public String status;

    @Column(name = "retry_count", nullable = false)
    public int retryCount;
}
```

Catatan:

- gunakan private fields + accessors jika project convention menuntut,
- mapping bisa dibuat lebih strict,
- payload bisa disimpan compressed jika besar,
- jangan simpan entity serialization mentah.

### 18.5 Outbox Writer

```java
@ApplicationScoped
public class OutboxWriter {

    @Inject ObjectMapper objectMapper;
    @Inject EntityManager entityManager;

    public <T> void append(EventEnvelope<T> envelope) {
        OutboxEventEntity entity = new OutboxEventEntity();
        entity.id = envelope.eventId();
        entity.aggregateType = envelope.aggregateType();
        entity.aggregateId = envelope.aggregateId();
        entity.eventType = envelope.eventType();
        entity.eventVersion = envelope.eventVersion();
        entity.payload = toJson(envelope);
        entity.headers = toJson(Map.of(
                "correlationId", envelope.correlationId(),
                "causationId", envelope.causationId(),
                "tenantId", envelope.tenantId()
        ));
        entity.occurredAt = envelope.occurredAt();
        entity.createdAt = Instant.now();
        entity.status = "NEW";
        entity.retryCount = 0;

        entityManager.persist(entity);
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize outbox event", e);
        }
    }
}
```

### 18.6 Domain Service Usage

```java
@Transactional
public void submit(SubmitApplicationCommand command) {
    Application application = Application.submit(
            command.applicationId(),
            command.applicantId(),
            command.submittedAt()
    );

    applications.persist(application);

    EventEnvelope<ApplicationSubmittedPayload> event = envelopeFactory.create(
            "application.submitted",
            1,
            "Application",
            application.id().value(),
            application.version(),
            new ApplicationSubmittedPayload(
                    application.id().value(),
                    application.applicantId().value(),
                    application.submittedAt()
            ),
            command.context()
    );

    outbox.append(event);
}
```

Invariant:

> Domain mutation and outbox append must happen inside the same database transaction.

---

## 19. Polling Outbox Relay Blueprint

Jika tidak memakai Debezium, gunakan relay yang hati-hati.

### 19.1 Claim Batch

Hindari dua pod mempublish event yang sama tanpa kontrol.

Pattern:

```sql
select * from outbox_event
where status = 'NEW'
order by created_at
fetch first 100 rows only
for update skip locked;
```

Lalu mark `PROCESSING` dalam transaction pendek.

### 19.2 Publish Then Mark

Masalah:

```text
publish succeeds -> app crashes -> status remains PROCESSING/NEW -> duplicate publish later
```

Karena itu consumer tetap harus idempotent.

### 19.3 Stuck PROCESSING Recovery

Tambahkan:

- `locked_at`,
- `locked_by`,
- `attempt_count`,
- `next_attempt_at`,
- `last_error`,
- max retry,
- manual dead-letter status.

Contoh status:

```text
NEW
PROCESSING
PUBLISHED
FAILED_RETRYABLE
FAILED_DEAD
```

### 19.4 Relay Pseudocode

```java
@Scheduled(every = "2s")
void relay() {
    List<OutboxEventEntity> events = outbox.claimBatch(instanceId, 100);

    for (OutboxEventEntity event : events) {
        try {
            kafka.publish(event.topic(), event.key(), event.payload(), event.headers());
            outbox.markPublished(event.id);
        } catch (RetryablePublishException e) {
            outbox.scheduleRetry(event.id, e);
        } catch (NonRetryablePublishException e) {
            outbox.markDead(event.id, e);
        }
    }
}
```

### 19.5 Relay Observability

Metrics wajib:

- outbox new count,
- outbox processing count,
- outbox dead count,
- oldest unpublished age,
- publish success rate,
- publish failure rate,
- retry count,
- publish latency,
- broker send latency.

Alert terbaik bukan “publish failed once”, tetapi:

```text
oldest_unpublished_event_age_seconds > threshold
```

Karena itu mengukur backlog bisnis.

---

## 20. Consumer Blueprint in Quarkus Reactive Messaging

### 20.1 Basic Consumer

```java
@ApplicationScoped
public class ApplicationEventConsumer {

    @Inject ApplicationProjectionUpdater updater;

    @Incoming("application-events")
    public Uni<Void> consume(EventEnvelope<ApplicationApprovedPayload> event) {
        return updater.apply(event);
    }
}
```

Untuk blocking ORM, jangan jalankan di event loop.

```java
@Incoming("application-events")
@Blocking
@Transactional
public void consume(EventEnvelope<ApplicationApprovedPayload> event) {
    projectionService.apply(event);
}
```

### 20.2 Idempotent Consumer with Transaction

```java
@ApplicationScoped
public class LicenceConsumer {

    @Inject ProcessedMessageRepository processed;
    @Inject LicenceRepository licences;

    @Incoming("application-approved")
    @Blocking
    @Transactional
    public void onApproved(EventEnvelope<ApplicationApprovedPayload> event) {
        if (!processed.tryMarkProcessing("licence-service", event.eventId())) {
            return;
        }

        licences.createIfAbsent(
                event.data().applicationId(),
                event.data().licenceType(),
                event.occurredAt()
        );

        processed.markProcessed("licence-service", event.eventId());
    }
}
```

### 20.3 Failure Handling

Jika exception dilempar, connector dapat nack message. Strategy tergantung konfigurasi channel.

Pattern:

- retry untuk transient failure,
- DLQ untuk poison message,
- ignore hanya untuk duplicate/stale yang memang aman,
- fail-fast untuk critical invariant violation di environment non-prod.

---

## 21. Event-Driven Architecture untuk Regulatory Case Management

Untuk domain seperti enforcement/case management, event-driven architecture harus lebih hati-hati.

Contoh lifecycle:

```text
ApplicationSubmitted
ScreeningStarted
ScreeningCompleted
CaseCreated
CaseAssigned
EvidenceRequested
EvidenceSubmitted
OfficerReviewCompleted
SupervisorApprovalRequested
SupervisorApproved
NoticeIssued
AppealSubmitted
AppealDecisionRecorded
CaseClosed
```

### 21.1 Apa yang Harus Menjadi Event?

Event yang layak:

- transisi state penting,
- keputusan resmi,
- perubahan assignment,
- dokumen masuk/keluar,
- deadline berubah,
- escalation terjadi,
- notice diterbitkan,
- external integration completed,
- payment received,
- appeal decision recorded.

Event yang tidak layak dipublish eksternal:

- user membuka halaman,
- tab UI berubah,
- field draft autosaved setiap 3 detik,
- temporary validation internal,
- technical cache invalidation internal,
- query executed.

### 21.2 Audit Event vs Integration Event

Audit event:

```text
Who did what, when, from where, before/after, reason, evidence.
```

Integration event:

```text
A stable fact other services need to react to.
```

Jangan mencampur keduanya.

Contoh:

```text
Audit:
Officer A changed case priority from NORMAL to HIGH with reason X.

Integration:
CasePriorityChanged v1.
```

Audit mungkin jauh lebih detail dan sensitif. Integration event harus minimal dan governed.

### 21.3 Defensibility Rule

Untuk regulatory system, setiap event penting harus bisa menjawab:

1. Siapa yang menyebabkan event?
2. Apa business precondition saat event terjadi?
3. Apa state sebelum dan sesudah?
4. Apa policy/rule version yang dipakai?
5. Apakah event publish reliable?
6. Apakah consumer side effect idempotent?
7. Bagaimana failure/retry ditangani?
8. Bagaimana replay dilakukan tanpa merusak legal state?

---

## 22. Event Sourcing vs Event-Driven Architecture

Jangan samakan event-driven architecture dengan event sourcing.

### 22.1 Event-Driven Architecture

State utama tetap di table biasa.

```text
application table
case table
licence table
```

Event dipakai untuk integrasi/asynchronous reaction.

### 22.2 Event Sourcing

State dibangun dari event log.

```text
event_store
  ApplicationSubmitted
  ApplicationScreened
  ApplicationApproved
```

Current state adalah projection dari event.

### 22.3 Comparison

| Aspect | EDA with Outbox | Event Sourcing |
|---|---|---|
| Source of truth | current-state DB | event log |
| Complexity | sedang | tinggi |
| Audit | good jika audit dirancang | sangat kuat |
| Query | mudah | perlu projection |
| Migration | lebih mudah | sulit |
| Regulatory trace | bisa kuat | sangat kuat tapi kompleks |
| Team maturity needed | sedang | tinggi |

Untuk sebagian besar enterprise Quarkus service, mulai dengan:

```text
Current-state model + audit trail + transactional outbox
```

Jangan langsung event sourcing kecuali kebutuhan dan kemampuan operasionalnya jelas.

---

## 23. Native Image Implications

Event-driven Quarkus service yang native image harus memperhatikan:

- serializer/deserializer reflection,
- Jackson record/class registration,
- Avro/Protobuf generated classes,
- schema registry client compatibility,
- SSL/TLS truststore,
- Kafka client native support,
- dynamic class loading,
- reflection-heavy mapping libraries,
- time zone/locale resource,
- monitoring agent compatibility.

Rule:

```text
Native readiness must be tested at integration boundary, not only unit test.
```

Native image test wajib mencakup:

- consume message,
- deserialize payload,
- write DB,
- publish outbox/event,
- handle DLQ path,
- TLS connection to broker,
- metrics/tracing export.

---

## 24. Testing Strategy

### 24.1 Unit Test

Test:

- event mapping,
- version handling,
- idempotency function,
- state transition,
- compensation decision.

### 24.2 Component Test

Test dengan Quarkus:

- CDI wiring,
- transaction boundary,
- outbox insert,
- consumer handler,
- config profile.

### 24.3 Integration Test

Test dengan broker dan DB:

- publish/consume,
- duplicate message,
- out-of-order message,
- DLQ path,
- retry path,
- DB rollback,
- relay crash simulation,
- consumer rebalance.

Quarkus Dev Services bisa membantu provisioning service untuk dev/test mode, termasuk banyak service eksternal yang tidak dikonfigurasi secara manual.

### 24.4 Contract Test

Validasi:

- event schema,
- required metadata,
- backward compatibility,
- enum evolution,
- consumer compatibility.

### 24.5 Replay Test

Test scenario:

```text
Given 1000 historical events
When projection rebuilt
Then final projection equals expected state
And no external notification/payment is executed
```

---

## 25. Observability for Event-Driven Systems

Observability event-driven berbeda dari REST.

REST punya request-response path. Event-driven punya asynchronous chain.

### 25.1 Metrics

Producer:

- events produced count,
- outbox backlog,
- publish latency,
- publish failure,
- oldest unpublished event age.

Broker:

- topic throughput,
- partition lag,
- consumer lag,
- rebalance count,
- DLQ count.

Consumer:

- events consumed,
- processing latency,
- processing failure,
- duplicate skipped,
- stale skipped,
- retry count,
- DLQ produced.

Process manager:

- process state count,
- stuck process count,
- timeout count,
- compensation count,
- average process completion time.

### 25.2 Tracing

Trace harus membawa:

- correlation id,
- causation id,
- event id,
- aggregate id,
- consumer name,
- topic/partition/offset,
- process id.

### 25.3 Logs

Log event consumer harus structured:

```json
{
  "message": "event consumed",
  "eventId": "evt-001",
  "eventType": "application.approved",
  "aggregateId": "APP-1",
  "consumer": "licence-service",
  "correlationId": "corr-001",
  "topic": "application.lifecycle.events",
  "partition": 3,
  "offset": 991827
}
```

Jangan log full payload jika mengandung PII.

---

## 26. Anti-Patterns

### 26.1 Event as CRUD Row Change

```text
ApplicationUpdated
```

dengan payload seluruh row.

Masalah:

- semantic tidak jelas,
- consumer harus diff sendiri,
- PII bocor,
- schema coupling tinggi.

Lebih baik:

```text
ApplicationContactChanged
ApplicationStatusChanged
ApplicationSubmitted
ApplicationApproved
```

### 26.2 Command Disguised as Event

```text
SendEmailEvent
```

Jika maksudnya menyuruh notification service mengirim email, itu command.

Lebih jelas:

```text
EmailSendRequested
```

Atau jika sudah terjadi:

```text
EmailSent
EmailDeliveryFailed
```

### 26.3 Publish Inside Transaction Directly to Broker

Sudah dibahas: dual-write problem.

Gunakan outbox atau desain transaction boundary eksplisit.

### 26.4 No Idempotency

Consumer yang tidak idempotent akan rusak saat duplicate/replay.

### 26.5 DLQ Without Ownership

DLQ tanpa owner dan runbook hanya menunda incident.

### 26.6 Event Schema Without Version

Event tanpa version akan menyulitkan evolution.

### 26.7 Choreography Spaghetti

Semua service saling react tanpa process owner.

Gejala:

- tidak ada yang tahu flow lengkap,
- incident analysis lama,
- cycle antar event,
- compensation tidak jelas.

### 26.8 Event-Driven untuk Semua Hal

Tidak semua integration perlu event.

Gunakan REST/synchronous call jika:

- butuh immediate response,
- query sederhana,
- operation kecil dan bounded,
- consistency synchronous lebih penting,
- consumer hanya satu dan strongly coupled.

---

## 27. Design Decision Framework

Gunakan pertanyaan ini sebelum memilih event-driven.

### 27.1 Apakah Ini Event atau Command?

- Apakah sudah terjadi? Event.
- Apakah meminta pihak lain melakukan sesuatu? Command.
- Apakah hanya memberi tahu ada perubahan? Notification.

### 27.2 Siapa Pemilik State?

- Service mana source of truth?
- Consumer boleh menyimpan copy/projection?
- Bagaimana stale data ditangani?

### 27.3 Apa Consistency Requirement?

- Harus synchronous?
- Boleh eventual?
- Berapa toleransi delay?
- Apa dampak user/legal jika delay?

### 27.4 Apa Failure Policy?

- Retry berapa kali?
- DLQ kapan?
- Manual action kapan?
- Compensation apa?
- Apakah replay aman?

### 27.5 Apa Observability-nya?

- Bagaimana trace end-to-end?
- Metric backlog apa?
- Alert threshold apa?
- Runbook siapa?

---

## 28. Production Checklist

Sebelum event-driven Quarkus service production, pastikan:

### Event Contract

- [ ] Event punya `eventId`.
- [ ] Event punya `eventType`.
- [ ] Event punya `eventVersion`.
- [ ] Event punya `occurredAt`.
- [ ] Event punya `producer`.
- [ ] Event punya `aggregateId`.
- [ ] Event punya `correlationId`.
- [ ] Event schema terdokumentasi.
- [ ] Breaking change strategy jelas.

### Producer

- [ ] Tidak publish langsung dalam DB transaction tanpa outbox/strategy.
- [ ] Outbox insert atomic dengan business state.
- [ ] Payload bukan entity dump.
- [ ] PII dikontrol.
- [ ] Topic/key strategy jelas.
- [ ] Publish failure observable.

### Outbox/CDC

- [ ] Outbox backlog metric ada.
- [ ] Oldest unpublished event alert ada.
- [ ] Relay/CDC restart tested.
- [ ] Duplicate publish tolerated.
- [ ] Dead/stuck event runbook ada.

### Consumer

- [ ] Idempotent.
- [ ] Duplicate tested.
- [ ] Out-of-order tested.
- [ ] Retry budget jelas.
- [ ] DLQ strategy jelas.
- [ ] Replay behavior jelas.
- [ ] External side effect guarded.

### Saga/Process

- [ ] Process owner jelas.
- [ ] State machine persisted.
- [ ] Timeout policy ada.
- [ ] Compensation explicit.
- [ ] Stuck process observable.
- [ ] Audit trail cukup.

### Operations

- [ ] Consumer lag dashboard.
- [ ] DLQ dashboard.
- [ ] Outbox dashboard.
- [ ] Correlation tracing.
- [ ] Runbook reprocess.
- [ ] Runbook schema migration.
- [ ] Security/tenant validation.

---

## 29. Latihan Top 1% Engineer

### Latihan 1 — Classify Messages

Untuk setiap nama berikut, klasifikasikan sebagai command/event/notification dan perbaiki namanya jika buruk:

```text
UpdateApplicationStatus
ApplicationUpdated
SendApprovalEmail
ApprovalEmailSent
CaseEscalated
GenerateReport
ReportGenerated
DocumentChanged
DocumentSubmitted
```

### Latihan 2 — Design Outbox

Desain outbox untuk proses:

```text
Application approval creates licence and sends notification.
```

Tentukan:

- event type,
- aggregate id,
- partition key,
- payload,
- metadata,
- idempotency key,
- DLQ policy.

### Latihan 3 — Saga Failure

Flow:

```text
ApplicationApproved -> LicenceCreated -> InvoiceGenerated -> NotificationSent
```

Jika `InvoiceGenerated` gagal karena external billing API down selama 2 jam:

- state proses harus apa?
- retry policy bagaimana?
- apakah licence dibatalkan?
- apa yang user lihat?
- apa yang operator lihat?
- event apa yang dipublish?

### Latihan 4 — Replay Design

Consumer mengirim email saat menerima `ApplicationApproved`.

Bagaimana membuatnya replay-safe?

Minimal jawab:

- table idempotency,
- external side effect guard,
- replay mode,
- natural key,
- operational runbook.

---

## 30. Ringkasan Invariant

Pegang invariant ini:

1. **Event adalah fakta, command adalah instruksi.**
2. **Domain event tidak otomatis sama dengan integration event.**
3. **Jangan dual-write DB dan broker tanpa outbox/strategy.**
4. **Outbox menjamin intent to publish ikut commit dengan state bisnis.**
5. **CDC mengurangi polling, tetapi menambah operational complexity.**
6. **End-to-end exactly-once business effect harus didesain lewat idempotency.**
7. **Consumer wajib tahan duplicate.**
8. **Consumer yang punya side effect eksternal harus replay-aware.**
9. **Ordering biasanya hanya per key/partition, bukan global.**
10. **Saga bukan rollback; saga adalah explicit business compensation.**
11. **Choreography cocok untuk flow sederhana; orchestration lebih cocok untuk proses kompleks dan auditable.**
12. **DLQ tanpa owner dan runbook bukan reliability, hanya penundaan masalah.**
13. **Event schema adalah kontrak jangka panjang.**
14. **Observability event-driven harus berbasis correlation, causation, lag, backlog, dan process state.**
15. **Dalam regulatory system, event harus defensible secara audit dan legal reasoning.**

---

## 31. Penutup

Event-driven architecture dengan Quarkus bukan sekadar memasang extension Kafka. Quarkus memberi runtime yang efisien, reactive messaging, transaction integration, outbox support, dan cloud-native tooling. Tetapi kualitas sistem tetap ditentukan oleh desain boundary:

```text
state boundary
transaction boundary
event boundary
process boundary
failure boundary
audit boundary
```

Jika boundary ini jelas, event-driven architecture bisa membuat sistem lebih resilient, scalable, dan evolvable.

Jika boundary ini kabur, Kafka hanya menjadi distributed spaghetti machine.

Part berikutnya akan masuk ke **Scheduler, Jobs, Batch, and Workload Orchestration**: bagaimana Quarkus menjalankan background workload, scheduler, Quartz, clustered job, idempotent job, retry, lock, misfire, Kubernetes CronJob vs in-app scheduler, dan operational kill switch.

---

## Referensi Resmi dan Relevan

- Quarkus Messaging Extensions — acknowledgement chaining, channel model, connector behavior.
- Quarkus Apache Kafka Reference Guide — Kafka connector, failure strategy, DLQ, delayed retry topic.
- Quarkus Kafka failure strategy blog — dead-letter topic strategy and operational handling.
- Quarkus Transactions Guide — Narayana/JTA transaction model.
- Quarkus Datasource Guide — Narayana transaction integration with datasource.
- Debezium Quarkus Outbox Extension — outbox pattern for reliable microservices data exchange with Debezium and CDC.
- Debezium Outbox Extension Documentation — reusable configurable outbox component for Quarkus with CDC pipeline.
- Quarkus Dev Services Overview — automatic provisioning of services in dev/test mode.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-018.md">⬅️ Part 018 — Messaging I: Kafka, RabbitMQ, AMQP, SmallRye Reactive Messaging</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-020.md">Scheduler, Jobs, Batch, and Workload Orchestration ➡️</a>
</div>
