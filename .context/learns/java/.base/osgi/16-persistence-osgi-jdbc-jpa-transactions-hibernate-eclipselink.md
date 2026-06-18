# Part 16 — Persistence in OSGi: JDBC, JPA, Transactions, Hibernate, EclipseLink

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `16-persistence-osgi-jdbc-jpa-transactions-hibernate-eclipselink.md`  
> Scope Java: 8 sampai 25  
> Level: Advanced / top-tier software engineering  
> Fokus: bagaimana persistence bekerja ketika classpath global diganti oleh runtime modular, service registry, bundle lifecycle, dan classloader isolation.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Memahami kenapa persistence adalah salah satu area paling sulit di OSGi.
2. Mendesain boundary persistence yang tidak bocor antar bundle/classloader.
3. Menyediakan `DataSource`, JDBC driver, transaction manager, repository, dan JPA provider sebagai runtime service yang eksplisit.
4. Men-debug failure seperti `No suitable driver`, entity tidak ter-scan, persistence unit tidak ditemukan, proxy classloader error, duplicate provider, transaction tidak aktif, dan weaving gagal.
5. Memilih pendekatan persistence yang tepat:
   - plain JDBC,
   - repository service,
   - JPA managed by OSGi JPA service,
   - JPA unmanaged/manual,
   - Transaction Control Service,
   - Aries Blueprint/JPA,
   - atau memisahkan persistence ke service eksternal.
6. Memahami trade-off Hibernate vs EclipseLink di OSGi.
7. Membuat desain production-grade yang kompatibel dengan Java 8 sampai Java 25.

Bagian ini tidak mengulang JDBC/JPA dasar. Fokusnya adalah konsekuensi OSGi: classloading, lifecycle, service discovery, resolver, transaction scope, dynamic availability, metadata discovery, dan operability.

---

## 1. Persistence di OSGi Itu Bukan Sekadar “Add Dependency”

Di aplikasi Java biasa, persistence sering diasumsikan begini:

```text
application classpath
  ├── app code
  ├── JDBC driver
  ├── HikariCP
  ├── Hibernate/EclipseLink
  ├── entity classes
  ├── persistence.xml
  └── migration tool
```

Semua berada di satu classpath besar. Banyak library bisa melakukan:

```java
Class.forName("org.postgresql.Driver");
Thread.currentThread().getContextClassLoader();
ServiceLoader.load(...);
scanClasspathForEntities();
```

Dan biasanya berhasil karena semua class terlihat dari mana-mana.

Di OSGi, modelnya berubah:

```text
OSGi Framework
  ├── bundle: database-driver-postgres
  ├── bundle: datasource-provider
  ├── bundle: transaction-control
  ├── bundle: jpa-provider-hibernate/eclipselink
  ├── bundle: domain-case-api
  ├── bundle: domain-case-persistence
  ├── bundle: case-service
  └── service registry
```

Setiap bundle punya classloader sendiri. Tidak ada classpath global. Bundle hanya melihat package yang:

1. ia miliki sendiri,
2. di-import dari bundle lain,
3. disediakan framework/system bundle,
4. ditambahkan via fragment/embedded classpath secara eksplisit.

Maka persistence menjadi sulit karena banyak framework persistence historisnya dibangun di atas asumsi classpath global dan scanning bebas.

### Mental model utama

Persistence di OSGi harus dipikirkan sebagai **runtime contract graph**, bukan dependency Maven biasa.

```text
JDBC Driver        -> service / package provider
DataSource         -> service
TransactionControl -> service
EntityManager      -> lifecycle-bound object
Repository         -> domain-facing service
Domain Service     -> consumes repository service
```

Jika salah satu node berubah, hilang, atau classloader-nya tidak cocok, persistence bisa gagal walaupun aplikasi compile.

---

## 2. Problem Space: Kenapa Persistence Sulit di OSGi

Ada tujuh sumber kompleksitas utama.

### 2.1 Driver discovery

JDBC modern menggunakan `java.sql.DriverManager` dan `ServiceLoader` untuk menemukan driver dari `META-INF/services/java.sql.Driver`.

Di classpath biasa, ini mudah. Di OSGi, driver berada di bundle lain. `DriverManager` tidak otomatis tahu semua driver dari semua bundle.

Failure umum:

```text
java.sql.SQLException: No suitable driver found for jdbc:postgresql://...
```

Penyebabnya bukan selalu URL salah. Bisa jadi:

- driver bundle tidak aktif,
- driver tidak registered sebagai OSGi service,
- package `java.sql` OK, tapi driver implementation tidak terlihat,
- TCCL salah,
- DataSource provider tidak mengikat driver service.

### 2.2 DataSource lifecycle

Di aplikasi biasa, `DataSource` dibuat saat startup dan hidup selama aplikasi hidup.

Di OSGi:

- `DataSource` bisa muncul setelah consumer aktif,
- config bisa berubah,
- credential bisa rotate,
- bundle pool bisa restart,
- driver bisa di-update,
- repository service harus survive unavailable dependency.

### 2.3 Transaction boundary

Transaction tidak boleh diperlakukan sebagai static thread-local global tanpa ownership yang jelas.

Di OSGi, boundary transaction harus menjawab:

- siapa membuka transaction?
- siapa commit/rollback?
- service call mana yang berada di scope yang sama?
- apa yang terjadi jika service dependency hilang saat transaction berjalan?
- apakah transaction boleh melintasi bundle boundary?
- apakah thread berpindah?

### 2.4 Entity classloading

JPA provider harus melihat:

- entity classes,
- embeddables,
- converters,
- listeners,
- persistence.xml,
- provider implementation,
- JDBC driver,
- transaction API,
- weaving/proxy classes.

Di OSGi, entity class biasanya berada di domain persistence bundle. Provider ada di bundle lain. Jika provider scanning menggunakan TCCL yang salah, entity tidak ditemukan.

Failure umum:

```text
Unknown entity: com.example.case.persistence.CaseEntity
```

atau:

```text
ClassNotFoundException: com.example.case.persistence.CaseEntity
```

atau:

```text
ClassCastException: com.example.CaseEntity cannot be cast to com.example.CaseEntity
```

Yang terakhir tampak absurd, tetapi biasanya berarti class yang sama dimuat oleh dua classloader berbeda.

### 2.5 Proxy dan enhancement

Hibernate/EclipseLink membuat proxy, lazy loading handler, bytecode-enhanced entity, atau weaving.

Di OSGi, proxy class harus didefinisikan di classloader yang benar. Kalau tidak:

- proxy tidak bisa cast ke entity/interface,
- lazy loading gagal,
- enhancer tidak bisa melihat package,
- reflective access terblokir di Java 17+.

### 2.6 Metadata discovery

Banyak persistence stack mengandalkan:

- annotation scanning,
- `persistence.xml`,
- `META-INF/services`,
- XML mapping,
- classpath resource lookup.

Di OSGi, resource discovery harus dibatasi oleh bundle visibility. Ini baik untuk isolation, tetapi buruk untuk library yang berasumsi “scan everything”.

### 2.7 Static global state

Persistence provider sering punya cache, registry, metamodel, reflection cache, proxy factory, service registry, atau static utility.

Jika static cache menyimpan class dari bundle lama, bundle update/refresh bisa menyebabkan memory leak.

Contoh:

```text
old bundle classloader -> entity class -> provider cache -> static registry -> never GC
```

---

## 3. Layered Model Persistence di OSGi

Desain persistence yang sehat biasanya dipisahkan menjadi layer eksplisit.

