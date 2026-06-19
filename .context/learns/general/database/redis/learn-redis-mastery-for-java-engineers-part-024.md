# learn-redis-mastery-for-java-engineers-part-024.md

# Part 024 — Latency Engineering: Pipelining, Batching, Pooling, Timeouts

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / backend engineer / tech lead  
> Fokus bagian ini: memahami, mengukur, dan mengendalikan latency Redis dari perspektif aplikasi Java produksi.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membedakan latency Redis yang berasal dari:
   - network round trip,
   - server command execution,
   - queueing di Redis,
   - client-side connection pool wait,
   - serialization/deserialization,
   - JVM GC pause,
   - retry storm,
   - blocking command,
   - failover/reconnect.
2. Menjelaskan kenapa Redis yang “cepat” tetap bisa membuat service Java lambat.
3. Mendesain akses Redis yang sadar terhadap round-trip cost.
4. Memilih antara:
   - single command,
   - multi-key command,
   - pipelining,
   - batching,
   - Lua/function,
   - local cache,
   - asynchronous access.
5. Mengatur timeout dan retry Redis secara defensible.
6. Memahami kapan connection pooling membantu dan kapan justru menambah kompleksitas.
7. Mengisolasi blocking commands agar tidak merusak latency path utama.
8. Membaca gejala latency dari metrik client, metrik Redis, dan tracing.
9. Membuat Redis access layer Java yang tahan terhadap tail latency.

---

## 1. Core Thesis: Redis Cepat, Tapi Akses Redis Belum Tentu Cepat

Redis sering diasosiasikan dengan latency sub-millisecond. Itu benar dalam kondisi tertentu: command kecil, koneksi lokal/low-latency, server tidak overloaded, data structure tidak besar, tidak ada blocking operation, dan client tidak antre.

Tapi di aplikasi Java produksi, latency yang kamu lihat biasanya bukan hanya:

```text
Redis command execution time
```

Melainkan:

```text
application latency
= queueing in app thread
+ serialization
+ acquiring connection / using connection
+ network send
+ Redis input queue
+ Redis command execution
+ Redis output generation
+ network receive
+ deserialization
+ application processing
```

Kalau satu endpoint melakukan 20 Redis calls secara serial, maka bottleneck dominan sering bukan Redis CPU, tapi **round trip time × jumlah call**.

Contoh sederhana:

```text
1 Redis GET latency rata-rata: 1 ms
Endpoint melakukan 40 GET serial
Minimum Redis-related latency: ~40 ms
```

Padahal Redis sendiri mungkin hanya mengeksekusi setiap command dalam microseconds. Masalahnya ada pada pola akses.

Mental model penting:

> Redis bukan lambat karena command-nya lambat. Redis sering membuat service lambat karena aplikasi memperlakukan remote Redis seperti local map.

---

## 2. Latency Taxonomy

Untuk menjadi sangat kuat di Redis, jangan bicara “Redis lambat” secara generik. Pecah masalahnya.

### 2.1 Network latency

Ini waktu dari aplikasi ke Redis dan kembali lagi.

Penyebab:

- Redis berada di node/zone/region berbeda.
- Service Java dan Redis lewat load balancer/proxy tambahan.
- TLS overhead.
- Network congestion.
- Banyak command kecil secara serial.
- Container networking overhead.
- Cross-AZ deployment.

Gejala:

- Redis CPU rendah, tapi app latency tinggi.
- Slowlog Redis kosong, tapi trace menunjukkan Redis span panjang.
- Banyak small command.
- P99 jauh lebih tinggi daripada P50.

Solusi umum:

- Kurangi jumlah round trip.
- Gunakan `MGET`, `MSET`, batch command, atau pipelining.
- Tempatkan Redis dekat aplikasi.
- Hindari cross-region Redis untuk request path sinkron.
- Pertimbangkan local cache untuk hot read.

---

### 2.2 Server command execution latency

Ini waktu Redis memproses command.

Command yang biasanya murah:

```text
GET
SET
INCR
HGET
HSET
SISMEMBER
ZADD kecil
ZSCORE
EXPIRE
TTL
```

Command yang bisa mahal:

```text
KEYS
SMEMBERS pada set besar
HGETALL pada hash besar
LRANGE besar
ZRANGE besar
SORT
SUNION/SINTER/SDIFF pada koleksi besar
EVAL script berat
DEL key besar
```

Gejala:

- Redis slowlog berisi command mahal.
- CPU Redis tinggi.
- `commandstats` menunjukkan command tertentu dominan.
- Latency semua client naik karena Redis command execution bersifat single-threaded untuk command path utama.

Solusi:

- Batasi ukuran data structure.
- Gunakan pagination/range kecil.
- Hindari big key.
- Gunakan `SCAN` family dibanding `KEYS`, tetapi tetap hati-hati.
- Gunakan `UNLINK` untuk asynchronous deletion pada key besar.
- Pecah data ke beberapa key bila benar-benar perlu.

---

### 2.3 Queueing latency di Redis

Redis memproses banyak command dari banyak client. Walaupun command masing-masing cepat, antrean bisa terbentuk jika arrival rate lebih tinggi daripada service rate.

Analoginya:

```text
Redis = loket sangat cepat
Tapi kalau semua request masuk bersamaan, tetap ada antrean
```

Penyebab:

- Traffic burst.
- Pipeline terlalu besar.
- Command berat sesekali.
- Banyak client connection aktif.
- Pub/Sub output buffer penuh.
- Script panjang.
- Fork/persistence pressure.

Gejala:

- P99/P999 naik tajam.
- Slowlog mungkin hanya menampilkan sebagian penyebab.
- CPU Redis tinggi atau event loop delay naik.
- Semua service pengguna Redis ikut melambat.

Solusi:

- Rate-limit client.
- Jaga ukuran pipeline.
- Pisahkan workload berat.
- Hindari long-running script.
- Gunakan Redis instance terpisah untuk concern berbeda.
- Terapkan circuit breaker di aplikasi.

---

### 2.4 Client-side pool wait

Di Java, latency bisa terjadi sebelum command dikirim ke Redis.

Contoh:

```text
Request masuk
→ thread butuh Redis connection
→ pool kosong
→ menunggu 80 ms
→ command GET sendiri hanya 1 ms
```

Dari sudut pandang aplikasi, Redis call terlihat 81 ms. Dari sudut pandang Redis server, tidak ada masalah.

Penyebab:

- Pool terlalu kecil.
- Thread aplikasi terlalu banyak.
- Blocking command memakai pool yang sama.
- Connection leak.
- Request burst.
- Retry menggandakan jumlah operasi.
- Slow downstream membuat connection tertahan.

Solusi:

- Pantau pool wait time.
- Gunakan connection sharing jika client mendukung dan workload aman.
- Pisahkan connection untuk blocking operations.
- Jangan hanya menaikkan pool size tanpa analisis.
- Batasi concurrency Redis dari aplikasi.

---

### 2.5 Serialization/deserialization latency

Redis hanya menyimpan byte/string. Aplikasi Java sering mengubah object menjadi JSON/binary dan sebaliknya.

Penyebab:

- Object besar.
- JSON serializer lambat.
- Generic polymorphic serialization.
- Compression berlebihan.
- Java native serialization.
- DTO terlalu lebar.
- Cache menyimpan aggregate besar.

Gejala:

- Redis latency rendah, tapi CPU app tinggi.
- Profiling menunjukkan Jackson/Kryo/serializer dominan.
- Payload Redis besar.
- GC pressure naik.

Solusi:

- Ukur payload size.
- Gunakan DTO khusus cache.
- Hindari Java native serialization.
- Hindari menyimpan object graph besar.
- Pilih format eksplisit dan stabil.
- Pertimbangkan hash/partial data bila sesuai.

---

### 2.6 JVM GC pause

Redis lock, rate limiter, idempotency state, dan timeout semua bisa rusak secara logis jika JVM pause lama.

Contoh lock:

```text
T0: service A acquire lock 5 detik
T1: JVM GC pause 8 detik
T2: lock expired, service B acquire lock
T3: service A lanjut dan mengira masih punya lock
```

Ini bukan Redis latency murni, tapi memengaruhi correctness Redis-backed systems.

Implikasi:

- Timeout harus realistis.
- Lease harus dilengkapi fencing token jika efek samping berbahaya.
- Jangan desain Redis lock seolah JVM tidak pernah pause.
- Observability harus mencakup JVM pause.

---

## 3. The Biggest Redis Latency Mistake: N+1 Remote Calls

Banyak engineer Java yang sudah paham N+1 SQL query, tapi mengulang pola yang sama di Redis.

Contoh buruk:

```java
List<String> userIds = request.getUserIds();
List<UserProfile> profiles = new ArrayList<>();

for (String userId : userIds) {
    String key = "user:profile:" + userId;
    String json = redis.get(key);       // remote call per user
    profiles.add(parse(json));
}
```

Jika ada 100 user IDs, ini 100 round trips.

Lebih baik:

```java
List<String> keys = userIds.stream()
        .map(id -> "user:profile:" + id)
        .toList();

List<String> jsonValues = redis.mget(keys.toArray(new String[0]));
```

Atau gunakan pipelining jika command tidak bisa direduksi menjadi satu multi-key command.

Mental model:

```text
Local loop + remote call = distributed N+1 problem
```

---

## 4. MGET vs Many GET

### 4.1 Many GET serial

```text
GET key1
GET key2
GET key3
...
GET key100
```

Cost:

```text
100 round trips
```

### 4.2 MGET

```text
MGET key1 key2 key3 ... key100
```

Cost:

```text
1 round trip
```

Untuk banyak read sederhana, `MGET` biasanya jauh lebih baik.

Tapi ada batas:

1. Payload response bisa besar.
2. Semua key harus dikirim dalam satu command.
3. Di Redis Cluster, multi-key command hanya aman jika semua key berada pada slot yang sama, kecuali client melakukan scatter-gather sendiri.
4. Satu command besar bisa menahan event loop lebih lama.

Prinsip:

> `MGET` bagus untuk batch kecil-menengah yang bounded. Jangan jadikan `MGET` sebagai alasan untuk mengambil ribuan object besar dalam satu request.

---

## 5. Pipelining

