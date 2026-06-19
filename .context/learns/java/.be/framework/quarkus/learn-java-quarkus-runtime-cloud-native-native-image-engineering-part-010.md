# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-010

# Part 010 — Persistence I: Hibernate ORM di Quarkus Tanpa Mengulang JPA Dasar

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Bagian: `010 / 035`  
> Status: **lanjutan, belum bagian terakhir**  
> Fokus: **Hibernate ORM dalam runtime Quarkus: build-time enhancement, persistence unit, datasource, Agroal pool, transaction boundary, SQL lifecycle, performance, failure mode, dan production governance**

---

## 0. Tujuan Part Ini

Kamu sudah mempelajari JPA, Hibernate, JDBC, HikariCP, transaksi, SQL, migration, testing, observability, dan performance JVM. Jadi bagian ini **tidak akan mengulang**:

- apa itu entity,
- apa itu `@Id`,
- apa itu `@ManyToOne`,
- apa itu lazy/eager,
- apa itu JPQL,
- apa itu transaction secara dasar,
- apa itu connection pool secara dasar,
- apa itu N+1 secara textbook.

Yang kita bahas adalah versi yang lebih penting untuk Quarkus:

> Bagaimana Hibernate ORM berubah ketika hidup di runtime yang banyak keputusan framework-nya dilakukan saat build-time, bukan runtime?

Part ini bertujuan membuat kamu bisa menjawab pertanyaan seperti:

1. Kenapa Hibernate di Quarkus terasa lebih “terkontrol” daripada di runtime tradisional?
2. Apa konsekuensi build-time enhancement terhadap entity, persistence unit, scanning, native image, dan startup?
3. Bagaimana Quarkus menghubungkan datasource, Agroal connection pool, Narayana transaction manager, dan Hibernate ORM?
4. Di mana transaction boundary seharusnya diletakkan?
5. Bagaimana menghindari persistence layer yang terlihat clean di kode, tetapi buruk di production?
6. Bagaimana membaca failure mode Hibernate ORM di Quarkus dari sudut pandang service engineering?

Referensi utama part ini adalah dokumentasi resmi Quarkus tentang Hibernate ORM/Jakarta Persistence, datasource, transaction, Narayana JTA, Hibernate ORM with Panache, dan konfigurasi global Quarkus.

---

## 1. Mental Model: ORM di Quarkus Bukan “Hibernate Biasa yang Ditaruh di Main Method”

Hibernate ORM secara umum adalah runtime ORM: ia membaca metadata entity, membangun mapping model, membuat session factory/entity manager factory, mengelola persistence context, dirty checking, SQL generation, query execution, transaction synchronization, dan lifecycle entity.

Pada runtime tradisional, banyak pekerjaan dilakukan saat aplikasi start atau bahkan saat runtime:

```text
application starts
  -> classpath scanning
  -> annotation processing/reflection
  -> entity discovery
  -> mapping metadata build
  -> persistence unit boot
  -> proxy/enhancement handling
  -> runtime config resolution
  -> service ready
```

Quarkus mencoba menggeser banyak pekerjaan ke build phase:

```text
quarkus build
  -> index classes with Jandex
  -> discover entities/extensions
  -> process build items
  -> generate metadata/bytecode/config wiring
  -> prepare runtime initialization
  -> produce optimized artifact

application starts
  -> initialize only what must happen at runtime
  -> open pool/session factory/runtime services
  -> service ready faster
```

Inilah mental model pentingnya:

> Di Quarkus, persistence layer bukan hanya library runtime. Ia adalah bagian dari build-time application model.

Konsekuensinya besar:

- entity discovery lebih deterministik,
- beberapa konfigurasi dianggap build-time fixed,
- dependency yang tidak terindeks bisa tidak ditemukan,
- dynamic classloading/reflection lebih dibatasi,
- native image compatibility harus dipikirkan sejak desain,
- startup lebih cepat karena metadata sudah diproses,
- kesalahan mapping sering muncul lebih awal saat build/startup,
- extension lain bisa berkolaborasi dengan Hibernate ORM pada build phase.

---

## 2. Posisi Hibernate ORM dalam Quarkus Runtime

Hibernate ORM di Quarkus duduk di antara beberapa subsistem:

```text
HTTP / Messaging / Scheduler / CLI
          |
          v
Application Service Layer
          |
          v
Transaction Boundary
          |
          v
Hibernate ORM
          |
          v
Datasource / Agroal Pool
          |
          v
JDBC Driver
          |
          v
Database
```

Namun di Quarkus, hubungan ini tidak hanya runtime dependency. Ia dikonstruksi oleh extension model.

```text
quarkus-hibernate-orm extension
  -> discovers entity classes
  -> integrates with Arc/CDI
  -> integrates with datasource extension
  -> integrates with Narayana/JTA
  -> contributes native-image metadata
  -> contributes health/metrics depending extensions
  -> builds persistence unit model
```

Dengan kata lain, Hibernate ORM di Quarkus adalah hasil koordinasi beberapa extension:

- `quarkus-hibernate-orm`
- `quarkus-jdbc-*`
- `quarkus-agroal`
- `quarkus-narayana-jta`
- optional: `quarkus-hibernate-validator`
- optional: `quarkus-flyway` / `quarkus-liquibase`
- optional: `quarkus-micrometer` / OpenTelemetry
- optional: `quarkus-smallrye-health`
- optional: `quarkus-hibernate-orm-panache`

Hal ini berbeda dari aplikasi Java biasa yang secara manual mengatur banyak wiring sendiri.

---

## 3. Quarkus Hibernate ORM vs “Vanilla Hibernate”

### 3.1 Vanilla Hibernate Mental Model

Dalam vanilla Hibernate, kamu sering berpikir seperti ini:

```text
I configure Hibernate.
Hibernate scans/mapping happens at runtime.
I manage SessionFactory/EntityManagerFactory.
I configure transaction/pool integration.
Application controls bootstrap shape.
```

### 3.2 Quarkus Hibernate Mental Model

Di Quarkus:

```text
Quarkus extension model owns bootstrap.
Application declares intent through dependencies, config, annotations.
Quarkus builds an optimized persistence model.
Runtime receives a prepared model.
```

Artinya, kamu tidak bebas memperlakukan Hibernate seperti library yang bisa dikonfigurasi secara arbitrary kapan pun. Banyak keputusan harus cocok dengan Quarkus build-time model.

Contoh:

- entity harus discoverable,
- dependency module harus terindeks,
- persistence unit harus cocok dengan datasource,
- config tertentu tidak bisa diubah setelah artifact dibuild,
- reflection-heavy customization perlu diperhatikan,
- native-image mode membutuhkan metadata yang cukup.

---

## 4. Apa yang Tidak Boleh Disalahpahami

### Salah Paham 1 — “Quarkus cuma lebih cepat startup karena ringan”

Kurang tepat.

Quarkus cepat bukan hanya karena dependency sedikit, tetapi karena banyak pekerjaan framework dipindah dari runtime ke build-time.

Dalam konteks Hibernate ORM:

- metadata diproses lebih awal,
- entity ditemukan melalui index,
- konfigurasi runtime dipersempit,
- integrasi extension dipersiapkan saat build,
- native-image metadata dapat disiapkan.

### Salah Paham 2 — “Kalau pakai Quarkus, semua query otomatis cepat”

Salah.

Quarkus tidak menghapus hukum dasar database:

- query buruk tetap buruk,
- missing index tetap mahal,
- N+1 tetap terjadi,
- transaksi panjang tetap berbahaya,
- lock contention tetap bisa membunuh throughput,
- connection pool tetap bisa habis,
- SQL generated ORM tetap harus dibaca.

Quarkus mempercepat boot/runtime envelope, bukan mengubah database menjadi magic.

### Salah Paham 3 — “Native image membuat database access lebih cepat”

Tidak otomatis.

Native image biasanya membantu:

- startup time,
- cold start,
- memory footprint,
- container density.

Tetapi query latency tetap dominan oleh:

- network,
- database CPU/IO,
- lock,
- index,
- execution plan,
- connection pool wait,
- transaction design.

### Salah Paham 4 — “Entity bisa dipakai sebagai API response supaya cepat delivery”

Kadang bisa untuk demo. Untuk production enterprise, sering menjadi utang desain.

Risikonya:

- lazy initialization leak,
- accidental overexposure field,
- bidirectional recursion,
- breaking API saat entity berubah,
- security/data masking susah,
- audit/control boundary kabur,
- query shape tidak explicit.

---

## 5. Dependency Dasar

Untuk Hibernate ORM blocking JDBC di Quarkus, dependency minimal biasanya:

```xml
<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-hibernate-orm</artifactId>
</dependency>

<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-jdbc-postgresql</artifactId>
</dependency>
```

Untuk REST + JSON + validation + migration, service real-world biasanya menambah:

```xml
<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-rest</artifactId>
</dependency>

<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-rest-jackson</artifactId>
</dependency>

<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-hibernate-validator</artifactId>
</dependency>

<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-flyway</artifactId>
</dependency>
```

Untuk Panache:

```xml
<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-hibernate-orm-panache</artifactId>
</dependency>
```

Namun Part 010 tidak fokus pada Panache. Panache akan dibahas lebih dalam di Part 011.

---

## 6. Konfigurasi Datasource Dasar

Contoh PostgreSQL:

```properties
quarkus.datasource.db-kind=postgresql
quarkus.datasource.username=app_user
quarkus.datasource.password=${DB_PASSWORD}
quarkus.datasource.jdbc.url=jdbc:postgresql://localhost:5432/appdb

quarkus.hibernate-orm.database.generation=none
quarkus.hibernate-orm.log.sql=false
```

Untuk development lokal:

```properties
%dev.quarkus.datasource.devservices.enabled=true
%dev.quarkus.hibernate-orm.database.generation=drop-and-create
%dev.quarkus.hibernate-orm.log.sql=true
```

Untuk test:

```properties
%test.quarkus.datasource.devservices.enabled=true
%test.quarkus.hibernate-orm.database.generation=drop-and-create
%test.quarkus.hibernate-orm.log.sql=true
```

Untuk production:

```properties
%prod.quarkus.hibernate-orm.database.generation=none
%prod.quarkus.hibernate-orm.validate-in-dev-mode=false
```

Catatan:

> Production schema sebaiknya dikelola oleh migration tool seperti Flyway/Liquibase, bukan oleh Hibernate auto DDL.

---

## 7. Datasource, Agroal, dan JDBC Driver

Quarkus menggunakan model konfigurasi datasource terpadu. Untuk blocking Hibernate ORM, akses database melewati JDBC datasource dan connection pool Agroal.

```text
Hibernate ORM
  -> JDBC datasource
  -> Agroal pool
  -> JDBC driver
  -> database
```

### 7.1 Kenapa Pool Penting

Pool bukan sekadar cache koneksi. Pool adalah concurrency gate antara aplikasi dan database.

Misalnya:

```text
HTTP requests: 300 concurrent
worker threads: 200
DB max connections available to service: 40
pool max-size: 40
```

Kalau 300 request semuanya butuh DB, hanya 40 yang bisa memegang connection secara bersamaan. Sisanya menunggu.

Ini bukan bug. Ini backpressure.

Yang berbahaya adalah ketika engineer tidak sadar bahwa request latency sebenarnya bukan query latency, tetapi:

```text
total request latency
  = queue before worker
  + wait for DB connection
  + transaction time
  + query execution time
  + result mapping time
  + serialization time
```

Dalam incident production, connection pool wait sering menjadi indikator lebih penting daripada average query time.

### 7.2 Pool Size Mental Model

Pool terlalu kecil:

- throughput rendah,
- request menunggu connection,
- timeout meningkat,
- worker thread tertahan.

Pool terlalu besar:

- database connection membengkak,
- DB context switching naik,
- lock contention meningkat,
- memory DB naik,
- tail latency memburuk,
- satu service bisa menghabiskan DB resource untuk service lain.

Rule of thumb awal:

```text
pool size should be sized from database capacity, not application desire
```

Jangan mulai dari “aplikasi butuh 200 thread”. Mulai dari:

- DB max connection,
- jumlah service/pod,
- jumlah replica,
- workload per endpoint,
- query duration,
- transaction duration,
- peak traffic,
- timeout budget.

Contoh:

```text
DB max connections for app ecosystem: 300
reserved for admin/maintenance: 30
remaining: 270
service A replicas: 6
service B replicas: 3
service C replicas: 3

If equal distribution:
  270 / 12 = 22.5 connections per pod
```

Tentu production biasanya tidak equal. Service dengan critical write path mungkin diberi quota lebih besar.

### 7.3 Contoh Konfigurasi Agroal

```properties
quarkus.datasource.jdbc.min-size=5
quarkus.datasource.jdbc.max-size=30
quarkus.datasource.jdbc.acquisition-timeout=5S
quarkus.datasource.jdbc.background-validation-interval=2M
quarkus.datasource.jdbc.idle-removal-interval=5M
quarkus.datasource.jdbc.max-lifetime=30M
```

Penjelasan desain:

- `min-size`: jumlah koneksi minimum yang dipertahankan.
- `max-size`: batas concurrency DB per pod.
- `acquisition-timeout`: berapa lama request menunggu connection sebelum gagal.
- `background-validation-interval`: validasi koneksi idle.
- `idle-removal-interval`: membersihkan koneksi idle.
- `max-lifetime`: membatasi umur koneksi agar tidak terlalu lama hidup.

Prinsip penting:

> Acquisition timeout bukan hanya angka teknis. Itu bagian dari resilience contract.

Kalau timeout terlalu lama, request menumpuk dan user menunggu lama. Kalau terlalu pendek, aplikasi cepat gagal padahal DB masih bisa melayani dengan delay sedikit. Nilainya harus selaras dengan API timeout budget.

---

## 8. Persistence Unit di Quarkus

Dalam JPA tradisional, kamu sering bertemu `persistence.xml`. Di Quarkus, konfigurasi umumnya dilakukan melalui `application.properties`, bukan `persistence.xml` manual.

Default persistence unit biasanya cukup:

```properties
quarkus.datasource.db-kind=postgresql
quarkus.datasource.jdbc.url=jdbc:postgresql://localhost:5432/appdb
quarkus.datasource.username=app_user
quarkus.datasource.password=secret

quarkus.hibernate-orm.database.generation=none
```

### 8.1 Named Persistence Unit

Untuk multi-database/multi-persistence-unit, kamu bisa punya konfigurasi bernama:

```properties
quarkus.datasource.users.db-kind=postgresql
quarkus.datasource.users.jdbc.url=jdbc:postgresql://localhost:5432/usersdb
quarkus.datasource.users.username=users_app
quarkus.datasource.users.password=${USERS_DB_PASSWORD}

quarkus.datasource.billing.db-kind=postgresql
quarkus.datasource.billing.jdbc.url=jdbc:postgresql://localhost:5432/billingdb
quarkus.datasource.billing.username=billing_app
quarkus.datasource.billing.password=${BILLING_DB_PASSWORD}

quarkus.hibernate-orm.users.datasource=users
quarkus.hibernate-orm.users.packages=com.example.users.domain

quarkus.hibernate-orm.billing.datasource=billing
quarkus.hibernate-orm.billing.packages=com.example.billing.domain
```

### 8.2 Kapan Multiple Persistence Unit Masuk Akal?

Masuk akal jika:

- database benar-benar berbeda ownership,
- schema lifecycle berbeda,
- transaction boundary berbeda,
- domain boundary jelas,
- deployment tetap satu service karena alasan operasional,
- ada migration dari legacy database.

Tidak masuk akal jika hanya karena:

- package ingin dipisah,
- developer ingin grouping entity,
- menghindari desain module,
- meniru monolith lama.

### 8.3 Risiko Multiple Persistence Unit

Risikonya:

- transaction menjadi lebih kompleks,
- query lintas unit tidak natural,
- migration lebih rumit,
- testing lebih berat,
- config lebih mudah salah,
- native image metadata lebih luas,
- pool capacity harus dihitung per datasource,
- hidden distributed transaction temptation.

Top-tier engineer tidak menilai multi datasource dari “bisa atau tidak”, tetapi dari **operational consequence**.

---

## 9. Entity Discovery dan Jandex Index

Quarkus menggunakan Jandex index untuk menemukan metadata annotation secara efisien. Dalam aplikasi sederhana, entity di module aplikasi biasanya otomatis ditemukan.

Namun di multi-module project, entity yang berada di external module/library bisa tidak terlihat jika dependency tersebut tidak terindeks.

Contoh struktur:

```text
app-service
  depends on domain-model.jar

in domain-model.jar:
  com.example.case.domain.CaseRecordEntity
  com.example.case.domain.CaseTransitionEntity
```

Jika `domain-model.jar` tidak punya Jandex index, Quarkus bisa gagal menemukan entity atau annotation tertentu.

### 9.1 Solusi Umum

Tambahkan Jandex plugin di module domain:

```xml
<plugin>
  <groupId>io.smallrye</groupId>
  <artifactId>jandex-maven-plugin</artifactId>
  <version>${jandex.plugin.version}</version>
  <executions>
    <execution>
      <id>make-index</id>
      <goals>
        <goal>jandex</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Atau daftar dependency yang perlu di-index melalui konfigurasi Quarkus jika sesuai.

### 9.2 Anti-Pattern

```text
shared-domain.jar
  contains 200 entities from multiple services
  used by 15 services
```

Masalah:

- semua service membawa entity yang tidak dipakai,
- mapping model membesar,
- coupling lintas service naik,
- schema ownership kabur,
- startup/build complexity naik,
- native image footprint naik,
- perubahan satu entity bisa berdampak ke banyak service.

Shared entity library adalah salah satu sumber coupling paling berbahaya di microservice Java.

Lebih baik:

```text
service-a-domain
service-b-domain
shared-kernel-small
```

Shared kernel hanya berisi value object yang stabil, bukan seluruh entity database.

---

## 10. Build-Time Enhancement dan Entity Design

Hibernate melakukan enhancement untuk mendukung fitur seperti lazy loading, dirty tracking, dan association management. Di Quarkus, proses ini diselaraskan dengan build-time model.

### 10.1 Apa yang Perlu Dipahami

Entity bukan POJO bebas tanpa konsekuensi. Entity adalah object yang:

- punya identity,
- dikelola persistence context,
- bisa diproxy/enhanced,
- ikut dirty checking,
- punya lifecycle callback,
- terikat transaction/session,
- punya mapping ke schema.

Di Quarkus, entity juga bagian dari build artifact.

### 10.2 Praktik Entity Design yang Lebih Aman

Gunakan entity sebagai persistence model, bukan API model.

```java
@Entity
@Table(name = "case_record")
public class CaseRecordEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "case_no", nullable = false, unique = true, length = 64)
    public String caseNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    public CaseStatus status;

    @Version
    public long version;
}
```

Untuk service/domain operation:

```java
@ApplicationScoped
public class CaseTransitionService {

    @Inject
    EntityManager em;

