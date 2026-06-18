# Part 001 — Evolution Map: JDBC, JPA, Hibernate, Spring Data, Jakarta Data, Jakarta Transactions

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: Java 8 sampai Java 25  
> Fokus: peta evolusi teknologi persistence/data/transaction di ekosistem Java modern  
> Status seri: Part 001 dari 032 — belum selesai

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu seharusnya bisa menjelaskan dengan jernih:

1. Kenapa ekosistem persistence Java memiliki banyak layer: JDBC, JPA/Jakarta Persistence, Hibernate, Spring Data, Jakarta Data, dan Jakarta Transactions.
2. Apa tanggung jawab masing-masing layer, dan apa yang **bukan** tanggung jawabnya.
3. Kenapa JPA bukan Hibernate, Hibernate bukan Spring Data, Spring Data bukan transaction manager, dan transaction annotation bukan database transaction itu sendiri.
4. Kenapa migration dari `javax.persistence` ke `jakarta.persistence` bukan sekadar rename import dalam sistem besar.
5. Kapan kita harus berpikir di level JDBC, kapan di level JPA/Hibernate, kapan di level repository abstraction, dan kapan di level transaction manager.
6. Bagaimana membaca stack enterprise Java modern: Java runtime → JDBC driver → connection pool → transaction manager → persistence provider → repository abstraction → application service.
7. Bagaimana versi Java 8–25 berpengaruh terhadap pilihan API, library, framework, dan deployment style.

Part ini bukan tutorial coding. Ini adalah **peta navigasi**. Tanpa peta ini, engineer sering hafal annotation tetapi salah memahami boundary, ownership, portability, consistency, dan failure mode.

---

## 2. Mental Model Utama

Persistence stack Java bisa dipahami sebagai beberapa lapisan dengan pertanyaan berbeda.

```text
Application Use Case
  |
  |  "Apa operasi bisnis yang harus atomik?"
  v
Transaction Boundary
  |
  |  "Kapan mulai, commit, rollback, retry, suspend, join?"
  v
Repository / Data Access Abstraction
  |
  |  "Bagaimana use case meminta data tanpa tahu detail storage terlalu banyak?"
  v
ORM / Persistence Provider
  |
  |  "Bagaimana object Java dipetakan ke relational table dan SQL?"
  v
JDBC / Driver
  |
  |  "Bagaimana SQL dikirim ke database dan result set dibaca?"
  v
Database Engine
  |
  |  "Bagaimana data disimpan, dikunci, di-index, di-commit, dan direcover?"
```

Layer-layer ini tidak saling menggantikan. Mereka menambah abstraction dan trade-off.

Kesalahan umum: mengira semakin tinggi abstraction berarti semakin tidak perlu memahami layer bawah. Pada sistem produksi, abstraction yang sehat justru membuat kita tahu **kapan** harus turun layer.

Contoh:

- Saat membuat CRUD sederhana, repository abstraction cukup.
- Saat tuning N+1, perlu memahami ORM fetch plan.
- Saat batch insert lambat, perlu memahami ID generator, JDBC batching, flush/clear, dan database sequence/identity.
- Saat terjadi deadlock, perlu memahami SQL order, index, lock mode, dan isolation level.
- Saat dual-write ke database dan message broker gagal, perlu memahami transaction boundary, outbox, dan idempotency.

---

## 3. Big Picture Timeline

Secara historis, persistence Java bergerak dari kontrol penuh menuju abstraction yang lebih produktif.

```text
1990s/early Java
  |
  +-- JDBC
      - SQL manual
      - connection manual
      - transaction manual
      - mapping manual

Early 2000s
  |
  +-- ORM frameworks
      - Hibernate, TopLink, iBATIS/MyBatis style
      - mapping object-relational
      - unit of work, identity map, lazy loading

Java EE era
  |
  +-- JPA / javax.persistence
      - standard ORM API
      - EntityManager
      - JPQL
      - persistence context
      - provider abstraction

Spring ecosystem growth
  |
  +-- Spring Framework transaction abstraction
  +-- Spring Data JPA
      - repository interface
      - derived query
      - pagination
      - projection
      - integration with Spring transactions

Jakarta EE transition
  |
  +-- javax.* -> jakarta.* namespace
  +-- Jakarta Persistence 3.x
  +-- Jakarta Transactions 2.x
  +-- Jakarta Data 1.x

Modern era
  |
  +-- Hibernate 6/7
  +-- Java 17/21/25 runtime baseline in modern stacks
  +-- virtual threads consideration
  +-- cloud-native deployment
  +-- observability, migration, data consistency, CDC/outbox
```

Yang penting: evolusi ini bukan berarti JDBC mati, JPA selalu benar, atau repository abstraction selalu cukup. Semuanya tetap relevan, tetapi pada level masalah yang berbeda.

---

## 4. JDBC: The Ground Truth API

JDBC adalah API dasar Java untuk berbicara dengan database relational.

### 4.1 Apa yang JDBC berikan

JDBC memberi kemampuan untuk:

- membuka koneksi database,
- menyiapkan statement,
- bind parameter,
- execute SQL,
- membaca `ResultSet`,
- mengelola commit/rollback pada connection,
- memanggil stored procedure,
- membaca metadata database,
- menangani SQL exception.

Contoh mental model JDBC:

```java
try (Connection connection = dataSource.getConnection()) {
    connection.setAutoCommit(false);

    try (PreparedStatement statement = connection.prepareStatement(
            "update cases set status = ? where id = ?")) {
        statement.setString(1, "SUBMITTED");
        statement.setLong(2, 1001L);
        statement.executeUpdate();
    }

    connection.commit();
} catch (SQLException ex) {
    // rollback handling, exception translation, resource cleanup
}
```

JDBC sangat eksplisit. Itu kekuatan sekaligus beban.

