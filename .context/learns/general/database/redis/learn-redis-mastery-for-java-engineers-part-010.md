# learn-redis-mastery-for-java-engineers-part-010.md

# Part 010 — Cache Architecture II: Consistency, Invalidation, Stampede, Hot Key

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `010 / 034`  
> Fokus: cache consistency, invalidation, stampede prevention, hot-key mitigation, failure modeling, dan desain cache Redis untuk Java backend services.

---

## 0. Posisi Bagian Ini Dalam Seri

Di bagian sebelumnya kita membahas **cache-aside** sebagai pola dasar:

```text
read request
  -> check Redis
  -> if hit: return cached value
  -> if miss: load from source of truth
  -> write to Redis with TTL
  -> return value
```

Pola itu sederhana, tetapi sistem produksi jarang gagal karena engineer tidak tahu cara memanggil `GET` atau `SET`. Sistem produksi lebih sering gagal karena kontraknya tidak jelas:

- apakah stale data boleh terjadi?
- berapa lama stale data masih dapat diterima?
- siapa yang bertanggung jawab melakukan invalidation?
- apakah cache boleh mengembalikan data setelah write berhasil?
- apa yang terjadi jika cache miss bersamaan pada hot key?
- apakah cache akan melindungi database atau justru menggandakan spike?
- apa yang terjadi jika Redis lambat, down, failover, atau penuh memory?
- apakah retry ke Redis membuat latency lebih buruk?
- apakah local cache tiap instance membuat consistency makin sulit?

Bagian ini membahas Redis cache bukan sebagai teknik optimasi kecil, tetapi sebagai **subsystem correctness + performance**.

Kita akan melihat cache sebagai komponen yang selalu berada di antara dua kekuatan:

```text
Performance wants: fewer database calls, lower latency, higher throughput.
Correctness wants: fresh data, predictable invalidation, bounded inconsistency.
Operations wants: stable memory, safe failure modes, observable behavior.
```

Cache yang bagus bukan cache yang selalu cepat. Cache yang bagus adalah cache yang:

1. punya kontrak staleness eksplisit,
2. tidak membuat source of truth overload saat gagal,
3. tidak menyembunyikan correctness bug,
4. dapat dioperasikan saat traffic nyata,
5. aman ketika Redis bukan dalam kondisi ideal.

---

## 1. Mental Model: Cache Adalah Replica Tidak Lengkap

Kesalahan pertama dalam desain cache adalah menganggap cache sebagai “copy sementara” tanpa konsekuensi. Mental model yang lebih akurat:

> Cache adalah replica parsial, materialized, dan sengaja tidak sepenuhnya konsisten dari source of truth.

Redis cache biasanya memiliki karakteristik:

| Dimensi | Source of Truth | Redis Cache |
|---|---|---|
| Otoritas data | authoritative | derived |
| Durability | tinggi | tergantung konfigurasi, sering tidak dijadikan dasar correctness |
| Completeness | lengkap | parsial |
| Freshness | paling baru | bisa stale |
| Lifecycle | domain-driven | TTL/invalidation-driven |
| Query model | fleksibel/relasional/document | key lookup/data structure spesifik |
| Failure assumption | harus survive | boleh degrade, tergantung desain |

Konsekuensi penting:

```text
Jika cache adalah replica, maka semua masalah replica juga ada:
- replication lag secara konseptual
- stale reads
- invalidation ordering
- partial update
- lost invalidation
- split ownership
- bootstrap/warm-up
- recovery after outage
```

Walaupun Redis cache tidak sama dengan database replica, secara arsitektur ia tetap membawa problem serupa: **ada lebih dari satu tempat yang bisa menjawab pertanyaan tentang data**.

---

## 2. Cache Correctness Bukan Binary

Banyak diskusi cache jatuh pada pertanyaan yang terlalu kasar:

```text
“Apakah cache konsisten?”
```

Pertanyaan yang lebih berguna:

```text
“Jenis inconsistency apa yang mungkin terjadi, seberapa lama, pada user/action apa, dan apakah itu boleh?”
```

Contoh:

| Use Case | Stale 5 detik | Stale 5 menit | Stale 1 jam |
|---|---:|---:|---:|
| Product catalog description | biasanya boleh | mungkin boleh | kadang boleh |
| Product price checkout | berisiko | buruk | tidak boleh |
| User profile avatar | boleh | boleh | mungkin boleh |
| Account balance | tidak boleh | tidak boleh | tidak boleh |
| Feature entitlement | tergantung | berisiko | buruk |
| Rate-limit quota | biasanya tidak boleh untuk enforcement ketat | tidak boleh | tidak boleh |
| Dashboard aggregate | boleh | tergantung | tergantung |
| Regulatory case status | berisiko | buruk | tidak boleh tanpa label freshness |

Jadi desain cache perlu memulai dari klasifikasi data:

```text
Data category:
  - immutable
  - append-mostly
  - rarely changing
  - frequently changing
  - user-critical
  - money/security/regulatory-critical
  - derived aggregate
  - transient session-like state
```

Cache untuk immutable data sangat berbeda dari cache untuk mutable entitlement.

---

## 3. Empat Kontrak Dasar Cache

Untuk setiap cache, definisikan empat kontrak ini.

### 3.1 Ownership Contract

Pertanyaan:

```text
Siapa pemilik data asli?
Siapa boleh menulis source of truth?
Siapa boleh menulis cache?
Siapa boleh menghapus cache?
Apakah cache boleh diisi dari lebih dari satu service?
```

Desain buruk:

```text
service-a writes customer:123
service-b writes customer:123
service-c deletes customer:123
batch-job warms customer:123 with a different JSON shape
```

Desain lebih baik:

```text
customer-service owns customer read model cache.
Only customer-service writes customer cache keys.
Other services read via API or explicit published projection.
```

Redis key harus punya owner konseptual.

```text
cache:{bounded-context}:{entity}:{id}:{view-version}
```

Contoh:

```text
cache:customer:profile:v3:customer-123
cache:case:summary:v2:case-981
cache:product:detail:v5:sku-ABC
```

### 3.2 Freshness Contract

Pertanyaan:

```text
Berapa lama data boleh stale?
Apakah user perlu tahu data stale?
Apakah write harus langsung terlihat pada read berikutnya?
```

Bentuk kontrak:

```text
Product detail cache may be stale for up to 10 minutes.
User permission cache must be invalidated within 5 seconds after role change.
Case status page must not use cache after state transition commit.
Dashboard aggregate is eventually consistent within 15 minutes.
```

### 3.3 Failure Contract

Pertanyaan:

```text
Jika Redis down, apakah request fail closed, fail open, bypass cache, atau degrade?
```

Contoh:

| Use Case | Redis Down Behavior |
|---|---|
| Product catalog cache | bypass to DB with throttling |
| Login session store | fail request jika Redis adalah session authority |
| Rate limiter for public API | tergantung: fail open atau fail closed |
| Permission cache | fallback ke DB, jangan pakai stale local cache tanpa batas |
| Idempotency key | fail closed untuk endpoint non-idempotent kritikal |

### 3.4 Observability Contract

Pertanyaan:

```text
Bagaimana kita tahu cache bekerja?
Bagaimana kita tahu cache membuat data stale?
Bagaimana kita tahu source DB sedang diserang oleh cache miss storm?
```

Minimal metrics:

```text
cache_hit_total{cache_name}
cache_miss_total{cache_name}
cache_error_total{cache_name,error_type}
cache_load_duration_seconds{cache_name}
cache_set_total{cache_name}
cache_evict_or_delete_total{cache_name,reason}
cache_value_size_bytes{cache_name}
cache_stampede_suppressed_total{cache_name}
cache_stale_served_total{cache_name}
cache_bypass_total{cache_name,reason}
```

---

## 4. Read-After-Write: Problem Yang Sering Diremehkan

Misalkan service punya endpoint:

```http
PUT /customers/123
GET /customers/123
```

User melakukan update nama customer, lalu langsung membuka halaman detail. Apa yang terjadi?

### 4.1 Timeline Buruk

```text
T1: GET /customers/123
    Redis hit -> returns old value

T2: PUT /customers/123
    DB update commit succeeds
    cache invalidation fails silently

T3: GET /customers/123
    Redis hit -> returns old value until TTL expires
```

Bug ini berbahaya karena:

- database benar,
- update API benar,
- Redis sehat,
- tetapi user melihat data lama.

### 4.2 Strategi Read-Your-Write

Ada beberapa pilihan.

#### Opsi A — Delete Cache Setelah Commit

```text
write DB
if commit ok:
  delete cache key
```

Read berikutnya akan miss dan reload.

Kelebihan:

- sederhana,
- umum,
- tidak perlu membangun payload cache di write path.

Kekurangan:

- delete bisa gagal,
- race dengan read concurrent,
- cache kosong menyebabkan load spike jika banyak write.

#### Opsi B — Update Cache Setelah Commit

```text
write DB
if commit ok:
  set cache key to new representation
```

Kelebihan:

- read berikutnya cepat,
- mengurangi miss setelah write.

Kekurangan:

- write path harus tahu representation cache,
- raw domain write dan read projection jadi coupled,
- partial update bisa salah,
- lebih rawan schema mismatch.

#### Opsi C — Bypass Cache Setelah Write Untuk Session/User Tertentu

```text
After user writes entity X,
for a short window, that user reads X from DB/source directly.
```

Kelebihan:

- cocok untuk read-your-write UX,
- tidak perlu global consistency.

Kekurangan:

- stateful logic di application,
- lebih kompleks pada multi-instance.

#### Opsi D — Versioned Cache

```text
DB row has version = 42.
Cache key includes version or cache value includes version.
Read path validates expected version.
```

Kelebihan:

- bisa mendeteksi stale value,
- cocok untuk correctness-sensitive flows.

Kekurangan:

- butuh metadata version,
- read path lebih mahal,
- perlu cleanup old versions.

---

## 5. Invalidation: Dua Hard Things Dalam Satu Tempat

Ada pepatah terkenal bahwa dua hal sulit dalam computer science adalah cache invalidation, naming things, dan off-by-one errors. Untuk Redis, invalidation sulit karena menggabungkan:

1. **knowledge problem**: key apa saja yang dipengaruhi oleh perubahan data ini?
2. **ordering problem**: invalidation terjadi sebelum atau sesudah update source of truth?
3. **delivery problem**: apakah invalidation pasti sampai?
4. **race problem**: apakah cache bisa terisi ulang dengan data lama setelah invalidation?
5. **scope problem**: apakah invalidation terlalu sempit atau terlalu luas?

### 5.1 Invalidation by TTL Only

Paling sederhana:

```text
Tidak pernah delete cache secara eksplisit.
Biarkan TTL membuat data hilang.
```

Cocok untuk:

- data rarely changing,
- stale data acceptable,
- dashboard aggregate,
- catalog metadata non-critical,
- feature content yang tidak security-critical.

Tidak cocok untuk:

- permission,
- account state,
- price at checkout,
- regulatory workflow status,
- data yang user baru saja ubah.

### 5.2 Explicit Delete

```text
DEL cache:customer:profile:v3:customer-123
```

Cocok untuk cache-aside umum.

Problem:

```text
What if there are multiple derived keys?
```

Contoh update customer mempengaruhi:

```text
cache:customer:profile:v3:customer-123
cache:customer:summary:v2:customer-123
cache:account:customer-list:v4:account-77:page-1
cache:case:participant:v1:case-981:customer-123
```

Jika invalidation logic tidak punya dependency map, sebagian cache akan stale.

### 5.3 Write New Value

```text
SET cache:key newValue EX ttl
```

Ini bukan invalidation, tapi refresh.

Cocok jika:

- write path sudah punya canonical read representation,
- representation sederhana,
- cache key tunggal,
- transform murah.

Risk:

- cache bisa diverge dari DB jika transform beda dari read loader,
- write path menjadi terlalu berat.

### 5.4 Versioned Key Invalidation

Daripada delete key lama, buat key baru:

```text
cache:product:detail:v5:sku-ABC:dataVersion-103
```

Atau simpan pointer:

```text
product:sku-ABC:currentVersion -> 103
product:sku-ABC:detail:103 -> payload
```

Kelebihan:

- stale key tidak akan dipakai jika caller tahu version terbaru,
- useful untuk immutable projection,
- race lebih mudah dikendalikan.

Kekurangan:

- perlu cleanup old versions,
- read path bisa butuh dua lookup,
- version source harus authoritative.

### 5.5 Event-Based Invalidation

Write service publish event:

```text
CustomerUpdated(customerId=123, version=42)
```

Cache invalidator consume event:

```text
DEL cache:customer:profile:v3:customer-123
DEL cache:customer:summary:v2:customer-123
```

Kelebihan:

- decouple write path dari cache detail,
- bisa memproses banyak derived cache,
- cocok untuk multi-service.

Kekurangan:

- eventual consistency,
- lost/delayed event problem,
- ordering harus jelas,
- membutuhkan idempotent invalidation.

Karena kamu sudah punya seri Kafka/RabbitMQ, kita tidak akan mengulang messaging detail. Yang penting untuk Redis cache:

```text
Invalidation event must be treated as a correctness signal.
If event delivery is best-effort only, TTL must bound damage.
```

---

## 6. Race Condition Dalam Cache-Aside

Cache-aside tampak sederhana, tetapi punya race klasik.

### 6.1 Race: Delete Then Old Fill

Timeline:

```text
T1: Reader A GET cache -> miss
T2: Reader A reads DB -> old value v1
T3: Writer updates DB -> v2
T4: Writer DEL cache
T5: Reader A SET cache -> v1
T6: Future readers get stale v1 until TTL
```

Ini sering terjadi ketika read DB lama berjalan bersamaan dengan write.

### 6.2 Mitigasi

#### Mitigasi 1 — Short TTL

Membatasi durasi stale.

```text
Damage window <= TTL
```

Tetapi TTL pendek meningkatkan miss rate.

#### Mitigasi 2 — Version Check

Cache value membawa version:

```json
{
  "version": 42,
  "data": {...}
}
```

Jika loader membaca DB version lama, write cache hanya jika masih valid.

Secara sederhana:

```text
loaded = db.read(id)
currentVersion = db.readVersion(id) or known version source
if loaded.version == currentVersion:
  redis.set(cacheKey, loaded)
else:
  do not cache
```

Masalahnya ini bisa menambah query.

#### Mitigasi 3 — Write Timestamp / Logical Clock

Cache fill hanya boleh jika fill-start lebih baru dari invalidation marker.

Contoh:

```text
cache:data:customer-123 -> payload
cache:invalidatedAt:customer-123 -> 1710000000000
```

Reader:

```text
loadStartedAt = now()
value = db.load()
invalidatedAt = redis.get(marker)
if invalidatedAt == null or loadStartedAt > invalidatedAt:
    set cache
else:
    skip cache set
```

Ini lebih kompleks dan bergantung pada clock.

#### Mitigasi 4 — Single Writer/Loader Per Key

Gunakan lock/mutex untuk mencegah banyak loader bersamaan. Ini juga membantu stampede.

---

## 7. Double Delete Pattern

Double delete biasanya dijelaskan begini:

```text
DEL cache
write DB
sleep small delay
DEL cache again
```

Atau variasi yang lebih umum:

```text
write DB
DEL cache
wait short interval
DEL cache again
```

Tujuannya mengurangi kemungkinan stale fill akibat race.

### 7.1 Kenapa Bisa Membantu

Misalkan ada reader yang membaca DB lama lalu mengisi cache setelah delete pertama. Delete kedua membersihkan stale fill tersebut.

### 7.2 Kenapa Ini Bukan Solusi Ajaib

Double delete punya kelemahan:

- delay sulit ditentukan,
- tidak menjamin jika load sangat lambat,
- menambah operasi Redis,
- sleep di request path buruk,
- async delayed delete bisa hilang jika worker mati,
- tidak menggantikan versioning untuk data kritikal.

Double delete boleh menjadi mitigasi pragmatic untuk cache-aside, tetapi bukan correctness guarantee.

Untuk sistem yang butuh defensibility tinggi, lebih baik gunakan:

```text
- versioned data
- event-driven invalidation dengan retry
- short bounded TTL
- source-of-truth fallback untuk critical reads
- explicit consistency contract
```

---

## 8. Write-Through, Write-Behind, Refresh-Ahead

Cache-aside bukan satu-satunya pola.

### 8.1 Write-Through

Write request menulis source of truth dan cache dalam satu flow:

```text
client -> service
service -> DB write
service -> Redis write
return success
```

Kelebihan:

- cache lebih fresh,
- read setelah write sering hit.

Kekurangan:

- write latency bertambah,
- failure handling rumit,
- jika Redis write gagal setelah DB commit, cache tetap stale/missing,
- representation cache harus diketahui write path.

Gunakan untuk:

- read-heavy entity,
- representation sederhana,
- write volume tidak terlalu tinggi,
- freshness penting tapi bukan transaksi global.

### 8.2 Write-Behind

Write masuk ke cache/queue dulu, lalu source of truth diupdate async.

```text
client -> service
service -> Redis/intermediate buffer
async worker -> DB
```

Ini berbahaya jika Redis tidak dirancang sebagai durable write buffer.

Risiko:

- data loss,
- write ordering,
- duplicate write,
- recovery complexity,
- audit gap.

Untuk Java backend enterprise/regulatory, write-behind ke Redis harus diperlakukan sangat hati-hati. Biasanya lebih aman memakai durable log/broker/database outbox untuk write-behind.

### 8.3 Refresh-Ahead

Cache diperbarui sebelum expired.

```text
if ttl remaining < threshold:
    trigger async refresh
return current cached value
```

Kelebihan:

- mengurangi miss latency,
- mencegah stampede saat expiry,
- cocok untuk hot keys.

Kekurangan:

- bisa refresh data yang tidak lagi dipakai,
- perlu background worker,
- stale data tetap mungkin,
- perlu protection agar refresh tidak paralel banyak.

### 8.4 Stale-While-Revalidate

Jika cache ada tapi mendekati/lebih dari soft TTL:

```text
return stale value
trigger refresh in background
```

Dengan dua TTL:

```text
softTtl = 60 seconds
hardTtl = 300 seconds
```

Behavior:

```text
age <= softTtl:
    return cached fresh

softTtl < age <= hardTtl:
    return cached stale
    trigger async refresh

age > hardTtl:
    block and load from source, or fail/degrade
```

Redis key TTL bisa diset ke hard TTL, sementara soft TTL disimpan di payload.

Contoh payload:

```json
{
  "cachedAtEpochMs": 1710000000000,
  "softExpireAtEpochMs": 1710000060000,
  "hardExpireAtEpochMs": 1710000300000,
  "data": {...}
}
```

