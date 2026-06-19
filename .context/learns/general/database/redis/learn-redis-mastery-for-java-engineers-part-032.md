# learn-redis-mastery-for-java-engineers-part-032.md

# Part 032 — Redis Anti-Patterns and Failure Case Studies

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `032 / 034`  
> Fokus: anti-pattern, root-cause analysis, failure modelling, production review, dan Redis design smell untuk Java backend systems.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membangun kemampuan Redis dari banyak sisi:

- data structures;
- TTL dan eviction;
- cache architecture;
- rate limiting;
- idempotency;
- distributed locks;
- Lua dan Redis Functions;
- Pub/Sub dan Streams;
- persistence;
- replication, Sentinel, Cluster;
- memory engineering;
- latency engineering;
- Java clients;
- security;
- observability;
- operations;
- testing;
- design patterns.

Bagian ini bukan menambah fitur baru. Bagian ini melatih kemampuan yang lebih penting untuk engineer senior: **mendeteksi desain Redis yang salah sebelum menjadi incident**.

Redis sering gagal bukan karena Redis lemah, tetapi karena sistem memperlakukan Redis sebagai sesuatu yang bukan dirinya:

- dianggap database durable seperti PostgreSQL;
- dianggap message broker durable seperti Kafka/RabbitMQ;
- dianggap distributed lock yang mutlak aman;
- dianggap cache tanpa memory budget;
- dianggap key-value store sederhana padahal command tertentu bisa sangat mahal;
- dianggap dependency kecil padahal berada di critical path seluruh request;
- dianggap internal-only sehingga security dan observability diabaikan.

Target akhir bagian ini: kamu mampu membaca sebuah desain Redis dan berkata:

> “Ini akan cepat saat demo, tapi akan gagal saat traffic tinggi, failover, memory pressure, retry storm, deploy besar, atau audit.”

---

## 1. Mental Model: Anti-Pattern Adalah Kontrak Tersembunyi yang Salah

Anti-pattern bukan sekadar “cara buruk”. Dalam sistem produksi, anti-pattern biasanya adalah **kontrak tersembunyi yang tidak pernah ditulis**.

Contoh:

```text
Design: cache user profile tanpa TTL.
Kontrak tersembunyi: key ini tidak akan tumbuh tanpa batas.
Realita: user bertambah, cache tidak pernah dibersihkan, memory habis.
```

Contoh lain:

```text
Design: Redis lock untuk melindungi update saldo.
Kontrak tersembunyi: lock tidak akan expire sebelum critical section selesai.
Realita: JVM GC pause 30 detik, lease expire, worker lain masuk, data double-updated.
```

Contoh lain:

```text
Design: Redis Streams untuk audit event.
Kontrak tersembunyi: stream tidak akan kehilangan event penting.
Realita: trimming salah, persistence tidak cukup kuat, recovery belum diuji.
```

Jadi, cara membaca Redis design bukan:

> “Command apa yang dipakai?”

Melainkan:

> “Invariant apa yang ingin dijaga, dan apakah Redis primitive ini benar-benar menjaga invariant tersebut saat failure?”

---

## 2. Taxonomy Anti-Pattern Redis

Kita akan pakai taxonomy berikut.

```text
Redis Anti-Patterns
├── Data lifecycle anti-patterns
│   ├── missing TTL
│   ├── TTL tanpa semantics
│   ├── unbounded key growth
│   └── stale data accepted accidentally
│
├── Memory anti-patterns
│   ├── big keys
│   ├── large payloads
│   ├── high-cardinality namespace tanpa budget
│   ├── fragmentation ignored
│   └── eviction unsafe
│
├── Latency anti-patterns
│   ├── KEYS in production
│   ├── O(N) commands on large data
│   ├── no pipelining
│   ├── retry storm
│   ├── blocking commands mixed with normal traffic
│   └── slow Lua/functions
│
├── Consistency anti-patterns
│   ├── cache invalidation by hope
│   ├── Redis as source of truth accidentally
│   ├── distributed lock abuse
│   ├── missing fencing token
│   ├── idempotency key too short-lived
│   └── multi-key assumptions in cluster
│
├── Architecture anti-patterns
│   ├── shared Redis for unrelated bounded contexts
│   ├── one Redis to rule them all
│   ├── no ownership model
│   ├── Redis used to bypass domain modelling
│   └── hidden coupling via key names
│
├── Operational anti-patterns
│   ├── no backup/restore test
│   ├── no failover test
│   ├── no capacity plan
│   ├── no version upgrade discipline
│   ├── no client timeout discipline
│   └── no runbook
│
└── Security anti-patterns
    ├── exposed Redis
    ├── shared password
    ├── no ACL
    ├── dangerous commands available
    ├── TLS ignored where required
    └── secrets in config/logs
```

---

## 3. Anti-Pattern #1 — Redis sebagai Primary Database Tanpa Durability Reasoning

### 3.1 Bentuk Umum

Sistem awalnya mengatakan:

> “Redis cuma cache.”

Lalu perlahan berubah menjadi:

```text
Redis menyimpan session penting.
Redis menyimpan idempotency result.
Redis menyimpan workflow transient state.
Redis menyimpan queue.
Redis menyimpan user quota.
Redis menyimpan pending approval.
```

Setelah beberapa bulan:

> “Kalau Redis hilang, operasi bisnis terganggu dan state tidak bisa direkonstruksi.”

Pada titik itu, Redis bukan lagi sekadar cache. Redis sudah menjadi **stateful system of operation**.

### 3.2 Gejala

- Tidak ada database lain yang menyimpan state yang sama.
- TTL dibuat sangat panjang atau bahkan tidak ada.
- Kehilangan key dianggap incident, bukan cache miss normal.
- Tidak ada replay source.
- Tidak ada backup restore test.
- RDB/AOF tidak pernah dibahas dalam design review.
- Failover dianggap pasti aman.
- Team berkata “Redis cepat, jadi aman untuk state ini.”

### 3.3 Mengapa Berbahaya

Redis bisa durable dengan RDB/AOF, tetapi Redis tetap memory-first dan konfigurasi persistence menentukan window kehilangan data.

Pertanyaan yang harus dijawab:

1. Kalau Redis crash tepat setelah write, apakah data boleh hilang?
2. Kalau primary failover ke replica yang lag, apakah write terakhir boleh hilang?
3. Kalau AOF corrupt atau restore snapshot lama, apa recovery path?
4. Kalau key expired karena TTL, apakah itu business event atau bug?
5. Kalau eviction menghapus key, apakah sistem aman?

Kalau jawaban tidak jelas, desain belum siap produksi.

### 3.4 Desain yang Lebih Aman

Gunakan klasifikasi state:

| Jenis state | Redis boleh jadi source of truth? | Syarat |
|---|---:|---|
| Pure cache | Ya, karena source of truth ada di DB | Missing key normal |
| Derived state | Ya, jika bisa direbuild | Ada recomputation/replay |
| Transient coordination | Bisa | TTL dan failure semantics jelas |
| Workflow state penting | Hati-hati | Perlu durable backing store atau event log |
| Audit/compliance state | Umumnya tidak | Harus immutable/durable di storage lain |
| Financial/legal state | Sangat jarang | Perlu formal durability dan recovery model |

