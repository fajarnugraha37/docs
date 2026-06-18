# Learn Java JMS / Jakarta Messaging Enterprise Message-Oriented Middleware Engineering — Part 33

## Failure Modeling Workshop: 40+ Failure Scenarios dan Cara Mendesain Recovery

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: `033`  
> Status seri: belum selesai  
> Target pembaca: engineer Java/Jakarta/Spring yang ingin mampu mendesain, mengoperasikan, dan men-debug sistem JMS/Jakarta Messaging production-grade  
> Fokus Java: Java 8 sampai Java 25  

---

## 1. Tujuan Part Ini

Part ini bukan lagi membahas API JMS satu per satu. Pada titik ini, kita sudah melewati:

- domain model JMS,
- queue/topic semantics,
- producer/consumer engineering,
- acknowledgement,
- transaction model,
- ordering,
- retry/DLQ,
- request/reply,
- selector/routing,
- security,
- broker architecture,
- provider differences,
- Jakarta EE/Spring integration,
- microservices,
- schema contract,
- idempotency,
- capacity,
- performance,
- observability,
- testing,
- deployment,
- Kubernetes,
- technology comparison,
- dan Enterprise Integration Patterns.

Sekarang kita masuk ke skill yang membedakan engineer biasa dengan engineer yang sangat kuat secara production engineering: **failure modeling**.

Tujuan part ini:

1. Mampu melihat sistem JMS sebagai rangkaian failure window, bukan sekadar flow normal.
2. Mampu mendesain invariant yang tetap benar meskipun broker, database, network, consumer, producer, schema, storage, atau operator gagal.
3. Mampu membedakan failure yang boleh otomatis di-retry dari failure yang harus dihentikan, diparkir, atau diinvestigasi manual.
4. Mampu membangun runbook recovery yang aman untuk sistem enterprise/regulatory/case management.
5. Mampu membuat desain yang defensible: bisa dijelaskan kepada auditor, ops, security, product owner, dan engineer lain.

Mental model utama:

> Sistem JMS yang baik bukan sistem yang tidak pernah gagal. Sistem JMS yang baik adalah sistem yang sudah tahu apa yang harus terjadi ketika setiap bagian gagal.

---

## 2. Prinsip Dasar Failure Modeling JMS

### 2.1 Failure modeling bukan daftar error

Banyak tim hanya mencatat error seperti:

- broker down,
- database timeout,
- consumer crash,
- message duplicate,
- message masuk DLQ,
- schema mismatch.

Itu belum cukup.

Failure modeling yang benar harus menjawab:

1. **Apa invariant bisnis yang harus tetap benar?**
2. **Side effect apa yang sudah terjadi sebelum gagal?**
3. **Ack/commit sudah terjadi atau belum?**
4. **Message akan hilang, duplicate, tertahan, atau reorder?**
5. **Recovery boleh otomatis atau harus manual?**
6. **Bagaimana membuktikan recovery benar?**
7. **Apa metric/log/audit yang membuktikan urutan kejadian?**

Contoh sederhana:

```text
Consumer menerima message ApproveApplicationCommand.
Consumer update DB: status application menjadi APPROVED.
Consumer crash sebelum ack JMS.
Broker redeliver message.
Consumer memproses ulang command yang sama.
```

Pertanyaan penting bukan “kenapa crash?”, tetapi:

- apakah approval boleh terjadi dua kali?
- apakah audit trail boleh tercatat dua kali?
- apakah email approval boleh terkirim dua kali?
- apakah state transition APPROVED -> APPROVED valid?
- apakah handler idempotent?
- apakah replay aman?

---

### 2.2 Failure window adalah unit analisis utama

Dalam JMS, setiap message processing biasanya memiliki beberapa tahap:

```text
1. Message tersedia di broker
2. Message dikirim ke consumer / masuk prefetch buffer
3. Consumer mulai proses
4. Consumer validasi payload
5. Consumer baca state dari DB
6. Consumer melakukan side effect lokal
7. Consumer melakukan side effect eksternal
8. Consumer commit transaksi DB
9. Consumer ack / commit session JMS
10. Broker menghapus atau menandai message selesai
```

Di antara setiap langkah ada failure window.

Contoh failure window:

```text
DB commit sukses, JMS ack gagal.
```

Dampaknya:

- DB sudah berubah,
- broker menganggap message belum selesai,
- message bisa dikirim ulang,
- handler wajib idempotent.

Contoh lain:

```text
JMS ack sukses, DB commit gagal.
```

Dampaknya jauh lebih buruk:

- broker menganggap message selesai,
- DB tidak berubah,
- message hilang secara efektif,
- recovery sulit kecuali ada audit/outbox/compensation.

Karena itu invariant klasik:

> Jangan ack message sebelum side effect utama aman atau bisa dipulihkan.

---

### 2.3 JMS memberi delivery guarantee, bukan business guarantee

JMS dapat membantu mengirim message dengan durable delivery, acknowledgement, transaction, redelivery, selector, dan metadata.

Namun JMS tidak otomatis menjamin:

- idempotency bisnis,
- exactly-once end-to-end,
- valid state transition,
- tidak ada email duplicate,
- tidak ada payment duplicate,
- ordering bisnis lintas entity,
- schema compatibility,
- recovery manual yang aman,
- auditability regulator.

Itu tanggung jawab desain aplikasi.

---

## 3. Taxonomy Failure dalam Sistem JMS

Untuk menganalisis secara sistematis, kita kelompokkan failure menjadi beberapa kategori.

### 3.1 Producer-side failure

Contoh:

- producer gagal connect ke broker,
- producer timeout saat send,
- send berhasil tapi producer tidak tahu,
- producer mengirim duplicate,
- producer mengirim message invalid,
- producer mengirim terlalu cepat.

### 3.2 Broker-side failure

Contoh:

- broker down,
- broker restart,
- disk penuh,
- journal corrupt,
- paging overload,
- cluster split-brain,
- failover duplicate,
- DLQ penuh,
- permission berubah.

### 3.3 Consumer-side failure

Contoh:

- consumer crash sebelum ack,
- consumer crash setelah DB commit,
- consumer stuck/hang,
- consumer terlalu lambat,
- consumer memory leak,
- listener concurrency salah,
- graceful shutdown gagal.

### 3.4 Data/contract failure

Contoh:

- payload tidak valid,
- schema version tidak dikenali,
- field wajib hilang,
- enum value baru tidak didukung,
- property selector hilang,
- message type salah.

### 3.5 Dependency failure

Contoh:

- database down,
- downstream HTTP timeout,
- email gateway down,
- object storage unavailable,
- authentication service down,
- Redis dedup cache down.

### 3.6 Operational failure

Contoh:

- wrong queue binding,
- wrong DLQ config,
- wrong retry interval,
- secret expired,
- certificate expired,
- deployment mismatch,
- operator replay message salah.

### 3.7 Security/compliance failure

Contoh:

- unauthorized consumer membaca queue,
- sensitive payload bocor ke log,
- message tidak terenkripsi saat transit,
- audit trail tidak lengkap,
- tenant leakage,
- replay tanpa approval.

---

## 4. Invariant yang Harus Selalu Dijaga

Sebelum membahas skenario, kita tentukan invariant.

### 4.1 Message processing invariant

```text
Untuk setiap message yang memicu side effect bisnis:
- side effect harus terjadi nol kali atau satu kali secara bisnis,
- jika terjadi lebih dari satu kali secara teknis, hasil akhirnya harus sama,
- jika gagal permanen, message harus bisa ditemukan, dijelaskan, dan dipulihkan.
```