Ini sangat berguna untuk hot key karena menghindari synchronized miss.

---

## 9. Cache Stampede

Cache stampede terjadi ketika banyak request serentak mengalami miss untuk key yang sama dan semuanya load ke source of truth.

Redis docs cache-aside juga menyoroti bahwa saat key populer expired di bawah concurrency tinggi, banyak proses dapat secara bersamaan query database untuk record yang sama, sehingga caching justru memperbesar spike.

### 9.1 Timeline Stampede

```text
T0: key product:ABC exists in Redis
T1: key expires
T2: 5,000 requests arrive
T3: all see cache miss
T4: all query DB
T5: DB overloaded
T6: app timeouts
T7: retries multiply load
```

Cache yang tadinya melindungi DB berubah menjadi amplifier.

### 9.2 Root Causes

- TTL banyak key expire bersamaan.
- Hot key tanpa refresh-ahead.
- No request coalescing.
- No load lock.
- Retry storm.
- DB query mahal.
- Cache miss path tidak dibatasi.
- Redis outage membuat semua traffic bypass ke DB.

---

## 10. Stampede Prevention Patterns

### 10.1 Jittered TTL

Jangan beri TTL sama untuk banyak key.

Buruk:

```java
Duration ttl = Duration.ofMinutes(10);
```

Lebih baik:

```java
Duration baseTtl = Duration.ofMinutes(10);
Duration jitter = Duration.ofSeconds(ThreadLocalRandom.current().nextInt(0, 120));
Duration ttl = baseTtl.plus(jitter);
```

Atau jitter negatif/positif:

```text
TTL = baseTTL +/- random(0..jitterWindow)
```

Tujuannya menyebarkan expiry.

### 10.2 Per-Key Mutex

Saat miss, hanya satu request yang load DB.

```text
GET cache:key -> miss
SET lock:cache:key token NX PX 5000
if lock acquired:
    load DB
    SET cache:key value EX ttl
    release lock safely
else:
    wait briefly and retry cache
```

Pseudocode:

```java
public Value getWithMutex(String key) {
    Value cached = redis.get(key);
    if (cached != null) return cached;

    String lockKey = "lock:" + key;
    String token = UUID.randomUUID().toString();

    boolean locked = redis.set(lockKey, token, SetArgs.Builder.nx().px(5000));

    if (locked) {
        try {
            Value again = redis.get(key);
            if (again != null) return again;

            Value loaded = db.load();
            redis.setex(key, ttlWithJitter(), serialize(loaded));
            return loaded;
        } finally {
            releaseLockWithLua(lockKey, token);
        }
    }

    sleepSmallRandomDelay();
    Value afterWait = redis.get(key);
    if (afterWait != null) return afterWait;

    // controlled fallback, not infinite waiting
    return db.loadWithRateLimitOrFailFast();
}
```

Important:

- lock TTL harus lebih besar dari expected load time,
- unlock harus token-safe,
- jangan tunggu lock tanpa batas,
- jangan retry agresif,
- fallback harus dibatasi.

Distributed lock detail akan dibahas lebih dalam di Part 013.

### 10.3 Request Coalescing Dalam Instance

Sebelum lock Redis, lakukan coalescing lokal.

Dalam satu JVM instance:

```text
ConcurrentHashMap<CacheKey, CompletableFuture<Value>> inFlightLoads
```

Jika 100 request untuk key sama masuk ke instance yang sama, cukup satu load.

Pseudocode:

```java
public CompletableFuture<Value> get(String key) {
    Value cached = redis.get(key);
    if (cached != null) {
        return CompletableFuture.completedFuture(cached);
    }

    return inFlight.computeIfAbsent(key, ignored ->
        CompletableFuture.supplyAsync(() -> loadAndCache(key))
            .whenComplete((v, e) -> inFlight.remove(key))
    );
}
```

Kelebihan:

- mengurangi load tanpa network lock,
- cepat,
- cocok untuk hot key.

Kekurangan:

- hanya per instance,
- tetap perlu proteksi cross-instance.

### 10.4 Probabilistic Early Refresh

Daripada semua request refresh saat TTL habis, sebagian request refresh lebih awal berdasarkan probabilitas.

Konsep:

```text
Semakin dekat expiry, semakin besar peluang satu request memicu refresh.
```

Simplified:

```java
long remainingMs = redis.pttl(key);
if (remainingMs < earlyRefreshWindowMs) {
    double probability = 1.0 - ((double) remainingMs / earlyRefreshWindowMs);
    if (random.nextDouble() < probability) {
        triggerAsyncRefreshIfNotAlreadyRunning(key);
    }
}
```

Kelebihan:

- expiry tidak meledak bersamaan,
- hot key tetap hangat,
- tidak semua request blocking.

Kekurangan:

- lebih kompleks,
- perlu guard agar refresh tidak paralel.

### 10.5 Stale-While-Revalidate

Sudah dibahas di atas. Ini salah satu pola terbaik untuk read-heavy data yang boleh stale sebentar.

```text
Return stale data quickly.
Refresh in background.
Bound staleness with hard TTL.
```

### 10.6 Negative Cache

Jika DB mengatakan data tidak ada, cache hasil “not found”.

```text
GET user:999 -> miss
DB -> not found
SET cache:user:999:null-marker EX 30s
```

Mencegah repeated miss untuk ID invalid.

Hati-hati:

- TTL negative cache harus pendek,
- jika entity bisa dibuat setelah not-found, stale negative result bisa menyembunyikan data baru,
- marker harus beda dari Redis null/missing.

### 10.7 Bounded Cache Bypass

Jika Redis down, jangan langsung melepas seluruh traffic ke DB.

Gunakan:

- circuit breaker,
- concurrency limit,
- rate limit ke DB,
- fail fast untuk non-critical request,
- serve stale local cache jika acceptable,
- degrade response.

Tanpa ini, Redis outage bisa menjadi DB outage.

---

## 11. Hot Key Problem

Hot key adalah key yang menerima traffic sangat tinggi dibanding key lain.

Contoh:

```text
cache:homepage:v1
cache:config:global:v9
cache:product:detail:v5:sku-popular
cache:feature-flags:tenant-big
cache:exchange-rate:USD-IDR
cache:case:dashboard:today
```

### 11.1 Kenapa Hot Key Berbahaya

