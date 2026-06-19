# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-12.md

# Part 12 — Message Contract Design untuk Java Systems

> Seri: RabbitMQ, RabbitMQ Streams, dan Messaging Mastery untuk Java Engineers  
> Fokus part ini: mendesain **message contract** yang stabil, evolvable, aman, dapat diobservasi, dan dapat dipertanggungjawabkan di sistem produksi.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- mental model RabbitMQ modern;
- AMQP entity: exchange, queue, binding, routing key, channel;
- queue semantics: classic, quorum, stream;
- local lab;
- Java client tanpa Spring;
- publisher reliability;
- consumer reliability;
- retry, DLQ, parking lot;
- Spring AMQP dan Spring Boot integration.

Part ini naik satu level: **apa sebenarnya isi message yang aman untuk dikirim?**

Banyak sistem RabbitMQ gagal bukan karena exchange salah, queue salah, atau broker tidak reliable. Banyak sistem gagal karena message contract-nya buruk:

- payload terlalu mirip entity internal;
- metadata tidak cukup untuk tracing;
- schema berubah tanpa backward compatibility;
- consumer tidak tahu message ini command, event, atau job;
- tidak ada idempotency key;
- tidak ada correlation id;
- tidak ada schema version;
- retry menghasilkan side effect ganda;
- audit tidak bisa menjelaskan kenapa tindakan terjadi.

RabbitMQ hanya mengantarkan message. Yang membuat sistem bisa bertahan lama adalah **contract discipline**.

---

## 1. Core Thesis

Message bukan sekadar data.

Message adalah **boundary object** antar komponen yang mungkin:

- dibuat oleh service berbeda;
- dikonsumsi oleh tim berbeda;
- diproses dengan delay;
- diretry;
- diduplikasi;
- diproses oleh versi aplikasi berbeda;
- disimpan di DLQ;
- direplay dari stream;
- dipakai sebagai bukti audit;
- tetap hidup lebih lama daripada deployment yang membuatnya.

Karena itu message harus dirancang sebagai **contract**, bukan sebagai hasil serialisasi class Java internal.

Prinsip dasar:

```text
A message is not your object model.
A message is a durable interoperability contract.
```

---

## 2. Mental Model: Message = Envelope + Payload + Semantics

Message yang baik biasanya terdiri dari tiga lapisan:

```text
+-------------------------------------------------------+
| Transport Metadata                                    |
| - exchange, routing key, content-type, headers         |
+-------------------------------------------------------+
| Application Envelope                                  |
| - message_id, type, version, correlation_id, ...       |
+-------------------------------------------------------+
| Domain Payload                                        |
| - actual business fields                              |
+-------------------------------------------------------+
```

### 2.1 Transport Metadata

Ini metadata RabbitMQ/AMQP:

- routing key;
- exchange;
- content type;
- headers;
- delivery mode;
- message id;
- correlation id;
- reply-to;
- timestamp.

Transport metadata membantu broker dan client library.

Tetapi jangan taruh semua makna bisnis hanya di AMQP headers. Kenapa?

Karena message bisa:

- disalin ke database outbox;
- disimpan sebagai file;
- diproses ulang dari DLQ;
- ditransfer antar sistem;
- dibaca oleh tool non-AMQP;
- direplay dari RabbitMQ Streams;
- dipindahkan ke platform lain.

Metadata penting sebaiknya ada juga di application envelope.

### 2.2 Application Envelope

Envelope adalah struktur standar yang membungkus payload.

Contoh:

```json
{
  "messageId": "01HZT4A4R4WYYP5Q4SE57ZK6AF",
  "messageType": "evidence.submitted.v1",
  "schemaVersion": 1,
  "producer": "case-service",
  "occurredAt": "2026-06-19T08:15:30.123Z",
  "publishedAt": "2026-06-19T08:15:31.010Z",
  "correlationId": "corr-9f2451",
  "causationId": "cmd-77a90c",
  "tenantId": "regulator-id",
  "subject": {
    "type": "case",
    "id": "CASE-2026-000123"
  },
  "payload": {
    "caseId": "CASE-2026-000123",
    "evidenceId": "EV-8821",
    "submittedBy": "officer-17",
    "evidenceType": "DOCUMENT",
    "classification": "CONFIDENTIAL"
  }
}
```

Envelope memberi sistem kemampuan menjawab:

- message apa ini?
- dibuat oleh siapa?
- kapan kejadian bisnis terjadi?
- kapan dipublish?
- ini terkait request/flow mana?
- ini disebabkan oleh message/command apa?
- entity bisnis apa yang menjadi subjek?
- tenant/regulatory unit mana yang relevan?
- schema apa yang dipakai?

### 2.3 Domain Payload

Payload adalah data bisnis minimum yang consumer butuhkan.

Payload buruk:

```json
{
  "id": 123,
  "status": "SUBMITTED",
  "user": {
    "id": 17,
    "name": "John",
    "passwordHash": "..."
  },
  "hibernateLazyInitializer": {}
}
```

Payload baik:

```json
{
  "caseId": "CASE-2026-000123",
  "evidenceId": "EV-8821",
  "submittedByOfficerId": "officer-17",
  "evidenceType": "DOCUMENT",
  "classification": "CONFIDENTIAL"
}
```

Payload baik:

- eksplisit;
- minimal;
- tidak bocor internal model;
- stabil;
- tidak membawa data sensitif yang tidak perlu;
- bisa dipahami oleh consumer tanpa akses database producer.

---

## 3. Message Category: Command, Event, Job, Notification, Query, Reply

Sebelum mendesain field, tentukan dulu jenis message.

Banyak sistem kacau karena semua message disebut “event”, padahal sebagian adalah command, job, atau notification.

---

## 4. Command Message

Command adalah instruksi agar penerima melakukan sesuatu.

Contoh:

```text
EvaluateRuleCommand
AssignReviewCommand
GenerateNoticeCommand
EscalateCaseCommand
```

Karakteristik command:

- imperative;
- punya target consumer yang relatif jelas;
- biasanya dikirim ke command queue;
- consumer boleh menolak jika tidak valid;
- harus idempotent;
- sering punya timeout/SLA;
- failure perlu ditangani eksplisit.

Contoh command envelope:

```json
{
  "messageId": "cmd-01",
  "messageType": "case.review.assign.command.v1",
  "schemaVersion": 1,
  "producer": "case-orchestrator",
  "createdAt": "2026-06-19T08:00:00Z",
  "correlationId": "corr-case-123",
  "idempotencyKey": "assign-review:CASE-2026-000123:stage-2",
  "payload": {
    "caseId": "CASE-2026-000123",
    "reviewStage": "LEGAL_REVIEW",
    "assigneeGroup": "legal-reviewers",
    "reason": "RULE_THRESHOLD_EXCEEDED"
  }
}
```

Command naming rule:

```text
<domain>.<action>.command.v<version>
```

Examples:

```text
case.review.assign.command.v1
evidence.virus-scan.request.command.v1
notice.generate.command.v1
```

### Command Design Invariant

A command should describe **what should be done**, not how the consumer implementation works.

Bad:

```text
InsertReviewRowCommand
CallPdfServiceCommand
RunMethodXCommand
```

Better:

```text
AssignCaseReviewCommand
GenerateEnforcementNoticeCommand
```

---

## 5. Event Message

Event adalah fakta bahwa sesuatu sudah terjadi.

Contoh:

```text
CaseOpened
EvidenceSubmitted
RuleEvaluationCompleted
NoticeGenerated
ReviewAssigned
```

Karakteristik event:

- past tense;
- producer tidak tahu semua consumer;
- cocok untuk fanout/topic exchange;
- tidak memerintah consumer;
- bisa dipakai untuk projection, audit, notification, integration;
- sering lebih tahan terhadap perubahan consumer.

Contoh event:

```json
{
  "messageId": "evt-01HZT6ED2M...",
  "messageType": "evidence.submitted.event.v1",
  "schemaVersion": 1,
  "producer": "evidence-service",
  "occurredAt": "2026-06-19T08:15:30Z",
  "publishedAt": "2026-06-19T08:15:31Z",
  "correlationId": "corr-case-123",
  "causationId": "cmd-upload-45",
  "payload": {
    "caseId": "CASE-2026-000123",
    "evidenceId": "EV-8821",
    "submittedByOfficerId": "officer-17",
    "evidenceType": "DOCUMENT",
    "classification": "CONFIDENTIAL"
  }
}
```

Event naming rule:

```text
<domain>.<thing-that-happened>.event.v<version>
```

Examples:

```text
case.opened.event.v1
evidence.submitted.event.v1
review.assigned.event.v1
notice.generated.event.v1
```

### Event Design Invariant

An event should say:

```text
This happened.
```

Not:

```text
Please do this next.
```

If the consumer must perform a mandatory next step, consider a command or orchestrated workflow.

---

## 6. Job Message

Job adalah unit work teknis.

Contoh:

```text
GeneratePdfJob
ResizeImageJob
SendEmailJob
IndexDocumentJob
```

Karakteristik job:

