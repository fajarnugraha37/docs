# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering
# Part 5 — Message Anatomy: Header, Properties, Body, Metadata, Correlation, dan Semantic Contract

> Seri: Java JMS / Jakarta Messaging Advanced  
> Target: Java 8 sampai Java 25  
> Fokus: membangun pemahaman mendalam tentang struktur message sebagai unit kontrak, unit routing, unit observability, dan unit failure recovery dalam sistem enterprise messaging.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

1. **Part 0** — JMS sebagai sistem koordinasi asinkron, bukan sekadar queue API.
2. **Part 1** — evolusi JMS 1.1, JMS 2.0, dan Jakarta Messaging 3.x.
3. **Part 2** — domain model: `Connection`, `Session`, `JMSContext`, `Destination`, producer, consumer.
4. **Part 3** — queue semantics: competing consumers, work distribution, load leveling.
5. **Part 4** — topic semantics: publish/subscribe, durable subscription, fan-out.

Sekarang kita masuk ke unit paling kecil tetapi paling strategis dalam JMS:

> **Message.**

Di permukaan, message terlihat seperti objek sederhana yang dikirim dari producer ke consumer. Tetapi dalam sistem enterprise, message adalah gabungan dari:

- **data contract**,
- **routing instruction**,
- **processing instruction**,
- **correlation context**,
- **observability context**,
- **idempotency key carrier**,
- **security boundary**,
- **audit evidence**,
- **replay unit**,
- **failure recovery artifact**.

Engineer biasa melihat message sebagai payload. Engineer yang matang melihat message sebagai **kontrak operasional antar waktu**.

Mengapa “antar waktu”? Karena producer bisa mengirim message sekarang, consumer bisa memproses beberapa detik, menit, jam, atau bahkan hari kemudian. Message harus tetap cukup jelas untuk dipahami oleh sistem, operator, auditor, dan engineer masa depan.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan fungsi **header**, **properties**, dan **body** dalam JMS/Jakarta Messaging.
2. Memahami field penting seperti `JMSMessageID`, `JMSCorrelationID`, `JMSReplyTo`, `JMSDestination`, `JMSTimestamp`, `JMSExpiration`, `JMSPriority`, `JMSDeliveryMode`, `JMSRedelivered`, dan `JMSType`.
3. Mendesain message envelope yang stabil untuk sistem enterprise.
4. Menentukan metadata mana yang harus menjadi JMS header, JMS property, atau body payload.
5. Menghindari anti-pattern seperti semua data ditaruh di body, semua routing ditaruh di payload, atau semua business state ditaruh di header.
6. Mendesain correlation model untuk tracing, request/reply, saga, audit trail, dan incident reconstruction.
7. Memahami hubungan antara message metadata dan operational behavior seperti TTL, priority, selector, redelivery, DLQ, retry, dan observability.
8. Mendesain message contract yang tahan terhadap versioning, replay, duplicate delivery, dan evolusi consumer.

---

## 2. Definisi Fundamental: Apa Itu JMS Message?

Jakarta Messaging mendefinisikan message sebagai unit yang dibuat, dikirim, diterima, dan dibaca oleh program Java melalui enterprise messaging system. Secara struktur, message memiliki tiga bagian besar:

```text
+---------------------------------------------------------------+
|                           JMS Message                         |
+---------------------------------------------------------------+
|  Header                                                       |
|  - standard JMS-defined fields                                |
|  - sebagian diisi provider saat send                          |
|  - sebagian bisa diset client                                 |
+---------------------------------------------------------------+
|  Properties                                                   |
|  - application-defined metadata                               |
|  - typed key-value pairs                                      |
|  - bisa dipakai selector/filtering                            |
+---------------------------------------------------------------+
|  Body                                                         |
|  - application payload                                        |
|  - TextMessage / BytesMessage / MapMessage / ObjectMessage    |
|    / StreamMessage / Message tanpa body                       |
+---------------------------------------------------------------+
```

Mental model paling penting:

> **Header adalah metadata standar yang dimengerti JMS provider. Properties adalah metadata aplikasi yang bisa dipakai broker/consumer untuk routing dan filtering. Body adalah data bisnis utama yang biasanya hanya dimengerti aplikasi.**

Jangan campur tiga peran ini sembarangan.

---

## 3. Message sebagai Envelope, Bukan Sekadar Payload

Banyak engineer memulai dengan model ini:

```text
Message = JSON payload
```

Itu terlalu dangkal.

Model yang lebih benar:

```text
Message = Envelope + Payload
```

Contoh:

```json
{
  "eventId": "evt-2026-000001",
  "eventType": "CaseEscalated",
  "eventVersion": 3,
  "occurredAt": "2026-06-18T09:15:30Z",
  "sourceSystem": "aceas-case-service",
  "correlationId": "corr-abc-123",
  "causationId": "cmd-xyz-789",
  "tenantId": "agency-cea",
  "subject": {
    "type": "Case",
    "id": "CASE-2026-00042"
  },
  "payload": {
    "caseId": "CASE-2026-00042",
    "previousState": "UNDER_REVIEW",
    "newState": "ESCALATED",
    "reasonCode": "SLA_BREACH",
    "escalatedBy": "system-scheduler"
  }
}
```

Tetapi JMS juga punya envelope sendiri melalui header dan properties:

```text
JMS Header:
  JMSMessageID      = ID:broker-generated-123
  JMSCorrelationID  = corr-abc-123
  JMSDestination    = queue://case.escalation.command
  JMSTimestamp      = broker/client send timestamp
  JMSDeliveryMode   = PERSISTENT
  JMSExpiration     = 0
  JMSPriority       = 4

JMS Properties:
  eventType         = CaseEscalated
  eventVersion      = 3
  tenantId          = agency-cea
  aggregateType     = Case
  aggregateId       = CASE-2026-00042
  sourceSystem      = aceas-case-service
  schemaVersion     = 3
  contentType       = application/json

Body:
  JSON payload / envelope body
```

Pertanyaan desainnya:

> Metadata mana diletakkan di JMS header, mana di property, dan mana di body?

Itulah inti part ini.

---

## 4. Tiga Lapisan Metadata

Dalam sistem JMS production-grade, message biasanya memiliki tiga lapisan metadata:

```text
+---------------------------------------------------------------+
|  Layer 1: JMS Standard Header                                 |
|  Controlled by JMS API/provider                               |
|  Example: JMSMessageID, JMSDestination, JMSExpiration          |
+---------------------------------------------------------------+
|  Layer 2: JMS Application Properties                          |
|  Controlled by producer application                           |
|  Example: tenantId, eventType, aggregateId, schemaVersion      |
+---------------------------------------------------------------+
|  Layer 3: Payload Envelope Metadata                           |
|  Controlled by application contract                           |
|  Example: eventId, causationId, occurredAt, actor, subject     |
+---------------------------------------------------------------+
```

Kenapa metadata sering muncul ganda?

Karena setiap lapisan melayani kebutuhan berbeda.

| Lapisan | Dibaca oleh | Tujuan utama |
|---|---|---|
| JMS Header | JMS provider, JMS client, ops tooling | delivery, identity, expiration, priority, reply, redelivery |
| JMS Properties | broker selector, consumer, monitoring, router | filtering, classification, routing ringan, observability |
| Payload Envelope | business consumer, audit, replay, data lake | contract bisnis, semantic meaning, long-term evidence |

Contoh duplikasi yang masuk akal:

- `correlationId` ada di `JMSCorrelationID` dan juga di body envelope.
- `eventType` ada di JMS property dan juga di body envelope.
- `tenantId` ada di JMS property dan juga di body envelope.

Mengapa boleh?

Karena JMS property memudahkan broker-side filtering dan observability tanpa parse body. Body envelope memastikan data tetap self-contained saat message diekspor ke DLQ, S3, audit table, replay store, atau sistem non-JMS.

Tetapi duplikasi harus punya aturan:

> Jika metadata disimpan di dua tempat, harus ada satu sumber kebenaran semantik, dan mismatch harus dianggap invalid message.

---

## 5. Struktur Resmi JMS Message

Secara konseptual, semua message mengimplementasikan `Message`. Subtype body umum:

```text
Message
├── TextMessage
├── BytesMessage
├── MapMessage
├── ObjectMessage
└── StreamMessage
```

Ada juga `Message` tanpa body, yang bisa dipakai untuk signal/event ringan ketika semua informasi cukup ada di properties. Namun dalam sistem enterprise, message tanpa body jarang ideal untuk event bisnis karena bukti audit dan evolusi kontraknya lemah.

### 5.1 Header

Header adalah field standar. Beberapa bisa diisi application/client sebelum send, beberapa diisi provider saat send, beberapa meaningful saat receive.

Header utama:

```text
JMSDestination
JMSDeliveryMode
JMSExpiration
JMSPriority
JMSMessageID
JMSTimestamp
JMSCorrelationID
JMSReplyTo
JMSType
JMSRedelivered
```

### 5.2 Properties

Properties adalah key-value typed metadata.

Tipe property yang lazim didukung:

```text
boolean
byte
short
int
long
float
double
String
```

