# learn-mysql-mastery-for-java-engineers-part-020.md

# Part 020 — Binary Log and Replication Fundamentals

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `020 / 034`  
> Topik: Binary Log, Replication, GTID, Relay Log, Replication Thread, dan Consistency Boundary  
> Audiens: Java software engineer yang ingin memahami MySQL sebagai sistem produksi, bukan sekadar SQL database.

---

## 0. Posisi Bagian Ini Dalam Seri

Bagian sebelumnya membahas konfigurasi MySQL yang benar-benar berdampak. Salah satu area konfigurasi paling penting adalah **binary logging** dan **replication**, karena dua hal ini menentukan:

1. apakah perubahan data dapat direplikasi,
2. apakah database dapat melakukan point-in-time recovery,
3. apakah aplikasi boleh membaca dari replica,
4. bagaimana failover bisa dilakukan,
5. apakah sistem punya RPO/RTO yang realistis,
6. bagaimana CDC seperti Debezium membaca perubahan,
7. apakah audit/event pipeline bisa dipercaya.

Bagian ini adalah fondasi untuk beberapa part berikutnya:

- Part 021 — Replication Lag, Read/Write Splitting, and Consistency Boundaries
- Part 022 — High Availability
- Part 023 — Backup, Restore, PITR, and Disaster Recovery
- Part 032 — MySQL in Distributed Systems and Microservices

Kalau kamu hanya melihat MySQL sebagai database tunggal, replication terlihat seperti fitur infra. Tetapi di production, replication adalah bagian dari **application correctness boundary**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. menjelaskan apa itu binary log dan kenapa berbeda dari redo log,
2. memahami bagaimana perubahan di primary dikirim dan diterapkan ke replica,
3. membedakan statement-based, row-based, dan mixed binary logging,
4. memahami GTID dan kenapa GTID penting untuk operasi modern,
5. membaca arsitektur replication source/replica secara benar,
6. memahami relay log dan replication thread,
7. mengetahui kenapa replication default-nya tidak memberi strong consistency,
8. mengerti risiko read replica untuk aplikasi Java,
9. membedakan use case replication, HA, backup, CDC, dan analytics,
10. mulai mampu mendesain application behavior yang sadar replication.

---

## 2. Mental Model Paling Dasar

Replication MySQL tradisional dapat dipahami seperti ini:

```text
Application
    |
    | writes
    v
Primary MySQL
    |
    | records committed changes into binary log
    v
Binary Log
    |
    | replica IO receiver pulls events
    v
Replica Relay Log
    |
    | replica SQL/applier thread applies events
    v
Replica Data
```

Satu kalimat penting:

> Replica bukan membaca langsung halaman InnoDB milik primary. Replica membaca event perubahan dari binary log, menyimpan event itu sebagai relay log, lalu menerapkannya ke data lokalnya sendiri.

Artinya:

- primary dan replica punya storage sendiri,
- replica mengejar primary secara event-based,
- replica bisa tertinggal,
- replica bisa berhenti apply,
- replica bisa punya data drift bila operasionalnya buruk,
- read dari replica tidak identik dengan read dari primary pada setiap waktu.

---

## 3. Binary Log: Apa Itu?

Binary log adalah log server-level yang berisi event perubahan database.

Secara praktis, binary log mencatat perubahan seperti:

- `INSERT`,
- `UPDATE`,
- `DELETE`,
- `CREATE TABLE`,
- `ALTER TABLE`,
- `DROP TABLE`,
- beberapa event administratif yang relevan.

Biasanya `SELECT` tidak masuk binary log karena tidak mengubah data atau struktur.

Mental model:

```text
Redo log  -> untuk crash recovery InnoDB lokal
Undo log  -> untuk rollback dan MVCC
Binlog    -> untuk replication, PITR, CDC, external change stream
```

Binary log berbeda dari redo log.

| Log | Level | Fungsi Utama | Dikonsumsi Replica? | Human/External Tool Relevance |
|---|---:|---|---:|---:|
| Redo log | InnoDB | crash recovery storage engine | Tidak langsung | Rendah |
| Undo log | InnoDB | rollback dan MVCC | Tidak | Rendah |
| Binary log | MySQL server | replication, PITR, CDC | Ya | Tinggi |
| Relay log | Replica | staging binlog event dari source | Dipakai replica | Sedang |

### 3.1 Kenapa binary log penting?

Binary log punya beberapa peran besar:

1. **Replication**  
   Replica menerima event dari binary log source.

2. **Point-in-time recovery**  
   Setelah restore backup, binary log bisa diputar ulang sampai posisi/waktu tertentu.

3. **Change Data Capture**  
   Tools seperti Debezium membaca binary log untuk mengubah transaksi database menjadi event stream.

4. **Audit teknis perubahan**  
   Bukan audit bisnis lengkap, tetapi berguna untuk rekonstruksi perubahan tingkat database.

5. **Failover dan topology management**  
   Binary log/GTID menentukan seberapa jauh node telah menerima dan menerapkan transaksi.

---

## 4. Binary Log Bukan Audit Log Bisnis

Kesalahan umum:

> “Karena MySQL punya binlog, berarti audit trail aplikasi sudah aman.”

Ini salah.

Binary log adalah log teknis untuk replication/recovery. Ia tidak otomatis menjawab:

- siapa user bisnis yang melakukan aksi,
- alasan perubahan,
- approval chain,
- policy version yang dipakai,
- workflow transition yang valid,
- apakah perubahan dilakukan lewat API resmi atau script admin,
- apakah operator memakai impersonation,
- konteks request/correlation id.

Untuk regulatory/case-management system, tetap butuh audit domain-level.

Contoh audit domain:

```sql
CREATE TABLE case_audit_event (
    audit_id          BINARY(16) PRIMARY KEY,
    case_id           BINARY(16) NOT NULL,
    actor_user_id     BINARY(16) NOT NULL,
    action_type       VARCHAR(80) NOT NULL,
    old_state         VARCHAR(50),
    new_state         VARCHAR(50),
    reason_code       VARCHAR(80),
    policy_version    VARCHAR(40),
    request_id        VARCHAR(80) NOT NULL,
    occurred_at       TIMESTAMP(6) NOT NULL,
    details_json      JSON NOT NULL
);
```

Binary log bisa membantu recovery teknis. Audit table membantu defensibility bisnis.

Keduanya berbeda.

---

## 5. Source dan Replica Terminology

Terminologi modern MySQL memakai:

- **source**: server asal perubahan,
- **replica**: server yang menerima dan menerapkan perubahan.

Di banyak blog lama, kamu masih akan melihat istilah:

- master,
- slave.

Untuk komunikasi modern, gunakan source/replica.

Mental model:

```text
Source / Primary
    owns writes from application
    records changes to binlog
    sends events to replica

Replica
    receives binlog events
    stores them in relay log
    applies them locally
    can serve reads if application accepts consistency trade-off
```

Catatan:

- “source” tidak selalu sama dengan “primary” dalam topologi kompleks.
- “primary” biasanya berarti node yang menerima write aplikasi.
- Dalam chain replication, satu server bisa menjadi replica dari upstream dan source bagi downstream.

---

## 6. Basic Replication Flow

Mari lihat flow secara lebih rinci.

