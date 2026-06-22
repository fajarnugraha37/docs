# learn-mysql-mastery-for-java-engineers-part-030.md

# Part 030 — Partitioning, Archiving, Retention, and Large Tables

## Status Seri

- Seri: `learn-mysql-mastery-for-java-engineers`
- Part: `030 / 034`
- Topik: Partitioning, Archiving, Retention, and Large Tables
- Fokus: bagaimana menangani tabel besar di MySQL secara production-safe tanpa menganggap partitioning sebagai solusi ajaib.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami kapan sebuah tabel mulai menjadi “large table” dari sudut operasional, bukan hanya jumlah row.
2. Membedakan partitioning, indexing, sharding, archival, dan purging.
3. Mendesain retention policy yang bisa dieksekusi tanpa menghancurkan performa production.
4. Memahami limitasi partitioning MySQL, terutama terkait unique key, foreign key, pruning, dan query pattern.
5. Menentukan kapan partitioning membantu dan kapan justru memperbesar kompleksitas.
6. Mendesain strategi delete batching, archival table, hot/cold split, dan legal hold untuk sistem regulatory/case management.
7. Menghubungkan keputusan data lifecycle ke Java service, scheduler, transaction boundary, audit trail, dan operational runbook.

---

## 2. Mental Model Utama

Tabel besar bukan masalah karena “banyak row”.

Tabel besar menjadi masalah ketika ukuran, pola akses, dan pola perubahan data membuat operasi normal berubah menjadi operasi berisiko.

Contoh:

- query dashboard makin lambat;
- index makin besar sehingga cache miss meningkat;
- backup/restore makin lama;
- migration makin berbahaya;
- delete retention menyebabkan lock, undo bloat, replication lag;
- ALTER TABLE menjadi operasi multi-jam;
- reindex atau schema change menjadi incident;
- primary key range lama tidak pernah disentuh tapi tetap membebani working set;
- compliance meminta data disimpan 7 tahun, tetapi produk hanya butuh 90 hari data panas.

Partitioning hanyalah salah satu alat. Dalam banyak kasus, solusi yang lebih tepat adalah:

- indeks yang benar;
- tabel historis terpisah;
- archival pipeline;
- summary table;
- purge batching;
- data lifecycle state machine;
- replica/reporting store;
- object storage export;
- atau bahkan shard/tenant split.

Cara berpikir yang benar:

> Jangan mulai dari “apakah perlu partitioning?”  
> Mulai dari “data ini punya lifecycle apa, query pattern apa, retention obligation apa, dan failure mode apa?”

---

## 3. Apa Itu Large Table?

Tidak ada angka universal.

Tabel 10 juta row bisa sehat. Tabel 1 juta row bisa bermasalah. Tabel 2 miliar row bisa baik-baik saja jika workload, index, dan lifecycle-nya benar.

Sebuah tabel mulai menjadi large table ketika satu atau lebih dari kondisi berikut muncul.

### 3.1 Working Set Tidak Muat di Buffer Pool

Jika query harian hanya menyentuh data 30 hari terakhir, tetapi indeks mencakup data 7 tahun, maka MySQL tetap harus menyimpan struktur B+Tree yang besar.

Efeknya:

- page cache miss meningkat;
- random I/O meningkat;
- latency tail memburuk;
- query yang dulu cepat menjadi tidak stabil;
- buffer pool diisi page lama yang tidak produktif.

### 3.2 Operasi Maintenance Menjadi Berisiko

Contoh:

- `ALTER TABLE` butuh waktu lama;
- adding index menjadi mahal;
- `OPTIMIZE TABLE` tidak realistis;
- backup/restore lama;
- checksum/consistency check mahal;
- migration perlu window khusus.

### 3.3 Purge atau Delete Menjadi Incident

Contoh buruk:

```sql
DELETE FROM audit_event
WHERE created_at < NOW() - INTERVAL 7 YEAR;
```

Jika statement ini menghapus jutaan row dalam satu transaksi:

- undo log membesar;
- redo log berat;
- locks bertahan lama;
- replication lag naik;
- buffer pool churn;
- disk I/O spike;
- rollback jika gagal bisa sangat lama.

### 3.4 Query Plan Menjadi Tidak Stabil

Ketika distribusi data berubah, optimizer bisa memilih plan berbeda.

Contoh:

- status `OPEN` dulu 5%, sekarang 70%;
- tenant besar mendominasi tabel;
- data lama punya distribusi berbeda dari data baru;
- histogram/statistik tidak mewakili query aktual;
- index yang baik untuk tenant kecil buruk untuk tenant besar.

### 3.5 Data Lifecycle Tidak Lagi Seragam

Satu tabel menyimpan:

- data aktif;
- data closed;
- data archived;
- data under legal hold;
- data expired;
- data exported;
- data reporting;
- data regulatory evidence.

Jika lifecycle berbeda tetapi disimpan dalam satu struktur tanpa strategi, tabel menjadi tempat semua concern bertabrakan.

---

## 4. Lima Strategi Menghadapi Large Table

Sebelum masuk partitioning, pahami pilihan desain yang tersedia.

### 4.1 Better Indexing

Jika masalahnya query lambat karena access path buruk, partitioning belum tentu menyelesaikan.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = ?
  AND status = 'OPEN'
  AND due_at < ?
