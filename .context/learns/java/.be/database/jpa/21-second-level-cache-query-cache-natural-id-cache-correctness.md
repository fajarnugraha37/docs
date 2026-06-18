# Part 21 — Second-Level Cache, Query Cache, Natural ID Cache, and Cache Correctness

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Part: 21 dari 34  
> Target: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4  
> Fokus: cache bukan hanya performance feature, tetapi consistency boundary yang bisa mempercepat sistem atau merusak correctness secara diam-diam.

---

## 1. Why This Matters

Caching di ORM sering dipahami terlalu dangkal:

> “Aktifkan second-level cache supaya query lebih cepat.”

Itu framing yang berbahaya.

Dalam ORM, cache bukan sekadar tempat menyimpan hasil query. Cache ikut memengaruhi:

- object identity;
- read consistency;
- stale data risk;
- transaction visibility;
- invalidation strategy;
- cluster behavior;
- memory pressure;
- query correctness;
- multi-tenancy isolation;
- auditability;
- failure diagnosis.

Top-level persistence engineer harus bisa menjawab pertanyaan seperti:

1. Data apa yang aman di-cache?
2. Apakah cache menyimpan entity, collection, natural-id mapping, atau query result?
3. Apakah cache menyimpan object instance, disassembled state, primary key list, atau snapshot?
4. Kapan cache di-invalidate?
5. Apakah update dari aplikasi lain terlihat?
6. Apakah query cache aman untuk query dengan filter tenant/security?
7. Bagaimana cache berinteraksi dengan transaction isolation database?
8. Bagaimana cache berperilaku di cluster?
9. Apa dampaknya terhadap memory, GC, dan stale read?
10. Bagaimana membuktikan cache benar, bukan hanya cepat?

Part ini membangun mental model tersebut.

---

## 2. Core Mental Model

### 2.1 ORM cache bukan satu cache

Dalam ORM biasanya ada beberapa layer cache:

```text
Application Request
      |
      v
EntityManager / Hibernate Session
      |
      |-- First-Level Cache / Persistence Context
      |
      v
Second-Level Cache / Shared Cache
      |
      |-- Entity Cache
      |-- Collection Cache
      |-- Natural ID Cache
      |-- Query Cache
      |
      v
Database
```

Masing-masing layer menjawab pertanyaan berbeda.

| Cache | Scope | Umur | Tujuan utama | Risiko utama |
|---|---:|---:|---|---|
| First-level cache | `EntityManager` / `Session` | per transaction/request/unit-of-work | identity map, dirty checking, repeatable object identity | memory bloat, stale within long PC |
| Second-level entity cache | `EntityManagerFactory` / `SessionFactory` | lintas transaction | reuse entity state by id | stale data, invalidation error |
| Collection cache | factory-level | lintas transaction | cache association membership | stale collection membership |
| Query cache | factory-level | lintas transaction | cache query result identifiers/scalars | invalid result set, filter/tenant leakage |
| Natural ID cache | factory-level | lintas transaction | map business key ke PK | stale natural key mapping |

Hal penting: **first-level cache selalu ada** dalam JPA provider karena persistence context adalah core semantics. Second-level cache adalah optional/configurable.

---

### 2.2 First-level cache adalah correctness mechanism

First-level cache bukan feature performance opsional. Ia menjaga invariant:

> Dalam satu persistence context, satu database row harus direpresentasikan oleh satu managed entity instance.

Contoh:

```java
Order a = em.find(Order.class, 10L);
Order b = em.find(Order.class, 10L);

assert a == b; // true dalam persistence context yang sama
```

Tanpa invariant ini, dirty checking, cascade, association synchronization, dan flush ordering akan kacau.

---

### 2.3 Second-level cache adalah shared state optimization

Second-level cache berbeda:

```text
Transaction A loads Product#1
        |
        v
Entity state stored in shared cache
        |
        v
Transaction B later loads Product#1
        |
        v
Provider may hydrate from cache instead of database
```

Second-level cache biasanya menyimpan **disassembled entity state**, bukan managed object Java yang sama. Saat entity diambil dari second-level cache, provider tetap membuat/menempatkan instance managed baru ke persistence context transaksi saat itu.

Jadi:

```text
L2 cache stores state
L1 cache stores managed entity instance
```

---

### 2.4 Query cache bukan entity cache

Query cache sering paling disalahpahami.

Query cache tidak selalu menyimpan seluruh entity object. Pada Hibernate, query cache secara konseptual lebih sering menyimpan:

- query key;
- parameter values;
- pagination info;
- result identifiers;
- scalar result;
- timestamp dependency information.

Untuk query entity:

```java
List<Product> products = em.createQuery("""
    select p from Product p
    where p.category = :category
    order by p.name
""", Product.class)
.setParameter("category", "BOOK")
.getResultList();
```

Query cache dapat menyimpan daftar ID seperti:

```text
queryKey(category=BOOK, order=name) -> [101, 105, 109, 120]
```

Lalu entity `Product#101`, `Product#105`, dan seterusnya diambil dari second-level entity cache atau database.

Konsekuensi:

> Query cache tanpa entity cache sering tidak memberikan manfaat besar, karena result ID cache tetap perlu load entity satu per satu.

---

### 2.5 Cache correctness lebih penting dari cache hit ratio

Cache hit ratio tinggi tidak selalu baik.

Cache bisa punya hit ratio tinggi tetapi salah jika:

- tenant filter tidak masuk query key;
- soft-delete update tidak meng-invalidate query result;
- external writer mengubah database tanpa cache eviction;
- collection membership berubah tapi collection cache tidak invalid;
- natural ID berubah tapi natural ID cache stale;
- cache region dipakai untuk mutable hot data;
- stale read melanggar workflow invariant.

Cache yang benar harus menjawab:

```text
Can this cached answer still be treated as a valid answer under our consistency requirement?
```

Bukan hanya:

```text
Did cache return something quickly?
```

---

## 3. Specification-Level Concept

### 3.1 JPA/Jakarta Persistence shared cache

JPA 2.0 memperkenalkan konsep shared cache/second-level cache pada level specification. Jakarta Persistence 3.x tetap mempertahankan konsep ini dalam namespace `jakarta.persistence`.

Specification menyediakan standard control seperti:

- `SharedCacheMode`;
- `@Cacheable`;
- `Cache` API;
- `CacheRetrieveMode`;
- `CacheStoreMode`;
- persistence unit property untuk retrieve/store mode.

Namun specification tidak menstandarkan banyak detail penting seperti:

- implementasi cache provider;
- eviction algorithm;
- exact invalidation mechanics;
- distributed cache protocol;
- query cache behavior;
- natural ID cache;
- provider-specific cache concurrency strategy;
- cluster consistency guarantee.

Artinya:

> JPA memberikan abstraction untuk shared cache, tetapi correctness nyata ditentukan oleh provider dan cache implementation.

---

### 3.2 `SharedCacheMode`

`SharedCacheMode` mengatur entity mana yang eligible untuk shared cache.

