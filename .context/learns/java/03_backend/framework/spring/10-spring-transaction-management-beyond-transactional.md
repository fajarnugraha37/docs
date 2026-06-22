# 10 — Spring Transaction Management Beyond `@Transactional`

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> Part: `10` dari `35`  
> File: `10-spring-transaction-management-beyond-transactional.md`  
> Target pembaca: engineer Java/Spring advanced yang ingin memahami transaksi sebagai runtime boundary, bukan sekadar annotation.

---

## 0. Tujuan Part Ini

Banyak developer Spring memakai `@Transactional` seperti saklar ajaib:

```java
@Transactional
public void approveCase(Long caseId) {
    // do database changes
}
```

Lalu muncul pertanyaan klasik:

- Kenapa rollback tidak terjadi?
- Kenapa `REQUIRES_NEW` tidak aktif?
- Kenapa audit event terkirim padahal transaksi rollback?
- Kenapa method internal yang dipanggil dari class yang sama tidak transactional?
- Kenapa `@Transactional(readOnly = true)` masih bisa menulis?
- Kenapa transaksi hilang ketika masuk `@Async`?
- Kenapa retry menghasilkan duplikasi data?
- Kenapa event listener membaca data yang belum commit?
- Kenapa connection pool habis saat banyak `REQUIRES_NEW`?

Part ini membahas **Spring transaction management sebagai sistem runtime**.

Kita tidak akan mengulang teori ACID/database secara panjang karena sudah dibahas di seri SQL/JDBC/JPA. Fokusnya adalah:

1. Bagaimana Spring membangun transaksi.
2. Bagaimana transaksi terhubung dengan proxy/AOP.
3. Bagaimana resource seperti JDBC `Connection` atau JPA `EntityManager` diikat ke thread.
4. Bagaimana propagation sebenarnya bekerja.
5. Bagaimana rollback diputuskan.
6. Bagaimana event, async, retry, cache, external API, dan messaging berinteraksi dengan transaksi.
7. Bagaimana mendesain transaction boundary yang benar untuk sistem enterprise.

---

## 1. Mental Model Utama

Spring transaction bukan “database transaction” itu sendiri.

Spring transaction adalah **abstraction layer** yang mengatur:

```text
business method invocation
        |
        v
transaction interceptor / advisor
        |
        v
transaction manager
        |
        v
underlying resource transaction
        |
        +-- JDBC Connection transaction
        +-- JPA EntityManager transaction
        +-- JTA global transaction
        +-- reactive transaction context
```

Jadi, ketika kita menulis:

```java
@Transactional
public void submitApplication(ApplicationId id) {
    applicationRepository.markSubmitted(id);
}
```

Spring tidak “menyisipkan commit” ke source code kita. Yang terjadi adalah:

1. Spring membuat proxy untuk bean.
2. Caller memanggil proxy, bukan target object langsung.
3. Proxy menjalankan `TransactionInterceptor`.
4. Interceptor membaca metadata transaksi dari `@Transactional`.
5. Interceptor meminta `PlatformTransactionManager` membuka/bergabung dengan transaksi.
6. Business method dipanggil.
7. Jika method berhasil, transaksi di-commit.
8. Jika exception sesuai rollback rule, transaksi di-rollback.
9. Resource dan synchronization dibersihkan.

Secara mental:

```text
@Transactional bukan kemampuan method.
@Transactional adalah instruksi kepada interceptor yang ada di luar method.
```

Konsekuensinya sangat besar:

```text
Jika call tidak melewati proxy, transaksi tidak aktif.
Jika thread berubah, resource transaksi tidak ikut otomatis.
Jika rollback rule tidak cocok, transaksi tetap commit.
Jika external side effect terjadi sebelum commit, Spring tidak bisa membatalkannya.
```

---

## 2. Posisi Transaction dalam Arsitektur Spring

Spring transaction berada di antara:

```text
Application Service
       |
       v
Spring AOP / Proxy
       |
       v
Transaction Interceptor
       |
       v
Transaction Manager
       |
       v
Resource-specific infrastructure
       |
       +-- DataSource / JDBC Connection
       +-- EntityManagerFactory / EntityManager
       +-- JMS Session
       +-- JTA Transaction Manager
```

Komponen kunci:

| Komponen | Peran |
|---|---|
| `@Transactional` | Metadata deklaratif untuk transaction attribute |
| `TransactionInterceptor` | Advice yang membuka/commit/rollback transaksi |
| `TransactionAttributeSource` | Membaca metadata transaksi dari annotation/XML/source lain |
| `PlatformTransactionManager` | Abstraksi utama transaksi imperative |
| `TransactionStatus` | Status transaksi saat ini |
| `TransactionDefinition` | Propagation, isolation, timeout, read-only, name |
| `TransactionSynchronizationManager` | Penyimpan resource dan callback per thread |
| `TransactionTemplate` | API programmatic transaction |
| `TransactionalEventListener` | Listener event berbasis fase transaksi |

Spring transaction adalah contoh sempurna dari kombinasi:

```text
metadata + proxy + interceptor + thread-bound resource + resource-specific adapter
```

---

## 3. Declarative vs Programmatic Transaction

Ada dua gaya utama.

### 3.1 Declarative Transaction

Contoh:

```java
@Service
public class CaseApprovalService {

    @Transactional
    public void approve(CaseId caseId, OfficerId officerId) {
        CaseFile caseFile = caseRepository.getRequired(caseId);
        caseFile.approveBy(officerId);
        caseRepository.save(caseFile);
    }
}
```

Karakteristik:

- boundary terlihat dari annotation
- cocok untuk service/application use case
- mudah dibaca
- terintegrasi dengan AOP
- rawan self-invocation jika tidak paham proxy
- kurang fleksibel untuk boundary kecil di tengah method

### 3.2 Programmatic Transaction

Contoh dengan `TransactionTemplate`:

```java
@Service
public class CaseApprovalService {

    private final TransactionTemplate transactionTemplate;
    private final CaseRepository caseRepository;
    private final AuditPublisher auditPublisher;

    public CaseApprovalService(
            TransactionTemplate transactionTemplate,
            CaseRepository caseRepository,
            AuditPublisher auditPublisher
    ) {
        this.transactionTemplate = transactionTemplate;
        this.caseRepository = caseRepository;
        this.auditPublisher = auditPublisher;
    }

    public void approve(CaseId caseId, OfficerId officerId) {
        ApprovalResult result = transactionTemplate.execute(status -> {
            CaseFile caseFile = caseRepository.getRequired(caseId);
            caseFile.approveBy(officerId);
            caseRepository.save(caseFile);
            return ApprovalResult.approved(caseFile.id());
        });

        auditPublisher.publishAfterTransactionBoundary(result);
    }
}
```

Karakteristik:

- boundary eksplisit secara kode
- cocok untuk transaksi kecil di dalam flow besar
- cocok saat perlu menghindari long transaction
- cocok saat external call harus berada di luar transaksi
- bisa membuat business method lebih verbose

### 3.3 Kapan Pakai Declarative?

Gunakan declarative untuk:

```text
satu use case application service = satu transaction boundary utama
```

Contoh:

```java
@Transactional
public void assignInvestigator(CaseId caseId, OfficerId officerId) { ... }
```

### 3.4 Kapan Pakai Programmatic?

Gunakan programmatic saat:

1. Perlu memisahkan DB transaction dari external API call.
2. Perlu commit dulu sebelum publish/notify.
3. Perlu beberapa transaksi kecil dalam satu orchestration.
4. Perlu fallback/compensation yang eksplisit.
5. Perlu menjalankan query read-only pendek di tengah proses panjang.
6. Perlu menghindari proxy/self-invocation complexity.

Contoh buruk:

```java
@Transactional
public void submitAndNotify(ApplicationId id) {
    applicationRepository.submit(id);
    externalNotificationClient.notifyApplicant(id); // berbahaya di dalam transaksi
}
```

Lebih baik:

```java
public void submitAndNotify(ApplicationId id) {
    SubmissionResult result = transactionTemplate.execute(status -> {
        applicationRepository.submit(id);
        outboxRepository.insertNotificationRequested(id);
        return SubmissionResult.success(id);
    });

    // worker/outbox publisher memproses side effect setelah commit
}
```

---

## 4. Bagaimana `@Transactional` Bekerja

`@Transactional` biasanya bekerja melalui Spring AOP proxy.

Alur konseptual:

```text
caller
  |
  v
proxy bean
  |
  v
TransactionInterceptor.invoke()
  |
  +-- read transaction attribute
  +-- determine transaction manager
  +-- create/join/suspend transaction
  +-- invoke target method
  +-- commit or rollback
  +-- cleanup
```

Contoh:

```java
@Service
public class PaymentService {

    @Transactional
    public void pay(InvoiceId invoiceId) {
        // target method
    }
}
```

Yang dipanggil caller sebenarnya:

```text
PaymentService proxy
```

bukan langsung:

```text
PaymentService target instance
```

Itulah sebabnya kasus ini tidak bekerja:

```java
@Service
public class CaseService {

    public void submit(CaseId id) {
        validate(id);
        persistSubmission(id); // self-invocation, tidak melewati proxy
    }

    @Transactional
    public void persistSubmission(CaseId id) {
        // transaksi mungkin tidak aktif jika dipanggil dari method dalam class yang sama
    }
}
```

Solusi yang lebih bersih:

```java
@Service
public class CaseSubmissionService {

    private final CasePersistenceService persistenceService;

    public CaseSubmissionService(CasePersistenceService persistenceService) {
        this.persistenceService = persistenceService;
    }

    public void submit(CaseId id) {
        validate(id);
        persistenceService.persistSubmission(id); // melewati proxy bean lain
    }
}

@Service
public class CasePersistenceService {

    @Transactional
    public void persistSubmission(CaseId id) {
        // transactional boundary aktif
    }
}
```

Guideline:

```text
Jangan mendesain transaction boundary sebagai private/internal helper method.
Desain transaction boundary sebagai public application operation yang dipanggil dari luar bean proxy.
```

---

## 5. Method Visibility dan Proxy Limitation

Di Spring versi lama, `@Transactional` proxy-based umumnya diasosiasikan dengan public method. Di Spring modern, ada peningkatan dukungan untuk method non-public dalam kondisi tertentu, tetapi untuk engineering guideline lintas Java 8–25 dan Spring 5–7, aturan paling aman tetap:

```text
Letakkan @Transactional pada public method application service.
```

Kenapa?

Karena kompatibilitas dan readability.

Method berikut rawan membingungkan:

```java
@Transactional
protected void persistInternal(...) { ... }
```

atau:

```java
@Transactional
private void persistInternal(...) { ... }
```

Masalahnya:

- private method tidak bisa diproxy dengan model proxy biasa
- protected/package-private behavior bergantung versi/proxy mechanism
- self-invocation tetap problem
- pembaca kode sulit melihat boundary sistem

Untuk sistem enterprise:

```text
Transaction boundary harus terlihat sebagai boundary use case, bukan detail helper internal.
```

---

## 6. `PlatformTransactionManager`

`PlatformTransactionManager` adalah abstraction utama transaksi imperative.

Konsepnya:

```java
public interface PlatformTransactionManager {
    TransactionStatus getTransaction(TransactionDefinition definition);
    void commit(TransactionStatus status);
    void rollback(TransactionStatus status);
}
```

Implementasi umum:

| Manager | Kapan dipakai |
|---|---|
| `DataSourceTransactionManager` | JDBC dengan satu `DataSource` |
| `JdbcTransactionManager` | JDBC modern dengan exception translation commit/rollback lebih baik |
| `JpaTransactionManager` | JPA `EntityManagerFactory` |
| `JtaTransactionManager` | Global/XA/JTA transaction |
| `R2dbcTransactionManager` | Reactive R2DBC |

Mental model:

```text
@Transactional tidak tahu cara commit database.
@Transactional meminta transaction manager melakukan begin/commit/rollback.
```

Kalau aplikasi punya lebih dari satu transaction manager:

```java
@Transactional(transactionManager = "caseTransactionManager")
public void updateCase(...) { ... }
```

Jika tidak eksplisit, Spring harus memilih manager default. Pada aplikasi besar, ambiguity transaction manager bisa menyebabkan bug yang sulit dibaca.

Guideline:

```text
Jika service menyentuh lebih dari satu datastore, desain boundary secara eksplisit.
Jangan berharap satu @Transactional otomatis membuat distributed transaction yang benar.
```

---

## 7. Transaction Definition

Metadata transaksi berisi:

| Attribute | Makna |
|---|---|
| propagation | Bagaimana method berinteraksi dengan transaksi yang sudah ada |
| isolation | Isolation level database |
| timeout | Batas durasi transaksi |
| readOnly | Hint bahwa transaksi hanya baca |
| rollbackFor/noRollbackFor | Aturan rollback |
| transactionManager | Manager yang digunakan |
| label | Label transaksi untuk integrasi/observability tertentu |

Contoh:

```java
@Transactional(
        propagation = Propagation.REQUIRED,
        isolation = Isolation.READ_COMMITTED,
        timeout = 10,
        readOnly = false,
        rollbackFor = BusinessRollbackException.class
)
public void approve(CaseId id) { ... }
```

Jangan menganggap semua attribute selalu dipaksa oleh Spring. Banyak attribute menjadi instruksi kepada transaction manager/resource. Misalnya `readOnly` sering berupa hint yang bisa dioptimalkan oleh provider, tetapi tidak selalu menjadi larangan hard write di semua database/provider.

---

## 8. Propagation: Konsep Paling Sering Disalahpahami

Propagation menjawab:

```text
Jika method transactional dipanggil saat sudah ada transaksi, apa yang harus dilakukan?
```

Bukan menjawab:

```text
Bagaimana database mengunci row?
```

Itu isolation/locking.

### 8.1 REQUIRED

Default.

```java
@Transactional(propagation = Propagation.REQUIRED)
public void updateCase(...) { ... }
```

Makna:

```text
Jika sudah ada transaksi, ikut.
Jika belum ada, buat transaksi baru.
```

Contoh:

```java
@Transactional
public void submitApplication(ApplicationId id) {
    validateApplication(id);
    createSubmissionRecord(id);
    updateApplicantStatus(id);
}
```

Jika tiga method internal semuanya `REQUIRED` dan dipanggil melalui proxy, mereka tetap menggunakan transaksi fisik yang sama.

Mental model:

```text
REQUIRED = logical scope baru, physical transaction bisa sama.
```

Risiko:

Jika inner scope menandai rollback-only, outer scope yang mencoba commit akan gagal dengan rollback.

### 8.2 REQUIRES_NEW

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void insertAuditLog(...) { ... }
```

Makna:

```text
Suspend transaksi saat ini.
Buat transaksi fisik baru.
Commit/rollback independen.
Resume transaksi lama setelah selesai.
```

Contoh valid:

```java
@Transactional
public void approveCase(CaseId id) {
    caseRepository.approve(id);
    auditService.recordAttempt(id); // REQUIRES_NEW
    riskyOperation(id);
}
```

Jika `riskyOperation` gagal dan transaksi utama rollback, audit attempt tetap commit.

Tapi ini bukan gratis.

Risiko:

1. Butuh connection tambahan.
2. Bisa menyebabkan connection pool starvation.
3. Bisa membuat audit tidak konsisten jika semantik audit tidak dipikirkan.
4. Bisa menulis data yang mereferensikan perubahan utama yang akhirnya rollback.

Contoh buruk:

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void createChildRecordReferencingUncommittedParent(ParentId id) { ... }
```