ORDER BY due_at
LIMIT 100;
```

Index kandidat:

```sql
CREATE INDEX idx_case_queue
ON enforcement_case (tenant_id, status, due_at, id);
```

Jika query selalu memiliki `tenant_id`, `status`, dan range/order by `due_at`, index ini jauh lebih penting daripada partitioning.

### 4.2 Archiving

Archiving berarti memindahkan data yang tidak aktif ke lokasi lain.

Bisa berupa:

- table historis di database yang sama;
- database/schema terpisah;
- read-only archive cluster;
- object storage;
- data warehouse;
- lakehouse;
- search index;
- compressed export.

Archiving cocok jika data lama jarang diakses tetapi masih perlu disimpan.

### 4.3 Purging

Purging berarti menghapus data yang secara legal dan bisnis sudah tidak perlu disimpan.

Purging harus:

- batch kecil;
- resumable;
- observable;
- idempotent;
- aman terhadap replication lag;
- menghormati legal hold;
- tidak menghapus audit evidence yang masih wajib disimpan.

### 4.4 Partitioning

Partitioning membagi satu tabel logis menjadi beberapa partition fisik internal.

Keuntungan utama:

- partition pruning;
- drop partition cepat untuk retention;
- operasi maintenance per partition;
- isolasi data berdasarkan range/hash/list tertentu.

Tetapi partitioning bukan pengganti index.

### 4.5 Sharding atau Table Split

Sharding membagi data ke beberapa database/server. Ini jauh lebih kompleks daripada partitioning.

Biasanya dipertimbangkan jika:

- write throughput satu server tidak cukup;
- data size terlalu besar untuk satu instance;
- tenant isolation sangat penting;
- operational blast radius harus dibatasi;
- geo/regulatory boundary mengharuskan pemisahan.

Dalam seri ini, sharding hanya disinggung sebagai boundary. Fokus utama tetap MySQL single-cluster production.

---

## 5. Partitioning di MySQL: Mental Model

Partitioning membuat satu tabel logis terdiri dari beberapa partition.

Secara konseptual:

```text
audit_event
├── p2024_01
├── p2024_02
├── p2024_03
├── p2024_04
└── pmax
```

Aplikasi tetap query tabel yang sama:

```sql
SELECT * FROM audit_event WHERE created_at >= '2024-03-01';
```

Jika partition expression cocok dengan predicate, optimizer bisa melakukan partition pruning: hanya membaca partition relevan.

Tapi kalau query tidak membantu pruning, MySQL bisa tetap memeriksa banyak partition.

---

## 6. Partition Pruning

Partition pruning adalah kemampuan optimizer untuk mengeliminasi partition yang tidak relevan.

Contoh partition by range tanggal:

```sql
CREATE TABLE audit_event (
    id BIGINT NOT NULL,
    tenant_id BIGINT NOT NULL,
    created_at DATETIME NOT NULL,
    actor_id BIGINT NOT NULL,
    action VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (id, created_at)
)
PARTITION BY RANGE COLUMNS (created_at) (
    PARTITION p2024_01 VALUES LESS THAN ('2024-02-01'),
    PARTITION p2024_02 VALUES LESS THAN ('2024-03-01'),
    PARTITION p2024_03 VALUES LESS THAN ('2024-04-01'),
    PARTITION pmax VALUES LESS THAN (MAXVALUE)
);
```

Query yang bisa prune:

```sql
SELECT *
FROM audit_event
WHERE created_at >= '2024-02-01'
  AND created_at < '2024-03-01';
```

Query yang buruk untuk pruning:

```sql
SELECT *
FROM audit_event
WHERE DATE(created_at) = '2024-02-15';
```

Karena kolom partition dibungkus fungsi, optimizer bisa lebih sulit menggunakan pruning secara optimal.

Lebih baik:

```sql
SELECT *
FROM audit_event
WHERE created_at >= '2024-02-15 00:00:00'
  AND created_at <  '2024-02-16 00:00:00';
```

Mental model:

> Partitioning efektif jika query membawa predicate yang selaras dengan partition expression.

---

## 7. Jenis Partitioning yang Umum

### 7.1 RANGE Partitioning

Paling umum untuk time-series atau retention.

Contoh:

```sql
PARTITION BY RANGE COLUMNS (created_at) (
    PARTITION p2026_01 VALUES LESS THAN ('2026-02-01'),
    PARTITION p2026_02 VALUES LESS THAN ('2026-03-01'),
    PARTITION p2026_03 VALUES LESS THAN ('2026-04-01'),
    PARTITION pmax VALUES LESS THAN (MAXVALUE)
)
```

Cocok untuk:

- audit log;
- event log;
- transaction history;
- monthly retention;
- telemetry;
- SLA history;
- notification history.

Kelebihan:

- drop partition cepat;
- natural untuk tanggal;
- mudah dipahami;
- pruning intuitif.

Kekurangan:

- perlu manage partition masa depan;
- data skew jika range tidak seimbang;
- hot partition untuk write terbaru;
- query tanpa tanggal tidak terbantu.

### 7.2 LIST Partitioning

Membagi berdasarkan daftar nilai.

Contoh:

```sql
PARTITION BY LIST COLUMNS (region_code) (
    PARTITION p_jakarta VALUES IN ('JKT'),
    PARTITION p_west_java VALUES IN ('JBR'),
    PARTITION p_east_java VALUES IN ('JTM')
)
```

Cocok jika domain kecil dan stabil.

Risiko:

- perubahan domain butuh DDL;
- jumlah nilai bisa membesar;
- sering tidak fleksibel untuk product evolution.

### 7.3 HASH Partitioning

Membagi data berdasarkan hash expression.

```sql
PARTITION BY HASH (tenant_id)
PARTITIONS 16;
```

Cocok untuk:

- menyebar data antar partition;
- mengurangi ukuran per partition;
- tenant distribution.

Namun hash partitioning tidak membantu range retention.

Query:

```sql
WHERE tenant_id = ?
```

bisa terbantu pruning.

Query:

```sql
WHERE created_at < ?
```

tidak terbantu jika partition key adalah `tenant_id`.

### 7.4 KEY Partitioning

Mirip hash, tetapi MySQL menentukan hashing berdasarkan key.

Umumnya lebih jarang dipakai secara eksplisit dalam sistem aplikasi biasa karena kontrolnya lebih rendah.

---

## 8. Partitioning Bukan Index

Kesalahan umum:

> “Tabel besar lambat, kita partition saja.”

Partitioning hanya membatasi partition yang diperiksa jika predicate cocok. Di dalam partition, MySQL tetap butuh index.

Contoh query:

```sql
SELECT *
FROM audit_event
WHERE created_at >= '2026-01-01'
  AND created_at < '2026-02-01'
  AND tenant_id = ?
  AND actor_id = ?
