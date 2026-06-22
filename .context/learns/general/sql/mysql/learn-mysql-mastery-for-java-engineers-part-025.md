# learn-mysql-mastery-for-java-engineers-part-025.md

# Part 025 — Metadata Locks and Operational Surprises

## Status Seri

- Series: `learn-mysql-mastery-for-java-engineers`
- Part: `025 / 034`
- Topik: **Metadata Locks and Operational Surprises**
- Target pembaca: Java software engineer yang perlu memahami MySQL sebagai sistem production, bukan hanya sebagai tempat menyimpan data.
- Prasyarat seri:
  - Part 001 — MySQL Architecture
  - Part 006 — InnoDB MVCC
  - Part 008 — InnoDB Locking
  - Part 009 — Deadlocks and Lock Wait Timeouts
  - Part 024 — Schema Migration Without Taking Production Down

---

# 1. Kenapa Bagian Ini Penting

Metadata lock adalah salah satu sumber outage MySQL yang paling membingungkan bagi engineer aplikasi.

Masalahnya begini:

```sql
ALTER TABLE cases ADD COLUMN priority_score INT NULL;
```

Secara teori terlihat ringan.

Apalagi kalau MySQL mendukung online DDL atau instant DDL, engineer bisa berpikir:

> “Ini cuma tambah column nullable. Harusnya aman.”

Namun di production, query itu bisa:

- menggantung selama menit atau jam,
- membuat deployment tertahan,
- membuat write ke table ikut menunggu,
- membuat request API timeout,
- menyebabkan connection pool penuh,
- memicu cascade failure dari aplikasi ke database,
- dan akhirnya membuat service terlihat down.

Penyebabnya sering bukan karena ALTER-nya berat secara fisik, melainkan karena ia menunggu **metadata lock**.

Metadata lock, atau MDL, adalah mekanisme MySQL untuk melindungi konsistensi definisi object database seperti table, view, trigger, stored procedure, dan schema. Ketika sebuah session menggunakan table, MySQL perlu memastikan definisi table tersebut tidak berubah secara tidak aman saat statement atau transaction masih membutuhkannya.

Masalahnya: MDL bekerja di level metadata, bukan row.

Jadi walaupun query Anda hanya membaca satu row, ia tetap bisa memegang metadata lock terhadap table.

Dan walaupun ALTER Anda hanya mengubah metadata, ia tetap perlu exclusive metadata access pada momen tertentu.

Inilah sumber banyak kejutan operasional.

---

# 2. Mental Model Awal: Data Lock vs Metadata Lock

Sebelum masuk detail, pisahkan dua jenis lock besar:

| Jenis Lock | Melindungi | Contoh | Dirasakan Sebagai |
|---|---|---|---|
| Data lock | Row/range/index record | `SELECT ... FOR UPDATE`, `UPDATE`, `DELETE` | blocked transaction, deadlock, lock wait timeout |
| Metadata lock | Definisi object database | `SELECT`, `INSERT`, `ALTER TABLE`, `DROP TABLE` | DDL stuck, query stuck behind DDL, deployment hang |

Data lock menjawab:

> “Siapa boleh membaca/mengubah row ini?”

Metadata lock menjawab:

> “Siapa boleh memakai/mengubah definisi table ini?”

Contoh data lock:

```sql
START TRANSACTION;
UPDATE cases SET status = 'UNDER_REVIEW' WHERE id = 1001;
-- row id 1001 terkunci sampai COMMIT/ROLLBACK
```

Contoh metadata lock:

```sql
START TRANSACTION;
SELECT * FROM cases WHERE id = 1001;
-- transaction masih terbuka
-- metadata lock atas table cases bisa tetap tertahan sampai transaksi selesai
```

Lalu session lain menjalankan:

```sql
ALTER TABLE cases ADD COLUMN reviewer_note VARCHAR(255) NULL;
```

ALTER bisa menunggu transaction pertama selesai, bukan karena row `1001` terkunci, melainkan karena table `cases` sedang dipakai oleh transaction yang belum selesai.

---

# 3. Metadata Itu Apa?

Metadata adalah informasi tentang struktur object database.

Untuk table, metadata mencakup hal seperti:

- nama table,
- daftar column,
- tipe data column,
- index,
- constraint,
- foreign key,
- trigger yang terkait,
- storage engine,
- row format,
- partition definition,
- privilege-related object metadata,
- dependency object lain.

Saat query berjalan, MySQL perlu tahu struktur table yang stabil.

Bayangkan query ini sedang dieksekusi:

```sql
SELECT case_id, status, assigned_officer_id
FROM enforcement_cases
WHERE status = 'OPEN';
```

Di tengah query, session lain melakukan:

```sql
ALTER TABLE enforcement_cases DROP COLUMN assigned_officer_id;
```

Tanpa metadata locking, sistem bisa masuk kondisi tidak koheren:

- parser/resolver sudah resolve column,
- optimizer sudah membuat plan,
- executor sedang membaca row,
- tiba-tiba definisi column berubah.

Metadata lock mencegah perubahan definisi seperti itu terjadi sembarangan.

Jadi MDL bukan bug. MDL adalah mekanisme safety.

Yang sering menjadi masalah adalah engineer tidak memperlakukan MDL sebagai resource production yang harus dimodelkan.

---

# 4. Metadata Lock Bukan Hanya Untuk DDL

Salah satu miskonsepsi paling umum:

> “Metadata lock hanya terjadi saat ALTER TABLE.”

Salah.

Statement biasa juga mengambil metadata lock.

Contoh statement yang bisa mengambil MDL:

```sql
SELECT * FROM cases WHERE id = 1;
INSERT INTO cases (...);
UPDATE cases SET ... WHERE id = 1;
DELETE FROM cases WHERE id = 1;
ALTER TABLE cases ADD COLUMN ...;
DROP TABLE cases;
RENAME TABLE cases TO cases_old;
CREATE TRIGGER ... ON cases;
LOCK TABLES cases WRITE;
```

Perbedaannya ada pada jenis dan durasi lock.

Secara mental:

- query DML/SELECT biasanya mengambil metadata lock yang compatible dengan operasi normal lain,
- DDL membutuhkan lock yang lebih kuat,
- DDL tertentu membutuhkan exclusive metadata lock,
- exclusive metadata lock tidak compatible dengan session lain yang masih memakai table.

Jadi, query biasa bisa menahan DDL.

Dan DDL yang sedang menunggu bisa membuat query berikutnya ikut antre di belakangnya.

Ini penting.

---

# 5. Pola Outage Klasik: “Waiting DDL Blocks New Queries”

Ini pola yang sering membuat incident terasa tidak masuk akal.

## 5.1 Timeline

Misalkan ada table besar:

```sql
cases
```

### T1 — Session A membuka transaksi dan membaca table

```sql
START TRANSACTION;
SELECT * FROM cases WHERE id = 123;
-- aplikasi lupa commit/rollback
-- session idle in transaction
```

Session A memegang metadata lock terhadap `cases` sampai transaksi selesai.

### T2 — Session B menjalankan ALTER

```sql
ALTER TABLE cases ADD COLUMN risk_score INT NULL;
```

Session B perlu metadata lock yang lebih kuat.

Ia tidak bisa mendapatkannya karena Session A masih memegang MDL.

Jadi Session B menunggu.

### T3 — Session C, D, E, F menjalankan query normal

```sql
SELECT * FROM cases WHERE id = 456;
UPDATE cases SET status = 'CLOSED' WHERE id = 789;
```

Secara intuitif engineer berpikir:

> “Kenapa SELECT biasa ikut blocked? Bukankah ALTER belum jalan?”

Karena MySQL harus menjaga fairness/ordering metadata lock. Jika ada pending DDL yang menunggu exclusive metadata lock, request metadata lock baru yang conflict atau berada di antrean dapat ikut tertahan agar DDL tidak starvation selamanya.

Akibatnya:

- request API baru mulai stuck,
- thread aplikasi menunggu DB,
- HikariCP connection pool penuh,
- servlet/container thread pool penuh,
- retry memperparah beban,
- application health check gagal,
- deployment dianggap gagal,
- incident melebar.

