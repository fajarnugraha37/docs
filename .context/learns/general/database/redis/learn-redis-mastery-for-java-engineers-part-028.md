# learn-redis-mastery-for-java-engineers-part-028.md

# Part 028 — Observability: Metrics, Logs, Traces, Slowlog, Commandstats

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / backend engineer / tech lead  
> Fokus: Redis observability untuk sistem production, bukan sekadar melihat dashboard hijau  
> Status seri: Part 028 dari 034 — **belum bagian terakhir**

---

## 0. Tujuan Bagian Ini

Setelah bagian sebelumnya, kita sudah memahami:

- Redis security boundary.
- ACL, TLS, secret hygiene.
- Risiko command berbahaya.
- Mengapa Redis bukan sekadar cache kecil yang boleh dibiarkan tanpa kontrol.

Bagian ini membahas skill production yang sering membedakan engineer biasa dari engineer yang benar-benar bisa mengoperasikan Redis: **observability**.

Redis observability bukan hanya:

```text
Redis up? yes/no
Memory usage berapa?
CPU berapa?
```

Itu terlalu dangkal.

Redis observability yang benar harus menjawab pertanyaan seperti:

1. Apakah Redis lambat, atau Java client yang lambat?
2. Apakah bottleneck ada di Redis server, network, serialization, pool wait, GC, atau dependency downstream?
3. Apakah latency naik karena command tertentu, key tertentu, big key, hot key, eviction, persistence, failover, atau connection storm?
4. Apakah Redis mendekati memory cliff?
5. Apakah cache hit ratio benar-benar membantu sistem atau hanya memberi rasa aman palsu?
6. Apakah retry dari Java service sedang memperparah incident?
7. Apakah replica lag membuat read path inconsistent?
8. Apakah slowlog menunjukkan command mahal, atau slowlog bersih tetapi user tetap merasakan timeout?
9. Apakah Redis Cluster punya hot slot?
10. Apakah alarm yang kita punya actionable, atau hanya noise?

Mental model utama bagian ini:

> Observability Redis adalah kemampuan menghubungkan **symptom aplikasi** dengan **state Redis**, **perilaku client**, dan **kontrak data**.

---

## 1. Redis Observability Tidak Sama dengan Redis Monitoring

Kita bedakan dua istilah.

### Monitoring

Monitoring menjawab:

```text
Apa kondisi sistem sekarang?
```

Contoh:

- Redis process up/down.
- Used memory.
- Connected clients.
- Ops/sec.
- CPU.
- Network in/out.
- Slowlog count.
- Replication lag.

Monitoring biasanya berupa dashboard dan alert.

### Observability

Observability menjawab:

```text
Mengapa sistem berperilaku seperti ini?
```

Contoh:

- Mengapa p99 endpoint `/cases/{id}` naik dari 80 ms ke 900 ms?
- Mengapa Redis CPU normal tetapi Java service timeout?
- Mengapa cache hit tinggi tetapi database tetap overload?
- Mengapa eviction naik padahal memory terlihat belum penuh di dashboard cloud?
- Mengapa failover selesai, tetapi aplikasi masih error beberapa menit?
- Mengapa command `GET` yang biasanya murah tiba-tiba menjadi bagian dari trace lambat?

Monitoring memberi sinyal. Observability memberi penjelasan.

Top 1% Redis usage membutuhkan keduanya.

---

## 2. Layer Observability Redis

Redis-backed Java system punya beberapa layer. Jangan hanya melihat Redis server.

```text
[User Request]
      |
      v
[Java Controller / Handler]
      |
      v
[Business Service]
      |
      v
[Redis Client Abstraction]
      |
      v
[Lettuce/Jedis/Spring Data Redis]
      |
      v
[Connection / Pool / Event Loop]
      |
      v
[Network]
      |
      v
[Redis Server]
      |
      v
[Persistence / Replication / Cluster / OS]
```

Masalah bisa muncul di layer mana pun.

Contoh kesalahan diagnosis umum:

```text
Symptom:
  Endpoint lambat saat akses cache Redis.

Diagnosis dangkal:
  Redis lambat.

Kemungkinan sebenarnya:
  - Connection pool habis.
  - Java serialization lambat.
  - Event loop Netty blocked.
  - DNS/TLS handshake issue.
  - Network packet loss.
  - Redis command queue panjang.
  - Redis sedang fork untuk RDB/AOF rewrite.
  - Big key deletion blocking server.
  - Client retry storm.
  - Timeout terlalu agresif.
  - Pipeline terlalu besar.
```

Redis observability harus menghindari single-cause thinking.

---

## 3. Empat Pertanyaan Dasar Saat Redis Bermasalah

Saat incident Redis terjadi, mulai dari empat pertanyaan ini.

### 3.1 Apakah Redis benar-benar lambat?

Bandingkan:

- Server-side command latency.
- Client-side observed latency.
- Network latency.
- Pool wait.
- Serialization/deserialization time.
- Application span duration.

Kalau Redis server command latency rendah tetapi Java span tinggi, masalah kemungkinan bukan di eksekusi command Redis.

### 3.2 Apakah Redis kehabisan resource?

Periksa:

- Memory.
- CPU.
- Network bandwidth.
- Client connections.
- File descriptors.
- Persistence I/O.
- Replication backlog.

### 3.3 Apakah workload berubah?

Periksa:

- Ops/sec naik?
- Command mix berubah?
- `KEYS`, `SMEMBERS`, `HGETALL`, `ZRANGE` besar muncul?
- Payload membesar?
- TTL pattern berubah?
- Traffic tenant tertentu melonjak?
- Hot key muncul?

### 3.4 Apakah sistem sedang melakukan self-amplification?

Periksa:

- Retry storm.
- Cache stampede.
- Connection storm after failover.
- Reconnect loop.
- Thundering herd pada expired key.
- Circuit breaker tidak ada.
- Thread pool blocking menumpuk.

Masalah Redis jarang hanya Redis. Sering kali Redis menjadi titik amplifikasi dari desain aplikasi.

---

## 4. Redis Server Metrics: Peta Besar

Sumber utama Redis server metrics adalah command:

```bash
INFO
```

`INFO` mengembalikan banyak section. Yang paling penting:

| Section | Fungsi |
|---|---|
| `server` | versi Redis, uptime, mode, executable, config |
| `clients` | connected clients, blocked clients, client memory |
| `memory` | used memory, RSS, fragmentation, maxmemory |
| `persistence` | RDB/AOF status, rewrite, fsync, fork |
| `stats` | ops/sec, hits/misses, expired/evicted keys |
| `replication` | role, replica state, offsets, lag |
| `cpu` | CPU usage Redis process |
| `commandstats` | jumlah dan biaya command per command type |
| `latencystats` | distribusi latency per command jika latency tracking aktif |
| `cluster` | cluster enabled dan status dasar |
| `keyspace` | jumlah key dan expiration per database |
| `errorstats` | error command per kategori |

Jangan semua metric diberi alert. Banyak metric lebih cocok untuk dashboard/debug.

---

## 5. Golden Signals Redis

Untuk Redis, golden signals praktis adalah:

1. **Latency**
2. **Traffic**
3. **Errors**
4. **Saturation**
5. **Correctness signals**

Mari kita detailkan.

---

## 6. Latency Metrics

Latency adalah sinyal paling penting karena Redis sering berada di critical path request.

### 6.1 Server-side latency

Server-side latency menjawab:

```text
Berapa lama Redis mengeksekusi command?
```

Sumber:

- `SLOWLOG`
- `LATENCY` monitor
- `INFO commandstats`
- `INFO latencystats`

### 6.2 Client-side latency

Client-side latency menjawab:

```text
Berapa lama aplikasi menunggu operasi Redis selesai?
```

Ini mencakup:

- Pool wait.
- Queueing di client.
- Network RTT.
- Redis command time.
- Response transfer time.
- Deserialization.
- Scheduler/event loop delay.

Untuk Java service, client-side latency sering lebih relevan bagi user.

### 6.3 End-to-end request latency

End-to-end latency menjawab:

```text
Berapa kontribusi Redis terhadap request user?
```

Harus terlihat di distributed tracing:

```text
HTTP request span
  -> validate input
  -> Redis GET account snapshot
  -> DB fallback if miss
  -> Redis SET cache
  -> business processing
```

Tanpa trace, Redis terlihat sebagai angka terpisah dari user journey.

---

## 7. SLOWLOG: Melihat Command yang Mahal di Server

Redis `SLOWLOG` mencatat command yang waktu eksekusinya melewati threshold.

Contoh:

```bash
SLOWLOG GET 10
```

Contoh konfigurasi:

```bash
CONFIG GET slowlog-log-slower-than
CONFIG GET slowlog-max-len
```

Set threshold:

```bash
CONFIG SET slowlog-log-slower-than 10000
CONFIG SET slowlog-max-len 1024
```

Nilai `slowlog-log-slower-than` memakai microseconds.

```text
10000 microseconds = 10 ms
1000 microseconds  = 1 ms
```

### 7.1 Apa yang dicatat slowlog?

Slowlog umumnya memberi:

- id entry.
- timestamp.
- execution time.
- command + arguments.
- client address.
- client name.

### 7.2 Apa yang tidak dicatat slowlog?

Ini penting.

Slowlog mengukur waktu eksekusi command di Redis server. Ia tidak mencakup total waktu client.

Tidak termasuk:

- Waktu client menunggu connection pool.
- Waktu request antre di aplikasi.
- Network latency dari app ke Redis.
- Waktu response dikirim ke client.
- Deserialization Java.
- Retry delay.

Maka, slowlog kosong **tidak membuktikan Redis path cepat dari sisi aplikasi**.

### 7.3 Command yang sering muncul di slowlog

Contoh command risk-prone:

```text
KEYS *
SMEMBERS huge:set
HGETALL huge:hash
LRANGE huge:list 0 -1
ZRANGE huge:zset 0 -1 WITHSCORES
SUNION large:set:a large:set:b
SORT ...
EVAL heavy-script ...
DEL huge:key
UNLINK huge:key mungkin lebih aman tetapi tetap perlu dipahami
```

Command ini tidak selalu salah. Yang salah adalah menjalankannya tanpa batas, tanpa ownership, dan di hot path.

---

## 8. LATENCY Monitor: Melihat Event Latency Internal

Redis latency monitor membantu mendeteksi event yang membuat Redis mengalami spike.

Command penting:

```bash
LATENCY LATEST
LATENCY HISTORY command
LATENCY DOCTOR
LATENCY RESET
```

Redis latency monitor bukan hanya melihat command lambat. Ia bisa memberi sinyal event internal seperti:

- fork latency.
- AOF fsync delay.
- expire cycle.
- eviction cycle.
- command latency.
- cluster related events.

Contoh:

```bash
LATENCY DOCTOR
```

Gunakan ini saat ada spike misterius.

### 8.1 Slowlog vs latency monitor

| Tool | Menjawab |
|---|---|
| `SLOWLOG` | Command apa yang eksekusinya lambat? |
| `LATENCY` | Event internal apa yang menyebabkan latency spike? |
| Client tracing | Request mana yang terdampak? |
| OS metrics | Apakah CPU/disk/network menyebabkan delay? |

Jangan pilih salah satu. Gunakan bersama.

---

## 9. `INFO commandstats`: Melihat Command Mix

Command:

```bash
INFO commandstats
```

Outputnya berisi statistik per command, misalnya:

```text
cmdstat_get:calls=1000000,usec=500000,usec_per_call=0.50
cmdstat_set:calls=200000,usec=180000,usec_per_call=0.90
cmdstat_hgetall:calls=5000,usec=750000,usec_per_call=150.00
```

Yang perlu dilihat:

1. Command call count.
2. Total CPU time per command.
3. Average microseconds per call.
4. Perubahan command mix dari baseline.

### 9.1 Interpretasi commandstats

Misal:

```text
GET usec_per_call rendah, calls sangat tinggi.
```

Artinya mungkin Redis sehat, tetapi traffic besar. Periksa network dan hot key.

Misal:

```text
HGETALL usec_per_call tinggi, calls naik setelah release baru.
```

Kemungkinan ada code baru yang mengambil hash besar di hot path.

Misal:

```text
EVAL usec_per_call naik.
```

Kemungkinan script terlalu berat, input membesar, atau script melakukan scan/loop besar.

---

## 10. `INFO latencystats`: Percentile per Command

Redis versi modern memiliki section `latencystats` pada `INFO` ketika latency tracking aktif.

Ini membantu melihat percentile command, misalnya:

- p50
- p99
- p999

Mengapa penting?

Average latency sering menyembunyikan tail latency.

Contoh:

```text
GET average: 0.3 ms
GET p99:     12 ms
GET p999:    80 ms
```

Average terlihat sehat, tapi p999 bisa membunuh user-facing endpoint.

Untuk Java service, tail latency lebih penting daripada average.

---

## 11. Traffic Metrics

