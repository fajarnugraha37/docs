# Part 23 — Batch Transactions and Database Integration

Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
File: `23-batch-transactions-and-database-integration.md`  
Scope: Java 8–25, Java EE/Jakarta EE Batch, `javax.batch`/`jakarta.batch`, Jakarta Transactions/JTA, enterprise database integration

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami **transaction boundary** dalam Jakarta Batch, terutama pada chunk-oriented step.
2. Mendesain batch database workload yang aman terhadap:
   - rollback,
   - restart,
   - duplicate execution,
   - partial commit,
   - lock contention,
   - connection pool starvation,
   - undo/redo pressure,
   - long-running cursor failure.
3. Memilih strategi membaca data:
   - cursor,
   - paging,
   - keyset pagination,
   - snapshot table,
   - claim-and-process,
   - partitioned range scan.
4. Memilih strategi menulis data:
   - per-row update,
   - batch insert/update,
   - staging table,
   - merge/upsert,
   - outbox,
   - idempotent result table.
5. Memahami hubungan antara:
   - commit interval,
   - checkpoint,
   - transaction timeout,
   - DB lock lifetime,
   - memory footprint,
   - recovery cost.
6. Membuat desain batch yang **database-friendly**, **restartable**, **observable**, dan **regulatory-defensible**.

---

## 2. Problem yang Diselesaikan

Batch processing sering terlihat sederhana:

```java
for (Record r : records) {
    process(r);
    updateDatabase(r);
}
```

Tetapi di production, pertanyaan yang sebenarnya jauh lebih berat:

- Kalau proses mati di tengah, mulai dari mana?
- Kalau chunk sudah menulis sebagian data lalu gagal, apa yang terjadi?
- Kalau job di-restart, apakah data akan double update?
- Kalau reader memakai cursor panjang, apa yang terjadi saat transaksi commit?
- Kalau commit interval terlalu besar, apakah undo/redo membengkak?
- Kalau commit interval terlalu kecil, apakah throughput jatuh?
- Kalau batch mengambil lock terlalu lama, apakah aplikasi online terganggu?
- Kalau 10 partition berjalan paralel, apakah connection pool cukup?
- Kalau job berjalan saat deployment/rolling restart, apakah state database konsisten?
- Kalau audit diminta menjelaskan record mana yang diproses, gagal, skipped, retried, dan committed, apakah sistem punya bukti?

Di level top-tier engineering, batch database integration bukan soal “bisa baca dan tulis database”. Ini soal mendesain **state transition besar** dengan batas transaksi yang eksplisit, kecil, dapat dipulihkan, dan dapat diaudit.

---

## 3. Mental Model Utama

### 3.1 Batch adalah serangkaian transaksi kecil, bukan satu transaksi besar

Kesalahan umum: membayangkan batch sebagai satu atomic operation besar.

```text
BEGIN TRANSACTION
  process 10 million rows
COMMIT
```

Ini hampir selalu buruk untuk enterprise system karena:

- lock terlalu lama,
- undo/redo membengkak,
- rollback mahal,
- transaction timeout mudah terjadi,
- recovery tidak granular,
- online workload terganggu,
- observability buruk,
- restart harus mengulang terlalu banyak.

Jakarta Batch chunk model lebih tepat dipikirkan seperti ini:

```text
JobExecution
  StepExecution
    Chunk Transaction #1: read/process/write N items -> commit -> checkpoint
    Chunk Transaction #2: read/process/write N items -> commit -> checkpoint
    Chunk Transaction #3: read/process/write N items -> commit -> checkpoint
    ...
```

Setiap chunk adalah **failure containment unit**.

### 3.2 Commit interval adalah recovery granularity

`commit-interval` bukan hanya angka tuning performance. Ia menentukan:

- berapa banyak item ditulis per transaksi,
- seberapa lama lock ditahan,
- seberapa besar rollback scope,
- seberapa sering checkpoint diperbarui,
- berapa banyak item mungkin diulang setelah crash,
- seberapa besar memory buffer item,
- seberapa besar tekanan pada DB log/undo/redo.

Semakin besar commit interval:

```text
+ fewer commits
+ potentially higher throughput
- larger rollback scope
- longer lock lifetime
- larger memory buffer
- larger duplicate/replay window
- heavier DB undo/redo pressure
```

Semakin kecil commit interval:

```text
+ smaller rollback scope
+ faster restart/recovery
+ shorter lock lifetime
+ better operational visibility
- more commit overhead
- lower peak throughput if too small
- more checkpoint writes
```

### 3.3 Checkpoint bukan pengganti idempotency

Checkpoint menyimpan posisi/progress. Tetapi checkpoint tidak otomatis membuat writer aman.

Contoh failure:

```text
1. Writer mengirim update ke external table.
2. DB commit berhasil.
3. Runtime crash sebelum checkpoint repository selesai terlihat konsisten.
4. Job restart dari checkpoint lama.
5. Item yang sama diproses ulang.
```

Walaupun skenario detail bergantung implementasi runtime, prinsip desainnya tetap:

> Semua side effect penting harus aman terhadap pengulangan.

Maka writer perlu idempotency:

- unique business key,
- idempotency key,
- upsert/merge,
- process status table,
- outbox table,
- duplicate detection,
- version/checksum guard.

### 3.4 Database adalah shared resource, bukan private batch engine

Batch sering berjalan di database yang sama dengan online application. Maka batch harus sopan terhadap:

- OLTP latency,
- connection pool,
- lock wait,
- buffer cache,
- redo generation,
- replication lag,
- maintenance window,
- backup window,
- report workload,
- index contention.

Top-tier engineer tidak hanya bertanya:

> “Batch saya cepat atau tidak?”

Tetapi:

> “Batch saya cepat tanpa menghancurkan workload lain atau tidak?”

---

## 4. Jakarta Batch Transaction Semantics: Apa yang Harus Dipahami

Jakarta Batch mendefinisikan chunk-oriented processing sebagai pola utama: item dibaca satu per satu, diproses, dikumpulkan, ditulis sebagai chunk, lalu transaksi di-commit pada checkpoint/commit interval.

Secara konseptual:

```text
open reader/writer
repeat until no more item:
  begin transaction
    read item
    process item
    collect item
    ... until commit interval reached or end reached
    write collected items
    checkpoint reader/writer state
  commit transaction
close reader/writer
```

