# learn-redis-mastery-for-java-engineers-part-000.md

# Part 000 — Orientation: Redis sebagai Sistem, Bukan Sekadar Cache

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `000 / 034`  
> Target pembaca: Java software engineer yang ingin memahami Redis dari level mental model, desain sistem, correctness, performance, operability, sampai production readiness.  
> Fokus bagian ini: membangun peta berpikir sebelum masuk ke command, data structure, Java client, cache pattern, replication, cluster, dan operasi.

---

## 0. Status Seri

Ini adalah **bagian 0** dari total rencana **35 bagian**:

```text
learn-redis-mastery-for-java-engineers-part-000.md
...
learn-redis-mastery-for-java-engineers-part-034.md
```

Seri **belum selesai**. Ini baru bagian orientasi awal.

Bagian terakhir nanti adalah:

```text
learn-redis-mastery-for-java-engineers-part-034.md
```

---

## 1. Mengapa Redis Layak Dipelajari Serius

Banyak engineer mengenal Redis sebagai “cache”. Itu tidak salah, tetapi terlalu sempit.

Redis lebih tepat dipahami sebagai:

```text
in-memory data structure server
+ low-latency remote state layer
+ transient coordination primitive
+ cache engine
+ queue/stream-ish tool
+ counter/rate-limit/idempotency store
+ operationally sensitive infrastructure component
```

Redis bukan hanya tempat menyimpan `key -> value`. Redis memberi kita struktur data yang bisa dimanipulasi secara atomik dari luar proses aplikasi:

- String
- Hash
- List
- Set
- Sorted Set
- Stream
- Bitmap
- Bitfield
- HyperLogLog
- Geospatial index
- JSON
- Search / Query Engine
- Time series
- Probabilistic structures
- Vector-related structures pada Redis modern

Dari perspektif Java backend engineer, Redis sering muncul di jalur kritikal:

```text
request masuk
  -> cek session/token/cache/rate-limit/idempotency
  -> query database atau service lain
  -> update transient state
  -> response
```

Artinya Redis sering berada **di depan database**, **di dalam hot path**, dan **di jalur latency paling sensitif**.

Konsekuensinya: Redis bisa mempercepat sistem secara drastis, tetapi Redis juga bisa membuat sistem menjadi tidak konsisten, sulit di-debug, sulit dioperasikan, atau kehilangan data jika dipakai dengan asumsi yang salah.

---

## 2. Cara Membaca Seri Ini

Seri ini tidak ditulis sebagai kumpulan command Redis. Command bisa dicari. Yang lebih penting adalah memahami:

1. **Kapan command tertentu aman digunakan.**
2. **Apa invariant yang harus dijaga.**
3. **Apa failure mode-nya.**
4. **Apa konsekuensi memory dan latency-nya.**
5. **Bagaimana Redis berinteraksi dengan Java runtime, thread, connection, serializer, retry, dan timeout.**
6. **Kapan Redis bukan jawaban yang tepat.**

Target akhirnya bukan sekadar bisa menulis:

```redis
SET user:123 "..."
GET user:123
```

Target akhirnya adalah bisa menjawab pertanyaan seperti:

- Apakah state ini boleh hilang?
- Apakah state ini boleh stale?
- Apakah operasi ini butuh durability?
- Apakah operasi ini butuh ordering?
- Apakah key ini bisa menjadi hot key?
- Apakah value ini bisa menjadi big value?
- Apa yang terjadi saat Redis failover?
- Apa yang terjadi saat JVM GC pause?
- Apakah retry command ini aman?
- Apakah TTL adalah bagian dari business rule atau hanya optimization?
- Apakah Redis ini cache, coordination layer, atau database?
- Apakah data ini punya audit requirement?

Jika kamu bisa menjawab pertanyaan-pertanyaan itu dengan tenang, kamu sedang bergerak dari “Redis user” menjadi “Redis-capable system designer”.

---

## 3. Definisi Mental: Redis Itu Apa?

Redis adalah server yang menyimpan data di memory dan mengekspos operasi atas data tersebut melalui network protocol.

Secara mental:

```text
Java application
    |
    | Redis protocol over TCP/TLS
    v
Redis server process
    |
    +-- keyspace
    |     +-- key -> typed value
    |
    +-- command executor
    |
    +-- memory allocator
    |
    +-- optional persistence
    |
    +-- optional replication
    |
    +-- optional cluster distribution
```

Redis menyimpan data sebagai key yang menunjuk ke value bertipe tertentu.

Contoh:

```text
user:123:profile      -> Hash
user:123:sessions     -> Set
tenant:77:quota       -> String counter
game:leaderboard      -> Sorted Set
order-events          -> Stream
presence:online-users -> Set
```

Perbedaan penting dibanding `Map<String, Object>` di Java:

| Aspek | Java Map | Redis |
|---|---:|---:|
| Lokasi | Dalam JVM | Proses terpisah |
| Akses | In-process | Network call |
| Latency | Nanosecond/microsecond | Biasanya sub-ms sampai beberapa ms tergantung network dan beban |
| Sharing | Satu proses | Banyak proses/service |
| Durability | Bergantung aplikasi | Opsional via RDB/AOF |
| Atomicity | Bergantung lock/concurrency lokal | Per command atomic di server Redis |
| Failure mode | JVM crash | Redis crash, network split, failover, eviction, timeout |
| Capacity unit | Heap | Redis memory, allocator overhead, fragmentation |

Kesalahan awal yang umum: menganggap Redis sebagai remote Java Map.

Redis bukan remote Java Map. Redis adalah distributed dependency dengan contract, capacity, latency, dan failure mode sendiri.

---

## 4. Redis Bukan Hanya Cache

Redis sering dipakai sebagai cache karena sangat cepat dan mendukung TTL. Namun Redis juga sering dipakai untuk:

1. **Session store**
2. **Rate limiter**
3. **Idempotency key store**
4. **Distributed lock atau lease**
5. **Counter**
6. **Leaderboard**
7. **Delay queue**
8. **Deduplication window**
9. **Presence tracking**
10. **Feature flag evaluation cache**
11. **Temporary workflow state**
12. **Pub/Sub signal bus**
13. **Redis Streams consumer group**
14. **Search/document/vector workloads pada Redis modern**

