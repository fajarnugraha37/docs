# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-006.md

# Part 006 — Ingestion Model: ILP, PGWire, REST, CSV, and Embedded Java

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus part ini: memahami seluruh jalur masuk data ke QuestDB, membedakan ingestion path dan query path, serta memilih mekanisme ingestion yang benar untuk workload produksi.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu harus bisa menjawab pertanyaan arsitektural berikut dengan percaya diri:

1. Kenapa QuestDB punya beberapa ingestion path?
2. Kenapa **ILP** adalah jalur utama untuk high-throughput ingestion?
3. Kenapa **PGWire** nyaman untuk query, tetapi bukan default terbaik untuk ingestion besar?
4. Kapan memakai HTTP ILP, TCP ILP, REST API, CSV import, JDBC insert, atau embedded Java?
5. Apa konsekuensi ingestion path terhadap latency, throughput, durability, schema control, observability, dan failure handling?
6. Bagaimana mendesain ingestion gateway Java yang tidak menghancurkan QuestDB ketika load naik?

Part ini tidak membahas Java ILP client sampai detail kode produksi. Itu akan dibahas khusus di part 007. Di sini kita membangun **mental model ingestion surface** terlebih dahulu.

---

## 2. Problem yang Sedang Diselesaikan

Di database umum, engineer sering berpikir:

```text
Saya punya data → saya INSERT ke database → selesai.
```

Untuk time-series database, cara berpikir ini terlalu dangkal.

Pada workload time-series, data biasanya memiliki karakteristik:

```text
- volume tinggi
- append-heavy
- banyak producer
- event datang terus-menerus
- kadang out-of-order
- kadang duplicate karena retry/replay
- freshness penting
- query butuh range waktu spesifik
- data lama harus expired/ditier/drop
```

Karena itu, ingestion bukan sekadar operasi SQL. Ingestion adalah **subsystem**.

Subsystem ingestion harus menjawab:

```text
Bagaimana data masuk?
Seberapa cepat?
Dalam format apa?
Apakah producer bisa retry?
Apakah duplicate aman?
Apakah schema boleh berubah otomatis?
Apakah timestamp berasal dari producer atau server?
Apa yang terjadi kalau QuestDB lambat?
Apa yang terjadi kalau jaringan putus?
Apa yang terjadi kalau satu batch berisi baris invalid?
```

QuestDB menyediakan beberapa jalur ingestion karena tidak semua workload punya kebutuhan yang sama.

---

## 3. Mental Model Utama: Separate the Write Plane from the Query Plane

Mental model pertama:

```text
QuestDB memiliki write plane dan query plane.
```

Write plane adalah jalur untuk memasukkan data.

Query plane adalah jalur untuk membaca, menganalisis, dan mengoperasikan data.

Dalam QuestDB, pemisahan praktisnya biasanya seperti ini:

```text
High-throughput write plane:
  - ILP over HTTP
  - ILP over TCP
  - first-party language clients
  - Kafka Connect / ingestion connectors, bila digunakan

Query/control plane:
  - PGWire / JDBC / PostgreSQL-compatible clients
  - Web Console
  - REST API / HTTP endpoints
  - SQL DDL/DML untuk operasi yang cocok

Bulk/bootstrap plane:
  - CSV import
  - copy/import utilities
  - batch backfill pipelines

Special embedded plane:
  - embedded QuestDB engine in JVM process
```

Kesalahan umum adalah memakai satu jalur untuk semua hal.

Contoh buruk:

```text
Semua producer Java melakukan INSERT via JDBC karena sudah familiar dengan PostgreSQL.
```

Ini mungkin berhasil untuk data kecil, tetapi tidak selaras dengan desain QuestDB untuk ingestion throughput tinggi.

Contoh lebih sehat:

```text
Producer service → ILP client → QuestDB ingestion endpoint
Dashboard/API → JDBC/PGWire → QuestDB SQL
Operator/manual query → Web Console/PGWire
Historical load → CSV/ILP batch pipeline
```

---

## 4. QuestDB Ingestion Surface Overview

QuestDB dapat menerima data melalui beberapa jalur utama:

| Jalur | Fungsi Utama | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|---|
| ILP over HTTP | high-throughput streaming ingestion | production ingestion, easier debugging, cloud/proxy friendly | interactive SQL query |
| ILP over TCP | low-overhead ingestion path legacy/advanced | internal network, specific low-latency setup | debugging mudah, modern default umum |
| First-party clients | wrapper aman/cepat untuk ILP | Java/Go/.NET/Python/Rust/etc producers | arbitrary SQL query |
| PGWire/JDBC | SQL query dan compatibility | dashboard, API query, ad-hoc SQL, admin SQL | sustained massive ingestion |
| REST API | HTTP control/query/import surfaces | operational integration, simple HTTP access | highest-throughput continuous ingestion |
| CSV import | bootstrap/bulk load | initial load, manual import, controlled batch | live streaming high-frequency data |
| Embedded Java | QuestDB engine in same process | tests, specialized embedded system, local analytics | most distributed production deployments |

Rule awal:

```text
Use ILP for ingestion.
Use PGWire for query.
Use CSV/import path for controlled bootstrap/backfill.
Use embedded Java only when you deliberately want database engine lifecycle inside your JVM process.
```

---

## 5. ILP: InfluxDB Line Protocol as QuestDB's Ingestion Workhorse

### 5.1 Apa Itu ILP?

ILP adalah format baris untuk mengirim measurement, tags, fields, dan timestamp.

Bentuk konseptualnya:

```text
measurement,tag1=value1,tag2=value2 field1=123,field2=45.6 timestamp
```

Dalam QuestDB, mapping konseptualnya:

```text
measurement  → table name
tag          → SYMBOL-like dimension
field        → value column
timestamp    → designated timestamp candidate/event timestamp
```

Contoh:

```text
sensor_reading,tenant=acme,device_id=d-1001,site=plant-a temperature=31.7,pressure=9.81 1719000000000000000
```

Secara mental:

```text
ILP bukan SQL.
ILP adalah append protocol.
ILP dirancang agar producer bisa mengirim banyak row dengan overhead rendah.
```

QuestDB documentation menyatakan first-party clients memakai ILP dan direkomendasikan untuk production high-throughput ingestion karena ILP insert-only dan bypass SQL `INSERT` statement overhead.

### 5.2 Kenapa ILP Cocok untuk Time-Series?

Karena time-series ingestion biasanya:

```text
- append-heavy
- repetitif
- row kecil
- banyak tag/dimension berulang
- timestamp-driven
- perlu batching
- perlu throughput tinggi
```

SQL `INSERT` punya overhead parsing, planning, dan statement semantics yang lebih umum. Untuk jutaan point per detik, overhead itu menjadi mahal.

ILP mengurangi friction:

```text
producer emits lines
client batches lines
QuestDB parses line protocol
QuestDB maps measurement/tags/fields to table/columns
QuestDB appends into WAL/storage path
```

### 5.3 ILP Tidak Untuk Query

Ini penting:

```text
ILP adalah ingestion-only protocol.
```

Kamu tidak melakukan:

```text
SELECT avg(temp) FROM sensor_reading SAMPLE BY 1m
```

melalui ILP.

Untuk query, gunakan:

```text
- PGWire/JDBC
- Web Console
- REST/HTTP query endpoint bila sesuai
```

Pemisahan ini membantu desain aplikasi:

```text
TelemetryWriterService memakai ILP.
TelemetryQueryService memakai JDBC/PGWire.
```

Jangan campur kedua concern dalam satu abstraction yang kabur.

---

## 6. ILP over HTTP vs ILP over TCP

QuestDB mendukung ILP melalui HTTP dan TCP. Pilihan ini harus dilihat sebagai trade-off operasional.

### 6.1 ILP over HTTP

Cocok untuk sebagian besar deployment modern karena:

```text
- lebih mudah diproxy/load-balance
- lebih mudah diamati/debug
- request/response semantics lebih eksplisit
- lebih natural untuk TLS/cloud/network policy
- failure lebih mudah dipetakan ke status/error response
- batching via request body sederhana
```

Bentuk mental:

```text
producer accumulates batch
POST /write
QuestDB receives batch
client observes response
on failure: retry according to policy
```

Keunggulan HTTP bukan selalu raw latency terendah, tetapi **operational clarity**.

Untuk tim enterprise, clarity sering lebih berharga daripada mikro-optimasi awal.

### 6.2 ILP over TCP

Cocok untuk kasus:

```text
- network internal sangat terkontrol
- latency overhead HTTP ingin diminimalkan
- producer connection long-lived
- engineer siap mengelola connection lifecycle dan failure ambiguity
```

Namun TCP punya konsekuensi:

```text
- debugging bisa lebih sulit
- partial write/failure semantics lebih tricky
- proxy/LB/TLS setup bisa lebih rumit
- backpressure perlu lebih hati-hati
```

Rule praktis:

```text
Mulai dari ILP over HTTP untuk production kecuali ada alasan kuat memilih TCP.
Gunakan first-party client agar detail protocol tidak dikelola manual.
```

---

## 7. First-Party Clients: Jangan Tulis Line Protocol Manual Jika Tidak Perlu

QuestDB menyediakan first-party clients untuk banyak bahasa, termasuk Java.

Untuk Java engineer, manfaat client resmi:

```text
- encoding type lebih aman
- batching lebih mudah
- timestamp handling lebih eksplisit
- connection management lebih standar
- error handling lebih terstruktur
- retry/failover lebih mudah dikembangkan
- mengurangi bug escaping/format ILP manual
```

Anti-pattern:

```java
String line = table + ",device=" + deviceId + " value=" + value + " " + timestamp;
httpClient.post("/write", line);
```

Kenapa buruk?

```text
- escaping tag/field/table name rawan salah
- null handling tidak jelas
- numeric type bisa salah
- timestamp unit bisa salah
- batch boundary tidak disiplin
- failure tidak terstandar
- producer sulit diuji
```

Lebih sehat:

```text
Domain event
  → typed ingestion adapter
  → QuestDB ILP client
  → controlled batch/flush/retry
```

Part 007 nanti akan masuk ke detail Java client.

---

## 8. PGWire: PostgreSQL Wire Protocol for Query and SQL Compatibility

### 8.1 Apa Itu PGWire di QuestDB?

PGWire adalah protocol PostgreSQL-compatible yang memungkinkan client PostgreSQL standar berbicara dengan QuestDB.

Untuk Java engineer, ini berarti kamu bisa memakai:

```text
- JDBC PostgreSQL driver
- connection pool seperti HikariCP
- BI tools yang support PostgreSQL
- SQL clients seperti DBeaver/DataGrip
- migration tools tertentu untuk DDL yang compatible
```

Tapi mental model penting:

```text
QuestDB speaks PGWire.
QuestDB is not PostgreSQL.
```

Compatibility protocol bukan berarti full PostgreSQL behavior.

### 8.2 PGWire Sangat Berguna Untuk Query

PGWire cocok untuk:

```text
- dashboard query
- service API read model
- ad-hoc analytics
- operational SQL
- schema DDL
- health query
- materialized view management
```

Contoh Java read service:

```java
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement("""
         SELECT sensor_id, avg(temperature)
         FROM sensor_reading
         WHERE ts >= ? AND ts < ?
         SAMPLE BY 1m
     """)) {
    // bind range and execute
}
```

Ini natural karena query memang berbentuk SQL.

### 8.3 PGWire Bisa Insert, Tapi Bukan Default untuk High-Throughput Ingestion

PGWire dapat dipakai untuk SQL insert, terutama:

```text
- low-volume admin writes
- small reference/control data
- controlled tests
- simple prototypes
- manual correction
```

Tapi untuk continuous telemetry/ticks/metrics, default-nya harus ILP.

Alasannya:

```text
- SQL parsing/planning overhead lebih tinggi
- client batching bisa kurang optimal
- JDBC abstraction tidak didesain khusus untuk time-series append firehose
- failure/retry per statement bisa mahal
- high concurrency JDBC insert dapat membuat CPU/network overhead membesar
```

Rule:

```text
PGWire is primarily a query/control interface.
ILP is primarily an ingestion interface.
```

---

## 9. REST API and Web Console: Operational Convenience, Not Always Data Plane

QuestDB memiliki HTTP surface, termasuk Web Console dan REST-style endpoints.

Gunakan untuk:

```text
- ad-hoc query dari Web Console
- operational integration sederhana
- health check
- import/export workflow tertentu
- debugging
- administrative automation yang ringan
```

Jangan langsung menjadikan REST generic query endpoint sebagai data plane utama untuk semua production reads tanpa guardrails.

Masalah yang sering terjadi:

```text
Dashboard frontend → langsung query QuestDB via HTTP tanpa service guardrail
```

Risiko:

```text
- user bisa membuat query range terlalu besar
- tenant isolation lemah
- query cost tidak dibatasi domain service
- response payload bisa sangat besar
- authz sulit diselaraskan dengan business model
```

Pattern lebih sehat:

```text
Frontend
  → Java Query API Service
      - validates tenant
      - enforces time range
      - chooses query template
      - adds LIMIT/downsampling
      - observes latency
  → QuestDB PGWire/HTTP query
```

---

## 10. CSV Import: Bootstrap, Backfill, and Controlled Bulk Load

CSV import bukan ingestion path ideal untuk continuous high-frequency producer, tetapi sangat berguna untuk:

```text
- initial load dari legacy system
- offline historical dataset
- vendor export
- manual correction batch
- reproducible test dataset
- controlled backfill
```

Mental model CSV import:

```text
file boundary adalah batch boundary.
```

Hal yang harus dicek sebelum CSV import:

```text
- timestamp column benar?
- timezone benar?
- timestamp unit benar?
- delimiter/quote escaping benar?
- null representation konsisten?
- symbol columns sudah ditentukan?
- partition strategy sudah dibuat?
- duplicate handling diperlukan?
- import order sorted by timestamp atau tidak?
```

CSV import sering tampak sederhana, tetapi risiko semantiknya besar.

Contoh risiko:

```text
Vendor CSV berisi timestamp local time tanpa timezone.
Engineer import sebagai UTC.
Seluruh data bergeser 7 jam.
Dashboard terlihat valid, tetapi analisis salah.
```

Checklist wajib:

```text
Sebelum import besar, lakukan dry-run import subset dan validasi row count, min/max timestamp, sample rows, timezone, aggregates, dan duplicate rate.
```

Backfill besar akan dibahas lebih dalam di part 028.

---

## 11. Embedded Java: Powerful but Dangerous by Default

QuestDB bisa digunakan secara embedded di Java process untuk kasus tertentu.

Ini menarik untuk Java engineer karena terasa seperti:

```text
Saya jalankan database engine di dalam aplikasi saya.
```

Kapan masuk akal?

```text
- integration test cepat
- local analytics tool
- edge device dengan database lokal
- single-node embedded appliance
- specialized application yang memang owning storage lifecycle
```

Kapan tidak cocok?

```text
- distributed backend service umum
- multi-service production platform
- workload butuh independent database lifecycle
- tim ops ingin database dikelola sebagai service
- butuh scaling ingestion/query secara terpisah
```

Risiko embedded:

```text
- lifecycle database terikat lifecycle JVM aplikasi
- crash aplikasi = crash database process
- upgrade QuestDB = upgrade application artifact
- observability database tercampur aplikasi
- resource isolation sulit
- backup/restore lebih rumit
- ownership boundary kabur
```

Rule praktis:

```text
Default production architecture: QuestDB as separate service.
Embedded QuestDB: pilih secara sadar untuk use case khusus.
```

---

## 12. Ingestion Decision Matrix

Gunakan matrix berikut sebagai starting point.

| Scenario | Recommended Path | Reason |
|---|---|---|
| Java service mengirim 100k+ metrics/sec | Java ILP client over HTTP/TCP | throughput, batching, typed client |
| Dashboard/API membaca data | JDBC/PGWire | SQL compatibility, pooling, prepared statements |
| Admin menjalankan query manual | Web Console / PGWire | interactive SQL |
| Bootstrap historical CSV 50 GB | CSV/import or batch ILP pipeline | controlled bulk load |
| Low-volume config/reference write | PGWire SQL insert | simple and acceptable |
| Kafka topic ke QuestDB | Kafka Connect or custom ILP consumer | replay + ingestion throughput |
| Edge appliance single JVM | Embedded Java maybe | local ownership acceptable |
| Frontend browser langsung query QuestDB | Avoid by default | authz/cost/range guardrail risk |
| Frequent live sensor streaming | ILP | append-optimized |
| One-off manual correction | PGWire SQL / controlled batch | human/operator workflow |

---

## 13. Java Engineer Perspective: Think in Adapters, Not Direct Database Calls

Jangan desain producer seperti ini:

```text
Business service directly knows QuestDB table and line format.
```

Lebih baik:

```text
Domain event
  → TelemetryEvent
  → IngestionAdapter
  → QuestDbWriter
  → ILP client
```

Contoh boundary:

```java
public interface TimeSeriesWriter<T> {
    void write(T event);
    void flush();
}

public final class SensorReadingWriter implements TimeSeriesWriter<SensorReading> {
    // maps domain event to QuestDB ILP rows
}
```

Kenapa adapter penting?

```text
- schema mapping terkonsentrasi
- unit conversion terkendali
- timestamp source jelas
- retry policy tidak tersebar
- instrumentation mudah
- producer contract bisa diuji
- QuestDB-specific detail tidak bocor ke domain service
```

---

## 14. Ingestion Contract: Apa yang Harus Ditetapkan Sebelum Menulis Kode

Sebelum satu line data dikirim, tim harus menyepakati ingestion contract.

Minimal:

```text
1. Table name
2. Designated timestamp source
3. Timestamp precision/unit
4. Partition strategy
5. Symbol/tag columns
6. Field/value columns
7. Required vs optional values
8. Valid range untuk values
9. Duplicate semantics
10. Retry semantics
11. Schema evolution rule
12. Error handling rule
13. Backfill/replay rule
14. Freshness SLO
15. Ownership producer
```

Contoh contract singkat:

```text
Table: machine_sensor_reading
Timestamp: event_time from PLC gateway, UTC nanoseconds
Partition: DAY
Symbols: tenant_id, site_id, machine_id, sensor_id, metric
Fields: value DOUBLE, quality_code INT, source_seq LONG
Duplicate key: ts + tenant_id + machine_id + sensor_id + metric
Retry: allowed, database dedup enabled for replay path
Late arrival: accepted up to 7 days, older requires backfill job
Schema change: only through schema review, no arbitrary auto-created columns in production
Freshness SLO: p95 data visible < 5s after gateway receive
```

Ini jauh lebih berguna daripada sekadar “pakai QuestDB”.

---

## 15. Auto Table/Column Creation: Convenience vs Governance Risk

ILP dapat membuat table/column secara otomatis dalam mode tertentu.

Ini berguna untuk:

```text
- local development
- proof of concept
- exploratory ingestion
- throwaway datasets
```

Tapi di produksi, auto-creation bisa berbahaya.

Risiko:

```text
- typo menjadi column baru
- device_id vs deviceId menjadi dua dimension
- field type terinferensi salah
- cardinality meledak diam-diam
- producer bug mencemari schema
- table default setting tidak sesuai partition/SYMBOL/WAL/TTL design
```

Contoh:

```text
Line 1: sensor,device_id=d1 temperature=10.5 1719000000000000000
Line 2: sensor,deviceId=d1 temperature=10.6 1719000001000000000
```

Jika auto column creation tidak dikontrol, kamu bisa mendapat dua kolom:

```text
device_id
deviceId
```

Secara teknis valid. Secara operasional buruk.

Rule:

```text
Auto-create boleh untuk dev.
Explicit schema untuk production.
```

---

## 16. Batching: Throughput Datang dari Batch, Bukan dari Banyak Thread Sembarangan

Ingestion throughput biasanya meningkat dari batching yang sehat, bukan dari membuka koneksi sebanyak mungkin.

Bad intuition:

```text
Kalau mau lebih cepat, tambah thread writer sampai 500.
```

Better intuition:

```text
Gunakan batch yang cukup besar, connection yang cukup, dan backpressure yang jelas.
```

Parameter konseptual:

```text
batch size by rows
batch size by bytes
flush interval
max in-flight batches
retry queue size
producer backpressure threshold
```

Trade-off:

| Lebih Besar Batch | Dampak |
|---|---|
| Throughput naik | overhead per row turun |
| Latency naik | row menunggu batch penuh |
| Memory naik | buffer lebih besar |
| Failure blast radius naik | satu batch gagal berisi lebih banyak row |

Rule praktis:

```text
Batch by size and time.
Flush saat batch cukup besar atau saat interval freshness mendekati batas.
```

Contoh mental:

```text
flush when rows >= 10_000 OR bytes >= 1MB OR age >= 500ms
```

Angka ini bukan default universal. Harus diuji pada workload nyata.

---

## 17. Backpressure: Jangan Biarkan QuestDB Menjadi Tempat Semua Masalah Dibuang

Backpressure adalah kemampuan sistem untuk berkata:

```text
Saya tidak bisa menerima lebih cepat dari ini tanpa merusak diri.
```

Dalam pipeline QuestDB:

```text
Producer → local queue → ILP client → network → QuestDB ingestion endpoint → WAL/apply/storage
```

Backpressure bisa muncul di mana saja:

```text
- producer terlalu cepat
- local queue penuh
- network lambat
- QuestDB ingestion endpoint lambat
- WAL apply tertinggal
- disk I/O saturated
- CPU parsing ILP penuh
```

Jangan desain writer seperti ini:

```text
on failure: retry forever immediately
```

Itu menciptakan retry storm.

Lebih sehat:

```text
- bounded queue
- retry with exponential backoff/jitter
- circuit breaker
- dead-letter invalid rows
- metrics for dropped/deferred rows
- explicit freshness degradation mode
```

Decision yang harus dibuat:

```text
Jika QuestDB tidak bisa menerima data selama 5 menit, apakah producer:
  A. block?
  B. drop low-value data?
  C. buffer to disk?
  D. write to Kafka?
  E. degrade sampling rate?
```

