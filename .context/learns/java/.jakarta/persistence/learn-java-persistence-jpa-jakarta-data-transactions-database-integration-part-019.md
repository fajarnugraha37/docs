# Part 019 — Caching: First-Level Cache, Second-Level Cache, Query Cache, External Cache

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: Java 8 hingga Java 25  
> Fokus: Java/Jakarta Persistence, Hibernate ORM, Spring Data/Jakarta Data, transaction-aware caching, dan database integration  
> Status: Part 019 dari 032

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membedakan **first-level cache**, **second-level cache**, **query cache**, **natural-id cache**, **collection cache**, dan **external cache**.
2. Menjelaskan kenapa cache pada persistence layer bukan sekadar fitur performa, tetapi juga **sumber risiko correctness**.
3. Menentukan kapan data aman di-cache dan kapan tidak boleh di-cache.
4. Mendesain cache key, cache region, TTL, eviction, invalidation, dan consistency boundary.
5. Memahami hubungan cache dengan:
   - transaction,
   - persistence context,
   - dirty checking,
   - flush,
   - commit/rollback,
   - lazy loading,
   - query projection,
   - multi-node deployment,
   - message/event/outbox,
   - read replica,
   - batch update.
6. Menghindari anti-pattern umum seperti:
   - cache entity mutable tanpa invalidation,
   - query cache untuk query highly dynamic,
   - Redis sebagai “database kedua” tanpa contract,
   - cache update sebelum transaction commit,
   - cache key tidak mengandung tenant/security scope,
   - caching data authorization-sensitive.
7. Membangun mental model production-grade untuk observability, debugging, dan failure handling cache.

---

## 2. Mental Model: Cache adalah Salinan Data dengan Kebenaran yang Bersyarat

Cache bukan “data yang lebih cepat”. Cache adalah **salinan** dari data lain.

Karena cache adalah salinan, maka pertanyaan utamanya bukan hanya:

> Apakah cache membuat aplikasi lebih cepat?

Pertanyaan yang lebih penting:

> Dalam kondisi apa salinan ini masih benar?

Sebuah cache selalu memiliki minimal empat dimensi:

| Dimensi | Pertanyaan |
|---|---|
| Source of truth | Data asli ada di mana? Database? External service? File? Computed result? |
| Scope | Cache berlaku untuk request, transaction, session, JVM, cluster, tenant, user, atau global? |
| Lifetime | Cache valid sampai kapan? Selama transaction? Selama JVM hidup? TTL 5 menit? Sampai explicit invalidation? |
| Consistency | Apakah boleh stale? Berapa lama? Stale terhadap siapa? Stale untuk use case apa? |

Di persistence layer, cache paling berbahaya ketika developer menganggap cache sebagai optimasi transparan. Dalam sistem enterprise, cache memengaruhi correctness, auditability, security, dan user trust.

Contoh sederhana:

```java
@Cacheable("application-summary")
public ApplicationSummary getSummary(UUID applicationId) {
    return repository.findSummary(applicationId);
}
```

Kelihatannya aman. Tapi pertanyaannya:

- Apakah summary mengandung status workflow?
- Apakah status bisa berubah dalam transaction lain?
- Apakah user A dan user B boleh melihat summary yang sama?
- Apakah summary mengandung field yang tergantung role?
- Apakah cache harus invalidated ketika officer assignment berubah?
- Apakah cache key mengandung tenant/agency?
- Apakah cache diisi sebelum transaction commit?
- Apakah cache masih valid setelah bulk update?

Cache yang salah bukan sekadar membuat data lama muncul. Cache yang salah bisa menyebabkan:

- user melihat data tenant lain,
- workflow transition berbasis status stale,
- approval dilakukan pada state yang sudah berubah,
- audit trail tidak sinkron dengan visible state,
- report regulatory menampilkan angka lama,
- idempotency check gagal,
- duplicate processing,
- cache stampede saat traffic tinggi,
- database tetap overload walaupun cache ada.

Mental model senior:

> Cache adalah optimization layer yang harus punya contract eksplisit: key, scope, lifetime, invalidation, consistency guarantee, dan fallback behavior.

---

## 3. Taxonomy Cache dalam Persistence Stack

Dalam Java/JPA/Hibernate/Spring/Jakarta stack, cache bisa muncul di banyak layer:

```text
HTTP Client / Browser
    |
API Gateway / CDN Cache
    |
Application Method Cache
    |   contoh: Spring Cache @Cacheable
    |
Domain/Application Cache
    |   contoh: in-memory lookup, Caffeine, Redis
    |
JPA Persistence Context / First-Level Cache
    |   scope: EntityManager / Hibernate Session
    |
Hibernate Second-Level Cache
    |   scope: EntityManagerFactory / SessionFactory
    |
Hibernate Query Cache
    |   scope: query result identifiers + timestamps
    |
Database Buffer Cache
    |   scope: database engine memory
    |
Disk / OS Cache
```

Bagian ini fokus pada layer persistence/application:

1. **First-level cache**  
   Cache wajib dan otomatis dalam persistence context.

2. **Second-level cache**  
   Cache entity/collection/natural-id lintas persistence context dalam satu `EntityManagerFactory`/`SessionFactory`.

3. **Query cache**  
   Cache hasil query, biasanya berupa list identifier/scalar result, bukan pengganti entity cache.

4. **External cache**  
   Redis, Memcached, Hazelcast, Infinispan, Caffeine, Ehcache, dan sejenisnya.

5. **Application-level computed cache**  
   Cache hasil service method, projection, aggregated dashboard, lookup reference data.

6. **Database-side cache/materialized view**  
   Bukan JPA cache, tapi sering menjadi alternatif lebih benar untuk reporting/read-heavy use case.

---

## 4. First-Level Cache: Persistence Context sebagai Identity Map

First-level cache adalah cache yang berada di dalam persistence context.

Dalam JPA/Jakarta Persistence, `EntityManager` mengelola persistence context. Persistence context menyimpan entity managed dan menjamin bahwa untuk identity yang sama dalam persistence context yang sama, aplikasi mendapatkan object instance yang sama.

Contoh:

```java
Application a1 = entityManager.find(Application.class, id);
Application a2 = entityManager.find(Application.class, id);

System.out.println(a1 == a2); // true dalam persistence context yang sama
```

Query pertama biasanya menghasilkan SQL:

```sql
select * from application where id = ?
```

Query kedua tidak perlu SQL `find()` lagi karena entity sudah ada di persistence context.

### 4.1 Apa yang Dijamin First-Level Cache?

First-level cache menjamin identity dalam scope persistence context:

```text
(Entity class, primary key) -> Java object instance
```

Artinya:

- tidak ada dua object berbeda untuk row yang sama dalam satu persistence context,
- dirty checking bisa bekerja karena provider membandingkan managed state,
- relationship navigation bisa konsisten dalam satu unit of work,
- repeated `find()` tidak selalu hit database.

### 4.2 Apa yang Tidak Dijamin First-Level Cache?

First-level cache tidak menjamin bahwa data selalu terbaru terhadap database.

Contoh:

```java
@Transactional
public void example(UUID id) {
    Application app = entityManager.find(Application.class, id);

    // Transaction lain mengubah row yang sama dan commit.

    Application again = entityManager.find(Application.class, id);
    // still same object from persistence context, not automatically refreshed
}
```

Dalam transaction yang sama, persistence context bisa tetap mengembalikan state lama.

Ini bukan bug. Ini konsekuensi identity map.

Kalau butuh reload dari database:

```java
entityManager.refresh(app);
```

Atau bersihkan context:

```java
entityManager.clear();
Application fresh = entityManager.find(Application.class, id);
```

Namun `refresh()`/`clear()` harus dipakai hati-hati karena bisa membuang perubahan managed yang belum diflush.

### 4.3 First-Level Cache dan Dirty Checking

First-level cache bukan cuma cache baca. Ia juga bagian dari dirty checking.

```java
@Transactional
public void updateTitle(UUID id, String title) {
    Application app = entityManager.find(Application.class, id);
    app.changeTitle(title);
    // tidak ada repository.save() yang wajib secara JPA murni
    // saat flush/commit, Hibernate mendeteksi perubahan dan mengirim UPDATE
}
```