Tetapi setiap use case punya batas aman berbeda.

Contoh:

```text
Use case: cache product detail
Data loss: acceptable
Staleness: acceptable within TTL
Durability: not required
Source of truth: database
Redis failure behavior: degrade to DB
```

Berbeda dengan:

```text
Use case: payment idempotency key
Data loss: dangerous
Staleness: dangerous
Durability: maybe required
Source of truth: should probably be database, not Redis alone
Redis failure behavior: must fail closed or use fallback
```

Redis bisa dipakai untuk keduanya, tetapi desainnya tidak boleh sama.

---

## 5. Redis vs SQL Database

Karena kamu sudah belajar SQL/PostgreSQL/MySQL, kita tidak akan mengulang teori database relational. Yang penting adalah batas peran.

### 5.1 SQL Database

SQL database unggul untuk:

- durable source of truth
- transaksi kuat
- relational integrity
- query fleksibel
- constraint
- indexing kompleks
- auditability
- historical record
- recovery yang matang
- reporting
- multi-row consistency

### 5.2 Redis

Redis unggul untuk:

- low-latency access
- transient state
- TTL-based state
- high-frequency counters
- hot read cache
- atomic primitive sederhana
- compact data structure operations
- coordination dengan batasan
- sorted ranking/time index sederhana
- deduplication window

### 5.3 Perbandingan Mental

```text
SQL adalah tempat kebenaran jangka panjang.
Redis adalah tempat state cepat, dekat, dan sering sementara.
```

Bukan berarti Redis tidak bisa persistent. Redis punya RDB dan AOF. Namun Redis tetap memory-first. Ketika Redis dijadikan source of truth, kamu harus secara eksplisit mendesain:

- durability window
- backup
- restore
- replication lag
- failover behavior
- memory ceiling
- eviction policy
- write amplification
- persistence cost
- legal/audit requirement

Default sehat untuk backend bisnis:

```text
If data must be legally, financially, or operationally authoritative,
do not casually make Redis the only source of truth.
```

---

## 6. Redis vs Kafka dan RabbitMQ

Kamu sudah belajar Kafka dan RabbitMQ, jadi bagian ini hanya membedakan peran Redis.

### 6.1 Kafka

Kafka cocok untuk:

- durable event log
- replay
- ordered partition log
- event sourcing style backbone
- stream processing
- high-throughput event distribution
- consumer offset model
- long retention

### 6.2 RabbitMQ

RabbitMQ cocok untuk:

- brokered messaging
- routing exchange
- work queues
- acknowledgements
- delivery control
- protocol-level messaging semantics
- command/task distribution

### 6.3 Redis Lists / Streams / Pub/Sub

Redis bisa melakukan beberapa hal yang “mirip messaging”, tetapi contract-nya berbeda.

Redis Pub/Sub:

```text
fast signal fanout
no durability
subscriber disconnect -> message missed
```

Redis Lists:

```text
simple queue primitive
can block pop
limited delivery semantics
manual reliability pattern needed
```

Redis Streams:

```text
append-only stream-like data structure
consumer groups
pending entries
acknowledgement
retention/trimming
```

Namun Redis Streams tetap bukan otomatis pengganti Kafka. Untuk event log yang harus durable, replayable, retained panjang, dan menjadi backbone antar domain, Kafka biasanya lebih natural.

Rule of thumb:

```text
Use Redis for fast operational state and lightweight stream/queue needs.
Use Kafka/RabbitMQ when messaging semantics are the core of the system.
```

---

## 7. Redis vs Local Cache di JVM

Java engineer sering punya pilihan:

- local cache: Caffeine, Guava, in-memory map
- distributed cache: Redis

### 7.1 Local Cache

Kelebihan:

- sangat cepat
- tidak ada network call
- mengurangi beban Redis/database
- bagus untuk read-mostly config/reference data

Kekurangan:

- per instance berbeda
- invalidation lebih sulit
- memory tersebar di tiap JVM
- tidak cocok untuk shared counter/state

### 7.2 Redis Cache

Kelebihan:

- shared antar instance
- central TTL
- bisa atomic counter/set operations
- bisa dipakai lintas service/language

Kekurangan:

- network latency
- dependency eksternal
- bottleneck terpusat jika salah desain
- bisa menyebabkan cascading failure

### 7.3 Layered Cache

Arsitektur umum:

```text
request
  -> local cache, e.g. Caffeine
  -> Redis cache
  -> database/service of record
```

Ini kuat untuk hot read path, tetapi invalidation menjadi lebih kompleks.

Kamu harus mendesain:

- local TTL
- Redis TTL
- invalidation signal
- stale tolerance
- cache stampede protection
- fallback behavior

---

## 8. Core Redis Mental Models

Bagian ini adalah inti orientasi. Seluruh seri berikutnya akan mengulang dan memperdalam mental model ini.

---

### 8.1 Redis adalah Memory-First System

Redis menyimpan working dataset di memory.

Artinya kapasitas utama Redis bukan disk, melainkan RAM.

Pertanyaan desain pertama:

```text
Berapa banyak key?
Berapa ukuran rata-rata key?
Berapa ukuran rata-rata value?
Berapa overhead struktur datanya?
Berapa TTL rata-rata?
Berapa peak cardinality?
Berapa fragmentation overhead?
Berapa growth rate?
```

Redis yang tidak punya memory budget adalah bom waktu.

Contoh buruk:

```text
SET user-session:{uuid} <large-json>
TTL tidak ada
traffic terus naik
memory naik perlahan
Redis penuh
eviction/random failure
```

Contoh lebih sehat:

```text
Key: session:{sessionId}
Value: compact JSON or Hash
TTL: 30 minutes sliding or absolute
Max estimated active sessions: 2 million
Average payload: 800 bytes
Estimated memory budget: payload + key + Redis overhead + fragmentation
Eviction policy: explicitly selected
Monitoring: used_memory, mem_fragmentation_ratio, evicted_keys, key count sampling
```

