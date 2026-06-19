# Part 21 — EventBridge and Scheduler for Java Engineers

> Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
> Target: Java 8–25, AWS SDK for Java 2.x, production-grade cloud integration  
> Fokus: Amazon EventBridge, EventBridge Scheduler, event routing, scheduled execution, archive/replay, schema governance, dan desain Java producer/consumer yang aman.

---

## 1. Posisi Part Ini dalam Seri

Sampai Part 20, kita sudah membangun fondasi besar:

- AWS SDK sebagai remote dependency layer.
- Identity/IAM sebagai security boundary.
- HTTP timeout/retry/backpressure sebagai transport boundary.
- S3 sebagai object boundary.
- SQS sebagai reliability buffer.
- SNS sebagai fan-out boundary.
- Lambda sebagai compute/event processor boundary.

Part ini masuk ke area yang sering disalahpahami: **EventBridge bukan sekadar “SNS versi lain” dan EventBridge Scheduler bukan sekadar “cron AWS”**.

EventBridge adalah **event router**. Ia menerima event dari berbagai source, mencocokkan event terhadap rule/pattern, lalu mengirim ke target. EventBridge lebih cocok dipikirkan sebagai **routing fabric** untuk event antar sistem, bukan sebagai queue, bukan sebagai workflow engine penuh, dan bukan sebagai database event sourcing.

EventBridge Scheduler adalah **managed scheduling control plane**. Ia membuat jadwal one-time atau recurring untuk memanggil target tertentu, dengan retry, flexible delivery window, dan delivery failure handling.

Mental model utama:

```text
SNS      = broadcast/fan-out topic
SQS      = durable pull-based queue / reliability buffer
EventBridge = event router with filtering, transformation, SaaS/AWS integration, archive/replay
Scheduler   = managed future invocation / recurring trigger system
Lambda      = compute target / event processor
Step Functions = workflow/state orchestration
```

Jika SNS menjawab “siapa saja subscriber topic ini?”, EventBridge menjawab “event ini cocok ke rule mana, lalu harus dikirim ke target apa?”.

---

## 2. EventBridge: Mental Model Dasar

EventBridge terdiri dari beberapa konsep besar:

1. **Event**  
   Payload terstruktur yang merepresentasikan sesuatu yang terjadi.

2. **Event bus**  
   Router yang menerima event dan mengirim ke target berdasarkan rule.

3. **Rule**  
   Matching logic berbasis event pattern atau schedule legacy.

4. **Target**  
   Resource tujuan: Lambda, SQS, SNS, Step Functions, API destination, Kinesis, Firehose, ECS task, dan lain-lain.

5. **Event pattern**  
   Deklarasi matching berbasis field event.

6. **Input transformer**  
   Mekanisme mengubah payload sebelum dikirim ke target.

7. **Archive/replay**  
   Fitur menyimpan event yang masuk ke bus dan mengirim ulang ke bus untuk recovery/testing/migration.

8. **Schema registry**  
   Katalog struktur event agar producer dan consumer tidak hanya berbagi JSON liar.

9. **Pipes**  
   Point-to-point integration dari source ke target dengan filtering, enrichment, dan transformasi.

10. **Scheduler**  
    Service terpisah untuk membuat one-time/recurring schedule yang memanggil target.

EventBridge event bus secara resmi diposisikan sebagai router yang menerima event dan mengirimkannya ke zero or more targets; cocok untuk routing dari banyak source ke banyak target, termasuk transformasi sebelum delivery.

---

## 3. Kenapa EventBridge Penting untuk Engineer Java Senior

Engineer biasa sering hanya tahu:

> “Publish event ke EventBridge, lalu Lambda jalan.”

Engineer senior/top-tier harus tahu:

- Apa perbedaan event routing dan queueing.
- Apa failure semantics-nya.
- Apa yang terjadi saat target gagal.
- Bagaimana event versioning dilakukan.
- Bagaimana consumer tetap idempotent.
- Bagaimana replay dilakukan tanpa merusak state.
- Bagaimana event pattern bisa menyebabkan event “hilang secara logis”.
- Bagaimana schema drift dikontrol.
- Bagaimana IAM resource policy/cross-account event bus bekerja.
- Bagaimana schedule harus diberi idempotency key.
- Bagaimana biaya/throttling mempengaruhi desain.

Dengan kata lain, EventBridge bukan hanya service integration. Ia adalah **arsitektur komunikasi antar bounded context**.

---

## 4. Kapan Memakai EventBridge, SNS, SQS, atau Step Functions?

### 4.1 EventBridge Cocok Ketika

Gunakan EventBridge ketika:

- Banyak source event perlu diroute ke banyak target.
- Filtering berbasis struktur event penting.
- Event berasal dari AWS services, SaaS partner, atau aplikasi internal.
- Ingin loosely-coupled integration antar domain.
- Ingin archive/replay event.
- Ingin target heterogen: Lambda, SQS, Step Functions, API destination, ECS, dsb.
- Ingin governance event melalui schema registry.
- Ingin central event bus per domain/platform.

Contoh:

```text
case.submitted
case.screening.completed
case.escalation.due
payment.received
document.uploaded
license.renewal.expiring
```

EventBridge bagus untuk event yang artinya:

> “Sesuatu sudah terjadi, siapa pun yang relevan boleh bereaksi.”

### 4.2 SNS Cocok Ketika

Gunakan SNS ketika:

- Perlu fan-out sederhana dari topic ke beberapa subscriber.
- Kombinasi SNS → SQS sudah cukup.
- Butuh low-latency pub/sub sederhana.
- Tidak perlu event bus governance yang kompleks.
- Filter policy sederhana cukup.

SNS lebih natural untuk:

```text
send notification to many downstream queues
broadcast state change to known subscribers
fan-out same payload to SQS queues
```

### 4.3 SQS Cocok Ketika

Gunakan SQS ketika:

- Consumer ingin pull-based processing.
- Perlu durable buffer.
- Perlu smoothing burst.
- Perlu retry dan DLQ per consumer.
- Perlu worker pool concurrency control.

SQS adalah reliability boundary, bukan semantic router.

### 4.4 Step Functions Cocok Ketika

Gunakan Step Functions ketika:

- Ada workflow multi-step yang harus terlihat state-nya.
- Ada branching, waiting, retry, compensation.
- Urutan langkah penting.
- Proses adalah orchestration, bukan sekadar event reaction.

Contoh:

```text
Submit case -> validate -> screen -> assign officer -> wait for response -> escalate -> close
```

Jika proses harus punya state machine eksplisit, EventBridge saja biasanya tidak cukup.

---

## 5. EventBridge Event Shape