Sumber root cause-nya bisa satu session idle transaction.

---

# 6. MDL Duration: Statement vs Transaction

Durasi metadata lock bergantung pada jenis statement dan transaction context.

Secara praktis:

## 6.1 Autocommit SELECT

```sql
SELECT * FROM cases WHERE id = 1;
```

Jika autocommit aktif dan tidak ada explicit transaction, metadata lock biasanya dilepas setelah statement selesai.

## 6.2 SELECT di dalam explicit transaction

```sql
START TRANSACTION;
SELECT * FROM cases WHERE id = 1;
-- do nothing for 5 minutes
COMMIT;
```

Metadata lock bisa tertahan sampai transaksi selesai.

Inilah alasan transaksi read-only yang tampaknya harmless bisa menghalangi DDL.

## 6.3 DML di dalam transaction

```sql
START TRANSACTION;
UPDATE cases SET status = 'REVIEW' WHERE id = 1;
-- transaction masih terbuka
```

Session memegang:

- data lock terhadap row/range tertentu,
- metadata lock terhadap table.

DDL bisa tertahan.

## 6.4 DDL

DDL sendiri mengambil metadata lock kuat.

Bahkan untuk online/instant DDL, ada fase yang butuh lock metadata.

Makna penting:

> “Online DDL” tidak berarti “tidak butuh metadata lock”.

Online DDL berarti operasi dirancang untuk mengurangi blocking data operation selama proses berlangsung. Tetapi tahap prepare/commit metadata tetap membutuhkan koordinasi.

---

# 7. Kenapa Long Transaction Berbahaya Untuk Schema Change

Long transaction sudah dibahas di part MVCC sebagai masalah undo/purge.

Sekarang kita lihat dari sisi MDL.

Long transaction bisa terjadi karena:

- request HTTP lambat,
- external API call di dalam `@Transactional`,
- stream result besar,
- batch job membuka transaksi terlalu lama,
- manual SQL client lupa commit,
- migration script separuh jalan,
- debugging session di production,
- connection pool mengembalikan connection yang masih punya session state buruk,
- test tool atau BI tool membuka transaction untuk read consistency.

Contoh Spring anti-pattern:

```java
@Transactional
public CaseDetail getCaseDetail(long caseId) {
    CaseEntity entity = caseRepository.findById(caseId)
        .orElseThrow();

    ExternalRiskScore score = riskClient.fetchRiskScore(entity.getSubjectId());

    return mapper.toDetail(entity, score);
}
```

Masalah:

- transaksi dibuka sebelum query pertama,
- external API call terjadi saat transaksi masih aktif,
- DB session tetap mempertahankan transaction context,
- metadata lock atas table yang dibaca bisa ikut tertahan,
- DDL terhadap table tersebut bisa stuck.

Solusi umum:

```java
public CaseDetail getCaseDetail(long caseId) {
    CaseEntity entity = loadCaseReadOnly(caseId);
    ExternalRiskScore score = riskClient.fetchRiskScore(entity.getSubjectId());
    return mapper.toDetail(entity, score);
}

@Transactional(readOnly = true)
protected CaseEntity loadCaseReadOnly(long caseId) {
    return caseRepository.findById(caseId).orElseThrow();
}
```

Namun bahkan ini perlu hati-hati karena self-invocation Spring proxy dapat membuat `@Transactional` tidak bekerja jika dipanggil dari method di class yang sama tanpa proxy. Lebih baik pisahkan service boundary atau gunakan transaction template secara eksplisit.

Inti desain:

> Jangan menahan transaksi database saat melakukan kerja yang tidak membutuhkan database.

---

# 8. Metadata Lock dan Connection Pool Java

Di aplikasi Java modern, MySQL connection biasanya dikelola oleh pool seperti HikariCP.

Connection pool membuat masalah MDL bisa lebih halus.

## 8.1 Session State Bisa Bertahan

Database connection bukan object stateless.

Ia punya session state:

- autocommit mode,
- transaction isolation,
- temporary tables,
- user variables,
- session variables,
- current database,
- prepared statements,
- uncommitted transaction jika tidak dibersihkan,
- locks.

Pool seharusnya mengembalikan connection ke state aman. Namun bug aplikasi, driver behavior, atau konfigurasi buruk tetap bisa menyebabkan session bermasalah.

Contoh bahaya:

```java
Connection c = dataSource.getConnection();
c.setAutoCommit(false);
PreparedStatement ps = c.prepareStatement("SELECT * FROM cases WHERE id = ?");
// exception terjadi
// connection tidak ditutup dengan try-with-resources
// rollback tidak dipanggil
```

Jika connection tidak properly closed/returned, transaction bisa tetap terbuka.

Dengan framework modern ini lebih jarang, tapi tetap terjadi dalam:

- custom JDBC code,
- batch scripts,
- legacy DAO,
- manual transaction management,
- migration code,
- test utilities.

## 8.2 Pool Exhaustion Karena MDL

Ketika MDL blocking terjadi:

1. Request mengambil connection dari pool.
2. Query blocked di MySQL.
3. Connection tetap dipakai selama blocked.
4. Request lain mengambil connection berikutnya.
5. Semua connection habis.
6. Thread aplikasi menunggu connection.
7. Latency naik drastis.
8. Timeout/retry memperparah.

HikariCP error yang muncul bisa seperti:

```text
Connection is not available, request timed out after 30000ms.
```

Engineer aplikasi bisa salah fokus:

> “Pool terlalu kecil.”

Padahal root cause-nya:

> “Query stuck karena MDL atau lock wait.”

Menambah pool size justru bisa memperbesar tekanan ke MySQL.

---

# 9. Cara Melihat Metadata Lock

Untuk debugging, gunakan beberapa sumber observability.

## 9.1 `SHOW PROCESSLIST`

```sql
SHOW FULL PROCESSLIST;
```

Cari state seperti:

```text
Waiting for table metadata lock
```

Contoh output konseptual:

```text
Id    User     Host       db       Command   Time   State                            Info
101   app      10.0.1.5   prod     Sleep     920    NULL                             NULL
102   deploy   10.0.2.7   prod     Query     450    Waiting for table metadata lock  ALTER TABLE cases ADD COLUMN risk_score INT NULL
103   app      10.0.1.6   prod     Query     430    Waiting for table metadata lock  SELECT * FROM cases WHERE id = 1001
104   app      10.0.1.7   prod     Query     429    Waiting for table metadata lock  UPDATE cases SET status='CLOSED' WHERE id=1002
```

Penting: blocker bisa terlihat sebagai `Sleep`, bukan query aktif.

Session idle bisa menjadi penyebab.

## 9.2 Performance Schema `metadata_locks`

Jika Performance Schema aktif dan instrument MDL tersedia, query bisa dilakukan terhadap:

```sql
performance_schema.metadata_locks
```

Contoh:

```sql
SELECT
    OBJECT_TYPE,
    OBJECT_SCHEMA,
    OBJECT_NAME,
    LOCK_TYPE,
    LOCK_DURATION,
    LOCK_STATUS,
    OWNER_THREAD_ID
FROM performance_schema.metadata_locks
WHERE OBJECT_SCHEMA = 'prod'
  AND OBJECT_NAME = 'cases';
```

Kolom penting:

- `OBJECT_SCHEMA`
- `OBJECT_NAME`
- `LOCK_TYPE`
- `LOCK_DURATION`
- `LOCK_STATUS`
- `OWNER_THREAD_ID`

`LOCK_STATUS` bisa menunjukkan lock granted atau pending.

## 9.3 Mapping Thread ke Processlist

Performance Schema memakai internal thread id. Untuk mengaitkan dengan session/processlist:

```sql
SELECT
    t.THREAD_ID,
    t.PROCESSLIST_ID,
    t.PROCESSLIST_USER,
    t.PROCESSLIST_HOST,
    t.PROCESSLIST_DB,
    t.PROCESSLIST_COMMAND,
    t.PROCESSLIST_TIME,
    t.PROCESSLIST_STATE,
    t.PROCESSLIST_INFO
FROM performance_schema.threads t
WHERE t.PROCESSLIST_ID IS NOT NULL;
```