### 4.2 Ack invariant

```text
Ack hanya boleh terjadi setelah aplikasi mencapai kondisi aman:
- state sudah committed, atau
- message sudah diparkir, atau
- failure sudah dicatat sebagai terminal, atau
- side effect bisa diulang tanpa merusak state.
```

### 4.3 Idempotency invariant

```text
Redelivery message yang sama tidak boleh menghasilkan state bisnis yang salah.
```

### 4.4 Ordering invariant

```text
Jika urutan bisnis penting, ordering harus didefinisikan berdasarkan aggregate/business key,
bukan diasumsikan dari global FIFO broker.
```

### 4.5 Observability invariant

```text
Setiap message penting harus punya correlation id, causation id, business key,
processing attempt, result, dan terminal outcome yang bisa ditelusuri.
```

### 4.6 Recovery invariant

```text
Recovery/replay tidak boleh lebih berbahaya daripada failure awal.
```

---

## 5. Template Analisis Failure Scenario

Gunakan template berikut untuk setiap skenario.

```text
Scenario:
  Apa yang gagal?

Normal flow:
  Apa flow normalnya?

Failure window:
  Gagal terjadi di antara langkah apa?

Immediate effect:
  Apa dampak langsung ke broker, DB, consumer, producer?

Business risk:
  Apa risiko bisnisnya?

JMS behavior:
  Apakah message hilang, redeliver, duplicate, stuck, reorder, DLQ?

Required invariant:
  Invariant apa yang harus dijaga?

Detection:
  Metric/log/audit apa yang mendeteksi?

Recovery:
  Otomatis retry, manual replay, compensation, atau terminal failure?

Prevention/design:
  Desain apa yang mengurangi risiko?
```

---

## 6. Scenario 1 — Producer Tidak Bisa Connect ke Broker

### Scenario

Aplikasi producer ingin mengirim command/event, tetapi broker tidak dapat dihubungi.

### Failure window

Sebelum message diterima broker.

### Immediate effect

- Message belum berada di broker.
- Jika aplikasi hanya melakukan direct send tanpa persistence lokal, event bisa hilang.
- User/API caller mungkin menerima error atau timeout.

### Business risk

Contoh:

- case sudah dibuat di DB, tetapi event `CaseCreated` tidak pernah dikirim.
- approval sudah committed, tetapi notification command gagal dikirim.

### JMS behavior

JMS tidak bisa melakukan redelivery karena message belum pernah masuk broker.

### Recovery design

Pilihan desain:

1. **Fail request**
   - Cocok jika operasi belum commit.
   - API return error.
   - Caller retry.

2. **Transactional outbox**
   - DB commit state + outbox row.
   - Relay worker mengirim ke JMS nanti.
   - Cocok untuk domain event setelah DB commit.

3. **Local durable spool**
   - Jarang dipakai di aplikasi biasa.
   - Lebih kompleks, perlu disk local consistency.

### Recommended invariant

```text
Jika state bisnis sudah committed, event penting tidak boleh hanya bergantung pada successful immediate JMS send.
```

### Detection

- producer send failure count,
- outbox pending count,
- broker connection failure,
- event lag sejak DB commit.

---

## 7. Scenario 2 — Producer Timeout Saat Send, Tetapi Broker Mungkin Sudah Menerima

### Scenario

Producer memanggil `send()`, lalu timeout/network error terjadi. Producer tidak tahu apakah broker sudah menerima message.

### Failure window

Di antara broker menerima message dan producer menerima acknowledgement/response.

### Immediate effect

Ada dua kemungkinan:

```text
A. Broker belum menerima message.
B. Broker sudah menerima message, tetapi producer tidak tahu.
```

Jika producer retry, bisa terjadi duplicate.

### Business risk

- duplicate command,
- duplicate event,
- duplicate notification,
- duplicate downstream side effect.

### JMS behavior

JMS provider tidak selalu bisa memberi kepastian end-to-end kepada aplikasi ketika network ambiguity terjadi.

### Recovery design

Gunakan idempotent message identity:

```text
messageId/domainEventId/commandId = stable UUID dari aplikasi,
bukan hanya JMSMessageID yang dibuat provider.
```

Producer retry aman jika consumer dedup berdasarkan `eventId` atau `commandId`.

### Anti-pattern

```java
UUID eventId = UUID.randomUUID();
send(eventId);
// timeout
UUID newEventId = UUID.randomUUID();
send(newEventId); // consumer melihat dua event berbeda
```

### Better pattern

```java
UUID eventId = existingOutboxRow.eventId();
send(eventId);
// timeout
send(eventId); // retry memakai id yang sama
```

---

## 8. Scenario 3 — Producer Mengirim Message Setelah DB Commit Tanpa Outbox

### Scenario

Service melakukan:

```text
1. Insert/update DB
2. Commit DB
3. Send JMS event
```

Lalu crash terjadi setelah commit DB sebelum send JMS.

### Immediate effect

- DB berubah.
- Event tidak terkirim.
- Sistem downstream tidak tahu perubahan.

### Business risk

- read model tidak update,
- notification tidak terkirim,
- audit asynchronous hilang,
- SLA timer tidak dimulai,
- integration partner tidak menerima event.

### Recovery design

Gunakan outbox:

```sql
BEGIN;
UPDATE application SET status = 'APPROVED' WHERE id = ?;
INSERT INTO outbox_event(event_id, aggregate_id, event_type, payload, status)
VALUES (?, ?, 'ApplicationApproved', ?, 'PENDING');
COMMIT;
```

Relay:

```text
Read PENDING outbox
Send JMS
Mark SENT or retry
```

### Required invariant

```text
State change dan record niat publish harus atomic di database yang sama.
```

---

## 9. Scenario 4 — Producer Mengirim Message Sebelum DB Commit

### Scenario

Service melakukan:

```text
1. Send JMS event
2. Commit DB
```

Commit DB kemudian gagal.

### Immediate effect

- Consumer bisa menerima event untuk state yang tidak pernah committed.
- Downstream memproses fakta palsu.

### Business risk

Sangat serius untuk event yang menyatakan fakta.

Contoh:

```text
ApplicationApproved event terkirim,
tetapi DB masih PENDING karena commit gagal.
```

### Recommended design

Untuk domain/integration event:

```text
Jangan publish fact event sebelum fact committed.
```

Gunakan outbox.

Untuk command ke service lain, desain harus jelas apakah command dikirim sebagai bagian dari saga, bukan sebagai bukti state final.

---

## 10. Scenario 5 — Broker Down Saat Consumer Sedang Memproses

### Scenario

Consumer sudah menerima message dan sedang memproses. Broker tiba-tiba down/restart.

### Possible behavior

Tergantung provider dan mode:

- session connection error,
- ack gagal,
- transaksi JMS rollback,
- message dianggap belum selesai,
- message redeliver setelah broker pulih,
- client reconnect.

### Business risk

Jika consumer sudah melakukan side effect sebelum broker down, redelivery bisa duplicate.

### Required design

Consumer handler harus idempotent.

```text
Broker failure tidak boleh menjadi alasan state bisnis rusak.
```

### Detection

- broker restart event,
- client reconnect log,
- sudden redelivery spike,
- `JMSRedelivered=true`,
- delivery count meningkat,
- consumer exception around ack/commit.

---

## 11. Scenario 6 — Consumer Crash Sebelum Melakukan Side Effect

### Scenario

Consumer menerima message, lalu crash sebelum update DB atau call external system.

### Immediate effect

- Message belum ack.
- Broker akan redeliver.
- Tidak ada side effect.

