# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-010.md

# Part 010 — Ingestion Architecture I: Inserts, Batching, Idempotency, and Backpressure

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **010 / 034**  
> Fokus: membangun mental model dan desain ingestion dari aplikasi/backend ke ClickHouse tanpa merusak performa storage engine.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- Part 000: kenapa OLAP adalah disiplin engineering yang berbeda.
- Part 001: bentuk workload OLAP: events, facts, dimensions, metrics.
- Part 002: mental model columnar storage.
- Part 003: arsitektur ClickHouse: server, tables, parts, blocks, pipelines.
- Part 004: MergeTree internals: parts, granules, marks, sparse primary index, sorting key.
- Part 005: background merges, mutations, TTL, dan part explosion.
- Part 006: schema design.
- Part 007: sorting key design.
- Part 008: partitioning strategy.
- Part 009: data types, compression, encoding, dan storage cost.

Sekarang kita masuk ke jalur data masuk: **ingestion architecture**.

Ini adalah salah satu bagian paling penting dalam penggunaan ClickHouse di sistem produksi. Banyak tim merasa query mereka lambat, merge queue menumpuk, disk I/O tinggi, atau muncul error `Too many parts`. Akar masalahnya sering bukan query atau hardware, melainkan pola ingest yang tidak sesuai dengan cara MergeTree bekerja.

ClickHouse sangat cepat untuk analytical reads, tetapi performanya mengandalkan asumsi bahwa data ditulis sebagai batch yang masuk akal, disusun menjadi parts, lalu digabung oleh background merges. Jika aplikasi mengirim row satu per satu, setiap detik dari banyak service instance, ke banyak partition berbeda, maka ClickHouse akan dipaksa mengelola terlalu banyak part kecil.

Di part ini kita tidak membahas Kafka secara umum, CDC secara dalam, atau object-storage batch load. Itu akan masuk part 011. Fokus part ini adalah **langsung dari aplikasi/Java service ke ClickHouse**: insert, batching, retry, idempotency, deduplication, backpressure, dan failure modeling.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus mampu:

1. Menjelaskan apa yang terjadi saat data di-insert ke ClickHouse.
2. Mendesain strategi batching yang aman untuk MergeTree.
3. Memilih antara synchronous insert, asynchronous insert, HTTP insert, native/client API, dan JDBC secara rasional.
4. Membedakan throughput problem, latency problem, dan correctness problem pada ingestion.
5. Mendesain retry yang tidak menciptakan duplicate data tanpa sadar.
6. Memahami idempotency di ClickHouse secara praktis.
7. Membangun backpressure dari aplikasi Java agar ClickHouse tidak menjadi korban overload.
8. Menghindari anti-pattern seperti row-by-row insert, tiny inserts, partition-spraying, dan blind retry.
9. Membuat ingestion contract yang cocok untuk OLAP, bukan meniru persistence layer OLTP.
10. Menyiapkan fondasi untuk part berikutnya: streaming, CDC, batch loads, dan object storage ingestion.

---

## 2. Premis Utama: ClickHouse Bukan Tempat untuk Row-by-Row Transactional Writes

Di OLTP database, aplikasi sering melakukan:

```sql
INSERT INTO orders (...) VALUES (...);
UPDATE orders SET status = ... WHERE id = ...;
COMMIT;
```

Mental modelnya:

- satu request bisnis,
- satu transaksi,
- satu atau beberapa row,
- correctness langsung,
- index langsung ter-update,
- row dapat dicari by primary key.

ClickHouse berbeda.

ClickHouse lebih cocok untuk pola:

```text
collect many events
  -> batch them
  -> send to ClickHouse
  -> ClickHouse writes a compressed columnar block
  -> background merges optimize storage over time
  -> analytical query scans compressed columns efficiently
```

Artinya:

- insert individual row bukan sweet spot,
- batch lebih penting daripada transactional granularity,
- ingestion path harus mempertimbangkan downstream merge cost,
- retry harus mempertimbangkan duplicate events,
- freshness harus diseimbangkan dengan part count,
- data biasanya append-oriented.

### 2.1 Kalimat Penting

> Di ClickHouse, pertanyaan ingestion bukan “bagaimana saya menulis row secepat mungkin?”, tetapi “bagaimana saya mengubah event stream menjadi block columnar yang cukup besar, cukup stabil, dan bisa di-merge murah?”

---

## 3. Insert Path Mental Model

Mari kita ulang insert path dari part 003 dan 005, tetapi sekarang dari sisi aplikasi.

Ketika aplikasi mengirim insert ke table MergeTree:

```text
Java service
  -> client/driver serializes rows
  -> ClickHouse receives INSERT
  -> data parsed into internal Block
  -> expressions/default/materialized columns evaluated
  -> data sorted according to ORDER BY within affected partition
  -> column files written as a new data part
  -> part becomes visible
  -> background merges later combine parts
```

Sederhananya:

```text
INSERT query => one or more blocks => one or more parts
```

Tidak selalu satu insert persis satu part, karena ClickHouse dapat memecah block besar, dan async insert dapat menggabungkan banyak insert kecil. Namun secara praktis, terlalu banyak insert kecil cenderung menghasilkan terlalu banyak part kecil.

### 3.1 Mengapa Small Inserts Buruk?

Small insert bukan hanya overhead network.

Small insert menciptakan masalah berlapis:

1. **Query overhead**  
   Query harus mempertimbangkan banyak part kecil.

2. **Merge overhead**  
   Background merges harus menggabungkan part kecil menjadi part besar.

3. **Metadata overhead**  
   Setiap part membawa metadata, checksums, marks, primary index, column files.

4. **File system overhead**  
   Banyak file kecil memperberat operasi disk.

5. **Replication overhead**  
   Jika replicated table, part kecil juga masuk replication queue.

6. **TTL/mutation overhead**  
   TTL dan mutation harus bekerja pada banyak part.

7. **Operational instability**  
   Merge queue dapat tertinggal; insert baru mulai ditolak atau melambat.

### 3.2 Analogi untuk Java Engineer

Bayangkan kamu menulis log ke file:

- buruk: buka file, tulis 1 byte, flush, close, ulangi jutaan kali,
- baik: buffer data, tulis batch besar, flush terkendali.

Atau dalam network programming:

- buruk: kirim satu TCP packet kecil untuk setiap field,
- baik: framing dan batching.

ClickHouse ingestion juga seperti itu. Ia bukan tidak bisa menerima insert kecil, tetapi sistem akan lebih sehat jika input sudah dibentuk sebagai batch.

---

## 4. Tiga Axis Ingestion: Throughput, Freshness, Correctness

Setiap desain ingestion ClickHouse adalah trade-off antara tiga hal:

```text
throughput  <->  freshness  <->  correctness / retry safety
```

### 4.1 Throughput

Throughput bertanya:

- berapa rows per second?
- berapa MB/s?
- berapa insert queries per second?
- berapa table/partition/shard yang disentuh?
- berapa compression/decompression cost?

ClickHouse bisa menerima volume sangat besar, tetapi pola insert menentukan apakah volume tersebut sehat.

### 4.2 Freshness

Freshness bertanya:

- seberapa cepat event harus queryable?
- 100 ms?
- 1 detik?
- 10 detik?
- 1 menit?
- 5 menit?

Semakin rendah freshness latency, semakin kecil batch alami yang bisa dikumpulkan client, kecuali ada server-side async batching.

### 4.3 Correctness

Correctness bertanya:

- apakah duplicate event dapat diterima?
- apakah missing event fatal?
- apakah order event penting?
- apakah retry aman?
- apakah insert partial mungkin?
- bagaimana membedakan event baru dari retry event lama?

OLAP sering menerima eventual correctness, tetapi tidak berarti boleh sembarangan. Dashboard bisnis, regulatory reporting, audit analytics, fraud detection, dan billing analytics punya toleransi berbeda.

### 4.4 Trade-off Praktis

| Kebutuhan | Konsekuensi Ingestion |
|---|---|
| Freshness sangat rendah | batch kecil atau async insert |
| Throughput sangat tinggi | batch besar, compression efisien, format column-friendly |
| Retry harus aman | idempotency key/deduplication/event ID strategy |
| No duplicates allowed | desain lebih mahal, perlu dedup model |
| Backfill besar | jalur batch terpisah dari live ingest |
| Multi-tenant high volume | batching per table/partition/shard harus dikontrol |

---

## 5. Insert Strategy Spectrum

Ada beberapa strategi umum untuk memasukkan data ke ClickHouse.

```text
1. Direct synchronous insert from app
2. Client-side batched insert
3. Server-side asynchronous insert
4. Buffered ingestion service
5. Queue/stream-backed ingestion
6. Batch file/object storage load
```

Part ini fokus pada 1 sampai 4.

### 5.1 Direct Synchronous Insert

Aplikasi langsung mengirim insert dan menunggu response.

```text
request handler
  -> build row
  -> INSERT into ClickHouse
  -> wait success/failure
  -> return response
```