- work distribution;
- consumer pool;
- retry common;
- ordering biasanya tidak penting;
- idempotency tetap penting;
- payload sering berisi reference, bukan full data.

Contoh:

```json
{
  "messageId": "job-01",
  "messageType": "document.index.job.v1",
  "schemaVersion": 1,
  "producer": "document-service",
  "createdAt": "2026-06-19T08:20:00Z",
  "idempotencyKey": "index-document:EV-8821:v3",
  "payload": {
    "documentId": "EV-8821",
    "sourceUri": "s3://bucket/evidence/EV-8821.pdf",
    "indexVersion": 3
  }
}
```

Job biasanya cocok dengan quorum queue atau classic queue tergantung criticality.

---

## 7. Notification Message

Notification adalah pemberitahuan agar pihak lain tahu, bukan sumber fakta utama.

Contoh:

```text
SendOfficerEmailNotification
SendWebhookNotification
SendSmsNotification
```

Perbedaannya dengan event:

- event adalah fakta domain;
- notification adalah instruksi komunikasi.

Bad:

```text
CaseOpened event langsung dipakai sebagai email body lengkap.
```

Better:

```text
CaseOpenedEvent -> Notification service decides -> SendOfficerEmailCommand
```

Dengan cara ini domain event tidak tercemar oleh detail channel notifikasi.

---

## 8. Reply Message

Reply digunakan dalam request/reply atau RPC-like pattern.

Contoh:

```json
{
  "messageId": "reply-01",
  "messageType": "rule.evaluation.result.reply.v1",
  "schemaVersion": 1,
  "producer": "rule-engine",
  "correlationId": "corr-rule-eval-778",
  "causationId": "cmd-rule-eval-778",
  "payload": {
    "caseId": "CASE-2026-000123",
    "result": "THRESHOLD_EXCEEDED",
    "matchedRules": ["RISK_SCORE_HIGH", "MISSING_DISCLOSURE"]
  }
}
```

Reply harus selalu punya:

- correlation id;
- causation id;
- status/result;
- explicit error model;
- timeout handling di caller.

RPC over RabbitMQ akan dibahas lebih dalam di part 14.

---

## 9. Envelope Field Standard

Rekomendasi baseline envelope untuk sistem Java serius:

```json
{
  "messageId": "string",
  "messageType": "string",
  "schemaVersion": 1,
  "producer": "string",
  "occurredAt": "ISO-8601 instant",
  "publishedAt": "ISO-8601 instant",
  "correlationId": "string",
  "causationId": "string",
  "idempotencyKey": "string",
  "tenantId": "string|null",
  "subject": {
    "type": "string",
    "id": "string"
  },
  "payload": {}
}
```

Tidak semua field wajib untuk semua use case, tapi field berikut hampir selalu penting.

---

## 10. `messageId`

`messageId` adalah identitas unik message instance.

Gunanya:

- deduplication;
- logging;
- tracing;
- audit;
- DLQ investigation;
- retry tracking;
- idempotent processing.

Gunakan ID yang:

- globally unique;
- string-based;
- tidak bergantung database auto-increment;
- aman ditulis di log;
- bisa dibuat sebelum publish.

Pilihan umum:

- UUID v4;
- UUID v7;
- ULID;
- KSUID.

Contoh Java:

```java
String messageId = UUID.randomUUID().toString();
```

Untuk sistem high-volume yang butuh sortability, UUIDv7/ULID sering lebih nyaman, tetapi jangan jadikan ini bottleneck desain awal.

### Invariant

```text
Every published message must have a stable messageId before it is sent.
```

Jangan generate ulang message id saat retry publish untuk message logical yang sama, kecuali memang membuat message baru.

---

## 11. `messageType`

`messageType` menjelaskan jenis message.

Contoh:

```text
case.opened.event.v1
case.review.assign.command.v1
document.index.job.v1
rule.evaluation.result.reply.v1
```

Message type sebaiknya:

- stable;
- human-readable;
- versioned;
- tidak bergantung package Java;
- tidak bergantung class name internal;
- bisa dipakai untuk routing, validation, deserialization.

Bad:

```text
com.company.case.domain.CaseOpenedEvent
```

Better:

```text
case.opened.event.v1
```

Class Java boleh berubah. Contract tidak boleh ikut berubah tanpa kontrol.

---

## 12. `schemaVersion`

`schemaVersion` membantu consumer memahami bentuk payload.

Ada dua pendekatan:

### 12.1 Version in Type

```text
case.opened.event.v1
```

### 12.2 Version as Field

```json
{
  "messageType": "case.opened.event",
  "schemaVersion": 1
}
```

Praktik yang sering nyaman: pakai dua-duanya dengan disiplin.

```json
{
  "messageType": "case.opened.event.v1",
  "schemaVersion": 1
}
```

Ini memang redundant, tapi membantu debugging dan routing.

### Versioning Rule

Naikkan major version jika perubahan breaking.

Contoh breaking:

- remove field yang dipakai consumer;
- ubah meaning field;
- ubah type field;
- ubah enum semantics;
- payload pindah struktur besar-besaran.

Tidak perlu version baru untuk:

- tambah optional field;
- tambah enum value jika consumer tolerant;
- tambah metadata non-breaking.

---

## 13. `producer`

`producer` menjawab siapa yang menerbitkan message.

Contoh:

```json
"producer": "case-service"
```

Jangan isi dengan hostname/container id sebagai producer utama.

Hostname bisa jadi header tambahan, tapi `producer` sebaiknya logical service name.

Gunanya:

- ownership;
- debugging;
- incident triage;
- audit;
- schema responsibility;
- consumer trust model.

---

## 14. `occurredAt` vs `publishedAt`

Ini sering diabaikan.

`occurredAt` = kapan kejadian bisnis terjadi.  
`publishedAt` = kapan message dikirim ke broker.

Contoh:

```json
{
  "occurredAt": "2026-06-19T08:15:30Z",
  "publishedAt": "2026-06-19T08:16:05Z"
}
```

Kenapa penting?

Karena dengan outbox pattern, publish bisa terjadi setelah database commit.

Event bisa terjadi pukul 08:15:30, tapi baru dipublish pukul 08:16:05 karena relay delay.

Untuk audit dan regulatory system, perbedaan ini sangat penting.

### Invariant

```text
Business ordering should usually reason from occurredAt.
Transport latency should reason from publishedAt.
```

---

## 15. `correlationId`

`correlationId` menghubungkan banyak message dalam satu flow.

Contoh flow:

```text
HTTP request: submit evidence
  -> EvidenceSubmittedEvent
  -> VirusScanCommand
  -> VirusScanCompletedEvent
  -> RuleEvaluationCommand
  -> RuleEvaluationCompletedEvent
  -> CaseEscalatedEvent
```

Semua bisa punya correlation id yang sama:

```text
corr-CASE-2026-000123-upload-8821
```

Gunanya:

- tracing end-to-end;
- log search;
- incident analysis;
- audit trail;
- measuring business process latency.

Correlation id biasanya berasal dari:

- HTTP request id;
- workflow id;
- case id + operation id;
- generated trace id.

### Invariant

```text
Do not create a new correlation id at every service boundary unless starting a new independent flow.
```

---

## 16. `causationId`

`causationId` menjawab: message ini disebabkan oleh apa?

Contoh:

```text
Command A -> Event B -> Command C -> Event D
```

- Event B causationId = Command A messageId
- Command C causationId = Event B messageId
- Event D causationId = Command C messageId

Ini membentuk causal chain.

Perbedaannya:

```text
correlationId = same across flow
causationId  = direct parent message/request
messageId    = this message identity
```

Diagram:

```text
messageId=cmd-1, correlationId=corr-9, causationId=http-1
   |
   v
messageId=evt-2, correlationId=corr-9, causationId=cmd-1
   |
   v
messageId=cmd-3, correlationId=corr-9, causationId=evt-2
```

Untuk sistem enforcement lifecycle, causation id membantu menjawab:

```text
Kenapa case ini dieskalasi?
Karena RuleEvaluationCompletedEvent X.
Kenapa rule evaluation terjadi?
Karena EvidenceSubmittedEvent Y.
Kenapa evidence submitted?
Karena HTTP command/request Z.
```

---

## 17. `idempotencyKey`

`idempotencyKey` adalah identitas operasi bisnis, bukan sekadar message instance.

Perbedaan:

```text
messageId       = physical/logical message identity
idempotencyKey  = business operation identity
```

Contoh:

```json
{
  "messageId": "evt-abc",
  "idempotencyKey": "assign-review:CASE-2026-000123:LEGAL_REVIEW"
}
```

Jika message yang sama dipublish ulang dengan message id berbeda, idempotency key tetap bisa mencegah double effect.

Gunanya:

- mencegah double insert;
- mencegah double email;
- mencegah double notification;
- mencegah double escalation;
- membuat retry aman.

### Idempotency Key Design

Key harus:

- deterministic;
- berbasis operasi bisnis;
- cukup spesifik;
- tidak terlalu global;
- tidak mengandung data sensitif.

Bad:

```text
caseId
```

Terlalu luas. Satu case punya banyak operasi.

Better:

```text
assign-review:CASE-2026-000123:LEGAL_REVIEW:v1
```

Bad:

```text
random UUID baru setiap retry
```

Itu tidak membantu idempotency.

---

## 18. `tenantId`

Jika sistem multi-tenant atau multi-regulator, tenant/context harus eksplisit.

Contoh:

```json
"tenantId": "financial-conduct-authority"
```

Gunanya:

- authorization;
- routing;
- audit;
- data residency;
- metrics per tenant;
- incident blast radius.

Jangan hanya mengandalkan routing key untuk tenant.

Routing key bisa hilang saat message masuk DLQ, file export, replay, atau manual processing.

---

## 19. `subject`

`subject` adalah entity utama yang dibicarakan message.

Contoh:

```json
"subject": {
  "type": "case",
  "id": "CASE-2026-000123"
}
```

Gunanya:

- generic indexing;
- message search;
- audit timeline;
- dead-letter analysis;
- human operator tooling;
- replay targeting.

Tidak semua consumer perlu memahami seluruh payload untuk tahu message ini terkait entity apa.

---

## 20. Payload Design Principles

### 20.1 Payload harus membawa data yang cukup

Consumer tidak selalu boleh query database producer.

Bad event:

```json
{
  "caseId": "CASE-123"
}
```

Jika semua consumer harus call case-service untuk tahu detail, event menjadi distributed join trigger.

Better:

```json
{
  "caseId": "CASE-123",
  "caseType": "MARKET_ABUSE",
  "openedAt": "2026-06-19T08:00:00Z",
  "priority": "HIGH",
  "jurisdiction": "ID"
}
```

Tapi jangan overcorrect.

### 20.2 Payload jangan membawa semua data

Bad:

```json
{
  "case": {
    "allFields": "...",
    "allDocuments": [],
    "allNotes": [],
    "allUsers": []
  }
}
```

Masalah:

- message terlalu besar;
- data sensitif bocor;
- coupling tinggi;
- schema sulit berubah;
- broker jadi storage dump;
- DLQ menyimpan data berlebih.

### 20.3 Kirim snapshot atau delta secara sadar

Ada dua style event:

#### Delta Event

```json
{
  "caseId": "CASE-123",
  "changedField": "priority",
  "oldValue": "MEDIUM",
  "newValue": "HIGH"
}
```

#### Snapshot Event

```json
{
  "caseId": "CASE-123",
  "priority": "HIGH",
  "status": "UNDER_REVIEW",
  "riskScore": 87
}
```

Delta cocok untuk audit perubahan spesifik.

Snapshot cocok untuk projection consumer yang ingin state terbaru.

Kadang event berisi keduanya:

```json
{
  "caseId": "CASE-123",
  "changed": {
    "priority": {
      "from": "MEDIUM",
      "to": "HIGH"
    }
  },
  "current": {
    "priority": "HIGH",
    "status": "UNDER_REVIEW"
  }
}
```

Tapi jangan otomatis. Ukur kebutuhan.

---

## 21. Jangan Publish JPA Entity

Ini salah satu anti-pattern paling mahal.

Bad:

```java
rabbitTemplate.convertAndSend("case.events", "case.opened", caseEntity);
```

Masalah:

- field internal bocor;
- lazy loading problem;
- bidirectional relationship bisa infinite serialization;
- schema berubah saat refactor database;
- consumer coupling ke model internal producer;
- data sensitif ikut terkirim;
- migration database menjadi breaking message change;
- auditing sulit karena payload tidak intentional.

Better:

```java
public record CaseOpenedPayload(
    String caseId,
    String caseType,
    String jurisdiction,
    Instant openedAt,
    String openedByOfficerId
) {}
```

Mapping eksplisit:

```java
CaseOpenedPayload payload = new CaseOpenedPayload(
    caseEntity.getPublicId(),
    caseEntity.getType().name(),
    caseEntity.getJurisdiction(),
    caseEntity.getOpenedAt(),
    caseEntity.getOpenedByOfficerId()
);
```

Message contract harus intentional.

---

## 22. Java Record sebagai DTO Contract

Java record cocok untuk immutable message DTO.

Contoh envelope generic:

```java
import java.time.Instant;

public record MessageEnvelope<T>(
    String messageId,
    String messageType,
    int schemaVersion,
    String producer,
    Instant occurredAt,
    Instant publishedAt,
    String correlationId,
    String causationId,
    String idempotencyKey,
    String tenantId,
    MessageSubject subject,
    T payload
) {}

public record MessageSubject(
    String type,
    String id
) {}
```

Payload:

```java
public record EvidenceSubmittedPayload(
    String caseId,
    String evidenceId,
    String submittedByOfficerId,
    String evidenceType,
    String classification
) {}
```

Builder/factory:

```java
public final class EvidenceMessages {

    private EvidenceMessages() {}

    public static MessageEnvelope<EvidenceSubmittedPayload> evidenceSubmitted(
            String messageId,
            String correlationId,
            String causationId,
            String tenantId,
            EvidenceSubmittedPayload payload,
            Instant occurredAt,
            Instant publishedAt
    ) {
        return new MessageEnvelope<>(
                messageId,
                "evidence.submitted.event.v1",
                1,
                "evidence-service",
                occurredAt,
                publishedAt,
                correlationId,
                causationId,
                "evidence-submitted:" + payload.evidenceId(),
                tenantId,
                new MessageSubject("case", payload.caseId()),
                payload
        );
    }
}
```

Factory membantu menjaga invariant.

---

## 23. Content Type and Serialization

Untuk JSON:

```text
content_type = application/json
```

Tambahkan juga message type:

```text
type = evidence.submitted.event.v1
```

Atau header:

```text
x-message-type = evidence.submitted.event.v1
x-schema-version = 1
```

AMQP properties Java:

```java
AMQP.BasicProperties props = new AMQP.BasicProperties.Builder()
        .contentType("application/json")
        .deliveryMode(2)
        .messageId(envelope.messageId())
        .correlationId(envelope.correlationId())
        .type(envelope.messageType())
        .timestamp(Date.from(envelope.publishedAt()))
        .headers(Map.of(
                "x-schema-version", envelope.schemaVersion(),
                "x-producer", envelope.producer(),
                "x-tenant-id", envelope.tenantId()
        ))
        .build();
```

Do not rely only on Java class type headers from framework-specific serializers.

Spring’s default type mapping can leak class names if configured carelessly.

Prefer explicit message type headers and explicit deserialization mapping.

---

## 24. JSON vs Avro vs Protobuf

RabbitMQ tidak memaksa format payload.

### 24.1 JSON

Pros:

- human-readable;
- easy debugging;
- easy DLQ inspection;
- simple tooling;
- cocok untuk banyak enterprise systems.

Cons:

- schema not enforced by default;
- type ambiguity;
- payload lebih besar;
- compatibility discipline manual.

JSON cocok untuk:

- moderate throughput;
- business workflows;
- regulatory systems;
- integration boundaries;
- teams yang butuh inspectability.

### 24.2 Avro

Pros:

- schema-first;
- compact binary;
- good evolution model;
- popular di data platform.

Cons:

- schema registry biasanya perlu;
- debugging kurang langsung;
- lebih kompleks.

Cocok untuk:

- high-throughput event pipeline;
- analytics integration;
- systems already using Avro.

### 24.3 Protobuf

Pros:

- compact;
- strongly typed;
- cross-language;
- good backward compatibility if used correctly.

Cons:

- less human-readable;
- field number discipline;
- JSON mapping nuances;
- unknown fields and default semantics perlu dipahami.

Cocok untuk:

- polyglot systems;
- strict contracts;
- high-performance internal platforms.

### 24.4 Practical Recommendation

Untuk seri ini, baseline kita pakai JSON agar mudah dipelajari dan dioperasikan.

Tapi mental model contract-nya tetap berlaku untuk Avro/Protobuf.

---

## 25. Schema Evolution Rules

Schema evolution adalah kemampuan mengubah message tanpa mematikan consumer lama.

### 25.1 Additive Change

Aman jika field baru optional.

V1:

```json
{
  "caseId": "CASE-123",
  "priority": "HIGH"
}
```

V1 dengan field tambahan:

```json
{
  "caseId": "CASE-123",
  "priority": "HIGH",
  "riskScore": 87
}
```

Consumer lama harus ignore unknown field.

Jackson config:

```java
objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
```

Tetapi hati-hati. Ini bukan alasan untuk sembarang tambah field tanpa dokumentasi.

### 25.2 Removing Field

Breaking jika consumer lama butuh field itu.

Jangan remove langsung.

Migration:

1. Tambah field baru.
2. Producer isi field lama dan baru.
3. Consumer migrate ke field baru.
4. Monitor.
5. Baru remove di version baru.

### 25.3 Renaming Field

Renaming = remove old + add new.

Itu breaking jika tidak ada compatibility window.

Better:

```json
{
  "officerId": "officer-17",
  "submittedByOfficerId": "officer-17"
}
```