### 4.2 Kekuatan JDBC

JDBC unggul ketika:

- query sangat spesifik,
- butuh kontrol SQL penuh,
- melakukan bulk operation besar,
- reporting query kompleks,
- operasi ETL/migration,
- stored procedure atau database-specific feature,
- debugging butuh mendekati real SQL.

### 4.3 Kelemahan JDBC

JDBC lemah karena semua hal harus ditulis manual:

- mapping row ke object,
- mapping object ke statement,
- lifecycle object,
- relationship loading,
- transaction demarcation,
- exception classification,
- resource handling,
- repeat boilerplate.

JDBC juga membuat domain model sering tercemar detail table/column karena tidak ada abstraction object-relational yang natural.

### 4.4 Senior-level view

Engineer advanced tidak melihat JDBC sebagai teknologi lama. JDBC adalah **ground truth** di bawah ORM. Ketika Hibernate mengeluarkan SQL, SQL itu tetap lewat JDBC driver dan connection. Ketika connection pool habis, ORM tidak bisa menyelamatkan. Ketika database lock menunggu, masalahnya tetap terjadi di level database session dan transaction.

Jadi walaupun aplikasi menggunakan JPA/Hibernate, kamu tetap harus bisa membaca:

- SQL generated,
- bind parameter,
- execution plan,
- connection pool metrics,
- transaction duration,
- lock wait,
- deadlock graph,
- database session state.

---

## 5. JPA / Jakarta Persistence: Standard ORM Contract

JPA awalnya berada di namespace `javax.persistence`. Setelah transisi Java EE ke Jakarta EE, namespace modern menjadi `jakarta.persistence`.

Jakarta Persistence mendefinisikan standard untuk manajemen persistence dan object/relational mapping dalam lingkungan Java. Specification-nya menjelaskan objective sebagai standard object/relational mapping facility untuk Java domain model yang mengelola data dalam relational database.

### 5.1 Apa yang distandardisasi oleh JPA/Jakarta Persistence

JPA/Jakarta Persistence memberi standard untuk:

- entity mapping,
- primary key mapping,
- relationship mapping,
- persistence context,
- `EntityManager`,
- entity lifecycle,
- JPQL,
- Criteria API,
- query execution,
- locking API,
- optimistic versioning,
- persistence unit,
- provider abstraction,
- lifecycle callback,
- converter,
- entity graph,
- schema generation support.

Contoh konsep standard:

```java
@Entity
@Table(name = "cases")
public class CaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Column(nullable = false, length = 50)
    private String status;

    @Version
    private long version;
}
```

```java
CaseEntity found = entityManager.find(CaseEntity.class, id);
found.changeStatus("SUBMITTED");
// dirty checking; update generated during flush
```

### 5.2 Apa yang tidak dijamin oleh JPA

JPA tidak menjamin semua hal berikut secara penuh:

- query SQL paling optimal,
- portable performance antar database,
- bebas N+1,
- bebas deadlock,
- mapping paling benar untuk domain,
- transaction boundary yang benar,
- schema migration production-safe,
- caching consistency,
- distributed transaction yang otomatis aman,
- error handling yang sesuai business semantics.

JPA adalah contract. Correctness tetap desainmu.

### 5.3 JPA sebagai abstraction, bukan shield

JPA menyembunyikan boilerplate mapping, tetapi tidak menghapus realitas relational database.

Ketika kamu menulis:

```java
caseEntity.getDocuments().size();
```

Itu bisa menjadi:

- tidak ada query tambahan jika collection sudah loaded,
- satu query lazy load,
- N+1 query dalam loop,
- exception jika persistence context sudah tertutup,
- memory spike jika collection besar,
- lock contention jika akses terjadi dalam transaction panjang.

Jadi API object-oriented bisa menyembunyikan biaya SQL. Engineer top harus bisa membayangkan SQL dan transaction consequence dari operasi object.

---

## 6. Hibernate ORM: Provider, Implementation, and Opinionated Power Tool

Hibernate adalah ORM framework dan salah satu provider JPA/Jakarta Persistence paling banyak digunakan. Hibernate bukan hanya implementasi spec; Hibernate juga punya fitur tambahan di luar spec.

### 6.1 Hibernate sebagai JPA provider

Ketika aplikasi memakai JPA API:

```java
@PersistenceContext
private EntityManager entityManager;
```

implementation di baliknya bisa Hibernate, EclipseLink, atau provider lain. Dalam ekosistem Spring Boot modern, Hibernate sering menjadi default provider.

### 6.2 Hibernate sebagai native ORM

Hibernate punya API dan fitur sendiri, misalnya:

- `Session`,
- `StatelessSession`,
- Hibernate-specific annotations,
- custom type system,
- filters,
- soft delete support,
- natural id cache,
- second-level cache integration,
- batch fetching,
- subselect fetching,
- bytecode enhancement,
- Hibernate statistics,
- HQL extensions,
- QuerySpecification pada versi modern.

Contoh unwrapping:

```java
Session session = entityManager.unwrap(Session.class);
```

Ini berguna, tetapi mengurangi portability. Tidak salah, asal sadar.

### 6.3 Hibernate 5, 6, dan 7 secara konseptual

Peta kasar:

```text
Hibernate 5.x
  - Banyak dipakai pada Spring Boot 2.x
  - javax.persistence
  - Java 8/11 era
  - legacy codebase sangat banyak

Hibernate 6.x
  - Banyak dipakai pada Spring Boot 3.x
  - jakarta.persistence
  - query engine dan type system berubah signifikan
  - SQL generation dan API internal banyak berubah

Hibernate 7.x
  - modern Jakarta Persistence 3.2 era
  - Java 17 baseline pada rilis modern
  - mendekat ke Jakarta Data support
  - migration dari 6 ke 7 perlu baca guide, bukan blind upgrade
```

