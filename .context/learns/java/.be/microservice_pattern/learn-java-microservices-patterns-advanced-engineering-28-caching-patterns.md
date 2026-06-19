# learn-java-microservices-patterns-advanced-engineering-28-caching-patterns

> Series: `learn-java-microservices-patterns-advanced-engineering`  
> Part: 28 of 35  
> Topic: Caching Pattern in Microservices  
> Java range: Java 8 sampai Java 25  
> Level: Advanced / architecture / production engineering

---

## 0. Tujuan Part Ini

Caching sering terlihat sederhana:

```text
request -> check cache -> cache hit -> return
                 |
                 v
              cache miss -> load DB -> put cache -> return
```

Tetapi dalam microservices, cache bukan hanya mekanisme performance. Cache adalah **copy dari data yang punya authority di tempat lain**. Artinya cache selalu membawa pertanyaan arsitektural:

1. Data ini authoritative atau turunan?
2. Berapa lama stale boleh diterima?
3. Siapa yang boleh membaca cache ini?
4. Siapa yang boleh mengubah atau menghapus cache ini?
5. Apa yang terjadi kalau cache down?
6. Apa yang terjadi kalau cache berisi data lama?
7. Apa yang terjadi kalau cache miss massal?
8. Apa yang terjadi kalau cache bocor antar tenant/user/role?
9. Apa yang terjadi kalau cache menjadi source of truth palsu?
10. Bagaimana cache diamati, diuji, dan dioperasikan?

Target part ini adalah membangun mental model bahwa cache adalah **controlled inconsistency mechanism**.

Cache mempercepat sistem dengan menukar sesuatu:

```text
performance gain
    ditukar dengan
freshness risk + invalidation complexity + security risk + operational dependency
```

Engineer biasa bertanya:

> “Pakai Redis atau local cache?”

Engineer senior bertanya:

> “Data mana yang boleh stale, stale sampai berapa lama, siapa authority-nya, bagaimana invalidation-nya, bagaimana mencegah stampede, bagaimana mencegah tenant leakage, dan bagaimana fallback ketika cache gagal?”

Engineer top-tier bertanya lebih jauh:

> “Apakah cache ini memperbaiki arsitektur, atau menutupi boundary/data/query design yang salah?”

---

## 1. Posisi Part Ini dalam Series

Sebelumnya kita sudah membahas:

1. distributed systems reality
2. service boundary
3. domain modeling
4. architecture styles
5. synchronous API
6. asynchronous messaging
7. event-driven architecture
8. saga dan compensation
9. outbox/inbox/CDC
10. consistency dan distributed invariant
11. data ownership
12. query pattern
13. gateway/BFF
14. discovery/config/runtime topology
15. resilience
16. backpressure
17. idempotency
18. workflow/process manager
19. state machine
20. service-to-service security
21. multi-tenancy
22. observability
23. testing strategy
24. contract/schema compatibility
25. deployment/release safety
26. runtime platform
27. performance engineering

Caching muncul setelah semua itu karena cache menyentuh hampir semua aspek tersebut.

Cache yang salah bisa merusak:

- consistency
- security
- tenant isolation
- authorization
- auditability
- release safety
- data ownership
- query correctness
- incident recovery
- operational cost

Caching bukan “fitur tambahan”. Dalam sistem besar, caching adalah **arsitektur data kedua** yang harus dirancang dengan disiplin hampir sama seperti database.

---

## 2. Apa Itu Cache?

Cache adalah penyimpanan data cepat yang berisi salinan, hasil komputasi, atau representasi turunan dari data lain.

Secara konseptual:

```text
authoritative source -> derived fast access copy
```

Contoh authoritative source:

- database service owner
- document store
- external API
- identity provider
- pricing/rules engine
- policy service
- case management service
- configuration authority

Contoh cache:

- local in-memory cache di JVM
- Redis
- Memcached
- CDN cache
- browser cache
- HTTP proxy cache
- API gateway response cache
- materialized read model
- search index
- application-level computed cache
- ORM second-level cache
- token/introspection cache
- authorization decision cache

Tetapi tidak semua read model adalah cache.

Perbedaan penting:

| Jenis | Authority? | Bisa stale? | Tujuan |
|---|---:|---:|---|
| Database owner | Ya | Tidak seharusnya | source of truth |
| Projection/read model | Biasanya derived authority untuk query | Bisa | query optimization |
| Cache | Tidak | Ya | performance/load reduction |
| Search index | Derived | Ya | search/query |
| Audit log | Authority historis | Tidak boleh hilang/diubah | defensibility |
| Event log | Authority perubahan/fact jika event sourcing | Tidak boleh sembarang diubah | reconstruction |

Mental model paling aman:

```text
Cache is never the authority unless the architecture explicitly defines it as the authority.
```

Kalau tidak jelas, anggap cache **bukan** source of truth.

---

## 3. Mengapa Microservices Membutuhkan Cache?

Microservices menambah hop dan boundary:

```text
UI -> Gateway -> BFF -> Service A -> Service B -> DB
                              |
                              v
                          Service C -> DB
```

Cache sering dipakai untuk mengurangi:

1. latency remote call
2. database load
3. repeated computation
4. external API cost
5. fan-out query cost
6. authorization/policy evaluation cost
7. repeated configuration lookup
8. rate-limit pressure ke dependency
9. cold start data loading
10. expensive aggregation

Tetapi caching dalam microservices lebih sulit daripada caching dalam monolith karena:

1. data tersebar di banyak owner
2. update terjadi di service berbeda
3. consumer berbeda punya freshness tolerance berbeda
4. authorization context berbeda
5. tenant context berbeda
6. event arrival bisa terlambat/out of order
7. deploy versi berbeda berjalan bersamaan
8. cache key/schema bisa berubah
9. invalidation bisa race dengan update
10. observability lebih sulit

---

## 4. The Core Truth: Cache Is a Consistency Trade-off

Cache selalu membawa risiko stale.

Contoh:

```text
T0: user role = OFFICER
T1: role dicabut menjadi SUSPENDED
T2: cache masih menyimpan OFFICER
T3: user masih bisa akses operasi sensitif
```

Itu bukan sekadar cache bug. Itu security incident.

Contoh lain:

```text
T0: application status = PENDING_REVIEW
T1: officer approves application -> APPROVED
T2: worklist cache masih menampilkan PENDING_REVIEW
T3: officer lain mencoba approve lagi
```

Itu bukan sekadar stale UI. Itu correctness risk.

Karena itu, setiap cache harus punya **freshness contract**.

Contoh freshness contract:

```text
Postal code lookup:
  stale up to 24h acceptable.

Application worklist:
  stale up to 10s acceptable for display,
  but action endpoint must validate current state.

Authorization decision:
  stale up to 0-60s depending risk,
  sensitive admin operation must re-check authority.

Payment status:
  stale display acceptable,
  command must be idempotent and verify authoritative state.

Regulatory enforcement status:
  stale dashboard acceptable,
  legal action transition must use authoritative state.
```

Top-tier caching design starts from this question:

```text
What wrong decision can be made if this cached value is stale?
```

If stale data can cause irreversible, illegal, financial, or security-critical action, cache must not be used as final authority.

---

## 5. Cache Taxonomy by Location

### 5.1 Local In-Process Cache

Data disimpan di memory JVM service.

```text
Service instance memory:
  Map / Caffeine / Guava / custom structure
```

Kelebihan:

- sangat cepat
- tidak ada network hop
- mengurangi Redis/database load
- cocok untuk small reference data
- cocok untuk computed data lokal

Kekurangan:

- tidak konsisten antar instance
- hilang saat restart
- invalidation lebih sulit
- memory pressure di JVM
- bisa menyebabkan stale per instance