Sementara dua field hidup bersama.

### 25.4 Changing Type

Breaking.

Bad:

```json
"riskScore": "87"
```

menjadi:

```json
"riskScore": 87
```

Consumer strict bisa gagal.

Buat field baru:

```json
"riskScoreValue": 87
```

atau version baru.

### 25.5 Enum Evolution

Enum sangat tricky.

Producer menambah enum value baru:

```text
LOW, MEDIUM, HIGH, CRITICAL
```

Consumer lama mungkin hanya tahu:

```text
LOW, MEDIUM, HIGH
```

Consumer harus punya unknown handling:

```java
public enum Priority {
    LOW,
    MEDIUM,
    HIGH,
    UNKNOWN
}
```

Atau treat unknown sebagai failure yang masuk DLQ jika memang tidak aman.

---

## 26. Compatibility Modes

Ada tiga model compatibility:

### 26.1 Backward Compatible

Consumer baru bisa membaca message lama.

Penting untuk replay/DLQ lama.

### 26.2 Forward Compatible

Consumer lama bisa membaca message baru.

Penting saat producer deploy duluan.

### 26.3 Full Compatible

Consumer lama dan baru bisa membaca producer lama dan baru.

Ini paling aman untuk distributed deployments.

Practical target untuk RabbitMQ business systems:

```text
Aim for full compatibility within a rolling deployment window.
Aim for backward compatibility for as long as messages may be retained/replayed.
```

---

## 27. Contract Testing

Message contract harus dites.

Unit test saja tidak cukup.

### 27.1 Producer Contract Test

Producer harus membuktikan message yang dihasilkan sesuai schema.

```java
@Test
void producesEvidenceSubmittedV1Contract() throws Exception {
    var payload = new EvidenceSubmittedPayload(
            "CASE-123",
            "EV-001",
            "officer-17",
            "DOCUMENT",
            "CONFIDENTIAL"
    );

    var envelope = EvidenceMessages.evidenceSubmitted(
            "msg-1",
            "corr-1",
            "cmd-1",
            "tenant-1",
            payload,
            Instant.parse("2026-06-19T08:00:00Z"),
            Instant.parse("2026-06-19T08:00:01Z")
    );

    String json = objectMapper.writeValueAsString(envelope);

    assertThat(json).contains("evidence.submitted.event.v1");
    assertThat(json).contains("CASE-123");
}
```

Better with JSON Schema validation.

### 27.2 Consumer Contract Test

Consumer harus bisa membaca sample messages.

```java
@Test
void consumesEvidenceSubmittedV1WithUnknownField() throws Exception {
    String json = """
        {
          "messageId": "msg-1",
          "messageType": "evidence.submitted.event.v1",
          "schemaVersion": 1,
          "producer": "evidence-service",
          "occurredAt": "2026-06-19T08:00:00Z",
          "publishedAt": "2026-06-19T08:00:01Z",
          "correlationId": "corr-1",
          "causationId": "cmd-1",
          "idempotencyKey": "evidence-submitted:EV-001",
          "tenantId": "tenant-1",
          "subject": {"type": "case", "id": "CASE-123"},
          "payload": {
            "caseId": "CASE-123",
            "evidenceId": "EV-001",
            "submittedByOfficerId": "officer-17",
            "evidenceType": "DOCUMENT",
            "classification": "CONFIDENTIAL",
            "futureField": "should not break old consumer"
          }
        }
        """;

    var envelope = mapper.readEvidenceSubmitted(json);

    assertThat(envelope.payload().caseId()).isEqualTo("CASE-123");
}
```

### 27.3 Golden Samples

Simpan sample message di repo:

```text
src/test/resources/contracts/evidence.submitted.event.v1.valid.json
src/test/resources/contracts/evidence.submitted.event.v1.with-extra-field.json
src/test/resources/contracts/evidence.submitted.event.v1.minimal.json
```

Golden samples membantu review kontrak secara eksplisit.

---

## 28. JSON Schema Example

Contoh schema sederhana:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://contracts.example.com/evidence.submitted.event.v1.schema.json",
  "type": "object",
  "required": [
    "messageId",
    "messageType",
    "schemaVersion",
    "producer",
    "occurredAt",
    "publishedAt",
    "correlationId",
    "causationId",
    "idempotencyKey",
    "subject",
    "payload"
  ],
  "properties": {
    "messageId": {"type": "string", "minLength": 1},
    "messageType": {"const": "evidence.submitted.event.v1"},
    "schemaVersion": {"const": 1},
    "producer": {"const": "evidence-service"},
    "occurredAt": {"type": "string", "format": "date-time"},
    "publishedAt": {"type": "string", "format": "date-time"},
    "correlationId": {"type": "string"},
    "causationId": {"type": "string"},
    "idempotencyKey": {"type": "string"},
    "tenantId": {"type": ["string", "null"]},
    "subject": {
      "type": "object",
      "required": ["type", "id"],
      "properties": {
        "type": {"const": "case"},
        "id": {"type": "string"}
      }
    },
    "payload": {
      "type": "object",
      "required": [
        "caseId",
        "evidenceId",
        "submittedByOfficerId",
        "evidenceType",
        "classification"
      ],
      "properties": {
        "caseId": {"type": "string"},
        "evidenceId": {"type": "string"},
        "submittedByOfficerId": {"type": "string"},
        "evidenceType": {"type": "string"},
        "classification": {"type": "string"}
      },
      "additionalProperties": true
    }
  },
  "additionalProperties": true
}
```

Note:

- `additionalProperties: true` membantu forward compatibility.
- Untuk internal strict boundary, kamu bisa lebih ketat, tapi distributed systems biasanya butuh toleransi.

---

## 29. Consumer Deserialization Strategy

Consumer tidak boleh blindly deserialize berdasarkan class header dari producer.

Bad:

```java
@RabbitListener(queues = "evidence.events")
public void handle(EvidenceSubmittedEvent event) {
    ...
}
```

Ini bisa acceptable di sistem kecil, tetapi untuk platform besar sebaiknya explicit.

Better:

```java
public void handleRawMessage(byte[] body, MessageProperties props) {
    String messageType = props.getType();

    switch (messageType) {
        case "evidence.submitted.event.v1" -> handleEvidenceSubmitted(body, props);
        default -> throw new UnsupportedMessageTypeException(messageType);
    }
}
```

Atau dengan registry:

```java
public interface MessageHandler<T> {
    String messageType();
    Class<T> payloadType();
    void handle(MessageEnvelope<T> envelope);
}
```

Registry:

```java
public final class MessageHandlerRegistry {
    private final Map<String, MessageHandler<?>> handlers;

    public MessageHandlerRegistry(List<MessageHandler<?>> handlerList) {
        this.handlers = handlerList.stream()
                .collect(Collectors.toUnmodifiableMap(
                        MessageHandler::messageType,
                        Function.identity()
                ));
    }

    public MessageHandler<?> get(String messageType) {
        MessageHandler<?> handler = handlers.get(messageType);
        if (handler == null) {
            throw new UnsupportedMessageTypeException(messageType);
        }
        return handler;
    }
}
```

---

## 30. Validation Boundary

Validation harus dilakukan sebelum side effect.

Consumer pipeline:

```text
receive delivery
  -> parse envelope
  -> validate message type
  -> validate schema version
  -> validate required metadata
  -> validate payload
  -> check idempotency
  -> execute business logic
  -> commit DB
  -> ack