ORDER BY created_at DESC
LIMIT 100;
```

Partitioning by `created_at` membantu memilih partition Januari 2026.

Tetapi di dalam partition, index tetap dibutuhkan:

```sql
CREATE INDEX idx_audit_tenant_actor_time
ON audit_event (tenant_id, actor_id, created_at DESC, id);
```

Tanpa index, MySQL tetap scan partition Januari.

Jika partition Januari berisi 200 juta row, scan tetap buruk.

Rule:

> Partitioning mengurangi ruang pencarian antar partition. Index mengurangi ruang pencarian di dalam partition.

---

## 9. Unique Key dan Partition Key

Ini limitasi penting.

Pada MySQL partitioned InnoDB table, unique key biasanya harus mencakup semua kolom yang digunakan dalam partitioning expression.

Contoh:

```sql
CREATE TABLE audit_event (
    id BIGINT NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id)
)
PARTITION BY RANGE COLUMNS (created_at) (...);
```

Ini bermasalah karena primary key `id` tidak mencakup `created_at`.

Biasanya perlu:

```sql
PRIMARY KEY (id, created_at)
```

atau:

```sql
PRIMARY KEY (tenant_id, id, created_at)
```

Konsekuensi desain:

- primary key menjadi lebih lebar;
- secondary index membawa primary key lebih besar;
- foreign key menjadi lebih rumit;
- aplikasi harus tahu composite identity atau minimal database harus menyimpannya;
- ORM/JPA mapping bisa makin tidak nyaman.

Karena itu partitioning bukan keputusan ringan.

---

## 10. Foreign Key dan Partitioning

Partitioning sering tidak cocok dengan schema yang sangat bergantung pada foreign key enforcement antar tabel besar.

Di banyak desain production, tabel besar seperti audit/event/history memang tidak diberi foreign key keras ke semua parent karena:

- volume tinggi;
- lifecycle berbeda;
- data historis harus tetap ada meskipun parent berubah;
- archival/retention lebih penting daripada cascade;
- audit evidence tidak boleh hilang karena parent delete.

Namun ini bukan berarti integritas diabaikan. Integritas bisa dijaga melalui:

- immutable reference fields;
- application-level validation;
- event sourcing/outbox;
- periodic consistency check;
- referential snapshot di payload;
- logical foreign key.

Contoh audit event:

```sql
CREATE TABLE audit_event (
    id BIGINT NOT NULL,
    case_id BIGINT NOT NULL,
    case_reference VARCHAR(64) NOT NULL,
    actor_id BIGINT NOT NULL,
    actor_display_name VARCHAR(255) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    action VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (id, created_at),
    KEY idx_audit_case_time (case_id, created_at DESC, id)
)
PARTITION BY RANGE COLUMNS (created_at) (...);
```

Di sini audit event menyimpan snapshot display data agar tetap bermakna secara historis.

---

## 11. Time-Based Retention

Retention policy harus diterjemahkan ke aturan teknis yang eksplisit.

Contoh requirement buruk:

> “Simpan data audit selama 7 tahun.”

Pertanyaan yang perlu dijawab:

1. 7 tahun dari kapan?
   - created_at?
   - case closed_at?
   - final decision date?
   - last appeal date?
2. Apakah semua data sama?
   - audit event;
   - attachment metadata;
   - notification log;
   - temporary import rows;
   - failed login logs;
   - user session;
   - operational trace.
3. Apakah ada legal hold?
4. Apakah data harus searchable setelah archive?
5. Apakah data harus restorable ke MySQL?
6. Apakah data bisa dianonimkan daripada dihapus?
7. Apakah purge harus menghasilkan audit trail?

Retention policy teknis yang baik:

```text
Data class: case_audit_event
Retention trigger: case_finalized_at
Retention period: 7 years
Legal hold override: yes
Archive required before purge: yes
Archive target: immutable object storage + checksum manifest
Search after archive: via archive index, not production OLTP
Purge granularity: monthly partition if no legal hold; otherwise row-level eligible purge
Evidence: purge job writes purge_batch_record
```

---

## 12. Drop Partition untuk Retention

Salah satu alasan utama memakai RANGE partitioning by time adalah kemampuan drop partition.

Contoh:

```sql
ALTER TABLE audit_event DROP PARTITION p2018_01;
```

Ini jauh lebih cepat daripada:

```sql
DELETE FROM audit_event
WHERE created_at >= '2018-01-01'
  AND created_at < '2018-02-01';
```

Karena drop partition membuang partition secara metadata/physical structure, bukan delete row satu per satu.

Namun ada syarat besar:

- seluruh data dalam partition memang eligible untuk dihapus;
- tidak ada legal hold di dalam partition;
- archive sudah selesai dan tervalidasi;
- backup/PITR implication dipahami;
- replica dapat mengikuti DDL;
- aplikasi tidak membutuhkan data tersebut di OLTP.

Jika legal hold bisa berada di bulan lama, drop partition tidak bisa langsung dilakukan kecuali data legal hold dipisahkan dulu.

---

## 13. Legal Hold: Komplikasi Besar untuk Retention

Dalam sistem regulatory, legal hold mengubah lifecycle data.

Data yang seharusnya expired tidak boleh dihapus jika:

- masih dalam investigasi;
- sedang banding;
- terkait litigation;
- menjadi evidence;
- masuk audit review;
- terkait enforcement proceeding aktif;
- sedang dalam data freeze.

Jika legal hold bercampur dengan data biasa dalam partition lama, `DROP PARTITION` menjadi tidak aman.

Solusi desain:

### 13.1 Separate Hold Table

Data yang terkena legal hold dipindahkan ke tabel khusus sebelum partition lama di-drop.

```text
audit_event_hot/partitioned
        │
        ├── archive eligible → object storage / archive DB
        └── legal hold → audit_event_legal_hold
