# learn-redis-mastery-for-java-engineers-part-014.md

# Part 014 — Lua Scripting: Atomic Multi-Step Logic di Redis

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memakai Redis secara aman, cepat, dan defensible dalam sistem produksi.  
> Fokus bagian ini: memahami Lua scripting sebagai cara menjalankan logika multi-command secara atomic di sisi Redis, beserta batas, risiko, pola desain, dan integrasi Java/Spring.

---

## 0. Posisi Part Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membahas Redis dari beberapa sudut:

- Redis core execution model.
- Data model dan data structures.
- String, Hash, List, Set, Sorted Set.
- TTL, expiration, eviction.
- Cache architecture.
- Rate limiting.
- Idempotency.
- Distributed lock.

Semua topik itu punya satu masalah yang terus muncul:

> Banyak operasi Redis yang benar secara konseptual membutuhkan lebih dari satu command, tetapi Redis hanya menjamin atomicity per command.

Contoh:

```text
GET current
if current < limit:
    INCR current
    EXPIRE key 60
```

Atau:

```text
GET lockKey
if value == myToken:
    DEL lockKey
```

Atau:

```text
ZSCORE userScore member
if exists:
    ZINCRBY userScore delta member
    HSET metadata member lastUpdated
```

Jika langkah-langkah seperti ini dijalankan dari aplikasi Java sebagai beberapa network round trip, ada race condition, partial failure, dan interleaving dari client lain.

Lua scripting adalah salah satu jawaban Redis untuk masalah ini.

Namun Lua bukan silver bullet. Lua bisa membuat sistem lebih benar, tetapi juga bisa membuat Redis lebih rapuh jika script terlalu berat, terlalu lama, tidak deterministik, sulit diobservasi, atau tidak cocok dengan Redis Cluster.

Bagian ini akan membangun mental model yang tepat.

---

## 1. Core Thesis

Lua scripting di Redis sebaiknya dipahami sebagai:

> Mekanisme untuk membawa logika kecil yang latency-sensitive dan atomicity-sensitive ke dalam Redis server, bukan cara untuk memindahkan business application ke Redis.

Dengan kata lain:

```text
Good Lua script:
- pendek
- deterministic
- bounded
- atomic
- key-aware
- mudah diuji
- punya return contract jelas
- menyelesaikan race kecil yang nyata

Bad Lua script:
- panjang
- business-heavy
- looping tidak bounded
- scan keyspace besar
- memanggil command mahal
- sulit dimonitor
- mengandung branching domain kompleks
- menjadi mini application server tersembunyi
```

Redis Lua bagus untuk:

- compare-and-delete lock release
- atomic rate limiter
- conditional state transition
- atomic quota consume
- idempotency state transition
- bounded queue claim
- small multi-key update dalam slot yang sama
- check-and-set
- check-and-expire
- small read-modify-write

Redis Lua buruk untuk:

- heavy report generation
- long-running query
- business workflow panjang
- query seluruh keyspace
- transformasi data besar
- pengganti transaction manager
- pengganti stream processor
- logic yang butuh external I/O

---

## 2. Kenapa Lua Dibutuhkan?

Redis command tunggal atomic.

Misalnya:

```redis
INCR quota:user:123
```

Command itu atomic. Dua client yang menjalankan `INCR` bersamaan tidak akan menghasilkan lost update.

Tetapi banyak kebutuhan nyata berbentuk multi-step:

```text
1. baca state
2. validasi state
3. update state
4. set TTL
5. return decision
```

Contoh rate limiter fixed window:

```text
current = INCR key
if current == 1:
    EXPIRE key 60
if current > limit:
    reject
else:
    allow
```

Tanpa Lua, ada risiko:

- `INCR` berhasil tetapi `EXPIRE` gagal karena client timeout/crash.
- Key menjadi immortal counter tanpa TTL.
- Retry dari aplikasi bisa menggandakan increment.
- Banyak request bersamaan sulit diberi decision konsisten.

Lua memungkinkan semua langkah itu berjalan sebagai satu unit atomic di Redis.

---

## 3. Mental Model Eksekusi Lua di Redis

Redis menjalankan Lua script di server.

Aplikasi mengirim:

```redis
EVAL <script> <numkeys> <key1> <key2> ... <arg1> <arg2> ...
```

Redis kemudian menjalankan script tersebut menggunakan embedded Lua interpreter.

Di dalam script:

- `KEYS[1]`, `KEYS[2]`, dst berisi nama key.
- `ARGV[1]`, `ARGV[2]`, dst berisi argument non-key.
- `redis.call(...)` menjalankan Redis command dari Lua.
- `redis.pcall(...)` mirip `redis.call`, tetapi error dikembalikan sebagai nilai error, bukan langsung menghentikan script.

Contoh paling sederhana:

```lua
return redis.call('GET', KEYS[1])
```

Dipanggil dengan:

```redis
EVAL "return redis.call('GET', KEYS[1])" 1 user:123:name
```

Redis mendokumentasikan bahwa `EVAL` menjalankan script Lua 5.1 dan key yang diakses harus dipassing eksplisit sebagai input key, sementara argument lain masuk lewat `ARGV`. Ini penting terutama untuk Redis Cluster dan analisis key routing. 

---

## 4. Atomicity: Apa yang Dijamin dan Tidak Dijamin

Lua script dieksekusi secara atomic terhadap command lain.

Artinya saat script berjalan:

```text
Client A script mulai
  command internal 1
  command internal 2
  command internal 3
Client A script selesai
Client B command baru berjalan
```

Client lain tidak melihat intermediate state.

Contoh:

```lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
```

Dari luar, ini tampak seperti satu operasi atomic.

Namun atomicity Lua bukan berarti:

1. Ada rollback otomatis seperti RDBMS transaction.
2. Script bisa melakukan external I/O.
3. Script aman dari semua failure sistem.
4. Script boleh berjalan lama.
5. Script bisa mengunci seluruh distributed system secara sempurna.

