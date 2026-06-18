# learn-java-validation-jakarta-hibernate-validator-part-020

# Validation in Persistence: JPA Lifecycle, Hibernate ORM, Database Constraints

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `020`  
> Topik: Bean/Jakarta Validation di persistence layer, JPA lifecycle, Hibernate ORM integration, dan batas tanggung jawab database constraint  
> Target: Java 8 sampai Java 25, `javax.validation` sampai `jakarta.validation`, Hibernate Validator 6/7/8/9, JPA/Jakarta Persistence, Hibernate ORM

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya, kita sudah membahas validation di REST API sebagai public boundary. Sekarang kita masuk ke layer yang sering lebih berbahaya: **persistence validation**.

Banyak engineer berpikir:

> “Kalau entity sudah pakai `@NotNull`, berarti data di database aman.”

Itu asumsi yang salah.

Bean/Jakarta Validation pada entity berguna, tetapi **bukan pengganti database constraint**. Ia bekerja pada level object di JVM, sebelum SQL benar-benar menjadi fakta di database. Sementara database constraint adalah final authority atas data yang persisted.

Bagian ini akan membangun mental model yang jelas:

```text
Request DTO validation
    ↓
Command/application validation
    ↓
Domain invariant
    ↓
JPA/Hibernate entity validation
    ↓
Database constraint
    ↓
Transaction commit
```

Setiap layer punya tanggung jawab berbeda. Layer persistence bukan tempat untuk menaruh semua rule, tetapi juga tidak boleh dibiarkan kosong.

---

## 2. Mental Model Utama: Persistence Validation Bukan “Final Truth”

### 2.1 Apa yang divalidasi Bean Validation?

Jakarta Validation mendefinisikan mekanisme validasi terhadap **object model**: field, property, class, method parameter, return value, container element, dan metadata constraint.

Contoh:

```java
@Entity
public class Applicant {

    @Id
    private Long id;

    @NotBlank
    @Size(max = 100)
    private String name;

    @Email
    @Size(max = 255)
    private String email;
}
```

Constraint di atas memvalidasi object Java `Applicant`.

Ia belum membuktikan bahwa:

- kolom database benar-benar `NOT NULL`,
- panjang kolom database cukup,
- email unique,
- foreign key valid,
- data tidak berubah oleh transaksi lain,
- trigger database tidak menolak,
- constraint deferrable tidak gagal saat commit,
- data tetap valid setelah concurrent update.

### 2.2 Apa yang divalidasi database?

Database constraint memvalidasi **state persisted**.

Contoh:

```sql
CREATE TABLE applicant (
    id NUMBER PRIMARY KEY,
    name VARCHAR2(100) NOT NULL,
    email VARCHAR2(255),
    CONSTRAINT uk_applicant_email UNIQUE (email)
);
```

Database tidak peduli object Java berasal dari REST API, batch job, migration script, SQL console, stored procedure, atau service lain. Semua jalur dipaksa tunduk pada constraint yang sama.

### 2.3 Prinsip arsitektural

Rule shape dan invariant ringan boleh berada di Bean Validation.

Rule final consistency harus berada di database.

Rule contextual/business/workflow harus berada di application/domain layer.

```text
Bean Validation:
  "Apakah object ini structurally valid?"

Domain/Application:
  "Apakah operasi ini valid dalam konteks bisnis saat ini?"

Database:
  "Apakah state persisted ini tetap konsisten secara final?"
```

---

## 3. JPA Lifecycle dan Kapan Validation Terjadi

JPA/Jakarta Persistence memiliki lifecycle event seperti:

- `@PrePersist`
- `@PostPersist`
- `@PreUpdate`
- `@PostUpdate`
- `@PreRemove`
- `@PostRemove`
- `@PostLoad`

Dalam integrasi Bean Validation/Jakarta Validation dengan JPA provider, entity biasanya divalidasi saat lifecycle event tertentu sebelum database operation dilakukan.

Secara praktis di Hibernate ORM + Hibernate Validator, validasi entity umumnya terjadi sebelum insert dan update. Dokumentasi Hibernate Validator menjelaskan bahwa object secara default dicek sebelum insert/update oleh Hibernate, sedangkan pre-delete secara default tidak memicu validation kecuali dikonfigurasi khusus.

Mental modelnya:

```text
entityManager.persist(entity)
    ↓
entity becomes managed
    ↓
flush time
    ↓
pre-insert event
    ↓
Bean Validation listener validates entity
    ↓
if valid: SQL INSERT generated/executed
    ↓
DB constraints checked
    ↓
commit
```

Untuk update:

```text
managedEntity.setName("")
    ↓
transaction continues
    ↓
flush time
    ↓
dirty checking detects update
    ↓
pre-update event
    ↓
Bean Validation listener validates entity
    ↓
if valid: SQL UPDATE generated/executed
    ↓
DB constraints checked
    ↓
commit
```

Poin penting:

> Validasi entity biasanya terjadi saat flush, bukan selalu tepat saat setter dipanggil.

Ini penting karena entity bisa berada dalam state invalid sementara selama satu transaction.

Contoh:

```java
@Transactional
public void renameApplicant(Long id, String newName) {
    Applicant applicant = applicantRepository.getReferenceById(id);

    applicant.setName(null);          // invalid sementara
    applicant.setName(newName.trim()); // valid sebelum flush
}
```

Selama tidak flush di tengah, ini bisa lolos. Tetapi jika ada query yang memicu auto-flush di antara dua assignment, validasi bisa terjadi lebih awal.

---

## 4. Flush-Time Validation: Kenapa Timing Sangat Penting

JPA persistence context bekerja sebagai unit-of-work.

Entity yang managed tidak langsung selalu menghasilkan SQL ketika field berubah. Perubahan dikumpulkan, lalu di-flush.

Flush bisa terjadi saat:

- transaction commit,
- explicit `entityManager.flush()`,
- query tertentu sebelum dieksekusi,
- provider-specific behavior,
- repository method tertentu tergantung framework.

### 4.1 Contoh auto-flush trap

```java
@Transactional
public void update(ApplicantUpdateCommand command) {
    Applicant applicant = applicantRepository.getReferenceById(command.id());

    applicant.setName(null);

    // Query ini bisa memicu flush sebelum name diperbaiki.
    boolean duplicate = applicantRepository.existsByEmail(command.email());

    applicant.setName(command.name());
}
```

Jika auto-flush terjadi sebelum query, entity invalid bisa divalidasi dan menyebabkan exception.

Solusi bukan “matikan validation”, tetapi desain transaction flow dengan benar:

```java
@Transactional
public void update(ApplicantUpdateCommand command) {
    Applicant applicant = applicantRepository.getReferenceById(command.id());

    String normalizedName = normalizeRequiredName(command.name());
    String normalizedEmail = normalizeEmail(command.email());

    boolean duplicate = applicantRepository.existsByEmail(normalizedEmail);
    if (duplicate) {
        throw new DuplicateEmailException(normalizedEmail);
    }

    applicant.rename(normalizedName);
    applicant.changeEmail(normalizedEmail);
}
```

Prinsip:

> Jangan letakkan entity managed ke state invalid jika setelah itu masih ada operasi yang dapat memicu flush.

---

## 5. Entity Constraint vs DTO Constraint

Kesalahan umum:

```java
@Entity
public class ApplicationEntity {

    @NotNull
    private String applicantName;

    @NotNull
    private String remarks;
}
```

Lalu entity yang sama dipakai untuk create, update, draft save, submit, approve, import, dan archival.

Masalahnya: requiredness berbeda per operasi.

### 5.1 DTO constraint: external contract

```java
public record SubmitApplicationRequest(
        @NotBlank String applicantName,
        @NotBlank String declaration,
        @Valid List<@Valid SupportingDocumentRequest> documents
) {}
```