Rule praktis:

> Jika kehilangan Redis key menyebabkan data bisnis tidak bisa direkonstruksi, Redis harus diperlakukan sebagai database dengan seluruh discipline database: durability, backup, restore, access control, migration, audit, dan DR.

---

## 4. Anti-Pattern #2 — Cache Key Tanpa TTL

### 4.1 Bentuk Umum

```java
redis.set("user:" + userId, json);
```

Tidak ada TTL.

Awalnya aman karena traffic kecil. Lalu jumlah user bertambah, key terus naik, memory naik, fragmentation naik, eviction mulai terjadi, Redis latency naik, service timeout.

### 4.2 Mengapa Ini Sering Terjadi

Engineer berpikir:

> “Kalau tidak ada TTL, hit ratio lebih tinggi.”

Benar dalam jangka pendek. Salah dalam sistem nyata.

Cache tanpa TTL membuat cache berubah menjadi database bayangan tanpa lifecycle.

### 4.3 Pertanyaan Review

Untuk setiap key cache, tanya:

1. Siapa pemilik key ini?
2. Apa source of truth-nya?
3. Berapa lama value boleh stale?
4. Kapan key harus hilang?
5. Apa yang terjadi kalau key hilang lebih awal?
6. Apa yang terjadi kalau key tidak pernah hilang?
7. Apakah key boleh dievict?
8. Apakah invalidation event pasti dikirim?
9. Apakah ada jitter TTL?
10. Apakah ada negative caching untuk miss mahal?

### 4.4 Pattern yang Lebih Baik

```java
Duration ttl = Duration.ofMinutes(15).plusSeconds(ThreadLocalRandom.current().nextInt(60));
redis.setex(key, ttl.toSeconds(), payload);
```

Tapi TTL tidak boleh asal. TTL adalah bagian dari contract.

Contoh:

```text
Key: cache:user-profile:v1:{tenantId}:{userId}
Source: PostgreSQL users table
Staleness tolerance: 5 minutes
TTL: 5-7 minutes with jitter
Invalidation: on user profile update event
Missing behavior: reload from DB
Eviction safe: yes
```

---

## 5. Anti-Pattern #3 — TTL Ada, Tapi Semantics Tidak Ada

TTL tanpa semantics sering lebih berbahaya daripada tanpa TTL karena terlihat benar.

### 5.1 Contoh Buruk

```text
All cache keys TTL = 24h
```

Kenapa 24 jam?

- Karena umum?
- Karena “cukup lama”?
- Karena ingin hit ratio tinggi?
- Karena tidak tahu invalidation?

TTL harus berasal dari domain dan risk tolerance.

### 5.2 TTL Berdasarkan Jenis Data

| Data | TTL wajar | Alasan |
|---|---:|---|
| Product catalog public | Menit-jam | Stale biasanya tolerable |
| User permission | Detik-menit | Security-sensitive |
| Account status | Detik-menit | Blocking/unblocking harus cepat |
| Feature flag | Detik-menit | Rollout harus terkendali |
| Rate limiter window | Sesuai window | Bagian dari algorithm |
| Idempotency key | Sesuai retry horizon | Harus mencakup retry dan duplicate window |
| Lock key | Sangat pendek | Lease, bukan storage |
| Audit state | Jangan TTL-only | Butuh durable retention |

### 5.3 TTL dan Regulatory Defensibility

Untuk sistem enforcement/case management/regulatory:

```text
TTL boleh dipakai untuk transient acceleration.
TTL tidak boleh menjadi satu-satunya enforcement memory untuk keputusan yang harus diaudit.
```

Contoh:

- redis key untuk “case currently locked by officer” boleh TTL;
- redis key untuk “case was escalated due to violation rule” tidak boleh hanya TTL;
- redis key untuk “rate limiter currently blocks request” boleh TTL;
- permanent record bahwa request ditolak karena quota harus ada di audit log jika diperlukan compliance.

---

## 6. Anti-Pattern #4 — Big Keys

### 6.1 Apa Itu Big Key?

Big key adalah key yang value-nya terlalu besar atau container-nya berisi terlalu banyak element.

Contoh:

```text
String 20 MB
Hash 2 juta field
Set 10 juta member
List 5 juta item
Sorted Set 30 juta member
JSON document besar
```

Tidak ada angka universal. Key disebut “big” jika operasi terhadap key tersebut mulai memblokir event loop, mengganggu replication, memperbesar memory overhead, membuat migration lambat, atau memperbesar tail latency.

### 6.2 Gejala Big Key

- Redis CPU spike saat command tertentu.
- `SLOWLOG` menunjukkan `HGETALL`, `SMEMBERS`, `LRANGE`, `ZRANGE` besar.
- Network output besar.
- Client timeout saat membaca key.
- Failover lambat.
- Resharding cluster lambat.
- Memory fragmentation tinggi.
- Deleting key besar menyebabkan latency spike.

### 6.3 Contoh Anti-Pattern

```text
Key: tenant:{tenantId}:all-users
Type: Set
Members: semua user dalam tenant enterprise besar
Usage: SMEMBERS untuk authorization check
```

Masalah:

- `SMEMBERS` mengembalikan semua member.
- Authorization biasanya hanya butuh membership check, bukan seluruh set.
- Untuk tenant besar, output bisa masif.
- Satu tenant besar menjadi hot/big key.

Desain lebih baik:

```text
SISMEMBER tenant:{tenantId}:users {userId}
```

Atau kalau harus query besar, pindahkan ke database/search layer yang cocok.

### 6.4 Teknik Mitigasi

1. Gunakan command granular (`HGET`, `SISMEMBER`, `ZRANGE` bounded) bukan full-scan command.
2. Shard logical container:

```text
notifications:{userId}:{bucket}
```

3. Batasi payload.
4. Pakai pagination bounded.
5. Gunakan `UNLINK` bukan `DEL` untuk key besar jika sesuai.
6. Pisahkan hot data dari cold data.
7. Monitor key cardinality.
8. Buat budget per key pattern.

### 6.5 Review Rule

> Kalau satu Redis key dapat tumbuh seiring jumlah user, event, order, case, atau tenant tanpa batas eksplisit, itu kandidat big key.

---

## 7. Anti-Pattern #5 — Hot Keys

### 7.1 Apa Itu Hot Key?

Hot key adalah key yang diakses jauh lebih sering daripada key lain.

Contoh:

```text
cache:global-config
feature-flags:all
homepage:top-products
tenant:largest-customer:permissions
rate-limit:public-api:anonymous
```

Hot key bisa kecil tetapi tetap merusak karena semua request menuju node Redis yang sama.

### 7.2 Mengapa Hot Key Berbahaya

Dalam Redis Cluster, key berada pada hash slot tertentu. Kalau satu key sangat panas, slot/node itu menjadi bottleneck walaupun cluster punya banyak node.