```text
[Database]
    ↑
[JDBC Driver Bundle]
    ↑
[DataSource Provider Bundle]
    ↑
[Transaction Service Bundle]
    ↑
[Persistence Implementation Bundle]
    ↑
[Repository Service Bundle]
    ↑
[Domain/Application Service Bundle]
    ↑
[HTTP/API/UI/Event Consumer Bundle]
```

### Prinsip utama

Domain/application service sebaiknya tidak peduli apakah repository memakai:

- JDBC,
- JPA,
- MyBatis,
- jOOQ,
- stored procedure,
- remote persistence service.

Kontrak service-nya harus stabil:

```java
public interface CaseRepository {
    Optional<CaseRecord> findById(CaseId id);
    void save(CaseRecord record);
}
```

Implementation persistence boleh berubah secara dinamis atau di-upgrade tanpa memaksa semua consumer tahu detail Hibernate/EclipseLink/JDBC.

---

## 4. JDBC di OSGi

### 4.1 JDBC paling sederhana: driver embedded di bundle consumer

Pendekatan paling sederhana:

```text
case-persistence bundle
  ├── repository classes
  ├── HikariCP
  └── PostgreSQL/Oracle driver embedded
```

Kelebihan:

- mudah,
- sedikit runtime dependency,
- cocok untuk aplikasi kecil.

Kekurangan:

- setiap bundle bisa membawa driver sendiri,
- duplicate driver,
- upgrade driver sulit dikontrol,
- classloader isolation bisa membuat monitoring/pooling tidak seragam,
- bukan model OSGi yang bersih.

Gunakan hanya jika runtime kecil dan tidak butuh dynamic driver/provider sharing.

### 4.2 JDBC driver sebagai bundle terpisah

Model lebih OSGi:

```text
org.postgresql.jdbc bundle
  exports org.postgresql.*
  registers java.sql.Driver service / DataSourceFactory service
```

Consumer tidak perlu embed driver. DataSource provider menggunakan driver service.

OSGi menyediakan spesifikasi JDBC Service yang memungkinkan driver menyediakan `DataSourceFactory` sebagai service. JPA Service specification juga menyebut bagaimana driver database ditemukan melalui Data Service/JDBC technology di OSGi.  

### 4.3 DataSourceFactory

Pola umum:

```java
@Reference(
    target = "(osgi.jdbc.driver.class=org.postgresql.Driver)"
)
DataSourceFactory factory;
```

Lalu:

```java
Properties props = new Properties();
props.put(DataSourceFactory.JDBC_URL, url);
props.put(DataSourceFactory.JDBC_USER, user);
props.put(DataSourceFactory.JDBC_PASSWORD, password);

DataSource ds = factory.createDataSource(props);
```

Dalam production, biasanya kamu tidak expose password langsung di OSGi config biasa. Gunakan secret reference:

```text
jdbc.password.secretRef=/prod/case-db/password
```

Lalu komponen mengambil secret dari secret service/parameter store.

### 4.4 DataSource sebagai OSGi service

Lebih baik consumer repository tidak membuat datasource sendiri. Buat provider:

```java
@Component(service = DataSource.class, configurationPid = "case.datasource")
public final class CaseDataSourceProvider {
    private volatile HikariDataSource dataSource;

    @Activate
    void activate(CaseDbConfig cfg) {
        HikariConfig hc = new HikariConfig();
        hc.setJdbcUrl(cfg.url());
        hc.setUsername(cfg.username());
        hc.setPassword(resolveSecret(cfg.passwordSecretRef()));
        hc.setMaximumPoolSize(cfg.maxPoolSize());
        this.dataSource = new HikariDataSource(hc);
    }

    @Deactivate
    void deactivate() {
        HikariDataSource ds = dataSource;
        if (ds != null) {
            ds.close();
        }
    }

    public Connection getConnection() throws SQLException {
        return dataSource.getConnection();
    }
}
```

Tetapi ada masalah: `DataSource` adalah interface, sedangkan class di atas tidak directly implement `DataSource`. Lebih aman register actual datasource atau wrapper:

```java
@Component(service = DataSource.class, configurationPid = "case.datasource")
public final class ManagedCaseDataSource implements DataSource {
    private volatile HikariDataSource delegate;

    @Activate
    void activate(CaseDbConfig cfg) {
        this.delegate = create(cfg);
    }

    @Modified
    void modified(CaseDbConfig cfg) {
        HikariDataSource old = this.delegate;
        HikariDataSource next = create(cfg);
        this.delegate = next;
        old.close();
    }

    @Deactivate
    void deactivate() {
        delegate.close();
    }

    @Override
    public Connection getConnection() throws SQLException {
        return delegate.getConnection();
    }

    // delegate other DataSource methods
}
```

Namun hati-hati: `@Modified` seperti di atas bisa memutus active connection bila pool lama ditutup terlalu cepat. Untuk production, gunakan draining strategy.

### 4.5 Safer DataSource reconfiguration

Pola yang lebih aman:

```text
config modified
  -> create new pool
  -> switch atomic reference
  -> old pool stops accepting new borrows
  -> wait grace period / active connection count zero
  -> close old pool
```

Mental model:

```text
new requests -> new pool
old in-flight transactions -> old pool until complete
```

Ini mirip blue/green internal resource.

---

## 5. Repository Service Pattern

Repository sebaiknya diekspos sebagai OSGi service, bukan class implementation yang di-import langsung oleh consumer.

### 5.1 API bundle

```text
com.acme.case.repository.api
  exports com.acme.case.repository.api;version=1.4.0
```

```java
package com.acme.case.repository.api;

public interface CaseRepository {
    Optional<CaseSnapshot> find(CaseId id);
    Page<CaseSummary> search(CaseSearchCriteria criteria);
    SaveResult save(CaseDraft draft);
}
```

API ini tidak boleh expose:

- `EntityManager`,
- Hibernate `Session`,
- JPA entity class,
- SQL connection,
- transaction object,
- provider-specific exception.

### 5.2 Persistence implementation bundle

```text
com.acme.case.persistence.jpa
  imports repository API
  imports DataSource/Transaction/JPA provider packages
  private package entity classes
  registers CaseRepository service
```

```java
@Component(service = CaseRepository.class)
public final class JpaCaseRepository implements CaseRepository {
    private final EntityManagerFactory emf;

    @Activate
    public JpaCaseRepository(/* references */) {
        this.emf = ...;
    }

    @Override
    public Optional<CaseSnapshot> find(CaseId id) {
        // transaction boundary handled externally or locally
    }
}
```

### 5.3 Kenapa entity sebaiknya private

JPA entity adalah persistence detail. Jika entity diexport:

- consumer bisa bergantung pada lazy proxy,
- entity schema change menjadi API change,
- classloader identity makin rawan,
- serialization boundary kacau,
- transaction/lazy loading bisa bocor keluar repository.

Lebih aman:

```text
exported API package:
  CaseSnapshot, CaseDraft, CaseRepository

private persistence package:
  CaseEntity, CaseAuditEntity, JpaCaseMapper
```

DTO/domain snapshot adalah boundary; entity adalah implementation detail.

---

## 6. Transaction di OSGi

### 6.1 Tiga pendekatan transaction

