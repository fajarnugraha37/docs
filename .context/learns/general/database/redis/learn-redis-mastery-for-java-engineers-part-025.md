# learn-redis-mastery-for-java-engineers-part-025.md

# Part 025 — Java Client Mastery: Lettuce, Jedis, Spring Data Redis

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `025 / 034`  
> Fokus: Java integration, client choice, connection lifecycle, sync/async/reactive API, pooling, serialization, error handling, cluster, observability, and production configuration.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas Redis dari sisi server: data structures, TTL, eviction, cache design, rate limiter, idempotency, locks, Lua, Pub/Sub, Streams, persistence, replication, cluster, memory, dan latency.

Bagian ini menjawab pertanyaan praktis yang biasanya muncul di service Java:

> “Bagaimana cara memakai Redis dari aplikasi Java secara production-grade tanpa menjadikan client layer sebagai sumber bug laten?”

Target setelah bagian ini:

1. Kamu bisa memilih antara **Lettuce**, **Jedis**, dan **Spring Data Redis** secara sadar.
2. Kamu memahami bedanya **Redis server connection**, **Java connection object**, **Spring RedisConnection**, dan **pool**.
3. Kamu tahu kapan memakai sync, async, reactive, pipeline, transaction, blocking connection, dan dedicated connection.
4. Kamu bisa mendesain serialization policy yang aman untuk evolusi schema.
5. Kamu bisa menghindari bug klasik seperti:
   - connection leak,
   - pool exhaustion,
   - accidental Java native serialization,
   - unbounded retry storm,
   - hidden blocking command,
   - key serializer mismatch,
   - cross-slot operation di cluster,
   - cache abstraction yang menyembunyikan failure semantics.
6. Kamu punya checklist production configuration untuk Java Redis client.

Bagian ini tidak akan mengulang teori Redis command secara penuh. Kita akan fokus pada **boundary antara Java service dan Redis server**.

---

## 1. Redis Client Layer Itu Bukan Detail Kecil

Banyak engineer memperlakukan Redis client seperti JDBC driver sederhana:

```java
redis.get("some:key");
```

Lalu menganggap problem Redis hanya ada di server.

Itu keliru.

Di production, banyak incident Redis bermula dari client layer:

- timeout terlalu agresif atau terlalu longgar,
- pool terlalu kecil atau terlalu besar,
- serialization berubah tanpa migration,
- retry tanpa jitter,
- command blocking memakai shared connection,
- pipeline tanpa backpressure,
- reactive API dipakai tapi downstream tetap blocking,
- cache abstraction menyembunyikan key structure,
- cluster topology tidak dipahami,
- failover tidak dites,
- metrics client tidak dipantau.

Redis adalah sistem latency-sensitive. Client layer adalah bagian dari critical path.

Mental model penting:

```text
User request
   ↓
Java thread / event loop / reactive chain
   ↓
Redis client abstraction
   ↓
Connection / pool / Netty channel / socket
   ↓
RESP protocol over TCP/TLS
   ↓
Redis server command queue
   ↓
Redis execution
   ↓
Response serialization/deserialization
   ↓
Application decision
```

Kalau salah satu layer punya bottleneck, user hanya melihat: “API lambat”.

---

## 2. Tiga Level Abstraksi Java Redis

Dalam Java ecosystem, Redis biasanya dipakai lewat tiga level:

```text
Level 1 — Native Redis client
  - Lettuce
  - Jedis

Level 2 — Spring Data Redis
  - RedisTemplate
  - StringRedisTemplate
  - ReactiveRedisTemplate
  - RedisConnectionFactory

Level 3 — Higher-level abstraction
  - Spring Cache @Cacheable
  - Spring Session
  - Spring Integration
  - Redisson abstractions
  - custom library internal company
```

Semakin tinggi abstraksi, semakin cepat development, tetapi semakin mudah kehilangan kontrol atas:

- exact command,
- key format,
- serializer,
- TTL,
- error behavior,
- latency profile,
- cluster compatibility,
- operational visibility.

Prinsip arsitektural:

> Gunakan abstraksi setinggi mungkin untuk use case sederhana, tetapi turun ke level lebih rendah ketika correctness, latency, atau failure semantics penting.

Contoh:

| Use case | Abstraksi yang masuk akal |
|---|---|
| Simple object cache | Spring Cache / RedisTemplate |
| Explicit cache-aside with metrics | RedisTemplate / Lettuce |
| Rate limiter Lua script | Lettuce / RedisTemplate execute script |
| Reactive streaming read | Lettuce reactive / ReactiveRedisTemplate |
| Cluster-aware low-level operation | Lettuce / Jedis cluster API |
| Distributed lock dengan fencing | Usually custom + Lua, not blind abstraction |
| Idempotency state machine | Custom repository over RedisTemplate/Lettuce |

---

## 3. Lettuce vs Jedis vs Spring Data Redis

### 3.1 Lettuce

Lettuce adalah Redis client Java modern yang dibangun di atas Netty dan mendukung:

- synchronous API,
- asynchronous API,
- reactive API,
- Redis Cluster,
- Sentinel,
- pipelining,
- auto reconnect,
- thread-safe connection model untuk banyak operasi non-blocking/non-transactional.

Redis documentation menyebut Lettuce sebagai advanced Java client yang mendukung synchronous, asynchronous, dan reactive connections; untuk kebutuhan synchronous sederhana, Jedis bisa terasa lebih mudah.

Lettuce cocok jika:

- aplikasi butuh async/reactive,
- throughput tinggi,
- ingin connection sharing,
- memakai Redis Cluster/Sentinel secara serius,
- ingin kontrol detail atas timeout, reconnect, topology refresh,
- aplikasi sudah memakai Netty/Reactor/WebFlux.

Trade-off:

- API dan lifecycle lebih kompleks,
- async misuse bisa menciptakan backlog besar,
- reactive API tidak otomatis membuat sistem non-blocking kalau chain lain masih blocking,
- harus paham kapan connection sharing aman dan kapan butuh dedicated connection.

### 3.2 Jedis

Jedis adalah client Java yang lebih sederhana dan historically sangat populer. Modelnya lebih mudah dipahami untuk synchronous imperative code.

