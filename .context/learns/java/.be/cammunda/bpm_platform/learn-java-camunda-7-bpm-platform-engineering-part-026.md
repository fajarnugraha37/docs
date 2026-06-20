# learn-java-camunda-7-bpm-platform-engineering-part-026.md

# Part 026 — Database Operations: Indexing, Cleanup, Archival, Partitioning, Vacuum/Shrink, and Maintenance Windows

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `026`  
> Topik: Database operations untuk Camunda 7 production estate  
> Scope Java: Java 8 sampai Java 25, dengan perhatian pada compatibility Camunda 7, driver JDBC, connection pool, container runtime, dan operational runtime behavior.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas performance dari sisi engine, job executor, external task, query pattern, variable, dan history. Bagian ini turun satu lapisan lebih operasional: **bagaimana merawat database Camunda 7 sebagai sistem produksi yang hidup lama**.

Camunda 7 bukan workflow engine yang menyimpan state utama di memory. Camunda 7 adalah engine yang menjadikan database sebagai **durable state store**, **coordination point**, **job queue**, **runtime graph**, **history projection**, dan kadang **operational evidence source**.

Karena itu, database Camunda tidak bisa diperlakukan seperti tabel aplikasi biasa yang boleh:

- dihapus langsung sesuka hati,
- diubah row-nya secara manual,
- ditambah index tanpa analisis workload,
- dipartisi tanpa memahami query engine,
- dibersihkan dengan script ad-hoc,
- dijadikan sumber reporting berat,
- atau dipakai sebagai dumping ground variable besar.

Target bagian ini adalah membuat kamu mampu menjawab pertanyaan-pertanyaan production-level seperti:

1. Kenapa storage Camunda naik terus walau process instance sudah selesai?
2. Kenapa delete jutaan row tidak langsung mengurangi ukuran tablespace/file?
3. Apa beda runtime cleanup, history cleanup, archival, purge, dan database shrink?
4. Bagaimana memilih TTL history yang defensible untuk compliance?
5. Kenapa `ACT_GE_BYTEARRAY` sering membengkak?
6. Bolehkah men-delete row `ACT_HI_*` langsung?
7. Kapan perlu custom index?
8. Apa risiko menambahkan index terlalu banyak?
9. Bagaimana maintenance window yang aman?
10. Bagaimana bekerja dengan DBA tanpa merusak engine state?

---

## 1. Mental Model: Database Camunda Adalah Runtime Organ, Bukan Data Warehouse

Camunda database punya beberapa peran sekaligus:

```text
Camunda Engine
   |
   | command execution
   v
Database
   |
   +-- Repository state     ACT_RE_*
   +-- Runtime state        ACT_RU_*
   +-- Historic state       ACT_HI_*
   +-- Binary/general data  ACT_GE_*
   +-- Identity state       ACT_ID_*
```

Kalau aplikasi biasa punya database sebagai domain data store, Camunda punya database sebagai **process engine data structure**.

Ini berarti:

- `ACT_RU_EXECUTION` bukan tabel business process biasa; itu struktur execution tree.
- `ACT_RU_JOB` bukan queue biasa; itu job scheduling/locking table.
- `ACT_RU_TASK` bukan todo table biasa; itu wait state manusia.
- `ACT_RU_VARIABLE` bukan map biasa; itu scoped durable variable store.
- `ACT_HI_*` bukan audit trail lengkap legal; itu history projection engine.
- `ACT_GE_BYTEARRAY` bukan storage arbitrary file; itu tempat deployment resources, serialized variables, exception details, dan binary payload lain.

Prinsip pertama:

> Untuk diagnosis, database boleh dibaca. Untuk mutation, gunakan engine API kecuali ada emergency runbook yang sudah diuji dan disetujui.

Camunda sendiri mendokumentasikan bahwa database schema bukan public API dan bisa berubah pada minor/major update. Ini bukan detail kecil. Artinya operasi yang bergantung pada struktur internal tabel harus dianggap **internal coupling** dan wajib punya test/regression plan.

---

## 2. Kategori Data: Apa yang Bertahan, Apa yang Hilang, Apa yang Meledak

### 2.1 Runtime Data (`ACT_RU_*`)

Runtime data adalah state aktif.

Contoh:

- running execution,
- open task,
- active variable,
- pending job,
- external task,
- event subscription,
- incident,
- runtime metrics.

Runtime data biasanya hilang ketika instance selesai atau entity tidak lagi aktif.

Namun “biasanya” bukan berarti semua storage otomatis turun. Row runtime bisa hilang, tetapi:

- history row tetap ada,
- binary data bisa tertinggal sampai cleanup terkait berjalan,
- DB segment/table file belum tentu mengecil,
- index bloat bisa tetap ada,
- undo/redo/archive log mungkin sudah terlanjur besar.

### 2.2 Repository Data (`ACT_RE_*`)

Repository data adalah deployment artifact dan definition metadata.

Contoh:

- process definition,
- decision definition,
- case definition,
- deployment metadata,
- resource reference.

Deployment resource binary biasanya berada di `ACT_GE_BYTEARRAY`.

Repository data bisa membengkak kalau setiap build/deploy selalu deploy BPMN/DMN baru walaupun tidak berubah.

Smell:

```text
Every application restart creates a new process definition version.
```

Dampaknya:

- `ACT_RE_DEPLOYMENT` bertambah terus,
- `ACT_RE_PROCDEF` bertambah terus,
- `ACT_GE_BYTEARRAY` menyimpan duplicate BPMN/DMN/form resource,
- deployment cache dan operator UI makin berat,
- process start by key makin punya banyak version history.

### 2.3 History Data (`ACT_HI_*`)

History data adalah audit/projection dari execution.

Contoh:

- historic process instance,
- historic activity instance,
- historic task instance,
- historic variable instance,
- historic detail,
- historic incident,
- historic job log,
- historic decision instance,
- historic external task log.

History data adalah sumber growth paling umum pada sistem Camunda yang dipakai intensif.

Volume history dipengaruhi oleh:

- `historyLevel`,
- jumlah process instance,
- jumlah activity per instance,
- jumlah variable update,
- variable size,
- jumlah user task lifecycle event,
- job failure/retry,
- incident,
- DMN evaluation,
- external task log,
- batch operation.

### 2.4 General Binary Data (`ACT_GE_BYTEARRAY`)

`ACT_GE_BYTEARRAY` sering mengejutkan engineer karena ukurannya bisa besar.

Ia bisa menyimpan:

- deployment resource,
- BPMN XML,
- DMN XML,
- form resource,
- serialized Java object variable,
- serialized JSON/XML object value,
- byte array variable,
- file variable,
- exception stacktrace/details,
- historic variable binary payload.

