# learn-java-security-cryptography-integrity-part-026

# Data Integrity in Distributed Java Systems

> **Seri:** Java Security, Cryptography, dan Integrity  
> **Part:** 26 dari 34  
> **Topik:** Integrity pada command, event, message, outbox, replay prevention, idempotency, broker trust boundary, dan cross-service invariant  
> **Target pembaca:** Java engineer senior / tech lead yang membangun microservices, distributed workflow, case management, enforcement lifecycle, audit-heavy platform, dan sistem enterprise yang harus defensible.

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya sudah membahas banyak primitive dan boundary:

- hashing, MAC, digital signature;
- TLS dan mTLS;
- token integrity;
- authorization integrity;
- audit trail integrity;
- secure file transfer;
- secrets/key management.

Part ini menggabungkan semuanya ke masalah yang lebih sulit:

> Bagaimana menjaga **kebenaran state dan maksud bisnis** ketika sistem Java sudah terpecah menjadi banyak service, banyak database, message broker, retry, eventual consistency, async worker, scheduler, webhook, dan integration boundary?

Ini penting karena distributed system bisa tetap memakai TLS, JWT, Kafka/RabbitMQ, database transaction, dan audit log, tetapi tetap gagal secara integrity karena:

- command diproses dua kali;
- event lama diproses setelah event baru;
- message valid secara signature tetapi invalid secara bisnis;
- service menerima event dari source yang salah;
- broker dianggap terlalu dipercaya;
- retry membuat approval, payment, enforcement action, atau notification terjadi ganda;
- outbox mengirim event yang benar, tetapi consumer tidak idempotent;
- service melakukan local invariant yang benar, tetapi cross-service invariant rusak;
- audit mencatat aksi, tetapi bukan aksi yang benar-benar menjadi basis state transition.

Di security engineering, ini termasuk wilayah **data integrity** dan **transaction integrity**. Bukan hanya "data tidak berubah di network", tetapi:

> Data, command, event, decision, dan state transition tetap benar, sah, lengkap, urut secara cukup, tidak bisa dipalsukan, tidak bisa di-replay secara berbahaya, dan bisa dibuktikan kemudian.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan **cryptographic integrity**, **transport integrity**, **application integrity**, **transaction integrity**, dan **business invariant integrity**.
2. Mendesain command dan event yang tahan terhadap replay, duplication, stale update, unauthorized mutation, dan source confusion.
3. Memahami kenapa exactly-once delivery sering menjadi ilusi, dan kenapa idempotency tetap wajib.
4. Mendesain idempotency key, dedup table, inbox table, outbox table, dan processed-message ledger dengan benar.
5. Menentukan kapan event perlu ditandatangani, kapan cukup mTLS/JWT, dan kapan perlu canonical event digest.
6. Memahami trust boundary pada message broker.
7. Mendesain cross-service invariant yang defensible.
8. Membuat review checklist untuk distributed integrity pada sistem Java enterprise.
9. Menghindari anti-pattern seperti "event sudah datang dari broker internal berarti trusted".
10. Membuat mini-architecture untuk regulatory case management yang menjaga state transition integrity.

---

## 2. Mental Model Utama

### 2.1 Integrity Bukan Hanya Hash

Banyak engineer menyederhanakan integrity menjadi:

> "Kalau ada hash/signature berarti integrity aman."

Itu kurang tepat.

Hash, HMAC, signature, TLS, atau database constraint hanya menjaga sebagian property.

Contoh:

```text
Message:
  approveApplication(applicationId=123, approverId=777)

Signature valid.
TLS valid.
JWT valid.
JSON schema valid.
```

Tetapi command tetap bisa tidak sah jika:

- approver tidak punya authority untuk application itu;
- application sudah expired;
- application sedang di-lock karena appeal;
- command adalah replay dari minggu lalu;
- command berasal dari service yang tidak boleh mengeluarkan approval;
- command valid untuk tenant A tetapi dikirim ke tenant B;
- command diproses dua kali;
- command diproses setelah state berubah ke terminal state.

Maka distributed data integrity harus menjawab pertanyaan:

```text
1. Apakah pesan ini berasal dari sumber yang sah?
2. Apakah pesan ini belum berubah?
3. Apakah pesan ini masih fresh?
4. Apakah pesan ini belum pernah diproses secara berbahaya?
5. Apakah pesan ini valid terhadap state saat ini?
6. Apakah aktor punya otoritas untuk efek yang diminta?
7. Apakah efeknya menjaga invariant domain?
8. Apakah hasilnya bisa dibuktikan di kemudian hari?
```

---

### 2.2 Lima Lapisan Integrity

Gunakan lima lapisan ini sebagai mental model.

```text
┌─────────────────────────────────────────────────────────────┐
│ 5. Business Invariant Integrity                              │
│    "State transition ini sah menurut aturan domain."          │
├─────────────────────────────────────────────────────────────┤
│ 4. Application Message Integrity                             │
│    "Command/event ini sah, fresh, authorized, idempotent."    │
├─────────────────────────────────────────────────────────────┤
│ 3. Data Integrity                                             │
│    "Record tidak corrupt, version benar, constraint benar."   │
├─────────────────────────────────────────────────────────────┤
│ 2. Transport Integrity                                        │
│    "Data tidak berubah selama transit."                       │
├─────────────────────────────────────────────────────────────┤
│ 1. Cryptographic Primitive Integrity                          │
│    "MAC/signature/hash valid terhadap bytes tertentu."        │
└─────────────────────────────────────────────────────────────┘
```

Kesalahan umum adalah berhenti di lapisan 1 atau 2.

Top 1% engineer harus berpikir sampai lapisan 5.

---

### 2.3 Integrity = Tidak Ada Unauthorized State Transition

Untuk sistem enterprise, definisi praktisnya:

> Integrity berarti tidak ada state transition yang terjadi kecuali transition itu sah, diminta oleh aktor yang sah, terhadap object yang sah, dalam konteks yang sah, pada waktu yang sah, dan dicatat dengan evidence yang sah.

Contoh dalam regulatory platform:

```text
Application: SUBMITTED → UNDER_REVIEW → APPROVED → LICENSE_ISSUED
```

Integrity violation bukan hanya database row berubah tanpa izin.

Integrity violation juga termasuk:

- `APPROVED` tanpa mandatory checklist;
- `LICENSE_ISSUED` sebelum payment verified;
- appeal dibuat setelah deadline tetapi diterima sebagai valid;
- case assigned ke officer yang conflict-of-interest;
- audit trail tidak bisa membuktikan siapa yang memicu state transition;
- retry dari worker membuat dua enforcement notice terkirim;
- old event mengembalikan status dari `CLOSED` ke `PENDING`.

---

## 3. Taxonomy Integrity di Distributed Java Systems

### 3.1 Command Integrity

Command adalah permintaan melakukan perubahan.

Contoh:

```json
{
  "commandId": "cmd-2026-00001",
  "type": "ApproveApplication",
  "applicationId": "APP-123",
  "actorId": "USR-777",
  "reason": "All checks passed",
  "issuedAt": "2026-06-16T09:15:00Z"
}
```

Command integrity berarti:

1. command dibuat oleh actor/source yang sah;
2. payload tidak berubah;
3. command masih fresh;
4. command belum diproses atau aman jika diproses ulang;
5. command valid terhadap current state;
6. command punya authorization context yang cukup;
7. command menghasilkan state transition yang allowed.

Command harus diperlakukan sebagai **intent**, bukan fakta.

```text
Command = "Please do X"
Event   = "X happened"
```

Kesalahan fatal:

```text
Consumer menerima command dari queue lalu langsung menganggap itu fakta.
```

Yang benar:

```text
Consumer menerima command → validasi source → dedup → authorize → validate state → execute transaction → emit event.
```

---

### 3.2 Event Integrity

Event adalah klaim bahwa sesuatu sudah terjadi.

Contoh:

```json
{
  "eventId": "evt-2026-00001",
  "type": "ApplicationApproved",
  "aggregateId": "APP-123",
  "aggregateVersion": 17,
  "occurredAt": "2026-06-16T09:15:05Z",
  "producer": "application-service",
  "causationId": "cmd-2026-00001",
  "correlationId": "corr-abc",
  "payload": {
    "approvedBy": "USR-777"
  }
}
```

Event integrity berarti:

1. event berasal dari producer yang berwenang;
2. event tidak dimodifikasi;
3. event merepresentasikan fakta domain yang benar;
4. event punya identity unik;
5. event punya ordering/versioning yang cukup;
6. consumer bisa dedup;
7. consumer tidak memproses event out-of-order secara merusak;
8. event bisa ditelusuri ke command/decision penyebabnya.

Event bukan sekadar notification.

Dalam arsitektur event-driven, event sering menjadi bahan state service lain. Jika event integrity rusak, maka seluruh derived state ikut rusak.

---

### 3.3 State Integrity

State integrity berarti data saat ini valid terhadap invariant domain.

Contoh invariant:

```text
A license cannot be ACTIVE if:
- payment is not settled;
- applicant is blacklisted;
- mandatory approval is missing;
- validity period is invalid;
- issuance event is not recorded.
```

Dalam distributed system, state integrity sulit karena sebagian fakta ada di service lain.

```text
license-service:
  license status

payment-service:
  payment settlement

screening-service:
  blacklist result

audit-service:
  evidence trail
```

Local transaction tidak cukup menjaga invariant global.

---

### 3.4 Temporal Integrity

Temporal integrity berarti urutan dan waktu kejadian cukup benar untuk aturan bisnis.

Contoh:

```text
Appeal must be submitted within 14 calendar days after decision notice served.
```

Masalah:

- clock antar service berbeda;
- event datang telat;
- retry membuat event lama muncul lagi;
- consumer memproses event versi lama setelah versi baru;
- scheduler memakai local timezone salah;
- `createdAt` dari client dipercaya.

Temporal integrity membutuhkan:

- trusted time source;
- server-side timestamp;
- versioning;
- monotonic state transition;
- late-event policy;
- explicit business cutoff.

---

### 3.5 Referential Integrity Across Services

Database punya foreign key di dalam satu database.

Microservices sering tidak punya foreign key lintas service.

Contoh:

```text
case-service.case.applicationId → application-service.application.id
```

Integrity risk:

- reference mengarah ke object yang sudah deleted/merged;
- object milik tenant berbeda;
- object version tidak sesuai;
- consumer menerima event untuk aggregate yang tidak dikenal;
- ID ditebak/manipulasi.

Solusi bukan selalu distributed transaction. Biasanya kombinasi:

- immutable IDs;
- tenant-scoped IDs;
- object-level authorization;
- version reference;
- projection reconciliation;
- compensating action;
- periodic integrity check.

---

## 4. Threat Model untuk Distributed Data Integrity

### 4.1 Actor yang Harus Dipertimbangkan

Distributed integrity tidak hanya melawan external attacker.

Pertimbangkan:

| Actor | Risiko |
|---|---|
| External attacker | Inject request, replay callback, manipulate object ID |
| Authenticated user | Horizontal/vertical privilege escalation |
| Compromised client | Mengirim command valid-looking tapi unauthorized |
| Compromised service | Emit event palsu ke broker |
| Misconfigured worker | Process queue salah environment/tenant |
| Rogue admin | Modify broker topic, DB row, config, secret |
| Buggy retry logic | Duplicate side effect |
| Old deployment | Emit schema/event version lama |
| Integration partner | Kirim stale/invalid callback |
| Clock skew | Salah deadline, expiry, ordering |

---

### 4.2 Attack Surface

```text
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ Client/API   │──────▶│ Service A    │──────▶│ Database A   │
└──────────────┘       └──────┬───────┘       └──────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Broker       │
                       └──────┬───────┘
                              │
                              ▼
                       ┌──────────────┐       ┌──────────────┐
                       │ Service B    │──────▶│ Database B   │
                       └──────────────┘       └──────────────┘
```

Integrity attack surface:

1. API request body.
2. Authorization context.
3. Object IDs.
4. Idempotency key.
5. Message broker topic/exchange/queue.
6. Event payload.
7. Event metadata.
8. Consumer offset/ack.
9. Outbox table.
10. Retry scheduler.
11. Dead-letter queue.
12. Projection table.
13. Admin repair script.
14. Migration script.
15. Batch import/export file.
16. Integration callback.

---

### 4.3 STRIDE Mapping untuk Data Integrity

| STRIDE | Distributed integrity example |
|---|---|
| Spoofing | Service palsu publish event sebagai `payment-service` |
| Tampering | Message payload diubah sebelum consumer memproses |
| Repudiation | Tidak bisa membuktikan siapa yang approve command |
| Information Disclosure | Event memuat field sensitif ke topic luas |
| Denial of Service | Duplicate/replay flood membuat consumer overload |
| Elevation of Privilege | User manipulate object ID untuk approve case tenant lain |

---

## 5. Command Design yang Aman

### 5.1 Command Envelope

Jangan desain command sebagai payload polos.

Desain minimal:

```json
{
  "metadata": {
    "messageId": "msg-01JZ...",
    "commandId": "cmd-01JZ...",
    "commandType": "ApproveApplication",
    "schemaVersion": 3,
    "producer": "case-ui-backend",
    "tenantId": "CEA",
    "actorId": "user-777",
    "actorType": "OFFICER",
    "issuedAt": "2026-06-16T09:15:00Z",
    "expiresAt": "2026-06-16T09:20:00Z",
    "correlationId": "corr-abc",
    "causationId": "req-xyz",
    "idempotencyKey": "approve:APP-123:user-777:checklist-v5",
    "payloadDigest": "sha256:..."
  },
  "payload": {
    "applicationId": "APP-123",
    "expectedVersion": 16,
    "decision": "APPROVE",
    "reasonCode": "ALL_CHECKS_PASSED"
  },
  "security": {
    "signatureAlg": "HMAC-SHA256",
    "keyId": "svc-case-command-2026-06",
    "signature": "base64url..."
  }
}
```

Tidak semua sistem butuh semua field. Tetapi metadata ini menunjukkan kategori yang harus dipikirkan.

---

### 5.2 Command Harus Punya Identity

Setiap command harus punya `commandId` atau `messageId` unik.

Tujuannya:

- dedup;
- audit;
- tracing;
- replay detection;
- incident investigation;
- causal linkage.

Anti-pattern:

```java
public void approve(String applicationId) {
    applicationRepository.approve(applicationId);
}
```

Lebih baik:

```java
public ApprovalResult handle(ApproveApplicationCommand command) {
    // commandId, actor, tenant, expectedVersion, issuedAt, idempotencyKey
}
```

---

### 5.3 Command Harus Punya Expected State atau Version

Tanpa expected version, stale command bisa mengubah state baru.

```json
{
  "applicationId": "APP-123",
  "expectedVersion": 16,
  "decision": "APPROVE"
}
```

Handler:

```java
Application app = repository.findByIdForUpdate(command.applicationId());

if (app.version() != command.expectedVersion()) {
    throw new StaleCommandException(command.commandId(), app.version());
}

app.approve(command.actorId(), command.reasonCode());
repository.save(app);
```

Ini bukan hanya concurrency control. Ini integrity control.

---

### 5.4 Command Harus Expire

Command yang terlalu lama tidak boleh selalu valid.