### 5.1 Apa itu pipelining?

Pipelining adalah teknik mengirim beberapa command ke Redis tanpa menunggu response command sebelumnya.

Tanpa pipeline:

```text
client → GET a
client ← value a
client → GET b
client ← value b
client → GET c
client ← value c
```

Dengan pipeline:

```text
client → GET a
client → GET b
client → GET c
client ← value a
client ← value b
client ← value c
```

Command tetap dieksekusi Redis secara berurutan, tapi client mengurangi round-trip waiting.

---

### 5.2 Pipelining bukan transaction

Pipelining tidak menjamin atomicity multi-command.

```text
Pipeline:
  SET a 1
  SET b 2
  INCR c
```

Redis akan menjalankan command dalam urutan yang dikirim, tapi client lain tetap dapat menjalankan command di antara batch dari koneksi lain tergantung scheduling input. Jangan menganggap pipeline sama dengan `MULTI/EXEC` atau Lua.

Gunakan pipeline untuk performance, bukan correctness.

---

### 5.3 Kapan pipelining cocok?

Cocok saat:

- Banyak command independen.
- Tidak perlu output command pertama untuk menentukan command kedua.
- Tidak perlu atomicity multi-step.
- Command kecil dan bounded.
- Network round trip adalah bottleneck.

Contoh:

- Fetch banyak key dengan command berbeda.
- Set banyak TTL-bound cache entries.
- Update banyak counters.
- Warm-up cache.
- Batch idempotency cleanup ringan.

---

### 5.4 Kapan pipelining buruk?

Buruk saat:

- Pipeline terlalu besar.
- Response sangat besar.
- Digunakan untuk command mahal.
- Digunakan pada latency-sensitive shared Redis tanpa batas.
- Client menumpuk request lebih cepat daripada Redis memproses.

Risiko:

```text
Large pipeline
→ Redis output buffer membesar
→ memory pressure
→ event loop delay
→ p99 semua client naik
```

Prinsip:

> Pipeline harus bounded. Batch size adalah parameter produksi, bukan angka asal.

---

## 6. Batching Strategy

Batching adalah desain aplikasi untuk mengelompokkan operasi.

Pipelining adalah mekanisme transport/protocol.

MGET adalah command-level batching.

Lua/function adalah server-side batching plus logic.

Local aggregation adalah application-level batching.

### 6.1 Pilihan batching

| Teknik | Cocok untuk | Risiko |
|---|---|---|
| `MGET`/`MSET` | Banyak key sederhana | Cluster slot, payload besar |
| Pipeline | Banyak command independen | Output buffer, queueing |
| Lua | Multi-step atomic logic | Script latency, operability |
| Redis Function | Logic server-side reusable | Versioning, deployment risk |
| Local cache | Hot read | Stale data, invalidation |
| Request coalescing | Stampede prevention | Complexity |
| Async batcher | Write-heavy counters/events | Delay, partial failure |

---

### 6.2 Batch size

Batch size terlalu kecil:

```text
banyak round trip
```

Batch size terlalu besar:

```text
large payload
large memory buffer
long server occupancy
p99 naik
```

Mulai dengan prinsip:

```text
Batch size harus bounded, measured, dan configurable.
```

Contoh parameter:

```yaml
redis:
  user-profile-cache:
    mget-batch-size: 100
    pipeline-batch-size: 200
    max-value-bytes: 16384
```

Angka di atas bukan universal. Harus diuji terhadap ukuran value, network, Redis CPU, dan SLO endpoint.

---

## 7. Connection Model di Java

Redis client Java populer:

- Lettuce
- Jedis
- Spring Data Redis sebagai abstraction di atas client

### 7.1 Satu koneksi tidak selalu berarti satu thread

Client modern seperti Lettuce mendukung koneksi thread-safe untuk banyak command non-blocking. Ini berbeda dari pola JDBC tradisional yang sering butuh pool connection besar.

Namun, ada pengecualian penting:

- blocking command,
- transaction state,
- Pub/Sub subscription,
- long-running operation,
- connection dengan state khusus.

Jangan pakai satu aturan pooling untuk semua tipe workload.

---

### 7.2 Pooling bukan obat universal

Banyak engineer melihat latency lalu langsung menaikkan pool size.

Masalah:

```text
Pool size naik
→ concurrency ke Redis naik
→ Redis menerima lebih banyak command serentak
→ queueing Redis naik
→ p99 makin buruk
```

Pool size harus dipahami sebagai concurrency control.

Jika pool size 100 dan tiap request melakukan banyak Redis command, kamu sedang mengizinkan ledakan traffic ke Redis.

Lebih baik pikirkan:

```text
Berapa Redis operations per second yang aman?
Berapa concurrent Redis operations yang aman?
Berapa p99 budget endpoint?
Apa fallback saat pool penuh?
```

---

### 7.3 Pool wait harus dimonitor

Tanpa metrik pool wait, kamu bisa salah menyalahkan Redis.

Minimal metrik client:

```text
redis.client.acquire.count
redis.client.acquire.latency.p50/p95/p99
redis.command.latency.p50/p95/p99
redis.command.timeout.count
redis.command.error.count
redis.pool.active
redis.pool.idle
redis.pool.pending
```