Mode umum:

| Mode | Makna |
|---|---|
| `ALL` | Semua entity cacheable kecuali dikecualikan provider/annotation tertentu |
| `NONE` | Tidak ada entity yang menggunakan shared cache |
| `ENABLE_SELECTIVE` | Hanya entity dengan `@Cacheable(true)` yang cacheable |
| `DISABLE_SELECTIVE` | Semua entity cacheable kecuali `@Cacheable(false)` |
| `UNSPECIFIED` | Provider default |

Contoh `persistence.xml` modern:

```xml
<persistence-unit name="appPU">
    <shared-cache-mode>ENABLE_SELECTIVE</shared-cache-mode>
</persistence-unit>
```

Untuk sistem enterprise, default yang defensible biasanya:

```text
ENABLE_SELECTIVE
```

Kenapa?

Karena cache harus opt-in. Entity yang di-cache harus dipilih berdasarkan data volatility dan correctness requirement.

---

### 3.3 `@Cacheable`

Contoh:

```java
@Entity
@Cacheable(true)
public class CountryReference {
    @Id
    private String code;

    private String name;
}
```

`@Cacheable` hanya standard hint bahwa entity eligible untuk shared cache. Provider tetap punya extension lebih detail.

Hibernate biasanya butuh konfigurasi tambahan seperti `@org.hibernate.annotations.Cache` untuk menentukan strategy/region.

EclipseLink punya annotation/config sendiri seperti `@Cache` untuk mengatur type, isolation, expiry, dan sebagainya.

---

### 3.4 JPA `Cache` API

JPA menyediakan API:

```java
Cache cache = emf.getCache();

boolean contained = cache.contains(Product.class, 10L);
cache.evict(Product.class, 10L);
cache.evict(Product.class);
cache.evictAll();
```

Ini berguna untuk:

- manual eviction setelah external update;
- test setup;
- admin operation;
- emergency mitigation.

Namun API ini terbatas. Ia tidak mengekspose semua provider-level region/query/natural-id cache behavior.

---

### 3.5 `CacheRetrieveMode` dan `CacheStoreMode`

JPA menyediakan per-operation cache mode.

`CacheRetrieveMode`:

| Mode | Makna |
|---|---|
| `USE` | Boleh retrieve dari cache |
| `BYPASS` | Jangan retrieve dari cache; baca database |

`CacheStoreMode`:

| Mode | Makna |
|---|---|
| `USE` | Boleh store/update cache |
| `BYPASS` | Jangan store ke cache |
| `REFRESH` | Refresh cache dari database |

Contoh:

```java
Map<String, Object> hints = Map.of(
    "jakarta.persistence.cache.retrieveMode", CacheRetrieveMode.BYPASS,
    "jakarta.persistence.cache.storeMode", CacheStoreMode.REFRESH
);

Product product = em.find(Product.class, 10L, hints);
```

Use case:

- force fresh read setelah external update;
- avoid polluting cache pada batch scan;
- refresh reference data;
- diagnose stale cache issue.

---

## 4. Hibernate Behavior

### 4.1 Hibernate cache architecture

Hibernate membedakan:

```text
Session / PersistenceContext
    first-level cache

SessionFactory
    second-level cache regions
        entity regions
        collection regions
        natural-id regions
        query result regions
        update timestamp region
```

Second-level cache tidak aktif penuh hanya karena dependency cache provider ada. Biasanya butuh property seperti:

```properties
hibernate.cache.use_second_level_cache=true
hibernate.cache.region.factory_class=...
```

Untuk query cache:

```properties
hibernate.cache.use_query_cache=true
```

Dan per query:

```java
query.setHint("org.hibernate.cacheable", true);
```

atau native Hibernate API:

```java
session.createQuery("from Product p where p.category = :category", Product.class)
    .setParameter("category", category)
    .setCacheable(true)
    .list();
```

---

### 4.2 Hibernate entity cache

Hibernate entity cache menyimpan entity state berdasarkan entity name + identifier.

Contoh:

```java
@Entity
@Cacheable
@org.hibernate.annotations.Cache(
    usage = CacheConcurrencyStrategy.READ_ONLY,
    region = "reference.productCategory"
)
public class ProductCategory {
    @Id
    private String code;

    private String label;
}
```

Cache key secara konseptual:

```text
ProductCategory#BOOK -> { code: BOOK, label: Books }
```

Saat entity di-load:

```text
Session.find(ProductCategory, BOOK)
    -> check L1 cache
    -> check L2 entity region
    -> if hit: hydrate managed entity into Session
    -> if miss: query DB, then store state into L2 if cacheable
```

---

### 4.3 Cache concurrency strategies

Hibernate mendukung beberapa concurrency strategy, tergantung provider cache dan versi:

| Strategy | Cocok untuk | Risiko |
|---|---|---|
| `READ_ONLY` | immutable/reference data | error/undefined jika dimutasi |
| `READ_WRITE` | mutable data dengan consistency lebih kuat | overhead soft lock/invalidation |
| `NONSTRICT_READ_WRITE` | mutable tapi stale read acceptable | stale window |
| `TRANSACTIONAL` | JTA transactional cache provider | kompleks, provider-dependent |

Rule praktis:

```text
READ_ONLY untuk immutable reference data.
READ_WRITE hanya untuk data mutable low-write dan correctness sudah diuji.
NONSTRICT_READ_WRITE hanya jika stale read secara bisnis aman.
TRANSACTIONAL hanya jika stack transaction/cache benar-benar mendukung.
```

---

### 4.4 Hibernate collection cache

Collection cache menyimpan membership/element state dari association atau element collection.

Contoh:

```java
@Entity
public class Customer {
    @Id
    private Long id;

    @OneToMany(mappedBy = "customer")
    @org.hibernate.annotations.Cache(
        usage = CacheConcurrencyStrategy.READ_WRITE,
        region = "customer.orders"
    )
    private Set<Order> orders = new HashSet<>();
}
```

Collection cache secara konseptual menyimpan:

```text
Customer#10.orders -> [Order#1001, Order#1002, Order#1003]
```

Bukan berarti semua `Order` detail otomatis ada di entity cache. Jika entity `Order` tidak cacheable, provider tetap perlu load setiap order dari database.

Konsekuensi:

> Collection cache paling efektif untuk collection kecil/stabil dengan entity target yang juga cacheable atau element collection yang jarang berubah.

Danger zone:

- collection besar;
- collection sering berubah;
- collection dipakai untuk pagination;
- collection membership tergantung soft-delete/security filter;
- association dipakai lintas tenant.

---

### 4.5 Hibernate query cache

Hibernate query cache harus diaktifkan global dan per query.

Konsep alurnya:

```text
JPQL/HQL + parameters + pagination + cache region + enabled filters
        |
        v
Query cache key
        |
        v
Cached result identifiers/scalars
        |
        v
Entity cache/database load for each id
```

Contoh:

```java
List<ProductCategory> categories = em.createQuery("""
    select c
    from ProductCategory c
    where c.active = true
    order by c.label
""", ProductCategory.class)
.setHint("org.hibernate.cacheable", true)
.getResultList();
```

Query cache cocok untuk:

- reference lookup list;
- small and stable result set;
- repeated same query with same parameters;
- dashboard metadata yang jarang berubah;
- lookup by enum/code/active flag.

Query cache tidak cocok untuk:

- high-cardinality parameter query;
- search screen dengan banyak kombinasi filter;
- user-specific/tenant-specific dynamic query;
- frequently changing table;
- unbounded result set;
- query yang hasilnya harus fresh.

---

### 4.6 Hibernate update timestamps region

Hibernate query cache membutuhkan mekanisme untuk tahu apakah cached result masih valid. Secara konseptual, Hibernate menyimpan timestamp/update metadata per query space/table.

Jika table yang dipakai query berubah, cached query result bisa dianggap stale.

Masalahnya:

- invalidation granularity sering table-level, bukan row-level;
- table yang sering berubah akan membuat query cache sering invalid;
- external update di luar Hibernate bisa tidak diketahui kecuali cache/timestamp di-evict;
- native SQL update bisa butuh synchronization hint/query spaces.

Contoh native update yang harus hati-hati:

```java
em.createNativeQuery("update product set active = 0 where discontinued = 1")
  .executeUpdate();
```

Jika provider tidak tahu affected query space, query cache dapat stale.

---

### 4.7 Natural ID cache

Natural ID adalah business key yang unik dan bermakna.

Contoh:

```java
@Entity
@org.hibernate.annotations.NaturalIdCache
public class UserAccount {
    @Id
    private Long id;

    @org.hibernate.annotations.NaturalId
    @Column(unique = true, nullable = false)
    private String username;
}
```

Lookup:

```java
UserAccount user = session.byNaturalId(UserAccount.class)
    .using("username", "fajar")
    .load();
```

Natural ID cache menyimpan mapping:

```text
UserAccount(username=fajar) -> id=42
```

Lalu entity `UserAccount#42` diambil dari L1/L2/database.

Natural ID cache sangat berguna untuk:

- country code;
- product SKU;
- username;
- external system code;
- regulatory license number;
- stable reference key.

Tapi sangat berbahaya jika natural ID mutable.

Jika natural ID berubah:

```text
username=fajar -> id=42
username=fajar2 -> id=42
```

Provider harus menjaga mapping lama/new agar tidak stale. Hibernate mendukung mutable natural ID, tetapi cost dan risk meningkat. Untuk sistem enterprise, natural ID sebaiknya immutable kecuali ada reason kuat.

---

### 4.8 Hibernate 7 migration note: `StatelessSession` and L2 cache

Pada Hibernate ORM 7 migration guide, `StatelessSession` disebut mulai menggunakan second-level cache by default. Ini penting untuk sistem yang sebelumnya menganggap stateless bulk read/write selalu bypass cache.

Mitigasi jika ingin bypass:

```java
statelessSession.setCacheMode(CacheMode.IGNORE);
```

Pelajaran desain:

> Jangan menganggap API yang bernama “stateless” otomatis tidak berinteraksi dengan shared cache. Periksa behavior versi provider.

---

## 5. EclipseLink Behavior

### 5.1 EclipseLink shared cache is central

EclipseLink historically punya shared object cache yang kuat. Default dan behavior dapat berbeda dari Hibernate.

Konseptual layer:

```text
EntityManager local cache / UnitOfWork
        |
        v
EclipseLink shared cache / Session cache
        |
        v
Database
```

Shared cache hidup selama persistence unit / `EntityManagerFactory` hidup dan dipakai lintas `EntityManager`.

EclipseLink cache sering dikaitkan dengan:

- identity management;
- object reuse;
- performance;
- locking/isolation behavior;
- query in-memory execution;
- descriptor-level cache policy.

---

### 5.2 EclipseLink descriptor-level cache policy

EclipseLink menggunakan descriptor untuk entity metadata. Cache policy bisa diatur per entity/deskriptor.

Contoh annotation EclipseLink:

```java
@Entity
@org.eclipse.persistence.annotations.Cache(
    type = org.eclipse.persistence.annotations.CacheType.SOFT,
    size = 1000,
    expiry = 3600000
)
public class ReferenceCode {
    @Id
    private String code;

    private String label;
}
```

Pilihan cache type seperti `SOFT`, `WEAK`, `FULL`, dan lain-lain memberi karakter memory berbeda.

Namun desain cache berdasarkan soft/weak reference tidak boleh menjadi pengganti explicit correctness design.

---

### 5.3 EclipseLink isolation options

EclipseLink punya konsep cache isolation. Beberapa entity dapat dibuat isolated sehingga tidak memakai shared cache secara default atau menggunakan behavior lebih privat.

Ini penting untuk:

- tenant-sensitive entity;
- security-sensitive entity;
- data yang sangat mutable;
- data yang tidak boleh bocor antar context;
- entity yang selalu harus fresh.

Contoh property untuk mematikan shared cache default:

```xml
<property name="eclipselink.cache.shared.default" value="false"/>
```

Atau konfigurasi per entity/provider extension.

---

### 5.4 EclipseLink query and cache

EclipseLink mendukung query hints terkait cache, termasuk penggunaan cache untuk in-memory query dan bypass/refresh behavior.

Secara mental model, query dapat:

- membaca database;
- memanfaatkan shared cache;
- refresh cache;
- return read-only shared object;
- bypass cache;
- execute in-memory dalam kondisi tertentu.

In-memory query dapat meningkatkan performa untuk reference data, tetapi membawa risiko:

- hasil berbeda dari database jika cache stale;
- filter/security rule tidak identik dengan database predicate;
- collection/relationship tidak lengkap;
- stale object reuse.

Rule:

> Query yang menentukan hak akses, workflow transition, financial/regulatory decision, atau latest status sebaiknya tidak bergantung pada in-memory cache kecuali consistency model-nya eksplisit dan teruji.

---

## 6. Java 8–25 Compatibility Notes

### 6.1 Namespace split

Untuk Java 8-era stack:

```java
import javax.persistence.Cacheable;
import javax.persistence.CacheRetrieveMode;
import javax.persistence.CacheStoreMode;
```

Untuk Jakarta modern stack:

```java
import jakarta.persistence.Cacheable;
import jakarta.persistence.CacheRetrieveMode;
import jakarta.persistence.CacheStoreMode;
```

Migration `javax` ke `jakarta` bukan hanya import change. Perlu align:

- app server;
- Spring Boot version;
- Hibernate/EclipseLink version;
- cache provider integration;
- JTA provider;
- bytecode enhancement/weaving;
- testing library;
- transitive dependencies.

---

### 6.2 Hibernate version line

Typical mapping:

| Stack | Umum dipakai |
|---|---|
| Java 8 legacy | Hibernate 5.x, JPA 2.1/2.2, `javax.persistence` |
| Java 11/17 migration | Hibernate 5.6/6.x depending framework |
| Java 17/21 modern | Hibernate 6.x, Jakarta Persistence 3.x |
| Java 21/25 modern/future | Hibernate 6/7 depending framework readiness |