```

Jangan ack sebelum validation dan side effect selesai.

Jangan juga retry message yang invalid secara permanen.

Decision:

```text
Invalid schema -> reject to DLQ / parking lot
Unknown message type -> reject to DLQ / parking lot
Transient dependency failure -> delayed retry
Duplicate idempotency key -> ack safely
Business rule conflict -> domain-specific decision
```

---

## 31. Error Model in Message Contracts

Untuk reply/result message, error harus eksplisit.

Bad:

```json
{
  "success": false,
  "message": "failed"
}
```

Better:

```json
{
  "status": "FAILED",
  "error": {
    "code": "RULE_INPUT_INVALID",
    "category": "PERMANENT",
    "message": "Required field jurisdiction is missing",
    "retryable": false
  }
}
```

Error category:

```text
TRANSIENT
PERMANENT
CONFLICT
UNAUTHORIZED
TIMEOUT
UNKNOWN
```

Do not expose stack traces in messages.

For internal DLQ diagnostic metadata, store stack traces in logs/observability, not necessarily in business message payload.

---

## 32. Sensitive Data and Privacy

RabbitMQ messages often live in:

- queues;
- DLQs;
- logs;
- traces;
- management UI;
- backups;
- exported definitions;
- replay pipelines.

Therefore message contract must follow data minimization.

Avoid sending:

- password hash;
- access token;
- session token;
- full document content;
- unnecessary PII;
- unnecessary financial details;
- internal authorization grants;
- secrets;
- raw stack trace with sensitive inputs.

Prefer references:

```json
{
  "documentId": "EV-8821",
  "documentUri": "secure-object-store://evidence/EV-8821",
  "classification": "CONFIDENTIAL"
}
```

But references need access control.

Consumer should not be able to fetch data it is not authorized to access.

---

## 33. Message Size Policy

RabbitMQ can move messages, but that does not mean messages should be large.

Large messages cause:

- broker memory pressure;
- disk pressure;
- slow replication;
- slow redelivery;
- DLQ bloat;
- management UI pain;
- network congestion;
- longer recovery.

Rule of thumb:

```text
Messages should describe work or facts, not carry bulk files.
```

For documents/images/reports:

- store object in blob/object storage;
- send reference + checksum + metadata;
- consumer fetches when authorized.

Example:

```json
{
  "evidenceId": "EV-8821",
  "objectRef": "evidence/2026/06/EV-8821.pdf",
  "sha256": "...",
  "contentType": "application/pdf",
  "sizeBytes": 812344,
  "classification": "CONFIDENTIAL"
}
```

---

## 34. Routing Key vs Message Type vs Event Name

These are related but not identical.

```text
messageType = exact contract identity
routingKey  = broker routing taxonomy
eventName   = domain concept/name
```

Example:

```json
{
  "messageType": "evidence.submitted.event.v1"
}
```

AMQP routing key:

```text
reg.case.evidence.submitted
```

They can be the same, but do not have to be.

### When Same Is Fine

Small system:

```text
routing key = evidence.submitted.event.v1
messageType = evidence.submitted.event.v1
```

### When Different Is Better

Large system:

```text
routing key = reg.case.evidence.submitted
messageType = evidence.submitted.event.v1
```

Why?

- routing key optimized for exchange binding;
- message type optimized for deserialization/contract;
- routing taxonomy may group multiple versions;
- message type may be more exact.

Example binding:

```text
reg.case.evidence.*
```

This can receive v1/v2 message types if routing key is versionless.

But be careful: consumer must know which message type it can handle.

---

## 35. Version in Routing Key: Usually Avoid

Bad default:

```text
case.opened.v1
case.opened.v2
```

This forces binding changes for every schema version.

Better default:

```text
case.opened
```

and put version in `messageType`/`schemaVersion`.

Exception: if v2 is semantically incompatible and should route to different consumers, version in routing key can be justified.

---

## 36. Contract Registry Without Heavy Platform

You do not always need a full schema registry.

A lightweight contract repository can be enough:

```text
messaging-contracts/
  evidence/
    evidence.submitted.event.v1.schema.json
    evidence.submitted.event.v1.example.json
    README.md
  case/
    case.opened.event.v1.schema.json
    case.opened.event.v1.example.json
  review/
    review.assigned.event.v1.schema.json
    review.assigned.event.v1.example.json
```

Each contract should document:

- owner service;
- message type;
- routing exchange;
- routing key;
- schema;
- examples;
- compatibility notes;
- producer responsibility;
- known consumers;
- retention/replay expectation;
- PII classification;
- idempotency key rules.

---

## 37. Contract Documentation Template

```markdown
# evidence.submitted.event.v1

## Owner
Evidence Service

## Category
Domain Event

## Meaning
An evidence item has been successfully submitted and persisted.

## Producer
`evidence-service`

## Exchange
`reg.events.topic`

## Routing Key
`reg.case.evidence.submitted`

## Queue Type Expectations
Consumers may bind quorum queues for work processing or stream queues for replay/audit.

## Compatibility
- Additive optional fields allowed.
- Existing fields must not be removed in v1.
- Unknown fields should be ignored by consumers.

## Idempotency Key
`evidence-submitted:<evidenceId>`

## Required Metadata
- messageId
- messageType
- schemaVersion
- producer
- occurredAt
- publishedAt
- correlationId
- causationId
- idempotencyKey
- subject

## Payload
See JSON Schema.

## Data Classification
Contains confidential case metadata, but not raw document content.

## Replay Semantics
Safe to replay if consumers are idempotent by idempotency key.

## Example
...
```

---

## 38. Consumer Ownership and Contract Coupling

A producer owns the event it emits.

But consumer needs influence.

Healthy model:

```text
Producer owns meaning.
Consumer owns usage.
Both negotiate compatibility.
```

Bad model:

```text
Consumer reaches into producer database.
Producer changes event field randomly.
Consumer silently breaks.
```

Better:

- maintain contract docs;
- track known consumers;
- announce breaking changes;
- run consumer compatibility tests;
- keep v1 and v2 active during migration;
- monitor consumption by message type.

---

## 39. Message Contract and Outbox Pattern

When using outbox, the stored outbox row should contain stable contract data.

Example table shape:

```sql
CREATE TABLE outbox_message (
    id              VARCHAR(64) PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    VARCHAR(100) NOT NULL,
    message_type    VARCHAR(200) NOT NULL,
    schema_version  INT NOT NULL,
    routing_key     VARCHAR(255) NOT NULL,
    payload_json    TEXT NOT NULL,
    occurred_at     TIMESTAMP NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    published_at    TIMESTAMP NULL,
    publish_attempts INT NOT NULL DEFAULT 0,
    status          VARCHAR(30) NOT NULL
);
```

Important:

- outbox row should contain final message envelope/payload;
- relay should not reconstruct business state from current DB later;
- otherwise the message no longer reflects what happened at transaction time.

Bad:

```text
Outbox stores only case_id and event_type.
Relay later queries current case state.
```

Why bad?

Because current state may have changed.

Better:

```text
Transaction writes domain state and exact event payload together.
```

---

## 40. Message Contract and Inbox/Idempotency

Consumer should persist processed message/idempotency state.

Example:

```sql
CREATE TABLE inbox_message (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    message_id      VARCHAR(100) NOT NULL,
    message_type    VARCHAR(200) NOT NULL,
    correlation_id  VARCHAR(100),
    processed_at    TIMESTAMP NOT NULL,
    handler_name    VARCHAR(200) NOT NULL,
    result          VARCHAR(50) NOT NULL
);
```

Consumer logic:

```text
begin transaction
  if idempotency_key exists:
      commit
      ack
  else:
      apply business effect
      insert idempotency record
      commit
      ack
