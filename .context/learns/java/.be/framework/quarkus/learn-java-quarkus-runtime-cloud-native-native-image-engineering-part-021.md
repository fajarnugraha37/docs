# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-021
# Caching and State: Redis, Caffeine, Infinispan, Cache Invalidation

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `021`  
> Topik: Caching and State: Redis, Caffeine, Infinispan, Cache Invalidation  
> Status: Materi lanjutan advance — tidak mengulang dasar Java/Jakarta  
> Target: Software engineer yang mampu mendesain cache/state layer yang cepat, benar, observable, dan aman untuk sistem production

---

## 0. Ringkasan Besar

Caching sering dianggap sederhana:

```java
@CacheResult(cacheName = "countries")
public List<Country> countries() {
    return countryRepository.findAll();
}
```

Namun dalam sistem production, cache bukan hanya “membuat response lebih cepat”.

Cache adalah **state layer sekunder**.

Begitu data disalin dari source of truth ke cache, sistem harus menjawab:

1. Siapa source of truth?
2. Apakah cache boleh stale?
3. Berapa lama stale masih acceptable?
4. Bagaimana invalidation dilakukan?
5. Apakah cache lokal per pod atau distributed?
6. Apakah cache miss boleh menghantam database bersamaan?
7. Apa yang terjadi saat Redis down?
8. Apakah cache key stabil?
9. Apakah cached value punya schema/version?
10. Apakah permission/user/tenant ikut masuk cache key?
11. Apakah cache boleh menyimpan PII?
12. Apakah cache eviction bisa merusak correctness?
13. Apakah cache dipakai untuk performance, coordination, session, rate limit, atau idempotency?
14. Apakah cache observable?
15. Apakah cache bisa menyebabkan incident diam-diam karena data lama?

Part ini membahas cache di Quarkus dari sisi engineering, bukan hanya annotation.

---

## 1. Mental Model: Cache Adalah Materialized Approximation

Definisi praktis:

```text
Cache adalah salinan data yang sengaja dibuat lebih dekat, lebih murah,
atau lebih cepat diakses daripada source of truth.
```

Namun cache hampir selalu membawa trade-off:

```text
Speed naik,
cost turun,
latency turun,
tetapi consistency, invalidation, observability, dan failure mode menjadi lebih kompleks.
```

Mental model yang sehat:

```text
Cache is not free performance.
Cache is an additional state machine.
```

Jika sistem punya cache, maka sistem punya lebih dari satu lokasi state:

```text
Database / API / Source of Truth
          |
          v
Cache Layer
          |
          v
Application Response
```

Masalah muncul saat dua state ini berbeda.

```text
DB says: user role = ADMIN
Cache says: user role = USER

DB says: application status = APPROVED
Cache says: application status = PENDING

DB says: token revoked
Cache says: token active
```

Maka pertanyaan utama cache bukan “seberapa cepat”, tetapi:

> “Seberapa lama sistem boleh salah, dan pada kasus apa cache tidak boleh dipakai?”

---

## 2. Quarkus Cache Landscape

Dalam konteks Quarkus, ada beberapa pendekatan caching/state:

1. **Quarkus Cache extension**
   - annotation-based caching,
   - default backend: Caffeine,
   - bisa menggunakan backend Redis atau Infinispan sesuai dukungan versi/extension.

2. **Caffeine local cache**
   - in-memory local per JVM/pod,
   - sangat cepat,
   - tidak shared antar replica,
   - cocok untuk derived/reference data yang toleran stale.

3. **Redis**
   - remote in-memory datastore,
   - bisa dipakai sebagai cache, coordination primitive, token store, rate limit, idempotency key, lightweight state,
   - network hop,
   - butuh operability serius.

4. **Infinispan**
   - distributed in-memory data grid,
   - remote cluster atau embedded mode,
   - cocok untuk distributed cache/data grid use case,
   - lebih kompleks daripada local cache.

5. **HTTP cache**
   - ETag,
   - Cache-Control,
   - CDN/proxy cache,
   - client-side cache.

6. **Hibernate second-level cache**
   - entity/query cache,
   - sangat kuat tetapi berbahaya jika tidak paham invalidation/query semantics.

7. **Application-managed cache**
   - manual map/Redis structure,
   - explicit key/value,
   - cocok untuk domain-specific caching seperti rate limit, idempotency, token, external lookup.

Quarkus Cache memberikan abstraction yang nyaman, tetapi tidak otomatis menyelesaikan desain consistency.

---

## 3. Cache Use Cases: Jangan Campur Semua Menjadi Satu

Cache dipakai untuk banyak hal berbeda. Setiap jenis punya invariant berbeda.

### 3.1 Reference Data Cache

Contoh:

```text
country list
postal district metadata
agency lookup
enum mapping
configuration dictionary
```

Karakteristik:

- jarang berubah,
- boleh stale beberapa menit/jam,
- invalidation sederhana,
- local cache sering cukup.

### 3.2 Expensive Computation Cache

Contoh:

```text
risk score preview
report summary
dashboard aggregate
eligibility calculation
```

Karakteristik:

- hasil dihitung mahal,
- input harus masuk cache key,
- cache invalidation mengikuti dependency data,
- risk of stale derived result tinggi.

### 3.3 External API Response Cache

Contoh:

```text
postal-code geocode lookup
identity provider metadata
third-party reference data
exchange rate snapshot
```

Karakteristik:

- mengurangi latency dan rate limit,
- TTL harus mengikuti contract external API,
- 401/429/5xx behavior harus jelas,
- stale fallback mungkin berguna.

### 3.4 Authentication/Security Cache

Contoh:

```text
JWKS
token introspection result
permission snapshot
session state
revocation list
```

Karakteristik:

- security-sensitive,
- TTL pendek,
- invalidation penting,
- stale data bisa menjadi vulnerability.

### 3.5 Idempotency Cache

Contoh:

```text
idempotency key untuk POST
deduplication key untuk message
external API request key
```

Karakteristik:

- correctness-critical,
- TTL harus sesuai business window,
- harus atomic,
- local cache biasanya salah untuk distributed system.

### 3.6 Rate Limiting State

Contoh:

```text
per user 100 requests/minute
per tenant 10k requests/hour
external API 300 calls/minute
```

Karakteristik:

- distributed counter,
- atomic increment,
- TTL/window semantics,
- Redis sering cocok.

### 3.7 Lock/Coordination State

Contoh:

```text
distributed lock untuk scheduled job
leader ownership
single-flight external refresh
```

Karakteristik:

- correctness-critical,
- harus punya expiry,
- harus punya ownership token,
- harus aman terhadap crash.

### 3.8 Session Cache

Contoh:

```text
user session
CSRF state
OAuth2 authorization state
```

Karakteristik:

- security-sensitive,
- lifecycle penting,
- logout/revocation,
- encryption/signing/masking.

Satu kesalahan besar:

```text
Mendesain semua cache dengan TTL 10 menit tanpa membedakan use case.
```

---

## 4. Cache Decision Matrix

Sebelum memakai cache, jawab decision matrix ini.