    @Transactional
    public void submit(String caseNo, String actorUserId) {
        CaseRecordEntity entity = em.createQuery("""
            select c
            from CaseRecordEntity c
            where c.caseNo = :caseNo
            """, CaseRecordEntity.class)
            .setParameter("caseNo", caseNo)
            .getSingleResult();

        if (entity.status != CaseStatus.DRAFT) {
            throw new InvalidCaseTransitionException(entity.status, CaseStatus.SUBMITTED);
        }

        entity.status = CaseStatus.SUBMITTED;
        entity.lastUpdatedBy = actorUserId;
        entity.lastUpdatedAt = Instant.now();
    }
}
```

Catatan:

- `@Transactional` di service, bukan di resource jika logic kompleks.
- Entity mutation dilakukan di transaction boundary yang jelas.
- Version digunakan untuk optimistic locking.
- Domain rule eksplisit, bukan tersebar di controller.

---

## 11. Entity Field Access vs Getter/Setter

Quarkus dan Hibernate mendukung berbagai style. Dalam Panache, public field sering digunakan karena Panache melakukan accessor rewrite. Dalam Hibernate ORM biasa, kamu bisa tetap pakai private field + getter/setter.

Untuk enterprise domain kompleks, saya lebih menyarankan:

```java
@Entity
@Table(name = "case_record")
public class CaseRecordEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String caseNo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CaseStatus status;

    @Version
    private long version;

    protected CaseRecordEntity() {
        // for Hibernate
    }

    public CaseRecordEntity(String caseNo) {
        this.caseNo = Objects.requireNonNull(caseNo);
        this.status = CaseStatus.DRAFT;
    }

    public void submit() {
        if (status != CaseStatus.DRAFT) {
            throw new InvalidCaseTransitionException(status, CaseStatus.SUBMITTED);
        }
        status = CaseStatus.SUBMITTED;
    }

    public Long id() {
        return id;
    }

    public String caseNo() {
        return caseNo;
    }

    public CaseStatus status() {
        return status;
    }
}
```

Kenapa?

- invariant bisa dijaga,
- tidak semua field bebas diubah,
- domain transition lebih jelas,
- entity tidak sekadar data bag,
- audit dan state machine lebih mudah dikontrol.

Namun hati-hati: entity yang terlalu “DDD pure” kadang bertabrakan dengan ORM lifecycle. Jangan pakai constructor/logic yang mengasumsikan dependency injection di entity.

Entity bukan CDI bean.

---

## 12. Persistence Context di Quarkus

Persistence context adalah unit of work di mana entity instance dikelola.

Mental model:

```text
transaction begins
  -> EntityManager participates
  -> query loads entity
  -> entity becomes managed
  -> code mutates entity
  -> dirty checking detects changes
  -> flush generates SQL
transaction commits
  -> DB commit
  -> persistence context ends
```

Di Quarkus REST request, biasanya persistence context terkait dengan transaction boundary jika menggunakan Hibernate ORM blocking.

### 12.1 Managed vs Detached

Managed:

```java
@Transactional
public void updateName(Long id, String name) {
    CustomerEntity customer = em.find(CustomerEntity.class, id);
    customer.name = name;
    // no explicit save required for managed entity
}
```

Detached:

```java
CustomerEntity customer = service.findOutsideTransaction(id);
customer.name = "new name";
// not automatically saved unless merged inside transaction
```

Anti-pattern umum:

```java
// resource layer receives entity from request body
// then blindly merge
em.merge(entityFromHttpRequest);
```

Masalah:

- overposting vulnerability,
- field yang tidak boleh diedit bisa berubah,
- ownership check terlewat,
- version conflict tidak ditangani benar,
- entity graph accidental update.

Lebih aman:

```java
public record UpdateCustomerRequest(String name, String email) {}

@Transactional
public void updateCustomer(Long id, UpdateCustomerRequest request, UserContext user) {
    CustomerEntity customer = em.find(CustomerEntity.class, id);
    authorization.checkCanUpdate(user, customer);
    customer.changeName(request.name());
    customer.changeEmail(request.email());
}
```

---

## 13. Transaction Boundary: Resource, Service, atau Repository?

Pertanyaan penting:

> Di mana `@Transactional` seharusnya diletakkan?

Jawaban singkat:

> Letakkan di boundary use-case/application service, bukan otomatis di semua repository method.

### 13.1 Resource-Level Transaction

```java
@Path("/cases")
public class CaseResource {

    @Inject
    CaseRepository repository;

    @POST
    @Transactional
    public Response create(CreateCaseRequest request) {
        repository.persist(...);
        return Response.status(201).build();
    }
}
```

Cocok untuk CRUD sederhana.

Masalah jika logic kompleks:

- HTTP concern bercampur transaction concern,
- sulit reuse dari messaging/scheduler,
- audit/event/outbox boundary tidak jelas,
- error mapping bisa blur,
- transaction bisa mencakup serialization/response logic kalau tidak hati-hati.

### 13.2 Repository-Level Transaction

```java
@ApplicationScoped
public class CaseRepository {

    @Transactional
    public void save(CaseRecordEntity entity) {
        em.persist(entity);
    }
}
```

Sering terlihat rapi, tapi bisa salah.

Masalah:

```java
service.doUseCase() {
  repo.save(case)
  repo.save(audit)
  repo.save(outbox)
}
```

Kalau masing-masing repository membuka transaction sendiri, use-case tidak atomic.

### 13.3 Service-Level Transaction

```java
@ApplicationScoped
public class CaseSubmissionService {

    @Inject
    CaseRepository caseRepository;

    @Inject
    AuditRepository auditRepository;

    @Inject
    OutboxRepository outboxRepository;

