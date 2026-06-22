# learn-java-bpmn-camunda-process-orchestration-engineering
# Part 12 — Message Correlation and Event-driven Process Design

> Seri: Java BPMN, Camunda, Process Orchestration Engineering  
> Target: Java 8 hingga Java 25  
> Fokus: message correlation, event-driven process, asynchronous boundary, race condition, idempotency, correlation key, dan integrasi Camunda dengan messaging system.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas:

- BPMN semantics.
- Camunda 7 vs Camunda 8.
- Zeebe runtime internals.
- Java client dan worker engineering.
- Worker reliability.
- Process variables.
- Error, incident, escalation, compensation.
- Human workflow.
- DMN decision engineering.

Sekarang kita masuk ke salah satu bagian paling penting dalam real production system: **message correlation dan event-driven process design**.

Banyak engineer bisa membuat BPMN diagram dengan message event. Tetapi lebih sedikit yang benar-benar memahami:

- apa yang sedang dikorelasikan;
- kapan subscription dibuat;
- bagaimana message dicocokkan ke process instance;
- apa yang terjadi jika message datang terlalu cepat;
- apa yang terjadi jika message datang dobel;
- apa yang terjadi jika process instance belum sampai ke wait state;
- apa bedanya publish event ke Kafka/RabbitMQ dengan publish message ke workflow engine;
- bagaimana mendesain correlation key yang stabil;
- bagaimana menjaga idempotency antara broker, application database, external system, dan workflow engine;
- bagaimana membangun event-driven workflow yang bisa diaudit dan diperbaiki saat production failure.

Tujuan Part 12 adalah membentuk mental model bahwa **message correlation bukan sekadar API call**, tetapi kontrak antara dunia asynchronous dan process instance yang sedang hidup.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membaca message event dalam BPMN sebagai runtime subscription, bukan sekadar simbol.
2. Mendesain correlation key yang benar.
3. Membedakan message name, correlation key, business key, process instance key, dan external event id.
4. Mendesain flow yang aman terhadap duplicate event, late event, early event, stale event, dan out-of-order event.
5. Menghubungkan Camunda dengan Kafka, RabbitMQ, REST callback, webhook, scheduler, dan external domain event.
6. Memilih antara orchestration dan choreography.
7. Membuat Java integration layer yang idempotent dan auditable.
8. Menghindari anti-pattern event-driven BPMN yang sering menyebabkan stuck process atau duplicated side effect.

---

## 1. Masalah yang Diselesaikan Message Correlation

Dalam sistem enterprise, proses bisnis jarang berjalan secara linear dan sinkron.

Contoh sederhana:

```text
Submit Application
  -> Generate Payment Advice
  -> Wait for Payment Confirmation
  -> Continue Review
```

Masalahnya: payment confirmation tidak terjadi di thread yang sama dengan submit application.

Payment confirmation bisa datang dari:

- payment gateway callback;
- scheduled reconciliation file;
- bank host-to-host integration;
- manual finance upload;
- Kafka event;
- RabbitMQ message;
- REST callback;
- batch job;
- admin repair action.

Process instance sudah berjalan, lalu berhenti di titik menunggu:

```text
[Wait for Payment Confirmation]
```

Ketika payment confirmation datang, engine harus menjawab pertanyaan:

> Message ini milik process instance yang mana?

Itulah inti message correlation.

Message correlation adalah mekanisme untuk menghubungkan **external asynchronous signal** ke **running process instance** yang sedang menunggu event tertentu.

---

## 2. Mental Model Utama

Jangan berpikir seperti ini:

```text
Saya publish message ke Camunda.
```

Berpikir seperti ini:

```text
Ada process instance yang sedang membuka subscription.
External world mengirim message dengan nama dan correlation key.
Engine mencocokkan message itu dengan subscription.
Jika match, token proses dilanjutkan.
```

Secara konseptual:

```text
Process Instance
  waits at Message Catch Event
  opens subscription:
    messageName = "PaymentReceived"
    correlationKey = "APP-2026-000123"

External System
  publishes message:
    name = "PaymentReceived"
    correlationKey = "APP-2026-000123"
    variables = { paymentStatus: "PAID", paidAt: "..." }

Engine
  finds matching subscription
  correlates message
  closes subscription
  continues token flow
```

Dari sudut runtime, message correlation adalah **matching problem**.

Biasanya matching membutuhkan minimal dua hal:

1. **Message name** — jenis event yang ditunggu.
2. **Correlation key** — identitas bisnis yang menentukan process instance target.

---

## 3. Message Event dalam BPMN

BPMN menyediakan beberapa bentuk message event.

### 3.1 Message Start Event

Message start event memulai process instance ketika message diterima.

Contoh:

```text
Payment Callback Received
  -> Start Payment Reconciliation Process
```

Cocok untuk:

- inbound webhook;
- event dari external system yang menjadi awal proses;
- inbound request yang asynchronous;
- file received event;
- cross-system notification.

Mental model:

```text
External Message
  -> create new process instance
```

### 3.2 Intermediate Message Catch Event

Intermediate message catch event membuat process instance berhenti dan menunggu message.

Contoh:

```text
Submit Application
  -> Wait for Payment Confirmation
  -> Continue Processing
```

Mental model:

```text
Existing process instance
  -> waits for future message
```

### 3.3 Boundary Message Event

Boundary message event ditempel pada activity/subprocess dan menangkap message ketika activity masih aktif.

Contoh:

```text
User Task: Review Application
  boundary message: Applicant Withdraws Application
```

Jika withdrawal datang saat review masih aktif, process bisa keluar dari review dan masuk ke withdrawal flow.

Boundary message bisa:

- interrupting: membatalkan activity yang ditempeli;
- non-interrupting: menjalankan cabang tambahan tanpa membatalkan activity utama.

### 3.4 Event Subprocess with Message Start

Event subprocess memungkinkan process menangkap message di scope tertentu, biasanya untuk kejadian yang dapat terjadi kapan saja selama process hidup.

Contoh:

```text
Main Process: Application Review
Event Subprocess: Applicant Updates Contact Details
```

Cocok untuk:

- update data selama proses berjalan;
- cancellation request;
- external correction;
- supplementary document received;
- fraud alert;
- agency comment received.

---

## 4. Message Name vs Correlation Key

Ini konsep yang sering tercampur.

### 4.1 Message Name

Message name menjawab:

> Event jenis apa ini?

Contoh:

```text
PaymentReceived
DocumentUploaded
ApplicantWithdrawn
AgencyResponseReceived
CaseAssigned
AppealSubmitted
```

Message name sebaiknya stabil, business-readable, dan tidak terlalu teknis.

Buruk:

```text
KafkaTopicPaymentV2PayloadReceived
HttpPostCallbackFromGateway
UpdateStatusApiCalled
```

Lebih baik:

```text
PaymentReceived
PaymentFailed
PaymentExpired
DocumentSubmissionReceived
ExternalAgencyResponseReceived
```

Message name harus merepresentasikan **business event**, bukan detail transport.

### 4.2 Correlation Key

Correlation key menjawab:

> Event ini milik instance bisnis yang mana?

Contoh:

```text
applicationNo = "APP-2026-000123"
paymentAdviceNo = "PAY-2026-900111"
caseNo = "CASE-2026-000771"
appealNo = "APL-2026-000043"
externalRequestId = "EXT-REQ-99321"
```

Correlation key harus:

- unik untuk konteks message tersebut;
- stabil sepanjang process menunggu message;
- tersedia di process variable saat subscription dibuat;
- tersedia di external event saat message dipublish;
- tidak berubah akibat edit data biasa;
- tidak ambigu lintas tenant/agency/environment;
- tidak menggunakan value yang mungkin null atau belum final.