```text
issuedAt  = 09:15
expiresAt = 09:20
```

Gunanya:

- membatasi replay window;
- mencegah approval lama diproses setelah state berubah;
- mengurangi risiko delayed queue;
- mengikat command ke konteks waktu.

Jangan percaya timestamp dari client untuk security decision. Gunakan server-issued command timestamp jika command berasal dari UI/API.

---

### 5.5 Command Harus Diotorisasi di Consumer

Jika command masuk lewat queue, jangan berasumsi authorization sudah dilakukan di producer.

Producer validation bisa jadi bug, bypassed, atau outdated.

Consumer tetap harus enforce:

```text
Can actor X perform action Y on aggregate Z in state S under tenant T?
```

Ini penting untuk mencegah **confused deputy**.

---

## 6. Event Design yang Aman

### 6.1 Event Envelope

Event harus punya metadata cukup untuk integrity, ordering, dedup, dan audit.

```json
{
  "metadata": {
    "eventId": "evt-01JZ...",
    "eventType": "ApplicationApproved",
    "schemaVersion": 4,
    "producer": "application-service",
    "tenantId": "CEA",
    "aggregateType": "Application",
    "aggregateId": "APP-123",
    "aggregateVersion": 17,
    "occurredAt": "2026-06-16T09:15:05Z",
    "publishedAt": "2026-06-16T09:15:06Z",
    "correlationId": "corr-abc",
    "causationId": "cmd-01JZ...",
    "payloadDigest": "sha256:..."
  },
  "payload": {
    "approvedBy": "user-777",
    "reasonCode": "ALL_CHECKS_PASSED"
  }
}
```

---

### 6.2 Event Harus Fakta, Bukan Instruksi Tersembunyi

Buruk:

```json
{
  "type": "UpdateApplicationStatus",
  "newStatus": "APPROVED"
}
```

Lebih baik:

```json
{
  "type": "ApplicationApproved",
  "approvedBy": "user-777",
  "approvedAt": "2026-06-16T09:15:05Z"
}
```

Event yang terlalu generik melemahkan integrity karena consumer tidak tahu semantics.

---

### 6.3 Event Harus Punya Aggregate Version

Version membantu consumer mendeteksi out-of-order event.

```text
APP-123 v17 ApplicationApproved
APP-123 v18 LicenseIssued
APP-123 v16 ApplicationReviewed  ← late event
```

Consumer harus punya policy:

```text
if incomingVersion <= lastSeenVersion:
    duplicate_or_late → ignore or reconcile
if incomingVersion == lastSeenVersion + 1:
    process
if incomingVersion > lastSeenVersion + 1:
    gap detected → pause/retry/reconcile
```

---

### 6.4 Event Harus Punya Source Ownership

Setiap event type harus punya owner.

Contoh:

| Event | Authorized producer |
|---|---|
| `PaymentSettled` | `payment-service` |
| `ApplicationApproved` | `application-service` |
| `CaseClosed` | `case-service` |
| `NoticeServed` | `correspondence-service` |
| `ScreeningHitDetected` | `screening-service` |

Jika service lain publish event yang bukan miliknya, itu integrity violation.

---

## 7. Idempotency

### 7.1 Kenapa Idempotency Wajib

Distributed systems selalu punya kemungkinan:

- retry;
- timeout;
- network partition;
- consumer crash setelah side effect tapi sebelum ack;
- producer resend;
- broker redelivery;
- duplicated webhook;
- user double-click;
- scheduler overlap.

Maka handler harus diasumsikan bisa dipanggil lebih dari sekali.

> Idempotency adalah kemampuan menerima request/message yang sama lebih dari sekali tanpa menghasilkan efek bisnis ganda.

---

### 7.2 Idempotent Receiver Pattern

Pattern dasarnya:

```text
1. Setiap request/message punya unique id.
2. Receiver menyimpan id yang sudah diproses.
3. Jika id datang lagi, receiver mengembalikan result lama atau mengabaikan efek samping.
```

Tabel sederhana:

```sql
CREATE TABLE processed_message (
    message_id        VARCHAR(128) PRIMARY KEY,
    consumer_name     VARCHAR(128) NOT NULL,
    aggregate_id      VARCHAR(128),
    processed_at      TIMESTAMP NOT NULL,
    result_code       VARCHAR(64),
    result_reference  VARCHAR(128)
);
```

Namun untuk multi-consumer, primary key biasanya perlu composite:

```sql
CREATE TABLE processed_message (
    consumer_name     VARCHAR(128) NOT NULL,
    message_id        VARCHAR(128) NOT NULL,
    processed_at      TIMESTAMP NOT NULL,
    result_code       VARCHAR(64),
    result_reference  VARCHAR(128),
    PRIMARY KEY (consumer_name, message_id)
);
```

---

### 7.3 Idempotency Key Bukan Sekadar UUID Random

UUID random berguna untuk unique request identity, tetapi idempotency key harus merepresentasikan **business operation identity**.

Contoh buruk:

```text
idempotencyKey = random UUID generated every retry
```

Itu tidak idempotent karena retry punya key baru.

Contoh lebih baik:

```text
approve:APP-123:decision-v16:actor-USR-777
```

Atau untuk payment:

```text
payment:invoice-789:attempt-3
```

Untuk external API, client bisa mengirim key, tetapi server harus scope key dengan:

```text
tenant + actor/client + operation + resource
```

Agar key dari user A tidak menabrak user B.

---

### 7.4 Idempotency Store Harus Atomic dengan Side Effect

Anti-pattern:

```text
1. Check processed_message.
2. Do side effect.
3. Insert processed_message.
```

Jika crash setelah side effect sebelum insert, message akan diproses ulang.

Lebih aman:

```text
BEGIN TRANSACTION
  INSERT processed_message(...)
  UPDATE aggregate/state
  INSERT outbox event
COMMIT
```

Jika insert `processed_message` gagal karena duplicate key, berarti message sudah pernah diproses.

Contoh Java pseudo-code:

```java
@Transactional
public void handle(ApplicationApprovedEvent event) {
    boolean inserted = processedMessageRepository.tryInsert(
        "license-service",
        event.eventId(),
        event.aggregateId()
    );

    if (!inserted) {
        return;
    }

    LicenseDraft draft = licenseDraftRepository.findByApplicationId(event.aggregateId())
        .orElseThrow();

    draft.markApplicationApproved(event.aggregateVersion());
    licenseDraftRepository.save(draft);

    outboxRepository.append(LicenseDraftUpdated.from(draft, event));
}
```

---

## 8. Replay Protection

### 8.1 Duplicate vs Replay

Duplicate bisa benign.

Replay bisa malicious.

```text
Duplicate:
  Broker redelivers same event after consumer crash.

Replay:
  Attacker resends old signed command to trigger action again.
```

Keduanya butuh dedup, tetapi replay juga butuh:

- freshness;
- expiry;
- nonce;
- authorization context;
- state validation;
- processed-command ledger;
- signature/MAC verification.

---

### 8.2 Replay Window

Replay protection biasanya memakai kombinasi:

```text
signature/HMAC + timestamp + nonce/idempotency key + expiry + server-side replay cache
```

Contoh verification:

```java
public void verifySignedCommand(SignedCommand command) {
    clockValidator.requireWithinWindow(command.issuedAt(), Duration.ofMinutes(5));
    signatureVerifier.verify(command);

    boolean firstSeen = nonceStore.tryInsert(
        command.producer(),
        command.nonce(),
        command.expiresAt()
    );

    if (!firstSeen) {
        throw new ReplayDetectedException(command.commandId());
    }
}
```

Catatan penting:

- timestamp tanpa nonce masih bisa direplay selama window;
- nonce tanpa expiry membuat storage membengkak;
- signature tanpa canonicalization bisa divergent;
- replay cache harus scope per producer/client.