Jika script sudah melakukan beberapa write lalu error, perubahan sebelumnya tidak otomatis dibatalkan seperti database transaction tradisional.

Maka desain script harus:

- sederhana
- validasi di awal bila mungkin
- avoid partial unsafe state
- return explicit status
- gunakan data model yang mudah dipulihkan

---

## 5. Lua vs Pipeline vs Transaction vs WATCH

Banyak engineer bingung kapan harus memakai Lua, pipeline, transaction Redis, atau `WATCH`.

Mari bedakan.

### 5.1 Pipeline

Pipeline mengurangi network round trip.

```text
Client kirim command A, B, C tanpa menunggu response satu per satu.
Redis tetap menjalankan command satu per satu.
```

Pipeline tidak memberikan conditional atomicity.

Gunakan pipeline untuk:

- batch GET/SET
- latency optimization
- banyak command independen

Jangan gunakan pipeline untuk:

- read-check-write atomic
- conditional update yang harus bebas race

### 5.2 MULTI/EXEC

Redis transaction dengan `MULTI/EXEC` menjalankan beberapa command secara serialized.

Tetapi command di dalam transaction tidak bisa bercabang berdasarkan hasil command sebelumnya dengan mudah.

Contoh:

```redis
MULTI
INCR key
EXPIRE key 60
EXEC
```

Ini atomic dalam arti command-command dieksekusi berurutan tanpa interleaving, tetapi tidak punya logic seperti:

```text
if current == 1 then expire
```

Untuk branching atomic, Lua lebih cocok.

### 5.3 WATCH

`WATCH` memberikan optimistic locking.

Pattern:

```text
WATCH key
value = GET key
compute new value
MULTI
SET key newValue
EXEC
```

Jika key berubah sebelum `EXEC`, transaction gagal dan client retry.

Cocok untuk:

- low contention
- logic kompleks di aplikasi
- value kecil
- retry acceptable

Tidak cocok untuk:

- hot path high contention
- limiter sangat ramai
- flow yang tidak ingin retry storm

### 5.4 Lua

Lua cocok untuk:

- read-check-write kecil
- high contention
- butuh single round trip
- butuh return decision atomic
- logic bounded dan dekat dengan data

Ringkasnya:

| Kebutuhan | Tool yang Cocok |
|---|---|
| Mengurangi RTT untuk command independen | Pipeline |
| Menjalankan beberapa command tanpa interleaving, tanpa branching kompleks | MULTI/EXEC |
| Optimistic concurrency dengan logic di aplikasi | WATCH |
| Atomic conditional multi-step logic di Redis | Lua |

---

## 6. EVAL: Cara Kerja Dasar

Format:

```redis
EVAL script numkeys key [key ...] arg [arg ...]
```

Contoh:

```redis
EVAL "return redis.call('GET', KEYS[1])" 1 app:user:123:name
```

Contoh dengan argument:

```redis
EVAL "redis.call('SET', KEYS[1], ARGV[1]); return 'OK'" 1 app:user:123:name Alice
```

Script:

```lua
redis.call('SET', KEYS[1], ARGV[1])
return 'OK'
```

Parameter:

```text
KEYS[1] = app:user:123:name
ARGV[1] = Alice
```

Prinsip penting:

> Semua nama key yang akan disentuh script harus dikirim lewat KEYS, bukan disusun secara liar dari ARGV di dalam script.

Buruk:

```lua
local key = 'user:' .. ARGV[1] .. ':profile'
return redis.call('GET', key)
```

Lebih baik:

```lua
return redis.call('GET', KEYS[1])
```

Kenapa?

Karena Redis Cluster dan tooling butuh tahu key apa yang disentuh script. Dynamic key construction menyulitkan routing, observability, testing, dan review.

---

## 7. EVALSHA dan Script Cache

Mengirim script panjang lewat `EVAL` setiap kali punya overhead bandwidth dan parsing.

Redis menyediakan script cache.

Flow:

```text
1. SCRIPT LOAD <script>
2. Redis mengembalikan SHA1
3. Client memanggil EVALSHA <sha> ...
```

Contoh:

```redis
SCRIPT LOAD "return redis.call('GET', KEYS[1])"
```

Hasil:

```text
e0e1f9fabfc9d4800c877a703b823ac0578ff8db
```

Lalu:

```redis
EVALSHA e0e1f9fabfc9d4800c877a703b823ac0578ff8db 1 app:user:123:name
```

Redis mendokumentasikan bahwa `SCRIPT LOAD` memuat script ke cache tanpa mengeksekusinya; setelah itu script bisa dipanggil dengan `EVALSHA` memakai digest SHA1 yang sesuai.

Java clients biasanya menyembunyikan detail ini:

- coba `EVALSHA`
- jika `NOSCRIPT`, load script
- retry

Namun sebagai engineer produksi, kita tetap perlu paham karena:

- failover bisa membuat script cache hilang di node baru
- deployment baru bisa membawa versi script berbeda
- script cache bukan registry versioned application logic
- SHA berubah jika isi script berubah walau whitespace

---

## 8. Return Type Contract

Lua script harus punya return contract yang eksplisit.

Contoh buruk:

```lua
if something then
  return 1
else
  return nil
end
```

Di Java, `nil`, integer, bulk string, array, dan error bisa termapping dengan cara yang tidak selalu nyaman.

Lebih baik:

```lua
if allowed then
  return {1, current, ttl}
else
  return {0, current, ttl}
end
```

Atau pakai status string:

```lua
return {'ALLOWED', current, ttl}
```

Untuk production-grade script, definisikan:

```text
Return[1] = status code
Return[2] = numeric value utama
Return[3] = optional TTL/retryAfter/errorCode
```

Contoh:

```text
{1, 5, 55} berarti allowed, current usage 5, reset dalam 55 detik
{0, 101, 33} berarti rejected, current usage 101, retry setelah 33 detik
```