Jika parent dibuat di transaksi outer dan belum commit, inner transaction mungkin tidak bisa melihatnya atau menghasilkan referential problem.

### 8.3 NESTED

Makna:

```text
Gunakan satu physical transaction dengan savepoint.
Inner failure bisa rollback ke savepoint tanpa menggagalkan seluruh transaksi, jika manager/database mendukung.
```

Contoh:

```java
@Transactional
public void importFile(FileId id) {
    for (Row row : rows) {
        rowImporter.importRow(row); // NESTED, rollback row tertentu ke savepoint
    }
}
```

Risiko:

- tidak semua transaction manager mendukung
- sering terkait JDBC savepoint
- tidak sama dengan `REQUIRES_NEW`
- commit tetap bergantung outer transaction

Mental model:

```text
REQUIRES_NEW = transaksi fisik baru.
NESTED = savepoint dalam transaksi fisik yang sama.
```

### 8.4 SUPPORTS

Makna:

```text
Jika ada transaksi, ikut.
Jika tidak ada, jalan tanpa transaksi.
```

Cocok untuk read operation yang bisa berjalan dalam atau luar transaksi.

Risiko:

Behavior bisa berbeda tergantung caller.

### 8.5 NOT_SUPPORTED

Makna:

```text
Suspend transaksi jika ada.
Jalankan tanpa transaksi.
```

Cocok untuk operasi yang tidak boleh menahan transaksi lama, misalnya external call tertentu setelah data snapshot diambil.

### 8.6 MANDATORY

Makna:

```text
Harus sudah ada transaksi.
Jika tidak ada, error.
```

Cocok untuk internal component yang tidak boleh menentukan boundary sendiri.

Contoh:

```java
@Transactional(propagation = Propagation.MANDATORY)
public void appendCaseHistory(...) { ... }
```

Artinya append history harus menjadi bagian dari use case transaction.

### 8.7 NEVER

Makna:

```text
Harus tidak ada transaksi.
Jika ada transaksi, error.
```

Jarang dipakai, tetapi berguna sebagai guardrail untuk operasi yang berbahaya jika dilakukan dalam transaksi.

---

## 9. Logical Transaction vs Physical Transaction

Salah satu mental model paling penting:

```text
@Transactional method menciptakan logical transaction scope.
Physical transaction adalah resource transaction di database/connection.
```

Contoh:

```java
@Transactional
public void outer() {
    innerA();
    innerB();
}

@Transactional
public void innerA() { ... }

@Transactional
public void innerB() { ... }
```

Jika semua `REQUIRED`, maka:

```text
outer logical scope
  innerA logical scope
  innerB logical scope

physical DB transaction: satu
```

Jika `innerA` menandai rollback-only:

```text
outer mencoba commit
  -> Spring sadar physical transaction rollback-only
  -> rollback terjadi
  -> bisa muncul UnexpectedRollbackException
```

Kenapa Spring tidak diam-diam commit sebagian?

Karena jika inner logical scope gagal dan meminta rollback, physical transaction yang sama tidak bisa dianggap valid untuk commit penuh.

---

## 10. Isolation Level

Isolation menjawab:

```text
Perubahan transaksi lain terlihat seperti apa?
```

Spring menyediakan enum:

- `DEFAULT`
- `READ_UNCOMMITTED`
- `READ_COMMITTED`
- `REPEATABLE_READ`
- `SERIALIZABLE`

Contoh:

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void approve(CaseId id) { ... }
```

Tetapi perlu hati-hati:

1. Isolation yang benar-benar berlaku tergantung database.
2. `DEFAULT` berarti pakai default database/datasource.
3. Mengubah isolation di level service bisa mahal.
4. Isolation bukan pengganti domain concurrency control.
5. Untuk banyak sistem enterprise, optimistic locking/versioning tetap diperlukan.

Contoh misconception:

```text
“Saya sudah pakai @Transactional, jadi race condition hilang.”
```

Salah.

`@Transactional` mengatur atomicity boundary. Race condition antar request tetap bisa terjadi jika tidak ada locking/versioning/unique constraint/invariant enforcement.

---

## 11. Timeout

Timeout transaksi:

```java
@Transactional(timeout = 5)
public void recalculateRiskScore(CaseId id) { ... }
```

Makna:

```text
Transaksi diharapkan selesai dalam batas waktu tertentu.
```

Tapi enforcement bisa tergantung transaction manager/resource.

Guideline:

```text
Gunakan timeout untuk melindungi sistem dari transaksi menggantung.
Jangan gunakan timeout sebagai pengganti query tuning atau cancellation strategy.
```

Untuk sistem besar, timeout harus konsisten dengan:

- HTTP request timeout
- database statement timeout
- connection acquisition timeout
- lock wait timeout
- upstream/downstream timeout
- scheduler timeout
- queue visibility timeout

Jika HTTP timeout 30 detik tetapi transaction timeout 5 menit, request bisa gagal di client tetapi database transaction masih berjalan.

---

## 12. Read-Only Transaction

Contoh:

```java
@Transactional(readOnly = true)
public CaseDetail getCaseDetail(CaseId id) {
    return caseRepository.findDetail(id);
}
```

Makna:

```text
Transaksi ini dimaksudkan untuk read-only.
```

Manfaat potensial:

- provider bisa mengurangi dirty checking
- database/driver bisa menerima hint read-only
- dokumentasi intent
- membantu reviewer melihat boundary

Tapi jangan salah:

```text
readOnly=true bukan selalu hard enforcement bahwa write mustahil.
```

Contoh buruk:

```java
@Transactional(readOnly = true)
public void queryAndMutate(CaseId id) {
    CaseFile caseFile = repository.getRequired(id);
    caseFile.markViewed(); // mungkin tidak flush, mungkin flush tergantung provider/config
}
```

Guideline:

```text
Jangan menaruh mutation logic di read-only transaction.
Anggap readOnly sebagai contract intent + optimization hint, bukan security boundary.
```

---

## 13. Rollback Rules

Default penting:

```text
Spring rollback untuk RuntimeException dan Error.
Spring tidak rollback secara default untuk checked exception.
```

Contoh:

```java
@Transactional
public void submit(ApplicationId id) throws BusinessValidationException {
    applicationRepository.markSubmitted(id);
    throw new BusinessValidationException("invalid");
}
```

Jika `BusinessValidationException` adalah checked exception, default-nya transaksi mungkin commit kecuali dikonfigurasi rollback.

Solusi:

```java
@Transactional(rollbackFor = BusinessValidationException.class)
public void submit(ApplicationId id) throws BusinessValidationException {
    applicationRepository.markSubmitted(id);
    throw new BusinessValidationException("invalid");
}
```

Atau ubah taxonomy exception:

```text
Exception yang berarti use case gagal dan state harus rollback sebaiknya runtime exception yang jelas.
Exception yang berarti business alternative bisa menjadi return value/result object.
```

### 13.1 `rollbackFor`

```java
@Transactional(rollbackFor = ExternalReconciliationException.class)
public void reconcile(...) { ... }
```

### 13.2 `noRollbackFor`

```java
@Transactional(noRollbackFor = NonCriticalNotificationException.class)
public void approve(...) { ... }
```

Gunakan hati-hati.

Jika exception tetap dilempar ke caller tetapi transaksi commit, caller bisa salah menganggap semua gagal.

### 13.3 Catching Exception Inside Transaction

Contoh berbahaya:

```java
@Transactional
public void process(CaseId id) {
    try {
        caseRepository.update(id);
        riskyOperation();
    } catch (RuntimeException ex) {
        log.warn("ignored", ex);
    }
}
```

Jika exception ditangkap dan tidak dilempar ulang, interceptor melihat method berhasil lalu commit.

Kalau memang ingin rollback setelah catch:

```java
@Transactional
public void process(CaseId id) {
    try {
        caseRepository.update(id);
        riskyOperation();
    } catch (RuntimeException ex) {
        TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
        throw ex;
    }
}
```

Namun lebih bersih biasanya jangan swallow exception yang harus menggagalkan use case.

---

## 14. TransactionSynchronizationManager

Ini salah satu komponen paling penting tapi sering tidak terlihat.

`TransactionSynchronizationManager` mengelola:

```text
resources bound to current thread
transaction synchronizations bound to current thread
current transaction name
read-only flag
isolation level
actual transaction active flag
```

Contoh resource:

```text
DataSource -> ConnectionHolder
EntityManagerFactory -> EntityManagerHolder
```

Mental model:

```text
Transaksi imperative Spring umumnya thread-bound.
Thread yang sama dapat menemukan Connection/EntityManager yang sama melalui TransactionSynchronizationManager.
```

Itulah mengapa ini berbahaya:

```java
@Transactional
public void process(CaseId id) {
    repository.update(id);

    CompletableFuture.runAsync(() -> {
        repository.updateOtherThing(id); // thread berbeda, transaksi tidak otomatis ikut
    });
}
```

Transaksi tidak “mengalir” otomatis ke thread lain.

Jika butuh async work:

- lakukan setelah commit
- gunakan outbox
- gunakan message queue
- gunakan `@TransactionalEventListener(phase = AFTER_COMMIT)`
- atau buka transaction boundary baru secara eksplisit di async worker

---

## 15. Transaction Synchronization Callback

Spring menyediakan callback pada fase transaksi.

Konsep:

```text
beforeCommit
beforeCompletion
afterCommit
afterCompletion
```

Gunanya:

- menjalankan action setelah commit
- membersihkan resource
- menunda publish event sampai transaksi sukses
- menjalankan audit sink tertentu

Contoh manual:

```java
public void registerAfterCommit(Runnable action) {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    } else {
        action.run();
    }
}
```

Namun untuk application event, Spring menyediakan model lebih nyaman:

```java
@Component
public class CaseEventListener {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onCaseApproved(CaseApprovedEvent event) {
        // hanya jalan setelah transaksi commit
    }
}
```

Guideline:

```text
Side effect eksternal sebaiknya tidak dijalankan sebelum commit, kecuali memang didesain sebagai best-effort/compensatable.
```

---

## 16. Transactional Event Listener

`@TransactionalEventListener` memecahkan masalah umum:

```text
Saya ingin publish event dari domain/application service, tetapi handler hanya boleh jalan jika transaksi commit.
```

Contoh:

```java
@Service
public class CaseApprovalService {