Scaling cluster tidak otomatis menyelesaikan hot key.

### 7.3 Mitigasi

| Problem | Mitigasi |
|---|---|
| Read-heavy global config | local in-process cache + Redis invalidation |
| Popular item cache | replica read, local cache, probabilistic refresh |
| Hot counter | sharded counter lalu aggregate |
| Anonymous rate limiter | partition by IP/API key, not global only |
| Feature flags | client-side caching with short TTL |

### 7.4 Sharded Counter Pattern

```text
counter:video:{videoId}:shard:0
counter:video:{videoId}:shard:1
counter:video:{videoId}:shard:2
...
```

Write pilih shard random. Read aggregate beberapa shard.

Trade-off:

- write pressure tersebar;
- read lebih mahal;
- value mungkin eventually aggregated;
- tidak cocok untuk exact real-time invariant tanpa tambahan desain.

---

## 8. Anti-Pattern #6 — `KEYS` di Production

### 8.1 Bentuk Umum

```bash
KEYS cache:user:*
```

Di staging aman. Di production dengan jutaan key, command ini bisa memblokir server.

### 8.2 Mengapa Berbahaya

`KEYS` melakukan scan seluruh keyspace dan mengembalikan semua match sekaligus. Pada dataset besar, ini bisa menyebabkan:

- event loop blocked;
- latency spike;
- output buffer besar;
- network burst;
- client timeout;
- incident cascade.

### 8.3 Alternatif

Gunakan `SCAN` untuk iterasi incremental.

```bash
SCAN 0 MATCH cache:user:* COUNT 1000
```

Namun `SCAN` bukan magic.

Kamu tetap harus paham:

- hasil bisa mengandung duplicate;
- tidak snapshot-consistent;
- perlu cursor loop;
- tetap bisa mahal jika dipakai terus-menerus;
- jangan dijadikan query engine utama aplikasi.

### 8.4 Desain Lebih Baik

Jika aplikasi perlu lookup berdasarkan atribut, jangan bergantung pada pattern scan keyspace. Gunakan:

- explicit index key;
- Sorted Set time index;
- Set membership index;
- Redis Search jika cocok;
- database query layer jika query kompleks;
- event-driven materialized index.

---

## 9. Anti-Pattern #7 — Full Collection Commands pada Struktur Besar

Command yang sering tampak harmless:

```bash
HGETALL large-hash
SMEMBERS large-set
LRANGE large-list 0 -1
ZRANGE large-zset 0 -1
```

Masalahnya bukan command itu salah. Masalahnya adalah **tidak ada bound**.

### 9.1 Rule

> Di Redis production, command yang mengembalikan data tak terbatas harus dianggap berbahaya sampai terbukti aman.

### 9.2 Pattern Lebih Aman

| Buruk | Lebih aman |
|---|---|
| `HGETALL` untuk object besar | `HMGET` field yang dibutuhkan |
| `SMEMBERS` untuk cek membership | `SISMEMBER` |
| `LRANGE 0 -1` | `LRANGE 0 99` |
| `ZRANGE 0 -1` | bounded pagination |
| `DEL` big key | `UNLINK` jika cocok |
| `KEYS pattern` | `SCAN` atau explicit index |

---

## 10. Anti-Pattern #8 — Cache Invalidation by Hope

### 10.1 Bentuk Umum

```text
Write DB.
Hope cache expires soon.
```

Atau:

```text
Write DB.
Publish invalidation event.
Assume all consumers receive it.
```

Atau:

```text
Write DB.
Delete one cache key.
Forget derived keys.
```

### 10.2 Masalah

Cache invalidation bukan command. Ia adalah distributed protocol kecil.

Failure yang harus dipikirkan:

1. DB commit success, Redis delete fail.
2. Redis delete success, DB commit fail.
3. Invalidation event lost.
4. Consumer down saat event dikirim.
5. Derived cache tidak diketahui.
6. Race antara read miss dan write.
7. Cache filled dengan old DB value setelah invalidation.

### 10.3 Pattern yang Lebih Baik

Minimal:

```text
- TTL always exists.
- Invalidation best-effort accelerates freshness.
- Missing invalidation tidak boleh menyebabkan stale forever.
- Critical reads bypass cache or verify version.
- Cache key includes version where useful.
```

Untuk data penting:

```text
value = {
  data: ...,
  sourceVersion: 12345,
  cachedAt: ...
}
```

Lalu service bisa menilai apakah cache terlalu stale untuk use case tertentu.

### 10.4 Domain-Aware Freshness

Tidak semua stale data sama.

| Use case | Stale boleh? | Strategy |
|---|---:|---|
| Product description | Ya | TTL + invalidation |
| Permission check | Sangat terbatas | short TTL + version + bypass on sensitive action |
| Account suspended | Hampir tidak | authoritative DB or strongly controlled cache |
| Dashboard stats | Ya | TTL + async refresh |
| Regulatory decision | Tidak untuk final state | durable source required |

---

## 11. Anti-Pattern #9 — Cache Stampede Diabaikan

### 11.1 Bentuk Umum

```text
Popular key expires.
1000 requests miss at the same time.
All 1000 hit database.
Database slows down.
Requests timeout.
Retries multiply traffic.
System degrades.
```

### 11.2 Gejala

- DB QPS spike saat cache hit ratio turun sedikit.
- Redis miss burst.
- Banyak thread Java menunggu same expensive call.
- p99 latency naik tajam.
- CPU app meningkat karena serialization/deserialization dan retries.
- Cache warmup setelah deploy menyebabkan incident.

### 11.3 Mitigasi

1. TTL jitter.
2. Single-flight per key.
3. Soft TTL + stale-while-revalidate.
4. Mutex lock dengan short lease.
5. Probabilistic early refresh.
6. Cache warming untuk known hot keys.
7. Negative caching untuk missing object.
8. Circuit breaker ke origin.

### 11.4 Single-Flight Pattern

Dalam satu JVM:

```java
ConcurrentHashMap<String, CompletableFuture<Value>> inFlight = new ConcurrentHashMap<>();

CompletableFuture<Value> loadOnce(String key) {
    return inFlight.computeIfAbsent(key, k ->
        CompletableFuture.supplyAsync(() -> loadFromDbAndPopulateRedis(k))
            .whenComplete((v, e) -> inFlight.remove(k))
    );
}
```

Dalam multi-instance, perlu Redis mutex atau request coalescing layer. Tapi jangan lupa: lock juga bisa gagal, jadi stale fallback sering lebih resilient.

---

## 12. Anti-Pattern #10 — Retry Storm ke Redis

### 12.1 Bentuk Umum

Redis timeout. Client retry otomatis 3 kali. App punya 50 instance. Traffic tetap masuk. Semua retry makin menekan Redis.

```text
Normal traffic: 20k ops/sec
Redis latency naik
Client retry x3
Effective attempted traffic: 60k ops/sec
Redis makin lambat
Timeout makin banyak
Retry makin banyak
```

### 12.2 Gejala