Properties bisa digunakan oleh message selector.

### 5.3 Body

Body berisi payload aplikasi.

Pilihan body menentukan:

- readability,
- compatibility,
- serialization risk,
- performance,
- interoperability,
- schema evolution,
- debugging experience,
- security posture.

---

## 6. Header Field Deep Dive

Sekarang kita bedah satu per satu.

---

## 7. `JMSMessageID`

### 7.1 Apa Itu?

`JMSMessageID` adalah identifier message yang biasanya dibuat oleh provider saat message dikirim.

Contoh bentuk umum:

```text
ID:broker-generated-opaque-value
```

Jangan bergantung pada format detailnya. Format bisa berbeda antar provider.

### 7.2 Untuk Apa?

`JMSMessageID` berguna untuk:

- identifikasi message di broker/tooling,
- log correlation teknis,
- debugging DLQ,
- request/reply jika correlation reply memakai original message id,
- evidence bahwa message tertentu pernah masuk ke broker.

### 7.3 Bukan Business ID

Kesalahan umum:

```text
JMSMessageID dijadikan business event id utama.
```

Ini lemah karena:

1. Nilainya dibuat provider, bukan domain.
2. Nilainya baru reliable setelah send.
3. Replay bisa menghasilkan JMSMessageID baru.
4. Migrasi broker/provider bisa mengubah format.
5. Jika message diekspor ke non-JMS system, semantic ID bisa hilang.

Design yang lebih baik:

```text
JMSMessageID        = technical broker message id
body.eventId        = stable business event id
property.eventId    = optional duplicate for filtering/debug
```

### 7.4 Kapan Menggunakan `JMSMessageID` sebagai Correlation?

Dalam request/reply klasik JMS:

1. requester mengirim request,
2. provider memberi `JMSMessageID`,
3. replier mengirim reply dengan `JMSCorrelationID = request.JMSMessageID`.

Ini valid untuk pola request/reply, tetapi kurang ideal untuk long-running business process. Untuk saga/workflow, lebih baik gunakan application-level correlation id.

### 7.5 Invariant

```text
JMSMessageID adalah identitas teknis message di broker, bukan identitas bisnis permanen.
```

---

## 8. `JMSTimestamp`

### 8.1 Apa Itu?

`JMSTimestamp` adalah timestamp saat message dikirim menurut provider/client semantics.

### 8.2 Untuk Apa?

Berguna untuk:

- mengukur broker/client enqueue time,
- observability kasar,
- debugging latency,
- auditing teknis,
- age-of-message monitoring.

### 8.3 Bukan Waktu Kejadian Bisnis

Jangan samakan:

```text
JMSTimestamp = event occurred time
```

Contoh:

- Case escalation terjadi pukul 10:00.
- Outbox relay baru mengirim JMS message pukul 10:03.
- `JMSTimestamp` kemungkinan 10:03.
- `occurredAt` harus tetap 10:00.

Design:

```json
{
  "eventId": "evt-001",
  "eventType": "CaseEscalated",
  "occurredAt": "2026-06-18T10:00:00Z",
  "publishedAt": "2026-06-18T10:03:00Z"
}
```

JMS header:

```text
JMSTimestamp = 2026-06-18T10:03:00Z-ish
```

### 8.4 Latency Breakdown

Dengan metadata yang benar, kamu bisa menghitung:

```text
business delay      = publishedAt - occurredAt
broker age          = now - JMSTimestamp
consumer processing = processedAt - receivedAt
end-to-end latency  = processedAt - occurredAt
```

Tanpa metadata ini, incident analysis menjadi tebak-tebakan.

### 8.5 Invariant

```text
JMSTimestamp adalah waktu publish/send teknis, bukan semantic occurredAt.
```

---

## 9. `JMSDestination`

### 9.1 Apa Itu?

`JMSDestination` menunjukkan destination tempat message dikirim.

Contoh:

```text
queue://case.escalation.command
topic://case.lifecycle.event
```

Representasi aktual bergantung provider.

### 9.2 Untuk Apa?

Berguna untuk:

- debugging,
- DLQ triage,
- audit teknis,
- routing visibility,
- validation di consumer.

### 9.3 Jangan Jadikan Satu-satunya Semantic Type

Kesalahan umum:

```text
Karena message dikirim ke queue case.escalation, maka body tidak perlu eventType/commandType.
```

Ini lemah karena:

1. Message bisa masuk DLQ dan keluar dari konteks destination asli.
2. Message bisa di-bridge ke broker lain.
3. Message bisa diekspor ke file/data lake.
4. Destination bisa berubah saat refactoring topology.
5. Replay bisa dikirim ke destination berbeda.

Lebih baik:

```text
Destination          = routing location
property.messageType = classification for broker/consumer
body.type            = semantic contract
```

### 9.4 Invariant

```text
Destination menjawab “message dikirim ke mana”, bukan “message ini bermakna apa”.
```

---

## 10. `JMSDeliveryMode`

### 10.1 Apa Itu?

Delivery mode menentukan apakah message dikirim sebagai:

```text
PERSISTENT
NON_PERSISTENT
```

### 10.2 Persistent

`PERSISTENT` berarti provider berusaha memastikan message tidak hilang akibat provider failure sesuai kemampuan/configuration provider.

Dipakai untuk:

- business command,
- integration event penting,
- notification yang tidak boleh hilang,
- workflow transition,
- financial/regulatory event,
- audit-relevant message.

Konsekuensi:

- lebih lambat,
- storage/journal write,
- fsync/batching impact,
- disk pressure,
- recovery time,
- broker capacity planning lebih penting.

### 10.3 Non-Persistent

`NON_PERSISTENT` cocok untuk data yang boleh hilang:

- telemetry volatile,
- UI presence,
- cache invalidation best-effort,
- transient progress update,
- high-frequency signal yang punya refresh berikutnya.

Konsekuensi:

- lebih cepat,
- lebih kecil storage pressure,
- bisa hilang saat broker crash,
- tidak cocok untuk state transition penting.

### 10.4 Persistent Bukan Magic

Persistent bukan berarti end-to-end exactly once.

Persistent hanya membantu mengurangi loss di broker layer. Message masih bisa:

- terkirim dua kali,
- diproses dua kali,
- rollback lalu redeliver,
- masuk DLQ,
- expired,
- gagal karena consumer bug,
- hilang secara bisnis jika producer mengirim sebelum DB commit lalu transaksi DB rollback,
- menjadi orphan jika DB commit tetapi message send gagal.

### 10.5 Design Rule

```text
Jika message menyebabkan perubahan state bisnis yang tidak boleh hilang, default gunakan PERSISTENT dan desain idempotent consumer.
```

---

## 11. `JMSExpiration`

### 11.1 Apa Itu?

`JMSExpiration` menyatakan waktu kedaluwarsa message. Nilai ini biasanya berasal dari TTL saat send.

Jika TTL 0, biasanya berarti tidak expire.

### 11.2 Apa Maknanya?

Expiration menjawab:

> “Apakah message ini masih berguna setelah waktu tertentu?”

Contoh:

| Message | TTL masuk akal? | Reasoning |
|---|---:|---|
| Password reset email command | Ya | Setelah 15 menit mungkin tidak relevan |
| SLA breach escalation | Mungkin tidak | Bisa tetap perlu audit/recovery |
| UI live notification | Ya | Setelah user logout tidak relevan |
| Payment captured event | Tidak | Harus durable dan replayable |
| Cache refresh command | Ya | Bisa diganti refresh berikutnya |

### 11.3 Expiration adalah Business Decision

TTL bukan sekadar tuning teknis.

TTL terlalu pendek:

```text
message penting bisa expire saat broker/consumer down
```

TTL terlalu panjang:

```text
message basi bisa diproses dan merusak state
```

Contoh buruk:

```text
Queue: case.assignment.command
TTL: 5 minutes
```

Jika consumer down 10 menit, assignment command hilang. Dalam case management, ini bisa menyebabkan case stuck.

Contoh lebih baik:

```text
case.assignment.command: no TTL, must process or DLQ
user.toast.notification: TTL 30 seconds
search-index-refresh: TTL 30 minutes, coalescing allowed
```

### 11.4 Expiration vs Validity dalam Payload

Kadang message tidak boleh dihapus otomatis oleh broker, tetapi consumer perlu tahu validitas bisnis.

Gunakan body field:

```json
{
  "commandId": "cmd-001",
  "commandType": "SendReminder",
  "validUntil": "2026-06-18T17:00:00Z",
  "payload": { }
}
```

Dengan pola ini:

- broker tetap menyimpan untuk audit/DLQ,
- consumer bisa reject/mark skipped secara eksplisit,
- operator bisa melihat alasan message tidak diproses,
- tidak terjadi silent disappearance.

### 11.5 Invariant

```text
TTL boleh dipakai hanya jika hilangnya message setelah waktu tertentu memang acceptable secara bisnis dan operasional.
```

---

## 12. `JMSPriority`

### 12.1 Apa Itu?

`JMSPriority` adalah angka prioritas, biasanya 0 sampai 9, dengan 4 sebagai default normal.

### 12.2 Masalah Priority