### Business risk

Relatif rendah jika redelivery dikonfigurasi benar.

### Recovery

Automatic redelivery cukup.

### Required invariant

```text
Message tidak boleh ack sebelum handler benar-benar selesai.
```

---

## 12. Scenario 7 — Consumer Crash Setelah DB Commit Sebelum Ack

### Scenario

```text
1. Consumer receive message
2. Consumer update DB
3. DB commit sukses
4. Consumer crash sebelum JMS ack
5. Broker redeliver
```

### Immediate effect

- DB sudah berubah.
- Message akan diproses ulang.

### Business risk

- duplicate audit,
- duplicate notification,
- invalid transition,
- repeated downstream command.

### Required design

Gunakan transactional inbox/idempotency:

```sql
CREATE TABLE processed_message (
    message_key VARCHAR(100) PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL,
    handler_name VARCHAR(100) NOT NULL,
    result VARCHAR(30) NOT NULL
);
```

Handler pattern:

```text
BEGIN;
INSERT INTO processed_message(message_key, handler_name, result)
VALUES (?, ?, 'PROCESSING');
-- if duplicate key, skip or verify prior result
UPDATE business_state ...
UPDATE processed_message SET result = 'SUCCESS';
COMMIT;
ACK JMS;
```

### Invariant

```text
Redelivery setelah DB commit harus menjadi no-op atau safe verification.
```

---

## 13. Scenario 8 — Consumer Ack Sukses Sebelum DB Commit Gagal

### Scenario

Consumer melakukan ack lebih dulu, lalu DB commit gagal.

### Immediate effect

- Broker menganggap message selesai.
- State bisnis tidak berubah.
- Message hilang secara efektif.

### Business risk

Sangat tinggi.

### Anti-pattern

```java
message.acknowledge();
repository.updateState(...); // gagal
```

### Better rule

```text
Persist side effect dulu, baru ack.
```

Atau gunakan transacted session/local transaction/JTA jika desain memang membutuhkan coupling tertentu.

---

## 14. Scenario 9 — Consumer Melakukan External HTTP Call, Lalu Crash Sebelum Ack

### Scenario

Consumer menerima message, memanggil external API, external API sukses, lalu consumer crash sebelum ack.

### Immediate effect

- External side effect sudah terjadi.
- Message redeliver.
- External API bisa terpanggil ulang.

### Business risk

- duplicate payment,
- duplicate email,
- duplicate ticket,
- duplicate submission ke partner.

### Recovery design

Pilihan:

1. External API harus idempotent.
2. Gunakan idempotency key saat call external.
3. Simpan status external call di DB sebelum/bersama transisi.
4. Gunakan outbox untuk external side effect.
5. Gunakan compensation jika duplicate tidak bisa dicegah.

### Pattern

```text
Message -> DB transaction records intent -> external dispatcher sends with idempotency key -> records result
```

Jangan melakukan external irreversible side effect langsung di listener tanpa idempotency.

---

## 15. Scenario 10 — Message Handler Throw Exception untuk Error Transient

### Scenario

Database timeout atau downstream sementara gagal.

### JMS behavior

Jika session transacted atau container-managed transaction rollback, message bisa redeliver.

### Risk

Retry terlalu cepat dapat menyebabkan retry storm.

### Recovery design

- bounded retry,
- exponential backoff,
- redelivery delay,
- max delivery attempts,
- DLQ setelah limit,
- circuit breaker untuk dependency.

### Invariant

```text
Retry tidak boleh memperparah dependency yang sedang down.
```

---

## 16. Scenario 11 — Message Handler Throw Exception untuk Error Permanent

### Scenario

Payload invalid, unknown enum, missing required field, unsupported schema version.

### Risk

Jika diperlakukan sebagai transient:

- message diulang berkali-kali,
- consumer capacity habis,
- queue lain ikut terlambat,
- log penuh,
- alert noisy.

### Recovery design

Classify error:

```text
Permanent error -> reject/park/DLQ quickly
Transient error -> retry with backoff
Unknown error -> limited retry then DLQ
```

### Example classification

```java
enum FailureClass {
    TRANSIENT_DEPENDENCY,
    PERMANENT_CONTRACT,
    PERMANENT_BUSINESS_RULE,
    UNKNOWN
}
```

---

## 17. Scenario 12 — Poison Message di Head of Queue

### Scenario

Satu message selalu gagal dan terus dikirim ulang.

### Risk

- consumer stuck pada message sama,
- messages lain tertahan,
- delivery count naik,
- throughput drop.

### Recovery design

- max delivery attempts,
- DLQ,
- poison message detection,
- quarantine queue,
- alert by redelivery count.

### Detection

```text
same message id redelivered > threshold
same business key failed repeatedly
queue depth increasing while consumer busy
```

---

## 18. Scenario 13 — DLQ Menjadi Kuburan yang Tidak Pernah Diproses

### Scenario

Message gagal masuk DLQ, tetapi tidak ada ownership/proses triage.

### Risk

DLQ terlihat seperti recovery, padahal hanya menyembunyikan kehilangan proses bisnis.

### Required operating model

DLQ harus punya:

- owner,
- severity rules,
- dashboard,
- triage SOP,
- reason code,
- replay tooling,
- retention policy,
- approval policy,
- audit trail.

### Invariant

```text
Message di DLQ belum selesai secara bisnis.
```

---

## 19. Scenario 14 — Operator Replay Message dari DLQ Tanpa Memperbaiki Root Cause

### Scenario

Operator melihat DLQ, lalu langsung replay ke original queue.

### Risk

- message kembali gagal,
- retry storm,
- DLQ flood,
- duplicate side effect,
- state makin rusak.

### Safe replay checklist

Sebelum replay:

1. Apakah root cause sudah fixed?
2. Apakah message contract valid?
3. Apakah handler sekarang compatible?
4. Apakah message idempotent?
5. Apakah state saat ini masih cocok?
6. Apakah replay butuh approval?
7. Apakah replay batch size dibatasi?
8. Apakah monitoring aktif?

### Better design

Gunakan parking lot workflow:

```text
DLQ -> analysis -> repair metadata/payload if allowed -> approve -> replay controlled -> verify
```

---

## 20. Scenario 15 — Duplicate Message dengan Business Key Sama tetapi Message ID Berbeda

### Scenario

Producer mengirim ulang logical event yang sama dengan generated ID baru.

### Risk

Dedup berdasarkan `JMSMessageID` tidak cukup.

### Required design

Dedup harus berdasarkan stable business/event key.

Contoh:

```text
applicationId + eventType + stateVersion
commandId
outboxEventId
businessOperationId
```

### Invariant

```text
Identitas idempotency harus berasal dari domain operation, bukan dari transport delivery attempt.
```

---

## 21. Scenario 16 — Message Redelivery Mengubah Ordering

### Scenario

Message A gagal, message B sukses duluan, lalu A redeliver belakangan.

### Risk

State transition salah.

Contoh:

```text
A: ApplicationSubmitted
B: ApplicationApproved
A redeliver setelah B
```

Jika handler tidak memeriksa version, state bisa mundur.

### Design

Gunakan state version/sequence:

```text
Apply event only if event.version == current.version + 1
```

Atau:

```text
Ignore stale event if event.version <= current.version
```

Tergantung semantic.

---

## 22. Scenario 17 — Concurrent Consumers Memproses Entity yang Sama

### Scenario

Queue punya banyak consumer. Dua message untuk aggregate sama diproses paralel.

### Risk

- race condition,
- lost update,
- invalid transition,
- duplicate notification,
- deadlock DB.