Hibernate documentation menyatakan Hibernate ORM 7.0 terkait Jakarta Persistence 3.2 dan Java 17 baseline. Dokumentasi Hibernate juga menampilkan dukungan Jakarta Persistence 3.2 pada dokumentasi ORM 7 dan Jakarta Persistence 3.1 pada seri Hibernate 6.x tertentu.

### 6.4 Provider-specific bukan dosa

Ada dua sikap ekstrem:

1. “Harus pure JPA supaya portable.”
2. “Pakai saja semua fitur Hibernate tanpa peduli spec.”

Keduanya bisa salah.

Portability penting jika:

- kamu benar-benar ingin bisa ganti provider,
- library/framework digunakan banyak environment,
- organisasi punya standard Jakarta EE provider berbeda.

Provider-specific fitur masuk akal jika:

- performance/correctness butuh fitur itu,
- provider sudah menjadi strategic choice,
- alternatif pure JPA lebih buruk,
- keputusan terdokumentasi.

Contoh fitur Hibernate-specific yang sering justified:

- batch fetching,
- subselect fetching,
- custom type JSON,
- soft delete/filter,
- statistics,
- bytecode enhancement,
- second-level cache tuning,
- `StatelessSession` untuk batch.

Prinsipnya: **portable by default, provider-specific by decision**.

---

## 7. EclipseLink, OpenJPA, and Provider Awareness

Walau seri ini banyak memakai Hibernate sebagai referensi praktis, JPA adalah spec. Provider lain pernah/masih relevan:

- EclipseLink sebagai reference implementation historis untuk JPA/Jakarta Persistence di beberapa era,
- OpenJPA di legacy enterprise,
- provider bawaan application server tertentu.

Kenapa perlu tahu?

Karena beberapa behavior bisa berbeda:

- lazy loading implementation,
- weaving/bytecode enhancement,
- SQL generation,
- cache semantics,
- query hints,
- batch fetching,
- schema generation,
- native function support,
- exception wrapping.

Jika sistemmu mengandalkan provider-specific behavior, jangan pura-pura itu portable JPA.

---

## 8. Spring Data JPA: Repository Abstraction in Spring Ecosystem

Spring Data JPA bukan ORM. Spring Data JPA adalah abstraction di atas JPA provider.

Ia menyediakan:

- repository interface,
- generated implementation,
- derived query by method name,
- `@Query`,
- pagination,
- sorting,
- projection,
- specification,
- auditing integration,
- integration dengan Spring transaction.

Contoh:

```java
public interface CaseRepository extends JpaRepository<CaseEntity, Long> {

    Optional<CaseEntity> findByCaseNumber(String caseNumber);

    Page<CaseSummaryProjection> findByStatus(
            String status,
            Pageable pageable
    );
}
```

### 8.1 Apa yang Spring Data JPA mudahkan

Spring Data JPA mengurangi boilerplate untuk:

- CRUD,
- simple query,
- pagination,
- sorting,
- repository implementation repetitive,
- integration dengan Spring application service.

### 8.2 Apa yang Spring Data JPA tidak selesaikan

Spring Data JPA tidak otomatis menyelesaikan:

- bad entity mapping,
- N+1,
- over-fetching,
- wrong transaction boundary,
- isolation anomaly,
- slow query,
- missing index,
- deadlock,
- schema migration,
- cache invalidation,
- multi-tenant leakage,
- dual-write problem.

Spring Data mempercepat akses. Ia tidak menggantikan persistence design.

### 8.3 Derived query sebagai pisau bermata dua

Method name query bagus untuk query sederhana:

```java
findByStatusAndCreatedAtBetweenOrderByCreatedAtDesc(...)
```

Tapi ketika nama method mulai menjadi kalimat panjang, itu sinyal query sebaiknya dipindah ke:

- `@Query`,
- specification,
- query object,
- custom repository,
- native SQL,
- read model.

Abstraction yang terlalu mudah bisa membuat query ownership kabur.

---

## 9. Jakarta Data: Standard Repository Abstraction in Jakarta EE

Jakarta Data adalah specification di ekosistem Jakarta EE untuk menyederhanakan data access dengan entity dan repository interface. Jakarta Data 1.0 adalah bagian dari Jakarta EE 11 dan menyediakan API untuk data access yang lebih mudah.

Secara mental model, Jakarta Data mencoba menstandardisasi pola yang selama ini populer di framework seperti Spring Data: repository interface dengan method untuk operasi data.

### 9.1 Kenapa Jakarta Data muncul

Sebelum Jakarta Data, repository abstraction bukan bagian standard Jakarta EE. Developer biasanya memilih:

- DAO manual,
- repository manual,
- Spring Data,
- DeltaSpike Data,
- framework-specific abstraction,
- langsung `EntityManager`.

Jakarta Data membawa repository abstraction ke level standard Jakarta EE.

### 9.2 Konsep dasar Jakarta Data

Konsepnya:

```java
@Repository
public interface CaseRepository extends BasicRepository<CaseEntity, Long> {

    Optional<CaseEntity> findByCaseNumber(String caseNumber);
}
```

Catatan: detail API dapat berubah antar versi dan provider. Dalam seri ini, kita akan membedakan antara konsep standard Jakarta Data dan implementation detail seperti Hibernate Data Repositories.

### 9.3 Jakarta Data vs Spring Data

Perbandingan mental:

| Aspek | Spring Data JPA | Jakarta Data |
|---|---|---|
| Ekosistem | Spring | Jakarta EE |
| Status | Mature dan sangat luas dipakai | Standard baru di Jakarta EE 11 era |
| Abstraction | Repository di atas JPA dan store lain | Repository standard Jakarta untuk data access |
| Transaction integration | Spring transaction | Jakarta Transactions / container / provider integration |
| Portability | Portable dalam Spring ecosystem, tidak standard Jakarta | Standard Jakarta, implementation tergantung provider |
| Feature richness | Sangat kaya | Masih berkembang |

