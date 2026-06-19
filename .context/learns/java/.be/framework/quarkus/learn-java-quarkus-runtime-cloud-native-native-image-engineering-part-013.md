# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-013

# Part 013 — Transaction Engineering: Narayana, JTA, Reactive Transactions, Outbox, dan Consistency Boundary

> Status: Part 013 dari maksimal 35 part.  
> Seri belum selesai / belum mencapai bagian terakhir.  
> Fokus: memahami transaksi sebagai _consistency boundary_, bukan sekadar anotasi `@Transactional`.

---

## 0. Prasyarat Mental

Pada seri sebelumnya kamu sudah mempelajari:

- Java concurrency dan reactive.
- JDBC, HikariCP, SQL, JPA, Hibernate ORM.
- Jakarta Transactions/JTA secara konseptual.
- Quarkus REST, CDI/Arc, Hibernate ORM, Hibernate Reactive, Mutiny.
- Blocking vs reactive execution model.

Karena itu bagian ini **tidak mengulang dasar ACID, JPA, JDBC, atau SQL isolation dari nol**. Fokus kita adalah:

1. Bagaimana Quarkus membentuk boundary transaksi.
2. Bagaimana Narayana/JTA bekerja dalam Quarkus.
3. Bagaimana transaksi berbeda antara blocking ORM dan reactive pipeline.
4. Bagaimana mendesain consistency boundary di sistem nyata.
5. Bagaimana menghindari false confidence: “sudah `@Transactional`, berarti aman”.
6. Bagaimana menghubungkan transaksi lokal dengan event/outbox, retry, idempotency, dan microservice consistency.

---

## 1. Core Mental Model

Transaction engineering adalah seni menentukan:

> “Perubahan state mana yang harus berhasil bersama, mana yang boleh eventually consistent, dan bagaimana sistem pulih ketika sebagian langkah gagal.”

Di Quarkus, transaksi bisa terlihat sederhana:

```java
@Transactional
public void approveCase(UUID caseId) {
    Case c = caseRepository.findById(caseId);
    c.approve();
    auditRepository.persist(AuditEvent.approved(caseId));
}
```

Tetapi secara engineering, method itu menyimpan banyak keputusan tersembunyi:

- Apakah `approve()` mengubah satu aggregate atau banyak aggregate?
- Apakah audit event harus atomic dengan perubahan case?
- Apakah email notifikasi boleh dikirim di dalam transaksi?
- Apakah message Kafka boleh dipublish sebelum commit?
- Apakah retry aman jika method ini timeout?
- Apakah lock database akan menahan request lain?
- Apakah user melihat state sebelum event downstream selesai?
- Apakah rollback akan terjadi untuk semua exception yang kita anggap gagal?
- Apakah transaction boundary berada di REST resource, service, repository, atau handler?

Top engineer tidak bertanya “pakai `@Transactional` di mana?”, tetapi:

> “Apa unit konsistensi domain yang harus dijaga, dan apa failure semantics-nya?”

---

## 2. Transaction sebagai Boundary, Bukan Fitur Framework

Transaksi memiliki dua sisi:

| Sisi | Pertanyaan |
|---|---|
| Technical boundary | Kapan connection dibuka, transaction dimulai, commit, rollback, flush? |
| Domain boundary | State mana yang harus berubah sebagai satu keputusan bisnis? |

Framework hanya membantu sisi teknis. Ia tidak tahu apakah secara domain perubahan berikut harus atomic:

- update status case,
- insert audit trail,
- create task officer,
- reserve payment,
- send email,
- publish event,
- update read model,
- call external system.

Itu keputusan arsitektur.

### Invariant utama

```text
Satu transaksi database idealnya melindungi satu consistency boundary yang kecil, jelas, dan retry-safe.
```

Jika transaksi terlalu kecil, sistem mudah inkonsisten.

Jika transaksi terlalu besar, sistem mudah lambat, deadlock, timeout, dan sulit diskalakan.

---

## 3. Quarkus Transaction Stack

Quarkus transaction stack umumnya melibatkan:

```text
Application Code
   |
   | @Transactional / QuarkusTransaction / reactive transaction API
   v
Jakarta Transactions / JTA abstraction
   |
   v
Narayana Transaction Manager
   |
   v
Datasource / JDBC / Hibernate ORM / XA resource
   |
   v
Database
```

Quarkus menyediakan integrasi transaksi melalui `quarkus-narayana-jta`. Dokumentasi resmi Quarkus menyatakan extension ini menyediakan transaction manager yang mengoordinasikan dan mengekspos transaksi ke aplikasi sesuai Jakarta Transactions/JTA. Hibernate ORM Quarkus juga merekomendasikan method yang memodifikasi database dibungkus dalam transaksi, misalnya dengan `@Transactional` pada boundary aplikasi seperti REST controller/service boundary.

---

## 4. Narayana dalam Quarkus

Narayana adalah transaction manager yang digunakan Quarkus untuk JTA.

Perannya:

- memulai transaksi,
- mengikat transaksi ke execution context,
- mengoordinasikan resource transactional,
- mengatur commit/rollback,
- menangani timeout,
- mendukung local transaction dan distributed/XA transaction bila dikonfigurasi,
- menyediakan integrasi dengan Hibernate ORM dan datasource.

### Yang sering disalahpahami

Narayana bukan magic consistency engine untuk distributed system.

Ia kuat untuk transaction coordination, tetapi:

- tidak membuat remote HTTP call menjadi atomic,
- tidak membuat Kafka publish otomatis atomic dengan database kecuali desainnya memang mendukung,
- tidak membuat external email rollback ketika database rollback,
- tidak menyelesaikan idempotency,
- tidak menghilangkan kebutuhan outbox/saga.

---

## 5. Transaction Boundary di Quarkus Blocking ORM

Pada Hibernate ORM blocking, pola paling umum:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;

@ApplicationScoped
public class CaseApprovalService {

    private final CaseRepository caseRepository;
    private final AuditRepository auditRepository;

    public CaseApprovalService(CaseRepository caseRepository,
                               AuditRepository auditRepository) {
        this.caseRepository = caseRepository;
        this.auditRepository = auditRepository;
    }