Sumber resmi Jakarta Batch menjelaskan bahwa chunk ditulis melalui `ItemWriter` dan transaksi di-commit setelah jumlah item yang dibaca mencapai commit interval. API `ItemReader` juga menyediakan `open(Serializable checkpoint)` dan `checkpointInfo()` agar reader dapat melanjutkan dari checkpoint pada restart.

### 4.1 Yang berada dalam transaksi chunk

Umumnya, dalam chunk step:

- item read/process/write terjadi dalam boundary transaksi step/chunk,
- write dilakukan untuk kumpulan item,
- checkpoint state dikaitkan dengan commit boundary,
- rollback mengulang chunk yang belum committed.

Namun detail berikut harus diperiksa pada runtime/server yang dipakai:

- apakah read dilakukan dalam transaksi yang sama dengan write,
- bagaimana cursor ditangani setelah commit,
- bagaimana checkpoint repository disimpan,
- bagaimana transaction timeout dikonfigurasi,
- apakah artifact CDI/EJB transactional interceptor ikut berlaku,
- bagaimana non-transactional resource seperti file/API dikoordinasikan.

### 4.2 Yang tidak otomatis aman

Jakarta Batch transaction boundary tidak otomatis membuat hal-hal berikut aman:

- HTTP call ke external system,
- file write,
- email sending,
- message publish non-transactional,
- cache mutation,
- update ke database lain tanpa XA,
- side effect di listener,
- logging audit yang tidak berada dalam transaksi yang tepat.

Untuk side effect non-transactional, desain harus eksplisit:

```text
Transactional DB write -> Outbox row -> separate dispatcher -> idempotent external call
```

Bukan:

```text
Inside chunk transaction -> call external API directly -> hope rollback fixes everything
```

---

## 5. Transaction Scope dalam Batch

### 5.1 Scope ideal: satu transaksi per chunk

Model paling umum:

```text
Chunk #101
  BEGIN TX
    read items 10001-10100
    process items
    write result rows
    update checkpoint
  COMMIT
```

Jika gagal sebelum commit:

```text
ROLLBACK chunk #101
Restart from previous checkpoint
```

Ini membuat failure bounded.

### 5.2 Scope buruk: satu transaksi per job

```text
BEGIN TX
  process millions of rows
COMMIT
```

Masalah:

- transaksi terlalu panjang,
- lock lifetime besar,
- rollback mahal,
- undo/redo besar,
- transaction timeout,
- database resource tertahan,
- sulit tahu progress durable,
- restart tidak granular.

### 5.3 Scope terlalu kecil: satu transaksi per item

```text
for each item:
  BEGIN TX
  process one item
  COMMIT
```

Bisa cocok jika:

- item sangat berat,
- side effect harus sangat granular,
- jumlah item tidak besar,
- consistency per item lebih penting daripada throughput.

Tetapi untuk batch besar, overhead commit bisa sangat mahal.

### 5.4 Scope campuran: chunk untuk hasil, separate transaction untuk audit/error

Kadang audit/error record harus tetap tersimpan walaupun chunk rollback.

Contoh:

```text
Chunk transaction:
  write valid processed result
  if item invalid:
     record item error?
```

Jika error record ditulis dalam transaksi chunk yang rollback, error hilang.

Alternatif desain:

1. Error ditulis dalam output error table setelah chunk berhasil.
2. Error dikumpulkan lalu ditulis oleh writer sebagai bagian hasil chunk.
3. Error audit ditulis dengan transaction baru, jika runtime mendukung dan benar-benar dibutuhkan.
4. Error didapat dari Batch runtime skip listener dan dimaterialisasi secara idempotent.

Hindari menyisipkan transaksi baru sembarangan karena bisa membuat audit tidak konsisten dengan hasil utama.

---

## 6. JTA, Local Transaction, dan XA: Kapan Relevan?

### 6.1 Jakarta Transactions/JTA

Jakarta Transactions menyediakan interface antara transaction manager, application server, resource manager, dan aplikasi transactional. Dalam Jakarta EE, ini adalah fondasi untuk transaksi container-managed.

Mental model:

```text
Application code
  -> Jakarta Transactions API
    -> Transaction Manager
      -> JDBC resource / JMS resource / XA resource
```

### 6.2 Single database: biasanya tidak butuh XA

Jika batch hanya menyentuh satu database utama:

```text
read source table
process
write target table
update checkpoint
commit
```

Local/JTA transaction terhadap satu resource biasanya cukup.

### 6.3 Multiple transactional resources: XA mungkin relevan, tapi mahal

Contoh:

```text
Database A update
Database B update
JMS publish
commit all atomically
```

XA/two-phase commit bisa memberi atomicity lintas resource, tetapi trade-off-nya:

- kompleksitas lebih tinggi,
- latency lebih tinggi,
- recovery lebih sulit,
- heuristic outcome risk,
- konfigurasi server lebih rumit,
- tidak semua resource mendukung XA dengan baik,
- troubleshooting lebih berat.

Untuk banyak sistem modern, alternatif yang sering lebih operasional:

```text
Local transaction + outbox + idempotent consumer + reconciliation
```

### 6.4 External API tidak bisa di-rollback oleh JTA

HTTP call ke external API bukan resource transactional standar.

Jika batch melakukan:

```text
BEGIN TX
  update database
  call external API
COMMIT
```

Lalu commit gagal setelah API sukses, kamu punya inconsistency.

Desain lebih aman:

```text
BEGIN TX
  write business state
  write outbox event with idempotency key
COMMIT

Outbox dispatcher:
  call external API idempotently
  mark event delivered
```

---

## 7. Commit Interval Tuning

### 7.1 Apa yang ditentukan commit interval

Misal:

```xml
<chunk item-count="100">
    <reader ref="reader"/>
    <processor ref="processor"/>
    <writer ref="writer"/>
</chunk>
```

Artinya runtime akan mencoba membentuk chunk sekitar 100 item sebelum writer dipanggil dan transaksi di-commit.

### 7.2 Faktor tuning

Pilih commit interval berdasarkan:

| Faktor | Jika tinggi/besar | Implikasi |
|---|---:|---|
| Item processing cost | tinggi | commit interval bisa lebih kecil agar recovery tidak mahal |
| Write cost per batch | tinggi | commit interval terlalu kecil menurunkan throughput |
| Row lock duration | tinggi | commit interval perlu dikurangi |
| Item payload memory | besar | commit interval perlu dikurangi |
| Duplicate replay tolerance | rendah | commit interval perlu dikurangi atau writer idempotent diperkuat |
| DB log/undo pressure | tinggi | commit interval perlu diuji, bukan ditebak |
| Error frequency | tinggi | commit interval terlalu besar membuat rollback sering mahal |
| SLA window | ketat | perlu benchmark kombinasi commit interval + partition count |

### 7.3 Formula kasar

Jika:

```text
itemProcessingTime = 20 ms
itemWriteCost amortized = 5 ms/item
commitOverhead = 100 ms/chunk
commitInterval = 100
```

Maka satu chunk kira-kira:

```text
100 * (20 + 5) ms + 100 ms = 2600 ms
```

Jika crash, potensi replay maksimum sekitar 100 item terakhir.

Jika commit interval menjadi 1000:

```text
1000 * 25 ms + 100 ms = 25100 ms
```

Throughput mungkin lebih baik karena commit overhead lebih kecil per item, tetapi:

- satu transaksi 25 detik,
- lock lebih lama,
- rollback lebih mahal,
- replay window lebih besar,
- transaction timeout risk naik.

### 7.4 Start point praktis

Untuk banyak DB batch enterprise:

```text
commit interval awal: 50–500 item
```

Kemudian benchmark berdasarkan:

- average chunk duration,
- p95/p99 chunk duration,
- lock wait,
- DB CPU,
- redo generation,
- undo usage,
- connection pool wait,
- item replay cost,
- error rate.

Jangan memilih `1000`, `5000`, atau `10000` hanya karena terlihat “lebih batch”.

---

## 8. Reader Strategy: Cursor, Paging, Keyset, Snapshot, Claim

Cara batch membaca data menentukan lock behavior, restartability, memory, dan consistency.

### 8.1 Cursor reader

Cursor reader membuka result set dan membaca baris bertahap.

```text
SELECT * FROM source WHERE status = 'PENDING' ORDER BY id
```

Kelebihan:

- natural untuk stream besar,
- memory rendah,
- sederhana.

Risiko:

- cursor panjang rentan timeout/network failure,
- commit bisa mempengaruhi cursor tergantung DB/driver/holdability,
- restart butuh posisi stabil,
- sulit jika dataset berubah selama job berjalan,
- bisa menahan resource DB lama.

Gunakan cursor jika:

- data relatif stabil,
- driver/server mendukung pola ini dengan baik,
- query order deterministic,
- fetch size disetel,
- checkpoint menyimpan key terakhir, bukan offset rapuh.

### 8.2 Offset paging

```sql
SELECT *
FROM source
WHERE status = 'PENDING'
ORDER BY id
OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY
```

Kelebihan:

- mudah dipahami,
- tidak menahan cursor panjang.

Masalah:

- offset besar makin mahal,
- data insert/delete di tengah bisa membuat skip/duplicate,
- restart dengan offset rapuh jika dataset berubah,
- database harus scan/sort lebih banyak.

Offset paging cocok untuk:

- dataset kecil/menengah,
- snapshot immutable,
- admin UI pagination,
- bukan batch besar yang berubah selama proses.

### 8.3 Keyset pagination

```sql
SELECT *
FROM source
WHERE status = 'PENDING'
  AND id > :lastId
ORDER BY id
FETCH NEXT :limit ROWS ONLY
```

Kelebihan:

- scalable untuk data besar,
- restart mudah dengan `lastId`,
- lebih stabil daripada offset,
- index-friendly.

Kekurangan:

- butuh ordering key yang monotonic/stable,
- sulit jika order by composite business rule,
- update status bisa mengubah visibility.

Keyset biasanya pilihan kuat untuk batch database besar.

### 8.4 Snapshot table

Buat daftar item yang akan diproses di awal job:

```sql
INSERT INTO job_snapshot(job_execution_id, item_id, status)
SELECT :jobExecutionId, id, 'PENDING'
FROM source
WHERE eligibility_condition = 'Y';
```

Kemudian batch memproses `job_snapshot`.

Kelebihan:

- input set stabil,
- audit bagus,
- restart jelas,
- bisa track per item,
- mudah partitioning,
- tidak terganggu perubahan source setelah snapshot.

Kekurangan:

- butuh storage tambahan,
- butuh cleanup/retention,
- snapshot creation bisa berat,
- perlu definisi apakah perubahan setelah snapshot ikut atau tidak.

Untuk sistem regulasi/audit, snapshot table sering sangat kuat.

### 8.5 Claim-and-process

Batch worker mengklaim record terlebih dahulu:

```sql
UPDATE work_item
SET status = 'IN_PROGRESS', claimed_by = :node, claimed_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT id
  FROM work_item
  WHERE status = 'PENDING'
  ORDER BY priority, id
  FETCH NEXT :limit ROWS ONLY
)
```

Lalu worker membaca item yang sudah diklaim.

Kelebihan:

- cocok untuk parallel workers,
- mengurangi duplicate execution,
- bisa recover stale claim,
- bagus untuk queue-like workload.

Risiko:

- perlu stale claim policy,
- perlu heartbeat/lease,
- status machine lebih kompleks,
- bisa terjadi hotspot pada index status/priority.

State model contoh:

```text
PENDING -> IN_PROGRESS -> COMPLETED
        -> FAILED_RETRYABLE -> PENDING
        -> FAILED_PERMANENT
        -> CANCELLED
```

---

## 9. Writer Strategy: Insert, Update, Merge, Staging, Outbox

### 9.1 Per-row update

```java
for (ProcessedItem item : items) {
    repository.update(item);
}
```

Sederhana, tetapi bisa lambat jika tidak memakai JDBC batch.

### 9.2 JDBC batch write

```java
try (PreparedStatement ps = connection.prepareStatement("""
    UPDATE case_record
    SET ageing_bucket = ?, recalculated_at = ?
    WHERE case_id = ?
""")) {
    for (ProcessedCase item : items) {
        ps.setString(1, item.ageingBucket());
        ps.setTimestamp(2, Timestamp.from(item.recalculatedAt()));
        ps.setLong(3, item.caseId());
        ps.addBatch();
    }
    ps.executeBatch();
}
```