Jakarta Data tidak otomatis menggantikan Spring Data dalam aplikasi Spring. Tetapi untuk Jakarta EE modern, Jakarta Data menjadi standard penting.

### 9.4 Advanced view

Jakarta Data menarik karena menggeser repository abstraction dari framework-specific ke spec-level. Tapi untuk sistem kompleks, repository abstraction tetap harus dikendalikan:

- jangan semua query dipaksa menjadi method name,
- jangan semua entity diekspos sebagai aggregate root,
- jangan menganggap repository menyelesaikan transaction correctness,
- jangan mengabaikan SQL dan index.

---

## 10. Jakarta Transactions / JTA: Transaction Coordination Contract

Jakarta Transactions mendefinisikan standard interface antara transaction manager dan pihak-pihak dalam distributed transaction system: application, resource manager, dan application server. Specification-nya juga mencakup high-level interface untuk demarcate transaction boundary.

### 10.1 Apa itu transaction manager

Transaction manager bertanggung jawab mengatur lifecycle transaksi:

- begin,
- commit,
- rollback,
- suspend,
- resume,
- enlist resource,
- delist resource,
- coordinate resource manager,
- handle synchronization callbacks.

Resource manager bisa berupa:

- relational database,
- JMS provider,
- XA-aware resource,
- transactional system lain.

### 10.2 Local transaction vs global/distributed transaction

Local transaction:

```text
Application
  -> one database connection
  -> one database transaction
```

Distributed/JTA transaction:

```text
Application
  -> transaction manager
      -> resource manager A: database
      -> resource manager B: message broker
      -> possibly XA coordination / two-phase commit
```

Distributed transaction mahal dan kompleks. Banyak sistem modern lebih memilih local transaction + outbox + eventual consistency daripada XA transaction lintas resource.

### 10.3 `EntityTransaction` vs `UserTransaction` vs annotation

Dalam Java SE JPA manual:

```java
EntityTransaction tx = entityManager.getTransaction();
tx.begin();
try {
    // work
    tx.commit();
} catch (RuntimeException ex) {
    tx.rollback();
    throw ex;
}
```

Dalam Jakarta EE, aplikasi bisa memakai `UserTransaction` atau container-managed transaction.

Dalam Spring, aplikasi biasanya memakai `@Transactional` milik Spring, yang dikelola oleh Spring transaction abstraction.

Dalam Jakarta, ada `jakarta.transaction.Transactional`.

Yang penting: annotation bukan transaction itu sendiri. Annotation adalah metadata untuk interceptor/proxy/container agar transaction manager melakukan begin/commit/rollback pada waktu yang tepat.

---

## 11. Spring Transaction Abstraction: Unifying Local and Global Transaction APIs

Spring menyediakan transaction abstraction yang bisa bekerja dengan beberapa transaction manager:

- `DataSourceTransactionManager` untuk JDBC local transaction,
- `JpaTransactionManager` untuk JPA local transaction,
- JTA transaction manager untuk distributed/container transaction,
- reactive transaction manager untuk stack reactive tertentu.

Dalam aplikasi Spring Boot + JPA, pola umum:

```text
@Service
@Transactional
ApplicationService
  -> Spring AOP proxy/interceptor
  -> PlatformTransactionManager
  -> JpaTransactionManager
  -> EntityManager bound to thread
  -> JDBC Connection from DataSource/HikariCP
  -> Database transaction
```

### 11.1 Kenapa ini penting

Banyak bug transaction di Spring bukan bug database, tetapi bug proxy/interceptor:

- self-invocation tidak melewati proxy,
- method non-public tidak diproxy pada mode tertentu,
- `@Transactional` di private method tidak efektif,
- async/thread baru tidak membawa transaction context,
- transaction propagation salah,
- rollback rules tidak sesuai expectation,
- exception ditangkap lalu tidak rethrow sehingga commit terjadi.

### 11.2 Transaction abstraction bukan excuse untuk tidak paham DB

Spring bisa membuka/menutup transaction, tetapi tidak bisa otomatis memilih isolation level yang benar, mencegah all race condition, atau menentukan business invariant.

---

## 12. Connection Pool: The Hidden Runtime Boundary

Walau Part JDBC/HikariCP sudah pernah dibahas di seri lain, di sini kita perlu menempatkannya dalam peta persistence.

Connection pool berada di antara application dan database driver. ORM tidak membuka TCP connection baru untuk setiap query jika memakai pool; ORM meminjam connection dari pool.

```text
EntityManager / Hibernate Session
  -> JDBC Connection logical use
  -> HikariCP/DataSource
  -> physical database connection
  -> database session/process
```

### 12.1 Kenapa connection pool penting untuk JPA

Transaction yang terbuka lama akan menahan connection lebih lama.

Lazy loading di luar transaction bisa menyebabkan:

- exception,
- atau connection dipinjam ulang tergantung OSIV/implementation,
- atau query tidak terduga.

Batch job yang tidak chunking bisa menahan connection dan transaction terlalu lama.

N+1 memperbanyak roundtrip lewat connection yang sama, menambah latency dan load.

Connection leak sering terlihat sebagai JPA problem, padahal akar bisa transaction boundary atau stream/resultset yang tidak ditutup.

---

## 13. Application Server / Container vs Standalone Application

Persistence stack berbeda antara Jakarta EE container dan standalone Spring Boot/Quarkus/Micronaut application.

### 13.1 Jakarta EE container model

```text
Application Server
  - manages DataSource
  - manages EntityManager injection
  - manages transaction interceptor
  - manages JTA transaction manager
  - integrates security, CDI, EJB/Jakarta components
```

