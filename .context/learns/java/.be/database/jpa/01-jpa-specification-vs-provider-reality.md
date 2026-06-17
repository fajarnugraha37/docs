# Part 1 — JPA Specification vs Provider Reality

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `01-jpa-specification-vs-provider-reality.md`  
> Target pembaca: Java engineer yang sudah mengenal JPA/Jakarta Persistence dasar dan ingin naik ke level provider-aware persistence engineering.  
> Scope Java: Java 8 sampai Java 25.  
> Scope API: JPA 2.x (`javax.persistence`) sampai Jakarta Persistence 3.x (`jakarta.persistence`), dengan catatan transisi menuju Persistence 4.0 jika relevan.  
> Scope provider: Hibernate ORM dan EclipseLink sebagai dua provider utama yang perilakunya sering menentukan hasil akhir production.

---

## 0. Ringkasan Besar

JPA/Jakarta Persistence adalah **standard contract**. Hibernate ORM dan EclipseLink adalah **runtime engine** yang menjalankan kontrak tersebut dengan keputusan internal masing-masing.

Kesalahan besar banyak engineer adalah mengira:

```text
Saya memakai JPA annotation
=> berarti behavior saya portable, deterministic, dan sama di semua provider/database.
```

Realitasnya lebih dekat ke:

```text
JPA annotation mendeskripsikan intent minimum.
Provider menafsirkan intent itu.
Dialect menerjemahkannya ke SQL tertentu.
Database optimizer mengeksekusi SQL dengan constraint, index, isolation, dan statistics tertentu.
Transaction manager menentukan kapan flush/commit/rollback terjadi.
Application framework menentukan lifecycle EntityManager/Session.
```

Jadi mental model yang benar:

```text
JPA Spec = bahasa kontrak minimum
Provider = compiler + runtime object graph synchronization engine
Dialect = adapter ke grammar dan semantic database tertentu
Database = source of truth untuk durability, locking, constraint, dan execution plan
Framework = orchestrator lifecycle dan boundary
```

Top engineer tidak bertanya hanya:

```text
Annotation apa yang harus dipakai?
```

Tetapi bertanya:

```text
Kontrak apa yang dijamin spec?
Perilaku apa yang diserahkan ke provider?
SQL apa yang mungkin dihasilkan?
Kapan flush terjadi?
Bagaimana object graph di-memory berubah menjadi mutation database?
Apa failure mode saat provider/database/framework diganti?
```

---

## 1. Why This Matters

Pada aplikasi kecil, perbedaan antara JPA spec dan provider reality sering tidak terasa. CRUD sederhana berhasil, query sederhana jalan, dan repository tampak seperti abstraction yang rapi.

Pada aplikasi enterprise, terutama sistem case management, regulatory workflow, audit-heavy system, high-concurrency application, atau long-lived domain model, perbedaan ini menjadi besar.

Contoh kasus nyata yang sering muncul:

1. Query JPQL yang sama menghasilkan SQL berbeda antara provider atau versi provider.
2. Mapping association tampak benar, tetapi menghasilkan N+1 atau cartesian explosion.
3. Entity yang sama aman di Hibernate 5, tetapi berubah behavior saat migrasi ke Hibernate 6/7.
4. Aplikasi yang berjalan di Java 8 dengan `javax.persistence` tidak bisa langsung naik ke Jakarta EE modern karena namespace berubah ke `jakarta.persistence`.
5. Unit test lolos di H2, tetapi gagal di Oracle/PostgreSQL karena dialect, sequence, LOB, lock, timestamp precision, atau constraint berbeda.
6. Developer menganggap `merge()` mengubah object menjadi managed lagi, padahal provider menyalin state dari detached object ke managed instance lain.
7. Engineer menganggap `EAGER` berarti aman dari lazy loading error, tetapi malah membuat global fetch tax.
8. Engineer menganggap second-level cache adalah performance optimization umum, padahal cache correctness lebih sulit daripada cache speed.

Masalah-masalah ini tidak bisa diselesaikan dengan menghafal annotation. Butuh pemahaman batas antara:

- apa yang distandardisasi,
- apa yang provider-specific,
- apa yang database-specific,
- apa yang framework-specific,
- apa yang merupakan desain aplikasi sendiri.

---

## 2. Specification-Level Thinking

### 2.1 Apa Itu Specification?

Specification adalah dokumen kontrak. Dalam konteks JPA/Jakarta Persistence, specification mendefinisikan API dan semantic umum untuk mengelola persistence dan object-relational mapping.

Specification mendefinisikan hal seperti:

- konsep entity,
- persistence context,
- entity manager,
- entity lifecycle,
- mapping annotation,
- JPQL,
- criteria API,
- transaction interaction,
- callback lifecycle,
- optimistic/pessimistic locking abstraction,
- schema generation contract tertentu,
- provider SPI tertentu.

Tetapi specification **tidak selalu menentukan cara internal provider menjalankan semuanya**.

Specification biasanya menjawab:

```text
Apa behavior minimum yang boleh diharapkan aplikasi?
```

Bukan:

```text
Bagaimana provider harus menyusun action queue?
Bagaimana dirty checking diimplementasikan?
Bagaimana fetch plan internal dibangun?
Bagaimana query optimizer provider memilih join?
Bagaimana cache invalidation cluster dilakukan?
Bagaimana SQL persis akan berbentuk di Oracle vs PostgreSQL?
```

### 2.2 Specification Bukan Implementation Manual

Specification bukan buku internal Hibernate. Specification bukan source code EclipseLink. Specification juga bukan panduan tuning database.

Karena itu, membaca spec memberi pondasi correctness, tetapi belum cukup untuk production engineering.

Analogi:

```text
Java Language Specification menjelaskan semantic bahasa Java.
Tetapi performance konkret tetap bergantung pada JVM, JIT, GC, CPU, allocation pattern, dan library.

JPA specification menjelaskan semantic persistence API.
Tetapi performance dan failure mode konkret tetap bergantung pada provider, dialect, database, transaction manager, dan mapping design.
```

---

## 3. Provider Reality

### 3.1 Apa Itu Provider?

JPA provider adalah implementation dari JPA/Jakarta Persistence specification.

Provider utama:

- Hibernate ORM.
- EclipseLink.
- OpenJPA, DataNucleus, dan provider lain dalam konteks tertentu.

Dalam praktik modern enterprise Java, Hibernate ORM dan EclipseLink adalah dua nama besar yang paling relevan.

Provider bertugas:

- membaca metadata entity,
- membangun model mapping internal,
- mengelola persistence context,
- melakukan dirty checking,
- menghasilkan SQL,
- mengelola first-level cache,
- mengintegrasikan second-level/shared cache,
- mengelola lazy loading/proxy/weaving,
- mengeksekusi lifecycle callback,
- mengoordinasikan flush,
- menerjemahkan exception database ke exception persistence,
- mengelola dialect database,
- menyediakan extension di luar spec.

### 3.2 Provider adalah Runtime Engine, Bukan Adapter Tipis

Jangan membayangkan provider seperti wrapper tipis di atas JDBC.

Provider lebih tepat dipahami sebagai:

```text
metadata compiler + identity map + unit of work + graph synchronizer + SQL generator + query engine + cache coordinator + transaction participant
```

Saat aplikasi melakukan:

```java
entityManager.persist(order);
```

Yang terjadi bukan sekadar:

```sql
INSERT INTO orders ...
```

Provider harus memutuskan:

- apakah object ini new atau sudah pernah dikenal,
- ID-nya sudah tersedia atau perlu generated,
- cascade mana yang ikut diproses,
- association mana yang owning side,
- collection mana yang harus dicatat,
- SQL belum tentu langsung dikirim,
- action bisa ditunda sampai flush,
- urutan insert harus memperhatikan foreign key,
- batching mungkin bisa dilakukan atau tidak,
- callback/listener mana yang harus dijalankan,
- version field harus di-set atau tidak,
- second-level cache perlu diupdate atau invalidated.

Satu baris JPA API bisa memicu proses internal cukup panjang.

---

## 4. Mental Model: 5-Layer Persistence Stack

Untuk memahami behavior nyata, gunakan model lima layer berikut.

```text
┌──────────────────────────────────────────────┐
│ Application / Domain / Service Layer          │
│ - aggregate boundary                          │
│ - transaction boundary                        │
│ - DTO boundary                                │
│ - business invariant                          │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ JPA / Jakarta Persistence API                 │
│ - EntityManager                               │
│ - Query / TypedQuery                          │
│ - annotations                                 │
│ - lifecycle contracts                         │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ Provider Runtime                              │
│ - Hibernate Session / EclipseLink UnitOfWork  │
│ - dirty checking                              │
│ - flush/action queue                          │
│ - proxy/weaving                               │
│ - cache                                       │
│ - query engine                                │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ Dialect / JDBC / Transaction Integration      │
│ - SQL grammar                                 │
│ - bind parameter                              │
│ - generated key strategy                      │
│ - lock syntax                                 │
│ - pagination syntax                           │
│ - resource-local/JTA/Spring transaction       │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ Database                                      │
│ - storage engine                              │
│ - index                                       │
│ - optimizer                                   │
│ - constraints                                 │
│ - locks/isolation                             │
│ - undo/redo/MVCC                              │
└──────────────────────────────────────────────┘
```

Banyak bug production terjadi karena engineer hanya melihat layer 2:

```text
EntityManager + annotation
```

Padahal akar masalahnya bisa di layer 3, 4, atau 5.

---

## 5. Standard Contract vs Provider Decision

### 5.1 Contoh: Lazy Loading

JPA mendefinisikan bahwa association bisa `LAZY` atau `EAGER`.

Tetapi realitas provider:

- Bagaimana lazy dilakukan?
  - proxy subclass?
  - bytecode enhancement?
  - weaving?
  - collection wrapper?
- Kapan lazy load dipicu?
- Apakah lazy basic field didukung penuh?
- Apakah final class/method bermasalah?
- Apa yang terjadi saat serialization?
- Apa yang terjadi saat entity detached?

Hibernate dan EclipseLink dapat memiliki mekanisme berbeda.

### 5.2 Contoh: Dirty Checking

Spec menyatakan perubahan pada managed entity akan disinkronkan ke database saat flush/commit.

Tetapi provider menentukan:

- snapshot comparison,
- attribute-level tracking,
- bytecode-enhanced tracking,
- collection dirty detection,
- mutable embeddable handling,
- update SQL generation,
- dynamic update extension.

Akibatnya, cost dan behavior update bisa berbeda.

### 5.3 Contoh: Fetch Join

JPQL punya konsep join fetch.

Tetapi provider menentukan detail seperti:

- duplicate root elimination,
- pagination behavior,
- multiple collection fetch restrictions,
- SQL alias generation,
- query plan caching,
- interaction dengan entity graph.

### 5.4 Contoh: Schema Generation

Spec menyediakan schema generation setting.

Tetapi production-grade schema migration tetap tidak boleh bergantung penuh pada provider DDL auto-generation karena:

- generated DDL bisa berbeda antar provider,
- generated DDL bisa berbeda antar versi provider,
- generated DDL tidak selalu preserve data,
- generated DDL tidak cukup untuk expand/backfill/contract migration,
- generated DDL tidak menangkap semua index/partition/storage/tablespace/policy.

---

## 6. The Portability Myth

### 6.1 Portability yang Realistis

Portability realistis pada level:

- common entity mapping,
- basic persistence context semantic,
- simple JPQL,
- standard lifecycle callback,
- standard locking annotation,
- standard transaction integration.

Contoh portable yang relatif aman:

```java
@Entity
@Table(name = "customers")
public class Customer {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;
}
```

JPQL sederhana:

```java
select c from Customer c where c.name = :name
```

### 6.2 Portability yang Rapuh

Portability mulai rapuh pada area:

- lazy loading detail,
- bytecode enhancement/weaving,
- custom type,
- JSON column,
- array column,
- native query result mapping,
- complex criteria query,
- schema generation,
- ID generator optimizer,
- sequence allocation,
- second-level cache,
- batch fetching,
- entity graph interaction,
- pagination with fetch join,
- pessimistic lock timeout,
- stored procedure behavior,
- database-specific function.

### 6.3 Portability yang Salah Arah

Ada situasi di mana mengejar portability justru merugikan.

Misalnya sistem Anda:

- selalu memakai Oracle,
- memiliki audit dan reporting berat,
- menggunakan partitioning/index hint/specific date function,
- punya SLA performance ketat,
- harus mengoptimalkan locking dan batch job.

Dalam situasi seperti itu, menolak semua provider/database-specific feature demi portability bisa membuat desain menjadi lemah.

Prinsipnya:

```text
Portable by default.
Specific where correctness/performance/operability requires it.
Explicitly isolate provider/database-specific decisions.
```

Artinya bukan sembarang memakai extension, tetapi extension harus:

- terdokumentasi,
- dibungkus di layer yang jelas,
- memiliki test terhadap generated SQL/behavior,
- masuk migration checklist,
- tidak tersebar liar di seluruh codebase.