Priority terlihat menarik, tetapi mudah disalahgunakan.

Risiko:

1. Starvation message prioritas rendah.
2. Ordering rusak.
3. Consumer fairness berubah.
4. Queue menjadi sulit diprediksi.
5. Semua tim memberi priority tinggi, akhirnya tidak ada prioritas.
6. Broker implementation berbeda dalam seberapa kuat priority dihormati.

### 12.3 Kapan Priority Masuk Akal?

Priority masuk akal untuk:

- operational control message,
- urgent cancellation,
- fraud/security alert,
- user-facing notification dengan SLA berbeda,
- small number of well-governed classes.

Priority tidak cocok untuk:

- semua event domain,
- semua request VIP tanpa governance,
- menggantikan queue terpisah,
- memperbaiki kapasitas consumer yang kurang.

### 12.4 Alternative: Queue Separation

Daripada satu queue dengan priority:

```text
case.command.queue with priority 0..9
```

Sering lebih jelas:

```text
case.command.normal.queue
case.command.urgent.queue
case.command.repair.queue
```

Dengan consumer allocation berbeda:

```text
urgent:  4 consumers
normal: 10 consumers
repair:  1 controlled consumer
```

### 12.5 Invariant

```text
Priority adalah scheduling hint, bukan pengganti capacity planning dan queue topology design.
```

---

## 13. `JMSCorrelationID`

### 13.1 Apa Itu?

`JMSCorrelationID` dipakai untuk menghubungkan satu message dengan message/proses lain.

Pola umum:

```text
request message  -> reply message
command          -> resulting event
workflow step    -> next workflow step
external request -> internal async processing
```

### 13.2 Correlation vs Message ID

Bedakan:

```text
JMSMessageID     = ID teknis message ini
JMSCorrelationID = ID yang menghubungkan message ini ke konteks lebih besar
```

Contoh:

```text
HTTP request masuk:
  X-Correlation-ID = corr-123

Service publish JMS:
  JMSMessageID     = ID:broker:789
  JMSCorrelationID = corr-123

Consumer log:
  correlationId    = corr-123
```

### 13.3 Correlation ID Bukan Idempotency Key

Kesalahan umum:

```text
correlationId dipakai sebagai unique key untuk dedup semua message
```

Ini berbahaya karena satu correlation bisa menghasilkan banyak message.

Contoh:

```text
corr-001
├── ValidateApplicationCommand
├── CalculateRiskCommand
├── GenerateLetterCommand
├── SendEmailCommand
└── CaseEscalatedEvent
```

Jika semua memakai dedup key `corr-001`, sebagian message akan dianggap duplicate padahal berbeda.

Gunakan:

```text
correlationId = trace/process context
messageId/eventId/commandId = unique message semantic id
idempotencyKey = operation-specific dedup key
```

### 13.4 Correlation vs Causation

Dalam distributed systems, sering perlu tiga ID:

```text
messageId     = ID message/event/command ini
correlationId = ID proses besar/end-to-end trace
causationId   = ID message yang menyebabkan message ini muncul
```

Contoh:

```text
Command: SubmitApplication
  messageId     = cmd-001
  correlationId = corr-777
  causationId   = http-req-555

Event: ApplicationSubmitted
  messageId     = evt-002
  correlationId = corr-777
  causationId   = cmd-001

Command: RunScreening
  messageId     = cmd-003
  correlationId = corr-777
  causationId   = evt-002
```

Ini membuat causal chain bisa direkonstruksi:

```text
http-req-555 -> cmd-001 -> evt-002 -> cmd-003
```

### 13.5 Recommended Mapping

```text
JMSCorrelationID           = correlationId
JMS property correlationId = correlationId
Body correlationId         = correlationId
Body causationId           = previous semantic message id
Body messageId/eventId     = current semantic message id
```

Mengapa `correlationId` boleh diduplikasi?

- JMS header untuk standar JMS tooling dan request/reply.
- JMS property untuk selector/filtering/logging ringan.
- Body untuk self-contained archival/replay.

### 13.6 Invariant

```text
Correlation ID mengikat percakapan/proses, bukan menjamin uniqueness operasi.
```

---

## 14. `JMSReplyTo`

### 14.1 Apa Itu?

`JMSReplyTo` menunjukkan destination tempat reply harus dikirim.

Contoh:

```text
request.JMSReplyTo = queue://temporary.reply.abc
```

Consumer request membaca `JMSReplyTo`, lalu mengirim reply ke destination tersebut.

### 14.2 Request/Reply Basic Flow

```text
Requester
  create temporary queue
  send request with JMSReplyTo=tempQueue
  wait reply with correlation filter

Broker
  stores/routes request

Responder
  consume request
  process
  send reply to request.JMSReplyTo
  set reply.JMSCorrelationID = request.JMSMessageID or request.JMSCorrelationID

Requester
  receive reply
  match correlation
```

### 14.3 Failure Modes

`JMSReplyTo` membawa banyak jebakan:

1. Requester timeout, reply datang terlambat.
2. Temporary queue hilang saat connection requester mati.
3. Responder sukses side effect tapi gagal mengirim reply.
4. Reply duplicate.
5. Correlation mismatch.
6. Requester restart dan pending correlation memory hilang.
7. Reply queue overload.

### 14.4 Kapan Tidak Memakai Request/Reply JMS?

Jangan pakai JMS request/reply jika sebenarnya butuh synchronous low-latency query.

Contoh buruk:

```text
REST API -> JMS request -> wait reply -> return HTTP response
```

Ini bisa valid dalam beberapa integrasi legacy, tapi sering menghasilkan:

- timeout stacking,
- sulit tracing,
- thread blocking,
- failure ambiguity,
- backpressure tersembunyi,
- user-facing latency tidak stabil.

Jika operasi harus synchronous dan cepat, HTTP/gRPC/direct DB query mungkin lebih tepat.

Jika operasi memang asynchronous, expose sebagai asynchronous job:

```text
POST /screening-jobs
-> returns jobId
-> processing via JMS
-> client polls/subscribes result
```

### 14.5 Invariant

```text
JMSReplyTo cocok untuk conversation pattern, tetapi jangan diam-diam mengubah JMS menjadi RPC layer tanpa timeout, correlation, dan failure model yang jelas.
```

---

## 15. `JMSType`

### 15.1 Apa Itu?

`JMSType` adalah header yang secara historis dapat dipakai sebagai message type identifier.

Namun dalam praktik modern, banyak sistem lebih memilih custom property seperti:

```text
messageType
commandType
eventType
schemaName
```

### 15.2 Mengapa `JMSType` Jarang Jadi Pilihan Utama?

Karena:

1. Semantics-nya kurang dipakai konsisten antar provider/framework.
2. Banyak team lebih nyaman dengan explicit application property.
3. Schema/versioning butuh detail lebih kaya dari satu field.
4. Tooling internal biasanya membaca properties/body envelope.

### 15.3 Pola yang Baik

```text
JMSType                 = optional high-level type
property.messageKind    = COMMAND | EVENT | DOCUMENT | SIGNAL
property.messageType    = CaseEscalated
property.schemaVersion  = 3
body.type               = CaseEscalated
body.version            = 3
```

### 15.4 Invariant

```text
Jangan bergantung hanya pada JMSType untuk semantic contract. Buat type/version eksplisit di contract aplikasi.
```

---

## 16. `JMSRedelivered`

### 16.1 Apa Itu?

`JMSRedelivered` menunjukkan bahwa provider percaya message mungkin pernah dikirim sebelumnya.

### 16.2 Apa Maknanya?

Jika `JMSRedelivered = true`, consumer harus mengasumsikan:

```text
Side effect sebelumnya mungkin sudah terjadi.
```

Namun jika `false`, bukan berarti tidak mungkin duplicate secara end-to-end. Duplicate bisa datang dari producer retry, outbox relay, bridge, replay, atau broker failover.

### 16.3 Jangan Jadikan Satu-satunya Dedup Signal

Buruk:

```java
if (message.getJMSRedelivered()) {
    return; // skip
}
```

Ini berbahaya karena:

- redelivery bisa terjadi sebelum side effect berhasil,
- skip bisa menyebabkan data hilang,
- flag tidak menggantikan idempotency check,
- duplicate bisa datang dengan `JMSRedelivered=false`.

Lebih baik:

```text
if semantic message id already processed:
    ack safely as duplicate
else:
    process transactionally
    record processed id
```

### 16.4 Invariant

```text
JMSRedelivered adalah warning signal, bukan deduplication mechanism.
```

---

## 17. Properties Deep Dive

### 17.1 Apa Itu JMS Properties?

Properties adalah metadata key-value yang ditambahkan aplikasi ke message.

Contoh:

```java
message.setStringProperty("tenantId", "agency-cea");
message.setStringProperty("messageType", "CaseEscalated");
message.setIntProperty("schemaVersion", 3);
message.setStringProperty("aggregateId", "CASE-2026-00042");
```

### 17.2 Untuk Apa Properties?

Properties berguna untuk:

1. selector/filtering,
2. routing ringan,
3. logging,
4. monitoring,
5. DLQ triage,
6. admin console readability,
7. consumer dispatch,
8. contract validation cepat,
9. tenant isolation checks,
10. schema version checks.

### 17.3 Properties Bukan Payload

Jangan taruh seluruh data bisnis di properties.

Buruk:

```text
property.caseId
property.applicantName
property.address
property.phone
property.fullCaseJson
property.previousState
property.newState
property.officerComment
...
```

Masalah:

- properties bukan struktur dokumen kaya,
- bisa menambah overhead broker indexing/filtering,
- PII tersebar di metadata/tooling,
- selector accidentally expose sensitive data,
- sulit versioning,
- batas ukuran provider-specific,
- admin console bisa menampilkan data sensitif.

Lebih baik:

```text
Properties:
  messageType
  schemaVersion
  tenantId
  aggregateType
  aggregateId
  correlationId
  contentType

Body:
  full business payload
```

### 17.4 Properties untuk Selector

Message selector bekerja pada header/properties, bukan body. Karena itu property perlu dipilih secara strategis.

Contoh:

```sql
messageType = 'CaseEscalated' AND tenantId = 'agency-cea'
```

Atau:

```sql
priorityClass = 'URGENT' AND region = 'EAST'
```

Namun selector berat bisa membebani broker. Jangan jadikan broker sebagai query engine kompleks.

### 17.5 Property Naming Convention

Gunakan konvensi stabil.

Rekomendasi:

```text
messageKind       COMMAND | EVENT | DOCUMENT | SIGNAL
messageType       CaseEscalated
schemaVersion     3
contentType       application/json
contentEncoding   utf-8
tenantId          agency-cea
sourceSystem      case-service
aggregateType     Case
aggregateId       CASE-2026-00042
correlationId     corr-abc
causationId       evt-prev-123
idempotencyKey    Case:CASE-2026-00042:Escalate:v5
traceId           otel-trace-id
```

Hindari:

```text
Type
TYPE
msg_type
MSG-TYPE
x-event
businessData
payload
JMSXCustomThingUnlessStandardized
```

### 17.6 Reserved / Provider-Specific Properties

Beberapa provider mendukung properties khusus seperti `JMSXDeliveryCount` atau property vendor-specific. Ini berguna, tetapi jangan membuat contract bisnis bergantung total pada extension kecuali kamu memang menerima vendor lock-in.

Design rule:

```text
Provider-specific property boleh dipakai untuk observability/tuning, tetapi semantic business contract harus tetap portable.
```

### 17.7 Invariant

```text
Properties adalah metadata operasional dan klasifikasi; body adalah sumber data bisnis lengkap.
```

---

## 18. Body Deep Dive

### 18.1 Apa Itu Body?

Body adalah payload aplikasi. Di sinilah data bisnis utama berada.

Body harus bisa menjawab:

- message ini tentang apa,
- versi kontraknya apa,
- entity apa yang terdampak,
- operasi/kejadian apa yang direpresentasikan,
- kapan terjadi,
- siapa/apa yang menyebabkan,
- data minimal apa yang dibutuhkan consumer,
- bagaimana replay dipahami.

### 18.2 Body Harus Self-Contained Secukupnya

Self-contained bukan berarti semua data harus selalu disalin.

Tapi body harus cukup untuk:

1. dipahami saat keluar dari broker,
2. diproses consumer sesuai kontrak,
3. diaudit,
4. direplay,
5. divalidasi,
6. ditriage saat DLQ.

Contoh body terlalu miskin:

```json
{
  "caseId": "CASE-123"
}
```

Consumer harus query banyak data lain. Ini bisa valid untuk command tertentu, tetapi buruk untuk event historis.

Contoh body lebih baik untuk event:

```json
{
  "eventId": "evt-001",
  "eventType": "CaseEscalated",
  "eventVersion": 1,
  "occurredAt": "2026-06-18T10:00:00Z",
  "correlationId": "corr-123",
  "causationId": "cmd-999",
  "subject": {
    "type": "Case",
    "id": "CASE-123"
  },
  "payload": {
    "previousState": "UNDER_REVIEW",
    "newState": "ESCALATED",
    "reasonCode": "SLA_BREACH"
  }
}
```

### 18.3 Command Body vs Event Body

Command dan event tidak sama.

Command:

```text
Do something.
```

Event:

```text
Something happened.
```

Command body:

```json
{
  "commandId": "cmd-001",
  "commandType": "EscalateCase",
  "commandVersion": 1,
  "requestedAt": "2026-06-18T10:00:00Z",
  "requestedBy": "system-scheduler",
  "target": {
    "type": "Case",
    "id": "CASE-123"
  },
  "parameters": {
    "reasonCode": "SLA_BREACH"
  }
}
```

Event body:

```json
{
  "eventId": "evt-001",
  "eventType": "CaseEscalated",
  "eventVersion": 1,
  "occurredAt": "2026-06-18T10:00:00Z",
  "subject": {
    "type": "Case",
    "id": "CASE-123"
  },
  "payload": {
    "previousState": "UNDER_REVIEW",
    "newState": "ESCALATED",
    "reasonCode": "SLA_BREACH"
  }
}
```

Jangan namai command sebagai event atau event sebagai command. Ini merusak mental model failure dan ownership.

### 18.4 Notification Body

Notification bukan selalu event domain. Contoh:

```json
{
  "notificationId": "notif-001",
  "notificationType": "EmailRequested",
  "templateCode": "CASE_ESCALATED",
  "recipient": {
    "type": "USER",
    "id": "user-123"
  },
  "data": {
    "caseId": "CASE-123",
    "caseReference": "CASE-2026-00042"
  }
}
```

### 18.5 Document Message Body

Untuk integrasi dokumen:

```json
{
  "documentMessageId": "docmsg-001",
  "documentType": "LicenceApplicationSubmitted",
  "schemaVersion": 4,
  "contentType": "application/xml",
  "contentEncoding": "utf-8",
  "payloadRef": null,
  "payload": "<Application>...</Application>"
}
```

Atau claim check:

```json
{
  "documentMessageId": "docmsg-002",
  "documentType": "BulkReportGenerated",
  "schemaVersion": 1,
  "contentType": "application/pdf",
  "payloadRef": {
    "storage": "s3",
    "bucket": "secure-documents",
    "key": "reports/2026/06/report-001.pdf",
    "sha256": "..."
  }
}
```

### 18.6 Invariant

```text
Body harus menyimpan semantic contract yang cukup untuk processing, replay, dan audit; properties hanya membantu routing/filtering/observability.
```

---

## 19. Metadata Placement Decision Framework

Gunakan pertanyaan ini:

```text
Apakah broker perlu membaca field ini tanpa parse body?
  Ya  -> JMS property/header
  Tidak -> body

Apakah field ini bagian dari standard JMS delivery behavior?
  Ya  -> JMS header
  Tidak -> lanjut

Apakah field ini dipakai selector/routing/monitoring/DLQ triage?
  Ya  -> JMS property + body jika semantic penting
  Tidak -> body

Apakah field ini bagian dari business contract/audit/replay?
  Ya  -> body
  Tidak -> property atau tidak perlu

Apakah field ini sensitif/PII?
  Ya  -> hindari property/header; pertimbangkan body encryption/masking
```

### 19.1 Placement Table

| Data | Header | Property | Body | Reasoning |
|---|---:|---:|---:|---|
| Broker message id | Ya | Tidak | Tidak | Provider technical id |
| Correlation id | Ya | Ya | Ya | Trace, selector, self-contained replay |
| Event id | Tidak | Opsional | Ya | Semantic identity |
| Command id | Tidak | Opsional | Ya | Semantic identity |
| Tenant id | Tidak | Ya | Ya | Routing/security/audit |
| Event type | Opsional `JMSType` | Ya | Ya | Filtering + contract |
| Schema version | Tidak | Ya | Ya | Consumer dispatch/validation |
| Aggregate id | Tidak | Ya | Ya | Routing/debug/idempotency context |
| Applicant name | Tidak | Tidak | Ya | PII/business data |
| Email body | Tidak | Tidak | Ya/ref | Payload, often sensitive |
| TTL | Ya via expiration | Tidak | Kadang `validUntil` | Delivery expiry vs business validity |
| Priority class | Ya `JMSPriority` | Ya | Mungkin | Scheduling + business classification |
| Content type | Tidak | Ya | Ya | Converter/consumer validation |
| Trace id | Tidak | Ya | Ya/Otel context | Observability |

---

## 20. Designing a Standard Enterprise Envelope

Sekarang kita buat envelope standar yang bisa dipakai lintas service.

### 20.1 Generic Envelope

```json
{
  "messageId": "msg-uuid",
  "messageKind": "EVENT",
  "messageType": "CaseEscalated",
  "messageVersion": 1,
  "schema": {
    "name": "case.lifecycle.CaseEscalated",
    "version": 1
  },
  "source": {
    "system": "aceas-case-service",
    "module": "case-management",
    "instanceId": "case-service-pod-abc"
  },
  "tenant": {
    "id": "agency-cea"
  },
  "subject": {
    "type": "Case",
    "id": "CASE-2026-00042"
  },
  "time": {
    "occurredAt": "2026-06-18T10:00:00Z",
    "publishedAt": "2026-06-18T10:00:02Z"
  },
  "trace": {
    "correlationId": "corr-123",
    "causationId": "cmd-999",
    "traceId": "otel-trace-id",
    "spanId": "otel-span-id"
  },
  "security": {
    "actorType": "SYSTEM",
    "actorId": "scheduler",
    "classification": "INTERNAL"
  },
  "payload": {
  }
}
```