Traffic menjawab:

```text
Seberapa banyak Redis sedang digunakan?
```

Metrics penting:

- `instantaneous_ops_per_sec`
- `total_commands_processed`
- network input/output bytes.
- connected clients.
- commands per type.
- cache hits/misses.

### 11.1 Ops/sec harus dibaca dengan command mix

`100k ops/sec` bisa murah kalau mayoritas `GET` kecil.

`5k ops/sec` bisa berat kalau banyak:

- `HGETALL` hash besar.
- `SMEMBERS` set besar.
- `ZRANGE` range besar.
- Lua script kompleks.
- JSON query berat.

Traffic Redis bukan hanya jumlah command, tapi juga **shape command**.

---

## 12. Error Metrics

Redis error bukan hanya connection refused.

Pantau:

- `errorstats` dari `INFO`.
- Client exceptions.
- Timeout.
- MOVED/ASK handling error.
- NOAUTH/AUTH failed.
- NOPERM ACL error.
- WRONGTYPE.
- OOM command not allowed under `maxmemory` policy.
- READONLY after failover.
- BUSY script.
- LOADING after restart.
- CLUSTERDOWN.

### 12.1 Error yang penting secara arsitektural

#### `WRONGTYPE`

Biasanya indikasi key schema collision atau deployment tidak kompatibel.

```text
Service A menganggap key sebagai String.
Service B menganggap key sebagai Hash.
```

Ini bukan sekadar runtime error. Ini failure governance keyspace.

#### `OOM command not allowed`

Redis sudah mencapai memory limit dan policy tidak bisa membebaskan memory untuk command itu.

Ini incident kapasitas.

#### `READONLY`

Client menulis ke replica, biasanya setelah failover/topology mismatch.

Ini bisa berarti client topology refresh bermasalah.

#### `MOVED` / `ASK`

Normal di Redis Cluster, tetapi kalau aplikasi gagal menanganinya berarti client tidak cluster-aware atau topology stale.

#### `BUSY`

Script masih berjalan. Ini bisa membuat server sulit melayani command lain.

---

## 13. Saturation Metrics

Saturation menjawab:

```text
Redis sudah dekat batas kapasitas atau belum?
```

Resource utama Redis:

1. Memory.
2. CPU.
3. Network.
4. Disk I/O untuk persistence.
5. Client connections.
6. Replication buffers.
7. Event loop responsiveness.

---

## 14. Memory Observability

Memory adalah resource paling penting Redis.

Command:

```bash
INFO memory
MEMORY STATS
MEMORY USAGE some:key
```

Metrics penting:

| Metric | Makna |
|---|---|
| `used_memory` | memory yang dialokasikan Redis allocator |
| `used_memory_human` | versi human-readable |
| `used_memory_rss` | memory resident dari perspektif OS |
| `used_memory_peak` | puncak penggunaan memory |
| `maxmemory` | limit memory Redis |
| `mem_fragmentation_ratio` | indikasi fragmentation |
| `allocator_frag_ratio` | fragmentasi allocator |
| `evicted_keys` | jumlah key yang dieviction |
| `expired_keys` | jumlah key expired |
| `keyspace` | jumlah key per DB |

### 14.1 Memory usage bukan hanya value size

Untuk setiap key, ada overhead:

- key name.
- Redis object metadata.
- internal encoding.
- allocator overhead.
- collection node overhead.
- expires dictionary jika punya TTL.

Contoh:

```text
10 juta key kecil bisa lebih mahal daripada 1 juta value sedang.
```

Karena itu observability memory harus melihat:

- jumlah key.
- rata-rata ukuran key.
- top key besar.
- tipe data dominan.
- TTL coverage.
- fragmentation.

---

## 15. Fragmentation: Memory Terlihat Hilang

`used_memory` dan `used_memory_rss` bisa berbeda.

Contoh:

```text
used_memory:     8 GB
used_memory_rss: 14 GB
```

Ini bisa terjadi karena fragmentation atau allocator/OS behavior.

Fragmentation tinggi bisa muncul karena:

- churn key tinggi.
- value size berubah-ubah.
- banyak expire/delete.
- workload update tidak stabil.
- fork/persistence interaction.

### 15.1 Kenapa fragmentation penting?

Karena Redis bisa terlihat memakai memory jauh lebih besar di OS daripada data aktifnya.

Efek:

- container memory limit terancam.
- OOM killer risk.
- cost naik di managed Redis.
- failover/restart jadi lambat.

### 15.2 Alert fragmentation

Jangan alert hanya karena ratio sesaat.

Perhatikan:

```text
fragmentation tinggi + RSS mendekati host/container limit = bahaya
fragmentation tinggi + used_memory kecil setelah flush/test = bisa normal sementara
```

---

## 16. Eviction Observability

Eviction adalah sinyal yang sangat penting.

Metric:

```bash
INFO stats
```

Cari:

```text
evicted_keys
expired_keys
keyspace_hits
keyspace_misses
```

### 16.1 Eviction harus diperlakukan sebagai semantic event

Eviction bukan hanya memory event.

Kalau Redis hanya cache, eviction mungkin normal.

Kalau Redis menyimpan:

- idempotency key.
- distributed lock.
- rate limit counter.
- session.
- workflow transient state.

maka eviction bisa menyebabkan bug correctness.

Contoh:

```text
Idempotency key dieviction sebelum TTL bisnis selesai.
Request retry diterima sebagai request baru.
Efek samping ganda terjadi.
```

Jadi alert eviction harus mempertimbangkan jenis data.

### 16.2 Alert yang lebih baik

Buruk:

```text
Alert if evicted_keys > 0
```

Bisa terlalu noisy untuk cache-only Redis.

Lebih baik:

```text
Alert if eviction rate > baseline AND Redis stores non-cache correctness data.
Alert if eviction rate > 0 for Redis instance classified as no-eviction correctness store.
Alert if used_memory / maxmemory > 85% and rising.
Alert if evictions correlate with cache miss spike or error spike.
```

---

## 17. Expiration Observability

`expired_keys` menunjukkan jumlah key yang expired.

Expiration tinggi tidak selalu buruk. Untuk TTL-heavy cache, expiration tinggi normal.

Yang penting adalah pola.

### 17.1 Expiration spike

Expiration spike bisa berarti:

- banyak key punya TTL sama.
- batch load tanpa jitter.
- cache stampede risk.
- active expiration cycle menambah CPU.

Contoh buruk:

```java
redis.set(key, value, Duration.ofMinutes(10));
```