DTO menjawab:

```text
Apa yang harus dikirim client untuk operasi submit?
```

### 5.2 Entity constraint: persistent invariant

```java
@Entity
public class ApplicationEntity {

    @NotNull
    @Column(nullable = false)
    private ApplicationStatus status;

    @Size(max = 100)
    @Column(length = 100)
    private String applicantName;
}
```

Entity constraint menjawab:

```text
Apa invariant minimum yang harus benar untuk object persisted ini?
```

### 5.3 Domain/application validation: contextual rule

```java
public final class SubmitApplicationPolicy {

    public ValidationResult validate(Application application) {
        ValidationResult result = new ValidationResult();

        if (application.applicantName().isBlank()) {
            result.reject("APP.SUBMIT.APPLICANT_NAME_REQUIRED");
        }

        if (!application.hasDeclaration()) {
            result.reject("APP.SUBMIT.DECLARATION_REQUIRED");
        }

        if (!application.hasAtLeastOneDocument()) {
            result.reject("APP.SUBMIT.DOCUMENT_REQUIRED");
        }

        return result;
    }
}
```

Policy menjawab:

```text
Apakah aplikasi ini boleh transisi dari DRAFT ke SUBMITTED?
```

### 5.4 Database constraint: final consistency

```sql
ALTER TABLE application
ADD CONSTRAINT ck_application_status
CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));

ALTER TABLE application
MODIFY status NOT NULL;
```

Database menjawab:

```text
Apakah data persisted ini legal secara final?
```

---

## 6. Rule Placement Matrix

Gunakan matrix ini saat menentukan rule harus ditempatkan di mana.

| Rule | DTO Bean Validation | Entity Bean Validation | Domain/Application | Database |
|---|---:|---:|---:|---:|
| Request field required saat create | Ya | Tidak selalu | Bisa | Tidak selalu |
| Field wajib selalu ada di persisted row | Bisa | Ya | Bisa | Wajib |
| Max string length sesuai kolom | Ya | Ya | Tidak perlu | Wajib |
| Email format | Ya | Bisa | Jarang | Tidak ideal |
| Unique email | Tidak cukup | Tidak cukup | Ya, untuk UX | Wajib |
| Foreign key existence | Tidak | Tidak cukup | Bisa | Wajib |
| User boleh update record ini | Tidak | Tidak | Wajib | Bisa dengan RLS/policy, tapi tidak umum |
| Case boleh submit dari state sekarang | Tidak | Tidak | Wajib | Bisa partially via constraint, tapi sering tidak cukup |
| Amount tidak negatif | Ya | Ya | Bisa | Wajib jika persisted |
| Cross-row aggregate limit | Tidak | Tidak cukup | Ya | Bisa dengan transaction/lock/materialized rule |
| Reference data masih aktif | Tidak cukup | Tidak cukup | Ya | Bisa dengan FK + status logic tidak cukup |
| PII redaction rule | Tidak | Tidak | Ya | Bisa via column/security design |

Prinsip:

- DTO validation melindungi API boundary.
- Entity validation melindungi object persistence invariant.
- Domain validation melindungi contextual operation.
- Database constraint melindungi final persisted state.

---

## 7. JPA Entity Validation: Contoh yang Masuk Akal

### 7.1 Entity dengan invariant persistent sederhana

```java
@Entity
@Table(name = "case_file")
public class CaseFileEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotNull
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private CaseStatus status;

    @Size(max = 50)
    @Column(name = "case_reference_no", length = 50, unique = true)
    private String caseReferenceNo;

    @NotNull
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    protected CaseFileEntity() {
        // JPA constructor
    }

    public CaseFileEntity(Instant now) {
        this.status = CaseStatus.DRAFT;
        this.createdAt = Objects.requireNonNull(now, "now must not be null");
    }

    public void markSubmitted(Instant now) {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        this.status = CaseStatus.SUBMITTED;
        this.submittedAt = Objects.requireNonNull(now, "now must not be null");
    }
}
```

Entity Bean Validation cocok untuk:

- `status` tidak boleh null,
- `createdAt` tidak boleh null,
- panjang `caseReferenceNo`,
- local format/invariant ringan.

Tetapi rule “case boleh submit?” lebih cocok di method domain atau policy, bukan annotation field.

### 7.2 Database tetap harus punya constraint

```sql
CREATE TABLE case_file (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    status VARCHAR(30) NOT NULL,
    case_reference_no VARCHAR(50),
    created_at TIMESTAMP NOT NULL,
    submitted_at TIMESTAMP,
    CONSTRAINT uk_case_file_ref UNIQUE (case_reference_no),
    CONSTRAINT ck_case_file_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'))
);
```

Entity annotation membantu JVM-side correctness. Database constraint membantu data-side correctness.

Keduanya bukan duplikasi buruk. Keduanya adalah defense-in-depth.

---

## 8. JPA Lifecycle Validation dan Groups

Dalam JPA integration, group yang divalidasi untuk lifecycle event bisa dikonfigurasi.

Konsep umumnya:

- pre-persist group,
- pre-update group,
- pre-remove group.

Pada era `javax.validation`, property umum yang sering digunakan:

```properties
javax.persistence.validation.group.pre-persist=com.example.validation.OnCreate
javax.persistence.validation.group.pre-update=com.example.validation.OnUpdate
javax.persistence.validation.group.pre-remove=com.example.validation.OnDelete
```

Pada stack Jakarta modern, namespace property dapat mengikuti Jakarta Persistence/Jakarta Validation integration sesuai provider dan versi.

Contoh entity:

```java
public interface OnCreate {}
public interface OnUpdate {}

@Entity
public class DocumentEntity {

    @Id
    private Long id;

    @NotNull(groups = OnCreate.class)
    @Column(name = "created_by", nullable = false)
    private String createdBy;

    @NotNull(groups = OnUpdate.class)
    @Column(name = "updated_by")
    private String updatedBy;
}
```

Namun hati-hati: ini terlihat menarik, tetapi bisa membuat entity tahu terlalu banyak tentang lifecycle teknis.

### 8.1 Kapan group pada entity lifecycle masuk akal?

Masuk akal jika rule benar-benar persistence-lifecycle-specific:

- field wajib saat insert,
- field wajib saat update,
- soft-delete metadata wajib saat remove/update status,
- audit metadata teknis.

### 8.2 Kapan group pada entity lifecycle tidak cocok?

Tidak cocok jika rule sebenarnya operasi bisnis:

- submit application,
- approve case,
- reject appeal,
- assign officer,
- escalate enforcement,
- close investigation.

Itu bukan sekadar “insert/update”. Itu transition/domain operation.

Jangan memaksa workflow menjadi `pre-update` group.

---

## 9. Entity Callback vs Bean Validation

Entity callback:

```java
@PrePersist
void beforeInsert() {
    this.createdAt = Instant.now();
}

@PreUpdate
void beforeUpdate() {
    this.updatedAt = Instant.now();
}
```

Bean Validation:

```java
@NotNull
@Column(nullable = false)
private Instant createdAt;
```

Keduanya berbeda.

Callback cocok untuk:

- set timestamp,
- set audit field,
- normalization sederhana yang benar-benar entity-local,
- lifecycle bookkeeping.

Validation cocok untuk:

- memastikan field tidak null,
- memastikan length/format lokal,
- memastikan object local consistency.

Callback tidak ideal untuk:

- memanggil repository,
- memanggil external service,
- authorization,
- workflow transition,
- complex business policy.

Contoh anti-pattern:

```java
@PreUpdate
void validateBeforeUpdate() {
    if (status == CaseStatus.APPROVED && approvedBy == null) {
        throw new IllegalStateException("approvedBy is required");
    }
}
```

