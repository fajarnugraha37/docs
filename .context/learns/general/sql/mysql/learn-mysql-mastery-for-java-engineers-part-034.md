# learn-mysql-mastery-for-java-engineers-part-034.md

# Part 034 — Production Readiness Checklist and Capstone Architecture

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `034 / 034`  
> Topik: Production readiness checklist dan capstone architecture  
> Sasaran pembaca: Java software engineer / tech lead yang ingin mampu mendesain, mengoperasikan, dan mengevaluasi MySQL secara production-grade.

---

## 0. Posisi Bagian Ini dalam Seri

Bagian ini adalah bagian terakhir dari seri MySQL.

Bagian-bagian sebelumnya membangun fondasi secara bertahap:

1. arsitektur MySQL,
2. storage model InnoDB,
3. primary key dan data type,
4. charset/collation,
5. MVCC,
6. isolation level,
7. locking,
8. deadlock,
9. indexing,
10. optimizer,
11. query execution,
12. pagination/search/filtering,
13. transaction boundary di Java,
14. JDBC/Connector/J/HikariCP,
15. write path,
16. buffer pool dan I/O,
17. konfigurasi,
18. replication,
19. HA,
20. backup/restore/PITR,
21. migration,
22. metadata lock,
23. security,
24. observability,
25. incident debugging,
26. application concurrency pattern,
27. partitioning/archiving/retention,
28. JSON/generated columns/full-text,
29. distributed systems,
30. performance engineering.

Bagian ini mengikat semuanya menjadi satu bentuk yang bisa dipakai untuk:

- review arsitektur,
- production readiness assessment,
- pre-launch checklist,
- incident-prevention checklist,
- design review,
- technical due diligence,
- capstone mental model.

Tujuan akhirnya bukan sekadar “bisa memakai MySQL”, tetapi mampu menjawab pertanyaan:

> Apakah sistem ini aman untuk berjalan di production, tumbuh, gagal sebagian, dipulihkan, diaudit, dan dioperasikan oleh manusia?

---

## 1. Prinsip Utama Production Readiness

Production readiness bukan berarti sistem tidak akan pernah gagal.

Production readiness berarti:

1. failure mode-nya diketahui,
2. blast radius-nya dibatasi,
3. recovery path-nya jelas,
4. data correctness-nya defensible,
5. observability-nya cukup untuk membuat keputusan,
6. operasi hariannya bisa dijalankan tanpa heroisme,
7. perubahan schema/config/app bisa dilakukan tanpa menebak-nebak,
8. sistem masih masuk akal ketika volume, concurrency, dan kompleksitas naik.

Untuk MySQL, production readiness harus dilihat di beberapa lapisan:

```text
Business invariant
  ↓
Domain model
  ↓
Schema design
  ↓
Transaction design
  ↓
Query/index design
  ↓
Connection/pool/timeout design
  ↓
MySQL storage/logging/config design
  ↓
Replication/HA/backup design
  ↓
Observability/runbook design
  ↓
Team operating model
```

Kesalahan umum adalah mengevaluasi MySQL hanya dari sisi query performance. Padahal banyak kegagalan production bukan berasal dari query lambat saja, melainkan dari:

- transaksi terlalu panjang,
- lock footprint tidak dipahami,
- migration menunggu metadata lock,
- backup belum pernah direstore,
- read replica dipakai untuk read yang butuh read-your-writes,
- connection pool terlalu besar,
- retry dilakukan tanpa idempotency,
- query plan berubah setelah data distribution berubah,
- failover menyebabkan duplicate side effect,
- retention delete menyebabkan replication lag,
- audit trail tidak bisa membuktikan transisi state.

---

## 2. Production Readiness sebagai Kumpulan Invariant

Checklist yang baik bukan sekadar daftar “sudah pakai ini atau belum”.

Checklist yang baik harus menanyakan invariant.

Contoh buruk:

```text
[ ] Sudah punya index.
```

Contoh lebih baik:

```text
[ ] Semua query P95/P99 critical path memiliki access path yang diketahui, diuji dengan data distribution realistis, dan tidak bergantung pada full table scan.
```

Contoh buruk:

```text
[ ] Sudah punya backup.
```

Contoh lebih baik:

```text
[ ] Backup terakhir dapat direstore ke environment terpisah, dapat mencapai target recovery point, dan waktu restore memenuhi RTO.
```

Contoh buruk:

```text
[ ] Sudah ada replication.
```

Contoh lebih baik:

```text
[ ] Aplikasi mengetahui operasi mana yang boleh membaca dari replica dan operasi mana yang wajib membaca dari primary karena consistency boundary.
```

Top 1% engineer biasanya tidak berhenti pada checklist teknis. Mereka bertanya:

- invariant apa yang harus selalu benar?
- kondisi apa yang bisa melanggarnya?
- apakah database membantu menjaga invariant itu?
- apakah aplikasi bisa membuat invariant itu rusak walaupun database sehat?
- apakah observability dapat membuktikan invariant itu masih benar?
- ketika invariant rusak, apakah ada recovery plan?

---

## 3. Layer 1 — Business and Data Correctness Checklist

MySQL bukan hanya storage. Ia adalah boundary correctness.

Sebelum membahas buffer pool, index, HA, atau JDBC, sistem harus menjawab:

### 3.1 Entity dan Ownership

Checklist:

- [ ] Semua entity inti jelas owner-nya.
- [ ] Setiap table punya alasan eksistensi yang eksplisit.
- [ ] Setiap row punya lifecycle.
- [ ] Setiap entity punya identity strategy yang stabil.
- [ ] Tidak ada entity penting yang hanya dikenali dari text label mutable.
- [ ] External reference ID dipisahkan dari internal primary key jika lifecycle-nya berbeda.
- [ ] Semua unique business key penting dinyatakan sebagai constraint, bukan hanya dicek di aplikasi.
- [ ] Semua foreign key penting diputuskan secara sadar:
  - enforced oleh DB,
  - atau tidak enforced karena alasan arsitektural yang terdokumentasi.

Pertanyaan review:

- Apa yang membuat sebuah case unik?
- Apa yang membuat sebuah subject unik?
- Apakah ID yang dilihat user sama dengan primary key internal?
- Apakah reference number bisa berubah?
- Apakah ada duplicate prevention di database?
- Apakah import batch bisa menciptakan duplicate jika retry terjadi?

### 3.2 State Machine dan Transisi

Untuk regulatory/case-management platform, banyak data bukan sekadar CRUD. Banyak entity adalah state machine.

Checklist:

- [ ] Semua state utama terdokumentasi.
- [ ] Semua transisi legal terdokumentasi.
- [ ] Transisi ilegal dicegah oleh service/domain layer.
- [ ] Transisi race-sensitive dilindungi dengan:
  - optimistic locking,
  - pessimistic locking,
  - conditional update,
  - atau unique constraint.
- [ ] Setiap transisi penting menghasilkan audit event.
- [ ] Audit event tidak boleh hilang ketika transaksi sukses.
- [ ] Side effect eksternal tidak terjadi sebelum commit durable, kecuali ada kompensasi jelas.
- [ ] Retry transisi bersifat idempotent.

Contoh pola aman:

```sql
UPDATE enforcement_case
SET status = 'UNDER_REVIEW',
    version = version + 1,
    updated_at = NOW(6)
WHERE id = ?
  AND status = 'SUBMITTED'
  AND version = ?;
```

