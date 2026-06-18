# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-011

# Part 11 — Reliability Semantics: At-Most-Once, At-Least-Once, Effectively-Once, dan Exactly-Once Myth

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: 011 / 035  
> Target pembaca: engineer Java yang sudah memahami Java/Jakarta/Spring/runtime dasar, dan ingin naik ke level desain sistem messaging production-grade.  
> Java target: Java 8 sampai Java 25.  
> API target: JMS 1.1 / JMS 2.0 / Jakarta Messaging 3.x.  

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas acknowledgement semantics: kapan broker menganggap message sudah selesai, kapan rollback memicu redelivery, dan bagaimana ack boundary harus disejajarkan dengan side effect. Part ini naik satu level: kita akan membahas **reliability semantics** end-to-end.

Tujuannya bukan menghafal istilah seperti `at-least-once` atau `exactly-once`, tetapi mampu menjawab pertanyaan desain seperti:

1. Apakah sistem ini boleh kehilangan message?
2. Apakah sistem ini boleh memproses message lebih dari sekali?
3. Apakah duplicate message berbahaya secara bisnis?
4. Bagaimana membuktikan bahwa handler aman saat crash terjadi di tengah proses?
5. Bagaimana mendesain consumer yang tetap benar meskipun broker melakukan redelivery?
6. Apakah XA transaction diperlukan, atau outbox/inbox lebih tepat?
7. Apakah “exactly once” benar-benar bisa dijamin end-to-end?
8. Apa invariant minimum agar sistem regulated, audit-heavy, dan workflow-heavy tetap defensible?

JMS/Jakarta Messaging menyediakan API umum untuk membuat, mengirim, menerima, dan membaca message dalam enterprise messaging system. Specification-nya mendefinisikan interface dan semantics umum, tetapi banyak detail reliability end-to-end tetap bergantung pada desain aplikasi, konfigurasi broker, transaksi, database, idempotency, dan operasional. Jakarta Messaging 3.1 mendeskripsikan tujuan ini sebagai common way bagi program Java untuk berinteraksi dengan enterprise messaging system, bukan sebagai jaminan bahwa semua efek bisnis otomatis exactly-once. Referensi resmi Jakarta Messaging menegaskan scope API tersebut, dan API `Session` juga menekankan bahwa session adalah single-threaded context untuk produksi dan konsumsi message. Lihat referensi: Jakarta Messaging 3.1 specification, Jakarta Messaging Concepts, dan Jakarta Messaging Session API.

---

## 1. Core Mental Model: Broker Delivery ≠ Business Processing

Kesalahan paling umum dalam sistem JMS adalah menyamakan:

```text
message delivered by broker
=
message processed by application
=
business effect committed
=
user-visible state correct
```

Itu salah.

Dalam sistem nyata, sebuah message melewati beberapa boundary:

```text
Producer memory
  -> producer client library
  -> network
  -> broker acceptor
  -> broker journal / page / queue store
  -> broker dispatch
  -> consumer client buffer / prefetch
  -> consumer listener thread
  -> application handler
  -> database transaction / downstream call / file write / email send
  -> acknowledgement / commit
  -> broker removes or marks message done
```

Setiap panah adalah failure boundary.

Reliability tidak ditentukan hanya oleh JMS API. Reliability adalah hasil gabungan dari:

1. **Producer behavior**
   - Apakah send persistent?
   - Apakah send berada dalam transaction?
   - Apakah producer retry setelah timeout?
   - Apakah retry menghasilkan duplicate?

2. **Broker behavior**
   - Apakah message sudah persisted sebelum send dianggap sukses?
   - Apakah broker HA/failover bisa menduplikasi delivery?
   - Apakah redelivery count dikonfigurasi?
   - Apakah DLQ aktif?

3. **Consumer behavior**
   - Kapan ack dilakukan?
   - Apakah processing idempotent?
   - Apakah side effect atomic dengan ack?
   - Apakah crash window ditangani?

4. **Database / external system behavior**
   - Apakah business key punya unique constraint?
   - Apakah update state transition monotonic?
   - Apakah downstream call idempotent?
   - Apakah ada outbox/inbox?

5. **Operational behavior**
   - Apakah message bisa direplay?
   - Apakah duplicate bisa dideteksi?
   - Apakah DLQ bisa ditriage?
   - Apakah audit trail cukup untuk forensik?

Top 1% engineer tidak bertanya “JMS guarantee-nya apa?” saja. Pertanyaan yang lebih tepat adalah:

> “Apa guarantee end-to-end dari producer intention sampai business state final, dan failure window mana yang masih bisa menghasilkan loss, duplicate, reorder, atau partial side effect?”

---

## 2. Vocabulary Penting

Sebelum membahas guarantee, kita perlu menyamakan istilah.

### 2.1 Delivery

Delivery adalah saat broker/client library menyerahkan message ke consumer.

Dalam async listener, delivery terjadi ketika provider memanggil `onMessage(Message message)`.

```java
public final class OrderMessageListener implements MessageListener {
    @Override
    public void onMessage(Message message) {
        // message has been delivered to application code
    }
}
```

Delivery belum berarti business processing sukses.

### 2.2 Processing

Processing adalah eksekusi logic aplikasi terhadap message.

Contoh:

```text
message: ApproveCaseCommand
processing:
  - validate case state
  - insert approval record
  - update case status
  - create audit trail
  - publish CaseApproved event
```

Processing bisa sukses sebagian, gagal sebelum commit, gagal setelah commit, atau menggantung.

### 2.3 Side Effect

Side effect adalah perubahan eksternal yang tidak hilang saat thread selesai.

Contoh side effect:

- insert/update database
- publish message lain
- send email
- call downstream HTTP API
- write file
- update cache
- create audit trail
- trigger notification

Side effect adalah sumber utama reliability problem karena ack JMS belum tentu atomic dengan semua side effect.

### 2.4 Acknowledgement

Ack adalah sinyal ke broker bahwa message dianggap selesai dari sudut pandang consumer.

Ack bisa terjadi otomatis, manual, atau saat transaction commit, tergantung mode.

Ack boundary yang salah bisa menghasilkan:

- message hilang tetapi side effect belum terjadi
- side effect terjadi tetapi message redelivered
- duplicate side effect
- state corruption

### 2.5 Redelivery

Redelivery adalah pengiriman ulang message yang sama setelah delivery sebelumnya tidak dianggap selesai.

Penyebab redelivery:

- session rollback
- transaction rollback
- consumer crash sebelum ack
- connection lost
- broker failover
- timeout / recovery internal provider

JMS memiliki header seperti `JMSRedelivered`, dan banyak provider juga menyediakan delivery count property seperti `JMSXDeliveryCount`, tetapi detail dukungan property dapat berbeda antar provider.

### 2.6 Duplicate

Duplicate adalah situasi ketika message yang secara bisnis sama diproses lebih dari satu kali.