### Design options

1. Message grouping by business key.
2. Partition queue per shard.
3. DB optimistic locking.
4. Per-aggregate lock.
5. State machine guard.
6. Idempotent transition.

### Recommended invariant

```text
State transition harus dilindungi oleh version/lock, bukan hanya asumsi queue FIFO.
```

---

## 23. Scenario 18 — Message Group Consumer Mati dan Group Tertahan

### Scenario

Message grouping digunakan. Consumer yang memegang group mati atau stuck.

### Risk

- group backlog,
- key tertentu stuck,
- queue overall terlihat jalan tapi sebagian entity berhenti.

### Detection

- per-business-key lag,
- group ownership metric,
- oldest message age per group,
- consumer heartbeat.

### Recovery

- broker group rebalance,
- consumer restart,
- stuck group release jika provider support,
- manual drain untuk key tertentu.

---

## 24. Scenario 19 — Prefetch Terlalu Besar Menyebabkan Unfair Dispatch

### Scenario

Consumer A prefetch banyak message, lalu lambat. Consumer B idle tapi message sudah berada di buffer A.

### Risk

- unfair load,
- latency tinggi,
- memory pressure,
- shutdown lambat,
- redelivery delay saat consumer mati.

### Tuning

- kurangi prefetch/window,
- gunakan concurrency yang benar,
- pisahkan fast/slow workload,
- ukur processing time distribution.

### Invariant

```text
Prefetch adalah trade-off throughput vs fairness/latency/recovery speed.
```

---

## 25. Scenario 20 — Consumer Terlalu Lambat dan Queue Depth Naik

### Scenario

Arrival rate lebih tinggi dari processing rate.

```text
λ > μ
```

### Risk

- backlog makin besar,
- SLA terlewat,
- message TTL expire,
- broker paging,
- disk pressure,
- downstream delay.

### Diagnosis

- arrival rate,
- dequeue rate,
- processing latency,
- oldest message age,
- dependency latency,
- DB CPU/lock wait,
- consumer thread utilization.

### Recovery options

1. Scale consumers.
2. Optimize handler.
3. Batch safely.
4. Reduce downstream latency.
5. Split queue by workload.
6. Apply admission control at producer.
7. Load shedding untuk low-priority messages.

---

## 26. Scenario 21 — Retry Storm Setelah Dependency Pulih Sebagian

### Scenario

DB/downstream down selama beberapa menit. Banyak message gagal dan dijadwalkan retry. Saat dependency mulai pulih, semua retry menyerbu.

### Risk

- dependency down lagi,
- broker spike,
- consumer CPU spike,
- latency p99 buruk,
- cascading failure.

### Design

- exponential backoff,
- jitter,
- max concurrency per dependency,
- circuit breaker,
- bulkhead queue,
- replay throttling.

### Invariant

```text
Recovery traffic harus dikontrol seperti production traffic.
```

---

## 27. Scenario 22 — TTL Expired Sebelum Consumer Memproses

### Scenario

Message punya TTL. Backlog tinggi. Message expire sebelum diproses.

### Risk

- command/event hilang sesuai konfigurasi,
- bisnis mungkin tidak sadar,
- SLA timer tidak jalan,
- notification tidak terkirim.

### Design question

TTL cocok untuk:

- cache invalidation,
- transient notification,
- stale request,
- time-sensitive command.

TTL tidak cocok untuk:

- legal state transition,
- audit event,
- financial operation,
- regulatory workflow command.

### Required observability

- expired message count,
- expiry queue count,
- business impact report.

---

## 28. Scenario 23 — Priority Message Menyebabkan Starvation

### Scenario

High priority messages terus masuk sehingga low priority tidak pernah diproses.

### Risk

- low priority backlog permanen,
- SLA low-priority tetap gagal,
- starvation tersembunyi.

### Design

- separate queue per class,
- weighted consumer allocation,
- aging policy jika provider mendukung,
- explicit SLA per queue.

### Mental model

Priority bukan pengganti capacity planning.

---

## 29. Scenario 24 — Selector Salah Membuat Consumer Tidak Pernah Menerima Message

### Scenario

Consumer memakai selector:

```sql
module = 'CASE' AND priority = 'HIGH'
```

Producer mengirim property:

```text
moduleName=CASE
priority=HIGH as String, while selector expects numeric or wrong property
```

### Risk

- message stuck,
- consumer idle,
- queue depth naik,
- sulit didiagnosis karena tidak ada exception.

### Prevention

- contract test untuk message properties,
- typed property convention,
- dashboard per selector/subscription,
- avoid complex selectors for critical routing.

---

## 30. Scenario 25 — Wrong Destination / Misrouting

### Scenario

Producer mengirim ke queue/topic salah karena config environment salah.

### Risk

- message tidak diproses,
- tenant leakage,
- environment leakage,
- data masuk sistem salah.

### Prevention

- destination naming convention,
- environment prefix/suffix,
- config validation at startup,
- ACL per producer,
- smoke test after deployment,
- canary message with known correlation id.

---

## 31. Scenario 26 — Consumer Membaca Queue yang Salah Karena Permission Terlalu Luas

### Scenario

Consumer punya credential dengan akses wildcard.

### Risk

- data leakage,
- unauthorized processing,
- tenant boundary breach,
- audit/compliance incident.

### Design

- least privilege per application,
- separate credentials per service,
- read/write ACL separated,
- per-tenant/address-space isolation,
- audit access.

---

## 32. Scenario 27 — Sensitive Payload Bocor ke Log

### Scenario

Pada failure, aplikasi log full payload.

### Risk

- PII leak,
- credential leak,
- regulatory violation,
- long retention log exposure.

### Design

- structured logging with redaction,
- log message id/correlation id/business key only,
- store sensitive payload only in controlled store,
- mask fields,
- security review for exception handlers.

### Invariant

```text
Debuggability tidak boleh mengorbankan confidentiality.
```

---

## 33. Scenario 28 — Schema Version Baru Tidak Didukung Consumer Lama

### Scenario

Producer deploy versi baru dan menambah/ubah field. Consumer lama gagal parse.

### Risk

- DLQ flood,
- delayed integration,
- rollback sulit,
- partial environment broken.

### Prevention

- backward-compatible schema,
- additive changes,
- consumer tolerant reader,
- contract tests,
- versioned message type,
- rollout order: consumer first, producer later untuk breaking-adjacent changes.

---

## 34. Scenario 29 — Unknown Enum Value Membuat Consumer Crash

### Scenario

Consumer menggunakan Java enum strict:

```java
Status.valueOf(payload.status())
```

Producer mengirim value baru.

### Risk

Permanent failure.

### Better design

- parse unknown enum ke `UNKNOWN`,
- reject as permanent contract error dengan reason jelas,
- support compatibility window,
- monitor unknown value.

---

## 35. Scenario 30 — Message Body Besar Membuat Broker Paging dan Consumer Memory Pressure

### Scenario

Message berisi file/base64/document besar.

### Risk

- broker storage pressure,
- network latency,
- GC pressure,
- consumer OOM,
- slow replay,
- DLQ berat.

### Design

Gunakan claim check pattern:

```text
Payload besar disimpan di object storage/document store.
Message hanya membawa reference + checksum + metadata.
```

### Required invariant

```text
Referenced payload harus immutable atau versioned agar replay menghasilkan data yang sama.
```

---

## 36. Scenario 31 — ObjectMessage Gagal Deserialization Setelah Upgrade

### Scenario

Producer mengirim `ObjectMessage`. Consumer upgrade class/package/serialVersionUID.