Invariant:

```text
Jika affected_rows = 1, transisi berhasil.
Jika affected_rows = 0, state/version sudah berubah atau input tidak valid.
```

Ini lebih kuat dibanding pola:

```sql
SELECT status FROM enforcement_case WHERE id = ?;
-- check in Java
UPDATE enforcement_case SET status = ? WHERE id = ?;
```

Pola kedua membuka race condition jika tidak ada lock atau version check.

### 3.3 Auditability

Checklist:

- [ ] Semua perubahan penting memiliki audit trail.
- [ ] Audit trail disimpan dalam transaksi yang sama dengan perubahan state.
- [ ] Audit trail memiliki:
  - actor,
  - action,
  - timestamp,
  - old value bila relevan,
  - new value bila relevan,
  - correlation ID,
  - request ID,
  - source system,
  - reason/justification bila regulatory.
- [ ] Audit row immutable secara aplikasi.
- [ ] Tidak ada update/delete audit tanpa privileged operational path.
- [ ] Time source konsisten.
- [ ] Time zone policy jelas.
- [ ] Audit query punya index yang sesuai.
- [ ] Audit retention policy jelas.

Anti-pattern:

```text
Business state diupdate di MySQL, audit event dikirim ke Kafka setelah commit tanpa outbox.
```

Jika aplikasi crash setelah commit sebelum publish, audit/event bisa hilang.

Pola lebih aman:

```text
Dalam satu transaksi:
  update business table
  insert audit_event
  insert outbox_event

Setelah commit:
  outbox relay publish event
```

---

## 4. Layer 2 — Schema Design Checklist

Schema adalah kontrak jangka panjang.

Migration app bisa berubah cepat, tapi data hidup lama. Schema buruk sering menjadi hutang paling mahal karena:

- sulit diubah tanpa downtime,
- query menjadi tidak stabil,
- constraint tidak bisa ditambahkan karena data kotor,
- indexing menjadi mahal,
- integritas data bergantung pada asumsi aplikasi lama.

### 4.1 Table Design

Checklist:

- [ ] Setiap table punya primary key eksplisit.
- [ ] Primary key dipilih dengan sadar terhadap InnoDB clustered index.
- [ ] Primary key tidak terlalu lebar tanpa alasan kuat.
- [ ] Primary key tidak random-heavy pada hot insert table kecuali trade-off diterima.
- [ ] Tidak ada table transactional besar tanpa primary key.
- [ ] Column nullability dipilih secara sengaja.
- [ ] Default value tidak menyembunyikan missing data.
- [ ] `created_at`, `updated_at`, dan actor metadata dipakai konsisten.
- [ ] Soft delete dipilih hanya jika benar-benar dibutuhkan.
- [ ] Jika ada soft delete, semua unique/index/query pattern memperhitungkannya.
- [ ] Table growth rate diketahui.
- [ ] Retention policy diketahui sejak awal untuk table besar.

### 4.2 Data Type

Checklist:

- [ ] Monetary value memakai `DECIMAL`, bukan floating point.
- [ ] Timestamp policy jelas:
  - `TIMESTAMP`,
  - `DATETIME`,
  - UTC,
  - precision,
  - conversion di Java.
- [ ] String length dipilih berdasarkan domain, bukan default `VARCHAR(255)` sembarangan.
- [ ] `utf8mb4` digunakan sebagai baseline modern.
- [ ] Collation dipilih sadar terhadap case/accent sensitivity.
- [ ] UUID dipertimbangkan secara storage:
  - text UUID mahal,
  - binary UUID lebih hemat,
  - random UUID buruk untuk clustered insert locality.
- [ ] JSON dipakai untuk data semi-structured yang tidak dominan dalam query critical path.
- [ ] JSON field yang sering difilter diindeks lewat generated/functional/multi-valued index bila layak.
- [ ] Large text/blob tidak dicampur sembarangan dengan hot row.

### 4.3 Constraint

Checklist:

- [ ] Unique constraint dipakai untuk invariant uniqueness penting.
- [ ] Foreign key dipakai ketika integritas referential lokal lebih penting daripada loose coupling.
- [ ] Check constraint dipakai untuk invariant sederhana bila sesuai.
- [ ] Application validation tidak dianggap cukup untuk invariant database.
- [ ] Semua constraint memiliki nama yang jelas.
- [ ] Semua constraint dievaluasi terhadap migration/backfill cost.
- [ ] Semua constraint violation dipetakan ke error domain aplikasi.

Contoh:

```sql
CREATE TABLE idempotency_key (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    operation_type VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash BINARY(32) NOT NULL,
    response_ref VARCHAR(128) NULL,
    status ENUM('IN_PROGRESS', 'COMPLETED', 'FAILED') NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_operation_key (operation_type, idempotency_key)
);
```

Invariant:

```text
Operasi dengan operation_type + idempotency_key yang sama hanya boleh dieksekusi sekali.
```

Database menjaga invariant ini lebih baik daripada `SELECT` lalu `INSERT` tanpa constraint.

---

## 5. Layer 3 — Transaction Design Checklist

Transaksi adalah unit correctness, bukan hanya unit commit.

### 5.1 Transaction Boundary

Checklist:

- [ ] Setiap use case write memiliki transaction boundary eksplisit.
- [ ] Boundary tidak terlalu kecil sampai invariant terpecah.
- [ ] Boundary tidak terlalu besar sampai lock ditahan terlalu lama.
- [ ] Tidak ada external network call di dalam transaksi kecuali sangat sadar.
- [ ] Tidak ada user interaction menunggu di dalam transaksi.
- [ ] Tidak ada stream result besar sambil transaksi tetap terbuka tanpa alasan kuat.
- [ ] Tidak ada sleep/retry loop di dalam transaksi.
- [ ] Semua transaksi memiliki timeout.
- [ ] Semua lock wait/deadlock error diklasifikasikan dengan benar.
- [ ] Retry hanya dilakukan pada operasi yang idempotent atau aman diulang.

### 5.2 Java/Spring Transaction Checklist

- [ ] `@Transactional` dipasang di service boundary, bukan sembarang helper.
- [ ] Self-invocation Spring proxy dipahami.
- [ ] Propagation dipilih sadar:
  - `REQUIRED`,
  - `REQUIRES_NEW`,
  - `NESTED` jika didukung/diinginkan.
- [ ] Read-only transaction tidak dianggap magic performance optimizer.
- [ ] Exception rollback behavior jelas:
  - unchecked,
  - checked,
  - custom rollback rules.
- [ ] Transaction timeout berbeda dari query timeout dan socket timeout.
- [ ] Transaction tidak bocor karena connection pool misuse.
- [ ] Lazy loading tidak memanjangkan transaksi secara tidak sengaja.
- [ ] ORM flush timing dipahami.
- [ ] Batch write size dikontrol.

### 5.3 Retry Boundary

Retry yang benar berada di boundary yang bisa diulang secara aman.

Contoh buruk:

```text
try transaction:
  charge card
  update database
retry if deadlock
```

Jika deadlock terjadi setelah charge card tapi sebelum DB update, retry bisa menagih dua kali.

Contoh lebih baik:

```text
try transaction:
  persist payment intent
  persist outbox event

after commit:
  payment worker charges provider idempotently using provider idempotency key
  update payment result transactionally
```