Cache configuration berubah antar versi, terutama class name region factory, provider integration, query cache detail, dan type system impact pada cache key/value serialization.

---

### 6.3 EclipseLink version line

Typical mapping:

| Stack | Umum dipakai |
|---|---|
| Java 8 legacy | EclipseLink 2.x, `javax.persistence` |
| Jakarta EE 9+ | EclipseLink 3.x, `jakarta.persistence` |
| Jakarta EE 10/11 direction | EclipseLink 4.x+ |

EclipseLink cache/weaving behavior perlu diuji dengan runtime container, karena app server/classloader/weaving setup dapat mengubah behavior nyata.

---

### 6.4 Java 17+ and memory implications

Cache bukan hanya database performance. Ia juga memory/GC design.

Pada Java modern:

- heap besar dengan ZGC/Shenandoah bisa mengurangi pause, tetapi tidak menghilangkan memory pressure;
- second-level cache besar tetap dapat meningkatkan allocation, pointer chasing, CPU cache miss;
- serialized cache payload besar dapat meningkatkan CPU encode/decode;
- off-heap/distributed cache bisa memindahkan cost ke network/serialization;
- virtual threads tidak menyelesaikan cache contention.

Rule:

> Lebih banyak cache tidak otomatis lebih scalable. Cache menukar database round-trip dengan memory, invalidation, serialization, dan correctness complexity.

---

## 7. Taxonomy: What Exactly Is Being Cached?

### 7.1 Entity state cache

Entity cache stores entity state by ID.

```text
Cache key:
  EntityName + Identifier + Tenant(optional)

Cache value:
  Disassembled property values
```

Example:

```text
Product#100
  name = "Keyboard"
  price = 100000
  category_id = "ACCESSORY"
```

Entity cache answers:

```text
Given entity type and ID, can we avoid SELECT by primary key?
```

---

### 7.2 Collection membership cache

Collection cache stores association membership.

```text
Customer#10.orders -> [Order#1, Order#2, Order#3]
```

It answers:

```text
Given owner entity ID and collection role, what are the child identifiers/elements?
```

It does not necessarily cache every child entity detail.

---

### 7.3 Query result cache

Query cache stores result of a query key.

```text
Query:
  select p.id from Product p where p.status = :status order by p.name
Param:
  status=ACTIVE
Page:
  offset=0, limit=50

Cache value:
  [10, 11, 12, ...]
```

It answers:

```text
Given this exact query shape and parameters, what result identifiers/scalars were returned?
```

---

### 7.4 Natural ID cache

Natural ID cache stores natural-key-to-primary-key mapping.

```text
License(no="L-2026-0001") -> License#8821
```

It answers:

```text
Given a unique business key, what is the entity primary key?
```

---

### 7.5 Application-level cache

Many systems also have cache outside ORM:

- Redis cache;
- Caffeine cache;
- HTTP cache;
- CDN;
- materialized view;
- search index;
- local in-memory map;
- GraphQL/DataLoader cache.

ORM cache must not be designed in isolation. You need a full cache map:

```text
DB source of truth
    -> ORM L2 cache
    -> service local cache
    -> Redis cache
    -> API response cache
    -> browser cache
```

Every layer multiplies invalidation complexity.

---

## 8. Cache Correctness Model

### 8.1 Define staleness tolerance

Before enabling cache, classify each data type:

| Data type | Example | Staleness tolerance | Cache suitability |
|---|---|---:|---|
| Immutable reference | country code, fixed enum table | very high | excellent |
| Slowly changing reference | product category, branch list | seconds/minutes acceptable | good with eviction/TTL |
| User profile | display name, preferences | moderate | case-by-case |
| Workflow status | case status, approval state | low | dangerous |
| Authorization data | role, permission, tenant access | very low | dangerous unless explicit TTL/invalidation |
| Financial/regulatory decision | compliance result, penalty, license state | near zero | usually avoid ORM L2/query cache |
| Audit trail | immutable append-only | high for old records, low for latest listing | careful |
| Queue/task assignment | current assignee, lock status | zero/near zero | avoid |

---

### 8.2 Define writer topology

Ask:

```text
Who can change this table?
```

Possibilities:

1. Only this application through ORM.
2. Same application but some native SQL/bulk updates.
3. Multiple application instances through ORM.
4. Other service writes same database.
5. DBA/manual script changes data.
6. Batch job writes data.
7. ETL/data migration writes data.
8. Trigger/stored procedure changes related table.

The more writers outside ORM, the harder cache correctness becomes.

If database can be changed outside provider knowledge, you need:

- cache eviction after external job;
- TTL;
- event-based invalidation;
- bypass for critical reads;
- separate non-cacheable entity;
- DB-level version/timestamp check;
- no cache.

---

### 8.3 Define read semantics

Not every read needs the same freshness.

| Read type | Freshness need | Cache stance |
|---|---:|---|
| UI dropdown reference | low | cache OK |
| search page approximate listing | medium | cache maybe, but query cache careful |
| detail page after update | high | L1 enough, L2 maybe bypass/refresh |
| approval transition guard | very high | fresh DB + lock/version |
| authorization decision | very high | explicit security cache with strict invalidation, not accidental ORM query cache |
| report over historical snapshot | medium/high depending report | read model/materialized view preferred |

---

### 8.4 Define invalidation source

Cache invalidation can be:

- transaction-aware invalidation by provider;
- timestamp/table invalidation;
- explicit eviction API;
- TTL expiry;
- event/message invalidation;
- database change capture;
- full region clear;
- application restart;
- manual admin command.

Every invalidation strategy has failure mode.

| Strategy | Risk |
|---|---|
| transaction-aware | only works for provider-known changes |
| TTL | stale window allowed |
| explicit eviction | human/code path can forget |
| event invalidation | message loss/ordering issue |
| CDC | latency/complexity |
| full clear | stampede after eviction |
| restart | unacceptable operational dependency |

---

## 9. Choosing What to Cache

### 9.1 Excellent candidates

Cache these first:

- immutable reference tables;
- small lookup tables;
- country/state/category/status reason definitions;
- configuration snapshots that change through controlled release;
- historical immutable records by ID;
- code tables with clear versioning;
- enum-like tables.

Example:

```java
@Entity
@Cacheable(true)
@org.hibernate.annotations.Immutable
@org.hibernate.annotations.Cache(
    usage = CacheConcurrencyStrategy.READ_ONLY,
    region = "ref.country"
)
public class Country {
    @Id
    private String code;

    private String name;
}
```

---

### 9.2 Acceptable with care

Can be cached if update path and staleness tolerance are clear:

- product catalog;
- organization hierarchy;
- user preference;
- branch/office metadata;
- active policy configuration;
- template metadata;
- feature flags if TTL/invalidations controlled.

Use:

- TTL;
- explicit eviction;
- versioned config;
- admin cache clear;
- read-through service abstraction;
- `READ_WRITE` or provider-equivalent if needed.

---

### 9.3 Dangerous candidates

Avoid ORM L2/query cache for:

- current case status;
- task assignment;
- approval decision;
- payment status;
- lock row;
- inventory quantity;
- account balance;
- permission/role if immediate revocation required;
- workflow transition guard;
- queue polling table;
- frequently updated aggregate root;
- table updated by multiple systems.

Dangerous does not mean impossible. It means cache must be part of explicit architecture, not annotation-level convenience.

---

## 10. Practical Hibernate Configuration Patterns

### 10.1 Conservative baseline

For enterprise systems, start with:

```properties
hibernate.cache.use_second_level_cache=true
hibernate.cache.use_query_cache=false
```

Then enable entity cache selectively.

```java
@Entity
@Cacheable
@org.hibernate.annotations.Cache(
    usage = CacheConcurrencyStrategy.READ_ONLY,
    region = "reference.reasonCode"
)
public class ReasonCode { ... }
```

Reason:

- entity-by-id cache is easier to reason about than query cache;
- query cache has broader invalidation risk;
- cacheable entity can benefit `find()` and association loading.

---

### 10.2 Query cache only for stable repeated query

```java
List<ReasonCode> reasonCodes = em.createQuery("""
    select r
    from ReasonCode r
    where r.module = :module
      and r.active = true
    order by r.displayOrder
""", ReasonCode.class)
.setParameter("module", module)
.setHint("org.hibernate.cacheable", true)
.setHint("org.hibernate.cacheRegion", "query.reasonCodesByModule")
.getResultList();
```

Checklist:

- result small;
- parameters low cardinality;
- table changes rarely;
- entity cache enabled;
- tenant/security filter included if relevant;
- invalidation tested;
- no user-specific leakage.

---

### 10.3 Cache mode for batch scan

Batch jobs often should not pollute cache.

```java
Session session = em.unwrap(Session.class);
session.setCacheMode(CacheMode.IGNORE);
```

Use case:

- archival scan;
- export job;
- migration job;
- full table read;
- one-time reconciliation.

Without this, batch job can evict useful hot cache entries and fill cache with cold data.

---

### 10.4 Explicit eviction after administrative update

```java
@Transactional
public void updateReasonCode(String code, String newLabel) {
    ReasonCode rc = em.find(ReasonCode.class, code);
    rc.rename(newLabel);

    em.flush();
    em.getEntityManagerFactory().getCache().evict(ReasonCode.class, code);
}
```

In Hibernate, region-level eviction may be needed for query cache too:

```java
SessionFactory sf = em.unwrap(Session.class).getSessionFactory();
sf.getCache().evictQueryRegion("query.reasonCodesByModule");
```

---

## 11. Practical EclipseLink Configuration Patterns

### 11.1 Disable shared cache globally, opt in selectively

For high-correctness systems, consider:

```xml
<property name="eclipselink.cache.shared.default" value="false"/>
```

Then enable cache for safe entities through EclipseLink-specific annotations/config.

This is conservative and reduces accidental stale reads.

---

### 11.2 Use refresh/bypass hints for critical reads

Example pattern:

```java
Map<String, Object> hints = new HashMap<>();
hints.put("jakarta.persistence.cache.retrieveMode", CacheRetrieveMode.BYPASS);
hints.put("jakarta.persistence.cache.storeMode", CacheStoreMode.REFRESH);

CaseFile caseFile = em.find(CaseFile.class, id, hints);
```

For EclipseLink-specific hints, use provider docs and keep them isolated behind repository/service utility methods.

---

### 11.3 Avoid in-memory query for correctness-sensitive paths

In-memory query sounds attractive but can change semantics. For regulatory/case workflow:

```text
Transition guard? -> database query + version/lock.
Reference dropdown? -> shared cache acceptable.
```

---

## 12. Cache and Transaction Isolation

### 12.1 Cache is not database isolation

Database isolation controls visibility among transactions at database level.

ORM cache can bypass database reads.

That means:

```text
Transaction asks for data
    -> provider returns cache value
    -> database isolation was not consulted for that read
```

If your correctness depends on database isolation, lock, latest version, or row-level security, cache may be inappropriate.

---

### 12.2 Repeatable read illusion

Within one persistence context:

```java
Order order1 = em.find(Order.class, id);
// another transaction updates same row
Order order2 = em.find(Order.class, id);
```

`order1 == order2`, and you see same managed object unless refreshed.

This is not necessarily database repeatable read. It is persistence context identity behavior.

If you need fresh state:

```java
em.refresh(order1);
```

or bypass cache on find/query.

---

### 12.3 Optimistic locking and cache

`@Version` helps detect stale updates:

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    @Version
    private long version;

    private String status;
}
```

If cached entity has stale version and you update it, flush should fail when database version differs.

But optimistic locking does not protect all reads:

- stale data can still be shown;
- stale data can be used to make wrong UI decision;
- stale query result can hide a newly eligible case;
- bulk update can bypass version logic;
- external update may not bump version.

Rule:

> Versioning protects write conflict, not every read decision.

---

## 13. Query Cache Correctness

### 13.1 Query cache key must include all semantic inputs

A query result depends on more than JPQL text.

It can depend on:

- query string;
- parameters;
- pagination;
- sorting;
- enabled filters;
- tenant identifier;
- user security scope;
- current time if query uses time;
- database session variables;
- soft-delete filter;
- locale;
- provider hints;
- result transformer/projection.

If any semantic input is missing from cache key, result can leak/wrong.

---

### 13.2 User-specific query cache risk

Dangerous:

```java
List<CaseFile> cases = em.createQuery("""
    select c from CaseFile c
    where c.assignedOfficerId = :currentUserId
      and c.status = 'OPEN'
""", CaseFile.class)
.setParameter("currentUserId", currentUserId)
.setHint("org.hibernate.cacheable", true)
.getResultList();
```

Problems:

- high cardinality parameter;
- result changes frequently;
- user-specific access;
- stale assignment risk;
- possible cache memory explosion.

Better:

- no query cache;
- DB index on `(assigned_officer_id, status)`;
- pagination;
- projection;
- explicit read model if needed.

---

### 13.3 Query cache and pagination

Cached page 1:

```text
status=OPEN, offset=0, limit=20 -> [1..20]
```

Then new row inserted at top.

Cached page is now stale.

For frequently changing listing, query cache can produce confusing UI:

- item appears on wrong page;
- item missing;
- duplicate across pages;
- stale count;
- action button shown for outdated status.

Better:

- keyset pagination;
- no query cache;
- cache stable reference filters only;
- use search index/read model if needed.

---

### 13.4 Query cache and bulk update

Bulk update bypasses persistence context and entity lifecycle.

```java
em.createQuery("""
    update CaseFile c
    set c.status = 'EXPIRED'
    where c.deadline < :now
""")
.setParameter("now", now)
.executeUpdate();
```

Risks:

- L1 stale;
- L2 stale depending provider invalidation;
- query cache invalidation table-level maybe broad;
- entity listeners not called;
- version may not increment unless explicit;
- external cache not invalidated.

After bulk update:

```java
em.clear();
em.getEntityManagerFactory().getCache().evict(CaseFile.class);
```

And evict provider-specific query regions if used.

---

## 14. Natural ID Cache Correctness

### 14.1 Natural ID must be truly unique

Natural ID cache relies on uniqueness.

Bad natural ID:

```text
email address in system where users may share/transfer/reuse email
```

Better natural ID:

```text
immutable external UUID assigned by identity provider
```

Before using natural ID cache, ask:

- Is it database unique?
- Is it immutable?
- Is it tenant-scoped?
- Can it be reused after deletion?
- Can it change due to external system correction?
- Does it include normalization rules?

---

### 14.2 Normalize before caching

Example:

```java
@NaturalId
@Column(nullable = false, unique = true)
private String normalizedEmail;
```

Do not cache ambiguous values:

```text
"Fajar@Example.com"
"fajar@example.com"
" fajar@example.com "
```

If normalization is not consistent, natural ID cache can map different strings to different keys for same logical identity.

---

### 14.3 Tenant-aware natural ID

In multi-tenant system:

```text
tenant=A, code=ADMIN
tenant=B, code=ADMIN
```

Natural ID must include tenant scope if uniqueness is tenant-local.

Bad:

```java
@NaturalId
private String roleCode;
```

Better:

```java
@NaturalId
@ManyToOne(fetch = FetchType.LAZY)
private Tenant tenant;

