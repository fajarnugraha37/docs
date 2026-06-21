# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-003.md

# Part 003 — QuestDB Architecture Overview

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus part ini: membangun peta arsitektur internal QuestDB sebelum masuk ke storage, schema, ingestion, WAL, query, dan operasi produksi.

---

## 1. Tujuan Part Ini

Part sebelumnya membahas **posisi QuestDB**: apa yang dioptimalkan, kapan cocok, dan kapan bukan pilihan tepat. Part ini masuk satu tingkat lebih dalam: **bagaimana QuestDB tersusun sebagai sistem**.

Setelah menyelesaikan part ini, kamu harus bisa menjelaskan QuestDB bukan sebagai “database time-series yang bisa SQL”, tetapi sebagai gabungan beberapa subsistem:

```text
client producers
  -> ingestion endpoints
  -> WAL / write path
  -> table writer / apply pipeline
  -> native time-partitioned columnar storage
  -> SQL compiler + execution engine
  -> PGWire / HTTP query interface
  -> lifecycle / retention / Parquet / backup / replication surfaces
```

Yang ingin kita bangun bukan hafalan komponen, melainkan **mental model operasional**:

- Ketika Java service mengirim data, data itu masuk lewat jalur apa?
- Kapan write dianggap sukses?
- Kapan data terlihat oleh query?
- Komponen mana yang menjadi bottleneck ketika ingestion tinggi?
- Kenapa query tertentu cepat dan query lain lambat?
- Kenapa filesystem, page cache, memory mapping, dan native memory penting?
- Apa bedanya QuestDB sebagai proses database dengan library Java biasa?

Dokumentasi resmi QuestDB menjelaskan storage engine-nya sebagai kombinasi **row-based write path** untuk ingestion throughput dan **column-based read path** untuk query performance. Ini adalah clue arsitektural paling penting: QuestDB tidak menyimpan dan membaca data dengan model yang sama. Write path dan read path sengaja dipisahkan agar masing-masing bisa dioptimalkan.

---

## 2. Problem yang Sedang Diselesaikan QuestDB

QuestDB didesain untuk kelas workload yang sangat spesifik:

```text
banyak event masuk terus-menerus
  + timestamp sebagai axis utama
  + data biasanya immutable/append-mostly
  + query sering berupa range waktu, latest value, rollup, atau temporal join
  + latency query tetap harus rendah walaupun volume data besar
```

Sistem seperti ini punya tension alami:

| Kebutuhan | Konsekuensi Arsitektur |
|---|---|
| Ingestion sangat cepat | Write path harus minim random I/O dan minim koordinasi mahal |
| Query cepat atas range waktu | Storage harus time-partitioned dan column-friendly |
| SQL tetap nyaman | Butuh parser, optimizer, execution engine, dan PGWire compatibility |
| Data datang out-of-order | Write path harus bisa merge data ke partisi historis |
| Retry/replay mungkin duplicate | Butuh dedup/idempotency mechanism |
| Data bertambah tanpa henti | Butuh retention, TTL, tiering, dan cold storage |
| Sistem harus recover setelah crash | Butuh WAL/durability boundary |
| Java apps harus mudah integrasi | Butuh ILP client, JDBC/PGWire, HTTP, dan tooling familiar |

Kalau disederhanakan, QuestDB menyelesaikan masalah ini dengan lima keputusan besar:

```text
1. Timestamp menjadi physical organization axis.
2. Ingestion path dipisahkan dari query path.
3. Data durable lebih dulu di WAL, lalu diterapkan ke storage secara asynchronous.
4. Storage query-optimized berbasis columnar/time partition.
5. Interface eksternal dibuat familiar: ILP untuk ingestion, SQL/PGWire untuk query.
```

---

## 3. Architectural Bird’s-Eye View

Secara konseptual, QuestDB dapat dibaca seperti ini:

```text
                         +----------------------+
                         |      Web Console     |
                         | HTTP SQL / CSV / UI  |
                         +----------+-----------+
                                    |
                                    v
+----------------+        +----------------------+        +----------------------+
| Java Services  | -----> |  Ingestion Endpoints | -----> |   WAL / Sequencer    |
| Sensors        | ILP    |  ILP TCP / ILP HTTP  |        |   Commit Boundary    |
| Kafka Sinks    |        |  REST / PGWire insert|        +----------+-----------+
+----------------+        +----------+-----------+                   |
                                    |                               v
                                    |                    +----------------------+
                                    |                    | WAL Apply / Writers  |
                                    |                    | O3 Merge / Dedup     |
                                    |                    +----------+-----------+
                                    |                               |
                                    v                               v
                         +----------------------+        +----------------------+
                         |   SQL Front Doors    | <----> | Native Table Storage |
                         | PGWire / HTTP SQL    |        | Time Partitions      |
                         +----------+-----------+        | Column Files         |
                                    |                    | Symbol Dictionaries  |
                                    v                    | Parquet Older Tiers  |
                         +----------------------+        +----------------------+
                         | SQL Compiler /       |
                         | Optimizer / Executor |
                         +----------------------+
```

Jangan anggap diagram ini sebagai implementasi literal satu thread satu kotak. Ini adalah peta mental. Dalam database nyata, batas antarkomponen bisa berbagi thread pool, memory region, file descriptor, dan lock. Tetapi sebagai arsitek aplikasi, peta ini cukup untuk memahami aliran data.

---

## 4. Komponen Utama QuestDB

## 4.1 Ingestion Endpoints

QuestDB memiliki beberapa pintu masuk data:

| Interface | Fungsi Utama | Cocok Untuk |
|---|---|---|
| ILP TCP | High-throughput streaming ingestion | Producers internal, high-rate metrics/ticks |
| ILP HTTP | Ingestion via HTTP-friendly path | Cloud/network-friendly ingestion, managed environments |
| PGWire INSERT | Lower-volume insert via SQL | Admin task, small apps, compatibility |
| REST / CSV import | Bootstrap/import/manual load | Dev, migration, initial load |
| Embedded Java API | In-process use cases tertentu | Niche, test, specialized embedding |

Yang paling penting: **ILP adalah jalur ingestion utama**, sedangkan **PGWire adalah jalur query utama**. QuestDB mendukung INSERT lewat PGWire, tetapi dokumentasi menekankan bahwa high-throughput ingestion sebaiknya memakai client/protokol ingestion QuestDB.

Untuk Java engineer, ini berarti kamu sebaiknya tidak mendesain ingestion besar dengan pola:

```java
jdbcTemplate.batchUpdate("INSERT INTO metrics ...")
```

untuk semua telemetry. Itu mungkin valid untuk volume kecil, tetapi bukan jalur yang sejalan dengan design center QuestDB.

Pola yang lebih tepat:

```text
Java producer / collector
  -> QuestDB ILP Java client
  -> batch/flush controlled by application
  -> WAL-backed table
  -> query via JDBC/PGWire from read-side service
```

## 4.2 WAL and Sequencing Layer

Write-Ahead Log adalah salah satu batas arsitektur paling penting. Pada table WAL, write tidak langsung berarti “row sudah tersusun final di column files”. Secara konseptual:

```text
client sends rows
  -> rows appended to WAL segment
  -> commit acknowledged
  -> WAL apply job later merges data into table storage
  -> row becomes visible to query after apply
```

Dokumentasi QuestDB menjelaskan bahwa WAL apply job melakukan merge data ke table storage secara asynchronous, sehingga commit cepat dapat dipisahkan dari pekerjaan storage application yang lebih mahal.

Implikasi penting:

- Write success bukan selalu sama dengan immediate query visibility.
- Freshness harus dimonitor, bukan diasumsikan.
- Ada metrik/indikator seperti lag antara committed transaction dan applied transaction.
- Backpressure bisa muncul bukan hanya di network/client, tetapi di WAL apply pipeline.
- Crash recovery membaca WAL untuk memastikan perubahan committed dapat diterapkan.

Untuk Java engineer, analoginya bukan seperti `ConcurrentHashMap.put()` yang langsung visible. Lebih mirip:

```text
append durable command log
  -> acknowledge
  -> background materializer updates read model
```

Dengan kata lain, WAL table memiliki rasa seperti **event log + materialized storage**, walaupun tetap berada di dalam database.

## 4.3 Table Writer and Apply Pipeline

Setelah WAL menerima perubahan, pekerjaan berikutnya adalah menerapkan perubahan ke storage table. Di sinilah QuestDB harus menangani:

- append in-order;
- out-of-order rows;
- partition routing;
- symbol dictionary updates;
- deduplication jika aktif;
- merge ke column files;
- transaction visibility;
- table suspension jika terjadi error serius.

Untuk in-order append, pekerjaan relatif murah. Untuk out-of-order ingestion, QuestDB harus memasukkan data ke lokasi historis yang mungkin sudah memiliki data. Ini dapat menyebabkan merge, split, atau rewrite pada bagian tertentu dari partisi.

Mental model:

```text
in-order data:
  mostly append to hot partition

out-of-order data:
  locate historical partition
  merge incoming rows with existing rows
  maintain sorted/time-aware layout
  update metadata and visibility
```

Jadi, walaupun QuestDB mendukung out-of-order data, bukan berarti out-of-order ingestion gratis.

## 4.4 Native Time-Partitioned Columnar Storage

Read path QuestDB diarahkan ke storage yang time-aware dan column-oriented. Table biasanya memiliki designated timestamp dan partitioning by time. Partisi adalah boundary fisik untuk:

- pruning query;
- retention/drop data lama;
- Parquet conversion;
- attach/detach partition;
- limiting blast radius out-of-order writes;
- backup/lifecycle operations.

Di dalam partisi, data disimpan secara column-oriented. Artinya query seperti:

```sql
SELECT avg(cpu_usage)
FROM host_metrics
WHERE ts >= dateadd('h', -1, now())
  AND host = 'api-17';
```

seharusnya tidak perlu membaca semua kolom seperti `region`, `rack`, `kernel_version`, `disk_io`, `network_rx`, `network_tx`, dan seterusnya apabila tidak diperlukan oleh query.

Ini berbeda dari row-store OLTP, di mana satu row sering menjadi unit akses utama.

## 4.5 Symbol Dictionaries

QuestDB memiliki tipe `SYMBOL` untuk nilai string kategorikal yang sering diulang, seperti:

- ticker;
- host;
- device_id;
- exchange;
- region;
- service_name;
- sensor_type.

Secara mental, `SYMBOL` adalah cara database mengubah repeated strings menjadi representation yang lebih efisien untuk storage dan lookup. Tapi symbol bukan magic. Cardinality tinggi tetap mahal.

Contoh symbol yang biasanya masuk akal:

```text
region: ap-southeast-1, eu-west-1, us-east-1
exchange: NYSE, NASDAQ, LSE
service: auth, billing, risk, gateway
```

Contoh yang berbahaya:

```text
request_id: unique per request
trace_id: unique per trace
user_agent: effectively unbounded
raw_error_message: high cardinality / long string
```

Part khusus symbol/index/cardinality akan dibahas nanti, tetapi dari arsitektur kita sudah perlu memahami: symbol dictionary adalah bagian dari storage/query path, sehingga desain cardinality memengaruhi ingestion, memory, query, dan metadata.

## 4.6 SQL Compiler, Optimizer, and Execution Engine

QuestDB menerima SQL melalui Web Console, HTTP query endpoint, dan PGWire. SQL ini harus melewati pipeline:

```text
SQL text
  -> parse
  -> validate names/types/functions
  -> build logical plan
  -> optimize using time predicates, partitions, symbol filters, join shape
  -> execute over column files / partitions / materialized views / parquet tiers
  -> return result through PGWire/HTTP/UI
```

Sebagai Java engineer, kamu sebaiknya tidak melihat SQL sebagai string netral. SQL adalah cara kita meminta database melakukan pekerjaan fisik tertentu.

Dua query yang terlihat mirip bisa memiliki biaya sangat berbeda:

```sql
-- bounded, partition-prunable
SELECT avg(value)
FROM metrics
WHERE ts >= dateadd('m', -5, now())
  AND metric = 'cpu';
```

vs

```sql
-- unbounded, potentially dangerous
SELECT avg(value)
FROM metrics
WHERE metric = 'cpu';
```

Perbedaan utamanya bukan `avg`, tetapi **bounded time range**. Pada TSDB, time predicate sering menjadi perbedaan antara query yang menyentuh beberapa partisi dan query yang menyapu seluruh sejarah.

## 4.7 PGWire Interface

QuestDB mengimplementasikan PostgreSQL Wire Protocol agar client dan tooling PostgreSQL dapat dipakai. Untuk Java, ini berarti JDBC PostgreSQL driver dapat digunakan untuk query.

Namun, PGWire compatibility bukan berarti QuestDB adalah PostgreSQL. Ini penting.

Yang diberikan PGWire:

- koneksi familiar;
- JDBC compatibility;
- BI/tooling compatibility;
- query via SQL;
- lower-volume INSERT capability.

Yang tidak boleh diasumsikan:

- full PostgreSQL feature parity;
- PostgreSQL transaction semantics penuh;
- PostgreSQL optimizer behavior;
- PostgreSQL extension model;
- OLTP workload suitability.

Mental model yang sehat:

```text
PGWire is a protocol compatibility layer, not a promise that QuestDB behaves like PostgreSQL internally.
```

## 4.8 Web Console and HTTP Layer

QuestDB juga menyediakan Web Console dan HTTP endpoints. Web Console berguna untuk:

- eksplorasi SQL;
- debugging table/schema;
- CSV import;
- melihat data secara cepat;
- admin/developer workflow.

Dalam production system, jangan jadikan Web Console sebagai primary application integration. Treat it as operator/developer surface, bukan high-volume application API.

## 4.9 Configuration and Process Boundary

QuestDB adalah proses database dengan konfigurasi seperti:

- port HTTP/Web Console/ILP HTTP;
- port PGWire;
- ILP TCP settings;
- worker pools;
- WAL settings;
- table/storage settings;
- memory settings;
- telemetry/metrics;
- security/authentication options.

Dokumentasi QuestDB menempatkan konfigurasi utama di `server.conf`, dengan restart diperlukan untuk banyak perubahan konfigurasi. Dalam deployment modern, konfigurasi ini biasanya dikelola lewat file, environment variables, Helm values, atau container orchestration.

---

## 5. QuestDB as a Java Engineer: What Is Familiar and What Is Not

Karena kamu Java engineer, ada godaan untuk memetakan QuestDB ke hal-hal familiar:

| Familiar Java Concept | QuestDB Equivalent-ish | Perbedaan Penting |
|---|---|---|
| Append log | WAL | WAL internal database, bukan public event stream seperti Kafka |
| Materialized read model | Columnar table after WAL apply | Query visibility tergantung apply progress |
| JDBC query | PGWire SQL | Bukan PostgreSQL semantics penuh |
| Batch writer | ILP client batching | Flush/backpressure harus dipikirkan eksplisit |
| Object lifecycle | Table lifecycle | Data lifecycle berbasis partition/time |
| GC memory pressure | JVM heap pressure | QuestDB juga sangat bergantung native memory/page cache/mmap |
| Background executor | WAL apply / workers | Worker starvation memengaruhi freshness/query |