Jika jutaan key diset di waktu sama, mereka bisa expired bersamaan.

Lebih baik:

```java
Duration ttl = Duration.ofMinutes(10)
    .plusSeconds(ThreadLocalRandom.current().nextInt(0, 120));
```

TTL jitter adalah observability-aware design.

---

## 18. Cache Hit/Miss Observability

Redis memberi:

```text
keyspace_hits
keyspace_misses
```

Hit ratio:

```text
hit_ratio = keyspace_hits / (keyspace_hits + keyspace_misses)
```

Tapi hit ratio global sering misleading.

### 18.1 Global hit ratio bisa menipu

Misal:

```text
Global cache hit ratio: 95%
```

Terlihat bagus.

Tapi:

```text
Endpoint A: 99.8% hit, low value
Endpoint B: 40% hit, high traffic, expensive DB fallback
Endpoint C: 0% hit karena key naming bug
```

Global metric menyembunyikan problem.

### 18.2 Hit ratio harus per cache domain

Instrument di Java:

```text
cache.domain=case-summary
cache.domain=tenant-policy
cache.domain=user-session
cache.domain=rate-limit
cache.domain=idempotency
```

Untuk tiap domain:

- hit count.
- miss count.
- load time.
- load error.
- stale serve count.
- set failure count.
- invalidation count.

Jangan hanya percaya `keyspace_hits` Redis.

---

## 19. Big Key Observability

Big key adalah key yang value-nya besar atau collection-nya punya cardinality sangat tinggi.

Contoh:

- Hash dengan jutaan fields.
- Set dengan jutaan members.
- List sangat panjang.
- Sorted Set sangat besar.
- String value multi-MB.

### 19.1 Mengapa big key berbahaya?

Big key bisa menyebabkan:

- command lambat.
- network response besar.
- memory fragmentation.
- blocking delete/expire/evict.
- replication lag.
- AOF/RDB bloat.
- failover lebih berat.
- client deserialization lambat.

### 19.2 Cara menemukan big key

Tooling:

```bash
redis-cli --bigkeys
redis-cli --memkeys
redis-cli --keystats
MEMORY USAGE key
SCAN
```

Hindari:

```bash
KEYS *
```

di production.

### 19.3 Observability design untuk big key

Aplikasi harus punya cardinality guard.

Contoh metric:

```text
redis.structure.size{domain="case-watchers", type="set"}
redis.structure.size{domain="tenant-queue", type="list"}
redis.value.bytes{domain="case-summary-cache"}
```

Jangan tunggu Redis incident untuk tahu ukuran data.

---

## 20. Hot Key Observability

Hot key adalah key yang menerima traffic tidak proporsional.

Contoh:

```text
config:global
feature-flags:tenant:largeTenant
policy:latest
leaderboard:global
case:popular-case-id
```

### 20.1 Dampak hot key

Di Redis single instance:

- CPU/network terkonsentrasi.
- client connection pressure naik.
- tail latency naik.

Di Redis Cluster:

- satu slot/node menjadi bottleneck.
- cluster terlihat tidak seimbang.
- scaling horizontal tidak membantu jika hot key tetap satu.

### 20.2 Mendeteksi hot key

Redis memiliki tooling seperti:

```bash
redis-cli --hotkeys
```

Tetapi hot key detection butuh konfigurasi eviction policy tertentu pada beberapa mode/tooling dan tidak selalu cukup.

Lebih reliable:

- instrument access count per cache domain.
- sample key hash/tag di aplikasi.
- track top-N logical keys di metrics/logs dengan cardinality control.
- gunakan tracing untuk melihat key pattern, bukan full sensitive key.

### 20.3 Jangan expose raw key sembarangan

Redis key bisa berisi:

- user id.
- tenant id.
- case id.
- token hash.
- business-sensitive identifier.

Di logs/traces, gunakan redaction:

```text
case:{tenantHash}:{caseIdHash}:summary
```

Bukan:

```text
case:tenant-123:enforcement-case-987654321:summary
```

---

## 21. Client Observability di Java

Redis server metrics tanpa Java client metrics itu setengah buta.

Untuk Java, pantau:

1. Operation latency per command/domain.
2. Timeout count.
3. Retry count.
4. Pool usage.
5. Pool wait time.
6. Connection creation/destruction.
7. Reconnect count.
8. Command queue size.
9. Serialization/deserialization time.
10. Payload size.
11. Circuit breaker state.
12. Fallback usage.

### 21.1 Lettuce observability

Lettuce mendukung integrasi Micrometer/observability di ekosistem Spring. Dengan konfigurasi yang tepat, command Redis dapat menghasilkan meter dan span.

Yang harus terlihat:

```text
redis.command=GET
redis.remote=redis-primary:6379
redis.outcome=success/error/timeout
redis.duration.p50/p95/p99
```

Namun jangan berhenti di command-level.

Tambahkan domain-level metric di aplikasi:

```text
cache.get.duration{cache="case-summary"}
cache.hit{cache="case-summary"}
cache.miss{cache="case-summary"}
cache.load.duration{cache="case-summary"}
rate_limiter.decision{limiter="tenant-api", decision="allowed|blocked"}
idempotency.state{operation="create-case", state="started|completed|conflict"}
```

Redis command metric menjawab mekanik. Domain metric menjawab bisnis.

---

## 22. Connection Pool Observability

Connection pool problem sering terlihat seperti Redis latency problem.

Pantau:

- active connections.
- idle connections.
- max connections.
- pending borrowers.
- pool wait duration.
- connection acquisition timeout.
- connection validation failure.

### 22.1 Symptom pool exhaustion

Contoh:

```text
Redis server CPU rendah.
Slowlog kosong.
INFO connected_clients normal.
Java service p99 tinggi.
Redis operation timeout tinggi.
```

Kemungkinan:

- pool habis.
- blocking command memakai pool yang sama.
- transaction/pipeline connection tidak dilepas.
- synchronous calls menumpuk di servlet threads.
- reactive pipeline blocked oleh code blocking.

### 22.2 Rule penting

Pisahkan connection untuk:

- blocking pop/stream read long polling.
- pub/sub subscription.
- normal request-response command.
- admin/diagnostic command.

Jangan campur semuanya dalam pool yang sama.

---

## 23. Timeout Observability

Timeout harus dipantau sebagai sinyal desain, bukan hanya error transient.

Metrics:

```text
redis.timeout.count
redis.timeout.rate
redis.timeout.by.command
redis.timeout.by.domain
redis.timeout.by.node
redis.timeout.after.retry
```

### 23.1 Timeout taxonomy