---

## 7. Taxonomy of Behavior

Untuk setiap fitur ORM, biasakan klasifikasikan behavior ke lima kategori.

### 7.1 Spec-Mandated Behavior

Behavior yang dijamin specification.

Contoh:

- entity managed dalam persistence context,
- `persist()` membuat new entity menjadi managed,
- `remove()` menandai managed entity untuk deletion,
- `find()` mengembalikan managed entity jika ditemukan,
- JPQL memiliki syntax dan semantic standar tertentu,
- optimistic lock menggunakan version field.

Tetapi bahkan di sini detail internal tetap provider-specific.

### 7.2 Spec-Allowed but Provider-Defined Behavior

Specification memberi ruang untuk provider.

Contoh:

- kapan persis flush dilakukan dalam beberapa situasi,
- bagaimana query diterjemahkan ke SQL,
- bagaimana lazy loading direalisasikan,
- bagaimana cache internal bekerja,
- bagaimana provider mengoptimalkan dirty checking,
- detail exception wrapping.

### 7.3 Provider Extension

Fitur di luar spec.

Hibernate examples:

- `@BatchSize`,
- `@Fetch`,
- `@Where` / filter-style features,
- `@NaturalId`,
- `@DynamicUpdate`,
- `StatelessSession`,
- Hibernate-specific custom type,
- Hibernate event system,
- Envers.

EclipseLink examples:

- weaving-specific behavior,
- `@JoinFetch`,
- `@BatchFetch`,
- descriptor customizer,
- shared cache advanced configuration,
- fetch groups,
- transformation mappings.

### 7.4 Database-Specific Behavior

Contoh:

- Oracle sequence semantics,
- PostgreSQL `RETURNING`,
- MySQL identity/autoincrement behavior,
- SQL Server locking hints,
- timestamp precision,
- LOB storage,
- isolation behavior,
- optimizer statistics,
- deadlock detection.

### 7.5 Framework/Container Behavior

Contoh:

- Spring `@Transactional`,
- Jakarta EE container-managed transaction,
- resource-local transaction,
- JTA transaction,
- Open EntityManager in View,
- connection pool behavior,
- exception translation,
- test transaction rollback.

Saat debugging, jangan langsung menyalahkan “JPA”. Tanyakan kategori behavior-nya.

---

## 8. Java 8–25 Compatibility Map

### 8.1 Java 8 Era

Java 8 sering terkait dengan:

- JPA 2.1/2.2,
- `javax.persistence.*`,
- Hibernate 5.x,
- EclipseLink 2.x,
- Java EE 7/8,
- older app servers,
- older Spring Boot generations,
- limited Java time support depending version/provider.

Karakteristik umum:

- banyak legacy application masih memakai namespace `javax`,
- migration ke Jakarta tidak hanya rename package karena dependency ecosystem ikut berubah,
- provider version sering dibatasi app server,
- bytecode tooling lebih sederhana dibanding modern JPMS/AOT environment.

### 8.2 Java 11/17 Era

Java 11 dan 17 menjadi jembatan modern enterprise.

Karakteristik:

- Spring Boot 3 membutuhkan Jakarta namespace,
- Jakarta EE 10/11 bergerak di namespace `jakarta`,
- Hibernate 6 menjadi baseline umum di banyak stack modern,
- EclipseLink 4 relevan untuk Jakarta EE 10,
- Java module system mulai perlu diperhatikan walau banyak app tetap classpath-based.

### 8.3 Java 21/25 Era

Java 21 dan Java 25 membawa runtime modern:

- virtual threads menjadi pertimbangan arsitektur aplikasi, walau ORM tetap blocking JDBC-based pada banyak stack,
- GC modern seperti ZGC/Shenandoah/G1 semakin matang,
- records lebih umum dipakai untuk DTO/projection, bukan entity utama dalam banyak desain,
- AOT/native-image concern makin sering muncul di cloud-native environment,
- Jakarta Persistence 3.2 sudah mendukung beberapa modern Java features seperti record use cases tertentu dan Java Time improvements.

Catatan penting:

```text
Java runtime modern tidak otomatis membuat ORM menjadi non-blocking, safe untuk long transaction, atau bebas dari persistence context memory pressure.
```

Virtual thread bisa membantu thread scalability untuk blocking IO, tetapi tidak menghapus batas:

- database connection pool,
- transaction duration,
- row lock duration,
- result set size,
- persistence context size,
- flush cost.

---

## 9. Namespace Shift: `javax.persistence` vs `jakarta.persistence`

### 9.1 Ini Bukan Rename Kecil

Transisi dari Java EE ke Jakarta EE menyebabkan namespace berpindah dari:

```java
javax.persistence.Entity
```

ke:

```java
jakarta.persistence.Entity
```

Secara sekilas tampak hanya import rename. Tetapi secara ecosystem, dampaknya besar:

- provider version harus compatible,
- framework harus compatible,
- app server/container harus compatible,
- library transitive harus compatible,
- annotation processor harus compatible,
- test framework dan mocking integration bisa terpengaruh,
- generated metamodel bisa terpengaruh,
- bytecode enhancement plugin bisa terpengaruh,
- dependency lama bisa membawa API lama.

### 9.2 Mixed Namespace adalah Red Flag

Jika codebase modern memakai `jakarta.persistence`, tetapi ada dependency yang masih membawa `javax.persistence`, gejalanya bisa berupa:

- compile error,
- runtime `ClassNotFoundException`,
- provider tidak mengenali annotation,
- entity tidak ter-scan,
- metamodel generation gagal,
- app server conflict,
- duplicate API jar.

Rule:

```text
Dalam satu runtime persistence stack, jangan campur javax dan jakarta kecuali Anda sedang menjalankan migration bridge yang sangat terkontrol.
```

### 9.3 Migration Mindset

Migration bukan:

```text
search replace javax.persistence -> jakarta.persistence
```

Migration adalah:

```text
align API namespace + provider + framework + transaction integration + app server + test infra + generated code + deployment runtime
```

---

## 10. Hibernate vs EclipseLink: Philosophical Difference

### 10.1 Hibernate ORM

Hibernate sering menjadi default provider di Spring ecosystem dan banyak aplikasi enterprise modern.

Karakter umum:

- extension ecosystem besar,
- dokumentasi luas,
- integrasi kuat dengan Spring Boot,
- query engine modern di Hibernate 6/7,
- banyak fitur provider-specific,
- komunitas besar,
- behavior sering menjadi “de facto expectation” banyak developer.

