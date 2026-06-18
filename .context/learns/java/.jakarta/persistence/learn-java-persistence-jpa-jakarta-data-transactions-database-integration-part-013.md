# Part 013 — Optimistic Locking, Versioning, and State Machine Persistence

> Seri: Java Persistence, JPA, Jakarta Data, Jakarta Transactions, Database Integration  
> Rentang Java: Java 8 sampai Java 25  
> Fokus: correctness pada update concurrent, version column, stale update, state transition, compare-and-swap, audit/event separation, dan conflict handling untuk sistem workflow/case management.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami **optimistic locking** bukan sebagai annotation kecil `@Version`, tetapi sebagai mekanisme correctness untuk mencegah **lost update**.
2. Membedakan:
   - versioning untuk concurrency,
   - audit trail,
   - historical versioning,
   - event log,
   - business state version.
3. Mendesain entity dengan `@Version` secara benar.
4. Menentukan kapan optimistic locking cukup, kapan perlu pessimistic locking, dan kapan perlu database constraint atau conditional update.
5. Memahami kapan `OptimisticLockException` muncul: saat flush, query-triggered flush, atau commit.
6. Mendesain **state machine persistence** untuk workflow seperti application submission, approval, escalation, appeal, compliance case, dan regulatory decision.
7. Menghindari bug umum pada detached entity, REST update, frontend stale form, bulk update, dan retry yang salah.
8. Menangani conflict secara tepat:
   - auto retry,
   - user conflict resolution,
   - reload and reapply,
   - reject stale command,
   - idempotent transition.
9. Mendesain compare-and-swap update untuk transition yang harus atomic.
10. Menghubungkan optimistic locking dengan audit trail, outbox event, idempotency key, dan observability.

---

## 2. Mental Model

### 2.1 Masalah dasarnya: dua actor melihat dunia yang sama, lalu menulis versi berbeda

Bayangkan sebuah case:

```text
Case ID: C-1001
Status : UNDER_REVIEW
Officer: Alice
Version: 7
```

Dua user membuka halaman yang sama:

```text
T1: Alice membuka case version 7
T2: Bob membuka case version 7
```

Kemudian:

```text
T1: Alice mengubah risk score menjadi HIGH
T2: Bob mengubah officer remark menjadi "Looks acceptable"
```

Tanpa optimistic locking, update terakhir bisa menimpa hasil sebelumnya:

```text
Last commit wins.
```

Masalahnya bukan hanya data hilang. Dalam sistem workflow/regulatory, ini bisa berarti:

- keputusan approval menimpa rejection,
- officer assignment berubah tanpa disadari,
- escalation hilang,
- audit trail tidak merefleksikan konflik sebenarnya,
- user melihat status lama tapi melakukan action baru,
- SLA timer berjalan berdasarkan state yang salah.

Optimistic locking memaksa sistem bertanya:

```text
Apakah record yang saya update masih versi yang sama dengan yang saya baca sebelumnya?
```

Kalau tidak sama, update ditolak.

---

### 2.2 Optimistic berarti tidak mengunci saat membaca

Optimistic locking tidak seperti pessimistic locking.

Pessimistic locking:

```text
Saya akan membaca record ini, dan saya kunci dulu supaya orang lain tidak bisa mengubahnya.
```

Optimistic locking:

```text
Saya akan membaca record ini tanpa lock. Saat saya menulis nanti, saya validasi apakah record masih sama seperti saat saya baca.
```

Optimistic locking cocok jika:

- konflik jarang,
- user think time panjang,
- form bisa dibuka lama,
- throughput lebih penting daripada blocking,
- update conflict bisa ditangani dengan pesan ke user atau retry terbatas.

Tidak cocok jika:

- row sangat hot,
- conflict sangat sering,
- operasi harus serial secara ketat,
- retry akan selalu gagal karena contention tinggi,
- invariant tidak bisa dijaga hanya dengan version check satu row.

---

### 2.3 Version column adalah concurrency token

Entity dengan optimistic locking biasanya memiliki kolom seperti:

```sql
VERSION_NUMBER NUMBER NOT NULL
```

atau:

```sql
VERSION BIGINT NOT NULL
```

Di Java:

```java
@Version
@Column(name = "VERSION_NUMBER", nullable = false)
private long version;
```

Saat entity dibaca:

```sql
select id, status, risk_score, version_number
from cases
where id = ?;
```

Misalnya hasilnya:

```text
id      = 1001
status  = UNDER_REVIEW
version = 7
```

Saat update, provider ORM menghasilkan SQL secara konseptual seperti:

```sql
update cases
set status = ?, risk_score = ?, version_number = 8
where id = ?
  and version_number = 7;
```

Kalau row count = 1, update berhasil.

Kalau row count = 0, artinya:

```text
Tidak ada row dengan id tersebut dan version lama tersebut.
Kemungkinan record sudah diubah transaksi lain.
```

Maka ORM melempar optimistic locking exception.

---

### 2.4 Versioning concurrency bukan audit

Ini salah satu jebakan besar.

`@Version` bukan audit trail.

| Konsep | Pertanyaan yang dijawab |
|---|---|
| `@Version` | Apakah data yang saya tulis masih sama versinya dengan data yang saya baca? |
| Audit trail | Siapa mengubah apa, kapan, dari nilai apa ke nilai apa, dan kenapa? |
| Historical versioning | Apa isi record pada waktu tertentu? |
| Event log | Event domain apa yang terjadi dalam urutan apa? |
| Business revision | Revision bisnis yang dipahami user, misalnya application amendment v3 |

`@Version` boleh meningkat dari 7 ke 8. Itu tidak menjelaskan:

- siapa yang mengubah,
- apa field yang berubah,
- alasan perubahan,
- correlation id,
- request id,
- before/after value,
- approval context.

Jadi jangan pernah mengganti audit trail dengan `@Version`.

---

## 3. Konsep Utama

### 3.1 Lost update

Lost update terjadi saat dua transaksi membaca data yang sama, lalu keduanya menulis, dan satu update menghilangkan perubahan yang lain.

Contoh buruk:

```text
Initial:
  Case.status = UNDER_REVIEW
  Case.priority = NORMAL

T1 reads:
  status = UNDER_REVIEW
  priority = NORMAL

T2 reads:
  status = UNDER_REVIEW
  priority = NORMAL

T1 writes:
  priority = HIGH

T2 writes:
  status = APPROVED
  priority = NORMAL   <-- membawa nilai lama
```

Hasil akhir:

```text
status = APPROVED
priority = NORMAL
```

Update T1 hilang.

Dengan optimistic locking:

```text
T1 update where version = 1 => success, version becomes 2
T2 update where version = 1 => affected row 0 => conflict
```

---

### 3.2 Stale read dan stale command

Optimistic locking bukan hanya problem database transaction bersamaan. Dalam aplikasi web, konflik sering terjadi karena **stale command**.

Alurnya:

```text
10:00 User A membuka form case version 11
10:05 User B approve case, version menjadi 12
10:30 User A submit form lama version 11
```

Request User A membawa command berdasarkan state lama.

Kalau API hanya menerima:

```json
{
  "caseId": "C-1001",
  "remarks": "Please approve"
}
```

server tidak tahu user mengedit berdasarkan version berapa.

Lebih benar:

```json
{
  "caseId": "C-1001",
  "expectedVersion": 11,
  "remarks": "Please approve"
}
```

Server bisa memvalidasi:

```text
Saya hanya boleh menerapkan command ini kalau case masih version 11.
```

---

### 3.3 Optimistic locking berbasis managed entity

Dengan JPA/Jakarta Persistence:

```java
@Transactional
public void updateRiskScore(Long caseId, RiskScore newScore) {
    RegulatoryCase entity = entityManager.find(RegulatoryCase.class, caseId);
    entity.changeRiskScore(newScore);
}
```

Jika entity memiliki `@Version`, provider akan menyertakan version check saat flush/update.

Mental model:

```text
find()      -> load entity + version
change()    -> mark dirty in persistence context
flush()     -> update where id = ? and version = oldVersion
commit()    -> database commit jika flush sukses
```

Optimistic lock exception bisa muncul saat:

- explicit `flush()`;
- query yang memicu flush;
- transaction commit;
- API call tertentu seperti `lock()`;
- provider melakukan synchronization sebelum commit.

Karena itu exception handling harus berada di boundary transaction/use case, bukan di setter entity.

---

### 3.4 Optimistic locking berbasis command expected version

Pada API/command layer, version perlu dibawa sebagai concurrency token.

Contoh command:

```java
public record ApproveCaseCommand(
        Long caseId,
        long expectedVersion,
        String decisionReason,
        String actorId,
        String idempotencyKey
) {}
```

Use case:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    RegulatoryCase c = caseRepository.findById(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

    if (c.version() != command.expectedVersion()) {
        throw new StaleCaseCommandException(
                c.id(),
                command.expectedVersion(),
                c.version()
        );
    }

    c.approve(command.actorId(), command.decisionReason());

    auditTrail.recordDecision(c, command.actorId(), command.decisionReason());
    outbox.enqueue(CaseApprovedEvent.from(c, command.idempotencyKey()));
}
```

Version check di application layer memberi error yang lebih jelas ke user.

Tetapi version check ini **bukan pengganti** database-level optimistic locking. Dua request bisa tetap lolos check di memory jika bersamaan. `@Version` tetap menjaga final write.

---

## 4. API / Annotation / Mechanism

### 4.1 `@Version`

Contoh entity:

```java
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

@Entity
@Table(name = "REGULATORY_CASE")
public class RegulatoryCase {

    @Id
    @Column(name = "CASE_ID")
    private Long id;

    @Version
    @Column(name = "VERSION_NUMBER", nullable = false)
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(name = "STATUS", nullable = false, length = 40)
    private CaseStatus status;

    @Column(name = "ASSIGNED_OFFICER_ID", length = 80)
    private String assignedOfficerId;

    @Column(name = "DECISION_REASON", length = 1000)
    private String decisionReason;

    protected RegulatoryCase() {
        // Required by JPA
    }

    public long version() {
        return version;
    }

    public void approve(String actorId, String reason) {
        requireStatus(CaseStatus.UNDER_REVIEW);
        requireAssignedOfficer(actorId);
        this.status = CaseStatus.APPROVED;
        this.decisionReason = reason;
    }

    private void requireStatus(CaseStatus expected) {
        if (this.status != expected) {
            throw new IllegalStateException(
                    "Case must be " + expected + " but was " + this.status
            );
        }
    }

    private void requireAssignedOfficer(String actorId) {
        if (!actorId.equals(this.assignedOfficerId)) {
            throw new IllegalStateException("Only assigned officer can decide this case");
        }
    }
}
```

`@Version` biasanya ditempatkan pada:

- `int` / `Integer`,
- `long` / `Long`,
- `short` / `Short`,
- timestamp type tergantung provider/spec support.

Praktik umum untuk sistem enterprise:

```java
@Version
private long version;
```

Kenapa numeric version lebih disukai?

- sederhana,
- monotonic,
- mudah dipahami,
- tidak bergantung presisi timestamp database/JVM,
- mudah dikirim sebagai concurrency token ke client.

---

### 4.2 SQL konseptual update versioned entity

Misalnya:

```java
caseEntity.approve(actorId, reason);
```

Flush menghasilkan konsep:

```sql
update REGULATORY_CASE
set STATUS = 'APPROVED',
    DECISION_REASON = ?,
    VERSION_NUMBER = VERSION_NUMBER + 1
where CASE_ID = ?
  and VERSION_NUMBER = ?;
```

Jika affected row 0:

```text
optimistic conflict
```

Di JPA/Jakarta Persistence, provider dapat melempar `OptimisticLockException` ketika optimistic locking conflict terjadi. Exception ini dapat muncul pada API call, flush, atau commit, dan transaksi aktif akan ditandai rollback.

---

### 4.3 `LockModeType.OPTIMISTIC`

Kadang kamu ingin memastikan entity yang dibaca tetap valid sampai transaction selesai, walaupun tidak ada perubahan langsung pada entity itu.

Contoh:

```java
RegulatoryCase c = entityManager.find(
        RegulatoryCase.class,
        caseId,
        LockModeType.OPTIMISTIC
);
```

Makna konseptual:

```text
Saya membaca entity ini dan ingin provider melakukan optimistic version validation.
```

Ini berguna saat entity induk menentukan invariant, tapi perubahan terjadi pada child atau operasi lain.

Namun jangan berlebihan. Banyak use case cukup mengandalkan `@Version` pada update entity yang dirty.

---

### 4.4 `LockModeType.OPTIMISTIC_FORCE_INCREMENT`

Kadang kamu ingin menaikkan version walaupun field entity parent tidak berubah.

Contoh:

```java
RegulatoryCase c = entityManager.find(RegulatoryCase.class, caseId);
entityManager.lock(c, LockModeType.OPTIMISTIC_FORCE_INCREMENT);