Jangan biarkan aplikasi Java menebak-nebak maksud response.

---

## 9. redis.call vs redis.pcall

Di Lua Redis:

```lua
redis.call('GET', KEYS[1])
```

Jika command error, script error.

```lua
redis.pcall('GET', KEYS[1])
```

Jika command error, error dikembalikan sebagai nilai yang bisa diperiksa.

Umumnya gunakan `redis.call` untuk fail-fast.

Gunakan `redis.pcall` hanya jika script memang punya error handling lokal yang jelas.

Contoh:

```lua
local result = redis.pcall('INCR', KEYS[1])
if type(result) == 'table' and result['err'] then
  return {'ERROR', result['err']}
end
return {'OK', result}
```

Tetapi untuk kebanyakan script backend, lebih baik data model divalidasi sehingga command tidak error.

Jika `INCR` bisa error karena value bukan integer, itu biasanya bug type ownership, bukan kondisi normal.

---

## 10. Pattern 1 — Safe Lock Release

Ini pola paling klasik.

Masalah:

```redis
DEL lock:key
```

Tidak aman jika lock sudah expired lalu diambil client lain.

Scenario:

```text
T1: Client A acquire lock value=A ttl=5s
T2: Client A pause 10s karena GC
T3: Lock expired
T4: Client B acquire lock value=B ttl=5s
T5: Client A resume dan DEL lock:key
T6: Lock milik B terhapus
```

Solusi: delete hanya jika value masih token milik sendiri.

Lua:

```lua
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
```

Dipanggil dengan:

```text
KEYS[1] = lock key
ARGV[1] = owner token
```

Return:

```text
1 = lock released
0 = lock not owned / already expired / replaced
```

Java harus memperlakukan return `0` sebagai:

```text
Saya tidak lagi memiliki lock.
Jangan mengasumsikan critical section masih valid.
```

Namun ini hanya safe release. Ini tidak menyelesaikan semua problem distributed lock seperti GC pause dan stale actor. Untuk resource eksternal, tetap butuh fencing token seperti dibahas di Part 013.

---

## 11. Pattern 2 — Fixed Window Rate Limiter

Script:

```lua
local current = redis.call('INCR', KEYS[1])

if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end

local limit = tonumber(ARGV[2])
local ttl = redis.call('TTL', KEYS[1])

if current > limit then
  return {0, current, ttl}
else
  return {1, current, ttl}
end
```

Input:

```text
KEYS[1] = rl:{tenant123}:login:2026-06-20T10:15
ARGV[1] = windowSeconds
ARGV[2] = limit
```

Return:

```text
{1, current, ttl} allowed
{0, current, ttl} rejected
```

Keuntungan Lua di sini:

- `INCR` dan `EXPIRE` atomic sebagai satu script.
- Tidak ada immortal counter akibat crash antara `INCR` dan `EXPIRE`.
- Decision returned dari Redis sudah final untuk request itu.

Kelemahan fixed window:

- boundary burst.
- Tidak smooth.
- Bukan fairness sempurna.

Tetapi untuk banyak quota sederhana, ini cukup.

---

## 12. Pattern 3 — Sliding Window dengan Sorted Set

Untuk limiter yang lebih presisi, gunakan Sorted Set.

Data model:

```text
key = rl:{tenant123}:api:/v1/payments
score = timestamp millis
member = unique request id
```

Script:

```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttlSeconds = tonumber(ARGV[5])

local min = now - window

redis.call('ZREMRANGEBYSCORE', key, 0, min)

local count = redis.call('ZCARD', key)

if count >= limit then
  local ttl = redis.call('TTL', key)
  return {0, count, ttl}
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttlSeconds)

count = count + 1
local ttl = redis.call('TTL', key)

return {1, count, ttl}
```

Keuntungan:

- lebih akurat dari fixed window
- bisa tahu request dalam window aktif
- cocok untuk quota enforcement yang butuh fairness lebih baik

Risiko:

- `ZREMRANGEBYSCORE` bisa mahal jika banyak member expired sekaligus
- setiap request menambah member
- perlu unique member agar request tidak overwrite
- memory lebih besar daripada counter sederhana
- key hot bisa menyebabkan bottleneck

Script ini harus punya batas operasional:

```text
max cardinality per key ≈ limit + burst + cleanup lag
```

Jika satu tenant bisa menerima 100k RPS pada satu limiter key, ini bukan desain yang aman.

---

## 13. Pattern 4 — Atomic Idempotency State Transition

Kita ingin transisi:

```text
missing -> STARTED
STARTED -> duplicate/in-progress
COMPLETED -> replay response
FAILED -> maybe retry policy
```

Script untuk start processing:

```lua
local key = KEYS[1]
local startedValue = ARGV[1]
local ttlSeconds = tonumber(ARGV[2])

local existing = redis.call('GET', key)

if not existing then
  redis.call('SET', key, startedValue, 'EX', ttlSeconds)
  return {'STARTED'}
end

return {'EXISTS', existing}
```

Script untuk complete hanya jika state masih milik attempt tertentu:

```lua
local key = KEYS[1]
local expected = ARGV[1]
local completed = ARGV[2]
local ttlSeconds = tonumber(ARGV[3])

local current = redis.call('GET', key)

if current == expected then
  redis.call('SET', key, completed, 'EX', ttlSeconds)
  return {'COMPLETED'}
end

if not current then
  return {'MISSING'}
end

return {'CONFLICT', current}
```

Manfaat:

- mencegah completion dari stale attempt
- state transition atomic
- response explicit

Tetapi hati-hati: menyimpan full response sebagai string bisa mahal. Untuk response besar, simpan pointer atau compact response representation.

---

## 14. Pattern 5 — Compare-And-Set JSON/String Version

Misal value Redis menyimpan versi:

```json
{"version":7,"status":"OPEN"}
```

