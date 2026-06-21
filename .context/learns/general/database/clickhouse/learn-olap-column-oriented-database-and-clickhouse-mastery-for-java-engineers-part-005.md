# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-005.md

# Part 005 — MergeTree Internals II: Background Merges, Mutations, TTL, and Part Explosion

> Seri: `learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers`  
> Part: `005` dari `034`  
> Target pembaca: Java software engineer / backend engineer yang ingin memahami OLAP, column-oriented database, dan ClickHouse sampai level desain produksi.

---

## 0. Posisi Part Ini dalam Seri

Di Part 004 kita membahas fondasi fisik `MergeTree`:

- part,
- partition,
- granule,
- mark,
- sparse primary index,
- `ORDER BY`,
- `PRIMARY KEY`,
- dan kenapa ClickHouse cepat bukan karena mencari satu row, tetapi karena **menghindari membaca banyak data yang tidak relevan**.

Part ini melanjutkan fondasi tersebut ke sisi yang sering menentukan stabilitas produksi:

- bagaimana part kecil digabung menjadi part besar,
- kenapa background merges adalah mekanisme internal penting,
- kenapa terlalu banyak part bisa menghancurkan performa,
- kenapa `UPDATE`/`DELETE` di ClickHouse bukan operasi murah seperti OLTP,
- bagaimana TTL bekerja,
- kapan `OPTIMIZE FINAL` masuk akal,
- dan bagaimana membaca gejala operasional sebelum cluster menjadi tidak stabil.

Part ini sengaja tidak fokus pada syntax terlebih dahulu. Kita akan mulai dari mental model, karena banyak engineer gagal mengoperasikan ClickHouse bukan karena tidak tahu command, tetapi karena membawa ekspektasi OLTP ke sistem OLAP append-optimized.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan kenapa ClickHouse menulis data sebagai immutable parts.
2. Menjelaskan apa yang dilakukan background merge.
3. Memahami hubungan antara insert rate, batch size, partition count, part count, dan query performance.
4. Menghindari masalah `Too many parts` sejak desain ingestion.
5. Memahami kenapa mutation adalah rewrite data, bukan update row murah.
6. Mendesain TTL untuk retention, archival, movement, dan rollup dengan ekspektasi yang benar.
7. Mengetahui kapan `OPTIMIZE FINAL` berbahaya.
8. Membaca system tables dasar untuk mendiagnosis merge, mutation, dan part pressure.
9. Mendesain strategi operasional untuk workload analytics yang stabil.

---

## 2. Mental Model Utama

Kalau harus diringkas menjadi satu kalimat:

> ClickHouse cepat karena data disimpan sebagai immutable sorted columnar parts, lalu sistem secara background menggabungkan part-part kecil menjadi part besar agar query dan storage tetap efisien.

Implikasinya besar.

Di OLTP database, kamu biasanya membayangkan row sebagai unit utama:

```text
insert row
update row
delete row
read row by key
```

Di ClickHouse, terutama `MergeTree`, unit mental yang lebih tepat adalah:

```text
insert batch
write immutable part
merge parts later
rewrite affected parts for mutations
skip granules during reads
expire/move/roll up data during merges
```

Jadi, ClickHouse bukan sistem yang terus-menerus mengedit file kecil secara in-place. ClickHouse lebih mirip sistem yang:

1. menerima batch data,
2. menulisnya sebagai potongan data immutable,
3. kemudian membersihkan dan menggabungkan potongan itu secara background.

Analogi untuk Java engineer:

- OLTP update mirip `ConcurrentHashMap.put(key, value)`.
- ClickHouse insert lebih mirip append file segment.
- ClickHouse merge lebih mirip compaction di LSM-tree atau log-structured storage.
- Mutation lebih mirip menulis ulang segment yang terdampak, bukan mengganti satu object di heap.

Namun jangan disamakan mentah-mentah dengan LSM database. Kesamaannya adalah pola **immutable segments + background compaction/merge**, tetapi tujuan ClickHouse adalah analytical scan, columnar compression, sparse index, dan high-throughput OLAP.

---

## 3. Kenapa ClickHouse Memakai Immutable Parts

### 3.1 Masalah yang Ingin Diselesaikan

Analytical database harus menangani:

- insert besar,
- scan banyak row,
- kompresi tinggi,
- parallel read,
- agregasi besar,
- dan cost per query rendah.

Kalau setiap row ditulis dan di-update secara acak di disk, beberapa hal menjadi buruk:

1. Compression ratio turun.
2. Sequential scan menjadi tidak efisien.
3. Metadata index menjadi berat.
4. Write amplification sulit dikontrol.
5. Parallel read menjadi fragmented.

Immutable sorted parts memberi beberapa keuntungan:

- penulisan batch lebih sederhana,
- read bisa sequential,
- kolom bisa dikompresi per segment,
- sparse index bisa kecil,
- part bisa digabung secara batch,
- crash recovery lebih manageable,
- distributed replication lebih mudah dikelola di level part.

### 3.2 Insert Path yang Perlu Diingat

Secara konseptual:

```text
client sends batch
      ↓
ClickHouse receives block
      ↓
block is sorted according to ORDER BY
      ↓
columns are encoded/compressed
      ↓
new immutable part is written
      ↓
part becomes active
      ↓
background merge later combines compatible parts
```

Setiap insert biasanya menghasilkan part baru atau berkontribusi ke pembentukan part baru, tergantung engine/settings/buffering path. Karena itu, insert yang terlalu kecil dan terlalu sering dapat menghasilkan banyak part kecil.

### 3.3 Query Path dan Part Count

Saat query berjalan, ClickHouse harus mempertimbangkan parts yang relevan:

```text
query
  ↓
choose partitions
  ↓
choose active parts
  ↓
use primary index/marks to skip granules
  ↓
read selected columns
  ↓
execute filters/aggregations/sorts
```

Kalau satu partition memiliki ribuan part kecil, query harus membuka dan memproses metadata lebih banyak. Walaupun data total tidak berubah, overhead meningkat.

Ini salah satu alasan `Too many parts` bukan cuma warning kosmetik. Banyak part kecil berarti:

- metadata overhead naik,
- file handles naik,
- query planning/read overhead naik,
- merge backlog naik,
- memory overhead naik,
- insert bisa mulai ditolak/diperlambat,
- cluster menjadi tidak stabil.

Dokumentasi ClickHouse secara eksplisit memperingatkan bahwa terlalu banyak part menyebabkan degradasi performa dan ClickHouse dapat melempar error `Too many parts` untuk mencegah kerusakan performa lebih jauh.

---

## 4. Background Merges

### 4.1 Apa Itu Background Merge?

Background merge adalah proses internal yang menggabungkan beberapa data part menjadi part baru yang lebih besar.

Contoh sederhana:

```text
Before merge:

Partition 2026-06
  part_001
  part_002
  part_003
  part_004

After merge:

Partition 2026-06
  part_005   // hasil merge part_001..part_004
```

Part lama tidak langsung “di-edit”. ClickHouse menulis part baru, lalu part lama menjadi inactive dan akhirnya dibersihkan.

### 4.2 Apa yang Terjadi Saat Merge?

Secara konseptual:

1. ClickHouse memilih beberapa part yang kompatibel dalam partition yang sama.
2. Data dari part tersebut dibaca.
3. Data digabung sesuai sorting key.
4. Kolom dikompresi ulang.
5. Index marks/metadata baru dibuat.
6. Part hasil merge ditulis ke disk.
7. Metadata table diarahkan ke part baru.
8. Part lama ditandai inactive.
9. Part lama dibersihkan kemudian.

Poin penting:

> Parts dari partition berbeda tidak digabung.

Karena itu, partitioning strategy memengaruhi merge efficiency. Terlalu banyak partition kecil berarti merge tidak punya cukup ruang untuk menggabungkan part secara efisien.

### 4.3 Merge Bukan Maintenance Tambahan; Merge Adalah Bagian dari Write Path

Kesalahan umum engineer baru adalah menganggap merge sebagai pekerjaan opsional seperti vacuum manual.

Lebih tepat:

> Insert di ClickHouse belum “selesai secara ekonomis” sampai part kecil hasil insert berhasil digabung menjadi part yang lebih efisien.

Data memang sudah queryable setelah insert, tetapi sistem masih punya utang background work.

Kalau ingestion terlalu agresif, utang ini bertambah terus.

### 4.4 Merge Debt

Kita bisa memakai istilah mental **merge debt**.

```text
merge debt = jumlah pekerjaan background merge yang belum selesai
```

Merge debt naik karena:

- insert terlalu kecil,
- insert terlalu sering,
- partition terlalu banyak,
- disk lambat,
- CPU sibuk query,
- mutation banyak,
- TTL rewrite banyak,
- cluster kekurangan background pool,
- data terlalu besar untuk merge cepat.

Merge debt turun ketika background merges berhasil menggabungkan parts.

Kalau merge debt terus naik, gejalanya:

- part count meningkat,
- insert latency meningkat,
- query latency meningkat,
- background pool sibuk,
- disk I/O tinggi,
- mutation tertunda,
- TTL tidak segera terlihat,
- error `Too many parts` muncul.

### 4.5 Merge dan Compression

Merge bukan hanya mengurangi jumlah part.

Merge juga bisa memperbaiki compression karena data yang disortir bersama menghasilkan pola yang lebih kompresibel.

Misalnya data event disortir berdasarkan:

```sql
ORDER BY (tenant_id, event_date, event_type)
```

Ketika part kecil digabung menjadi part besar, nilai-nilai yang mirip cenderung lebih berdekatan. Ini membantu encoding/compression.

Namun merge juga memakai resource:

- membaca data lama,
- menulis data baru,
- menggunakan CPU untuk decompress/recompress,
- menggunakan disk bandwidth,
- menghasilkan write amplification.

Jadi merge adalah trade-off:

```text
lebih banyak merge → part lebih sehat, query lebih baik, storage lebih efisien
terlalu banyak merge pressure → resource contention, ingestion/query terganggu
```

---

## 5. Part Explosion

### 5.1 Apa Itu Part Explosion?

Part explosion adalah kondisi ketika jumlah part aktif terlalu banyak, biasanya karena insert terlalu kecil/sering atau partitioning terlalu granular.

Contoh buruk:

```text
10 services
× 100 tenants
× insert setiap 100 ms
× partition per tenant per hour
= ribuan part kecil dalam waktu singkat
```

ClickHouse bisa menerima data dengan cepat, tetapi tidak berarti aman mengirim insert row-by-row.

### 5.2 Kenapa Banyak Part Itu Mahal?

Banyak part berarti:

1. Lebih banyak metadata.
2. Lebih banyak file/marks yang harus dipertimbangkan.
3. Lebih banyak overhead saat query memilih data.
4. Lebih banyak pekerjaan merge.
5. Lebih banyak tekanan pada disk dan memory.
6. Lebih banyak replication queue pada replicated tables.
7. Lebih banyak peluang backlog.

Analytical query yang harus membaca 100 GB dari 10 part besar bisa lebih sehat daripada membaca 100 GB dari 100.000 part kecil.

### 5.3 Sumber Umum Part Explosion

