# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-023

# Part 23 — Schema and Contract Engineering: Versioning, Compatibility, Envelope, Registry, dan Consumer Evolution

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Target: Java 8 sampai Java 25  
> Fokus: JMS / Jakarta Messaging sebagai kontrak integrasi enterprise  
> Posisi: Part 23 dari 35  
> Status seri: belum selesai

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas JMS dari banyak sisi: domain model, queue/topic, acknowledgement, transaksi, reliability, ordering, retry, security, broker architecture, provider differences, Jakarta EE runtime, Spring integration, dan microservices.

Part ini masuk ke satu area yang sering terlihat sederhana, tetapi dalam sistem enterprise justru menjadi sumber kerusakan paling mahal:

> **message contract.**

Banyak engineer mengira contract messaging hanya berarti:

```json
{
  "caseId": "C-1001",
  "status": "APPROVED"
}
```

Padahal dalam sistem nyata, contract mencakup:

1. struktur payload,
2. semantic meaning,
3. identifier,
4. lifecycle event,
5. ordering expectation,
6. versioning rule,
7. compatibility rule,
8. default value,
9. nullability,
10. required/optional fields,
11. producer ownership,
12. consumer obligation,
13. deprecation policy,
14. replay behavior,
15. auditability,
16. security classification,
17. operational response saat contract mismatch.

Di sistem synchronous seperti REST, contract mismatch biasanya langsung terlihat: request gagal, response error, client tahu saat itu juga.

Di messaging, contract mismatch bisa lebih berbahaya karena:

- producer mungkin sudah berhasil publish,
- broker menerima message,
- consumer baru gagal beberapa menit/jam kemudian,
- error masuk DLQ tanpa business owner sadar,
- sebagian consumer berhasil, sebagian gagal,
- replay bisa menghasilkan hasil berbeda,
- data lama masih hidup di queue/topic,
- versi lama dan baru dapat coexist dalam waktu lama.

Part ini bertujuan membuat pemahaman yang kuat bahwa:

> **Message schema adalah API yang hidup di waktu berbeda.**

REST API hidup saat request berlangsung.  
Message API bisa hidup jauh setelah producer selesai, bahkan setelah producer versi lama sudah tidak ada.

---

## 1. Mental Model Utama: Message Contract Adalah API yang Berjalan Melewati Waktu

Dalam synchronous API, hubungan client-server biasanya seperti ini:

```text
Client v3  --->  Server v3
       request sekarang
       response sekarang
```

Dalam JMS, hubungan producer-consumer lebih seperti ini:

```text
Producer v1  --->  Broker  --->  Consumer v1
Producer v2  --->  Broker  --->  Consumer v1
Producer v2  --->  Broker  --->  Consumer v2
Producer v3  --->  Broker  --->  Consumer v1/v2/v3

Message lama mungkin masih tersimpan, tertunda, retry, DLQ, atau replay.
```

Artinya, contract messaging harus tahan terhadap:

1. **version skew** — producer dan consumer tidak deploy bersamaan,
2. **temporal delay** — message dibuat di masa lalu, diproses di masa depan,
3. **partial rollout** — sebagian instance sudah versi baru, sebagian belum,
4. **multiple consumers** — tiap consumer punya kebutuhan dan versi berbeda,
5. **replay** — message lama dapat diproses ulang setelah code berubah,
6. **dead letter repair** — message rusak mungkin diperbaiki dan dikirim ulang,
7. **integration drift** — semantic business berubah, payload lama masih ada.

Contract messaging yang buruk membuat sistem asynchronous menjadi rapuh.

Contract messaging yang baik membuat sistem asynchronous bisa berevolusi tanpa koordinasi deploy yang ekstrem.

---

## 2. Apa Itu Schema, Apa Itu Contract?

Kita perlu membedakan dua istilah:

```text
Schema   = bentuk data yang bisa divalidasi secara struktural.
Contract = janji semantik antara producer, broker, consumer, operator, dan auditor.
```

Schema menjawab:

- field apa saja yang ada?
- tipe field apa?
- mana required?
- mana optional?
- format tanggal apa?
- enum value apa?
- apakah nested object valid?

Contract menjawab:

- event ini berarti apa?
- siapa pemilik field ini?
- kapan event boleh dipublish?
- apakah event ini fakta masa lalu atau command masa depan?
- apakah event boleh duplicate?
- apakah consumer boleh mengabaikan field baru?
- apakah field boleh null?
- bagaimana interpretasi missing field?
- apakah message boleh direplay?
- apakah message mengandung PII?
- apa consequence jika consumer gagal decode?

Contoh schema:

```json
{
  "type": "object",
  "required": ["eventId", "caseId", "occurredAt"],
  "properties": {
    "eventId": { "type": "string" },
    "caseId": { "type": "string" },
    "occurredAt": { "type": "string", "format": "date-time" },
    "status": { "type": "string" }
  }
}
```

Contoh contract:

```text
Event CaseStatusChanged berarti status case sudah berhasil berubah di source-of-truth Case Service.
Consumer boleh menganggap event ini sebagai fakta yang sudah terjadi, bukan request untuk mengubah status.
Jika status tidak dikenal, consumer harus park message ke contract-error DLQ, bukan mengabaikan diam-diam.
Field status wajib diisi untuk schema version 1.x.
Field statusReason optional dan jika tidak ada dianggap UNKNOWN_REASON.
Event dapat dikirim ulang; consumer wajib idempotent berdasarkan eventId.
```

Schema tanpa contract menyebabkan data valid secara teknis tetapi salah secara bisnis.

Contract tanpa schema menyebabkan kesepakatan verbal yang tidak bisa dicek otomatis.

Top 1% engineer memperlakukan keduanya sebagai satu kesatuan:

```text
Good Messaging Design = Schema Validation + Semantic Contract + Evolution Policy + Operational Handling
```

---

## 3. Mengapa JMS Contract Lebih Sulit daripada HTTP Contract?

JMS bukan sekadar HTTP yang diganti queue. Ada beberapa perbedaan mendasar.

### 3.1 Waktu Hidup Message Lebih Panjang

HTTP request biasanya hilang setelah request selesai. JMS message bisa bertahan:

- di broker queue,
- di durable subscription,
- di retry delay,
- di DLQ,
- di parking lot,
- di audit archive,
- di replay store,
- di data lake,
- di backup.

Maka schema lama masih harus bisa dibaca lebih lama daripada periode rollout biasa.

### 3.2 Consumer Bisa Banyak dan Tidak Simetris

Satu event topic bisa punya consumer:

- notification service,
- reporting service,
- audit service,
- search indexing service,
- SLA timer service,
- integration adapter,
- compliance dashboard,
- archival pipeline.

Masing-masing consumer peduli pada subset field yang berbeda.

Perubahan yang aman untuk consumer A bisa merusak consumer B.

### 3.3 Producer Tidak Selalu Tahu Semua Consumer

Dalam publish/subscribe, producer sering tidak tahu siapa saja consumer-nya. Ini membuat perubahan contract harus konservatif.

Jika producer mengubah semantic field diam-diam, semua downstream bisa salah walau tidak ada compile error.

### 3.4 Broker Tidak Memahami Domain

JMS broker memahami:

- destination,
- header,
- property,
- delivery mode,
- selector,
- priority,
- TTL,
- acknowledgement,
- transaction.

Broker tidak tahu bahwa:

- `APPROVED` berbeda dari `AUTO_APPROVED`,
- `caseId` adalah aggregate id,
- `effectiveDate` tidak boleh sebelum `submittedAt`,
- event ini harus monotonic,
- field ini PII.

Domain contract harus dijaga di aplikasi dan governance.

### 3.5 Failure Bisa Terlihat sebagai Operasi Messaging, Bukan Contract Problem

Contract mismatch sering muncul sebagai:

- deserialization error,
- validation exception,
- null pointer,
- unknown enum,
- DLQ growth,
- consumer lag,
- retry storm,
- duplicate side effect,
- report discrepancy.

Tim operasi mungkin melihatnya sebagai “consumer error”, padahal akar masalahnya adalah contract evolution yang buruk.

---

## 4. Empat Layer Contract dalam JMS

Agar tidak rancu, pecah contract JMS menjadi empat layer.

```text
+-------------------------------------------------------------+
| 4. Business Semantic Contract                               |
|    meaning, lifecycle, ownership, invariant, replay rule      |
+-------------------------------------------------------------+
| 3. Payload Schema Contract                                  |
|    JSON/XML/Avro/Protobuf fields, types, enum, nullability    |
+-------------------------------------------------------------+
| 2. Message Envelope Contract                                |
|    eventId, type, version, source, time, traceId, tenant       |
+-------------------------------------------------------------+
| 1. JMS Transport Contract                                   |
|    destination, headers, properties, delivery mode, TTL, ack   |
+-------------------------------------------------------------+
```

### 4.1 JMS Transport Contract

Contoh:

- queue name: `case.command.create.v1`,
- topic name: `case.event.status.v1`,
- persistent delivery wajib,
- TTL 24 jam untuk command tertentu,
- property `messageType` wajib untuk selector,
- property `tenantId` wajib untuk isolation,
- `JMSCorrelationID` wajib untuk request/reply,
- `JMSReplyTo` hanya boleh untuk temporary response flow.

Layer ini terlihat oleh broker.

### 4.2 Message Envelope Contract

Envelope adalah metadata aplikasi yang biasanya ada di body, bukan hanya JMS header.

Contoh:

```json
{
  "meta": {
    "messageId": "01J4Z7Y5XVH3...",
    "messageType": "case.status.changed",
    "schemaVersion": "1.2.0",
    "producer": "case-service",
    "producerVersion": "2026.06.18-1432",
    "occurredAt": "2026-06-18T09:12:34Z",
    "publishedAt": "2026-06-18T09:12:35Z",
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "correlationId": "CASE-CMD-8891",
    "tenantId": "cea",
    "classification": "INTERNAL"
  },
  "data": {
    "caseId": "CASE-2026-0001",
    "oldStatus": "SUBMITTED",
    "newStatus": "APPROVED"
  }
}
```

Layer ini membuat message self-describing dan replayable.

### 4.3 Payload Schema Contract

Payload schema mendefinisikan `data`.