    @Transactional
    public void approve(ApproveCaseCommand command) {
        CaseRecord record = caseRepository.getForUpdate(command.caseId());
        record.approve(command.officerId(), command.reason());
        auditRepository.persist(AuditEvent.caseApproved(command.caseId(), command.officerId()));
    }
}
```

Boundary-nya adalah method `approve()`.

Secara umum:

```text
method masuk
  -> interceptor transaksi aktif
  -> persistence context/session aktif
  -> database changes terjadi
  -> method selesai normal
  -> flush
  -> commit
method keluar
```

Jika exception menyebabkan rollback:

```text
method masuk
  -> transaksi aktif
  -> perubahan terjadi
  -> exception
  -> rollback
  -> exception keluar
```

---

## 6. Di Mana Seharusnya `@Transactional` Diletakkan?

Ada beberapa pilihan.

### 6.1 Di REST Resource

```java
@Path("/cases")
public class CaseResource {

    @POST
    @Path("/{id}/approve")
    @Transactional
    public Response approve(@PathParam("id") UUID id, ApproveRequest request) {
        // domain logic
        return Response.noContent().build();
    }
}
```

Kelebihan:

- boundary terlihat jelas dari entry point,
- cocok untuk operasi sederhana,
- sesuai rekomendasi umum Quarkus untuk application entry point.

Kekurangan:

- REST resource mudah menjadi terlalu gemuk,
- domain logic bercampur HTTP concern,
- sulit reuse dari messaging/job/use case lain,
- mudah memasukkan serialization atau response building ke area transaksi.

### 6.2 Di Application Service / Use Case Handler

```java
@ApplicationScoped
public class ApproveCaseUseCase {

    @Transactional
    public ApprovalResult handle(ApproveCaseCommand command) {
        // pure application transaction boundary
    }
}
```

Kelebihan:

- boundary lebih reusable,
- cocok untuk domain kompleks,
- REST/messaging/job dapat memanggil use case yang sama,
- testing lebih mudah,
- domain transaction lebih eksplisit.

Kekurangan:

- butuh disiplin desain,
- developer harus menghindari self-invocation trap,
- exception mapping harus jelas di layer luar.

### 6.3 Di Repository

```java
@Transactional
public void save(CaseRecord record) {
    entityManager.persist(record);
}
```

Biasanya kurang ideal untuk domain kompleks.

Masalah:

- transaksi menjadi terlalu kecil,
- satu use case bisa memiliki banyak transaksi tersembunyi,
- invariant lintas repository tidak atomic,
- debugging consistency sulit.

Repository boleh transactional untuk operasi teknis kecil, tetapi untuk use case penting biasanya transaction boundary sebaiknya ada di application service.

---

## 7. Self-Invocation Trap

CDI interceptor seperti `@Transactional` bekerja saat method dipanggil melalui proxy CDI.

Contoh bermasalah:

```java
@ApplicationScoped
public class CaseService {

    public void outer(UUID id) {
        inner(id); // self-invocation, interceptor bisa tidak aktif seperti yang diharapkan
    }

    @Transactional
    public void inner(UUID id) {
        // transaction expected
    }
}
```

Masalahnya: `outer()` memanggil `inner()` langsung dalam object yang sama, bukan melalui CDI proxy.

Desain yang lebih jelas:

```java
@ApplicationScoped
public class CaseWorkflowService {

    private final CaseTransactionService transactionService;

    public CaseWorkflowService(CaseTransactionService transactionService) {
        this.transactionService = transactionService;
    }

    public void outer(UUID id) {
        transactionService.inner(id);
    }
}

@ApplicationScoped
public class CaseTransactionService {

    @Transactional
    public void inner(UUID id) {
        // transaction active
    }
}
```

Top engineer menghindari transaction semantics yang bergantung pada kebetulan proxy.

---

## 8. Rollback Semantics

`@Transactional` tidak berarti semua exception otomatis rollback dengan cara yang kamu inginkan.

Secara umum dalam Jakarta Transactions:

- unchecked exception biasanya menyebabkan rollback,
- checked exception tidak selalu menyebabkan rollback kecuali diatur,
- rollback behavior bisa dikustomisasi dengan atribut seperti `rollbackOn` dan `dontRollbackOn`.

Contoh:

```java
@Transactional(rollbackOn = BusinessRuleViolation.class)
public void submit(ApplicationSubmission command) throws BusinessRuleViolation {
    // if BusinessRuleViolation thrown, rollback
}
```

Atau:

```java
@Transactional(dontRollbackOn = NotificationFailure.class)
public void approve(UUID caseId) {
    // maybe database approval should remain committed even if notification fails
}
```

Namun hati-hati: `dontRollbackOn` sering menjadi code smell jika digunakan untuk menyembunyikan side effect yang salah tempat.

### Pertanyaan desain rollback

Sebelum menentukan rollback:

1. Apakah exception ini berarti state domain tidak valid?
2. Apakah data yang sudah ditulis masih boleh commit?
3. Apakah exception berasal dari external side effect?
4. Apakah retry akan memperbaiki?
5. Apakah user harus melihat operasi gagal total atau partial success?

---

## 9. Transaction Propagation

JTA transaction propagation mengatur apa yang terjadi jika method transactional memanggil method transactional lain.

Konsep umum:

| Mode | Makna umum |
|---|---|
| REQUIRED | Gunakan transaksi yang ada, atau buat baru jika belum ada |
| REQUIRES_NEW | Suspend transaksi lama, buat transaksi baru |
| MANDATORY | Harus sudah ada transaksi |
| SUPPORTS | Ikut transaksi jika ada, kalau tidak tetap jalan |
| NOT_SUPPORTED | Jalankan tanpa transaksi |
| NEVER | Error jika ada transaksi |

### REQUIRED

Default yang paling sering dipakai.

```java
@Transactional
public void approve() {
    updateCase();
    insertAudit();
}