Mental model:

```text
Managed entity berubah
        |
Persistence context mencatat perubahan
        |
Flush
        |
SQL UPDATE dikirim
        |
Commit
        |
Database transaction selesai
```

### 4.4 First-Level Cache dan Memory Risk

Karena semua managed entity disimpan dalam persistence context, operasi batch naif bisa membuat memory membengkak.

Contoh buruk:

```java
@Transactional
public void importRows(List<Row> rows) {
    for (Row row : rows) {
        entityManager.persist(toEntity(row));
    }
}
```

Jika `rows` berisi 500.000 data, persistence context menahan 500.000 entity managed.

Versi lebih aman:

```java
@Transactional
public void importRows(List<Row> rows) {
    int i = 0;

    for (Row row : rows) {
        entityManager.persist(toEntity(row));

        if (++i % 500 == 0) {
            entityManager.flush();
            entityManager.clear();
        }
    }
}
```

Ini sudah dibahas di Part 016, tapi penting diingat: first-level cache selalu ada dan tidak bisa diperlakukan seperti cache opsional.

---

## 5. Second-Level Cache: Cache Lintas Persistence Context

Second-level cache adalah cache yang hidup di level `EntityManagerFactory`/Hibernate `SessionFactory`, bukan di level satu transaction atau satu `EntityManager`.

Skema sederhananya:

```text
Transaction A / EntityManager A
        |
        | find(ApplicationType, 1)
        v
First-Level Cache A
        |
        | miss
        v
Second-Level Cache
        |
        | miss
        v
Database

Transaction B / EntityManager B
        |
        | find(ApplicationType, 1)
        v
First-Level Cache B
        |
        | miss
        v
Second-Level Cache
        |
        | hit
        v
No database select for entity state
```

Second-level cache umumnya cocok untuk:

- reference data,
- lookup table,
- configuration yang jarang berubah,
- master data low-write high-read,
- immutable data,
- taxonomy/code table,
- country/currency/status type,
- permission metadata yang jarang berubah tetapi perlu invalidation jelas.

Second-level cache tidak cocok secara default untuk:

- entity workflow yang sering berubah,
- case/application state,
- balance/quota/counter,
- assignment queue,
- approval state,
- user session-sensitive data,
- row dengan field authorization-sensitive,
- data yang diubah oleh banyak aplikasi tanpa coordinated invalidation,
- data yang diubah dengan bulk SQL di luar Hibernate.

### 5.1 Mengaktifkan Second-Level Cache di Hibernate

Contoh konfigurasi konseptual:

```properties
hibernate.cache.use_second_level_cache=true
hibernate.cache.region.factory_class=org.hibernate.cache.jcache.JCacheRegionFactory
hibernate.javax.cache.provider=org.ehcache.jsr107.EhcacheCachingProvider
```

Pada stack Jakarta modern, properti bisa memakai namespace `jakarta` tergantung versi provider/cache integration. Selalu cek versi Hibernate/cache provider.

Entity cacheable:

```java
@Entity
@Cacheable
@org.hibernate.annotations.Cache(
    usage = CacheConcurrencyStrategy.READ_ONLY,
    region = "reference.application-type"
)
public class ApplicationType {

    @Id
    private Long id;

    @Column(nullable = false, unique = true)
    private String code;

    @Column(nullable = false)
    private String label;

    protected ApplicationType() {}
}
```

Untuk data immutable, gunakan strategy `READ_ONLY`.

### 5.2 Cache Region

Cache region adalah namespace/bucket logical.

Contoh region:

```text
reference.application-type
reference.country
reference.currency
security.role-permission
case.application-summary
```

Region penting karena:

- eviction bisa dilakukan per region,
- metrics bisa dibaca per region,
- TTL bisa berbeda per region,
- capacity bisa berbeda per region,
- data sensitivity bisa dibedakan.

Desain region yang buruk:

```text
entities
cache
default
```

Desain region yang lebih baik:

```text
reference.application-type.v1
reference.license-category.v1
workflow.transition-rule.v3
security.permission-matrix.v2
```

Region versioning berguna saat format/value semantic berubah dan kamu ingin menghindari stale key lama.

### 5.3 Cache Concurrency Strategy

Hibernate menyediakan beberapa strategy cache concurrency. Nama dan provider support dapat berbeda tergantung versi/integration, tapi mental model utamanya:

| Strategy | Cocok untuk | Risiko |
|---|---|---|
| `READ_ONLY` | immutable/reference data | salah kalau data berubah |
| `NONSTRICT_READ_WRITE` | data jarang berubah, stale sementara acceptable | stale read mungkin terjadi |
| `READ_WRITE` | data mutable dengan coordination lebih kuat | overhead lebih tinggi |
| `TRANSACTIONAL` | cache provider yang mendukung transactional semantics | kompleks dan provider-specific |

Prinsip desain:

> Pilih strategy berdasarkan correctness requirement, bukan berdasarkan harapan performa.

Jika data tidak boleh stale, jangan langsung pakai cache. Pertimbangkan:

- index yang lebih baik,
- projection query,
- materialized view,
- denormalized read model,
- read replica,
- query optimization,
- data model redesign.

---

## 6. Collection Cache

Second-level cache bisa juga menyimpan collection association.

Contoh:

```java
@Entity
public class ApplicationType {

    @Id
    private Long id;

    @OneToMany(mappedBy = "applicationType")
    @org.hibernate.annotations.Cache(
        usage = CacheConcurrencyStrategy.READ_ONLY,
        region = "reference.application-type.required-documents"
    )
    private Set<RequiredDocumentType> requiredDocuments = new HashSet<>();
}
```

Collection cache biasanya menyimpan identifiers dari elemen collection, bukan selalu full object graph.

Mental model:

```text
Collection cache:
(ApplicationType#1.requiredDocuments) -> [DocumentType#10, DocumentType#11, DocumentType#12]

Entity cache:
DocumentType#10 -> state
DocumentType#11 -> state
DocumentType#12 -> state
```

Karena itu, collection cache sering perlu entity cache juga agar efektif.

### 6.1 Risiko Collection Cache

Collection cache berisiko jika:

- collection sering berubah,
- order berubah,
- membership berubah karena workflow,
- update dilakukan lewat native SQL/bulk update,
- association dipakai untuk authorization,
- multi-node invalidation tidak solid.

Contoh buruk:

```java
@OneToMany(mappedBy = "caseFile")
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
private List<CaseAssignment> assignments;
```

Assignment workflow biasanya berubah, sensitif, dan concurrency-heavy. Cache collection semacam ini bisa menyebabkan user melihat assignment lama.

---

## 7. Natural ID Cache

Natural id adalah business key yang stabil dan unik.

Contoh:

```java
@Entity
@org.hibernate.annotations.NaturalIdCache
public class Country {

    @Id
    private Long id;

    @org.hibernate.annotations.NaturalId
    @Column(nullable = false, unique = true)
    private String isoCode;

    private String name;
}
```

Lookup:

```java
Country country = session.byNaturalId(Country.class)
    .using("isoCode", "ID")
    .load();
```

Natural-id cache cocok untuk lookup data seperti:

- country code,
- currency code,
- application type code,
- status code,
- role code.

Namun jangan menyamakan natural id dengan arbitrary field yang kebetulan unik sekarang.

Natural id harus:

- benar-benar unik,
- relatif stabil,
- punya database unique constraint,
- tidak berubah sering,
- tidak bergantung pada user locale/label.

---

## 8. Query Cache: Cache Hasil Query, Bukan Magic Performance Button

Query cache sering disalahpahami.

Banyak developer mengira query cache menyimpan hasil final object graph. Biasanya yang disimpan adalah:

- query key,
- parameter,
- pagination info,
- result identifiers/scalar result,
- timestamp/invalidation metadata.

Untuk entity result, query cache sering perlu second-level cache agar efektif.

Contoh:

```java
List<ApplicationType> types = entityManager
    .createQuery("""
        select t
        from ApplicationType t
        where t.active = true
        order by t.displayOrder
        """, ApplicationType.class)
    .setHint("org.hibernate.cacheable", true)
    .setHint("org.hibernate.cacheRegion", "query.reference.active-application-types")
    .getResultList();
```

### 8.1 Kapan Query Cache Cocok?

Query cache cocok ketika:

- query sering dipanggil dengan parameter yang sama,
- underlying table jarang berubah,
- result set kecil/stabil,
- query mahal tetapi datanya reference-like,
- stale sementara acceptable atau invalidation jelas.

Contoh cocok:

```sql
select t from ApplicationType t where t.active = true order by t.displayOrder
```

Contoh kurang cocok:

```sql
select c from Case c
where c.assignedOfficerId = :currentOfficer
  and c.status in :statuses
  and c.updatedAt between :from and :to
order by c.priority desc, c.updatedAt asc
```

Alasannya:

- parameter highly variable,
- status/assignment sering berubah,
- result set authorization-sensitive,
- invalidation sering,
- cache churn tinggi,
- risiko stale berbahaya.

### 8.2 Query Cache dan Update Timestamp

Query cache harus tahu kapan table/region berubah. Jika table yang memengaruhi query berubah, hasil query cache perlu dianggap invalid.

Problem muncul jika data diubah di luar Hibernate:

- native SQL langsung,
- stored procedure,
- ETL,
- batch job terpisah,
- aplikasi lain,
- manual DBA script.

Jika provider tidak tahu ada perubahan, query cache bisa tetap mengembalikan hasil stale.

Karena itu:

> Query cache hanya aman jika semua mutation terhadap data yang relevan ikut dalam invalidation model yang sama.

---

## 9. External Cache: Redis, Caffeine, Ehcache, Infinispan, Hazelcast

External/application cache berada di luar persistence context.

Contoh dengan Spring Cache:

```java
@Cacheable(
    cacheNames = "application-type-by-code",
    key = "#code"
)
public ApplicationTypeDto getApplicationType(String code) {
    return repository.findDtoByCode(code)
        .orElseThrow(() -> new NotFoundException("Application type not found"));
}
```

External cache bisa menyimpan:

- DTO/projection,
- computed summary,
- lookup data,
- authorization matrix,
- rate limit counters,
- idempotency result,
- expensive external API response,
- aggregation result.

Namun external cache tidak otomatis tahu tentang JPA transaction.

### 9.1 Local In-Memory Cache vs Distributed Cache

| Jenis | Contoh | Cocok untuk | Risiko |
|---|---|---|---|
| Local in-memory | Caffeine, local Ehcache | ultra-fast lookup, per-node reference data | antar-node bisa beda |
| Distributed cache | Redis, Hazelcast, Infinispan cluster | shared cache antar-node | network latency, serialization, cluster failure |
| Hibernate L2 cache | Ehcache/Infinispan/JCache integration | entity/reference data | provider-specific semantics |
| Database materialized view | DB-native | reporting/read-heavy | refresh lag, operational cost |

Local cache lebih sederhana dan cepat, tapi invalidation multi-node sulit.

Distributed cache lebih konsisten antar-node, tapi membawa problem:

- serialization compatibility,
- network partition,
- Redis outage,
- latency spikes,
- TTL misconfiguration,
- stale key dari deploy lama,
- memory eviction policy,
- hot key,
- stampede.

### 9.2 Jangan Cache Entity Managed ke Redis

Hindari menyimpan JPA entity langsung ke external cache.

Buruk:

```java
@Cacheable("applications")
public Application getApplication(UUID id) {
    return applicationRepository.findById(id).orElseThrow();
}
```

Masalah:

- entity bisa punya lazy proxy,
- object graph bisa besar,
- serialization bermasalah,
- internal Hibernate state bisa bocor,
- detached entity dikira managed,
- field sensitif ikut tersimpan,
- stale entity bisa dipakai untuk update.

Lebih baik cache DTO/projection immutable:

```java
public record ApplicationSummaryCacheValue(
    UUID applicationId,
    String applicationNo,
    String status,
    String applicantName,
    Instant lastUpdatedAt,
    long version
) {}
```

Cache value harus:

- immutable,
- kecil,
- eksplisit field-nya,
- punya version/timestamp bila relevan,
- tidak mengandung lazy proxy,
- tidak mengandung field sensitif yang tidak perlu,
- aman untuk serialization lintas versi.

---

## 10. Transaction-Aware Caching

Salah satu failure mode paling umum:

> Cache di-update sebelum database transaction commit.

Contoh buruk:

```java
@Transactional
public void approve(UUID id) {
    Application app = repository.findById(id).orElseThrow();
    app.approve();

    cache.put(id, ApplicationSummary.from(app));

    // setelah ini commit gagal karena constraint/deadlock/timeout
}
```

Jika commit gagal, cache sudah berisi status `APPROVED`, tetapi database rollback.

Akibatnya:

```text
Database: UNDER_REVIEW
Cache   : APPROVED
```

Ini correctness bug.

### 10.1 Evict/Put Setelah Commit

Gunakan after-commit hook.

Spring example:

```java
@Transactional
public void approve(UUID id) {
    Application app = repository.findById(id).orElseThrow();
    app.approve();

    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                cache.evict("application-summary", id);
            }
        }
    );
}
```

Lebih sering, strategy aman adalah **evict after commit**, bukan put after commit.

Kenapa?

- value setelah commit lebih baik dibaca ulang dari source of truth,
- mengurangi risiko cache value dibangun dari partial object graph,
- mencegah cache menyimpan data yang tidak sesuai projection final,
- lebih aman terhadap trigger/generated column/database-side update.

Pattern:

```text
Within transaction:
    mutate database state
After commit:
    evict relevant cache keys/regions
Next read:
    rebuild cache from database
```

### 10.2 Transaction-Aware Cache Manager

Spring menyediakan cache abstraction dan mekanisme transaction-aware cache proxy. Cache abstraction sendiri menerapkan caching pada method invocation, sementara transaction-aware proxy dapat menunda operasi cache tertentu sampai transaction commit. Spring documentation menjelaskan cache abstraction sebagai cara konsisten memakai berbagai cache provider dengan impact minimal pada code, dan `TransactionAwareCacheManagerProxy` membungkus cache manager target agar operasi cache aware terhadap transaksi Spring.

Namun jangan menganggap transaction-aware cache menyelesaikan semua masalah. Ia tidak otomatis tahu:

- cache key apa saja yang harus dievict,
- query/projection mana yang terpengaruh,
- tenant/user scope,
- perubahan dari aplikasi lain,
- perubahan via native SQL/batch/stored procedure,
- semantic invalidation.

Transaction-aware hanya membantu timing; bukan desain invalidation.

---

## 11. Cache Invalidation: Masalah Utama yang Tidak Bisa Dihindari

Dua strategi dasar:

1. **Time-based invalidation**  
   TTL/expiry.

2. **Event/change-based invalidation**  
   Evict/update ketika data berubah.

Biasanya production system memakai kombinasi.

### 11.1 TTL

TTL sederhana:

```text
application-type-by-code: TTL 1 hour
application-summary: TTL 30 seconds
permission-matrix: TTL 5 minutes
```

TTL cocok jika:

- stale sementara acceptable,
- data jarang berubah,
- invalidation event sulit,
- user impact rendah.

TTL tidak cocok jika:

- security-sensitive,
- authorization-sensitive,
- financial/regulatory correctness-sensitive,
- workflow decision-sensitive,
- idempotency-sensitive.

TTL bukan correctness guarantee. TTL hanya membatasi durasi stale.

### 11.2 Explicit Eviction

Contoh:

```java
@Transactional
public void updateApplicationType(String code, UpdateApplicationTypeCommand command) {
    ApplicationType type = repository.findByCode(code).orElseThrow();
    type.update(command.label(), command.active());

    afterCommit(() -> cache.evict("application-type-by-code", code));
}
```

Masalahnya: mutation satu entity bisa memengaruhi banyak cache.

Update `ApplicationType` mungkin harus evict:

```text
application-type-by-code:<code>
active-application-types
application-form-metadata:<type>
required-document-rules:<type>
public-application-type-list
```

Karena itu, explicit eviction sebaiknya dikelola oleh domain/application event:

```java
public record ApplicationTypeChangedEvent(String code) {}
```

Lalu handler after commit:

```java
@Component
public class ApplicationTypeCacheInvalidator {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(ApplicationTypeChangedEvent event) {
        cache.evict("application-type-by-code", event.code());
        cache.evict("active-application-types", "all");
        cache.evictByPrefix("application-form-metadata:" + event.code());
    }
}
```

### 11.3 Region Eviction

Kadang lebih aman clear region daripada satu-satu key.

```java
cacheManager.getCache("reference.application-type").clear();
```

Trade-off:

- lebih aman secara correctness,
- lebih mahal setelah eviction,
- bisa menyebabkan cache stampede,
- harus dipadukan dengan jitter/prewarm/rate limiting.

### 11.4 Versioned Cache Key

Pattern:

```text
application-summary:v42:<applicationId>
```

Jika version naik, key lama otomatis tidak dipakai.

Contoh:

```java
@Cacheable(
    cacheNames = "application-summary",
    key = "#id + ':' + #version"
)
public ApplicationSummary getSummary(UUID id, long version) {
    return repository.findSummary(id);
}
```

Masalahnya: untuk tahu version, kamu mungkin tetap harus query database.

Versioned key cocok jika version sudah tersedia dari:

- request command,
- event payload,
- parent listing,
- ETag,
- metadata table,
- cache indirection.

### 11.5 Cache Aside Pattern

Cache aside adalah pattern paling umum.

```text
Read:
    get from cache
    if miss:
        read database
        put cache
    return value

Write:
    write database
    after commit evict cache
```

Pseudocode:

```java
public ApplicationSummary getSummary(UUID id) {
    ApplicationSummary cached = cache.get(id);
    if (cached != null) {
        return cached;
    }

    ApplicationSummary loaded = repository.findSummary(id).orElseThrow();
    cache.put(id, loaded);
    return loaded;
}
```

Cache aside harus memikirkan:

- cache stampede,
- negative caching,
- stale window,
- concurrent update/read race,
- serialization,
- partial failure.

---

## 12. Cache Stampede, Hot Key, dan Thundering Herd

Cache stampede terjadi ketika banyak request mendapatkan cache miss bersamaan lalu semuanya menghantam database.

Scenario:

```text
10.000 request membaca dashboard summary
cache key expired pada saat yang sama
semua request miss
semua query database
DB CPU naik
latency naik
request timeout
retry memperparah
```

Mitigasi:

1. TTL jitter.
2. Single-flight/in-flight deduplication.
3. Lock per key.
4. Soft TTL + background refresh.
5. Prewarm cache.
6. Rate limit rebuild.
7. Serve stale while revalidate jika acceptable.
8. Circuit breaker/fallback.

### 12.1 TTL Jitter

Jangan semua key expire serentak.

```java
Duration ttl = Duration.ofMinutes(10)
    .plusSeconds(ThreadLocalRandom.current().nextInt(0, 120));
```

### 12.2 Single-Flight

Hanya satu thread yang rebuild cache untuk key yang sama.

```java
private final ConcurrentHashMap<String, CompletableFuture<ApplicationSummary>> inflight = new ConcurrentHashMap<>();

public ApplicationSummary getSummary(UUID id) {
    String key = id.toString();

    ApplicationSummary cached = cache.get(key);
    if (cached != null) {
        return cached;
    }

    CompletableFuture<ApplicationSummary> future = inflight.computeIfAbsent(key, ignored ->
        CompletableFuture.supplyAsync(() -> {
            try {
                ApplicationSummary loaded = repository.findSummary(id).orElseThrow();
                cache.put(key, loaded);
                return loaded;
            } finally {
                inflight.remove(key);
            }
        })
    );

    return future.join();
}
```

Dalam produksi, implementasi perlu timeout, error handling, executor control, dan cancellation policy.

---

## 13. Negative Caching

Negative caching berarti menyimpan hasil “tidak ditemukan” untuk menghindari repeated DB hit.

Contoh:

```text
key: application-type:UNKNOWN_CODE
value: NOT_FOUND
TTL: 30 seconds
```

Cocok untuk:

- external API lookup,
- invalid code lookup,
- public endpoint yang sering dicoba bot/user,
- reference data lookup.

Risiko:

- data baru dibuat tetapi cache masih menyimpan NOT_FOUND,
- user melihat not found sementara padahal data sudah ada,
- security enumeration behavior.

TTL negative cache biasanya harus pendek.

---

## 14. Cache Key Design

Cache key adalah bagian dari correctness.

Key buruk:

```text
application-summary:123
```

Key lebih aman:

```text
tenant:<tenantId>:user-scope:<scopeHash>:application-summary:v1:<applicationId>
```

Tidak semua cache perlu user scope. Tapi cache yang hasilnya dipengaruhi authorization harus memasukkan authorization scope.

### 14.1 Apa yang Harus Masuk Cache Key?

Masukkan semua input yang memengaruhi hasil.

| Faktor | Wajib masuk key jika memengaruhi hasil? |
|---|---:|
| tenant/agency | ya |
| user role/permission | ya |
| locale/language | ya |
| timezone | ya jika formatting/period tergantung timezone |
| pagination | ya |
| sort | ya |
| filter | ya |
| feature flag | ya jika output berbeda |
| schema/cache value version | sangat disarankan |
| application version | kadang |

Contoh key untuk listing:

```text
tenant:CEA:roleHash:8f31:case-list:v2:status=OPEN,ESCALATED:page=0:size=20:sort=priority_desc_updated_asc
```

### 14.2 Key Explosion

Terlalu banyak parameter bisa menyebabkan key explosion.

Query highly dynamic dengan filter banyak biasanya tidak cocok untuk cache method-level biasa.

Alternatif:

- optimize SQL/index,
- materialized view,
- denormalized read model,
- cache partial reference data,
- cache count separately,
- use search engine/read store,
- cache only top common queries.

---

## 15. Cache Value Design

Cache value sebaiknya:

- immutable,
- serializable secara eksplisit,
- kecil,
- tidak menyimpan entity managed,
- tidak menyimpan lazy proxy,
- tidak menyimpan object graph besar,
- punya version/createdAt bila perlu,
- punya schema version,
- tidak mengandung secret/token kecuali memang cache aman dan terenkripsi,
- tidak mengandung data authorization-sensitive tanpa scope key.

Contoh:

```java
public record CachedApplicationSummary(
    int schemaVersion,
    UUID applicationId,
    String applicationNo,
    String status,
    String applicantDisplayName,
    Instant updatedAt,
    long entityVersion
) {}
```

Hindari:

```java
public class CachedApplicationSummary {
    private Application application; // buruk
    private User officer;           // buruk
    private List<Document> docs;     // buruk
}
```

---

## 16. Caching dan Authorization

Salah satu bug paling berbahaya:

> Cache value dibuat untuk user berprivilege tinggi, lalu dibaca user berprivilege rendah karena key tidak mengandung authorization scope.

Contoh buruk:

```java
@Cacheable(cacheNames = "case-detail", key = "#caseId")
public CaseDetailDto getCaseDetail(UUID caseId, UserContext user) {
    return repository.findCaseDetail(caseId, user.permissions());
}
```

Key tidak mengandung `user` atau permission scope.

Versi lebih aman:

```java
@Cacheable(
    cacheNames = "case-detail",
    key = "#user.tenantId + ':' + #user.permissionScopeHash + ':' + #caseId"
)
public CaseDetailDto getCaseDetail(UUID caseId, UserContext user) {
    return repository.findCaseDetail(caseId, user.permissions());
}
```

Namun lebih baik lagi: jangan cache full detail authorization-sensitive kecuali benar-benar perlu.

Untuk regulatory/case management systems:

- cache public/reference metadata lebih aman,
- cache user-specific detail sangat hati-hati,
- always include tenant/scope,
- avoid caching raw PII,
- define eviction on permission changes,
- define maximum TTL for role/permission cache,
- log cache hit/miss without leaking PII.