    @Transactional
    public SubmitCaseResult submit(SubmitCaseCommand command) {
        CaseRecordEntity caseRecord = caseRepository.getByCaseNo(command.caseNo());
        caseRecord.submit(command.actor());

        auditRepository.append(AuditEvent.caseSubmitted(caseRecord, command.actor()));
        outboxRepository.append(IntegrationEvent.caseSubmitted(caseRecord));

        return new SubmitCaseResult(caseRecord.caseNo(), caseRecord.status());
    }
}
```

Ini lebih baik untuk use-case nyata.

Invariants:

- satu use-case = satu consistency boundary,
- transaction mencakup semua mutation yang harus atomic,
- repository tidak menentukan use-case atomicity,
- resource/messaging/scheduler memanggil service yang sama.

---

## 14. Transaction dan Flush Timing

Hibernate tidak selalu langsung mengirim SQL saat field entity berubah.

```java
@Transactional
public void update(Long id) {
    CaseRecordEntity entity = em.find(CaseRecordEntity.class, id);
    entity.status = CaseStatus.SUBMITTED;
    // SQL update may not run here yet
}
```

SQL biasanya dikirim saat:

- transaction commit,
- explicit `flush()`,
- sebelum query tertentu yang membutuhkan konsistensi,
- batch boundary tertentu.

### 14.1 Kenapa Flush Timing Penting?

Karena error database bisa muncul belakangan.

Contoh:

```java
@Transactional
public void createUser(CreateUserCommand command) {
    UserEntity user = new UserEntity(command.email());
    em.persist(user);

    auditRepository.append(...);

    // unique constraint violation may happen at commit, not persist line
}
```

Jika kamu ingin menangani constraint violation di titik tertentu, kadang perlu `flush()`:

```java
@Transactional
public void createUser(CreateUserCommand command) {
    UserEntity user = new UserEntity(command.email());
    em.persist(user);

    try {
        em.flush();
    } catch (PersistenceException e) {
        throw new DuplicateEmailException(command.email(), e);
    }

    auditRepository.append(...);
}
```

Namun jangan overuse `flush()`. Terlalu sering flush bisa:

- mengurangi batching,
- menambah roundtrip,
- membuat transaction lebih lambat,
- memperbesar lock duration.

### 14.2 Flush Sebagai Design Signal

Kalau kamu sering butuh explicit flush, tanyakan:

- Apakah error handling contract terlalu bergantung pada DB exception?
- Apakah constraint harus dicek dengan query lebih dulu?
- Apakah use-case terlalu besar?
- Apakah transaction boundary terlalu luas?
- Apakah perlu unique command/idempotency key?

---

## 15. Query Shape: ORM Tidak Menghapus Kewajiban Membaca SQL

Top 1% engineer tidak mempercayai ORM secara buta. Ia membaca SQL yang dihasilkan.

Aktifkan SQL log di dev/test:

```properties
%dev.quarkus.hibernate-orm.log.sql=true
%dev.quarkus.hibernate-orm.format-sql=true
%test.quarkus.hibernate-orm.log.sql=true
%test.quarkus.hibernate-orm.format-sql=true
```

Namun di production, SQL log penuh biasanya tidak aman:

- overhead tinggi,
- log volume besar,
- data sensitif bisa bocor,
- sulit dikorelasikan,
- query parameter bisa mengandung PII.

Untuk production, lebih baik:

- metrics query latency,
- slow query log database,
- tracing span untuk repository/use-case,
- sampling log,
- query fingerprint,
- alert untuk pool wait/timeout,
- database execution plan monitoring.

---

## 16. N+1 di Quarkus: Masalah Lama, Konsekuensi Baru

N+1 tetap N+1.

Contoh:

```java
List<CaseRecordEntity> cases = em.createQuery("""
    select c from CaseRecordEntity c
    where c.status = :status
    """, CaseRecordEntity.class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .getResultList();

for (CaseRecordEntity c : cases) {
    log.info(c.getApplicant().getName());
}
```

Jika `applicant` lazy, bisa terjadi:

```text
1 query for cases
N queries for applicant
```

### 16.1 Solusi Bukan Selalu `fetch join`

Fetch join:

```java
select c
from CaseRecordEntity c
join fetch c.applicant
where c.status = :status
```

Cocok jika:

- association memang dibutuhkan,
- cardinality aman,
- pagination tidak rusak,
- row multiplication terkendali.

Namun fetch join bisa buruk jika:

- join ke collection besar,
- pagination one-to-many,
- multiple bag fetch,
- menghasilkan duplikasi row besar,
- memory membengkak.

### 16.2 DTO Projection Sering Lebih Baik

Untuk listing:

```java
public record CaseListItem(
    String caseNo,
    String applicantName,
    CaseStatus status,
    Instant submittedAt
) {}
```

Query:

```java
List<CaseListItem> items = em.createQuery("""
    select new com.example.case.api.CaseListItem(
        c.caseNo,
        a.name,
        c.status,
        c.submittedAt
    )
    from CaseRecordEntity c
    join c.applicant a
    where c.status = :status
    order by c.submittedAt desc
    """, CaseListItem.class)
    .setParameter("status", CaseStatus.SUBMITTED)
    .setMaxResults(50)
    .getResultList();
```

Keuntungan:

- SQL shape explicit,
- field minimal,
- serialization aman,
- no lazy leak,
- API contract stabil,
- memory lebih kecil,
- tidak memuat aggregate besar.

Ingat:

> Entity graph cocok untuk use-case mutation/detail. DTO projection cocok untuk read/listing/reporting.

---

## 17. Lazy Loading dan REST Boundary

Lazy loading paling sering bocor di REST response.

Anti-pattern:

```java
@GET
@Path("/{id}")
public CaseRecordEntity get(Long id) {
    return em.find(CaseRecordEntity.class, id);
}
```

Masalah:

- serialization bisa trigger lazy loading,
- session sudah tertutup,
- cyclic relationship,
- sensitive field exposed,
- generated JSON tidak terkendali,
- query terjadi saat response rendering.

Lebih aman:

```java
@GET
@Path("/{caseNo}")
public CaseDetailResponse get(String caseNo) {
    return caseQueryService.getDetail(caseNo);
}
```

```java
@ApplicationScoped
public class CaseQueryService {

    @Inject
    EntityManager em;

    public CaseDetailResponse getDetail(String caseNo) {
        return em.createQuery("""
            select new com.example.case.api.CaseDetailResponse(
                c.caseNo,
                c.status,
                a.name,
                c.submittedAt
            )
            from CaseRecordEntity c
            join c.applicant a
            where c.caseNo = :caseNo
            """, CaseDetailResponse.class)
            .setParameter("caseNo", caseNo)
            .getSingleResult();
    }
}
```

Rule:

```text
Never let JSON serialization decide your database query plan.
```

---

## 18. Read Model vs Write Model

Dalam sistem kompleks, terutama workflow/case management, satu model entity jarang optimal untuk semua kebutuhan.

Write model:

- menjaga invariant,
- mutation controlled,
- transaction safe,
- aggregate boundary jelas,
- optimistic locking,
- audit/outbox.

Read model:

- listing cepat,
- filtering/searching,
- projection ringan,
- join sesuai UI,
- bisa denormalized,
- bisa pakai view/materialized view/search index.

Contoh:

```text
Write use-case:
  CaseRecordEntity
  CaseAssignmentEntity
  CaseTransitionEntity
  CaseAuditEntity

Read listing:
  CaseInboxItemProjection
  CaseSearchResultProjection
  CaseAgingReportProjection
```

Quarkus tidak memaksa CQRS, tetapi persistence design yang matang sering memisahkan query model dari mutation model.

---

## 19. Optimistic Locking dan Workflow State

Untuk workflow/case lifecycle, `@Version` hampir selalu penting.

```java
@Entity
public class CaseRecordEntity {

    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    public void approve(UserId actor) {
        if (status != CaseStatus.PENDING_APPROVAL) {
            throw new InvalidTransitionException(status, CaseStatus.APPROVED);
        }
        status = CaseStatus.APPROVED;
    }
}
```

Race scenario:

```text
Officer A loads case version 10
Officer B loads case version 10
Officer A approves -> update where id=? and version=10 -> success, version 11
Officer B rejects  -> update where id=? and version=10 -> 0 rows updated -> optimistic lock failure
```

This is good.

Tanpa optimistic locking:

```text
last commit wins
workflow state corrupted
regulatory defensibility weak
```

### 19.1 Error Contract

Jangan expose `OptimisticLockException` mentah.

Buat error domain:

```json
{
  "code": "CASE_CONCURRENTLY_MODIFIED",
  "message": "The case was modified by another user. Please reload and try again.",
  "caseNo": "EA-2026-000123"
}
```

### 19.2 Pessimistic Locking

Pessimistic locking bisa dipakai untuk operasi tertentu:

```java
CaseRecordEntity entity = em.find(
    CaseRecordEntity.class,
    id,
    LockModeType.PESSIMISTIC_WRITE
);
```

Namun hati-hati:

- lock duration naik,
- deadlock risk naik,
- throughput turun,
- user interaction tidak boleh memegang lock,
- timeout harus jelas.

Gunakan untuk short critical section, bukan long human workflow.

---

## 20. Transaction Duration dan Human Workflow

Salah satu kesalahan besar di workflow system:

```text
open transaction
  load case
  call external service
  wait remote API
  write audit
  send email
commit
```

Ini buruk.

Kenapa?

- DB connection dipegang terlalu lama,
- lock duration naik,
- external latency masuk transaction,
- retry jadi berbahaya,
- timeout tidak jelas,
- partial failure sulit dipulihkan,
- pool bisa habis.

Lebih baik:

```text
transaction 1:
  validate state
  persist transition intent
  write outbox event
commit

async worker:
  send email / call external API
  update integration status if needed
```

Atau:

```text
call external first only if idempotent and no DB lock held
then transaction for local mutation
```

Tetapi harus hati-hati dengan consistency.

Rule:

```text
Do not hold database transactions while waiting for unreliable external systems.
```

---

## 21. Repository Design di Quarkus

Repository sebaiknya bukan sekadar wrapper `EntityManager` tanpa nilai.

Bad repository:

```java
@ApplicationScoped
public class CaseRepository {
    @Inject EntityManager em;

    public CaseRecordEntity find(Long id) {
        return em.find(CaseRecordEntity.class, id);
    }

    public void persist(CaseRecordEntity entity) {
        em.persist(entity);
    }
}
```

Ini tidak salah, tapi hampir tidak memberi abstraksi.

Better repository:

```java
@ApplicationScoped
public class CaseRepository {

    @Inject
    EntityManager em;

    public Optional<CaseRecordEntity> findByCaseNo(CaseNo caseNo) {
        return em.createQuery("""
            select c
            from CaseRecordEntity c
            where c.caseNo = :caseNo
            """, CaseRecordEntity.class)
            .setParameter("caseNo", caseNo.value())
            .getResultStream()
            .findFirst();
    }

    public CaseRecordEntity getByCaseNo(CaseNo caseNo) {
        return findByCaseNo(caseNo)
            .orElseThrow(() -> new CaseNotFoundException(caseNo));
    }

    public List<CaseInboxItem> findInbox(CaseInboxFilter filter, PageRequest page) {
        return em.createQuery("""
            select new com.example.case.query.CaseInboxItem(
                c.caseNo,
                c.status,
                c.submittedAt,
                a.name
            )
            from CaseRecordEntity c
            join c.applicant a
            where c.assignedOfficerId = :officerId
            order by c.submittedAt desc
            """, CaseInboxItem.class)
            .setParameter("officerId", filter.officerId().value())
            .setFirstResult(page.offset())
            .setMaxResults(page.size())
            .getResultList();
    }
}
```

Repository harus mengandung:

- domain-specific lookup,
- explicit query shape,
- error semantics,
- pagination strategy,
- lock strategy jika perlu,
- projection query,
- no HTTP concern,
- no transaction ownership jika service yang punya use-case.

---

## 22. EntityManager Injection

Quarkus mendukung injection `EntityManager`:

```java
@Inject
EntityManager em;
```

Gunakan di CDI bean seperti repository/service.

Jangan simpan entity manager di static field. Jangan membuat entity manager factory manual kecuali kamu benar-benar punya alasan advanced.

Anti-pattern:

```java
public class JpaUtil {
    static EntityManagerFactory emf = Persistence.createEntityManagerFactory("default");
}
```

Di Quarkus, ini melawan bootstrap model.

Gunakan model managed by Quarkus.

---

## 23. Schema Generation: Dev Convenience vs Production Safety

Hibernate bisa generate schema:

```properties
quarkus.hibernate-orm.database.generation=drop-and-create
```

Cocok untuk:

- local dev,
- throwaway tests,
- simple demo,
- early prototype.

Tidak cocok untuk production.

Production:

```properties
%prod.quarkus.hibernate-orm.database.generation=none
```

Gunakan Flyway/Liquibase:

```properties
quarkus.flyway.migrate-at-start=true
quarkus.flyway.locations=db/migration
```

Namun untuk enterprise regulated systems, bahkan `migrate-at-start=true` perlu dipertimbangkan.

### 23.1 Migration at Startup: Trade-off

Keuntungan:

- deployment self-contained,
- schema migrasi otomatis,
- environment lebih konsisten.

Risiko:

- multiple pods race migration,
- long migration memperlambat startup,
- failed migration menyebabkan service tidak naik,
- rollback kompleks,
- DBA approval process mungkin dilanggar,
- migration destructive bisa terjadi saat deploy.

Untuk production ketat:

```text
pipeline stage:
  validate migration
  backup/snapshot if needed
  apply migration as controlled job
  verify schema
  deploy app
```

App startup sebaiknya validate compatibility, bukan selalu mutate schema.

---

## 24. Database Generation Strategy dan ID Strategy

ID generation mempengaruhi batching dan database performance.

### 24.1 Identity

```java
@GeneratedValue(strategy = GenerationType.IDENTITY)
```

Mudah, tapi sering membatasi batching karena ID didapat setelah insert.

### 24.2 Sequence

```java
@SequenceGenerator(
    name = "case_seq",
    sequenceName = "case_seq",
    allocationSize = 50
)
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_seq")
```

Sequence dengan allocation size bisa lebih efisien untuk batch insert.

### 24.3 UUID

UUID cocok untuk:

- distributed ID,
- client-generated ID,
- idempotency,
- external reference.

Namun UUID sebagai primary key bisa berdampak pada index locality, tergantung database dan tipe UUID.

### 24.4 Business Key

Untuk workflow/regulatory system, sering ada business key:

```text
internal id: 102938
business key: EA-2026-000123
```

Gunakan keduanya:

- surrogate id untuk relational reference,
- business key untuk user-facing identity,
- unique constraint untuk business key.

Jangan mengandalkan business key sebagai satu-satunya internal PK jika formatnya bisa berubah.

---

## 25. Batch Insert/Update dengan Hibernate ORM

Untuk batch workload:

```properties
quarkus.hibernate-orm.jdbc.statement-batch-size=50
```

Namun batching hanya efektif jika:

- ID strategy mendukung,
- flush/clear dilakukan per chunk,
- transaction size terkendali,
- entity graph tidak terlalu besar,
- memory persistence context tidak membengkak.

Contoh:

```java
@Transactional
public void importRows(List<ImportRow> rows) {
    int i = 0;

    for (ImportRow row : rows) {
        em.persist(toEntity(row));

        if (++i % 50 == 0) {
            em.flush();
            em.clear();
        }
    }
}
```

Tapi hati-hati:

- `clear()` membuat entity detached,
- relationship ke entity sebelumnya harus dikelola,
- error partial chunk harus punya recovery strategy,
- transaction terlalu besar bisa tetap berisiko.

Untuk import besar, pertimbangkan:

- chunked transaction,
- staging table,
- database-native bulk load,
- asynchronous job,
- idempotent import key,
- progress tracking.

---

## 26. Pagination yang Benar

Offset pagination:

```java
query.setFirstResult(page * size);
query.setMaxResults(size);
```

Mudah, tetapi buruk untuk page dalam:

```sql
offset 100000 limit 50
```

Database tetap harus melewati banyak row.

Keyset pagination lebih baik untuk scrolling:

```sql
where submitted_at < :lastSubmittedAt
order by submitted_at desc
limit 50
```

Dalam JPQL:

```java
List<CaseInboxItem> items = em.createQuery("""
    select new com.example.case.query.CaseInboxItem(
        c.caseNo,
        c.status,
        c.submittedAt
    )
    from CaseRecordEntity c
    where c.assignedOfficerId = :officerId
      and (:cursorSubmittedAt is null or c.submittedAt < :cursorSubmittedAt)
    order by c.submittedAt desc, c.id desc
    """, CaseInboxItem.class)
    .setParameter("officerId", officerId)
    .setParameter("cursorSubmittedAt", cursorSubmittedAt)
    .setMaxResults(50)
    .getResultList();
```

Production checklist:

- deterministic order,
- tie-breaker column,
- index matches filter + sort,
- cursor encoded safely,
- count query optional, not always required,
- no fetch join collection with pagination.

---

## 27. Count Query Trap

UI sering meminta:

```text
page 1 of 38291
```

Count query untuk table besar bisa mahal.

```sql
select count(*) from huge_case_table where complex_filter...
```

Alternatif:

- show “has next page” only,
- approximate count,
- cached count,
- async count,
- search engine/read model,
- materialized summary.

Top-tier design question:

> Apakah user benar-benar butuh exact count real-time, atau UI hanya meniru pattern lama?

---

## 28. Query Timeout dan Statement Timeout

Connection pool timeout bukan query timeout.

```text
pool acquisition timeout: waiting to get connection
query timeout: SQL execution too long
transaction timeout: transaction open too long
HTTP timeout: client waiting too long
```

Mereka harus selaras.

Contoh timeout budget:

```text
API gateway timeout: 30s
service HTTP server timeout: 25s
transaction timeout: 20s
DB statement timeout: 15s
pool acquisition timeout: 3s
```

Jika DB statement timeout lebih panjang dari API timeout, request bisa sudah gagal di client tetapi query masih berjalan di DB.

Quarkus transaction timeout bisa dikontrol melalui transaction config/annotation/programmatic API, sedangkan DB statement timeout kadang perlu driver/database-level config.

---

## 29. Transaction Timeout

Untuk use-case tertentu:

```java
@Transactional
public void process() {
    ...
}
```

Quarkus juga menyediakan programmatic transaction API:

```java
QuarkusTransaction.requiringNew()
    .timeout(10)
    .run(() -> {
        // work
    });
```

Gunakan transaction timeout sebagai guardrail.

Jangan biarkan transaksi menggantung karena:

- remote call lambat,
- query tidak punya index,
- deadlock,
- lock wait,
- batch terlalu besar,
- connection leak.

---

## 30. Connection Leak dan Statement Leak

Connection leak terjadi ketika connection tidak dikembalikan ke pool. Dengan Hibernate ORM managed oleh Quarkus, leak manual lebih jarang jika kamu tidak membuka connection sendiri.

Namun leak bisa terjadi dari:

- unwrap connection lalu tidak tutup resource,
- native JDBC manual,
- streaming result tidak ditutup,
- transaction menggantung,
- blocking operation terlalu lama.

Statement leak bisa terjadi jika statement/resultset tidak ditutup.

Quarkus/Agroal memiliki opsi deteksi statement leak. Gunakan di dev/test atau saat troubleshooting, tetapi pahami overhead-nya.

---

## 31. Open Session in View: Jangan Dijadikan Default Mental Model

Di beberapa stack, ada pattern Open Session in View: session/persistence context tetap terbuka sampai view rendering selesai.

Untuk REST API modern, ini sering buruk.

Masalah:

- serialization bisa trigger query,
- query plan tidak eksplisit,
- transaction boundary kabur,
- performance sulit diprediksi,
- lazy loading bocor ke API layer,
- error muncul saat response serialization.

Lebih baik:

```text
resource
  -> service/query service
    -> transaction if needed
    -> explicit fetch/projection
  -> response DTO
```

---

## 32. Exception Handling Persistence

Jangan expose exception persistence mentah.

Contoh exception:

- `NoResultException`
- `NonUniqueResultException`
- `OptimisticLockException`
- `PersistenceException`
- constraint violation dari database
- transaction rollback exception
- connection acquisition timeout

Mapping ke domain/API:

```text
NoResultException
  -> 404 resource not found

OptimisticLockException
  -> 409 conflict

Unique constraint violation
  -> 409 duplicate resource

Pool acquisition timeout
  -> 503 service temporarily overloaded

Transaction timeout
  -> 504/503 depending boundary
```

Exception mapper:

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {

    @Override
    public Response toResponse(DomainException exception) {
        ProblemResponse problem = ProblemResponse.from(exception);
        return Response.status(problem.status()).entity(problem).build();
    }
}
```

Persistence exception sebaiknya diterjemahkan di repository/service boundary menjadi domain exception yang stabil.

---

## 33. Database Constraint sebagai Invariant Layer

Jangan hanya mengandalkan validation di Java.

Gunakan database constraint untuk invariant penting:

- `NOT NULL`,
- `UNIQUE`,
- foreign key,
- check constraint,
- version column,
- index,
- exclusion constraint jika database mendukung,
- partial unique index jika sesuai.

Contoh:

```sql
alter table case_record
add constraint uk_case_record_case_no unique (case_no);

alter table case_record
add constraint ck_case_record_status
check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));
```

Java validation memberi user-friendly error. Database constraint memberi final safety net.

In regulated systems:

```text
business invariant should not depend only on application code path
```

Karena data bisa masuk dari:

- batch,
- migration,
- admin script,
- integration,
- legacy service,
- manual DBA fix.

---

## 34. Audit Trail dan ORM

Audit trail tidak boleh menjadi afterthought.

Dalam Quarkus + Hibernate, opsi audit:

1. Manual audit insert di service.
2. Hibernate Envers.
3. Database trigger.
4. Outbox event + audit projection.
5. Combination.

### 34.1 Manual Audit

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseRecordEntity caseRecord = caseRepository.getByCaseNo(command.caseNo());
    CaseStatus oldStatus = caseRecord.status();

    caseRecord.approve(command.actor());

    auditRepository.append(AuditEvent.statusChanged(
        command.caseNo(),
        oldStatus,
        caseRecord.status(),
        command.actor(),
        Instant.now()
    ));
}
```

Keuntungan:

- domain-aware,
- explicit,
- audit message meaningful,
- actor/context mudah masuk.

Kekurangan:

- developer bisa lupa,
- boilerplate,
- perlu governance.

### 34.2 Hibernate Envers

Envers berguna untuk entity revision tracking.

Namun untuk regulatory audit, Envers tidak selalu cukup karena:

- user intent tidak selalu jelas,
- business event tidak sama dengan row diff,
- approval reason/actor/context perlu explicit,
- external correlation ID perlu masuk,
- audit retention/search punya kebutuhan khusus.

### 34.3 Database Trigger

Trigger kuat sebagai final safety net, tetapi:

- business context terbatas,
- application actor harus dipropagasi ke session variable,
- testing lebih sulit,
- logic tersebar di DB,
- deployment/migration perlu DBA discipline.

Top-tier approach sering hybrid:

```text
manual domain audit for business meaning
+ DB constraint/trigger for critical safety
+ outbox for integration/audit downstream
```

---

## 35. Outbox dengan Hibernate ORM

Outbox pattern penting ketika local DB mutation harus menghasilkan event.

Bad pattern:

```java
@Transactional
public void submit() {
    caseRecord.submit();
    kafkaProducer.send(event); // remote side-effect inside transaction
}
```

Masalah:

- DB commit bisa gagal setelah Kafka send,
- Kafka send bisa gagal setelah DB mutation,
- retry bisa duplicate,
- distributed transaction temptation.

Better:

```java
@Transactional
public void submit() {
    caseRecord.submit();
    outboxRepository.append(CaseSubmittedEvent.from(caseRecord));
}
```

Kemudian worker:

```text
poll unsent outbox rows
publish to Kafka/RabbitMQ
mark sent
retry with idempotency
```

Outbox table:

```sql
create table outbox_event (
    id uuid primary key,
    aggregate_type varchar(100) not null,
    aggregate_id varchar(100) not null,
    event_type varchar(100) not null,
    payload jsonb not null,
    status varchar(30) not null,
    created_at timestamp not null,
    published_at timestamp null,
    retry_count int not null default 0
);
```

Important invariant:

```text
business state change and outbox insert must commit atomically
```

---

## 36. Multi-Tenancy

Quarkus Hibernate ORM supports multi-tenancy patterns, but top-tier engineer must ask first:

> Multi-tenancy at application level, schema level, datasource level, or database level?

Options:

```text
tenant column
  -> simpler ops
  -> harder isolation
  -> every query must filter tenant