### 4.3 Kenapa Tidak Cukup Message Name?

Jika hanya message name:

```text
PaymentReceived
```

Engine tidak tahu payment untuk aplikasi mana.

Kalau ada 10.000 process instance menunggu payment, semuanya menunggu message name yang sama. Yang membedakan adalah correlation key.

```text
PaymentReceived + APP-001
PaymentReceived + APP-002
PaymentReceived + APP-003
```

### 4.4 Kenapa Tidak Cukup Correlation Key?

Jika hanya correlation key:

```text
APP-2026-000123
```

Engine tidak tahu event apa yang terjadi.

Application yang sama mungkin menunggu beberapa event:

```text
PaymentReceived
DocumentUploaded
AgencyResponseReceived
ApplicantWithdrawn
```

Maka kombinasi yang kuat adalah:

```text
(messageName, correlationKey)
```

---

## 5. Business Key, Correlation Key, Process Instance Key, dan Event ID

Dalam workflow system, beberapa identifier harus dibedakan.

| Identifier | Arti | Contoh | Scope |
|---|---|---|---|
| Process Instance Key | ID internal engine untuk process instance | `2251799813689011` | Engine/runtime |
| Business Key | ID bisnis utama untuk process instance | `APP-2026-000123` | Business/domain |
| Correlation Key | ID untuk mencocokkan message ke subscription | `PAY-2026-900111` | Message subscription |
| Event ID | ID unik external event | `evt_8f3a...` | Event deduplication |
| Request ID | ID inbound technical request | `req_20260617_...` | API/log tracing |
| Trace ID | ID distributed tracing | W3C traceparent | Observability |
| Command ID | ID command yang menyebabkan side effect | `cmd-...` | Idempotency |

Kesalahan umum adalah memakai satu ID untuk semua hal.

Contoh buruk:

```text
Gunakan processInstanceKey sebagai correlationKey ke payment gateway.
```

Kenapa buruk?

- External system tidak seharusnya tahu internal engine key.
- Jika process dimigrasi/diulang, key berubah.
- Business audit menjadi sulit.
- Coupling ke engine terlalu kuat.

Lebih baik:

```text
Business key: applicationNo
Payment correlation key: paymentAdviceNo
Event dedup key: paymentGatewayEventId
Trace: traceId
Engine key: processInstanceKey, hanya untuk observability/internal operations
```

---

## 6. Subscription: Titik Kritis yang Sering Dilupakan

Message catch event tidak “selalu siap” sejak process instance dibuat.

Subscription biasanya dibuat ketika token proses mencapai message catch event.

Contoh:

```text
Start
  -> Validate Application
  -> Generate Payment Advice
  -> Wait for Payment Received
```

Subscription `PaymentReceived` baru ada setelah:

1. application valid;
2. payment advice generated;
3. token mencapai message catch event.

Jika payment message datang sebelum subscription ada, ada beberapa kemungkinan tergantung engine dan konfigurasi message TTL/buffering:

- message ditolak/tidak terkorelasi;
- message dibuffer sementara;
- message hilang dari sudut workflow jika integration layer tidak menyimpan;
- message diproses oleh adapter tapi process tidak lanjut;
- process stuck karena event sudah lewat.

Karena itu, desain message correlation harus mempertimbangkan **early message race condition**.

---

## 7. Race Condition Penting dalam Message Correlation

### 7.1 Message Arrives Before Process Waits

Kasus:

```text
T1: Process starts
T2: Payment advice created
T3: Payment gateway sends callback very fast
T4: Process reaches Wait for Payment
```

Jika callback datang di T3 tetapi subscription baru dibuat di T4, process bisa stuck.

Mitigasi:

1. Gunakan message TTL/buffering jika engine mendukung dan sesuai kebutuhan.
2. Simpan inbound event di application database lebih dulu.
3. Setelah process mencapai wait state, lakukan reconciliation check.
4. Modelkan payment status query sebelum wait.
5. Gunakan outbox/inbox dan event router yang retry correlation.
6. Pisahkan event ingestion dari process correlation.

Pattern yang lebih aman:

```text
Payment Callback API
  -> validate signature
  -> store inbound_event(eventId, paymentAdviceNo, payload, status=RECEIVED)
  -> try correlate to process
  -> if not correlated, keep for retry/reconciliation
```

Lalu scheduler:

```text
Find inbound_event where status=RECEIVED or CORRELATION_PENDING
  -> publish/correlate again
  -> mark CORRELATED only after success
```

### 7.2 Duplicate Message

External systems sering mengirim callback berkali-kali.

Penyebab:

- retry HTTP karena timeout;
- broker redelivery;
- manual resend;
- external reconciliation;
- consumer crash after processing;
- ambiguous response from workflow engine.

Mitigasi:

```text
unique(eventId)
unique(messageName, correlationKey, eventBusinessVersion)
processed_event table
idempotent correlation layer
```

Jangan mengandalkan engine saja untuk dedup semua kebutuhan bisnis. Deduplication harus dimiliki integration layer juga.

### 7.3 Late Message

Message datang setelah process sudah lanjut atau selesai.

Contoh:

```text
PaymentExpired already handled
Application cancelled
PaymentReceived arrives late
```

Pertanyaan desain:

- Apakah payment late boleh reopen process?
- Apakah harus refund?
- Apakah masuk exception queue?
- Apakah hanya dicatat sebagai ignored late event?
- Apakah perlu human review?

Late event bukan hanya technical issue. Ini business policy.

### 7.4 Stale Message

Message valid secara format tapi merepresentasikan state lama.

Contoh:

```text
AgencyResponseReceived version=1
AgencyResponseReceived version=2
```

Jika version 1 datang setelah version 2, jangan overwrite state terbaru.

Mitigasi:

- event sequence number;
- source event timestamp;
- version check;
- monotonic status transition;
- domain state machine validation.

### 7.5 Wrong Correlation Key

Message tidak match karena key salah.

Penyebab:

- external system mengirim applicationNo padahal process menunggu paymentAdviceNo;
- whitespace/case mismatch;
- environment prefix berbeda;
- tenant/agency missing;
- ID berubah setelah amendment;
- variable belum ada saat subscription dibuat;
- FE/backend memakai ID teknis, external system memakai ID bisnis.

Mitigasi:

- correlation contract document;
- canonical event schema;
- correlation registry/table;
- test cases untuk message correlation;
- log structured dengan messageName + correlationKey + tenant + eventId;
- dashboard unmatched message.

---

## 8. Correlation Key Design

Correlation key adalah salah satu keputusan arsitektur terpenting.

### 8.1 Kriteria Correlation Key yang Baik

Correlation key yang baik memiliki sifat:

1. **Stable** — tidak berubah selama process menunggu message.
2. **Unique enough** — tidak match ke banyak instance secara tidak sengaja.
3. **Available early** — sudah diketahui sebelum subscription dibuat.
4. **Known externally** — external system bisa mengirim key yang sama.
5. **Business meaningful** — bisa dipahami saat audit/ops.
6. **Tenant-safe** — tidak ambigu jika multi-tenant/multi-agency.
7. **Environment-safe** — tidak bocor antara DEV/UAT/PROD.
8. **Not sensitive** — tidak mengandung PII/secret.
9. **Immutable** — tidak diubah oleh update normal.
10. **Canonicalized** — format konsisten.

### 8.2 Contoh Correlation Key Bagus

```text
applicationNo
caseNo
paymentAdviceNo
externalSubmissionId
agencyRequestId
documentRequestNo
appealNo
```