Application code cenderung deklaratif:

```java
@PersistenceContext
EntityManager em;

@Transactional
public void submitCase(...) {
    // persistence work
}
```

### 13.2 Spring Boot standalone model

```text
Spring Boot Application
  - configures DataSource bean
  - configures EntityManagerFactory
  - configures JpaTransactionManager
  - configures repositories
  - runs embedded server
```

### 13.3 Quarkus / Micronaut / Helidon style

Modern frameworks sering melakukan build-time optimization, reflection reduction, native image support, dan integration khusus dengan Hibernate/JPA/Jakarta specs.

Implikasinya:

- entity scanning bisa build-time,
- lazy loading/proxy/bytecode enhancement punya constraint,
- reflection config penting di native image,
- transaction boundary tetap harus jelas.

---

## 14. `javax.persistence` to `jakarta.persistence`: More Than Import Rename

Transisi dari Java EE ke Jakarta EE mengubah namespace dari `javax.*` ke `jakarta.*` untuk banyak specification, termasuk Persistence dan Transactions.

Contoh lama:

```java
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.transaction.Transactional;
```

Contoh baru:

```java
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.transaction.Transactional;
```

### 14.1 Kenapa bukan sekadar rename

Dalam aplikasi kecil, migration bisa terlihat seperti replace import. Dalam sistem besar, dampaknya bisa melibatkan:

- dependency tree,
- framework version,
- application server version,
- JPA provider version,
- Hibernate version,
- Bean Validation namespace,
- Servlet/JAX-RS/CDI namespace,
- generated code,
- annotation processor,
- bytecode enhancement plugin,
- testing framework,
- third-party library compatibility,
- transitive dependencies yang masih `javax.*`,
- serialization/deserialization class name assumptions,
- reflection-based scanning.

### 14.2 Compatibility trap

Tidak boleh mencampur sembarangan:

```text
Spring Boot 2.x + Hibernate 5.x + javax.persistence
Spring Boot 3.x + Hibernate 6.x + jakarta.persistence
```

Mencampur `javax.persistence.Entity` dengan framework yang mencari `jakarta.persistence.Entity` bisa membuat entity tidak terdeteksi.

### 14.3 Migration approach

Strategi sehat:

1. Inventory dependency.
2. Tentukan target platform.
3. Upgrade framework utama.
4. Upgrade persistence provider.
5. Migrasi namespace.
6. Perbaiki API behavior changes.
7. Jalankan integration test dengan real database.
8. Validasi generated SQL dan migration schema.
9. Validasi performance hot path.
10. Validasi transaction behavior.

---

## 15. Version Matrix: Java 8 sampai Java 25

Ini bukan matrix absolut untuk semua kombinasi, tetapi peta praktis yang sering ditemui.

| Era | Java | Persistence API | Provider umum | Framework umum | Catatan |
|---|---:|---|---|---|---|
| Legacy modern | 8 | JPA 2.1/2.2 `javax.persistence` | Hibernate 5.x, EclipseLink | Spring Boot 2.x, Java EE 7/8 | Banyak enterprise system masih di sini |
| Transitional | 11 | JPA 2.2 atau Jakarta 3.0 tergantung platform | Hibernate 5/6 | Spring Boot 2/3 awal, Jakarta EE 9/10 | Banyak migration pain |
| Modern baseline | 17 | Jakarta Persistence 3.1/3.2 | Hibernate 6/7 | Spring Boot 3.x, Jakarta EE 10/11 | Java 17 menjadi baseline banyak framework modern |
| Current LTS style | 21 | Jakarta Persistence 3.2 | Hibernate 6.6+/7.x | Jakarta EE 11, Spring Boot modern | Virtual threads mulai relevan secara operational |
| Forward-looking | 25 | Jakarta Persistence 3.x/4.x tergantung waktu | Hibernate modern | Framework modern | Fokus compatibility, preview/final features, runtime tuning |

Prinsip: jangan memilih versi persistence API hanya karena versi Java. Pilih berdasarkan platform/framework/provider compatibility.

---

## 16. Layer Responsibility Matrix

| Layer | Tanggung Jawab | Bukan Tanggung Jawab |
|---|---|---|
| JDBC | SQL execution, connection-level transaction, result reading | Domain lifecycle, relationship mapping otomatis |
| Connection Pool | Reuse connection, timeout, leak detection, pool metrics | Query optimization, transaction correctness |
| JPA/Jakarta Persistence | ORM standard, persistence context, entity lifecycle, JPQL | Provider-specific optimization, schema migration lengkap |
| Hibernate | JPA implementation + advanced ORM features | Business invariant otomatis benar |
| Spring Data JPA | Repository abstraction di Spring | Menghilangkan kebutuhan memahami JPA/Hibernate |
| Jakarta Data | Standard repository abstraction di Jakarta EE | Menggantikan semua complex query design |
| Jakarta Transactions | Standard transaction coordination API | Menjamin distributed consistency tanpa desain benar |
| Spring Transaction | Transaction abstraction di Spring | Mencegah semua race condition/deadlock |
| Database | Storage, constraints, locks, isolation, execution plan | Mengetahui maksud bisnis tanpa constraint/model |
| Application Service | Use-case orchestration and transaction boundary | SQL detail berlebihan kecuali use case butuh |
| Domain Model | Business invariant and state transition semantics | Database connection management |

---

## 17. Common Stack Compositions

### 17.1 Spring Boot 2 legacy stack

```text
Java 8/11
Spring Boot 2.x
Spring Framework 5.x
Spring Data JPA
Hibernate 5.x
javax.persistence
javax.transaction or Spring @Transactional
HikariCP
JDBC Driver
Database
```

Masalah khas:

- legacy `javax` namespace,
- migration ke Spring Boot 3 butuh Jakarta namespace,
- Hibernate 5 behavior berbeda dari Hibernate 6,
- query dan mapping mungkin perlu penyesuaian.