schema per tenant
  -> stronger isolation
  -> migration complexity

database per tenant
  -> strongest isolation
  -> operational overhead

datasource per tenant
  -> runtime datasource resolution
  -> pool explosion risk
```

### 36.1 Tenant Column Risk

Every query must include tenant.

```java
where tenant_id = :tenantId
```

If one query misses tenant filter, data leak.

Use:

- Hibernate filters,
- repository base constraints,
- database row-level security if available,
- test matrix,
- security review.

### 36.2 Pool Explosion

If tenant uses separate datasource and you have:

```text
100 tenants
pool max-size 10 each
= 1000 potential DB connections
```

This can destroy DB capacity.

Multi-tenancy is not just ORM mapping. It is operational architecture.

---

## 37. Entity Lifecycle Callback: Use Carefully

JPA callbacks:

```java
@PrePersist
void prePersist() {
    createdAt = Instant.now();
}

@PreUpdate
void preUpdate() {
    updatedAt = Instant.now();
}
```

Good for technical fields:

- `createdAt`,
- `updatedAt`,
- simple default.

Bad for business side effects:

```java
@PostPersist
void sendEmail() { ... }
```

Do not do this.

Callbacks run inside persistence lifecycle and should not:

- call remote services,
- publish Kafka messages,
- inject CDI services casually,
- perform complex queries,
- make security decisions.

Use service layer/outbox instead.

---

## 38. CDI Event vs Domain Event vs Outbox Event

Do not confuse these:

```text
CDI event
  -> in-process notification
  -> same application runtime
  -> not durable by default