    private final ApplicationEventPublisher events;
    private final CaseRepository repository;

    public CaseApprovalService(ApplicationEventPublisher events, CaseRepository repository) {
        this.events = events;
        this.repository = repository;
    }

    @Transactional
    public void approve(CaseId id) {
        CaseFile caseFile = repository.getRequired(id);
        caseFile.approve();
        repository.save(caseFile);

        events.publishEvent(new CaseApprovedEvent(id));
    }
}
```

Listener:

```java
@Component
public class CaseApprovedListener {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void sendNotification(CaseApprovedEvent event) {
        // safe: transaksi utama sudah commit
    }
}
```

Fase:

| Phase | Makna |
|---|---|
| `BEFORE_COMMIT` | Sebelum commit, masih bisa ikut transaksi |
| `AFTER_COMMIT` | Setelah commit sukses |
| `AFTER_ROLLBACK` | Setelah rollback |
| `AFTER_COMPLETION` | Setelah commit/rollback selesai |

Important nuance:

```text
AFTER_COMMIT bukan distributed transaction dengan external system.
Jika listener gagal setelah commit, database utama sudah commit.
```

Jika action external harus reliable, gunakan outbox.

---

## 17. Transaction + External API

Ini salah satu sumber incident enterprise.

Contoh buruk:

```java
@Transactional
public void approve(CaseId id) {
    caseRepository.approve(id);
    paymentGateway.capture(id);      // external side effect
    notificationClient.notify(id);   // external side effect
}
```

Masalah:

1. Jika external API lambat, DB transaction menahan lock/connection terlalu lama.
2. Jika external API sukses lalu DB rollback, side effect tidak bisa dibatalkan otomatis.
3. Jika DB commit sukses lalu API gagal, state menjadi partial.
4. Jika retry dilakukan di HTTP layer, bisa double capture/notify.

Pattern lebih aman:

```java
@Transactional
public void approve(CaseId id) {
    caseRepository.approve(id);
    outboxRepository.insert(new NotificationRequested(id));
}
```

Worker:

```java
@Scheduled(fixedDelay = 1000)
public void publishOutbox() {
    List<OutboxMessage> messages = outboxRepository.lockNextBatch();
    for (OutboxMessage message : messages) {
        notificationClient.send(message);
        outboxRepository.markPublished(message.id());
    }
}
```

Mental model:

```text
Database transaction bisa menjamin perubahan database.
External side effect butuh reliability pattern: outbox, idempotency, retry, reconciliation, compensation.
```

---

## 18. Transaction + Retry

Retry dan transaction harus hati-hati.

Contoh:

```java
@Retryable
@Transactional
public void process(CaseId id) { ... }
```

Pertanyaan penting:

```text
Retry membungkus transaksi, atau transaksi membungkus retry?
```

Urutan advice matters.

Ideal untuk banyak kasus:

```text
retry outer
  transaction attempt 1
  transaction attempt 2
  transaction attempt 3
```

Bukan:

```text
transaction outer
  retry inside same transaction
```

Kenapa?

Jika satu attempt gagal dan transaction menjadi rollback-only, retry berikutnya dalam transaksi yang sama bisa tetap gagal atau menghasilkan state aneh.

Guideline:

```text
Untuk retry database transient failure, setiap retry attempt sebaiknya punya transaksi baru.
```

Selain itu:

- retry hanya untuk error transient
- operation harus idempotent atau punya uniqueness guard
- jangan retry business validation error
- jangan retry external non-idempotent side effect tanpa idempotency key

---

## 19. Transaction + Async

Contoh berbahaya:

```java
@Transactional
public void submit(CaseId id) {
    caseRepository.submit(id);
    asyncNotifier.notify(id);
}

@Async
public void notify(CaseId id) {
    CaseFile caseFile = caseRepository.getRequired(id);
    // bisa jalan sebelum transaksi submit commit
}
```

Masalah:

1. Async berjalan di thread lain.
2. Transaction context tidak ikut.
3. Async bisa membaca data sebelum commit.
4. Jika transaksi utama rollback, async tetap bisa jalan.

Solusi:

```java
@Transactional
public void submit(CaseId id) {
    caseRepository.submit(id);
    events.publishEvent(new CaseSubmittedEvent(id));
}