Jedis cocok jika:

- aplikasi mostly synchronous,
- Redis usage sederhana,
- tim ingin API command yang direct,
- tidak butuh reactive,
- ingin model connection-pool klasik yang familiar.

Trade-off:

- pooling lebih sentral,
- concurrency model perlu disiplin,
- untuk async/reactive bukan pilihan utama,
- API simplicity bisa mendorong command-by-command round trip tanpa batching.

### 3.3 Spring Data Redis

Spring Data Redis adalah abstraction layer untuk aplikasi Spring.

Komponen penting:

- `RedisConnectionFactory`
- `RedisTemplate<K, V>`
- `StringRedisTemplate`
- `ReactiveRedisTemplate<K, V>`
- serializers
- repositories
- Spring Cache integration
- transaction/pipeline support
- Pub/Sub listener container

Spring Data Redis cocok jika:

- aplikasi Spring Boot,
- ingin dependency injection dan configuration convention,
- ingin template API,
- ingin cache abstraction,
- ingin integration dengan Spring Session, Spring Cache, observability Spring ecosystem.

Trade-off:

- serializer mismatch sering menjadi bug,
- abstraction bisa menyembunyikan command Redis sebenarnya,
- repository abstraction bisa membuat Redis terasa seperti database object store umum,
- `@Cacheable` bisa membuat key/TTL/invalidation tidak eksplisit,
- perlu paham native connection di baliknya.

---

## 4. Decision Matrix

Gunakan ini sebagai starting point, bukan dogma.

| Situation | Prefer |
|---|---|
| Spring Boot synchronous service, simple cache-aside | `StringRedisTemplate` atau `RedisTemplate` |
| Spring Boot cache dengan TTL sederhana | Spring Cache + RedisCacheManager |
| Need explicit key schema and state machine | Custom repository over `RedisTemplate` |
| Need async Redis commands | Lettuce async API |
| Need reactive WebFlux end-to-end | `ReactiveRedisTemplate` atau Lettuce reactive |
| Need low-level cluster-aware tuning | Lettuce/Jedis native cluster API |
| Need simple CLI-like synchronous usage | Jedis |
| Need blocking list/stream consumers | Dedicated connection / dedicated worker client |
| Need Lua scripts | Lettuce or RedisTemplate script execution |
| Need heavy pipeline control | Lettuce/Jedis native API or Spring pipelining carefully |

Rule sederhana:

```text
Default Spring Boot app:
  start with Spring Data Redis.

Performance-sensitive or unusual Redis pattern:
  understand and maybe use native Lettuce/Jedis.

Reactive app:
  do not mix reactive Redis with blocking DB/HTTP calls casually.

Blocking Redis command:
  isolate connection and worker model.
```

---

## 5. Connection Mental Model

Redis client bukan hanya object Java. Ia mengelola koneksi TCP/TLS ke Redis server.

```text
Java application
  ├── RedisClient / ClientResources
  ├── Stateful connection(s)
  ├── command codec / serializer
  ├── event loop / worker threads
  ├── timeout scheduler
  └── reconnect / topology refresh logic
```

Hal yang harus dibedakan:

1. **Redis server connection**  
   Koneksi TCP yang terlihat dari sisi Redis.

2. **Native client connection object**  
   Misalnya Lettuce `StatefulRedisConnection`.

3. **Spring `RedisConnection`**  
   Abstraksi Spring Data Redis. Dokumentasi Spring menekankan bahwa `RedisConnection` tidak thread-safe, meskipun native connection di bawahnya seperti Lettuce `StatefulRedisConnection` bisa thread-safe.

4. **Connection pool**  
   Kumpulan connection yang dipinjam dan dikembalikan.

5. **Dedicated connection**  
   Connection khusus untuk operasi tertentu seperti blocking command atau transaction.

Kesalahan umum:

```text
"Lettuce connection thread-safe" ⇒ semua wrapper Spring juga aman dibagi lintas thread.
```

Ini tidak otomatis benar.

---

## 6. Thread Safety: Subtle tapi Penting

### 6.1 Lettuce

Lettuce dirancang thread-safe untuk banyak skenario. Multiple threads dapat share satu connection untuk command normal.

Tetapi ada pengecualian penting:

- blocking commands seperti `BLPOP`, `BRPOP`, `XREAD BLOCK`,
- transactions seperti `MULTI` / `EXEC`,
- command yang mengubah state koneksi,
- operasi yang membutuhkan dedicated lifecycle.

Kenapa?

Karena connection adalah ordered stream. Kalau satu command blocking menahan response, command lain di connection yang sama bisa ikut terpengaruh.

Contoh buruk:

```text
Thread A: BLPOP queue 30 seconds
Thread B: GET user:123
Same connection

Result:
  GET bisa tertahan karena connection sedang dipakai blocking flow.
```

Meskipun client punya async machinery, command ordering dan blocking semantics tetap harus dihormati.

### 6.2 Spring Data Redis

Spring Data Redis memberi warning bahwa `RedisConnection` object tidak thread-safe. Jangan simpan `RedisConnection` manual lalu dipakai banyak thread.

Pola aman:

```java
@Component
public class UserCacheRepository {
    private final StringRedisTemplate redis;

    public UserCacheRepository(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public Optional<String> getUserJson(String userId) {
        return Optional.ofNullable(redis.opsForValue().get("user:" + userId));
    }
}
```

Pola berbahaya:

```java
// Jangan jadikan RedisConnection sebagai singleton manual yang dipakai lintas thread.
class BadRedisHolder {
    private RedisConnection connection;
}
```

---

## 7. Pooling: Jangan Pakai Pool Karena Kebiasaan JDBC

Dengan database SQL, connection pool biasanya wajib karena connection merepresentasikan session berat dan server bisa paralel memproses query antar connection.

Redis berbeda.

Redis mengeksekusi command dengan model yang membuat banyak workload tidak otomatis lebih cepat hanya karena connection lebih banyak. Bahkan connection terlalu banyak bisa:

- menaikkan overhead Redis server,
- menaikkan memory client output buffer,
- memperburuk tail latency,
- mempersulit backpressure,
- menyembunyikan masalah pipeline/batching.

