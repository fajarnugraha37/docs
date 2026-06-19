# learn-java-microservices-patterns-advanced-engineering-27-performance-engineering

# Part 27 — Performance Engineering for Microservices

> Seri: `learn-java-microservices-patterns-advanced-engineering`  
> Bagian: `27 / 35`  
> Status: **Belum bagian terakhir**  
> Target pembaca: senior engineer, tech lead, architect, principal-track engineer  
> Fokus Java: **Java 8 sampai Java 25**

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **performance engineering untuk microservices** sebagai disiplin arsitektur, bukan sekadar tuning JVM, menambah cache, mengganti library HTTP, atau menaikkan CPU.

Setelah menyelesaikan bagian ini, Anda diharapkan mampu:

1. Membaca performa sistem microservices sebagai **hasil dari desain boundary, komunikasi, data, runtime, dan operasional**.
2. Mendesain **latency budget** untuk request end-to-end.
3. Menganalisis **critical path** pada synchronous dan asynchronous flow.
4. Menghitung dampak fan-out, connection pool, thread pool, queue, serialization, cache, dan database terhadap latency.
5. Membedakan throughput, latency, concurrency, saturation, dan utilization.
6. Menggunakan mental model percentile, terutama p95, p99, dan p999.
7. Memahami mengapa average latency sering menipu.
8. Memilih blocking, async, reactive, virtual thread, dan event-driven model secara rasional.
9. Mendesain service yang tetap predictable saat load naik.
10. Membuat checklist production-readiness untuk performance review microservices Java.

---

## 1. Premis Utama

Performance di microservices bukan terutama masalah kode lambat.

Performance adalah hasil interaksi antara:

```text
service boundary
+ network hop
+ serialization
+ remote dependency
+ database access
+ connection pool
+ thread/concurrency model
+ cache strategy
+ message queue behavior
+ retry policy
+ timeout budget
+ GC behavior
+ container resource limit
+ observability overhead
+ deployment topology
+ traffic shape
```

Satu service bisa cepat saat dites sendiri, tetapi sistem tetap lambat karena:

- terlalu banyak remote hop,
- terlalu banyak fan-out,
- terlalu banyak blocking dependency,
- timeout tidak proporsional,
- connection pool tidak sinkron dengan thread pool,
- retry memperbesar load,
- cache tidak tepat,
- database menjadi shared bottleneck,
- p99 dependency latency menyebar ke p99 user latency,
- container CPU throttling,
- GC pause,
- noisy neighbor,
- queue backlog,
- service mesh retry tersembunyi,
- payload terlalu besar,
- query terlalu berat,
- tracing/logging high-cardinality berlebihan.

Engineer biasa bertanya:

```text
Kenapa endpoint ini lambat?
```

Engineer kuat bertanya:

```text
Apa critical path-nya?
Apa latency budget-nya?
Dependency mana yang mendominasi p99?
Apakah bottleneck-nya CPU, IO, DB, lock, pool, queue, GC, network, atau downstream?
Apakah lambat karena service ini, atau karena desain call graph?
Apakah scale-out membantu, atau justru menambah pressure ke dependency?
```

---

## 2. Apa Itu Performance Engineering?

Performance engineering adalah proses sistematis untuk memastikan sistem memenuhi target performa melalui:

1. desain,
2. pengukuran,
3. eksperimen,
4. kapasitas,
5. observability,
6. diagnosis,
7. optimisasi,
8. regression prevention.

Performance engineering berbeda dari performance tuning.

| Aspek | Performance Tuning | Performance Engineering |
|---|---|---|
| Waktu | Setelah lambat | Sejak desain |
| Fokus | Hotspot lokal | End-to-end system behavior |
| Teknik | Optimize query/code/JVM | Budget, architecture, capacity, test, observability |
| Ukuran sukses | Endpoint lebih cepat | Sistem predictable di bawah target load |
| Risiko | Local optimization | System-level trade-off |

Tuning tetap penting, tetapi tanpa engineering discipline, tuning mudah berubah menjadi trial-and-error.

---

## 3. Metrik Dasar yang Harus Dibedakan

### 3.1 Latency

Latency adalah waktu yang dibutuhkan untuk menyelesaikan satu operasi.

Contoh:

```text
POST /applications/{id}/submit = 420 ms p95
```

Latency dapat terdiri dari:

- client latency,
- gateway latency,
- service processing latency,
- downstream call latency,
- database latency,
- queue wait time,
- serialization/deserialization time,
- GC pause impact,
- network round-trip time.

### 3.2 Throughput

Throughput adalah jumlah operasi per satuan waktu.

Contoh:

```text
500 requests/second
20,000 messages/minute
1,000 approvals/hour
```

Throughput tinggi tidak otomatis berarti latency rendah. Sistem bisa memproses banyak request, tetapi setiap request menunggu lama.

### 3.3 Concurrency

Concurrency adalah jumlah pekerjaan aktif pada waktu bersamaan.

Contoh:

```text
200 in-flight HTTP requests
40 active DB queries
1,000 virtual threads waiting on IO
```

Concurrency terkait dengan latency dan throughput melalui Little's Law:

```text
L = λ × W
```

Artinya:

```text
jumlah pekerjaan aktif = arrival rate × waktu rata-rata dalam sistem
```

Jika throughput 100 request/s dan latency rata-rata 500 ms:

```text
concurrency ≈ 100 × 0.5 = 50 active requests
```

Jika latency naik menjadi 2 detik pada throughput yang sama:

```text
concurrency ≈ 100 × 2 = 200 active requests
```