Ini masih mungkin diterima sebagai local invariant, tetapi sering lebih baik dibuat eksplisit di domain method:

```java
public void approve(UserId approver, Instant now) {
    if (status != CaseStatus.SUBMITTED) {
        throw new InvalidTransitionException(status, CaseStatus.APPROVED);
    }
    this.status = CaseStatus.APPROVED;
    this.approvedBy = approver.value();
    this.approvedAt = now;
}
```

Kemudian database constraint dapat menjaga final state jika memungkinkan:

```sql
ALTER TABLE case_file ADD CONSTRAINT ck_approved_fields
CHECK (
    status <> 'APPROVED'
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
);
```

---

## 10. Entity Graph Validation Hazard

### 10.1 `@Valid` pada entity relationship sering berbahaya

Contoh:

```java
@Entity
public class CaseFileEntity {

    @OneToMany(mappedBy = "caseFile")
    @Valid
    private List<DocumentEntity> documents = new ArrayList<>();
}
```

Ini terlihat bagus. Tetapi bisa menimbulkan masalah:

- validasi parent memvalidasi semua child,
- child bisa punya relationship balik ke parent,
- graph bisa sangat besar,
- lazy collection bisa terinisialisasi tidak sengaja,
- performance flush memburuk,
- validation error muncul dari object yang tidak relevan dengan operasi,
- update kecil pada parent bisa gagal karena child lama invalid.

### 10.2 Contoh failure

Operasi hanya ingin rename case title:

```java
@Transactional
public void renameCase(Long id, String title) {
    CaseFileEntity caseFile = caseRepository.getReferenceById(id);
    caseFile.rename(title);
}
```

Tetapi karena `CaseFileEntity.documents` diberi `@Valid`, flush dapat memvalidasi documents. Jika ada document lama invalid akibat legacy data, rename case gagal.

Ini buruk karena validasi tidak sesuai operation intent.

### 10.3 Guideline

Untuk entity relationship:

- Hindari `@Valid` besar-besaran pada JPA association.
- Validasi child explicit pada use case yang relevan.
- Gunakan aggregate boundary, bukan database relationship boundary.
- Jangan cascade validation melintasi seluruh object graph persistence.

Lebih aman:

```java
public final class SubmitCasePolicy {

    public ValidationResult validate(CaseAggregate caseAggregate) {
        ValidationResult result = new ValidationResult();

        if (caseAggregate.documents().isEmpty()) {
            result.reject("CASE.SUBMIT.DOCUMENT_REQUIRED");
        }

        for (Document doc : caseAggregate.documents()) {
            if (!doc.isReadyForSubmission()) {
                result.reject("CASE.SUBMIT.DOCUMENT_NOT_READY", doc.id());
            }
        }

        return result;
    }
}
```

---

## 11. Lazy Loading dan Validation

JPA lazy loading berarti association tidak selalu loaded.

Jika validation menyentuh association, ia bisa memicu query.

Contoh:

```java
@Entity
public class ApplicationEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @Valid
    private ApplicantEntity applicant;
}
```

Ketika validation berjalan, provider dapat perlu mengakses applicant. Ini bisa:

- menambah query saat flush,
- menyebabkan N+1,
- gagal jika session/persistence context sudah tidak aktif,
- memperlambat batch update,
- menghasilkan validation side effect yang sulit diprediksi.

Prinsip:

> Validation sebaiknya tidak membuat persistence graph traversal tersembunyi.

Entity validation yang bagus biasanya bersifat local:

```java
@NotNull
@Column(nullable = false)
private Long applicantId;
```

Atau association tanpa cascade validation:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "applicant_id", nullable = false)
private ApplicantEntity applicant;
```

Database menjaga FK:

```sql
ALTER TABLE application
ADD CONSTRAINT fk_application_applicant
FOREIGN KEY (applicant_id) REFERENCES applicant(id);
```

---

## 12. Database Constraint: Final Authority

Bean Validation memberikan feedback cepat dan structured error. Database constraint memberikan final consistency.

### 12.1 NOT NULL

Java:

```java
@NotNull
@Column(nullable = false)
private CaseStatus status;
```

Database:

```sql
status VARCHAR(30) NOT NULL
```

Keduanya perlu.

Kenapa?

- Java validation bisa dilewati oleh native SQL.
- Data migration bisa melewati application.
- Service lain bisa menulis ke DB.
- Bug config bisa mematikan validation listener.
- Constraint database tetap memaksa invariant.

### 12.2 Length

Java:

```java
@Size(max = 100)
@Column(length = 100)
private String name;
```

Database:

```sql
name VARCHAR(100)
```

Kalau hanya Java `@Size(max=100)`, database bisa tetap menerima data panjang dari jalur lain.

Kalau hanya database `VARCHAR(100)`, user mendapat error SQL yang terlambat dan tidak friendly.

### 12.3 CHECK

```sql
ALTER TABLE invoice
ADD CONSTRAINT ck_invoice_amount_positive
CHECK (amount >= 0);
```

Java:

```java
@PositiveOrZero
@Column(nullable = false)
private BigDecimal amount;
```

### 12.4 UNIQUE

```sql
ALTER TABLE applicant
ADD CONSTRAINT uk_applicant_email UNIQUE (email);
```

Java/application:

```java
if (applicantRepository.existsByEmail(email)) {
    throw new DuplicateEmailException(email);
}
```

Tetapi `existsByEmail` hanya untuk UX. Unique constraint tetap wajib.

### 12.5 FOREIGN KEY

```sql
ALTER TABLE application
ADD CONSTRAINT fk_application_case_type
FOREIGN KEY (case_type_id) REFERENCES case_type(id);
```

Application bisa cek reference aktif, tetapi FK menjaga existence.

---

## 13. Race Condition: Validation Says OK, DB Rejects Later

Contoh uniqueness.

```java
@Transactional
public void register(String email) {
    if (repository.existsByEmail(email)) {
        throw new DuplicateEmailException(email);
    }

    repository.save(new Applicant(email));
}
```

Dua request masuk bersamaan:

```text
T1: existsByEmail("a@example.com") -> false
T2: existsByEmail("a@example.com") -> false
T1: insert a@example.com -> success
T2: insert a@example.com -> DB unique constraint violation
```

Application validation tidak cukup. Database unique constraint adalah final authority.

Pattern yang benar:

```java
@Transactional
public void register(String rawEmail) {
    String email = normalizeEmail(rawEmail);

    try {
        repository.saveAndFlush(new Applicant(email));
    } catch (DataIntegrityViolationException ex) {
        if (isUniqueEmailViolation(ex)) {
            throw new DuplicateEmailException(email, ex);
        }
        throw ex;
    }
}
```

Atau:

```java
@Transactional
public void register(String rawEmail) {
    String email = normalizeEmail(rawEmail);

    if (repository.existsByEmail(email)) {
        throw new DuplicateEmailException(email);
    }

    try {
        repository.save(new Applicant(email));
    } catch (DataIntegrityViolationException ex) {
        if (isUniqueEmailViolation(ex)) {
            throw new DuplicateEmailException(email, ex);
        }
        throw ex;
    }
}
```

Pre-check membantu user experience. DB constraint menangani race.

---

## 14. Mapping Database Error ke Domain/API Error

Database error sering datang sebagai:

- SQLState,
- vendor error code,
- constraint name,
- nested exception,
- framework wrapper seperti `DataIntegrityViolationException`.

Jangan leak raw SQL error ke client.

Buruk:

```json
{
  "error": "ORA-00001: unique constraint (APP.UK_APPLICANT_EMAIL) violated"
}
```

Lebih baik:

```json
{
  "type": "https://api.example.com/problems/duplicate-resource",
  "title": "Duplicate resource",
  "status": 409,
  "code": "APPLICANT.EMAIL_ALREADY_EXISTS",
  "violations": [
    {
      "path": "email",
      "code": "APPLICANT.EMAIL_ALREADY_EXISTS",
      "message": "Email is already registered."
    }
  ]
}
```

### 14.1 Constraint name convention

Gunakan naming convention database constraint yang bisa dipetakan.

```sql
CONSTRAINT uk_applicant__email UNIQUE (email)
CONSTRAINT ck_invoice__amount_non_negative CHECK (amount >= 0)
CONSTRAINT fk_application__applicant FOREIGN KEY (applicant_id) REFERENCES applicant(id)
```

Mapping:

```java
public final class DatabaseConstraintMapper {