Biasanya ini hanya cocok untuk:

- volume rendah,
- internal tools,
- admin-triggered event,
- prototype,
- ingestion yang sudah batch.

Tidak cocok untuk:

- setiap user action langsung insert 1 row,
- high-QPS API,
- banyak service instance,
- strict request latency,
- event observability/logging volume besar.

### 5.2 Client-Side Batched Insert

Aplikasi mengumpulkan rows dalam buffer, lalu mengirim batch.

```text
many events
  -> in-memory buffer
  -> flush by size/time
  -> one INSERT with many rows
```

Ini biasanya strategi default yang sehat.

Flush trigger umum:

- max rows,
- max bytes,
- max age,
- shutdown flush,
- memory pressure,
- partition/shard route change.

Contoh:

```text
flush when:
  rows >= 50_000
  OR bytes >= 10 MB
  OR oldest_event_age >= 2 seconds
```

Angka tepat harus diuji, bukan dihafal. Tetapi prinsipnya jelas: hindari insert per row.

### 5.3 Server-Side Asynchronous Insert

Async insert memindahkan sebagian tanggung jawab batching ke server ClickHouse.

Aplikasi mengirim insert kecil, tetapi ClickHouse menaruh data di memory buffer dan flush menjadi batch lebih besar berdasarkan kondisi tertentu.

Mental model:

```text
many small client inserts
  -> ClickHouse async insert buffer
  -> flush by size/time/query-count
  -> storage part
```

Async insert berguna ketika client-side batching sulit, misalnya:

- banyak producer kecil,
- observability events,
- serverless/lambda-style producers,
- edge ingestion,
- low-latency app path yang tidak bisa menahan buffer besar.

Namun async insert bukan magic. Risiko yang tetap perlu dipahami:

- data berada sementara di memory buffer,
- konfigurasi `wait_for_async_insert` memengaruhi reliability semantics,
- terlalu banyak unique insert shapes/settings dapat membuat buffer fragmented,
- backpressure tetap diperlukan,
- deduplication/retry semantics harus diuji.

### 5.4 Buffered Ingestion Service

Daripada setiap service menulis langsung ke ClickHouse, kamu membuat service khusus:

```text
application services
  -> ingestion API
  -> validation/enrichment/buffering
  -> ClickHouse batch inserts
```

Kelebihan:

- satu tempat untuk batching,
- satu tempat untuk schema contract,
- satu tempat untuk backpressure,
- retry dan idempotency lebih mudah dikontrol,
- aplikasi bisnis tidak perlu tahu detail ClickHouse.

Kekurangan:

- menambah komponen,
- harus scalable dan highly available,
- jika salah desain bisa menjadi bottleneck,
- perlu local persistence/queue jika tidak ingin kehilangan data saat crash.

Untuk platform serius, ingestion service sering menjadi pilihan yang lebih bersih daripada ClickHouse client tersebar di banyak microservice.

---

## 6. Batching: Keputusan Paling Praktis dalam Ingestion

Batching adalah cara utama mengubah workload write yang noisy menjadi workload write yang ramah MergeTree.

### 6.1 Batch Size Bukan Hanya Rows

Batch tidak boleh diukur hanya dengan row count.

Ukuran batch dipengaruhi oleh:

- jumlah rows,
- total bytes serialized,
- jumlah kolom,
- ukuran string/JSON,
- jumlah partition yang disentuh,
- jumlah shard target,
- compression cost,
- memory aplikasi,
- freshness SLA.

Contoh:

```text
50_000 rows of compact metrics
!=
50_000 rows of large JSON logs
```

Batch metrics mungkin hanya beberapa MB. Batch logs bisa ratusan MB.

### 6.2 Flush by Rows

Contoh:

```text
flush every 50_000 rows
```

Kelebihan:

- mudah dipahami,
- mudah diimplementasikan,
- cukup baik untuk rows yang relatif seragam.

Kekurangan:

- buruk jika row size sangat bervariasi,
- bisa membuat memory spike,
- tidak menjamin freshness.

### 6.3 Flush by Bytes

Contoh:

```text
flush every 8-64 MB serialized data
```

Kelebihan:

- lebih dekat dengan cost I/O,
- lebih aman untuk variable-size events,
- membantu mengontrol memory.

Kekurangan:

- perlu estimasi serialized size,
- implementasi sedikit lebih kompleks.

### 6.4 Flush by Time

Contoh:

```text
flush every 1 second
```

Kelebihan:

- menjaga freshness,
- mencegah low-volume tenant/event tidak pernah flush.

Kekurangan:

- jika traffic rendah, batch kecil,
- jika banyak buffer per tenant/partition, tetap bisa banyak small inserts.

### 6.5 Flush by Partition/Sharding Route

Ini sering dilupakan.

Jika satu batch berisi rows untuk banyak partition, ClickHouse akan mengelompokkan/menulis sesuai partition. Namun dari sisi kesehatan part, terlalu banyak partition yang disentuh oleh batch kecil dapat memperbanyak part.

Contoh buruk:

```text
batch 10_000 rows
spread across 500 daily tenant partitions
=> tiny fragments per partition
```

Contoh lebih baik:

```text
buffer by table + partition bucket + shard route
flush each buffer only when cukup besar atau cukup tua
```

Namun jangan ekstrem membuat buffer per tenant kecil yang tidak pernah cukup besar. Ada trade-off antara locality dan fragmentation.

### 6.6 Batch Size Heuristic Awal

Sebagai starting point, bukan aturan absolut:

| Workload | Starting Point |
|---|---|
| API events compact | 10k–100k rows per insert |
| Logs dengan string besar | 5–50 MB per insert |
| Metrics | 50k–500k rows per insert |
| Low-volume analytics | time-based flush 1–10s + async insert |
| Backfill | file/bulk load, batch jauh lebih besar |

Yang lebih penting dari angka adalah mengukur:

- insert latency,
- rows/s,
- bytes/s,
- parts created per minute,
- active parts per partition,
- merge queue depth,
- rejected inserts,
- memory pressure.

---

## 7. Insert Frequency dan Part Health

ClickHouse documentation sering menyarankan agar jumlah insert query tidak terlalu tinggi dan batch cukup besar. Dari perspektif MergeTree, target sehat bukan “sebanyak mungkin insert queries per second”, tetapi “sebanyak mungkin rows/bytes per second dengan jumlah insert query yang terkendali”.

### 7.1 Metric yang Harus Dipantau

Minimal:

```sql
SELECT
    database,
    table,
    partition,
    count() AS active_parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS size_on_disk
FROM system.parts
WHERE active
GROUP BY database, table, partition
ORDER BY active_parts DESC
LIMIT 50;
```

Jika satu partition punya banyak active parts, itu tanda:

- insert terlalu kecil,
- partition terlalu granular,
- merge tertinggal,
- backfill/live ingest terlalu agresif,
- data masuk ke banyak partitions sekaligus.

Untuk melihat part creation trend:

```sql
SELECT
    event_time,
    query,
    read_rows,
    written_rows,
    written_bytes
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query_kind = 'Insert'
ORDER BY event_time DESC
LIMIT 100;
```

Untuk merge:

```sql
SELECT
    database,
    table,
    elapsed,
    progress,
    num_parts,
    total_size_bytes_compressed
FROM system.merges
ORDER BY elapsed DESC;
```

### 7.2 Symptom: Too Many Parts

Jika muncul error atau warning terkait terlalu banyak parts, biasanya bukan masalah “ClickHouse kurang kuat”, tetapi sinyal desain ingestion/partitioning.

Kemungkinan akar masalah:

1. Insert terlalu kecil.
2. Insert terlalu sering.
3. Partition terlalu granular.
4. Banyak tenant/partition terkena batch kecil.
5. Async insert tidak dikonfigurasi sesuai workload.
6. Backfill berjalan bersamaan dengan live ingest.
7. Replication/merge tertinggal.
8. Disk lambat atau I/O saturated.

### 7.3 Prinsip

> Optimize for rows per insert, not inserts per second.

---

## 8. Synchronous Inserts

Synchronous insert adalah default mental model paling sederhana:

```text
client sends INSERT
server writes data to storage
server returns success/failure
```

### 8.1 Kelebihan

- semantics lebih mudah dipahami,
- failure lebih jelas,
- cocok untuk batch besar,
- client tahu kapan data diterima,
- lebih mudah diintegrasikan dengan retry.

### 8.2 Kekurangan

- request thread menunggu,
- jika batch kecil, overhead tinggi,
- jika latency network tinggi, throughput menurun,
- jika banyak producer, insert concurrency bisa berlebihan.

### 8.3 Cocok Untuk

- ingestion service dengan batching,
- scheduled batch job,
- backfill terkontrol,
- data export/import,
- event pipeline dengan buffer lokal.

### 8.4 Tidak Cocok Untuk

- setiap HTTP request user langsung insert 1 row,
- log line per insert,
- metrics point per insert,
- banyak producer kecil tanpa batching.

