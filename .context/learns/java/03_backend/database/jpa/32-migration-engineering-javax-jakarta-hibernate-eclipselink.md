# Part 32 — Migration Engineering: Javax to Jakarta, Hibernate 5 to 6/7, EclipseLink 2 to 4/5

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `32-migration-engineering-javax-jakarta-hibernate-eclipselink.md`  
> Scope Java: 8 sampai 25  
> Baseline stabil modern: Jakarta Persistence 3.2, Hibernate ORM 7.x stable line, EclipseLink 5.x for Jakarta Persistence 3.2/Jakarta EE 11  
> Legacy baseline: JPA 2.1/2.2 `javax.persistence`, Hibernate 5.x, EclipseLink 2.x

---

## 1. Why This Matters

Migration ORM adalah salah satu jenis upgrade paling berisiko dalam sistem enterprise Java karena ia menyentuh lapisan yang sangat dekat dengan data permanen.

Upgrade library UI yang gagal biasanya terlihat cepat. Upgrade ORM yang gagal bisa terlihat sebagai:

- query lebih lambat tetapi tidak langsung error,
- SQL berubah bentuk tanpa disadari,
- data stale karena cache behavior berubah,
- locking tidak lagi bekerja seperti asumsi lama,
- pagination menghasilkan result berbeda,
- custom type/converter diam-diam tidak dipakai,
- native query mapping rusak di edge case tertentu,
- schema validation mulai gagal,
- entity graph menghasilkan fetch plan berbeda,
- bulk update melewati version/audit seperti sebelumnya tetapi sekarang lebih sulit terdeteksi,
- performa turun karena batching, dialect, sequence allocation, atau query plan berubah.

Jadi migration persistence layer bukan pekerjaan “update dependency lalu fix compile error”. Itu adalah **engineering program** yang harus mengontrol perubahan pada lima bidang sekaligus:

1. **API namespace** — `javax.persistence` ke `jakarta.persistence`.
2. **Provider behavior** — Hibernate/EclipseLink berubah internal engine-nya.
3. **Framework integration** — Spring Boot, Jakarta EE server, Quarkus, Micronaut, transaction manager, connection pool.
4. **Database behavior** — dialect, generated SQL, locking clause, pagination SQL, sequence handling, JDBC type binding.
5. **Operational behavior** — metrics, logging, cache, memory, latency, rollout, rollback.

Mental model utama bagian ini:

> Migration ORM yang aman bukan sekadar “aplikasi bisa start”, tetapi “semantic contract persistence layer tetap sama atau berubah secara sadar, terukur, dan bisa dibuktikan”.

---

## 2. Core Mental Model: Migration as Controlled Semantic Drift

Setiap migration ORM membawa **semantic drift**. Drift berarti perilaku sistem berubah, baik disengaja maupun tidak.

Ada empat level drift:

```text
Level 1 — Compile-time drift
Kode tidak compile karena package/class/method berubah.

Level 2 — Startup-time drift
Aplikasi compile, tetapi gagal boot karena metadata mapping/provider config berubah.

Level 3 — Runtime functional drift
Aplikasi boot, tetapi behavior CRUD/query/cache/transaction berubah.

Level 4 — Production workload drift
Aplikasi terlihat benar di test, tetapi latency, memory, DB load, lock contention, atau cache behavior berubah di beban nyata.
```

Developer rata-rata berhenti di Level 1 dan Level 2. Engineer persistence yang kuat harus mengendalikan Level 3 dan Level 4.

ORM migration harus diperlakukan seperti compiler migration:

```text
Entity model + query + provider config
            │
            ▼
 ORM provider compiler/runtime
            │
            ▼
 SQL + JDBC bindings + transaction behavior + cache side effects
            │
            ▼
 Database state transition
```

Jika compiler-nya berubah, output-nya bisa berubah walaupun source code domain terlihat sama.

---

## 3. Version Landscape: Java 8–25, JPA/Jakarta, Hibernate, EclipseLink

### 3.1 Legacy world: Java 8 and `javax.persistence`

Typical stack lama:

```text
Java 8
JPA 2.1 / 2.2
javax.persistence.*
Hibernate 4.x / 5.x or EclipseLink 2.x
Java EE / Spring Boot 1.x / 2.x
```

Karakteristik:

- namespace masih `javax.persistence`,
- banyak aplikasi masih memakai `javax.transaction`, `javax.validation`, `javax.annotation`,
- Hibernate 5.6 sering menjadi bridge terakhir untuk ekosistem legacy,
- EclipseLink 2.x banyak muncul di server Java EE/Jakarta EE lama,
- Java Time API mulai umum sejak JPA 2.2,
- banyak custom type lama berbasis API Hibernate 5.

### 3.2 Transition world: Java 11/17 and Jakarta namespace

Typical stack transisi:

```text
Java 11 / 17
Jakarta Persistence 3.0 / 3.1
jakarta.persistence.*
Hibernate 6.x or EclipseLink 3.x/4.x
Spring Boot 3.x / Jakarta EE 10
```

Karakteristik:

- namespace pindah ke `jakarta.persistence`,
- semua dependency Jakarta terkait harus ikut alignment,
- Hibernate 6 membawa perubahan besar pada query engine, SQL generation, type system, dialect, dan internal APIs,
- EclipseLink 4.0 adalah major release untuk Jakarta EE 10 dan Jakarta Persistence 3.1,
- Java 17 sering menjadi minimum runtime untuk platform modern.

### 3.3 Modern world: Java 17/21/25, Jakarta Persistence 3.2

Typical stack modern:

```text
Java 17 / 21 / 25
Jakarta Persistence 3.2
Hibernate 7.x or EclipseLink 5.x
Jakarta EE 11 / modern Spring ecosystem
```

Karakteristik:

- Jakarta Persistence 3.2 adalah baseline specification modern untuk Jakarta EE 11.
- Hibernate 7.x melanjutkan modernisasi Hibernate 6.
- EclipseLink 5.x adalah major modernization release yang menargetkan Jakarta Persistence 3.2/Jakarta EE 11.
- Java 21/25 memungkinkan runtime modern, tetapi ORM migration tetap harus diuji pada bytecode enhancement, proxying, reflection, classpath/module path, dan framework integration.