| Pertanyaan | Implikasi |
|---|---|
| Source of truth apa? | Menentukan invalidation |
| Boleh stale? | Menentukan TTL dan read strategy |
| Stale maksimal berapa lama? | Menentukan SLA cache |
| Data per-user/per-tenant? | Cache key harus include security context |
| Data sensitif? | Perlu masking/encryption/avoid caching |
| Update frequency? | Menentukan local vs distributed |
| Read frequency? | Menentukan manfaat cache |
| Miss cost? | Menentukan stampede control |
| Cache outage impact? | Menentukan fallback |
| Multi-replica? | Local cache mungkin inconsistent |
| Butuh atomic operation? | Redis/Infinispan/manual state lebih cocok |
| Butuh event invalidation? | Perlu message/event integration |
| Butuh query cache? | Hati-hati dengan invalidation |
| Butuh audit? | Cache tidak boleh jadi hidden decision source |

Rule:

```text
Cache hanya boleh ditambahkan jika correctness model-nya bisa dijelaskan.
```

Jika hanya bisa menjelaskan performance tetapi tidak bisa menjelaskan invalidation, desain belum matang.

---

## 5. Local Cache vs Distributed Cache

### 5.1 Local Cache

Local cache hidup di memory aplikasi.

```text
pod-a cache
pod-b cache
pod-c cache
```

Kelebihan:

- sangat cepat,
- tidak ada network hop,
- tidak bergantung Redis/Infinispan,
- cocok untuk read-heavy data,
- failure isolated per pod.

Kekurangan:

- setiap pod punya cache berbeda,
- invalidation sulit,
- memory per pod bertambah,
- cold cache per pod,
- rolling deployment reset cache,
- tidak cocok untuk idempotency/rate limit global/lock.

Cocok untuk:

- reference data,
- static-ish config,
- local computed data,
- metadata,
- short-lived non-critical cache.

Tidak cocok untuk:

- security revocation global,
- distributed lock,
- rate limit global,
- idempotency key global,
- data yang harus langsung konsisten setelah update.

### 5.2 Distributed Cache

Distributed cache berada di luar aplikasi.

```text
pod-a \
pod-b  -> Redis/Infinispan
pod-c /
```

Kelebihan:

- shared antar pod,
- central invalidation lebih mudah,
- cocok untuk global state,
- bisa atomic operation,
- bisa TTL centralized,
- data survive pod restart.

Kekurangan:

- network latency,
- dependency baru,
- outage mode baru,
- serialization issue,
- capacity planning,
- security/network config,
- observability lebih kompleks,
- thundering herd saat cache down.

Cocok untuk:

- idempotency key,
- distributed rate limit,
- token/session state,
- external API response cache,
- cross-pod shared cache,
- coarse distributed coordination,
- data yang harus survive pod restart.

---

## 6. Quarkus Cache Extension: Annotation Model

Quarkus Cache extension menyediakan annotation seperti:

- `@CacheResult`
- `@CacheInvalidate`
- `@CacheInvalidateAll`
- `@CacheKey`

### 6.1 Menambahkan Extension

Maven:

```bash
./mvnw quarkus:add-extension -Dextensions="cache"
```

Dependency konseptual:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-cache</artifactId>
</dependency>
```

### 6.2 Basic `@CacheResult`

```java
import io.quarkus.cache.CacheResult;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class CountryService {

    private final CountryRepository repository;

    public CountryService(CountryRepository repository) {
        this.repository = repository;
    }

    @CacheResult(cacheName = "countries")
    public List<CountryDto> listCountries() {
        return repository.findAllActiveCountries();
    }
}
```

Makna:

```text
Jika cache key ditemukan, method body tidak dipanggil.
Jika cache key tidak ditemukan, method dipanggil dan hasilnya disimpan.
```

Untuk method tanpa parameter, key biasanya berdasarkan default key untuk method/cache.

### 6.3 Cache dengan Parameter

```java
@CacheResult(cacheName = "country-by-code")
public CountryDto findByCode(String code) {
    return repository.findByCode(code);
}
```

Key harus stabil.

Masalah:

```java
findByCode("sg")
findByCode("SG")
findByCode(" Sg ")
```

Jika tidak dinormalisasi, cache menghasilkan key berbeda.

Lebih baik:

```java
public CountryDto findByCode(String code) {
    return findByNormalizedCode(normalizeCode(code));
}

@CacheResult(cacheName = "country-by-code")
CountryDto findByNormalizedCode(String normalizedCode) {
    return repository.findByCode(normalizedCode);
}
```

### 6.4 `@CacheKey`

Jika method punya banyak parameter tetapi hanya sebagian jadi key:

```java
@CacheResult(cacheName = "postal-lookup")
public AddressDto lookup(
        @CacheKey String postalCode,
        RequestContext context
) {
    return externalAddressClient.lookup(postalCode);
}
```

Hati-hati:

Jika `context` mempengaruhi hasil, jangan dikeluarkan dari key.

Contoh berbahaya:

```java
lookup(postalCode, tenantContext)
```

Jika tenant mempengaruhi hasil tetapi tidak ada di key, data tenant A bisa bocor ke tenant B.

Invariant:

```text
Semua input yang mempengaruhi output harus masuk cache key.
Semua input yang tidak mempengaruhi output tidak perlu masuk cache key.
```

### 6.5 Cache Invalidation

```java
@CacheInvalidate(cacheName = "country-by-code")
public void updateCountry(String code, UpdateCountryCommand command) {
    repository.update(code, command);
}
```

Masalah umum:

```text
Update by ID, cache by code.
```

Jika update method tidak punya cache key yang sama, invalidation gagal.

Contoh:

```java
@CacheResult(cacheName = "country-by-code")
CountryDto findByCode(String code) { ... }

@CacheInvalidate(cacheName = "country-by-code")
void updateCountry(long id, UpdateCountryCommand command) { ... }
```

Key cache adalah code, tetapi invalidation pakai id.

Solusi:

- invalidasi all jika data kecil,
- cari code sebelum invalidate,
- desain key konsisten,
- event invalidation,
- repository update mengembalikan affected keys.

### 6.6 `@CacheInvalidateAll`

```java
@CacheInvalidateAll(cacheName = "countries")
public void reloadCountries() {
    repository.reload();
}
```

Gunakan untuk:

- reference data kecil,
- jarang berubah,
- invalidation by key sulit,
- rebuild murah.

Jangan gunakan sembarangan untuk cache besar karena bisa menyebabkan stampede.

---

## 7. Caffeine as Default Local Cache

Quarkus Cache default backend menggunakan Caffeine.

Caffeine adalah local in-memory cache yang sangat efisien.

Karakteristik:

- per JVM/pod,
- low latency,
- tidak distributed,
- eviction berdasarkan policy,
- cocok untuk hot reference/derived data,
- tidak cocok untuk global coordination.

### 7.1 Config TTL / Size

Contoh konfigurasi konseptual:

```properties
quarkus.cache.caffeine."countries".maximum-size=1000
quarkus.cache.caffeine."countries".expire-after-write=6H
```

Cache berbeda harus punya policy berbeda.

Contoh:

```properties
quarkus.cache.caffeine."countries".maximum-size=1000
quarkus.cache.caffeine."countries".expire-after-write=24H

quarkus.cache.caffeine."postal-lookup".maximum-size=100000
quarkus.cache.caffeine."postal-lookup".expire-after-write=7D