Timeout bisa terjadi karena:

- Redis server slow.
- Redis unavailable.
- network issue.
- pool wait.
- command queue backlog.
- DNS/TLS issue.
- failover transition.
- client event loop blocked.
- oversized response.
- Java GC pause.

Kalau semua timeout dilempar menjadi `RedisTimeoutException`, observability hilang.

Tambahkan context:

```text
command=GET
cache=case-summary
key_pattern=case:{tenant}:summary
node=redis-2
attempt=1
pool_wait_ms=12
command_timeout_ms=100
payload_size_estimate=4KB
```

---

## 24. Retry Observability

Retry adalah pedang bermata dua.

Jika Redis lambat karena overload, retry bisa memperparah.

Pantau:

- retry count.
- retry rate.
- retry reason.
- retry success after N attempts.
- retry exhausted.
- total attempts per original request.

### 24.1 Retry storm pattern

```text
Redis p99 naik
  -> Java client timeout
  -> semua service retry
  -> Redis menerima beban lebih besar
  -> queue makin panjang
  -> timeout makin banyak
  -> circuit breaker tidak aktif
  -> incident membesar
```

Observability harus bisa membedakan:

```text
original traffic
```

dan:

```text
amplified retry traffic
```

---

## 25. Tracing Redis Calls

Distributed tracing sangat membantu jika Redis ada di request path.

Trace span yang baik minimal punya:

- command type.
- Redis logical operation.
- cache/domain name.
- outcome.
- duration.
- error class.
- remote node/cluster.
- retry attempt.

Hati-hati dengan key.

Jangan masukkan full key mentah jika mengandung PII/sensitive identifier.

Gunakan:

```text
key_pattern=case:{tenant}:summary
key_hash=sha256-prefix-8
```

### 25.1 Trace buruk

```text
span: Redis GET
duration: 450ms
```

Terlalu miskin.

### 25.2 Trace bagus

```text
span: redis.cache.get
attributes:
  db.system=redis
  db.operation=GET
  redis.cache=case-summary
  redis.key_pattern=case:{tenant}:{caseId}:summary
  redis.result=miss
  redis.node=redis-cluster-node-3
  retry.attempt=0
  duration=7ms
```

Untuk miss path:

```text
HTTP GET /cases/{id}
  redis.cache.get case-summary -> miss 7ms
  postgres.query case_summary -> 88ms
  redis.cache.set case-summary -> 5ms
```

Sekarang kita bisa memahami kontribusi Redis terhadap user journey.

---

## 26. Logging Redis Events

Logs berguna untuk event diskret, bukan untuk semua command.

Jangan log setiap Redis `GET` di production. Itu mahal dan noisy.

Log event seperti:

- connection failure.
- topology refresh failure.
- failover detected.
- repeated timeout threshold crossed.
- circuit breaker opened/closed.
- fallback activated.
- cache stampede protection lock timeout.
- idempotency conflict.
- Lua script failure.
- ACL/auth error.
- WRONGTYPE.
- OOM.
- READONLY.
- CLUSTERDOWN.

### 26.1 Log structure

Gunakan structured logging:

```json
{
  "event": "redis_operation_timeout",
  "service": "case-service",
  "operation": "cache_get",
  "cache": "case-summary",
  "command": "GET",
  "key_pattern": "case:{tenant}:{caseId}:summary",
  "redis_node": "redis-3:6379",
  "attempt": 1,
  "timeout_ms": 100,
  "pool_wait_ms": 18,
  "trace_id": "...",
  "tenant_hash": "a13f90c2"
}
```

Jangan gunakan log string bebas yang susah di-query.

---

## 27. Keyspace Notifications

Redis keyspace notifications dapat mengirim event untuk operasi tertentu, misalnya key expired.

Contoh use case:

- debug expiration.
- local cache invalidation.
- lightweight reactive behavior.
- observing lifecycle of session keys.

Namun hati-hati.

### 27.1 Keyspace notifications bukan audit log

Keyspace notifications:

- pub/sub based.
- tidak durable.
- bisa hilang saat subscriber offline.
- bisa menambah overhead.

Jangan gunakan untuk:

- regulatory audit trail.
- exactly-once workflow transition.
- financial event record.
- compliance evidence.

Untuk audit, gunakan durable source of truth.

---

## 28. Replication Observability

Jika Redis memakai replica/Sentinel/Cluster, observability harus mencakup replication.

Metrics:

```bash
INFO replication
```

Perhatikan:

- role: master/replica.
- connected replicas.
- replication offset.
- lag.
- link status.
- backlog size.
- failover state.

### 28.1 Lag semantics

Replica lag berdampak jika aplikasi membaca dari replica.

Contoh:

```text
Write session update to primary.
Read session from replica.
Replica lag 500 ms.
User melihat state lama.
```

Jika read-after-write penting, jangan baca dari replica tanpa strategi.

### 28.2 Alert replication

Alert penting:

- replica disconnected.
- lag melebihi threshold.
- role berubah tidak diharapkan.
- failover terjadi.
- backlog insufficient.
- repeated partial/full resync.

---

## 29. Persistence Observability

Jika RDB/AOF aktif, pantau persistence.

Metrics dari `INFO persistence`:

- `rdb_bgsave_in_progress`
- `rdb_last_bgsave_status`
- `rdb_last_bgsave_time_sec`
- `rdb_last_cow_size`
- `aof_enabled`
- `aof_rewrite_in_progress`
- `aof_last_rewrite_time_sec`
- `aof_last_bgrewrite_status`
- `aof_last_write_status`
- delayed fsync / fsync related counters depending version/config.

### 29.1 Persistence-related latency

Redis persistence bisa memengaruhi latency karena:

- fork overhead.
- copy-on-write memory cost.
- disk I/O saturation.
- AOF fsync delay.
- AOF rewrite.

Kalau latency spike terjadi saat `BGSAVE`/AOF rewrite, jangan hanya lihat commandstats.

---

## 30. Cluster Observability

Untuk Redis Cluster, observability harus per node dan per slot distribution.

Pantau:

- cluster state.
- node availability.
- slot coverage.
- per-node memory.
- per-node CPU.
- per-node ops/sec.
- per-node latency.
- per-node network.
- migrations/importing slots.
- `MOVED`/`ASK` rate at client.
- hot slot/key.

### 30.1 Cluster bisa terlihat sehat secara global tetapi tidak seimbang

Contoh:

```text
Cluster total CPU: 35%
Node A CPU: 90%
Node B CPU: 10%
Node C CPU: 5%
```

