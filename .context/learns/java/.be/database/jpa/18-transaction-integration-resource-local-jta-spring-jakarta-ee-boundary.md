# Part 18 — Transaction Integration: Resource Local, JTA, Spring, Jakarta EE, and Boundary Design

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `18-transaction-integration-resource-local-jta-spring-jakarta-ee-boundary.md`  
> Target: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4  
> Fokus: memahami transaction boundary sebagai garis kendali antara object graph, persistence context, flush, database transaction, framework transaction manager, dan failure mode production.

---

## 1. Why This Matters

Banyak engineer menganggap transaction hanya sebagai anotasi:

```java
@Transactional
public void approveCase(Long caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    c.approve();
}
```

Secara surface, kode itu terlihat sederhana. Tetapi di bawahnya ada beberapa lapisan yang berbeda:

1. method boundary,
2. framework transaction interceptor,
3. JPA `EntityManager`,
4. provider session/persistence context,
5. JDBC connection,
6. database transaction,
7. flush queue,
8. lock/isolation behavior,
9. commit/rollback decision,
10. cache synchronization.

Masalahnya: semua lapisan itu tidak selalu punya lifetime yang sama.

Sebuah method bisa selesai, tetapi persistence context masih hidup. Sebuah persistence context bisa berisi perubahan, tetapi SQL belum dikirim. SQL bisa sudah dikirim karena flush, tetapi database transaction belum commit. Transaction bisa sudah rollback-only, tetapi kode service masih berjalan seolah-olah normal. Read-only transaction bisa mengubah provider flush behavior, tetapi belum tentu membuat database benar-benar read-only. JTA transaction bisa mencakup banyak resource, tetapi failure 2-phase commit punya konsekuensi berbeda dari single database transaction.

Top-level mental model:

> **ORM transaction engineering adalah seni memastikan scope object state, SQL generation, database atomicity, dan business operation boundary berada pada garis yang sama.**

Jika garis itu tidak sama, bug-nya biasanya sulit dilacak:

- update tidak terjadi,
- update terjadi terlalu cepat,
- lazy loading gagal di luar transaction,
- perubahan entity “nyangkut” lalu ikut flush tanpa sengaja,
- read query tiba-tiba melakukan write karena auto flush,
- rollback tidak membatalkan side effect eksternal,
- nested transaction ternyata tidak benar-benar nested,
- `UnexpectedRollbackException`,
- deadlock karena lock ditahan terlalu lama,
- connection pool exhausted karena transaction boundary terlalu lebar,
- cache stale setelah rollback/commit yang salah urutan.

Dokumentasi Jakarta Persistence mendefinisikan persistence sebagai standar object/relational mapping untuk Java SE dan Jakarta EE, tetapi detail integrasi transaction sangat tergantung apakah aplikasi memakai resource-local transaction, Jakarta Transactions/JTA, Spring transaction manager, atau container-managed transaction. Jakarta Transactions menyediakan `UserTransaction` untuk mengontrol boundary transaction secara programmatic, sedangkan Hibernate menyatakan `Session`/`EntityManager` sebagai unit-of-work yang membungkus JDBC connection dan transaction abstraction. Spring menambahkan lapisan deklaratif dengan propagation dan rollback-only semantics sendiri.  
References: Jakarta Persistence 3.2 specification, Hibernate ORM User Guide, Jakarta Transactions 2.0, Spring transaction propagation documentation.

---

## 2. Core Mental Model

### 2.1 Transaction bukan hanya `BEGIN` dan `COMMIT`

Dalam ORM, transaction memiliki beberapa arti sekaligus:

| Layer | Yang dimaksud “transaction” | Contoh |
|---|---|---|
| Business | Satu operasi bermakna secara domain | approve case, submit application, assign officer |
| Framework | Method boundary yang diintercept | `@Transactional` |
| JPA | Unit perubahan entity managed | persistence context + flush |
| Provider | Unit-of-work internal | Hibernate `Session`, EclipseLink `UnitOfWork` |
| JDBC | Connection transaction | `setAutoCommit(false)`, `commit`, `rollback` |
| Database | Atomicity, isolation, locks, undo/redo | row lock, MVCC snapshot, deadlock detection |
| Distributed TX | Koordinasi banyak resource | JTA/XA/2PC |

Bug terjadi ketika engineer mengira semua layer ini identik.

Contoh:

```java
@Transactional
public void updateThenCallExternalSystem(Long id) {
    Invoice invoice = em.find(Invoice.class, id);
    invoice.markPaid();

    paymentGateway.notifyPaid(invoice.getReferenceNo());

    // commit terjadi setelah method return
}
```

Dari sisi business, kita mungkin mengira invoice sudah paid saat external system dipanggil. Dari sisi database, belum tentu. SQL mungkin belum flush. Commit belum terjadi. Jika commit gagal setelah gateway dipanggil, external side effect tidak otomatis rollback.

Mental model yang lebih benar:

```text
method starts
  transaction interceptor opens transaction
    EntityManager joins transaction
      persistence context tracks objects
      domain method mutates managed entity
      flush may or may not happen before commit
      external side effect may happen before DB commit if called here
    transaction interceptor commits
      provider flushes pending changes
      JDBC/database commits
method returns
```

Jadi pertanyaan desainnya bukan sekadar:

> “Pakai `@Transactional` atau tidak?”

Melainkan:

> “Business operation mana yang harus atomic, state object mana yang boleh managed, SQL kapan boleh dikirim, lock berapa lama boleh ditahan, dan side effect apa yang harus menunggu commit?”

---

### 2.2 Persistence context bukan transaction, tetapi biasanya diikat ke transaction

Persistence context adalah ruang object managed. Transaction adalah ruang atomicity database.

Dalam kebanyakan aplikasi backend modern, kita memakai **transaction-scoped persistence context**:

```text
transaction begins
  persistence context opened/joined
  entities loaded and managed
  changes tracked
  flush before commit
transaction commits/rolls back
  persistence context closed/detached
```

Tetapi tidak selalu begitu. Ada juga:

- application-managed `EntityManager`,
- extended persistence context,
- Open Session in View,
- manually opened Hibernate `Session`,
- lazy loading outside service boundary,
- reactive/non-blocking persistence models yang berbeda paradigm.

Satu persistence context bisa hidup lebih lama dari satu transaction dalam skenario extended context. Ini berguna untuk conversation-style UI, tetapi berbahaya untuk backend stateless jika dipakai tanpa disiplin.

Invariant penting:

> **Transaction menentukan atomicity database. Persistence context menentukan object identity dan pending changes.**

Keduanya berkaitan, tetapi bukan hal yang sama.

---

### 2.3 Flush bukan commit

Sudah dibahas di Part 6, tetapi harus diulang secara ringkas karena transaction integration tidak bisa dipahami tanpa ini.

Flush:

- membandingkan managed state dengan snapshot,
- menyusun SQL action,
- mengirim SQL ke database,
- membuat constraint/trigger/lock mungkin terjadi,
- tetapi belum membuat perubahan durable secara final.

Commit:

- menyelesaikan database transaction,
- membuat perubahan terlihat sesuai isolation level,
- melepas lock,
- menyelesaikan lifecycle transaction.

Rollback:

- membatalkan database changes dalam transaction,
- tetapi tidak otomatis mengembalikan Java object field ke nilai lama.

Contoh:

```java
@Transactional
public void demo(Long id) {
    Account account = em.find(Account.class, id);
    account.debit(new BigDecimal("100.00"));

    em.flush(); // SQL UPDATE dikirim

    throw new RuntimeException("fail"); // DB rollback
}
```

Database kembali seperti semula. Tetapi object `account` di memory sudah telanjur berubah. Jika object itu bocor ke caller atau disimpan di cache application-level, Anda punya state corruption.

Rule:

> **Rollback membatalkan database transaction, bukan memutar balik dunia object Java Anda.**

---

## 3. Specification-Level Concept

### 3.1 Resource-local transaction

Resource-local adalah mode di mana aplikasi mengontrol transaction langsung melalui `EntityTransaction` dari `EntityManager`.

Biasanya dipakai pada:

- Java SE,
- command-line batch,
- test sederhana,
- aplikasi tanpa container transaction manager,
- embedded use case.

Contoh Jakarta Persistence:

```java
EntityManagerFactory emf = Persistence.createEntityManagerFactory("appPU");
EntityManager em = emf.createEntityManager();
EntityTransaction tx = em.getTransaction();

try {
    tx.begin();

    CaseRecord c = em.find(CaseRecord.class, 100L);
    c.assignTo("officer-01");

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

Kelebihan:

- simple,
- explicit,
- tidak perlu container,
- mudah dipahami untuk satu database.

Kelemahan:

- transaction demarcation manual,
- mudah lupa rollback/close,
- tidak cocok untuk banyak resource yang harus atomic,
- tidak otomatis sinkron dengan framework service boundary,
- raw boilerplate tinggi.

Resource-local mental model:

```text
application code
  EntityManager.getTransaction().begin()
    JDBC connection begins local transaction
    persistence context tracks changes
  commit()
    provider flushes
    JDBC commit
  close()
```

---

### 3.2 JTA / Jakarta Transactions

JTA/Jakarta Transactions menyediakan transaction coordination yang biasanya dikelola container/application server atau transaction manager eksternal.

Dipakai pada:

- Jakarta EE container,
- EJB/CDI transaction boundary,
- aplikasi dengan multiple transactional resources,
- XA/distributed transaction,
- enterprise platform dengan transaction manager.

Contoh conceptual dengan `UserTransaction`:

```java
@Resource
UserTransaction utx;

@PersistenceContext
EntityManager em;

public void process() throws Exception {
    utx.begin();
    try {
        CaseRecord c = em.find(CaseRecord.class, 100L);
        c.escalate();
        utx.commit();
    } catch (Exception ex) {
        utx.rollback();
        throw ex;
    }
}
```

Dalam container-managed transaction, Anda sering tidak memanggil `UserTransaction` manual. Container yang membuka, commit, rollback.

Contoh EJB-style:

```java
@Stateless
public class CaseService {

    @PersistenceContext
    private EntityManager em;

    @TransactionAttribute(TransactionAttributeType.REQUIRED)
    public void approve(Long id) {
        CaseRecord c = em.find(CaseRecord.class, id);
        c.approve();
    }
}
```

JTA mental model:

```text
container/framework begins JTA transaction
  EntityManager joins transaction
  JDBC resource enlisted
  maybe other XA resources enlisted
  provider flushes before completion
transaction manager commits or rolls back all enlisted resources
```

Kelebihan:

- declarative transaction,
- container integration,
- supports multiple resources,
- standardized transaction lifecycle,
- good for Jakarta EE environment.

Kelemahan:

- more moving parts,
- XA/2PC overhead,
- harder failure modes,
- transaction manager configuration matters,
- not always worth it for single database + outbox architecture.

---

### 3.3 Container-managed vs application-managed EntityManager

JPA membedakan dua style besar:

#### Container-managed EntityManager

Biasanya diinjeksi:

```java
@PersistenceContext
private EntityManager em;
```

Characteristics:

- lifecycle dikelola container,
- transaction joining dikelola container,
- close tidak dipanggil manual,
- cocok untuk Jakarta EE.

#### Application-managed EntityManager

Dibuat manual:

```java
EntityManager em = emf.createEntityManager();
```

Characteristics:

- lifecycle harus ditutup manual,
- transaction harus dikelola manual atau join manual,
- cocok untuk Java SE/batch/custom infrastructure.

Anti-pattern:

```java
@PersistenceContext
private EntityManager em;

public void wrong() {
    em.close(); // jangan close container-managed EntityManager
}
```

Atau:

```java
public void wrong(EntityManagerFactory emf) {
    EntityManager em = emf.createEntityManager();
    em.persist(new AuditLog());
    // lupa close -> resource leak
}
```

---

## 4. Hibernate Behavior

### 4.1 Hibernate `Session` sebagai unit of work

Dalam Hibernate, JPA `EntityManager` adalah facade di atas `Session`.

Conceptual mapping:

| JPA | Hibernate native |
|---|---|
| `EntityManagerFactory` | `SessionFactory` |
| `EntityManager` | `Session` |
| `EntityTransaction` | `Transaction` |
| Persistence context | Stateful session persistence context |
| JPQL | HQL/SQM/SQL AST pipeline |

Hibernate `Session`:

- bukan thread-safe,
- short-lived by design,
- memegang first-level cache,
- mengelola dirty checking,
- queue SQL actions,
- membungkus JDBC connection secara logical.

Typical native Hibernate:

```java
try (Session session = sessionFactory.openSession()) {
    Transaction tx = session.beginTransaction();
    try {
        CaseRecord c = session.get(CaseRecord.class, id);
        c.approve();
        tx.commit();
    } catch (RuntimeException ex) {
        tx.rollback();
        throw ex;
    }
}
```

Dalam Spring, ini biasanya tersembunyi di balik `JpaTransactionManager` atau `HibernateTransactionManager`.

---

### 4.2 Connection handling

Hibernate tidak selalu mengambil JDBC connection saat `Session` dibuat. Provider bisa menunda acquisition sampai dibutuhkan.

Simplified:

```text
Session opened
  no physical connection yet, maybe
first query/flush
  acquire connection
transaction commit/rollback
  release connection depending connection handling mode
Session closed
```

Implikasi:

- transaction terlalu panjang bisa menahan connection lebih lama,
- lazy load di view layer bisa mengambil connection saat response rendering,
- streaming result bisa menahan connection sampai stream ditutup,
- batch operation bisa mengikat connection lama.

Failure mode:

```java
@Transactional(readOnly = true)
public Stream<CaseRecord> streamCases() {
    return repository.streamAll(); // bahaya jika stream dikonsumsi di luar transaction
}
```

Jika stream keluar dari transaction boundary, JDBC resources bisa bocor atau query gagal.

Rule:

> Jangan return provider-backed stream/iterator/lazy collection keluar dari transaction boundary kecuali lifecycle-nya dikontrol eksplisit.

---

### 4.3 Hibernate flush and transaction synchronization

Hibernate flush biasanya terjadi:

- sebelum transaction commit,
- sebelum query tertentu dalam `AUTO` flush mode,
- saat manual `flush()`,
- sesuai provider/framework integration.

Dengan Spring `@Transactional`, commit biasanya terjadi setelah method return. Pada saat itu Spring transaction manager memicu provider flush sebelum JDBC commit.

Conceptual sequence:

```text
@Transactional method invoked
  transaction begins
  EntityManager bound to thread
  method executes
  managed entities changed