### 7.1 Kapan Pool Tidak Perlu

Untuk Lettuce command normal non-blocking/non-transactional:

```text
Banyak request thread sharing satu/few Lettuce connection sering cukup.
```

Khususnya untuk:

- `GET`, `SET`, `MGET`, `HGET`, `HSET`,
- normal cache-aside,
- small Lua scripts,
- rate limiter ringan,
- async/reactive command stream dengan backpressure.

### 7.2 Kapan Pool atau Dedicated Connection Perlu

Gunakan pool/dedicated connection untuk:

- blocking list commands: `BLPOP`, `BRPOP`, `BZPOPMIN`,
- blocking stream read: `XREAD BLOCK`, `XREADGROUP BLOCK`,
- Pub/Sub long-lived subscription,
- transactions `MULTI/EXEC`,
- long-running scripts yang harus diisolasi,
- workload dengan different timeout policy,
- administrative commands terpisah dari request path.

### 7.3 Pool Exhaustion sebagai Signal

Pool exhaustion bukan hanya “pool kurang besar”. Bisa berarti:

- Redis lambat,
- network bermasalah,
- command blocking masuk pool umum,
- timeout terlalu panjang,
- request rate lebih besar dari capacity,
- connection leak,
- transaction tidak close,
- pipeline tidak flush/complete,
- thread pool upstream terlalu agresif.

Jangan langsung menaikkan pool size. Diagnosis dulu.

---

## 8. Sync vs Async vs Reactive

### 8.1 Synchronous API

Contoh:

```java
String value = redisCommands.get("user:123");
```

Cocok untuk:

- Spring MVC servlet app,
- simple cache calls,
- low to moderate throughput,
- team yang lebih nyaman imperative style.

Kelemahan:

- thread request menunggu Redis,
- mudah membuat banyak round trip sequential,
- perlu timeout disiplin,
- throughput tinggi bisa butuh banyak request threads.

### 8.2 Asynchronous API

Contoh konsep:

```java
RedisFuture<String> future = async.get("user:123");
```

Cocok untuk:

- parallel Redis calls,
- avoiding request thread blocking,
- composing multiple IO tasks,
- custom high-throughput service.

Bahaya:

- unbounded futures,
- tidak ada backpressure,
- exception handling tercecer,
- timeout tidak jelas,
- callback hell,
- event loop blocked by CPU/serialization.

### 8.3 Reactive API

Contoh konsep:

```java
Mono<String> value = reactive.get("user:123");
```

Cocok untuk:

- WebFlux stack,
- streaming-ish workloads,
- backpressure-aware flow,
- non-blocking end-to-end pipeline.

Bahaya:

- reactive Redis + blocking JDBC = benefit hilang,
- `.block()` di event loop,
- CPU-heavy JSON parsing di event loop,
- missing timeout operator,
- hidden subscription lifecycle.

Prinsip:

```text
Reactive Redis hanya bermanfaat jika call chain benar-benar non-blocking dan concurrency dibatasi.
```

---

## 9. Serialization: Bagian yang Sering Menghancurkan Evolusi Sistem

Redis menyimpan bytes. Java menyimpan object. Serializer adalah kontrak antara keduanya.

```text
Java object
   ↓ serializer
byte[] / String
   ↓ Redis
byte[]
   ↑ deserializer
Java object
```

Masalahnya: serializer bukan detail teknis. Ia adalah **schema contract**.

### 9.1 Serializer Umum di Spring Data Redis

- `StringRedisSerializer`
- `GenericJackson2JsonRedisSerializer`
- `Jackson2JsonRedisSerializer<T>`
- `JdkSerializationRedisSerializer`
- custom serializer

### 9.2 Jangan Default ke Java Native Serialization

Java native serialization biasanya buruk untuk Redis cache modern karena:

- payload sulit dibaca manusia,
- tightly coupled ke class Java,
- rentan masalah compatibility,
- berisiko security jika deserialization tidak dikontrol,
- sulit di-debug via `redis-cli`,
- sulit dipakai lintas bahasa.

Lebih baik default ke:

- String untuk key,
- JSON untuk value human-debuggable,
- compact binary seperti Protobuf/Avro hanya jika ada schema discipline,
- Hash fields untuk partial update dan introspection.

### 9.3 Key Serializer Harus Sangat Stabil

Key harus hampir selalu string.

Buruk:

```text
binarySerialized(UserKey(userId=123, tenantId=abc))
```

Baik:

```text
tenant:abc:user:123:profile:v1
```

Kenapa?

Karena key harus:

- bisa dibaca di `redis-cli`,
- bisa di-debug saat incident,
- bisa dihitung pattern-nya,
- bisa dirancang untuk cluster slot,
- bisa diberi TTL policy,
- bisa dipakai di runbook.

### 9.4 Value Serializer Harus Punya Versioning

Contoh value JSON:

```json
{
  "schemaVersion": 2,
  "userId": "123",
  "status": "ACTIVE",
  "displayName": "Ayu",
  "updatedAt": "2026-06-20T10:15:30Z"
}
```

Kenapa `schemaVersion` penting?

Karena cache bisa hidup lintas deployment.

Deployment timeline:

```text
T0: service v1 writes old JSON
T1: deploy service v2
T2: service v2 reads old JSON from Redis
T3: deserialization fails or semantic wrong
```

Cache TTL mengurangi risiko, tetapi tidak menghilangkan. Untuk value dengan TTL panjang atau persistent Redis data, versioning wajib.

---

## 10. Spring Data Redis Configuration Baseline

