# learn-java-json-xml-soap-connectors-enterprise-integration-part-033

# Part 33 — JCA Transactions, Security & Reliability

> Seri: `learn-java-json-xml-soap-connectors-enterprise-integration`  
> Bagian: `33 dari 34`  
> Status seri: **belum selesai**  
> Berikutnya: **Part 34 — Integration Architecture Capstone**

---

## 0. Tujuan Bagian Ini

Pada part sebelumnya kita sudah membahas arsitektur inbound/outbound Jakarta Connectors/JCA:

- `ResourceAdapter`
- `ManagedConnectionFactory`
- `ManagedConnection`
- `ConnectionFactory`
- `Connection`
- `ActivationSpec`
- `MessageEndpointFactory`
- `MessageEndpoint`
- `WorkManager`
- deployment descriptor dan annotation

Part ini masuk ke level yang lebih sulit dan lebih dekat dengan production:

1. Bagaimana JCA mengelola transaksi.
2. Bedanya local transaction, XA transaction, dan no transaction.
3. Bagaimana credential/security propagation bekerja.
4. Bagaimana connection pooling bisa benar atau salah.
5. Bagaimana recovery dilakukan setelah crash.
6. Bagaimana inbound delivery menangani retry, duplicate, poison message, dan backpressure.
7. Bagaimana observability connector harus dirancang.
8. Bagaimana menentukan apakah sebuah integrasi pantas dibuat sebagai JCA resource adapter atau cukup client library biasa.

Target pemahaman setelah bagian ini:

- Kamu tidak hanya tahu class JCA, tetapi tahu **kontrak runtime** antara application server, transaction manager, security service, thread/work manager, dan EIS.
- Kamu bisa membaca bug JCA sebagai failure pada salah satu contract: connection, transaction, security, lifecycle, message inflow, atau recovery.
- Kamu bisa mendesain adapter yang tidak hanya “jalan di happy path”, tetapi stabil saat crash, timeout, duplicate delivery, pool exhaustion, credential expiry, dan EIS partial failure.

---

## 1. Mental Model Utama: JCA adalah Boundary antara Container dan Resource Manager

Banyak engineer melihat JCA sebagai “cara Java EE konek ke external system”. Itu benar, tetapi terlalu dangkal.

Mental model yang lebih tepat:

```text
Application Code
   |
   | uses logical connection / message endpoint
   v
Application Server / Container
   |
   | owns pooling, transactions, security, lifecycle, threading
   v
Resource Adapter
   |
   | translates container contracts into EIS protocol behavior
   v
Enterprise Information System / Resource Manager
```

JCA bukan sekadar wrapper SDK. JCA adalah **contract adapter**.

Artinya resource adapter harus menjawab pertanyaan seperti:

- Connection ini boleh dipakai ulang atau tidak?
- Connection ini mewakili credential siapa?
- Connection ini sedang ikut transaksi apa?
- Kalau transaksi rollback, apa yang harus dilakukan ke EIS?
- Kalau server crash setelah EIS prepare tapi sebelum commit, bagaimana recovery?
- Kalau inbound message gagal diproses, apakah message boleh dikirim ulang?
- Kalau endpoint overload, apakah adapter boleh terus menarik message?
- Kalau credential expired, apakah pool harus dibersihkan?
- Kalau EIS timeout, apakah logical connection rusak atau bisa dipakai lagi?

Inilah yang membedakan JCA dari client library biasa.

Client library biasa biasanya hanya berpikir:

```text
open connection -> call API -> close connection
```

JCA harus berpikir:

```text
allocate/match managed connection
associate logical handle
bind to security subject
enlist into transaction
execute under container-managed lifecycle
support pooling/reuse
support cleanup/destroy
support recovery semantics
support observability
```

---

## 2. System Contracts di JCA

Jakarta Connectors mendefinisikan arsitektur standar agar resource adapter bisa plug-in ke Jakarta EE server. Kontrak pentingnya mencakup:

| Contract | Pertanyaan yang Dijawab |
|---|---|
| Connection Management | Bagaimana koneksi dibuat, dipool, dicocokkan, dibersihkan, dan dihancurkan? |
| Transaction Management | Bagaimana resource ikut local transaction atau distributed/XA transaction? |
| Security Management | Bagaimana credential aplikasi/container diterjemahkan ke credential EIS? |
| Lifecycle Management | Bagaimana adapter start/stop dan release resource? |
| Work Management | Bagaimana adapter menjalankan background/inbound work secara container-managed? |
| Message Inflow | Bagaimana EIS mengirim event/message ke endpoint aplikasi? |
| Transaction Inflow | Bagaimana transaksi dari EIS bisa masuk ke container, jika didukung? |

Spesifikasi Jakarta Connectors menyatakan bahwa arsitektur ini mendefinisikan kontrak seperti transaction, security, dan connection management yang harus didukung resource adapter agar bisa plug-in ke application server.

---

## 3. Transaction Model: No Transaction, Local Transaction, XA Transaction

Dalam JCA, tidak semua resource adapter harus mendukung level transaksi yang sama. Secara mental, ada tiga mode besar.

### 3.1 No Transaction

No transaction berarti operation ke EIS tidak ikut transaksi container.

Contoh:

- query read-only ke legacy directory
- call ke API yang tidak punya rollback
- publish fire-and-forget ke endpoint yang tidak transaksional
- akses file/object store tanpa commit protocol

Flow:

```text
App method starts
  -> get connection
  -> call EIS
  -> EIS operation executes immediately
  -> app exception happens
  -> container rollback local DB transaction
  -> EIS side effect remains
```

Masalah utama:

- side effect tidak rollback
- duplicate handling harus manual
- idempotency wajib dipikirkan
- audit harus mencatat external call outcome

No transaction bukan berarti buruk. Banyak integrasi modern HTTP/REST juga no transaction. Yang berbahaya adalah berpura-pura seolah no-transaction call bisa rollback bersama database.

### 3.2 Local Transaction

Local transaction berarti resource adapter/EIS punya transaction boundary sendiri, tetapi tidak ikut two-phase commit global.

Contoh:

```text
begin local EIS transaction
  -> operation A
  -> operation B
commit local EIS transaction
```

Di JCA, local transaction biasanya diekspos melalui `jakarta.resource.spi.LocalTransaction`.

Local transaction cocok jika:

- hanya satu resource yang perlu atomic
- operasi database aplikasi tidak perlu atomic bersama EIS
- kompensasi diterima
- integrasi berjalan di boundary service sendiri

Local transaction tidak cukup jika kamu perlu atomicity seperti:

```text
insert application DB row
send transactionally to EIS
commit both or rollback both
```

Jika DB commit berhasil tapi EIS commit gagal, data diverge.

Jika EIS commit berhasil tapi DB rollback, external side effect menjadi orphan.

### 3.3 XA Transaction

XA transaction memungkinkan resource ikut distributed transaction/two-phase commit melalui `javax.transaction.xa.XAResource` atau pada Jakarta tetap memakai JTA/XA contract yang relevan.

Flow simplified:

```text
Business method starts under global transaction
  -> DB resource enlisted
  -> EIS managed connection enlisted
  -> app work executes
prepare phase:
  -> DB prepare
  -> EIS prepare
commit phase:
  -> DB commit
  -> EIS commit
```

Tujuan XA:

- atomic commit across multiple resource managers
- crash recovery after prepare
- transaction manager bisa menyelesaikan in-doubt transactions

Tetapi XA mahal dan kompleks:

- lebih banyak round trip
- lock lebih lama
- heuristic outcome mungkin terjadi
- recovery config harus benar
- resource manager harus benar-benar XA compliant
- timeout dan failure state lebih rumit

XA tidak boleh dipakai hanya karena “enterprise”. XA dipakai jika business invariant benar-benar membutuhkan atomicity lintas resource dan resource manager mendukungnya secara benar.

---

## 4. Decision Matrix: Kapan Pakai XA, Local, atau No Transaction

| Kondisi | Pilihan Umum | Alasan |
|---|---|---|
| Hanya read-only lookup | No transaction | Tidak ada side effect yang perlu rollback |
| Satu EIS, operasi atomic internal | Local transaction | EIS sendiri bisa menjaga atomicity |
| DB aplikasi + EIS harus atomic | XA, jika EIS reliable XA | Butuh global atomicity |
| EIS tidak mendukung XA | Outbox/saga/compensation | XA tidak bisa dipaksakan |
| Throughput sangat tinggi, failure bisa diretry idempotent | No transaction + idempotency | Lebih scalable daripada XA |
| Financial posting yang tidak boleh double/lost | XA atau strong idempotency ledger | Perlu invariant kuat |
| Legacy mainframe transaction monitor | XA atau vendor transaction bridge | Bergantung support EIS |
| Messaging inbound ke MDB | Container-managed transaction jika provider mendukung | Delivery + processing bisa satu transaksi |

Rule of thumb:

> Pilih transaksi berdasarkan invariant bisnis, bukan berdasarkan fitur teknis yang tersedia.

Jika invariant-nya:

```text
Either both internal DB and EIS update happen, or neither happens.
```

maka kamu butuh:

- XA yang benar-benar tested, atau
- desain ulang menjadi asynchronous outbox dengan reconciliation.

Jika invariant-nya:

```text
Internal state may commit first, external delivery can be retried safely.
```

maka outbox/idempotency sering lebih baik daripada XA.

---

## 5. Connection Management dan Transaction Enlistment

Connection pooling dalam JCA bukan hanya menyimpan socket.

Ada beberapa level:

```text
Application logical connection handle
   |
   v
ManagedConnection
   |
   v
Physical EIS connection/session/protocol channel
```

Application code biasanya menerima logical connection.

Container mengelola `ManagedConnection`.

Resource adapter mengelola physical connection ke EIS.

### 5.1 Logical Connection vs Managed Connection

Logical connection:

- object yang dilihat aplikasi
- bisa ditutup oleh aplikasi
- tidak selalu menutup physical connection
- bisa di-associate dengan managed connection berbeda

Managed connection:

- dimiliki container/pool
- mewakili physical connection
- punya lifecycle cleanup/destroy
- bisa menyediakan local transaction atau XA resource
- bisa mem-fire connection event

### 5.2 Transaction Enlistment

Saat aplikasi memakai connection di dalam transaksi, container perlu enlist resource.

Simplified flow:

```text
Application begins method under transaction
  -> app gets connection from ConnectionFactory
  -> container allocates/matches ManagedConnection
  -> container obtains XAResource or LocalTransaction
  -> container enlists resource into current transaction
  -> app uses connection
  -> app closes logical handle
  -> transaction commits/rolls back
  -> container delists resource
  -> managed connection returns to pool if clean
```

Resource adapter harus memastikan:

- XAResource mewakili physical transaction branch yang benar
- cleanup tidak menutup physical connection secara prematur
- logical handle tidak bisa dipakai setelah close
- connection error event dikirim jika connection rusak
- transaction state tidak bocor ke next borrower

---

## 6. Pooling Failure yang Sering Terjadi

### 6.1 Connection State Leakage