```

### 13.2 Partition by Retention Class

Kadang data dibagi berdasarkan class:

- normal retention;
- extended retention;
- permanent evidence.

Tetapi partitioning multi-dimensional di MySQL terbatas. Sering lebih praktis memakai table split.

### 13.3 Row-Level Purge Instead of Drop Partition

Jika legal hold sparse tapi tersebar, gunakan batched delete dengan predicate eligible.

Contoh:

```sql
DELETE FROM audit_event
WHERE created_at < ?
  AND legal_hold = 0
ORDER BY created_at, id
LIMIT 1000;
```

Namun ini lebih mahal daripada drop partition.

---

## 14. Purging Tanpa Membunuh Production

Jangan purge jutaan row dalam satu transaksi.

Gunakan batch kecil dan checkpoint.

### 14.1 Pola Delete Batch

```sql
DELETE FROM notification_log
WHERE created_at < ?
ORDER BY created_at, id
LIMIT 1000;
```

Ulangi sampai affected rows = 0.

Namun query ini butuh index:

```sql
CREATE INDEX idx_notification_created_id
ON notification_log (created_at, id);
```

Tanpa index, setiap batch bisa scan besar.

### 14.2 Purge Worker dengan Checkpoint

Tabel kontrol:

```sql
CREATE TABLE purge_job_checkpoint (
    job_name VARCHAR(100) PRIMARY KEY,
    last_seen_created_at DATETIME(6) NULL,
    last_seen_id BIGINT NULL,
    updated_at DATETIME(6) NOT NULL
);
```

Purge memakai cursor:

```sql
SELECT id, created_at
FROM notification_log
WHERE created_at < :cutoff
  AND (created_at, id) > (:lastCreatedAt, :lastId)