Duplicate bisa berupa:

1. **Same broker message redelivered**
   - JMSMessageID sama atau redelivery flag true.

2. **Producer retry duplicate**
   - Producer mengirim payload yang sama dua kali karena tidak yakin send pertama berhasil.

3. **Application duplicate event**
   - Dua service menghasilkan event yang sama karena race condition.

4. **Replay duplicate**
   - Operator replay message lama dari DLQ atau archive.

5. **Failover duplicate**
   - Broker/client failover menyebabkan message yang sudah diproses muncul lagi.

Top 1% rule:

> Jangan mendesain idempotency hanya berdasarkan `JMSMessageID`. Gunakan business idempotency key.

### 2.7 Loss

Loss adalah situasi ketika business intention tidak pernah menghasilkan expected business processing.

Contoh:

- producer menganggap send sukses padahal broker belum persist
- message non-persistent hilang saat broker crash
- consumer ack sebelum database commit lalu crash
- DLQ tidak dimonitor dan message “hilang secara operasional”
- TTL expired sebelum consumer memproses

Loss tidak selalu berarti broker bug. Sering kali loss adalah akibat keputusan desain.

### 2.8 Replay

Replay adalah memproses ulang message lama secara sengaja.

Replay diperlukan untuk:

- recovery setelah bug handler
- reprocess DLQ
- rebuild projection
- correct downstream outage
- forensic repair

Tetapi replay aman hanya jika handler idempotent atau punya replay mode yang jelas.

---

## 3. Empat Kategori Delivery Semantics

Secara praktis, kita akan memakai empat kategori:

1. **At-most-once**
2. **At-least-once**
3. **Effectively-once**
4. **Exactly-once**

Namun harus dibedakan:

```text
broker delivery semantics
application processing semantics
business effect semantics
operator recovery semantics
```

Sebuah broker mungkin memberi at-least-once delivery, tetapi aplikasi bisa memberi effectively-once business effect.

---

## 4. At-Most-Once Semantics

### 4.1 Definisi

At-most-once berarti:

```text
message diproses 0 atau 1 kali
```

Tidak ada duplicate processing, tetapi message boleh hilang.

Secara intuitif:

```text
better to lose than duplicate
```

### 4.2 Cara Terjadi di JMS

At-most-once bisa terjadi jika message di-ack sebelum side effect selesai.

Contoh berbahaya:

```java
public void onMessage(Message message) {
    try {
        message.acknowledge(); // dangerous if using CLIENT_ACKNOWLEDGE
        processBusinessEffect(message);
    } catch (Exception e) {
        // too late: broker may already consider the message done
    }
}
```

At-most-once juga bisa terjadi dengan:

- non-persistent delivery mode
- broker crash sebelum persistence
- TTL terlalu pendek
- auto-ack yang terjadi sebelum business invariant aman
- manual delete dari queue tanpa replay record

### 4.3 Kapan At-Most-Once Bisa Diterima?

At-most-once bisa diterima untuk event yang sifatnya best-effort:

- telemetry sampling
- non-critical metrics
- cache refresh hints
- UI notification yang bisa dihitung ulang
- low-value analytics event
- ephemeral presence event

At-most-once biasanya tidak boleh untuk:

- payment
- enforcement action
- case status transition
- license approval
- audit trail
- email legal notice
- identity state update
- compliance decision

### 4.4 Pattern At-Most-Once yang Sadar Risiko

Jika memang memilih at-most-once, lakukan secara eksplisit:

```text
Business classification:
  Signal type      : cache invalidation hint
  Loss tolerance   : yes
  Duplicate risk   : low
  Recovery method  : periodic full refresh
  Audit required   : no
  TTL              : 5 minutes
  Delivery mode    : non-persistent acceptable
```

Jangan membiarkan at-most-once terjadi karena kelalaian.

### 4.5 Failure Timeline

```text
T1 consumer receives message
T2 consumer acknowledges message
T3 consumer starts DB update
T4 JVM crashes
T5 broker will not redeliver
T6 business effect never happens
```

Hasil:

```text
message loss from business perspective
```

---

## 5. At-Least-Once Semantics

### 5.1 Definisi

At-least-once berarti:

```text
message diproses 1 atau lebih kali
```

Message tidak boleh hilang, tetapi duplicate mungkin terjadi.

Secara intuitif:

```text
better to duplicate than lose
```

### 5.2 Cara Terjadi di JMS

At-least-once biasanya dicapai dengan:

- persistent message
- ack setelah business processing sukses
- transaction commit setelah side effect aman
- rollback saat gagal
- broker redelivery
- DLQ setelah max attempts

Pseudo-flow:

```text
receive message
begin DB transaction
apply business change idempotently
commit DB transaction
ack / commit JMS session
```

Namun ada crash window:

```text
DB commit success
JVM crash before JMS ack
broker redelivers
```

Karena itu at-least-once membutuhkan idempotency.

### 5.3 Correctness Rule

At-least-once bukan berarti aman tanpa duplicate handling.

Rule:

> Jika sistem memilih at-least-once, setiap consumer handler harus duplicate-safe.

Duplicate-safe bisa dicapai dengan:

- idempotency key
- unique constraint
- processed message table
- state transition guard
- optimistic locking
- commutative operation
- idempotent downstream API
- transactional inbox

### 5.4 Failure Timeline

```text
T1 consumer receives ApproveCaseCommand(commandId=C-123)
T2 consumer updates CASE status APPROVED
T3 consumer commits DB
T4 JVM crashes before ack
T5 broker redelivers commandId=C-123
T6 consumer receives duplicate
T7 consumer detects commandId already processed
T8 consumer ack/commit without repeating side effect
```

Hasil:

```text
broker delivered twice
business effect applied once
```

Ini adalah dasar effectively-once.

---

## 6. Effectively-Once Semantics

### 6.1 Definisi

Effectively-once berarti:

```text
message boleh dideliver lebih dari sekali,
tetapi business effect yang relevan hanya terjadi sekali.
```

Ini biasanya target realistis untuk JMS-based enterprise systems.

### 6.2 Kenapa “Effectively”?

Karena sistem distributed hampir selalu memiliki failure window yang memungkinkan duplicate delivery.

Daripada mengejar klaim absolut “exactly once delivery”, kita mendesain:

```text
at-least-once delivery
+ idempotent processing
+ deduplication
+ transactional state guard
= effectively-once business effect
```

### 6.3 Effectively-Once pada Level Berbeda

Effectively-once bisa dimaknai pada beberapa level:

#### Level 1 — Handler invocation

```text
onMessage dipanggil sekali
```

Ini hampir tidak realistis untuk dijamin.

#### Level 2 — Message consumed successfully

```text
broker akhirnya menganggap message selesai sekali
```

Ini broker-level, bukan business-level.

#### Level 3 — Database state transition

```text
case berubah dari PENDING ke APPROVED sekali
```

Ini target realistis.

