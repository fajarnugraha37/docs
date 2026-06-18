# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-022

# Part 22 — JMS in Microservices: Command Queue, Domain Event, Integration Event, Saga, dan Choreography

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Bagian: 22 dari 35  
> Fokus: bagaimana memakai JMS/Jakarta Messaging sebagai mekanisme koordinasi antar microservice tanpa membuat sistem menjadi distributed monolith, hidden RPC mesh, atau event chaos.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya sudah membahas banyak aspek teknis JMS:

- queue semantics,
- topic semantics,
- message anatomy,
- producer/consumer engineering,
- acknowledgement,
- transaction,
- reliability,
- ordering,
- redelivery/DLQ,
- request/reply,
- selector/routing,
- security,
- broker architecture,
- provider differences,
- Jakarta EE runtime,
- Spring integration.

Part ini naik satu level: **bagaimana JMS dipakai sebagai bagian dari arsitektur microservices**.

JMS bukan otomatis membuat sistem menjadi microservices. Queue/topic hanyalah transport. Microservice yang buruk tetap buruk walaupun semua komunikasi memakai broker.

Masalah utama dalam microservices bukan “bagaimana mengirim message”, tetapi:

1. siapa pemilik keputusan,
2. siapa pemilik data,
3. siapa boleh mengubah state,
4. kapan state dianggap final,
5. bagaimana failure dikompensasi,
6. bagaimana proses bisnis dipahami manusia,
7. bagaimana sistem dipulihkan saat sebagian proses gagal.

Part ini membahas JMS sebagai **coordination boundary**, bukan hanya message transport.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. membedakan **command**, **domain event**, dan **integration event** secara presisi;
2. memilih queue atau topic berdasarkan intent, bukan berdasarkan kebiasaan;
3. mendesain message flow antar service tanpa membuat coupling tersembunyi;
4. memahami saga choreography dan saga orchestration;
5. melihat kapan JMS cocok untuk saga, dan kapan workflow engine lebih tepat;
6. menghindari anti-pattern “microservice via JMS tapi sebenarnya distributed monolith”;
7. membuat handler JMS yang selaras dengan aggregate, state machine, idempotency, dan transaction boundary;
8. membangun arsitektur outbox/inbox untuk konsistensi DB + JMS;
9. mendesain failure recovery, replay, DLQ, dan operator workflow;
10. melakukan design review terhadap sistem microservices berbasis JMS.

---

## 2. Mental Model Utama

### 2.1 JMS adalah transport, bukan architecture

JMS memberi abstraksi untuk aplikasi Java agar bisa membuat, mengirim, menerima, dan membaca message melalui layanan komunikasi asynchronous yang reliable dan loosely coupled. Jakarta Messaging mendeskripsikan API ini untuk komunikasi messaging reliable/asynchronous/loosely coupled.

Namun JMS tidak otomatis menentukan:

- service boundary,
- ownership data,
- event contract,
- retry policy,
- consistency model,
- saga behavior,
- idempotency,
- auditability,
- governance.

Jadi jangan mulai desain dari:

> “Kita buat queue apa saja?”

Mulai dari:

> “Perubahan bisnis apa yang perlu dikoordinasikan, siapa pemiliknya, dan invariant apa yang tidak boleh rusak?”

---

### 2.2 Microservices adalah ownership decomposition

Microservices bukan sekadar banyak service kecil. Microservices adalah pemisahan ownership:

- ownership capability,
- ownership data,
- ownership decision,
- ownership release,
- ownership runtime failure.

Sebuah service yang hanya menjadi thin wrapper table orang lain bukan microservice yang sehat.

Dalam konteks JMS, pertanyaan fundamentalnya:

> “Message ini meminta service lain melakukan sesuatu, atau memberitahu bahwa sesuatu sudah terjadi?”

Itulah pembeda besar antara **command** dan **event**.

---

### 2.3 Message membawa intent

Message bukan cuma payload. Message adalah ekspresi intent.

Ada beberapa intent utama:

| Intent | Contoh | Siapa targetnya? | Transport umum |
|---|---|---:|---|
| Command | `ApproveApplicationCommand` | satu owner capability | queue |
| Domain Event | `ApplicationApproved` | internal domain/subdomain observer | topic/internal event bus |
| Integration Event | `ApplicationApprovedV1` | service eksternal/bounded context lain | topic/public integration channel |
| Document Message | `ApplicationSnapshotExported` | consumer yang butuh data snapshot | queue/topic tergantung tujuan |
| Query/Request | `GetCustomerEligibilityRequest` | service yang punya data | HTTP/gRPC/JMS request-reply bila async needed |

Kesalahan fatal terjadi ketika semua message diperlakukan sama.

---

## 3. Vocabulary yang Harus Jelas

### 3.1 Service

Service adalah unit ownership runtime dan business capability.

Service yang sehat punya:

- database sendiri atau schema ownership yang jelas,
- API contract sendiri,
- deployment boundary sendiri,
- monitoring sendiri,
- failure handling sendiri,
- business responsibility yang jelas.

Jika service A langsung update database service B, message broker tidak menyelamatkan desain itu.

---

### 3.2 Bounded Context

Bounded context adalah batas model domain.

Contoh:

- Application Management,
- Compliance Case,
- Payment,
- Notification,
- Document Management,
- Identity,
- Audit.

Kata yang sama bisa punya arti beda di context berbeda.

Contoh `Case`:

- di compliance: investigation entity,
- di support: customer ticket,
- di legal: legal proceeding,
- di workflow: process instance.

Karena itu integration event harus membawa semantic yang eksplisit, bukan hanya dump entity internal.

---

### 3.3 Aggregate

Aggregate adalah consistency boundary dalam domain.

Untuk message-driven microservices, aggregate membantu menjawab:

- message ini mengubah aggregate mana?
- ordering harus dijaga per aggregate apa?
- idempotency key apa?
- optimistic lock terhadap version berapa?
- saga state disimpan di entity mana?

Jika kamu tidak tahu aggregate boundary, kamu biasanya akan overuse global ordering atau distributed transaction.

---

### 3.4 Command

Command adalah permintaan untuk melakukan aksi.

Karakteristik command:

- imperative,
- punya target owner,
- biasanya satu receiver logical,
- boleh ditolak,
- menghasilkan success/failure,
- sering butuh idempotency key,
- cocok dengan queue.

Contoh:

```text
ApproveApplicationCommand
- commandId
- applicationId
- requestedBy
- decisionReason
- expectedVersion
- occurredAt/requestedAt
```

Command berarti:

> “Service pemilik capability, tolong lakukan aksi ini jika valid.”

Command bukan fakta. Command bisa gagal.

---

### 3.5 Event

Event adalah fakta bahwa sesuatu sudah terjadi.

Karakteristik event:

- past tense,
- tidak meminta aksi tertentu,
- publisher tidak tahu semua consumer,
- tidak boleh “ditolak” oleh consumer,
- consumer boleh bereaksi sesuai kepentingannya sendiri,
- cocok dengan topic/pub-sub.

Contoh:

```text
ApplicationApproved
- eventId
- applicationId
- approvalId
- approvedBy
- approvedAt
- previousStatus
- newStatus
- applicationVersion
```

Event berarti:

> “Sesuatu sudah terjadi di service pemilik fakta ini.”

Consumer boleh melakukan:

- update read model,
- create notification,
- start compliance screening,
- write audit,
- update cache,
- trigger downstream command.

Namun consumer tidak boleh menganggap event sebagai perintah implisit kecuali contract memang menyatakan itu.

---

### 3.6 Domain Event vs Integration Event

Ini sangat penting.

#### Domain Event

Domain event adalah event yang lahir dari model domain internal.

Ciri:

- dekat dengan aggregate/entity internal,
- bisa lebih detail,
- bisa berubah lebih sering,
- biasanya tidak langsung dipublikasikan ke semua service eksternal,
- berguna untuk modular monolith atau internal service module.

Contoh:

```text
ApplicationStatusTransitioned
- aggregateId
- fromStatus
- toStatus
- transitionRuleId
- actor
- timestamp
```

#### Integration Event

Integration event adalah event yang dipublikasikan sebagai contract antar bounded context/service.

Ciri:

- stabil,
- versioned,
- consumer-oriented,
- tidak expose struktur internal berlebihan,
- punya compatibility policy,
- sering disimpan di outbox,
- harus aman untuk replay.

Contoh:

```text
ApplicationApprovedV1
- eventId
- applicationId
- agencyCode
- applicantPublicId
- approvedAt
- decisionReference
- schemaVersion
```

**Rule:** jangan expose domain event internal secara mentah sebagai integration event publik.

---

## 4. JMS Mapping: Queue atau Topic?

### 4.1 Command biasanya queue

Command punya satu logical owner. Karena itu queue cocok.

```text
[Application Service]
      |
      | ApproveApplicationCommand
      v
[Queue: application.command.approve]
      |
      v
[Application Command Consumer]
```

Walaupun ada banyak consumer instance, mereka adalah competing consumers dari service yang sama.

```text
Queue: application.command.approve
    -> app-service-instance-1
    -> app-service-instance-2
    -> app-service-instance-3
```

Satu message diproses oleh satu instance.

### 4.2 Event biasanya topic

Event boleh punya banyak observer.

```text
[Application Service]
      |
      | ApplicationApprovedV1
      v
[Topic: application.events]
      |             |              |
      v             v              v
[Notification] [Compliance] [Audit Projection]
```

Setiap subscriber logical mendapat event tersebut.

### 4.3 Tapi tidak semua event harus public topic

Kadang event hanya internal service.

Misalnya:

```text
ApplicationSubmitted internal domain event
  -> create default checklist
  -> update internal timeline
  -> evaluate simple internal rule
```

Ini bisa dilakukan di proses yang sama atau internal module event, tidak perlu JMS.

Gunakan JMS ketika ada alasan distribusi nyata:

- service berbeda,
- runtime berbeda,
- scaling berbeda,
- failure isolation,
- asynchronous handoff,
- buffering,
- cross-team contract.

---

## 5. Anti-Pattern: Semua Interaksi Dijadikan Event

Banyak tim jatuh ke pattern seperti ini:

```text
Service A publishes SomethingHappened
Service B guesses it should do X
Service C guesses it should do Y
Service D guesses it should call A back
Service E waits for event from C
```

Awalnya terlihat decoupled. Lama-lama menjadi:

- flow bisnis sulit dibaca,
- dependency tersembunyi,
- debugging sulit,
- urutan event sulit dijamin,
- consumer bertambah tanpa governance,
- perubahan satu event merusak banyak service,
- tidak ada owner dari proses end-to-end.

Decoupling transport bukan berarti decoupling semantic.

Jika event menyebabkan consumer wajib melakukan sesuatu agar business process valid, maka kamu sebenarnya punya workflow dependency.

---

## 6. Command vs Event: Decision Framework

Gunakan pertanyaan berikut.

### 6.1 Apakah pengirim mengharapkan aksi tertentu?

Jika ya, itu command.

```text
GenerateInvoiceCommand
SendEmailCommand
StartScreeningCommand
ReserveInventoryCommand
```

### 6.2 Apakah pengirim hanya menyatakan fakta yang sudah terjadi?

Jika ya, itu event.

```text
InvoiceGenerated
EmailSent
ScreeningCompleted
InventoryReserved
```

### 6.3 Apakah message boleh gagal divalidasi oleh penerima?

Command bisa ditolak.

Event tidak “ditolak”; consumer boleh gagal memproses reaction-nya, tetapi fakta event tetap benar.

### 6.4 Apakah message punya satu owner?

Command: ya.

Event: tidak harus.

### 6.5 Apakah message perlu response?

Command mungkin perlu status/result.

Event biasanya tidak.

Jika event perlu response dari banyak consumer agar proses lanjut, kamu mungkin butuh saga/process manager.

---

## 7. Microservice JMS Topology Dasar

### 7.1 Command channel per capability

```text
application.command.submit
application.command.approve
application.command.reject
compliance.command.start-screening
notification.command.send
```

Kelebihan:

- ownership jelas,
- scaling per command type,
- DLQ lebih mudah ditangani,
- permission lebih granular,
- monitoring lebih eksplisit.

Kekurangan:

- banyak destination,
- governance naming diperlukan,
- admin overhead.

### 7.2 Single command queue per service

```text
application.commands
compliance.commands
notification.commands
```

Message type dibedakan lewat property/header:

```text
messageType = ApproveApplicationCommand
```

Kelebihan:

- destination lebih sedikit,
- consumer dispatch internal fleksibel,
- operational setup sederhana.

Kekurangan:

- poison message satu type bisa mengganggu type lain,
- scaling per command type lebih sulit,
- selector bisa disalahgunakan,
- DLQ triage lebih campur.