EventBridge event umumnya memiliki envelope seperti:

```json
{
  "version": "0",
  "id": "6f5e6d2e-1c90-4cb3-8d11-8d3f0c10b111",
  "detail-type": "CaseSubmitted",
  "source": "com.example.case-management",
  "account": "123456789012",
  "time": "2026-06-19T10:15:30Z",
  "region": "ap-southeast-1",
  "resources": [],
  "detail": {
    "caseId": "CASE-2026-000001",
    "caseVersion": 3,
    "submittedBy": "user-123",
    "submittedAt": "2026-06-19T10:15:29Z"
  }
}
```

Field penting:

| Field | Fungsi |
|---|---|
| `source` | Namespace producer/domain. |
| `detail-type` | Jenis event. |
| `detail` | Payload domain. |
| `time` | Waktu event diterima/terjadi. |
| `id` | ID event envelope dari EventBridge. |
| `resources` | Referensi resource terkait, biasanya ARN. |
| `account` | AWS account asal. |
| `region` | Region asal. |

Untuk custom event dari Java, field yang paling penting untuk desain adalah:

```text
source + detail-type + detail.schemaVersion + detail.aggregateId + detail.eventId
```

Jangan hanya mengandalkan `id` EventBridge untuk idempotency domain. Gunakan **domain event ID** sendiri di dalam `detail`.

---

## 6. Event Naming Governance

Event name yang buruk:

```text
CaseEvent
UpdateEvent
NotificationEvent
DataChanged
ProcessEvent
```

Event name yang baik:

```text
CaseSubmitted
CaseScreeningRequested
CaseScreeningCompleted
CaseEscalationDue
DocumentVirusScanFailed
LicenseRenewalReminderDue
PaymentReceiptGenerated
```

Rule:

1. Event harus menyatakan sesuatu yang sudah terjadi atau due.
2. Hindari nama teknis yang tidak bermakna domain.
3. Jangan memakai event generic yang membutuhkan field `type` tambahan di dalam detail untuk semua hal.
4. Gunakan past tense untuk domain event:

```text
CaseSubmitted
DocumentUploaded
PaymentReceived
```

5. Gunakan due/trigger style untuk schedule-derived event:

```text
CaseEscalationDue
LicenseRenewalReminderDue
ReportGenerationRequested
```

Bedakan **event** dan **command**:

```text
Event   : CaseSubmitted        // fakta masa lalu
Command : ScreenCase           // instruksi untuk melakukan sesuatu
```

EventBridge bisa membawa keduanya secara teknis, tetapi desain harus jujur. Jangan menamai command sebagai event jika target wajib melakukan aksi tertentu.

---

## 7. Event Bus Design

### 7.1 Default Event Bus

Default bus menerima event dari AWS services dan bisa juga menerima custom event. Untuk sistem enterprise, default bus boleh digunakan, tetapi tidak selalu ideal sebagai central domain bus.

Risiko default bus:

- Terlalu campur antara AWS service events dan domain events.
- Governance sulit.
- Rule pattern mudah saling tumpang tindih.
- Sulit memisahkan ownership.

### 7.2 Custom Event Bus

Custom bus lebih baik untuk domain/platform boundary.

Contoh:

```text
case-management-bus-dev
case-management-bus-uat
case-management-bus-prod
compliance-bus-prod
notification-bus-prod
audit-bus-prod
```

Pattern:

```text
one bus per platform/domain boundary
not one bus per microservice by default
not one global bus for everything by default
```

### 7.3 Multi-Account Event Bus

Dalam enterprise, biasanya ada account separation:

```text
application account -> shared event account -> consumer account
```

Atau:

```text
producer account -> consumer account event bus
```

Cross-account EventBridge butuh:

- IAM permission producer untuk `events:PutEvents`.
- Resource policy pada event bus tujuan.
- Governance siapa boleh publish `source` apa.
- Observability lintas account.

Jangan biarkan semua account publish semua source ke central bus tanpa boundary.

---

## 8. Rule and Event Pattern Mental Model

Event pattern bukan kode imperative. Ia adalah declarative matcher.

Contoh rule:

```json
{
  "source": ["com.example.case-management"],
  "detail-type": ["CaseSubmitted"],
  "detail": {
    "agencyCode": ["CEA"],
    "priority": ["HIGH", "CRITICAL"]
  }
}
```

Artinya:

> Cocokkan event dari source `com.example.case-management`, jenis `CaseSubmitted`, untuk agency CEA, dengan priority HIGH atau CRITICAL.

Kesalahan umum:

1. Pattern terlalu luas:

```json
{
  "source": ["com.example.case-management"]
}
```

Target akan menerima terlalu banyak event.

2. Pattern terlalu sempit:

```json
{
  "detail": {
    "status": ["SUBMITTED"]
  }
}
```

Jika field berubah menjadi `caseStatus`, event tidak match. Secara fisik event masuk bus, tetapi secara logis “hilang” dari consumer.

3. Pattern bergantung pada field volatile.

Field volatile seperti display name, human-readable status, atau nested object yang sering berubah sebaiknya tidak menjadi routing contract.

4. Pattern mengandung business logic berat.

Jika rule pattern menjadi terlalu kompleks, pertimbangkan apakah routing decision seharusnya dilakukan oleh domain service atau event processor.

---

## 9. EventBridge PutEvents dari Java

AWS SDK for Java 2.x menyediakan `EventBridgeClient` untuk operasi seperti `putEvents`.

Contoh minimal:

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequest;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequestEntry;
import software.amazon.awssdk.services.eventbridge.model.PutEventsResponse;

public final class CaseEventPublisher implements AutoCloseable {

    private final EventBridgeClient eventBridge;
    private final String eventBusName;

    public CaseEventPublisher(String eventBusName) {
        this.eventBridge = EventBridgeClient.builder()
                .region(Region.AP_SOUTHEAST_1)
                .build();
        this.eventBusName = eventBusName;
    }

    public void publishCaseSubmitted(String caseId, long caseVersion) {
        String detailJson = """
                {
                  "eventId": "evt-123",
                  "schemaVersion": 1,
                  "caseId": "%s",
                  "caseVersion": %d
                }
                """.formatted(caseId, caseVersion);

        PutEventsRequestEntry entry = PutEventsRequestEntry.builder()
                .eventBusName(eventBusName)
                .source("com.example.case-management")
                .detailType("CaseSubmitted")
                .detail(detailJson)
                .build();

        PutEventsResponse response = eventBridge.putEvents(
                PutEventsRequest.builder()
                        .entries(entry)
                        .build()
        );

        if (response.failedEntryCount() != null && response.failedEntryCount() > 0) {
            throw new IllegalStateException("Failed to publish some EventBridge entries: " + response.entries());
        }
    }