Gabungkan dengan `metadata_locks`:

```sql
SELECT
    ml.OBJECT_SCHEMA,
    ml.OBJECT_NAME,
    ml.LOCK_TYPE,
    ml.LOCK_DURATION,
    ml.LOCK_STATUS,
    t.PROCESSLIST_ID,
    t.PROCESSLIST_USER,
    t.PROCESSLIST_HOST,
    t.PROCESSLIST_COMMAND,
    t.PROCESSLIST_TIME,
    t.PROCESSLIST_STATE,
    t.PROCESSLIST_INFO
FROM performance_schema.metadata_locks ml
JOIN performance_schema.threads t
    ON ml.OWNER_THREAD_ID = t.THREAD_ID
WHERE ml.OBJECT_SCHEMA = 'prod'
  AND ml.OBJECT_NAME = 'cases'
ORDER BY ml.LOCK_STATUS, t.PROCESSLIST_TIME DESC;
```

Ini membantu menemukan:

- siapa menunggu,
- siapa memegang lock,
- session mana yang sudah idle lama,
- query DDL apa yang sedang pending.

## 9.4 sys Schema Helper

Bergantung versi dan konfigurasi, `sys` schema menyediakan view yang lebih mudah dibaca untuk lock wait.

Untuk data locks biasanya ada view seperti:

```sql
SELECT * FROM sys.innodb_lock_waits;
```

Untuk metadata locks, beberapa environment menyediakan view yang membantu, tetapi jangan bergantung buta. Pastikan view tersedia di deployment Anda.

Dalam runbook production, query Performance Schema eksplisit sering lebih bisa dikontrol.

---

# 10. Skenario Praktis: DDL Stuck Karena Idle Transaction

## 10.1 Gejala

Deployment menjalankan migration:

```sql
ALTER TABLE case_events ADD COLUMN event_source VARCHAR(64) NULL;
```

Migration stuck 20 menit.

API mulai lambat.

Log aplikasi menunjukkan:

```text
SQLTransientConnectionException: HikariPool-1 - Connection is not available
```

DB processlist menunjukkan banyak query:

```text
Waiting for table metadata lock
```

## 10.2 Investigasi

Cari processlist:

```sql
SHOW FULL PROCESSLIST;
```

Terlihat:

```text
Id    User       Command   Time   State                            Info
88    app        Sleep     1800   NULL                             NULL
91    deploy     Query     1200   Waiting for table metadata lock  ALTER TABLE case_events ADD COLUMN event_source VARCHAR(64) NULL
112   app        Query     1190   Waiting for table metadata lock  INSERT INTO case_events ...
113   app        Query     1189   Waiting for table metadata lock  SELECT ... FROM case_events ...
```

Session `88` terlihat Sleep, tapi mungkin masih punya transaction.

Cek transaction:

```sql
SELECT
    trx_id,
    trx_state,
    trx_started,
    trx_mysql_thread_id,
    trx_query
FROM information_schema.innodb_trx
WHERE trx_mysql_thread_id = 88;
```

Jika muncul row, artinya session Sleep tersebut punya transaksi aktif.

## 10.3 Keputusan Operasional

Pilihan:

1. Tunggu session 88 selesai.
2. Kill session 88.
3. Kill ALTER session 91.
4. Kill query-query yang antre.

Pilihan tidak boleh asal.

Pertanyaan runbook:

- Session 88 berasal dari app mana?
- Apakah sedang melakukan write transaction?
- Jika di-kill, apakah rollback besar akan terjadi?
- Apakah ALTER sudah mulai melakukan perubahan fisik atau masih menunggu MDL?
- Apakah application retry aman?
- Apakah migration bisa diulang idempotently?

Jika session 91 masih hanya `Waiting for table metadata lock`, biasanya ALTER belum memodifikasi table. Membatalkan ALTER relatif aman dibanding membatalkan DDL yang sudah melakukan rebuild besar. Namun tetap validasi berdasarkan versi, statement, dan environment.

Jika session 88 adalah idle transaction dari aplikasi dan tidak ada query aktif, kill session bisa membebaskan MDL. Tetapi jika session itu memegang transaksi write besar, kill dapat memicu rollback yang juga mahal.

## 10.4 Command

Membunuh session:

```sql
KILL 88;
```

Membunuh query saja:

```sql
KILL QUERY 91;
```

Perbedaan:

- `KILL QUERY` menghentikan statement aktif, connection tetap ada.
- `KILL` menghentikan connection/session.

Untuk idle transaction, biasanya butuh `KILL` connection, bukan `KILL QUERY`, karena tidak ada query aktif.

---

# 11. Metadata Lock vs InnoDB Row Lock: Cara Membedakan

Ketika query stuck, jangan langsung menyimpulkan.

## 11.1 Metadata lock symptom

Processlist state:

```text
Waiting for table metadata lock
```

Biasanya terkait:

- ALTER TABLE,
- DROP/RENAME/TRUNCATE,
- pending DDL,
- long transaction yang pernah menyentuh table,
- query baru ikut blocked setelah DDL pending.

## 11.2 Row lock symptom

State bisa seperti:

```text
updating
statistics
executing
```

Atau query terlihat aktif lama.

Cek:

```sql
SELECT * FROM information_schema.innodb_trx;
```

Dan Performance Schema data lock tables jika tersedia:

```sql
SELECT * FROM performance_schema.data_locks;
SELECT * FROM performance_schema.data_lock_waits;
```

Row lock problem biasanya terkait:

- `UPDATE`,
- `DELETE`,
- `SELECT ... FOR UPDATE`,
- gap/next-key lock,
- deadlock,
- lock wait timeout.

## 11.3 Beda Mitigasi

| Problem | Mitigasi utama |
|---|---|
| Metadata lock | cari transaction/session yang menahan table metadata; batalkan DDL atau kill blocker dengan hati-hati |
| Row lock | cari blocking transaction row-level; perbaiki index/predicate/order transaksi; retry deadlock/timeout |
| CPU query | optimize query/index; hentikan query berat jika perlu |
| I/O saturation | cek buffer pool, flushing, temp table, backup, storage latency |
| Connection exhaustion | cari query blocked/lama; jangan langsung tambah pool |

---

# 12. Metadata Lock Dalam Deployment Pipeline

Migration di aplikasi Java sering dijalankan oleh:

- Flyway saat startup aplikasi,
- Liquibase saat startup aplikasi,
- dedicated migration job,
- manual SQL script,
- CI/CD deployment stage,
- DBA-controlled migration window.

Setiap pendekatan punya risiko.

## 12.1 Migration Saat App Startup

Pattern umum:

```text
app starts -> Flyway migrates -> app serves traffic
```

Risiko:

- banyak instance start bersamaan,
- migration lock di tool tidak sama dengan MDL MySQL,
- app startup gagal jika migration stuck,
- deployment rollback tidak otomatis rollback schema,
- readiness probe gagal,
- orchestrator restart app berulang.

Untuk sistem kecil, ini praktis.

Untuk sistem production besar, lebih aman migration dijalankan sebagai tahap terpisah.

## 12.2 Dedicated Migration Job

Pattern:

```text
pause risky deploy action -> run migration job -> verify -> roll app
```

Lebih baik karena:

- satu actor menjalankan migration,
- timeout bisa dikontrol,
- observability bisa difokuskan,
- rollback application tidak bercampur dengan rollback schema,
- easier human intervention.

## 12.3 Preflight Check

Sebelum DDL terhadap table critical, jalankan check:

```sql
SELECT
    trx_mysql_thread_id,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS trx_age_seconds,
    trx_state,
    trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

Cari transaction tua.

Cek processlist:

```sql
SHOW FULL PROCESSLIST;
```

Cari query panjang terhadap target table.

Cek apakah ada DDL lain:

```sql
SELECT *
FROM performance_schema.metadata_locks
WHERE LOCK_STATUS = 'PENDING';
```

Preflight tidak menjamin aman, tapi mengurangi risiko.

---

# 13. Lock Timeout Untuk DDL

DDL yang menunggu MDL bisa menunggu lama.

Ada system variable seperti `lock_wait_timeout` yang relevan untuk metadata lock wait.

Untuk migration, Anda bisa mengatur session-level timeout agar migration gagal cepat, bukan menggantung tanpa batas.

Contoh:

```sql
SET SESSION lock_wait_timeout = 10;
ALTER TABLE cases ADD COLUMN risk_score INT NULL;
```

Jika tidak bisa mendapat metadata lock dalam waktu tersebut, statement gagal.

Ini sering lebih baik daripada membuat antrean production.

Namun perlu desain pipeline:

- migration gagal harus terdeteksi,
- deploy harus berhenti,
- error harus jelas,
- migration harus bisa diulang,
- tidak boleh meninggalkan state setengah jalan yang tidak dipahami.

Untuk Flyway/Liquibase, bisa jalankan SQL callback atau konfigurasi session init tergantung tool dan mekanisme koneksi.

Mental model:

> DDL production sebaiknya fail fast saat lock tidak tersedia, bukan diam-diam membuat sistem antre.

---

# 14. Strategi Aman Untuk DDL Kecil

DDL kecil tetap butuh safety.

Contoh: tambah nullable column.

## 14.1 Buruk

```sql
ALTER TABLE cases ADD COLUMN risk_score INT NULL;
```

Dijalankan langsung tanpa preflight, tanpa timeout, saat traffic tinggi.

## 14.2 Lebih Aman

```sql
SET SESSION lock_wait_timeout = 5;
ALTER TABLE cases ADD COLUMN risk_score INT NULL, ALGORITHM=INSTANT;
```

Namun jangan menambahkan `ALGORITHM=INSTANT` secara buta jika operasi tidak mendukungnya. Jika tidak didukung, MySQL akan gagal; ini bisa diinginkan karena mencegah fallback ke operasi mahal.

Untuk perubahan yang Anda percaya harus instant, pakai deklarasi eksplisit:

```sql
ALTER TABLE cases
    ADD COLUMN risk_score INT NULL,
    ALGORITHM=INSTANT,
    LOCK=NONE;
```

Jika MySQL tidak bisa memenuhi constraint tersebut, statement gagal daripada diam-diam memilih algorithm/lock yang lebih berat.

Catatan:

- dukungan `ALGORITHM=INSTANT` tergantung jenis ALTER, versi MySQL, dan bentuk table,
- `LOCK=NONE` tidak berarti tidak ada metadata lock sama sekali,
- tetap ada fase metadata coordination.

---

# 15. Strategi Aman Untuk DDL Besar

Contoh DDL besar:

```sql
ALTER TABLE case_events ADD INDEX idx_case_events_case_id_created_at (case_id, created_at);
```

Risiko:

- scan table besar,
- sort/build index,
- I/O tinggi,
- replication lag,
- MDL pada fase tertentu,
- temp space besar,
- backup interference,
- longer rollback/failure consequences.

Strategi:

## 15.1 Validasi ukuran dan workload

```sql
SELECT
    table_schema,
    table_name,
    table_rows,
    data_length,
    index_length,
    data_free
FROM information_schema.tables
WHERE table_schema = 'prod'
  AND table_name = 'case_events';
```

`table_rows` estimasi, bukan angka presisi, tapi cukup untuk memahami skala.

## 15.2 Jalankan di replica/staging dengan data realistis

Bukan staging kosong.

DDL yang cepat pada 10 ribu row tidak memberi tahu banyak tentang 800 juta row.

## 15.3 Gunakan timeout MDL

```sql
SET SESSION lock_wait_timeout = 10;
```

## 15.4 Monitor selama berjalan

- processlist,
- performance_schema,
- disk I/O,
- replica lag,
- temp disk,
- buffer pool pressure,
- application latency.

## 15.5 Pertimbangkan online schema change tool

Untuk perubahan besar pada table sangat aktif, tools seperti `pt-online-schema-change` atau `gh-ost` sering dipakai di ekosistem MySQL.

Namun tool ini bukan silver bullet.

Risikonya:

- trigger overhead,
- binlog amplification,
- replication lag,
- cutover tetap butuh metadata lock,
- foreign key complexity,
- operational complexity.

Jika menggunakan tool tersebut, tetap pahami MDL pada fase cutover.

---

# 16. Metadata Lock dan Foreign Key

DDL pada table dengan foreign key bisa lebih kompleks.

Contoh:

```sql
orders
order_items
```

Jika `order_items.order_id` mereferensikan `orders.id`, perubahan pada salah satu table bisa melibatkan metadata dependency.

Masalah yang bisa muncul:

- ALTER child table menunggu parent table metadata,
- ALTER parent table menunggu child table usage,
- application transaction menyentuh parent dan child,
- cascade operation membuat lock footprint sulit ditebak.

Untuk sistem regulatory/case-management, contoh:

```text
cases
case_subjects
case_events
enforcement_actions
case_documents
```

Jika semua table terhubung foreign key kuat, migration pada table pusat seperti `cases` bisa punya blast radius besar.

Ini bukan berarti foreign key buruk.

Artinya:

> Foreign key adalah invariant database-level yang punya biaya operasional.

Gunakan FK ketika invariant cross-row/cross-table memang harus dijaga database. Tapi jangan lupa mendesain migration dan DDL strategy berdasarkan dependency graph.

---

# 17. Metadata Lock dan Prepared Statements

Prepared statement dapat berinteraksi dengan metadata karena statement yang disiapkan bergantung pada definisi object.

Jika schema berubah, prepared statement bisa perlu reprepare.

Di aplikasi Java dengan Connector/J, prepared statement bisa dikelola di driver/client atau server tergantung konfigurasi.

Operationally, hal yang lebih penting:

- schema change dapat memengaruhi statement cache,
- query yang sebelumnya valid bisa gagal jika column berubah,
- perubahan type dapat memengaruhi binding Java,
- deploy app dan migration harus diurutkan dengan expand-contract.

Contoh buruk:

1. Drop column `old_status`.
2. Masih ada app instance lama yang menjalankan query menggunakan `old_status`.
3. App mulai error.

Ini bukan hanya masalah MDL, tapi masalah compatibility window.

Solusi:

- expand: tambah struktur baru,
- deploy app yang bisa dual-read/dual-write jika perlu,
- backfill,
- switch read path,
- contract: drop struktur lama setelah tidak dipakai.

---

# 18. Metadata Lock dan Replication

DDL di primary akan masuk ke replication stream.

Jika DDL menunggu MDL di primary, ia bisa menahan deployment.

Jika DDL berhasil di primary, replica juga harus menerapkan DDL.

Risiko:

- replica lag saat DDL berat,
- read replica tidak available untuk query tertentu,
- DDL ordering memengaruhi event berikutnya,
- app yang membaca replica melihat schema/data pada timing berbeda,
- failover saat migration bisa rumit.

Strategi:

- monitor replication lag sebelum/saat/sesudah DDL,
- hindari DDL besar saat replica sudah lag,
- pahami apakah read traffic ke replica bisa terdampak,
- pastikan app version compatible dengan schema lama dan baru,
- jangan assume semua node schema-updated pada saat yang sama.

Dalam sistem dengan read/write splitting:

```text
primary schema migrated
replica belum menerapkan DDL
app baru query column baru ke replica
query gagal
```

Solusi bisa berupa:

- route query yang memakai column baru ke primary sementara,
- tunggu semua replica catch up sebelum enable feature,
- feature flag,
- compatibility query,
- deployment orchestration yang sadar replica lag.

---

# 19. Metadata Lock dan Read-Only Analytics

Banyak organisasi punya user read-only untuk:

- BI tool,
- dashboard,
- analyst query,
- ad-hoc investigation,
- export job,
- audit report,
- regulatory reporting.

Read-only tidak berarti tidak berbahaya.

Query analyst seperti:

```sql
START TRANSACTION;
SELECT COUNT(*) FROM case_events WHERE created_at >= '2020-01-01';
-- client UI idle, transaction tetap terbuka
```

Bisa menahan metadata lock.

Solusi:

- jalankan analytics di replica/reporting DB,
- batasi transaction duration,
- set read-only user timeout,
- enforce query timeout,
- gunakan resource governance jika tersedia,
- edukasi pengguna SQL client,
- pastikan BI tool tidak membuka transaction panjang tanpa alasan.

Untuk regulatory environment, audit/reporting sering penting, tetapi jangan campur workload ad-hoc berat dengan primary OLTP jika tidak didesain.

---

# 20. Runbook: DDL Stuck Karena Metadata Lock

Berikut runbook praktis.

## 20.1 Tujuan

Menentukan:

1. DDL apa yang stuck.
2. Table apa yang terdampak.
3. Session mana yang memegang metadata lock.
4. Apakah aman membatalkan DDL.
5. Apakah aman membunuh blocker.
6. Bagaimana memulihkan aplikasi.

## 20.2 Langkah 1 — Lihat processlist

```sql
SHOW FULL PROCESSLIST;
```

Cari:

```text
Waiting for table metadata lock
```

Catat:

- id session,
- user,
- host,
- database,
- time,
- query.

## 20.3 Langkah 2 — Cari transaksi lama

```sql
SELECT
    trx_mysql_thread_id,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS trx_age_seconds,
    trx_state,
    trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