Kalau desain variable buruk, `ACT_GE_BYTEARRAY` menjadi storage bom.

Contoh anti-pattern:

```text
Variable name: applicationPayload
Type: JSON/Object
Size: 1.8 MB
Updated: 12 times per process instance
Instances/day: 20,000
History level: FULL
```

Storage estimate kasar:

```text
1.8 MB x 12 x 20,000 = 432,000 MB/day ~= 432 GB/day raw payload
```

Belum termasuk index, LOB overhead, redo/undo, replication, backup, dan history detail.

---

## 3. Jangan Salah Mengartikan “Delete” dan “Free Space”

Salah satu kesalahpahaman umum:

> “Saya sudah delete 1 juta row, kenapa disk masih penuh?”

Jawabannya: karena delete row tidak selalu mengembalikan file/tablespace ke OS.

Secara umum:

- Delete menghapus row secara logical.
- Space bisa menjadi reusable di dalam table/segment.
- File database belum tentu mengecil.
- High water mark bisa tetap tinggi.
- Index bloat bisa tetap ada.
- LOB segment bisa butuh treatment khusus.
- MVCC database seperti PostgreSQL perlu vacuum untuk reclaim reusable space.
- Oracle bisa butuh shrink/move/rebuild untuk segment tertentu.
- MySQL/InnoDB bisa butuh optimize/rebuild tergantung table/file-per-table setup.

Camunda implication:

```text
History cleanup berhasil
        !=
Storage langsung turun di cloud console
```

Ukuran file bisa tetap sama, tetapi database mungkin dapat memakai ulang free space internal untuk insert berikutnya.

Jadi metrik yang perlu dipisahkan:

| Pertanyaan | Metrik |
|---|---|
| Apakah data logical sudah hilang? | row count per table |
| Apakah space internal reusable? | free space inside segment/table/tablespace |
| Apakah file fisik mengecil? | datafile/table file size |
| Apakah query membaik? | plan, buffer reads, latency, bloat/index health |
| Apakah backup mengecil? | backup size after maintenance/vacuum/full/shrink |

---

## 4. History Cleanup: Konsep Inti

History cleanup adalah mekanisme bawaan Camunda untuk menghapus historic data berdasarkan konfigurasi TTL.

Yang bisa dibersihkan mencakup historic process instances dan data terkait, historic decision instances dan data terkait, historic case instances tertentu, serta historic batches dan data terkait.

Mental model:

```text
Process/Decision/Batch definition has TTL
        |
        v
Finished/evaluated historic data gets end/removal time
        |
        v
History cleanup job runs during cleanup window
        |
        v
Deletes cleanable history in batches
```

History cleanup bukan magic. Ia butuh:

1. history data yang eligible,
2. TTL yang benar,
3. removal time/end time strategy yang benar,
4. job executor aktif,
5. cleanup window jika ingin otomatis,
6. batch size/parallelism yang cocok,
7. tidak ada stuck failed cleanup job,
8. DB mampu menjalankan delete workload.

---

## 5. TTL: Retention Policy Dalam Bahasa Engine

TTL adalah time-to-live untuk history data.

Contoh konsep:

```text
Process Definition: EnforcementCaseProcess
TTL: P10Y
Reason: legal retention 10 years

Process Definition: TemporaryReviewWorkflow
TTL: P90D
Reason: operational trace only
```

TTL harus datang dari policy, bukan dari feeling engineer.

Pertanyaan yang harus dijawab:

- Apakah ini data regulatory/legal?
- Apakah ada requirement statutory retention?
- Apakah data mengandung PII?
- Apakah retention berbeda per process type?
- Apakah retention berbeda per tenant/agency?
- Apakah deletion harus hard delete atau archive dulu?
- Apakah ada legal hold?
- Apakah audit lengkap disimpan di sistem lain?
- Apakah historic Camunda data diperlukan untuk reporting?

### 5.1 TTL Bukan Pengganti Archive

TTL menghapus data history engine. Ia bukan archive.

Kalau organisasi butuh menyimpan bukti 10 tahun, jangan berharap `ACT_HI_*` menjadi satu-satunya source of truth legal.

Pattern lebih sehat:

```text
Camunda History
   = technical process trace

Domain Audit Table
   = business/legal decision trace

Evidence Store
   = document/evidence immutable storage

Archive Store
   = long-term low-cost retention/search
```

Camunda history boleh mendukung audit, tetapi legal defensibility biasanya butuh domain audit yang lebih eksplisit.

---

## 6. Removal-Time-Based vs End-Time-Based Cleanup

Camunda menyediakan dua strategy besar:

1. `removalTimeBased`
2. `endTimeBased`

### 6.1 Removal-Time-Based

Removal time dihitung dan dipersist di history rows.

Konsep:

```text
removal time = base time + TTL
```

Base time bisa start atau end untuk process instance, tergantung konfigurasi.

Kelebihan:

- lebih efisien,
- delete bisa memakai `REMOVAL_TIME_ < now`,
- hierarchy bisa dibersihkan konsisten,
- lebih cocok untuk volume besar.

Keterbatasan:

- hanya bisa menghapus data yang punya removal time,
- data lama sebelum fitur/versi tertentu mungkin belum punya removal time,
- perubahan TTL tidak otomatis mengubah removal time data lama,
- case instance punya keterbatasan dalam konsep removal time.

### 6.2 End-Time-Based

End-time-based menghitung eligibility saat cleanup berjalan.

Kelebihan:

- perubahan TTL bisa memengaruhi data lama,
- bisa membersihkan data dari versi lama.

Kekurangan:

- lebih berat,
- perlu fetch cleanable instances dari table utama,
- delete terkait bisa melibatkan join,
- hierarchy bisa terhapus parsial,
- lebih rawan heavy workload.

### 6.3 Rekomendasi Praktis

Untuk sistem besar, default mental model:

```text
Use removalTimeBased for normal production cleanup.
Use endTimeBased only when there is a clear legacy/backfill reason.
```

Namun keputusan final harus diuji di staging dengan data volume realistis.

---

## 7. `historyRemovalTimeStrategy`: Start vs End

`historyRemovalTimeStrategy` menentukan base time untuk removal time.

Pilihan umum:

- `start`
- `end`
- `none`

### 7.1 Strategy `end`

Ini biasanya paling aman.

```text
removal time = process end time + TTL
```

Artinya history tidak dibersihkan sebelum process selesai.

Cocok untuk:

- long-running process,
- human workflow,
- regulatory case,
- process yang bisa hidup bulan/tahun,
- process yang butuh Cockpit history saat masih aktif.

### 7.2 Strategy `start`

```text
removal time = process start time + TTL
```

