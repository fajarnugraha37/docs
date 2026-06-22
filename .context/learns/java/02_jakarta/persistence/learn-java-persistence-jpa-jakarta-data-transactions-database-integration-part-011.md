# Part 011 — Transaction Boundary Design in Real Applications

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Part: `011`  
> Topik: Transaction boundary design, service boundary, external side effect, messaging, batch job, idempotency, failure matrix  
> Rentang Java: Java 8 sampai Java 25  
> Namespace relevan: `javax.persistence`, `jakarta.persistence`, `javax.transaction`, `jakarta.transaction`, Spring `@Transactional`, Hibernate ORM

---

## 1. Tujuan Pembelajaran

Di part sebelumnya kita membahas transaction secara fundamental: ACID, local transaction, JPA transaction, Jakarta Transactions/JTA, resource manager, transaction manager, flush, commit, rollback, propagation dasar, dan perbedaan annotation transaction.

Part ini menjawab pertanyaan yang jauh lebih sulit:

> Di aplikasi nyata, **di mana transaction harus dimulai dan di mana harus berakhir?**

Ini terdengar sederhana, tetapi di production banyak incident persistence bukan terjadi karena developer tidak tahu `@Transactional`, melainkan karena transaction boundary keliru.

Contoh gejalanya:

- request lambat karena transaction menunggu external API;
- deadlock karena terlalu banyak operasi digabung dalam satu transaction;
- data tidak konsisten karena operasi yang seharusnya atomik malah dipisah;
- email terkirim padahal database rollback;
- database commit berhasil tetapi message gagal publish;
- retry menciptakan duplicate record;
- `REQUIRES_NEW` dipakai untuk “memperbaiki” bug tapi malah membuat audit tidak sinkron;
- long-running batch job menahan lock terlalu lama;
- `@Transactional` diletakkan di repository, controller, helper, listener, dan scheduler tanpa ownership yang jelas;
- service method terlihat reusable tetapi behavior transaction-nya berubah tergantung caller.

Setelah menyelesaikan bagian ini, kamu seharusnya mampu:

1. Menentukan transaction boundary berdasarkan **use case**, bukan berdasarkan method yang kebetulan mengakses database.
2. Membedakan operasi yang harus atomik dan operasi yang cukup eventual consistent.
3. Mendesain boundary untuk web request, message consumer, scheduler, batch job, dan workflow/state machine.
4. Menghindari external side effect di dalam transaction secara membabi buta.
5. Memahami kapan `REQUIRES_NEW`, `NESTED`, `NOT_SUPPORTED`, dan split transaction benar-benar masuk akal.
6. Membuat failure matrix untuk skenario commit, rollback, timeout, retry, message publishing, email, cache, dan external API.
7. Mendesain idempotency, outbox, inbox, dan compensation sebagai konsekuensi dari transaction boundary.
8. Melihat transaction sebagai **correctness design tool**, bukan sekadar technical annotation.

---

## 2. Mental Model: Transaction Boundary adalah Boundary Perubahan yang Harus Konsisten

Transaction boundary adalah garis yang menjawab:

> Perubahan mana yang harus berhasil bersama, gagal bersama, dan terlihat konsisten bersama?

Dalam aplikasi enterprise, satu use case sering terdiri dari beberapa jenis efek:

1. **Database write**
   - insert application;
   - update case status;
   - create audit trail;
   - reserve quota;
   - update assignment;
   - insert outbox event.

2. **Database read**
   - read current state;
   - check duplicate;
   - check role/authorization;
   - compute next workflow transition;
   - load reference data.

3. **External side effect**
   - call external API;
   - send email;
   - publish message;
   - upload document;
   - call payment gateway;
   - call identity provider;
   - update search index;
   - invalidate cache.

4. **In-memory computation**
   - validation;
   - mapping;
   - scoring;
   - policy evaluation;
   - routing decision.

Transaction database hanya bisa benar-benar mengontrol operasi yang berada di dalam resource transaction yang sama. External side effect biasanya **tidak ikut rollback**.

Maka transaction boundary design selalu berurusan dengan pertanyaan:

- Apa yang harus atomik?
- Apa yang boleh eventual?
- Apa yang bisa diulang?
- Apa yang tidak boleh diulang?
- Apa yang harus tercatat sebelum side effect keluar?
- Apa yang harus terjadi setelah commit?
- Apa yang harus dilakukan bila commit berhasil tetapi response gagal?
- Apa yang harus dilakukan bila external API berhasil tetapi database rollback?
- Apa yang harus dilakukan bila request dikirim ulang?

### 2.1 Transaction Bukan “Selama Method Service Berjalan”

Kesalahan umum:

```java
@Transactional
public SubmitApplicationResponse submit(SubmitApplicationCommand command) {
    validate(command);
    Application app = createApplication(command);
    applicationRepository.save(app);

    myInfoClient.fetchProfile(command.singpassId()); // external call inside transaction
    documentClient.upload(command.documents());      // external call inside transaction
    emailClient.sendSubmissionEmail(app.getEmail()); // side effect inside transaction

    auditRepository.save(Audit.submitted(app));
    return response(app);
}
```

Secara teknis ini bisa jalan. Secara desain, ini mencampur:

- database transaction;
- network latency;
- external availability;
- side effect yang tidak rollback;
- audit correctness;
- user response.

Bila `emailClient.sendSubmissionEmail()` berhasil tetapi `auditRepository.save()` gagal, email sudah terkirim padahal transaction rollback.

Bila `myInfoClient.fetchProfile()` timeout selama 30 detik, database connection dan transaction ikut tertahan.

Bila request retry, mungkin dokumen terupload dua kali.

Jadi boundary yang benar bukan “seluruh method harus transactional”, melainkan “bagian mana yang memang perlu atomic persistence”.

### 2.2 Transaction Boundary Seharusnya Mengikuti Invariant

Invariant adalah aturan yang tidak boleh dilanggar.

Contoh:

- application hanya boleh submitted sekali;
- case status tidak boleh melompat dari `DRAFT` langsung ke `APPROVED`;
- officer hanya boleh approve jika case assigned kepadanya;
- payment reference harus unik;
- satu user tidak boleh memiliki dua active application untuk license yang sama;
- audit trail untuk state transition harus ada bila state berubah;
- outbox event harus tercatat bila status berubah.

Transaction boundary harus mencakup perubahan yang menjaga invariant tersebut.

Misalnya:

```text
Use case: Submit application

Harus atomik:
- validate current application state is DRAFT
- update status to SUBMITTED
- assign submission number
- persist submission timestamp
- create audit trail
- create outbox event APPLICATION_SUBMITTED

Boleh eventual:
- send email notification
- update search index
- trigger downstream workflow
- generate PDF acknowledgement
```

Boundary database transaction sebaiknya mencakup kelompok pertama. Kelompok kedua sebaiknya terjadi setelah commit melalui outbox/asynchronous processing.

---

## 3. Core Principle: One Transaction Should Protect One Consistency Decision

Rule praktis:

> Satu transaction seharusnya melindungi satu keputusan konsistensi yang jelas.

Bukan berarti satu transaction hanya boleh update satu table. Boleh update banyak table, selama semua perubahan tersebut adalah bagian dari satu keputusan konsistensi.

Contoh bagus:

```text
Decision: approve case

Within one transaction:
- lock/load case
- verify current status = UNDER_REVIEW
- verify officer assignment
- set status = APPROVED
- persist approval decision
- persist audit trail
- persist outbox event CASE_APPROVED
```

Contoh buruk:

```text
One transaction:
- approve case
- generate PDF
- upload PDF to document service
- call external license registry
- send email
- refresh dashboard cache
- write analytics event
- call payment system
```

Yang kedua bukan satu consistency decision. Itu orchestration besar dengan banyak resource, latency, dan failure mode berbeda.

---

## 4. Transaction Boundary dalam Layered Architecture

### 4.1 Controller Bukan Tempat Ideal untuk Transaction

Controller mengelola HTTP concern:

- request parsing;
- authentication principal;
- response status;
- header;
- serialization;
- error mapping.

Controller biasanya tidak punya cukup konteks untuk menentukan invariant domain.

Anti-pattern:

```java
@RestController
class CaseController {

    @Transactional
    @PostMapping("/cases/{id}/approve")
    public CaseResponse approve(@PathVariable Long id) {
        Case c = caseRepository.findById(id).orElseThrow();
        c.approve();
        emailService.sendApproved(c); // mixed with HTTP boundary
        return mapper.toResponse(c);
    }
}
```

Masalah:

- transaction melekat pada HTTP endpoint, bukan use case;
- reuse dari scheduler/message consumer menjadi sulit;
- external side effect rawan masuk transaction;
- response mapping bisa memicu lazy loading;
- authorization dan invariant sering tersebar.

Lebih baik:

```java
@RestController
class CaseController {

    private final ApproveCaseUseCase approveCase;

    @PostMapping("/cases/{id}/approve")
    public CaseResponse approve(@PathVariable Long id, @AuthenticationPrincipal UserPrincipal user) {
        ApprovalResult result = approveCase.approve(new ApproveCaseCommand(id, user.userId()));
        return CaseResponse.from(result);
    }
}
```

Transaction berada di use case/application service.

### 4.2 Repository Bukan Pemilik Transaction Boundary

Repository mengelola persistence operation, bukan use case consistency.

Anti-pattern:

```java
class CaseRepository {

    @Transactional
    public void approve(Long caseId) {
        Case c = entityManager.find(Case.class, caseId);
        c.approve();
    }
}
```

Masalah:

- repository tidak tahu audit harus dibuat;
- repository tidak tahu outbox harus dibuat;
- repository tidak tahu authorization;
- repository method menjadi mini use case tersembunyi;
- transaction dipotong terlalu kecil.

Repository boleh dipanggil dalam transaction, tetapi bukan pemilik utama boundary.

### 4.3 Application Service / Use Case adalah Tempat Umum Transaction Boundary

Pola yang biasanya sehat:

```java
@Service
public class ApproveCaseUseCase {

    private final CaseRepository caseRepository;
    private final AuditTrailRepository auditTrailRepository;
    private final OutboxRepository outboxRepository;
    private final AuthorizationPolicy authorizationPolicy;

    @Transactional
    public ApprovalResult approve(ApproveCaseCommand command) {
        CaseEntity c = caseRepository.findForUpdateOrOptimistic(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

        authorizationPolicy.assertCanApprove(command.userId(), c);

        c.approve(command.userId());

        auditTrailRepository.save(AuditTrail.caseApproved(c, command.userId()));
        outboxRepository.save(OutboxEvent.caseApproved(c.id(), c.version()));

        return ApprovalResult.from(c);
    }
}
```

Karakteristik:

- satu method = satu use case;
- transaction mencakup invariant utama;
- external side effect tidak dilakukan langsung;
- event disimpan sebagai data dalam transaction;
- handler setelah commit bisa mengirim email/message.

---

## 5. Transaction Boundary dan Domain Model

Ada dua gaya umum.

### 5.1 Transaction Script Style

Service method mengatur alur secara eksplisit:

```java
@Transactional
public void approve(Long caseId, Long officerId) {
    CaseEntity c = caseRepository.get(caseId);

    if (!c.getStatus().equals(CaseStatus.UNDER_REVIEW)) {
        throw new InvalidCaseStateException();
    }

    if (!assignmentRepository.isAssignedTo(caseId, officerId)) {
        throw new NotAssignedException();
    }

    c.setStatus(CaseStatus.APPROVED);
    c.setApprovedBy(officerId);
    c.setApprovedAt(clock.instant());

    auditRepository.save(...);
}
```

Kelebihan:

- sederhana;
- eksplisit;
- mudah untuk CRUD/workflow ringan.

Kekurangan:

- invariant bisa tersebar;
- entity menjadi data container;
- duplicated transition logic.

### 5.2 Rich Domain / Aggregate Style

Entity/aggregate menjaga invariant internal:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseEntity c = caseRepository.get(command.caseId());
    c.approve(command.officerId(), clock.instant());

    auditRepository.save(AuditTrail.from(c.pullDomainEvents()));
    outboxRepository.save(OutboxEvent.from(c.pullDomainEvents()));
}
```

Entity:

```java
@Entity
public class CaseEntity {

    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    @Version
    private long version;

    public void approve(Long officerId, Instant now) {
        if (status != CaseStatus.UNDER_REVIEW) {
            throw new InvalidCaseStateException(status, CaseStatus.APPROVED);
        }
        this.status = CaseStatus.APPROVED;
        this.approvedBy = officerId;
        this.approvedAt = now;
        registerEvent(new CaseApprovedEvent(id, officerId, now));
    }
}
```

Kelebihan:

- invariant dekat dengan state;
- transition lebih sulit disalahgunakan;
- cocok untuk case management/state machine.

Kekurangan:

- entity JPA perlu dijaga agar tidak terlalu bergantung ke infrastructure;
- domain events perlu dikelola hati-hati;
- lazy loading dari entity method bisa menjadi jebakan.

Keduanya valid. Yang penting: transaction boundary tetap berada di use case yang mengorkestrasi perubahan atomik.

---

## 6. Transaction Boundary by Use Case Type

### 6.1 Create Use Case

Contoh: create application draft.

Biasanya transaction mencakup:

- validate business uniqueness;
- create root entity;
- create initial child records;
- create audit trail;
- create outbox event jika perlu.

Risiko utama:

- duplicate request;
- unique constraint race;
- generated id timing;
- external reference generation;
- document upload coupling.

Pattern:

```java
@Transactional
public CreateApplicationResult create(CreateApplicationCommand command) {
    idempotencyService.assertNotProcessed(command.idempotencyKey());

    applicationRepository.assertNoActiveApplication(command.applicantId(), command.licenseType());

    ApplicationEntity app = ApplicationEntity.createDraft(command, clock.instant());
    applicationRepository.save(app);

    auditRepository.save(AuditTrail.applicationCreated(app));
    idempotencyService.markProcessed(command.idempotencyKey(), app.id());

    return CreateApplicationResult.from(app);
}
```

Tetapi `assertNoActiveApplication()` harus didukung unique constraint/locking, bukan hanya query pre-check.

### 6.2 Update Use Case

Contoh: update draft application.

Transaction mencakup:

- load current entity;
- verify editable state;
- apply patch;
- validate invariant;
- save audit/change log;
- update version.

Risiko:

- lost update;
- stale browser form;
- detached entity overwrite;
- partial update accidentally nulling fields.

Pattern:

```java
@Transactional
public void updateDraft(UpdateDraftCommand command) {
    ApplicationEntity app = applicationRepository.get(command.applicationId());
    app.assertEditableBy(command.userId());
    app.updateDraft(command.patch(), clock.instant());
    auditRepository.save(AuditTrail.draftUpdated(app, command.userId()));
}
```

Gunakan `@Version` untuk conflict detection.

### 6.3 State Transition Use Case

Contoh: submit, assign, approve, reject, escalate.

Transaction mencakup:

- load current state;
- verify transition allowed;
- verify actor/role;
- update state;
- persist decision reason;
- persist audit trail;
- persist outbox event.

Pattern:

```java
@Transactional
public void transition(TransitionCommand command) {
    CaseEntity c = caseRepository.get(command.caseId());

    c.transitionTo(
        command.targetState(),
        command.actorId(),
        command.reason(),
        clock.instant()
    );

    auditRepository.save(AuditTrail.stateTransition(c, command));
    outboxRepository.save(OutboxEvent.stateChanged(c.id(), c.status(), c.version()));
}
```

State transition adalah salah satu use case paling penting untuk transaction boundary karena invariant-nya kuat.

### 6.4 Delete Use Case

Delete biasanya lebih rumit daripada terlihat.

Pertanyaan:

- hard delete atau soft delete?
- boleh delete jika sudah submitted?
- bagaimana audit?
- bagaimana child records?
- bagaimana document/file external?
- bagaimana uniqueness pada soft deleted data?
- bagaimana GDPR/retention policy?

Transaction DB bisa mencakup:

- mark deleted;
- revoke active status;
- audit;
- outbox event for cleanup.

External file deletion sebaiknya asynchronous/idempotent.

### 6.5 Read Use Case

Read-only use case tidak selalu butuh transaction panjang.

Namun read transaction bisa berguna untuk:

- consistent snapshot;
- lazy loading dalam service;
- repeatable read kebutuhan tertentu;
- query timeout/read-only hint;
- connection/session lifecycle.

Pattern:

```java
@Transactional(readOnly = true)
public CaseDetailView getDetail(Long caseId, Long userId) {
    authorization.assertCanView(userId, caseId);
    return caseQueryRepository.findDetailView(caseId);
}
```

Catatan penting: `readOnly = true` bukan security guarantee dan bukan berarti database pasti menolak write. Di banyak stack, ini lebih berupa hint/optimization. Jangan jadikan pengganti desain authorization/invariant.

---

## 7. External Side Effect: Jangan Diposisikan Seolah-olah Ikut Rollback

External side effect adalah operasi yang efeknya keluar dari database transaction lokal.

Contoh:

- send email;
- publish Kafka/RabbitMQ message;
- call REST API;
- upload file ke object storage;
- send SMS/WhatsApp;
- invalidate Redis cache;
- call payment gateway;
- push notification;
- update search index.

Masalah besar:

> Database rollback tidak bisa otomatis membatalkan email yang sudah terkirim.

### 7.1 Anti-Pattern: External Call Inside Transaction

```java
@Transactional
public void submit(Long applicationId) {
    Application app = repository.get(applicationId);
    app.submit();

    emailClient.sendSubmitted(app.email()); // side effect

    auditRepository.save(Audit.submitted(app));
}
```

Failure matrix:

| Step | Skenario | Dampak |
|---|---|---|
| app.submit success | email fail | transaction rollback, user melihat gagal, tetapi state mungkin belum berubah |
| email success | audit fail | email terkirim, DB rollback |
| email slow | DB connection tertahan | pool exhaustion |
| request retry | email bisa terkirim dua kali | duplicate notification |

### 7.2 Better Pattern: Persist Intent, Execute After Commit

```java
@Transactional
public void submit(Long applicationId) {
    Application app = repository.get(applicationId);
    app.submit();

    auditRepository.save(Audit.submitted(app));
    outboxRepository.save(OutboxEvent.applicationSubmitted(app.id(), app.email()));
}
```

Lalu worker setelah commit:

```java
public void publishOutboxEvents() {
    List<OutboxEvent> events = outboxRepository.findReadyEvents();
    for (OutboxEvent event : events) {
        try {
            notificationClient.send(event.payload());
            outboxRepository.markPublished(event.id());
        } catch (Exception ex) {
            outboxRepository.markFailedForRetry(event.id(), ex);
        }
    }
}
```

Kelebihan:

- database state dan intent event atomik;
- email/message hanya terjadi jika commit berhasil;
- retry bisa dikontrol;
- duplicate bisa ditangani dengan idempotency key;
- observability lebih baik.

### 7.3 After Commit Hook: Berguna Tapi Jangan Overestimate

Di Spring/Jakarta stack, ada mekanisme transaction synchronization/after commit callback. Berguna untuk menjalankan sesuatu setelah commit.

Namun after-commit callback bukan pengganti outbox untuk efek penting.

Risiko after-commit only:

- JVM mati setelah commit sebelum callback;
- callback gagal dan event hilang;
- tidak ada retry durable;
- observability lemah;
- sulit replay.

Gunakan after-commit untuk hal ringan/non-critical, misalnya:

- clear local in-memory cache;
- log metric;
- trigger best-effort refresh.

Untuk email penting, message integration, downstream notification, gunakan outbox.

---

## 8. Transaction Boundary dan Messaging

Messaging memperkenalkan masalah dual-write:

```text
1. update database
2. publish message
```

Tidak ada jaminan keduanya berhasil bersama bila dilakukan terpisah tanpa mekanisme khusus.

### 8.1 Bad Pattern: DB Commit lalu Publish Message Langsung

```java
@Transactional
public void approve(Long caseId) {
    Case c = repository.get(caseId);
    c.approve();
}