Redis performance bukan hanya soal “cepat”. Redis performance juga soal tidak kehabisan memory.

---

### 8.2 Redis Command Biasanya Atomic Per Command

Redis command seperti `INCR`, `SADD`, `ZADD`, `HSET` dieksekusi sebagai operasi atomic dari perspektif client lain.

Contoh:

```redis
INCR tenant:77:request-count
```

Jika 100 request bersamaan menjalankan `INCR`, Redis akan menghasilkan nilai yang konsisten tanpa race condition seperti `get -> increment -> set` manual di aplikasi.

Tetapi atomic per command bukan berarti semua alur bisnis atomic.

Contoh tidak atomic:

```text
GET quota
if quota > 0:
    DECR quota
    allow request
```

Di bawah concurrency, pola ini bermasalah jika dilakukan sebagai beberapa command terpisah.

Solusi bisa berupa:

- command atomic tunggal jika tersedia
- Lua script
- Redis Function
- transaction dengan WATCH/MULTI/EXEC
- pindahkan invariant ke database
- ubah desain agar tidak membutuhkan atomicity lintas langkah

---

### 8.3 Redis adalah Network Dependency

Dari Java, Redis bukan function call lokal. Redis adalah remote call.

Biaya satu command:

```text
serialize command
  -> acquire/get connection
  -> write to socket
  -> network transfer
  -> Redis queue/execute
  -> response transfer
  -> parse response
  -> deserialize result
```

Jika kamu melakukan 50 Redis command per HTTP request, latency bisa hancur meski tiap command cepat.

Pola buruk:

```java
for (String id : ids) {
    redis.get("user:" + id);
}
```

Pola lebih sehat:

```java
redis.mget(keys);
```

atau pipeline jika command tidak punya bentuk multi-key yang cocok.

Rule:

```text
Redis command count per request adalah bagian dari performance design.
```

---

### 8.4 Redis Keyspace Harus Didesain

Key Redis adalah API internal sistemmu.

Key tidak boleh tumbuh organik tanpa struktur.

Contoh key buruk:

```text
123
user123
cache_user_123
abc
```

Contoh key lebih baik:

```text
svc:identity:user:{userId}:profile:v1
svc:billing:tenant:{tenantId}:quota:daily:{yyyyMMdd}
svc:case:{caseId}:workflow:lock
svc:enforcement:actor:{actorId}:permissions:v2
```

Key naming harus menjawab:

- owner service siapa?
- bounded context apa?
- entity apa?
- identifier apa?
- purpose apa?
- version apa?
- TTL ada atau tidak?
- apakah key akan dipakai dalam Redis Cluster?
- apakah butuh hash tag agar multi-key command satu slot?

Redis key schema harus diperlakukan seperti schema database ringan.

---

### 8.5 TTL adalah Contract, Bukan Hiasan

TTL menentukan kapan Redis boleh menghapus data.

Jika TTL hilang, data bisa hidup selamanya.
Jika TTL terlalu pendek, sistem bisa kehilangan state penting.
Jika TTL terlalu panjang, memory bisa penuh.

TTL bukan hanya optimization. TTL sering menjadi bagian dari business semantics.

Contoh:

```text
idempotency key valid 24 jam
password reset token valid 15 menit
rate limiter window 60 detik
session idle timeout 30 menit
cache product detail 5 menit
```

Pertanyaan wajib:

```text
Apa arti key hilang?
Apa arti key masih ada?
Apa yang terjadi jika TTL expire tepat saat request masuk?
Apa yang terjadi jika Redis restart dan data belum dipersist?
Apakah TTL harus sliding atau absolute?
```

---

### 8.6 Eviction Bukan Expiration

Expiration terjadi karena TTL habis.

Eviction terjadi karena Redis kehabisan memory dan harus membuang key berdasarkan policy.

Ini beda.

```text
Expiration: data memang sudah waktunya hilang.
Eviction: data hilang karena tekanan memory.
```

Jika Redis dipakai sebagai cache, eviction mungkin acceptable.

Jika Redis dipakai untuk lock, idempotency, quota, atau workflow state, eviction bisa berbahaya.

Rule:

```text
Jika key tidak boleh hilang sebelum TTL/business completion,
jangan pakai eviction policy yang dapat membuang key tersebut secara diam-diam.
```

---

### 8.7 Redis Bisa Persistent, Tetapi Tidak Otomatis Sama dengan Database Durable

Redis punya mekanisme persistence seperti snapshot dan append-only file. Namun persistence punya trade-off:

- data loss window
- disk I/O
- fsync policy
- fork/copy-on-write overhead
- recovery time
- rewrite cost
- operational complexity

Pertanyaan penting:

```text
Jika Redis crash, berapa banyak data boleh hilang?
Jika node primary mati, apakah replica punya semua write terbaru?
Jika restore dari backup, data TTL bagaimana?
Jika AOF corrupt, apa rencana recovery?
```

Jika jawaban ini tidak jelas, Redis belum aman dijadikan source of truth.

---

### 8.8 Replication Biasanya Asynchronous

Dalam banyak konfigurasi Redis, replica mengikuti primary secara asynchronous.

Artinya:

```text
write ke primary berhasil
response balik ke aplikasi
replica belum tentu sudah menerima write tersebut
primary crash
failover ke replica
write terbaru mungkin hilang
```

Ini bukan bug; ini trade-off availability/performance.

Jika sistemmu butuh durability kuat, jangan menganggap replication Redis otomatis memberi guarantee seperti database transactional replication yang kamu bayangkan.

---

### 8.9 Redis Cluster Membagi Key Berdasarkan Hash Slot

Redis Cluster mendistribusikan key ke slot.

Konsekuensinya:

- tidak semua multi-key command bisa dilakukan lintas key
- key naming harus cluster-aware
- hash tag bisa memaksa beberapa key berada di slot sama
- hot slot bisa menjadi bottleneck
- client Java harus cluster-aware