Lua tidak ideal untuk parsing JSON kompleks di Redis core, kecuali memakai RedisJSON command dan modul yang tersedia. Untuk string biasa, kita bisa menyimpan version terpisah.

Data model lebih sederhana:

```text
state:{caseId}:version -> integer
state:{caseId}:status  -> string
```

Script:

```lua
local versionKey = KEYS[1]
local statusKey = KEYS[2]

local expectedVersion = tonumber(ARGV[1])
local newStatus = ARGV[2]
local ttlSeconds = tonumber(ARGV[3])

local currentVersion = tonumber(redis.call('GET', versionKey) or '0')

if currentVersion ~= expectedVersion then
  return {'VERSION_MISMATCH', currentVersion}
end

local nextVersion = currentVersion + 1
redis.call('SET', versionKey, nextVersion, 'EX', ttlSeconds)
redis.call('SET', statusKey, newStatus, 'EX', ttlSeconds)

return {'UPDATED', nextVersion}
```

Catatan penting:

- Ini bukan pengganti database transaction untuk state authoritative.
- Cocok untuk transient coordination state.
- Jika status regulatori harus audit-grade, authoritative state tetap sebaiknya di database/audit log.

---

## 15. Pattern 6 — Atomic Queue Claim dengan Sorted Set

Misal kita punya delay queue:

```text
zset: scheduled jobs
score: eligible timestamp
member: job id
```

Worker ingin claim job yang sudah eligible.

Naive:

```text
ZRANGEBYSCORE queue -inf now LIMIT 0 1
ZREM queue jobId
```

Race:

- dua worker membaca job yang sama
- satu berhasil remove, satu gagal
- butuh handling

Lua:

```lua
local queueKey = KEYS[1]
local processingKey = KEYS[2]

local now = tonumber(ARGV[1])
local visibilityUntil = tonumber(ARGV[2])

local jobs = redis.call('ZRANGEBYSCORE', queueKey, '-inf', now, 'LIMIT', 0, 1)

if #jobs == 0 then
  return {0}
end

local job = jobs[1]
local removed = redis.call('ZREM', queueKey, job)

if removed == 1 then
  redis.call('ZADD', processingKey, visibilityUntil, job)
  return {1, job}
end

return {0}
```

Ini membuat claim eligible job atomic.

Tetapi jangan lupa:

- butuh reaper untuk processing timeout
- butuh dead letter policy
- Redis queue tidak otomatis sama dengan broker durable
- job payload sebaiknya tidak terlalu besar

---

## 16. Determinism dan Replication Concern

Script sebaiknya deterministic.

Artinya output dan efek write harus ditentukan oleh:

- current Redis data
- `KEYS`
- `ARGV`

Jangan bergantung pada random/time internal secara sembarangan jika efeknya perlu direplikasi/persisted secara aman.

Praktik aman:

```text
Application passes nowMillis sebagai ARGV.
Application passes requestId sebagai ARGV.
Application passes token sebagai ARGV.
```

Daripada script membuat identity/time sendiri.

Contoh:

```lua
local now = tonumber(ARGV[1])
```

Bukan:

```lua
-- Jangan jadikan ini default untuk logic kritikal tanpa memahami implikasinya
local now = redis.call('TIME')
```

Untuk sistem regulatori atau audit-sensitive, waktu yang digunakan untuk decision harus jelas sumbernya:

- application clock?
- Redis server clock?
- database commit timestamp?
- event timestamp?

Jangan campur tanpa desain.

---

## 17. Redis Cluster Constraint

Lua di Redis Cluster punya aturan penting:

> Semua key yang diakses oleh script harus berada pada node/slot yang sesuai.

Karena Redis Cluster membagi key berdasarkan hash slot, script multi-key harus menggunakan key yang berada di slot yang sama jika dijalankan sebagai satu script di satu node.

Gunakan hash tag:

```text
rl:{tenant123}:login
quota:{tenant123}:daily
state:{tenant123}:case:456
```

Bagian dalam `{...}` menentukan slot.

Contoh key yang satu slot:

```text
quota:{tenant123}:limit
quota:{tenant123}:used
quota:{tenant123}:meta
```

Contoh key yang mungkin beda slot:

```text
quota:tenant123:limit
quota:tenant123:used
quota:tenant123:meta
```

Untuk script:

```lua
redis.call('GET', KEYS[1])
redis.call('INCR', KEYS[2])
```

Pastikan:

```text
KEYS[1] = quota:{tenant123}:limit
KEYS[2] = quota:{tenant123}:used
```

Bukan:

```text
KEYS[1] = quota:{tenant123}:limit
KEYS[2] = quota:{tenant456}:used
```

Desain key schema Redis Cluster harus dilakukan sebelum script dipakai luas.

---

## 18. Script Latency: Bahaya yang Sering Diremehkan

Lua script berjalan di Redis server. Saat script berjalan lama, Redis tidak bisa melayani command lain secara normal.

Script lambat dapat menyebabkan:

- tail latency naik
- timeout client
- retry storm
- replication delay
- failover false positive
- blocked hot shard
- cascading failure di aplikasi Java

Penyebab script lambat:

```text
- loop terhadap ribuan/jutaan item
- SMEMBERS pada set besar
- HGETALL hash besar
- LRANGE list besar
- ZRANGE range besar
- scan keyspace
- nested loops
- script melakukan cleanup masif
- command dengan kompleksitas tinggi di hot path
```

Rule produksi:

> Lua script harus O(1) atau O(log N) atau O(k kecil yang bounded secara eksplisit).

Jika script melakukan O(N), N harus punya batas operasional yang jelas.

Contoh acceptable:

```text
LIMIT 0 1
LIMIT 0 10
Remove max 100 expired entries per call
```

Contoh berbahaya:

```lua
local members = redis.call('SMEMBERS', KEYS[1])
for i, m in ipairs(members) do
  ...
end
```

Jika set bisa tumbuh menjadi jutaan member, script ini bom waktu.

---

