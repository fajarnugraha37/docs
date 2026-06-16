# Part 018 — Constraints, Invariants, and Validation Across Layers

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-018.md`  
> Scope: Java 8–25, JPA `javax.persistence`, Jakarta Persistence `jakarta.persistence`, Hibernate ORM, Spring Data/JPA, Jakarta Data, Jakarta Transactions, database integration.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **input validation**, **object validation**, **domain invariant**, **persistence mapping constraint**, dan **database constraint**.
2. Menentukan invariant mana yang harus ditempatkan di DTO, domain service, entity, repository, transaction boundary, dan database.
3. Memahami kenapa validasi di aplikasi saja tidak cukup untuk correctness di bawah concurrent request.
4. Mendesain constraint database yang menjaga data tetap valid bahkan jika beberapa aplikasi, batch job, migration script, atau integration worker menulis ke database yang sama.
5. Menggunakan constraint sebagai bagian dari desain consistency, bukan hanya sebagai “error prevention”.
6. Menghindari bug klasik seperti duplicate business key, invalid state transition, orphan record, missing audit relation, dan stale validation.
7. Menerjemahkan constraint violation menjadi error aplikasi/API yang jelas, aman, dan bisa dipakai user.
8. Mendesain invariant untuk sistem regulatory/case-management yang perlu defensible: apa yang mustahil, apa yang harus ditolak, apa yang harus diaudit, dan apa yang harus bisa dijelaskan.

---

## 2. Mental Model Utama

Persistence correctness bukan berasal dari satu layer saja.

Bayangkan sistem punya beberapa “gerbang kebenaran”:

```text
[Client/UI]
   |
   v
[DTO / Request Validation]
   |
   v
[Application Service / Use Case Validation]
   |
   v
[Domain Invariant / State Machine Guard]
   |
   v
[Repository / Query / Persistence Context]
   |
   v
[Database Constraints / Transaction Isolation / Locks]
   |
   v
[Committed Durable State]
```

Setiap layer punya fungsi berbeda.

| Layer | Pertanyaan yang dijawab | Contoh |
|---|---|---|
| UI/client validation | “Apakah input nyaman dan cepat dicek?” | field required, format tanggal |
| DTO/request validation | “Apakah request syntactically valid?” | `@NotBlank`, `@Size`, `@Email` |
| Application service | “Apakah command ini boleh dijalankan sekarang?” | user punya permission, case masih open |
| Domain invariant | “Kondisi apa yang tidak boleh dilanggar dalam model bisnis?” | submitted application harus punya applicant dan declaration |
| Transaction boundary | “Perubahan apa yang harus atomic?” | create case + initial audit + outbox event |
| Database constraint | “Apa yang harus mustahil walau ada race condition?” | unique business key, foreign key, not null, check constraint |
| Observability/audit | “Kalau gagal/berubah, bisa dijelaskan?” | audit trail, reason code, correlation id |

Prinsip senior-level:

> Validasi aplikasi meningkatkan UX dan pesan error. Constraint database menjaga kebenaran final.

Kalau invariant penting hanya dicek di aplikasi, invariant itu tetap bisa dilanggar melalui:

- concurrent request,
- retry,
- batch job,
- script manual DBA,
- migration,
- consumer message,
- service lain,
- bug repository,
- stale read,
- race antara `exists()` dan `insert()`.

---

## 3. Constraint vs Validation vs Invariant

Ketiganya sering dicampur, padahal berbeda.

### 3.1 Validation

Validation menjawab:

> “Apakah input atau object ini memenuhi bentuk/aturan tertentu?”

Contoh:

```java
public record SubmitApplicationRequest(
        @NotBlank String applicationNo,
        @NotBlank String applicantName,
        @Size(max = 1000) String remarks
) {}
```

Validation berguna untuk:

- feedback cepat,
- error message rapi,
- menghindari request buruk masuk terlalu jauh,
- dokumentasi kontrak API,
- precondition method/service.

Tetapi validation biasanya tidak cukup untuk concurrency correctness.

Contoh lemah:

```java
if (applicationRepository.existsByApplicationNo(command.applicationNo())) {
    throw new DuplicateApplicationNoException();
}

applicationRepository.save(new Application(command.applicationNo()));
```

Di bawah race condition:

```text
T1: existsByApplicationNo("APP-001") -> false
T2: existsByApplicationNo("APP-001") -> false
T1: insert APP-001
T2: insert APP-001
```

Kalau database tidak punya unique constraint, duplicate bisa committed.

### 3.2 Constraint

Constraint menjawab:

> “Apa yang secara struktural tidak boleh disimpan di database?”

Contoh:

```sql
ALTER TABLE application
ADD CONSTRAINT uq_application_no UNIQUE (application_no);
```

Constraint biasanya enforced oleh database engine.

Jenis umum:

- `NOT NULL`,
- `UNIQUE`,
- `PRIMARY KEY`,
- `FOREIGN KEY`,
- `CHECK`,
- generated column + constraint,
- partial/filtered unique index,
- exclusion constraint,
- trigger-based constraint,
- deferrable constraint.

Tidak semua jenis constraint portable di JPA/Jakarta Persistence. Beberapa harus lewat migration tool seperti Flyway/Liquibase.

### 3.3 Invariant

Invariant menjawab:

> “Kondisi bisnis apa yang harus selalu benar?”

Contoh:

- Application yang `SUBMITTED` harus punya applicant.
- Case yang `CLOSED` tidak boleh menerima evidence baru.
- Appeal hanya boleh dibuat untuk decision yang sudah issued.
- Officer tidak boleh approve case miliknya sendiri.
- Satu active licence hanya boleh punya satu active renewal application.
- Total allocation tidak boleh melebihi quota.

Invariant bisa bersifat:

| Jenis invariant | Contoh | Enforcement ideal |
|---|---|---|
| Syntactic invariant | name tidak kosong | DTO/entity validation + DB `NOT NULL` |
| Referential invariant | application punya applicant valid | FK |
| Uniqueness invariant | business key unik | unique constraint/index |
| State invariant | transition hanya dari status tertentu | service guard + conditional update/check |
| Aggregate invariant | child harus konsisten dengan parent | transaction + FK + domain method |
| Cross-row invariant | quota tidak boleh exceeded | lock/serializable/conditional update |
| Cross-table invariant | hanya satu active renewal per licence | unique partial index / transaction guard |
| Temporal invariant | effective period tidak overlap | exclusion constraint / trigger / lock |
| Regulatory invariant | action harus punya reason dan actor | DB `NOT NULL` + FK + audit design |

---

## 4. Kenapa Constraint Database Tetap Wajib

Aplikasi enterprise biasanya punya banyak jalur tulis:

```text
REST API
Batch job
Message consumer
Admin tool
Migration script
Data repair script
Integration import
Manual SQL emergency fix
Legacy application
```

Kalau semua invariant hanya ditaruh di Java service, maka semua jalur tulis lain harus sempurna. Itu tidak realistis.

Database adalah titik akhir durable state. Karena itu invariant yang benar-benar penting perlu dipertahankan sedekat mungkin dengan durable state.

### 4.1 Race Condition pada Application-Level Validation

Misalnya sistem mencegah duplicate active application:

```java
boolean exists = repository.existsActiveRenewal(licenceId);
if (exists) {
    throw new ActiveRenewalAlreadyExistsException();
}
repository.save(new RenewalApplication(licenceId));
```

Di bawah concurrency:

```text
T1 check -> tidak ada
T2 check -> tidak ada
T1 insert active renewal
T2 insert active renewal
```

Solusi robust bisa berupa:

```sql
-- PostgreSQL example
CREATE UNIQUE INDEX uq_active_renewal_per_licence
ON renewal_application (licence_id)
WHERE status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW');
```

Untuk database yang tidak mendukung partial unique index, alternatif:

- materialized flag column,
- generated column,
- lock parent row,
- separate active table,
- trigger,
- state transition table,
- serialized transaction untuk use case tertentu.

### 4.2 Stale Read Problem

Validasi sering membaca state lama.

```text
T1 reads quota used = 9 / limit 10
T2 reads quota used = 9 / limit 10
T1 adds 1 -> 10
T2 adds 1 -> 10 according to its stale view
final should be 11 logically, but each transaction thought valid
```

Jika invariant penting, gunakan salah satu:

1. optimistic locking pada row aggregate,
2. pessimistic lock pada quota row,
3. conditional update:

```sql
UPDATE quota
SET used = used + 1
WHERE quota_id = ?
  AND used + 1 <= limit;
