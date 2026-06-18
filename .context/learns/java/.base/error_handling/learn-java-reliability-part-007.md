# learn-java-reliability-part-007.md

# Part 007 — Validation, Preconditions, Invariants, and Illegal States

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability  
> Fokus: bagaimana validation menjadi mekanisme menjaga correctness, state integrity, dan reliability, bukan sekadar pemeriksaan input.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi tentang:

1. failure sebagai fenomena sistemik;
2. Java exception semantics;
3. taxonomy exception untuk enterprise system;
4. fail-fast, fail-safe, fail-closed, fail-open;
5. error contract untuk API;
6. exception translation antar-layer.

Part ini membahas pertanyaan yang lebih fundamental:

> Bagaimana mencegah sistem masuk ke state yang salah sebelum exception, retry, compensation, atau incident response diperlukan?

Jawabannya adalah: **validation, preconditions, invariants, dan illegal-state handling**.

Di banyak codebase enterprise, validation sering diperlakukan sebagai hal dangkal:

- field tidak boleh null;
- string tidak boleh kosong;
- angka harus positif;
- format email harus valid;
- tanggal harus diisi.

Itu penting, tetapi itu baru level paling luar.

Dalam sistem yang serius, terutama regulatory system, payment system, case management, workflow engine, approval engine, enforcement lifecycle, atau distributed backend, validation adalah bagian dari **state governance**:

- apakah command ini legal untuk state saat ini?
- apakah user boleh melakukan action ini?
- apakah transition ini menjaga invariant?
- apakah entity masih konsisten setelah mutation?
- apakah side effect boleh dilakukan sekarang?
- apakah request ini valid secara syntactic tetapi salah secara business?
- apakah state yang ditemukan adalah user error, stale data, race condition, atau bug?

Part ini akan membedah semuanya secara sistematis.

---

## 1. Core Problem

### 1.1 Masalah utama

Sistem tidak rusak hanya karena exception dilempar.

Sistem rusak ketika ia:

1. menerima input yang tidak valid;
2. menjalankan command pada state yang salah;
3. membiarkan invariant domain dilanggar;
4. melakukan side effect sebelum semua syarat aman terpenuhi;
5. menyimpan data yang tidak lagi bisa dipertanggungjawabkan;
6. menganggap illegal state sebagai kasus normal;
7. menangkap exception lalu melanjutkan proses seolah-olah tidak terjadi apa-apa.

Validation adalah mekanisme untuk menghentikan sistem **sebelum** state corruption terjadi.

---

### 1.2 Kesalahan framing yang umum

Banyak developer berpikir:

> Validation adalah urusan controller/request DTO.

Ini framing yang lemah.

Validation seharusnya dipahami sebagai beberapa lapisan berbeda:

| Layer | Pertanyaan | Contoh |
|---|---|---|
| Transport validation | Apakah payload bisa diparse? | JSON valid, field ada |
| Syntactic validation | Apakah bentuk data valid? | email format, date format |
| Semantic validation | Apakah makna data valid? | startDate <= endDate |
| Authorization validation | Apakah actor boleh? | officer assigned to case |
| State validation | Apakah action legal pada state ini? | cannot approve closed case |
| Domain invariant | Apakah aturan inti tetap benar? | approved amount <= requested amount |
| Persistence constraint | Apakah data valid menurut DB? | unique key, FK, not null |
| Operational guard | Apakah sistem sedang boleh menerima kerja? | not draining, dependency available |

Kalau semua validation hanya ditaruh di controller, domain model dan service layer menjadi rapuh.

---

### 1.3 Masalah yang ingin dihindari

Part ini bertujuan mencegah jenis bug berikut:

```java
public void approveCase(UUID caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    c.setStatus(APPROVED);
    caseRepository.save(c);
    emailService.sendApprovalEmail(c);
}
```

Kode di atas terlihat sederhana, tetapi secara reliability banyak lubang:

- Apakah case boleh di-approve dari status saat ini?
- Apakah user memiliki authority?
- Apakah semua mandatory review sudah complete?
- Apakah ada pending appeal?
- Apakah case sudah closed oleh request lain?
- Apakah save berhasil sebelum email dikirim?
- Apakah email boleh dikirim jika transaksi rollback?
- Apakah duplicate approve request aman?
- Apakah approve adalah state transition legal?
- Apakah approved state punya invariant tambahan?

Tanpa validation dan invariant yang eksplisit, sistem hanya “berharap” data tetap benar.

Reliability tidak boleh dibangun di atas harapan.

---

## 2. Mental Model

### 2.1 Validation sebagai gate

Validation adalah **gate**.

Gate adalah titik keputusan sebelum sistem bergerak ke state berikutnya.

```text
Input / Command / Event
        |
        v
+-------------------+
| Validation Gate   |
+-------------------+
   | valid      | invalid
   v            v
 Proceed     Reject / Stop / Repair / Escalate
```

Validation yang baik menjawab:

1. Apa yang sedang divalidasi?
2. Terhadap aturan apa?
3. Di layer mana aturan ini seharusnya berada?
4. Jika gagal, siapa yang bisa memperbaiki?
5. Apakah kegagalan ini expected atau unexpected?
6. Apakah boleh retry?
7. Apakah boleh menghasilkan side effect sebelum validasi selesai?

---

### 2.2 Preconditions sebagai kontrak sebelum operasi

Precondition adalah syarat yang harus benar **sebelum** suatu operasi dijalankan.

Contoh:

```java
void assignOfficer(CaseId caseId, OfficerId officerId) {
    requireNonNull(caseId, "caseId must not be null");
    requireNonNull(officerId, "officerId must not be null");

    Case c = caseRepository.getRequired(caseId);

    if (c.isClosed()) {
        throw new CaseAlreadyClosedException(caseId);
    }

    if (!officerDirectory.exists(officerId)) {
        throw new OfficerNotFoundException(officerId);
    }

    c.assignOfficer(officerId);
}
```

Precondition menjawab:

> Apakah operasi ini boleh dimulai?

Precondition yang gagal biasanya berarti operasi belum boleh dijalankan.

---

### 2.3 Invariant sebagai kebenaran yang harus selalu dijaga

Invariant adalah aturan yang harus tetap benar **sepanjang hidup object, aggregate, workflow, atau sistem**.

Contoh invariant:

- case closed tidak boleh punya pending mandatory task;
- approved amount tidak boleh lebih besar dari requested amount;
- application tidak boleh `APPROVED` jika required document belum verified;
- user tidak boleh memiliki dua active session dengan same device policy jika aturan melarang;
- appeal hanya boleh dibuat untuk decision yang appealable;
- transition dari `REJECTED` ke `APPROVED` harus melalui `REOPENED`, bukan langsung.

Invariant bukan sekadar validation request.

Invariant adalah **aturan eksistensi state**.

Kalau invariant dilanggar, data yang tersimpan mungkin sudah tidak representable secara benar.

---

### 2.4 Illegal state sebagai alarm desain

Illegal state adalah state yang seharusnya tidak mungkin terjadi jika semua invariant dijaga.

Contoh:

```text
Case status = CLOSED
but closureReason = null
```

Atau:

```text
Application status = APPROVED
but approvedBy = null
```

Atau:

```text
Payment status = PAID
but paidAt = null
```

Illegal state berbeda dari validation error biasa.

Validation error biasa:

> User mengirim request yang salah.

Illegal state:

> Sistem menemukan data internal yang tidak konsisten.

Ini harus diperlakukan lebih serius.

---

## 3. Conceptual Taxonomy

### 3.1 Input validation

Input validation memeriksa apakah request dari luar memiliki bentuk yang dapat diterima.

Contoh:

- field wajib ada;
- max length;
- pattern;
- numeric range;
- date format;
- enum value valid;
- collection tidak kosong.

Biasanya cocok ditaruh di:

- DTO;
- controller boundary;
- API adapter;
- message consumer boundary.