- Redis command rate naik saat Redis sedang sakit.
- Client timeout bertambah.
- Thread pool penuh.
- Connection pool exhausted.
- GC meningkat karena command futures dan exceptions.
- Downstream DB ikut terkena karena cache miss/fallback.

### 12.3 Prinsip Retry Redis

Redis command tidak selalu aman untuk retry.

| Command | Retry safe? | Catatan |
|---|---:|---|
| `GET` | Umumnya ya | Read-only |
| `MGET` | Umumnya ya | Read-only |
| `SET key value` | Tergantung | Idempotent jika same value acceptable |
| `INCR` | Tidak otomatis | Retry bisa double increment |
| `LPUSH` | Tidak otomatis | Retry bisa duplicate |
| `XADD` | Tidak otomatis | Retry bisa duplicate event |
| Lua script mutating | Tergantung | Harus didesain idempotent |

### 12.4 Pattern Lebih Aman

- Timeout kecil dan eksplisit.
- Retry hanya untuk read atau operation idempotent.
- Exponential backoff + jitter.
- Circuit breaker.
- Bulkhead per Redis use case.
- Fallback semantics jelas.
- Observability untuk retry count.

---

## 13. Anti-Pattern #11 — Distributed Lock Abuse

### 13.1 Bentuk Umum

```text
Use Redis lock to protect every critical business operation.
```

Contoh:

```text
lock:account:{accountId}
lock:case:{caseId}
lock:tenant:{tenantId}
lock:workflow:{workflowId}
```

Semua dianggap selesai dengan `SET NX PX`.

### 13.2 Problem

Redis lock adalah lease, bukan monitor lock lokal, bukan database transaction, bukan linearizable global mutex dalam semua failure mode.

Bahaya:

- lease expire saat critical section masih berjalan;
- JVM pause;
- network partition;
- delayed unlock;
- failover kehilangan lock key;
- lock holder tidak sama dengan writer yang seharusnya;
- tidak ada fencing token;
- critical section melakukan side effect eksternal.

### 13.3 Red Flag

Kalimat ini harus membuat kamu waspada:

> “Tidak mungkin double process karena sudah pakai Redis lock.”

Jawaban senior:

> “Apa yang mencegah stale lock holder melakukan write setelah lease-nya expired?”

### 13.4 Pattern Lebih Aman

Untuk resource update penting:

- gunakan DB transaction atau optimistic locking jika source of truth di DB;
- gunakan unique constraint untuk idempotency;
- gunakan fencing token jika lock melindungi external resource;
- gunakan queue partitioning jika butuh serial processing;
- gunakan Redis lock hanya sebagai optimization, bukan satu-satunya correctness guard.

---

## 14. Anti-Pattern #12 — Idempotency Key Terlalu Pendek atau Terlalu Sederhana

### 14.1 Bentuk Umum

```text
SETNX idem:{requestId} 1 EX 60
```

Tampak benar. Tapi gagal jika:

- retry client terjadi setelah 60 detik;
- mobile app resend setelah reconnect;
- payment gateway callback ulang setelah beberapa jam;
- worker retry dari queue setelah delay panjang;
- same requestId dipakai dengan payload berbeda;
- request pertama berhasil tetapi response hilang.

### 14.2 Idempotency Bukan Boolean

Idempotency state minimal:

```json
{
  "state": "STARTED|COMPLETED|FAILED",
  "requestHash": "...",
  "responseSnapshot": "...",
  "createdAt": "...",
  "completedAt": "..."
}
```

### 14.3 Pertanyaan Review

1. Berapa lama duplicate mungkin datang?
2. Apakah payload fingerprint disimpan?
3. Apakah response sukses bisa direplay?
4. Apa yang terjadi jika process crash setelah side effect tetapi sebelum set completed?
5. Apakah TTL mencakup retry horizon?
6. Apakah idempotency key scope benar: user? tenant? endpoint? operation?

---

## 15. Anti-Pattern #13 — Shared Redis untuk Semua Bounded Context

### 15.1 Bentuk Umum

Satu Redis dipakai untuk:

- session;
- cache product;
- rate limiter;
- locks;
- Streams;
- feature flags;
- idempotency;
- temporary workflow state;
- analytics counters.

Semua berada di satu cluster, satu memory pool, satu eviction policy, satu security boundary, satu blast radius.

### 15.2 Masalah

Use case Redis punya kebutuhan berbeda.

| Use case | Memory | Eviction | Persistence | Latency | Security |
|---|---|---|---|---|---|
| Cache | Volatile | boleh | tidak critical | very low | moderate |
| Session | bounded | hati-hati | mungkin perlu | low | high |
| Rate limiter | small TTL | noeviction preferred | not durable | very low | high |
| Lock | tiny TTL | noeviction preferred | not durable | very low | high |
| Streams | grows | dangerous | mungkin perlu | medium | high |
| Search/vector | high memory | tidak sembarang | depends | query-heavy | high |

Satu Redis untuk semua membuat policy compromise.

### 15.3 Desain Lebih Baik

Pisahkan minimal berdasarkan:

- criticality;
- eviction safety;
- persistence requirement;
- workload pattern;
- ownership team;
- security boundary;
- operational blast radius.

Contoh:

```text
redis-cache-cluster
redis-coordination-cluster
redis-streams-cluster
redis-search-cluster
```

Tidak selalu harus fisik terpisah sejak awal, tapi design harus tahu kapan harus dipisah.

---

## 16. Anti-Pattern #14 — No Ownership Model untuk Keyspace

### 16.1 Bentuk Umum

Key dibuat bebas oleh banyak service:

```text
user:123
users:123
cache:user:123
profile:123
usr:123
spring:cache:user::123
```

Tidak ada registry, tidak ada convention, tidak ada owner.

### 16.2 Masalah

- Collision.
- Type mismatch.
- Sulit cleanup.
- Sulit audit.
- Sulit capacity planning.
- Sulit migration.
- Sulit mengetahui key mana aman dihapus.
- Sulit menerapkan ACL key pattern.

### 16.3 Key Contract Template

Setiap key pattern penting harus punya kontrak.

```text
Key Pattern       : cache:user-profile:v1:{tenantId}:{userId}
Owner             : identity-service
Type              : String JSON
Source of Truth   : PostgreSQL identity.users
TTL               : 5-7 minutes jittered
Eviction Safe     : yes
Persistence Needed: no
Max Value Size    : 16 KB
Cardinality       : active users in last 7 days
Cluster Hash Tag  : none
Invalidation      : user-profile-updated event
Security Scope    : identity-service read/write, others none
Observability     : hit/miss, load latency, value size sample
Migration Plan    : v2 key with dual-read during rollout
```

---

## 17. Anti-Pattern #15 — Blind Spring Cache Usage

### 17.1 Bentuk Umum

```java
@Cacheable("users")
public User getUser(String id) { ... }
```

Tanpa memikirkan:

- key format;
- serialization;
- TTL;
- null caching;
- invalidation;
- cache stampede;
- cluster key design;
- value size;
- per-cache policy;
- observability;
- security sensitivity.