Tidak ada jawaban universal. Jawabannya domain-specific.

---

## 18. Durability Boundary: Kapan Data Dianggap “Aman”?

Engineer sering bertanya:

```text
Setelah client flush sukses, apakah data sudah aman?
```

Jawabannya perlu dibaca berdasarkan ingestion protocol, WAL, server config, dan operational setup.

Secara mental:

```text
producer accepted response
  ≠ necessarily visible in every query instantly under all conditions
  ≠ necessarily replicated to DR location instantly
  ≠ necessarily safe against every disk/node failure mode
```

Kamu perlu mendefinisikan durability boundary:

```text
Accepted by client?
Written to QuestDB WAL?
Applied to table storage?
Visible to query?
Replicated?
Backed up?
```

Untuk production SLO, bedakan:

```text
Ingestion acknowledgement SLO
Data visibility/freshness SLO
Replication lag SLO
Backup recovery SLO
```

WAL detail akan dibahas khusus di part 011.

---

## 19. Error Taxonomy: Tidak Semua Error Boleh Di-retry

Error ingestion harus diklasifikasikan.

| Error Type | Contoh | Retry? | Penanganan |
|---|---|---|---|
| transient network | timeout, connection reset | yes | retry with backoff |
| server overload | 5xx/temporary unavailable | yes, controlled | backoff/circuit breaker |
| auth error | invalid token/password | no immediate | alert/config fix |
| schema error | wrong type/column | no blind retry | DLQ + schema investigation |
| invalid line | bad escaping/format | no blind retry | producer bug fix |
| disk full | server cannot persist | retry only after recovery | incident response |
| duplicate | retry/replay duplicate | depends | dedup/idempotency design |

Anti-pattern:

```text
catch Exception → retry forever
```

Kenapa buruk?

```text
- invalid data akan menyerang QuestDB berulang
- schema bug tidak pernah terlihat sebagai bug
- queue penuh oleh poison messages
- incident diperparah oleh retry storm
```

Pattern lebih sehat:

```text
retryable error → bounded retry/backoff
non-retryable data error → dead-letter + metric + alert
uncertain error → retry limited + reconciliation
```

---

## 20. Timestamp Handling in Ingestion

Timestamp adalah kolom terpenting di TSDB.

Kesalahan timestamp lebih berbahaya daripada kesalahan value biasa.

Pitfall umum:

```text
- memakai local time tanpa timezone
- memakai milliseconds saat protocol expects nanoseconds
- memakai ingestion time padahal butuh event time
- memakai device clock yang skewed
- memakai server now() untuk event historis
- mencampur TIMESTAMP dan TIMESTAMP_NS semantics
```

Rule:

```text
Every ingestion path must make timestamp source explicit.
```

Contoh keputusan:

```text
For machine telemetry:
  event_time = timestamp assigned by gateway when reading sensor packet
  ingest_time = optional diagnostic column assigned by ingestion service
```

Jangan diam-diam mengganti event time dengan ingestion time karena mudah.

Itu bisa merusak:

```text
- ordering
- partition assignment
- late arrival semantics
- aggregation window
- causality analysis
- regulatory/audit reconstruction
```

---

## 21. Multi-Producer Ingestion

QuestDB sering menerima data dari banyak producer:

```text
- gateway per factory
- service per tenant
- Kafka consumer group
- API collector
- batch backfill process
```

Masalah multi-producer:

```text
- concurrent writes
- duplicate row
- schema drift antar producer
- timestamp skew
- uneven partition pressure
- noisy tenant
- inconsistent tag naming
```

Design controls:

```text
1. standardized ingestion library
2. central schema contract
3. producer identity column or metadata
4. bounded tenant cardinality
5. dedup strategy for replay-capable producers
6. per-producer metrics
7. admission control for unknown metric/table
```

Jangan biarkan semua tim membuat ILP line sendiri-sendiri.

Untuk organisasi besar:

```text
Create an internal QuestDB ingestion SDK.
```

SDK internal bisa memaksa:

```text
- timestamp unit
- naming convention
- allowed tags
- flush policy
- error taxonomy
- telemetry metrics
- tenant guardrail
```

---

## 22. Ingestion Gateway Pattern

Daripada setiap service langsung menulis ke QuestDB, kadang lebih sehat membuat ingestion gateway.

Arsitektur:

```text
Producer services
  → internal ingestion API / queue
  → Ingestion Gateway
      - validate schema
      - normalize timestamp
      - enrich tenant/source metadata
      - batch
      - deduplicate if needed
      - write via ILP
      - emit metrics/DLQ
  → QuestDB
```