Kekuatan:

- luas digunakan,
- tooling dan observability relatif kuat,
- fitur extension banyak,
- integration path dengan Spring sangat matang,
- performance tuning option banyak.

Risiko:

- developer bisa terlalu bergantung pada Hibernate-specific behavior tanpa sadar,
- upgrade major version bisa berdampak signifikan,
- beberapa fitur sangat powerful tapi mudah disalahgunakan,
- generated SQL/query behavior perlu diamati serius.

### 10.2 EclipseLink

EclipseLink adalah reference implementation untuk beberapa generasi JPA/Jakarta Persistence dan kuat di lingkungan Jakarta EE/Oracle-oriented enterprise.

Karakter umum:

- konsep Session/UnitOfWork/Descriptor kuat,
- weaving memainkan peran penting,
- shared cache dan descriptor customization menjadi area advanced,
- memiliki extension mapping yang luas,
- sering ditemui di app server/Jakarta EE environment.

Kekuatan:

- integrasi Jakarta EE kuat,
- mapping capabilities luas,
- descriptor-level customization kuat,
- shared cache model mature,
- cocok untuk beberapa enterprise container scenario.

Risiko:

- banyak tim lebih familiar dengan Hibernate daripada EclipseLink,
- behavior tuning berbeda,
- weaving setup bisa menjadi sumber surprise,
- portability dari Hibernate-specific code tidak otomatis.

### 10.3 Perbandingan Singkat

| Area | Hibernate | EclipseLink |
|---|---|---|
| Ecosystem default | Sangat dominan di Spring | Kuat di Jakarta EE/container tertentu |
| Internal vocabulary | Session, SessionFactory, ActionQueue, Event system | Session, UnitOfWork, Descriptor, Weaving |
| Lazy mechanism | Proxy + bytecode enhancement | Weaving/proxy-like indirection tergantung setup |
| Extension style | Annotation/API extension luas | Descriptor/customizer/weaving/fetch extension |
| Cache model | Second-level cache via region/provider | Shared cache built into EclipseLink model |
| Migration concern | Hibernate 5→6/7 cukup signifikan | EclipseLink 2→3/4 namespace/platform shift signifikan |
| Best use | Spring-heavy, Hibernate-specific tuning, broad community | Jakarta EE/container, descriptor customization, EclipseLink feature set |

---

## 11. What the Spec Usually Does Not Save You From

### 11.1 Bad Aggregate Boundary

Spec tidak akan mencegah Anda membuat aggregate terlalu besar:

```text
Case
 ├── 10,000 Activities
 ├── 2,000 Audit entries
 ├── 500 Documents
 ├── 200 Tasks
 └── 50 Correspondence records
```

Jika semua dipetakan sebagai cascading bidirectional graph dan sering di-load bersama, provider akan mengikuti mapping Anda lalu menghasilkan object hydration dan SQL cost besar.

Spec tidak berkata:

```text
Aggregate Anda terlalu besar.
```

### 11.2 Wrong Fetch Strategy

Spec memberi `LAZY` dan `EAGER`. Tetapi spec tidak otomatis memilih fetch plan optimal untuk use case Anda.

Endpoint listing butuh:

```text
Case ID, case number, status, applicant name, created date
```

Tetapi entity graph Anda bisa tanpa sadar memuat:

```text
case + applicant + address + documents + document binary metadata + tasks + comments + audit
```

Spec tidak mencegah over-fetching.

### 11.3 Bad Transaction Boundary

Spec menjelaskan persistence context dan transaction, tetapi tidak mendesain service boundary Anda.

Jika satu transaction mencakup:

- remote API call,
- email sending,
- file upload,
- database mutation,
- audit insert,
- workflow transition,
- notification,

maka ORM tidak bisa menyelamatkan Anda dari lock duration dan rollback inconsistency.

### 11.4 Broken Equals/HashCode

Spec memberi aturan umum, tetapi desain `equals/hashCode` entity tetap tanggung jawab Anda.

Masalah klasik:

```java
Set<LineItem> items = new HashSet<>();
items.add(newItem); // id masih null
entityManager.persist(newItem); // id berubah
items.contains(newItem); // bisa bermasalah jika hashCode berbasis id mutable
```

### 11.5 DTO Boundary Mistake

Spec tidak melarang Anda menerima request JSON langsung ke entity.

Tetapi ini bisa menyebabkan:

- mass assignment,
- null overwrite,
- detached graph overwrite,
- collection replacement storm,
- unintended cascade,
- security bypass.

---

## 12. Provider-Aware Design Rules

### Rule 1 — Treat JPA as Contract, Provider as Runtime

Jangan berhenti di annotation.

Selalu tanyakan:

```text
Provider akan melakukan apa dengan mapping ini?
```

Contoh:

```java
@OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
private List<CaseDocument> documents = new ArrayList<>();
```

Pertanyaan provider-aware:

- Apakah collection ini bisa sangat besar?
- Apakah remove satu item akan delete row atau update FK?
- Apakah list ordering membutuhkan order column?
- Apakah replace seluruh collection akan menyebabkan delete/insert besar?
- Apakah orphan removal aman terhadap aggregate boundary?
- Apakah cascade remove bisa menghapus document yang shared?
- Apakah endpoint listing akan memuat collection ini?

### Rule 2 — SQL is the Observable Reality

JPA code adalah intent. SQL adalah work order nyata ke database.

Untuk query penting, jangan puas dengan:

```text
It works.
```

Pastikan:

- SQL shape benar,
- jumlah query benar,
- bind parameter benar,
- index bisa dipakai,
- row count realistis,
- execution plan masuk akal,
- pagination benar,
- locking clause sesuai.

### Rule 3 — Persistence Context Has Cost

Persistence context bukan map gratis. Ia menyimpan:

- managed entity instance,
- snapshot,
- collection wrapper,
- pending action,
- identity mapping,
- dirty-checking metadata.

Untuk batch job, import, export, atau long-running process, persistence context bisa menjadi sumber memory pressure.

### Rule 4 — Flush is a Boundary of Surprise

Flush bisa terjadi sebelum commit.

Flush bisa dipicu oleh query.

Flush bisa mengirim SQL yang tidak Anda ekspektasikan jika ada managed entity dirty.

Sebelum menjalankan query dalam transaction panjang, tanyakan:

```text
Apakah persistence context sedang dirty?
Apakah query ini dapat trigger flush?
Apakah flush ini bisa gagal karena constraint?
```

### Rule 5 — Lazy Loading is Not a Design Substitute

