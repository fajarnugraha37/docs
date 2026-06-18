# Part 010 — Transaction Fundamentals: ACID, Local Transactions, JTA, Resource Managers

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: Java 8 sampai Java 25  
> Fokus: Java/Jakarta Persistence, JPA, Hibernate, Jakarta Data, Jakarta Transactions, Spring Transaction, dan integrasi database produksi  
> Status seri: Part 010 dari 032 — belum selesai

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu memahami transaction bukan sebagai “annotation ajaib”, tetapi sebagai **mekanisme koordinasi perubahan state** antara aplikasi, persistence context, JDBC connection, database engine, transaction manager, dan resource manager.

Target akhirnya bukan hanya bisa memakai `@Transactional`, tetapi mampu menjawab pertanyaan seperti:

1. Apa yang sebenarnya terjadi ketika sebuah method transactional dipanggil?
2. Apa bedanya transaction di JDBC, JPA, Hibernate, Spring, dan Jakarta Transactions?
3. Apa bedanya local transaction, resource-local transaction, global transaction, JTA transaction, dan distributed/XA transaction?
4. Kenapa `flush()` bukan `commit()`?
5. Kenapa sebagian exception membuat transaction rollback, sebagian tidak?
6. Kenapa external API call di tengah transaction bisa menjadi sumber incident?
7. Kenapa transaction boundary seharusnya mengikuti use case/invariant, bukan mengikuti DAO method?
8. Bagaimana memahami ACID secara operational, bukan definisi textbook?
9. Bagaimana transaction berhubungan dengan persistence context, connection pool, isolation level, lock, timeout, dan retry?
10. Kapan harus memakai local transaction, kapan perlu JTA, dan kapan distributed transaction justru sebaiknya dihindari?

Bagian ini adalah fondasi untuk part berikutnya:

- Part 011 — Transaction Boundary Design in Real Applications
- Part 012 — Isolation Levels and Concurrency Anomalies
- Part 013 — Optimistic Locking, Versioning, and State Machine Persistence
- Part 014 — Pessimistic Locking, Deadlocks, and High-Contention Workloads

---

## 2. Mental Model: Transaction adalah Boundary Konsistensi

Secara dangkal, transaction sering dipahami sebagai:

```java
@Transactional
public void approveCase(...) {
    ...
}
```

Tetapi mental model seperti itu terlalu tipis. Transaction bukan annotation. Annotation hanya salah satu cara untuk **mendeklarasikan** kapan transaction dimulai, kapan selesai, dan apa yang terjadi ketika method sukses/gagal.

Mental model yang lebih benar:

```text
Transaction = boundary tempat aplikasi berkata:

"Serangkaian perubahan ini harus terlihat sebagai satu keputusan konsistensi:
 berhasil semua, atau gagal semua, dengan aturan isolasi tertentu terhadap transaksi lain."
```

Dalam aplikasi persistence, transaction adalah koordinasi antara beberapa hal:

```text
Application use case
    ↓
Transaction boundary
    ↓
Persistence context / EntityManager / Hibernate Session
    ↓
JDBC Connection
    ↓
Database transaction
    ↓
Locks / MVCC / undo / redo / WAL / constraints / indexes
    ↓
Commit or rollback
```

Kalau melibatkan lebih dari satu resource:

```text
Application use case
    ↓
Transaction manager
    ↓
Resource manager A: Database
Resource manager B: JMS broker
Resource manager C: another database
    ↓
Two-phase commit / XA / global transaction
```

Namun di sistem modern berbasis microservice, distributed transaction sering diganti dengan:

```text
Local DB transaction
    +
Transactional outbox
    +
Idempotent consumer
    +
Retry
    +
Compensation
```

Itu akan dibahas lebih dalam di Part 026. Bagian ini fokus pada fondasi transaction-nya dulu.

---

## 3. Transaction Bukan Hanya Atomicity

Banyak developer menyederhanakan transaction sebagai:

> Kalau gagal, rollback.

Itu benar, tapi tidak lengkap. Transaction mengontrol beberapa dimensi sekaligus:

| Dimensi | Pertanyaan |
|---|---|
| Atomicity | Apakah perubahan berhasil semua atau gagal semua? |
| Consistency | Apakah invariant tetap valid setelah commit? |
| Isolation | Apa yang boleh dilihat transaksi lain ketika transaction ini berjalan? |
| Durability | Setelah commit sukses, apakah data tetap survive crash? |
| Visibility | Kapan perubahan terlihat oleh transaksi lain? |
| Locking | Resource apa yang dikunci dan berapa lama? |
| Timeout | Berapa lama transaction boleh hidup? |
| Retryability | Jika gagal, apakah aman diulang? |
| Side effect | Apakah ada efek eksternal yang tidak bisa di-rollback? |

Dalam sistem produksi, transaction error sering bukan karena developer tidak tahu `commit()` dan `rollback()`, tetapi karena salah menaruh boundary.

Contoh salah:

```java
@Transactional
public void approveApplication(Long id) {
    Application app = applicationRepository.findById(id).orElseThrow();
    app.approve();

    emailClient.sendApprovalEmail(app.getApplicantEmail());

    auditTrailRepository.save(AuditTrail.approved(app));
}
```

Kelihatannya rapi, tapi ada masalah besar:

1. Jika email berhasil terkirim lalu DB rollback, user menerima email approval padahal application tidak approved.
2. Jika DB lock tertahan selama email API lambat, transaksi lain bisa timeout.
3. Jika request retry, email bisa terkirim dua kali.
4. Jika commit berhasil tapi response HTTP gagal, caller mungkin retry dan menyebabkan duplicate side effect.

Transaction hanya bisa rollback resource yang ikut transaction. External HTTP API biasanya tidak ikut.

Mental model penting:

```text
Database transaction tidak bisa membatalkan dunia luar.
```

Karena itu, transaction design harus selalu mempertimbangkan:

- apa yang transactional,
- apa yang tidak transactional,
- apa yang harus idempotent,
- apa yang harus direkam sebagai outbox/event,
- apa yang boleh retry,
- apa yang harus dikompensasi.

---

## 4. ACID secara Praktis

ACID sering diajarkan sebagai definisi textbook. Untuk engineer senior, yang lebih penting adalah bagaimana ACID bekerja dalam failure nyata.

### 4.1 Atomicity

Atomicity berarti perubahan dalam satu transaction diperlakukan sebagai satu unit keputusan.

Contoh:

```text
Use case: submit application

1. Update APPLICATION.status = SUBMITTED
2. Insert APPLICATION_HISTORY
3. Insert AUDIT_TRAIL
4. Insert OUTBOX_EVENT

Commit berhasil:
  semua terlihat

Rollback:
  tidak ada yang terlihat
```

Atomicity bukan berarti statement tidak pernah dieksekusi sebagian. Secara internal database bisa sudah menulis undo/redo, menahan lock, menjalankan trigger, bahkan melakukan flush ke disk. Tetapi dari sisi logical transaction, hasil akhirnya commit atau rollback.

Kesalahan umum:

```text
Atomicity dianggap berlaku untuk semua side effect dalam method.
```

Padahal hanya resource yang berada dalam transaction yang ikut atomicity.

| Operasi | Bisa ikut DB transaction? |
|---|---:|
| Insert row ke database yang sama | Ya |
| Update row ke database yang sama | Ya |
| Insert audit row di database yang sama | Ya |
| Publish message ke broker non-XA | Tidak otomatis |
| Kirim email | Tidak |
| Panggil REST API | Tidak |
| Tulis file lokal | Tidak otomatis |
| Upload object ke S3 | Tidak |
| Redis write | Tidak, kecuali ditangani khusus tetapi bukan bagian DB tx |

### 4.2 Consistency

Consistency berarti transaction membawa database dari satu state valid ke state valid lain.

Tetapi ini sering disalahpahami. Database tidak tahu semua business rule. Database hanya tahu constraint yang kamu definisikan.

Contoh invariant:

```text
Application yang sudah APPROVED tidak boleh kembali ke DRAFT.
```

Jika rule ini hanya ada di service code, maka database tidak otomatis menjamin. Bulk update, migration script, admin SQL, race condition, atau bug aplikasi lain tetap bisa melanggar.

Consistency harus dibangun berlapis:

| Layer | Contoh responsibility |
|---|---|
| UI | mencegah user memilih action tidak valid |
| DTO validation | field required, format valid |
| Domain/application logic | state transition legal |
| Database constraint | uniqueness, FK, NOT NULL, check constraint |
| Transaction isolation/locking | mencegah concurrent anomaly |
| Audit | membuktikan perubahan dan actor |

Untuk sistem regulatory/case management, consistency bukan hanya “data tidak corrupt”, tetapi:

- state transition harus legal,
- actor harus authorized,
- reason/remark harus terekam,
- effective timestamp jelas,
- audit trail lengkap,
- tidak ada duplicate official decision,
- tidak ada decision yang hilang walau request retry,
- external notification tidak mendahului commit data utama.

### 4.3 Isolation

Isolation mengontrol interaksi antar transaction yang berjalan bersamaan.

Tanpa isolation yang cukup, dua transaction bisa masing-masing benar jika dilihat sendiri, tetapi salah ketika berjalan bersamaan.

Contoh lost update:

```text
T1 read quota = 1
T2 read quota = 1
T1 reserve quota → quota = 0
T2 reserve quota → quota = 0

Dua reservation berhasil, padahal quota hanya 1.
```

Isolation bukan sekadar setting `READ_COMMITTED` atau `SERIALIZABLE`. Ia berhubungan dengan:

- MVCC,
- locks,
- index access path,
- optimistic version,
- pessimistic lock,
- unique constraint,
- retry policy,
- statement ordering.

Isolation akan dibahas sangat dalam di Part 012.

### 4.4 Durability

Durability berarti setelah commit sukses dikonfirmasi, database menjamin perubahan bertahan walau crash, sesuai durability guarantee engine/database.

Secara internal ini melibatkan:

- redo log,
- write-ahead log,
- transaction log,
- fsync policy,
- replication mode,
- storage durability,
- database configuration.

Dari sisi aplikasi, durability berarti:

```text
Jangan menganggap operasi berhasil sebelum commit berhasil.
```

Contoh:

```java
@Transactional
public void submit(Long id) {
    application.submit();
    outboxRepository.save(...);
    // belum durable sampai transaction commit sukses
}
```

Kalau method belum selesai/commit belum terjadi, data belum final.

---

## 5. Transaction Stack di Java Persistence

Untuk memahami transaction di Java ecosystem, pisahkan beberapa level berikut.

```text
Business method / use case
    ↓
Spring @Transactional atau Jakarta @Transactional
    ↓
Transaction manager abstraction
    ↓
JPA EntityManager / Hibernate Session
    ↓
JDBC Connection
    ↓
Database transaction
```

### 5.1 JDBC Transaction

Di level JDBC, transaction biasanya dikontrol oleh `Connection`.

Contoh manual:

```java
Connection connection = dataSource.getConnection();
try {
    connection.setAutoCommit(false);

    try (PreparedStatement ps1 = connection.prepareStatement("update application set status = ? where id = ?")) {
        ps1.setString(1, "SUBMITTED");
        ps1.setLong(2, 100L);
        ps1.executeUpdate();
    }

    try (PreparedStatement ps2 = connection.prepareStatement("insert into audit_trail (...) values (...)")) {
        ps2.executeUpdate();
    }

    connection.commit();
} catch (Exception ex) {
    connection.rollback();
    throw ex;
} finally {
    connection.close();
}
```

Di sini transaction melekat pada satu database connection.

Key point:

```text
Satu JDBC transaction biasanya = satu physical database connection dengan autoCommit=false sampai commit/rollback.
```

Kalau connection dikembalikan ke pool tanpa rollback/cleanup yang benar, aplikasi bisa mengalami bug serius. Karena itu framework dan pool biasanya membersihkan state connection ketika dikembalikan.

### 5.2 JPA Resource-Local Transaction

Di JPA/Jakarta Persistence standalone, kamu bisa memakai `EntityTransaction`.

```java
EntityManager em = entityManagerFactory.createEntityManager();
EntityTransaction tx = em.getTransaction();

try {
    tx.begin();

    Application app = em.find(Application.class, 100L);
    app.submit();
    em.persist(AuditTrail.submitted(app));

    tx.commit();
} catch (RuntimeException ex) {
    if (tx.isActive()) {
        tx.rollback();
    }
    throw ex;
} finally {
    em.close();
}
```

Ini disebut **resource-local transaction** karena transaction dikelola langsung oleh resource/persistence provider, bukan oleh JTA transaction manager global.

Cocok untuk:

- Java SE application,
- simple service dengan satu database,
- aplikasi tanpa application server/JTA,
- testing tertentu.

Tidak cocok jika perlu koordinasi atomic lintas banyak XA resource.

### 5.3 Container-Managed / Jakarta Transactions / JTA

Jakarta Transactions mendefinisikan interface antara:

- application,
- transaction manager,
- resource manager,
- application server.

Dalam Jakarta EE, transaction bisa dikelola container.

Contoh Jakarta-style:

```java
import jakarta.transaction.Transactional;

@Transactional
public void submitApplication(Long id) {
    Application app = entityManager.find(Application.class, id);
    app.submit();
    entityManager.persist(AuditTrail.submitted(app));
}
```

Atau programmatic dengan `UserTransaction`:

```java
@Resource
private UserTransaction userTransaction;

public void submitApplication(Long id) throws Exception {
    userTransaction.begin();
    try {
        Application app = entityManager.find(Application.class, id);
        app.submit();
        entityManager.persist(AuditTrail.submitted(app));
        userTransaction.commit();
    } catch (Exception ex) {
        userTransaction.rollback();
        throw ex;
    }
}
```

Di bawahnya, transaction manager bisa mengkoordinasikan satu atau lebih resource.

### 5.4 Spring Transaction

Spring menyediakan abstraction `PlatformTransactionManager` dan declarative transaction via `@Transactional`.

Contoh:

```java
@Service
public class ApplicationService {

    @Transactional
    public void submit(Long id) {
        Application app = applicationRepository.getRequired(id);
        app.submit();
        auditTrailRepository.save(AuditTrail.submitted(app));
    }
}
```

Tergantung konfigurasi, Spring bisa memakai:

| Transaction manager | Umum dipakai untuk |
|---|---|
| `DataSourceTransactionManager` | JDBC lokal dengan satu `DataSource` |
| `JpaTransactionManager` | JPA `EntityManagerFactory` lokal |
| `JtaTransactionManager` | JTA/global transaction |
| Reactive transaction manager | Reactive stack tertentu |

Dalam Spring Boot + JPA umum, yang sering terjadi:

```text
@Transactional
    ↓
JpaTransactionManager opens/binds EntityManager
    ↓
EntityManager obtains JDBC Connection lazily or when needed
    ↓
Database transaction begins
    ↓
Persistence context tracks changes
    ↓
Flush before commit
    ↓
Commit JDBC transaction
    ↓
Close/unbind EntityManager
```

---

## 6. Local Transaction vs Global Transaction vs Distributed Transaction

### 6.1 Local Transaction

Local transaction melibatkan satu transactional resource, biasanya satu database.

```text
Application
    ↓
Database A
```

Contoh:

```java
@Transactional
public void createCase(CreateCaseCommand command) {
    Case c = Case.create(command);
    caseRepository.save(c);
    auditRepository.save(AuditTrail.created(c));
}
```

Selama semuanya di database yang sama, local transaction cukup.

Keunggulan:

- sederhana,
- cepat,
- mudah dipahami,
- lebih mudah di-debug,
- failure mode lebih sempit.

Keterbatasan:

- tidak atomic terhadap message broker, external API, file storage, database lain.

### 6.2 Global Transaction

Global transaction adalah transaction yang dikelola transaction manager, bisa melibatkan satu atau lebih resource manager.

```text
Application
    ↓
Transaction Manager
    ↓              ↓
Database A        JMS Broker
```

Kalau hanya satu resource, JTA masih bisa dipakai tetapi manfaatnya kecil kecuali environment memang container-managed.

### 6.3 Distributed/XA Transaction

Distributed transaction biasanya berarti transaksi atomic lintas beberapa transactional resource menggunakan protocol seperti two-phase commit.

```text
Phase 1: prepare
  - DB A: siap commit?
  - DB B: siap commit?
  - Broker: siap commit?

Phase 2: commit/rollback
  - jika semua siap, commit semua
  - jika ada gagal, rollback semua
```

Keunggulan:

- atomic lintas resource yang mendukung XA.

Kelemahan:

- kompleks,
- lambat,
- coupling tinggi,
- blocking failure mode,
- sulit dioperasikan,
- tidak cocok untuk banyak arsitektur microservices modern,
- semua resource harus benar-benar mendukung protocol.

Dalam sistem modern, sering lebih aman memakai:

```text
Local transaction + outbox + idempotent consumer + retry + compensation
```

Tetapi penting: ini bukan berarti XA selalu buruk. Untuk aplikasi monolith enterprise tertentu dengan application server dan resource XA yang matang, JTA/XA bisa valid. Yang salah adalah memakai distributed transaction tanpa memahami operational cost-nya.

---

## 7. Resource Manager, Transaction Manager, Application Server

Jakarta Transactions memakai beberapa istilah penting.

### 7.1 Resource Manager

Resource manager adalah sistem yang mengelola resource transactional.

Contoh:

- relational database,
- JMS broker,
- message queue yang mendukung transaction,
- legacy transactional system.

Resource manager menyediakan mekanisme commit/rollback untuk resource tersebut.

Di database, resource manager bertanggung jawab atas:

- transaction log,
- locking/MVCC,
- commit,
- rollback,
- recovery,
- isolation.

### 7.2 Transaction Manager

Transaction manager mengatur lifecycle transaction.

Tugasnya:

- begin transaction,
- enlist resource,
- delist resource,
- coordinate commit,
- coordinate rollback,
- handle timeout,
- handle recovery,
- expose status transaction.

Dalam local transaction, transaction manager bisa sesederhana `JpaTransactionManager` atau JDBC connection transaction.

Dalam distributed transaction, transaction manager mengkoordinasikan banyak resource manager.

### 7.3 Application Server / Container

Application server/container menyediakan runtime yang bisa mengelola transaction untuk application component.

Contoh dalam Jakarta EE:

- EJB container,
- CDI-managed beans dengan Jakarta Transactions,
- injection `UserTransaction`,
- container-managed persistence context.

Dalam Spring, container-nya adalah Spring ApplicationContext dengan transaction interceptor/proxy.

### 7.4 Application

Application adalah kode bisnis yang mendeklarasikan boundary:

```java
@Transactional
public void submit(...) { ... }
```

Atau secara programmatic:

```java
transactionTemplate.execute(status -> {
    ...
    return result;
});
```

Application seharusnya tidak menyebarkan begin/commit di DAO/repository kecil-kecil, karena transaction boundary harus mengikuti use case.

---

## 8. EntityManager, Persistence Context, dan Transaction

Transaction dan persistence context sering berjalan berdekatan, tetapi tidak identik.