```

Lalu cek affected row:

```java
if (updatedRows == 0) {
    throw new QuotaExceededException();
}
```

### 4.3 Defense-in-Depth

Layering yang baik bukan memilih “validasi di aplikasi atau database”. Jawaban senior biasanya:

```text
User-friendly validation di aplikasi.
Non-negotiable correctness di database.
Domain meaning di domain/service layer.
Transaction boundary untuk atomicity.
Observability untuk explainability.
```

---

## 5. Bean/Jakarta Validation dalam Persistence

Jakarta Validation menyediakan constraint declaration pada object model, method parameter, dan return value. Ia berguna sebagai object-level validation facility.

Contoh:

```java
@Entity
@Table(name = "application")
public class Application {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "application_seq")
    private Long id;

    @NotBlank
    @Size(max = 50)
    @Column(name = "application_no", nullable = false, length = 50)
    private String applicationNo;

    @NotNull
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private ApplicationStatus status;
}
```

Perhatikan ada dua layer:

```java
@NotBlank                    // object/input validation
@Column(nullable = false)    // mapping/schema-generation hint
```

Dan idealnya masih ada database migration:

```sql
ALTER TABLE application
MODIFY application_no VARCHAR2(50) NOT NULL;
```

### 5.1 `@Column(nullable = false)` Bukan Pengganti `NOT NULL` Production

`@Column(nullable = false)` adalah metadata mapping dan schema-generation hint. Kalau production schema dikelola Flyway/Liquibase, database tetap harus benar-benar punya `NOT NULL`.

Salah kaprah:

```java
@Column(nullable = false)
private String applicationNo;
```

Lalu menganggap database pasti tidak menerima null.

Yang benar:

```sql
ALTER TABLE application
ALTER COLUMN application_no SET NOT NULL;
```

Atau sesuai dialect database.

### 5.2 Validation Group

Validation group bisa dipakai untuk membedakan konteks:

```java
public interface CreateCheck {}
public interface SubmitCheck {}

public class ApplicationCommand {
    @NotBlank(groups = CreateCheck.class)
    private String applicationNo;

    @AssertTrue(groups = SubmitCheck.class)
    public boolean isDeclarationAccepted() {
        return declarationAccepted;
    }
}
```

Gunakan group jika:

- object yang sama punya lifecycle berbeda,
- create/update/submit punya aturan beda,
- validasi input berbeda dari validasi transition.

Tapi jangan membuat validation group menjadi state machine besar yang sulit dipahami. Untuk business transition kompleks, lebih baik domain method/service guard.

### 5.3 Entity Validation vs DTO Validation

DTO validation cocok untuk request shape:

```java
public record CreateCaseRequest(
        @NotBlank String applicationNo,
        @NotBlank String applicantName,
        @Size(max = 1000) String remarks
) {}
```

Entity validation cocok untuk invariant object-level yang selalu harus benar:

```java
@Entity
public class CaseFile {
    @NotNull
    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    @NotNull
    private Instant createdAt;
}
```

Tetapi entity validation tidak boleh menggantikan:

- DB `NOT NULL`,
- DB FK,
- DB unique,
- state transition guard,
- authorization rule,
- race-condition-safe invariant.

### 5.4 Cross-Field Validation

Contoh:

```java
@Target(TYPE)
@Retention(RUNTIME)
@Constraint(validatedBy = DateRangeValidator.class)
public @interface ValidDateRange {
    String message() default "startDate must be before endDate";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Dipakai:

```java
@ValidDateRange
public record SearchRequest(
        LocalDate startDate,
        LocalDate endDate
) {}
```

Cross-field validation bagus untuk input consistency. Untuk temporal overlap data existing, butuh query/lock/constraint database.

---

## 6. Database Constraint Fundamental

### 6.1 `NOT NULL`

Gunakan untuk field yang wajib secara persistence/business.

Contoh:

```sql
ALTER TABLE application
ADD CONSTRAINT nn_application_status CHECK (status IS NOT NULL);
```

Atau native syntax:

```sql
ALTER TABLE application
ALTER COLUMN status SET NOT NULL;
```

Java mapping:

```java
@NotNull
@Column(name = "status", nullable = false, length = 30)
@Enumerated(EnumType.STRING)
private ApplicationStatus status;
```

Failure yang dicegah:

- application tanpa status,
- audit trail tanpa actor,
- document tanpa owner,
- outbox event tanpa aggregate id.

### 6.2 `UNIQUE`

Gunakan untuk business key yang harus unik.

Jakarta Persistence:

```java
@Entity
@Table(
    name = "application",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_application_application_no",
            columnNames = "application_no"
        )
    }
)
public class Application {
    // ...
}
```

Migration:

```sql
ALTER TABLE application
ADD CONSTRAINT uq_application_application_no UNIQUE (application_no);
```

Rule:

- Untuk single column, bisa pakai `@Column(unique = true)`, tapi untuk sistem besar lebih eksplisit pakai `@Table(uniqueConstraints = ...)`.
- Nama constraint harus stabil dan meaningful.
- Jangan bergantung pada generated random constraint name.
- Untuk case-insensitive uniqueness, jangan naif.

Case-insensitive uniqueness opsi:

```sql
-- PostgreSQL expression unique index
CREATE UNIQUE INDEX uq_user_email_lower
ON app_user (lower(email));
```

Atau simpan normalized column:

```sql
ALTER TABLE app_user ADD email_normalized VARCHAR(320) NOT NULL;
CREATE UNIQUE INDEX uq_user_email_normalized ON app_user(email_normalized);
```

### 6.3 Composite Unique Constraint

Contoh: nomor case unik per agency.

```java
@Table(
    name = "case_file",
    uniqueConstraints = @UniqueConstraint(
        name = "uq_case_file_agency_case_no",
        columnNames = {"agency_id", "case_no"}
    )
)
```

SQL:

```sql
ALTER TABLE case_file
ADD CONSTRAINT uq_case_file_agency_case_no UNIQUE (agency_id, case_no);
```

Ini umum untuk multi-tenant/multi-agency system.

### 6.4 Foreign Key

Foreign key menjaga referential integrity.

```sql
ALTER TABLE case_file
ADD CONSTRAINT fk_case_file_application
FOREIGN KEY (application_id)
REFERENCES application(id);
```

Mapping:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "application_id", nullable = false,
        foreignKey = @ForeignKey(name = "fk_case_file_application"))