### 8.3 Contoh Correlation Key Buruk

```text
applicantName
email
phoneNumber
currentStatus
createdDate
random UUID yang tidak dikirim ke external system
processInstanceKey yang tidak diketahui external system
DB row id internal yang bisa berubah saat migration
JSON payload hash tanpa governance
```

### 8.4 Composite Correlation Key

Kadang satu field tidak cukup.

Contoh:

```text
tenantId + applicationNo
tenantId + paymentAdviceNo
agencyCode + externalRequestId
caseNo + documentRequestNo
```

Karena engine biasanya menerima string correlation key, composite key perlu dibuat canonical.

Contoh:

```text
CEA|APP-2026-000123
CEA|PAY-2026-900111
ROM|REQ-556677
```

Jangan membuat format bebas tanpa aturan.

Buat helper:

```java
public final class CorrelationKeys {
    private CorrelationKeys() {}

    public static String application(String tenantId, String applicationNo) {
        return normalize(tenantId) + "|APPLICATION|" + normalize(applicationNo);
    }

    public static String payment(String tenantId, String paymentAdviceNo) {
        return normalize(tenantId) + "|PAYMENT|" + normalize(paymentAdviceNo);
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Correlation key part must not be blank");
        }
        return value.trim().toUpperCase(Locale.ROOT);
    }
}
```

Untuk Java 8, ganti `isBlank()` dengan `trim().isEmpty()`.

---

## 9. Message TTL dan Buffering

Message TTL menentukan berapa lama message dapat disimpan/buffered ketika belum bisa langsung dikorelasikan.

Mental model:

```text
Publish message
  if matching subscription exists:
      correlate now
  else if TTL > 0:
      buffer until subscription appears or TTL expires
  else:
      message cannot be correlated
```

TTL membantu untuk early message, tetapi bukan silver bullet.

### 9.1 Kapan TTL Berguna

TTL berguna jika:

- message bisa datang sedikit lebih cepat daripada wait state;
- delay antara process dan event kecil;
- external event reliable;
- duplicate handling tetap ada;
- business policy menerima buffering sementara.

Contoh:

```text
Payment callback bisa datang beberapa detik sebelum process mencapai wait state.
TTL = PT30M
```

### 9.2 Kapan TTL Tidak Cukup

TTL tidak cukup jika:

- event harus disimpan untuk audit permanen;
- message bisa datang berhari-hari lebih cepat;
- integration layer harus memberikan response deterministic;
- perlu dedup lintas sistem;
- perlu retry correlation setelah engine outage;
- perlu manual repair untuk unmatched events;
- payload besar/sensitif;
- perlu reconciliation.

Untuk production-grade regulatory/payment/document system, jangan hanya mengandalkan TTL. Gunakan inbound event table.

---

## 10. Inbound Event Table Pattern

Pattern ini sangat penting.

Alih-alih langsung publish/correlate ke Camunda dari controller/consumer, kita simpan event dulu.

```text
External Event
  -> Ingestion API/Consumer
  -> Validate
  -> Store inbound_event
  -> Correlation worker tries to correlate
  -> Mark event correlated/ignored/failed
```

### 10.1 Table Design

Contoh sederhana:

```sql
CREATE TABLE inbound_event (
    id                  VARCHAR2(64) PRIMARY KEY,
    source_system       VARCHAR2(64) NOT NULL,
    event_name          VARCHAR2(128) NOT NULL,
    event_type          VARCHAR2(128) NOT NULL,
    correlation_key     VARCHAR2(256) NOT NULL,
    tenant_id           VARCHAR2(64),
    business_key        VARCHAR2(128),
    event_version       NUMBER,
    event_timestamp     TIMESTAMP,
    payload_ref         VARCHAR2(512),
    payload_json        CLOB,
    status              VARCHAR2(32) NOT NULL,
    received_at         TIMESTAMP NOT NULL,
    correlated_at       TIMESTAMP,
    last_attempt_at     TIMESTAMP,
    attempt_count       NUMBER DEFAULT 0 NOT NULL,
    last_error_code     VARCHAR2(128),
    last_error_message  VARCHAR2(1000),
    process_instance_key VARCHAR2(64),
    created_by          VARCHAR2(128),
    created_date_time   TIMESTAMP NOT NULL,
    updated_by          VARCHAR2(128),
    updated_date_time   TIMESTAMP
);

CREATE UNIQUE INDEX ux_inbound_event_source_id
ON inbound_event(source_system, id);

CREATE INDEX ix_inbound_event_correlation
ON inbound_event(event_name, correlation_key, status);
```

Status:

```text
RECEIVED
VALIDATED
CORRELATION_PENDING
CORRELATED
DUPLICATE
IGNORED_LATE
IGNORED_STALE
INVALID
FAILED
MANUAL_REVIEW
```

### 10.2 Keuntungan

1. Event tidak hilang jika engine down.
2. Duplicate bisa dideteksi.
3. Audit lebih kuat.
4. Correlation bisa di-retry.
5. Unmatched message bisa dimonitor.
6. Payload bisa disimpan atau direferensikan.
7. Manual repair lebih aman.
8. Tidak bergantung hanya pada TTL engine.

### 10.3 Trade-off

1. Tambah table dan logic.
2. Tambah eventual consistency.
3. Perlu cleanup/archival.
4. Perlu dashboard/ops.
5. Perlu status transition yang jelas.

Untuk sistem regulasi, payment, document, dan enforcement, trade-off ini biasanya layak.

---

## 11. Correlation Router Pattern

Correlation router adalah service/layer yang bertanggung jawab mengubah external event menjadi Camunda message.

```text
Kafka/RabbitMQ/Webhook/File
  -> Event Ingestion
  -> Inbound Event Table
  -> Correlation Router
  -> Camunda Publish Message
```

Tugas correlation router:

- resolve messageName;
- build correlationKey;
- canonicalize payload;
- validate event version;
- enforce idempotency;
- publish message ke engine;
- update inbound event status;
- emit audit log;
- expose unmatched/error dashboard.

### 11.1 Jangan Sebar Correlation Logic di Banyak Tempat

Buruk:

```text
PaymentController directly publish PaymentReceived
KafkaConsumer directly publish AgencyResponseReceived
Scheduler directly publish PaymentExpired
AdminTool directly publish DocumentUploaded
```

Akibat:

- format key tidak konsisten;
- logging berbeda;
- retry berbeda;
- error handling berbeda;
- duplicate handling berbeda;
- audit sulit.

Lebih baik:

```text
All inbound events -> CorrelationRouter
```

### 11.2 Java Interface

```java
public interface ProcessMessageCorrelationRouter {
    CorrelationResult correlate(InboundBusinessEvent event);
}

public final class InboundBusinessEvent {
    private final String sourceSystem;
    private final String eventId;
    private final String eventType;
    private final String tenantId;
    private final String businessKey;
    private final String correlationKey;
    private final Instant eventTime;
    private final Map<String, Object> payload;

    // constructor/getters omitted
}

public final class CorrelationResult {
    private final boolean correlated;
    private final String status;
    private final String processInstanceKey;
    private final String reasonCode;
    private final String errorMessage;

    // constructor/getters omitted
}
```

### 11.3 Mapping Event Type to BPMN Message Name

```java
public enum WorkflowMessageName {
    PAYMENT_RECEIVED("PaymentReceived"),
    PAYMENT_FAILED("PaymentFailed"),
    DOCUMENT_UPLOADED("DocumentUploaded"),
    AGENCY_RESPONSE_RECEIVED("AgencyResponseReceived"),
    APPLICANT_WITHDRAWN("ApplicantWithdrawn");

    private final String bpmnName;

    WorkflowMessageName(String bpmnName) {
        this.bpmnName = bpmnName;
    }

    public String bpmnName() {
        return bpmnName;
    }
}
```