### 8.1 Persistence Context

Persistence context adalah ruang kerja yang menyimpan entity managed.

Ia melakukan:

- identity map,
- dirty checking,
- write-behind,
- lifecycle management,
- association tracking.

### 8.2 Transaction

Transaction adalah database consistency boundary.

Ia mengatur:

- commit,
- rollback,
- isolation,
- lock duration,
- atomic visibility,
- constraint finalization.

### 8.3 Hubungan Keduanya

Dalam transaction-scoped persistence context:

```text
Transaction starts
    ↓
Persistence context associated
    ↓
Entities loaded become managed
    ↓
Changes tracked
    ↓
Flush before commit
    ↓
Database commit
    ↓
Persistence context ends/detaches entities
```

Tetapi ada detail penting:

```text
Managed entity berubah di memory bukan berarti database sudah berubah final.
```

Contoh:

```java
@Transactional
public void updateName(Long id) {
    Customer customer = em.find(Customer.class, id);
    customer.changeName("Alice");

    // belum tentu SQL UPDATE sudah dikirim
    // tetapi persistence context tahu entity dirty
}
```

SQL bisa dikirim saat:

- flush eksplisit,
- sebelum query tertentu,
- sebelum commit,
- sesuai flush mode/provider behavior.

### 8.4 Flush Bukan Commit

`flush()` mengirim SQL pending ke database, tetapi transaction belum selesai.

```java
@Transactional
public void submit(Long id) {
    Application app = em.find(Application.class, id);
    app.submit();

    em.flush();

    // SQL UPDATE mungkin sudah dikirim.
    // Constraint bisa sudah dicek.
    // Tapi transaction masih bisa rollback.
}
```

Perbedaan:

| Operasi | Makna |
|---|---|
| Dirty change | Entity berubah di memory persistence context |
| Flush | SQL dikirim ke database dalam transaction aktif |
| Commit | Transaction diselesaikan dan perubahan menjadi durable/visible sesuai isolation |
| Rollback | Perubahan dalam transaction dibatalkan |

Kesalahan umum:

```text
Mengira save() langsung commit.
```

Dalam Spring Data JPA:

```java
repository.save(entity);
```

biasanya berarti entity dipersist/merge ke persistence context. Commit tetap terjadi di transaction boundary.

---

## 9. Commit, Rollback, dan Rollback-Only

### 9.1 Commit

Commit berarti aplikasi meminta database menyelesaikan transaction.

Sebelum commit pada JPA/Hibernate, biasanya terjadi flush.

```text
Application method returns successfully
    ↓
Transaction interceptor tries to commit
    ↓
EntityManager flushes dirty changes
    ↓
Database executes SQL/constraints
    ↓
Database commit
    ↓
Transaction complete
```

Commit bisa gagal.

Contoh penyebab:

- constraint violation baru muncul saat flush sebelum commit,
- deadlock detected,
- lock timeout,
- network failure,
- database failover,
- transaction timeout,
- serialization failure,
- connection broken.

Jangan desain sistem dengan asumsi:

```text
Jika method sampai akhir, commit pasti berhasil.
```

Commit adalah operasi yang bisa gagal.

### 9.2 Rollback

Rollback membatalkan perubahan dalam transaction.

Rollback bisa terjadi karena:

- exception dari application code,
- exception dari persistence provider,
- transaction timeout,
- manual `setRollbackOnly`,
- container memutuskan transaction harus rollback,
- database error.

### 9.3 Rollback-Only State

Sebuah transaction bisa masuk status rollback-only.

Artinya:

```text
Transaction masih berjalan secara stack/control flow,
tapi tidak boleh commit lagi.
Akhirnya hanya bisa rollback.
```

Contoh:

```java
@Transactional
public void process() {
    try {
        repository.save(invalidEntity);
        entityManager.flush();
    } catch (DataIntegrityViolationException ex) {
        // ditelan
    }

    repository.save(otherEntity);
    // method selesai normal, tapi transaction mungkin sudah rollback-only
}
```

Hasilnya bisa berupa exception saat commit, misalnya unexpected rollback.

Prinsip:

```text
Jangan menelan persistence exception di tengah transaction lalu lanjut seolah transaction masih sehat.
```

Jika ada error DB serius, biasanya transaction harus dianggap rusak dan use case harus gagal atau dipindah ke transaction baru dengan boundary jelas.

---

## 10. Declarative vs Programmatic Transaction

### 10.1 Declarative Transaction

Declarative transaction memakai metadata/annotation/config.

Spring:

```java
@Transactional
public void approve(Long id) {
    ...
}
```

Jakarta:

```java
@jakarta.transaction.Transactional
public void approve(Long id) {
    ...
}
```

Keunggulan:

- ringkas,
- konsisten,
- cocok untuk service use case,
- minim boilerplate.

Risiko:

- developer lupa proxy/self-invocation,
- rollback rules tidak dipahami,
- transaction terlalu besar,
- transaction tersebar tanpa desain,
- annotation dianggap menggantikan reasoning.

### 10.2 Programmatic Transaction

Spring `TransactionTemplate`:

```java
@Service
public class CaseImportService {

    private final TransactionTemplate transactionTemplate;

    public CaseImportService(TransactionTemplate transactionTemplate) {
        this.transactionTemplate = transactionTemplate;
    }

    public void importRows(List<CaseRow> rows) {
        for (CaseRow row : rows) {
            transactionTemplate.executeWithoutResult(status -> {
                Case c = Case.from(row);
                caseRepository.save(c);
                auditRepository.save(AuditTrail.imported(c));
            });
        }
    }
}
```

Cocok untuk:

- batch chunking,
- retry per item/chunk,
- transaction boundary dinamis,
- sebagian operasi perlu `REQUIRES_NEW`,
- lebih eksplisit dalam workflow kompleks.

Risiko:

- boilerplate,
- bisa tersebar jika tidak disiplin,
- nested logic susah dibaca.

### 10.3 Kapan Pilih Mana?

| Situation | Pilihan umum |
|---|---|
| Service use case sederhana | Declarative |
| CRUD/application command | Declarative |
| Batch per chunk | Programmatic atau declarative di method chunk |
| Retry controlled | Programmatic sering lebih jelas |
| Transaction boundary conditional | Programmatic |
| Cross-cutting transaction policy | Declarative |

---

## 11. Spring `@Transactional` vs Jakarta `@Transactional`

Ada dua annotation yang sering terlihat mirip:

```java
org.springframework.transaction.annotation.Transactional
```

```java
jakarta.transaction.Transactional
```

Keduanya bisa dipakai di konteks Spring tertentu, tetapi semantics dan attribute tidak identik.

### 11.1 Spring `@Transactional`

Contoh:

```java
import org.springframework.transaction.annotation.Transactional;

@Transactional(
    readOnly = true,
    timeout = 10,
    rollbackFor = BusinessException.class
)
public ApplicationDetail getDetail(Long id) {
    ...
}
```

Spring annotation punya fitur seperti:

- propagation,
- isolation,
- timeout,
- readOnly,
- rollbackFor/noRollbackFor,
- transaction manager qualifier.

### 11.2 Jakarta `@Transactional`

Contoh:

```java
import jakarta.transaction.Transactional;

@Transactional(Transactional.TxType.REQUIRED)
public void submit(Long id) {
    ...
}
```

Jakarta annotation lebih terkait dengan Jakarta Transactions/JTA model.

TxType umum:

- `REQUIRED`,
- `REQUIRES_NEW`,
- `MANDATORY`,
- `SUPPORTS`,
- `NOT_SUPPORTED`,
- `NEVER`.

### 11.3 Praktik di Spring Boot

Di aplikasi Spring, lebih umum memakai:

```java
org.springframework.transaction.annotation.Transactional
```

Alasannya:

- lebih lengkap untuk Spring transaction abstraction,
- jelas mengikuti Spring semantics,
- attribute seperti `readOnly`, `isolation`, `rollbackFor` familiar.

Tetapi di Jakarta EE/CDI/EJB environment, `jakarta.transaction.Transactional` adalah pilihan natural.

Prinsip:

```text
Jangan campur annotation transaction tanpa policy jelas.
```

Kalau codebase memakai Spring Boot, standardisasi biasanya ke Spring `@Transactional`. Kalau codebase Jakarta EE full, standardisasi ke Jakarta Transactions.

---

## 12. Transaction Propagation: Konsep Awal

Propagation menjawab:

```text
Jika method transactional dipanggil saat sudah ada transaction aktif, apa yang terjadi?
```

Detail mendalam akan dibahas di Part 025, tetapi fondasinya perlu dipahami sekarang.

### 12.1 REQUIRED

Pakai transaction yang ada, atau buat baru jika belum ada.

```java
@Transactional
public void approve(Long id) {
    updateStatus(id);      // ikut transaction yang sama
    writeAudit(id);        // ikut transaction yang sama
}
```

Ini default yang paling umum.

### 12.2 REQUIRES_NEW

Suspend transaction lama, buat transaction baru.

```java
@Transactional
public void approve(Long id) {
    application.approve();
    auditService.writeAuditRequiresNew(id);
    throw new RuntimeException("fail");
}
```

Jika audit memakai `REQUIRES_NEW`, audit bisa commit walaupun approval rollback.

Ini berguna untuk audit teknis tertentu, tetapi berbahaya jika dipakai tanpa reasoning karena bisa menciptakan data yang terlihat “sukses” padahal use case utama gagal.

### 12.3 NESTED

Nested transaction biasanya memakai savepoint dalam physical transaction yang sama.

Tidak sama dengan `REQUIRES_NEW`.