Domain event
  -> business fact inside domain model/use-case
  -> may be represented as object

Outbox event
  -> durable integration event persisted in DB
  -> can be published asynchronously
```

Inside transaction:

```java
@Transactional
public void approve() {
    caseRecord.approve();
    domainEvents.add(...);
    outboxRepository.append(...);
}
```

Use CDI events for local decoupling, not as reliable integration mechanism.

---

## 39. Testing Hibernate ORM di Quarkus

### 39.1 `@QuarkusTest`

```java
@QuarkusTest
class CaseSubmissionServiceTest {

    @Inject
    CaseSubmissionService service;

    @Inject
    EntityManager em;

    @Test
    void submitDraftCase() {
        // arrange
        // act
        // assert
    }
}
```

`@QuarkusTest` boots Quarkus test runtime. Cocok untuk integration-style component test.

### 39.2 Test Transaction

Quarkus menyediakan mekanisme test transaction seperti `@TestTransaction` untuk menjalankan test dalam transaksi yang rollback.

Gunakan untuk isolasi data.

Namun hati-hati:

- test yang selalu rollback tidak menguji commit-time constraint dengan realistis jika tidak flush,
- async/outbox behavior butuh commit nyata,
- transaction boundary production harus tetap diuji.

### 39.3 Dev Services

Untuk test lokal, Dev Services bisa menjalankan database container otomatis.

Keuntungan:

- onboarding cepat,
- tidak perlu DB lokal manual,
- environment lebih konsisten.

Risiko:

- test terlalu bergantung magic,
- CI behavior berbeda,
- data init tidak jelas,
- container startup lambat jika tidak dikelola.

### 39.4 Testcontainers Explicit vs Dev Services

Dev Services cocok untuk simple standard case.

Explicit Testcontainers cocok jika butuh:

- custom DB image,
- extension DB khusus,
- init script kompleks,
- multiple containers,
- network behavior,
- deterministic lifecycle.

---

## 40. Testing Query Shape

Unit test tidak cukup. Query perlu diuji.

Test hal berikut:

- query mengembalikan data benar,
- pagination deterministic,
- filter tenant/authorization benar,
- projection tidak memuat field salah,
- N+1 tidak muncul untuk endpoint critical,
- optimistic lock conflict ter-handle,
- unique constraint ter-handle,
- transaction rollback bekerja,
- outbox insert atomic.

Untuk N+1, kamu bisa:

- inspect SQL log di test,
- gunakan Hibernate statistics jika tersedia/diaktifkan,
- gunakan integration test dengan dataset representatif,
- lakukan performance regression test.

---

## 41. Observability Persistence Layer

Persistence observability minimal:

```text
HTTP endpoint latency
service/use-case latency
repository/query latency
DB pool active/idle/waiting
pool acquisition timeout count
transaction timeout count
slow query count
deadlock count
optimistic lock conflict count
row count per query category
outbox backlog
migration status
```

### 41.1 Metrics yang Sering Lebih Penting daripada Avg Query Time

- p95/p99 connection acquisition time,
- number of active connections,
- number of waiting threads,
- transaction duration p95/p99,
- query count per request,
- rows read vs rows returned,
- lock wait time,
- deadlocks,
- retry count,
- DB CPU/IO saturation.

### 41.2 Trace Design

Trace span example:

```text
HTTP POST /cases/{caseNo}/submit
  -> CaseSubmissionService.submit
     -> CaseRepository.getByCaseNo
     -> CaseRecordEntity.submit
     -> AuditRepository.append
     -> OutboxRepository.append
  -> commit transaction
```

Jangan hanya trace SQL mentah. Trace use-case boundary juga.

---

## 42. Performance Checklist Hibernate ORM di Quarkus

### 42.1 Startup

- entity count wajar,
- no giant shared entity jar,
- Jandex index tersedia,
- no unnecessary persistence units,
- no unused extensions,
- native-image metadata terkendali.

### 42.2 Runtime

- pool size sesuai DB capacity,
- timeout budget jelas,
- transaction pendek,
- query explicit,
- no lazy loading di serialization,
- DTO projection untuk listing,
- batch size dikonfigurasi jika batch workload,
- pagination menggunakan index,
- count query tidak sembarangan,
- optimistic locking untuk concurrent mutation.

### 42.3 Database

- index sesuai filter/sort,
- FK/unique/check constraint jelas,
- migration reviewed,
- slow query monitored,
- execution plan dicek,
- statistics up-to-date,
- vacuum/analyze/maintenance sesuai DB,
- connection limit dikelola per service/pod.

---

## 43. Native Image Implication untuk Hibernate ORM

Hibernate ORM di Quarkus didukung untuk native image melalui extension integration. Namun tetap ada konsekuensi:

- entity harus discoverable,
- reflection metadata harus cukup,
- dynamic model generation dibatasi,
- driver harus compatible,
- custom user type perlu dicek,
- serialization/resource config perlu benar,
- class initialization timing bisa berpengaruh,
- build time native image lebih panjang,
- memory build lebih besar.

### 43.1 Library Risk

Jika kamu memakai library persistence custom yang banyak reflection/dynamic proxy/classpath scanning, tanyakan:

- apakah Quarkus extension tersedia?
- apakah library native compatible?
- apakah perlu reflection config manual?
- apakah runtime classpath scanning dipakai?
- apakah bytecode generation runtime dipakai?
- apakah custom Hibernate type aman di native?

### 43.2 Native Image Bukan Default untuk Semua Service

Gunakan native image jika:

- cold start penting,
- memory footprint penting,
- high pod density,
- serverless-like workload,
- startup-latency sensitive,
- scaling from zero.

JVM mode bisa lebih cocok jika:

- throughput long-running lebih penting,
- heavy JIT optimization menguntungkan,
- native build terlalu mahal,
- library compatibility belum matang,
- debugging/profiling native belum siap,
- team belum punya native pipeline.

---

## 44. Database Access dari Reactive Endpoint

Jika endpoint non-blocking/event-loop menggunakan blocking Hibernate ORM, kamu bisa memblokir event loop.

Bad:

```java
@GET
@Path("/{id}")
public Uni<CaseResponse> get(Long id) {
    CaseRecordEntity entity = em.find(CaseRecordEntity.class, id); // blocking
    return Uni.createFrom().item(toResponse(entity));
}
```

Better jika menggunakan blocking Hibernate ORM:

```java
@GET
@Path("/{id}")
@Blocking
public CaseResponse get(Long id) {
    CaseRecordEntity entity = em.find(CaseRecordEntity.class, id);
    return toResponse(entity);
}
```

Atau gunakan Hibernate Reactive jika seluruh pipeline reactive.

Rule:

```text
Blocking ORM belongs on worker/virtual thread, not event loop.
```

Part 012 akan membahas Hibernate Reactive secara khusus.

---

## 45. Virtual Threads dan Hibernate ORM

Virtual threads bisa membuat blocking style lebih scalable secara thread model, tetapi tidak menghapus batas DB connection pool.

```text
virtual threads: 10,000 possible request continuations
DB pool: 40 connections
```

Hasilnya:

```text
only 40 concurrent DB operations
others wait
```

Virtual thread membantu mengurangi biaya blocking thread, tetapi:

- DB tetap bottleneck,
- lock tetap bottleneck,
- connection pool tetap concurrency gate,
- transaction duration tetap harus pendek,
- pinning/blocking native call harus diperhatikan.

Virtual threads bukan alasan memperbesar transaksi atau mengabaikan query optimization.

---

## 46. Multi-Module Persistence Design

Bad:

```text
common-entities
  UserEntity
  CaseEntity
  BillingEntity
  AuditEntity
  DocumentEntity

service-a depends common-entities
service-b depends common-entities
service-c depends common-entities
```

Lebih baik:

```text
case-service
  case-domain
  case-persistence
  case-api

billing-service
  billing-domain
  billing-persistence
  billing-api

shared-kernel
  Money
  UserId
  CaseNo
  ClockProvider
```

Boundary:

- Entity belongs to service/schema owner.
- DTO contract belongs to API owner.
- Value object stable can be shared cautiously.
- Database table should not be shared writable by many services.

Jika multiple services menulis table yang sama, kamu punya distributed monolith.

---

## 47. Mapping Strategy untuk Enum

Jangan pakai ordinal:

```java
@Enumerated(EnumType.ORDINAL)
```

Bahaya:

```java
DRAFT = 0
SUBMITTED = 1
APPROVED = 2
```

Jika enum berubah urutan, data rusak.

Gunakan string:

```java
@Enumerated(EnumType.STRING)
@Column(length = 40, nullable = false)
private CaseStatus status;
```

Namun string enum juga punya issue:

- rename enum value memerlukan migration,
- external API value harus stabil,
- database check constraint perlu update,
- backward compatibility perlu dipikirkan.

Untuk domain sangat stabil, bisa pakai code eksplisit:

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    APPROVED("APPROVED");

    private final String code;
}
```