## 19. Timeouts, BUSY Script, dan SCRIPT KILL

Redis punya mekanisme untuk mendeteksi script yang berjalan terlalu lama.

Jika script terlalu lama, Redis bisa mengembalikan kondisi `BUSY` untuk command lain.

Ada command seperti:

```redis
SCRIPT KILL
```

Namun ada batas penting:

- Script yang sudah melakukan write tidak selalu bisa dibunuh aman.
- Killing script bukan bagian dari normal control flow.
- Jika sering butuh kill script, desain script salah.

Production strategy:

```text
1. Buat script kecil.
2. Batasi loop.
3. Hindari command unbounded.
4. Test dengan data besar.
5. Monitor slowlog dan latency.
6. Punya rollback deployment script.
```

Jangan mengandalkan `SCRIPT KILL` sebagai safety utama.

---

## 20. Error Handling Strategy di Java

Saat aplikasi Java memanggil Lua, error bisa berasal dari:

1. Script syntax error.
2. Wrong number of keys/args.
3. Redis command error di dalam script.
4. Type mismatch key.
5. NOSCRIPT.
6. Timeout.
7. MOVED/ASK dalam cluster.
8. Connection dropped.
9. Serialization mismatch return value.

Pola handling:

```text
Syntax/wrong args:
  deployment/test bug, fail fast

Type mismatch:
  key ownership bug, alert

NOSCRIPT:
  client reload script, retry once

Timeout:
  outcome unknown if script may have executed
  do not blindly retry non-idempotent script

MOVED/ASK:
  cluster-aware client should handle

Unexpected return:
  version mismatch between app and script
```

Poin sangat penting:

> Timeout pada client bukan bukti script tidak berjalan.

Jika script melakukan write lalu response hilang karena network timeout, aplikasi tidak tahu outcome kecuali script didesain idempotent atau ada read-after-timeout reconciliation.

Contoh buruk:

```text
Call consumeQuota()
Timeout
Retry consumeQuota()
Quota terpotong dua kali
```

Solusi:

- gunakan request id/member unik
- script idempotent terhadap request id
- read-after-timeout
- explicit operation log kecil
- design retry-safe

---

## 21. Lua Script Idempotency

Untuk operasi yang mungkin diretry, script harus bisa menerima operation id.

Contoh quota consume idempotent:

Data:

```text
quota:{tenant}:used -> counter
quota:{tenant}:ops  -> set of operation ids
```

Script:

```lua
local usedKey = KEYS[1]
local opsKey = KEYS[2]

local opId = ARGV[1]
local amount = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])

local already = redis.call('SISMEMBER', opsKey, opId)
if already == 1 then
  local current = tonumber(redis.call('GET', usedKey) or '0')
  return {'DUPLICATE', current}
end

local current = tonumber(redis.call('GET', usedKey) or '0')
if current + amount > limit then
  return {'REJECTED', current}
end

local next = redis.call('INCRBY', usedKey, amount)
redis.call('SADD', opsKey, opId)
redis.call('EXPIRE', usedKey, ttlSeconds)
redis.call('EXPIRE', opsKey, ttlSeconds)

return {'ACCEPTED', next}
```

Trade-off:

- lebih aman untuk retry
- memory lebih besar karena menyimpan operation id
- perlu TTL yang sesuai dengan retry window

Ini contoh desain defensible untuk sistem enforcement.

---

## 22. Script Versioning

Lua script adalah bagian dari application behavior.

Jangan perlakukan script sebagai string acak di dalam method Java.

Buruk:

```java
String script = "local x = redis.call('GET', KEYS[1]) ...";
```

Lebih baik:

```text
src/main/resources/redis-scripts/rate-limit-fixed-window-v1.lua
src/main/resources/redis-scripts/idempotency-start-v1.lua
src/main/resources/redis-scripts/lock-release-v1.lua
```

Naming:

```text
<domain>-<operation>-v<version>.lua
```

Contoh:

```text
quota-consume-v1.lua
quota-consume-v2.lua
idempotency-complete-v1.lua
```

Script versioning rules:

1. Jangan ubah semantic return contract diam-diam.
2. Jika return shape berubah, bump version.
3. Jika key schema berubah, bump version.
4. Jika argument order berubah, bump version.
5. Deploy app dan script secara compatible.
6. Simpan test fixture per script version.

---

## 23. Java Integration dengan Lettuce

Contoh konsep dengan Lettuce synchronous API:

```java
RedisCommands<String, String> commands = connection.sync();

String script = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local limit = tonumber(ARGV[2])
local ttl = redis.call('TTL', KEYS[1])
if current > limit then
  return {0, current, ttl}
else
  return {1, current, ttl}
end
""";

@SuppressWarnings("unchecked")
List<Object> result = (List<Object>) commands.eval(
    script,
    ScriptOutputType.MULTI,
    new String[] { "rl:{tenant123}:login" },
    "60",
    "100"
);

Long allowed = (Long) result.get(0);
Long current = (Long) result.get(1);
Long ttl = (Long) result.get(2);
```

Catatan:

- Return type harus dikonversi hati-hati.
- Gunakan wrapper class agar service layer tidak berurusan dengan raw `List<Object>`.
- Jangan compile script string di banyak tempat.
- Pisahkan script resource loader.
- Untuk reactive path, hati-hati terhadap timeout dan retry semantics.

Wrapper yang lebih baik:

```java
public record RateLimitDecision(
    boolean allowed,
    long current,
    long retryAfterSeconds
) {}
```

Mapping:

```java
public RateLimitDecision mapRateLimitResult(List<Object> result) {
    long allowedFlag = (Long) result.get(0);
    long current = (Long) result.get(1);
    long ttl = (Long) result.get(2);
    return new RateLimitDecision(allowedFlag == 1L, current, ttl);
}
```

---

## 24. Java Integration dengan Spring Data Redis

Spring Data Redis menyediakan `RedisScript` dan `RedisTemplate.execute(...)`.