```

This makes duplicate deliveries safe.

---

## 41. Message Contract for Auditability

For regulatory systems, a message should help reconstruct:

- what happened;
- when it happened;
- who/what initiated it;
- which case/entity it affected;
- which rule/workflow caused it;
- which service produced it;
- which version of contract was used;
- whether it was retried;
- whether it went to DLQ;
- whether it was manually replayed.

Minimum audit-friendly fields:

```text
messageId
messageType
schemaVersion
producer
occurredAt
publishedAt
correlationId
causationId
subject.type
subject.id
actor / initiatedBy
reasonCode
idempotencyKey
```

Domain payload may include:

```json
{
  "caseId": "CASE-2026-000123",
  "action": "ESCALATED",
  "reasonCode": "RISK_THRESHOLD_EXCEEDED",
  "initiatedBy": {
    "type": "SYSTEM_RULE",
    "id": "RISK_SCORE_HIGH"
  }
}
```

---

## 42. Actor and Initiator Modeling

Do not confuse producer service with business actor.

Producer:

```json
"producer": "case-service"
```

Actor:

```json
"initiatedBy": {
  "type": "OFFICER",
  "id": "officer-17"
}
```

or:

```json
"initiatedBy": {
  "type": "SYSTEM_RULE",
  "id": "RULE-AML-004"
}
```

or:

```json
"initiatedBy": {
  "type": "SCHEDULED_JOB",
  "id": "daily-escalation-scan"
}
```

This distinction matters for audit.

---

## 43. Reason Code Design

For workflow/regulatory messages, include reason code when a decision/action occurred.

Bad:

```json
"reason": "because the score was high and some data was missing"
```

Better:

```json
"reasonCode": "RISK_THRESHOLD_EXCEEDED",
"reasonDetails": {
  "riskScore": 87,
  "threshold": 80
}
```

Reason codes should be stable.

They enable:

- analytics;
- audit;
- policy review;
- dashboards;
- operational triage;
- defensibility.

---

## 44. Message Contract for State Machines

If RabbitMQ messages trigger state transitions, message contract must support transition validation.

Example event:

```json
{
  "messageType": "case.status.changed.event.v1",
  "payload": {
    "caseId": "CASE-123",
    "fromStatus": "OPEN",
    "toStatus": "UNDER_REVIEW",
    "transition": "START_REVIEW",
    "reasonCode": "EVIDENCE_SUBMITTED"
  }
}
```

This is more auditable than:

```json
{
  "caseId": "CASE-123",
  "status": "UNDER_REVIEW"
}
```

Why?

Because it captures transition, not just resulting state.

For regulatory workflows, transition event should often include:

- from state;
- to state;
- transition name;
- reason code;
- actor;
- policy/rule version;
- occurredAt;
- correlation/causation.

---

## 45. Policy Version and Rule Version

If message results from a rule/policy decision, include the rule version.

Example:

```json
{
  "payload": {
    "caseId": "CASE-123",
    "decision": "ESCALATE",
    "policyId": "ENFORCEMENT-RISK-POLICY",
    "policyVersion": "2026.06.01",
    "matchedRules": [
      {
        "ruleId": "RISK_SCORE_HIGH",
        "ruleVersion": "3",
        "outcome": "MATCHED"
      }
    ]
  }
}
```

Without policy version, later audit may not know what logic was applied.

---

## 46. Message Contract and Observability

Every message should support log correlation.

Consumer log example:

```text
msg=evidence.submitted.event.v1 messageId=evt-1 correlationId=corr-1 causationId=cmd-1 subject=case:CASE-123 idempotencyKey=evidence-submitted:EV-001 status=processing
```

Structured logging keys:

```text
message_id
message_type
schema_version
correlation_id
causation_id
idempotency_key
producer
consumer
subject_type
subject_id
tenant_id
routing_key
queue
redelivered
retry_count
```

Do not log full payload by default.

Payload may contain sensitive data.

---

## 47. Message Contract and DLQ Investigation

When a message lands in DLQ, an operator should understand it.

Good message has:

- message type;
- subject;
- correlation id;
- producer;
- occurredAt;
- idempotency key;
- reason code;
- compact payload.

Bad DLQ item:

```json
{
  "id": 123,
  "data": "..."
}
```

Good DLQ item:

```json
{
  "messageId": "evt-1",
  "messageType": "case.escalated.event.v1",
  "producer": "case-service",
  "occurredAt": "2026-06-19T08:00:00Z",
  "correlationId": "corr-case-123",
  "causationId": "rule-eval-99",
  "idempotencyKey": "case-escalated:CASE-123:RISK_THRESHOLD_EXCEEDED",
  "subject": {"type": "case", "id": "CASE-123"},
  "payload": {
    "caseId": "CASE-123",
    "reasonCode": "RISK_THRESHOLD_EXCEEDED"
  }
}
```

---

## 48. Message Contract and Replay

Replay means old messages may be consumed again.

This is especially important with RabbitMQ Streams.

Replay-safe message contract needs:

- stable message type;
- backward-compatible schema;
- idempotency key;
- occurredAt;
- subject;
- deterministic business identity;
- no dependency on expired external references unless handled.

Bad replay contract:

```json
{
  "downloadUrl": "https://temporary-url/expires-in-10-minutes"
}
```

Better:

```json
{
  "objectRef": "evidence/EV-8821.pdf",
  "objectVersion": "v3",
  "checksum": "..."
}
```

Replay should not depend on temporary URLs.

---

## 49. Handling Unknown Message Types

Consumer must decide what to do when it receives unknown message type.

Options:

1. reject to DLQ;
2. ack and ignore;
3. route to unsupported-message queue;
4. fail fast to reveal misbinding.

For critical systems, default should usually be:

```text
Unknown message type -> reject without requeue -> DLQ/parking lot
```

Why not ignore?

Because ignoring can silently lose important workflow signals.

But for audit tap consumers, ignoring unknown types may be acceptable if explicitly designed.

---

## 50. Handling Unknown Schema Version

If message type is known but version unsupported:

```text
case.opened.event.v3 received by consumer supporting v1/v2
```

Decision:

- if forward-compatible: parse known fields;
- if not: DLQ/parking lot;
- never infinite retry.

Consumer should log:

```text
unsupported_schema_version messageType=case.opened.event schemaVersion=3 supported=[1,2]
```

---

## 51. Handling Unknown Fields

Unknown fields should usually be ignored by consumers for forward compatibility.

But there is a subtle risk.

If unknown field changes business meaning and consumer ignores it, consumer might act incorrectly.

Example:

```json
{
  "caseId": "CASE-123",
  "action": "SEND_NOTICE",
  "legalHold": true
}
```

Old consumer ignores `legalHold` and sends notice anyway.

So compatibility is not just syntactic; it is semantic.

Rule:

```text
Fields that change safety/business decision must not be added as optional without consumer migration.
```

---

## 52. Semantic Compatibility

Syntactic compatibility:

```text
Can the consumer parse the message?
```

Semantic compatibility:

```text
Can the consumer make the same correct decision with the new meaning?
```

Example:

V1:

```json
"classification": "CONFIDENTIAL"
```

V2 adds:

```json
"disclosureRestriction": "DO_NOT_NOTIFY_SUBJECT"
```

A notification consumer that ignores the new field may violate policy.

Therefore new field may require:

- new message type version;
- consumer upgrade before producer emits it;
- routing separation;
- feature flag;
- contract review.

---

## 53. Message Contract Review Checklist

Before publishing a new message type, ask:

1. Is this a command, event, job, notification, or reply?
2. Is the name past tense for event and imperative for command?
3. Who owns the contract?
4. Which exchange and routing key are used?
5. Which queue type should consumers use?
6. Does it have message id?
7. Does it have message type?
8. Does it have schema version?
9. Does it have correlation id?
10. Does it have causation id?
11. Does it have idempotency key?
12. Does it have occurredAt and publishedAt?
13. Does it have subject?
14. Does it include tenant/context if relevant?
15. Does it include actor/initiator if relevant?
16. Does it include reason code if decision/action occurred?
17. Does it include policy/rule version if generated by rules?
18. Does payload avoid JPA/entity leakage?
19. Does payload avoid unnecessary sensitive data?
20. Does payload avoid large binary/blob data?
21. Can consumer process it idempotently?
22. Can old consumers tolerate additive changes?
23. Are enum changes safe?
24. Are sample messages committed?
25. Are contract tests present?
26. What happens if message goes to DLQ?
27. What happens if message is replayed months later?
28. Is semantic compatibility understood?
29. Is there a migration plan for breaking changes?
30. Can an operator understand this message at 3 AM?

---

## 54. Example: Bad to Good Contract Evolution

### 54.1 Bad Initial Message

```json
{
  "id": 123,
  "status": "ESCALATED",
  "score": 87
}
```

Problems:

- no message id;
- no type;
- no version;
- no producer;
- no correlation;
- no causation;
- no occurredAt;
- unclear subject;
- unclear score meaning;
- no reason code;
- no idempotency key;
- no audit chain.

### 54.2 Better Message

```json
{
  "messageId": "evt-01HZT8Q0M8Z3W6",
  "messageType": "case.escalated.event.v1",
  "schemaVersion": 1,
  "producer": "case-service",
  "occurredAt": "2026-06-19T08:30:00Z",
  "publishedAt": "2026-06-19T08:30:02Z",
  "correlationId": "corr-case-CASE-2026-000123",
  "causationId": "evt-rule-eval-01HZT8PZ",
  "idempotencyKey": "case-escalated:CASE-2026-000123:RISK_THRESHOLD_EXCEEDED",
  "tenantId": "regulator-id",
  "subject": {
    "type": "case",
    "id": "CASE-2026-000123"
  },
  "payload": {
    "caseId": "CASE-2026-000123",
    "fromStatus": "UNDER_REVIEW",
    "toStatus": "ESCALATED",
    "transition": "ESCALATE_CASE",
    "reasonCode": "RISK_THRESHOLD_EXCEEDED",
    "initiatedBy": {
      "type": "SYSTEM_RULE",
      "id": "RISK_SCORE_HIGH"
    },
    "policyId": "ENFORCEMENT-RISK-POLICY",
    "policyVersion": "2026.06.01",
    "riskScore": 87,
    "threshold": 80
  }
}
```

This message is larger, but vastly more useful.

It supports:

- routing;
- tracing;
- audit;
- replay;
- idempotency;
- investigation;
- semantic understanding.

---

## 55. Example Java Implementation: Contract Package

Suggested package layout:

```text
com.example.messaging.contract
  Envelope.java
  MessageSubject.java
  MessageTypes.java
  evidence/
    EvidenceSubmittedPayload.java
    EvidenceSubmittedMessageFactory.java
  case/
    CaseEscalatedPayload.java
    CaseEscalatedMessageFactory.java
```

Envelope:

```java
package com.example.messaging.contract;

import java.time.Instant;

public record Envelope<T>(
        String messageId,
        String messageType,
        int schemaVersion,
        String producer,
        Instant occurredAt,
        Instant publishedAt,
        String correlationId,
        String causationId,
        String idempotencyKey,
        String tenantId,
        MessageSubject subject,
        T payload
) {
    public Envelope {
        requireNonBlank(messageId, "messageId");
        requireNonBlank(messageType, "messageType");
        requireNonBlank(producer, "producer");
        requireNonBlank(correlationId, "correlationId");
        requireNonBlank(idempotencyKey, "idempotencyKey");
        if (schemaVersion <= 0) throw new IllegalArgumentException("schemaVersion must be positive");
        if (occurredAt == null) throw new IllegalArgumentException("occurredAt is required");
        if (publishedAt == null) throw new IllegalArgumentException("publishedAt is required");
        if (subject == null) throw new IllegalArgumentException("subject is required");
        if (payload == null) throw new IllegalArgumentException("payload is required");
    }

    private static void requireNonBlank(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
    }
}
```

Subject:

```java
package com.example.messaging.contract;