### 17.2 Mengapa Berbahaya

Spring Cache abstraction menyederhanakan usage, tetapi juga bisa menyembunyikan Redis sebagai distributed system.

Masalah umum:

- key tidak stabil saat method signature berubah;
- object serialized dengan format yang sulit dimigrasi;
- cache name terlalu umum;
- TTL default tidak sesuai;
- cache update tidak sinkron dengan DB transaction;
- self-invocation membuat annotation tidak aktif;
- no explicit negative caching behavior.

### 17.3 Rule

> Spring Cache boleh dipakai untuk cache sederhana, tetapi semua cache penting tetap harus punya explicit cache contract.

Untuk cache yang correctness-sensitive, lebih baik explicit Redis access daripada annotation magic.

---

## 18. Anti-Pattern #16 — Serialization Sebagai Afterthought

### 18.1 Bentuk Umum

- Java native serialization.
- Class name masuk payload.
- Tidak ada schema version.
- Payload terlalu besar.
- Format berubah tanpa backward compatibility.
- Tidak ada compression threshold.
- Tidak ada deserialization failure path.

### 18.2 Failure Mode

Deploy versi baru:

```text
Old cache payload -> New class incompatible -> deserialization error -> request fails
```

Atau:

```text
New service writes new JSON field shape -> old service reads -> fails silently
```

### 18.3 Pattern Lebih Baik

- Prefer JSON untuk cache human-debuggable.
- Gunakan explicit version field.
- Gunakan tolerant readers.
- Batasi payload size.
- Gunakan compression hanya setelah threshold dan measurement.
- Jangan deserialize untrusted data tanpa kontrol.
- Jangan simpan domain object internal langsung sebagai cache contract.

Contoh payload:

```json
{
  "schemaVersion": 2,
  "cachedAtEpochMs": 1760000000000,
  "sourceVersion": 123456,
  "data": {
    "userId": "u-123",
    "displayName": "Ayu",
    "status": "ACTIVE"
  }
}
```

---

## 19. Anti-Pattern #17 — Unsafe Eviction Policy

### 19.1 Bentuk Umum

Redis punya `maxmemory-policy allkeys-lru` untuk semua use case, termasuk:

- locks;
- idempotency keys;
- rate limiter state;
- session;
- cache;
- stream metadata.

Saat memory pressure, Redis menghapus key yang dianggap eligible.

### 19.2 Masalah

Tidak semua key boleh dievict.

| Key | Eviction safe? |
|---|---:|
| product cache | Ya |
| session | Tergantung |
| idempotency completed result | Biasanya tidak selama retry horizon |
| lock key | Jika dievict, lock semantics rusak |
| rate limiter quota | Jika dievict, enforcement bocor |
| audit marker | Tidak |
| workflow state | Biasanya tidak |

### 19.3 Pattern Lebih Aman

- Pisahkan Redis cache dari Redis coordination.
- Untuk coordination, pertimbangkan `noeviction`.
- Set memory budget dan alert sebelum limit.
- Gunakan TTL tetapi jangan bergantung pada eviction.
- Monitor evicted keys.
- Treat eviction of non-cache keys as correctness incident.

---

## 20. Anti-Pattern #18 — Blocking Commands Campur dengan Traffic Normal

### 20.1 Bentuk Umum

Satu connection pool dipakai untuk:

- `GET` cache;
- `SET` session;
- `BLPOP` worker;
- Streams blocking read;
- Lua scripts;
- Pub/Sub listener.

### 20.2 Masalah

Blocking command bisa menahan connection. Pub/Sub connection punya mode khusus. Streams blocking read punya behavior berbeda. Lua script lambat bisa mengganggu event loop.

Jika semua dicampur:

- pool exhaustion;
- normal request timeout;
- starvation;
- hard-to-debug latency.

### 20.3 Pattern Lebih Baik

Gunakan connection separation:

```text
redisConnectionFactoryCache
redisConnectionFactoryBlockingWorkers
redisConnectionFactoryPubSub
redisConnectionFactoryAdminOps
```

Atau minimal logical separation dengan client resources dan pool settings berbeda.

---

## 21. Anti-Pattern #19 — Lua/Function Terlalu Berat

### 21.1 Bentuk Umum

Script melakukan:

- scan banyak key;
- loop ribuan item;
- JSON/string processing besar;
- complex business logic;
- call command berat;
- return payload besar.

### 21.2 Masalah

Lua script atomic berarti selama script berjalan, Redis tidak menjalankan command lain. Atomicity bukan gratis.

### 21.3 Rule

> Lua harus menjaga invariant kecil, bukan menjadi application service di dalam Redis.

Bagus:

- compare-and-delete lock;
- atomic rate limiter;
- small CAS;
- bounded multi-step update.

Buruk:

- workflow engine;
- pricing engine;
- authorization engine kompleks;
- scanning all tenant data;
- joining banyak logical table.

---

## 22. Anti-Pattern #20 — Redis Cluster Multi-Key Assumption

### 22.1 Bentuk Umum

Di single Redis:

```bash
MGET user:1 profile:1 permission:1
```

Lalu pindah ke Cluster dan terkena:

```text
CROSSSLOT Keys in request don't hash to the same slot
```

### 22.2 Masalah

Redis Cluster membatasi multi-key operation pada key di slot yang sama. Jika sejak awal key design tidak mempertimbangkan slot, migration ke cluster menyakitkan.

### 22.3 Pattern

Jika beberapa key harus dioperasikan bersama secara atomic atau multi-key:

```text
user:{123}:profile
user:{123}:permission
user:{123}:quota
```

Hash tag `{123}` membuat key berada di slot sama.

Tapi jangan overuse hash tag sampai semua key tenant besar masuk satu slot hot.

---

## 23. Anti-Pattern #21 — Local Cache Tanpa Invalidation Discipline

### 23.1 Bentuk Umum

Untuk mengurangi Redis hot key, service menambah Caffeine/local cache.

Masalahnya:

- tidak ada invalidation;
- TTL terlalu panjang;
- semua instance punya stale value berbeda;
- deploy rolling membuat behavior inconsistent;
- Redis update tidak sampai ke local cache.

### 23.2 Pattern Lebih Baik

- Local cache only for data with acceptable stale tolerance.
- Short TTL.
- Pub/Sub/keyspace notification/client-side caching jika cocok.
- Versioned value.
- Manual bypass untuk sensitive operation.
- Metrics per layer: local hit, Redis hit, origin load.

---

## 24. Anti-Pattern #22 — No Backpressure untuk Redis-Dependent Flow

### 24.1 Bentuk Umum

Worker membaca job dari Redis lebih cepat daripada downstream mampu memproses.

Atau API menulis event ke Redis Streams tanpa retention/memory bound.

### 24.2 Gejala

- Redis memory naik terus.
- Pending Entries List membesar.
- Consumer lag tinggi.
- Trim policy tidak jelas.
- Reclaim message menghasilkan duplicate storm.
- Worker restart membuat backlog spike.