```text
Outer physical transaction
    savepoint A
        inner operation
    rollback to savepoint A
commit outer transaction
```

Support tergantung transaction manager/resource.

### 12.4 SUPPORTS, MANDATORY, NOT_SUPPORTED, NEVER

Ringkas:

| Propagation | Makna |
|---|---|
| SUPPORTS | Ikut transaction jika ada; kalau tidak ada, jalan non-transactional |
| MANDATORY | Harus sudah ada transaction; kalau tidak ada, error |
| NOT_SUPPORTED | Suspend transaction; jalan tanpa transaction |
| NEVER | Harus tidak ada transaction; kalau ada, error |

Propagation bukan dekorasi. Ia mengubah consistency boundary.

---

## 13. Rollback Rules

### 13.1 Spring Default

Dalam Spring declarative transaction, default umumnya:

```text
RuntimeException/Error → rollback
Checked exception → tidak rollback kecuali dikonfigurasi
```

Contoh:

```java
@Transactional
public void submit(Long id) throws BusinessCheckedException {
    application.submit();
    throw new BusinessCheckedException("invalid");
}
```

Jika tidak dikonfigurasi, checked exception bisa tidak menyebabkan rollback.

Maka perlu:

```java
@Transactional(rollbackFor = BusinessCheckedException.class)
public void submit(Long id) throws BusinessCheckedException {
    ...
}
```

### 13.2 Jakarta Transaction Rollback

Jakarta transaction annotation memiliki konsep rollback on/don't rollback on.

Contoh:

```java
@jakarta.transaction.Transactional(
    rollbackOn = BusinessException.class,
    dontRollbackOn = NonCriticalException.class
)
public void process() {
    ...
}
```

### 13.3 Design Rule

Jangan biarkan rollback behavior menjadi kebetulan.

Untuk command/use case penting, tentukan:

| Exception | Rollback? | Reason |
|---|---:|---|
| Validation/domain error sebelum perubahan | Biasanya tidak relevan / rollback aman |
| Constraint violation | Ya |
| Optimistic lock | Ya |
| Deadlock/timeout | Ya, mungkin retry |
| External API failure | Tergantung boundary; sering jangan panggil di dalam tx |
| Notification failure | Biasanya jangan rollback data utama; pakai outbox |
| Audit failure | Tergantung jenis audit; regulatory audit sering harus rollback use case |

---

## 14. Read-Only Transaction

`readOnly = true` sering disalahpahami sebagai:

```text
Database pasti menolak write.
```

Tidak selalu.

Dalam Spring/Hibernate, read-only bisa menjadi hint/optimization:

- provider bisa mengurangi dirty checking,
- connection/database bisa diberi read-only hint jika didukung,
- accidental write mungkin tetap terjadi tergantung stack/config.

Contoh:

```java
@Transactional(readOnly = true)
public ApplicationDetail getDetail(Long id) {
    Application app = repository.getRequired(id);
    return mapper.toDetail(app);
}
```

Manfaat:

- menandai intent,
- membantu optimization,
- memisahkan command vs query,
- membantu review architecture.

Namun jangan mengandalkan read-only transaction sebagai satu-satunya guard terhadap write. Untuk itu gunakan:

- code review,
- architecture rule,
- DB privilege read-only user untuk read replica,
- test,
- static analysis,
- separate query service.

---

## 15. Transaction Timeout

Transaction timeout membatasi berapa lama transaction boleh berjalan.

Contoh Spring:

```java
@Transactional(timeout = 10)
public void approve(Long id) {
    ...
}
```

Timeout penting karena transaction yang terlalu lama bisa menyebabkan:

- lock tertahan,
- connection pool habis,
- deadlock probability naik,
- undo/WAL pressure,
- replication lag,
- user request timeout,
- batch menahan resource terlalu lama.

Namun timeout bukan solusi utama untuk desain buruk. Timeout adalah safety net.

Jika transaction sering timeout, analisis:

1. Query lambat?
2. Missing index?
3. Lock wait?
4. External call di dalam transaction?
5. Batch terlalu besar?
6. Fetching terlalu banyak?
7. Transaction boundary terlalu lebar?
8. Deadlock/retry storm?

---

## 16. Isolation Level: Pengantar

Isolation level mengontrol visibility/anomaly antar transaction.

Common level:

- READ UNCOMMITTED,
- READ COMMITTED,
- REPEATABLE READ,
- SERIALIZABLE.

Spring contoh:

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void process() {
    ...
}
```

Tetapi behavior nyata tergantung database.

Contoh:

- Oracle memakai read consistency/MVCC dengan semantics tertentu.
- PostgreSQL memiliki MVCC dan Serializable Snapshot Isolation.
- MySQL InnoDB `REPEATABLE READ` punya gap/next-key locking behavior.
- SQL Server punya locking read committed dan optional snapshot isolation.

Jangan mengatakan:

```text
REPEATABLE_READ selalu mencegah semua phantom/lost update di semua DB.
```

Yang benar:

```text
Isolation harus dipahami per database engine dan per access pattern.
```

Part 012 akan fokus penuh ke ini.

---

## 17. Transaction Boundary Seharusnya Mengikuti Use Case

Kesalahan umum adalah menaruh transaction di repository/DAO kecil.

Contoh buruk:

```java
@Repository
public class ApplicationRepository {

    @Transactional
    public void updateStatus(...) { ... }

    @Transactional
    public void insertAudit(...) { ... }
}
```

Lalu service:

```java
public void submit(Long id) {
    repository.updateStatus(id, SUBMITTED);
    repository.insertAudit(id, "SUBMITTED");
}
```

Problem:

```text
updateStatus bisa commit, insertAudit gagal.
```

Use case kehilangan atomicity.

Lebih baik:

```java
@Service
public class ApplicationCommandService {

    @Transactional
    public void submit(Long id) {
        Application app = applicationRepository.getRequired(id);
        app.submit();
        auditTrailRepository.save(AuditTrail.submitted(app));
    }
}
```

Repository tidak perlu memutuskan transaction boundary use case. Repository mengelola persistence operation. Service/application layer mengelola unit of work.

Rule of thumb:

```text
Transaction boundary belongs to the application use case, not to individual table operation.
```

Namun ada exception:

- batch chunk method,
- infrastructure repository utility,
- explicit requires-new audit,
- framework-managed repository default transaction untuk simple CRUD.

Tetap, untuk sistem kompleks, boundary harus didesain di service/use case layer.

---

## 18. Transaction dan External Side Effect

External side effect adalah operasi di luar database transaction.

Contoh:

- send email,
- call payment API,
- call government/agency API,
- publish Kafka/RabbitMQ message tanpa transactional coordination,
- upload file,
- invalidate external cache,
- call search indexing service.

### 18.1 Problem: External Call di Dalam Transaction

```java
@Transactional
public void approve(Long id) {
    Application app = repository.getRequired(id);
    app.approve();

    externalAgencyClient.notifyApproved(app.getReferenceNo());

    auditRepository.save(...);
}
```

Failure matrix:

| Step | Outcome | Problem |
|---|---|---|
| DB update done in memory | External call fails | DB rollback mungkin terjadi; okay tetapi lock tertahan lama |
| External call succeeds | DB commit fails | External system percaya approved, DB tidak |
| External call slow | Transaction long-running | Lock/connection tertahan |
| Client retries | External call duplicated | Duplicate side effect |

### 18.2 Better: Outbox

```java
@Transactional
public void approve(Long id) {
    Application app = repository.getRequired(id);
    app.approve();

    auditRepository.save(AuditTrail.approved(app));
    outboxRepository.save(OutboxEvent.applicationApproved(app));
}
```

Setelah commit, worker membaca outbox dan mengirim notification.

```text
DB transaction commits:
  application status approved
  audit inserted
  outbox event inserted

Async publisher:
  reads outbox
  calls external system
  marks sent/retry
```

Ini tidak membuat external call atomic dengan DB, tetapi membuat intent untuk external call durable dan retryable.

Part 026 akan membahas outbox/inbox/CDC/idempotency secara mendalam.

---

## 19. Transaction dan Messaging

Messaging sering menipu karena terlihat seperti write biasa.

```java
@Transactional
public void submit(Long id) {
    application.submit();
    kafkaTemplate.send("application-submitted", event);
}
```

Pertanyaan penting:

1. Apakah message publish ikut transaction DB?
2. Jika DB rollback, apakah message batal?
3. Jika message terkirim tetapi DB commit gagal, apa yang terjadi?
4. Jika DB commit sukses tetapi send gagal, bagaimana recovery?
5. Jika consumer menerima duplicate, apakah idempotent?

Dalam banyak sistem, jawaban aman adalah:

```text
Jangan publish message langsung sebagai bagian dari DB transaction kecuali transactional semantics-nya benar-benar dipahami.
```

Gunakan outbox untuk event yang harus konsisten dengan state DB.

---

## 20. Transaction dan Cache

Cache juga side effect.

Contoh problem:

```java
@Transactional
public void updateProfile(Long id, UpdateProfileCommand command) {
    Profile profile = repository.getRequired(id);
    profile.update(command);

    redisTemplate.delete("profile:" + id);
}
```

Jika Redis delete sukses lalu DB rollback, cache sudah invalidated padahal DB tidak berubah. Ini biasanya tidak fatal, tapi bisa menyebabkan miss berlebih.

Lebih serius:

```java
redisTemplate.opsForValue().set("profile:" + id, newValue);
```

Jika DB rollback, cache berisi data yang tidak pernah commit.

Strategi:

- invalidate after commit,
- transaction synchronization callback,
- outbox-based cache invalidation,
- cache-aside dengan TTL,
- avoid cache mutation before commit.

Dalam Spring, bisa menggunakan transaction synchronization untuk after-commit action, tetapi harus hati-hati: after-commit action bisa gagal dan tidak bisa rollback DB.

---

## 21. Transaction Synchronization

Transaction synchronization adalah hook untuk menjalankan logic pada fase transaction tertentu.

Contoh fase umum:

- before commit,
- after commit,
- after rollback,
- after completion.

Use case:

- publish domain event after commit,
- clear local cache after rollback,
- trigger async task after commit,
- record metrics,
- cleanup resource.

Spring menyediakan mekanisme seperti `TransactionSynchronizationManager` dan transactional event listener.

Contoh konsep:

```java
@Transactional
public void approve(Long id) {
    Application app = repository.getRequired(id);
    app.approve();

    eventPublisher.publishEvent(new ApplicationApprovedEvent(id));
}
```

Dengan listener:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onApproved(ApplicationApprovedEvent event) {
    notificationService.notifyApproved(event.applicationId());
}
```