---

## 12. Publishing Message from Java

Konsep pseudo-code untuk Camunda 8 Java Client:

```java
client
    .newPublishMessageCommand()
    .messageName("PaymentReceived")
    .correlationKey("CEA|PAYMENT|PAY-2026-900111")
    .timeToLive(Duration.ofHours(1))
    .variables(Map.of(
        "paymentStatus", "PAID",
        "paymentEventId", "evt-123",
        "paidAt", "2026-06-17T01:30:00Z"
    ))
    .send()
    .join();
```

Untuk Java 8:

```java
Map<String, Object> variables = new HashMap<>();
variables.put("paymentStatus", "PAID");
variables.put("paymentEventId", "evt-123");
variables.put("paidAt", "2026-06-17T01:30:00Z");

client
    .newPublishMessageCommand()
    .messageName("PaymentReceived")
    .correlationKey("CEA|PAYMENT|PAY-2026-900111")
    .timeToLive(Duration.ofHours(1))
    .variables(variables)
    .send()
    .join();
```

Production code tidak boleh langsung `.join()` tanpa timeout/error classification.

Lebih baik:

```java
public CorrelationResult publishPaymentReceived(PaymentReceivedEvent event) {
    String correlationKey = CorrelationKeys.payment(event.tenantId(), event.paymentAdviceNo());

    Map<String, Object> variables = paymentVariableMapper.toProcessVariables(event);

    try {
        PublishMessageResponse response = client
            .newPublishMessageCommand()
            .messageName("PaymentReceived")
            .correlationKey(correlationKey)
            .timeToLive(Duration.ofHours(1))
            .variables(variables)
            .send()
            .get(10, TimeUnit.SECONDS);

        return CorrelationResult.correlated(String.valueOf(response.getMessageKey()));
    } catch (TimeoutException e) {
        return CorrelationResult.unknown("CAMUNDA_TIMEOUT", e.getMessage());
    } catch (Exception e) {
        return CorrelationResult.failed("CAMUNDA_PUBLISH_FAILED", e.getMessage());
    }
}
```

Catatan: response timeout bukan berarti message pasti gagal. Bisa saja command berhasil di engine tetapi client tidak menerima response. Karena itu status `UNKNOWN` lebih aman daripada langsung `FAILED`.

---

## 13. Message Correlation Result Ambiguity

Distributed systems sering punya kondisi ambigu:

```text
Client sends publish message command
Engine receives command
Engine correlates message
Network breaks before response reaches client
Client sees timeout
```

Pertanyaan:

> Apakah message sudah terkorelasi?

Jawabannya: belum tentu diketahui dari sisi client.

Karena itu, jangan membuat logic seperti:

```java
try {
    publishMessage();
    markCorrelated();
} catch (Exception e) {
    markFailed();
}
```

Lebih aman:

```text
SUCCESS response -> CORRELATED
TIMEOUT/UNKNOWN -> CORRELATION_UNKNOWN, retry with idempotency
DEFINITE validation error -> FAILED/INVALID
NO_MATCH depending API behavior -> PENDING or UNMATCHED
```

Untuk mengelola ambiguity, gunakan:

- message id jika tersedia;
- event id sebagai variable;
- inbound event table;
- retry correlation;
- process-side dedup check;
- Operate/search/reconciliation jika perlu;
- business invariant agar duplicate correlation tidak menciptakan side effect ganda.

---

## 14. Process-side Deduplication

Integration layer dedup penting, tetapi kadang process juga perlu dedup.

Contoh:

PaymentReceived message membawa:

```json
{
  "paymentEventId": "evt-123",
  "paymentStatus": "PAID",
  "paymentAmount": 120.50
}
```

Jika duplicate message berhasil masuk melalui path berbeda, process/worker berikutnya harus tidak membuat side effect ganda.

Pattern:

```text
PaymentReceived
  -> Service Task: Apply Payment Result
       - check processed event id
       - check application payment status
       - if already paid with same event: no-op
       - if conflict: raise business incident/manual review
  -> Continue
```

Java:

```java
@Transactional
public PaymentApplyResult applyPayment(PaymentReceivedCommand command) {
    if (processedEventRepository.exists(command.eventId())) {
        return PaymentApplyResult.duplicateNoop();
    }

    ApplicationPayment payment = paymentRepository.findByAdviceNoForUpdate(command.paymentAdviceNo());

    if (payment.isPaid()) {
        processedEventRepository.save(command.eventId(), "DUPLICATE_PAID");
        return PaymentApplyResult.alreadyPaidNoop();
    }

    payment.markPaid(command.amount(), command.paidAt(), command.eventId());
    processedEventRepository.save(command.eventId(), "APPLIED");

    return PaymentApplyResult.applied();
}
```

---

## 15. BPMN Modeling Patterns for Message Correlation

### 15.1 Simple Wait-for-Message Pattern

```text
Submit Application
  -> Generate Payment Advice
  -> Wait for PaymentReceived
  -> Mark Payment Paid
  -> Continue Review
```

Cocok jika:

- hanya satu message utama;
- timeout sederhana;
- duplicate/early event ditangani integration layer.

### 15.2 Wait-for-Message with Timeout

```text
Generate Payment Advice
  -> Wait for PaymentReceived
       boundary timer: Payment Deadline Reached
  -> Continue Review

Timer path:
  -> Mark Payment Expired
  -> Notify Applicant
  -> End/Cancel Application
```

Pertanyaan desain:

- Jika PaymentReceived datang setelah deadline, apa policy?
- Apakah refund?
- Apakah reopen?
- Apakah manual review?

### 15.3 Event-based Gateway Pattern

```text
After Payment Advice
  -> Event-based Gateway
       -> PaymentReceived
       -> PaymentFailed
       -> PaymentDeadlineReached
       -> ApplicantWithdrawn
```

Gunakan ketika process menunggu beberapa alternative events dan yang pertama terjadi menentukan jalur.

Cocok untuk:

```text
wait for payment success OR payment failed OR timeout OR withdrawal
```

Hati-hati:

- event-based gateway memiliki race semantics;
- event pertama yang menang bisa membatalkan subscription lain;
- late event harus ditangani di luar atau event subprocess.

### 15.4 Boundary Message on User Task

```text
User Task: Officer Review
  boundary message: ApplicantWithdrawn
```

Jika applicant withdraw saat officer review masih berjalan, review dibatalkan dan process masuk withdrawal handling.

Cocok untuk:

- cancellation;
- external override;
- urgent alert;
- case transfer;
- applicant update.

### 15.5 Non-interrupting Boundary Message

```text
User Task: Officer Review
  non-interrupting boundary message: AdditionalDocumentUploaded
      -> Attach Document
      -> Notify Officer
```

Review tetap berjalan, tapi document baru diproses.

Cocok untuk:

- tambahan dokumen;
- comment baru;
- metadata update;
- supplementary evidence.

Hati-hati dengan concurrency: officer mungkin sedang submit decision saat document baru masuk.

### 15.6 Event Subprocess for Anytime Event

```text
Main Process: Application Processing

Event Subprocess:
  Message Start: ApplicantContactUpdated
    -> Update Contact Snapshot
    -> Audit Change
```

Cocok untuk event yang bisa terjadi di banyak titik proses.

Jangan menggambar boundary message di semua user task jika event tersebut secara konseptual berlaku untuk seluruh process.

---

## 16. Event-driven Process vs Event-driven Microservices