    @Override
    public void close() {
        eventBridge.close();
    }
}
```

Catatan penting:

- Jangan membuat client per event.
- Jangan mengabaikan `failedEntryCount`.
- Jangan menganggap `putEvents` batch sukses semua hanya karena HTTP response sukses.
- Jangan membuat detail JSON manual di production; gunakan serializer terkontrol.
- Jangan memasukkan data sensitif ke event detail kecuali memang event bus, target, logging, archive, dan retention sudah didesain untuk itu.

---

## 10. PutEvents Partial Failure

`PutEvents` menerima batch entries. Response bisa berisi sukses sebagian dan gagal sebagian.

Model:

```text
HTTP 200
  entry[0] success
  entry[1] success
  entry[2] failed
  entry[3] success
```

Jika kode hanya melihat exception, maka partial failure bisa hilang.

Pattern aman:

```java
PutEventsResponse response = eventBridge.putEvents(request);

for (int i = 0; i < response.entries().size(); i++) {
    var result = response.entries().get(i);
    var original = request.entries().get(i);

    if (result.errorCode() != null) {
        // Persist failure, retry if safe, or raise application-level error.
        System.err.printf(
                "Failed event index=%d source=%s detailType=%s errorCode=%s errorMessage=%s%n",
                i,
                original.source(),
                original.detailType(),
                result.errorCode(),
                result.errorMessage()
        );
    }
}
```

Top-tier rule:

> Treat batch publish as a vector of independent outcomes, not as one boolean.

---

## 11. Domain Event Envelope di Dalam `detail`

EventBridge sudah punya envelope. Tetapi aplikasi tetap perlu domain envelope.

Contoh:

```json
{
  "eventId": "01JZ8W2X4S7X8B9C1D2E3F4G5H",
  "schemaVersion": 1,
  "eventName": "CaseSubmitted",
  "occurredAt": "2026-06-19T10:15:29Z",
  "producer": "case-service",
  "correlationId": "corr-abc-123",
  "causationId": "cmd-submit-case-999",
  "tenantId": "cea",
  "aggregateType": "Case",
  "aggregateId": "CASE-2026-000001",
  "aggregateVersion": 3,
  "payload": {
    "submittedBy": "user-123",
    "channel": "INTERNET"
  }
}
```

Kenapa perlu?

- `eventId` untuk idempotency.
- `schemaVersion` untuk compatibility.
- `correlationId` untuk tracing lintas service.
- `causationId` untuk audit chain.
- `aggregateId/version` untuk monotonic state transition.
- `occurredAt` untuk domain time, bukan hanya ingestion time.

Jangan mengandalkan EventBridge `id` sebagai satu-satunya event ID domain.

---

## 12. Java Event Publisher yang Lebih Production-Grade

Contoh sederhana reusable publisher:

```java
public interface DomainEventPublisher {
    void publish(DomainEvent event);
}

public record DomainEvent(
        String eventId,
        int schemaVersion,
        String eventName,
        String source,
        String occurredAt,
        String correlationId,
        String aggregateType,
        String aggregateId,
        long aggregateVersion,
        Object payload
) {}
```

Implementasi:

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequest;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequestEntry;

public final class EventBridgeDomainEventPublisher implements DomainEventPublisher {

    private final EventBridgeClient client;
    private final ObjectMapper objectMapper;
    private final String eventBusName;

    public EventBridgeDomainEventPublisher(
            EventBridgeClient client,
            ObjectMapper objectMapper,
            String eventBusName
    ) {
        this.client = client;
        this.objectMapper = objectMapper;
        this.eventBusName = eventBusName;
    }

    @Override
    public void publish(DomainEvent event) {
        try {
            String detail = objectMapper.writeValueAsString(event);

            PutEventsRequestEntry entry = PutEventsRequestEntry.builder()
                    .eventBusName(eventBusName)
                    .source(event.source())
                    .detailType(event.eventName())
                    .detail(detail)
                    .build();

            var response = client.putEvents(PutEventsRequest.builder()
                    .entries(entry)
                    .build());

            if (response.failedEntryCount() != null && response.failedEntryCount() > 0) {
                var failed = response.entries().get(0);
                throw new EventPublishException(
                        "EventBridge rejected eventId=" + event.eventId()
                                + ", errorCode=" + failed.errorCode()
                                + ", errorMessage=" + failed.errorMessage()
                );
            }
        } catch (Exception e) {
            throw new EventPublishException("Failed to publish eventId=" + event.eventId(), e);
        }
    }
}
```

Custom exception:

```java
public final class EventPublishException extends RuntimeException {
    public EventPublishException(String message) {
        super(message);
    }

    public EventPublishException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Di production, publisher ini sebaiknya dilengkapi:

- timeout SDK eksplisit,
- retry policy yang sesuai,
- structured logging,
- metrics untuk success/failure/latency,
- correlation ID,
- optional outbox integration.

---

## 13. Jangan Publish Event Langsung di Tengah Transaksi Database Tanpa Outbox

Kesalahan besar:

```text
1. insert case to DB
2. publish CaseSubmitted to EventBridge
3. commit DB
```

Problem:

- Jika publish sukses tapi commit DB gagal, consumer menerima event untuk case yang tidak ada.
- Jika commit sukses tapi publish gagal, case ada tetapi event hilang.

Lebih aman:

```text
1. begin transaction
2. insert/update aggregate
3. insert event into outbox table
4. commit transaction
5. background publisher reads outbox
6. publish to EventBridge
7. mark outbox event as published
```

Outbox bukan teori. Untuk sistem regulated/case-management, outbox memberi:

- auditability,
- retryability,
- recovery,
- deterministic event emission,
- operational visibility.

Minimal outbox table:

```sql
CREATE TABLE event_outbox (
    id              VARCHAR2(64) PRIMARY KEY,
    aggregate_type  VARCHAR2(100) NOT NULL,
    aggregate_id    VARCHAR2(100) NOT NULL,
    aggregate_ver   NUMBER NOT NULL,
    event_name      VARCHAR2(150) NOT NULL,
    source          VARCHAR2(200) NOT NULL,
    payload_json    CLOB NOT NULL,
    status          VARCHAR2(30) NOT NULL,
    attempt_count   NUMBER DEFAULT 0 NOT NULL,
    next_attempt_at TIMESTAMP,
    created_at      TIMESTAMP NOT NULL,
    published_at    TIMESTAMP,
    last_error      CLOB
);
```

Status:

```text
PENDING -> PUBLISHING -> PUBLISHED
                    \-> FAILED_RETRYABLE
                    \-> FAILED_PERMANENT