Lazy loading adalah mechanism, bukan architecture.

Jika service/API boundary tidak jelas, lazy loading akan menjadi hidden database access.

Rule praktis:

```text
Untuk setiap use case, tentukan fetch plan eksplisit.
Jangan biarkan serialization layer menentukan query behavior.
```

### Rule 6 — Provider-Specific Feature Must Be Isolated

Boleh memakai Hibernate/EclipseLink extension jika perlu.

Tetapi isolasi:

- di repository khusus,
- di mapping package tertentu,
- dengan test provider-specific,
- dengan dokumentasi migration impact,
- dengan fallback atau decision record.

### Rule 7 — Test Against Real Database Semantics

Jangan menganggap H2 mewakili Oracle/PostgreSQL/MySQL/SQL Server.

ORM failure sering muncul pada:

- sequence,
- identity,
- locking,
- pagination,
- timestamp precision,
- LOB,
- constraint timing,
- reserved keyword,
- SQL function,
- transaction isolation.

---

## 13. Common Misleading Sentences

### 13.1 “Kita Pakai JPA, Jadi Bisa Ganti Provider Kapan Saja”

Lebih tepat:

```text
Kita memakai JPA sebagai common API, tetapi tingkat portability aktual bergantung pada seberapa banyak provider-specific behavior, query, cache, mapping, dan dialect feature yang kita gunakan.
```

### 13.2 “ORM Itu Lambat”

Lebih tepat:

```text
ORM bisa lambat jika mapping, fetch plan, transaction boundary, dan persistence context size tidak dikendalikan. ORM juga bisa efisien jika digunakan dengan cost model yang benar.
```

### 13.3 “Native Query Lebih Cepat”

Tidak otomatis.

Native query bisa lebih tepat untuk query tertentu, tetapi bisa membawa risiko:

- mapping manual,
- portability hilang,
- cache synchronization tidak otomatis,
- bulk update bypass persistence context,
- SQL injection jika binding buruk,
- result shape drift.

### 13.4 “EAGER Menghindari LazyInitializationException”

EAGER sering menukar satu error eksplisit menjadi performance tax tersembunyi.

Lebih baik:

```text
Gunakan LAZY sebagai default untuk association besar, lalu desain fetch plan per use case.
```

### 13.5 “Repository Menyembunyikan Database”

Repository menyembunyikan detail akses, bukan menghapus realitas database.

Jika repository mengembalikan entity graph terlalu besar, database tetap bekerja keras.

---

## 14. Spec, Provider, Framework, Database: Responsibility Matrix

| Concern | JPA/Jakarta Persistence Spec | Provider | Framework/Container | Database |
|---|---|---|---|---|
| Entity lifecycle concept | Ya | Implementasi detail | Mengelola lifecycle injection/boundary | Tidak |
| Persistence context | Ya | Identity map, snapshot, dirty checking | Scope/binding | Tidak |
| SQL shape | Tidak detail | Ya | Biasanya tidak | Optimizer mengeksekusi |
| Transaction demarcation | Abstraction | Sinkronisasi flush | Sangat berperan | ACID implementation |
| Lazy loading | Hint/contract | Mechanism nyata | Bisa memperpanjang scope | Tidak |
| Locking abstraction | Ya | SQL lock clause | Transaction boundary | Lock manager |
| ID generation | Strategy abstraction | Optimizer/implementation | Config alignment | Sequence/identity behavior |
| Schema generation | Basic contract | DDL generator | Boot config | DDL enforcement |
| Cache | Abstraction terbatas | Cache behavior | Cache provider wiring | Source of truth |
| Query language | JPQL/Criteria | Parser/compiler/SQL gen | Repository abstraction | Execution plan |
| Error handling | Exception hierarchy | Exception conversion | Exception translation | Error source |

---

## 15. Example: Same Code, Different Layers of Meaning

Kode:

```java
@Transactional
public void approveCase(Long caseId, String officerId) {
    CaseFile caseFile = entityManager.find(CaseFile.class, caseId);
    caseFile.approveBy(officerId);
}
```

Terlihat sederhana. Tetapi mari pecah layer-nya.

### 15.1 Application Layer

Pertanyaan:

- Apakah `approveBy()` memvalidasi state transition?
- Apakah officer punya authority?
- Apakah approval harus audit?
- Apakah approval idempotent?
- Apakah ada concurrent approval?
- Apakah notification dikirim dalam transaction yang sama?

### 15.2 JPA API Layer

`find()` menjanjikan managed entity jika ditemukan.

Perubahan pada managed entity akan disinkronkan saat flush/commit.

### 15.3 Provider Layer

Provider akan:

- cek first-level cache,
- load row jika belum ada,
- hydrate object,
- menyimpan snapshot,
- mendeteksi perubahan status saat flush,
- generate update SQL,
- handle version jika ada,
- menjalankan callback/listener.

### 15.4 Dialect/JDBC Layer

Provider akan membuat SQL sesuai dialect.

Misalnya:

```sql
update case_file
set status = ?, approved_by = ?, approved_at = ?, version = ?
where id = ? and version = ?
```

Jika optimistic locking digunakan.

### 15.5 Database Layer

Database akan:

- mencari row berdasarkan primary key,
- memperoleh lock saat update,
- mengecek constraint,
- menulis undo/redo/WAL,
- enforce transaction isolation,
- commit atau rollback.

### 15.6 Failure Mode

Kode tersebut bisa gagal karena:

- row tidak ada,
- stale version,
- deadlock,
- constraint violation,
- invalid transition,
- authorization missing,
- flush terjadi lebih awal,
- `approveBy()` mengubah association besar,
- entity listener melakukan query tambahan,
- transaction rollback karena error setelah update.

Jadi “satu method service” bukan satu operasi sederhana. Ia adalah koordinasi lintas layer.

---

## 16. Provider Reality in Migration

### 16.1 Why Upgrade Hurts

Upgrade provider bukan hanya mengganti version number.

Provider major upgrade bisa mengubah:

- query parser,
- SQL generation,
- type system,
- dialect class,
- default ID generator,
- naming strategy behavior,
- bootstrapping API,
- bytecode enhancer,
- cache integration,
- deprecated API removal,
- JPQL strictness,
- native query mapping.

### 16.2 Migration Example: Hibernate 5 to 6/7

Hal yang biasanya perlu diaudit:

- custom `UserType`,
- dialect configuration,
- deprecated Hibernate APIs,
- HQL/JPQL queries,
- native query result mapping,
- sequence generator behavior,
- schema validation,
- second-level cache integration,
- Spring Boot compatibility,
- Jakarta namespace if moving to Boot 3+,
- generated SQL differences.