### Risk

- deserialization failure,
- security risk,
- tight coupling,
- migration sulit.

### Recommendation

Hindari `ObjectMessage` untuk integration boundary.

Gunakan:

- JSON dengan schema,
- XML dengan XSD,
- Avro/Protobuf,
- BytesMessage dengan explicit format.

---

## 37. Scenario 32 — Broker Disk Penuh

### Scenario

Broker persistent store penuh karena backlog, DLQ, paging, atau journal tidak compact.

### Immediate effect

- producer send gagal/block,
- broker unstable,
- consumer mungkin tetap jalan tapi terbatas,
- message expiry/DLQ gagal.

### Recovery

1. Stop producer flood jika perlu.
2. Identify largest queues/DLQ.
3. Drain consumers safely.
4. Expand storage jika valid.
5. Remove only messages yang sudah disetujui.
6. Preserve forensic evidence.

### Prevention

- disk usage alert,
- queue depth alert,
- DLQ retention,
- capacity test,
- backpressure producer,
- quota per address/tenant.

---

## 38. Scenario 33 — Broker Split-Brain dalam HA/Cluster

### Scenario

Network partition membuat dua broker/cluster side menerima traffic yang seharusnya tunggal.

### Risk

- duplicate delivery,
- inconsistent queue ownership,
- message loss/duplication,
- order violation.

### Design

- quorum/fencing,
- tested HA mode,
- avoid active-active without understanding semantics,
- runbook for partition healing,
- reconciliation after failover.

### Invariant

```text
HA topology harus didesain untuk failure mode network partition, bukan hanya node crash.
```

---

## 39. Scenario 34 — Failover Menghasilkan Duplicate Delivery

### Scenario

Primary broker gagal setelah mengirim message ke consumer, sebelum ack tersimpan/terreplicate.

### Risk

Backup broker redeliver message.

### Required design

Idempotent consumer tetap wajib walaupun memakai HA.

HA mengurangi downtime, bukan menghapus duplicate semantics.

---

## 40. Scenario 35 — Clock Skew Mengacaukan TTL, Timestamp, dan Audit Timeline

### Scenario

Node producer, broker, consumer, dan DB punya clock berbeda.

### Risk

- TTL/expiration tidak sesuai ekspektasi,
- audit timeline membingungkan,
- latency calculation salah,
- SLA measurement salah.

### Prevention

- NTP/clock sync,
- record timestamps dari beberapa source dengan jelas,
- avoid using local clock as sole ordering proof,
- use broker/server timestamps where appropriate,
- monotonic duration measurement dalam process.

---

## 41. Scenario 36 — Certificate atau Secret Expired

### Scenario

Broker TLS cert, client cert, password, token, atau keystore expired/rotated tidak benar.

### Risk

- producer cannot send,
- consumer disconnect,
- backlog,
- outage setelah restart,
- partial environment failure.

### Prevention

- expiry monitoring,
- secret rotation runbook,
- dual credential window,
- reload strategy,
- startup validation,
- pre-production certificate test.

---

## 42. Scenario 37 — Consumer Graceful Shutdown Gagal

### Scenario

Deployment rolling restart mematikan pod/JVM saat listener sedang memproses.

### Risk

- in-flight message rollback,
- duplicate processing,
- partial side effect,
- long shutdown,
- Kubernetes force kill.

### Design

- stop accepting new messages,
- wait in-flight complete,
- commit/ack safely,
- respect termination grace period,
- small enough prefetch,
- idempotent handler.

### Kubernetes note

Jika consumer memegang banyak prefetched messages dan termination grace kecil, shutdown hampir pasti menghasilkan redelivery burst.

---

## 43. Scenario 38 — Deployment Versi Producer dan Consumer Tidak Sinkron

### Scenario

Producer baru publish message format baru sebelum semua consumer support.

### Risk

- subset consumer gagal,
- topic durable subscription backlog,
- DLQ flood,
- rollback sulit karena message sudah beredar.

### Prevention

- compatibility-first deployment,
- feature flag for new message field/type,
- consumer-first rollout,
- versioned routing if needed,
- canary producer.

---

## 44. Scenario 39 — Replay Lama Mengaktifkan Logic Baru yang Tidak Cocok

### Scenario

Message lama direplay ke consumer versi baru. Logic baru menginterpretasi payload lama berbeda.

### Risk

- incorrect repair,
- duplicate side effect,
- wrong state transition,
- audit mismatch.

### Design

- message version aware handler,
- preserve original semantics,
- replay mode flag,
- dry-run replay,
- approval for historical replay,
- immutable payload/reference.

---

## 45. Scenario 40 — Downstream Mengalami Partial Success

### Scenario

Consumer memanggil external system. External system memproses request tetapi response timeout.

### Risk

Consumer tidak tahu apakah call berhasil. Retry bisa duplicate.

### Recovery design

- idempotency key,
- status query API,
- reconciliation job,
- external transaction reference,
- pending state.

### State model

```text
PENDING_EXTERNAL_SEND
EXTERNAL_SENT_UNKNOWN
EXTERNAL_CONFIRMED
EXTERNAL_FAILED_TERMINAL
```

Jangan paksa boolean `sent=true/false` jika realitasnya ada state unknown.

---

## 46. Scenario 41 — Database Deadlock dalam Consumer Paralel

### Scenario

Beberapa consumer update table/entity saling bersilangan dan DB deadlock.

### Risk

- rollback,
- redelivery,
- retry storm,
- duplicated side effect jika side effect dilakukan sebelum DB commit.

### Prevention

- deterministic lock ordering,
- short transactions,
- per-aggregate processing,
- optimistic locking with safe retry,
- avoid external call inside DB transaction.

---

## 47. Scenario 42 — Dedup Store Down

### Scenario

Consumer bergantung pada Redis/DB untuk dedup. Dedup store unavailable.

### Risk

Jika consumer tetap jalan:

- duplicate tidak terdeteksi.

Jika consumer berhenti:

- backlog naik.

### Design decision

Untuk critical side effect:

```text
Fail closed: jangan proses jika idempotency guard tidak tersedia.
```

Untuk low-risk notification:

```text
Fail open mungkin diterima, tetapi harus eksplisit.
```

### Required classification

Dedup dependency harus diklasifikasikan sebagai critical atau best-effort.

---

## 48. Scenario 43 — Audit Trail Gagal Ditulis

### Scenario

Business update sukses, tetapi audit trail insert gagal.

### Risk

Dalam regulated system, ini bisa menjadi violation walaupun state benar.

### Design options

1. Audit in same DB transaction as business state.
2. Outbox audit event with guaranteed relay.
3. Fail business operation if audit cannot be recorded.
4. Separate immutable append log.

### Invariant

```text
Untuk regulated action, audit is not optional side effect.
```

---

## 49. Scenario 44 — Monitoring Buta terhadap In-Flight Messages

### Scenario

Dashboard hanya menunjukkan queue depth, tetapi tidak menunjukkan messages yang sudah di-dispatch ke consumer/prefetch/in-flight.

### Risk

- queue terlihat kosong padahal consumer stuck,
- deployment terlihat aman padahal in-flight belum selesai,
- SLA latency salah.

### Required metrics

- queue depth,
- scheduled count,
- delivering/in-flight count,
- consumer count,
- oldest message age,
- processing duration,
- redelivery count,
- ack/commit failure.

---

## 50. Scenario 45 — Correlation ID Hilang di Async Boundary

### Scenario

HTTP request menghasilkan JMS message, tetapi correlation id tidak dibawa.