@Async
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void notifyAfterCommit(CaseSubmittedEvent event) {
    notifier.notify(event.caseId());
}
```

Tetapi untuk reliability tinggi, tetap lebih kuat pakai outbox/queue.

---

## 20. Transaction + Cache

Contoh:

```java
@Transactional
@CacheEvict(cacheNames = "cases", key = "#id")
public void updateCase(CaseId id, UpdateRequest request) {
    caseRepository.update(id, request);
}
```

Pertanyaan:

```text
Kapan cache dievict? Sebelum atau sesudah commit?
Apa yang terjadi jika DB rollback setelah cache eviction?
```

Cache operation juga sering berbasis proxy advice. Ordering dengan transaction advice penting.

Risiko:

1. Cache diupdate tapi DB rollback.
2. Cache dievict terlalu cepat, request lain reload data lama sebelum commit.
3. Cache menyimpan object mutable yang masih terkait persistence context.

Guideline:

```text
Untuk consistency penting, integrasikan cache invalidation dengan after-commit behavior atau gunakan pattern yang jelas.
```

Cache bukan bagian otomatis dari database transaction kecuali cache provider/transaction-aware cache manager mendukung dan dikonfigurasi.

---

## 21. Transaction + Messaging

Contoh buruk:

```java
@Transactional
public void approve(CaseId id) {
    caseRepository.approve(id);
    kafkaTemplate.send("case-approved", id.value());
}
```

Jika Kafka send berhasil tapi DB rollback, consumer menerima event untuk state yang tidak ada.

Jika DB commit tapi Kafka send gagal, state berubah tapi event hilang.

Solusi umum:

```text
transactional outbox
```

Dalam transaksi database:

```java
@Transactional
public void approve(CaseId id) {
    caseRepository.approve(id);
    outboxRepository.insert(
        OutboxMessage.of("CASE_APPROVED", id.value())
    );
}
```

Publisher terpisah membaca outbox setelah commit.

Untuk beberapa sistem, Kafka transaction bisa dipakai, tetapi desainnya harus sangat jelas dan tidak boleh diasumsikan otomatis hanya karena ada `@Transactional`.

---

## 22. Transaction + Domain Events

Domain event sering dipakai untuk melepas coupling.

Namun ada dua tipe event:

```text
in-process domain event
integration event
```

### 22.1 In-Process Domain Event

Berjalan di proses yang sama.

Contoh:

```java
record CaseApprovedDomainEvent(CaseId caseId) {}
```

Bisa dipakai untuk:

- update read model lokal
- append local audit
- trigger local handler

### 22.2 Integration Event

Keluar dari service/process.

Contoh:

```json
{
  "eventType": "CaseApproved",
  "caseId": "CASE-001",
  "occurredAt": "2026-06-21T10:15:30Z"
}
```

Harus diperlakukan sebagai external contract.

Guideline:

```text
Jangan langsung samakan domain event dengan message broker event.
Domain event boleh in-memory.
Integration event butuh durability, idempotency, schema, versioning, replay strategy.
```

---

## 23. Multiple Transaction Managers

Aplikasi enterprise sering punya:

- primary OLTP database
- audit database
- reporting database
- tenant database
- message transaction manager
- batch metadata database

Contoh konfigurasi:

```java
@Bean
PlatformTransactionManager caseTransactionManager(DataSource caseDataSource) {
    return new DataSourceTransactionManager(caseDataSource);
}

@Bean
PlatformTransactionManager auditTransactionManager(DataSource auditDataSource) {
    return new DataSourceTransactionManager(auditDataSource);
}
```

Service:

```java
@Transactional(transactionManager = "caseTransactionManager")
public void updateCase(...) { ... }

@Transactional(transactionManager = "auditTransactionManager")
public void writeAudit(...) { ... }
```

Masalah umum:

```text
Developer mengira satu @Transactional mencakup semua database.
```

Tidak otomatis.

Jika method menulis ke dua datasource dengan satu local transaction manager, hanya satu resource yang benar-benar dikendalikan transaction manager tersebut.

Untuk atomicity lintas resource, opsi:

1. JTA/XA transaction.
2. Outbox/saga/compensation.
3. Redesign agar invariant tidak membutuhkan atomic distributed transaction.

Dalam banyak sistem modern, pilihan 2/3 lebih umum daripada XA karena operational complexity.

---

## 24. Transaction Boundary di Layered Architecture

Pertanyaan:

```text
@Transactional sebaiknya diletakkan di controller, service, repository, atau domain object?
```

Guideline umum:

```text
Letakkan transaction boundary di application service/use case layer.
```

Contoh:

```java
@RestController
class CaseController {
    private final CaseApprovalUseCase useCase;

    @PostMapping("/cases/{id}/approve")
    void approve(@PathVariable Long id) {
        useCase.approve(new CaseId(id));
    }
}

@Service
class CaseApprovalUseCase {