```

Invariant:

```text
Domain state and outbox event are committed atomically.
Event delivery to EventBridge is retried outside the domain transaction.
```

---

## 14. EventBridge Target Design

EventBridge target bisa langsung ke banyak resource. Tetapi direct target tidak selalu baik.

### 14.1 EventBridge → Lambda

Cocok untuk:

- lightweight reaction,
- enrichment kecil,
- notification trigger,
- simple adapter,
- low/medium traffic event processing.

Risiko:

- Lambda retry behavior harus dipahami.
- Idempotency wajib.
- Jika downstream lambat, concurrency bisa naik.
- Cold start mempengaruhi latency.

### 14.2 EventBridge → SQS → Worker/Lambda

Cocok untuk:

- butuh buffer,
- butuh consumer-controlled concurrency,
- event volume bursty,
- retry/DLQ per consumer harus jelas,
- downstream tidak boleh ditekan langsung.

Ini sering menjadi pattern enterprise terbaik:

```text
Producer -> EventBridge -> Rule -> SQS -> Java worker
```

Kenapa?

- EventBridge melakukan routing.
- SQS melakukan buffering.
- Worker melakukan processing dengan concurrency control.

### 14.3 EventBridge → Step Functions

Cocok untuk:

- event memulai workflow,
- ada multi-step orchestration,
- perlu state visibility,
- perlu retry/timeout per step.

### 14.4 EventBridge → API Destination

Cocok untuk:

- integrasi HTTP external/SaaS,
- tidak ingin menulis Lambda hanya untuk forward event,
- butuh connection/auth abstraction.

Tetapi hati-hati:

- failure semantics external API harus dipahami,
- payload redaction,
- retry side effect,
- idempotency key untuk external API.

---

## 15. EventBridge vs EventBridge Pipes

Event buses cocok untuk many-to-many routing.

Pipes cocok untuk point-to-point integration.

```text
Event bus:
source A,B,C -> bus -> rules -> target X,Y,Z

Pipe:
source queue/stream -> filter/enrich/transform -> target
```

Gunakan Pipes ketika:

- Source dan target jelas satu alur.
- Ingin filter/enrichment tanpa custom glue code.
- Ingin menghubungkan SQS/Kinesis/DynamoDB Streams/MSK ke target.

Jangan gunakan Pipes untuk menggantikan semua event architecture. Ia lebih seperti **managed integration conduit**, bukan domain event router global.

---

## 16. Archive and Replay

EventBridge archive memungkinkan event disimpan lalu direplay ke event bus asal. Ini berguna untuk:

- recover dari bug consumer,
- mengisi consumer baru,
- validasi fitur baru,
- forensic replay,
- migration testing.

Tetapi replay bukan magic.

Pertanyaan wajib sebelum replay:

1. Apakah consumer idempotent?
2. Apakah event lama masih compatible dengan schema baru?
3. Apakah side effect external akan terulang?
4. Apakah notification/email akan terkirim ulang?
5. Apakah state transition masih valid jika event lama diproses hari ini?
6. Apakah replay harus ke bus production atau isolated bus?
7. Apakah replay harus difilter per source/detail-type/time range?

Top-tier rule:

> Replay is safe only when handlers are replay-safe.

Handler replay-safe biasanya memiliki:

- inbox/dedup table,
- idempotency key,
- monotonic aggregate version check,
- side-effect guard,
- dry-run mode untuk migration,
- audit log bahwa event berasal dari replay.

---

## 17. Replay-Safe Consumer Design

Contoh inbox table:

```sql
CREATE TABLE event_inbox (
    event_id        VARCHAR2(64) PRIMARY KEY,
    event_name      VARCHAR2(150) NOT NULL,
    aggregate_id    VARCHAR2(100),
    aggregate_ver   NUMBER,
    first_seen_at   TIMESTAMP NOT NULL,
    processed_at    TIMESTAMP,
    status          VARCHAR2(30) NOT NULL,
    last_error      CLOB
);
```

Consumer flow:

```text
1. receive event
2. extract domain eventId
3. try insert eventId into inbox
4. if duplicate -> skip or return success
5. validate schema version
6. validate aggregate version/state transition
7. perform side effect
8. mark processed
```

Pseudo-code:

```java
public void handle(DomainEvent event) {
    if (!inbox.tryStart(event.eventId(), event.eventName())) {
        return; // duplicate or replay already processed
    }

    try {
        processor.process(event);
        inbox.markProcessed(event.eventId());
    } catch (RetryableProcessingException e) {
        inbox.markRetryableFailure(event.eventId(), e);
        throw e;
    } catch (Exception e) {
        inbox.markPermanentFailure(event.eventId(), e);
        throw e;
    }
}
```

Untuk SQS target, throwing exception biasanya membuat message kembali setelah visibility timeout. Untuk Lambda/EventBridge direct target, retry semantics berbeda. Karena itu target choice mempengaruhi consumer design.

---

## 18. Schema Registry and Event Contract

Schema registry membantu mengorganisasi dan menemukan struktur event. EventBridge menyediakan schema untuk AWS events dan mendukung custom/discovered schema. Schema bisa membantu consumer membuat code bindings, tetapi schema registry bukan pengganti governance.

Yang tetap harus ditentukan tim:

- naming convention,
- semantic versioning,
- compatibility rule,
- required vs optional fields,
- deprecation policy,
- ownership,
- example events,
- privacy classification,
- retention policy,
- event review process.

### 18.1 Compatibility Rule

Untuk event-driven system, consumer sering deploy tidak bersamaan dengan producer. Maka schema harus backward/forward tolerant.

Aman:

- menambah optional field,
- menambah enum value jika consumer tolerant,
- menambah nested optional object,
- memperkenalkan event type baru.

Berbahaya:

- menghapus required field,
- mengubah tipe field,
- mengubah semantic field tanpa rename,
- mengganti meaning enum value,
- mengubah identifier format tanpa periode migrasi.

### 18.2 Versioning

Pattern sederhana:

```json
{
  "schemaVersion": 2,
  "eventName": "CaseSubmitted",
  "payload": {
    "caseId": "CASE-001"
  }
}
```

Atau version pada detail-type:

```text
CaseSubmitted.v1
CaseSubmitted.v2
```

Rekomendasi umum:

- Gunakan `schemaVersion` di detail untuk minor/compatible evolution.
- Gunakan event type baru untuk breaking semantic change.
- Jangan membuat consumer harus switch terlalu banyak versi tanpa lifecycle policy.

---

## 19. Event Filtering Strategy

Rule pattern bisa menjadi governance atau jebakan.

### 19.1 Filter di EventBridge

Cocok untuk:

- source,
- detail-type,
- tenant/agency,
- event category,
- priority,
- channel,
- coarse routing.

### 19.2 Filter di Consumer

Cocok untuk:

- business rule kompleks,
- rule yang berubah sering,
- rule yang butuh database lookup,
- rule yang perlu audit decision,
- rule yang harus diuji secara domain-level.

Rule of thumb:

```text
EventBridge filters route.
Consumers decide.
```

Jangan memindahkan business policy kompleks ke event pattern hanya karena bisa.

---

## 20. Input Transformer

Input transformer bisa mengubah event sebelum dikirim ke target.

Use case:

- Mengirim subset field ke target.
- Membungkus payload agar sesuai format target.
- Menghilangkan noise.
- Menyesuaikan legacy target.

Risiko:

- Transformasi tersembunyi dari producer/consumer code.
- Debug lebih sulit.
- Schema governance terpecah.
- Bisa membuat target menerima payload yang berbeda dari event asli.

Rekomendasi:

- Gunakan input transformer untuk adaptasi ringan.
- Jangan jadikan input transformer sebagai business mapping kompleks.
- Dokumentasikan transformasi sebagai bagian dari event contract.
- Untuk transformasi besar, gunakan Lambda/worker adapter.

---

## 21. EventBridge Scheduler: Mental Model

EventBridge Scheduler adalah managed scheduler untuk one-time dan recurring invocation.

Ia cocok untuk:

- reminder,
- timeout/escalation,
- delayed command,
- recurring batch trigger,
- future callback,
- periodic cleanup,
- SLA timer.

Scheduler mendukung cron/rate expression dan one-time schedule. Ia juga mendukung flexible time window, retry, dan retention untuk failed invocation.

Jangan menyamakan Scheduler dengan:

- full workflow engine,
- durable business timer dengan complex state tanpa persistence,
- distributed lock,
- replacement semua batch orchestration.

Scheduler adalah **delivery mechanism untuk waktu**, bukan domain state store.

---

## 22. Scheduler vs Legacy Scheduled Rule

EventBridge punya scheduled rule legacy. Namun untuk scheduler modern, EventBridge Scheduler lebih tepat karena didesain sebagai service scheduling terpisah dengan fitur lebih kaya.

Perbedaan mental:

```text
Scheduled rule:
EventBridge rule runs on schedule and targets resource.