Contoh resource script:

```text
src/main/resources/redis-scripts/lock-release-v1.lua
```

Isi:

```lua
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
```

Bean:

```java
@Bean
public RedisScript<Long> lockReleaseScript() {
    DefaultRedisScript<Long> script = new DefaultRedisScript<>();
    script.setLocation(new ClassPathResource("redis-scripts/lock-release-v1.lua"));
    script.setResultType(Long.class);
    return script;
}
```

Usage:

```java
Long released = redisTemplate.execute(
    lockReleaseScript,
    List.of("lock:{case-123}:assignment"),
    ownerToken
);

boolean success = released != null && released == 1L;
```

Spring Data Redis documentation menjelaskan dukungan scripting via `eval` dan `evalsha`, dengan high-level abstraction `RedisScript` untuk menjalankan Lua melalui RedisTemplate.

Production tip:

- Buat class per script operation.
- Jangan expose RedisTemplate langsung ke semua service.
- Bungkus hasil script dalam domain result.
- Test script langsung dengan Redis Testcontainers.

---

## 25. Spring Design: Script Gateway Pattern

Daripada service domain memanggil Redis script langsung, buat gateway:

```text
Application Service
    -> RateLimitGateway
        -> RedisRateLimitScriptExecutor
            -> RedisTemplate/Lettuce
```

Contoh interface:

```java
public interface QuotaEnforcer {
    QuotaDecision consume(QuotaCommand command);
}
```

Command:

```java
public record QuotaCommand(
    String tenantId,
    String dimension,
    String operationId,
    long amount,
    long limit,
    Duration window
) {}
```

Decision:

```java
public sealed interface QuotaDecision {
    record Accepted(long current) implements QuotaDecision {}
    record Rejected(long current, Duration retryAfter) implements QuotaDecision {}
    record Duplicate(long current) implements QuotaDecision {}
    record Failed(String reason) implements QuotaDecision {}
}
```

Benefit:

- Domain layer tidak tahu Lua.
- Return contract typed.
- Bisa diganti implementasi SQL/in-memory untuk test tertentu.
- Failure handling terkonsentrasi.
- Metrics terkonsentrasi.

---

## 26. Testing Lua Scripts

Lua script Redis harus dites sebagai artifact tersendiri.

Minimal test matrix:

```text
1. Missing key.
2. Existing key valid.
3. Existing key invalid type.
4. Limit boundary.
5. TTL applied.
6. Duplicate operation id.
7. Conflict state.
8. Wrong token.
9. Expired key behavior.
10. Cluster hash tag compatibility.
11. Large but allowed cardinality.
12. Timeout/retry behavior.
```

Gunakan Testcontainers Redis:

```java
@Testcontainers
class RateLimitScriptIT {
    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:8-alpine")
        .withExposedPorts(6379);
}
```

Test script bukan hanya happy path:

```text
- assert return shape
- assert key value
- assert TTL range
- assert duplicate call tidak double count
- assert wrong type menghasilkan expected error atau handled response
```

Untuk script yang dipakai di Redis Cluster, idealnya punya cluster integration test juga, setidaknya untuk key hash tag convention.

---

## 27. Observability untuk Lua Script

Masalah Lua sering sulit terlihat karena dari sisi Redis hanya tampak sebagai `EVAL` atau `EVALSHA`.

Yang perlu dimonitor:

```text
- command latency EVAL/EVALSHA
- Redis slowlog
- latency monitor
- client timeout
- script error count
- NOSCRIPT count
- BUSY script incident
- per-operation metrics di Java wrapper
- key cardinality yang dipakai script
- memory growth dari script side effects
```

Di Java wrapper, emit metrics seperti:

```text
redis.script.invocations{script="quota-consume-v1", outcome="accepted"}
redis.script.invocations{script="quota-consume-v1", outcome="rejected"}
redis.script.errors{script="quota-consume-v1", error="timeout"}
redis.script.latency{script="quota-consume-v1"}
```

Jangan hanya mengandalkan Redis-level metrics karena Redis tidak tahu nama domain script Anda kecuali Anda melabeli di sisi client.

---

## 28. Security dan ACL

Lua script dapat menjalankan Redis commands.

Karena itu:

- Batasi siapa yang boleh menjalankan `EVAL`/`EVALSHA`.
- Jangan menerima script body dari user input.
- Jangan jadikan Lua sebagai dynamic plugin system publik.
- Review script seperti production code.
- Hindari command berbahaya di script.
- Gunakan ACL sesuai role aplikasi.

Risiko besar:

```text
Jika attacker bisa menjalankan EVAL arbitrary, ia bisa membaca/menulis key yang credential Redis-nya izinkan.
```

Jadi Redis credential untuk aplikasi harus least privilege jika memungkinkan.

---

## 29. Lua Anti-Patterns

### 29.1 Script Sebagai Business Workflow Engine

Buruk:

```text
Script 500 baris mengatur lifecycle enforcement case, escalation, notification, audit, assignment, dan SLA.
```

Masalah:

- sulit dites
- sulit diobservasi
- sulit rollback
- tidak ada type system
- debugging lemah
- domain logic tersembunyi

Lua seharusnya hanya menjalankan state transition kecil yang butuh atomicity.

### 29.2 Loop Tidak Bounded

Buruk:

```lua
local keys = redis.call('KEYS', 'session:*')
for i, key in ipairs(keys) do
  redis.call('DEL', key)
end
```

Ini bisa membekukan Redis.

### 29.3 Dynamic Key dari ARGV

Buruk:

```lua
local key = 'quota:' .. ARGV[1]
redis.call('INCR', key)
```

Lebih baik key dikirim eksplisit via `KEYS`.

### 29.4 Return Contract Tidak Stabil

Buruk:

```lua
if ok then return 1 else return {'ERR', 'LIMIT'} end
```

Sulit dimapping di Java.

### 29.5 Blind Retry Setelah Timeout