Ini lebih efisien saat populate history, tetapi berbahaya untuk process yang berjalan lama.

Risiko:

```text
Process started January 1
TTL 90 days
Process still running after 120 days
Cleanup may remove historic data while process still active
```

Untuk regulatory/human workflow, ini biasanya tidak ideal kecuali TTL sangat panjang dan behavior-nya benar-benar dipahami.

---

## 8. Cleanup Window: Jangan Bersihkan Saat Jam Sibuk

History cleanup dijalankan oleh job executor. Itu berarti ia bersaing dengan:

- timer job,
- async continuation,
- batch job,
- failed job retry,
- internal engine job lain.

Cleanup window adalah rentang waktu kapan cleanup boleh berjalan.

Contoh XML:

```xml
<property name="historyCleanupBatchWindowStartTime">20:00</property>
<property name="historyCleanupBatchWindowEndTime">06:00</property>
```

Spring Boot conceptual config:

```yaml
camunda:
  bpm:
    generic-properties:
      properties:
        historyCleanupBatchWindowStartTime: "20:00"
        historyCleanupBatchWindowEndTime: "06:00"
```

Prinsip:

- Jalankan cleanup saat load rendah.
- Jangan jalankan mass cleanup saat peak task completion/message correlation.
- Monitor job executor queue saat cleanup berjalan.
- Monitor DB locks, redo/undo, CPU, IO, replication lag.
- Jangan samakan cleanup window semua environment tanpa melihat workload.

---

## 9. Batch Size dan Degree of Parallelism

### 9.1 Batch Size

Batch size menentukan berapa instance dibersihkan dalam satu transaction.

Default dan maksimum di dokumentasi Camunda 7.24 adalah 500. Kalau cleanup transaction timeout, batch size bisa diturunkan.

Contoh:

```xml
<property name="historyCleanupBatchSize">100</property>
```

Trade-off:

| Batch Size | Kelebihan | Risiko |
|---|---|---|
| Besar | Lebih cepat secara total | Long transaction, lock lebih lama, undo/redo tinggi, timeout |
| Kecil | Lebih aman, transaksi pendek | Cleanup butuh lebih banyak transaction, overhead job lebih banyak |

### 9.2 Degree of Parallelism

Parallelism menentukan berapa cleanup job bisa berjalan paralel.

Kelebihan:

- cleanup lebih cepat,
- bisa mengejar backlog besar.

Risiko:

- memakai job executor thread,
- memakai DB connection,
- meningkatkan IO/delete pressure,
- bisa mengganggu timer/async job,
- bisa memperberat replication/backup.

Rule praktis:

```text
Start conservative.
Measure.
Increase only if DB has headroom.
```

---

## 10. Clustered Cleanup

Dalam cluster Camunda, beberapa node bisa berpartisipasi menjalankan cleanup.

Pertanyaan desain:

- Apakah semua node boleh menjalankan cleanup?
- Apakah hanya backend/maintenance node yang menjalankan cleanup?
- Apakah node frontend/tasklist harus dikecualikan?
- Apakah cleanup config konsisten antar node?
- Apakah job executor node cukup punya DB pool?

Contoh exclude node:

```xml
<property name="historyCleanupEnabled">false</property>
```

Pattern enterprise:

```text
User/API nodes:
  - handle user traffic
  - job executor limited/off for some workloads
  - cleanup disabled

Worker/engine nodes:
  - execute async/timer jobs
  - cleanup enabled within window

Maintenance node:
  - dedicated cleanup/batch operations
  - scaled during maintenance window
```

Namun jangan overcomplicate jika workload kecil. Complexity juga biaya.

---

## 11. Backlog Cleanup: Jangan Langsung Tekan Tombol Besar

Kasus umum:

```text
Camunda sudah jalan 3 tahun.
TTL baru dikonfigurasi sekarang.
History table sudah ratusan juta row.
DB storage mendekati limit.
```

Langkah yang salah:

```sql
DELETE FROM ACT_HI_PROCINST WHERE END_TIME_ < ...;
```

Masalah:

- child history rows tertinggal,
- binary rows bisa orphan/atau salah hapus,
- history relationship tidak lengkap,
- long transaction,
- lock/undo/redo meledak,
- backup/replication terganggu,
- engine/Cockpit bisa error.

Langkah yang lebih aman:

1. Inventory table sizes.
2. Inventory row counts by table and date.
3. Tentukan retention policy resmi.
4. Set TTL pada process/decision/batch definitions.
5. Pilih cleanup strategy.
6. Backfill removal time jika diperlukan via supported batch operation/API.
7. Jalankan cleanup dengan batch kecil.
8. Monitor DB health.
9. Naikkan batch/parallelism bertahap.
10. Setelah logical cleanup, rencanakan physical reclaim jika memang perlu.

---

## 12. Table Growth Diagnostic

Gunakan pertanyaan sistematis.

### 12.1 Table Mana yang Besar?

Kategori:

```text
ACT_HI_*          -> history volume
ACT_GE_BYTEARRAY  -> binary payload/deployment/serialized values
ACT_RU_JOB        -> job backlog/failure/delay
ACT_RU_EXT_TASK   -> external task backlog
ACT_RU_VARIABLE   -> active variable payload volume
ACT_RU_TASK       -> open task backlog
ACT_RE_*          -> deployment/version accumulation
ACT_RU_METER_LOG  -> metrics retention
ACT_RU_TASK_METER_LOG -> task assignment metrics
```

### 12.2 Growth Karena Apa?

| Gejala | Kemungkinan Penyebab |
|---|---|
| `ACT_HI_DETAIL` besar | history level FULL + variable update tinggi |
| `ACT_HI_VARINST` besar | banyak variable atau payload besar |
| `ACT_HI_ACTINST` besar | model banyak activity + instance volume tinggi |
| `ACT_HI_JOB_LOG` besar | banyak retry/failure/job event |
| `ACT_GE_BYTEARRAY` besar | serialized/file variable, deployment duplicate, exception detail |
| `ACT_RE_PROCDEF` banyak | auto-deploy setiap restart/release |
| `ACT_RU_JOB` banyak | job executor tidak jalan, lock issue, retry backlog, due date spike |
| `ACT_RU_EVENT_SUBSCR` banyak | process menunggu message/signal/conditional event |
| `ACT_RU_TASK` banyak | human backlog, SLA/process bottleneck |

---

## 13. SQL Diagnostic Patterns

> Catatan: SQL berikut bersifat diagnostic read-only. Sesuaikan syntax per database vendor.

### 13.1 Row Count Per Table

PostgreSQL approximate:

```sql
select relname as table_name,
       n_live_tup as estimated_rows,
       n_dead_tup as estimated_dead_rows
from pg_stat_user_tables
where relname like 'act\_%'
order by n_live_tup desc;
```