quarkus.cache.caffeine."permission-snapshot".maximum-size=50000
quarkus.cache.caffeine."permission-snapshot".expire-after-write=30S
```

Jangan buat satu default TTL untuk semua.

### 7.2 Local Cache Memory Budget

Local cache memakai heap.

Jika pod punya 512Mi memory dan cache bisa tumbuh besar, service bisa OOM.

Checklist:

```text
Cache maximum size eksplisit.
Cached value size dipahami.
Heap budget dihitung.
Eviction metric diamati.
Native/JVM memory behavior diuji.
```

### 7.3 Local Cache and Rolling Deployment

Saat deployment:

```text
pod-a old version warm cache
pod-b new version cold cache
pod-c old version warm cache
```

Dampak:

- cold start latency,
- DB spike,
- external API spike,
- inconsistent behavior jika schema cached value berubah.

Mitigasi:

- pre-warming,
- gradual rollout,
- small TTL,
- distributed cache for expensive external lookup,
- versioned key.

---

## 8. Redis in Quarkus

Redis dapat dipakai dalam dua cara besar:

1. **Sebagai backend Quarkus Cache**
2. **Sebagai Redis client manual untuk state/cache pattern yang lebih eksplisit**

### 8.1 Redis Client Extension

Tambahkan:

```bash
./mvnw quarkus:add-extension -Dextensions="redis-client"
```

Konfigurasi:

```properties
quarkus.redis.hosts=redis://localhost:6379
```

Contoh typed data source:

```java
import io.quarkus.redis.datasource.RedisDataSource;
import io.quarkus.redis.datasource.value.ValueCommands;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Duration;

@ApplicationScoped
public class IdempotencyStore {

    private final ValueCommands<String, String> values;

    public IdempotencyStore(RedisDataSource redis) {
        this.values = redis.value(String.class);
    }

    public boolean reserve(String key, Duration ttl) {
        // pseudo-concept:
        // use SET key value NX EX ttl
        throw new UnsupportedOperationException("Implement with Redis set NX semantics");
    }
}
```

Dalam production, untuk idempotency key, pakai operasi atomic seperti:

```text
SET key value NX EX ttl
```

Artinya:

```text
Set hanya jika belum ada.
Key otomatis expire.
```

### 8.2 Redis as Quarkus Cache Backend

Redis backend berguna jika hasil cache harus shared antar pod.

Konseptual:

```properties
quarkus.cache.redis.enabled=true
```

Konfigurasi detail mengikuti versi Quarkus dan extension reference.

Pertimbangan:

- Redis backend berarti cache miss/hit melewati network.
- Value perlu serialization.
- Key convention penting.
- Redis outage harus dipikirkan.
- TTL harus eksplisit.
- Jangan menyimpan object graph besar tanpa ukuran yang jelas.

### 8.3 Redis Key Design

Key Redis harus punya namespace.

Buruk:

```text
123
user:1
token
```

Lebih baik:

```text
aceas:prod:application-summary:v1:tenant:{tenantId}:application:{applicationId}
aceas:prod:idempotency:v1:{operation}:{idempotencyKey}
aceas:prod:ratelimit:v1:tenant:{tenantId}:minute:{yyyyMMddHHmm}
aceas:prod:onemap:v1:postal:{postalCode}
```

Struktur key:

```text
{system}:{env}:{domain}:{version}:{scope}:{id}
```

Manfaat:

- menghindari collision,
- mendukung versioning,
- mendukung bulk invalidation by prefix,
- memudahkan debugging,
- memudahkan migration.

### 8.4 Redis Value Design

Jangan menyimpan entity JPA mentah.

Simpan DTO/value yang:

- immutable,
- versioned,
- minimal,
- tidak mengandung lazy proxy,
- tidak mengandung field sensitif tanpa alasan,
- punya expiry semantics.

Contoh:

```json
{
  "schemaVersion": 1,
  "applicationId": "APP-123",
  "status": "PENDING",
  "assignedOfficerId": "U-456",
  "updatedAt": "2026-06-20T10:30:00Z"
}
```

### 8.5 Redis Failure Modes

Redis bisa:

- down,
- slow,
- evict keys,
- restart,
- split brain tergantung deployment,
- penuh memory,
- mengalami latency spike,
- command timeout,
- connection pool exhausted.

Pertanyaan:

```text
Jika Redis down, apakah request gagal atau fallback ke DB?
```

Jawabannya tergantung use case.

| Use Case | Redis Down Behavior |
|---|---|
| Reference cache | bypass cache, read DB |
| External lookup cache | fallback if API available, maybe stale if allowed |
| Idempotency key | fail closed for safety |
| Rate limit | usually fail closed or degraded policy |
| Distributed lock | fail closed |
| Session store | user may need re-auth |
| Permission cache | re-check source or fail closed |

---

## 9. Infinispan in Quarkus

Infinispan adalah distributed in-memory data grid/cache.

Quarkus menyediakan Infinispan client extension untuk koneksi ke Infinispan server/cluster.

Cocok untuk:

- distributed cache,
- data grid,
- advanced cache topology,
- clustered state,
- remote cache,
- near-cache use case,
- integration dengan ekosistem Infinispan.

Namun complexity-nya lebih tinggi dibanding local Caffeine.

### 9.1 Infinispan Client

Tambahkan extension:

```bash
./mvnw quarkus:add-extension -Dextensions="infinispan-client"
```

Konfigurasi konseptual:

```properties
quarkus.infinispan-client.hosts=localhost:11222
quarkus.infinispan-client.username=admin
quarkus.infinispan-client.password=changeit
```

Usage konseptual:

```java
import jakarta.enterprise.context.ApplicationScoped;
import org.infinispan.client.hotrod.RemoteCache;
import org.infinispan.client.hotrod.RemoteCacheManager;

@ApplicationScoped
public class ReferenceDataCache {

    private final RemoteCache<String, CountryDto> cache;

    public ReferenceDataCache(RemoteCacheManager cacheManager) {
        this.cache = cacheManager.getCache("countries");
    }

    public CountryDto get(String code) {
        return cache.get(code);
    }