Yang paling tidak familiar biasanya adalah **native memory + filesystem/page cache**.

Banyak Java service biasa memusatkan performance tuning pada:

```text
heap size
GC pause
thread pool
connection pool
CPU
```

QuestDB tetap butuh CPU dan memory, tetapi database ini juga sangat sensitif terhadap:

```text
filesystem latency
SSD throughput
fsync/write pattern
Linux page cache
mmap behavior
file descriptor limit
partition file count
native memory fragmentation/pressure
container memory limits
```

Jadi, ketika QuestDB lambat, jangan langsung mencari “GC problem”. Bisa jadi bottleneck ada pada disk, page cache miss, WAL apply backlog, bad query scanning terlalu banyak partisi, cardinality explosion, atau out-of-order storm.

---

## 6. Data Flow: From Java Producer to Query Result

Mari ambil contoh service Java mengirim telemetry host:

```text
measurement: host_metrics
symbols: host, region, service
fields: cpu_usage, mem_used, load_avg
 timestamp: event time from host agent
```

### 6.1 Write Flow

```text
Host agent / Java collector
  -> builds ILP line
  -> batches lines in ILP client
  -> flushes over TCP/HTTP
  -> QuestDB ingestion endpoint parses line
  -> table/column resolution
  -> WAL segment append
  -> commit acknowledgement
  -> WAL apply job merges rows into table storage
  -> rows become query-visible
```

Potential failure/bottleneck points:

| Stage | Possible Problem |
|---|---|
| Java collector | bad timestamp, wrong units, buffer growth |
| ILP formatting | invalid line, wrong type, schema pollution |
| Network | connection drop, timeout, partial send |
| Ingestion endpoint | parse pressure, auth failure, rate burst |
| WAL append | disk full, fsync latency, WAL segment growth |
| WAL apply | out-of-order merge cost, symbol update pressure |
| Storage | partition hot spot, file pressure, page cache pressure |
| Query visibility | freshness lag |

### 6.2 Read Flow

```text
Java API service
  -> JDBC/PGWire connection
  -> SQL query with bounded time predicate
  -> QuestDB parses/optimizes query
  -> partition pruning by designated timestamp
  -> column scans for required columns
  -> symbol filter / aggregation / temporal join
  -> result encoded over PGWire
  -> Java maps rows to response DTO
```

Potential failure/bottleneck points:

| Stage | Possible Problem |
|---|---|
| API service | unbounded query from user input |
| JDBC pool | too many concurrent expensive queries |
| SQL planning | missing time predicate, function prevents pruning |
| Execution | full historical scan, high-cardinality group by |
| Storage | cold data, page cache miss, Parquet tier latency |
| Network/result | huge result set, no downsampling/pagination |

Architecture lesson: **ingestion and query have different risks**. A good QuestDB integration treats them as separate flows with separate guardrails.

---

## 7. The Most Important Internal Boundaries

## 7.1 Commit Boundary vs Query Visibility Boundary

On WAL tables, these are not always the same:

```text
commit acknowledged
  != always immediately visible to SELECT
```

This is not a bug; it is a consequence of decoupling fast WAL commit from storage apply.

Production implication:

- Define ingestion freshness SLO.
- Monitor WAL apply lag.
- Avoid assuming read-after-write for high-rate ingestion tables unless validated.
- For control-plane data that requires immediate consistency, QuestDB may not be the right primary store.

## 7.2 Hot Path vs Cold Path

QuestDB storage lifecycle can be understood as:

```text
hot path:
  current/recent partitions
  native storage
  high ingest/high query locality

warm/cold path:
  older partitions
  possibly Parquet/tiered storage
  lower write activity
  retention/cost optimized
```

Do not design every query as if all data is equally hot. Time-series systems depend on the fact that recent data is accessed more often.

## 7.3 Physical Time Boundary