### 7.3 Event topic per domain/bounded context

```text
application.events
compliance.events
payment.events
identity.events
```

Kelebihan:

- domain-oriented,
- consumer bisa subscribe ke domain event stream,
- lebih stabil daripada topic per event kecil.

Kekurangan:

- selector/filtering dibutuhkan,
- high-volume event bisa mengganggu low-volume event,
- perlu governance event type.

### 7.4 Event topic per event category

```text
application.lifecycle.events
application.decision.events
application.document.events
```

Kelebihan:

- lebih granular,
- subscriber tidak menerima terlalu banyak noise,
- operational isolation lebih baik.

Kekurangan:

- destination banyak,
- perubahan taxonomy bisa menyakitkan.

---

## 8. Naming Convention

Naming bukan cosmetic. Naming menentukan operability.

### 8.1 Destination naming

Gunakan format konsisten:

```text
<domain>.<kind>.<purpose>
```

Contoh:

```text
application.command.submit
application.command.approve
application.events.lifecycle
compliance.command.start-screening
compliance.events.screening
notification.command.send-email
```

Atau:

```text
q.application.submit-command
q.application.approve-command
t.application.events
```

Yang penting konsisten.

### 8.2 Message type naming

Gunakan nama semantic:

```text
ApproveApplicationCommand
ApplicationApprovedV1
ScreeningStartedV1
ScreeningCompletedV1
EmailDeliveryRequested
EmailDelivered
```

Hindari nama teknis:

```text
ApplicationMessage
CommonEvent
SyncData
ProcessRequest
StatusUpdate
```

Nama teknis membuat consumer harus membaca payload untuk memahami intent.

---

## 9. Envelope Standard untuk Microservices

Untuk sistem besar, payload business saja tidak cukup.

Gunakan envelope:

```json
{
  "messageId": "01JMS...",
  "messageType": "ApplicationApprovedV1",
  "schemaVersion": 1,
  "occurredAt": "2026-06-18T10:15:30Z",
  "publishedAt": "2026-06-18T10:15:31Z",
  "producer": "application-service",
  "tenantId": "CEA",
  "correlationId": "corr-123",
  "causationId": "cmd-456",
  "idempotencyKey": "ApplicationApproved:APP-1001:v7",
  "aggregateType": "Application",
  "aggregateId": "APP-1001",
  "aggregateVersion": 7,
  "traceId": "...",
  "payload": {
    "applicationId": "APP-1001",
    "approvedBy": "user-123",
    "approvedAt": "2026-06-18T10:15:30Z"
  }
}
```

### 9.1 Header vs payload

Gunakan JMS header/properties untuk routing/filtering/observability ringan:

```text
JMSType = ApplicationApprovedV1
JMSCorrelationID = corr-123
property messageType = ApplicationApprovedV1
property tenantId = CEA
property aggregateType = Application
property aggregateId = APP-1001
property schemaVersion = 1
```

Gunakan body untuk business payload.

Jangan bergantung pada selector untuk field yang hanya ada di body, karena JMS selector bekerja pada header/properties, bukan body.

---

## 10. Correlation, Causation, dan Trace

### 10.1 Correlation ID

Correlation ID menghubungkan satu business journey.

Contoh:

```text
Submit application request
  correlationId = C-100

ApplicationSubmittedV1
  correlationId = C-100

StartScreeningCommand
  correlationId = C-100

ScreeningCompletedV1
  correlationId = C-100
```

Correlation ID berguna untuk:

- log search,
- trace reconstruction,
- incident timeline,
- support debugging,
- audit.

### 10.2 Causation ID

Causation ID menjawab:

> message ini terjadi karena message apa?

Contoh:

```text
commandId: CMD-1 SubmitApplicationCommand
  -> eventId: EVT-2 ApplicationSubmittedV1
       causationId = CMD-1
  -> commandId: CMD-3 StartScreeningCommand
       causationId = EVT-2
  -> eventId: EVT-4 ScreeningStartedV1
       causationId = CMD-3
```

Correlation adalah journey. Causation adalah parent-child edge.

### 10.3 Trace ID

Trace ID untuk observability teknis, biasanya OpenTelemetry.

Trace ID bisa sama dengan correlation ID, tetapi tidak harus. Business correlation sering hidup lebih lama daripada distributed trace.

---

## 11. Outbox Pattern dalam Microservices JMS

### 11.1 Problem DB + JMS

Misalnya service melakukan:

1. update database,
2. publish JMS event.

Failure window:

```text
DB commit success
JMS publish failed
```

Akibat: state berubah tapi event tidak keluar.

Atau:

```text
JMS publish success
DB commit failed
```

Akibat: event keluar untuk fakta yang tidak pernah committed.

### 11.2 Outbox solution

Dalam satu DB transaction:

1. update aggregate,
2. insert outbox row.

```sql
BEGIN;

UPDATE application
SET status = 'APPROVED', version = version + 1
WHERE id = 'APP-1001' AND version = 6;

INSERT INTO outbox_message (
  id,
  aggregate_type,
  aggregate_id,
  aggregate_version,
  message_type,
  payload,
  status,
  created_at
) VALUES (...);

COMMIT;
```

Lalu relay worker publish ke JMS:

```text
Outbox table -> relay -> JMS topic/queue
```

### 11.3 Outbox invariant

Jika database state committed, outbox message juga committed.

Publish ke broker bisa retry sampai sukses.

### 11.4 Outbox bukan exactly-once

Outbox bisa duplicate publish jika relay crash setelah publish sebelum mark sent.

Karena itu consumer tetap harus idempotent.

```text
Relay publishes event
Relay crashes before marking SENT
Relay restarts
Relay publishes same event again
```

Consumer harus pakai `messageId` atau business idempotency key.

---

## 12. Inbox Pattern dalam Microservices JMS

### 12.1 Problem duplicate delivery

JMS delivery yang reliable umumnya harus diasumsikan at-least-once.

Consumer bisa menerima message yang sama lebih dari sekali karena:

- rollback,
- crash sebelum ack,
- broker failover,
- relay duplicate,
- manual replay,
- DLQ repair.

### 12.2 Inbox solution

Consumer menyimpan processed message ID.

```sql
CREATE TABLE inbox_message (
  message_id VARCHAR(100) PRIMARY KEY,
  message_type VARCHAR(100) NOT NULL,
  consumed_at TIMESTAMP NOT NULL,
  status VARCHAR(30) NOT NULL
);
```