### 16.3 Migration Example: EclipseLink 2 to 4

Hal yang biasanya perlu diaudit:

- `javax` to `jakarta`,
- app server compatibility,
- weaving setup,
- descriptor customizer,
- query hints,
- shared cache configuration,
- MOXy/JAXB dependency alignment,
- JDK minimum,
- Jakarta EE version alignment.

### 16.4 Migration Rule

```text
Provider migration is a behavioral migration, not only dependency migration.
```

Checklist minimum:

1. Compile migration.
2. Boot migration.
3. Mapping validation.
4. Query validation.
5. Generated SQL comparison.
6. Migration test with real database.
7. Performance baseline comparison.
8. Concurrency/locking regression test.
9. Cache behavior test.
10. Rollback plan.

---

## 17. How to Read Provider Documentation

### 17.1 Read in Layers

Saat membaca dokumentasi provider, jangan baca seperti cookbook acak.

Baca dengan urutan:

1. Mapping model.
2. Persistence context/session/unit of work.
3. Fetching/lazy loading.
4. Query language and SQL generation.
5. Flushing and batching.
6. Transaction/locking.
7. Cache.
8. Extension points.
9. Migration notes.
10. Performance tuning.

### 17.2 Translate Feature to Failure Mode

Setiap fitur harus diterjemahkan menjadi:

```text
Fitur ini membantu apa?
Biayanya apa?
Kapan salah digunakan?
Bagaimana cara mengetesnya?
Apa dampaknya ke migration?
```

Contoh: Hibernate `@BatchSize`.

Jangan hanya tahu:

```java
@BatchSize(size = 50)
```

Tanyakan:

- Batch load apa yang dioptimalkan?
- Apakah size 50 cocok untuk database dan endpoint?
- Apakah menyebabkan `IN` clause terlalu besar?
- Apakah efektif untuk access pattern ini?
- Apakah lebih baik DTO projection?
- Apakah interaction dengan second-level cache baik?

---

## 18. Decision Framework: Standard vs Provider-Specific vs Native SQL

Gunakan framework berikut.

### 18.1 Pakai Standard JPA Jika

- use case CRUD biasa,
- query tidak terlalu database-specific,
- mapping umum,
- performance sudah cukup,
- portability masih bernilai,
- provider behavior tidak perlu extension.

Contoh:

- simple entity mapping,
- simple JPQL query,
- optimistic locking basic,
- standard lifecycle callback,
- standard criteria for moderate dynamic query.

### 18.2 Pakai Provider-Specific Feature Jika

- standard JPA terlalu terbatas,
- ada performance issue yang jelas,
- fitur provider memberikan kontrol yang tepat,
- tim memahami migration cost,
- behavior bisa dites,
- feature diisolasi.

Contoh:

- Hibernate batch fetching,
- Hibernate filter untuk soft-delete/tenant dengan caveat,
- Hibernate custom type untuk JSON,
- EclipseLink batch fetch/join fetch hint,
- EclipseLink descriptor customizer.

### 18.3 Pakai Native SQL Jika

- query sangat database-specific,
- reporting/read model berat,
- window function/CTE/vendor function diperlukan,
- optimizer hint diperlukan,
- batch mutation lebih aman sebagai SQL eksplisit,
- ORM entity hydration tidak dibutuhkan.

Tetapi native SQL harus punya disiplin:

- parameter binding wajib,
- result mapping jelas,
- test terhadap real DB,
- cache/persistence context impact dipahami,
- migration ownership jelas.

### 18.4 Jangan Pakai ORM Entity Jika

- data volume sangat besar untuk streaming/reporting,
- operasi bulk tidak membutuhkan lifecycle entity,
- data adalah read-only projection,
- query lintas banyak aggregate,
- result shape bukan object graph domain,
- performance SLA menuntut SQL spesifik.

Dalam kasus seperti ini, DTO/native SQL/jOOQ/JdbcTemplate/read-model repository bisa lebih benar.

---

## 19. Anti-Patterns

### Anti-Pattern 1 — Annotation-Driven Design

Gejala:

```text
Desain dimulai dari annotation, bukan dari aggregate, access pattern, transaction boundary, dan SQL cost.
```

Contoh:

```java
@OneToMany(cascade = CascadeType.ALL, fetch = FetchType.EAGER)
private List<AuditTrail> auditTrails;
```

Masalah:

- audit trail biasanya unbounded,
- EAGER membuat setiap load case membawa audit,
- cascade all ke audit bisa berbahaya,
- collection besar memperbesar persistence context.

Perbaikan:

- audit sebagai separate aggregate/history table,
- query audit secara paginated,
- jangan EAGER,
- jangan cascade remove sembarangan,
- gunakan append-only semantics.

### Anti-Pattern 2 — Repository Returns Entity for Every Read

Tidak semua read use case perlu entity.

Untuk listing:

```text
case number, status, applicant name, updated date
```

lebih baik projection dibanding full entity graph.

### Anti-Pattern 3 — Transaction Boundary Follows Controller Boundary

Controller request tidak selalu sama dengan transaction boundary yang sehat.

Request bisa mencakup:

- validation,
- file read,
- remote service call,
- DB update,
- notification.

Transaction sebaiknya mencakup mutation DB yang perlu atomic, bukan seluruh perjalanan request.

### Anti-Pattern 4 — Provider-Specific Usage Without Documentation

Contoh:

```java
@Where(clause = "deleted = false")
```

Dipakai di banyak entity tanpa dokumentasi.

Risiko:

- native query tidak ikut filter,
- admin use case sulit melihat deleted data,
- cache behavior harus dipahami,
- migration ke provider lain sulit,
- clause string raw bisa drift dengan schema.

### Anti-Pattern 5 — Believing Unit Test Covers ORM Behavior

Mocking repository tidak mengetes ORM.

Test seperti ini:

```java
when(repository.findById(id)).thenReturn(Optional.of(entity));
```

Tidak mengetes:

- mapping,
- generated SQL,
- flush,
- constraint,
- lazy loading,
- transaction,
- locking,
- dialect.

---

## 20. Diagnostic Checklist: “Is This Spec or Provider?”

Saat menemui bug ORM, gunakan pertanyaan berikut.

### 20.1 Mapping

- Apakah annotation ini standard JPA atau provider-specific?
- Apakah owning side association benar?
- Apakah optionality di object model cocok dengan DB nullability?
- Apakah cascade melewati aggregate boundary?
- Apakah collection type sesuai semantic?
- Apakah ID generation cocok dengan database dan batching?