Cocok untuk:

- feature flag snapshot dengan TTL pendek
- configuration read-mostly
- static reference data
- compiled regex/rule object
- metadata schema
- permission matrix low-risk
- external token metadata dengan TTL jelas

Tidak cocok untuk:

- data sering berubah
- authorization keputusan high-risk tanpa TTL kecil
- data besar
- data tenant-sensitive tanpa key discipline
- cross-instance coordination

---

### 5.2 Distributed Cache

Data disimpan di service cache bersama seperti Redis/Memcached.

```text
Service A ----\
Service B ----- Redis
Service C ----/
```

Kelebihan:

- shared across instances
- bisa mengurangi DB load besar-besaran
- TTL dan eviction built-in
- bisa dipakai untuk distributed coordination ringan
- bisa dipakai sebagai near-real-time lookup store

Kekurangan:

- network hop
- operational dependency baru
- cache cluster bisa menjadi bottleneck
- failure mode tambahan
- key design lebih kompleks
- serialization/versioning perlu disiplin
- multi-tenant security risk

Cocok untuk:

- frequently-read data
- session-like metadata
- token/introspection cache
- rate limiter counters
- idempotency record sementara
- expensive lookup
- external API response cache
- BFF aggregation cache

Tidak cocok sebagai:

- primary transaction store kecuali memang dirancang demikian
- audit source of truth
- legal evidence store
- replacement database tanpa durability model
- cross-service shared mutable object store

---

### 5.3 Edge/CDN Cache

Data dicache di dekat client atau di gateway/CDN.

```text
Client -> CDN/Edge -> Origin
```

Cocok untuk:

- static assets
- public content
- documentation
- image/file downloads
- read-only public metadata
- API response yang aman dipublikkan/di-scope dengan benar

Berbahaya untuk:

- user-specific response tanpa `Vary`/authorization-aware key
- tenant-specific data
- sensitive regulatory data
- response yang tergantung role
- data yang harus real-time

Edge cache harus sangat disiplin terhadap:

- `Cache-Control`
- `Authorization`
- `Vary`
- tenant/user/role keying
- purge/invalidation
- stale-if-error policy

---

### 5.4 Browser Cache

Browser cache berguna untuk asset dan response tertentu, tetapi berbahaya untuk sensitive data.

Rule umum:

```text
Sensitive user/regulatory data:
  Cache-Control: no-store

Static versioned asset:
  Cache-Control: public, max-age=31536000, immutable

Semi-static public data:
  Cache-Control: public, max-age=<bounded>
```

Untuk sistem enterprise/regulatory, default aman untuk API authenticated sering:

```http
Cache-Control: no-store
```

Kecuali ada alasan eksplisit dan desain key/security yang benar.

---

### 5.5 Database/Internal Engine Cache

Database punya buffer pool/cache sendiri. JVM punya JIT/code cache. OS punya page cache.

Kadang application cache tidak dibutuhkan karena:

- database sudah cukup cepat
- query sudah indexed
- DB buffer cache tinggi hit ratio
- application cache menambah stale risk tanpa benefit signifikan

Pertanyaan penting:

```text
Apakah kita caching karena query lambat,
atau karena query design/index/data ownership salah?
```

Kalau penyebabnya index buruk, cache hanya menutupi masalah.

---

## 6. Cache Taxonomy by Data Type

### 6.1 Reference Data Cache

Contoh:

- country list
- postal code mapping
- agency code
- form category
- static lookup

Biasanya:

- read-heavy
- update jarang
- stale tolerance cukup tinggi

Strategy:

- TTL panjang
- event invalidation saat berubah
- warmup opsional
- local + distributed cache mungkin masuk akal

---

### 6.2 Computed Result Cache

Contoh:

- eligibility calculation result
- dashboard aggregate
- report summary
- rule evaluation output

Pertanyaan penting:

1. Input apa saja memengaruhi output?
2. Apakah semua input masuk cache key?
3. Apakah rule version masuk cache key?
4. Apakah policy version masuk cache key?
5. Apakah actor/tenant/role memengaruhi output?

Cache key untuk computed result sering harus mencakup:

```text
businessKey + ruleVersion + inputHash + tenantId + actorScope
```

Kalau tidak, hasil bisa salah.

---

### 6.3 Aggregation Cache

Contoh:

- BFF homepage summary
- officer dashboard count
- case overview
- application details gabungan banyak service

Risiko:

- fan-out disembunyikan
- stale sebagian
- authorization berubah
- partial dependency failure
- invalidation kompleks

Strategy:

- gunakan freshness label
- partial response explicit
- command tetap validasi authoritative state
- jangan jadikan aggregation cache sebagai decision authority

---

### 6.4 Authorization/Policy Cache

Contoh:

- user roles
- permission matrix
- token introspection result
- policy decision result
- group membership

Ini high-risk.

Rule:

```text
Cache authorization only with explicit risk acceptance.
```

Harus jelas:

- TTL maksimal
- revocation behavior
- emergency purge
- admin action revalidation
- tenant isolation
- actor identity
- audience/scope
- policy version

Untuk operasi sensitif:

```text
cached decision boleh mempercepat pre-check,
tetapi final command harus validate authoritative permission.
```

---

### 6.5 Idempotency Cache

Idempotency key sering disimpan dengan TTL.

Contoh:

```text
idem:{tenantId}:{operation}:{idempotencyKey}
```

Data yang disimpan:

- request hash
- operation status
- result reference
- createdAt
- expiresAt

Perhatian:

- kalau TTL terlalu pendek, duplicate request lama bisa diproses ulang
- kalau TTL terlalu panjang, memory/cost naik
- untuk high-critical operation, database/inbox table lebih aman daripada volatile cache

---

### 6.6 Session Cache

Session cache umum dipakai untuk:

- user session
- login metadata
- temporary auth state
- OAuth2/OIDC state/nonce

Perhatian:

- session fixation
- logout propagation
- revocation
- concurrent session
- TTL idle vs absolute
- encryption/signature
- tenant/user binding

---

### 6.7 Negative Cache

Negative caching menyimpan fakta bahwa sesuatu tidak ditemukan atau gagal.

Contoh:

```text
postalCode:999999 -> NOT_FOUND, TTL 5m
user:abc -> NOT_FOUND, TTL 30s
externalAgency:XYZ -> TEMP_UNAVAILABLE, TTL 10s
```

Manfaat:

- mencegah repeated miss
- mengurangi DB/API pressure
- melindungi dependency dari brute force/key scanning

Risiko:

- data baru dibuat tapi cache masih `NOT_FOUND`
- error sementara dicache sebagai permanent not found

Rule:

```text
Negative cache TTL biasanya jauh lebih pendek daripada positive cache TTL.
```

---

## 7. Cache Pattern Utama

### 7.1 Cache-Aside / Lazy Loading

Pattern paling umum.

Flow read:

```text
1. app checks cache
2. if hit -> return
3. if miss -> load authoritative source
4. app stores result in cache with TTL
5. return result
```

Pseudo-code:

```java
public ApplicationView getApplicationView(ApplicationId id) {
    String key = "application:view:" + id.value();

    ApplicationView cached = cache.get(key, ApplicationView.class);
    if (cached != null) {
        return cached;
    }

    ApplicationView loaded = repository.loadApplicationView(id);
    cache.put(key, loaded, Duration.ofSeconds(30));
    return loaded;
}
```

Kelebihan:

- sederhana
- hanya cache data yang dibaca
- flexible
- cocok untuk banyak read-heavy workload

Kekurangan:

- cache miss latency tinggi
- stampede saat popular key expire
- stale setelah write jika tidak invalidate/update
- aplikasi bertanggung jawab atas cache logic