### Risk

- tracing putus,
- incident timeline sulit,
- audit forensic lemah,
- support tidak bisa menjawab user.

### Design

Message envelope wajib punya:

```json
{
  "messageId": "...",
  "correlationId": "...",
  "causationId": "...",
  "businessKey": "...",
  "producer": "...",
  "createdAt": "..."
}
```

---

## 51. Scenario 46 — Tenant Leakage Saat Shared Topic/Queue

### Scenario

Beberapa tenant memakai broker/address yang sama. Selector atau property tenant salah.

### Risk

- tenant A menerima data tenant B,
- severe security incident.

### Prevention

- physical/logical isolation,
- ACL per tenant,
- tenant id in envelope,
- tenant validation in consumer,
- avoid relying solely on selector,
- encryption key per tenant jika perlu.

---

## 52. Scenario 47 — Message Expiry/DLQ Policy Salah di Environment Production

### Scenario

Dev/test config terbawa ke production: max redelivery terlalu kecil, TTL terlalu pendek, DLQ tidak ada.

### Risk

- message hilang cepat,
- critical workflow tidak recoverable,
- DLQ tidak bisa dianalisis.

### Prevention

- config review checklist,
- environment diff tool,
- automated broker config test,
- production safety defaults,
- change approval for queue policies.

---

## 53. Scenario 48 — Replay Batch Terlalu Besar Membanjiri Sistem

### Scenario

Operator replay 1 juta DLQ messages sekaligus.

### Risk

- database spike,
- downstream overload,
- duplicate storm,
- normal traffic starvation,
- broker pressure.

### Safe replay design

- batch size limit,
- rate limit,
- dry run,
- progressive ramp,
- stop switch,
- monitor before/after,
- replay window outside peak.

---

## 54. Scenario 49 — Manual Payload Repair Mengubah Bukti Historis

### Scenario

Operator mengedit payload DLQ agar bisa diproses.

### Risk

- audit evidence rusak,
- original error hilang,
- legal trace tidak valid.

### Design

- original payload immutable,
- repaired payload as new version,
- reason and approver recorded,
- diff recorded,
- replay links to original message.

### Invariant

```text
Repair boleh membuat message baru, tetapi tidak boleh menghapus bukti message lama.
```

---

## 55. Scenario 50 — Consumer Menggunakan Non-Idempotent Random/Time Logic

### Scenario

Handler menghasilkan decision berbeda saat redelivery karena memakai current time/random tanpa menyimpan decision.

### Risk

- first attempt dan retry menghasilkan hasil berbeda,
- audit sulit,
- replay tidak deterministic.

### Better design

- decision time dari envelope atau DB,
- generated value disimpan sebelum side effect,
- random id dibuat sekali oleh producer/outbox,
- replay uses persisted decision.

---

## 56. Scenario 51 — Request/Reply Late Reply Setelah Caller Timeout

### Scenario

Caller mengirim request JMS dan menunggu reply 5 detik. Consumer memproses 20 detik dan mengirim reply setelah caller timeout.

### Risk

- reply orphan,
- pending store leak,
- duplicate retry request,
- inconsistent client experience.

### Design

- correlation id,
- pending request expiry,
- late reply handling,
- idempotent request id,
- reply DLQ/parking,
- prefer async status model untuk long-running operation.

---

## 57. Scenario 52 — Temporary Queue Hilang Saat Connection Mati

### Scenario

Request/reply menggunakan temporary queue. Connection requester mati sebelum reply dikirim.

### Risk

- reply tidak terkirim,
- consumer gagal send reply,
- request sudah diproses tetapi caller tidak tahu.

### Design

Untuk long-running/critical request, jangan bergantung pada temporary reply queue saja. Gunakan persistent reply destination atau status resource.

---

## 58. Scenario 53 — Broker Upgrade Mengubah Default Behavior

### Scenario

Provider upgrade mengubah default redelivery, prefetch/window, routing, security, persistence, atau compatibility.

### Risk

- latency berubah,
- duplicate spike,
- selector behavior berbeda,
- client incompatibility,
- operational surprise.

### Prevention

- versioned broker config,
- staging load test,
- compatibility matrix,
- explicit config instead of relying on defaults,
- rollback plan.

---

## 59. Scenario 54 — Application Uses JMSMessageID as Business Identity

### Scenario

Consumer dedup atau audit memakai `JMSMessageID` sebagai business event id.

### Risk

- retry from outbox may create new JMSMessageID,
- replay may create new JMSMessageID,
- provider migration changes format,
- logical duplicate not detected.

### Better design

Use application-level IDs:

```text
eventId
commandId
operationId
aggregateId + version
```

`JMSMessageID` tetap berguna untuk transport diagnostics, bukan primary business identity.

---

## 60. Scenario 55 — Listener Catches Exception and Still Acks

### Scenario

Listener menangkap semua exception, log error, lalu return normal. Container menganggap sukses dan ack/commit.

### Anti-pattern

```java
@JmsListener(destination = "case.command")
public void onMessage(String payload) {
    try {
        handle(payload);
    } catch (Exception e) {
        log.error("failed", e);
    }
}
```

### Risk

Message hilang secara efektif.

### Better pattern

- classify failure,
- for retryable failure: throw exception/rollback,
- for permanent failure: explicitly publish to DLQ/parking with reason,
- record terminal failure.

---

## 61. Scenario 56 — Error Handler Mengirim ke DLQ tapi Original Session Tetap Commit Salah

### Scenario

Custom error handler mencoba publish failure event/DLQ manual, tetapi session original tetap ack/commit tanpa memastikan failure record durable.

### Risk

Original message hilang, failure record mungkin gagal.

### Design

Pastikan terminal failure path transactional/durable:

```text
Either message is not acked and broker handles DLQ,
or failure record + parking action is committed before ack.
```

---

## 62. Scenario 57 — Database Rollback Tapi External Email Sudah Terkirim

### Scenario

Handler mengirim email di tengah DB transaction. Setelah itu DB transaction rollback.

### Risk

User menerima email untuk aksi yang tidak terjadi.

### Better design

- commit DB first with outbox notification,
- notification worker sends after committed fact,
- email idempotency key,
- notification status table.

---

## 63. Scenario 58 — Consumer Scaling Membuat Downstream Rate Limit Terlampaui

### Scenario

Queue backlog tinggi. Tim scale consumer dari 4 ke 40. Downstream API rate limit 300/min.

### Risk

- 429 flood,
- retry storm,
- downstream blocklist,
- processing latency buruk.

### Design

- global rate limiter,
- worker pool bound by downstream capacity,
- token bucket,
- per-tenant throttling,
- queue partition by workload.

Scaling consumer bukan selalu solusi jika bottleneck downstream.

---

## 64. Scenario 59 — Queue Depth Normal tapi Oldest Message Age Tinggi

### Scenario

Queue depth tidak besar, tetapi satu message sangat tua.

### Risk

- stuck message,
- selector mismatch,
- poison message loop,
- starvation,
- business SLA breached.

### Monitoring rule

Jangan hanya alert berdasarkan queue depth. Alert juga berdasarkan:

```text
oldestMessageAge > SLA threshold
```

---

## 65. Scenario 60 — Message Handler Tidak Punya Terminal State

### Scenario

Message gagal terus, tapi sistem hanya punya status `PENDING` dan `SUCCESS`.

### Risk

- stuck forever,
- operator tidak tahu apakah masih diproses atau gagal,
- retry tak terbatas.

### Better state model