    public void put(String code, CountryDto value) {
        cache.put(code, value);
    }
}
```

### 9.2 Infinispan vs Redis

| Dimension | Redis | Infinispan |
|---|---|---|
| Common usage | cache, kv, stream, rate limit | data grid, distributed cache |
| Simplicity | generally simpler | more advanced |
| Java object/data grid integration | moderate | strong |
| Operational model | Redis server/cluster | Infinispan server/cluster |
| Query/data grid features | limited/basic depending module | richer |
| Quarkus integration | redis client/cache backend | client/cache backend |
| Best for | lightweight distributed state | enterprise distributed cache/data grid |

Tidak ada jawaban universal.

Gunakan Redis jika:

- butuh simple key-value,
- atomic counter,
- idempotency,
- rate limit,
- shared cache sederhana,
- team sudah punya Redis ops maturity.

Gunakan Infinispan jika:

- butuh distributed cache/data grid yang lebih kaya,
- ada kebutuhan Java-centric remote cache,
- topology/data grid features penting,
- organisasi sudah memakai Infinispan/Red Hat stack.

---

## 10. Cache Key Engineering

Cache key adalah bagian paling sering disepelekan.

Cache key harus:

- deterministic,
- normalized,
- include semua input yang mempengaruhi output,
- exclude noise,
- include tenant/security context jika relevan,
- versioned,
- tidak terlalu panjang,
- tidak mengandung secret,
- tidak mengandung PII tanpa alasan.

### 10.1 Bad Key

```text
application:{id}
```

Masalah:

- environment tidak ada,
- tenant tidak ada,
- schema version tidak ada,
- permission context tidak ada.

### 10.2 Better Key

```text
aceas:prod:application-summary:v2:tenant:T001:application:APP123
```

Jika output berbeda berdasarkan user role:

```text
aceas:prod:application-summary:v2:tenant:T001:role:officer:application:APP123
```

Namun hati-hati cardinality.

Jika role/user dimasukkan ke key, cache bisa membesar drastis.

### 10.3 Canonicalization

Input harus dinormalisasi.

```java
String normalizePostalCode(String value) {
    return value == null ? null : value.trim().replaceAll("\\s+", "").toUpperCase();
}
```

Contoh:

```text
"238863"
"238 863"
" 238863 "
```

Harus menjadi key yang sama jika secara bisnis sama.

### 10.4 Versioned Keys

Saat value schema berubah:

```text
cache:v1:...
cache:v2:...
```

Dengan versioned key, deployment baru tidak membaca value lama yang incompatible.

Ini penting saat:

- rolling deployment,
- native image,
- Jackson/record change,
- field renamed,
- enum value changed.

---

## 11. Cache Value Engineering

Cached value harus diperlakukan sebagai API internal.

### 11.1 Jangan Cache Entity JPA

Buruk:

```java
@CacheResult(cacheName = "application")
public Application findApplication(String id) {
    return entityManager.find(Application.class, id);
}
```

Masalah:

- lazy proxy,
- persistence context lifecycle,
- stale entity,
- serialization issue,
- native image issue,
- accidental mutation,
- leaking internal domain model.

Lebih baik:

```java
public record ApplicationSummaryCacheValue(
        int schemaVersion,
        String applicationId,
        String status,
        String assignedOfficerId,
        Instant updatedAt
) {}
```

Cache value sebaiknya:

- DTO khusus,
- immutable,
- small,
- versioned,
- explicit nullable semantics,
- no lazy relation,
- no behavior,
- no dependency ke JPA session.

### 11.2 Negative Cache

Negative caching menyimpan “tidak ditemukan”.

Contoh:

```text
postalCode=999999 -> not found
```

Manfaat:

- mencegah cache miss berulang menghantam external API,
- mengurangi load.

Risiko:

- jika data muncul kemudian, cache masih not found.

Policy:

```text
Positive TTL: 24h
Negative TTL: 5m
```

Jangan samakan TTL positive dan negative.

---

## 12. TTL Strategy

TTL adalah contract, bukan angka acak.

Jenis TTL:

1. **Expire after write**
   - sejak data dimasukkan.

2. **Expire after access**
   - diperpanjang setiap dibaca.

3. **Absolute business expiry**
   - expire pada waktu bisnis tertentu.

4. **Soft TTL**
   - data dianggap stale, tetapi masih bisa disajikan sambil refresh async.

5. **Hard TTL**
   - data tidak boleh dipakai setelah lewat.

### 12.1 TTL by Data Type

| Data | TTL |
|---|---|
| Country list | hours/days |
| Permission snapshot | seconds/minutes |
| JWKS | mengikuti header/provider policy |
| Token introspection | sangat pendek |
| External postal lookup | hours/days tergantung contract |
| Idempotency key | business retry window |
| Rate limit key | window duration |
| Search result | pendek |
| Dashboard aggregate | pendek/sesuai freshness SLA |

### 12.2 TTL Tidak Menggantikan Invalidation

TTL hanya membatasi maksimum stale.

Jika perubahan harus terlihat segera, butuh invalidation.

Contoh:

```text
User role dicabut.
TTL permission cache = 30 menit.
```

Jika tidak ada invalidation, user bisa tetap punya akses 30 menit.

Untuk security-sensitive data, TTL harus pendek atau invalidation harus eksplisit.

---

## 13. Cache Invalidation Patterns

Ada dua masalah sulit dalam software engineering:

```text
cache invalidation
naming things
off-by-one errors
```

Cache invalidation sulit karena kita harus tahu semua dependensi data.

### 13.1 Time-Based Invalidation

```text
Expire after TTL.
```

Kelebihan:

- sederhana,
- tidak butuh event,
- robust terhadap missing invalidation.

Kekurangan:

- stale sampai TTL habis,
- tidak cocok untuk data security-critical,
- freshness tidak deterministic.

### 13.2 Write-Through Invalidation

Saat update source of truth, update/invalidate cache.

```text
update DB
invalidate cache key
```

Masalah:

- jika cache invalidate gagal setelah DB commit?
- jika update terjadi di service lain?
- jika ada banyak key terdampak?

### 13.3 Event-Based Invalidation

Saat data berubah, publish event:

```text
CountryUpdated(code=SG)
ApplicationStatusChanged(applicationId=APP123)
PermissionChanged(userId=U123)
```

Consumers invalidate cache.

Kelebihan:

- distributed service bisa tahu perubahan,
- lebih real-time,
- cocok microservices.

Kekurangan:

- eventual consistency,
- event delivery failure,
- duplicate events,
- ordering,
- event schema governance.

### 13.4 Version-Based Invalidation

Alih-alih delete key, gunakan version.

```text
application-summary:v1:APP123
application-summary:v2:APP123
```

Atau per-entity version:

```text
application:{id}:version = 42
application-summary:{id}:v42
```

Kelebihan:

- avoids stale old keys being read,
- rolling deployment aman,
- cache invalidation jadi key selection.

Kekurangan:

- old keys perlu expire,
- key cardinality naik.

### 13.5 Generational Cache

Untuk data group:

```text
countries:generation = 17
countries:g17:list
countries:g17:code:SG
```

Saat reload:

```text
countries:generation = 18
```

Key lama tidak dibaca lagi dan akan expire sendiri.

Cocok untuk:

- reference data,
- large group invalidation,
- avoiding mass delete.

---

## 14. Cache Stampede and Single-Flight

Cache stampede terjadi saat cache expired dan banyak request miss bersamaan.

```text
1000 request hit cache expired
1000 request call database/external API
DB/API overload
```

Mitigasi:

1. Lock per key.
2. Single-flight request coalescing.
3. Soft TTL + background refresh.
4. Randomized TTL jitter.
5. Serve stale while refresh.
6. Pre-warm cache.
7. Rate limit miss path.

### 14.1 Single-Flight Mental Model

```text
Untuk key yang sama, hanya satu request menghitung value.
Request lain menunggu hasil yang sama.
```

Pseudo-code:

```java
public Value get(String key) {
    Value cached = cache.get(key);

    if (cached != null && !cached.isExpired()) {
        return cached;
    }

    return singleFlight.compute(key, () -> loadFromSource(key));
}
```

Untuk single-node, Caffeine/Quarkus cache abstraction bisa membantu pada level tertentu.

Untuk distributed single-flight, perlu Redis lock atau coordination lain.

### 14.2 TTL Jitter

Jika semua key punya TTL 1 jam dan dibuat bersamaan:

```text
10:00 semua key created
11:00 semua key expired
```

Gunakan jitter:

```text
TTL = base TTL + random(0..10%)
```

Ini menyebarkan expiry.

---

## 15. Stale-While-Revalidate

Pattern:

```text
Jika cache masih fresh -> serve.
Jika soft expired tapi belum hard expired -> serve stale dan refresh async.
Jika hard expired -> block dan reload/fail.
```

Manfaat:

- latency stabil,
- menghindari stampede,
- user masih dapat data lama sementara refresh.

Cocok untuk:

- dashboard,
- reference data,
- external lookup,
- expensive computation.

Tidak cocok untuk:

- permission decision critical,
- payment state,
- regulatory status yang harus real-time,
- security revocation.

Pseudo policy:

```text
fresh_until = write_time + 5 minutes
hard_expire = write_time + 1 hour
```

---

## 16. Cache-Aside Pattern

Cache-aside adalah pattern paling umum.

```text
Read:
1. Get from cache.
2. If hit, return.
3. If miss, load from DB/API.
4. Put into cache.
5. Return.