Contoh dengan Jakarta Validation:

```java
public record CreateCaseRequest(
        @NotBlank String applicantName,
        @NotNull CaseType caseType,
        @Size(max = 500) String remarks
) {}
```

Jakarta Validation menyediakan constraint declaration dan validation facility di object level untuk Java application, termasuk validasi parameter dan return value method/constructor.

---

### 3.2 Semantic validation

Semantic validation memeriksa apakah kombinasi data masuk akal.

Contoh:

```java
public record SearchCaseRequest(
        LocalDate fromDate,
        LocalDate toDate
) {
    public SearchCaseRequest {
        if (fromDate != null && toDate != null && fromDate.isAfter(toDate)) {
            throw new InvalidDateRangeException(fromDate, toDate);
        }
    }
}
```

`fromDate` dan `toDate` masing-masing valid secara syntactic, tetapi kombinasi keduanya bisa salah.

Semantic validation biasanya tidak cukup dengan annotation sederhana.

---

### 3.3 Business rule validation

Business rule validation memeriksa aturan bisnis yang bisa bergantung pada state saat ini.

Contoh:

- case tidak boleh di-assign ke officer yang inactive;
- appeal hanya boleh dibuat maksimal 30 hari setelah decision;
- renewal hanya boleh dilakukan jika license masih eligible;
- inspection cannot be scheduled before application is accepted.

Business rule sering membutuhkan:

- repository lookup;
- external reference data;
- current actor;
- current time;
- state machine;
- policy/rule engine.

---

### 3.4 State transition validation

State transition validation memeriksa apakah perpindahan state legal.

Contoh:

```text
DRAFT -> SUBMITTED        allowed
SUBMITTED -> UNDER_REVIEW allowed
UNDER_REVIEW -> APPROVED  allowed
UNDER_REVIEW -> REJECTED  allowed
APPROVED -> DRAFT         forbidden
CLOSED -> APPROVED        forbidden
```

Implementasi buruk:

```java
caseEntity.setStatus(APPROVED);
```

Implementasi lebih baik:

```java
caseEntity.approve(decision, actor, clock);
```

Mengapa?

Karena method `approve` dapat menjaga transition guard dan invariant internal.

---

### 3.5 Preconditions

Precondition memeriksa syarat sebelum operation.

Contoh:

```java
public Money transfer(Account from, Account to, Money amount) {
    Objects.requireNonNull(from, "from account is required");
    Objects.requireNonNull(to, "to account is required");
    Objects.requireNonNull(amount, "amount is required");

    if (!amount.isPositive()) {
        throw new IllegalArgumentException("transfer amount must be positive");
    }

    if (!from.canDebit(amount)) {
        throw new InsufficientBalanceException(from.id(), amount);
    }

    from.debit(amount);
    to.credit(amount);
    return amount;
}
```

Precondition tidak semuanya domain exception.

- null argument pada internal method bisa `NullPointerException`/`IllegalArgumentException`;
- business rule failure sebaiknya domain exception;
- authorization failure sebaiknya security exception atau domain authorization exception;
- stale state sebaiknya conflict exception.

---

### 3.6 Postconditions

Postcondition adalah kondisi yang harus benar setelah operasi selesai.

Contoh:

```java
Case c = caseService.approve(command);

if (!c.isApproved()) {
    throw new InvariantViolationException("approve completed but case is not approved");
}
```

Dalam practice, postcondition sering diwujudkan sebagai:

- assertion internal;
- test assertion;
- domain invariant check;
- database constraint;
- audit consistency check;
- reconciliation job.

Postcondition penting untuk menemukan bug di logic internal.

---

### 3.7 Invariants

Invariant adalah kondisi yang harus benar sebelum dan sesudah setiap public operation pada object/aggregate.

Contoh aggregate:

```java
public final class CaseAggregate {
    private CaseStatus status;
    private OfficerId assignedOfficer;
    private Instant closedAt;
    private String closureReason;

    public void close(String reason, Actor actor, Clock clock) {
        if (status == CaseStatus.CLOSED) {
            throw new CaseAlreadyClosedException();
        }
        if (reason == null || reason.isBlank()) {
            throw new MissingClosureReasonException();
        }

        this.status = CaseStatus.CLOSED;
        this.closedAt = clock.instant();
        this.closureReason = reason;

        assertInvariants();
    }

    private void assertInvariants() {
        if (status == CaseStatus.CLOSED) {
            if (closedAt == null) {
                throw new InvariantViolationException("closed case must have closedAt");
            }
            if (closureReason == null || closureReason.isBlank()) {
                throw new InvariantViolationException("closed case must have closure reason");
            }
        }
    }
}
```

Key point:

> Invariant tidak boleh hanya dicek di controller, karena object dapat dimodifikasi dari path lain.

---

### 3.8 Database constraints

Database constraint adalah safety net penting:

- `NOT NULL`;
- `UNIQUE`;
- foreign key;
- check constraint;
- exclusion constraint;
- trigger;
- generated column;
- optimistic locking version.

Tetapi DB constraint bukan pengganti domain invariant sepenuhnya.

DB constraint kuat untuk:

- simple structural rule;
- uniqueness;
- referential integrity;
- race-condition guard.

DB constraint lemah untuk:

- workflow rule kompleks;
- policy yang berubah;
- multi-step validation;
- external dependency validation;
- user-context-dependent rule.

Prinsipnya:

> Domain layer menjaga meaning. Database menjaga last line of defense.

---

## 4. Validation Placement: Di Mana Seharusnya Aturan Berada?

### 4.1 Jangan semua ditaruh di controller

Controller validation bagus untuk request shape.

Tapi jika semua aturan bisnis ditaruh di controller, maka aturan itu mudah dilewati oleh:

- batch job;
- message consumer;
- internal service call;
- admin tool;
- migration script;
- scheduled task;
- test helper;
- future API endpoint.