method returns
  before commit: flush persistence context
  JDBC commit
  unbind EntityManager
  close/clear if transaction scoped
```

Jika exception dilempar:

```text
@Transactional method invoked
  transaction begins
  method changes managed entity
  exception thrown
  transaction marked rollback-only / rollback
  EntityManager closed/cleared
exception propagated
```

Catatan penting:

- Hibernate object state di memory tetap berubah sampai persistence context dibuang.
- SQL yang sudah di-flush akan dibatalkan oleh rollback database.
- External side effect tidak ikut rollback.

---

### 4.4 Hibernate current session context

Hibernate bisa mengikat `Session` ke context tertentu:

- thread-bound session,
- JTA-bound session,
- managed by Spring,
- custom context.

Dalam Spring Boot/JPA, Anda jarang mengakses ini langsung. Tetapi mental model-nya penting:

```text
current thread
  transaction resources
    EntityManagerHolder
      Hibernate Session
```

Karena itu, `@Transactional` sangat bergantung pada proxy/interceptor.

Anti-pattern umum:

```java
@Service
public class CaseService {

    public void outer(Long id) {
        inner(id); // self-invocation, @Transactional di inner bisa tidak aktif dalam proxy-based Spring
    }

    @Transactional
    public void inner(Long id) {
        // mungkin tidak dibungkus transaction jika dipanggil dari this.outer()
    }
}
```

Pada Spring proxy-based AOP, pemanggilan internal dalam object yang sama tidak melewati proxy. Akibatnya transaction annotation di method internal bisa tidak aktif.

---

## 5. EclipseLink Behavior

### 5.1 UnitOfWork dan session model

EclipseLink punya terminologi historis:

| JPA | EclipseLink concept |
|---|---|
| `EntityManagerFactory` | ServerSession / SessionManager infrastructure |
| `EntityManager` | ClientSession + UnitOfWork style behavior |
| Persistence context | UnitOfWork clone/registered objects |
| Mapping metadata | Descriptors |
| Lazy support | Indirection/weaving |

EclipseLink `UnitOfWork` adalah konsep penting: perubahan dilakukan pada registered/managed objects, lalu commit unit-of-work akan menulis perubahan ke database.

Mental model:

```text
EntityManager operation
  object registered in UnitOfWork
  changes tracked by policy/weaving/snapshot
flush/commit
  UnitOfWork calculates changes
  SQL written
```

---

### 5.2 Shared cache interaction

EclipseLink historically has strong shared cache behavior. Dalam transaction integration, ini penting karena:

- object bisa datang dari shared cache,
- commit/rollback memengaruhi cache coordination,
- stale cache risk lebih nyata jika cache isolation tidak didesain.

Pada aplikasi multi-node atau data yang bisa diubah di luar ORM, cache behavior harus ditinjau.

Rule:

> Untuk entity yang sangat transaction-sensitive, frequently updated, atau subject to external updates, jangan aktifkan shared cache tanpa invalidation strategy yang jelas.

---

### 5.3 Weaving and transaction behavior

EclipseLink memakai weaving/indirection untuk lazy loading dan change tracking. Jika weaving tidak aktif atau tidak konsisten antara test dan production, behavior transaction bisa berubah.

Contoh failure:

```text
DEV/test:
  no weaving
  lazy field behaves eager or fails differently
PROD:
  weaving active
  lazy load happens after transaction boundary
  unexpected database access during serialization
```

Rule:

> Samakan enhancement/weaving mode antara test dan production untuk behavior transaction-sensitive.

---

## 6. Spring Transaction Integration

Spring adalah integration layer paling umum di backend modern. Banyak engineer memakai JPA melalui Spring, bukan Jakarta EE container.

### 6.1 `@Transactional` is an interceptor boundary

`@Transactional` bukan magic keyword yang membuat setiap line atomic. Ia bekerja melalui interceptor/proxy/aspect.

Conceptual flow:

```text
client calls Spring proxy
  proxy checks @Transactional metadata
  transaction manager begins or joins transaction
  target method invoked
  if normal return: commit
  if exception matches rollback rules: rollback
```

Jika method tidak dipanggil melalui proxy, transaction bisa tidak aktif.

Contoh self-invocation issue:

```java
@Service
public class ApplicationService {