Contoh baseline eksplisit untuk Spring Boot.

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory connectionFactory,
            ObjectMapper objectMapper
    ) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);

        StringRedisSerializer keySerializer = new StringRedisSerializer();

        ObjectMapper redisObjectMapper = objectMapper.copy();
        redisObjectMapper.findAndRegisterModules();

        GenericJackson2JsonRedisSerializer valueSerializer =
                new GenericJackson2JsonRedisSerializer(redisObjectMapper);

        template.setKeySerializer(keySerializer);
        template.setHashKeySerializer(keySerializer);
        template.setValueSerializer(valueSerializer);
        template.setHashValueSerializer(valueSerializer);

        template.afterPropertiesSet();
        return template;
    }

    @Bean
    public StringRedisTemplate stringRedisTemplate(
            RedisConnectionFactory connectionFactory
    ) {
        return new StringRedisTemplate(connectionFactory);
    }
}
```

Catatan:

1. Jangan biarkan serializer default tidak diketahui.
2. Gunakan `StringRedisTemplate` untuk use case string/counter/locks/idempotency ringan.
3. Gunakan `RedisTemplate<String, Object>` hanya jika value object memang diperlukan.
4. Untuk high-control system, pertimbangkan repository eksplisit per use case.

---

## 11. Repository Pattern untuk Redis

Redis access sebaiknya tidak tersebar acak di service layer.

Buruk:

```java
@Service
class OrderService {
    private final RedisTemplate<String, Object> redis;

    void process(String orderId) {
        redis.opsForValue().set("x:" + orderId, "...");
        redis.opsForSet().add("abc", orderId);
        redis.expire("x:" + orderId, Duration.ofMinutes(5));
    }
}
```

Lebih baik:

```java
@Component
public class OrderIdempotencyStore {
    private final StringRedisTemplate redis;
    private final Duration ttl = Duration.ofHours(24);

    public OrderIdempotencyStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public boolean tryStart(String tenantId, String idempotencyKey) {
        String key = key(tenantId, idempotencyKey);
        Boolean inserted = redis.opsForValue()
                .setIfAbsent(key, "STARTED", ttl);
        return Boolean.TRUE.equals(inserted);
    }

    public void markCompleted(String tenantId, String idempotencyKey, String responseRef) {
        String key = key(tenantId, idempotencyKey);
        redis.opsForValue().set(key, "COMPLETED:" + responseRef, ttl);
    }

    private String key(String tenantId, String idempotencyKey) {
        return "tenant:{" + tenantId + "}:idem:order:" + idempotencyKey + ":v1";
    }
}
```

Keuntungan:

- key schema terkonsentrasi,
- TTL eksplisit,
- serializer jelas,
- test mudah,
- migration lebih mudah,
- cluster hash tag bisa dikontrol,
- observability bisa ditempel di boundary repository.

---

## 12. Cache Abstraction: Produktif tapi Berbahaya Jika Buta

Spring Cache dengan Redis:

```java
@Cacheable(cacheNames = "users", key = "#userId")
public UserProfile getUserProfile(String userId) {
    return database.loadUserProfile(userId);
}
```

Ini nyaman.

Tetapi pertanyaan production-nya:

1. Key final di Redis seperti apa?
2. Apakah ada tenant di key?
3. TTL berapa?
4. Apakah null dicache?
5. Bagaimana invalidation saat write?
6. Apakah value serializer kompatibel lintas deployment?
7. Apa yang terjadi saat Redis timeout?
8. Apakah cache miss metric ada?
9. Apakah cache stampede dicegah?
10. Apakah method punya side effect?

`@Cacheable` cocok untuk simple derived read model. Tidak cocok untuk semua state.

Gunakan cache abstraction jika:

- data derived dari source of truth,
- stale read acceptable,
- TTL sederhana,
- key sederhana,
- invalidation sederhana,
- failure Redis boleh fallback ke source.

Jangan gunakan begitu saja untuk:

- idempotency,
- quota enforcement,
- lock,
- regulatory decision state,
- workflow state,
- event processing state,
- anything requiring explicit state machine.

---

## 13. Timeout Design

Redis timeout bukan angka random.

Timeout harus ditentukan dari:

- request SLO,
- Redis expected p99 latency,
- network p99,
- command complexity,
- retry policy,
- fallback behavior,
- user-facing criticality.

Contoh:

```text
API SLO p95: 200 ms
DB fallback: 80 ms p95
Redis normal p99: 5 ms
Redis timeout: maybe 30-50 ms for cache reads
```

Jika cache read timeout 2 detik, maka cache yang seharusnya membantu justru menghancurkan latency API.

### 13.1 Different Timeout per Use Case

| Use case | Timeout posture |
|---|---|
| Best-effort cache read | Short timeout, fallback allowed |
| Idempotency key write | Stricter; failure may reject or degrade carefully |
| Rate limiter | Fail-open or fail-closed must be policy decision |
| Lock acquire | Short timeout; no indefinite wait |
| Stream consumer | Longer blocking read but dedicated connection |
| Admin migration | Separate timeout/profile |

### 13.2 Timeout Tanpa Retry Kadang Lebih Aman

Redis command biasanya cepat. Kalau timeout terjadi, penyebabnya bisa:

- network partition,
- Redis overloaded,
- server blocked by slow command/script,
- client event loop saturated,
- pool exhausted,
- GC pause.

Blind retry bisa membuat masalah lebih buruk.

Gunakan retry hanya jika:

- command idempotent,
- retry budget terbatas,
- ada jitter,
- ada circuit breaker,
- timeout pendek,
- metric jelas,
- tidak membuat thundering herd.

---

## 14. Error Handling: Jangan Semua Redis Exception Disamakan

Kategori error:

```text
1. Connection error
2. Timeout error
3. Command error
4. Serialization/deserialization error
5. MOVED/ASK cluster redirect error
6. READONLY error after failover
7. NOAUTH / ACL error
8. OOM command not allowed
9. BUSY script error
10. WRONGTYPE data modeling error
```

Respons aplikasi harus berbeda.

### 14.1 Cache Read Error

Untuk cache read:

```text
Redis GET fails
  ↓
log/metric
  ↓
fallback to source of truth
  ↓
maybe skip cache populate if Redis unhealthy
```

### 14.2 Rate Limiter Error

Untuk rate limiter:

```text
Redis limiter fails
  ↓
policy decision:
    fail-open? allow traffic but risk abuse
    fail-closed? reject traffic but risk outage
    degraded local limiter? approximate protection
```

Tidak ada jawaban universal. Untuk regulatory/enforcement systems, ini harus diputuskan per endpoint dan risk level.

### 14.3 Idempotency Error

Untuk idempotency:

```text
Cannot write idempotency key
  ↓