Global average menipu.

Penyebab:

- hot key.
- hot hash tag.
- tenant besar terkonsentrasi dalam satu slot.
- uneven slot distribution.
- multi-key design memaksa banyak key ke hash tag sama.

### 30.2 Hash tag observability

Jika key design memakai hash tag:

```text
tenant:{tenantId}:case:{caseId}:summary
```

Maka semua key dengan `{tenantId}` sama masuk slot yang sama.

Ini bagus untuk multi-key operation tenant kecil, tapi berbahaya untuk tenant besar.

Pantau traffic per tenant/hash tag jika memungkinkan.

---

## 31. Alert Design

Alert Redis harus actionable.

Alert buruk:

```text
Redis memory high
```

Alert bagus:

```text
Redis used_memory_ratio > 85% for 15 minutes AND slope positive AND evicted_keys increasing
```

Alert buruk:

```text
Redis latency high
```

Alert bagus:

```text
Redis client-side p99 latency for cache=case-summary > 50ms for 5 minutes AND server slowlog entries increased
```

### 31.1 Kategori alert

#### Availability alert

- Redis down/unreachable.
- Cluster state fail.
- Sentinel failover loop.
- Replica disconnected.

#### Latency alert

- client p99 command latency high.
- server slowlog rate high.
- latency monitor spike.
- timeout rate high.

#### Capacity alert

- memory usage high and rising.
- eviction rate abnormal.
- fragmentation + RSS near limit.
- connection count near limit.
- network saturation.

#### Correctness alert

- eviction on non-cache Redis.
- idempotency key store OOM.
- rate limiter Redis unavailable/fallback active.
- WRONGTYPE errors.
- Lua script failures.
- ACL violations.

#### Replication/cluster alert

- replication lag high.
- role change.
- cluster slot unavailable.
- MOVED/ASK storm.

---

## 32. Dashboard Design

Dashboard Redis sebaiknya dibagi per persona/use case.

### 32.1 Executive/service health dashboard

Untuk melihat apakah user terdampak:

- service error rate.
- service latency p95/p99.
- Redis dependency latency.
- Redis timeout rate.
- fallback/circuit breaker state.
- cache hit/miss per domain.

### 32.2 Redis server dashboard

Untuk Redis operator:

- uptime.
- ops/sec.
- commandstats.
- slowlog count.
- memory and fragmentation.
- evicted/expired keys.
- connected/blocked clients.
- CPU.
- network.
- persistence state.
- replication state.

### 32.3 Redis cluster dashboard

Per node:

- ops/sec.
- CPU.
- memory.
- latency.
- network.
- slot count.
- role.
- replica lag.

### 32.4 Cache domain dashboard

Per application cache:

- hit ratio.
- miss rate.
- load duration.
- load error.
- set latency.
- invalidate count.
- stampede lock contention.
- stale serve count.

Ini biasanya paling berguna untuk backend team.

---

## 33. Observability untuk Cache Pattern

Cache observability berbeda dari generic Redis observability.

Untuk cache-aside, instrument:

```text
cache.get
cache.hit
cache.miss
cache.load
cache.load.error
cache.set
cache.set.error
cache.invalidate
cache.stale_serve
cache.lock_wait
cache.lock_timeout
```

### 33.1 Contoh cache miss analysis

Symptom:

```text
Database CPU naik.
Redis normal.
```

Cek:

- cache miss rate per domain.
- invalidation spike.
- TTL terlalu pendek.
- key naming berubah setelah deploy.
- negative cache tidak bekerja.
- serialization error saat `SET`.
- Redis set timeout tetapi get tetap miss.

Tanpa domain metrics, semua terlihat seperti DB problem.

---

## 34. Observability untuk Rate Limiter

Rate limiter bukan sekadar Redis command. Ia adalah enforcement system.

Metrics:

```text
rate_limiter.allowed
rate_limiter.blocked
rate_limiter.redis_error
rate_limiter.fallback_allowed
rate_limiter.fallback_blocked
rate_limiter.lua_duration
rate_limiter.key_count
rate_limiter.clock_skew_detected
```

Dimensi:

- limiter name.
- tenant.
- endpoint group.
- API key class.
- decision.

Hati-hati cardinality tinggi. Jangan label metrics dengan raw user ID.

### 34.1 Correctness questions

Saat Redis rate limiter error, policy-nya apa?

- Fail open?
- Fail closed?
- Degrade quota?
- Local limiter fallback?

Observability harus menunjukkan kapan fallback aktif.

---

## 35. Observability untuk Idempotency

Idempotency state store harus dipantau sebagai correctness-critical.

Metrics:

```text
idempotency.started
idempotency.completed
idempotency.conflict
idempotency.replay
idempotency.expired_before_completion
idempotency.redis_error
idempotency.state_transition_error
```

Alert penting:

```text
expired_before_completion > 0
```

Ini bisa berarti TTL terlalu pendek atau processing terlalu lama.

---

## 36. Observability untuk Distributed Lock

Distributed lock butuh observability ketat karena bug-nya sering silent.

Metrics:

```text
lock.acquire.success
lock.acquire.timeout
lock.acquire.contention
lock.hold.duration
lock.release.success
lock.release.token_mismatch
lock.expired_while_working
lock.fencing_rejected
```

### 36.1 Lock smell

Jika lock contention tinggi terus-menerus, mungkin lock digunakan untuk menyembunyikan desain yang salah.

Pertanyaan:

- Kenapa concurrency tinggi harus serial?
- Apakah bisa pakai partitioning?
- Apakah bisa pakai DB constraint?
- Apakah bisa pakai queue?
- Apakah lock scope terlalu besar?

Observability bukan hanya untuk firefighting, tapi untuk mengungkap desain buruk.

---

## 37. Observability untuk Streams/PubSub

### 37.1 Redis Streams

Metrics:

```text
stream.length
consumer_group.pending
consumer_group.lag
consumer_group.acked
consumer_group.claimed
consumer_group.retried
consumer_group.dead_lettered
consumer.processing.duration
```

Periksa:

```bash
XINFO STREAM mystream
XINFO GROUPS mystream
XINFO CONSUMERS mystream mygroup
XPENDING mystream mygroup
```

PEL yang terus naik berarti consumer tidak ACK, lambat, atau crash.

### 37.2 Pub/Sub

Metrics:

```text
pubsub.messages.published
pubsub.messages.received
pubsub.subscriber.connected
pubsub.handler.error
pubsub.reconnect.count
```