    @Transactional
    public void approve(CaseId id) {
        CaseFile caseFile = caseRepository.getRequired(id);
        caseFile.approve();
        caseRepository.save(caseFile);
    }
}
```

Kenapa bukan controller?

- controller adalah transport boundary
- transaction menjadi terlalu luas
- serialization/error handling bisa ikut dalam transaksi
- external calls dari request handling bisa terjebak dalam transaksi

Kenapa bukan repository?

- repository terlalu granular
- satu use case sering perlu beberapa repository update atomic
- transaction boundary tersebar dan sulit dipahami

Kenapa bukan domain entity?

- entity sebaiknya tidak tahu infrastructure transaction
- domain model tidak bergantung Spring

---

## 25. Long Transaction Anti-Pattern

Contoh buruk:

```java
@Transactional
public void processLargeUpload(MultipartFile file) {
    List<Row> rows = parser.parse(file);       // lama
    externalClient.validate(rows);             // lama
    for (Row row : rows) {
        repository.insert(row);                // DB work
    }
    emailClient.notifyUploader();              // external side effect
}
```

Masalah:

- connection ditahan terlalu lama
- lock ditahan terlalu lama
- rollback mahal
- memory besar
- timeout mismatch
- side effect campur

Lebih baik:

```text
1. parse file di luar transaksi
2. validate format di luar transaksi
3. simpan batch dalam chunk transaction
4. catat outbox event
5. kirim notification setelah commit via worker/event
```

Contoh:

```java
public void processLargeUpload(MultipartFile file) {
    ParsedFile parsed = parser.parse(file);

    for (List<Row> chunk : chunks(parsed.rows(), 500)) {
        transactionTemplate.executeWithoutResult(status -> {
            importer.importChunk(chunk);
        });
    }

    outboxPublisher.requestUploadCompletedNotification(parsed.uploadId());
}
```

---

## 26. Transaction Boundary untuk Case Management / Workflow

Untuk sistem regulatory/case management, transaction boundary harus mengikuti invariant.

Contoh use case:

```text
Approve case
```

Invariant:

1. Case status berubah dari `UNDER_REVIEW` ke `APPROVED`.
2. Approval decision tercatat.
3. Case history bertambah.
4. Pending task officer ditutup.
5. Next task dibuat.
6. Audit trail internal tercatat.
7. Integration event dikirim setelah commit.

Boundary yang baik:

```java
@Transactional
public ApprovalResult approveCase(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.getRequired(command.caseId());

    caseFile.approve(command.officerId(), command.reason());

    caseRepository.save(caseFile);
    taskRepository.closeApprovalTask(command.caseId(), command.officerId());
    taskRepository.createPostApprovalTask(command.caseId());
    caseHistoryRepository.append(...);
    outboxRepository.insert(CaseApprovedIntegrationEvent.from(caseFile));

    return ApprovalResult.approved(command.caseId());
}
```

Yang **tidak** masuk transaksi utama:

- email notification
- webhook call
- PDF generation berat
- external registry update
- search index update jika bisa eventual
- analytics/reporting projection

Itu diproses via outbox/event/worker.

Mental model:

```text
Transaction boundary harus melindungi state invariant internal.
External visibility dipisahkan melalui durable event/outbox.
```

---

## 27. Transaction Boundary dan State Machine

Dalam sistem state machine, transaksi harus melindungi transition.

Contoh:

```text
Current state: PENDING_REVIEW
Event: APPROVE
Next state: APPROVED
```

Dalam satu transaction:

1. Lock/load aggregate.
2. Verify current state.
3. Verify actor authorization snapshot jika diperlukan.
4. Apply transition.
5. Persist new state/version.
6. Append transition history.
7. Create side effect intent/outbox.

Contoh:

```java
@Transactional
public void transition(CaseTransitionCommand command) {
    CaseFile caseFile = caseRepository.getForUpdate(command.caseId());

    CaseTransition transition = stateMachine.resolve(
        caseFile.status(),
        command.action(),
        command.actor()
    );

    caseFile.apply(transition);
    caseRepository.save(caseFile);

    transitionHistoryRepository.append(transition.toHistoryRecord());
    outboxRepository.insert(transition.toIntegrationEvent());
}
```

Failure model:

| Failure | Guardrail |
|---|---|
| double approval | optimistic lock / row lock / unique transition guard |
| stale UI action | version check |
| unauthorized transition | authorization before mutation + audit denied attempt if required |
| external event sent before rollback | outbox after DB mutation in same transaction |
| history missing | append history in same transaction as state change |

---

## 28. Optimistic Locking and Transaction Boundary

`@Transactional` saja tidak mencegah lost update.

Contoh:

```text
Request A reads case version 5
Request B reads case version 5
A approves -> version 6
B rejects -> overwrites -> version 6/7 depending implementation
```

Solusi:

- optimistic locking with version column
- compare-and-set update
- pessimistic lock for hot transition
- unique constraint for invariant
- idempotency key for duplicate command

Dalam Spring service:

```java
@Transactional
public void approve(ApproveCommand command) {
    CaseFile caseFile = caseRepository.getRequired(command.caseId());

    if (!caseFile.version().equals(command.expectedVersion())) {
        throw new StaleCaseVersionException(command.caseId());
    }

    caseFile.approve(command.actorId());
    caseRepository.save(caseFile);
}
```

Jika memakai JPA `@Version`, exception biasanya muncul saat flush/commit.

Guideline:

```text
Concurrency invariant harus dimodelkan eksplisit.
@Transactional hanya menyediakan atomic boundary, bukan business conflict resolution.
```

---

## 29. Flush Timing

Dalam JPA integration, perubahan tidak selalu langsung dikirim ke database saat method repository dipanggil. Bisa terjadi saat:

- flush eksplisit
- query tertentu memicu flush
- transaction commit

Contoh:

```java
@Transactional
public void submit(CaseId id) {
    CaseFile caseFile = repository.getRequired(id);
    caseFile.submit();

    externalClient.notifySubmitted(id); // DB mungkin belum flush/commit
}
```

Masalah:

External system bisa mencoba membaca state yang belum commit.

Guideline:

```text
Jangan mengandalkan flush sebagai commit.
Commit baru terjadi ketika transaction manager commit.
```

Jika perlu database constraint divalidasi sebelum lanjut, bisa flush eksplisit, tetapi jangan gunakan flush untuk membenarkan external side effect dalam transaksi.

---

## 30. Exception Translation

Spring menyediakan persistence exception translation.

Repository dengan `@Repository` bisa menerjemahkan exception provider-specific menjadi hierarchy Spring `DataAccessException`.

Contoh:

```java
@Repository
public class JdbcCaseRepository {
    // SQLException bisa diterjemahkan menjadi DataAccessException
}
```

Manfaat:

- exception lebih konsisten lintas provider
- caller tidak perlu tahu SQLException/HibernateException detail
- rollback rule default tetap bekerja karena `DataAccessException` adalah runtime exception

Namun jangan campur terlalu kasar:

```text
Tidak semua DataAccessException harus diperlakukan sama secara bisnis.
```

Misalnya:

- duplicate key mungkin berarti idempotent duplicate command
- deadlock mungkin retryable
- connection failure mungkin infrastructure outage
- data integrity violation mungkin bug atau validation gap

Buat mapping di application boundary:

```java
catch (DuplicateKeyException ex) {
    throw new DuplicateSubmissionException(command.idempotencyKey(), ex);
}
```

---

## 31. Testing Transaction Semantics

Testing `@Transactional` punya jebakan.

### 31.1 Transactional Test Rollback

Spring test sering menjalankan test dalam transaksi yang rollback setelah test.

Contoh:

```java
@SpringBootTest
@Transactional
class CaseApprovalTest {

    @Test
    void approveCase() {
        service.approve(caseId);
        // test sees data inside same transaction
    }
}
```

Masalah:

- test bisa melihat data yang belum commit
- after-commit listener mungkin tidak jalan
- constraint yang muncul saat commit bisa tidak terlihat sampai test selesai
- behavior production berbeda

Untuk menguji after-commit:

```java
@SpringBootTest
class CaseApprovalCommitTest {

    @Autowired CaseApprovalService service;
    @Autowired TestTransactionHelper tx;

    @Test
    void publishesEventAfterCommit() {
        service.approve(caseId);
        // verify after-commit side effect melalui outbox row atau listener test harness
    }
}
```

Atau gunakan `TestTransaction` jika memakai Spring Test transaction.

### 31.2 Test Self-Invocation

Jika test langsung memanggil method pada instance target yang bukan proxy, behavior bisa salah.

Pastikan inject bean dari context:

```java
@Autowired
CaseService caseService;
```

bukan:

```java
CaseService caseService = new CaseService(...);
```

untuk test proxy behavior.

### 31.3 Test Propagation

Untuk `REQUIRES_NEW`, test harus memverifikasi commit independen.

Contoh scenario:

1. Outer transaction melakukan update lalu gagal.
2. Inner audit `REQUIRES_NEW` tetap commit.
3. Assert audit row exists, main update rollback.

---

## 32. Common Failure Model

### 32.1 `@Transactional` Tidak Aktif

Penyebab:

- method dipanggil self-invocation
- bean bukan Spring-managed
- method tidak cocok proxy model
- annotation di interface/implementation tidak sesuai setup
- class final/method final pada proxy tertentu
- transaction management tidak aktif/config salah

Diagnosis:

```java
TransactionSynchronizationManager.isActualTransactionActive()
```

Gunakan hanya untuk diagnosis/test, bukan business logic normal.

### 32.2 Rollback Tidak Terjadi

Penyebab:

- checked exception tidak masuk rollback rule
- exception ditangkap dan tidak dilempar ulang
- `noRollbackFor`
- exception terjadi setelah commit
- transaksi tidak aktif

### 32.3 UnexpectedRollbackException

Penyebab umum:

- inner logical transaction menandai rollback-only
- outer scope tidak tahu lalu mencoba commit

Solusi:

- jangan swallow exception inner
- pisahkan `REQUIRES_NEW` jika benar-benar butuh independen
- desain flow result/error lebih jelas

### 32.4 Connection Pool Habis

Penyebab:

- long transaction
- nested `REQUIRES_NEW` butuh connection tambahan
- transaction menunggu external API
- batch besar tanpa chunking
- leak/slow query

### 32.5 Event Terkirim Saat Rollback

Penyebab:

- listener biasa `@EventListener`, bukan `@TransactionalEventListener(AFTER_COMMIT)`
- message dikirim langsung dalam transaksi
- async dipanggil sebelum commit

Solusi:

- after-commit listener untuk best-effort local side effect
- outbox untuk reliable external side effect

### 32.6 Data Stale Setelah Commit

Penyebab:

- cache tidak diinvalidasi after commit
- read replica lag
- async projection eventual consistency
- transaction isolation expectation salah

---

## 33. Design Heuristics untuk Top-Tier Spring Transaction Engineering

Gunakan checklist berikut.

### 33.1 Boundary

```text
Apakah transaction boundary berada di application service/use case layer?
Apakah boundary cukup kecil?
Apakah boundary mencakup semua invariant internal yang harus atomic?
Apakah boundary tidak mencakup external API lambat?
```

### 33.2 Propagation

```text
Apakah default REQUIRED cukup?
Apakah REQUIRES_NEW benar-benar diperlukan?
Apakah NESTED didukung transaction manager?
Apakah MANDATORY bisa digunakan sebagai guardrail internal?
```

### 33.3 Rollback

```text
Exception mana yang harus rollback?
Exception mana yang boleh commit?
Apakah checked exception dipakai dengan sadar?
Apakah exception ditangkap tanpa set rollback-only?
```

### 33.4 Side Effect

```text
Apakah email/webhook/message dikirim sebelum commit?
Apakah external side effect punya idempotency key?
Apakah outbox diperlukan?
Apakah listener after-commit cukup atau butuh durable worker?
```

### 33.5 Concurrency

```text
Apakah @Transactional cukup untuk invariant ini?
Apakah butuh optimistic lock?
Apakah butuh unique constraint?
Apakah duplicate command aman?
Apakah retry bisa double write?
```

### 33.6 Observability

```text
Apakah transaction timeout terlihat?
Apakah deadlock/retry tercatat?
Apakah long transaction bisa didiagnosis?
Apakah outbox lag dimonitor?
Apakah rollback reason terlihat di log/metric?
```

---

## 34. Transaction Boundary Patterns

### 34.1 Single Use Case Transaction

```java
@Transactional
public void completeTask(CompleteTaskCommand command) {
    Task task = taskRepository.getRequired(command.taskId());
    task.complete(command.actorId());

    caseRepository.applyTaskCompletion(task.caseId(), task.result());
    historyRepository.append(TaskCompletedHistory.from(task));
    outboxRepository.insert(TaskCompletedEvent.from(task));
}
```

Cocok untuk invariant internal.

### 34.2 Transaction + Outbox

```java
@Transactional
public void approve(CaseId id) {
    caseRepository.approve(id);
    outboxRepository.insert(CaseApprovedEvent.of(id));
}
```

Cocok untuk event external reliable.

### 34.3 Programmatic Short Transaction

```java
public void process(Input input) {
    PrecomputedData data = expensivePreparation(input);

    transactionTemplate.executeWithoutResult(status -> {
        repository.persist(data);
    });

    notifyOutsideTransaction(data.id());
}
```

Cocok untuk menghindari long transaction.

### 34.4 Mandatory Internal Component

```java
@Transactional(propagation = Propagation.MANDATORY)
public void appendHistory(CaseHistory history) {
    historyRepository.insert(history);
}
```

Cocok agar component tidak dipakai di luar use case transaction.

### 34.5 Requires New Audit Attempt

```java
@Transactional(propagation = Propagation.REQUIRES_NEW)
public void recordApprovalAttempt(ApprovalAttempt attempt) {
    auditRepository.insert(attempt);
}
```

Cocok jika audit attempt harus bertahan walau use case gagal.

Tetapi audit data harus dirancang agar tidak mengklaim main action sukses jika main transaction rollback.

---

## 35. Anti-Pattern yang Harus Dihindari

### Anti-Pattern 1 — Transaction di Semua Method

```java
@Transactional
public void helper1() { ... }