Checklist:

- [ ] Deadlock retry punya maksimum percobaan.
- [ ] Retry memakai backoff/jitter.
- [ ] Retry tidak mengulang side effect eksternal non-idempotent.
- [ ] Duplicate key error diperlakukan sebagai possible success untuk idempotent operation bila sesuai.
- [ ] Uncertain commit dipahami:
  - client timeout tidak selalu berarti transaksi gagal.
- [ ] Correlation ID dipakai untuk investigasi.

---

## 6. Layer 4 — Locking and Concurrency Checklist

### 6.1 Lock Footprint

Checklist:

- [ ] Semua query `UPDATE`, `DELETE`, `SELECT ... FOR UPDATE` punya index access path jelas.
- [ ] Range predicate dipahami efeknya terhadap gap/next-key locks.
- [ ] Unique lookup dipakai jika ingin lock sempit.
- [ ] Missing index tidak menyebabkan locking terlalu luas.
- [ ] Batch update/delete dipecah dengan ukuran terkendali.
- [ ] Urutan update multi-row konsisten.
- [ ] Foreign key locking dipahami.
- [ ] Queue-like workload memakai pola yang memang cocok.
- [ ] `SKIP LOCKED` hanya dipakai untuk work queue atau workload yang toleran view tidak konsisten.
- [ ] Deadlock dianggap expected transient failure, bukan selalu bug database.

### 6.2 Optimistic vs Pessimistic

Gunakan optimistic locking ketika:

- konflik jarang,
- user flow panjang,
- entity dibaca lalu diputuskan di aplikasi,
- retry/feedback user acceptable.

Gunakan pessimistic locking ketika:

- konflik sering,
- resource harus exclusive,
- reservation window pendek,
- decision dibuat segera dalam transaksi.

Gunakan unique constraint ketika:

- invariant adalah uniqueness,
- race condition harus diselesaikan oleh database,
- duplicate creation harus dicegah deterministik.

Gunakan state-guarded update ketika:

- state transition harus atomic,
- current state menentukan legal transition,
- affected rows bisa menjadi hasil concurrency decision.

Contoh state-guarded update:

```sql
UPDATE case_assignment
SET assignee_id = ?,
    status = 'ASSIGNED',
    version = version + 1
WHERE case_id = ?
  AND status = 'UNASSIGNED';
```

Tidak perlu selalu:

```sql
SELECT ... FOR UPDATE
```

Jika satu conditional `UPDATE` cukup menjaga invariant, itu sering lebih sederhana.

---

## 7. Layer 5 — Query and Index Checklist

### 7.1 Query Inventory

Checklist:

- [ ] Semua query critical path diketahui.
- [ ] Semua query dashboard/reporting besar diketahui.
- [ ] Semua query generated ORM penting diinspeksi.
- [ ] Query cardinality tinggi/rendah diketahui.
- [ ] Query fan-out diketahui.
- [ ] Query yang berjalan dalam transaksi write diberi perhatian khusus.
- [ ] Query admin/backoffice tidak diasumsikan aman hanya karena internal.
- [ ] Query scheduled job diuji dengan data volume realistis.

Inventory minimal:

```text
Query Name:
Owner:
Endpoint/job:
Frequency:
Peak QPS:
Expected rows read:
Expected rows returned:
Latency SLO:
Consistency requirement:
Transaction context:
Index used:
EXPLAIN baseline:
Failure mode:
```

### 7.2 Index Design

Checklist:

- [ ] Index didesain dari workload, bukan dari satu query terisolasi.
- [ ] Composite index mengikuti pola equality/range/order/limit.
- [ ] Pagination critical memakai seek/keyset pagination bila data besar.
- [ ] Offset pagination dibatasi untuk page dangkal atau data kecil.
- [ ] Covering index dipakai untuk query latency-sensitive bila biaya write layak.
- [ ] Index low-cardinality tidak dibuat sembarangan.
- [ ] Index redundant dievaluasi.
- [ ] Index write-heavy dievaluasi dampaknya ke insert/update.
- [ ] Invisible index dipakai untuk eksperimen removal jika cocok.
- [ ] Index baru divalidasi dengan `EXPLAIN`/`EXPLAIN ANALYZE` pada data realistis.
- [ ] Statistik/histogram dievaluasi jika plan sering salah.
- [ ] Query dengan optional filters tidak menghasilkan kombinasi index yang mustahil dikelola.

### 7.3 Plan Stability

Checklist:

- [ ] Baseline execution plan disimpan untuk query penting.
- [ ] Plan diuji setelah data distribution berubah.
- [ ] Plan diuji setelah index baru ditambahkan.
- [ ] Plan diuji setelah upgrade MySQL.
- [ ] Query hint tidak dipakai sebagai default reaction.
- [ ] Statistik table diperhatikan.
- [ ] Data skew dipahami.
- [ ] Parameter value ekstrem diuji.
- [ ] Regression test mencakup query performance penting.

---

## 8. Layer 6 — Java Integration Checklist

### 8.1 JDBC/Connector/J

Checklist:

- [ ] JDBC URL terdokumentasi.
- [ ] Time zone behavior eksplisit.
- [ ] TLS setting sesuai environment.
- [ ] Prepared statement behavior dipahami.
- [ ] Server-side/client-side prepared statement trade-off dipahami.
- [ ] Batch insert/update behavior diuji.
- [ ] Generated key retrieval diuji.
- [ ] Streaming result set hanya dipakai dengan sadar.
- [ ] Socket/read/connect timeout dikonfigurasi.
- [ ] Auto-reconnect tidak dipakai untuk menyembunyikan failure transaksi.
- [ ] SQL exception diklasifikasikan:
  - duplicate key,
  - deadlock,
  - lock wait timeout,
  - connection failure,
  - timeout,
  - syntax/schema mismatch.

### 8.2 Connection Pool

Checklist:

- [ ] Pool size dihitung dari capacity database, bukan jumlah thread aplikasi.
- [ ] `maximumPoolSize` tidak melebihi kemampuan MySQL melayani concurrency efektif.
- [ ] Leak detection diaktifkan minimal di staging/perf environment.
- [ ] Connection timeout jelas.
- [ ] Idle lifetime/max lifetime lebih pendek dari timeout jaringan/load balancer bila perlu.
- [ ] Aplikasi tidak membuka koneksi manual di luar pool.
- [ ] Transaction selalu mengembalikan connection.
- [ ] Pool metrics diekspor:
  - active,
  - idle,
  - pending,
  - acquisition time,
  - timeout count.
- [ ] Connection storm saat deploy/failover diperhitungkan.

Anti-pattern:

```text
Service A punya 100 instance.
Setiap instance Hikari maximumPoolSize = 50.
Total potential connection = 5000.
MySQL max_connections = 1000.
```

Ini bukan HA. Ini bom waktu.

### 8.3 ORM/JPA/MyBatis

Checklist:

- [ ] Generated SQL diperiksa.
- [ ] N+1 query dideteksi.
- [ ] Lazy/eager loading dipilih secara sadar.
- [ ] Batch size dikontrol.
- [ ] Dirty checking tidak menyebabkan update tidak perlu.
- [ ] Transaction boundary tidak terlalu melebar karena ORM session.
- [ ] Lock mode JPA diterjemahkan ke SQL yang dipahami.
- [ ] Optimistic locking memakai version column.
- [ ] Native SQL dipakai jika ORM menghasilkan query buruk.
- [ ] Migration DDL tidak diserahkan penuh ke ORM auto-ddl di production.