#### Level 4 — External side effect

```text
email legal notice terkirim sekali
```

Ini sulit jika external system tidak idempotent.

#### Level 5 — User-observable outcome

```text
user hanya melihat satu approval dan satu audit trail final
```

Ini target business-defensible.

Top 1% engineer selalu menjelaskan “once” pada level mana.

---

## 7. Exactly-Once Myth

### 7.1 Klaim yang Sering Salah Dipahami

Banyak teknologi memakai istilah “exactly once”, tetapi scope-nya sering terbatas.

Contoh scope yang berbeda:

- exactly-once append ke broker log
- exactly-once processing di stream runtime internal
- exactly-once producer idempotence
- exactly-once transaction antara input/output broker topic
- exactly-once state update dalam satu database
- exactly-once business effect end-to-end

Yang terakhir paling sulit.

### 7.2 Kenapa End-to-End Exactly-Once Sulit?

Karena distributed system tidak bisa secara ajaib mengetahui apakah side effect eksternal sudah terjadi saat crash.

Contoh:

```text
T1 consumer calls external payment API
T2 payment API charges customer successfully
T3 network timeout before response reaches consumer
T4 consumer does not know whether charge happened
T5 retry may charge twice unless payment API supports idempotency key
```

JMS tidak bisa memperbaiki masalah ini sendiri.

### 7.3 Exactly-Once Requires Shared Atomic Boundary

Agar benar-benar exactly-once, semua hal ini harus berada dalam satu atomic boundary:

- consume message
- apply business state
- emit next message
- call downstream system
- update audit
- acknowledge source message

Dalam praktik, boundary seperti itu jarang ada.

XA/2PC bisa membantu untuk resource yang mendukung XA, tetapi:

- tidak semua resource mendukung XA
- external HTTP API umumnya tidak XA
- email server tidak XA
- file system operation biasanya tidak cocok XA
- 2PC menambah latency dan operational complexity
- heuristic outcome tetap harus dipikirkan

Karena itu strategi paling umum:

```text
Design for at-least-once delivery.
Make business effects idempotent.
Use outbox/inbox for atomic local state + message intent.
Use audit/replay tooling for recovery.
```

---

## 8. Reliability Matrix

| Semantics | Loss allowed | Duplicate allowed | Typical use | Required engineering |
|---|---:|---:|---|---|
| At-most-once | Yes | No / unlikely | metrics, cache hint | loss tolerance, TTL, periodic repair |
| At-least-once | No | Yes | commands, integration events | retry, redelivery, DLQ, idempotency |
| Effectively-once | No at business level | Yes at delivery level | regulated workflow, state transition | idempotent handler, dedup, constraints, audit |
| Exactly-once | No | No | usually limited scope | single atomic boundary or heavy protocol |

Important:

```text
Most serious JMS systems should target effectively-once business semantics,
not exactly-once delivery semantics.
```

---

## 9. Failure Windows in Consumer Processing

Mari kita pecah consumer processing menjadi timeline.

```text
T0 message available in broker
T1 broker dispatches message
T2 consumer receives message
T3 handler starts
T4 database transaction begins
T5 business validation
T6 database write
T7 database commit
T8 ack / JMS commit
T9 handler returns
```

### 9.1 Crash Before DB Write

```text
T2 receive
T3 handler starts
CRASH
```

Jika belum ack:

```text
broker redelivers
safe
```

Jika sudah ack:

```text
message lost
unsafe for critical work
```

### 9.2 Crash After DB Write Before Commit

```text
T6 DB write pending
CRASH
```

Database rollback biasanya terjadi.

Jika belum ack:

```text
redelivery safe
```

### 9.3 Crash After DB Commit Before Ack

```text
T7 DB commit success
CRASH before T8 ack
```

Broker redelivers.

Jika handler tidak idempotent:

```text
duplicate business effect
```

Jika handler idempotent:

```text
duplicate delivery, single effect
```

### 9.4 Ack Before DB Commit

```text
T2 receive
T3 ack
T4 DB begin
T5 DB write
T6 DB fails
```

Message tidak redelivered.

Hasil:

```text
business loss
```

### 9.5 DB Commit and Ack Both Succeed, Response Lost

Bisa terjadi pada producer side atau request/reply:

```text
operation succeeded
client sees timeout
client retries
```

Solusi:

```text
idempotency key + result lookup
```

---

## 10. Idempotency: Fondasi Effectively-Once

### 10.1 Definisi

Sebuah operasi idempotent jika menjalankannya sekali atau berkali-kali menghasilkan final state yang sama.

```text
f(f(x)) = f(x)
```

Namun dalam sistem bisnis, idempotency bukan sekadar function theory. Yang penting:

```text
Repeated message must not create repeated harmful business effect.
```

### 10.2 Idempotency Teknis vs Bisnis

#### Teknis

```text
messageId already processed -> skip
```

#### Bisnis

```text
caseId=123 approvalCommandId=A-999 already applied -> do not approve again
```

Bisnis lebih kuat karena tetap aman saat producer mengirim duplicate dengan JMSMessageID berbeda.

### 10.3 Idempotency Key

Idempotency key harus stabil antar retry dan replay.

Sumber yang baik:

- command id dari producer
- event id dari aggregate
- business operation id
- external request id
- case transition id
- payment idempotency key

Sumber yang lemah:

- `JMSMessageID` saja
- timestamp
- random UUID yang dibuat consumer
- hash payload tanpa canonicalization
- database auto increment id yang berbeda per retry

### 10.4 Idempotency Table Pattern

Skema sederhana:

```sql
CREATE TABLE processed_message (
    consumer_name        VARCHAR(100) NOT NULL,
    idempotency_key      VARCHAR(200) NOT NULL,
    processed_at         TIMESTAMP NOT NULL,
    source_destination   VARCHAR(200),
    correlation_id       VARCHAR(200),
    message_type         VARCHAR(100),
    result_status        VARCHAR(50),
    PRIMARY KEY (consumer_name, idempotency_key)
);
```

Flow:

```text
begin DB transaction
insert into processed_message
  if duplicate key -> already processed -> commit/ack without repeating side effect
apply business change
commit DB transaction
ack JMS
```

### 10.5 Java Pseudo-Code: Idempotent Consumer

```java
public final class IdempotentCaseApprovalHandler {

    private final ProcessedMessageRepository processedMessages;
    private final CaseRepository cases;
    private final AuditRepository audits;

    public void handle(ApproveCaseCommand command) {
        String consumerName = "case-approval-consumer";
        String idempotencyKey = command.commandId();

        boolean firstProcessing = processedMessages.tryInsert(
                consumerName,
                idempotencyKey,
                command.correlationId(),
                "ApproveCaseCommand"
        );

        if (!firstProcessing) {
            return;
        }

        CaseRecord current = cases.findForUpdate(command.caseId());

        if (current.status() == CaseStatus.APPROVED) {
            audits.insertIdempotentSkip(
                    command.caseId(),
                    command.commandId(),
                    "Case already approved"
            );
            return;
        }

        if (current.status() != CaseStatus.PENDING_APPROVAL) {
            throw new InvalidStateTransitionException(
                    "Cannot approve case from state " + current.status()
            );
        }

        cases.updateStatus(
                command.caseId(),
                CaseStatus.APPROVED,
                current.version()
        );

        audits.insertApprovalAudit(
                command.caseId(),
                command.commandId(),
                command.actorId()
        );
    }
}
```