Processing:

```text
BEGIN
  INSERT INTO inbox_message(message_id, ...) VALUES (...)
  -- if duplicate key: skip safely

  apply business change
COMMIT
ACK message
```

### 12.3 Inbox plus business constraint

Dedup teknis belum cukup. Gunakan juga business invariant.

Contoh:

```sql
UPDATE screening
SET status = 'COMPLETED', completed_at = ?
WHERE screening_id = ?
  AND status IN ('STARTED', 'RUNNING');
```

Jika message duplicate setelah completed, update tidak melakukan perubahan.

---

## 13. Command Handler Design

### 13.1 Command handler harus punya bentuk stabil

Pseudo-flow:

```text
receive command
validate envelope
start transaction
check inbox/idempotency
load aggregate
check expected version / business precondition
apply state transition
write outbox events
commit transaction
ack message
```

### 13.2 Java-style skeleton

```java
public final class ApproveApplicationCommandHandler {

    private final ApplicationRepository applications;
    private final InboxRepository inbox;
    private final OutboxRepository outbox;

    public void handle(MessageEnvelope<ApproveApplicationCommand> envelope) {
        Transaction.run(() -> {
            if (!inbox.tryStart(envelope.messageId())) {
                return;
            }

            Application app = applications.getForUpdate(envelope.payload().applicationId());

            app.approve(
                envelope.payload().approvedBy(),
                envelope.payload().decisionReason(),
                envelope.payload().expectedVersion()
            );

            applications.save(app);

            outbox.add(ApplicationApprovedV1.from(app, envelope));

            inbox.markProcessed(envelope.messageId());
        });
    }
}
```

### 13.3 Jangan ack sebelum transaction commit

Buruk:

```text
ACK message
DB update
```

Jika DB update gagal setelah ACK, command hilang.

Lebih aman:

```text
DB transaction commit
ACK message
```

Jika crash setelah commit sebelum ACK, message bisa duplicate, tapi idempotency/inbox melindungi.

---

## 14. Event Handler Design

Event handler berbeda dari command handler.

Command handler memutuskan apakah aksi boleh dilakukan.

Event handler bereaksi terhadap fakta yang sudah terjadi.

### 14.1 Event handler untuk projection

```text
ApplicationApprovedV1
  -> update reporting read model
```

Handler harus replay-safe:

```sql
MERGE INTO application_report r
USING (...) e
ON (r.application_id = e.application_id)
WHEN MATCHED THEN UPDATE ...
WHEN NOT MATCHED THEN INSERT ...
```

### 14.2 Event handler untuk downstream command

```text
ApplicationSubmittedV1
  -> StartScreeningCommand
```

Jangan langsung lakukan remote side effect tanpa idempotency/outbox.

Lebih aman:

```text
consume event
write local saga/process state
write outbox command StartScreeningCommand
commit
relay command
ack event
```

---

## 15. Saga: Kenapa Dibutuhkan?

Dalam microservices, setiap service punya database sendiri. Satu business process bisa melibatkan banyak service.

Contoh:

```text
Submit Application
  -> validate applicant
  -> collect fee
  -> start screening
  -> assign officer
  -> generate acknowledgement
  -> notify applicant
```

Tidak ideal memakai distributed transaction besar di semua service.

Saga memecah proses menjadi serangkaian local transaction.

Jika satu step gagal, sistem melakukan compensation atau masuk state failure yang bisa ditangani.

---

## 16. Saga Choreography

Choreography berarti setiap service bereaksi terhadap event dari service lain.

```text
ApplicationSubmitted
      |
      +--> Payment Service reserves/collects fee
      |        emits PaymentCollected
      |
      +--> Screening Service starts screening
      |        emits ScreeningCompleted
      |
      +--> Notification Service sends notification
               emits NotificationSent
```

### 16.1 Kelebihan choreography

- tidak ada central coordinator,
- natural event-driven,
- service autonomy tinggi,
- cocok untuk flow sederhana,
- publisher tidak perlu tahu semua consumer.

### 16.2 Kekurangan choreography

- proses end-to-end tersebar,
- sulit tahu “saga sedang di step mana”,
- debugging sulit,
- dependency implicit,
- compensation tersebar,
- event storm,
- consumer coupling terhadap event lain.

### 16.3 Kapan choreography cocok

Cocok jika:

- flow sederhana,
- step sedikit,
- failure tidak kompleks,
- tidak butuh human visibility detail,
- setiap reaction independent,
- tidak perlu central process state.

Contoh sehat:

```text
ApplicationApprovedV1
  -> Notification sends email
  -> Reporting updates projection
  -> Audit writes audit record
```

Ini bukan saga kompleks. Ini event fan-out.

---

## 17. Saga Orchestration

Orchestration berarti ada coordinator/process manager yang mengarahkan step.

```text
[Application Saga Orchestrator]
   -> StartPaymentCommand
   <- PaymentCollected
   -> StartScreeningCommand
   <- ScreeningCompleted
   -> AssignOfficerCommand
   <- OfficerAssigned
   -> CompleteApplicationSubmissionCommand
```

### 17.1 Kelebihan orchestration

- proses terlihat jelas,
- state saga eksplisit,
- timeout mudah,
- compensation lebih terpusat,
- audit lebih mudah,
- debugging lebih baik,
- cocok untuk regulatory workflow.

### 17.2 Kekurangan orchestration

- coordinator menjadi komponen penting,
- risiko god orchestrator,
- perlu desain state machine yang baik,
- bisa mengurangi autonomy jika terlalu imperative,
- butuh durable process state.

### 17.3 Kapan orchestration cocok

Cocok jika:

- proses panjang,
- banyak step,
- ada timeout/SLA,
- ada human intervention,
- ada compensation formal,
- perlu audit trail,
- perlu visibility end-to-end,
- ada regulatory defensibility.

Untuk sistem case management/regulatory, orchestration sering lebih defensible daripada choreography murni.

---

## 18. JMS untuk Saga Orchestration

JMS bisa menjadi command/event transport untuk orchestrator.

```text
[Saga DB]
    ^
    |
[Saga Orchestrator]
    |
    +--> Queue: payment.command.collect
    +--> Queue: screening.command.start
    +--> Queue: officer.command.assign

Other services emit events:
    payment.events
    screening.events
    officer.events
```

Orchestrator:

1. menyimpan saga instance,
2. mengirim command via outbox,
3. menunggu event reply/status,
4. melakukan transition,
5. mengirim command berikutnya,
6. menangani timeout/compensation.

---

## 19. Saga State Machine

Saga harus dipandang sebagai state machine.

Contoh:

```text
SUBMITTED
  -> PAYMENT_REQUESTED
  -> PAYMENT_COLLECTED
  -> SCREENING_REQUESTED
  -> SCREENING_COMPLETED
  -> OFFICER_ASSIGNMENT_REQUESTED
  -> OFFICER_ASSIGNED
  -> COMPLETED
```

Failure state:

```text
PAYMENT_FAILED
SCREENING_FAILED
ASSIGNMENT_FAILED
COMPENSATION_REQUIRED
MANUAL_REVIEW_REQUIRED
CANCELLED
```

### 19.1 Saga table

```sql
CREATE TABLE application_submission_saga (
  saga_id VARCHAR(100) PRIMARY KEY,
  application_id VARCHAR(100) NOT NULL,
  state VARCHAR(50) NOT NULL,
  version BIGINT NOT NULL,
  correlation_id VARCHAR(100) NOT NULL,
  last_event_id VARCHAR(100),
  deadline_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

### 19.2 Transition with optimistic locking

```sql
UPDATE application_submission_saga
SET state = ?, version = version + 1, updated_at = ?
WHERE saga_id = ?
  AND state = ?
  AND version = ?;
```

Jika update count 0, berarti duplicate/stale/concurrent event.

---

## 20. Choreography vs Orchestration: Decision Table

| Aspek | Choreography | Orchestration |
|---|---|---|
| Flow visibility | rendah-menengah | tinggi |
| Coupling | implicit via events | explicit via orchestrator contract |
| Debugging | lebih sulit | lebih mudah |
| Autonomy service | tinggi | menengah-tinggi jika contract baik |
| Compensation | tersebar | terpusat/terstruktur |
| Cocok untuk | event fan-out sederhana | workflow bisnis kompleks |
| Risiko | event spaghetti | god orchestrator |
| Regulatory audit | sulit jika murni tersebar | lebih kuat |

---

## 21. Command/Event Flow Example: Application Submission

### 21.1 Flow

```text
User submits application
        |
        v
Application Service DB commit:
  - application status = SUBMITTED
  - outbox ApplicationSubmittedV1
        |
        v
JMS Topic: application.events
        |
        v
Application Submission Saga consumes event
        |
        v
Saga DB commit:
  - saga state = PAYMENT_REQUESTED
  - outbox CollectPaymentCommand
        |
        v
JMS Queue: payment.command.collect
        |
        v
Payment Service processes command
        |
        v
Payment Service DB commit:
  - payment status = COLLECTED
  - outbox PaymentCollectedV1
        |
        v
JMS Topic: payment.events
        |
        v
Saga consumes PaymentCollectedV1
        |
        v
Saga sends StartScreeningCommand
```

### 21.2 Why this is robust

- Application state and event creation are atomic via outbox.
- Saga state and next command are atomic via outbox.
- Each service owns its local transaction.
- Duplicate events are tolerated by inbox/idempotency.
- Saga state is explicit.
- Replay can be governed.

---

## 22. Eventual Consistency

Microservices + JMS usually means eventual consistency.

That means:

- Service A commits now.
- Service B sees effect later.
- UI/read model may lag.
- Business process may be pending.

Eventual consistency is not an excuse for vague behavior. It must be designed.

### 22.1 User-facing states

Instead of pretending everything is instant, expose truthful states:

```text
SUBMITTED
PAYMENT_PENDING
SCREENING_PENDING
SCREENING_COMPLETED
OFFICER_ASSIGNMENT_PENDING
READY_FOR_REVIEW
```

Bad UI:

```text
Submitted successfully
```

when actually multiple mandatory downstream steps may fail.

Better UI:

```text
Application submitted. Screening and payment verification are in progress.
```

### 22.2 SLA and timeout

Every async step needs timeout policy.

```text
Payment must complete within 15 minutes.
Screening must complete within 2 hours.
Officer assignment must complete within 1 business day.
```

Timeouts are part of domain, not just infrastructure.

---

## 23. Compensation

Compensation is not rollback.

Rollback undoes an uncommitted transaction.

Compensation is a new business action that semantically offsets a committed action.

Example:

```text
Payment collected
Screening failed permanently
```

You cannot rollback payment database transaction from the past. You issue:

```text
RefundPaymentCommand
```

Then payment emits:

```text
PaymentRefundedV1
```

### 23.1 Compensation must be designed early

For every saga step, ask:

| Step | Can fail? | Can compensate? | Manual intervention? |
|---|---:|---:|---:|
| collect payment | yes | refund | yes |
| start screening | yes | cancel screening | maybe |
| assign officer | yes | unassign | yes |
| send notification | yes | resend/suppress | yes |

---

## 24. State Machine + JMS: Strong Combination

JMS gives asynchronous transport.

State machine gives valid transitions.

Together:

```text
message arrives
  -> identify aggregate/saga
  -> check current state
  -> validate transition
  -> apply transition
  -> emit next message
```

Without state machine, async systems degrade into handler spaghetti.

### 24.1 Example transition guard

```java
public void onPaymentCollected(PaymentCollected event) {
    if (state != SagaState.PAYMENT_REQUESTED) {
        throw new StaleOrUnexpectedEventException(state, event.eventId());
    }

    state = SagaState.SCREENING_REQUESTED;
    outbox.add(StartScreeningCommand.from(this, event));
}
```

In production, unexpected event should not always crash to DLQ. It may be:

- duplicate,
- late event,
- already compensated,
- stale event,
- valid event in wrong order.

Classification matters.

---

## 25. Handling Late, Duplicate, and Out-of-Order Events

### 25.1 Late event

Example:

```text
Saga timed out payment
Refund initiated
PaymentCollected event arrives late
```

Do not blindly advance to next state.

Use state-aware handler:

```text
if state == PAYMENT_REQUESTED:
    move to PAYMENT_COLLECTED
elif state == PAYMENT_TIMEOUT:
    move to PAYMENT_LATE_COMPLETION_REQUIRES_REFUND
elif state == CANCELLED:
    record late event and maybe compensate
else:
    ignore or audit
