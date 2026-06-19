# learn-redis-mastery-for-java-engineers-part-007.md

# Part 007 — Sorted Sets: Ranking, Scheduling, Priority, Time Index

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin menggunakan Redis secara benar dalam sistem backend production-grade.  
> Fokus bagian ini: memahami Redis Sorted Set bukan sebagai “set yang kebetulan terurut”, tetapi sebagai primitive kuat untuk ranking, scheduling, priority, time index, scoring, delay queue, dan sliding-window computation.

---

## 0. Posisi Bagian Ini dalam Seri

Kita sudah membahas:

- Redis sebagai sistem, bukan sekadar cache.
- Execution model Redis.
- Keyspace dan type system.
- Strings.
- Hashes.
- Lists.
- Sets.

Sekarang kita masuk ke salah satu Redis data structure paling berguna untuk backend systems: **Sorted Set**, sering disebut **ZSET**.

Sorted Set adalah struktur data yang tampak sederhana:

```text
member -> score
```

Tetapi dari kombinasi itu, kita bisa membangun:

- leaderboard;
- ranking;
- priority queue;
- delay queue;
- scheduler;
- sliding-window rate limiter;
- time index;
- recency index;
- top-N query;
- expiring logical index;
- approximate workflow backlog;
- matching queue;
- fairness ordering;
- scoring system;
- risk queue;
- SLA breach detector.

Kalau Redis Hash terasa seperti object-like data, Redis Set terasa seperti membership, maka Redis Sorted Set terasa seperti:

> “membership + ordering + numeric priority”.

Ini membuat Sorted Set sangat cocok untuk banyak sistem backend yang perlu menjawab pertanyaan seperti:

```text
Siapa top 10 user berdasarkan score?
Task mana yang waktunya sudah jatuh tempo?
Request mana yang harus diproses dulu?
Berapa event terjadi dalam 60 detik terakhir?
User ini ranking ke berapa?
Item apa yang paling baru?
Item apa yang punya risiko tertinggi?
```

---

## 1. Mental Model Utama

Sorted Set adalah Redis collection yang berisi **unique member**, masing-masing memiliki **floating point score**.

Secara konseptual:

```text
ZSET key = {
  memberA -> 10.5,
  memberB -> 42.0,
  memberC -> 42.0,
  memberD -> 99.1
}
```

Redis menyimpan member secara unik seperti Set, tetapi setiap member memiliki score yang menentukan urutan.

### 1.1 Set vs Sorted Set

Redis Set:

```text
online-users = {u1, u2, u3}
```

Pertanyaan yang natural:

```text
Apakah u1 online?
Berapa jumlah user online?
Tambahkan user.
Hapus user.
```

Redis Sorted Set:

```text
player-score = {
  u1 -> 1000,
  u2 -> 1500,
  u3 -> 900
}
```

Pertanyaan yang natural:

```text
Siapa top 10?
Ranking u2 berapa?
User mana dengan score antara 900 dan 1200?
Naikkan score u1.
Hapus user yang score-nya terlalu rendah.
```

### 1.2 Member Harus Unik

Dalam Sorted Set, member tidak bisa duplikat.

Kalau kita menjalankan:

```redis
ZADD leaderboard 100 alice
ZADD leaderboard 200 alice
```

Hasilnya bukan dua entry `alice`, melainkan entry `alice` diperbarui menjadi score `200`.

Ini sangat penting.

Sorted Set cocok untuk:

```text
Satu entity punya satu score aktif dalam satu index.
```

Contoh cocok:

```text
userId -> totalScore
taskId -> dueAtEpochMillis
caseId -> riskScore
sessionId -> lastSeenEpochSeconds
jobId -> priority
```

Tidak cocok kalau kita butuh menyimpan beberapa event historis untuk member yang sama tanpa membuat member unik sendiri.

Contoh problem:

```text
userId punya banyak login events.
```

Kalau member hanya `userId`, event lama akan tertimpa.

Solusi:

```text
member = loginEventId
score  = loginTimestamp
```

atau:

```text
member = timestamp:userId:randomSuffix
score  = timestamp
```

---

## 2. Score: Angka yang Menjadi Semantik Sistem

Sorted Set score adalah angka floating point double precision.

Tapi secara desain aplikasi, score bisa bermakna banyak hal:

| Score Meaning | Example |
|---|---|
| game score | leaderboard |
| timestamp | time index, delay queue |
| priority | task scheduling |
| risk score | compliance queue |
| deadline | SLA breach detection |
| price | marketplace filtering |
| distance proxy | ranking heuristic |
| freshness | feed ordering |
| weight | recommendation candidate |

Hal terpenting:

> Score bukan sekadar angka. Score adalah ordering contract.

Begitu kita memilih score, kita sedang memilih cara Redis mengurutkan entity.

### 2.1 Score sebagai Timestamp

Salah satu pola paling umum:

```text
score = epoch millis
member = jobId
```

Contoh:

```redis
ZADD delayed-jobs 1730000000000 job:123
```

Artinya:

```text
job:123 boleh diproses ketika currentTimeMillis >= 1730000000000
```

Untuk mengambil job yang sudah due:

```redis
ZRANGEBYSCORE delayed-jobs -inf 1730000000000 LIMIT 0 10
```

atau dengan command modern:

```redis
ZRANGE delayed-jobs -inf 1730000000000 BYSCORE LIMIT 0 10
```

Mental model:

```text
Sorted Set = mini time index
```

### 2.2 Score sebagai Priority

Contoh:

```text
lower score = higher priority
```

```redis
ZADD priority-queue 1 urgent-task
ZADD priority-queue 10 normal-task
ZADD priority-queue 100 low-task
```

Ambil task prioritas tertinggi:

```redis
ZRANGE priority-queue 0 0
```

Atau pop atomically:

```redis
ZPOPMIN priority-queue 1
```

### 2.3 Score sebagai Risk

Untuk sistem enforcement/regulatory/case management, score bisa menjadi risk score:

```text
caseId -> riskScore
```

```redis
ZADD case-risk-index 91.5 case:8831
ZADD case-risk-index 73.0 case:9912
ZADD case-risk-index 12.4 case:1822
```

Ambil case risiko tertinggi:

```redis
ZREVRANGE case-risk-index 0 9 WITHSCORES
```

Atau modern style:

```redis
ZRANGE case-risk-index 0 9 REV WITHSCORES
```

Namun penting:

> Redis Sorted Set boleh dipakai sebagai operational priority index, tetapi bukan pengganti audit trail atau source of truth untuk keputusan enforcement.

Kalau risk score menentukan tindakan formal, source of truth-nya harus tetap di sistem yang durable, auditable, dan explainable.

Redis dapat menjadi:

```text
fast access index / transient ranking / scheduling accelerator
```

bukan:

```text
sole authoritative legal record
```

---

## 3. Command Dasar Sorted Set

Kita mulai dari command inti.

### 3.1 `ZADD`

Menambahkan atau memperbarui member.

```redis
ZADD leaderboard 100 alice
ZADD leaderboard 200 bob
ZADD leaderboard 150 carol
```

Hasil:

```text
alice -> 100
carol -> 150
bob   -> 200
```

Jika member sudah ada:

```redis
ZADD leaderboard 250 alice
```

Maka score `alice` berubah menjadi `250`.

#### Opsi `ZADD`

Redis `ZADD` memiliki beberapa opsi penting:

```redis
ZADD key [NX|XX] [GT|LT] [CH] [INCR] score member
```

Makna umum:

| Option | Meaning |
|---|---|
| `NX` | hanya tambah jika member belum ada |
| `XX` | hanya update jika member sudah ada |
| `GT` | update hanya jika score baru lebih besar |
| `LT` | update hanya jika score baru lebih kecil |
| `CH` | return count changed, bukan hanya inserted |
| `INCR` | increment score seperti `ZINCRBY` |

Contoh: hanya insert jika belum ada.

```redis
ZADD leaderboard NX 100 alice
```

Contoh: hanya update jika score lebih tinggi.

```redis
ZADD leaderboard GT 500 alice
```

Ini berguna untuk leaderboard high score:

```text
Jangan turunkan high score user jika submit score baru lebih rendah.
```

### 3.2 `ZRANGE`

Mengambil member berdasarkan rank.

```redis
ZRANGE leaderboard 0 2 WITHSCORES
```

Default urutan ascending score.

Jika data:

```text
alice -> 100
carol -> 150
bob   -> 200
```

Maka hasil:

```text
alice 100
carol 150
bob   200
```

Untuk descending:

```redis
ZRANGE leaderboard 0 2 REV WITHSCORES
```

Hasil:

```text
bob   200
carol 150
alice 100
```

### 3.3 `ZRANK` dan `ZREVRANK`

Ranking ascending:

```redis
ZRANK leaderboard alice
```

Ranking descending:

```redis
ZREVRANK leaderboard alice
```

Perhatikan rank Redis dimulai dari `0`.

Kalau ingin ranking manusia:

```text
humanRank = redisRank + 1
```

### 3.4 `ZSCORE`

Mengambil score member.

```redis
ZSCORE leaderboard alice
```

### 3.5 `ZINCRBY`

Menambah score.

```redis
ZINCRBY leaderboard 10 alice
```

Jika `alice` sebelumnya `100`, menjadi `110`.

Cocok untuk:

- incremental score;
- engagement score;
- leaderboard;
- priority adjustment;
- failure count ranking.

### 3.6 `ZREM`

Menghapus member.

```redis
ZREM leaderboard alice
```

### 3.7 `ZCARD`

Menghitung jumlah member.

```redis
ZCARD leaderboard
```

### 3.8 `ZCOUNT`

Menghitung jumlah member dalam score range.

```redis
ZCOUNT leaderboard 100 200
```

### 3.9 `ZRANGEBYSCORE` / `ZRANGE ... BYSCORE`

Mengambil member berdasarkan score range.

Legacy style:

```redis
ZRANGEBYSCORE delayed-jobs -inf 1730000000000 LIMIT 0 10
```

Modern style:

```redis
ZRANGE delayed-jobs -inf 1730000000000 BYSCORE LIMIT 0 10
```

### 3.10 `ZPOPMIN` dan `ZPOPMAX`

Pop member dengan score paling kecil atau paling besar secara atomic.

```redis
ZPOPMIN priority-queue 1
ZPOPMAX leaderboard 10
```

`ZPOPMIN` sangat berguna untuk priority queue sederhana.

### 3.11 Blocking Pop: `BZPOPMIN`, `BZPOPMAX`

Blocking pop menunggu sampai ada item.

```redis
BZPOPMIN priority-queue 5
```

Tunggu maksimal 5 detik.

Ini terlihat menarik untuk worker queue, tapi harus hati-hati:

- blocking command perlu connection terpisah;
- tidak cocok dicampur dengan request-response Redis traffic biasa;
- delay queue berbasis due timestamp tidak bisa langsung memakai `BZPOPMIN` secara sempurna karena item paling kecil mungkin belum due.

---

## 4. Ordering Rules dan Tie-Breaking

Sorted Set mengurutkan berdasarkan:

```text
1. score ascending
2. jika score sama, member lexicographical order
```

Contoh:

```redis
ZADD z 10 bob
ZADD z 10 alice
ZADD z 10 carol
ZRANGE z 0 -1
```

Hasil konseptual:

```text
alice
bob
carol
```

Karena score sama, Redis mengurutkan member secara lexicographical.

### 4.1 Kenapa Tie-Breaking Penting?

Bayangkan priority queue:

```text
score = priority
```

Jika banyak task punya priority sama, urutannya bisa mengikuti member lexicographic, bukan FIFO.

Kalau member adalah:

```text
task:9
task:10
task:100
```

Lexicographic ordering tidak sama dengan numeric ordering.

Maka desain perlu eksplisit.

### 4.2 Membuat Stable Ordering dengan Composite Score

Untuk queue, kita bisa encode waktu ke score.

Contoh:

```text
score = dueAtEpochMillis
```

Jika due sama, tie masih lexicographic.

Bisa gunakan member yang mengandung sortable sequence:

```text
member = 000000001234:taskId
```

Atau gunakan score yang menggabungkan priority dan timestamp secara hati-hati:

```text
score = priorityWeight + timestampFraction
```

Namun composite score harus hati-hati karena Redis score adalah double precision. Jangan sembarang encode integer besar + fraction jika presisi penting.

### 4.3 Jangan Asumsikan FIFO untuk Score Sama

Anti-pattern:

```text
Semua task score = 1, lalu berharap Redis mengambil sesuai insertion order.
```

Redis Sorted Set tidak menjamin insertion order untuk score sama.

Kalau butuh FIFO, gunakan List atau Stream.

Kalau butuh priority + FIFO, desain explicit:

```text
score = priority bucket + monotonic sequence
```

atau gunakan dua struktur:

```text
ZSET untuk priority index
HASH untuk payload/status
```

---

## 5. Use Case 1: Leaderboard

Leaderboard adalah contoh klasik Sorted Set.

### 5.1 Basic Leaderboard

```redis
ZADD game:leaderboard 100 alice
ZADD game:leaderboard 250 bob
ZADD game:leaderboard 175 carol
```

Top 3:

```redis
ZRANGE game:leaderboard 0 2 REV WITHSCORES
```

Ranking `alice` descending:

```redis
ZREVRANK game:leaderboard alice
```

Score `alice`:

```redis
ZSCORE game:leaderboard alice
```

Tambah score:

```redis
ZINCRBY game:leaderboard 20 alice
```

### 5.2 High Score Only

Jika score baru hanya boleh mengganti jika lebih tinggi:

```redis
ZADD game:leaderboard GT 300 alice
```

Jika current score `alice` adalah `350`, update ke `300` tidak dilakukan.

### 5.3 Leaderboard Periode

Jangan gunakan satu leaderboard abadi untuk semua kebutuhan.

Gunakan key berdasarkan periode:

```text
game:{gameId}:leaderboard:daily:2026-06-20
game:{gameId}:leaderboard:weekly:2026-W25
game:{gameId}:leaderboard:monthly:2026-06
game:{gameId}:leaderboard:alltime
```

Periode leaderboard sebaiknya punya TTL:

```redis
EXPIRE game:chess:leaderboard:daily:2026-06-20 2592000
```

Misal simpan daily leaderboard 30 hari.

### 5.4 Pagination Leaderboard

Ambil page 1 size 20:

```redis
ZRANGE game:leaderboard 0 19 REV WITHSCORES
```

Page 2:

```redis
ZRANGE game:leaderboard 20 39 REV WITHSCORES
```

Masalah:

> Offset pagination bisa menjadi tidak stabil jika score berubah saat user paging.

Untuk leaderboard real-time biasanya acceptable. Untuk reporting formal, snapshot harus dibuat ke storage lain.

### 5.5 Around-Me Ranking

Misal rank user:

```redis
ZREVRANK game:leaderboard alice
```

Jika rank = 42, ambil sekitar user:

```redis
ZRANGE game:leaderboard 37 47 REV WITHSCORES
```

Di Java:

```java
long rank = redis.zrevrank("game:leaderboard", "alice");
long start = Math.max(rank - 5, 0);
long end = rank + 5;
```

### 5.6 Leaderboard Failure Modes

| Failure Mode | Penyebab | Mitigasi |
|---|---|---|
| Memory growth | leaderboard tanpa TTL/periode | periodized keys + TTL |
| Wrong rank | ascending vs descending salah | standardize rank convention |
| Score overwritten | member tidak unik | desain member identity jelas |
| Precision issue | score terlalu besar/komposit | gunakan integer-safe timestamp/sequence |
| Audit mismatch | Redis jadi source of truth | persist authoritative score elsewhere |
| Hot key | semua update ke satu leaderboard | shard by game/region/period atau use local buffering |

---

## 6. Use Case 2: Time Index

Sorted Set sangat cocok sebagai index berbasis waktu.

### 6.1 Last Seen Index

```text
score = lastSeenEpochSeconds
member = userId
```

```redis
ZADD users:last-seen 1781960000 user:123
```

User aktif dalam 5 menit terakhir:

```redis
ZRANGE users:last-seen 1781959700 +inf BYSCORE
```

User inactive sebelum timestamp tertentu:

```redis
ZRANGE users:last-seen -inf 1781900000 BYSCORE LIMIT 0 1000
```

Hapus user yang terlalu lama inactive:

```redis
ZREMRANGEBYSCORE users:last-seen -inf 1781900000
```

### 6.2 Case Deadline Index

Untuk regulatory/case-management workflow:

```text
score = deadlineEpochMillis
member = caseId
```

```redis
ZADD case:deadline-index 1782000000000 case:7832
```

Ambil case yang due dalam 10 menit:

```redis
ZRANGE case:deadline-index -inf 1781960600000 BYSCORE LIMIT 0 100
```

Namun ingat:

```text
Redis Sorted Set = operational index
Database/workflow engine = source of truth
```

Redis index bisa digunakan untuk mempercepat scheduler, tapi tiap case tetap harus divalidasi ulang ke source of truth sebelum tindakan formal.

### 6.3 Cleanup Index

Sorted Set sering digunakan untuk cleanup.

Contoh idempotency metadata:

```text
score = createdAtEpochMillis
member = idempotencyKey
```

Cleanup:

```redis
ZRANGEBYSCORE idem:index -inf <olderThan> LIMIT 0 1000
ZREMRANGEBYSCORE idem:index -inf <olderThan>
```

Tetapi jika metadata berada di key lain, perlu dua langkah:

1. Ambil member lama dari ZSET.
2. Delete key detail terkait.
3. Remove dari ZSET.

Ini bukan atomic jika dilakukan client-side. Untuk cleanup best effort biasanya cukup. Untuk correctness tinggi, gunakan Lua atau Redis Function.

---

## 7. Use Case 3: Delay Queue

Delay queue adalah queue di mana item baru boleh diproses setelah waktu tertentu.

### 7.1 Model

```text
key    = jobs:delayed
score  = dueAtEpochMillis
member = jobId
```

Add job:

```redis
ZADD jobs:delayed 1781960000000 job:123
```

Worker poll:

```redis
ZRANGE jobs:delayed -inf 1781960000000 BYSCORE LIMIT 0 1
```

Jika ada job due, worker mencoba claim.

### 7.2 Naive Implementation Problem

Naive flow:

```text
1. ZRANGE due job
2. process job
3. ZREM job
```

Masalah:

Jika dua worker melakukan `ZRANGE` bersamaan, keduanya bisa melihat job yang sama.

Maka perlu claim atomic.

### 7.3 Safer Pattern: Fetch + Remove Atomically dengan Lua

Lua script konseptual:

```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local jobs = redis.call('ZRANGE', key, '-inf', now, 'BYSCORE', 'LIMIT', 0, limit)

for i, job in ipairs(jobs) do
  redis.call('ZREM', key, job)
end

return jobs
```

Pemakaian:

```text
claim due jobs atomically
```

Kenapa atomic?