---

## 9. Layer 7 — MySQL Configuration Checklist

Konfigurasi bukan pengganti desain.

Namun konfigurasi buruk bisa menghancurkan desain yang baik.

### 9.1 Baseline

Checklist:

- [ ] Version MySQL diketahui dan didokumentasikan.
- [ ] Edition/distribution diketahui:
  - Oracle MySQL Community,
  - Enterprise,
  - managed cloud MySQL-compatible,
  - Percona,
  - MariaDB bukan MySQL murni.
- [ ] SQL mode eksplisit.
- [ ] Character set dan collation default eksplisit.
- [ ] Time zone default eksplisit.
- [ ] Binary logging policy eksplisit.
- [ ] GTID policy eksplisit jika memakai replication.
- [ ] Slow query log policy eksplisit.
- [ ] Performance Schema aktif dan overhead diterima.
- [ ] Config source of truth jelas:
  - file,
  - persisted variables,
  - cloud parameter group,
  - automation/IaC.

### 9.2 Durability

Checklist:

- [ ] `innodb_flush_log_at_trx_commit` dipilih sesuai durability requirement.
- [ ] `sync_binlog` dipilih sesuai replication/PITR durability requirement.
- [ ] Doublewrite behavior dipahami.
- [ ] Storage layer reliability dipahami.
- [ ] fsync latency dimonitor.
- [ ] Commit latency dimonitor.
- [ ] Trade-off durability vs throughput disetujui secara eksplisit, bukan accidental.

### 9.3 Memory and I/O

Checklist:

- [ ] Buffer pool size sesuai workload dan host memory.
- [ ] Per-connection memory dipertimbangkan terhadap max connections.
- [ ] Temporary table behavior dimonitor.
- [ ] Disk spill dimonitor.
- [ ] Dirty page flushing dimonitor.
- [ ] I/O capacity dikonfigurasi sesuai storage.
- [ ] Working set diperkirakan.
- [ ] Disk full alert ada.
- [ ] Binary log retention tidak membuat disk penuh.
- [ ] Undo/purge health dimonitor.

### 9.4 Timeout

Checklist:

- [ ] MySQL lock wait timeout jelas.
- [ ] Query timeout di aplikasi jelas.
- [ ] Socket timeout jelas.
- [ ] Connection acquisition timeout jelas.
- [ ] Load balancer/network idle timeout diketahui.
- [ ] Timeout hierarchy masuk akal.
- [ ] Timeout error tidak langsung dianggap “transaksi gagal”.
- [ ] Long-running job punya jalur terpisah dari request path bila perlu.

Contoh hierarchy:

```text
HTTP request timeout:        5s
DB query timeout:            3s
Connection acquisition:      500ms
Socket timeout:              4s
Transaction timeout:         4s
Lock wait timeout:           small for OLTP critical path
```

Ini hanya contoh. Angka harus mengikuti workload.

---

## 10. Layer 8 — Replication, HA, and Consistency Checklist

### 10.1 Replication

Checklist:

- [ ] Replication format dipahami.
- [ ] GTID dipahami jika digunakan.
- [ ] Replica lag dimonitor.
- [ ] Lag metric tidak dianggap sempurna.
- [ ] Replica apply throughput cukup untuk peak write.
- [ ] Read replica tidak dipakai untuk write-after-read critical path.
- [ ] Replica role jelas:
  - scale read,
  - reporting,
  - backup,
  - delayed recovery,
  - DR.
- [ ] Replication filter tidak menciptakan data surprise.
- [ ] Schema migration diuji terhadap replication lag.
- [ ] Large transaction impact ke replica dipahami.

### 10.2 Read/Write Splitting

Checklist:

- [ ] Semua read dikategorikan:
  - must be primary,
  - replica acceptable,
  - stale OK,
  - analytical/reporting.
- [ ] Read-your-writes requirement eksplisit.
- [ ] Session stickiness dipakai jika perlu.
- [ ] Failover behavior routing jelas.
- [ ] Transaction read/write routing tidak salah karena `readOnly=true`.
- [ ] Cache tidak menyembunyikan stale replica problem.
- [ ] UI messaging memperhitungkan eventual consistency bila ada.

Contoh kategori:

```text
Submit case -> redirect case detail:
  read from primary.

Dashboard aggregate:
  read from reporting replica acceptable.

Export monthly archive:
  read from replica/snapshot acceptable.

Fraud/escalation decision:
  read from primary or strongly consistent boundary.
```

### 10.3 HA

Checklist:

- [ ] RTO diketahui.
- [ ] RPO diketahui.
- [ ] Failover mechanism diketahui:
  - manual,
  - orchestrated,
  - managed service,
  - InnoDB Cluster,
  - Group Replication,
  - cloud HA.
- [ ] Split-brain prevention dipahami.
- [ ] Fencing strategy ada.
- [ ] Application reconnect behavior diuji.
- [ ] In-flight transaction behavior dipahami.
- [ ] Idempotency untuk retry setelah failover ada.
- [ ] DNS/proxy/router behavior diuji.
- [ ] Failover drill dilakukan.
- [ ] Runbook failback ada.
- [ ] Monitoring membedakan primary vs replica role.

---

## 11. Layer 9 — Backup, Restore, PITR, and DR Checklist

### 11.1 Backup

Checklist:

- [ ] Backup strategy jelas:
  - logical,
  - physical,
  - snapshot,
  - MySQL Shell dump,
  - clone,
  - managed backup.
- [ ] Backup schedule memenuhi RPO.
- [ ] Backup retention memenuhi policy.
- [ ] Backup encryption aktif.
- [ ] Backup access dikontrol.
- [ ] Backup disimpan terpisah dari primary failure domain.
- [ ] Binary log retention sesuai PITR requirement.
- [ ] Backup tidak membebani primary secara berbahaya.
- [ ] Backup dari replica memperhitungkan replica consistency.

### 11.2 Restore

Checklist:

- [ ] Restore diuji rutin.
- [ ] Restore time memenuhi RTO.
- [ ] Restore instruction terdokumentasi.
- [ ] Restore dapat dilakukan oleh lebih dari satu orang.
- [ ] PITR diuji sampai timestamp/position tertentu.
- [ ] Data verification setelah restore ada.
- [ ] Application smoke test setelah restore ada.
- [ ] Restore environment aman dari koneksi production tidak sengaja.
- [ ] Secret/config restore environment dipisahkan.
- [ ] Drill mencakup scenario operator error:
  - bad deploy,
  - accidental delete,
  - bad migration,
  - corrupted import.

### 11.3 Disaster Recovery

Checklist:

- [ ] DR topology jelas.
- [ ] Region/AZ failure dipertimbangkan.
- [ ] Data sovereignty/regulatory boundary dipertimbangkan.
- [ ] Cross-region lag dipantau.
- [ ] DR promotion procedure ada.
- [ ] DR rollback/failback procedure ada.
- [ ] RTO/RPO dikomunikasikan ke business stakeholder.
- [ ] Partial restore strategy ada untuk table/entity tertentu bila relevan.
- [ ] Legal hold dipertimbangkan dalam restore/purge.

---