c.addInternalNote(note);
```

Kenapa perlu?

Misalnya aggregate root `RegulatoryCase` memiliki child `CaseNote`.

Jika menambah note tidak mengubah row parent, version parent mungkin tidak naik. Padahal dari perspektif aggregate, case berubah.

Dengan force increment:

```text
Setiap perubahan signifikan pada aggregate menaikkan version aggregate root.
```

Ini penting jika client detail page membawa `case.version` sebagai concurrency token. Kalau note baru ditambahkan tapi parent version tidak berubah, client bisa salah mengira data detail masih fresh.

Trade-off:

- meningkatkan conflict rate,
- menambah update parent,
- bisa menjadi hot row pada aggregate yang sering berubah.

Gunakan hanya jika version parent memang merepresentasikan versi aggregate, bukan hanya versi row parent.

---

### 4.5 Spring exception translation

Dalam aplikasi Spring, JPA/Hibernate exception sering diterjemahkan menjadi hierarchy `DataAccessException`.

Contoh yang sering terlihat:

```text
ObjectOptimisticLockingFailureException
OptimisticLockingFailureException
JpaOptimisticLockingFailureException
```

Prinsip handling-nya sama:

```text
Ada concurrent modification. Transaction saat ini tidak boleh dilanjutkan sebagai sukses.
```

Jangan menangkap exception itu lalu tetap menganggap command sukses.

Pola handling:

```java
try {
    caseApplicationService.approve(command);
} catch (OptimisticLockingFailureException ex) {
    throw new ConflictHttpException(
            "The case was modified by another user. Please reload and try again.",
            ex
    );
}
```

Untuk REST API, mapping umum:

```text
HTTP 409 Conflict
```

---

## 5. Versioning Design

### 5.1 Setiap mutable aggregate root sebaiknya punya version

Untuk sistem serius, default yang aman:

```text
Setiap mutable aggregate root punya @Version.
```

Contoh:

- Application,
- Case,
- Appeal,
- ComplianceCase,
- CorrespondenceThread,
- PaymentInstruction,
- InspectionRecord,
- WorkflowTask.

Entity lookup/reference yang immutable bisa tidak punya version:

- country code,
- status dimension,
- static configuration snapshot,
- read-only view entity.

Tapi hati-hati dengan “configuration”. Banyak configuration sebenarnya mutable dan memengaruhi keputusan bisnis.

---

### 5.2 Version di aggregate root vs child entity

Ada dua pilihan:

```text
A. Version hanya di aggregate root
B. Version di root dan child
```

#### A. Version hanya di aggregate root

Cocok jika:

- semua update child dianggap perubahan aggregate,
- command selalu memuat root,
- UI menggunakan root version,
- conflict resolution terjadi pada level aggregate.

Konsekuensi:

- saat child berubah, root version harus dinaikkan juga;
- bisa perlu `OPTIMISTIC_FORCE_INCREMENT`;
- conflict lebih sering tetapi model lebih sederhana.

#### B. Version di root dan child

Cocok jika:

- child bisa diedit independen,
- child punya lifecycle sendiri,
- conflict resolution bisa terjadi per child,
- aggregate sangat besar.

Konsekuensi:

- UI harus tahu version mana yang dikirim;
- conflict model lebih kompleks;
- audit/event perlu jelas: perubahan child apakah mengubah aggregate revision?

Rule of thumb:

```text
Kalau user menganggap perubahan child sebagai perubahan case/application, naikkan version root.
Kalau child benar-benar sub-resource mandiri, version child bisa cukup.
```

---

### 5.3 Jangan expose database primary key sebagai concurrency token saja

Concurrency token harus version, bukan hanya id.

Buruk:

```http
PUT /cases/1001
```

Body:

```json
{
  "decisionReason": "approved"
}
```

Lebih baik:

```json
{
  "expectedVersion": 7,
  "decisionReason": "approved"
}
```

Atau memakai HTTP conditional request:

```http
If-Match: "case-1001-v7"
```

Lalu server memetakan ETag ke version.

Untuk sistem internal enterprise, body field `expectedVersion` sering lebih mudah diaudit dan ditest.

---

### 5.4 Version tidak boleh dimodifikasi manual oleh business code

Jangan lakukan:

```java
entity.setVersion(entity.getVersion() + 1);
```

Version adalah milik persistence provider.

Business code boleh membaca version untuk:

- response DTO,
- expected version validation,
- audit metadata,
- conflict message.

Tapi tidak boleh mengubah langsung.

---

### 5.5 Initial value dan nullability

Kolom version harus `NOT NULL`.

Contoh DDL:

```sql
alter table REGULATORY_CASE
add VERSION_NUMBER number(19, 0) default 0 not null;
```

Untuk tabel existing, rollout aman:

```text
1. Add nullable column with default if DB supports safe metadata-only operation.
2. Backfill existing rows.
3. Add NOT NULL constraint.
4. Deploy entity with @Version.
5. Monitor optimistic lock exceptions.
```

Pada production besar, jangan asal `ALTER TABLE ... DEFAULT ... NOT NULL` tanpa memahami lock/rewrite behavior database.

---

## 6. State Machine Persistence

### 6.1 State machine bukan enum biasa

Enum status seperti:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    APPROVED,
    REJECTED,
    CLOSED
}
```

belum otomatis menjadi state machine.

State machine membutuhkan:

1. daftar state yang valid,
2. daftar transition yang valid,
3. actor/role yang boleh melakukan transition,
4. guard condition,
5. side effect,
6. audit trail,
7. concurrency protection,
8. idempotency behavior,
9. error mapping,
10. observability.

Jika hanya ada setter:

```java
caseEntity.setStatus(CaseStatus.APPROVED);
```

maka invariant mudah rusak.

Lebih baik:

```java
caseEntity.approve(actor, reason);
caseEntity.reject(actor, reason);
caseEntity.escalate(actor, reason);
caseEntity.assignTo(actor, officerId);
```

Entity method menjadi tempat guard lokal.

Application service menjadi tempat orchestrasi transaction, authorization, audit, outbox.

---

### 6.2 State transition harus atomic

Contoh transition:

```text
UNDER_REVIEW -> APPROVED
```

Invariant:

```text
Case hanya boleh approved jika:
- status saat ini UNDER_REVIEW
- actor adalah assigned officer atau supervisor
- mandatory checklist complete
- belum ada unresolved compliance flag
- command berdasarkan version terbaru
```

Atomic berarti semua check dan write terjadi dalam satu transaction.

Pseudo-flow:

```text
begin transaction
  load case
  verify expected version
  verify current status
  verify actor authorization
  verify checklist
  verify compliance flag
  update status
  write audit trail
  write outbox event
commit
```

Kalau salah satu gagal:

```text
rollback
```

---

### 6.3 Entity method untuk local invariant

```java
public void approve(Actor actor, String reason, Instant decidedAt) {
    if (status != CaseStatus.UNDER_REVIEW) {
        throw new InvalidCaseTransitionException(status, CaseStatus.APPROVED);
    }

    if (!actor.canApprove(this)) {
        throw new UnauthorizedCaseDecisionException(actor.id(), id);
    }

    if (reason == null || reason.isBlank()) {
        throw new IllegalArgumentException("Decision reason is required");
    }

    this.status = CaseStatus.APPROVED;
    this.decisionReason = reason;
    this.decidedBy = actor.id();
    this.decidedAt = decidedAt;
}
```

Ini menjaga object tidak bisa masuk state invalid melalui code path normal.

Tapi entity method tidak cukup untuk semua invariant.

Beberapa check perlu repository/database:

- apakah ada unresolved compliance finding,
- apakah quota officer masih tersedia,
- apakah duplicate appeal exists,
- apakah payment sudah settled,
- apakah document mandatory sudah uploaded.

Untuk itu application service tetap dibutuhkan.

---

### 6.4 Application service sebagai transaction orchestrator

```java
@Transactional
public ApproveCaseResult approve(ApproveCaseCommand command) {
    RegulatoryCase c = caseRepository.findById(command.caseId())
            .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

    if (c.version() != command.expectedVersion()) {
        throw new StaleCaseCommandException(
                command.caseId(),
                command.expectedVersion(),
                c.version()
        );
    }

    Actor actor = actorProvider.currentActor();

    checklistPolicy.requireComplete(c.id());
    compliancePolicy.requireNoUnresolvedFlag(c.id());

    c.approve(actor, command.reason(), clock.instant());

    auditTrailRepository.append(AuditTrailEntry.caseApproved(
            c.id(),
            actor.id(),
            command.reason(),
            command.correlationId()
    ));

    outboxRepository.insert(OutboxMessage.caseApproved(
            c.id(),
            c.version(),
            command.idempotencyKey(),
            command.correlationId()
    ));

    return new ApproveCaseResult(c.id(), c.version());
}
```

Catatan penting:

```text
c.version() setelah method approve() mungkin belum naik sampai flush.
```

Jika outbox event butuh version baru, ada beberapa pilihan:

1. Jangan simpan version baru di payload; simpan aggregate id dan event type.
2. Flush sebelum membangun event jika benar-benar butuh version baru.
3. Gunakan domain sequence terpisah.
4. Bangun event setelah commit via transaction synchronization.

Pilihan paling sederhana:

```text
Outbox menyimpan event berdasarkan command dan aggregate id; consumer reload jika perlu state terbaru.
```

Namun untuk audit yang harus atomic dengan perubahan, audit entry tetap ditulis dalam transaction yang sama.

---

## 7. Compare-and-Swap Update

### 7.1 Kenapa conditional update kadang lebih baik daripada load-modify-flush

Untuk transition sederhana dan high-concurrency, load entity lalu dirty checking bisa terlalu berat atau terlalu longgar.

Contoh: officer ingin claim task dari queue.

Buruk:

```java
Task t = taskRepository.findById(taskId).orElseThrow();
if (t.status() != OPEN) throw ...;
t.assignTo(officerId);
```

Dua officer bisa membaca task `OPEN`. Optimistic lock akan membuat salah satu gagal, tapi mungkin error handling-nya generik.

Conditional update lebih eksplisit:

```sql
update TASK
set STATUS = 'ASSIGNED',
    ASSIGNED_TO = :officerId,
    VERSION_NUMBER = VERSION_NUMBER + 1
where TASK_ID = :taskId
  and STATUS = 'OPEN'
  and VERSION_NUMBER = :expectedVersion;
```

Jika affected row = 1:

```text
claim success
```

Jika affected row = 0:

```text
task already claimed/stale/invalid state
```

---

### 7.2 JPQL conditional update

```java
int updated = entityManager.createQuery("""
        update WorkflowTask t
           set t.status = :assigned,
               t.assignedTo = :officerId
         where t.id = :taskId
           and t.status = :open
           and t.version = :expectedVersion
        """)
        .setParameter("assigned", TaskStatus.ASSIGNED)
        .setParameter("officerId", officerId)
        .setParameter("taskId", taskId)
        .setParameter("open", TaskStatus.OPEN)
        .setParameter("expectedVersion", expectedVersion)
        .executeUpdate();

if (updated != 1) {
    throw new TaskClaimConflictException(taskId);
}
```

Tapi ada jebakan besar:

```text
Bulk update bypass persistence context.
```

Jika entity `WorkflowTask` sudah managed di persistence context, bulk update tidak otomatis meng-update instance managed tersebut.

Setelah bulk update, lakukan salah satu:

```java
entityManager.clear();
```

atau pastikan method ini tidak mencampur managed entity yang sama.

---

### 7.3 Native SQL conditional update

Untuk database-specific guard, native SQL kadang lebih jelas:

```java
int updated = entityManager.createNativeQuery("""
        update REGULATORY_CASE
           set STATUS = 'APPROVED',
               DECISION_REASON = ?,
               DECIDED_BY = ?,
               DECIDED_AT = ?,
               VERSION_NUMBER = VERSION_NUMBER + 1
         where CASE_ID = ?
           and STATUS = 'UNDER_REVIEW'
           and VERSION_NUMBER = ?
           and not exists (
               select 1
                 from CASE_COMPLIANCE_FLAG f
                where f.CASE_ID = REGULATORY_CASE.CASE_ID
                  and f.RESOLVED = 'N'
           )
        """)
        .setParameter(1, reason)
        .setParameter(2, actorId)
        .setParameter(3, Timestamp.from(now))
        .setParameter(4, caseId)
        .setParameter(5, expectedVersion)
        .executeUpdate();
```

Ini sangat kuat untuk invariant yang bisa diekspresikan di SQL.

Trade-off:

- kurang portable,
- entity managed bisa stale,
- audit/outbox perlu ditulis hati-hati,
- business logic tersebar jika tidak dibungkus rapi.

Gunakan sebagai repository method bernama jelas:

```java
boolean approveIfUnderReviewAndNoOpenFlags(...);
```

bukan sebagai SQL liar di service.

---

## 8. Conflict Handling Strategy

### 8.1 Jangan semua optimistic conflict di-retry otomatis

Ini kesalahan umum.

Optimistic lock exception berarti:

```text
Dunia sudah berubah sejak command dibuat.
```

Untuk command user seperti approval/rejection/edit form, auto retry bisa berbahaya.

Contoh:

```text
User approve berdasarkan data version 7.
Sebelum commit, user lain menambahkan compliance flag version 8.
Auto retry approval ke version 8 bisa approve case yang sekarang punya compliance flag.
```

Lebih aman:

```text
Tolak dengan conflict. Minta user reload dan review state terbaru.
```

---

### 8.2 Kapan auto retry boleh?

Auto retry boleh jika operasi:

- commutative,
- idempotent,
- tidak bergantung pada stale business observation,
- memiliki invariant yang dicek ulang di retry,
- retry limit kecil,
- jitter/backoff ada,
- aman terhadap duplicate side effect.

Contoh relatif aman:

- increment counter dengan conditional update dan bounded retry,
- append internal metric,
- allocate sequence domain dengan unique constraint,
- update last seen timestamp jika bukan business-critical.

Contoh tidak aman untuk auto retry buta:

- approve/reject case,
- submit application,
- waive penalty,
- close compliance finding,
- assign officer berdasarkan workload snapshot,
- calculate fee berdasarkan rules lama.

---

### 8.3 User conflict response

REST response yang baik:

```http
409 Conflict
Content-Type: application/json
```

```json
{
  "errorCode": "CASE_MODIFIED",
  "message": "This case was modified by another user. Please reload before applying your decision.",
  "caseId": "C-1001",
  "expectedVersion": 7,
  "actualVersion": 8,
  "reloadRequired": true
}
```

Untuk UI advanced, response bisa menyertakan summary perubahan:

```json
{
  "changedFields": ["status", "assignedOfficerId", "lastUpdatedBy"],
  "lastUpdatedBy": "officer.bob",
  "lastUpdatedAt": "2026-06-16T03:10:00Z"
}
```

Tetapi hati-hati dengan sensitive data.

---

### 8.4 Merge conflict resolution

Untuk form edit data non-critical, conflict bisa diselesaikan dengan merge UI:

```text
Your version:
  remarks = "Need document A"

Current version:
  remarks = "Need document B"

Choose:
  - keep yours
  - keep current
  - manually merge
```

Namun untuk decision/state transition, biasanya tidak boleh auto-merge.

Rule:

```text
Data edit may be mergeable.
Business decision usually requires reload and re-evaluation.
```

---

## 9. Detached Entity and REST Update Problem

### 9.1 Bahaya menerima entity dari client

Buruk:

```java
@PutMapping("/cases/{id}")
public void update(@RequestBody RegulatoryCase entity) {
    caseRepository.save(entity);
}
```

Masalah:

- client bisa mengubah field yang tidak boleh,
- version bisa hilang/null,
- detached merge bisa menimpa data,
- field yang tidak dikirim bisa menjadi null,
- invariant dilewati,
- audit tidak jelas,
- mass assignment vulnerability.

Lebih baik gunakan command DTO:

```java
public record UpdateCaseRemarksRequest(
        long expectedVersion,
        String remarks
) {}
```

Controller:

```java
@PutMapping("/cases/{id}/remarks")
public CaseResponse updateRemarks(
        @PathVariable Long id,
        @RequestBody UpdateCaseRemarksRequest request
) {
    UpdateCaseRemarksCommand command = new UpdateCaseRemarksCommand(
            id,
            request.expectedVersion(),
            request.remarks(),
            currentActor.id(),
            correlationId.current()
    );
    return mapper.toResponse(applicationService.updateRemarks(command));
}
```

Service loads managed entity and applies allowed change.

---

### 9.2 `merge()` bukan “save update aman”

JPA `merge()` menyalin state detached object ke managed instance.

Masalah jika detached object berasal dari JSON:

```json
{
  "id": 1001,
  "version": 7,
  "remarks": "new remark"
}
```

Field lain mungkin tidak ada. Jika mapping/deserialization membuat field lain null, merge bisa meng-copy null ke managed entity.

Pola aman:

```text
Never merge raw client entity.
Load managed entity, apply explicit command fields.
```

```java
@Transactional
public void updateRemarks(UpdateCaseRemarksCommand command) {
    RegulatoryCase c = caseRepository.findById(command.caseId())
            .orElseThrow();

    c.assertVersion(command.expectedVersion());
    c.updateRemarks(command.actorId(), command.remarks());
}
```

---

## 10. Bulk Update and Versioning

### 10.1 Bulk JPQL update bypasses normal optimistic locking

JPQL bulk update:

```java
entityManager.createQuery("""
        update RegulatoryCase c
           set c.status = :closed
         where c.status = :approved
        """)
        .setParameter("closed", CaseStatus.CLOSED)
        .setParameter("approved", CaseStatus.APPROVED)
        .executeUpdate();
```

Ini tidak sama dengan load setiap entity lalu update.

Konsekuensi:

- persistence context tidak disinkronkan otomatis,
- entity callbacks mungkin tidak berjalan seperti per-entity update,
- version mungkin tidak naik kecuali kamu set eksplisit,
- audit trail tidak otomatis dibuat,
- invariant entity method dilewati.

Jika bulk update mengubah business state, wajib ada strategi audit dan version.

Contoh lebih aman:

```java
int updated = entityManager.createQuery("""
        update RegulatoryCase c
           set c.status = :closed,
               c.version = c.version + 1
         where c.status = :approved
           and c.expiryDate < :today
        """)
        .setParameter("closed", CaseStatus.CLOSED)
        .setParameter("approved", CaseStatus.APPROVED)
        .setParameter("today", today)
        .executeUpdate();
```

Tetap perlu audit/outbox strategy.

---

### 10.2 Bulk state transition sebaiknya dianggap batch use case

Untuk batch close expired cases:

```text
1. Select candidate ids in chunks.
2. For each chunk, perform conditional update with status/version guard.
3. Insert audit rows for affected ids.
4. Insert outbox messages or batch event.
5. Commit chunk.
6. Record job progress.
```

Jangan menganggap bulk update sebagai shortcut tanpa konsekuensi domain.

---

## 11. Audit, Event, and Version Separation

### 11.1 Audit harus atomic dengan state change

Jika case approved, audit trail harus tercatat dalam transaction yang sama.

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    RegulatoryCase c = caseRepository.get(command.caseId());
    c.assertVersion(command.expectedVersion());
    c.approve(actor, command.reason(), clock.instant());

    auditRepository.append(AuditTrailEntry.builder()
            .aggregateType("CASE")
            .aggregateId(c.id().toString())
            .activity("CASE_APPROVED")
            .actorId(actor.id())
            .reason(command.reason())
            .correlationId(command.correlationId())
            .build());

    outboxRepository.insert(...);
}
```

Kalau update sukses tapi audit gagal:

```text
rollback semua
```

Jika audit adalah kewajiban regulatory, jangan publish event saja lalu berharap consumer audit menulis nanti. Eventual audit bisa tidak cukup defensible.

---

### 11.2 Outbox event bukan audit trail

Outbox event:

```text
Untuk mengirim informasi perubahan ke sistem/consumer lain secara reliable.
```

Audit trail:

```text
Untuk membuktikan siapa melakukan apa, kapan, kenapa, dan perubahan apa.
```

Satu state transition bisa menghasilkan keduanya:

```text
REGULATORY_CASE.status: UNDER_REVIEW -> APPROVED
AUDIT_TRAIL: CASE_APPROVED by officer.x reason=...
OUTBOX: CaseApprovedEvent for downstream sync/search/notification
```

Jangan campur semua jadi satu tabel tanpa model jelas.

---

### 11.3 Version pada event

Ada beberapa macam version yang bisa muncul pada event:

| Field | Makna |
|---|---|
| `entityVersion` | version optimistic locking entity |
| `eventSequence` | urutan event pada aggregate |
| `schemaVersion` | versi schema payload event |
| `businessRevision` | revisi bisnis yang user pahami |

Jangan memakai satu field `version` untuk semua makna.

Lebih jelas:

```json
{
  "eventType": "CaseApproved",
  "schemaVersion": 1,
  "aggregateId": "C-1001",
  "aggregateVersion": 8,
  "eventSequence": 42,
  "occurredAt": "2026-06-16T03:20:00Z"
}
```

---

## 12. State Machine Patterns

### 12.1 Explicit transition table in code

Untuk workflow sedang, code-based transition bisa cukup:

```java
private static final Map<CaseStatus, Set<CaseStatus>> ALLOWED_TRANSITIONS = Map.of(
        CaseStatus.DRAFT, Set.of(CaseStatus.SUBMITTED),
        CaseStatus.SUBMITTED, Set.of(CaseStatus.UNDER_REVIEW, CaseStatus.REJECTED),
        CaseStatus.UNDER_REVIEW, Set.of(CaseStatus.ESCALATED, CaseStatus.APPROVED, CaseStatus.REJECTED),
        CaseStatus.ESCALATED, Set.of(CaseStatus.UNDER_REVIEW, CaseStatus.APPROVED, CaseStatus.REJECTED),
        CaseStatus.APPROVED, Set.of(CaseStatus.CLOSED),
        CaseStatus.REJECTED, Set.of(CaseStatus.CLOSED),
        CaseStatus.CLOSED, Set.of()
);
```

Validation:

```java
private void transitionTo(CaseStatus next) {
    Set<CaseStatus> allowed = ALLOWED_TRANSITIONS.getOrDefault(this.status, Set.of());
    if (!allowed.contains(next)) {
        throw new InvalidCaseTransitionException(this.status, next);
    }
    this.status = next;
}
```

Good for:

- small/medium workflow,
- compile-time controlled transitions,
- simple audit labels.

Bad for:

- customer-configurable workflow,
- complex rules per agency,
- versioned process definitions,
- long-running BPM requirements.

---

### 12.2 Database transition guard

Untuk transition penting, tambahkan guard di update:

```sql
update REGULATORY_CASE
set STATUS = 'APPROVED',
    VERSION_NUMBER = VERSION_NUMBER + 1
where CASE_ID = :caseId
  and STATUS = 'UNDER_REVIEW'
  and VERSION_NUMBER = :expectedVersion;