ORDER BY created_at, id
LIMIT 1000;
```

Lalu delete by primary key:

```sql
DELETE FROM notification_log
WHERE id IN (...);
```

Atau jika primary key composite, sertakan semua key.

### 14.3 Throttling

Purge job perlu memperhatikan:

- replication lag;
- CPU database;
- disk I/O;
- lock wait;
- application latency;
- rows affected per second;
- transaction duration;
- undo growth.

Jika lag naik, pause.

Pseudo-code Java:

```java
while (true) {
    if (replicationLagTooHigh() || databaseUnderPressure()) {
        sleep(backoff);
        continue;
    }

    int deleted = purgeBatch(cutoff, batchSize);
    if (deleted == 0) break;

    sleep(shortPause);
}
```

---

## 15. Archive Before Purge

Untuk data penting, jangan langsung delete.

Lifecycle yang lebih defensible:

```text
eligible → exported → validated → archived → purge approved → purged → purge evidenced
```

### 15.1 Archive Manifest

Setiap batch archive harus punya manifest.

```sql
CREATE TABLE archive_manifest (
    id BIGINT PRIMARY KEY,
    data_class VARCHAR(100) NOT NULL,
    range_start DATETIME(6) NOT NULL,
    range_end DATETIME(6) NOT NULL,
    row_count BIGINT NOT NULL,
    checksum VARCHAR(128) NOT NULL,
    storage_uri VARCHAR(1000) NOT NULL,
    status VARCHAR(30) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    verified_at DATETIME(6) NULL
);
```

Manifest menjawab:

- apa yang diarsipkan;
- kapan;
- berapa row;
- checksum apa;
- disimpan di mana;
- siapa/job apa yang melakukan;
- kapan diverifikasi.

### 15.2 Archive Validation

Validasi bisa mencakup:

- row count;
- checksum per range;
- sample read;
- schema version;
- decryptability;
- restore rehearsal;
- searchability jika diperlukan.

### 15.3 Purge Evidence

Purge juga perlu dicatat.

```sql
CREATE TABLE purge_batch_record (
    id BIGINT PRIMARY KEY,
    data_class VARCHAR(100) NOT NULL,
    cutoff_at DATETIME(6) NOT NULL,
    archive_manifest_id BIGINT NULL,
    rows_purged BIGINT NOT NULL,
    started_at DATETIME(6) NOT NULL,
    finished_at DATETIME(6) NOT NULL,
    triggered_by VARCHAR(100) NOT NULL,
    reason VARCHAR(255) NOT NULL
);
```

Dalam sistem regulatory, kemampuan menjelaskan penghapusan data sama pentingnya dengan penghapusan itu sendiri.

---

## 16. Hot/Cold Data Split

Alih-alih menyimpan semua data dalam satu tabel, data aktif dan data lama bisa dipisah.

Contoh:

```text
enforcement_case
case_history_archive
```

Atau:

```text
audit_event_hot
audit_event_archive
```

### 16.1 Kapan Hot/Cold Split Cocok?

Cocok jika:

- query aplikasi utama hampir selalu menyentuh data aktif;
- data lama jarang diubah;
- data lama bisa read-only;
- retention berbeda;
- backup SLA berbeda;
- index kebutuhan berbeda;
- storage bisa lebih murah untuk data lama.

### 16.2 Keuntungan

- tabel hot lebih kecil;
- index hot lebih kecil;
- migration hot lebih mudah;
- cache lebih efektif;
- data lama bisa dikompresi/diarsipkan;
- OLTP tidak terbebani query historis.

### 16.3 Kerugian

- query lintas hot/cold lebih rumit;
- aplikasi perlu routing;
- reporting harus tahu kedua sumber;
- constraint antar tabel lebih rumit;
- risiko data duplication/drift;
- lifecycle job harus benar.

---

## 17. Archive Table vs Archive Database vs Object Storage

### 17.1 Archive Table di Database yang Sama

Keuntungan:

- mudah query;
- SQL tetap sama;
- sedikit perubahan aplikasi.

Kerugian:

- masih membebani instance sama;
- backup tetap besar;
- storage tetap mahal;
- maintenance tetap terdampak;
- blast radius sama.

### 17.2 Archive Database/Cluster Terpisah

Keuntungan:

- isolasi workload;
- OLTP lebih ringan;
- bisa read-only;
- bisa punya indexing berbeda;
- restore/archive lifecycle lebih fleksibel.

Kerugian:

- sinkronisasi lebih kompleks;
- access control tambahan;
- query lintas database tidak trivial;
- consistency harus didefinisikan.

### 17.3 Object Storage

Keuntungan:

- murah;
- scalable;
- cocok immutable archive;
- bisa dienkripsi;
- cocok retention panjang;
- bisa diproses oleh data lake.

Kerugian:

- bukan OLTP query store;
- restore butuh pipeline;
- schema evolution harus dikelola;
- pencarian langsung terbatas;
- perlu manifest/checksum.

---

## 18. Large Table dan Backup/Restore

Tabel besar mempengaruhi DR.

Pertanyaan penting:

1. Berapa lama backup selesai?
2. Berapa lama restore selesai?
3. Apakah restore sudah pernah diuji?
4. Apakah data archive ikut backup OLTP?
5. Apakah retention mengurangi RTO?
6. Apakah binary log untuk PITR menjadi terlalu besar?
7. Apakah large delete membuat binlog/replication membengkak?

Jika archive tidak dipisahkan, backup production akan membawa semua data historis setiap kali.

Ini sering memperburuk:

- storage cost;
- restore time;
- DR rehearsal;
- clone time;
- test environment provisioning;
- migration dry-run.

---

## 19. Large Delete dan Replication Lag

Delete besar direplikasi.

Jika primary melakukan:

```sql
DELETE FROM event_log WHERE created_at < '2020-01-01';
```

replica harus menerapkan perubahan itu juga.

Efek:

- relay log membesar;
- applier sibuk;
- replication lag naik;
- read replica menyajikan data stale;
- failover menjadi berisiko karena replica tertinggal;
- disk bisa penuh oleh binlog/relay log.

Partition drop juga direplikasi sebagai DDL. Biasanya lebih efisien daripada jutaan row delete, tetapi tetap perlu dipantau.

Retention job harus replication-aware.

---

## 20. Large Table dan Schema Migration

Semakin besar tabel, semakin mahal risiko DDL.

Contoh operasi yang perlu hati-hati:

- add index;
- change column type;
- modify nullable to not null;
- change collation;
- drop column;
- rebuild table;
- add generated column;
- add primary key;
- change partitioning.

Untuk large table, migration perlu:

- preflight check;
- estimate row count/size;
- check long transaction;
- check metadata lock risk;
- test on production-like clone;
- define rollback plan;
- define kill criteria;
- monitor replication lag;
- announce blast radius.

---

## 21. Partition Maintenance

Partitioning membutuhkan lifecycle maintenance.

### 21.1 Membuat Partition Masa Depan

Jika tidak ada partition masa depan, insert bisa gagal ketika nilai melebihi range.

Karena itu sering dibuat `pmax`:

```sql
PARTITION pmax VALUES LESS THAN (MAXVALUE)
```

Namun `pmax` juga harus di-split secara teratur.

Contoh:

```sql
ALTER TABLE audit_event REORGANIZE PARTITION pmax INTO (
    PARTITION p2026_07 VALUES LESS THAN ('2026-08-01'),
    PARTITION pmax VALUES LESS THAN (MAXVALUE)
);
```

### 21.2 Partition Calendar

Production system perlu calendar:

- create next monthly partition sebelum bulan berjalan;
- validate partition exists;
- archive old partition;
- verify archive;
- drop eligible partition;
- record operation.

### 21.3 Automation Guardrail

Automation harus punya guardrail:

- jangan drop partition tanpa manifest verified;
- jangan drop jika legal hold exists;
- jangan run jika replica lag tinggi;
- jangan run di luar window;
- jangan lanjut jika row count mismatch;
- jangan asumsi timezone ambigu.

---

## 22. Partitioning dan Query Design

Jika tabel dipartisi by `created_at`, maka query harus membawa `created_at` whenever possible.

Buruk:

```sql
SELECT *
FROM audit_event
WHERE case_id = ?
ORDER BY created_at DESC
LIMIT 100;
```

Query ini mungkin harus memeriksa banyak partition karena tidak ada batas waktu.

Lebih baik jika UI/domain menyediakan range:

```sql
SELECT *
FROM audit_event
WHERE case_id = ?
  AND created_at >= ?
  AND created_at < ?