    public void submitAll(List<Long> ids) {
        for (Long id : ids) {
            submitOne(id); // direct call, proxy bypass
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void submitOne(Long id) {
        // REQUIRES_NEW mungkin tidak aktif jika self-invoked
    }
}
```

Solusi desain:

- pisahkan method transactional ke bean lain,
- panggil via proxy secara eksplisit jika benar-benar perlu,
- gunakan `TransactionTemplate` untuk boundary programmatic,
- hindari desain yang mengandalkan internal proxy trick.

---

### 6.2 `JpaTransactionManager`

Dalam Spring JPA, `JpaTransactionManager` biasanya:

1. membuat atau mengambil `EntityManager`,
2. bind ke thread,
3. mulai transaction,
4. mengizinkan repository/service memakai EntityManager yang sama,
5. commit/rollback,
6. cleanup thread-bound resources.

Conceptual:

```text
ThreadLocal transaction resources
  EntityManager bound to thread
  JDBC Connection optionally exposed
  transaction synchronization callbacks
```

Implikasi:

- transaction context biasanya thread-bound,
- pindah thread tanpa context propagation memutus transaction,
- `@Async` tidak mewarisi transaction biasa,
- parallel stream dalam transaction berbahaya,
- scheduled job perlu boundary sendiri.

Anti-pattern:

```java
@Transactional
public void process(List<Long> ids) {
    ids.parallelStream().forEach(id -> {
        CaseRecord c = repository.findById(id).orElseThrow();
        c.process();
    });
}
```

Masalah:

- `EntityManager` tidak thread-safe,
- transaction resource thread-bound,
- persistence context corruption risk,
- connection/transaction behavior tidak sesuai ekspektasi.

Rule:

> Satu transaction JPA stateful = satu thread eksekusi terkontrol. Jangan paralelkan operasi entity managed dalam persistence context yang sama.

---

### 6.3 Rollback rules

Spring default rollback behavior sering disalahpahami.

Secara umum:

- unchecked exception (`RuntimeException`, `Error`) menyebabkan rollback,
- checked exception tidak otomatis rollback kecuali dikonfigurasi,
- rollback rules bisa diubah dengan `rollbackFor`, `noRollbackFor`, dsb.

Contoh:

```java
@Transactional
public void approve(Long id) throws BusinessException {
    CaseRecord c = em.find(CaseRecord.class, id);
    c.approve();
    throw new BusinessException("validation failed"); // checked exception
}
```

Jika `BusinessException` checked dan tidak dikonfigurasi rollback, transaction bisa commit. Ini sering fatal.

Lebih aman:

```java
@Transactional(rollbackFor = BusinessException.class)
public void approve(Long id) throws BusinessException {
    CaseRecord c = em.find(CaseRecord.class, id);
    c.approve();
    throw new BusinessException("validation failed");
}
```

Atau desain exception domain sebagai unchecked untuk operasi transactional, tetapi ini harus konsisten.

Rule:

> Exception taxonomy adalah bagian dari transaction design.

---

### 6.4 Rollback-only surprise

Spring propagation documentation menjelaskan bahwa logical transaction scopes bisa memiliki rollback-only status masing-masing. Efek praktisnya: inner operation bisa menandai transaction rollback-only, outer method menangkap exception dan mencoba lanjut, tetapi commit di akhir tetap gagal.

Contoh:

```java
@Transactional
public void outer(Long id) {
    try {
        inner(id);
    } catch (RuntimeException ignored) {
        // mengira aman karena exception ditangkap
    }

    auditRepository.save(new AuditLog("outer continued"));
}

@Transactional
public void inner(Long id) {
    CaseRecord c = repository.findById(id).orElseThrow();
    c.process();
    throw new RuntimeException("fail inner");
}
```

Jika `inner` ikut transaction yang sama dan exception menyebabkan rollback-only, maka outer commit bisa menghasilkan `UnexpectedRollbackException`.

Sequence:

```text
outer begins transaction
  inner joins same transaction
  inner fails
  transaction marked rollback-only
outer catches exception
outer continues
outer returns normally
commit attempted
framework detects rollback-only
rollback occurs
UnexpectedRollbackException thrown
```

Rule:

> Menangkap exception tidak selalu menghapus keputusan rollback. Jika transaction sudah rollback-only, operation harus dianggap gagal.

Solusi tergantung intent:

- jangan tangkap exception jika business operation harus gagal,
- gunakan `REQUIRES_NEW` untuk audit yang harus tetap commit,
- gunakan outbox/audit after-rollback strategy,
- pisahkan boundary eksplisit dengan `TransactionTemplate`,
- validasi sebelum mutasi state.

---

## 7. Propagation Semantics

Propagation menentukan apakah method transactional:

- ikut transaction existing,
- membuat transaction baru,
- jalan tanpa transaction,
- wajib ada transaction,
- gagal jika ada transaction.

### 7.1 REQUIRED

Default paling umum.

```java
@Transactional(propagation = Propagation.REQUIRED)
public void approve(Long id) { ... }
```

Meaning:

- jika ada transaction, join,
- jika tidak ada, buat baru.

Cocok untuk service operation biasa.

Risiko:

- inner method tidak punya atomicity independent,
- rollback-only dari inner memengaruhi outer,
- transaction bisa menjadi terlalu besar jika call chain panjang.

---

### 7.2 REQUIRES_NEW

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void writeAudit(AuditLog log) { ... }
```

Meaning:

- suspend existing transaction,
- buat transaction baru,
- commit/rollback independen,
- resume outer transaction.

Use case:

- audit attempt harus tersimpan meskipun business transaction gagal,
- per-item batch processing,
- retry boundary kecil,
- dead letter logging.

Risiko:

- butuh connection tambahan,
- bisa menyebabkan connection pool starvation,
- commit inner bisa survive walau outer rollback,
- consistency harus sengaja didesain.

Contoh benar:

```java
@Transactional
public void submit(Long id) {
    try {
        doSubmit(id);
        auditService.recordSuccess(id); // REQUIRES_NEW
    } catch (RuntimeException ex) {
        auditService.recordFailure(id, ex.getMessage()); // REQUIRES_NEW
        throw ex;
    }
}
```

Tetapi hati-hati:

```text
outer transaction holds connection
inner REQUIRES_NEW needs another connection
many concurrent requests do same thing
pool exhausted/deadlock-like starvation
```

Rule:

> `REQUIRES_NEW` bukan “fix rollback”; ia adalah keputusan durability terpisah.

---

### 7.3 NESTED

`NESTED` biasanya memakai database savepoint jika didukung.

Meaning:

- transaction fisik sama,
- ada savepoint,
- inner rollback kembali ke savepoint,
- outer masih bisa commit.

Risiko:

- tidak semua transaction manager/provider mendukung,
- bukan transaction independen seperti `REQUIRES_NEW`,
- lock bisa tetap ditahan sampai outer commit,
- persistence context state bisa membingungkan setelah savepoint rollback.

Dalam JPA stateful persistence context, nested/savepoint semantics harus dipakai hati-hati karena object state di memory mungkin tidak otomatis kembali ke savepoint.

Rule:

> Savepoint rollback membatalkan database changes, bukan otomatis mengembalikan managed object graph ke snapshot savepoint.

---

### 7.4 SUPPORTS / NOT_SUPPORTED / NEVER / MANDATORY

#### SUPPORTS

- ikut transaction jika ada,
- jalan non-transactional jika tidak ada.

Cocok untuk read helper yang tidak membutuhkan transaction wajib, tetapi berbahaya jika lazy loading/fetch plan tidak jelas.

#### NOT_SUPPORTED

- suspend transaction,
- jalan tanpa transaction.

Cocok untuk operasi lambat non-DB yang tidak boleh menahan lock/connection.

#### NEVER

- gagal jika ada transaction.

Cocok untuk operasi yang tidak boleh dilakukan dalam transaction, misalnya call eksternal blocking tertentu.

#### MANDATORY

- wajib ada transaction,
- gagal jika dipanggil tanpa transaction.

Cocok untuk repository internal/lower-level operation yang tidak boleh menentukan boundary sendiri.

---

## 8. Transaction Boundary Design

### 8.1 Boundary harus mengikuti business invariant

Contoh domain case management:

Operation: approve application.

Business invariant:

- application status berubah dari `UNDER_REVIEW` ke `APPROVED`,
- approval record dibuat,
- current task ditutup,
- next correspondence scheduled,
- audit trail dibuat,
- version naik,
- semua harus atomic.

Maka transaction boundary ideal:

```java
@Transactional
public void approveApplication(ApproveApplicationCommand cmd) {
    Application app = applicationRepository.getForUpdateOrOptimistic(cmd.applicationId());

    app.approve(cmd.officerId(), cmd.reason());

    taskService.closeCurrentTask(app);
    approvalRepository.add(app.createApprovalRecord());
    auditTrail.record(AuditEvent.applicationApproved(app));
    correspondence.scheduleApprovalLetter(app);
}
```

Tapi jika `correspondence.scheduleApprovalLetter` mengirim email langsung, itu salah boundary. Pengiriman email tidak ikut rollback.

Lebih aman:

```java
@Transactional
public void approveApplication(ApproveApplicationCommand cmd) {
    Application app = applicationRepository.get(cmd.applicationId());
    app.approve(cmd.officerId(), cmd.reason());

    taskService.closeCurrentTask(app);
    approvalRepository.add(app.createApprovalRecord());
    outboxRepository.add(EmailRequested.approvalLetter(app.id()));
    auditTrail.record(AuditEvent.applicationApproved(app));
}
```

Setelah commit, worker membaca outbox dan mengirim email.

Rule:

> Transaction boundary harus melingkupi perubahan state yang harus atomic, bukan seluruh workflow teknis.

---

### 8.2 Boundary jangan terlalu kecil

Terlalu kecil:

```java
public void approve(Long id) {
    Application app = findApp(id);       // tx 1
    validate(app);                       // no tx
    markApproved(app);                   // tx 2
    closeTask(id);                       // tx 3
    createAudit(id);                     // tx 4
}
```

Masalah:

- invariant tidak atomic,
- partial update mungkin terjadi,
- object detached antar step,
- lost update lebih mungkin,
- exception di tengah meninggalkan state setengah jadi.

---

### 8.3 Boundary jangan terlalu besar

Terlalu besar:

```java
@Transactional
public void approveAndNotify(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.approve();

    pdfService.generateLargePdf(app);          // CPU/memory heavy
    externalEmailClient.sendApprovalEmail(app); // network call
    Thread.sleep(5000);                         // terrible
}
```

Masalah:

- lock ditahan lama,
- connection ditahan lama,
- transaction timeout,
- deadlock window membesar,
- external failure menyebabkan DB rollback setelah kerja mahal,
- throughput turun.

Better:

```java
@Transactional
public void approve(Long id) {
    Application app = repository.findById(id).orElseThrow();
    app.approve();
    outbox.add(new ApprovalEmailRequested(app.id()));
}
```

Then async worker:

```java
public void sendApprovalEmails() {
    List<OutboxMessage> batch = outboxRepository.claimBatch();
    for (OutboxMessage msg : batch) {
        emailClient.send(...);
        outboxRepository.markSent(msg.id());
    }
}
```

Rule:

> Keep database transaction short, deterministic, and state-focused.

---

### 8.4 Boundary should be at application service layer

Typical layering:

```text
Controller/API
  Application Service  <-- transaction boundary
    Domain model
    Repository
    Domain service
  Infrastructure
```

Good:

```java
@Service
public class CaseApplicationService {

    @Transactional
    public void assignOfficer(AssignOfficerCommand cmd) {
        CaseRecord c = caseRepository.get(cmd.caseId());
        Officer officer = officerRepository.get(cmd.officerId());
        c.assign(officer);
        audit.recordAssigned(c, officer);
    }
}
```

Less good:

```java
@Repository
public class CaseRepository {
    @Transactional
    public CaseRecord find(...) { ... }

    @Transactional
    public void save(...) { ... }
}
```

Repository-level transaction can be acceptable for simple CRUD, but for complex domain operations, it fragments business invariant.

Rule:

> Repository participates in transaction; application service owns business transaction boundary.

---

## 9. Read-Only Transaction Myth

### 9.1 `readOnly = true` is not universal enforcement

Spring `@Transactional(readOnly = true)` is a hint/optimization and framework/provider integration mechanism. It may:

- set JDBC connection read-only flag,
- change Hibernate flush mode,
- avoid dirty checking optimization in some cases,
- communicate intent to transaction manager.

But it is not a portable, absolute guarantee that no write can ever happen in all databases/providers/configurations.

Example:

```java
@Transactional(readOnly = true)
public CaseDto viewCase(Long id) {
    CaseRecord c = repository.findById(id).orElseThrow();
    c.markViewed(); // bug: mutation inside read-only operation
    return mapper.toDto(c);
}
```

Depending configuration, this mutation may:

- not flush,
- flush if manually flushed,
- throw in some DB/read-only connection modes,
- silently remain in memory until context closes,
- surprise developer if provider behavior changes.

Rule:

> Treat read-only as optimization + intent, not as primary security/correctness boundary.

---

### 9.2 Why use read-only transaction at all?

Read-only transaction can still be valuable:

- consistent lazy loading within boundary,
- clear service intent,
- provider flush optimization,
- no accidental commit in typical config,
- helps connection/database optimize in some environments.

Example:

```java
@Transactional(readOnly = true)
public CaseDetailDto getCaseDetail(Long id) {
    CaseRecord c = caseRepository.fetchDetail(id);
    return mapper.toDto(c);
}
```

But do not use it as substitute for DTO projection/fetch plan discipline.

---

## 10. Isolation Levels and ORM

Transaction isolation is database-level. ORM does not magically fix isolation anomalies.

Common isolation concepts:

| Phenomenon | Meaning |
|---|---|
| Dirty read | Read uncommitted data from another transaction |
| Non-repeatable read | Same row read twice gives different result |
| Phantom read | Same predicate read twice gives different set |
| Lost update | Two writers overwrite each other |
| Write skew | Two transactions independently pass validation but violate aggregate invariant |

ORM tools:

- `@Version` optimistic locking,
- pessimistic locks,
- flush ordering,
- transaction boundary,
- database isolation configuration.

But if invariant spans many rows, `@Version` on one entity may not be enough.

Example write skew:

```text
Rule: at least one active approver must remain.
T1 reads approver A and B active.
T2 reads approver A and B active.
T1 deactivates A.
T2 deactivates B.
Both commit.
No active approver remains.
```

No single-row optimistic lock catches this if A and B are separate rows and no aggregate/version guard exists.

Solutions:

- lock aggregate root row,
- maintain aggregate version row,
- use serializable isolation for specific operation,
- enforce database constraint if possible,
- redesign invariant storage.

Rule:

> ORM locks protect mapped rows. Business invariants may require aggregate-level locking strategy.

---

## 11. Pessimistic Locking and Boundary Length

Pessimistic lock:

```java
CaseRecord c = em.find(
    CaseRecord.class,
    id,
    LockModeType.PESSIMISTIC_WRITE
);
```

This can generate `SELECT ... FOR UPDATE` or database-specific equivalent.

Good use:

- short critical section,
- high contention state transition,
- queue/claim pattern,
- unique sequential business number generation if not handled better.

Bad use:

```java
@Transactional
public void approveWithLock(Long id) {
    CaseRecord c = em.find(CaseRecord.class, id, LockModeType.PESSIMISTIC_WRITE);
    externalApi.call(); // lock held during network call
    c.approve();
}
```

Problems:

- lock held too long,
- deadlock probability rises,
- user-facing latency blocks other transactions,
- timeout risk.

Rule:

> If you lock pessimistically, transaction must be short, deterministic, and free of external blocking calls.

---

## 12. Optimistic Locking and Transaction Boundaries

Optimistic locking with `@Version`:

```java
@Entity
public class CaseRecord {
    @Id
    private Long id;

    @Version
    private long version;

    private String status;

    public void approve() {
        if (!"UNDER_REVIEW".equals(status)) {
            throw new IllegalStateException("Invalid transition");
        }
        this.status = "APPROVED";
    }
}
```

At flush/commit, provider includes version condition:

```sql
update case_record
set status = ?, version = ?
where id = ? and version = ?
```

If row count is 0, optimistic lock exception.

Boundary implication:

- conflict is often detected at flush/commit, not at mutation line,
- user-facing retry logic must wrap transaction boundary,
- catching optimistic exception inside same transaction rarely helps.

Bad:

```java
@Transactional
public void approveWithBadRetry(Long id) {
    try {
        CaseRecord c = repository.findById(id).orElseThrow();
        c.approve();
        em.flush();
    } catch (OptimisticLockException ex) {
        CaseRecord c2 = repository.findById(id).orElseThrow(); // same tx may be poisoned
        c2.approve();
    }
}
```

Better retry outside transaction:

```java
public void approveWithRetry(Long id) {
    retryTemplate.execute(() -> {
        transactionalApprover.approveOnce(id);
        return null;
    });
}

@Transactional
public void approveOnce(Long id) {
    CaseRecord c = repository.findById(id).orElseThrow();
    c.approve();
}
```

Rule:

> Retry the whole transaction, not random lines inside a failed persistence context.

---

## 13. Exception Handling and Transaction Poisoning

After persistence exception, the persistence context may be unsafe to continue.

Example:

```java
@Transactional
public void createUserThenContinue(User user) {
    try {
        em.persist(user);
        em.flush(); // unique constraint violation
    } catch (PersistenceException ex) {
        // continuing here is dangerous
    }

    em.persist(new AuditLog("continued"));
}
```

Problems:

- transaction may be marked rollback-only,
- persistence context may contain failed insert action,
- provider state may be inconsistent,
- audit may not commit.

Rule:

> A persistence exception inside transaction usually means abort the transaction boundary.

If you need record failure:

```java
public void createUser(User user) {
    try {
        userCreator.create(user); // @Transactional
        auditService.success(...); // REQUIRES_NEW or separate after success
    } catch (RuntimeException ex) {
        auditService.failure(...); // REQUIRES_NEW
        throw ex;
    }
}
```

---

## 14. External Side Effects and Transaction Synchronization

### 14.1 The side-effect problem

Database transaction rollback cannot rollback:

- email sent,
- HTTP request to external system,
- Kafka message sent without transaction coordination,
- file written,
- cache invalidated,
- notification pushed,
- S3 object uploaded.

Bad:

```java
@Transactional
public void approve(Long id) {
    CaseRecord c = repository.findById(id).orElseThrow();
    c.approve();
    emailClient.sendApproval(c.getApplicantEmail());
}
```

If email succeeds but DB commit fails, external world sees approval that never committed.

---

### 14.2 After-commit callbacks

Spring provides transaction synchronization callbacks. Conceptually:

```java
@Transactional
public void approve(Long id) {
    CaseRecord c = repository.findById(id).orElseThrow();
    c.approve();

    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                emailClient.sendApproval(c.getApplicantEmail());
            }
        }
    );
}
```

This ensures email is sent only after commit.

But it still has issues:

- if process crashes after commit before callback, email lost,
- callback may run in request thread,
- no retry durable record,
- object `c` may be detached/stale after commit,
- failure handling is hard.

Better for serious systems: outbox pattern.

---

### 14.3 Outbox pattern

Inside DB transaction:

```java
@Transactional
public void approve(Long id) {
    CaseRecord c = repository.findById(id).orElseThrow();
    c.approve();

    outboxRepository.save(new OutboxMessage(
        "APPROVAL_EMAIL_REQUESTED",
        "{\"caseId\":" + id + "}"
    ));
}
```

Worker:

```java
@Transactional
public List<OutboxMessage> claimBatch() {
    return outboxRepository.claimPending(100);
}

public void processMessage(OutboxMessage msg) {
    emailClient.send(...);
    outboxMarker.markSent(msg.id());
}
```

Benefits:

- DB state and message request are atomic,
- retry possible,
- auditability,
- no external call inside user transaction,
- scalable.

Rule:

> For production-grade systems, durable side effects should usually be represented as state first, then delivered asynchronously.

---

## 15. Open Session in View and Transaction Boundary Leakage

Open Session in View (OSIV) keeps persistence context open during web view rendering/API serialization.

Simplified:

```text
request begins
  EntityManager opened
controller/service runs transaction
transaction commits
view/json serialization happens
  lazy loading may still occur because session open
request ends
  EntityManager closed
```

Pros:

- avoids LazyInitializationException in simple apps,
- convenient for server-rendered pages,
- less DTO/fetch planning effort.

Cons:

- DB queries during serialization,
- hidden N+1,
- transaction boundary unclear,
- connection may be acquired late,
- inconsistent reads after service transaction commits,
- API performance unpredictable,
- domain entity leaks to web layer.

Example:

```java
@GetMapping("/cases/{id}")
public CaseRecord getCase(@PathVariable Long id) {
    return caseService.getCase(id); // entity returned directly
}
```

Jackson serializes:

```text
case.officer.name -> lazy load
case.documents -> lazy load N documents
case.comments -> lazy load
case.history -> lazy load thousands
```

Rule:

> For complex backend/API systems, prefer explicit DTO/projection/fetch plan over OSIV-driven accidental loading.

---

## 16. Batch Jobs and Transaction Chunking

Long batch transaction:

```java
@Transactional
public void processAll() {
    List<CaseRecord> cases = repository.findAllPending();
    for (CaseRecord c : cases) {
        c.process();
    }
}
```

Problems:

- huge persistence context,
- long locks,
- huge rollback scope,
- memory pressure,
- large undo/redo,
- one bad row rolls back all,
- connection held long.

Better chunking:

```java
public void processAll() {
    while (true) {
        List<Long> ids = finder.findNextPendingIds(100);
        if (ids.isEmpty()) break;
        processor.processChunk(ids); // @Transactional
    }
}

@Transactional
public void processChunk(List<Long> ids) {
    for (Long id : ids) {
        CaseRecord c = repository.findById(id).orElseThrow();
        c.process();
    }
    em.flush();
    em.clear();
}
```

Even better for per-row failure isolation:

```java
public void processAll() {
    for (Long id : finder.findPendingIds()) {
        try {
            processor.processOne(id); // REQUIRES_NEW or separate transaction call
        } catch (Exception ex) {
            failureRecorder.record(id, ex);
        }
    }
}
```

Trade-off:

| Strategy | Atomicity | Throughput | Failure isolation | Memory |
|---|---:|---:|---:|---:|
| one huge transaction | high global atomicity | poor | poor | poor |
| chunk transaction | medium | good | medium | good |
| one transaction per row | low global atomicity | variable | high | excellent |
| bulk SQL | depends | excellent | low entity lifecycle | excellent |

Rule:

> Batch transaction size is a business and operational decision, not just a performance tuning knob.

---

## 17. Async, Threads, Reactive, and Transaction Context

### 17.1 Thread-bound transaction context

Spring/JPA transaction context is normally thread-bound.

Bad:

```java
@Transactional
public void approveAsync(Long id) {
    CaseRecord c = repository.findById(id).orElseThrow();

    CompletableFuture.runAsync(() -> {
        c.approve(); // using managed entity in another thread: dangerous
    });
}
```

Problems:

- entity manager not thread-safe,
- transaction not propagated,
- entity may be detached by time async runs,
- memory visibility/concurrency issue,
- flush will not happen as expected.

Better:

```java
public void approveAsync(Long id) {
    asyncApprover.approve(id); // pass ID/command, not managed entity
}

@Async
public void approve(Long id) {
    transactionalApprover.approve(id); // own @Transactional boundary in async thread
}
```

Rule:

> Pass identifiers/commands across async boundaries, not managed entities.

---

### 17.2 Reactive note

Classic JPA/Hibernate ORM is blocking and JDBC-based. It assumes thread-bound/session-bound unit-of-work. Reactive persistence stacks use different APIs and transaction context propagation models.

Do not assume classic JPA transaction semantics apply to reactive chains.

---

## 18. Common Failure Modes

### 18.1 LazyInitializationException

Symptom:

```text
could not initialize proxy - no Session
```

Cause:

- lazy association accessed outside active persistence context.

Bad fix:

- make everything EAGER,
- enable OSIV blindly.

Better fixes:

- DTO projection,
- fetch join/entity graph,
- service method maps to DTO inside transaction,
- explicit use case fetch plan.

---

### 18.2 UnexpectedRollbackException

Symptom:

```text
Transaction silently marked rollback-only but outer method returns normally; commit fails.
```

Cause:

- inner exception marked rollback-only,
- outer catches exception and continues,
- same physical transaction.

Fix:

- let exception propagate,
- use separate transaction for independent audit,
- redesign operation boundary.

---

### 18.3 Connection pool exhaustion

Causes:

- transaction too long,
- external calls inside transaction,
- `REQUIRES_NEW` nesting,
- streaming result not closed,
- OSIV lazy loading during serialization,
- batch job holds connection too long.

Diagnosis:

- pool metrics active/idle/pending,
- transaction duration metrics,
- slow SQL logs,
- thread dumps,
- connection leak detection.

Fix:

- shorten transaction,
- move external calls outside/outbox,
- chunk batch,
- close streams,
- tune pool only after fixing boundary.

---

### 18.4 Deadlock

Causes:

- inconsistent lock order,
- long transaction,
- pessimistic lock around slow work,
- batch updates in different orders,
- FK/index missing,
- flush ordering surprises.

Fix:

- standardize lock order,
- reduce transaction duration,
- add indexes,
- use optimistic locking where appropriate,
- retry entire transaction for deadlock victim.

---

### 18.5 Partial side effect

Symptom:

- email sent but DB rollback,
- external case created but local status failed,
- cache invalidated before commit,
- message published for data that does not exist.

Fix:

- outbox pattern,
- after-commit callback for simple non-critical cases,
- idempotent external operation,
- reconciliation job.

---

### 18.6 Stale entity after rollback

Symptom:

- Java object says `APPROVED`, DB says `UNDER_REVIEW`.

Cause:

- object mutated then transaction rollback,
- object leaked outside transaction,
- detached object reused.

Fix:

- do not leak managed entity,
- map DTO after successful boundary,
- discard persistence context after rollback,
- reload state in new transaction.

---

## 19. Design Rules

### Rule 1 — Put transaction boundary around use case, not around random repository calls

Good:

```java
@Transactional
public void submitApplication(SubmitCommand cmd) { ... }
```

Bad:

```java
@Transactional
public void saveApplication(Application app) { ... }
```

The use case knows invariant. Repository save does not.

---

### Rule 2 — Do not perform slow external calls inside DB transaction

Move to:

- outbox,
- after-commit event,
- asynchronous worker,
- saga/process manager.

---

### Rule 3 — Do not return managed entities across boundary

Prefer:

```java
@Transactional(readOnly = true)
public CaseDetailDto getDetail(Long id) {
    CaseRecord c = repository.fetchDetail(id);
    return mapper.toDto(c);
}
```

Avoid:

```java
@Transactional(readOnly = true)
public CaseRecord getDetail(Long id) {
    return repository.findById(id).orElseThrow();
}
```

---

### Rule 4 — Retry whole transaction

Retrying inside broken persistence context is dangerous.

---

### Rule 5 — Exception taxonomy must match rollback policy

Business checked exceptions can accidentally commit unless configured.

---

### Rule 6 — Treat `REQUIRES_NEW` as durability separation

Do not use it casually.

---

### Rule 7 — After rollback, discard object graph

Do not reuse managed/detached object as if rollback restored it.

---

### Rule 8 — Keep pessimistic lock sections short

No network, no file IO, no sleep, no large CPU work.

---

### Rule 9 — Batch with chunking and explicit persistence context control

Use `flush()`/`clear()` carefully.

---

### Rule 10 — Transaction context does not automatically cross threads

Pass IDs/commands, create new transaction in new thread.

---

## 20. Anti-Patterns

### 20.1 Transaction script that does everything

```java
@Transactional
public void hugeOperation() {
    loadData();
    callExternalApi();
    generatePdf();
    updateDb();
    sendEmail();
    sleepOrWait();
}
```

Fix:

- split state change from side effects,
- outbox,
- shorter transaction.

---

### 20.2 Repository owns business transaction

```java
repository.markApproved(id);
repository.closeTask(id);
repository.insertAudit(id);
```

If each method has its own transaction, invariant fragmented.

Fix:

- service-level transaction.

---

### 20.3 Catch-and-continue after persistence failure

```java
try {
    em.flush();
} catch (PersistenceException ignored) {
}
continueWork();
```

Fix:

- abort transaction,
- start independent transaction for failure audit if needed.

---

### 20.4 `@Transactional` on private method

Spring proxy does not intercept private methods in normal proxy mode.

Fix:

- public service method,
- separate bean,
- transaction template.

---

### 20.5 Async managed entity

```java
async(() -> entity.changeStatus());
```

Fix:

```java
async(() -> service.changeStatus(entityId));
```

---

### 20.6 Lazy loading as API serialization strategy

Returning entity directly and hoping JSON serialization loads what is needed is not a fetch strategy.

Fix:

- DTO projection,
- explicit fetch plan.

---

## 21. Diagnostic Checklist

When transaction bug appears, ask these in order.

### 21.1 Boundary

- Where exactly does transaction begin?
- Where exactly does it commit/rollback?
- Is method called through framework proxy/container?
- Is there self-invocation?
- Is there async/thread switch?
- Is persistence context transaction-scoped or extended?

### 21.2 Persistence context

- Which entities are managed?
- Is object detached?
- Was `clear()`/`detach()` called?
- Are changes pending but not flushed?
- Did rollback leave mutated object in memory?

### 21.3 Flush

- Was SQL sent before commit?
- Did a query trigger auto flush?
- Is flush mode changed by read-only transaction?
- Did constraint violation happen at flush or commit?

### 21.4 Rollback

- What exception was thrown?
- Checked or unchecked?
- Did Spring mark rollback-only?
- Was exception caught?
- Was `rollbackFor` configured?
- Did outer transaction try to commit after inner failure?

### 21.5 Propagation

- REQUIRED or REQUIRES_NEW?
- Is inner transaction really independent?
- Could REQUIRES_NEW exhaust connection pool?
- Is NESTED supported by actual transaction manager?

### 21.6 External side effects

- Was email/message/HTTP call done before commit?
- Is there outbox?
- Are side effects idempotent?
- What happens if commit fails after side effect?

### 21.7 Database

- What isolation level?
- What locks are held?
- Any deadlock logs?
- Any long-running transaction?
- Any missing index causing lock escalation/large scan?

---

## 22. Practice Scenarios

### Scenario 1 — Audit must survive failure

Requirement:

- If approval fails, record failure audit.
- If approval succeeds, record success audit.
- Audit must remain even when approval transaction rolls back.

Design:

```java
public void approve(Long id) {
    try {
        approvalService.approve(id); // @Transactional REQUIRED
        auditService.success(id);    // @Transactional REQUIRES_NEW
    } catch (RuntimeException ex) {
        auditService.failure(id, ex); // @Transactional REQUIRES_NEW
        throw ex;
    }
}
```

Caveat:

- ensure `auditService` is separate proxied bean,
- monitor connection pool,
- audit data must not depend on uncommitted DB state from approval transaction.

---

### Scenario 2 — Approval sends email

Bad:

```java
@Transactional
public void approve(Long id) {
    app.approve();
    email.send(...);
}
```

Better:

```java
@Transactional
public void approve(Long id) {
    app.approve();
    outbox.add(ApprovalEmailRequested.of(id));
}
```

Worker sends after commit.

---

### Scenario 3 — Batch 1 million rows

Bad:

```java
@Transactional
public void migrate() {
    repository.findAll().forEach(e -> e.migrate());
}
```

Better:

```java
while (true) {
    List<Long> ids = finder.nextIds(1000);
    if (ids.isEmpty()) break;
    chunkMigrator.migrate(ids); // @Transactional
}
```

Inside chunk:

```java
@Transactional
public void migrate(List<Long> ids) {
    for (Long id : ids) {
        Entity e = em.find(Entity.class, id);
        e.migrate();
    }
    em.flush();
    em.clear();
}
```

---

### Scenario 4 — User catches validation exception and transaction commits unexpectedly

Cause:

- validation exception checked,
- no rollback rule,
- entity already mutated.

Fix:

- validate before mutation,
- use unchecked exception or `rollbackFor`,
- design command validation outside transaction if possible.

---

## 23. Java 8–25 Compatibility Notes

### Java 8 era

Typical stack:

- JPA 2.1/2.2,
- `javax.persistence`,
- Hibernate 5.x,
- EclipseLink 2.x,
- Java EE / Spring Framework 4/5 era.

Concerns:

- older provider defaults,
- less modern type support,
- legacy app server transaction manager,
- `javax.transaction` vs `jakarta.transaction` namespace.

---

### Java 11/17 era

Typical stack:

- transition toward Jakarta,
- Spring Boot 2.x still `javax`, Boot 3.x `jakarta`,
- Hibernate 5.6/6.x,
- EclipseLink 3.x/4.x depending Jakarta EE level.

Concerns:

- namespace migration,
- module path/classpath,
- provider version alignment,
- transaction manager dependency alignment.

---

### Java 21/25 era

Typical modern stack:

- Jakarta Persistence 3.x,
- Hibernate ORM 6/7,
- EclipseLink 4.x,
- Spring Framework 6/7 line,
- Jakarta EE 10/11 alignment.

Concerns:

- virtual threads do not make JPA non-blocking,
- thread-local transaction context still matters,
- JDBC remains blocking,
- transaction boundaries still need explicit design,
- newer provider versions may change query/type/dialect behavior.

Rule:

> Java runtime can evolve, but classic ORM transaction invariants remain: EntityManager is not thread-safe, persistence context is stateful, and transaction context must be controlled.

---

## 24. Provider Comparison Summary

| Concern | Hibernate | EclipseLink |
|---|---|---|
| Core unit | `Session` | `UnitOfWork`/Session model |
| JPA facade | `EntityManager` wraps Session | `EntityManager` maps to EclipseLink sessions/unit of work |
| Change tracking | snapshot and bytecode enhancement options | deferred/object/attribute change tracking, weaving |
| Transaction integration | strong Spring/JTA integration | strong Jakarta EE/JTA integration, also Spring usable |
| Cache | first-level + optional second-level | shared cache historically prominent |
| Flush behavior | action queue, flush modes, auto flush | UnitOfWork commit/flush behavior |
| Risk focus | action queue/flush/fetch/cache/provider extensions | weaving/shared cache/descriptor/unit-of-work behavior |

---

## 25. Practical Architecture Patterns

### 25.1 Command service pattern

```java
public record ApproveCaseCommand(
    Long caseId,
    String officerId,
    String reason
) {}

@Service
public class ApproveCaseUseCase {

    @Transactional
    public void handle(ApproveCaseCommand cmd) {
        CaseRecord c = caseRepository.get(cmd.caseId());
        c.approve(cmd.officerId(), cmd.reason());
        outbox.add(CaseApprovedEvent.from(c));
    }
}
```

Why good:

- boundary at use case,
- no managed entity escapes,
- side effect represented as durable state,
- domain invariant local.

---

### 25.2 Read service pattern

```java
@Service
public class CaseQueryService {

    @Transactional(readOnly = true)
    public CaseDetailDto getDetail(Long caseId) {
        return caseRepository.fetchDetailDto(caseId);
    }
}
```

Why good:

- read-only intent,
- DTO/projection avoids lazy serialization,
- no mutation expected.

---

### 25.3 Failure audit pattern

```java
@Service
public class FailureAuditService {

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailure(String operation, Long entityId, String reason) {
        auditRepository.save(AuditLog.failure(operation, entityId, reason));
    }
}
```

Why good:

- independent durability,
- explicit semantics.

Caveat:

- do not overuse,
- monitor pool,
- make audit payload self-contained.

---

## 26. Summary

Transaction integration is where ORM stops being annotation knowledge and becomes production engineering.

The core lessons:

1. Business transaction, persistence context, JDBC transaction, and framework method boundary are related but not identical.
2. Resource-local transaction is explicit and simple, but manual.
3. JTA/Jakarta Transactions coordinates managed/container/distributed transaction scenarios.
4. Spring `@Transactional` is an interceptor boundary with propagation and rollback rules.
5. Flush is SQL synchronization, not commit.
6. Rollback restores database state, not Java object state.
7. Exception handling determines rollback behavior; checked exceptions can surprise you.
8. `REQUIRES_NEW` creates durability separation and can consume extra connections.
9. Read-only transaction is useful but not an absolute correctness/security mechanism.
10. External side effects should not happen blindly inside DB transactions.
11. OSIV hides fetch-plan bugs and transaction leakage.
12. Async/thread boundaries require new transaction context and should pass IDs, not managed entities.
13. Batch jobs need transaction chunking and persistence context control.
14. Retry should happen around the whole transaction boundary.

Top 1% persistence engineers do not ask only:

> “Where do I put `@Transactional`?”

They ask:

> “What state must be atomic, what object graph is managed, when can SQL be emitted, what locks are held, what happens on rollback, and what side effects survive commit failure?”

---

## 27. Connection to Next Part

Part 18 established the transaction boundary around ORM state synchronization.

Next part:

```text
19-concurrency-control-optimistic-pessimistic-locking-lost-updates.md
```

There we go deeper into:

- optimistic locking,
- pessimistic locking,
- lost update,
- write skew,
- lock modes,
- deadlocks,
- isolation-level limitations,
- aggregate versioning,
- retry strategy.

Transaction boundary defines the arena. Concurrency control defines what happens when multiple actors enter the arena at the same time.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./17-bulk-operations-batching-stateless-sessions-high-volume-mutation.md">⬅️ Part 17 — Bulk Operations, Batching, Stateless Sessions, and High-Volume Data Mutation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./19-concurrency-control-optimistic-pessimistic-locking-lost-updates.md">Part 19 — Concurrency Control: Optimistic Locking, Pessimistic Locking, and Lost Updates ➡️</a>
</div>