#### Pendekatan A — Local transaction inside repository

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    try {
        // SQL
        c.commit();
    } catch (Exception e) {
        c.rollback();
        throw e;
    }
}
```

Kelebihan:

- explicit,
- mudah dipahami,
- tidak tergantung transaction manager global.

Kekurangan:

- transaction tidak bisa melintasi banyak repository,
- duplikasi boilerplate,
- sulit untuk composition.

Cocok untuk persistence kecil dan isolated.

#### Pendekatan B — Transaction service / Transaction Control

OSGi Transaction Control Service menyediakan model `Scope`, yaitu unit kerja yang bisa berasosiasi dengan transaction dan memastikan scoped resource tersedia selama scope serta dibersihkan saat selesai. Spesifikasi ini juga mendefinisikan resource provider untuk JDBC dan JPA. 

Model konseptual:

```java
transactionControl.required(() -> {
    repositoryA.save(a);
    repositoryB.save(b);
    return result;
});
```

Kelebihan:

- transaction boundary eksplisit,
- cocok dengan service registry,
- resource lifecycle lebih terkontrol,
- mendukung JDBC/JPA provider model.

Kekurangan:

- perlu runtime/service implementation,
- tim harus paham scope semantics,
- integrasi library tidak selalu mulus.

#### Pendekatan C — JTA / XA transaction manager

Digunakan bila perlu koordinasi resource:

- database A,
- database B,
- JMS,
- external XA-capable resource.

Kelebihan:

- distributed transaction support.

Kekurangan:

- kompleks,
- recovery harus benar,
- overhead,
- operationally heavy,
- tidak semua resource benar-benar XA-safe.

Top-tier engineer tidak otomatis memilih XA. Ia bertanya dulu:

```text
Apakah consistency requirement benar-benar butuh atomic commit lintas resource,
atau bisa diselesaikan dengan outbox, saga, idempotency, dan reconciliation?
```

### 6.2 Transaction boundary harus di layer mana?

Pilihan umum:

```text
HTTP Handler -> Application Service -> Repository
```

Biasanya transaction boundary berada di application service:

```java
@Component(service = CaseCommandService.class)
public final class DefaultCaseCommandService implements CaseCommandService {
    private final TransactionControl tx;
    private final CaseRepository cases;
    private final AuditRepository audits;

    @Override
    public SubmitResult submit(SubmitCommand command) {
        return tx.required(() -> {
            CaseSnapshot updated = cases.submit(command);
            audits.recordSubmission(updated.id());
            return SubmitResult.ok(updated.id());
        });
    }
}
```

Kenapa bukan di repository?

Karena satu use case bisa butuh beberapa repository. Jika setiap repository membuka transaction sendiri, atomicity hilang.

Kenapa bukan di HTTP layer?

Karena HTTP layer bukan owner domain consistency. HTTP hanya transport.

### 6.3 Transaction dan dynamic services

Apa yang terjadi jika repository service hilang saat transaction berjalan?

Pada OSGi, service unregistration tidak otomatis membatalkan reference object yang sudah kamu pegang. Tetapi behavior setelah unregister tergantung implementation. Karena itu:

- jangan simpan dynamic service reference sembarangan,
- gunakan DS static mandatory reference untuk critical repository,
- gunakan snapshot service list untuk multiple dynamic plugins,
- jangan memulai long-running transaction yang bergantung pada plugin yang bisa hilang tanpa graceful drain.

Untuk persistence core, biasanya lebih aman:

```text
repository service dependency = static mandatory
```

Artinya component consumer akan deactivate jika repository dependency hilang. Ini lebih aman daripada tetap aktif dengan dependency null.

---

## 7. JPA di OSGi: Managed vs Unmanaged

### 7.1 JPA Service specification

OSGi JPA Service specification mendefinisikan bagaimana persistence unit dipublikasikan di OSGi framework, bagaimana client bundle menemukan persistence unit tersebut, bagaimana driver database ditemukan, dan bagaimana JPA provider tersedia dalam OSGi framework.

Model ideal:

```text
entity bundle contains persistence.xml
JPA provider extender discovers persistence unit
provider publishes EntityManagerFactory service
consumer binds EntityManagerFactory service
```

### 7.2 Managed JPA model

```text
Bundle: case-persistence-unit
  ├── META-INF/persistence.xml
  ├── CaseEntity.class
  └── OSGi metadata

Bundle: jpa-provider
  └── discovers PU and registers EMF service

Bundle: case-repository
  └── @Reference EntityManagerFactory
```

Kelebihan:

- lifecycle lebih OSGi-native,
- persistence unit bisa menjadi runtime service,
- provider discovery lebih eksplisit,
- cocok dengan dynamic runtime.

Kekurangan:

- butuh provider/extender yang benar,
- debugging lebih kompleks,
- library modern belum tentu nyaman di OSGi,
- dokumentasi provider bisa tertinggal.

### 7.3 Unmanaged/manual JPA model

Repository membuat EMF sendiri:

```java
Map<String, Object> props = new HashMap<>();
props.put("jakarta.persistence.jdbc.url", url);
props.put("jakarta.persistence.jdbc.user", user);
props.put("jakarta.persistence.jdbc.password", pass);

EntityManagerFactory emf = Persistence.createEntityManagerFactory("casePU", props);
```

Kelebihan:

- familiar untuk developer JPA,
- tidak tergantung JPA extender,
- lebih mudah dikontrol di satu bundle.

Kekurangan:

- classloader/TCCL harus ditangani,
- provider discovery bisa gagal,
- lifecycle manual,
- integration dengan transaction service lebih manual,
- lebih rawan static cache leak.

### 7.4 Practical rule

Untuk sistem OSGi modern:

```text
Jika persistence sederhana dan tim butuh predictability:
  gunakan JDBC/repository service/Transaction Control.

Jika butuh ORM dan runtime OSGi mendukung provider dengan baik:
  gunakan OSGi JPA Service atau Aries integration.

Jika library/provider modern tidak nyaman di OSGi:
  isolate JPA ke persistence bundle tunggal dan expose repository service.