Cari thread id yang tua.

## 20.4 Langkah 3 — Cek metadata locks

```sql
SELECT
    ml.OBJECT_SCHEMA,
    ml.OBJECT_NAME,
    ml.LOCK_TYPE,
    ml.LOCK_DURATION,
    ml.LOCK_STATUS,
    t.PROCESSLIST_ID,
    t.PROCESSLIST_USER,
    t.PROCESSLIST_HOST,
    t.PROCESSLIST_COMMAND,
    t.PROCESSLIST_TIME,
    t.PROCESSLIST_STATE,
    t.PROCESSLIST_INFO
FROM performance_schema.metadata_locks ml
JOIN performance_schema.threads t
    ON ml.OWNER_THREAD_ID = t.THREAD_ID
WHERE ml.OBJECT_SCHEMA = 'prod'
ORDER BY ml.OBJECT_NAME, ml.LOCK_STATUS, t.PROCESSLIST_TIME DESC;
```

Filter target table jika sudah tahu:

```sql
AND ml.OBJECT_NAME = 'cases'
```

## 20.5 Langkah 4 — Tentukan blocker

Blocker sering:

- session Sleep dengan transaction aktif,
- query SELECT lama,
- batch job,
- migration lain,
- BI query,
- app instance lama.

Jangan hanya kill session dengan waktu terbesar tanpa memahami konteks.

## 20.6 Langkah 5 — Pilih tindakan

Opsi umum:

### Opsi A — Batalkan DDL

Jika DDL membuat antrean dan belum mulai bekerja:

```sql
KILL QUERY <ddl_processlist_id>;
```

Atau:

```sql
KILL <ddl_processlist_id>;
```

Ini sering memulihkan query normal jika pending DDL adalah penyebab antrean.

### Opsi B — Kill blocker

Jika blocker adalah idle transaction jelas dari aplikasi:

```sql
KILL <blocker_processlist_id>;
```

Waspada rollback besar.

### Opsi C — Kurangi traffic aplikasi

Jika pool sudah penuh dan retry storm terjadi:

- disable feature sementara,
- turunkan worker concurrency,
- pause batch job,
- stop retry agresif,
- isolate traffic.

### Opsi D — Biarkan selesai

Jika DDL sudah hampir selesai dan tidak membuat dampak besar, menunggu bisa lebih aman.

Namun ini harus berdasarkan observability, bukan harapan.

## 20.7 Langkah 6 — Recovery

Setelah lock bebas:

- pastikan processlist normal,
- pastikan connection pool recovery,
- cek error rate aplikasi,
- cek replication lag,
- cek migration table Flyway/Liquibase,
- tentukan apakah migration applied/failed/partial,
- jangan rerun migration tanpa validasi state.

---

# 21. Design Checklist Sebelum Menjalankan DDL

Gunakan checklist ini untuk table production critical.

## 21.1 Klasifikasi perubahan

Apakah perubahan:

- tambah nullable column?
- tambah not-null column dengan default?
- ubah tipe data?
- tambah index?
- drop column?
- rename column/table?
- ubah primary key?
- ubah foreign key?
- rebuild table?
- partition operation?

Semakin destruktif dan semakin besar table, semakin butuh strategi khusus.

## 21.2 Klasifikasi table

Tanyakan:

- Apakah table hot?
- Berapa QPS read/write?
- Berapa ukuran data/index?
- Ada FK?
- Ada trigger?
- Ada replication?
- Ada CDC/binlog consumer?
- Ada online schema change tool?
- Ada long-running reports?
- Ada batch job?

## 21.3 Compatibility

Tanyakan:

- Apakah aplikasi lama masih compatible dengan schema baru?
- Apakah aplikasi baru masih compatible dengan schema lama?
- Apakah migration boleh dilakukan sebelum deploy app?
- Apakah rollback app tetap aman setelah schema berubah?
- Apakah read replica sudah menerima DDL sebelum app membaca field baru?

## 21.4 Operational guardrails

Minimal:

```sql
SET SESSION lock_wait_timeout = 5;
```

Untuk perubahan yang harus instant/nonblocking:

```sql
ALTER TABLE ... ALGORITHM=INSTANT, LOCK=NONE;
```

Atau sesuai jenis operasi yang valid.

Tambahkan:

- preflight transaction check,
- monitor processlist,
- monitor replication lag,
- alert application latency,
- migration owner standby,
- rollback/abort criteria jelas.

---

# 22. Design Pattern: Expand-Contract dan MDL

Expand-contract bukan hanya untuk compatibility. Ia juga mengurangi risiko operasional.

## 22.1 Contoh: Rename Column

Tujuan akhir:

```text
cases.owner_user_id -> cases.assigned_officer_id
```

Jangan langsung:

```sql
ALTER TABLE cases RENAME COLUMN owner_user_id TO assigned_officer_id;
```

Masalah:

- app lama rusak,
- DDL bisa butuh MDL,
- rollback sulit,
- replica/app version mismatch.

Gunakan expand-contract:

### Step 1 — Expand

```sql
ALTER TABLE cases ADD COLUMN assigned_officer_id BIGINT NULL, ALGORITHM=INSTANT;
```

### Step 2 — Deploy app dual-write

```text
write owner_user_id and assigned_officer_id
read fallback from owner_user_id if assigned_officer_id null
```

### Step 3 — Backfill batch kecil

```sql
UPDATE cases
SET assigned_officer_id = owner_user_id
WHERE assigned_officer_id IS NULL
LIMIT 1000;
```

Ulangi secara terkendali.

### Step 4 — Switch read path

App membaca `assigned_officer_id` sebagai primary source.

### Step 5 — Contract

Setelah semua app lama hilang dan data valid:

```sql
ALTER TABLE cases DROP COLUMN owner_user_id;
```

Drop column tetap butuh perencanaan. Jangan dilakukan terburu-buru.

## 22.2 Keuntungan

- app rollback lebih aman,
- MDL setiap step lebih kecil risikonya,
- backfill bisa dikontrol,
- data validation bisa dilakukan bertahap,
- tidak perlu big bang.

---

# 23. Pattern: Backfill Tanpa Membunuh Production

Backfill sering mengikuti schema migration.

Contoh:

```sql
ALTER TABLE cases ADD COLUMN risk_bucket VARCHAR(16) NULL;
```

Lalu mengisi:

```sql
UPDATE cases
SET risk_bucket = CASE ...
WHERE risk_bucket IS NULL;
```

Jangan lakukan full-table update besar langsung.

## 23.1 Buruk