### 20.2 Jangan Terlalu Cepat Membuat Envelope Terlalu Rumit

Envelope enterprise memang berguna, tetapi jangan semua field wajib.

Kelompokkan:

```text
Required:
  messageId
  messageKind
  messageType
  messageVersion
  source.system
  subject.type
  subject.id
  time.occurredAt/requestedAt
  trace.correlationId
  payload

Recommended:
  causationId
  tenantId
  schema name/version
  content type
  actor

Optional:
  spanId
  instanceId
  classification
  data residency tags
  replay policy
```

### 20.3 Envelope for Command

```json
{
  "messageId": "cmd-2026-000001",
  "messageKind": "COMMAND",
  "messageType": "EscalateCase",
  "messageVersion": 1,
  "source": {
    "system": "case-sla-service"
  },
  "tenant": {
    "id": "agency-cea"
  },
  "subject": {
    "type": "Case",
    "id": "CASE-2026-00042"
  },
  "time": {
    "requestedAt": "2026-06-18T10:00:00Z",
    "validUntil": null
  },
  "trace": {
    "correlationId": "corr-001",
    "causationId": "sla-scan-2026-06-18"
  },
  "payload": {
    "reasonCode": "SLA_BREACH",
    "targetState": "ESCALATED"
  }
}
```

### 20.4 Envelope for Event

```json
{
  "messageId": "evt-2026-000001",
  "messageKind": "EVENT",
  "messageType": "CaseEscalated",
  "messageVersion": 1,
  "source": {
    "system": "case-service"
  },
  "tenant": {
    "id": "agency-cea"
  },
  "subject": {
    "type": "Case",
    "id": "CASE-2026-00042"
  },
  "time": {
    "occurredAt": "2026-06-18T10:00:05Z",
    "publishedAt": "2026-06-18T10:00:06Z"
  },
  "trace": {
    "correlationId": "corr-001",
    "causationId": "cmd-2026-000001"
  },
  "payload": {
    "previousState": "UNDER_REVIEW",
    "newState": "ESCALATED",
    "reasonCode": "SLA_BREACH"
  }
}
```

### 20.5 Envelope for Reply

```json
{
  "messageId": "reply-2026-000001",
  "messageKind": "REPLY",
  "messageType": "ScreeningResultReply",
  "messageVersion": 1,
  "source": {
    "system": "screening-service"
  },
  "subject": {
    "type": "ScreeningRequest",
    "id": "scr-001"
  },
  "time": {
    "repliedAt": "2026-06-18T10:00:10Z"
  },
  "trace": {
    "correlationId": "corr-001",
    "causationId": "cmd-screening-001"
  },
  "payload": {
    "status": "MATCH_FOUND",
    "score": 0.91
  }
}
```

---

## 21. JMS Properties for the Envelope

Jika body memakai envelope di atas, set properties yang dibutuhkan broker/ops:

```text
messageId       = cmd-2026-000001
messageKind     = COMMAND
messageType     = EscalateCase
messageVersion  = 1
tenantId        = agency-cea
sourceSystem    = case-sla-service
aggregateType   = Case
aggregateId     = CASE-2026-00042
correlationId   = corr-001
causationId     = sla-scan-2026-06-18
contentType     = application/json
contentEncoding = utf-8
```

Minimal properties:

```text
messageKind
messageType
messageVersion
correlationId
aggregateId
contentType
```

Untuk multi-tenant:

```text
tenantId wajib
```

Untuk replay/dedup:

```text
messageId atau idempotencyKey sangat disarankan
```

---

## 22. Java 8 Style Example: Creating a Message with Headers and Properties

Contoh dengan classic JMS 1.1/2.0 style `javax.jms`:

```java
import javax.jms.Connection;
import javax.jms.ConnectionFactory;
import javax.jms.DeliveryMode;
import javax.jms.Destination;
import javax.jms.MessageProducer;
import javax.jms.Session;
import javax.jms.TextMessage;

public final class CaseEscalationProducerJava8 {

    private final ConnectionFactory connectionFactory;
    private final Destination destination;

    public CaseEscalationProducerJava8(ConnectionFactory connectionFactory,
                                       Destination destination) {
        this.connectionFactory = connectionFactory;
        this.destination = destination;
    }

    public void sendEscalateCaseCommand() throws Exception {
        String commandId = "cmd-2026-000001";
        String correlationId = "corr-001";
        String caseId = "CASE-2026-00042";

        String json = "{"
                + "\"messageId\":\"" + commandId + "\"," 
                + "\"messageKind\":\"COMMAND\"," 
                + "\"messageType\":\"EscalateCase\"," 
                + "\"messageVersion\":1," 
                + "\"subject\":{\"type\":\"Case\",\"id\":\"" + caseId + "\"},"
                + "\"trace\":{\"correlationId\":\"" + correlationId + "\"},"
                + "\"payload\":{\"reasonCode\":\"SLA_BREACH\"}"
                + "}";

        Connection connection = null;
        Session session = null;

        try {
            connection = connectionFactory.createConnection();
            session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);

            TextMessage message = session.createTextMessage(json);

            message.setJMSCorrelationID(correlationId);
            message.setJMSType("EscalateCase");

            message.setStringProperty("messageId", commandId);
            message.setStringProperty("messageKind", "COMMAND");
            message.setStringProperty("messageType", "EscalateCase");
            message.setIntProperty("messageVersion", 1);
            message.setStringProperty("tenantId", "agency-cea");
            message.setStringProperty("sourceSystem", "case-sla-service");
            message.setStringProperty("aggregateType", "Case");
            message.setStringProperty("aggregateId", caseId);
            message.setStringProperty("correlationId", correlationId);
            message.setStringProperty("contentType", "application/json");
            message.setStringProperty("contentEncoding", "utf-8");

            MessageProducer producer = session.createProducer(destination);
            producer.setDeliveryMode(DeliveryMode.PERSISTENT);
            producer.setPriority(4);
            producer.setTimeToLive(0L);

            producer.send(message);
        } finally {
            if (session != null) {
                try { session.close(); } catch (Exception ignored) { }
            }
            if (connection != null) {
                try { connection.close(); } catch (Exception ignored) { }
            }
        }
    }
}
```

Catatan:

- Java 8 biasanya memakai `javax.jms` jika berada di Java EE/JMS legacy ecosystem.
- Jangan membuat connection/session per message dalam hot path production tanpa pooling/caching; contoh ini hanya memperjelas anatomy.
- Untuk production, connection/session lifecycle akan dibahas lebih dalam pada producer/consumer engineering dan framework integration.

---

## 23. Modern Jakarta Messaging Style Example

Contoh dengan `jakarta.jms` simplified API:

```java
import jakarta.jms.DeliveryMode;
import jakarta.jms.Destination;
import jakarta.jms.JMSContext;
import jakarta.jms.JMSProducer;

public final class CaseEscalationProducerJakarta {

    private final JMSContext context;
    private final Destination destination;

    public CaseEscalationProducerJakarta(JMSContext context, Destination destination) {
        this.context = context;
        this.destination = destination;
    }

    public void sendEscalateCaseCommand() {
        String commandId = "cmd-2026-000001";
        String correlationId = "corr-001";
        String caseId = "CASE-2026-00042";

        String json = """
            {
              "messageId": "cmd-2026-000001",
              "messageKind": "COMMAND",
              "messageType": "EscalateCase",
              "messageVersion": 1,
              "source": { "system": "case-sla-service" },
              "tenant": { "id": "agency-cea" },
              "subject": { "type": "Case", "id": "CASE-2026-00042" },
              "time": { "requestedAt": "2026-06-18T10:00:00Z" },
              "trace": { "correlationId": "corr-001" },
              "payload": { "reasonCode": "SLA_BREACH" }
            }
            """;

        JMSProducer producer = context.createProducer()
                .setDeliveryMode(DeliveryMode.PERSISTENT)
                .setPriority(4)
                .setTimeToLive(0L)
                .setJMSCorrelationID(correlationId)
                .setJMSType("EscalateCase")
                .setProperty("messageId", commandId)
                .setProperty("messageKind", "COMMAND")
                .setProperty("messageType", "EscalateCase")
                .setProperty("messageVersion", 1)
                .setProperty("tenantId", "agency-cea")
                .setProperty("sourceSystem", "case-sla-service")
                .setProperty("aggregateType", "Case")
                .setProperty("aggregateId", caseId)
                .setProperty("correlationId", correlationId)
                .setProperty("contentType", "application/json")
                .setProperty("contentEncoding", "utf-8");

        producer.send(destination, json);
    }
}
```

Text block membutuhkan Java 15+. Untuk Java 8–14, gunakan string biasa atau JSON serializer.