### 24.3 Pattern Lebih Baik

- Bounded queue/stream length.
- Consumer lag metrics.
- Dead-letter strategy.
- Retry limit.
- Backoff.
- Origin/API throttling.
- Separate Redis for stream workload.

---

## 25. Anti-Pattern #23 — Observability Setelah Incident

### 25.1 Bentuk Umum

Redis dipasang tanpa:

- hit/miss metric;
- command latency;
- pool wait time;
- timeout count;
- retry count;
- evicted keys;
- expired keys;
- used memory ratio;
- fragmentation ratio;
- slowlog collection;
- replication lag;
- stream lag;
- hot key visibility.

### 25.2 Problem

Saat incident, team hanya tahu:

> “Redis lambat.”

Tapi tidak tahu apakah penyebabnya:

- network;
- big key;
- hot key;
- memory pressure;
- fork/AOF;
- slow command;
- pool exhaustion;
- retry storm;
- failover;
- client bug;
- cluster redirection;
- CPU saturation.

### 25.3 Minimum Dashboard

```text
Client-side:
- operation count by command/use case
- latency p50/p95/p99
- timeout count
- retry count
- pool active/idle/wait
- serialization failure
- cache hit/miss/load latency

Redis-side:
- used_memory / maxmemory
- evicted_keys
- expired_keys
- connected_clients
- rejected_connections
- instantaneous_ops_per_sec
- commandstats
- slowlog count
- latency spikes
- replication lag
- keyspace hits/misses

Workload-specific:
- rate limiter allowed/blocked/error
- idempotency started/completed/replay/conflict
- stream pending/lag/claim/deadletter
- lock acquire success/fail/expired/held duration
```

---

## 26. Failure Case Study #1 — Missing TTL Membuat Redis OOM

### 26.1 Scenario

Service menyimpan cache user profile:

```text
cache:user:{userId}
```

Tidak ada TTL karena profile jarang berubah.

### 26.2 Timeline

```text
Day 1    : deploy cache, hit ratio bagus
Week 2   : memory naik pelan
Month 2  : active user naik, key count naik
Month 3  : maxmemory tercapai
Incident : Redis mulai evict key penting, latency naik, cache hit ratio turun, DB spike
```

### 26.3 Root Cause

Bukan “Redis memory kecil”. Root cause:

- tidak ada lifecycle contract;
- tidak ada capacity model;
- cache dipakai sebagai storage permanen;
- no alert on memory growth slope;
- no per-key-pattern cardinality budget.

### 26.4 Fix

- Tambah TTL + jitter.
- Pisahkan cache dan non-cache keys.
- Tambah max value size guard.
- Dashboard key count approximation.
- Alert used memory ratio dan eviction.
- Dokumentasikan key contract.

---

## 27. Failure Case Study #2 — `KEYS` untuk Admin Cleanup Menjatuhkan Production

### 27.1 Scenario

Admin tool punya fitur:

```bash
KEYS tenant:123:cache:*
DEL ...
```

Di staging hanya 10 ribu key. Di production ada 30 juta key.

### 27.2 Impact

- Redis event loop blocked.
- App p99 naik dari 20 ms ke 5 detik.
- Client timeout.
- Retry storm.
- DB load naik karena cache miss.

### 27.3 Root Cause

- Admin command tidak direview seperti production API.
- Tidak ada command restriction/ACL.
- Tidak ada slowlog alert.
- Tidak ada load test dengan key cardinality realistis.

### 27.4 Fix

- Hapus `KEYS` dari app/admin path.
- Gunakan explicit index untuk tenant cache keys.
- Gunakan SCAN job dengan rate limit jika perlu.
- Restrict dangerous commands.
- Admin operation harus punya dry-run, bound, progress, cancellation.

---

## 28. Failure Case Study #3 — Lock Expired Saat JVM GC Pause

### 28.1 Scenario

Worker mengambil Redis lock:

```text
SET lock:case:42 token NX PX 10000
```

Critical section update external system butuh 8 detik normal.

Saat GC pause 20 detik:

```text
T0   worker A gets lock
T5   worker A enters GC pause
T10  lock expires
T11  worker B gets lock
T12  worker B updates external system
T25  worker A resumes and updates external system
```

### 28.2 Impact

Double processing.

### 28.3 Root Cause

- Lock dianggap mutual exclusion absolut.
- Tidak ada fencing token.
- Critical section bisa melebihi lease.
- External side effect tidak menolak stale actor.

### 28.4 Fix

- Tambah fencing token monotonic.
- External system/storage harus reject stale token.
- Atau pindahkan correctness ke DB optimistic lock/transaction.
- Gunakan lock hanya sebagai optimization.
- Monitor lock hold duration vs lease.

---

## 29. Failure Case Study #4 — Cache Stampede Setelah Deploy

### 29.1 Scenario

Deploy mengubah cache key version:

```text
cache:v1:product:{id}
-> cache:v2:product:{id}
```

Semua v2 key cold.

### 29.2 Impact

- Semua request miss.
- DB QPS naik 20x.
- Thread pool penuh.
- Redis baru terisi setelah origin sudah lambat.
- Autoscaling menambah instance yang memperparah origin pressure.

### 29.3 Root Cause

- Tidak ada cache warming.
- Tidak ada single-flight.
- Tidak ada stale fallback dari v1.
- TTL key lama tidak dimanfaatkan.
- Deploy cache version dianggap harmless.

### 29.4 Fix

- Dual-read during migration: try v2, fallback v1, fill v2.
- Warm hot keys before traffic shift.
- Single-flight.
- Rate limit origin load.
- Rollout gradual.

---

## 30. Failure Case Study #5 — Shared Redis Eviction Menghapus Idempotency Key

### 30.1 Scenario

Redis yang sama dipakai untuk cache dan idempotency.

Policy:

```text
maxmemory-policy allkeys-lru
```

Saat cache traffic naik, Redis evict old keys, termasuk:

```text
idem:payment:{requestId}
```

Client retry payment request. Karena idempotency key hilang, request diproses ulang.

### 30.2 Root Cause

- Idempotency key dianggap cache.
- Eviction safe tidak diklasifikasi.
- Workload critical dan volatile dicampur.
- Tidak ada alert evicted_keys untuk non-cache namespace.

### 30.3 Fix

- Pisahkan Redis cache dan Redis coordination/idempotency.
- Gunakan `noeviction` untuk critical transient state.
- Set TTL berdasarkan retry horizon.
- Simpan completed response atau durable idempotency record di DB untuk high-risk operation.

---

## 31. Failure Case Study #6 — Redis Streams Tanpa Trim Strategy

### 31.1 Scenario

Service menulis audit-like event ke stream:

```bash
XADD case-events * caseId 123 type UPDATED
```

Tidak ada `MAXLEN`, tidak ada retention, consumer lambat.

### 31.2 Impact

- Stream tumbuh terus.
- Redis memory naik.
- Snapshot/AOF besar.
- Restore lambat.
- Consumer group PEL membesar.

### 31.3 Root Cause