### 20.2 Query

- Apakah query JPQL/HQL/Criteria/native?
- Apakah query memakai function provider/database-specific?
- SQL apa yang dihasilkan?
- Berapa jumlah query?
- Apakah ada implicit join?
- Apakah pagination dilakukan di DB atau memory?
- Apakah query memicu flush?

### 20.3 Runtime

- Entity managed atau detached?
- Persistence context berapa besar?
- Flush mode apa?
- Apakah ada dirty entity sebelum query?
- Apakah lazy load terjadi di luar transaction?
- Apakah Open Session in View aktif?

### 20.4 Transaction

- Siapa yang membuka transaction?
- Resource-local, JTA, atau Spring?
- Apakah rollback-only sudah ditandai?
- Apakah ada remote call dalam transaction?
- Isolation level apa?
- Lock mode apa?

### 20.5 Provider

- Provider apa dan versi berapa?
- Dialect apa?
- Ada bytecode enhancement/weaving?
- Ada second-level/shared cache?
- Ada event listener/interceptor?
- Ada provider-specific filter?
- Ada migration baru?

### 20.6 Database

- DB apa dan versi berapa?
- Execution plan bagaimana?
- Index dipakai atau tidak?
- Constraint mana yang gagal?
- Lock wait/deadlock terjadi di mana?
- Statistik optimizer fresh atau stale?

---

## 21. Practice Scenario 1 — Lazy Loading Error

### Problem

Endpoint:

```java
@GetMapping("/cases/{id}")
public CaseFile getCase(@PathVariable Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Error:

```text
LazyInitializationException: could not initialize proxy - no Session
```

### Weak Fix

```java
@OneToMany(fetch = FetchType.EAGER)
private List<CaseDocument> documents;
```

Masalah:

- semua load `CaseFile` sekarang membawa documents,
- endpoint lain ikut terdampak,
- bisa N+1 atau join besar,
- collection unbounded,
- serialization bisa memuat graph lebih dalam.

### Better Thinking

Tanya:

- Response API butuh field apa?
- Apakah documents perlu ikut?
- Jika iya, apakah semua documents atau paginated?
- Apakah perlu DTO?
- Apakah fetch plan endpoint ini harus explicit?

Solusi lebih sehat:

```java
public CaseDetailResponse getCaseDetail(Long id) {
    CaseFile caseFile = caseRepository.findDetailById(id)
        .orElseThrow();

    return mapper.toDetailResponse(caseFile);
}
```

Dengan repository query yang jelas:

```java
select c
from CaseFile c
left join fetch c.applicant
where c.id = :id
```

Documents bisa endpoint terpisah:

```text
GET /cases/{id}/documents?page=0&size=20
```

Mental model:

```text
Lazy loading error bukan hanya masalah session tertutup.
Itu sinyal bahwa fetch plan dan API boundary tidak eksplisit.
```

---

## 22. Practice Scenario 2 — Provider Migration Breaks Query

### Problem

Aplikasi migrasi provider major version. Query yang dulu jalan sekarang gagal.

```java
select c from CaseFile c where c.status = 'APPROVED'
```

Atau query lebih kompleks dengan implicit join/function.

### Possible Causes

- parser lebih strict,
- enum literal handling berubah,
- function registration berubah,
- implicit join behavior berbeda,
- type inference berubah,
- reserved keyword/naming strategy berubah,
- dialect berubah,
- Jakarta namespace mismatch.

### Correct Diagnosis Flow

1. Identifikasi provider lama dan baru.
2. Identifikasi apakah query JPQL, HQL, Criteria, atau native.
3. Aktifkan SQL logging di test environment.
4. Bandingkan generated SQL lama dan baru.
5. Cek migration guide provider.
6. Tambahkan regression test untuk query tersebut.
7. Perbaiki query menjadi lebih explicit.
8. Validasi execution plan.

### Lesson

```text
Provider migration changes query compiler behavior.
Treat query compatibility as part of migration, not incidental bug fixing.
```

---

## 23. Practice Scenario 3 — Same Mapping, Different Database

### Problem

Mapping berjalan di PostgreSQL, gagal di Oracle.

```java
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Atau timestamp precision berbeda, LOB loading bermasalah, pagination SQL berubah.

### Why

JPA strategy adalah abstraction. Database support detail berbeda.

Provider/dialect harus menerjemahkan strategy ke database-specific mechanism.

### Correct Thinking

Untuk setiap database target:

- ID generation strategy harus dipilih sadar,
- sequence allocation harus align,
- timestamp precision harus dites,
- pagination harus dites,
- locking harus dites,
- LOB behavior harus dites,
- reserved keywords harus dicek,
- DDL generated harus direview.

### Lesson

```text
JPA hides some database differences, not all database semantics.
```

---

## 24. Practice Scenario 4 — Cache Makes Data Stale

### Problem

Data berubah di proses lain, aplikasi masih membaca value lama.

Possible causes:

- second-level cache/shared cache aktif,
- query cache aktif,
- persistence context long-lived,
- transaction isolation snapshot,
- external update bypass provider,
- cache invalidation tidak terjadi,
- cluster cache tidak sinkron.

Diagnosis:

1. Apakah stale hanya dalam transaction yang sama?
2. Apakah stale hilang setelah `clear()`?
3. Apakah stale hilang setelah restart?
4. Apakah second-level/shared cache aktif?
5. Apakah data diubah via native SQL/batch job/external system?
6. Apakah cache region dikonfigurasi read-only padahal data mutable?
7. Apakah query cache dipakai untuk mutable data?

Lesson:

```text
Cache problem sering terlihat seperti database problem, padahal source of stale state bisa ada di persistence context atau provider cache.
```

---

## 25. Engineering Heuristics

### 25.1 Default Mapping Heuristics

- Default association ke `LAZY` jika memungkinkan.
- Hindari `EAGER` untuk collection.
- Hindari cascade melintasi aggregate boundary.
- Hindari bidirectional association kecuali benar-benar perlu.
- Gunakan helper method untuk menjaga dua sisi association.
- Jangan expose entity langsung ke API response.
- Jangan bind request body langsung ke entity.
- Jangan gunakan `ddl-auto=update` untuk production.
- Jangan aktifkan second-level cache sebelum punya cache correctness strategy.

### 25.2 Default Query Heuristics

- Listing endpoint pakai projection/DTO.
- Detail endpoint punya fetch plan eksplisit.
- Collection besar dipaginate.
- Query penting punya SQL count/execution plan test.
- Jangan join fetch banyak collection sekaligus.
- Jangan pagination sembarangan dengan collection fetch join.
- Jangan bulk update lalu lanjut memakai persistence context lama tanpa clear/refresh.