---

## 24. Receiving and Validating Message Anatomy

Consumer yang matang tidak langsung parse body dan execute side effect. Ia melakukan validation berlapis.

### 24.1 Validation Flow

```text
receive message
  -> read JMS headers
  -> read required properties
  -> validate messageKind/messageType/version/contentType
  -> validate correlation id exists
  -> parse body
  -> validate body envelope
  -> compare duplicated metadata
  -> perform idempotency check
  -> process business logic
  -> commit side effect + processed marker
  -> ack/commit JMS
```

### 24.2 Example Consumer Validation

```java
import jakarta.jms.Message;
import jakarta.jms.TextMessage;

public final class MessageAnatomyValidator {

    public ValidatedMessage validate(Message message) throws Exception {
        String jmsMessageId = message.getJMSMessageID();
        String jmsCorrelationId = message.getJMSCorrelationID();
        String messageType = message.getStringProperty("messageType");
        int messageVersion = message.getIntProperty("messageVersion");
        String contentType = message.getStringProperty("contentType");
        String aggregateId = message.getStringProperty("aggregateId");

        require(jmsMessageId != null && !jmsMessageId.isBlank(), "Missing JMSMessageID");
        require(jmsCorrelationId != null && !jmsCorrelationId.isBlank(), "Missing JMSCorrelationID");
        require("EscalateCase".equals(messageType), "Unsupported messageType: " + messageType);
        require(messageVersion >= 1, "Invalid messageVersion: " + messageVersion);
        require("application/json".equals(contentType), "Unsupported contentType: " + contentType);
        require(aggregateId != null && !aggregateId.isBlank(), "Missing aggregateId");

        if (!(message instanceof TextMessage)) {
            throw new IllegalArgumentException("Expected TextMessage but got " + message.getClass().getName());
        }

        String json = ((TextMessage) message).getText();
        require(json != null && !json.isBlank(), "Empty body");

        return new ValidatedMessage(
                jmsMessageId,
                jmsCorrelationId,
                messageType,
                messageVersion,
                aggregateId,
                json
        );
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalArgumentException(message);
        }
    }

    public static final class ValidatedMessage {
        public final String jmsMessageId;
        public final String correlationId;
        public final String messageType;
        public final int messageVersion;
        public final String aggregateId;
        public final String body;

        public ValidatedMessage(String jmsMessageId,
                                String correlationId,
                                String messageType,
                                int messageVersion,
                                String aggregateId,
                                String body) {
            this.jmsMessageId = jmsMessageId;
            this.correlationId = correlationId;
            this.messageType = messageType;
            this.messageVersion = messageVersion;
            this.aggregateId = aggregateId;
            this.body = body;
        }
    }
}
```

### 24.3 Mismatch Handling

Misalnya:

```text
property.messageType = EscalateCase
body.messageType     = ApproveCase
```

Jangan diam-diam pilih salah satu.

Policy yang lebih aman:

```text
Mismatch metadata duplicated across property/body -> invalid message -> reject to DLQ/quarantine with reason.
```

Kenapa?

Karena mismatch bisa menunjukkan:

- bug producer,
- bad replay tooling,
- message tampering,
- schema converter error,
- wrong routing,
- serialization bug.

---

## 25. Message Contract untuk Sistem Regulated

Dalam sistem regulasi/case management, message bukan hanya data untuk program. Message adalah artifact yang bisa ditanya:

1. Kenapa case berubah state?
2. Siapa/apa yang memicu perubahan?
3. Kapan event terjadi?
4. Sistem mana yang mem-publish?
5. Message mana yang menyebabkan event ini?
6. Apakah message diproses sekali atau beberapa kali?
7. Apakah ada redelivery?
8. Apakah message pernah masuk DLQ?
9. Apakah message direplay?
10. Apakah payload berubah antar versi?

Karena itu message harus membawa metadata audit minimal.

### 25.1 Audit-Oriented Fields

```text
messageId
messageKind
messageType
messageVersion
sourceSystem
sourceModule
actorType
actorId or system actor
subjectType
subjectId
occurredAt/requestedAt
publishedAt
correlationId
causationId
reasonCode
payloadHash
```

### 25.2 Payload Hash

Untuk audit integrity, producer bisa menghitung hash body canonical.

```text
property.payloadSha256 = <sha256>
body.integrity.sha256  = <sha256>
```

Consumer bisa verify.

Namun canonical JSON hashing perlu hati-hati karena whitespace/order field bisa berubah.

Better:

- canonicalize JSON,
- hash serialized bytes final,
- store hash di audit log,
- avoid modifying body after hash.

### 25.3 Replay Metadata

Tambahkan saat replay:

```text
property.replay = true
property.replayId = replay-2026-001
property.originalMessageId = evt-001
property.replayReason = DLQ_REPAIR
```

Dalam body:

```json
{
  "replay": {
    "isReplay": true,
    "replayId": "replay-2026-001",
    "originalMessageId": "evt-001",
    "reason": "DLQ_REPAIR",
    "requestedBy": "ops-user-123",
    "requestedAt": "2026-06-18T12:00:00Z"
  }
}
```

Replay harus terlihat. Replay yang tidak terlihat menciptakan audit gap.

---

## 26. Message Anatomy and DLQ Triage

Saat message masuk DLQ, operator sering tidak punya source code atau konteks penuh. Mereka butuh metadata yang bisa dibaca cepat.

Properties yang membantu DLQ triage:

```text
messageId
messageKind
messageType
messageVersion
tenantId
sourceSystem
aggregateType
aggregateId
correlationId
causationId
contentType
failureClass      // mungkin ditambahkan oleh error handler
failureReason     // ringkas, non-sensitive
firstFailureAt
lastFailureAt
redeliveryCount
```

Body harus cukup untuk memahami kasus.

### 26.1 Bad DLQ Message

```text
Destination: DLQ
Body: { "id": "123" }
Properties: none
```

Operator bertanya:

- Ini message apa?
- Dari sistem mana?
- Untuk consumer mana?
- Kenapa gagal?
- Aman direplay atau tidak?
- Entity apa yang terdampak?

### 26.2 Good DLQ Message

```text
Properties:
  messageId       = cmd-2026-000001
  messageKind     = COMMAND
  messageType     = EscalateCase
  messageVersion  = 1
  tenantId        = agency-cea
  aggregateType   = Case
  aggregateId     = CASE-2026-00042
  correlationId   = corr-001
  sourceSystem    = case-sla-service
  contentType     = application/json

Body:
  full envelope + payload

Broker/handler added:
  failureReason   = OptimisticLockException after 5 retries
  redeliveryCount = 5
```

Operator bisa langsung:

- identify affected case,
- search logs by correlationId,
- inspect producer service,
- decide replay/repair,
- attach audit evidence.

---

## 27. Message Anatomy and Observability

Message metadata harus align dengan logs, metrics, dan tracing.

### 27.1 Log Fields

Setiap producer log minimal:

```text
messageId
messageKind
messageType
messageVersion
destination
correlationId
aggregateId
sourceSystem
```

Consumer log minimal:

```text
jmsMessageId
messageId
messageType
correlationId
aggregateId
redelivered
processingResult
latencyMs
```

### 27.2 Metrics Labels

Metrics label harus hati-hati agar cardinality tidak meledak.

Baik:

```text
messageType
messageKind
consumerName
destination
result
```

Buruk sebagai metric label:

```text
messageId
correlationId
aggregateId
userId
```

Gunakan high-cardinality ID di logs/traces, bukan metrics label.

### 27.3 Trace Propagation

JMS tidak otomatis menyelesaikan distributed tracing semantic untuk semua environment. Kamu harus propagate trace context.

Properties:

```text
traceparent
tracestate
correlationId
```

Body:

```json
"trace": {
  "correlationId": "corr-001",
  "traceId": "...",
  "spanId": "..."
}
```

### 27.4 Latency Metrics

Dengan metadata waktu:

```text
producer publish latency
broker queue age
consumer processing latency
end-to-end business latency
redelivery delay
DLQ time-to-detect
```

Tanpa anatomy metadata yang benar, kamu hanya punya queue depth dan error count. Itu tidak cukup untuk top-tier operations.

---

## 28. Message Anatomy and Security

### 28.1 Jangan Menaruh PII di Properties Jika Tidak Perlu

Properties sering terlihat di:

- broker console,
- admin logs,
- selector tooling,
- metrics/tracing,
- DLQ browser,
- support screenshots.

Hindari:

```text
applicantName
email
phone
nationalId
address
freeTextComment
```

Masukkan ke body dengan kontrol akses yang lebih jelas, atau simpan sebagai reference.

### 28.2 Payload Encryption

Jika body mengandung sensitive data:

- gunakan TLS untuk in-transit,
- at-rest encryption di broker/storage,
- payload-level encryption untuk high-sensitivity data,
- metadata minimization,
- key rotation strategy,
- avoid leaking sensitive field in error message.

### 28.3 Security Classification

Tambahkan metadata non-sensitive:

```text
classification = INTERNAL | CONFIDENTIAL | RESTRICTED
```