## 12. Layer 10 — Schema Migration Checklist

Migration adalah salah satu sumber outage paling umum.

### 12.1 Pre-Migration

Checklist:

- [ ] DDL impact diketahui:
  - instant,
  - inplace,
  - copy/rebuild.
- [ ] Metadata lock risk dievaluasi.
- [ ] Long-running transaction dicek sebelum migration.
- [ ] Query traffic pada table target diketahui.
- [ ] Table size diketahui.
- [ ] Replication lag impact diprediksi.
- [ ] Backup/PITR tersedia sebelum migration berisiko.
- [ ] Rollback plan realistis.
- [ ] Application compatibility dicek.
- [ ] Migration diuji di data volume mirip production.
- [ ] Migration window disetujui jika perlu.

### 12.2 During Migration

Checklist:

- [ ] Migration progress dimonitor.
- [ ] Metadata lock wait dimonitor.
- [ ] Replication lag dimonitor.
- [ ] Error log dipantau.
- [ ] Kill criteria jelas.
- [ ] Kill command tidak dieksekusi impulsif.
- [ ] Application error rate dipantau.
- [ ] Slow query spike dipantau.
- [ ] Backfill throttle aktif bila perlu.

### 12.3 Post-Migration

Checklist:

- [ ] Schema verified.
- [ ] Query plan critical verified.
- [ ] Application compatibility verified.
- [ ] Replication health verified.
- [ ] Index usage verified.
- [ ] Old column/index cleanup dijadwalkan.
- [ ] Documentation updated.
- [ ] Migration lesson captured.

### 12.4 Expand-Contract Pattern

Untuk perubahan besar, gunakan pola:

```text
1. Expand schema:
   tambah column/table/index baru yang backward-compatible.

2. Deploy app dual-compatible:
   app bisa membaca format lama dan baru.

3. Backfill:
   isi data baru secara bertahap.

4. Switch read path:
   app membaca dari schema baru.

5. Stop old write:
   app tidak lagi menulis schema lama.

6. Contract:
   drop old column/index/table setelah aman.
```

Ini menghindari “big bang migration”.

---

## 13. Layer 11 — Security and Audit Checklist

### 13.1 Account and Privilege

Checklist:

- [ ] Runtime app user berbeda dari migration user.
- [ ] Read-only user berbeda dari write user.
- [ ] Admin user tidak dipakai aplikasi.
- [ ] Privilege minimum diterapkan.
- [ ] Host-qualified user dipahami.
- [ ] Password rotation strategy ada.
- [ ] Secret tidak disimpan di repository.
- [ ] Secret injection via environment/secret manager aman.
- [ ] Emergency access procedure ada.
- [ ] User deprovisioning procedure ada.

### 13.2 TLS and Network

Checklist:

- [ ] TLS digunakan sesuai threat model.
- [ ] Certificate validation tidak dimatikan sembarangan.
- [ ] Database tidak terbuka publik.
- [ ] Security group/firewall terbatas.
- [ ] Bastion/proxy/audit path jelas.
- [ ] Network path app-to-db dipahami.
- [ ] Cross-region/network latency dipertimbangkan.

### 13.3 SQL Injection and Query Safety

Checklist:

- [ ] Prepared statements digunakan untuk values.
- [ ] Dynamic SQL identifier divalidasi via whitelist.
- [ ] Sort field/filter field dari UI tidak langsung disisipkan.
- [ ] LIMIT/OFFSET divalidasi.
- [ ] Bulk import divalidasi.
- [ ] Error message tidak membocorkan SQL detail sensitif.
- [ ] Query builder diuji untuk edge case.
- [ ] Least privilege membatasi dampak injection.

### 13.4 Audit and Compliance

Checklist:

- [ ] Sensitive table access dimonitor.
- [ ] Privileged operation diaudit.
- [ ] Data export diaudit.
- [ ] Data deletion/purge diaudit.
- [ ] Audit log retention sesuai policy.
- [ ] Audit log integrity dipertimbangkan.
- [ ] PII/tokenization/masking policy jelas.
- [ ] Backup juga mengikuti privacy/security requirement.

---

## 14. Layer 12 — Observability and Alerting Checklist

Observability harus menjawab pertanyaan saat sistem sedang buruk.

### 14.1 Metrics

Checklist minimal MySQL:

- [ ] CPU.
- [ ] Memory.
- [ ] Disk usage.
- [ ] Disk IOPS/latency.
- [ ] Connections:
  - active,
  - max,
  - aborted,
  - waiting.
- [ ] Queries per second.
- [ ] Slow queries.
- [ ] Row examined vs row returned.
- [ ] InnoDB buffer pool hit ratio.
- [ ] Dirty pages.
- [ ] Redo log pressure.
- [ ] History list length / purge lag.
- [ ] Lock waits.
- [ ] Deadlocks.
- [ ] Temporary tables to disk.
- [ ] Replication lag.
- [ ] Replica IO/apply status.
- [ ] Binary log disk usage.
- [ ] Transaction commit latency if available.
- [ ] Backup success/failure.
- [ ] Restore drill status.

Checklist aplikasi Java:

- [ ] DB call latency P50/P95/P99.
- [ ] Per-query/endpoint latency.
- [ ] Connection pool active/idle/pending.
- [ ] Connection acquisition timeout.
- [ ] SQL exception rate by class.
- [ ] Retry count.
- [ ] Deadlock retry success/failure.
- [ ] Transaction duration.
- [ ] Request correlation ID propagated.
- [ ] Slow endpoint correlated with DB statements.

### 14.2 Logs

Checklist:

- [ ] Slow query log enabled with sane threshold.
- [ ] Error log collected.
- [ ] Application logs include correlation ID.
- [ ] SQL parameter logging policy aman terhadap PII.
- [ ] Migration logs retained.
- [ ] Backup/restore logs retained.
- [ ] Failover event logs retained.
- [ ] Audit logs protected.

### 14.3 Tracing

Checklist:

- [ ] DB spans ada dalam distributed tracing.
- [ ] Query name/fingerprint dipakai, bukan raw SQL sensitif penuh.
- [ ] Transaction boundary terlihat.
- [ ] Pool acquisition time terlihat.
- [ ] External side effect trace dikorelasikan dengan DB commit/outbox.
- [ ] Batch job trace dipisahkan dari request trace.

### 14.4 Alerts

Alert yang baik punya action.

Contoh alert actionable:

```text
Replica apply lag > 60s for 5 minutes on production read replica used by dashboard.
Action:
  disable read routing to replica for critical reads,
  inspect applier,
  check large transaction/backfill,
  notify on-call.
```

Contoh alert buruk:

```text
CPU > 70%
```

Tanpa konteks, ini sering noise.

Alert penting:

- [ ] Primary unavailable.
- [ ] Replica replication stopped.
- [ ] Replica lag above threshold.
- [ ] Disk usage critical.
- [ ] Connection exhaustion approaching.
- [ ] Deadlock spike.
- [ ] Lock wait spike.
- [ ] Slow query spike.
- [ ] Backup failed.
- [ ] No successful restore drill in policy window.
- [ ] Metadata lock wait during migration.
- [ ] Binary log disk risk.
- [ ] App connection acquisition timeout spike.
- [ ] Error rate from DB exceptions spike.

---

## 15. Layer 13 — Incident Runbook Checklist

### 15.1 First Five Minutes