Kelebihan:

- round trip lebih sedikit,
- throughput lebih tinggi,
- cocok dengan chunk writer.

Perhatikan:

- batch size selaras dengan commit interval,
- driver behavior berbeda,
- error per row bisa sulit diidentifikasi,
- perlu mapping `BatchUpdateException`.

### 9.3 Merge/upsert idempotent

```sql
MERGE INTO target t
USING (
  SELECT ? AS business_key, ? AS result_value FROM dual
) s
ON (t.business_key = s.business_key)
WHEN MATCHED THEN
  UPDATE SET t.result_value = s.result_value,
             t.updated_at = CURRENT_TIMESTAMP
WHEN NOT MATCHED THEN
  INSERT (business_key, result_value, created_at)
  VALUES (s.business_key, s.result_value, CURRENT_TIMESTAMP)
```

Idempotency lebih kuat jika:

- `business_key` unique,
- update deterministik,
- result bisa ditulis ulang tanpa menggandakan efek.

### 9.4 Insert-only result table

```sql
INSERT INTO batch_result (
  job_instance_id,
  item_id,
  result_hash,
  status,
  created_at
) VALUES (?, ?, ?, ?, ?)
```

Dengan unique constraint:

```sql
UNIQUE(job_instance_id, item_id)
```

Kelebihan:

- audit kuat,
- replay aman,
- hasil historis tersedia,
- cocok untuk regulatory evidence.

### 9.5 Staging table + set-based merge

Daripada update target satu per satu:

```text
Chunk writer -> insert rows into staging table
After step -> merge staging into target set-based
```

Kelebihan:

- target update lebih efisien,
- validasi bisa dilakukan sebelum apply,
- audit input/output jelas,
- rollback/retry lebih mudah.

Kekurangan:

- job graph lebih kompleks,
- butuh cleanup,
- butuh indexing staging,
- perlu handle partial apply.

### 9.6 Outbox writer

Untuk external side effect:

```sql
INSERT INTO outbox_event (
  event_id,
  aggregate_id,
  event_type,
  payload,
  status,
  created_at
) VALUES (?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
```

Dengan unique key:

```sql
UNIQUE(event_type, aggregate_id, idempotency_key)
```

Batch tidak langsung memanggil external API. Batch hanya membuat durable intent.

---

## 10. Locking Strategy

### 10.1 Lock harus sesingkat mungkin

Batch buruk:

```text
read item
lock row
call external API 5 seconds
update row
commit
```

Lock ditahan selama external API call.

Batch lebih baik:

```text
read item without long lock
compute result
begin short tx
  update row with optimistic condition
commit
```

### 10.2 Optimistic locking

Gunakan version column:

```sql
UPDATE case_record
SET status = ?, version = version + 1
WHERE case_id = ?
  AND version = ?
```

Jika affected rows = 0:

```text
conflict -> classify -> retry/skip/re-read
```

Cocok jika:

- conflict jarang,
- online users bisa mengubah data,
- batch tidak boleh overwrite perubahan baru.

### 10.3 Pessimistic locking

```sql
SELECT *
FROM work_item
WHERE status = 'PENDING'
FOR UPDATE SKIP LOCKED
```

Bisa berguna untuk worker parallel/queue style.

Perhatikan:

- syntax DB-specific,
- lock wait harus dibatasi,
- starvation mungkin terjadi,
- ordering/fairness perlu dipikirkan,
- tidak portable penuh across DB.

### 10.4 Lock escalation dan hotspot

Batch update besar bisa menyebabkan:

- row lock banyak,
- index block contention,
- lock wait tinggi,
- deadlock,
- buffer cache churn,
- replication lag.

Mitigasi:

- commit interval lebih kecil,
- update berdasarkan primary key order,
- hindari update hot status index terlalu sering,
- partition by range/hash,
- stagger job schedule,
- gunakan staging + set-based apply,
- gunakan maintenance window.

---

## 11. Isolation Level

### 11.1 Read committed

Umumnya default untuk banyak OLTP system.

Kelebihan:

- lock lebih ringan,
- cocok untuk batch yang toleran terhadap perubahan concurrent,
- lebih friendly untuk online workload.

Risiko:

- data bisa berubah antar chunk,
- phantom rows,
- non-repeatable reads,
- input set tidak stabil.

Mitigasi:

- snapshot table,
- keyset with stable criteria,
- process status marker,
- high-water mark.

### 11.2 Repeatable read / serializable

Lebih kuat secara consistency, tetapi:

- lock/MVCC pressure lebih tinggi,
- conflict lebih besar,
- undo/version store pressure naik,
- risiko mengganggu online workload.

Jangan menaikkan isolation level sebagai “obat generik”. Lebih sering, batch butuh **explicit input set**, bukan isolation level lebih tinggi.

### 11.3 High-water mark pattern

Pada awal job:

```sql
SELECT MAX(id) FROM source WHERE created_at <= :jobStartTime
```

Lalu proses:

```sql
WHERE id > :lastId
  AND id <= :highWaterMark
```

Kelebihan:

- input bounded,
- restart mudah,
- data baru tidak masuk batch berjalan,
- cocok untuk append-only-ish table.

Kekurangan:

- update pada existing rows tetap perlu policy,
- id harus monotonic relevan,
- late-arriving data perlu batch berikutnya.

---

## 12. Cursor, Fetch Size, dan Memory

### 12.1 Fetch size

JDBC fetch size mempengaruhi berapa banyak row diambil dari DB per round trip.

Terlalu kecil:

```text
banyak round trip -> lambat
```

Terlalu besar:

```text
memory naik -> GC pressure -> latency spike
```

### 12.2 Cursor lifetime

Cursor panjang bisa gagal karena:

- network idle timeout,
- DB session killed,
- statement timeout,
- app server transaction boundary,
- deployment interruption,
- commit behavior terhadap result set.

Untuk batch besar, lebih aman menyimpan checkpoint berbasis key daripada bergantung pada cursor offset internal.

### 12.3 Streaming CLOB/BLOB

Untuk large payload:

- jangan load seluruh CLOB/BLOB ke memory jika tidak perlu,
- process streaming jika mungkin,
- simpan checksum/hash untuk idempotency,
- pertimbangkan memisahkan metadata scan dan payload fetch,
- gunakan commit interval kecil untuk payload besar.