### 17.2 Spring Boot 3 modern stack

```text
Java 17/21+
Spring Boot 3.x
Spring Framework 6.x
Spring Data JPA
Hibernate 6.x
jakarta.persistence
Spring @Transactional / jakarta.transaction.Transactional support
HikariCP
JDBC Driver
Database
```

Masalah khas:

- migration dependency,
- Hibernate 6 query/type changes,
- stricter behavior,
- generated SQL berubah,
- tests dengan H2 makin misleading jika production database berbeda.

### 17.3 Jakarta EE 11 style stack

```text
Java 17/21+
Jakarta EE 11 server/runtime
Jakarta Persistence 3.2
Jakarta Data 1.0
Jakarta Transactions 2.x
Hibernate/EclipseLink/provider
Managed DataSource
Database
```

Masalah khas:

- provider compatibility,
- server-managed resource,
- transaction config di container,
- Jakarta Data implementation support,
- deployment descriptor/server config.

### 17.4 Quarkus/Hibernate Panache-like stack

```text
Java 17/21+
Quarkus
Hibernate ORM / Hibernate Reactive depending stack
Panache or repository pattern
Narayana/JTA integration when needed
Agroal/DataSource
Database
```

Masalah khas:

- build-time augmentation,
- native image constraints,
- different dev ergonomics,
- transaction model tetap harus dipahami.

---

## 18. How to Choose the Right Abstraction Level

### 18.1 Use repository abstraction when

- CRUD/use case sederhana,
- query mudah dipahami,
- pagination/projection standar,
- business logic berada di service/domain,
- performance tidak bottleneck.

### 18.2 Use JPA/Hibernate directly when

- butuh kontrol fetch plan,
- butuh entity graph,
- butuh lock mode,
- butuh batch behavior,
- butuh provider-specific optimization,
- repository abstraction terlalu membatasi.

### 18.3 Use native SQL/JDBC when

- query sangat kompleks,
- reporting heavy,
- bulk update/delete besar,
- recursive query/vendor-specific feature,
- performance membutuhkan SQL eksplisit,
- stored procedure adalah contract,
- ORM mapping akan lebih membingungkan daripada membantu.

### 18.4 Use transaction manager consciously when

- ada lebih dari satu resource,
- perlu propagation berbeda,
- perlu retry/timeout policy,
- ada message processing,
- ada external API call,
- ada workflow state transition.

---

## 19. Abstraction Failure Examples

### 19.1 Repository method terlihat sederhana, SQL-nya mahal

```java
List<CaseEntity> findByStatus(String status);
```

Terlihat sederhana, tetapi bisa buruk jika:

- status punya jutaan rows,
- tidak ada pagination,
- tidak ada index,
- entity punya eager association,
- caller mengakses lazy collection dalam loop,
- result masuk persistence context semua,
- transaction panjang.

### 19.2 Entity update terlihat satu field, SQL-nya tidak sesederhana itu

```java
caseEntity.setStatus("APPROVED");
```

Bisa menyebabkan:

- dirty checking semua managed entities,
- flush before query,
- update lebih dari satu column tergantung dynamic update,
- optimistic version increment,
- trigger database berjalan,
- audit listener berjalan,
- constraint violation saat flush.

### 19.3 `@Transactional` terlihat aman, boundary-nya salah

```java
@Transactional
public void submitCase(...) {
    caseRepository.save(caseEntity);
    externalSystem.notify(caseEntity.getId());
}
```

Failure mode:

- external call sukses, DB rollback,
- DB commit sukses, response timeout,
- external call lambat menahan DB transaction,
- retry menggandakan notification,
- lock ditahan terlalu lama.

Solusi bisa berupa:

- outbox,
- after-commit hook,
- idempotency key,
- transaction split,
- compensation,
- retry classification.

---

## 20. Portability vs Power

JPA/Jakarta Persistence memberi portability. Hibernate memberi power. Spring Data/Jakarta Data memberi productivity. JDBC/native SQL memberi control.

Tidak ada satu layer yang selalu benar.

```text
Portability tinggi
  JPA / Jakarta Persistence standard
  Jakarta Data standard

Productivity tinggi
  Spring Data JPA
  Jakarta Data repositories

Power tinggi
  Hibernate native features
  Native SQL
  JDBC

Control tertinggi
  Database-specific SQL/procedure/index/lock design
```

Decision rule:

1. Mulai dari abstraction paling sederhana yang masih benar.
2. Jangan naik abstraction jika correctness menjadi samar.
3. Jangan turun abstraction hanya demi macho engineering.
4. Turun layer ketika butuh performance, correctness, observability, atau vendor feature.
5. Dokumentasikan setiap provider/database-specific decision.

---

## 21. Reading Documentation Like a Senior Engineer

Untuk persistence stack, dokumentasi harus dibaca dengan membedakan jenisnya.

### 21.1 Specification documentation

Contoh:

- Jakarta Persistence specification,
- Jakarta Data specification,
- Jakarta Transactions specification.

Spec menjawab:

- apa contract standard,
- apa yang portable,
- istilah resmi,
- expected behavior minimum,
- API semantics.

Spec tidak selalu menjawab:

- provider terbaik,
- tuning production,
- database-specific behavior,
- framework integration detail.

### 21.2 Provider documentation

Contoh:

- Hibernate ORM User Guide,
- Hibernate migration guide,
- EclipseLink docs.

Provider docs menjawab:

- actual implementation behavior,
- extension features,
- performance tuning,
- migration caveats,
- annotations tambahan,
- SQL generation behavior.

### 21.3 Framework documentation

Contoh:

- Spring Data JPA docs,
- Spring transaction docs,
- Quarkus Hibernate ORM docs.