Oracle approximate via stats:

```sql
select table_name, num_rows, blocks, last_analyzed
from user_tables
where table_name like 'ACT\_%' escape '\'
order by num_rows desc;
```

MySQL:

```sql
select table_name, table_rows, data_length, index_length
from information_schema.tables
where table_schema = database()
  and table_name like 'ACT\_%'
order by data_length + index_length desc;
```

### 13.2 Largest Objects

PostgreSQL:

```sql
select relname,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       pg_size_pretty(pg_relation_size(relid)) as table_size,
       pg_size_pretty(pg_indexes_size(relid)) as index_size
from pg_catalog.pg_statio_user_tables
where relname like 'act\_%'
order by pg_total_relation_size(relid) desc;
```

Oracle:

```sql
select segment_name,
       segment_type,
       round(bytes / 1024 / 1024, 2) as mb
from user_segments
where segment_name like 'ACT\_%' escape '\'
order by bytes desc;
```

### 13.3 History Volume by End Date

```sql
select trunc(end_time_) as end_day,
       count(*) as instances
from act_hi_procinst
where end_time_ is not null
 group by trunc(end_time_)
order by end_day;
```

PostgreSQL variant:

```sql
select date_trunc('day', end_time_) as end_day,
       count(*) as instances
from act_hi_procinst
where end_time_ is not null
 group by date_trunc('day', end_time_)
order by end_day;
```

### 13.4 Removal Time Readiness

```sql
select count(*) as total,
       sum(case when removal_time_ is null then 1 else 0 end) as missing_removal_time,
       min(removal_time_) as min_removal_time,
       max(removal_time_) as max_removal_time
from act_hi_procinst;
```

Check cleanable candidates:

```sql
select count(*)
from act_hi_procinst
where removal_time_ is not null
  and removal_time_ < current_timestamp;
```

### 13.5 Byte Array Growth

```sql
select name_, deployment_id_, generated_, count(*)
from act_ge_bytearray
 group by name_, deployment_id_, generated_
order by count(*) desc;
```

Large byte arrays are vendor-specific because payload may be BLOB/BYTEA/LOB.

General grouping by deployment:

```sql
select deployment_id_, count(*) as rows
from act_ge_bytearray
 group by deployment_id_
order by rows desc;
```

### 13.6 Job Backlog

```sql
select handler_type_, retries_, count(*)
from act_ru_job
 group by handler_type_, retries_
order by count(*) desc;
```

Due jobs:

```sql
select count(*)
from act_ru_job
where (duedate_ is null or duedate_ <= current_timestamp)
  and (lock_exp_time_ is null or lock_exp_time_ < current_timestamp)
  and retries_ > 0;
```

Failed jobs:

```sql
select handler_type_, exception_msg_, count(*)
from act_ru_job
where retries_ = 0
 group by handler_type_, exception_msg_
order by count(*) desc;
```

### 13.7 Open Task Backlog

```sql
select task_def_key_, assignee_, count(*)
from act_ru_task
 group by task_def_key_, assignee_
order by count(*) desc;
```

By process definition:

```sql
select proc_def_id_, count(*)
from act_ru_task
 group by proc_def_id_
order by count(*) desc;
```

---

## 14. Indexing Strategy: Index Untuk Workload, Bukan Untuk Semua Kolom

Camunda ships with indexes appropriate for generic engine use. Tetapi workload enterprise bisa punya query pattern tambahan.

Indexing harus menjawab:

- Query mana yang lambat?
- Berapa frekuensinya?
- Berapa cardinality kolomnya?
- Apakah query runtime atau history?
- Apakah query berasal dari engine internal, Tasklist/Cockpit, atau custom API/report?
- Apakah index akan memperberat write path?
- Apakah index akan memperbesar storage/backup?
- Apakah index aman pada upgrade?

### 14.1 Jangan Tambah Index Karena Feeling

Anti-pattern:

```text
Task query lambat.
Tambahkan index ke semua kolom ACT_RU_TASK.
```

Dampak:

- insert/update/delete makin mahal,
- index maintenance tinggi,
- storage membengkak,
- optimizer bisa memilih plan buruk,
- migration/upgrade script perlu awareness,
- DB write amplification meningkat.

### 14.2 Kandidat Index Umum

Tergantung workload, kandidat custom index sering muncul pada:

- `ACT_RU_TASK` untuk work queue,
- `ACT_HI_TASKINST` untuk history task search,
- `ACT_HI_PROCINST` untuk business key/date/status report,
- `ACT_RU_VARIABLE` atau `ACT_HI_VARINST` untuk variable search,
- `ACT_RU_JOB` untuk acquisition tuning,
- `ACT_HI_ACTINST` untuk timeline/report.

Namun variable-based index harus sangat hati-hati.

Kenapa?

Karena variable table memakai polymorphic value columns:

```text
TEXT_
TEXT2_
LONG_
DOUBLE_
BYTEARRAY_ID_
```

Query variable sering butuh join dan filter by name/type/value. Jika dijadikan search utama untuk aplikasi, Camunda DB akan menjadi query engine domain yang buruk.

Pattern lebih sehat:

```text
Process variable:
  customerId = "C-123"
  riskLevel = "HIGH"

Domain projection table:
  case_id
  customer_id
  status
  current_task
  assignee
  sla_due_at
  risk_level
  updated_at
```

Frontend/search/reporting memakai projection, bukan raw variable query.

---

## 15. Query Plan Discipline

Sebelum index:

1. Capture slow query.
2. Capture bind values.
3. Run `EXPLAIN`/`EXPLAIN ANALYZE` pada staging dengan data realistis.
4. Cek cardinality dan selectivity.
5. Tambahkan index minimal.
6. Ukur read improvement.
7. Ukur write regression.
8. Uji cleanup/delete impact.
9. Dokumentasikan alasan index.

Contoh documentation entry:

```text
Index: IDX_CUSTOM_HI_PROCINST_BUSKEY_END
Table: ACT_HI_PROCINST
Columns: BUSINESS_KEY_, END_TIME_
Reason: case search API queries historic instances by business key prefix and date range.
Observed before: 8.2s p95, sequential scan 24M rows.
Observed after: 180ms p95.
Write impact: negligible in staging load test.
Owner: workflow-platform-team.
Review date: 2027-01-01.
```

---

## 16. Archival: Cleanup Bukan Satu-satunya Jawaban

History cleanup menghapus. Archival menyimpan di tempat lain.

Regulatory platform sering butuh:

- operational data di Camunda DB,
- archive data di object storage/data lake,
- domain audit di immutable/auditable store,
- reporting projection di OLAP/search engine,
- legal hold mechanism.