public record MessageSubject(String type, String id) {
    public MessageSubject {
        if (type == null || type.isBlank()) throw new IllegalArgumentException("subject.type is required");
        if (id == null || id.isBlank()) throw new IllegalArgumentException("subject.id is required");
    }
}
```

Message types:

```java
package com.example.messaging.contract;

public final class MessageTypes {
    private MessageTypes() {}

    public static final String EVIDENCE_SUBMITTED_EVENT_V1 = "evidence.submitted.event.v1";
    public static final String CASE_ESCALATED_EVENT_V1 = "case.escalated.event.v1";
    public static final String REVIEW_ASSIGN_COMMAND_V1 = "case.review.assign.command.v1";
}
```

Payload:

```java
package com.example.messaging.contract.evidence;

public record EvidenceSubmittedPayload(
        String caseId,
        String evidenceId,
        String submittedByOfficerId,
        String evidenceType,
        String classification
) {}
```

Factory:

```java
package com.example.messaging.contract.evidence;

import com.example.messaging.contract.Envelope;
import com.example.messaging.contract.MessageSubject;
import com.example.messaging.contract.MessageTypes;
import java.time.Instant;
import java.util.UUID;

public final class EvidenceSubmittedMessageFactory {
    private EvidenceSubmittedMessageFactory() {}

    public static Envelope<EvidenceSubmittedPayload> create(
            String tenantId,
            String correlationId,
            String causationId,
            EvidenceSubmittedPayload payload,
            Instant occurredAt
    ) {
        Instant now = Instant.now();
        return new Envelope<>(
                UUID.randomUUID().toString(),
                MessageTypes.EVIDENCE_SUBMITTED_EVENT_V1,
                1,
                "evidence-service",
                occurredAt,
                now,
                correlationId,
                causationId,
                "evidence-submitted:" + payload.evidenceId(),
                tenantId,
                new MessageSubject("case", payload.caseId()),
                payload
        );
    }
}
```

---

## 56. Spring AMQP Publishing Example with Explicit Metadata

```java
@Service
public class EvidenceEventPublisher {

    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;

    public EvidenceEventPublisher(RabbitTemplate rabbitTemplate, ObjectMapper objectMapper) {
        this.rabbitTemplate = rabbitTemplate;
        this.objectMapper = objectMapper;
    }

    public void publishEvidenceSubmitted(Envelope<EvidenceSubmittedPayload> envelope) {
        rabbitTemplate.convertAndSend(
                "reg.events.topic",
                "reg.case.evidence.submitted",
                envelope,
                message -> {
                    MessageProperties props = message.getMessageProperties();
                    props.setContentType(MessageProperties.CONTENT_TYPE_JSON);
                    props.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                    props.setMessageId(envelope.messageId());
                    props.setType(envelope.messageType());
                    props.setCorrelationId(envelope.correlationId());
                    props.setTimestamp(Date.from(envelope.publishedAt()));
                    props.setHeader("x-schema-version", envelope.schemaVersion());
                    props.setHeader("x-producer", envelope.producer());
                    props.setHeader("x-causation-id", envelope.causationId());
                    props.setHeader("x-idempotency-key", envelope.idempotencyKey());
                    props.setHeader("x-tenant-id", envelope.tenantId());
                    props.setHeader("x-subject-type", envelope.subject().type());
                    props.setHeader("x-subject-id", envelope.subject().id());
                    return message;
                }
        );
    }
}
```

The body is self-contained, while AMQP properties improve broker/client observability.

---

## 57. Consumer Mapping Example

```java
@Component
public class EvidenceSubmittedHandler {

    private final ObjectMapper objectMapper;
    private final InboxRepository inboxRepository;
    private final EvidenceProjectionService projectionService;

    public EvidenceSubmittedHandler(
            ObjectMapper objectMapper,
            InboxRepository inboxRepository,
            EvidenceProjectionService projectionService
    ) {
        this.objectMapper = objectMapper;
        this.inboxRepository = inboxRepository;
        this.projectionService = projectionService;
    }

    @RabbitListener(queues = "case.evidence.projection.q")
    public void handle(org.springframework.amqp.core.Message amqpMessage, Channel channel) throws Exception {
        long tag = amqpMessage.getMessageProperties().getDeliveryTag();

        try {
            String messageType = amqpMessage.getMessageProperties().getType();
            if (!MessageTypes.EVIDENCE_SUBMITTED_EVENT_V1.equals(messageType)) {
                throw new UnsupportedMessageTypeException(messageType);
            }

            JavaType type = objectMapper.getTypeFactory().constructParametricType(
                    Envelope.class,
                    EvidenceSubmittedPayload.class
            );

            Envelope<EvidenceSubmittedPayload> envelope = objectMapper.readValue(
                    amqpMessage.getBody(),
                    type
            );

            validate(envelope);

            if (inboxRepository.alreadyProcessed(envelope.idempotencyKey())) {
                channel.basicAck(tag, false);
                return;
            }

            projectionService.applyEvidenceSubmitted(envelope);
            inboxRepository.markProcessed(
                    envelope.idempotencyKey(),
                    envelope.messageId(),
                    envelope.messageType(),
                    envelope.correlationId()
            );

            channel.basicAck(tag, false);
        } catch (PermanentMessageException e) {
            channel.basicReject(tag, false);
        } catch (Exception e) {
            channel.basicNack(tag, false, false);
        }
    }