Catatan:

- `tryInsert` harus atomic dengan transaction.
- `findForUpdate` atau optimistic locking mencegah race.
- Business state transition tetap divalidasi.
- Duplicate command tidak mengulang audit harmful.

### 10.6 Problem: Insert Processed First vs Last

Ada dua pendekatan:

#### Insert processed first

```text
insert processed key
apply business change
commit
```

Kelebihan:

- duplicate concurrent bisa ditolak cepat
- satu transaction boundary jelas

Risiko:

- jika business change gagal permanent tapi processed key sudah commit, message bisa dianggap selesai padahal efek tidak terjadi

Karena itu insert processed first harus satu transaction dengan business change.

#### Insert processed last

```text
apply business change
insert processed key
commit
```

Kelebihan:

- processed key hanya ada setelah business change

Risiko:

- duplicate concurrent bisa masuk sebelum key ada
- perlu locking/state guard lebih kuat

Practical rule:

> Masukkan dedup marker dan business mutation dalam transaction yang sama. Jangan commit marker tanpa business outcome yang konsisten.

---

## 11. State Transition Guard

Idempotency table tidak cukup jika domain state tidak punya invariant.

Contoh buruk:

```sql
UPDATE case_table
SET approval_count = approval_count + 1
WHERE case_id = ?;
```

Jika duplicate terjadi:

```text
approval_count increments twice
```

Lebih baik:

```sql
UPDATE case_table
SET status = 'APPROVED',
    approved_at = ?,
    approved_by = ?,
    version = version + 1
WHERE case_id = ?
  AND status = 'PENDING_APPROVAL';
```

Kemudian cek affected rows.

```java
int updated = cases.approveIfPending(caseId, actorId, now);

if (updated == 1) {
    auditApproved(caseId, commandId);
    return;
}

CaseStatus status = cases.findStatus(caseId);

if (status == CaseStatus.APPROVED) {
    auditDuplicateSkipped(caseId, commandId);
    return;
}

throw new InvalidStateTransitionException("Cannot approve from " + status);
```

Dengan state transition guard:

```text
duplicate command tidak bisa membuat transition kedua
```

---

## 12. Commutative vs Non-Commutative Effects

Tidak semua operasi sama.

### 12.1 Commutative / Idempotent Naturally

Contoh:

```text
set status = APPROVED
set cache value = latest snapshot
mark notification as read
upsert projection by event version
```

Repeated execution relatif aman jika versioning benar.

### 12.2 Non-Commutative / Dangerous

Contoh:

```text
balance = balance - amount
send email
create invoice number
append audit line without uniqueness
increment counter
call external payment capture
```

Operasi ini perlu guard ekstra:

- unique business operation id
- idempotency key downstream
- outbox
- dedup
- compensation
- audit classification

---

## 13. Producer-Side Duplicate

Consumer redelivery bukan satu-satunya sumber duplicate.

### 13.1 Timeout Ambiguity

Producer mengirim message:

```text
T1 producer sends command
T2 broker persists command
T3 broker response lost due network timeout
T4 producer retries send
T5 broker receives duplicate command
```

Dari broker perspective, ini dua message berbeda.

Jika consumer dedup berdasarkan `JMSMessageID`, duplicate tidak terdeteksi.

Solusi:

```text
producer-generated commandId/eventId
```

Payload:

```json
{
  "messageType": "ApproveCaseCommand",
  "messageId": "cmd-2026-000001",
  "correlationId": "corr-abc",
  "caseId": "CASE-123",
  "actorId": "user-456",
  "requestedAt": "2026-06-18T10:15:30Z"
}
```

Consumer dedup menggunakan `messageId` atau `commandId`, bukan JMS provider ID.

### 13.2 Broker Duplicate Detection

Beberapa broker menyediakan duplicate detection. Apache ActiveMQ Artemis, misalnya, memiliki fitur duplicate detection yang bisa memfilter duplicate message di broker. Fitur ini membantu, tetapi tetap bukan pengganti idempotency bisnis karena duplicate bisa muncul dari replay, multi-producer bug, atau message dengan business effect sama tetapi broker header berbeda.

Rule:

```text
Broker duplicate detection is optimization/defense-in-depth.
Business idempotency remains mandatory for critical workflows.
```

---

## 14. Consumer-Side Duplicate

Consumer duplicate biasanya berasal dari redelivery.

### 14.1 Redelivery Flag

JMS menyediakan `JMSRedelivered` sebagai indikasi bahwa message kemungkinan pernah dikirim sebelumnya.

Namun jangan membuat correctness bergantung total pada flag ini.

Gunakan flag untuk observability dan diagnosis:

```java
boolean redelivered = message.getJMSRedelivered();
String messageId = message.getJMSMessageID();
String correlationId = message.getJMSCorrelationID();
```

Untuk correctness:

```text
use idempotency key + domain state guard
```

### 14.2 Delivery Count

Banyak provider mendukung `JMSXDeliveryCount`.

Contoh:

```java
int deliveryCount = 1;
try {
    if (message.propertyExists("JMSXDeliveryCount")) {
        deliveryCount = message.getIntProperty("JMSXDeliveryCount");
    }
} catch (JMSException ignored) {
    deliveryCount = 1;
}
```

Gunakan untuk:

- logging
- metrics
- retry classification
- poison detection

Jangan gunakan sebagai satu-satunya mekanisme correctness.

---

## 15. Inbox Pattern

Inbox pattern adalah bentuk lebih formal dari idempotent consumer.

### 15.1 Tujuan

Inbox menyimpan message yang masuk sebelum atau bersama processing.

Tujuan:

- dedup
- audit receive
- replay internal
- processing status tracking
- poison analysis
- deterministic recovery

### 15.2 Schema

```sql
CREATE TABLE message_inbox (
    consumer_name       VARCHAR(100) NOT NULL,
    message_key         VARCHAR(200) NOT NULL,
    correlation_id      VARCHAR(200),
    message_type        VARCHAR(100) NOT NULL,
    payload_json        CLOB NOT NULL,
    received_at         TIMESTAMP NOT NULL,
    processed_at        TIMESTAMP NULL,
    status              VARCHAR(30) NOT NULL,
    attempt_count       INTEGER NOT NULL,
    last_error_code     VARCHAR(100),
    last_error_message  VARCHAR(1000),
    PRIMARY KEY (consumer_name, message_key)
);
```

