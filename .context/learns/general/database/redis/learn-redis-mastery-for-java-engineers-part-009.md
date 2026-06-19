# learn-redis-mastery-for-java-engineers-part-009.md

# Part 009 — Cache Architecture I: Cache-Aside dengan Java Services

> Seri: `learn-redis-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / backend engineer  
> Fokus bagian ini: membangun mental model cache-aside yang benar, bukan sekadar pattern `get -> if null -> load -> set`.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- Redis core mental model.
- Keyspace dan tipe data.
- Strings, Hashes, Lists, Sets, Sorted Sets.
- TTL, expiration, dan eviction.

Sekarang kita mulai masuk ke use case Redis yang paling sering dipakai di backend system: **caching**.

Tetapi ada jebakan besar: banyak engineer menganggap caching itu sederhana karena pseudocode-nya terlihat sederhana.

```java
var value = redis.get(key);
if (value == null) {
    value = database.load(id);
    redis.set(key, value, ttl);
}
return value;
```

Kode di atas tampak benar, tetapi production failure sering muncul dari hal-hal yang tidak terlihat di pseudocode:

- Apa arti `null`?
- Apakah key punya version?
- Apakah TTL dipilih berdasarkan data volatility atau asal tebak?
- Apa yang terjadi saat database lambat?
- Apa yang terjadi saat Redis down?
- Apa yang terjadi jika 1.000 request miss key yang sama bersamaan?
- Apakah object yang dicache masih sesuai authorization user?
- Apakah stale data boleh muncul?
- Apakah stale data berdampak compliance?
- Apakah cache invalidation terjadi setelah write sukses atau sebelum?
- Apakah cache boleh menjadi sumber kebenaran implisit?

Bagian ini membangun fondasi **cache-aside**. Bagian berikutnya, Part 010, akan memperdalam consistency, invalidation, stampede, dan hot key secara lebih agresif.

---

## 1. Apa Itu Cache?

Cache adalah storage tambahan yang menyimpan hasil komputasi atau hasil baca dari sumber utama agar permintaan berikutnya bisa dilayani lebih cepat atau lebih murah.

Dalam arsitektur backend Java, cache biasanya dipakai untuk mengurangi:

1. Latency read.
2. Load database.
3. Cost query mahal.
4. Cost API call eksternal.
5. Repeated computation.
6. Contention pada resource utama.
7. Tail latency pada endpoint populer.

Namun cache juga menambah:

1. State tambahan.
2. Jalur konsistensi tambahan.
3. Failure mode tambahan.
4. Observability requirement tambahan.
5. Security dan authorization risk tambahan.
6. Operational complexity tambahan.

Jadi cache bukan “free speed”. Cache adalah **trade-off: performance ditukar dengan complexity dan potensi staleness**.

---

## 2. Redis sebagai Cache: Kenapa Populer?

Redis populer untuk caching karena:

- Data disimpan primarily di memory.
- Latency command sederhana sangat rendah.
- Tipe data kaya.
- TTL native.
- Atomic primitive sederhana.
- Banyak client library Java matang.
- Bisa dipakai cross-instance, berbeda dari local in-memory cache.
- Bisa dipakai untuk cache, session, counter, rate limiter, idempotency, lock, dan transient coordination.

Dokumentasi Redis menjelaskan cache-aside sebagai pola lazy loading di mana aplikasi bertanggung jawab membaca dan menulis baik ke cache maupun database. Ini berbeda dari read-through cache, karena cache tidak otomatis mengambil data dari database; aplikasi yang mengendalikan kapan data masuk cache. Redis juga menyebut cache-aside sebagai salah satu pola caching yang sangat umum dipakai developer Redis. [Redis caching for microservices](https://redis.io/tutorials/howtos/solutions/microservices/caching/), [Redis cache-aside discussion](https://redis.io/blog/redis-smart-cache/)

Redis command `EXPIRE` juga menjadikan key volatile dengan timeout sehingga key otomatis dihapus setelah waktu tertentu, dan `TTL` memungkinkan introspeksi sisa umur key. Ini membuat Redis sangat cocok untuk data yang secara desain memang punya lifecycle terbatas. [Redis EXPIRE](https://redis.io/docs/latest/commands/expire/), [Redis TTL](https://redis.io/docs/latest/commands/ttl/)

---

## 3. Mental Model Paling Penting: Cache Bukan Source of Truth

Dalam cache-aside klasik:

```text
Client -> Application -> Redis cache
                     -> Database/source of truth
```

Database atau source utama tetap menjadi **source of truth**.

Redis menyimpan **copy**, **projection**, atau **snapshot sementara** dari data utama.

Konsekuensinya:

1. Data di Redis boleh hilang.
2. Data di Redis boleh expired.
3. Data di Redis boleh stale dalam batas tertentu.
4. Data di Redis tidak boleh menjadi satu-satunya bukti audit kecuali memang Redis didesain sebagai primary store dengan persistence/replication/recovery policy yang jelas.
5. Application harus mampu recover dari cache miss.
6. Missing cache key bukan exception; itu kondisi normal.

Kalimat yang harus diinternalisasi:

> Cache adalah optimization layer. Kalau Redis hilang dan sistem utama tidak bisa secara fungsional berjalan, maka Redis sudah menjadi bagian dari correctness path, bukan sekadar cache.

Itu tidak selalu salah, tetapi desainnya harus diakui secara eksplisit.

---

## 4. Cache-Aside Pattern

Cache-aside disebut juga lazy loading.

Read flow dasar:

```text
1. Application menerima request.
2. Application membangun cache key.
3. Application membaca Redis.
4. Jika hit, return cached value.
5. Jika miss, baca source of truth.
6. Serialize result.
7. Simpan ke Redis dengan TTL.
8. Return result.
```

Write flow dasar:

```text
1. Application menerima write command.
2. Application menulis ke source of truth.
3. Application menghapus atau memperbarui cache.
4. Request berikutnya akan membaca data baru atau refill cache.
```

Cache-aside cocok ketika:

- Data read-heavy.
- Data bisa direkonstruksi dari source of truth.
- Data boleh stale sebentar.
- Data expensive untuk dihitung atau diambil.
- Ada cache key yang jelas.
- Ada TTL yang defensible.

Cache-aside berbahaya ketika:

- Data harus always strongly consistent.
- Data menyangkut hak akses yang berubah cepat.
- Data adalah mutable aggregate kompleks dengan banyak invalidation source.
- Miss storm bisa menjatuhkan database.
- Tidak ada observability hit/miss.
- Cache key tidak stabil.
- Cache object tidak punya version.

---

## 5. Cache-Aside Read Path secara Detail

Read path bukan hanya “GET lalu DB”. Kita pecah menjadi state machine.

```text
START
  |
  v
BUILD_KEY
  |
  v
READ_CACHE
  |-- HIT_VALID --------> RETURN
  |
  |-- MISS -------------> LOAD_SOURCE
  |                         |
  |                         |-- FOUND ------> SERIALIZE -> SET_CACHE -> RETURN
  |                         |
  |                         |-- NOT_FOUND ---> MAYBE_NEGATIVE_CACHE -> RETURN_NOT_FOUND
  |
  |-- REDIS_ERROR ------> FALLBACK_POLICY
                            |
                            |-- FAIL_OPEN -> LOAD_SOURCE -> RETURN
                            |-- FAIL_CLOSED -> ERROR