Scheduler:
Managed schedule entity invokes target with flexible window, retry, DLQ-like failure handling options, one-time or recurring schedule management.
```

Gunakan Scheduler untuk jadwal baru kecuali ada alasan spesifik mempertahankan scheduled rule.

---

## 23. Java SDK Client untuk Scheduler

AWS SDK for Java 2.x memiliki client service untuk Scheduler.

Pseudo-code konseptual:

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.scheduler.SchedulerClient;

public final class SchedulerProvider {
    private final SchedulerClient scheduler;

    public SchedulerProvider() {
        this.scheduler = SchedulerClient.builder()
                .region(Region.AP_SOUTHEAST_1)
                .build();
    }
}
```

Operasi umum:

```text
CreateSchedule
UpdateSchedule
DeleteSchedule
GetSchedule
ListSchedules
```

Production concern:

- schedule name harus deterministic,
- schedule group per domain/environment,
- target role harus least privilege,
- payload harus punya idempotency key,
- schedule deletion/update harus race-safe,
- expired schedule cleanup harus jelas.

---

## 24. Scheduler Naming and Idempotency

Untuk business timer seperti escalation:

```text
case-escalation-CASE-2026-000001-level-1
case-response-timeout-CASE-2026-000001
license-renewal-reminder-LIC-12345-30d
```

Tetapi AWS resource name punya batasan panjang/karakter. Maka gunakan deterministic hash.

Pattern:

```text
<env>-<domain>-<timer-type>-<hash>
```

Contoh:

```text
prod-case-escalation-9f2a81c4b7d0
```

Simpan mapping di DB:

```sql
CREATE TABLE business_schedule (
    id              VARCHAR2(64) PRIMARY KEY,
    aggregate_type  VARCHAR2(100) NOT NULL,
    aggregate_id    VARCHAR2(100) NOT NULL,
    timer_type      VARCHAR2(100) NOT NULL,
    schedule_name   VARCHAR2(200) NOT NULL,
    schedule_group  VARCHAR2(200) NOT NULL,
    fire_at         TIMESTAMP NOT NULL,
    status          VARCHAR2(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    cancelled_at    TIMESTAMP,
    fired_at        TIMESTAMP
);
```

Kenapa DB tetap perlu?

Karena Scheduler menyimpan jadwal teknis, sedangkan aplikasi perlu state bisnis:

```text
Was this escalation timer still valid when it fired?
Was the case already closed?
Was the schedule superseded?
Was it cancelled?
```

---

## 25. Scheduler for Case Escalation

Contoh regulatory workflow:

```text
Case submitted at T0
Officer must respond within 5 business days
If not responded by due time -> escalation event
```

Naive design:

```text
Create schedule -> invoke Lambda -> escalate case
```

Problem:

- Case mungkin sudah closed.
- Officer mungkin sudah responded.
- Schedule mungkin stale karena SLA changed.
- Duplicate invocation mungkin terjadi.
- Lambda retry bisa mengulang escalation.

Production design:

```text
1. Case service persists escalation timer in DB.
2. Case service creates Scheduler schedule with deterministic schedule name.
3. Scheduler target sends message to SQS or EventBridge.
4. Consumer receives CaseEscalationDue command/event.
5. Consumer loads current case state.
6. Consumer checks timer version and status.
7. If still due -> transition case to escalated.
8. If not due -> no-op with audit reason.
```

Payload:

```json
{
  "eventId": "timer-CASE-2026-000001-escalation-v2",
  "schemaVersion": 1,
  "type": "CaseEscalationDue",
  "caseId": "CASE-2026-000001",
  "timerVersion": 2,
  "scheduledFor": "2026-06-24T09:00:00+08:00",
  "correlationId": "corr-case-000001"
}
```

Invariant:

```text
Timer firing is not the same as business transition.
Timer firing only asks the domain model to re-evaluate whether transition is still valid.
```

---

## 26. Scheduler Target Choice

### 26.1 Scheduler → Lambda

Good for:

- simple scheduled task,
- low volume,
- direct processing.

Risk:

- concurrency spike,
- retry side effects,
- less buffering.

### 26.2 Scheduler → SQS

Often better for business timers.

```text
Scheduler -> SQS -> Java worker
```