Event-driven process bukan sama dengan event-driven microservices.

### 16.1 Event-driven Microservices

Service publish domain event:

```text
ApplicationSubmitted
PaymentReceived
DocumentUploaded
```

Consumer lain bereaksi:

```text
Notification Service
Reporting Service
Workflow Service
Audit Service
Search Indexer
```

Tidak selalu ada central orchestrator.

### 16.2 Event-driven Process

Process instance menunggu event tertentu dan melanjutkan token flow.

```text
Application Review Process waits for PaymentReceived
```

### 16.3 Bedanya

| Aspek | Event-driven Microservices | Event-driven Process |
|---|---|---|
| Fokus | decoupled reactions | process progression |
| State | tersebar di service | eksplisit di process instance |
| Event consumer | banyak service | workflow engine/process adapter |
| Audit process path | perlu disusun dari event log | terlihat dari process history/operate |
| Human task | bukan bawaan | first-class concern |
| Timeout/SLA | harus dibangun sendiri | bisa dimodelkan di BPMN |
| Correlation | consumer-defined | message subscription-defined |

Keduanya bisa digabung.

---

## 17. Orchestration vs Choreography

### 17.1 Orchestration

Ada coordinator eksplisit.

```text
Workflow Engine:
  -> ask Payment Service
  -> wait for PaymentReceived
  -> ask Document Service
  -> assign Officer Task
  -> wait for AgencyResponse
```

Kelebihan:

- process visible;
- audit lebih mudah;
- timeout/SLA eksplisit;
- human workflow natural;
- compensation lebih terstruktur;
- troubleshooting lebih mudah.

Kekurangan:

- coordinator bisa menjadi coupling point;
- process model bisa terlalu besar;
- team harus disiplin boundary;
- risiko distributed monolith.

### 17.2 Choreography

Service bereaksi terhadap event tanpa central coordinator.

```text
Application Service publishes ApplicationSubmitted
Payment Service reacts
Notification Service reacts
Review Service reacts
```

Kelebihan:

- loose coupling;
- scalable secara organisasi;
- cocok untuk simple domain reactions;
- tidak ada central process bottleneck.

Kekurangan:

- global process sulit dilihat;
- failure path tersebar;
- audit end-to-end sulit;
- SLA cross-service sulit;
- compensation kompleks;
- event storming harus sangat matang.

### 17.3 Decision Rule

Gunakan orchestration ketika:

- proses long-running;
- banyak human task;
- banyak SLA/escalation;
- perlu audit defensibility;
- business ingin melihat process path;
- compensation dan manual repair penting;
- cross-service flow harus governed.

Gunakan choreography ketika:

- event reaction sederhana;
- tidak ada central business process;
- consumer independent;
- eventual consistency cukup;
- audit end-to-end tidak terlalu berat;
- service ownership jelas.

Hybrid sering paling realistis:

```text
Workflow Engine orchestrates core regulated process.
Domain services publish events.
Workflow consumes selected events.
Other services consume workflow events for reporting/notification/search.
```

---

## 18. Kafka/RabbitMQ Integration with Camunda

Camunda tidak harus langsung menjadi Kafka consumer utama. Lebih sehat jika ada adapter.

```text
Kafka Topic: payment-events
  -> PaymentEventConsumer
  -> inbound_event table
  -> CorrelationRouter
  -> Camunda message
```

Atau RabbitMQ:

```text
Queue: agency.response.received
  -> AgencyResponseConsumer
  -> inbound_event
  -> CorrelationRouter
  -> Camunda message
```

### 18.1 Kenapa Tidak Langsung Correlate dari Consumer?

Bisa, tetapi risiko:

- consumer ack sebelum correlation durable;
- correlation timeout membuat message redelivery tidak jelas;
- duplicate sulit dikontrol;
- unmatched event hilang;
- audit lemah;
- retry policy broker tercampur dengan retry policy correlation;
- poison event menghambat queue.

### 18.2 Recommended Flow

```text
1. Consume broker message
2. Validate schema and signature
3. Insert inbound_event with unique event id
4. Commit DB transaction
5. Ack broker message
6. Async correlation worker processes inbound_event
7. Correlate message to Camunda
8. Update inbound_event status
```

Ini memisahkan:

- broker delivery reliability;
- event ingestion reliability;
- workflow correlation reliability.

### 18.3 Trade-off Ack After Insert

Jika ack broker setelah insert inbound_event:

- broker tidak perlu redeliver terus;
- event sudah durable di DB;
- correlation bisa retry internal;
- poison correlation tidak memblokir broker partition/queue.

Kelemahannya:

- perlu DB sebagai buffer;
- ada eventual consistency;
- perlu reconciliation job.

Untuk enterprise workflow, ini sering pilihan yang lebih operable.

---

## 19. REST Callback / Webhook Integration

Webhook umum untuk payment, external agency, document signing, e-signature, notification provider.

Pattern:

```text
POST /callbacks/payment
  -> authenticate/verify signature
  -> validate schema
  -> dedup by providerEventId
  -> store inbound_event
  -> return 200/202 quickly
  -> async correlate
```

Jangan membuat webhook menunggu process selesai.

Buruk:

```text
Webhook -> correlate -> worker executes downstream tasks -> return only after process continues
```

Kenapa buruk?

- provider timeout;
- duplicate callback;
- tight coupling;
- process delay mempengaruhi callback response;
- operational ambiguity.

Lebih baik:

```text
Webhook -> accept durable event -> return 202 Accepted
Correlation/processing async
```

Response policy:

| Kondisi | Response |
|---|---|
| Valid new event stored | `202 Accepted` |
| Duplicate known event | `200 OK` atau `202 Accepted` |
| Invalid signature | `401/403` |
| Invalid schema | `400` |
| Temporary DB failure | `503` |
| Unknown correlation target | tetap `202`, lalu internal pending/manual review |

Jangan return `404` hanya karena process belum menunggu message. External provider tidak peduli BPMN wait state.

---

## 20. Outbound Events from Camunda Process

Event-driven design bukan hanya inbound ke process. Process juga sering perlu mengirim event keluar.

Contoh:

```text
ApplicationApproved
LicenceIssued
CaseEscalated
PaymentMarkedPaid
DocumentRequestCreated
```

Jangan publish external event langsung dari BPMN tanpa idempotency.

Recommended:

```text
Service Task: Record Approval
  -> update domain DB
  -> insert outbox event ApplicationApproved
  -> complete job

Outbox Publisher
  -> publish Kafka/RabbitMQ
  -> mark outbox published
```

### 20.1 Kenapa Outbox Penting?

Karena worker biasanya melakukan beberapa hal:

```text
1. Update application status to APPROVED
2. Publish ApplicationApproved event
3. Complete Camunda job
```

Failure windows:

- DB update sukses, publish gagal;
- publish sukses, complete job gagal;
- complete job timeout, job reactivated;
- worker crash setelah publish.

Outbox membuat side effect domain event menjadi transactional dengan domain update.

---

## 21. Event Schema Design

Event schema harus diperlakukan sebagai kontrak.

Contoh `PaymentReceived`:

```json
{
  "eventId": "payevt-20260617-000001",
  "eventType": "PaymentReceived",
  "eventVersion": 1,
  "sourceSystem": "PAYMENT_GATEWAY",
  "tenantId": "CEA",
  "paymentAdviceNo": "PAY-2026-900111",
  "applicationNo": "APP-2026-000123",
  "amount": 120.50,
  "currency": "SGD",
  "paidAt": "2026-06-17T01:30:00Z",
  "providerReferenceNo": "PGW-778899",
  "traceId": "..."
}
```