@Transactional
public void updateCase() {}
```

Semua ikut transaksi yang sama.

### REQUIRES_NEW

Sering dipakai untuk audit/log tertentu, tetapi berbahaya jika tidak paham.

```java
@Transactional(REQUIRES_NEW)
public void writeAudit(AuditEvent event) {
    auditRepository.persist(event);
}
```

Jika outer transaction rollback, audit tetap commit.

Itu bisa benar untuk audit teknis tertentu, tetapi bisa salah jika audit harus mencerminkan perubahan state yang benar-benar terjadi.

### Design warning

```text
REQUIRES_NEW bukan alat untuk “memastikan data tersimpan”.
REQUIRES_NEW adalah deklarasi bahwa perubahan ini punya consistency boundary berbeda.
```

---

## 10. Flush, Commit, dan Timing Bug

Banyak developer menyamakan `persist()` dengan data sudah commit.

Padahal pada Hibernate ORM:

```text
persist/update entity
  -> entity masuk persistence context
  -> SQL bisa dikirim saat flush
  -> commit terjadi di akhir transaksi
```

Flush dapat terjadi:

- sebelum commit,
- sebelum query tertentu,
- saat explicit `flush()`,
- saat Hibernate perlu sinkronisasi persistence context.

### Contoh bug

```java
@Transactional
public void approve(UUID id) {
    CaseRecord c = repository.findById(id);
    c.approve();

    emailClient.sendApprovedEmail(c.getApplicantEmail());
}
```

Jika email terkirim, lalu commit gagal, user menerima email approval untuk approval yang tidak pernah commit.

Desain lebih aman:

```java
@Transactional
public void approve(UUID id) {
    CaseRecord c = repository.findById(id);
    c.approve();

    outboxRepository.persist(OutboxEvent.caseApproved(id));
}
```

Lalu worker terpisah publish email/event setelah commit.

---

## 11. Jangan Lakukan External IO di Dalam Transaksi

External IO meliputi:

- HTTP call,
- email,
- Kafka publish langsung,
- S3 upload,
- file operation besar,
- remote validation,
- payment gateway,
- identity provider call,
- notification service.

Kenapa berbahaya?

1. Menahan database lock lebih lama.
2. Timeout external membuat transaction timeout.
3. Commit bisa gagal setelah external side effect sukses.
4. Retry bisa mengulang side effect.
5. Thread/connection pool bisa habis.
6. Observability menjadi rumit.

### Rule of thumb

```text
Transaksi database harus berisi perubahan state lokal yang cepat dan deterministik.
External side effect sebaiknya keluar dari transaksi melalui outbox, saga, atau explicit compensation.
```

---

## 12. Transaction Timeout

Timeout adalah safety guard.

Tanpa timeout, transaksi lambat dapat:

- menahan lock,
- membuat connection pool habis,
- membuat request lain menumpuk,
- memperpanjang deadlock chain,
- memperbesar rollback cost,
- membuat autoscaling salah membaca beban.

### Timeout harus disesuaikan dengan use case

| Use case | Timeout mindset |
|---|---|
| Simple CRUD | pendek |
| Approval state transition | pendek-sedang |
| Bulk import | jangan satu transaksi besar; chunking |
| Report generation | jangan transactional write boundary |
| Scheduler cleanup | chunked transaction |
| Outbox publish mark-as-sent | kecil dan idempotent |

Top engineer tidak menaikkan timeout sebagai solusi pertama. Biasanya yang perlu diubah adalah shape transaksi.

---

## 13. Long Transaction adalah Smell

Long transaction biasanya muncul karena:

- loop besar dalam satu `@Transactional`,
- external API call di dalam transaksi,
- fetch terlalu banyak data,
- update banyak row tanpa chunking,
- pessimistic lock terlalu lama,
- user interaction menunggu state transactional,
- job batch ditulis seperti request biasa.

Contoh buruk:

```java
@Transactional
public void migrateAllCases() {
    List<CaseRecord> cases = repository.findAll().list();
    for (CaseRecord c : cases) {
        c.recalculateScore();
        externalRiskService.validate(c); // remote call inside tx
    }
}
```

Desain lebih sehat:

```text
1. Ambil batch kecil ID.
2. Untuk setiap chunk, buka transaksi pendek.
3. Update state lokal.
4. Simpan outbox jika perlu external effect.
5. Commit.
6. Worker/publisher proses side effect.
7. Simpan checkpoint job.
```

---

## 14. Optimistic Locking dan State Transition

Untuk domain workflow, optimistic locking sering lebih sehat daripada lock panjang.

Contoh entity:

```java
@Entity
public class CaseRecord {

    @Id
    UUID id;

    @Version
    long version;

    @Enumerated(EnumType.STRING)
    CaseStatus status;