### 16.1 Basic Archive Flow

```text
Camunda History / Domain Audit
        |
        | extract before removal time
        v
Archive Package
        |
        +-- process summary
        +-- task timeline
        +-- decision summary
        +-- variable snapshot allowlist
        +-- evidence reference
        +-- actor/action audit
        +-- checksum/manifest
        v
Object Storage / Archive DB / Data Lake
        |
        v
Cleanup Camunda history after retention/verification
```

### 16.2 Archive Contract

Jangan archive semua variable mentah tanpa policy.

Archive contract harus menentukan:

- field mana yang diarsip,
- PII classification,
- retention duration,
- encryption,
- access role,
- audit access log,
- deletion policy,
- legal hold,
- checksum/integrity,
- schema version.

### 16.3 Archive Before Cleanup

Untuk compliance, jangan cleanup dulu lalu baru sadar reporting/audit hilang.

Runbook:

1. Identify instances eligible for archive.
2. Extract domain audit and selected Camunda history.
3. Validate archive completeness.
4. Generate manifest/checksum.
5. Mark archive status in domain DB.
6. Allow Camunda history cleanup.
7. Verify logical cleanup.
8. Periodically test archive retrieval.

---

## 17. Partitioning: Powerful, Tapi Bukan Default Jawaban

Partitioning bisa membantu untuk large history table, terutama jika cleanup berbasis date/removal time.

Tetapi partitioning Camunda table adalah advanced DB operation.

Risiko:

- engine-generated SQL mungkin tidak partition-friendly,
- indexes harus disesuaikan,
- foreign key/constraint behavior vendor-specific,
- upgrade script bisa terdampak,
- DB migration lebih kompleks,
- backup/restore lebih kompleks,
- DBA/operator skill required.

### 17.1 Candidate Tables

Partitioning biasanya lebih masuk akal pada history-heavy tables:

- `ACT_HI_PROCINST`,
- `ACT_HI_ACTINST`,
- `ACT_HI_TASKINST`,
- `ACT_HI_VARINST`,
- `ACT_HI_DETAIL`,
- `ACT_HI_JOB_LOG`,
- `ACT_HI_EXT_TASK_LOG`,
- `ACT_HI_DECINST`,
- `ACT_HI_DEC_IN`,
- `ACT_HI_DEC_OUT`.

Partition key yang sering dipikirkan:

- `REMOVAL_TIME_`,
- `END_TIME_`,
- tenant id,
- process definition key,
- created/end date.

Untuk cleanup, `REMOVAL_TIME_` sering natural jika strategy removal-time-based dipakai.

### 17.2 Partitioning by Tenant

Tenant partitioning menggoda, tapi hati-hati.

Pertanyaan:

- Apakah query mayoritas tenant-scoped?
- Apakah cleanup tenant-specific?
- Apakah tenant cardinality stabil?
- Apakah tenant jumlahnya ratusan/ribuan?
- Apakah cross-tenant ops/report tetap diperlukan?
- Apakah engine query selalu membawa tenant condition?

Jika tenant banyak dan dinamis, partition per tenant bisa menjadi maintenance nightmare.

### 17.3 Partition Drop vs Delete

Keuntungan besar partitioning adalah bisa melakukan:

```text
DROP/TRUNCATE old partition
```

alih-alih delete row-by-row.

Namun untuk Camunda, jangan drop partition tanpa memastikan:

- semua data di partition eligible sesuai retention,
- tidak ada running process/history yang masih diperlukan,
- hierarchy/call activity cleanup konsisten,
- archive sudah diverifikasi,
- table relation/implicit relation tidak rusak,
- support/DBA menyetujui.

---

## 18. Vacuum, Shrink, Rebuild, Reclaim: Vendor-Specific Reality

### 18.1 PostgreSQL

PostgreSQL memakai MVCC. Delete menghasilkan dead tuples. Vacuum diperlukan agar space reusable.

Operational concerns:

- autovacuum harus sehat,
- table bloat harus dimonitor,
- long-running transaction bisa menahan vacuum,
- large delete bisa membuat bloat sementara besar,
- `VACUUM FULL` mengecilkan file tapi butuh exclusive lock,
- `REINDEX` bisa diperlukan untuk index bloat.

PostgreSQL cleanup runbook:

```text
1. Run cleanup in manageable batches.
2. Monitor n_dead_tup and autovacuum activity.
3. Avoid long-running transactions.
4. Consider manual VACUUM ANALYZE after large cleanup.
5. Use VACUUM FULL only in maintenance window if physical shrink required.
6. Consider partitioning for future large retention windows.
```

### 18.2 Oracle

Oracle delete membuat space reusable di segment/tablespace, tetapi datafile tidak otomatis mengecil.

Operational concerns:

- HWM/high water mark,
- LOB segment growth,
- undo tablespace,
- redo/archive log,
- index fragmentation,
- shrink space prerequisites,
- move/rebuild index,
- tablespace/datafile resize.

Oracle cleanup runbook:

```text
1. Let Camunda cleanup delete logically.
2. Check segment sizes and free space.
3. Check LOB segments for ACT_GE_BYTEARRAY/history payload tables.
4. Rebuild indexes only if justified.
5. Shrink/move segments in approved maintenance window.
6. Resize datafile only when free space physically reclaimable.
```

### 18.3 MySQL/InnoDB

InnoDB delete does not always shrink tablespace. Behavior depends on file-per-table and optimize/rebuild.

Operational concerns:

- purge thread,
- undo log,
- buffer pool pressure,
- online DDL behavior,
- replication lag,
- `OPTIMIZE TABLE` locking/copy behavior depending version/config,
- redo log pressure.

### 18.4 SQL Server

SQL Server concerns:

- transaction log growth,
- index fragmentation,
- statistics update,
- lock escalation,
- database shrink anti-pattern,
- maintenance plan scheduling.

SQL Server runbook should coordinate with DBA because aggressive shrink can cause fragmentation and performance regression.

---

## 19. Maintenance Window Design

Maintenance window bukan hanya “jam sepi”. Ia adalah controlled operational change.

### 19.1 Window Checklist

Sebelum window:

- Confirm objective: cleanup, archive, index, shrink, upgrade, rebuild?
- Confirm rollback plan.
- Confirm backup/snapshot.
- Confirm current DB health.
- Confirm active process volume.
- Confirm job executor state.
- Confirm no heavy business batch overlaps.
- Confirm monitoring/dashboard ready.
- Confirm communication to users/operators.

Saat window:

- Reduce incoming traffic if needed.
- Pause non-critical job/external workers if needed.
- Run cleanup/batch in controlled size.
- Monitor DB CPU, IO, locks, log growth, replication lag.
- Monitor Camunda incidents/job backlog.
- Record exact commands/config used.