Latency naik akan menaikkan concurrency, lalu concurrency yang tinggi bisa menyebabkan lebih banyak queueing, lalu latency makin naik. Ini adalah jalur menuju overload.

### 3.4 Utilization

Utilization adalah tingkat pemakaian resource.

Contoh:

```text
CPU 75%
DB pool 95% busy
Kafka consumer lag growing
Heap 80%
```

Utilization terlalu tinggi membuat sistem tidak punya headroom untuk spike.

### 3.5 Saturation

Saturation adalah kondisi ketika resource mulai tidak mampu melayani load tanpa antrean signifikan.

Contoh:

- CPU run queue naik,
- thread pool queue penuh,
- DB pool wait time naik,
- broker lag naik,
- GC frequency naik,
- request timeout naik,
- p99 latency naik drastis.

Saturation sering terlihat lebih dulu di p99, bukan average.

---

## 4. Average Latency Adalah Metrik yang Sering Menipu

Misal sebuah endpoint memiliki 1.000 request:

```text
990 request selesai dalam 100 ms
10 request selesai dalam 10 detik
```

Average:

```text
(990 × 100ms + 10 × 10000ms) / 1000
= 199 ms
```

Average terlihat baik, tetapi 1% user mengalami latency 10 detik.

Karena itu microservices harus dibaca dengan percentile:

| Percentile | Arti |
|---|---|
| p50 | median user experience |
| p90 | mayoritas user experience |
| p95 | operational threshold umum |
| p99 | tail latency, sering menunjukkan bottleneck nyata |
| p999 | extreme tail, penting untuk high-scale atau critical systems |

Untuk sistem enterprise/regulatory, p99 sering lebih penting daripada average karena:

- user internal bisa melakukan bulk processing,
- approval workflow bisa fan-out ke banyak service,
- report/export bisa berat,
- long-tail request bisa menghabiskan thread/connection,
- satu request lambat dapat menahan lock/state transition.

---

## 5. Tail Latency dan Fan-Out

Tail latency adalah latency di percentile tinggi, seperti p95/p99.

Dalam microservices, tail latency memburuk karena fan-out.

Misal satu request memanggil 5 downstream service secara paralel. Masing-masing service punya probabilitas 1% lambat pada p99.

Probabilitas minimal satu downstream lambat:

```text
1 - (0.99 ^ 5)
≈ 4.9%
```

Artinya request aggregator bisa mengalami tail latency jauh lebih sering daripada setiap dependency secara individual.

Jika fan-out 20 service:

```text
1 - (0.99 ^ 20)
≈ 18.2%
```

Ini alasan API composition dan gateway aggregation harus sangat hati-hati.

### Prinsip

```text
End-to-end tail latency memburuk seiring jumlah dependency pada critical path.
```

Karena itu performance engineering microservices harus selalu bertanya:

```text
Berapa banyak remote call di critical path?
Mana yang serial?
Mana yang parallel?
Mana yang optional?
Mana yang bisa di-cache?
Mana yang bisa dipindahkan ke projection/read model?
Mana yang tidak perlu synchronous?
```

---

## 6. Critical Path Analysis

Critical path adalah jalur pekerjaan yang menentukan total latency user-visible operation.

Contoh request:

```text
Submit Application
  -> Gateway auth validation
  -> Application Service validation
  -> Profile Service lookup
  -> Document Service check
  -> Rule Service eligibility
  -> Database write
  -> Outbox insert
  -> Response
```

Jika semua serial:

```text
Gateway          20 ms
Application      80 ms
Profile         120 ms
Document        150 ms
Rule            200 ms
DB write         50 ms
Outbox           10 ms
----------------------
Total           630 ms
```

Jika Profile, Document, dan Rule bisa diparalelkan:

```text
Gateway          20 ms
Application      80 ms
max(Profile 120, Document 150, Rule 200)
DB write         50 ms
Outbox           10 ms
----------------------
Total           360 ms
```

Namun paralelisme bukan gratis. Ia menambah:

- concurrent downstream load,
- connection demand,
- thread/virtual thread demand,
- failure surface,
- timeout composition complexity,
- partial response handling.

### Critical Path Worksheet

Untuk setiap user operation:

```text
Operation:
User-visible SLO:
Total latency budget:
Critical dependencies:
Serial calls:
Parallel calls:
Optional calls:
Cacheable calls:
Database operations:
Message publish operations:
External calls:
Timeout per call:
Retry policy:
Fallback policy:
Maximum in-flight concurrency:
Expected p50/p95/p99:
```

---

## 7. Latency Budget

Latency budget adalah pembagian target latency end-to-end ke setiap komponen.

Misal target:

```text
p95 Submit Application <= 1.5 seconds
```

Budget awal:

| Komponen | Budget p95 |
|---|---:|
| Browser/client network | 100 ms |
| API Gateway | 100 ms |
| Authentication/session check | 100 ms |
| Application Service internal | 200 ms |
| Profile lookup | 200 ms |
| Document check | 250 ms |
| Rule evaluation | 300 ms |
| DB write + transaction | 150 ms |
| Margin | 100 ms |
| Total | 1,500 ms |

Budget bukan angka dekoratif. Budget harus mengontrol:

- timeout setting,
- retry policy,
- pool size,
- fallback decision,
- SLO alert,
- performance test acceptance,
- architecture decision.

### Kesalahan Umum

Target user p95 2 detik, tetapi setiap downstream client diberi timeout 30 detik.

Ini buruk karena:

- thread/connection tertahan lama,
- user sudah timeout tetapi backend masih bekerja,
- overload makin parah,
- retry dari client/gateway bisa menggandakan pekerjaan,
- p99 menjadi tidak terkendali.

### Rule of Thumb