#### 5.3.1 Insert Row-by-Row

Anti-pattern:

```java
for (Event event : events) {
    jdbcTemplate.update("INSERT INTO events VALUES (...)”, event...);
}
```

Ini gaya OLTP. Untuk ClickHouse, ini berbahaya.

Pattern yang lebih benar:

```text
collect events
batch by size/time
insert batch
monitor failures
retry safely
```

#### 5.3.2 Batch Terlalu Kecil

Batch 10 row biasanya buruk untuk workload besar.

Better target biasanya ribuan sampai ratusan ribu row per insert, tergantung row width, latency requirement, memory, network, dan ingestion architecture.

Aturan praktis:

```text
lebih baik insert lebih jarang tetapi lebih besar
```

Namun jangan ekstrem. Batch terlalu besar juga bisa menyebabkan:

- memory spike,
- long retry,
- timeout,
- large part creation latency,
- harder failure recovery.

#### 5.3.3 Partition Terlalu Granular

Anti-pattern:

```sql
PARTITION BY (tenant_id, toStartOfHour(event_time))
```

Untuk tenant banyak dan event sparse, ini bisa membuat terlalu banyak partition.

Lebih sehat sering kali:

```sql
PARTITION BY toYYYYMM(event_time)
```

atau:

```sql
PARTITION BY toYYYYMMDD(event_time)
```

Tergantung volume dan retention.

Prinsip:

> Partition adalah boundary lifecycle, bukan indexing utama.

Kalau kamu memakai partition sebagai pengganti index, biasanya desainnya mulai salah.

#### 5.3.4 Terlalu Banyak Source Menulis Langsung

Misalnya 200 microservices masing-masing insert langsung ke ClickHouse.

Masalah:

- banyak connection,
- banyak small insert,
- retry tidak terkoordinasi,
- backpressure sulit,
- schema evolution kacau,
- observability ingestion buruk.

Lebih baik ada ingestion gateway/buffer:

```text
services
  ↓
event bus / ingestion service
  ↓
batcher
  ↓
ClickHouse
```

#### 5.3.5 Sharding Salah

Kalau distributed insert menyebarkan batch kecil ke banyak shard, setiap shard menerima batch yang lebih kecil lagi.

Contoh:

```text
client batch: 10,000 rows
shards: 20
average per shard: 500 rows
```

Kalau batch 10,000 tadi sudah minimal, setelah dishard menjadi terlalu kecil.

---

## 6. Insert Batching sebagai Kontrol Utama

### 6.1 Batch Berdasarkan Size dan Time

Ingestion biasanya perlu dua trigger:

```text
flush when rows >= N
flush when time >= T
```

Contoh:

```text
flush setiap 100,000 rows
atau setiap 2 detik
mana yang lebih dulu
```

Ini menjaga:

- batch cukup besar saat traffic tinggi,
- latency tetap bounded saat traffic rendah.

### 6.2 Batch Berdasarkan Partition

Karena parts berada dalam partition, batch yang bercampur terlalu banyak partition bisa menghasilkan banyak part.

Misalnya satu batch berisi data untuk 500 partition berbeda. Ini bisa menjadi buruk.

Lebih sehat:

```text
buffer by target table + partition bucket
flush per bucket
```

Namun ini trade-off dengan memory dan latency.

### 6.3 Batch Berdasarkan Shard

Untuk distributed setup, ingestion layer sebaiknya sadar shard key.

Pattern:

```text
receive events
calculate shard key
buffer per shard
flush larger batch to each shard/local table
```

Ini lebih kompleks, tetapi lebih stabil untuk throughput tinggi.

### 6.4 Java-Oriented Batching Pattern

Pseudo-code ingestion buffer:

```java
final class ClickHouseBatcher<T> {
    private final int maxRows;
    private final Duration maxDelay;
    private final Map<BucketKey, List<T>> buffers = new ConcurrentHashMap<>();

    void accept(T event) {
        BucketKey key = bucket(event); // table + partition + shard perhaps
        List<T> buffer = buffers.computeIfAbsent(key, ignored -> new ArrayList<>());
        synchronized (buffer) {
            buffer.add(event);
            if (buffer.size() >= maxRows) {
                flush(key, buffer);
            }
        }
    }

    void scheduledFlush() {
        for (var entry : buffers.entrySet()) {
            if (isOldEnough(entry.getKey())) {
                synchronized (entry.getValue()) {
                    flush(entry.getKey(), entry.getValue());
                }
            }
        }
    }
}
```

Dalam implementasi nyata, kamu harus memperhatikan:

- bounded queue,
- backpressure,
- retry,
- poison data,
- schema validation,
- metrics,
- shutdown flush,
- idempotency,
- dead-letter handling,
- memory cap per tenant/source.

---

## 7. Mutations: Update/Delete sebagai Rewrite

### 7.1 Kenapa Mutation Mahal?

ClickHouse adalah append-optimized columnar OLAP database. Kalau kamu melakukan:

```sql
ALTER TABLE events UPDATE status = 'closed' WHERE case_id = 'C-123';
```

jangan bayangkan ClickHouse menemukan satu row lalu mengubah field di tempat.

Lebih tepat:

```text
find affected parts
rewrite affected column/data segments
produce new mutated parts
mark old parts inactive
```

Mutation adalah background operation yang dapat memakan resource besar.

### 7.2 Mutation Berbeda dari OLTP Update

Di OLTP:

```text
update one row by primary key
lock/MVCC row/page
write WAL
update index if needed
commit
```

Di ClickHouse:

```text
identify affected parts
schedule mutation
rewrite data at part level
mutation completes later
queries may need to account for mutation state
```

Konsekuensi:

- mutation tidak cocok untuk high-frequency per-row updates,
- mutation bisa backlog,
- mutation bisa bersaing dengan merges,
- mutation bisa menyebabkan disk/CPU pressure,
- mutation bisa memperlambat query/insert.

### 7.3 Kapan Mutation Masuk Akal?

Mutation bisa masuk akal untuk:

- correction batch periodik,
- data deletion karena compliance,
- fixing bad dimension value pada subset terbatas,
- administrative cleanup,
- rare update pada historical data,
- low-frequency controlled maintenance.

Mutation buruk untuk:

- status yang berubah setiap detik,
- per-event enrichment yang datang terlambat dan mengupdate row satu-satu,
- transactional workflow state utama,
- real-time mutable entity store,
- queue processing state.

Kalau data sering berubah, pertimbangkan model append:

```text
case_state_changed event
case_status_snapshot periodic table
ReplacingMergeTree latest-state table
materialized aggregate
```

Bukan mutation row-by-row.

### 7.4 Mutation Storm

Mutation storm terjadi ketika terlalu banyak mutation dijalankan, misalnya:

```sql
ALTER TABLE events UPDATE ... WHERE id = '1';
ALTER TABLE events UPDATE ... WHERE id = '2';
ALTER TABLE events UPDATE ... WHERE id = '3';
...
```

Ini sangat buruk.

Lebih baik batch:

```sql
ALTER TABLE events UPDATE flag = 1 WHERE id IN (...large controlled set...);
```

Atau gunakan staging table dan rebuild/insert-select pattern.

### 7.5 Lightweight Deletes

ClickHouse juga mendukung lightweight delete untuk `MergeTree` tables. Secara mental, ini lebih murah daripada delete mutation berat karena row ditandai deleted dan data fisik dibersihkan kemudian melalui merge.

Namun jangan salah:

- lightweight delete bukan berarti free,
- data tidak selalu langsung hilang dari disk,
- query semantics harus tetap diperhatikan,
- large delete tetap bisa mahal,
- cleanup fisik tetap bergantung pada merge.

Untuk compliance deletion, kamu perlu memahami perbedaan antara:

```text
logical deletion visibility
physical data removal
backup retention
replica propagation
object storage lifecycle
```

Dalam sistem regulasi, ini penting. “Data tidak muncul di query” belum tentu sama dengan “data sudah hilang secara fisik dari semua media”.

---

## 8. TTL: Retention, Movement, Recompression, and Rollup

### 8.1 Apa Itu TTL di ClickHouse?

TTL adalah mekanisme time-based lifecycle untuk data atau column. TTL dapat digunakan untuk:

- menghapus row setelah waktu tertentu,
- menghapus/mengubah nilai column,
- memindahkan data ke volume/storage lain,
- melakukan rollup/agregasi data lama,
- recompress data lama dengan codec berbeda.

Contoh retention sederhana:

```sql
CREATE TABLE events
(
    event_time DateTime,
    tenant_id String,
    event_type LowCardinality(String),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type)
TTL event_time + INTERVAL 180 DAY DELETE;
```

Artinya data lebih tua dari 180 hari eligible untuk delete.

### 8.2 TTL Tidak Selalu Terjadi Seketika

Ini poin penting.

TTL biasanya dieksekusi saat merge. Jadi ketika TTL expired, data tidak selalu langsung hilang pada detik itu juga.

Mental model:

```text
data expires
  ↓
part becomes eligible for TTL action
  ↓
background merge/TTL merge happens
  ↓
new part written without expired rows / with moved/rolled up data
```

Kalau merge backlog tinggi, TTL bisa terlihat terlambat.

Jangan desain compliance SLA dengan asumsi TTL selalu instant kecuali kamu sudah memahami dan menguji mekanisme cleanup end-to-end.

### 8.3 Row TTL

Row TTL menghapus rows setelah waktu tertentu.

Pattern umum:

```sql
TTL event_time + INTERVAL 90 DAY DELETE
```

Cocok untuk:

- logs,
- raw events,
- temporary analytics data,
- staging tables,
- observability data.

### 8.4 Column TTL

Column TTL menghapus/mengganti nilai column setelah waktu tertentu.

Contoh konsep:

```sql
sensitive_payload String TTL event_time + INTERVAL 30 DAY
```

Berguna untuk:

- menghapus PII lebih cepat daripada event metadata,
- menurunkan data sensitivity,
- menjaga aggregate analytics tanpa raw detail sensitif.

Namun perlu validasi terhadap requirement compliance karena data lama mungkin masih ada dalam backup, replicated part, atau object storage lifecycle.

### 8.5 Move TTL

Move TTL memindahkan data ke storage tier lain.

Contoh konsep:

```sql
TTL event_time + INTERVAL 30 DAY TO VOLUME 'cold'
```

Cocok untuk hot/cold storage:

```text
0-30 hari: fast local SSD
30-365 hari: cheaper storage
>365 hari: delete/archive
```

### 8.6 Rollup TTL

TTL juga dapat digunakan untuk rollup data lama. Misalnya raw per-event detail disimpan 30 hari, lalu data lebih lama disimpan sebagai aggregate harian.

Mental model:

```text
raw rows
  ↓ after 30 days
aggregate by tenant/day/event_type
  ↓
keep aggregate, drop detail
```

Namun rollup TTL harus didesain hati-hati:

- aggregate harus associative/mergeable,
- query layer harus sadar resolusi data,
- late event correction sulit,
- auditability raw detail hilang,
- regulatory reporting mungkin membutuhkan raw evidence.

Untuk sistem enforcement/case management, jangan sembarangan rollup raw audit trail jika raw event adalah bukti proses.