Contoh buruk:

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<?> approve(@PathVariable UUID id) {
    Case c = caseRepository.findById(id).orElseThrow();

    if (c.getStatus() != UNDER_REVIEW) {
        throw new BadRequestException("case cannot be approved");
    }

    c.setStatus(APPROVED);
    caseRepository.save(c);
    return ResponseEntity.ok().build();
}
```

Masalah:

- state rule berada di controller;
- domain object bisa dimutasi sembarang;
- tidak ada pusat aturan;
- future endpoint bisa lupa rule yang sama;
- setter membuka illegal transition.

Lebih baik:

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<?> approve(@PathVariable UUID id, @Valid @RequestBody ApproveCaseRequest request) {
    caseApplicationService.approve(new ApproveCaseCommand(id, request.decisionNote()));
    return ResponseEntity.noContent().build();
}
```

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseAggregate c = caseRepository.getRequired(command.caseId());
    c.approve(command.decisionNote(), currentActor(), clock);
    caseRepository.save(c);
}
```

```java
public void approve(String decisionNote, Actor actor, Clock clock) {
    ensureCanApprove(actor);
    ensureRequiredReviewsComplete();
    ensureStatus(UNDER_REVIEW);

    this.status = APPROVED;
    this.approvedBy = actor.id();
    this.approvedAt = clock.instant();
    this.decisionNote = requireDecisionNote(decisionNote);

    assertInvariants();
}
```

---

### 4.2 Layer responsibility matrix

| Layer | Responsibility | Example |
|---|---|---|
| Controller/API adapter | Protocol and shape validation | JSON, path param, DTO constraints |
| Application service | Use-case orchestration and cross-aggregate preconditions | load case, check actor context, call domain |
| Domain entity/aggregate | Core invariant and state transition rule | approve, reject, close |
| Domain service | Domain rule needing multiple objects | eligibility calculation |
| Repository | Persistence access and data consistency | optimistic lock, unique key |
| Database | Hard integrity safety net | FK, unique, not null |
| Message consumer | Message envelope and idempotency validation | duplicate message, schema version |
| External adapter | Provider-specific response validation | schema drift, status mapping |

---

### 4.3 Practical rule of thumb

Gunakan aturan berikut:

1. **Kalau rule hanya tentang bentuk request**, taruh di DTO/boundary.
2. **Kalau rule menentukan apakah use case boleh dimulai**, taruh di application service.
3. **Kalau rule menentukan apakah object boleh berubah state**, taruh di domain object/aggregate.
4. **Kalau rule membutuhkan beberapa aggregate**, pertimbangkan domain service atau application-level policy.
5. **Kalau rule harus tetap benar walaupun ada race**, dukung dengan DB constraint/locking.
6. **Kalau failure berarti data internal corrupt**, perlakukan sebagai invariant violation, bukan bad request.

---

## 5. Exception Choice: Exception Apa untuk Validation Failure?

### 5.1 Jangan semua menjadi `IllegalArgumentException`

`IllegalArgumentException` cocok untuk internal programming contract: argument method tidak sesuai ekspektasi method tersebut.

Contoh wajar:

```java
public Percentage(int value) {
    if (value < 0 || value > 100) {
        throw new IllegalArgumentException("percentage must be between 0 and 100");
    }
    this.value = value;
}
```

Tetapi untuk business failure, lebih baik gunakan domain exception:

```java
if (!caseEntity.canApprove()) {
    throw new CaseCannotBeApprovedException(caseEntity.id(), caseEntity.status());
}
```

Karena `IllegalArgumentException` terlalu generic untuk API contract, incident analysis, metrics, dan client behavior.

---

### 5.2 `IllegalStateException` untuk state internal yang tidak sesuai operation

`IllegalStateException` cocok ketika object berada dalam state yang membuat operation tidak legal.

Contoh:

```java
public void start() {
    if (started) {
        throw new IllegalStateException("processor already started");
    }
    started = true;
}
```

Tetapi dalam domain enterprise, sering lebih baik memakai exception yang lebih spesifik:

```java
throw new CaseAlreadyClosedException(caseId);
throw new ApplicationAlreadySubmittedException(applicationId);
throw new WorkflowTransitionNotAllowedException(from, to);
```

Kenapa?

Karena exception spesifik membawa semantic signal lebih kuat.

---

### 5.3 Validation exception untuk input/client-correctable error

Gunakan validation exception jika client bisa memperbaiki request.

Contoh:

- missing field;
- invalid format;
- date range invalid;
- max length exceeded;
- invalid enum;
- malformed identifier.

Mapping API biasanya:

```text
400 Bad Request
```

Atau untuk semantic domain validation tertentu:

```text
422 Unprocessable Content
```

Tetapi status HTTP harus konsisten dengan API standard internal yang sudah disepakati.

---

### 5.4 Conflict exception untuk stale state atau race

Jika request valid tetapi tidak bisa dilakukan karena state resource sudah berubah, gunakan conflict semantics.

Contoh:

- approve case yang sudah approved oleh officer lain;
- update dengan stale version;
- create duplicate idempotency key dengan different payload;
- submit application yang sudah submitted;
- cancel item yang already shipped.

Mapping API biasanya:

```text
409 Conflict
```

Contoh:

```java
throw new CaseStateConflictException(
    caseId,
    expectedStatus,
    actualStatus
);
```

---

### 5.5 Invariant violation untuk impossible state

Invariant violation bukan client error.

Contoh:

```java
if (status == APPROVED && approvedAt == null) {
    throw new InvariantViolationException("approved case must have approvedAt");
}
```

Mapping API biasanya:

```text
500 Internal Server Error
```

Tapi operational treatment-nya harus lebih serius:

- log as error;
- include correlation ID;
- alert jika sering atau high impact;
- block side effect;
- create repair/reconciliation task;
- investigate data corruption path.

---

### 5.6 Authorization failure bukan validation biasa

Jangan campur authorization dengan validation biasa.

Contoh:

```java
if (!actor.canApprove(caseEntity)) {
    throw new AccessDeniedException("actor cannot approve this case");
}
```

Mapping API:

```text
403 Forbidden
```

Bukan:

```text
400 Bad Request
```

Kenapa?

Karena request mungkin valid, tetapi actor tidak berhak.

---

## 6. Validation Timing

### 6.1 Validate before side effect

Prinsip utama:

> Semua validation yang bisa dilakukan sebelum side effect harus dilakukan sebelum side effect.

Buruk:

```java
emailService.sendNotification(command.email());

if (!caseEntity.canSubmit()) {
    throw new CaseCannotBeSubmittedException();
}

caseEntity.submit();
```

Jika validation gagal, email sudah terkirim.

Lebih baik:

```java
if (!caseEntity.canSubmit()) {
    throw new CaseCannotBeSubmittedException();
}

caseEntity.submit();
caseRepository.save(caseEntity);

outbox.publish(new CaseSubmittedEvent(caseEntity.id()));
```

Email dikirim lewat outbox/event setelah transaction commit.

---

### 6.2 Validate before mutation

Buruk:

```java
caseEntity.setStatus(APPROVED);

if (!caseEntity.hasRequiredDocuments()) {
    throw new MissingRequiredDocumentException();
}
```

Object sempat berada dalam state invalid.

Lebih baik:

```java
caseEntity.approve(actor, clock);
```

Di dalam `approve`, semua guard dicek sebelum mutation.

---

### 6.3 Validate after load

Setelah load dari database, jangan langsung percaya state.

Untuk sistem yang kompleks, terutama data lama/migration/manual patch, object yang di-load bisa sudah inconsistent.

Contoh:

```java
CaseAggregate c = caseRepository.getRequired(caseId);
c.assertReadableState();
```

Atau validasi dilakukan saat reconstruct aggregate:

```java
public static CaseAggregate rehydrate(CaseSnapshot snapshot) {
    CaseAggregate c = new CaseAggregate(snapshot);
    c.assertInvariants();
    return c;
}
```

Trade-off:

- strict invariant on every load membantu mendeteksi data corruption cepat;
- tetapi bisa membuat sistem tidak bisa membaca data historis rusak;
- untuk legacy system, bisa pakai tolerant read + repair workflow.

---

### 6.4 Validate at transaction boundary

Beberapa validation harus berada di dalam transaction agar tidak terkena race.

Contoh:

```java
@Transactional
public void submit(ApplicationId id) {
    Application app = repository.getForUpdate(id);

    if (app.isSubmitted()) {
        throw new ApplicationAlreadySubmittedException(id);
    }

    app.submit(clock.instant());
    repository.save(app);
}
```

Jika validation dilakukan sebelum transaction, state bisa berubah sebelum write.

---

### 6.5 Validate at persistence boundary

DB constraint penting sebagai last defense.

Contoh idempotency:

```sql
CREATE UNIQUE INDEX uq_payment_request_idempotency
ON payment_request(idempotency_key);
```

Application boleh mengecek duplicate terlebih dahulu, tetapi unique index tetap diperlukan untuk race.

Pattern:

1. application-level validation untuk error message yang baik;
2. DB constraint untuk atomic correctness;
3. exception translation untuk mengubah duplicate key menjadi domain conflict.

---

## 7. Designing Domain Invariants

### 7.1 Invariant harus ditulis sebagai kalimat domain

Sebelum coding, tulis invariant sebagai kalimat.

Contoh:

```text
A submitted application must have at least one applicant.
An approved application must have approval timestamp and approving officer.
A closed case must not have open mandatory tasks.
A rejected application must have rejection reason.
A renewal cannot be created for an expired license unless reinstatement flow is used.
```

Kalimat ini kemudian diubah menjadi:

- code guard;
- test case;
- database constraint jika memungkinkan;
- error code;
- audit rule;
- reconciliation rule.

---

### 7.2 Invariant harus dekat dengan state yang dijaganya

Jika invariant menjaga `CaseAggregate`, jangan taruh hanya di service.

Buruk:

```java
public void closeCase(UUID id, String reason) {
    Case c = repo.find(id);
    if (reason == null) throw ...;
    c.setStatus(CLOSED);
    c.setClosureReason(reason);
    repo.save(c);
}
```

Lebih baik:

```java
public void close(String reason, Actor actor, Instant now) {
    if (isClosed()) {
        throw new CaseAlreadyClosedException(id);
    }
    if (reason == null || reason.isBlank()) {
        throw new MissingClosureReasonException(id);
    }
    this.status = CLOSED;
    this.closedBy = actor.id();
    this.closedAt = now;
    this.closureReason = reason;
    assertInvariants();
}
```

---

### 7.3 Jangan expose setter untuk state penting

Setter generik adalah pintu bypass invariant.

Buruk:

```java
caseEntity.setStatus(APPROVED);
caseEntity.setApprovedAt(null);
```

Lebih baik:

```java
caseEntity.approve(actor, clock);
caseEntity.reject(reason, actor, clock);
caseEntity.reopen(reason, actor, clock);
caseEntity.close(reason, actor, clock);
```

State-changing method harus merepresentasikan domain command.

---

### 7.4 Gunakan enum transition table

Untuk workflow yang kompleks, gunakan transition table.

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

```java
final class CaseTransitions {
    private static final Map<CaseStatus, Set<CaseStatus>> ALLOWED = Map.of(
        DRAFT, Set.of(SUBMITTED),
        SUBMITTED, Set.of(UNDER_REVIEW, CLOSED),
        UNDER_REVIEW, Set.of(APPROVED, REJECTED, CLOSED),
        APPROVED, Set.of(CLOSED),
        REJECTED, Set.of(CLOSED),
        CLOSED, Set.of()
    );