Jika `acquire latency` tinggi tetapi Redis `slowlog` kosong, masalah ada di sisi aplikasi/pool/concurrency.

---

## 8. Timeout Design

Timeout Redis bukan angka dekoratif.

Timeout adalah bagian dari correctness dan resilience.

### 8.1 Timeout terlalu panjang

Dampak:

- Thread aplikasi tertahan.
- Request pile-up.
- Connection tertahan.
- Pool habis.
- User-facing latency buruk.
- Retry dari caller menambah beban.

### 8.2 Timeout terlalu pendek

Dampak:

- False timeout.
- Operasi sebenarnya berhasil, tapi aplikasi mengira gagal.
- Duplicate processing.
- Cache write miss.
- Lock/idempotency logic menjadi ambigu.

### 8.3 Timeout harus mengikuti SLO

Jika endpoint SLO p99 200 ms, tidak masuk akal Redis read timeout 5 detik untuk path sinkron.

Contoh budgeting:

```text
Endpoint budget: 200 ms
Business logic + DB budget: 120 ms
Redis budget total: 20 ms
Network/app overhead: 30 ms
Safety margin: 30 ms
```

Maka Redis command timeout mungkin di kisaran puluhan milidetik untuk path cache read, bukan detik.

Tapi untuk background job, batch warmup, atau admin operation, timeout bisa berbeda.

Prinsip:

```text
Timeout harus per workload, bukan global tunggal untuk semua Redis usage.
```

---

## 9. Retry Design

Retry Redis berbahaya bila tidak dibatasi.

### 9.1 Retry bisa menggandakan load

Saat Redis lambat, retry otomatis dapat membuat kondisi makin parah.

```text
Redis mulai lambat
→ request timeout
→ client retry
→ traffic Redis naik 2x/3x
→ Redis makin lambat
→ lebih banyak timeout
```

Ini adalah retry storm.

### 9.2 Retry harus sadar idempotency

Aman untuk retry:

```text
GET key
TTL key
SISMEMBER key member
```

Perlu hati-hati:

```text
INCR key
LPUSH queue item
XADD stream * field value
SET key value without idempotency meaning
```

Command mutating bisa berhasil di Redis tapi response hilang di network. Jika aplikasi retry, efek bisa dobel.

Contoh:

```text
client sends INCR quota:user:123
Redis executes INCR
network timeout before response
client retries INCR
counter incremented twice
```

Untuk mutation penting, gunakan:

- idempotency key,
- Lua compare/state machine,
- request id,
- fencing token,
- stream id eksplisit bila sesuai,
- deduplication state.

---

### 9.3 Retry policy defensible

Untuk cache read:

```text
retry: 0 or very limited
fallback: go to DB/source of truth if safe
```

Untuk cache write:

```text
retry: maybe limited async retry
fallback: accept cache miss later
```

Untuk rate limiter:

```text
fail-open or fail-closed must be product/security decision
```

Untuk idempotency:

```text
must not blindly retry mutation without state check
```

Untuk lock:

```text
retry with jitter and max wait; never spin aggressively
```

---

## 10. Blocking Command Isolation

Blocking Redis commands:

```text
BLPOP
BRPOP
BZPOPMIN
BZPOPMAX
XREAD BLOCK
XREADGROUP BLOCK
```

Command ini berguna, tapi jangan dicampur dengan request-path cache command di connection/pool yang sama.

Buruk:

```text
same Redis connection pool:
  - API cache GET
  - API rate limiter INCR
  - worker BRPOP blocking 30s
```

Dampak:

- Worker menahan connection.
- API request menunggu pool.
- Redis terlihat lambat padahal connection habis.

Desain lebih baik:

```text
Redis connection resources:
  - cacheClient: non-blocking request path
  - limiterClient: low-latency enforcement path
  - queueWorkerClient: blocking commands isolated
  - pubSubClient: dedicated subscription connection
  - adminClient: ops-only, restricted
```

Prinsip:

> Blocking workload harus punya connection isolation.

---

## 11. Large Payload Latency

Redis sering cepat untuk value kecil. Tapi value besar mengubah profil latency.

Contoh payload problem:

```text
GET product:catalog:full:tenant-123
value size = 4 MB
```

Masalah:

- Network transfer lama.
- Deserialization mahal.
- JVM allocation besar.
- GC pressure naik.
- Redis output buffer membesar.
- P99 client lain bisa terdampak.

Checklist value size:

```text
Apakah value > 10 KB?
Apakah value > 100 KB?
Apakah value > 1 MB?
Apakah value sering dibaca?
Apakah value sering di-update sebagian?
Apakah seluruh value memang dibutuhkan di request path?
```

Jika value besar, pertimbangkan:

- pecah berdasarkan access pattern,
- Redis Hash untuk partial fields,
- local cache untuk object besar hot,
- DB/query service sebagai source,
- compression hanya jika CPU budget memadai,
- limit ukuran cache entry.

---

## 12. Tail Latency: P50 Tidak Cukup

Redis integration sering terlihat sehat di average latency.

Contoh metrik:

```text
p50 Redis call: 1 ms
p95 Redis call: 8 ms
p99 Redis call: 80 ms
p999 Redis call: 600 ms
```