```

### 25.2 Duplicate event

Use inbox + business state guard.

```text
PaymentCollected processed once.
Duplicate PaymentCollected arrives.
Saga state already SCREENING_REQUESTED.
```

Should not emit duplicate `StartScreeningCommand`.

### 25.3 Out-of-order event

Example:

```text
ScreeningCompleted arrives before ScreeningStarted due to different routes.
```

Options:

1. reject to retry,
2. park temporarily,
3. accept if transition is semantically valid,
4. detect impossible sequence and send to manual review.

Do not assume broker ordering across independent destinations.

---

## 26. Avoiding Distributed Monolith

A distributed monolith happens when services are separately deployed but semantically inseparable.

Signs:

- every service must be up for any business action,
- one event contract change requires many deployments,
- services call each other in long synchronous chains,
- shared database,
- no independent failure recovery,
- no local autonomy,
- JMS queues mirror method names too closely,
- service cannot process message without querying many other services.

### 26.1 JMS-specific distributed monolith smell

```text
Service A sends CommandToB
B sends CommandToC
C sends CommandToD
D replies to C
C replies to B
B replies to A
A waits synchronously
```

This is RPC chain with broker overhead.

If the user request is blocked waiting for the whole chain, JMS is not providing real decoupling.

---

## 27. Data Ownership Rules

### 27.1 Service owns writes to its data

Only owning service writes its tables.

If Application Service needs Compliance result, it should not read Compliance DB directly.

It can:

- consume `ScreeningCompletedV1`,
- maintain local projection,
- call Compliance API for query if needed,
- ask via command/request if action required.

### 27.2 Events are not table replication by default

Do not publish every row change as integration event unless CDC/data platform is the actual use case.

Business events are semantic:

```text
ApplicationApproved
PaymentCollected
ScreeningFailed
OfficerAssigned
```

Table changes are technical:

```text
APPLICATION row updated
PAYMENT_STATUS column changed
```

Semantic events age better.

---

## 28. Read Models and Projections

JMS events can feed read models.

Example:

```text
Application Service emits ApplicationSubmitted/Approved/Rejected
Compliance Service emits ScreeningCompleted
Payment Service emits PaymentCollected

Case Dashboard Projection consumes all and builds dashboard view.
```

Projection service owns its own database.

### 28.1 Projection invariant

Projection must be rebuildable.

If possible:

- store last processed event ID,
- store source aggregate version,
- allow replay from durable event store/log if available,
- if JMS topic has no long retention, keep event archive/outbox table.

JMS broker itself should not be treated as permanent event store unless provider/config explicitly supports retention/replay semantics you operate correctly.

---

## 29. JMS vs Event Sourcing

Do not confuse event-driven messaging with event sourcing.

### 29.1 Event-driven messaging

State is stored normally. Events notify other parts.

```text
Application table is source of truth.
ApplicationApprovedV1 informs consumers.
```

### 29.2 Event sourcing

Events are source of truth. State is reconstructed from event stream.

```text
ApplicationSubmitted
ApplicantUpdated
ApplicationApproved
ApplicationSuspended
```

Aggregate state is replayed from events.

### 29.3 JMS is not automatically event sourcing

JMS can transport events, but typical JMS brokers are not used like Kafka-style long-retention event logs.

If you need event sourcing, design:

- event store,
- stream ordering,
- snapshots,
- replay semantics,
- versioned aggregate events,
- projection rebuild.

JMS may still be used for integration event publication.

---

## 30. Microservice Message Contract

A production integration event contract should define:

1. message type,
2. owner service,
3. semantic meaning,
4. trigger condition,
5. delivery channel,
6. schema version,
7. compatibility rules,
8. idempotency key,
9. ordering expectation,
10. replay behavior,
11. retention expectation,
12. security classification,
13. PII fields,
14. consumer responsibility,
15. deprecation policy.

Example:

```yaml
messageType: ApplicationApprovedV1
owner: application-service
channel: topic/application.events
meaning: Application has passed approval decision and entered APPROVED state.
trigger: Application aggregate transition SUBMITTED -> APPROVED.
idempotencyKey: eventId
orderingKey: applicationId
schemaVersion: 1
compatibility: additive fields only for V1
pii: contains applicantPublicId, no full NRIC/passport
replaySafe: yes
consumers:
  - notification-service
  - reporting-projection
  - audit-service
```

---

## 31. Security and Multi-Tenant Considerations

In microservices, JMS destination is a security boundary.

### 31.1 Producer permissions

Only Application Service should publish to:

```text
application.events
```

Only orchestrator should send:

```text
payment.command.collect
screening.command.start
```

### 31.2 Consumer permissions

Notification Service may consume:

```text
application.events
payment.events
```

but should not consume:

```text
internal.audit.events
identity.sensitive.events
```

### 31.3 Tenant isolation

Options:

1. tenant property in message,
2. destination per tenant,
3. broker namespace/virtual host per tenant,
4. separate broker per high-isolation tenant.

Decision depends on:

- regulatory isolation,
- noisy neighbor risk,
- operational complexity,
- data sensitivity,
- tenant volume.

Never rely only on application-level filtering for high-sensitivity tenant isolation if broker-level ACL is required.

---

## 32. Observability for JMS Microservices

Minimum observability:

- enqueue rate,
- dequeue rate,
- queue depth,
- oldest message age,
- consumer count,
- redelivery count,
- DLQ count,
- handler success/failure count,
- processing latency,
- end-to-end latency,
- outbox pending count,
- outbox oldest pending age,
- inbox duplicate count,
- saga state distribution.

### 32.1 Dashboard example

```text
Application Saga Dashboard
- SUBMITTED: 120
- PAYMENT_REQUESTED: 35
- PAYMENT_TIMEOUT: 2
- SCREENING_REQUESTED: 87
- SCREENING_FAILED: 4
- MANUAL_REVIEW_REQUIRED: 3
- COMPLETED: 12,450
```

This is more useful than only broker queue depth.

### 32.2 Log fields

Every handler log should include:

```text
messageId
messageType
correlationId
causationId
aggregateId
aggregateVersion
sagaId
destination
consumerName
redeliveryCount
processingDurationMs
outcome
```

---

## 33. DLQ in Microservice Architecture

DLQ is not a trash bin. DLQ is an operational workflow.

For each DLQ, define:

- owner team,
- severity,
- alert threshold,
- triage steps,
- replay tool,
- repair process,
- data masking rules,
- approval flow for replay,
- audit log of replay action.

### 33.1 DLQ by destination

Better:

```text
DLQ.application.command.approve
DLQ.payment.command.collect
DLQ.screening.events
```

Worse:

```text
GLOBAL.DLQ
```

Global DLQ becomes operational swamp.

### 33.2 DLQ classification

| Classification | Example | Action |
|---|---|---|
| transient infrastructure | DB down | retry/replay |
| permanent validation | invalid payload | fix producer/data |
| poison business state | impossible transition | manual review |
| schema mismatch | unknown version | deploy compatibility fix |
| authorization | service not allowed | security/config fix |
| duplicate/stale | already processed | mark ignored/audited |

---

## 34. Consumer Scaling in Microservices

Scaling consumers is not only increasing concurrency.

Ask:

1. Is handler CPU-bound?
2. Is handler DB-bound?
3. Is downstream service-bound?
4. Is ordering required per aggregate?
5. Is prefetch too high?
6. Is one poison message blocking a group?
7. Is DLQ growing?
8. Is outbox relay slower than producer?

### 34.1 Command queue scaling

Command queue can scale with competing consumers if commands independent.

```text
payment.command.collect
  consumers = 10