```text
1. Application commits transaction on primary
2. MySQL writes transaction event to binary log
3. Replica connects to source
4. Source sends binlog events to replica
5. Replica writes received events to relay log
6. Replica applier reads relay log
7. Replica applies event to local data
8. Replica catches up or lags behind
```

Dalam MySQL, replication bukan magic shared storage.

Replica menjalankan perubahan ulang berdasarkan event.

### 6.1 Commit di primary

Saat transaksi commit di primary, ada beberapa hal penting:

- InnoDB memastikan perubahan durable sesuai setting redo log,
- MySQL menulis event ke binary log jika binlog aktif,
- transaksi yang berhasil commit menjadi bagian dari replication stream,
- transaksi yang rollback tidak direplikasi sebagai perubahan data final.

### 6.2 Replica pull, bukan primary push murni

Replica menghubungi source dan meminta event mulai dari posisi tertentu atau GTID tertentu.

Ini penting karena:

- replica bisa disconnect lalu reconnect,
- replica bisa melanjutkan dari posisi terakhir,
- source tidak perlu tahu semua state aplikasi,
- posisi replication harus dikelola dengan benar.

### 6.3 Relay log sebagai staging

Replica tidak langsung menerapkan event dari network ke data.

Ia menyimpan event ke relay log dulu.

```text
Source binlog -> network -> Replica relay log -> applier -> Replica InnoDB
```

Kenapa relay log penting?

- memisahkan receive dari apply,
- memungkinkan replica tetap menyimpan event meski applier tertahan,
- membantu recovery posisi replication,
- membuat diagnosis replication lag lebih jelas.

Lag bisa terjadi di dua area:

1. replica lambat menerima event,
2. replica cepat menerima tapi lambat menerapkan event.

Dua kondisi ini berbeda.

---

## 7. Binary Log Format

MySQL mendukung beberapa format binary logging:

1. statement-based,
2. row-based,
3. mixed.

Format ini menentukan apa yang ditulis ke binlog.

---

## 8. Statement-Based Replication

Statement-based logging mencatat SQL statement.

Contoh:

```sql
UPDATE account
SET balance = balance - 100
WHERE account_id = 10;
```

Yang masuk log kira-kira adalah statement tersebut.

Replica kemudian menjalankan statement yang sama.

### 8.1 Kelebihan statement-based

- log bisa lebih kecil untuk update besar,
- mudah dibaca secara konseptual,
- kadang lebih efisien untuk statement deterministik yang mengubah banyak row.

Contoh:

```sql
UPDATE case_file
SET archived = 1
WHERE closed_at < '2020-01-01';
```

Jika mengubah jutaan row, statement log bisa lebih kecil daripada row event satu per satu.

### 8.2 Kekurangan statement-based

Statement-based replication bermasalah bila statement tidak deterministik atau bergantung pada kondisi lokal.

Contoh berbahaya:

```sql
UPDATE task_queue
SET assigned_worker = UUID()
WHERE status = 'READY'
LIMIT 10;
```

Masalah:

- `UUID()` bisa berbeda,
- tanpa `ORDER BY`, `LIMIT 10` bisa memilih row berbeda,
- plan bisa berbeda,
- data replica bisa diverge.

Contoh lain:

```sql
INSERT INTO audit_event(event_id, created_at)
VALUES (UUID(), NOW());
```

`NOW()` punya semantics khusus di MySQL, tetapi secara umum statement non-deterministik harus diwaspadai.

### 8.3 Rule of thumb

Untuk sistem modern, terutama yang memakai replication, CDC, dan kompleksitas aplikasi tinggi, row-based sering lebih aman.

---

## 9. Row-Based Replication

Row-based logging mencatat perubahan row, bukan hanya SQL statement.

Contoh statement:

```sql
UPDATE account
SET balance = balance - 100
WHERE account_id = 10;
```

Yang direkam secara konseptual:

```text
Table: account
Row PK: 10
Before/after image or changed columns depending configuration
balance: 1000 -> 900
```

Replica tidak perlu memilih row berdasarkan predicate. Ia menerapkan perubahan row yang sudah ditentukan.

### 9.1 Kelebihan row-based

- lebih deterministic,
- lebih aman untuk statement non-deterministic,
- lebih cocok untuk CDC,
- mengurangi risiko replica memilih row berbeda,
- lebih jelas untuk downstream event consumer.

### 9.2 Kekurangan row-based

- log bisa besar untuk operasi massal,
- lebih banyak I/O binlog,
- bisa meningkatkan network traffic replication,
- perlu perhatian pada `binlog_row_image`.

Contoh:

```sql
UPDATE case_file
SET archived = 1
WHERE closed_at < '2020-01-01';
```

Jika mengubah 10 juta row, row-based log bisa sangat besar.

### 9.3 binlog_row_image

`binlog_row_image` menentukan seberapa lengkap row image yang ditulis.

Nilai umum:

- `FULL`,
- `MINIMAL`,
- `NOBLOB`.

Mental model:

| Setting | Isi row image | Kelebihan | Risiko / Catatan |
|---|---|---|---|
| FULL | semua kolom | paling lengkap, bagus untuk CDC/audit teknis | binlog besar |
| MINIMAL | kolom perlu saja | binlog lebih kecil | consumer CDC perlu kompatibel |
| NOBLOB | hindari BLOB bila tidak berubah | mengurangi ukuran | tetap perlu validasi use case |

Untuk sistem yang memakai Debezium/CDC, pilihan ini tidak boleh sembarangan.

---

## 10. Mixed Format

Mixed format berarti MySQL dapat memakai statement-based untuk statement yang dianggap aman, dan row-based untuk statement yang berisiko.

Secara teori menarik.

Secara operasional, mixed bisa membuat reasoning lebih sulit karena format event dapat berubah tergantung statement.

Untuk banyak sistem modern, terutama yang butuh predictable CDC dan replication behavior, lebih mudah menstandardisasi ke row-based.

---

## 11. GTID: Global Transaction Identifier

GTID adalah identifier unik untuk transaksi yang sudah commit dan masuk replication stream.

Secara konseptual:

```text
GTID = source_uuid:transaction_sequence_number
```

Contoh bentuk:

```text
3E11FA47-71CA-11E1-9E33-C80AA9429562:23
```

Artinya:

- transaksi berasal dari server UUID tertentu,
- memiliki nomor urut tertentu pada server asal.

### 11.1 Kenapa GTID penting?

Tanpa GTID, replication tradisional mengandalkan:

```text
binary log file name + byte position
```

Contoh:

```text
mysql-bin.000123:4567890
```

Ini bekerja, tetapi rawan operasional.

Dengan GTID, kita bisa berpikir:

```text
Replica sudah menjalankan transaksi A, B, C.
Replica belum menjalankan D, E.
```

Bukan:

```text
Replica sedang di byte offset sekian dari file binlog tertentu.
```

GTID memudahkan:

- failover,
- replica rebuild,
- topology changes,
- determining transaction set,
- auto-positioning,
- comparing execution progress.

### 11.2 GTID bukan timestamp

GTID bukan waktu.

GTID menjawab:

```text
Transaksi apa yang sudah dieksekusi?
```

Bukan:

```text
Transaksi ini terjadi jam berapa secara wall-clock?
```

Untuk audit bisnis, tetap simpan timestamp bisnis/domain sendiri.

### 11.3 GTID set mental model

Replica menyimpan set GTID yang sudah dieksekusi.

Contoh konseptual:

```text
sourceA:1-1000
sourceB:1-250
```

Artinya replica sudah menerapkan transaksi 1 sampai 1000 dari sourceA dan 1 sampai 250 dari sourceB.

Dalam failover, sistem bisa membandingkan node:

```text
Node A executed: sourceA:1-1000
Node B executed: sourceA:1-998
Node C executed: sourceA:1-1000
```

Node B tertinggal dua transaksi.

---

## 12. File/Position vs GTID Replication

Ada dua mental model posisi replication.

### 12.1 File/position

```text
source binlog file: mysql-bin.000042
position: 987654321
```

Kelebihan:

- konsep lama,
- masih ditemukan di banyak sistem legacy,
- eksplisit secara fisik.

Kekurangan:

- lebih sulit saat failover,
- rawan salah posisi,
- sulit membandingkan transaction set antar server,
- butuh koordinasi log file tertentu.

### 12.2 GTID auto-positioning

```text
Replica: saya sudah punya GTID set ini.
Source: saya kirim transaksi yang belum kamu punya.
```

Kelebihan:

- lebih mudah untuk failover,
- lebih aman untuk topology change,
- lebih mudah reasoning transaction continuity,
- lebih cocok untuk operasi modern.

Kekurangan:

- perlu disiplin konfigurasi,
- perlu memahami GTID consistency,
- operasi reset/purge harus hati-hati.

Rule of thumb:

> Untuk deployment modern, gunakan GTID kecuali ada alasan kuat untuk tidak menggunakannya.

---

## 13. Replication Threads

Replication melibatkan beberapa thread.

Secara sederhana:

```text
On source:
  - binary log dump thread

On replica:
  - receiver / IO thread
  - SQL / applier thread
  - optional parallel worker threads
```

### 13.1 Source binlog dump thread

Saat replica connect ke source, source membuat thread untuk mengirim event binary log ke replica.

Di source, thread ini bisa terlihat sebagai semacam `Binlog Dump` di process list.

### 13.2 Replica receiver / IO thread

Thread ini menerima event dari source dan menulisnya ke relay log.

Kalau receiver tertahan:

- network bermasalah,
- source tidak bisa mengirim cepat,
- authentication/connection error,
- replica tidak bisa menulis relay log,
- source binlog sudah hilang/purged.

### 13.3 Replica applier / SQL thread

Thread ini membaca relay log dan menerapkan perubahan ke data lokal replica.

Kalau applier tertahan:

- query apply lambat,
- lock conflict di replica,
- DDL besar,
- disk lambat,
- worker parallel tidak efektif,
- data inconsistency menyebabkan error apply.

### 13.4 Parallel replication workers

MySQL dapat memakai parallel applier untuk meningkatkan throughput apply.

Tetapi parallelism tidak berarti semua lag hilang.

Batasannya:

- dependency antar transaksi,
- commit order,
- hotspot table,
- single huge transaction,
- DDL,
- resource I/O.

Contoh:

```text
1000 transaksi kecil independent -> parallelism membantu
1 transaksi update 10 juta row     -> parallelism tidak banyak membantu
```

---

## 14. Relay Log

Relay log adalah salinan/staging event dari source yang tersimpan di replica.

Mental model:

```text
Source binary log:
  mysql-bin.000001
  mysql-bin.000002

Replica relay log:
  replica-relay-bin.000001
  replica-relay-bin.000002
```

Relay log membantu memisahkan dua tahap:

1. **receive** event dari source,
2. **apply** event ke database replica.

Karena itu ada beberapa kondisi penting:

### 14.1 Receiver up, applier down

```text
Source -> Replica relay log: berjalan
Relay log -> Replica data: berhenti
```

Replica mungkin terus menerima event, tetapi data tidak berubah.

Aplikasi yang membaca replica melihat data lama.

### 14.2 Receiver down, applier still catching up

```text
Source -> Replica relay log: berhenti
Relay log -> Replica data: masih apply backlog
```

Replica masih bisa mengejar event yang sudah diterima, tetapi tidak menerima event baru.

### 14.3 Relay log storage full

Jika disk relay log penuh, replication bisa berhenti. Ini bisa terjadi bila:

- applier lambat,
- source menghasilkan event sangat cepat,
- ada transaksi besar,
- disk sizing buruk.

---

## 15. Asynchronous Replication

Secara default, MySQL replication bersifat asynchronous.

Artinya:

```text
Primary commit success does not guarantee replica has received/applied the transaction.
```

Aplikasi bisa mendapat response sukses dari primary, lalu segera membaca replica dan tidak menemukan datanya.

Contoh:

```text
T0: POST /cases creates case C123 on primary
T1: transaction commits successfully
T2: API returns 201 Created
T3: frontend calls GET /cases/C123
T4: read router sends GET to replica
T5: replica has not applied C123 yet
T6: API returns 404
```

Dari perspektif user:

```text
Saya baru saja membuat data, kok hilang?
```

Dari perspektif database:

```text
Tidak hilang. Replica belum catch up.
```

Ini adalah **read-your-writes violation**.

---

## 16. Semi-Synchronous Replication

Semi-synchronous replication mencoba mengurangi risiko data hilang saat primary crash.

Secara konseptual:

```text
Primary commit waits until at least one replica acknowledges receipt of transaction event.
```

Tetapi hati-hati:

- acknowledge receipt tidak selalu berarti sudah applied,
- latency commit meningkat,
- jika replica lambat/tidak tersedia, behavior tergantung konfigurasi,
- tidak otomatis memberi read-your-writes dari semua replica.

Semi-sync membantu durability/RPO, bukan otomatis strong consistency untuk read routing.

---

## 17. Group Replication dan InnoDB Cluster: Preview

MySQL juga memiliki Group Replication dan InnoDB Cluster untuk HA/topology management yang lebih advanced.

Bagian ini belum membahas detailnya. Itu akan dibahas di Part 022.

Untuk sekarang cukup pahami:

- traditional replication: event stream dari source ke replica,
- Group Replication: koordinasi group member dengan mekanisme lebih advanced,
- InnoDB Cluster: packaging HA dengan MySQL Router dan tooling.

Tetapi tetap: aplikasi harus memahami failure boundary.

Tidak ada HA system yang menghapus kebutuhan retry, timeout, idempotency, dan observability.

---

## 18. Replication Lag

Replication lag adalah jarak antara perubahan di source dan keadaan yang sudah diterapkan di replica.

Lag bisa diukur dalam beberapa cara:

- seconds behind source,
- GTID set difference,
- relay log backlog,
- transaction timestamp delay,
- application-level heartbeat.

### 18.1 Kenapa lag terjadi?

Penyebab umum:

1. source write rate lebih tinggi daripada apply rate,
2. transaksi besar,
3. DDL besar,
4. replica hardware lebih kecil,
5. disk replica lambat,
6. parallel applier tidak efektif,
7. lock conflict di replica,
8. long-running read di replica,
9. network issue,
10. replica sedang backup/reporting berat.