Jika kamu mendesain key tanpa memikirkan cluster, migrasi ke cluster nanti bisa menyakitkan.

---

### 8.10 Redis Failure Harus Dianggap Normal

Redis bisa:

- timeout
- overload
- restart
- failover
- lose connection
- reject write karena memory penuh
- evict key
- expire key
- return stale data dari replica
- mengalami latency spike
- terkena hot key
- terkena big key
- membuat client pool exhausted

Sistem yang matang tidak hanya bertanya:

```text
Bagaimana jika Redis cepat?
```

Tetapi:

```text
Bagaimana jika Redis lambat?
Bagaimana jika Redis tidak tersedia?
Bagaimana jika Redis mengembalikan data stale?
Bagaimana jika Redis kehilangan key?
Bagaimana jika Redis command berhasil tetapi response timeout?
```

---

## 9. Redis Use Case Map

Berikut peta use case Redis dan pertanyaan desainnya.

---

### 9.1 Cache

Contoh:

```text
product:{id}:summary
user:{id}:permissions
tenant:{id}:config
```

Cocok jika:

- data bisa dihitung ulang
- source of truth ada di tempat lain
- staleness bisa diterima
- TTL jelas
- miss behavior jelas

Bahaya jika:

- data dianggap selalu benar
- invalidation tidak dirancang
- cache miss menimbulkan DB stampede
- payload terlalu besar
- key tidak punya TTL

---

### 9.2 Session Store

Contoh:

```text
session:{sessionId}
```

Cocok jika:

- session boleh expire
- session perlu shared antar app instance
- TTL menjadi bagian dari security policy

Pertanyaan:

- sliding expiration atau absolute expiration?
- logout menghapus key atau menandai revoked?
- bagaimana jika Redis down?
- apakah user harus login ulang?
- apakah session perlu persistent?

---

### 9.3 Rate Limiter

Contoh:

```text
rate:{tenantId}:{endpoint}:{minute}
```

Cocok jika:

- enforcement butuh low latency
- quota window sederhana
- atomic counter membantu correctness

Pertanyaan:

- fixed window, sliding window, token bucket, atau leaky bucket?
- key cardinality berapa?
- TTL berapa?
- apakah limit per user, tenant, IP, endpoint, API key?
- jika Redis down, fail open atau fail closed?

---

### 9.4 Idempotency Key Store

Contoh:

```text
idempotency:{clientId}:{requestId}
```

Cocok jika:

- duplikasi request perlu dicegah
- retention window jelas
- response replay diperlukan

Bahaya jika:

- operasi finansial/regulatory critical hanya bergantung pada Redis volatile
- Redis eviction menghapus idempotency key
- key dibuat sebelum operasi selesai tanpa state machine yang jelas

State yang lebih baik:

```text
STARTED -> COMPLETED -> EXPIRED
        -> FAILED_RETRYABLE
        -> FAILED_FINAL
```

---

### 9.5 Distributed Lock / Lease

Contoh:

```text
lock:case:{caseId}:assignment
```

Redis lock bisa berguna, tetapi sangat sering disalahgunakan.

Lock Redis adalah lease, bukan magic mutual exclusion selamanya.

Risiko:

- TTL habis saat critical section masih berjalan
- JVM GC pause
- network delay
- client timeout
- primary failover
- stale owner masih menulis ke resource

Untuk resource yang benar-benar harus dilindungi, sering perlu **fencing token** di sisi resource final.

---

### 9.6 Leaderboard / Ranking

Contoh:

```text
game:{gameId}:leaderboard
```

Sorted Set cocok untuk:

- ranking
- score update
- top-N query
- rank query

Pertanyaan:

- score precision aman?
- tie-breaking bagaimana?
- berapa cardinality?
- apakah leaderboard perlu historical snapshot?

---

### 9.7 Delay Queue / Scheduler Ringan

Contoh:

```text
schedule:email-retry
member = jobId
score = executeAtEpochMillis
```

Sorted Set bisa dipakai sebagai delay queue.

Pertanyaan:

- bagaimana worker claim job secara atomic?
- bagaimana retry?
- bagaimana poison job?
- bagaimana recovery jika worker mati setelah claim?
- apakah ini sebaiknya masuk message broker?

---

### 9.8 Presence / Online Users

Contoh:

```text
presence:tenant:{tenantId}:online-users
```

Set cocok untuk membership.

Pertanyaan:

- heartbeat interval?
- stale presence cleanup?
- per user TTL atau set membership?
- apakah butuh approximate online count?

---

### 9.9 Pub/Sub Signal

Contoh:

```text
channel:cache-invalidation
```

Cocok untuk:

- invalidation signal
- lightweight notification
- local instance refresh

Tidak cocok untuk:

- audit event
- reliable business event
- payment event
- job queue yang harus diproses pasti

---

### 9.10 Redis Streams

Contoh:

```text
stream:notifications
stream:case-status-events
```

Streams cocok untuk event processing ringan dengan consumer group.

Pertanyaan:

- retention berapa?
- pending entries dikelola bagaimana?
- consumer mati bagaimana?
- trimming policy?
- apakah replay jangka panjang perlu?
- apakah ordering lintas partition/domain perlu?

---

## 10. Redis Modern: Bukan Lagi Hanya Core Data Types

Redis modern mencakup kemampuan lebih luas:

- RedisJSON
- Redis Query Engine / Search
- Time series
- Probabilistic data structures
- Vector search / vector-related capability

Namun prinsip desain tetap sama:

```text
Kemampuan bertambah bukan berarti Redis cocok menjadi semua database sekaligus.
```

Gunakan Redis modern untuk:

- low-latency search tertentu
- document lookup dengan index ringan/sedang
- semantic retrieval dekat aplikasi
- feature-rich cache/search hybrid
- real-time metadata filtering

Hati-hati jika:

- dataset sangat besar
- query sangat kompleks
- durability/audit sangat ketat
- indexing cost tidak dipahami
- memory budget tidak jelas
- team belum siap mengoperasikan Redis sebagai search/vector platform

---

## 11. Cara Berpikir Top 1% Saat Memakai Redis