public void controllerOrService() {
    approve(caseId);
    messageBroker.publish(new CaseApproved(caseId));
}
```

Skenario gagal:

- DB commit berhasil;
- application crash sebelum publish;
- downstream tidak pernah tahu case approved.

### 8.2 Bad Pattern: Publish Message di Dalam Transaction

```java
@Transactional
public void approve(Long caseId) {
    Case c = repository.get(caseId);
    c.approve();
    messageBroker.publish(new CaseApproved(caseId));
}
```

Skenario gagal:

- publish berhasil;
- DB commit gagal;
- downstream menerima event untuk state yang tidak pernah committed.

### 8.3 Transactional Outbox Pattern

Pattern:

```text
Dalam DB transaction:
- update aggregate
- insert outbox event

Di luar transaction:
- worker/CDC membaca outbox
- publish ke broker
- mark published / rely on CDC offset
```

Outbox table contoh:

```sql
CREATE TABLE outbox_event (
    id              VARCHAR(64) PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    VARCHAR(100) NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    event_version   INTEGER NOT NULL,
    payload_json    CLOB NOT NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    published_at    TIMESTAMP NULL,
    retry_count     INTEGER NOT NULL,
    next_retry_at   TIMESTAMP NULL
);
```

Application transaction:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseEntity c = caseRepository.get(command.caseId());
    c.approve(command.officerId(), clock.instant());

    auditRepository.save(AuditTrail.caseApproved(c));
    outboxRepository.save(OutboxEvent.of(
        "CASE",
        c.id().toString(),
        "CASE_APPROVED",
        c.version(),
        payload(c)
    ));
}
```

Publisher transaction:

```java
@Transactional
public void publishBatch() {
    List<OutboxEvent> events = outboxRepository.claimReadyEvents(100);

    for (OutboxEvent event : events) {
        try {
            broker.publish(event.topic(), event.key(), event.payload());
            event.markPublished(clock.instant());
        } catch (Exception ex) {
            event.markRetry(ex, clock.instant());
        }
    }
}
```

Catatan: bila publish ke broker berhasil tetapi `markPublished` gagal, event bisa dipublish ulang. Maka consumer harus idempotent.

### 8.4 Inbox Pattern untuk Consumer

Consumer juga perlu idempotency.

```sql
CREATE TABLE inbox_message (
    message_id      VARCHAR(100) PRIMARY KEY,
    source          VARCHAR(100) NOT NULL,
    received_at     TIMESTAMP NOT NULL,
    processed_at    TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL
);
```

Consumer:

```java
@Transactional
public void consume(Message message) {
    if (inboxRepository.exists(message.id())) {
        return;
    }

    inboxRepository.save(InboxMessage.received(message));

    applyBusinessEffect(message);

    inboxRepository.markProcessed(message.id());
}
```

Ini membuat duplicate message tidak mengulang side effect database.

---

## 9. Transaction Boundary dan Idempotency

Idempotency artinya operasi dapat dipanggil ulang dengan input yang sama tanpa menciptakan efek tambahan yang salah.

Dalam distributed system, retry bukan exception. Retry adalah normal.

Retry bisa terjadi karena:

- client timeout;
- gateway retry;
- browser resubmit;
- message broker redelivery;
- worker restart;
- DB deadlock retry;
- network partition;
- user double-click.

### 9.1 Idempotency Key untuk Command

Untuk command yang menciptakan efek baru, gunakan idempotency key.

```sql
CREATE TABLE idempotency_record (
    key             VARCHAR(150) PRIMARY KEY,
    command_type    VARCHAR(100) NOT NULL,
    request_hash    VARCHAR(256) NOT NULL,
    result_ref      VARCHAR(150) NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL
);
```

Service:

```java
@Transactional
public SubmitApplicationResult submit(SubmitCommand command) {
    IdempotencyRecord record = idempotencyService.startOrReturnExisting(
        command.idempotencyKey(),
        "SUBMIT_APPLICATION",
        command.stableHash()
    );

    if (record.isCompleted()) {
        return submitResultRepository.get(record.resultRef());
    }

    Application app = applicationRepository.get(command.applicationId());
    app.submit(command.userId(), clock.instant());

    auditRepository.save(AuditTrail.submitted(app));
    outboxRepository.save(OutboxEvent.applicationSubmitted(app));

    idempotencyService.complete(command.idempotencyKey(), app.id().toString());

    return SubmitApplicationResult.from(app);
}
```

### 9.2 Idempotency Bukan Hanya untuk POST

Idempotency penting untuk:

- payment callback;
- document upload finalize;
- workflow transition;
- message consumer;
- scheduled retry;
- external system callback;
- bulk import row processing.

### 9.3 Idempotency Harus Didukung Constraint

Jangan hanya:

```java
if (!repository.existsByReference(ref)) {
    repository.save(new Entity(ref));
}
```

Dua concurrent request bisa lolos `exists`.

Harus ada unique constraint:

```sql
ALTER TABLE application ADD CONSTRAINT uq_application_reference UNIQUE (reference_no);
```

Lalu handle constraint violation secara benar.

---

## 10. Transaction Boundary dan External API Call

Tidak semua external API call harus di luar transaction. Tetapi default-nya: **jangan tahan database transaction saat menunggu network**.

### 10.1 External Read Sebelum Transaction

Contoh: mengambil profile dari identity provider sebelum membuat application.