### 3.4 Jangan campur baseline secara sembarangan

Salah satu kesalahan paling umum:

```text
Spring Boot 3.x
+ dependency javax.persistence-api
+ Hibernate 6.x
+ old hibernate-types library
+ old app server API
```

Ini akan menghasilkan classpath yang terlihat “hampir benar”, tetapi runtime-nya rapuh.

Rule:

```text
Satu application runtime harus punya satu generasi API:
- javax generation, atau
- jakarta generation.
```

Campuran mungkin terjadi di boundary tertentu, misalnya integrasi library lama via adapter, tetapi **persistence runtime utama tidak boleh campur**.

---

## 4. Migration Dimensions

ORM migration harus dipecah menjadi beberapa dimensi agar tidak semua risiko bercampur.

```text
1. Java runtime migration
   Java 8 -> 11 -> 17 -> 21 -> 25

2. API namespace migration
   javax.persistence -> jakarta.persistence

3. Provider migration
   Hibernate 5 -> 6 -> 7
   EclipseLink 2 -> 3/4 -> 5

4. Framework migration
   Spring Boot 2 -> 3
   Java EE -> Jakarta EE
   app server upgrade

5. Database dialect migration
   old dialect class -> new dialect resolution
   DB version support changes

6. Mapping migration
   annotations, XML mapping, converters, custom types

7. Query migration
   JPQL/HQL/Criteria/native SQL/stored procedure

8. Operational migration
   logging, metrics, cache, schema validation, rollout
```

Migration yang aman jarang dilakukan sebagai satu big bang. Lebih baik dibuat sebagai sequence of reversible moves.

---

## 5. Migration Strategy Overview

### 5.1 Bad migration strategy

```text
1. Change all dependency versions.
2. Rename imports.
3. Fix compile errors.
4. Run unit tests.
5. Deploy to UAT.
6. Hope production is fine.
```

Masalahnya: ini hanya menguji sebagian kecil semantic surface area.

### 5.2 Strong migration strategy

```text
Phase 0 — Inventory and baseline capture
Phase 1 — Dependency and API alignment
Phase 2 — Compile migration
Phase 3 — Bootstrap migration
Phase 4 — Mapping validation
Phase 5 — Query behavior validation
Phase 6 — SQL shape regression
Phase 7 — Transaction/cache/locking validation
Phase 8 — Performance regression
Phase 9 — Rollout and rollback plan
Phase 10 — Post-migration hardening
```

Setiap phase punya evidence.

Evidence yang dicari:

- aplikasi compile,
- aplikasi boot,
- semua persistence unit terbaca,
- semua mapping valid,
- generated SQL untuk query penting tidak berubah secara berbahaya,
- row count dan result ordering benar,
- transaction semantics tetap benar,
- locking behavior tetap melindungi lost update,
- cache tidak membocorkan stale/cross-tenant data,
- performance endpoint penting tidak turun drastis,
- rollback dependency dan database aman.

---

## 6. Phase 0 — Inventory and Baseline Capture

Migration tanpa inventory adalah spekulasi.

### 6.1 Dependency inventory

Kumpulkan:

```text
- Java version runtime dan compile target
- Build tool version: Maven/Gradle
- Framework: Spring Boot/Jakarta EE/Quarkus/Micronaut
- JPA API dependency
- Hibernate/EclipseLink version
- Hibernate Validator/Jakarta Validation version
- Transaction API version
- App server version
- JDBC driver version
- Database version
- Connection pool version
- Cache provider version
- Migration tool: Flyway/Liquibase
- Libraries yang menyentuh Hibernate internal API
```

Contoh Maven command:

```bash
mvn -q dependency:tree > dependency-tree.txt
```

Contoh Gradle command:

```bash
./gradlew dependencies > dependencies.txt
./gradlew dependencyInsight --dependency hibernate-core
./gradlew dependencyInsight --dependency jakarta.persistence
./gradlew dependencyInsight --dependency javax.persistence
```

Cari tanda bahaya:

```text
javax.persistence-api muncul bersama jakarta.persistence-api
hibernate-core versi lama tertarik transitif
old hibernate-types library belum compatible
javax.validation muncul di runtime Jakarta
old javax.transaction-api muncul di Spring Boot 3/Jakarta stack
old JAXB dependency konflik dengan Jakarta XML Binding
```

### 6.2 Persistence inventory

Kumpulkan:

```text
- jumlah entity
- jumlah embeddable
- jumlah converter
- jumlah named query
- jumlah native query
- jumlah stored procedure mapping
- jumlah XML mapping
- custom Hibernate types
- entity listener/interceptor
- second-level cache regions
- query cache usage
- filters/multi-tenancy config
- schema generation setting
- database-specific annotations
```

Contoh checklist:

```text
[ ] Semua @Entity terdaftar?
[ ] Ada orm.xml?
[ ] Ada persistence.xml?
[ ] Ada hbm.xml legacy?
[ ] Ada @Type/@TypeDef legacy Hibernate?
[ ] Ada @Filter/@Where/@SQLDelete?
[ ] Ada @Subselect/@Formula?
[ ] Ada @NamedNativeQuery?
[ ] Ada @SqlResultSetMapping?
[ ] Ada AttributeConverter autoApply=true?
[ ] Ada custom UserType/BasicType?
[ ] Ada 2nd-level cache provider?
[ ] Ada custom PhysicalNamingStrategy?
[ ] Ada custom ImplicitNamingStrategy?
[ ] Ada Integrator/EventListener/Interceptor?
```

### 6.3 Runtime behavior baseline

Sebelum migration, ambil baseline:

```text
- startup logs persistence provider
- schema validation output
- list generated SQL untuk top queries
- query count per critical endpoint
- endpoint latency p50/p95/p99
- DB CPU/load for representative test
- connection pool active/wait metrics
- L2 cache hit/miss/put
- Hibernate statistics if applicable
- deadlock/lock wait baseline
- memory allocation/hydration pressure
```

Tanpa baseline, “lebih lambat” akan menjadi debat subjektif.

---

## 7. Phase 1 — Dependency and API Alignment

### 7.1 The namespace break