### 8.7 TTL dan Partition

Kalau partition selaras dengan retention, penghapusan data bisa lebih efisien.

Contoh:

```sql
PARTITION BY toYYYYMM(event_time)
TTL event_time + INTERVAL 12 MONTH DELETE
```

Jika seluruh partition expired, drop partition bisa jauh lebih murah daripada row-level TTL cleanup.

Namun jangan membuat partition terlalu kecil hanya agar TTL presisi. Trade-off:

```text
partition terlalu besar → deletion kurang presisi tapi merge lebih sehat
partition terlalu kecil → part explosion / metadata overhead
```

---

## 9. OPTIMIZE FINAL: Pisau Tajam yang Sering Disalahgunakan

### 9.1 Apa Itu OPTIMIZE FINAL?

Secara sederhana:

```sql
OPTIMIZE TABLE table_name FINAL;
```

memaksa ClickHouse menggabungkan parts menjadi part final, melewati heuristik merge normal.

Ini dapat berguna dalam kasus tertentu, misalnya:

- setelah bulk load besar yang sudah selesai,
- sebelum freeze/backup tertentu,
- untuk testing/benchmark terbatas,
- untuk memaksa deduplication pada ReplacingMergeTree dalam maintenance window,
- pada partition spesifik yang ukurannya terkendali.

Namun ini sering berbahaya di produksi.

### 9.2 Kenapa Berbahaya?

`OPTIMIZE FINAL` dapat:

- memaksa merge part sangat besar,
- mengonsumsi CPU besar,
- mengonsumsi disk I/O besar,
- menghasilkan temporary disk usage besar,
- mengganggu query dan insert,
- melewati batas/heuristik merge normal,
- membuat operasi berjalan lama,
- memperparah backlog kalau dilakukan terlalu sering.

Dokumentasi ClickHouse bahkan memiliki best practice khusus yang menyarankan menghindari `OPTIMIZE FINAL` secara umum, karena command ini memaksa ClickHouse merge semua active parts menjadi satu part meskipun merge besar sebelumnya sudah terjadi.

### 9.3 FINAL vs OPTIMIZE FINAL

Jangan mencampuradukkan:

```sql
SELECT ... FINAL
```

versus:

```sql
OPTIMIZE TABLE ... FINAL
```

Secara mental:

```text
SELECT FINAL
  → query-time behavior, baca data dengan semantic final tertentu

OPTIMIZE FINAL
  → physical storage operation, merge/reorganize data on disk
```

Keduanya bisa mahal, tetapi jenis mahalnya berbeda.

### 9.4 Kapan Boleh?

Lebih aman jika:

- hanya untuk partition tertentu,
- ukuran partition diketahui,
- dilakukan saat maintenance window,
- disk free cukup,
- query load rendah,
- replication lag dipantau,
- mutation/merge queue sehat,
- ada rollback/retry plan.

Contoh lebih terbatas:

```sql
OPTIMIZE TABLE events PARTITION '202606' FINAL;
```

Tetap harus hati-hati.

### 9.5 Red Flag

Kalau kamu merasa perlu menjalankan `OPTIMIZE FINAL` setiap jam agar query cepat, kemungkinan desain ingestion/schema bermasalah.

Kemungkinan penyebab:

- insert terlalu kecil,
- partition terlalu granular,
- ReplacingMergeTree dipakai sebagai OLTP update store,
- query layer bergantung pada dedup final terlalu sering,
- materialized aggregate salah desain,
- background merges tidak mampu mengejar write rate.

---

## 10. System Tables untuk Diagnosis

ClickHouse menyediakan system tables untuk melihat kondisi internal. Di part ini kita fokus pada beberapa tabel penting.

### 10.1 `system.parts`

Gunakan untuk melihat active parts.

Contoh:

```sql
SELECT
    database,
    table,
    partition,
    count() AS active_parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE active
GROUP BY database, table, partition
ORDER BY active_parts DESC
LIMIT 20;
```

Yang dicari:

- partition dengan part count tinggi,
- table dengan terlalu banyak active parts,
- ukuran part terlalu kecil,
- distribusi rows/bytes tidak wajar.

### 10.2 Rata-rata Ukuran Part

```sql
SELECT
    database,
    table,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS total_size,
    formatReadableSize(sum(bytes_on_disk) / count()) AS avg_part_size
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY parts DESC;
```

Part count tinggi + avg part size kecil biasanya tanda small insert/over-partitioning.

### 10.3 `system.merges`

Melihat merge yang sedang berjalan:

```sql
SELECT
    database,
    table,
    partition_id,
    elapsed,
    progress,
    num_parts,
    formatReadableSize(total_size_bytes_compressed) AS compressed_size
FROM system.merges
ORDER BY elapsed DESC;
```

Yang dicari:

- merge sangat lama,
- banyak merge aktif,
- progress lambat,
- table tertentu mendominasi background work.

### 10.4 `system.mutations`

Melihat mutation queue:

```sql
SELECT
    database,
    table,
    mutation_id,
    command,
    create_time,
    is_done,
    latest_failed_part,
    latest_fail_reason
FROM system.mutations
WHERE is_done = 0
ORDER BY create_time;
```

Yang dicari:

- mutation tidak selesai,
- mutation gagal,
- mutation lama,
- banyak mutation pada table yang sama,
- latest failure reason.

### 10.5 Query Log untuk Melihat Efeknya

```sql
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    memory_usage,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 1 HOUR
ORDER BY query_duration_ms DESC
LIMIT 20;
```

Part explosion sering tampak sebagai query yang membaca tidak terlalu banyak bytes tetapi latency tetap tinggi karena overhead metadata/part traversal.

---