Ingat: Pub/Sub tidak durable. Jangan buat alert “message lost” berdasarkan Redis Pub/Sub kecuali aplikasi punya sequence tracking sendiri.

---

## 38. Redis Observability Runbook

Saat incident Redis terjadi, gunakan urutan ini.

### Step 1 — Tentukan blast radius

Tanya:

```text
Service mana terdampak?
Endpoint mana?
Tenant mana?
Semua Redis operation atau domain tertentu?
Read path atau write path?
```

### Step 2 — Cek client-side metrics

Lihat:

- timeout rate.
- p99 latency.
- pool wait.
- retry count.
- error type.
- trace sample.

### Step 3 — Cek Redis server health

Jalankan/lihat:

```bash
INFO clients
INFO memory
INFO stats
INFO commandstats
INFO persistence
INFO replication
SLOWLOG GET 20
LATENCY LATEST
LATENCY DOCTOR
```

### Step 4 — Cek workload change

Bandingkan baseline:

- command mix berubah?
- ops/sec naik?
- payload membesar?
- new release?
- tenant besar aktif?
- cache invalidation spike?

### Step 5 — Cek saturation

- memory high?
- evictions?
- CPU high?
- network saturated?
- disk I/O issue?
- client connections high?

### Step 6 — Cek correctness risk

- data correctness terancam?
- rate limiter fail open/closed?
- idempotency unsafe?
- locks expired?
- session lost?
- audit trail aman?

### Step 7 — Mitigasi

Possible actions:

- enable circuit breaker.
- reduce traffic.
- disable offending feature flag.
- increase TTL jitter.
- bypass non-critical cache write.
- shed load.
- scale Redis/read replicas if appropriate.
- isolate hot key.
- kill bad client connection.
- stop dangerous command/job.
- failover only jika benar-benar perlu.

### Step 8 — Post-incident

Dokumentasikan:

- detection gap.
- missing metric.
- missing trace attribute.
- bad alert threshold.
- key design issue.
- client timeout/retry issue.
- capacity assumption yang salah.

---

## 39. Practical Command Cheat Sheet

### Server health

```bash
PING
INFO server
INFO clients
INFO memory
INFO stats
INFO commandstats
INFO latencystats
INFO persistence
INFO replication
INFO keyspace
```

### Slow command analysis

```bash
SLOWLOG LEN
SLOWLOG GET 20
SLOWLOG RESET
```

### Latency analysis

```bash
LATENCY LATEST
LATENCY HISTORY command
LATENCY DOCTOR
LATENCY RESET
```

### Memory analysis

```bash
MEMORY STATS
MEMORY USAGE some:key
redis-cli --bigkeys
redis-cli --memkeys
```

### Cluster analysis

```bash
CLUSTER INFO
CLUSTER NODES
CLUSTER SLOTS
```

### Streams analysis

```bash
XINFO STREAM mystream
XINFO GROUPS mystream
XINFO CONSUMERS mystream mygroup
XPENDING mystream mygroup
```

---

## 40. Java/Spring Observability Blueprint

Berikut blueprint praktis untuk Java service.

### 40.1 Metric names

Gunakan domain-level metrics:

```text
cache.operation.duration
cache.operation.count
cache.hit.count
cache.miss.count
cache.load.duration
cache.load.error.count
redis.operation.timeout.count
redis.operation.error.count
redis.pool.wait.duration
redis.retry.count
redis.circuit_breaker.state
```

Tag yang aman:

```text
service
operation
cache_name
command
outcome
environment
redis_cluster
```

Hindari tag cardinality tinggi:

```text
user_id
case_id
full_key
session_id
request_id
token
```

### 40.2 Example wrapper concept

```java
public final class ObservableCacheClient {

    private final RedisTemplate<String, String> redisTemplate;
    private final MeterRegistry meterRegistry;

    public Optional<String> get(String cacheName, String keyPattern, String key) {
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            String value = redisTemplate.opsForValue().get(key);
            String outcome = value == null ? "miss" : "hit";

            meterRegistry.counter(
                "cache.get.count",
                "cache", cacheName,
                "outcome", outcome
            ).increment();

            return Optional.ofNullable(value);
        } catch (RuntimeException ex) {
            meterRegistry.counter(
                "cache.get.error.count",
                "cache", cacheName,
                "exception", ex.getClass().getSimpleName()
            ).increment();
            throw ex;
        } finally {
            sample.stop(Timer.builder("cache.get.duration")
                .tag("cache", cacheName)
                .tag("key_pattern", keyPattern)
                .register(meterRegistry));
        }
    }
}
```

Catatan:

- Jangan tag dengan raw key.
- `key_pattern` boleh jika cardinality rendah.
- Untuk high cardinality, gunakan attribute di trace/log terbatas, bukan metric tag.

### 40.3 Timeout classification

Buat exception handling yang membedakan:

```text
timeout
connection_failure
auth_failure
acl_denied
wrong_type
oom
readonly
cluster_down
script_busy
serialization_failure
```

Semua jangan digabung menjadi `Redis failed`.

---

## 41. Alert Threshold Starting Point

Threshold harus disesuaikan workload. Namun starting point:

### Latency

```text
Client-side Redis p99 > SLO budget for 5 minutes
Redis timeout rate > 0.5% for 5 minutes
Slowlog entries > baseline + threshold
```

### Memory

```text
used_memory / maxmemory > 80% warning
used_memory / maxmemory > 90% critical
eviction rate > 0 for correctness Redis
fragmentation + RSS near host/container limit
```

### Errors

```text
NOAUTH/NOPERM > 0 in production
WRONGTYPE > 0 after deployment
OOM > 0
READONLY spike after failover
CLUSTERDOWN > 0
BUSY script > 0 sustained
```

### Replication

```text
replica disconnected
replication lag > read consistency tolerance
role change event
full resync repeated
```

### Cache correctness

```text
hit ratio sudden drop per cache domain
cache load errors spike
stampede lock contention high
fallback active sustained
```

---

## 42. Common Anti-Patterns

### 42.1 Only observing Redis server

Server metrics terlihat sehat, tetapi aplikasi timeout karena pool wait.

### 42.2 Only observing Java client

Client timeout terlihat tinggi, tetapi tidak tahu Redis sedang AOF rewrite atau ada big key deletion.

### 42.3 Global cache hit ratio

Global hit ratio tinggi menyembunyikan cache domain penting yang miss terus.

### 42.4 No key pattern discipline

Semua metric/log berisi raw key atau tidak ada key pattern sama sekali.

Yang benar: key pattern low-cardinality.

### 42.5 Alert tanpa runbook