---

### 8.3 State-Based Replay Defense

Untuk command state transition, replay paling kuat dicegah oleh state machine.

```text
APP-123 state = APPROVED
Incoming command = ApproveApplication(APP-123, expectedVersion=16)
Current version = 17
Reject as stale/replay.
```

Jadi jangan hanya bergantung pada replay cache.

Gabungkan:

```text
cryptographic freshness + replay ledger + state machine invariant
```

---

## 9. Transactional Outbox

### 9.1 Problem: Database Commit dan Message Publish Tidak Atomic

Kasus klasik:

```text
1. Service update database: application approved.
2. Service publish event: ApplicationApproved.
```

Failure:

```text
Database commit success.
Publish event failed.
```

Akibatnya state berubah tetapi event tidak terkirim.

Atau sebaliknya:

```text
Publish event success.
Database commit failed.
```

Akibatnya consumer percaya approval terjadi padahal database tidak berubah.

---

### 9.2 Outbox Pattern

Solusi umum:

```text
Dalam transaksi database yang sama:
  1. Update aggregate.
  2. Insert event ke outbox table.

Relay process:
  3. Baca outbox.
  4. Publish ke broker.
  5. Mark published.
```

Skema sederhana:

```sql
CREATE TABLE outbox_event (
    id                VARCHAR(128) PRIMARY KEY,
    aggregate_type    VARCHAR(128) NOT NULL,
    aggregate_id      VARCHAR(128) NOT NULL,
    aggregate_version BIGINT NOT NULL,
    event_type        VARCHAR(128) NOT NULL,
    schema_version    INTEGER NOT NULL,
    payload_json      CLOB NOT NULL,
    payload_digest    VARCHAR(128) NOT NULL,
    occurred_at       TIMESTAMP NOT NULL,
    published_at      TIMESTAMP NULL,
    publish_attempts  INTEGER NOT NULL DEFAULT 0,
    status            VARCHAR(32) NOT NULL
);
```

---

### 9.3 Outbox Integrity Invariant

Outbox harus menjamin:

```text
No state transition without corresponding outbox event.
No outbox event claiming state transition that did not commit.
```

Ini bisa dijaga dengan:

- single DB transaction;
- aggregate version;
- outbox row immutable setelah dibuat;
- payload digest;
- append-only policy;
- relay idempotency;
- consumer idempotency.

---

### 9.4 Relay Bisa Publish Duplikat

Outbox tidak menghilangkan duplicate event.

Relay bisa crash setelah publish tetapi sebelum mark `published`.

Maka event bisa dipublish lagi.

Karena itu consumer tetap harus idempotent.

```text
Outbox gives atomic state + event recording.
It does not guarantee exactly-once processing by all consumers.
```

---

## 10. Inbox Pattern

### 10.1 Kenapa Consumer Butuh Inbox

Jika consumer melakukan side effect berdasarkan event, consumer butuh log message yang diterima/diproses.

```sql
CREATE TABLE inbox_message (
    consumer_name      VARCHAR(128) NOT NULL,
    message_id         VARCHAR(128) NOT NULL,
    producer           VARCHAR(128) NOT NULL,
    event_type         VARCHAR(128) NOT NULL,
    aggregate_id       VARCHAR(128),
    aggregate_version  BIGINT,
    received_at        TIMESTAMP NOT NULL,
    processed_at       TIMESTAMP NULL,
    status             VARCHAR(32) NOT NULL,
    payload_digest     VARCHAR(128),
    PRIMARY KEY (consumer_name, message_id)
);
```

Inbox berguna untuk:

- dedup;
- replay investigation;
- poison message handling;
- reconciliation;
- audit;
- consumer recovery.

---

### 10.2 Consumer Processing Flow

```text
Receive event
  ↓
Validate envelope
  ↓
Validate producer is allowed for event type
  ↓
Verify signature/MAC if applicable
  ↓
Insert inbox row atomically
  ↓
Validate event version/order
  ↓
Apply local state update
  ↓
Append local outbox event if needed
  ↓
Commit transaction
  ↓
Ack message
```

Pseudo-code:

```java
@Transactional
public void onMessage(EventEnvelope event) {
    envelopeValidator.validate(event);
    producerPolicy.requireAllowed(event.producer(), event.eventType());

    if (event.isSigned()) {
        eventSignatureVerifier.verify(event);
    }

    boolean firstSeen = inboxRepository.tryInsert(event, "case-projection-service");
    if (!firstSeen) {
        return;
    }

    projectionUpdater.apply(event);
}
```

---

## 11. Broker Trust Boundary

### 11.1 Broker Internal Tidak Berarti Trusted

Kesalahan umum:

> "Kafka/RabbitMQ internal, jadi message pasti trusted."

Faktanya broker adalah boundary tersendiri.

Risiko:

- credential broker bocor;
- service salah publish ke topic;
- admin mengubah routing;
- topic dipakai multi-tenant tanpa isolation cukup;
- dead-letter replay manual tanpa validation;
- old service version publish schema lama;
- consumer membaca topic yang tidak seharusnya;
- message modified by middleware/plugin;
- broker backup/restore membawa old messages.

---

### 11.2 Broker Menjamin Delivery, Bukan Business Truth

Broker bisa membantu:

- durable message;
- ordering dalam partition/queue tertentu;
- redelivery;
- routing;
- consumer group;
- ack/nack;
- retention.

Broker tidak otomatis menjamin:

- producer authorized secara domain;
- payload benar secara bisnis;
- event tidak stale;
- event tidak duplicate;
- consumer idempotent;
- cross-service invariant.

---

### 11.3 Broker-Level Controls

Minimum controls:

1. TLS/mTLS ke broker.
2. Per-service credential.
3. Least privilege topic/exchange/queue permission.
4. Producer ACL.
5. Consumer ACL.
6. Separate topic per domain/tenant sensitivity jika perlu.
7. DLQ protected dari replay sembarangan.
8. Audit broker admin action.
9. Schema registry compatibility policy.
10. Monitoring unexpected producer/event type.

---

### 11.4 Application-Level Controls Tetap Wajib

Di atas broker controls, aplikasi tetap butuh:

- event metadata;
- source ownership validation;
- idempotency;
- version check;
- schema validation;
- optional message signature/MAC;
- consumer authorization policy;
- reconciliation job.

---

## 12. Message Signing dan Event Digest

### 12.1 Kapan Message Perlu Ditandatangani?

Tidak semua internal event perlu signature. Tetapi signature/MAC layak dipertimbangkan jika:

- event melewati boundary organisasi;
- broker dikelola pihak lain;
- event menjadi evidence hukum/regulatory;
- event mengubah state bernilai tinggi;
- ada replay/reprocessing dari storage/archive;
- ada multi-tenant broker;
- consumer perlu membuktikan event berasal dari producer tertentu;
- ada threat rogue admin atau compromised middleware.

---

### 12.2 HMAC vs Digital Signature untuk Event

| Mekanisme | Cocok untuk | Catatan |
|---|---|---|
| HMAC | Producer dan consumer dalam trust domain sama | Shared secret; sulit non-repudiation |
| Digital signature | Cross-boundary, evidence, multi-consumer | Private key custody lebih penting |
| Payload digest only | Corruption detection internal | Tidak membuktikan source |
| TLS only | Transport integrity | Hilang setelah message persisted/replayed |

---

### 12.3 Canonicalization Event

Signature harus dihitung atas representasi canonical.

Jangan sign string JSON hasil serializer yang tidak stabil tanpa aturan.

Canonical fields:

```text
metadata.eventId
metadata.eventType
metadata.schemaVersion
metadata.producer
metadata.tenantId
metadata.aggregateType
metadata.aggregateId
metadata.aggregateVersion
metadata.occurredAt
payload canonical JSON
```

Contoh signing string:

```text
eventId:evt-01JZ...
eventType:ApplicationApproved
schemaVersion:4
producer:application-service
tenantId:CEA
aggregateType:Application
aggregateId:APP-123
aggregateVersion:17
occurredAt:2026-06-16T09:15:05Z
payloadDigest:sha256:abc...
```

---

### 12.4 Digest untuk Reconciliation

Event digest berguna untuk:

- detect corruption;
- compare outbox vs broker vs consumer inbox;
- audit evidence;
- replay validation;
- data migration verification.

Skema:

```text
outbox.payload_digest
broker header payload_digest
consumer_inbox.payload_digest
projection.source_event_digest
```

Jika mismatch, jangan auto-repair tanpa investigation.

---

## 13. Ordering dan Versioning

### 13.1 Ordering Global Biasanya Mahal

Distributed systems jarang punya global ordering yang mudah dan murah.

Lebih realistis:

```text
Order per aggregate.
Order per partition key.
Order per workflow instance.
```

Contoh partition key:

```text
aggregateId = APP-123
```

Dengan Kafka, ordering biasanya dijaga dalam partition. Dengan RabbitMQ, ordering bisa terpengaruh concurrency consumer, retry, DLQ, dan requeue.

---

### 13.2 Aggregate Version

Gunakan monotonically increasing version per aggregate.

```text
APP-123 v1 Submitted
APP-123 v2 Assigned
APP-123 v3 Reviewed
APP-123 v4 Approved
```

Consumer menyimpan:

```sql
CREATE TABLE projection_checkpoint (
    projection_name VARCHAR(128) NOT NULL,
    aggregate_id    VARCHAR(128) NOT NULL,
    last_version    BIGINT NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    PRIMARY KEY (projection_name, aggregate_id)
);
```

---

### 13.3 Gap Detection

Jika consumer menerima v5 tetapi last seen v3, ada gap v4.

Policy:

```text
1. Jangan langsung apply v5.
2. Simpan sebagai pending.
3. Retry fetch missing event atau trigger reconciliation.
4. Alert jika gap terlalu lama.
```

---

### 13.4 Late Event Policy

Late event tidak selalu malicious. Bisa karena retry, DLQ replay, restore, atau network issue.

Tetapi late event tidak boleh merusak state.

Policy umum:

| Condition | Action |
|---|---|
| version <= lastVersion | ignore as duplicate/late |
| version == lastVersion + 1 | apply |
| version > lastVersion + 1 | hold/reconcile |
| terminal state already reached | reject or compensate |
| event type incompatible with current state | dead-letter + alert |

---

## 14. Cross-Service Invariant

### 14.1 Masalah Local Transaction

Dalam monolith, invariant bisa dijaga dalam satu transaction.

```text
BEGIN
  update application
  update payment
  insert license
COMMIT
```

Dalam microservices:

```text
application-service DB
payment-service DB
license-service DB
```

Tidak ada single transaction natural.

---

### 14.2 Kategori Cross-Service Invariant

| Invariant | Contoh |
|---|---|
| Eligibility invariant | License hanya issued jika applicant eligible |
| Payment invariant | License hanya active jika payment settled |
| Authorization invariant | Officer hanya mutate case yang assigned/authorized |
| Temporal invariant | Appeal hanya valid sebelum deadline |
| Uniqueness invariant | Satu active license per category per entity |
| Referential invariant | Case harus refer ke valid application |
| Evidence invariant | Enforcement action harus punya evidence attachment |

---

### 14.3 Strategi Menjaga Cross-Service Invariant

Tidak ada satu solusi universal.

Gunakan kombinasi:

1. **Single owner service** untuk invariant kritikal.
2. **Saga/process manager** untuk workflow multi-step.
3. **Reservation pattern** untuk resource/uniqueness.
4. **Outbox/inbox** untuk event propagation.
5. **Idempotent command handler** untuk retry.
6. **Compensating action** untuk failure.
7. **Reconciliation job** untuk eventual correction.
8. **Read model with source version** untuk decision transparency.
9. **Policy engine** untuk authorization/business rule consistency.
10. **Audit/evidence binding** untuk defensibility.

---

### 14.4 Single Owner Principle

Untuk setiap business invariant penting, harus jelas service mana pemilik final decision.

Contoh:

```text
payment-service owns payment settlement truth.
application-service owns application approval truth.
license-service owns license issuance truth.
audit-service owns audit record append-only storage.
```

Consumer tidak boleh mengarang fakta domain service lain.

Buruk:

```text
license-service assumes payment settled because callback payload says paid.
```

Lebih baik:

```text
payment-service verifies callback, records settlement, emits PaymentSettled.
license-service reacts to PaymentSettled from payment-service only.
```

---

## 15. Saga dan Process Manager Integrity

### 15.1 Saga Bukan Pengganti Invariant

Saga mengorkestrasi langkah, tetapi tiap langkah tetap harus validate invariant.

Contoh issuance workflow:

```text
ApplicationApproved
  → request payment verification
  → wait PaymentSettled
  → request license number reservation
  → issue license
  → publish LicenseIssued
```

Process manager menyimpan state:

```sql
CREATE TABLE license_issuance_process (
    process_id        VARCHAR(128) PRIMARY KEY,
    application_id    VARCHAR(128) NOT NULL,
    current_step      VARCHAR(64) NOT NULL,
    status            VARCHAR(32) NOT NULL,
    last_event_id     VARCHAR(128),
    version           BIGINT NOT NULL,
    created_at        TIMESTAMP NOT NULL,
    updated_at        TIMESTAMP NOT NULL
);
```

---

### 15.2 Saga Integrity Controls

1. Process id unique.
2. One active process per aggregate where required.
3. Step transition table explicit.
4. Incoming event dedup.
5. Expected version on process update.
6. Timeout policy.
7. Compensation policy.
8. Manual intervention audit.
9. Correlation/causation id.
10. Terminal state immutable unless formal reopen process exists.

---

### 15.3 Saga Failure Mode

Common failure:

```text
PaymentSettled received twice
  → process manager sends IssueLicense twice
  → license-service creates duplicate license
```

Defense:

- process manager idempotency;
- `IssueLicense` command idempotency;
- license uniqueness constraint;
- license-service state validation;
- audit duplicate detection.

Top engineer tidak memilih satu defense. Mereka membuat layered defense.

---

## 16. Exactly-Once Illusion

### 16.1 Apa yang Biasanya Dimaksud Exactly-Once

Banyak platform mengiklankan exactly-once dalam konteks tertentu.

Namun business exactly-once end-to-end jauh lebih sulit.

Yang sering dijamin hanya:

- producer transaction ke broker;
- dedup dalam broker;
- exactly-once stream processing dalam boundary tertentu;
- offset dan output topic atomically committed.

Tetapi begitu ada:

- database external;
- HTTP side effect;
- email/SMS;
- third-party API;
- manual retry;
- DLQ replay;
- multi-service workflow;

maka exactly-once business effect tidak otomatis dijamin.

---

### 16.2 Prinsip Aman

Anggap delivery minimal:

```text
at-least-once delivery
out-of-order possible
duplicate possible
late message possible
partial failure possible
```

Lalu desain:

- idempotent handler;
- dedup ledger;
- version check;
- unique constraints;
- compensating action;
- reconciliation.

---

### 16.3 Side Effect yang Sulit Di-Undo

Contoh:

- email terkirim;
- SMS terkirim;
- payment captured;
- license number issued;
- enforcement notice served;
- external system notified.

Untuk side effect seperti ini:

1. gunakan idempotency key ke downstream jika didukung;
2. simpan request/response downstream;
3. jangan retry buta;
4. gunakan pending/confirmed state;
5. pisahkan `attempted` dan `confirmed`;
6. buat manual reconciliation path.

---

## 17. Database Constraints Sebagai Integrity Defense

### 17.1 Constraint Bukan Sekadar Data Modeling

Database constraint adalah last line of defense.

Contoh:

```sql
ALTER TABLE license
ADD CONSTRAINT uq_active_license
UNIQUE (licensee_id, license_category, active_flag);
```

Atau partial unique index jika database mendukung.

Untuk Oracle, bisa memakai function-based unique index:

```sql
CREATE UNIQUE INDEX uq_active_license
ON license (
    CASE WHEN status = 'ACTIVE' THEN licensee_id END,
    CASE WHEN status = 'ACTIVE' THEN license_category END
);
```

---

### 17.2 Optimistic Locking

```java
@Entity
class ApplicationEntity {
    @Id
    private String id;

    @Version
    private long version;

    private String status;
}
```

Optimistic locking menjaga lost update, tetapi tidak otomatis menjaga business transition.

Tetap perlu domain validation:

```java
public void approve(Actor actor, ReasonCode reason) {
    if (status != Status.UNDER_REVIEW) {
        throw new InvalidTransitionException(status, Status.APPROVED);
    }
    if (!actor.canApprove(this)) {
        throw new UnauthorizedTransitionException(actor.id(), id);
    }
    this.status = Status.APPROVED;
}
```

---

### 17.3 Append-Only Ledger

Untuk state bernilai tinggi, pertimbangkan append-only transition log.

```sql
CREATE TABLE application_state_transition (
    transition_id     VARCHAR(128) PRIMARY KEY,
    application_id    VARCHAR(128) NOT NULL,
    from_state        VARCHAR(64) NOT NULL,
    to_state          VARCHAR(64) NOT NULL,
    aggregate_version BIGINT NOT NULL,
    command_id        VARCHAR(128) NOT NULL,
    actor_id          VARCHAR(128) NOT NULL,
    occurred_at       TIMESTAMP NOT NULL,
    payload_digest    VARCHAR(128) NOT NULL
);
```

Ini membantu:

- audit;
- replay reconstruction;
- forensic;
- reconciliation;
- tamper detection jika dikombinasikan hash chain/signature.

---

## 18. Schema Integrity dan Compatibility

### 18.1 Schema Drift Sebagai Integrity Risk

Event schema berubah bisa membuat consumer salah interpretasi.

Contoh:

```json
// v1
{ "status": "APPROVED" }

// v2
{ "decision": "APPROVED", "approvalScope": "PARTIAL" }
```

Consumer lama mungkin menganggap `APPROVED` selalu full approval.

---

### 18.2 Compatibility Rules

Minimum:

1. Event type immutable secara semantics.
2. Field baru optional atau default jelas.
3. Field meaning tidak berubah diam-diam.
4. Enum baru tidak merusak consumer.
5. Breaking change = event type/version baru.
6. Consumer harus validate schema version.
7. Unknown critical fields harus fail closed.

---

### 18.3 Semantic Versioning untuk Event

```text
ApplicationApproved.v1
ApplicationApproved.v2
ApplicationPartiallyApproved.v1
```

Jangan memaksa satu event type menampung semua perubahan semantics.

---

## 19. Integrity Observability

### 19.1 Metric yang Harus Ada

| Metric | Tujuan |
|---|---|
| duplicate_message_count | Melihat redelivery/retry abnormal |
| replay_detected_count | Security signal |
| stale_command_rejected_count | Detect UX/race/replay |
| event_gap_detected_count | Ordering/projection issue |
| invalid_transition_count | Domain integrity issue |
| unauthorized_transition_count | Security issue |
| outbox_publish_lag | Event propagation health |
| inbox_processing_lag | Consumer health |
| dlq_message_count | Poison message/integrity failure |
| reconciliation_mismatch_count | Data drift signal |

---

### 19.2 Log Fields untuk Investigation

```text
messageId
commandId
eventId
idempotencyKey
correlationId
causationId
aggregateType
aggregateId
aggregateVersion
actorId
tenantId
producer
consumer
schemaVersion
payloadDigest
decision
rejectReason
```

Jangan log secret, token, full sensitive payload, atau private data yang tidak perlu.

---

### 19.3 Alert yang Bernilai

Alert bukan hanya service down.

Alert integrity:

- replay detected;
- unexpected producer for event type;
- invalid signature;
- aggregate version gap high;
- DLQ spike;
- stale command spike;
- reconciliation mismatch;
- duplicate license/payment/notice prevented by DB constraint;
- event from unknown schema version;
- outbox lag melewati SLA.

---

## 20. Reconciliation

### 20.1 Kenapa Reconciliation Wajib

Karena eventual consistency berarti drift bisa terjadi.

Reconciliation adalah proses membandingkan source of truth dengan derived state.

Contoh:

```text
application-service says APP-123 = APPROVED v17
license-service projection says APP-123 = UNDER_REVIEW v16
```

Maka ada drift.

---

### 20.2 Reconciliation Types

| Type | Contoh |
|---|---|
| Count reconciliation | Jumlah approved application vs license draft |
| Key reconciliation | Set aggregate ID yang missing |
| Version reconciliation | Projection version berbeda |
| Digest reconciliation | Payload digest mismatch |
| Business invariant reconciliation | License active tanpa payment settled |
| Temporal reconciliation | Appeal diterima setelah deadline |

---

### 20.3 Reconciliation Job Pattern

```text
1. Pull source-of-truth snapshot.
2. Pull consumer projection snapshot.
3. Compare by aggregateId/version/digest.
4. Classify mismatch.
5. Auto-repair only for safe deterministic cases.
6. Emit investigation task for high-risk mismatch.
7. Record reconciliation audit.
```

Pseudo-code:

```java
public void reconcileApprovedApplications() {
    Stream<ApplicationSnapshot> source = applicationClient.streamApprovedSince(lastWatermark);

    source.forEach(app -> {
        Projection projection = licenseProjectionRepository.find(app.id());

        if (projection == null) {
            mismatchRepository.recordMissingProjection(app.id(), app.version());
            return;
        }

        if (projection.sourceVersion() < app.version()) {
            mismatchRepository.recordStaleProjection(app.id(), projection.sourceVersion(), app.version());
            return;
        }

        if (!projection.sourceDigest().equals(app.digest())) {
            mismatchRepository.recordDigestMismatch(app.id());
        }
    });
}
```

---

## 21. Regulatory Case Management Example

### 21.1 Domain

Misal sistem punya modules:

- Application Management;
- Payment;
- Screening;
- Case;
- Correspondence;
- License;
- Audit;
- Notification.

Workflow:

```text
ApplicationSubmitted
  → ScreeningCompleted
  → ApplicationReviewed
  → ApplicationApproved
  → PaymentSettled
  → LicenseIssued
  → NoticeServed
```

---

### 21.2 Integrity Invariants

```text
I1. Application cannot be approved unless screening is completed.
I2. Application cannot be approved by unauthorized officer.
I3. License cannot be issued unless application approved and payment settled.
I4. Notice cannot be served unless license issued.
I5. Appeal deadline must be calculated from notice served time.
I6. Every state transition must have audit evidence.
I7. Every external notification must be idempotent.
I8. No event from non-owner service can alter aggregate truth.
```

---

### 21.3 Event Ownership

| Event | Owner |
|---|---|
| `ApplicationSubmitted` | application-service |
| `ScreeningCompleted` | screening-service |
| `ApplicationApproved` | application-service |
| `PaymentSettled` | payment-service |
| `LicenseIssued` | license-service |
| `NoticeServed` | correspondence-service |
| `AuditRecordAppended` | audit-service |

