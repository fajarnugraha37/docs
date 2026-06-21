# Part 19 — Spring Caching Semantics and Consistency Risk

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `19-spring-caching-semantics-consistency-risk.md`  
> Status seri: Part 19 dari 35 — belum selesai  
> Fokus: Spring Cache sebagai abstraction layer, proxy concern, consistency boundary, invalidation, local/distributed cache, transaction interaction, dan production failure model.

---

## 0. Kenapa Caching Perlu Dibahas sebagai Correctness Problem, Bukan Performance Trick

Caching sering dipahami secara dangkal:

> “Query mahal? Tambahkan `@Cacheable`.”

Itu berbahaya.

Dalam sistem production, cache bukan hanya alat mempercepat response. Cache adalah **replica tidak sempurna** dari data atau hasil komputasi. Begitu data direplikasi, kita langsung masuk ke masalah:

1. **Staleness** — data cache tertinggal dari source of truth.
2. **Invalidation** — kapan cache harus dihapus atau diperbarui.
3. **Key correctness** — apakah key cukup mewakili semua input yang mempengaruhi hasil.
4. **Authorization leakage** — apakah hasil user A bisa terbaca user B.
5. **Tenant leakage** — apakah tenant A bisa memakai cache tenant B.
6. **Transaction race** — apakah cache diubah sebelum database commit.
7. **Stampede** — banyak request miss bersamaan lalu menekan backend.
8. **Eviction surprise** — entry hilang karena memory pressure, TTL, max size, atau restart.
9. **Partial failure** — database berhasil, cache gagal; atau sebaliknya.
10. **Hidden proxy limitation** — annotation cache tidak jalan karena self-invocation atau method final/private.

Spring Cache membuat caching mudah dipasang, tetapi **tidak menghilangkan problem semantik caching**.

Mental model utama:

```text
Cache is not truth.
Cache is a controlled approximation of truth.
```

Kalau approximation itu tidak didesain, cache bisa mempercepat sistem yang salah.

---

## 1. Posisi Spring Cache dalam Ekosistem Spring

Spring Cache adalah **abstraction**, bukan cache engine.

Spring menyediakan kontrak seperti:

```java
org.springframework.cache.Cache
org.springframework.cache.CacheManager
org.springframework.cache.interceptor.KeyGenerator
org.springframework.cache.interceptor.CacheResolver
```

Lalu annotation seperti:

```java
@Cacheable
@CachePut
@CacheEvict
@Caching
@CacheConfig
```

Annotation tersebut tidak menyimpan data sendiri. Ia mendelegasikan operasi ke provider cache, misalnya:

1. simple in-memory cache berbasis `ConcurrentMap`.
2. Caffeine.
3. Redis.
4. JCache/JSR-107 provider.
5. Hazelcast/Infinispan/provider lain.
6. custom `CacheManager` internal.

Spring Framework mendefinisikan abstraction dan annotation caching. Spring Boot membantu auto-configuration berdasarkan dependency/cache provider yang tersedia di classpath.

---

## 2. Mental Model Dasar: Method Cache, Bukan Object Cache

Spring Cache annotation bekerja pada **method invocation**.

Contoh:

```java
@Service
public class ProductQueryService {

    @Cacheable(cacheNames = "productById", key = "#id")
    public ProductDto getProduct(Long id) {
        return productRepository.findDtoById(id)
                .orElseThrow(() -> new NotFoundException("Product not found"));
    }
}
```

Maknanya:

```text
Jika method getProduct(42) dipanggil melalui Spring proxy:
  cek cache productById dengan key 42
  jika ada -> return dari cache, method body tidak dijalankan
  jika tidak ada -> jalankan method body
                 simpan result ke cache
                 return result
```

Yang di-cache bukan “entity Product” secara magical. Yang di-cache adalah **return value dari method dengan input tertentu**.

Implikasi:

1. Semua input yang mempengaruhi hasil harus masuk cache key.
2. Jika hasil dipengaruhi context tersembunyi, cache key harus memasukkan context itu.
3. Jika hasil dipengaruhi waktu, role, tenant, locale, feature flag, atau security context, key harus mewakili itu atau caching harus dihindari.

Contoh bug:

```java
@Cacheable(cacheNames = "visibleCases", key = "#status")
public List<CaseDto> findVisibleCases(String status) {
    User user = securityContext.currentUser();
    return caseRepository.findVisibleCases(user.id(), status);
}
```

Key hanya `status`, padahal hasil juga bergantung pada user.

Akibat:

```text
User A request OPEN -> cache key OPEN berisi cases milik A
User B request OPEN -> mendapat cases milik A
```

Ini bukan performance bug. Ini data breach.

Key yang lebih benar:

```java
@Cacheable(cacheNames = "visibleCases", key = "#userId + ':' + #status")
public List<CaseDto> findVisibleCases(Long userId, String status) {
    return caseRepository.findVisibleCases(userId, status);
}
```

Lebih baik lagi: jangan biarkan method cache membaca hidden context. Buat input eksplisit.

---

## 3. Enable Caching: Apa yang Sebenarnya Terjadi

Caching annotation aktif jika caching di-enable.

Biasanya:

```java
@Configuration
@EnableCaching
public class CacheConfiguration {
}
```

Di Spring Boot, biasanya cukup:

```java
@SpringBootApplication
@EnableCaching
public class Application {
}
```

Lalu Boot akan mencoba menyediakan `CacheManager` jika dependency dan property mendukung.

Secara konseptual:

```text
@EnableCaching
  -> register infrastructure bean
  -> register cache advisor/interceptor
  -> apply advisor ke eligible bean
  -> method call melewati proxy
  -> CacheInterceptor mengeksekusi cache operation
```

Dengan kata lain, Spring Cache annotation adalah AOP/proxy concern.

Konsekuensi:

1. Self-invocation tidak memicu caching.
2. Method private tidak bisa dicache melalui proxy.
3. Method final/class final dapat bermasalah tergantung proxy mode.
4. Object yang dibuat manual dengan `new` tidak mendapatkan caching.
5. Annotation di method yang tidak dipanggil via Spring bean tidak efektif.

---

## 4. `CacheManager`: Router ke Cache Region

`CacheManager` bertugas mengambil cache berdasarkan nama.

```java
public interface CacheManager {
    Cache getCache(String name);
    Collection<String> getCacheNames();
}
```

Ketika annotation menulis:

```java
@Cacheable(cacheNames = "caseSummary")
```

Spring akan meminta:

```text
cacheManager.getCache("caseSummary")
```

Nama `caseSummary` sering disebut cache region, cache name, atau namespace.

Design rule:

```text
Cache name should represent data shape and invalidation boundary.
```