Write:
1. Update DB.
2. Invalidate cache.
```

Kelebihan:

- simple,
- cache hanya menyimpan data yang dibaca,
- aplikasi kontrol penuh.

Kekurangan:

- stale between DB update and invalidation,
- race condition,
- duplicated logic,
- miss stampede.

Race:

```text
T1 read miss -> load old DB value
T2 update DB -> invalidate cache
T1 put old value into cache
```

Mitigasi:

- version check,
- write timestamp,
- short TTL,
- post-write invalidate twice,
- transaction outbox invalidation event,
- cache value includes DB version.

---

## 17. Read-Through, Write-Through, Write-Behind

### 17.1 Read-Through

Cache knows how to load data.

```text
Application asks cache.
Cache loads source if miss.
```

Good:

- centralizes loading.

Bad:

- hidden DB/API dependency in cache layer.

### 17.2 Write-Through

Write goes through cache and source.

```text
Application writes cache.
Cache writes DB.
```

Good:

- cache and source updated together.

Bad:

- cache becomes part of write path,
- failure semantics complex.

### 17.3 Write-Behind

Write to cache first, source later.

Good:

- fast write.

Bad:

- dangerous for correctness-critical data,
- data loss risk,
- consistency complex.

For enterprise/regulatory systems:

```text
Prefer database/source of truth first.
Use outbox/event for cache invalidation.
Avoid write-behind unless you fully own durability model.
```

---

## 18. Cache and Security

Cache can leak data.

### 18.1 Tenant Leakage

Bad key:

```text
case-summary:{caseId}
```

If case ID not globally unique or result differs by tenant:

```text
tenant A reads tenant B data.
```

Better:

```text
tenant:{tenantId}:case-summary:{caseId}
```

### 18.2 User Permission Leakage

Bad:

```java
@CacheResult(cacheName = "case-detail")
public CaseDetail detail(String caseId) {
    return detailForCurrentUser(caseId);
}
```

If response depends on current user, cache key must include user/role/permission scope.

Better:

```text
case-detail:v1:tenant:{tenant}:case:{caseId}:view:{viewScope}
```

But beware high cardinality.

Alternative:

```text
Cache raw allowed data, apply permission filtering after cache.
```

This is often safer:

```text
Cache domain snapshot.
Then filter fields per user on every request.
```

### 18.3 PII and Sensitive Data

Do not casually cache:

- NRIC/passport,
- token,
- password hash,
- secrets,
- confidential case notes,
- medical/legal sensitive data,
- raw identity provider payload.

If needed:

- encrypt,
- mask,
- short TTL,
- access control,
- no logs,
- secure Redis transport,
- clear ownership.

### 18.4 Authorization Cache

Permission cache is tempting but dangerous.

Guidelines:

- short TTL,
- include policy version,
- invalidate on role change,
- fail closed on uncertainty,
- never trust frontend cache,
- audit decision source.

---

## 19. Cache and Multi-Tenancy

In multi-tenant systems, cache must include tenant boundary.

Tenant must be considered in:

- key,
- value,
- invalidation event,
- metrics label,
- admin operations,
- bulk delete,
- migration,
- data residency,
- encryption.

Bad:

```text
permission:{userId}
```

Better:

```text
tenant:{tenantId}:permission:{userId}:policy:{policyVersion}
```

If user can belong to multiple tenants, do not assume user ID enough.

---

## 20. Cache and Transactions

A common mistake:

```java
@Transactional
public void updateCase(...) {
    repository.update(...);
    cache.invalidate(...);
}
```

If cache invalidation happens before transaction commit, another request can repopulate old data.

Sequence:

```text
T1 update DB but not committed
T1 invalidate cache
T2 read cache miss
T2 read old committed DB value
T2 put old value in cache
T1 commit new DB value
Cache now contains old value
```

Better options:

1. Invalidate after transaction commit.
2. Publish outbox event after commit.
3. Use versioned cache values.
4. Short TTL as safety.
5. Read-your-write through DB for critical paths.

### 20.1 After-Commit Invalidation

Conceptual:

```text
DB transaction commits.
After commit callback invalidates cache.
```

But if app crashes after commit before invalidation, stale cache remains.

For critical invalidation, use outbox:

```text
Within transaction:
- update DB
- insert CacheInvalidationEvent into outbox