```java
public CreateApplicationResult create(CreateApplicationRequest request) {
    ExternalProfile profile = myInfoClient.fetchProfile(request.token());

    return createApplicationTransaction.create(request, profile);
}

@Service
class CreateApplicationTransaction {

    @Transactional
    public CreateApplicationResult create(CreateApplicationRequest request, ExternalProfile profile) {
        Application app = ApplicationEntity.from(request, profile);
        repository.save(app);
        auditRepository.save(AuditTrail.created(app));
        return CreateApplicationResult.from(app);
    }
}
```

Kelebihan:

- transaction pendek;
- DB connection tidak tertahan selama external call.

Risiko:

- profile bisa berubah antara fetch dan commit;
- external call berhasil tetapi DB gagal;
- perlu decide apakah fetched data harus disimpan sebagai snapshot.

### 10.2 External Write Setelah Commit

Contoh: notify external registry after license approved.

Gunakan outbox:

```java
@Transactional
public void approveLicense(Long licenseId) {
    License lic = repository.get(licenseId);
    lic.approve();
    outboxRepository.save(OutboxEvent.notifyRegistry(lic.id(), lic.version()));
}
```

Worker:

```java
public void notifyRegistry(OutboxEvent event) {
    registryClient.notifyApproved(event.payload());
}
```

### 10.3 External Reservation Problem

Beberapa operasi eksternal tidak bisa sekadar dipindah keluar transaction.

Contoh:

- reserve payment;
- reserve inventory;
- reserve appointment slot;
- lock external resource.

Pattern umum:

1. Create local pending record.
2. Call external reservation outside DB transaction or in short transaction boundary.
3. Persist reservation result.
4. Confirm/commit local state.
5. Jika gagal, compensate/cancel reservation.

Tidak ada solusi magis. Harus desain saga/compensation.

---

## 11. Transaction Boundary dan File/Object Storage

File upload sering keliru diperlakukan seperti DB write biasa.

Problem:

- file storage tidak rollback bersama DB;
- DB bisa menyimpan metadata tetapi file gagal upload;
- file upload sukses tetapi DB rollback;
- retry bisa upload duplicate;
- delete file saat rollback tidak selalu aman.

### 11.1 Safer Pattern: Staging + Finalization

Flow:

```text
1. Client uploads file to temporary/staging object key.
2. DB transaction creates document metadata with status=PENDING_FINALIZATION.
3. DB commit.
4. Worker validates/moves file to final key.
5. Worker marks document ACTIVE.
```

Atau:

```text
1. DB transaction creates upload session.
2. Client uploads to pre-signed staging URL.
3. Client calls finalize.
4. Finalize transaction verifies upload exists and marks ACTIVE.
```

### 11.2 Cleanup Harus Asynchronous

Stale staging files dibersihkan oleh scheduled cleanup berdasarkan TTL.

Jangan menggantung correctness utama pada “delete file saat catch rollback”. Itu best-effort saja.

---

## 12. Transaction Boundary dan Cache

Cache update juga external side effect.

Anti-pattern:

```java
@Transactional
public void updateCase(UpdateCaseCommand command) {
    Case c = repository.get(command.id());
    c.update(command);
    redis.set("case:" + c.id(), mapper.toJson(c)); // inside transaction
}
```

Jika transaction rollback, Redis sudah berisi data yang tidak committed.

Pattern lebih aman:

- cache-aside dengan invalidation after commit;
- outbox event untuk cache refresh;
- TTL untuk eventual correction;
- versioned cache key;
- avoid caching mutable aggregate if invalidation unclear.

After commit invalidation masih acceptable untuk cache yang bisa self-heal:

```java
@Transactional
public void updateCase(UpdateCaseCommand command) {
    Case c = repository.get(command.id());
    c.update(command);

    transactionSynchronization.afterCommit(() -> cache.evict("case:" + c.id()));
}
```

Tapi untuk cross-service cache/search index penting, gunakan outbox.

---

## 13. Transaction Boundary dan Search Index

Search index seperti Elasticsearch/OpenSearch bukan sumber kebenaran utama.

Jangan update index di dalam DB transaction.

Pattern:

```text
DB transaction:
- update case
- insert outbox CASE_UPDATED

Indexer:
- consume outbox/message
- read latest committed case projection
- update search index
```

Untuk consistency:

- simpan aggregate version;
- indexer ignore event lama;
- search result bisa eventually consistent;
- detail page tetap baca DB by id.

---

## 14. Transaction Propagation sebagai Boundary Tool

Propagation bukan fitur untuk dicoba-coba. Propagation mengubah correctness.

### 14.1 REQUIRED

Default paling umum.

```text
Jika sudah ada transaction, ikut.
Jika belum ada, buat baru.
```

Cocok untuk:

- use case utama;
- repository/service internal yang harus menjadi bagian dari transaksi caller.

Risiko:

- method terlihat mandiri tetapi behavior-nya tergantung caller;
- nested service bisa rollback seluruh transaction tanpa caller sadar.

### 14.2 REQUIRES_NEW

```text
Suspend transaction saat ini.
Buat transaction fisik baru.
Commit/rollback independen.
```

Cocok untuk kasus terbatas:

- audit kegagalan yang harus tetap tersimpan walaupun main transaction rollback;
- retry log;
- outbox/error record tertentu;
- progress checkpoint batch.

Contoh:

```java
@Transactional
public void processCase(Long caseId) {
    try {
        Case c = repository.get(caseId);
        c.process();
    } catch (Exception ex) {
        failureLogService.logFailure(caseId, ex); // REQUIRES_NEW
        throw ex;
    }
}

@Service
class FailureLogService {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void logFailure(Long caseId, Exception ex) {
        failureLogRepository.save(FailureLog.of(caseId, ex));
    }
}
```

Risiko:

- data log/audit bisa commit walaupun main data rollback;
- connection tambahan dibutuhkan;
- deadlock lebih mudah bila mengakses row yang sama;
- logical consistency bisa rusak bila dipakai sembarangan.

Rule:

> Pakai `REQUIRES_NEW` hanya bila kamu memang ingin commit independen dan siap menerima konsekuensi consistency-nya.

### 14.3 NESTED

`NESTED` biasanya menggunakan savepoint dalam transaction fisik yang sama.

Cocok untuk:

- partial rollback dalam satu transaction;
- batch chunk internal tertentu;
- JDBC savepoint use case.

Risiko:

- tidak semua transaction manager mendukung;
- tidak sama dengan `REQUIRES_NEW`;
- outer rollback tetap membatalkan semuanya.

### 14.4 NOT_SUPPORTED

```text
Suspend transaction dan jalankan tanpa transaction.
```

Cocok untuk:

- external call yang tidak boleh menahan DB transaction;
- long read yang tidak perlu transaction;
- reporting tertentu.

Namun jangan gunakan untuk operasi yang tetap perlu consistency.

### 14.5 MANDATORY

```text
Harus dipanggil dalam transaction existing.
Jika tidak, error.
```

Cocok untuk method internal yang tidak boleh berjalan sendiri:

```java
@Transactional(propagation = Propagation.MANDATORY)
public void appendAuditTrail(...) {
    auditRepository.save(...);
}
```

Ini bisa mencegah developer memanggil persistence helper di luar transaction.

### 14.6 NEVER

```text
Harus dipanggil tanpa transaction.
Jika ada transaction, error.
```

Cocok untuk guard pada method external side effect tertentu:

```java
@Transactional(propagation = Propagation.NEVER)
public void sendEmail(...) {
    emailClient.send(...);
}
```

Namun implementasi aktual tergantung framework dan proxy. Ini lebih sebagai safety net, bukan satu-satunya perlindungan.

---

## 15. Self-Invocation Problem

Pada Spring proxy-based transaction, pemanggilan method transactional dari method lain dalam object yang sama sering tidak melewati proxy.

Anti-pattern:

```java
@Service
public class CaseService {

    public void approveAndNotify(Long caseId) {
        approve(caseId); // self-invocation, @Transactional may not apply
    }

    @Transactional
    public void approve(Long caseId) {
        Case c = repository.get(caseId);
        c.approve();
    }
}
```

Solusi desain:

- letakkan transactional method di bean berbeda;
- transaction di public use case entrypoint;
- jangan membuat internal method bergantung pada annotation yang tidak dilewati proxy;
- gunakan programmatic transaction bila benar-benar perlu.

Lebih baik:

```java
@Service
public class ApproveCaseUseCase {
    @Transactional
    public void approve(Long caseId) { ... }
}

@Service
public class ApproveAndNotifyOrchestrator {
    public void approveAndNotify(Long caseId) {
        approveCaseUseCase.approve(caseId);
        // notify via outbox/after commit pattern
    }
}
```

