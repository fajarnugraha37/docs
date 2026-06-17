# Part 2 — Persistence Unit, Bootstrap, Metadata, and Provider Initialization

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `02-persistence-unit-bootstrap-metadata-provider-initialization.md`  
> Target: Java 8 hingga Java 25, `javax.persistence` hingga `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membedakan antara **JPA/Jakarta Persistence specification** dan **provider reality**. Sekarang kita masuk ke titik pertama di mana perbedaan itu benar-benar terasa: **bootstrap**.

Banyak developer memakai ORM dari level Spring Boot atau Jakarta EE container, lalu melihat `EntityManager` seolah-olah langsung tersedia begitu saja. Padahal sebelum satu query pun dijalankan, provider harus melakukan banyak pekerjaan:

1. Menemukan persistence unit.
2. Membaca konfigurasi.
3. Menentukan provider.
4. Menemukan entity class.
5. Membaca annotation/XML mapping.
6. Membangun metadata model.
7. Menghubungkan metadata ke database dialect.
8. Menyiapkan SQL generation pipeline.
9. Menyiapkan cache, listener, converter, validator, enhancement/weaving.
10. Membangun runtime factory: `EntityManagerFactory`, Hibernate `SessionFactory`, atau EclipseLink session infrastructure.

Part ini penting karena banyak masalah production muncul bukan saat query ditulis, tetapi karena **runtime ORM dibangun dengan asumsi yang salah sejak startup**.

Contoh:

- entity tidak terdeteksi karena package scanning salah;
- `javax.persistence` dan `jakarta.persistence` tercampur;
- dialect salah sehingga pagination/sequence/locking SQL salah;
- bytecode enhancement tidak aktif sehingga lazy field/dirty tracking tidak bekerja;
- converter terdaftar global dan mengubah binding query secara tidak terduga;
- persistence unit berbeda antara test dan production;
- Spring Boot auto-configuration membuat setting berbeda dari yang diasumsikan developer;
- Java module path membuat provider tidak bisa melihat entity;
- EclipseLink weaving gagal karena classloader/agent tidak sesuai;
- Hibernate metadata build gagal karena association, generator, atau type mapping tidak valid.

Tujuan part ini: membuat kamu memahami ORM startup sebagai **compiler pipeline** dari domain class menjadi runtime persistence engine.

---

## 1. Mental Model: Bootstrap adalah Compilation Phase ORM

Cara paling berguna memandang bootstrap ORM:

```text
Java classes + annotations/XML + provider properties + database dialect
                         |
                         v
              Provider metadata model
                         |
                         v
        Runtime persistence engine / factory
                         |
                         v
 EntityManager / Session / UnitOfWork / SQL execution runtime
```

ORM tidak membaca annotation dari nol setiap kali `persist()` atau `find()` dipanggil. Provider melakukan pekerjaan berat di awal:

- entity apa saja yang dikenal;
- nama entity dan tabel;
- field/property mana yang persistent;
- mana identifier;
- mana version field;
- association mana owning side;
- fetch default;
- cascade rule;
- converter;
- listener;
- inheritance strategy;
- collection semantics;
- SQL type mapping;
- id generation strategy;
- caching rule;
- locking rule;
- DDL validation/generation rule.

Setelah itu provider membuat object besar yang relatif mahal dan long-lived:

- JPA: `EntityManagerFactory`
- Hibernate: `SessionFactory`
- EclipseLink: `ServerSession`/session infrastructure behind `EntityManagerFactory`

Factory ini adalah hasil kompilasi metadata.

### 1.1 Invariant Penting

**Invariant 1 — `EntityManagerFactory` adalah expensive, thread-safe, dan long-lived.**

Biasanya dibuat satu kali per persistence unit per aplikasi. Membuat factory per request adalah desain fatal.

**Invariant 2 — `EntityManager` bukan long-lived global object.**

`EntityManager` merepresentasikan persistence context. Ia bukan global singleton untuk semua request.

**Invariant 3 — Bootstrap menentukan dunia yang dikenal provider.**

Entity yang tidak masuk metadata model dianggap tidak ada, walaupun class-nya ada di classpath.

**Invariant 4 — Provider behavior dimulai dari metadata, bukan dari annotation mentah.**

Annotation hanya input. Yang dipakai saat runtime adalah metadata internal provider.

**Invariant 5 — Environment integration mengubah bootstrap.**

Java SE manual bootstrap, Jakarta EE container bootstrap, Spring Boot auto-bootstrap, Quarkus build-time bootstrap, dan native image bootstrap memiliki konsekuensi berbeda.

---

## 2. Vocabulary yang Harus Jelas

### 2.1 Persistence Unit

Persistence unit adalah konfigurasi logis yang menyatakan:

- nama unit;
- provider;
- transaction type;
- datasource atau JDBC properties;
- entity classes;
- mapping files;
- shared cache mode;
- validation mode;
- provider-specific properties.

Dalam model klasik, persistence unit dideklarasikan di:

```text
META-INF/persistence.xml
```

Satu aplikasi bisa punya lebih dari satu persistence unit.

Contoh:

```text
application
 ├── persistence unit: operational-db
 │   ├── CaseEntity
 │   ├── TaskEntity
 │   └── AuditTrailEntity
 │
 └── persistence unit: reporting-db
     ├── CaseSummaryReadModel
     └── WorkloadProjection
```

### 2.2 Persistence Provider

Provider adalah implementasi dari specification:

- Hibernate ORM;
- EclipseLink;
- OpenJPA;
- DataNucleus;
- provider lain.

Dalam praktik enterprise Java modern, dua provider yang paling relevan untuk seri ini:

- Hibernate ORM;
- EclipseLink.

### 2.3 EntityManagerFactory

`EntityManagerFactory` adalah factory untuk membuat `EntityManager`.

Ia menyimpan metadata dan integrasi runtime.

Di Hibernate, `EntityManagerFactory` biasanya membungkus atau berhubungan sangat dekat dengan `SessionFactory`.

Di EclipseLink, `EntityManagerFactory` berada di atas session infrastructure milik EclipseLink.

### 2.4 EntityManager

`EntityManager` adalah API utama JPA/Jakarta Persistence untuk:

- persist;
- find;
- remove;
- merge;
- create query;
- flush;
- clear;
- detach;
- lock;
- refresh.

Yang lebih penting: `EntityManager` memiliki persistence context.

### 2.5 Metadata

Metadata adalah model internal provider tentang domain persistence kamu.

Contoh metadata:

```text
Entity: CaseFile
Table: CASE_FILE
Identifier: ID, sequence CASE_FILE_SEQ
Version: VERSION
Columns:
  STATUS -> VARCHAR2(30)
  CREATED_AT -> TIMESTAMP
Associations:
  assignedOfficer -> many-to-one OFFICER_ID
  tasks -> one-to-many mappedBy=caseFile
Fetch:
  assignedOfficer: LAZY
  tasks: LAZY
Cascades:
  tasks: PERSIST, MERGE
Listeners:
  AuditListener
Converters:
  StatusConverter
```

Provider tidak hanya menyimpan metadata ini sebagai data pasif. Metadata menjadi dasar:

- SQL generation;
- dirty checking;
- flush ordering;
- cascade traversal;
- optimistic locking;
- second-level cache keying;
- proxy generation;
- result set hydration;
- DDL validation.

---

## 3. Java SE Bootstrap: Manual dan Explicit

Pada Java SE tanpa container, kamu biasanya membuat `EntityManagerFactory` dengan:

```java
EntityManagerFactory emf = Persistence.createEntityManagerFactory("mainPU");
```

Dengan properties override:

```java
Map<String, Object> props = new HashMap<>();
props.put("jakarta.persistence.jdbc.url", "jdbc:postgresql://localhost:5432/app");
props.put("jakarta.persistence.jdbc.user", "app");
props.put("jakarta.persistence.jdbc.password", "secret");