Cocok untuk:

- lookup data
- read-heavy endpoint
- external API result
- BFF response tertentu

Tidak cukup untuk:

- high correctness transition
- write-heavy data
- data dengan invalidation kompleks

---

### 7.2 Read-Through Cache

Aplikasi meminta data ke cache. Cache yang memuat dari source saat miss.

```text
app -> cache -> loader -> source
```

Kelebihan:

- cache logic lebih terpusat
- aplikasi lebih sederhana

Kekurangan:

- loader logic tersembunyi di cache layer
- lebih sulit untuk domain-specific authorization
- tidak semua cache product mendukung pattern ini natural

---

### 7.3 Write-Through Cache

Saat write ke database, cache juga langsung di-update.

```text
write -> DB
      -> cache update
```

Kelebihan:

- cache lebih fresh
- read setelah write lebih mungkin hit

Kekurangan:

- write latency naik
- write path lebih kompleks
- dual-write risk jika tidak transactional
- cache berisi data yang mungkin jarang dibaca

Perhatian besar:

```text
DB update + cache update adalah dual-write problem.
```

Jika DB sukses tapi cache update gagal, cache stale.

Karena itu write-through butuh:

- transactional boundary yang jelas
- outbox invalidation/update event
- retry mechanism
- reconciliation

---

### 7.4 Write-Behind / Write-Back Cache

Write masuk cache dulu, kemudian async flush ke database.

```text
write -> cache -> async DB write
```

Kelebihan:

- write latency rendah
- bisa batch write

Kekurangan:

- data loss risk
- consistency risk besar
- ordering problem
- durability kompleks

Dalam enterprise/regulatory system, pattern ini sangat hati-hati.

Cocok untuk:

- metrics
- counters non-critical
- ephemeral analytics
- low-risk buffering

Tidak cocok untuk:

- audit trail
- legal state transition
- payment
- regulatory decision
- enforcement action

---

### 7.5 Write-Around Cache

Write hanya ke database. Cache tidak langsung diupdate. Cache akan diisi saat read berikutnya.

Kelebihan:

- mencegah cache diisi data yang tidak dibaca
- write path lebih sederhana

Kekurangan:

- first read setelah write miss
- stale risk jika old cache tidak dihapus

Umum dikombinasikan dengan invalidation:

```text
write DB -> invalidate cache key
next read -> reload
```

---

### 7.6 Refresh-Ahead

Cache di-refresh sebelum expire.

```text
if entry near expiration:
    trigger async refresh
return current value
```

Kelebihan:

- mengurangi miss latency
- mengurangi stampede

Kekurangan:

- bisa refresh data yang tidak lagi dibutuhkan
- butuh scheduling dan concurrency control

Cocok untuk:

- hot keys
- known popular reference data
- dashboard counters
- external API rate-limited data

---

### 7.7 Stale-While-Revalidate

Jika entry sudah stale tetapi masih dalam stale window, sistem mengembalikan data lama sambil refresh async.

```text
fresh window: return cache
stale window: return stale + refresh async
expired window: block/load fresh or fail
```

Contoh metadata:

```json
{
  "value": { "status": "PENDING_REVIEW" },
  "freshUntil": "2026-06-19T10:00:00Z",
  "staleUntil": "2026-06-19T10:05:00Z",
  "version": 42
}
```

Kelebihan:

- latency stabil
- melindungi origin saat spike
- cocok untuk data read-heavy yang boleh sedikit stale

Kekurangan:

- caller harus sadar stale possibility
- tidak cocok untuk final decision authority
- refresh failure harus dimonitor

Cocok untuk:

- dashboard
- listing
- public metadata
- homepage summary
- external lookup low-risk

Tidak cocok untuk:

- final authorization decision high-risk
- legal state transition
- irreversible commands

---

### 7.8 Stale-If-Error

Jika authoritative source gagal, cache boleh mengembalikan data stale.

```text
cache stale + source down -> return stale with warning/context
```

Kelebihan:

- availability lebih baik
- graceful degradation

Risiko:

- caller bisa mengambil keputusan berdasarkan data lama

Karena itu response harus bisa membawa metadata:

```json
{
  "data": {...},
  "freshness": {
    "state": "STALE_IF_ERROR",
    "asOf": "2026-06-19T09:55:00Z",
    "maxStaleSeconds": 300
  }
}
```

---

### 7.9 Single-Flight / Request Coalescing

Saat cache miss untuk key yang sama, hanya satu thread/request yang load. Request lain menunggu hasil yang sama.

Tanpa single-flight:

```text
1000 concurrent miss -> 1000 DB calls
```

Dengan single-flight:

```text
1000 concurrent miss -> 1 DB call + 999 wait/reuse
```

Pseudo-code Java:

```java
public final class SingleFlightCache<K, V> {
    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();

    public V getOrLoad(K key, Supplier<V> loader) {
        CompletableFuture<V> future = inFlight.computeIfAbsent(key, ignored ->
            CompletableFuture.supplyAsync(() -> {
                try {
                    return loader.get();
                } finally {
                    inFlight.remove(key);
                }
            })
        );

        return future.join();
    }
}
```

Production considerations:

- timeout waiting for in-flight load
- exception propagation
- remove future on failure
- limit total in-flight keys
- prevent unbounded memory
- context propagation if needed
- avoid executing blocking loader on common ForkJoinPool

---

### 7.10 Probabilistic Early Expiration

Daripada semua request melihat key expire pada waktu yang sama, refresh dipicu secara probabilistik sebelum TTL habis.

Tujuan:

- mengurangi synchronized expiration
- mencegah stampede
- meratakan load

Simplified idea:

```text
as entry approaches expiration,
some requests decide to refresh early based on probability.
```

Cocok untuk hot keys dengan traffic besar.

---

### 7.11 Cache Warming

Cache diisi sebelum traffic datang.

Contoh:

- warmup reference data saat startup
- warmup popular product/application metadata
- warmup after deployment
- warmup after cache flush

Risiko:

- startup lebih lambat
- thundering herd setelah deploy banyak instance
- data yang di-warmup belum tentu dibutuhkan
- origin overload saat mass warmup

Rule:

```text
Warm only known hot/small/critical data.
```

Gunakan jitter:

```text
instance startup warmup delay = random(0..N seconds)
```

---

### 7.12 Cache Invalidation

Kalimat klasik:

> There are only two hard things in Computer Science: cache invalidation and naming things.

Invalidation adalah proses membuat cache tidak lagi dipakai setelah authoritative data berubah.

Strategi:

1. TTL-only
2. explicit delete on write
3. update on write
4. event-driven invalidation
5. versioned keys
6. namespace/version bump
7. dependency-based invalidation
8. tag-based invalidation
9. write-through update
10. projection rebuild

Tidak ada strategi universal. Pilihan tergantung freshness risk.

---

## 8. TTL Engineering

TTL adalah kontrak freshness.

TTL buruk:

```text
cache for 1 hour because performance
```

TTL baik:

```text
cache for 30 seconds because:
- dashboard may be stale for <= 30s
- command endpoint validates authoritative state
- incident impact limited to display mismatch
- cache hit ratio target >= 80%
- invalidation event also available for important updates
```

### 8.1 TTL Harus Berdasarkan Risiko

| Data | Suggested TTL Thinking |
|---|---|
| static reference | hours/days |
| postal lookup | hours/days, depends provider update frequency |
| dashboard count | seconds/minutes |
| worklist | seconds |
| auth decision | very short or event-revoked |
| token introspection | bounded by token expiry/revocation risk |
| external API response | based on provider SLA and business risk |
| NOT_FOUND | short |
| error response | very short or no cache |

### 8.2 TTL Jitter