    static void requireAllowed(CaseStatus from, CaseStatus to) {
        if (!ALLOWED.getOrDefault(from, Set.of()).contains(to)) {
            throw new WorkflowTransitionNotAllowedException(from, to);
        }
    }
}
```

Transition table membantu:

- review lebih mudah;
- test lebih sistematis;
- documentation lebih jelas;
- illegal transition bisa dideteksi konsisten.

---

### 7.5 Invariant tidak selalu sama dengan validation error

Contoh:

```text
User submits application without required document.
```

Ini expected business validation failure.

Tapi:

```text
Database contains APPROVED application without required document.
```

Ini invariant breach.

Same rule, different context, different severity.

---

## 8. Validation and State Machines

### 8.1 State machine sebagai validation engine

Workflow-heavy enterprise system sebaiknya tidak menyebar `if status == ...` ke banyak tempat.

Buruk:

```java
if (status == DRAFT || status == REJECTED || status == CLOSED) {
    throw new BadRequestException("cannot approve");
}
```

Masalah:

- logic tersebar;
- sulit tahu full transition graph;
- gampang lupa satu status;
- status baru bisa merusak behavior lama;
- error message tidak konsisten.

Lebih baik:

```java
caseWorkflow.requireTransition(currentStatus, APPROVED, APPROVE_ACTION);
```

---

### 8.2 State transition bukan hanya from-to

Transition sering membutuhkan guard tambahan.

Contoh:

```text
UNDER_REVIEW -> APPROVED
allowed only if:
- all mandatory checks completed;
- no unresolved compliance flag;
- actor has approval authority;
- decision note exists;
- case is not locked;
- current version matches command version.
```

Model:

```java
public void approve(ApproveCommand command, Actor actor, Clock clock) {
    transitionPolicy.requireAllowed(status, CaseAction.APPROVE);
    approvalPolicy.requireActorCanApprove(actor, this);
    reviewPolicy.requireAllMandatoryReviewsCompleted(this);
    compliancePolicy.requireNoBlockingFlags(this);
    requireNotLocked();

    this.status = APPROVED;
    this.approvedBy = actor.id();
    this.approvedAt = clock.instant();
    this.decisionNote = DecisionNote.of(command.note());

    assertInvariants();
}
```

---

### 8.3 Explicit transition result

Untuk use case yang perlu menampilkan alasan kegagalan tanpa exception, bisa pakai validation result.

```java
public TransitionCheck checkCanApprove(CaseAggregate c, Actor actor) {
    List<Violation> violations = new ArrayList<>();

    if (c.status() != UNDER_REVIEW) {
        violations.add(Violation.of("CASE_STATUS_INVALID", "Case is not under review"));
    }
    if (!actor.canApprove(c)) {
        violations.add(Violation.of("ACTOR_NOT_AUTHORIZED", "Actor cannot approve this case"));
    }
    if (!c.allMandatoryReviewsCompleted()) {
        violations.add(Violation.of("MANDATORY_REVIEW_INCOMPLETE", "Mandatory review is incomplete"));
    }

    return violations.isEmpty()
            ? TransitionCheck.allowed()
            : TransitionCheck.denied(violations);
}
```

Kemudian command execution tetap harus re-check.

Kenapa?

Karena pre-check untuk UI bisa stale.

```text
UI check: allowed at 10:00:00
Another user changes state at 10:00:01
User submits action at 10:00:02
Execution must validate again
```

---

## 9. Validation Result vs Exception

### 9.1 Kapan memakai exception

Gunakan exception jika:

- operation tidak dapat dilanjutkan;
- caller tidak diharapkan menangani banyak violation detail;
- violation adalah exceptional untuk code path tersebut;
- domain operation harus atomic;
- failure harus langsung propagate ke boundary;
- invariant breach terjadi.

Contoh:

```java
caseAggregate.approve(actor, clock);
```

Jika gagal, approve tidak terjadi.

---

### 9.2 Kapan memakai validation result

Gunakan validation result jika:

- ingin mengumpulkan banyak field error sekaligus;
- UI perlu menampilkan daftar violation;
- pre-check eligibility;
- batch import ingin memproses banyak row dan melaporkan semua error;
- rule evaluation perlu audit detail;
- dry-run mode.

Contoh:

```java
ValidationResult result = applicationValidator.validateDraft(application);
if (result.hasErrors()) {
    return result;
}
```

---

### 9.3 Jangan mengganti invariant exception dengan boolean

Buruk:

```java
if (!caseEntity.close(reason)) {
    return false;
}
```

Masalah:

- caller bisa ignore false;
- reason hilang;
- metrics sulit;
- error contract lemah;
- tidak jelas severity;
- state transition failure menjadi invisible.

Lebih baik:

```java
caseEntity.close(reason, actor, clock);
```

Jika gagal, exception spesifik dilempar.

---

### 9.4 Hybrid approach

Pattern yang sering baik:

1. `canXxx()` untuk UI/pre-check;
2. `xxx()` untuk execution dengan guard ulang dan exception;
3. `validateXxx()` untuk batch/dry-run dengan list violation.

Contoh:

```java
public boolean canApprove(Actor actor) {
    return approvalPolicy.check(this, actor).isAllowed();
}

public ApprovalCheck validateApproval(Actor actor) {
    return approvalPolicy.check(this, actor);
}

public void approve(Actor actor, Clock clock) {
    ApprovalCheck check = approvalPolicy.check(this, actor);
    if (!check.isAllowed()) {
        throw new CaseCannotBeApprovedException(id, check.violations());
    }
    applyApproval(actor, clock);
    assertInvariants();
}
```

---

## 10. Preconditions in Java Code

### 10.1 `Objects.requireNonNull`

Untuk internal mandatory argument:

```java
public CaseId(UUID value) {
    this.value = Objects.requireNonNull(value, "case id value is required");
}
```

Baik untuk programming error.

Tidak cukup untuk business validation.

---

### 10.2 Guard method

Buat guard method untuk readability.

```java
private void requireUnderReview() {
    if (status != CaseStatus.UNDER_REVIEW) {
        throw new CaseStatusConflictException(id, CaseStatus.UNDER_REVIEW, status);
    }
}