---

## 13. Connection Pool Pressure

### 13.1 Batch memakai connection pool yang sama?

Jika batch dan online request memakai pool yang sama:

```text
batch partitions consume connections
online requests wait
latency naik
timeout meningkat
incident terjadi
```

### 13.2 Hitung kebutuhan connection

Misal:

```text
online reserved connections: 60
batch partitions: 8
connections per partition: 1
outbox dispatcher: 4
admin/report: 5
pool max: 80
```

Total potensi:

```text
60 + 8 + 4 + 5 = 77
```

Pool 80 terlihat cukup, tetapi tanpa reserved/bulkhead, batch bisa mengambil koneksi yang seharusnya dibutuhkan online.

### 13.3 Bulkhead pool

Desain lebih aman:

```text
Online datasource pool: max 80
Batch datasource pool: max 10
Reporting datasource pool: max 5
```

Atau di level executor/partition:

```text
max active batch partitions <= available batch DB connections
```

### 13.4 Jangan biarkan virtual threads menipu kapasitas DB

Virtual threads bisa membuat ribuan task blocking murah di JVM, tetapi database connection tetap resource terbatas.

Invariant:

```text
concurrent DB operations <= DB-safe concurrency
```

Bukan:

```text
concurrent DB operations = number of virtual threads we can create
```

---

## 14. Undo, Redo, WAL, dan Log Pressure

Setiap DB punya istilah berbeda, tetapi pola umumnya:

- perubahan data perlu transaction log,
- rollback perlu undo/version information,
- commit besar menghasilkan I/O besar,
- update index menghasilkan log tambahan,
- replication membaca log tersebut,
- backup/recovery window terpengaruh.

### 14.1 Gejala log pressure

- commit latency naik,
- DB disk write tinggi,
- archive log cepat penuh,
- replication lag,
- checkpoint DB berat,
- undo tablespace/version store membesar,
- batch tampak cepat di awal lalu melambat.

### 14.2 Mitigasi

- commit interval moderat,
- hindari update kolom yang tidak berubah,
- drop/rebuild index hanya jika benar-benar maintenance mode dan aman,
- staging + set-based merge,
- partitioned processing,
- throttle batch,
- schedule di off-peak,
- monitor redo/undo per job.

---

## 15. Database Restart Consistency

Pertanyaan penting:

> Setelah crash/restart, bagaimana sistem tahu record mana yang sudah benar-benar selesai?

Jangan hanya bergantung pada memory progress.

### 15.1 Status column pattern

```text
PENDING -> PROCESSING -> COMPLETED
                 -> FAILED_RETRYABLE
                 -> FAILED_PERMANENT
```

Dengan lease:

```text
PROCESSING + claimed_at older than threshold -> eligible for recovery
```

### 15.2 Result table pattern

```sql
CREATE TABLE batch_item_result (
  job_instance_id VARCHAR(100),
  item_id         VARCHAR(100),
  status          VARCHAR(30),
  result_hash     VARCHAR(128),
  error_code      VARCHAR(100),
  created_at      TIMESTAMP,
  updated_at      TIMESTAMP,
  CONSTRAINT uq_batch_item_result UNIQUE(job_instance_id, item_id)
);
```

Restart dapat bertanya:

```sql
SELECT item_id
FROM job_snapshot s
WHERE NOT EXISTS (
  SELECT 1
  FROM batch_item_result r
  WHERE r.job_instance_id = s.job_instance_id
    AND r.item_id = s.item_id
    AND r.status = 'COMPLETED'
)
```

### 15.3 Checkpoint + result table

Checkpoint memberi posisi stream. Result table memberi bukti item-level.

Untuk workload penting, keduanya saling melengkapi:

```text
checkpoint = where to resume efficiently
result table = what has been completed safely
```

---

## 16. JPA/Hibernate dalam Batch: Gunakan dengan Hati-Hati

JPA nyaman, tetapi batch besar mudah bermasalah jika dipakai seperti request CRUD biasa.

### 16.1 Persistence context bloat

Jika membaca dan update ribuan entity dalam satu persistence context:

```text
EntityManager tracks many managed entities -> memory naik -> dirty checking mahal
```

Mitigasi:

```java
if (count % batchSize == 0) {
    entityManager.flush();
    entityManager.clear();
}
```

Namun dalam Jakarta Batch chunk, flush/clear harus diselaraskan dengan transaction boundary.

### 16.2 N+1 query dalam batch

N+1 di request mungkin lambat. N+1 di batch bisa menjadi bencana.

Mitigasi:

- fetch join hati-hati,
- projection query,
- DTO/native query,
- prefetch reference data,
- cache read-only lookup,
- set-based SQL.

### 16.3 Bulk update bypass persistence context

JPA bulk update:

```java
entityManager.createQuery("""
    update CaseRecord c
    set c.status = :status
    where c.ageingDays > :threshold
""").executeUpdate();
```

Ini tidak sinkron otomatis dengan entity yang sudah managed di persistence context.

Untuk batch besar, sering lebih baik:

- gunakan JDBC/native SQL untuk bulk operation,
- gunakan JPA untuk domain logic kecil,
- pisahkan read model dan write model.

### 16.4 Lazy loading di writer

Writer harus menulis output chunk, bukan memicu graph loading besar secara tidak sadar.

Anti-pattern:

```java
for (Case c : cases) {
    c.getApplicant().getProfile().getAddress().getPostalCode(); // lazy chain
}
```

Di batch besar, ini bisa menjadi ribuan query tambahan.

---

## 17. SQL Pattern untuk Batch Database Integration

### 17.1 Snapshot creation

```sql
INSERT INTO batch_case_snapshot (
  job_execution_id,
  case_id,
  snapshot_status,
  created_at
)
SELECT :jobExecutionId,
       c.case_id,
       'PENDING',
       CURRENT_TIMESTAMP
FROM case_record c
WHERE c.status = 'OPEN'
  AND c.last_activity_at < :cutoff
  AND NOT EXISTS (
      SELECT 1
      FROM batch_case_snapshot s
      WHERE s.job_execution_id = :jobExecutionId
        AND s.case_id = c.case_id
  );
```

### 17.2 Keyset read from snapshot