ORDER BY created_at DESC
LIMIT 100;
```

Namun untuk audit per case, user mungkin memang ingin semua history. Maka index harus mendukung:

```sql
CREATE INDEX idx_audit_case_time
ON audit_event (case_id, created_at DESC, id);
```

Dan perlu sadar bahwa tanpa time range, partitioning by time tidak banyak membantu.

---

## 23. Multi-Tenant Large Table

Multi-tenant table sering punya data skew.

Satu tenant besar bisa mendominasi:

- row count;
- index pages;
- slow queries;
- lock contention;
- purge cost;
- reporting workload.

### 23.1 Index Tenant First

Untuk OLTP multi-tenant, banyak index perlu diawali `tenant_id`.

Contoh:

```sql
CREATE INDEX idx_case_tenant_status_due
ON enforcement_case (tenant_id, status, due_at, id);
```

### 23.2 Partition by Tenant?

Partition by tenant/hash bisa membantu jika query selalu tenant-scoped.

```sql
PARTITION BY HASH (tenant_id)
PARTITIONS 32
```

Namun ini tidak membantu time-based retention.

Jika retention juga penting, muncul konflik:

- partition by time membantu purge/drop;
- partition by tenant membantu tenant pruning;
- MySQL partitioning tidak membuat semua dimensi mudah sekaligus.

Solusi mungkin:

- tetap partition by time, index by tenant;
- split very large tenant ke cluster/table sendiri;
- archive per tenant;
- use reporting store;
- introduce tenant tiering.

### 23.3 Noisy Tenant Strategy

Untuk tenant besar:

- pisahkan reporting query;
- buat tenant-specific archive;
- batasi export;
- throttle bulk operation;
- isolate long-running job;
- evaluasi dedicated database.

---

## 24. Regulatory Case Management Example

Misalkan sistem memiliki tabel:

```text
enforcement_case
case_status_history
case_audit_event
case_assignment
case_attachment_metadata
notification_log
sla_event
external_integration_log
```

Setiap tabel punya lifecycle berbeda.

### 24.1 `enforcement_case`

- Data utama case.
- Harus query cepat untuk active case.
- Closed case tetap perlu tersedia.
- Tidak selalu cocok dipartisi karena banyak relational access.

Strategi:

- index by tenant/status/due date;
- maybe hot/cold split untuk closed case sangat lama;
- jangan delete tanpa retention policy final.

### 24.2 `case_audit_event`

- Append-only.
- Volume tinggi.
- Time-based.
- Read per case atau time range.

Strategi:

- partition by `created_at` monthly;
- primary key mencakup `created_at`;
- index `(case_id, created_at desc, id)`;
- archive before drop;
- legal hold aware.

### 24.3 `notification_log`

- Operational log.
- Bisa punya retention pendek.
- Biasanya tidak perlu disimpan selama audit case.

Strategi:

- delete batching;
- partition by month jika volume tinggi;
- summary metrics sebelum purge.

### 24.4 `external_integration_log`

- Berguna untuk debugging dan dispute.
- Payload besar.
- Bisa mengandung sensitive data.

Strategi:

- retention lebih pendek untuk raw payload;
- redacted archive;
- separate table for payload body;
- object storage untuk large payload;
- metadata tetap di MySQL.

### 24.5 `sla_event`

- Dibutuhkan untuk reporting.
- Append-only.
- Bisa di-aggregate.

Strategi:

- summary table;
- archive raw setelah aggregation;
- partition by event time;
- reporting replica/warehouse.

---

## 25. Pola Tabel untuk Large Event Log

Contoh desain event log production-oriented:

```sql
CREATE TABLE case_audit_event (
    id BIGINT NOT NULL,
    tenant_id BIGINT NOT NULL,
    case_id BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    actor_id BIGINT NULL,
    actor_type VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    event_version INT NOT NULL,
    payload JSON NOT NULL,
    legal_hold TINYINT NOT NULL DEFAULT 0,
    archive_status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    PRIMARY KEY (id, created_at),
    KEY idx_case_audit_case_time (case_id, created_at DESC, id),
    KEY idx_case_audit_tenant_time (tenant_id, created_at DESC, id),
    KEY idx_case_audit_archive (archive_status, created_at, id),
    KEY idx_case_audit_hold (legal_hold, created_at, id)
)
PARTITION BY RANGE COLUMNS (created_at) (
    PARTITION p2026_01 VALUES LESS THAN ('2026-02-01'),
    PARTITION p2026_02 VALUES LESS THAN ('2026-03-01'),
    PARTITION p2026_03 VALUES LESS THAN ('2026-04-01'),
    PARTITION pmax VALUES LESS THAN (MAXVALUE)
);
```

Perhatikan:

- `created_at` ikut primary key karena partitioning;
- ada index untuk case history;
- ada index untuk tenant time query;
- ada index untuk archive workflow;
- ada flag legal hold;
- payload JSON untuk snapshot event, tetapi query utama tidak bergantung penuh pada JSON.

Caveat:

- key makin banyak berarti write amplification;
- `legal_hold` low-cardinality, tetapi dikombinasikan dengan `created_at, id` untuk workflow purge;
- `archive_status` harus punya domain kecil dan lifecycle jelas;
- composite PK berdampak ke secondary index size.

---

## 26. Anti-Pattern Umum

### 26.1 Menghapus Data Lama Sekali Setahun dalam Satu Query

Buruk:

```sql
DELETE FROM audit_event WHERE created_at < '2019-01-01';
```

Lebih baik:

- partition drop jika aman;
- batch delete jika tidak;
- archive dulu;
- throttle;
- monitor replication lag.

### 26.2 Partitioning Tanpa Query Predicate yang Cocok

Jika partition by `created_at`, tetapi semua query hanya by `case_id`, pruning tidak terjadi.

### 26.3 Terlalu Banyak Partition

Banyak partition bukan selalu lebih baik.

Terlalu banyak partition bisa:

- memperbesar overhead optimizer;
- menyulitkan maintenance;
- memperbesar metadata complexity;
- memperlambat DDL tertentu;
- membuat monitoring ribet.

Monthly partition sering lebih praktis daripada daily partition untuk banyak workload, kecuali volume benar-benar besar dan retention granular perlu harian.

### 26.4 Menganggap Partitioning Mengurangi Kebutuhan Index

Salah. Partitioning dan index menyelesaikan masalah berbeda.

### 26.5 Retention Tanpa Legal Hold Model

Dalam regulatory system, ini sangat berbahaya.

Purge job harus tahu bahwa sebagian data expired secara umur tetapi tidak eligible secara hukum/proses.

### 26.6 Archive Tidak Pernah Diuji Restore

Archive yang tidak bisa dibaca ulang hanyalah ilusi compliance.

### 26.7 Menggabungkan OLTP dan Reporting Berat di Tabel Sama

Reporting query bisa menghancurkan cache OLTP.

Solusi:

- summary table;
- replica;
- warehouse;
- materialized projection;
- export pipeline.

---

## 27. Java Service Design untuk Retention Job

Retention job bukan sekadar scheduled delete.

Ia adalah workflow dengan state, checkpoint, dan observability.

### 27.1 Domain State

```text
DISCOVER_ELIGIBLE
EXPORTING
EXPORTED
VERIFYING
VERIFIED
PURGING
PURGED
FAILED
ON_HOLD
```

### 27.2 Job Table

```sql
CREATE TABLE data_retention_job (
    id BIGINT PRIMARY KEY,
    data_class VARCHAR(100) NOT NULL,
    cutoff_at DATETIME(6) NOT NULL,
    status VARCHAR(30) NOT NULL,
    batch_size INT NOT NULL,
    rows_discovered BIGINT NOT NULL DEFAULT 0,
    rows_archived BIGINT NOT NULL DEFAULT 0,
    rows_purged BIGINT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL
);
```

### 27.3 Idempotency

Jika job retry, jangan duplicate archive atau delete data yang salah.

Gunakan:

- job id;
- manifest id;
- deterministic range;
- unique constraint;
- checkpoint;
- status transition guard.

### 27.4 Transaction Boundary

Jangan satu transaksi untuk seluruh retention.

Gunakan transaksi kecil:

```text
begin
  claim batch
  update status/checkpoint