```

Setiap edge punya keputusan arsitektur.

### 5.1 BUILD_KEY

Key harus dibangun dari identity yang stabil.

Contoh buruk:

```text
user-profile:john
```

Masalah:

- Username bisa berubah.
- Tidak jelas tenant.
- Tidak jelas schema version.
- Tidak jelas object shape.

Contoh lebih baik:

```text
prod:identity:user-profile:v2:tenant:{tenant-123}:user:{user-456}
```

Tetapi jangan juga berlebihan sampai key menjadi terlalu panjang tanpa manfaat. Key Redis punya overhead memory. Key naming harus cukup informatif untuk ownership dan debugging, tetapi tetap hemat.

Format praktis:

```text
<env>:<bounded-context>:<object-type>:v<schema-version>:<partition-identity>:<object-id>
```

Contoh:

```text
prod:catalog:product-summary:v3:tenant:{t-42}:product:p-10001
prod:risk:case-state:v1:tenant:{t-42}:case:c-90001
prod:auth:user-permissions:v5:tenant:{t-42}:user:u-77
```

Catatan cluster:

- `{...}` adalah hash tag Redis Cluster.
- Key dengan hash tag yang sama diarahkan ke slot yang sama.
- Jangan asal memakai hash tag; gunakan hanya jika perlu operasi multi-key dalam slot yang sama.

### 5.2 READ_CACHE

Redis read harus dianggap sebagai remote call.

Walaupun cepat, tetap ada:

- network latency,
- serialization/deserialization,
- timeout,
- connection pool wait,
- GC pressure,
- Redis server queueing,
- possible failover.

Kode cache yang bagus tidak menganggap Redis seperti local `Map`.

### 5.3 HIT_VALID

Cache hit bukan berarti data semantik valid.

Validasi minimal bisa mencakup:

- schema version cocok,
- tenant cocok,
- object tidak expired secara business timestamp,
- authorization tidak embedded secara salah,
- object tidak melanggar invariant baru.

Karena itu, cached payload sebaiknya punya metadata.

Contoh payload:

```json
{
  "schemaVersion": 3,
  "cachedAtEpochMs": 1710000000000,
  "sourceVersion": 17,
  "data": {
    "productId": "p-10001",
    "name": "Redis Handbook",
    "price": 250000
  }
}
```

### 5.4 MISS

Cache miss bukan failure. Miss adalah kondisi normal.

Namun miss rate tinggi bisa berarti:

- TTL terlalu pendek.
- Key terlalu granular.
- Cache tidak pernah diisi.
- Invalidation terlalu agresif.
- Hot objects tidak diprewarm.
- Key version berubah terlalu sering.
- Redis evicting keys karena memory pressure.

### 5.5 LOAD_SOURCE

Source bisa berupa:

- PostgreSQL/MySQL,
- service internal,
- API eksternal,
- search index,
- computed aggregate,
- rules engine,
- file/object storage.

Cache-aside paling bernilai ketika source read mahal.

Tetapi hati-hati: Redis miss bisa memperparah load source kalau terjadi mass miss.

### 5.6 SET_CACHE

Set cache harus hampir selalu memakai TTL.

Contoh Redis command:

```text
SET prod:catalog:product-summary:v3:tenant:{t-42}:product:p-10001 <json> EX 300
```

Redis `SET` mendukung opsi expiry seperti `EX`, `PX`, `EXAT`, `PXAT`, dan `KEEPTTL`, sehingga satu command bisa menulis value sekaligus expiry secara atomic. [Redis SET](https://redis.io/docs/latest/commands/set/)

Jangan lakukan ini jika tidak perlu:

```text
SET key value
EXPIRE key 300
```

Karena antara `SET` dan `EXPIRE`, proses bisa crash atau request bisa timeout sehingga key tersimpan tanpa TTL. Untuk cache, key tanpa TTL sering menjadi bug laten.

---

## 6. Cache Write Path

Write path cache-aside biasanya lebih sulit daripada read path.

Ada beberapa strategi.

### 6.1 Write DB lalu Delete Cache

Flow:

```text
1. Begin write request.
2. Validate command.
3. Write source of truth.
4. Commit.
5. DEL cache key.
6. Return success.
```

Ini strategi paling umum.

Kelebihan:

- Sederhana.
- Cache berikutnya refill dari source terbaru.
- Tidak perlu membangun cached projection di write path.

Kekurangan:

- Ada window stale kalau delete gagal.
- Ada race antara read miss dan write.
- Perlu tahu semua key yang terpengaruh.

### 6.2 Write DB lalu Update Cache

Flow:

```text
1. Write source of truth.
2. Commit.
3. Build latest cache representation.
4. SET cache key dengan TTL.
```

Kelebihan:

- Request berikutnya langsung hit.
- Bagus jika cached representation sama dengan write result.

Kekurangan:

- Bisa menulis representation yang tidak lengkap.
- Sulit jika satu write mempengaruhi banyak projection.
- Race update cache bisa menghasilkan stale overwrite.

### 6.3 Delete Cache Sebelum DB Write

Biasanya buruk.

Flow:

```text
1. DEL cache.
2. Write DB.
```

Masalah:

- Jika setelah delete ada read sebelum DB commit, cache bisa diisi ulang dengan old data.
- Setelah DB commit, Redis bisa masih menyimpan old value hasil refill race.

Ini salah satu alasan muncul pola “double delete”, yang akan dibahas lebih detail di Part 010.

### 6.4 Write-through dan Write-behind

Ini bukan fokus Part 009, tetapi perlu tahu batasnya.

Write-through:

```text
Application writes cache and source together.
```

Write-behind:

```text
Application writes cache first, source updated asynchronously later.
```

Write-behind meningkatkan risiko data loss dan ordering problem. Jangan dipakai untuk data correctness-critical tanpa desain durability yang sangat jelas.

AWS caching strategy paper membedakan cache-aside/lazy loading dan write-through; pada kedua pendekatan, aplikasi tetap berperan dalam mengelola data apa yang dicache dan durasinya. [AWS database caching strategies using Redis](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html)

---

## 7. Key Design untuk Cache

Key design adalah skill Redis yang sering diremehkan.

Key harus menjawab:

1. Siapa owner key ini?
2. Environment apa?
3. Bounded context apa?
4. Data type apa?
5. Schema version berapa?
6. Tenant/user/resource mana?
7. Apakah aman untuk Redis Cluster?
8. Bagaimana invalidation menemukan key ini?
9. Bagaimana observability mengelompokkan key ini?
10. Apakah key bisa bocor PII?

### 7.1 Template Key

```text
<env>:<service-or-domain>:<cache-name>:v<version>:<dimension-name>:<dimension-value>:<id-name>:<id-value>
```

Contoh:

```text
prod:catalog:product-summary:v3:tenant:{t42}:product:p10001
prod:auth:permission-snapshot:v5:tenant:{t42}:user:u77
prod:case:case-overview:v2:tenant:{t42}:case:c90001
```

### 7.2 Jangan Masukkan Data Sensitif Mentah ke Key

Buruk:

```text
prod:user-by-email:john.doe@example.com
prod:lookup:ssn:123-45-6789
```

Lebih aman:

```text
prod:user-by-email-hash:v1:sha256:<digest>
```

Key sering muncul di:

- logs,
- metrics,
- slowlog,
- tracing,
- debug tooling,
- incident screenshots.

Jangan anggap key aman hanya karena value tidak terlihat.

### 7.3 Gunakan Version di Key

Versioning key memudahkan schema migration.

Misalnya payload lama:

```text
prod:catalog:product-summary:v1:product:p10001
```

Payload baru:

```text
prod:catalog:product-summary:v2:product:p10001
```

Dengan versioned key:

- deployment baru tidak perlu membaca object lama yang shape-nya tidak cocok,
- rollback lebih aman,
- cache warming bisa dilakukan paralel,
- invalidation lebih terisolasi.

Kekurangannya:

- old version key bisa tertinggal sampai TTL habis,
- memory sementara naik saat migration,
- observability harus memisahkan v1/v2.

### 7.4 Jangan Gunakan `KEYS` untuk Invalidation Production

Jangan desain invalidation yang bergantung pada:

```text
KEYS prod:catalog:product-summary:*
```

`KEYS` dapat memblokir Redis pada dataset besar. Untuk invalidation massal, desain dari awal:

- version bump,
- namespace version key,
- tag index,
- event-driven invalidation,
- short TTL,
- SCAN-based operational tooling dengan rate limit, bukan request path.

---

## 8. Value Design untuk Cache

Cache value bukan sekadar object JSON.

Value harus dirancang berdasarkan:

- ukuran,
- serialization cost,
- compatibility,
- partial read requirement,
- debugability,
- schema evolution,
- compression,
- security.

### 8.1 JSON sebagai Default Awal

Untuk banyak Java service, JSON adalah default yang masuk akal karena:

- mudah di-debug,
- language-neutral,
- kompatibel dengan ObjectMapper,
- cocok untuk cached DTO/projection,
- tidak mengunci pada Java native serialization.

Contoh:

```json
{
  "schemaVersion": 2,
  "cachedAt": "2026-06-20T10:00:00Z",
  "sourceVersion": 881,
  "data": {
    "caseId": "c-90001",
    "status": "UNDER_REVIEW",
    "assignedTeam": "ENFORCEMENT_L2"
  }
}
```

### 8.2 Hindari Java Native Serialization

Java native serialization buruk untuk cache lintas versi karena:

- sulit dibaca manusia,
- rawan compatibility issue,
- classpath-dependent,
- bisa berbahaya jika deserialization tidak dikontrol,
- menghasilkan payload besar,
- menyulitkan migrasi antar service/language.

Gunakan JSON, Protobuf, Avro, MessagePack, atau format eksplisit lain bila perlu. Untuk awal seri ini, JSON paling mudah untuk reasoning.

### 8.3 Payload Terlalu Besar adalah Masalah

Big value menyebabkan:

- network transfer besar,
- CPU serialization/deserialization tinggi,
- memory fragmentation,
- Redis latency spike,
- eviction pressure,
- sulit observability,
- tail latency buruk.

Rule of thumb praktis:

- Cache DTO kecil dan spesifik endpoint.
- Jangan cache aggregate besar hanya karena query DB mahal.
- Ukur ukuran serialized payload.
- Jangan cache list ribuan item sebagai satu key kecuali benar-benar dirancang.

### 8.4 Metadata dalam Payload

Metadata berguna untuk debugging dan safety.

Minimal:

```json
{
  "schemaVersion": 1,
  "cachedAtEpochMs": 1781930000000,
  "source": "case-service",
  "sourceVersion": 123,
  "data": {}
}
```

Namun jangan berlebihan. Metadata juga makan memory.

---

## 9. TTL Selection

TTL bukan angka dekoratif. TTL adalah kontrak staleness, memory, dan load.

Pertanyaan sebelum memilih TTL:

1. Berapa lama data boleh stale?
2. Seberapa sering data berubah?
3. Apa dampak jika data stale?
4. Apa dampak jika key miss?
5. Apakah source bisa menahan miss burst?
6. Apakah invalidation tersedia?
7. Apakah data user-specific atau global?
8. Apakah ada aturan compliance?
9. Apakah data boleh disimpan setelah user logout/delete?
10. Apakah TTL harus jittered?

### 9.1 TTL Pendek

Kelebihan:

- Staleness rendah.
- Data lama cepat hilang.
- Invalidation lebih sederhana.

Kekurangan:

- Hit rate rendah.
- Source load tinggi.
- Miss burst lebih sering.
- Cache kurang efektif.

### 9.2 TTL Panjang

Kelebihan:

- Hit rate tinggi.
- Source load rendah.
- Latency stabil.

Kekurangan:

- Staleness lebih lama.
- Invalidation lebih penting.
- Memory pressure lebih tinggi.
- Data yang seharusnya hilang bisa bertahan lama.

### 9.3 TTL Jitter

Jika semua key punya TTL sama dan diisi pada waktu berdekatan, banyak key bisa expired bersamaan.

Buruk:

```java
Duration ttl = Duration.ofMinutes(5);
```

Lebih baik:

```java
Duration base = Duration.ofMinutes(5);
Duration jitter = Duration.ofSeconds(ThreadLocalRandom.current().nextInt(0, 60));
Duration ttl = base.plus(jitter);
```

Tujuan jitter:

- mengurangi synchronized expiry,
- mengurangi stampede,
- meratakan database load.

### 9.4 TTL Berdasarkan Kelas Data

Contoh kebijakan:

| Data | Contoh | TTL Awal | Catatan |
|---|---|---:|---|
| Reference data jarang berubah | country, currency, static config | 1-24 jam | Tetap butuh invalidation manual/versioning |
| Product summary | katalog | 1-15 menit | Tergantung update frequency |
| User permission snapshot | authorization | 10-120 detik | Hati-hati stale permission |
| Case overview | workflow/regulatory case | 15-300 detik | Tergantung dampak stale status |
| External API result | risk score/vendor lookup | 1-60 menit | Perhatikan contract vendor |
| Negative lookup | entity not found | 5-60 detik | Jangan terlalu lama |
| Token/session | auth/session | sesuai policy | Bukan sekadar cache biasa |

---

## 10. Negative Caching

Negative caching adalah caching hasil “tidak ditemukan” atau “tidak ada data”.

Contoh:

```text
GET user:u999 -> miss
DB query -> not found
SET user:u999:negative true EX 30
```

Tujuannya:

- mencegah repeated DB hit untuk ID yang tidak ada,
- mengurangi abuse/enumeration load,
- menstabilkan latency.

Tetapi negative caching berbahaya jika:

- entity bisa dibuat setelah not found,
- permission berubah,
- data late-arriving,
- TTL terlalu panjang,
- key tidak membedakan tenant/context.

### 10.1 Representasi Negative Cache

Jangan hanya menyimpan string `null` tanpa kontrak.

Lebih baik:

```json
{
  "kind": "NEGATIVE",
  "schemaVersion": 1,
  "cachedAtEpochMs": 1781930000000,
  "reason": "NOT_FOUND"
}
```

Atau minimal sentinel value:

```text
__NULL__
```

Tetapi sentinel harus tidak ambigu dengan value valid.

### 10.2 TTL Negative Cache Biasanya Lebih Pendek

Jika positive cache TTL 5 menit, negative cache mungkin cukup 15-30 detik.

Alasannya:

- not-found bisa berubah menjadi found,
- terlalu lama menyimpan not-found bisa menimbulkan stale absence,
- abuse protection bisa ditangani rate limiter terpisah.

---

## 11. Null Caching vs Negative Caching

Bedakan:

```text
Negative caching = source mengatakan entity tidak ada.
Null caching     = source mengatakan field/value memang null.
```

Contoh:

```json
{
  "userId": "u77",
  "middleName": null
}
```

Itu bukan negative cache. Itu positive cache dengan field null.

Kesalahan umum:

```java
if (cached == null) {
    loadFromDb();
}
```

Jika cached value bisa legitimate null, maka Anda butuh wrapper.

Contoh Java:

```java
sealed interface CacheResult<T> permits CacheHit, CacheMiss, CacheNegative {}