Perpindahan dari Java EE/JPA ke Jakarta EE/Jakarta Persistence bukan hanya rename package:

```java
// Old
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.ManyToOne;

// New
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
```

Tetapi juga menyentuh API lain:

```text
javax.persistence       -> jakarta.persistence
javax.transaction       -> jakarta.transaction
javax.validation        -> jakarta.validation
javax.annotation        -> jakarta.annotation
javax.servlet           -> jakarta.servlet
javax.ws.rs             -> jakarta.ws.rs
javax.xml.bind          -> jakarta.xml.bind
```

Jika hanya mengganti persistence import, aplikasi modern bisa tetap rusak karena dependency lain belum ikut pindah.

### 7.2 Dependency alignment by platform

Contoh alignment legacy:

```text
Java 8
Spring Boot 2.7.x
Hibernate 5.6.x
javax.persistence-api 2.2
javax.validation 2.x
```

Contoh alignment modern:

```text
Java 17+
Spring Boot 3.x
Hibernate 6.x/7.x depending Boot support
jakarta.persistence 3.x
jakarta.validation 3.x
jakarta.transaction 2.x
```

Contoh Jakarta EE alignment:

```text
Jakarta EE 10
Jakarta Persistence 3.1
EclipseLink 4.x or compatible provider
Java 11/17 depending runtime

Jakarta EE 11
Jakarta Persistence 3.2
EclipseLink 5.x or compatible provider
Java 17+
```

### 7.3 Dependency rule

Do not manually override provider versions unless you know the integration matrix.

Dalam Spring Boot, provider version sering dikelola oleh BOM. Override Hibernate bisa mematahkan:

- Spring ORM adapter,
- transaction integration,
- boot auto configuration,
- naming strategy assumptions,
- metrics integration,
- JPA property names,
- bytecode enhancer plugin compatibility.

Rule:

```text
Prefer platform BOM first.
Override only with explicit compatibility test.
```

---

## 8. Phase 2 — Compile Migration

Compile migration adalah phase paling mudah, tetapi tetap perlu disiplin.

### 8.1 Rename imports

Gunakan automated refactoring:

```text
javax.persistence.*      -> jakarta.persistence.*
javax.transaction.*      -> jakarta.transaction.*
javax.validation.*       -> jakarta.validation.*
javax.annotation.*       -> jakarta.annotation.*
```

Jangan lakukan manual search-replace tanpa compile/test karena:

- ada string config,
- XML namespace,
- generated source,
- old library API,
- annotation processor,
- test fixtures.

### 8.2 XML migration

Cek file:

```text
persistence.xml
orm.xml
hbm.xml
validation.xml
web.xml
application server descriptors
Spring XML config if any
```

Contoh persistence.xml modern:

```xml
<persistence xmlns="https://jakarta.ee/xml/ns/persistence"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xsi:schemaLocation="https://jakarta.ee/xml/ns/persistence
                                 https://jakarta.ee/xml/ns/persistence/persistence_3_2.xsd"
             version="3.2">
    <persistence-unit name="appPU">
        <provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
    </persistence-unit>
</persistence>
```

### 8.3 Generated source and annotation processors

Tools seperti Lombok, MapStruct, QueryDSL, JPA metamodel generator, dan custom code generator bisa masih menghasilkan `javax` import.

Cek:

```text
- target/generated-sources
- build/generated
- generated metamodel classes
- generated mappers
- generated DTO/entity stubs
```

### 8.4 Static metamodel

Old:

```java
import javax.persistence.metamodel.SingularAttribute;
```

New:

```java
import jakarta.persistence.metamodel.SingularAttribute;
```

Jika metamodel generator belum compatible, Criteria query bisa gagal compile meskipun entity sudah berhasil dimigrasi.

---

## 9. Phase 3 — Bootstrap Migration

Aplikasi compile belum berarti persistence provider bisa boot.

### 9.1 Common bootstrap failures

```text
- No Persistence provider for EntityManager named X
- Not a managed type
- Unable to build Hibernate SessionFactory
- Repeated column mapping
- Unknown access type
- Converter class not found
- Could not resolve dialect
- Unable to instantiate custom type
- Mixed javax/jakarta annotations ignored
```

### 9.2 Mixed annotation trap

Contoh bug:

```java
import jakarta.persistence.Entity;
import javax.persistence.Id;

@Entity
public class CaseFile {
    @Id
    private Long id;
}
```

Bagi developer, class ini “terlihat entity”. Bagi provider modern, `javax.persistence.Id` bisa tidak dianggap sebagai ID annotation yang benar.

Akibat:

```text
Entity has no identifier
Not a managed type
Mapping ignored partially
```

Rule:

```text
Dalam satu entity model, jangan campur javax dan jakarta annotations.
```

### 9.3 Provider selection

Jika ada lebih dari satu provider di classpath:

```text
hibernate-core
org.eclipse.persistence.jpa
old app server provider
```

Provider selection bisa menjadi ambigu.

Tetapkan eksplisit bila perlu:

```xml
<provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
```

atau untuk EclipseLink:

```xml
<provider>org.eclipse.persistence.jpa.PersistenceProvider</provider>
```

### 9.4 Bootstrap evidence

Setelah boot berhasil, capture:

```text
- provider name/version
- dialect/database platform
- number of entities
- schema validation result
- enhancer/weaving status
- cache region initialization
- named query validation
```

---

## 10. Phase 4 — Mapping Validation

Mapping validation menjawab pertanyaan:

> Apakah entity model masih dipahami provider dengan cara yang sama?

### 10.1 Access type regression

JPA menentukan access type berdasarkan lokasi annotation utama.

Field access:

```java
@Entity
public class Person {
    @Id
    private Long id;

    private String name;
}
```

Property access:

```java
@Entity
public class Person {
    private Long id;
    private String name;

    @Id
    public Long getId() {
        return id;
    }
}
```

Migration bisa memunculkan bug jika annotation tercampur antara field dan getter.

### 10.2 Type mapping regression

Cek mapping untuk:

```text
- enum
- UUID
- Java Time API
- BigDecimal precision/scale
- boolean
- LOB
- JSON/XML columns
- array/custom SQL type
- embeddable
- converter
```