### 25.3 Default Transaction Heuristics

- Transaction harus pendek.
- Jangan tahan transaction saat remote call.
- Jangan campur DB mutation dan irreversible external side effect tanpa outbox/compensation design.
- Gunakan optimistic locking untuk collaborative update.
- Gunakan pessimistic locking hanya saat benar-benar perlu dan lock order jelas.
- Jangan mengandalkan rollback test untuk membuktikan constraint production.

### 25.4 Default Migration Heuristics

- Lock provider version dan document baseline.
- Jangan upgrade provider major version tanpa generated SQL diff.
- Jalankan integration test di database target.
- Audit provider-specific annotation/API.
- Audit `javax`/`jakarta` namespace.
- Audit custom type/converter/listener.
- Audit cache config.
- Audit migration guide.

---

## 26. How Top Engineers Talk About JPA

Beginner statement:

```text
Saya pakai @OneToMany supaya relasinya muncul.
```

Advanced statement:

```text
Relasi ini adalah child collection dalam aggregate boundary. Owning side ada di child karena FK berada di child table. Collection tidak boleh EAGER karena cardinality bisa tumbuh. Untuk detail endpoint kita fetch applicant via join fetch, tetapi documents dipaginate di endpoint terpisah. Cascade persist boleh, cascade remove hanya aman jika document tidak shared. Orphan removal dipakai hanya jika remove dari aggregate memang berarti delete row. Query listing memakai DTO projection agar tidak hydrate full graph.
```

Beginner statement:

```text
JPA lambat.
```

Advanced statement:

```text
Endpoint ini lambat karena fetch plan-nya memuat 1 root entity dengan dua collection, menghasilkan row multiplication. Selain itu persistence context menampung ribuan entity dan flush AUTO terjadi sebelum query validasi. Solusi bukan menghapus ORM, tetapi memisahkan read model, memakai projection untuk listing, membatasi transaction boundary, dan mengubah collection access menjadi paginated query.
```

Beginner statement:

```text
Kita bisa ganti provider karena pakai JPA.
```

Advanced statement:

```text
Core mapping kita relatif standard, tetapi kita memakai Hibernate-specific batch fetch, custom type JSON, filter soft delete, dan beberapa HQL function. Provider portability hanya valid untuk subset tertentu. Jika migration ke EclipseLink dibutuhkan, extension ini harus diisolasi dan diganti dengan equivalent behavior atau query native yang explicit.
```

---

## 27. A Simple Provider-Aware Review Template

Gunakan template ini saat review PR yang menyentuh persistence layer.

```text
1. Entity/mapping change
   - Apakah association owning side benar?
   - Apakah cardinality realistis?
   - Apakah cascade melewati aggregate boundary?
   - Apakah fetch type aman?
   - Apakah column definition/nullability cocok dengan DB?

2. Query change
   - JPQL/HQL/Criteria/native?
   - SQL yang dihasilkan seperti apa?
   - Apakah index bisa dipakai?
   - Apakah query count meningkat?
   - Apakah pagination benar?

3. Transaction change
   - Boundary transaction jelas?
   - Ada remote call dalam transaction?
   - Flush bisa terjadi di titik mana?
   - Lock/version behavior jelas?

4. Runtime behavior
   - Entity managed/detached path jelas?
   - DTO boundary aman?
   - Lazy loading bisa terjadi di serialization?
   - Persistence context bisa membesar?

5. Provider/database specificity
   - Ada annotation/API provider-specific?
   - Ada function/dialect-specific SQL?
   - Ada migration impact?
   - Ada test di database target?
```

---

## 28. Mini Glossary

### Specification

Kontrak standar API dan semantic minimum.

### Provider

Implementation runtime dari specification, misalnya Hibernate ORM atau EclipseLink.

### Dialect

Komponen provider yang mengetahui grammar dan feature database tertentu.

### Persistence Context

Ruang managed entity, identity map, snapshot, dan pending changes.

### Unit of Work

Pola yang mengumpulkan perubahan object selama transaction dan menyinkronkannya ke database sebagai satu batch kerja logis.

### Dirty Checking

Proses mendeteksi perubahan pada managed entity.

### Flush

Proses menyinkronkan perubahan persistence context ke database transaction, tanpa berarti commit.

### Hydration

Proses membangun object entity dari result set database.

### Fetch Plan

Rencana graph data apa yang dimuat untuk use case tertentu.

### Provider Extension

Fitur di luar standard JPA/Jakarta Persistence yang hanya tersedia pada provider tertentu.

### Native Query

SQL langsung ke database, bukan JPQL/Criteria.

---

## 29. Summary

JPA/Jakarta Persistence memberi bahasa standar untuk persistence dan object-relational mapping. Tetapi production behavior ditentukan oleh kombinasi specification, provider, dialect, database, framework, transaction manager, dan desain aplikasi.

Mental model penting:

```text
JPA Spec tells what should be possible.
Provider decides how it is executed.
Dialect decides how it speaks SQL.
Database decides how work is actually performed.
Application design decides whether the whole system remains correct, observable, and maintainable.
```

Hal paling penting dari bagian ini:

1. Jangan menganggap JPA sebagai abstraction yang menghapus database.
2. Jangan menganggap provider hanya detail implementasi kecil.
3. Jangan menganggap portability otomatis hanya karena memakai annotation standard.
4. Jangan menilai ORM dari CRUD kecil; nilai dari state synchronization, query shape, transaction boundary, dan failure mode.
5. Untuk setiap mapping/query/transaction, pikirkan kontrak spec dan realitas provider.
6. Extension provider boleh digunakan, tetapi harus sadar, terisolasi, terdokumentasi, dan dites.
7. SQL tetap observable reality.
8. Persistence context adalah memory dan consistency mechanism, bukan cuma cache gratis.
9. Migration provider/API namespace adalah behavioral migration.
10. Top engineer ORM selalu berpikir lintas layer.

---

## 30. What Comes Next

Bagian berikutnya:

```text
02-persistence-unit-bootstrap-metadata-provider-initialization.md
```

Fokus berikutnya adalah bagaimana provider benar-benar start:

- persistence unit,
- bootstrapping,
- metadata scanning,
- entity discovery,
- provider selection,
- classpath/module path,
- Hibernate boot architecture,
- EclipseLink session/descriptor initialization,
- error boot yang sering muncul,
- cara membaca startup failure secara sistematis.