### 18.2 Lag metric bisa menipu

`Seconds_Behind_Source` berguna, tetapi tidak cukup.

Masalah:

- bisa `NULL` jika replication tidak berjalan,
- bisa 0 tetapi ada masalah pada channel tertentu,
- tidak selalu merepresentasikan application-visible freshness,
- transaksi besar bisa membuat lag terlihat melonjak setelah commit besar.

Untuk aplikasi kritis, gunakan heartbeat table/event.

Contoh:

```sql
CREATE TABLE replication_heartbeat (
    id TINYINT PRIMARY KEY,
    source_time TIMESTAMP(6) NOT NULL
);

UPDATE replication_heartbeat
SET source_time = CURRENT_TIMESTAMP(6)
WHERE id = 1;
```

Aplikasi/monitoring membaca dari replica:

```sql
SELECT TIMESTAMPDIFF(MICROSECOND, source_time, CURRENT_TIMESTAMP(6)) AS lag_us
FROM replication_heartbeat
WHERE id = 1;
```

Ini mengukur freshness yang lebih dekat ke perspektif aplikasi.

---

## 19. Read Replica: Bukan Free Scaling Tanpa Konsekuensi

Read replica sering dipakai untuk:

- mengurangi beban primary,
- reporting,
- analytical-ish workload,
- backup offload,
- geographic read locality,
- isolated heavy query.

Tetapi read replica membawa consistency trade-off.

### 19.1 Query yang relatif aman diarahkan ke replica

Contoh:

- dashboard agregat yang toleran delay,
- reporting non-critical,
- export malam hari,
- list data historis,
- search yang tidak harus immediate,
- read-only admin view dengan freshness indicator.

### 19.2 Query yang sebaiknya ke primary

Contoh:

- read setelah write dalam request/session sama,
- eligibility check sebelum state transition,
- concurrency guard,
- payment/status decision,
- SLA escalation decision yang harus akurat,
- approval state yang baru berubah,
- idempotency lookup setelah command submit,
- unique/business invariant check.

### 19.3 Regulatory workflow example