```sql
SELECT case_id
FROM batch_case_snapshot
WHERE job_execution_id = :jobExecutionId
  AND snapshot_status = 'PENDING'
  AND case_id > :lastCaseId
ORDER BY case_id
FETCH NEXT :limit ROWS ONLY;
```

### 17.3 Idempotent result write

```sql
MERGE INTO batch_case_result r
USING (
  SELECT :jobExecutionId AS job_execution_id,
         :caseId AS case_id,
         :resultHash AS result_hash,
         :newBucket AS ageing_bucket
  FROM dual
) x
ON (r.job_execution_id = x.job_execution_id AND r.case_id = x.case_id)
WHEN MATCHED THEN
  UPDATE SET r.result_hash = x.result_hash,
             r.ageing_bucket = x.ageing_bucket,
             r.updated_at = CURRENT_TIMESTAMP
WHEN NOT MATCHED THEN
  INSERT (job_execution_id, case_id, result_hash, ageing_bucket, created_at)
  VALUES (x.job_execution_id, x.case_id, x.result_hash, x.ageing_bucket, CURRENT_TIMESTAMP);
```

### 17.4 Apply result to target with optimistic guard

```sql
UPDATE case_record c
SET c.ageing_bucket = :newBucket,
    c.recalculated_at = CURRENT_TIMESTAMP,
    c.version = c.version + 1
WHERE c.case_id = :caseId
  AND c.version = :expectedVersion;
```

If updated rows = 0:

```text
Record changed concurrently -> classify as conflict -> re-read/retry/skip according to policy
```

---

## 18. Example: Chunk Reader/Writer with Checkpointed Keyset

### 18.1 Checkpoint object

```java
import java.io.Serializable;

public record CaseCheckpoint(long lastCaseId) implements Serializable {
    public static CaseCheckpoint initial() {
        return new CaseCheckpoint(0L);
    }
}
```

### 18.2 Reader skeleton

```java
import jakarta.batch.api.chunk.ItemReader;
import jakarta.enterprise.context.Dependent;
import jakarta.inject.Inject;
import javax.sql.DataSource;
import java.io.Serializable;
import java.sql.*;
import java.util.ArrayDeque;
import java.util.Queue;

@Dependent
public class CaseSnapshotReader implements ItemReader {

    @Inject
    DataSource dataSource;

    private long jobExecutionId;
    private long lastCaseId;
    private final Queue<Long> buffer = new ArrayDeque<>();

    @Override
    public void open(Serializable checkpoint) throws Exception {
        CaseCheckpoint cp = checkpoint == null
                ? CaseCheckpoint.initial()
                : (CaseCheckpoint) checkpoint;

        this.lastCaseId = cp.lastCaseId();
        this.jobExecutionId = resolveJobExecutionId();
    }

    @Override
    public Object readItem() throws Exception {
        if (buffer.isEmpty()) {
            loadNextPage();
        }

        Long next = buffer.poll();
        if (next == null) {
            return null;
        }

        lastCaseId = next;
        return next;
    }

    private void loadNextPage() throws SQLException {
        String sql = """
            SELECT case_id
            FROM batch_case_snapshot
            WHERE job_execution_id = ?
              AND snapshot_status = 'PENDING'
              AND case_id > ?
            ORDER BY case_id
            FETCH NEXT 100 ROWS ONLY
            """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {

            ps.setLong(1, jobExecutionId);
            ps.setLong(2, lastCaseId);

            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    buffer.add(rs.getLong(1));
                }
            }
        }
    }

    @Override
    public Serializable checkpointInfo() {
        return new CaseCheckpoint(lastCaseId);
    }

    @Override
    public void close() {
        buffer.clear();
    }

    private long resolveJobExecutionId() {
        // In real Jakarta Batch code, inject JobContext/StepContext.
        // Kept simplified here.
        return 123L;
    }
}
```

Catatan penting:

- checkpoint memakai `lastCaseId`, bukan offset,
- reader tidak menyimpan semua data di memory,
- ordering deterministic,
- restart dapat melanjutkan dari key terakhir,
- jika writer idempotent, replay tetap aman.

### 18.3 Writer skeleton

```java
import jakarta.batch.api.chunk.ItemWriter;
import jakarta.enterprise.context.Dependent;
import jakarta.inject.Inject;
import javax.sql.DataSource;
import java.io.Serializable;
import java.sql.*;
import java.util.List;

@Dependent
public class CaseResultWriter implements ItemWriter {

    @Inject
    DataSource dataSource;

    private long jobExecutionId;

    @Override
    public void open(Serializable checkpoint) {
        this.jobExecutionId = resolveJobExecutionId();
    }

    @Override
    public void writeItems(List<Object> items) throws Exception {
        String sql = """
            MERGE INTO batch_case_result r
            USING (
                SELECT ? AS job_execution_id,
                       ? AS case_id,
                       ? AS ageing_bucket,
                       ? AS result_hash
                FROM dual
            ) x
            ON (r.job_execution_id = x.job_execution_id AND r.case_id = x.case_id)
            WHEN MATCHED THEN
              UPDATE SET r.ageing_bucket = x.ageing_bucket,
                         r.result_hash = x.result_hash,
                         r.updated_at = CURRENT_TIMESTAMP
            WHEN NOT MATCHED THEN
              INSERT (job_execution_id, case_id, ageing_bucket, result_hash, created_at)
              VALUES (x.job_execution_id, x.case_id, x.ageing_bucket, x.result_hash, CURRENT_TIMESTAMP)
            """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {

            for (Object obj : items) {
                ProcessedCase item = (ProcessedCase) obj;
                ps.setLong(1, jobExecutionId);
                ps.setLong(2, item.caseId());
                ps.setString(3, item.ageingBucket());
                ps.setString(4, item.resultHash());
                ps.addBatch();
            }

            ps.executeBatch();
        }
    }

    @Override
    public Serializable checkpointInfo() {
        return null;
    }

    @Override
    public void close() {
    }

    private long resolveJobExecutionId() {
        return 123L;
    }
}
```

Important nuance:

- Dalam managed environment, connection/transaction handling bisa dikelola container.
- Contoh di atas menunjukkan shape SQL, bukan menyarankan manual transaction demarcation sembarangan.
- Pada runtime nyata, selaraskan DataSource dengan transaction mode Jakarta Batch server.