Redis single command execution sangat cepat, tetapi hot key tetap bisa menjadi masalah:

- saturasi network pada node tertentu,
- satu cluster slot/node terlalu panas,
- replica overload jika read scaling tidak benar,
- client-side connection bottleneck,
- CPU command serialization/deserialization tinggi,
- large payload memperburuk bandwidth,
- expiry menyebabkan stampede besar.

Dalam Redis Cluster, hot key lebih buruk karena key tunggal hanya berada di satu hash slot dan satu primary shard.

### 11.2 Deteksi Hot Key

Sinyal:

```text
- satu endpoint latency naik tetapi Redis CPU tidak selalu tinggi
- commandstats GET sangat dominan
- network egress tinggi dari satu Redis node
- DB spike saat satu key expire
- slow app serialization/deserialization
- cache hit tinggi tapi latency tetap buruk
- satu key muncul di sampling hotkeys
```

Tools/approach:

```text
redis-cli --hotkeys
redis-cli --bigkeys
INFO commandstats
latency monitoring
client-side metrics per cache key family
application tracing tags: cache_name, key_family, hit/miss
```

Jangan expose full key dengan PII ke metrics. Gunakan key family/template:

```text
cache:product:detail:v5:{id}
cache:customer:profile:v3:{id}
```

---

## 12. Hot Key Mitigation

### 12.1 Local In-Process Cache

Tambahkan local cache di JVM untuk extremely hot, small, mostly-read data.

```text
request -> Caffeine local cache -> Redis -> DB
```

Kelebihan:

- latency sangat rendah,
- mengurangi Redis load,
- efektif untuk config/reference data.

Kekurangan:

- consistency makin sulit,
- tiap instance punya copy,
- invalidation perlu strategi,
- memory app bertambah.

Pola umum:

```text
Local cache TTL: 1-10 seconds
Redis cache TTL: minutes
DB/source: authoritative
```

Ini memberi bounded staleness kecil tanpa invalidation kompleks.

### 12.2 Server-Assisted Client-Side Caching

Redis mendukung client-side caching/tracking, di mana server melacak key yang pernah dibaca client dan dapat mengirim invalidation saat key berubah. Pada RESP3, invalidation dapat dikirim pada koneksi yang sama; pada mode redirect dapat menggunakan koneksi lain/Pub/Sub.

Mental model:

```text
App local cache stores values.
Redis tracks what keys this client read.
When key changes, Redis sends invalidation.
Client evicts local value.
```

Kelebihan:

- mengurangi round-trip Redis,
- consistency lebih baik daripada pure local TTL,
- cocok untuk read-heavy hot keys.

Kekurangan:

- client support/config harus matang,
- invalidation delivery harus dipahami,
- memory tracking di Redis punya biaya,
- behavior saat disconnect harus aman,
- tidak semua Java stack memakainya secara transparan.

Untuk sistem kritikal, tetap gunakan TTL kecil sebagai safety net.

### 12.3 Key Sharding / Replicated Value Shards

Untuk read hot key, kadang value disalin ke beberapa key:

```text
cache:homepage:v1:shard:0
cache:homepage:v1:shard:1
cache:homepage:v1:shard:2
cache:homepage:v1:shard:3
```

Client memilih random shard untuk read.

Kelebihan:

- menyebar read load,
- di Redis Cluster bisa menyebar ke beberapa slots jika tidak memakai hash tag yang sama.

Kekurangan:

- invalidation harus hapus semua shards,
- memory multiply,
- write/update lebih mahal,
- consistency antar shard bisa berbeda.

Gunakan untuk:

- value kecil,
- read sangat besar,
- stale acceptable,
- update jarang.

Jangan gunakan untuk:

- mutable critical data,
- value besar,
- key dengan update sering.

### 12.4 Split Payload

Jika hot key punya payload besar, pecah menjadi:

```text
cache:product:summary:sku-ABC
cache:product:price:sku-ABC
cache:product:inventory:sku-ABC
cache:product:reviews-summary:sku-ABC
```

Tujuannya:

- request tidak selalu mengambil semua data,
- invalidation lebih presisi,
- value size lebih kecil,
- network egress turun.

Tapi terlalu banyak key bisa meningkatkan round-trip. Gunakan pipelining/MGET bila cocok.

### 12.5 Replica Read

Untuk read-heavy workloads, bisa baca dari replicas.

Trade-off:

- mengurangi primary load,
- read bisa stale karena async replication,
- failover/topology handling perlu client-aware,
- tidak cocok untuk read-your-write critical path.

### 12.6 Pre-Warming

Untuk key yang diprediksi hot:

```text
on deploy/startup/schedule/event:
    compute common keys
    populate Redis before user traffic hits
```

Contoh:

- homepage,
- top products,
- active feature flags,
- reference data,
- tenant config besar.

Pre-warming harus punya guard:

```text
- do not warm everything blindly
- rate limit DB load
- track warm success/failure
- avoid synchronized warm across all app instances
```

---

## 13. Redis Failure Mode Dalam Cache Architecture

### 13.1 Redis Down

Naive behavior:

```text
Redis GET fails -> app loads DB for every request
```

Jika traffic tinggi, DB bisa ikut down.

Better behavior:

```text
Redis failure detected
circuit breaker opens
only allow limited DB fallback
serve degraded response for non-critical data
use local stale cache if contract allows
emit alert
```

### 13.2 Redis Slow

Redis slow lebih berbahaya daripada Redis down karena request bisa menggantung.

Desain timeout:

```text
cache timeout must be lower than service timeout budget
```

Contoh:

```text
API SLO p95: 200ms
DB fallback p95: 80ms
Redis timeout: 20-30ms, not 2 seconds
```

Jika cache call timeout 2 detik, cache sudah menjadi liability.

### 13.3 Redis Failover

Saat failover:

- koneksi putus,
- command in-flight bisa gagal,
- write terakhir bisa hilang jika replica belum menerima,
- client topology refresh perlu waktu,
- app retry bisa membuat spike.

Cache layer harus menganggap Redis write tidak selalu berhasil.

### 13.4 Redis Memory Full

Jika `maxmemory-policy noeviction`, write cache bisa gagal.

Jika eviction aktif, key bisa hilang lebih cepat dari TTL.

Aplikasi harus memperlakukan missing cache sebagai normal, tetapi juga harus memonitor:

```text
- evicted_keys
- used_memory
- mem_fragmentation_ratio
- keyspace_hits/misses
- rejected_connections
- command latency
```

### 13.5 Partial Serialization Failure

Java service bisa gagal serialize/deserialize karena:

- class version berubah,
- field type berubah,
- enum value berubah,
- payload terlalu besar,
- compression mismatch,
- serializer config beda antar service.

Strategi:

```text
- include schema version in key or payload
- prefer explicit JSON/Protobuf with version discipline
- avoid native Java serialization
- on deserialization failure: delete key and reload, if safe
- metric cache_deserialization_error_total
```

---

## 14. Cache Policy Matrix

Gunakan matrix ini saat memilih strategi.

| Data Type | Staleness Tolerance | Suggested Pattern | TTL | Invalidation |
|---|---:|---|---:|---|
| Immutable reference | tinggi | cache-aside | panjang | versioned key |
| Product description | sedang | cache-aside + TTL jitter | menit-jam | delete/update on change |
| Product price display | rendah-sedang | cache-aside + explicit invalidation | pendek | event/delete |
| Checkout price | sangat rendah | source-of-truth read | none/very short | avoid cache or validate |
| User profile | sedang | cache-aside | menit | delete after update |
| Permission/entitlement | rendah | short TTL + explicit invalidation | detik-menit | event/delete |
| Dashboard aggregate | tinggi | refresh-ahead/stale-while-revalidate | menit | scheduled refresh |
| Rate limiter state | correctness-sensitive | Redis as operational state | short window | no cache-aside |
| Idempotency key | correctness-sensitive | Redis primitive | request-defined | TTL lifecycle |
| Session | depends | Redis as state store | session TTL | explicit logout delete |

---

## 15. Java Implementation Blueprint: Explicit Cache Layer

Jangan biarkan caching logic tersebar di controller/service secara acak.

Struktur yang lebih maintainable:

```text
CustomerService
  -> CustomerRepository        // DB/source of truth
  -> CustomerCache             // Redis cache policy
  -> CustomerReadModelMapper   // domain -> cache DTO
```

### 15.1 Cache Interface

```java
public interface CustomerProfileCache {
    Optional<CachedCustomerProfile> get(CustomerId id);
    void put(CustomerId id, CachedCustomerProfile value, Duration ttl);
    void evict(CustomerId id);
}
```

### 15.2 Cache Key Builder

```java
public final class CustomerCacheKeys {
    private static final String PREFIX = "cache:customer:profile:v3";

    private CustomerCacheKeys() {}

    public static String profile(CustomerId id) {
        return PREFIX + ":" + id.value();
    }
}
```

Do not build keys inline everywhere.

### 15.3 Read Path

```java
public CustomerProfile getProfile(CustomerId id) {
    Optional<CachedCustomerProfile> cached = cache.get(id);
    if (cached.isPresent()) {
        metrics.cacheHit("customer.profile");
        return cached.get().toDomainView();
    }

    metrics.cacheMiss("customer.profile");

    Customer customer = repository.findById(id)
        .orElseThrow(CustomerNotFoundException::new);

    CachedCustomerProfile value = mapper.toCachedProfile(customer);
    cache.put(id, value, ttlPolicy.customerProfileTtl(id));

    return value.toDomainView();
}
```

### 15.4 Write Path

```java
@Transactional
public void updateProfile(CustomerId id, UpdateCustomerProfileCommand command) {
    Customer customer = repository.getForUpdate(id);
    customer.updateProfile(command);
    repository.save(customer);

    afterCommit(() -> cache.evict(id));
}
```

Important:

```text
Evict after DB commit, not before commit.
```

In Spring, use transaction synchronization or domain event after commit.

### 15.5 Why After Commit Matters

Bad:

```text
DEL cache
DB transaction later rolls back
future read reloads old DB value, maybe okay but noisy
```

Worse:

```text
DB commit succeeds but cache delete was done before commit
concurrent reader reloads old value during transaction
cache now contains old value
```

Better:

```text
DB commit succeeds
then evict cache
future read reloads committed value
```

Still not perfect under all races, but better.

---

## 16. Spring Cache Abstraction: Useful But Dangerous If Blind

Spring Cache can be useful for simple cases:

```java
@Cacheable(cacheNames = "customerProfile", key = "#id")
public CustomerProfile getProfile(String id) { ... }

@CacheEvict(cacheNames = "customerProfile", key = "#id")
public void updateProfile(String id, UpdateCommand command) { ... }
```

But blind usage hides critical decisions:

- what is the exact Redis key?
- what is the TTL per cache?
- is null cached?
- is serialization versioned?
- does eviction happen after commit?
- what happens on Redis failure?
- are metrics per cache name available?
- is stampede handled?
- is local cache involved?

Spring Data Redis Cache supports TTL configuration, including fixed duration and dynamic TTL via `RedisCacheWriter.TtlFunction` in newer versions, but abstraction alone does not solve consistency and stampede.

Use `@Cacheable` for low-risk, well-bounded caches. For high-risk cache, create explicit cache layer.

---

## 17. Cache Invalidation Dependency Mapping

For each write use case, define affected cache keys.

Example: update customer profile.

```text
Command: UpdateCustomerProfile(customerId)
Source table/entity:
  - customer

Affected cache:
  - cache:customer:profile:v3:{customerId}
  - cache:customer:summary:v2:{customerId}
  - cache:customer:search-card:v1:{customerId}
  - cache:case:participant-summary:v1:{caseId}:{customerId} [if relation exists]
```

This can be documented as an ADR/table.

### 17.1 Invalidation Registry

In code:

```java
public interface CacheInvalidationHandler<E> {
    void invalidate(E event);
}
```

Example:

```java
public final class CustomerUpdatedInvalidationHandler
        implements CacheInvalidationHandler<CustomerUpdatedEvent> {

    private final CustomerProfileCache profileCache;
    private final CustomerSummaryCache summaryCache;
    private final CaseParticipantCache participantCache;

    @Override
    public void invalidate(CustomerUpdatedEvent event) {
        profileCache.evict(event.customerId());
        summaryCache.evict(event.customerId());
        participantCache.evictByCustomer(event.customerId());
    }
}
```

This makes invalidation visible, testable, and reviewable.

---

## 18. Staleness Budget

A strong cache design defines a staleness budget:

```text
maximum tolerated stale time = TTL + invalidation delay + clock/processing uncertainty
```

Example:

```text
Permission cache:
TTL = 60 seconds
Invalidation event p99 delay = 3 seconds
Consumer retry max delay = 10 seconds
Worst normal stale window ≈ 70 seconds
```

Question:

```text
Is 70 seconds acceptable after user access is revoked?
```

If not, lower TTL, use synchronous invalidation, check source on critical operations, or avoid cache for enforcement.

For regulatory workflows:

```text
Do not cache decision authority unless stale reads are explicitly acceptable.
Cache read models, not authority transitions.
```

---

## 19. Cache and Authorization

Authorization/entitlement caching is dangerous.

Problem:

```text
User role revoked at T1.
Cache still says admin until T1 + TTL.
User performs privileged action at T2.
```

Mitigations:

- short TTL,
- explicit invalidation on role change,
- validate source for high-risk action,
- include auth version in token/session,
- fail closed when cache uncertain,
- audit stale authorization decisions.

Pattern:

```text
Read UI permission hints from cache.
Enforce critical authorization from authoritative source or strongly bounded cache.
```

UI convenience and enforcement are not the same.

---

## 20. Cache and Regulatory/Case Management Systems

For enforcement lifecycle/case management systems, be careful with what Redis cache represents.

Usually safe:

```text
- read-only display summary
- dashboard aggregate
- static reference data
- expensive computed eligibility preview
- non-authoritative search cards
- user preference display
```

Risky:

```text
- canonical case state
- deadline calculation authority
- legal status transition
- enforcement eligibility decision
- sanction amount
- audit trail
- obligation status
```

If Redis is used for these, it must be treated as operational state with clear durability, recovery, and audit design, not casual cache.

Rule:

```text
Cache can accelerate viewing.
Cache should not silently decide authority unless the system design explicitly makes Redis authoritative for that state.
```

---

## 21. Designing TTLs Rationally

Do not choose TTL by vibes.

Consider:

1. update frequency,
2. acceptable staleness,
3. cost of source load,
4. traffic volume,
5. object size,
6. memory budget,
7. invalidation reliability,
8. user harm if stale,
9. burst behavior at expiry,
10. source system protection.

### 21.1 TTL Heuristic

```text
TTL should be shorter than acceptable staleness,
but long enough to reduce source load meaningfully,
and jittered enough to avoid synchronized expiry.
```

### 21.2 Example TTLs

| Cache | Base TTL | Jitter | Notes |
|---|---:|---:|---|
| static country list | 24h | 1h | versioned key better |
| product detail | 10m | 2m | explicit invalidation on update |
| user profile | 5m | 1m | evict after update |
| permission hint | 30s | 10s | not sole enforcement for critical action |
| homepage | 60s | 20s | refresh-ahead |
| dashboard aggregate | 5m | 1m | stale-while-revalidate |
| negative not-found | 15s | 5s | short |

---

## 22. Retry Policy for Cache

Cache retry is often harmful.

Bad:

```text
GET Redis timeout after 500ms
retry 3 times
then DB fallback
```

Now your cache lookup can take seconds.

Better:

```text
Redis read timeout: low
retry: zero or one only for connection-level transient errors
fallback: bounded
circuit breaker: yes
```

For cache writes:

```text
SET failure usually should not fail the business request
unless Redis state is part of correctness contract
```

For idempotency/rate-limit/session, Redis may be correctness-critical. Do not apply cache fallback assumptions blindly.

---

## 23. Metrics and Alerts for Part 010 Problems

### 23.1 Stampede Metrics

```text
cache_load_concurrent{cache_name,key_family}
cache_load_duration_seconds{cache_name}
cache_load_error_total{cache_name}
cache_mutex_acquired_total{cache_name}
cache_mutex_wait_total{cache_name}
cache_mutex_timeout_total{cache_name}
cache_db_fallback_total{cache_name}
```

Alert candidates:

```text
- miss rate jumps above baseline
- DB fallback concurrency high
- cache load p95/p99 high
- mutex timeout high
- Redis error rate high
```

### 23.2 Hot Key Metrics

```text
cache_request_total{cache_name,key_family}
cache_value_size_bytes{cache_name,key_family}
redis_command_latency{command}
redis_network_egress_bytes
redis_cluster_node_ops
```

Application-level key family metrics are more actionable than raw Redis global metrics.

### 23.3 Consistency Metrics

Harder but possible:

```text
cache_stale_detected_total{cache_name}
cache_version_mismatch_total{cache_name}
cache_deserialization_error_total{cache_name}
cache_invalidated_total{cache_name,reason}
cache_invalidation_lag_seconds{event_type}
```

---

## 24. Testing Cache Consistency

### 24.1 Test Read-After-Write

```java
@Test
void afterUpdateNextReadShouldNotReturnOldCachedValue() {
    CustomerId id = createCustomer("old-name");

    service.getProfile(id); // warm cache
    service.updateProfile(id, new UpdateCommand("new-name"));

    CustomerProfile profile = service.getProfile(id);

    assertThat(profile.name()).isEqualTo("new-name");
}
```

### 24.2 Test Cache Delete After Commit

Simulate transaction rollback:

```text
warm cache
attempt update that rolls back
assert cache behavior remains valid
```

### 24.3 Test Stampede

```text
expire key
send 100 concurrent requests
assert DB loader called once or bounded number
assert all responses valid
```

### 24.4 Test Redis Failure

```text
Redis unavailable
request common endpoint
assert fallback behavior matches contract
assert DB concurrency bounded
assert error metrics emitted
```

### 24.5 Test Serialization Version

```text
write old version payload
deploy new reader
assert reader handles old payload or evicts/reloads safely
```

---

## 25. Review Checklist

Use this before approving Redis cache design.

### 25.1 Correctness

```text
[ ] What is the source of truth?
[ ] Is stale data acceptable?
[ ] What is maximum stale window?
[ ] Does write path evict/update cache after commit?
[ ] Are race conditions considered?
[ ] Are multiple derived keys invalidated?
[ ] Is negative caching safe?
[ ] Is cache used for authorization/enforcement?
[ ] Is read-your-write required?
```

### 25.2 Performance