```text
PENDING
PROCESSING
RETRY_SCHEDULED
FAILED_RETRYABLE
FAILED_TERMINAL
PARKED
REPLAY_REQUESTED
REPLAYED
SUCCESS
```

Tidak semua sistem perlu semua state, tetapi production workflow butuh terminal failure state yang eksplisit.

---

## 66. Cross-Scenario Pattern: Failure Classification Matrix

Gunakan matrix berikut untuk menentukan action.

| Failure Type | Example | Retry? | DLQ/Park? | Manual? | Notes |
|---|---|---:|---:|---:|---|
| Transient dependency | DB timeout, HTTP 503 | Yes | After max attempts | Sometimes | Backoff + jitter |
| Permanent contract | Missing required field | No or very limited | Yes | Yes | Needs producer/schema fix |
| Permanent business | Invalid state transition | No | Park | Often | May need business decision |
| Security | Unauthorized tenant | No | Secure quarantine | Yes | Incident path |
| Capacity | Consumer too slow | Not message retry issue | No | Ops | Scale/tune/throttle |
| Unknown | Unexpected exception | Limited | Yes | Yes | Investigate |
| External partial success | Timeout after side effect | Query/reconcile | Park if unknown | Often | Idempotency key required |
| Operator error | Wrong replay/config | No | Freeze | Yes | Change control |

---

## 67. Cross-Scenario Pattern: Safe Consumer Processing Skeleton

### 67.1 Conceptual flow

```text
receive message
extract envelope
validate message metadata
classify schema/version
start DB transaction
check idempotency/inbox
load aggregate state
validate state transition
apply local state change
record audit/outbox/side-effect intent
commit DB transaction
ack/commit JMS session
```

### 67.2 Java-style pseudocode

```java
public final class SafeMessageHandler {

    private final InboxRepository inbox;
    private final ApplicationRepository applications;
    private final AuditRepository audit;
    private final OutboxRepository outbox;
    private final TransactionTemplate tx;

    public void handle(Envelope envelope) {
        try {
            tx.executeWithoutResult(status -> {
                if (inbox.alreadyProcessed(envelope.messageKey(), "ApplicationCommandHandler")) {
                    return;
                }

                inbox.markProcessing(envelope.messageKey(), "ApplicationCommandHandler");

                validateEnvelope(envelope);

                Application app = applications.findForUpdate(envelope.businessKey());

                TransitionDecision decision = app.tryApply(envelope.command());
                if (decision.isNoOp()) {
                    inbox.markSuccess(envelope.messageKey(), "NO_OP_ALREADY_APPLIED");
                    return;
                }

                applications.save(app);

                audit.record(
                    envelope.correlationId(),
                    envelope.messageKey(),
                    app.id(),
                    decision.auditText()
                );

                for (DomainEvent event : decision.events()) {
                    outbox.insert(event);
                }

                inbox.markSuccess(envelope.messageKey(), "SUCCESS");
            });
        } catch (PermanentContractException e) {
            // Depending on architecture: throw for broker DLQ or explicitly park.
            throw e;
        } catch (TransientDependencyException e) {
            // Let JMS transaction/session rollback so redelivery policy applies.
            throw e;
        }
    }
}
```

Important:

```text
The JMS listener/container should only ack/commit after this method completes successfully.
```

---

## 68. Cross-Scenario Pattern: Safe DLQ/Parking Envelope

Ketika message masuk DLQ/parking lot, jangan hanya simpan payload. Simpan konteks.

```json
{
  "failureId": "fail-2026-000001",
  "originalMessageKey": "cmd-123",
  "jmsMessageId": "ID:broker-generated-id",
  "correlationId": "corr-789",
  "businessKey": "APP-2026-0001",
  "sourceDestination": "application.command.approve",
  "failureClass": "PERMANENT_CONTRACT",
  "failureReasonCode": "UNKNOWN_SCHEMA_VERSION",
  "failureMessage": "schemaVersion=4 is not supported by consumer version 2.7.1",
  "deliveryCount": 5,
  "firstFailureAt": "2026-06-18T10:00:00Z",
  "lastFailureAt": "2026-06-18T10:05:00Z",
  "consumerName": "application-command-consumer",
  "consumerVersion": "2.7.1",
  "payloadHash": "sha256:...",
  "payloadReference": "secure://message-archive/...",
  "repairStatus": "PENDING_ANALYSIS"
}
```

---

## 69. Cross-Scenario Pattern: Replay Governance

Replay harus dianggap sebagai operasi produksi berisiko, bukan sekadar “kirim ulang”.

### 69.1 Replay states

```text
PARKED
ANALYSIS_IN_PROGRESS
ROOT_CAUSE_FIXED
REPLAY_APPROVED
REPLAY_SCHEDULED
REPLAYING
REPLAY_SUCCEEDED
REPLAY_FAILED
CANCELLED
```

### 69.2 Replay checklist

```text
[ ] Root cause identified
[ ] Fix deployed or data repaired
[ ] Message payload/version understood
[ ] Current business state checked
[ ] Idempotency verified
[ ] Replay batch size defined
[ ] Rate limit defined
[ ] Monitoring dashboard open
[ ] Rollback/stop condition defined
[ ] Approval recorded
[ ] Audit trail enabled
```

### 69.3 Replay stop conditions

Stop replay if:

- error rate exceeds threshold,
- DLQ grows again,
- downstream latency spikes,
- DB CPU/lock wait exceeds safe limit,
- duplicate side effect detected,
- unexpected schema error appears,
- operator cannot explain outcome.

---

## 70. Cross-Scenario Pattern: Observability Minimum Set

For each critical JMS flow, collect at least:

### Broker metrics

- queue depth,
- enqueue rate,
- dequeue rate,
- consumer count,
- delivering/in-flight count,
- scheduled count,
- expired count,
- DLQ count,
- oldest message age,
- redelivery count,
- disk/journal usage.

### Application metrics

- handler processing duration,
- success/failure count by failure class,
- retry count,
- idempotent duplicate skip count,
- external dependency latency,
- DB transaction latency,
- outbox pending count,
- inbox duplicate count.

### Logs

Every critical handler log should include:

```text
correlationId
messageKey
jmsMessageId
businessKey
destination
attempt/deliveryCount
handlerName
handlerVersion
result
failureClass
```

### Audit

For regulated systems:

```text
who/what initiated
what message was produced
what consumer processed
what business entity changed
before/after state if applicable
when committed
who replayed/repaired if manual
why replay/repair was approved
```

---

## 71. Cross-Scenario Pattern: Failure Budget Thinking

Tidak semua flow butuh perlindungan yang sama.

### 71.1 Criticality classes

| Class | Example | Loss Tolerance | Duplicate Tolerance | Recovery |
|---|---|---:|---:|---|
| Critical legal state | approval, enforcement action | Near zero | Must be idempotent | Manual + audited |
| Financial/charge | payment, invoice | Near zero | Must prevent duplicate | Reconciliation |
| User notification | email, SMS | Some | Usually acceptable if limited | Retry + suppress duplicate |
| Cache/search projection | read model update | Some | Idempotent rebuild | Replay/rebuild |
| Analytics event | metrics clickstream | Higher | Often acceptable | Batch reconciliation |

### 71.2 Design implication

Critical legal workflow:

```text
DB transaction + audit + outbox + inbox + DLQ governance + replay approval
```

Low-risk notification:

```text
bounded retry + dedup key + DLQ summary may be enough
```

Top-tier engineer tidak over-engineer semua flow. Mereka menyesuaikan protection dengan criticality.

---

## 72. Failure Review: Cara Membaca Incident JMS