## 11. Failure Modes Penting

### 11.1 Failure Mode: Too Many Small Inserts

#### Gejala

- active parts naik terus,
- insert mulai lambat,
- `Too many parts` muncul,
- query latency naik,
- background merges selalu sibuk.

#### Penyebab

- aplikasi insert row-by-row,
- batch terlalu kecil,
- terlalu banyak producer langsung ke ClickHouse.

#### Solusi

- batch insert,
- async insert jika sesuai,
- ingestion service,
- buffer per partition/shard,
- reduce insert frequency,
- monitor active parts.

### 11.2 Failure Mode: Over-Partitioning

#### Gejala

- banyak partition dengan sedikit rows,
- merge tidak efektif,
- part count tersebar luas,
- metadata overhead tinggi.

#### Penyebab

- partition by tenant,
- partition by hour untuk volume rendah,
- partition by high-cardinality field,
- partition untuk query filtering, bukan lifecycle.

#### Solusi

- gunakan monthly/daily partition,
- pindahkan tenant ke `ORDER BY`, bukan `PARTITION BY`,
- desain partition berdasarkan retention/drop/backfill boundary.

### 11.3 Failure Mode: Mutation Storm

#### Gejala

- `system.mutations` banyak pending,
- CPU/disk tinggi,
- merges lambat,
- query lambat,
- replication lag.

#### Penyebab

- update/delete per row,
- data correction terlalu sering,
- ClickHouse dipakai sebagai mutable operational store.

#### Solusi

- append correction events,
- batch mutation,
- rebuild partition/table,
- use ReplacingMergeTree carefully,
- pisahkan current-state store dari analytical store.

### 11.4 Failure Mode: TTL Tidak Sesuai Ekspektasi

#### Gejala

- data expired masih ada di disk,
- storage tidak turun sesuai jadwal,
- compliance team mengira data sudah hilang,
- old partitions tetap besar.

#### Penyebab

- TTL menunggu merge,
- merge backlog,
- partition terlalu besar,
- object storage/backup lifecycle tidak sinkron,
- TTL rule salah.

#### Solusi

- pahami TTL execution timing,
- monitor expired data,
- gunakan partition drop untuk lifecycle besar,
- align backup retention,
- dokumentasikan logical vs physical deletion.

### 11.5 Failure Mode: OPTIMIZE FINAL sebagai Crutch

#### Gejala

- job optimize rutin berat,
- cluster spike saat optimize,
- query bergantung pada optimize,
- maintenance window sering gagal.

#### Penyebab

- salah memahami merge,
- ReplacingMergeTree dipakai tanpa desain query benar,
- terlalu banyak small parts,
- ingestion buruk.

#### Solusi

- perbaiki batching,
- perbaiki partition,
- desain aggregate/serving table,
- optimize hanya partition tertentu dan jarang,
- ukur sebelum/sesudah.

---

## 12. Design Pattern untuk Workload Nyata

### 12.1 Raw Event Table dengan Retention

```sql
CREATE TABLE case_events_raw
(
    event_time DateTime64(3),
    ingestion_time DateTime64(3) DEFAULT now64(3),
    tenant_id String,
    case_id String,
    event_type LowCardinality(String),
    actor_type LowCardinality(String),
    actor_id String,
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_type, case_id)
TTL event_time + INTERVAL 365 DAY DELETE;
```

Desain ini masuk akal jika:

- retention raw 365 hari,
- query umum per tenant dan time range,
- event_type sering difilter,
- case_id dipakai drilldown setelah tenant/time.

Risiko:

- payload String besar menambah storage,
- query by case_id tanpa tenant/time bisa tidak optimal,
- deletion compliance per user/case tidak instant.

### 12.2 Current State via Append + ReplacingMergeTree

Daripada update raw event:

```text
case opened
case assigned
case escalated
case resolved
```

buat table state turunan:

```sql
CREATE TABLE case_current_state
(
    tenant_id String,
    case_id String,
    version UInt64,
    updated_at DateTime64(3),
    status LowCardinality(String),
    severity LowCardinality(String),
    owner_id String
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(updated_at)
ORDER BY (tenant_id, case_id);
```

Catatan:

- ReplacingMergeTree dedup terjadi saat merge.
- Query yang butuh semantic latest harus memahami `FINAL` atau argMax-style aggregate/serving model.
- Jangan jadikan ini pengganti OLTP store utama.

### 12.3 Backfill Strategy

Saat backfill historical data:

1. Load data per partition.
2. Gunakan batch besar.
3. Hindari concurrent small inserts ke partition yang sama.
4. Validate row count/checksum.
5. Build/refresh materialized target jika perlu.
6. Jangan langsung `OPTIMIZE FINAL` semua table.
7. Kalau perlu optimize, lakukan per partition dan ukur impact.

### 12.4 Regulatory Retention Pattern

Untuk data sensitif:

```text
raw_sensitive_events: 90 hari
raw_redacted_events: 365 hari
aggregate_reporting: 7 tahun
case_audit_evidence: sesuai aturan legal hold
```

ClickHouse TTL dapat membantu, tetapi desain compliance harus mencakup:

- logical query deletion,
- physical storage deletion,
- backup deletion,
- replica deletion,
- export/cache deletion,
- legal hold exception,
- audit proof.

---

## 13. How to Think Like a Production Engineer

### 13.1 Jangan Tanya “Bisa Insert Berapa Cepat?” Saja

Pertanyaan yang lebih benar:

1. Berapa rows per second?
2. Berapa bytes per second?
3. Berapa insert statements per second?
4. Berapa average rows per insert?
5. Berapa target partitions per insert?
6. Berapa shards?
7. Berapa replicas?
8. Berapa merge backlog acceptable?
9. Berapa freshness SLA?
10. Apa query concurrency saat ingestion peak?