Ini lebih baik daripada menjalankan notification sebelum commit, tetapi tetap ada limitation:

```text
Jika after-commit notification gagal, DB sudah commit.
```

Untuk side effect penting dan harus retryable, outbox lebih kuat.

---

## 22. Transaction dan Connection Pool

Setiap active database transaction memakai connection.

```text
Active transaction = connection borrowed from pool
```

Jika transaction lambat, connection tertahan.

Contoh incident pattern:

```text
Pool size = 50
50 request menjalankan transaction panjang
semua connection habis
request baru menunggu
thread menumpuk
API timeout
retry dari client masuk
beban makin tinggi
```

Penyebab transaction panjang:

- query lambat,
- N+1,
- external HTTP call di dalam transaction,
- batch terlalu besar,
- lock wait,
- user think-time dalam transaction,
- remote file upload/download,
- long streaming response.

Rule:

```text
Transaction harus pendek, bounded, dan tidak menunggu sistem eksternal tanpa alasan kuat.
```

Observability penting:

- active connections,
- idle connections,
- pending acquisition,
- connection acquisition timeout,
- transaction duration,
- slow query,
- lock wait,
- request latency.

---

## 23. Transaction dan Long Conversation

Kadang business process berlangsung lama:

```text
User buka form → edit 20 menit → submit → reviewer approve besok
```

Jangan membuat database transaction hidup selama 20 menit atau sampai besok.

Bedakan:

```text
Database transaction:
  pendek, detik/sub-detik, menjaga atomicity update DB

Business transaction/conversation:
  panjang, bisa menit/hari/minggu, terdiri dari banyak DB transaction
```

Contoh regulatory workflow:

```text
DB transaction 1: create draft
DB transaction 2: submit application
DB transaction 3: assign reviewer
DB transaction 4: request clarification
DB transaction 5: applicant responds
DB transaction 6: approve/reject
```

Consistency antar langkah dijaga oleh:

- status/state machine,
- optimistic locking,
- audit trail,
- authorization,
- invariant guard,
- idempotency key,
- outbox event,
- SLA timer/job.

Bukan oleh satu DB transaction raksasa.

---

## 24. Transaction dalam Web Request

Pattern umum:

```text
HTTP request
    ↓
Controller
    ↓
Service @Transactional
    ↓
Repository/JPA
    ↓
Commit before response
```

Ini disebut transaction-per-request atau session-per-request dalam beberapa konteks.

Namun jangan salah:

```text
Transaction tidak harus membungkus seluruh HTTP request dari awal sampai response serialization selesai.
```

Lebih baik:

```text
Controller menerima request
    ↓
Service transactional menjalankan use case
    ↓
Commit selesai
    ↓
Controller membentuk response DTO
```

Jika memakai Open Session in View, persistence context bisa tetap terbuka sampai view rendering/JSON serialization. Ini nyaman untuk lazy loading, tetapi bisa menyembunyikan boundary buruk dan menyebabkan query tambahan saat serialization.

Rule:

```text
Command transaction sebaiknya selesai sebelum response final dikirim.
Read query sebaiknya punya fetch/projection eksplisit.
```

---

## 25. Transaction dalam Batch Job

Batch job berbeda dari request biasa.

Buruk:

```java
@Transactional
public void importAll(List<Row> rows) {
    for (Row row : rows) {
        repository.save(convert(row));
    }
}
```

Problem:

- transaction terlalu besar,
- persistence context membengkak,
- lock lama,
- rollback semua jika satu row gagal,
- retry mahal,
- undo/WAL pressure.

Lebih baik:

```text
Read input
    ↓
Process chunk 1 in tx
commit
    ↓
Process chunk 2 in tx
commit
    ↓
Process chunk 3 in tx
commit
```

Contoh:

```java
public void importRows(List<Row> rows) {
    Lists.partition(rows, 500).forEach(chunk -> {
        transactionTemplate.executeWithoutResult(status -> {
            for (Row row : chunk) {
                repository.save(convert(row));
            }
            entityManager.flush();
            entityManager.clear();
        });
    });
}
```

Batch transaction harus mempertimbangkan:

- chunk size,
- retry strategy,
- idempotency,
- checkpoint,
- partial failure,
- unique constraint,
- duplicate input,
- performance metrics.

---

## 26. Transaction dalam Message Consumer

Message consumer sering punya transaction boundary sendiri.

Contoh:

```text
Receive message
    ↓
Begin DB transaction
    ↓
Apply state change
    ↓
Insert inbox/dedup record
    ↓
Commit DB transaction
    ↓
Ack message
```

Failure matrix:

| Failure | Consequence | Mitigation |
|---|---|---|
| DB commit gagal | message tidak di-ack, akan retry | idempotent logic |
| DB commit sukses, ack gagal | message dikirim ulang | inbox/dedup key |
| Consumer crash after commit before ack | duplicate delivery | idempotency |
| Poison message | infinite retry | DLQ, retry limit |

Rule:

```text
Message processing harus diasumsikan at-least-once kecuali benar-benar terbukti lain.
```

Karena itu transaction di consumer harus selalu dipasangkan dengan idempotency.

---

## 27. Transaction Status dan Lifecycle

Secara konseptual, transaction punya state:

```text
No transaction
    ↓ begin
Active
    ↓ mark rollback-only? ───→ Rollback-only
    ↓ commit requested           ↓ completion
Committing                    Rolling back
    ↓                            ↓
Committed                    Rolled back
```

Dalam aplikasi, kamu jarang berinteraksi langsung dengan state ini, tetapi penting untuk debugging.

Contoh bug:

```java
@Transactional
public void outer() {
    try {
        innerRequired();
    } catch (Exception ex) {
        // swallowed
    }
}

@Transactional
public void innerRequired() {
    repository.save(invalidEntity);
    entityManager.flush();
}
```

Karena `innerRequired()` ikut transaction yang sama, error bisa menandai transaction rollback-only. Walau outer selesai normal, commit tetap gagal.

---

## 28. Transaction dan Exception Translation

Persistence layer menghasilkan exception dari banyak level:

```text
Database vendor error
    ↓
JDBC SQLException
    ↓
Hibernate/JPA exception
    ↓
Spring DataAccessException, jika memakai Spring
```

Contoh:

| Failure | JPA/Hibernate/Spring style |
|---|---|
| Unique constraint violation | constraint violation / data integrity violation |
| Optimistic lock conflict | optimistic lock exception |
| Deadlock | transient/data access resource failure/deadlock loser style |
| Lock timeout | pessimistic lock/lock timeout/query timeout |
| SQL syntax error | SQL grammar exception |
| Connection lost | resource failure |

Design yang baik mengklasifikasikan exception:

| Category | Retry? | User message |
|---|---:|---|
| Validation/domain error | Tidak | input/business message |
| Unique violation | Tidak, kecuali idempotency case | duplicate/conflict |
| Optimistic lock | Mungkin user retry/manual reload | data changed by someone else |
| Deadlock | Ya dengan bounded retry | temporary conflict |
| Lock timeout | Ya/No tergantung use case | resource busy |
| DB unavailable | Ya di infrastructure level | temporary system issue |
| SQL grammar/mapping bug | Tidak | internal error |

Part 029 akan membahas exception/failure classification secara penuh.

---

## 29. Transaction dan Invariant

Transaction boundary harus dipilih berdasarkan invariant.

Contoh invariant:

```text
Saat application submitted:
- status berubah dari DRAFT ke SUBMITTED
- submittedAt terisi
- submittedBy terisi
- audit trail tertulis
- application number final tidak duplicate
- outbox event tertulis
```

Maka semua itu harus satu transaction.

```java
@Transactional
public SubmitResult submit(SubmitCommand command) {
    Application app = applicationRepository.getRequired(command.applicationId());

    app.submit(command.actorId(), clock.instant());

    auditTrailRepository.save(AuditTrail.submitted(app, command.actorId()));
    outboxRepository.save(OutboxEvent.applicationSubmitted(app));

    return SubmitResult.from(app);
}
```

Jangan memecah menjadi beberapa transaction hanya karena repository berbeda.

Sebaliknya, jangan memasukkan operasi yang bukan bagian invariant ke transaction utama.

Contoh bukan bagian invariant:

- send email,
- update search index,
- invalidate analytics cache,
- notify external dashboard.

Itu bisa mengikuti after-commit/outbox.

---

## 30. Transaction dan State Machine

Dalam case management, transaction biasanya menjaga state transition.

Contoh state:

```text
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED
                          ↓
                       REJECTED
```

Transition harus atomic:

```text
current status checked
new status set
audit trail inserted
actor/action/reason recorded
version incremented
outbox event inserted
commit
```