Contoh:

```json
{
  "caseId": "CASE-2026-0001",
  "oldStatus": "SUBMITTED",
  "newStatus": "APPROVED",
  "reasonCode": "AUTO_RULE_PASS"
}
```

Layer ini biasanya divalidasi dengan:

- JSON Schema,
- XML Schema / XSD,
- Avro schema,
- Protobuf definition,
- custom validator,
- Java DTO + Bean Validation.

### 4.4 Business Semantic Contract

Ini bagian yang paling sering tidak tertulis.

Contoh:

```text
CaseStatusChanged published only after status transition is committed in Case DB.
The event is a fact, not a command.
newStatus must be the current status after the transition.
oldStatus is best-effort previous state and should not be used as source of truth by consumers.
Consumers must use eventId for idempotency.
If consumer sees event version 1.x with unknown optional field, it must ignore it.
If consumer sees unknown newStatus, it must fail to contract DLQ.
```

Tanpa semantic contract, field terlihat sama tetapi interpretasinya bisa berbeda.

---

## 5. Message Envelope: Kenapa Diperlukan?

JMS sudah punya header seperti `JMSMessageID`, `JMSTimestamp`, `JMSCorrelationID`, `JMSDestination`, `JMSExpiration`, dan lain-lain. Lalu kenapa butuh envelope sendiri?

Karena JMS header adalah transport metadata, bukan full domain metadata.

### 5.1 JMSMessageID Bukan Business Event ID

`JMSMessageID` biasanya dibuat oleh provider saat message dikirim. Ia berguna untuk broker/debugging, tapi kurang ideal sebagai stable business id karena:

- format provider-specific,
- bisa berubah saat message direpublish,
- tidak selalu tersedia sebelum send,
- tidak mewakili domain event identity,
- sulit dipakai lintas broker/replay/archive.

Maka tetap gunakan application-level `eventId` / `messageId`.

```json
{
  "meta": {
    "messageId": "evt_01J4Z7Y5XVH3V9M6KJ9B8P7C2D"
  }
}
```

### 5.2 JMSTimestamp Bukan Selalu Business Occurred Time

`JMSTimestamp` adalah waktu provider menerima/send message. Business event bisa terjadi lebih awal.

Contoh:

```text
10:00:00 status case berubah di DB
10:00:03 outbox row dibuat
10:00:08 relay publish ke JMS
10:00:08 broker set JMSTimestamp
```

Jika consumer butuh waktu kejadian bisnis, gunakan `occurredAt`.

Jika consumer butuh waktu publish, gunakan `publishedAt`.

Jika consumer butuh broker time, lihat JMS timestamp.

Jangan campur.

### 5.3 JMSCorrelationID Tidak Cukup untuk Traceability

`JMSCorrelationID` sering dipakai untuk request/reply atau menghubungkan response ke request. Untuk observability modern, kita biasanya butuh:

- trace id,
- span id,
- correlation id,
- causation id,
- business process id,
- case id,
- command id,
- event id.

Contoh relasi:

```text
traceId       = distributed trace untuk observability
correlationId = satu business interaction/request besar
causationId   = message yang menyebabkan message ini dibuat
messageId     = identity message saat ini
caseId        = aggregate/business entity
```

### 5.4 Envelope Membantu Replay

Jika message masuk DLQ lalu direplay 2 minggu kemudian, consumer harus bisa tahu:

- message type,
- schema version,
- producer,
- occurredAt,
- idempotency id,
- tenant,
- original destination,
- retry/replay context,
- classification.

Tanpa envelope, replay berubah menjadi operasi manual berisiko tinggi.

---

## 6. Rekomendasi Envelope Standard untuk JMS Enterprise

Berikut desain envelope yang cukup matang untuk sistem enterprise.

```json
{
  "meta": {
    "messageId": "evt_01J4Z7Y5XVH3V9M6KJ9B8P7C2D",
    "messageType": "case.status.changed",
    "schemaVersion": "1.2.0",
    "schemaId": "case.status.changed:1.2.0",
    "producer": "case-service",
    "producerVersion": "2026.06.18.1",
    "sourceSystem": "aceas-case",
    "occurredAt": "2026-06-18T09:12:34Z",
    "publishedAt": "2026-06-18T09:12:35Z",
    "correlationId": "corr_01J4Z7...",
    "causationId": "cmd_01J4Z6...",
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "tenantId": "cea",
    "partitionKey": "CASE-2026-0001",
    "classification": "INTERNAL",
    "contentType": "application/json",
    "encoding": "utf-8"
  },
  "data": {
    "caseId": "CASE-2026-0001",
    "oldStatus": "SUBMITTED",
    "newStatus": "APPROVED",
    "reasonCode": "RULE_AUTO_PASS"
  }
}
```

### 6.1 Mandatory Envelope Fields

Untuk production-grade JMS, minimal metadata yang disarankan:

| Field | Wajib? | Fungsi |
|---|---:|---|
| `messageId` | Ya | Idempotency dan dedup |
| `messageType` | Ya | Routing dan handler selection |
| `schemaVersion` | Ya | Decode dan compatibility |
| `producer` | Ya | Ownership dan incident routing |
| `occurredAt` | Ya | Business timeline |
| `publishedAt` | Disarankan | Pipeline latency |
| `correlationId` | Ya | Trace bisnis lintas service |
| `traceId` | Disarankan | Observability teknis |
| `tenantId` | Jika multi-tenant | Isolation dan authorization |
| `classification` | Jika regulated | Security dan audit |
| `data` | Ya | Payload domain |

### 6.2 Field yang Sering Salah Dipakai

#### `messageId`

Harus unik untuk logical message. Jika message yang sama diretry, `messageId` sebaiknya tetap sama. Jika message baru hasil transformasi, gunakan `messageId` baru dan set `causationId` ke message asal.

#### `correlationId`

Jangan jadikan correlation id sebagai idempotency key. Satu correlation id bisa punya banyak message.

#### `schemaVersion`

Jangan hanya isi `v1` tanpa semantic rule. Gunakan model yang jelas: `major.minor.patch` atau integer version dengan policy eksplisit.

#### `messageType`

Jangan memakai Java class name sebagai message type.

Buruk:

```text
com.company.case.CaseStatusChangedEvent
```

Lebih baik:

```text
case.status.changed
```

Kenapa? Karena message contract harus stabil lintas bahasa, lintas runtime, dan lintas refactor Java package.

---

## 7. JMS Properties vs Envelope Metadata

JMS properties berguna untuk selector dan broker-level filtering. Envelope berguna untuk application-level processing.

Pertanyaannya: field mana yang harus ditaruh di JMS properties?

### 7.1 Rule of Thumb

Masukkan ke JMS properties hanya field yang perlu dibaca broker atau consumer sebelum deserialize body.

Contoh property yang masuk akal:

```text
messageType = case.status.changed
schemaVersion = 1.2.0
tenantId = cea
priorityClass = NORMAL
sourceSystem = aceas-case
```

Jangan masukkan seluruh domain data ke properties.

Buruk:

```text
caseId = CASE-001
applicantName = John
fullAddress = ...
statusReasonDescription = ...
```

Alasannya:

- property bukan tempat payload,
- selector kompleks menekan broker,
- property bisa bocor ke broker logs/admin UI,
- typing property terbatas,
- duplikasi body-property bisa drift.

### 7.2 Duplikasi Metadata Harus Dikendalikan

Jika `messageType` ada di property dan envelope, nilainya harus sama.

Saat mismatch:

```text
JMS property: messageType = case.status.changed
Envelope:     messageType = case.approved
```

Apa yang harus dilakukan consumer?

Jawaban production-grade:

```text
Treat as contract violation. Reject to contract-error DLQ.
Do not guess.
```

Karena guessing membuat sistem sulit diaudit.

### 7.3 Property untuk Selector, Envelope untuk Truth

Dalam banyak desain, property dipakai untuk fast routing:

```java
MessageConsumer consumer = session.createConsumer(
    topic,
    "messageType = 'case.status.changed' AND tenantId = 'cea'"
);
```

Tetapi handler tetap validate envelope.

```text
Selector memilih kandidat message.
Envelope validation menentukan message benar-benar valid.
```

---

## 8. Versioning: Jangan Mulai dari Syntax, Mulai dari Compatibility

Banyak tim bertanya:

> “Kita pakai versioning seperti apa? v1/v2 atau semver?”

Pertanyaan yang lebih penting:

> “Perubahan apa yang harus aman tanpa deploy bersamaan?”

Versioning hanya alat. Compatibility adalah tujuan.

### 8.1 Tiga Jenis Compatibility

#### Backward compatibility

Consumer baru bisa membaca message lama.

```text
Producer lama -> message v1 -> Consumer baru
```

Ini penting saat consumer deploy dulu.

#### Forward compatibility

Consumer lama bisa membaca message baru.

```text
Producer baru -> message v2 -> Consumer lama
```

Ini penting saat producer deploy dulu.

#### Full compatibility

Consumer lama/bari dan producer lama/baru bisa coexist dalam rentang version tertentu.

```text
Producer v1/v2 -> Consumer v1/v2
```

Ini ideal untuk rolling deployment dan multi-consumer event topics.

### 8.2 Compatibility Matrix

Setiap message type penting harus punya matrix seperti ini:

| Producer | Consumer | Harus Bisa? | Catatan |
|---|---|---:|---|
| v1 | v1 | Ya | baseline |
| v1 | v2 | Ya | backward compatibility |
| v2 | v1 | Ya/Tidak | forward compatibility decision |
| v2 | v2 | Ya | target |
| v3 | v1 | Biasanya tidak | jika major breaking |
| v1 | v3 | Tergantung | migration window |

Tanpa matrix, tim hanya berdebat abstrak.

### 8.3 Semantic Versioning untuk Message

Gunakan pola:

```text
MAJOR.MINOR.PATCH
```

Dengan aturan:

```text
PATCH: perubahan dokumentasi, contoh, atau constraint internal yang tidak mengubah wire contract.
MINOR: perubahan additive backward/forward safe sesuai policy.
MAJOR: perubahan breaking atau semantic shift.
```

Contoh:

```text
1.0.0 -> 1.1.0  add optional field reasonCode
1.1.0 -> 1.2.0  add optional nested object approvedBy
1.2.0 -> 2.0.0  rename caseId to applicationId and change semantics
```

### 8.4 Kapan Perlu Version di Destination Name?

Ada dua pendekatan:

```text
case.status.changed       // stable destination, version di envelope
case.status.changed.v1    // version di destination
```

#### Version di envelope

Kelebihan:

- destination stabil,
- consumer bisa handle banyak version,
- tidak membuat destination explosion,
- cocok untuk compatible evolution.

Kekurangan:

- consumer harus punya dispatcher version-aware,
- invalid version bisa masuk destination yang sama.

#### Version di destination

Kelebihan:

- breaking change lebih terisolasi,
- consumer lama tidak menerima message baru,
- operasional lebih eksplisit.

Kekurangan:

- destination bertambah,
- fan-out/migration lebih kompleks,
- producer mungkin harus publish ke dua destination saat transisi.

### 8.5 Rekomendasi Praktis

Gunakan:

```text
Compatible changes     -> version di envelope/schemaVersion
Breaking major changes -> destination baru atau messageType baru
```

Contoh:

```text
case.status.changed              schemaVersion 1.0.0 -> 1.1.0
case.status.lifecycle.changed    untuk semantic model baru yang breaking
```

Jangan memaksa semua perubahan masuk satu destination jika semantics sudah berubah.

---

## 9. Evolution Rules: Perubahan Mana yang Aman dan Berbahaya?

### 9.1 Umumnya Aman

Perubahan berikut biasanya aman jika consumer mengabaikan unknown fields:

1. menambah optional field,
2. menambah optional nested object,
3. menambah enum value jika consumer punya unknown handling,
4. memperluas dokumentasi,
5. menambah metadata envelope optional,
6. menambah field dengan default value yang jelas,
7. menambah field yang tidak mengubah semantic existing field.

Contoh aman:

```json
// v1
{
  "caseId": "CASE-1",
  "newStatus": "APPROVED"
}

// v1.1
{
  "caseId": "CASE-1",
  "newStatus": "APPROVED",
  "reasonCode": "AUTO_RULE_PASS"
}
```

Asalkan consumer lama tidak gagal saat melihat unknown field.

### 9.2 Umumnya Breaking

Perubahan berikut biasanya breaking:

1. menghapus required field,
2. mengubah tipe field,
3. rename field,
4. mengubah meaning field,
5. mengubah unit field,
6. mengubah timezone assumption,
7. mengubah enum value lama,
8. membuat optional field menjadi required,
9. mengubah nullability,
10. mengubah event dari fact menjadi command,
11. mengubah identity/idempotency key,
12. mengubah ordering/partition key.

Contoh breaking:

```json
// v1
{
  "amount": 1000,
  "currency": "SGD"
}

// v2 buruk jika tidak major
{
  "amount": "1000.00",
  "currency": "SGD"
}
```

Tipe berubah dari number ke string.

Contoh semantic breaking yang lebih berbahaya:

```json
// v1
{
  "approvedAt": "2026-06-18T09:00:00Z"
}
```

Di v1, `approvedAt` berarti waktu approval final.

Di v1.1, tim mengubahnya menjadi waktu approval request diterima.

Struktur sama. Schema valid. Tetapi contract rusak.

### 9.3 Rename Hampir Selalu Breaking

Rename field terlihat sederhana:

```text
caseId -> applicationId
```

Tapi untuk consumer lama, field lama hilang.

Migration aman:

```json
{
  "caseId": "CASE-1",
  "applicationId": "CASE-1"
}
```

Dengan policy:

```text
1. Tambah field baru sebagai optional.
2. Producer isi dua-duanya selama migration window.
3. Consumer baru baca field baru, fallback field lama.
4. Setelah semua consumer migrate, major version baru boleh menghapus field lama.
```

### 9.4 Enum Evolution Harus Sangat Hati-Hati

Enum sering menjadi sumber production bug.

```java
enum CaseStatus {
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Jika producer menambah:

```text
AUTO_APPROVED
```

Consumer lama bisa gagal:

```java
CaseStatus.valueOf("AUTO_APPROVED"); // IllegalArgumentException
```

Production-safe enum handling:

```java
public enum CaseStatus {
    SUBMITTED,
    APPROVED,
    REJECTED,
    UNKNOWN;

    public static CaseStatus fromWire(String value) {
        if (value == null || value.isBlank()) {
            return UNKNOWN;
        }
        try {
            return CaseStatus.valueOf(value);
        } catch (IllegalArgumentException ex) {
            return UNKNOWN;
        }
    }
}
```

Tetapi jangan selalu lanjut jika unknown.

Gunakan policy per field:

| Field | Unknown Handling |
|---|---|
| display label | boleh fallback |
| report category | boleh map OTHER jika documented |
| state transition command | fail/park |
| payment status | fail/park |
| legal decision type | fail/park |

Unknown enum bukan masalah teknis saja. Ia masalah business correctness.

---

## 10. Consumer Evolution: Consumer Harus Liberal, Tapi Tidak Sembrono

Ada prinsip lama:

```text
Be conservative in what you send, be liberal in what you accept.
```

Dalam messaging modern, prinsip ini perlu disempurnakan.

Consumer memang harus toleran terhadap perubahan harmless, tetapi tidak boleh terlalu toleran sampai silent corruption.

### 10.1 Consumer Harus Toleran terhadap Unknown Optional Fields

Jika payload punya field baru:

```json
{
  "caseId": "CASE-1",
  "newStatus": "APPROVED",
  "approvalChannel": "SYSTEM"
}
```

Consumer lama yang hanya butuh `caseId` dan `newStatus` sebaiknya tidak gagal.

Di Jackson:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public final class CaseStatusChangedV1 {
    public String caseId;
    public String newStatus;
}
```

Tapi jangan pakai `ignoreUnknown` tanpa schema governance. Ia membantu runtime compatibility, bukan menggantikan contract review.

### 10.2 Consumer Harus Ketat terhadap Required Field

Jika `caseId` hilang:

```json
{
  "newStatus": "APPROVED"
}
```

Consumer tidak boleh menebak.

```java
public record CaseStatusChangedData(
    String caseId,
    String newStatus
) {
    public CaseStatusChangedData {
        if (caseId == null || caseId.isBlank()) {
            throw new ContractViolationException("caseId is required");
        }
        if (newStatus == null || newStatus.isBlank()) {
            throw new ContractViolationException("newStatus is required");
        }
    }
}
```

Untuk Java 8, gunakan class biasa:

```java
public final class CaseStatusChangedData {
    private final String caseId;
    private final String newStatus;

    public CaseStatusChangedData(String caseId, String newStatus) {
        if (caseId == null || caseId.trim().isEmpty()) {
            throw new ContractViolationException("caseId is required");
        }
        if (newStatus == null || newStatus.trim().isEmpty()) {
            throw new ContractViolationException("newStatus is required");
        }
        this.caseId = caseId;
        this.newStatus = newStatus;
    }

    public String getCaseId() {
        return caseId;
    }

    public String getNewStatus() {
        return newStatus;
    }
}
```

### 10.3 Consumer Harus Version-Aware

Consumer jangan langsung deserialize body ke satu DTO tanpa melihat envelope.

Buruk:

```java
CaseStatusChanged event = objectMapper.readValue(json, CaseStatusChanged.class);
handle(event);
```

Lebih baik:

```java
EnvelopeNode envelope = objectMapper.readValue(json, EnvelopeNode.class);

String messageType = envelope.meta().messageType();
String schemaVersion = envelope.meta().schemaVersion();

MessageHandler handler = registry.find(messageType, schemaVersion);
handler.handle(envelope.dataNode());
```

Dengan konsep:

```text
Decode envelope first.
Validate metadata.
Resolve handler by type/version.
Decode payload using version-specific DTO/schema.
Validate semantic invariant.
Handle idempotently.
```

### 10.4 Consumer Boleh Mendukung Banyak Versi

Contoh:

```java
public interface VersionedMessageHandler {
    boolean supports(String messageType, SemanticVersion version);
    void handle(JsonNode data, MessageContext context) throws Exception;
}
```

Handler:

```java
public final class CaseStatusChangedV1Handler implements VersionedMessageHandler {
    @Override
    public boolean supports(String messageType, SemanticVersion version) {
        return "case.status.changed".equals(messageType)
            && version.major() == 1;
    }

    @Override
    public void handle(JsonNode data, MessageContext context) throws Exception {
        CaseStatusChangedV1 event = Json.decode(data, CaseStatusChangedV1.class);
        // process v1-compatible payload
    }
}
```

Ini lebih aman daripada satu DTO yang dipaksa menangani semua versi tanpa explicit boundary.

---

## 11. Producer Evolution: Producer Harus Stabil, Eksplisit, dan Tidak Mengubah Makna Diam-Diam

Producer adalah pemilik contract event/command yang ia publish.

### 11.1 Producer Harus Menjaga Minimal Contract

Producer tidak boleh publish payload “best effort” yang kadang lengkap, kadang tidak, tanpa versi dan rule.

Buruk:

```json
{
  "caseId": "CASE-1"
}
```

Kadang ada `newStatus`, kadang tidak.

Lebih baik:

```json
{
  "meta": {
    "messageType": "case.status.changed",
    "schemaVersion": "1.0.0"
  },
  "data": {
    "caseId": "CASE-1",
    "oldStatus": "SUBMITTED",
    "newStatus": "APPROVED"
  }
}
```

Jika field tidak diketahui, definisikan explicit:

```json
{
  "reasonCode": "UNKNOWN"
}
```

atau jadikan optional dengan documented default.

### 11.2 Producer Tidak Boleh Menggunakan DTO Internal sebagai Wire Contract

Buruk:

```java
jmsTemplate.convertAndSend("case.event", caseEntity);
```

Risiko:

- field internal bocor,
- lazy loading issue,
- serialization berubah saat entity berubah,
- schema tidak stabil,
- PII bocor,
- database model menjadi public contract.

Lebih baik:

```java
CaseStatusChangedEvent event = CaseStatusChangedEvent.of(
    caseEntity.getId(),
    oldStatus,
    newStatus,
    reasonCode
);

publisher.publish(event);
```