record CacheHit<T>(T value) implements CacheResult<T> {}
record CacheMiss<T>() implements CacheResult<T> {}
record CacheNegative<T>(String reason) implements CacheResult<T> {}
```

Dengan model ini, application tidak mencampur:

- Redis miss,
- entity not found,
- field null,
- deserialization error,
- Redis timeout.

---

## 12. Java Implementation Baseline dengan Lettuce

Contoh berikut sengaja explicit, bukan langsung Spring Cache abstraction, agar mental model terlihat.

### 12.1 Dependency Konseptual

Anda bisa memakai:

- Lettuce untuk sync/async/reactive Redis access.
- Jedis untuk synchronous model sederhana.
- Spring Data Redis untuk integrasi Spring.

Lettuce mendukung synchronous, asynchronous, dan reactive usage. Dokumentasi Redis menyebut Lettuce sebagai client Java yang advanced, termasuk dukungan async/reactive. [Redis Lettuce client docs](https://redis.io/docs/latest/develop/clients/lettuce/)

### 12.2 Cache Envelope

```java
public record CacheEnvelope<T>(
        int schemaVersion,
        long cachedAtEpochMs,
        String source,
        Long sourceVersion,
        T data
) {}
```

### 12.3 Cache Service Interface

```java
public interface CacheCodec<T> {
    String encode(CacheEnvelope<T> envelope);
    CacheEnvelope<T> decode(String raw);
}