---

## 9. Asynchronous Inserts

Async insert adalah fitur penting ketika client-side batching sulit. Dengan `async_insert`, ClickHouse dapat menerima insert lalu menahan data di buffer server-side sebelum flush ke storage.

Konsep sederhana:

```text
client inserts small blocks
  -> ClickHouse async buffer
  -> flush when threshold reached
  -> write larger part
```

### 9.1 Kapan Async Insert Berguna?

Async insert masuk akal jika:

- kamu punya banyak producer kecil,
- producer sulit melakukan batching,
- freshness tetap perlu rendah,
- workload mirip observability/log/event telemetry,
- jumlah insert query tinggi tetapi row per insert kecil,
- kamu ingin mengurangi part explosion tanpa membangun ingestion service dulu.

### 9.2 `wait_for_async_insert`

Ada dua mode besar secara konseptual:

```text
wait_for_async_insert = 1
```

Client menunggu sampai data benar-benar di-flush atau minimal status flush diketahui. Ini lebih aman.

```text
wait_for_async_insert = 0
```

Client mendapat acknowledgment lebih cepat setelah data masuk buffer. Ini lebih rendah latency, tetapi failure semantics lebih sulit.

Untuk workload yang peduli reliability, mode wait biasanya lebih aman. Untuk telemetry yang boleh kehilangan sebagian kecil data, mode no-wait mungkin diterima, tetapi keputusan ini harus eksplisit.

### 9.3 Flush Conditions

Async insert buffer dapat flush berdasarkan:

- ukuran data,
- jumlah query,
- waktu tunggu,
- memory pressure,
- explicit conditions lain tergantung setting.

Yang perlu dipahami: buffer biasanya dipisah berdasarkan kombinasi query shape/settings. Jika aplikasi mengirim variasi insert statement/settings terlalu banyak, batching server-side bisa kurang efektif.

### 9.4 Risiko Async Insert

Async insert bisa menolong small inserts, tetapi tidak menggantikan desain ingestion yang benar.

Risiko:

1. **Memory buffer pressure**  
   Data menumpuk di server memory sebelum flush.

2. **Semantics lebih kompleks**  
   Terutama jika no-wait.

3. **Retry ambiguity**  
   Client perlu tahu apakah failure terjadi sebelum atau sesudah data masuk buffer/storage.

4. **Buffer fragmentation**  
   Banyak insert shape berbeda dapat mengurangi batching.

5. **Backpressure tetap perlu**  
   Server-side buffer bukan antrian tak terbatas.

6. **Operational invisibility jika tidak dipantau**  
   Tim bisa merasa insert sukses, tetapi flush health buruk.

### 9.5 Decision Rule

Gunakan client-side batching jika bisa.

Gunakan async insert jika:

- client-side batching tidak praktis,
- insert kecil tidak bisa dihindari,
- kamu memahami reliability semantics,
- kamu memonitor buffer/flush/parts/merges,
- kamu sudah menetapkan retry policy.

---

## 10. Format Insert: VALUES, JSONEachRow, CSV, Parquet, Native

ClickHouse mendukung banyak format input. Pilihan format memengaruhi CPU parsing, network payload, type safety, dan kemudahan integrasi.

### 10.1 `VALUES`

Contoh:

```sql
INSERT INTO events VALUES
('t1', 'u1', 'login', now()),
('t1', 'u2', 'logout', now());
```

Kelebihan:

- mudah dibaca,
- cocok untuk contoh kecil.

Kekurangan:

- bukan format terbaik untuk volume besar,
- string escaping dan formatting rawan,
- tidak ideal untuk high-throughput ingestion manual.

### 10.2 `JSONEachRow`

Contoh:

```json
{"tenant_id":"t1","user_id":"u1","event_name":"login","event_time":"2026-06-21 10:00:00"}
{"tenant_id":"t1","user_id":"u2","event_name":"logout","event_time":"2026-06-21 10:00:01"}
```

Kelebihan:

- mudah dari aplikasi,
- schema evolution relatif nyaman,
- cocok untuk logs/events,
- human-readable.

Kekurangan:

- parsing JSON lebih mahal,
- payload lebih besar,
- type errors muncul runtime,
- mudah mendorong all-string/JSON-only anti-pattern.

### 10.3 `CSV` / `TSV`

Kelebihan:

- compact,
- familiar,
- cepat untuk batch sederhana.

Kekurangan:

- escaping/null/timezone perlu hati-hati,
- schema evolution kurang nyaman,
- kurang self-describing.

### 10.4 `Parquet`

Kelebihan:

- columnar file format,
- bagus untuk batch load,
- cocok dari data lake/object storage,
- compression efisien.

Kekurangan:

- lebih cocok untuk batch/file ingestion,
- bukan pilihan paling sederhana untuk low-latency app inserts.

### 10.5 Native / Binary-Oriented Client Format

Kelebihan:

- parsing overhead lebih rendah,
- type mapping lebih eksplisit,
- cocok untuk high-throughput clients.

Kekurangan:

- lebih bergantung pada client library,
- debugging tidak semudah JSON/CSV,
- implementasi manual lebih kompleks.

### 10.6 Pilihan Praktis

| Use Case | Format Awal yang Masuk Akal |
|---|---|
| Java service batch events | client/JDBC/native-like batch atau JSONEachRow |
| Observability logs | JSONEachRow / structured format |
| Backfill dari lake | Parquet/CSV dari object storage |
| Metrics high throughput | compact typed batch format |
| Prototype | JSONEachRow |
| Production high volume | typed batch, compression, measured format |

---

## 11. Java Client Options

Dari perspektif Java engineer, ada beberapa cara umum menulis ke ClickHouse:

1. HTTP directly.
2. Official Java client.
3. JDBC driver.
4. Framework integration melalui JDBC/Spring.
5. Custom ingestion service menggunakan client tertentu.

### 11.1 HTTP Direct

ClickHouse punya HTTP interface yang sangat berguna.

Contoh konseptual:

```text
POST /?query=INSERT INTO events FORMAT JSONEachRow
body: newline-delimited JSON rows
```

Kelebihan:

- sederhana,
- mudah di-debug,
- cocok untuk service internal,
- bisa streaming request body,
- tidak perlu ORM.

Kekurangan:

- kamu sendiri mengelola serialization,
- perlu hati-hati dengan timeout/retry,
- type safety terbatas,
- query parameter harus aman.

### 11.2 Official Java Client

Official Java client cocok jika kamu ingin API yang memang dibuat untuk ClickHouse, bukan sekadar JDBC abstraction.

Keuntungan:

- abstraction atas komunikasi network,
- lebih cocok untuk fitur ClickHouse-specific,
- dapat mendukung insert/query dengan opsi yang lebih native,
- mengurangi impedance mismatch JDBC.

### 11.3 JDBC Driver

JDBC berguna jika:

- aplikasi/framework sudah berbasis JDBC,
- ingin integrasi dengan Spring/JdbcTemplate,
- ingin interface familiar,
- query ad-hoc/reporting memakai tool JDBC.

Namun jangan membawa asumsi OLTP JDBC ke ClickHouse.

Beberapa asumsi yang harus dibuang:

- connection pool besar selalu lebih baik,
- autocommit/transaction semantics sama seperti OLTP,
- row-by-row `executeUpdate` adalah wajar,
- ORM cocok untuk analytical inserts,
- prepared statement per row aman untuk volume besar.

ClickHouse bukan target Hibernate entity persistence.

### 11.4 Jangan Gunakan ORM sebagai Analytics Persistence Layer

Hibernate/JPA didesain untuk entity lifecycle, identity, lazy loading, dirty checking, relation mapping, dan transactional persistence.

ClickHouse ingestion didesain untuk:

- append batches,
- typed event rows,
- low object overhead,
- large payload serialization,
- minimal per-row roundtrip.

ORM cenderung menciptakan:

- row-by-row writes,
- unnecessary object graph,
- hidden query behavior,
- poor batching visibility,
- wrong transaction assumptions.

Untuk ClickHouse, gunakan explicit ingestion code.

---

## 12. Java Ingestion Component Design

Mari desain komponen ingestion lokal di Java service.

### 12.1 Basic Architecture

```text
Application code
  -> AnalyticsEventPublisher
  -> InMemoryBatchBuffer
  -> FlushWorker
  -> ClickHouseWriter
  -> ClickHouse
```

Komponen:

1. `AnalyticsEventPublisher`  
   API internal untuk publish event.

2. `BatchBuffer`  
   Menampung event sementara.

3. `FlushPolicy`  
   Menentukan kapan flush.

4. `Serializer`  
   Mengubah event menjadi format insert.

5. `ClickHouseWriter`  
   Mengirim batch.

6. `RetryPolicy`  
   Mengelola retry transient failure.

7. `DeadLetterSink`  
   Menyimpan batch gagal permanen.