@Transactional
public void helper2() { ... }

@Transactional
public void helper3() { ... }
```

Tanpa boundary thinking, ini hanya menyebar magic.

Lebih baik:

```text
Tentukan use case boundary.
Helper ikut boundary tersebut atau diberi MANDATORY jika perlu guardrail.
```

### Anti-Pattern 2 — External API dalam Transaction

```java
@Transactional
public void approve() {
    repository.approve();
    externalApi.call();
}
```

Lebih baik outbox/event after commit.

### Anti-Pattern 3 — REQUIRES_NEW sebagai Obat Semua Masalah

`REQUIRES_NEW` sering dipakai untuk “memaksa commit”. Itu berbahaya.

Tanyakan:

```text
Apakah data inner transaction masih valid jika outer rollback?
Apakah pool cukup?
Apakah referential integrity aman?
Apakah audit semantics jelas?
```

### Anti-Pattern 4 — Catch Exception lalu Commit Tanpa Sadar

```java
@Transactional
public void process() {
    try {
        risky();
    } catch (Exception e) {
        log.warn("ignored", e);
    }
}
```

Kalau risky failure harus menggagalkan state, jangan swallow.

### Anti-Pattern 5 — Mengira `readOnly=true` adalah Security Boundary

Read-only bukan pengganti authorization atau database permission.

### Anti-Pattern 6 — Mengira Transaction Mengalir ke Async Thread

Thread-bound transaction tidak otomatis pindah ke thread lain.

### Anti-Pattern 7 — Mengandalkan Transaction untuk Distributed Consistency

Local DB transaction tidak otomatis membuat consistency ke Kafka, email, HTTP API, Redis, search index, atau database lain.

---

## 36. Java 8 sampai Java 25 Considerations

### Java 8–11 Legacy Spring

Umumnya:

- Spring Framework 5.x
- Spring Boot 2.x
- `javax.*`
- proxy behavior lama lebih banyak public-method oriented
- virtual thread tidak ada
- transaction context strongly thread-bound platform thread

Guideline:

```text
Gunakan public service method boundary.
Hindari trik visibility/proxy yang hanya aman di versi baru.
```

### Java 17–21 Modern Spring

Umumnya:

- Spring Framework 6.x
- Spring Boot 3.x
- `jakarta.*`
- observability lebih matang
- virtual thread support mulai relevan di Java 21

Guideline:

```text
Perhatikan interaction ThreadLocal dengan virtual thread, executor, MDC, security context, dan transaction context.
```

### Java 25 / Spring 7 / Boot 4 Era

Fokus modern:

- Java 17 minimum di Boot 4, Java 25 support
- Framework 7 generation
- API/versioning/HTTP client improvements
- stronger null-safety direction
- Jakarta EE 11 alignment

Namun prinsip transaction tetap:

```text
Proxy boundary tetap penting.
Resource transaction tetap harus eksplisit.
External side effect tetap tidak otomatis atomic.
Thread/context boundary tetap harus dipahami.
```

---

## 37. Practical Diagnostic Playbook

### Problem: `@Transactional` Tidak Jalan

Cek:

1. Apakah class Spring bean?
2. Apakah caller memanggil proxy?
3. Apakah self-invocation?
4. Apakah method visibility cocok?
5. Apakah final class/method?
6. Apakah transaction manager tersedia?
7. Apakah multiple transaction manager ambiguity?
8. Apakah test membuat object manual?

Tambahkan sementara:

```java
log.info("tx active: {}", TransactionSynchronizationManager.isActualTransactionActive());
```

### Problem: Rollback Tidak Terjadi

Cek:

1. Exception runtime atau checked?
2. Ada `rollbackFor`?
3. Exception ditangkap?
4. Exception terjadi di async thread?
5. Exception terjadi after commit?
6. Transaction benar-benar aktif?

### Problem: Event Terkirim Walau Rollback

Cek:

1. Pakai `@EventListener` biasa?
2. Publish ke broker langsung?
3. Async dipanggil sebelum commit?
4. Perlu `@TransactionalEventListener(AFTER_COMMIT)` atau outbox?

### Problem: Deadlock/Pool Exhaustion

Cek:

1. Long transaction?
2. External API dalam transaction?
3. `REQUIRES_NEW` nested banyak?
4. Pool size cukup?
5. Query lambat?
6. Lock order tidak konsisten?

---

## 38. Mini Case Study: Approval Workflow yang Salah dan Diperbaiki

### 38.1 Versi Salah

```java
@Service
public class ApprovalService {