private Application application;
```

Catatan:

- `optional = false` adalah semantic hint ke provider.
- `nullable = false` adalah column metadata.
- FK sebenarnya harus ada di schema.

Jangan menghapus FK hanya karena “lebih cepat”. Itu trade-off besar. Tanpa FK, data orphan mudah muncul dan debugging production menjadi mahal.

### 6.5 Check Constraint

Check constraint membatasi nilai kolom.

Contoh:

```sql
ALTER TABLE payment
ADD CONSTRAINT ck_payment_amount_positive
CHECK (amount > 0);
```

Hibernate punya annotation provider-specific seperti `@Check`, tetapi portability dan migration governance biasanya lebih baik lewat migration SQL.

Contoh Hibernate:

```java
@Check(constraints = "amount > 0")
@Entity
public class Payment {
    // ...
}
```

Gunakan check constraint untuk invariant sederhana dalam satu row:

- amount >= 0,
- end_date >= start_date,
- status in allowed values,
- percentage between 0 and 100,
- quantity > 0.

Jangan pakai check constraint untuk logic yang perlu akses banyak row/table, kecuali database mendukung via function/trigger dengan governance yang jelas.

### 6.6 Index Bukan Selalu Constraint

Index bisa mendukung constraint, tetapi tidak semua index adalah constraint.

| Object | Fungsi |
|---|---|
| index biasa | mempercepat lookup/sort/join |
| unique index | enforce uniqueness + lookup |
| unique constraint | logical constraint; biasanya didukung unique index |
| partial index | index subset row |
| expression/function index | index hasil expression |

Untuk portability, JPA punya `@Index`, tetapi desain index production biasanya tetap lewat migration.

Contoh:

```java
@Table(
    name = "application",
    indexes = {
        @Index(name = "idx_application_status_created", columnList = "status, created_at")
    }
)
```

Tetapi index dengan `WHERE`, function, operator class, include column, compression, online option, invisible index, atau tablespace biasanya vendor-specific dan sebaiknya migration-managed.

---

## 7. Constraint Placement: Di Mana Aturan Harus Ditaruh?

Gunakan matriks berikut.

| Rule | DTO validation | Domain/service | DB constraint | Notes |
|---|---:|---:|---:|---|
| field required | yes | sometimes | yes | UX + correctness |
| max string length | yes | rarely | yes | avoid truncation |
| valid enum value | yes | yes | yes | DB check/lookup table |
| unique email/application no | pre-check optional | yes | yes | DB unique mandatory |
| parent must exist | maybe | yes | yes | FK mandatory |
| amount positive | yes | yes | yes | check constraint |
| transition DRAFT → SUBMITTED only | no | yes | sometimes | conditional update/check/history table |
| officer cannot approve own case | maybe | yes | maybe | service + audit; DB hard if model supports |
| no overlapping active period | maybe | yes | ideally | exclusion/lock/trigger depending DB |
| quota not exceeded | no | yes | yes-ish | lock/conditional update/serializable |
| only one active renewal | maybe | yes | yes | partial unique/generated column/lock |
| external API must succeed | no | yes | no | use outbox/compensation |
| audit must exist for every state change | no | yes | partially | transaction + FK + audit design |

Prinsip:

1. **Rule yang bisa dilanggar oleh concurrency harus punya database-level protection atau lock/transaction strategy.**
2. **Rule yang penting untuk UX sebaiknya juga divalidasi sebelum DB.**
3. **Rule yang membutuhkan makna bisnis harus eksplisit di service/domain, bukan hanya constraint error.**
4. **Rule yang regulatory-critical harus bisa diaudit dan dijelaskan.**

---

## 8. Application Pre-Check vs Database Enforcement

Pre-check memberi pesan error lebih ramah.

```java
if (repository.existsByApplicationNo(command.applicationNo())) {
    throw new DuplicateApplicationNoException(command.applicationNo());
}
```

Tetapi database enforcement tetap final.

```java
try {
    repository.save(application);
    entityManager.flush();
} catch (DataIntegrityViolationException ex) {
    if (constraintClassifier.isUniqueApplicationNo(ex)) {
        throw new DuplicateApplicationNoException(command.applicationNo(), ex);
    }
    throw ex;
}
```

Kenapa `flush()` kadang dipanggil eksplisit?

Karena constraint violation bisa muncul saat flush/commit. Jika ingin mapping error di service boundary tertentu, explicit flush bisa membuat error muncul di titik yang terkendali.

Namun jangan menyebar `flush()` sembarangan karena:

- mengubah timing SQL,
- memperpendek write-behind benefits,
- bisa memicu constraint lebih awal,
- bisa mengganggu batch performance.

Gunakan explicit flush saat:

- perlu fail-fast sebelum side effect non-DB,
- perlu memastikan generated DB value tersedia,
- perlu mapping constraint violation dalam use case,
- testing constraint behavior.

---

## 9. Exception Translation dan Constraint Violation Mapping

Raw database error sering tidak user-friendly.

Contoh database error:

```text
ORA-00001: unique constraint (APP.UQ_APPLICATION_APPLICATION_NO) violated
```

Atau PostgreSQL:

```text
duplicate key value violates unique constraint "uq_application_application_no"
```

Layer aplikasi sebaiknya menerjemahkan menjadi domain/API error:

```json
{
  "code": "APPLICATION_NO_ALREADY_EXISTS",
  "message": "Application number already exists.",
  "field": "applicationNo"
}
```

### 9.1 Spring Exception Translation

Spring menerjemahkan exception persistence provider menjadi hierarchy `DataAccessException`, misalnya:

- `DataIntegrityViolationException`,
- `DuplicateKeyException`,
- `CannotAcquireLockException`,
- `DeadlockLoserDataAccessException`,
- `QueryTimeoutException`,
- `OptimisticLockingFailureException`.

Contoh classifier:

```java
@Component
public class PersistenceErrorClassifier {