    private static final Map<String, DomainError> CONSTRAINTS = Map.of(
            "uk_applicant__email",
            new DomainError("APPLICANT.EMAIL_ALREADY_EXISTS", "email"),

            "ck_invoice__amount_non_negative",
            new DomainError("INVOICE.AMOUNT_NEGATIVE", "amount"),

            "fk_application__applicant",
            new DomainError("APPLICATION.APPLICANT_NOT_FOUND", "applicantId")
    );

    public Optional<DomainError> map(String constraintName) {
        if (constraintName == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(CONSTRAINTS.get(constraintName.toLowerCase(Locale.ROOT)));
    }
}
```

Ini membuat database error menjadi bagian dari error contract, bukan exception acak.

---

## 15. Entity Bean Validation Exception vs Database Constraint Exception

Dua failure ini harus dibedakan.

### 15.1 Bean Validation failure

Biasanya menghasilkan:

- `ConstraintViolationException` dari validation API/provider,
- berisi set of `ConstraintViolation`,
- punya path, message, invalid value, descriptor.

Artinya:

```text
Object Java tidak memenuhi constraint sebelum SQL dijalankan.
```

### 15.2 Database constraint failure

Biasanya menghasilkan:

- SQL exception vendor,
- persistence exception,
- Spring `DataIntegrityViolationException`,
- constraint name/vendor code.

Artinya:

```text
Database menolak operasi persistence.
```

### 15.3 API mapping berbeda

| Failure | Typical HTTP | Meaning |
|---|---:|---|
| Request DTO invalid | 400/422 | Client submitted invalid input |
| Entity validation invalid karena bug mapping/internal | 500 atau 422 tergantung sumber | Bisa client issue atau server bug |
| Unique constraint violation | 409 | Conflict with existing state |
| FK violation dari stale reference | 409/422 | Reference invalid or stale |
| NOT NULL database violation internal | 500 jika seharusnya dicegah | Server bug/invariant leak |
| CHECK violation dari client command | 422/409 | Domain/data constraint violated |

Jangan otomatis mapping semua persistence exception menjadi 400.

---

## 16. Entity Validation Bisa Menyembunyikan Bug jika Terlalu Dipercaya

Contoh:

```java
@Entity
public class PaymentEntity {

    @Positive
    private BigDecimal amount;
}
```

Jika database tidak punya check constraint:

```sql
amount NUMBER(19, 2)
```

Lalu ada migration script:

```sql
INSERT INTO payment(id, amount) VALUES (1, -100);
```

Data invalid masuk.

Bean Validation tidak melindungi database dari jalur non-Java.

Untuk data critical:

```sql
ALTER TABLE payment
ADD CONSTRAINT ck_payment_amount_positive
CHECK (amount > 0);
```

Top-tier engineering mindset:

> Kalau invariant harus selalu benar di persisted state, letakkan invariant itu di database juga.

---

## 17. `@Column(nullable=false)` Bukan Validasi yang Sama dengan `@NotNull`

```java
@NotNull
@Column(nullable = false)
private String name;
```

Keduanya berbeda.

`@NotNull`:

- bagian dari Bean/Jakarta Validation,
- berjalan di JVM,
- menghasilkan `ConstraintViolation`,
- bisa dipakai DTO/entity/method,
- bisa punya group/message/payload.

`@Column(nullable=false)`:

- metadata ORM,
- dapat memengaruhi schema generation,
- dapat memberi informasi ke provider,
- bukan pengganti runtime validation di semua konteks,
- bukan jaminan jika schema tidak digenerate dari entity.

Database `NOT NULL`:

- constraint aktual di database,
- final authority.

Jangan menganggap `@Column(nullable=false)` cukup.

---

## 18. Schema Generation: Entity Annotation Bukan Governance Schema

Hibernate/JPA bisa generate schema dari entity. Namun di production enterprise, schema biasanya dikelola lewat migration tool:

- Flyway,
- Liquibase,
- manual DBA script,
- controlled DDL pipeline.

Entity annotation dan schema migration bisa drift.

Contoh drift:

```java
@Size(max = 100)
@Column(length = 100)
private String name;
```

Tetapi database:

```sql
name VARCHAR(80)
```

Akibat:

- Bean Validation menerima 90 karakter,
- database menolak insert/update.

Atau sebaliknya:

```java
@Size(max = 80)
@Column(length = 80)
private String name;
```

Database:

```sql
name VARCHAR(100)
```

Akibat:

- database bisa menampung 100,
- application membatasi 80,
- mungkin intentional, mungkin drift.

### 18.1 Governance pattern

Untuk field persisted critical:

```text
Java constraint
  ↔ ORM mapping
  ↔ migration DDL
  ↔ API documentation
  ↔ frontend validation
  ↔ tests
```

Minimal test:

- integration test insert max length,
- migration validation,
- schema diff check,
- API contract test.

---

## 19. JPA Entity as DTO: Anti-Pattern Besar

Buruk:

```java
@PostMapping("/applications")
public ApplicationEntity create(@Valid @RequestBody ApplicationEntity entity) {
    return repository.save(entity);
}
```

Masalah:

- client bisa mengirim field internal,
- persistence model bocor ke API,
- relationship bisa dimanipulasi,
- validation group kacau,
- lazy fields/serialization problem,
- over-posting vulnerability,
- versioning API sulit,
- entity lifecycle bercampur request lifecycle.

Lebih baik:

```java
public record CreateApplicationRequest(
        @NotBlank String applicantName,
        @NotBlank String caseType,
        List<@Valid DocumentRequest> documents
) {}
```

Controller:

```java
@PostMapping("/applications")
public ResponseEntity<ApplicationResponse> create(
        @Valid @RequestBody CreateApplicationRequest request
) {
    ApplicationId id = applicationService.create(request);
    return ResponseEntity.created(locationOf(id)).build();
}
```

Service:

```java
@Transactional
public ApplicationId create(CreateApplicationRequest request) {
    ApplicationEntity entity = ApplicationEntity.createDraft(
            request.applicantName(),
            request.caseType(),
            clock.instant()
    );

    repository.save(entity);
    return new ApplicationId(entity.getId());
}
```

Entity tidak dijadikan API contract.

---

## 20. Validation dengan Hibernate ORM Dirty Checking

Hibernate dirty checking mendeteksi perubahan managed entity dan menghasilkan SQL update saat flush.

Poin penting:

- Bean Validation pre-update biasanya memvalidasi entity instance.
- Constraint pada field yang tidak berubah tetap bisa dievaluasi karena entity object divalidasi sebagai object, bukan hanya changed columns.
- Legacy invalid field bisa membuat update field lain gagal.

Contoh:

```java
@Entity
public class ApplicantEntity {

    @NotBlank
    private String name;

    @Email
    private String email;