Misal ada state machine:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> ENFORCEMENT_ACTION -> CLOSED
```

Jika service membaca state dari replica yang lag, maka bisa terjadi:

```text
T0: Officer A changes case from SUBMITTED to UNDER_REVIEW on primary
T1: Replica still sees SUBMITTED
T2: Officer B reads from replica
T3: Officer B tries transition SUBMITTED -> CANCELLED
T4: Business logic based on stale state
```

Kalau transition validation tidak dilakukan ulang di primary transaction, sistem bisa membuat keputusan salah.

Rule:

> Replica boleh dipakai untuk membaca tampilan, tetapi keputusan mutasi harus divalidasi dalam transaksi di primary.

---

## 20. Read/Write Splitting Anti-Pattern

Anti-pattern umum di Java:

```text
@Transactional(readOnly = true) -> route to replica
@Transactional            -> route to primary
```

Ini terlihat rapi, tetapi tidak cukup.

Masalah:

1. read-only transaction bisa membutuhkan fresh data,
2. command handler sering melakukan read sebelum write,
3. request setelah write butuh session stickiness,
4. async flow bisa membaca stale replica,
5. `@Transactional(readOnly=true)` adalah hint semantic aplikasi, bukan guarantee consistency need.

Contoh salah:

```java
@Transactional(readOnly = true)
public CaseDetail getCaseAfterSubmission(UUID caseId) {
    return caseRepository.findById(caseId)
        .orElseThrow(NotFoundException::new);
}
```

Jika ini dipanggil setelah create/submit, routing ke replica bisa menghasilkan 404 palsu.

Lebih aman:

```java
public enum ReadFreshness {
    STALE_OK,
    READ_YOUR_WRITES_REQUIRED,
    PRIMARY_REQUIRED
}
```

Lalu routing berdasarkan freshness requirement, bukan hanya read-only.

---

## 21. Replication Filtering

MySQL dapat mengatur replication agar hanya database/table tertentu direplikasi, atau mengecualikan objek tertentu.

Contoh use case:

- replica reporting hanya untuk subset database,
- exclude temporary/archive table,
- multi-source specialized topology.

Tetapi filtering berbahaya jika tidak dipahami.

Risiko:

- replica tidak identik dengan source,
- foreign key/application invariant bisa rusak,
- restore/failover menjadi sulit,
- CDC consumer bisa kehilangan event,
- query lintas tabel bisa salah.

Rule of thumb:

> Untuk HA replica yang mungkin dipromote menjadi primary, jangan gunakan filtering sembarangan. Replica HA harus semirip mungkin dengan primary.

---

## 22. Replication and DDL

DDL juga direplikasi.

Contoh:

```sql
ALTER TABLE case_file ADD COLUMN risk_score INT NULL;
```

DDL bisa menjadi sumber lag besar.

Penyebab:

- table rebuild,
- metadata lock,
- applier berhenti di DDL,
- long transaction menahan DDL,
- replica hardware lebih lambat.

Bahaya:

```text
Primary migration selesai
Replica masih applying DDL
App version baru membaca replica dan mengharapkan column baru
Replica belum siap
```

Untuk deployment aman:

1. gunakan expand-contract,
2. pastikan DDL kompatibel mundur,
3. monitor replication lag sebelum rolling deploy,
4. hindari aplikasi baru membaca kolom yang belum guaranteed ada di semua replica,
5. pisahkan migration besar dari deploy logic.

---

## 23. Replication and Large Transactions

Large transaction buruk untuk replication.

Contoh:

```sql
UPDATE audit_event
SET archived = 1
WHERE occurred_at < '2020-01-01';
```

Jika mengubah jutaan row dalam satu transaction:

- binlog event besar,
- relay log besar,
- applier lama,
- lag melonjak,
- rollback mahal jika gagal,
- replica tidak bisa apply partial secara visible sampai transaction selesai,
- failover reasoning lebih sulit.

Lebih baik batching:

```sql
UPDATE audit_event
SET archived = 1
WHERE occurred_at < '2020-01-01'
ORDER BY occurred_at, audit_id
LIMIT 5000;
```

Diulang oleh job dengan checkpoint.

Desain batch harus:

- idempotent,
- resumable,
- observable,
- bounded per transaction,
- punya sleep/backpressure,
- tidak mengganggu OLTP utama.

---

## 24. Replication and AUTO_INCREMENT

Dalam single-primary replication, `AUTO_INCREMENT` biasanya sederhana.

Dalam multi-primary atau active-active topology, auto increment bisa konflik jika tidak dikonfigurasi.

Konsep terkait:

- `auto_increment_increment`,
- `auto_increment_offset`.

Namun active-active MySQL dengan write di banyak node bukan hal sederhana.

Untuk kebanyakan sistem Java OLTP:

> Gunakan single-writer topology kecuali kamu benar-benar memahami conflict detection, consistency, failover, dan operational burden multi-writer.

---

## 25. Replication and Non-Determinism

Statement non-deterministic menjadi masalah terutama di statement-based replication.

Contoh risiko:

```sql
UPDATE queue_item
SET status = 'PROCESSING'
WHERE status = 'READY'
LIMIT 1;
```

Tanpa `ORDER BY`, row yang dipilih bisa tidak stabil.

Lebih buruk:

```sql
DELETE FROM case_notification
WHERE status = 'SENT'
LIMIT 1000;
```

Jika row berbeda terhapus di source dan replica, data drift.

Rule:

- gunakan row-based replication,
- hindari statement non-deterministic untuk mutasi,
- selalu pakai ordering deterministik untuk batch,
- jangan bergantung pada physical order table,
- validasi query yang dihasilkan ORM/job scheduler.

---

## 26. Replication Error dan Data Drift

Replication bisa berhenti karena error.

Contoh:

- duplicate key saat apply,
- missing row saat update/delete,
- table definition berbeda,
- column mismatch,
- permission/config issue,
- source binlog sudah purged sebelum replica catch up,
- disk full,
- relay log corrupt.

Data drift adalah kondisi ketika source dan replica tidak sama.

Penyebab umum:

- write langsung ke replica,
- replication filtering salah,
- manual fix hanya di satu node,
- statement-based non-determinism,
- skip replication error sembarangan,
- schema migration tidak konsisten.

### 26.1 Jangan sembarang skip error

Di incident, operator bisa tergoda melakukan:

```text
skip one transaction and continue replication
```

Kadang memang diperlukan, tetapi sangat berbahaya.

Setiap skip harus menjawab:

1. transaksi apa yang dilewati?
2. data apa yang sekarang berbeda?
3. apakah replica masih valid untuk read?
4. apakah replica masih bisa dipromote?
5. apakah perlu rebuild replica?
6. apakah ada impact ke CDC/downstream?

Rule:

> Skip replication event tanpa rekonsiliasi adalah cara cepat membuat replica tampak sehat tetapi tidak dapat dipercaya.

---

## 27. Binary Log Retention

Source menyimpan binary log hanya selama retention tertentu atau sampai dipurge.

Jika replica tertinggal terlalu jauh dan source sudah menghapus binlog yang dibutuhkan, replica tidak bisa catch up dari posisi itu.

Contoh:

```text
Replica needs mysql-bin.000100
Source already purged up to mysql-bin.000120
Replication cannot continue normally
```

Solusi biasanya:

- rebuild replica dari backup baru,
- restore snapshot lalu apply binlog yang masih tersedia,
- perbaiki retention policy.

Binary log retention harus disesuaikan dengan:

- maksimum expected replica downtime,
- backup interval,
- PITR requirement,
- CDC consumer downtime tolerance,
- storage capacity.

---

## 28. Binary Log and Point-in-Time Recovery

Binary log bukan hanya untuk replication.

Untuk PITR:

```text
1. Restore full backup taken at T0
2. Apply binary logs from T0 to target time T1
3. Stop before bad transaction or desired timestamp/position
```

Contoh kejadian:

```text
10:00 backup completed
13:42 operator accidentally DELETEs records
13:45 issue detected
```

PITR strategy:

```text
restore backup 10:00
apply binlogs until 13:41:59
recover state before accidental delete
```

Syarat:

- backup konsisten,
- binary logs tersedia,
- server_id/GTID/binlog metadata jelas,
- restore procedure pernah diuji,
- target recovery time diketahui.

Tanpa binary log, backup harian hanya bisa restore ke waktu backup.

---

## 29. Binary Log and CDC

Change Data Capture tools seperti Debezium membaca binary log untuk menghasilkan event.

Pipeline konseptual:

```text
MySQL binlog -> Debezium connector -> Kafka topic -> consumers
```

Use case:

- outbox event publishing,
- search index projection,
- data warehouse ingestion,
- audit stream,
- integration events,
- cache invalidation.

### 29.1 CDC bukan pengganti transaksi aplikasi

CDC async.

Artinya:

```text
DB commit happens first
CDC event appears later
Consumer updates downstream later
```

Jangan mengasumsikan Elasticsearch/read model langsung konsisten setelah commit.

### 29.2 Outbox pattern dengan binlog CDC

Desain umum:

```sql
CREATE TABLE outbox_event (
    event_id        BINARY(16) PRIMARY KEY,
    aggregate_type  VARCHAR(80) NOT NULL,
    aggregate_id    BINARY(16) NOT NULL,
    event_type      VARCHAR(120) NOT NULL,
    payload_json    JSON NOT NULL,
    created_at      TIMESTAMP(6) NOT NULL,
    published_at    TIMESTAMP(6) NULL
);
```

Dalam satu transaksi:

```text
1. update business table
2. insert outbox event
3. commit
```

CDC membaca outbox insert dari binlog.

Keuntungan:

- business change dan event intent atomic,
- tidak perlu publish ke Kafka di tengah transaksi,
- retry consumer lebih manageable,
- event tidak hilang jika app crash setelah commit.

---

## 30. Application Consistency Boundaries

Untuk Java engineer, replication harus diterjemahkan menjadi keputusan aplikasi.

Pertanyaan penting:

1. Apakah read ini boleh stale?
2. Berapa stale yang dapat diterima?
3. Apakah read ini terjadi setelah write user yang sama?
4. Apakah read ini memutuskan write berikutnya?
5. Apakah stale read bisa melanggar invariant bisnis?
6. Apakah endpoint harus primary-only?
7. Apakah UI perlu menampilkan freshness?
8. Apakah retry aman?
9. Apakah fallback ke primary diperlukan?
10. Apakah replica boleh digunakan saat lag tinggi?

### 30.1 Klasifikasi read

Gunakan klasifikasi seperti ini:

| Read Type | Contoh | Routing |
|---|---|---|
| Critical invariant read | validasi state sebelum transition | Primary |
| Read-your-writes | halaman detail setelah create/update | Primary atau sticky primary |
| Fresh operational queue | queue assignment | Primary |
| Slightly stale dashboard | count status harian | Replica boleh |
| Historical report | export bulan lalu | Replica boleh |
| Search projection | keyword search | Search engine/replica dengan freshness info |

### 30.2 Jangan hanya routing berdasarkan method name

Buruk:

```text
GET -> replica
POST/PUT/DELETE -> primary
```

Kenapa salah?

- GET setelah POST butuh fresh,
- GET bisa mengambil decision-critical data,
- POST bisa melakukan read before write,
- background job bisa read stale lalu write salah.

Lebih baik routing berdasarkan semantic freshness.

---

## 31. Java Routing DataSource: Mental Model

Banyak aplikasi Spring memakai `AbstractRoutingDataSource`.

Contoh konsep:

```java
public enum DbRole {
    PRIMARY,
    REPLICA
}
```

Routing context:

```java
public final class DbRoutingContext {
    private static final ThreadLocal<DbRole> ROLE = new ThreadLocal<>();

    public static void usePrimary() {
        ROLE.set(DbRole.PRIMARY);
    }

    public static void useReplica() {
        ROLE.set(DbRole.REPLICA);
    }

    public static DbRole currentRole() {
        return ROLE.get() == null ? DbRole.PRIMARY : ROLE.get();
    }