---

## 19. Batch Transaction Failure Scenarios

### 19.1 Failure before writer

```text
read/process item 1..100
crash before writer
```

Hasil:

- tidak ada write,
- checkpoint belum maju,
- restart mengulang item.

Aman jika processor deterministic dan tidak punya side effect non-transactional.

### 19.2 Failure during writer before commit

```text
writer updates rows
DB error occurs
transaction rollback
```

Hasil:

- chunk rollback,
- checkpoint tidak maju,
- restart mengulang chunk.

Aman jika semua write berada dalam transaksi yang sama.

### 19.3 Failure after commit before external side effect

Jika external side effect dilakukan setelah commit:

```text
DB commit success
crash before API call
```

Aman jika outbox digunakan, karena outbox row sudah committed dan dispatcher bisa lanjut.

Tidak aman jika API call hanya ada di memory setelah commit.

### 19.4 Failure after external side effect before DB commit

```text
call external API success
DB commit fails
```

Bahaya:

- external state berubah,
- DB tidak mencatat perubahan,
- restart mengulang API call.

Mitigasi:

- jangan call API langsung dalam chunk writer,
- gunakan outbox,
- gunakan idempotency key external,
- reconciliation.

### 19.5 Deadlock

```text
Partition A updates rows 1,2
Partition B updates rows 2,1
```

Mitigasi:

- deterministic update order,
- partition disjoint by key range,
- retry deadlock dengan backoff,
- reduce chunk size,
- avoid cross-partition shared rows.

---

## 20. Transaction Timeout

Transaction timeout harus lebih besar dari normal chunk duration, tetapi tidak terlalu besar sampai stuck transaction hidup terlalu lama.

Rule of thumb:

```text
transactionTimeout > p99 chunk duration + safety margin
```

Bukan:

```text
transactionTimeout = several hours
```

Jika chunk sering timeout:

- commit interval terlalu besar,
- writer terlalu lambat,
- DB lock wait tinggi,
- external call terjadi dalam transaksi,
- query plan buruk,
- connection pool wait ikut masuk durasi,
- partition terlalu banyak.

Timeout harus dilihat sebagai signal desain, bukan hanya angka yang dinaikkan.

---

## 21. Partitioning dan Database Integration

Partitioning mempercepat batch hanya jika database dan data layout mendukung.

### 21.1 Partition by key range

```text
Partition 1: case_id 1       - 1,000,000
Partition 2: case_id 1,000,001 - 2,000,000
Partition 3: case_id 2,000,001 - 3,000,000
```

Kelebihan:

- disjoint,
- restart jelas,
- lock conflict rendah.

Risiko:

- data skew,
- range tertentu jauh lebih berat,
- hot partitions.

### 21.2 Partition by hash

```sql
MOD(case_id, :partitionCount) = :partitionNumber
```

Kelebihan:

- distribusi lebih rata,
- mudah untuk key numeric/string hashed.

Risiko:

- query/index support perlu dipikirkan,
- sulit range scan alami,
- DB-specific function bisa menghambat index.

### 21.3 Partition by tenant/module

Cocok jika:

- workload naturally separated,
- audit/report juga per tenant/module,
- locking antar tenant rendah.

Risiko:

- tenant besar membuat skew,
- fairness perlu dijaga.

### 21.4 Partition count harus mengikuti DB capacity

Jangan mulai dari “semakin banyak partition semakin cepat”.

Invariant:

```text
partitionCount <= min(
  batch executor capacity,
  safe DB connection capacity,
  safe DB write concurrency,
  downstream capacity,
  lock conflict tolerance
)
```

---

## 22. Testing Strategy

### 22.1 Transaction rollback test

Simulasikan writer gagal pada item tertentu:

```text
Given chunk size 100
When writer throws exception on item 75
Then no item in chunk is committed
And restart reprocesses from previous checkpoint
```

### 22.2 Restart after crash

Simulasikan process kill setelah beberapa chunk commit.

Verifikasi:

- committed chunks tidak digandakan,
- uncommitted chunk diproses ulang,
- result table unique constraint tidak dilanggar secara fatal,
- audit tetap konsisten.

### 22.3 Duplicate replay test

Paksa item yang sama masuk writer dua kali.

Expected:

```text
same business key + same result -> no duplicate side effect
```

### 22.4 Concurrent online update test

Batch membaca item, lalu online user mengubah item sebelum writer update.

Expected sesuai policy:

- optimistic conflict,
- re-read,
- skip with reason,
- retry,
- or overwrite if business allows.

Jangan biarkan overwrite diam-diam jika domain tidak mengizinkan.

### 22.5 Lock wait/deadlock test

Jalankan parallel partition dengan update overlap.

Ukur:

- deadlock count,
- lock wait time,
- retry success,
- chunk duration p99,
- DB CPU/IO.

---

## 23. Observability untuk Batch Database Transaction

Minimal metrics:

```text
batch.chunk.duration
batch.chunk.commit.duration
batch.chunk.rollback.count
batch.chunk.retry.count
batch.item.processed.count
batch.item.failed.count
batch.db.lock.wait.duration
batch.db.connection.acquire.duration
batch.db.write.batch.size
batch.db.rows.updated
batch.db.deadlock.count
batch.db.timeout.count
batch.checkpoint.update.count
```

Minimal logs per chunk:

```json
{
  "jobExecutionId": 9001,
  "stepExecutionId": 12,
  "chunkNumber": 42,
  "firstItemKey": "CASE-1000",
  "lastItemKey": "CASE-1099",
  "itemCount": 100,
  "durationMs": 1850,
  "writeDurationMs": 430,
  "commitDurationMs": 80,
  "status": "COMMITTED"
}
```

Minimal audit:

```text
who started job
when job started
parameters used
input selection criteria
snapshot count
processed count
failed count
skipped count
restart count
final status
output manifest/checksum
```

---

## 24. Anti-Patterns

### 24.1 Long transaction around whole job

```java
@Transactional
public void runWholeBatch() {
    for (...) {
        processAndUpdate(...);
    }
}
```

Masalah:

- long lock,
- timeout,
- huge rollback,
- no granular restart.

### 24.2 Reader depends on unstable offset

```text
OFFSET 1000000 FETCH NEXT 100
```