### 13.2 Jangan Tanya “Bisa Update?” Saja

Pertanyaan yang lebih benar:

1. Update berapa persen data?
2. Seberapa sering?
3. Update berdasarkan key atau predicate luas?
4. Apakah update harus visible segera?
5. Apakah historical truth harus dipertahankan?
6. Apakah append correction lebih cocok?
7. Apakah current state sebaiknya di table terpisah?
8. Apakah OLTP store tetap menjadi source of truth?

### 13.3 Jangan Tanya “TTL Bisa Delete Data?” Saja

Pertanyaan yang lebih benar:

1. Apakah delete harus query-invisible atau physically removed?
2. Seberapa cepat harus hilang?
3. Apakah data ada di backup?
4. Apakah data direplikasi?
5. Apakah data masuk materialized aggregate?
6. Apakah ada legal hold?
7. Apakah partition drop lebih sesuai?

---

## 14. Practical Heuristics

Ini bukan angka absolut, tetapi rule-of-thumb untuk berpikir.

### 14.1 Insert

```text
Prefer batch inserts.
Avoid row-by-row inserts.
Avoid too many concurrent tiny producers.
Track rows per insert, bytes per insert, inserts per second.
```

### 14.2 Partition

```text
Partition by lifecycle boundary.
Commonly month/day for time-series/event data.
Avoid high-cardinality partition keys.
Avoid tenant partition unless tenant count small and volume large per tenant.
```

### 14.3 Parts

```text
Monitor active parts per table/partition.
Small average part size is a smell.
Rising part count means merge debt.
```

### 14.4 Mutations

```text
Batch corrections.
Avoid per-row mutation.
Prefer append event model for changing facts.
Use current-state table patterns carefully.
```

### 14.5 TTL

```text
TTL is lifecycle automation, not instant deletion guarantee.
Align TTL with partitions when possible.
Test physical cleanup timing.
```

### 14.6 OPTIMIZE FINAL

```text
Do not use as routine performance fix.
Use only with bounded scope and measured need.
Prefer fixing ingestion/partition/schema first.
```

---

## 15. Example: Diagnosing a Production Incident

### 15.1 Symptom

Dashboard latency jumps from 300 ms to 8 seconds. Insert latency also increases. No obvious query change.

### 15.2 First Hypothesis

Maybe query got worse?

But OLAP production diagnosis should also ask:

- Did ingestion pattern change?
- Did part count spike?
- Did merge backlog increase?
- Did mutation queue appear?
- Did TTL trigger massive cleanup?
- Did backfill start?

### 15.3 Investigation

Check active parts:

```sql
SELECT
    table,
    partition,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE database = 'analytics'
  AND active
GROUP BY table, partition
ORDER BY parts DESC
LIMIT 20;
```

Result:

```text
case_events_raw | 202606 | 18400 parts | 900M rows | 520 GB
```

Check merges:

```sql
SELECT table, partition_id, elapsed, progress, num_parts
FROM system.merges
ORDER BY elapsed DESC;
```

Result shows merges constantly running.

Check ingestion deploy:

```text
new service version changed batch flush from 50,000 rows to 500 rows
```

### 15.4 Root Cause

Part explosion due to smaller batch size.

### 15.5 Fix

Immediate:

- reduce ingestion rate or restore old batch size,
- pause non-critical backfill,
- allow merges to catch up,
- avoid manual `OPTIMIZE FINAL` unless carefully scoped.

Long-term:

- enforce min batch size in ingestion library,
- expose metrics rows/insert and inserts/sec,
- add alert on active parts per partition,
- add canary for ingestion changes,
- document ClickHouse write contract.

---

## 16. Java Engineering Perspective

### 16.1 ClickHouse Write Contract Should Be an Interface

Instead of every service writing directly:

```java
public interface AnalyticsEventSink {
    void publish(AnalyticsEvent event);
    void publishBatch(List<AnalyticsEvent> events);
}
```

The implementation can enforce:

- batching,
- schema validation,
- partition-aware buffering,
- retry,
- backpressure,
- metrics,
- dead-letter routing.

### 16.2 Expose the Right Metrics

At ingestion layer:

```text
analytics_insert_rows_total
analytics_insert_batches_total
analytics_insert_rows_per_batch
analytics_insert_bytes_per_batch
analytics_insert_latency_ms
analytics_insert_failures_total
analytics_insert_retry_total
analytics_buffer_size
analytics_flush_reason{reason=size|time|shutdown}
```

At ClickHouse level:

```text
active parts per table/partition
merge queue size
mutation queue size
query latency
read rows/read bytes
insert latency
replica lag
disk free
```

### 16.3 Backpressure Is a Feature

If ClickHouse is under merge pressure, ingestion should not blindly continue.

Options:

- slow producers,
- buffer in queue,
- shed low-priority analytics,
- route to object storage for later batch load,
- pause backfill,
- reduce dashboard concurrency.

In analytics systems, dropping or delaying non-critical telemetry may be better than taking down the entire cluster.

### 16.4 Idempotency Matters

When retrying batch insert, duplicate data is possible unless you design for it.

Strategies:

- deterministic event_id,
- deduplication window/settings where appropriate,
- ReplacingMergeTree for certain targets,
- staging table + controlled insert-select,
- exactly-once not assumed blindly,
- reconciliation jobs.

We will go deeper into ingestion in Part 010 and Part 011.

---

## 17. Anti-Patterns

### Anti-Pattern 1: Treating ClickHouse Like PostgreSQL