---

## 17. Caching dan Multi-Tenancy

Multi-tenant cache harus memasukkan tenant ke key atau region.

Buruk:

```text
application-type:SALESPERSON
```

Lebih aman:

```text
tenant:CEA:application-type:SALESPERSON
```

Atau region per tenant:

```text
CEA.reference.application-type
CPDS.reference.application-type
```

Namun region per tenant bisa membuat operational overhead besar jika tenant banyak.

Prinsip:

> Jika data berbeda per tenant, tenant identifier wajib menjadi bagian dari cache address.

Tenant leakage via cache adalah incident serius.

---

## 18. Caching dan Read Replica

Dalam architecture dengan primary database dan read replica:

```text
Write -> primary
Read  -> replica
Cache rebuild -> replica
```

Problem:

1. Transaction commit di primary sukses.
2. Cache dievict after commit.
3. Next read miss cache.
4. Cache rebuild dari replica yang lagging.
5. Cache menyimpan data lama.
6. Setelah replica catch up, cache tetap stale sampai TTL/evict berikutnya.

Mitigasi:

- rebuild critical cache dari primary after recent write,
- use read-your-write token,
- delay cache rebuild,
- short TTL,
- version check,
- route read after write ke primary,
- event-based cache update dari committed event,
- avoid caching critical immediately-after-write views.

---

## 19. Caching dan Bulk Update/Delete

Bulk JPQL/native update bypass persistence context dan bisa juga bypass L2/query cache invalidation secara tidak lengkap tergantung provider dan cara eksekusi.

Contoh:

```java
entityManager.createQuery("""
    update Application a
    set a.status = :expired
    where a.status = :pending
      and a.submittedAt < :cutoff
    """)
.setParameter("expired", Status.EXPIRED)
.setParameter("pending", Status.PENDING)
.setParameter("cutoff", cutoff)
.executeUpdate();
```

Setelah bulk update:

- managed entity di persistence context bisa stale,
- second-level cache untuk entity terkait harus dievict/invalidated,
- query cache yang tergantung table harus invalidated,
- external cache application-summary harus dievict,
- search index/read model mungkin harus direbuild,
- audit/outbox perlu dipikirkan.

Pattern aman:

```java
@Transactional
public int expirePendingApplications(Instant cutoff) {
    int updated = entityManager.createQuery("""
        update Application a
        set a.status = :expired
        where a.status = :pending
          and a.submittedAt < :cutoff
        """)
        .setParameter("expired", Status.EXPIRED)
        .setParameter("pending", Status.PENDING)
        .setParameter("cutoff", cutoff)
        .executeUpdate();

    entityManager.clear();

    afterCommit(() -> {
        cache.evictRegion("application-summary");
        cache.evictRegion("case-list");
    });

    return updated;
}
```

Untuk update massal, kadang lebih realistis evict region daripada key-by-key.

---

## 20. Caching dan Event/Outbox

Dalam sistem multi-service/multi-node, invalidation lokal tidak cukup.

Pattern:

```text
Transaction:
    update database
    insert outbox event ApplicationStatusChanged
Commit

Outbox publisher:
    publish ApplicationStatusChanged

Consumers:
    evict local/distributed cache
    update read model
    update search index
```

Event invalidation cocok untuk:

- multi-node cache,
- cross-service cache,
- Redis cache shared,
- local Caffeine cache per node,
- search/read model sync,
- external API cache.

Event payload minimal:

```java
public record ApplicationChangedEvent(
    UUID applicationId,
    String tenantId,
    long version,
    Instant occurredAt
) {}
```

Cache invalidator:

```java
public void on(ApplicationChangedEvent event) {
    cache.evict("application-summary", key(event.tenantId(), event.applicationId()));
    cache.evict("application-detail", key(event.tenantId(), event.applicationId()));
    cache.evictByPrefix("case-list:" + event.tenantId());
}
```

Event-driven invalidation harus idempotent.

Jika event duplicate, eviction ulang harus aman.

---

## 21. Cache dan Idempotency

Cache sering digunakan untuk idempotency result.

Contoh:

```text
idempotency:<tenantId>:<requestKey> -> response summary
TTL: 24 hours
```

Hati-hati: idempotency cache tidak boleh menggantikan durable idempotency store jika correctness penting.

Untuk payment/approval/submission/workflow:

- gunakan database table dengan unique constraint sebagai durable idempotency boundary,
- Redis/cache boleh menjadi accelerator,
- jangan bergantung hanya pada volatile cache.

Pattern aman:

```sql
create table idempotency_record (
    tenant_id varchar(64) not null,
    idempotency_key varchar(128) not null,
    request_hash varchar(128) not null,
    status varchar(32) not null,
    response_json clob,
    created_at timestamp not null,
    primary key (tenant_id, idempotency_key)
);
```

Cache bisa menyimpan read-through result, tapi database tetap source of truth.

---

## 22. Cache Consistency Models

Cache consistency tidak selalu binary fresh/stale. Ada beberapa model:

| Model | Arti | Cocok untuk |
|---|---|---|
| Strong-ish after commit | cache invalidated setelah commit | critical read, still not perfect across replicas |
| Eventual consistency | cache akan benar setelah event/TTL | dashboard, lookup, non-critical view |
| Bounded staleness | stale maksimal N detik/menit | listing, count, summary |
| Immutable | value tidak berubah | historical snapshot, code version |
| Session/request scoped | valid hanya untuk request/session | computed authorization context |
| Read-your-write | user melihat update sendiri | UX critical after mutation |

Tidak semua use case butuh strong consistency.

Tapi semua use case butuh consistency model yang disadari.

Contoh:

| Use case | Stale allowed? | Cache strategy |
|---|---:|---|
| Country list | ya, lama | L2/read-only/local cache |
| Application status after approval | hampir tidak | evict after commit, read primary |
| Dashboard count | ya, pendek | TTL + materialized read model |
| Officer assignment queue | sangat hati-hati | DB locking/query optimization, avoid cache |
| Permission matrix | terbatas | short TTL + event invalidation |
| Public FAQ metadata | ya | CDN/application cache |
| Idempotency command | tidak | DB unique constraint, cache optional |

---

## 23. Cache dan Database Constraint

Cache tidak boleh menjadi satu-satunya penjaga uniqueness/invariant.

Buruk:

```java
if (cache.get("application-no:" + no) != null) {
    throw new DuplicateException();
}
repository.save(app);
cache.put("application-no:" + no, true);
```

Race condition:

```text
T1 cache miss
T2 cache miss
T1 insert
T2 insert
```

Correctness harus di database:

```sql
alter table application add constraint uk_application_no unique (application_no);
```

Application boleh memakai cache untuk pre-check UX, tapi final boundary tetap database constraint.

---

## 24. Caching Reference Data

Reference data adalah kandidat terbaik untuk cache.

Contoh:

```java
@Entity
@Cacheable
@Cache(usage = CacheConcurrencyStrategy.READ_ONLY, region = "reference.status-type")
public class StatusType {
    @Id
    private Long id;

    @Column(nullable = false, unique = true)
    private String code;

    @Column(nullable = false)
    private String label;
}
```

Service projection cache:

```java
@Cacheable(cacheNames = "status-options", key = "#locale")
public List<OptionDto> getStatusOptions(Locale locale) {
    return statusRepository.findOptions(locale);
}
```

Checklist reference data cache:

- Apakah data immutable atau jarang berubah?
- Siapa boleh mengubahnya?
- Apakah ada admin UI?
- Apakah update harus langsung terlihat?
- Apakah label tergantung locale?
- Apakah data tenant-specific?
- Apakah cache perlu prewarm setelah deploy?
- Apakah ada version field?
- Apakah ada event invalidation saat update?

---

## 25. Caching Workflow/Case State: Biasanya Jangan Sembarangan

Workflow state sering berubah dan correctness-sensitive.

Contoh entity:

```java
@Entity
public class CaseFile {
    @Id
    private UUID id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    private UUID assignedOfficerId;
}
```