Kapan gateway berguna?

```text
- banyak producer
- schema governance penting
- multi-tenant control penting
- producer environment heterogeneous
- butuh centralized retry/backpressure
- butuh security boundary
```

Kapan gateway bisa berlebihan?

```text
- satu producer internal
- workload kecil
- latency ultra rendah dan gateway jadi bottleneck
- tim belum butuh governance kompleks
```

Gateway bukan selalu wajib. Tapi untuk enterprise platform, pattern ini sering mengurangi chaos.

---

## 23. Broker-before-QuestDB Pattern

Kadang data tidak langsung dari producer ke QuestDB, tetapi lewat Kafka/RabbitMQ.

Pattern:

```text
Producer → Kafka → QuestDB ingestion consumer → QuestDB
```

Kelebihan:

```text
- replay capability
- buffer saat QuestDB down
- decouple producer from database availability
- backfill from topic
- consumer scaling
- audit of raw events
```

Biaya:

```text
- architecture lebih kompleks
- duplicate/replay harus didesain
- freshness bisa turun
- schema evolution ada di dua tempat
- operasi Kafka dan QuestDB sama-sama harus sehat
```

Rule:

```text
Gunakan broker sebelum QuestDB jika replay/durability/decoupling bernilai nyata.
Jangan tambah broker hanya karena terlihat enterprise.
```

Detail integrasi dengan Kafka/RabbitMQ akan dibahas di part 027 tanpa mengulang teori broker.

---

## 24. Security and Ingestion Surface

Setiap ingestion endpoint adalah entry point untuk data poisoning.

Risiko:

```text
- unauthorized producer menulis data palsu
- producer salah tenant menulis ke tenant lain
- schema pollution
- cardinality attack
- large payload attack
- timestamp far-future/far-past attack
```

Controls:

```text
- network allowlist
- TLS
- per-producer credentials/token
- table-level/tenant-level guardrail where available
- gateway validation
- request size limit
- timestamp sanity window
- allowed table/metric registry
- monitoring unknown table/column creation
```

Jangan hanya mengamankan query users. Producer juga harus dianggap untrusted boundary, minimal semi-trusted.

---

## 25. Observability for Ingestion

Minimal metrics di Java ingestion layer:

```text
- events received/sec
- rows encoded/sec
- rows successfully flushed/sec
- flush latency p50/p95/p99
- batch size rows/bytes
- retry count by error type
- dropped/dead-lettered rows
- queue depth
- oldest queued event age
- QuestDB response/error codes
- freshness lag: now - event_time of latest accepted row
```

Minimal metrics di QuestDB/operator side:

```text
- ingestion throughput
- WAL lag
- suspended tables
- disk usage
- CPU
- memory/native memory pressure
- query latency
- partition growth
- O3 activity symptoms
```

Freshness metric penting:

```text
latest event_time visible in QuestDB vs wall clock
```

Karena ingestion success tidak otomatis berarti dashboard freshness sehat.

---

## 26. Common Anti-Patterns

### Anti-pattern 1: JDBC Insert Firehose

```text
All services insert metrics via JDBC prepared INSERT.
```

Masalah:

```text
- overhead tinggi
- sulit mencapai throughput tinggi
- connection pool jadi bottleneck
- retry per statement mahal
```

Gunakan ILP untuk high-throughput ingestion.

### Anti-pattern 2: No Timestamp Contract

```text
Setiap producer mengirim timestamp sesuai interpretasi masing-masing.
```

Masalah:

```text
- data tidak comparable
- query window salah
- late arrival tidak bisa didefinisikan
```

Tetapkan timestamp source dan precision.

### Anti-pattern 3: Auto-create Production Schema

```text
Biarkan semua table/column muncul otomatis dari ILP.
```

Masalah:

```text
- typo menjadi schema
- type inference salah
- governance hilang
```

Gunakan explicit schema untuk production.

### Anti-pattern 4: Infinite Retry Without DLQ

```text
Retry semua error selamanya.
```

Masalah:

```text
- poison data tidak pernah keluar
- retry storm
- outage diperparah
```

Klasifikasikan error.

### Anti-pattern 5: Frontend Direct Query

```text
Browser dashboard langsung query QuestDB tanpa service boundary.
```

Masalah:

```text
- authz lemah
- query cost tidak dikendalikan
- tenant leak risk
```

Gunakan Java service sebagai guardrail.

### Anti-pattern 6: One Table for Everything