private void requireDecisionNote(String note) {
    if (note == null || note.isBlank()) {
        throw new MissingDecisionNoteException(id);
    }
}
```

Lalu:

```java
public void approve(String note, Actor actor, Clock clock) {
    requireUnderReview();
    requireDecisionNote(note);
    requireActorCanApprove(actor);

    this.status = APPROVED;
    this.approvedBy = actor.id();
    this.approvedAt = clock.instant();
    this.decisionNote = note;

    assertInvariants();
}
```

---

### 10.3 Value object sebagai validation boundary

Daripada validasi primitive berulang, buat value object.

Buruk:

```java
void submit(String postalCode) {
    if (postalCode == null || !postalCode.matches("\\d{6}")) {
        throw new InvalidPostalCodeException(postalCode);
    }
}
```

Lebih baik:

```java
public record PostalCode(String value) {
    public PostalCode {
        if (value == null || !value.matches("\\d{6}")) {
            throw new InvalidPostalCodeException(value);
        }
    }
}
```

Lalu domain/service memakai:

```java
PostalCode postalCode
```

Bukan:

```java
String postalCode
```

Keuntungan:

- validation centralized;
- impossible invalid value object;
- method signature lebih expressive;
- bug karena primitive confusion berkurang.

---

### 10.4 Sealed hierarchy untuk valid state modeling

Jika state punya varian dengan field berbeda, jangan selalu pakai satu class nullable.

Buruk:

```java
class Application {
    ApplicationStatus status;
    Instant submittedAt;
    Instant approvedAt;
    String rejectionReason;
}
```

Masalah:

- `approvedAt` null/required tergantung status;
- `rejectionReason` hanya valid untuk rejected;
- banyak invalid combination.

Alternatif dengan sealed type:

```java
sealed interface ApplicationState permits Draft, Submitted, Approved, Rejected {}

record Draft() implements ApplicationState {}
record Submitted(Instant submittedAt) implements ApplicationState {}
record Approved(Instant submittedAt, Instant approvedAt, OfficerId approvedBy) implements ApplicationState {}
record Rejected(Instant submittedAt, Instant rejectedAt, OfficerId rejectedBy, String reason) implements ApplicationState {}
```

Ini membuat illegal combination lebih sulit dibuat.

Trade-off:

- mapping ORM lebih kompleks;
- butuh design lebih matang;
- cocok untuk domain logic penting.

---

## 11. Validation with Jakarta/Spring

### 11.1 Jakarta Validation untuk DTO boundary

Contoh:

```java
public record SubmitApplicationRequest(
        @NotNull UUID applicationId,
        @NotBlank String applicantName,
        @NotNull LocalDate declarationDate,
        @Size(max = 1000) String remarks
) {}
```

Controller:

```java
@PostMapping("/applications/{id}/submit")
public ResponseEntity<Void> submit(
        @PathVariable UUID id,
        @Valid @RequestBody SubmitApplicationRequest request
) {
    applicationService.submit(toCommand(id, request));
    return ResponseEntity.noContent().build();
}
```

Spring mendukung Bean Validation melalui infrastructure dan adapter ke Spring `Validator`. Spring Boot juga dapat mengaktifkan method validation jika implementation Bean Validation tersedia di classpath dan target class memakai `@Validated`.

---

### 11.2 Method validation

Contoh:

```java
@Validated
@Service
public class CaseQueryService {
    public Page<CaseSummary> search(
            @NotNull LocalDate fromDate,
            @NotNull LocalDate toDate,
            @Positive int pageSize
    ) {
        // query
    }
}
```

Gunakan dengan hati-hati.

Method validation bagus untuk:

- boundary antar module;
- application service public method;
- library-like component;
- simple precondition.

Kurang cocok untuk:

- domain invariant kompleks;
- state transition rule;
- validation yang butuh rich error semantics.

---

### 11.3 Custom constraint

Contoh annotation:

```java
@Target({ FIELD, PARAMETER })
@Retention(RUNTIME)
@Constraint(validatedBy = PostalCodeValidator.class)
public @interface ValidPostalCode {
    String message() default "invalid postal code";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
public final class PostalCodeValidator implements ConstraintValidator<ValidPostalCode, String> {
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value != null && value.matches("\\d{6}");
    }
}
```

Gunakan custom constraint untuk syntactic/semantic field validation.

Jangan pakai annotation validation untuk rule domain yang membutuhkan aggregate state kompleks, kecuali desainnya benar-benar jelas.

---

### 11.4 Validation groups

Validation groups bisa dipakai untuk scenario berbeda.

Contoh:

```java
interface DraftValidation {}
interface SubmitValidation {}

public class ApplicationDto {
    @NotBlank(groups = SubmitValidation.class)
    private String applicantName;

    @NotNull(groups = SubmitValidation.class)
    private LocalDate declarationDate;
}
```

Hati-hati:

- validation groups bisa membuat aturan tersembunyi;
- sulit dibaca jika terlalu banyak;
- rule domain sering lebih jelas di service/domain method.

---

## 12. Illegal State Handling

### 12.1 Jangan treat illegal state sebagai normal bad request

Misal:

```java
if (application.status() == APPROVED && application.approvedAt() == null) {
    throw new BadRequestException("Invalid application");
}
```

Ini salah framing.

Client tidak menciptakan `approvedAt == null` secara langsung pada existing stored application.

Ini internal data inconsistency.

Lebih tepat:

```java
throw new InvariantViolationException(
    "approved application must have approvedAt",
    application.id()
);
```

---

### 12.2 Stop before side effect

Jika menemukan illegal state, jangan lanjutkan side effect.

Buruk:

```java
if (app.approvedAt() == null) {
    log.warn("approvedAt missing");
}
emailService.sendApproval(app);
```

Ini bisa mengirim email berdasarkan data rusak.

Lebih baik:

```java
app.assertConsistentForApprovalNotification();
emailOutbox.enqueueApprovalNotification(app.id());
```

---

### 12.3 Illegal state decision matrix

| Situation | Treatment |
|---|---|
| State invalid due to current request | validation error / 400 / 422 |
| State changed by concurrent actor | conflict / 409 |
| State violates internal invariant | invariant violation / 500 + alert |
| State invalid due to legacy data | block dangerous action + repair flow |
| State uncertain due to dependency timeout | retry/check status/reconcile |
| State cannot be interpreted | fail closed for critical operation |

---

### 12.4 Repair is separate from ignore

Kadang sistem harus bisa membaca data rusak untuk repair.

Tetapi membaca untuk repair berbeda dengan melanjutkan proses normal.

Pattern:

```java
Application app = repository.getPossiblyInconsistent(id);
ConsistencyReport report = consistencyChecker.check(app);

if (report.hasCriticalViolations()) {
    repairQueue.enqueue(app.id(), report);
    throw new DataConsistencyException(app.id(), report);
}
```

Repair flow harus eksplisit.

Jangan membuat normal flow diam-diam memperbaiki data tanpa audit jika domain sensitif.

---

## 13. Validation and Persistence Race Conditions

### 13.1 Application validation saja tidak cukup

Contoh duplicate username:

```java
if (userRepository.existsByUsername(username)) {
    throw new DuplicateUsernameException(username);
}

userRepository.save(new User(username));
```

Dua request concurrent bisa lolos `existsByUsername` bersamaan.

Solusi:

1. cek di application untuk UX/message;
2. enforce unique constraint di DB;
3. translate duplicate key exception menjadi conflict/domain exception.

---

### 13.2 Optimistic locking

Gunakan version untuk mencegah lost update.

```java
@Entity
class CaseEntity {
    @Version
    private long version;
}
```

Command membawa expected version:

```java
public record ApproveCaseCommand(
        CaseId caseId,
        long expectedVersion,
        String note
) {}
```

Jika version mismatch:

```text
409 Conflict
```

Bukan generic 500.

---

### 13.3 Pessimistic lock untuk critical transition

Jika transition sangat sensitif:

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
Optional<CaseEntity> findByIdForUpdate(UUID id);
```