Ini salah satu bug paling berbahaya.

Contoh:

```text
User A borrows managed connection
  -> sets EIS schema/account/context = A
  -> closes logical connection
Managed connection returns to pool
User B borrows same managed connection
  -> EIS context still A
```

Akibat:

- data leakage
- authorization bypass
- audit salah user
- regulatory incident

Mitigasi:

- `cleanup()` harus reset semua mutable state
- jangan simpan user context di physical session kecuali resetable
- pool matching harus mempertimbangkan `Subject`/credential
- gunakan validation sebelum reuse
- destructive cleanup jika state tidak bisa direset

### 6.2 Transaction State Leakage

Contoh:

```text
Transaction T1 rolls back
ManagedConnection not fully reset
Next borrower sees uncommitted/locked/dirty session state
```

Mitigasi:

- cleanup after transaction completion
- delist properly
- rollback local transaction before return to pool
- mark connection invalid if rollback/commit status uncertain

### 6.3 Broken Connection Reused

Jika EIS connection timeout/network dropped, pool bisa mengembalikan connection mati ke aplikasi.

Mitigasi:

- connection validation
- exception classification
- `ConnectionEvent.CONNECTION_ERROR_OCCURRED`
- destroy invalid managed connection
- retry allocation only for safe operations

### 6.4 Pool Exhaustion

Pool exhaustion bukan hanya “kurang besar”. Sering root cause-nya:

- application tidak close logical handle
- transaction terlalu lama
- EIS latency naik
- thread pool lebih besar dari connection pool
- retry storm
- dead EIS membuat semua thread menunggu
- pool min/max tidak sesuai workload

Checklist:

```text
max_threads_that_can_call_EIS <= max_connections * safe_concurrency_factor
connection_acquire_timeout < request_timeout
EIS_call_timeout < transaction_timeout
transaction_timeout < user-visible SLA timeout
retry_budget is bounded
```

---

## 7. Security Management: Credential Propagation

Security di JCA menjawab pertanyaan:

> Connection ke EIS ini dibuat atas nama siapa dan dengan credential apa?

Ada beberapa model.

### 7.1 Container-Managed Sign-On

Application tidak memberikan username/password EIS secara langsung. Container melakukan mapping dari application principal ke EIS credential.

Flow:

```text
Application user/principal
  -> container security context
  -> credential mapping
  -> Subject / PasswordCredential
  -> ManagedConnectionFactory creates/matches connection
  -> EIS authenticates
```

Cocok untuk:

- enterprise environment
- credential centralized
- audit per user
- separation antara application code dan secret

Risiko:

- credential mapping salah
- pool matching tidak mempertimbangkan credential
- credential rotation tidak membersihkan pool lama
- user A mendapatkan connection authenticated sebagai user B

### 7.2 Component-Managed Sign-On

Application memberikan credential ke connection factory.

Contoh mental:

```java
ConnectionSpec spec = new CustomConnectionSpec(username, password, tenant);
Connection connection = factory.getConnection(spec);
```

Cocok jika:

- credential berasal dari request/user flow
- multi-tenant credential berbeda-beda
- EIS authorization harus exact per user

Risiko:

- secret leakage di app logs
- credential disimpan terlalu lama
- pooling menjadi kurang efektif karena pool terfragmentasi per credential
- audit lebih rumit

### 7.3 Application-Level Service Account

Semua koneksi memakai satu service account.

Cocok untuk:

- backend-to-backend integration
- EIS tidak support per-user auth
- aplikasi sendiri enforce authorization

Risiko:

- EIS audit hanya melihat service account
- privilege terlalu besar
- compromised app = broad EIS access
- user attribution harus dikirim sebagai metadata terpisah

### 7.4 Credential Propagation Matrix

| Model | Pooling | Audit EIS | Security Risk | Use Case |
|---|---:|---:|---|---|
| Service account | Tinggi | Lemah per user | blast radius besar | system integration |
| Container-managed per role | Medium | Role-level | mapping drift | enterprise auth mapping |
| Container-managed per user | Rendah/Medium | Kuat | pool fragmentation | regulated per-user access |
| Component-managed | Variatif | Kuat jika benar | secret leakage | special tenant/user credential |

---

## 8. Transaction + Security Interactions

Security dan transaction tidak independen.

Contoh bug:

```text
Transaction starts under user A
Connection borrowed using credential A
Async work attempts to reuse context but runs without user A Subject
Resource adapter creates connection using default service account
Transaction writes partially under different identity
```

Hal yang harus dipastikan:

- apakah security context tersedia di thread yang memakai connection?
- apakah work dijalankan via container `WorkManager`, bukan raw thread?
- apakah transaction context ikut dipropagasi?
- apakah credential dipilih saat connection allocation atau saat physical call?
- apakah credential berubah selama transaction?

Prinsip:

> Identity yang digunakan untuk authorization, audit, dan transaction attribution harus eksplisit dan stabil sepanjang unit of work.

---

## 9. XA Recovery Mental Model

XA recovery adalah area yang sering diabaikan saat development tetapi menjadi penentu saat production crash.

### 9.1 Two-Phase Commit Problem

Distributed transaction punya fase:

1. Prepare
2. Commit/Rollback

Failure berbahaya terjadi setelah prepare berhasil, tetapi sebelum commit diketahui semua pihak.

```text
Transaction Manager
  -> DB prepare OK
  -> EIS prepare OK
  -> server crashes before commit messages complete
```

Setelah restart, transaction manager harus bertanya ke resource manager:

```text
Which transaction branches are in-doubt?
```

Resource manager mengembalikan XID yang perlu diselesaikan.