Setelah window:

- Validate row count changes.
- Validate engine works: start process, complete task, execute async job, correlate message.
- Validate Cockpit/Tasklist/API critical paths.
- Validate no unexpected incidents.
- Validate storage/free space expected behavior.
- Document result.

### 19.2 Maintenance Should Have Exit Criteria

Bad:

```text
Run cleanup until done.
```

Good:

```text
Run cleanup for max 2 hours or until DB CPU > 70% sustained or replication lag > 5 minutes or job backlog increases beyond threshold.
```

Exit criteria examples:

- max duration reached,
- DB CPU/IO threshold exceeded,
- lock wait threshold exceeded,
- error rate increases,
- job executor backlog increases,
- business SLA risk detected,
- cleanup progress too slow to justify risk.

---

## 20. Runtime Table Safety: Apa yang Tidak Boleh Diutak-atik

### 20.1 Jangan Manual Delete Runtime State

Hindari:

```sql
delete from act_ru_execution where ...;
delete from act_ru_task where ...;
delete from act_ru_job where ...;
update act_ru_execution set act_id_ = ...;
update act_ru_job set retries_ = ...;
```

Gunakan API:

- `RuntimeService` untuk process instance modification/cancel/suspend,
- `TaskService` untuk task claim/complete/delete task comments/attachments,
- `ManagementService` untuk job retries/execute job,
- `ExternalTaskService` untuk external task retry/unlock,
- `HistoryService` untuk cleanup/restart/migration related operations,
- REST API jika remote.

### 20.2 Emergency Manual DB Operation

Manual DB operation hanya boleh dipertimbangkan jika:

- ada incident kritis,
- engine API tidak bisa dipakai,
- vendor/support/SME menyetujui,
- backup tersedia,
- script diuji di clone DB,
- relation dan side effect dipahami,
- ada rollback plan,
- dilakukan dalam maintenance window.

Default answer untuk production:

```text
No direct mutation of ACT_* tables.
```

---

## 21. Deployment Cleanup

Deployment accumulation bisa menjadi masalah.

Pertanyaan:

- Apakah setiap restart melakukan auto deployment?
- Apakah resource duplicate?
- Apakah old versions masih punya running instances?
- Apakah process start by key masih perlu old versions?
- Apakah old deployments punya historic data yang perlu dipertahankan?
- Apakah deletion cascade akan menghapus definitions/resources yang masih dibutuhkan?

Repository cleanup harus hati-hati.

Safer strategy:

1. Stop accidental redeployment.
2. Audit deployment versions.
3. Identify definitions with no running instances.
4. Confirm no migration/restart requirement.
5. Use RepositoryService deletion carefully.
6. Avoid manual `ACT_RE_*` delete.

Contoh conceptual Java:

```java
repositoryService.deleteDeployment(deploymentId, false); // no cascade
```

Cascade deletion bisa berdampak besar dan harus diuji.

---

## 22. Metrics and Task Metrics Retention

Camunda punya runtime metrics tables seperti:

- `ACT_RU_METER_LOG`,
- `ACT_RU_TASK_METER_LOG`.

Task metrics bisa tumbuh jika assignment sering terjadi.

Operational policy:

- Apakah metrics diperlukan untuk license/compliance/report?
- Berapa lama disimpan?
- Apakah harus diexport ke monitoring system?
- Apakah cleanup TTL dikonfigurasi?
- Apakah table ini masuk monitoring growth?

Jangan hanya fokus `ACT_HI_*`. Metrics table juga bisa menjadi growth source.

---

## 23. LOB/BLOB Policy

LOB/BLOB adalah sumber storage surprise.

### 23.1 Variable Payload Policy

Enterprise policy:

```text
Allowed as process variable:
  - IDs
  - status codes
  - timestamps
  - short strings
  - small JSON snapshots with schema version
  - simple routing facts

Not allowed as normal process variable:
  - full uploaded documents
  - large request/response payloads
  - binary files
  - large lists
  - unbounded JSON
  - serialized Java domain objects
  - secrets/tokens/passwords
```

### 23.2 Store Document Outside Engine

Better:

```text
Document Service / Object Storage
        |
        v
Camunda variable: documentId, documentVersion, checksum, classification
```

Instead of:

```text
Camunda file variable: 25 MB PDF
```

### 23.3 Exception Details

Failed jobs can store exception details. If retries repeatedly fail with huge stack traces or payload messages, history/job log can grow.

Practice:

- avoid dumping massive payload in exception message,
- use correlation id,
- store detailed error in application log/observability platform,
- keep engine exception message concise,
- avoid logging secrets.

---

## 24. Reporting: Jangan Paksa Camunda DB Jadi OLAP

Camunda DB didesain untuk engine operations, bukan heavy analytics.

Smell:

```text
Dashboard queries ACT_HI_* every 5 seconds with joins and variable filters.
```

Dampak:

- engine transaction lambat,
- job executor acquisition terganggu,
- DB CPU/IO tinggi,
- locks/statistics/cache pressure,
- user task operation ikut lambat.

Better architecture:

```text
Camunda Engine DB
        |
        | event/history extraction
        v
Projection / Reporting DB / Search Index / Data Lake
        |
        v
Dashboard / Analytics / Export
```

Projection bisa dibangun dari:

- domain events,
- task listener event to outbox,
- history event handler,
- CDC/Debezium read-only stream,
- scheduled ETL with low-impact queries,
- archive pipeline.

Namun kalau memakai CDC langsung dari `ACT_*`, ingat schema bukan public API. Harus ada compatibility test saat upgrade.

---

## 25. Backup, Restore, and Point-in-Time Recovery

Camunda DB restore bukan hanya DB restore. Ia memulihkan durable execution state.

Pertanyaan penting:

- Apa RPO/RTO Camunda DB?
- Apakah domain DB dan Camunda DB harus restored konsisten pada waktu yang sama?
- Bagaimana dengan external side effects yang sudah terjadi?
- Bagaimana dengan outbox/inbox consistency?
- Apakah workers akan reprocess jobs setelah restore?
- Apakah idempotency store ikut restored?
- Apakah message broker/event store posisinya konsisten?
- Apakah file/evidence store konsisten dengan process variables?

### 25.1 Restore Consistency Problem

Contoh:

```text
10:00 Camunda commits process state: payment requested
10:01 external payment executed
10:05 DB backup restore to 09:59
```

Setelah restore, process tampak belum request payment, tetapi payment sudah terjadi.

Mitigation:

- idempotency keys,
- external reconciliation,
- outbox/inbox pattern,
- domain audit independent,
- restore runbook with business reconciliation,
- do not blindly resume workers after restore without assessment.