Trade-off:

- lebih kuat untuk serializing transition;
- bisa menyebabkan lock wait;
- perlu timeout;
- risiko deadlock;
- harus dipakai selektif.

---

### 13.4 Constraint sebagai invariant enforcement

Contoh partial invariant:

```sql
ALTER TABLE application
ADD CONSTRAINT chk_approved_has_approved_at
CHECK (
    status <> 'APPROVED'
    OR approved_at IS NOT NULL
);
```

Tidak semua DB/check constraint cocok untuk semua domain rule, tetapi untuk invariant sederhana ini sangat kuat.

---

## 14. Validation and Distributed Systems

### 14.1 Cross-service validation adalah snapshot, bukan kebenaran abadi

Misal service A bertanya ke service B:

```text
Is license active?
```

B menjawab:

```text
Yes
```

Service A kemudian memproses command.

Masalah:

- status license bisa berubah setelah check;
- network response bisa stale;
- cache bisa lama;
- service B mungkin eventually consistent.

Jadi validation cross-service harus diperlakukan sebagai **time-bound evidence**, bukan absolute truth.

---

### 14.2 Hindari synchronous distributed invariant jika tidak perlu

Rule seperti:

```text
No customer may have more than 3 active applications across all services.
```

Jika enforce secara synchronous antar microservice, reliability turun:

- coupling tinggi;
- latency naik;
- dependency failure menggagalkan command;
- sulit scale;
- race tetap mungkin terjadi.

Alternatif:

- ownership satu service;
- reservation model;
- saga;
- eventual detection + compensation;
- centralized policy service;
- unique constraint pada single owner data store.

---

### 14.3 Validation event-driven

Dalam event-driven system, validation bisa terjadi sebelum atau setelah event.

Pre-validation:

```text
Command -> validate -> accept/reject -> publish event
```

Post-validation/reconciliation:

```text
Event -> project/read model -> detect inconsistency -> repair/compensate
```

Untuk rule kritikal, jangan hanya mengandalkan post-validation.

Untuk rule non-critical atau cross-boundary yang sulit atomic, reconciliation bisa menjadi mekanisme reliability.

---

## 15. Validation and API Error Contract

### 15.1 Field validation error

Contoh response:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "correlationId": "01HZX...",
  "errors": [
    {
      "field": "applicantName",
      "code": "REQUIRED",
      "message": "Applicant name is required"
    },
    {
      "field": "remarks",
      "code": "MAX_LENGTH_EXCEEDED",
      "message": "Remarks must not exceed 1000 characters"
    }
  ]
}
```

---

### 15.2 Domain validation error

```json
{
  "type": "https://api.example.com/problems/case-cannot-be-approved",
  "title": "Case cannot be approved",
  "status": 409,
  "code": "CASE_CANNOT_BE_APPROVED",
  "correlationId": "01HZX...",
  "details": {
    "caseId": "...",
    "currentStatus": "CLOSED",
    "requiredStatus": "UNDER_REVIEW"
  }
}
```

---

### 15.3 Invariant violation response

Jangan expose detail internal berlebihan ke client.

```json
{
  "type": "https://api.example.com/problems/internal-consistency-error",
  "title": "Internal consistency error",
  "status": 500,
  "code": "INTERNAL_CONSISTENCY_ERROR",
  "correlationId": "01HZX..."
}
```

Detail lengkap masuk log/operator evidence, bukan response publik.

---

## 16. Anti-Patterns

### 16.1 Validation hanya di frontend

Frontend validation bagus untuk UX, tetapi tidak punya authority.

Backend tetap wajib validate.

---

### 16.2 Validation hanya di controller

Ini membuat domain layer rapuh dan rule tersebar.

---

### 16.3 Generic exception untuk semua validation

Buruk:

```java
throw new RuntimeException("Invalid request");
```

Akibat:

- API mapping buruk;
- observability lemah;
- client tidak tahu corrective action;
- incident triage sulit.

---

### 16.4 Logging and continue

Buruk:

```java
try {
    validate(command);
} catch (Exception e) {
    log.warn("validation failed", e);
}

process(command);
```

Ini bukan resilience.

Ini state corruption waiting to happen.

---

### 16.5 Setter-driven domain mutation

Setter membuat invariant mudah dibypass.

---

### 16.6 Boolean failure without reason

Buruk:

```java
if (!service.process(command)) {
    return;
}
```

Failure menjadi invisible.

---

### 16.7 Overusing annotations for domain rule

Annotation validation cocok untuk simple constraints.

Domain rule kompleks lebih jelas di domain method/policy object.

---

### 16.8 Checking stale read model for critical command

Jangan menggunakan read model/cache untuk validasi command kritikal tanpa memahami staleness.

---

### 16.9 Converting invariant breach to 400

Ini menutupi bug/data corruption sebagai client error.

---

### 16.10 Ignoring DB constraint violation as “rare race”

Duplicate key/constraint violation adalah signal penting.

Harus diterjemahkan, dimonitor, dan dipahami.

---

## 17. Production Design Patterns

### 17.1 Guarded command method

```java
public void approve(ApproveCaseCommand command, Actor actor, Clock clock) {
    requireExpectedVersion(command.expectedVersion());
    requireStatus(CaseStatus.UNDER_REVIEW);
    requireActorCanApprove(actor);
    requireMandatoryReviewsCompleted();
    requireNoBlockingFlags();
    requireDecisionNote(command.note());

    applyApproved(actor, clock, command.note());
    assertInvariants();
}
```

---

### 17.2 Policy object

```java
public final class CaseApprovalPolicy {
    public ApprovalCheck check(CaseAggregate c, Actor actor) {
        List<Violation> violations = new ArrayList<>();

        if (c.status() != CaseStatus.UNDER_REVIEW) {
            violations.add(Violation.of("INVALID_STATUS"));
        }
        if (!actor.hasPermission("CASE_APPROVE")) {
            violations.add(Violation.of("ACTOR_NOT_ALLOWED"));
        }
        if (!c.hasCompletedMandatoryReviews()) {
            violations.add(Violation.of("MANDATORY_REVIEW_INCOMPLETE"));
        }

        return violations.isEmpty()
                ? ApprovalCheck.allowed()
                : ApprovalCheck.denied(violations);
    }
}
```

Good for:

- complex rules;
- reusable rule;
- UI pre-check;
- auditability;
- testability.

---

### 17.3 Specification pattern

```java
interface Specification<T> {
    boolean isSatisfiedBy(T candidate);
    String code();
}
```

Contoh:

```java
final class CaseUnderReviewSpec implements Specification<CaseAggregate> {
    public boolean isSatisfiedBy(CaseAggregate c) {
        return c.status() == CaseStatus.UNDER_REVIEW;
    }