Redis menjalankan script sebagai satu unit tanpa interleaving command lain di tengah.

### 7.4 Better Pattern: Move to Processing ZSET

Untuk reliability, jangan langsung remove lalu proses tanpa tracking.

Gunakan dua ZSET:

```text
jobs:delayed      -> due jobs
jobs:processing   -> claimed jobs with claimDeadline
```

Flow:

```text
1. Atomically move due job dari delayed ke processing.
2. Worker proses job.
3. Jika sukses, remove dari processing.
4. Reaper mengembalikan expired processing job ke delayed atau dead-letter.
```

Lua claim:

```lua
local delayed = KEYS[1]
local processing = KEYS[2]
local now = tonumber(ARGV[1])
local visibilityTimeoutMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

local jobs = redis.call('ZRANGE', delayed, '-inf', now, 'BYSCORE', 'LIMIT', 0, limit)

for i, job in ipairs(jobs) do
  redis.call('ZREM', delayed, job)
  redis.call('ZADD', processing, now + visibilityTimeoutMs, job)
end

return jobs
```

Ack:

```redis
ZREM jobs:processing job:123
```

Requeue expired:

```text
processing score <= now berarti claim expired
```

### 7.5 Delay Queue Caveat

Redis delay queue bisa baik untuk:

- lightweight scheduling;
- retry-after small scale;
- internal jobs;
- near-real-time task execution;
- simple deferred workflow.

Tidak cocok untuk:

- high durability business queue;
- audit-critical event processing;
- exactly-once processing;
- long retention;
- massive backlog;
- complex routing;
- consumer group semantics yang kuat.

Untuk hal itu, gunakan message broker atau workflow engine yang sesuai.

Karena seri Kafka/RabbitMQ sudah dibahas, cukup ingat perbedaan Redis-specific:

```text
Redis ZSET gives fast ordering and atomic primitives.
Kafka/RabbitMQ give broker-level delivery semantics, retention/routing, and operational queueing model.
```

---

## 8. Use Case 4: Priority Queue

### 8.1 Simple Priority Queue

```text
score = priority
member = taskId
```

```redis
ZADD tasks:priority 10 task:normal
ZADD tasks:priority 1 task:urgent
ZADD tasks:priority 100 task:low
```

Ambil prioritas tertinggi jika lower score = higher priority:

```redis
ZPOPMIN tasks:priority 1
```

### 8.2 Priority Queue dengan Payload

Jangan simpan payload besar sebagai member.

Bad:

```redis
ZADD tasks:priority 1 '{"id":"task:1","payload":"large..."}'
```

Better:

```text
ZSET: tasks:priority
  member = taskId
  score  = priority

HASH/STRING: task:{taskId}
  payload/status metadata
```

Contoh:

```redis
HSET task:123 type email target user:77 payloadKey payload:123
ZADD tasks:priority 1 task:123
```

Ambil:

```redis
ZPOPMIN tasks:priority 1
HGETALL task:123
```

### 8.3 Priority Inversion

Jika task priority rendah terus-menerus kalah dari priority tinggi, terjadi starvation.

Mitigasi:

- aging: turunkan score seiring waktu;
- bucketed priority;
- fair scheduling per tenant;
- quota per priority class;
- multiple queues;
- weighted round robin di application layer.

Redis tidak menyelesaikan fairness otomatis. Itu tanggung jawab desain sistem.

### 8.4 Multi-Tenant Priority Queue

Bad:

```text
one global queue for all tenants
```

Tenant besar bisa mendominasi.

Better:

```text
tenant:{tenantId}:tasks:priority
```

Atau:

```text
queue:priority:{tenantId}
```

Dengan scheduler yang mengambil secara fair across tenants.

Redis ZSET membantu ordering di satu queue, tetapi fairness antar queue harus dirancang.

---

## 9. Use Case 5: Sliding Window Rate Limiter

Sorted Set sering dipakai untuk sliding-window log.

### 9.1 Mental Model

Untuk setiap request:

```text
score = current timestamp millis
member = unique request id
```

Key:

```text
rate:{tenantId}:{apiKey}:{endpoint}
```

Flow:

```text
1. Hapus request yang lebih tua dari window.
2. Hitung jumlah request tersisa.
3. Jika count >= limit, reject.
4. Jika belum, add request baru.
5. Set TTL key.
```

### 9.2 Command Sequence

Misal limit 100 request per 60 detik.

```redis
ZREMRANGEBYSCORE rate:user:123:login -inf 1781960000000
ZCARD rate:user:123:login
ZADD rate:user:123:login 1781960060000 req:abc
EXPIRE rate:user:123:login 120
```

Masalah:

> Sequence ini tidak atomic jika dilakukan dari client.

Gunakan Lua untuk correctness.

### 9.3 Lua Sliding Window Limiter

```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttlSeconds = tonumber(ARGV[5])

local min = now - window

redis.call('ZREMRANGEBYSCORE', key, '-inf', min)

local count = redis.call('ZCARD', key)

if count >= limit then
  return {0, count}
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttlSeconds)

return {1, count + 1}
```

Return:

```text
{allowed, currentCount}
```

### 9.4 Unique Member Requirement

Jika member tidak unik, request bisa overwrite.

Bad:

```text
member = userId
```

Good:

```text
member = nowMillis + ':' + randomUuid
```

Atau:

```text
member = requestId
```

### 9.5 Cost

Sliding-window log menyimpan satu member per request dalam window.

Jika limit tinggi:

```text
1000 req/sec/user * 60 sec = 60,000 members per user key
```

Itu bisa mahal.

Alternatif:

- fixed window counter dengan String;
- sliding window counter bucketed;
- token bucket;
- approximate limiter;
- local pre-limit + Redis global limit.

Sorted Set limiter akurat, tapi tidak selalu murah.

---

## 10. Sorted Set sebagai Secondary Index

Redis tidak punya query planner relational seperti SQL. Tapi Sorted Set bisa menjadi manual secondary index.

Contoh:

```text
case:{caseId}        -> Hash detail
case:deadline:index  -> ZSET caseId by deadline
case:risk:index      -> ZSET caseId by risk score
case:created:index   -> ZSET caseId by createdAt
```

Query:

```redis
ZRANGE case:deadline:index -inf 1782000000000 BYSCORE LIMIT 0 100
```

Lalu hydrate detail:

```redis
HMGET case:7832 status owner risk deadline
```

atau pipeline multiple `HGETALL`.

### 10.1 Index Consistency Problem