Hibernate 6/7 membawa perubahan signifikan pada type system dibanding Hibernate 5. Custom type lama sering perlu rewrite.

### 10.3 ID generator regression

Cek:

```text
- GenerationType.IDENTITY
- GenerationType.SEQUENCE
- sequence allocationSize
- pooled optimizer
- table generator
- UUID generator
- assigned ID
- composite ID
```

ID generator memengaruhi:

- insert batching,
- sequence calls,
- transaction throughput,
- insert order,
- database contention.

### 10.4 Naming strategy regression

Cek table/column names generated:

```text
CaseFile.caseNumber
case_file.case_number
CASE_FILE.CASE_NUMBER
"CaseFile"."caseNumber"
```

Perubahan naming strategy bisa membuat schema validation gagal atau, lebih buruk, query mengarah ke table/column berbeda jika database case-sensitive/quoted identifier.

---

## 11. Phase 5 — Query Behavior Validation

Query migration adalah area berbahaya karena banyak query compile tetapi result berubah.

### 11.1 JPQL/HQL strictness

Provider baru bisa lebih strict terhadap:

```text
- implicit select
- path expression ambiguity
- implicit joins
- function type inference
- enum literal
- parameter type
- collection-valued path usage
- group by expression
- constructor expression
```

Contoh query rapuh:

```java
select c
from CaseFile c
where c.status = 'OPEN'
```

Lebih aman:

```java
select c
from CaseFile c
where c.status = :status
```

Dengan binding:

```java
query.setParameter("status", CaseStatus.OPEN);
```

### 11.2 Criteria migration

Criteria API type-safe tetapi tidak otomatis bebas migration risk.

Cek:

```text
- generated static metamodel
- function expression
- join reuse
- fetch join with pagination
- tuple alias
- count query generation
- dynamic predicate composition
```

### 11.3 Native query migration

Native query terlihat aman karena SQL ditulis manual. Tetapi mapping-nya tetap diproses provider.

Cek:

```text
- scalar type mapping
- column alias case sensitivity
- SqlResultSetMapping
- constructor result
- entity result
- pagination handling
- stored procedure call
- ref cursor support
```

Contoh alias risk:

```sql
select c.case_id as caseId from case_file c
```

Provider/database tertentu bisa mengembalikan alias sebagai:

```text
caseId
CASEID
caseid
```

Jika mapping bergantung pada alias case, migration bisa rusak.

### 11.4 Query validation evidence

Untuk setiap critical query, simpan:

```text
- query source
- input parameters
- generated SQL old vs new
- bind type old vs new
- row count old vs new
- ordering old vs new
- execution plan old vs new
- p95 latency old vs new
```

---

## 12. Phase 6 — SQL Shape Regression

SQL shape adalah output paling penting dari ORM provider.

### 12.1 Apa yang harus dibandingkan

Bandingkan old vs new:

```text
- number of SQL statements
- join order
- join type: inner vs left
- selected columns
- where predicates
- order by
- pagination syntax
- lock syntax
- sequence calls
- insert/update/delete order
- batch grouping
- JDBC bind types
```

### 12.2 Example: subtle pagination drift

Old generated SQL:

```sql
select *
from case_file
where status = ?
order by created_at desc
offset ? rows fetch next ? rows only
```

New generated SQL could be structurally different depending dialect/provider:

```sql
select *
from (
    select c.*, row_number() over(order by c.created_at desc) rn
    from case_file c
    where c.status = ?
)
where rn between ? and ?
```

Both may return the same rows. But execution plan, index usage, memory sort, and bind behavior can differ.

### 12.3 SQL count assertion

For critical endpoints, assert query count.

Example intent:

```text
GET /cases/{id}/summary
Expected:
- 1 query for case header
- 1 query for active tasks
- 1 query for latest audit entries
- no lazy query after DTO assembly
```

If after migration query count jumps from 3 to 53, it is not merely a performance issue. It means fetch plan semantics changed.

---

## 13. Phase 7 — Transaction, Locking, and Cache Validation

### 13.1 Transaction semantics

Test:

```text
- flush before query
- rollback after flush
- exception marks transaction rollback-only
- nested service call propagation
- read-only transaction behavior
- lazy loading inside/outside transaction
```

Migration can change integration behavior through framework/provider adapter.

### 13.2 Optimistic locking

Test:

```text
T1 reads entity version 1
T2 reads entity version 1
T1 updates -> version 2
T2 updates -> must fail optimistic lock
```

Do this for:

```text
- simple entity
- aggregate root
- detached DTO update
- merge operation
- collection change
- bulk update impact
```

### 13.3 Pessimistic locking

Test generated SQL:

```text
FOR UPDATE
FOR UPDATE NOWAIT
FOR UPDATE SKIP LOCKED
lock timeout hint
```

Dialect/provider migration can change lock clause.

### 13.4 Cache behavior

Test:

```text
- L2 cache hit/miss
- entity invalidation on update
- collection cache invalidation
- query cache invalidation
- natural ID cache
- multi-tenant cache key isolation
- cache after native update
```

Cache bugs are dangerous because they often appear as “random stale data”.

---

## 14. Phase 8 — Performance Regression

### 14.1 Performance dimensions

Measure:

```text
- endpoint latency p50/p95/p99
- DB CPU
- DB logical reads
- rows scanned
- rows returned
- number of SQL statements
- connection wait time
- transaction duration
- heap allocation
- GC pause/pressure
- flush time
- dirty checking time
- cache hit ratio
```

### 14.2 Workload categories

Test at least:

```text
1. Single entity read
2. Aggregate read
3. Paginated listing
4. Search/filter query
5. Create aggregate
6. Update aggregate
7. Delete/soft delete
8. Bulk mutation
9. Batch import
10. Concurrent update
11. Report/export query
12. Cache-heavy lookup
```

### 14.3 Do not trust H2 for migration performance

H2 can help compile/test simple logic, but it cannot represent:

```text
- Oracle pagination
- PostgreSQL JSON binding
- MySQL locking behavior
- SQL Server identifier rules
- real indexes/statistics
- real execution plans
- real transaction isolation behavior
```

Use the target database for migration regression.

---