Do not blindly process non-idempotent operation
```

Mungkin lebih aman return `503 Retry-After` daripada memproses pembayaran/enforcement action dua kali.

### 14.4 WRONGTYPE Error

`WRONGTYPE` biasanya bukan transient error. Ini data modeling bug.

Kemungkinan penyebab:

- key collision,
- version mismatch,
- dua service memakai namespace sama,
- manual debugging command merusak key,
- migration setengah jalan.

Jangan retry `WRONGTYPE`.

---

## 15. Cluster-Aware Java Client Design

Dalam Redis Cluster, client harus memahami topology.

Client harus mampu:

- map key ke slot,
- route command ke node benar,
- handle `MOVED`,
- handle `ASK`,
- refresh topology,
- deal with failover,
- preserve multi-key slot constraint.

### 15.1 Key Design di Java Repository

Kalau use case butuh multi-key operation, gunakan hash tag.

```java
private String quotaKey(String tenantId, String userId) {
    return "tenant:{" + tenantId + "}:user:" + userId + ":quota:v1";
}

private String auditTempKey(String tenantId, String requestId) {
    return "tenant:{" + tenantId + "}:audit-temp:" + requestId + ":v1";
}
```

Bagian di dalam `{...}` menentukan cluster hash tag.

Jika dua key harus dipakai di script/transaction yang sama, mereka harus slot sama.

### 15.2 Jangan Buat Hash Tag Terlalu Luas

Buruk:

```text
{global}:tenant:1:user:1
{global}:tenant:2:user:2
```

Semua masuk satu slot. Ini menciptakan hot slot.

Lebih baik:

```text
tenant:{tenant-1}:user:1
tenant:{tenant-2}:user:2
```

Tetapi ini berarti semua key tenant besar bisa masuk satu slot. Untuk tenant sangat besar, perlu shard tag lebih granular:

```text
tenant:{tenant-1:shard-07}:user:123
```

Desain hash tag adalah keputusan arsitektur, bukan formatting.

---

## 16. Pipelining dari Java

Pipeline mengurangi round trip.

Tanpa pipeline:

```text
GET key1  → wait
GET key2  → wait
GET key3  → wait
```

Dengan pipeline:

```text
GET key1  \
GET key2   > send together
GET key3  /
wait responses
```

### 16.1 Kapan Pipeline Cocok

- batch read/write banyak key,
- cache warmup,
- migration ringan,
- metric flush,
- preload feature flags,
- bulk TTL update dengan hati-hati.

### 16.2 Kapan Pipeline Berbahaya

- batch terlalu besar,
- response besar,
- no backpressure,
- client memory naik,
- Redis output buffer membengkak,
- satu slow command menahan response lain,
- request path user menunggu batch besar.

Rule praktis:

```text
Pipeline size should be bounded and measured.
```

Mulai dari 50-500 command per batch tergantung payload dan latency, lalu benchmark.

---

## 17. Transaction dan WATCH dari Java

Redis transaction bukan SQL transaction.

Dengan Spring Data Redis atau native client, kamu bisa menjalankan `MULTI/EXEC`, tetapi harus paham:

- command di-queue,
- tidak ada rollback semantik seperti SQL,
- error command bisa muncul saat EXEC,
- connection stateful selama transaction,
- connection harus dedicated atau correctly bound,
- cluster multi-key tetap harus same slot.

Untuk banyak use case atomic multi-step, Lua sering lebih jelas dibanding `WATCH/MULTI/EXEC`.

Gunakan transaction ketika:

- butuh optimistic concurrency dengan `WATCH`,
- operasi sederhana,
- conflict handling jelas,
- key berada di slot sama.

Gunakan Lua ketika:

- butuh read-check-write atomic,
- ingin satu round trip,
- logic pendek dan deterministic,
- failure behavior jelas.

---

## 18. Blocking Commands dari Java

Blocking commands berguna untuk workers:

- `BLPOP`
- `BRPOP`
- `XREAD BLOCK`
- `XREADGROUP BLOCK`
- `BZPOPMIN`
- `BZPOPMAX`

Tetapi jangan jalankan blocking command di shared request connection.

Pola aman:

```text
HTTP request Redis connection(s)
  - short timeout
  - no blocking command

Worker Redis connection(s)
  - dedicated
  - blocking read allowed
  - separate metrics
  - separate shutdown lifecycle
```

Contoh worker lifecycle:

```java
@Component
public class QueueWorker {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean running = true;

    @PostConstruct
    public void start() {
        executor.submit(this::runLoop);
    }

    private void runLoop() {
        while (running) {
            try {
                // Use dedicated Redis connection/template/client for blocking operation.
                // Pseudocode: blockingPop with timeout, then process.
            } catch (Exception e) {
                // log, metric, bounded sleep/backoff
            }
        }
    }