    public static void clear() {
        ROLE.remove();
    }
}
```

Tetapi ini hanya mekanisme teknis.

Yang lebih penting adalah policy:

```java
public enum FreshnessRequirement {
    PRIMARY_REQUIRED,
    READ_YOUR_WRITES,
    STALE_OK
}
```

Service-level decision:

```java
public CaseDetail getCaseDetail(UUID caseId, FreshnessRequirement freshness) {
    if (freshness == FreshnessRequirement.STALE_OK) {
        return replicaRead(() -> caseRepository.findDetail(caseId));
    }
    return primaryRead(() -> caseRepository.findDetail(caseId));
}
```

Di production, kamu juga butuh:

- circuit breaker per replica,
- lag-aware routing,
- fallback policy,
- metrics by route,
- logging route decision,
- request correlation.

---

## 32. Lag-Aware Read Routing

Replica seharusnya tidak selalu dianggap sehat hanya karena koneksi berhasil.

Routing ke replica perlu mempertimbangkan:

- replication running,
- lag di bawah threshold,
- replica not read_only violation,
- schema version kompatibel,
- pool health,
- query timeout,
- current incident mode.

Contoh policy:

```text
If read freshness = STALE_OK:
    if replica lag <= 2 seconds and replica healthy:
        route to replica
    else:
        route to primary or fail depending endpoint policy

If read freshness = PRIMARY_REQUIRED:
    route to primary
```

Endpoint reporting mungkin boleh fail jika replica tidak sehat.

Endpoint customer-facing detail mungkin fallback ke primary.

Tetapi fallback massal ke primary bisa membuat primary overload. Jadi fallback policy harus dirancang, bukan otomatis universal.

---

## 33. Replica Read-Only Mode

Replica sebaiknya dikonfigurasi agar tidak menerima write aplikasi.

Konsep:

- `read_only`,
- `super_read_only`.

Tujuannya:

- mencegah accidental writes ke replica,
- menghindari data drift,
- menjaga replica bisa dipromote dengan aman.

Tetapi beberapa user dengan privilege tinggi bisa melewati batas tertentu jika konfigurasi tidak ketat.

Rule:

> Jangan hanya mengandalkan aplikasi untuk tidak menulis ke replica. Gunakan privilege dan read-only control di database.

---

## 34. Replication User and Security

Replication membutuhkan user khusus.

Prinsip:

- jangan gunakan root/admin user,
- beri privilege minimal,
- gunakan TLS untuk replication antar host/network tidak trusted,
- rotasi credential dengan prosedur aman,
- pisahkan replication user dari app user,
- monitor login/connection replication.

Contoh konseptual:

```sql
CREATE USER 'repl'@'10.%' IDENTIFIED BY 'strong-secret';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'10.%';
```

Catatan terminologi: beberapa privilege/command lama masih memakai istilah historis di SQL syntax atau dokumentasi tertentu. Pahami mapping-nya, tetapi gunakan bahasa source/replica dalam desain.

---

## 35. Multi-Source Replication

Multi-source replication berarti satu replica menerima event dari beberapa source.

Use case:

- consolidation reporting,
- migration,
- shard aggregation,
- specialized topology.

Risiko:

- schema collision,
- GTID set complexity,
- conflict bila source menulis row/table sama,
- debugging lebih sulit,
- failover lebih rumit.

Untuk OLTP utama, multi-source bukan default. Gunakan hanya jika kebutuhan jelas.

---

## 36. Delayed Replica

Delayed replica sengaja tertinggal dari source.

Contoh:

```text
Replica applies events 1 hour later
```

Use case:

- perlindungan dari accidental delete/update,
- recovery cepat sebelum kesalahan diterapkan,
- forensic investigation.

Contoh incident:

```text
13:00 bad deploy deletes data
13:05 detected
Delayed replica with 1h delay has not applied delete yet
```

Delayed replica bukan pengganti backup, tetapi bisa mempercepat recovery dari human error tertentu.

Trade-off:

- tidak cocok untuk fresh read,
- butuh storage ekstra,
- failover otomatis ke delayed replica berbahaya,
- harus jelas di topology naming.

---

## 37. Topology Patterns

### 37.1 Single primary, one replica

```text
Primary -> Replica
```

Cocok untuk:

- basic HA preparation,
- backup offload,
- small read scaling.

Risiko:

- replica mungkin lag,
- failover masih manual/semiautomated,
- single replica bisa gagal.

### 37.2 Single primary, multiple replicas

```text
          -> Replica A
Primary   -> Replica B
          -> Replica C
```

Cocok untuk:

- read scaling,
- reporting isolation,
- regional read,
- backup replica khusus.

Risiko:

- replicas punya lag berbeda,
- routing lebih kompleks,
- schema rollout harus memperhatikan semua replica.

### 37.3 Chain replication

```text
Primary -> Replica A -> Replica B
```

Cocok untuk:

- mengurangi load langsung di primary,
- topology tertentu.

Risiko:

- lag bertingkat,
- failure propagation,
- failover reasoning lebih rumit.

### 37.4 Dedicated roles

```text
Primary
  -> HA replica
  -> read API replica
  -> reporting replica
  -> delayed replica
  -> CDC replica