Minimum fields:

- `eventId`
- `eventType`
- `eventVersion`
- `sourceSystem`
- `eventTime`
- `correlation field`
- `business context`
- `payload`

Jangan mengandalkan payload bebas tanpa versioning.

---

## 22. Versioning Event Schema

Event berubah.

Contoh V1:

```json
{
  "eventType": "AgencyResponseReceived",
  "agencyRequestId": "REQ-1",
  "response": "APPROVED"
}
```

V2:

```json
{
  "eventType": "AgencyResponseReceived",
  "agencyRequestId": "REQ-1",
  "decision": "APPROVED",
  "conditions": ["..."],
  "officerId": "..."
}
```

Correlation router harus bisa:

- menerima beberapa versi;
- normalize ke canonical internal event;
- reject unsupported version;
- map ke process variables yang stabil;
- tidak memaksa BPMN berubah untuk setiap schema minor.

```java
public interface EventNormalizer<T> {
    CanonicalInboundEvent normalize(T rawEvent);
}
```

---

## 23. Correlation and Domain State Machine

Process event tidak boleh langsung mengubah domain tanpa validasi state.

Contoh:

```text
PaymentReceived datang untuk application CANCELLED.
```

Jangan hanya karena message terkorelasi, domain langsung `PAID`.

Domain aggregate harus punya invariant:

```java
public void markPaymentReceived(PaymentReceived payment) {
    if (this.status == ApplicationStatus.CANCELLED) {
        throw new BusinessConflictException("Payment received for cancelled application");
    }
    if (this.paymentStatus == PaymentStatus.PAID) {
        return; // idempotent duplicate
    }
    this.paymentStatus = PaymentStatus.PAID;
    this.paidAt = payment.paidAt();
}
```

Process orchestration dan domain state machine saling melengkapi:

- BPMN mengatur long-running flow.
- Domain aggregate menjaga invariant entity.

Jangan membuat BPMN menjadi satu-satunya penjaga business rule.

---

## 24. Handling Unmatched Messages

Unmatched message adalah message yang belum bisa dikorelasikan ke process instance.

Penyebab:

- process belum menunggu;
- process sudah selesai;
- correlation key salah;
- message name salah;
- tenant salah;
- duplicate;
- event obsolete;
- BPMN model berubah;
- process cancelled.

Status operasional:

```text
UNMATCHED_PENDING
UNMATCHED_EXPIRED
UNMATCHED_DUPLICATE
UNMATCHED_LATE
UNMATCHED_INVALID_KEY
UNMATCHED_MANUAL_REVIEW
```

Dashboard minimum:

| Metric | Meaning |
|---|---|
| unmatched count by event type | jenis event bermasalah |
| oldest unmatched age | risiko SLA/data loss |
| retry attempts | correlation instability |
| duplicate count | external retry behavior |
| late event count | process/policy mismatch |
| invalid event count | schema/security issue |

Runbook:

1. Check event name.
2. Check correlation key.
3. Check process instance exists.
4. Check process current state.
5. Check whether subscription exists.
6. Check event freshness/version.
7. Decide: retry, ignore, manual apply, start new process, compensate, refund, or escalate.

---

## 25. Message Correlation and Security

Inbound event adalah attack surface.

Risiko:

- forged callback marks payment paid;
- replayed event reopens process;
- wrong tenant event correlated to another tenant;
- payload injection into process variable;
- unauthorized system completes business step;
- PII leakage into workflow variables;
- event storm causing resource exhaustion.

Controls:

1. Signature verification.
2. mTLS/API gateway auth.
3. Source system allowlist.
4. Event ID replay protection.
5. Tenant validation.
6. Schema validation.
7. Payload size limit.
8. Correlation key normalization.
9. Sensitive field filtering.
10. Rate limiting.
11. Audit log.
12. Alert on suspicious duplicates/failures.

Do not publish external payload directly as process variables.

Use mapper:

```java
Map<String, Object> toProcessVariables(PaymentReceivedEvent event) {
    Map<String, Object> vars = new HashMap<>();
    vars.put("paymentStatus", "PAID");
    vars.put("paymentEventId", event.eventId());
    vars.put("paymentAdviceNo", event.paymentAdviceNo());
    vars.put("paidAt", event.paidAt().toString());
    vars.put("paymentAmount", event.amount());
    vars.put("paymentCurrency", event.currency());
    return vars;
}
```

Do not include:

- full card details;
- secrets;
- raw tokens;
- full provider payload if large/sensitive;
- unnecessary applicant PII.

---

## 26. Message Correlation Observability

Minimum structured log fields:

```json
{
  "event": "workflow.message.correlation.attempted",
  "messageName": "PaymentReceived",
  "correlationKey": "CEA|PAYMENT|PAY-2026-900111",
  "eventId": "payevt-123",
  "sourceSystem": "PAYMENT_GATEWAY",
  "tenantId": "CEA",
  "businessKey": "APP-2026-000123",
  "processInstanceKey": "2251799813689011",
  "result": "CORRELATED",
  "attempt": 1,
  "durationMs": 82,
  "traceId": "..."
}
```

Metrics:

```text
workflow_message_correlation_attempt_total{messageName,result}
workflow_message_correlation_duration_ms{messageName}
workflow_message_unmatched_total{messageName,reason}
workflow_message_duplicate_total{messageName,sourceSystem}
workflow_message_pending_age_seconds{messageName}
workflow_message_correlation_unknown_total{messageName}
```

Trace spans:

```text
Webhook Controller
  -> Store Inbound Event
  -> Correlation Router
  -> Camunda Publish Message
  -> Worker Apply Payment Result
  -> Domain DB Update
```

Untuk audit, simpan:

- raw received timestamp;
- event timestamp dari source;
- correlation attempted timestamp;
- correlated timestamp;
- actor/system;
- reason jika ignored;
- manual action jika repaired.

---

## 27. Message Correlation Testing Strategy

### 27.1 Unit Test

Test:

- correlation key builder;
- event normalizer;
- messageName mapping;
- variable mapper;
- duplicate detection;
- stale event detection;
- late event classification.

Contoh:

```java
@Test
void paymentCorrelationKeyShouldBeCanonical() {
    String key = CorrelationKeys.payment(" cea ", " pay-2026-001 ");
    assertEquals("CEA|PAYMENT|PAY-2026-001", key);
}
```

### 27.2 Integration Test

Test:

- process waits for message;
- publish message continues process;
- wrong key does not continue process;
- duplicate event no-op;
- early event handled via inbound table/TTL;
- timeout path works;
- event-based gateway chooses expected path.

### 27.3 Contract Test

Between source system and workflow adapter:

- required fields;
- version compatibility;
- correlation field existence;
- timestamp format;
- enum values;
- idempotency header/eventId.

### 27.4 Chaos/Failure Test

Simulate:

- Camunda unavailable;
- DB unavailable;
- broker redelivery;
- callback duplicate;
- publish timeout;
- process not waiting;
- event arrives after process completed;
- worker crash after correlation.

---

## 28. Worked Example: Payment Confirmation Flow

### 28.1 Business Requirement

Application requires payment before officer review.

Rules:

1. Applicant submits application.
2. System generates payment advice.
3. Applicant must pay within 7 calendar days.
4. Payment gateway sends callback.
5. If paid on time, application proceeds to review.
6. If unpaid after deadline, application expires.
7. If payment comes late, finance review is required.
8. Duplicate callback must not duplicate payment.
9. All events must be auditable.

### 28.2 BPMN Shape