    private String phone;
}
```

Jika legacy data punya `email = "not-an-email"`, lalu operasi hanya update phone:

```java
applicant.setPhone("12345678");
```

Pre-update validation bisa gagal karena email invalid, meski email tidak diubah.

### 20.1 Apa solusinya?

Tergantung konteks.

Pilihan:

1. Bersihkan legacy data.
2. Jangan tambahkan entity constraint yang tidak compatible dengan existing data tanpa migration.
3. Gunakan staged rollout.
4. Gunakan group tertentu untuk update jika benar-benar perlu.
5. Tempatkan rule di DTO/command, bukan entity, jika hanya berlaku untuk input baru.

Jangan asal menambahkan constraint ke entity production tanpa data impact analysis.

---

## 21. Legacy Data dan Constraint Rollout

Saat menambahkan constraint baru ke entity/database, tanyakan:

```text
Apakah semua existing persisted data memenuhi rule ini?
```

Jika tidak, maka rollout perlu bertahap.

### 21.1 Rollout pattern

```text
1. Observe
   - tambahkan query/report untuk data yang melanggar rule
   - ukur jumlah pelanggaran

2. Warn
   - tampilkan warning pada UI/internal tool
   - log metric rule violation

3. Backfill/Cleanup
   - migration script
   - data correction workflow
   - manual review untuk data sensitif

4. Enforce at application layer
   - DTO/command/entity validation

5. Enforce at database layer
   - NOT NULL/CHECK/UNIQUE/FK

6. Monitor
   - constraint violation count
   - failed transactions
```

### 21.2 Contoh migration ke NOT NULL

Buruk:

```sql
ALTER TABLE application MODIFY applicant_name NOT NULL;
```

Jika existing data masih null, migration gagal.

Lebih baik:

```sql
SELECT COUNT(*)
FROM application
WHERE applicant_name IS NULL;
```

Lalu backfill/cleanup:

```sql
UPDATE application
SET applicant_name = 'UNKNOWN'
WHERE applicant_name IS NULL
  AND source = 'LEGACY_MIGRATION';
```

Tetapi hati-hati: default palsu bisa merusak defensibility. Untuk regulatory system, kadang lebih baik status “MISSING_LEGACY_DATA” daripada nilai buatan.

---

## 22. Database Constraint dan Regulatory Defensibility

Dalam sistem regulatory/case management, constraint bukan hanya technical guard. Ia bagian dari defensibility.

Contoh rule:

```text
Approved case must have approver, approval timestamp, and approval decision reason.
```

Application method:

```java
public void approve(UserId approver, String reason, Instant now) {
    if (status != CaseStatus.SUBMITTED) {
        throw new InvalidTransitionException(status, CaseStatus.APPROVED);
    }
    if (reason == null || reason.isBlank()) {
        throw new MissingApprovalReasonException();
    }

    this.status = CaseStatus.APPROVED;
    this.approvedBy = approver.value();
    this.approvedAt = now;
    this.approvalReason = reason;
}
```

Entity validation:

```java
@Size(max = 4000)
@Column(name = "approval_reason", length = 4000)
private String approvalReason;
```

Database check:

```sql
ALTER TABLE case_file ADD CONSTRAINT ck_case_approved_evidence
CHECK (
    status <> 'APPROVED'
    OR (
        approved_by IS NOT NULL
        AND approved_at IS NOT NULL
        AND approval_reason IS NOT NULL
    )
);
```

Audit trail:

```text
CASE.APPROVE.REASON_REQUIRED
CASE.APPROVE.INVALID_SOURCE_STATE
CASE.APPROVE.APPROVER_REQUIRED
```

Ini bukan sekadar validation; ini membangun evidence bahwa sistem tidak membiarkan state regulatory critical menjadi tidak lengkap.

---

## 23. Bean Validation dan Transaction Boundary

Validation sebelum persistence tidak sama dengan validation saat commit.

Transaction bisa berubah karena:

- data lain berubah oleh transaksi lain,
- isolation level,
- lock timing,
- deferred constraints,
- triggers,
- generated values,
- database defaults,
- batch flush ordering.

### 23.1 Deferred constraint

Beberapa database mendukung constraint yang dicek saat commit, bukan saat statement langsung.

Mental model:

```text
application validation OK
SQL statement OK
transaction continues
commit
DB deferred constraint fails
```

Application harus tetap siap menangani exception saat commit.

### 23.2 Flush ordering

Hibernate bisa mengurutkan insert/update/delete untuk foreign key dan batching. Jika object graph kompleks, failure bisa muncul dari urutan flush yang tidak sesuai intuisi developer.

Jangan jadikan “saya sudah validasi sebelum save” sebagai alasan tidak menangani persistence exception.

---

## 24. Bean Validation dan Database Defaults

Contoh:

```sql
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
```

Entity:

```java
@NotNull
@Column(name = "created_at", nullable = false)
private Instant createdAt;
```

Jika Java tidak set `createdAt`, Bean Validation gagal sebelum DB default bekerja.

Apakah itu benar?

Tergantung desain.

### 24.1 Application-owned timestamp

Jika application harus mengontrol timestamp:

```java
this.createdAt = clock.instant();
```

`@NotNull` benar.

### 24.2 Database-owned timestamp

Jika database yang mengontrol timestamp:

- jangan validasi `createdAt` sebelum insert,
- mapping harus mencerminkan generated value,
- entity mungkin membaca value setelah insert,
- test behavior provider/database.

Contoh Hibernate-specific pattern bisa memakai generated annotation, tetapi ini masuk provider-specific ORM mapping.

Prinsip:

> Jangan memberi `@NotNull` pada field yang memang sengaja diisi database setelah insert, kecuali mapping/lifecycle memastikan nilai sudah ada sebelum validation.

---

## 25. Bean Validation dan Generated IDs

Entity ID sering null sebelum persist.

```java
@Id
@GeneratedValue
private Long id;
```

Jangan beri:

```java
@NotNull
@Id
@GeneratedValue
private Long id;
```

Karena entity baru valid walaupun ID belum ada sebelum insert.

Jika perlu membedakan persisted entity dan new entity, jangan pakai `@NotNull` global pada ID. Gunakan model eksplisit:

```java
public boolean isPersisted() {
    return id != null;
}
```

Atau pakai domain ID object pada layer domain yang berbeda dari entity lifecycle.

---

## 26. Entity Constructor, Factory Method, dan Validation

Entity JPA membutuhkan no-arg constructor, biasanya `protected`.

```java
protected ApplicantEntity() {
    // for JPA
}
```

Gunakan factory method untuk membuat state valid:

```java
public static ApplicantEntity create(String rawName, String rawEmail, Instant now) {
    String name = normalizeName(rawName);
    String email = normalizeEmail(rawEmail);

    ApplicantEntity entity = new ApplicantEntity();
    entity.name = name;
    entity.email = email;
    entity.createdAt = now;
    return entity;
}
```

Jangan bergantung hanya pada Bean Validation saat flush untuk menemukan bug. Buat object valid sedini mungkin di domain/application boundary.

### 26.1 Fail early vs flush-time failure

Buruk:

```java
ApplicantEntity entity = new ApplicantEntity();
entity.setName(null);
repository.save(entity); // error muncul saat flush/commit
```

Lebih baik:

```java
ApplicantEntity entity = ApplicantEntity.create(name, email, now);
repository.save(entity);
```

Factory dapat throw domain exception lebih cepat dan lebih jelas.

---

## 27. Entity Setter dan Invariant Leakage

Jika entity punya public setter bebas:

```java
public void setStatus(CaseStatus status) {
    this.status = status;
}
```

Maka service mana pun bisa membuat invalid transition:

```java
caseFile.setStatus(CaseStatus.APPROVED);
```

Padahal approval butuh approver, reason, timestamp.

Lebih baik:

```java
public void approve(UserId approver, String reason, Instant now) {
    if (status != CaseStatus.SUBMITTED) {
        throw new InvalidTransitionException(status, CaseStatus.APPROVED);
    }
    if (reason == null || reason.isBlank()) {
        throw new MissingApprovalReasonException();
    }
    this.status = CaseStatus.APPROVED;
    this.approvedBy = approver.value();
    this.approvalReason = reason;
    this.approvedAt = now;
}
```

Bean Validation tidak bisa menyelamatkan entity dari semua setter buruk.

Entity API design adalah bagian dari validation architecture.

---

## 28. Enum Validation dan Database

Java enum:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Entity:

```java
@NotNull
@Enumerated(EnumType.STRING)
@Column(nullable = false, length = 30)
private CaseStatus status;
```

Database:

```sql
ALTER TABLE case_file ADD CONSTRAINT ck_case_status
CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));
```

### 28.1 Migration caveat

Saat menambahkan enum value baru:

```java
RETURNED_FOR_CLARIFICATION
```

Harus update:

- Java enum,
- database check constraint,
- API schema,
- frontend mapping,
- report query,
- workflow rule,
- audit message,
- tests.

Constraint drift pada enum adalah sumber bug production yang sering terjadi.

---

## 29. `BigDecimal`, Precision, Scale, dan Database

Bean Validation:

```java
@NotNull
@Digits(integer = 12, fraction = 2)
@PositiveOrZero
@Column(precision = 14, scale = 2, nullable = false)
private BigDecimal amount;
```

Database:

```sql
amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0)
```

Poin penting:

- `@Digits(integer=12, fraction=2)` mengatur digit integer/fraction.
- `@Column(precision=14, scale=2)` mengatur mapping/schema metadata.
- Database numeric precision/scale adalah final storage rule.
- Rounding harus eksplisit di application/domain, bukan dibiarkan diam-diam oleh database.

Buruk:

```java
this.amount = amount;
```

Lebih baik:

```java
this.amount = amount.setScale(2, RoundingMode.UNNECESSARY);
```

Atau jika business memang membulatkan:

```java
this.amount = amount.setScale(2, RoundingMode.HALF_UP);
```

Tetapi aturan rounding harus domain decision, bukan efek samping persistence.

---

## 30. Temporal Field: Application Clock vs Database Clock

Bean Validation temporal:

```java
@PastOrPresent
private Instant submittedAt;
```

Masalah:

- clock application bisa berbeda dari DB clock,
- timezone display berbeda,
- distributed service punya clock skew,
- testing butuh deterministic `Clock`,
- validation saat JVM dan DB now berbeda beberapa detik.

Untuk persistence critical timestamp, tentukan siapa pemilik waktu:

### 30.1 Application clock

```java
Clock clock;
Instant now = clock.instant();
entity.submit(now);
```

Keuntungan:

- testable,
- consistent dalam satu service,
- mudah dipakai domain event.

### 30.2 Database clock

```sql
submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