Dengan converter:

```java
@Converter(autoApply = true)
public class CaseStatusConverter implements AttributeConverter<CaseStatus, String> {
    ...
}
```

---

## 48. Date/Time Mapping

Gunakan `Instant` untuk timestamp machine/global:

```java
@Column(name = "created_at", nullable = false)
private Instant createdAt;
```

Gunakan `LocalDate` untuk tanggal kalender tanpa timezone:

```java
private LocalDate effectiveDate;
```

Gunakan `OffsetDateTime` jika offset relevan sebagai data domain.

Jangan menyimpan waktu ambigu tanpa kebijakan timezone.

Production invariant:

```text
database timestamp convention must be explicit:
  UTC instant? local business time? offset time?
```

Untuk audit trail, biasanya gunakan UTC `Instant`.

---

## 49. Large Object / CLOB / BLOB

Hibernate bisa memetakan LOB:

```java
@Lob
@Column(name = "payload")
private String payload;
```

Namun LOB punya konsekuensi:

- memory pressure,
- fetch cost,
- serialization cost,
- DB storage bloat,
- backup/replication overhead,
- vacuum/fragmentation/HWM issue tergantung DB,
- query listing bisa ikut membawa data besar jika salah fetch.

Prinsip:

```text
Do not put large payload in hot listing entity query.
```

Pisahkan:

```text
case_record
  id, case_no, status, created_at

case_payload
  case_id, large_json/clob
```

Atau simpan blob/document di object storage dengan metadata di DB jika cocok.

---

## 50. Soft Delete

Soft delete umum:

```java
@Column(name = "deleted")
private boolean deleted;
```

Risiko:

- semua query harus filter deleted=false,
- unique constraint lebih kompleks,
- table membengkak,
- audit semantics kabur,
- restore behavior perlu jelas,
- referential integrity sulit.

Alternatif:

- status lifecycle (`ACTIVE`, `CANCELLED`, `ARCHIVED`),
- archive table,
- temporal table,
- hard delete untuk truly disposable data,
- retention policy.

Soft delete bukan default. Ia adalah domain decision.

---

## 51. Read-Only Query dan Read-Only Transaction

Untuk query berat yang tidak memodifikasi entity, hindari managed entity jika tidak perlu.

Gunakan projection:

```java
select new ...
```

Atau set hint read-only jika sesuai.

Kenapa?

- persistence context lebih kecil,
- dirty checking berkurang,
- memory lebih rendah,
- intent jelas.

Untuk listing/reporting, entity load penuh sering tidak perlu.

---

## 52. Locking, Deadlock, dan Retry

Deadlock bisa terjadi walau kode Java terlihat benar.

Contoh:

```text
Transaction A:
  lock case 1
  lock case 2

Transaction B:
  lock case 2
  lock case 1
```

Solusi:

- consistent lock order,
- smaller transaction,
- proper index,
- avoid range lock if possible,
- timeout,
- retry only safe/idempotent operations,
- observe deadlock count.

Retry transaction harus hati-hati.

Aman jika:

- operation idempotent,
- no external side effect inside transaction,
- command id punya deduplication,
- outbox handles integration.

Tidak aman jika:

- email sudah dikirim,
- payment sudah charged,
- remote API already called,
- audit duplicate tidak di-handle.

---

## 53. Production Configuration Example

Contoh baseline production PostgreSQL:

```properties
# Datasource
quarkus.datasource.db-kind=postgresql
quarkus.datasource.username=${DB_USERNAME}
quarkus.datasource.password=${DB_PASSWORD}
quarkus.datasource.jdbc.url=${DB_JDBC_URL}

# Pool
quarkus.datasource.jdbc.min-size=5
quarkus.datasource.jdbc.max-size=30
quarkus.datasource.jdbc.acquisition-timeout=5S
quarkus.datasource.jdbc.background-validation-interval=2M
quarkus.datasource.jdbc.idle-removal-interval=5M
quarkus.datasource.jdbc.max-lifetime=30M

# Hibernate
quarkus.hibernate-orm.database.generation=none
quarkus.hibernate-orm.log.sql=false
quarkus.hibernate-orm.jdbc.statement-batch-size=50

# Flyway - use carefully in prod governance
quarkus.flyway.migrate-at-start=false

# Health/metrics may be enabled through related extensions
quarkus.datasource.health.enabled=true
quarkus.hibernate-orm.metrics.enabled=true
```

Catatan:

- property exact bisa berubah antar versi Quarkus; validasi dengan dokumentasi config versi yang dipakai.
- jangan copy production config tanpa capacity planning.

---

## 54. Local Dev Configuration Example

```properties
%dev.quarkus.datasource.db-kind=postgresql
%dev.quarkus.datasource.devservices.enabled=true
%dev.quarkus.datasource.devservices.db-name=appdb
%dev.quarkus.datasource.username=app
%dev.quarkus.datasource.password=app

%dev.quarkus.hibernate-orm.database.generation=drop-and-create
%dev.quarkus.hibernate-orm.log.sql=true
%dev.quarkus.hibernate-orm.format-sql=true

%dev.quarkus.flyway.migrate-at-start=false
```

Jika memakai Flyway di dev:

```properties
%dev.quarkus.hibernate-orm.database.generation=none
%dev.quarkus.flyway.migrate-at-start=true
```

Pilih salah satu sebagai sumber schema utama.

Jangan campur auto DDL dan migration tanpa disiplin.

---

## 55. CI Test Configuration Example

```properties
%test.quarkus.datasource.db-kind=postgresql
%test.quarkus.datasource.devservices.enabled=true
%test.quarkus.hibernate-orm.database.generation=none
%test.quarkus.flyway.migrate-at-start=true
%test.quarkus.hibernate-orm.log.sql=false
```

CI sebaiknya menguji migration real, bukan hanya Hibernate auto-create.

Untuk beberapa test cepat, boleh ada profile khusus:

```properties
%fasttest.quarkus.hibernate-orm.database.generation=drop-and-create
```

Tapi jangan jadikan itu satu-satunya test persistence.

---

## 56. Case Study: Regulatory Case Submission Service

Bayangkan service Quarkus untuk case submission.

Use-case:

```text
Applicant submits case.
System validates case is DRAFT.
System changes status to SUBMITTED.
System writes audit trail.
System writes outbox event for notification.
System returns case status.
```

### 56.1 Entity

```java
@Entity
@Table(name = "case_record")
public class CaseRecordEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_record_seq")
    @SequenceGenerator(name = "case_record_seq", sequenceName = "case_record_seq", allocationSize = 50)
    private Long id;

    @Column(name = "case_no", nullable = false, unique = true, length = 64)
    private String caseNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private CaseStatus status;

    @Version
    private long version;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    protected CaseRecordEntity() {}

    public void submit(Instant now) {
        if (status != CaseStatus.DRAFT) {
            throw new InvalidCaseTransitionException(caseNo, status, CaseStatus.SUBMITTED);
        }
        status = CaseStatus.SUBMITTED;
        submittedAt = now;
    }

    public String caseNo() { return caseNo; }
    public CaseStatus status() { return status; }
}
```

### 56.2 Repository

```java
@ApplicationScoped
public class CaseRepository {

    @Inject
    EntityManager em;

    public CaseRecordEntity getByCaseNo(String caseNo) {
        return em.createQuery("""
            select c
            from CaseRecordEntity c
            where c.caseNo = :caseNo
            """, CaseRecordEntity.class)
            .setParameter("caseNo", caseNo)
            .getResultStream()
            .findFirst()
            .orElseThrow(() -> new CaseNotFoundException(caseNo));
    }
}
```

### 56.3 Service

```java
@ApplicationScoped
public class SubmitCaseService {

    @Inject
    CaseRepository caseRepository;

    @Inject
    AuditRepository auditRepository;

    @Inject
    OutboxRepository outboxRepository;

    @Inject
    Clock clock;

    @Transactional
    public SubmitCaseResult submit(String caseNo, UserId actor) {
        Instant now = clock.instant();

        CaseRecordEntity caseRecord = caseRepository.getByCaseNo(caseNo);
        CaseStatus oldStatus = caseRecord.status();

        caseRecord.submit(now);

        auditRepository.append(AuditEvent.statusChanged(
            caseNo,
            oldStatus,
            caseRecord.status(),
            actor,
            now
        ));

        outboxRepository.append(OutboxEvent.caseSubmitted(
            caseNo,
            actor,
            now
        ));

        return new SubmitCaseResult(caseNo, caseRecord.status());
    }
}
```