Average menipu.

Kenapa p99 penting?

Karena endpoint bisa melakukan beberapa Redis calls.

Jika satu request melakukan 10 Redis calls, peluang terkena satu call lambat meningkat.

Mental model:

```text
Request latency follows the slowest dependency call, not the average call.
```

Jika Redis dipakai di banyak service, tail latency juga bisa menyebar sebagai systemic instability.

---

## 13. Endpoint Budgeting

Sebelum menulis kode Redis, tetapkan latency budget.

Contoh endpoint:

```text
GET /api/v1/cases/{caseId}/summary
SLO: p95 < 150 ms, p99 < 300 ms
```

Dependencies:

```text
Auth context: 20 ms
Case DB: 80 ms
Redis entitlement cache: 10 ms
Redis rate limiter: 5 ms
Serialization/response: 30 ms
Margin: 55 ms
```

Redis budget:

```text
Total Redis synchronous budget: <= 15 ms p95
Max Redis commands: 2-3
Timeout per Redis call: maybe 20-30 ms
Fallback path defined
```

Ini lebih baik daripada:

```text
Redis timeout default: 60 seconds
Retry: 3 times
No fallback
```

---

## 14. Pattern: Redis Access Layer dengan Explicit Workload Classes

Daripada satu `RedisTemplate` global dipakai untuk semua hal, buat pemisahan konseptual.

```text
CacheRedisClient
RateLimitRedisClient
IdempotencyRedisClient
LockRedisClient
StreamRedisClient
AdminRedisClient
```

Setiap client punya:

- command subset,
- timeout,
- retry policy,
- connection/pool model,
- metrics tags,
- fallback behavior,
- serialization strategy,
- key prefix ownership.

Contoh konfigurasi konseptual:

```yaml
redis:
  cache:
    timeout-ms: 30
    retry-max: 0
    max-in-flight: 200
  rate-limit:
    timeout-ms: 15
    retry-max: 0
    failure-mode: fail-closed-for-auth, fail-open-for-analytics
  idempotency:
    timeout-ms: 50
    retry-max: 1
    requires-state-check: true
  stream-worker:
    block-time-ms: 5000
    dedicated-connections: true
```

---

## 15. Java Example: Bad Serial GET

```java
public List<UserProfile> loadProfilesBad(List<String> userIds) {
    List<UserProfile> result = new ArrayList<>();

    for (String userId : userIds) {
        String key = "user:profile:" + userId;
        String json = redisCommands.get(key);
        if (json != null) {
            result.add(objectMapper.readValue(json, UserProfile.class));
        }
    }

    return result;
}
```

Masalah:

1. N round trips.
2. Tidak ada bound ukuran input.
3. Tidak ada timeout per use case terlihat di kode.
4. Tidak ada metrik hit/miss/latency.
5. Tidak ada handling partial miss.

---

## 16. Java Example: MGET dengan Bound dan Partial Miss

```java
public List<UserProfile> loadProfiles(List<String> userIds) {
    if (userIds.size() > 100) {
        throw new IllegalArgumentException("Too many userIds for one request");
    }

    List<String> keys = userIds.stream()
            .map(id -> "user:profile:" + id)
            .toList();

    long startNanos = System.nanoTime();
    List<KeyValue<String, String>> values = redisCommands.mget(keys.toArray(String[]::new));
    metrics.recordRedisLatency("user-profile-cache", System.nanoTime() - startNanos);

    List<UserProfile> result = new ArrayList<>();
    List<String> misses = new ArrayList<>();

    for (int i = 0; i < values.size(); i++) {
        KeyValue<String, String> kv = values.get(i);
        String userId = userIds.get(i);

        if (!kv.hasValue()) {
            misses.add(userId);
            continue;
        }

        result.add(parseProfile(kv.getValue()));
    }

    if (!misses.isEmpty()) {
        metrics.incrementCacheMiss("user-profile-cache", misses.size());
        result.addAll(loadMissingProfilesFromSourceAndBackfill(misses));
    }

    return result;
}
```

Catatan:

- Ada bound input.
- Mengurangi round trip.
- Mengukur latency.
- Memisahkan miss path.
- Masih perlu mempertimbangkan Redis Cluster slot behavior.

---

## 17. Java Example: Pipelining dengan Lettuce Async Style

Contoh konseptual:

```java
public CompletableFuture<List<String>> getManyWithPipeline(List<String> keys) {
    if (keys.size() > 200) {
        throw new IllegalArgumentException("Pipeline batch too large");
    }

    RedisAsyncCommands<String, String> async = connection.async();
    async.setAutoFlushCommands(false);

    List<RedisFuture<String>> futures = new ArrayList<>();

    try {
        for (String key : keys) {
            futures.add(async.get(key));
        }

        async.flushCommands();
    } finally {
        async.setAutoFlushCommands(true);
    }

    CompletableFuture<?>[] converted = futures.stream()
            .map(RedisFuture::toCompletableFuture)
            .toArray(CompletableFuture[]::new);

    return CompletableFuture.allOf(converted)
            .thenApply(ignored -> futures.stream()
                    .map(RedisFuture::join)
                    .toList());
}
```