EntityManagerFactory emf = Persistence.createEntityManagerFactory("mainPU", props);
```

Java 8 / JPA 2.x variant memakai namespace:

```java
props.put("javax.persistence.jdbc.url", "jdbc:postgresql://localhost:5432/app");
```

Modern Jakarta variant memakai:

```java
props.put("jakarta.persistence.jdbc.url", "jdbc:postgresql://localhost:5432/app");
```

### 3.1 Apa yang Terjadi Saat `createEntityManagerFactory()`?

Secara mental:

```text
Persistence.createEntityManagerFactory("mainPU")
    |
    |-- locate META-INF/persistence.xml
    |-- parse persistence units
    |-- choose unit named mainPU
    |-- resolve provider
    |-- call provider bootstrap API
    |-- provider reads managed classes/mapping files/properties
    |-- provider builds metadata
    |-- provider initializes integration services
    |-- provider returns EntityManagerFactory
```

### 3.2 Provider Discovery

JPA provider ditemukan melalui service discovery mechanism, umumnya file:

```text
META-INF/services/jakarta.persistence.spi.PersistenceProvider
```

atau untuk legacy:

```text
META-INF/services/javax.persistence.spi.PersistenceProvider
```

File ini menunjuk ke implementation class provider.

Contoh konsep:

```text
org.hibernate.jpa.HibernatePersistenceProvider
```

atau:

```text
org.eclipse.persistence.jpa.PersistenceProvider
```

Kalau ada banyak provider di classpath dan `persistence.xml` tidak eksplisit menyebut provider, hasilnya bisa membingungkan.

**Rule:** untuk aplikasi enterprise serius, deklarasikan provider secara eksplisit kecuali framework/container memang mengelola pilihan provider dengan jelas.

---

## 4. `persistence.xml`: Konfigurasi Kecil yang Menentukan Runtime Besar

Contoh modern Jakarta Persistence:

```xml
<persistence xmlns="https://jakarta.ee/xml/ns/persistence"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xsi:schemaLocation="https://jakarta.ee/xml/ns/persistence
                                 https://jakarta.ee/xml/ns/persistence/persistence_3_2.xsd"
             version="3.2">

    <persistence-unit name="mainPU" transaction-type="RESOURCE_LOCAL">
        <provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>

        <class>com.example.caseapp.domain.CaseFile</class>
        <class>com.example.caseapp.domain.CaseTask</class>
        <class>com.example.caseapp.domain.Officer</class>

        <properties>
            <property name="jakarta.persistence.jdbc.driver" value="org.postgresql.Driver"/>
            <property name="jakarta.persistence.jdbc.url" value="jdbc:postgresql://localhost:5432/caseapp"/>
            <property name="jakarta.persistence.jdbc.user" value="caseapp"/>
            <property name="jakarta.persistence.jdbc.password" value="secret"/>

            <property name="hibernate.dialect" value="org.hibernate.dialect.PostgreSQLDialect"/>
            <property name="hibernate.hbm2ddl.auto" value="validate"/>
        </properties>
    </persistence-unit>
</persistence>
```

Legacy Java 8 / JPA 2.2 shape:

```xml
<persistence xmlns="http://xmlns.jcp.org/xml/ns/persistence"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xsi:schemaLocation="http://xmlns.jcp.org/xml/ns/persistence
                                 http://xmlns.jcp.org/xml/ns/persistence/persistence_2_2.xsd"
             version="2.2">

    <persistence-unit name="mainPU" transaction-type="RESOURCE_LOCAL">
        <provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>

        <class>com.example.caseapp.domain.CaseFile</class>

        <properties>
            <property name="javax.persistence.jdbc.driver" value="org.postgresql.Driver"/>
            <property name="javax.persistence.jdbc.url" value="jdbc:postgresql://localhost:5432/caseapp"/>
            <property name="javax.persistence.jdbc.user" value="caseapp"/>
            <property name="javax.persistence.jdbc.password" value="secret"/>
        </properties>
    </persistence-unit>
</persistence>
```

### 4.1 `transaction-type`

Ada dua tipe utama:

```text
RESOURCE_LOCAL
JTA
```

`RESOURCE_LOCAL`:

- aplikasi mengelola transaction melalui `EntityTransaction`;
- umum untuk Java SE atau aplikasi kecil;
- tidak otomatis ikut distributed transaction;
- tidak otomatis dikelola container.

`JTA`:

- transaction dikelola Jakarta EE container atau transaction manager;
- cocok untuk container-managed transaction;
- bisa koordinasi beberapa resource;
- behavior bergantung environment.

### 4.2 `jta-data-source` vs `non-jta-data-source`

Dalam container:

```xml
<jta-data-source>java:jboss/datasources/MainDS</jta-data-source>
```

atau:

```xml
<non-jta-data-source>java:jboss/datasources/ReadOnlyDS</non-jta-data-source>
```

Mental model:

- `jta-data-source`: connection ikut JTA transaction.
- `non-jta-data-source`: connection tidak dikontrol JTA dengan cara yang sama.

Salah memilih datasource bisa menghasilkan:

- transaksi tidak commit;
- transaksi auto-commit diam-diam;
- lazy load gagal;
- lock tidak bertahan;
- rollback tidak membatalkan semua side effect.

### 4.3 Explicit Class Listing vs Scanning

`persistence.xml` bisa menyebut class:

```xml
<class>com.example.CaseFile</class>
```

Atau mengandalkan scanning tergantung packaging dan provider/framework.

Untuk sistem besar, explicit listing lebih deterministic, tapi maintenance cost lebih tinggi. Scanning lebih nyaman, tapi rawan perbedaan classpath antara test, dev, dan production.

### 4.4 `exclude-unlisted-classes`

Contoh:

```xml
<exclude-unlisted-classes>true</exclude-unlisted-classes>
```

Makna praktis:

- `true`: hanya class yang disebut eksplisit atau mapping file yang dipakai;
- `false`: provider boleh scan class lain di root persistence unit.

Failure mode:

```text
Di local entity ditemukan karena scanning.
Di production packaging berbeda, entity tidak ditemukan.
Akibatnya: Not an entity, unknown entity, mapping missing.
```

### 4.5 Mapping Files

Selain annotation, JPA mendukung XML mapping:

```xml
<mapping-file>META-INF/orm.xml</mapping-file>
```

XML mapping masih berguna untuk:

- override mapping tanpa mengubah source;
- legacy system;
- vendor/product yang ingin konfigurasi eksternal;
- migration bertahap.

Namun XML + annotation dapat menciptakan konflik.

**Rule:** kalau memakai XML override, dokumentasikan precedence dan pastikan test membaca mapping yang sama dengan production.

---

## 5. Provider Resolution: Jangan Biarkan Runtime Menebak Terlalu Banyak

Masalah umum:

```text
ClassPath berisi Hibernate dan EclipseLink.
Persistence unit tidak menyebut provider.
Framework/container memilih salah satu.
Developer mengira Hibernate, runtime memakai EclipseLink.
```

Dampaknya:

- property Hibernate diabaikan;
- SQL berbeda;
- lazy loading berbeda;
- cache berbeda;
- DDL validation berbeda;
- exception berbeda;
- query yang sebelumnya valid bisa gagal.

Contoh konfigurasi eksplisit Hibernate:

```xml
<provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
```

Contoh konfigurasi eksplisit EclipseLink:

```xml
<provider>org.eclipse.persistence.jpa.PersistenceProvider</provider>
```

**Design rule:** dalam aplikasi mission-critical, provider harus dianggap bagian dari architecture decision, bukan implementation detail acak.

---

## 6. Hibernate Bootstrap Deep Dive

Hibernate bisa diboot melalui dua jalur besar:

1. JPA bootstrap.
2. Native Hibernate bootstrap.

### 6.1 JPA Bootstrap dengan Hibernate

```java
EntityManagerFactory emf = Persistence.createEntityManagerFactory("mainPU");
```

Di bawahnya, Hibernate membangun `SessionFactory`.

Secara konseptual:

```text
JPA Persistence bootstrap
    -> HibernatePersistenceProvider
        -> BootstrapServiceRegistry
        -> StandardServiceRegistry
        -> MetadataSources
        -> MetadataBuilder
        -> Metadata
        -> SessionFactoryBuilder
        -> SessionFactory / EntityManagerFactory