A table’s designated timestamp is not just a logical column. It determines physical behavior:

- row ordering;
- partition assignment;
- interval scan efficiency;
- out-of-order merge scope;
- retention/drop partition behavior.

Choosing the wrong timestamp is equivalent to choosing the wrong clustering key in a distributed database or the wrong primary access path in an OLTP system.

## 7.4 Protocol Boundary

QuestDB exposes multiple protocols, but they are not interchangeable:

```text
ILP:
  optimized for ingestion

PGWire:
  optimized for query/client compatibility

HTTP/Web Console:
  operational/dev/admin convenience
```

Using the wrong protocol for the wrong workload creates avoidable problems.

---

## 8. QuestDB Is Not “Just a Java App”

Although QuestDB is accessible from Java and has Java components, production operation behaves like a database engine close to the operating system.

Important OS-level realities:

## 8.1 Memory-Mapped Files and Page Cache

Column files can benefit heavily from OS page cache. Query performance may be excellent when data is hot in cache and much slower when data is cold.

This creates benchmark traps:

```text
first run:
  cold cache, reads from disk

second run:
  warm cache, reads mostly from memory/page cache
```

A benchmark that only measures the second run may lie to you.

## 8.2 Native Memory

Native memory matters. Container memory limits matter. If you deploy QuestDB in Kubernetes with tight memory but assume only JVM heap counts, you can create instability.

Operational implication:

```text
container memory limit
  must account for heap + native memory + mmap/page cache behavior + OS overhead
```

## 8.3 Filesystem and Disk

TSDB workload is write-heavy and file-heavy. Disk is not passive storage; it is part of the performance envelope.

You must care about:

- SSD class;
- write latency;
- sustained throughput;
- fsync behavior;
- filesystem mount options;
- inode/file count;
- backup/snapshot mechanism;
- noisy neighbor I/O.

## 8.4 Time and Clock

Time-series database correctness depends on time semantics. If producers have bad clocks, QuestDB will faithfully store bad timestamps.

Database architecture cannot fix all upstream time mistakes.

---

## 9. Architecture Smells

These smells indicate that the team may be misunderstanding QuestDB’s architecture.

## 9.1 “We Will Query Without Time Filters”

Bad sign:

```sql
SELECT * FROM events WHERE user_id = 'u-123';
```

on a giant time-series table without a time bound.

This smells like search/OLTP access pattern, not TSDB access pattern.

Better:

```sql
SELECT *
FROM events
WHERE ts >= dateadd('d', -7, now())
  AND user_id = 'u-123';
```

Even then, evaluate whether QuestDB is the right primary store for user-centric history lookup.

## 9.2 “Use JDBC Batch Insert for All Metrics”

This ignores QuestDB’s ingestion architecture. JDBC/PGWire insert can work for low volume, but high-throughput telemetry should use ILP clients.

## 9.3 “Every Field Is a Symbol”

Symbols are powerful for repeated categorical values. They are dangerous for unbounded identifiers.

## 9.4 “QuestDB Replaces Kafka”

QuestDB stores queryable time-series data. Kafka is a replayable distributed log/broker. They can complement each other, but substituting one for the other usually breaks failure/replay/backpressure assumptions.

## 9.5 “WAL Means Exactly-Once”

WAL provides durability/recovery boundary inside QuestDB. It does not magically make upstream producers exactly-once. Idempotency still requires careful key/dedup design.

## 9.6 “Parquet Means It Is a Lakehouse”

Parquet support/tiering improves lifecycle and portability, but QuestDB remains a time-series database optimized for specific workloads. Do not confuse storage format interoperability with full lakehouse governance/compute semantics.

---

## 10. Architectural Comparison Without Repeating Previous Series

This section is deliberately brief. The goal is to frame boundaries, not re-teach other systems.