    public void approve(OfficerId officerId) {
        if (status != CaseStatus.SUBMITTED) {
            throw new InvalidTransitionException(status, CaseStatus.APPROVED);
        }
        status = CaseStatus.APPROVED;
    }
}
```

Jika dua user mencoba approve/reject bersamaan:

```text
User A read version 7
User B read version 7
User A approve -> update where version = 7 -> success version 8
User B reject  -> update where version = 7 -> 0 row -> optimistic lock failure
```

Ini bagus karena:

- tidak perlu lock panjang,
- conflict eksplisit,
- user bisa diberi pesan “case sudah berubah”,
- audit bisa menunjukkan race condition.

---

## 15. Pessimistic Locking: Kapan Perlu?

Pessimistic locking bisa dipakai jika:

- double assignment harus dicegah kuat,
- sequence bisnis harus strict,
- resource kuota terbatas,
- financial reservation,
- seat/license allocation,
- concurrent update sangat tinggi dan optimistic retry mahal.

Namun lock harus pendek.

```java
public CaseRecord getForUpdate(UUID id) {
    return entityManager.find(
        CaseRecord.class,
        id,
        LockModeType.PESSIMISTIC_WRITE
    );
}
```

Risiko:

- blocking antar request,
- deadlock,
- lock wait timeout,
- poor tail latency,
- pool exhaustion.

### Invariant

```text
Pessimistic lock hanya aman jika critical section kecil, deterministik, dan tidak melakukan external IO.
```

---

## 16. Database Isolation vs Domain Correctness

Isolation level database tidak menggantikan domain invariant.

Contoh:

```text
Rule: satu applicant hanya boleh punya satu active application.
```

Jangan hanya mengandalkan kode:

```java
if (!repository.existsActive(applicantId)) {
    repository.persist(new Application(applicantId));
}
```

Di concurrency tinggi, dua transaksi bisa sama-sama melihat “belum ada”.

Solusi lebih kuat:

- unique constraint partial/function-based bila database mendukung,
- state table dengan lock,
- optimistic version pada aggregate root,
- serializable isolation hanya jika benar-benar perlu,
- explicit conflict handling.

Top engineer mendesain invariant di lapisan domain **dan** database.

---

## 17. Idempotency dan Retry Safety

Retry adalah sumber bug transaksi yang sangat umum.

Contoh:

```java
@Transactional
public ApprovalResult approve(UUID caseId, String requestId) {
    CaseRecord c = repository.findById(caseId);
    c.approve();
    outbox.persist(OutboxEvent.caseApproved(caseId));
    return ApprovalResult.ok();
}
```

Jika client timeout setelah commit, client retry. Tanpa idempotency:

- approval kedua mungkin gagal karena status sudah approved,
- audit bisa duplicate,
- outbox bisa duplicate,
- user mendapat error padahal operasi pertama sukses.

Desain idempotent:

```java
@Transactional
public ApprovalResult approve(ApproveCommand command) {
    IdempotencyRecord existing = idempotencyRepository.find(command.requestId());
    if (existing != null) {
        return existing.toResult();
    }

    CaseRecord c = caseRepository.findById(command.caseId());
    c.approve(command.officerId());

    OutboxEvent event = OutboxEvent.caseApproved(command.caseId(), command.requestId());
    outboxRepository.persist(event);

    IdempotencyRecord record = IdempotencyRecord.completed(command.requestId(), ApprovalResult.ok());
    idempotencyRepository.persist(record);

    return ApprovalResult.ok();
}
```

Tambahkan database unique constraint:

```sql
create unique index uq_idempotency_key on idempotency_record(request_id);
create unique index uq_outbox_event_key on outbox_event(event_key);
```

### Rule

```text
Semua operation yang bisa di-retry oleh client, queue, scheduler, atau circuit breaker harus punya idempotency story.
```

---

## 18. Outbox Pattern

Outbox pattern menyelesaikan masalah klasik:

> “Bagaimana menyimpan perubahan database dan memastikan event/message ikut terpublish tanpa distributed transaction?”

### Masalah tanpa outbox

```java
@Transactional
public void approve(UUID caseId) {
    caseRepository.approve(caseId);
    kafkaProducer.send("case-approved", event); // external side effect
}
```

Failure matrix:

| DB | Kafka | Hasil |
|---|---|---|
| commit success | publish success | OK |
| commit success | publish fail | DB berubah, event hilang |
| commit fail | publish success | Event palsu |
| timeout unknown | unknown | Sulit direkonsiliasi |

### Dengan outbox

```java
@Transactional
public void approve(UUID caseId) {
    CaseRecord c = caseRepository.findById(caseId);
    c.approve();

    outboxRepository.persist(new OutboxEvent(
        UUID.randomUUID(),
        "CaseApproved",
        caseId.toString(),
        toJsonPayload(c),
        OutboxStatus.PENDING
    ));
}
```

Satu transaksi lokal:

```text
update case + insert outbox event -> commit bersama
```

Publisher terpisah:

```java
@Scheduled(every = "1s")
void publishPendingEvents() {
    List<OutboxEvent> events = outboxRepository.claimBatch(100);
    for (OutboxEvent event : events) {
        try {
            publisher.publish(event.topic(), event.key(), event.payload());
            outboxRepository.markSent(event.id());
        } catch (Exception e) {
            outboxRepository.markFailedForRetry(event.id(), e);
        }
    }
}
```

### Outbox invariants

1. Domain update dan outbox insert harus satu transaksi.
2. Event punya unique id/event key.
3. Publisher harus idempotent.
4. Consumer harus idempotent.
5. Mark-as-sent harus hati-hati terhadap publish-success-mark-fail.
6. Monitoring pending/failed age wajib.
7. Payload harus versioned.
8. Replay harus aman.

---

## 19. Outbox Claiming Strategy

Publisher multi-instance perlu menghindari double processing.

Strategi umum:

```sql
select *
from outbox_event
where status = 'PENDING'
order by created_at
fetch first 100 rows only
for update skip locked;
```

Kemudian update status:

```text
PENDING -> PROCESSING -> SENT
                  -> FAILED_RETRYABLE
                  -> FAILED_DEAD
```

### State machine outbox

```text
PENDING
  -> PROCESSING
  -> SENT
  -> FAILED_RETRYABLE
       -> PENDING
       -> FAILED_DEAD
```

Jangan hanya punya boolean `sent`.

Boolean tidak cukup untuk:

- retry count,
- error reason,
- next retry time,
- stuck processing,
- dead-letter,
- replay,
- operational dashboard.

---

## 20. Transaction dan Audit Trail

Audit trail punya posisi khusus.

Ada beberapa jenis audit:

| Jenis audit | Harus atomic dengan domain change? |
|---|---|
| Business audit: case approved | Ya, biasanya harus commit bersama state domain |
| Security audit: login failed | Bisa punya boundary sendiri |
| Technical audit: notification retry failed | Boundary sendiri |
| Compliance audit: officer changed decision | Harus sangat konsisten dengan domain event |

Contoh business audit:

```java
@Transactional
public void approve(UUID caseId, OfficerId officerId) {
    CaseRecord c = repository.findById(caseId);
    c.approve(officerId);

    auditRepository.persist(AuditEvent.business(
        "CASE_APPROVED",
        caseId,
        officerId,
        c.version()
    ));
}
```

Jika case approval rollback, audit juga rollback.

Contoh security audit yang boundary sendiri:

```java
@Transactional(REQUIRES_NEW)
public void recordFailedLogin(String username, String ip) {
    securityAuditRepository.persist(SecurityAudit.failedLogin(username, ip));
}
```

Itu masuk akal karena failed login bukan bagian dari transaksi domain lain.

---

## 21. Reactive Transactions: Mental Model

Pada reactive persistence, transaksi bukan sekadar thread-bound call stack.

Blocking transaction:

```text
thread enters method
  transaction associated with thread/context
  method returns
  commit/rollback