```

Tidak semua class itu harus kamu pakai langsung, tetapi kamu harus paham layer-nya.

### 6.2 Native Hibernate Bootstrap

Native bootstrap memberi kontrol lebih besar.

Contoh konseptual:

```java
StandardServiceRegistry registry = new StandardServiceRegistryBuilder()
        .applySetting("hibernate.connection.url", "jdbc:postgresql://localhost:5432/app")
        .applySetting("hibernate.connection.username", "app")
        .applySetting("hibernate.connection.password", "secret")
        .applySetting("hibernate.dialect", "org.hibernate.dialect.PostgreSQLDialect")
        .build();

Metadata metadata = new MetadataSources(registry)
        .addAnnotatedClass(CaseFile.class)
        .addAnnotatedClass(CaseTask.class)
        .buildMetadata();

SessionFactory sessionFactory = metadata.buildSessionFactory();
```

Dalam aplikasi Spring Boot, kamu jarang menulis ini langsung. Namun Spring/Hibernate tetap melakukan hal serupa di bawahnya.

### 6.3 Hibernate Service Registry

Service registry adalah container internal Hibernate untuk service seperti:

- connection provider;
- transaction coordinator;
- dialect;
- class loading;
- type configuration;
- integrator service;
- strategy selector;
- JDBC environment;
- cache service;
- schema management.

Mental model:

```text
ServiceRegistry = dependency container internal Hibernate
```

Kalau ada error seperti dialect, connection provider, naming strategy, class loading, atau integrator, biasanya sumbernya ada di service registry/metadata boot phase.

### 6.4 MetadataSources

`MetadataSources` berisi input mapping:

- annotated class;
- package;
- XML mapping;
- resource mapping.

Provider kemudian memproses input ini menjadi metadata yang ter-normalisasi.

### 6.5 Metadata

`Metadata` adalah hasil interpretasi mapping.

Ia tahu:

- entity bindings;
- collection bindings;
- table mappings;
- identifier generators;
- type mappings;
- named queries;
- fetch profiles;
- converters.

### 6.6 SessionFactory

`SessionFactory` adalah runtime engine utama Hibernate.

Ia:

- thread-safe;
- expensive to build;
- menyimpan metadata;
- membuat `Session`;
- mengelola second-level cache;
- memegang query plan cache;
- memegang statistics;
- memegang integrasi event/listener.

JPA `EntityManagerFactory` dapat di-unwrap:

```java
SessionFactory sessionFactory = emf.unwrap(SessionFactory.class);
```

Ini berguna untuk:

- statistics;
- cache;
- provider-specific API;
- advanced diagnostics.

---

## 7. EclipseLink Bootstrap Deep Dive

EclipseLink juga bisa diboot via JPA:

```java
EntityManagerFactory emf = Persistence.createEntityManagerFactory("mainPU");
```

Di bawahnya, EclipseLink membangun session infrastructure.

Mental model:

```text
JPA Persistence bootstrap
    -> EclipseLink PersistenceProvider
        -> parse persistence unit
        -> build Project metadata
        -> build descriptors
        -> configure session
        -> configure weaving/change tracking/cache
        -> return EntityManagerFactory
```

### 7.1 Session dan UnitOfWork

EclipseLink punya konsep internal yang historis lebih tua dari JPA:

- `Session`;
- `ServerSession`;
- `ClientSession`;
- `UnitOfWork`;
- descriptors;
- mappings.

JPA `EntityManager` di EclipseLink beroperasi di atas konsep UnitOfWork.

Mental model:

```text
EntityManager ~= facade over EclipseLink UnitOfWork/session machinery
```

### 7.2 Descriptors

Descriptor adalah metadata utama untuk class/entity.

Descriptor menyimpan informasi seperti:

- table;
- primary key;
- mappings;
- query keys;
- inheritance;
- cache policy;
- change tracking policy;
- event callbacks.

Jika Hibernate punya entity binding/metadata model, EclipseLink punya descriptor model yang sangat penting.

### 7.3 Weaving

EclipseLink banyak mengandalkan weaving untuk fitur seperti:

- lazy loading;
- change tracking;
- fetch groups;
- internal optimization.

Weaving bisa:

- dynamic weaving saat runtime dengan agent/classloader support;
- static weaving saat build time.

Failure mode umum:

```text
Di local dynamic weaving aktif.
Di production classloader/container tidak mengizinkan weaving.
Lazy loading/basic optimization berubah behavior.
```

### 7.4 EclipseLink Properties

Contoh:

```xml
<property name="eclipselink.logging.level" value="FINE"/>
<property name="eclipselink.ddl-generation" value="none"/>
<property name="eclipselink.weaving" value="true"/>
<property name="eclipselink.cache.shared.default" value="false"/>
```

Seperti Hibernate, property provider-specific harus dianggap bagian dari runtime contract.

---

## 8. Container-Managed Bootstrap: Jakarta EE

Dalam Jakarta EE, kamu tidak selalu membuat `EntityManagerFactory` sendiri. Container yang membangun dan inject.

Contoh:

```java
@PersistenceContext(unitName = "mainPU")
private EntityManager em;
```

atau:

```java
@PersistenceUnit(unitName = "mainPU")
private EntityManagerFactory emf;
```

### 8.1 Apa yang Dilakukan Container?

Container:

- membaca `persistence.xml`;
- menghubungkan datasource JNDI;
- memilih provider;
- mengatur JTA integration;
- mengelola lifecycle `EntityManager`;
- mengikat persistence context ke transaction/request/component scope;
- menjalankan injection.

### 8.2 Application-Managed vs Container-Managed

Application-managed:

```java
EntityManager em = emf.createEntityManager();
EntityTransaction tx = em.getTransaction();
tx.begin();
try {
    em.persist(entity);
    tx.commit();
} catch (RuntimeException ex) {
    tx.rollback();
    throw ex;
} finally {
    em.close();
}
```

Container-managed:

```java
@Transactional
public void createCase(CreateCaseCommand command) {
    CaseFile caseFile = CaseFile.open(command);
    em.persist(caseFile);
}
```

Pada container-managed mode, boundary transaction dan lifecycle persistence context sangat dipengaruhi container/framework.

### 8.3 Risk

Developer sering mengira:

```text
@PersistenceContext = simple global EntityManager
```

Padahal biasanya container memberi proxy yang mengarahkan operasi ke persistence context aktif.

Konsekuensinya:

- entity manager field bisa terlihat singleton, tetapi operation context-nya berbeda per transaction;
- memakai entity manager di thread lain bisa gagal;
- async job harus punya transaction dan persistence context sendiri;
- lazy loading bergantung apakah context masih aktif.

---

## 9. Spring Boot Bootstrap: Auto-Configuration yang Nyaman tapi Harus Dipahami

Spring Boot sering menyembunyikan `persistence.xml`. Entity ditemukan melalui scanning berdasarkan package aplikasi.

Typical stack:

```text
Spring Boot
  -> DataSource auto-configuration
  -> HibernateJpaAutoConfiguration
  -> LocalContainerEntityManagerFactoryBean
  -> JpaVendorAdapter
  -> EntityManagerFactory
  -> TransactionManager