After commit:
- outbox publisher sends invalidation
```

This makes invalidation recoverable.

---

## 21. Cache and Event-Driven Architecture

Event-driven invalidation:

```text
ApplicationUpdated -> invalidate application-summary
RoleChanged -> invalidate permission cache
ReferenceDataReloaded -> bump generation
```

Design event carefully.

Example:

```json
{
  "eventType": "ApplicationStatusChanged",
  "eventVersion": 1,
  "applicationId": "APP-123",
  "tenantId": "T001",
  "oldStatus": "PENDING",
  "newStatus": "APPROVED",
  "changedAt": "2026-06-20T10:00:00Z",
  "sourceVersion": 42
}
```

Consumer:

```text
invalidate tenant:T001:application-summary:v*:APP-123
invalidate tenant:T001:dashboard:pending-count
```

Problem:

```text
One event can affect many caches.
```

Therefore maintain a cache dependency map:

```text
ApplicationStatusChanged affects:
- application-summary
- application-detail
- officer-dashboard
- pending-count
- SLA queue
```

Without dependency map, invalidation becomes folklore.

---

## 22. Hibernate Second-Level Cache

Hibernate second-level cache is different from application cache.

It can cache:

- entities,
- collections,
- query results,
- natural IDs.

Powerful, but dangerous.

Risks:

- stale entity,
- invalidation complexity,
- memory usage,
- query cache invalidation broad,
- N+1 hidden not solved,
- debugging harder,
- transactional consistency assumptions,
- cluster config complexity.

Use only when:

- entity is read-mostly,
- update path is controlled,
- cache region strategy clear,
- metrics monitored,
- invalidation understood,
- second-level cache is validated under real write patterns.

Do not use L2 cache as first response to slow queries.

First fix:

1. Query shape.
2. Index.
3. Fetch plan.
4. Pagination.
5. Projection.
6. Transaction boundary.
7. Only then consider L2 cache.

---

## 23. HTTP-Level Cache: ETag and Cache-Control

Not all cache belongs inside server.

For REST resources:

- ETag,
- Last-Modified,
- Cache-Control,
- conditional GET,
- CDN/proxy cache.

Example flow:

```text
Client GET /reference/countries
Server returns ETag: "countries-v17"
Client next request If-None-Match: "countries-v17"
Server returns 304 Not Modified
```

Advantages:

- reduces bandwidth,
- avoids server serialization,
- works for client/proxy/CDN,
- good for reference data.

But be careful with:

- private data,
- authorization-specific response,
- per-user content,
- cache-control public/private,
- sensitive headers.

---

## 24. Cache Observability

Cache without observability is dangerous.

Metrics:

```text
cache_hit_total{cache_name}
cache_miss_total{cache_name}
cache_hit_ratio{cache_name}
cache_eviction_total{cache_name}
cache_load_duration_seconds{cache_name}
cache_load_failure_total{cache_name,error}
cache_size{cache_name}
cache_stale_served_total{cache_name}
cache_invalidation_total{cache_name,reason}
redis_command_duration_seconds{command}
redis_timeout_total
redis_connection_pool_active
redis_memory_used_bytes
```

Logs:

```json
{
  "event": "cache_invalidation",
  "cache": "application-summary",
  "key": "tenant:T001:application:APP123",
  "reason": "ApplicationStatusChanged",
  "sourceVersion": 42
}
```

Alerts:

```text
Hit ratio drops sharply.
Miss load latency increases.
Redis timeout increases.
Eviction rate spikes.
Cache size near limit.
Stale served above threshold.
No invalidation event consumed for long time.
Permission cache invalidation failure.
```

### 24.1 Hit Ratio Can Mislead

High hit ratio is not always good.

Example:

```text
99% hit ratio on stale permission cache
```

This is bad.

Measure also:

- freshness,
- invalidation lag,
- source version mismatch,
- stale served,
- security-sensitive cache age.

---

## 25. Cache Testing Strategy

### 25.1 Unit Test

Test key generation:

```text
" sg " -> "SG"
tenant included
role included if required
version included
```

Test TTL policy:

```text
positive TTL != negative TTL
security TTL short
```

### 25.2 Component Test

Test service:

```text
First call loads source.
Second call hits cache.
Update invalidates cache.
After invalidation, load new value.
```

### 25.3 Race Test

Simulate:

```text
read miss while update commit happens
duplicate miss stampede
cache invalidation event duplicate
stale event arrives after newer event
Redis timeout
cache value incompatible version
```

### 25.4 Integration Test with Redis/Infinispan

Use Dev Services/Testcontainers where appropriate.

Test:

- serialization,
- TTL,
- key expiration,
- atomic NX,
- command timeout,
- reconnect,
- multi-replica behavior if possible.

### 25.5 Security Test

Test:

- tenant A cannot read tenant B cached value,
- user permission change invalidates decision,
- private response not cached publicly,
- sensitive fields not present in cached DTO.

---

## 26. Native Image Implications

Cache and native image concerns:

1. Serialization must be native-compatible.
2. Reflection-based serializers may need metadata.
3. Avoid caching framework proxies.
4. Avoid JPA entities/lazy proxies.
5. Static initialization should not connect to Redis.
6. Timezone/locale resource may matter.
7. TLS Redis/Infinispan client must be tested.
8. Classpath scanning/dynamic classloading assumptions may fail.
9. Caffeine local cache works, but heap/RSS profile differs.
10. Native startup can create cold-cache stampede faster after scale-out.

Native image can make service start quickly, but that means:

```text
Many pods can become ready quickly and hit DB/cache source quickly.
```

So warmup/backpressure matters.

---

## 27. Implementation Blueprint: Reference Data Cache

Use case:

```text
Country list is read often, changes rarely, and can be stale for 24h.
```

### 27.1 DTO

```java
public record CountryDto(
        String code,
        String name,
        boolean active
) {}
```

### 27.2 Service

```java
import io.quarkus.cache.CacheInvalidateAll;
import io.quarkus.cache.CacheResult;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

@ApplicationScoped
public class CountryReferenceService {

    private final CountryRepository repository;

    public CountryReferenceService(CountryRepository repository) {
        this.repository = repository;
    }

    @CacheResult(cacheName = "countries")
    public List<CountryDto> listActiveCountries() {
        return repository.findActiveCountries()
                .stream()
                .map(country -> new CountryDto(
                        country.code(),
                        country.name(),
                        country.active()
                ))
                .toList();
    }

    @CacheInvalidateAll(cacheName = "countries")
    public void invalidateCountries() {
        // intentionally empty; annotation performs invalidation
    }
}
```

### 27.3 Config

```properties
quarkus.cache.caffeine."countries".maximum-size=10
quarkus.cache.caffeine."countries".expire-after-write=24H
```

### 27.4 Operational Rule

```text
Whenever reference data is updated, call invalidateCountries()
or publish ReferenceDataChanged event.
```

---

## 28. Implementation Blueprint: External Postal Lookup Cache with Redis

Use case:

```text
External postal API has rate limit.
Response can be cached for 7 days.
Negative lookup cached for 10 minutes.
```

### 28.1 Cache Key

```java
public final class PostalCacheKeys {

    private PostalCacheKeys() {
    }

    public static String lookup(String env, String postalCode) {
        return "aceas:%s:onemap:v1:postal:%s".formatted(
                env,
                normalize(postalCode)
        );
    }

    private static String normalize(String postalCode) {
        return postalCode.trim().replaceAll("\\s+", "");
    }
}
```

### 28.2 Cache Value

```java
import java.time.Instant;

public record PostalLookupCacheValue(
        int schemaVersion,
        String postalCode,
        boolean found,
        String block,
        String street,
        String building,
        Instant cachedAt
) {}
```

### 28.3 Service Concept

```java
@ApplicationScoped
public class PostalLookupService {

    private final PostalCache cache;
    private final ExternalPostalClient client;

    public PostalLookupService(PostalCache cache, ExternalPostalClient client) {
        this.cache = cache;
        this.client = client;
    }