---

### 21.4 License Issuance Process

```text
license-process-manager
  listens ApplicationApproved
  checks payment projection
  if payment already settled → send IssueLicense
  else wait PaymentSettled

license-service
  handles IssueLicense command
  validates:
    - application approved evidence exists
    - payment settled evidence exists
    - no active duplicate license
    - command idempotency
    - expected process state
  creates license
  appends LicenseIssued to outbox
```

---

### 21.5 Defensive Layers

```text
Layer 1: mTLS service-to-service
Layer 2: broker ACL
Layer 3: event source ownership validation
Layer 4: inbox dedup
Layer 5: aggregate version check
Layer 6: DB uniqueness constraint
Layer 7: outbox atomicity
Layer 8: audit transition log
Layer 9: reconciliation job
Layer 10: incident dashboard
```

Ini contoh layered integrity design.

---

## 22. Java Implementation Building Blocks

### 22.1 Domain Command Interface

```java
public interface DomainCommand {
    String commandId();
    String tenantId();
    String actorId();
    String idempotencyKey();
    Instant issuedAt();
    Instant expiresAt();
    String aggregateId();
    long expectedVersion();
}
```

---

### 22.2 Event Envelope Record

```java
public record EventEnvelope<T>(
    EventMetadata metadata,
    T payload
) {}

public record EventMetadata(
    String eventId,
    String eventType,
    int schemaVersion,
    String producer,
    String tenantId,
    String aggregateType,
    String aggregateId,
    long aggregateVersion,
    Instant occurredAt,
    Instant publishedAt,
    String correlationId,
    String causationId,
    String payloadDigest
) {}
```

---

### 22.3 Producer Ownership Policy

```java
public final class EventProducerPolicy {
    private final Map<String, Set<String>> allowedProducersByEventType;

    public void requireAllowed(String producer, String eventType) {
        Set<String> allowed = allowedProducersByEventType.getOrDefault(eventType, Set.of());
        if (!allowed.contains(producer)) {
            throw new UnauthorizedEventProducerException(producer, eventType);
        }
    }
}
```

---

### 22.4 Idempotency Repository

```java
public interface ProcessedMessageRepository {
    /**
     * Returns true only when this consumer/message pair has not been seen before.
     * Must be implemented with a unique constraint and executed in the same
     * transaction as the business side effect.
     */
    boolean tryInsert(String consumerName, String messageId, String aggregateId);
}
```

Implementation idea:

```java
@Repository
public class JdbcProcessedMessageRepository implements ProcessedMessageRepository {
    private final JdbcTemplate jdbcTemplate;

    @Override
    public boolean tryInsert(String consumerName, String messageId, String aggregateId) {
        try {
            jdbcTemplate.update("""
                INSERT INTO processed_message
                    (consumer_name, message_id, aggregate_id, processed_at)
                VALUES
                    (?, ?, ?, CURRENT_TIMESTAMP)
                """, consumerName, messageId, aggregateId);
            return true;
        } catch (DuplicateKeyException duplicate) {
            return false;
        }
    }
}
```

---

### 22.5 Aggregate Transition Guard

```java
public final class Application {
    private final String id;
    private ApplicationStatus status;
    private long version;

    public ApplicationApproved approve(ApproveApplicationCommand command, AuthorizationDecision decision) {
        if (!decision.allowed()) {
            throw new UnauthorizedTransitionException(command.actorId(), id);
        }

        if (command.expectedVersion() != version) {
            throw new StaleCommandException(command.commandId(), version);
        }

        if (status != ApplicationStatus.UNDER_REVIEW) {
            throw new InvalidTransitionException(status, ApplicationStatus.APPROVED);
        }

        this.status = ApplicationStatus.APPROVED;
        this.version++;

        return new ApplicationApproved(id, version, command.actorId(), command.commandId());
    }
}
```

---

## 23. Anti-Patterns

### 23.1 Trusting Internal Messages Blindly

```text
"It's internal queue, no need to validate."
```

Wrong. Internal compromise and misconfiguration are real.

---

### 23.2 No Idempotency Because Broker Is Reliable

Broker durability does not prevent duplicate delivery or consumer crash side effects.

---

### 23.3 Using Timestamp as Ordering Guarantee

Clock time is not a safe ordering guarantee across services.

Use aggregate version or logical ordering.

---

### 23.4 Event Without Owner

If any service can emit `StatusChanged`, integrity collapses.

---

### 23.5 Generic Update Event

```json
{ "type": "EntityUpdated", "fields": { ... } }
```

This hides business semantics and weakens validation.

---

### 23.6 Replay Cache Without State Validation

Replay cache can expire. State machine must still reject invalid old operations.

---

### 23.7 Outbox Without Consumer Idempotency

Outbox can publish duplicates. Consumer must dedup.

---

### 23.8 DLQ Manual Replay Without Guardrails

DLQ replay can re-trigger old side effects.

Require:

- replay authorization;
- dry-run;
- idempotency check;
- event age check;
- audit reason;
- bounded batch.

---

### 23.9 Projection as Source of Truth

Derived read model should not become authority for critical command unless explicitly designed as such.

---

### 23.10 Repair Script Without Audit

Manual DB update can become biggest integrity breach.

All repair scripts must have:

- ticket/reference;
- dry-run output;
- approval;
- before/after snapshot;
- rollback/compensation plan;
- audit record.

---

## 24. Failure Modes

### 24.1 Duplicate Command

Cause:

- user double click;
- client retry;
- API gateway retry;
- timeout ambiguity.

Defense:

- idempotency key;
- command ledger;
- unique constraints;
- return previous result.

---

### 24.2 Stale Command

Cause:

- UI loaded old version;
- approval delayed;
- queue lag;
- retry after state changed.

Defense:

- expected version;
- expiry;
- state transition guard.

---

### 24.3 Out-of-Order Event

Cause:

- concurrent consumer;
- partitioning wrong;
- DLQ replay;
- retry.

Defense:

- aggregate version;
- checkpoint;
- gap detection;
- hold/reconcile.

---

### 24.4 Unauthorized Producer

Cause:

- compromised service;
- wrong topic permission;
- bug;
- migration script.

Defense:

- producer ACL;
- event ownership validation;
- signature/MAC;
- alert.

---

### 24.5 Side Effect Before Commit

Cause:

- sending email/API call inside DB transaction;
- crash after external side effect.

Defense:

- outbox;
- side effect worker;
- downstream idempotency key;
- status lifecycle.

---

### 24.6 Projection Drift

Cause:

- missed event;
- schema change;
- consumer bug;
- manual repair.

Defense:

- reconciliation;
- source version;
- digest;
- replay from outbox/event store.

---

## 25. Production Checklist

### 25.1 Command Checklist

- [ ] Does every command have unique command ID?
- [ ] Does every mutating command have idempotency key?
- [ ] Is idempotency key scoped by tenant/client/actor/resource?
- [ ] Does command include expected aggregate version where needed?
- [ ] Does command expire?
- [ ] Is command authorized at execution point?
- [ ] Is command validated against current state?
- [ ] Is replay detected?
- [ ] Is command linked to audit/correlation/causation?
- [ ] Is result deterministic for duplicate command?

---

### 25.2 Event Checklist

- [ ] Does every event have event ID?
- [ ] Does every event have producer identity?
- [ ] Is producer allowed for event type?
- [ ] Does event include aggregate ID and version?
- [ ] Does event include schema version?
- [ ] Does event carry correlation and causation ID?
- [ ] Does consumer dedup event?
- [ ] Does consumer detect stale/out-of-order event?
- [ ] Is event immutable after publication?
- [ ] Is sensitive data minimized?