Engineer biasa bertanya:

```text
Command Redis apa yang bisa dipakai?
```

Engineer matang bertanya:

```text
Invariant apa yang harus benar?
Data apa yang boleh hilang?
Data apa yang boleh stale?
Berapa latency budget?
Berapa memory budget?
Apa failure mode-nya?
Bagaimana observability-nya?
Bagaimana rollback-nya?
Apa alternatif selain Redis?
```

---

## 12. Redis Design Invariants

Sebelum membuat key Redis baru, tulis invariant-nya.

Template:

```text
Name:
Owner service:
Purpose:
Key pattern:
Value type:
Value format:
TTL:
Source of truth:
Can be missing:
Can be stale:
Can be evicted:
Persistence required:
Max cardinality:
Max value size:
Expected QPS:
Hot key risk:
Cluster slot concern:
Failure behavior:
Observability:
Deletion/migration plan:
```

Contoh:

```text
Name: user permission cache
Owner service: identity-service
Purpose: speed up permission evaluation
Key pattern: svc:identity:user:{userId}:permissions:v2
Value type: JSON string or Set
TTL: 5 minutes + jitter
Source of truth: PostgreSQL permissions tables
Can be missing: yes, reload from DB
Can be stale: yes, max 5 minutes except admin revocation path
Can be evicted: yes
Persistence required: no
Max cardinality: active users in last 5 minutes
Max value size: < 20 KB
Expected QPS: 5k reads/sec
Hot key risk: service/admin users maybe
Cluster slot concern: no multi-key operation
Failure behavior: fallback to DB with circuit breaker and request coalescing
Observability: hit rate, miss rate, load latency, DB fallback rate, key size sampling
Deletion/migration plan: versioned key v2, old v1 expires naturally
```

Contoh lain untuk idempotency:

```text
Name: payment idempotency guard
Owner service: payment-service
Purpose: prevent duplicate payment execution
Key pattern: svc:payment:idempotency:{merchantId}:{requestId}
Value type: Hash
Value fields: status, fingerprint, responseRef, createdAt, completedAt
TTL: 48 hours
Source of truth: payment database transaction table remains authoritative
Can be missing: dangerous; fallback to DB unique constraint
Can be stale: dangerous
Can be evicted: no
Persistence required: preferably yes, but not sole guarantee
Max cardinality: requests in 48h window
Expected QPS: peak payment request rate
Hot key risk: low if requestId distributed
Cluster slot concern: request-specific only
Failure behavior: fail closed or verify DB before proceeding
Observability: duplicate detected, started/completed ratio, expired started keys
Deletion/migration plan: TTL-based
```

Perhatikan perbedaannya. Dua use case sama-sama memakai Redis, tetapi risk posture-nya berbeda total.

---

## 13. Redis Failure Matrix

Gunakan matriks ini untuk setiap desain Redis.

| Failure | Pertanyaan | Contoh Mitigasi |
|---|---|---|
| Redis down | Apakah request gagal atau fallback? | fallback DB, fail closed, circuit breaker |
| Redis slow | Apakah thread Java habis menunggu? | timeout pendek, bulkhead, pool limit |
| Timeout setelah write | Apakah retry aman? | idempotent command, token, read-after-timeout |
| Key expired | Apakah business flow rusak? | TTL sesuai lifecycle, reload, state machine |
| Key evicted | Apakah data boleh hilang? | noeviction, separate Redis, memory budget |
| Replica stale | Apakah read dari replica aman? | read primary untuk critical path |
| Failover | Apakah write terbaru bisa hilang? | tolerate loss, WAIT/stronger design, DB authority |
| Hot key | Apakah satu key overload? | local cache, sharding, precompute |
| Big key | Apakah command menjadi lambat? | split key, cap size, scan strategy |
| Client pool exhausted | Apakah request menumpuk? | pool metrics, backpressure, async, timeout |
| Serializer change | Apakah old value masih bisa dibaca? | versioned value, migration, tolerant parser |
| Cluster resharding | Apakah client handle MOVED/ASK? | cluster-aware client |

---

## 14. Redis dan Java: Kenapa Konteks Java Penting

Redis digunakan lewat client library. Untuk Java, library umum meliputi:

- Lettuce
- Jedis
- Spring Data Redis
- Redisson

Fokus utama seri ini:

1. **Lettuce** untuk sync/async/reactive dan cluster-aware usage.
2. **Jedis** untuk synchronous straightforward usage.
3. **Spring Data Redis** untuk integrasi Spring Boot, RedisTemplate, serializers, cache abstraction.
4. **Redisson** akan dibahas sebagai tambahan saat membahas distributed objects/locks, tetapi tidak menjadi default utama.

Java-specific concern:

### 14.1 Connection Management

Redis command dikirim lewat koneksi network.

Pertanyaan:

- satu shared connection cukup?
- butuh connection pool?
- blocking command dipisah?
- reactive pipeline aman?
- timeout per command berapa?

### 14.2 Serialization

Redis menyimpan bytes/string. Java object harus diserialisasi.

Bahaya umum:

- Java native serialization
- serializer berubah tanpa versioning
- class rename memecahkan deserialization
- payload terlalu besar
- JSON tanpa schema discipline

Rekomendasi awal:

```text
Treat Redis value format as external wire format, not internal Java object dump.
```

### 14.3 Threading dan Backpressure

Redis cepat, tapi Java service bisa tetap rusak karena:

- thread pool penuh
- connection pool penuh
- retry storm
- synchronous calls dalam loop
- blocking Redis command di connection yang sama
- reactive stream tanpa backpressure

### 14.4 Spring Cache Trap

Spring Cache membuat caching terasa mudah:

```java
@Cacheable("users")
public User getUser(String id) { ... }
```

Tetapi abstraction ini bisa menyembunyikan:

- key naming
- TTL
- serializer
- cache stampede
- null caching
- invalidation
- per-cache policy
- observability

Spring Cache bagus jika policy jelas. Berbahaya jika dipakai untuk “menambah Redis” tanpa desain.

---

## 15. Redis Operational Reality