Caching `CaseFile` sebagai entity/detail berisiko karena:

- status berubah,
- assignment berubah,
- permission tergantung status/assignment,
- optimistic version penting,
- command harus membaca fresh state,
- audit harus konsisten,
- list queue harus akurat.

Lebih aman:

- command path membaca database primary dengan locking/version check,
- read path memakai projection cache dengan TTL pendek bila acceptable,
- listing queue tidak dicache atau pakai specialized read model,
- dashboard count boleh eventual consistent.

Prinsip:

> Jangan gunakan cache sebagai dasar keputusan state transition kecuali cache memiliki correctness guarantee yang setara database.

---

## 26. Cache dan Query Plan: Jangan Cache untuk Menutupi Query Buruk

Cache sering dipakai untuk menyembunyikan query buruk.

Gejala:

- query tanpa index,
- N+1,
- over-fetching entity graph,
- pagination offset dalam table besar,
- count query mahal,
- function pada indexed column,
- filter highly dynamic,
- OR condition tidak terindeks,
- join terlalu banyak,
- mapping salah.

Cache bisa menurunkan load rata-rata, tapi saat cache miss atau invalidation, query buruk tetap muncul.

Urutan engineering yang lebih sehat:

1. Pastikan query benar.
2. Pastikan index benar.
3. Pastikan projection tepat.
4. Pastikan pagination strategy tepat.
5. Pastikan transaction/lock behavior benar.
6. Baru pertimbangkan cache.

Cache bukan pengganti data access design.

---

## 27. Hibernate L2 Cache vs Spring Cache vs Redis: Pilih yang Mana?

| Kebutuhan | Pilihan yang sering cocok |
|---|---|
| Cache entity reference data | Hibernate second-level cache |
| Cache collection reference data | Hibernate collection cache, hati-hati |
| Cache method result/projection | Spring Cache / Caffeine / Redis |
| Cache shared antar node | Redis / Hazelcast / Infinispan |
| Cache local ultra-fast lookup | Caffeine |
| Cache query entity list | Hibernate query cache hanya untuk query stabil |
| Cache dashboard/report | materialized view/read model + TTL cache |
| Cache idempotency critical | database table + optional cache |
| Cache authorization matrix | short TTL + event invalidation + tenant/scope key |

### 27.1 Rule of Thumb

- Cache **entity mutable**: default no.
- Cache **reference immutable**: yes.
- Cache **query highly dynamic**: default no.
- Cache **projection stable**: maybe.
- Cache **authorization-sensitive result**: only with explicit scope key and TTL/invalidation.
- Cache **command decision state**: generally no.
- Cache **dashboard eventual**: yes with bounded staleness.
- Cache **external API response**: yes with TTL, retry, and fallback.

---

## 28. Configuration Example: Hibernate + JCache Conceptual

Gradle dependencies tergantung versi. Secara konseptual:

```kotlin
dependencies {
    implementation("org.hibernate.orm:hibernate-core")
    implementation("org.hibernate.orm:hibernate-jcache")
    implementation("org.ehcache:ehcache")
}
```

Properties:

```properties
hibernate.cache.use_second_level_cache=true
hibernate.cache.use_query_cache=true
hibernate.cache.region.factory_class=jcache
hibernate.javax.cache.uri=ehcache.xml
hibernate.generate_statistics=true
```

Entity:

```java
@Entity
@Cacheable
@org.hibernate.annotations.Cache(
    usage = CacheConcurrencyStrategy.READ_ONLY,
    region = "reference.application-type"
)
public class ApplicationType {
    @Id
    private Long id;

    @Column(nullable = false, unique = true)
    private String code;

    @Column(nullable = false)
    private String label;
}
```

Query:

```java
public List<ApplicationType> findActiveTypes() {
    return entityManager.createQuery("""
        select t
        from ApplicationType t
        where t.active = true
        order by t.displayOrder
        """, ApplicationType.class)
        .setHint("org.hibernate.cacheable", true)
        .setHint("org.hibernate.cacheRegion", "query.reference.active-application-types")
        .getResultList();
}
```

Catatan penting:

- Properti cache berbeda antar versi/provider.
- Jakarta namespace dapat berbeda dari Javax namespace tergantung library.
- Jangan copy konfigurasi tanpa cek dokumentasi versi Hibernate/cache provider yang dipakai.
- Hibernate 7 memiliki perubahan perilaku tertentu, termasuk catatan migration bahwa `StatelessSession` kini memakai second-level cache secara default kecuali `CacheMode.IGNORE` digunakan.

---

## 29. Spring Cache Example: DTO Cache dengan After-Commit Eviction

DTO:

```java
public record ApplicationTypeOption(
    String code,
    String label,
    int displayOrder
) {}
```

Read service:

```java
@Service
public class ApplicationTypeQueryService {

    private final ApplicationTypeRepository repository;

    public ApplicationTypeQueryService(ApplicationTypeRepository repository) {
        this.repository = repository;
    }

    @Cacheable(cacheNames = "application-type-options", key = "#locale.toLanguageTag()")
    public List<ApplicationTypeOption> getOptions(Locale locale) {
        return repository.findOptions(locale);
    }
}
```

Write service:

```java
@Service
public class ApplicationTypeCommandService {

    private final ApplicationTypeRepository repository;
    private final CacheManager cacheManager;

    public ApplicationTypeCommandService(
        ApplicationTypeRepository repository,
        CacheManager cacheManager
    ) {
        this.repository = repository;
        this.cacheManager = cacheManager;
    }

    @Transactional
    public void rename(String code, String newLabel) {
        ApplicationType type = repository.findByCode(code)
            .orElseThrow(() -> new NotFoundException("Application type not found"));

        type.rename(newLabel);

        TransactionSynchronizationManager.registerSynchronization(
            new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    Cache cache = cacheManager.getCache("application-type-options");
                    if (cache != null) {
                        cache.clear();
                    }
                }
            }
        );
    }
}
```

Kenapa clear region?

Karena label bisa muncul di semua locale/list. Jika key spesifik sulit dipastikan, region eviction lebih aman.

---

## 30. Observability: Cache Harus Terukur

Cache tanpa metrics adalah blind optimization.

Metrics minimum:

| Metric | Kenapa penting |
|---|---|
| hit count/rate | apakah cache efektif? |
| miss count/rate | apakah DB tetap kena load? |
| put count | apakah churn tinggi? |
| eviction count | apakah capacity kurang? |
| load time | apakah rebuild mahal? |
| load failure | apakah fallback sering gagal? |
| entry count/size | apakah memory membengkak? |
| stale detection count | apakah consistency problem muncul? |
| cache timeout | apakah Redis/cache provider bottleneck? |
| serialization error | apakah schema/value berubah? |

Untuk Hibernate, aktifkan statistics dengan hati-hati di environment yang tepat:

```properties
hibernate.generate_statistics=true
```

Metrics yang relevan:

- second-level cache hit count,
- second-level cache miss count,
- second-level cache put count,
- query cache hit/miss/put,
- entity load/fetch count,
- collection fetch count.

Spring/Redis metrics:

- Redis latency,
- command rate,
- memory usage,
- evicted keys,
- expired keys,
- keyspace hit/miss,
- connection pool,
- timeout,
- cluster failover.

### 30.1 Log yang Berguna

Log cache jangan terlalu verbose, tapi untuk debugging:

```text
cache=application-summary action=miss keyHash=abc123 tenant=CEA durationMs=42
cache=application-summary action=hit keyHash=abc123 tenant=CEA ageMs=1200
cache=application-summary action=evict keyHash=abc123 reason=ApplicationChangedEvent version=91
```

Jangan log raw key jika mengandung PII.

Gunakan hash/safe structured logging.

---

## 31. Failure Modes Produksi

### 31.1 Stale Cache Setelah Rollback

Penyebab:

- cache put sebelum commit.

Mitigasi:

- after-commit eviction,
- transaction-aware cache,
- outbox event setelah commit.

### 31.2 Tenant Data Leak

Penyebab:

- key tidak mengandung tenant.

Mitigasi:

- tenant mandatory in key builder,
- automated test,
- code review checklist,
- avoid manual string key scattered.

### 31.3 Authorization Leak

Penyebab:

- key tidak mengandung permission/user scope,
- cache full detail dari user privileged.

Mitigasi:

- scope hash,
- do not cache sensitive detail,
- short TTL,
- permission change eviction.

### 31.4 Cache Stampede

Penyebab:

- popular key expired serentak.

Mitigasi:

- jitter,
- single-flight,
- stale-while-revalidate,
- prewarm,
- rate limit rebuild.

### 31.5 Redis Outage Melumpuhkan Aplikasi

Penyebab:

- cache diperlakukan sebagai mandatory untuk non-critical read,
- timeout terlalu panjang,
- no fallback.

Mitigasi:

- small timeout,
- fallback to DB for non-critical cache,
- circuit breaker,
- degrade gracefully,
- separate critical vs optional cache.

### 31.6 Cache Memory Explosion

Penyebab:

- key explosion,
- no TTL,
- caching large object graph,
- unbounded local cache.

Mitigasi:

- max size,
- TTL,
- value size limit,
- cache admission policy,
- metrics/alert.

### 31.7 Query Cache Tidak Efektif

Penyebab:

- dynamic query parameters,
- high invalidation rate,
- no L2 cache for entity result,
- result set large.

Mitigasi:

- disable query cache,
- use projection/read model,
- optimize query/index.

### 31.8 Bulk Update Membuat Cache Salah

Penyebab:

- bulk SQL bypass invalidation.

Mitigasi:

- explicit region eviction after commit,
- event invalidation,
- avoid L2 cache for bulk-mutated entity.

### 31.9 Serialization Compatibility Break

Penyebab:

- cache value class berubah saat deploy rolling.

Mitigasi:

- schema version in value/key,
- JSON stable format,
- backward-compatible deserializer,
- region versioning.

---

## 32. Design Pattern: Centralized Cache Key Builder

Jangan sebar string key manual.

```java
public final class CacheKeys {

    private CacheKeys() {}

    public static String applicationSummary(String tenantId, UUID applicationId) {
        return "tenant:%s:application-summary:v1:%s".formatted(tenantId, applicationId);
    }

    public static String caseDetail(String tenantId, String permissionScopeHash, UUID caseId) {
        return "tenant:%s:scope:%s:case-detail:v2:%s"
            .formatted(tenantId, permissionScopeHash, caseId);
    }

    public static String referenceOptions(String tenantId, String locale, String type) {
        return "tenant:%s:reference-options:v1:%s:%s"
            .formatted(tenantId, locale, type);
    }
}
```

Keuntungan:

- konsisten,
- tenant/scope tidak terlupa,
- mudah versioning,
- mudah test,
- mudah audit.

Test:

```java
class CacheKeysTest {

    @Test
    void applicationSummaryKeyContainsTenantAndVersion() {
        String key = CacheKeys.applicationSummary("CEA", UUID.fromString("00000000-0000-0000-0000-000000000001"));

        assertThat(key).contains("tenant:CEA");
        assertThat(key).contains("application-summary:v1");
    }
}
```

---

## 33. Design Pattern: Cache Policy per Use Case

Buat policy eksplisit.

```java
public enum CacheConsistency {
    STRONG_AFTER_COMMIT,
    BOUNDED_STALE,
    EVENTUAL,
    IMMUTABLE,
    NO_CACHE
}
```

Dokumentasi policy:

| Use case | Cache | Key scope | TTL | Invalidation | Consistency |
|---|---|---|---:|---|---|
| application type options | yes | tenant+locale | 1h | admin update event | bounded stale |
| case detail | maybe | tenant+permission+caseId | 30s | case changed event | bounded stale |
| approve command read | no | n/a | n/a | n/a | database current |
| dashboard count | yes | tenant+role | 1m | scheduled/event | eventual |
| idempotency command | DB primary | tenant+key | durable | DB constraint | strong |

Cache policy table seperti ini jauh lebih berguna daripada annotation scattered.

---

## 34. Design Pattern: Read Model + Cache

Untuk dashboard/reporting, sering lebih baik membuat read model.

```text
Write model tables:
    application
    case_file
    assignment
    audit_trail

Read model table/materialized view:
    officer_workload_summary

Cache:
    officer-workload-summary:<tenant>:<officerId>
```

Update read model:

- via transaction langsung,
- via outbox event,
- via CDC,
- via scheduled refresh,
- via materialized view refresh.

Cache di atas read model lebih stabil daripada cache query join kompleks langsung dari write model.

---

## 35. Case Study: Application Type Reference Data

### 35.1 Requirement

- Application type list sering dibaca oleh UI.
- Data jarang berubah.
- Admin dapat mengubah label/display order.
- Per tenant bisa berbeda.
- UI butuh locale.
- Stale maksimal 5 menit acceptable, tapi setelah admin update sebaiknya cepat berubah.

### 35.2 Design

Cache key:

```text
tenant:<tenantId>:application-type-options:v1:locale:<locale>
```

TTL:

```text
5–10 minutes with jitter
```

Invalidation:

```text
After commit admin update -> evict tenant region/prefix
```

Source of truth:

```text
application_type table
```

Value:

```java
public record ApplicationTypeOptionCacheValue(
    String code,
    String label,
    int displayOrder
) {}
```

### 35.3 Why This Works

- reference data low-write high-read,
- stale bounded acceptable,
- tenant+locale in key,
- DTO immutable,
- invalidation after commit,
- no entity/lazy proxy cached.

---

## 36. Case Study: Case Approval Command

### 36.1 Requirement

- Officer approves a case.
- Must verify current status.
- Must prevent double approval.
- Must write audit trail.
- Must publish event after commit.

### 36.2 Wrong Design

```java
@Cacheable("case-state")
public CaseState getCaseState(UUID caseId) {
    return repository.findState(caseId);
}

@Transactional
public void approve(UUID caseId) {
    CaseState state = getCaseState(caseId);
    if (!state.status().equals("UNDER_REVIEW")) {
        throw new InvalidTransitionException();
    }

    repository.approve(caseId);
}
```

Bug:

- decision based on cached state,
- stale state can approve invalid transition,
- no version check,
- no atomic state transition.

### 36.3 Better Design

```java
@Transactional
public void approve(UUID caseId, long expectedVersion, UserContext user) {
    int updated = entityManager.createQuery("""
        update CaseFile c
        set c.status = :approved,
            c.version = c.version + 1,
            c.approvedBy = :userId,
            c.approvedAt = :now
        where c.id = :caseId
          and c.status = :underReview
          and c.version = :expectedVersion
        """)
        .setParameter("approved", CaseStatus.APPROVED)
        .setParameter("underReview", CaseStatus.UNDER_REVIEW)
        .setParameter("expectedVersion", expectedVersion)
        .setParameter("userId", user.userId())
        .setParameter("now", Instant.now())
        .setParameter("caseId", caseId)
        .executeUpdate();

    if (updated != 1) {
        throw new OptimisticConflictException("Case has changed");
    }

    auditRepository.insertApprovalAudit(caseId, user.userId());
    outboxRepository.insert(new CaseApprovedEvent(caseId, user.tenantId()));

    afterCommit(() -> cache.evict("case-detail", CacheKeys.caseDetailPrefix(user.tenantId(), caseId)));
}
```

Command correctness dari database condition, bukan cache.

Cache hanya untuk read path dan dievict setelah commit.

---

## 37. Testing Cache Correctness

Test cache tidak cukup dengan “hit/miss”. Test juga harus memeriksa stale behavior.

### 37.1 Test After Commit Eviction

```java
@Test
void shouldEvictCacheOnlyAfterCommit() {
    // arrange existing cache value
    cache.put(key, oldValue);

    // act successful transaction
    service.updateApplicationType(code, "New Label");

    // assert cache evicted
    assertThat(cache.get(key)).isNull();
}
```

### 37.2 Test Rollback Does Not Evict/Put Wrong Value