```sql
UPDATE cases
SET risk_bucket = 'LOW'
WHERE risk_bucket IS NULL;
```

Risiko:

- transaksi besar,
- undo log besar,
- redo log tinggi,
- replication lag,
- row locks luas,
- buffer pool pressure,
- rollback mahal,
- MDL tetap tertahan selama transaction.

## 23.2 Lebih Aman

Batch berdasarkan primary key:

```sql
UPDATE cases
SET risk_bucket = 'LOW'
WHERE id > ?
  AND id <= ?
  AND risk_bucket IS NULL;
```

Atau ambil batch id dulu:

```sql
SELECT id
FROM cases
WHERE risk_bucket IS NULL
ORDER BY id
LIMIT 1000;
```

Lalu update by id list.

Prinsip:

- transaksi kecil,
- commit sering,
- sleep antar batch jika perlu,
- monitor replication lag,
- idempotent,
- restartable,
- progress table.

## 23.3 Java Batch Worker Skeleton

```java
public final class CaseRiskBucketBackfillJob {
    private final CaseRepository caseRepository;
    private final BackfillProgressRepository progressRepository;

    public void runOnce() {
        long lastId = progressRepository.getLastProcessedId("case-risk-bucket-v1");
        List<Long> ids = caseRepository.findNextIdsMissingRiskBucket(lastId, 1000);

        if (ids.isEmpty()) {
            progressRepository.markComplete("case-risk-bucket-v1");
            return;
        }

        backfillBatch(ids);

        long newLastId = ids.get(ids.size() - 1);
        progressRepository.updateLastProcessedId("case-risk-bucket-v1", newLastId);
    }

    @Transactional
    void backfillBatch(List<Long> ids) {
        caseRepository.updateRiskBucketForIds(ids);
    }
}
```

Catatan desain:

- `runOnce` tidak harus satu transaksi besar.
- `backfillBatch` transaksi kecil.
- progress harus restartable.
- update harus idempotent.
- throttle berdasarkan metrics.

---

# 24. Operational Surprise: `ALTER` Menunggu `SELECT` Yang Sudah Selesai?

Kadang engineer berkata:

> “Tapi SELECT-nya sudah selesai, kenapa ALTER masih menunggu?”

Kemungkinan:

1. SELECT selesai, tapi transaksi belum commit.
2. Client membuka cursor/streaming result dan belum consume semua row.
3. Session dalam state Sleep tapi transaction masih aktif.
4. Ada prepared statement/cursor/resource server-side yang belum ditutup.
5. Ada query lain dari session sama setelah SELECT.
6. Tool SQL client menahan transaction untuk repeatable read.

Di Java, streaming result set bisa menjadi jebakan.

Contoh:

```java
@Transactional(readOnly = true)
public void exportCases(OutputStream out) {
    Stream<CaseEntity> stream = caseRepository.streamAllOpenCases();
    stream.forEach(caseEntity -> writeCsv(out, caseEntity));
}
```

Jika export butuh 30 menit, transaction juga bisa terbuka 30 menit.

DDL terhadap table terkait bisa tertahan.

Solusi:

- gunakan replica/reporting DB,
- pagination per batch,
- commit antar batch,
- hindari long transaction export dari primary,
- set query timeout,
- pisahkan read model untuk export besar.

---

# 25. Operational Surprise: `CREATE INDEX` Membuat Replica Lag

Tambah index pada table besar bisa berjalan online di primary, tetapi tetap berat.

Efek:

- primary I/O naik,
- replica menerapkan DDL dan bisa tertahan,
- SQL thread/applier replica sibuk,
- read traffic ke replica melambat,
- replication lag naik,
- app membaca data lama dari replica.

Jika sistem punya routing read ke replica, pengguna bisa melihat state stale lebih lama.

Untuk case-management:

- user submit enforcement action di primary,
- redirect ke detail page baca dari replica,
- replica lag karena DDL/index build,
- user melihat status lama,
- user submit ulang,
- duplicate action.

Solusi:

- sticky read to primary setelah write,
- idempotency key,
- lag-aware routing,
- maintenance window,
- throttle DDL/tool,
- feature flag.

---

# 26. Operational Surprise: DDL Gagal Tapi App Sudah Deploy

Deployment pipeline buruk:

1. App baru deploy.
2. App baru butuh column `risk_score`.
3. Migration `ADD COLUMN risk_score` stuck/gagal.
4. App menerima traffic.
5. Query gagal:

```text
Unknown column 'risk_score' in 'field list'
```

Solusi:

- migration harus sebelum app jika app butuh schema baru,
- app harus compatible dengan schema lama jika migration mungkin gagal,
- feature flag field baru,
- readiness check yang memvalidasi schema minimum,
- deployment stage harus berhenti jika migration gagal.

Untuk zero-downtime:

- release N: add nullable column, app belum wajib pakai,
- release N+1: app mulai write/read compatible,
- release N+2: enforce constraint/drop old.

---

# 27. Operational Surprise: Drop Column Terlihat Aman Tapi Tidak Reversible

Drop column adalah operasi destructive.

Walaupun cepat secara metadata pada versi tertentu, dampaknya besar:

- app lama rusak,
- data hilang,
- rollback sulit,
- backup restore mungkin satu-satunya jalan,
- CDC consumer bisa gagal,
- BI query bisa gagal,
- audit report lama bisa rusak.

Untuk regulated systems, drop data harus dikaitkan dengan:

- retention policy,
- legal hold,
- audit requirement,
- data lineage,
- reporting dependency,
- consent/privacy obligations bila relevan.

Checklist sebelum drop:

- column tidak dibaca app versi mana pun,
- tidak dipakai report,
- tidak dipakai CDC consumer,
- tidak dipakai stored routine/view/trigger,
- tidak dipakai export/audit,
- backup retention cukup,
- owner bisnis setuju,
- rollback plan realistis.

---

# 28. Guardrails Untuk Aplikasi Java

MDL prevention bukan hanya tugas DBA.

Aplikasi Java harus didesain agar tidak menahan database resource terlalu lama.

## 28.1 Gunakan transaction boundary sempit

Buruk:

```java
@Transactional
public void processCase(long caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    ExternalResult r = externalApi.call(c.getSubjectId());
    c.apply(r);
    auditPublisher.publish(c); // network call
}
```

Lebih baik:

```java
public void processCase(long caseId) {
    CaseSnapshot snapshot = loadSnapshot(caseId);
    ExternalResult r = externalApi.call(snapshot.subjectId());
    applyResult(caseId, r);
}

@Transactional(readOnly = true)
CaseSnapshot loadSnapshot(long caseId) {
    return caseRepository.loadSnapshot(caseId);
}

@Transactional
void applyResult(long caseId, ExternalResult r) {
    Case c = caseRepository.findByIdForUpdate(caseId).orElseThrow();
    c.apply(r);
    outboxRepository.save(Event.from(c));
}
```

## 28.2 Timeout harus berlapis

- HTTP request timeout,
- DB query timeout,
- transaction timeout,
- connection acquisition timeout,
- socket timeout,
- lock wait timeout,
- migration lock wait timeout.

Jangan hanya mengandalkan satu timeout.

## 28.3 HikariCP leak detection

Aktifkan leak detection di environment yang sesuai:

```properties
spring.datasource.hikari.leak-detection-threshold=30000
```

Jangan anggap ini solusi permanen, tapi sebagai signal.

## 28.4 Observability per query family

Track:

- query latency,
- connection acquisition latency,
- active connections,
- pending threads,
- transaction duration,
- long-running request,
- blocked SQL state/error.

Jika app hanya punya metric “DB latency average”, MDL incident akan terlambat terlihat.

---

# 29. Guardrails Untuk Migration Tool

## 29.1 Flyway/Liquibase harus punya timeout

Pastikan migration connection punya session setting aman.

Contoh SQL migration header:

```sql
SET SESSION lock_wait_timeout = 10;

ALTER TABLE cases
    ADD COLUMN risk_score INT NULL,
    ALGORITHM=INSTANT,
    LOCK=NONE;
```