```

Jangan expose JPA provider ke seluruh sistem.

---

## 8. Entity Classloading Model

### 8.1 Entity harus dimuat oleh siapa?

JPA provider perlu membangun metamodel dari entity classes. Pertanyaannya:

```text
Classloader mana yang mendefinisikan entity class?
```

Idealnya entity dimuat oleh persistence unit bundle atau classloader yang provider tahu sebagai PU classloader.

Jika provider memuat entity dari classloader berbeda dengan consumer, bisa muncul:

```text
ClassCastException: CaseEntity cannot be cast to CaseEntity
```

### 8.2 Entity jangan menjadi API antar bundle

Buruk:

```java
public interface CaseRepository {
    CaseEntity findEntity(UUID id);
}
```

Lebih baik:

```java
public interface CaseRepository {
    CaseSnapshot find(UUID id);
}
```

Kenapa?

`CaseEntity` membawa implicit dependency ke:

- provider proxy,
- lazy loading,
- persistence context,
- lifecycle state,
- transaction boundary,
- annotations,
- schema mapping.

Ini bukan API yang stabil.

### 8.3 DTO mapping boundary

Gunakan mapper internal:

```java
final class CaseEntityMapper {
    CaseSnapshot toSnapshot(CaseEntity e) { ... }
    CaseEntity updateEntity(CaseEntity e, CaseDraft d) { ... }
}
```

Mapper ini private di bundle persistence.

---

## 9. Hibernate di OSGi

Hibernate bisa digunakan di OSGi, tetapi kamu harus sadar bahwa Hibernate historisnya banyak menggunakan:

- service registry internal,
- TCCL,
- reflection,
- bytecode provider,
- proxy factory,
- annotation scanning,
- classpath assumptions.

Dokumentasi Hibernate lama bahkan mencatat caveat OSGi terkait penggunaan classloader khusus dan keterbatasan multiple persistence unit pada versi tertentu. Pada versi modern, situasinya membaik, tetapi prinsip kehati-hatian tetap sama: validasi provider version, dependencies, bytecode library, JAXB/Jakarta dependencies, dan classloader behavior.

### 9.1 Hibernate bundle dependencies

Hibernate biasanya butuh:

- Hibernate core,
- Jakarta Persistence API atau javax persistence API tergantung versi,
- Byte Buddy/Javassist,
- ANTLR,
- JBoss Logging,
- Jakarta Transaction API,
- Jakarta XML Binding pada beberapa skenario,
- JDBC driver,
- connection pool.

Di OSGi, semua itu harus:

- bundle-ready,
- package imports benar,
- version compatible,
- tidak duplicate API package,
- tidak mencampur `javax.persistence` dan `jakarta.persistence` sembarangan.

### 9.2 Hibernate 5 vs 6 dan javax/jakarta

Secara garis besar:

```text
Hibernate 5.x -> umumnya javax.persistence era
Hibernate 6.x -> jakarta.persistence era
```

Jika sistem OSGi kamu masih Java 8 dan `javax.*`, upgrade ke Hibernate 6/Jakarta bukan sekadar dependency bump. Itu migration package namespace.

Risiko:

- bundle A import `javax.persistence.*`,
- bundle B export `jakarta.persistence.*`,
- entity annotation tidak match provider,
- resolver resolve tetapi runtime metadata tidak dikenali.

### 9.3 Hibernate dan lazy proxy

Jangan biarkan lazy proxy keluar dari repository service:

```java
CaseEntity entity = repo.findEntity(id); // buruk jika entity lazy/proxy
```

Consumer bisa mengakses lazy association di luar transaction:

```text
LazyInitializationException
```

Di OSGi, error ini bisa diperparah oleh classloader/proxy mismatch.

Gunakan explicit fetch/mapping:

```java
CaseSnapshot snapshot = repo.findSnapshot(id);
```

### 9.4 Hibernate enhancement/weaving

Jika memakai bytecode enhancement:

- pastikan enhancer berjalan di build-time atau runtime dengan classloader benar,
- pastikan package entity private tetap bisa diakses provider,
- di Java 17+ perhatikan reflective access,
- jangan bergantung pada illegal access lama.

Build-time enhancement lebih predictable daripada runtime weaving dalam OSGi.

---

## 10. EclipseLink di OSGi

EclipseLink memiliki sejarah kuat di lingkungan OSGi/Eclipse karena berasal dari ecosystem Eclipse dan menyediakan JPA provider. EclipseLink JPA adalah persistence solution berbasis standar dengan fitur ORM advanced.

### 10.1 Kelebihan EclipseLink di OSGi

- lebih dekat dengan Eclipse/OSGi heritage,
- weaving support matang,
- cocok untuk beberapa Equinox-based runtime,
- dokumentasi historical OSGi lebih banyak daripada banyak provider lain.

### 10.2 Hal yang tetap harus hati-hati

Walaupun lebih OSGi-friendly, masalah dasar tetap ada:

- entity classloader,
- persistence unit discovery,
- weaving classloader,
- javax/jakarta namespace,
- transaction integration,
- JDBC driver discovery,
- provider version compatibility.

### 10.3 Static weaving vs dynamic weaving

Di OSGi, static weaving sering lebih aman.

```text
build-time weaving
  -> entity bytecode sudah siap
  -> runtime tidak perlu instrumentation kompleks
  -> lebih mudah diuji
```

Dynamic weaving bisa berhasil, tetapi membutuhkan setup runtime yang tepat.

---

## 11. Persistence Unit Design

### 11.1 Satu persistence unit besar vs banyak PU kecil

#### Satu PU besar

```text
case-platform-persistence-unit
  includes all entities
```

Kelebihan:

- relation antar entity mudah,
- query lintas domain mudah,
- setup provider sederhana.

Kekurangan:

- coupling tinggi,
- semua entity lifecycle bersatu,
- sulit modular,
- change kecil bisa memengaruhi semua,
- deployment lebih besar.

#### Banyak PU kecil

```text
case-persistence-unit
appeal-persistence-unit
compliance-persistence-unit
```

Kelebihan:

- modular,
- boundary jelas,
- provider metadata lebih kecil,
- cocok dengan bounded context.

Kekurangan:

- relation lintas PU sulit,
- transaction lintas PU perlu koordinasi,
- query lintas domain butuh read model/reporting pattern.

### 11.2 Rule of thumb

Jika domain masih sangat relational dan satu database schema sangat terikat, jangan memaksa terlalu banyak PU hanya demi “modular”.

Lebih baik:

```text
modular service boundary + internal shared persistence module
```

Daripada:

```text
banyak PU kecil tapi saling join dan saling bocor entity
```

Top-tier design bukan paling modular secara fisik, tetapi boundary yang stabil dan operasional.

---

## 12. Data Ownership dan Bundle Boundary

Pertanyaan penting:

```text
Apakah setiap bundle punya tabel sendiri?
Apakah setiap domain bundle boleh query tabel domain lain?
Apakah join lintas module diperbolehkan?
```

OSGi tidak otomatis memberi data ownership. Kamu harus mendesainnya.

### Model A — Shared database, shared persistence bundle

```text
all tables -> platform-persistence bundle
repositories -> platform-persistence service implementations
```

Kelebihan:

- mudah untuk legacy DB,
- transaction sederhana,
- query lintas module mudah.

Kekurangan:

- persistence module bisa menjadi mini-monolith,
- API harus dijaga kuat.

### Model B — Shared database, per-domain persistence bundle

```text
case tables -> case-persistence
appeal tables -> appeal-persistence
compliance tables -> compliance-persistence
```

Kelebihan:

- boundary domain lebih jelas,
- ownership lebih kuat.

Kekurangan:

- join lintas domain menjadi policy decision,
- migration ordering lebih kompleks,
- transaction lintas repository perlu strategy.

### Model C — Separate database per domain

Lebih mirip microservices, tetapi masih dalam satu JVM.

Kelebihan:

- ownership kuat,
- failure isolation lebih baik.

Kekurangan:

- operational overhead,
- distributed consistency problem muncul walaupun runtime masih satu JVM,
- mungkin overkill.

### Rekomendasi realistis

Untuk OSGi modular monolith enterprise:

```text
Mulai dari shared DB dengan strict repository service boundary.
Jangan expose entity.
Jangan izinkan arbitrary cross-module SQL.
Gunakan read model/reporting module untuk query lintas domain.
```

---

## 13. Migration Tools di OSGi: Flyway dan Liquibase

### 13.1 Masalah migration tool

Flyway/Liquibase biasanya melakukan:

- scan resource migration file,
- load database driver,
- connect datasource,
- run SQL/changelog,
- maintain schema history table.

Di OSGi, pertanyaan penting:

```text
Bundle mana yang memiliki migration resource?
Bundle mana yang menjalankan migration?
Kapan migration dijalankan?
Apakah migration boleh terjadi saat runtime hot deploy?
Apa rollback-nya?
```

### 13.2 Pattern: migration runner bundle

```text
case-migration bundle
  ├── db/migration/V001__init_case.sql
  ├── db/migration/V002__add_case_status.sql
  └── MigrationRunner DS component
```

Runner bind ke DataSource:

```java
@Component(immediate = true)
public final class CaseMigrationRunner {
    @Reference
    DataSource dataSource;

    @Activate
    void activate() {
        Flyway.configure()
            .dataSource(dataSource)
            .locations("classpath:db/migration")
            .load()
            .migrate();
    }
}
```

Namun `classpath:db/migration` di OSGi harus dipastikan melihat resource dari bundle runner, bukan classpath global. Kadang perlu custom classloader/resource accessor.

### 13.3 Jangan migration sembarangan saat hot deploy

Buruk:

```text
bundle update -> migration otomatis jalan -> schema berubah -> bundle lain belum compatible
```

Lebih aman:

```text
deployment plan:
  1. preflight migration compatibility check
  2. backup/snapshot
  3. run forward-compatible migration
  4. deploy compatible bundles
  5. verify
  6. enable new feature
