# Part 025 — Spring Transaction + JPA Integration Deep Dive

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Target: Java 8 hingga Java 25, `javax.persistence` hingga `jakarta.persistence`, Spring Framework/Spring Boot modern, Hibernate ORM 5/6/7  
> Fokus: memahami bagaimana Spring mengikat transaction boundary, `EntityManager`, persistence context, JDBC connection, Hibernate `Session`, dan database transaction dalam aplikasi nyata.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan hubungan antara Spring `@Transactional`, JPA `EntityManager`, Hibernate `Session`, JDBC `Connection`, dan database transaction.
2. Membedakan Spring `@Transactional` dengan `jakarta.transaction.Transactional`.
3. Memahami bagaimana Spring menaruh `EntityManager` dan transaction context pada thread selama eksekusi method.
4. Memilih `JpaTransactionManager`, `DataSourceTransactionManager`, atau JTA transaction manager dengan benar.
5. Mendesain transaction boundary yang aman untuk service layer, repository, batch, scheduler, event listener, dan message consumer.
6. Menghindari jebakan umum seperti self-invocation, wrong proxy boundary, lazy loading leak, rollback rule salah, dan transaction terlalu panjang.
7. Memahami propagation mode Spring secara praktis, bukan sekadar definisi enum.
8. Memahami realita `readOnly=true`, flush mode, dirty checking, connection acquisition, dan persistence context lifecycle.
9. Menganalisis failure mode produksi: connection pool exhaustion, rollback-only, unexpected rollback, stale data, deadlock retry, async boundary, dan nested transaction illusion.
10. Membuat checklist desain transaction untuk aplikasi enterprise yang kompleks.

---

## 2. Mental Model Besar

Spring Transaction + JPA sering terlihat sederhana:

```java
@Transactional
public void approve(Long caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    c.approve();
}
```

Tapi di balik kode itu ada banyak lapisan:

```text
Application Method
  ↓
Spring AOP Proxy
  ↓
TransactionInterceptor
  ↓
PlatformTransactionManager
  ↓
JpaTransactionManager
  ↓
EntityManager bound to current thread
  ↓
Hibernate Session / Persistence Context
  ↓
JDBC Connection
  ↓
Database Transaction
```

Yang perlu dipahami: **Spring tidak membuat transaksi sebagai magic annotation**. Spring membuat transaction boundary dengan cara:

1. mencegat method call lewat proxy/AOP,
2. membuka atau mengikuti transaction yang sudah ada,
3. mengikat resource ke current thread,
4. membiarkan repository/entity manager memakai resource yang sama,
5. melakukan commit atau rollback saat method keluar,
6. membersihkan thread-bound resource setelah selesai.

Jadi `@Transactional` bukan “fitur JPA”. Ia adalah instruksi ke Spring transaction infrastructure.

---

## 3. Komponen Utama dalam Spring Transaction + JPA

### 3.1 `@Transactional`

`@Transactional` mendefinisikan semantic transaction pada method/class:

```java
@Transactional(
    propagation = Propagation.REQUIRED,
    isolation = Isolation.READ_COMMITTED,
    timeout = 30,
    readOnly = false,
    rollbackFor = BusinessException.class
)
public void submitApplication(SubmitApplicationCommand command) {
    // business operation
}
```

Annotation ini tidak langsung membuka database transaction. Annotation ini dibaca oleh Spring AOP infrastructure, lalu diterjemahkan menjadi operasi pada `PlatformTransactionManager`.

### 3.2 `PlatformTransactionManager`

Spring menyediakan abstraction:

```java
public interface PlatformTransactionManager {
    TransactionStatus getTransaction(TransactionDefinition definition);
    void commit(TransactionStatus status);
    void rollback(TransactionStatus status);
}
```

Konsepnya sederhana:

```text
before method:
  getTransaction()

method executes:
  business logic

after method success:
  commit()

after method failure requiring rollback:
  rollback()
```

Implementasi berbeda tergantung resource:

| Transaction manager | Cocok untuk | Catatan |
|---|---|---|
| `JpaTransactionManager` | JPA/Hibernate dengan satu `EntityManagerFactory` | Pilihan umum untuk Spring Boot + Spring Data JPA |
| `DataSourceTransactionManager` | JDBC langsung dengan satu `DataSource` | Cocok untuk plain JDBC/MyBatis/jOOQ tanpa JPA |
| `JtaTransactionManager` | distributed/global transaction/JTA | Cocok jika butuh koordinasi beberapa XA resource |
| `R2dbcTransactionManager` | reactive relational access | Bukan untuk JPA karena JPA blocking/thread-bound |

### 3.3 `JpaTransactionManager`

`JpaTransactionManager` adalah transaction manager Spring untuk JPA.

Tugas utamanya:

1. mendapatkan atau membuat `EntityManager`,
2. mengikat `EntityManager` ke current thread,
3. memulai JPA transaction,
4. mengkoordinasikan flush/commit/rollback,
5. membersihkan `EntityManager` setelah transaction selesai.

Secara mental:

```text
@Transactional method starts
  ↓
JpaTransactionManager opens EntityManager if none exists
  ↓
EntityManager is bound to current thread
  ↓
Repository gets the same EntityManager
  ↓
Hibernate persistence context tracks managed entities
  ↓
Commit triggers flush then database commit
  ↓
EntityManager unbound/closed
```

### 3.4 `EntityManager`

Dalam JPA/Jakarta Persistence, `EntityManager` mengelola persistence context, yaitu kumpulan entity instance yang sedang managed.

Persistence context menyediakan:

- identity map,
- dirty checking,
- lazy loading boundary,
- cascade operation,
- write-behind,
- first-level cache,
- unit of work.

Dalam Spring, `EntityManager` yang diinjeksi biasanya bukan raw entity manager biasa, tetapi proxy yang mengambil actual transaction-bound `EntityManager` dari current thread.

Contoh:

```java
@Repository
public class CaseJpaRepository {

    @PersistenceContext
    private EntityManager em;

    public Case find(Long id) {
        return em.find(Case.class, id);
    }
}
```

`em` di atas tampak seperti field biasa, tapi biasanya ia adalah proxy. Saat dipakai di dalam transaction, proxy itu mengarahkan call ke `EntityManager` yang terikat pada transaction aktif.

### 3.5 Hibernate `Session`

Dalam Hibernate, JPA `EntityManager` biasanya membungkus Hibernate `Session`.

```java
Session session = entityManager.unwrap(Session.class);
```

`Session` adalah Hibernate-native unit of work. Ia juga punya persistence context. Untuk aplikasi yang memakai JPA, sebaiknya gunakan API JPA dulu, lalu unwrap hanya jika benar-benar butuh fitur Hibernate-specific seperti:

- batch setting tertentu,
- stateless session,
- custom type,
- filter,
- fetch profile,
- natural id access,
- Hibernate-specific query hint.

### 3.6 JDBC `Connection`