```

But if all commands hit same account/application aggregate, DB lock contention may dominate.

### 34.2 Event subscriber scaling

Each logical subscriber should have its own durable subscription/queue.

```text
application.events
  -> notification.subscription
  -> reporting.subscription
  -> compliance.subscription
```

Scaling notification should not cause reporting to miss events.

---

## 35. Versioning Strategy

Never assume consumer upgrades together with producer.

### 35.1 Additive change

Safe:

```json
{
  "applicationId": "APP-1",
  "approvedAt": "...",
  "approvalChannel": "ONLINE"
}
```

if old consumers ignore unknown fields.

### 35.2 Breaking change

Breaking:

```text
rename applicationId -> appId
change approvedAt format
change semantic from approved to conditionally approved
remove field used by consumer
```

Use new message type:

```text
ApplicationApprovedV2
```

### 35.3 Semantic versioning for events

Version only schema is not enough. Version semantic meaning.

If `ApplicationApproved` used to mean “fully approved” but now means “preliminarily approved”, that is breaking even if JSON fields unchanged.

---

## 36. Testing JMS Microservice Flows

Test levels:

### 36.1 Handler unit test

Test pure business logic:

```text
given saga state PAYMENT_REQUESTED
when PaymentCollectedV1 received
then state SCREENING_REQUESTED
and StartScreeningCommand emitted
```

### 36.2 Integration test with broker

Test:

- message serialization,
- destination config,
- ack/rollback,
- listener container,
- transaction boundary,
- DLQ behavior.

### 36.3 Contract test

Producer and consumer agree on:

- message type,
- required fields,
- optional fields,
- version,
- header/properties,
- example payload.

### 36.4 End-to-end saga test

Test happy path and failure path:

```text
submit application
payment collected
screening failed
refund command emitted
saga state COMPENSATION_REQUIRED
```

---

## 37. Design Review Checklist

### 37.1 Message intent

- Is this message a command or event?
- Is the name imperative or past-tense accordingly?
- Does it have one logical owner?
- Is queue/topic choice aligned with intent?

### 37.2 Ownership

- Which service owns the data changed by this message?
- Is any service writing another service's DB?
- Is any consumer depending on internal domain model of producer?

### 37.3 Consistency

- Is DB + JMS consistency handled?
- Is outbox used where needed?
- Is inbox/idempotency used by consumers?
- What happens if publish duplicate occurs?

### 37.4 Ordering

- Is ordering required?
- Is ordering per aggregate or global?
- What is the ordering key?
- Can concurrent consumers violate invariant?

### 37.5 Saga

- Is this simple fan-out or actual saga?
- If saga, where is saga state stored?
- Is choreography still understandable?
- Is orchestration more appropriate?
- Are timeouts and compensation defined?

### 37.6 Failure

- What errors go to retry?
- What errors go to DLQ?
- What errors go to manual review?
- Is replay safe?
- Is DLQ owner defined?

### 37.7 Observability

- Can we trace end-to-end by correlation ID?
- Can we find message age?
- Can we see saga state distribution?
- Can we reconstruct incident timeline?

### 37.8 Security

- Who can publish?
- Who can consume?
- Are PII fields minimized?
- Is tenant isolation sufficient?
- Are replay tools protected?

---

## 38. Common Anti-Patterns

### 38.1 Event as command

Bad:

```text
UserRegistered event means Notification Service must send welcome email.
```

Better:

- If it is optional reaction: event is fine.
- If it is required step: use saga/process manager to send `SendWelcomeEmailCommand`.

### 38.2 Command broadcast

Bad:

```text
Topic: DoCustomerOnboarding
```

A command should not be broadcast unless every consumer is explicitly meant to perform the command, which is rare and dangerous.

### 38.3 Shared integration event equals internal entity dump

Bad:

```json
{
  "applicationEntity": {
    "allInternalFields": "..."
  }
}
```

Better:

```json
{
  "applicationId": "APP-1",
  "status": "APPROVED",
  "approvedAt": "...",
  "decisionReference": "..."
}
```

### 38.4 Synchronous waiting on async chain

Bad:

```text
HTTP request waits for JMS command to B, B to C, C to D, then response.
```

If user must wait synchronously, consider HTTP/gRPC direct call with clear timeout, or redesign as submitted/pending workflow.

### 38.5 No explicit saga state

Bad:

```text
State inferred from scattered events in many services.
```

Better:

```text
Saga/process state table with explicit current state and history.
```

### 38.6 Retry without idempotency

Bad:

```text
Redelivery retries payment charge.
```

Better:

```text
Payment command has idempotency key and payment provider idempotency reference.
```

---

## 39. Practical Reference Architecture

```text
                  +---------------------+
                  |   API / Web Layer   |
                  +----------+----------+
                             |
                             v
                  +---------------------+
                  | Application Service |
                  | DB + Outbox         |
                  +----------+----------+
                             |
                             v
                    Topic: application.events
                             |
              +--------------+---------------+
              |                              |
              v                              v
+-----------------------------+     +----------------------+
| Application Saga Orchestrator|     | Reporting Projection |
| Saga DB + Inbox + Outbox     |     | Inbox + Read DB      |
+--------------+--------------+     +----------------------+
               |
               +--> Queue: payment.command.collect
               |
               +--> Queue: screening.command.start
               |
               +--> Queue: notification.command.send