8. `Metrics`  
   Mengukur queue size, flush latency, failure rate, batch size.

### 12.2 Synchronous Request Path vs Async Publish

Jangan biarkan request user menunggu ClickHouse kecuali requirement memang begitu.

Lebih umum:

```text
HTTP request handled
  -> business transaction commits to OLTP
  -> analytics event published to local buffer/queue
  -> response returned
  -> background worker flushes to ClickHouse
```

Namun hati-hati: jika event hanya ada di memory buffer dan proses crash, event hilang.

Untuk event penting:

- tulis ke durable outbox di OLTP,
- atau publish ke durable stream,
- atau gunakan local disk spool,
- atau ingestion service dengan durable queue.

Untuk event telemetry low-criticality:

- in-memory buffer mungkin cukup.

### 12.3 Flush Policy Interface

Contoh konseptual:

```java
interface FlushPolicy {
    boolean shouldFlush(BufferStats stats, Instant now);
}
```

`BufferStats` bisa berisi:

```java
record BufferStats(
    int rowCount,
    long estimatedBytes,
    Instant oldestEventTime,
    Instant lastFlushTime
) {}
```

Policy:

```text
flush if rowCount >= maxRows
flush if estimatedBytes >= maxBytes
flush if oldestEventAge >= maxAge
flush if shutdown
```

### 12.4 Buffer Partitioning

Naif:

```text
one global buffer per table
```

Kelebihan:

- batch cepat besar,
- simple.

Kekurangan:

- batch bisa menyebar ke banyak partition/shard,
- satu tenant besar mendominasi,
- failure satu batch memblokir semua.

Lebih advanced:

```text
buffer by table + route key
```

Route key dapat berupa:

- table,
- month partition,
- shard key,
- event type group,
- tenant tier.

Jangan membuat buffer terlalu granular seperti `tenant_id + day + event_name` untuk semua tenant jika banyak kombinasi sepi. Itu akan menciptakan banyak tiny flush.

### 12.5 Bounded Queue

Ingestion buffer harus bounded.

Buruk:

```java
Queue<Event> queue = new LinkedList<>(); // unbounded
```

Jika ClickHouse lambat, memory aplikasi akan habis.

Lebih baik:

```text
bounded queue
  -> if full: apply policy
```

Policy saat penuh:

| Data Type | Backpressure Policy |
|---|---|
| Critical audit event | block caller / durable fallback |
| Product analytics | drop oldest? usually no, prefer durable queue |
| Observability debug logs | sample/drop allowed |
| Security event | durable fallback/block |
| Billing metric | never silently drop |

### 12.6 Java Object Allocation

High-volume ingestion bisa boros GC jika setiap event menjadi object besar, map string, JSON tree, lalu string serialized.

Prinsip:

- gunakan typed DTO/record,
- hindari `Map<String,Object>` untuk hot path,
- hindari membangun JSON AST besar jika tidak perlu,
- gunakan streaming serializer,
- reuse buffers dengan hati-hati,
- ukur allocation rate,
- pisahkan enrichment berat dari flush hot path.

---

## 13. Retry Semantics: Masalah yang Terlihat Mudah tapi Sering Salah

Network failure membuat insert ambiguity.

Client mengirim batch:

```text
client -> ClickHouse INSERT batch A
```

Lalu client mendapat timeout.

Pertanyaannya:

```text
Apakah batch A sudah ditulis?
```

Kemungkinan:

1. Request tidak sampai server.
2. Request sampai server, gagal sebelum write.
3. Request sampai server, data berhasil ditulis, response hilang.
4. Request sebagian diproses, lalu failure.
5. Request masuk async buffer, tetapi flush belum pasti.

Jika client langsung retry tanpa deduplication model, duplicate bisa terjadi.

### 13.1 Retry Tanpa Idempotency

```text
send batch A
  -> timeout
retry batch A
  -> success
```

Jika insert pertama sebenarnya sukses, batch A muncul dua kali.

Untuk analytics tertentu duplicate kecil mungkin tidak terlihat. Untuk counting/reporting/audit/billing, duplicate fatal.

### 13.2 Retry dengan Insert Deduplication

ClickHouse memiliki mekanisme deduplication untuk replicated MergeTree/insert blocks tertentu. Secara konseptual, ClickHouse dapat mengenali block insert yang sama dalam window tertentu agar retry insert identik tidak menulis ulang data.

Namun ada batasan penting:

- dedup bekerja pada block, bukan semantic event identity universal,
- data harus sama dan block structure/order harus konsisten,
- deduplication window terbatas,
- setting dan engine memengaruhi behavior,
- async insert punya perhatian khusus,
- materialized view chain perlu diuji terpisah,
- ini bukan pengganti data modeling dedup jika duplicate event bisa datang dari source berbeda.

### 13.3 Insert Deduplication Token

Untuk beberapa kasus, kamu dapat menggunakan insert deduplication token agar retry batch punya identity yang stabil.

Mental model:

```text
batch_id = stable UUID for this exact batch payload
INSERT batch with insert_deduplication_token = batch_id
if timeout -> retry same batch_id and same payload
```

Yang tidak boleh dilakukan:

```text
retry same data with new token
```

Itu membuat dedup tidak berguna.

### 13.4 Application-Level Event ID

Untuk correctness lebih kuat, masukkan `event_id` atau deterministic identity ke row.

Contoh:

```text
event_id = hash(source_system, source_event_id, event_type, event_time)
```

Lalu gunakan table pattern seperti:

- raw append table tetap menerima duplicates,
- deduplicated serving table menggunakan `ReplacingMergeTree`,
- materialized view menulis latest/collapsed representation,
- query menggunakan model yang sesuai.

Namun ini bukan gratis:

- `ReplacingMergeTree` dedup terjadi saat merge, bukan immediate guarantee,
- query dengan `FINAL` mahal,
- aggregation sebelum dedup bisa double count,
- desain harus eksplisit.

### 13.5 Idempotency Level

Ada beberapa level idempotency:

| Level | Makna | Cocok Untuk |
|---|---|---|
| No idempotency | duplicate mungkin terjadi | debug logs, low-value telemetry |
| Batch-level dedup | retry batch identik aman | client retry timeout |
| Event-level dedup | duplicate event dari source bisa dibersihkan | audit/product events |
| Business-level correction | event salah dikoreksi dengan compensating event | regulatory/billing/reporting |
| Full transactional exactly-once | sangat sulit/mahal | jarang realistis di OLAP |

---

## 14. Deduplication Strategy by Use Case

### 14.1 Observability Logs

Biasanya:

- duplicate kecil dapat diterima,
- missing kecil kadang diterima,
- throughput dan availability lebih penting,
- sampling/drop policy mungkin sah.

Strategi:

- async insert atau batched insert,
- no heavy dedup,
- maybe include log event id untuk traceability,
- retention pendek,
- downsampling/rollup.

### 14.2 Product Analytics Events

Biasanya:

- duplicate merusak funnel/conversion,
- missing event juga buruk,
- source event id perlu ada,
- retry harus aman.

Strategi:

- event_id deterministic,
- batch-level retry dedup,
- raw table + dedup serving model,
- late event handling,
- quality monitoring.

### 14.3 Regulatory / Case Lifecycle Analytics

Biasanya:

- auditability penting,
- event tidak boleh diam-diam hilang,
- correction harus traceable,
- duplicate harus dapat dijelaskan,
- lineage penting.

Strategi:

- immutable raw event log,
- source_event_id wajib,
- ingestion_batch_id wajib,
- source_system wajib,
- event_version / schema_version,
- correction event, bukan destructive update,
- dedup view/table untuk reporting,
- reconciliation job.

### 14.4 Billing / Financial Metrics

Biasanya:

- duplicate fatal,
- missing fatal,
- approximate not acceptable untuk amount,
- Decimal over Float.

Strategi:

- durable upstream log/outbox,
- deterministic event id,
- reconciliation,
- no silent drop,
- strong alerting,
- possibly do authoritative computation outside ClickHouse and use ClickHouse for analytics/reporting.

---

## 15. Backpressure: Jangan Jadikan ClickHouse Tempat Sampah Infinite

Backpressure adalah kemampuan sistem untuk memperlambat producer saat consumer/storage tidak mampu mengikuti.

Tanpa backpressure:

```text
traffic spike
  -> application keeps accepting events
  -> memory buffer grows
  -> flush workers retry aggressively
  -> ClickHouse overloaded
  -> more retries
  -> more load
  -> cascading failure
```

Dengan backpressure:

```text
traffic spike
  -> buffer reaches threshold
  -> producer slowed / degraded / spooled / sampled
  -> ClickHouse protected
  -> system recovers
```

### 15.1 Backpressure Signals

Dari aplikasi:

- queue depth,
- oldest event age,
- flush latency,
- retry count,
- memory usage,
- dropped event count,
- batch failure rate.

Dari ClickHouse:

- insert latency,
- exception rate,
- active parts per partition,
- merge queue,
- replication queue,
- disk free space,
- CPU/I/O saturation,
- memory usage,
- query latency for reads.