```text
Timeout harus berasal dari latency budget, bukan default library.
```

---

## 8. Throughput dan Capacity Model

Sebuah service menerima:

```text
200 request/second
```

Setiap request melakukan:

```text
2 DB queries
1 Redis call
1 downstream HTTP call
```

Maka dependency load:

```text
DB query rate       = 400 query/second
Redis call rate     = 200 call/second
Downstream call rate= 200 call/second
```

Jika ada retry 1 kali untuk 10% request downstream:

```text
Downstream call rate = 200 + (200 × 10%) = 220 call/second
```

Jika downstream mengalami error dan 80% request retry:

```text
Downstream call rate = 200 + (200 × 80%) = 360 call/second
```

Retry dapat mengubah incident kecil menjadi overload besar.

### Capacity Review Formula

Untuk setiap service:

```text
Incoming RPS
× average downstream calls per request
× retry multiplier
× fan-out multiplier
= downstream pressure
```

Untuk database:

```text
Incoming RPS
× queries per request
× query cost
× transaction duration
= DB pressure
```

Untuk thread/concurrency:

```text
RPS × latency = active requests
```

Untuk memory:

```text
active requests × per-request memory footprint = live request memory
```

---

## 9. Performance Bottleneck Taxonomy

Microservices performance bottleneck biasanya berada di salah satu kategori berikut.

### 9.1 CPU Bound

Gejala:

- CPU tinggi,
- run queue tinggi,
- latency naik saat load naik,
- GC bukan penyebab utama,
- profiling menunjukkan hot method CPU.

Penyebab umum:

- serialization/deserialization berat,
- encryption/compression,
- regex mahal,
- JSON mapping besar,
- inefficient algorithm,
- excessive object allocation,
- logging formatting berlebihan,
- template rendering,
- large collection scan.

Solusi:

- profiling dengan JFR/async-profiler,
- kurangi work per request,
- cache hasil komputasi,
- ubah algorithm,
- batch computation,
- precompute read model,
- scale CPU jika memang linear.

### 9.2 IO Bound

Gejala:

- CPU rendah/sedang,
- banyak thread menunggu,
- latency mengikuti dependency,
- pool wait time naik.

Penyebab:

- database lambat,
- remote HTTP lambat,
- broker lambat,
- filesystem/object storage lambat,
- DNS/TLS overhead,
- external API latency.

Solusi:

- timeout budget,
- connection reuse,
- pooling,
- async/virtual threads,
- cache,
- projection,
- reduce remote calls,
- move work async,
- isolate slow dependency.

### 9.3 Lock/Contention Bound

Gejala:

- CPU tidak maksimal,
- thread blocked/waiting,
- p99 tinggi,
- JFR menunjukkan monitor contention atau lock contention.

Penyebab:

- synchronized global lock,
- single shared map,
- sequence generator contention,
- database row lock,
- optimistic lock retry storm,
- distributed lock misuse.

Solusi:

- partition/shard lock,
- remove shared mutable state,
- use append-only event/outbox,
- reduce transaction duration,
- use optimistic concurrency carefully,
- redesign hot aggregate.

### 9.4 Pool Bound

Gejala:

- DB pool wait tinggi,
- HTTP client pool exhausted,
- executor queue naik,
- thread pool maxed,
- latency naik sebelum CPU tinggi.

Penyebab:

- pool terlalu kecil,
- pool terlalu besar untuk downstream,
- leaked connection,
- long transaction,
- slow query,
- mismatch antara request concurrency dan pool capacity.

Solusi:

- ukur wait time,
- set pool berdasarkan capacity dependency,
- bound concurrency,
- shorten transaction,
- split read/write pool jika perlu,
- reject cepat saat overload.

### 9.5 GC/Memory Bound

Gejala:

- allocation rate tinggi,
- GC pause/frequency tinggi,
- heap pressure,
- native memory pressure,
- container OOMKilled.

Penyebab:

- payload besar,
- buffering response besar,
- excessive DTO copy,
- large object allocation,
- unbounded cache,
- high-cardinality metrics/logging,
- per-request large collections.

Solusi:

- streaming,
- pagination,
- reduce allocation,
- tune heap/container memory,
- use bounded cache,
- choose appropriate GC,
- profile allocation.

### 9.6 Network Bound

Gejala:

- latency tinggi walau service CPU rendah,
- cross-zone/cross-region latency,
- high TLS handshake rate,
- packet loss/retransmit,
- DNS latency.

Solusi:

- keep-alive,
- connection pooling,
- co-locate dependency,
- reduce hop,
- avoid chatty calls,
- payload compression selectively,
- HTTP/2/gRPC if appropriate,
- DNS cache policy review.

### 9.7 Database Bound

Gejala:

- query latency naik,
- DB CPU/IO tinggi,
- lock wait,
- connection pool wait,
- slow query log,
- buffer cache miss.

Solusi:

- query plan review,
- index design,
- reduce transaction scope,
- read model/projection,
- cache,
- partitioning,
- offload reporting,
- remove cross-service DB access.

### 9.8 Queue/Backlog Bound

Gejala:

- broker lag naik,
- consumer throughput tidak mengejar producer,
- retry topic membesar,
- DLQ meningkat,
- processing latency naik.

Solusi:

- increase consumer capacity carefully,
- improve handler latency,
- partition key review,
- poison message handling,
- backpressure producer,
- batch processing,
- separate slow event type.

---

## 10. Synchronous Path Performance

Synchronous path adalah jalur di mana user/client menunggu hasil.

Contoh:

```text
GET /applications/{id}/summary
POST /applications/{id}/submit
POST /cases/{id}/assign
```