Contoh:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    Case c = caseRepository.getRequired(command.caseId());

    c.approve(command.actorId(), command.reason(), clock.instant());

    auditRepository.save(AuditTrail.caseApproved(c, command));
    outboxRepository.save(OutboxEvent.caseApproved(c));
}
```

Concurrency problem:

```text
Reviewer A approves
Reviewer B rejects at the same time
```

Transaction saja belum cukup jika isolation/versioning tidak benar. Gunakan:

- `@Version`,
- conditional update,
- pessimistic lock untuk high contention,
- database constraint jika memungkinkan,
- idempotency key untuk duplicate command.

---

## 31. Transaction dan Audit Trail

Audit trail sering harus berada di transaction yang sama dengan business change.

Kalau tidak:

```text
Business row updated
Audit insert failed
Commit tetap sukses
```

Hasilnya regulatory trace hilang.

Untuk audit yang wajib:

```java
@Transactional
public void approve(...) {
    case.approve(...);
    auditRepository.save(...); // wajib satu transaction
}
```

Jika audit gagal, use case seharusnya rollback.

Tetapi ada jenis log yang tidak harus transactional:

| Jenis | Harus satu transaction? |
|---|---:|
| Regulatory audit trail | Ya, biasanya wajib |
| Security audit critical | Sering ya / reliable async |
| Debug log | Tidak |
| Metrics | Tidak |
| Analytics event | Tidak selalu |
| Notification history | Tergantung requirement |

Jangan samakan semua “log”.

---

## 32. Transaction dan Idempotency

Transaction tidak otomatis membuat endpoint idempotent.

Contoh:

```text
Client submit request
DB commit sukses
HTTP response lost
Client retry
```

Tanpa idempotency, retry bisa membuat duplicate:

- duplicate application,
- duplicate payment,
- duplicate audit,
- duplicate event,
- duplicate notification.

Solusi:

```text
Idempotency key + unique constraint + transaction
```

Contoh:

```java
@Transactional
public SubmitResult submit(SubmitCommand command) {
    Optional<ProcessedCommand> existing = processedCommandRepository.findByKey(command.idempotencyKey());
    if (existing.isPresent()) {
        return existing.get().toResult();
    }

    Application app = Application.submit(command);
    applicationRepository.save(app);

    processedCommandRepository.save(ProcessedCommand.success(command.idempotencyKey(), app.getId()));

    return SubmitResult.from(app);
}
```

Database unique constraint pada idempotency key penting agar concurrent duplicate request tidak lolos.

---

## 33. Transaction dan Savepoint

Savepoint memungkinkan rollback sebagian dalam transaction.

JDBC style:

```java
connection.setAutoCommit(false);
Savepoint sp = connection.setSavepoint();
try {
    // partial work
} catch (Exception ex) {
    connection.rollback(sp);
}
connection.commit();
```

Spring `PROPAGATION_NESTED` biasanya memanfaatkan savepoint jika supported.

Use case:

- partial failure dalam batch kecil,
- optional operation dalam transaction besar,
- validasi sebagian data.

Risiko:

- tidak semua transaction manager mendukung,
- persistence context state bisa membingungkan jika DB rollback ke savepoint tetapi entity managed masih berubah,
- lebih sulit di-debug.

Rule:

```text
Savepoint adalah tool advanced. Jangan dipakai untuk menutupi boundary yang salah.
```

---

## 34. Transaction dan Flush Mode

JPA punya flush mode, umumnya:

- `AUTO`,
- `COMMIT`.

Hibernate punya mode tambahan/provider-specific.

### 34.1 AUTO

Provider boleh flush sebelum query agar query melihat perubahan yang relevan.

```java
@Transactional
public void example() {
    Application app = em.find(Application.class, 1L);
    app.submit();

    // query ini bisa memicu flush sebelum SELECT
    long count = em.createQuery(
        "select count(a) from Application a where a.status = 'SUBMITTED'",
        Long.class
    ).getSingleResult();
}
```

### 34.2 COMMIT

Flush ditunda sampai commit, dengan caveat provider behavior.

### 34.3 Why It Matters

Flush bisa membuat error muncul lebih awal.

```java
@Transactional
public void createInvalid() {
    repository.save(invalidEntity);

    // error mungkin belum muncul

    entityManager.flush();
    // constraint violation muncul di sini
}
```

Flush mode memengaruhi:

- kapan SQL dikirim,
- kapan constraint violation muncul,
- query result consistency,
- performance,
- batching.

---

## 35. Transaction dan Bulk Operation

Bulk JPQL/native update/delete bypass persistence context.

Contoh:

```java
@Transactional
public void bulkCloseExpired() {
    List<Application> apps = em.createQuery(
        "select a from Application a where a.status = :status",
        Application.class
    ).setParameter("status", Status.EXPIRED)
     .getResultList();

    em.createQuery("update Application a set a.status = :closed where a.status = :expired")
      .setParameter("closed", Status.CLOSED)
      .setParameter("expired", Status.EXPIRED)
      .executeUpdate();

    // apps di persistence context bisa stale
}
```

Setelah bulk operation, managed entities bisa tidak sinkron dengan database.

Strategi:

- flush sebelum bulk,
- clear setelah bulk,
- jangan campur bulk operation dengan entity manipulation dalam persistence context yang sama tanpa alasan kuat,
- gunakan transaction boundary terpisah.

---

## 36. Transaction dan DDL

DDL behavior dalam transaction tergantung database.

Contoh:

- PostgreSQL mendukung transactional DDL untuk banyak operasi.
- Oracle melakukan implicit commit untuk banyak DDL.
- MySQL behavior tergantung engine/statement.

Jangan menjalankan schema migration sembarangan di tengah application transaction.

Migration harus dikelola oleh:

- Flyway,
- Liquibase,
- deployment process,
- controlled maintenance window/zero-downtime migration strategy.

Part 017 akan membahas schema migration.

---

## 37. Transaction dan Security/Authorization

Authorization check sering harus berada sebelum mutation.

```java
@Transactional
public void approve(ApproveCommand command) {
    Case c = caseRepository.getRequired(command.caseId());

    authorizationService.assertCanApprove(command.actor(), c);

    c.approve(command.actor(), command.reason());
    auditRepository.save(AuditTrail.approved(c, command.actor()));
}
```

Tetapi ada nuance:

- Jika authorization tergantung state entity, baca state dalam transaction.
- Jika state bisa berubah concurrent, gunakan version/lock.
- Audit unauthorized attempt mungkin perlu transaction terpisah atau security audit mechanism.

Rule:

```text
Authorization decision dan state mutation harus melihat state yang konsisten.
```

---

## 38. Transaction dan Time

Timestamp dalam transaction bisa berasal dari:

- application clock,
- database current timestamp,
- transaction start timestamp,
- statement timestamp,
- external system timestamp.

Contoh:

```java
Instant now = clock.instant();
app.submit(actorId, now);
auditRepository.save(AuditTrail.submitted(app, actorId, now));
```

Praktik baik:

- gunakan satu timestamp untuk satu logical action,
- inject `Clock` untuk testability,
- jangan panggil `Instant.now()` berkali-kali untuk event yang sama jika butuh konsistensi,
- tentukan apakah authoritative time adalah app atau DB.

Untuk audit/regulatory, timestamp semantics harus jelas.

---

## 39. Transaction dan Generated ID

Generated ID bisa muncul sebelum commit.

Contoh sequence:

```java
Application app = new Application(...);
em.persist(app);
Long id = app.getId(); // bisa sudah ada sebelum commit
```

Tetapi:

```text
ID sudah ada bukan berarti row sudah committed.
```

Dengan identity column, insert mungkin harus dieksekusi lebih cepat untuk mendapatkan ID, yang bisa memengaruhi batching.

Design implication:

- Jangan publish event ke luar hanya karena ID sudah tersedia.
- Jangan menganggap generated number berurutan tanpa gap.
- Sequence bisa punya gap karena rollback/cache.
- Business reference number sebaiknya didesain berbeda dari technical PK jika harus punya semantics khusus.

---

## 40. Transaction dan Retry

Tidak semua failure boleh retry.

Retry aman jika operasi idempotent atau dilindungi idempotency key.

| Failure | Retry? | Catatan |
|---|---:|---|
| Deadlock | Ya, bounded retry |
| Serialization failure | Ya, umum di isolation tinggi |
| Lock timeout | Tergantung use case |
| Connection transient failure | Ya, tapi hati-hati outcome unknown |
| Unique constraint violation | Biasanya tidak; kecuali idempotency lookup |
| Validation error | Tidak |
| Mapping bug | Tidak |
| External API 5xx | Retry di luar DB tx, dengan idempotency |

Danger:

```text
Retry seluruh method yang punya external side effect non-idempotent.
```

Contoh buruk:

```java
@Retryable
@Transactional
public void payAndRecord(...) {
    paymentClient.charge(...); // non-idempotent
    paymentRepository.save(...);
}
```

Jika DB gagal setelah charge sukses, retry bisa charge dua kali.

---

## 41. Transaction di Java 8 sampai Java 25

Konsep transaction tidak berubah drastis karena Java version, tetapi runtime/platform berubah.

### 41.1 Java 8 Era

Umum:

- Java EE / JPA 2.1/2.2,
- `javax.persistence`,
- `javax.transaction`,
- Hibernate 4/5,
- Spring Framework 4/5,
- Spring Boot 1/2.

Code:

```java
import javax.persistence.EntityManager;
import javax.transaction.Transactional;
```

atau Spring:

```java
import org.springframework.transaction.annotation.Transactional;
```

### 41.2 Java 11/17 Era

Transisi besar:

- Jakarta namespace mulai dominan,
- Spring Boot 3 memakai `jakarta.*`,
- Hibernate 6 memakai Jakarta Persistence,
- Java baseline naik.

Code:

```java
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
```

### 41.3 Java 21/25 Era

Pertimbangan modern:

- virtual threads bisa meningkatkan concurrency request,
- tetapi DB connection tetap resource terbatas,
- transaction tetap harus pendek,
- blocking JDBC masih memakai connection fisik,
- concurrency tinggi tanpa pool sizing/backpressure bisa mempercepat connection exhaustion.

Mental model:

```text
Virtual threads membuat thread lebih murah, bukan membuat database transaction lebih murah.
```

Jika request concurrency naik drastis, transaction dan connection pool discipline makin penting.

---

## 42. Common Anti-Patterns

### 42.1 Transaction di Semua Method

```java
@Transactional
public void helper() { ... }
```

Tanpa reasoning, ini membuat boundary kabur.

### 42.2 Transaction Terlalu Lebar

```java
@Transactional
public void process() {
    loadData();
    callExternalApi();
    generatePdf();
    uploadFile();
    updateDatabase();
    sendEmail();
}
```

Problem:

- lock/connection lama,
- side effect tidak rollbackable,
- timeout,
- retry bahaya.

### 42.3 Transaction Terlalu Sempit

```java
updateMainRecord(); // tx 1
insertAudit();      // tx 2
insertOutbox();     // tx 3
```

Problem:

- invariant pecah,
- audit/outbox bisa hilang.

### 42.4 Menelan Exception Persistence

```java
try {
    repository.save(entity);
    em.flush();
} catch (Exception ignored) {
}
```

Problem:

- transaction rollback-only,
- state persistence context tidak sehat,
- data partial assumption salah.

### 42.5 Mengandalkan `save()` sebagai Commit

```java
repository.save(entity);
callExternalApi(); // mengira DB sudah final
```

Problem:

- commit belum terjadi.

### 42.6 External API di Dalam Transaction

Sudah dibahas: lock lama, inconsistent side effect.

### 42.7 Self-Invocation di Spring

```java
@Service
public class MyService {
    public void outer() {
        inner(); // tidak melewati proxy
    }