### 9.2 Apa yang Harus Didukung Resource Adapter

Resource adapter XA harus menyediakan:

- stable `XAResource`
- recoverable identity/resource manager id
- `recover()` yang mengembalikan in-doubt XID
- commit/rollback by XID
- correct handling duplicate commit/rollback calls
- no loss of prepared transaction state

### 9.3 Recovery Failure Patterns

| Failure | Gejala | Dampak |
|---|---|---|
| XAResource identity berubah setelah restart | TM tidak mengenali resource | in-doubt transaction menggantung |
| `recover()` tidak mengembalikan XID | prepared work tidak diselesaikan | lock/resource stuck |
| credential recovery salah | recovery tidak bisa login ke EIS | manual repair needed |
| duplicate commit tidak idempotent | second commit error fatal | heuristic confusion |
| timeout terlalu pendek | recovery loop gagal | repeated warnings, stuck tx |

### 9.4 Recovery Readiness Checklist

Sebelum mengklaim adapter mendukung XA, uji skenario:

```text
1. Crash before prepare
2. Crash after one resource prepared
3. Crash after all resources prepared before commit
4. Crash after one commit succeeds before second commit
5. Restart with same config
6. Restart with changed credentials
7. EIS unavailable during recovery
8. EIS returns duplicate/in-doubt XID
9. Transaction timeout during prepare
10. Network partition between TM and EIS
```

Jika tidak diuji, XA support hanya klaim.

---

## 10. Inbound Reliability: Delivery, Retry, Duplicate, Poison Message

Pada inbound JCA, EIS/message provider mengirim event/message ke application endpoint.

Simplified:

```text
EIS / message provider
  -> ResourceAdapter inbound listener
  -> WorkManager schedules delivery work
  -> MessageEndpointFactory creates endpoint
  -> endpoint method invoked
  -> transaction commit/rollback determines ack/redelivery behavior
```

### 10.1 Delivery is Not Exactly Once

Banyak sistem berharap inbound processing exactly-once.

Realitas distributed systems:

- message bisa dikirim ulang
- endpoint bisa crash setelah side effect tapi sebelum ack
- ack bisa hilang
- commit outcome bisa tidak diketahui
- provider bisa redeliver setelah timeout

Maka mental model yang aman:

> Inbound processing harus siap menerima at-least-once delivery kecuali ada bukti kuat end-to-end exactly-once, dan bukti itu jarang ada.

### 10.2 Idempotency Key

Setiap inbound message harus punya identity stabil:

- message id dari EIS
- transaction id
- event id
- business document id + version
- sequence id per source

Pattern:

```sql
CREATE TABLE processed_inbound_message (
    source_system        VARCHAR(100) NOT NULL,
    message_id           VARCHAR(200) NOT NULL,
    processed_at         TIMESTAMP NOT NULL,
    status               VARCHAR(30) NOT NULL,
    business_key         VARCHAR(200),
    payload_hash         VARCHAR(128),
    PRIMARY KEY (source_system, message_id)
);
```

Processing:

```text
receive message
  -> begin transaction
  -> insert idempotency row
     - success: first time, process
     - duplicate key: already processed, ack safely
  -> perform business updates
  -> commit
```

Jika message duplicate datang:

```text
duplicate detected -> do not repeat side effect -> ack or mark handled
```

### 10.3 Poison Message

Poison message adalah message yang selalu gagal diproses.

Penyebab:

- schema invalid
- referential data missing
- unsupported enum
- business rule impossible
- payload corrupted
- bug deterministic di aplikasi

Tanpa poison strategy:

```text
message fails -> rollback -> redeliver -> fails -> rollback -> redeliver forever
```

Akibat:

- queue stuck
- thread pool penuh
- log storm
- downstream starvation
- transaction rollback terus-menerus

Strategi:

| Strategy | Cocok Untuk | Risiko |
|---|---|---|
| Max redelivery then DLQ | deterministic failure | perlu DLQ handling |
| Quarantine table | regulated workflow | perlu operational process |
| Skip with audit | non-critical event | data loss jika salah klasifikasi |
| Manual repair + replay | critical data | butuh tooling |
| Exponential backoff | transient failure | poison tetap akan kembali |

### 10.4 Retry Taxonomy

Tidak semua error boleh diretry.

| Error | Retry? | Catatan |
|---|---|---|
| EIS timeout | Ya, bounded | Pastikan idempotent |
| Temporary DB deadlock | Ya | dengan jitter/backoff |
| Invalid schema | Tidak | DLQ/quarantine |
| Unknown required reference | Kadang | bisa pending sampai master data datang |
| Authorization denied | Tidak sampai config fixed | retry storm berbahaya |
| Duplicate message | Tidak proses ulang | ack as duplicate |
| Transaction heuristic | Jangan blind retry | butuh reconciliation |

---

## 11. Backpressure di Resource Adapter

Backpressure berarti adapter tidak mengambil/mengirim work lebih cepat dari kapasitas downstream.

Inbound adapter yang buruk:

```text
while (true) {
  message = eis.receive();
  new Thread(() -> deliver(message)).start();
}
```

Masalah:

- bypass container thread management
- unbounded concurrency
- memory growth
- transaction storm
- downstream DB overload
- no coordinated shutdown

JCA menyediakan WorkManager agar adapter menyerahkan work ke container.

Mental flow aman:

```text
Adapter polls/receives message
  -> checks available capacity
  -> submits Work to WorkManager
  -> Work invokes endpoint under container contract
  -> ack/commit only after processing outcome known
```

Backpressure controls:

- max active deliveries per activation
- max work submissions
- bounded internal queue
- slow polling when endpoint backlog high
- pause/resume activation
- circuit breaker when downstream degraded
- redelivery delay for transient failure
- dead-letter/quarantine for deterministic failure

### 11.1 Capacity Equation

Untuk inbound connector:

```text
safe_inbound_concurrency <= min(
    endpoint_pool_size,
    database_connection_pool_capacity_for_this_flow,
    EIS_session_capacity,
    transaction_manager_capacity,
    CPU_capacity,
    external_downstream_rate_limit
)
```

Jika `endpoint_pool_size = 50`, tetapi DB pool hanya punya 10 koneksi untuk flow ini, concurrency efektif harus sekitar 10 atau kurang.

Jika tidak, hasilnya bukan throughput naik, tetapi waiting, timeout, rollback, dan redelivery storm.

---

## 12. Timeout Layering

Timeout yang salah adalah sumber kegagalan integrasi.

Layer umum:

```text
User/request timeout
  > transaction timeout
      > connection acquire timeout
      > EIS operation timeout
      > socket/read timeout
      > retry delay/budget
```

Namun ordering-nya harus masuk akal.

Contoh buruk:

```text
HTTP request timeout:        30s
JTA transaction timeout:     300s
EIS socket timeout:          infinite
Connection acquire timeout:  120s
```

Akibat:

- user sudah timeout tapi transaction masih jalan
- thread masih tertahan
- pool penuh
- side effect bisa commit setelah caller mengira gagal

Contoh lebih sehat:

```text
HTTP request timeout:        30s
JTA transaction timeout:     25s
Connection acquire timeout:  2s
EIS operation timeout:       5s
Retry budget:                <= 15s total
```

Untuk batch/inbound, timeout bisa lebih panjang, tetapi tetap eksplisit.

Rule:

> Tidak boleh ada timeout infinite pada resource boundary production kecuali sangat disengaja dan diawasi.

---

## 13. Error Classification dalam Resource Adapter

Resource adapter harus bisa membedakan error.

### 13.1 Recoverable vs Fatal Connection Error

Recoverable:

- temporary timeout
- transient network blip
- EIS busy

Fatal:

- protocol desynchronization
- authentication invalid
- session corrupted
- connection reset during transaction uncertain state

Jika fatal, adapter harus memberi sinyal ke container bahwa managed connection rusak.

Konsepnya:

```text
Connection error occurred
  -> fire connection error event
  -> container removes from pool
  -> physical connection destroyed
```

### 13.2 Application Error vs System Error

Application error:

- business validation failed
- unsupported status transition
- duplicate business key

System error:

- network failure
- authentication failure
- timeout
- transaction manager failure
- protocol error

Kenapa penting?

- application error sering tidak perlu retry
- system error mungkin perlu retry atau rollback
- poison detection bergantung klasifikasi
- monitoring harus membedakan bad payload vs broken system

---

## 14. Observability untuk JCA

Resource adapter tanpa observability adalah black box.

Minimal metrics:

### 14.1 Connection Metrics

- active managed connections
- idle managed connections
- max pool size
- connection allocation count
- allocation wait time
- allocation timeout count
- connection validation failure
- destroyed connection count
- connection error events

### 14.2 Transaction Metrics

- local transaction begin/commit/rollback count
- XA start/end/prepare/commit/rollback count
- transaction timeout count
- in-doubt transaction count
- recovery attempt count
- recovery success/failure
- heuristic outcome count

### 14.3 Inbound Metrics

- messages received
- messages delivered
- message processing latency
- redelivery count
- DLQ/quarantine count
- duplicate detected count
- poison message count
- active endpoint deliveries
- backlog/lag if available

### 14.4 Security Metrics

- authentication failure count
- credential mapping failure
- credential expiry/rotation events
- per-principal or per-tenant connection usage
- authorization denied by EIS

### 14.5 Operational Logs

Log harus mengandung:

- correlation id
- source system
- message id / transaction id
- activation name
- endpoint name
- connection factory name
- transaction id/XID where safe
- principal/tenant, jika boleh secara security policy
- error classification
- retry count
- final outcome

Jangan log:

- password/token
- raw credential
- full PII payload
- private key/certificate material
- huge XML/JSON binary attachment

---

## 15. Audit dan Regulatory Defensibility

Untuk sistem regulated, connector harus bisa menjawab:

1. Data/event apa yang diterima?
2. Dari source mana?
3. Pada waktu kapan?
4. Diproses oleh versi adapter mana?
5. Diproses dengan credential/principal apa?
6. Menghasilkan side effect apa?
7. Commit/rollback outcome apa?
8. Jika gagal, diklasifikasikan sebagai apa?
9. Apakah diretry?
10. Apakah duplicate?
11. Apakah masuk quarantine/DLQ?
12. Siapa/manual process apa yang memperbaiki?

Audit bukan hanya log. Audit perlu struktur.

Contoh event audit:

```json
{
  "eventType": "JCA_INBOUND_DELIVERY_COMPLETED",
  "sourceSystem": "LEGACY_EIS_A",
  "activation": "case-status-inbound",
  "messageId": "EIS-2026-00001234",
  "businessKey": "CASE-2026-009991",
  "correlationId": "corr-9f2a...",
  "deliveryAttempt": 2,
  "duplicate": false,
  "transactionOutcome": "COMMITTED",
  "processingLatencyMs": 482,
  "adapterVersion": "1.14.2",
  "schemaVersion": "case-status-v3",
  "outcome": "SUCCESS"
}
```

Untuk failure:

```json
{
  "eventType": "JCA_INBOUND_DELIVERY_FAILED",
  "sourceSystem": "LEGACY_EIS_A",
  "messageId": "EIS-2026-00001235",
  "businessKey": "CASE-2026-009992",
  "errorClass": "BUSINESS_VALIDATION",
  "retryable": false,
  "quarantineId": "Q-2026-000088",
  "transactionOutcome": "ROLLED_BACK",
  "adapterVersion": "1.14.2"
}
```

---

## 16. Reliability Pattern: Outbound Request with Idempotency Ledger

Outbound JCA call ke EIS sering no-XA atau local transaction. Untuk menjaga reliability, gunakan idempotency ledger.

### 16.1 Table Design

```sql
CREATE TABLE outbound_eis_request (
    request_id          VARCHAR(100) PRIMARY KEY,
    business_key        VARCHAR(200) NOT NULL,
    eis_operation       VARCHAR(100) NOT NULL,
    payload_hash        VARCHAR(128) NOT NULL,
    status              VARCHAR(30) NOT NULL,
    attempt_count       INTEGER NOT NULL,
    next_attempt_at     TIMESTAMP,
    last_error_code     VARCHAR(100),
    last_error_message  VARCHAR(1000),
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL
);
```

Statuses:

```text
NEW -> IN_PROGRESS -> SUCCEEDED
NEW -> IN_PROGRESS -> RETRYABLE_FAILED -> IN_PROGRESS
NEW -> IN_PROGRESS -> PERMANENT_FAILED
IN_PROGRESS -> UNKNOWN_OUTCOME -> RECONCILED_SUCCEEDED/RECONCILED_FAILED
```

### 16.2 Unknown Outcome

Unknown outcome adalah kondisi paling penting.

Contoh:

```text
App sends request to EIS
EIS processes successfully
Network fails before response reaches app
App sees timeout
```

App tidak tahu apakah EIS melakukan side effect.

Jangan langsung retry tanpa idempotency key.

Strategi:

- gunakan request id yang dikirim ke EIS
- EIS harus deduplicate berdasarkan request id, jika bisa
- jika tidak bisa, lakukan status inquiry/reconciliation
- tandai `UNKNOWN_OUTCOME`
- jangan generate side effect baru sampai outcome jelas

---

## 17. Reliability Pattern: Inbound Idempotent Consumer

Inbound dari EIS/message provider:

```text
receive -> validate -> deduplicate -> process -> commit -> ack
```

Pseudo-code konseptual:

```java
public void onMessage(InboundMessage message) {
    String messageId = message.getMessageId();

    transactionTemplate.execute(() -> {
        boolean firstTime = processedMessageRepository.tryInsert(
            message.getSourceSystem(),
            messageId,
            hash(message.getPayload())
        );

        if (!firstTime) {
            audit.duplicate(messageId);
            return;
        }

        BusinessCommand command = mapper.toCommand(message);
        domainService.handle(command);
        audit.success(messageId);
    });
}
```

Catatan:

- dedup insert dan business update harus satu transaksi lokal DB
- jika crash sebelum commit, message bisa redeliver dan diproses lagi
- jika commit sukses tapi ack gagal, redelivery akan dianggap duplicate
- ini membuat at-least-once delivery menjadi effectively-once pada domain boundary

---

## 18. Reliability Pattern: Quarantine Instead of Infinite Rollback

Untuk payload invalid:

```text
receive message
  -> parse OK?
     no -> store quarantine + ack/consume depending provider semantics
  -> validate contract OK?
     no -> quarantine
  -> business process
```

Quarantine table:

```sql
CREATE TABLE inbound_quarantine (
    quarantine_id       VARCHAR(100) PRIMARY KEY,
    source_system       VARCHAR(100) NOT NULL,
    message_id          VARCHAR(200),
    business_key        VARCHAR(200),
    reason_code         VARCHAR(100) NOT NULL,
    reason_detail       VARCHAR(2000),
    payload_location    VARCHAR(500),
    payload_hash        VARCHAR(128),
    status              VARCHAR(30) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    resolved_at         TIMESTAMP,
    resolved_by         VARCHAR(100)
);
```

Mengapa payload_location bukan raw payload?

- payload bisa besar
- payload bisa mengandung PII
- payload bisa perlu encryption/retention policy
- audit DB tidak boleh menjadi dumping ground uncontrolled data

---

## 19. Security Pattern: Credential Rotation without Incident

Credential rotation pada connector sering menyebabkan outage jika pool tidak dikelola.

Problem:

```text
Credential changed in secret store
Existing pooled physical connections still authenticated with old credential
New connections use new credential
Some calls succeed, some fail
Recovery uses old credential
```

Pattern:

1. Version credential.
2. Detect rotation event.
3. Stop new allocation with old credential.
4. Drain old pool.
5. Destroy old idle connections.
6. Let active transactions complete if safe.
7. Force recreate recovery connection with new credential.
8. Emit audit/security event.

Operational metrics:

- active connections by credential version
- auth failures after rotation
- old credential pool drain duration
- recovery credential status

---

## 20. Security Pattern: Least Privilege for Service Account

Jika adapter memakai service account, jangan beri akses luas tanpa batas.

Checklist:

```text
[ ] service account dedicated per application/integration
[ ] no shared account across unrelated systems
[ ] read/write permission separated where possible
[ ] operation-level authorization in EIS
[ ] source IP/network restriction
[ ] certificate/token rotation policy
[ ] audit includes application correlation id
[ ] emergency disable procedure exists
[ ] credential stored in managed secret store
[ ] adapter never logs secret
```

Jika EIS hanya mendukung satu superuser credential, compensating controls wajib:

- network allowlist
- application-side authorization
- strong audit
- anomaly detection
- limited endpoint exposure
- manual review for high-risk operations

---

## 21. Threading: Jangan Buat Thread Sendiri Sembarangan

Di Jakarta EE/JCA, resource adapter seharusnya memakai container-provided `WorkManager` untuk asynchronous work.

Anti-pattern:

```java
new Thread(() -> pollForever()).start();
```

Masalah:

- container tidak tahu lifecycle thread
- shutdown tidak rapi
- security context tidak jelas
- transaction context tidak managed
- metrics tidak terintegrasi
- thread leak saat redeploy
- classloader leak

Lebih benar:

```text
ResourceAdapter.start(BootstrapContext ctx)
  -> obtain WorkManager
  -> submit Work
  -> Work polls/receives under container-managed execution
ResourceAdapter.stop()
  -> signal stop
  -> wait/drain
  -> release EIS resources
```

---

## 22. Shutdown Semantics

Shutdown sering dilupakan.

Saat application server stop/redeploy:

Resource adapter harus:

- stop accepting new inbound work
- stop polling EIS
- wait for active delivery or cancel safely
- avoid ack before commit
- rollback incomplete local transaction
- release physical resources
- close sockets/sessions
- unregister listeners
- prevent classloader leaks

Shutdown state machine:

```text
RUNNING
  -> STOPPING
       - pause inbound receive
       - reject new work
       - drain active work until timeout
       - rollback/cancel unfinished work
       - close EIS resources
  -> STOPPED
```

Jika shutdown langsung kill tanpa drain, redelivery/idempotency harus menangani duplicate.

---

## 23. Testing Strategy untuk JCA Reliability

Testing JCA tidak cukup unit test.

### 23.1 Contract Tests

Uji interface contract:

- `ManagedConnectionFactory.matchManagedConnections`
- `ManagedConnection.cleanup`
- `ManagedConnection.destroy`
- connection event listener
- local transaction begin/commit/rollback
- XA resource start/end/prepare/commit/rollback/recover
- ActivationSpec validation

### 23.2 Pooling Tests

Skenario:

```text
borrow -> set context -> close -> borrow as different user -> ensure context reset
borrow -> physical error -> return -> ensure not reused
borrow many -> ensure pool max respected
borrow without close -> detect leak
credential A and B -> ensure pool match does not cross credentials
```

### 23.3 Transaction Tests

Skenario:

```text
commit success
rollback success
exception before EIS call
exception after EIS call before commit
timeout during call
timeout during prepare
crash after prepare
duplicate commit call
recovery with EIS unavailable
```

### 23.4 Inbound Tests

Skenario:

```text
message success -> ack/commit
business failure -> rollback/redelivery or quarantine
schema failure -> DLQ/quarantine
endpoint throws after partial update -> rollback
duplicate delivery -> no duplicate side effect
poison message -> stops after max attempts
backpressure -> does not exceed configured concurrency
shutdown during delivery -> safe outcome
```

### 23.5 Chaos/Failure Tests

- kill application server mid-transaction
- kill EIS connection
- delay EIS response
- corrupt payload
- expire credential
- rotate credential while active calls run
- fill DB pool
- slow transaction manager
- network partition
- replay old message

---

## 24. Common Anti-Patterns

### 24.1 Treating JCA as Mere SDK Wrapper

Jika adapter hanya membungkus SDK tanpa connection/transaction/security semantics, maka JCA overhead tidak memberi manfaat.

### 24.2 Claiming XA without Recovery

XA tanpa recovery testing lebih berbahaya daripada no-XA yang jujur.

### 24.3 Pooling by URL Only

Pool matching yang hanya melihat endpoint URL mengabaikan credential, tenant, locale, schema, dan session context.

### 24.4 Infinite Retry on Business Error

Retry invalid payload tidak membuat payload menjadi valid.

### 24.5 Ack Before Commit

Jika inbound adapter ack message sebelum business transaction commit, crash bisa menyebabkan message lost.

### 24.6 Commit Before Ack without Idempotency

Jika commit sukses tapi ack gagal, message redeliver. Tanpa idempotency, side effect double.

### 24.7 Raw Threads in Container

Raw threads menyebabkan lifecycle, context, dan classloader leaks.

### 24.8 Logging Full Payload

Full payload logging bisa melanggar privacy, security, retention, dan performance.

### 24.9 No Unknown Outcome State

Timeout dianggap gagal padahal EIS mungkin berhasil. Ini sumber duplicate financial/operational side effect.

---

## 25. Java 8 sampai Java 25: Apa yang Perlu Diperhatikan

JCA/Jakarta Connectors adalah Jakarta EE API, bukan fitur core JDK.

Yang berubah dari Java 8 ke Java modern:

- Java EE APIs tidak boleh diasumsikan selalu tersedia dari JDK.
- Java 11 menghapus beberapa modul Java EE/CORBA seperti JAXB/JAX-WS dari JDK; connector API sendiri biasanya disediakan oleh application server atau dependency.
- Namespace berpindah dari `javax.resource.*` ke `jakarta.resource.*` pada Jakarta era.
- Application server compatibility menjadi penentu, bukan hanya JDK compatibility.
- JPMS/classpath/module-path dapat memperjelas split package dan dependency conflict.
- Container classloader isolation penting saat resource adapter membawa library EIS vendor.

Migration checklist:

```text
[ ] identify javax.resource vs jakarta.resource API usage
[ ] verify target application server supports Jakarta Connectors version
[ ] isolate EIS vendor libraries from application libraries
[ ] test deployment/redeploy for classloader leak
[ ] test WorkManager behavior under shutdown
[ ] test transaction recovery after restart
[ ] validate credential mapping in new server
[ ] review pool configuration migration
[ ] review JNDI names and deployment descriptors
[ ] update monitoring dashboards
```

---

## 26. Design Review Template untuk JCA Adapter

Gunakan ini saat menilai adapter.

### 26.1 Integration Identity

```text
- Source/target EIS:
- Protocol:
- Direction: inbound/outbound/both
- Business operation:
- Criticality:
- Data sensitivity:
```

### 26.2 Transaction

```text
- Transaction mode: none/local/XA
- Why this mode is sufficient:
- What happens if app commits and EIS fails:
- What happens if EIS succeeds and app fails:
- Unknown outcome handling:
- Recovery procedure:
```

### 26.3 Security

```text
- Credential model: service/container/component-managed
- Principal/tenant mapping:
- Pool matching criteria:
- Credential rotation:
- Audit identity:
- Least privilege controls:
```

### 26.4 Reliability

```text
- Idempotency key:
- Duplicate detection:
- Retry policy:
- Poison message policy:
- DLQ/quarantine process:
- Backpressure controls:
- Shutdown behavior:
```

### 26.5 Observability

```text
- Metrics:
- Logs:
- Traces/correlation:
- Audit events:
- Alert thresholds:
- Runbook links:
```

### 26.6 Testing

```text
- Unit tests:
- Contract tests:
- Integration tests:
- Crash/recovery tests:
- Security tests:
- Load/backpressure tests:
- Redeploy/classloader tests:
```

---

## 27. Practical Production Checklist

Sebelum production:

```text
[ ] all logical connections are closed by application code
[ ] ManagedConnection.cleanup resets mutable session state
[ ] pool matching includes credential/tenant/session-affecting attributes
[ ] broken connections are removed from pool
[ ] transaction timeouts are shorter than caller timeouts where appropriate
[ ] EIS operation timeout is explicit
[ ] retry policy is bounded
[ ] unknown outcome state exists
[ ] inbound idempotency exists
[ ] poison message strategy exists
[ ] DLQ/quarantine is monitored
[ ] WorkManager is used instead of raw unmanaged threads
[ ] shutdown drains or safely cancels work
[ ] credential rotation tested
[ ] XA recovery tested if XA is claimed
[ ] observability dashboard exists
[ ] audit event model exists
[ ] runbook covers EIS outage, auth failure, pool exhaustion, poison message, recovery stuck
```

---

## 28. Top 1% Mental Model

Engineer biasa bertanya:

> Bagaimana cara connect ke EIS?

Engineer senior bertanya:

> Bagaimana connection dipool, diamankan, ditransaksikan, dipulihkan, diaudit, dan dihentikan dengan benar?

Engineer top-tier bertanya:

> Apa invariant bisnis yang harus tetap benar ketika server crash, EIS timeout, credential rotate, message redeliver, transaction outcome unknown, dan pool berada di bawah tekanan?

JCA adalah teknologi tua tetapi problem yang diselesaikannya tetap modern:

- resource lifecycle
- pooling
- transaction boundary
- identity propagation
- message delivery
- retry/idempotency
- recovery
- observability
- operational governance

Bedanya, JCA menyelesaikannya di dalam model container Jakarta EE.

Jika kamu bisa memahami JCA dengan benar, kamu juga akan lebih kuat mendesain integrasi modern berbasis HTTP client, Kafka, RabbitMQ, Redis streams, outbox, atau cloud connector, karena failure model-nya sama:

```text
external side effects are not local method calls
transaction outcome can be uncertain
delivery can duplicate
credentials can expire
pools can leak
backpressure must be explicit
observability is part of correctness
```

---

## 29. Ringkasan

Di bagian ini kita membahas:

- JCA sebagai contract adapter antara container dan EIS.
- Perbedaan no transaction, local transaction, dan XA transaction.
- Kenapa XA hanya berguna jika recovery benar-benar diuji.
- Bagaimana connection pooling bisa menyebabkan state leakage.
- Bagaimana security/credential propagation mempengaruhi pooling dan audit.
- Bagaimana inbound message harus didesain untuk duplicate, retry, poison message, dan backpressure.
- Kenapa unknown outcome harus menjadi state eksplisit.
- Observability dan audit yang diperlukan untuk production/regulatory system.
- Checklist desain, testing, dan readiness sebelum production.

Part ini menyelesaikan fondasi JCA reliability. Bagian berikutnya adalah bagian terakhir seri ini: **Integration Architecture Capstone**, tempat kita menyatukan JSON, XML, JAXB, SOAP, WS-*, dan JCA menjadi decision framework arsitektur integrasi enterprise Java.

---

## 30. Referensi Resmi dan Relevan

- Jakarta Connectors 2.1 Specification — architecture, connection management, transaction, security, work management, message inflow.
- Jakarta Connectors API `jakarta.resource.spi` — system contracts resource adapter.
- Jakarta Transactions/JTA and XA concepts — global transaction and resource enlistment.
- Jakarta Enterprise Beans Message-Driven Beans — endpoint model for asynchronous message delivery.
- Open Liberty / application server documentation for connector configuration, connection factories, activation specs, and pooling.
- Vendor documentation for specific resource adapter behavior, because recovery, pooling, and credential mapping can be implementation-specific.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-json-xml-soap-connectors-enterprise-integration — Part 032](./learn-java-json-xml-soap-connectors-enterprise-integration-part-032.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration — Part 34](./learn-java-json-xml-soap-connectors-enterprise-integration-part-034.md)