Saat incident MySQL terjadi, jangan langsung “tuning”.

Langkah awal:

1. Pastikan scope:
   - satu service?
   - semua service?
   - primary?
   - replica?
   - satu query?
   - semua query?
2. Pastikan symptom:
   - latency?
   - error?
   - timeout?
   - connection exhaustion?
   - lock wait?
   - deadlock?
   - replication lag?
   - disk full?
3. Pastikan recent change:
   - deploy app?
   - migration?
   - config change?
   - traffic spike?
   - batch job?
   - backup?
   - failover?
4. Ambil snapshot observability:
   - processlist,
   - slow queries,
   - locks,
   - transaction age,
   - pool metrics,
   - replication status,
   - disk.
5. Pilih mitigasi yang mengurangi blast radius:
   - disable expensive feature,
   - stop batch job,
   - route critical reads to primary,
   - scale app carefully,
   - kill specific blocker,
   - pause migration.

### 15.2 Jangan Lakukan Ini Secara Refleks

- Jangan restart primary tanpa memahami state.
- Jangan kill random session.
- Jangan tambah connection pool saat DB sudah overload.
- Jangan tambah index saat metadata lock problem sedang terjadi.
- Jangan menjalankan query diagnosis berat di primary yang sedang sekarat.
- Jangan menganggap timeout berarti rollback.
- Jangan promosi replica tanpa memahami data loss boundary.
- Jangan restore backup ke production tanpa isolasi.
- Jangan drop table/index dalam panic.

### 15.3 Incident Categories

#### A. DB CPU High

Kemungkinan:

- full scan,
- bad plan,
- query storm,
- missing index,
- ORM N+1,
- temp table/sort besar,
- connection storm.

Tindakan:

- lihat top digest,
- korelasi dengan deploy,
- throttle caller,
- disable feature,
- add targeted index nanti setelah stabil,
- verify plan.

#### B. Lock Wait Spike

Kemungkinan:

- long transaction,
- range update,
- migration MDL,
- missing index on update/delete,
- FK cascade,
- queue contention.

Tindakan:

- identifikasi blocker,
- cek transaction age,
- cek statement blocker,
- kill blocker jika aman,
- pause migration/batch,
- review index/predicate.

#### C. Connection Exhaustion

Kemungkinan:

- app pool terlalu besar,
- connection leak,
- slow query menyebabkan connection tertahan,
- DB down/reconnect storm,
- traffic spike.

Tindakan:

- cek pool metrics,
- turunkan traffic,
- stop leaking deployment,
- scale aplikasi tidak selalu membantu,
- batasi max connections per app,
- cek query latency.

#### D. Replication Lag

Kemungkinan:

- large transaction,
- slow applier,
- DDL,
- disk I/O,
- replica underpowered,
- batch write spike.

Tindakan:

- route critical reads ke primary,
- pause heavy jobs,
- cek applier status,
- cek latest large transaction,
- jangan blindly promote lagging replica.

#### E. Migration Stuck

Kemungkinan:

- metadata lock wait,
- long transaction,
- DDL copy/rebuild,
- replication lag.

Tindakan:

- cek metadata locks,
- identifikasi blocker,
- putuskan kill blocker vs kill migration,
- jangan launch migration kedua,
- dokumentasikan timeline.

---

## 16. Capstone Architecture: Regulatory Enforcement Lifecycle Platform

Sekarang kita bentuk contoh sistem end-to-end.

### 16.1 Domain

Bayangkan platform untuk mengelola lifecycle enforcement case:

- intake complaint/report,
- entity/subject resolution,
- case creation,
- triage,
- assignment,
- investigation,
- evidence collection,
- decision,
- enforcement action,
- appeal,
- closure,
- retention/archival,
- audit/reporting.

Domain utama:

```text
Subject
  ├─ Person
  ├─ Company
  └─ Regulated Entity

Case
  ├─ Intake
  ├─ Triage
  ├─ Assignment
  ├─ Investigation
  ├─ Decision
  ├─ Enforcement Action
  ├─ Appeal
  └─ Closure

Evidence
  ├─ Document metadata
  ├─ External reference
  └─ Chain of custody

Audit Event

Workflow Task

SLA / Escalation

Outbox Event

Search Projection

Reporting Snapshot
```

### 16.2 High-Level Architecture

```text
[Web UI / Internal Portal]
          |
          v
[Java API Gateway / BFF]
          |
          v
[Case Service] ---- [Subject Service]
     |                    |
     |                    |
     v                    v
[MySQL Primary] <----> [MySQL Replicas]
     |
     +--> [Outbox Table]
              |
              v
       [Outbox Relay / CDC]
              |
              +--> [Kafka/Event Bus]
              +--> [Search Index]
              +--> [Reporting Pipeline]
              +--> [Notification Service]

[Backup/PITR System]
[Observability Stack]
[Audit Review Tools]
```

Catatan penting:

- MySQL adalah source of truth untuk OLTP state.
- Search index bukan source of truth.
- Reporting database/snapshot bukan source of truth.
- Kafka/event bus bukan pengganti transaksi lokal.
- Outbox menjaga event tidak hilang setelah commit.
- Replica dipakai untuk read yang boleh stale, bukan semua read.

### 16.3 Schema Sketch

#### `enforcement_case`