Pada akhirnya, semua operasi JPA/Hibernate akan memakai JDBC `Connection`.

```text
EntityManager
  ↓
Hibernate Session
  ↓
JDBC Connection
  ↓
Database transaction
```

Spring transaction manager memastikan bahwa selama satu transaction, operasi JPA/JDBC yang kompatibel dapat menggunakan connection yang konsisten.

Namun detailnya penting:

- connection bisa diperoleh lazy, bukan selalu langsung saat method mulai,
- connection diambil dari pool,
- connection dikembalikan saat transaction selesai,
- long transaction berarti connection bisa tertahan lama,
- external call dalam transaction bisa membuat connection pool habis.

---

## 4. Spring `@Transactional` vs Jakarta `@Transactional`

Ada dua annotation yang sering membingungkan:

```java
org.springframework.transaction.annotation.Transactional
```

versus:

```java
jakarta.transaction.Transactional
```

### 4.1 Spring `@Transactional`

Spring annotation memiliki fitur yang sangat kaya:

```java
@Transactional(
    propagation = Propagation.REQUIRES_NEW,
    isolation = Isolation.READ_COMMITTED,
    timeout = 10,
    readOnly = true,
    rollbackFor = CheckedBusinessException.class,
    noRollbackFor = NonCriticalException.class
)
```

Fitur umum:

- propagation,
- isolation,
- timeout,
- read-only,
- rollback rules,
- transaction manager qualifier,
- label/metadata pada versi Spring modern.

### 4.2 Jakarta `@Transactional`

Jakarta Transactions annotation lebih standard Jakarta EE style:

```java
@jakarta.transaction.Transactional
public void doWork() {
}
```

Ia memakai konsep `TxType`, misalnya:

- `REQUIRED`,
- `REQUIRES_NEW`,
- `MANDATORY`,
- `SUPPORTS`,
- `NOT_SUPPORTED`,
- `NEVER`.

Rollback rules-nya memakai:

```java
@jakarta.transaction.Transactional(
    rollbackOn = BusinessException.class,
    dontRollbackOn = NonCriticalException.class
)
```

### 4.3 Kapan memakai yang mana?

Untuk aplikasi Spring/Spring Boot, default praktisnya:

```java
org.springframework.transaction.annotation.Transactional
```

Alasannya:

- integrasi penuh dengan Spring transaction abstraction,
- opsi lebih lengkap,
- dokumentasi Spring biasanya memakai annotation ini,
- lebih eksplisit untuk propagation/isolation/timeout/readOnly.

Untuk aplikasi Jakarta EE/CDI penuh tanpa Spring, gunakan:

```java
jakarta.transaction.Transactional
```

Untuk code library shared, pertimbangkan dependency policy. Jangan campur secara tidak sadar.

---

## 5. Bagaimana `@Transactional` Bekerja dengan Proxy

Spring biasanya menerapkan transaction melalui proxy.

Contoh bean:

```java
@Service
public class CaseService {

    @Transactional
    public void approve(Long caseId) {
        // transactional
    }
}
```

Saat bean digunakan oleh bean lain:

```java
caseService.approve(10L);
```

Yang dipanggil sebenarnya:

```text
Caller
  ↓
Spring proxy
  ↓
TransactionInterceptor
  ↓
actual CaseService.approve()
```

### 5.1 Implikasi proxy

Transaction hanya aktif jika method call melewati proxy.

Ini bekerja:

```java
@Service
public class CaseControllerService {

    private final CaseService caseService;

    public CaseControllerService(CaseService caseService) {
        this.caseService = caseService;
    }

    public void handle(Long id) {
        caseService.approve(id); // passes through proxy
    }
}
```

Ini sering tidak bekerja sesuai ekspektasi:

```java
@Service
public class CaseService {

    public void handle(Long id) {
        approve(id); // self-invocation, bypass proxy
    }

    @Transactional
    public void approve(Long id) {
        // transaction may not start
    }
}
```

Karena `approve()` dipanggil dari object yang sama, bukan lewat proxy.

### 5.2 Method visibility

Secara umum, letakkan `@Transactional` pada public service method.

Hindari bergantung pada transaksi di:

- private method,
- internal helper method,
- self-invoked method,
- constructor,
- `@PostConstruct`,
- method yang dipanggil sebelum proxy siap.

### 5.3 Interface proxy vs class proxy

Spring bisa memakai:

- JDK dynamic proxy jika bean punya interface,
- CGLIB class-based proxy jika perlu.

Efek desain:

- final class/method bisa bermasalah untuk proxy subclass,
- method internal tetap self-invocation problem,
- annotation di interface vs implementation harus konsisten.

---

## 6. Transaction Lifecycle Step-by-Step

Misalkan ada service:

```java
@Service
public class ApplicationService {

    private final ApplicationRepository repository;

    @Transactional
    public void submit(Long applicationId) {
        Application app = repository.findById(applicationId).orElseThrow();
        app.submit();
    }
}
```

Urutan internal:

```text
1. Caller invokes applicationService.submit(id)
2. Call enters Spring proxy
3. TransactionInterceptor reads @Transactional metadata
4. JpaTransactionManager checks current thread
5. If no transaction exists, create new transaction
6. EntityManager is opened/bound to thread
7. Repository obtains same EntityManager
8. Entity is loaded and becomes managed
9. app.submit() mutates managed entity
10. Dirty checking records state difference
11. Method returns normally
12. Transaction manager triggers flush
13. Hibernate generates SQL UPDATE
14. Database executes SQL inside transaction
15. Commit succeeds
16. EntityManager unbound/closed
17. Connection returned to pool
```

Jika exception terjadi:

```text
1. Exception escapes transactional method
2. TransactionInterceptor evaluates rollback rule
3. Transaction marked rollback-only or rolled back
4. No commit
5. Persistence context discarded
6. Connection returned to pool
7. Exception propagated to caller
```

---

## 7. Propagation Deep Dive

Propagation menjawab pertanyaan:

> Jika method transactional dipanggil saat sudah ada transaction, apa yang harus dilakukan?

### 7.1 `REQUIRED`

Default.

```java
@Transactional(propagation = Propagation.REQUIRED)
public void submit() { }
```

Semantics:

```text
If transaction exists: join it
If no transaction exists: create new one
```

Gunakan untuk mayoritas use case application service.

Contoh:

```java
@Transactional
public void approveCase(Long id) {
    Case c = caseRepository.get(id);
    c.approve();
    auditRepository.record(...);
}
```

Semua operasi menjadi satu atomic unit.

### 7.2 `REQUIRES_NEW`

```java
@Transactional(propagation = Propation.REQUIRES_NEW)
public void writeAudit(...) { }
```

Semantics:

```text
Suspend existing transaction if any
Start a new independent transaction
Commit/rollback independently
Resume old transaction
```

Use case:

- audit teknis yang harus tetap tercatat walau outer transaction rollback,
- retry log,
- job progress checkpoint,
- failure record.