Contoh cache name buruk:

```text
cache
common
data
dto
query
```

Contoh lebih baik:

```text
caseSummaryByCaseId
caseListByOfficerAndStatus
userPermissionSnapshotByUserId
postalCodeLookupByPostalCode
referenceDataCountryByCode
```

Cache name yang baik membantu menjawab:

1. Data apa yang disimpan?
2. Key-nya apa?
3. Siapa owner-nya?
4. Kapan invalidated?
5. Apakah boleh stale?
6. Apakah tenant-aware?
7. Apakah security-sensitive?

---

## 5. `@Cacheable`: Cache-Aside Read Pattern

`@Cacheable` adalah annotation paling umum.

```java
@Cacheable(cacheNames = "productById", key = "#id")
public ProductDto getProduct(Long id) {
    return repository.findDtoById(id).orElseThrow();
}
```

Semantik:

```text
before method:
  lookup cache
  if hit -> return cached value
  if miss -> invoke method

after method success:
  store result in cache
```

`@Cacheable` cocok untuk:

1. read-heavy operation.
2. hasil deterministik untuk input tertentu.
3. data relatif stabil.
4. operasi mahal tapi pure-ish.
5. query external API yang punya rate limit.
6. reference data.
7. projection yang tidak perlu absolutely fresh.

Tidak cocok untuk:

1. data highly volatile.
2. data authorization-sensitive tanpa key lengkap.
3. data yang dipengaruhi hidden context.
4. operasi yang punya side effect.
5. command method.
6. hasil yang harus read-your-write secara kuat.

---

## 6. Key Generation: Bagian Paling Sering Salah

Jika `key` tidak diberikan, Spring menggunakan default key generator.

Secara konseptual:

```text
0 parameter  -> SimpleKey.EMPTY
1 parameter  -> parameter itu sendiri
N parameter  -> SimpleKey berisi semua parameter
```

Contoh:

```java
@Cacheable("caseSummary")
public CaseSummaryDto getCaseSummary(Long caseId) { ... }
```

Key default: `caseId`.

Contoh multi parameter:

```java
@Cacheable("caseSearch")
public Page<CaseDto> search(String status, int page, int size) { ... }
```

Key default: kombinasi `status`, `page`, `size`.

Masalah muncul ketika parameter berupa object mutable:

```java
@Cacheable("caseSearch")
public Page<CaseDto> search(CaseSearchRequest request) { ... }
```

Jika `CaseSearchRequest` tidak punya `equals/hashCode` stabil, key bisa salah.

Lebih aman:

```java
@Cacheable(
    cacheNames = "caseSearch",
    key = "#request.status + ':' + #request.assigneeId + ':' + #request.page + ':' + #request.size"
)
public Page<CaseDto> search(CaseSearchRequest request) { ... }
```

Namun SpEL panjang juga bisa rapuh. Untuk sistem besar, gunakan custom `KeyGenerator`.

---

## 7. Custom `KeyGenerator`

Contoh:

```java
@Component("stableQueryKeyGenerator")
public class StableQueryKeyGenerator implements KeyGenerator {

    @Override
    public Object generate(Object target, Method method, Object... params) {
        return method.getDeclaringClass().getSimpleName()
                + "." + method.getName()
                + ":" + Arrays.stream(params)
                    .map(this::normalize)
                    .collect(Collectors.joining("|"));
    }

    private String normalize(Object param) {
        if (param == null) {
            return "null";
        }
        if (param instanceof String value) {
            return value.trim().toLowerCase(Locale.ROOT);
        }
        return String.valueOf(param);
    }
}
```

Usage:

```java
@Cacheable(cacheNames = "caseSearch", keyGenerator = "stableQueryKeyGenerator")
public Page<CaseDto> search(CaseSearchRequest request) {
    ...
}
```

Namun jangan membuat generator yang “terlalu pintar” sampai sulit diaudit.

Key generator yang baik:

1. deterministic.
2. stable across JVM restart jika cache distributed.
3. tidak memasukkan object identity.
4. tidak memasukkan data sensitif mentah jika key terlihat di Redis/log.
5. memasukkan tenant/user/locale jika hasil bergantung padanya.
6. punya test.

Key generator buruk:

```java
return target.hashCode() + ":" + Arrays.hashCode(params);
```

Ini tidak stabil untuk distributed cache dan sulit debug.

---

## 8. `condition` vs `unless`

Spring Cache mendukung conditional caching.

```java
@Cacheable(
    cacheNames = "productById",
    key = "#id",
    condition = "#id > 0",
    unless = "#result == null"
)
public ProductDto getProduct(Long id) { ... }
```

Perbedaan penting:

```text
condition -> dievaluasi sebelum method dijalankan
unless    -> dievaluasi setelah method menghasilkan result
```

`condition` cocok untuk input-based decision:

```java
@Cacheable(cacheNames = "report", condition = "#request.cacheable")
public ReportDto generate(ReportRequest request) { ... }
```

`unless` cocok untuk result-based decision:

```java
@Cacheable(cacheNames = "customer", unless = "#result.temporary")
public CustomerDto getCustomer(Long id) { ... }
```

Caveat:

1. Jangan menyimpan rule bisnis kompleks di SpEL annotation.
2. Jangan membuat condition yang diam-diam berubah berdasarkan global state.
3. Untuk rule rumit, pindahkan ke service eksplisit atau custom cache resolver.

---

## 9. Caching Null dan Negative Result

Pertanyaan penting:

```text
Jika data tidak ditemukan, apakah hasil not found perlu dicache?
```

Contoh:

```java
@Cacheable(cacheNames = "productById", key = "#id")
public ProductDto getProduct(Long id) {
    return repository.findDtoById(id).orElse(null);
}
```

Jika provider mendukung caching null, maka not found bisa dicache.

Manfaat:

1. mengurangi repeated lookup untuk id tidak valid.
2. mencegah abuse/random probing menekan database.

Risiko:

1. jika data baru dibuat dengan id tersebut, cache null menjadi stale.
2. cache negatif bisa menyembunyikan insert baru.
3. TTL harus pendek.

Alternative:

```java
@Cacheable(cacheNames = "productById", key = "#id", unless = "#result == null")
public ProductDto getProduct(Long id) { ... }
```

Rule praktis:

```text
Cache negative result only if creation/update path has clear invalidation or TTL is short.
```

---

## 10. `@CachePut`: Always Execute, Then Update Cache

`@CachePut` berbeda dari `@Cacheable`.

```java
@CachePut(cacheNames = "productById", key = "#result.id")
public ProductDto updateProduct(UpdateProductCommand command) {
    Product product = productService.update(command);
    return mapper.toDto(product);
}
```

Semantik:

```text
method selalu dijalankan
result disimpan ke cache
```

Cocok untuk:

1. write-through-like update setelah command berhasil.
2. command menghasilkan representation yang sama dengan cache read.
3. cache value bisa dibangun dari command result.

Risiko:

1. Jika transaksi database rollback setelah cache put, cache bisa berisi data yang tidak committed.
2. Jika mapping tidak sama dengan read path, cache menjadi inconsistent.
3. Jika command hanya partial update, cache value bisa incomplete.

Karena itu, `@CachePut` pada method transaksional perlu hati-hati.

---

## 11. `@CacheEvict`: Invalidation, Bukan “Cleanup” Saja

`@CacheEvict` menghapus entry cache.

```java
@CacheEvict(cacheNames = "productById", key = "#id")
public void deleteProduct(Long id) {
    repository.deleteById(id);
}
```

Untuk semua entry:

```java
@CacheEvict(cacheNames = "productSearch", allEntries = true)
public void reindexProducts() {
    ...
}
```

`beforeInvocation` menentukan kapan eviction dilakukan.

Default:

```text
beforeInvocation = false
```

Artinya cache di-evict setelah method sukses.

Jika:

```java
@CacheEvict(cacheNames = "x", key = "#id", beforeInvocation = true)
```

Eviction terjadi sebelum method body.

Trade-off:

| Mode | Kelebihan | Risiko |
|---|---|---|
| after success/default | tidak evict jika command gagal | race dengan transaksi commit |
| before invocation | mengurangi stale sebelum command | jika command gagal, cache sudah hilang |

Untuk command transaksional, invalidation yang benar sering butuh after commit hook, bukan sekadar after method success.

---

## 12. `@Caching`: Multiple Operations

Jika satu method perlu beberapa operasi cache:

```java
@Caching(evict = {
    @CacheEvict(cacheNames = "productById", key = "#id"),
    @CacheEvict(cacheNames = "productSearch", allEntries = true)
})
public void changeProductStatus(Long id, ProductStatus status) {
    ...
}
```

Ini sering terjadi ketika satu write mengubah banyak read model.

Namun hati-hati: semakin banyak cache yang harus di-evict, semakin jelas bahwa read model dan invalidation boundary perlu didesain ulang.

Pertanyaan desain:

1. Apakah cache terlalu granular?
2. Apakah query list harus dicache?
3. Apakah invalidation list cache terlalu mahal?
4. Apakah TTL lebih cocok daripada precise invalidation?
5. Apakah event-driven invalidation diperlukan?

---

## 13. Proxy Limitation: Kenapa Cache Annotation Kadang Tidak Jalan

Karena Spring Cache berbasis proxy, kasus ini tidak jalan:

```java
@Service
public class ProductService {

    public ProductDto getProductPublic(Long id) {
        return getProductCached(id); // self-invocation
    }

    @Cacheable(cacheNames = "productById", key = "#id")
    public ProductDto getProductCached(Long id) {
        return loadFromDb(id);
    }
}
```

Call dari method dalam class yang sama langsung ke target object, bukan lewat proxy.

Alur yang terjadi:

```text
external caller -> proxy -> getProductPublic()
inside target   -> this.getProductCached()
               -> bypass proxy
               -> no cache interceptor
```

Solusi lebih bersih:

```java
@Service
public class ProductQueryFacade {
    private final ProductCachedReader reader;

    public ProductQueryFacade(ProductCachedReader reader) {
        this.reader = reader;
    }

    public ProductDto getProductPublic(Long id) {
        return reader.getProductCached(id);
    }
}

@Service
public class ProductCachedReader {

    @Cacheable(cacheNames = "productById", key = "#id")
    public ProductDto getProductCached(Long id) {
        return loadFromDb(id);
    }
}
```

Rule:

```text
Cacheable methods should usually be entry points of a Spring bean, not internal helper methods.
```

---

## 14. Cache and Transaction Boundary

Ini salah satu area paling berbahaya.

Contoh:

```java
@Transactional
@CacheEvict(cacheNames = "caseById", key = "#id")
public void approveCase(Long id) {
    Case c = repository.getReferenceById(id);
    c.approve();
}
```

Secara method-level terlihat benar: case berubah, cache dihapus.

Tetapi kapan cache eviction terjadi?

Tergantung urutan interceptor dan timing. Method return bukan selalu sama dengan database commit. Pada transaction interceptor, commit terjadi setelah method body selesai tetapi masih dalam advice chain.

Race yang mungkin:

```text
T1 approveCase
  update entity
  cache evicted
  transaction belum commit

T2 getCase
  cache miss
  read DB lama atau blocked tergantung isolation
  cache ulang value lama

T1 commit

Cache sekarang berisi value lama setelah commit baru
```

Ini disebut stale repopulation race.

Solusi yang lebih aman:

1. Evict after transaction commit menggunakan transaction synchronization.
2. Gunakan TTL pendek untuk cache yang write-heavy.
3. Hindari cache read model yang sangat sering berubah.
4. Gunakan versioned key.
5. Gunakan event/outbox after commit untuk invalidation asynchronous.

Contoh after commit manual:

```java
@Transactional
public void approveCase(Long id) {
    Case c = repository.getReferenceById(id);
    c.approve();

    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                cacheManager.getCache("caseById").evict(id);
            }
        }
    );
}
```

Atau lebih rapi dengan domain/application event:

```java
@Transactional
public void approveCase(Long id) {
    Case c = repository.getReferenceById(id);
    c.approve();
    publisher.publishEvent(new CaseApprovedEvent(id));
}

@Component
public class CaseCacheInvalidator {

    private final CacheManager cacheManager;

    public CaseCacheInvalidator(CacheManager cacheManager) {
        this.cacheManager = cacheManager;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(CaseApprovedEvent event) {
        Cache cache = cacheManager.getCache("caseById");
        if (cache != null) {
            cache.evict(event.caseId());
        }
    }
}
```

Ini lebih eksplisit:

```text
state change committed -> invalidate cache
```

---

## 15. Transaction-Aware Cache Decorator

Spring menyediakan konsep transaction-aware cache decoration melalui `TransactionAwareCacheManagerProxy`.

Tujuannya: menunda operasi cache tertentu sampai transaction commit.

Contoh konfigurasi konseptual:

```java
@Bean
CacheManager cacheManager(CacheManager target) {
    return new TransactionAwareCacheManagerProxy(target);
}
```

Namun jangan anggap ini otomatis menyelesaikan semua consistency problem.

Yang tetap harus dipikirkan:

1. Apakah semua cache operation memang harus after commit?
2. Bagaimana jika tidak ada transaction?
3. Bagaimana dengan distributed cache failure setelah commit?
4. Bagaimana dengan read repopulation race?
5. Bagaimana dengan multi-node invalidation?