Status:

```text
RECEIVED
PROCESSING
PROCESSED
FAILED_RETRYABLE
FAILED_PERMANENT
```

### 15.3 Flow Ringkas

```text
receive JMS message
begin DB transaction
insert inbox row if absent
if already PROCESSED -> commit + ack
mark PROCESSING
apply business logic
mark PROCESSED
commit DB
ack JMS
```

### 15.4 Kapan Inbox Berguna?

Inbox sangat berguna untuk:

- regulated workflow
- case management
- audit-heavy system
- replay requirement
- complex handler
- external side effect coordination
- DLQ triage

Untuk event volume sangat tinggi, inbox perlu retention/partitioning/cleanup strategy.

---

## 16. Outbox + Inbox: Effectively-Once Across Services

### 16.1 Problem

Service A perlu:

```text
update DB
publish JMS event
```

Jika update DB dan publish JMS tidak atomic, ada failure window.

### 16.2 Outbox Pattern

Dalam satu DB transaction:

```text
update business table
insert outbox event row
commit
```

Worker membaca outbox dan publish ke JMS.

```sql
CREATE TABLE message_outbox (
    outbox_id           VARCHAR(100) PRIMARY KEY,
    aggregate_type      VARCHAR(100) NOT NULL,
    aggregate_id        VARCHAR(100) NOT NULL,
    event_type          VARCHAR(100) NOT NULL,
    event_version       INTEGER NOT NULL,
    payload_json        CLOB NOT NULL,
    correlation_id      VARCHAR(200),
    created_at          TIMESTAMP NOT NULL,
    published_at        TIMESTAMP NULL,
    status              VARCHAR(30) NOT NULL,
    attempt_count       INTEGER NOT NULL
);
```

### 16.3 Full Chain

```text
Service A:
  DB transaction:
    update case
    insert outbox event CaseApproved(eventId=E1)
  commit

Outbox relay:
  publish E1 to JMS
  mark outbox published

Service B:
  consume E1
  insert inbox key E1
  update its local state idempotently
  commit
  ack JMS
```

End-to-end:

```text
JMS delivery may duplicate.
Outbox relay may duplicate publish.
Consumer may redeliver.
But business effects are guarded by eventId/commandId and local constraints.
```

---

## 17. External Side Effects: Email, HTTP API, File, Payment

JMS reliability becomes hardest when handler calls external systems.

### 17.1 Email

Sending email is usually not idempotent.

Bad flow:

```text
receive message
send email
crash before DB mark sent / ack
redelivery
send email again
```

Better:

```text
receive command
insert notification_outbox with unique notification_id
commit + ack
separate email sender sends pending notification
mark sent with provider response
```

Even then, SMTP may timeout after accepting email. Need:

- stable notification id
- provider message id if available
- dedup window
- user-visible communication log
- manual suppression/repair

### 17.2 HTTP API

HTTP downstream should receive idempotency key.

```http
POST /external/actions
Idempotency-Key: approve-case-CASE-123-CMD-999
```

If downstream does not support idempotency:

- call must be moved behind local outbox
- duplicate risk documented
- reconciliation job required
- compensation flow needed

### 17.3 File Write

File write duplicate risks:

- same file generated twice with different name
- partial file visible
- overwrite wrong version

Pattern:

```text
write temp file
fsync if needed
atomic rename
record file checksum/path under unique operation id
```

### 17.4 Payment / Financial Operation

Never rely on JMS alone.

Require:

- payment operation id
- downstream idempotency
- ledger entry unique constraint
- reconciliation
- audit trail
- manual exception handling

---

## 18. Delivery Semantics by Ack Mode

Simplified view:

| Mode / Pattern | Likely semantic if used naively | Production-safe semantic if designed well |
|---|---|---|
| AUTO_ACKNOWLEDGE | can become at-most-once depending provider timing and handler behavior | acceptable for simple low-risk handlers, still duplicate-aware |
| CLIENT_ACKNOWLEDGE | at-least-once if ack after processing | effectively-once with idempotency |
| DUPS_OK_ACKNOWLEDGE | at-least-once with more duplicate tolerance | only safe when handler idempotent |
| SESSION_TRANSACTED | at-least-once with local JMS transaction | effectively-once with DB/idempotency alignment |
| JTA/XA | closer atomicity across XA resources | still not magic for non-XA external effects |
| Outbox/Inbox | at-least-once transport | effectively-once business semantics |

Important:

```text
Ack mode changes broker-consumer contract.
It does not automatically make business side effects exactly-once.
```

---

## 19. Poison Message vs Duplicate Message

Jangan campur dua konsep ini.

### 19.1 Duplicate Message

Duplicate message adalah message yang sudah pernah diproses atau mewakili business operation yang sama.

Handling:

```text
detect -> skip or return previous result -> ack
```

### 19.2 Poison Message

Poison message adalah message yang selalu gagal diproses.

Penyebab:

- schema invalid
- unknown enum
- referenced entity not found
- business state impossible
- payload corrupted
- handler bug
- downstream permanent rejection

Handling:

```text
retry limited -> DLQ / parking lot -> triage -> repair/replay/discard with audit
```

### 19.3 Jangan Retry Duplicate yang Sudah Sukses

Jika duplicate sukses sudah terdeteksi, jangan throw exception.

```java
if (alreadyProcessed(command.id())) {
    log.info("Duplicate command skipped: {}", command.id());
    return; // allow ack / commit
}
```

Jika duplicate dilempar sebagai error, broker akan redeliver terus dan bisa masuk DLQ padahal sistem benar.

---

## 20. Redelivery Count and DLQ Semantics

Broker seperti ActiveMQ Artemis menyediakan konfigurasi redelivery dan dead-letter address. Dokumentasi Artemis menjelaskan bahwa message yang gagal dikirim setelah sejumlah attempt dapat dipindahkan ke dead letter address, dan bila dead-letter address tidak diset, message dapat dihapus setelah max delivery attempts. Default max redelivery pada Artemis documented as 10 in current docs. Ini contoh provider behavior yang harus dipahami secara operasional, bukan diasumsikan sama di semua broker.

### 20.1 Redelivery Policy

Contoh konsep:

```text
max-delivery-attempts = 5
redelivery-delay = 10s
redelivery-delay-multiplier = 2.0
max-redelivery-delay = 5m
DLQ = DLQ.case.approval
```

Timeline:

```text
attempt 1 -> fail
wait 10s
attempt 2 -> fail
wait 20s
attempt 3 -> fail
wait 40s
attempt 4 -> fail
wait 80s
attempt 5 -> fail
move to DLQ
```

### 20.2 Reliability Trap

DLQ bukan “message solved”. DLQ hanya memindahkan risiko dari runtime processing ke operational backlog.

Jika DLQ tidak dimonitor:

```text
message is not lost technically,
but business process is stuck operationally.
```

Untuk regulated systems, DLQ harus punya:

- owner
- SLA
- dashboard
- alert
- triage category
- replay tool
- discard approval
- audit trail

---

## 21. Message Expiry and TTL

TTL bisa mengubah reliability.

Jika message expired sebelum diproses:

```text
it may never reach consumer
```

Ini bisa benar untuk:

- price quote refresh
- temporary notification
- cache hint

Ini berbahaya untuk:

- case transition command
- legal notice
- approval event
- payment event

Rule:

```text
Do not set TTL on durable business commands unless expiry is a real business rule.
```

Jika expiry adalah business rule, expired message harus observable:

```text
expiry queue / expiry address
metrics
operator workflow
business compensation
```

---

## 22. Ordering and Reliability Interaction

Reliability mempengaruhi ordering.

Contoh:

```text
M1 delivered -> fails -> scheduled redelivery later
M2 delivered -> succeeds
M1 redelivered after M2
```

Hasil:

```text
processing order differs from send order
```

Karena itu idempotency saja tidak cukup jika domain butuh sequence.

Butuh:

- aggregate version
- sequence number
- message group
- per-entity serialization
- inbox pending buffer
- reject stale event
- replay from source of truth

Contoh event handler:

```java
if (event.version() <= projection.currentVersion()) {
    return; // duplicate or stale
}

if (event.version() != projection.currentVersion() + 1) {
    throw new GapDetectedException(event.aggregateId(), event.version());
}

projection.apply(event);
```

---

## 23. Designing a Reliability Contract

Setiap destination penting harus punya reliability contract eksplisit.

Template:

```text
Destination name:
Message type:
Producer:
Consumer(s):
Business criticality:
Loss tolerance:
Duplicate tolerance:
Ordering requirement:
Replay requirement:
Idempotency key:
Dedup storage:
Transaction boundary:
Ack strategy:
Retry policy:
DLQ policy:
TTL/expiry:
Audit requirement:
Observability:
Manual recovery owner:
```

Contoh:

```text
Destination name       : queue.case.approval.command
Message type           : ApproveCaseCommand
Producer               : case-api-service
Consumer               : case-workflow-service
Business criticality   : high
Loss tolerance         : none
Duplicate tolerance    : delivery duplicate allowed, business duplicate not allowed
Ordering requirement   : per caseId
Replay requirement     : yes, with operator approval
Idempotency key        : commandId
Dedup storage          : message_inbox(consumer_name, commandId)
Transaction boundary   : local DB transaction for inbox + case state + audit
Ack strategy           : ack after DB commit
Retry policy           : 5 attempts exponential backoff
DLQ policy             : DLQ.case.approval, alert immediately
TTL                    : none
Audit requirement      : all receive/process/skip/fail transitions
Observability          : queue depth, processing latency, delivery count, DLQ count
Manual owner           : case platform L2 support
```

---

## 24. Java 8 Style Example: Idempotent JMS 1.1 Consumer Skeleton

```java
public final class CaseApprovalListener implements MessageListener {

    private final CaseApprovalService service;

    public CaseApprovalListener(CaseApprovalService service) {
        this.service = service;
    }

    @Override
    public void onMessage(Message message) {
        try {
            if (!(message instanceof TextMessage)) {
                throw new IllegalArgumentException("Expected TextMessage");
            }

            TextMessage textMessage = (TextMessage) message;
            String payload = textMessage.getText();

            ApproveCaseCommand command = ApproveCaseCommandJson.parse(payload);

            MessageMetadata metadata = new MessageMetadata(
                    safe(message.getJMSMessageID()),
                    safe(message.getJMSCorrelationID()),
                    message.getJMSRedelivered(),
                    readDeliveryCount(message)
            );

            service.process(command, metadata);

            // In CLIENT_ACKNOWLEDGE mode. In transacted sessions, use session commit instead.
            message.acknowledge();

        } catch (Exception e) {
            // In container-managed listener, throwing may trigger rollback/redelivery depending setup.
            // In manual client code, ensure session rollback/recovery strategy is explicit.
            throw new RuntimeException("Failed to process JMS message", e);
        }
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static int readDeliveryCount(Message message) {
        try {
            if (message.propertyExists("JMSXDeliveryCount")) {
                return message.getIntProperty("JMSXDeliveryCount");
            }
        } catch (JMSException ignored) {
            // Provider may not expose the property consistently.
        }
        return 1;
    }
}
```

Catatan:

- Ini skeleton, bukan final production code.
- Transaction boundary harus jelas di `service.process`.
- Untuk `SESSION_TRANSACTED`, commit/rollback ada di session owner, bukan di `message.acknowledge()`.
- Dalam Jakarta EE MDB atau Spring listener container, rollback behavior dikendalikan container/transaction manager.

---

## 25. Modern Jakarta Messaging Style: JMSContext Consumer Skeleton

```java
import jakarta.jms.JMSConsumer;
import jakarta.jms.JMSContext;
import jakarta.jms.Message;
import jakarta.jms.Queue;
import jakarta.jms.TextMessage;

public final class CaseApprovalPoller implements Runnable {

    private final JMSContext context;
    private final Queue queue;
    private final CaseApprovalService service;
    private volatile boolean running = true;

    public CaseApprovalPoller(
            JMSContext context,
            Queue queue,
            CaseApprovalService service
    ) {
        this.context = context;
        this.queue = queue;
        this.service = service;
    }

    @Override
    public void run() {
        JMSConsumer consumer = context.createConsumer(queue);

        while (running) {
            Message message = consumer.receive(1000L);
            if (message == null) {
                continue;
            }

            try {
                TextMessage text = (TextMessage) message;
                ApproveCaseCommand command = ApproveCaseCommandJson.parse(text.getText());

                service.process(command, MessageMetadata.from(message));

                context.commit();

            } catch (Exception e) {
                context.rollback();
                // message will be eligible for redelivery according to provider policy
            }
        }

        consumer.close();
    }

    public void stop() {
        running = false;
    }
}
```

Catatan:

- Ini cocok untuk conceptual learning.
- Di production, biasanya resource management, shutdown, metrics, exception classification, dan transaction integration harus lebih rapi.
- `JMSContext` juga punya threading/lifecycle constraints; jangan diasumsikan bebas dipakai lintas thread.

---

## 26. Exception Classification

Reliability buruk jika semua error diperlakukan sama.

### 26.1 Retryable Error

Contoh:

- DB connection timeout
- downstream 503
- temporary network failure
- lock timeout
- broker failover

Handling:

```text
rollback -> redelivery -> retry with backoff
```

### 26.2 Permanent Error

Contoh:

- invalid schema
- missing mandatory field
- unknown message type
- invalid enum
- impossible business state due bad producer

Handling:

```text
send to DLQ / mark permanent failure / operator triage
```

### 26.3 Conditional Error

Contoh:

- referenced case not found yet
- event arrives before entity replication
- dependency eventually consistent

Handling:

```text
short retry if likely temporary
parking lot if requires later reconciliation
```

### 26.4 Duplicate / Already Processed

Handling:

```text
ack success, do not retry
```

Classification table:

| Error | Retry? | Ack? | DLQ? | Notes |
|---|---:|---:|---:|---|
| Duplicate command | No | Yes | No | log as duplicate skip |
| DB timeout | Yes | No | After max attempts | rollback |
| Invalid JSON | No | Usually after DLQ handoff | Yes | permanent poison |
| Unknown enum | No | DLQ | Yes | schema/version issue |
| Case already approved | No | Yes | No | idempotent outcome |
| Case cancelled | Usually no | Depends business | Maybe | invalid state |
| Downstream 503 | Yes | No | After max attempts | retryable |
| Downstream 400 | No | Depends | Yes | permanent rejection |

---

## 27. Observability for Reliability

Reliability tanpa observability adalah asumsi.

Minimum metrics:

```text
messages.received.total
messages.processed.total
messages.duplicates.total
messages.failed.retryable.total
messages.failed.permanent.total
messages.redelivered.total
messages.dlq.total
message.processing.duration
message.end_to_end.latency
message.delivery.count
inbox.rows.pending
outbox.rows.pending
outbox.publish.lag
```

Log fields:

```text
message_id
business_message_id
correlation_id
causation_id
destination
consumer_name
delivery_count
redelivered
aggregate_type
aggregate_id
attempt
handler_result
error_classification
```

Example structured log:

```json
{
  "event": "jms_message_processed",
  "consumer": "case-approval-consumer",
  "destination": "queue.case.approval.command",
  "businessMessageId": "cmd-2026-000001",
  "jmsMessageId": "ID:broker-123",
  "correlationId": "corr-abc",
  "caseId": "CASE-123",
  "deliveryCount": 2,
  "redelivered": true,
  "result": "DUPLICATE_SKIPPED",
  "durationMs": 18
}
```

---

## 28. Testing Reliability Semantics

### 28.1 Test Duplicate Delivery

Scenario:

```text
send command C1
process successfully
send same command C1 again
assert business state changed once
assert audit harmful record once
assert duplicate skip metric incremented
```

### 28.2 Test Crash After DB Commit Before Ack

Harder to test, but can simulate:

```text
handler commits DB
then throws before ack/commit JMS
broker redelivers
handler skips duplicate
```

### 28.3 Test Producer Duplicate

```text
send two JMS messages with different JMSMessageID but same commandId
assert only one business effect
```

### 28.4 Test Poison Message

```text
send invalid payload
assert retries happen according to policy
assert final DLQ
assert no partial business state
```

### 28.5 Test Replay

```text
process event E1
replay E1 from archive/DLQ
assert idempotent skip or deterministic re-application
```

### 28.6 Test Ordering + Duplicate

```text
send event version 1
send event version 2
redeliver version 1
assert stale version skipped
```

---

## 29. Decision Framework: Choosing Reliability Strategy

### 29.1 Ask These Questions

1. What happens if this message is lost?
2. What happens if this message is processed twice?
3. What happens if this message is processed after newer messages?
4. Can the side effect be made idempotent?
5. Is there a stable business idempotency key?
6. Can business mutation and dedup marker share one DB transaction?
7. Does downstream support idempotency key?
8. Is replay required?
9. Who owns DLQ triage?
10. What evidence is needed for audit?

### 29.2 Strategy Selection

```text
Low criticality + loss tolerated:
  at-most-once / best effort acceptable

Critical command + duplicate tolerated if guarded:
  at-least-once + idempotent consumer

Cross-service business workflow:
  outbox + JMS + inbox + state transition guard

External non-idempotent side effect:
  local outbox + idempotency key if possible + reconciliation

Strict atomic DB + JMS resource:
  consider XA/JTA only if operationally justified
```

---

## 30. Anti-Patterns

### 30.1 “We Use Persistent JMS, So We Are Safe”

Persistent message only helps broker storage durability.

It does not solve:

- duplicate processing
- producer retry duplicate
- consumer crash after DB commit
- downstream side effect duplicate
- bad schema
- DLQ neglect

### 30.2 “Exactly Once Is Guaranteed by the Broker”

Broker can provide strong guarantees within its scope. Business exactly-once across database, email, HTTP, and human workflow is an application architecture problem.

### 30.3 “Use JMSMessageID as Business ID”

`JMSMessageID` is provider-assigned and may differ across retries or republishing.

Use business id:

```text
commandId / eventId / operationId
```

### 30.4 “Retry Forever”

Infinite retry can block queues, burn CPU, hide poison messages, and delay valid work.

Use:

- bounded retry
- DLQ
- parking lot
- alert
- replay workflow

### 30.5 “DLQ Means Done”

DLQ means unresolved business risk.

### 30.6 “Ack in finally”

```java
finally {
    message.acknowledge();
}
```

This can convert failures into message loss.

### 30.7 “Catch Exception and Return”

```java
try {
    process(message);
} catch (Exception e) {
    log.error("failed", e);
}
```

If returning causes ack/commit, message is lost.

### 30.8 “One Big Transaction Solves Everything”

XA/2PC can help in limited contexts, but cannot include non-XA systems like most HTTP APIs and SMTP.

---

## 31. Practical Blueprint for Critical JMS Consumer

A production-grade critical JMS consumer should usually have:

```text
1. Stable message contract
2. Business idempotency key
3. Consumer-specific inbox/dedup table
4. Domain state transition guard
5. Local DB transaction for inbox + business mutation + audit
6. Ack/JMS commit only after DB commit
7. Exception classification
8. Retry policy with backoff
9. DLQ/parking lot
10. Replay tooling
11. Metrics and structured logs
12. Operator runbook
```

Pseudo-flow:

```text
receive message
extract metadata
parse payload
validate envelope
begin DB transaction
insert inbox if absent
if already processed:
  commit DB
  ack JMS
  return
load aggregate with lock/version
validate transition
apply mutation
write audit
mark inbox processed
commit DB
ack JMS
```

If error:

```text
if duplicate/already applied:
  commit/ack
elif retryable:
  rollback/no ack
elif permanent:
  record failure and send/allow DLQ according to policy
else:
  rollback/no ack
```

---

## 32. Mini Case Study: Case Approval Command

### 32.1 Requirements

```text
A case may be approved once.
Approval must not be lost.
Duplicate approval command must not create duplicate approval.
Audit trail must show actual processing outcome.
Operator must be able to replay failed commands.
```

### 32.2 Message

```json
{
  "schemaVersion": 1,
  "messageType": "ApproveCaseCommand",
  "commandId": "CMD-2026-000001",
  "correlationId": "CORR-888",
  "caseId": "CASE-123",
  "actorId": "USER-456",
  "requestedAt": "2026-06-18T10:15:30Z"
}
```

### 32.3 Database Constraints