```sql
CREATE TABLE enforcement_case (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    case_number VARCHAR(64) NOT NULL,
    tenant_id BIGINT UNSIGNED NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    assigned_unit_id BIGINT UNSIGNED NULL,
    assignee_user_id BIGINT UNSIGNED NULL,
    opened_at DATETIME(6) NOT NULL,
    closed_at DATETIME(6) NULL,
    due_at DATETIME(6) NULL,
    version BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_by BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_tenant_case_number (tenant_id, case_number),
    KEY idx_case_subject (tenant_id, subject_id),
    KEY idx_case_queue (tenant_id, status, priority, due_at, id),
    KEY idx_case_assignee (tenant_id, assignee_user_id, status, due_at, id),
    KEY idx_case_opened (tenant_id, opened_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Design notes:

- `id` adalah clustered primary key internal.
- `case_number` adalah business identifier.
- `tenant_id` ada di unique/index untuk multi-tenant access path.
- `version` mendukung optimistic locking.
- Queue index mendukung dashboard worklist.
- `status` sebagai string lebih fleksibel daripada enum jika state berkembang sering.
- Jika state sangat stabil, enum bisa dipertimbangkan, tapi migration cost harus dipahami.

#### `case_status_event`

```sql
CREATE TABLE case_status_event (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    case_id BIGINT UNSIGNED NOT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NOT NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    reason_code VARCHAR(64) NULL,
    reason_text VARCHAR(1000) NULL,
    correlation_id CHAR(36) NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_status_event_case (case_id, occurred_at, id),
    KEY idx_status_event_time (occurred_at, id),
    CONSTRAINT fk_status_event_case
      FOREIGN KEY (case_id) REFERENCES enforcement_case(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### `outbox_event`

```sql
CREATE TABLE outbox_event (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload_json JSON NOT NULL,
    status VARCHAR(32) NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    published_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_outbox_poll (status, next_attempt_at, id),
    KEY idx_outbox_aggregate (aggregate_type, aggregate_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Outbox polling:

```sql
SELECT id
FROM outbox_event
WHERE status = 'PENDING'
  AND next_attempt_at <= NOW(6)
ORDER BY next_attempt_at, id
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Ini queue-like workload, sehingga `SKIP LOCKED` masuk akal.

### 16.4 Transaction Example: Submit Case for Review

Goal:

- hanya case `DRAFT` yang bisa menjadi `SUBMITTED`,
- audit event harus tercatat,
- outbox event harus ada,
- retry harus aman.

Pseudo Java service:

```java
@Transactional
public SubmitCaseResult submitCase(SubmitCaseCommand command) {
    CaseRow caseRow = caseRepository.findForUpdate(command.caseId());

    if (!caseRow.status().equals("DRAFT")) {
        return SubmitCaseResult.alreadyNotDraft(caseRow.status());
    }

    int updated = caseRepository.transitionStatus(
        command.caseId(),
        "DRAFT",
        "SUBMITTED",
        command.expectedVersion(),
        command.actorUserId()
    );

    if (updated != 1) {
        throw new ConcurrentModificationException();
    }

    auditRepository.insertStatusEvent(
        command.caseId(),
        "DRAFT",
        "SUBMITTED",
        command.actorUserId(),
        command.reason(),
        command.correlationId()
    );

    outboxRepository.insert(
        "CASE",
        command.caseId(),
        "CaseSubmitted",
        payload,
        command.correlationId()
    );

    return SubmitCaseResult.submitted();
}
```

Bisa juga menggunakan conditional update tanpa `findForUpdate` jika semua data yang dibutuhkan cukup.

Invariant:

```text
Case tidak bisa lompat state tanpa status_event.
Case submitted event tidak bisa hilang jika transaksi commit.
Concurrent submit menghasilkan satu pemenang.
```

### 16.5 Search and Dashboard

Dashboard queue query:

```sql
SELECT id, case_number, status, priority, due_at, assignee_user_id
FROM enforcement_case
WHERE tenant_id = ?
  AND status IN ('SUBMITTED', 'UNDER_REVIEW')
  AND due_at < ?
ORDER BY priority DESC, due_at ASC, id ASC
LIMIT 50;
```

Butuh index yang cocok, misalnya:

```sql
KEY idx_case_dashboard (tenant_id, status, priority, due_at, id)
```

Namun `status IN (...)` + `ORDER BY priority DESC, due_at ASC` perlu diuji dengan `EXPLAIN ANALYZE`, karena index order dan range behavior dapat memengaruhi filesort.

Jika UI menawarkan 20 optional filters, jangan otomatis membuat 2^20 index. Pisahkan:

- query critical path,
- query admin low-frequency,
- query export/report,
- query search full-text.

Strategi:

```text
Critical queue:
  optimized in MySQL.

Complex search:
  use search index fed by outbox/CDC.

Regulatory report:
  reporting replica/snapshot/warehouse.

Case detail:
  primary or replica depending consistency.
```

### 16.6 Retention and Legal Hold

Table besar:

- `case_status_event`,
- `audit_event`,
- `outbox_event`,
- `document_metadata`,
- `api_request_log`,
- `notification_log`.

Checklist:

- [ ] Retention policy per table.
- [ ] Legal hold dapat mencegah purge.
- [ ] Purge job batch kecil.
- [ ] Purge tidak menciptakan replication lag besar.
- [ ] Archive storage immutable bila perlu.
- [ ] Restored archive dapat dikaitkan ke original case.
- [ ] Audit data tidak dipurge sebelum policy memperbolehkan.
- [ ] Partitioning hanya dipakai bila query/purge pattern cocok.

Contoh purge aman:

```sql
DELETE FROM outbox_event
WHERE status = 'PUBLISHED'
  AND published_at < ?
ORDER BY id
LIMIT 1000;
```

Loop dengan sleep/throttle, monitor replication lag dan lock wait.

### 16.7 Read Routing

Contoh rule:

```text
Case submit response:
  primary.

Case detail immediately after write:
  primary or session-sticky primary.

Dashboard:
  primary if operational decision critical;
  replica if stale within tolerated threshold.

Historical audit view:
  replica acceptable.

Bulk export:
  reporting replica/snapshot.

Escalation scheduler:
  primary if it triggers action;
  replica only if duplicate-safe and revalidated on primary before action.
```

Rule penting:

> Jika read akan menjadi dasar side effect irreversible, revalidate di primary dalam transaksi.

### 16.8 Failure Mode Walkthrough

#### Scenario 1 — Double submit

Dua user menekan submit pada case yang sama.

Protection:

- conditional update,
- version,
- audit insert dalam transaksi sama,
- idempotency key bila API external.

Expected:

- satu berhasil,
- satu mendapat conflict/already transitioned.

#### Scenario 2 — Outbox relay crash

Relay publish sebagian lalu crash.

Protection:

- outbox row persistent,
- event ID deterministic,
- consumer idempotent,
- status update setelah publish/retry hati-hati.

Expected:

- event bisa dipublish ulang,
- consumer menangani duplicate.

#### Scenario 3 — Search index lag

User submit case, search page belum menampilkan status baru.

Protection:

- source of truth MySQL,
- UI detail dari primary,
- search eventual consistency dipahami,
- reindex job.

Expected:

- search stale tidak memengaruhi correctness.

#### Scenario 4 — Metadata lock migration stuck

ALTER tambah index menunggu transaksi lama.

Protection:

- pre-check long transaction,
- migration timeout,
- metadata lock monitoring,
- runbook kill blocker/kill migration.

Expected:

- migration bisa dihentikan tanpa panic,
- app tetap jalan atau degraded.

#### Scenario 5 — Primary failover after client timeout

Client timeout saat submit case.

Possibility:

- transaction committed,
- transaction rolled back,
- client tidak tahu.

Protection:

- idempotency key,
- correlation ID,
- safe retry,
- check operation result by key.

Expected:

- retry tidak menciptakan duplicate case/action.

---

## 17. Final Production Readiness Scorecard

Gunakan scorecard ini untuk menilai maturity.

### Level 0 — Prototype

Karakteristik:

- schema cepat jadi,
- index reaktif,
- backup belum diuji,
- transaksi tidak dipikirkan,
- tidak ada runbook,
- slow query dilihat setelah user komplain.

Cocok untuk:

- eksperimen lokal,
- proof of concept.

Tidak cocok untuk:

- production regulated workflow.

### Level 1 — Basic Production

Karakteristik:

- schema cukup rapi,
- primary key dan constraints ada,
- backup otomatis ada,
- slow query log ada,
- monitoring dasar ada,
- migration via Flyway/Liquibase,
- connection pool dikonfigurasi.

Risiko:

- restore belum diuji,
- failover belum diuji,
- query plan regression belum dikontrol,
- concurrency edge case masih reaktif.

### Level 2 — Operationally Sound

Karakteristik:

- backup restore diuji,
- RTO/RPO diketahui,
- query critical punya EXPLAIN baseline,
- deadlock retry aman,
- idempotency untuk operation penting,
- observability DB-app terkorelasi,
- migration checklist dipakai,
- replica consistency boundary diketahui,
- runbook incident ada.

Ini target minimal untuk sistem penting.

### Level 3 — Mature Production

Karakteristik:

- failover drill rutin,
- restore drill rutin,
- performance regression test,
- capacity planning,
- schema migration rehearsed,
- postmortem disiplin,
- auditability kuat,
- retention/legal hold terintegrasi,
- HA/DR diuji,
- operational toil dikurangi dengan automation.

### Level 4 — Top-Tier Engineering

Karakteristik:

- setiap invariant penting punya enforcement layer jelas,
- failure mode dipetakan sebelum incident,
- data correctness bisa dibuktikan,
- observability menjawab “why”, bukan hanya “what”,
- trade-off durability/latency/consistency dibuat sadar,
- database dan aplikasi didesain sebagai satu sistem,
- tim bisa menjalankan recovery tanpa hero,
- upgrade/migration/failover dianggap routine capability.

---

## 18. Final Mental Model

MySQL production mastery bukan menghafal semua variable.

Mental model utamanya:

```text
1. Data punya invariant.
2. Invariant butuh enforcement.
3. Enforcement terjadi di kombinasi schema, constraint, transaction, lock, dan application logic.
4. Transaction punya lock footprint.
5. Lock footprint ditentukan oleh predicate dan index.
6. Index mempercepat read tetapi memperlambat write dan memperbesar storage.
7. Optimizer memilih plan berdasarkan statistik, bukan niat developer.
8. Write yang commit melewati log dan durability trade-off.
9. Replica bukan primary; lag adalah bagian dari model.
10. Backup bukan backup sampai restore terbukti.
11. Migration bukan hanya DDL; migration adalah distributed change antara app, schema, data, dan traffic.
12. Observability harus cukup untuk mengambil tindakan.
13. Incident bukan pengecualian; incident adalah input desain berikutnya.
```

Jika kamu memegang 13 poin ini, kamu akan membaca MySQL bukan sebagai “black box SQL server”, tetapi sebagai sistem konkuren, stateful, durable, replicated, observable, dan fallible.

---

## 19. Kompetensi Akhir Setelah Seri Ini

Setelah menyelesaikan seri ini, kamu seharusnya mampu:

- mendesain schema MySQL yang tahan tumbuh,
- memilih primary key dengan memahami efek clustered index,
- memetakan tipe data ke Java secara aman,
- menjelaskan MVCC dan read view,
- memilih isolation level dengan sadar,
- membaca lock behavior dari query shape,
- mendiagnosis deadlock,
- mendesain index berdasarkan workload,
- membaca `EXPLAIN` dan `EXPLAIN ANALYZE`,
- menghindari offset pagination berbahaya,
- mendesain transaction boundary di Spring/Java,
- mengkonfigurasi HikariCP secara masuk akal,
- memahami redo/undo/binlog/doublewrite,
- mengevaluasi buffer pool dan I/O,
- memilih konfigurasi MySQL yang berdampak,
- memahami replication dan consistency boundary,
- merancang HA/failover behavior,
- menguji backup/restore/PITR,
- menjalankan schema migration aman,
- membaca metadata lock incident,
- menerapkan privilege/security yang benar,
- membangun observability DB-app,
- membuat runbook incident,
- menerapkan idempotency/outbox/concurrency pattern,
- mengelola large table/retention/archive,
- menggunakan JSON/generated column dengan sadar,
- menempatkan MySQL dalam microservice/distributed architecture,
- melakukan performance engineering berbasis pengukuran,
- menilai production readiness secara struktural.

---

## 20. Checklist Final Satu Halaman

Gunakan ini saat review cepat.

```text
DATA CORRECTNESS
[ ] Entity ownership jelas
[ ] Primary key benar
[ ] Unique invariant dijaga DB
[ ] FK/constraint policy jelas
[ ] State transition atomic
[ ] Audit event transactional
[ ] Idempotency untuk operasi penting

TRANSACTION
[ ] Boundary jelas
[ ] Tidak ada external side effect berbahaya dalam transaksi
[ ] Timeout jelas
[ ] Retry aman
[ ] Deadlock/lock wait ditangani

QUERY/INDEX
[ ] Query critical terinventarisasi
[ ] EXPLAIN baseline ada
[ ] Index sesuai workload
[ ] Pagination aman
[ ] Query dashboard/search/report dipisahkan sesuai karakter

JAVA INTEGRATION
[ ] JDBC URL/timezone/TLS jelas
[ ] Pool size masuk akal
[ ] Pool metrics ada
[ ] SQL exception diklasifikasi
[ ] ORM generated SQL diaudit

MYSQL CONFIG
[ ] Version dan config source jelas
[ ] Charset/collation/sql_mode jelas
[ ] Durability settings sadar
[ ] Memory/I/O settings sadar
[ ] Timeout hierarchy jelas

REPLICATION/HA
[ ] Replica role jelas
[ ] Lag dimonitor
[ ] Read/write routing sadar consistency
[ ] RTO/RPO jelas
[ ] Failover diuji
[ ] Uncertain commit ditangani

BACKUP/RESTORE
[ ] Backup otomatis
[ ] Restore diuji
[ ] PITR diuji
[ ] Backup encrypted
[ ] DR runbook ada

MIGRATION
[ ] DDL impact diketahui
[ ] Metadata lock risk dicek
[ ] Backfill throttle
[ ] Rollback realistis
[ ] Post-migration verification

SECURITY
[ ] Least privilege
[ ] Runtime/migration/admin user dipisah
[ ] Secret aman
[ ] TLS/network boundary
[ ] Sensitive access audited

OBSERVABILITY
[ ] Slow query
[ ] Performance Schema/sys
[ ] DB metrics
[ ] App DB latency
[ ] Pool metrics
[ ] Replication/backup alerts
[ ] Runbook actionable

OPERATIONS
[ ] Incident playbook
[ ] Restore drill
[ ] Failover drill
[ ] Capacity review
[ ] Postmortem discipline
```

---

## 21. Penutup Seri

Seri ini selesai di bagian ini.

Namun mastery sebenarnya muncul saat kamu mulai menerapkan checklist ini ke sistem nyata:

- ambil satu service,
- inventarisasi query,
- baca schema,
- cek transaction boundary,
- cek pool config,
- cek backup restore,
- cek migration history,
- cek dashboard,
- cek incident lama,
- lalu cari invariant yang belum punya enforcement.

MySQL yang baik bukan hanya cepat.

MySQL yang baik adalah MySQL yang:

- menjaga data benar,
- predictable di bawah concurrency,
- observable saat gagal,
- bisa dipulihkan,
- bisa dimigrasikan,
- bisa diaudit,
- dan bisa dioperasikan oleh tim tanpa bergantung pada keberuntungan.

---

## 22. Referensi Resmi untuk Review Lanjutan

Gunakan dokumentasi resmi sebagai sumber utama saat melakukan production review:

- MySQL 8.4 Reference Manual
- InnoDB Storage Engine
- InnoDB ACID Model
- InnoDB Locking and Transaction Model
- InnoDB Online DDL
- Metadata Locking
- Performance Schema
- sys Schema
- Replication
- Group Replication
- InnoDB Cluster
- Backup and Recovery
- Binary Log
- Connector/J Developer Guide

Dokumentasi resmi MySQL 8.4 menyatakan manual tersebut mencakup MySQL 8.4 sampai 8.4.9. Untuk sistem production modern, gunakan dokumentasi versi yang sama dengan server yang benar-benar dijalankan, karena behavior, default, dan fitur bisa berubah antar versi.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-033.md">⬅️ Part 033 — Performance Engineering Methodology</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