- Stream dianggap Kafka kecil.
- Retention tidak didefinisikan.
- Consumer lag tidak dimonitor.
- Redis memory budget tidak menghitung stream growth.

### 31.4 Fix

- Tentukan retention policy.
- Gunakan `XTRIM`/`MAXLEN` sesuai safety.
- Monitor lag dan PEL.
- Jangan gunakan Redis Streams sebagai audit log permanen kecuali durability/retention/recovery benar-benar dirancang.
- Untuk audit penting, tulis ke durable event store/database.

---

## 32. Failure Case Study #7 — Cluster Migration Gagal Karena Key Design

### 32.1 Scenario

Single Redis awalnya memakai:

```text
cart:{cartId}:items
cart:{cartId}:metadata
cart-owner:{userId}:{cartId}
```

Lua script update beberapa key sekaligus.

Saat migrasi ke Redis Cluster, keys masuk slot berbeda.

### 32.2 Impact

- Lua script gagal.
- Multi-key command gagal.
- Migration tertunda.
- Team melakukan hash tag darurat yang membuat hot slots.

### 32.3 Root Cause

- Tidak ada cluster-readiness sejak awal.
- Key co-location contract tidak ditulis.
- Multi-key invariant tersembunyi di script.

### 32.4 Fix

- Key design dengan hash tag untuk aggregate yang memang harus co-located.
- Hindari cross-aggregate atomic operation.
- Split invariant ke source-of-truth DB jika perlu.
- Buat cluster compatibility test sejak awal.

---

## 33. Failure Case Study #8 — Spring Cache Serialization Break Setelah Deploy

### 33.1 Scenario

Service pakai default Java serialization untuk cache DTO.

Deploy mengubah class:

```java
class UserProfile {
    String id;
    String displayName;
    AccountStatus status; // changed enum/package
}
```

Old payload masih ada di Redis.

### 33.2 Impact

- Deserialization error.
- Cache read gagal menjadi request error.
- Rolling deploy menyebabkan behavior beda antar versi.

### 33.3 Root Cause

- Cache payload bukan schema contract.
- No version field.
- No fallback on deserialization failure.
- No cache namespace versioning.

### 33.4 Fix

- JSON with schema version or stable binary schema.
- Namespace versioning.
- On deserialization failure: delete key and reload if safe.
- Avoid Java native serialization for distributed cache contract.

---

## 34. Redis Design Smell Checklist

Gunakan checklist ini saat review desain.

### 34.1 Lifecycle Smells

- Key tanpa TTL untuk data cache.
- TTL sama untuk semua data tanpa alasan domain.
- Tidak ada owner key.
- Tidak ada cleanup strategy.
- Missing key dianggap unexpected untuk cache.

### 34.2 Memory Smells

- Tidak ada memory budget.
- Tidak ada max value size.
- Container key bisa tumbuh tanpa batas.
- `used_memory` dimonitor, tapi fragmentation tidak.
- Eviction policy tidak sesuai use case.

### 34.3 Latency Smells

- `KEYS` di app/admin path.
- Full collection reads.
- Tidak ada pipelining untuk batch.
- Retry mutating command tanpa idempotency.
- Blocking commands memakai pool normal.
- Lua script tidak bounded.

### 34.4 Consistency Smells

- “Cache akan expired sendiri” untuk data critical.
- Lock dianggap correctness guarantee tunggal.
- Idempotency hanya boolean.
- No fencing token untuk external side effect.
- Redis failover tidak pernah disimulasikan.

### 34.5 Cluster Smells

- Multi-key operation tanpa hash tag plan.
- Tenant besar dimasukkan satu hash tag.
- Hot key tidak punya mitigation.
- Client tidak cluster-aware.
- Resharding tidak pernah diuji.

### 34.6 Java Smells

- Native Java serialization.
- `@Cacheable` tanpa cache contract.
- Connection pool tunggal untuk semua Redis workload.
- Timeout default library tanpa review.
- No metrics for Redis command latency.
- Deserialization failure menjadi HTTP 500.

### 34.7 Security Smells

- Satu password untuk semua service.
- No ACL.
- Dangerous commands available to application.
- Redis exposed beyond private network.
- Secrets muncul di logs/config.

---

## 35. Root Cause Analysis Template untuk Redis Incident

Saat Redis incident, jangan berhenti di “Redis lambat”. Gunakan template ini.

```text
Incident Name:
Date/Time:
Affected Services:
User Impact:

1. Symptom
- p99 latency:
- error rate:
- timeout count:
- Redis CPU:
- Redis memory:
- ops/sec:
- evicted_keys:
- connected_clients:
- slowlog entries:

2. Trigger
- deploy?
- traffic spike?
- cache version change?
- failover?
- memory limit?
- command introduced?
- workload change?

3. Redis-side Evidence
- INFO memory:
- INFO stats:
- INFO commandstats:
- SLOWLOG:
- LATENCY DOCTOR:
- replication lag:
- cluster redirections:

4. Client-side Evidence
- timeout:
- retry count:
- pool wait:
- serialization errors:
- cache hit/miss:
- fallback QPS:

5. Keyspace Evidence
- big keys:
- hot keys:
- key cardinality by pattern:
- TTL coverage:
- value size samples:

6. Failure Mechanism
- What invariant was violated?
- What assumption was false?
- What hidden coupling amplified impact?

7. Immediate Mitigation
- disable feature:
- reduce traffic:
- raise memory:
- change TTL:
- kill admin job:
- scale origin:
- flush safe namespace:

8. Long-Term Fix
- design change:
- key contract:
- workload separation:
- observability:
- test:
- runbook:

9. Prevention
- alert:
- review checklist:
- load test:
- chaos/failover test:
- ACL restriction:
```

---

## 36. Architecture Review Questions

Sebelum Redis design disetujui, jawab ini.

### 36.1 Purpose

1. Redis dipakai untuk apa?
2. Apakah Redis cache, coordination, queue, stream, session, search, atau database?
3. Apakah source of truth ada di tempat lain?
4. Apa yang terjadi kalau Redis kehilangan data?

### 36.2 Data Contract

1. Apa key pattern-nya?
2. Apa type Redis-nya?
3. Apa max cardinality?
4. Apa max value size?
5. Apa TTL?
6. Apakah eviction safe?
7. Siapa owner?

### 36.3 Correctness

1. Invariant apa yang dijaga?
2. Apakah Redis primitive cukup menjaga invariant itu?
3. Apa failure mode saat timeout?
4. Apa failure mode saat retry?
5. Apa failure mode saat failover?
6. Apa failure mode saat key expired?
7. Apa failure mode saat key evicted?

### 36.4 Performance

1. Berapa QPS expected?
2. Berapa p99 target?
3. Apakah ada hot key?
4. Apakah ada big key?
5. Apakah command bounded?
6. Apakah pipelining diperlukan?
7. Apakah local cache diperlukan?

### 36.5 Operations

1. Bagaimana backup/restore?
2. Bagaimana failover test?
3. Bagaimana migration?
4. Bagaimana observability?
5. Apa alert utama?
6. Apa runbook saat memory pressure?