```text
metrics,tenant=a,metric=cpu value=1
metrics,tenant=a,metric=temperature value=31
metrics,tenant=a,metric=price value=99
```

Masalah:

```text
- semantics campur
- query sulit dioptimalkan
- retention beda tidak bisa bersih
- type/unit governance buruk
```

Pisahkan berdasarkan lifecycle dan query shape.

---

## 27. Hands-on Lab: Designing Ingestion for Three Workloads

### Workload A: Application Metrics

```text
10 services
500 pods
100 metric names
scrape-like push every 10 seconds
query dashboard last 6h, last 24h
retention raw 14 days
```

Recommended:

```text
- ILP over HTTP via internal ingestion SDK
- explicit table: app_metric_sample
- timestamp = sample time UTC
- partition by DAY
- symbols: service, instance, metric_name, env, status maybe
- fields: value DOUBLE
- query via PGWire/JDBC from dashboard service
- materialized view later for common rollups
```

Avoid:

```text
- frontend direct QuestDB access
- arbitrary labels without cardinality budget
```

### Workload B: Industrial Sensor Gateway

```text
100 factories
50k devices
some devices offline and replay later
freshness p95 < 5s
late arrival up to 3 days
```

Recommended:

```text
- gateway or broker-before-QuestDB depending offline replay requirement
- Java ingestion gateway normalizes timestamps
- ILP client with bounded queue/backpressure
- explicit schema
- partition by DAY or HOUR depending volume
- duplicate strategy for replay path
- freshness and late arrival monitoring
```

Avoid:

```text
- using ingestion time as sensor event time
- unbounded local memory buffer
```

### Workload C: Manual Historical Import

```text
3 years CSV from vendor
timestamp local time
row count 4B
schema partially inconsistent
```

Recommended:

```text
- do not live import directly into production hot table first
- validate subset
- normalize timestamp to UTC
- create staging table if needed
- import sorted/partition-aware when possible
- reconcile row count/min/max/aggregates
- move/attach/copy into final structure if strategy supports
```

Avoid:

```text
- trusting vendor timestamp blindly
- importing all data before checking min/max timestamp
```

---

## 28. Production Checklist

Before enabling production ingestion:

```text
[ ] Ingestion path selected: ILP/PGWire/CSV/embedded with explicit reason
[ ] Table schema created explicitly
[ ] Designated timestamp defined
[ ] Timestamp precision/unit documented
[ ] Partition strategy defined
[ ] Symbol/tag columns reviewed for cardinality
[ ] Auto-create policy decided
[ ] Batch size/flush interval configured
[ ] Retry policy classified by error type
[ ] Dead-letter path exists for invalid data
[ ] Backpressure behavior defined
[ ] Freshness SLO defined
[ ] Ingestion metrics emitted by Java service
[ ] QuestDB health metrics monitored
[ ] Disk growth estimated
[ ] Late arrival policy defined
[ ] Duplicate/replay policy defined
[ ] Security boundary defined for producers
[ ] Load test performed with realistic data
[ ] Failure test performed: QuestDB down/network timeout/invalid row/disk pressure simulation
```

---

## 29. Key Takeaways

1. QuestDB ingestion should be designed as a subsystem, not a random set of inserts.
2. ILP is the primary high-throughput ingestion path.
3. PGWire is best treated as query/control plane, not firehose ingestion plane.
4. HTTP ILP is usually the pragmatic production default because operational clarity matters.
5. CSV/import is valuable for controlled bulk/bootstrap workflows.
6. Embedded Java is powerful but should not be the default deployment model.
7. Timestamp contract is the most important ingestion contract.
8. Auto schema creation is helpful for development but dangerous for production governance.
9. Batching and backpressure matter more than blindly adding threads.
10. Retry without error taxonomy creates outages.
11. Java integration should use adapters/SDK boundaries, not raw line strings scattered across services.

---

## 30. How This Connects to the Next Part

Part 006 gave us the ingestion map.

Next, part 007 goes deep into Java ingestion client design:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-007.md
Java Ingestion Client Deep Dive
```

There we will cover:

```text
- QuestDB Java ILP client setup
- sender lifecycle
- batching and flushing
- connection configuration
- retry and failover
- multi-threaded producer design
- backpressure in Java
- error handling
- test strategy
- Spring Boot integration pattern
```

The key transition:

```text
Part 006: which ingestion path and why.
Part 007: how to implement the Java ingestion path safely.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Partitioning: The Physical Boundary of Time</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-007.md">Java Ingestion Client Deep Dive ➡️</a>
</div>