public interface CacheAsideRepository<ID, T> {
    Optional<T> get(ID id);
}
```

### 12.4 Explicit Cache Aside Service

```java
import io.lettuce.core.api.sync.RedisCommands;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;

public final class ProductSummaryCache {

    private static final int SCHEMA_VERSION = 3;
    private static final String SOURCE = "catalog-service";

    private final RedisCommands<String, String> redis;
    private final ProductRepository productRepository;
    private final CacheCodec<ProductSummary> codec;

    public ProductSummaryCache(
            RedisCommands<String, String> redis,
            ProductRepository productRepository,
            CacheCodec<ProductSummary> codec
    ) {
        this.redis = redis;
        this.productRepository = productRepository;
        this.codec = codec;
    }

    public Optional<ProductSummary> getProductSummary(String tenantId, String productId) {
        String key = key(tenantId, productId);

        String raw = redis.get(key);
        if (raw != null) {
            CacheEnvelope<ProductSummary> envelope = codec.decode(raw);
            if (envelope.schemaVersion() == SCHEMA_VERSION) {
                return Optional.of(envelope.data());
            }

            // Defensive cleanup. Do not fail request only because old cache exists.
            redis.del(key);
        }

        Optional<ProductSummary> loaded = productRepository.findSummary(tenantId, productId);
        if (loaded.isEmpty()) {
            // Basic version: do not negative-cache yet.
            return Optional.empty();
        }

        ProductSummary summary = loaded.get();
        CacheEnvelope<ProductSummary> envelope = new CacheEnvelope<>(
                SCHEMA_VERSION,
                Instant.now().toEpochMilli(),
                SOURCE,
                summary.version(),
                summary
        );

        Duration ttl = ttlWithJitter(Duration.ofMinutes(5), Duration.ofSeconds(60));
        redis.setex(key, ttl.toSeconds(), codec.encode(envelope));

        return Optional.of(summary);
    }

    private static String key(String tenantId, String productId) {
        return "prod:catalog:product-summary:v3:tenant:{" + tenantId + "}:product:" + productId;
    }

    private static Duration ttlWithJitter(Duration base, Duration maxJitter) {
        long jitterSeconds = ThreadLocalRandom.current().nextLong(maxJitter.toSeconds() + 1);
        return base.plusSeconds(jitterSeconds);
    }
}
```

Catatan:

- `SETEX` menulis value dengan TTL dalam satu command.
- Untuk Redis modern, `SET key value EX seconds` juga umum.
- Jangan pakai two-step `SET` lalu `EXPIRE` untuk cache normal.
- Contoh belum menangani Redis timeout; itu dibahas di bawah.

---

## 13. Java Implementation dengan Fallback Policy

Redis bisa down. Pertanyaannya: endpoint Anda harus bagaimana?

Ada dua pola besar:

### 13.1 Fail Open

Jika Redis gagal, bypass cache dan baca source of truth.

Cocok untuk:

- cache murni,
- data bisa dibaca dari DB,
- DB cukup kuat untuk load sementara,
- availability endpoint lebih penting daripada mengurangi DB load.

Risiko:

- Redis outage bisa berubah menjadi database overload.
- Perlu circuit breaker dan rate limit.

### 13.2 Fail Closed

Jika Redis gagal, return error.

Cocok untuk:

- Redis adalah correctness dependency,
- source tidak bisa langsung diakses,
- Redis menyimpan session/token/rate-limit state,
- bypass akan melanggar policy.

Risiko:

- Redis outage langsung menjadi user-facing outage.

### 13.3 Kode Fail Open Sederhana

```java
public Optional<ProductSummary> getProductSummary(String tenantId, String productId) {
    String key = key(tenantId, productId);

    try {
        String raw = redis.get(key);
        if (raw != null) {
            return Optional.of(codec.decode(raw).data());
        }
    } catch (RuntimeException redisReadFailure) {
        metrics.increment("cache.redis.read.failure", "cache", "product-summary");
        // fail open: continue to source
    }

    Optional<ProductSummary> loaded = productRepository.findSummary(tenantId, productId);

    loaded.ifPresent(summary -> {
        try {
            CacheEnvelope<ProductSummary> envelope = envelope(summary);
            Duration ttl = ttlWithJitter(Duration.ofMinutes(5), Duration.ofSeconds(60));
            redis.setex(key, ttl.toSeconds(), codec.encode(envelope));
        } catch (RuntimeException redisWriteFailure) {
            metrics.increment("cache.redis.write.failure", "cache", "product-summary");
            // do not fail the read request only because cache population failed
        }
    });

    return loaded;
}
```

Kritik terhadap kode ini:

- Jika Redis down, semua request hit DB.
- Tidak ada request coalescing.
- Tidak ada circuit breaker.
- Tidak ada negative cache.
- Tidak ada deserialization fallback.

Ini baseline, bukan final production pattern.

---

## 14. Spring Cache Abstraction

Spring Data Redis menyediakan implementasi Spring Cache Abstraction melalui package `org.springframework.data.redis.cache`, dan bisa dikonfigurasi dengan `RedisCacheManager`. [Spring Data Redis cache docs](https://docs.spring.io/spring-data/redis/reference/redis/redis-cache.html)

Contoh sederhana:

```java
@Service
public class ProductService {

    private final ProductRepository productRepository;