Jika semua keys expire serentak, terjadi spike.

Buruk:

```java
cache.put(key, value, Duration.ofMinutes(10));
```

Lebih baik:

```java
Duration base = Duration.ofMinutes(10);
long jitterSeconds = ThreadLocalRandom.current().nextLong(0, 60);
cache.put(key, value, base.plusSeconds(jitterSeconds));
```

Atau jitter negatif:

```text
TTL = base - random(0..jitter)
```

Tujuannya meratakan expiration.

### 8.3 Hard TTL vs Soft TTL

Soft TTL:

```text
freshUntil
```

Hard TTL:

```text
staleUntil / expireAt
```

Flow:

```text
now < freshUntil:
  return fresh

freshUntil <= now < staleUntil:
  return stale and refresh async

now >= staleUntil:
  block reload or fail
```

Ini lebih eksplisit daripada TTL tunggal.

---

## 9. Cache Key Design

Cache key adalah bagian dari correctness.

Key buruk:

```text
application:123
```

Key lebih baik:

```text
v3:tenant:CEA:application-view:123:role:OFFICER:locale:en-SG
```

Tapi key terlalu detail bisa menurunkan hit ratio.

Desain key adalah trade-off:

```text
correctness/isolation vs hit ratio
```

### 9.1 Elemen yang Mungkin Harus Masuk Key

- namespace
- schema version
- tenant id
- service/domain name
- entity id
- projection/view type
- actor role/scope
- locale
- permission scope
- API version
- rule version
- policy version
- filter/sort/page cursor
- input hash
- feature flag variant

### 9.2 Key Versioning

Tambahkan version prefix:

```text
v1:application:view:123
v2:application:view:123
```

Manfaat:

- deploy schema cache baru tanpa delete semua key lama
- old instances masih bisa baca v1
- new instances pakai v2
- release safety lebih baik

### 9.3 Avoid Raw User Input in Key

Raw input bisa menyebabkan:

- huge key
- key injection
- memory abuse
- sensitive data di key
- cardinality explosion

Gunakan canonicalization + hash:

```java
String canonicalFilter = canonicalize(filter);
String filterHash = sha256(canonicalFilter).substring(0, 16);
String key = "v2:tenant:" + tenantId + ":worklist:" + filterHash;
```

### 9.4 Jangan Simpan PII di Key

Redis key sering muncul di logs/metrics/tools.

Buruk:

```text
user-email:fajar@example.com:permissions
```

Lebih baik:

```text
user-id:8f7a...:permissions
```

Atau hashed identifier jika perlu.

---

## 10. Cache Value Design

Cache value sebaiknya tidak hanya data mentah.

Untuk production, sering lebih baik menyimpan envelope:

```json
{
  "schemaVersion": 3,
  "cachedAt": "2026-06-19T09:00:00Z",
  "sourceVersion": 42,
  "freshUntil": "2026-06-19T09:00:30Z",
  "staleUntil": "2026-06-19T09:05:00Z",
  "data": {
    "applicationId": "APP-123",
    "status": "PENDING_REVIEW"
  }
}
```

Manfaat:

- bisa detect stale
- bisa audit freshness
- bisa support stale-while-revalidate
- bisa support schema evolution
- bisa support source version compare
- bisa debug incidents

### 10.1 Serialization Format

Pilihan:

- JSON
- Smile/CBOR
- Protobuf
- Avro
- Java serialization
- custom binary

Hindari Java native serialization untuk cache lintas versi/service karena:

- security risk
- versioning sulit
- language lock-in
- brittle terhadap class change

Untuk microservices, JSON/Protobuf/Avro lebih umum.

### 10.2 DTO Cache, Bukan Entity Cache

Jangan cache JPA entity mentah.

Buruk:

```java
cache.put("app:123", applicationEntity);
```

Masalah:

- lazy proxy
- persistence context assumptions
- entity schema coupling
- accidental mutation
- serialization problem
- service internal model bocor

Lebih baik:

```java
ApplicationViewCacheDto dto = ApplicationViewCacheDto.from(domainView);
cache.put(key, dto);
```

Cache value adalah contract internal cache, bukan object graph ORM.

---

## 11. Invalidation Strategy Deep Dive

### 11.1 TTL-Only

```text
write happens -> do nothing
cache expires naturally
```

Kelebihan:

- simple
- resilient to invalidation failure
- no write coupling

Kekurangan:

- stale until TTL

Cocok jika:

- stale acceptable
- data low-risk
- update frequency rendah
- command path revalidates authority

---

### 11.2 Delete on Write

```text
write DB -> delete cache key
```

Flow:

```text
update application status
commit DB
invalidate application:view:123
```

Masalah dual-write:

```text
DB commit succeeds
cache delete fails
cache remains stale
```

Mitigasi:

- delete after commit with retry
- outbox invalidation event
- short TTL fallback
- reconciliation job

---

### 11.3 Update on Write

```text
write DB -> update cache value
```

Kelebihan:

- read after write lebih fresh

Kekurangan:

- write path tahu format cache
- bisa update cache dengan value yang belum complete
- race dengan concurrent writes
- dual-write risk

Sering lebih aman:

```text
write DB -> publish event -> projection/cache updater refreshes
```

---

### 11.4 Event-Driven Invalidation

Flow:

```text
Service A updates authoritative data
Service A writes outbox event
Relay publishes ApplicationStatusChanged
Cache consumer invalidates relevant keys
```

Kelebihan:

- decoupled
- reliable jika outbox benar
- bisa invalidate banyak consumer/cache

Kekurangan:

- eventual invalidation
- event delay/out-of-order
- consumer failure
- key dependency mapping kompleks

Harus ada TTL fallback.

Rule:

```text
Event invalidation improves freshness.
TTL bounds damage when invalidation fails.
```

---

### 11.5 Versioned Key / Namespace Bump

Daripada delete ribuan key, ubah namespace version.

```text
application-view-namespace-version = 18
key = app-view:v18:tenant:CEA:APP-123
```

Saat invalidasi global:

```text
increment namespace version to 19
```

Key lama otomatis tidak dipakai.

Kelebihan:

- cepat
- aman untuk schema change
- tidak perlu scan/delete massal

Kekurangan:

- key lama tetap memakai memory sampai expire
- perlu storage untuk namespace version
- perlu TTL agar cleanup natural

---

### 11.6 Tag-Based Invalidation

Cache entries diberi tag:

```text
key: worklist:officer:123
tags: application:APP-1, officer:123, tenant:CEA
```

Saat application berubah, invalidate semua key bertag `application:APP-1`.

Kelebihan:

- cocok untuk aggregation cache

Kekurangan:

- metadata tag kompleks
- invalidation fan-out
- consistency tag-key harus dijaga

---

## 12. Cache Stampede / Thundering Herd

Cache stampede terjadi saat banyak request bersamaan melihat cache miss/expired lalu semuanya load ke backend.

```text
popular key expires
10000 requests hit service
all miss cache
all query DB/external API
DB/external API collapses
```

Penyebab:

- TTL sama untuk hot keys
- tidak ada single-flight
- cold cache after deploy/flush
- cache cluster restart
- invalidation massal
- traffic spike
- retry storm

Mitigasi:

1. TTL jitter
2. single-flight/request coalescing
3. stale-while-revalidate
4. refresh-ahead
5. probabilistic early refresh
6. per-key lock with timeout
7. rate limit cache miss loader
8. bulkhead loader executor
9. cache warming with jitter
10. avoid mass invalidation

### 12.1 Per-Key Lock Pattern

```text
miss key K
try acquire lock K
if lock acquired:
  load source
  populate cache
  release lock
else:
  wait briefly or return stale
```

Perhatian:

- lock TTL wajib
- lock acquisition timeout wajib
- avoid deadlock
- handle loader failure
- avoid using lock as correctness guarantee for business transaction

---

## 13. Cache Penetration, Breakdown, Avalanche

### 13.1 Cache Penetration

Request untuk key yang tidak ada terus-menerus melewati cache ke DB.

Contoh:

```text
GET /users/random-id
GET /users/random-id-2
GET /users/random-id-3
```

Mitigasi:

- negative caching
- Bloom filter
- input validation
- rate limiting
- auth before lookup
- keyspace protection

### 13.2 Cache Breakdown

Satu hot key expire lalu banyak request menghantam backend.

Mitigasi:

- single-flight
- never-expire + async refresh
- hot-key refresh-ahead
- soft TTL/hard TTL

### 13.3 Cache Avalanche

Banyak key expire bersamaan atau cache cluster down.

Mitigasi:

- TTL jitter
- staggered warmup
- graceful degradation
- local fallback cache
- rate-limited rebuild
- cache cluster HA
- backend bulkhead

---

## 14. Local Cache + Distributed Cache: Two-Level Cache

Pattern:

```text
Service local cache -> Redis -> DB/source
```

Flow:

```text
check local L1
if miss check Redis L2
if miss load source
populate Redis
populate local
```

Kelebihan:

- latency sangat rendah untuk hot data
- mengurangi Redis load

Kekurangan:

- invalidation lebih sulit
- local stale antar instance
- memory pressure
- inconsistent view

Cocok untuk:

- small reference data
- permission metadata low-risk with short TTL
- schema/rule metadata
- expensive compiled objects

Tidak cocok untuk:

- rapidly changing data
- high-risk authorization unless revalidated
- sensitive tenant data tanpa isolation kuat

### 14.1 L1 TTL Harus Lebih Pendek

Umum:

```text
L1 local TTL <= L2 distributed TTL
```

Contoh:

```text
L1: 5 seconds
L2: 60 seconds
source: authoritative
```

---

## 15. Cache and Security

Caching bisa menyebabkan security incident.

### 15.1 Authorization-Aware Cache Key

Buruk:

```text
cache key = /api/applications/123
```

Jika response berbeda berdasarkan user/role/tenant, key ini berbahaya.

Lebih aman:

```text
tenant:{tenantId}:app:{appId}:view:{viewType}:role:{role}:policy:{policyVersion}
```

Atau jangan cache response sensitive sama sekali.

### 15.2 Tenant Leakage

Bug:

```java
String key = "case:" + caseId;
```

Jika caseId tidak globally unique atau lookup tidak tenant-scoped, tenant lain bisa mendapat data salah.

Lebih aman:

```java
String key = "tenant:" + tenantId + ":case:" + caseId;
```

### 15.3 PII in Cache

Pertanyaan:

- apakah data perlu dienkripsi di cache?
- apakah cache disk persistence aktif?
- apakah backup cache terenkripsi?
- apakah key/value muncul di logs?
- apakah admin Redis bisa membaca PII?
- apakah TTL sesuai retention?

### 15.4 Revocation Risk

Authorization/session cache harus mempertimbangkan revocation.

Contoh:

```text
User removed from admin group.
Cache still says admin for 15 minutes.
```

Mitigasi:

- short TTL
- revocation event
- emergency purge
- token expiry alignment
- final check for sensitive operation

---

## 16. Cache and Multi-Tenancy

Tenant-aware caching harus mencakup:

1. key prefix tenant
2. per-tenant TTL jika perlu
3. per-tenant quota
4. per-tenant eviction risk
5. per-tenant encryption/keying
6. per-tenant metrics
7. per-tenant invalidation
8. per-tenant rate limit
9. tenant-aware local cache
10. tenant-aware warmup

### 16.1 Noisy Neighbor in Cache

Tenant besar bisa memenuhi cache dan mengusir data tenant kecil.

Mitigasi:

- per-tenant key quota
- separate cache database/cluster for premium/high-risk tenant
- key namespace capacity monitoring
- admission control
- eviction policy selection

### 16.2 Tenant Migration

Jika tenant pindah region/database:

- invalidate tenant namespace
- stop writes during cutover or version source
- ensure cache key contains tenant version/location if needed
- purge stale routing data

---

## 17. Cache and Data Ownership

Dalam microservices, cache tidak boleh merusak ownership.

Buruk:

```text
Service B reads Service A database once,
then caches Service A internal table rows forever.
```

Lebih benar:

```text
Service A publishes integration event or read API.
Service B caches published contract, not private table.
```

Rule:

```text
Cache only data you are allowed to know through a public contract.
```

Cache tidak boleh menjadi jalan belakang untuk melanggar boundary.

---

## 18. Cache and CQRS/Materialized Views

Projection dan cache mirip tetapi tidak sama.

Projection:

- built from event stream/source feed
- query model owned by service/query side
- sering punya lifecycle dan rebuild process
- bisa menjadi authoritative untuk query

Cache:

- optimization layer
- can be dropped/rebuilt anytime
- usually not authoritative
- TTL/eviction based

Jika data harus:

- queryable secara kompleks
- auditable
- rebuildable
- punya freshness SLA
- punya schema governance

mungkin itu bukan cache, tetapi materialized view/projection.

---

## 19. Cache and Commands

Rule penting:

```text
Never execute irreversible command solely based on cached state.
```

Contoh buruk:

```java
ApplicationView cached = cache.get("app:" + id);
if (cached.status().equals("PENDING_REVIEW")) {
    approve(id);
}
```

Lebih benar:

```java
@Transactional
public void approve(ApplicationId id, Actor actor) {
    Application app = repository.findForUpdate(id);
    policy.checkCanApprove(actor, app);
    app.approve(actor);
    repository.save(app);
    outbox.add(ApplicationApproved.of(app));
}
```

Cache boleh membantu UI menampilkan tombol, tapi command handler harus validate authoritative state.

---

## 20. Cache and Event-Driven Invalidation

Event-driven invalidation umum:

```text
ApplicationApproved event
  -> invalidate application view cache
  -> invalidate officer worklist cache
  -> invalidate dashboard count cache
```

Masalah:

- satu event bisa memengaruhi banyak key
- consumer mungkin terlambat
- event mungkin duplicate
- event bisa out of order
- old service version mungkin pakai key lama

Solusi:

1. invalidation handler idempotent
2. key versioning
3. TTL fallback
4. event ordering per aggregate jika perlu
5. source version compare
6. reconciliation job

Pseudo-code:

```java
public void on(ApplicationApproved event) {
    cache.delete("v3:tenant:" + event.tenantId() + ":application:view:" + event.applicationId());
    cache.bumpNamespace("v3:tenant:" + event.tenantId() + ":worklist:officer");
}
```

---

## 21. Cache and Observability

Cache tanpa observability adalah hidden risk.

Minimal metrics:

| Metric | Meaning |
|---|---|
| hit rate | seberapa sering cache membantu |
| miss rate | origin pressure |
| load latency | latency fetch source |
| load failure rate | source/cache loader health |
| eviction count | memory pressure |
| expired count | TTL behavior |
| stale served count | stale-while-revalidate usage |
| stampede prevented count | single-flight effectiveness |
| key cardinality | memory/cost risk |
| cache size | capacity |
| hot keys | skew |
| Redis CPU/memory/network | cache infra health |
| command latency | cache server performance |
| connection pool saturation | app-cache bottleneck |

### 21.1 Hit Rate Bisa Menyesatkan

Hit rate 99% bagus? Belum tentu.

Kalau 1% miss adalah hot path expensive yang membunuh DB, tetap buruk.

Metrik lebih berguna:

```text
origin load avoided
origin load caused by misses
miss latency p95/p99
hot key expiration impact
cache correctness incidents
stale decision count
```

### 21.2 Business Metrics

Untuk regulatory/case system:

- stale worklist served count
- command rejected because authoritative state changed
- duplicate action prevented
- cache invalidation lag
- projection/cache freshness age
- cross-tenant cache key violation detected

---

## 22. Cache Failure Modes

### 22.1 Cache Down

Pertanyaan:

```text
Jika Redis down, apakah service down?
```

Pilihan:

1. fail open: bypass cache, hit source
2. fail closed: reject request
3. degrade: return stale local cache
4. partial response
5. rate-limit fallback to source

Fail open bisa membunuh database.

Fail closed bisa menyebabkan outage besar.

Top-tier design:

```text
cache failure policy per endpoint/data type
```

Contoh:

| Data | Cache Down Behavior |
|---|---|
| public reference data | fallback DB/source with rate limit |
| dashboard summary | return degraded/unavailable partial |
| authorization metadata | fail closed or revalidate authority |
| command pre-check cache | bypass cache and check DB |
| external low-risk lookup | stale-if-error if available |

### 22.2 Cache Slow

Cache slow lebih berbahaya dari cache down karena semua request menunggu.

Harus ada:

- cache operation timeout
- small connection pool timeout
- circuit breaker untuk cache dependency
- fallback behavior
- metrics

### 22.3 Cache Corruption

Penyebab:

- schema mismatch
- wrong serializer
- old/new version conflict
- manual key modification
- application bug

Mitigasi:

- schemaVersion dalam value
- versioned key prefix
- fail safe on deserialization error
- delete bad key
- alert

### 22.4 Cache Eviction Storm

Saat memory penuh, cache menghapus banyak key.

Efek:

- miss spike
- DB spike
- latency spike
- retry storm

Mitigasi:

- capacity planning
- eviction metrics
- key cardinality control
- admission policy
- separate cache by workload
- TTL discipline

---

## 23. Cache Capacity Planning

Cache capacity bukan hanya jumlah memory value.

Perhitungkan:

```text
key size
value size
metadata overhead
serialization overhead
replication overhead
fragmentation
connection overhead
persistence overhead if enabled
peak cardinality
TTL distribution
hot/cold distribution
```

Simplified estimate:

```text
average entry size = avg key bytes + avg value bytes + overhead
required memory = average entry size * max entries * replication factor * safety factor
```

Safety factor umum:

```text
1.3x - 2x
```

Tergantung fragmentation/overhead.

### 23.1 Key Cardinality Explosion

Contoh buruk:

```text
worklist:{tenant}:{user}:{filter}:{sort}:{page}:{timestamp}
```

Jika timestamp masuk key, hampir semua request miss.

Deteksi:

- key cardinality naik terus
- hit rate rendah
- memory naik
- eviction naik

---

## 24. Java 8–25 Considerations

### 24.1 Java 8

Karakteristik:

- banyak enterprise legacy masih Java 8
- CompletableFuture tersedia tetapi API lebih terbatas dibanding versi baru
- tidak ada records/sealed classes
- date/time API sudah ada (`java.time`)

Design implication:

- gunakan immutable DTO manual
- hati-hati dengan blocking thread pool
- gunakan explicit executor untuk async cache loader
- hindari Java serialization

### 24.2 Java 11

Karakteristik:

- LTS modern baseline awal
- JDK HttpClient tersedia
- container awareness membaik dibanding Java 8 era awal

Design implication:

- lebih mudah buat external lookup cache client
- runtime observability lebih baik

### 24.3 Java 17

Karakteristik:

- LTS kuat untuk modern backend
- records, sealed classes tersedia
- pattern matching mulai matang di versi berikutnya

Design implication:

- cache envelope bisa dibuat immutable dengan records
- sealed hierarchy cocok untuk cache freshness state

Contoh:

```java
public sealed interface CacheReadResult<T>
        permits CacheReadResult.Hit, CacheReadResult.Miss, CacheReadResult.Stale {

    record Hit<T>(T value) implements CacheReadResult<T> {}
    record Miss<T>() implements CacheReadResult<T> {}
    record Stale<T>(T value, Instant cachedAt) implements CacheReadResult<T> {}
}
```

### 24.4 Java 21

Karakteristik:

- virtual threads final
- cocok untuk blocking IO dengan concurrency tinggi

Design implication:

- cache loader blocking lebih murah secara thread
- tetapi backend/cache tetap punya capacity limit
- tetap perlu concurrency limiter

Virtual threads tidak menghapus kebutuhan:

- timeout
- bulkhead
- rate limit
- connection pool sizing
- cache miss control

### 24.5 Java 25

Java 25 sebagai release terbaru dalam range seri ini harus diperlakukan sebagai runtime modern yang tetap memerlukan evaluasi library/platform compatibility.

Design implication:

- pastikan Redis/client/cache library support runtime
- pastikan observability agent compatible
- pastikan container image/JFR/profiler compatible
- jangan upgrade runtime hanya untuk cache tanpa regression testing

---

## 25. Java Cache Implementation Sketch

### 25.1 Cache Port

```java
public interface CachePort {
    <T> Optional<CacheEnvelope<T>> get(String key, Class<T> type);

    void put(String key, CacheEnvelope<?> value, Duration ttl);

    void delete(String key);

    default void deleteAll(Collection<String> keys) {
        for (String key : keys) {
            delete(key);
        }
    }
}
```

### 25.2 Cache Envelope

```java
public record CacheEnvelope<T>(
        int schemaVersion,
        Instant cachedAt,
        Instant freshUntil,
        Instant staleUntil,
        long sourceVersion,
        T data
) {
    public boolean isFresh(Instant now) {
        return now.isBefore(freshUntil);
    }

    public boolean isServeableStale(Instant now) {
        return !now.isBefore(freshUntil) && now.isBefore(staleUntil);
    }

    public boolean isExpired(Instant now) {
        return !now.isBefore(staleUntil);
    }
}
```

Java 8 version: gunakan final class dengan final fields.

### 25.3 Cache Key Builder

```java
public final class CacheKeys {
    private CacheKeys() {}

    public static String applicationView(
            String tenantId,
            String applicationId,
            String viewType,
            String role,
            int schemaVersion
    ) {
        return "v" + schemaVersion
                + ":tenant:" + safe(tenantId)
                + ":application:" + safe(applicationId)
                + ":view:" + safe(viewType)
                + ":role:" + safe(role);
    }

    private static String safe(String value) {
        // Production: validate allowed chars or encode/hash.
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Invalid cache key segment");
        }
        return value.replace(":", "_");
    }
}
```

### 25.4 Cache-Aside with Single-Flight