## 15. Javax to Jakarta Migration Deep Dive

### 15.1 What changes

Main visible change:

```text
javax.persistence -> jakarta.persistence
```

But practical migration includes:

```text
- source imports
- generated sources
- XML schemas
- provider dependencies
- validation annotations
- transaction annotations
- servlet/JAX-RS/CDI integrations
- app server runtime
- test dependencies
- annotation processors
```

### 15.2 Compatibility trap: same class names, different types

`javax.persistence.EntityManager` and `jakarta.persistence.EntityManager` are different types.

A library compiled against `javax.persistence.EntityManager` cannot transparently accept `jakarta.persistence.EntityManager`.

Adapter/wrapper may be possible for narrow cases, but persistence framework integration usually must be upgraded as a whole.

### 15.3 Library compatibility matrix

For every library touching JPA, identify Jakarta-compatible version:

```text
- Spring Data JPA
- Hibernate Envers
- Hibernate Search
- Hypersistence Utils / hibernate-types equivalent
- QueryDSL
- Blaze-Persistence
- Javers
- MapStruct processors if using generated JPA metamodel
- test utilities
- audit libraries
- multi-tenancy libraries
```

### 15.4 Migration rule

```text
Do not mix javax and jakarta in the same persistence runtime.
Do not upgrade provider without upgrading integration framework.
Do not upgrade framework without validating provider version compatibility.
```

---

## 16. Hibernate 5 to 6 Migration Deep Dive

Hibernate 6 is not a small upgrade from Hibernate 5. It modernized major internals.

### 16.1 High-risk areas

```text
- HQL/JPQL parser and semantic model
- SQL AST generation
- type system
- custom UserType/BasicType
- dialect classes
- identifier generation
- Criteria behavior
- native query result mapping
- function registration
- bootstrapping/internal APIs
- deprecated annotations/extensions
```

### 16.2 Dialect changes

Old code often uses explicit dialect:

```properties
hibernate.dialect=org.hibernate.dialect.Oracle12cDialect
```

New Hibernate versions may consolidate dialects or auto-detect based on database metadata. Old dialect class names can be deprecated or removed.

Migration checklist:

```text
[ ] Verify actual database version
[ ] Verify dialect selected at startup
[ ] Remove obsolete explicit dialect if auto-detection is reliable
[ ] Keep explicit dialect only if there is a reason
[ ] Compare generated pagination SQL
[ ] Compare lock SQL
[ ] Compare sequence/identity SQL
[ ] Compare LOB handling
```

### 16.3 Type system changes

Custom types written for Hibernate 5 often break.

Old style might involve:

```text
UserType
CompositeUserType
BasicType
TypeDef
```

Migration needs review of:

```text
- Java type descriptor
- JDBC type descriptor
- mutability plan
- value conversion
- null handling
- literal rendering
- query parameter binding
```

Do not merely “make it compile”. A custom type can compile but bind incorrectly.

### 16.4 Query changes

Expect some HQL that Hibernate 5 accepted to fail or behave differently in Hibernate 6.

Risk categories:

```text
- implicit join ambiguity
- comparing entity to scalar ID
- database function typing
- select new constructor matching
- group by validation
- collection path usage
- enum literal handling
- date/time arithmetic
```

### 16.5 Native query result changes

Validate:

```text
- scalar result type
- BigInteger vs Long
- Timestamp vs LocalDateTime
- alias handling
- result transformer replacements
- tuple mapping
```

### 16.6 Migration evidence

For Hibernate 5→6, minimum evidence:

```text
- all named queries validated
- all custom types rewritten/tested
- top 30 queries SQL diffed
- critical native queries result type checked
- dialect selected correctly
- batching still works
- optimistic locking tested
- query count per endpoint compared
```

---

## 17. Hibernate 6 to 7 Migration Deep Dive

Hibernate 7 continues the modern line. Compared to 5→6, it may be less disruptive for apps already cleanly on 6, but still requires controlled migration.

### 17.1 Areas to review

```text
- Jakarta Persistence version alignment
- deprecated Hibernate 6 APIs removed/changed
- query behavior changes
- extension SPI changes
- cache behavior changes
- stateless session behavior
- build-time enhancement plugin compatibility
- integration framework support
```

### 17.2 Do not jump without platform support

If using Spring Boot, Quarkus, or app server-managed JPA, do not upgrade Hibernate independently unless:

```text
- framework officially supports it,
- transaction integration tested,
- boot auto-config tested,
- metrics/observability tested,
- schema tooling tested.
```

### 17.3 Hibernate 8 development line

Hibernate 8 may exist as development/alpha line. Treat it as:

```text
- learning/research candidate,
- proof-of-concept candidate,
- not default production target unless your organization explicitly accepts that risk.
```

---

## 18. EclipseLink 2 to 3/4/5 Migration Deep Dive

### 18.1 EclipseLink 2.x legacy world

Typical:

```text
Java 8
javax.persistence
EclipseLink 2.x
Java EE app server
```

Migration pressure often comes from:

```text
- app server upgrade,
- Jakarta namespace migration,
- Java runtime upgrade,
- security patching,
- moving to Jakarta EE 10/11.
```

### 18.2 EclipseLink 4.x

EclipseLink 4.x is aligned with Jakarta EE 10/Jakarta Persistence 3.1 era.

Migration risks:

```text
- package namespace shift
- weaving setup
- shared cache behavior
- descriptor customization
- platform/database detection
- XML mapping schema
- server integration
```

### 18.3 EclipseLink 5.x

EclipseLink 5.x targets the newer Jakarta Persistence 3.2/Jakarta EE 11 generation.

Review:

```text
- minimum Java requirement of platform/runtime
- Jakarta Persistence 3.2 APIs
- JPQL/Criteria changes
- descriptor customizers
- converter extensions
- weaving/static weaving build pipeline
```

### 18.4 EclipseLink-specific migration checks

```text
[ ] Is weaving enabled as expected?
[ ] Dynamic weaving works in the runtime classloader?
[ ] Static weaving applied in build output?
[ ] Fetch groups still behave correctly?
[ ] Batch reading settings still applied?
[ ] Shared cache isolation correct?
[ ] Descriptor customizers still invoked?
[ ] Tenant discriminator still applied?
[ ] EclipseLink query hints still recognized?
[ ] Database platform detected correctly?
```