commit

export outside DB transaction

begin
  mark exported/verified
commit

begin
  delete small batch
  record purge result
commit
```

### 27.5 Backpressure

Retention job harus bisa pause berdasarkan signal:

- DB CPU high;
- replication lag high;
- disk free low;
- lock wait detected;
- application p99 latency high;
- maintenance freeze.

---

## 28. Reporting vs Transactional Storage

Large historical data sering sebenarnya dibutuhkan untuk reporting, bukan OLTP.

Jangan memaksa MySQL OLTP primary menjadi warehouse.

Alternatif:

- summary table di MySQL;
- read replica khusus reporting;
- ClickHouse/columnar store;
- Elasticsearch/OpenSearch untuk search;
- object storage + query engine;
- materialized read model.

Contoh:

Raw SLA events:

```text
sla_event: 5 billion rows
```

Dashboard hanya butuh:

```text
open cases by unit
average delay by month
breach count by category
```

Maka buat summary:

```sql
CREATE TABLE sla_monthly_summary (
    tenant_id BIGINT NOT NULL,
    month DATE NOT NULL,
    unit_id BIGINT NOT NULL,
    category VARCHAR(100) NOT NULL,
    total_cases BIGINT NOT NULL,
    breached_cases BIGINT NOT NULL,
    avg_duration_seconds BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, month, unit_id, category)
);
```

Raw event bisa diarchive lebih agresif.

---

## 29. Checklist Memilih Partitioning

Gunakan partitioning jika sebagian besar jawaban “ya”:

1. Apakah data punya dimensi partition natural, biasanya waktu?
2. Apakah query utama membawa predicate pada dimensi itu?
3. Apakah retention bisa dilakukan per partition?
4. Apakah legal hold tidak menghalangi drop partition?
5. Apakah unique key bisa didesain dengan partition key?
6. Apakah aplikasi siap dengan composite PK consequence?
7. Apakah tim siap mengelola partition lifecycle?
8. Apakah jumlah partition wajar?
9. Apakah backup/restore dan replication sudah diuji?
10. Apakah ada monitoring untuk partition maintenance?

Jangan gunakan partitioning jika:

- hanya berharap query jadi cepat tanpa index;
- query tidak menggunakan partition key;
- schema sangat bergantung pada FK kompleks;
- lifecycle data tidak align dengan partition boundary;
- tim belum siap maintenance;
- masalah sebenarnya adalah bad query/index;
- masalah sebenarnya adalah reporting workload;
- masalah sebenarnya adalah single tenant terlalu besar dan butuh isolation.

---

## 30. Checklist Large Table Readiness

Untuk setiap large table, jawab:

### 30.1 Data Profile

- Berapa row count?
- Berapa size data?
- Berapa size index?
- Growth per day/month?
- Distribusi tenant?
- Distribusi status?
- Distribusi umur data?

### 30.2 Query Profile

- Query OLTP utama apa?
- Query reporting apa?
- Query admin apa?
- Query retention apa?
- Query legal/audit apa?
- Query mana yang butuh data lama?

### 30.3 Write Profile

- Insert rate?
- Update rate?
- Delete rate?
- Append-only atau mutable?
- Hot row contention?
- Batch import?

### 30.4 Lifecycle

- Kapan data menjadi inactive?
- Kapan data boleh diarchive?
- Kapan data boleh dipurge?
- Apa exception legal hold?
- Apakah archive harus searchable?

### 30.5 Operations

- Backup duration?
- Restore duration?
- Migration risk?
- Replication lag risk?
- Purge strategy?
- Monitoring?
- Runbook?

---

## 31. Decision Framework

Gunakan decision tree berikut.

### 31.1 Masalah Query Lambat

Pertama:

- baca execution plan;
- cek index;
- cek predicate;
- cek row estimate;
- cek sorting/temp table.

Jika query selalu time-bounded dan data besar, partitioning mungkin membantu.

Jika query tidak time-bounded, partitioning by time mungkin tidak membantu.

### 31.2 Masalah Retention/Delete

Jika data expired bisa dihapus per range penuh:

- gunakan range partitioning;
- archive lalu drop partition.

Jika legal hold tersebar:

- gunakan row-level purge;
- atau pisahkan held data;
- atau redesign lifecycle.

### 31.3 Masalah Backup/Restore Terlalu Lama

Pertimbangkan:

- archive old data keluar OLTP;
- split hot/cold;
- reduce raw log retention;
- summary/reporting separation.

Partitioning saja tidak selalu mengurangi backup jika semua partition tetap berada di instance sama.

### 31.4 Masalah Tenant Besar

Jika satu tenant mendominasi:

- tenant-aware index;
- reporting isolation;
- archive per tenant;
- dedicated shard/cluster untuk tenant besar;
- rate limiting bulk job.

Partitioning by time tidak menyelesaikan noisy tenant sepenuhnya.

---

## 32. Practical Exercise

Ambil tabel hipotetis:

```sql
CREATE TABLE case_audit_event (
    id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    case_id BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    action VARCHAR(100) NOT NULL,
    payload JSON NOT NULL
);
```

Volume:

- 50 juta row per bulan;
- retention 7 tahun;
- query utama by `case_id`;
- dashboard by tenant and month;
- legal hold bisa terjadi per case;
- audit export harus tersedia setelah archive.

Tugas desain:

1. Apakah partition by `created_at` cocok?
2. Apa primary key baru?
3. Index apa yang dibutuhkan?
4. Bagaimana legal hold mempengaruhi drop partition?
5. Apakah hot/cold split diperlukan?
6. Bagaimana archive manifest dibuat?
7. Bagaimana query per case tetap cepat?
8. Bagaimana retention job menghindari replication lag?

Jawaban arah:

- Partition by month `created_at` bisa cocok untuk retention dan range query.
- PK perlu memasukkan `created_at`, misalnya `(id, created_at)`.
- Query per case butuh index `(case_id, created_at desc, id)`.
- Legal hold membuat drop partition tidak aman kecuali held case diekstraksi/dipisahkan.
- Archive manifest wajib jika data harus defensible.
- Retention job perlu state machine, checkpoint, verification, throttling.
- Jika query audit case lama sering terjadi, archive search/read model perlu disediakan.

---

## 33. Production Runbook: Monthly Partition Retention

Contoh runbook ringkas.

### 33.1 Precheck

- Pastikan partition target sudah melewati retention cutoff.
- Pastikan tidak ada legal hold dalam partition.
- Pastikan archive manifest verified.
- Pastikan backup terbaru sehat.
- Pastikan replica lag normal.
- Pastikan disk free cukup.
- Pastikan tidak ada long transaction.
- Pastikan maintenance window disetujui jika perlu.

### 33.2 Execution

```sql
ALTER TABLE case_audit_event DROP PARTITION p2019_01;
```

### 33.3 Postcheck

- Cek row count expected.
- Cek application error.
- Cek replication lag.
- Cek disk usage.
- Cek slow query.
- Cek archive retrieval sample.
- Catat purge record.

### 33.4 Rollback Reality

Drop partition tidak bisa di-rollback seperti transaksi biasa.

Rollback praktis berarti restore dari backup/archive.

Karena itu precheck jauh lebih penting daripada “rollback script”.

---

## 34. Prinsip Desain Akhir

1. Tabel besar adalah masalah lifecycle, bukan hanya masalah query.
2. Partitioning membantu jika partition key selaras dengan query dan retention.
3. Partitioning bukan pengganti index.
4. Drop partition sangat powerful, tetapi hanya aman jika data dalam partition benar-benar eligible.
5. Legal hold dapat menghancurkan asumsi retention sederhana.
6. Purge harus batch, throttled, resumable, dan observable.
7. Archive harus verified dan restorable.
8. Data hot dan cold sering punya kebutuhan berbeda.
9. Reporting berat sebaiknya tidak dipaksakan ke primary OLTP.
10. Java retention job harus diperlakukan sebagai workflow production, bukan cron sederhana.

---

## 35. Ringkasan Mental Model

Untuk large table di MySQL, jangan bertanya:

> “Bagaimana membuat tabel besar ini tetap cepat?”

Tanyakan:

> “Data mana yang masih aktif, data mana yang historis, data mana yang wajib disimpan, data mana yang boleh dihapus, query mana yang harus cepat, dan operasi mana yang bisa menghancurkan production?”

Dari situ baru pilih strategi:

- index untuk access path;
- partitioning untuk pruning dan retention boundary;
- archival untuk data lama;
- purge untuk data expired;
- hot/cold split untuk lifecycle berbeda;
- reporting store untuk analytical workload;
- sharding jika satu instance sudah tidak cukup.

Engineer top-tier tidak memakai partitioning karena tabel besar.

Engineer top-tier memakai partitioning ketika lifecycle, access pattern, dan operational model membuktikan bahwa partitioning adalah boundary yang tepat.

---

## 36. Koneksi ke Part Berikutnya

Bagian berikutnya akan membahas:

`learn-mysql-mastery-for-java-engineers-part-031.md`

Topik:

# JSON, Generated Columns, Full-Text, and Semi-Structured Data

Kita akan membahas bagaimana MySQL menangani data semi-terstruktur, kapan JSON masuk akal, kapan JSON menjadi schema debt, bagaimana generated column dan index JSON bekerja, serta bagaimana membatasi full-text search agar tidak berubah menjadi pengganti search engine yang salah.

---

## 37. Status Seri

Seri belum selesai.

Progress saat ini:

- Selesai: Part 000 sampai Part 030
- Tersisa: Part 031 sampai Part 034
- Bagian terakhir seri: Part 034 — Production Readiness Checklist and Capstone Architecture

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — MySQL and Application-Level Concurrency Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-031.md">Part 031 — JSON, Generated Columns, Full-Text, and Semi-Structured Data ➡️</a>
</div>