Tapi hati-hati:

```java
@Transactional
public void approve(Long id) {
    caseRepository.approve(id);
    auditService.writeAuditRequiresNew(id); // commits
    throw new RuntimeException();           // outer rollback
}
```

Hasil:

```text
Audit committed
Case approval rolled back
```

Ini bisa benar atau salah tergantung requirement.

Bahaya `REQUIRES_NEW`:

- outer transaction masih memegang connection,
- inner transaction butuh connection baru,
- pool bisa habis jika dipakai berlebihan,
- bisa menyebabkan deadlock jika inner transaction mengakses row yang outer transaction sedang lock,
- consistency bisa membingungkan.

### 7.3 `NESTED`

```java
@Transactional(propagation = Propagation.NESTED)
public void step() { }
```

Semantics:

```text
Use savepoint inside existing transaction if supported
Rollback inner step to savepoint without rolling back whole outer transaction
```

Catatan:

- tidak sama dengan `REQUIRES_NEW`,
- bergantung pada JDBC savepoint support,
- tidak selalu cocok/tersedia untuk semua transaction manager/resource.

Use case terbatas:

- batch step dalam satu transaction besar,
- partial failure handling dengan savepoint.

Dalam banyak sistem enterprise, lebih jelas memakai chunk transaction daripada nested transaction.

### 7.4 `SUPPORTS`

```java
@Transactional(propagation = Propagation.SUPPORTS, readOnly = true)
public CaseView findView(Long id) { }
```

Semantics:

```text
If transaction exists: join it
If no transaction exists: execute non-transactionally
```

Cocok untuk read method yang bisa dipanggil dari transactional atau non-transactional context.

Risiko:

- lazy loading behavior bisa berbeda,
- consistency read bisa berbeda,
- query bisa berjalan auto-commit jika tidak ada transaction.

### 7.5 `NOT_SUPPORTED`

```java
@Transactional(propagation = Propagation.NOT_SUPPORTED)
public void callExternalSystem() { }
```

Semantics:

```text
Suspend existing transaction
Run without transaction
Resume transaction afterward
```

Cocok jika operasi tidak boleh menahan transaction, misalnya:

- call API eksternal,
- generate file besar,
- read-only non-critical operation.

Tapi jika dipakai sembarangan, operasi DB di dalamnya tidak menjadi bagian dari atomic use case.

### 7.6 `MANDATORY`

```java
@Transactional(propagation = Propagation.MANDATORY)
public void appendAudit(AuditEntry entry) { }
```

Semantics:

```text
If transaction exists: join it
If no transaction exists: throw exception
```

Cocok untuk internal method yang harus selalu dipanggil dari transaction boundary yang lebih atas.

### 7.7 `NEVER`

```java
@Transactional(propagation = Propagation.NEVER)
public void expensiveReadOutsideTx() { }
```

Semantics:

```text
If transaction exists: throw exception
If no transaction exists: execute normally
```

Jarang dipakai, tapi berguna untuk guardrail.

---

## 8. Propagation Failure Matrix

| Scenario | Propagation | Hasil | Risiko |
|---|---:|---|---|
| Service A memanggil Service B, keduanya `REQUIRED` | Join same tx | Atomic | B rollback membuat A rollback juga |
| Audit memakai `REQUIRES_NEW` | Independent tx | Audit bisa commit walau outer rollback | Bisa mencatat event yang business state-nya batal |
| Inner `REQUIRED` throw runtime exception tapi ditangkap outer | Same tx | Tx bisa sudah rollback-only | `UnexpectedRollbackException` saat commit |
| Batch item pakai `REQUIRES_NEW` | Per item tx | Partial success mungkin | Pool pressure dan consistency partial |
| Repository pakai `MANDATORY` | Must join tx | Guard boundary | Error jika dipanggil dari read non-tx |
| Query method `SUPPORTS` | Optional tx | Fleksibel | Lazy/consistency behavior tidak stabil |

---

## 9. Rollback Rules

Default Spring behavior:

```text
RuntimeException -> rollback
Error            -> rollback
Checked Exception -> commit unless configured
```

Contoh checked exception:

```java
@Transactional
public void submit() throws BusinessCheckedException {
    repository.save(...);
    throw new BusinessCheckedException();
}
```

Secara default, checked exception tidak menyebabkan rollback pada Spring `@Transactional`.

Jika ingin rollback:

```java
@Transactional(rollbackFor = BusinessCheckedException.class)
public void submit() throws BusinessCheckedException {
    repository.save(...);
    throw new BusinessCheckedException();
}
```

Jika ada runtime exception yang tidak ingin rollback:

```java
@Transactional(noRollbackFor = NonCriticalNotificationException.class)
public void approve() {
    // ...
}
```

Namun hati-hati: `noRollbackFor` sering menutupi desain side-effect yang buruk.

### 9.1 Exception ditangkap di dalam method

Ini tidak rollback:

```java
@Transactional
public void importRows(List<Row> rows) {
    for (Row row : rows) {
        try {
            importOne(row);
        } catch (Exception e) {
            log.warn("failed row", e);
        }
    }
}
```

Jika exception ditangkap dan tidak dilempar keluar, Spring melihat method sukses.

Kalau ingin rollback manual:

```java
TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
```

Tapi gunakan dengan hati-hati. Lebih baik desain transaction chunk jelas.

### 9.2 Rollback-only dan `UnexpectedRollbackException`

Contoh umum:

```java
@Transactional
public void outer() {
    try {
        inner();
    } catch (RuntimeException ignored) {
        // handled?
    }
}

@Transactional
public void inner() {
    throw new RuntimeException();
}
```

Jika `inner()` ikut transaction yang sama dan menandai rollback-only, outer method mungkin selesai normal, tapi saat commit Spring menyadari transaction harus rollback.

Hasil:

```text
UnexpectedRollbackException
```

Mental model:

```text
Catching exception does not always unmark rollback-only transaction.
```

---

## 10. Isolation di Spring Transaction