Transaction-aware cache membantu, tetapi bukan pengganti desain invalidation.

---

## 16. Local Cache vs Distributed Cache

Dua pilihan umum di Spring Boot production:

1. Local in-process cache seperti Caffeine.
2. Distributed/remote cache seperti Redis.

### 16.1 Local Cache

Local cache hidup di memory satu JVM.

Kelebihan:

1. sangat cepat.
2. tidak ada network call.
3. bagus untuk hot reference data.
4. bisa mengurangi latency tail.
5. cocok untuk per-node computed value.

Kekurangan:

1. setiap node punya isi cache sendiri.
2. invalidation antar node sulit.
3. restart node menghapus cache.
4. memory terbatas per pod/JVM.
5. bisa menyebabkan inconsistent result antar node.

Cocok untuk:

```text
reference data yang jarang berubah
feature flag snapshot pendek
metadata static
small lookup table
compiled rule/config snapshot
```

Tidak cocok untuk:

```text
session shared
authorization critical tanpa TTL pendek
frequently updated entity
large search result
cross-node coordination
```

### 16.2 Distributed Cache

Redis/distributed cache hidup di luar JVM.

Kelebihan:

1. shared antar node.
2. bisa survive app restart.
3. invalidation lebih konsisten antar instance.
4. bisa dipakai untuk rate limit/counter/idempotency key dengan desain yang benar.

Kekurangan:

1. network latency.
2. serialization/deserialization cost.
3. Redis menjadi dependency runtime.
4. partial failure perlu ditangani.
5. operational complexity.
6. hot key problem.

Cocok untuk:

```text
multi-node read cache
idempotency key
rate limit counter
external API response cache
tenant-level shared reference data
```

Tidak cocok untuk:

```text
large mutable object tanpa TTL
strongly consistent command state
unbounded query result
security-sensitive object tanpa key lengkap
```

---

## 17. Caffeine with Spring Boot

Dengan dependency Caffeine dan `spring-boot-starter-cache`, Boot dapat meng-auto-configure `CaffeineCacheManager`.

Contoh property:

```yaml
spring:
  cache:
    type: caffeine
    cache-names:
      - countryByCode
      - productById
    caffeine:
      spec: maximumSize=10000,expireAfterWrite=10m,recordStats
```

Contoh explicit bean:

```java
@Configuration
@EnableCaching
public class CaffeineCacheConfiguration {

    @Bean
    public Caffeine<Object, Object> caffeineSpec() {
        return Caffeine.newBuilder()
                .maximumSize(10_000)
                .expireAfterWrite(Duration.ofMinutes(10))
                .recordStats();
    }
}
```

Caffeine cocok untuk local hot cache.

Tetapi ingat:

```text
Caffeine cache is per JVM.
```

Jika ada 8 pod, ada 8 cache berbeda.

Operational implication:

1. rollout bisa mengubah cache secara bertahap.
2. satu pod bisa punya value lama, pod lain value baru.
3. hit ratio berbeda antar pod.
4. memory sizing harus dikalikan jumlah pod.

---

## 18. Redis Cache with Spring Boot

Redis sering dipakai untuk shared cache.

Contoh property:

```yaml
spring:
  cache:
    type: redis
    cache-names:
      - productById
      - userPermissionSnapshot
  data:
    redis:
      host: redis.internal
      port: 6379
```

Redis cache perlu perhatian lebih pada serialization.

Pertanyaan desain:

1. Format value apa? JSON? binary? JDK serialization?
2. Apakah class version berubah saat deployment?
3. Apakah cache perlu survive rolling deployment antar versi app?
4. Apakah field baru/field lama backward compatible?
5. Apakah key punya prefix environment/tenant/application?
6. Apakah TTL berbeda per cache name?
7. Apakah Redis outage membuat request gagal atau fallback ke DB?

Contoh key prefix penting:

```text
prod:aceas:case-service:v1:caseById:123
```

Tanpa prefix, risiko:

1. DEV/UAT/PROD tercampur jika salah Redis.
2. service A dan B pakai cache name sama.
3. versi app lama membaca format versi baru.
4. tenant data collision.

---

## 19. TTL, TTI, Max Size, and Eviction Policy

Cache harus punya batas.

Batas umum:

1. TTL — time to live / expire after write.
2. TTI — time to idle / expire after access.
3. maximum size/count.
4. maximum weight.
5. manual eviction.
6. event-based invalidation.

Tanpa batas, cache menjadi memory leak.

TTL bukan hanya performance config. TTL adalah **freshness contract**.

Contoh:

```text
postal code lookup: TTL 24h
country reference: TTL 1h atau manual reload
case summary: TTL 30s atau no cache
permission snapshot: TTL 1-5m dengan explicit invalidation on role change
external token metadata: TTL sesuai exp - safety margin
```

Rule:

```text
The more business-critical freshness is, the shorter the TTL or the stronger the invalidation must be.
```

---

## 20. Cache Stampede

Cache stampede terjadi ketika banyak request miss untuk key yang sama bersamaan.

Alur:

```text
cache expired for key X
100 requests arrive
all miss
all query DB/external API
backend overloaded
```

Spring `@Cacheable(sync = true)` dapat membantu untuk single JVM/provider tertentu.

```java
@Cacheable(cacheNames = "productById", key = "#id", sync = true)
public ProductDto getProduct(Long id) {
    return slowLoad(id);
}
```

Makna:

```text
Only one thread computes the value for the same key while others wait.
```

Caveat:

1. Bergantung provider support.
2. Biasanya hanya efektif lokal, bukan distributed lock global.
3. Bisa meningkatkan waiting thread jika computation lambat.
4. Untuk Redis/distributed stampede, perlu mekanisme lain.

Strategi lain:

1. randomize TTL/jitter.
2. soft TTL + background refresh.
3. distributed lock per key.
4. request coalescing.
5. stale-while-revalidate pattern.
6. rate limit fallback.
7. pre-warm cache.

---

## 21. Cache Penetration and Cache Pollution

### 21.1 Cache Penetration

Cache penetration terjadi ketika request terus mencari key yang tidak ada.

Contoh:

```text
GET /users/random-invalid-id
```

Jika not found tidak dicache, setiap request menekan database.

Solusi:

1. cache negative result dengan TTL pendek.
2. validate key format sebelum query.
3. bloom filter untuk large keyspace.
4. rate limit suspicious pattern.

### 21.2 Cache Pollution

Cache pollution terjadi ketika cache diisi entry yang jarang dipakai, mengusir hot entry.

Contoh:

```text
admin export membuka 100k product ID -> semua masuk cache -> hot product eviction
```

Solusi:

1. jangan cache endpoint bulk/export.
2. gunakan `condition` untuk request tertentu.
3. pisahkan cache untuk user-facing hot path dan batch/admin path.
4. batasi max size.
5. gunakan cache admission policy provider seperti Caffeine.

---

## 22. Cache Key and Security Boundary

Cache key harus memasukkan semua dimensi yang mempengaruhi authorization.

Dimensi umum:

1. tenant id.
2. user id.
3. role/authority version.
4. organization unit.
5. data classification.
6. locale.
7. feature flag version.
8. time window.
9. regulatory mode.

Contoh salah:

```java
@Cacheable(cacheNames = "caseDetail", key = "#caseId")
public CaseDetailDto getCaseDetail(Long caseId) {
    User user = currentUser();
    return repository.findVisibleDetail(caseId, user);
}
```

Contoh lebih aman:

```java
@Cacheable(
    cacheNames = "caseDetailVisibleToUser",
    key = "#tenantId + ':' + #userId + ':' + #caseId"
)
public CaseDetailDto getCaseDetail(String tenantId, Long userId, Long caseId) {
    return repository.findVisibleDetail(tenantId, userId, caseId);
}
```

Namun untuk detail case authorization-sensitive, sering lebih baik:

```text
cache data non-sensitive/base projection by caseId
perform authorization check separately per request
```

Tetapi itu juga harus hati-hati agar cached base projection tidak berisi data yang tidak boleh dibaca.

---

## 23. Tenant-Aware Cache

Dalam aplikasi multi-tenant, cache key tanpa tenant id hampir selalu bug.

Buruk:

```java
@Cacheable(cacheNames = "settings", key = "#name")
public SettingDto getSetting(String name) { ... }
```

Baik:

```java
@Cacheable(cacheNames = "settings", key = "#tenantId + ':' + #name")
public SettingDto getSetting(String tenantId, String name) { ... }
```

Lebih baik untuk platform:

```java
public record TenantCacheKey(String tenantId, String cacheName, Object businessKey) {}
```

Atau custom key generator yang mewajibkan tenant context.

Tapi hati-hati dengan hidden tenant context:

```java
TenantContext.getCurrentTenant()
```

Jika dipakai di key generator, pastikan:

1. context selalu tersedia.
2. context tidak bocor antar thread.
3. async/scheduler/message listener punya tenant context eksplisit.
4. test membuktikan tenant A/B tidak collision.

---

## 24. Cache and Mutable Objects

Jangan cache mutable object yang bisa diubah caller.

Contoh:

```java
@Cacheable(cacheNames = "rules")
public List<RuleDto> getRules() {
    return repository.findRules();
}
```

Caller bisa melakukan:

```java
List<RuleDto> rules = service.getRules();
rules.clear();
```

Jika list yang sama disimpan di local cache, cache rusak.

Solusi:

1. return immutable collection.
2. cache DTO immutable/record.
3. defensive copy saat return.
4. serialize/deserialize untuk distributed cache biasanya menghasilkan copy, tapi jangan bergantung pada itu sebagai desain.

Contoh:

```java
@Cacheable(cacheNames = "rules")
public List<RuleDto> getRules() {
    return List.copyOf(repository.findRules());
}
```

Record DTO:

```java
public record RuleDto(String code, String expression, boolean active) {}
```

---

## 25. Cache and Entity Objects

Caching JPA entity via Spring Cache sering buruk.

Contoh:

```java
@Cacheable(cacheNames = "caseEntity", key = "#id")
public Case getCase(Long id) {
    return entityManager.find(Case.class, id);
}
```

Risiko:

1. lazy relation problem.
2. detached entity confusion.
3. mutation outside transaction.
4. stale entity state.
5. serialization issue.
6. identity/persistence context conflict.
7. leaking internal domain model to API layer.

Lebih aman:

```java
@Cacheable(cacheNames = "caseSummary", key = "#id")
public CaseSummaryDto getCaseSummary(Long id) {
    return repository.findSummaryById(id).orElseThrow();
}
```

Rule:

```text
Cache read models/projections/DTOs, not live persistence entities.
```

---

## 26. Cache and Authorization Result

Authorization decision caching bisa sangat membantu, tetapi sangat berisiko.

Contoh:

```java
@Cacheable(cacheNames = "canApprove", key = "#userId + ':' + #caseId")
public boolean canApprove(Long userId, Long caseId) { ... }
```

Pertanyaan yang harus dijawab:

1. Jika role user berubah, invalidation bagaimana?
2. Jika case status berubah, invalidation bagaimana?
3. Jika assignment berubah, invalidation bagaimana?
4. Jika tenant membership berubah, invalidation bagaimana?
5. Apakah deny dan allow sama-sama dicache?
6. TTL berapa?
7. Apakah audit perlu tahu decision source dari cache?

Lebih aman menggunakan versioned key:

```text
userPermissionVersion + ':' + caseVersion + ':' + userId + ':' + caseId
```

Atau TTL sangat pendek.

Rule:

```text
Caching authorization decisions requires explicit invalidation model or short TTL.
```

Untuk sistem regulasi/enforcement, cache authorization harus diperlakukan sebagai security component, bukan optimization biasa.

---

## 27. Cache and List Queries

Caching list/search query lebih sulit daripada caching by-id.

By-id:

```text
key: caseId
invalidated by: case update/delete
```

Search:

```text
key: status + assignee + page + size + sort + filter + tenant + role + date range
invalidated by: any update that changes membership/order/result
```

Contoh:

```java
@Cacheable(cacheNames = "caseSearch", key = "#request.toStableKey()")
public Page<CaseDto> search(CaseSearchRequest request) { ... }
```

Masalah:

1. key cardinality tinggi.
2. invalidation sulit.
3. page 1 berubah saat data baru masuk.
4. sort order berubah karena update.
5. cache pollution.
6. stale data terlihat jelas ke user.

Alternatif:

1. Cache count saja.
2. Cache reference data/filter option, bukan result list.
3. Cache by-id detail, list tetap query DB.
4. Use search engine/OpenSearch read model.
5. TTL sangat pendek untuk dashboard.
6. Materialized view/read model.

Rule:

```text
Cache by-id aggressively; cache list/search conservatively.
```

---

## 28. Cache Resolver: Dynamic Cache Selection

`CacheResolver` digunakan ketika cache tidak bisa ditentukan statically dari annotation.

Contoh use case:

1. cache berbeda per tenant tier.
2. cache berbeda per region.
3. cache berbeda per data classification.
4. local vs distributed cache berdasarkan operation.

Contoh skeleton:

```java
@Component("tenantAwareCacheResolver")
public class TenantAwareCacheResolver implements CacheResolver {

    private final CacheManager cacheManager;

    public TenantAwareCacheResolver(CacheManager cacheManager) {
        this.cacheManager = cacheManager;
    }

    @Override
    public Collection<? extends Cache> resolveCaches(CacheOperationInvocationContext<?> context) {
        String tenantId = TenantContext.requireTenantId();
        String baseName = context.getOperation().getCacheNames().iterator().next();
        Cache cache = cacheManager.getCache(tenantId + ":" + baseName);
        if (cache == null) {
            throw new IllegalStateException("Cache not found: " + tenantId + ":" + baseName);
        }
        return List.of(cache);
    }
}
```

Usage:

```java
@Cacheable(cacheNames = "settings", cacheResolver = "tenantAwareCacheResolver", key = "#name")
public SettingDto getSetting(String name) { ... }
```

Namun ini bisa menyembunyikan tenant dependency. Untuk banyak sistem, explicit tenant id in key lebih mudah diaudit.

---

## 29. Composite Cache: L1 + L2 Pattern

Beberapa sistem menggunakan dua lapis cache:

```text
L1: Caffeine local cache
L2: Redis distributed cache
Source: Database/API
```

Alur read:

```text
check L1
  hit -> return
miss -> check L2
  hit -> populate L1 -> return
miss -> load source -> populate L2 and L1 -> return
```

Kelebihan:

1. latency rendah untuk hot key.
2. Redis load lebih kecil.
3. cross-node sharing tetap ada.

Kekurangan:

1. invalidation lebih kompleks.
2. L1 bisa stale walau L2 sudah update.
3. event/pubsub invalidation mungkin diperlukan.
4. failure debugging lebih sulit.

Spring Cache abstraction tidak otomatis memberi full L1/L2 coherent cache. Perlu custom `CacheManager`/library atau provider yang mendukung.

Rule:

```text
Use L1+L2 only when single-layer cache is proven insufficient.
```

---

## 30. Serialization and Schema Evolution

Distributed cache menyimpan bytes/string di luar JVM. Value format menjadi contract.

Masalah umum:

1. class renamed.
2. field renamed.
3. enum value berubah.
4. package berubah saat refactor.
5. app v1 dan v2 berjalan bersamaan saat rolling deployment.
6. cache value dari versi lama tidak bisa dibaca versi baru.

Hindari JDK serialization untuk long-lived distributed cache karena:

1. coupling ke class name.
2. sulit evolve.
3. security risk historis.
4. kurang transparan untuk debugging.

Lebih aman:

1. JSON dengan DTO stabil.
2. versioned value.
3. short TTL during deployment.
4. cache prefix version.
5. clear cache saat breaking change.

Contoh versioned key:

```text
caseSummary:v2:{caseId}
```

Contoh versioned value:

```java
public record CachedValue<T>(int schemaVersion, Instant cachedAt, T payload) {}
```

---

## 31. Cache Observability

Cache tanpa observability adalah blind optimization.

Minimal metrics:

1. hit count.
2. miss count.
3. hit ratio.
4. eviction count.
5. load time.
6. load failure.
7. size/estimated size.
8. Redis latency.
9. Redis error count.
10. cache operation timeout.

Untuk Caffeine, aktifkan stats:

```yaml
spring:
  cache:
    caffeine:
      spec: maximumSize=10000,expireAfterWrite=10m,recordStats
```

Actuator/Micrometer dapat mengekspos metrik cache jika provider dan auto-configuration mendukung.

Namun hit ratio tidak boleh dibaca sendirian.

Contoh interpretasi salah:

```text
Hit ratio 99% bagus.
```

Belum tentu.

Mungkin:

1. cache menyimpan stale data.
2. cache key terlalu broad.
3. cache berisi authorization leakage.
4. request pattern hanya satu key.
5. expensive miss tetap menghancurkan tail latency.

Metrik harus dikaitkan dengan:

1. latency endpoint.
2. DB query rate.
3. error rate.
4. stale complaint/audit issue.
5. memory/Redis usage.
6. tenant distribution.

---

## 32. Testing Cache Semantics

Testing cache bukan hanya memastikan method dipanggil sekali.

### 32.1 Hit/Miss Test

```java
@Test
void shouldLoadOnlyOnceForSameKey() {
    ProductDto first = service.getProduct(1L);
    ProductDto second = service.getProduct(1L);

    assertThat(first).isEqualTo(second);
    verify(repository, times(1)).findDtoById(1L);
}
```

### 32.2 Key Separation Test

```java
@Test
void shouldSeparateCacheByTenant() {
    service.getSetting("tenant-a", "timezone");
    service.getSetting("tenant-b", "timezone");

    verify(repository).findSetting("tenant-a", "timezone");
    verify(repository).findSetting("tenant-b", "timezone");
}
```

### 32.3 Invalidation Test

```java
@Test
void shouldEvictAfterUpdate() {
    service.getProduct(1L);
    service.updateProduct(1L, newName);
    service.getProduct(1L);

    verify(repository, times(2)).findDtoById(1L);
}
```

### 32.4 Self-Invocation Test

Jika ingin memastikan caching benar-benar via proxy, test harus memanggil Spring bean dari context, bukan object manual.

Buruk:

```java
ProductService service = new ProductService(repository);
```

Baik:

```java
@Autowired ProductService service;
```

### 32.5 Transaction Race Test

Sulit tapi penting untuk critical cache.

Gunakan:

1. integration test dengan real database.
2. concurrent transaction scenario.
3. controlled latch/barrier.
4. verify stale repopulation tidak terjadi.

---

## 33. Production Cache Design Template

Sebelum menambahkan cache, isi template ini.

```text
Cache name:
Owner team/module:
Source of truth:
Cached value shape:
Key fields:
Hidden context involved:
Tenant-aware: yes/no
User-aware: yes/no
Authorization-sensitive: yes/no
TTL:
Max size:
Local/distributed:
Serialization format:
Invalidation trigger:
Transaction boundary:
Negative result caching:
Stampede protection:
Observability metrics:
Fallback behavior on cache failure:
Test cases:
Operational runbook:
```

Jika template ini tidak bisa diisi, cache belum siap.

---

## 34. Common Anti-Patterns

### 34.1 Cache Everything

```text
“Tambahkan @Cacheable di semua query.”
```

Akibat:

1. memory bloat.
2. stale data.
3. invalidation chaos.
4. hidden security bug.
5. DB load mungkin tidak turun karena key cardinality tinggi.

### 34.2 Cache Hidden Context

Method memakai security/tenant context tapi key tidak memasukkannya.

### 34.3 Cache Command Result Without Transaction Awareness