### 56.4 Resource

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    @Inject
    SubmitCaseService submitCaseService;

    @POST
    @Path("/{caseNo}/submit")
    public SubmitCaseResponse submit(@PathParam("caseNo") String caseNo) {
        UserId actor = UserContext.currentUserId();
        SubmitCaseResult result = submitCaseService.submit(caseNo, actor);
        return new SubmitCaseResponse(result.caseNo(), result.status().name());
    }
}
```

### 56.5 Why This Design Works

- Resource tidak mengatur persistence detail.
- Service memegang transaction boundary.
- Entity menjaga state invariant.
- Audit/outbox atomic dengan state change.
- DTO response tidak expose entity.
- Optimistic locking mencegah lost update.
- External notification tidak dikirim dalam transaction.

---

## 57. Failure Mode Matrix

| Failure | Gejala | Penyebab Umum | Mitigasi |
|---|---|---|---|
| Entity tidak ditemukan saat startup | Hibernate mapping error | dependency tidak ter-index, package salah | Jandex index, config packages |
| Pool timeout | 503/timeout, request lambat | pool habis, query lama, transaction panjang | pool metrics, short transaction, tune DB/index |
| N+1 | p95 naik saat data banyak | lazy association dalam loop/serialization | projection/fetch plan/test SQL |
| Lazy init error | error saat JSON response | entity keluar session | DTO boundary, explicit query |
| Optimistic lock exception | concurrent update gagal | version conflict | map ke 409, user reload/retry |
| Deadlock | transaction rollback random | inconsistent lock order | order lock, smaller txn, retry safe operation |
| Unique violation | commit gagal | duplicate business key | DB constraint + domain error mapping |
| Startup native gagal | native image build error | reflection/dynamic dependency | use Quarkus extension, register metadata |
| Slow deployment | migration/startup lambat | auto migration heavy | controlled migration job |
| Memory bloat | high heap/RSS | loading entity graph besar/LOB | projection, pagination, separate LOB |
| Data leak tenant | wrong tenant data visible | missing tenant filter | RLS/filter/test/security review |
| Audit missing | no trace of mutation | audit not enforced | service template, outbox, trigger safety |

---

## 58. Anti-Pattern Besar

### 58.1 Entity as REST Contract

```java
public CaseRecordEntity getCase() { ... }
```

Hindari untuk production.

### 58.2 Transaction Around External Call

```java
@Transactional
public void doWork() {
    updateDb();
    callRemote();
}
```

Hindari kecuali benar-benar dipahami.

### 58.3 Repository Owns All Transactions

Repository transaction bisa memecah atomicity use-case.

### 58.4 Blind Merge from Request Body

```java
em.merge(requestEntity);
```

Berbahaya untuk security dan invariant.

### 58.5 Shared Entity Jar Across Services

Menciptakan distributed monolith.

### 58.6 Auto DDL in Production

Tidak defensible untuk enterprise serious system.

### 58.7 Count Everything

Exact count real-time sering mahal dan tidak selalu perlu.

### 58.8 Fetch Join Everything

Bisa meledakkan row/memory.

### 58.9 Increasing Pool Size as First Fix

Sering hanya memindahkan bottleneck ke database.

### 58.10 Ignoring SQL Because “ORM”

ORM tidak membebaskan engineer dari query plan.

---

## 59. Decision Framework

### 59.1 Entity vs DTO

| Need | Prefer |
|---|---|
| mutation with invariant | entity |
| listing | DTO projection |
| public API response | DTO |
| audit diff | entity + audit model |
| report | projection/read model |
| external integration | integration DTO/event |

### 59.2 Transaction Boundary

| Situation | Boundary |
|---|---|
| simple CRUD | resource or service acceptable |
| multi-step use-case | service |
| repository method | no transaction unless truly standalone |
| batch chunk | chunk service method |
| external call involved | separate transaction/outbox |

### 59.3 Fetch Strategy

| Situation | Strategy |
|---|---|
| detail page small graph | fetch join/entity graph |
| listing | projection |
| large collection | separate query/page |
| report | SQL/projection/read model |
| API serialization | never accidental lazy |

### 59.4 Lock Strategy

| Situation | Strategy |
|---|---|
| normal concurrent edit | optimistic lock |
| short critical allocation | pessimistic lock possible |
| long human workflow | state/version, no DB lock |
| external side effect | outbox/idempotency |

---

## 60. Production Readiness Checklist

Sebelum Quarkus Hibernate ORM service production:

### Mapping

- [ ] Semua entity discoverable.
- [ ] Multi-module dependency ter-index.
- [ ] Enum tidak pakai ordinal.
- [ ] `@Version` untuk mutable critical aggregate.
- [ ] LOB tidak ikut hot listing query.
- [ ] Date/time convention jelas.
- [ ] Constraint DB mencerminkan invariant penting.

### Transaction

- [ ] Transaction boundary di service/use-case.
- [ ] Tidak ada remote call lambat dalam transaction.
- [ ] Timeout budget jelas.
- [ ] Retry hanya untuk operasi aman/idempotent.
- [ ] Outbox untuk event reliable.

### Query

- [ ] Query critical sudah dicek SQL-nya.
- [ ] No N+1 pada endpoint critical.
- [ ] Pagination deterministic.
- [ ] Count query dikaji.
- [ ] Index sesuai filter/order.
- [ ] Projection digunakan untuk listing.

### Pool

- [ ] Pool size dihitung dari DB capacity.
- [ ] Acquisition timeout disetel.
- [ ] Metrics pool aktif.
- [ ] Replica count x pool max tidak melebihi DB budget.

### Schema

- [ ] Production auto DDL off.
- [ ] Migration tool digunakan.
- [ ] Migration review process jelas.
- [ ] Rollback/backup strategy jelas.

### Observability

- [ ] Pool metrics.
- [ ] Slow query visibility.
- [ ] Transaction timeout/error metrics.
- [ ] Optimistic lock/deadlock count.
- [ ] Outbox backlog.
- [ ] Correlation ID across logs/traces.

### Security

- [ ] Entity tidak diekspos langsung.
- [ ] Request body tidak di-merge langsung.
- [ ] Tenant/ownership filter diuji.
- [ ] Sensitive field tidak masuk log/API.

### Native

- [ ] Native build tested jika dipakai.
- [ ] Driver/library compatible.
- [ ] Reflection/custom type dicek.
- [ ] Native integration test dijalankan.

---

## 61. Latihan Top 1% Engineer

### Latihan 1 — Query Shape Review

Ambil satu endpoint listing dari project nyata.

Jawab:

1. Query SQL apa yang dieksekusi?
2. Berapa jumlah query per request?
3. Apakah ada lazy load saat serialization?
4. Apakah pagination deterministic?
5. Index apa yang dipakai?
6. Apakah count query perlu?
7. Berapa p95 latency saat data 10x lebih besar?

### Latihan 2 — Transaction Boundary Review

Ambil satu use-case mutation.

Gambar:

```text
start transaction
  read entities
  validate state
  mutate
  write audit
  write outbox
commit
external side effects
```

Tandai:

- mana yang harus atomic,
- mana yang boleh eventual,
- mana yang idempotent,
- mana yang harus retry,
- mana yang harus punya timeout.

### Latihan 3 — Pool Capacity Math

Diberikan:

```text
DB max connections: 500
reserved admin/maintenance: 50
services sharing DB: 5
critical service replicas: 8
other service replicas total: 20
```

Desain:

- max pool per pod,
- acquisition timeout,
- scaling limit,
- alert threshold.

### Latihan 4 — Entity Exposure Refactor

Refactor endpoint yang return entity menjadi:

- response DTO,
- query projection,
- exception mapper,
- authorization check,
- no lazy serialization.

### Latihan 5 — Native Readiness Review

Untuk satu service persistence-heavy:

- daftar dependency persistence,
- custom type/converter,
- reflection usage,
- driver,
- native test plan,
- fallback JVM plan.

---

## 62. Ringkasan Invariants

Ingat invariants berikut:

1. **Quarkus Hibernate ORM adalah build-time integrated persistence runtime.**
2. **ORM tidak menghapus kewajiban memahami SQL.**
3. **Entity bukan API contract.**
4. **Transaction boundary sebaiknya mengikuti use-case consistency boundary.**
5. **Repository tidak otomatis menjadi pemilik transaksi.**
6. **Connection pool adalah concurrency gate ke database.**
7. **Pool size harus dihitung dari kapasitas database, bukan jumlah request.**
8. **Lazy loading tidak boleh bocor ke JSON serialization.**
9. **Projection adalah alat utama untuk listing/read model.**
10. **Optimistic locking penting untuk workflow mutable.**
11. **Remote side effect tidak boleh sembarangan masuk transaction.**
12. **Outbox menyatukan local mutation dan integration event secara aman.**
13. **Auto DDL cocok untuk dev/test, bukan production enterprise.**
14. **Native image mengubah constraint dependency dan reflection.**
15. **Persistence observability harus mencakup pool, transaction, query, lock, dan outbox.**

---

## 63. Referensi Resmi untuk Part Ini

- Quarkus Guide — Using Hibernate ORM and Jakarta Persistence: `https://quarkus.io/guides/hibernate-orm`
- Quarkus Guide — Configure data sources: `https://quarkus.io/guides/datasource`
- Quarkus Guide — Using transactions in Quarkus: `https://quarkus.io/guides/transaction`
- Quarkus Extension — Narayana JTA Transaction Manager: `https://quarkus.io/extensions/io.quarkus/quarkus-narayana-jta/`
- Quarkus Extension — Agroal Database Connection Pool: `https://quarkus.io/extensions/io.quarkus/quarkus-agroal/`
- Quarkus Guide — Hibernate ORM with Panache: `https://quarkus.io/guides/hibernate-orm-panache`
- Quarkus Guide — Configuration reference: `https://quarkus.io/guides/config-reference`

---

## 64. Penutup Part 010

Part ini menempatkan Hibernate ORM sebagai **runtime persistence yang terintegrasi dengan build-time model Quarkus**, bukan sekadar JPA provider biasa.

Kalau harus diringkas:

> Quarkus membuat Hibernate lebih cepat dan lebih predictable pada bootstrap/runtime envelope, tetapi kualitas persistence layer tetap ditentukan oleh desain transaction, query, entity boundary, pool sizing, migration discipline, dan observability.

Part berikutnya akan masuk ke:

# Part 011 — Persistence II: Panache Active Record vs Repository vs Domain-Centric Persistence

Di sana kita akan membahas Panache secara adil: kapan ia sangat produktif, kapan ia membuat domain boundary kabur, dan bagaimana memakainya tanpa kehilangan engineering discipline.

---

**Status seri:** belum selesai.  
**Bagian selanjutnya:** `learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-011.md`


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-009.md">⬅️ Part 009 — Blocking vs Reactive Execution Model: Event Loop, Worker Thread, Mutiny, dan Backpressure</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-011.md">Part 011 — Persistence II: Panache Active Record vs Repository vs Domain-Centric Persistence ➡️</a>
</div>