Jika detail update berhasil tetapi index update gagal:

```text
case hash says deadline = T2
index still points to T1
```

Maka terjadi index drift.

Mitigasi:

- update via Lua jika semua data ada di Redis dan satu slot;
- gunakan source of truth DB lalu rebuild Redis index;
- reconciliation job;
- version field;
- validate hydrated object before action;
- design Redis index as advisory, not authoritative.

### 10.2 Secondary Index Pattern

Write path:

```text
1. Save authoritative data to DB.
2. Publish/update operational Redis index.
3. If Redis update fails, schedule repair/rebuild.
```

Read path:

```text
1. Query Redis index for candidates.
2. Hydrate from Redis cache or DB.
3. Validate status/deadline/risk still matches.
4. Act only if source-of-truth confirms.
```

This is especially important in compliance-heavy systems.

---

## 11. Score Precision

Redis score is double precision floating point.

This matters.

### 11.1 Safe Integer Range

Double precision can exactly represent integers only up to a certain range. Epoch milliseconds today are around `1.7e12`, which is still exactly representable as integer in double for typical Redis timestamp usage.

Epoch nanoseconds are around `1.7e18`, which is not safe for exact integer semantics.

Good:

```text
score = epoch milliseconds
score = epoch seconds
score = small integer priority
score = score points
```

Dangerous:

```text
score = epoch nanoseconds
score = 64-bit ID
score = composite huge integer
score = money amount requiring exact decimals
```

### 11.2 Money and Legal Scores

Do not store exact financial amount as Redis score if exact decimal arithmetic matters.

Redis score is for ordering and approximate numeric ranking, not financial ledger precision.

Use:

```text
DB decimal field = authoritative value
Redis score = derived ordering value
```

### 11.3 Composite Score Caution

Some engineers encode:

```text
score = priority * 1_000_000_000_000 + timestamp
```

This may exceed safe precision depending on values.

Better:

- keep score simple;
- encode tie-breaker in member;
- use multiple queues;
- use Stream/List when ordering contract is FIFO;
- use DB for complex ordering.

---

## 12. Large Range Operations and Cost

Sorted Set commands are fast, but not magical.

Typical complexity model:

```text
ZADD: O(log N)
ZREM: O(log N)
ZRANGE small range: O(log N + M)
ZCOUNT: O(log N)
ZCARD: O(1)
ZREMRANGEBYSCORE: O(log N + M)
```

`M` is number of returned/removed elements.

The dangerous part is not finding a range. The dangerous part is returning/removing too many elements.

Bad:

```redis
ZRANGE huge-index 0 -1 WITHSCORES
```

Bad:

```redis
ZREMRANGEBYSCORE huge-index -inf +inf
```

Better:

```redis
ZRANGE huge-index -inf 1781960000000 BYSCORE LIMIT 0 1000
```

Process in batches.

### 12.1 Never Use Sorted Set as Infinite Dump

If a ZSET grows forever, eventually:

- memory explodes;
- range operations become expensive;
- backup/restart slower;
- rebalancing harder;
- hot key risk increases.

Every Sorted Set should have a lifecycle:

```text
What adds members?
What removes members?
What is expected cardinality?
What is max cardinality?
Is there TTL?
Is there trimming?
Is there periodization?
What happens if cleanup fails?
```

---

## 13. Pagination Pitfalls

### 13.1 Offset Pagination

```redis
ZRANGE leaderboard 10000 10019 REV WITHSCORES
```

This can work, but there are issues:

- deep pagination can be expensive;
- result can shift if scores change;
- user may see duplicates/missing entries across pages;
- large offsets are not ideal for user-facing infinite scroll.

### 13.2 Cursor-Like Pagination by Score

For descending order, use previous lowest score as cursor.

Example:

```redis
ZRANGE leaderboard (lastScore -inf BYSCORE REV LIMIT 0 20 WITHSCORES
```

Syntax details can be tricky, but conceptually:

```text
next page = items with score < lastSeenScore
```

Problem:

If many members have same score, score-only cursor is insufficient.

Need tie-breaker.

### 13.3 Member Tie-Breaker

To implement precise stable pagination:

- use deterministic member ordering;
- include unique sortable component;
- or accept approximate pagination;
- or materialize snapshot elsewhere.

For administrative tools and dashboards, approximate real-time pagination may be fine.

For legally material records, use DB query with stable snapshot.

---

## 14. Java Integration Mental Model

In Java, Sorted Set usage typically appears through:

- Lettuce;
- Jedis;
- Spring Data Redis `ZSetOperations`;
- reactive Redis access;
- custom Lua scripts.

The key design issue is not the API. It is the boundary:

```text
What is the member string?
What is the score?
What is the key schema?
What is the lifecycle?
What is atomic?
What is allowed to be stale?
```

### 14.1 Java Domain Model Example

```java
public record LeaderboardEntry(
    String userId,
    double score,
    long rank
) {}
```

But be careful with `double`.

For timestamp score, model it as `long` in domain code and convert only at Redis boundary.

```java
public record ScheduledJob(
    String jobId,
    Instant dueAt
) {}
```

Redis boundary:

```java
double score = dueAt.toEpochMilli();
String member = jobId;
```

### 14.2 Key Builder

Do not scatter string concatenation everywhere.

Bad:

```java
String key = "leaderboard:" + gameId + ":" + period;
```

Repeated in many services.

Better:

```java
public final class RedisKeys {
    public static String gameLeaderboard(String gameId, String period) {
        return "game:%s:leaderboard:%s".formatted(gameId, period);
    }

    public static String delayedJobs(String queueName) {
        return "jobs:%s:delayed".formatted(queueName);
    }

    private RedisKeys() {}
}
```

For Redis Cluster, key builder should include hash tag intentionally when multi-key atomic scripts need same slot:

```java
public static String delayedJobs(String queueName) {
    return "jobs:{%s}:delayed".formatted(queueName);
}

public static String processingJobs(String queueName) {
    return "jobs:{%s}:processing".formatted(queueName);
}
```

This ensures both keys hash to the same slot because `{queueName}` is the hash tag.

### 14.3 Spring Data Redis Example Concept

Spring Data Redis provides ZSet operations conceptually like:

```java
redisTemplate.opsForZSet().add(key, member, score);
redisTemplate.opsForZSet().reverseRangeWithScores(key, 0, 9);
redisTemplate.opsForZSet().rank(key, member);
redisTemplate.opsForZSet().remove(key, member);
```