    @PreDestroy
    public void stop() {
        running = false;
        executor.shutdownNow();
    }
}
```

Dalam sistem production, worker Redis connection sebaiknya bukan connection yang sama dengan API request cache calls.

---

## 19. Pub/Sub dan Listener Container di Spring

Spring Data Redis menyediakan `RedisMessageListenerContainer` untuk Pub/Sub.

Gunakan untuk:

- cache invalidation signal,
- lightweight notifications,
- local process coordination,
- non-durable fanout.

Perhatikan:

- subscriber butuh long-lived connection,
- delivery tidak durable,
- listener execution thread pool harus dikontrol,
- handler tidak boleh blocking lama,
- exception handler harus jelas,
- reconnect behavior harus dites.

Jangan campur Pub/Sub connection dengan normal request command flow.

---

## 20. Observability di Client Layer

Redis server metrics saja tidak cukup.

Client metrics yang perlu:

1. command count by operation/use case,
2. command latency distribution,
3. timeout count,
4. connection errors,
5. pool active/idle/wait time,
6. reconnect count,
7. topology refresh count,
8. serialization error count,
9. cache hit/miss,
10. fallback count,
11. retry count,
12. Lua script error count,
13. cluster redirect count,
14. payload size approximation,
15. slow command correlation.

### 20.1 Tagging Metrics

Jangan tag dengan raw key. Cardinality akan meledak.

Buruk:

```text
redis.command.latency{key="tenant:123:user:456:profile:v1"}
```

Baik:

```text
redis.command.latency{operation="user_profile_cache_get", command="GET"}
```

### 20.2 Repository-Level Metrics

Lebih baik metric di Redis repository:

```java
public Optional<UserProfile> getProfile(String tenantId, String userId) {
    Timer.Sample sample = Timer.start(meterRegistry);
    try {
        String json = redis.opsForValue().get(key(tenantId, userId));
        if (json == null) {
            meterRegistry.counter("redis.cache.miss", "cache", "user_profile").increment();
            return Optional.empty();
        }
        meterRegistry.counter("redis.cache.hit", "cache", "user_profile").increment();
        return Optional.of(parse(json));
    } catch (Exception e) {
        meterRegistry.counter("redis.cache.error", "cache", "user_profile", "type", e.getClass().getSimpleName()).increment();
        throw e;
    } finally {
        sample.stop(meterRegistry.timer("redis.cache.latency", "cache", "user_profile"));
    }
}
```

Metric di repository lebih bermakna daripada metric generic command saja karena membawa business operation context.

---

## 21. Security and Secrets from Java

Client configuration harus mencakup:

- username/password ACL,
- TLS jika network boundary membutuhkan,
- secret tidak hardcoded,
- rotation plan,
- command ACL sesuai role,
- least privilege per application,
- no admin command dari app biasa,
- no `FLUSHALL`, `CONFIG`, dangerous command exposure.

Contoh role separation:

| App | Allowed operations |
|---|---|
| API cache service | `GET`, `SET`, `DEL`, `EXPIRE`, selected hash commands |
| rate limiter service | `EVALSHA`, `INCR`, `EXPIRE`, `GET`, `SET` |
| stream worker | `XREADGROUP`, `XACK`, `XCLAIM`, `XADD` |
| admin migration job | broader but temporary |

Prinsip:

```text
Aplikasi business path tidak perlu Redis superuser.
```

---

## 22. Local Cache + Redis Client

Kadang Redis masih terlalu jauh untuk hot path tertentu. Java service bisa memakai two-level cache:

```text
L1 local in-process cache
  ↓ miss
L2 Redis cache
  ↓ miss
Source of truth
```

Contoh L1:

- Caffeine,
- simple bounded map,
- framework cache local.

Use case:

- feature flags,
- configuration,
- reference data,
- hot profile snapshot,
- permission snapshot dengan TTL pendek.

Risiko:

- stale data lebih lama,
- invalidation lebih kompleks,
- per-instance divergence,
- memory pressure di JVM,
- cache stampede pindah ke Redis jika L1 expired serempak.

Design rule:

```text
L1 cache should be small, bounded, TTL-jittered, and safe to be stale.
```

---

## 23. Redis Client in Microservices: Boundary Design

Jangan setiap service bebas membuat key Redis global tanpa kontrak.

Buat ownership model:

```text
service-name owns prefix:
  enforcement-api:*       owned by enforcement-api
  case-workflow:*         owned by case-workflow
  notification-worker:*   owned by notification-worker
```

Untuk shared Redis cluster, wajib ada:

- prefix convention,
- TTL policy per prefix,
- max cardinality expectation,
- data type per key pattern,
- owner team,
- deletion/migration policy,
- access control,
- dashboard per prefix,
- incident runbook.

Redis key adalah shared operational surface. Treat it like API.

---

## 24. Production Configuration Checklist

### 24.1 Client Choice

- [ ] Sudah dipilih Lettuce/Jedis/Spring Data Redis dengan alasan jelas.
- [ ] Sync/async/reactive sesuai application runtime.
- [ ] Tidak memakai reactive hanya karena modern.
- [ ] Blocking workloads diisolasi.

### 24.2 Connection

- [ ] Connection lifecycle managed by Spring/client properly.
- [ ] No manual singleton `RedisConnection` shared unsafely.
- [ ] Pool hanya dipakai jika ada alasan.
- [ ] Pool size dihitung dan dimonitor.
- [ ] Dedicated connection untuk Pub/Sub/blocking/transaction jika perlu.

### 24.3 Timeout and Retry

- [ ] Timeout per use case.
- [ ] Cache read timeout pendek.
- [ ] Retry bounded.
- [ ] Jitter/backoff ada jika retry.
- [ ] Circuit breaker dipertimbangkan untuk Redis dependency.
- [ ] Fail-open/fail-closed policy eksplisit.

### 24.4 Serialization

- [ ] Key serializer string.
- [ ] Value serializer eksplisit.
- [ ] Java native serialization tidak dipakai tanpa alasan kuat.
- [ ] Schema version untuk value penting.
- [ ] Deserialization failure metric ada.
- [ ] Backward compatibility diuji.

### 24.5 Key Schema

- [ ] Prefix owner jelas.
- [ ] Tenant dimension jelas.
- [ ] Version in key jika perlu.
- [ ] Cluster hash tag dirancang.
- [ ] Tidak ada key collision antar service.
- [ ] TTL policy jelas.

### 24.6 Cluster/Sentinel

- [ ] Client topology refresh configured/tested.
- [ ] Failover behavior tested.
- [ ] `MOVED`/`ASK` handled by client.
- [ ] Multi-key operations same slot.
- [ ] Read from replica policy jelas.

### 24.7 Observability

- [ ] Command latency metric.
- [ ] Operation-level latency metric.
- [ ] Timeout/error counters.
- [ ] Pool metrics.
- [ ] Cache hit/miss.
- [ ] Redis fallback metric.
- [ ] Serialization error metric.
- [ ] Cluster redirect/reconnect metric.

### 24.8 Testing

- [ ] Testcontainers Redis integration test.
- [ ] TTL behavior tested.
- [ ] Serializer compatibility tested.
- [ ] Redis unavailable scenario tested.
- [ ] Timeout scenario tested.
- [ ] Failover scenario tested if using Sentinel/Cluster.
- [ ] Lua scripts tested.
- [ ] Key schema contract test exists.

---

## 25. Recommended Layering for Java Services

Struktur yang maintainable:

```text
application service
   ↓