```

### 13.4 Expand-contract migration

Untuk runtime modular, gunakan expand-contract:

```text
Release N:
  add nullable column / add new table / keep old API

Release N+1:
  code writes both old and new if needed

Release N+2:
  code reads new

Release N+3:
  remove old column after no old bundle can run
```

Karena OSGi bisa menjalankan bundle versi berbeda selama transisi, migration harus backward/forward compatible.

---

## 14. Dynamic Runtime dan Database State

OSGi mendukung update bundle saat runtime. Database schema tidak sefleksibel class replacement.

Ini menciptakan mismatch:

```text
bundle can be updated dynamically
schema change is durable and global
```

Maka, jangan menyamakan hot deploy bundle dengan hot deploy schema.

### Invariant penting

```text
Setiap versi bundle persistence yang boleh berjalan harus compatible dengan schema version yang tersedia.
```

Jika tidak, kamu butuh capability requirement:

```text
Require-Capability: com.acme.db.schema; filter:="(&(schema=case)(version>=3.2.0))"
```

Atau service marker:

```java
public interface CaseSchemaVersionService {
    Version currentVersion();
}
```

Persistence component hanya aktif jika schema compatible.

---

## 15. Capability Model untuk Database Schema

OSGi capability bisa digunakan untuk membuat runtime dependency eksplisit.

Contoh konseptual:

```text
Provide-Capability: com.acme.schema; schema=case; version:Version=3.2.0
Require-Capability: com.acme.schema; filter:="(&(schema=case)(version>=3.2.0)(!(version>=4.0.0)))"
```

Artinya bundle repository hanya resolve jika schema capability tersedia.

Dalam praktik, tidak semua tim menggunakan capability untuk schema. Tetapi mental modelnya bagus:

```text
Code version depends on schema version.
Make it explicit.
```

Alternatif yang lebih mudah:

- runtime startup check,
- migration history validation,
- health check fail if incompatible,
- readiness false until schema OK.

---

## 16. Connection Pooling di OSGi

### 16.1 Pool sebagai service

Connection pool bukan sekadar utility. Di OSGi, pool adalah managed resource:

- dibuat saat config valid,
- diexpose sebagai service,
- ditutup saat deactivate,
- diganti saat config berubah,
- dimonitor,
- di-drain saat shutdown.

### 16.2 HikariCP di OSGi

HikariCP bisa digunakan, tetapi perhatikan:

- apakah bundle HikariCP import/export benar,
- driver classloader,
- metrics integration,
- MBean registration,
- shutdown.

Apache Aries Transaction Control local JDBC provider bahkan menyebut dukungan pooling dengan HikariCP pada implementasi provider JDBC lokalnya.

### 16.3 Pool sizing dalam modular runtime

Jika setiap module punya pool sendiri, total connection bisa meledak.

```text
10 bundles x maxPoolSize 20 = 200 DB connections
```

Padahal database mungkin hanya sanggup 80.

Lebih baik:

- shared datasource per database/schema,
- repository service boundary,
- pool count minim,
- per-use-case timeout,
- metrics by service/module via tagging/logging, bukan pool per module.

### 16.4 Operational metrics

Monitor:

- active connections,
- idle connections,
- pending threads,
- acquisition time,
- connection timeout count,
- validation failure,
- leak detection,
- max lifetime churn,
- DB-side sessions.

OSGi-specific metrics:

- datasource service registered/unregistered,
- repository component satisfied/unsatisfied,
- config PID version,
- bundle version providing datasource.

---

## 17. Classloader Problems with JDBC Drivers

### 17.1 DriverManager problem

`DriverManager` historically filters drivers based on caller classloader. Dalam OSGi, caller classloader dan driver classloader bisa berbeda.

Pola aman:

- gunakan `DataSourceFactory` service,
- gunakan provider yang explicitly binds driver,
- hindari `DriverManager.getConnection()` dari sembarang bundle.

Buruk:

```java
Connection c = DriverManager.getConnection(url, user, pass);
```

Lebih baik:

```java
@Reference
DataSource ds;

Connection c = ds.getConnection();
```

### 17.2 TCCL bridge sebagai last resort

Kadang library hanya bekerja jika TCCL di-set ke classloader tertentu.

```java
ClassLoader old = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(getClass().getClassLoader());
    // call legacy library
} finally {
    Thread.currentThread().setContextClassLoader(old);
}
```

Ini boleh sebagai compatibility bridge, tetapi jangan jadikan arsitektur utama. Dokumentasikan jelas.

---

## 18. Transaction Control Service Deep Dive

OSGi Transaction Control Service menyediakan cara menjalankan work dalam `Scope`. Scope bisa transactional atau non-transactional. Scoped resource tetap tersedia sepanjang scope dan dibersihkan ketika scope selesai.

### 18.1 Conceptual API

```java
T result = txControl.required(() -> {
    // transactional work
    return value;
});
```

Variasi umum:

```text
required      -> join existing transaction or create new
requiresNew   -> suspend existing and create new
notSupported  -> run outside transaction
supports      -> join if exists
```

Nama tepat tergantung API/implementation, tetapi mental modelnya mirip transaction propagation.

### 18.2 Scoped resource

Resource provider memberi resource yang aware terhadap transaction scope:

```java
@Reference
JDBCConnectionProvider provider;

Connection conn = provider.getResource(txControl);
```

Kamu tidak manually close setiap connection dengan cara biasa; resource lifecycle terikat scope.

### 18.3 Why this fits OSGi

Karena OSGi service registry dynamic, resource provider sebagai service lebih natural daripada static global transaction manager.

```text
TransactionControl service
JDBC resource provider service
JPA resource provider service
Repository service
```

Semua dependency bisa dikelola DS.

### 18.4 Failure modes

- TransactionControl service missing -> component unsatisfied.
- JDBC provider missing -> repository unsatisfied.
- Resource provider config invalid -> service tidak register.
- Exception dalam scope -> rollback.
- Asynchronous work keluar dari scope -> resource invalid.

Jangan melakukan ini:

```java
tx.required(() -> {
    executor.submit(() -> repository.save(x)); // likely outside intended scope
    return null;
});
```

Transaction scope biasanya thread-bound. Async work butuh desain eksplisit.

---

## 19. JPA Transaction Boundary

### 19.1 EntityManager lifecycle

`EntityManagerFactory` biasanya thread-safe. `EntityManager` tidak thread-safe.

OSGi service yang diexpose sebaiknya bukan singleton `EntityManager`.

Buruk:

```java
@Component(service = EntityManager.class)
public class SharedEntityManagerProvider { ... }
```

Lebih baik:

```text
EntityManagerFactory service
or
Repository service hides EntityManager lifecycle
```

### 19.2 One EntityManager per transaction/scope

Mental model:

```text
transaction scope
  -> EntityManager opened
  -> repository operations use same EM
  -> flush/commit
  -> EM closed