Jangan jadikan classification sebagai pengaman tunggal. Itu hanya label untuk policy enforcement.

### 28.4 Tenant Isolation

Untuk multi-tenant:

```text
tenantId in property
 tenantId in body
 authorization on destination
 consumer validates tenantId
 producer identity restricted
```

Jangan hanya percaya producer.

Consumer harus validate:

```text
Is this consumer allowed to process tenantId X?
```

### 28.5 Invariant

```text
Metadata yang terlihat luas harus minim dan non-sensitive; payload yang sensitive harus dilindungi secara eksplisit.
```

---

## 29. Message Anatomy and Versioning

Message contract berubah seiring waktu. Anatomy yang baik membuat perubahan lebih aman.

### 29.1 Version Field

Minimal:

```text
property.messageVersion = 2
body.messageVersion = 2
```

Lebih lengkap:

```json
"schema": {
  "name": "case.lifecycle.CaseEscalated",
  "version": 2
}
```

### 29.2 Compatible Change

Biasanya aman:

- tambah optional field,
- tambah enum value jika consumer toleran,
- tambah metadata baru,
- memperluas payload dengan default.

Berisiko/breaking:

- rename field,
- remove field,
- ubah tipe field,
- ubah semantic field,
- ubah meaning enum,
- ubah requiredness,
- pindah event meaning ke event type yang sama.

### 29.3 Consumer Strategy

Consumer harus:

```text
accept known versions
reject unsupported major version
ignore unknown optional fields
validate required fields
log contract violation clearly
```

### 29.4 Version in Destination Name?

Kadang queue/topic diberi versi:

```text
topic://case.lifecycle.v1
```

Ini bisa berguna untuk major migration, tetapi jangan terlalu sering.

Lebih fleksibel:

```text
topic://case.lifecycle
property.messageType=CaseEscalated
property.messageVersion=1
```

Untuk breaking migration besar:

```text
topic://case.lifecycle.v2
```

### 29.5 Invariant

```text
Version adalah bagian dari semantic contract, bukan detail serializer.
```

---

## 30. Message Anatomy and Idempotency

### 30.1 Field yang Dibutuhkan

Untuk idempotent consumer, message perlu membawa identity stabil.

Contoh:

```text
messageId       = evt-001
idempotencyKey  = Case:CASE-123:Escalated:v7
aggregateId     = CASE-123
messageType     = CaseEscalated
```

### 30.2 Message ID vs Idempotency Key

`messageId` menjawab:

```text
Apakah message yang sama sudah pernah diproses?
```

`idempotencyKey` menjawab:

```text
Apakah operasi bisnis yang sama sudah pernah diterapkan?
```

Contoh duplicate producer menghasilkan dua message ID berbeda untuk operasi sama:

```text
messageId=cmd-001, idempotencyKey=Case:123:Escalate:stateVersion5
messageId=cmd-002, idempotencyKey=Case:123:Escalate:stateVersion5
```

Dedup by messageId gagal. Dedup by idempotencyKey berhasil.

### 30.3 Consumer Processed Table

```sql
CREATE TABLE processed_message (
    consumer_name       VARCHAR(100) NOT NULL,
    message_id          VARCHAR(100) NOT NULL,
    idempotency_key     VARCHAR(300),
    message_type        VARCHAR(100) NOT NULL,
    aggregate_id        VARCHAR(100),
    processed_at        TIMESTAMP NOT NULL,
    PRIMARY KEY (consumer_name, message_id)
);

CREATE UNIQUE INDEX ux_processed_idempotency
ON processed_message (consumer_name, idempotency_key)
WHERE idempotency_key IS NOT NULL;
```

Oracle tidak memiliki partial index dengan syntax PostgreSQL seperti itu, tetapi konsepnya bisa diadaptasi dengan function-based index atau desain tabel berbeda.

### 30.4 Invariant

```text
Message anatomy harus membawa identity yang cukup untuk dedup dan idempotency. Broker redelivery flag tidak cukup.
```

---

## 31. Message Anatomy and State Machines

Untuk workflow/case management, message sering merepresentasikan state transition.

### 31.1 Bad Message

```json
{
  "caseId": "CASE-123",
  "status": "ESCALATED"
}
```

Masalah:

- previous state tidak jelas,
- reason tidak jelas,
- actor tidak jelas,
- command/event tidak jelas,
- transition invariant tidak jelas,
- idempotency sulit.

### 31.2 Better State Transition Event

```json
{
  "messageId": "evt-001",
  "messageKind": "EVENT",
  "messageType": "CaseStateChanged",
  "messageVersion": 1,
  "subject": {
    "type": "Case",
    "id": "CASE-123"
  },
  "payload": {
    "fromState": "UNDER_REVIEW",
    "toState": "ESCALATED",
    "transition": "ESCALATE_DUE_TO_SLA_BREACH",
    "reasonCode": "SLA_BREACH",
    "stateVersionBefore": 7,
    "stateVersionAfter": 8
  }
}
```

### 31.3 Consumer Invariant

Consumer bisa validate:

```text
if current_state_version >= stateVersionAfter:
    already applied or stale -> idempotent handling
else if current_state_version != stateVersionBefore:
    conflict -> DLQ/reconcile
else:
    apply transition
```

Ini jauh lebih defensible daripada hanya menerima status baru.

---

## 32. Message Anatomy and Routing

### 32.1 Routing by Destination

```text
queue://case.escalation.command
```

Simple, clear, strong isolation.

### 32.2 Routing by Property

```text
topic://case.lifecycle
selector: messageType = 'CaseEscalated'
```

Flexible, but selector cost and governance matter.

### 32.3 Routing by Body

Broker tidak membaca body untuk JMS selector standar.

Jika butuh content-based routing berdasarkan body:

- buat router consumer,
- parse body,
- publish ke destination turunan,
- atau gunakan integration framework seperti Camel,
- atau desain property yang cukup.

### 32.4 Bad Pattern

```text
All messages -> single queue -> consumer parses JSON type -> dispatch internally
```

Ini bisa menjadi bottleneck dan coupling point.

### 32.5 Better Pattern

```text
Commands separated by ownership:
  case.command.queue
  notification.command.queue
  document.command.queue

Events grouped by domain:
  case.lifecycle.topic
  payment.lifecycle.topic

Properties classify type/version/tenant.
```

---

## 33. Common Anti-Patterns

### 33.1 Payload-Only Message

```text
No properties, no correlation, no type, no version.
```

Dampak:

- DLQ sulit dianalisis,
- selector mustahil,
- replay risk tinggi,
- contract tidak jelas,
- observability buruk.

### 33.2 Everything in Properties

Dampak:

- metadata overload,
- sensitive data leak,
- broker pressure,
- schema chaos,
- poor payload contract.

### 33.3 Correlation ID as Business ID

Dampak:

- dedup salah,
- multiple messages dalam satu process dianggap duplicate,
- saga tracing kacau.

### 33.4 JMSMessageID as Event ID

Dampak:

- replay menghasilkan ID baru,
- business audit lemah,
- provider lock-in.

### 33.5 TTL for Important Business Commands

Dampak:

- silent loss,
- stuck workflow,
- audit gap.

### 33.6 Sensitive Data in Header/Property

Dampak:

- exposed in broker console,
- logs/metrics leakage,
- compliance issue.

### 33.7 Unversioned Body

Dampak:

- consumer break saat producer berubah,
- no graceful migration,
- replay lama gagal.

### 33.8 Message Type Derived Only from Queue Name

Dampak:

- DLQ loses semantic context,
- topology refactor breaks meaning,
- replay tooling fragile.

---

## 34. Production Checklist

Sebelum sebuah message contract dianggap siap production, cek:

### 34.1 Identity

- [ ] Ada stable `messageId`/`eventId`/`commandId` di body.
- [ ] `JMSMessageID` tidak dijadikan business ID utama.
- [ ] Ada idempotency key jika operasi bisa dikirim ulang dengan semantic yang sama.

### 34.2 Type and Version

- [ ] Ada `messageKind`.
- [ ] Ada `messageType`.
- [ ] Ada `messageVersion` atau schema version.
- [ ] Consumer behavior untuk unsupported version jelas.

### 34.3 Correlation

- [ ] Ada `correlationId`.
- [ ] Ada `causationId` untuk chain penting.
- [ ] `JMSCorrelationID` diisi dari correlation id.
- [ ] Logs menggunakan correlation id yang sama.

### 34.4 Routing and Filtering

- [ ] Properties cukup untuk selector/routing yang dibutuhkan.
- [ ] Tidak ada selector kompleks yang menjadikan broker query engine.
- [ ] Destination name tidak menjadi satu-satunya semantic contract.

### 34.5 Time

- [ ] Ada occurred/requested time dalam body.
- [ ] Ada published time jika perlu latency breakdown.
- [ ] TTL hanya dipakai jika loss setelah expiry acceptable.
- [ ] Business validity tidak selalu disamakan dengan JMS expiration.

### 34.6 Security

- [ ] Tidak ada PII/sensitive field di properties/header kecuali benar-benar perlu.
- [ ] Payload sensitive dilindungi.
- [ ] Tenant id divalidasi.
- [ ] Classification jelas jika dibutuhkan.