Payment Service emits payment.events
Screening Service emits screening.events
Notification Service emits notification.events

Saga consumes those events and advances process state.
```

### 39.1 Why this architecture works

- Domain service owns domain state.
- Saga owns process coordination state.
- Downstream services own their capability.
- JMS decouples runtime timing.
- Outbox protects publish consistency.
- Inbox protects duplicate delivery.
- Events document facts.
- Commands request actions.
- DLQ and replay are explicit operations.

---

## 40. Java 8 vs Java 17/21/25 Considerations

### 40.1 Java 8

- Legacy `javax.jms` common.
- Use explicit try/finally for resources.
- Be careful with old app servers and provider clients.
- Limited language expressiveness.
- Thread-per-consumer model common.

### 40.2 Java 11/17

- Better TLS/runtime defaults.
- More mature container deployment patterns.
- Records not in Java 11, available from Java 16.
- Java 17 commonly used for Spring Boot 3/Jakarta-aligned stacks.

### 40.3 Java 21/25

- Virtual threads can help blocking handler workloads, but JMS provider/listener container compatibility must be verified.
- Modern structured concurrency ideas can improve internal orchestration code, but broker/client callbacks still need careful lifecycle management.
- Records/sealed classes are useful for message model representation.
- Pattern matching can make message dispatch clearer.

Important: do not assume virtual threads magically increase broker throughput. The limiting factor may be broker I/O, DB locks, downstream latency, transaction contention, or ordering constraints.

---

## 41. Mini Case Study: Regulatory Case Management

Imagine a regulatory platform:

- Application Management,
- Compliance Screening,
- Case Assignment,
- Correspondence,
- Audit Trail,
- Notification,
- Reporting.

A user submits an application.

Bad design:

```text
Application Service synchronously calls Screening, Assignment, Notification, Audit, Reporting.
```

Problems:

- one slow service blocks submission,
- retry semantics unclear,
- partial failure unclear,
- user waits too long,
- no durable process state,
- hard to audit.

Better design:

```text
Application Service commits SUBMITTED + outbox ApplicationSubmittedV1.
Saga starts required workflow.
Screening, Assignment, Notification receive commands.
Each service emits facts.
Saga state tracks progress.
Audit consumes all integration events.
Reporting projection updates eventually.
```

User sees:

```text
Application submitted. Background verification is in progress.
```

Officer sees process state:

```text
Payment: Completed
Screening: Pending
Assignment: Not Started
Notification: Sent
```

This is defensible because state, responsibility, and failure handling are explicit.

---

## 42. Key Invariants

Memorize these:

1. A command asks; an event states.
2. A command has an owner; an event may have observers.
3. Queue distributes work; topic distributes facts.
4. Domain event is not automatically integration event.
5. DB state change + event publication needs outbox or equivalent consistency strategy.
6. Every consumer must assume duplicate delivery.
7. Idempotency is a business design, not only a technical cache.
8. Saga is a state machine, not a random chain of messages.
9. Choreography hides process state unless carefully governed.
10. Orchestration centralizes visibility but can become god object.
11. DLQ requires ownership and workflow.
12. Replay must be safe by design.
13. JMS broker is not automatically an event store.
14. Asynchronous does not mean unobservable.
15. Loose coupling at transport level can still be tight coupling at semantic level.

---

## 43. Practice Exercises

### Exercise 1 — Classify messages

Classify these as command, domain event, integration event, or document message:

1. `ApproveApplication`
2. `ApplicationApproved`
3. `ApplicationApprovalSnapshotExported`
4. `SendApprovalEmail`
5. `OfficerAssigned`
6. `UpdateApplicationStatus`
7. `PaymentCollectedV1`
8. `ApplicationRowChanged`

For each, decide queue/topic and owner.

### Exercise 2 — Design saga

Design JMS flow for:

```text
Application submitted
Payment required
Screening required
Officer assignment required
Notification required
If screening fails, refund payment and send rejection notification
```

Define:

- commands,
- events,
- queues,
- topics,
- saga states,
- compensation,
- DLQ handling.

### Exercise 3 — Failure window

Analyze:

```text
Consumer receives PaymentCollectedV1
Consumer updates saga state
Consumer sends StartScreeningCommand
Consumer crashes before ack
```

Answer:

- what can duplicate?
- what must be idempotent?
- where should outbox/inbox be used?
- what if `StartScreeningCommand` is sent twice?

### Exercise 4 — Choreography or orchestration?

For each case, choose choreography or orchestration:

1. update reporting projection after application approved;
2. send optional notification after payment received;
3. multi-step application submission with payment, screening, assignment, SLA timer;
4. create audit record for every domain event;
5. onboarding process with 12 steps and human approval.

Explain why.

---

## 44. Summary

JMS in microservices should be treated as a coordination mechanism with explicit semantics.

The hardest part is not calling `send()` or implementing `@JmsListener`. The hard part is designing:

- message intent,
- service ownership,
- data consistency,
- idempotency,
- saga state,
- failure recovery,
- observability,
- replay governance,
- security boundary.

If you design command/event semantics clearly, JMS can be a strong tool for reliable asynchronous enterprise workflows.

If you treat JMS as transparent RPC or random event broadcast, the system becomes harder to reason about than a monolith.

The top-level heuristic:

> Use JMS to decouple runtime timing and workload ownership, not to hide unclear domain boundaries.

---

## 45. Referensi

- Jakarta Messaging 3.1 Specification — Jakarta EE / Eclipse Foundation.
- Jakarta EE Tutorial — Messaging concepts.
- Microservices.io — Saga pattern, choreography vs orchestration, transactional outbox, event sourcing.
- Enterprise Integration Patterns — Event Message, Request-Reply, Command Message, Message Channel, Dead Letter Channel, Content-Based Router.
- Spring Framework Reference — JMS integration and listener containers.
- Apache ActiveMQ Artemis Documentation — JMS usage, address model, broker behavior.

---

# Status Seri

Selesai: Part 22 dari 35.  
Seri belum selesai.  
Part berikutnya: **Part 23 — Schema and Contract Engineering: Versioning, Compatibility, Envelope, Registry, dan Consumer Evolution**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-021.md">⬅️ Part 21 — JMS in Spring Framework / Spring Boot: `JmsTemplate`, Listener Container, Transaction, Error Handler</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-023.md">Part 23 — Schema and Contract Engineering: Versioning, Compatibility, Envelope, Registry, dan Consumer Evolution ➡️</a>
</div>