```

Ini lebih realistis untuk organisasi besar.

Setiap replica punya purpose dan SLO berbeda.

---

## 38. Replication Is Not Backup

Replication bukan backup.

Kenapa?

Jika aplikasi menjalankan:

```sql
DELETE FROM case_file;
```

Maka delete tersebut direplikasi.

Replica ikut kehilangan data.

Replication melindungi dari:

- server/node failure,
- read scaling need,
- sebagian availability issue.

Backup melindungi dari:

- accidental delete,
- corruption yang sudah ter-replicate,
- malicious change,
- logical data loss,
- kebutuhan restore historis.

Delayed replica membantu sebagian kasus, tetapi tetap bukan backup lengkap.

Rule:

```text
Replication != backup
Backup not tested restore != backup
```

---

## 39. Replication Is Not Strong Consistency

Replication asynchronous tidak memberi guarantee:

- read-your-writes dari replica,
- monotonic reads antar replica,
- latest state visibility,
- invariant validation pada stale read,
- zero data loss saat primary crash.

Aplikasi harus eksplisit memilih consistency mode.

### 39.1 Read-your-writes

User menulis, lalu membaca hasilnya.

Solusi:

- route subsequent read ke primary,
- session stickiness ke primary selama window tertentu,
- wait-until-replica-caught-up by GTID/token,
- return write result langsung tanpa immediate reread dari replica.

### 39.2 Monotonic reads

User tidak ingin melihat data bergerak mundur.

Masalah:

```text
Request 1 routed to Replica A lag 1s sees version 10
Request 2 routed to Replica B lag 10s sees version 8
```

Solusi:

- sticky replica,
- freshness token,
- route to primary after critical read,
- lag-aware routing.

### 39.3 Consistent prefix

Dalam event/workflow, user tidak ingin melihat child row tanpa parent state yang sesuai.

Lag dan parallel apply dapat membuat tampilan sementara membingungkan jika query tersebar ke node berbeda.

---

## 40. Replication and Transaction Commit Order

Replication perlu menjaga konsistensi transactional.

Tetapi saat parallel replication digunakan, transaksi independent bisa diterapkan paralel.

Hal yang perlu dipahami:

- commit order di source penting,
- dependency tracking menentukan parallelism,
- replica harus menjaga visibility yang benar sesuai mekanisme MySQL,
- single hot aggregate membatasi parallel apply.

Contoh hotspot:

```text
All transactions update organization_summary where org_id = 1
```

Meskipun ada banyak worker, dependency/hot row membuat apply tidak banyak paralel.

Untuk workload Java, desain aggregate dan summary table dapat mempengaruhi replication lag.

---

## 41. Diagnosing Replication at High Level

Saat replication bermasalah, jangan langsung restart.

Gunakan pertanyaan:

1. Apakah receiver berjalan?
2. Apakah applier berjalan?
3. Apakah ada error terakhir?
4. Apakah source binlog masih tersedia?
5. Apakah relay log tumbuh?
6. Apakah lag karena network atau apply?
7. Apakah ada transaksi besar?
8. Apakah ada DDL?
9. Apakah disk penuh?
10. Apakah replica sedang menjalankan query/report berat?
11. Apakah data drift terjadi?
12. Apakah replica masih layak melayani read?

Contoh command yang sering dipakai:

```sql
SHOW REPLICA STATUS\G
```

Kolom yang perlu dipahami secara konseptual:

- source host,
- replica IO running,
- replica SQL running,
- last IO error,
- last SQL error,
- relay log file/position,
- source log file/position,
- seconds behind source,
- retrieved GTID set,
- executed GTID set.

Jangan hanya melihat satu angka.

---

## 42. Application-Level Safety During Replication Incident

Saat replica lag/berhenti, aplikasi harus punya mode degradasi.

Opsi:

1. matikan read dari replica,
2. route critical read ke primary,
3. tampilkan data stale dengan label freshness,
4. nonaktifkan reporting berat,
5. throttle background job,
6. pause CDC-dependent workflows,
7. reject operation yang butuh fresh projection,
8. fallback ke cached last known state untuk non-critical display.

Yang buruk:

```text
Replica lag 2 hours, application tetap route all GET to replica, users make decisions based on stale data.
```

Untuk regulatory workflow, stale data bisa bukan hanya bug UX, tetapi masalah governance.

---

## 43. Schema Version and Replication

Dalam sistem dengan migration otomatis, setiap node DB dan setiap instance aplikasi harus kompatibel.

Problem:

```text
App v2 expects column risk_score
Primary migration done
Replica migration still applying
Read routed to replica
Query fails: unknown column risk_score
```

Strategi:

1. expand first,
2. wait until all replicas applied DDL,
3. deploy app using new column,
4. backfill safely,
5. switch reads/writes,
6. contract old column later.

Aplikasi juga bisa menyimpan schema compatibility version.

Tetapi jangan membuat logic terlalu rumit jika deployment discipline bisa menyelesaikan.

---

## 44. Binlog and Privacy/Security

Binary log dapat mengandung data sensitif karena ia merekam perubahan data.

Risiko:

- PII masuk binlog,
- credential/token tersimpan dalam event,
- backup binlog tidak terenkripsi,
- CDC consumer menyalin data sensitif ke Kafka/data lake,
- retention binlog melanggar data retention policy,
- developer mendapatkan binlog production tanpa masking.

Praktik:

- enkripsi backup binlog,
- kontrol akses binlog,
- TLS replication,
- data classification,
- minimisasi data sensitif,
- tokenization/encryption at application layer jika perlu,
- CDC filtering dengan governance,
- retention policy yang sinkron dengan regulasi.

---

## 45. Concrete Java Design Example

Misal sistem enforcement lifecycle punya command:

```text
SubmitCaseCommand(caseId, actorId)
```

Flow buruk:

```text
1. Read case from replica
2. Validate state == DRAFT
3. Write state SUBMITTED to primary
```

Jika replica stale, command bisa menilai state lama.

Flow lebih aman:

```text
1. Start transaction on primary
2. SELECT case WHERE case_id = ? FOR UPDATE
3. Validate current state
4. Update state
5. Insert audit event
6. Insert outbox event
7. Commit
8. Return committed state to caller
```

Untuk read setelah submit:

```text
- return state from command response, or
- route detail read to primary for short window, or
- use consistency token/GTID wait pattern if advanced
```

Regulatory defensibility menuntut state transition divalidasi pada data fresh di primary transaction.

---

## 46. Consistency Token Concept

Advanced pattern: setelah write, sistem bisa menghasilkan token yang merepresentasikan posisi transaksi, lalu read dari replica hanya boleh dilakukan jika replica sudah mencapai token tersebut.

Konseptual:

```text
POST /cases -> returns consistencyToken = GTID/current position
GET /cases/{id} with token -> route to replica only if replica has applied token
```

Jika replica belum catch up:

- wait sebentar,
- fallback primary,
- return 202/Retry-After untuk non-critical flow.

Ini lebih kompleks, tetapi berguna untuk sistem high-scale yang ingin tetap memakai replica tanpa mengorbankan read-your-writes.

---

## 47. Checklist: Designing with Replication

Gunakan checklist ini saat mendesain fitur.

### 47.1 Untuk setiap read endpoint

Tanyakan:

- Apakah boleh stale?
- Berapa maksimum stale?
- Apakah dipanggil setelah write?
- Apakah dipakai untuk mengambil keputusan mutasi?
- Apakah harus monotonic?
- Apakah bisa tampilkan freshness timestamp?
- Apa fallback saat replica lag?

### 47.2 Untuk setiap write flow

Tanyakan:

- Apakah semua validasi invariant dilakukan di primary?
- Apakah ada read dari replica sebelum write?
- Apakah retry aman?
- Apakah ada audit event dalam transaksi?
- Apakah ada outbox event?
- Apakah response menghindari immediate stale reread?

### 47.3 Untuk setiap migration

Tanyakan:

- Apakah DDL direplikasi aman?
- Apakah replica bisa lag lama?
- Apakah app baru kompatibel dengan replica lama?
- Apakah migration bisa diulang/resume?
- Apakah deployment menunggu semua replica catch up?

### 47.4 Untuk operasional

Tanyakan:

- Berapa binlog retention?
- Apakah backup dan binlog cukup untuk PITR?
- Apakah replica read-only?
- Apakah replication user minimal privilege?
- Apakah lag dimonitor dari perspektif aplikasi?
- Apakah ada delayed replica?
- Apakah failover runbook jelas?

---

## 48. Common Misconceptions

### 48.1 “Replica berarti data selalu sama”

Salah.

Replica eventually catches up jika replication sehat dan tidak ada drift.

### 48.2 “GET aman diarahkan ke replica”

Salah.

GET bisa butuh fresh data.

### 48.3 “Replication adalah backup”

Salah.

Bad write direplikasi juga.

### 48.4 “Lag 0 berarti semua aman”

Tidak selalu.

Lag metric bisa tidak cukup, channel bisa bermasalah, dan application freshness tetap perlu dipahami.

### 48.5 “Semi-sync berarti strong consistency”

Salah.

Semi-sync membantu durability/RPO, bukan otomatis fresh read dari semua replica.

### 48.6 “Skip replication error itu fix”

Belum tentu.

Bisa membuat replica tidak konsisten.

---

## 49. Practical Local Lab

Untuk memahami replication, buat lab kecil.

### 49.1 Topologi

```text
mysql-primary:3306
mysql-replica:3306
```

Gunakan Docker Compose atau local VM.

### 49.2 Eksperimen wajib

1. enable binary log di primary,
2. setup replica,
3. buat table dan insert data,
4. lihat data muncul di replica,
5. stop applier thread,
6. insert data di primary,
7. lihat replica stale,
8. start applier lagi,
9. ukur lag,
10. buat transaksi besar dan lihat efeknya,
11. coba DDL dan observasi replication,
12. coba baca dari replica setelah write dan amati stale read.

### 49.3 Pertanyaan setelah lab

- Apa bedanya event received dan applied?
- Apa yang terjadi jika replica berhenti 10 menit?
- Apa yang terjadi jika binlog primary dipurge sebelum replica catch up?
- Query mana yang aman dibaca dari replica?
- Bagaimana aplikasi tahu replica terlalu stale?

---

## 50. Production Runbook Sketch

Saat alert replication lag muncul:

```text
1. Classify lag:
   - receiver issue?
   - applier issue?
   - source overload?
   - replica resource issue?