    @Transactional
    public void inner() {
        ...
    }
}
```

Dalam proxy-based Spring transaction, call internal seperti ini bisa tidak menerapkan transaction.

### 42.8 Async di Dalam Transaction Tanpa Context

```java
@Transactional
public void process() {
    repository.save(entity);
    CompletableFuture.runAsync(() -> repository.save(other));
}
```

Transaction context thread-bound tidak otomatis pindah ke thread lain.

### 42.9 Long User Interaction Transaction

Membuka transaction saat user edit form adalah desain buruk.

### 42.10 Distributed Transaction sebagai Default

Memakai XA untuk semua hal tanpa memahami operational cost bisa menciptakan sistem rapuh.

---

## 43. Production Failure Modes

### 43.1 Connection Pool Exhaustion

Gejala:

- request timeout,
- Hikari connection timeout,
- active connection = max pool,
- pending threads naik.

Kemungkinan penyebab:

- transaction panjang,
- query lambat,
- lock wait,
- external call dalam transaction,
- leak connection,
- pool terlalu kecil untuk workload,
- retry storm.

### 43.2 Lock Storm

Gejala:

- banyak session menunggu lock,
- API tertentu lambat,
- deadlock meningkat,
- CPU belum tentu tinggi.

Penyebab:

- update hot row,
- transaction terlalu lama,
- tidak ada deterministic update order,
- batch update besar,
- missing index pada FK/filter lock query.

### 43.3 Unexpected Rollback

Gejala:

- method selesai normal,
- commit gagal karena rollback-only.

Penyebab:

- exception internal ditelan,
- inner transaction ikut REQUIRED dan gagal,
- persistence error setelah flush.

### 43.4 Duplicate Side Effect

Gejala:

- email terkirim dua kali,
- message duplicate,
- external status double update.

Penyebab:

- retry tanpa idempotency,
- external call sebelum commit,
- consumer at-least-once tanpa inbox.

### 43.5 Data Committed Without Audit

Gejala:

- status berubah tapi audit trail tidak ada.

Penyebab:

- audit transaction terpisah,
- audit async tidak reliable,
- exception audit ditelan.

### 43.6 Stale Read After Bulk Update

Gejala:

- query DB benar,
- object di memory masih status lama.

Penyebab:

- bulk update bypass persistence context,
- persistence context tidak clear/refresh.

---

## 44. Observability untuk Transaction

Untuk production, jangan hanya log “transaction failed”.

Log/metric yang berguna:

### 44.1 Application Level

- use case name,
- correlation id,
- actor/user/system id,
- aggregate/entity id,
- command id/idempotency key,
- transaction duration,
- retry count,
- exception class,
- rollback reason.

### 44.2 Persistence Level

- SQL count per request,
- flush count,
- entity load count,
- dirty entity count,
- batch size,
- slow query,
- query timeout,
- lock timeout.

### 44.3 Pool Level

- active connections,
- idle connections,
- pending acquisition,
- acquisition timeout,
- max lifetime events,
- connection usage duration.

### 44.4 Database Level

- active sessions,
- blocking sessions,
- lock waits,
- deadlocks,
- long transactions,
- undo/WAL pressure,
- CPU/I/O wait,
- slow execution plans.

### 44.5 Event/Outbox Level

- outbox pending count,
- oldest unsent event age,
- retry count,
- DLQ count,
- duplicate/inbox hit count.

---

## 45. Design Heuristics

### 45.1 One Use Case, One Transaction — as a Starting Point

Untuk command biasa:

```text
One application command = one transaction
```

Contoh:

- submit application,
- approve case,
- reject appeal,
- assign reviewer,
- update profile.

Tetapi ini bukan hukum absolut.

Split transaction jika:

- batch besar,
- side effect external,
- workflow panjang,
- operation perlu independent audit,
- retry per item,
- command terdiri dari durable steps.

### 45.2 Keep Transaction Short

Transaction sebaiknya:

- tidak menunggu user,
- tidak menunggu external API jika bisa dihindari,
- tidak generate file besar,
- tidak melakukan CPU-heavy work lama,
- tidak memproses ribuan row tanpa chunking.

### 45.3 Put Required Invariants Inside Transaction

Jika sesuatu harus selalu konsisten bersama, masukkan dalam transaction yang sama.

Contoh:

- status + audit + outbox,
- parent + child mandatory rows,
- sequence allocation + record creation,
- idempotency record + result.

### 45.4 Put Non-Rollbackable Side Effects After Commit

Gunakan:

- outbox,
- after commit hook untuk non-critical side effect,
- async worker,
- idempotency.

### 45.5 Treat Unknown Commit Outcome Carefully

Kadang aplikasi tidak tahu apakah commit berhasil karena network failure saat commit.

Untuk command penting, gunakan:

- idempotency key,
- unique business reference,
- reconciliation query,
- retry dengan lookup existing result.

---

## 46. Example: Submit Application Transaction

### 46.1 Requirements

Use case:

```text
Applicant submits draft application.
```

Invariant:

1. Application must exist.
2. Current status must be DRAFT or CLARIFICATION_REQUESTED.
3. Required fields must be complete.
4. Status becomes SUBMITTED.
5. submittedAt/submittedBy are recorded.
6. Audit trail is inserted.
7. Outbox event is inserted.
8. Duplicate submit command must not create duplicate event.

### 46.2 Entity Method

```java
@Entity
@Table(name = "application")
public class Application {

    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private ApplicationStatus status;

    private Instant submittedAt;
    private String submittedBy;

    public void submit(String actorId, Instant now) {
        if (!(status == ApplicationStatus.DRAFT || status == ApplicationStatus.CLARIFICATION_REQUESTED)) {
            throw new IllegalStateException("Application cannot be submitted from status " + status);
        }

        validateCompleteness();

        this.status = ApplicationStatus.SUBMITTED;
        this.submittedAt = now;
        this.submittedBy = actorId;
    }

    private void validateCompleteness() {
        // domain-level completeness checks
    }
}
```

### 46.3 Service Transaction

```java
@Service
public class SubmitApplicationService {

    private final ApplicationRepository applicationRepository;
    private final AuditTrailRepository auditTrailRepository;
    private final OutboxRepository outboxRepository;
    private final ProcessedCommandRepository processedCommandRepository;
    private final Clock clock;

    public SubmitApplicationService(
            ApplicationRepository applicationRepository,
            AuditTrailRepository auditTrailRepository,
            OutboxRepository outboxRepository,
            ProcessedCommandRepository processedCommandRepository,
            Clock clock
    ) {
        this.applicationRepository = applicationRepository;
        this.auditTrailRepository = auditTrailRepository;
        this.outboxRepository = outboxRepository;
        this.processedCommandRepository = processedCommandRepository;
        this.clock = clock;
    }

    @Transactional
    public SubmitApplicationResult submit(SubmitApplicationCommand command) {
        return processedCommandRepository.findResult(command.idempotencyKey())
                .orElseGet(() -> processNewCommand(command));
    }