---

## 16. Transaction Boundary dan Lazy Loading

Transaction boundary memengaruhi kapan persistence context hidup. Lazy loading membutuhkan active persistence context/session.

Anti-pattern:

```java
@Transactional
public CaseEntity getCase(Long id) {
    return repository.get(id);
}

public CaseResponse controller(Long id) {
    CaseEntity c = service.getCase(id);
    return mapper.toResponse(c); // lazy association accessed outside transaction
}
```

Jika Open Session in View dimatikan, bisa terjadi lazy loading exception. Jika dinyalakan, query bisa terjadi saat serialization sehingga fetch plan tidak terkendali.

Better:

```java
@Transactional(readOnly = true)
public CaseDetailView getCaseDetail(Long id) {
    return caseQueryRepository.findDetailView(id);
}
```

Atau:

```java
@Transactional(readOnly = true)
public CaseResponse getCase(Long id) {
    CaseEntity c = repository.findWithRequiredGraph(id);
    return mapper.toResponse(c); // mapping inside boundary, fetch plan known
}
```

Prinsip:

> Jangan mengembalikan managed entity ke layer yang tidak memahami persistence context.

---

## 17. Transaction Boundary dan Validation

Tidak semua validation harus terjadi dalam transaction.

### 17.1 Validation yang Bisa Dilakukan Sebelum Transaction

Contoh:

- JSON shape;
- required field;
- format email;
- date format;
- enum value;
- file size metadata;
- syntactic validation.

Lakukan sebelum transaction agar transaction pendek.

### 17.2 Validation yang Harus Dalam Transaction

Contoh:

- current state masih editable;
- actor masih assigned;
- quota masih tersedia;
- no active application exists;
- version masih sama;
- parent record belum closed;
- approval limit belum terlampaui.

Validation ini bergantung pada state database yang bisa berubah concurrent. Harus berada dalam transaction dan sering harus didukung lock/constraint.

### 17.3 Validation Harus Dibedakan dari Constraint

Application validation memberikan pesan yang baik. Database constraint memberikan guarantee terakhir.

Keduanya bukan pengganti satu sama lain.

---

## 18. Transaction Boundary dan Authorization

Authorization yang memengaruhi data mutation harus berada dekat dengan mutation.

Anti-pattern:

```java
controller.checkCanApprove(user, caseId);
service.approve(caseId);
```

Masalah:

- TOCTOU: assignment bisa berubah antara check dan approve;
- service bisa dipanggil dari entrypoint lain tanpa check;
- audit actor bisa tidak sinkron.

Better:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseEntity c = repository.get(command.caseId());
    authorizationPolicy.assertCanApprove(command.userId(), c);
    c.approve(command.userId(), clock.instant());
    auditRepository.save(AuditTrail.caseApproved(c, command.userId()));
}
```

Authorization yang sifatnya coarse-grained boleh di controller/security filter, tetapi authorization final untuk mutation harus menjadi bagian dari use case boundary.

---

## 19. Transaction Boundary dan Batch Job

Batch job adalah tempat transaction boundary sering salah.

### 19.1 Bad Pattern: One Huge Transaction

```java
@Transactional
public void processAll() {
    List<Item> items = repository.findAllPending();
    for (Item item : items) {
        item.process();
    }
}
```

Masalah:

- persistence context membesar;
- lock lama;
- rollback besar;
- undo/redo pressure;
- connection lama tertahan;
- satu item gagal membatalkan semua;
- sulit resume.

### 19.2 Chunked Transaction

```java
public void processAll() {
    while (true) {
        List<Long> ids = itemRepository.findNextPendingIds(100);
        if (ids.isEmpty()) break;
        batchChunkProcessor.processChunk(ids);
    }
}

@Service
class BatchChunkProcessor {

    @Transactional
    public void processChunk(List<Long> ids) {
        List<Item> items = itemRepository.findByIdsForProcessing(ids);
        for (Item item : items) {
            item.process();
            auditRepository.save(AuditTrail.itemProcessed(item));
        }
    }
}
```

Kelebihan:

- transaction pendek;
- progress bisa disimpan;
- failure isolated;
- retry lebih mudah;
- memory terkendali.

### 19.3 Per-Item Transaction

Cocok bila tiap item independen:

```java
public void processAll() {
    for (Long id : ids) {
        try {
            itemProcessor.processOne(id); // @Transactional
        } catch (Exception ex) {
            failureLogService.log(id, ex); // REQUIRES_NEW or separate tx
        }
    }
}
```

Trade-off:

- lebih banyak transaction overhead;
- lebih robust untuk partial failure;
- cocok untuk job panjang.

### 19.4 Claim-Process Pattern

Untuk multi-worker batch:

```sql
UPDATE job_item
SET status = 'PROCESSING', claimed_by = ?, claimed_at = ?
WHERE id IN (...)
  AND status = 'PENDING';
```

Atau gunakan `SELECT ... FOR UPDATE SKIP LOCKED` bila database mendukung.

Boundary:

1. Claim item dalam transaction pendek.
2. Process item/chunk.
3. Mark success/failure dalam transaction.

---

## 20. Transaction Boundary dan Scheduler

Scheduler biasanya tidak punya user request boundary. Maka harus eksplisit:

- satu scheduler run tidak boleh memproses semua data dalam satu transaction;
- harus ada lock/lease agar tidak double-run;
- harus idempotent;
- harus safe jika node crash di tengah;
- harus punya retry dan dead-letter state.

Pattern:

```java
@Scheduled(fixedDelayString = "PT30S")
public void publishOutbox() {
    outboxPublisher.publishNextBatch();
}
```

```java
@Transactional
public void publishNextBatch() {
    List<OutboxEvent> events = outboxRepository.claimReadyEvents(workerId, 100);
    // careful: publishing inside same transaction has trade-off
}
```

Untuk outbox, ada dua gaya:

1. Claim in DB transaction, publish outside, then mark result.
2. Publish inside claim transaction, but accept broker side effect risk.

Umumnya lebih aman:

```text
Tx 1: claim events
No Tx/External: publish event
Tx 2: mark published or retry
```

Karena broker publish bukan bagian dari DB transaction, consumer tetap harus idempotent.

---

## 21. Transaction Boundary dan Message Consumer

Message consumer boundary berbeda dari web request.

Pertanyaan:

- kapan message di-ack?
- apakah DB commit sudah berhasil sebelum ack?
- apakah duplicate message aman?
- apakah external side effect terjadi sebelum/after DB commit?

Pattern umum:

```java
public void onMessage(Message message) {
    try {
        consumerTransaction.process(message); // DB transaction
        ack(message);
    } catch (RetriableException ex) {
        nackForRetry(message);
    } catch (NonRetriableException ex) {
        sendToDeadLetter(message);
    }
}
```

Transactional part:

```java
@Transactional
public void process(Message message) {
    if (inboxRepository.exists(message.id())) {
        return;
    }

    inboxRepository.save(InboxMessage.received(message));
    applyBusinessMutation(message);
    inboxRepository.markProcessed(message.id());
}
```

Ack should happen after successful commit. If process commits but ack fails, message may be redelivered. Inbox handles duplicate.

---

## 22. Transaction Boundary dan Saga/Compensation

Jika use case membutuhkan beberapa resource yang tidak bisa masuk satu transaction, kamu masuk wilayah saga.

Contoh: issue license with payment and external registry.

```text
1. Create license request PENDING_PAYMENT
2. Request payment authorization
3. Mark PAYMENT_AUTHORIZED
4. Approve license locally
5. Notify registry
6. Mark REGISTRY_NOTIFIED
7. Send email
```

Tidak realistis menjadikan semua ini satu DB transaction.

Gunakan state machine:

```text
PENDING_PAYMENT
PAYMENT_AUTHORIZED
APPROVED_LOCALLY
REGISTRY_NOTIFICATION_PENDING
REGISTRY_NOTIFIED
COMPLETED
FAILED_COMPENSATION_REQUIRED
```

Setiap step memiliki transaction boundary sendiri:

```text
Tx A: persist pending request
External: authorize payment
Tx B: persist payment result + outbox next step
External: notify registry
Tx C: persist registry result
```

Compensation:

- cancel payment authorization;
- mark request failed;
- notify officer;
- create manual intervention task.

Saga bukan “eventual consistency agar mudah”. Saga adalah pengakuan bahwa atomic transaction lintas resource tidak praktis/tersedia.

---

## 23. Transaction Boundary dan State Machine

Dalam regulatory/case-management system, state transition adalah jantung correctness.

Contoh:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> ESCALATED -> APPROVED/REJECTED
```