Redis di production bukan hanya command dan library.

Redis harus dioperasikan.

Area wajib:

1. **Memory planning**
2. **Eviction policy**
3. **Persistence config**
4. **Backup/restore**
5. **Replication/failover**
6. **Cluster topology**
7. **Security/TLS/ACL**
8. **Monitoring/alerting**
9. **Slowlog**
10. **Latency monitor**
11. **Big key/hot key detection**
12. **Upgrade strategy**
13. **Disaster recovery drill**
14. **Client timeout and retry policy**

Redis failure sering bukan karena Redis “jelek”, tetapi karena Redis dipakai tanpa operational contract.

---

## 16. Prinsip: Redis Harus Punya Boundary

Redis sering menjadi “tempat cepat untuk apa saja”. Ini awal dari technical debt.

Boundary yang sehat:

```text
Redis deployment/prefix/database digunakan untuk bounded context tertentu.
Setiap key family punya owner.
Setiap key family punya TTL atau alasan eksplisit tanpa TTL.
Setiap key family punya memory estimate.
Setiap critical use case punya failure behavior.
```

Anti-pattern:

```text
Semua service pakai Redis yang sama.
Semua key campur.
Tidak ada prefix owner.
Tidak ada TTL policy.
Tidak ada memory budget.
Tidak ada tahu key mana yang critical.
Tidak ada yang berani flush/migrate/upgrade.
```

Redis yang awalnya mempercepat delivery bisa menjadi shared infrastructure yang rapuh.

---

## 17. Redis Safety Classification

Klasifikasikan Redis use case berdasarkan risiko.

### 17.1 Class A — Safe Volatile Cache

Data boleh hilang.

Contoh:

```text
product cache
config cache
rendered fragment cache
```

Redis down:

```text
fallback ke source of truth
```

Eviction:

```text
acceptable
```

### 17.2 Class B — Important Transient State

Data sementara, tetapi kehilangan data menyebabkan gangguan.

Contoh:

```text
session
rate limiter
workflow temporary lock
presence
```

Redis down:

```text
degraded behavior harus jelas
```

Eviction:

```text
biasanya tidak boleh sembarangan
```

### 17.3 Class C — Correctness-Critical Guard

Redis membantu menjaga correctness, tetapi sebaiknya bukan satu-satunya guard.

Contoh:

```text
idempotency payment
deduplication financial event
distributed lock for irreversible operation
quota enforcement regulatory action
```

Redis down:

```text
fail closed atau verify ke durable store
```

Eviction:

```text
tidak boleh
```

Durability:

```text
harus dipikirkan serius
```

### 17.4 Class D — Source of Truth Redis

Redis menjadi database utama.

Ini mungkin, tetapi harus diperlakukan sebagai keputusan arsitektur besar, bukan default.

Wajib jelas:

- persistence
- backup
- restore
- replication
- data loss tolerance
- memory scale
- migration path
- observability
- compliance

---

## 18. Redis Question-Driven Design

Sebelum memilih Redis, jawab 20 pertanyaan ini.

1. Apa use case tepatnya?
2. Apa source of truth?
3. Apakah data boleh hilang?
4. Apakah data boleh stale?
5. Apakah data butuh audit trail?
6. Berapa TTL?
7. Apa arti TTL expire?
8. Apakah key boleh di-evict?
9. Berapa cardinality maksimum?
10. Berapa ukuran value maksimum?
11. Apakah ada hot key?
12. Apakah ada big key?
13. Berapa QPS read/write?
14. Berapa latency budget?
15. Berapa command per request?
16. Apakah butuh atomic multi-step operation?
17. Apakah Redis Cluster akan dipakai?
18. Apa behavior saat Redis down?
19. Apa retry policy?
20. Bagaimana monitoring dan alerting?

Jika jawaban belum ada, Redis belum siap production.

---

## 19. Lab Environment untuk Seri Ini

Untuk mengikuti seri, kita akan memakai environment yang realistis tetapi ringan.

### 19.1 Tools

Rekomendasi:

```text
Java 21+
Maven atau Gradle
Docker
Docker Compose
Redis 8.x atau Redis 7.x jika environment belum support 8.x
redis-cli
Spring Boot 3.x
Lettuce
Jedis
Spring Data Redis
Testcontainers
```

### 19.2 Minimal Docker Compose

File:

```yaml
services:
  redis:
    image: redis:8
    container_name: redis-learning
    ports:
      - "6379:6379"
    command: ["redis-server", "--appendonly", "yes"]
```

Jika image `redis:8` belum tersedia di environment tertentu, gunakan versi stabil yang tersedia di registry lokal/perusahaan, misalnya `redis:7.4`, lalu sesuaikan fitur modern yang belum ada.

### 19.3 Cek Redis

```bash
docker compose up -d
redis-cli ping
```

Output:

```text
PONG
```

### 19.4 Java Dependency — Lettuce

Maven contoh:

```xml
<dependency>
  <groupId>io.lettuce</groupId>
  <artifactId>lettuce-core</artifactId>
  <version>${lettuce.version}</version>
</dependency>
```

### 19.5 Java Dependency — Jedis

```xml
<dependency>
  <groupId>redis.clients</groupId>
  <artifactId>jedis</artifactId>
  <version>${jedis.version}</version>
</dependency>
```

### 19.6 Spring Data Redis

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

Versi dependency akan mengikuti Spring Boot BOM atau dependency management project.

---

## 20. Mini Lab: Merasakan Redis sebagai Data Structure Server

Tujuan lab ini bukan menghafal command, tetapi merasakan bahwa Redis adalah typed data structure server.

### 20.1 String Counter

```redis
SET tenant:77:req:2026-06-20 0
INCR tenant:77:req:2026-06-20
INCR tenant:77:req:2026-06-20
GET tenant:77:req:2026-06-20
```

Ekspektasi:

```text
2
```

Mental model:

```text
Counter tidak perlu read-modify-write di Java.
Redis menyediakan atomic increment.
```

---

### 20.2 Hash untuk Object Ringan