    private SubmitApplicationResult processNewCommand(SubmitApplicationCommand command) {
        Application application = applicationRepository.getRequired(command.applicationId());

        Instant now = clock.instant();
        application.submit(command.actorId(), now);

        auditTrailRepository.save(AuditTrail.applicationSubmitted(
                application.getId(),
                command.actorId(),
                now
        ));

        outboxRepository.save(OutboxEvent.applicationSubmitted(
                application.getId(),
                command.actorId(),
                now
        ));

        SubmitApplicationResult result = SubmitApplicationResult.from(application);

        processedCommandRepository.save(ProcessedCommand.success(
                command.idempotencyKey(),
                result
        ));

        return result;
    }
}
```

### 46.4 Why This Boundary Makes Sense

All critical state changes are atomic:

```text
application status
+ audit trail
+ outbox event
+ idempotency record
```

External notification is not called here. It is driven later by outbox publisher.

Concurrency is handled by:

- `@Version`,
- DB transaction,
- unique idempotency key,
- state transition guard.

---

## 47. Example: Wrong Boundary vs Better Boundary

### 47.1 Wrong Boundary

```java
public void approve(Long id) {
    applicationRepository.markApproved(id); // transaction 1
    auditRepository.insertApproved(id);     // transaction 2
    notificationClient.notifyApproved(id);  // external
}
```

Failure:

```text
markApproved commit sukses
insertApproved gagal
notification tidak terkirim
```

Result:

- status approved,
- audit missing,
- external notification missing.

### 47.2 Better Boundary

```java
@Transactional
public void approve(Long id, String actorId) {
    Application app = applicationRepository.getRequired(id);
    app.approve(actorId, clock.instant());

    auditRepository.save(AuditTrail.approved(app, actorId));
    outboxRepository.save(OutboxEvent.applicationApproved(app));
}
```

External notification:

```java
public void publishOutbox() {
    List<OutboxEvent> events = outboxRepository.findPendingBatch();
    for (OutboxEvent event : events) {
        notificationClient.notify(event);
        outboxRepository.markSent(event.id());
    }
}
```

Real production version needs retry, locking, idempotency, and error handling. But boundary is now sound.

---

## 48. Checklist Transaction Design

Gunakan checklist ini saat mendesain command/use case.

### 48.1 Boundary Checklist

- [ ] Apa nama use case/command-nya?
- [ ] State apa saja yang harus berubah secara atomic?
- [ ] Audit apa yang wajib satu transaction?
- [ ] Outbox/event apa yang harus durable bersama state?
- [ ] Apakah ada external side effect?
- [ ] Apakah external side effect sudah dipindah after commit/outbox?
- [ ] Apakah transaction terlalu besar?
- [ ] Apakah ada user wait/external wait di dalam transaction?
- [ ] Apakah batch perlu chunking?

### 48.2 Consistency Checklist

- [ ] Invariant apa yang dijaga?
- [ ] Apakah invariant hanya di aplikasi atau juga ada DB constraint?
- [ ] Apakah ada race condition?
- [ ] Apakah perlu optimistic locking?
- [ ] Apakah perlu pessimistic locking?
- [ ] Apakah isolation default DB cukup?
- [ ] Apakah ada unique constraint untuk idempotency/business key?

### 48.3 Failure Checklist

- [ ] Jika commit gagal, apa yang terjadi?
- [ ] Jika response HTTP hilang setelah commit, apakah retry aman?
- [ ] Jika external API gagal, apakah DB tetap commit?
- [ ] Jika message duplicate, apakah consumer idempotent?
- [ ] Jika audit gagal, apakah use case harus rollback?
- [ ] Jika transaction timeout, apakah retry aman?
- [ ] Jika deadlock, apakah bounded retry aman?

### 48.4 Observability Checklist

- [ ] Correlation id ada?
- [ ] Command/idempotency key ada?
- [ ] Transaction duration terukur?
- [ ] SQL count/logging cukup?
- [ ] Lock wait bisa dilihat?
- [ ] Connection pool metrics aktif?
- [ ] Outbox backlog dimonitor?

---

## 49. Latihan / Scenario

### Scenario 1 — Approve Case

Requirement:

```text
Reviewer approve case.
Status berubah ke APPROVED.
Audit wajib tertulis.
Email applicant harus dikirim.
External agency harus diberi tahu.
```

Pertanyaan:

1. Operasi mana yang harus satu DB transaction?
2. Operasi mana yang sebaiknya outbox?
3. Apa yang terjadi jika email gagal?
4. Apa yang terjadi jika external agency timeout?
5. Bagaimana mencegah approve dua kali karena retry?
6. Bagaimana menangani reviewer A approve dan reviewer B reject bersamaan?

Jawaban arah:

- status + audit + outbox + idempotency satu transaction,
- email/external notify via outbox worker,
- use `@Version` atau conditional update,
- idempotency key/unique transition event,
- external notification idempotent.

### Scenario 2 — Import 1 Juta Row

Requirement:

```text
Import file besar ke database.
Setiap row valid dimasukkan.
Row invalid dicatat.
Job bisa resume.
```

Pertanyaan:

1. Apakah semua row satu transaction?
2. Berapa chunk size?
3. Bagaimana flush/clear?
4. Bagaimana handle duplicate file retry?
5. Bagaimana mencatat invalid row?

Jawaban arah:

- jangan satu transaction besar,
- chunk transaction,
- checkpoint,
- idempotency per file/row,
- invalid row table/log dengan boundary jelas.

### Scenario 3 — Payment-like External Call

Requirement:

```text
User bayar invoice.
Aplikasi call payment provider.
Jika payment sukses, invoice PAID.
```

Pertanyaan:

1. Bolehkah charge payment di dalam DB transaction?
2. Apa failure jika charge sukses tapi DB commit gagal?
3. Apa failure jika DB commit sukses tapi response payment hilang?
4. Bagaimana idempotency payment?

Jawaban arah:

- payment provider harus dipanggil dengan idempotency key,
- model state: PAYMENT_PENDING, PAID, FAILED,
- jangan mengandalkan DB rollback untuk membatalkan charge,
- reconciliation/webhook/inbox diperlukan.

### Scenario 4 — Audit Must Never Be Missing

Requirement:

```text
Setiap status change harus punya audit trail.
```

Pertanyaan:

1. Apakah audit async boleh?
2. Jika audit insert gagal, apakah status change boleh commit?
3. Apakah DB constraint bisa membantu?
4. Bagaimana detect audit gap?

Jawaban arah:

- audit wajib satu transaction untuk critical transition,
- status change rollback jika audit gagal,
- design audit table dan write path atomik,
- reconciliation query untuk detect gap.

---

## 50. Ringkasan

Transaction adalah boundary konsistensi, bukan sekadar annotation.

Hal paling penting dari Part 010:

1. Transaction mengatur atomicity, consistency, isolation, durability, visibility, lock duration, timeout, dan rollback behavior.
2. JDBC transaction melekat pada `Connection`; JPA resource-local memakai `EntityTransaction`; Jakarta Transactions/JTA memakai transaction manager; Spring menyediakan abstraction di atas berbagai transaction manager.
3. `flush()` bukan `commit()`. Flush mengirim SQL; commit menyelesaikan transaction.
4. Persistence context dan transaction berkaitan erat, tetapi tidak sama.
5. Transaction boundary sebaiknya mengikuti use case dan invariant, bukan DAO method.
6. External side effect tidak otomatis rollback bersama DB transaction.
7. Side effect penting sebaiknya memakai outbox/idempotency/retry, bukan dipanggil sembarangan di tengah transaction.
8. Rollback rules harus eksplisit, terutama untuk checked/business exception.
9. Transaction yang panjang bisa menghabiskan connection pool, menahan lock, dan memicu incident.
10. Distributed transaction/JTA/XA adalah tool valid, tetapi bukan default untuk semua integrasi modern.
11. Retry tanpa idempotency bisa lebih berbahaya daripada tidak retry.
12. Untuk sistem regulatory/case management, transaction harus menjaga state transition, audit, idempotency, dan outbox secara atomic.

---

## 51. Apa yang Belum Dibahas

Bagian ini baru fondasi. Belum masuk detail mendalam tentang:

- propagation Spring/Jakarta secara lengkap,
- isolation anomaly,
- optimistic locking,
- pessimistic locking,
- deadlock,
- transaction boundary pattern real application,
- outbox/inbox/CDC,
- exception translation mendalam,
- test concurrency.

Itu akan dibahas di part berikutnya.

---

## 52. Referensi Utama

- Jakarta Transactions 2.0 Specification.
- Jakarta Persistence 3.2 Specification dan API documentation.
- Hibernate ORM documentation, terutama bagian transaction/concurrency dan session/persistence context.
- Spring Framework Reference Documentation, transaction management, propagation, rollback rules, dan declarative transaction.

---

## 53. Status Seri

Seri belum selesai.

Saat ini selesai:

```text
Part 000 — Big Picture: Persistence as a Boundary, Not a CRUD Layer
Part 001 — Evolution Map: JDBC, JPA, Hibernate, Spring Data, Jakarta Data, Jakarta Transactions
Part 002 — Persistence Architecture: Layering, Boundaries, and Dependency Direction
Part 003 — Entity Identity: Object Identity, Database Identity, Business Identity
Part 004 — Entity Lifecycle and Persistence Context Internals
Part 005 — Mapping Fundamentals Done Correctly
Part 006 — Relationship Mapping: One-to-One, Many-to-One, One-to-Many, Many-to-Many
Part 007 — Fetching Strategy: Lazy, Eager, N+1, Entity Graph, Fetch Join
Part 008 — Query Model: JPQL, HQL, Criteria, Native SQL, QuerySpecification
Part 009 — Projection, DTO, Read Model, and Reporting Queries
Part 010 — Transaction Fundamentals: ACID, Local Transactions, JTA, Resource Managers
```

Berikutnya:

```text
Part 011 — Transaction Boundary Design in Real Applications
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 009 — Projection, DTO, Read Model, and Reporting Queries](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-009.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 011 — Transaction Boundary Design in Real Applications](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-011.md)