| System | Primary Architecture Center | QuestDB Difference |
|---|---|---|
| PostgreSQL | transactional relational row-store | QuestDB optimizes append-heavy time-series and temporal SQL, not general OLTP |
| ClickHouse | broad OLAP columnar analytics | QuestDB prioritizes time-series ingestion/query latency and temporal semantics |
| Kafka | durable distributed log | QuestDB is queryable storage, not stream coordination/replay substrate |
| Redis | in-memory data structure/cache | QuestDB stores long-running temporal history with SQL queries |
| Elasticsearch | inverted-index search | QuestDB is time/range/aggregate oriented, not full-text relevance search |
| ScyllaDB | distributed wide-column low-latency KV/access paths | QuestDB is single logical TSDB storage engine with SQL/time partition semantics |
| Prometheus | metrics scraping + TSDB + alerting ecosystem | QuestDB can serve metrics-like data but is not a drop-in Prometheus replacement |

The practical rule:

```text
Choose QuestDB when the primary access path is time.
Be cautious when the primary access path is entity, document, text, transaction, or queue position.
```

---

## 11. Production Architecture Patterns

## 11.1 Direct Producer to QuestDB

```text
Java service / collector
  -> ILP client
  -> QuestDB
```

Good for:

- simple topology;
- low operational overhead;
- data loss acceptable within client retry/buffer limits;
- producers controlled by same team;
- moderate to high ingestion where direct write is manageable.

Risks:

- QuestDB downtime directly affects producers;
- replay capacity limited unless producer has durable buffer;
- producer retry can cause duplicates unless dedup/idempotency designed.

## 11.2 Brokered Ingestion

```text
Java producers
  -> Kafka/RabbitMQ
  -> ingestion workers
  -> QuestDB ILP
```

Good for:

- replay requirement;
- decoupling producers from QuestDB availability;
- multi-consumer architecture;
- backpressure isolation;
- audit/reprocessing.

Risks:

- more moving parts;
- duplicate/replay semantics must be explicit;
- ordering key matters;
- ingestion workers become architecture-critical.

## 11.3 Query Serving Layer

```text
Frontend/dashboard/API
  -> Java query service
  -> PGWire/JDBC
  -> QuestDB
```

Good for:

- enforcing time bounds;
- controlling query templates;
- applying authorization/tenant filters;
- caching small metadata;
- preventing ad-hoc expensive query from user-facing path.

Risks:

- service becomes bottleneck if result sets too large;
- poorly designed endpoints can still generate unbounded scans;
- pagination/downsampling must be domain-aware.

## 11.4 Hot QuestDB + Cold Lake

```text
live ingestion
  -> QuestDB hot/warm store
  -> Parquet/object storage/cold archive
  -> external analytics if needed
```

Good for:

- cost control;
- long retention;
- ML/offline analytics;
- separation of real-time serving and historical exploration.

Risks:

- lifecycle complexity;
- governance/lineage requirements;
- cold query expectations must be communicated.

---

## 12. Failure Model by Component

A good architect can explain how the system fails.

| Component | Failure | Symptom | First Diagnostic Question |
|---|---|---|---|
| Producer | bad timestamp/unit | data appears in wrong time range | Are timestamps event time and correct unit? |
| ILP client | buffer grows | producer memory pressure | Is QuestDB reachable and flush succeeding? |
| Network | intermittent disconnect | retries/duplicates | Is client idempotent? |
| Parser/schema | invalid lines | missing data/schema pollution | Are producer contracts tested? |
| WAL | disk full/slow | write failure or high latency | Is WAL disk healthy and spacious? |
| WAL apply | lag | data written but not visible | Is apply behind sequencer? |
| Storage | partition pressure | slow query/write merge | Is ingestion out-of-order or partition too coarse? |
| SQL engine | expensive query | CPU/memory spike | Is query bounded by time? |
| Page cache | cold reads | variable query latency | Is data hot, warm, or cold? |
| Symbol dictionary | high cardinality | memory/storage/query pressure | Which dimension is exploding? |
| Deployment | container limit | OOM/restart | Are native memory and page cache considered? |