Saat incident terjadi, jangan langsung restart semua.

Gunakan urutan investigasi:

1. Apa symptom utama?
   - backlog?
   - DLQ spike?
   - duplicate side effect?
   - missing event?
   - latency?

2. Kapan mulai?
   - deploy?
   - broker restart?
   - DB maintenance?
   - certificate rotation?
   - traffic spike?

3. Di mana failure window?
   - before broker accept?
   - after broker accept before producer knows?
   - after receive before DB commit?
   - after DB commit before ack?
   - after external side effect before state record?

4. Apa message class terdampak?
   - command?
   - event?
   - reply?
   - notification?

5. Apa invariant yang mungkin dilanggar?
   - idempotency?
   - ordering?
   - audit?
   - tenant isolation?

6. Apa recovery paling aman?
   - pause consumers?
   - stop producers?
   - drain queue?
   - fix config?
   - replay limited batch?
   - compensate?

---

## 73. Production Runbook Skeleton

### 73.1 Backlog incident

```text
1. Check queue depth and oldest message age.
2. Check consumer count and processing rate.
3. Check recent deploy/config change.
4. Check dependency latency/errors.
5. Check redelivery/DLQ rate.
6. Identify top message types/business keys.
7. Decide: scale, throttle, pause, fix dependency, or split traffic.
8. Monitor recovery rate.
```

### 73.2 DLQ spike

```text
1. Freeze automatic replay.
2. Sample DLQ messages by failure reason.
3. Classify failure: contract, business, dependency, security, unknown.
4. Identify first occurrence time.
5. Link to deploy/config/traffic change.
6. Fix root cause.
7. Approve controlled replay.
8. Verify business outcomes.
```

### 73.3 Duplicate side effect incident

```text
1. Stop affected consumer if side effect is harmful.
2. Identify duplicate key dimension.
3. Check redelivery/failover/retry timeline.
4. Check idempotency guard behavior.
5. Reconcile affected records.
6. Patch handler/idempotency design.
7. Replay only after dedup protection verified.
```

### 73.4 Missing event incident

```text
1. Check producer DB state.
2. Check outbox if exists.
3. Check broker enqueue logs/metrics.
4. Check destination config.
5. Check consumer/DLQ.
6. If no outbox and send failed after DB commit, reconstruct event from DB carefully.
7. Publish repair event with audit trail.
```

---

## 74. Architecture Review Checklist untuk Failure Modeling JMS

Gunakan checklist ini saat review desain.

### Producer

```text
[ ] Apakah message identity stable?
[ ] Apakah event publish atomic dengan DB state change?
[ ] Apakah outbox diperlukan?
[ ] Apakah send timeout ambiguity aman?
[ ] Apakah producer retry bisa membuat duplicate logical event?
[ ] Apakah destination config validated at startup?
```

### Broker

```text
[ ] Apakah queue/topic policy explicit?
[ ] Apakah DLQ configured?
[ ] Apakah redelivery delay/max attempts sesuai failure class?
[ ] Apakah disk capacity cukup?
[ ] Apakah HA/failover tested?
[ ] Apakah ACL least privilege?
```

### Consumer

```text
[ ] Apakah handler idempotent?
[ ] Apakah ack terjadi setelah durable state aman?
[ ] Apakah permanent vs transient error dibedakan?
[ ] Apakah external side effect punya idempotency key?
[ ] Apakah DB transaction pendek dan aman?
[ ] Apakah shutdown graceful?
```

### Contract

```text
[ ] Apakah schema version jelas?
[ ] Apakah consumer tolerant terhadap additive fields?
[ ] Apakah unknown enum ditangani?
[ ] Apakah payload besar memakai claim check?
[ ] Apakah message properties untuk selector tested?
```

### Operations

```text
[ ] Apakah queue depth dan oldest age dimonitor?
[ ] Apakah DLQ punya owner?
[ ] Apakah replay governance ada?
[ ] Apakah audit trail mencatat manual repair/replay?
[ ] Apakah runbook tersedia?
[ ] Apakah failure injection pernah diuji?
```

---

## 75. Mental Model Top 1%: JMS Failure Is About Truth, Not Transport

Engineer yang belum matang sering bertanya:

```text
Apakah JMS akan mengirim message ini exactly once?
```

Engineer yang matang bertanya:

```text
Jika message ini dikirim nol kali, satu kali, dua kali, atau terlambat,
apa state bisnis saya tetap benar dan bisa dibuktikan?
```

Engineer yang sangat kuat bertanya lebih lanjut:

```text
Jika operator replay message ini 3 minggu kemudian setelah schema, data,
dan code berubah, apakah sistem masih bisa memprosesnya secara aman?
Jika tidak, apa governance-nya?
```

JMS adalah transport coordination mechanism. Truth tetap berada di:

- committed database state,
- immutable audit trail,
- durable outbox/inbox,
- idempotency constraints,
- schema contract,
- explicit state machine,
- dan recovery governance.

---

## 76. Latihan Mandiri

### Latihan 1 — Consumer crash window

Ambil flow berikut:

```text
Receive ApproveApplicationCommand
Update application status
Insert audit trail
Send email
Ack JMS
```

Tentukan semua failure window dan desain ulang agar:

- approval tidak duplicate,
- audit tidak hilang,
- email tidak salah kirim,
- redelivery aman.

### Latihan 2 — DLQ governance

Buat SOP untuk DLQ `case.command.dlq`:

- siapa owner,
- severity rule,
- failure classification,
- replay approval,
- payload repair rule,
- audit evidence.

### Latihan 3 — Replay safety

Ada 50.000 message `ApplicationScoredEvent` masuk DLQ karena consumer bug. Bug sudah diperbaiki. Desain replay plan yang membatasi risiko.

### Latihan 4 — Ordering failure

Dua message untuk entity sama diproses paralel:

```text
CaseEscalated(version=4)
CaseClosed(version=5)
```

`CaseClosed` sukses duluan, `CaseEscalated` redeliver belakangan. Bagaimana handler harus bertindak?

### Latihan 5 — External partial success

Consumer mengirim command ke external licensing system. Response timeout, tetapi external system mungkin sudah memproses. Buat state machine lokal dan reconciliation logic.

---

## 77. Ringkasan

Part ini membahas failure modeling JMS secara production-grade.

Inti pembelajaran:

1. Failure window lebih penting daripada happy path.
2. JMS tidak memberikan business correctness secara otomatis.
3. Ack, DB commit, external side effect, dan audit harus disejajarkan dengan hati-hati.
4. Duplicate dan redelivery adalah kondisi normal yang harus didesain, bukan surprise.
5. DLQ bukan akhir proses; DLQ adalah awal workflow recovery.
6. Replay harus governed, rate-limited, audited, dan idempotent.
7. Critical workflow membutuhkan outbox/inbox/audit/state machine, bukan sekadar retry.
8. Observability harus mampu menjelaskan message dari producer sampai terminal outcome.
9. Recovery harus aman secara teknis dan defensible secara bisnis/regulasi.
10. Top-tier engineer mendesain sistem berdasarkan failure, bukan hanya berdasarkan API.

---

## 78. Status Seri

Selesai: **Part 33 dari 35**.

Seri belum selesai.

Part berikutnya:

**Part 34 — Production Blueprint: Reference Architecture JMS untuk Sistem Enterprise Regulated Case Management**



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-032.md">⬅️ Part 32 — Enterprise Integration Patterns with JMS</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-034.md">Part 34 — Production Blueprint: Reference Architecture JMS untuk Sistem Enterprise Regulated Case Management ➡️</a>
</div>