```

Reactive transaction:

```text
pipeline starts
  async connection/session acquired
  async operations chained
  success -> commit
  failure -> rollback
```

Masalah besar:

```text
Jika kamu keluar dari reactive chain, kamu keluar dari transaction semantics.
```

Contoh buruk:

```java
@WithTransaction
public Uni<Void> approve(UUID id) {
    caseRepository.findById(id)
        .invoke(c -> c.approve()); // pipeline not returned correctly? dangerous if detached

    return Uni.createFrom().voidItem();
}
```

Contoh benar:

```java
@WithTransaction
public Uni<ApprovalResult> approve(UUID id) {
    return caseRepository.findById(id)
        .onItem().ifNull().failWith(() -> new NotFoundException("case not found"))
        .invoke(CaseRecord::approve)
        .chain(c -> outboxRepository.persist(OutboxEvent.caseApproved(c.id())))
        .replaceWith(ApprovalResult.ok());
}
```

---

## 22. Hibernate Reactive Transaction Patterns

Dengan Hibernate Reactive/Panache, pola umum:

```java
import io.quarkus.hibernate.reactive.panache.common.WithTransaction;
import io.smallrye.mutiny.Uni;

@ApplicationScoped
public class ReactiveCaseService {

    @WithTransaction
    public Uni<ApprovalResult> approve(UUID id) {
        return CaseEntity.<CaseEntity>findById(id)
            .onItem().ifNull().failWith(() -> new NotFoundException())
            .invoke(CaseEntity::approve)
            .chain(entity -> OutboxEntity.persist(caseApproved(entity)))
            .replaceWith(ApprovalResult.ok());
    }
}
```

Important:

- Jangan memanggil JDBC blocking di pipeline ini.
- Jangan melakukan blocking HTTP call di event loop.
- Jangan memecah chain dengan subscribe manual.
- Jangan menggunakan `@Transactional` blocking pattern secara tidak sadar pada reactive flow jika dokumentasi extension menuntut model tertentu.
- Pastikan return type reactive mewakili seluruh unit kerja.

Dokumentasi Quarkus menjelaskan bahwa Reactive SQL Clients mendukung transaksi melalui `SqlConnection#begin`, lalu commit/rollback secara asynchronous. Hibernate Reactive Quarkus juga menyediakan model transaksi reactive yang harus dipahami sebagai pipeline asynchronous, bukan method blocking biasa.

---

## 23. Reactive SQL Client Transaction Manual

Jika memakai Vert.x Reactive SQL Client langsung:

```java
public Uni<Void> transfer(UUID from, UUID to, BigDecimal amount) {
    return pool.withTransaction(conn ->
        debit(conn, from, amount)
            .chain(() -> credit(conn, to, amount))
            .replaceWithVoid()
    );
}
```

Atau secara lebih eksplisit:

```java
public Uni<Void> doWork() {
    return pool.getConnection()
        .chain(conn -> conn.begin()
            .chain(tx -> operation1(conn)
                .chain(() -> operation2(conn))
                .chain(() -> tx.commit())
                .onFailure().call(err -> tx.rollback())
            )
            .eventually(conn::close)
        );
}
```

Risiko manual transaction:

- lupa close connection,
- rollback tidak terpanggil di semua failure path,
- commit failure tidak tertangani,
- operasi tidak memakai connection yang sama,
- chain bercabang tanpa join,
- timeout tidak jelas.

Gunakan helper `withTransaction` jika tersedia dan sesuai.

---

## 24. Mixing Blocking dan Reactive Transaction

Ini salah satu sumber bug Quarkus paling serius.

Contoh buruk:

```java
@WithTransaction
public Uni<Void> approve(UUID id) {
    return reactiveRepo.findById(id)
        .invoke(entity -> {
            blockingAuditRepository.persist(...); // JDBC blocking inside reactive transaction
        })
        .replaceWithVoid();
}
```

Masalah:

- blocking call bisa berjalan di event loop,
- menggunakan transaction manager berbeda,
- connection berbeda,
- rollback tidak satu boundary,
- deadlock/pool starvation,
- observability kacau.

Jika harus bridge blocking dengan reactive:

1. Pisahkan boundary.
2. Gunakan outbox.
3. Jalankan blocking di worker/virtual thread yang benar.
4. Jangan klaim atomic jika bukan atomic.

---

## 25. Transaction + REST Response Serialization

Salah satu bug umum: entity dikembalikan langsung dari method transactional.

```java
@GET
@Path("/{id}")
@Transactional
public CaseEntity get(UUID id) {
    return repository.findById(id);
}
```

Masalah potensial:

- serialization bisa terjadi setelah transaksi selesai,
- lazy relation bisa gagal,
- response contract bocor entity internal,
- data masking lemah,
- recursive serialization,
- native image reflection/serialization issue.

Desain lebih aman:

```java
@GET
@Path("/{id}")
public CaseResponse get(UUID id) {
    return queryService.getCase(id);
}

@ApplicationScoped
public class CaseQueryService {

    @Transactional
    public CaseResponse getCase(UUID id) {
        CaseEntity entity = repository.findById(id);
        return CaseResponse.from(entity); // DTO built inside transaction
    }
}
```

Atau gunakan projection query.

---

## 26. Transaction Boundary untuk Read Operation

Read operation tidak selalu butuh transaksi eksplisit, tetapi sering tetap membutuhkan consistency context.

Pertanyaan:

- Apakah read membutuhkan repeatable view?
- Apakah lazy loading dipakai?
- Apakah query terdiri dari beberapa query yang harus konsisten?
- Apakah DTO dibangun dari beberapa table?
- Apakah read harus audit?
- Apakah read-only transaction membantu database/ORM?