Spring `@Transactional` bisa menyatakan isolation:

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void approve(Long id) { }
```

Enum umum:

- `DEFAULT`,
- `READ_UNCOMMITTED`,
- `READ_COMMITTED`,
- `REPEATABLE_READ`,
- `SERIALIZABLE`.

Tapi isolation harus dipahami sebagai hint/setting pada JDBC/database transaction. Efek aktual tergantung database.

Contoh:

```java
@Transactional(isolation = Isolation.SERIALIZABLE)
public void allocateQuota() {
    // expensive consistency guarantee
}
```

Jangan menaikkan isolation sembarangan. Lebih baik sering kali memakai:

- unique constraint,
- conditional update,
- optimistic lock,
- pessimistic lock,
- idempotency key,
- deterministic lock order.

---

## 11. `readOnly = true`: Apa Realitanya?

```java
@Transactional(readOnly = true)
public CaseDetailView getDetail(Long id) {
    return repository.findDetail(id);
}
```

`readOnly=true` bukan jaminan database universal bahwa tidak ada write. Ia adalah semantic hint yang bisa dipakai Spring/provider/database untuk optimisasi.

Efek yang mungkin:

- Spring dapat mengatur transaction sebagai read-only pada connection,
- Hibernate dapat menyesuaikan flush mode atau dirty checking behavior,
- database tertentu bisa mengoptimalkan atau melarang write dalam read-only transaction,
- provider/dialect berbeda bisa berbeda.

Jangan mengandalkan `readOnly=true` sebagai security boundary.

Ini tetap buruk:

```java
@Transactional(readOnly = true)
public Case getAndAccidentallyMutate(Long id) {
    Case c = repository.getReferenceById(id);
    c.setStatus(CaseStatus.APPROVED);
    return c;
}
```

Walau banyak konfigurasi tidak akan flush perubahan tersebut, desainnya tetap salah. Read method sebaiknya return projection/DTO jika tidak perlu mutation.

---

## 12. Persistence Context dan Transaction Scope

Dalam Spring web/service app umum:

```text
One transaction
  ≈ one transaction-scoped EntityManager
  ≈ one persistence context
  ≈ one unit of work