Keuntungan:

- authoritative di DB,
- semua writer mendapat clock sama.

Tapi mapping dan validation harus hati-hati.

Prinsip:

> Jangan campur application clock dan database clock tanpa keputusan eksplisit.

---

## 31. Multi-Tenant dan Jurisdiction-Specific Persistence Rules

Dalam sistem multi-tenant/regulatory, rule bisa berbeda per tenant/jurisdiction.

Contoh:

```text
Agency A: applicant reference max 20 chars
Agency B: applicant reference max 30 chars
```

Jangan langsung menaruh rule tenant-specific di entity global:

```java
@Size(max = 20)
private String applicantReference;
```

Karena entity dipakai semua tenant.

Alternatif:

1. Gunakan superset di database/entity:

```java
@Size(max = 30)
@Column(length = 30)
private String applicantReference;
```

2. Gunakan domain/application policy tenant-specific:

```java
policyRegistry.forTenant(tenantId)
        .validateApplicantReference(reference);
```

3. Jika DB per tenant berbeda, constraint DB bisa berbeda per schema.

4. Jika shared DB, simpan rule per tenant sebagai policy layer, bukan check constraint global kecuali bisa diekspresikan aman.

Prinsip:

> Entity/database global constraint harus mewakili invariant global, bukan policy lokal yang berubah-ubah.

---

## 32. Soft Delete dan Validation

Soft delete umum:

```java
@Column(nullable = false)
private boolean deleted;

private Instant deletedAt;
private String deletedBy;
```

Rule:

```text
Jika deleted = true, deletedAt dan deletedBy wajib ada.
```

Entity class-level constraint mungkin bisa:

```java
@ValidSoftDeleteState
@Entity
public class DocumentEntity {
    private boolean deleted;
    private Instant deletedAt;
    private String deletedBy;
}
```

Database check:

```sql
ALTER TABLE document ADD CONSTRAINT ck_document_soft_delete
CHECK (
    deleted = false
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
);
```

Domain method:

```java
public void softDelete(UserId actor, Instant now) {
    if (deleted) {
        return;
    }
    this.deleted = true;
    this.deletedBy = actor.value();
    this.deletedAt = now;
}
```

Ini contoh bagus kombinasi:

- domain method menjaga transition,
- entity constraint menjaga local consistency,
- DB check menjaga final state.

---

## 33. Delete Validation: PreRemove Bukan Tempat Utama Referential Integrity

Beberapa orang ingin melakukan:

```java
@PreRemove
void validateCanDelete() {
    if (!children.isEmpty()) {
        throw new IllegalStateException("Cannot delete");
    }
}
```

Masalah:

- lazy collection bisa memicu query,
- race condition tetap mungkin,
- children bisa berubah oleh transaksi lain,
- database FK tetap final authority.

Lebih baik:

- service/application cek delete policy,
- database FK menjaga referential integrity,
- gunakan soft delete jika audit/regulatory butuh history,
- map DB FK violation menjadi domain error.

```java
@Transactional
public void deleteCase(CaseId id) {
    if (caseRepository.hasOpenTasks(id)) {
        throw new CaseHasOpenTasksException(id);
    }

    try {
        caseRepository.deleteById(id.value());
    } catch (DataIntegrityViolationException ex) {
        if (isFkViolation(ex)) {
            throw new CaseStillReferencedException(id, ex);
        }
        throw ex;
    }
}
```

---

## 34. Batch Import dan Persistence Validation

Batch import punya tantangan khusus:

- ribuan/jutaan row,
- partial success,
- invalid legacy data,
- duplicate dalam batch,
- duplicate dengan database existing,
- transaction chunking,
- memory pressure,
- error reporting per row.

Jangan mengandalkan entity validation saat flush sebagai satu-satunya validasi batch.

Lebih baik:

```text
1. Parse raw file
2. Validate syntactic shape per row
3. Normalize
4. Validate semantic per row
5. Validate cross-row within batch
6. Validate reference data in bulk
7. Persist in chunks
8. Catch DB constraint violations
9. Produce row-level error report
```

Contoh row error:

```json
{
  "row": 124,
  "field": "email",
  "code": "APPLICANT.EMAIL_DUPLICATED_IN_BATCH",
  "message": "Email appears more than once in the uploaded file."
}
```

DB unique constraint tetap diperlukan untuk duplicate dengan data existing/concurrent insert.

---

## 35. Validation dan Bulk Update/Delete

JPA bulk update:

```java
@Modifying
@Query("update ApplicantEntity a set a.status = :status where a.expired = true")
int markExpired(CaseStatus status);
```

Bulk JPQL/SQL operations dapat melewati entity lifecycle normal, dirty checking, dan Bean Validation per entity.

Konsekuensi:

- `@PreUpdate` tidak selalu dipanggil per entity,
- Bean Validation tidak menjamin berjalan per row,
- entity in persistence context bisa stale,
- database constraint menjadi semakin penting.

Jika bulk update bisa membuat data invalid, database constraint harus mencegahnya.

Untuk rule kompleks, gunakan:

- SQL `WHERE` aman,
- staging table,
- validation query sebelum update,
- transaction isolation/lock yang sesuai,
- post-update verification,
- database constraint.

---