Benefits:

- buffer,
- consumer concurrency control,
- DLQ,
- retry visibility,
- easier replay/manual redrive.

### 26.3 Scheduler → EventBridge

Good when timer should become an event routed to multiple consumers.

```text
Scheduler -> EventBridge PutEvents -> rules -> targets
```

Use when:

- timer is domain event,
- multiple downstreams care,
- event governance is desired.

### 26.4 Scheduler → Step Functions

Good when schedule starts a workflow.

```text
Scheduler -> StartExecution
```

Use when:

- scheduled report generation,
- multi-step cleanup,
- periodic reconciliation workflow.

---

## 27. Flexible Time Window

Scheduler can use flexible time window to spread invocation rather than firing all schedules at exactly same second.

Use flexible window when:

- task is not latency-critical,
- many schedules fire around same time,
- downstream needs load smoothing,
- cost/concurrency spike matters.

Do not use flexible window when:

- SLA requires exact-ish time,
- legal/regulatory deadline is strict,
- user-facing notification time is precise,
- timeout transition must occur as soon as due.

Even without flexible window, do not expect hard real-time precision. Treat scheduled execution as distributed delivery, not real-time clock interrupt.

---

## 28. Cron, Rate, and One-Time Schedules

### 28.1 Rate

Good for simple recurring intervals:

```text
rate(5 minutes)
rate(1 hour)
rate(1 day)
```

Use for:

- cleanup,
- polling,
- reconciliation,
- periodic cache warmup.

### 28.2 Cron

Good for calendar-specific recurrence:

```text
cron(0 9 ? * MON-FRI *)
```

Use for:

- business-day report,
- daily reminder,
- monthly statement.

Be careful with:

- timezone,
- daylight saving time,
- business calendar vs cron calendar,
- public holidays.

### 28.3 One-Time

Good for domain timer:

```text
at(2026-06-24T09:00:00)
```

Use for:

- escalation deadline,
- reminder due time,
- delayed task.

One-time schedule should usually be deleted or allowed to expire depending on lifecycle policy.

---

## 29. Timezone and Business Calendar

Cron expression is not business calendar logic.

For enterprise/regulatory systems:

```text
5 working days after submission
excluding weekends and public holidays
based on Singapore timezone
before 18:00 local time
```

This should not be encoded as only cron.

Correct design:

```text
1. Domain service calculates dueAt using business calendar library/table.
2. Persist dueAt and calculation basis.
3. Create one-time schedule at dueAt.
4. On fire, reload state and validate.
```

Store:

```text
dueAtUtc
dueAtLocal
businessCalendarVersion
timezone
ruleVersion
```

This matters for audit:

> “Why did the escalation happen on this date?”

You need evidence, not just “cron said so”.

---

## 30. EventBridge API Destination

API Destination lets EventBridge call HTTP endpoints via configured connections.

Use cases:

- SaaS webhook integration,
- external notification API,
- legacy HTTP integration,
- low-code event-to-HTTP forwarding.

Design concerns:

- authentication secret storage,
- request transformation,
- retry behavior,
- idempotency header,
- payload minimization,
- PII leakage,
- external rate limit,
- external outage isolation.

For critical integration, prefer:

```text
EventBridge -> SQS -> Java adapter -> external API
```

Why?

- More control over retry/backoff.
- Better observability.
- Easier idempotency.
- Easier vendor-specific error handling.
- Easier circuit breaker.

API Destination is useful, but do not blindly use it for high-risk external side effects.

---

## 31. EventBridge Security Model

Security concern:

```text
Who can publish which event to which bus?
Who can create rules?
Who can attach targets?
Who can replay events?
Who can read archives/schemas?
Who can create schedules that invoke privileged targets?
```

### 31.1 Producer Permission

Producer needs permission like:

```json
{
  "Effect": "Allow",
  "Action": "events:PutEvents",
  "Resource": "arn:aws:events:ap-southeast-1:123456789012:event-bus/case-management-bus-prod"
}
```

But least privilege also needs governance on source. Depending on service capabilities and org controls, enforce via:

- separate bus per domain,
- event bus resource policy,
- IAM condition keys where applicable,
- CI/CD validation,
- runtime publisher library restricting `source`,
- CloudTrail monitoring.

### 31.2 Rule Management Permission

Creating rules and targets is powerful.

A bad actor or buggy deployment could route sensitive event to wrong target.

Separate permissions:

```text
events:PutRule
events:PutTargets
events:DeleteRule
events:RemoveTargets
events:PutEvents
events:StartReplay
```

Do not give application runtime role permission to create arbitrary rules unless application genuinely manages dynamic routing.

### 31.3 Scheduler Target Role

Scheduler often needs an execution role to invoke target.

Example risk:

```text
Application can create schedule using role that can invoke any Lambda or send to any SQS.
```

Safer:

- one scheduler role per target class/domain,
- restrict target ARN,
- restrict schedule group,
- do not let app choose arbitrary role ARN,
- validate target payload.

---

## 32. Observability for EventBridge

You need visibility at multiple layers:

### 32.1 Producer Metrics

- publish success count,
- publish failure count,
- partial failure count,
- publish latency,
- event size,
- event type distribution,
- retry count,
- throttling count.

### 32.2 Bus/Rule Metrics

- matched events,
- invocations,
- failed invocations,
- throttled rules,
- DLQ delivery if configured,
- archive size/replay activity.

### 32.3 Target Metrics

For Lambda:

- invocations,
- errors,
- throttles,
- duration,
- iterator age if stream-based,
- concurrent executions.

For SQS:

- queue depth,
- age of oldest message,
- DLQ depth,
- receive/delete rate.

### 32.4 Logs

Producer log should include:

```text
eventId
source
detailType
aggregateId
aggregateVersion
correlationId
eventBusName
awsRequestId if available
failedEntryCount
```

Consumer log should include:

```text
eventId
correlationId
causationId
replay flag if known
handler name
idempotency decision
business transition result
```

---

## 33. Event Size and Payload Design

Do not put everything into event.

Bad:

```json
{
  "caseId": "CASE-001",
  "fullApplicantProfile": { ... },
  "allDocumentsBase64": [ ... ],
  "fullAuditTrail": [ ... ]
}
```

Good:

```json
{
  "caseId": "CASE-001",
  "caseVersion": 3,
  "documentRefs": [
    { "bucket": "...", "key": "...", "sha256": "..." }
  ]
}
```

Principle:

```text
Event should carry enough information to route, validate, and process safely.
Large binary or sensitive data belongs in S3/database with controlled access.
```

But do not make event too thin either.

Too thin:

```json
{ "caseId": "CASE-001" }
```

This forces every consumer to call producer DB/API, creating coupling and load.

Balanced event:

```json
{
  "eventId": "evt-001",
  "caseId": "CASE-001",
  "caseVersion": 3,
  "agencyCode": "CEA",
  "priority": "HIGH",
  "submittedAt": "2026-06-19T10:15:29Z",
  "documentCount": 4
}
```

---

## 34. Ordering Reality

EventBridge should not be treated as strict ordering system for domain state transitions.

If ordering matters, design explicitly:

- aggregate version,
- sequence number,
- idempotent state machine,
- SQS FIFO downstream where appropriate,
- per-aggregate serialization,
- conflict detection.

Example:

```text
CaseSubmitted v1
CaseUpdated v2
CaseClosed v3
```

Consumer receives:

```text
CaseClosed v3 first
CaseUpdated v2 later
```

Consumer must not regress state.

Rule:

```java
if (event.aggregateVersion() <= currentProjectionVersion) {
    return; // stale or duplicate event
}
```

But this only works if versions are meaningful and per aggregate.

---

## 35. EventBridge in Regulated Case Management

For regulatory/case-management systems, EventBridge can represent domain facts and timers.

Example domain events:

```text
CaseSubmitted
CaseAccepted
CaseRejected
CaseAssigned
CaseScreeningRequested
CaseScreeningCompleted
DocumentUploaded
DocumentVerificationFailed
OfficerClarificationRequested
ApplicantClarificationSubmitted
CaseEscalationDue
CaseEscalated
CaseClosed
AppealSubmitted
AppealDecisionIssued
```

Architecture:

```text
Case Service DB Transaction
  -> Outbox
  -> EventBridge case-management-bus
       -> Rule: screening events -> SQS screening queue
       -> Rule: notification events -> SQS notification queue
       -> Rule: audit events -> SQS audit queue
       -> Rule: escalation due -> Step Functions / SQS worker
```

Key invariants:

```text
1. Domain state changes are persisted before event publication.
2. Every event has stable eventId and aggregateVersion.
3. Consumers are idempotent.
4. Replay is controlled and auditable.
5. Sensitive fields are classified before event publication.
6. Routing rules are reviewed like code.
7. Schedule firing never bypasses domain state validation.
```

---

## 36. Anti-Patterns

### 36.1 EventBridge as Queue Replacement

Bad:

```text
Producer -> EventBridge -> Lambda does heavy work
```

For bursty/heavy work, prefer:

```text
Producer -> EventBridge -> SQS -> worker
```

### 36.2 EventBridge as Database

Bad:

```text
Need current case status? Replay all EventBridge events manually.
```

EventBridge archive/replay is not your query model. Maintain projections/databases.

### 36.3 Business Logic Hidden in Rule Patterns

Bad:

```text
Complex eligibility routing encoded across 20 JSON event patterns.
```

This becomes invisible business logic.

### 36.4 No Event Versioning

Bad:

```json
{
  "caseId": "CASE-001",
  "status": "S"
}
```

No schema version, no semantic clarity.

### 36.5 No Idempotency

Bad:

```text
On event received -> insert notification -> send email
```

Duplicate event sends duplicate email.

### 36.6 Direct External Side Effect Without Buffer

Bad:

```text
EventBridge -> API Destination -> external payment/refund API
```

For critical side effect, use controlled adapter with idempotency and DLQ.

### 36.7 Schedule Equals Business Truth

Bad:

```text
Schedule fired, therefore escalate.
```

Correct:

```text
Schedule fired, therefore re-check whether escalation is still valid.
```

---

## 37. Production Checklist

### 37.1 Event Bus

- [ ] Custom bus exists per domain/platform if needed.
- [ ] Default bus is not overloaded with all domain events.
- [ ] Cross-account policy is explicit.
- [ ] Event source naming is governed.
- [ ] Archive is configured if replay is required.
- [ ] Archive retention is aligned with compliance/cost.

### 37.2 Event Contract

- [ ] Every event has `eventId`.
- [ ] Every event has `schemaVersion`.
- [ ] Every event has `correlationId`.
- [ ] Every aggregate event has `aggregateId` and `aggregateVersion`.
- [ ] PII/sensitive fields classified.
- [ ] Example payloads are versioned.
- [ ] Breaking change policy exists.

### 37.3 Producer

- [ ] AWS SDK client is reused.
- [ ] Timeout/retry configured.
- [ ] `PutEvents` partial failure handled.
- [ ] Outbox used when event follows DB transaction.
- [ ] Metrics emitted.
- [ ] Logs contain event identity, not sensitive payload.

### 37.4 Consumer

- [ ] Idempotency/inbox implemented.
- [ ] Duplicate event safe.
- [ ] Replay safe.
- [ ] Stale aggregate version ignored or handled.
- [ ] Side effects guarded.
- [ ] DLQ/failed processing operational path exists.

### 37.5 Rules and Targets

- [ ] Rule patterns reviewed as code.
- [ ] Patterns are not overly broad.
- [ ] Patterns are not overly fragile.
- [ ] Targets have DLQ or downstream buffer where needed.
- [ ] Direct Lambda target justified.
- [ ] SQS buffer used for heavy/bursty processing.

### 37.6 Scheduler

- [ ] Schedule name deterministic.
- [ ] Schedule group used.
- [ ] Target role least-privilege.
- [ ] Payload has idempotency key.
- [ ] Domain DB stores business timer state.
- [ ] Timer firing revalidates current state.
- [ ] Flexible time window configured deliberately.
- [ ] Retry/failure handling configured.

---

## 38. Reference Architecture: Case Escalation with EventBridge Scheduler

```text
┌─────────────────────┐
│ Case Service         │
│ - DB transaction     │
│ - case state         │
│ - timer state        │
└──────────┬──────────┘
           │ create one-time schedule
           ▼
┌─────────────────────┐
│ EventBridge          │
│ Scheduler            │
└──────────┬──────────┘
           │ sends due event/command
           ▼
┌─────────────────────┐
│ SQS                  │
│ case-escalation-due  │
└──────────┬──────────┘
           │ poll
           ▼
┌─────────────────────┐
│ Java Worker          │
│ - idempotency        │
│ - state revalidation │
│ - transition logic   │
└──────────┬──────────┘
           │ emits domain event through outbox
           ▼
┌─────────────────────┐
│ EventBridge Bus      │
│ CaseEscalated        │
└──────────┬──────────┘
           │ routes
           ├──► Audit Queue
           ├──► Notification Queue
           └──► Reporting Projection
```

Important:

```text
Scheduler does not escalate directly.
Worker asks domain model whether escalation is valid.
CaseEscalated is emitted only after state transition is committed.
```

---

## 39. Reference Architecture: Domain Event Routing

```text
┌──────────────────────┐
│ Case Service          │
│ DB + Outbox           │
└─────────┬────────────┘
          │ PutEvents
          ▼
┌──────────────────────┐
│ EventBridge Bus       │
│ case-management-prod  │
└─────┬────────┬────────┘
      │        │
      │        ├── Rule: detail-type=CaseSubmitted
      │        │      ▼
      │        │   SQS screening-queue
      │        │
      ├── Rule: source=com.example.case-management
      │      ▼
      │   SQS audit-queue
      │
      └── Rule: detail.priority=CRITICAL
             ▼
          Lambda notify-duty-officer
```

This separates:

```text
Producer responsibility: publish correct event.
Router responsibility: match and deliver.
Consumer responsibility: process idempotently.
```

---

## 40. Java Design: EventBridge Client Factory

```java
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.core.retry.RetryMode;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;

import java.time.Duration;

public final class EventBridgeClients {

    private EventBridgeClients() {}

    public static EventBridgeClient create(Region region) {
        return EventBridgeClient.builder()
                .region(region)
                .overrideConfiguration(ClientOverrideConfiguration.builder()
                        .apiCallTimeout(Duration.ofSeconds(5))
                        .apiCallAttemptTimeout(Duration.ofSeconds(2))
                        .retryStrategy(RetryMode.STANDARD)
                        .build())
                .build();
    }
}
```

For Java 8, avoid text blocks and records. Use classes and string builders/ObjectMapper.

For Java 17–25, records and text blocks are fine, but do not make production event serialization depend on ad-hoc strings.

---

## 41. Java 8–25 Considerations

### Java 8

- No records.
- No text blocks.
- Use POJO event classes.
- Be careful with old TLS/runtime dependencies.
- AWS SDK 2.x still supports Java 8, but runtime environment and organization policy may push newer Java.

### Java 11/17

- Better baseline for modern server-side Java.
- Better TLS/runtime support.
- Easier container/Lambda alignment.

### Java 21/25

- Records, switch improvements, virtual threads, newer GC/runtime improvements.
- Virtual threads do not remove AWS service limits.
- Async SDK still uses its own async HTTP/event loop model.
- For Lambda, runtime support and AWS lifecycle must be checked before standardizing.

General rule:

```text
Language feature can simplify code, but cloud integration correctness still comes from idempotency, timeout, retry, IAM, and observability.
```

---

## 42. What Top 1% Engineers Internalize

A top-tier engineer sees EventBridge like this:

```text
EventBridge is not just a service.
It is a distributed event routing contract.
```

They ask:

- Who owns this event?
- Is this event fact or command?
- What is the schema compatibility rule?
- Is producer DB transaction atomic with event emission?
- What happens if publish partially fails?
- What happens if target is down?
- What happens if event is duplicated?
- What happens if event is replayed 6 months later?
- Can consumer process event out of order?
- Does payload leak sensitive data?
- Does rule pattern encode hidden business logic?
- Is schedule firing revalidated against domain state?
- Is there an operational playbook for replay/DLQ?

The beginner sees only:

```text
PutEvents -> Lambda
```

The senior sees:

```text
Domain fact -> outbox -> event bus -> routing contract -> buffered target -> idempotent consumer -> observable side effect -> auditable recovery
```

---

## 43. Practical Exercises

### Exercise 1 — Design Event Contract

Design event contract for:

```text
CaseSubmitted
DocumentUploaded
CaseEscalationDue
CaseEscalated
```

For each event define:

- source,
- detail-type,
- schemaVersion,
- eventId,
- aggregateId,
- aggregateVersion,
- required fields,
- optional fields,
- PII classification,
- example payload.

### Exercise 2 — Rule Pattern Review

Given this pattern:

```json
{
  "source": ["com.example.case-management"],
  "detail": {
    "status": ["SUBMITTED"]
  }
}
```

Find risks and improve it.

Expected observations:

- Missing detail-type.
- Status may be unstable.
- Too broad if many event types have status.
- Better to route by `detail-type: CaseSubmitted`.

### Exercise 3 — Scheduler Escalation

Design one-time schedule for case escalation.

Include:

- schedule name,
- schedule group,
- target,
- payload,
- DB timer state,
- idempotency key,
- stale timer handling,
- DLQ/retry plan.

### Exercise 4 — Replay Readiness

For a consumer that sends email on `CaseSubmitted`, define how to make it replay-safe.

Expected solution:

- inbox table,
- notification idempotency key,
- do not send if notification already sent,
- replay mode suppression or controlled re-send,
- audit reason.

---

## 44. Summary

EventBridge and Scheduler expand your Java AWS integration toolkit beyond queues and Lambda triggers.

Core mental models:

1. EventBridge is an event router, not a queue.
2. SNS is simpler pub/sub fan-out; SQS is durable pull-based buffer.
3. EventBridge + SQS is often the best enterprise pattern: route first, buffer second, process safely.
4. EventBridge Scheduler is a managed time-based invocation system, not business truth.
5. Timer firing must revalidate domain state.
6. Event contract must include identity, version, correlation, and aggregate context.
7. `PutEvents` can partially fail; handle per-entry result.
8. Archive/replay is powerful only when consumers are replay-safe.
9. Rule patterns are production logic and must be reviewed like code.
10. Top-tier design treats events as distributed contracts with security, observability, retry, idempotency, and auditability.

---

## 45. References

- AWS Documentation — What is Amazon EventBridge: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html
- AWS Documentation — Event buses in Amazon EventBridge: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html
- AWS Documentation — EventBridge examples using SDK for Java 2.x: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/java_eventbridge_code_examples.html
- AWS Documentation — Archiving and replaying events in Amazon EventBridge: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html
- AWS Documentation — Schema registries in Amazon EventBridge: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-schema-registry.html
- AWS Documentation — EventBridge schemas: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-schema.html
- AWS Documentation — Amazon EventBridge Pipes: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes.html
- AWS Documentation — What is Amazon EventBridge Scheduler: https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html
- AWS Documentation — Using EventBridge Scheduler: https://docs.aws.amazon.com/eventbridge/latest/userguide/using-eventbridge-scheduler.html
- AWS Documentation — Creating a scheduled rule legacy: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html

---

## 46. Status Seri

Part ini adalah **Part 21** dari seri `learn-java-aws-sdk-lambda-cloud-integration-engineering`.

Seri **belum selesai**.

Bagian berikutnya:

```text
Part 22 — Systems Manager for Runtime Operations
```