```

Dalam satu transaction:

```java
@Transactional
public void example(Long id) {
    Case a = em.find(Case.class, id);
    Case b = em.find(Case.class, id);

    System.out.println(a == b); // usually true in same persistence context
}
```

Karena persistence context adalah identity map.

Setelah transaction selesai:

```text
EntityManager closed/unbound
Managed entities become detached
Lazy loading outside context fails
```

### 12.1 Lazy loading dan transaction

```java
@Transactional
public Case getCase(Long id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Jika controller kemudian serialize entity:

```java
@GetMapping("/cases/{id}")
public CaseResponse get(@PathVariable Long id) {
    Case c = caseService.getCase(id);
    return mapper.toResponse(c); // if mapper touches lazy field outside tx, fail
}
```

Solusi yang lebih benar:

```java
@Transactional(readOnly = true)
public CaseDetailResponse getCase(Long id) {
    Case c = caseRepository.findDetailForView(id).orElseThrow();
    return mapper.toDetailResponse(c); // map inside tx
}
```

Atau gunakan projection query langsung.

---

## 13. Open EntityManager in View

Spring Boot historis sering mengaktifkan Open EntityManager in View/Open Session in View pada web app.

Modelnya:

```text
HTTP request starts
  ↓
EntityManager opened
  ↓
Service transaction executes
  ↓
Transaction commits
  ↓
View/serialization can still lazy-load
  ↓
HTTP request ends
  ↓
EntityManager closed
```

Kelebihan:

- menghindari `LazyInitializationException`,
- memudahkan rendering view tradisional,
- developer junior merasa “semua jalan”.

Risiko:

- lazy query terjadi di controller/serializer,
- N+1 tersembunyi,
- query bisa terjadi setelah business transaction selesai,
- connection/resource bisa tertahan,
- boundary use case kabur,
- serialization dapat memicu query tak terduga,
- error/performance sulit dilacak.

Untuk API/service modern, lebih aman:

```properties
spring.jpa.open-in-view=false
```

Lalu desain fetch/projection secara eksplisit.

---

## 14. Transaction Boundary yang Baik di Spring App

Pattern umum:

```text
Controller
  ↓ no transaction if possible
Application Service
  ↓ @Transactional boundary
Repository
  ↓ no transaction ownership, joins current tx
EntityManager/Hibernate
  ↓ persistence context
Database
```

Contoh:

```java
@RestController
public class CaseController {

    private final CaseApplicationService service;

    @PostMapping("/cases/{id}/approve")
    public ResponseEntity<Void> approve(@PathVariable Long id,
                                        @RequestBody ApproveRequest request) {
        service.approve(new ApproveCommand(id, request.reason()));
        return ResponseEntity.noContent().build();
    }
}
```

```java
@Service
public class CaseApplicationService {

    private final CaseRepository caseRepository;
    private final OutboxRepository outboxRepository;

    @Transactional
    public void approve(ApproveCommand command) {
        Case c = caseRepository.findForUpdate(command.caseId())
                .orElseThrow(CaseNotFoundException::new);

        c.approve(command.reason());

        outboxRepository.append(CaseApprovedEvent.from(c));
    }
}
```

Repository tidak menjadi pemilik use case transaction:

```java
@Repository
public class JpaCaseRepository implements CaseRepository {

    @PersistenceContext
    private EntityManager em;

    public Optional<Case> findForUpdate(Long id) {
        return Optional.ofNullable(
            em.find(Case.class, id, LockModeType.OPTIMISTIC)
        );
    }
}
```

---

## 15. Repository Transaction: Boleh atau Tidak?

Spring Data JPA repository biasanya memiliki transaction default untuk banyak method. Namun pada aplikasi besar, jangan jadikan repository sebagai satu-satunya boundary.

Kurang baik:

```java
public void approve(Long id) {
    Case c = repository.findById(id).orElseThrow(); // tx 1 maybe
    c.approve();                                   // detached mutation?
    repository.save(c);                            // tx 2 maybe
    emailClient.send(...);                         // outside consistency model
}
```

Lebih baik:

```java
@Transactional
public void approve(Long id) {
    Case c = repository.findById(id).orElseThrow();
    c.approve();
    outboxRepository.append(...);
}
```

Repository-level transaction cocok untuk:

- simple CRUD tool,
- library default,
- read-only query,
- small app.

Service-level transaction wajib untuk:

- multi-repository operation,
- state transition,
- audit/outbox atomicity,
- validation/invariant,
- external event coordination,
- case management workflow.

---

## 16. `save()` Tidak Sama dengan Commit

Dalam Spring Data JPA:

```java
repository.save(entity);
```

Sering disalahpahami sebagai “langsung tersimpan permanen”. Padahal:

- `save()` bisa `persist()` atau `merge()`,
- SQL mungkin belum dikirim sampai flush,
- flush mungkin terjadi sebelum query atau commit,
- commit baru membuat perubahan durable,
- rollback akan membatalkan perubahan.

Contoh:

```java
@Transactional
public void create() {
    repository.save(new Case(...));
    throw new RuntimeException();
}
```

Hasil akhir: data rollback.

### 16.1 `saveAndFlush()`

```java
repository.saveAndFlush(entity);
```

Ini memaksa flush, bukan commit.

Use case:

- ingin constraint violation muncul lebih awal,
- butuh generated value yang hanya muncul setelah flush,
- perlu sinkronisasi sebelum native query tertentu.

Tapi jangan pakai `saveAndFlush()` sebagai kebiasaan. Ia bisa merusak batching dan menambah roundtrip.

---

## 17. `persist()` vs `merge()` dalam Spring Context

Spring Data JPA `save()` biasanya menentukan entity baru atau lama berdasarkan id/version/entity information.

Mental model:

```text
New entity     -> persist
Existing entity -> merge or managed update
```

Bahaya umum:

```java
@Transactional
public void update(UpdateCaseRequest request) {
    Case detached = mapper.toEntity(request);
    repository.save(detached); // merge detached graph
}
```

Risiko:

- overwrite field yang tidak ada di request,
- relationship hilang,
- stale data menang tanpa expected version,
- mass assignment vulnerability,
- audit field tertimpa,
- orphan removal tidak sengaja.

Lebih baik:

```java
@Transactional
public void update(UpdateCaseCommand command) {
    Case c = repository.findById(command.id()).orElseThrow();
    c.changeTitle(command.title());
    c.changeDescription(command.description());
}
```

Untuk command update, load managed aggregate lalu mutasi intention-revealing method.

---

## 18. Async Boundary dan Transaction

Spring transaction context umumnya thread-bound. Artinya:

```text
Transaction is bound to current thread
```

Contoh salah:

```java
@Transactional
public void submit(Long id) {
    Case c = repository.findById(id).orElseThrow();

    CompletableFuture.runAsync(() -> {
        c.approve(); // different thread, detached/unsafe context
    });
}
```

Masalah:

- transaction tidak otomatis ikut ke thread baru,
- `EntityManager` tidak thread-safe,
- managed entity tidak boleh dipakai lintas thread,
- lazy loading bisa gagal,
- mutation tidak terdeteksi transaction asal,
- race condition.

Dengan `@Async` juga sama:

```java
@Transactional
public void submit() {
    asyncService.processLater(id); // new thread, separate transaction context
}
```

Jika async method butuh DB transaction:

```java
@Async
@Transactional
public void processLater(Long id) {
    Case c = repository.findById(id).orElseThrow();
    c.process();
}
```

Tapi ini transaction baru, bukan transaction caller.

Untuk side effect setelah commit, gunakan:

- outbox pattern,
- `@TransactionalEventListener(phase = AFTER_COMMIT)`,
- message broker,
- scheduler polling committed work.

---

## 19. Transactional Event Listener

Spring menyediakan event listener yang bisa berjalan pada fase transaction tertentu.

Contoh:

```java
@Service
public class CaseService {

    private final ApplicationEventPublisher publisher;

    @Transactional
    public void approve(Long id) {
        Case c = repository.findById(id).orElseThrow();
        c.approve();
        publisher.publishEvent(new CaseApprovedEvent(id));
    }
}
```

Listener:

```java
@Component
public class CaseApprovedListener {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void afterCommit(CaseApprovedEvent event) {
        // send notification or enqueue async work
    }
}
```

Makna:

```text
Event published during transaction
Listener runs after commit succeeds
```

Kelebihan:

- side effect tidak jalan jika transaction rollback,
- lebih aman daripada langsung call external service dalam transaction.

Keterbatasan:

- jika process mati setelah commit sebelum listener selesai, event bisa hilang,
- tidak durable seperti outbox table,
- untuk critical integration gunakan transactional outbox.

---

## 20. External API Call dalam Transaction

Contoh berbahaya:

```java
@Transactional
public void approve(Long id) {
    Case c = repository.findById(id).orElseThrow();
    c.approve();

    paymentClient.charge(...); // external call inside tx

    outboxRepository.append(...);
}
```

Risiko:

```text
DB transaction open
DB connection held
Locks held
External latency coupled to DB transaction
External success but DB rollback possible
DB commit success but HTTP response to external failed possible
```

Pattern yang lebih aman:

```java
@Transactional
public void approve(Long id) {
    Case c = repository.findById(id).orElseThrow();
    c.approve();
    outboxRepository.append(new NotificationRequested(...));
}
```

Lalu worker:

```java
@Transactional
public void publishOutboxBatch() {
    List<OutboxMessage> messages = outboxRepository.lockNextBatch();
    // publish outside or carefully mark state depending design
}
```

Atau gunakan outbox CDC.

---

## 21. Connection Pool Implication

Transaction bukan hanya logical boundary. Ia memengaruhi resource fisik.

Long transaction dapat menahan:

- JDBC connection,
- row lock,
- MVCC snapshot,
- undo/version storage,
- persistence context memory,
- database session.

Contoh buruk:

```java
@Transactional
public void exportLargeReport() {
    List<Case> cases = repository.findAllLarge();
    byte[] file = excelGenerator.generate(cases);
    s3Client.upload(file);
}
```

Masalah:

- read banyak data dalam satu transaction,
- persistence context membesar,
- file generation lama,
- upload lama,
- connection tertahan.

Alternatif:

- projection streaming/chunking,
- read-only transaction per chunk,
- generate file di luar transaction,
- use cursor carefully,
- use database-native export untuk volume besar,
- separate query phase dan upload phase.

---

## 22. Virtual Threads dan Spring Transaction

Java 21+ membawa virtual threads. Untuk Spring/JPA blocking stack, virtual threads bisa meningkatkan concurrency model pada request blocking. Tapi:

```text
Virtual threads do not make database connections unlimited.
```

Transaction context tetap secara praktis terkait eksekusi thread. JPA `EntityManager` tetap tidak thread-safe. JDBC connection pool tetap bottleneck fisik.

Bahaya mental model:

```text
More virtual threads -> more concurrent transactions -> more connection pressure -> DB overload
```

Guideline:

- tetap batasi connection pool sesuai kapasitas DB,
- tetap pakai timeout,
- jangan melakukan blocking external call dalam transaction,
- jangan share entity/entity manager lintas thread,
- gunakan bulkhead/rate limit untuk operasi DB-heavy,
- ukur active connections, wait time, lock wait, DB CPU, p95/p99 transaction duration.

---

## 23. Multi-Transaction-Manager Scenario

Aplikasi enterprise bisa punya lebih dari satu data source:

```text
primaryDataSource -> primaryEntityManagerFactory -> primaryTransactionManager
reportDataSource  -> reportEntityManagerFactory  -> reportTransactionManager
```

Jika ada beberapa transaction manager, annotation harus eksplisit:

```java
@Transactional("primaryTransactionManager")
public void updatePrimary() { }

@Transactional("reportTransactionManager")
public void updateReport() { }
```

Jika tidak, Spring bisa memilih transaction manager default yang salah atau gagal startup.

Hindari satu service method mengubah dua database berbeda tanpa desain consistency yang jelas:

```java
@Transactional("primaryTransactionManager")
public void updateTwoDatabases() {
    primaryRepository.save(...);
    reportRepository.save(...); // maybe different tx manager, not atomic
}
```

Pilihan desain:

1. JTA/XA jika benar-benar butuh atomic distributed transaction.
2. Outbox/eventual consistency jika business bisa menerima eventual update.
3. Satu database sebagai source of truth, database lain sebagai projection/reporting.
4. CDC untuk replikasi perubahan.

Untuk kebanyakan microservice/enterprise modern, outbox/CDC lebih practical daripada XA, kecuali ada kebutuhan kuat.

---

## 24. Programmatic Transaction dengan `TransactionTemplate`

Declarative transaction cukup untuk mayoritas use case. Tapi kadang programmatic boundary lebih jelas.

Contoh:

```java
@Service
public class ImportService {

    private final TransactionTemplate txTemplate;
    private final CaseRepository repository;

    public void importRows(List<Row> rows) {
        for (Row row : rows) {
            txTemplate.executeWithoutResult(status -> {
                repository.upsert(row);
            });
        }
    }
}
```

Use case:

- batch chunk per item/per group,
- retry boundary eksplisit,
- menghindari self-invocation,
- transaction kecil dalam loop,
- flow kompleks yang sulit diekspresikan dengan annotation.

Jangan campur declarative dan programmatic secara acak. Pilih model yang membuat boundary paling terbaca.

---

## 25. Transaction dan Retry

Retry harus dilakukan di luar transaction yang gagal.

Kurang baik:

```java
@Transactional
public void processWithRetry(Long id) {
    for (int i = 0; i < 3; i++) {
        try {
            doUpdate(id);
            return;
        } catch (DeadlockLoserDataAccessException e) {
            // same transaction may already be rollback-only
        }
    }
}
```

Lebih baik:

```java
public void processWithRetry(Long id) {
    retryTemplate.execute(ctx -> {
        transactionalProcessor.processOnce(id);
        return null;
    });
}
```

```java
@Service
public class TransactionalProcessor {

    @Transactional
    public void processOnce(Long id) {
        Case c = repository.findById(id).orElseThrow();
        c.process();
    }
}
```

Setiap retry mendapat transaction baru.

Retry hanya aman jika operasi idempotent atau guarded by:

- expected version,
- idempotency key,
- unique constraint,
- state transition guard,
- outbox deduplication,
- conditional update.

---

## 26. Exception Translation

Spring repository biasanya memakai exception translation:

```java
@Repository
public class JpaCaseRepository { }
```

Dengan `@Repository`, Spring dapat menerjemahkan provider exception menjadi `DataAccessException` hierarchy.

Contoh kategori:

- `DataIntegrityViolationException`,
- `OptimisticLockingFailureException`,
- `PessimisticLockingFailureException`,
- `CannotAcquireLockException`,
- `DeadlockLoserDataAccessException`,
- `QueryTimeoutException`,
- `TransientDataAccessResourceException`,
- `NonTransientDataAccessException`.

Manfaat:

- service layer tidak perlu tergantung penuh pada Hibernate exception,
- retry classifier lebih mudah,
- error API mapping lebih konsisten.

Namun untuk kasus tertentu, kamu tetap perlu membaca:

- SQLState,
- vendor error code,
- constraint name,
- root cause exception.

---

## 27. Spring Data JPA Transaction Defaults

Spring Data JPA repository method memiliki default transaction semantics.

Secara umum:

- read methods sering read-only,
- modifying methods transactional,
- custom method mengikuti konfigurasi.

Namun untuk use case kompleks, tetap buat service-level transaction.

Contoh buruk jika mengandalkan repository default:

```java
public void approve(Long id) {
    Case c = caseRepository.findById(id).orElseThrow();
    c.approve();
    auditRepository.save(...);
}
```

Jika tidak ada transaction service-level, entity dari `findById` bisa detached setelah repository method selesai. Mutation `c.approve()` tidak otomatis flush.

Lebih baik:

```java
@Transactional
public void approve(Long id) {
    Case c = caseRepository.findById(id).orElseThrow();
    c.approve();
    auditRepository.save(...);
}
```

---

## 28. Modifying Query dan Persistence Context

Spring Data JPA:

```java
@Modifying
@Query("update Case c set c.status = :status where c.id = :id")
int updateStatus(@Param("id") Long id, @Param("status") CaseStatus status);
```

Bulk update bypass persistence context.

Contoh bahaya:

```java
@Transactional
public void example(Long id) {
    Case c = repository.findById(id).orElseThrow();

    repository.updateStatus(id, CaseStatus.APPROVED);

    // c may still have old status in persistence context
    log.info("status={}", c.getStatus());
}
```

Gunakan opsi:

```java
@Modifying(clearAutomatically = true, flushAutomatically = true)
```

Tapi pahami konsekuensinya:

- `flushAutomatically` memaksa flush sebelum query,
- `clearAutomatically` detach semua managed entities,
- object yang masih dipakai setelah clear menjadi detached.

Untuk state machine penting, sering lebih aman memakai managed entity + optimistic lock, atau conditional update dengan clear boundary yang eksplisit.

---

## 29. Transaction dengan Scheduler dan Batch

Scheduler umum:

```java
@Scheduled(fixedDelay = 60_000)
public void run() {
    service.processPending();
}
```

Jangan taruh satu transaction besar untuk semua pending item:

```java
@Transactional
public void processPending() {
    List<Job> jobs = repository.findAllPending();
    for (Job job : jobs) {
        process(job);
    }
}
```

Risiko:

- lock lama,
- rollback besar,
- persistence context membesar,
- job lain blocked,
- satu item gagal membatalkan semua.

Lebih baik:

```java
public void processPending() {
    while (true) {
        List<Long> ids = jobRepository.findNextIds(100);
        if (ids.isEmpty()) return;

        for (Long id : ids) {
            processor.processOne(id); // transactional per item/chunk
        }
    }
}
```

```java
@Service
public class JobProcessor {

    @Transactional
    public void processOne(Long id) {
        Job job = jobRepository.lockById(id).orElseThrow();
        job.process();
    }
}
```

Untuk throughput tinggi, gunakan:

- chunk transaction,
- `SKIP LOCKED`,
- idempotency,
- retry limit,
- dead-letter table,
- progress checkpoint.

---

## 30. Transaction dengan Message Consumer

Message consumer pattern:

```java
@RabbitListener(queues = "case.approved")
public void consume(Message message) {
    service.handle(message);
}
```

Service:

```java
@Transactional
public void handle(CaseApprovedMessage message) {
    inboxRepository.recordIfAbsent(message.messageId());
    projectionRepository.update(...);
}
```

Desain penting:

- jangan ack message sebelum DB commit jika state harus durable,
- gunakan inbox table untuk deduplication,
- gunakan unique constraint pada `message_id`,
- retry transient failure,
- send to DLQ untuk poison message,
- jangan mengandalkan exactly-once dari broker saja.

Jika broker transaction dan DB transaction ingin atomic, perlu transaction coordination yang lebih rumit. Dalam banyak sistem, inbox/outbox dengan at-least-once lebih practical.

---

## 31. Transaction dengan Domain Event dan Outbox

Dalam service:

```java
@Transactional
public void approve(Long id) {
    Case c = caseRepository.findById(id).orElseThrow();
    c.approve();

    outboxRepository.append(
        OutboxMessage.of(
            "CaseApproved",
            c.getId(),
            jsonPayload
        )
    );
}
```

Karena outbox disimpan di database yang sama dan transaction yang sama:

```text
Case state update and outbox insert commit atomically
```

Kemudian publisher:

```java
@Transactional
public void publishBatch() {
    List<OutboxMessage> messages = outboxRepository.lockNextBatch();
    for (OutboxMessage m : messages) {
        publisher.publish(m);
        m.markPublished();
    }
}
```

Namun desain publisher perlu hati-hati:

- publish external broker di dalam transaction bisa menahan lock,
- jika publish sukses tapi DB mark failed, message bisa terkirim ulang,
- consumer harus idempotent,
- outbox status update harus resilient.

---

## 32. Common Anti-Patterns

### 32.1 `@Transactional` di controller untuk semua hal

```java
@RestController
@Transactional
public class CaseController { }
```

Masalah:

- transaction mencakup request parsing/serialization,
- boundary terlalu luas,
- external latency bisa masuk transaction,
- controller jadi pemilik consistency.

Lebih baik: transaction di application service.

### 32.2 `@Transactional` di private method

```java
private @Transactional void doWork() { }
```

Tidak efektif dalam proxy-based model.

### 32.3 Self-invocation

```java
this.doTransactionalWork();
```

Bypass proxy.

### 32.4 Read method return entity ke layer luar

```java
@Transactional(readOnly = true)
public Case getCase(Long id) {
    return repository.findById(id).orElseThrow();
}
```

Lalu entity digunakan di luar transaction. Risiko lazy loading/detached mutation.

### 32.5 External call dalam transaction

```java
@Transactional
public void approve() {
    repository.save(...);
    externalApi.call();
}
```

Menyatukan latency eksternal dengan DB transaction.

### 32.6 `REQUIRES_NEW` sebagai plaster

Jika setiap masalah diselesaikan dengan `REQUIRES_NEW`, biasanya boundary desain belum jelas.

### 32.7 Satu transaction untuk batch besar

Persistence context dan lock bisa meledak.

### 32.8 Catch exception lalu berharap rollback

Jika exception ditangkap, Spring mungkin commit kecuali transaction ditandai rollback-only.

### 32.9 Menganggap `readOnly=true` mencegah semua write

Itu hint, bukan universal security guarantee.

### 32.10 Share entity lintas thread

Entity managed tidak thread-safe dan terikat persistence context.

---

## 33. Design Patterns yang Direkomendasikan

### 33.1 Application Service Transaction Boundary

```java
@Service
public class CaseApplicationService {

    @Transactional
    public void transition(TransitionCommand command) {
        Case c = repository.findById(command.caseId()).orElseThrow();
        c.transition(command.action(), command.actor());
        auditRepository.append(AuditEntry.from(c, command));
        outboxRepository.append(EventMessage.from(c));
    }
}
```

### 33.2 Read Projection Transaction

```java
@Transactional(readOnly = true)
public CaseDetailView getDetail(Long id, User user) {
    return queryRepository.findDetail(id, user.allowedAgencyIds())
            .orElseThrow();
}
```

### 33.3 Outbox for Side Effects

```java
@Transactional
public void submit(Long id) {
    Application app = repository.get(id);
    app.submit();
    outbox.append(ApplicationSubmitted.of(app));
}
```

### 33.4 Retry Outside Transaction

```java
public void process(Long id) {
    retry.execute(() -> txWorker.processOnce(id));
}
```

### 33.5 Chunked Batch

```java
public void importFile(File file) {
    for (List<Row> chunk : chunks(file, 500)) {
        importer.importChunk(chunk);
    }
}

@Transactional
public void importChunk(List<Row> rows) {
    rows.forEach(repository::upsert);
}
```

### 33.6 Explicit Transaction Manager

```java
@Transactional(transactionManager = "primaryTransactionManager")
public void updatePrimary() { }
```

---

## 34. Production Failure Modes

### 34.1 Connection Pool Exhaustion

Symptoms:

- requests hang,
- Hikari timeout,
- DB active sessions high,
- thread dump waiting for connection,
- p99 latency spikes.

Causes:

- transaction too long,
- external calls inside transaction,
- batch transaction huge,
- pool too small or DB overloaded,
- connection leak,
- `REQUIRES_NEW` nested under high concurrency.

Mitigation:

- shorten transaction,
- move side effect to outbox,
- set timeout,
- chunk batch,
- monitor active/idle/pending connections,
- inspect DB sessions.

### 34.2 Unexpected Rollback

Symptoms:

- method returns but commit fails with unexpected rollback,
- inner exception caught but outer still rollback.

Causes:

- inner transactional method marked rollback-only,
- exception swallowed,
- propagation misunderstanding.

Mitigation:

- avoid swallowing exceptions inside transaction,
- separate retry boundary,
- use `REQUIRES_NEW` only if semantically correct,
- use programmatic transaction where clearer.

### 34.3 LazyInitializationException

Symptoms:

- error during JSON serialization,
- mapper fails outside service.

Causes:

- entity returned outside transaction,
- OSIV disabled without explicit fetch plan,
- detached entity.

Mitigation:

- map to DTO inside transaction,
- use projection query,
- use fetch join/entity graph per use case,
- don't expose entity from API.

### 34.4 Long Lock Wait/Deadlock

Causes:

- inconsistent lock order,
- transaction too large,
- external call inside lock-holding transaction,
- batch updates hot rows,
- `REQUIRES_NEW` touches same row as outer.

Mitigation:

- deterministic lock order,
- shorter transaction,
- optimistic locking,
- conditional update,
- retry transient deadlock,
- database monitoring.

### 34.5 Stale Persistence Context

Causes:

- bulk update/delete,
- native SQL update,
- external process updates same row,
- cache invalidation missing.

Mitigation:

- clear/refresh after bulk,
- keep transaction boundary simple,
- use versioning,
- avoid mixing bulk SQL and managed entity mutation in same context.

---

## 35. Observability Checklist

Monitor at application level:

- transaction duration,
- active transaction count,
- rollback count,
- commit count,
- transaction timeout count,
- exception classification,
- Hikari active/idle/pending connections,
- connection acquisition time,
- slow repository method,
- Hibernate flush count,
- entity load count,
- query count per request,
- N+1 detection,
- p95/p99 service latency.

Monitor at database level:

- active sessions,
- lock wait,
- deadlock,
- long-running transaction,
- blocked sessions,
- CPU/I/O,
- undo/MVCC bloat,
- slow query plan,
- row lock contention,
- connection count.

Add correlation:

- request id,
- transaction/use-case name,
- user/actor id,
- tenant/agency id,
- entity id,
- command id/idempotency key,
- outbox message id.

---

## 36. Testing Transaction Behavior

### 36.1 Test rollback rule

```java
@Test
void runtimeExceptionRollsBack() {
    assertThrows(RuntimeException.class, () -> service.createThenFail());
    assertThat(repository.count()).isZero();
}
```

### 36.2 Test checked exception rollback

```java
@Test
void checkedExceptionRollbackRequiresRollbackFor() {
    assertThrows(BusinessCheckedException.class, () -> service.createThenCheckedFail());
    assertThat(repository.count()).isZero();
}
```

### 36.3 Test self-invocation bug

Design test that proves internal call does or does not create intended transaction.

### 36.4 Test lazy boundary

Disable OSIV and ensure service returns DTO/projection safely.

### 36.5 Test propagation

Verify `REQUIRES_NEW` commits independently only when that is the requirement.

### 36.6 Test deadlock/retry with real DB

Use Testcontainers or real integration database. H2 is not enough for locking behavior.

---

## 37. Case Management Example

Requirement:

- Officer approves a case.
- Case state changes from `UNDER_REVIEW` to `APPROVED`.
- Audit trail must be stored atomically with state change.
- Notification must be sent after successful commit.
- Duplicate approval request must be idempotent.
- Concurrent approval/rejection must not both succeed.

Design:

```java
@Service
public class CaseDecisionService {

    private final CaseRepository caseRepository;
    private final AuditTrailRepository auditTrailRepository;
    private final OutboxRepository outboxRepository;
    private final IdempotencyRepository idempotencyRepository;

    @Transactional
    public DecisionResult approve(ApproveCaseCommand command) {
        if (!idempotencyRepository.tryStart(command.idempotencyKey())) {
            return idempotencyRepository.getResult(command.idempotencyKey());
        }

        Case c = caseRepository.findById(command.caseId())
                .orElseThrow(CaseNotFoundException::new);

        c.approve(command.actorId(), command.reason(), command.expectedVersion());

        auditTrailRepository.append(AuditTrailEntry.caseApproved(c, command));
        outboxRepository.append(OutboxMessage.caseApproved(c));

        DecisionResult result = DecisionResult.approved(c.getId(), c.getVersion() + 1);
        idempotencyRepository.markCompleted(command.idempotencyKey(), result);

        return result;
    }
}
```

Entity:

```java
@Entity
@Table(name = "cases")
public class Case {

    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    public void approve(String actorId, String reason, long expectedVersion) {
        if (this.version != expectedVersion) {
            throw new StaleCaseDecisionException(id, expectedVersion, version);
        }
        if (this.status != CaseStatus.UNDER_REVIEW) {
            throw new InvalidCaseTransitionException(status, CaseStatus.APPROVED);
        }
        this.status = CaseStatus.APPROVED;
    }
}
```

Semantics:

```text
One command
  -> one transaction
  -> state transition + audit + idempotency + outbox commit atomically
  -> external notification handled after commit by outbox publisher
```

This is the kind of design that survives concurrency, retries, and production failure.

---

## 38. Checklist Desain Spring Transaction + JPA

Sebelum merge production code, tanya:

1. Apakah transaction boundary berada di application service, bukan controller/repository secara acak?
2. Apakah method transactional dipanggil lewat Spring proxy?
3. Apakah ada self-invocation yang membuat annotation tidak efektif?
4. Apakah rollback rule sesuai checked/unchecked exception yang dipakai?
5. Apakah ada exception yang ditangkap tapi transaction seharusnya rollback?
6. Apakah external API/file/email/message broker dipanggil di dalam transaction?
7. Apakah read method return DTO/projection, bukan entity mentah ke API?
8. Apakah lazy loading boundary eksplisit?
9. Apakah `REQUIRES_NEW` benar-benar requirement, bukan plaster?
10. Apakah batch memakai chunked transaction?
11. Apakah retry dilakukan di luar transaction gagal?
12. Apakah operasi idempotent jika bisa di-retry?
13. Apakah multiple datasource memakai transaction manager yang jelas?
14. Apakah bulk update/delete membersihkan persistence context jika perlu?
15. Apakah transaction timeout dikonfigurasi untuk operasi rawan lama?
16. Apakah monitoring transaction duration dan connection pool tersedia?
17. Apakah test memakai database nyata untuk locking/transaction behavior?
18. Apakah OSIV setting diketahui dan desain fetch plan sesuai?
19. Apakah entity tidak dibawa lintas thread?
20. Apakah virtual-thread concurrency tidak melebihi kapasitas DB/pool?

---

## 39. Ringkasan

Spring Transaction + JPA adalah integrasi antara beberapa boundary:

```text
Spring AOP boundary
  + transaction manager boundary
  + EntityManager/persistence context boundary
  + JDBC connection boundary
  + database transaction boundary
```

`@Transactional` bukan magic. Ia hanya efektif jika:

- method call melewati proxy,
- transaction manager yang benar dipilih,
- exception/rollback rule benar,
- persistence context lifecycle dipahami,
- transaction tidak terlalu panjang,
- external side effect tidak dicampur sembarangan,
- retry/idempotency/locking dirancang eksplisit.

Untuk aplikasi enterprise dan regulatory workflow, transaction boundary adalah bagian dari correctness architecture. Ia menentukan apa yang atomic, apa yang eventual, apa yang boleh retry, apa yang harus audit, dan apa yang harus tetap benar di bawah concurrency.

---

## 40. Latihan

### Latihan 1 — Self Invocation

Buat service:

```java
public void outer() {
    inner();
}

@Transactional
public void inner() { }
```

Analisis:

1. Apakah transaction aktif?
2. Bagaimana membuktikannya dengan test?
3. Bagaimana memperbaikinya tanpa membuat desain aneh?

### Latihan 2 — Rollback Checked Exception

Buat method yang menyimpan row lalu melempar checked exception.

Analisis:

1. Apakah row commit atau rollback?
2. Bagaimana behavior berubah dengan `rollbackFor`?
3. Apa standar exception hierarchy yang sebaiknya dipakai di project?

### Latihan 3 — External Call

Use case:

```text
Approve case -> update DB -> send email -> publish message
```

Desain ulang agar:

- DB state dan audit atomic,
- email/message tidak dikirim jika DB rollback,
- failure publish bisa retry,
- duplicate message tidak merusak consumer.

### Latihan 4 — Batch Import

Import 1 juta row dari CSV.

Desain:

- transaction chunk size,
- flush/clear strategy,
- error handling,
- retry,
- skip/dead-letter,
- idempotency,
- observability.

### Latihan 5 — Multiple Datasource

Satu service update primary database dan reporting database.

Analisis:

1. Apakah butuh atomic cross-database commit?
2. Apakah JTA/XA justified?
3. Apakah outbox/CDC lebih tepat?
4. Bagaimana failure recovery-nya?

---

## 41. Referensi

- Spring Framework Reference — Transaction Management
- Spring Framework Reference — Transaction Propagation
- Spring Framework Javadoc — `JpaTransactionManager`
- Spring Framework Reference — JPA integration
- Jakarta Persistence 3.2 Specification
- Jakarta Persistence `EntityManager` API
- Jakarta Transactions 2.0 Specification
- Hibernate ORM User Guide — transactions, persistence context, flushing
- Hibernate ORM 7 documentation