This table is more valuable than memorizing configuration names. It teaches where to look first.

---

## 13. Mini Lab: Draw Your Own QuestDB Architecture

Before writing code, do this exercise for any proposed QuestDB use case.

### Step 1: Identify Producers

```text
producer name:
rate rows/sec:
burst rows/sec:
timestamp source:
retry behavior:
can replay? yes/no:
```

### Step 2: Identify Ingestion Path

```text
protocol: ILP TCP / ILP HTTP / PGWire / CSV
batching strategy:
flush interval:
max buffer:
failure action:
dedup needed? yes/no:
```

### Step 3: Identify Table Storage Shape

```text
table:
designated timestamp:
partition granularity:
symbol columns:
high cardinality risk:
retention:
```

### Step 4: Identify Query Path

```text
query consumer:
protocol: PGWire / HTTP / console
query time window:
max result size:
aggregation needed:
materialized view needed? yes/no:
```

### Step 5: Identify Failure/Recovery

```text
what if QuestDB is down for 10 minutes?
what if producer retries duplicate data?
what if data arrives 3 days late?
what if disk is 90% full?
what if dashboard query scans 1 year?
what if WAL apply lags by 5 minutes?
```

If you cannot answer these, the architecture is not production-ready.

---

## 14. Checklist: QuestDB Architecture Understanding

Use this checklist before moving to schema design.

```text
[ ] I know which producers write to QuestDB.
[ ] I know whether producers use ILP, PGWire, CSV, or another path.
[ ] I understand that ILP is ingestion-focused and PGWire is query-focused.
[ ] I know what the designated timestamp means physically.
[ ] I know the difference between commit acknowledged and query visible for WAL tables.
[ ] I know how WAL apply lag can affect freshness.
[ ] I know which tables are hot and which are historical.
[ ] I know which queries must be bounded by time.
[ ] I know which columns are candidates for SYMBOL and which are dangerous.
[ ] I know that QuestDB performance depends on disk, filesystem, page cache, and native memory.
[ ] I know where QuestDB fits relative to Kafka, PostgreSQL, ClickHouse, and Elasticsearch.
[ ] I can draw the write path and read path separately.
[ ] I can name the first five diagnostics for ingestion or query slowness.
```

---

## 15. Key Takeaways

QuestDB should be understood as a **time-oriented storage and query engine**, not as a generic SQL database with a timestamp column.

The most important architecture ideas are:

```text
1. QuestDB separates ingestion and query concerns.
2. ILP is the primary high-throughput ingestion path.
3. PGWire is the primary programmatic query path.
4. WAL decouples fast commit from storage apply.
5. Query visibility can lag behind commit under WAL apply pressure.
6. Physical storage is time-partitioned and column-oriented.
7. Designated timestamp is a physical design decision.
8. SYMBOL helps repeated categorical values but punishes careless cardinality.
9. Filesystem, page cache, and native memory are part of the database performance model.
10. A good QuestDB architecture has explicit ingestion, query, lifecycle, and failure boundaries.
```

The next part will zoom into the **QuestDB data model**: designated timestamp, `TIMESTAMP` vs `TIMESTAMP_NS`, `SYMBOL`, strings, numeric fields, wide vs narrow tables, and how to model real telemetry/tick/event data without creating long-term operational debt.

---

## 16. Preview Part 004

File berikutnya:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-004.md
```

Judul:

```text
Data Model: Timestamp, Symbol, Column Type, and Table Shape
```

Pertanyaan utama part berikutnya:

```text
Given a domain event, how do we choose the QuestDB table shape that will remain queryable, ingestible, and operable after 10x data growth?
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — QuestDB Positioning: What It Is Optimized For</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-004.md">Data Model: Timestamp, Symbol, Column Type, and Table Shape ➡️</a>
</div>