```

Ini memastikan bahkan jika ada bug di code path lain, transition tidak akan sukses dari status salah.

Trade-off:

- business rule sebagian ada di SQL,
- perlu maintainability discipline,
- tidak semua rule cocok diekspresikan SQL.

Untuk transition paling kritikal, ini sering worth it.

---

### 12.3 State transition history table

Jangan hanya simpan status terakhir.

Untuk workflow penting:

```sql
create table CASE_STATUS_HISTORY (
    HISTORY_ID          number primary key,
    CASE_ID             number not null,
    FROM_STATUS         varchar2(40),
    TO_STATUS           varchar2(40) not null,
    ACTION              varchar2(80) not null,
    ACTOR_ID            varchar2(100) not null,
    REASON              varchar2(1000),
    CORRELATION_ID      varchar2(100),
    OCCURRED_AT         timestamp not null,
    CASE_VERSION_BEFORE number,
    CASE_VERSION_AFTER  number
);
```

Catatan:

`CASE_VERSION_AFTER` mungkin baru diketahui setelah flush. Bisa:

- simpan before version saja,
- flush lalu ambil after version,
- gunakan event sequence terpisah,
- isi after version via trigger/provider-specific mechanism.

Jangan memaksa desain rumit jika tidak memberi nilai audit nyata.

---

## 13. Performance Implication

### 13.1 Optimistic locking murah saat conflict jarang

Normal update hanya menambah predicate:

```sql
and VERSION_NUMBER = ?
```

dan update version.

Butuh index?

Primary key index pada `CASE_ID` biasanya cukup karena update mencari by PK. Predicate version dievaluasi setelah row ditemukan.

Index `(CASE_ID, VERSION_NUMBER)` jarang perlu jika `CASE_ID` sudah primary key.

---

### 13.2 Conflict tinggi membuat optimistic locking mahal secara sistemik

Kalau conflict sering:

- banyak transaction rollback,
- banyak work terbuang,
- user sering menerima conflict,
- retry storm bisa terjadi,
- DB tetap menerima banyak update gagal,
- audit/outbox insertion bisa ikut rollback.

Untuk hot row, pertimbangkan:

- pessimistic locking,
- queue/serialization per aggregate,
- sharding counter,
- append-only event model,
- conditional update langsung,
- redesign aggregate boundary,
- memecah hotspot menjadi child/sub-resource.

---

### 13.3 Version parent untuk semua child update bisa menjadi hotspot

Jika setiap note/comment/document update menaikkan version case parent, maka row case menjadi hot.

Pertanyaan desain:

```text
Apakah setiap child update harus meng-conflict-kan semua editor case?
```

Jika ya, root version approach benar.

Jika tidak, gunakan version per child/sub-resource.

Contoh:

```text
Case main decision version
Case document version
Case note thread version
Case assignment version
```

Tapi ini menambah kompleksitas UI dan command.

---

## 14. Production Consideration

### 14.1 Log conflict sebagai business signal, bukan error fatal selalu

Optimistic conflict bisa normal.

Untuk user-facing edit form, conflict sesekali adalah expected behavior.

Log level:

```text
INFO/WARN, bukan ERROR, kecuali rate tinggi atau tidak expected.
```

Log fields:

- aggregate type,
- aggregate id,
- expected version,
- actual version jika tersedia,
- actor id,
- action,
- correlation id,
- request id,
- endpoint/use case,
- transaction attempt,
- retry count.

---

### 14.2 Metrics

Metrics yang berguna:

```text
persistence.optimistic_conflict.count{aggregate="case", action="approve"}
persistence.optimistic_conflict.rate
persistence.optimistic_conflict.retry.count
persistence.optimistic_conflict.user_visible.count
workflow.transition.conflict.count{from="UNDER_REVIEW", action="APPROVE"}
```

Spike conflict bisa menunjukkan:

- UI stale terlalu lama,
- polling/auto-save bentrok,
- batch job mengubah row yang sedang diedit user,
- aggregate hotspot,
- retry storm,
- external integration mengirim duplicate command.

---

### 14.3 Operational playbook untuk optimistic conflict spike

Jika terjadi spike:

1. Identifikasi aggregate/action dengan conflict tertinggi.
2. Pisahkan conflict normal user edit vs retry storm system.
3. Cek apakah ada batch/scheduler baru.
4. Cek apakah frontend mengirim stale version atau tidak mengirim version.
5. Cek apakah API melakukan auto retry buta.
6. Cek apakah outbox/consumer mengirim duplicate command.
7. Cek apakah ada bulk update yang menaikkan version banyak row.
8. Cek apakah workflow state berubah lebih sering dari asumsi awal.
9. Tentukan mitigasi:
   - disable auto retry,
   - reduce batch overlap,
   - add conflict-aware UI,
   - split aggregate version,
   - use pessimistic lock for specific transition,
   - serialize command per aggregate.

---

## 15. Anti-Pattern

### 15.1 Entity tanpa `@Version` untuk mutable business data

Buruk:

```java
@Entity
public class CaseDecision {
    @Id
    private Long id;
    private String status;
    private String reason;
}
```

Risiko:

- lost update,
- stale approval,
- silent overwrite,
- audit tidak menunjukkan conflict.

---

### 15.2 `setStatus()` publik

Buruk:

```java
caseEntity.setStatus(APPROVED);
```

Lebih baik:

```java
caseEntity.approve(actor, reason, now);
```

Status bukan field biasa. Status adalah state machine.

---

### 15.3 Auto retry semua optimistic lock exception

Buruk:

```java
@Retryable(ObjectOptimisticLockingFailureException.class)
@Transactional
public void approve(...) {
    ...
}
```

Approval bukan operasi teknis biasa. Approval adalah decision berdasarkan state yang diamati user.

---

### 15.4 Merge detached entity dari request

Buruk:

```java
repository.save(requestBodyEntity);
```

Lebih baik:

```java
load managed entity -> validate expectedVersion -> apply command -> commit
```

---

### 15.5 Version sebagai audit trail

Buruk:

```text
Tidak perlu audit detail, kan sudah ada version 17.
```

Version 17 tidak menjelaskan apa pun tentang perubahan.

---

### 15.6 Bulk update business state tanpa audit/version

Buruk:

```sql
update cases set status = 'CLOSED' where expiry_date < sysdate;
```

Tanpa:

- version increment,
- audit entry,
- outbox event,
- chunking,
- monitoring,
- retry/idempotency.

---

## 16. Checklist Desain

### 16.1 Entity checklist

Untuk setiap mutable aggregate:

- [ ] Ada `@Version`.
- [ ] Version column `NOT NULL`.
- [ ] Version tidak diubah manual.
- [ ] Version dikirim ke client untuk edit/decision use case.
- [ ] Version diperiksa di command.
- [ ] Entity tidak expose setter status bebas.
- [ ] Transition lewat method bermakna.
- [ ] Business invariant lokal ada di entity.
- [ ] Invariant lintas aggregate/service ada di application service/database.

---

### 16.2 API checklist

Untuk endpoint update:

- [ ] Request membawa `expectedVersion` atau `If-Match`.
- [ ] Response mengembalikan version terbaru.
- [ ] Conflict dimap ke HTTP 409.
- [ ] Error message meminta reload jika decision-critical.
- [ ] Tidak menerima entity langsung dari client.
- [ ] Field update explicit, bukan blind merge.
- [ ] Sensitive fields tidak bisa diubah lewat mass assignment.

---

### 16.3 Transaction checklist

Untuk state transition:

- [ ] Load/check/update/audit/outbox dalam satu transaction.
- [ ] External call tidak dilakukan di tengah transaction jika bisa dihindari.
- [ ] Outbox dipakai untuk side effect setelah commit.
- [ ] Conflict tidak ditelan.
- [ ] Retry hanya untuk operasi yang aman.
- [ ] Flush timing dipahami.
- [ ] Bulk update tidak mencampur managed stale entity.

---

### 16.4 Observability checklist

- [ ] Conflict count per aggregate/action.
- [ ] Logs punya expected/actual version jika tersedia.
- [ ] Logs punya actor/correlation id.
- [ ] Dashboard menunjukkan conflict spike.
- [ ] Alert hanya untuk abnormal rate, bukan setiap conflict normal.
- [ ] Playbook tersedia.

---

## 17. Latihan / Scenario

### Scenario 1 — Dua officer approve dan reject bersamaan

Initial:

```text
Case C-1
Status UNDER_REVIEW
Version 5
Assigned officer Alice
```

Alice klik Approve dengan expectedVersion 5. Supervisor Bob klik Reject dari layar lama expectedVersion 5.

Pertanyaan:

1. Apa SQL konseptual untuk update Alice?
2. Apa yang terjadi pada update Bob?
3. HTTP response apa yang tepat untuk Bob?
4. Apakah Bob boleh auto retry reject?
5. Audit trail apa yang harus tercatat?

Jawaban ideal:

- Alice update sukses dan version naik.
- Bob update affected row 0 atau optimistic lock exception.
- Bob menerima 409 Conflict.
- Bob tidak boleh auto retry karena reject adalah business decision yang harus melihat state terbaru.
- Audit hanya mencatat approval Alice jika Bob rollback.

---

### Scenario 2 — Add note tidak menaikkan root version

Case detail page menampilkan:

```text
Case version 10
Notes: 3
```

User A membuka page. User B menambah note. Parent case version tetap 10. User A submit decision dengan expectedVersion 10.

Pertanyaan:

1. Apakah ini bug?
2. Kapan ini acceptable?
3. Kapan harus memakai `OPTIMISTIC_FORCE_INCREMENT`?

Jawaban:

- Bug jika note memengaruhi decision context dan user harus melihat note terbaru sebelum decide.
- Acceptable jika notes tidak relevan terhadap decision/update tersebut.
- Gunakan force increment jika perubahan child harus mengubah aggregate freshness token.

---

### Scenario 3 — Bulk close expired case

Scheduler menutup semua approved case yang expired.

Pertanyaan:

1. Apakah boleh pakai JPQL bulk update?
2. Bagaimana dengan version?
3. Bagaimana dengan audit?
4. Bagaimana dengan outbox?
5. Bagaimana jika user sedang membuka case tersebut?

Jawaban ringkas:

- Boleh jika diperlakukan sebagai batch use case, bukan shortcut.
- Version harus dinaikkan.
- Audit harus ditulis untuk affected cases atau batch audit yang defensible.
- Outbox/batch event perlu untuk downstream.
- User update lama akan conflict karena version berubah.

---

### Scenario 4 — Auto retry approval

Developer menambahkan retry otomatis untuk semua optimistic lock exception.

Pertanyaan:

1. Kenapa ini berbahaya?
2. Operasi seperti apa yang boleh retry?
3. Bagaimana desain retry yang benar?

Jawaban:

- Berbahaya karena approval bisa diterapkan pada state yang belum dilihat user.
- Retry hanya untuk operasi idempotent/commutative/technical yang invariant-nya dicek ulang.
- Retry harus bounded, punya backoff, tidak menggandakan side effect, dan dilakukan di transaction baru.

---

## 18. Ringkasan

Optimistic locking adalah mekanisme correctness untuk mencegah silent overwrite dan lost update. Dalam JPA/Jakarta Persistence, mekanisme utamanya adalah `@Version`, yang membuat provider menyertakan version predicate pada update/delete entity dan melempar optimistic locking exception saat row tidak lagi cocok.

Namun, pemahaman senior tidak berhenti di `@Version`.

Hal yang lebih penting adalah desain:

```text
Command harus tahu expected version.
State transition harus atomic.
Business decision tidak boleh auto retry buta.
Audit harus terpisah dari version.
Outbox bukan audit.
Bulk update harus memperhatikan version dan audit.
Parent/child version harus merefleksikan makna aggregate freshness.
Conflict adalah domain signal, bukan sekadar exception teknis.
```

Untuk sistem workflow dan regulatory case management, optimistic locking harus dikombinasikan dengan:

- explicit transition methods,
- transaction boundary yang benar,
- database constraints,
- conditional update untuk transition kritikal,
- audit trail atomic,
- outbox untuk side effect,
- idempotency key,
- observability conflict rate.

Kalimat kunci:

```text
@Version protects writes. It does not design your workflow.
```

---

## 19. Referensi

- Jakarta Persistence 3.2 Specification — version field/property, optimistic locking, lock modes, persistence context.
- Jakarta Persistence API `LockModeType` — optimistic and pessimistic lock mode definitions.
- Jakarta Persistence API `OptimisticLockException` — exception semantics and rollback behavior.
- Hibernate ORM User Guide — optimistic locking, `@Version`, generated SQL behavior, persistence context interaction.
- Spring Framework Data Access / Transaction Exception Hierarchy — optimistic locking exception translation in Spring applications.

---

## 20. Status Seri

Seri belum selesai.

Saat ini selesai:

```text
Part 013 dari 032
```

Bagian berikutnya:

```text
Part 014 — Pessimistic Locking, Deadlocks, and High-Contention Workloads
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 012 — Isolation Levels and Concurrency Anomalies](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 014 — Pessimistic Locking, Deadlocks, and High-Contention Workloads](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-014.md)

</div>