```text
Start: Application Submitted
  -> Validate Application
  -> Generate Payment Advice
  -> Event-based Gateway
       -> Message: PaymentReceived
            -> Apply Payment Result
            -> Officer Review
       -> Timer: Payment Deadline Reached
            -> Mark Payment Expired
            -> Notify Applicant
            -> End: Expired
       -> Message: ApplicantWithdrawn
            -> Cancel Payment Advice
            -> End: Withdrawn
```

Optional event subprocess:

```text
Event Subprocess: Late PaymentReceived
  -> Classify Late Payment
  -> Finance Review
```

But be careful: if process ended, event subprocess cannot catch. Late events after process completion must be handled by inbound event/reconciliation process.

### 28.3 Correlation Contract

```text
Message name: PaymentReceived
Correlation key: tenantId + "|PAYMENT|" + paymentAdviceNo
Event ID: providerEventId
Business key: applicationNo
TTL: PT1H or PT24H depending race tolerance
```

### 28.4 Inbound Event Status Flow

```text
RECEIVED
  -> VALIDATED
  -> CORRELATION_PENDING
  -> CORRELATED
```

Alternative:

```text
RECEIVED
  -> DUPLICATE
```

```text
RECEIVED
  -> VALIDATED
  -> UNMATCHED_PENDING
  -> CORRELATED after retry
```

```text
RECEIVED
  -> VALIDATED
  -> IGNORED_LATE
  -> Finance review case created
```

### 28.5 Java Flow

```java
@RestController
public class PaymentCallbackController {
    private final PaymentCallbackService service;

    @PostMapping("/callbacks/payment")
    public ResponseEntity<Void> receive(@RequestBody PaymentGatewayPayload payload,
                                        @RequestHeader("X-Signature") String signature) {
        service.receive(payload, signature);
        return ResponseEntity.accepted().build();
    }
}
```

```java
@Service
public class PaymentCallbackService {
    private final SignatureVerifier signatureVerifier;
    private final InboundEventRepository inboundEventRepository;
    private final PaymentEventNormalizer normalizer;

    @Transactional
    public void receive(PaymentGatewayPayload payload, String signature) {
        signatureVerifier.verify(payload, signature);

        CanonicalInboundEvent event = normalizer.normalize(payload);

        if (inboundEventRepository.existsBySourceAndEventId(event.sourceSystem(), event.eventId())) {
            return;
        }

        inboundEventRepository.insert(InboundEvent.received(event));
    }
}
```

```java
@Service
public class PaymentCorrelationJob {
    private final InboundEventRepository repository;
    private final ProcessMessageCorrelationRouter router;

    @Scheduled(fixedDelayString = "${workflow.correlation.delay-ms:5000}")
    public void correlatePendingEvents() {
        List<InboundEvent> events = repository.findPendingForCorrelation(100);

        for (InboundEvent event : events) {
            CorrelationResult result = router.correlate(event.toBusinessEvent());
            repository.updateCorrelationResult(event.id(), result);
        }
    }
}
```

### 28.6 Critical Invariants

```text
An external payment event is stored at most once by eventId.
A payment advice can be marked PAID at most once.
A late payment cannot silently reopen expired application.
A correlated event has an audit trail linking eventId, paymentAdviceNo, applicationNo, and processInstanceKey if available.
A duplicate callback is safe.
An unknown correlation result is retried, not blindly marked failed.
```

---

## 29. Worked Example: External Agency Response

### 29.1 Requirement

An application requires comments from another agency.

1. Workflow sends request to agency.
2. Agency may respond asynchronously.
3. Agency response may be:
   - approved;
   - rejected;
   - need clarification;
   - no response by SLA.
4. Officer can continue only after response or SLA escalation.

### 29.2 BPMN Shape

```text
Prepare Agency Request
  -> Send Agency Request
  -> Event-based Gateway
       -> Message: AgencyResponseReceived
            -> Evaluate Agency Response
            -> Continue Review
       -> Timer: Agency SLA Breached
            -> Escalate to Senior Officer
```

### 29.3 Correlation Key

Prefer:

```text
agencyRequestId
```

Not:

```text
applicationNo only
```

Why?

An application may have multiple agency requests:

```text
APP-001 -> REQUEST to AGENCY-A
APP-001 -> REQUEST to AGENCY-B
APP-001 -> REQUEST to AGENCY-A again after clarification
```

Better composite:

```text
CEA|AGENCY_RESPONSE|REQ-2026-000123
```

### 29.4 Handling Multiple Responses

If multiple agencies respond, use multi-instance or separate call activities.

```text
For each required agency:
  Send Agency Request
  Wait for Agency Response or SLA

After all required responses:
  Consolidate Recommendation
```

Be careful with fan-in:

- one agency late;
- one agency duplicate;
- one agency sends revised response;
- one agency response invalid;
- officer manually overrides missing response.

---

## 30. Message Event vs Signal Event

BPMN also has signal events. Do not confuse with message events.

Simplified distinction:

| Aspect | Message | Signal |
|---|---|---|
| Target | specific recipient/process instance | broadcast-style |
| Correlation | usually correlation key | generally no per-instance correlation |
| Use case | payment for this application | global notification |
| Risk | wrong key | unintended many receivers |

For most enterprise case/payment/document flows, use message, not signal.

Signal can be useful for broad system events, but dangerous if you accidentally wake many process instances.

---

## 31. Message Event vs Service Task

Question:

> Should I call external service via service task, or wait for message?

Use service task when:

- workflow actively commands something;
- response is immediate or bounded;
- worker owns the call;
- failure/retry belongs to workflow step.

Example:

```text
Service Task: Generate Payment Advice
```

Use message catch event when:

- external system responds later independently;
- process must wait;
- callback/event arrives asynchronously;
- timing is not controlled by worker;
- human/external party controls next step.

Example:

```text
Message Catch: PaymentReceived
```

Often you need both:

```text
Service Task: Send Agency Request
  -> Message Catch: AgencyResponseReceived
```

---

## 32. Message Event vs User Task

Use user task when process waits for a human action inside your task management boundary.

Use message event when process waits for an external system/event.

Bad design:

```text
User Task: Wait for Payment Gateway
```

Better:

```text
Message Catch: PaymentReceived
```

Bad design:

```text
Message Catch: Officer Approves Application
```

Better:

```text
User Task: Officer Review Application
```

Unless officer approval comes from another system and your workflow receives it as external event.

---

## 33. Message Correlation and Process Versioning

When BPMN model changes, running instances may still wait for old message names/keys.

Example:

V1 waits for:

```text
PaymentReceived
correlationKey = applicationNo
```

V2 waits for:

```text
PaymentConfirmed
correlationKey = paymentAdviceNo
```

Problem:

- old instances still need old message contract;
- event router must support both;
- external systems might send one format;
- migration must map correlation strategy.

Strategies:

1. Keep message name backward-compatible.
2. Version message name explicitly only when necessary:

```text
PaymentReceivedV2
```

3. Correlation router detects process version/context.
4. Run dual support during migration.
5. Do not rename message events casually.
6. Include process version in test cases.

---

## 34. Message Correlation and Multi-tenancy

If one Camunda cluster handles multiple tenants/agencies, correlation key must prevent cross-tenant matching.

Bad:

```text
correlationKey = APP-0001
```

If two tenants both have APP-0001, ambiguity.

Better:

```text
correlationKey = CEA|APPLICATION|APP-0001
correlationKey = ROM|APPLICATION|APP-0001
```

Also validate tenant:

```text
external event tenant must match process tenant
```

Do not rely only on key prefix if security requirement is strict. Use authorization and tenant-aware process instance design.

---

## 35. Message Correlation Anti-patterns

### 35.1 Using Mutable Status as Correlation Key