### 34.7 Observability

- [ ] Producer log message metadata utama.
- [ ] Consumer log metadata utama.
- [ ] Metrics tidak memakai high-cardinality labels.
- [ ] Trace context/correlation context dipropagate.

### 34.8 DLQ and Replay

- [ ] DLQ message masih bisa dipahami tanpa source context.
- [ ] Replay metadata tersedia.
- [ ] Duplicate/replay bisa dibedakan.
- [ ] Payload self-contained enough untuk repair.

### 34.9 Validation

- [ ] Consumer validate properties dan body.
- [ ] Mismatch property/body dianggap invalid.
- [ ] Required field jelas.
- [ ] Unknown optional field ditoleransi jika compatible.

---

## 35. Worked Example: Case Escalation Command End-to-End

### 35.1 Scenario

Sistem SLA menemukan case yang melewati batas waktu review. Ia mengirim command ke case service untuk escalation.

### 35.2 Destination

```text
queue://case.command.escalate
```

### 35.3 JMS Headers

```text
JMSDeliveryMode   = PERSISTENT
JMSPriority       = 4
JMSExpiration     = 0
JMSCorrelationID  = corr-case-2026-00042
JMSType           = EscalateCase
```

### 35.4 JMS Properties

```text
messageId         = cmd-2026-000001
messageKind       = COMMAND
messageType       = EscalateCase
messageVersion    = 1
tenantId          = agency-cea
sourceSystem      = case-sla-service
aggregateType     = Case
aggregateId       = CASE-2026-00042
correlationId     = corr-case-2026-00042
causationId       = sla-scan-2026-06-18T10
contentType       = application/json
contentEncoding   = utf-8
idempotencyKey    = Case:CASE-2026-00042:Escalate:SLA_BREACH:stateVersion7
```

### 35.5 Body

```json
{
  "messageId": "cmd-2026-000001",
  "messageKind": "COMMAND",
  "messageType": "EscalateCase",
  "messageVersion": 1,
  "source": {
    "system": "case-sla-service",
    "module": "sla-monitor"
  },
  "tenant": {
    "id": "agency-cea"
  },
  "subject": {
    "type": "Case",
    "id": "CASE-2026-00042"
  },
  "time": {
    "requestedAt": "2026-06-18T10:00:00Z",
    "publishedAt": "2026-06-18T10:00:02Z",
    "validUntil": null
  },
  "trace": {
    "correlationId": "corr-case-2026-00042",
    "causationId": "sla-scan-2026-06-18T10"
  },
  "idempotency": {
    "key": "Case:CASE-2026-00042:Escalate:SLA_BREACH:stateVersion7"
  },
  "payload": {
    "expectedCurrentState": "UNDER_REVIEW",
    "expectedStateVersion": 7,
    "targetState": "ESCALATED",
    "reasonCode": "SLA_BREACH",
    "requestedBy": {
      "type": "SYSTEM",
      "id": "sla-monitor"
    }
  }
}
```

### 35.6 Consumer Logic

```text
receive
validate headers/properties
parse body
compare property/body metadata
check idempotency key
load case
if case stateVersion > expectedStateVersion:
    determine already applied/stale/conflict
if case state != expectedCurrentState:
    reject or no-op based on policy
apply transition
insert processed message record
commit DB
ack/commit JMS
publish CaseEscalated event via outbox
```

### 35.7 Failure Handling

| Failure | Expected behavior |
|---|---|
| Consumer crashes before DB commit | JMS redelivery; idempotency no record yet |
| Consumer crashes after DB commit before ack | JMS redelivery; idempotency catches duplicate |
| State already escalated | idempotent success if same transition |
| State changed to CLOSED | reject to DLQ/manual reconciliation |
| Invalid messageVersion | DLQ unsupported contract |
| Missing correlationId | DLQ invalid metadata |
| Duplicate command with different messageId same idempotencyKey | dedup as duplicate operation |

---

## 36. Mental Model Summary

### 36.1 Message Has Three Jobs

```text
1. Tell broker how to deliver it.
2. Tell consumers how to classify and validate it.
3. Tell future humans/systems what it meant.
```

Header mostly supports job 1.  
Properties support job 2 and operational visibility.  
Body supports job 3 and business processing.

### 36.2 Top 1% Heuristic

A top-tier engineer does not ask only:

```text
Can I send this object through JMS?
```

They ask:

```text
Can this message survive delay, duplicate delivery, redelivery, replay, DLQ, schema evolution, broker migration, audit review, and incident reconstruction?
```

Jika jawabannya belum, message contract belum matang.

---

## 37. Latihan

### Latihan 1 — Metadata Placement

Untuk message `SendLicenceRenewalReminder`, tentukan mana yang masuk header, property, dan body:

- reminderId
- licenceId
- applicantEmail
- tenantId
- templateCode
- correlationId
- retryCount
- validUntil
- messageVersion
- contentType
- actorId

Jawab dengan alasan security, routing, dan audit.

### Latihan 2 — Correlation Chain

Buat chain metadata untuk flow:

```text
User submits application
-> ApplicationSubmitted event
-> ScreeningRequested command
-> ScreeningCompleted event
-> CaseCreated event
```

Tentukan:

- messageId tiap step,
- correlationId,
- causationId,
- aggregateId.

### Latihan 3 — DLQ Diagnosis

Message masuk DLQ dengan property:

```text
messageType=ApproveCase
aggregateId=CASE-123
correlationId=corr-777
messageVersion=2
```

Body berisi:

```json
{
  "messageType": "RejectCase",
  "messageVersion": 2,
  "subject": { "id": "CASE-123" }
}
```

Apa yang harus dilakukan consumer?  
Apa kemungkinan root cause?  
Metadata tambahan apa yang seharusnya ada?

### Latihan 4 — TTL Decision

Untuk tiap message berikut, tentukan TTL:

1. `PaymentCapturedEvent`
2. `RefreshDashboardWidgetCommand`
3. `SendOtpEmailCommand`
4. `CaseEscalationCommand`
5. `UserTypingNotification`

Jelaskan reasoning, bukan hanya angka.

### Latihan 5 — Design Review

Ambil salah satu message dari sistem nyata. Review dengan checklist:

- identity,
- type/version,
- correlation,
- routing,
- security,
- DLQ,
- replay,
- idempotency,
- observability.

---

## 38. Part Ini Tidak Membahas Secara Penuh

Agar tidak mengulang atau terlalu melebar, part ini belum membahas detail penuh:

- tipe body satu per satu (`TextMessage`, `BytesMessage`, dll.) — masuk Part 6,
- producer tuning — masuk Part 7,
- consumer tuning — masuk Part 8,
- acknowledgement — masuk Part 9,
- transaction/outbox — masuk Part 10,
- idempotency detail — masuk Part 24,
- selector performance detail — masuk Part 15,
- DLQ/retry detail — masuk Part 13,
- observability dashboard — masuk Part 27.

Part ini hanya membangun fondasi anatomy dan semantic contract.

---

## 39. Referensi

- Jakarta Messaging 3.1 Specification — https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html
- Jakarta Messaging 3.1 API Package Summary — https://jakarta.ee/specifications/messaging/3.1/apidocs/jakarta.messaging/jakarta/jms/package-summary
- Jakarta Messaging `Message` API — https://jakarta.ee/specifications/messaging/3.0/apidocs/jakarta/jms/message
- Jakarta EE 8 `javax.jms.Message` API — https://jakarta.ee/specifications/platform/8/apidocs/javax/jms/message
- Apache ActiveMQ Artemis JMS Usage Documentation — https://artemis.apache.org/components/artemis/documentation/latest/using-jms.html
- ActiveMQ Classic JMS Selectors Documentation — https://activemq.apache.org/components/classic/documentation/selectors
- IBM MQ JMS Message Documentation — https://www.ibm.com/docs/en/ibm-mq/9.3.x?topic=messaging-jmsmessage

---

## 40. Ringkasan Akhir

Message anatomy adalah fondasi dari semua desain JMS yang matang.

Jika message hanya dianggap payload, sistem akan rapuh saat menghadapi:

- redelivery,
- duplicate,
- DLQ,
- replay,
- audit,
- versioning,
- security,
- routing,
- incident debugging.

Struktur yang kuat membedakan:

```text
Header     -> delivery/control metadata
Properties -> operational/application classification metadata
Body       -> semantic business contract
```

Prinsip utama:

```text
A message must be understandable by the broker, by the consumer, and by future operators after something goes wrong.
```

Itulah standar desain message untuk sistem enterprise yang serius.

---

**Status seri:** Part 5 selesai. Seri belum selesai. Lanjut ke Part 6: **Message Types: TextMessage, BytesMessage, MapMessage, ObjectMessage, StreamMessage, Generic Message**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-004.md">⬅️ Part 4 — Topic Semantics: Publish/Subscribe, Broadcast, Durable Subscription, Shared Subscription</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-006.md">Part 6 — Message Types: TextMessage, BytesMessage, MapMessage, ObjectMessage, StreamMessage, Generic Message ➡️</a>
</div>