Hal yang harus dijaga:

1. Jangan lupa flush.
2. Jangan buat pipeline tidak terbatas.
3. Jangan share koneksi dengan pipeline besar ke path low latency tanpa kontrol.
4. Pastikan error handling jelas.
5. Gunakan instrumentation.

---

## 18. Spring Data Redis: RedisTemplate dan Latency Trap

`RedisTemplate` membuat Redis mudah digunakan, tapi juga mudah disalahgunakan.

Contoh trap:

```java
for (String id : ids) {
    redisTemplate.opsForValue().get("case:" + id);
}
```

Kode terlihat sederhana, tapi menghasilkan banyak remote call.

Lebih baik gunakan multi-get:

```java
List<String> keys = ids.stream()
        .map(id -> "case:" + id)
        .toList();

List<CaseSummary> values = redisTemplate.opsForValue().multiGet(keys);
```

Untuk pipeline:

```java
List<Object> results = redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
    StringRedisConnection stringConnection = (StringRedisConnection) connection;

    for (String key : keys) {
        stringConnection.get(key);
    }

    return null;
});
```

Catatan:

- Pipeline result harus dipetakan hati-hati.
- Serializer Spring bisa memengaruhi latency dan ukuran payload.
- Jangan campur pipeline besar dengan transactional semantics kecuali benar-benar memahami behavior-nya.

---

## 19. Reactive Redis: Bukan Otomatis Lebih Cepat

Reactive Redis membantu saat:

- request path non-blocking,
- concurrency tinggi,
- service memakai reactive stack end-to-end,
- kamu ingin menghindari blocking thread.

Namun reactive tidak otomatis mengurangi Redis server work.

Jika kamu melakukan 100 remote calls serial dalam reactive chain, tetap buruk.

Buruk:

```java
Flux.fromIterable(ids)
    .concatMap(id -> redis.opsForValue().get("user:" + id))
```

Lebih baik:

```java
redis.opsForValue().multiGet(keys)
```

Atau gunakan bounded concurrency:

```java
Flux.fromIterable(ids)
    .flatMap(id -> redis.opsForValue().get("user:" + id), 16)
```

Tetapi bounded concurrency masih banyak command. Pilih multi-key/pipeline jika lebih tepat.

Prinsip:

> Reactive mengubah concurrency model, bukan menghapus biaya network dan command execution.

---

## 20. Lua vs Pipeline untuk Latency

Pipeline mengurangi round trip tetapi command tetap multi-step dan tidak atomic secara keseluruhan.

Lua menggabungkan multi-step logic di server, atomic, dan satu round trip.

Contoh rate limiter:

Pipeline:

```text
INCR key
EXPIRE key 60
GET key
```

Masalah:

- Tidak atomic sebagai satu logic utuh.
- Bisa ada race pada expire jika tidak hati-hati.

Lua:

```text
EVAL limiter-script key limit ttl
```

Benefit:

- Satu round trip.
- Atomic.
- Logic dekat data.

Risiko:

- Script terlalu kompleks menahan Redis.
- Sulit di-debug kalau tidak dikelola.
- Cluster key rules.
- Versioning.

Keputusan:

| Need | Better fit |
|---|---|
| Banyak command independen | Pipeline |
| Multi-step atomic decision | Lua/Function |
| Banyak read sederhana | MGET |
| Large computation | Jangan lakukan di Redis |

---

## 21. Local Cache untuk Latency Super Rendah

Jika data sangat hot dan toleran stale, local cache bisa lebih baik daripada Redis call tiap request.

Contoh:

```text
Java service
  local Caffeine cache 1-5 seconds
  Redis cache 5-30 minutes
  DB source of truth
```

Benefit:

- Mengurangi Redis QPS.
- Mengurangi network latency.
- Melindungi Redis dari hot key.
- P99 bisa turun drastis.

Risiko:

- Stale data.
- Invalidation lebih kompleks.
- Memory app meningkat.
- Multi-instance inconsistency.

Cocok untuk:

- feature flags yang toleran stale sebentar,
- user display profile,
- reference data,
- entitlement cache dengan TTL sangat pendek jika business aman,
- configuration snapshot.

Tidak cocok untuk:

- strict quota,
- lock ownership,
- idempotency final state,
- audit-sensitive decision tanpa versioning.

---

## 22. Hot Key Latency

Hot key adalah key yang diakses sangat sering.

Contoh:

```text
config:global
feature-flags:tenant:abc
rate:public-api:global
product:homepage:top
```

Masalah:

- Satu key bisa membuat shard tertentu overload.
- Replication read bisa membantu read, tapi consistency berubah.
- Hot key bisa menyebabkan p99 naik walaupun total key banyak.

Mitigasi:

1. Local cache.
2. Key sharding untuk counter/write-heavy key.
3. Read replica untuk read-heavy key dengan stale-read acceptance.
4. Precompute response.
5. Request coalescing.
6. TTL jitter.
7. Separate Redis instance untuk global hot config.

---

## 23. Redis Cluster Latency Considerations

Redis Cluster menambah dimensi latency:

- client harus tahu topology,
- `MOVED` redirect bisa terjadi,
- resharding dapat menambah latency,
- multi-key command butuh same slot,
- scatter-gather dari client bisa memperbesar tail latency.