```text
[ ] Is TTL jittered?
[ ] Is stampede prevented for hot keys?
[ ] Is local coalescing used where useful?
[ ] Are hot keys known?
[ ] Are payload sizes bounded?
[ ] Are MGET/pipelining used appropriately?
[ ] Is Redis timeout within API latency budget?
```

### 25.3 Operations

```text
[ ] What happens if Redis is down?
[ ] What happens if Redis is slow?
[ ] What happens during failover?
[ ] What happens if Redis evicts key early?
[ ] Are hit/miss/error/load metrics available?
[ ] Are big/hot keys monitored?
[ ] Are cache keys versioned?
[ ] Is memory budget known?
```

### 25.4 Java Implementation

```text
[ ] Is key building centralized?
[ ] Is serialization explicit and versioned?
[ ] Is Spring Cache abstraction sufficient or too hidden?
[ ] Are transaction boundaries respected?
[ ] Are Redis exceptions handled intentionally?
[ ] Are tests using real Redis/Testcontainers?
```

---

## 26. Practical Decision Framework

### 26.1 Should This Be Cached?

Ask:

```text
1. Is the read path expensive or frequent enough?
2. Is the data safe to be stale?
3. Can we define TTL/invalidation clearly?
4. Can we observe correctness/performance?
5. Can we handle Redis failure safely?
```

If answer to 2 or 3 is no, do not cache casually.

### 26.2 Which Pattern?

```text
Data rarely changes + stale okay:
  cache-aside + TTL + jitter

Data changes sometimes + read-heavy:
  cache-aside + explicit invalidation + TTL safety net

Hot key + stale okay:
  stale-while-revalidate + refresh-ahead + local cache

Critical permission/enforcement:
  short TTL + explicit invalidation + source validation for critical actions

Mutable derived read model:
  event-driven invalidation + versioned key/payload

Unknown update patterns:
  start with short TTL, instrument, then evolve
```

---

## 27. Common Anti-Patterns

### 27.1 Cache Without TTL

```text
SET cache:key value
```

If no explicit reason, this is a bug waiting to become memory leak/stale data.

### 27.2 Cache Invalidation Hidden In Random Services

If multiple services delete each other's Redis keys, ownership is broken.

### 27.3 Treating Cache Hit As Truth

For critical actions, cache value may be a hint, not authority.

### 27.4 TTL Same Across Millions of Keys

Synchronized expiry can destroy DB.

### 27.5 Retrying Cache More Than Source

Cache exists to reduce latency. It should not dominate latency budget.

### 27.6 Storing Huge Object Graphs

Large values cause:

- network cost,
- serialization cost,
- memory fragmentation,
- hot key egress,
- slow reload.

### 27.7 Blind `@Cacheable`

Spring abstraction is useful, but it can hide the lifecycle contract.

### 27.8 Cache-aside for Everything

Some state should be modeled with Redis primitives directly, some should be in DB, some should use event logs, and some should not be cached.

---

## 28. Mini Lab: Build Stampede-Safe Cache-Aside

### Goal

Build a Java cache layer that:

1. reads from Redis,
2. loads from DB on miss,
3. uses local request coalescing,
4. uses Redis per-key mutex,
5. applies TTL jitter,
6. records metrics,
7. degrades safely when Redis fails.

### Suggested Components

```text
ProductService
ProductRepository
ProductCache
ProductCacheKeyBuilder
CacheLoadCoordinator
RedisMutex
CacheMetrics
```

### Behavior

```text
GET /products/{sku}
  -> local Caffeine check optional
  -> Redis GET
  -> if hit return
  -> coalesce local load
  -> acquire Redis mutex
  -> reload Redis after lock acquired
  -> query DB once
  -> SET Redis with jittered TTL
  -> release mutex
```

### Tests

```text
[ ] 100 concurrent miss -> DB called <= small bounded count
[ ] Redis down -> DB fallback bounded
[ ] stale payload version -> evict and reload
[ ] hot key expiry -> no DB storm
[ ] write update -> next read not old value
```

---

## 29. Key Takeaways

1. Redis cache adalah **replica parsial**, bukan sekadar optimization map.
2. Correctness cache harus dijelaskan sebagai **bounded staleness**, bukan “consistent/inconsistent” secara abstrak.
3. TTL adalah safety net, bukan pengganti invalidation untuk data yang butuh freshness.
4. Invalidation sulit karena dependency, ordering, delivery, race, dan scope.
5. Cache-aside punya race; untuk data penting, gunakan versioning, after-commit eviction, short TTL, atau source validation.
6. Cache stampede dapat membuat database jatuh justru saat cache “bekerja normal” yaitu ketika key expired.
7. Hot key perlu strategi khusus: local cache, client-side caching, sharding, split payload, refresh-ahead, atau replica reads.
8. Redis failure harus memiliki kontrak: bypass, fail fast, fail open, fail closed, degrade, atau serve stale.
9. Spring Cache abstraction berguna, tetapi tidak menggantikan desain cache policy.
10. Cache yang production-grade harus punya metrics, tests, memory budget, key ownership, dan failure model.

---

## 30. Referensi

- Redis Docs — Cache-aside pattern: https://redis.io/docs/latest/develop/use-cases/cache-aside/
- Redis Docs — Client-side caching introduction: https://redis.io/docs/latest/develop/clients/client-side-caching/
- Redis Docs — Client-side caching reference: https://redis.io/docs/latest/develop/reference/client-side-caching/
- Redis Docs — `CLIENT TRACKING`: https://redis.io/docs/latest/commands/client-tracking/
- Redis Docs — `EXPIRE`: https://redis.io/docs/latest/commands/expire/
- Redis Docs — `TTL`: https://redis.io/docs/latest/commands/ttl/
- Spring Data Redis Reference — Redis Cache: https://docs.spring.io/spring-data/redis/reference/redis/redis-cache.html

---

## 31. Status Seri

```text
Part 010 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-011.md
```

Part berikutnya akan membahas:

```text
Part 011 — Rate Limiting dan Quota Enforcement dengan Redis
```

Di sana kita akan memakai Redis bukan sebagai cache, tetapi sebagai enforcement state untuk quota/rate limiting: fixed window, sliding window, token bucket, leaky bucket, Lua atomicity, multi-dimensional quota, clock assumption, dan integrasi Java/Spring.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Cache Architecture I: Cache-Aside dengan Java Services</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-011.md">Part 011 — Rate Limiting dan Quota Enforcement dengan Redis ➡️</a>
</div>