```

### 9.1 Kenapa Ini Penting?

Karena banyak setting tidak lagi berada di `persistence.xml`, tetapi di:

```properties
spring.datasource.url=...
spring.jpa.hibernate.ddl-auto=validate
spring.jpa.properties.hibernate.jdbc.batch_size=50
spring.jpa.open-in-view=false
```

atau YAML:

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
    properties:
      hibernate:
        jdbc:
          batch_size: 50
```

### 9.2 Auto-Scanning

Spring Boot biasanya scan entity dari package root aplikasi.

Jika entity berada di luar root package, perlu:

```java
@EntityScan("com.example.shared.domain")
```

atau explicit configuration.

Failure mode:

```text
Repository ada.
Entity class ada.
Tapi boot gagal: Not a managed type.
```

Penyebab umum:

- entity package tidak discan;
- annotation masih `javax.persistence.Entity` saat runtime memakai Jakarta;
- dependency mismatch;
- test slice hanya scan sebagian context.

### 9.3 Spring Test Slice Trap

`@DataJpaTest` tidak selalu sama dengan full application bootstrap.

Perbedaan bisa terjadi pada:

- datasource;
- dialect;
- schema generation;
- entity scanning;
- converter bean;
- auditor bean;
- naming strategy;
- transaction behavior;
- cache setting.

**Rule:** untuk persistence-critical system, minimal punya satu integration test yang mem-bootstrap konfigurasi mendekati production.

---

## 10. Classpath, Module Path, and Java 8–25 Concerns

### 10.1 Java 8 World

Pada Java 8:

- classpath dominan;
- `javax.persistence` namespace;
- JPA 2.1/2.2 umum;
- Hibernate 5.x umum;
- EclipseLink 2.x umum;
- reflection lebih longgar;
- illegal reflective access belum menjadi problem Java module system.

### 10.2 Java 9+ Module World

Java 9 memperkenalkan JPMS/module system.

Masalah umum:

- provider butuh reflective access ke entity;
- entity package tidak `opens` ke provider;
- annotation terlihat tapi field tidak bisa diakses;
- bytecode enhancement/weaving terganggu;
- split package conflict.

Contoh module declaration konseptual:

```java
module com.example.caseapp.domain {
    requires jakarta.persistence;

    opens com.example.caseapp.domain to org.hibernate.orm.core;
}
```

Untuk EclipseLink, target module/provider bisa berbeda tergantung artifact/module name.

**Mental model:** `exports` membuat API terlihat saat compile; `opens` membuat reflection diperbolehkan saat runtime.

ORM biasanya butuh `opens`, bukan hanya `exports`.

### 10.3 Java 17/21/25 Modern Runtime

Pada runtime modern:

- illegal reflective access lebih dibatasi;
- framework harus kompatibel dengan module/reflection policy;
- bytecode libraries harus mendukung class file version terbaru;
- build-time enhancement harus memakai plugin yang kompatibel;
- container image base JDK harus sesuai dengan compiled bytecode.

Failure mode klasik:

```text
Compiled with Java 21.
Runtime uses Java 17.
Provider/enhancer sees class file version 65 and fails.
```

Atau:

```text
Application upgraded to Java 25.
Bytecode enhancer/dependency belum mendukung class file version terbaru.
Boot gagal sebelum aplikasi start.
```

---

## 11. `javax.persistence` vs `jakarta.persistence`: Namespace adalah Runtime Boundary

Ini salah satu sumber masalah paling sering dalam migration.

Legacy:

```java
import javax.persistence.Entity;
```

Modern:

```java
import jakarta.persistence.Entity;
```

Secara source terlihat mirip. Secara runtime mereka adalah type berbeda.

Entity dengan annotation `javax.persistence.Entity` tidak otomatis dianggap entity oleh provider Jakarta-only yang mencari `jakarta.persistence.Entity`.

### 11.1 Dependency Mixing Failure

Contoh dependency campur:

```text
Application: Spring Boot 3 / Jakarta
Entity: javax.persistence.Entity
Provider: Hibernate 6+
Result: Not a managed type / no entity found / mapping ignored
```

Atau:

```text
Application: Spring Boot 2 / javax
Library: jakarta.persistence.Entity
Provider: Hibernate 5.x javax line
Result: entity not detected
```

### 11.2 Rule Migration

Migration bukan sekadar replace import. Checklist minimal:

- source imports;
- persistence XML namespace;
- JPA property keys;
- provider version;
- app server version;
- Spring Boot version;
- validation namespace;
- transaction namespace;
- JAXB/JAX-RS/CDI related namespace;
- third-party library compatibility.

---

## 12. Metadata Discovery: Bagaimana Entity Ditemukan

Entity bisa ditemukan melalui beberapa jalur:

1. Explicit `<class>` di `persistence.xml`.
2. Scanning archive persistence unit.
3. Framework scanning seperti Spring `@EntityScan`.
4. Programmatic registration.
5. Native-image/build-time indexing framework seperti Quarkus.

### 12.1 Explicit Class Registration

Kelebihan:

- deterministic;
- mudah diaudit;
- tidak tergantung package scanning;
- cocok untuk library/module boundary.

Kekurangan:

- maintenance cost;
- lupa menambahkan class baru;
- rawan konflik saat refactor package.

### 12.2 Scanning

Kelebihan:

- produktif;
- cocok untuk aplikasi dengan package convention kuat;
- minim konfigurasi.

Kekurangan:

- bergantung packaging;
- lambat pada aplikasi besar jika tidak dioptimalkan;
- test/prod bisa berbeda;
- bisa menangkap entity yang tidak seharusnya masuk persistence unit.

### 12.3 Programmatic Registration

Hibernate native bootstrap:

```java
new MetadataSources(registry)
        .addAnnotatedClass(CaseFile.class)
        .addAnnotatedClass(CaseTask.class)
        .buildMetadata();
```

Spring advanced configuration bisa mengatur packages to scan.

### 12.4 Build-Time Indexing

Beberapa framework modern, terutama yang menargetkan fast startup/native image, lebih suka build-time indexing.

Konsekuensi:

- entity harus diketahui saat build;
- dynamic scanning terbatas;
- reflection config harus explicit;
- runtime extension pattern berbeda.

---

## 13. Metadata Binding: Dari Annotation ke Runtime Model

Mari ambil entity:

```java
@Entity
@Table(name = "CASE_FILE")
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    @SequenceGenerator(name = "case_file_seq", sequenceName = "CASE_FILE_SEQ", allocationSize = 50)
    private Long id;

    @Version
    private long version;

    @Column(name = "CASE_NO", nullable = false, length = 50, unique = true)
    private String caseNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "STATUS", nullable = false, length = 30)
    private CaseStatus status;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "ASSIGNED_OFFICER_ID", nullable = false)
    private Officer assignedOfficer;

    @OneToMany(mappedBy = "caseFile", cascade = CascadeType.PERSIST, orphanRemoval = false)
    private List<CaseTask> tasks = new ArrayList<>();
}
```