### 15.2 Backpressure Actions

Action dapat bertingkat:

1. Increase batch size temporarily.
2. Reduce flush concurrency.
3. Slow producers.
4. Route to durable queue/spool.
5. Drop/sampling for low-priority telemetry.
6. Reject non-critical analytics event.
7. Disable heavy enrichment.
8. Pause backfill.
9. Shed dashboard queries.
10. Alert operators.

### 15.3 Bounded Concurrency

Jangan biarkan setiap thread flush sendiri.

Buruk:

```text
100 app threads
  -> each sends inserts concurrently
  -> ClickHouse receives insert storm
```

Lebih baik:

```text
bounded flush worker pool
  -> N concurrent inserts max
  -> queue/buffer visible
  -> retry centralized
```

Starting point:

```text
flush_concurrency = small number per app instance
```

Lalu ukur.

Terlalu banyak concurrent insert bisa memperburuk part explosion dan merge pressure.

### 15.4 Circuit Breaker

Jika ClickHouse error rate tinggi:

```text
open circuit
  -> stop direct writes temporarily
  -> buffer/spool/drop according to policy
  -> periodic half-open probe
```

Untuk critical events, circuit breaker harus punya durable fallback. Jika tidak, ia hanya mengubah failure menjadi data loss.

---

## 16. Durable vs Non-Durable Ingestion

Tidak semua analytics events bernilai sama.

### 16.1 Non-Durable Buffer

```text
in-memory queue only
```

Kelebihan:

- cepat,
- simple,
- rendah latency.

Kekurangan:

- process crash = data hilang,
- deploy/restart bisa drop event,
- pressure sulit ditahan lama.

Cocok untuk:

- debug telemetry,
- low-value observability,
- approximate analytics.

### 16.2 Local Disk Spool

```text
events written to local disk queue
flush worker sends to ClickHouse
```

Kelebihan:

- tahan process crash,
- bisa menahan outage pendek,
- tidak perlu external broker.

Kekurangan:

- disk management,
- ordering/retry complexity,
- multi-instance recovery,
- operational burden.

### 16.3 Durable Outbox

```text
business transaction -> OLTP table outbox
background relay -> ClickHouse/broker
```

Kelebihan:

- event konsisten dengan OLTP transaction,
- tidak hilang jika service crash,
- bagus untuk domain-critical events.

Kekurangan:

- menambah load OLTP,
- relay complexity,
- schema evolution,
- lag monitoring.

### 16.4 Durable Stream/Queue

Ini dibahas lebih detail di part 011.

Kelebihan:

- decoupling producer/consumer,
- replay,
- backpressure,
- multiple consumers,
- better durability.

Kekurangan:

- operasi broker,
- delivery semantics complexity,
- schema registry/contract,
- lag management.

---

## 17. Ingestion Contract

Ingestion contract adalah kesepakatan antara producer dan analytics storage.

Minimal untuk event analytics serius:

```text
event_id
source_system
source_event_id
ingestion_batch_id
ingestion_time
event_time
schema_version
tenant_id / domain partition key
event_type
payload fields
```

### 17.1 `event_id`

Digunakan untuk dedup/event identity.

Idealnya deterministic:

```text
event_id = stable hash(source_system + source_event_id + event_type)
```

Jangan menggunakan random UUID baru pada setiap retry untuk event yang sama.

### 17.2 `ingestion_batch_id`

Membantu tracing:

- batch mana yang membawa event,
- retry mana yang terjadi,
- failure batch mana yang harus direplay,
- audit lineage.

### 17.3 `ingestion_time`

Waktu saat ClickHouse/ingestion layer menerima data.

Berguna untuk:

- latency monitoring,
- late event detection,
- debugging pipeline,
- replay analysis.

### 17.4 `event_time`

Waktu kejadian bisnis.

Berguna untuk:

- reporting period,
- time-series analytics,
- SLA/business analytics.

Jangan mengganti event_time dengan ingestion_time kecuali memang definisinya ingestion-based.

### 17.5 `schema_version`

Membantu:

- evolution,
- parsing conditional,
- backward compatibility,
- troubleshooting old producers.

---

## 18. Insert Ordering and Event Ordering

ClickHouse tidak boleh diasumsikan menjaga urutan event global seperti log append tunggal.

Data akan:

- masuk dari banyak clients,
- ditulis ke parts,
- di-merge background,
- di-query dengan parallelism,
- disortir berdasarkan `ORDER BY` fisik, bukan arrival order semata.

Jika urutan domain penting, simpan kolom eksplisit:

```text
event_time
sequence_number
source_offset
version
```

Untuk case lifecycle:

```text
case_id
event_time
event_sequence
state_from
state_to
```

Untuk CDC:

```text
source_lsn
source_tx_id
operation_time
```

Jangan mengandalkan order insert sebagai order bisnis.

---

## 19. Insert Validation and Data Quality

ClickHouse bisa melakukan type conversion dan default values, tetapi ingestion layer tetap harus bertanggung jawab atas kualitas data.

### 19.1 Validation Levels

1. **Producer validation**  
   Service memastikan event wajib ada.

2. **Ingestion service validation**  
   Schema contract, type, allowed enum, nullability.

3. **ClickHouse type validation**  
   Kolom dan format harus cocok.

4. **Data quality queries**  
   Monitor nulls, unknown values, late events, duplicates.

### 19.2 Jangan Terlalu Bergantung pada Nullable

Jika field wajib, buat non-null dengan default jelas atau reject event.

Misalnya:

```sql
status LowCardinality(String)
```

Lebih baik daripada:

```sql
status Nullable(String)
```

jika status secara domain wajib.

### 19.3 Bad Event Strategy

Ketika event invalid:

- reject producer,
- write to dead-letter table,
- write to quarantine topic/file,
- capture validation error,
- alert if rate tinggi.

Jangan diam-diam mengubah invalid value menjadi default yang terlihat valid.

Contoh buruk:

```text
missing tenant_id -> tenant_id = 'unknown'
```

Jika `tenant_id` adalah security boundary, ini berbahaya.

---

## 20. Error Taxonomy

Tidak semua error insert harus diperlakukan sama.

### 20.1 Transient Errors

Contoh:

- network timeout,
- temporary server overload,
- connection reset,
- replica unavailable sementara,
- too many simultaneous queries,
- temporary disk pressure.

Response:

- retry with backoff,
- preserve same batch id/token,
- reduce concurrency,
- apply backpressure.

### 20.2 Permanent Data Errors

Contoh:

- type mismatch,
- missing required column,
- invalid enum/value,
- unknown column,
- schema incompatible,
- row too large.

Response:

- jangan blind retry,
- send to dead-letter,
- alert producer/schema owner,
- fix data or schema.

### 20.3 Capacity/Design Errors

Contoh:

- too many parts,
- disk full,
- memory limit exceeded consistently,
- merge queue never catches up,
- partition explosion.

Response:

- stop increasing retry pressure,
- pause backfill,
- increase batch size,
- reduce insert concurrency,
- revise partitioning/batching,
- scale storage/cluster if needed.

### 20.4 Ambiguous Errors

Timeout setelah request dikirim adalah ambiguous.

Response:

- retry only with idempotency strategy,
- use same dedup token for same batch,
- log batch id,
- reconcile duplicates later if necessary.

---

## 21. Retry Policy Design

Retry policy minimal:

```text
max attempts
exponential backoff
jitter
same batch id/token
bounded queue
dead-letter after final failure
metrics and alerting
```

### 21.1 Bad Retry

```text
while true:
  try insert
  catch: retry immediately
```

Ini bisa menghancurkan ClickHouse saat sedang overload.

### 21.2 Better Retry

```text
attempt 1 -> fail
wait 100ms + jitter
attempt 2 -> fail
wait 500ms + jitter
attempt 3 -> fail
wait 2s + jitter
attempt 4 -> fail
send to durable retry queue / dead-letter
```

### 21.3 Retry Must Respect Backpressure

Jika queue depth naik dan ClickHouse latency naik, retry concurrency harus turun, bukan naik.

```text
error rate high
  -> reduce flush concurrency
  -> increase batch size if possible
  -> pause low-priority producers
```

### 21.4 Preserve Payload Identity

Untuk retry yang ingin dedup:

- jangan reorder rows jika block-level dedup bergantung pada block identity,
- jangan regenerate event ids,
- jangan regenerate batch token,
- jangan mengubah default values client-side antar retry,
- jangan split batch secara berbeda tanpa memahami dedup consequence.

---

## 22. Insert Concurrency

Insert concurrency membantu throughput sampai titik tertentu. Setelah itu, ia menambah pressure.

### 22.1 Terlalu Rendah

Gejala:

- CPU/network ClickHouse idle,
- flush queue menumpuk,
- batch size besar tapi latency tinggi,
- ingestion worker bottleneck.

### 22.2 Terlalu Tinggi