    public boolean isConstraint(Throwable ex, String constraintName) {
        String normalized = constraintName.toLowerCase(Locale.ROOT);

        Throwable current = ex;
        while (current != null) {
            String message = current.getMessage();
            if (message != null && message.toLowerCase(Locale.ROOT).contains(normalized)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }
}
```

Lebih robust jika membaca vendor-specific metadata:

- SQLState,
- vendor error code,
- constraint name dari provider exception,
- dialect-specific exception.

Tetapi portability penuh sulit. Untuk production, minimal:

1. constraint name stabil,
2. classifier tertutup di satu tempat,
3. raw DB message tidak diekspos ke user,
4. log menyimpan root cause untuk operator,
5. API error memakai domain code.

### 9.2 Mapping Example

```java
@Service
public class ApplicationSubmissionService {

    private final ApplicationRepository repository;
    private final EntityManager entityManager;
    private final PersistenceErrorClassifier errorClassifier;

    @Transactional
    public ApplicationId create(CreateApplicationCommand command) {
        Application application = Application.create(command.applicationNo(), command.applicantName());

        try {
            repository.save(application);
            entityManager.flush();
            return new ApplicationId(application.getId());
        } catch (DataIntegrityViolationException ex) {
            if (errorClassifier.isConstraint(ex, "uq_application_application_no")) {
                throw new DuplicateApplicationNoException(command.applicationNo(), ex);
            }
            throw ex;
        }
    }
}
```

Caveat:

- Jika transaction sudah rollback-only setelah exception, jangan lanjut melakukan write lain dalam transaksi yang sama.
- Biasanya setelah persistence exception, anggap transaction gagal.
- Jangan catch lalu lanjut seolah tidak terjadi apa-apa.

---

## 10. Database Constraint dan Transaction Isolation

Constraint bukan pengganti isolation, dan isolation bukan pengganti constraint.

Contoh uniqueness:

- Unique constraint sangat tepat.
- Tidak perlu serializable transaction untuk semua insert hanya demi uniqueness.

Contoh quota:

- Unique constraint tidak cukup.
- Perlu conditional update/lock/serializable.

Contoh no overlapping period:

- Bisa pakai exclusion constraint di PostgreSQL.
- Bisa pakai lock range/parent row di database lain.
- Bisa pakai trigger, tetapi governance lebih berat.

### 10.1 Check-Then-Act Problem

Buruk:

```java
long count = repository.countActiveAssignments(officerId);
if (count >= limit) {
    throw new AssignmentLimitExceededException();
}
repository.save(new Assignment(officerId, caseId));
```

Lebih baik:

```sql
UPDATE officer_quota
SET active_count = active_count + 1
WHERE officer_id = ?
  AND active_count < max_active_count;
```

Jika updated rows = 1, lanjut insert assignment. Jika 0, limit exceeded.

Atau lock row quota:

```java
OfficerQuota quota = entityManager.find(
    OfficerQuota.class,
    officerId,
    LockModeType.PESSIMISTIC_WRITE
);
quota.reserveOne();
```

### 10.2 Constraint Timing: Flush vs Commit

Constraint violation bisa muncul saat:

- insert/update SQL dikirim saat flush,
- transaction commit,
- deferred constraint checked at commit,
- batch statement executed,
- database trigger executed.

Karena JPA memakai write-behind, error tidak selalu muncul di line `save()`.

```java
repository.save(entity);       // belum tentu SQL jalan
// ...
entityManager.flush();         // SQL jalan, constraint violation mungkin muncul
// ...
transaction commit             // deferred constraint mungkin muncul di sini
```

---

## 11. Invariant untuk State Machine Persistence

Sistem case management biasanya stateful.

Contoh state:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    ESCALATED,
    APPROVED,
    REJECTED,
    CLOSED
}
```

### 11.1 Service Guard

```java
@Transactional
public void submit(SubmitCaseCommand command) {
    CaseFile caseFile = repository.findByIdForUpdate(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

    caseFile.submit(command.actorId(), command.reason());

    auditTrail.record(caseFile, "SUBMIT", command.actorId(), command.reason());
    outbox.publish(CaseSubmittedEvent.from(caseFile));
}
```

Entity method:

```java
public void submit(String actorId, String reason) {
    if (status != CaseStatus.DRAFT) {
        throw new InvalidCaseTransitionException(status, CaseStatus.SUBMITTED);
    }
    if (!hasRequiredDocuments()) {
        throw new MissingRequiredDocumentException();
    }
    this.status = CaseStatus.SUBMITTED;
    this.submittedAt = Instant.now();
    this.submittedBy = actorId;
}
```

### 11.2 DB-Level Guard via Conditional Update

Untuk high-concurrency transition, bisa gunakan conditional update:

```java
@Modifying
@Query("""
    update CaseFile c
       set c.status = :nextStatus,
           c.version = c.version + 1,
           c.updatedAt = :now
     where c.id = :caseId
       and c.status = :expectedStatus
       and c.version = :expectedVersion
""")
int transition(
        @Param("caseId") Long caseId,
        @Param("expectedStatus") CaseStatus expectedStatus,
        @Param("nextStatus") CaseStatus nextStatus,
        @Param("expectedVersion") long expectedVersion,
        @Param("now") Instant now
);
```

Caller:

```java
int updated = repository.transition(
        command.caseId(),
        CaseStatus.DRAFT,
        CaseStatus.SUBMITTED,
        command.expectedVersion(),
        clock.instant()
);

if (updated == 0) {
    throw new ConcurrentOrInvalidTransitionException();
}
```

Ini menjaga transition atomic tanpa read-modify-write race.

### 11.3 Transition Table as Constraint

Untuk workflow yang sangat regulated, state transition bisa dimodelkan sebagai data:

```sql
CREATE TABLE allowed_transition (
    from_status VARCHAR(30) NOT NULL,
    to_status   VARCHAR(30) NOT NULL,
    action_code VARCHAR(50) NOT NULL,
    PRIMARY KEY (from_status, to_status, action_code)
);
```

Application service tetap harus enforce, tetapi transition table membuat rule lebih auditable/configurable.

---

## 12. Constraint untuk Audit dan Regulatory Defensibility

Sistem regulatory tidak cukup hanya “data valid”. Ia harus bisa menjelaskan:

- siapa yang mengubah,
- kapan,
- dari state apa ke state apa,
- berdasarkan action apa,
- reason apa,
- correlation/request id apa,
- apakah perubahan terjadi dalam transaksi yang sama dengan business change.

### 12.1 Audit Trail Constraint

Audit table contoh:

```sql
CREATE TABLE audit_trail (
    id BIGINT PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    action_code VARCHAR(100) NOT NULL,
    actor_id VARCHAR(100) NOT NULL,
    reason_code VARCHAR(100),
    previous_state VARCHAR(50),
    next_state VARCHAR(50),
    correlation_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL
);
```

Constraint penting:

```sql
ALTER TABLE audit_trail
ADD CONSTRAINT ck_audit_state_change
CHECK (
    (previous_state IS NULL AND next_state IS NULL)
    OR
    (previous_state IS NOT NULL AND next_state IS NOT NULL)
);
```

Jika action tertentu wajib reason, bisa:

- enforce di service/domain,
- enforce dengan check constraint jika sederhana,
- enforce dengan trigger jika matrix kompleks,
- enforce melalui action configuration table.

### 12.2 Audit Atomicity

Jika state berubah tapi audit gagal, sebaiknya seluruh transaction gagal.

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseFile caseFile = repository.getForUpdate(command.caseId());
    CaseStatus previous = caseFile.getStatus();

    caseFile.approve(command.actorId(), command.reason());

    auditRepository.save(AuditTrail.stateChange(
            "CASE",
            caseFile.getId().toString(),
            "APPROVE",
            command.actorId(),
            command.reason(),
            previous.name(),
            caseFile.getStatus().name(),
            command.correlationId()
    ));
}
```

Audit untuk regulatory action biasanya harus berada dalam transaction yang sama dengan business state change, kecuali menggunakan event sourcing/append-only model yang didesain khusus.

---

## 13. Common Invariant Patterns

### 13.1 Unique Business Reference

Use case: application number unik.

Layering:

- DTO: `@NotBlank`, `@Size`, format.
- Service: normalize and maybe pre-check.
- DB: unique constraint on normalized key.

```java
public static Application create(String rawApplicationNo) {
    String normalized = ApplicationNo.normalize(rawApplicationNo);
    return new Application(normalized);
}
```

```sql
ALTER TABLE application
ADD application_no_normalized VARCHAR(50) NOT NULL;

ALTER TABLE application
ADD CONSTRAINT uq_application_no_normalized UNIQUE (application_no_normalized);
```

### 13.2 One Active Child per Parent

Use case: satu licence hanya punya satu active renewal.

PostgreSQL:

```sql
CREATE UNIQUE INDEX uq_active_renewal_per_licence
ON renewal_application (licence_id)
WHERE status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW');
```

Portable alternative:

```sql
ALTER TABLE renewal_application
ADD active_slot_key VARCHAR(100);

ALTER TABLE renewal_application
ADD CONSTRAINT uq_active_renewal_slot UNIQUE (licence_id, active_slot_key);
```

Application sets:

```text
active_slot_key = 'ACTIVE' for active statuses
active_slot_key = null for terminal statuses
```

But beware: unique constraints often allow multiple nulls depending DB. Design carefully.

### 13.3 No Invalid Status Value

Options:

1. `VARCHAR` + check constraint.
2. Lookup table + FK.
3. Native enum type where supported.

For regulated systems, lookup table can be better when statuses need metadata:

```sql
CREATE TABLE case_status_ref (
    code VARCHAR(30) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    terminal BOOLEAN NOT NULL
);

ALTER TABLE case_file
ADD CONSTRAINT fk_case_status
FOREIGN KEY (status)
REFERENCES case_status_ref(code);
```

### 13.4 Positive Monetary Amount

```java
@NotNull
@DecimalMin(value = "0.00", inclusive = false)
@Column(name = "amount", nullable = false, precision = 19, scale = 2)
private BigDecimal amount;
```

```sql
ALTER TABLE invoice
ADD CONSTRAINT ck_invoice_amount_positive CHECK (amount > 0);
```

### 13.5 Temporal Range Validity

Simple same-row check:

```sql
ALTER TABLE licence_period
ADD CONSTRAINT ck_licence_period_range
CHECK (end_date IS NULL OR end_date >= start_date);
```

No-overlap across rows is harder:

```text
For same licence_id, active periods must not overlap.
```

Possible approaches:

- PostgreSQL exclusion constraint,
- lock parent licence row and validate before insert,
- serializable transaction,
- trigger,
- maintain canonical period table,
- use effective dating with no update-in-place.

### 13.6 Referential Ownership

Example: document must belong to either application or case, but not both.

```sql
ALTER TABLE document
ADD CONSTRAINT ck_document_owner_exactly_one
CHECK (
    (application_id IS NOT NULL AND case_id IS NULL)
    OR
    (application_id IS NULL AND case_id IS NOT NULL)
);
```

This is a good check constraint: one row, clear rule.

---

## 14. Entity Mapping Constraint vs Migration Constraint

JPA/Jakarta Persistence annotations can express some constraints:

```java
@Table(
    name = "application",
    uniqueConstraints = @UniqueConstraint(
        name = "uq_application_no",
        columnNames = "application_no"
    ),
    indexes = @Index(
        name = "idx_application_status_created_at",
        columnList = "status, created_at"
    )
)
```

But production schema should usually be governed by migration:

```sql
-- V20260616_001__create_application_constraints.sql
ALTER TABLE application
ADD CONSTRAINT uq_application_no UNIQUE (application_no);

CREATE INDEX idx_application_status_created_at
ON application (status, created_at);
```

Why keep annotations then?

- Documentation close to code.
- Test schema generation.
- Provider metadata.
- IDE/model clarity.

Why migration remains source of truth?

- Production rollout is explicit.
- Online index options are vendor-specific.
- Constraint validation can be staged.
- Rollback can be planned.
- Existing data cleanup can be included.
- DBAs/operators can review exact DDL.

---

## 15. Adding Constraints to Existing Production Data

Adding a constraint is not just DDL. It is a rollout.

### 15.1 Safe Rollout Pattern

```text
1. Discover bad data.
2. Stop new bad data at application layer.
3. Backfill/fix existing data.
4. Add database constraint in non-blocking/low-risk mode if supported.
5. Validate constraint.
6. Deploy application that relies on constraint.
7. Monitor violations.
```

Example duplicate application number:

```sql
SELECT application_no, COUNT(*)
FROM application
GROUP BY application_no
HAVING COUNT(*) > 1;
```

Then fix duplicates using business-approved process, not random delete.

### 15.2 Not Null Rollout

```text
Phase 1: Add nullable column.
Phase 2: App writes column for new rows.
Phase 3: Backfill old rows.
Phase 4: Add NOT NULL.
Phase 5: Remove fallback code.
```

### 15.3 Unique Constraint Rollout

```text
Phase 1: Detect duplicates.
Phase 2: Resolve duplicates.
Phase 3: Add unique index/constraint.
Phase 4: Map violation to business error.
```

### 15.4 Foreign Key Rollout

```text
Phase 1: Detect orphan rows.
Phase 2: Fix/delete/archive orphans according to policy.
Phase 3: Add FK.
Phase 4: Decide ON DELETE behavior.
```

Do not add FK blindly to dirty production data.

---

## 16. Constraint Naming Strategy

Constraint names are operational API.

Bad:

```text
SYS_C0083912
UK_5e0bv5arhh7jjhsls27bmqp4a
```

Good:

```text
pk_application
uq_application_application_no
fk_case_file_application
ck_payment_amount_positive
idx_application_status_created_at
```

Naming pattern:

```text
pk_<table>
uq_<table>_<column_or_rule>
fk_<from_table>_<to_table>
ck_<table>_<rule>
idx_<table>_<column_or_purpose>
```

Why important:

- easier error classification,
- easier production debugging,
- easier DBA communication,
- stable API error mapping,
- auditability,
- migration readability.

---

## 17. Constraint and Soft Delete

Soft delete complicates uniqueness.

Example:

```sql
application_no unique
```

If record soft-deleted, can a new record reuse same application_no?

Possible policies:

1. Never reuse business key.
2. Reuse only if deleted.
3. Reuse only after retention period.
4. Reuse never for regulatory records.

For regulatory systems, often better:

```text
business reference should not be reused even if soft-deleted
```

If reuse allowed, design carefully.

PostgreSQL:

```sql
CREATE UNIQUE INDEX uq_active_application_no
ON application (application_no)
WHERE deleted_at IS NULL;
```

Portable alternative:

```sql
ALTER TABLE application
ADD active_key VARCHAR(10);

-- active_key = 'ACTIVE' for non-deleted rows, unique on (application_no, active_key)
```

But null behavior differs by DB. Test on real DB.

Soft delete also affects FK:

- child references soft-deleted parent,
- queries accidentally include deleted row,
- unique constraint behaves differently,
- audit/history becomes confusing.

Soft delete is not just a boolean column.

---

## 18. Constraint and Multi-Tenancy

In multi-tenant/multi-agency systems, uniqueness often scoped.

Wrong:

```sql
UNIQUE (case_no)
```

If case number only unique per agency, correct:

```sql
UNIQUE (agency_id, case_no)
```

DTO may validate format, but database enforces scope.

Common scoped constraints:

```sql
UNIQUE (tenant_id, username)
UNIQUE (agency_id, application_no)
UNIQUE (licence_id, renewal_cycle_no)
UNIQUE (case_id, document_type, version_no)
```

Security note:

- Every unique lookup must include tenant/agency scope.
- Every FK may need tenant consistency.
- Database FK from `(tenant_id, child_id)` to `(tenant_id, parent_id)` can prevent cross-tenant leakage if modeled.

Example composite FK:

```sql
ALTER TABLE case_file
ADD CONSTRAINT uq_case_file_tenant_id_id UNIQUE (tenant_id, id);

ALTER TABLE case_note
ADD CONSTRAINT fk_case_note_case_tenant
FOREIGN KEY (tenant_id, case_id)
REFERENCES case_file(tenant_id, id);
```

This is stronger than application-only tenant filter.

---

## 19. Constraint and Security

Some constraints protect security boundaries.

Examples:

- user role assignment must reference valid role,
- tenant id must not be null,
- case note must belong to same tenant as case,
- approval actor must be non-null,
- external identity subject must be unique per identity provider,
- token/session table must have expiration,
- sensitive document must have classification.

Database cannot enforce all authorization rules, but it can prevent structural security corruption.

Example identity uniqueness:

```sql
ALTER TABLE external_identity
ADD CONSTRAINT uq_external_identity_provider_subject
UNIQUE (provider_code, subject_id);
```

Example classification:

```sql
ALTER TABLE document
ADD CONSTRAINT ck_document_classification
CHECK (classification IN ('PUBLIC', 'INTERNAL', 'RESTRICTED', 'CONFIDENTIAL'));
```

---

## 20. Constraint and API Design

A robust API should expose business errors, not raw DB errors.

Example duplicate:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "code": "DUPLICATE_APPLICATION_NO",
  "message": "Application number already exists.",
  "fieldErrors": [
    {
      "field": "applicationNo",
      "code": "DUPLICATE"
    }
  ],
  "correlationId": "01HY..."
}
```

Example invalid transition:

```http
HTTP/1.1 409 Conflict

{
  "code": "INVALID_CASE_TRANSITION",
  "message": "Case cannot be approved from DRAFT status.",
  "currentStatus": "DRAFT",
  "expectedStatus": "UNDER_REVIEW"
}
```

Example validation error:

```http
HTTP/1.1 400 Bad Request

{
  "code": "VALIDATION_FAILED",
  "fieldErrors": [
    {
      "field": "applicantName",
      "code": "NOT_BLANK",
      "message": "Applicant name is required."
    }
  ]
}
```

Differentiate:

| Error type | HTTP-ish status | Source |
|---|---:|---|
| malformed JSON | 400 | parser |
| DTO validation failed | 400 | validation |
| business rule failed | 422/409 | domain/service |
| duplicate key | 409 | DB constraint |
| optimistic conflict | 409 | version/locking |
| forbidden action | 403 | authorization |
| system DB unavailable | 503/500 | infrastructure |

---

## 21. Constraint and Repository Design

Repository should not hide all constraint semantics.

Bad repository:

```java
boolean existsByApplicationNo(String applicationNo);
Application save(Application application);
```

Then every service duplicates check-save logic.

Better:

```java
public interface ApplicationRepository {
    Application save(Application application);
    Optional<Application> findByApplicationNo(ApplicationNo applicationNo);
}
```

Service owns business behavior:

```java
@Transactional
public ApplicationId createApplication(CreateApplicationCommand command) {
    Application application = Application.create(
            ApplicationNo.of(command.applicationNo()),
            ApplicantName.of(command.applicantName())
    );

    try {
        repository.save(application);
        entityManager.flush();
        return ApplicationId.of(application.getId());
    } catch (DataIntegrityViolationException ex) {
        throw translateCreateApplicationError(ex, command);
    }
}
```

Alternative: repository method encodes uniqueness contract:

```java
Application saveNew(Application application) throws DuplicateApplicationNoException;
```

This can be useful in hexagonal architecture where infrastructure adapter maps DB exception to domain exception.

---

## 22. Constraint and Domain Value Objects

Value object can enforce local invariants before persistence.

```java
public final class ApplicationNo {
    private final String value;

    private ApplicationNo(String value) {
        this.value = value;
    }

    public static ApplicationNo of(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("applicationNo is required");
        }
        String normalized = raw.trim().toUpperCase(Locale.ROOT);
        if (!normalized.matches("APP-[0-9]{6}")) {
            throw new IllegalArgumentException("Invalid application number format");
        }
        return new ApplicationNo(normalized);
    }

    public String value() {
        return value;
    }
}
```

Persist via converter:

```java
@Converter(autoApply = true)
public class ApplicationNoConverter implements AttributeConverter<ApplicationNo, String> {
    @Override
    public String convertToDatabaseColumn(ApplicationNo attribute) {
        return attribute == null ? null : attribute.value();
    }

    @Override
    public ApplicationNo convertToEntityAttribute(String dbData) {
        return dbData == null ? null : ApplicationNo.of(dbData);
    }
}
```

Database still enforces:

```sql
ALTER TABLE application
ADD CONSTRAINT uq_application_application_no UNIQUE (application_no);

ALTER TABLE application
ADD CONSTRAINT ck_application_no_format
CHECK (application_no LIKE 'APP-%');
```

Caveat: regex-like checks are dialect-specific. Do not overuse DB check for complex format if portability matters.

---

## 23. Constraint and Bulk Operations

Bulk update/delete bypasses entity lifecycle and may bypass validation callbacks.

```java
@Modifying
@Query("update Application a set a.status = :status where a.expiredAt < :now")
int markExpired(@Param("status") ApplicationStatus status, @Param("now") Instant now);
```

Risk:

- no entity method called,
- no domain guard,
- no per-entity validation,
- persistence context stale,
- audit not automatically created,
- outbox event not automatically created.

Therefore for bulk operations:

1. use DB constraints as safety net,
2. encode predicate carefully,
3. create audit summary or per-row audit via controlled process,
4. clear persistence context after bulk operation,
5. test on real database,
6. avoid bypassing state machine accidentally.

Example safer bulk transition:

```sql
UPDATE application
SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
WHERE status IN ('DRAFT', 'SUBMITTED')
  AND expiry_at < CURRENT_TIMESTAMP;
```

But if every transition requires per-row audit, a cursor/chunked process may be better than one bulk update.

---

## 24. Constraint and Event/Outbox Design

A business mutation may need event publication.

Invariant:

```text
If application status changes to SUBMITTED, an outbox event must exist.
```

Database cannot easily enforce this general invariant without trigger. Common design:

```java
@Transactional
public void submit(SubmitApplicationCommand command) {
    Application app = repository.get(command.applicationId());
    app.submit(command.actorId());

    auditRepository.save(AuditTrail.stateChange(...));
    outboxRepository.save(OutboxEvent.applicationSubmitted(app));
}
```

Useful DB constraints on outbox:

```sql
ALTER TABLE outbox_event
ADD CONSTRAINT nn_outbox_aggregate_type CHECK (aggregate_type IS NOT NULL);

ALTER TABLE outbox_event
ADD CONSTRAINT nn_outbox_aggregate_id CHECK (aggregate_id IS NOT NULL);

ALTER TABLE outbox_event
ADD CONSTRAINT uq_outbox_event_idempotency
UNIQUE (event_id);
```

For idempotent event creation:

```sql
ALTER TABLE outbox_event
ADD CONSTRAINT uq_outbox_aggregate_event
UNIQUE (aggregate_type, aggregate_id, event_type, aggregate_version);
```

This prevents duplicate event for same aggregate version.

---

## 25. Provider-Specific Tools: Hibernate `@Check`, `@NaturalId`, Generated Values

Hibernate provides features beyond Jakarta Persistence.

### 25.1 `@Check`

```java
@Entity
@Check(constraints = "amount > 0")
public class Payment {
    // ...
}
```

Useful for documentation/prototype, but production DDL should still be reviewed/migration-managed.

### 25.2 `@NaturalId`

A natural id identifies entity by business key.

```java
@Entity
public class Licence {
    @Id
    private Long id;

    @NaturalId
    @Column(name = "licence_no", nullable = false, unique = true)
    private String licenceNo;
}
```

Natural id is a Hibernate feature for lookup/cache semantics. It does not replace DB unique constraint.

### 25.3 Generated Columns / Generated Values

Modern databases often support generated columns. Hibernate has provider-specific support for generated values. Use when:

- normalized key derived by DB,
- search vector,
- computed amount,
- created/updated timestamp from DB,
- JSON extracted column.

But align with migration and refresh behavior. Generated DB values may require insert/update returning or refresh.

---

## 26. Failure Modes

### 26.1 Duplicate Business Key Despite `exists()` Check

Cause:

- no DB unique constraint,
- check-then-insert race.

Fix:

- add unique constraint,
- map violation to 409,
- optional pre-check for UX.

### 26.2 Null Critical Field in Production

Cause:

- only DTO validation,
- batch job inserted directly,
- schema missing `NOT NULL`.

Fix:

- backfill data,
- add `NOT NULL`,
- add validation at DTO/entity,
- add test.

### 26.3 Orphan Records

Cause:

- FK missing,
- delete logic wrong,
- manual script.

Fix:

- cleanup orphan,
- add FK,
- define delete behavior,
- add migration test.

### 26.4 Invalid State Transition

Cause:

- service guard missing,
- bulk update bypassed domain,
- concurrent requests.

Fix:

- centralize transition method,
- optimistic/pessimistic lock,
- conditional update,
- audit transition.

### 26.5 User Sees Raw DB Error

Cause:

- exception translation absent,
- constraint name not classified,
- raw message exposed.

Fix:

- stable constraint names,
- classifier,
- domain error code,
- safe API error response.

### 26.6 Constraint Added but Deployment Fails

Cause:

- existing dirty data,
- long table lock,
- index build blocks writes,
- app still writes invalid data.

Fix:

- preflight query,
- staged rollout,
- online DDL where available,
- backfill,
- deployment runbook.

### 26.7 Constraint Works in H2 but Fails in Production DB

Cause:

- test database behavior differs,
- null uniqueness semantics differ,
- isolation differs,
- check syntax differs.

Fix:

- Testcontainers/real DB integration test,
- dialect-specific migration test,
- avoid relying on H2 for persistence correctness.

---

## 27. Performance Implications

Constraints have performance cost and performance benefit.

### 27.1 Unique Constraint

Cost:

- insert/update must check uniqueness,
- index maintenance,
- possible contention on hot key.

Benefit:

- fast lookup,
- correctness,
- removes expensive application-level distributed coordination.

### 27.2 Foreign Key

Cost:

- parent existence check,
- delete/update checks,
- lock interactions.

Benefit:

- referential correctness,
- optimizer statistics/assumptions in some DBs,
- prevents orphan debugging nightmare.

Important: index child FK columns.

```sql
CREATE INDEX idx_case_file_application_id
ON case_file(application_id);
```

Without child FK index, deleting/updating parent can be expensive or lock-heavy depending database.

### 27.3 Check Constraint

Usually cheap for simple expression. Good correctness return.

### 27.4 Constraint Violation as Control Flow

Do not use constraint violation for normal high-frequency branch if you can avoid it.

Example: high volume idempotent insert may intentionally rely on unique constraint; that can be fine if database supports efficient upsert.

Better for idempotency:

```sql
INSERT INTO idempotency_key (key, request_hash, created_at)
VALUES (?, ?, ?)
ON CONFLICT DO NOTHING;
```

Vendor-specific equivalent differs.

---

## 28. Testing Constraints and Invariants

### 28.1 Test Categories

| Test | Purpose |
|---|---|
| DTO validation test | request shape |
| domain unit test | invariant/state transition |
| repository integration test | mapping/query/constraint |
| migration test | schema correctness |
| concurrency test | race/anomaly |
| API test | error mapping |

### 28.2 Constraint Integration Test

```java
@Test
void duplicateApplicationNoShouldFail() {
    Application first = Application.create("APP-000001", "Alice");
    Application second = Application.create("APP-000001", "Bob");

    repository.save(first);
    entityManager.flush();

    repository.save(second);

    assertThatThrownBy(() -> entityManager.flush())
            .isInstanceOf(DataIntegrityViolationException.class);
}
```

Depending test setup, exception type may be JPA/Hibernate/Spring-specific. Test at appropriate layer.

### 28.3 Concurrency Test

```java
@Test
void concurrentCreateShouldOnlyAllowOneApplicationNo() throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);

    Callable<Boolean> task = () -> {
        ready.countDown();
        start.await();
        try {
            service.create(new CreateApplicationCommand("APP-000123", "Applicant"));
            return true;
        } catch (DuplicateApplicationNoException ex) {
            return false;
        }
    };

    Future<Boolean> f1 = executor.submit(task);
    Future<Boolean> f2 = executor.submit(task);

    ready.await();
    start.countDown();

    List<Boolean> results = List.of(f1.get(), f2.get());
    assertThat(results).containsExactlyInAnyOrder(true, false);
}
```

Run against the real target database or Testcontainers equivalent, not H2-only.

### 28.4 Migration Test

Test that migrations produce expected constraints:

```sql
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'application'
  AND constraint_name = 'uq_application_application_no';
```

For Oracle/PostgreSQL/MySQL/SQL Server, metadata query differs. Keep DB-specific assertion helper.

---

## 29. Production Observability

Track constraint-related failures.

Metrics/log fields:

- constraint name,
- SQLState/vendor code,
- entity/use case,
- correlation id,
- request id,
- tenant/agency id if safe,
- actor id if safe,
- transaction boundary,
- retry count,
- exception class,
- API error code.

Example structured log:

```json
{
  "event": "persistence.constraint_violation",
  "constraint": "uq_application_application_no",
  "useCase": "CreateApplication",
  "apiErrorCode": "DUPLICATE_APPLICATION_NO",
  "correlationId": "01HY...",
  "sqlState": "23505",
  "vendorCode": "0"
}
```

Dashboard ideas:

- duplicate key rate by use case,
- FK violation count,
- check constraint violation count,
- optimistic lock conflict rate,
- deadlock count,
- transaction rollback count,
- validation error rate by field.

Sudden spike in constraint violation may indicate:

- UI bug,
- retry storm,
- duplicate message processing,
- idempotency broken,
- integration partner sending invalid data,
- migration/backfill script issue,
- malicious input.

---

## 30. Design Checklist

### 30.1 For Every Entity/Table

- [ ] Primary key exists and stable.
- [ ] Required fields have DB `NOT NULL`.
- [ ] Business keys have unique constraint/index.
- [ ] Foreign keys exist for important relationships.
- [ ] FK child columns are indexed if needed.
- [ ] Enum/status values are constrained or reference table-backed.
- [ ] Money/quantity fields have precision/scale and check constraints.
- [ ] Date ranges have at least same-row validity checks.
- [ ] Soft delete uniqueness policy is explicit.
- [ ] Tenant/agency scope is included in unique keys where needed.
- [ ] Constraint names are stable and meaningful.

### 30.2 For Every Use Case

- [ ] Request validation exists for input shape.
- [ ] Domain/service validation exists for business meaning.
- [ ] Transaction boundary is clear.
- [ ] Race-prone invariant has DB/lock/conditional update protection.
- [ ] Constraint violations are mapped to domain/API errors.
- [ ] External side effects happen after commit or via outbox.
- [ ] Audit requirements are atomic with state change.
- [ ] Tests cover valid path, invalid path, duplicate/race path.

### 30.3 For Every Migration Adding Constraint

- [ ] Existing dirty data checked.
- [ ] Cleanup/backfill script prepared.
- [ ] Application write path updated before hard constraint if needed.
- [ ] Lock/online DDL impact reviewed.
- [ ] Rollback/forward-fix strategy documented.
- [ ] Constraint name follows naming standard.
- [ ] Monitoring prepared.

---

## 31. Scenario: Designing Constraints for Case Management

### 31.1 Requirements

- Case belongs to one agency.
- Case number unique per agency.
- Case must reference an application.
- Case status must be valid.
- Closed case cannot be reopened except by special appeal process.
- Every state change must have audit trail.
- Officer cannot approve own submitted case.
- One case can have many documents.
- Each document must belong to exactly one case.
- Document version number unique per case and document type.

### 31.2 Schema Constraints

```sql
ALTER TABLE case_file
ADD CONSTRAINT uq_case_file_agency_case_no
UNIQUE (agency_id, case_no);

ALTER TABLE case_file
ADD CONSTRAINT fk_case_file_application
FOREIGN KEY (application_id)
REFERENCES application(id);

ALTER TABLE case_file
ADD CONSTRAINT ck_case_file_status
CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ESCALATED', 'APPROVED', 'REJECTED', 'CLOSED'));

ALTER TABLE document
ADD CONSTRAINT fk_document_case_file
FOREIGN KEY (case_id)
REFERENCES case_file(id);

ALTER TABLE document
ADD CONSTRAINT uq_document_case_type_version
UNIQUE (case_id, document_type, version_no);

ALTER TABLE audit_trail
ADD CONSTRAINT ck_audit_state_pair
CHECK (
    (previous_state IS NULL AND next_state IS NULL)
    OR
    (previous_state IS NOT NULL AND next_state IS NOT NULL)
);
```

### 31.3 Service Invariants

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseFile caseFile = repository.getForUpdate(command.caseId());