Synchronous path harus sangat hemat dependency.

### Prinsip

```text
Jangan taruh pekerjaan yang tidak perlu ditunggu user di synchronous critical path.
```

Contoh buruk:

```text
Submit Application
  -> save application
  -> generate PDF
  -> send email
  -> sync to external agency
  -> index to search
  -> write audit
  -> respond
```

Lebih baik:

```text
Submit Application
  -> validate required invariant
  -> save state transition
  -> insert outbox events
  -> respond accepted/submitted

Async:
  -> generate PDF
  -> send notification
  -> sync external agency
  -> update search projection
  -> enrich audit/read model
```

Synchronous path idealnya hanya berisi:

- validation yang harus immediate,
- invariant yang harus dicegah,
- state transition utama,
- local transaction,
- outbox insert,
- response.

---

## 11. Asynchronous Path Performance

Asynchronous path tidak berarti performa tidak penting. Ia hanya menggeser latency dari user-visible latency menjadi processing latency.

Metrik penting:

```text
produce rate
consume rate
consumer lag
queue depth
oldest message age
processing latency
time to drain backlog
retry rate
DLQ rate
replay throughput
```

### Async Performance Trap

Sistem terlihat cepat karena HTTP response cepat, tetapi queue backlog terus naik.

```text
POST /submit returns in 100 ms
but notification backlog = 2 hours
projection freshness = 45 minutes
external sync delay = 1 day
```

Ini bukan performa baik. Ini hanya latency dipindahkan ke tempat yang tidak terlihat user secara langsung.

### Freshness Budget

Untuk async projection/event processing, gunakan freshness budget:

```text
Worklist projection freshness <= 5 seconds p95
Email notification sent <= 2 minutes p95
External agency sync <= 15 minutes p95
Audit projection available <= 30 seconds p95
```

---

## 12. Database Performance dalam Microservices

Database sering menjadi bottleneck terbesar.

### 12.1 Query per Request

Jika satu endpoint melakukan 30 query kecil, performance bisa buruk meski setiap query cepat.

```text
30 queries × 10 ms = 300 ms minimal DB time
```

Jika N+1 remote/data access terjadi:

```text
1 query list applications
+ N query applicant profile
+ N query documents
+ N query workflow task
```

Untuk N = 50:

```text
1 + 50 + 50 + 50 = 151 query
```

Ini harus dipindahkan ke:

- projection/read model,
- batch query,
- join internal service boundary,
- API composition dengan bounded fan-out,
- search/read index.

### 12.2 Transaction Duration

Long transaction memperburuk:

- lock duration,
- connection hold time,
- undo/redo pressure,
- deadlock probability,
- pool exhaustion.

Jangan lakukan remote call di dalam DB transaction.

Buruk:

```java
@Transactional
public void approve(String id) {
    applicationRepository.lock(id);
    externalService.validate(id); // remote call inside transaction
    applicationRepository.approve(id);
}
```

Lebih baik:

```text
1. Pre-check outside transaction if safe
2. Open transaction
3. Re-check local invariant
4. Apply state transition
5. Insert outbox
6. Commit
7. External side effect async / after commit
```

### 12.3 Connection Pool Sizing

Connection pool bukan semakin besar semakin baik.

Jika pool terlalu besar:

- DB overload,
- context switching naik,
- lock contention naik,
- latency naik.

Jika pool terlalu kecil:

- request menunggu pool,
- throughput terbatas,
- p99 naik.

Ukuran pool harus mempertimbangkan:

```text
DB capacity
number of service replicas
queries per request
transaction duration
peak concurrency
timeout budget
```

Contoh:

```text
10 replicas × 50 max pool = 500 DB connections
```

Jika database nyaman hanya dengan 200 active sessions, konfigurasi ini menciptakan risiko overload.

### 12.4 Split Read/Write Workload

Untuk service dengan workload campuran:

- write path harus pendek dan kuat invariant,
- read path bisa memakai projection/cache,
- reporting/export jangan mengganggu OLTP path,
- batch job perlu concurrency limit.

---

## 13. Serialization and Payload Engineering

Microservices banyak mengubah object menjadi bytes dan bytes menjadi object.

Cost muncul dari:

- JSON serialization,
- JSON deserialization,
- validation,
- mapping DTO,
- encryption,
- compression,
- schema conversion,
- base64 encoding,
- large payload buffering.

### Payload Smell

```text
GET /application/{id}/full-detail
returns 5 MB JSON
called by worklist table for 50 rows
```

Ini buruk karena:

- network besar,
- CPU parsing besar,
- memory allocation besar,
- GC pressure,
- slow browser rendering,
- latency p99 buruk.

### Prinsip Payload

```text
Return what the use case needs, not what the domain object contains.
```

Gunakan DTO berdasarkan use case:

```text
ApplicationListItemDto
ApplicationSummaryDto
ApplicationDetailDto
ApplicationAuditDto
ApplicationExportDto
```

Jangan pakai satu DTO raksasa untuk semua endpoint.

### JSON vs Binary

JSON baik untuk:

- public API,
- debuggability,
- loose coupling,
- human-readable contract.

Binary format bisa berguna untuk:

- high-throughput internal service,
- streaming,
- event payload besar,
- low-latency protocol,
- schema-controlled systems.

Tetapi binary format menambah governance requirement:

- schema registry,
- compatibility test,
- generated code discipline,
- debugging tooling.

---

## 14. Cache sebagai Performance Tool dan Consistency Risk

Cache bisa menurunkan latency dan load, tetapi cache juga bisa merusak correctness.

Cache cocok untuk:

- reference data,
- authorization metadata dengan TTL hati-hati,
- expensive read model,
- external lookup,
- static configuration,
- derived query result.

Cache berbahaya untuk:

- rapidly changing state,
- security decision tanpa invalidation,
- regulatory decision yang harus latest,
- cross-tenant data tanpa tenant key,
- state transition invariant.

### Cache Performance Questions

```text
Apa cache key-nya?
Apakah tenant/user/permission masuk key?
Berapa TTL?
Bagaimana invalidation?
Apa stale data masih aman?
Apa fallback jika cache down?
Apakah cache stampede dicegah?
Apakah negative caching dibutuhkan?
Apakah cache hit ratio diukur?
```

### Cache Stampede

Cache stampede terjadi saat banyak request miss key yang sama lalu semuanya menghantam backend.

Mitigasi:

- single-flight/in-flight deduplication,
- jittered TTL,
- stale-while-revalidate,
- request coalescing,
- rate limit refresh,
- pre-warm untuk hot key.

---

## 15. Threading Model: Platform Thread, Async, Reactive, Virtual Thread

### 15.1 Java 8–17 Traditional Blocking

Model umum:

```text
one request = one platform thread
```

Kelebihan:

- sederhana,
- mudah debug,
- cocok untuk banyak enterprise workload,
- stack trace jelas.

Kekurangan:

- platform thread mahal,
- blocking IO menahan thread,
- pool exhaustion mudah terjadi,
- concurrency besar butuh banyak thread.

### 15.2 Async/CompletableFuture

Kelebihan:

- bisa paralelkan remote call,
- tidak harus blocking request thread,
- cocok untuk composition terbatas.

Kekurangan:

- error handling lebih kompleks,
- context propagation sulit,
- executor tuning penting,
- callback chain sulit dibaca jika tidak disiplin.

### 15.3 Reactive

Reactive berguna ketika:

- concurrency sangat tinggi,
- banyak IO non-blocking,
- streaming/backpressure penting,
- team memahami modelnya.

Risiko:

- debugging lebih sulit,
- blocking call tersembunyi merusak event loop,
- stack trace kurang natural,
- complexity tinggi untuk CRUD biasa.

### 15.4 Virtual Threads Java 21+

Virtual threads membuat blocking style jauh lebih scalable untuk IO-bound workload. Oracle mendeskripsikan virtual threads sebagai lightweight threads yang mengurangi effort untuk menulis, memelihara, dan men-debug high-throughput concurrent applications.

Namun virtual threads bukan magic performance button.

Virtual threads membantu jika bottleneck Anda:

- platform thread exhaustion,
- banyak blocking IO,
- request menunggu downstream,
- kode blocking lebih sederhana daripada reactive.

Virtual threads tidak menyelesaikan:

- database overload,
- downstream overload,
- bad query,
- unbounded concurrency,
- lock contention,
- CPU-bound work,
- memory pressure,
- missing timeout,
- retry storm.

Dengan virtual threads, Anda tetap butuh:

```text
concurrency limiter
connection pool
rate limiter
timeout budget
backpressure
bulkhead
```

Jika 10.000 virtual threads menunggu DB tetapi DB pool hanya 50, bottleneck tetap DB/pool.

---

## 16. Java 8 sampai Java 25 Performance Considerations

### Java 8

Karakter umum:

- banyak sistem enterprise legacy masih memakai Java 8,
- GC utama biasanya Parallel GC/CMS/G1 tergantung konfigurasi,
- tidak ada var, records, sealed class, virtual threads,
- CompletableFuture tersedia,
- JFR pada masa awal punya perbedaan licensing historis sebelum OpenJDK 11.

Implikasi:

- hati-hati platform thread pool,
- gunakan bounded executor,
- observability harus eksplisit,
- DTO verbose,
- modern framework version terbatas.

### Java 11

Karakter umum:

- LTS modern awal,
- JDK HttpClient tersedia,
- Flight Recorder menjadi bagian OpenJDK melalui JEP 328,
- lebih baik untuk container dibanding Java 8 era awal.

Implikasi:

- baseline bagus untuk modern HTTP client,
- JFR lebih mudah digunakan,
- migration target umum dari Java 8.

### Java 17

Karakter umum:

- LTS sangat umum untuk Spring Boot 3 / Jakarta modern,
- records, sealed classes, pattern matching preview/bertahap,
- GC modern lebih matang.

Implikasi:

- DTO/read model bisa lebih ringkas dengan records,
- domain result modeling bisa lebih aman,
- framework modern lebih nyaman.

### Java 21

Karakter umum:

- LTS,
- virtual threads final melalui JEP 444,
- pattern matching switch final,
- sequenced collections.

Implikasi:

- blocking service model layak dievaluasi ulang,
- synchronous composition bisa lebih sederhana,
- tetap butuh concurrency control.

### Java 25

Java 25 sudah tersedia sebagai JDK/Java SE 25 release pada September 2025. Release notes Oracle untuk JDK 25 mencakup perubahan dan enhancement terbaru, sedangkan Inside Java juga menyorot perbaikan performa JDK 25, termasuk perubahan ZGC mapped cache yang memperbaiki cara ZGC mengelola unused allocated memory dan pelaporan RSS.

Implikasi:

- evaluasi ulang GC behavior jika memakai ZGC,
- benchmark ulang workload nyata sebelum upgrade,
- jangan mengasumsikan performa naik untuk semua workload,
- gunakan canary dan regression test.

---

## 17. JVM Performance Observability

Untuk Java microservices, minimum metrik runtime:

```text
CPU process usage
CPU throttling if containerized
heap used / committed / max
non-heap memory
metaspace
direct buffer memory
GC count/duration/pause
allocation rate
thread count
virtual thread count if available
class loading
JIT compilation if relevant
safepoint time
file descriptor count
socket count
```

Minimum application metrics:

```text
HTTP request latency p50/p95/p99
HTTP request rate
HTTP error rate
DB pool active/idle/pending
DB query latency
HTTP client latency by downstream
retry count
timeout count
circuit breaker state
cache hit/miss
queue consumer lag
message processing latency
projection freshness
```

### JFR

Java Flight Recorder sangat penting untuk production-like profiling. Oracle mendeskripsikan JFR sebagai alat yang mengumpulkan dan menyimpan karakteristik performa detail untuk analisis historis/profiling, dan dokumentasi Red Hat menyebut JFR sebagai framework low-overhead untuk monitoring dan profiling Java applications.

Gunakan JFR untuk melihat:

- CPU hotspot,
- allocation hotspot,
- lock contention,
- socket IO,
- file IO,
- GC pause,
- thread states,
- exception rate,
- method profiling,
- object allocation pressure.

### Profiling Rule

```text
Do not optimize from intuition. Profile first.
```

---

## 18. OpenTelemetry and Distributed Performance

Local profiler menjawab:

```text
Apa yang lambat di JVM ini?
```

Distributed tracing menjawab:

```text
Di service mana waktu request habis?
Dependency mana yang mendominasi critical path?
Apakah call serial atau parallel?
Apakah retry terjadi?
Apakah queue wait terlihat?
```

OpenTelemetry adalah framework/toolkit observability untuk menghasilkan, mengekspor, dan mengumpulkan telemetry seperti traces, metrics, dan logs. Dokumentasi Java OpenTelemetry menyediakan API/SDK untuk menghasilkan dan mengumpulkan telemetry di aplikasi Java.

Trace untuk performance harus memiliki span seperti:

```text
HTTP server span
DB query span
HTTP client span
message publish span
message consume span
cache span
workflow step span
external API span
```

Jangan hanya trace controller. Trace harus menunjukkan critical path.

### High Cardinality Warning

Jangan jadikan field berikut sebagai label metrics sembarangan:

```text
userId
applicationId
caseId
email
full URL with ID
free text error message
```

Gunakan sebagai log/trace attribute dengan kontrol, bukan metric label tidak terbatas.

---

## 19. Performance Testing Strategy

Performance test harus menjawab pertanyaan spesifik.

### 19.1 Load Test

Tujuan:

```text
Apakah sistem memenuhi SLO pada expected load?
```

### 19.2 Stress Test

Tujuan:

```text
Di titik mana sistem mulai saturasi?
Bagaimana sistem gagal?
Apakah gagal secara graceful?
```

### 19.3 Spike Test

Tujuan:

```text
Apa yang terjadi saat traffic naik mendadak?
Apakah autoscaling/backpressure bekerja?
```

### 19.4 Soak Test

Tujuan:

```text
Apakah ada memory leak, connection leak, log growth, cache growth, performance degradation setelah berjalan lama?
```

### 19.5 Scalability Test

Tujuan:

```text
Apakah menambah replica meningkatkan throughput?
Dependency mana yang menjadi limit?
```

### 19.6 Regression Test

Tujuan:

```text
Apakah release baru memperburuk latency/throughput/resource usage?
```

---

## 20. Performance Test Design

Performance test yang buruk memberi rasa aman palsu.

### Harus realistis terhadap:

- traffic mix,
- payload size,
- user think time,
- authentication overhead,
- authorization check,
- database cardinality,
- cache warm/cold state,
- tenant distribution,
- external dependency behavior,
- async backlog,
- report/export workload,
- batch job overlap,
- deployment topology.

### Contoh Traffic Mix

```text
70% GET worklist
10% GET detail
8% POST submit
5% POST approve
3% POST reject
2% export report
2% admin/config operations
```

Jika test hanya GET detail 100%, hasil tidak mencerminkan produksi.

### Data Cardinality

Test dengan 1.000 rows tidak membuktikan performa untuk 50 juta rows.

Performance test harus mempertimbangkan:

```text
row count
index selectivity
tenant distribution
old vs new data
LOB/document size
audit/history size
partition behavior
```

---

## 21. Capacity Planning

Capacity planning harus dilakukan dengan model, bukan feeling.

### Input

```text
Peak RPS
Traffic mix
Target latency
Payload size
DB query count
External call count
CPU per request
Memory per request
Connection per request
Message per request
Retry rate
Growth projection
Headroom target
```

### Output

```text
number of replicas
CPU request/limit
memory request/limit
DB pool size
HTTP client pool size
consumer concurrency
queue partition count
cache size
autoscaling threshold
rate limit
load shedding threshold
```

### Headroom

Jangan desain pada 100% capacity.

Gunakan headroom untuk:

- traffic spike,
- dependency slowdown,
- GC variance,
- node drain,
- deployment rolling update,
- noisy neighbor,
- incident mitigation.

---

## 22. Microservices Performance Design Patterns

### 22.1 Latency Budget Pattern

Setiap user operation punya budget p95/p99.

### 22.2 Critical Path Reduction Pattern

Kurangi jumlah dependency yang harus selesai sebelum response.

### 22.3 Async Offload Pattern

Pindahkan side effect non-critical ke outbox/event processing.

### 22.4 Projection Pattern

Precompute read model untuk query berat.

### 22.5 Cache with Correctness Boundary Pattern

Cache hanya untuk data yang stale-nya dapat diterima atau dikontrol.

### 22.6 Bounded Concurrency Pattern

Batasi in-flight work sebelum resource saturasi.