    public String code() {
        return "CASE_MUST_BE_UNDER_REVIEW";
    }
}
```

Useful jika rule banyak dan composable.

Hati-hati jangan sampai over-engineering.

---

### 17.4 Invariant assertion method

```java
private void assertInvariants() {
    assertClosedStateValid();
    assertApprovedStateValid();
    assertRejectedStateValid();
}
```

Gunakan untuk state penting.

Jangan membuat method ini terlalu mahal untuk dipanggil di hot path tanpa alasan.

---

### 17.5 Domain error code enum

```java
public enum DomainErrorCode {
    CASE_NOT_FOUND,
    CASE_ALREADY_CLOSED,
    CASE_CANNOT_BE_APPROVED,
    CASE_STATUS_CONFLICT,
    MANDATORY_REVIEW_INCOMPLETE,
    INVARIANT_VIOLATION
}
```

Error code harus stabil dan bisa dipakai:

- API response;
- logs;
- metrics;
- alerting;
- documentation;
- support runbook.

---

## 18. Example End-to-End

### 18.1 Scenario

Use case:

> Officer approves a case.

Rules:

1. Case must exist.
2. Actor must have approval permission.
3. Case must be `UNDER_REVIEW`.
4. Mandatory review tasks must be complete.
5. No blocking compliance flag.
6. Decision note is required.
7. Case version must match expected version.
8. Approved case must have `approvedAt` and `approvedBy`.
9. Approval email must only be sent after commit.

---

### 18.2 Command

```java
public record ApproveCaseCommand(
        CaseId caseId,
        long expectedVersion,
        String decisionNote
) {
    public ApproveCaseCommand {
        Objects.requireNonNull(caseId, "caseId is required");
        if (expectedVersion < 0) {
            throw new IllegalArgumentException("expectedVersion must not be negative");
        }
    }
}
```

---

### 18.3 Application service

```java
@Service
public class ApproveCaseUseCase {
    private final CaseRepository caseRepository;
    private final CaseApprovalPolicy approvalPolicy;
    private final Outbox outbox;
    private final ActorProvider actorProvider;
    private final Clock clock;

    @Transactional
    public void approve(ApproveCaseCommand command) {
        Actor actor = actorProvider.currentActor();

        CaseAggregate c = caseRepository.getRequired(command.caseId());

        c.requireVersion(command.expectedVersion());
        c.approve(command.decisionNote(), actor, approvalPolicy, clock);

        caseRepository.save(c);
        outbox.add(CaseApprovedEvent.of(c.id()));
    }
}
```

---

### 18.4 Aggregate

```java
public final class CaseAggregate {
    private final CaseId id;
    private CaseStatus status;
    private long version;
    private OfficerId approvedBy;
    private Instant approvedAt;
    private String decisionNote;
    private List<ReviewTask> reviewTasks;
    private List<ComplianceFlag> complianceFlags;

    public void requireVersion(long expectedVersion) {
        if (this.version != expectedVersion) {
            throw new CaseVersionConflictException(id, expectedVersion, version);
        }
    }

    public void approve(
            String note,
            Actor actor,
            CaseApprovalPolicy policy,
            Clock clock
    ) {
        ApprovalCheck check = policy.check(this, actor, note);
        if (!check.isAllowed()) {
            throw new CaseCannotBeApprovedException(id, check.violations());
        }

        this.status = CaseStatus.APPROVED;
        this.approvedBy = actor.officerId();
        this.approvedAt = clock.instant();
        this.decisionNote = note.trim();

        assertInvariants();
    }

    private void assertInvariants() {
        if (status == CaseStatus.APPROVED) {
            if (approvedBy == null) {
                throw new InvariantViolationException(id, "approved case must have approvedBy");
            }
            if (approvedAt == null) {
                throw new InvariantViolationException(id, "approved case must have approvedAt");
            }
            if (decisionNote == null || decisionNote.isBlank()) {
                throw new InvariantViolationException(id, "approved case must have decisionNote");
            }
        }
    }
}
```

---

### 18.5 Policy

```java
public final class CaseApprovalPolicy {
    public ApprovalCheck check(CaseAggregate c, Actor actor, String note) {
        List<Violation> violations = new ArrayList<>();

        if (!actor.hasPermission(Permission.CASE_APPROVE)) {
            violations.add(Violation.of("ACTOR_NOT_AUTHORIZED"));
        }

        if (c.status() != CaseStatus.UNDER_REVIEW) {
            violations.add(Violation.of(
                    "CASE_STATUS_INVALID",
                    Map.of("actualStatus", c.status())
            ));
        }

        if (!c.allMandatoryReviewsComplete()) {
            violations.add(Violation.of("MANDATORY_REVIEW_INCOMPLETE"));
        }

        if (c.hasBlockingComplianceFlag()) {
            violations.add(Violation.of("BLOCKING_COMPLIANCE_FLAG_EXISTS"));
        }

        if (note == null || note.isBlank()) {
            violations.add(Violation.of("DECISION_NOTE_REQUIRED"));
        }

        return violations.isEmpty()
                ? ApprovalCheck.allowed()
                : ApprovalCheck.denied(violations);
    }
}
```

---

### 18.6 Exception mapping

```java
@ExceptionHandler(CaseCannotBeApprovedException.class)
ResponseEntity<ProblemDetail> handle(CaseCannotBeApprovedException ex) {
    ProblemDetail pd = ProblemDetail.forStatus(409);
    pd.setTitle("Case cannot be approved");
    pd.setProperty("code", "CASE_CANNOT_BE_APPROVED");
    pd.setProperty("caseId", ex.caseId().value());
    pd.setProperty("violations", ex.violations());
    return ResponseEntity.status(409).body(pd);
}
```

---

### 18.7 Why this design is reliable

Karena:

1. command validates primitive preconditions;
2. application service controls transaction boundary;
3. aggregate owns state transition;
4. policy evaluates complex rule;
5. version conflict prevents stale update;
6. invariant assertion catches impossible state;
7. outbox avoids email before commit;
8. exception is domain-specific;
9. API response can be mapped consistently;
10. test cases can target each rule explicitly.

---

## 19. Testing Validation and Invariants

### 19.1 Test domain transition

```java
@Test
void cannotApproveClosedCase() {
    CaseAggregate c = CaseAggregate.closedCase();

    assertThatThrownBy(() -> c.approve("ok", approver, policy, clock))
            .isInstanceOf(CaseCannotBeApprovedException.class);
}
```

---

### 19.2 Test invariant breach

```java
@Test
void approvedCaseMustHaveApprovedAt() {
    CaseAggregate c = CaseAggregate.testBuilder()
            .status(APPROVED)
            .approvedBy(officerId)
            .approvedAt(null)
            .buildUnsafe();

    assertThatThrownBy(c::assertInvariants)
            .isInstanceOf(InvariantViolationException.class);
}
```

---

### 19.3 Test API validation response

```java
mockMvc.perform(post("/cases/{id}/approve", caseId)
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"decisionNote\":\"\"}"))
    .andExpect(status().isBadRequest())
    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