@NaturalId
private String roleCode;
```

But provider cache key and tenant isolation must be tested.

---

## 15. Multi-Tenancy and Security Risks

### 15.1 Cache key must be tenant-safe

In discriminator-based multi-tenancy:

```text
CaseFile#100 may exist for tenant A and tenant B if ID is local
```

If cache key does not include tenant, catastrophic leakage can occur.

Even if ID is globally unique, query cache can leak result if tenant filter not included.

Rule:

> For multi-tenant systems, cache must be proven tenant-aware at entity, collection, natural-id, and query levels.

---

### 15.2 Authorization data is not ordinary reference data

Roles/permissions look like reference data, but stale permission has severe risk.

Example:

```text
Admin revokes user access.
L2/query cache still returns old access mapping for 5 minutes.
User continues accessing restricted case.
```

This may be unacceptable.

Safer patterns:

- short TTL explicit security cache;
- event-driven invalidation on role change;
- permission version in session/token;
- DB check for critical operation;
- do not rely on ORM query cache for authorization decision;
- central authorization service.

---

### 15.3 Soft delete and cache

Soft delete commonly uses:

```sql
deleted = false
```

or provider filter.

Risk:

- entity cache by ID may return soft-deleted object;
- query cache may return ID that is now deleted;
- collection cache may include deleted child;
- native query may ignore soft-delete predicate;
- admin bypass and user query share same cache region.

Rule:

> If soft delete is security/correctness relevant, treat cache as hostile until tested.

---

## 16. Cache and Clustered Deployment

### 16.1 Single JVM vs multi-node

In one JVM:

```text
App instance A cache == all app cache
```

In cluster:

```text
App instance A cache
App instance B cache
App instance C cache
```

If caches are local only, update on A may not invalidate B/C.

Options:

1. No L2 cache for mutable data.
2. Distributed cache provider.
3. Replicated invalidation.
4. TTL only.
5. Event-driven eviction.
6. Cache only immutable data.

---

### 16.2 Distributed cache trade-offs

Distributed cache adds:

- network hop;
- serialization/deserialization;
- consistency protocol;
- split-brain risk;
- cluster membership issues;
- deployment version compatibility;
- rolling upgrade complexity;
- cache region configuration drift.

It can be worse than database read if:

- DB is fast by primary key;
- cache payload large;
- hit ratio low;
- invalidation frequent;
- network latency high;
- serialization expensive.

---

### 16.3 Rolling deployment risk

During rolling deployment:

```text
Node A old entity shape
Node B new entity shape
Shared cache payload old/new mixed
```

Risk:

- deserialization failure;
- missing field default issue;
- enum value mismatch;
- column mapping changed;
- class serialVersion issue;
- stale data after schema migration.

Safe patterns:

- clear cache before/after deployment;
- version cache region names;
- avoid Java object serialization for long-lived cache;
- use expand-contract schema migration;
- disable cache during migration window;
- test rolling upgrade with cache preserved.

---

## 17. Performance Model

### 17.1 What cache saves

Cache can save:

- database round trip;
- query parse/execute cost;
- index lookup;
- row transfer;
- JDBC mapping;
- entity hydration from ResultSet.

But cache costs:

- memory;
- GC;
- cache lookup CPU;
- serialization;
- invalidation;
- lock/coordination;
- stale data risk;
- observability complexity.

---

### 17.2 Entity cache cost model

Entity cache is good when:

```text
read frequency high
write frequency low
entity size small/moderate
lookup by ID common
staleness tolerance acceptable
```

Bad when:

```text
write frequency high
entity huge
rarely reused
query-specific projection better
external writers exist
```

---

### 17.3 Query cache cost model

Query cache is good when:

```text
same query repeated many times
parameters low cardinality
result small/stable
underlying tables rarely change
entity cache also useful
```

Bad when:

```text
search screen many filters
user-specific result
tenant-specific high cardinality
frequent inserts/updates
pagination over changing data
large result set
```

---

### 17.4 Collection cache cost model

Collection cache is good when:

```text
owner collection small
membership stable
collection commonly traversed
child entities cacheable
```

Bad when:

```text
collection huge
membership frequently changes
collection used for page-by-page UI
soft-delete/security filter affects membership
```

---

## 18. Observability and Diagnostics

### 18.1 Metrics to capture

For Hibernate:

- second-level cache hit count;
- miss count;
- put count;
- region hit/miss/put;
- query cache hit/miss/put;
- natural id cache hit/miss;
- entity load count;
- entity fetch count;
- collection load/fetch count;
- query execution count;
- flush count.

Do not rely on global hit ratio only. Region-level data matters.

---

### 18.2 SQL count assertion

A cache test should prove SQL behavior.

Example expectation:

```text
First load ProductCategory#BOOK -> 1 SELECT
Clear persistence context
Second load ProductCategory#BOOK -> 0 SELECT if L2 hit
```

But also test update:

```text
Update ProductCategory#BOOK
Commit
Clear persistence context
Reload -> sees updated label
```

And external update:

```text
Update database outside ORM
Reload with cache -> stale?
Evict/refresh -> correct?
```

---

### 18.3 Logging cache decisions

During debugging, enable provider cache stats/logging in non-prod or controlled prod window.

Look for:

- unexpected cache miss;
- cache hit on correctness-sensitive query;
- query cache invalidation too broad;
- high put count with low hit count;
- region memory growth;
- query cache region explosion;
- natural ID cache stale mapping.

---

### 18.4 Symptom to root cause map

| Symptom | Possible cache root cause |
|---|---|
| User sees old status | L2 entity cache stale, long L1 persistence context, query cache stale |
| Deleted child still appears | collection cache stale, soft-delete filter mismatch |
| Permission revocation not effective | cached authorization mapping/query result |
| Cache hit high but DB still busy | query cache only stores IDs; entities not cacheable; collection cache causing individual loads |
| Memory grows | too many cache regions, large query result cache, collection cache of huge associations |
| Different nodes show different data | local cache not invalidated cluster-wide |
| After deployment deserialization fails | incompatible cached payload/class shape |
| Batch job slows app | batch polluted L2 cache or invalidated hot regions |

---

## 19. Design Patterns

### 19.1 Reference Data Cache Pattern

Use for stable code tables.

```text
Entity: cacheable READ_ONLY
Query list: cacheable if low-cardinality
Invalidation: deployment/admin clear
Staleness: acceptable
```

Example:

```java
@Entity
@Cacheable
@Immutable
@Cache(usage = CacheConcurrencyStrategy.READ_ONLY, region = "ref.statusReason")
public class StatusReason {
    @Id
    private String code;
    private String label;
    private boolean active;
}
```

---

### 19.2 Versioned Configuration Pattern

Instead of mutable config row, use versioned config snapshot.

```text
PolicyConfig(id, version, effectiveFrom, effectiveTo, status)
```

Cache only published immutable version.

Benefits:

- old config remains valid for historical decision;
- cache invalidation easier;
- audit-friendly;
- rollback possible.

---

### 19.3 Explicit Fresh Read Pattern

For critical transition:

```java
@Transactional
public void approveCase(Long caseId, long expectedVersion) {
    CaseFile caseFile = em.find(
        CaseFile.class,
        caseId,
        Map.of(
            "jakarta.persistence.cache.retrieveMode", CacheRetrieveMode.BYPASS
        )
    );

    if (caseFile.getVersion() != expectedVersion) {
        throw new OptimisticLockException();
    }

    caseFile.approve();
}
```

For stricter guarantee, use lock:

```java
CaseFile caseFile = em.find(
    CaseFile.class,
    caseId,
    LockModeType.OPTIMISTIC
);
```

or pessimistic lock where needed.

---

### 19.4 Cache Facade Pattern

Do not scatter provider hints everywhere.

Create explicit repository methods:

```java
public interface ReferenceDataRepository {
    List<ReasonCode> findActiveReasonCodesCached(Module module);
    ReasonCode findReasonCodeFresh(String code);
    void evictReasonCodes();
}
```

This makes cache policy visible in method name/contract.

Bad:

```java
findReasonCodes()
```

Better:

```java
findReasonCodesCachedForDropdown()
findReasonCodeFreshForUpdate()
```

---

### 19.5 Region Naming Pattern

Use explicit regions:

```text
ref.country
ref.reasonCode
query.ref.reasonCodesByModule
entity.productCatalog
collection.customer.savedAddresses
```

Avoid default giant region because:

- hard to observe;
- hard to evict surgically;
- hard to tune TTL;
- hard to debug memory.

---

## 20. Anti-Patterns

### 20.1 `@Cacheable` everywhere

Bad:

```java
@Entity
@Cacheable
public class CaseFile { ... }