---

### 25.3 Broker Checklist

- [ ] TLS/mTLS enabled?
- [ ] Per-service credentials?
- [ ] Least privilege ACL?
- [ ] Topic/exchange ownership documented?
- [ ] DLQ replay controlled?
- [ ] Unexpected producer monitored?
- [ ] Message retention aligns with replay risk?
- [ ] Schema compatibility enforced?
- [ ] Admin action audited?
- [ ] Cross-environment isolation guaranteed?

---

### 25.4 Outbox/Inbox Checklist

- [ ] Outbox insert atomic with aggregate update?
- [ ] Outbox row immutable?
- [ ] Payload digest stored?
- [ ] Relay idempotent?
- [ ] Consumer inbox/processed-message table exists?
- [ ] Inbox insert atomic with side effect?
- [ ] Duplicate handling returns safe result?
- [ ] Poison message policy defined?
- [ ] Reconciliation exists?
- [ ] Manual repair audited?

---

### 25.5 Cross-Service Invariant Checklist

- [ ] Is the source of truth clear?
- [ ] Is owner service clear?
- [ ] Is invariant enforced at command boundary?
- [ ] Are derived projections marked as derived?
- [ ] Is stale projection tolerated safely?
- [ ] Is reconciliation defined?
- [ ] Is compensation defined?
- [ ] Are terminal states protected?
- [ ] Is manual override audited?
- [ ] Is evidence linked to state transition?

---

## 26. Review Questions

Gunakan pertanyaan ini saat architecture review atau PR review.

1. Apa state transition yang bisa terjadi dari message ini?
2. Siapa source of truth untuk fakta ini?
3. Apakah producer message ini berwenang?
4. Apakah message bisa diproses ulang?
5. Apa yang terjadi jika consumer crash setelah side effect tapi sebelum ack?
6. Apa yang terjadi jika event v18 datang sebelum v17?
7. Apa yang terjadi jika command lama di-replay setelah aggregate terminal?
8. Apakah idempotency key benar-benar stabil antar retry?
9. Apakah dedup atomic dengan business update?
10. Apakah event mengandung cukup metadata untuk forensic?
11. Apakah projection bisa drift dari source?
12. Bagaimana drift dideteksi dan diperbaiki?
13. Apakah DLQ replay bisa menciptakan side effect ganda?
14. Apakah schema change bisa membuat consumer salah interpretasi?
15. Apakah manual repair script meninggalkan audit evidence?

---

## 27. Mini Case Study: Duplicate Enforcement Notice

### 27.1 Scenario

Sistem mengirim enforcement notice saat case status berubah ke `NOTICE_READY`.

Flow awal:

```text
case-service updates case status
case-service publishes CaseNoticeReady
correspondence-service consumes event
correspondence-service sends email/letter
```

Incident:

```text
Consumer crash setelah email dikirim tapi sebelum message ack.
Broker redelivers event.
Consumer kirim email lagi.
Citizen menerima dua notice.
Deadline appeal menjadi ambigu.
```

---

### 27.2 Root Cause

1. Consumer tidak idempotent.
2. External side effect tidak punya idempotency key.
3. Notice identity tidak unik.
4. No processed-message ledger.
5. No business constraint `one notice per case per noticeType per version`.

---

### 27.3 Improved Design

```text
CaseNoticeReady(caseId, caseVersion, noticeType)
  ↓
correspondence-service:
  - insert inbox event
  - create Notice record with unique(caseId, noticeType, sourceCaseVersion)
  - append NoticeDispatchRequested outbox
  ↓
dispatch-worker:
  - sends to email/letter vendor with idempotency key noticeId
  - records dispatch attempt
  - marks NoticeServed only after confirmed
  - emits NoticeServed
```

DB constraint:

```sql
CREATE UNIQUE INDEX uq_notice_once
ON notice (case_id, notice_type, source_case_version);
```

---

### 27.4 New Invariants

```text
I1. One Notice entity per case/version/type.
I2. Dispatch can be retried, but notice identity remains same.
I3. NoticeServed only after downstream confirmation.
I4. Appeal deadline uses NoticeServed.occurredAt, not CaseNoticeReady time.
I5. Duplicate event cannot create duplicate notice.
```

---

## 28. Summary

Distributed data integrity adalah kemampuan menjaga state dan keputusan tetap benar walaupun sistem mengalami retry, duplicate message, out-of-order event, stale command, partial failure, compromised component, schema drift, dan manual intervention.

Poin utama:

1. Integrity bukan hanya hash/signature/TLS.
2. Integrity tertinggi adalah business invariant integrity.
3. Command adalah intent; event adalah fact.
4. Command harus punya identity, expiry, expected version, authorization, dan idempotency.
5. Event harus punya owner, aggregate version, schema version, correlation, causation, dan dedup identity.
6. Broker internal bukan berarti trusted.
7. Outbox menjaga atomicity state + event record, tetapi tidak menghapus duplicate delivery.
8. Consumer tetap harus idempotent.
9. Exactly-once business effect biasanya ilusi; desainlah untuk at-least-once dan duplicate-safe behavior.
10. Cross-service invariant butuh owner, process manager, compensation, reconciliation, dan audit.
11. Reconciliation adalah bagian dari integrity architecture, bukan job ops tambahan.
12. Manual repair tanpa audit adalah integrity risk besar.

---

## 29. Referensi

Referensi yang relevan untuk part ini:

1. OWASP REST Security Cheat Sheet — HTTPS, service authentication, and integrity in transit.  
   https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

2. OWASP Transaction Authorization Cheat Sheet — transaction authorization and bypass prevention.  
   https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html

3. OWASP Authorization Cheat Sheet — robust and scalable authorization logic.  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

4. OWASP API Security Top 10 2023 — especially Broken Object Level Authorization and Broken Object Property Level Authorization.  
   https://owasp.org/API-Security/editions/2023/en/0x11-t10/

5. NIST SP 800-204 — Security Strategies for Microservices-based Application Systems.  
   https://csrc.nist.gov/pubs/sp/800/204/final

6. NIST SP 800-204A — Building Secure Microservices-based Applications Using Service-Mesh Architecture.  
   https://csrc.nist.gov/pubs/sp/800/204/a/final

7. NIST SP 800-204B — Attribute-Based Access Control for Microservices-based Applications.  
   https://csrc.nist.gov/pubs/sp/800/204/b/final

8. NIST SP 800-204C — Implementation of DevSecOps for a Microservices-based Application with Service Mesh.  
   https://csrc.nist.gov/pubs/sp/800/204/c/final

9. Martin Fowler / Patterns of Distributed Systems — Idempotent Receiver.  
   https://martinfowler.com/articles/patterns-of-distributed-systems/idempotent-receiver.html

10. Martin Fowler — Patterns of Distributed Systems catalog.  
    https://martinfowler.com/articles/patterns-of-distributed-systems/

11. Chris Richardson — Transactional Outbox Pattern.  
    https://microservices.io/patterns/data/transactional-outbox.html

12. Chris Richardson — Idempotent Consumer Pattern.  
    https://microservices.io/patterns/communication-style/idempotent-consumer.html

---

## 30. Status Seri

Seri belum selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
Part 25 - selesai
Part 26 - selesai
Part 27 - berikutnya
...
Part 34 - terakhir
```

Part berikutnya:

```text
Part 27 — Supply Chain Security for Java: Maven, Gradle, SBOM, Provenance
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 25 — Secure Logging, Audit Trail Integrity, Evidence, and Non-Repudiation](./learn-java-security-cryptography-integrity-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 27 — Supply Chain Security for Java: Maven, Gradle, SBOM, Provenance](./learn-java-security-cryptography-integrity-part-027.md)