Cache diupdate sebelum commit aman.

### 34.4 Cache Entity

JPA entity dicache sebagai DTO. Ini sering menyebabkan lazy/detached/stale mutation bug.

### 34.5 Cache Search Result with Unbounded Key

Setiap kombinasi filter/page/sort membuat cache entry baru.

### 34.6 No TTL

Cache hidup selamanya karena lupa expiry.

### 34.7 No Metrics

Tidak tahu apakah cache membantu atau menyakiti.

### 34.8 Local Cache in Multi-Node Without Invalidation Model

Setiap pod punya kebenaran masing-masing.

### 34.9 Cache Authorization with Long TTL

Role berubah, cache masih allow.

### 34.10 Treat Redis as Database

Redis cache diperlakukan sebagai source of truth tanpa durability/consistency design.

---

## 35. Decision Matrix: Should This Be Cached?

| Pertanyaan | Jika Jawaban Ya | Implikasi |
|---|---|---|
| Apakah operasi read-heavy? | Ya | kandidat cache |
| Apakah hasil deterministik dari input? | Ya | aman secara dasar |
| Apakah hasil bergantung user/tenant/role? | Ya | key harus lengkap atau hindari cache |
| Apakah data sering berubah? | Ya | TTL pendek/invalidation kuat |
| Apakah stale data berbahaya? | Ya | cache mungkin tidak cocok |
| Apakah source mahal/rate-limited? | Ya | cache berguna, butuh stampede protection |
| Apakah key cardinality tinggi? | Ya | risiko pollution/memory bloat |
| Apakah invalidation jelas? | Tidak | gunakan TTL pendek atau jangan cache |
| Apakah value mutable/entity? | Ya | ubah ke immutable DTO |
| Apakah cache failure boleh membuat request gagal? | Tergantung | definisikan fallback |

Rule ringkas:

```text
Cache when the freshness contract is explicit and the invalidation story is credible.
```

---

## 36. Spring Cache Review Checklist

Gunakan checklist ini saat review PR.

### 36.1 Annotation and Proxy

- [ ] Method dipanggil melalui Spring proxy.
- [ ] Tidak bergantung self-invocation.
- [ ] Method tidak private/final problematic.
- [ ] Class adalah Spring bean.
- [ ] `@EnableCaching` aktif.
- [ ] `CacheManager` benar.

### 36.2 Key Correctness

- [ ] Key memasukkan semua method parameter relevan.
- [ ] Key memasukkan tenant jika tenant-aware.
- [ ] Key memasukkan user/role jika authorization-sensitive.
- [ ] Key tidak berbasis object identity.
- [ ] Key tidak membocorkan data sensitif mentah.
- [ ] Key punya test collision.

### 36.3 Value Safety

- [ ] Value immutable atau defensive copy.
- [ ] Tidak cache JPA entity.
- [ ] DTO serialization compatible jika distributed.
- [ ] Value size wajar.

### 36.4 Freshness and Invalidation

- [ ] TTL jelas.
- [ ] Max size jelas.
- [ ] Eviction trigger jelas.
- [ ] Transaction boundary aman.
- [ ] Role/tenant/status update menghapus cache terkait.
- [ ] Negative cache diputuskan eksplisit.

### 36.5 Operations

- [ ] Metrics tersedia.
- [ ] Cache failure behavior jelas.
- [ ] Redis/network timeout jelas jika remote cache.
- [ ] Runbook clear cache tersedia.
- [ ] Cache warming jika diperlukan.
- [ ] Deployment schema evolution dipikirkan.

---

## 37. Contoh Desain Cache untuk Enterprise Case Management

Misalnya sistem case management punya endpoint:

```text
GET /cases/{caseId}/summary
```

Summary berisi:

1. case number.
2. status.
3. assigned officer.
4. due date.
5. last activity date.
6. display flags.

Pertanyaan:

```text
Apakah boleh stale?
```

Jika officer baru approve case, summary stale bisa membingungkan. Tetapi stale 10–30 detik mungkin masih acceptable untuk dashboard, bukan untuk action button.

Desain:

```text
Cache name: caseSummaryByTenantAndCaseId
Key: tenantId + ':' + caseId + ':' + caseVersion
TTL: 30s
Value: immutable CaseSummaryDto
Invalidation: after commit on case status/assignment/due date/activity update
Local/distributed: Redis for multi-node consistency, optional Caffeine L1 only after proven needed
Security: summary must not include restricted fields; authorization check done before return
Metrics: hit/miss/load time/Redis error
Fallback: if Redis unavailable, query DB and do not fail request
```

Implementation sketch:

```java
@Service
public class CaseSummaryQueryService {

    private final CaseSummaryRepository repository;
    private final CaseAuthorizationService authorizationService;

    public CaseSummaryQueryService(
            CaseSummaryRepository repository,
            CaseAuthorizationService authorizationService
    ) {
        this.repository = repository;
        this.authorizationService = authorizationService;
    }

    public CaseSummaryDto getVisibleSummary(String tenantId, Long userId, Long caseId) {
        authorizationService.assertCanViewCase(tenantId, userId, caseId);
        long version = repository.findCaseVersion(tenantId, caseId);
        return getSummaryCached(tenantId, caseId, version);
    }

    @Cacheable(
        cacheNames = "caseSummaryByTenantAndCaseId",
        key = "#tenantId + ':' + #caseId + ':' + #version"
    )
    public CaseSummaryDto getSummaryCached(String tenantId, Long caseId, long version) {
        return repository.findSummary(tenantId, caseId)
                .orElseThrow(() -> new NotFoundException("Case not found"));
    }
}
```

Namun ada proxy issue: `getVisibleSummary` memanggil `getSummaryCached` dalam class yang sama, sehingga caching tidak jalan.

Perbaiki dengan split bean:

```java
@Service
public class CaseSummaryQueryService {

    private final CaseAuthorizationService authorizationService;
    private final CaseSummaryVersionRepository versionRepository;
    private final CaseSummaryCachedReader cachedReader;

    public CaseSummaryQueryService(
            CaseAuthorizationService authorizationService,
            CaseSummaryVersionRepository versionRepository,
            CaseSummaryCachedReader cachedReader
    ) {
        this.authorizationService = authorizationService;
        this.versionRepository = versionRepository;
        this.cachedReader = cachedReader;
    }

    public CaseSummaryDto getVisibleSummary(String tenantId, Long userId, Long caseId) {
        authorizationService.assertCanViewCase(tenantId, userId, caseId);
        long version = versionRepository.findCaseVersion(tenantId, caseId);
        return cachedReader.getSummaryCached(tenantId, caseId, version);
    }
}

@Service
public class CaseSummaryCachedReader {

    private final CaseSummaryRepository repository;

    public CaseSummaryCachedReader(CaseSummaryRepository repository) {
        this.repository = repository;
    }

    @Cacheable(
        cacheNames = "caseSummaryByTenantAndCaseId",
        key = "#tenantId + ':' + #caseId + ':' + #version"
    )
    public CaseSummaryDto getSummaryCached(String tenantId, Long caseId, long version) {
        return repository.findSummary(tenantId, caseId)
                .orElseThrow(() -> new NotFoundException("Case not found"));
    }
}
```