Alert berbunyi, tetapi engineer tidak tahu langkah berikutnya.

### 42.6 Metrics cardinality explosion

Memasukkan tenant/user/case ID sebagai metric label membuat observability system mahal dan lambat.

### 42.7 Tidak mengamati fallback

Sistem terlihat sehat karena request sukses, tetapi sebenarnya semua request bypass Redis dan menghantam database.

### 42.8 Tidak mengamati eviction sebagai correctness event

Eviction dianggap normal padahal Redis menyimpan idempotency/rate limit state.

---

## 43. Production Readiness Checklist

Sebelum Redis masuk production, pastikan:

### Server metrics

- [ ] `INFO` metrics dikumpulkan.
- [ ] Memory dashboard tersedia.
- [ ] Commandstats dashboard tersedia.
- [ ] Slowlog dikonfigurasi.
- [ ] Latency monitor/latency stats dipahami.
- [ ] Persistence metrics tersedia jika RDB/AOF aktif.
- [ ] Replication/cluster metrics tersedia jika HA/Cluster aktif.

### Client metrics

- [ ] Redis operation latency per command/domain.
- [ ] Timeout count.
- [ ] Retry count.
- [ ] Pool wait duration.
- [ ] Connection/reconnect metrics.
- [ ] Error classification.

### Application/domain metrics

- [ ] Cache hit/miss per cache domain.
- [ ] Cache load duration/error.
- [ ] Rate limiter decisions.
- [ ] Idempotency states.
- [ ] Lock acquisition/release/fencing metrics.
- [ ] Stream consumer lag/Pending Entries List if using Streams.

### Logs/traces

- [ ] Redis spans in distributed tracing.
- [ ] No raw sensitive key in logs/traces.
- [ ] Key pattern included where safe.
- [ ] Failover/reconnect events logged.
- [ ] Circuit breaker/fallback events logged.

### Alerts

- [ ] Memory alert.
- [ ] Eviction alert sesuai Redis classification.
- [ ] Timeout alert.
- [ ] Slowlog/latency alert.
- [ ] Replication/cluster alert.
- [ ] Correctness-specific alert.
- [ ] Each alert has runbook.

---

## 44. Mental Model Final

Redis observability yang matang bukan dashboard penuh grafik.

Redis observability yang matang adalah kemampuan menjawab:

```text
Apa yang user alami?
Operation Redis apa yang terlibat?
Apakah problem ada di app, client, network, Redis server, persistence, replication, cluster, atau data model?
Apakah problem ini latency, capacity, availability, atau correctness?
Apakah sistem sedang memperparah dirinya sendiri lewat retry/stampede/reconnect storm?
Apa mitigasi paling aman sekarang?
Apa desain yang harus diperbaiki setelah incident?
```

Untuk Java engineer, skill kuncinya adalah menghubungkan tiga dunia:

```text
Application semantics
      +
Java client behavior
      +
Redis server internals
```

Redis cepat ketika desainnya benar. Redis juga bisa menjadi blind spot yang sangat mahal ketika observability-nya dangkal.

---

## 45. Latihan Praktis

### Latihan 1 — Buat Redis dashboard minimal

Ambil metric dari Redis `INFO` dan tampilkan:

- ops/sec.
- connected clients.
- blocked clients.
- used memory.
- memory ratio.
- evicted keys rate.
- expired keys rate.
- keyspace hits/misses.
- top commandstats.
- slowlog count.

### Latihan 2 — Simulasi slow command

Buat struktur data besar, lalu jalankan command mahal seperti `HGETALL` atau `SMEMBERS` pada data besar di environment lokal.

Amati:

- slowlog.
- latency monitor.
- Java client latency.

### Latihan 3 — Simulasi pool exhaustion

Buat Java service dengan pool kecil dan banyak parallel request.

Amati:

- pool wait.
- Redis server metrics.
- Java timeout.

Buktikan bahwa Redis server bisa sehat sementara aplikasi tetap timeout.

### Latihan 4 — Simulasi cache stampede

Set key populer dengan TTL sama, lalu expired bersamaan.

Amati:

- miss rate spike.
- DB load spike.
- Redis set spike.
- request p99.

Tambahkan TTL jitter dan request coalescing.

### Latihan 5 — Simulasi eviction correctness failure

Gunakan Redis dengan `maxmemory` kecil untuk idempotency store.

Amati bagaimana eviction bisa membuat duplicate request lolos.

Tulis postmortem kecil.

---

## 46. Ringkasan

Di bagian ini kita belajar:

1. Redis monitoring berbeda dari Redis observability.
2. Observability harus mencakup server, client, network, Java runtime, dan application semantics.
3. `INFO`, `SLOWLOG`, `LATENCY`, `commandstats`, dan `latencystats` adalah fondasi Redis server observability.
4. Slowlog kosong tidak berarti Redis path cepat dari sudut pandang aplikasi.
5. Client-side latency, pool wait, retry, dan timeout harus dipantau di Java service.
6. Memory, fragmentation, eviction, dan expiration adalah sinyal penting untuk capacity dan correctness.
7. Cache hit ratio harus dilihat per domain, bukan hanya global.
8. Big key dan hot key harus dideteksi sebelum menjadi incident.
9. Replication, persistence, dan cluster punya observability khusus.
10. Alerts harus actionable dan punya runbook.
11. Redis observability terbaik menghubungkan symptom user dengan command, key pattern, client behavior, dan Redis internals.

---

## 47. Referensi

- Redis command `INFO`: https://redis.io/docs/latest/commands/info/
- Redis latency monitoring: https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency-monitor/
- Redis latency diagnosis: https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/
- Redis `LATENCY DOCTOR`: https://redis.io/docs/latest/commands/latency-doctor/
- Redis `SLOWLOG`: https://redis.io/docs/latest/commands/slowlog/
- Redis memory optimization: https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/
- Redis eviction reference: https://redis.io/docs/latest/develop/reference/eviction/
- Redis keyspace notifications: https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/
- Redis Streams commands and `XINFO`: https://redis.io/docs/latest/develop/data-types/streams/
- Spring Data Redis Observability: https://docs.spring.io/spring-data/redis/reference/observability.html
- Spring Framework Observability: https://docs.spring.io/spring-framework/reference/integration/observability.html

---

## 48. Status Seri

```text
Part 028 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-029.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Security: AUTH, ACL, TLS, Network Boundary, Secret Hygiene</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-029.md">Part 029 — Operations: Backup, Upgrade, Migration, Disaster Recovery ➡️</a>
</div>