Gejala:

- banyak small parts,
- merge queue naik,
- insert latency naik,
- disk I/O saturated,
- replication queue tertinggal,
- error rate naik.

### 22.3 Tuning Approach

Mulai kecil:

```text
1-4 concurrent inserts per ingestion service instance
```

Lalu ukur:

- rows/s,
- MB/s,
- insert latency p50/p95/p99,
- active parts growth,
- merge backlog,
- CPU/I/O,
- query impact.

Jangan tuning hanya dari aplikasi. Lihat ClickHouse system tables.

---

## 23. Multi-Table and Multi-Tenant Ingestion

### 23.1 Multi-Table

Jika satu service menulis ke banyak table:

```text
events_raw
case_events
api_requests
security_audit
```

Jangan gabungkan semua ke satu buffer tanpa kontrol. Setiap table punya:

- schema,
- batch size,
- criticality,
- retry policy,
- retention,
- partitioning.

Gunakan buffer per table atau per table group.

### 23.2 Multi-Tenant

Multi-tenant ingestion punya risiko:

- tenant besar mendominasi batch,
- tenant kecil menghasilkan tiny batches,
- tenant tertentu menyebabkan bad data,
- per-tenant partitioning bisa meledakkan part count.

Strategi:

1. Simpan `tenant_id` sebagai kolom penting.
2. Jangan otomatis `PARTITION BY tenant_id`.
3. Gunakan route/buffer berdasarkan tenant tier jika perlu.
4. Batasi per-tenant rate.
5. Monitor per-tenant ingestion lag/error.
6. Sediakan quarantine untuk tenant bermasalah.

### 23.3 Noisy Neighbor

Jika tenant A mengirim 100x traffic, tenant B tidak boleh kehilangan freshness selamanya.

Solusi:

- weighted fair buffering,
- per-tenant quotas,
- separate ingestion lanes for premium/high-volume tenants,
- separate tables/clusters untuk tenant ekstrim jika benar-benar perlu.

---

## 24. Live Ingest vs Backfill

Live ingest dan backfill tidak boleh diperlakukan sama.

### 24.1 Live Ingest

Karakteristik:

- continuous,
- freshness penting,
- batch sedang,
- retry cepat,
- tidak boleh mengganggu query serving.

### 24.2 Backfill

Karakteristik:

- volume besar,
- freshness tidak real-time,
- batch besar,
- bisa dijadwalkan,
- bisa menghancurkan merge/TTL/query jika tidak dibatasi.

### 24.3 Rule

> Jangan jalankan backfill besar lewat jalur ingestion live tanpa throttle.

Backfill sebaiknya punya:

- dedicated job,
- dedicated user/profile/limits,
- lower priority,
- schedule window,
- large batches/files,
- progress checkpoint,
- idempotent ranges,
- monitoring parts/merges.

### 24.4 Backfill Failure

Backfill harus bisa diulang.

Gunakan checkpoint:

```text
source range: 2026-01-01T00:00 to 2026-01-01T01:00
status: inserted / verified / failed
batch_id: ...
row_count: ...
hash/checksum: ...
```

Tanpa checkpoint, backfill retry sering menciptakan duplicate atau missing ranges.

---

## 25. Designing for Freshness

Freshness SLA harus eksplisit.

Contoh:

```text
Product dashboard: event visible within 10 seconds
Security audit search: event visible within 5 seconds
Regulatory report: event visible within 15 minutes acceptable
Debug logs: visible within 2 seconds preferred, loss acceptable
Billing analytics: visible within 1 hour, correctness more important
```

### 25.1 Freshness Budget

Freshness total:

```text
producer delay
+ buffer wait
+ serialization time
+ network time
+ ClickHouse insert time
+ materialized view processing
+ replication lag
+ query/dashboard cache delay
```

Jika SLA 5 detik, jangan habiskan 5 detik hanya di client buffer.

### 25.2 Flush Time vs Batch Size

Semakin cepat flush:

- freshness lebih baik,
- batch lebih kecil,
- part pressure lebih tinggi.

Semakin lambat flush:

- batch lebih besar,
- throughput lebih baik,
- freshness lebih buruk.

Async insert, ingestion service, atau stream buffer dapat membantu menyeimbangkan ini.

---

## 26. Materialized Views and Insert Cost

Jika source table punya materialized views, insert cost bertambah.

Insert ke raw table dapat memicu:

```text
raw insert
  -> MV 1 aggregate
  -> MV 2 projection table
  -> MV 3 rollup
  -> MV 4 dictionary/refined table
```

Konsekuensi:

- insert latency naik,
- memory usage naik,
- failure semantics lebih kompleks,
- deduplication chain perlu diuji,
- backfill bisa lebih berat.

### 26.1 Design Rule

Jangan menambahkan banyak materialized view di jalur hot ingest tanpa mengukur.

Jika transformasi berat:

- pertimbangkan staging raw table,
- batch transform terpisah,
- rollup asynchronous,
- query-time computation untuk low-volume metrics,
- materialized view hanya untuk agregat yang benar-benar sering dipakai.

### 26.2 MV and Retry

Jika insert retry menghasilkan duplicate di raw table, MV aggregate bisa double count.

Karena itu dedup strategy harus diputuskan sebelum membangun MV aggregate.

---

## 27. Security and Governance in Ingestion

Ingestion bukan hanya performance path. Ia juga governance boundary.

### 27.1 Producer Identity

Simpan atau log:

- producer service,
- producer version,
- source system,
- environment,
- schema version,
- ingestion user.

Ini penting saat ada data quality issue.

### 27.2 PII Handling

Jangan mengirim PII mentah ke ClickHouse hanya karena mudah.

Pertanyaan:

- apakah field perlu untuk analytics?
- bisa di-hash/tokenize?
- perlu masking?
- retention berbeda?
- ada legal delete requirement?
- apakah query user boleh melihat field itu?

### 27.3 Tenant Boundary

Jika table multi-tenant:

- `tenant_id` wajib,
- ingestion harus reject missing tenant,
- query API harus enforce tenant filter,
- row policy/role bisa dipertimbangkan,
- jangan membuat default tenant seperti `unknown` untuk data sensitif.

### 27.4 Auditability

Untuk regulatory/case analytics, simpan:

```text
ingestion_time
ingestion_batch_id
source_system
source_event_id
producer_version
schema_version
raw_payload_hash
```

Ini membantu menjawab:

- dari mana data ini berasal?
- kapan masuk?
- batch mana?
- apakah pernah replay?
- apakah payload berubah?

---

## 28. Observability for Ingestion

Ingestion pipeline harus observable.

### 28.1 Application Metrics

Minimal:

```text
events_received_total
events_buffered_total
events_flushed_total
events_failed_total
events_dropped_total
batch_rows_histogram
batch_bytes_histogram
flush_latency_histogram
flush_attempts_total
retry_attempts_total
queue_depth
oldest_buffered_event_age
clickhouse_insert_latency
clickhouse_insert_errors_by_type
```

### 28.2 ClickHouse Metrics / System Tables

Gunakan:

- `system.query_log`,
- `system.parts`,
- `system.merges`,
- `system.mutations`,
- `system.replicas`,
- `system.replication_queue`,
- `system.asynchronous_metrics`,
- `system.events`,
- `system.errors`.

Contoh query insert latency:

```sql
SELECT
    toStartOfMinute(event_time) AS minute,
    count() AS inserts,
    sum(written_rows) AS rows,
    sum(written_bytes) AS bytes,
    quantile(0.95)(query_duration_ms) AS p95_ms
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query_kind = 'Insert'
  AND event_time >= now() - INTERVAL 1 HOUR
GROUP BY minute
ORDER BY minute;
```

Contoh active parts:

```sql
SELECT
    table,
    partition,
    count() AS active_parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE active
GROUP BY table, partition
ORDER BY active_parts DESC
LIMIT 20;
```

### 28.3 Freshness Metric

Untuk events:

```sql
SELECT
    quantile(0.50)(dateDiff('second', event_time, ingestion_time)) AS p50_lag_s,
    quantile(0.95)(dateDiff('second', event_time, ingestion_time)) AS p95_lag_s,
    quantile(0.99)(dateDiff('second', event_time, ingestion_time)) AS p99_lag_s
FROM events_raw
WHERE ingestion_time >= now() - INTERVAL 1 HOUR;
```

Jika event_time bisa dari client device dan clock tidak terpercaya, gunakan source/server event time atau capture both.

---

## 29. Example: Java Service Direct Batching Pattern

### 29.1 Domain Event

```java
public record CaseLifecycleEvent(
    String tenantId,
    String caseId,
    String eventId,
    String eventType,
    String actorId,
    String stateFrom,
    String stateTo,
    java.time.Instant eventTime,
    java.time.Instant ingestionTime,
    String sourceSystem,
    String schemaVersion
) {}
```

### 29.2 Table Sketch