---

## 19. Framework Migration Interactions

### 19.1 Spring Boot 2 to 3

Spring Boot 3 implies Jakarta ecosystem migration.

Risk areas:

```text
- javax -> jakarta namespace
- Hibernate 5 -> 6 by default in many Boot 3 lines
- Spring Data JPA behavior compatibility
- transaction manager integration
- OpenEntityManagerInView defaults/config
- test slice behavior
- validation annotations
- servlet/security namespace
```

Migration plan:

```text
1. Upgrade Java baseline.
2. Upgrade Spring Boot with BOM alignment.
3. Remove javax dependencies.
4. Fix imports/generated code.
5. Validate Hibernate 6 behavior.
6. Validate integration tests on real database.
```

### 19.2 Jakarta EE server migration

For app-server-managed JPA:

```text
- provider may be supplied by server,
- application-bundled provider can conflict,
- JTA behavior depends on server,
- classloader isolation matters,
- weaving/enhancement may depend on server instrumentation.
```

Questions to answer:

```text
[ ] Is provider server-managed or app-bundled?
[ ] Which Jakarta EE version does server support?
[ ] Which Persistence version is included?
[ ] Can app override provider?
[ ] How are JTA transactions configured?
[ ] Does server support weaving/enhancement?
```

---

## 20. Database Dialect and Driver Migration

ORM migration often coincides with JDBC driver or DB version upgrade.

### 20.1 JDBC driver matters

Driver changes can affect:

```text
- timestamp/timezone binding
- LOB streaming
- fetch size
- batch behavior
- generated keys
- statement cache
- connection metadata
- database version detection
```

### 20.2 Dialect/platform matters

Dialect changes can affect:

```text
- pagination SQL
- sequence syntax
- identity support
- boolean mapping
- UUID mapping
- JSON type support
- lock hints
- current timestamp function
- merge/upsert support
- temporary table strategy
```

### 20.3 Oracle example checklist

```text
[ ] NUMBER precision mapping unchanged?
[ ] TIMESTAMP WITH TIME ZONE handled correctly?
[ ] CLOB/BLOB lazy behavior tested?
[ ] Sequence allocation matches DB sequence increment?
[ ] Pagination SQL uses expected syntax?
[ ] FOR UPDATE/NOWAIT/SKIP LOCKED generated as expected?
[ ] Identifier length/casing safe?
```

### 20.4 PostgreSQL example checklist

```text
[ ] UUID binding correct?
[ ] JSON/JSONB custom type migrated?
[ ] enum custom type migrated?
[ ] array binding tested?
[ ] timestamp timezone policy tested?
[ ] SKIP LOCKED generated correctly?
```

---

## 21. Schema Migration Discipline

Do not combine provider migration with uncontrolled schema generation.

### 21.1 Recommended settings by environment

Development:

```properties
hibernate.hbm2ddl.auto=validate
```

or controlled local reset only:

```properties
hibernate.hbm2ddl.auto=create-drop
```

Production:

```properties
hibernate.hbm2ddl.auto=validate
```

or no automatic DDL at all, depending platform.

Avoid in production:

```properties
hibernate.hbm2ddl.auto=update
```

### 21.2 Migration DDL source of truth

Use:

```text
- Flyway
- Liquibase
- reviewed SQL migration
- DBA-approved DDL
```

ORM schema generation can help detect drift, but should not silently mutate production schema.

### 21.3 Schema diff evidence

Compare:

```text
- tables
- columns
- nullable flags
- type definitions
- length/precision/scale
- indexes
- unique constraints
- foreign keys
- sequences
- default values
```

---

## 22. Query and SQL Regression Harness

A strong migration includes automated query regression.

### 22.1 SQL capture approach

Use one or more:

```text
- Hibernate StatementInspector
- datasource proxy
- p6spy
- JDBC wrapper
- database slow query log
- OpenTelemetry instrumentation
- provider statistics
```

### 22.2 Golden query snapshots

For critical use cases:

```text
use-case: Search active cases
input: status=OPEN, agency=CEA, page=0,size=20
expected:
  statement_count <= 3
  no select from document_blob
  uses case_status_idx
  no cartesian join
  ordered by created_at desc, id desc
```

Do not require SQL string to be byte-for-byte identical unless necessary. Require important properties.

### 22.3 Assertion examples

```text
[ ] query count did not increase beyond threshold
[ ] no unbounded select on large table
[ ] no unexpected eager LOB column
[ ] no duplicate root results
[ ] pagination stable
[ ] order deterministic
[ ] result count same old/new
[ ] execution plan acceptable
```

---

## 23. Migration of Custom Hibernate Types

Custom type migration is high-risk.

### 23.1 Identify custom type usage

Search for:

```text
@Type
@TypeDef
@TypeDefs
UserType
CompositeUserType
BasicType
AttributeConverter
JavaTypeDescriptor
SqlTypeDescriptor
JdbcType
JavaType
```

### 23.2 Migration principles

For each custom type, define:

```text
- Java domain type
- JDBC type
- database column type
- null handling
- mutability
- deep copy behavior
- equality behavior
- bind behavior
- extract behavior
- literal rendering
- query parameter behavior
```

### 23.3 Test matrix

```text
[ ] persist non-null value
[ ] persist null value
[ ] query by value
[ ] update value
[ ] dirty checking detects change
[ ] dirty checking ignores no-op change
[ ] second-level cache serialization works
[ ] native query mapping works if used
[ ] schema validation passes
```

---

## 24. Migration of Entity Listeners, Interceptors, and Events

Entity lifecycle hooks are often invisible until they break.

### 24.1 Inventory

Search for:

```text
@EntityListeners
@PrePersist
@PostPersist
@PreUpdate
@PostUpdate
@PreRemove
@PostRemove
@PostLoad
Interceptor
EventListener
Integrator
StatementInspector
SessionFactoryObserver
DescriptorCustomizer
SessionCustomizer
```

### 24.2 Risks