Untuk query sederhana, non-transactional bisa cukup.

Untuk query kompleks dengan lazy mapping, explicit read transaction bisa lebih predictable.

Namun jangan membuat read transaction panjang untuk streaming response besar.

---

## 27. Transaction Boundary untuk Batch/Job

Batch/job harus jarang memakai satu transaksi besar.

Buruk:

```java
@Transactional
public void processAll() {
    for (Item item : repository.findAll().list()) {
        process(item);
    }
}
```

Lebih sehat:

```text
while has next chunk:
  tx begin
    claim 100 rows
    process local state
    insert outbox
  tx commit
  publish external effects separately
```

Contoh service:

```java
public void runJob() {
    while (true) {
        int processed = transactionRunner.processOneChunk(100);
        if (processed == 0) break;
    }
}

@ApplicationScoped
public class JobTransactionRunner {

    @Transactional
    public int processOneChunk(int size) {
        List<JobItem> items = repository.claimPending(size);
        for (JobItem item : items) {
            item.markProcessed();
        }
        return items.size();
    }
}
```

---

## 28. Programmatic Transaction: QuarkusTransaction

Selain annotation, Quarkus juga menyediakan pendekatan programmatic transaction.

Kapan berguna?

- butuh boundary kecil di dalam flow besar,
- butuh retry per chunk,
- scheduler/job,
- testing setup,
- operasi administratif,
- menghindari self-invocation problem,
- dynamic transaction behavior.

Contoh konseptual:

```java
QuarkusTransaction.requiringNew().run(() -> {
    repository.persist(record);
});
```

Gunakan dengan disiplin. Programmatic transaction yang tersebar tanpa desain bisa lebih sulit dipahami daripada annotation.

---

## 29. XA / Distributed Transaction: Jangan Dijadikan Default

XA memungkinkan transaction manager mengoordinasikan beberapa resource transactional.

Namun dalam microservice/cloud-native system, XA sering membawa masalah:

- konfigurasi rumit,
- latency tinggi,
- coupling antar resource,
- recovery kompleks,
- sulit dioperasikan di container/Kubernetes,
- tidak berlaku untuk banyak external API modern,
- mengurangi availability.

Gunakan XA hanya jika:

- resource mendukung penuh,
- kebutuhan atomic sangat kuat,
- volume/latency dapat diterima,
- operational recovery dipahami,
- tidak ada desain outbox/saga yang lebih sehat.

Untuk banyak sistem microservice, pilihan lebih umum:

```text
local transaction + outbox + idempotent consumer + saga/compensation
```

---

## 30. Saga dan Compensation

Saga digunakan saat satu business process melewati beberapa service/resource.

Contoh:

```text
Submit Application
  -> reserve payment
  -> assign officer
  -> request external screening
  -> send notification
```

Tidak realistis membungkus semua ini dalam satu database transaction.

Saga approach:

```text
Step 1 local tx: create application SUBMITTED
Step 2 local tx: create payment reservation request outbox
Step 3 local tx: receive payment reserved event
Step 4 local tx: assign officer
Step 5 local tx: send screening request
...
```

Jika gagal:

```text
Payment reserved but screening fails
  -> compensate payment reservation
  -> mark application NEEDS_REVIEW / FAILED_SCREENING_INITIATION
```

### Saga invariant

```text
Saga bukan rollback distributed transaction.
Saga adalah state machine eksplisit untuk proses bisnis yang dapat gagal sebagian.
```

---

## 31. Transaction State Machine untuk Regulatory Workflow

Untuk case management/regulatory domain, transaction design harus mendukung:

- state transition yang eksplisit,
- actor yang jelas,
- reason/comment,
- audit trail,
- authorization check,
- optimistic concurrency,
- side-effect outbox,
- evidence reconstruction,
- idempotent command.

Contoh command handling:

```java
@Transactional
public DecisionResult decide(DecisionCommand command) {
    IdempotencyRecord previous = idempotency.find(command.requestId());
    if (previous != null) return previous.resultAs(DecisionResult.class);

    CaseRecord c = caseRepository.get(command.caseId());

    authorization.assertCanDecide(command.officerId(), c);

    c.applyDecision(command.decision(), command.reason());

    auditRepository.persist(AuditEvent.caseDecision(
        command.caseId(),
        command.officerId(),
        command.decision(),
        command.reason(),
        c.version()
    ));

    outboxRepository.persist(OutboxEvent.caseDecisionApplied(
        command.caseId(),
        command.requestId(),
        c.version()
    ));

    DecisionResult result = DecisionResult.accepted(c.status(), c.version());
    idempotency.persist(command.requestId(), result);

    return result;
}
```

Ini bukan sekadar CRUD. Ini transaction boundary yang mengikat:

- idempotency,
- authorization,
- state machine,
- audit,
- outbox,
- optimistic version,
- result reconstruction.

---

## 32. Anti-Pattern: Transaction Script Tanpa Domain Boundary

Buruk:

```java
@Transactional
public void updateStatus(UUID id, String status) {
    CaseEntity c = repository.findById(id);
    c.status = status;
    auditRepository.persist(new Audit("status updated"));
}
```

Masalah:

- semua status boleh masuk,
- tidak ada state transition rule,
- tidak ada actor check,
- audit miskin konteks,
- tidak ada idempotency,
- tidak ada event version,
- tidak ada invariant.

Lebih baik:

```java
@Transactional
public void approve(ApproveCommand command) {
    CaseRecord c = repository.get(command.caseId());
    c.approve(command.officerId(), command.reason());
    auditRepository.persist(AuditEvent.approved(...));
    outboxRepository.persist(OutboxEvent.caseApproved(...));
}
```

Method name mengikuti business transition, bukan generic data mutation.

---

## 33. Anti-Pattern: Repository Mengontrol Semua Transaksi

Buruk:

```java
@Transactional
public void saveCase(CaseEntity c) { ... }

@Transactional
public void saveAudit(AuditEntity a) { ... }

@Transactional
public void saveTask(TaskEntity t) { ... }
```

Lalu service:

```java
public void approve(UUID id) {
    repo.saveCase(c);
    auditRepo.saveAudit(a);
    taskRepo.saveTask(t);
}
```

Masing-masing method bisa commit sendiri. Jika task gagal, case dan audit mungkin sudah commit.

Lebih baik:

```java
@Transactional
public void approve(UUID id) {
    repo.saveCase(c);
    auditRepo.saveAudit(a);
    taskRepo.saveTask(t);
}
```

Repository tidak menentukan use case transaction boundary.

---

## 34. Anti-Pattern: Retry di Dalam Transaksi Tanpa Idempotency

Buruk:

```java
@Transactional
@Retry(maxRetries = 3)
public void approve(UUID id) {
    caseRepository.approve(id);
    auditRepository.persist(...);
}
```

Masalah:

- retry bisa mengulang operasi non-idempotent,
- optimistic lock failure mungkin butuh re-read bukan blind retry,
- duplicate audit/outbox,
- exception bisa berarti business conflict, bukan transient failure.

Retry harus berdasarkan jenis failure:

| Failure | Retry? |
|---|---|
| transient DB connection failure before commit | mungkin |
| lock timeout | mungkin dengan backoff dan idempotency |
| optimistic lock | biasanya re-read atau return conflict |
| invalid state transition | tidak |
| authorization failure | tidak |
| unique constraint idempotency duplicate | return previous result |

---

## 35. Anti-Pattern: Menyembunyikan Transaction Failure dengan Catch-All

Buruk:

```java
@Transactional
public void approve(UUID id) {
    try {
        caseRepository.approve(id);
        auditRepository.persist(...);
    } catch (Exception e) {
        log.warn("failed", e);
    }
}
```

Masalah:

- method selesai normal,
- transaction mungkin commit meskipun sebagian logic gagal,
- error contract hilang,
- data korup secara domain.

Lebih baik:

```java
@Transactional
public void approve(UUID id) {
    try {
        caseRepository.approve(id);
        auditRepository.persist(...);
    } catch (RecoverableAuditException e) {
        throw new DomainOperationFailedException("approval audit failed", e);
    }
}
```

Atau pisahkan audit teknis ke outbox/boundary berbeda jika memang boleh tidak atomic.

---

## 36. Exception Taxonomy untuk Transaction Engineering

Buat taxonomy exception yang menentukan rollback dan response.

Contoh:

```text
DomainConflictException
  - invalid transition
  - stale version
  - duplicate active application
  -> rollback, HTTP 409

ValidationException
  -> rollback/no mutation, HTTP 400

AuthorizationException
  -> rollback/no mutation, HTTP 403

DependencyTransientException
  -> rollback, retry maybe

ExternalSideEffectException
  -> ideally not inside tx

SystemFailureException
  -> rollback, HTTP 500
```

Jangan semua exception dianggap sama.

---

## 37. Transaction Observability

Transaction bug sering tidak terlihat dari log biasa.

Observability minimal:

- transaction duration,
- slow transaction log,
- lock wait timeout,
- deadlock count,
- connection acquisition time,
- pool usage,
- rollback count,
- commit failure count,
- optimistic lock conflict count,
- idempotency duplicate count,
- outbox pending count,
- outbox oldest pending age,
- outbox failed/dead count,
- retry count,
- transaction timeout count.

### Log context

Setiap command mutasi penting harus punya:

```text
correlation_id
request_id / idempotency_key
actor_id
aggregate_id
aggregate_version_before
aggregate_version_after
transition
transaction_result
outbox_event_id
```

---

## 38. Testing Transaction Semantics

Jangan hanya test happy path.

Test minimal:

1. Commit success.
2. Rollback saat domain exception.
3. Rollback saat persistence exception.
4. Checked exception rollback policy.
5. Optimistic lock conflict.
6. Duplicate idempotency key.
7. Outbox inserted atomically.
8. External publisher tidak dipanggil sebelum commit.
9. Retry tidak membuat duplicate audit.
10. Scheduler chunk tidak memproses row sama di multi-instance.
11. Transaction timeout behavior.
12. Deadlock/lock wait simulation bila domain rawan.

Contoh test ide:

```java
@Test
void approvalRollbackShouldNotCreateOutbox() {
    assertThrows(InvalidTransitionException.class, () -> {
        service.approve(invalidCommand);
    });

    assertThat(outboxRepository.count()).isEqualTo(0);
    assertThat(auditRepository.count()).isEqualTo(0);
}
```

---

## 39. Transaction Design Checklist

Sebelum menulis `@Transactional`, jawab:

1. Apa aggregate/state utama yang dilindungi?
2. Apa invariant bisnisnya?
3. Apa saja table yang harus commit bersama?
4. Apakah ada external IO? Jika ya, kenapa tidak outbox?
5. Apakah operation bisa di-retry?
6. Apa idempotency key-nya?
7. Apa rollback semantics untuk setiap exception?
8. Apakah optimistic lock cukup?
9. Apakah perlu pessimistic lock?
10. Berapa timeout yang wajar?
11. Apakah transaction berisi loop besar?
12. Apakah method dipanggil melalui CDI proxy?
13. Apakah serialization terjadi setelah transaksi selesai?
14. Apakah audit atomic dengan domain change?
15. Apakah event downstream versioned?
16. Bagaimana monitoring outbox?
17. Bagaimana recovery jika commit unknown?
18. Bagaimana runbook incident-nya?

---

## 40. Production Checklist

Untuk production Quarkus service:

- `@Transactional` berada di use case boundary yang jelas.
- Repository tidak diam-diam membuat boundary transaksi domain.
- Tidak ada HTTP/email/Kafka direct publish di dalam database transaction kecuali sudah dianalisis secara eksplisit.
- Outbox dipakai untuk side effect penting.
- Outbox punya state machine, retry count, next retry time, error reason, dan dead-letter handling.
- Semua command mutasi penting punya idempotency key.
- Optimistic locking dipakai untuk aggregate yang bisa diedit paralel.
- Pessimistic locking hanya dipakai untuk critical section pendek.
- Transaction timeout dikonfigurasi dan diuji.
- Rollback semantics untuk checked exception jelas.
- Reactive transaction tidak dicampur sembarangan dengan blocking repository.
- Query DTO dibentuk di dalam boundary yang benar.
- Metrics untuk rollback, timeout, lock wait, outbox pending, dan retry tersedia.
- Tests mencakup rollback, duplicate request, conflict, dan publisher failure.
- Runbook tersedia untuk stuck transaction/outbox/deadlock.