2. Protect application correctness:
   - disable replica reads for critical endpoints
   - show stale mode if needed
   - throttle reporting/background jobs

3. Inspect replication status:
   - IO thread
   - SQL/applier thread
   - last error
   - relay log backlog
   - GTID difference

4. Identify blocker:
   - large transaction
   - DDL
   - disk full
   - lock conflict
   - network
   - purged binlog

5. Decide recovery:
   - wait
   - kill offending read/report
   - add resources
   - rebuild replica
   - controlled skip with reconciliation
   - failover if primary issue

6. Post-incident:
   - why lag happened
   - why app was/was not protected
   - whether freshness policy needs change
   - whether binlog retention is enough
```

---

## 51. Minimal Vocabulary You Must Own

| Term | Meaning |
|---|---|
| Binary log | Source-side log of changes used for replication/PITR/CDC |
| Relay log | Replica-side staging log of received binlog events |
| Source | Server providing replication events |
| Replica | Server receiving/applying replication events |
| GTID | Global transaction identifier for replicated transaction tracking |
| File/position | Legacy physical coordinate in binary log |
| IO/receiver thread | Replica thread receiving events from source |
| SQL/applier thread | Replica thread applying relay log events |
| Row-based logging | Binlog records row changes |
| Statement-based logging | Binlog records SQL statements |
| Mixed logging | MySQL chooses statement or row format depending situation |
| Replication lag | Delay/backlog between source and replica state |
| Read-your-writes | User sees own committed write in subsequent read |
| Delayed replica | Replica intentionally applies changes after configured delay |
| PITR | Point-in-time recovery using backup plus binlog |
| CDC | Change Data Capture from binlog |

---

## 52. Mental Model Summary

Replication adalah event pipeline:

```text
Committed transaction on source
    -> binary log event
    -> transferred to replica
    -> relay log
    -> applied locally
    -> eventually visible on replica
```

Binary log adalah pusat dari:

- replication,
- PITR,
- CDC,
- topology/failover reasoning.

Tetapi replication tidak otomatis memberi:

- strong consistency,
- read-your-writes,
- backup,
- domain audit,
- no-data-loss guarantee,
- safe read/write splitting.

Untuk Java engineer, skill pentingnya bukan hanya tahu cara setup replica. Skill pentingnya adalah bisa menjawab:

> “Read ini boleh dari replica atau harus primary?”

Dan:

> “Kalau replica lag, apa dampaknya ke correctness, bukan hanya ke latency?”

---

## 53. Latihan Desain

Gunakan domain enforcement/case-management.

### Latihan 1 — Case detail read

Endpoint:

```text
GET /cases/{caseId}
```

Pertanyaan:

- kapan boleh dari replica?
- kapan harus primary?
- apakah butuh freshness parameter?
- apakah UI perlu menampilkan “last updated”? 

### Latihan 2 — Submit case

Command:

```text
POST /cases/{caseId}/submit
```

Pertanyaan:

- read apa yang harus primary?
- apakah validasi state boleh dari replica?
- apa yang harus masuk audit event?
- bagaimana response menghindari stale read?

### Latihan 3 — SLA escalation job

Job:

```text
Find cases older than SLA threshold and escalate
```

Pertanyaan:

- boleh scan dari replica?
- jika replica stale, apakah escalation terlambat?
- jika replica drift, apakah escalation salah?
- apakah final update harus validasi ulang di primary?

### Latihan 4 — Reporting export

Feature:

```text
Export closed cases for last quarter
```

Pertanyaan:

- replica cocok?
- berapa stale tolerance?
- bagaimana jika export harus legally accurate as-of timestamp?
- apakah perlu snapshot/consistent read?

---

## 54. Referensi Resmi yang Relevan

Untuk menjaga baseline istilah dan akurasi teknis, bagian ini disusun mengikuti konsep dari dokumentasi resmi MySQL 8.4 tentang:

- replication overview,
- binary log,
- replication implementation,
- relay log,
- replication threads,
- GTID,
- replication formats,
- replication status.

Rujukan utama:

- MySQL 8.4 Reference Manual — Replication
- MySQL 8.4 Reference Manual — Binary Log
- MySQL 8.4 Reference Manual — Replication Implementation
- MySQL 8.4 Reference Manual — Relay Log
- MySQL 8.4 Reference Manual — Replication Threads
- MySQL 8.4 Reference Manual — GTID Concepts
- MySQL 8.4 Reference Manual — Replication Formats

---

## 55. Apa yang Harus Kamu Ingat

Kalau harus diringkas menjadi beberapa prinsip:

1. Binary log adalah log perubahan server-level, bukan redo log.
2. Replication MySQL tradisional berbasis event dari binary log.
3. Replica menerima event ke relay log lalu menerapkannya sendiri.
4. Default replication adalah asynchronous.
5. Replica bisa stale walaupun primary sudah commit.
6. Read/write splitting adalah keputusan consistency, bukan sekadar routing teknis.
7. Row-based logging umumnya lebih aman untuk sistem modern dan CDC.
8. GTID membuat operasi replication/failover jauh lebih manageable.
9. Replication bukan backup.
10. Untuk workflow kritis, validasi invariant harus dilakukan di primary transaction.

---

## 56. Penutup Part 020

Kamu sekarang punya fondasi untuk memahami replication bukan sebagai fitur infra pasif, tetapi sebagai bagian dari desain correctness aplikasi.

Di part berikutnya, kita akan masuk lebih dalam ke area yang paling sering menyebabkan bug aplikasi:

```text
Replication Lag, Read/Write Splitting, and Consistency Boundaries
```

Kita akan membahas secara sistematis bagaimana stale read terjadi, bagaimana routing datasource bisa salah, bagaimana mendesain freshness policy, dan bagaimana mencegah aplikasi Java membuat keputusan bisnis berdasarkan data replica yang tertinggal.

---

# Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 020 / 034 selesai.
```

Bagian berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-021.md
```

Judul berikutnya:

```text
Replication Lag, Read/Write Splitting, and Consistency Boundaries
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Configuration That Actually Matters</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-021.md">Part 021 — Replication Lag, Read/Write Splitting, and Consistency Boundaries ➡️</a>
</div>