Buruk:

```text
EVAL timeout -> retry langsung
```

Jika script non-idempotent, ini bisa double write.

### 29.6 Script Mengakses Big Key

Buruk:

```lua
local all = redis.call('HGETALL', KEYS[1])
```

Jika Hash besar, latency explode.

---

## 30. Design Checklist Sebelum Menulis Lua Script

Sebelum menulis Lua, jawab pertanyaan ini:

```text
1. Race condition apa yang ingin dihilangkan?
2. Apakah satu Redis command sudah cukup?
3. Apakah MULTI/EXEC cukup?
4. Apakah WATCH cukup?
5. Apakah logic benar-benar harus atomic di Redis?
6. Apakah semua key diketahui di awal?
7. Apakah semua key satu slot di Redis Cluster?
8. Apakah kompleksitas script bounded?
9. Apa return contract-nya?
10. Apakah aman terhadap retry setelah timeout?
11. Apakah script idempotent?
12. Apakah TTL selalu diterapkan dengan benar?
13. Bagaimana script dites?
14. Bagaimana script dimonitor?
15. Bagaimana script di-versioning?
16. Apa rollback plan jika script bermasalah?
```

Jika tidak bisa menjawab ini, jangan deploy script ke production hot path.

---

## 31. Failure Modeling: Script Timeout

Scenario:

```text
Service A memanggil Lua consume quota.
Redis mengeksekusi script dan berhasil INCR.
Network delay terjadi.
Client timeout.
Service A tidak menerima response.
Service A retry.
```

Jika script tidak idempotent:

```text
quota consumed twice
```

Jika script memakai operation id:

```text
retry mendeteksi duplicate
quota tidak double consumed
```

Lesson:

> Atomicity di Redis tidak otomatis membuat operasi aman terhadap distributed failure.

Atomicity hanya menjamin tidak ada interleaving command lain saat script berjalan. Ia tidak menyelesaikan uncertainty antara client dan server saat response hilang.

---

## 32. Failure Modeling: Script Deploy Mismatch

Scenario:

```text
App version 2 expect return {status, current, retryAfter, reason}
Sebagian pod masih menjalankan script version 1 return {status, current, retryAfter}
Mapping Java error di production.
```

Solusi:

- version script filename
- version wrapper
- backward-compatible rollout
- canary
- contract test
- metrics per version

Jangan mengubah script return shape tanpa deployment strategy.

---

## 33. Failure Modeling: Cluster Cross-Slot

Scenario:

```text
Script menyentuh:
quota:tenantA:daily
quota:tenantA:ops
```

Di single Redis aman.

Saat migrasi ke Redis Cluster:

```text
CROSSSLOT Keys in request don't hash to the same slot
```

Solusi sejak awal:

```text
quota:{tenantA}:daily
quota:{tenantA}:ops
```

Lesson:

> Script yang tidak cluster-aware sering menjadi migration blocker.

---

## 34. Kapan Lua Lebih Baik dari Membuat Service Lock?

Misal ada operasi quota:

```text
check current usage
if usage + amount <= limit:
    increment usage
    record operation id
```

Alternatif:

1. distributed lock lalu beberapa Redis command
2. Lua script atomic

Lua biasanya lebih baik karena:

- single round trip
- no separate lock lifecycle
- no lock expiry ambiguity
- less contention overhead
- simpler failure surface

Tetapi Lua hanya cocok jika logic pendek.

Jika logic butuh:

- call database
- call external service
- publish audit event
- update many bounded contexts

maka jangan masukkan ke Lua. Gunakan database transaction, workflow engine, outbox, atau explicit orchestration.

---

## 35. Kapan Jangan Pakai Lua

Jangan pakai Lua jika:

```text
1. Operasi bisa dilakukan dengan satu command Redis.
2. Pipeline cukup untuk performance.
3. WATCH cukup dan contention rendah.
4. Logic butuh query besar.
5. Logic butuh external I/O.
6. Script harus memproses ribuan item per request.
7. Return contract berubah-ubah.
8. Team tidak punya testing/observability untuk script.
9. Key schema belum cluster-aware.
10. Kegagalan script akan sulit dipulihkan.
```

Lua adalah pisau bedah, bukan palu.

---

## 36. Mini Lab 1 — Safe Lock Release

### Goal

Membuktikan kenapa `DEL lock` tidak aman dan Lua compare-delete lebih aman.

### Setup

```bash
redis-cli SET lock:test token-a NX PX 5000
redis-cli GET lock:test
```

Simulasi lock diganti:

```bash
redis-cli SET lock:test token-b PX 5000
```

Unsafe release:

```bash
redis-cli DEL lock:test
```

Ini menghapus lock token-b.

Safe release:

```bash
redis-cli SET lock:test token-b PX 5000
redis-cli EVAL "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end" 1 lock:test token-a
redis-cli GET lock:test
```

Expected:

```text
script return 0
lock:test masih token-b
```

---

## 37. Mini Lab 2 — Fixed Window Rate Limiter

Script file:

```lua
local current = redis.call('INCR', KEYS[1])

if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end

local limit = tonumber(ARGV[2])
local ttl = redis.call('TTL', KEYS[1])

if current > limit then
  return {0, current, ttl}
else
  return {1, current, ttl}
end
```

Run:

```bash
redis-cli --eval fixed-window.lua rl:{u1}:login , 60 3
redis-cli --eval fixed-window.lua rl:{u1}:login , 60 3
redis-cli --eval fixed-window.lua rl:{u1}:login , 60 3
redis-cli --eval fixed-window.lua rl:{u1}:login , 60 3
```

Expected:

```text
1st: allowed
2nd: allowed
3rd: allowed
4th: rejected
```

Check TTL:

```bash
redis-cli TTL rl:{u1}:login
```

---

## 38. Mini Lab 3 — Idempotent Quota Consume

Script:

```lua
local usedKey = KEYS[1]
local opsKey = KEYS[2]

local opId = ARGV[1]
local amount = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])

if redis.call('SISMEMBER', opsKey, opId) == 1 then
  local current = tonumber(redis.call('GET', usedKey) or '0')
  return {'DUPLICATE', current}
end

local current = tonumber(redis.call('GET', usedKey) or '0')

if current + amount > limit then
  return {'REJECTED', current}
end

local nextValue = redis.call('INCRBY', usedKey, amount)
redis.call('SADD', opsKey, opId)
redis.call('EXPIRE', usedKey, ttlSeconds)
redis.call('EXPIRE', opsKey, ttlSeconds)

return {'ACCEPTED', nextValue}
```

Run same op twice:

```bash
redis-cli --eval quota-consume.lua quota:{tenant1}:used quota:{tenant1}:ops , op-001 10 100 3600
redis-cli --eval quota-consume.lua quota:{tenant1}:used quota:{tenant1}:ops , op-001 10 100 3600
```

Expected:

```text
First: ACCEPTED, 10
Second: DUPLICATE, 10
```

This is retry-safe.

---

## 39. Production Implementation Blueprint

Untuk memakai Lua secara production-grade di Java service:

```text
1. Identify atomicity problem.
2. Design key schema with cluster hash tags.
3. Write script as resource file.
4. Define KEYS and ARGV contract.
5. Define return shape.
6. Create typed Java command object.
7. Create typed Java result object.
8. Implement script gateway.
9. Add metrics around gateway.
10. Add integration tests with Testcontainers.
11. Add failure tests for duplicate/timeout-ish retry if possible.
12. Review script complexity.
13. Add runbook entry.
14. Deploy with versioned script name.
15. Monitor slowlog and script errors.
```

Example package layout:

```text
com.example.enforcement.redis
  RedisQuotaEnforcer.java
  RedisIdempotencyStore.java
  RedisLockService.java

com.example.enforcement.redis.script
  RedisScriptLoader.java
  RateLimitScripts.java
  IdempotencyScripts.java

src/main/resources/redis-scripts
  quota-consume-v1.lua
  rate-limit-fixed-window-v1.lua
  idempotency-start-v1.lua
  lock-release-v1.lua
```

---

## 40. Decision Framework

Gunakan Lua jika semua ini benar:

```text
- Butuh multi-step Redis operation.
- Ada race condition nyata jika dilakukan dari client.
- Logic kecil dan bounded.
- Semua key diketahui di awal.
- Key berada di slot yang sama untuk cluster.
- Return contract jelas.
- Retry behavior dipikirkan.
- Script bisa dites dan dimonitor.
```

Jangan gunakan Lua jika:

```text
- Hanya butuh performance batching.
- Logic bisa diselesaikan dengan single Redis command.
- Butuh external I/O.
- Logic domain panjang.
- Data yang diproses besar/tidak bounded.
- Team tidak punya operability untuk script.
```

---

## 41. Summary Mental Model

Lua scripting adalah fitur yang sangat powerful karena membawa computation ke Redis server dan menjalankannya secara atomic.

Tetapi kekuatannya datang dengan risiko:

```text
More atomicity, less interleaving.
Less network latency, more server-side blast radius.
More correctness for small state transitions, more danger for unbounded logic.
```

Redis Lua yang baik biasanya terlihat membosankan:

```text
- 10 sampai 50 baris
- KEYS eksplisit
- ARGV eksplisit
- return array stabil
- operasi bounded
- tidak ada business workflow panjang
- tidak ada scan besar
- tidak ada dynamic hidden key
```

Sebagai Java engineer, tujuan Anda bukan menjadi Lua programmer. Tujuan Anda adalah tahu kapan logika kecil harus dipindahkan ke Redis agar race hilang, dan kapan logika harus tetap di Java/database/workflow layer karena Redis bukan tempat yang tepat.

---

## 42. Checklist Review Script

Sebelum merge PR yang menambah Lua script, review:

```text
Correctness:
- Apakah script benar-benar atomic untuk race yang ditargetkan?
- Apakah partial failure dipikirkan?
- Apakah timeout retry aman?
- Apakah return contract stabil?

Key design:
- Apakah semua key lewat KEYS?
- Apakah hash tag cluster benar?
- Apakah key ownership jelas?

Performance:
- Apakah command complexity bounded?
- Apakah ada big key risk?
- Apakah loop punya limit?
- Apakah script bisa muncul di slowlog?

Operations:
- Apakah script versioned?
- Apakah ada metric per script?
- Apakah ada integration test?
- Apakah ada rollback plan?

Security:
- Apakah script body static dan reviewed?
- Apakah aplikasi memang butuh permission scripting?
- Apakah tidak ada dangerous command?
```

---

## 43. Apa yang Tidak Dibahas Mendalam di Part Ini

Part ini sengaja tidak membahas Redis Functions secara mendalam karena itu akan menjadi Part 015.

Perbedaan singkat:

```text
Lua script / EVAL:
- ephemeral script
- dikirim/load oleh client
- cocok untuk app-level atomic helper

Redis Functions:
- library/function registered di Redis
- lifecycle lebih server-side
- lebih cocok untuk programmability yang dikelola sebagai database artifact
```

Kita akan bahas kapan Redis Functions lebih cocok, bagaimana versioning/deployment-nya, dan risiko operasionalnya di bagian berikutnya.

---

## 44. Referensi

- Redis Documentation — Scripting with Lua.
- Redis Documentation — EVAL command.
- Redis Documentation — SCRIPT LOAD command.
- Redis Documentation — Redis Lua API Reference.
- Redis Documentation — Redis Programmability.
- Spring Data Redis Documentation — Scripting.
- Spring Data Redis API — RedisScript.

---

## 45. Status Seri

```text
Part 014 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-015.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Distributed Locks: Useful, Dangerous, Often Misused</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-015.md">Part 015 — Redis Functions dan Programmability Modern ➡️</a>
</div>