---

## 41. Mini Case Study: Approval Workflow dengan Audit dan Notification

### Requirement

Saat officer approve application:

1. Status application berubah dari `SUBMITTED` ke `APPROVED`.
2. Audit trail tercatat.
3. Event `ApplicationApproved` dikirim ke downstream.
4. Email dikirim ke applicant.
5. Jika request retry karena timeout, tidak boleh duplicate approval/audit/email.

### Desain buruk

```java
@Transactional
public void approve(UUID applicationId) {
    appRepository.approve(applicationId);
    auditRepository.persist(...);
    kafka.send(...);
    email.send(...);
}
```

Failure:

- Kafka/email terkirim tapi commit gagal.
- Commit sukses tapi Kafka gagal.
- Email timeout membuat DB rollback.
- Retry duplicate side effect.

### Desain sehat

```java
@Transactional
public ApprovalResult approve(ApproveApplicationCommand command) {
    IdempotencyRecord existing = idempotency.find(command.requestId());
    if (existing != null) {
        return existing.asApprovalResult();
    }

    Application app = appRepository.get(command.applicationId());
    app.approve(command.officerId(), command.reason());

    auditRepository.persist(AuditEvent.applicationApproved(
        app.id(), command.officerId(), command.reason(), app.version()
    ));

    outboxRepository.persist(OutboxEvent.applicationApproved(
        app.id(), command.requestId(), app.version()
    ));

    ApprovalResult result = ApprovalResult.approved(app.id(), app.version());
    idempotency.persist(command.requestId(), result);

    return result;
}
```

Outbox publisher:

```text
publish ApplicationApproved
  -> notification service consumes event
  -> sends email idempotently using event id
```

### Result

| Failure | Outcome |
|---|---|
| DB rollback | no audit, no outbox, no email |
| Outbox publish fail | DB state safe, retry publish later |
| Email fail | notification retry independent |
| Client retry | same result returned via idempotency |
| Duplicate event | consumer dedup by event id |

---

## 42. Latihan Top 1% Engineer

Ambil satu use case mutasi dari sistem nyata, misalnya:

- approve case,
- reject case,
- assign officer,
- submit application,
- cancel renewal,
- trigger screening,
- mark payment received.

Untuk use case itu, tulis:

1. Command object.
2. Aggregate yang berubah.
3. Invariant domain.
4. Transaction boundary.
5. Tables yang commit bersama.
6. Audit event.
7. Outbox event.
8. Idempotency key.
9. Optimistic/pessimistic lock decision.
10. Rollback rules.
11. Retry policy.
12. Metrics.
13. Failure matrix.
14. Test cases.
15. Recovery runbook.

Kalau kamu bisa menjawab 15 poin itu, kamu bukan sekadar memakai transaction. Kamu sedang melakukan transaction engineering.

---

## 43. Ringkasan Invariants

Pegang invariants ini:

```text
1. Transaction boundary adalah consistency boundary.
2. Jangan memasukkan external IO ke database transaction tanpa alasan kuat.
3. Repository bukan pemilik use case transaction boundary.
4. Outbox adalah bridge paling umum antara local transaction dan distributed event.
5. Retry tanpa idempotency adalah bug yang belum terjadi.
6. Long transaction adalah operational risk.
7. Optimistic lock cocok untuk banyak workflow domain.
8. Pessimistic lock harus pendek dan deterministik.
9. Reactive transaction harus hidup dalam reactive chain.
10. XA bukan default microservice strategy.
11. Audit harus diklasifikasikan: business audit, security audit, technical audit.
12. Rollback semantics harus eksplisit, bukan asumsi.
13. Transaction observability wajib untuk production.
14. Top engineer mendesain failure semantics sebelum menulis anotasi.
```

---

## 44. Referensi Resmi yang Relevan

- Quarkus Transaction Guide — `quarkus-narayana-jta`, Jakarta Transactions, declarative/programmatic transaction.
- Quarkus Hibernate ORM Guide — transaction boundary untuk ORM blocking.
- Quarkus Datasource Guide — integrasi datasource dengan Narayana/JTA.
- Quarkus Reactive SQL Clients Guide — transaksi asynchronous dengan reactive SQL client.
- Quarkus Hibernate Reactive Guide — transaction model untuk Hibernate Reactive.
- Quarkus Mutiny Primer — reactive chain dan failure handling.

---

## 45. Penutup Part 013

Part ini mengubah cara melihat transaksi:

```text
Beginner: “Tambahkan @Transactional supaya save berhasil.”
Intermediate: “Pastikan rollback kalau exception.”
Advanced: “Letakkan boundary di service.”
Top-tier: “Desain consistency boundary, idempotency, outbox, retry, audit, lock, timeout, dan recovery sebagai satu kesatuan.”
```

Quarkus memberikan alat: Narayana, `@Transactional`, reactive transaction API, Hibernate ORM, Hibernate Reactive, SQL clients, scheduler, messaging, dan observability.

Tetapi alat itu hanya aman jika kamu memahami batasnya.

Transaction engineering yang matang membuat sistem:

- lebih konsisten,
- lebih mudah dipulihkan,
- lebih bisa diaudit,
- lebih tahan retry,
- lebih aman saat concurrency tinggi,
- lebih siap untuk microservice dan workflow panjang.

---

# Status Seri

Part 013 selesai.  
Seri belum selesai / belum mencapai bagian terakhir.

Part berikutnya:

> Part 014 — Validation, Serialization, DTO, and API Contract Engineering


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-012.md">⬅️ Part 012 — Persistence III: Hibernate Reactive, Reactive SQL Clients, dan Transaction Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-014.md">Part 014 — Validation, Serialization, DTO, and API Contract Engineering ➡️</a>
</div>