```java
public final class ApplicationViewCacheService {
    private final CachePort cache;
    private final ApplicationViewRepository repository;
    private final ConcurrentHashMap<String, CompletableFuture<ApplicationView>> inFlight = new ConcurrentHashMap<>();
    private final Executor loaderExecutor;
    private final Clock clock;

    public ApplicationView get(ApplicationId id, TenantId tenantId, Actor actor) {
        String key = CacheKeys.applicationView(
                tenantId.value(),
                id.value(),
                "summary",
                actor.role(),
                3
        );

        Instant now = clock.instant();

        Optional<CacheEnvelope<ApplicationView>> cached = cache.get(key, ApplicationView.class);
        if (cached.isPresent()) {
            CacheEnvelope<ApplicationView> envelope = cached.get();
            if (envelope.isFresh(now)) {
                return envelope.data();
            }
            if (envelope.isServeableStale(now)) {
                refreshAsync(key, id, tenantId, actor);
                return envelope.data();
            }
        }

        return loadSingleFlight(key, id, tenantId, actor);
    }

    private ApplicationView loadSingleFlight(String key, ApplicationId id, TenantId tenantId, Actor actor) {
        CompletableFuture<ApplicationView> future = inFlight.computeIfAbsent(key, ignored ->
                CompletableFuture.supplyAsync(() -> loadAndCache(key, id, tenantId, actor), loaderExecutor)
                        .whenComplete((result, error) -> inFlight.remove(key))
        );

        return future.join();
    }

    private void refreshAsync(String key, ApplicationId id, TenantId tenantId, Actor actor) {
        inFlight.computeIfAbsent(key, ignored ->
                CompletableFuture.supplyAsync(() -> loadAndCache(key, id, tenantId, actor), loaderExecutor)
                        .whenComplete((result, error) -> inFlight.remove(key))
        );
    }

    private ApplicationView loadAndCache(String key, ApplicationId id, TenantId tenantId, Actor actor) {
        ApplicationView view = repository.loadView(id, tenantId, actor);
        Instant now = clock.instant();

        CacheEnvelope<ApplicationView> envelope = new CacheEnvelope<>(
                3,
                now,
                now.plusSeconds(30),
                now.plusSeconds(300),
                view.sourceVersion(),
                view
        );

        cache.put(key, envelope, Duration.ofMinutes(5).plusSeconds(randomJitter()));
        return view;
    }

    private long randomJitter() {
        return ThreadLocalRandom.current().nextLong(0, 30);
    }
}
```

Production improvements:

- do not use `join()` without timeout in high-risk path
- handle loader exception
- cap in-flight map size
- instrument all outcomes
- separate executor pool for cache loads
- prevent actor-sensitive stale leakage

---

## 26. Spring / Jakarta / Quarkus / Plain Java Positioning

### 26.1 Spring

Spring offers caching abstraction:

- `@Cacheable`
- `@CachePut`
- `@CacheEvict`
- cache managers
- integration with Caffeine/Redis/etc.

Useful for simple cases.

But for advanced microservices, annotation caching can hide critical decisions:

- cache key correctness
- tenant/role awareness
- stale policy
- invalidation path
- observability
- error handling
- command safety

Rule:

```text
Use annotation caching for low-risk/simple read paths.
Use explicit cache service for high-risk/business-sensitive paths.
```

### 26.2 Jakarta / MicroProfile

Jakarta itself does not force a cache model. MicroProfile Config/Telemetry/REST Client/Fault Tolerance can support cache architecture indirectly:

- config TTL/policy
- telemetry metrics/traces
- REST client for source loading
- fault tolerance for cache/source calls

### 26.3 Quarkus

Quarkus has cache extensions and strong Redis integration. Useful for cloud-native runtime, but same architectural constraints remain.

### 26.4 Plain Java

Plain Java is fine when:

- cache logic must be explicit
- dependency should be minimal
- high correctness path needs custom envelope/key/invalidation
- platform/framework abstraction hides too much

---

## 27. Cache Anti-Patterns

### 27.1 Cache as Source of Truth by Accident

Symptoms:

- DB lost but cache still serves and business assumes valid
- cache has fields not present in authoritative source
- recovery impossible from DB/events

Fix:

- define authority
- rebuild cache from source
- avoid write-back for critical data

### 27.2 Caching Because Query Design Is Bad

Symptoms:

- no indexes
- bad joins
- N+1 queries
- cache added instead of fixing data model

Fix:

- profile query
- fix indexes
- redesign query/read model
- cache only after baseline is sound

### 27.3 Global Cache Key Without Tenant/User/Role

Symptoms:

- user sees another tenant/user data
- privilege leakage

Fix:

- key must include security scope or avoid caching response

### 27.4 Infinite TTL for Mutable Data

Symptoms:

- stale bug impossible to reproduce
- manual Redis flush as operational habit

Fix:

- bounded TTL
- versioned keys
- invalidation events

### 27.5 Mass Invalidation During Peak Traffic

Symptoms:

- DB collapse after cache flush
- latency spike

Fix:

- namespace bump
- gradual warmup
- rate-limited rebuild
- stale-while-revalidate

### 27.6 Cache Without Metrics

Symptoms:

- no one knows hit rate
- no one knows stale age
- cache incidents invisible

Fix:

- metrics/traces/logging from day one

### 27.7 One Redis for Everything

Symptoms:

- session, rate limit, cache, queue, idempotency all share same Redis
- one workload evicts another
- noisy neighbor

Fix:

- separate logical/physical cache by criticality/workload
- memory policy per use case

### 27.8 Caching Error Responses Too Long

Symptoms:

- temporary external failure becomes persistent user failure

Fix:

- short TTL for negative/error cache
- distinguish NOT_FOUND vs TEMP_UNAVAILABLE

---

## 28. Regulatory Case Management Example

Scenario:

```text
System: Regulatory Application Management
Actors:
- Applicant
- Officer
- Supervisor
- Admin

Data:
- Application
- Applicant Profile
- Eligibility Rules
- Worklist
- Audit Trail
- External Postal Lookup
- Authorization/Role Mapping
```

### 28.1 What Can Be Cached?

| Data | Cache? | Pattern | Risk |
|---|---:|---|---|
| postal code lookup | Yes | cache-aside + TTL | low/medium |
| agency reference list | Yes | local + distributed | low |
| officer worklist | Yes | materialized view/cache | medium |
| application detail display | Yes, short TTL | cache-aside/SWR | medium |
| approve command state | No as final authority | DB transaction | high |
| audit trail | No as authority | append-only store | high |
| authorization decision | Maybe short TTL | auth cache + revocation | high |
| dashboard count | Yes | projection/cache | low/medium |
| eligibility result | Maybe | computed cache with rule version | medium/high |

### 28.2 Worklist Cache Design

Key:

```text
v4:tenant:CEA:worklist:officer:{officerId}:filter:{filterHash}:cursor:{cursor}
```

Value envelope:

```json
{
  "schemaVersion": 4,
  "cachedAt": "2026-06-19T10:00:00Z",
  "freshUntil": "2026-06-19T10:00:10Z",
  "staleUntil": "2026-06-19T10:01:00Z",
  "data": {
    "items": [
      { "applicationId": "APP-123", "status": "PENDING_REVIEW" }
    ]
  }
}
```

On event:

```text
ApplicationSubmitted -> invalidate worklist namespace for relevant officers
ApplicationApproved -> invalidate application view + worklist + dashboard count
ApplicationAssigned -> invalidate old officer worklist + new officer worklist
```

Command safety:

```text
Officer clicks Approve from cached worklist.
Approve API loads authoritative Application row.
State machine validates transition and actor permission.
If already approved, returns idempotent/conflict response.
```

### 28.3 Authorization Cache

Key:

```text
v2:tenant:CEA:authz:user:{userId}:resource:{resourceType}:action:{action}:policy:{policyVersion}
```

TTL:

```text
low-risk read operation: 30-60s
high-risk write/admin operation: no final cache authority
```

Revocation:

```text
RoleChanged event -> invalidate user auth namespace
Emergency lock -> bypass cache / fail closed
```

---

## 29. Decision Framework

Sebelum menambahkan cache, jawab ini:

### 29.1 Necessity

1. Apa bottleneck yang dibuktikan metrics?
2. Apakah query/index/design sudah benar?
3. Apakah read model/projection lebih cocok daripada cache?
4. Apakah performance target tidak bisa dicapai tanpa cache?

### 29.2 Correctness

1. Siapa authoritative source?
2. Berapa stale tolerance?
3. Apa dampak stale data?
4. Apakah cached data bisa dipakai untuk command?
5. Apakah command tetap revalidate authority?

### 29.3 Security