Contoh:

```text
MGET user:1 user:2 user:3
```

Di cluster, jika key beda slot, command bisa gagal cross-slot.

Dengan hash tag:

```text
MGET user:{tenant-123}:1 user:{tenant-123}:2
```

Semua key dengan tag `{tenant-123}` masuk slot sama.

Tapi hati-hati:

```text
Semua tenant-123 keys masuk satu slot
→ slot bisa panas
```

Hash tag adalah alat grouping, bukan solusi gratis.

---

## 24. Measuring Redis Latency Properly

### 24.1 Dari sisi aplikasi

Ukur:

```text
command latency by command
latency by logical workload
success/error/timeout
pool wait
payload size
serialization time
batch size
pipeline size
retry count
fallback count
```

Tag metrik yang berguna:

```text
redis.operation = userProfileCache.getMany
redis.command = MGET
redis.result = hit/miss/error/timeout
redis.client = lettuce
redis.cluster = true/false
redis.workload = cache/rate-limit/idempotency/stream
```

Jangan hanya tag by raw key karena high cardinality.

---

### 24.2 Dari sisi Redis

Gunakan:

```text
INFO commandstats
INFO stats
INFO memory
SLOWLOG GET
LATENCY LATEST
LATENCY DOCTOR
CLIENT LIST
MEMORY STATS
```

Perhatikan:

- command yang dominan,
- rejected connections,
- evicted keys,
- expired keys,
- blocked clients,
- connected clients,
- used memory,
- fragmentation ratio,
- input/output buffer,
- replication lag.

---

### 24.3 Distributed tracing

Redis span harus menunjukkan:

- logical operation,
- command family,
- duration,
- error/timeout,
- remote address atau cluster node,
- batch size jika ada.

Hindari memasukkan full key/value ke trace karena:

- PII/security,
- high cardinality,
- biaya storage,
- noise.

Gunakan key pattern:

```text
case:{caseId}:summary → case:{id}:summary
```

---

## 25. Benchmarking Redis dengan Benar

Benchmark buruk:

```text
Run redis-benchmark locally
Claim production Redis can handle X ops/sec
```

Masalah:

- Workload tidak sama.
- Payload tidak sama.
- Network tidak sama.
- Client Java tidak sama.
- Serializer tidak sama.
- TLS tidak sama.
- Cluster tidak sama.
- P99 tidak diperhatikan.

Benchmark lebih baik:

1. Gunakan payload representatif.
2. Gunakan client yang sama dengan produksi.
3. Jalankan dari environment mendekati produksi.
4. Ukur p50/p95/p99/p999.
5. Ukur Redis CPU/memory/network.
6. Uji pipeline size berbeda.
7. Uji batch size berbeda.
8. Uji failure: timeout, restart, failover.
9. Uji dengan traffic campuran, bukan hanya satu command.
10. Uji stampede/hot key scenario.

---

## 26. Failure Mode Matrix

| Failure | Symptom | Root Cause | Mitigation |
|---|---|---|---|
| High Redis span, slowlog empty | App sees slow Redis | network/pool/serialization | client metrics, trace, pool tuning |
| P99 spike all services | Shared Redis stalls | big command/script/pipeline | isolate workload, slowlog, limits |
| Pool exhausted | API waits before command | blocking command or too much concurrency | separate pools, bound concurrency |
| Retry storm | Redis load explodes during latency | automatic retry | limited retry, circuit breaker |
| Timeout ambiguity | Mutation may have succeeded | response lost | idempotent design |
| Hot key overload | one shard/node hot | skewed access | local cache, sharding, replica read |
| Large payload latency | GC/network high | oversized values | split values, size limit |
| Cross-slot issue | cluster command fails | key design | hash tags, redesign access |
| Pub/Sub impact | memory/output buffer issue | slow subscribers | isolate pubsub, monitor buffers |
| Failover latency | burst of errors/timeouts | topology change | client config, retry budget, fallback |

---

## 27. Production Checklist

### 27.1 Access pattern checklist

- [ ] Tidak ada Redis N+1 remote call di request path.
- [ ] Multi-key read menggunakan `MGET`/batch/pipeline dengan bound.
- [ ] Pipeline size dibatasi.
- [ ] Payload size dibatasi.
- [ ] Big key dicegah oleh desain.
- [ ] Blocking commands terisolasi.
- [ ] Pub/Sub punya dedicated connection.
- [ ] Stream workers punya dedicated connection/concurrency model.

### 27.2 Timeout/retry checklist

- [ ] Timeout berbeda per workload.
- [ ] Retry tidak global membabi buta.
- [ ] Mutation retry punya idempotency strategy.
- [ ] Cache read punya fallback.
- [ ] Rate limiter failure mode eksplisit.
- [ ] Circuit breaker tersedia untuk dependency Redis.

### 27.3 Java client checklist

- [ ] Client dipilih sesuai sync/async/reactive kebutuhan.
- [ ] Pool wait dimonitor.
- [ ] Connection sharing dipahami.
- [ ] Blocking commands tidak memakai pool request path.
- [ ] Serializer eksplisit.
- [ ] Java native serialization tidak dipakai untuk cache publik/long-lived.
- [ ] Metrik command latency tersedia.
- [ ] Tracing tidak menyimpan raw key/value sensitif.