```

### 19.3 Lazy loading boundary

Jangan return object yang butuh EntityManager aktif.

Buruk:

```java
return caseEntity; // lazy associations not initialized
```

Baik:

```java
return mapper.toSnapshot(caseEntity); // fully initialized DTO
```

### 19.4 Query service vs command repository

Untuk complex read, kadang lebih baik buat query service berbasis SQL/JDBC daripada memaksakan JPA graph.

```java
public interface CaseListingQuery {
    Page<CaseListingRow> search(CaseListingCriteria criteria);
}
```

Ini menghindari:

- N+1 query,
- lazy loading leak,
- entity graph terlalu besar,
- cross-module entity dependency.

---

## 20. Exception Boundary

Jangan leak provider exception ke API bundle.

Buruk:

```java
throws PersistenceException
throws HibernateException
throws SQLException
```

Lebih baik:

```java
public sealed class RepositoryException extends RuntimeException permits
    DuplicateRecordException,
    OptimisticConflictException,
    RepositoryUnavailableException,
    RepositoryIntegrityException {
}
```

Untuk Java 8, sealed class belum ada. Gunakan class hierarchy biasa.

Mapping:

```text
SQLIntegrityConstraintViolationException -> Duplicate/Integrity exception
OptimisticLockException -> OptimisticConflictException
SQLTransientConnectionException -> RepositoryUnavailableException
QueryTimeoutException -> RepositoryTimeoutException
```

Boundary ini membuat consumer tidak tergantung provider.

---

## 21. Optimistic Locking dan Dynamic Runtime

JPA optimistic locking biasanya menggunakan `@Version`.

Dalam OSGi modular runtime, optimistic locking juga menjadi contract antar bundle:

```java
public record CaseDraft(
    CaseId id,
    long expectedVersion,
    String newStatus
) {}
```

Repository harus expose conflict secara domain-level:

```java
throw new OptimisticConflictException(id, expectedVersion, actualVersion);
```

Jangan expose `OptimisticLockException` langsung.

### Why important

Jika bundle UI/API/service berbeda versi, contract conflict handling harus tetap stabil.

---

## 22. Multi-Tenancy dan Multi-DataSource

OSGi sering dipakai untuk platform multi-tenant/plugin. Persistence multi-tenancy bisa dilakukan dengan:

1. schema per tenant,
2. database per tenant,
3. discriminator column,
4. separate persistence service per tenant,
5. dynamic DataSource service per tenant.

### 22.1 Service property routing

```java
@Component(service = DataSource.class, property = {
    "tenant=agency-a",
    "db.role=case"
})
```

Consumer:

```java
@Reference(target = "(&(tenant=agency-a)(db.role=case))")
DataSource ds;
```

Untuk dynamic tenant, jangan hardcode annotation target. Gunakan service lookup/router.

### 22.2 Tenant-aware repository

```java
public interface TenantCaseRepository {
    Optional<CaseSnapshot> find(TenantId tenant, CaseId id);
}
```

Internal router memilih datasource.

### 22.3 Failure model

Jika tenant A datasource down, tenant B tidak boleh ikut down jika isolation requirement kuat.

Ini berarti:

- pool per tenant mungkin diperlukan,
- tetapi total connection harus dikontrol,
- health check per tenant,
- circuit breaker per tenant,
- config lifecycle per tenant.

---

## 23. Persistence dan Service Dynamics

Persistence service biasanya core. Tidak semua dependency cocok dibuat dynamic.

### 23.1 Static mandatory references

Untuk core database:

```java
@Reference(policy = ReferencePolicy.STATIC)
DataSource dataSource;
```

Jika DataSource hilang, component deactivate. Ini lebih aman.

### 23.2 Dynamic references

Cocok untuk optional extension:

- audit enrichers,
- query filters,
- validation plugins,
- schema health contributors,
- migration observers.

Tidak cocok untuk:

- required repository dependency,
- transaction manager utama,
- entity manager factory utama.

### 23.3 Stale resource risk

Jika config update mengganti DataSource, repository yang menyimpan reference lama bisa memakai pool tertutup.

Gunakan:

- DS static reactivation,
- atomic delegate dengan drain,
- service unregister/register semantics yang jelas.

---

## 24. OSGi Persistence Topology Patterns

### Pattern 1 — Simple JDBC Repository

```text
DataSource service -> JDBC repository service -> application service
```

Cocok untuk:

- high control,
- SQL-heavy system,
- minimal ORM magic,
- regulated systems yang butuh query predictability.

### Pattern 2 — JPA Hidden Behind Repository

```text
JPA provider + EMF -> repository service -> application service
```

Cocok untuk:

- rich domain mapping,
- known provider compatibility,
- team paham ORM pitfalls.

### Pattern 3 — Read SQL + Write JPA

```text
Command repository -> JPA
Query service -> JDBC/native SQL/read model
```

Cocok untuk:

- complex listing/reporting,
- avoid ORM query explosion,
- CQRS-lite.

### Pattern 4 — Persistence Facade Bundle

```text
all DB details in one persistence facade bundle
other bundles consume only service API
```

Cocok untuk:

- legacy database,
- migration from monolith,
- controlled modularization.

### Pattern 5 — Plugin Persistence Extension

Plugin provides repository extension, not raw DB access.

```text
Plugin -> registers CaseAttributeProvider
Core persistence -> owns database tables
```

Cocok untuk:

- safe plugin model,
- regulated runtime,
- avoiding arbitrary SQL by plugin.

---

## 25. Persistence Plugin Design

Jika OSGi digunakan sebagai plugin platform, jangan langsung beri plugin `DataSource`.

Buruk:

```text
plugin gets DataSource -> plugin can query/update anything
```

Lebih aman:

```text
plugin gets constrained service API
```

Contoh:

```java
public interface CaseExtensionStore {
    Optional<JsonObject> readExtensionData(CaseId id, PluginId pluginId);
    void writeExtensionData(CaseId id, PluginId pluginId, JsonObject data);
}
```

Core persistence tetap enforce:

- tenant boundary,
- plugin ownership,
- audit trail,
- schema validation,
- transaction policy,
- rate/size limit.

### Plugin-owned tables?

Hanya jika platform punya governance:

- migration registration,
- schema namespace,
- permissions,
- backup/restore policy,
- compatibility checks,
- uninstall policy,
- data retention.

Tanpa itu, plugin-owned tables menjadi operational liability.

---

## 26. Java 8 sampai 25 Compatibility

### 26.1 Java 8

Karakteristik:

- `javax.persistence`, `javax.transaction` umum,
- Java EE APIs kadang masih diasumsikan tersedia/umum,
- weaker encapsulation,
- banyak library lama masih support.

Risiko:

- library kuno membawa dependency lama,
- migration ke Java 11+ butuh mengganti removed Java EE modules.

### 26.2 Java 9 sampai 11

Perubahan penting:

- JPMS hadir,
- Java EE/CORBA modules deprecated/removed di Java 11,
- stronger encapsulation mulai terasa,
- classpath masih bisa, tetapi illegal access warning muncul.

OSGi di Java 9+ biasanya tetap berjalan sebagai framework di classpath/module environment, tetapi reflective library perlu diperiksa.

### 26.3 Java 17

Karakteristik:

- strong encapsulation lebih ketat,
- banyak illegal reflective access menjadi error kecuali diberi `--add-opens`,
- Jakarta ecosystem makin dominan.

Persistence impact:

- Hibernate/Byte Buddy/ASM version harus modern,
- EclipseLink weaving harus kompatibel,
- proxy generation harus diuji,
- jangan pakai internal JDK API.

### 26.4 Java 21

Karakteristik:

- virtual threads final,
- structured concurrency preview/incubator era,
- modern GC/runtime.

Persistence impact:

- JDBC blocking bisa berjalan di virtual thread, tetapi connection pool tetap bottleneck,
- jangan menyamakan virtual thread dengan infinite DB concurrency,
- transaction context ThreadLocal harus diuji dengan virtual thread usage.

### 26.5 Java 25

Java 25 adalah release modern setelah Java 21; untuk OSGi persistence, fokus compatibility tetap:

- bytecode target,
- reflective access,
- provider support,
- JDBC driver support,
- Jakarta API version,
- build tool compatibility,
- framework compatibility.

### 26.6 Multi-release JAR dan OSGi

Jika dependency persistence adalah multi-release JAR, pastikan:

- OSGi tooling memahami metadata,
- package imports tetap benar,
- runtime JDK memilih class version sesuai,
- baseline compatibility tidak tertipu oleh class version berbeda.

---

## 27. javax vs jakarta di OSGi Persistence

Ini salah satu migration paling berisiko.

### 27.1 Package namespace berbeda adalah API berbeda

```text
javax.persistence.Entity
jakarta.persistence.Entity
```

Walaupun konsep sama, package berbeda berarti type berbeda.

Bundle dengan entity annotated `javax.persistence.Entity` tidak otomatis compatible dengan provider yang mencari `jakarta.persistence.Entity`.

### 27.2 Jangan campur dalam satu persistence unit

Buruk:

```text
Entity A -> javax.persistence
Entity B -> jakarta.persistence
Provider -> Hibernate 6 jakarta
```

Ini hampir pasti bermasalah.

### 27.3 Migration strategy

1. Inventory semua bundle yang import `javax.persistence`, `javax.transaction`, `javax.validation`.
2. Tentukan target stack:
   - stay javax untuk Java 8/11 legacy,
   - migrate jakarta untuk Java 17/21/25.
3. Buat branch compatibility.
4. Update provider dan bytecode dependencies.
5. Update imports/export package metadata.
6. Run resolver tests.
7. Run persistence integration tests.
8. Validate runtime weaving/proxy.
9. Deploy dengan schema-compatible release.

---

## 28. Testing Persistence di OSGi

### 28.1 Test layers

```text
unit test mapper
repository contract test
in-framework DS test
database integration test
resolver test
migration test
runtime restart test
bundle update test
```

### 28.2 Repository contract test

Test API behavior, bukan provider detail:

```java
interface CaseRepositoryContract {
    CaseRepository repository();