    public ProductService(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Cacheable(
            cacheNames = "product-summary-v3",
            key = "#tenantId + ':' + #productId"
    )
    public ProductSummary getProductSummary(String tenantId, String productId) {
        return productRepository.findSummaryOrThrow(tenantId, productId);
    }

    @CacheEvict(
            cacheNames = "product-summary-v3",
            key = "#tenantId + ':' + #productId"
    )
    public void evictProductSummary(String tenantId, String productId) {
        // eviction hook
    }
}
```

Spring Cache berguna untuk:

- method-level cache sederhana,
- CRUD-ish service,
- cache yang tidak butuh logic kompleks,
- tim yang disiplin dengan annotation semantics.

Tetapi Spring Cache bisa berbahaya jika:

- key expression salah,
- tenant/security context tidak masuk key,
- method result depends on caller permissions,
- TTL per object perlu custom,
- cache invalidation multi-key kompleks,
- negative caching perlu dibedakan,
- deserialization/versioning perlu eksplisit,
- cache behavior tersembunyi di annotation sehingga sulit direview.

### 14.1 Annotation Cache Bisa Menyembunyikan Semantik

Contoh berbahaya:

```java
@Cacheable(cacheNames = "case-overview", key = "#caseId")
public CaseOverview getCaseOverview(String caseId) {
    User currentUser = securityContext.currentUser();
    return caseService.loadOverviewForUser(caseId, currentUser);
}
```

Masalah:

- Result bergantung pada current user.
- Key hanya `caseId`.
- User lain bisa menerima projection yang salah jika object berisi permission-filtered fields.

Lebih aman:

```java
@Cacheable(cacheNames = "case-overview", key = "#tenantId + ':' + #userId + ':' + #caseId")
public CaseOverview getCaseOverview(String tenantId, String userId, String caseId) {
    return caseService.loadOverviewForUser(tenantId, userId, caseId);
}
```

Tetapi ini menaikkan cardinality cache secara besar. Mungkin solusi yang lebih baik adalah cache raw case summary non-sensitive, lalu apply authorization filtering setelah cache read.

---

## 15. Authorization dan Security dalam Cache

Cache tidak boleh melewati security model.

Pertanyaan penting:

1. Apakah cached object sama untuk semua user?
2. Apakah object mengandung field yang permission-dependent?
3. Apakah tenant masuk key?
4. Apakah role/permission version masuk key?
5. Apakah permission change harus segera tercermin?
6. Apakah logout/revocation harus menghapus cache?
7. Apakah cache value mengandung PII?
8. Apakah Redis encryption/TLS/ACL sudah benar?

### 15.1 Cache Before Authorization vs After Authorization

Ada dua pendekatan.

#### Cache raw data, authorize/filter after read

```text
Redis stores canonical non-user-specific object.
Application applies authorization after cache hit.
```

Kelebihan:

- Cardinality rendah.
- Invalidation lebih mudah.
- Data lebih reusable.

Kekurangan:

- Application harus disiplin apply filter.
- Cached data mungkin mengandung field sensitif di Redis.

#### Cache user-specific projection

```text
Redis stores result after authorization/filtering.
Key includes user/permission dimension.
```

Kelebihan:

- Response cepat.
- Tidak perlu filter ulang pada hit.

Kekurangan:

- Cardinality tinggi.
- Permission changes sulit invalidated.
- Stale authorization risk.

Untuk regulatory/case management systems, jangan cache user-specific decision tanpa versioning permission yang jelas.

Contoh key dengan permission version:

```text
prod:case:visible-actions:v4:tenant:{t42}:user:u77:permver:19:case:c90001
```

Ketika permission version naik, key lama tidak dipakai lagi dan akan hilang via TTL.

---

## 16. Cache Granularity

Granularity menjawab: seberapa besar object yang dicache?

### 16.1 Coarse-Grained Cache

Contoh:

```text
product-page:{productId}
```

Value berisi semua data page.

Kelebihan:

- Satu Redis read.
- Simple untuk endpoint read-heavy.
- Latency rendah.

Kekurangan:

- Payload besar.
- Invalidation kompleks.
- Sedikit field berubah, semua object invalid.
- Tidak reusable antar endpoint.

### 16.2 Fine-Grained Cache

Contoh:

```text
product-basic:{productId}
product-price:{productId}
product-inventory:{productId}
product-rating:{productId}
```

Kelebihan:

- Invalidation lebih presisi.
- TTL bisa berbeda per subdomain.
- Reusable.

Kekurangan:

- Banyak Redis calls.
- Perlu pipelining/MGET.
- Composition complexity.
- Partial miss handling lebih rumit.

### 16.3 Projection Cache

Untuk backend Java, projection cache sering paling realistis.

Contoh:

```text
prod:catalog:product-card:v2:product:p10001
prod:catalog:product-detail:v7:product:p10001
prod:catalog:search-result-page:v1:queryhash:<hash>
```

Projection cache menyimpan bentuk data yang memang dibutuhkan read model tertentu.

Kelemahan: invalidation harus tahu projection mana yang terpengaruh.

---

## 17. Cache Key untuk Query Result

Caching by ID relatif mudah. Caching query result lebih berbahaya.

Contoh query:

```text
GET /cases?status=OPEN&assignee=me&page=2&sort=updatedAt_desc
```

Cache key harus mencakup semua parameter yang mempengaruhi result:

```text
prod:case:query-result:v1:tenant:{t42}:user:u77:hash:9f4c...
```

Hash dihitung dari canonical request:

```json
{
  "tenantId": "t42",
  "userId": "u77",
  "filters": {
    "status": ["OPEN"],
    "assignee": "me"
  },
  "page": 2,
  "size": 25,
  "sort": ["updatedAt:desc"]
}
```

Jangan hash raw query string tanpa canonicalization karena urutan parameter bisa beda tetapi semantik sama.

Buruk:

```text
/cases?status=OPEN&sort=updatedAt_desc
/cases?sort=updatedAt_desc&status=OPEN
```

Keduanya bisa menjadi key berbeda jika tidak dikanonikal.

### 17.1 Query Result Cache Sering Butuh TTL Pendek

Karena query result bisa berubah oleh banyak write:

- case created,
- case status changed,
- assignment changed,
- permission changed,
- SLA changed,
- sorting field changed.

Daripada invalidation terlalu kompleks, TTL pendek bisa lebih defensible.

---

## 18. Stampede Problem: Preview

Cache stampede terjadi ketika banyak request miss key yang sama lalu semuanya membaca source bersamaan.

Contoh:

```text
T=0: hot key expired
T=1ms: 1000 requests miss Redis
T=2ms: 1000 DB queries jalan
T=100ms: DB overloaded
T=200ms: retries mulai
T=500ms: outage cascade
```

Mitigasi akan dibahas detail di Part 010, tetapi Part 009 perlu memperkenalkan basic prevention:

1. TTL jitter.
2. Lock/mutex per key.
3. Request coalescing in-process.
4. Early refresh.
5. Stale-while-revalidate.
6. Prewarming.
7. Local cache for hottest values.

Baseline simple mutex:

```text
GET key
if miss:
  SET lock:key token NX PX 5000
  if lock acquired:
      load source
      SET key value EX ttl
      DEL lock safely
  else:
      sleep small backoff
      retry GET key
```

Namun lock punya failure mode sendiri. Detailnya nanti di Part 013 dan Part 010.

---

## 19. Hot Key Problem: Preview

Hot key adalah key yang menerima traffic sangat tinggi.

Contoh:

```text
prod:config:global:v1
prod:catalog:product-summary:v3:product:iphone-latest
prod:feature-flags:v10:tenant:t42
```

Masalah hot key:

- Satu Redis node/slot menerima traffic besar.
- Network dan CPU terpusat.
- Latency naik.
- Replica read bisa membantu tetapi ada stale read concern.
- Local cache mungkin lebih tepat.

Mitigasi awal:

1. Local in-memory cache untuk value sangat panas.
2. Client-side caching Redis.
3. Replicated read untuk read-only data.
4. Key sharding untuk counter/list tertentu.
5. Precompute dan distribute.

Redis mendokumentasikan server-assisted client-side caching sebagai teknik untuk menyimpan subset informasi di sisi aplikasi dan menerima invalidation dari server, yang bisa mengurangi traffic antara client dan Redis. [Redis client-side caching reference](https://redis.io/docs/latest/develop/reference/client-side-caching/)

Untuk Java services, client-side/local cache seperti Caffeine + Redis sering lebih efektif untuk hot read dibanding memukul Redis pada setiap request.

---

## 20. Multi-Level Cache: Local Cache + Redis

Arsitektur umum:

```text
Application local cache -> Redis distributed cache -> Database
```

Flow:

```text
1. Check local cache.
2. If local hit, return.
3. Check Redis.
4. If Redis hit, populate local cache, return.
5. Load DB.
6. Populate Redis.
7. Populate local cache.
8. Return.
```

Kelebihan:

- Latency lebih rendah.
- Redis load turun.
- Hot key lebih aman.

Kekurangan:

- Ada dua layer staleness.
- Invalidation lebih kompleks.
- Memory per app instance naik.
- Debugging lebih sulit.

Rule praktis:

- Gunakan local cache untuk small, very hot, safe-to-stale data.
- Gunakan Redis untuk shared cache antar instance.
- Jangan gunakan local cache untuk data permission-critical tanpa invalidation/versioning.

---

## 21. Observability untuk Cache-Aside

Cache tanpa observability adalah spekulasi.

Minimal metrics:

1. Cache hit count.
2. Cache miss count.
3. Hit ratio per cache name.
4. Redis read latency.
5. Redis write latency.
6. Source load latency on miss.
7. Cache fill success/failure.
8. Deserialization failure.
9. Cache payload size.
10. Eviction count.
11. Expired key rate.
12. Redis timeout count.
13. Fallback count.
14. Stampede lock contention.
15. Negative cache hit count.

### 21.1 Jangan Hanya Melihat Global Hit Ratio

Global hit ratio bisa menipu.

Contoh:

```text
Cache A: 99% hit, 1 juta request/minute
Cache B: 5% hit, 100 request/minute
Global tampak bagus.
```

Atau sebaliknya:

```text
Cache A low hit tetapi tidak penting.
Cache B high hit tetapi stale dan berbahaya.
```

Lihat per cache name dan per endpoint.

### 21.2 Metrik yang Harus Menjawab Pertanyaan Arsitektur

Pertanyaan:

- Apakah cache benar-benar menurunkan DB load?
- Apakah cache meningkatkan p95/p99 latency?
- Apakah miss menyebabkan tail latency buruk?
- Apakah Redis timeout membuat fallback storm?
- Apakah object terlalu besar?
- Apakah TTL terlalu pendek?
- Apakah negative cache bekerja?
- Apakah invalidation terlalu agresif?

Jika metrics tidak bisa menjawab ini, instrumentation belum cukup.

---

## 22. Cache Payload Size Budget

Jangan tunggu Redis memory penuh baru peduli ukuran value.

Budget sederhana:

```text
estimated_memory = number_of_keys * average_serialized_value_size * overhead_factor
```

Overhead factor bisa signifikan karena Redis object overhead, allocator fragmentation, key overhead, expiry metadata, replication/AOF buffer, dan cluster overhead.

Contoh kasar:

```text
1,000,000 keys
avg key length: 80 bytes
avg value: 2 KB
raw value: ~2 GB
with overhead: bisa jauh lebih tinggi
```

Cache design harus punya worksheet:

| Cache name | Cardinality | Avg value | TTL | Expected hit ratio | Owner | Invalidation |
|---|---:|---:|---:|---:|---|---|
| product-summary-v3 | 500k | 1.2 KB | 5m+jitter | 85% | catalog | evict on product update |
| case-overview-v2 | 2M | 2.5 KB | 60s+jitter | 60% | case | TTL only |
| permission-snapshot-v5 | 200k | 4 KB | 30s | 95% | auth | versioned permission |

---

## 23. Cache Invalidation Baseline

Invalidation adalah proses membuat cache lama tidak lagi dipakai.

Cara umum:

1. Delete key.
2. Overwrite key.
3. Short TTL.
4. Versioned key.
5. Namespace version.
6. Event-driven invalidation.
7. Manual/admin purge.

Part 009 cukup membahas baseline.

### 23.1 Delete on Write

```java
@Transactional
public void updateProduct(ProductUpdateCommand command) {
    productRepository.update(command);
    redis.del(productSummaryKey(command.tenantId(), command.productId()));
}
```

Masalah: transaksi database dan Redis tidak atomic bersama.

Jika DB commit sukses tetapi Redis delete gagal, stale cache tersisa.

Solusi awal:

- TTL tidak terlalu panjang.
- Retry async invalidation.
- Outbox event untuk invalidation.
- Versioned source data.

### 23.2 Event-Driven Invalidation

Flow:

```text
1. Service writes DB.
2. Service emits domain event after commit.
3. Cache invalidator consumes event.
4. Cache invalidator deletes/updates affected keys.
```

Karena Anda sudah punya materi Kafka/RabbitMQ, kita tidak ulang teori messaging. Untuk Redis caching, poinnya adalah:

- event harus after-commit,
- event harus cukup informasi untuk menentukan affected cache keys,
- invalidation consumer harus idempotent,
- delay invalidation berarti stale window,
- TTL tetap safety net.

---

## 24. Cache and Database Transaction Boundary

Kesalahan umum:

```java
@Transactional
public void updateCase(UpdateCaseCommand command) {
    caseRepository.update(command);
    redis.del(caseOverviewKey(command.caseId()));
}
```

Masalah:

- Redis delete terjadi sebelum DB transaction benar-benar commit.
- Jika transaction rollback setelah Redis delete, cache hilang padahal DB tidak berubah.
- Jika read terjadi sebelum commit, cache bisa refill old data.

Lebih baik:

```java
@Transactional
public void updateCase(UpdateCaseCommand command) {
    caseRepository.update(command);
    transactionSynchronization.afterCommit(() -> {
        redis.del(caseOverviewKey(command.caseId()));
    });
}
```

Atau gunakan outbox pattern:

```text
DB transaction:
  update case
  insert outbox event CASE_UPDATED

After commit:
  relay publishes event
  invalidator deletes cache
```

---

## 25. Error Taxonomy

Jangan tangkap semua exception dan diam.

Bedakan:

| Error | Meaning | Suggested response |
|---|---|---|
| Redis timeout | Cache unavailable/slow | Fail open for pure cache, record metric |
| Connection refused | Redis down/network | Circuit breaker, fallback |
| Deserialization error | Payload incompatible/corrupt | Delete key, load source, metric |
| Schema mismatch | Old cache version | Ignore/delete, reload |
| Source timeout on miss | DB/API slow | Return error or degraded response |
| Cache set failure | Fill failed | Return source result but metric |
| Negative cache hit | Entity absent cached | Return not found |
| Permission mismatch | Key/value design bug | Treat as critical defect |

### 25.1 Deserialization Failure Handling

```java
try {
    CacheEnvelope<ProductSummary> envelope = codec.decode(raw);
    return Optional.of(envelope.data());
} catch (RuntimeException decodeFailure) {
    metrics.increment("cache.decode.failure", "cache", "product-summary");
    redis.del(key); // best effort
    // reload from source
}
```

Do not return corrupt cache value.

---

## 26. Circuit Breaker untuk Redis Cache

Jika Redis mulai timeout, jangan setiap request tetap menunggu timeout.

Gunakan circuit breaker:

```text
CLOSED: normal Redis access
OPEN: bypass Redis temporarily
HALF_OPEN: test limited calls
```

Fail-open cache flow with circuit breaker:

```text
if redisCircuitBreaker.open:
    load source directly
else:
    try Redis
```

Tujuannya:

- melindungi request latency,
- mengurangi connection storm,
- memberi Redis waktu recovery,
- mencegah thread pool exhaustion.

Tetapi circuit breaker membuka risiko DB load spike. Maka source juga perlu bulkhead/rate limit.

---

## 27. Timeouts

Timeout Redis harus lebih kecil dari total request budget.

Jika endpoint SLO p95 = 200ms, maka Redis timeout 5 detik adalah absurd.

Contoh budget:

```text
Endpoint budget: 200 ms
Redis GET budget: 5-20 ms depending network
DB fallback budget: 100 ms
Serialization budget: 5 ms
Application overhead: rest
```

Redis yang cepat di happy path tetap harus punya timeout pendek untuk bad path.

Retry juga harus hati-hati:

- Retry GET mungkin aman tetapi menambah latency.
- Retry SET cache fill biasanya tidak perlu di request path.
- Retry Redis saat Redis overload bisa memperparah.
- Retry source on miss bisa menciptakan storm.

---

## 28. Cache Warmup

Cache warmup berarti mengisi cache sebelum traffic utama membutuhkannya.

Cocok untuk:

- reference data,
- top products,
- frequently accessed configuration,
- tenant-level settings,
- permission templates,
- expensive computed read models.

Tidak cocok untuk:

- high-cardinality user-specific data,
- data yang cepat berubah,
- query result terlalu banyak kombinasi,
- data yang jarang dipakai.

Warmup risk:

- startup storm,
- Redis memory spike,
- DB load saat deploy,
- duplicate warming dari banyak app instance.

Gunakan leader election/job scheduler/controlled rollout jika warmup mahal.

---

## 29. Cache Precompute vs Cache Aside

Cache-aside mengisi saat request datang.

Precompute mengisi sebelum request.

```text
Cache-aside:
  request -> miss -> compute -> set -> return

Precompute:
  event/job -> compute -> set
  request -> hit -> return
```

Precompute cocok ketika:

- computation mahal,
- data populer bisa diprediksi,
- write event jelas,
- read latency sangat ketat.

Cache-aside cocok ketika:

- access pattern tidak pasti,
- tidak ingin cache data yang tidak dipakai,
- miss latency masih diterima,
- source cukup kuat.

---

## 30. Cache untuk External API

Redis sering dipakai untuk cache hasil external API.

Pertanyaan penting:

1. Apakah vendor mengizinkan caching?
2. Berapa TTL sesuai contract?
3. Apakah response mengandung PII?
4. Apakah response user-specific?
5. Apakah stale result acceptable?
6. Apa fallback jika vendor down?
7. Apakah cache boleh dipakai untuk regulatory decision?
8. Apakah perlu menyimpan raw response untuk audit di tempat lain?

Untuk regulatory systems, jangan menganggap Redis cache vendor response sebagai audit record utama. Simpan evidence/audit trail di durable store.

---

## 31. Cache dan Regulatory/Enforcement Systems

Dalam sistem regulatory/case management, caching harus lebih hati-hati karena stale data bisa mempengaruhi:

- eligibility,
- escalation,
- case assignment,
- SLA calculation,
- enforcement decision,
- notification,
- permission visibility,
- audit defensibility.

Prinsip:

1. Cache boleh mempercepat read model.
2. Cache tidak boleh menjadi satu-satunya basis keputusan hukum/regulatory kecuali didesain sebagai durable decision store.
3. Decision harus punya source/version/timestamp.
4. Stale tolerance harus eksplisit.
5. UI boleh stale jika diberi refresh semantics; workflow transition biasanya tidak boleh stale.
6. Cache invalidation harus masuk design review.

Contoh:

```text
Case overview page: boleh cache 30-60 detik.
Case transition eligibility: harus recompute atau validate ulang saat submit.
Enforcement action finalization: jangan bergantung pada cached permission saja.
Audit history: jangan cache sebagai source utama.
```

---

## 32. Pattern: Cache Read Model, Validate Command Path

Pattern yang sangat berguna:

```text
Read path:
  boleh pakai cache untuk cepat menampilkan state.

Command/write path:
  validate ulang dari source of truth saat melakukan state transition.
```

Contoh:

```text
GET /cases/c90001/overview
  -> Redis cache OK

POST /cases/c90001/approve
  -> Load latest case from DB
  -> Validate state transition
  -> Validate permission
  -> Write transition
  -> Invalidate overview cache
```

Dengan ini:

- UI cepat,
- correctness tetap di command path,
- stale cache tidak langsung membuat invalid transition.

---

## 33. Cache Key Ownership Registry

Untuk sistem besar, buat registry.

Contoh:

```yaml
caches:
  product-summary-v3:
    owner: catalog-service
    keyPattern: "prod:catalog:product-summary:v3:tenant:{tenantId}:product:{productId}"
    ttl: "5m + 0-60s jitter"
    valueFormat: "json CacheEnvelope<ProductSummary>"
    invalidation:
      - ProductUpdated
      - ProductDeleted
    maxExpectedCardinality: 500000
    containsPII: false