```sql
CREATE TABLE case_lifecycle_events_raw
(
    tenant_id LowCardinality(String),
    case_id String,
    event_id UUID,
    event_type LowCardinality(String),
    actor_id String,
    state_from LowCardinality(String),
    state_to LowCardinality(String),
    event_time DateTime64(3, 'UTC'),
    ingestion_time DateTime64(3, 'UTC'),
    source_system LowCardinality(String),
    schema_version LowCardinality(String),
    ingestion_batch_id UUID
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, case_id);
```

Catatan:

- Ini bukan satu-satunya desain benar.
- Sorting key tergantung query pattern.
- Jika query utama by `case_id`, key bisa berbeda.
- Jika tenant isolation paling dominan, tenant first masuk akal.
- Jika time-range global dominan, time lebih awal bisa dipertimbangkan.

### 29.3 Buffer Sketch

```java
public final class ClickHouseBatchBuffer<T> {
    private final int maxRows;
    private final long maxBytes;
    private final java.time.Duration maxAge;

    private final java.util.ArrayList<T> rows = new java.util.ArrayList<>();
    private long estimatedBytes = 0L;
    private java.time.Instant firstRowAt = null;

    public synchronized java.util.List<T> add(T row, long rowBytesEstimate, java.time.Instant now) {
        if (rows.isEmpty()) {
            firstRowAt = now;
        }

        rows.add(row);
        estimatedBytes += rowBytesEstimate;

        if (shouldFlush(now)) {
            return drain();
        }
        return java.util.List.of();
    }

    public synchronized boolean shouldFlush(java.time.Instant now) {
        if (rows.size() >= maxRows) return true;
        if (estimatedBytes >= maxBytes) return true;
        if (firstRowAt != null && java.time.Duration.between(firstRowAt, now).compareTo(maxAge) >= 0) return true;
        return false;
    }

    public synchronized java.util.List<T> drain() {
        if (rows.isEmpty()) return java.util.List.of();
        var copy = java.util.List.copyOf(rows);
        rows.clear();
        estimatedBytes = 0L;
        firstRowAt = null;
        return copy;
    }
}
```

Ini hanya ilustrasi. Production version perlu:

- bounded queue,
- flush worker,
- error handling,
- shutdown flush,
- metrics,
- durable fallback,
- route-specific buffers,
- memory accounting lebih akurat.

### 29.4 Writer Sketch

Pseudo-code:

```java
public interface AnalyticsBatchWriter<T> {
    void writeBatch(java.util.List<T> batch, java.util.UUID batchId) throws InsertException;
}
```

Retry wrapper:

```java
public final class RetryingWriter<T> implements AnalyticsBatchWriter<T> {
    private final AnalyticsBatchWriter<T> delegate;
    private final int maxAttempts;

    @Override
    public void writeBatch(java.util.List<T> batch, java.util.UUID batchId) throws InsertException {
        int attempt = 0;
        while (true) {
            attempt++;
            try {
                delegate.writeBatch(batch, batchId);
                return;
            } catch (TransientInsertException e) {
                if (attempt >= maxAttempts) throw e;
                sleepWithBackoffAndJitter(attempt);
            } catch (PermanentInsertException e) {
                throw e;
            }
        }
    }

    private void sleepWithBackoffAndJitter(int attempt) {
        // implement bounded exponential backoff + jitter
    }
}
```

Important:

- `batchId` must stay the same across retries.
- Permanent data errors must not be retried forever.
- Failed batches should go to durable dead-letter if important.

---

## 30. Example: HTTP JSONEachRow Insert

Conceptual request:

```http
POST /?query=INSERT%20INTO%20case_lifecycle_events_raw%20FORMAT%20JSONEachRow HTTP/1.1
Host: clickhouse.internal:8123
Content-Type: application/json
```

Body:

```json
{"tenant_id":"reg-a","case_id":"C-1001","event_id":"018f5f96-1111-7000-8000-000000000001","event_type":"ASSIGNED","actor_id":"u-10","state_from":"NEW","state_to":"ASSIGNED","event_time":"2026-06-21 10:15:30.123","ingestion_time":"2026-06-21 10:15:31.000","source_system":"case-service","schema_version":"1","ingestion_batch_id":"018f5f96-2222-7000-8000-000000000001"}
{"tenant_id":"reg-a","case_id":"C-1002","event_id":"018f5f96-1111-7000-8000-000000000002","event_type":"ESCALATED","actor_id":"u-11","state_from":"ASSIGNED","state_to":"ESCALATED","event_time":"2026-06-21 10:15:32.456","ingestion_time":"2026-06-21 10:15:33.000","source_system":"case-service","schema_version":"1","ingestion_batch_id":"018f5f96-2222-7000-8000-000000000001"}
```

Kelebihan:

- mudah dihasilkan dari Java,
- line-delimited,
- bisa streaming,
- mudah debug.

Kekurangan:

- parsing overhead,
- perlu escaping benar,
- type mismatch bisa muncul saat insert.

---

## 31. Example: JDBC Batch Concept

JDBC batch sering terlihat familiar, tetapi harus digunakan sebagai true batch, bukan per-row insert.

Conceptual pattern:

```java
String sql = """
    INSERT INTO case_lifecycle_events_raw
    (tenant_id, case_id, event_id, event_type, actor_id,
     state_from, state_to, event_time, ingestion_time,
     source_system, schema_version, ingestion_batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """;

try (var connection = dataSource.getConnection();
     var ps = connection.prepareStatement(sql)) {

    for (CaseLifecycleEvent e : batch) {
        ps.setString(1, e.tenantId());
        ps.setString(2, e.caseId());
        ps.setObject(3, java.util.UUID.fromString(e.eventId()));
        ps.setString(4, e.eventType());
        ps.setString(5, e.actorId());
        ps.setString(6, e.stateFrom());
        ps.setString(7, e.stateTo());
        ps.setObject(8, e.eventTime());
        ps.setObject(9, e.ingestionTime());
        ps.setString(10, e.sourceSystem());
        ps.setString(11, e.schemaVersion());
        ps.setObject(12, currentBatchId);
        ps.addBatch();
    }

    ps.executeBatch();
}
```

Production notes:

- verify driver-specific recommended APIs,
- avoid `setTimestamp` if driver docs recommend better temporal mapping,
- control connection pool size,
- use request/query settings deliberately,
- measure actual insert performance,
- do not use JPA/Hibernate for this path.

---

## 32. Connection Pooling

ClickHouse insert workload should not blindly reuse OLTP pool patterns.

### 32.1 Common Mistake

```text
Hikari maxPoolSize = 100
flush workers = unlimited
```

This can overwhelm ClickHouse with concurrent inserts.

### 32.2 Better Approach

- small dedicated pool for ClickHouse ingestion,
- bounded flush concurrency,
- separate pool for query API vs ingest if needed,
- strict timeouts,
- metrics per pool,
- no shared pool with OLTP database.

### 32.3 Timeout Types

Distinguish:

- connection timeout,
- socket/read timeout,
- insert query timeout,
- batch queue timeout,
- flush worker shutdown timeout.

Timeout too low creates false failures and duplicate risk. Timeout too high ties up worker threads.

---

## 33. Compression on the Wire

For large inserts, network compression can matter.

Benefits:

- less network bandwidth,
- faster transfer over constrained links,
- lower cross-zone/cross-region cost.

Costs:

- CPU compression client-side,
- CPU decompression server-side,
- latency for small batches.

Guideline:

- use compression for large payloads,
- measure for small low-latency inserts,
- avoid compressing already-compressed formats blindly,
- observe CPU on both client and server.

---

## 34. Ingestion and Schema Evolution

Schema evolution can break ingestion if unmanaged.

### 34.1 Adding Columns

Usually safe if:

- column has `DEFAULT`,
- producer can omit it,
- ClickHouse table supports missing fields in chosen format/settings,
- readers tolerate absence/old default.

### 34.2 Removing Columns

Dangerous because old producers may still send field. Need:

- producer rollout,
- compatibility window,
- ingestion validation update,
- table migration plan.

### 34.3 Changing Type

Often dangerous.

Safer pattern:

```text
add new column
write both old and new
migrate readers
backfill if needed
drop old later
```

### 34.4 Schema Version in Event

Always include schema version for event families with long-lived producers.

---

## 35. Ingestion Failure Modes

### 35.1 Row-by-Row Insert Storm

Symptom:

- insert QPS high,
- rows per insert low,
- many active parts,
- merge queue high.

Fix:

- batch client-side,
- async insert,
- ingestion service,
- reduce insert concurrency.

### 35.2 Partition Spraying

Symptom:

- one insert touches many partitions,
- active parts per partition high,
- TTL/merge inefficient.

Fix:

- coarser partitioning,
- buffer by partition range,
- avoid tenant/day over-partitioning,
- separate live vs backfill.

### 35.3 Retry Duplication

Symptom:

- counts unexpectedly high,
- duplicate event_id,
- spikes after network incidents.

Fix:

- stable batch id/token,
- event_id,
- dedup table/model,
- retry with backoff,
- reconciliation query.

### 35.4 Silent Data Loss

Symptom:

- app reports success but ClickHouse missing data,
- memory buffer lost on restart,
- async no-wait semantics misunderstood,
- dropped events not monitored.

Fix:

- durable buffer for critical events,
- wait semantics,
- dropped-event metrics,
- outbox/stream,
- reconciliation.

### 35.5 Backfill Meltdown

Symptom:

- production dashboard slows during historical load,
- merge queue grows,
- disk I/O saturated,
- insert errors increase.

Fix:

- throttle backfill,
- use large batches/files,
- isolate resources,
- schedule windows,
- pause materialized view rebuild if needed.

### 35.6 Bad Data Poisoning

Symptom:

- repeated insert failures,
- same batch retried forever,
- queue stuck behind invalid row.

Fix:

- classify permanent errors,
- dead-letter invalid batch/row,
- validation before insert,
- skip or quarantine poison pill.

---

## 36. Production Checklist

Before deploying ingestion to ClickHouse, answer these:

### 36.1 Workload

- What is expected rows/s?
- What is expected MB/s?
- What is peak multiplier?
- How many producers?
- How many tables?
- How many partitions per hour/day touched?
- What freshness SLA?

### 36.2 Batching

- What is max rows per batch?
- What is max bytes per batch?
- What is max age per batch?
- What is max concurrent flush?
- Is queue bounded?
- What happens on shutdown?

### 36.3 Correctness

- Can duplicates happen?
- Are duplicates acceptable?
- Is there event_id?
- Is there batch_id?
- Is retry idempotent?
- Is there dead-letter?
- Is there reconciliation?

### 36.4 Backpressure

- What happens when ClickHouse slows down?
- Do producers block, drop, sample, or spool?
- Which event types are critical?
- Is backfill isolated?
- Are retries bounded?

### 36.5 Observability

- Are insert latency and batch sizes measured?
- Are active parts monitored?
- Are merges monitored?
- Are insert errors classified?
- Is ingestion lag measured?
- Are dropped/dead-letter events alerted?

### 36.6 Security/Governance

- Is tenant_id mandatory?
- Is PII controlled?
- Is producer identity logged?
- Is schema_version included?
- Is lineage/audit available?

---

## 37. Decision Framework

### 37.1 If You Can Batch Client-Side

Use:

```text
client-side batching + synchronous insert + retry with stable batch id
```

Good for:

- controlled Java ingestion service,
- backend services with background workers,
- medium/high volume events.

### 37.2 If You Cannot Batch Client-Side

Use:

```text
async_insert + wait_for_async_insert carefully + monitoring
```

Good for:

- many small producers,
- observability-style workloads,
- low-latency event capture.

### 37.3 If Events Are Critical

Use:

```text
durable outbox/stream/spool + idempotent batches + reconciliation
```

Good for:

- audit,
- regulatory lifecycle,
- billing,
- security events.

### 37.4 If Volume Is Huge or Reprocessing Needed

Use:

```text
stream/broker or object-storage batch load
```

This is part 011 territory.

### 37.5 If Backfill Is Needed

Use:

```text
dedicated backfill path + checkpoint + throttle + large batch/file insert
```

Do not mix blindly with live request ingestion.

---

## 38. Exercises

### Exercise 1: Identify the Ingestion Risk

A product service receives 2,000 requests/s. Each request sends one analytics event directly to ClickHouse using one `INSERT VALUES` query.

Questions:

1. What will happen to part count?
2. What metrics would you inspect?
3. What is the first redesign?
4. Would async insert help?
5. What correctness issue appears on timeout retry?

Expected direction:

- high insert QPS creates small parts,
- inspect `system.query_log`, `system.parts`, `system.merges`,
- add batching or async insert,
- retry needs idempotency.

### Exercise 2: Design Batch Policy

You ingest case lifecycle events:

```text
average 3,000 events/s
peak 20,000 events/s
freshness SLA 10s
duplicates not acceptable for official reports
```

Design:

- batch rows/bytes/time,
- retry strategy,
- event_id strategy,
- dead-letter handling,
- monitoring.

### Exercise 3: Decide Drop Policy

Classify these events:

1. debug logs,
2. audit trail,
3. product click,
4. billing usage,
5. API latency metric.

For each, decide:

- can drop?
- can duplicate?
- durable required?
- freshness target?

### Exercise 4: Backfill Plan

You need to backfill 18 months of historical case events into a table that also receives live ingest.

Design:

- source range checkpoint,
- batch format,
- throttling,
- partition strategy,
- verification query,
- interaction with materialized views.

---

## 39. Common Anti-Patterns

### Anti-Pattern 1: Insert per HTTP Request

```text
one user request -> one ClickHouse insert
```

Bad because it couples application latency to analytics storage and creates tiny inserts.

### Anti-Pattern 2: ORM Entity Persistence

```text
entityManager.persist(analyticsEvent)
```

Bad because ClickHouse is not an OLTP entity store.

### Anti-Pattern 3: Infinite In-Memory Queue

Bad because ClickHouse slowdown becomes Java heap OOM.

### Anti-Pattern 4: Blind Retry with New Event IDs

Bad because it converts transient network failures into duplicate analytics.

### Anti-Pattern 5: No Dead-Letter

Bad because one poison batch can block the pipeline or be retried forever.

### Anti-Pattern 6: Backfill Through Live API

Bad because historical loading can overload the same path serving fresh events.

### Anti-Pattern 7: Too Many Flush Workers

Bad because it increases insert concurrency without increasing healthy throughput.

### Anti-Pattern 8: Assuming Async Insert Means No Batching Problem

Bad because async insert still needs correct settings, monitoring, and failure semantics.

### Anti-Pattern 9: Treating All Events Equally

Bad because debug logs, audit events, and billing usage have different durability/correctness requirements.

### Anti-Pattern 10: No Reconciliation

Bad because analytics pipelines fail silently unless you compare source counts, batch counts, and target counts.

---

## 40. Summary

ClickHouse ingestion architecture is not just about sending data quickly. It is about converting noisy application events into healthy columnar batches while preserving the correctness level required by the domain.

The most important lessons:

1. ClickHouse prefers batch inserts, not row-by-row writes.
2. Small inserts create part pressure and background merge debt.
3. Optimize for rows/bytes per insert, not insert query count.
4. Client-side batching is usually the best default when feasible.
5. Async insert helps when client batching is hard, but it changes reliability semantics.
6. Retry without idempotency can create duplicate analytics.
7. Batch-level dedup and event-level dedup solve different problems.
8. Backpressure is mandatory for production ingestion.
9. Durable ingestion is required for critical audit/billing/regulatory events.
10. Live ingest and backfill need different lanes.
11. Java ingestion should use explicit batch-oriented code, not ORM persistence.
12. Observability of ingestion is as important as query observability.

The core mental model:

```text
Application events are not rows to be persisted one by one.
They are analytical facts that must be shaped, batched, identified, validated,
and delivered to ClickHouse in a way that protects MergeTree health.
```

---

## 41. Referensi Utama

Referensi ini digunakan sebagai dasar teknis dan perlu dibaca langsung ketika menerapkan di produksi:

1. ClickHouse Docs — Selecting an insert strategy  
   https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy

2. ClickHouse Docs — Bulk inserts  
   https://clickhouse.com/docs/optimize/bulk-inserts

3. ClickHouse Docs — Asynchronous inserts  
   https://clickhouse.com/docs/optimize/asynchronous-inserts

4. ClickHouse Docs — Deduplicating inserts on retries  
   https://clickhouse.com/docs/guides/developer/deduplicating-inserts-on-retries

5. ClickHouse Docs — Deduplication strategies  
   https://clickhouse.com/docs/guides/developer/deduplication

6. ClickHouse Docs — Java client  
   https://clickhouse.com/docs/integrations/java

7. ClickHouse Docs — JDBC driver  
   https://clickhouse.com/docs/integrations/language-clients/java/jdbc

8. ClickHouse Docs — MergeTree table engine  
   https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree

9. ClickHouse Docs — System tables  
   https://clickhouse.com/docs/operations/system-tables

---

## 42. Status Seri

Part ini adalah:

```text
Part 010 dari 034
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 011 — Ingestion Architecture II: Streaming, CDC, Object Storage, and Batch Loads
```

Di part berikutnya kita akan membahas jalur ingestion yang lebih besar dan lebih terdistribusi:

- streaming ingestion,
- CDC dari OLTP ke ClickHouse,
- Kafka engine secara konseptual,
- object storage batch loads,
- file formats,
- replay dan reprocessing,
- late events,
- exactly-once illusion,
- dan architecture decision matrix untuk pipeline besar.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Data Types, Compression, Encoding, and Storage Cost Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-011.md">Part 011 — Ingestion Architecture II: Streaming, CDC, Object Storage, and Batch Loads ➡️</a>
</div>