Provider membangun metadata seperti:

```text
EntityBinding(CaseFile)
  entityName: com.example.CaseFile
  table: CASE_FILE
  identifier:
    property: id
    generator: sequence CASE_FILE_SEQ
    allocationSize: 50
  version:
    property: version
  basic properties:
    caseNo -> CASE_NO varchar(50) not null unique
    status -> STATUS varchar(30) not null enum-string
  many-to-one:
    assignedOfficer -> FK ASSIGNED_OFFICER_ID not null lazy
  one-to-many:
    tasks -> inverse collection mappedBy caseFile
```

Metadata ini akan dipakai untuk:

- insert SQL;
- update SQL;
- select SQL;
- join SQL;
- dirty checking;
- optimistic locking;
- cascade persist;
- flush ordering;
- query parsing;
- schema validation.

### 13.1 Binding Failure Example

Jika `mappedBy` salah:

```java
@OneToMany(mappedBy = "case")
private List<CaseTask> tasks;
```

Padahal child punya:

```java
@ManyToOne
private CaseFile caseFile;
```

Provider bisa gagal saat boot:

```text
mappedBy reference an unknown target entity property: CaseTask.case
```

Ini bagus: gagal cepat saat bootstrap.

Lebih berbahaya adalah konfigurasi valid tapi salah secara semantik, misalnya owning side tidak dipahami sehingga update tidak terjadi.

---

## 14. Access Type: Field vs Property Ditentukan Saat Metadata Binding

Provider menentukan apakah entity memakai field access atau property access dari lokasi mapping annotation utama.

Field access:

```java
@Id
private Long id;
```

Property access:

```java
@Id
public Long getId() {
    return id;
}
```

### 14.1 Kenapa Ini Bootstrap Concern?

Karena provider saat metadata build memutuskan persistent attributes berdasarkan access type.

Jika annotation tercampur sembarangan:

```java
@Id
private Long id;

@Column(name = "CASE_NO")
public String getCaseNo() {
    return caseNo;
}
```

Maka `@Column` di getter bisa diabaikan jika access type entity adalah field access.

Failure mode:

- column name tidak sesuai;
- field tidak dipersist;
- converter tidak jalan;
- validation tidak sesuai;
- lazy behavior berbeda.

**Rule:** pilih satu access type per entity hierarchy dan konsisten.

---

## 15. Provider Properties: Kontrak yang Sering Tersembunyi

Provider-specific properties bukan detail kecil. Mereka mengubah runtime semantics.

### 15.1 Hibernate Examples

```properties
hibernate.dialect=org.hibernate.dialect.PostgreSQLDialect
hibernate.hbm2ddl.auto=validate
hibernate.show_sql=false
hibernate.format_sql=true
hibernate.jdbc.batch_size=50
hibernate.order_inserts=true
hibernate.order_updates=true
hibernate.generate_statistics=true
hibernate.default_batch_fetch_size=50
```

Makna:

- dialect menentukan SQL dialect;
- schema tool menentukan validasi/generation;
- batching mengubah cara DML dikirim;
- ordered inserts/updates mengubah action ordering untuk batching;
- statistics mengaktifkan metric internal;
- default batch fetch mengubah lazy association loading.

### 15.2 EclipseLink Examples

```properties
eclipselink.logging.level=INFO
eclipselink.ddl-generation=none
eclipselink.weaving=true
eclipselink.cache.shared.default=false
eclipselink.jdbc.batch-writing=JDBC
```

Makna:

- logging level memengaruhi observability;
- DDL generation mengontrol schema action;
- weaving memengaruhi lazy/change tracking;
- shared cache mengubah visibility stale data;
- batch writing mengubah DML behavior.

### 15.3 Rule

Provider properties harus terdokumentasi bersama architecture decision, bukan tersebar acak dalam YAML/properties.

Minimal catat:

```text
Property
Value
Reason
Environment differences
Risk if changed
How to test
```

---

## 16. Dialect Initialization: Database Bukan Sekadar JDBC URL

Dialect menentukan bagaimana provider bicara dengan database.

Dialect memengaruhi:

- pagination;
- sequence syntax;
- identity syntax;
- locking SQL;
- timestamp precision;
- boolean mapping;
- LOB handling;
- generated keys;
- limit/offset;
- DDL type;
- function registry.

### 16.1 Wrong Dialect Failure

Contoh:

```text
Database: Oracle
Dialect: generic/old Oracle dialect
Problem: pagination SQL tidak optimal atau salah
```

Atau:

```text
Database: PostgreSQL
Dialect: MySQLDialect
Problem: limit syntax mungkin beda, sequence behavior salah, locking SQL salah
```

Modern provider sering auto-detect dialect dari JDBC metadata. Namun untuk production, kamu tetap harus tahu dialect final yang dipakai.

**Rule:** log dan verifikasi dialect saat startup.

---

## 17. Enhancement dan Weaving Saat Bootstrap

ORM membutuhkan mekanisme untuk membuat object biasa menjadi object yang dapat dilacak.

Ada beberapa pendekatan:

1. Reflection + snapshot.
2. Runtime proxy.
3. Bytecode enhancement.
4. Runtime weaving.
5. Build-time weaving/enhancement.

### 17.1 Hibernate Enhancement

Hibernate dapat memakai bytecode enhancement untuk:

- dirty tracking lebih efisien;
- lazy attribute loading;
- association management;
- performance optimization.

Tanpa enhancement, Hibernate tetap bisa bekerja untuk banyak kasus, tetapi beberapa fitur tidak aktif atau memakai mekanisme lebih mahal.

### 17.2 EclipseLink Weaving

EclipseLink weaving sering lebih sentral.

Weaving dapat mendukung:

- lazy loading;
- change tracking;
- fetch group;
- internal indirection.

Weaving bisa gagal jika:

- Java agent tidak dipasang;
- classloader tidak mendukung transformation;
- static weaving tidak dijalankan;
- module system menutup package;
- native image tidak memberi reflection/proxy config.

### 17.3 Build Pipeline Risk

Jika test tidak menjalankan enhancement/weaving yang sama seperti production, test bisa memberi confidence palsu.

Contoh:

```text
Production: enhanced classes
Test: plain classes
Result: dirty tracking/lazy field behavior berbeda
```

Atau:

```text
Local: dynamic weaving aktif
Production: dynamic weaving gagal
Result: lazy relation unexpectedly eager or unavailable
```

---

## 18. Lifecycle Hooks Saat Bootstrap

Provider dapat menemukan callback/listener:

```java
@PrePersist
public void beforeInsert() {}

@PostLoad
public void afterLoad() {}
```

Entity listener:

```java
@EntityListeners(AuditListener.class)
public class CaseFile { }
```

Provider menyimpan listener ini dalam metadata.

### 18.1 Listener Bootstrap Failure

Masalah umum:

- listener class tidak punya constructor sesuai;
- dependency injection tidak tersedia;
- listener memakai bean Spring tapi tidak dikelola Spring;
- listener melempar exception saat metadata/init;
- callback method signature salah.

### 18.2 Listener Design Rule

Jangan membuat entity listener bergantung pada terlalu banyak infrastructure.

Listener idealnya:

- kecil;
- deterministic;
- tidak melakukan query kompleks;
- tidak memanggil remote service;
- tidak menyebabkan recursive persistence operation;
- mudah diuji.

---

## 19. AttributeConverter Discovery