  case-overview-v2:
    owner: case-service
    keyPattern: "prod:case:case-overview:v2:tenant:{tenantId}:case:{caseId}"
    ttl: "60s + 0-15s jitter"
    valueFormat: "json CacheEnvelope<CaseOverview>"
    invalidation:
      - CaseUpdated
      - AssignmentChanged
      - CaseTransitioned
    maxExpectedCardinality: 2000000
    containsPII: true
```

Manfaat:

- review lebih mudah,
- on-call tahu owner,
- security tahu PII,
- platform tahu memory budget,
- invalidation bisa diaudit,
- migration lebih aman.

---

## 34. Step-by-Step Design Exercise

Kita desain cache untuk endpoint:

```text
GET /api/v1/tenants/{tenantId}/products/{productId}/summary
```

### Step 1: Tentukan Source of Truth

```text
Source: PostgreSQL product tables
Owner: catalog-service
```

### Step 2: Tentukan Staleness Tolerance

```text
Product name/description: stale 5 menit OK
Price: stale maksimal 30 detik
Inventory: stale maksimal 5 detik atau jangan cache di sini
```

Kesimpulan:

Jangan cache semua dalam satu object jika TTL kebutuhan berbeda jauh.

Pisahkan:

```text
product-summary-cache
product-price-cache
inventory maybe not cached or separately cached
```

### Step 3: Tentukan Key

```text
prod:catalog:product-summary:v3:tenant:{t42}:product:p10001
```

### Step 4: Tentukan Value

```json
{
  "schemaVersion": 3,
  "cachedAtEpochMs": 1781930000000,
  "source": "catalog-service",
  "sourceVersion": 881,
  "data": {
    "productId": "p10001",
    "name": "Redis Mastery",
    "thumbnailUrl": "https://cdn.example.com/p10001.png",
    "category": "BOOK"
  }
}
```

### Step 5: Tentukan TTL

```text
Base TTL: 5 minutes
Jitter: 0-60 seconds
```

### Step 6: Tentukan Invalidation

Events:

```text
ProductUpdated
ProductDeleted
ProductImageChanged
CategoryChanged
```

Action:

```text
DEL product-summary key
```

### Step 7: Tentukan Fallback

Redis read failure:

```text
Fail open to DB, metric, circuit breaker.
```

DB miss:

```text
Negative cache 30 seconds if product truly absent.
```

### Step 8: Tentukan Metrics

```text
cache.product-summary.hit
cache.product-summary.miss
cache.product-summary.negative-hit
cache.product-summary.redis-read-latency
cache.product-summary.db-load-latency
cache.product-summary.decode-failure
cache.product-summary.fill-failure
```

---

## 35. Common Anti-Patterns

### 35.1 Cache Everything

Caching tanpa alasan spesifik sering memperburuk sistem.

Tanyakan:

```text
Masalah apa yang diselesaikan cache ini?
```

Jika jawabannya “biar cepat”, itu belum cukup.

### 35.2 No TTL

Cache key tanpa TTL harus sangat jarang.

Jika Redis dipakai sebagai cache, default harus TTL.

### 35.3 Cache User-Specific Result dengan Key Global

Buruk:

```java
@Cacheable(cacheNames = "dashboard", key = "#tenantId")
public Dashboard dashboard(String tenantId) {
    return dashboardForCurrentUser(tenantId);
}
```

Data user A bisa bocor ke user B.

### 35.4 Cache Mutable Aggregate Besar

Buruk:

```text
tenant-full-state:{tenantId} -> 50 MB JSON
```

Masalah:

- big key,
- huge deserialization,
- invalidation sulit,
- latency spike.

### 35.5 Cache Query Result Tanpa Canonical Key

Buruk:

```text
cache key = raw URL
```

Masalah:

- parameter order,
- default values,
- user permission,
- pagination,
- sorting,
- locale,
- feature flags.

### 35.6 Ignore Cache Fill Failure

Boleh tidak fail request, tetapi jangan diam.

Harus ada metric.

### 35.7 Long TTL untuk Permission

Permission, entitlement, authorization decision, dan workflow eligibility biasanya butuh TTL pendek atau versioning.

### 35.8 Treat Redis Miss as Error

Miss normal. Error adalah Redis unavailable, decode failure, atau source load failure.

### 35.9 Use Cache to Hide Bad Query Forever

Redis sering dipakai untuk menutupi query database buruk. Kadang ini pragmatis, tetapi jangan sampai cache menjadi alasan query/source tidak pernah diperbaiki.

---

## 36. Checklist Design Cache-Aside

Sebelum menambahkan cache, jawab:

### Purpose

- [ ] Masalah yang diselesaikan jelas: latency, load, cost, availability, atau repeated computation.
- [ ] Ada baseline metric sebelum cache.
- [ ] Ada target improvement.

### Data Semantics

- [ ] Source of truth jelas.
- [ ] Staleness tolerance jelas.
- [ ] Missing key behavior jelas.
- [ ] Negative caching policy jelas.
- [ ] Data sensitivity/PII jelas.

### Key

- [ ] Key punya owner/bounded context.
- [ ] Key menyertakan tenant jika multi-tenant.
- [ ] Key menyertakan schema version.
- [ ] Key tidak membocorkan PII mentah.
- [ ] Key cluster-aware jika perlu.

### Value

- [ ] Serialization format eksplisit.
- [ ] Schema evolution strategy ada.
- [ ] Payload size dipantau.
- [ ] Java native serialization dihindari kecuali ada alasan kuat.

### TTL

- [ ] TTL ada.
- [ ] TTL sesuai staleness tolerance.
- [ ] TTL diberi jitter untuk high-cardinality/hot cache.
- [ ] Negative TTL lebih pendek jika sesuai.

### Invalidation

- [ ] Write path jelas: delete/update/version bump.
- [ ] Event invalidation after-commit jika event-driven.
- [ ] Delete failure tidak silent.
- [ ] TTL menjadi safety net.

### Failure

- [ ] Redis timeout ditentukan.
- [ ] Fail-open/fail-closed policy eksplisit.
- [ ] Circuit breaker dipertimbangkan.
- [ ] DB/source protected dari miss storm.

### Observability

- [ ] Hit/miss per cache name.
- [ ] Redis latency.
- [ ] Source load latency on miss.
- [ ] Decode failures.
- [ ] Fill failures.
- [ ] Payload size.
- [ ] Eviction/expiration signals.

---

## 37. Mini Lab

### 37.1 Run Redis

```bash
docker run --name redis-cache-lab -p 6379:6379 -d redis:8
```

### 37.2 Manual Cache-Aside with redis-cli

```bash
redis-cli
```

```text
GET prod:catalog:product-summary:v1:tenant:{t42}:product:p10001
```

Expected:

```text
(nil)
```

Set value with TTL:

```text
SET prod:catalog:product-summary:v1:tenant:{t42}:product:p10001 '{"schemaVersion":1,"data":{"productId":"p10001","name":"Redis Mastery"}}' EX 300
```

Read:

```text
GET prod:catalog:product-summary:v1:tenant:{t42}:product:p10001
```

Check TTL:

```text
TTL prod:catalog:product-summary:v1:tenant:{t42}:product:p10001
```

Delete:

```text
DEL prod:catalog:product-summary:v1:tenant:{t42}:product:p10001
```

### 37.3 Observe Missing vs Negative Cache

Positive value:

```text
SET prod:catalog:product-summary:v1:tenant:{t42}:product:p10001 '{"kind":"VALUE","data":{"productId":"p10001"}}' EX 300
```

Negative value:

```text
SET prod:catalog:product-summary:v1:tenant:{t42}:product:p404 '{"kind":"NEGATIVE","reason":"NOT_FOUND"}' EX 30
```

Now your application must distinguish:

```text
Redis nil       -> cache miss
kind VALUE      -> cache hit
kind NEGATIVE   -> negative hit
Redis error     -> fallback policy
Decode error    -> delete/reload
```

---

## 38. Practical Java Exercise

Implement small service:

```text
ProductController
  -> ProductService
      -> ProductSummaryCache
          -> Redis
          -> ProductRepository
```

Requirements:

1. Key includes tenant and product ID.
2. Payload uses JSON envelope.
3. Positive TTL 5 minutes + 0-60 seconds jitter.
4. Negative TTL 30 seconds.
5. Redis read failure fails open.
6. Redis write failure does not fail request.
7. Decode failure deletes key and reloads source.
8. Metrics emitted for hit/miss/fill failure/decode failure.
9. Unit test for key generation.
10. Integration test with Testcontainers Redis.

Expected behavior matrix:

| Scenario | Redis | DB | Expected |
|---|---|---|---|
| Cache hit | value exists | not called | return value |
| Cache miss + DB found | nil | found | return DB value and set Redis |
| Cache miss + DB not found | nil | empty | return 404 and set negative cache |
| Negative hit | negative value | not called | return 404 |
| Redis down + DB found | error | found | return DB value |
| Redis down + DB down | error | error | return service error |
| Decode failure + DB found | bad value | found | delete key, return DB value |

---

## 39. Production Review Example

Suppose a team proposes:

```java
@Cacheable(cacheNames = "case", key = "#caseId")
public CaseDto getCase(String caseId) {
    return caseRepository.findCaseForCurrentUser(caseId);
}
```

Review response:

1. Key lacks tenant.
2. Key lacks user/authorization dimension.
3. Method result depends on current user.
4. Cache name lacks version.
5. TTL unspecified.
6. Serialization unspecified.
7. Invalidation unspecified.
8. PII risk unknown.
9. Stale tolerance unknown.
10. This can leak data across users.

Better direction:

```text
Option A:
Cache canonical case summary by tenant/case.
Apply authorization after reading cache.

Option B:
Cache user-specific projection with tenant/user/permissionVersion/case in key,
short TTL, and explicit invalidation on permission/case changes.
```

This is how senior engineers review Redis cache proposals: not by asking “does it compile?”, but by inspecting invariants.

---

## 40. Mental Model Summary

Cache-aside with Redis is simple only at toy scale.

At production scale, cache-aside is a state machine with explicit contracts:

```text
key contract
value contract
TTL contract
staleness contract
invalidation contract
fallback contract
observability contract
security contract
```

A safe Redis cache design makes these explicit.

A dangerous Redis cache design hides them behind annotations, default serializers, and guessed TTL values.

For Java engineers, the key mindset is:

> Redis cache is not a transparent performance booster. It is a distributed, lossy, time-bound read model that must be designed with lifecycle, consistency, and failure behavior.

---

## 41. What You Should Be Able to Explain After This Part

You should now be able to explain:

1. What cache-aside means.
2. Why cache is not source of truth.
3. How Redis read path works in cache-aside.
4. How Redis write path affects invalidation.
5. Why TTL is a staleness contract.
6. Why `SET key value EX seconds` is safer than `SET` then `EXPIRE`.
7. How negative caching differs from null caching.
8. Why cache key design matters for security and correctness.
9. Why Spring Cache abstraction can be useful but dangerous.
10. How Redis failure should be handled in Java services.
11. Why observability is mandatory.
12. How cache design changes in regulatory/case-management systems.

---

## 42. Bridge to Part 010

Part 009 introduced cache-aside foundation.

Part 010 will go deeper into the hard parts:

- stale read,
- read-your-write problem,
- write/delete race,
- double delete,
- stampede,
- hot key,
- local cache,
- early refresh,
- stale-while-revalidate,
- cache invalidation under concurrent writes,
- failure matrix.

Part 010 is where cache stops being a pattern and becomes a correctness/performance engineering problem.

---

## 43. References

- Redis Docs — Caching for microservices / cache-aside: https://redis.io/tutorials/howtos/solutions/microservices/caching/
- Redis Blog — Redis Cache-Aside Simplified: https://redis.io/blog/redis-smart-cache/
- Redis Docs — `EXPIRE`: https://redis.io/docs/latest/commands/expire/
- Redis Docs — `TTL`: https://redis.io/docs/latest/commands/ttl/
- Redis Docs — `SET`: https://redis.io/docs/latest/commands/set/
- Redis Docs — Client-side caching reference: https://redis.io/docs/latest/develop/reference/client-side-caching/
- Redis Docs — Lettuce client: https://redis.io/docs/latest/develop/clients/lettuce/
- Spring Data Redis — Redis Cache: https://docs.spring.io/spring-data/redis/reference/redis/redis-cache.html
- AWS Whitepaper — Database Caching Strategies Using Redis: https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — TTL, Expiration, Eviction: Data Hilang Bukan Bug, Tapi Kontrak</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-010.md">Part 010 — Cache Architecture II: Consistency, Invalidation, Stampede, Hot Key ➡️</a>
</div>