Design caution:

> Spring abstraction makes Redis easy to call, but it does not make Redis semantics safe.

You still need to reason about:

- atomicity;
- TTL;
- score precision;
- payload location;
- key cardinality;
- cluster slots;
- failure behavior.

---

## 15. Pattern: ZSET Index + HASH Payload

This is one of the most important Redis design patterns.

### 15.1 Structure

```text
ZSET queue:priority
  task:123 -> 10
  task:456 -> 20

HASH task:123
  type=email
  status=pending
  createdAt=...
  payloadRef=...

HASH task:456
  type=report
  status=pending
  createdAt=...
  payloadRef=...
```

### 15.2 Why Not Store Payload in ZSET Member?

Because member should be:

- small;
- stable;
- unique;
- easy to compare;
- easy to remove;
- not mutable.

Large payload as member causes:

- memory bloat;
- slow network transfer;
- difficult update;
- duplicate payload across indexes;
- awkward parsing;
- bad observability.

### 15.3 Multiple Indexes

Same task can be indexed by priority and deadline:

```text
task:priority:index
  task:123 -> priorityScore

task:deadline:index
  task:123 -> dueAtEpochMillis
```

But now you have index consistency problem.

You need clear write path.

---

## 16. Pattern: ZSET as Scheduler Wheel

For scheduled tasks:

```text
scheduler:{name}:due
```

Member:

```text
jobId
```

Score:

```text
dueAtEpochMillis
```

Worker loop:

```text
while running:
  now = currentTimeMillis
  jobs = claimDueJobs(now, limit)
  for job in jobs:
    process(job)
  sleep(short interval)
```

### 16.1 Poll Interval

If poll interval is 1 second, task may execute up to ~1 second late.

If poll interval is 10 ms, Redis load increases.

Choose based on SLO.

```text
Execution lateness tolerance determines polling pressure.
```

### 16.2 Clock Source

If multiple worker nodes use local clocks, skew can matter.

Options:

- use NTP disciplined clocks;
- use Redis server time via `TIME` command in Lua/Function;
- tolerate small skew;
- avoid using Redis scheduler for ultra-precise timing.

For most backend systems, millisecond-perfect scheduling is unnecessary. But SLA or compliance deadlines need explicit tolerance.

---

## 17. Pattern: ZSET for Expiring Membership

Set does not store per-member TTL. Sorted Set can simulate it.

Example: online users with expiry.

```text
score = expiresAtEpochMillis
member = userId
```

On heartbeat:

```redis
ZADD online-users 1781960600000 user:123
```

Active users:

```redis
ZRANGE online-users 1781960000000 +inf BYSCORE
```

Cleanup expired:

```redis
ZREMRANGEBYSCORE online-users -inf 1781959999999
```

This is useful when you need:

```text
membership + per-member expiry
```

Redis Set alone cannot do this.

---

## 18. Pattern: ZSET for Retry Backoff

For failed jobs/events:

```text
score = nextRetryAtEpochMillis
member = jobId
```

When processing fails:

```text
attempt = attempt + 1
backoff = calculateBackoff(attempt)
nextRetryAt = now + backoff
ZADD retry:index nextRetryAt jobId
```

Backoff examples:

```text
1st failure: 10 seconds
2nd failure: 1 minute
3rd failure: 5 minutes
4th failure: 30 minutes
then dead-letter
```

Metadata in Hash:

```text
job:{id}
  attempts = 3
  lastError = ...
  nextRetryAt = ...
  status = retry_pending
```

Important:

> Retry systems need dead-letter strategy. Without dead-letter, Redis becomes a graveyard of impossible jobs.

---

## 19. Pattern: ZSET for SLA Breach Detection

For case/workflow systems:

```text
score = breachAtEpochMillis
member = caseId
```

Key:

```text
case:sla:breach-index
```

Scheduler:

```redis
ZRANGE case:sla:breach-index -inf now BYSCORE LIMIT 0 100
```

For each candidate:

```text
1. Load case from source of truth.
2. Verify status still open.
3. Verify SLA actually breached.
4. Trigger escalation.
5. Remove/update Redis index.
```

Why verify?

Because Redis index may be stale.

Cases may have been resolved but Redis update failed. If you escalate solely based on Redis index, you may create false escalations.

For regulatory defensibility:

```text
Redis can find candidates.
The authoritative case system decides.
```

---

## 20. Cluster Considerations

Sorted Set itself is a single key. Commands on one ZSET are cluster-safe because one key maps to one slot.

But multi-key patterns are constrained.

### 20.1 Single ZSET

Safe:

```redis
ZADD leaderboard 100 alice
ZRANGE leaderboard 0 10
```

### 20.2 ZSET + Processing ZSET

Delay queue pattern may use two keys:

```text
jobs:email:delayed
jobs:email:processing
```

Lua script moving member between these keys requires both keys in same hash slot in Redis Cluster.

Use hash tags:

```text
jobs:{email}:delayed
jobs:{email}:processing
```

Both hash based on `email`.

### 20.3 Multi-Tenant Keys

For tenant isolation:

```text
tenant:{tenantId}:case:deadline-index
```

If scripts touch multiple keys for same tenant, use same hash tag:

```text
tenant:{t123}:case:deadline-index
tenant:{t123}:case:risk-index
tenant:{t123}:case:detail:case789
```

But be careful: putting too many keys for huge tenant into one slot can create hot slot.

Cluster key design is a balancing act:

```text
same slot when atomic multi-key operation is required;
distributed slots when scale and load distribution matter.
```

---

## 21. Operational Risks

### 21.1 Big ZSET

A Sorted Set with millions of members can be valid, but it must be intentional.

Questions:

```text
How big can it get?
How fast does it grow?
How fast is it trimmed?
What is the max member size?
What commands are allowed?
How do we monitor cardinality?
What happens during failover/restart?
```

### 21.2 Hot ZSET

One leaderboard or scheduler key can become hot.

Symptoms:

- high command rate on one key;
- Redis CPU high;
- tail latency rising;
- cluster one shard overloaded;
- commandstats dominated by ZSET commands.

Mitigations:

- shard leaderboard by segment/region/period;
- local buffering;
- batch updates;
- use approximate local ranking then merge;
- separate Redis deployment for hot workload;
- reduce write frequency.

### 21.3 Large Member Values

Member is stored in sorted set structures. Large members increase memory and network cost.

Bad member:

```json
{"userId":"u1","name":"Alice","avatar":"...","metadata":{...}}
```

Good member:

```text
u1
```

Hydrate metadata elsewhere.

### 21.4 Unbounded Historical Index

A time index without cleanup is a memory leak.

Always define:

```text
retention = how long this index matters
cleanup = how old members are removed
owner = which service owns cleanup
alert = what metric indicates cleanup failure
```

---

## 22. Observability for Sorted Set Workloads

Observe both Redis-level and application-level indicators.

### 22.1 Redis-Level

Useful signals:

- memory usage;
- command stats for `zadd`, `zrange`, `zrem`, `zpopmin`, `zremrangebyscore`;
- slowlog;
- latency monitor;
- big keys;
- hot keys;
- CPU;
- network throughput;
- evictions.

### 22.2 Application-Level

For delay queue:

```text
queue size
oldest due age
processing size
expired processing count
claim rate
ack rate
failure rate
dead-letter count
```

For leaderboard:

```text
cardinality
update rate
top-N query rate
rank query rate
period key count
memory per period
```

For rate limiter:

```text
allowed count
rejected count
Redis errors
fail-open/fail-closed count
average members per rate key
cleanup removals
```

### 22.3 Key Cardinality Dashboard

For each important ZSET:

```redis
ZCARD key
```

But do not run this for millions of dynamic keys every second. Sample or aggregate.

For controlled indexes, track cardinality from application metrics.

---

## 23. Failure Modeling

Sorted Set systems fail in predictable ways.

### 23.1 Redis Down

What happens if Redis is unavailable?

For leaderboard:

```text
Maybe degrade feature.
```

For rate limiter:

```text
Fail open or fail closed?
```

For scheduler:

```text
Jobs delayed; need recovery.
```

For SLA escalation:

```text
Redis cannot be sole detector. Have DB fallback/reconciliation.
```

### 23.2 Timeout After Command Sent

Client sends:

```redis
ZADD queue 100 job:1
```

Client times out.

Did Redis apply it?

Maybe yes.

Therefore retries need idempotent design.

For `ZADD` with same member and same score, retry is usually safe.

For `ZINCRBY`, retry may double increment.

Important distinction:

```text
set score operation can be idempotent;
increment score operation is not idempotent unless guarded.
```

### 23.3 Worker Crash After Claim

If worker uses `ZPOPMIN` then crashes before processing, job is lost unless tracked elsewhere.

Safer:

```text
move from ready to processing with visibility timeout
```

### 23.4 Duplicate Processing

Even with processing ZSET, duplicates can happen:

```text
worker A claims job
worker A pauses/GC stalls
visibility timeout expires
worker B reclaims job
worker A resumes and also completes
```

Mitigation:

- idempotent job processing;
- fencing token;
- DB conditional update;
- job state validation;
- exactly-once skepticism.

Redis can reduce duplicates. It cannot magically eliminate all duplicates across distributed systems.

---

## 24. Design Checklist for Every Sorted Set

Before creating a ZSET, answer:

```text
1. What is the key name?
2. Who owns this key?
3. What is the member?
4. Is member globally unique within this ZSET?
5. What is the score?
6. What does ascending order mean?
7. What does descending order mean?
8. What happens if scores tie?
9. What is expected cardinality?
10. What is max cardinality?
11. How are members removed?
12. Is there TTL or periodization?
13. Is Redis source of truth or derived index?
14. What happens if Redis update fails?
15. What happens if DB update succeeds but Redis index update fails?
16. Do commands need to be atomic?
17. Is Lua/Function required?
18. Are keys cluster-slot compatible?
19. How is this monitored?
20. What is the recovery/rebuild strategy?
```

If you cannot answer these, you are not ready to put that Sorted Set in production.

---

## 25. Java Implementation Blueprint: Delay Queue with ZSET

Below is conceptual Java design. It intentionally avoids tying to one client API too early.

### 25.1 Interfaces

```java
public interface DelayedJobQueue {
    void schedule(String jobId, Instant dueAt);
    List<String> claimDueJobs(Instant now, int limit, Duration visibilityTimeout);
    void ack(String jobId);
    List<String> reclaimExpired(Instant now, int limit);
}
```

### 25.2 Key Design

```java
public final class QueueKeys {
    public static String delayed(String queueName) {
        return "queue:{%s}:delayed".formatted(queueName);
    }

    public static String processing(String queueName) {
        return "queue:{%s}:processing".formatted(queueName);
    }

    private QueueKeys() {}
}
```

The hash tag ensures both keys are in the same Redis Cluster slot.

### 25.3 Schedule

```java
public void schedule(String jobId, Instant dueAt) {
    String key = QueueKeys.delayed(queueName);
    double score = dueAt.toEpochMilli();
    redis.zadd(key, score, jobId);
}
```

### 25.4 Claim

Use Lua:

```lua
local delayed = KEYS[1]
local processing = KEYS[2]
local now = tonumber(ARGV[1])
local visibilityTimeoutMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

local jobs = redis.call('ZRANGE', delayed, '-inf', now, 'BYSCORE', 'LIMIT', 0, limit)

for i, job in ipairs(jobs) do
  if redis.call('ZREM', delayed, job) == 1 then
    redis.call('ZADD', processing, now + visibilityTimeoutMs, job)
  end
end

return jobs
```

### 25.5 Ack

```java
public void ack(String jobId) {
    redis.zrem(QueueKeys.processing(queueName), jobId);
}
```

### 25.6 Reclaim Expired

Conceptual Lua:

```lua
local processing = KEYS[1]
local delayed = KEYS[2]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local retryDelayMs = tonumber(ARGV[3])

local jobs = redis.call('ZRANGE', processing, '-inf', now, 'BYSCORE', 'LIMIT', 0, limit)

for i, job in ipairs(jobs) do
  if redis.call('ZREM', processing, job) == 1 then
    redis.call('ZADD', delayed, now + retryDelayMs, job)
  end
end

return jobs
```

### 25.7 Remaining Gaps

This still needs:

- max attempts;
- dead-letter;
- payload storage;
- idempotent processing;
- observability;
- shutdown handling;
- concurrency tests;
- Redis timeout policy;
- backpressure.

The point: Sorted Set gives a primitive, not a full queueing platform.

---

## 26. Java Implementation Blueprint: Leaderboard

### 26.1 Interface