    @Test
    default void saveAndFindCase() {
        CaseDraft draft = ...;
        SaveResult saved = repository().save(draft);
        assertThat(repository().find(saved.id())).isPresent();
    }
}
```

Implementasi test bisa dijalankan untuk JDBC dan JPA provider.

### 28.3 In-framework test

Test harus memastikan:

- bundle resolve,
- DS component satisfied,
- DataSource service registered,
- repository service registered,
- transaction service available,
- persistence operation berhasil.

### 28.4 Failure injection

Test penting:

- DataSource config invalid,
- DB down,
- migration missing,
- duplicate migration,
- provider bundle stopped,
- repository bundle refreshed,
- old service reference not used,
- transaction rollback,
- optimistic conflict,
- connection timeout.

### 28.5 Testcontainers

Testcontainers bisa digunakan untuk DB integration test, tetapi runtime OSGi tetap harus in-framework. Jangan puas hanya dengan unit test JPA di classpath biasa.

---

## 29. Observability Persistence di OSGi

### 29.1 Health checks

Health check harus membedakan:

```text
bundle active?               yes/no
DS component satisfied?      yes/no
DataSource service present?  yes/no
DB reachable?                yes/no
schema compatible?           yes/no
migration pending?           yes/no
pool saturated?              yes/no
transaction service present? yes/no
```

Jangan hanya cek “bundle ACTIVE”. Bundle ACTIVE tidak berarti repository usable.

### 29.2 Metrics

Minimal metrics:

- repository latency by operation,
- DB connection acquisition time,
- active/idle/pending pool,
- query timeout count,
- transaction rollback count,
- optimistic conflict count,
- deadlock count,
- migration duration,
- schema version,
- DS unsatisfied count,
- service registration lifecycle.

### 29.3 Logs

Log harus menyertakan:

- bundle symbolic name,
- bundle version,
- service PID/config PID,
- datasource id,
- schema version,
- correlation id,
- transaction id/logical unit id,
- SQL state/error code untuk DB failure.

Jangan log:

- password,
- token,
- PII payload,
- full SQL bind values jika sensitif.

---

## 30. Troubleshooting Playbook

### 30.1 `No suitable driver found`

Cek:

1. Driver bundle installed?
2. Driver bundle resolved/active?
3. Driver package imported correctly?
4. `DataSourceFactory` service registered?
5. Consumer target filter benar?
6. URL prefix cocok?
7. TCCL issue?
8. Driver version compatible dengan Java runtime?

Fix:

- gunakan DataSourceFactory service,
- hindari DriverManager langsung,
- pastikan driver bundle metadata benar,
- add resolver test.

### 30.2 Entity not found

Cek:

1. Entity ada di bundle mana?
2. Entity package visible ke provider?
3. persistence.xml include class?
4. Annotation namespace `javax` vs `jakarta` cocok?
5. TCCL benar?
6. Provider extender menemukan PU?
7. Bundle resource path benar?

Fix:

- explicitly list entity classes,
- gunakan OSGi JPA extender yang benar,
- isolate entity private tapi accessible via PU,
- jangan rely on global classpath scanning.

### 30.3 LazyInitializationException

Cek:

1. Entity keluar repository?
2. Lazy association diakses di luar transaction?
3. DTO mapping incomplete?
4. Transaction scope terlalu sempit?

Fix:

- return DTO/snapshot,
- define fetch plan,
- query projection,
- transaction boundary di application service.

### 30.4 ClassCastException same class name

Cek:

1. Duplicate package export?
2. Entity/API package embedded di beberapa bundle?
3. Consumer import dari provider berbeda?
4. `uses:=` violation?
5. Old classloader leaked after refresh?

Fix:

- single exporter for API package,
- do not embed exported API in implementation bundle,
- use bnd baseline/resolver,
- refresh cleanly,
- inspect wiring.

### 30.5 Component unsatisfied

Cek SCR:

- missing DataSource,
- missing TransactionControl,
- target filter mismatch,
- config PID missing,
- provider bundle not active,
- version range mismatch.

Fix:

- inspect component references,
- inspect service properties,
- validate config,
- add health diagnostics.

### 30.6 Memory leak after bundle update

Cek:

- EMF closed on deactivate?
- connection pool closed?
- provider static cache cleared?
- thread pools stopped?
- JDBC driver deregistered?
- MBeans unregistered?
- ThreadLocal cleared?
- old entity class referenced in cache?

Fix:

- strict deactivate cleanup,
- avoid static caches,
- close EMF/pool,
- unregister services,
- test update/refresh repeatedly.

---

## 31. Anti-Patterns

### 31.1 Exporting entity packages

```text
Export-Package: com.acme.case.persistence.entity
```

Ini biasanya buruk. Entity menjadi API tidak sengaja.

### 31.2 Giving every bundle direct DataSource

Membuat semua module bisa query semua tabel.

Akibat:

- data ownership hilang,
- audit sulit,
- query coupling,
- security boundary lemah.

### 31.3 DriverManager everywhere

OSGi-friendly code sebaiknya menggunakan DataSource/DataSourceFactory service.

### 31.4 One pool per tiny bundle

Connection explosion.

### 31.5 Running migration on every activation without guard

Bundle restart bisa trigger migration ulang atau conflict.

### 31.6 Returning lazy entity outside transaction

Membocorkan persistence context.

### 31.7 Mixing javax and jakarta accidentally

Resolve-time mungkin tidak selalu menangkap semantic mismatch annotation/provider.

### 31.8 Using DynamicImport-Package to “fix” persistence

Ini menutupi desain classloading buruk.

### 31.9 Hiding all provider exceptions

Mapping exception bagus. Menelan root cause buruk.

### 31.10 No integration test inside OSGi framework

Classpath unit test tidak membuktikan OSGi runtime akan jalan.

---

## 32. Design Review Checklist

### 32.1 Bundle boundary

- Apakah API repository berada di bundle terpisah?
- Apakah entity package private?
- Apakah provider-specific package tidak bocor ke consumer?
- Apakah package versioning diterapkan?

### 32.2 DataSource

- Siapa owner DataSource?
- Apakah pool lifecycle dikelola DS?
- Apakah config update aman?
- Apakah old pool drain sebelum close?
- Apakah credential tidak disimpan plaintext?

### 32.3 Transaction

- Layer mana yang membuka transaction?
- Apakah transaction melintasi beberapa repository?
- Apakah async work keluar dari transaction?
- Apakah rollback semantics jelas?
- Apakah exception mapping benar?

### 32.4 JPA

- Provider compatible dengan Java target?
- `javax`/`jakarta` konsisten?
- Entity scanning reliable di OSGi?
- EMF ditutup saat deactivate?
- Lazy proxy tidak keluar service boundary?
- Enhancement/weaving diuji?

### 32.5 Migration

- Migration dijalankan kapan?
- Apakah schema change forward-compatible?
- Apakah rollback plan ada?
- Apakah schema version divalidasi?
- Apakah hot deploy tidak otomatis merusak schema?

### 32.6 Operations

- Health check membedakan bundle/service/db/schema?
- Metrics pool dan repository ada?
- Logs punya bundle version dan correlation id?
- Update/refresh tested?
- Memory leak tested?

---

## 33. Example Architecture: Enforcement Case Persistence

Misal sistem regulatory enforcement memiliki modul:

- case,
- appeal,
- compliance,
- correspondence,
- audit,
- workflow.

Desain OSGi persistence yang sehat:

```text
com.acme.persistence.datasource
  -> registers DataSource service for core DB