Bad:

```text
correlationKey = currentStatus
```

Status changes. It is not identity.

### 35.2 Using User-entered Free Text

Bad:

```text
correlationKey = applicantName
```

Names are not unique, can change, and may contain PII.

### 35.3 Direct External Payload to Process Variables

Bad:

```text
variables = rawProviderPayload
```

Problems:

- large payload;
- sensitive data;
- schema drift;
- expression fragility;
- audit noise.

### 35.4 No Inbound Event Store

Bad for serious systems:

```text
Webhook -> publish message -> done
```

If publish fails or no subscription exists, event may be lost operationally.

### 35.5 Treating Message Publish as Exactly-once

Distributed messaging is rarely exactly-once end-to-end. Design idempotency.

### 35.6 Correlation Logic Hidden in BPMN Expressions Only

If correlation key expression is buried in BPMN and app code uses different construction, mismatch happens.

Have shared contract/document/helper.

### 35.7 One Message Name for Everything

Bad:

```text
ExternalEventReceived
```

Then gateway/worker must inspect payload type everywhere.

Use meaningful message names.

### 35.8 Too Many Message Events for Internal Method Calls

Not every Java method callback is BPMN message. Message event should represent business-relevant asynchronous event.

### 35.9 Ignoring Late Events

Late events are normal. Define policy.

### 35.10 No Dashboard for Unmatched Events

If unmatched events are invisible, process stuck incidents become mystery debugging.

---

## 36. Design Checklist

Sebelum memakai message event, jawab pertanyaan berikut.

### 36.1 Business Semantics

- Event apa yang terjadi secara bisnis?
- Apakah event ini command, fact, callback, atau notification?
- Apakah process harus menunggu event ini?
- Apa yang terjadi jika event tidak pernah datang?
- Apa yang terjadi jika event datang terlambat?
- Apa yang terjadi jika event datang dobel?
- Apa yang terjadi jika event datang sebelum process menunggu?

### 36.2 Correlation

- Apa message name?
- Apa correlation key?
- Apakah key stabil?
- Apakah key unik dalam tenant?
- Apakah key diketahui external system?
- Apakah key tersedia saat subscription dibuat?
- Apakah ada composite key?
- Apakah ada canonical format?

### 36.3 Integration

- Event datang dari mana?
- Transport-nya REST, Kafka, RabbitMQ, file, scheduler, atau manual upload?
- Apakah event disimpan dulu?
- Bagaimana duplicate dideteksi?
- Bagaimana retry dilakukan?
- Bagaimana unmatched event dimonitor?

### 36.4 Security

- Apakah source authenticated?
- Apakah signature diverifikasi?
- Apakah replay dicegah?
- Apakah tenant divalidasi?
- Apakah payload difilter?
- Apakah rate limit diterapkan?

### 36.5 Operability

- Apa log fields wajib?
- Apa metric wajib?
- Apa dashboard untuk pending/unmatched/duplicate?
- Apa runbook manual repair?
- Apa status event table?
- Bagaimana reconciliation?

### 36.6 Testing

- Test wrong key?
- Test duplicate?
- Test early event?
- Test late event?
- Test no subscription?
- Test process timeout?
- Test schema version?
- Test Camunda publish timeout?
- Test broker redelivery?

---

## 37. Mental Model Top 1%

Engineer biasa berpikir:

```text
Saya butuh event, maka pakai Kafka atau RabbitMQ.
```

Engineer lebih matang berpikir:

```text
Event adalah fakta yang terjadi di domain.
Process instance mungkin perlu bereaksi terhadap fakta itu.
Agar reaksi benar, saya perlu correlation contract, idempotency, event storage, retry, stale/late policy, observability, dan repair path.
```

Engineer biasa berpikir:

```text
Kalau message publish sukses, proses lanjut.
```

Engineer matang berpikir:

```text
Publish message adalah distributed command dengan ambiguity. Saya perlu mengelola timeout, duplicate, no-match, unknown result, dan side-effect safety.
```

Engineer biasa berpikir:

```text
Correlation key bisa pakai application ID saja.
```

Engineer matang berpikir:

```text
Correlation key harus disesuaikan dengan event semantics. Payment event mungkin lebih tepat memakai paymentAdviceNo, agency response memakai agencyRequestId, document upload memakai documentRequestNo. ApplicationNo terlalu kasar untuk banyak event paralel.
```

Engineer biasa berpikir:

```text
Kalau event datang telat, ignore saja.
```

Engineer matang berpikir:

```text
Late event adalah business scenario. Harus ada policy, audit, dan mungkin compensation/manual review.
```

---

## 38. Ringkasan

Message correlation adalah inti dari event-driven workflow.

Yang harus diingat:

1. Message correlation mencocokkan external event ke process instance yang sedang menunggu.
2. Matching biasanya memakai message name dan correlation key.
3. Correlation key harus stabil, unik, tersedia, dan business-meaningful.
4. Message bisa datang terlalu cepat, terlalu lambat, dobel, stale, salah key, atau saat process sudah selesai.
5. Production-grade design membutuhkan inbound event table, deduplication, retry, reconciliation, observability, dan manual repair.
6. Kafka/RabbitMQ/REST callback sebaiknya tidak langsung dianggap sama dengan BPMN message event.
7. Workflow engine adalah coordinator proses, bukan pengganti event broker atau domain database.
8. Outbox/inbox pattern tetap relevan dalam workflow architecture.
9. Security dan replay protection wajib untuk inbound event.
10. Late/unmatched events harus terlihat secara operasional.

---

## 39. Latihan

### Latihan 1 — Payment Flow

Desain message correlation untuk flow berikut:

```text
Application Submitted
  -> Generate Payment Advice
  -> Wait for Payment
  -> Continue Review
```

Tentukan:

- message name;
- correlation key;
- event ID;
- TTL;
- duplicate handling;
- late payment policy;
- inbound event table status;
- dashboard metric.

### Latihan 2 — Multi-agency Response

Satu application butuh response dari 3 agency.

Tentukan:

- apakah pakai multi-instance;
- apakah correlation key memakai applicationNo atau agencyRequestId;
- bagaimana handle agency response duplicate;
- bagaimana handle satu agency timeout;
- bagaimana consolidate result.

### Latihan 3 — Applicant Withdrawal

Applicant bisa withdraw kapan saja selama review.

Tentukan:

- boundary message atau event subprocess;
- interrupting atau non-interrupting;
- apa yang terjadi jika review task sedang dikerjakan;
- apa yang terjadi jika payment sudah paid;
- compensation apa yang mungkin perlu.

### Latihan 4 — Event Router

Buat desain Java service untuk inbound event router yang menerima:

- `PaymentReceived`
- `DocumentUploaded`
- `AgencyResponseReceived`

Tentukan:

- interface;
- event normalizer;
- correlation key builder;
- repository;
- retry policy;
- error classification.

---

## 40. Referensi

- Camunda 8 Documentation — Messages Concepts.
- Camunda 8 Documentation — Message Events.
- Camunda 8 Documentation — Job Workers.
- Camunda Best Practices — Routing Events to Processes.
- Camunda Best Practices — Dealing with Problems and Exceptions.
- OMG BPMN 2.0.2 Specification.
- Enterprise Integration Patterns — Message, Correlation Identifier, Message Router, Idempotent Receiver.

---

## 41. Status Seri

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

Berikutnya:

- Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-bpmn-camunda-part-11-dmn-decision-engineering-separating-flow-from-decision-logic.md">⬅️ Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-bpmn-camunda-part-13-timers-sla-timeout-expiry-scheduled-process-behavior.md">Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior ➡️</a>
</div>