## 29.2 Jangan campur risky DDL dalam satu migration besar

Buruk:

```sql
ALTER TABLE cases ADD COLUMN risk_score INT NULL;
ALTER TABLE case_events ADD INDEX idx_case_events_case_created (case_id, created_at);
ALTER TABLE enforcement_actions MODIFY COLUMN action_code VARCHAR(128) NOT NULL;
DROP COLUMN old_status;
```

Jika gagal di tengah, state sulit dipahami.

Lebih baik:

- satu migration untuk satu logical change,
- pisahkan expand/backfill/contract,
- beri nama migration jelas,
- dokumentasikan rollback reality.

## 29.3 Migration harus idempotent secara operasional

Flyway secara default versioned migration tidak diulang jika sukses. Namun jika gagal, Anda harus tahu:

- apakah DDL atomic?
- apakah object sudah tercipta?
- apakah migration metadata table mencatat gagal?
- apakah perlu repair?
- apakah aman rerun?

Jangan melakukan `flyway repair` tanpa memahami schema state.

---

# 30. MDL dan Atomic DDL

MySQL modern memiliki dukungan atomic DDL untuk banyak operasi.

Atomic DDL berarti perubahan data dictionary, storage engine operation, dan binary log dikoordinasikan agar DDL tidak meninggalkan metadata setengah commit dalam banyak kasus.

Namun atomic DDL bukan berarti:

- tidak butuh metadata lock,
- selalu instant,
- selalu mudah rollback secara semantik,
- tidak berdampak ke aplikasi,
- tidak menyebabkan replication lag.

Mental model:

> Atomic DDL mengurangi risiko crash/partial metadata corruption, tetapi tidak menghapus kebutuhan operational planning.

---

# 31. MDL dan Table Rename/Cutover

Online schema change tools sering membuat shadow table:

```text
cases_new
```

Lalu melakukan cutover:

```sql
RENAME TABLE cases TO cases_old, cases_new TO cases;
```

Cutover butuh metadata lock.

Jika ada long transaction menyentuh `cases`, cutover bisa stuck.

Selama cutover pending, query baru dapat ikut tertahan.

Jadi walaupun copy data dilakukan online, fase rename tetap critical.

Guardrail:

- cutover timeout,
- low-traffic window,
- monitor long transactions,
- ability to abort,
- clear rollback table names,
- test exact tool behavior.

---

# 32. MDL dan Temporary Table

Temporary table punya namespace dan metadata sendiri. Namun statement yang membaca table base tetap mengambil metadata lock terhadap base table.

Contoh:

```sql
CREATE TEMPORARY TABLE tmp_case_ids AS
SELECT id FROM cases WHERE status = 'OPEN';
```

Walaupun hasilnya temporary table, query tetap membaca `cases`.

Jika berada dalam transaction panjang, metadata lock terhadap `cases` bisa tetap relevan.

Jangan menganggap “temporary” berarti bebas dari dampak terhadap source table selama statement/transaction.

---

# 33. MDL dan Views/Stored Routines/Triggers

Jika aplikasi memakai view atau stored routine, dependency metadata bisa lebih sulit terlihat.

Contoh:

```sql
CREATE VIEW open_cases AS
SELECT * FROM cases WHERE status = 'OPEN';
```

Query:

```sql
SELECT * FROM open_cases;
```

Secara dependency, ia menggunakan `cases`.

DDL pada `cases` dapat berinteraksi dengan penggunaan view.

Demikian juga trigger:

```sql
CREATE TRIGGER case_events_after_insert
AFTER INSERT ON case_events
FOR EACH ROW
INSERT INTO case_audit_log (...);
```

DDL terhadap table terkait trigger/audit bisa punya dependency tambahan.

Dalam sistem Java modern, view/stored routine mungkin tidak banyak dipakai. Tetapi jika ada legacy/reporting layer, dokumentasikan dependency-nya.

---

# 34. Anti-Patterns Yang Harus Dihindari

## 34.1 Menjalankan ALTER table besar tanpa preflight

```sql
ALTER TABLE case_events ADD INDEX idx_x (...);
```

Tanpa cek transaksi lama, ukuran table, replication lag, dan timeout.

## 34.2 Migration otomatis di setiap app instance

Banyak instance mencoba startup, salah satu migrasi, lainnya menunggu, orchestration restart, sistem kacau.

## 34.3 Menambah connection pool saat DB stuck

Jika query stuck karena MDL, menambah pool memperbanyak query blocked dan memperberat recovery.

## 34.4 External call di dalam transaction

Membuat transaksi panjang dan menahan resource DB tanpa perlu.

## 34.5 Full-table backfill dalam satu transaksi

Berisiko undo/redo besar, replication lag, rollback lama, row lock panjang, dan MDL transaction duration panjang.

## 34.6 Drop/rename destructive tanpa compatibility window

Menyebabkan app lama, job, report, dan CDC consumer gagal.

## 34.7 Menganggap `LOCK=NONE` berarti zero lock

`LOCK=NONE` mengurangi blocking DML sesuai kemampuan online DDL, tetapi metadata coordination tetap ada.

---

# 35. Practical Lab: Reproduksi Metadata Lock

Gunakan local MySQL, bukan production.

## 35.1 Setup

```sql
CREATE DATABASE mdl_lab;
USE mdl_lab;

CREATE TABLE cases (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME NOT NULL
) ENGINE=InnoDB;

INSERT INTO cases(status, created_at)
VALUES ('OPEN', NOW()), ('CLOSED', NOW());
```

## 35.2 Session A

```sql
USE mdl_lab;
START TRANSACTION;
SELECT * FROM cases WHERE id = 1;
-- jangan COMMIT dulu
```

## 35.3 Session B

```sql
USE mdl_lab;
ALTER TABLE cases ADD COLUMN risk_score INT NULL;
```

Session B akan menunggu jika Session A menahan MDL.

## 35.4 Session C

```sql
SHOW FULL PROCESSLIST;
```

Cari:

```text
Waiting for table metadata lock
```

Cek transaction:

```sql
SELECT
    trx_mysql_thread_id,
    trx_started,
    trx_state,
    trx_query
FROM information_schema.innodb_trx;
```

Cek metadata lock:

```sql
SELECT
    OBJECT_SCHEMA,
    OBJECT_NAME,
    LOCK_TYPE,
    LOCK_DURATION,
    LOCK_STATUS,
    OWNER_THREAD_ID
FROM performance_schema.metadata_locks
WHERE OBJECT_SCHEMA = 'mdl_lab';
```

## 35.5 Release

Di Session A:

```sql
COMMIT;
```

Session B harus lanjut.

## 35.6 Pelajaran

- SELECT dalam transaction dapat menahan metadata lock.
- ALTER menunggu metadata lock.
- Processlist memberi signal cepat.
- Session idle bisa menjadi blocker.

---

# 36. Practical Lab: DDL Fail Fast

Reset:

```sql
ALTER TABLE cases DROP COLUMN risk_score;
```

Session A:

```sql
START TRANSACTION;
SELECT * FROM cases WHERE id = 1;
```

Session B:

```sql
SET SESSION lock_wait_timeout = 5;
ALTER TABLE cases ADD COLUMN risk_score INT NULL;
```

Setelah sekitar 5 detik, ALTER akan gagal karena timeout.

Pelajaran:

- fail fast lebih aman daripada membuat antrean panjang,
- migration pipeline harus menangani failure dengan jelas,
- DDL retry harus dilakukan setelah root cause hilang.

---

# 37. Practical Lab: Pending DDL Membuat Query Baru Ikut Menunggu

Session A:

```sql
START TRANSACTION;
SELECT * FROM cases WHERE id = 1;
```

Session B:

```sql
ALTER TABLE cases ADD COLUMN another_col INT NULL;
```

Session C:

```sql
SELECT * FROM cases WHERE id = 2;
```

Amati apakah Session C ikut menunggu.

Ini menunjukkan pola outage klasik:

```text
old transaction -> pending DDL -> new queries queue
```

---

# 38. Production-Grade Migration Template

Contoh template untuk migration aman:

```sql
-- Migration: add cases.risk_score
-- Type: expand
-- Expected algorithm: instant
-- Expected lock behavior: no long DML blocking, but short MDL required
-- Rollback: leave column unused; do not drop immediately

SET SESSION lock_wait_timeout = 10;

ALTER TABLE cases
    ADD COLUMN risk_score INT NULL,
    ALGORITHM=INSTANT,
    LOCK=NONE;
```

Dokumentasi tambahan di PR:

```text
Purpose:
- Add nullable risk_score for future risk scoring feature.

Compatibility:
- Old app ignores column.
- New app writes column only behind feature flag.

Operational risk:
- Requires metadata lock.
- Should be instant on MySQL 8.4 for this table shape.
- Fails fast after 10 seconds if MDL unavailable.

Preflight:
- Check no long transactions on cases.
- Check replication lag < threshold.

Postflight:
- Confirm column exists on primary and replicas.
- Confirm no increase in DB latency.
```

---

# 39. Production Checklist: Metadata Lock Readiness

Sebelum DDL:

- [ ] Apakah jenis DDL sudah diketahui algorithm-nya?
- [ ] Apakah table size dan traffic diketahui?
- [ ] Apakah ada transaksi lama?
- [ ] Apakah ada batch/report berjalan?
- [ ] Apakah ada replica lag?
- [ ] Apakah app lama dan baru compatible?
- [ ] Apakah migration punya `lock_wait_timeout`?
- [ ] Apakah migration idempotent/repairable?
- [ ] Apakah rollback app tetap aman?
- [ ] Apakah query monitoring aktif?
- [ ] Apakah owner tahu abort criteria?

Saat DDL:

- [ ] Monitor processlist.
- [ ] Monitor metadata locks.
- [ ] Monitor app latency.
- [ ] Monitor active DB connections.
- [ ] Monitor replication lag.
- [ ] Monitor disk/temp usage untuk DDL besar.

Jika stuck:

- [ ] Identifikasi pending DDL.
- [ ] Identifikasi blocker.
- [ ] Tentukan apakah kill DDL atau blocker.
- [ ] Cegah retry storm.
- [ ] Catat timeline.

Sesudah DDL:

- [ ] Verify schema primary.
- [ ] Verify schema replica.
- [ ] Verify app metrics.
- [ ] Verify migration metadata.
- [ ] Document actual duration and issue.

---

# 40. Deep Mental Model: MDL Sebagai Coordination Protocol

Jangan pikir MDL sebagai “lock aneh yang mengganggu ALTER”.

Pikirkan MDL sebagai coordination protocol antara:

- session yang memakai object,
- DDL yang mengubah object,
- transaction yang butuh definisi stabil,
- binary logging,
- replication,
- data dictionary,
- storage engine,
- application deployment.

DDL bukan hanya perubahan schema.

DDL adalah perubahan kontrak antara database dan semua client.

Jika kontrak itu berubah saat client lama masih aktif, saat transaction lama masih memegang snapshot, saat replica belum catch up, atau saat app baru belum siap, maka sistem bisa gagal.

MDL memaksa perubahan kontrak itu diserialisasi.

Masalah muncul ketika serialization point ini tidak dimodelkan dalam deployment process.

---

# 41. Relevansi Untuk Regulatory / Case Management Systems

Dalam sistem enforcement/case-management, table pusat biasanya memiliki karakteristik:

- high read volume,
- moderate/high write volume,
- audit-heavy,
- banyak foreign key logical,
- banyak workflow state,
- banyak report,
- long retention,
- ada legal/audit constraints,
- banyak consumer internal.

Contoh table:

```text
cases
case_events
case_assignments
enforcement_actions
case_documents
case_sla_timers
case_audit_log
```

Schema change pada `cases` tidak hanya perubahan teknis. Ia bisa memengaruhi:

- officer dashboard,
- escalation queue,
- SLA calculation,
- audit trail,
- reporting,
- document generation,
- notification,
- external integration,
- data retention.

Karena itu migration harus diperlakukan sebagai workflow operasional:

```text
propose -> classify risk -> preflight -> deploy schema expand -> deploy app -> backfill -> verify -> contract
```

Bukan sebagai:

```text
merge PR -> run ALTER -> hope
```

---

# 42. Common Interview/Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman.

## 42.1 Conceptual

1. Apa beda metadata lock dan row lock?
2. Kenapa `SELECT` bisa menghalangi `ALTER TABLE`?
3. Kenapa `ALTER TABLE` yang sedang menunggu bisa membuat query baru ikut stuck?
4. Apa arti `Waiting for table metadata lock`?
5. Kenapa `LOCK=NONE` tidak berarti zero locking?
6. Apa hubungan long transaction dengan MDL?
7. Apa risiko menjalankan migration saat app startup?
8. Kenapa read-only analytics tetap bisa mengganggu schema migration?
9. Apa bedanya membunuh query dan membunuh connection?
10. Kenapa expand-contract membantu zero-downtime migration?

## 42.2 Practical

1. DDL stuck 30 menit. Query apa yang Anda jalankan pertama?
2. Bagaimana mencari session blocker yang terlihat Sleep?
3. Kapan lebih baik kill DDL daripada kill blocker?
4. Bagaimana mendesain migration agar fail fast?
5. Bagaimana mencegah Flyway migration menggantung deployment?
6. Bagaimana memastikan app baru tidak membaca column baru dari replica yang belum apply DDL?
7. Bagaimana menjalankan backfill 500 juta row dengan aman?
8. Apa metric aplikasi yang membantu mendeteksi MDL incident?

---

# 43. Ringkasan Inti

Metadata lock adalah mekanisme MySQL untuk menjaga konsistensi definisi object database.

Poin utama:

1. Query biasa juga mengambil metadata lock.
2. SELECT dalam transaction dapat menahan MDL sampai transaction selesai.
3. DDL membutuhkan metadata lock kuat.
4. DDL yang menunggu dapat menyebabkan query baru ikut antre.
5. Session blocker sering terlihat sebagai `Sleep`, bukan query aktif.
6. Online/instant DDL tetap membutuhkan metadata coordination.
7. Migration production perlu timeout, preflight, observability, dan abort criteria.
8. Connection pool exhaustion sering efek lanjutan, bukan root cause.
9. Expand-contract mengurangi risiko compatibility dan operational lock.
10. Dalam sistem Java, transaction boundary yang buruk bisa menjadi penyebab schema migration outage.

Mental model paling penting:

> Metadata lock adalah serialization point untuk perubahan kontrak schema. Jika deployment process tidak menghormati serialization point ini, DDL kecil pun bisa menjadi outage besar.

---

# 44. Apa Yang Harus Dikuasai Setelah Part Ini

Setelah menyelesaikan bagian ini, Anda seharusnya mampu:

- membedakan row lock dan metadata lock,
- menjelaskan kenapa DDL bisa stuck,
- menjelaskan kenapa query baru bisa blocked oleh pending DDL,
- mencari session blocker dengan `SHOW PROCESSLIST`, `information_schema.innodb_trx`, dan `performance_schema.metadata_locks`,
- membuat migration dengan `lock_wait_timeout`,
- mendesain expand-contract migration,
- menghindari long transaction dari aplikasi Java,
- memahami risiko Flyway/Liquibase di startup,
- membuat runbook untuk stuck migration,
- menilai risiko schema change pada table critical.

---

# 45. Preview Part Berikutnya

Part berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-026.md
```

Topik:

```text
Security: Users, Privileges, TLS, Secrets, and Auditability
```

Kita akan membahas MySQL security dari sudut production engineering:

- user model,
- host-qualified users,
- authentication plugin,
- roles,
- least privilege,
- runtime user vs migration user,
- TLS,
- secret rotation,
- SQL injection boundary,
- audit logging,
- access traceability,
- dan desain privilege untuk sistem Java/regulatory.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Schema Migration Without Taking Production Down</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-026.md">Part 026 — Security: Users, Privileges, TLS, Secrets, and Auditability ➡️</a>
</div>