1. Apakah data user/tenant/role specific?
2. Apakah key mencakup tenant/user/role/policy scope?
3. Apakah value mengandung PII?
4. Apakah cache encrypted/protected?
5. Bagaimana revocation?

### 29.4 Operations

1. Apa behavior saat cache down?
2. Apa behavior saat cache slow?
3. Apa stampede protection?
4. Apa invalidation strategy?
5. Apa TTL/jitter?
6. Apa metrics dan alert?

### 29.5 Evolution

1. Bagaimana schema cache berubah?
2. Apakah key versioned?
3. Apakah old/new service bisa coexist?
4. Bagaimana mass invalidation tanpa outage?
5. Bagaimana rebuild?

---

## 30. Production Readiness Checklist

### 30.1 Authority and Freshness

- [ ] Authoritative source jelas.
- [ ] Cache bukan source of truth kecuali eksplisit.
- [ ] Freshness SLA didefinisikan.
- [ ] TTL ditentukan berdasarkan risk, bukan feeling.
- [ ] Stale behavior jelas.
- [ ] Command path revalidates authoritative state.

### 30.2 Key and Value

- [ ] Key mengandung tenant/security scope yang relevan.
- [ ] Key tidak mengandung PII mentah.
- [ ] Key versioned.
- [ ] Value punya schema version jika lintas deploy/version.
- [ ] Serialization aman dan kompatibel.
- [ ] DTO cache bukan JPA entity.

### 30.3 Invalidation

- [ ] Invalidation strategy jelas.
- [ ] TTL fallback tersedia.
- [ ] Event-driven invalidation idempotent.
- [ ] Mass invalidation tidak menyebabkan DB collapse.
- [ ] Namespace/version bump dipertimbangkan.

### 30.4 Stampede Protection

- [ ] TTL jitter diterapkan untuk hot keys.
- [ ] Single-flight/request coalescing untuk expensive load.
- [ ] Loader concurrency dibatasi.
- [ ] Negative caching untuk miss berulang.
- [ ] Cold cache recovery dirancang.

### 30.5 Security and Tenancy

- [ ] Tenant isolation diuji.
- [ ] Authorization-aware caching dirancang.
- [ ] Revocation path tersedia.
- [ ] Sensitive cache data dilindungi.
- [ ] Admin/support access ke cache diaudit.

### 30.6 Observability

- [ ] Hit/miss rate dimonitor.
- [ ] Load latency dimonitor.
- [ ] Stale served count dimonitor.
- [ ] Eviction dimonitor.
- [ ] Hot keys dimonitor.
- [ ] Cache error/timeout dimonitor.
- [ ] Invalidation lag dimonitor.

### 30.7 Failure Handling

- [ ] Cache down policy per endpoint jelas.
- [ ] Cache slow timeout tersedia.
- [ ] Circuit breaker/bulkhead untuk cache dependency tersedia jika perlu.
- [ ] Fallback tidak membunuh DB.
- [ ] Recovery/rebuild procedure tersedia.

---

## 31. Architecture Review Questions

1. Mengapa cache dibutuhkan di sini?
2. Apa bukti bottleneck-nya?
3. Apa authoritative source?
4. Apa stale tolerance?
5. Apa keputusan bisnis terburuk jika cache stale?
6. Apakah command memakai cache sebagai authority?
7. Bagaimana key mencegah tenant/user/role leakage?
8. Bagaimana schema cache berubah saat deploy versi baru?
9. Bagaimana invalidation bekerja?
10. Apa yang terjadi kalau invalidation event hilang/terlambat?
11. Apa TTL fallback?
12. Bagaimana mencegah stampede?
13. Apa yang terjadi kalau Redis down?
14. Apa yang terjadi kalau Redis slow?
15. Bagaimana cache di-warmup setelah flush/restart?
16. Bagaimana cache metrics terlihat di dashboard?
17. Bagaimana incident cache direkonstruksi?
18. Bagaimana memastikan cache tidak melanggar data ownership?
19. Apakah ini lebih tepat sebagai projection/materialized view?
20. Apakah cache ini menurunkan complexity atau justru menyembunyikannya?

---

## 32. Practical Exercises

### Exercise 1 — Cache Candidate Classification

Ambil 10 endpoint dari sistem enterprise.

Untuk masing-masing, isi:

```text
endpoint:
authoritative source:
cache candidate: yes/no
cache type:
TTL:
stale risk:
invalidation strategy:
security scope:
cache down behavior:
```

### Exercise 2 — Worklist Cache Design

Desain cache untuk officer worklist:

- filter by status
- sort by SLA deadline
- paginated
- tenant-scoped
- role-scoped
- invalidated by assignment/status changes

Tentukan:

- key
- value envelope
- TTL
- invalidation events
- stale behavior
- command safety

### Exercise 3 — Stampede Simulation

Simulasikan:

```text
hot key TTL 60s
traffic 2000 RPS
DB query p95 300ms
cache expires at T0
```

Jawab:

1. Apa yang terjadi tanpa protection?
2. Bagaimana single-flight mengubah load?
3. Bagaimana stale-while-revalidate mengubah latency?
4. Bagaimana TTL jitter mengurangi synchronized expiration?

### Exercise 4 — Security Review

Review key ini:

```text
application:{applicationId}:detail
```

Untuk sistem multi-tenant, role-based regulatory application.

Identifikasi risiko dan desain key yang lebih aman.

### Exercise 5 — Cache Incident Postmortem

Scenario:

```text
Users see applications from another agency for 8 minutes.
Root cause: cache key did not include tenantId.
```

Buat:

- incident timeline
- blast radius
- immediate mitigation
- long-term fix
- test coverage
- monitoring/alert addition

---

## 33. Ringkasan Mental Model

Caching dalam microservices adalah alat kuat, tetapi berbahaya jika dipakai sebagai patch performa tanpa desain correctness.

Prinsip utama:

```text
1. Cache is a derived copy, not authority by default.
2. Every cache needs a freshness contract.
3. Every cache key is a security boundary.
4. Every invalidation strategy needs TTL fallback.
5. Every hot key needs stampede protection.
6. Every command must validate authoritative state.
7. Every cache needs observability.
8. Every cache failure mode must be explicit.
9. Every cache schema/key must be versioned for release safety.
10. If cache becomes complex query infrastructure, maybe it is a projection, not a cache.
```

Top 1% engineer tidak bertanya “pakai Redis atau tidak?” terlebih dahulu.

Mereka bertanya:

```text
What is the correctness model of this cached data?
What is the freshness budget?
What is the authority?
What is the blast radius if it is wrong?
How do we recover when cache lies?
```

---

## 34. Referensi

- Redis Documentation — Cache-aside use case: https://redis.io/docs/latest/develop/use-cases/cache-aside/
- AWS Whitepaper — Database Caching Strategies Using Redis: https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html
- Amazon ElastiCache Documentation — Caching strategies: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Strategies.html
- Azure Architecture Center — Cache-Aside Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside
- Azure Architecture Center — Caching guidance: https://learn.microsoft.com/en-us/azure/architecture/best-practices/caching
- RFC 5861 — HTTP Cache-Control Extensions for Stale Content: https://datatracker.ietf.org/doc/html/rfc5861
- Cloudflare Docs — Revalidation and stale-while-revalidate behavior: https://developers.cloudflare.com/cache/concepts/revalidation/
- OpenJDK JEP 444 — Virtual Threads: https://openjdk.org/jeps/444
- OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/

---

# Status Series

Seri belum selesai.

Progress saat ini:

```text
Part 28 of 35 selesai.
```

Part berikutnya:

```text
Part 29 — Data Migration, Monolith Decomposition, and Strangler Fig
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-29-migration-monolith-decomposition-strangler-fig.md
```