Boundary yang baik:

```java
@Transactional
public void submit(SubmitCommand command) {
    Application app = repository.get(command.applicationId());

    app.submit(command.actorId(), clock.instant());

    auditRepository.save(AuditTrail.transition(
        app.id(),
        "DRAFT",
        "SUBMITTED",
        command.actorId(),
        command.reason()
    ));

    outboxRepository.save(OutboxEvent.applicationSubmitted(app.id(), app.version()));
}
```

Atomic group:

- old state verification;
- new state write;
- version update;
- audit trail;
- event intent.

Tidak atomic:

- email;
- PDF;
- external downstream notification;
- dashboard refresh.

### 23.1 Conditional Update Alternative

Untuk high concurrency transition:

```sql
UPDATE application
SET status = 'SUBMITTED', version = version + 1, submitted_at = ?
WHERE id = ?
  AND status = 'DRAFT'
  AND version = ?;
```

Jika affected rows = 0, transition gagal karena stale state atau invalid state.

Ini kadang lebih kuat dan efisien daripada load-modify-flush untuk transition sederhana.

---

## 24. Transaction Boundary dan Audit Trail

Audit adalah bagian dari correctness, tetapi ada beberapa jenis audit.

### 24.1 Business Audit Harus Atomik dengan Business Change

Jika state berubah, audit transition harus ikut commit.

```java
@Transactional
public void approve(...) {
    case.approve(...);
    auditRepository.save(AuditTrail.caseApproved(...));
}
```

Jika audit gagal, lebih baik seluruh transition gagal, karena state tanpa audit mungkin tidak defensible.

### 24.2 Technical Failure Log Bisa Independen

Jika use case gagal dan kamu ingin mencatat kegagalan, gunakan transaction terpisah.

```java
try {
    approveUseCase.approve(command);
} catch (Exception ex) {
    failureLogger.log(command, ex); // REQUIRES_NEW or separate transaction
    throw ex;
}
```

### 24.3 Jangan Campur Audit dengan Notification

Audit adalah record of fact. Notification adalah side effect.

Audit harus atomic dengan perubahan yang diaudit. Notification sebaiknya outbox/eventual.

---

## 25. Transaction Boundary dan Reporting/Read Model

Read model/reporting sering tidak perlu transaction write, tetapi perlu consistency model jelas.

Pilihan:

1. Query live table langsung.
2. Query database view/materialized view.
3. Query denormalized read table.
4. Query search index.
5. Query analytics warehouse.

Boundary update read model:

- synchronous dalam transaction utama jika read model wajib immediately consistent;
- outbox/asynchronous jika eventual consistency acceptable.

Trade-off:

| Strategy | Consistency | Performance | Complexity |
|---|---:|---:|---:|
| Update read model in same tx | kuat | bisa lambat | medium |
| Outbox async projection | eventual | bagus | higher |
| Query live table | current | bisa mahal | low-medium |
| Search index | eventual | bagus untuk search | higher |

---

## 26. Transaction Boundary dan Long Running Business Process

Business process bisa berlangsung menit, jam, hari, atau bulan. Database transaction tidak boleh berlangsung selama itu.

Contoh:

```text
Application submitted Monday.
Officer reviews Wednesday.
Applicant responds next week.
Supervisor approves later.
```

Ini bukan satu transaction. Ini **long-running process** yang terdiri dari banyak short transaction.

Setiap user action adalah transaction sendiri:

```text
Tx 1: submit application
Tx 2: assign officer
Tx 3: request clarification
Tx 4: applicant submits clarification
Tx 5: approve/reject
```

State machine + audit + versioning menjaga continuity.

Prinsip:

> Jangan gunakan database transaction untuk mewakili business process panjang. Gunakan persisted state machine.

---

## 27. Transaction Boundary dan Retry

Retry harus didesain berdasarkan jenis error.

### 27.1 Retriable

Biasanya:

- deadlock;
- lock timeout;
- transient connection issue;
- optimistic locking conflict untuk automated process;
- broker temporary failure;
- external API 503/timeout bila idempotent.

### 27.2 Non-Retriable

Biasanya:

- validation error;
- authorization error;
- invalid state transition;
- unique constraint karena duplicate real business input;
- SQL grammar/mapping bug;
- data truncation akibat bug;
- missing required data.

### 27.3 Retry Boundary

Retry harus mengulang seluruh consistency decision, bukan melanjutkan dari tengah transaction yang gagal.

```java
retryTemplate.execute(() -> approveUseCase.approve(command));
```

Bukan:

```java
try {
    repository.save(...);
} catch (Deadlock e) {
    repository.saveOtherThing(...); // broken continuation
}
```

Setelah transaction rollback, managed entity state juga harus diperlakukan tidak aman untuk dipakai lanjut.

---

## 28. Programmatic Transaction Boundary

Annotation cukup untuk mayoritas use case. Namun programmatic transaction berguna bila boundary dinamis.

Spring example:

```java
public void processBatch(List<Long> ids) {
    for (Long id : ids) {
        transactionTemplate.executeWithoutResult(status -> {
            processOne(id);
        });
    }
}
```

Jakarta style dengan `UserTransaction` di environment yang mendukung:

```java
public void doWork() throws Exception {
    userTransaction.begin();
    try {
        // persistence work
        userTransaction.commit();
    } catch (Exception ex) {
        userTransaction.rollback();
        throw ex;
    }
}
```

Gunakan programmatic transaction saat:

- loop butuh per-item transaction;
- chunk size runtime-defined;
- perlu transaction around subset kecil dari method besar;
- perlu suspend/resume yang eksplisit;
- boundary tidak cocok dengan method boundary.

Jangan gunakan hanya karena ingin “lebih kontrol” kalau annotation sudah jelas.

---

## 29. Failure Matrix: Cara Berpikir Staff Engineer

Setiap use case penting harus punya failure matrix.

Contoh use case: submit application.

### 29.1 Naive Flow

```text
1. update DB status SUBMITTED
2. insert audit
3. send email
4. publish message
5. return success
```

Failure matrix:

| Failure Point | DB State | Email | Message | User Sees | Problem |
|---|---|---|---|---|---|
| fail before DB | unchanged | no | no | fail | OK |
| fail after status before audit | rollback if same tx | no | no | fail | OK if same tx |
| fail after email before commit | rollback | sent | no | fail | email lies |
| fail after commit before message | submitted | maybe sent | no | success/fail unknown | downstream missing |
| response lost after commit | submitted | maybe | maybe | client timeout | retry duplicate risk |

### 29.2 Better Flow with Outbox

```text
Tx:
1. verify state
2. update DB status
3. insert audit
4. insert outbox APPLICATION_SUBMITTED
5. commit

Async:
6. publish message/send email from outbox
7. mark published/retry
```

Failure matrix:

| Failure Point | DB State | Outbox | External Effect | Recovery |
|---|---|---|---|---|
| fail before commit | rollback | none | none | user retry |
| fail during commit | unknown to app | unknown | none | idempotency/read-after |
| commit success response lost | submitted | event exists | pending | retry returns same result |
| publisher fails | submitted | pending/retry | none/partial | retry worker |
| publish success mark fail | submitted | still pending | maybe duplicate | idempotent consumer |

Ini lebih jujur terhadap distributed reality.

---

## 30. Design Recipes

### 30.1 Web Command Use Case

```text
Controller:
- parse request
- call use case
- map response

Use case transaction:
- load aggregate
- check authorization/invariant
- mutate aggregate
- audit
- outbox
- return committed representation or id

After commit/async:
- notify
- index
- cache eviction
```

### 30.2 Web Query Use Case

```text
Controller:
- parse filters
- call query service

Query service read-only tx:
- authorization predicate
- projection query
- pagination/sorting whitelist
- return DTO/read model
```

### 30.3 Message Consumer

```text
Listener:
- receive message
- call transactional processor
- ack only after success

Transactional processor:
- inbox dedup
- apply mutation
- audit/outbox
- mark processed
```

### 30.4 Batch Job

```text
Scheduler:
- find/claim chunk
- process chunk transactionally
- record progress/failure
- repeat

Chunk transaction:
- load bounded records
- mutate
- audit/outbox
- flush/clear if needed
```

### 30.5 External Integration

```text
Local transaction:
- persist intent
- outbox event

Worker:
- execute external call idempotently
- persist result
- retry/backoff/dead-letter
```

---

## 31. Anti-Patterns

### 31.1 `@Transactional` Everywhere

Jika semua service/repository/helper transactional, boundary menjadi tidak jelas.