```redis
HSET user:123 name "Alya" role "case-officer" status "active"
HGET user:123 role
HGETALL user:123
```

Mental model:

```text
Hash cocok untuk object flat dan partial update.
Tetapi bukan pengganti relational model lengkap.
```

---

### 20.3 Set untuk Membership

```redis
SADD tenant:77:active-users user:1 user:2 user:3
SISMEMBER tenant:77:active-users user:2
SCARD tenant:77:active-users
```

Mental model:

```text
Membership check tidak perlu list scan di aplikasi.
```

---

### 20.4 Sorted Set untuk Ranking atau Time Index

```redis
ZADD case:priority 100 case-1 50 case-2 200 case-3
ZRANGE case:priority 0 -1 WITHSCORES
ZREVRANGE case:priority 0 0 WITHSCORES
```

Mental model:

```text
Sorted Set adalah ordered index sederhana.
```

---

### 20.5 TTL

```redis
SET password-reset:token:abc user:123 EX 60
TTL password-reset:token:abc
GET password-reset:token:abc
```

Mental model:

```text
Redis dapat menghapus data berdasarkan waktu.
TTL adalah lifecycle contract.
```

---

## 21. Redis Thinking for Regulatory / Case Management Systems

Untuk sistem enforcement lifecycle, case management, atau regulatory workflow, Redis bisa sangat berguna tetapi harus ditempatkan dengan hati-hati.

### 21.1 Cocok

Redis cocok untuk:

- cache permission evaluation
- cache case summary read model
- rate limit API internal/eksternal
- idempotency guard dengan fallback durable
- deduplication window untuk inbound integration
- temporary workflow lock dengan fencing
- dashboard counters yang boleh approximate/stale
- user presence dan collaboration indicator
- short-lived task coordination

### 21.2 Hati-Hati

Redis harus hati-hati untuk:

- authoritative enforcement status
- audit log
- legal decision history
- irreversible action guard
- evidence chain
- SLA breach record
- cross-agency exchange record
- financial penalty calculation source

Untuk data regulatory, prinsipnya:

```text
Redis may accelerate decisions.
Redis should not silently become the legal record of decisions.
```

### 21.3 Contoh Boundary Baik

```text
PostgreSQL:
  authoritative case status
  audit events
  enforcement decision
  assignment history

Redis:
  cached case summary
  user permission cache
  idempotency window for command submission
  rate limit per agency/tenant
  short-lived edit lock with fencing token
```

---

## 22. Common Beginner Mistakes

### 22.1 Tidak Memberi TTL

```redis
SET cache:user:123 "..."
```

Masalah:

```text
Key hidup selamanya.
Memory naik terus.
Data bisa stale tanpa batas.
```

Lebih baik:

```redis
SET cache:user:123 "..." EX 300
```

---

### 22.2 Menggunakan KEYS di Production

```redis
KEYS user:*
```

Masalah:

```text
Bisa memblokir Redis pada keyspace besar.
```

Gunakan pola scanning yang aman, key registry, metrics, atau desain keyspace yang tidak butuh full scan di hot path.

---

### 22.3 Menyimpan Payload Terlalu Besar

Contoh:

```text
cache:report:{id} -> 5 MB JSON
```

Masalah:

- network cost
- memory cost
- latency spike
- client deserialization cost
- big key problem

---

### 22.4 Cache Invalidation Tanpa Desain

```text
Update DB berhasil.
Cache lama tidak dihapus.
User melihat data stale terlalu lama.
```

Cache invalidation harus punya policy:

- TTL only
- explicit delete
- versioned key
- write-through
- refresh-ahead
- event-driven invalidation

---

### 22.5 Redis Lock Tanpa Token

Buruk:

```redis
SETNX lock:case:123 true
DEL lock:case:123
```

Masalah:

Client A bisa menghapus lock milik Client B jika lease expired dan lock diambil ulang.

Lebih aman:

```text
SET lock value NX PX ttl
Delete only if stored value == my token
```

Biasanya menggunakan Lua untuk unlock aman.

---

### 22.6 Retry Tanpa Idempotency

Jika command timeout, belum tentu command gagal.

Contoh:

```text
INCR counter
client timeout sebelum menerima response
client retry
counter naik dua kali
```

Timeout bukan bukti operasi gagal.

---

### 22.7 Satu Redis untuk Semua Hal

Masalah:

```text
cache besar dapat meng-evict idempotency key
analytics counter mengganggu session
batch job scan mengganggu request path
```

Gunakan separation:

- logical database bukan isolasi kuat
- prefix saja bukan resource isolation
- deployment terpisah untuk critical workload sering lebih aman

---

## 23. Redis Maturity Model

### Level 0 — Command User

Ciri:

- tahu `GET`, `SET`, `DEL`
- memakai Redis sebagai cache sederhana
- belum memikirkan TTL/memory/failure

### Level 1 — Data Structure User

Ciri:

- tahu Hash, Set, Sorted Set, Stream
- memilih struktur sesuai problem
- mulai mengurangi logic di aplikasi

### Level 2 — Cache Designer

Ciri:

- paham cache-aside
- paham invalidation
- paham stampede
- paham hot key
- paham TTL jitter

### Level 3 — Correctness-Aware Redis Engineer

Ciri:

- paham idempotency
- paham lock lease
- paham Lua atomicity
- paham retry ambiguity
- paham stale/missing data semantics

### Level 4 — Production Redis Engineer

Ciri:

- paham memory planning
- paham persistence
- paham replication/failover
- paham cluster
- paham observability
- paham security
- punya runbook

### Level 5 — Architecture-Level Redis Designer

Ciri:

- tahu kapan tidak memakai Redis
- bisa memisahkan workload
- bisa membuat failure matrix
- bisa menilai correctness vs latency vs cost
- bisa mereview desain Redis lintas service
- bisa membangun Redis platform policy untuk organisasi

Seri ini bertujuan membawa kamu minimal ke Level 4, dengan pola pikir Level 5.

---

## 24. Roadmap Internal Seri

Kita akan bergerak dari mental model ke produksi:

```text
Orientation
  -> core execution model
  -> data structures
  -> TTL/eviction
  -> cache architecture
  -> rate limit/idempotency/lock
  -> Lua/functions
  -> Pub/Sub/Streams
  -> advanced structures
  -> persistence/replication/cluster
  -> memory/latency engineering
  -> Java clients
  -> transactions/security/observability
  -> operations/testing
  -> patterns/anti-patterns
  -> architecture lab
  -> final decision framework
```

Urutan ini sengaja dibuat agar kamu tidak jatuh ke pola:

```text
belajar command dulu
baru bingung production failure belakangan
```

Kita mulai dari contract dan mental model, baru masuk command.

---

## 25. Checklist Setelah Part 000

Setelah bagian ini, kamu seharusnya bisa menjelaskan:

- Redis bukan sekadar cache.
- Redis adalah in-memory data structure server.
- Redis berbeda dari SQL database, Kafka, RabbitMQ, dan local cache.
- Redis sangat cepat, tetapi tetap network dependency.
- Redis memory harus direncanakan.
- TTL adalah lifecycle contract.
- Expiration berbeda dari eviction.
- Persistence Redis punya trade-off.
- Replication Redis tidak otomatis berarti no data loss.
- Redis Cluster memengaruhi desain key.
- Redis failure harus dianggap normal.
- Java Redis usage membutuhkan perhatian pada connection, timeout, serializer, dan abstraction.
- Setiap key family harus punya owner, TTL, memory estimate, source of truth, dan failure behavior.

Jika poin-poin ini sudah masuk, kamu siap ke Part 001.

---

## 26. Latihan Berpikir

Ambil tiga use case dari sistemmu, lalu isi template ini.

### Use Case 1

```text
Use case:
Apakah Redis cocok:
Kenapa:
Source of truth:
TTL:
Boleh stale:
Boleh hilang:
Eviction aman:
Failure behavior:
Data structure Redis yang cocok:
Risiko utama:
```

### Use Case 2

```text
Use case:
Apakah Redis cocok:
Kenapa:
Source of truth:
TTL:
Boleh stale:
Boleh hilang:
Eviction aman:
Failure behavior:
Data structure Redis yang cocok:
Risiko utama:
```

### Use Case 3

```text
Use case:
Apakah Redis cocok:
Kenapa:
Source of truth:
TTL:
Boleh stale:
Boleh hilang:
Eviction aman:
Failure behavior:
Data structure Redis yang cocok:
Risiko utama:
```

Contoh jawaban singkat:

```text
Use case: cache case summary
Apakah Redis cocok: ya
Kenapa: read-heavy, source of truth ada di PostgreSQL
Source of truth: PostgreSQL case tables/read model
TTL: 2 minutes + jitter
Boleh stale: ya, maksimal 2 menit untuk non-critical dashboard
Boleh hilang: ya
Eviction aman: ya
Failure behavior: fallback DB/read model with circuit breaker
Data structure Redis yang cocok: String JSON atau Hash
Risiko utama: stampede saat Redis flush/failover
```

Contoh lain:

```text
Use case: authoritative case enforcement status
Apakah Redis cocok: tidak sebagai source of truth
Kenapa: butuh audit, durability, transition history, legal defensibility
Source of truth: relational DB + audit log
TTL: tidak relevan untuk source of truth
Boleh stale: tidak untuk command decision path
Boleh hilang: tidak
Eviction aman: tidak
Failure behavior: command harus baca durable store
Data structure Redis yang cocok: mungkin cache read-only summary, bukan authoritative state
Risiko utama: Redis menjadi shadow source of truth yang tidak defensible
```

---

## 27. Referensi Resmi dan Bacaan Lanjutan

Gunakan referensi ini sebagai anchor selama seri:

1. Redis Documentation — Data types  
   https://redis.io/docs/latest/develop/data-types/

2. Redis Documentation — Redis 8.0  
   https://redis.io/docs/latest/develop/whats-new/8-0/

3. Redis Documentation — Key eviction  
   https://redis.io/docs/latest/develop/reference/eviction/

4. Redis Documentation — Replication  
   https://redis.io/docs/latest/operate/oss_and_stack/management/replication/

5. Redis Documentation — Distributed locks  
   https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/

6. Redis Documentation — Lettuce Java guide  
   https://redis.io/docs/latest/develop/clients/lettuce/

7. Redis Documentation — Jedis Java guide  
   https://redis.io/docs/latest/develop/clients/jedis/

8. Spring Data Redis Reference  
   https://docs.spring.io/spring-data/redis/reference/

---

## 28. Ringkasan Bagian 000

Redis harus dipelajari sebagai sistem, bukan command list.

Mental model terpenting:

```text
Redis = memory-first typed keyspace with atomic commands over the network.
```

Redis kuat ketika:

- data butuh latency rendah
- data bisa transient
- data punya TTL
- data structure Redis cocok dengan problem
- source of truth jelas
- failure behavior jelas
- memory budget jelas

Redis berbahaya ketika:

- dipakai sebagai dumping ground
- tidak ada TTL
- tidak ada owner key
- dianggap selalu durable
- lock dianggap absolut
- retry dianggap aman
- eviction tidak dipahami
- Redis menjadi source of truth diam-diam

Kunci kedewasaan Redis:

```text
Design the contract before using the command.
```

---

## 29. Berikutnya

Bagian berikutnya:

```text
learn-redis-mastery-for-java-engineers-part-001.md
```

Judul:

```text
Redis Core Mental Model: Server, Keyspace, Command, Event Loop
```

Fokus berikutnya:

- Redis sebagai proses server
- command execution model
- kenapa Redis cepat
- single-threaded command execution secara konseptual
- atomicity per command
- blocking command
- network round trip
- latency vs throughput
- kenapa Redis bukan remote HashMap

---

## 30. Status Akhir Bagian

```text
Part 000 selesai.
Seri belum selesai.
Lanjut ke Part 001.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-001.md">Part 001 — Redis Core Mental Model: Server, Keyspace, Command, Event Loop ➡️</a>
</div>