Converter bisa auto-apply:

```java
@Converter(autoApply = true)
public class CaseStatusConverter implements AttributeConverter<CaseStatus, String> {
    @Override
    public String convertToDatabaseColumn(CaseStatus attribute) {
        return attribute == null ? null : attribute.code();
    }

    @Override
    public CaseStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : CaseStatus.fromCode(dbData);
    }
}
```

Saat bootstrap, provider menemukan converter dan mengikatnya ke attribute yang sesuai.

### 19.1 AutoApply Risk

`autoApply = true` bisa berdampak global.

Contoh:

```text
Converter untuk Money autoApply ke semua Money field.
Satu field sebenarnya perlu format/scale berbeda.
Provider tetap menerapkan converter global.
```

### 19.2 Query Binding Risk

Converter tidak hanya memengaruhi insert/update. Ia juga bisa memengaruhi parameter binding query.

Contoh:

```java
query.setParameter("status", CaseStatus.OPEN);
```

Provider dapat memakai converter untuk mengubah `CaseStatus.OPEN` menjadi database representation.

Jika converter salah, query hasilnya salah tanpa error compile.

---

## 20. Named Queries and Bootstrap-Time Validation

Named query:

```java
@NamedQuery(
    name = "CaseFile.findOpenByOfficer",
    query = "select c from CaseFile c where c.status = :status and c.assignedOfficer.id = :officerId"
)
@Entity
public class CaseFile { }
```

Provider bisa memvalidasi named query saat bootstrap.

Keuntungan:

- error query ditemukan saat startup;
- deployment gagal cepat;
- menghindari error runtime pada path jarang dipakai.

Risiko:

- startup lebih lambat;
- query provider-specific bisa gagal saat migration;
- beberapa validation baru terjadi saat query dieksekusi tergantung provider/version.

**Rule:** untuk query penting, startup validation bagus. Tetapi tetap butuh integration test dengan real database karena JPQL valid belum tentu execution plan bagus.

---

## 21. Schema Generation and Validation Saat Bootstrap

Provider dapat melakukan schema action:

- none;
- validate;
- update;
- create;
- create-drop;
- drop-and-create.

Hibernate property klasik:

```properties
hibernate.hbm2ddl.auto=validate
```

Jakarta standard properties juga ada untuk schema generation, tetapi framework/provider sering memakai property masing-masing.

### 21.1 Production Rule

Untuk production enterprise:

```text
ddl-auto=validate or none
migration via Flyway/Liquibase/manual DBA process
```

Hindari:

```text
ddl-auto=update in production
```

Karena provider bukan migration planner penuh.

Ia tidak memahami:

- zero-downtime rollout;
- data backfill;
- index concurrently;
- lock duration;
- rollback strategy;
- phased deployment;
- cross-service compatibility.

### 21.2 Validation Value

Schema validation saat bootstrap berguna untuk menangkap:

- missing table;
- missing column;
- wrong column type;
- missing sequence;
- mapping mismatch.

Tetapi validation tidak selalu menangkap:

- missing index;
- bad execution plan;
- wrong data distribution;
- constraint semantics yang lebih kompleks;
- trigger behavior;
- database privilege issue pada path tertentu.

---

## 22. Multi-Persistence Unit Design

Satu aplikasi bisa punya beberapa persistence unit.

Contoh:

```text
main-write-pu
  transaction: JTA
  datasource: MainWriteDS
  entities: command/write model

reporting-read-pu
  transaction: RESOURCE_LOCAL or JTA
  datasource: ReportingReadDS
  entities: read model/projection
```

### 22.1 Kapan Masuk Akal?

Multi-PU masuk akal jika:

- database berbeda;
- schema berbeda;
- provider berbeda;
- transaction model berbeda;
- cache policy berbeda;
- read/write model sengaja dipisah;
- migration boundary berbeda.

### 22.2 Risiko Multi-PU

Risiko:

- entity class sama dimanage dua PU;
- transaction boundary membingungkan;
- cross-PU relationship tidak otomatis;
- cache consistency sulit;
- repository salah memakai entity manager;
- test salah inject PU.

**Rule:** jangan membuat multi-PU hanya karena package banyak. Gunakan multi-PU untuk boundary runtime yang nyata.

---

## 23. ClassLoader and Packaging Failure Modes

ORM bootstrap sangat sensitif terhadap packaging.

### 23.1 Fat JAR / Uber JAR

Masalah:

- `META-INF/services` tidak ter-merge;
- `persistence.xml` hilang;
- duplicate resources;
- shading mengubah package;
- provider discovery gagal.

### 23.2 WAR/EAR

Masalah:

- persistence unit visibility;
- library di server vs aplikasi konflik;
- parent-first/child-first classloading;
- dua versi provider;
- datasource JNDI tidak ada;
- entity di module lain tidak terlihat.

### 23.3 Modular Monolith / Multi-Module Build

Masalah:

- domain module tidak dibuka untuk reflection;
- entity berada di dependency optional;
- annotation processor/enhancer tidak jalan di module tertentu;
- generated classes tidak masuk runtime classpath.

### 23.4 Native Image / AOT

Masalah:

- reflection config;
- dynamic proxy;
- classpath scanning;
- bytecode generation;
- service loader;
- build-time initialized metadata.

AOT/native image membuat bootstrap bergeser: banyak keputusan dilakukan saat build, bukan runtime.

---

## 24. Startup Performance: Bootstrap Cost Model

Bootstrap ORM bisa mahal.

Biaya berasal dari:

- classpath scanning;
- annotation parsing;
- XML parsing;
- metadata validation;
- named query parsing;
- type resolution;
- dialect/database metadata lookup;
- schema validation;
- cache initialization;
- enhancement/weaving;
- dependency injection integration;
- connection acquisition.

### 24.1 Startup Slow Diagnosis

Checklist:

```text
1. Berapa entity class?
2. Berapa named query?
3. Apakah schema validation menyentuh database lambat?
4. Apakah provider scan classpath terlalu luas?
5. Apakah database connection lambat saat startup?
6. Apakah second-level cache init lambat?
7. Apakah bytecode enhancement/weaving runtime lambat?
8. Apakah logging SQL/metadata terlalu verbose?
9. Apakah app server melakukan duplicate deployment scan?
10. Apakah test context membuat EMF berkali-kali?
```

### 24.2 Test Performance

Dalam test suite, membuat `EntityManagerFactory` berkali-kali sangat mahal.

Spring test context caching membantu, tetapi mudah rusak jika setiap test punya property berbeda.

Rule:

```text
Minimize unique persistence context configurations in test suite.
```

---

## 25. Failure Mode Catalogue: Bootstrap Edition

### 25.1 Entity Not Managed

Symptom:

```text
Not a managed type: class com.example.CaseFile
Unknown entity: com.example.CaseFile
```

Possible causes:

- entity package not scanned;
- wrong annotation namespace;
- missing `@Entity`;
- class not included in persistence unit;
- test slice missing entity scan;
- module not opened;
- duplicate classloader.

Fix:

- verify annotation namespace;
- verify scanning root;
- explicit entity registration;
- align provider and API dependencies;
- check packaging.

### 25.2 Duplicate Entity Name

Symptom:

```text
Duplicate entity name CaseFile
```

Causes:

- two classes use same `@Entity(name = "CaseFile")`;
- duplicate class in classpath;
- shaded dependency;
- old generated class still packaged.

Fix:

- unique entity names;
- clean build;
- inspect dependency tree;
- inspect final artifact.

### 25.3 Wrong Provider Selected

Symptom:

```text
Hibernate properties ignored
EclipseLink logs appear unexpectedly
Different SQL than expected
```

Causes:

- multiple providers;
- missing `<provider>`;
- container default provider;
- transitive dependency.

Fix:

- explicit provider;
- dependency exclusion;
- startup log assertion;
- environment documentation.

### 25.4 Dialect Mismatch

Symptom:

```text
SQL syntax error near limit
sequence not found
locking SQL invalid
boolean column mismatch
```

Causes:

- wrong dialect property;
- auto-detection wrong due proxy datasource;
- unsupported DB version;
- old provider version.

Fix:

- verify dialect at startup;
- set dialect explicitly if needed;
- upgrade provider;
- integration test against real DB.

### 25.5 Mapping Conflict

Symptom:

```text
Repeated column in mapping
mappedBy unknown
association target not an entity
No identifier specified for entity
```

Causes:

- duplicate column mapping;
- association typo;
- missing `@Id`;
- incorrect access type;
- embeddable/entity confusion.

Fix:

- inspect mapping;
- add boot test;
- enforce mapping conventions.

### 25.6 Enhancement/Weaving Failure

Symptom:

```text
Lazy field not lazy
Class transformation failed
No instrumentation available
Unexpected eager loading
```

Causes:

- agent missing;
- plugin not run;
- module not open;
- final class/method;
- unsupported class file version.

Fix:

- build-time enhancement;
- correct Java version;
- classloader config;
- module opens;
- provider-compatible plugin.

### 25.7 `javax`/`jakarta` Mixing

Symptom:

```text
No entity found
ClassCastException between javax/jakarta APIs
NoSuchMethodError
```

Causes:

- mixed dependencies;
- old library;
- partial migration;
- app server mismatch.

Fix:

- dependency tree audit;
- namespace migration;
- align app server/framework/provider;
- ban wrong namespace in build checks.

### 25.8 Schema Validation Fails in One Environment

Symptom:

```text
Schema-validation: missing table
wrong column type
missing sequence
```

Causes:

- environment schema drift;
- migration not applied;
- different DB user default schema;
- naming strategy differs;
- case-sensitive quoted identifiers.

Fix:

- verify migration version;
- verify DB user/schema;
- compare effective naming strategy;
- inspect generated expected DDL.

---

## 26. Diagnostic Checklist for Startup/Bootstrap Problems

Use this order. Jangan mulai dari random Google search.

```text
1. What Java version compiles the app?
2. What Java version runs the app?
3. Is this javax or jakarta runtime?
4. Which JPA/Jakarta Persistence API jar is loaded?
5. Which provider is actually selected?
6. Which provider version is actually loaded?
7. Which persistence unit is selected?
8. Is persistence.xml present in final artifact?
9. Are entity classes present in final artifact?
10. Are entities using correct annotation namespace?
11. Is entity package scanned or explicitly listed?
12. Is the module/package open for reflection?
13. Which datasource is used?
14. Which dialect is used?
15. Are provider-specific properties applied?
16. Is schema validation enabled?
17. Is enhancement/weaving expected?
18. Is enhancement/weaving actually active?
19. Are named queries validated at startup?
20. Are converters/listeners found and instantiated?
21. Are test and production bootstraps equivalent?
```

---

## 27. Architecture Decision Template: Persistence Bootstrap

Untuk sistem serius, buat ADR kecil.

```md
# ADR: Persistence Provider Bootstrap

## Context
Application requires relational persistence for complex case management workflow.

## Decision
Use Hibernate ORM 6/7 via Jakarta Persistence 3.x with Spring Boot-managed EntityManagerFactory.

## Persistence Units
- mainPU: operational write model
- reportingPU: read model, if applicable

## Provider
- Provider: Hibernate ORM
- Reason: ecosystem, Spring integration, diagnostics, team familiarity

## Java/API Namespace
- Java baseline: 21/25 runtime, compatible source policy as needed
- Persistence namespace: jakarta.persistence

## Entity Discovery
- Spring package scanning rooted at com.example.caseapp
- Additional entity packages declared via @EntityScan

## Schema Strategy
- Production: validate only
- Migration: Flyway/Liquibase

## Dialect
- Explicit/verified dialect: PostgreSQL/Oracle/etc.

## Enhancement
- Build-time enhancement: enabled/disabled
- Runtime weaving: not used/used

## Transaction Integration
- Spring transaction manager / JTA / resource local

## Observability
- SQL logging policy
- statistics policy
- slow query policy

## Risks
- javax/jakarta dependency mixing
- wrong scanning root
- dialect mismatch
- test/prod bootstrap drift

## Verification
- startup integration test
- real DB Testcontainers/integration environment
- assert provider/version/dialect
```

---

## 28. Practical Example: Minimal Java SE Hibernate Bootstrap

`persistence.xml`:

```xml
<persistence xmlns="https://jakarta.ee/xml/ns/persistence"
             version="3.2">
    <persistence-unit name="casePU" transaction-type="RESOURCE_LOCAL">
        <provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
        <class>com.example.CaseFile</class>

        <properties>
            <property name="jakarta.persistence.jdbc.url" value="jdbc:postgresql://localhost:5432/caseapp"/>
            <property name="jakarta.persistence.jdbc.user" value="caseapp"/>
            <property name="jakarta.persistence.jdbc.password" value="secret"/>
            <property name="hibernate.hbm2ddl.auto" value="validate"/>
            <property name="hibernate.show_sql" value="false"/>
        </properties>
    </persistence-unit>
</persistence>
```

Bootstrap:

```java
public final class JpaBootstrapExample {

    public static void main(String[] args) {
        EntityManagerFactory emf = Persistence.createEntityManagerFactory("casePU");

        try {
            EntityManager em = emf.createEntityManager();
            EntityTransaction tx = em.getTransaction();

            try {
                tx.begin();

                CaseFile caseFile = new CaseFile("CASE-2026-0001");
                em.persist(caseFile);

                tx.commit();
            } catch (RuntimeException ex) {
                if (tx.isActive()) {
                    tx.rollback();
                }
                throw ex;
            } finally {
                em.close();
            }
        } finally {
            emf.close();
        }
    }
}
```

Key point:

```text
EntityManagerFactory lifecycle = application lifecycle
EntityManager lifecycle = unit of work / request / transaction boundary
```

---

## 29. Practical Example: Spring Boot Mental Model

Entity:

```java
package com.example.caseapp.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class CaseFile {
    @Id
    private Long id;
}
```

Application root:

```java
package com.example.caseapp;

@SpringBootApplication
public class CaseApplication {
    public static void main(String[] args) {
        SpringApplication.run(CaseApplication.class, args);
    }
}
```

Works because:

```text
com.example.caseapp is root package
com.example.caseapp.domain is below root package
entity scanning finds CaseFile
```

If entity is outside:

```text
com.example.shared.domain.CaseFile
```

Need:

```java
@EntityScan("com.example.shared.domain")
@SpringBootApplication
public class CaseApplication { }
```

Failure if not:

```text
Not a managed type: class com.example.shared.domain.CaseFile
```

---

## 30. Practical Example: Detect Effective Provider and Dialect

In Hibernate:

```java
EntityManagerFactory emf = ...;
SessionFactory sessionFactory = emf.unwrap(SessionFactory.class);

System.out.println("SessionFactory: " + sessionFactory);
```

Depending Hibernate version, detailed dialect access differs. But the principle is:

```text
Do not assume provider/dialect from config file.
Verify effective runtime.
```

In Spring Boot, log startup at INFO/DEBUG for Hibernate can show:

- Hibernate version;
- dialect;
- connection pool;
- schema validation;
- loaded persistence unit.

For production-safe diagnostics, log this once at startup without credentials.

Example desired startup line:

```text
Persistence runtime initialized: provider=Hibernate ORM 7.x, api=jakarta.persistence, dialect=OracleDialect, ddl=validate, pu=mainPU
```

---

## 31. Anti-Patterns

### Anti-Pattern 1 — Creating EntityManagerFactory Per Request

Bad:

```java
public void handleRequest() {
    EntityManagerFactory emf = Persistence.createEntityManagerFactory("mainPU");
    EntityManager em = emf.createEntityManager();
    // ...
}
```

Why bad:

- huge startup cost per request;
- metadata rebuilt repeatedly;
- connection/cache resources leak risk;
- terrible latency.

Correct:

```text
Build EMF once at app startup.
Create EM per unit of work.
Close EM after use.
Close EMF at app shutdown.
```

### Anti-Pattern 2 — Assuming Spring Data Repository Means Entity Is Correctly Mapped

Repository can compile while mapping fails at runtime.

Mapping correctness requires provider bootstrap validation and database integration.

### Anti-Pattern 3 — Letting Provider Auto-Selection Decide Architecture

If Hibernate and EclipseLink are both present, be explicit.

### Anti-Pattern 4 — Treating `ddl-auto=update` as Migration

It is not migration engineering.

### Anti-Pattern 5 — Test with H2, Production Oracle/PostgreSQL, No Real DB Test

Bootstrap may pass but dialect behavior can differ materially.

### Anti-Pattern 6 — Mixing `javax` and `jakarta`

Looks small. Breaks runtime.

### Anti-Pattern 7 — Hidden Entity Scanning Across Too-Wide Package

Can accidentally include entities from experimental/test/legacy modules.

### Anti-Pattern 8 — Relying on Runtime Weaving Without Verifying It in Production

Especially dangerous with EclipseLink and modular/container environments.

---

## 32. Design Rules

1. Treat persistence bootstrap as architecture, not framework magic.
2. Build one `EntityManagerFactory` per persistence unit per application lifecycle.
3. Keep `EntityManager` scoped to request/transaction/unit-of-work.
4. Make provider choice explicit in serious systems.
5. Verify effective provider/version/dialect at startup.
6. Do not mix `javax.persistence` and `jakarta.persistence`.
7. Align Java version, provider version, framework version, and app server version.
8. Prefer schema validation or none in production; use migrations for DDL.
9. Keep entity scanning deterministic.
10. Make test bootstrap close to production bootstrap.
11. Document provider-specific properties and why they exist.
12. Treat enhancement/weaving as a runtime feature that must be tested.
13. Be careful with multi-persistence-unit architecture.
14. Avoid dynamic classpath surprises in fat JAR/WAR/EAR packaging.
15. Use startup diagnostics to expose persistence runtime assumptions.

---

## 33. Practice Scenarios

### Scenario 1 — Entity Not Found After Jakarta Migration

You migrate Spring Boot 2 to Spring Boot 3. Build passes. Runtime fails:

```text
Not a managed type: class com.example.CaseFile
```

Investigation path:

1. Check imports on entity.
2. If still `javax.persistence.Entity`, migrate to `jakarta.persistence.Entity`.
3. Check dependencies for old `javax.persistence-api`.
4. Check provider version.
5. Check entity scanning package.
6. Check generated/shaded duplicate class.

Root lesson:

```text
Namespace migration is runtime metadata migration.
```

### Scenario 2 — Local Works, Production Fails Schema Validation

Local startup passes. Production fails:

```text
missing sequence CASE_FILE_SEQ
```

Investigation path:

1. Verify migration applied to production schema.
2. Verify DB user default schema.
3. Verify sequence name case/quoting.
4. Verify naming strategy.
5. Verify production uses same persistence unit.
6. Verify production property override did not change schema/catalog.

Root lesson:

```text
Provider validates against the schema visible to the runtime DB user, not against your mental model.
```

### Scenario 3 — EclipseLink Lazy Loading Works Locally but Not in Server

Local Java SE app works. App server deployment behaves differently.

Investigation path:

1. Check weaving mode.
2. Check whether dynamic weaving is supported in server.
3. Check agent/classloader logs.
4. Try static weaving.
5. Verify module/package openness.
6. Add integration test under same packaging mode.

Root lesson:

```text
Weaving is environment-sensitive.
```

### Scenario 4 — Two Providers on Classpath

Logs show EclipseLink, but team expected Hibernate.

Investigation path:

1. Inspect dependency tree.
2. Check `persistence.xml` provider.
3. Check container default provider.
4. Exclude unwanted provider.
5. Add startup assertion/logging.

Root lesson:

```text
Provider is not an implementation detail if provider-specific behavior is used.
```

---

## 34. Summary

Bootstrap adalah fase di mana ORM mengubah domain class dan konfigurasi menjadi runtime persistence engine. Ini bukan detail startup yang bisa diabaikan.

Mental model utama:

```text
ORM bootstrap = compilation phase
Entity annotations/XML/properties/dialect -> metadata model -> runtime factory
```

Hal yang harus kamu kuasai:

- persistence unit adalah boundary konfigurasi runtime;
- provider selection harus jelas;
- `EntityManagerFactory` adalah hasil bootstrap yang mahal dan long-lived;
- `EntityManager` adalah unit-of-work/persistence-context API;
- Hibernate membangun service registry, metadata, lalu `SessionFactory`;
- EclipseLink membangun session/descriptors/weaving/cache infrastructure;
- Java 8–25 membawa konsekuensi namespace, module, bytecode, dan provider compatibility;
- `javax` vs `jakarta` adalah boundary nyata, bukan kosmetik import;
- enhancement/weaving harus dipahami sebagai bagian dari runtime behavior;
- schema validation, dialect, converter, listener, named query, dan cache semua terikat saat bootstrap;
- test/prod bootstrap drift adalah sumber bug besar.

Jika part 0 memberi mental model ORM sebagai state synchronization engine, part ini memberi mental model bahwa sebelum synchronization terjadi, provider harus membangun mesin sinkronisasi itu dengan benar.

---

## 35. Referensi Resmi dan Bacaan Lanjutan

- Jakarta Persistence 3.2 Specification: https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Jakarta Persistence 3.2 API — `EntityManager`: https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager
- Jakarta Persistence 3.2 API — `EntityManagerFactory`: https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanagerfactory
- Hibernate ORM User Guide, stable line: https://docs.hibernate.org/stable/orm/userguide/html_single/
- Hibernate ORM Documentation: https://hibernate.org/orm/documentation/
- Hibernate ORM 6.4 User Guide — Bootstrap sections: https://docs.hibernate.org/orm/6.4/userguide/html_single/
- EclipseLink Documentation: https://eclipse.dev/eclipselink/documentation/
- EclipseLink Persistence Unit Properties API: https://eclipse.dev/eclipselink/api/3.0/org/eclipse/persistence/config/PersistenceUnitProperties.html
- Oracle TopLink/EclipseLink Persistence Unit Concepts: https://docs.oracle.com/en/middleware/standalone/toplink/14.1.1.0/concepts/understanding-persistence-unit.html

---

## 36. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 0 — Orientation: ORM as State Synchronization Engine
- Part 1 — JPA Specification vs Provider Reality
- Part 2 — Persistence Unit, Bootstrap, Metadata, and Provider Initialization

Part berikutnya:

```text
03-entity-identity-java-database-persistence-context.md
```