Akibat:

- sulit tahu apa yang atomik;
- propagation surprise;
- long transaction tidak sengaja;
- rollback terlalu besar;
- debugging sulit.

### 31.2 Transaction di Controller

Mengikat persistence correctness ke HTTP lifecycle.

### 31.3 External Call di Dalam Transaction

Menahan DB resource sambil menunggu network dan mencampur rollback semantics.

### 31.4 Return Entity dari Transactional Service

Layer luar bisa trigger lazy loading atau mengubah detached entity secara salah.

### 31.5 Catch Exception di Dalam Transaction dan Lanjut Seolah Aman

Jika transaction sudah rollback-only, lanjut menulis data bisa gagal di commit atau membuat alur misleading.

### 31.6 `REQUIRES_NEW` untuk Menyembunyikan Desain Buruk

`REQUIRES_NEW` bukan “force commit fix”. Itu membuat consistency boundary baru.

### 31.7 One Huge Batch Transaction

Mengorbankan memory, lock, rollback, dan recoverability.

### 31.8 Application-Only Uniqueness Check

Pre-check tanpa database constraint tidak aman terhadap concurrency.

### 31.9 Publish Message Tanpa Outbox untuk Event Penting

DB dan broker bisa diverge.

### 31.10 Menganggap `readOnly=true` Membuat Data Mustahil Berubah

Itu hint/optimization, bukan security/correctness guarantee universal.

---

## 32. Production Failure Modes

### 32.1 Connection Pool Exhaustion

Penyebab:

- transaction terlalu panjang;
- external call di dalam transaction;
- slow query;
- lock wait;
- streaming result tidak ditutup;
- batch besar.

Signal:

- Hikari active connections penuh;
- request timeout;
- DB sessions idle in transaction;
- thread dump banyak menunggu connection.

Mitigasi:

- pendekkan transaction;
- pindahkan external call keluar;
- query timeout;
- chunking;
- index/plan fix;
- leak detection.

### 32.2 Lock Storm

Penyebab:

- update hot row;
- inconsistent lock order;
- batch update besar;
- transaction lama;
- pessimistic locking sembarangan.

Mitigasi:

- deterministic lock order;
- reduce transaction scope;
- optimistic locking;
- partition counter;
- queue/serialize high-contention command;
- retry with backoff.

### 32.3 Ghost Notification

Email/message terkirim padahal DB rollback.

Mitigasi:

- outbox;
- after commit for non-critical;
- idempotent consumer.

### 32.4 Missing Notification

DB commit berhasil tetapi event tidak terkirim.

Mitigasi:

- transactional outbox;
- durable retry;
- monitoring pending outbox.

### 32.5 Duplicate Processing

Retry/redelivery menciptakan duplicate side effect.

Mitigasi:

- idempotency key;
- inbox table;
- unique constraint;
- natural operation key;
- dedup at consumer.

### 32.6 Rollback-Only Surprise

Inner method throw exception, caught by caller, tetapi transaction sudah marked rollback-only.

Mitigasi:

- jangan swallow exception sembarangan;
- pahami rollback rules;
- gunakan separate transaction bila ingin failure log commit;
- test transaction behavior.

### 32.7 Stale Data After Bulk Update

Bulk update bypass persistence context; managed entity masih punya old state.

Mitigasi:

- clear persistence context;
- avoid mixing bulk update and managed entity mutation in one transaction;
- use separate transaction.

---

## 33. Observability Checklist

Untuk transaction boundary, observability minimal:

1. **Transaction duration**
   - per endpoint/use case/job/consumer.

2. **Connection acquisition time**
   - apakah request lambat karena menunggu connection?

3. **Active connection count**
   - pool saturation.

4. **Slow query inside transaction**
   - SQL fingerprint dan use case.

5. **Lock wait/deadlock**
   - DB-side metric.

6. **Rollback count**
   - by exception type/use case.

7. **Outbox lag**
   - pending count, oldest pending age, retry count.

8. **Inbox duplicate count**
   - consumer redelivery/dedup signal.

9. **Transaction timeout count**
   - where and why.

10. **External call inside transaction detection**
   - via tracing spans: DB transaction span overlaps HTTP client span.

11. **Correlation id**
   - request id, transaction/use case id, aggregate id, event id.

12. **Audit completeness**
   - state transitions without audit should be zero.

---

## 34. Practical Checklist for Designing a Transaction Boundary

Untuk setiap command use case, jawab:

### 34.1 Consistency

- Apa invariant yang dijaga?
- Record mana yang harus berubah atomik?
- Apakah audit harus atomik dengan perubahan?
- Apakah outbox event harus atomik dengan perubahan?
- Apakah ada uniqueness/concurrency constraint?

### 34.2 Scope

- Transaction dimulai di layer mana?
- Kapan transaction selesai?
- Apakah ada external call di dalamnya?
- Apakah mapping response memicu lazy loading?
- Apakah transaction bisa terlalu lama?

### 34.3 Concurrency

- Apa yang terjadi jika dua request sama masuk bersamaan?
- Apakah butuh optimistic lock?
- Apakah butuh pessimistic lock?
- Apakah unique constraint cukup?
- Apakah retry aman?

### 34.4 Side Effect

- Email/message/cache/search index dilakukan kapan?
- Apakah side effect durable?
- Apakah bisa duplicate?
- Apakah consumer idempotent?
- Apakah outbox/inbox diperlukan?

### 34.5 Failure

- Jika commit sukses tapi response gagal, apa yang terjadi?
- Jika external call sukses tapi DB gagal, apa yang terjadi?
- Jika broker publish sukses tapi mark published gagal, apa yang terjadi?
- Jika worker crash di tengah, apa recovery-nya?
- Jika transaction timeout, apakah user bisa retry?

### 34.6 Operation

- Apakah bisa diamati di metric/log/trace?
- Apakah ada alert untuk pending outbox?
- Apakah ada dead-letter/manual intervention?
- Apakah batch bisa resume?
- Apakah ada cleanup stale state?

---

## 35. Example: Submit Application End-to-End

### 35.1 Bad Version

```java
@Transactional
public SubmitApplicationResponse submit(SubmitApplicationRequest request) {
    Application app = applicationRepository.findById(request.applicationId())
        .orElseThrow();

    app.setStatus(ApplicationStatus.SUBMITTED);
    app.setSubmittedAt(Instant.now());

    emailClient.sendSubmitted(app.getApplicantEmail());
    messageBroker.publish("application-submitted", app.getId().toString());

    auditRepository.save(AuditTrail.submitted(app));

    return SubmitApplicationResponse.from(app);
}
```

Problems:

- email before audit;
- message before commit;
- external call inside transaction;
- no idempotency;
- no version conflict handling;
- no outbox;
- no explicit invariant;
- uses `Instant.now()` directly;
- response may expose managed entity state.

### 35.2 Better Version

```java
@Service
public class SubmitApplicationUseCase {

    private final ApplicationRepository applicationRepository;
    private final AuditTrailRepository auditTrailRepository;
    private final OutboxRepository outboxRepository;
    private final IdempotencyService idempotencyService;
    private final Clock clock;

    @Transactional
    public SubmitApplicationResult submit(SubmitApplicationCommand command) {
        IdempotencyDecision idem = idempotencyService.startOrReturnExisting(
            command.idempotencyKey(),
            "SUBMIT_APPLICATION",
            command.stableHash()
        );

        if (idem.isAlreadyCompleted()) {
            return SubmitApplicationResult.alreadySubmitted(idem.resultReference());
        }

        ApplicationEntity app = applicationRepository.findById(command.applicationId())
            .orElseThrow(ApplicationNotFoundException::new);

        app.submit(command.actorId(), clock.instant());

        auditTrailRepository.save(AuditTrail.applicationSubmitted(
            app.id(),
            command.actorId(),
            app.submittedAt()
        ));

        outboxRepository.save(OutboxEvent.applicationSubmitted(
            app.id(),
            app.version(),
            app.applicantEmail()
        ));

        idempotencyService.complete(command.idempotencyKey(), app.id().toString());

        return SubmitApplicationResult.submitted(app.id(), app.referenceNo(), app.version());
    }
}
```

Domain method:

```java
public void submit(Long actorId, Instant now) {
    if (this.status != ApplicationStatus.DRAFT) {
        throw new InvalidApplicationStateException(this.status, ApplicationStatus.SUBMITTED);
    }

    this.status = ApplicationStatus.SUBMITTED;
    this.submittedBy = actorId;
    this.submittedAt = now;
}
```

Outbox publisher:

```java
@Service
public class ApplicationSubmittedPublisher {

    public void publish(OutboxEvent event) {
        ApplicationSubmittedPayload payload = event.payloadAs(ApplicationSubmittedPayload.class);
        notificationClient.sendSubmissionNotification(payload.email(), payload.applicationId());
        messageBroker.publish("application.submitted", payload.applicationId(), payload);
    }
}
```

Consumer of message must be idempotent.

---

## 36. Example: Approval with Failure Log

Requirement:

- If approval succeeds, update case and audit atomically.
- If approval fails due to unexpected error, store failure log even though approval rolls back.

```java
@Service
public class ApproveCaseFacade {

    private final ApproveCaseUseCase approveCaseUseCase;
    private final FailureLogService failureLogService;

    public void approve(ApproveCaseCommand command) {
        try {
            approveCaseUseCase.approve(command);
        } catch (Exception ex) {
            failureLogService.logApprovalFailure(command, ex);
            throw ex;
        }
    }
}
```

```java
@Service
public class ApproveCaseUseCase {

    @Transactional
    public void approve(ApproveCaseCommand command) {
        CaseEntity c = caseRepository.get(command.caseId());
        c.approve(command.actorId(), clock.instant());
        auditRepository.save(AuditTrail.caseApproved(c));
        outboxRepository.save(OutboxEvent.caseApproved(c));
    }
}
```

```java
@Service
public class FailureLogService {

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void logApprovalFailure(ApproveCaseCommand command, Exception ex) {
        failureLogRepository.save(FailureLog.approval(command, ex));
    }
}
```

Reasoning:

- business audit belongs to approval transaction;
- technical failure log is independent;
- `REQUIRES_NEW` is intentional and justified.

---

## 37. Example: Batch Import with Per-Row Idempotency

Requirement:

- import 100k rows;
- one bad row must not rollback all;
- retry job must not duplicate imported records.

Pattern:

```java
public void importFile(Long fileId) {
    List<ImportRowRef> rows = importRowRepository.findPendingRows(fileId);

    for (ImportRowRef row : rows) {
        try {
            importRowProcessor.process(row.id());
        } catch (Exception ex) {
            importFailureLogger.log(row.id(), ex);
        }
    }
}
```

```java
@Service
class ImportRowProcessor {

    @Transactional
    public void process(Long rowId) {
        ImportRow row = importRowRepository.get(rowId);

        if (row.isProcessed()) {
            return;
        }

        CustomerRecord record = CustomerRecord.from(row);
        customerRepository.saveIfNotExists(record); // backed by unique constraint

        row.markProcessed(clock.instant());
        auditRepository.save(AuditTrail.importRowProcessed(row));
    }
}
```

Important:

- each row has its own transaction;
- unique constraint protects duplicate;
- row status allows resume;
- failure log may use separate transaction.

---

## 38. What Changes Across Java 8 to Java 25?

Transaction boundary principles do not fundamentally change across Java 8–25, but the ecosystem changes.

### Java 8 Era

Common stack:

- Java EE/JPA 2.1/2.2;
- `javax.persistence`;
- `javax.transaction`;
- Hibernate 5;
- Spring Framework 4/5;
- Spring Boot 1/2.

Typical issues:

- older Hibernate behavior;
- less record/sealed type usage;
- older date/time adoption still mixed;
- Java EE application server or Spring monolith.

### Java 11/17 Era

Common stack:

- Spring Boot 2/3 transition;
- `javax` to `jakarta` migration;
- Hibernate 5 to 6 migration;
- Java records useful for DTO/projection;
- better observability/tracing ecosystem.

### Java 21/25 Era

Common stack:

- Spring Boot 3+;
- Jakarta Persistence 3.x;
- Jakarta Transactions 2.x;
- Hibernate 6/7;
- virtual threads possible for request concurrency;
- stronger emphasis on structured concurrency/observability.

Important:

Virtual threads do not remove transaction boundary concerns. They may reduce thread scarcity, but they do not reduce:

- database connection scarcity;
- lock contention;
- transaction duration;
- external side effect consistency;
- idempotency requirement.

A virtual thread waiting inside a transaction still holds a database connection and potentially locks.

---

## 39. Summary

Transaction boundary design is one of the core skills that separates ordinary persistence usage from production-grade persistence engineering.

Key takeaways:

1. Transaction boundary should follow **use case consistency**, not arbitrary method boundaries.
2. A transaction should protect one clear consistency decision.
3. Application service/use case layer is usually the right owner of transaction boundary.
4. Repository should not secretly define business transaction scope.
5. Controller should not own transaction correctness.
6. External side effects do not rollback with database transaction.
7. For important integration events, use transactional outbox.
8. Consumers need idempotency/inbox because duplicate delivery is normal.
9. `REQUIRES_NEW` is powerful but dangerous if used without explicit consistency reason.
10. Long-running business processes should be modeled as persisted state machines, not long DB transactions.
11. Batch jobs need chunk/per-item boundaries, not one giant transaction.
12. Retry must repeat whole consistency decisions and be backed by idempotency/constraints.
13. Audit that proves business fact should be atomic with the fact.
14. Cache/search/email/message should generally be after commit or outbox-driven.
15. Observability must show transaction duration, connection pressure, rollback, lock wait, and outbox lag.

The central mental model:

> Transaction boundary is not a technical decoration. It is the formal boundary of what your system promises to make consistent.

---

## 40. Latihan / Scenario

### Scenario 1 — Submit Application

Sebuah application bisa berada di status `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`.

Saat submit:

- status berubah dari `DRAFT` ke `SUBMITTED`;
- submission number dibuat;
- audit trail dibuat;
- email confirmation dikirim;
- downstream case creation service diberi event;
- user bisa double-click submit;
- API gateway bisa retry request saat timeout.

Tugas:

1. Tentukan operasi mana yang harus dalam satu DB transaction.
2. Tentukan operasi mana yang harus via outbox.
3. Desain idempotency key.
4. Buat failure matrix.
5. Tentukan unique constraint apa yang diperlukan.

### Scenario 2 — Approve Case

Officer approve case. Jika approve berhasil, audit harus ada. Jika approve gagal karena unexpected error, failure log tetap harus tersimpan.

Tugas:

1. Tentukan transaction boundary approval.
2. Tentukan apakah failure log perlu `REQUIRES_NEW`.
3. Jelaskan risiko jika audit approval memakai `REQUIRES_NEW`.
4. Jelaskan cara handle concurrent approval oleh dua officer.

### Scenario 3 — Batch Recalculate Risk Score

Job malam menghitung ulang risk score untuk 1 juta case.

Tugas:

1. Apakah boleh satu transaction besar? Jelaskan.
2. Desain chunking strategy.
3. Bagaimana menyimpan progress?
4. Bagaimana retry item gagal?
5. Bagaimana menghindari memory bloat persistence context?

### Scenario 4 — External Registry Notification

Setelah license approved, sistem harus notify external registry. Registry kadang timeout tetapi request sebenarnya berhasil.

Tugas:

1. Jelaskan kenapa notify registry tidak ideal di dalam approval transaction.
2. Desain outbox event.
3. Desain idempotency key ke registry.
4. Jelaskan compensation/manual intervention bila registry terus gagal.

### Scenario 5 — Search Index Update

Setelah case updated, search index harus terupdate agar listing officer akurat.

Tugas:

1. Apakah search index update harus satu transaction dengan DB?
2. Desain eventual indexing flow.
3. Bagaimana menangani event lama yang datang setelah event baru?
4. Apa metric yang harus dimonitor?

---

## 41. Referensi

- Jakarta Transactions 2.0 Specification — transaction interfaces between application, transaction manager, resource manager, and application server.
- Jakarta EE Tutorial — Transactions.
- Jakarta Transactions `@Transactional` API documentation.
- Spring Framework Reference — Declarative Transaction Management, rollback rules, and propagation.
- Hibernate ORM User Guide — Session, persistence context, transaction, flushing.
- Martin Fowler, *Patterns of Enterprise Application Architecture* — Unit of Work, Repository, Transaction Script.
- Chris Richardson, *Microservices Patterns* — Transactional Outbox, Saga, Idempotent Consumer.

---

## 42. Status Seri

Part ini adalah **Part 011 dari 032**.

Seri belum selesai.

Part berikutnya:

```text
Part 012 — Isolation Levels and Concurrency Anomalies
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-010.md">⬅️ Part 010 — Transaction Fundamentals: ACID, Local Transactions, JTA, Resource Managers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-012.md">Part 012 — Isolation Levels and Concurrency Anomalies ➡️</a>
</div>