Saat data berubah, item bisa skip/duplicate.

### 24.3 Writer is not idempotent

```sql
INSERT INTO notification_sent(case_id, sent_at) VALUES (?, ?)
```

Tanpa unique constraint/idempotency key, restart bisa menggandakan efek.

### 24.4 External API call inside transaction

```text
BEGIN TX
  update DB
  call external API
COMMIT
```

Rollback tidak bisa membatalkan API call.

### 24.5 Partition overlap

Dua partition memproses item sama karena query partition tidak disjoint.

### 24.6 Batch monopolizes connection pool

Batch cepat, aplikasi online timeout. Ini tetap desain gagal.

### 24.7 Commit interval chosen blindly

Angka commit interval harus berasal dari measurement, bukan feeling.

---

## 25. Design Checklist

Sebelum batch database job masuk production, jawab pertanyaan ini:

### Transaction

- [ ] Apa transaction boundary utama?
- [ ] Apakah satu chunk = satu transaksi?
- [ ] Berapa commit interval?
- [ ] Berapa p95/p99 chunk duration?
- [ ] Berapa transaction timeout?
- [ ] Apa yang terjadi jika writer gagal?

### Reader

- [ ] Reader memakai cursor, paging, keyset, snapshot, atau claim?
- [ ] Apakah ordering deterministic?
- [ ] Apakah checkpoint berbasis key stabil?
- [ ] Apakah input set berubah selama job berjalan?
- [ ] Jika berubah, apa policy-nya?

### Writer

- [ ] Apakah writer idempotent?
- [ ] Apakah ada unique key/idempotency key?
- [ ] Apakah duplicate replay aman?
- [ ] Apakah writer memakai JDBC batch/set-based operation?
- [ ] Apakah external side effect dipisahkan via outbox?

### DB capacity

- [ ] Berapa connection yang dipakai batch?
- [ ] Apakah online workload punya reserved capacity?
- [ ] Apakah partition count sesuai DB capacity?
- [ ] Apakah lock wait diukur?
- [ ] Apakah redo/undo/log pressure diukur?

### Restart

- [ ] Jika crash setelah chunk commit, apa yang terjadi?
- [ ] Jika crash sebelum checkpoint, apa yang terjadi?
- [ ] Jika item diproses ulang, apakah aman?
- [ ] Apakah result/audit table bisa membuktikan status item?

### Audit

- [ ] Apakah parameter job disimpan?
- [ ] Apakah input manifest/snapshot tersedia?
- [ ] Apakah skipped/retried/failed item punya reason?
- [ ] Apakah operator action terekam?

---

## 26. Ringkasan

Batch database integration adalah salah satu area paling krusial dalam enterprise engineering karena ia menyentuh data besar, transaksi, lock, recovery, audit, dan kapasitas shared database.

Prinsip utama:

1. **Jangan gunakan satu transaksi besar untuk seluruh job.** Gunakan chunk sebagai failure containment unit.
2. **Commit interval adalah keputusan reliability dan performance.** Ia menentukan rollback scope, replay window, lock lifetime, dan throughput.
3. **Checkpoint bukan idempotency.** Restart bisa mengulang item; writer harus aman terhadap pengulangan.
4. **Pilih reader strategy dengan sadar.** Cursor, offset paging, keyset, snapshot, dan claim-and-process punya trade-off berbeda.
5. **Jangan panggil external API langsung dalam transaksi chunk** untuk side effect penting; gunakan outbox/idempotency.
6. **Database adalah shared resource.** Batch harus dibatasi agar tidak menghabiskan connection, lock, redo/undo, dan I/O untuk workload lain.
7. **Partitioning harus mengikuti kapasitas database**, bukan sekadar jumlah CPU/thread.
8. **Restart consistency harus dapat dibuktikan**, terutama untuk sistem regulasi, finansial, enforcement, case management, dan audit-heavy domain.

Mental model akhir:

```text
Jakarta Batch transaction design =
  bounded transaction
+ stable reader progress
+ idempotent writer
+ database-friendly concurrency
+ explicit recovery state
+ measurable operational behavior
+ defensible audit evidence
```

---

## 27. Latihan / Thought Experiment

### Latihan 1 — Commit interval

Kamu punya batch 2 juta records. Setiap item butuh 10 ms CPU dan writer batch 100 item butuh 300 ms. DB mulai lock wait jika transaksi lebih dari 5 detik.

Pertanyaan:

- Berapa commit interval awal yang masuk akal?
- Apa metric yang kamu ukur sebelum menaikkan commit interval?
- Apa risiko jika commit interval langsung 5000?

### Latihan 2 — Restart duplicate

Writer melakukan insert ke `notification_sent`. Job crash setelah 10 chunk commit, lalu restart dari checkpoint yang ternyata mengulang chunk terakhir.

Pertanyaan:

- Constraint apa yang harus ada?
- Bagaimana bentuk idempotency key?
- Apakah cukup mengandalkan checkpoint?

### Latihan 3 — Online conflict

Batch recalculates `case.ageing_bucket`, sementara officer bisa update case status secara online.

Pertanyaan:

- Apakah batch boleh overwrite update officer?
- Apakah perlu optimistic locking?
- Jika conflict terjadi, apakah retry, skip, atau re-read?
- Bagaimana audit reason disimpan?

### Latihan 4 — Partitioning

Job dipartisi 20 partition, tetapi DB pool batch hanya 8 connection dan online traffic sedang tinggi.

Pertanyaan:

- Apa failure mode yang mungkin muncul?
- Bagaimana membatasi partition execution?
- Apa metric yang menunjukkan batch mulai mengganggu online workload?

---

## 28. Referensi

- Jakarta Batch 2.1 Specification — chunk-oriented processing, commit interval, checkpoint, JSL semantics.
- Jakarta Batch 2.1 API — `ItemReader.open(Serializable checkpoint)`, `checkpointInfo()`, `ItemWriter`, chunk package.
- Jakarta Transactions 2.0 Specification — transaction manager, application server, resource manager, transactional application contracts.
- Jakarta EE 11 Platform — baseline modern Jakarta EE platform for Batch 2.1 and related enterprise APIs.
- Vendor/runtime documentation should always be checked for transaction timeout, cursor holdability, job repository configuration, and datasource transaction behavior.