    private void validate(Envelope<EvidenceSubmittedPayload> envelope) {
        if (envelope.schemaVersion() != 1) {
            throw new PermanentMessageException("Unsupported schema version: " + envelope.schemaVersion());
        }
        if (!MessageTypes.EVIDENCE_SUBMITTED_EVENT_V1.equals(envelope.messageType())) {
            throw new PermanentMessageException("Unsupported message type: " + envelope.messageType());
        }
    }
}
```

In real production code, transaction boundary must ensure business effect and inbox insert commit atomically before ack.

---

## 58. Message Contract Naming Convention

Recommended structure:

```text
<bounded-context>.<business-capability>.<action-or-fact>.<category>.v<major>
```

Examples:

```text
case.lifecycle.opened.event.v1
case.lifecycle.escalated.event.v1
evidence.intake.submitted.event.v1
evidence.scanning.scan-requested.command.v1
review.assignment.assign.command.v1
notice.delivery.send-email.command.v1
rule.evaluation.completed.event.v1
```

Keep names:

- lowercase;
- dot-separated;
- stable;
- business-oriented;
- not framework-oriented.

Avoid:

```text
RabbitMessage1
CaseDTO
ProcessData
NewEvent
AsyncMessage
```

---

## 59. Message Contract Lifecycle

A mature message contract has lifecycle states:

```text
DRAFT -> EXPERIMENTAL -> ACTIVE -> DEPRECATED -> RETIRED
```

### DRAFT

- not used in production;
- design review ongoing.

### EXPERIMENTAL

- used by limited consumers;
- breaking changes possible with coordination.

### ACTIVE

- production contract;
- compatibility guarantees apply.

### DEPRECATED

- still emitted/accepted;
- migration ongoing.

### RETIRED

- no longer emitted;
- consumers removed;
- replay requirements considered.

Do not delete schema samples too early. Old DLQ or stream messages may still exist.

---

## 60. Contract Breaking Change Playbook

When you need breaking change:

1. Create v2 message type.
2. Publish v1 and v2 in parallel if needed.
3. Add v2 consumer support.
4. Migrate consumers one by one.
5. Monitor v1 consumption.
6. Stop publishing v1.
7. Keep v1 consumer support during retention/DLQ window.
8. Retire v1 after agreed period.

Never silently change v1 semantics.

---

## 61. Contract and Topology Alignment

Message contract should align with routing topology.

Example:

```text
Exchange: reg.events.topic
Routing key: reg.case.evidence.submitted
Message type: evidence.submitted.event.v1
```

Consumer queue:

```text
case-risk.evidence-submitted.q
Binding: reg.case.evidence.submitted
```

DLQ:

```text
case-risk.evidence-submitted.dlq
```

If v2 is compatible:

```text
same routing key
messageType: evidence.submitted.event.v2
```

If v2 is semantically incompatible:

```text
routing key: reg.case.evidence.submitted.v2
or separate exchange/binding
```

Topology should not hide contract meaning.

---

## 62. Contract for RabbitMQ Streams

For streams, contract discipline is even more important because messages may be retained and replayed.

Additional concerns:

- backward compatibility over retention period;
- stable event identity;
- replay-safe side effects;
- snapshot vs delta clarity;
- offset is not business identity;
- stream deduplication may rely on producer identity and publishing id, but consumer idempotency still matters.

Stream event should usually include:

```text
messageId
messageType
schemaVersion
producer
occurredAt
correlationId
causationId
subject
idempotencyKey
payload
```

Replay consumer must not assume:

```text
If I see this message, it is new.
```

It must assume:

```text
If I see this message, it may be old, duplicated, or replayed intentionally.
```

---

## 63. Message Contract and Ordering

If ordering matters, contract should expose ordering key.

Example:

```json
{
  "orderingKey": "case:CASE-2026-000123"
}
```

or use subject:

```json
"subject": {"type": "case", "id": "CASE-2026-000123"}
```

Producer and routing should align:

```text
all messages for same case route to same queue/partition if ordering required
```

But do not put global ordering assumptions in contract unless guaranteed.

Consumer should not assume:

```text
CaseOpened always arrives before EvidenceSubmitted.
```

unless topology and workflow enforce it.

Better consumer behavior:

- tolerate out-of-order;
- load current state;
- buffer if necessary;
- reject invalid transition safely;
- design state machine idempotently.

---

## 64. Message Contract and Priority

AMQP supports priority queues, but priority should be domain meaningful.

If message has priority, define it clearly:

```json
"priority": "URGENT"
```

or:

```json
"sla": {
  "dueAt": "2026-06-19T10:00:00Z",
  "priority": "HIGH"
}
```

Avoid arbitrary numeric priority without policy.

Priority changes operational behavior and can starve lower priority messages.

---

## 65. Message Contract and Expiration

Some messages expire.

Example:

```json
"expiresAt": "2026-06-19T09:00:00Z"
```

This is different from RabbitMQ TTL.

RabbitMQ TTL controls broker expiration. Business `expiresAt` controls whether processing still makes sense.

Consumer should check:

```text
if now > expiresAt -> domain-specific discard/DLQ/compensate
```

Useful for:

- notifications;
- temporary assignments;
- scheduled tasks;
- external callbacks;
- SLA windows.

---

## 66. Message Contract and Deduplication

Deduplication can happen at multiple levels:

```text
publisher outbox id
messageId
idempotencyKey
consumer inbox table
RabbitMQ Stream producer publishing id
external API idempotency key
```

Do not rely on only one if side effect is critical.

Example email send:

```json
"idempotencyKey": "send-email:notice:N-2026-777:recipient:officer-17"
```

Consumer passes same key to external email provider if provider supports idempotency.

---

## 67. Bad Contract Smells

Watch for these:

- message name contains `DTO`;
- payload is JPA entity;
- no message id;
- no correlation id;
- no schema version;
- no idempotency key;
- no owner;
- event is imperative;
- command is past tense;
- payload has `Map<String,Object>` everywhere;
- enum has no unknown handling;
- raw exception stored in payload;
- message includes access token;
- message includes full document binary;
- field names mirror database columns;
- class package appears in message type;
- consumer must call producer for every field;
- no sample messages;
- no contract tests;
- unknown message type is acked silently;
- retry changes message id and idempotency key unpredictably;
- DLQ message cannot be understood by operators.

---

## 68. Design Exercise: Review Assignment Command

Requirement:

When a case reaches legal review stage, assign review to a reviewer group. Duplicate command delivery must not assign twice.

Contract:

```json
{
  "messageId": "cmd-01HZT9",
  "messageType": "case.review.assign.command.v1",
  "schemaVersion": 1,
  "producer": "case-orchestrator",
  "occurredAt": "2026-06-19T09:00:00Z",
  "publishedAt": "2026-06-19T09:00:01Z",
  "correlationId": "corr-case-CASE-2026-000123",
  "causationId": "evt-case-escalated-01HZT8",
  "idempotencyKey": "assign-review:CASE-2026-000123:LEGAL_REVIEW",
  "tenantId": "regulator-id",
  "subject": {
    "type": "case",
    "id": "CASE-2026-000123"
  },
  "payload": {
    "caseId": "CASE-2026-000123",
    "reviewStage": "LEGAL_REVIEW",
    "assigneeGroup": "legal-reviewers",
    "assignmentReasonCode": "CASE_ESCALATED",
    "dueAt": "2026-06-22T17:00:00Z"
  }
}
```

Consumer invariant:

```text
For a given idempotencyKey, at most one active assignment is created.
```

---

## 69. Design Exercise: Rule Evaluation Completed Event

Requirement:

Rule engine evaluates a case and emits result. Later audit must know policy version.

Contract:

```json
{
  "messageId": "evt-rule-01",
  "messageType": "rule.evaluation.completed.event.v1",
  "schemaVersion": 1,
  "producer": "rule-engine",
  "occurredAt": "2026-06-19T09:05:00Z",
  "publishedAt": "2026-06-19T09:05:01Z",
  "correlationId": "corr-case-CASE-2026-000123",
  "causationId": "cmd-rule-eval-01",
  "idempotencyKey": "rule-evaluation:CASE-2026-000123:ENFORCEMENT-RISK-POLICY:2026.06.01",
  "tenantId": "regulator-id",
  "subject": {
    "type": "case",
    "id": "CASE-2026-000123"
  },
  "payload": {
    "caseId": "CASE-2026-000123",
    "policyId": "ENFORCEMENT-RISK-POLICY",
    "policyVersion": "2026.06.01",
    "decision": "ESCALATE",
    "matchedRules": [
      {
        "ruleId": "RISK_SCORE_HIGH",
        "ruleVersion": "3",
        "outcome": "MATCHED",
        "reasonDetails": {
          "riskScore": 87,
          "threshold": 80
        }
      }
    ]
  }
}
```

This is defensible because it records not only result, but also decision basis.

---

## 70. Practical Minimal Contract

If your team cannot adopt full envelope immediately, start with this minimum:

```json
{
  "messageId": "string",
  "messageType": "string",
  "schemaVersion": 1,
  "producer": "string",
  "occurredAt": "ISO-8601",
  "correlationId": "string",
  "idempotencyKey": "string",
  "payload": {}
}
```

Then add:

```text
causationId
publishedAt
subject
tenantId
actor
reasonCode
policyVersion
```

as maturity increases.

---

## 71. Final Mental Models

### 71.1 Message is a public API

Even if only internal services consume it, message is still an API.

Internal does not mean informal.

### 71.2 Queue stores consequences of your contract decisions

Bad contract in queue becomes operational debt.

DLQ will expose your design quality.

### 71.3 Idempotency is part of the contract

If message can be redelivered, contract must tell consumer how to deduplicate.

### 71.4 Time has multiple meanings

Business occurrence time and publish time are different.

### 71.5 Correlation explains flow; causation explains why

Both are needed for complex workflows.

### 71.6 Schema compatibility is not enough

Semantic compatibility matters more.

### 71.7 Do not serialize implementation detail

A Java entity is not a message contract.

---

## 72. Mastery Checklist

You understand this part if you can:

- explain envelope vs payload;
- distinguish command, event, job, notification, reply;
- design idempotency key;
- explain message id vs idempotency key;
- explain correlation id vs causation id;
- design event names and command names;
- define occurredAt vs publishedAt;
- avoid JPA/entity leakage;
- choose JSON/Avro/Protobuf intentionally;
- design schema evolution safely;
- explain syntactic vs semantic compatibility;
- write producer and consumer contract tests;
- design replay-safe stream messages;
- support DLQ investigation;
- include audit fields for regulatory workflow;
- create a contract review checklist;
- identify bad message contract smells.

---

## 73. Mini Quiz

1. Why is publishing a JPA entity as a RabbitMQ message dangerous?
2. What is the difference between `messageId` and `idempotencyKey`?
3. What is the difference between `correlationId` and `causationId`?
4. Why should `occurredAt` and `publishedAt` both exist?
5. When is adding an optional field not semantically safe?
6. Why should event names be past tense?
7. Why should command names be imperative?
8. What should a consumer do with unknown message type?
9. Why is versioning in routing key often not ideal?
10. Why are replay-safe contracts more important for RabbitMQ Streams?

---

## 74. Answers

1. Because it leaks internal schema, persistence model, lazy loading behavior, sensitive fields, and creates tight coupling between producer implementation and consumer contract.
2. `messageId` identifies the message instance; `idempotencyKey` identifies the business operation/effect that must not be applied twice.
3. `correlationId` groups a whole flow; `causationId` points to the direct cause/parent.
4. Because business event time and broker publish time can differ, especially with outbox pattern and delayed relay.
5. When the new field changes decision semantics, safety, authorization, or legal meaning and old consumers would act incorrectly by ignoring it.
6. Because an event represents a fact that already happened.
7. Because a command asks a receiver to perform an action.
8. Usually reject without requeue to DLQ/parking lot, unless the consumer is explicitly designed to ignore unknown types.
9. Because schema version changes should not always require topology/binding changes; version usually belongs in message type/schemaVersion.
10. Because stream messages can be retained and replayed long after their original publish time.

---

## 75. What Comes Next

Part 12 established message contract discipline.

Next, we move to:

```text
Part 13 — Ordering, Concurrency, Partitioning, and Work Distribution
```

That part will answer:

- what ordering RabbitMQ actually gives;
- how prefetch changes perceived ordering;
- how competing consumers affect sequence;
- how to preserve per-key ordering;
- how to shard queues;
- how consistent hash exchange helps;
- how to balance throughput and ordering;
- how to design worker pools safely.

---

# End of Part 12


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-11.md">⬅️ Part 11 — Spring Boot Integration Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-13.md">Part 13 — Ordering, Concurrency, Partitioning, and Work Distribution ➡️</a>
</div>