@Entity
@Cacheable
public class TaskAssignment { ... }

@Entity
@Cacheable
public class PaymentStatus { ... }
```

This optimizes blindly and can corrupt business perception.

---

### 20.2 Query cache for search page

Bad:

```java
searchCases(criteria).setHint("org.hibernate.cacheable", true)
```

Search criteria often high-cardinality and user-specific. Cache grows but hit ratio low; stale risk high.

---

### 20.3 Caching mutable collection membership

Bad:

```java
@Cache(usage = READ_WRITE)
@OneToMany(mappedBy = "caseFile")
private List<Task> tasks;
```

If tasks are frequently assigned/completed/escalated, collection cache can become churn-heavy and stale-sensitive.

---

### 20.4 Hiding cache behind generic repository

Bad:

```java
repository.findAllActive(); // sometimes cached, sometimes fresh, unclear
```

Correctness-sensitive systems need method-level clarity.

---

### 20.5 Treating TTL as correctness guarantee

TTL reduces maximum stale window. It does not guarantee correctness.

If revocation must be immediate, 5-minute TTL is not enough.

---

### 20.6 Ignoring external writers

If another service/script updates DB and ORM cache is not evicted, stale data is expected, not surprising.

---

### 20.7 Sharing cache region between admin and user views

Admin queries often bypass soft-delete/security filters. User queries must enforce them. Do not mix cache regions carelessly.

---

## 21. Regulatory / Case Management Perspective

For complex case management, cache policy must align with defensibility.

### 21.1 Safe to cache

Usually safe:

- offence type/reference code;
- case category metadata;
- document type definition;
- template metadata if versioned;
- static SLA reason codes;
- country/address reference data;
- form field definitions if published immutable.

### 21.2 Be careful

Careful:

- officer profile;
- organization unit assignment;
- active workflow configuration;
- email template latest version;
- role mapping;
- rule thresholds.

Need versioning or explicit invalidation.

### 21.3 Usually do not cache with ORM L2/query cache

Avoid:

- current case status;
- current assignee;
- pending approval list;
- active enforcement action;
- payment/current penalty status;
- compliance result under review;
- latest audit listing;
- access-control decision;
- queue claim row;
- lock/lease row.

### 21.4 Auditability concern

If a user claims:

> “The system showed me the old status when I approved.”

You need answer:

- Was the read from DB or cache?
- Which cache region?
- What version/timestamp?
- Was there an invalidation event?
- Did another node have different value?
- Was `@Version` checked?
- Was transition guard based on fresh read?

If you cannot answer, cache is too implicit for that path.

---

## 22. Testing Strategy

### 22.1 Test entity cache hit

Pseudo test:

```java
@Test
void secondLevelCacheAvoidsSecondSelectById() {
    statistics.clear();

    tx(() -> {
        em.find(Country.class, "ID");
    });

    tx(() -> {
        em.find(Country.class, "ID");
    });

    assertThat(statistics.getSecondLevelCacheHitCount()).isGreaterThan(0);
}
```

Also assert SQL count if possible.

---

### 22.2 Test stale after external update

```java
@Test
void externalUpdateRequiresEvictionOrRefresh() {
    tx(() -> em.find(ReasonCode.class, "A"));

    jdbc.update("update reason_code set label = 'New' where code = 'A'");

    tx(() -> {
        ReasonCode rc = em.find(ReasonCode.class, "A");
        // Document expected behavior: stale or fresh?
    });

    emf.getCache().evict(ReasonCode.class, "A");

    tx(() -> {
        ReasonCode rc = em.find(ReasonCode.class, "A");
        assertThat(rc.getLabel()).isEqualTo("New");
    });
}
```

This test forces the team to admit the cache contract.

---

### 22.3 Test query cache invalidation

```java
@Test
void queryCacheInvalidatedAfterInsert() {
    List<ReasonCode> before = findActiveReasonCodesCached();

    tx(() -> {
        em.persist(new ReasonCode("NEW", "New Reason", true));
    });

    List<ReasonCode> after = findActiveReasonCodesCached();

    assertThat(after).extracting(ReasonCode::getCode).contains("NEW");
}
```

If this fails, query cache is unsafe or configuration is wrong.

---

### 22.4 Test tenant separation

```java
@Test
void cacheDoesNotLeakAcrossTenants() {
    withTenant("A", () -> {
        assertThat(findRole("ADMIN").getLabel()).isEqualTo("Tenant A Admin");
    });

    withTenant("B", () -> {
        assertThat(findRole("ADMIN").getLabel()).isEqualTo("Tenant B Admin");
    });
}
```

This must be tested for:

- entity cache;
- query cache;
- natural ID cache;
- collection cache.

---

### 22.5 Test rolling deployment cache compatibility

In serious systems, test:

1. App v1 writes cache.
2. App v2 starts with new entity shape.
3. App v2 reads cached data.
4. Migration proceeds.
5. Cache clear/versioning strategy works.

This is often ignored until production deployment fails.

---

## 23. Diagnostic Checklist

Before enabling cache for an entity/query:

1. Is the data immutable?
2. If mutable, how often does it change?
3. Who writes it?
4. Are there external writers?
5. Is stale read acceptable? For how long?
6. Is it tenant-specific?
7. Is it security-sensitive?
8. Is it workflow/decision-sensitive?
9. Is `@Version` present if mutable?
10. Is the entity small enough to cache?
11. Is query parameter cardinality low?
12. Is result set bounded?
13. Are filters included in query cache key?
14. Does cache provider work in cluster?
15. Is invalidation tested?
16. Is eviction operationally available?
17. Are metrics enabled per region?
18. Is cache behavior tested with real database/provider?
19. Is deployment/migration cache compatibility handled?
20. Is there a fallback plan if cache is wrong?

---

## 24. Practice Scenarios

### Scenario 1 — Country dropdown

Data:

- 250 countries;
- changes rarely;
- not tenant-specific;
- not security-sensitive.

Recommendation:

- entity cache `READ_ONLY`;
- optional query cache for active country list;
- region `ref.country`;
- admin full eviction if changed.

---

### Scenario 2 — Case status

Data:

- changes during workflow;
- approval depends on latest status;
- multiple users may act concurrently.

Recommendation:

- no query cache;
- avoid L2 cache for current state unless strict invalidation and versioning;
- use `@Version`;
- fresh read/lock for transition;
- projection for listing;
- index `(status, assigned_officer_id, updated_at)`.

---

### Scenario 3 — Permission mapping

Data:

- role can be revoked;
- immediate revocation expected;
- user-specific/tenant-specific.

Recommendation:

- avoid accidental ORM query cache;
- explicit authorization cache only if invalidation event exists;
- short TTL alone may be insufficient;
- include permission version in session/token if applicable;
- DB/fresh check for critical operation.

---

### Scenario 4 — Product catalog

Data:

- read-heavy;
- updated by admin;
- users tolerate seconds of stale description, not stale price.

Recommendation:

- split entity/read model or fields;
- cache category/description metadata;
- do not cache price if correctness critical;
- explicit eviction on admin update;
- region separation.

---

### Scenario 5 — Audit trail listing

Data:

- append-only;
- latest listing changes constantly;
- old records immutable.

Recommendation:

- do not query-cache latest listing;
- maybe cache individual old audit record by ID if immutable and frequently accessed;
- use partition/index/read model for listing;
- projection/native SQL for large audit view.

---

## 25. Design Rules

1. Cache only when you can state the correctness contract.
2. Prefer opt-in caching over global caching.
3. Start with immutable reference data.
4. Treat query cache as advanced feature, not default performance fix.
5. Do not cache authorization/workflow transition decisions accidentally.
6. Cache entity-by-ID before caching arbitrary query results.
7. Use explicit cache regions.
8. Separate admin/user/security/tenant cache behavior.
9. Test stale behavior, not only hit behavior.
10. External writers require eviction/TTL/event strategy.
11. Bulk updates require cache invalidation thinking.
12. Large batch scans should often bypass cache.
13. In cluster, local cache is not enough for mutable data.
14. Version cache regions or clear cache during incompatible deployment.
15. High hit ratio is not proof of correctness.
16. `@Version` protects writes, not all stale reads.
17. Natural ID cache requires stable normalized uniqueness.
18. Collection cache is for stable membership, not hot mutable lists.
19. Measure DB savings versus memory/serialization/invalidation cost.
20. If stale data can create regulatory/security incident, default to fresh read.

---

## 26. Summary

Second-level cache, query cache, collection cache, and natural ID cache are powerful, but they are not simple acceleration switches.

The right mental model:

```text
First-level cache = unit-of-work correctness and identity map.
Second-level entity cache = shared entity state by ID.
Collection cache = association membership cache.
Query cache = query key to result identifiers/scalars.
Natural ID cache = business key to primary key mapping.
```

The most important distinction:

```text
Cache performance question:
  Can this avoid database work?