---

## 26. DBA Collaboration Contract

Camunda engineer dan DBA harus punya bahasa bersama.

### 26.1 Yang Engineer Harus Jelaskan ke DBA

- Camunda DB stores runtime state.
- Direct mutation can corrupt engine state.
- Job executor uses DB locks/leases.
- History cleanup is delete workload via jobs.
- Some tables are write-hot.
- Some payloads are LOB-heavy.
- Runtime tables must stay low-latency.
- Maintenance has business workflow impact.

### 26.2 Yang DBA Harus Berikan ke Engineer

- top table/index size,
- growth trend,
- slow SQL,
- wait events/lock waits,
- deadlock reports,
- vacuum/autovacuum/undo/redo health,
- index fragmentation/bloat,
- tablespace free/reusable/physical size,
- backup size/time trend,
- replication lag,
- maintenance recommendation.

### 26.3 Shared Runbook Template

```text
Operation name:
Environment:
Date/time window:
Owner:
Approver:
Reason:
Tables affected:
Expected row count affected:
Expected storage impact:
Engine API or DB operation:
Pre-check SQL/API:
Execution steps:
Monitoring dashboard:
Abort criteria:
Rollback/recovery plan:
Post-check SQL/API:
Result:
Follow-up:
```

---

## 27. Production Checklist

### 27.1 Retention and Cleanup

- [ ] Every process definition has explicit TTL policy.
- [ ] Every decision definition has explicit TTL policy if history is enabled.
- [ ] Batch/job log TTL configured if needed.
- [ ] Metrics/task metrics retention reviewed.
- [ ] Cleanup window configured.
- [ ] Cleanup batch size tested.
- [ ] Cleanup parallelism tested.
- [ ] Cluster cleanup participation defined.
- [ ] Cleanup job failure monitored.
- [ ] Logical cleanup verified by row counts.

### 27.2 Storage

- [ ] Largest tables tracked.
- [ ] `ACT_GE_BYTEARRAY` growth tracked.
- [ ] LOB segments tracked.
- [ ] Index size tracked.
- [ ] Dead tuples/bloat tracked where relevant.
- [ ] Tablespace/free space monitored.
- [ ] Backup size/time monitored.

### 27.3 Query and Index

- [ ] Slow query logging enabled or available.
- [ ] Custom query endpoints reviewed.
- [ ] Variable search minimized.
- [ ] Custom indexes documented.
- [ ] Index impact tested on write workload.
- [ ] Statistics/analyze job maintained.

### 27.4 Operational Safety

- [ ] No direct mutation of runtime tables.
- [ ] Emergency DB runbook exists.
- [ ] Backup/restore tested.
- [ ] DB restore reconciliation defined.
- [ ] Maintenance windows documented.
- [ ] DBA escalation path defined.

### 27.5 Architecture

- [ ] Reporting separated from operational Camunda DB.
- [ ] Archive strategy defined.
- [ ] Domain audit separated from Camunda history.
- [ ] Large payloads stored outside engine.
- [ ] Projection/read model used for work queue/search if needed.

---

## 28. Failure Playbooks

### 28.1 Storage Almost Full

Do not immediately delete random rows.

Steps:

1. Identify top segments/tables/indexes.
2. Identify whether growth is runtime, history, bytearray, repository, metrics, or app tables.
3. Check cleanable history count.
4. Check cleanup window/job status.
5. Check `ACT_GE_BYTEARRAY` source.
6. Reduce incoming growth if possible.
7. Run supported cleanup with conservative batch.
8. Increase storage if risk is immediate.
9. Plan physical reclaim later.
10. Fix root cause: TTL, payload, deployment, reporting, failed jobs.

### 28.2 Cleanup Not Running

Check:

- job executor active?
- cleanup window configured?
- current time inside window?
- cleanable data exists?
- TTL configured?
- removal time populated?
- cleanup job failed/retries exhausted?
- node excluded with `historyCleanupEnabled=false`?
- cluster config consistent?
- DB permissions okay?

### 28.3 Cleanup Running But No Space Freed

Possible causes:

- logical delete happened but physical file not shrunk,
- vacuum/shrink/rebuild not done,
- LOB segment not reclaimed,
- index bloat remains,
- deleted rows were small, payload elsewhere,
- archive/backup/log growth dominates,
- DB console shows allocated not used.

### 28.4 Query Suddenly Slow After Cleanup

Possible causes:

- stale statistics,
- index bloat,
- cache cold,
- cleanup competing for IO,
- vacuum/analyze needed,
- query plan changed,
- locks/waits during cleanup.

Mitigation:

- update statistics/analyze,
- check plan,
- reduce cleanup parallelism/batch,
- move cleanup window,
- rebuild index only when justified.

### 28.5 `ACT_GE_BYTEARRAY` Grows Too Fast

Check:

- deployments per day,
- duplicate BPMN/DMN resources,
- variable types with byte array id,
- file variables,
- object variables,
- historic detail/history level,
- exception detail rows,
- failed job stacktraces.

Mitigation:

- stop duplicate deployment,
- move large payload to external storage,
- use JSON snapshot small/allowlisted,
- reduce variable update frequency,
- tune history level carefully,
- configure cleanup/TTL,
- clean old deployments via API if safe.

---

## 29. Java 8–25 Operational Notes

Database operations are mostly engine/DB concerns, but Java version still matters indirectly.

### 29.1 JDBC Driver Compatibility

For Java upgrades:

- validate JDBC driver supports target Java,
- validate DB vendor version compatibility,
- validate TLS/cipher behavior,
- validate timezone/date behavior,
- validate connection pool behavior,
- validate driver default fetch size/batch behavior.

### 29.2 Connection Pool

Camunda cleanup and job executor consume DB connections.

If Spring Boot/HikariCP:

- job executor threads need connections,
- REST/API requests need connections,
- cleanup jobs need connections,
- external task completion/message correlation need connections,
- app domain transactions need connections if same datasource.

Sizing must consider peak concurrent engine commands.

### 29.3 GC and LOB Payload

Large variables/file payloads can cause:

- large byte arrays in heap,
- driver buffer pressure,
- serialization overhead,
- GC spikes,
- network transfer time,
- transaction duration increase.

Java 17/21/25 may improve runtime, but they do not fix bad payload design.

---

## 30. Regulatory Case Management Example

Misdesigned version:

```text
Process variable:
  fullCaseJson = 3 MB
  uploadedEvidencePdf = 12 MB
  allComments = big JSON array

History level:
  FULL

Reporting:
  dashboard queries ACT_HI_VARINST and ACT_HI_DETAIL

Cleanup:
  not configured
```

After 18 months:

- storage explosion,
- slow task list,
- slow history query,
- backup takes too long,
- cleanup risky because no retention policy,
- legal afraid to delete anything,
- DB upgrade window becomes impossible.

Better version:

```text
Domain DB:
  CASE table
  CASE_DECISION_AUDIT table
  CASE_EVIDENCE table
  CASE_TIMELINE_PROJECTION table

Object storage:
  evidence files
  generated letters
  archival package

Camunda variables:
  caseId
  caseType
  currentPhase
  riskLevel
  assignedUnit
  slaDueAt
  decisionId
  evidenceBundleId

Camunda history:
  technical process trace with TTL by process type

Reporting:
  projection/search index

Cleanup:
  removalTimeBased, end strategy, nightly window
```

This design keeps Camunda as process state engine, not document/archive/reporting database.

---

## 31. Anti-Patterns

### 31.1 “Camunda History Is Our Legal Archive”

Bad because:

- history structure is engine-oriented,
- schema is internal,
- data may be cleaned,
- variable payload may change shape,
- business decision semantics may be implicit,
- retention/legal hold difficult.

### 31.2 “Just Delete Old Rows”

Bad because:

- relations are implicit/complex,
- binary rows may break or remain,
- history consistency may break,
- Cockpit/API may show inconsistent state,
- upgrade may fail.

### 31.3 “Add Index to Fix Everything”

Bad because:

- write overhead rises,
- cleanup/delete overhead rises,
- storage rises,
- optimizer may not use it,
- root cause may be bad query architecture.

### 31.4 “Variable Search as Domain Search”

Bad because:

- variable tables are generic,
- query often joins and scans,
- type/value columns are polymorphic,
- large history makes it worse,
- domain projection is better.

### 31.5 “Cleanup During Peak Because We Need Space Now”

Bad because:

- cleanup competes with job executor,
- DB locks/IO increase,
- user operations slow,
- timer/async jobs delayed,
- incident risk rises.

If storage is urgently low, sometimes the correct immediate move is **increase storage first**, then clean safely.

---

## 32. Reference Config Snippets

### 32.1 XML Generic Engine Config

```xml
<property name="historyCleanupStrategy">removalTimeBased</property>
<property name="historyRemovalTimeStrategy">end</property>
<property name="historyCleanupBatchWindowStartTime">20:00</property>
<property name="historyCleanupBatchWindowEndTime">06:00</property>
<property name="historyCleanupBatchSize">100</property>
<property name="historyCleanupDegreeOfParallelism">1</property>
```

### 32.2 Spring Boot Generic Properties

```yaml
camunda:
  bpm:
    generic-properties:
      properties:
        historyCleanupStrategy: removalTimeBased
        historyRemovalTimeStrategy: end
        historyCleanupBatchWindowStartTime: "20:00"
        historyCleanupBatchWindowEndTime: "06:00"
        historyCleanupBatchSize: 100
        historyCleanupDegreeOfParallelism: 1
```

Verify exact property support for your Camunda Spring Boot starter version.

### 32.3 BPMN TTL Attribute Concept

In BPMN XML, process definitions can carry history TTL via Camunda extension attribute.

Conceptual example:

```xml
<bpmn:process id="enforcementCaseProcess"
              name="Enforcement Case Process"
              isExecutable="true"
              camunda:historyTimeToLive="P10Y">
  ...
</bpmn:process>
```

For real production, validate exact supported TTL notation in your Camunda version and modeler setup.

---

## 33. Top 1% Mental Model

A top-tier engineer does not ask only:

```text
How do I clean Camunda history?
```

They ask:

```text
What data categories does the engine produce?
Which data is runtime-critical?
Which data is legal evidence?
Which data is reporting convenience?
Which data has retention obligations?
Which cleanup mechanism is safe?
Which cleanup workload can DB absorb?
What is reusable space vs physical shrink?
What query/index strategy avoids write-path damage?
What archive exists before delete?
How do we prove the platform remains correct after maintenance?
```

Camunda database operations are not janitorial work. They are part of **workflow correctness**.

If you delete the wrong thing, you do not merely lose rows. You can lose:

- process continuity,
- audit trail,
- incident recoverability,
- legal evidence,
- operator trust,
- migration ability,
- and business defensibility.

---

## 34. Summary

Di bagian ini kita membangun operational model untuk database Camunda 7:

- Camunda DB adalah runtime organ, bukan data warehouse.
- Runtime, repository, history, binary, metrics, dan identity data punya lifecycle berbeda.
- History cleanup butuh TTL, strategy, cleanup window, batch size, job executor, dan DB capacity.
- Removal-time-based cleanup biasanya lebih efisien untuk volume besar.
- `historyRemovalTimeStrategy=end` lebih aman untuk long-running process.
- Delete tidak selalu mengurangi physical storage.
- Vacuum/shrink/rebuild adalah vendor-specific maintenance.
- Custom index harus berdasarkan query plan dan workload, bukan feeling.
- Reporting sebaiknya dipisah dari operational Camunda DB.
- Archive dan legal audit harus didesain eksplisit.
- Direct mutation terhadap `ACT_*` table adalah emergency-only, bukan normal ops.
- Maintenance window harus punya pre-check, abort criteria, post-check, dan rollback/recovery plan.

---

## 35. What Comes Next

Bagian berikutnya:

```text
learn-java-camunda-7-bpm-platform-engineering-part-027.md
```

Topik:

```text
Observability and Troubleshooting: Metrics, Logs, Cockpit, SQL Diagnostics, and Incident Forensics
```

Kita akan membahas bagaimana mengobservasi Camunda 7 secara serius:

- process KPIs,
- engine metrics,
- job executor metrics,
- external task metrics,
- SQL diagnostics,
- structured logging,
- correlation id,
- Cockpit forensic workflow,
- stuck process investigation,
- missing message correlation,
- optimistic locking storm,
- and production incident playbook.

---

## References

- Camunda 7.24 Manual — History Cleanup: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/history-cleanup/
- Camunda 7.24 Manual — History: https://docs.camunda.org/manual/7.24/user-guide/process-engine/history/
- Camunda 7.24 Manual — Database Schema: https://docs.camunda.org/manual/7.24/user-guide/process-engine/database/database-schema/
- Camunda 7 Best Practice — Performance tuning Camunda 7: https://docs.camunda.io/docs/8.7/components/best-practices/operations/performance-tuning-camunda-c7/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-025.md">⬅️ Part 025 — Performance Engineering: Throughput, Latency, Hot Tables, Query Patterns, and Load Testing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-027.md">Part 027 — Observability and Troubleshooting: Metrics, Logs, Cockpit, SQL Diagnostics, and Incident Forensics ➡️</a>
</div>