    public PostalLookupResult lookup(String postalCode) {
        String normalized = normalize(postalCode);

        PostalLookupCacheValue cached = cache.get(normalized);
        if (cached != null) {
            return PostalLookupResult.fromCache(cached);
        }

        PostalLookupResult result = client.lookup(normalized);

        if (result.found()) {
            cache.putPositive(normalized, result);
        } else {
            cache.putNegative(normalized, result);
        }

        return result;
    }
}
```

### 28.4 Production Enhancements

Add:

- single-flight per postal code,
- rate limit,
- 429 backoff,
- timeout,
- stale fallback,
- metrics,
- cache key version,
- JSON schema version,
- sensitive-data review.

---

## 29. Implementation Blueprint: Idempotency Key with Redis

Use case:

```text
POST /applications should not create duplicate application
if client retries with same idempotency key.
```

### 29.1 Idempotency Key

```text
aceas:prod:idempotency:v1:tenant:T001:create-application:{clientKey}
```

### 29.2 Flow

```text
1. Client sends Idempotency-Key.
2. Server attempts reserve key atomically.
3. If reservation succeeds, process request.
4. Store final result reference.
5. If duplicate key arrives, return previous result or processing status.
```

### 29.3 States

```text
PROCESSING
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
```

### 29.4 Important

For correctness-critical idempotency:

```text
Redis alone may not be enough if result must survive Redis data loss.
```

Better architecture:

```text
Redis for fast reservation + DB table for durable idempotency record.
```

Schema:

```sql
create table idempotency_record (
    tenant_id          varchar(64) not null,
    idempotency_key    varchar(256) not null,
    operation          varchar(128) not null,
    request_hash       varchar(128) not null,
    status             varchar(32) not null,
    response_ref       varchar(256),
    expires_at         timestamp not null,
    created_at         timestamp not null,
    updated_at         timestamp not null,
    primary key (tenant_id, idempotency_key, operation)
);
```

Invariant:

```text
For business correctness, durable source of truth beats volatile cache.
```

---

## 30. Implementation Blueprint: Permission Cache

Use case:

```text
Authorization checks are frequent.
Role/permission data changes occasionally.
Stale permission can be security risk.
```

### 30.1 Key

```text
tenant:{tenantId}:permission:v{policyVersion}:user:{userId}
```

### 30.2 Value

```java
public record PermissionSnapshot(
        int schemaVersion,
        String tenantId,
        String userId,
        long policyVersion,
        Set<String> permissions,
        Instant loadedAt,
        Instant expiresAt
) {}
```

### 30.3 Rules

```text
TTL short.
Invalidate on role change.
Include policy version.
Fail closed if source unavailable and cache expired.
Do not cache broad admin permission indefinitely.
Audit permission decision if regulatory.
```

### 30.4 Safer Alternative

Cache coarse permission data, not final decision.

```text
Cache user's permission set.
Evaluate resource ownership/state every request.
```

Because final authorization may depend on:

- case owner,
- application status,
- tenant,
- assigned officer,
- workflow state,
- delegation,
- time window,
- conflict of interest.

---

## 31. Cache Warmup

Warmup can reduce cold-start spikes.

Strategies:

1. Lazy warmup on first request.
2. Startup warmup.
3. Scheduled warmup.
4. Deployment pre-warm endpoint.
5. Background refresh.
6. Event-driven preload.

### 31.1 Startup Warmup Risk

If 50 pods start and all warm up cache by loading 100k rows:

```text
DB spike during deployment.
```

Better:

- only warm essential small reference cache,
- stagger warmup,
- use distributed cache,
- use single leader warmup,
- use readiness only after critical warmup,
- avoid huge startup work.

### 31.2 Warmup and Native Image

Native app starts fast, so warmup can dominate startup time.

Fast binary does not mean fast ready state if cache warmup is huge.

Separate:

```text
process started
application ready
cache warmed
service healthy
```

---

## 32. Cache Preloading vs Lazy Loading

| Strategy | Pros | Cons |
|---|---|---|
| Preload | predictable first request | startup cost |
| Lazy load | fast startup | first request latency |
| Background refresh | balanced | complexity |
| Distributed pre-warm | shared benefit | infra dependency |

Decision:

```text
If first request latency matters and data small: preload.
If data huge: lazy/background.
If external API rate-limited: prewarm carefully.
```

---

## 33. Cache Eviction and Memory

Eviction is not just memory cleanup.

Eviction changes behavior:

```text
Evicted key -> miss -> source load
```

If eviction spikes:

- DB/API load spikes,
- latency increases,
- rate limit risk,
- stampede risk.

Monitor:

- eviction count,
- cache size,
- memory usage,
- load latency,
- miss burst.

Do not set unbounded cache.

Bad:

```text
maximum-size not configured
```

Better:

```properties
quarkus.cache.caffeine."application-summary".maximum-size=50000
quarkus.cache.caffeine."application-summary".expire-after-write=10M
```

Estimate memory:

```text
entries * average serialized/object size * overhead
```

For local cache, multiply by replica count.

```text
50k entries * 5KB * 6 pods = 1.5GB logical memory across cluster
```

---

## 34. Cache and Data Freshness SLA

Every cache should have freshness expectation.

Examples:

```text
Country list: can be stale for 24h.
Postal lookup: can be stale for 7d.
Permission: can be stale for <= 30s, invalidated on role update.
Dashboard count: can be stale for 1m.
Case status: must be read-after-write consistent on detail page.
```

Document:

```text
Cache name
Source of truth
Key format
Value schema
TTL
Invalidation trigger
Stale tolerance
Failure behavior
Security classification
Owner
Metrics
```

Cache without owner becomes operational debt.

---

## 35. Cache Failure Mode Analysis

### 35.1 Stale Data

Cause:

- missed invalidation,
- long TTL,
- event consumer down,
- wrong key,
- update path bypasses invalidation.

Mitigation:

- short TTL fallback,
- event outbox,
- versioned key,
- dependency map,
- freshness metric.

### 35.2 Cache Penetration

Repeated requests for nonexistent keys hit source.

Mitigation:

- negative caching,
- input validation,
- rate limiting,
- bloom filter in special cases.

### 35.3 Cache Avalanche

Many keys expire together.

Mitigation:

- TTL jitter,
- stagger warmup,
- soft TTL,
- pre-refresh.

### 35.4 Cache Stampede

Many requests load same missing key.

Mitigation:

- single-flight,
- per-key lock,
- stale-while-revalidate.

### 35.5 Cache Pollution

Low-value keys evict high-value keys.

Mitigation:

- separate cache regions,
- maximum size per cache,
- admission policy,
- key cardinality review.

### 35.6 Serialization Breakage

New version cannot read old value.

Mitigation:

- versioned keys,
- schema version in value,
- tolerant deserialization,
- deployment testing.

### 35.7 Security Leakage

Wrong key scope shares data.

Mitigation:

- tenant/security context in key,
- do not cache final user-specific response unless necessary,
- security tests.

### 35.8 Redis Down

Mitigation depends on use case:

- fallback to source for non-critical cache,
- fail closed for security/idempotency/lock,
- circuit breaker,
- timeout,
- runbook.

---

## 36. Production Checklist

### 36.1 Design

- [ ] Source of truth jelas.
- [ ] Cache use case diklasifikasikan.
- [ ] Local vs distributed dipilih dengan alasan.
- [ ] TTL berdasarkan freshness SLA.
- [ ] Invalidation strategy jelas.
- [ ] Failure behavior jelas.
- [ ] Cache owner jelas.

### 36.2 Key and Value

- [ ] Key deterministic.
- [ ] Key normalized.
- [ ] Key include tenant/security context jika relevan.
- [ ] Key versioned.
- [ ] Value immutable DTO.
- [ ] Value schema versioned.
- [ ] Tidak cache JPA entity/proxy.
- [ ] Sensitive data direview.

### 36.3 Consistency

- [ ] Stale tolerance didokumentasikan.
- [ ] Security-sensitive cache TTL pendek.
- [ ] Invalidation after commit/outbox.
- [ ] Event invalidation idempotent.
- [ ] Duplicate/late invalidation event aman.
- [ ] Read-your-write path dipikirkan.

### 36.4 Performance

- [ ] Maximum size dikonfigurasi.
- [ ] Stampede control ada.
- [ ] Negative caching jika perlu.
- [ ] TTL jitter jika expiry massal mungkin.
- [ ] Warmup tidak menghantam DB.
- [ ] Cache miss path punya timeout.

### 36.5 Redis/Infinispan

- [ ] Timeout configured.
- [ ] TLS/auth configured.
- [ ] Connection pool sizing.
- [ ] Memory policy understood.
- [ ] Eviction behavior understood.
- [ ] Backup/persistence expectation jelas.
- [ ] Outage behavior tested.
- [ ] Metrics/alerts configured.

### 36.6 Observability

- [ ] Hit/miss metrics.
- [ ] Load latency.
- [ ] Eviction count.
- [ ] Invalidation count.
- [ ] Stale served count.
- [ ] Redis timeout/latency.
- [ ] Freshness metric for critical cache.
- [ ] Dashboard and runbook.

### 36.7 Testing

- [ ] Key generation tested.
- [ ] Invalidation tested.
- [ ] TTL tested.
- [ ] Tenant isolation tested.
- [ ] Permission change tested.
- [ ] Serialization compatibility tested.
- [ ] Redis outage tested.
- [ ] Multi-replica behavior tested.

---

## 37. Case Study: OneMap Postal Lookup Cache

Use case:

```text
External OneMap API has token auth and rate limit.
Postal lookup should not expose token to browser.
Backend calls external API through Quarkus service.
Postal code exact 6-digit lookup can be cached.
```

### 37.1 Requirements

- token stored in server-side secret/config,
- frontend never sees token,
- Redis caches lookup result,
- exact postal code key,
- 401 triggers token refresh once,
- 429 uses backoff,
- positive result TTL longer,
- negative result TTL shorter,
- in-flight dedup for same postal code,
- worker pool/rate limiter respects external quota,
- metrics per hit/miss/external call.

### 37.2 Architecture

```text
Vue frontend
   |
   v