domain/use-case service
   ↓
Redis-backed component with explicit purpose
   ↓
Redis repository / gateway
   ↓
RedisTemplate / Lettuce / Jedis
   ↓
Redis server
```

Contoh package:

```text
com.company.enforcement.redis
  ├── RedisKeyFactory.java
  ├── RedisSerializationConfig.java
  ├── UserProfileCache.java
  ├── IdempotencyStore.java
  ├── RateLimiterStore.java
  ├── WorkflowLeaseStore.java
  └── RedisMetrics.java
```

Jangan:

```text
Any service anywhere directly calls redisTemplate with ad-hoc keys.
```

---

## 26. Example: Production-Oriented Cache Repository

```java
@Component
public class CaseSummaryCache {
    private static final Duration TTL = Duration.ofMinutes(10);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public CaseSummaryCache(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    public Optional<CaseSummaryCacheValue> get(String tenantId, String caseId) {
        String raw = redis.opsForValue().get(key(tenantId, caseId));
        if (raw == null) {
            return Optional.empty();
        }

        try {
            CaseSummaryCacheValue value = objectMapper.readValue(raw, CaseSummaryCacheValue.class);
            if (value.schemaVersion() != 1) {
                return Optional.empty();
            }
            return Optional.of(value);
        } catch (Exception ex) {
            // In cache-aside, corrupted cache value should usually be treated as miss,
            // followed by async/safe cleanup and metric.
            redis.delete(key(tenantId, caseId));
            return Optional.empty();
        }
    }

    public void put(String tenantId, String caseId, CaseSummaryCacheValue value) {
        try {
            String raw = objectMapper.writeValueAsString(value);
            redis.opsForValue().set(key(tenantId, caseId), raw, TTL);
        } catch (Exception ex) {
            // For cache population failure, usually do not fail main request.
            // But emit metric/log in real implementation.
        }
    }

    public void evict(String tenantId, String caseId) {
        redis.delete(key(tenantId, caseId));
    }

    private String key(String tenantId, String caseId) {
        return "tenant:{" + tenantId + "}:case:" + caseId + ":summary:v1";
    }
}

public record CaseSummaryCacheValue(
        int schemaVersion,
        String caseId,
        String status,
        String assignedOfficerId,
        Instant lastUpdatedAt
) {}
```

Important properties:

- key string explicit,
- tenant hash tag explicit,
- TTL explicit,
- schema version explicit,
- corrupted cache treated as miss,
- cache write failure does not fail business request,
- repository owns Redis detail.

---

## 27. Example: Fail-Closed Idempotency Store

```java
@Component
public class EnforcementActionIdempotencyStore {
    private static final Duration STARTED_TTL = Duration.ofMinutes(15);
    private static final Duration COMPLETED_TTL = Duration.ofHours(24);

    private final StringRedisTemplate redis;

    public EnforcementActionIdempotencyStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public StartResult tryStart(String tenantId, String idempotencyKey) {
        String key = key(tenantId, idempotencyKey);
        Boolean ok = redis.opsForValue().setIfAbsent(key, "STARTED", STARTED_TTL);

        if (Boolean.TRUE.equals(ok)) {
            return StartResult.STARTED_BY_THIS_REQUEST;
        }

        String existing = redis.opsForValue().get(key);
        if (existing == null) {
            return StartResult.RETRYABLE_UNKNOWN;
        }
        if (existing.startsWith("COMPLETED:")) {
            return StartResult.ALREADY_COMPLETED;
        }
        return StartResult.ALREADY_IN_PROGRESS;
    }

    public void complete(String tenantId, String idempotencyKey, String resultRef) {
        redis.opsForValue().set(key(tenantId, idempotencyKey), "COMPLETED:" + resultRef, COMPLETED_TTL);
    }

    private String key(String tenantId, String idempotencyKey) {
        return "tenant:{" + tenantId + "}:idem:enforcement-action:" + idempotencyKey + ":v1";
    }

    public enum StartResult {
        STARTED_BY_THIS_REQUEST,
        ALREADY_IN_PROGRESS,
        ALREADY_COMPLETED,
        RETRYABLE_UNKNOWN
    }
}
```

Catatan penting:

- Ini masih simplified.
- Untuk correctness lebih tinggi, gunakan Lua agar read-check-transition lebih atomic.
- Redis failure pada idempotency tidak boleh diperlakukan sama seperti cache failure.

---

## 28. Example: Lettuce Low-Level Skeleton

```java
public final class LettuceRedisClientExample implements AutoCloseable {
    private final RedisClient client;
    private final StatefulRedisConnection<String, String> connection;
    private final RedisCommands<String, String> sync;

    public LettuceRedisClientExample(String uri) {
        this.client = RedisClient.create(uri);
        this.connection = client.connect();
        this.sync = connection.sync();
    }

    public Optional<String> get(String key) {
        return Optional.ofNullable(sync.get(key));
    }

    public void set(String key, String value, Duration ttl) {
        sync.setex(key, ttl.toSeconds(), value);
    }