com.acme.transaction
  -> registers TransactionControl service

com.acme.case.repository.api
  -> exports CaseRepository, DTOs, exceptions

com.acme.case.persistence.jpa
  -> private entity package
  -> imports repository API
  -> references DataSource/TransactionControl
  -> registers CaseRepository

com.acme.audit.repository.api
  -> exports AuditRepository

com.acme.audit.persistence.jdbc
  -> registers AuditRepository

com.acme.case.application
  -> references CaseRepository + AuditRepository + TransactionControl
  -> owns command transaction boundary
```

Submit use case:

```text
HTTP submit request
  -> CaseCommandService.submit()
      -> tx.required
          -> CaseRepository.updateStatus()
          -> AuditRepository.record()
          -> WorkflowService.emitTransition()
      -> response
```

Boundary:

- HTTP tidak tahu JPA.
- Case application tidak tahu entity.
- Repository API tidak expose provider.
- Persistence implementation bisa diganti.
- Audit bisa JDBC walaupun Case memakai JPA.
- Transaction boundary tetap di application service.

---

## 34. Decision Matrix

| Situasi | Pilihan yang Lebih Baik | Alasan |
|---|---|---|
| Query SQL kompleks, reporting-heavy | JDBC/query service | Lebih predictable daripada ORM graph besar |
| Rich aggregate sederhana | JPA behind repository | Produktif, asal entity tidak bocor |
| Banyak dynamic plugin | Constrained persistence service | Jangan beri DataSource mentah ke plugin |
| Legacy DB besar | Persistence facade bundle | Boundary bertahap tanpa over-modularisasi |
| Need atomic multi-repository command | Transaction boundary di application service | Konsistensi use-case |
| Need DB + broker atomicity | Evaluasi XA vs outbox | XA bukan default |
| Java 8 legacy | javax stack | Hindari migration namespace prematur |
| Java 17/21/25 modern | jakarta stack + modern provider | Lebih future-proof |
| Runtime hot deploy | Forward-compatible schema migration | Schema durable, bundle dynamic |
| Provider classloading sulit | Isolate provider in one persistence bundle | Kurangi blast radius |

---

## 35. Practical Build Guidance dengan bnd

### 35.1 API bundle

`bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.case.repository.api
Export-Package: \
  com.acme.case.repository.api;version=1.4.0
```

### 35.2 Persistence implementation bundle

```properties
Bundle-SymbolicName: com.acme.case.persistence.jpa
Private-Package: \
  com.acme.case.persistence.jpa.*
Import-Package: \
  com.acme.case.repository.api;version="[1.4,2)",\
  javax.sql,\
  jakarta.persistence;version="[3.1,4)",\
  *
```

Untuk Java 8/javax stack:

```properties
Import-Package: \
  javax.persistence;version="[2.2,3)",\
  javax.transaction;version="[1.2,2)",\
  *
```

Jangan campur keduanya kecuali kamu memang membangun compatibility bridge yang sangat eksplisit.

### 35.3 DS annotations

Pastikan build menghasilkan:

```text
OSGI-INF/*.xml
Service-Component: OSGI-INF/...
```

Jangan tulis DS XML manual kecuali ada alasan kuat.

---

## 36. Production Readiness Runbook

Sebelum release persistence bundle:

1. Resolver test pass.
2. Baseline check pass.
3. In-framework integration test pass.
4. Migration dry run pass.
5. Schema compatibility check pass.
6. DataSource health check pass.
7. Pool metrics visible.
8. Repository latency metrics visible.
9. Bundle update/refresh test pass.
10. EMF/pool cleanup verified.
11. DB credential rotation tested.
12. Rollback plan documented.
13. Java target compatibility tested.
14. `javax`/`jakarta` namespace verified.
15. No entity package exported unintentionally.
16. No provider-specific exception leaks from API.
17. No `DynamicImport-Package` used as persistence workaround.
18. Startup order and start-level behavior verified.
19. Readiness fails if schema incompatible.
20. Operational dashboard updated.

---

## 37. Core Takeaways

Persistence di OSGi sulit bukan karena JDBC/JPA-nya berbeda, tetapi karena runtime-nya lebih jujur tentang dependency, lifecycle, class visibility, dan service availability.

Mental model yang perlu dipegang:

```text
Persistence is not a library dependency.
Persistence is a runtime resource graph.
```

Resource graph itu berisi:

- driver,
- datasource,
- pool,
- transaction scope,
- entity metadata,
- provider,
- repository service,
- schema version,
- config,
- health,
- lifecycle cleanup.

Engineer biasa bertanya:

```text
Bagaimana cara membuat Hibernate jalan di OSGi?
```

Engineer top-tier bertanya:

```text
Boundary mana yang boleh melihat entity?
Siapa owner transaction?
Bagaimana schema version dipastikan compatible dengan bundle version?
Apa yang terjadi saat DataSource hilang, config berubah, bundle refresh, atau provider upgrade?
Bagaimana membuktikan runtime wiring, bukan hanya compile, benar?
```

Jika kamu bisa menjawab pertanyaan kedua secara sistematis, kamu sudah berada pada level OSGi persistence engineering yang jauh lebih matang.

---

## 38. Referensi Utama

- OSGi Compendium Release 8 — Transaction Control Service, JDBC Resource Provider, JPA Resource Provider.
- OSGi Compendium Release 7/8 — JPA Service Specification.
- OSGi Core Release 8 — Service Layer, lifecycle, classloading, resolver.
- Apache Aries Transaction Control documentation.
- Hibernate ORM documentation — OSGi chapter and provider caveats.
- EclipseLink documentation — JPA provider, OSGi-related historical docs.
- bnd/Bndtools documentation — bundle metadata, resolver, baseline, runtime assembly.
- Apache Felix and Equinox documentation — runtime diagnostics and framework behavior.

---

## 39. Status Series

```text
Part 16 dari 35 selesai.
Series belum selesai.
```

Part berikutnya:

```text
17-messaging-events-async-runtime-event-admin-push-streams-reactive-bridges.md
```