```java
@Test
void shouldNotPublishNewCacheValueWhenTransactionRollsBack() {
    cache.put(key, oldValue);

    assertThatThrownBy(() -> service.updateThenFail(code))
        .isInstanceOf(RuntimeException.class);

    assertThat(cache.get(key)).isEqualTo(oldValue);
}
```

### 37.3 Test Tenant Isolation

```java
@Test
void cacheKeyMustContainTenant() {
    String keyA = CacheKeys.applicationSummary("TENANT_A", id);
    String keyB = CacheKeys.applicationSummary("TENANT_B", id);

    assertThat(keyA).isNotEqualTo(keyB);
}
```

### 37.4 Test Permission Scope Isolation

```java
@Test
void caseDetailKeyMustContainPermissionScope() {
    String officerKey = CacheKeys.caseDetail("CEA", "officer-scope", caseId);
    String adminKey = CacheKeys.caseDetail("CEA", "admin-scope", caseId);

    assertThat(officerKey).isNotEqualTo(adminKey);
}
```

### 37.5 Test Bulk Update Evicts Region

```java
@Test
void bulkExpireShouldEvictApplicationSummaryRegion() {
    batchService.expirePendingApplications(cutoff);

    verify(cacheInvalidator).evictRegionAfterCommit("application-summary");
}
```

---

## 38. Checklist Desain Cache

Sebelum menambahkan cache, jawab pertanyaan ini:

### 38.1 Data dan Correctness

- Apa source of truth?
- Apakah data mutable?
- Siapa yang bisa mengubah data?
- Apakah data bisa berubah dari aplikasi lain/batch/native SQL?
- Apakah stale data acceptable?
- Berapa batas stale yang acceptable?
- Apakah data dipakai untuk command decision?
- Apakah data authorization-sensitive?
- Apakah data tenant-specific?
- Apakah mengandung PII/secret?

### 38.2 Key dan Value

- Apakah key mengandung tenant?
- Apakah key mengandung permission scope jika perlu?
- Apakah key mengandung locale/timezone/filter/sort/page jika memengaruhi output?
- Apakah ada schema/cache version?
- Apakah value immutable?
- Apakah value kecil?
- Apakah value bebas dari entity/lazy proxy?
- Apakah serialization compatible across rolling deployment?

### 38.3 Lifetime dan Invalidation

- TTL berapa?
- Apakah perlu jitter?
- Apakah ada explicit invalidation?
- Apakah eviction dilakukan after commit?
- Apakah mutation event/outbox diperlukan?
- Apakah region eviction lebih aman daripada key eviction?
- Apakah permission/tenant update menghapus cache terkait?

### 38.4 Operational

- Apa metrics cache?
- Apa alert hit rate drop?
- Apa fallback saat cache down?
- Apa timeout cache provider?
- Apakah ada stampede protection?
- Apakah ada max size/memory limit?
- Apakah ada observability per region?
- Bagaimana debug stale cache incident?

---

## 39. Anti-Pattern

### Anti-Pattern 1 — Cache Semua Entity

```java
@Cacheable("everything")
public Application find(UUID id) {
    return repository.findById(id).orElseThrow();
}
```

Masalah:

- entity mutable,
- lazy proxy,
- stale update,
- serialization,
- security leak,
- accidental detached update.

### Anti-Pattern 2 — Cache Query Dinamis

```java
@Cacheable("search")
public Page<CaseDto> search(CaseSearchCriteria criteria) {
    return repository.search(criteria);
}
```

Jika criteria sangat variatif, cache hanya jadi memory sink.

### Anti-Pattern 3 — Cache Put Sebelum Commit

```java
cache.put(key, newValue);
repository.save(entity);
```

Jika transaction rollback, cache salah.

### Anti-Pattern 4 — TTL sebagai Pengganti Invalidation untuk Critical Data

```text
status cache TTL 10 minutes
```

Untuk workflow status critical, 10 menit stale bisa fatal.

### Anti-Pattern 5 — Redis Menjadi Source of Truth Diam-Diam

```java
redis.increment("quota:" + officerId);
```

Tanpa durable DB invariant, restart/eviction/failover bisa merusak correctness.

### Anti-Pattern 6 — Key Tidak Mengandung Tenant

```text
case-detail:<caseId>
```

Dalam multi-tenant system, ini bug serius.

### Anti-Pattern 7 — Cache untuk Menutupi N+1

Jika query entity buruk, perbaiki fetch/projection/index dulu.

---

## 40. Latihan / Scenario

### Scenario 1 — Reference Data

Ada table `license_type` yang berubah maksimal 1 kali per bulan. UI membaca list ini di hampir semua page.

Rancang:

- cache layer,
- key,
- TTL,
- invalidation,
- value object,
- metrics,
- test.

### Scenario 2 — Permission Matrix

Role-permission matrix berubah saat admin security update. Perubahan harus terlihat maksimal 1 menit.

Rancang cache dengan:

- tenant scope,
- role scope,
- TTL,
- event invalidation,
- fallback saat Redis down.

### Scenario 3 — Case Detail

Case detail mengandung PII dan field yang berbeda berdasarkan role officer/admin/viewer.

Putuskan:

- apakah boleh cache?
- jika ya, apa key-nya?
- TTL berapa?
- invalidation event apa?
- field apa yang tidak boleh masuk cache?

### Scenario 4 — Batch Expire Application

Batch job mengubah 100.000 application dari `PENDING` ke `EXPIRED`.

Jelaskan:

- cache apa saja yang harus dihapus,
- kapan eviction dilakukan,
- apakah key-by-key atau region eviction,
- bagaimana mencegah stampede setelah eviction.

### Scenario 5 — Read Replica Lag

Setelah approval, user langsung membuka detail application. Cache miss lalu rebuild dari read replica yang lagging 5 detik.

Rancang solusi agar user melihat status terbaru.

---

## 41. Ringkasan

Cache dalam persistence stack memiliki beberapa level:

1. **First-level cache** selalu ada dalam persistence context dan menjamin identity per `EntityManager`.
2. **Second-level cache** bisa menyimpan entity/collection/natural-id lintas persistence context, tetapi cocok terutama untuk data immutable atau jarang berubah.
3. **Query cache** menyimpan hasil query dan hanya efektif untuk query stabil dengan invalidation yang jelas.
4. **External cache** seperti Redis/Caffeine/Spring Cache cocok untuk DTO/projection/computed value, bukan entity managed.
5. Cache correctness bergantung pada key, scope, lifetime, invalidation, transaction timing, dan source of truth.
6. Cache update/eviction harus memperhatikan transaction commit/rollback.
7. TTL membatasi stale window, tetapi tidak menggantikan correctness guarantee.
8. Cache key harus mengandung tenant, permission scope, locale, filter, pagination, dan semua faktor yang memengaruhi output.
9. Cache tidak boleh menjadi penjaga utama invariant; database constraint tetap final boundary.
10. Untuk workflow/case management, command path sebaiknya membaca database fresh dengan version/lock/conditional update; cache lebih cocok untuk read path yang stale-nya acceptable.

Mental model akhir:

> Cache bukan fitur performa yang ditempel belakangan. Cache adalah distributed correctness problem yang harus didesain bersama transaction, invalidation, authorization, tenant isolation, observability, dan failure handling.

---

## 42. Koneksi ke Part Berikutnya

Part ini menutup pembahasan cache sebagai bagian dari advanced persistence. Bagian berikutnya akan masuk ke mapping yang lebih kompleks:

```text
Part 020 — Advanced Mapping: Inheritance, Polymorphism, JSON, LOB, Custom Types
```

Di sana kita akan membahas kapan inheritance mapping berguna atau merusak query, bagaimana memetakan JSON/LOB/custom type, bagaimana menangani encrypted/masked field, dan bagaimana memilih mapping yang aman untuk data besar serta sistem enterprise.

---

## 43. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Selesai: Part 000 sampai Part 019
Berikutnya: Part 020
Total rencana: Part 000 sampai Part 032
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 018 — Constraints, Invariants, and Validation Across Layers](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 020 — Advanced Mapping: Inheritance, Polymorphism, JSON, LOB, Custom Types](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-020.md)