```text
one row insert
one row update
one row delete
transactional semantics expectation
```

Better:

```text
batch append
immutable events
periodic correction
serving aggregates
append-derived latest state
```

### Anti-Pattern 2: Partition by Tenant for Many Tenants

Bad if tenant count is large and each tenant has small/medium volume.

Better:

```sql
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, ...)
```

### Anti-Pattern 3: Running OPTIMIZE FINAL as Cron

Bad:

```text
every hour: OPTIMIZE TABLE events FINAL
```

Better:

```text
fix ingestion batching
monitor parts
optimize only bounded partition if truly needed
```

### Anti-Pattern 4: Row-Level Mutation for State Changes

Bad:

```sql
ALTER TABLE case_events UPDATE status = 'closed' WHERE case_id = 'C-123';
```

Better:

```text
append case_status_changed event
maintain current-state projection/table
query latest state using proper model
```

### Anti-Pattern 5: TTL as Compliance Silver Bullet

Bad assumption:

```text
TTL expired = data physically gone everywhere
```

Better:

```text
TTL query behavior + merge behavior + replica + backup + exports + legal hold policy
```

---

## 18. Exercises

### Exercise 1: Diagnose Insert Pattern

You have:

```text
100,000 events/sec
20 shards
client flushes every 1,000 rows
```

Question:

- How many rows per shard per batch on average?
- Is that likely healthy?
- What metrics would you inspect?
- How would you redesign batching?

### Exercise 2: Partition Design

Data:

```text
10,000 tenants
500M events/day
retention 13 months
common queries: tenant + last 7 days, tenant + month, global daily report
```

Compare:

```sql
PARTITION BY tenant_id
PARTITION BY toYYYYMM(event_time)
PARTITION BY (tenant_id, toYYYYMM(event_time))
PARTITION BY toYYYYMMDD(event_time)
```

Which one is safest and why?

### Exercise 3: Mutation Alternative

Requirement:

```text
Case status changes frequently.
Dashboard needs current status counts by tenant and severity.
Historical transitions must remain auditable.
```

Design:

- raw event table,
- current state table,
- aggregate table,
- correction strategy.

Avoid using row-by-row mutation as primary mechanism.

### Exercise 4: TTL Design

Requirement:

```text
Raw logs: 30 days
Aggregated hourly metrics: 1 year
Aggregated daily metrics: 7 years
PII fields: 14 days
Legal hold possible for selected case_ids
```

Question:

- Which data should be in separate tables?
- Which TTL rules are safe?
- What cannot be solved by TTL alone?

---

## 19. Production Checklist

Before production ingestion:

- [ ] Insert batch size defined.
- [ ] Insert frequency bounded.
- [ ] Direct writes from many services avoided or controlled.
- [ ] Partition key reviewed as lifecycle boundary.
- [ ] Sort key reviewed as access path.
- [ ] Active part alerts configured.
- [ ] Merge monitoring configured.
- [ ] Mutation monitoring configured.
- [ ] TTL behavior tested.
- [ ] Backfill strategy documented.
- [ ] `OPTIMIZE FINAL` policy documented.
- [ ] Retry/idempotency strategy defined.
- [ ] Backpressure behavior defined.
- [ ] Disk free threshold alert configured.
- [ ] Compliance deletion semantics documented.

---

## 20. Key Takeaways

1. ClickHouse writes data as immutable parts.
2. Background merges are essential, not optional.
3. Small inserts create many small parts.
4. Too many parts degrade query/insert performance and can trigger errors.
5. Partitioning affects merge behavior because parts from different partitions are not merged.
6. Partition should usually represent lifecycle boundary, not query index.
7. Mutations rewrite affected data and are not OLTP-style updates.
8. TTL usually executes through merge behavior and should not be assumed instant.
9. `OPTIMIZE FINAL` is powerful but dangerous as routine maintenance.
10. Stable ClickHouse systems require ingestion discipline, not just query tuning.

---

## 21. What Comes Next

Part 006 akan membahas:

# Schema Design for ClickHouse: Physical Design Before Logical Beauty

Kita akan masuk ke:

- kenapa schema design ClickHouse berbeda dari normalized OLTP design,
- wide table vs star schema,
- denormalization sebagai strategi performa,
- `LowCardinality`, `Nullable`, `Enum`, `String`, `DateTime64`, `Decimal`, `Array`, `Map`, `Tuple`, `Nested`, dan JSON,
- materialized/default/alias columns,
- schema evolution,
- dan bagaimana membuat schema yang queryable, compressible, evolvable, dan operationally safe.

---

## 22. Status Seri

Seri belum selesai.

Progress saat ini:

```text
[selesai] Part 000 — Orientation: Why OLAP Is a Different Engineering Discipline
[selesai] Part 001 — OLAP Workload Anatomy: Queries, Facts, Dimensions, Events, and Metrics
[selesai] Part 002 — Columnar Storage Mental Model: From Rows to Columns to Compressed Blocks
[selesai] Part 003 — ClickHouse Architecture Overview: Server, Tables, Parts, Blocks, and Pipelines
[selesai] Part 004 — MergeTree Internals I: Parts, Granules, Marks, Primary Index, and Sorting Key
[selesai] Part 005 — MergeTree Internals II: Background Merges, Mutations, TTL, and Part Explosion
[berikutnya] Part 006 — Schema Design for ClickHouse: Physical Design Before Logical Beauty
```

Total rencana seri: `35 part`, dari `part-000` sampai `part-034`.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — MergeTree Internals I: Parts, Granules, Marks, Primary Index, and Sorting Key</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-006.md">Part 006 — Schema Design for ClickHouse: Physical Design Before Logical Beauty ➡️</a>
</div>