```text
- listener not invoked
- listener invoked at different time
- listener causes lazy load
- listener performs query during flush
- listener depends on old provider internal API
- auditing misses bulk operations
- tenant/security context unavailable
```

### 24.3 Rule

Entity listeners should be small and deterministic. Complex side effects belong in service/domain event layer, not flush-time callback.

---

## 25. Migration of Cache Configuration

### 25.1 Hibernate cache migration

Check:

```text
- cache provider compatibility
- region factory class
- region names
- entity cache annotations
- collection cache annotations
- query cache enabled/disabled
- natural ID cache
- cache concurrency strategy
```

Common old config may no longer be valid.

### 25.2 EclipseLink shared cache migration

Check:

```text
- shared cache defaults
- @Cache annotation
- isolation setting
- invalidation policy
- coordination in cluster
- tenant isolation
```

### 25.3 Cache validation scenario

```text
T1 reads entity -> cache populated
T2 updates entity -> cache invalidated/updated
T1 reads again -> must see correct data according to transaction/isolation policy
Native update -> cache must be evicted or bypassed
Tenant A read -> Tenant B must not receive cached Tenant A data
```

---

## 26. Rollout Strategy

### 26.1 Feature flag is not enough

ORM provider migration usually cannot be toggled per request inside one running application.

Better strategies:

```text
- blue/green deployment
- canary deployment
- shadow read comparison
- read-only mirror traffic
- dual-run selected queries in non-prod
- endpoint-level canary if separate services
```

### 26.2 Rollback planning

Rollback must consider:

```text
- did schema change?
- did data format change?
- did ID generation change?
- did enum representation change?
- did cache format change?
- did audit/event format change?
- can old app read rows written by new app?
```

If new app writes data old app cannot read, rollback is not safe.

### 26.3 Expand-contract strategy

For schema-affecting migration:

```text
1. Expand schema: add new nullable columns/tables/indexes.
2. Deploy app compatible with old and new shape.
3. Backfill data.
4. Switch reads/writes.
5. Verify.
6. Contract old schema later.
```

---

## 27. Production Readiness Checklist

Before production:

```text
[ ] Dependency tree has no unwanted javax/jakarta mixing.
[ ] Provider version is explicitly known and logged.
[ ] Database dialect/platform verified.
[ ] All persistence units boot.
[ ] Schema validation passes.
[ ] All named queries validated.
[ ] Critical JPQL/HQL/Criteria/native queries tested.
[ ] SQL count compared for critical endpoints.
[ ] Generated SQL shape reviewed for high-risk flows.
[ ] Optimistic locking tested.
[ ] Pessimistic locking tested if used.
[ ] Batch processing tested at realistic volume.
[ ] L2/query cache tested or disabled consciously.
[ ] Custom types/converters tested.
[ ] Entity listeners/interceptors tested.
[ ] Multi-tenancy/filter/soft delete tested if used.
[ ] Migration scripts reversible or rollback-safe.
[ ] Observability dashboards updated.
[ ] Rollback plan documented.
[ ] Canary/blue-green plan ready.
```

---

## 28. Failure Modes and Diagnosis

### 28.1 Compile passes, runtime says “not a managed type”

Likely causes:

```text
- mixed javax/jakarta annotations
- entity scan package changed
- generated entity not included
- provider not selected
- classloader issue
- module opens missing
```

Diagnosis:

```text
- inspect imports
- log managed entity count
- verify scan packages
- verify persistence.xml
- verify provider dependency
```

### 28.2 Startup fails on custom type

Likely causes:

```text
- Hibernate 5 custom type API not compatible with Hibernate 6/7
- old @TypeDef usage
- missing mutability plan
- JDBC type not registered
```

Fix:

```text
- rewrite custom type for new provider API
- prefer AttributeConverter when enough
- add dedicated tests for binding/extraction/dirty checking
```

### 28.3 Query returns different results

Likely causes:

```text
- implicit join behavior changed
- ordering was not deterministic
- null ordering changed
- enum/string binding changed
- pagination SQL changed
- duplicate root rows from fetch join
```

Fix:

```text
- make joins explicit
- make ordering deterministic
- add secondary order by ID
- use typed parameters
- validate generated SQL
```

### 28.4 Endpoint becomes slower

Likely causes:

```text
- N+1 introduced
- join fetch became cartesian product
- batching disabled
- sequence allocation changed
- dialect changed pagination plan
- dirty checking cost increased
- LOB fetched eagerly
```

Fix:

```text
- compare SQL count
- compare execution plan
- inspect fetch plan
- check ID generation/batching
- inspect selected columns
```

### 28.5 Stale data appears

Likely causes:

```text
- L2 cache config changed
- query cache invalidation issue
- native update bypassed cache
- transaction boundary changed
- long persistence context reused
```

Fix:

```text
- disable query cache first if uncertain
- evict cache after native/bulk mutation
- shorten persistence context
- add cache correctness tests
```

---

## 29. Recommended Migration Playbooks

### 29.1 Java 8 + Hibernate 5 + javax to Java 17 + Spring Boot 3 + Hibernate 6

Recommended sequence:

```text
1. Stabilize current app on latest safe Hibernate 5.6/Spring Boot 2.7 if possible.
2. Capture baseline SQL/performance.
3. Upgrade Java runtime compatibility to 17 while still on old stack if possible.
4. Move to Spring Boot 3/BOM-managed dependencies.
5. Migrate javax to jakarta.
6. Fix compile errors.
7. Fix Hibernate 6 mapping/type/query issues.
8. Validate SQL/query/performance.
9. Roll out with canary.
```

Avoid:

```text
Java 8 -> 17
Spring Boot 2 -> 3
Hibernate 5 -> 6
javax -> jakarta
DB driver upgrade
schema changes
```

all in one unmeasured jump.

### 29.2 Hibernate 6 to 7

Recommended sequence:

```text
1. Ensure app is clean on latest compatible Hibernate 6 line.
2. Remove deprecated API usage where possible.
3. Validate framework support for Hibernate 7.
4. Upgrade in isolated branch.
5. Run query/type/cache/concurrency tests.
6. Compare SQL shape.
7. Performance regression.
```

### 29.3 EclipseLink 2.x to 4/5

Recommended sequence:

```text
1. Inventory app-server/provider ownership.
2. Decide target Jakarta EE platform.
3. Migrate namespace javax -> jakarta.
4. Align app server and EclipseLink version.
5. Validate weaving.
6. Validate descriptors/customizers/converters.
7. Validate shared cache and query hints.
8. Validate JPQL/native queries.
9. Run production-like performance regression.
```

---

## 30. Design Rules

1. **Never treat ORM migration as dependency update only.**
2. **Do not mix `javax` and `jakarta` in one persistence runtime.**
3. **Provider upgrade must include SQL shape regression.**
4. **Compile success is the weakest evidence.**
5. **Boot success is still weak evidence.**
6. **Query count and generated SQL matter more than “test green”.**
7. **Custom types require dedicated migration tests.**
8. **Native queries are not automatically safe.**
9. **Do not let ORM auto-update production schema during migration.**
10. **Cache must be treated as correctness component, not only performance component.**
11. **Do not migrate Java/framework/provider/database/schema all at once unless forced.**
12. **If forced into big-bang migration, increase evidence: SQL diff, data comparison, canary, rollback.**
13. **Rollback must be data-compatible, not only deployment-compatible.**
14. **The best migration is boring because every semantic change was known before production.**

---

## 31. Anti-Patterns

### 31.1 “Just replace javax with jakarta”

This ignores provider/framework/dependency/runtime compatibility.

### 31.2 “Hibernate is implementation detail”

At CRUD demo level, maybe. In real systems, Hibernate/EclipseLink behavior determines SQL, cache, flushing, locking, and performance.

### 31.3 “All tests pass, so migration is safe”

If tests do not assert SQL count, real DB behavior, locking, transaction, cache, and query shape, they do not prove migration safety.

### 31.4 “Use H2 for migration validation”

H2 does not represent Oracle/PostgreSQL/MySQL/SQL Server production behavior sufficiently.

### 31.5 “Enable ddl-auto=update to fix schema mismatch”

This hides drift and can mutate schema in ways that are hard to review or rollback.

### 31.6 “Turn off cache only after production stale data appears”

Cache behavior should be validated or disabled before rollout.

---

## 32. Diagnostic Checklist During Migration

When something breaks, ask in this order:

```text
1. Is this compile, boot, runtime functional, or workload drift?
2. Is the failure caused by API namespace mismatch?
3. Is provider version actually the one expected?
4. Is framework managing a different provider version?
5. Is the database dialect/platform correct?
6. Did generated SQL change?
7. Did bind type change?
8. Did transaction boundary change?
9. Did flush timing change?
10. Did fetch plan change?
11. Did cache participate?
12. Did custom type/converter participate?
13. Did native/bulk query bypass persistence context/cache?
14. Did test use the real database?
15. Is rollback data-compatible?
```

---

## 33. Practice Scenarios

### Scenario A — Mixed namespace

A team migrates to Spring Boot 3 and Hibernate 6. App fails with “entity has no identifier”. Entity source shows:

```java
import jakarta.persistence.Entity;
import javax.persistence.Id;

@Entity
class ApplicationRecord {
    @Id
    Long id;
}
```

Diagnosis:

```text
Mixed namespace. Provider sees jakarta @Entity but not javax @Id as the expected annotation.
```

Fix:

```text
Use jakarta.persistence.Id and remove javax persistence dependency from runtime.
```

### Scenario B — Slow endpoint after Hibernate 5→6

Old endpoint used 5 SQL statements. New endpoint uses 105.

Likely causes:

```text
- entity graph not applied
- batch fetch setting ignored/renamed
- fetch join changed
- OSIV hides lazy loads
```

Action:

```text
- compare SQL count
- inspect fetch graph usage
- assert no SQL during DTO serialization
- restore explicit fetch plan
```

### Scenario C — Custom JSON type breaks

Entity with PostgreSQL JSONB custom type compiles after migration but query by JSON field fails.

Likely causes:

```text
- old Hibernate 5 UserType not migrated properly
- JDBC type binding changed
- third-party hibernate-types library incompatible
```

Action:

```text
- migrate to compatible custom type library/version
- write persist/query/update/null tests
- inspect bind parameter type
```

### Scenario D — Rollback impossible

New app changes enum storage from ordinal to string and writes production rows. Old app expects ordinal.

Problem:

```text
Deployment rollback is possible, but data rollback is not automatically possible.
```

Fix strategy:

```text
- expand schema with new column
- dual-write temporarily
- backfill
- switch reads
- only later remove old representation
```

---

## 34. Summary

ORM migration is a controlled semantic migration of the persistence engine.

The hard part is not renaming imports. The hard part is proving that the system still performs the same durable state transitions under real workload and real database semantics.

A top-tier engineer approaches this migration by controlling:

```text
API namespace
Provider behavior
Framework integration
Database dialect
Mapping semantics
Query semantics
Transaction behavior
Locking behavior
Cache correctness
Performance profile
Rollout safety
Rollback compatibility
```

The migration is successful only when:

```text
- source code compiles,
- provider boots,
- mappings validate,
- queries return correct results,
- SQL shape is understood,
- performance remains acceptable,
- concurrency protection still works,
- cache remains correct,
- schema drift is controlled,
- rollback is safe.
```

The final mindset:

> Do not ask “does the app run after migration?” Ask “can we prove that every critical persistence behavior either stayed equivalent or changed intentionally?”

---

## 35. References

- Jakarta Persistence 3.2 Specification — official Jakarta EE specification for modern persistence baseline.
- Hibernate ORM migration guides — official migration guides per Hibernate series.
- Hibernate ORM documentation — official Hibernate documentation and user guide.
- EclipseLink documentation — official EclipseLink documentation for sessions, descriptors, weaving, cache, and JPA extensions.
- EclipseLink releases — official release notes for Jakarta Persistence/Jakarta EE alignment.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./31-testing-orm-correctness-beyond-repository-happy-path.md">⬅️ Part 31 — Testing ORM Correctness: Beyond Repository Happy Path</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./33-production-failure-playbook-symptoms-root-causes-fix-patterns.md">Part 33 — Production Failure Playbook: Symptoms, Root Causes, and Fix Patterns ➡️</a>
</div>