Versioned key reduces stale overwrite risk because updated case version changes key.

Trade-off:

1. old version entries remain until TTL eviction.
2. key cardinality increases.
3. version lookup still hits DB unless version cached separately.

Untuk correctness-critical case, trade-off ini sering lebih baik daripada stale mutation.

---

## 38. Cache Failure Strategy

Jika cache provider gagal, apa yang terjadi?

Pilihan:

### 38.1 Fail Closed

Request gagal jika cache gagal.

Cocok untuk:

1. idempotency key store.
2. rate limit enforcement.
3. distributed lock.
4. security-critical deny/allow store tertentu.

Tetapi untuk ordinary read cache, fail closed sering buruk.

### 38.2 Fail Open / Bypass Cache

Jika cache gagal, query source langsung.

Cocok untuk:

1. read-through optimization cache.
2. reference data dengan DB fallback.
3. external API cache jika fallback masih acceptable.

Risiko:

1. database spike saat Redis outage.
2. cascading failure.
3. butuh rate limiting/bulkhead.

### 38.3 Serve Stale

Jika refresh gagal, return stale value.

Cocok untuk:

1. dashboard.
2. non-critical reference data.
3. external metadata.

Tidak cocok untuk:

1. authorization.
2. financial/regulatory decision finalization.
3. workflow transition guard.

Rule:

```text
Cache failure behavior must match business criticality, not developer convenience.
```

---

## 39. Caching and Workflow/State Machine Systems

Dalam enforcement/case-management workflow, cache harus memperhatikan state transition.

Contoh state:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> CLOSED
```

Jika cache menyimpan:

```text
allowedActions(caseId, userId)
```

Maka cache bergantung pada:

1. case state.
2. user role.
3. assignment.
4. delegation.
5. deadline.
6. lock status.
7. appeal/reopen flag.
8. pending approval stage.

Key sederhana:

```text
userId:caseId
```

Tidak cukup.

Lebih benar:

```text
tenantId:userId:userPermissionVersion:caseId:caseStateVersion:assignmentVersion
```

Atau jangan cache allowed actions, tetapi hitung cepat dari compact state snapshot.

Pola yang lebih defensible:

```text
Cache read-only display projection.
Do not cache transition guard unless versioned and short-lived.
```

Karena transition guard adalah correctness gate.

---

## 40. Ringkasan Mental Model

Spring Cache harus dipahami dengan lima lapisan:

```text
1. Invocation layer
   Apakah method dipanggil melalui proxy?

2. Key layer
   Apakah key mencakup semua input dan context?

3. Value layer
   Apakah value aman, immutable, serializable, tidak bocor?

4. Freshness layer
   Apakah TTL/invalidation/transaction boundary jelas?

5. Operational layer
   Apakah metrics, failure mode, runbook, dan deployment compatibility jelas?
```

Kalau hanya layer pertama yang dipahami, caching terlihat mudah.

Kalau semua layer dipahami, caching menjadi desain consistency yang sadar risiko.

---

## 41. Latihan Praktis

### Latihan 1 — Audit Cache Key

Diberikan method:

```java
@Cacheable(cacheNames = "documents", key = "#documentId")
public DocumentDto getDocument(Long documentId) {
    User user = security.currentUser();
    return repository.findVisibleDocument(user.tenantId(), user.id(), documentId);
}
```

Tugas:

1. Identifikasi hidden context.
2. Buat key yang lebih aman.
3. Tentukan apakah caching sebaiknya dilakukan sebelum atau sesudah authorization.
4. Tentukan TTL.
5. Tentukan invalidation trigger.

### Latihan 2 — Transaction Race

Diberikan:

```java
@Transactional
@CacheEvict(cacheNames = "caseById", key = "#caseId")
public void updateStatus(Long caseId, Status status) {
    repository.updateStatus(caseId, status);
}
```

Tugas:

1. Jelaskan stale repopulation race.
2. Buat desain after-commit invalidation.
3. Buat test concurrency sederhana.

### Latihan 3 — Local vs Redis

Untuk data berikut, pilih local cache, Redis cache, atau no cache:

1. country list.
2. current user permissions.
3. case detail with confidential fields.
4. postal code lookup external API.
5. dashboard count updated every second.
6. idempotency key for payment submission.
7. allowed state transition actions.

Jelaskan trade-off.

---

## 42. Penutup Part 19

Di Part 19 ini kita membahas Spring Cache sebagai **method interception abstraction** dan **consistency design problem**.

Poin terpenting:

1. Spring Cache adalah abstraction, bukan cache provider.
2. Annotation cache bekerja via proxy.
3. Cache key harus mewakili semua input dan hidden context.
4. Tenant/user/security context harus diperlakukan sebagai bagian dari key atau boundary.
5. Cache value sebaiknya immutable DTO/projection, bukan entity.
6. Transaction boundary bisa membuat cache stale jika invalidation tidak after commit.
7. Local cache dan distributed cache punya trade-off berbeda.
8. TTL adalah freshness contract.
9. Cache search/list query jauh lebih sulit daripada by-id.
10. Authorization decision caching sangat sensitif.
11. Observability dan failure strategy wajib ada.
12. Cache yang tidak didesain dapat mempercepat data yang salah.

Part berikutnya akan membahas:

```text
20-async-scheduling-events-execution-model.md
```

Fokus berikutnya:

1. `@Async`.
2. `TaskExecutor`.
3. Thread pool tuning.
4. `@Scheduled`.
5. Application events.
6. Transactional event listener.
7. Context propagation.
8. Graceful shutdown.
9. Failure model async/scheduler/event.

---

## Referensi Resmi

- Spring Framework Reference — Cache Abstraction
- Spring Framework Reference — Declarative Annotation-based Caching
- Spring Framework Javadoc — `@Cacheable`
- Spring Boot Reference — Caching
- Spring Framework Reference — Transaction Management
- Spring Framework Reference — AOP Proxying

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./18-spring-security-application-architecture.md">⬅️ Part 18 — Spring Security Application Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./20-async-scheduling-events-execution-model.md">Part 20 — Async, Scheduling, Events, and Execution Model ➡️</a>
</div>