```sql
ALTER TABLE case_approval
ADD CONSTRAINT uq_case_approval_command UNIQUE (command_id);

ALTER TABLE message_inbox
ADD CONSTRAINT pk_message_inbox PRIMARY KEY (consumer_name, message_key);
```

### 32.4 Handler Invariant

```text
For each commandId, at most one successful approval side effect.
For each caseId, status can transition PENDING_APPROVAL -> APPROVED once.
Every duplicate is recorded as skipped, not failed.
```

### 32.5 Failure Safety

| Failure | Result |
|---|---|
| crash before DB commit | broker redelivers; no state committed |
| crash after DB commit before ack | broker redelivers; inbox detects processed |
| producer sends duplicate commandId | inbox/domain guard prevents duplicate |
| invalid payload | DLQ, no business mutation |
| DB timeout | rollback, redelivery |
| case already approved by same command | idempotent success |
| case already cancelled | permanent business failure / DLQ depending policy |

---

## 33. Top 1% Heuristics

1. **Always define reliability at business-effect level, not broker-delivery level.**
2. **Assume duplicate delivery unless proven otherwise.**
3. **Never depend solely on `JMSMessageID` for business idempotency.**
4. **Ack after durable side effect, not before.**
5. **Make duplicate success a normal path, not an exception path.**
6. **DLQ is an operational workflow, not a trash bin.**
7. **Treat timeout as unknown outcome, not failure.**
8. **Use state transition guards for workflow commands.**
9. **Use outbox for publishing after DB change.**
10. **Use inbox/dedup for consuming critical messages.**
11. **Avoid infinite retry unless queue starvation is impossible and alerting exists.**
12. **Do not promise exactly-once without defining the boundary.**
13. **Test crash windows explicitly.**
14. **Design replay before you need it.**
15. **Make reliability observable through metrics, logs, and audit.**

---

## 34. Checklist: Review Reliability of a JMS Flow

Use this in design review.

### Message Contract

- [ ] Message has stable `messageId` / `commandId` / `eventId`.
- [ ] Message has `correlationId`.
- [ ] Message has type and schema version.
- [ ] Message has aggregate/business key.
- [ ] Message contract defines duplicate behavior.

### Producer

- [ ] Producer retry can create duplicate safely.
- [ ] Persistent delivery used for critical messages.
- [ ] Send timeout ambiguity handled.
- [ ] Outbox used if DB update + publish must be reliable.

### Broker

- [ ] Redelivery policy configured.
- [ ] DLQ configured per critical destination.
- [ ] Expiry/TTL intentionally configured or absent.
- [ ] Monitoring exists for queue depth and DLQ.

### Consumer

- [ ] Ack/commit occurs after durable business effect.
- [ ] Handler idempotent.
- [ ] Dedup/inbox exists for critical flows.
- [ ] Domain state transition guarded.
- [ ] Duplicate is treated as success/skip.
- [ ] Exception classification exists.

### Database

- [ ] Unique constraints enforce idempotency.
- [ ] Transaction includes dedup marker and business mutation.
- [ ] Optimistic/pessimistic locking prevents concurrent double effect.

### External Effects

- [ ] Downstream idempotency key used where possible.
- [ ] Non-idempotent effects isolated behind outbox.
- [ ] Reconciliation exists for uncertain outcomes.

### Operations

- [ ] DLQ has owner and SLA.
- [ ] Replay tool exists.
- [ ] Audit trail records processed/skipped/failed.
- [ ] Dashboards show duplicates/redelivery/failures.

---

## 35. Latihan

### Latihan 1 — Classify Semantics

Untuk setiap flow berikut, tentukan apakah at-most-once, at-least-once, effectively-once, atau unsafe:

1. Consumer auto-ack lalu insert DB.
2. Consumer insert DB lalu manual ack, tanpa dedup.
3. Consumer insert DB + dedup dalam satu transaction lalu ack setelah commit.
4. Producer update DB lalu send JMS tanpa outbox.
5. Consumer send email lalu crash sebelum ack.
6. Consumer update `status = APPROVED where status = PENDING` lalu ack.

### Latihan 2 — Find Failure Window

Desain flow:

```text
receive PaymentCapturedEvent
insert revenue record
send receipt email
ack message
```

Cari semua failure window dan redesign agar duplicate-safe.

### Latihan 3 — Design Idempotency Key

Untuk message berikut, tentukan idempotency key terbaik:

1. `ApproveCaseCommand`
2. `CaseApprovedEvent`
3. `SendEmailCommand`
4. `SyncExternalProfileCommand`
5. `PaymentCaptureCommand`

### Latihan 4 — DLQ Policy

Buat DLQ policy untuk:

```text
queue.case.status.transition
```

Harus mencakup:

- max attempts
- backoff
- permanent vs retryable error
- alert threshold
- owner
- replay rule
- discard approval rule

---

## 36. Ringkasan

Part ini adalah salah satu fondasi paling penting dalam JMS production engineering.

Intinya:

```text
JMS can redeliver.
Producer can duplicate.
Consumer can crash.
External systems can timeout after success.
Broker guarantees are not the same as business guarantees.
```

Maka strategi realistis untuk sistem enterprise serius adalah:

```text
at-least-once transport
+ idempotent business handler
+ dedup/inbox
+ outbox for publishing
+ state transition guard
+ DLQ/replay/audit
= effectively-once business semantics
```

Exactly-once bukan kata ajaib. Ia harus selalu dijelaskan boundary-nya.

Top 1% engineer tidak hanya bertanya “apakah JMS reliable?”, tetapi mendesain dan membuktikan:

```text
Dalam semua crash window yang masuk akal,
business state tetap benar,
duplicate tidak merusak,
loss terdeteksi,
dan recovery punya jalur operasional yang jelas.
```

---

## 37. Referensi Resmi dan Bacaan Lanjutan

- Jakarta Messaging 3.1 Specification — official Jakarta EE specification.
- Jakarta Messaging Concepts — Jakarta EE Tutorial.
- Jakarta Messaging `Session` API documentation — session as a single-threaded context and transaction/ack boundary.
- Apache ActiveMQ Artemis documentation — duplicate detection, redelivery, undelivered messages, dead letter address, messaging concepts.
- IBM MQ JMS/Jakarta Messaging model documentation — provider perspective on JMS/Jakarta Messaging model.

---

## 38. Status Seri

Selesai: Part 0 sampai Part 11.  
Belum selesai: Part 12 sampai Part 35.  
Part berikutnya: **Part 12 — Ordering: FIFO, Partitioning, Message Group, Session Affinity, dan Reordering Failure**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-010.md">⬅️ Part 10 — Transaction Model: Local JMS Transaction, JTA/XA, 2PC, Outbox, dan Trade-off Konsistensi</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-012.md">Part 12 — Ordering: FIFO, Partitioning, Message Group, Session Affinity, dan Reordering Failure ➡️</a>
</div>