## 36. Native SQL dan Bypass Validation

Native SQL:

```java
entityManager.createNativeQuery("update applicant set email = ? where id = ?")
        .setParameter(1, email)
        .setParameter(2, id)
        .executeUpdate();
```

Ini bisa bypass:

- entity setter,
- domain method,
- Bean Validation,
- lifecycle callback,
- dirty checking.

Maka database constraint adalah satu-satunya guard.

Jika native SQL dipakai, pastikan:

- SQL tidak melanggar invariant,
- constraint DB lengkap,
- integration test mencakup native path,
- persistence context di-clear/refresh jika perlu.

---

## 37. Validation dan Outbox/Event Publishing

Persistence sering terkait event:

```text
update aggregate
insert outbox event
commit transaction
publisher sends event
```

Validation harus memastikan:

- aggregate valid,
- outbox payload valid,
- event schema valid,
- transaction atomic.

Contoh:

```java
@Transactional
public void submit(ApplicationId id) {
    Application app = repository.get(id);
    submitPolicy.validateOrThrow(app);

    app.submit(clock.instant());

    repository.save(app);
    outbox.save(ApplicationSubmittedEvent.from(app));
}
```

Jangan publish event dari state yang belum DB-committed.

Database constraint yang gagal setelah event dibuat tetapi sebelum commit masih aman jika outbox dalam transaction sama. Kalau event dikirim langsung sebelum commit, sistem eksternal bisa menerima event untuk state yang ternyata gagal persisted.

---

## 38. Validation di Read Model dan Projection

Read model/projection sering tidak mengikuti invariant entity penuh.

Contoh projection:

```java
public record CaseSearchRow(
        Long id,
        String caseReferenceNo,
        String applicantName,
        String status
) {}
```

Jangan paksa Bean Validation entity rules ke projection.

Projection bisa:

- nullable karena left join,
- denormalized,
- partially populated,
- hasil aggregation,
- backward-compatible dengan data legacy.

Validation projection biasanya untuk output contract atau report quality, bukan persistence invariant.

---

## 39. Testing Persistence Validation

### 39.1 Unit test entity factory/method

```java
@Test
void approve_requiresSubmittedState() {
    CaseFileEntity caseFile = CaseFileEntity.newDraft(clock.instant());

    assertThrows(InvalidTransitionException.class,
            () -> caseFile.approve(new UserId("u1"), "ok", clock.instant()));
}
```

### 39.2 Validator test

```java
@Test
void entityConstraintRejectsBlankName() {
    Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    ApplicantEntity entity = new ApplicantEntity();
    entity.setName("");

    Set<ConstraintViolation<ApplicantEntity>> violations = validator.validate(entity);

    assertThat(violations)
            .anyMatch(v -> v.getPropertyPath().toString().equals("name"));
}
```

### 39.3 JPA integration test

```java
@Test
void persistRejectsInvalidEntityBeforeInsert() {
    ApplicantEntity entity = new ApplicantEntity();
    entity.setName("");

    assertThrows(ConstraintViolationException.class, () -> {
        entityManager.persist(entity);
        entityManager.flush();
    });
}
```

### 39.4 Database constraint test

```java
@Test
void databaseRejectsDuplicateEmail() {
    applicantRepository.saveAndFlush(ApplicantEntity.create("A", "a@example.com", now));

    ApplicantEntity duplicate = ApplicantEntity.create("B", "a@example.com", now);

    assertThrows(DataIntegrityViolationException.class, () -> {
        applicantRepository.saveAndFlush(duplicate);
    });
}
```

### 39.5 Schema drift test

Validasi bahwa length/entity/DB sama:

```text
@Size(max = 100)
@Column(length = 100)
DB VARCHAR(100)
OpenAPI maxLength: 100
Frontend max length: 100
```

Bisa dilakukan via:

- integration tests,
- schema introspection,
- generated OpenAPI diff,
- migration review checklist.

---

## 40. Performance Considerations

Persistence validation bisa mahal karena terjadi saat flush, sering dalam transaction.

Sumber biaya:

- entity graph traversal,
- cascaded validation,
- lazy association initialization,
- custom validator yang query DB,
- message interpolation,
- large collection validation,
- dirty entity count besar,
- batch import flush chunk besar.

Guideline:

- Hindari `@Valid` pada association besar.
- Jangan query DB dari `ConstraintValidator` entity.
- Gunakan chunking pada batch import.
- Flush secara eksplisit pada boundary yang diketahui.
- Validasi command sebelum membuka transaction jika memungkinkan.
- Tangani DB constraint violation tetap wajib.

---

## 41. Security Considerations

Persistence validation juga punya security implications.

### 41.1 Over-posting

Entity sebagai request body memungkinkan client mengisi:

- `id`,
- `status`,
- `createdBy`,
- `approvedBy`,
- `deleted`,
- relationship internal.

Solusi:

- DTO khusus request,
- mapping eksplisit,
- no public setter untuk field sensitif,
- domain method untuk transition.

### 41.2 PII leakage

Jangan log full invalid entity.

Buruk:

```java
log.warn("Invalid entity: {}", entity);
```

Karena `toString()` bisa berisi PII.

Lebih baik:

```java
log.warn("Persistence validation failed: entity={}, id={}, violations={}",
        entity.getClass().getSimpleName(),
        safeId(entity),
        safeViolationCodes(violations));
```

### 41.3 SQL error leakage

Jangan expose raw constraint/database error ke client.

Map ke stable domain error.

---

## 42. Observability untuk Persistence Validation

Metric yang berguna:

```text
validation.persistence.constraint_violation.count
validation.persistence.constraint_violation.by_entity
validation.persistence.constraint_violation.by_property
persistence.db_constraint_violation.count
persistence.db_constraint_violation.by_constraint_name
persistence.flush.failure.count
persistence.transaction.rollback.by_reason
```

Log fields aman:

- correlation id,
- request id,
- actor id hashed/safe,
- entity type,
- operation,
- constraint code,
- field path,
- DB constraint name,
- transaction boundary.

Hindari:

- raw PII,
- full entity dump,
- SQL with sensitive values,
- rejected value tanpa redaction.

---

## 43. Java 8 sampai Java 25 Notes

### Java 8

- Bean Validation 2.0 relevant.
- `javax.validation` umum.
- `Optional`, `java.time`, type-use constraints mulai penting.
- Entity banyak mutable class.

### Java 11

- Banyak enterprise Spring Boot 2/Jakarta EE 8 style masih `javax`.
- Migration planning penting.

### Java 17

- Baseline modern untuk Jakarta EE 11/Jakarta Validation 3.1 ecosystem.
- Records/sealed classes tersedia untuk DTO/domain modeling, tetapi JPA entity tetap umumnya class mutable/proxy-compatible.

### Java 21

- Virtual threads tidak mengubah prinsip persistence validation.
- Jangan blocking external call dari validator, meski virtual thread membuat blocking lebih murah secara thread cost.
- Transaction/connection tetap resource terbatas.

### Java 25

- Treat as modern long-horizon runtime.
- Gunakan modeling modern di boundary/command, tetapi tetap perhatikan ORM proxy/entity requirements.
- Validation architecture tetap layer-based: DTO, command, domain, entity, DB.

---

## 44. `javax.validation` vs `jakarta.validation` Persistence Migration

Saat migrasi legacy:

```java
import javax.validation.constraints.NotNull;
```

ke modern:

```java
import jakarta.validation.constraints.NotNull;
```

Jangan campur namespace.

### 44.1 Common mixed namespace failure

Entity memakai:

```java
import javax.validation.constraints.NotNull;
```

Tetapi runtime provider modern hanya melihat `jakarta.validation`.

Akibat:

- constraint tidak berjalan,
- atau dependency conflict,
- atau exception saat bootstrap,
- atau behavior berbeda antar module.