Framework docs menjawab:

- wiring,
- bootstrapping,
- repository abstraction,
- transaction proxy/interceptor,
- testing support,
- configuration properties.

### 21.4 Database documentation

Database docs menjawab:

- lock behavior,
- isolation semantics,
- optimizer,
- index type,
- sequence/identity,
- partitioning,
- deadlock detection,
- LOB behavior,
- execution plan.

Senior engineer tidak hanya membaca satu layer.

---

## 22. Practical Decision Tree

Gunakan decision tree berikut saat memilih pendekatan persistence.

```text
Apakah operasi hanya CRUD sederhana?
  yes -> repository abstraction cukup
  no  -> lanjut

Apakah query masih entity-centric dan relationship perlu dikelola ORM?
  yes -> JPA/Hibernate + explicit fetch plan/query
  no  -> lanjut

Apakah query read-heavy/reporting/aggregation kompleks?
  yes -> DTO projection/native SQL/read model
  no  -> lanjut

Apakah operasi write-heavy/bulk besar?
  yes -> batch JPA dengan flush-clear, StatelessSession, JDBC, atau SQL bulk
  no  -> lanjut

Apakah butuh atomicity dengan message/external side effect?
  yes -> local transaction + outbox/idempotency; hindari distributed transaction kecuali benar-benar perlu
  no  -> transaction lokal biasa

Apakah correctness bergantung concurrency?
  yes -> pikirkan isolation, optimistic/pessimistic locking, constraint, retry
  no  -> tetap pasang constraint minimum
```

---

## 23. Anti-Patterns

### 23.1 “Kami pakai JPA jadi tidak perlu tahu SQL”

Salah. JPA menghasilkan SQL. Database mengeksekusi SQL. Performance dan correctness tetap bergantung SQL, index, lock, isolation, dan transaction.

### 23.2 “Repository adalah service”

Repository seharusnya data access boundary. Jika repository mulai mengatur workflow, call external API, publish event, dan menentukan business process, boundary rusak.

### 23.3 “Entity adalah DTO”

Entity punya identity, lifecycle, persistence context, lazy association, dirty checking, dan transaction semantics. DTO adalah data carrier. Mencampur keduanya membuat API, serialization, lazy loading, dan security risk.

### 23.4 “`@Transactional` di mana-mana lebih aman”

Transaction yang terlalu luas menahan connection/lock lebih lama. Transaction yang terlalu sempit merusak invariant. Boundary harus berdasarkan use case dan consistency requirement.

### 23.5 “Semua query harus derived method name”

Derived query bagus untuk simple case. Untuk query kompleks, method name panjang membuat intent tidak jelas dan tuning sulit.

### 23.6 “Pure JPA selalu lebih profesional”

Kadang provider-specific Hibernate feature adalah solusi paling tepat. Profesional bukan berarti dogmatis; profesional berarti sadar trade-off.

### 23.7 “Native SQL berarti gagal memakai ORM”

Native SQL adalah tool valid untuk query tertentu. Kegagalan bukan memakai native SQL, tetapi mencampur native SQL dengan persistence context tanpa memahami stale state, transaction, dan mapping consequence.

---

## 24. Failure Modes by Layer

| Symptom | Kemungkinan Layer | Contoh Penyebab |
|---|---|---|
| N+1 query | ORM/fetching | Lazy collection diakses dalam loop |
| Connection pool exhausted | Transaction/pool/application | Transaction lama, leak, slow query |
| Deadlock | DB/SQL/order | Update order tidak konsisten |
| Optimistic lock exception | Concurrency/entity version | Dua user update entity yang sama |
| LazyInitializationException | Persistence context boundary | Entity lazy dipakai setelah session closed |
| Slow listing page | Query/projection/index | Return entity penuh, no pagination, no index |
| Duplicate event | Integration transaction | DB commit dan message publish tidak atomic |
| Data violates business rule | Constraint/invariant | Validasi hanya di application, race condition |
| Migration broke runtime | Namespace/version | Mix `javax` and `jakarta`, provider mismatch |
| Stale data after bulk update | Persistence context | Bulk query bypass managed entities |

---

## 25. Example: Same Use Case Across Layers

Use case: submit case.

Business requirement:

- Case must move from `DRAFT` to `SUBMITTED`.
- Only owner can submit.
- Submission timestamp recorded.
- Duplicate submit request should not create inconsistent state.
- Notification/event should be emitted after commit.

### 25.1 Naive repository-only thinking

```java
caseRepository.findById(id)
    .ifPresent(c -> {
        c.setStatus("SUBMITTED");
        caseRepository.save(c);
    });
```

Problem:

- no state guard,
- no owner check,
- no transaction boundary visible,
- no concurrency handling,
- no outbox/event handling,
- duplicate request ambiguous.

### 25.2 Better application service thinking

```java
@Transactional
public SubmitCaseResult submitCase(SubmitCaseCommand command) {
    CaseEntity caseEntity = caseRepository.findForSubmission(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

    caseEntity.submit(command.actorId(), clock.instant());

    outboxRepository.append(
            OutboxEvent.caseSubmitted(caseEntity.getId(), command.idempotencyKey())
    );

    return SubmitCaseResult.submitted(caseEntity.getId());
}
```

Improvements:

- transaction boundary at use case,
- entity method owns state transition invariant,
- repository query can choose fetch/lock strategy,
- outbox participates in same DB transaction,
- event publication happens separately after commit.

### 25.3 Even stronger concurrency-aware model

```java
@Modifying
@Query("""
    update CaseEntity c
       set c.status = :submitted,
           c.submittedAt = :submittedAt,
           c.version = c.version + 1
     where c.id = :caseId
       and c.status = :draft
       and c.ownerId = :actorId
""")
int submitIfDraft(
        long caseId,
        long actorId,
        String draft,
        String submitted,
        Instant submittedAt
);
```