### 27.4 Redis server checklist

- [ ] `SLOWLOG` dimonitor.
- [ ] `INFO commandstats` dianalisis.
- [ ] `LATENCY DOCTOR` dipakai saat investigasi.
- [ ] Memory fragmentation dimonitor.
- [ ] Hot key/big key scan dijalankan periodik secara aman.
- [ ] Eviction count dipantau.
- [ ] Replication lag dipantau jika read replica dipakai.

---

## 28. Design Review Questions

Gunakan pertanyaan ini saat review desain Redis di sistem Java:

1. Berapa Redis calls maksimal per request?
2. Apakah ada loop yang melakukan remote Redis call?
3. Apakah command bisa digabung menjadi `MGET`, pipeline, atau Lua?
4. Berapa payload size rata-rata dan p99?
5. Apa timeout untuk workload ini?
6. Apa retry policy-nya?
7. Apakah retry aman untuk mutation?
8. Apakah blocking command memakai connection terpisah?
9. Apakah Redis Cluster multi-key behavior sudah dipikirkan?
10. Apakah key yang dibatch berada di slot sama?
11. Apakah ada hot key?
12. Apa fallback jika Redis timeout?
13. Apakah Redis failure menyebabkan endpoint fail-open atau fail-closed?
14. Apakah pool wait dimonitor?
15. Apakah serializer bisa menjadi bottleneck?
16. Apakah p99 sudah diuji, bukan hanya average?
17. Apakah load test memakai payload dan client produksi?

---

## 29. Mental Model Ringkas

Redis latency engineering bukan sekadar membuat Redis lebih cepat.

Redis latency engineering adalah mengendalikan seluruh jalur:

```text
Java thread/concurrency
→ client connection/pool
→ serialization
→ network
→ Redis event loop
→ command execution
→ response size
→ network back
→ deserialization
→ business path
```

Rule of thumb:

1. Jangan perlakukan Redis sebagai local map.
2. Kurangi round trip sebelum menyalahkan Redis.
3. Batasi batch dan pipeline.
4. Pisahkan workload blocking.
5. Timeout harus mengikuti SLO.
6. Retry harus sadar idempotency.
7. P99 lebih penting daripada average.
8. Ukur dari client dan server sekaligus.
9. Hot key dan big value adalah musuh latency.
10. Pool size adalah concurrency control, bukan magic performance knob.

---

## 30. Latihan Praktis

### Latihan 1 — N+1 Redis Call Audit

Ambil satu service Java yang memakai Redis.

Cari pola:

```text
for (...) redis.get(...)
for (...) redisTemplate.opsForValue().get(...)
stream.map(id -> redis.get(...))
```

Tulis ulang menjadi:

- `MGET`, atau
- pipeline, atau
- batch loader dengan bound.

Ukur sebelum/sesudah:

```text
p50/p95/p99 endpoint latency
Redis command count per request
Redis total time per request
```

---

### Latihan 2 — Timeout Budget

Pilih satu endpoint.

Buat tabel:

```text
Endpoint SLO:
Dependencies:
Redis operations:
Redis timeout:
Fallback:
Retry policy:
```

Validasi apakah timeout Redis sekarang masuk akal.

---

### Latihan 3 — Pipeline Size Experiment

Buat benchmark kecil dengan batch:

```text
pipeline size: 10, 50, 100, 500, 1000
payload: 1 KB, 10 KB, 100 KB
```

Ukur:

```text
client p50/p95/p99
Redis CPU
network throughput
memory/output buffer
```

Cari titik ketika batch size mulai merusak tail latency.

---

### Latihan 4 — Pool Exhaustion Simulation

Simulasikan worker yang melakukan blocking `BRPOP` memakai pool yang sama dengan API cache.

Amati:

```text
pool active
pool pending
API latency
Redis slowlog
```

Lalu pisahkan pool/koneksi dan bandingkan.

---

## 31. Kesimpulan

Redis adalah dependency latency-critical. Kecepatan Redis tidak otomatis membuat aplikasi cepat. Engineer yang matang harus mampu membedakan:

```text
Redis server cepat
```

vs

```text
Redis access pattern aplikasi efisien
```

Kunci mastery di bagian ini:

- pikirkan round trip,
- pikirkan payload,
- pikirkan p99,
- pikirkan pool wait,
- pikirkan retry storm,
- pikirkan workload isolation,
- pikirkan timeout sebagai kontrak,
- ukur dari client dan server.

Jika bagian-bagian sebelumnya membangun pemahaman data structure dan correctness, bagian ini membangun disiplin performa produksi.

Redis yang digunakan dengan benar bisa sangat cepat. Redis yang digunakan seperti local map remote bisa menjadi bottleneck tersembunyi yang sulit didiagnosis.

---

## 32. Status Seri

```text
Part 024 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-025.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Memory Engineering: The Most Important Redis Skill</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-025.md">Part 025 — Java Client Mastery: Lettuce, Jedis, Spring Data Redis ➡️</a>
</div>