### 44.2 Migration checklist

- Semua import validation pindah konsisten.
- Dependency API/provider cocok.
- JPA/Jakarta Persistence version cocok.
- Hibernate ORM version cocok.
- Hibernate Validator version cocok.
- Spring Boot/Jakarta EE runtime cocok.
- Test persistence validation benar-benar trigger saat flush.
- Test DB constraints tetap berjalan.

---

## 45. Anti-Patterns

### 45.1 “Entity annotation is enough”

Salah karena database bisa ditulis dari jalur lain dan race condition tetap ada.

### 45.2 “Database constraint is enough”

Salah karena user experience buruk, error tidak structured, dan failure terlalu terlambat.

### 45.3 `@Valid` everywhere on JPA associations

Berbahaya untuk performance, lazy loading, legacy data, dan operation intent.

### 45.4 Entity sebagai request DTO

Membuka over-posting, coupling API-persistence, dan security issue.

### 45.5 DB query dalam `ConstraintValidator`

Menciptakan race condition, latency, transaction ambiguity, dan false confidence.

### 45.6 Semua workflow rule dimasukkan ke pre-update validation

Menyembunyikan domain rule dalam lifecycle teknis.

### 45.7 Menambahkan constraint entity tanpa scan legacy data

Bisa membuat update unrelated gagal karena existing data invalid.

### 45.8 Tidak memetakan DB constraint error

Client mendapat error raw, tidak stabil, dan tidak aman.

---

## 46. Production Design Checklist

Sebelum menambahkan persistence validation, tanyakan:

### Rule Placement

- Apakah rule ini request-specific?
- Apakah rule ini operation-specific?
- Apakah rule ini invariant persisted global?
- Apakah rule ini contextual business policy?
- Apakah rule ini harus dijaga database?

### Entity Design

- Apakah entity punya public setter yang bisa merusak invariant?
- Apakah constructor/factory menghasilkan state valid?
- Apakah JPA no-arg constructor tidak dipakai application secara bebas?
- Apakah entity constraint compatible dengan existing data?

### Cascade

- Apakah ada `@Valid` pada association besar?
- Apakah validation bisa memicu lazy loading?
- Apakah update kecil bisa gagal karena child lama invalid?

### Database

- Apakah ada NOT NULL/CHECK/UNIQUE/FK yang sesuai?
- Apakah constraint name bisa dipetakan ke error code?
- Apakah migration script sudah menangani existing data?

### Error Handling

- Apakah Bean Validation exception dimapping benar?
- Apakah DB constraint exception dimapping benar?
- Apakah raw SQL/vendor error tidak bocor?
- Apakah PII tidak muncul di log/error?

### Testing

- Ada unit test domain method?
- Ada validator test?
- Ada JPA flush test?
- Ada DB constraint test?
- Ada concurrency test untuk uniqueness?
- Ada schema drift check?

---

## 47. Mental Model Final

Persistence validation harus dipahami sebagai **lapisan pertahanan**, bukan satu-satunya pertahanan.

```text
DTO validation
  catches invalid external shape early

Command/application validation
  catches operation-specific input and context

Domain invariant
  prevents invalid object behavior

Entity Bean Validation
  catches invalid persistence object before SQL

Database constraint
  enforces final persisted truth

Exception mapping
  converts technical failure into stable domain/API error
```

Kalau rule hanya ada di DTO, data bisa rusak lewat batch/native path.

Kalau rule hanya ada di entity, race condition dan database bypass tetap bisa terjadi.

Kalau rule hanya ada di database, user experience dan error contract buruk.

Kalau workflow rule dipaksa ke entity lifecycle, sistem menjadi sulit dipahami.

Top-tier design bukan memilih satu layer. Top-tier design adalah **menempatkan rule di layer yang benar, lalu membuat failure-nya eksplisit, observable, testable, dan defensible**.

---

## 48. Ringkasan

Pada bagian ini kita mempelajari:

- persistence validation bukan final truth,
- Bean Validation bekerja pada object Java,
- database constraint bekerja pada persisted state,
- JPA lifecycle validation biasanya terjadi saat flush/pre-insert/pre-update,
- entity bisa invalid sementara dalam transaction,
- auto-flush bisa membuat invalid temporary state meledak,
- DTO constraint, entity constraint, domain policy, dan DB constraint berbeda tanggung jawab,
- `@Column(nullable=false)` bukan pengganti `@NotNull` atau DB `NOT NULL`,
- `@Valid` pada JPA association besar sering berbahaya,
- lazy loading dapat dipicu oleh validation,
- uniqueness/reference validation harus tetap ditopang DB constraint,
- DB error harus dimapping ke stable domain/API error,
- bulk update/native SQL bisa bypass Bean Validation,
- legacy data perlu rollout strategy sebelum constraint diperketat,
- production validation perlu observability, test, dan governance.

---

## 49. Referensi

- Jakarta Validation 3.1 Specification — `https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html`
- Jakarta Validation 3.1 — `https://jakarta.ee/specifications/bean-validation/3.1/`
- Bean Validation 2.0 Specification — `https://beanvalidation.org/2.0/spec/`
- Hibernate Validator Reference Guide — `https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/`
- Hibernate Validator 8.0 Reference Guide — `https://docs.hibernate.org/validator/8.0/reference/en-US/html_single/`
- Hibernate ORM User Guide — `https://docs.hibernate.org/stable/orm/userguide/html_single/`
- Jakarta Persistence Specification — `https://jakarta.ee/specifications/persistence/`
- Jakarta Persistence API `@PreUpdate` — `https://jakarta.ee/specifications/persistence/4.0/apidocs/jakarta.persistence/jakarta/persistence/preupdate`

---

# Status Seri

Seri **belum selesai**.

Bagian yang sudah selesai:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`
- Part 002 — Core API Mental Model: `ValidatorFactory`, `Validator`, `ConstraintViolation`, Metadata
- Part 003 — Built-in Constraints Deep Dive: Semantics, Edge Cases, and Misuse
- Part 004 — Nullability Strategy: `@NotNull`, Optional, Defaults, and Domain Absence
- Part 005 — Cascaded Validation: `@Valid`, Object Graphs, Aggregates, and Boundary Control
- Part 006 — Container Element Constraints: Lists, Maps, Optional, Custom Containers
- Part 007 — Validation Groups: Operation-Specific Contracts without DTO Explosion
- Part 008 — Group Sequence and Dynamic Group Sequence: Ordered Validation and Short-Circuiting
- Part 009 — Custom Constraint Design: Annotation, Validator, Message, Target, Repeatable
- Part 010 — Class-Level and Cross-Field Validation: Consistency inside One Object
- Part 011 — Cross-Parameter and Executable Validation: Methods, Constructors, Return Values
- Part 012 — Records, Immutability, Builders, Lombok, and Modern Java Modeling
- Part 013 — Message Interpolation: i18n, EL, Security, and Error Message Governance
- Part 014 — Payload, Severity, Error Codes, and Machine-Readable Violations
- Part 015 — Programmatic Constraint Mapping and Runtime Metadata
- Part 016 — Constraint Composition: Reusable Higher-Level Constraints
- Part 017 — Hibernate Validator Extensions: Beyond the Specification
- Part 018 — Dependency Injection in Validators: CDI, Spring, Jakarta EE, and Testability
- Part 019 — Validation in REST APIs: JAX-RS, Spring MVC, Error Mapping, and Problem Details
- Part 020 — Validation in Persistence: JPA Lifecycle, Hibernate ORM, Database Constraints

Bagian berikutnya:

- Part 021 — Validation in Event-Driven and Async Systems

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-019](./learn-java-validation-jakarta-hibernate-validator-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-021](./learn-java-validation-jakarta-hibernate-validator-part-021.md)