    if (caseFile.isSubmittedBy(command.actorId())) {
        throw new SelfApprovalNotAllowedException();
    }

    CaseStatus previous = caseFile.getStatus();
    caseFile.approve(command.actorId(), command.reason());

    auditRepository.save(AuditTrail.stateChange(
            "CASE",
            caseFile.getId().toString(),
            "APPROVE",
            command.actorId(),
            command.reason(),
            previous.name(),
            caseFile.getStatus().name(),
            command.correlationId()
    ));

    outboxRepository.save(OutboxEvent.caseApproved(caseFile));
}
```

### 31.4 What Is Enforced Where?

| Rule | Enforcement |
|---|---|
| case number unique per agency | DB unique |
| application exists | DB FK |
| status valid | DB check/ref table + enum |
| approve only from under review | domain/service + lock/version |
| officer cannot approve own case | domain/service; optionally DB if model supports |
| audit exists for state change | transaction design; maybe trigger in stricter system |
| document version unique | DB unique |
| document belongs to valid case | DB FK |

---

## 32. Latihan

### Latihan 1 — Duplicate Reference

Desain create endpoint untuk `Licence` dengan `licenceNo` unik per agency.

Jawab:

1. DTO validation apa?
2. Domain value object apa?
3. DB constraint apa?
4. Error mapping apa?
5. Concurrency test apa?

### Latihan 2 — One Active Renewal

Satu licence hanya boleh punya satu renewal aktif.

Jawab:

1. Status apa yang dianggap aktif?
2. Constraint apa jika PostgreSQL?
3. Alternatif apa jika Oracle/MySQL/SQL Server?
4. Bagaimana handle concurrent submit?
5. Apa API error code?

### Latihan 3 — No Overlapping Period

Licence period tidak boleh overlap untuk licence yang sama.

Jawab:

1. Same-row check apa?
2. Cross-row invariant bagaimana?
3. Perlu pessimistic lock atau serializable?
4. Bagaimana test concurrency?
5. Bagaimana migration jika existing data sudah overlap?

### Latihan 4 — Audit Required

Setiap transition case harus punya audit.

Jawab:

1. Apakah DB constraint cukup?
2. Bagaimana service transaction design?
3. Apa failure jika audit insert gagal?
4. Apakah outbox event harus atomic?
5. Metrics apa yang perlu dimonitor?

---

## 33. Ringkasan

Bagian ini membangun mental model bahwa persistence correctness tidak cukup dengan annotation dan validation di Java.

Poin utama:

1. **Validation** membantu mengecek input/object dan memberi error yang ramah.
2. **Constraint** menjaga durable state dari data yang mustahil/invalid.
3. **Invariant** adalah aturan bisnis yang harus selalu benar.
4. Invariant penting harus ditempatkan di layer yang tepat: DTO, domain/service, transaction, database, audit.
5. Application-level `exists()` check tidak aman terhadap race tanpa DB unique constraint atau locking strategy.
6. `@Column(nullable = false)` dan `@UniqueConstraint` adalah mapping/schema metadata; production tetap butuh migration-governed schema.
7. Constraint names harus stabil karena menjadi bagian dari error classification dan operasi production.
8. Soft delete, multi-tenancy, temporal validity, and state machine membuat constraint design jauh lebih kompleks.
9. Constraint violation harus diterjemahkan menjadi domain/API error, bukan raw database message.
10. Untuk regulated/case-management system, correctness harus disertai explainability: audit, reason, actor, correlation id, dan transaction atomicity.

---

## 34. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

```text
Part 019 — Caching: First-Level Cache, Second-Level Cache, Query Cache, External Cache
```

Setelah memahami invariant dan constraint, caching perlu dipelajari dengan hati-hati karena cache dapat mempercepat read path tetapi juga dapat memperkenalkan stale data, consistency illusion, invalidation bugs, dan authorization leakage.