Cache correctness question:
  Is the cached answer still valid for this business decision?
```

For production-grade persistence engineering, cache must be designed around:

- data volatility;
- writer topology;
- transaction semantics;
- invalidation mechanism;
- tenant/security boundary;
- deployment/migration behavior;
- observability;
- tested failure modes.

Most systems should begin with conservative caching of immutable reference data, then carefully expand. Query cache, collection cache, and mutable entity cache should be introduced only when there is measurable benefit and a proven correctness model.

---

## 27. References

- Jakarta Persistence 3.2 specification and API docs: https://jakarta.ee/specifications/persistence/3.2/
- Jakarta EE tutorial, second-level cache with Jakarta Persistence: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/persist/persistence-cache/persistence-cache.html
- Hibernate ORM User Guide, caching, natural id, query cache, and second-level cache: https://docs.hibernate.org/stable/orm/userguide/html_single/
- Hibernate ORM 7.0 migration guide, `StatelessSession` and second-level cache behavior: https://docs.hibernate.org/orm/7.0/migration-guide/
- EclipseLink documentation, understanding caching and query cache behavior: https://eclipse.dev/eclipselink/documentation/2.7/concepts/cache.htm
- EclipseLink 4.0 JPA extensions reference: https://eclipse.dev/eclipselink/documentation/4.0/jpa/extensions/jpa-extensions.html

---

## 28. Completion Status

Part 21 selesai.

Seri belum selesai. Berikutnya:

`22-schema-generation-validation-migration-ddl-discipline.md`

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 20 — Merge, Detach, DTO Mapping, and API Boundary Safety](./20-merge-detach-dto-mapping-api-boundary-safety.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 22 — Schema Generation, Validation, Migration, and DDL Discipline](./22-schema-generation-validation-migration-ddl-discipline.md)

</div>