    @Override
    public void close() {
        connection.close();
        client.shutdown();
    }
}
```

Untuk Spring Boot, biasanya kamu tidak membuat lifecycle seperti ini manual kecuali membangun library/infrastructure sendiri. Tetapi memahami struktur ini membantu debugging.

---

## 29. Common Production Bugs

### Bug 1 — Serializer Changed, Old Cache Breaks New Deployment

Symptom:

```text
After deployment, many Redis deserialization errors.
```

Cause:

- class renamed,
- field changed,
- type info changed,
- old value incompatible.

Fix:

- schema version,
- tolerant reader,
- cache namespace version bump,
- short TTL during migration,
- delete old prefix carefully.

### Bug 2 — Pool Exhaustion During Redis Incident

Symptom:

```text
API threads waiting for Redis connection.
```

Cause:

- long timeout,
- Redis slow/unreachable,
- pool small,
- retry storm.

Fix:

- short timeout,
- circuit breaker,
- no blocking command in pool,
- fallback for cache,
- bounded concurrency.

### Bug 3 — Blocking Command on Shared Connection

Symptom:

```text
Random GET/SET latency spikes.
```

Cause:

- worker uses `BLPOP` on shared connection.

Fix:

- dedicated worker connection,
- separate client bean,
- separate timeout profile.

### Bug 4 — Hidden `@Cacheable` Key Collision

Symptom:

```text
Wrong user data returned or WRONGTYPE.
```

Cause:

- cache name/key not tenant-aware,
- same cache name used across domain,
- serializer mismatch.

Fix:

- explicit key generator,
- tenant prefix,
- cache naming convention,
- repository for sensitive cache.

### Bug 5 — Reactive API with `.block()`

Symptom:

```text
WebFlux app stalls under load.
```

Cause:

- blocking inside event loop,
- sync Redis call inside reactive chain,
- JSON parsing CPU on event loop.

Fix:

- end-to-end non-blocking,
- offload CPU if necessary,
- avoid `.block()`,
- use bounded concurrency.

---

## 30. Review Questions

Gunakan pertanyaan ini saat design review:

1. Redis client apa yang dipakai dan kenapa?
2. Apakah operasi ini cache, coordination, queue, stream, lock, atau state store?
3. Apakah failure Redis boleh diabaikan, fallback, fail-open, atau fail-closed?
4. Serializer key/value apa yang dipakai?
5. Apakah value schema versioned?
6. Apakah key tenant-aware?
7. Apakah TTL eksplisit?
8. Apakah operation ini aman di Redis Cluster?
9. Apakah ada multi-key command? Same slot?
10. Apakah command blocking?
11. Apakah connection/pool diisolasi untuk blocking/transaction/PubSub?
12. Timeout berapa dan berdasarkan SLO apa?
13. Retry ada? Apakah idempotent?
14. Metrics apa yang membuktikan Redis membantu, bukan merusak?
15. Bagaimana behavior saat Redis down?
16. Bagaimana behavior saat failover?
17. Bagaimana migration key/value dilakukan?
18. Apakah cache abstraction menyembunyikan kontrak penting?

---

## 31. Mini Lab

### Lab A — Serializer Visibility

1. Buat Spring Boot app dengan `StringRedisTemplate`.
2. Simpan value JSON manual.
3. Inspect via `redis-cli GET key`.
4. Ganti ke `RedisTemplate` default serializer.
5. Inspect lagi via `redis-cli`.
6. Catat perbedaan debuggability.

Expected learning:

```text
Serializer mempengaruhi operability, bukan hanya coding convenience.
```

### Lab B — Pool Exhaustion Simulation

1. Configure small Redis pool.
2. Buat endpoint yang menjalankan blocking command atau sleep-like Lua script.
3. Jalankan load test ringan.
4. Observe pool wait time, API latency, timeout.
5. Pisahkan blocking command ke dedicated connection.
6. Bandingkan hasil.

Expected learning:

```text
Pool problem sering merupakan symptom isolation problem.
```

### Lab C — Cache Failure Fallback

1. Buat endpoint cache-aside.
2. Redis up: observe hit/miss.
3. Redis down: pastikan fallback ke DB berjalan.
4. Redis slow: pastikan timeout tidak menghancurkan SLO.
5. Tambahkan metric fallback.

Expected learning:

```text
Cache harus mempercepat normal path tanpa menghancurkan degraded path.
```

### Lab D — Cluster Hash Tag Test

1. Jalankan Redis Cluster lokal.
2. Buat dua key tanpa hash tag.
3. Coba Lua/multi-key operation.
4. Observe cross-slot error.
5. Tambahkan hash tag.
6. Ulangi.

Expected learning:

```text
Cluster compatibility dimulai dari key naming, bukan dari client config.
```

---

## 32. Ringkasan Mental Model

Java Redis mastery bukan tentang hafal API client.

Yang penting adalah memahami boundary:

```text
Application semantics
   ↓
Redis use case classification
   ↓
Failure policy
   ↓
Key schema
   ↓
Serialization
   ↓
Client connection model
   ↓
Timeout/retry/backpressure
   ↓
Cluster/failover behavior
   ↓
Observability
```

Kesimpulan utama:

1. **Lettuce** kuat untuk advanced sync/async/reactive dan connection sharing, tetapi butuh disiplin isolation.
2. **Jedis** sederhana untuk synchronous usage, tetapi pooling/concurrency harus jelas.
3. **Spring Data Redis** produktif untuk Spring apps, tetapi serializer, key, TTL, dan failure behavior harus eksplisit.
4. Jangan memakai connection pool hanya karena kebiasaan JDBC.
5. Blocking command, Pub/Sub, dan transaction butuh isolation.
6. Serializer adalah schema contract.
7. Cache failure tidak sama dengan idempotency/rate limiter failure.
8. Redis Cluster compatibility harus dirancang di key schema sejak awal.
9. Observability harus ada di operation-level, bukan hanya Redis server-level.
10. Redis client layer adalah bagian dari architecture, bukan plumbing.

---

## 33. Referensi Teknis untuk Dipelajari

Gunakan dokumentasi resmi sebagai anchor:

1. Redis Lettuce guide.
2. Lettuce reference: connection sharing, pooling, cluster.
3. Jedis guide.
4. Spring Data Redis reference.
5. Spring Data Redis template documentation.
6. Spring Data Redis driver documentation.
7. Spring Data Redis cache integration.
8. Redis Cluster specification.
9. Redis command documentation for timeout-sensitive commands.
10. Redis distributed locks and scripting docs.

---

## 34. Status Seri

```text
Part 025 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-026.md
```

Part berikutnya akan membahas:

```text
Part 026 — Transactions, WATCH, MULTI/EXEC, Optimistic Concurrency
```

Fokus berikutnya adalah memahami Redis transaction secara benar: bukan SQL transaction, tidak ada rollback seperti RDBMS, connection stateful, optimistic concurrency dengan `WATCH`, dan kapan lebih baik memakai Lua dibanding `MULTI/EXEC`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Latency Engineering: Pipelining, Batching, Pooling, Timeouts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-026.md">Part 026 — Transactions, WATCH, MULTI/EXEC, dan Optimistic Concurrency ➡️</a>
</div>