```

---

### 19.4 Test conflict

```java
@Test
void staleVersionReturnsConflict() {
    approveCaseWithExpectedVersion(caseId, 1L)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASE_VERSION_CONFLICT"));
}
```

---

### 19.5 Test DB constraint translation

```java
@Test
void duplicateIdempotencyKeyBecomesConflict() {
    paymentService.create(requestWithKey("abc"));

    assertThatThrownBy(() -> paymentService.create(requestWithKey("abc")))
            .isInstanceOf(DuplicateIdempotencyKeyException.class);
}
```

---

## 20. Observability for Validation

### 20.1 Jangan log semua validation error sebagai ERROR

Field validation error dari client biasanya bukan server error.

Guideline:

| Failure | Log Level |
|---|---|
| Normal field validation | DEBUG/INFO sampled |
| Domain rejection expected | INFO, maybe metric |
| Conflict due to concurrent update | INFO/WARN depending frequency |
| Unauthorized access attempt | WARN/security audit depending context |
| Invariant violation | ERROR |
| DB constraint unexpected | ERROR |
| Repeated validation abuse | WARN/security signal |

---

### 20.2 Metrics penting

Track:

- validation failure count by code;
- domain rejection count by rule;
- conflict count;
- invariant violation count;
- DB constraint violation count;
- stale version count;
- authorization denial count;
- repair queue count.

Contoh metric labels:

```text
validation_failures_total{code="DECISION_NOTE_REQUIRED"}
domain_rejections_total{code="CASE_STATUS_INVALID"}
invariant_violations_total{aggregate="Case"}
state_conflicts_total{entity="Case"}
```

Hati-hati cardinality:

- jangan masukkan `caseId` sebagai label metric;
- simpan ID di log, bukan metric label.

---

### 20.3 Validation failure as product signal

Jika banyak user gagal karena rule tertentu, mungkin:

- UI tidak jelas;
- business rule terlalu rumit;
- documentation kurang;
- API contract membingungkan;
- upstream system mengirim data buruk;
- workflow design perlu diperbaiki.

Validation metrics bukan hanya technical signal.

Itu juga product/process signal.

---

## 21. Security and Compliance Considerations

### 21.1 Jangan expose sensitive validation detail

Contoh login:

Buruk:

```text
Email exists but password wrong
```

Lebih aman:

```text
Invalid credentials
```

Untuk authorization:

- jangan expose resource existence jika user tidak boleh tahu;
- pertimbangkan 404 vs 403 berdasarkan security policy;
- audit denial secara internal.

---

### 21.2 Jangan log PII dalam validation error

Buruk:

```java
log.warn("Invalid applicant NRIC: {}", nric);
```

Lebih baik:

```java
log.warn("Invalid applicant identifier format, correlationId={}", correlationId);
```

Jika perlu forensic detail, gunakan secure audit store dengan redaction policy.

---

### 21.3 Regulatory defensibility

Untuk sistem regulatory/case management, validation harus bisa menjawab:

1. Rule apa yang menyebabkan action ditolak?
2. Siapa actor-nya?
3. State saat itu apa?
4. Evidence apa yang digunakan?
5. Apakah rule berasal dari policy/config versi mana?
6. Apakah ada manual override?
7. Apakah denial terekam di audit trail?

Validation bukan hanya technical correctness, tetapi juga **defensibility**.

---

## 22. Checklist: Validation Design Review

Gunakan checklist ini saat review feature.

### 22.1 Input boundary

- [ ] Apakah request DTO punya constraint dasar?
- [ ] Apakah unknown/invalid enum ditangani jelas?
- [ ] Apakah field length dibatasi?
- [ ] Apakah date/time parsing jelas timezone-nya?
- [ ] Apakah nested object divalidasi?
- [ ] Apakah batch request punya batas ukuran?

### 22.2 Domain rule

- [ ] Apakah rule bisnis tidak hanya ada di controller?
- [ ] Apakah state transition dijaga di aggregate/domain method?
- [ ] Apakah setter bebas untuk status/state dihindari?
- [ ] Apakah invariant penting ditulis eksplisit?
- [ ] Apakah impossible state diperlakukan sebagai invariant violation?

### 22.3 Persistence consistency

- [ ] Apakah uniqueness critical dijaga DB constraint?
- [ ] Apakah optimistic locking dipakai untuk lost update?
- [ ] Apakah stale update dimap ke conflict?
- [ ] Apakah DB constraint exception diterjemahkan?
- [ ] Apakah transaction boundary mencakup validation yang butuh atomicity?

### 22.4 Distributed validation

- [ ] Apakah external validation dianggap stale/time-bound?
- [ ] Apakah dependency failure punya strategy?
- [ ] Apakah cross-service invariant benar-benar perlu synchronous?
- [ ] Apakah ada reconciliation untuk eventual inconsistency?

### 22.5 Error contract

- [ ] Apakah validation failure punya stable error code?
- [ ] Apakah field errors structured?
- [ ] Apakah domain rejection berbeda dari invariant violation?
- [ ] Apakah sensitive detail tidak bocor?
- [ ] Apakah correlation ID tersedia?

### 22.6 Observability

- [ ] Apakah validation failure dimetric-kan per code?
- [ ] Apakah invariant violation alertable?
- [ ] Apakah log level sesuai severity?
- [ ] Apakah high-cardinality label dihindari?
- [ ] Apakah denial penting masuk audit trail?

### 22.7 Testing

- [ ] Apakah setiap transition forbidden dites?
- [ ] Apakah boundary validation dites?
- [ ] Apakah conflict/race path dites?
- [ ] Apakah DB constraint violation translation dites?
- [ ] Apakah invariant breach test tersedia?

---

## 23. Heuristics Engineer Senior

### 23.1 Treat validation as state protection

Jangan bertanya:

> Field apa yang wajib?

Tanya:

> State apa yang ingin saya lindungi?

---

### 23.2 Move rules toward the owner of the state

Rule yang menjaga state harus dekat dengan state.

Jika rule tersebar, invariant akan bocor.

---

### 23.3 Prefer explicit domain verbs over setters

`approve()`, `reject()`, `close()`, `submit()` lebih aman daripada `setStatus()`.

---

### 23.4 Every validation failure needs ownership

Untuk setiap failure, tanyakan:

- client bisa memperbaiki?
- user bisa memperbaiki?
- operator harus memperbaiki?
- developer harus memperbaiki?
- sistem harus retry?
- sistem harus compensate?

---

### 23.5 Invariant breach is not business as usual

Jika invariant breach terjadi, jangan normalize.

Itu signal bahwa sistem punya bug, migration issue, race condition, atau manual data patch yang salah.

---

### 23.6 Validation before side effect

Jangan kirim email, publish event, call external API, atau mutate DB sebelum validation yang relevan selesai.

Jika side effect harus terjadi setelah commit, gunakan outbox.

---

### 23.7 UI pre-check is not enforcement

UI boleh menampilkan tombol disabled.

Backend tetap harus enforce.

---

### 23.8 DB constraint is not optional for race-sensitive rule

Jika rule harus benar secara concurrent, application check saja tidak cukup.

---

### 23.9 Avoid fake success

Jangan mengubah validation failure menjadi success response hanya agar user flow terlihat mulus.

Itu menciptakan data dan audit ambiguity.

---

### 23.10 Make invalid states unrepresentable when feasible

Gunakan value object, sealed types, constructor guard, dan encapsulated mutation agar invalid state sulit dibuat.

---

## 24. Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman.

1. Apa perbedaan input validation, business validation, dan invariant?
2. Mengapa validation tidak boleh hanya ada di controller?
3. Kapan `IllegalArgumentException` cocok digunakan?
4. Kapan domain-specific exception lebih baik daripada `IllegalStateException`?
5. Apa bedanya validation error dan conflict?
6. Apa bedanya conflict dan invariant violation?
7. Mengapa validation harus dilakukan sebelum side effect?
8. Mengapa UI pre-check tidak cukup?
9. Mengapa DB unique constraint tetap diperlukan walaupun application sudah cek duplicate?
10. Apa risiko menggunakan read model/cache untuk command validation?
11. Bagaimana mendesain validation untuk state transition `UNDER_REVIEW -> APPROVED`?
12. Bagaimana mapping API untuk field validation, domain rejection, stale version, dan invariant violation?
13. Apa yang harus dimonitor dari validation failure?
14. Bagaimana validation membantu regulatory defensibility?
15. Kapan validation result lebih baik daripada exception?

---

## 25. Summary

Validation adalah reliability primitive.

Validation yang matang bukan hanya mengecek field, tetapi menjaga sistem dari state yang tidak sah.

Mental model utama:

```text
Input validation protects boundary shape.
Semantic validation protects meaning.
Preconditions protect operation start.
State transition validation protects workflow legality.
Invariants protect object/system truth.
DB constraints protect atomic persistence correctness.
Observability protects operational understanding.
```

Prinsip paling penting:

1. Validate before mutation.
2. Validate before side effect.
3. Keep invariants close to the state they protect.
4. Treat illegal state as serious internal consistency failure.
5. Use domain-specific exceptions for domain failure.
6. Use DB constraints for race-sensitive guarantees.
7. Do not confuse UI pre-check with backend enforcement.
8. Make invalid states unrepresentable where practical.
9. Map validation failures into clear API error contracts.
10. Monitor validation failure as reliability, security, and product signal.

---

## 26. Part Completion Status

```text
Part 007 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 008 — Graceful Shutdown Fundamentals
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 006 — Exception Translation Layers](./learn-java-reliability-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 008 — Graceful Shutdown Fundamentals](./learn-java-reliability-part-008.md)