    @Transactional
    public void approve(Long caseId) {
        CaseFile caseFile = caseRepository.findById(caseId).orElseThrow();
        caseFile.setStatus("APPROVED");
        caseRepository.save(caseFile);

        auditClient.sendAudit(caseId, "APPROVED");
        emailClient.sendApprovedEmail(caseFile.getApplicantEmail());
        searchClient.reindex(caseId);
    }
}
```

Masalah:

- external calls di dalam transaction
- email bisa terkirim walau commit gagal
- audit external bisa sukses walau DB rollback
- transaction lama karena HTTP calls
- no idempotency
- search index update tidak reliable
- string status raw
- no transition history atomic

### 38.2 Versi Lebih Baik

```java
@Service
public class ApprovalUseCase {

    private final CaseRepository caseRepository;
    private final CaseHistoryRepository historyRepository;
    private final OutboxRepository outboxRepository;

    @Transactional
    public void approve(ApproveCaseCommand command) {
        CaseFile caseFile = caseRepository.getRequired(command.caseId());

        caseFile.approve(command.actorId(), command.reason());

        caseRepository.save(caseFile);
        historyRepository.append(CaseHistory.approved(caseFile, command.actorId()));
        outboxRepository.insert(OutboxMessage.caseApproved(caseFile.id()));
    }
}
```

Worker:

```java
@Component
public class OutboxPublisher {

    @Scheduled(fixedDelayString = "${outbox.publisher.delay:1000}")
    public void publish() {
        List<OutboxMessage> batch = outboxRepository.lockNextBatch(100);

        for (OutboxMessage message : batch) {
            try {
                publishMessage(message);
                outboxRepository.markPublished(message.id());
            } catch (Exception ex) {
                outboxRepository.markFailedAttempt(message.id(), ex.getMessage());
            }
        }
    }
}
```

Improvements:

- internal invariant atomic
- external side effect durable
- retryable outbox
- transaction lebih pendek
- failure bisa direconcile
- audit/history lokal tidak hilang
- event publication tidak mendahului commit

---

## 39. Ringkasan Mental Model

Jika harus diringkas:

```text
1. @Transactional adalah metadata untuk interceptor, bukan sihir di method.
2. Proxy boundary menentukan apakah transaksi aktif.
3. Transaction manager mengontrol resource transaction.
4. TransactionSynchronizationManager mengikat resource ke thread.
5. Propagation mengatur hubungan logical scope dan physical transaction.
6. Rollback default hanya RuntimeException dan Error.
7. Checked exception perlu rollback rule jika harus rollback.
8. readOnly adalah intent/hint, bukan security guarantee universal.
9. Async thread tidak otomatis membawa transaksi.
10. External side effect tidak otomatis rollback bersama database.
11. REQUIRES_NEW bukan solusi umum; ia punya cost dan semantic risk.
12. Outbox adalah pattern utama untuk reliable external publication after DB commit.
13. Transaction boundary sebaiknya berada di application use case layer.
14. Transaction melindungi atomicity internal, bukan seluruh distributed system.
```

Top-tier Spring engineer tidak hanya bertanya:

```text
“Harus taruh @Transactional di mana?”
```

Tetapi bertanya:

```text
“Invariant apa yang harus atomic?”
“Resource apa yang ikut transaksi?”
“Side effect mana yang tidak bisa rollback?”
“Thread/context boundary-nya di mana?”
“Rollback rule-nya sesuai failure taxonomy atau tidak?”
“Apakah propagation ini mencerminkan business semantics?”
“Bagaimana operasi ini diretry, diaudit, dan direconcile?”
```

---

## 40. Latihan Mandiri

### Latihan 1 — Self-Invocation

Buat service:

```java
@Service
public class DemoService {
    public void outer() {
        inner();
    }

    @Transactional
    public void inner() {
        System.out.println(TransactionSynchronizationManager.isActualTransactionActive());
    }
}
```

Panggil `outer()`. Amati apakah transaksi aktif.

Lalu pindahkan `inner()` ke bean lain dan panggil lagi.

### Latihan 2 — Checked Exception Rollback

Buat checked exception:

```java
class BusinessCheckedException extends Exception {}
```

Buat method transactional yang insert row lalu throw checked exception.

Bandingkan:

```java
@Transactional
```

vs

```java
@Transactional(rollbackFor = BusinessCheckedException.class)
```

### Latihan 3 — REQUIRES_NEW Audit

Buat outer service yang rollback, dan inner audit service `REQUIRES_NEW`.

Verifikasi:

- data utama rollback
- audit tetap commit

Diskusikan apakah audit tersebut secara business benar.

### Latihan 4 — After Commit Event

Publish event dari dalam transaction.

Bandingkan listener:

```java
@EventListener
```

vs

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
```

Paksa rollback dan lihat listener mana yang jalan.

### Latihan 5 — External Side Effect Design

Ambil use case:

```text
submit application -> update DB -> send email -> publish Kafka event -> reindex search
```

Desain ulang dengan:

- transaction boundary
- outbox table
- idempotency key
- retry policy
- failure reconciliation

---

## 41. Checklist Review PR untuk Transaction

Gunakan checklist ini ketika review PR Spring:

```text
[ ] Transaction boundary ada di application service/use case layer.
[ ] Tidak ada external HTTP/email/message send langsung di dalam transaksi kecuali disengaja dan dijelaskan.
[ ] Propagation selain REQUIRED punya alasan tertulis.
[ ] REQUIRES_NEW tidak dipakai untuk menyembunyikan desain yang salah.
[ ] Checked exception rollback rule jelas.
[ ] Exception tidak ditangkap lalu commit tanpa sadar.
[ ] Async tidak diasumsikan membawa transaksi.
[ ] Event external dikirim after commit atau via outbox.
[ ] Cache invalidation mempertimbangkan commit/rollback.
[ ] Operation idempotent jika ada retry.
[ ] Long transaction dihindari.
[ ] Batch besar di-chunk.
[ ] Multiple transaction manager dipilih eksplisit.
[ ] Concurrency invariant punya lock/version/constraint.
[ ] Test mencakup commit/rollback behavior, bukan hanya happy path.
```

---

## 42. Referensi Resmi

- Spring Framework Reference — Transaction Management: https://docs.spring.io/spring-framework/reference/data-access/transaction.html
- Spring Framework Reference — Declarative Transaction Management: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative.html
- Spring Framework Reference — Transaction Propagation: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html
- Spring Framework Reference — Using `@Transactional`: https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html
- Spring Javadoc — `TransactionSynchronizationManager`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/support/TransactionSynchronizationManager.html
- Spring Javadoc — `TransactionSynchronization`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/support/TransactionSynchronization.html

---

## 43. Penutup

Part ini adalah salah satu bagian paling penting dalam seri Spring advanced.

Jika IoC container adalah cara Spring membangun object graph, dan AOP proxy adalah cara Spring menyisipkan behavior lintas-cutting, maka transaction management adalah contoh paling nyata bagaimana Spring mengubah method call biasa menjadi runtime boundary yang berdampak pada consistency sistem.

Setelah memahami part ini, `@Transactional` tidak lagi dilihat sebagai annotation sederhana, tetapi sebagai kontrak:

```text
method ini adalah boundary atomicity internal,
dengan propagation tertentu,
rollback semantics tertentu,
resource tertentu,
thread/context tertentu,
dan side effect yang harus dikendalikan secara sadar.
```

Part berikutnya akan membahas:

```text
11 — Spring Data Integration Model Without Repeating JPA
```

Di sana fokusnya bukan mengulang JPA/Hibernate, tetapi memahami bagaimana Spring Data membangun repository proxy, query method, repository factory, fragment, auditing, exception translation, dan integration boundary lintas datastore.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./09-spring-aop-proxy-method-interception.md">⬅️ Spring AOP, Proxy Model, and Method Interception</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./11-spring-data-integration-model.md">Part 11 — Spring Data Integration Model Without Repeating JPA ➡️</a>
</div>