### 36.6 Security

1. Service mana bisa membaca/menulis key apa?
2. Apakah ACL digunakan?
3. Apakah dangerous command diblokir?
4. Apakah TLS diperlukan?
5. Bagaimana secret rotation?

---

## 37. Production Readiness Gate

Sebuah Redis use case dianggap production-ready jika minimal memenuhi:

```text
[ ] Purpose jelas: cache/coordination/stream/session/search/etc.
[ ] Source of truth jelas.
[ ] Key contract terdokumentasi.
[ ] TTL atau lifecycle policy jelas.
[ ] Memory budget tersedia.
[ ] Eviction safety diklasifikasi.
[ ] Command complexity bounded.
[ ] Hot key/big key risk dinilai.
[ ] Java client timeout eksplisit.
[ ] Retry policy aman.
[ ] Serialization contract stabil.
[ ] Observability tersedia.
[ ] Failure behavior saat Redis down jelas.
[ ] Failover/restart tested untuk critical use case.
[ ] Security boundary dan ACL jelas.
[ ] Runbook tersedia.
```

---

## 38. Senior-Level Heuristics

### 38.1 Redis Is Fast Until You Make It Do Unbounded Work

Redis cepat untuk bounded operation.

Redis bisa lambat jika kamu melakukan:

- scan besar;
- full collection read;
- huge payload transfer;
- expensive script;
- big key deletion;
- hot key concentration;
- retry storm.

### 38.2 Cache Is Not a Truth Layer

Cache boleh mempercepat kebenaran. Cache tidak boleh diam-diam menjadi sumber kebenaran tanpa durability, audit, dan recovery model.

### 38.3 TTL Is a Business Contract

TTL bukan angka teknis. TTL menyatakan:

```text
Berapa lama sistem bersedia hidup dengan data ini?
```

### 38.4 Eviction Is Data Loss by Policy

Untuk cache, eviction normal. Untuk idempotency/lock/quota/workflow state, eviction bisa menjadi correctness bug.

### 38.5 Lock Without Fencing Is Often Just Hope

Redis lock mengurangi concurrency. Ia tidak selalu mencegah stale actor menulis setelah lease expire.

### 38.6 Observability Must Be Per Use Case

Redis global metrics tidak cukup. Kamu perlu tahu:

- cache hit/miss per cache;
- idempotency conflict/replay;
- rate limiter allow/block/error;
- lock acquire/fail/expired;
- stream lag;
- command latency per operation.

---

## 39. Mini Lab: Temukan Anti-Pattern

### 39.1 Design A

```text
User profile cached in Redis with key user:{id}, no TTL.
On update, service deletes user:{id}.
```

Masalah:

- key name terlalu umum;
- no namespace/version;
- no TTL;
- invalidation failure causes stale forever;
- no ownership;
- potential collision.

Perbaikan:

```text
cache:user-profile:v1:{tenantId}:{userId}
TTL 5-7 min jitter
Invalidation best effort
Source version in payload
Explicit owner identity-service
```

### 39.2 Design B

```text
Rate limiter uses INCR rl:api and EXPIRE 60.
```

Masalah:

- global hot key;
- all users share quota;
- no atomic guarantee if expire not set correctly;
- not tenant/user scoped;
- possible retry double increment.

Perbaikan:

```text
rl:{tenantId}:{apiKey}:{endpoint}:{window}
Lua for atomic increment+expire
TTL aligned with window
Metrics allowed/blocked/error
```

### 39.3 Design C

```text
Admin dashboard lists all sessions with KEYS session:*.
```

Masalah:

- `KEYS` production hazard;
- sessions probably large cardinality;
- admin feature can impact user traffic.

Perbaikan:

- explicit session index;
- SCAN background job with rate limit;
- query durable store;
- separate admin Redis connection;
- ACL restrict `KEYS`.

### 39.4 Design D

```text
Payment service uses Redis idempotency key with TTL 5 minutes.
```

Masalah potensial:

- payment retries can exceed 5 minutes;
- no response replay;
- no payload hash;
- eviction policy unknown;
- high-risk domain may need DB-backed idempotency.

Perbaikan:

- TTL based on gateway retry horizon;
- store state + payload hash + response;
- durable DB unique constraint for high-risk transaction;
- Redis as acceleration only.

---

## 40. Ringkasan

Anti-pattern Redis hampir selalu berasal dari satu dari empat sumber:

1. **Unboundedness**  
   Key, command, payload, cardinality, retry, atau queue tumbuh tanpa batas.

2. **Wrong correctness assumption**  
   Cache dianggap truth, lock dianggap transaction, TTL dianggap harmless, eviction dianggap hanya performance issue.

3. **Hidden coupling**  
   Banyak bounded context memakai Redis yang sama, key names menjadi API informal, local cache tidak punya invalidation, command admin mempengaruhi request path.

4. **No operational contract**  
   Tidak ada observability, memory budget, backup, failover test, security boundary, atau runbook.

Engineer Redis yang kuat bukan hanya tahu command. Ia tahu kapan Redis mempercepat sistem, kapan Redis memperumit correctness, dan kapan Redis harus ditolak sebagai solusi.

---

## 41. Checklist Pribadi Setelah Bagian Ini

Kamu sudah memahami bagian ini jika bisa menjawab:

1. Mengapa cache tanpa TTL bisa berubah menjadi database bayangan?
2. Apa beda big key dan hot key?
3. Mengapa `KEYS` berbahaya di production?
4. Mengapa full collection command harus bounded?
5. Mengapa Redis lock bukan jaminan correctness mutlak?
6. Mengapa eviction bisa menjadi correctness bug?
7. Apa risiko shared Redis untuk cache dan idempotency?
8. Apa yang harus ada dalam Redis key contract?
9. Bagaimana cache stampede terjadi dan dicegah?
10. Apa metrik minimum untuk observability Redis?
11. Bagaimana menganalisis Redis incident secara struktural?
12. Bagaimana menilai apakah Redis use case production-ready?

---

## 42. Referensi Teknis

Referensi utama untuk bagian ini:

- Redis Documentation — `INFO` command and server metrics: https://redis.io/docs/latest/commands/info/
- Redis Documentation — Diagnosing latency issues: https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/
- Redis Documentation — Key eviction: https://redis.io/docs/latest/develop/reference/eviction/
- Redis Documentation — Redis Anti-Patterns Every Developer Should Avoid: https://redis.io/tutorials/redis-anti-patterns-every-developer-should-avoid/
- Redis Documentation — Cache-aside patterns and stampede considerations: https://redis.io/docs/latest/develop/use-cases/cache-aside/
- Redis Documentation — Redis slow log: https://redis.io/docs/latest/operate/rs/clusters/logging/redis-slow-log/

---

## 43. Status Seri

```text
Part 032 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-033.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Redis Design Patterns for Backend Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-033.md">Part 033 — Architecture Lab: Build a Production-Grade Redis Layer in Java ➡️</a>
</div>