```java
public interface LeaderboardService {
    void submitScore(String gameId, String period, String userId, long score);
    List<LeaderboardEntry> top(String gameId, String period, int limit);
    Optional<LeaderboardEntry> rankOf(String gameId, String period, String userId);
}
```

### 26.2 Key

```java
public static String leaderboard(String gameId, String period) {
    return "game:%s:leaderboard:%s".formatted(gameId, period);
}
```

### 26.3 Submit High Score

Use `ZADD GT` semantics if available through client.

Conceptual:

```java
redis.zaddGt(key, score, userId);
```

Fallback with Lua if client abstraction does not expose it cleanly.

### 26.4 Top N

```java
var tuples = redis.zrangeRevWithScores(key, 0, limit - 1);
```

Map to domain:

```java
for each tuple:
  member = userId
  score = score
  rank = index + 1
```

### 26.5 Rank of User

```java
Long zeroBasedRank = redis.zrevrank(key, userId);
Double score = redis.zscore(key, userId);
```

If rank or score is null, user not ranked.

### 26.6 Period Expiry

When creating daily/weekly period keys, set TTL.

But avoid resetting TTL on every write unless intended.

You may set TTL when key is first created, or run lifecycle job.

---

## 27. Common Anti-Patterns

### 27.1 Using Sorted Set Because It Looks Cool

Do not use ZSET if you only need membership.

Use Set.

### 27.2 Using ZSET for FIFO

Sorted Set does not preserve insertion order for equal scores.

Use List or Stream for FIFO semantics.

### 27.3 Storing Large JSON as Member

Bad for memory and network.

Use member ID + payload key.

### 27.4 No Cleanup

Time index without cleanup is memory leak.

### 27.5 Blind `ZRANGE 0 -1`

Dangerous on large ZSET.

Use bounded ranges and batching.

### 27.6 Using `ZINCRBY` with Unsafe Retry

If client times out and retries, score may increment twice.

Use idempotent event IDs or authoritative recomputation if exactness matters.

### 27.7 Redis Leaderboard as Legal Record

Leaderboard can be recomputed. Legal/audit records must be durable elsewhere.

### 27.8 Cross-Slot Lua in Cluster

Multi-key script without hash tags fails in Redis Cluster.

Design cluster key schema upfront.

---

## 28. Practical Decision Framework

Use Sorted Set when your dominant query is:

```text
Give me members ordered by numeric score.
```

Use Sorted Set when you need:

```text
unique member + numeric ordering
```

Prefer Sorted Set for:

- leaderboard;
- top-N;
- priority queue;
- delay queue;
- deadline index;
- time index;
- sliding-window log;
- per-member expiry;
- risk ranking;
- retry scheduling.

Avoid Sorted Set when:

- you need strict FIFO;
- you need durable broker semantics;
- you need complex SQL-like querying;
- you need exact decimal financial calculation;
- you need many duplicate events for same member but member is not unique;
- you cannot bound cardinality;
- you cannot define cleanup;
- you need authoritative audit trail.

---

## 29. Exercises

### Exercise 1: Leaderboard

Build a Redis leaderboard for:

```text
gameId = chess
period = daily
```

Requirements:

- submit score;
- keep only high score;
- top 10;
- rank of user;
- around-me ranking;
- daily key TTL 30 days.

Questions:

```text
What is the key?
What is the member?
What is the score?
What is rank convention?
How do you avoid lowering high score?
What happens when Redis is down?
```

### Exercise 2: Delay Queue

Build a delay queue:

```text
queueName = email
```

Requirements:

- schedule job;
- claim due jobs;
- visibility timeout;
- ack;
- reclaim expired;
- max attempts;
- dead-letter.

Questions:

```text
Which operations must be atomic?
Which keys need same cluster slot?
How do you prevent lost jobs?
How do you handle duplicate processing?
```

### Exercise 3: Sliding Window Rate Limiter

Build limiter:

```text
100 requests per 60 seconds per user per endpoint
```

Requirements:

- exact sliding window;
- unique request member;
- Lua atomicity;
- TTL;
- metrics.

Questions:

```text
What is memory cost per active user?
What happens under retry?
What happens if Redis times out?
Fail open or fail closed?
```

### Exercise 4: SLA Index

Build case SLA breach detector:

```text
caseId -> breachAt
```

Requirements:

- add/update case breach deadline;
- scan due breaches;
- validate against source of truth;
- trigger escalation;
- remove resolved cases.

Questions:

```text
Why must Redis not be the source of truth?
How do you handle stale index entries?
How do you rebuild index?
What metrics prove scheduler health?
```

---

## 30. Summary

Redis Sorted Set is one of the highest-leverage Redis data structures.

Its core model is simple:

```text
unique member + numeric score + ordered access
```

From that, we can implement:

- leaderboard;
- ranking;
- top-N;
- priority queue;
- delay queue;
- scheduler;
- time index;
- sliding-window rate limiter;
- retry backoff;
- SLA breach detection;
- risk ranking.

But Sorted Set has sharp edges:

- member uniqueness matters;
- score semantics must be explicit;
- score precision matters;
- equal-score ordering is lexicographic, not FIFO;
- large range operations are dangerous;
- cleanup is mandatory;
- Redis Cluster affects multi-key scripts;
- Redis indexes can drift from source of truth;
- ZSET primitives do not equal durable queue/broker semantics.

The professional mental model is:

```text
Sorted Set is an ordered operational index.
It is excellent for fast candidate selection.
It is not automatically an authoritative workflow, queue, ledger, or audit system.
```

---

## 31. What You Should Be Able to Explain After This Part

You should now be able to explain:

1. What Redis Sorted Set is.
2. Why member uniqueness matters.
3. How score determines ordering.
4. Difference between rank range and score range.
5. How to build leaderboard.
6. How to build delay queue.
7. Why naive delay queue loses/duplicates jobs.
8. How processing ZSET plus visibility timeout works.
9. How Sorted Set supports sliding-window rate limiting.
10. Why score precision matters.
11. Why equal scores do not imply FIFO.
12. How to model ZSET index + HASH payload.
13. Why cleanup and cardinality planning are mandatory.
14. What changes in Redis Cluster.
15. Why Redis ZSET should often be treated as derived operational index.

---

## 32. Status Seri

```text
Part 007 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-008.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Redis Sets: Membership, Deduplication, Relationship, Eligibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-008.md">Part 008 — TTL, Expiration, Eviction: Data Hilang Bukan Bug, Tapi Kontrak ➡️</a>
</div>