Domain entity dan message contract harus dipisah.

### 11.3 Producer Harus Validate Sebelum Publish

Jangan jadikan consumer sebagai tempat pertama yang menemukan message invalid.

```java
public final class CaseStatusChangedPublisher {
    private final MessageEnvelopeFactory envelopeFactory;
    private final ContractValidator validator;
    private final JmsPublisher jmsPublisher;

    public void publish(CaseStatusChangedData data, PublishContext context) {
        MessageEnvelope<CaseStatusChangedData> envelope = envelopeFactory.create(
            "case.status.changed",
            "1.2.0",
            data,
            context
        );

        validator.validate(envelope);
        jmsPublisher.publish("topic.case.events", envelope);
    }
}
```

Validation di producer mencegah invalid data masuk sistem asynchronous.

Validation di consumer tetap perlu karena producer lain/versi lama/replay bisa menghasilkan message buruk.

---

## 12. Contract Registry: Bukan Hanya untuk Kafka

Istilah schema registry sering diasosiasikan dengan Kafka/Confluent, tetapi idenya relevan untuk JMS:

> registry adalah source of truth untuk message type, schema version, compatibility rule, owner, lifecycle, dan documentation.

JMS sendiri tidak mensyaratkan schema registry. Tetapi sistem enterprise yang punya banyak producer/consumer sangat diuntungkan jika memiliki registry, walaupun sederhana.

### 12.1 Registry Bisa Dimulai dari Git

Tidak harus langsung membeli/memasang platform registry.

Struktur sederhana:

```text
message-contracts/
  case.status.changed/
    README.md
    versions/
      1.0.0/
        schema.json
        examples/
          approved.json
          rejected.json
        contract.md
      1.1.0/
        schema.json
        migration.md
      2.0.0/
        schema.json
        migration.md
  case.assignment.changed/
    versions/
      1.0.0/
        schema.json
```

### 12.2 Metadata Registry

Setiap message type sebaiknya punya metadata:

```yaml
messageType: case.status.changed
ownerTeam: case-management
producerService: case-service
destination: topic.case.events
category: domain-event
currentVersion: 1.2.0
compatibility: backward-and-forward-within-major
idempotencyKey: meta.messageId
partitionKey: meta.partitionKey
containsPii: false
classification: INTERNAL
retentionExpectation: broker-durable-subscription-and-archive
replayable: true
deprecated: false
contact: case-platform-team
```

### 12.3 Apa yang Harus Divalidasi Registry?

Minimal:

1. schema valid,
2. examples valid terhadap schema,
3. version meningkat benar,
4. breaking change tidak masuk minor,
5. required field tidak dihapus pada minor,
6. optional field baru punya dokumentasi default,
7. enum addition punya unknown handling policy,
8. owner dan destination jelas,
9. PII classification jelas,
10. sample message punya envelope lengkap.

### 12.4 Registry sebagai API Review Gate

Setiap perubahan schema harus melalui review seperti API change:

```text
PR changes schema -> compatibility check -> contract test -> owner review -> consumer impact review -> merge -> release.
```

Ini jauh lebih defensible daripada “producer deploy dulu, nanti consumer adapt”.

---

## 13. Format Pilihan: JSON, XML, Avro, Protobuf, Bytes

JMS mendukung berbagai body type. Tetapi contract engineering perlu memilih format dengan sadar.

### 13.1 JSON

Kelebihan:

- mudah dibaca manusia,
- mudah debug di DLQ,
- cocok untuk enterprise integration,
- tool luas,
- language-neutral,
- schema bisa pakai JSON Schema.

Kekurangan:

- type ambiguity,
- angka/desimal perlu hati-hati,
- ukuran lebih besar,
- schema optional jika tidak dipaksa,
- enum/string raw mudah drift.

Cocok untuk:

- enterprise business events,
- command integration,
- regulated workflows yang butuh inspectability,
- moderate throughput.

### 13.2 XML

Kelebihan:

- XSD mature,
- namespace support,
- banyak legacy enterprise system,
- cocok untuk document-style integration,
- validasi kuat.

Kekurangan:

- verbose,
- parsing cost lebih tinggi,
- namespace complexity,
- lebih berat untuk modern microservices.

Cocok untuk:

- legacy government/financial integration,
- SOAP-era systems,
- document exchange,
- strict schema validation.

### 13.3 Avro

Kelebihan:

- schema-first,
- compact binary,
- schema evolution dirancang sebagai konsep inti,
- cocok untuk data pipeline/event streaming,
- reader/writer schema resolution.

Kekurangan:

- kurang human-readable tanpa tooling,
- registry sangat disarankan,
- debugging DLQ butuh decoder,
- tidak seumum JSON di enterprise JMS tradisional.

Cocok untuk:

- high-throughput integration,
- analytics pipeline,
- event archive,
- schema evolution formal.

### 13.4 Protobuf

Kelebihan:

- compact,
- cepat,
- schema-first,
- bagus untuk multi-language,
- field numbering mendukung evolution.

Kekurangan:

- unknown field semantics perlu dipahami,
- rename field di `.proto` tidak sama dengan wire breaking jika number sama, tapi semantic tetap bisa breaking,
- debugging butuh tooling,
- JSON mapping punya edge cases.

Cocok untuk:

- high-performance internal service integration,
- polyglot systems,
- payload kecil tapi throughput besar.

### 13.5 Java ObjectMessage

Sudah dibahas di Part 6, tetapi perlu ditegaskan kembali:

> Hindari `ObjectMessage` untuk contract enterprise lintas service.

Alasan:

- Java-specific,
- serialization security risk,
- classpath coupling,
- version compatibility buruk,
- refactor package/class bisa breaking,
- sulit dipakai lintas bahasa,
- sulit diaudit sebagai contract stabil.

Gunakan DTO explicit + JSON/XML/Avro/Protobuf.

---

## 14. Field Design Rules: Detail Kecil yang Menentukan Stabilitas Besar

### 14.1 Jangan Gunakan Ambiguous Date/Time

Buruk:

```json
{
  "approvedAt": "18/06/2026 17:00"
}
```

Masalah:

- timezone tidak jelas,
- format locale-specific,
- parsing ambigu,
- replay lintas region bermasalah.

Lebih baik:

```json
{
  "approvedAt": "2026-06-18T09:00:00Z"
}
```

Jika business date tanpa waktu:

```json
{
  "effectiveDate": "2026-06-18"
}
```

Jangan campur `date` dan `date-time`.

### 14.2 Jangan Gunakan Floating Point untuk Money

Buruk:

```json
{
  "feeAmount": 10.5
}
```

Lebih aman:

```json
{
  "feeAmount": "10.50",
  "currency": "SGD"
}
```

atau minor unit:

```json
{
  "feeAmountMinor": 1050,
  "currency": "SGD"
}
```

Tetapkan policy.

### 14.3 Required vs Optional Harus Bermakna

Jangan semua field optional hanya agar consumer tidak gagal.

Buruk:

```json
{
  "caseId": null,
  "newStatus": null,
  "occurredAt": null
}
```

Kalau event tidak bisa bermakna tanpa `caseId`, field itu required.

### 14.4 Null dan Missing Bukan Selalu Sama

```json
{}
```

berbeda dari:

```json
{
  "reasonCode": null
}
```

Tentukan policy:

```text
missing reasonCode -> producer version lama, default UNKNOWN
reasonCode null    -> invalid, karena producer baru harus eksplisit
```

Atau sebaliknya, asal terdokumentasi.

### 14.5 Jangan Pakai Boolean yang Tidak Stabil

Boolean sering terlihat mudah:

```json
{
  "approved": true
}
```

Tapi saat domain berkembang:

```text
approved
rejected
pending manual review
conditionally approved
expired
withdrawn
```

Boolean tidak cukup.

Lebih baik:

```json
{
  "decision": "APPROVED"
}
```

### 14.6 Jangan Kirim Display Text sebagai Domain Value

Buruk:

```json
{
  "status": "Approved by System"
}
```

Lebih baik:

```json
{
  "status": "APPROVED",
  "statusLabel": "Approved by System"
}
```

Consumer logic harus memakai stable code, bukan label.

### 14.7 Jangan Campur ID Internal dan ID Eksternal

```json
{
  "id": "12345"
}
```

Apa ini?

- database PK?
- public case number?
- external application id?
- aggregate id?

Lebih baik:

```json
{
  "caseId": "CASE-2026-0001",
  "internalCaseUuid": "1b80f0b2-...",
  "externalApplicationNo": "APP-9981"
}
```

Gunakan nama yang menunjukkan semantic identity.

---

## 15. Message Type Design: Event, Command, Document, Snapshot, Delta

Message contract juga harus menjelaskan jenis message.

### 15.1 Command Message

Command meminta sesuatu dilakukan.

```text
case.approve.requested
```

Karakteristik:

- imperative,
- punya intended handler,
- biasanya queue,
- boleh ditolak,
- hasil belum terjadi,
- idempotency penting,
- timeout/SLA penting.

Payload:

```json
{
  "meta": {
    "messageType": "case.approve.requested",
    "schemaVersion": "1.0.0"
  },
  "data": {
    "commandId": "cmd_123",
    "caseId": "CASE-1",
    "requestedBy": "user-77"
  }
}
```

### 15.2 Domain Event

Event menyatakan sesuatu sudah terjadi dalam domain.

```text
case.approved
```

Karakteristik:

- past tense,
- fact,
- usually topic,
- source-of-truth sudah berubah,
- consumer tidak boleh menganggap bisa membatalkan event,
- replayable jika handler idempotent.

### 15.3 Integration Event

Integration event adalah event yang dirancang untuk konsumsi lintas boundary.

Ia bisa berbeda dari domain event internal.

```text
case.status.changed.public.v1
```

Karakteristik:

- data disanitasi,
- schema lebih stabil,
- tidak bocor detail internal,
- mungkin denormalized,
- owner jelas.

### 15.4 Document Message

Document message mengirim dokumen/state penuh.

```json
{
  "caseId": "CASE-1",
  "status": "APPROVED",
  "applicant": { ... },
  "licence": { ... }
}
```

Kelebihan:

- consumer tidak perlu fetch lagi,
- cocok untuk integration/export,
- lebih self-contained.