This avoids some lost update patterns by making transition conditional in the database. But it bypasses managed entity lifecycle and must be used carefully with persistence context.

Lesson: abstraction choice depends on invariant and contention.

---

## 26. What Top Engineers Internalize

Top engineers internalize these points:

1. Persistence is not CRUD; it is consistency boundary.
2. ORM is not magic; it is SQL generation plus identity map plus unit of work plus mapping metadata.
3. Repository abstraction improves productivity but can hide query cost.
4. Transaction boundary belongs to use case, not random repository calls.
5. Database constraints are part of domain correctness, not just storage hygiene.
6. Provider-specific features are acceptable when intentionally chosen.
7. Migration across Java/Jakarta/Hibernate versions must be tested with real database behavior.
8. Performance problems often appear as Java problems but originate from query plans, locks, indexes, or transaction duration.
9. Distributed side effects require explicit pattern: outbox, inbox, idempotency, retry classification.
10. A persistence design is incomplete until failure modes are named.

---

## 27. Checklist

Sebelum memilih persistence stack atau membuat persistence module, tanyakan:

- Apakah target platform `javax` atau `jakarta`?
- Versi Java berapa yang menjadi runtime baseline?
- JPA provider apa yang dipakai?
- Apakah provider-specific feature diperbolehkan?
- Apakah repository abstraction Spring Data, Jakarta Data, atau manual?
- Di mana transaction boundary berada?
- Apakah transaction manager local atau JTA?
- Apakah ada lebih dari satu resource dalam satu use case?
- Apakah ada external API/message publish di sekitar transaction?
- Apakah schema migration dikelola tool seperti Flyway/Liquibase?
- Apakah tests memakai database yang sama dengan production behavior?
- Apakah query hot path punya projection dan index yang jelas?
- Apakah locking/isolation requirement sudah dinamai?
- Apakah failure mode sudah dipetakan?

---

## 28. Latihan Berpikir

### Latihan 1 — Layer Identification

Untuk operasi berikut, identifikasi layer mana yang paling relevan:

1. Query lambat karena full table scan.
2. `LazyInitializationException` saat serialize response.
3. Dua approval bersamaan membuat status tidak valid.
4. Event terkirim dua kali setelah retry.
5. Migration dari Spring Boot 2 ke 3 membuat entity tidak terdeteksi.
6. Batch job membuat heap naik terus.
7. Deadlock saat update parent-child.
8. Connection pool habis setiap jam 2 pagi.

Jawaban yang baik harus menyebut lebih dari satu layer, karena production issue jarang murni satu layer.

### Latihan 2 — Abstraction Choice

Untuk use case berikut, pilih repository/JPA/native SQL/JDBC/outbox/locking yang sesuai:

1. Listing 100 recent cases dengan 8 kolom ringkasan.
2. Export 5 juta audit records ke object storage.
3. Submit case dari draft ke submitted.
4. Generate monthly regulatory report dengan join dan aggregation besar.
5. Update 200 ribu rows karena migration enum value.
6. Publish event setelah approval sukses.
7. Assign next unprocessed job ke worker paralel.

### Latihan 3 — Migration Risk

Kamu punya aplikasi:

```text
Java 8
Spring Boot 2.7
Hibernate 5.6
javax.persistence
Oracle DB
Spring Data JPA
```

Target:

```text
Java 21
Spring Boot 3.x
Hibernate 6.x
jakarta.persistence
```

Buat risk list minimal 15 item. Kelompokkan menjadi:

- compile risk,
- runtime behavior risk,
- SQL/query risk,
- transaction risk,
- test risk,
- production rollout risk.

---

## 29. Ringkasan

Ekosistem persistence Java terlihat kompleks karena ia memang menyelesaikan beberapa problem berbeda:

- JDBC memberi akses SQL dasar.
- JPA/Jakarta Persistence memberi standard ORM contract.
- Hibernate memberi implementation dan fitur ORM lanjutan.
- Spring Data JPA memberi repository abstraction di Spring.
- Jakarta Data membawa repository abstraction ke standard Jakarta EE.
- Jakarta Transactions memberi standard transaction coordination.
- Spring transaction abstraction mengintegrasikan transaction management dalam aplikasi Spring.
- Database tetap menjadi sumber kebenaran untuk storage, constraints, locks, isolation, dan execution plan.

Abstraction yang benar bukan membuat kita lupa layer bawah. Abstraction yang benar membuat kita tahu kapan layer bawah harus diperhatikan.

Jika Part 000 membangun mental model bahwa persistence adalah boundary, Part 001 menunjukkan **peta teknologi** yang membentuk boundary tersebut.

---

## 30. Referensi Resmi dan Bacaan Lanjutan

- Jakarta Persistence 3.2 Specification — https://jakarta.ee/specifications/persistence/3.2/
- Jakarta Persistence 3.2 Specification Document — https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Jakarta Data 1.0 Specification — https://jakarta.ee/specifications/data/1.0/
- Jakarta Data 1.1 Under Development — https://jakarta.ee/specifications/data/1.1/
- Jakarta Transactions 2.0 Specification — https://jakarta.ee/specifications/transactions/2.0/
- Jakarta Transactions Tutorial — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/transactions/transactions.html
- Hibernate ORM Documentation — https://hibernate.org/orm/documentation/
- Hibernate ORM 7.0 Migration Guide — https://docs.hibernate.org/orm/7.0/migration-guide/

---

## 31. Status Seri

Part ini adalah **Part 001 dari 032**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 002 — Persistence Architecture: Layering, Boundaries, and Dependency Direction
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 000 — Big Picture: Persistence as a Boundary, Not a CRUD Layer](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 002 — Persistence Architecture: Layering, Boundaries, and Dependency Direction](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-002.md)

</div>