### 22.7 Bulkhead Pattern

Pisahkan resource antar dependency/use case/tenant.

### 22.8 Load Shedding Pattern

Tolak cepat pekerjaan non-critical saat overload.

### 22.9 Graceful Degradation Pattern

Turunkan fitur opsional, bukan menjatuhkan seluruh service.

### 22.10 Performance Regression Gate Pattern

Jadikan performance baseline bagian dari CI/CD atau pre-release gate.

---

## 23. Anti-Patterns

### 23.1 Optimize Before Measuring

Mengubah GC, cache, thread pool, dan library tanpa profiling.

### 23.2 Average Latency Dashboard

Mengandalkan average latency tanpa p95/p99.

### 23.3 Infinite Timeout

Default timeout terlalu besar atau tidak ada timeout.

### 23.4 Pool Size Guessing

Menaikkan DB pool karena request lambat, padahal DB sudah overload.

### 23.5 Fan-Out Aggregator

Satu API memanggil banyak service secara synchronous tanpa budget.

### 23.6 Chatty Service

Banyak remote call kecil untuk satu operation.

### 23.7 Cache as Source of Truth

Cache dipakai untuk correctness tanpa ownership/invalidation.

### 23.8 Reactive as Decoration

Memakai reactive stack tetapi tetap blocking DB/client di event loop.

### 23.9 Virtual Threads as Overload Permission

Menganggap virtual threads membolehkan unbounded concurrency.

### 23.10 Autoscaling as Performance Fix

Mengandalkan autoscaling untuk masalah DB/query/lock/pool/retry.

### 23.11 Benchmark Toy Scenario

Benchmark dengan data kecil, cache warm, single endpoint, tanpa auth, tanpa DB realistis.

### 23.12 Logging Everything

Structured logging bagus, tetapi log berlebihan bisa menjadi bottleneck.

---

## 24. Case Study: Regulatory Application Worklist

### Problem

User mengeluh worklist lambat.

Endpoint:

```text
GET /applications/worklist?status=PENDING&page=1
```

Current implementation:

```text
1. Application service query 50 pending applications
2. For each application:
   - call Profile service
   - call Document service
   - call Workflow service
   - call Compliance service
3. Aggregate result
4. Return table
```

Untuk 50 rows:

```text
1 DB query
+ 50 profile calls
+ 50 document calls
+ 50 workflow calls
+ 50 compliance calls
= 201 operations
```

### Symptoms

```text
p50 = 800 ms
p95 = 6 seconds
p99 = 15 seconds
timeout during morning peak
Profile service p99 high
Document service occasionally slow
DB pool wait rises
```

### Diagnosis

Masalah bukan hanya endpoint lambat. Masalah arsitektural:

- worklist membutuhkan read model,
- API composition terlalu chatty,
- fan-out per row,
- dependency p99 memperburuk aggregator p99,
- synchronous call graph tidak sesuai use case,
- query read path tidak dioptimalkan.

### Redesign

Gunakan projection:

```text
ApplicationSubmitted event
ProfileUpdated event
DocumentStatusChanged event
WorkflowTaskAssigned event
ComplianceFlagUpdated event
        ↓
Worklist Projection Service
        ↓
worklist_read_model table/search index
        ↓
GET /applications/worklist reads one optimized model
```

### New Endpoint Path

```text
Gateway
 -> Worklist Query Service
 -> Read model DB/search index
 -> Response
```

### Trade-off

| Aspek | Sebelum | Sesudah |
|---|---|---|
| Latency | Tinggi, fan-out | Rendah, single read path |
| Freshness | Real-time dependency | Eventually consistent |
| Complexity | Runtime coupling | Projection pipeline complexity |
| Failure | Downstream slow affects user | Projection lag affects freshness |
| Observability | Hard to isolate | Need projection freshness metrics |

### Required SLO

```text
Worklist p95 <= 500 ms
Projection freshness p95 <= 5 seconds
Projection freshness p99 <= 30 seconds
```

---

## 25. Review Checklist untuk Performance Design

Gunakan checklist ini saat architecture review.

### User Operation

```text
Apa target p50/p95/p99?
Apa target throughput?
Apa traffic mix?
Apa critical path?
Apa dependency serial dan parallel?
Apa operation yang bisa async?
Apa correctness requirement?
```

### Dependency

```text
Berapa remote call per request?
Berapa DB query per request?
Berapa cache call per request?
Berapa message publish per request?
Apa timeout setiap dependency?
Apa retry policy?
Apa fallback policy?
```

### Resource

```text
Berapa active request concurrency?
Berapa DB pool size per replica?
Berapa total DB connection semua replica?
Berapa HTTP client pool?
Berapa executor queue limit?
Berapa heap/native memory?
Apa CPU request/limit?
```

### Data

```text
Apakah query memakai index?
Apakah pagination stable?
Apakah payload terlalu besar?
Apakah ada N+1 query?
Apakah read model diperlukan?
Apakah report/export mengganggu OLTP?
```

### Runtime

```text
Apakah container CPU throttling terjadi?
Apakah memory limit realistis?
Apakah GC pause terlihat?
Apakah JFR pernah diambil?
Apakah readiness probe mencerminkan dependency readiness?
```

### Observability

```text
Apakah p95/p99 tersedia?
Apakah trace menunjukkan critical path?
Apakah dependency latency terpisah?
Apakah pool wait time terlihat?
Apakah queue lag terlihat?
Apakah projection freshness terlihat?
```

---

## 26. Production Readiness Checklist

Sebuah Java microservice belum performance-ready jika belum memiliki:

```text
[ ] Defined SLO per critical endpoint/use case
[ ] Latency budget per critical path
[ ] p50/p95/p99 metrics
[ ] Downstream dependency latency metrics
[ ] DB pool active/idle/pending metrics
[ ] HTTP client pool metrics if available
[ ] Timeout configured intentionally
[ ] Retry bounded with backoff and jitter
[ ] Concurrency limiter for expensive operation
[ ] Load shedding behavior
[ ] Payload size limits
[ ] Pagination strategy
[ ] Slow query visibility
[ ] JFR/profiling procedure
[ ] Performance test scenario matching traffic mix
[ ] Soak test for memory/connection leak
[ ] Capacity model for peak load
[ ] Headroom target
[ ] Release performance regression check
[ ] Dashboard for latency, traffic, errors, saturation
[ ] Runbook for high latency incident
```

---

## 27. Practical Exercises

### Exercise 1 — Latency Budget

Pilih satu operation penting, misalnya:

```text
Submit Application
Approve Case
Generate Worklist
Create Appeal
Sync External Agency
```

Buat:

```text
end-to-end latency target
critical path
dependency list
timeout per dependency
retry policy
fallback policy
p95/p99 metrics
```

### Exercise 2 — Fan-Out Risk

Ambil satu endpoint aggregator.

Hitung:

```text
jumlah downstream service
jumlah call per service
serial vs parallel
p95/p99 downstream latency
estimated end-to-end p95/p99
```

Redesign menjadi:

- projection,
- cache,
- async update,
- BFF partial response,
- or fewer boundaries.

### Exercise 3 — Pool Review

Untuk satu service Java:

```text
replica count
DB max pool per replica
total possible DB connections
average transaction duration
peak RPS
pool wait metric
```

Tentukan apakah pool terlalu kecil, terlalu besar, atau masalahnya bukan pool.

### Exercise 4 — JFR Capture Plan

Buat runbook:

```text
when to capture JFR
how long to capture
what workload to run
where to store file
what symptoms to inspect
how to compare before/after
```

### Exercise 5 — Projection Freshness

Untuk read model/worklist:

```text
source events
projection table/index
expected freshness p95
lag metric
rebuild strategy
reconciliation strategy
```

---

## 28. Mental Model Akhir

Performance engineering microservices bukan tentang membuat satu method cepat.

Ia adalah kemampuan membaca sistem sebagai jaringan constraint:

```text
latency budget
+ critical path
+ dependency behavior
+ resource capacity
+ data access pattern
+ runtime behavior
+ observability
+ failure mode
```

Engineer top-tier tidak langsung berkata:

```text
Tambah cache.
Naikkan thread pool.
Tambah replica.
Ganti ke reactive.
Pakai virtual thread.
Tune GC.
```

Engineer top-tier bertanya dulu:

```text
Apa bottleneck aktualnya?
Di percentile mana masalah muncul?
Apakah ini CPU, IO, pool, DB, lock, GC, queue, network, atau downstream?
Apakah critical path memang perlu seperti ini?
Apakah load yang masuk bounded?
Apakah dependency sanggup menerima pressure ini?
Apakah user butuh hasil synchronous?
Apakah read model lebih tepat?
Apa trade-off consistency-nya?
Apakah observability membuktikan hipotesis?
```

Itulah perbedaan antara tuning lokal dan performance engineering arsitektural.

---

## 29. Ringkasan

Pada bagian ini kita membahas:

1. performance sebagai property arsitektur microservices,
2. perbedaan latency, throughput, concurrency, utilization, saturation,
3. pentingnya percentile dan tail latency,
4. critical path analysis,
5. latency budget,
6. fan-out amplification,
7. capacity model,
8. bottleneck taxonomy,
9. synchronous vs asynchronous performance,
10. database, serialization, cache, threading, JVM, runtime,
11. Java 8–25 implications,
12. JFR dan OpenTelemetry,
13. performance testing,
14. capacity planning,
15. production readiness checklist.

Seri belum selesai. Kita baru menyelesaikan:

```text
Part 27 dari 35
```

Bagian berikutnya:

```text
Part 28 — Caching Pattern in Microservices
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-28-caching-patterns.md
```

---

## Referensi

1. Oracle Java SE 21 Documentation — Virtual Threads.  
   https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html

2. Oracle JDK 25 Release Notes.  
   https://www.oracle.com/asean/java/technologies/javase/25-relnote-issues.html

3. Inside Java — Performance Improvements in JDK 25.  
   https://inside.java/2025/10/20/jdk-25-performance-improvements/

4. Google SRE Book — Monitoring Distributed Systems.  
   https://sre.google/sre-book/monitoring-distributed-systems/

5. Google SRE Book — Handling Overload.  
   https://sre.google/sre-book/handling-overload/

6. OpenTelemetry — What is OpenTelemetry?  
   https://opentelemetry.io/docs/what-is-opentelemetry/

7. OpenTelemetry Java Documentation.  
   https://opentelemetry.io/docs/languages/java/

8. Oracle Documentation — Java Mission Control and Java Flight Recorder.  
   https://docs.oracle.com/en/cloud/paas/app-container-cloud/dvcjv/java-mission-control-and-java-flight-recorder.html

9. Red Hat OpenJDK Documentation — Introduction to JDK Flight Recorder.  
   https://docs.redhat.com/en/documentation/red_hat_build_of_openjdk/11/html/using_jdk_flight_recorder_with_red_hat_build_of_openjdk/openjdk-flight-recorded-overview

10. OpenJDK JEP 444 — Virtual Threads.  
    https://openjdk.org/jeps/444

11. OpenJDK JEP 328 — Flight Recorder.  
    https://openjdk.org/jeps/328