Kekurangan:

- payload besar,
- PII risk,
- schema evolution kompleks,
- stale data risk.

### 15.5 Delta Message

Delta hanya mengirim perubahan.

```json
{
  "caseId": "CASE-1",
  "changedFields": ["status"],
  "before": { "status": "SUBMITTED" },
  "after": { "status": "APPROVED" }
}
```

Kelebihan:

- efisien,
- bagus untuk audit/change log.

Kekurangan:

- consumer butuh state sebelumnya,
- ordering penting,
- replay sulit jika tidak punya baseline.

### 15.6 Snapshot Message

Snapshot mengirim state pada titik waktu tertentu.

```json
{
  "caseId": "CASE-1",
  "snapshotVersion": 12,
  "status": "APPROVED",
  "updatedAt": "2026-06-18T09:00:00Z"
}
```

Cocok untuk:

- read model rebuild,
- search index,
- reporting projection,
- sync downstream.

---

## 16. Compatibility Strategy per Message Kind

Tidak semua message perlu compatibility policy sama.

| Message Kind | Compatibility Bias | Reason |
|---|---|---|
| Internal command queue | lebih strict | satu target handler, bisa coordinate deploy |
| Public integration event | sangat compatible | banyak unknown consumers |
| Audit event | immutable | historical/legal meaning |
| Snapshot sync | additive preferred | consumer bisa ignore extra |
| Delta/change event | strict ordering/schema | salah interpretasi merusak state |
| Request/reply message | version-pinned | requester/responder expectation spesifik |

### 16.1 Command Queue Bisa Lebih Cepat Berubah

Jika hanya satu producer dan satu consumer, breaking change bisa dikelola dengan deployment choreography.

Tapi tetap jangan sembarangan.

### 16.2 Public Event Harus Sangat Stabil

Jika event dipakai oleh banyak consumer, anggap seperti public API.

Breaking change harus:

- diumumkan,
- diberi migration window,
- mungkin publish v1 dan v2 paralel,
- punya deprecation date,
- punya dashboard consumer adoption.

### 16.3 Audit Event Hampir Tidak Boleh Berubah Meaning

Audit event adalah historical record.

Jika meaning field berubah, sebaiknya buat event type baru.

```text
case.status.changed.v1 meaning lama
case.lifecycle.transition.recorded.v1 meaning baru
```

Jangan mengubah meaning audit event lama.

---

## 17. Schema Validation Pipeline

Validation ideal terjadi di beberapa titik.

```text
Producer build event
   -> producer-side schema validation
   -> producer-side semantic validation
   -> publish to JMS
   -> consumer receives
   -> envelope validation
   -> schema validation
   -> semantic validation
   -> idempotency check
   -> business handling
   -> ack/commit
```

### 17.1 Producer-Side Validation

Mencegah invalid message masuk broker.

```java
public interface MessageContractValidator {
    void validateEnvelope(MessageEnvelope<?> envelope);
    void validatePayload(String messageType, String schemaVersion, Object payload);
}
```

### 17.2 Consumer-Side Validation

Mencegah invalid message menghasilkan side effect salah.

```java
public final class ValidatingMessageListener implements MessageListener {
    private final ObjectMapper objectMapper;
    private final ContractRegistry registry;
    private final HandlerRegistry handlers;

    @Override
    public void onMessage(Message message) {
        try {
            String json = extractText(message);
            JsonNode root = objectMapper.readTree(json);

            EnvelopeMetadata meta = parseAndValidateMeta(root.path("meta"));
            Contract contract = registry.resolve(meta.messageType(), meta.schemaVersion());

            contract.validate(root.path("data"));

            MessageHandler handler = handlers.resolve(meta.messageType(), meta.schemaVersion());
            handler.handle(root.path("data"), MessageContext.from(message, meta));
        } catch (ContractViolationException ex) {
            throw new NonRetryableMessageException("Contract violation", ex);
        } catch (Exception ex) {
            throw new RetryableMessageException("Processing failed", ex);
        }
    }
}
```

### 17.3 Contract Error vs Processing Error

Bedakan:

```text
Contract error  = message tidak sesuai janji, retry biasanya tidak membantu.
Processing error = message valid, tetapi dependency/runtime gagal, retry mungkin membantu.
```

Contoh contract error:

- missing required field,
- unknown message type,
- unsupported major version,
- invalid enum untuk critical field,
- invalid date format,
- classification missing,
- tenantId mismatch.

Contoh processing error:

- DB timeout,
- downstream API 503,
- deadlock,
- temporary lock,
- broker failover.

Routing error harus berbeda:

```text
contract-error DLQ
processing-retry/DLQ
security-error DLQ
poison-message parking lot
```

Jangan semua masuk satu DLQ tanpa kategori.

---

## 18. Contract Testing

Contract testing memastikan producer dan consumer masih sepakat.

### 18.1 Producer Contract Test

Producer test memastikan sample message yang dihasilkan valid terhadap schema.

```java
@Test
void shouldPublishValidCaseStatusChangedEvent() throws Exception {
    CaseStatusChangedData data = new CaseStatusChangedData(
        "CASE-1",
        "SUBMITTED",
        "APPROVED"
    );

    MessageEnvelope<CaseStatusChangedData> envelope = factory.create(
        "case.status.changed",
        "1.0.0",
        data,
        PublishContext.test()
    );

    contractRegistry.resolve("case.status.changed", "1.0.0")
        .validate(objectMapper.valueToTree(envelope).path("data"));
}
```

### 18.2 Consumer Contract Test

Consumer test memastikan consumer dapat membaca sample message dari registry.

```java
@Test
void shouldConsumeCaseStatusChangedV1Example() throws Exception {
    String example = loadContractExample(
        "case.status.changed/versions/1.0.0/examples/approved.json"
    );

    listener.onMessage(textMessage(example));

    assertProjectionUpdated("CASE-1", "APPROVED");
}
```

### 18.3 Compatibility Test

Jika schema baru ditambahkan, test perubahan terhadap versi lama.

Pseudo:

```text
For each existing example of v1:
  consumer v2 must read it.

For each new example of v1.1:
  consumer v1 must either read it safely or fail with documented unsupported-version behavior.
```

### 18.4 Negative Contract Test

Test juga harus mencakup message invalid.

```java
@Test
void shouldSendMissingCaseIdToContractDlq() throws Exception {
    String invalid = """
        {
          "meta": {
            "messageType": "case.status.changed",
            "schemaVersion": "1.0.0",
            "messageId": "evt_1"
          },
          "data": {
            "newStatus": "APPROVED"
          }
        }
        """;

    listener.onMessage(textMessage(invalid));

    assertContractDlqContains("evt_1");
}
```

Untuk Java 8, ganti text block dengan string concatenation atau resource file.

---

## 19. Java Implementation Blueprint: Envelope, Version, Handler Registry

Bagian ini memberikan blueprint sederhana yang bisa dikembangkan.

### 19.1 Envelope Model — Java 17+

```java
public record MessageEnvelope<T>(
    MessageMetadata meta,
    T data
) {}

public record MessageMetadata(
    String messageId,
    String messageType,
    String schemaVersion,
    String schemaId,
    String producer,
    String producerVersion,
    Instant occurredAt,
    Instant publishedAt,
    String correlationId,
    String causationId,
    String traceId,
    String tenantId,
    String partitionKey,
    String classification,
    String contentType,
    String encoding
) {}
```

### 19.2 Envelope Model — Java 8

```java
public final class MessageEnvelope<T> {
    private final MessageMetadata meta;
    private final T data;

    public MessageEnvelope(MessageMetadata meta, T data) {
        if (meta == null) {
            throw new IllegalArgumentException("meta is required");
        }
        if (data == null) {
            throw new IllegalArgumentException("data is required");
        }
        this.meta = meta;
        this.data = data;
    }

    public MessageMetadata getMeta() {
        return meta;
    }

    public T getData() {
        return data;
    }
}
```

### 19.3 Semantic Version Model

```java
public final class SemanticVersion implements Comparable<SemanticVersion> {
    private final int major;
    private final int minor;
    private final int patch;

    public SemanticVersion(int major, int minor, int patch) {
        if (major < 0 || minor < 0 || patch < 0) {
            throw new IllegalArgumentException("version parts must be non-negative");
        }
        this.major = major;
        this.minor = minor;
        this.patch = patch;
    }

    public static SemanticVersion parse(String value) {
        if (value == null) {
            throw new IllegalArgumentException("version is required");
        }
        String[] parts = value.split("\\.");
        if (parts.length != 3) {
            throw new IllegalArgumentException("version must be MAJOR.MINOR.PATCH: " + value);
        }
        return new SemanticVersion(
            Integer.parseInt(parts[0]),
            Integer.parseInt(parts[1]),
            Integer.parseInt(parts[2])
        );
    }

    public int major() { return major; }
    public int minor() { return minor; }
    public int patch() { return patch; }

    @Override
    public int compareTo(SemanticVersion other) {
        int majorCmp = Integer.compare(this.major, other.major);
        if (majorCmp != 0) return majorCmp;
        int minorCmp = Integer.compare(this.minor, other.minor);
        if (minorCmp != 0) return minorCmp;
        return Integer.compare(this.patch, other.patch);
    }
}
```

For Java 8, use `getMajor()` if team style prefers bean getters.

### 19.4 Handler Registry

```java
public interface MessageHandler {
    boolean supports(String messageType, SemanticVersion version);
    void handle(JsonNode data, MessageContext context) throws Exception;
}

public final class MessageHandlerRegistry {
    private final List<MessageHandler> handlers;

    public MessageHandlerRegistry(List<MessageHandler> handlers) {
        this.handlers = List.copyOf(handlers);
    }

    public MessageHandler resolve(String messageType, String schemaVersion) {
        SemanticVersion version = SemanticVersion.parse(schemaVersion);
        return handlers.stream()
            .filter(handler -> handler.supports(messageType, version))
            .findFirst()
            .orElseThrow(() -> new UnsupportedMessageContractException(
                "Unsupported message contract: " + messageType + " " + schemaVersion
            ));
    }
}
```

Untuk Java 8:

```java
public MessageHandler resolve(String messageType, String schemaVersion) {
    SemanticVersion version = SemanticVersion.parse(schemaVersion);
    for (MessageHandler handler : handlers) {
        if (handler.supports(messageType, version)) {
            return handler;
        }
    }
    throw new UnsupportedMessageContractException(
        "Unsupported message contract: " + messageType + " " + schemaVersion
    );
}
```

### 19.5 JMS Publish dengan Property + Envelope

```java
public final class JmsContractPublisher {
    private final ConnectionFactory connectionFactory;
    private final ObjectMapper objectMapper;

    public void publish(Destination destination, MessageEnvelope<?> envelope) throws JMSException {
        try (JMSContext context = connectionFactory.createContext(JMSContext.AUTO_ACKNOWLEDGE)) {
            String json = objectMapper.writeValueAsString(envelope);

            JMSProducer producer = context.createProducer();
            producer.setProperty("messageType", envelope.meta().messageType());
            producer.setProperty("schemaVersion", envelope.meta().schemaVersion());
            producer.setProperty("tenantId", envelope.meta().tenantId());
            producer.setProperty("producer", envelope.meta().producer());
            producer.setProperty("classification", envelope.meta().classification());

            producer.send(destination, json);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Failed to serialize envelope", ex);
        }
    }
}
```

Untuk Java 8 / JMS 1.1 style:

```java
public final class Jms11ContractPublisher {
    private final ConnectionFactory connectionFactory;
    private final ObjectMapper objectMapper;

    public void publish(Destination destination, MessageEnvelope<?> envelope) throws JMSException {
        Connection connection = null;
        Session session = null;
        MessageProducer producer = null;
        try {
            connection = connectionFactory.createConnection();
            session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
            producer = session.createProducer(destination);

            String json = objectMapper.writeValueAsString(envelope);
            TextMessage message = session.createTextMessage(json);

            MessageMetadata meta = envelope.getMeta();
            message.setStringProperty("messageType", meta.getMessageType());
            message.setStringProperty("schemaVersion", meta.getSchemaVersion());
            message.setStringProperty("tenantId", meta.getTenantId());
            message.setStringProperty("producer", meta.getProducer());
            message.setStringProperty("classification", meta.getClassification());

            producer.send(message);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Failed to serialize envelope", ex);
        } finally {
            if (producer != null) producer.close();
            if (session != null) session.close();
            if (connection != null) connection.close();
        }
    }
}
```

Catatan: contoh di atas sederhana. Dalam production, connection/session lifecycle biasanya dikelola container/framework/pool.

---

## 20. Consumer Dispatch Blueprint

```java
public final class ContractAwareJmsListener implements MessageListener {
    private final ObjectMapper objectMapper;
    private final EnvelopeValidator envelopeValidator;
    private final ContractRegistry contractRegistry;
    private final MessageHandlerRegistry handlerRegistry;
    private final ErrorClassifier errorClassifier;

    @Override
    public void onMessage(Message message) {
        ProcessingContext processingContext = null;
        try {
            String body = extractBody(message);
            JsonNode root = objectMapper.readTree(body);

            MessageMetadata meta = envelopeValidator.parseAndValidate(root.path("meta"));
            processingContext = ProcessingContext.from(message, meta);

            MessageContract contract = contractRegistry.resolve(
                meta.messageType(),
                meta.schemaVersion()
            );

            JsonNode data = root.path("data");
            contract.validateSchema(data);
            contract.validateSemantic(data, meta);

            MessageHandler handler = handlerRegistry.resolve(
                meta.messageType(),
                meta.schemaVersion()
            );

            handler.handle(data, processingContext);
        } catch (Exception ex) {
            MessageErrorCategory category = errorClassifier.classify(ex);
            throw translateForJmsRedelivery(category, ex, processingContext);
        }
    }

    private String extractBody(Message message) throws JMSException {
        if (message instanceof TextMessage) {
            return ((TextMessage) message).getText();
        }
        throw new ContractViolationException("Only TextMessage is supported");
    }
}
```

### 20.1 Error Classifier

```java
public enum MessageErrorCategory {
    CONTRACT,
    SECURITY,
    TRANSIENT_PROCESSING,
    PERMANENT_PROCESSING,
    UNKNOWN
}
```

```java
public final class ErrorClassifier {
    public MessageErrorCategory classify(Throwable error) {
        Throwable root = rootCause(error);
        if (root instanceof ContractViolationException) {
            return MessageErrorCategory.CONTRACT;
        }
        if (root instanceof AuthorizationException) {
            return MessageErrorCategory.SECURITY;
        }
        if (root instanceof SQLTransientException) {
            return MessageErrorCategory.TRANSIENT_PROCESSING;
        }
        return MessageErrorCategory.UNKNOWN;
    }
}
```

### 20.2 Unsupported Version Handling

Jika consumer menerima unsupported major version:

```text
messageType = case.status.changed
schemaVersion = 2.0.0
consumer supports only major 1
```

Pilihan:

1. fail ke contract DLQ,
2. route ke unsupported-version queue,
3. ignore jika event non-critical dan documented,
4. fallback only jika explicitly compatible.

Jangan auto-deserialize major baru ke DTO lama.

---

## 21. Deployment Choreography untuk Schema Evolution

### 21.1 Additive Non-Breaking Change

Contoh: tambah optional field `reasonCode`.

Urutan aman:

```text
1. Update contract registry: v1.1.0 add optional reasonCode.
2. Consumer update jika ingin memakai reasonCode, tapi tetap fallback jika missing.
3. Deploy consumer baru.
4. Deploy producer yang mulai mengisi reasonCode.
5. Monitor unknown/validation errors.
```

Jika forward compatibility dijamin, producer bisa deploy lebih dulu. Tetapi deploy consumer dulu biasanya lebih aman.

### 21.2 Breaking Change

Contoh: ubah model status menjadi lifecycle transition.

Jangan lakukan:

```text
case.status.changed v1 payload berubah diam-diam.
```

Lakukan:

```text
1. Define new message type or major version.
2. Publish both old and new during migration window if needed.
3. Consumers migrate one by one.
4. Track adoption.
5. Stop old publication after agreed date.
6. Keep old consumer/replay decoder for historical message if DLQ/archive masih ada.
```

Diagram:

```text
Phase 1: Producer publishes v1 only
Phase 2: Producer publishes v1 + v2
Phase 3: Consumers migrate to v2
Phase 4: Producer publishes v2 only
Phase 5: v1 archived/deprecated, decoder retained for replay window
```

### 21.3 Consumer-First vs Producer-First

Consumer-first cocok jika:

- perubahan additive,
- consumer bisa ignore/fallback,
- banyak consumer,
- event public.

Producer-first hanya aman jika:

- consumer lama terbukti forward-compatible,
- compatibility test lolos,
- unknown field ignored,
- enum addition aman,
- rollout terkendali.

---

## 22. Operational Handling: Saat Contract Mismatch Terjadi

Contract governance tetap tidak menjamin 0 error. Maka harus ada operational model.

### 22.1 Contract Error DLQ

Pisahkan DLQ contract dari DLQ processing.

```text
DLQ.CONTRACT.case.status.changed
DLQ.PROCESSING.case.status.changed
DLQ.SECURITY.case.status.changed
```

Kenapa?

- retry policy berbeda,
- owner berbeda,
- remediation berbeda,
- severity berbeda.

### 22.2 Contract Error Metadata

Saat message masuk contract DLQ, tambahkan metadata:

```json
{
  "error": {
    "category": "CONTRACT",
    "reason": "MISSING_REQUIRED_FIELD",
    "field": "data.caseId",
    "consumer": "reporting-service",
    "consumerVersion": "2026.06.18.1",
    "detectedAt": "2026-06-18T10:00:00Z",
    "originalMessageType": "case.status.changed",
    "originalSchemaVersion": "1.0.0"
  }
}
```

Jangan hanya log exception.

### 22.3 Repair Policy

Tidak semua contract error boleh diperbaiki manual.

| Error | Repair? | Catatan |
|---|---:|---|
| missing optional field | mungkin tidak perlu | fallback |
| missing required business id | biasanya tidak | source data tidak cukup |
| unknown enum display-only | bisa map OTHER | jika documented |
| unknown enum state transition | jangan manual tanpa owner | high risk |
| invalid date format | bisa transform jika deterministic | audit transform |
| tenant mismatch | security incident | jangan replay sembarang |
| unsupported major version | deploy consumer/update mapping | bukan edit message sembarang |

### 22.4 Replay Harus Contract-Aware

Replay tooling harus tahu schema version.

Buruk:

```text
Take DLQ message -> send back to original queue.
```

Lebih baik:

```text
1. Read envelope.
2. Validate messageType/schemaVersion.
3. Check idempotency/replay policy.
4. Check consumer supports version.
5. Record replay request and approver.
6. Republish with replay metadata.
```

Replay metadata:

```json
{
  "meta": {
    "messageId": "evt_01...",
    "replay": {
      "isReplay": true,
      "replayId": "replay_20260618_001",
      "replayedAt": "2026-06-18T11:00:00Z",
      "replayedBy": "ops-user-1",
      "reason": "consumer bug fixed"
    }
  }
}
```

Jangan ubah `messageId` jika replay adalah message logical yang sama dan consumer idempotency berbasis `messageId`.

Buat `replayId` terpisah untuk audit operation.

---

## 23. Anti-Patterns

### 23.1 “Just Send the Entity”

```java
publisher.publish(caseEntity);
```

Masalah:

- entity bukan contract,
- field internal bocor,
- lazy loading,
- schema tidak stabil,
- PII bocor,
- perubahan DB merusak consumer.

### 23.2 “Everything is a String Map”

```json
{
  "caseId": "CASE-1",
  "amount": "1000",
  "approved": "true",
  "occurredAt": "yesterday"
}
```

Masalah:

- type hilang,
- validation lemah,
- consumer parsing berbeda,
- compatibility tidak formal.

### 23.3 “Version Only in Code, Not in Message”

Jika message tidak membawa `schemaVersion`, consumer harus menebak dari shape.

Menebak version dari shape itu rapuh.

### 23.4 “One Giant Event for Everything”

```text
case.updated
```

Dengan payload besar berisi semua perubahan.

Masalah:

- consumer sulit tahu apa yang berubah,
- event terlalu sering berubah,
- schema besar,
- unnecessary coupling,
- selector/routing sulit.

Lebih baik pisahkan event berdasarkan semantic penting:

```text
case.status.changed
case.assignment.changed
case.document.attached
case.sla.breached
```

### 23.5 “Every Small Field Change Becomes New Major Version”

Terlalu banyak major version membuat consumer frustasi.

Gunakan compatibility policy. Additive optional field tidak harus major.

### 23.6 “Ignore All Invalid Messages”

Consumer yang menelan error demi uptime menciptakan silent data loss.

```java
try {
    handle(message);
} catch (Exception ex) {
    log.warn("ignored", ex);
}
```

Ini berbahaya. Message valid harus diproses; message invalid harus terlihat, diklasifikasi, dan masuk flow error yang benar.

### 23.7 “Schema Registry Ada, Jadi Aman”

Registry hanya membantu syntax/compatibility. Ia tidak otomatis memahami semantic.

Semantic review tetap perlu.

---

## 24. Case Study: Evolusi `CaseStatusChanged`

### 24.1 Version 1.0.0

```json
{
  "meta": {
    "messageId": "evt_001",
    "messageType": "case.status.changed",
    "schemaVersion": "1.0.0",
    "producer": "case-service",
    "occurredAt": "2026-06-18T09:00:00Z",
    "correlationId": "corr_001"
  },
  "data": {
    "caseId": "CASE-1",
    "oldStatus": "SUBMITTED",
    "newStatus": "APPROVED"
  }
}
```

Contract:

```text
newStatus is the status after successful DB commit.
oldStatus is previous status before transition.
Consumer must be idempotent by meta.messageId.
```

### 24.2 Version 1.1.0 — Add Optional `reasonCode`

```json
{
  "data": {
    "caseId": "CASE-1",
    "oldStatus": "SUBMITTED",
    "newStatus": "APPROVED",
    "reasonCode": "AUTO_RULE_PASS"
  }
}
```

Compatibility:

- consumer v1 can ignore `reasonCode`,
- consumer v1.1 can fallback `UNKNOWN` if missing.

Safe minor.

### 24.3 Version 1.2.0 — Add Optional Actor

```json
{
  "data": {
    "caseId": "CASE-1",
    "oldStatus": "SUBMITTED",
    "newStatus": "APPROVED",
    "reasonCode": "AUTO_RULE_PASS",
    "actor": {
      "type": "SYSTEM",
      "id": "rules-engine"
    }
  }
}
```

Safe if actor optional and unknown fields ignored.

### 24.4 Bad Version 1.3.0 — Change Meaning of `oldStatus`

Tim ingin `oldStatus` berarti “status saat event diproses”, bukan status sebelum transition.

Ini semantic breaking.

Jangan minor.

### 24.5 Version 2.0.0 — New Lifecycle Transition Model

```json
{
  "meta": {
    "messageType": "case.lifecycle.transition.recorded",
    "schemaVersion": "2.0.0"
  },
  "data": {
    "caseId": "CASE-1",
    "transitionId": "trn_001",
    "fromState": "SUBMITTED",
    "toState": "APPROVED",
    "transitionType": "AUTO_APPROVAL",
    "decision": {
      "code": "PASS",
      "reason": "All validation rules passed"
    }
  }
}
```

Ini sebaiknya message type baru karena semantic lebih kaya dan tidak 1:1 dengan event lama.

Migration:

```text
Publish case.status.changed v1.x and case.lifecycle.transition.recorded v2 in parallel.
Consumers migrate.
Deprecate old event.
Retain v1 decoder for replay window.
```

---

## 25. Advanced Topic: Canonical Model vs Consumer-Specific Events

Ada dua pendekatan integrasi enterprise.

### 25.1 Canonical Message Model

Satu model besar dipakai semua sistem.

Kelebihan:

- standardisasi,
- governance terpusat,
- mudah untuk enterprise-wide vocabulary.

Kekurangan:

- model menjadi terlalu besar,
- perubahan lambat,
- semua tim tergantung satu model,
- sering tidak cocok untuk bounded context,
- semantic compromise.

### 25.2 Consumer-Specific Integration Event

Producer/adapter membuat event yang sesuai kebutuhan integration tertentu.

Kelebihan:

- contract lebih kecil,
- semantic jelas,
- evolusi lebih terkontrol,
- sesuai bounded context.

Kekurangan:

- lebih banyak message type,
- mapping/translator bertambah,
- governance tetap perlu.

### 25.3 Rekomendasi Seimbang

Gunakan canonical vocabulary untuk field umum:

```text
caseId, tenantId, occurredAt, classification, actor, correlationId
```

Tetapi jangan memaksa satu canonical payload raksasa untuk semua event.

```text
Shared vocabulary, not giant universal message.
```

---

## 26. Advanced Topic: Message Translator dan Anti-Corruption Layer

Ketika sistem lama dan baru punya schema berbeda, jangan paksa semua consumer memahami semuanya.

Gunakan translator/adapter.

```text
Legacy JMS Event -> Translator -> Modern Integration Event
```

Contoh:

```text
LEGACY_CASE_UPDATE
  fields: APP_NO, STAT_CD, UPD_DT

translated to:
case.status.changed
  fields: caseId, oldStatus, newStatus, occurredAt
```

Translator harus:

- explicit mapping,
- validate source,
- log unmapped value,
- preserve original reference,
- record transformation version,
- handle unknown legacy codes,
- avoid silent semantic loss.

Envelope hasil transformasi:

```json
{
  "meta": {
    "messageId": "evt_new_001",
    "causationId": "legacy_msg_998",
    "messageType": "case.status.changed",
    "schemaVersion": "1.0.0",
    "producer": "legacy-case-translator",
    "transformationVersion": "2026.06.18.1"
  }
}
```

---

## 27. Advanced Topic: Schema Evolution dan Replay

Replay membuat schema evolution lebih sulit karena consumer baru mungkin menerima message lama.

### 27.1 Consumer Baru Harus Bisa Baca Message Lama Jika Replay Didukung

Jika archive berisi event v1 selama 7 tahun, dan consumer projection bisa rebuild dari archive, maka consumer modern butuh decoder v1.

Pilihan:

1. consumer mendukung semua historical versions,
2. replay pipeline melakukan upconversion,
3. archive menyimpan normalized canonical version,
4. old replay tidak didukung setelah retention window.

Keputusan ini harus eksplisit.

### 27.2 Upcaster Pattern

Upcaster mengubah event lama ke model baru sebelum handler.

```text
v1 event -> upcaster v1_to_v2 -> v2 handler
```

Contoh:

```java
public interface MessageUpcaster {
    boolean supports(String messageType, SemanticVersion from, SemanticVersion to);
    JsonNode upcast(JsonNode oldData);
}
```

Upcaster harus deterministic dan teruji.

Jangan gunakan upcaster untuk menebak data yang tidak ada.

Jika v1 tidak punya `reasonCode`, v2 bisa set:

```json
{
  "reasonCode": "UNKNOWN_LEGACY"
}
```

Asal documented.

### 27.3 Replay Metadata Jangan Mengubah Business Occurred Time

Saat replay, jangan ubah `occurredAt`.

Tambahkan `replayedAt` di metadata replay.

```text
occurredAt = waktu kejadian bisnis asli
replayedAt = waktu operasi replay
```

---

## 28. Security dan Privacy dalam Contract

Schema bukan hanya teknis. Ia juga security boundary.

### 28.1 Klasifikasi Field

Setiap field sensitif harus diklasifikasi:

```yaml
fields:
  data.applicantName:
    classification: PII
  data.nric:
    classification: SENSITIVE_PII
  data.caseId:
    classification: INTERNAL_IDENTIFIER
  data.status:
    classification: INTERNAL
```

### 28.2 Jangan Bocorkan PII ke Event Umum

Buruk:

```text
topic.case.events contains applicant full profile
all consumers subscribe
```

Lebih baik:

```text
topic.case.public-events     no PII
topic.case.sensitive-events  restricted ACL
document fetch via authorized API if needed
```

### 28.3 Schema Review Harus Termasuk Security Review

Pertanyaan wajib:

- apakah field ini PII?
- apakah semua consumer berhak melihatnya?
- apakah field ini muncul di logs?
- apakah broker admin bisa melihat payload?
- apakah DLQ viewer punya akses?
- apakah archive terenkripsi?
- apakah masking diperlukan?
- apakah selector property membocorkan data sensitif?

Jangan taruh PII di JMS property karena property sering terlihat di console/log/index broker.

---

## 29. Observability untuk Contract

Monitor bukan hanya throughput dan queue depth. Monitor contract health.

### 29.1 Metrics

Contoh metrics:

```text
messages_contract_validation_total{messageType,version,result}
messages_unsupported_version_total{messageType,version,consumer}
messages_unknown_type_total{destination,consumer}
messages_schema_decode_failure_total{messageType,version,reason}
messages_contract_dlq_total{messageType,version,reason}
consumer_supported_contract_versions{consumer,messageType,major}
```

### 29.2 Logs

Log contract error harus structured:

```json
{
  "level": "ERROR",
  "event": "message_contract_violation",
  "messageType": "case.status.changed",
  "schemaVersion": "1.2.0",
  "messageId": "evt_001",
  "field": "data.caseId",
  "reason": "missing_required_field",
  "consumer": "reporting-service",
  "correlationId": "corr_001"
}
```

Jangan log full payload jika mengandung PII.

### 29.3 Dashboard

Dashboard contract health:

```text
- Top contract errors by messageType
- Unsupported version by consumer
- DLQ contract growth
- Schema version distribution over time
- Producer version distribution
- Consumer version support matrix
- Contract error MTTR
```

---

## 30. Governance: Lightweight tapi Tegas

Governance buruk jika terlalu berat. Tapi tanpa governance, message ecosystem rusak.

### 30.1 Minimum Governance

Untuk setiap message type:

- owner,
- destination,
- kind: command/event/snapshot/delta,
- schema,
- examples,
- version policy,
- compatibility rule,
- retention/replay rule,
- security classification,
- idempotency key,
- known consumers,
- deprecation policy.

### 30.2 Contract Review Checklist

Sebelum schema berubah:

```text
[ ] Apakah perubahan additive atau breaking?
[ ] Apakah version dinaikkan sesuai rule?
[ ] Apakah required field berubah?
[ ] Apakah enum bertambah/berubah?
[ ] Apakah semantic field berubah?
[ ] Apakah contoh message diperbarui?
[ ] Apakah consumer lama tetap aman?
[ ] Apakah producer lama tetap didukung?
[ ] Apakah PII/security classification berubah?
[ ] Apakah replay historical message masih aman?
[ ] Apakah DLQ/retry behavior jelas?
[ ] Apakah observability field cukup?
[ ] Apakah migration plan ada untuk breaking change?
```

### 30.3 Deprecation Policy

Contoh policy:

```text
Minor version supported within same major for minimum 12 months.
Major version deprecation requires written notice, migration guide, and consumer adoption tracking.
Archived messages retain decoder support for 7 years or retention period defined by regulation.
```

Dalam sistem regulated, deprecation bukan hanya keputusan engineering; bisa menyentuh audit/legal retention.

---

## 31. Design Heuristics Top 1%

### 31.1 Message adalah Dokumen Hukum Kecil

Dalam sistem regulated, message bisa menjadi bukti:

- siapa melakukan apa,
- kapan,
- berdasarkan input apa,
- status apa yang berubah,
- sistem mana yang memproduksi,
- consumer mana yang gagal.

Desain contract seolah message akan dibaca auditor 2 tahun lagi.

### 31.2 Jangan Optimalkan Payload Sebelum Semantics Jelas

Payload kecil tapi ambigu lebih buruk daripada payload sedikit lebih besar tapi jelas.

### 31.3 Additive Change Murah, Semantic Change Mahal

Menambah optional field sering mudah. Mengubah arti field lama hampir selalu mahal.

### 31.4 Unknown Field Boleh Diabaikan, Unknown Meaning Tidak

Consumer boleh ignore field yang tidak dipakai. Tetapi jika field inti punya value tidak dikenal, jangan lanjut sembarang.

### 31.5 Schema Compatibility Tidak Sama dengan Business Compatibility

Schema bisa compatible, tetapi bisnis bisa breaking.

Contoh:

```json
{
  "status": "APPROVED"
}
```

Secara schema tetap string. Tetapi jika `APPROVED` dulu berarti final approval dan sekarang berarti preliminary approval, semua consumer bisa salah.

### 31.6 Versioning Tidak Mengganti Design Review

Menambah `v2` tidak otomatis membuat desain bagus. Ia hanya mengakui breaking change.

### 31.7 Event Name Harus Menjelaskan Fakta, Bukan Database Update

Buruk:

```text
case.updated
```

Lebih baik:

```text
case.status.changed
case.assignment.changed
case.document.attached
case.appeal.submitted
```

### 31.8 Jika Consumer Harus Memanggil Producer untuk Mengerti Event, Contract Kurang Lengkap

Kadang consumer memang perlu fetch detail. Tapi event minimal harus cukup untuk:

- identify entity,
- know what happened,
- dedup,
- trace,
- decide whether to fetch more.

### 31.9 Jangan Jadikan Broker sebagai Schema Brain

Broker mengirim message. Aplikasi dan registry menjaga semantics.

### 31.10 Contract Harus Bisa Dites Tanpa Broker

Schema validation, examples, compatibility, DTO mapping, dan handler dispatch harus bisa diuji tanpa menjalankan broker.

Broker integration test tetap perlu, tetapi contract test harus cepat dan deterministic.

---

## 32. Production Checklist

### 32.1 Envelope

```text
[ ] messageId ada dan stabil untuk idempotency
[ ] messageType stable dan bukan Java class name
[ ] schemaVersion ada
[ ] producer jelas
[ ] occurredAt jelas
[ ] correlationId ada
[ ] tenantId ada jika multi-tenant
[ ] classification ada jika regulated
[ ] traceId ada jika observability lintas service
[ ] data tidak null
```

### 32.2 Schema

```text
[ ] required field minimal tapi tegas
[ ] optional field punya default/meaning
[ ] null vs missing jelas
[ ] enum evolution policy jelas
[ ] date/time pakai ISO-8601
[ ] money tidak pakai floating point ambiguous
[ ] ID field diberi nama semantic
[ ] examples valid terhadap schema
```

### 32.3 Compatibility

```text
[ ] backward compatibility diuji
[ ] forward compatibility diputuskan eksplisit
[ ] breaking change pakai major/messageType baru
[ ] migration plan ada
[ ] deprecation policy ada
[ ] old decoder dipertahankan sesuai replay window
```

### 32.4 Consumer

```text
[ ] decode envelope dulu
[ ] validate messageType/schemaVersion
[ ] unknown optional field tidak gagal
[ ] missing required field gagal ke contract DLQ
[ ] unknown critical enum tidak diproses diam-diam
[ ] idempotency check sebelum side effect
[ ] unsupported version terlihat di metric/log
```

### 32.5 Producer

```text
[ ] tidak publish entity internal
[ ] validate sebelum publish
[ ] schemaVersion benar
[ ] semantic invariant dijaga
[ ] no PII leakage ke topic umum
[ ] property dan envelope metadata konsisten
```

### 32.6 Operations

```text
[ ] contract DLQ terpisah dari processing DLQ
[ ] contract error punya structured metadata
[ ] replay tool version-aware
[ ] dashboard contract health tersedia
[ ] owner message type jelas
[ ] runbook contract mismatch tersedia
```

---

## 33. Latihan Engineering

### Latihan 1 — Klasifikasi Perubahan

Untuk setiap perubahan berikut, tentukan apakah patch/minor/major:

1. tambah optional `reasonCode`,
2. hapus required `caseId`,
3. rename `caseId` ke `applicationId`,
4. tambah enum `AUTO_APPROVED`,
5. ubah `approvedAt` dari UTC menjadi local time,
6. tambah optional `actor`,
7. ubah event `case.approved` dari final approval menjadi preliminary approval,
8. tambah `traceId` di envelope.

Expected reasoning:

- 1 minor,
- 2 major,
- 3 major unless dual-field migration,
- 4 minor only if unknown handling safe; otherwise potentially major,
- 5 major,
- 6 minor,
- 7 major/new message type,
- 8 minor/patch depending policy.

### Latihan 2 — Desain Envelope

Desain envelope untuk event:

```text
licence.renewal.submitted
```

Harus mencakup:

- idempotency,
- tenant,
- trace,
- producer,
- schema version,
- occurred time,
- classification,
- partition key.

### Latihan 3 — Breaking Change Migration

Sistem lama punya event:

```json
{
  "caseId": "CASE-1",
  "status": "APPROVED"
}
```

Sistem baru ingin payload:

```json
{
  "applicationId": "CASE-1",
  "transition": {
    "from": "SUBMITTED",
    "to": "APPROVED",
    "type": "AUTO"
  }
}
```

Buat migration plan aman untuk 8 consumer.

### Latihan 4 — Consumer Unknown Enum

Consumer menerima:

```json
{
  "newStatus": "CONDITIONALLY_APPROVED"
}
```

Sementara code hanya tahu:

```text
SUBMITTED, APPROVED, REJECTED
```

Tentukan behavior untuk:

- notification consumer,
- SLA consumer,
- audit consumer,
- state projection consumer.

Jawaban tidak boleh satu ukuran untuk semua.

---

## 34. Ringkasan Mental Model

Part ini bisa diringkas sebagai berikut:

```text
Message schema is not just data shape.
It is an asynchronous API contract that lives across time.
```

Dalam JMS/Jakarta Messaging:

- producer dan consumer tidak selalu hidup pada waktu yang sama,
- message bisa tertahan, retry, DLQ, replay, atau archived,
- banyak consumer bisa membaca event yang sama,
- schema valid belum tentu semantic benar,
- compatibility harus dirancang, bukan diasumsikan,
- envelope membuat message self-describing,
- registry membuat contract visible dan reviewable,
- consumer harus version-aware,
- producer tidak boleh publish model internal,
- contract error harus operable dan auditable.

Formula praktis:

```text
Robust JMS Contract
= stable message type
+ explicit envelope
+ versioned schema
+ semantic contract
+ compatibility policy
+ contract tests
+ DLQ/error classification
+ replay-aware operations
```

---

## 35. Referensi Resmi dan Bacaan Lanjutan

1. Jakarta Messaging 3.1 Specification  
   https://jakarta.ee/specifications/messaging/3.1/jakarta-messaging-spec-3.1.html

2. Jakarta Messaging Specification Page  
   https://jakarta.ee/specifications/messaging/3.1/

3. Jakarta EE Tutorial — Messaging Concepts  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/messaging/jms-concepts/jms-concepts.html

4. Enterprise Integration Patterns — Message Channel  
   https://www.enterpriseintegrationpatterns.com/patterns/messaging/MessageChannel.html

5. Enterprise Integration Patterns — Message Translator  
   https://www.enterpriseintegrationpatterns.com/patterns/messaging/MessageTranslator.html

6. Enterprise Integration Patterns — Pattern Language  
   https://www.enterpriseintegrationpatterns.com/

7. Confluent Schema Registry — Schema Evolution and Compatibility  
   https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html

8. Confluent Schema Registry Overview  
   https://docs.confluent.io/platform/current/schema-registry/index.html

9. Apache Avro Specification  
   https://avro.apache.org/docs/1.11.1/specification/

---

## 36. Apa yang Akan Dibahas di Part Berikutnya

Part berikutnya:

# Part 24 — Idempotency and Deduplication Engineering: Dari API Design sampai Database Constraint

Kita akan membahas idempotency secara sangat dalam:

- idempotency key,
- messageId vs business key,
- dedup table,
- inbox pattern,
- unique constraint,
- TTL dedup cache,
- handler idempotent,
- side-effect classification,
- exactly-once illusion,
- replay-safe processing,
- Java implementation pattern,
- database schema design,
- failure windows,
- regulated system auditability.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-022.md">⬅️ Part 22 — JMS in Microservices: Command Queue, Domain Event, Integration Event, Saga, dan Choreography</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-024.md">Part 24 — Idempotency and Deduplication Engineering: Dari API Design sampai Database Constraint ➡️</a>
</div>