Quarkus REST endpoint
   |
   v
PostalLookupService
   |
   +--> Redis cache
   |
   +--> TokenProvider
   |
   +--> OneMap REST client
```

### 37.3 Key

```text
aceas:prod:onemap:v1:postal:238863
```

### 37.4 Flow

```text
1. Normalize postal code.
2. Validate 6 digits.
3. Check Redis.
4. If hit, return.
5. If miss, acquire single-flight guard.
6. Get token.
7. Call OneMap with timeout.
8. If 401, refresh token once and retry.
9. If 429, bounded backoff.
10. Store positive/negative result with appropriate TTL.
11. Return DTO to frontend.
```

### 37.5 Failure Policy

| Failure | Behavior |
|---|---|
| Redis unavailable | optionally call external API with stricter rate limit |
| OneMap 401 | refresh token once |
| OneMap 429 | backoff, return controlled error if exhausted |
| OneMap 5xx | retry bounded, maybe stale fallback |
| Invalid postal code | no cache, return validation error |
| Token refresh fails | fail controlled, no token exposure |
| Cache value incompatible | ignore and reload |

### 37.6 Invariants

```text
Token never reaches browser.
Postal key normalized.
Cache key versioned.
External rate limit protected.
Duplicate request deduplicated.
Cache failure does not leak secret.
Stale policy explicit.
```

---

## 38. Case Study: Regulatory Case Summary Cache

Use case:

```text
Case detail page needs summary:
- case status,
- assigned officer,
- next due date,
- risk level,
- outstanding actions,
- permissions.
```

Temptation:

```text
Cache entire case detail response.
```

Risk:

- user-specific permission leakage,
- status stale,
- due date stale,
- action list stale,
- sensitive notes exposed,
- invalidation from many update paths.

Better decomposition:

```text
Cache case domain snapshot without user-specific filtering.
Always evaluate authorization/field visibility per request.
Keep TTL short or invalidate on state transition.
Use versioned key by case version.
```

Key:

```text
tenant:{tenantId}:case-summary:v2:case:{caseId}:version:{caseVersion}
```

Flow:

```text
1. Load case version from DB or event projection.
2. Build cache key with version.
3. Get summary snapshot.
4. Apply authorization and field filtering.
5. Return response.
```

This avoids user-specific cached response leakage.

---

## 39. Anti-Pattern Umum

### 39.1 Cache Everything

Caching semua response tanpa memahami dependency.

### 39.2 Cache Entity JPA

Menyimpan object yang terkait persistence context.

### 39.3 TTL Sama untuk Semua

Security cache dan country list tidak boleh punya TTL sama.

### 39.4 Key Tidak Include Tenant

Membuka risiko data leak.

### 39.5 Cache Final Authorization Decision Terlalu Lama

Permission berubah tetapi cache masih mengizinkan akses.

### 39.6 Tidak Ada Max Size

Local cache bisa menyebabkan OOM.

### 39.7 Redis Dipakai sebagai Database Tanpa Durability Model

Redis bisa menjadi hidden source of truth tanpa governance.

### 39.8 Invalidation Dilakukan Sebelum Commit

Bisa repopulate old value.

### 39.9 Tidak Ada Negative Cache

Nonexistent keys menghantam source berulang.

### 39.10 Tidak Ada Stampede Control

Cache expiry menyebabkan DB/API outage.

### 39.11 Cache Key Mengandung Secret/PII

Key sering muncul di logs/metrics/debug tools.

### 39.12 Hit Ratio Jadi Satu-Satunya Metric

High hit ratio pada data stale bukan keberhasilan.

---

## 40. Latihan

### Latihan 1 — Cache Decision Review

Untuk data berikut, tentukan:

- cache atau tidak,
- local atau distributed,
- TTL,
- invalidation,
- key,
- failure behavior,
- security risk.

Data:

1. Country list.
2. User permission.
3. Application detail response.
4. Postal lookup result.
5. OAuth JWKS.
6. Token introspection result.
7. Dashboard pending count.
8. Idempotency key untuk create application.
9. External API access token.
10. Regulatory case audit trail.

### Latihan 2 — Design Redis Keyspace

Buat keyspace untuk:

```text
Sistem case management multi-tenant production
```

Minimal mencakup:

- application summary,
- case summary,
- permission snapshot,
- idempotency key,
- rate limit,
- external postal lookup,
- distributed lock,
- job run transient state.

### Latihan 3 — Failure Mode Analysis

Analisis failure berikut:

1. Redis down.
2. Cache invalidation event delayed.
3. Deployment baru tidak compatible dengan value lama.
4. Role user dicabut tetapi permission cache masih valid.
5. 10k keys expire bersamaan.
6. Cache key lupa include tenant.
7. External API cache menyimpan negative result terlalu lama.
8. Local cache berbeda antar pod.
9. Redis evicts idempotency key terlalu cepat.
10. Metrics menunjukkan 99% hit ratio tetapi user melihat stale status.

Untuk masing-masing, tulis mitigasi.

---

## 41. Ringkasan Invariants

Ingat invariants berikut:

```text
Cache adalah state layer, bukan free performance.
Source of truth harus jelas.
Semua input yang mempengaruhi output harus masuk cache key.
Tenant/security context tidak boleh dilupakan.
TTL adalah freshness contract.
Invalidation harus after-commit atau recoverable.
Cache value harus DTO immutable, bukan entity/proxy.
Local cache tidak cocok untuk global correctness.
Distributed cache menambah dependency dan failure mode.
Redis down behavior harus berbeda per use case.
Cache stampede harus dicegah.
Negative caching perlu TTL lebih pendek.
Versioned key menyelamatkan rolling deployment.
High hit ratio tidak berarti correctness.
Security-sensitive cache harus fail closed jika ragu.
```

---

## 42. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Application Data Caching guide.
- Quarkus Redis Cache reference.
- Quarkus Redis extension reference.
- Quarkus Infinispan Cache reference.
- Quarkus Infinispan Client guide/reference.
- Quarkus Hibernate ORM guide untuk second-level cache.
- Quarkus Micrometer/OpenTelemetry guide untuk observability.
- Quarkus Native Image reference untuk native compatibility.

---

## 43. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan fondasi caching dan state layer di Quarkus.

Bagian berikutnya:

```text
Part 022 — HTTP Client Engineering: REST Client Reactive, Fault Tolerance, Timeout, Retry, Circuit Breaker
```

Di part berikutnya, fokus bergeser ke outbound integration:

- Quarkus REST Client,
- Reactive REST Client,
- timeout hierarchy,
- retry policy,
- circuit breaker,
- bulkhead,
- rate limit,
- token propagation,
- 401 refresh,
- 429 backoff,
- connection pooling,
- external API resilience,
- client-side observability,
- native-image implications.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-020.md">⬅️ Scheduler, Jobs, Batch, and Workload Orchestration</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-022.md">HTTP Client Engineering: REST Client Reactive, Fault Tolerance, Timeout, Retry, Circuit Breaker ➡️</a>
</div>
