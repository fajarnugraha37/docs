# Part 021 — Auditing, Temporal Data, Soft Delete, and Historical Correctness

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-021.md`  
> Scope Java: 8 hingga 25  
> Scope API: `javax.persistence` JPA 2.x, `jakarta.persistence` 3.x, Hibernate ORM 5/6/7, Spring Data JPA, Jakarta Transactions, Spring Transaction

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu memahami dan merancang **historical correctness** dalam persistence layer. Maksudnya bukan hanya “mencatat created date dan updated date”, tetapi mampu menjawab pertanyaan penting seperti:

1. Apa state data saat ini?
2. Siapa mengubah data?
3. Kapan perubahan terjadi?
4. Apa nilai sebelum dan sesudah perubahan?
5. Mengapa perubahan dilakukan?
6. Dalam konteks request/use case apa perubahan terjadi?
7. Apakah perubahan itu bagian dari transaksi yang valid?
8. Apakah histori ini cukup kuat untuk debugging, audit internal, regulatory review, dispute handling, dan forensic analysis?

Materi ini membahas:

- audit metadata,
- entity lifecycle callback,
- entity listener,
- Spring Data auditing,
- Hibernate Envers,
- manual audit trail,
- temporal data,
- soft delete,
- historical query,
- audit vs event log,
- audit vs outbox,
- audit vs versioning,
- correlation id,
- regulatory defensibility,
- failure mode produksi.

Bagian ini penting karena banyak sistem enterprise tampak “benar” saat hanya melihat row terbaru, tetapi gagal ketika harus menjelaskan **bagaimana data sampai ke kondisi itu**.

---

## 2. Mental Model: Current State vs History vs Evidence

Persistence biasa menjawab:

```text
What is the current state?
```

Audit dan temporal persistence menjawab:

```text
How did this state happen?
What changed?
Who changed it?
When did it change?
Why was it changed?
Can we prove it?
Can we reconstruct past state?
Can we defend this decision?
```

Untuk sistem CRUD sederhana, `updated_at` mungkin cukup. Untuk sistem case management, licensing, compliance, financial, enforcement, workflow approval, dan regulatory decisioning, itu tidak cukup.

Kita perlu membedakan beberapa konsep:

| Konsep | Pertanyaan yang Dijawab | Contoh |
|---|---|---|
| Current state | Data sekarang apa? | application.status = APPROVED |
| Audit metadata | Siapa/kapan membuat/mengubah? | updated_by, updated_at |
| Change audit | Field apa berubah dari apa ke apa? | status DRAFT → SUBMITTED |
| Temporal validity | Data ini berlaku kapan sampai kapan? | licence valid 2026-01-01 sampai 2026-12-31 |
| Revision history | Versi keberapa data ini? | revision 17 |
| Event log | Peristiwa domain apa terjadi? | ApplicationSubmitted |
| Outbox event | Event apa harus dikirim ke sistem lain? | publish APPLICATION_APPROVED |
| Version locking | Token concurrency apa? | version = 42 |
| Soft delete | Row dihapus secara logical? | deleted = true |
| Legal evidence | Bukti defensible? | actor, reason, request id, before/after, immutable trail |

Kesalahan umum: mencampur semuanya ke satu kolom `version`, atau mengira audit trail sama dengan domain event.

---

## 3. Empat Jenis “History” dalam Sistem Persistence

### 3.1 Audit Metadata

Audit metadata adalah metadata sederhana pada row utama:

```text
created_at
created_by
updated_at
updated_by
```

Kadang ditambah:

```text
created_from_ip
updated_from_ip
created_request_id
updated_request_id
```

Audit metadata berguna untuk observability dasar, tetapi tidak menjawab perubahan detail.

Contoh:

```java
@MappedSuperclass
public abstract class AuditableEntity {

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, updatable = false, length = 100)
    private String createdBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false, length = 100)
    private String updatedBy;

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
        this.createdBy = CurrentActor.getRequiredActorId();
        this.updatedBy = CurrentActor.getRequiredActorId();
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = Instant.now();
        this.updatedBy = CurrentActor.getRequiredActorId();
    }
}
```

Catatan penting:

- `@PreUpdate` hanya dipanggil jika provider mendeteksi update.
- Kalau entity tidak dirty, `updated_at` tidak berubah.
- Bulk update JPQL/native SQL biasanya melewati entity lifecycle callback.
- Entity listener harus hati-hati terhadap dependency injection dan thread context.

Jakarta Persistence menyediakan lifecycle callback seperti `@PrePersist`, `@PostPersist`, `@PreUpdate`, `@PostUpdate`, `@PreRemove`, `@PostRemove`, dan `@PostLoad`, serta listener class melalui `@EntityListeners`. Pada level API, entity listener dapat berisi callback untuk lifecycle event entity. Referensi resmi Jakarta Persistence menjelaskan bahwa listener dapat merespons callback seperti `PostLoad`, `PrePersist`, `PostPersist`, `PreRemove`, `PostRemove`, `PreUpdate`, dan `PostUpdate`. Lihat referensi resmi Jakarta Persistence/EntityListeners.  
Reference: Jakarta Persistence EntityListeners API: https://jakarta.ee/specifications/persistence/4.0/apidocs/jakarta.persistence/jakarta/persistence/entitylisteners

### 3.2 Change Audit / Audit Trail

Change audit mencatat detail perubahan:

```text
entity_type
entity_id
field_name
old_value
new_value
changed_by
changed_at
reason
request_id
transaction_id
```

Contoh audit row:

| entity_type | entity_id | field | old | new | actor | reason |
|---|---:|---|---|---|---|---|
| APPLICATION | 1001 | status | DRAFT | SUBMITTED | officer-17 | applicant submitted |
| APPLICATION | 1001 | assigned_officer | null | officer-21 | supervisor-3 | workload balancing |

Audit trail berguna untuk:

- debugging,
- regulatory review,
- internal control,
- dispute resolution,
- reconstructing decision history,
- security forensic.

Tetapi audit trail tidak selalu cocok sebagai event integration mechanism.

### 3.3 Temporal Data

Temporal data menjawab:

```text
What was valid at a particular business time?
```

Contoh:

```text
licence_number = L-001
status = ACTIVE
valid_from = 2026-01-01
valid_to = 2026-12-31
```

Temporal data bukan hanya audit. Audit mencatat perubahan. Temporal table/model mencatat **validity interval**.

Ada dua waktu yang perlu dibedakan:

| Waktu | Makna |
|---|---|
| Transaction time | Kapan database/system mengetahui perubahan |
| Valid time | Kapan fakta bisnis berlaku |

Contoh:

- Officer memasukkan data pada 2026-03-10.
- Tetapi licence berlaku sejak 2026-01-01.

Maka:

```text
transaction_time = 2026-03-10
valid_from = 2026-01-01
```

Jika kamu mencampur dua hal ini, historical query akan keliru.

### 3.4 Event Log / Domain Event

Domain event mencatat sesuatu yang bermakna di domain:

```text
ApplicationSubmitted
ApplicationApproved
CaseEscalated
LicenceSuspended
PaymentReceived
```

Event bukan sekadar “field berubah”. Event menyatakan **sesuatu terjadi** dalam bahasa bisnis.

Perbedaan penting:

| Audit Trail | Domain Event |
|---|---|
| Berorientasi bukti perubahan | Berorientasi fakta bisnis |
| Bisa field-level | Biasanya use-case/domain-level |
| Untuk audit/debugging | Untuk state propagation, workflow, notification, integration |
| Sangat detail | Semantik tinggi |
| Tidak selalu dikonsumsi service lain | Sering dipublish sebagai event |

Contoh:

Audit trail:

```json
{
  "entity": "Application",
  "id": "1001",
  "field": "status",
  "old": "DRAFT",
  "new": "SUBMITTED"
}
```

Domain event:

```json
{
  "eventType": "ApplicationSubmitted",
  "applicationId": "1001",
  "submittedBy": "applicant-88",
  "submittedAt": "2026-06-16T09:00:00Z"
}
```

Keduanya berguna, tetapi tidak sama.

---

## 4. Why Historical Correctness Matters

Historical correctness penting karena row terbaru sering tidak cukup untuk menjawab pertanyaan bisnis.

Contoh case management:

```text
Application 1001 sekarang REJECTED.
```

Pertanyaan berikutnya:

1. Siapa submit?
2. Kapan submit?
3. Siapa review?
4. Dokumen apa yang tersedia saat keputusan dibuat?
5. Rule apa yang dipakai?
6. Apakah decision maker punya authority saat itu?
7. Apakah applicant pernah mengubah data setelah review?
8. Apakah rejection reason berubah?
9. Apakah appeal diajukan sebelum deadline?
10. Apakah data yang dilihat officer sama dengan data sekarang?

Tanpa model historical correctness, sistem hanya bisa menjawab “status sekarang”. Itu tidak cukup untuk sistem enterprise yang harus bisa dipertanggungjawabkan.

---

## 5. Audit Metadata with `@MappedSuperclass`

Pattern umum:

```java
@MappedSuperclass
public abstract class BaseAuditableEntity {

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, updatable = false, length = 100)
    private String createdBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false, length = 100)
    private String updatedBy;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        String actor = AuditContext.currentActorId();

        this.createdAt = now;
        this.createdBy = actor;
        this.updatedAt = now;
        this.updatedBy = actor;
    }

    @PreUpdate
    void preUpdate() {
        this.updatedAt = Instant.now();
        this.updatedBy = AuditContext.currentActorId();
    }
}
```

### 5.1 Kenapa `@MappedSuperclass`?

Karena audit fields biasanya reusable tetapi tidak perlu table sendiri.

`@MappedSuperclass` membuat field-nya diwariskan sebagai mapping pada concrete entity table.

Contoh:

```java
@Entity
@Table(name = "application")
public class Application extends BaseAuditableEntity {

    @Id
    private Long id;

    @Column(name = "reference_no", nullable = false, unique = true)
    private String referenceNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ApplicationStatus status;
}
```

Kolom table:

```sql
application(
  id,
  reference_no,
  status,
  created_at,
  created_by,
  updated_at,
  updated_by,
  version
)
```

### 5.2 Jangan Campur `@Version` dengan Business Revision

`@Version` adalah optimistic locking token, bukan business revision number.

Salah:

```text
version column dipakai sebagai nomor dokumen versi bisnis.
```

Masalah:

- version naik karena update teknis,
- retry bisa mengubah version,
- audit metadata update bisa menaikkan version,
- business user mengira version = revision dokumen.

Lebih benar:

```text
version             -> concurrency token
business_revision   -> revision bisnis/dokumen
```

---

## 6. Spring Data JPA Auditing

Jika menggunakan Spring Data JPA, kamu bisa memakai auditing support:

```java
@EntityListeners(AuditingEntityListener.class)
@MappedSuperclass
public abstract class SpringAuditableEntity {

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @CreatedBy
    @Column(name = "created_by", nullable = false, updatable = false)
    private String createdBy;

    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @LastModifiedBy
    @Column(name = "updated_by", nullable = false)
    private String updatedBy;
}
```

Konfigurasi:

```java
@Configuration
@EnableJpaAuditing(auditorAwareRef = "auditorProvider")
public class JpaAuditConfig {

    @Bean
    public AuditorAware<String> auditorProvider() {
        return () -> Optional.ofNullable(SecurityContextHolder.getContext())
                .map(SecurityContext::getAuthentication)
                .filter(Authentication::isAuthenticated)
                .map(Authentication::getName);
    }
}
```

Kelebihan:

- standardized di ekosistem Spring,
- mengurangi boilerplate,
- integrasi dengan security context,
- cocok untuk created/updated metadata.

Keterbatasan:

- tidak mencatat before/after field,
- tidak otomatis memberikan alasan perubahan,
- tidak cukup untuk full audit trail,
- tetap tidak menangani bulk update yang bypass entity lifecycle.

---

## 7. Entity Lifecycle Callback and Listener

Jakarta Persistence mendukung callback pada entity lifecycle.

Contoh callback di entity:

```java
@Entity
public class CaseRecord {

    @Id
    private Long id;

    @Column(name = "status", nullable = false)
    @Enumerated(EnumType.STRING)
    private CaseStatus status;

    @PrePersist
    void beforeInsert() {
        if (status == null) {
            status = CaseStatus.DRAFT;
        }
    }

    @PreUpdate
    void beforeUpdate() {
        // Lightweight local invariant only.
    }
}
```

Contoh listener class:

```java
@Entity
@EntityListeners(AuditMetadataListener.class)
public class Application {
    @Id
    private Long id;
}

public class AuditMetadataListener {

    @PrePersist
    public void prePersist(Object entity) {
        if (entity instanceof Auditable auditable) {
            Instant now = Instant.now();
            auditable.markCreated(now, AuditContext.currentActorId());
        }
    }

    @PreUpdate
    public void preUpdate(Object entity) {
        if (entity instanceof Auditable auditable) {
            auditable.markUpdated(Instant.now(), AuditContext.currentActorId());
        }
    }
}
```

### 7.1 Callback yang Umum

| Callback | Kapan Dipanggil | Use Case |
|---|---|---|
| `@PrePersist` | sebelum insert | set created metadata/default |
| `@PostPersist` | setelah insert | jarang untuk side effect; id sudah tersedia |
| `@PreUpdate` | sebelum update | set updated metadata |
| `@PostUpdate` | setelah update | logging lokal, tetapi hati-hati side effect |
| `@PreRemove` | sebelum delete | audit/delete guard ringan |
| `@PostRemove` | setelah delete | jarang dipakai |
| `@PostLoad` | setelah entity load | derived transient value, validation ringan |

### 7.2 Apa yang Tidak Boleh Dilakukan di Callback

Hindari:

```java
@PreUpdate
void preUpdate() {
    externalEmailClient.send(...);       // buruk
    paymentGateway.charge(...);          // buruk
    repository.save(otherEntity);        // risk re-entrant persistence
    auditRepository.save(...);           // risk lifecycle complexity
}
```

Kenapa?

- callback terjadi saat flush,
- flush bisa terjadi sebelum query, bukan hanya commit,
- transaction masih bisa rollback,
- external side effect tidak rollback,
- dependency injection di listener bisa rumit,
- bisa menyebabkan recursion atau unintended flush.

Gunakan callback untuk local metadata dan invariant ringan. Untuk side effect, gunakan domain event/outbox setelah state transition diputuskan di application service.

---

## 8. Audit Trail Design

### 8.1 Audit Trail Table Minimal

```sql
create table audit_trail (
    id                number generated by default as identity primary key,
    entity_type       varchar2(100) not null,
    entity_id         varchar2(100) not null,
    action            varchar2(50) not null,
    changed_at        timestamp not null,
    changed_by        varchar2(100) not null,
    request_id        varchar2(100),
    correlation_id    varchar2(100),
    reason_code       varchar2(100),
    reason_text       varchar2(1000),
    metadata_json     clob
);

create index idx_audit_trail_entity
    on audit_trail(entity_type, entity_id, changed_at);

create index idx_audit_trail_request
    on audit_trail(request_id);
```

### 8.2 Audit Field Change Table

```sql
create table audit_trail_change (
    id              number generated by default as identity primary key,
    audit_trail_id  number not null,
    field_name      varchar2(100) not null,
    old_value       clob,
    new_value       clob,
    constraint fk_audit_change_trail
        foreign key (audit_trail_id)
        references audit_trail(id)
);
```

Ini memisahkan:

- audit event header,
- detail perubahan field.

### 8.3 JSON Payload Alternative

```sql
create table audit_trail (
    id             bigint primary key,
    entity_type    varchar(100) not null,
    entity_id      varchar(100) not null,
    action         varchar(50) not null,
    changed_at     timestamp not null,
    changed_by     varchar(100) not null,
    request_id     varchar(100),
    changes_json   jsonb not null
);
```

Contoh `changes_json`:

```json
{
  "status": {
    "old": "DRAFT",
    "new": "SUBMITTED"
  },
  "submittedAt": {
    "old": null,
    "new": "2026-06-16T09:00:00Z"
  }
}
```

Kelebihan:

- fleksibel,
- mudah simpan banyak field,
- cocok untuk audit display.

Kekurangan:

- query field-level lebih sulit,
- index lebih vendor-specific,
- schema evolution payload perlu dijaga,
- data masking perlu disiplin.

### 8.4 Jangan Simpan Semua Secara Buta

Audit trail sering menjadi sumber kebocoran data.

Hindari menyimpan:

- password,
- token,
- secret,
- private key,
- full identity document jika tidak diperlukan,
- PII sensitif tanpa masking/encryption,
- payload request mentah yang berisi data berlebihan.

Untuk field sensitif:

```text
old_value = ***MASKED***
new_value = ***MASKED***
```

atau simpan hash/HMAC untuk verification tanpa mengekspos nilai.

---

## 9. Manual Audit Trail vs Hibernate Envers

### 9.1 Hibernate Envers

Hibernate Envers adalah extension Hibernate untuk entity auditing/versioning. Envers memungkinkan entity diaudit dengan annotation seperti `@Audited`, lalu Hibernate membuat table audit untuk menyimpan revision. Dokumentasi Hibernate menyebut Envers sebagai extension yang menyediakan cara menambahkan auditing/versioning untuk entity.  
Reference: Hibernate Envers: https://hibernate.org/orm/envers/

Contoh:

```java
@Entity
@Audited
@Table(name = "application")
public class Application {

    @Id
    private Long id;

    @Column(name = "reference_no", nullable = false)
    private String referenceNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ApplicationStatus status;
}
```

Envers biasanya membuat table audit seperti:

```text
application_AUD
REVINFO
```

Kelebihan:

- cepat mengaktifkan audit entity,
- bisa query revision,
- cocok untuk reconstruct historical entity state,
- lebih sedikit kode manual.

Kekurangan:

- provider-specific Hibernate,
- schema audit bisa besar,
- tidak otomatis tahu “business reason”,
- tidak selalu cocok untuk regulatory narrative,
- field-level display kadang tetap perlu transformasi,
- audit semantics mengikuti entity changes, bukan use-case semantics,
- bulk update bisa bypass mekanisme entity-level tergantung cara update.

### 9.2 Manual Audit Trail

Manual audit berarti application service secara eksplisit mencatat perubahan bermakna.

Contoh:

```java
@Transactional
public void submitApplication(SubmitApplicationCommand command) {
    Application application = applicationRepository.getForUpdate(command.applicationId());

    ApplicationStatus oldStatus = application.getStatus();

    application.submit(command.submittedBy(), command.submittedAt());

    auditTrailRepository.append(AuditTrailEntry.builder()
            .entityType("APPLICATION")
            .entityId(application.getId().toString())
            .action("SUBMIT")
            .changedBy(command.submittedBy())
            .changedAt(command.submittedAt())
            .reasonCode("APPLICANT_SUBMISSION")
            .requestId(command.requestId())
            .change("status", oldStatus.name(), application.getStatus().name())
            .build());
}
```

Kelebihan:

- jelas secara bisnis,
- bisa menyimpan reason,
- bisa mengontrol sensitive field,
- cocok untuk regulatory narrative,
- mudah menyertakan command/request/correlation id.

Kekurangan:

- perlu disiplin developer,
- raw field changes tidak otomatis,
- bisa lupa audit di flow tertentu,
- perlu testing agar tidak ada path tanpa audit.

### 9.3 Decision Matrix

| Kebutuhan | Envers | Manual Audit |
|---|---:|---:|
| Cepat audit semua perubahan entity | Sangat cocok | Kurang praktis |
| Business reason wajib | Kurang | Sangat cocok |
| Field-level technical history | Cocok | Bisa, tapi manual |
| Regulatory narrative | Perlu tambahan | Cocok |
| Provider portability | Rendah | Tinggi |
| Fine-grained masking | Sedang | Tinggi |
| High control atas schema | Sedang | Tinggi |
| Developer discipline | Rendah-sedang | Tinggi |

Praktik enterprise sering memakai kombinasi:

```text
Envers/manual snapshot untuk reconstruct state
+
manual audit event untuk business narrative
+
outbox/domain event untuk integration
```

---

## 10. Temporal Data Modeling

Temporal data menyimpan periode validity.

### 10.1 Effective-Dated Table

```sql
create table licence_status_history (
    id             bigint primary key,
    licence_id     bigint not null,
    status         varchar(30) not null,
    valid_from     timestamp not null,
    valid_to       timestamp,
    changed_at     timestamp not null,
    changed_by     varchar(100) not null,
    reason         varchar(500)
);

create index idx_licence_status_current
    on licence_status_history(licence_id, valid_to);
```

Current row:

```text
valid_to is null
```

Past row:

```text
valid_to is not null
```

### 10.2 Query Current State

```sql
select *
from licence_status_history
where licence_id = ?
  and valid_to is null;
```

### 10.3 Query State at Business Time

```sql
select *
from licence_status_history
where licence_id = ?
  and valid_from <= ?
  and (valid_to is null or valid_to > ?);
```

### 10.4 Temporal Invariant

Untuk satu entity, validity interval tidak boleh overlap.

Secara logis:

```text
For the same licence_id, there must not be two rows whose validity intervals overlap.
```

Di PostgreSQL, ini bisa ditangani dengan exclusion constraint. Di database lain, bisa perlu trigger, locking, atau application-level plus transaction isolation/constraint.

### 10.5 Bitemporal Model

Bitemporal model menyimpan dua waktu:

```text
valid time       -> kapan fakta berlaku di dunia bisnis
transaction time -> kapan sistem mengetahui/mencatat fakta
```

Contoh table:

```sql
create table licence_status_bitemporal (
    id                    bigint primary key,
    licence_id            bigint not null,
    status                varchar(30) not null,

    valid_from            timestamp not null,
    valid_to              timestamp,

    recorded_from         timestamp not null,
    recorded_to           timestamp,

    recorded_by           varchar(100) not null,
    reason                varchar(500)
);
```

Bitemporal berguna ketika:

- data bisa backdated,
- correction bisa terjadi setelah fakta berlaku,
- audit perlu tahu apa yang sistem percaya pada waktu tertentu,
- regulatory reconstruction membutuhkan “as known at time X”.

Contoh pertanyaan:

```text
Apa status licence yang valid pada 2026-01-15,
berdasarkan data yang diketahui sistem pada 2026-02-01?
```

Ini tidak bisa dijawab oleh simple `updated_at`.

---

## 11. Soft Delete

Soft delete berarti delete secara logical, bukan physical.

Contoh:

```text
deleted = true
deleted_at = 2026-06-16T09:00:00Z
deleted_by = officer-17
delete_reason = DUPLICATE_ENTRY
```

### 11.1 Manual Soft Delete Mapping

```java
@Entity
@Table(name = "document")
public class Document {

    @Id
    private Long id;

    @Column(name = "file_name", nullable = false)
    private String fileName;

    @Column(name = "deleted", nullable = false)
    private boolean deleted;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "deleted_by")
    private String deletedBy;

    public void softDelete(String actor, Instant now) {
        if (this.deleted) {
            return;
        }
        this.deleted = true;
        this.deletedAt = now;
        this.deletedBy = actor;
    }
}
```

Repository query harus eksplisit:

```java
@Query("""
    select d
    from Document d
    where d.caseId = :caseId
      and d.deleted = false
    order by d.createdAt desc
""")
List<Document> findActiveByCaseId(Long caseId);
```

### 11.2 Hibernate `@SoftDelete`

Hibernate 6.4 memperkenalkan dukungan soft delete melalui annotation `@SoftDelete`. Javadoc Hibernate menjelaskan bahwa soft delete menangani “deletion” dari database table dengan mengubah indicator column untuk menandai deletion.  
Reference: Hibernate `@SoftDelete` Javadoc: https://docs.hibernate.org/orm/6.4/javadocs/org/hibernate/annotations/SoftDelete.html

Contoh konseptual:

```java
@Entity
@SoftDelete
public class Document {
    @Id
    private Long id;

    private String fileName;
}
```

Tetapi penggunaan provider-specific feature harus diputuskan dengan hati-hati:

- apakah semua query otomatis filter deleted?
- bagaimana native query?
- bagaimana unique constraint?
- bagaimana reporting query?
- bagaimana audit delete reason?
- bagaimana restore?
- bagaimana relationship/cascade?
- bagaimana migration dari existing soft delete?

### 11.3 Soft Delete Bukan Audit

Soft delete hanya menyatakan row tidak aktif/deleted.

Ia tidak otomatis menjawab:

- field apa berubah sebelum delete,
- siapa melihat data sebelum delete,
- kenapa delete dilakukan,
- apakah delete disetujui,
- apakah delete bagian dari rollback/compensation.

Jadi soft delete perlu audit trail jika deletion adalah action penting.

### 11.4 Soft Delete dan Unique Constraint

Masalah umum:

```sql
unique(email)
```

Jika user lama soft-deleted, bolehkah email yang sama dipakai ulang?

Jika boleh, constraint biasa menghalangi.

Opsi:

#### PostgreSQL partial unique index

```sql
create unique index uk_user_email_active
on app_user(email)
where deleted = false;
```

#### Composite unique dengan deleted marker

```sql
unique(email, deleted)
```

Ini sering tidak cukup jika banyak deleted row dengan email sama.

#### Deleted token

```text
email = original_email
deleted_token = unique id for deleted row
unique(email, active_flag)
```

#### Separate active table/history table

```text
app_user_active
app_user_history
```

Untuk domain penting, lebih baik desain eksplisit daripada mengandalkan boolean `deleted` tanpa constraint plan.

### 11.5 Soft Delete dan Foreign Key

Jika parent soft-deleted, child bagaimana?

Opsi:

1. Child tetap ada dan ikut tidak terlihat.
2. Child juga soft-deleted cascade manual.
3. Parent tidak boleh dihapus jika child aktif.
4. Parent diarsipkan ke table lain.

Jangan menganggap database `ON DELETE CASCADE` akan membantu soft delete. Soft delete adalah update, bukan physical delete.

### 11.6 Soft Delete dan Query Correctness

Masalah paling sering:

```java
select count(*) from Document d where d.caseId = :caseId
```

Lupa:

```text
and d.deleted = false
```

Akibat:

- count salah,
- search result salah,
- report salah,
- authorization salah,
- duplicate check salah,
- workflow decision salah.

Karena itu soft delete harus memiliki query policy yang konsisten.

---

## 12. Audit vs Soft Delete vs Archive

Ketiganya sering tertukar.

| Konsep | Makna | Data Tetap di Table Utama? | Query Default |
|---|---|---:|---|
| Soft delete | Row logical deleted | Ya | Biasanya disembunyikan |
| Archive | Row dipindah/ditandai cold | Bisa tidak | Biasanya dipisah |
| Audit | Catatan perubahan | Terpisah | Query histori |

Soft delete bukan archive. Archive bukan audit. Audit bukan replacement untuk current table.

### 12.1 Kapan Soft Delete Cocok?

Cocok jika:

- user perlu restore,
- delete sebenarnya “deactivate”,
- row masih dibutuhkan untuk FK/history,
- regulatory retention melarang physical delete langsung,
- data masih relevan untuk audit.

Tidak cocok jika:

- table sangat besar dan semua query menjadi berat,
- data sensitif harus benar-benar dihapus/anonymized,
- domain butuh immutable history table,
- unique constraint menjadi rumit,
- delete berarti legal erasure.

---

## 13. Audit and Transaction Boundary

Audit yang benar harus berada dalam transaction boundary yang sama dengan perubahan state, kecuali ada alasan kuat sebaliknya.

### 13.1 Atomic Audit

```java
@Transactional
public void approve(ApproveCommand command) {
    Application app = applicationRepository.get(command.applicationId());

    ApplicationStatus oldStatus = app.getStatus();
    app.approve(command.officerId(), command.reason());

    auditTrailRepository.append(AuditTrailEntry.approval(
            app.getId(),
            oldStatus,
            app.getStatus(),
            command.officerId(),
            command.reason(),
            command.requestId()
    ));
}
```

Jika app update rollback, audit rollback juga.

Ini menjaga:

```text
Tidak ada audit tanpa perubahan.
Tidak ada perubahan tanpa audit.
```

### 13.2 Audit Outside Transaction?

Kadang security audit perlu tetap tercatat walau transaksi bisnis gagal.

Contoh:

```text
login failed
unauthorized access attempt
validation failure for suspicious payload
```

Ini bukan audit perubahan entity, melainkan security/event audit. Ia bisa disimpan di sistem logging/event pipeline terpisah.

Jangan campur:

```text
business entity audit harus atomic dengan perubahan entity
security/access audit boleh independent
```

---

## 14. Audit and Outbox Pattern

Jika perubahan state harus dipublish ke sistem lain, jangan mengandalkan audit trail sebagai message queue sembarangan.

Lebih baik:

```text
same transaction:
  update business table
  insert audit trail
  insert outbox event

async publisher:
  read outbox
  publish to broker
  mark published
```

Contoh:

```java
@Transactional
public void approve(ApproveCommand command) {
    Application app = applicationRepository.get(command.applicationId());
    app.approve(command.officerId(), command.reason());

    auditTrailRepository.append(AuditTrailEntry.approved(app, command));

    outboxRepository.append(OutboxEvent.of(
            "ApplicationApproved",
            app.getId().toString(),
            Map.of("applicationId", app.getId(), "approvedBy", command.officerId())
    ));
}
```

Audit dan outbox berbeda:

| Audit | Outbox |
|---|---|
| Untuk manusia/system review | Untuk integration delivery |
| Bisa field-level | Event-level |
| Tidak harus semua dipublish | Harus diproses publisher |
| Retention panjang | Retention sesuai delivery/replay policy |
| Sensitive data bisa masked | Payload harus consumer-safe |

---

## 15. Audit and Domain Events

Domain event bisa menjadi sumber audit, tetapi hati-hati.

Jika domain event hanya dibuat setelah state transition valid:

```java
public void submit(String actor, Instant now) {
    if (status != DRAFT) {
        throw new InvalidStateTransitionException();
    }
    this.status = SUBMITTED;
    this.submittedAt = now;
    this.submittedBy = actor;

    registerEvent(new ApplicationSubmitted(this.id, actor, now));
}
```

Application service dapat:

```java
@Transactional
public void submit(SubmitCommand command) {
    Application app = repository.get(command.applicationId());
    app.submit(command.actor(), clock.instant());

    auditTrailRepository.appendFromDomainEvents(app.pullEvents(), command.requestId());
    outboxRepository.appendFromDomainEvents(app.pullEvents(), command.requestId());
}
```

Tapi jangan kehilangan data before/after jika audit membutuhkannya.

Event:

```text
ApplicationSubmitted
```

Audit mungkin perlu:

```text
status DRAFT -> SUBMITTED
submitted_at null -> now
submitted_by null -> actor
```

---

## 16. Field-Level Audit: Snapshot vs Diff

Ada dua pendekatan utama.

### 16.1 Snapshot Audit

Simpan seluruh snapshot entity pada setiap revision.

```json
{
  "id": 1001,
  "status": "SUBMITTED",
  "applicantName": "Alice",
  "submittedAt": "2026-06-16T09:00:00Z"
}
```

Kelebihan:

- mudah reconstruct state,
- query revision lebih sederhana,
- tidak perlu replay diff.

Kekurangan:

- storage besar,
- sensitive data banyak tersalin,
- schema evolution payload lebih rumit.

### 16.2 Diff Audit

Simpan hanya perubahan.

```json
{
  "status": {"old": "DRAFT", "new": "SUBMITTED"},
  "submittedAt": {"old": null, "new": "2026-06-16T09:00:00Z"}
}
```

Kelebihan:

- hemat storage,
- cocok untuk display perubahan,
- lebih mudah masking per field.

Kekurangan:

- reconstruct state perlu replay,
- jika ada missed audit, history rusak,
- field rename/schema evolution perlu mapping.

### 16.3 Hybrid

Untuk sistem besar:

```text
business audit: event/diff yang mudah dibaca
revision snapshot: periodik atau per major transition
current table: state terbaru
```

---

## 17. Audit Context Design

Audit perlu context.

Minimal:

```text
actor_id
actor_type
request_id
correlation_id
source_channel
ip_address
user_agent
tenant_id
reason_code
reason_text
```

Contoh context holder:

```java
public record AuditContextData(
        String actorId,
        String actorType,
        String requestId,
        String correlationId,
        String tenantId,
        String sourceChannel,
        String ipAddress
) {}
```

ThreadLocal implementation sederhana:

```java
public final class AuditContext {

    private static final ThreadLocal<AuditContextData> CURRENT = new ThreadLocal<>();

    private AuditContext() {}

    public static void set(AuditContextData data) {
        CURRENT.set(Objects.requireNonNull(data));
    }

    public static AuditContextData getRequired() {
        AuditContextData data = CURRENT.get();
        if (data == null) {
            throw new IllegalStateException("Audit context is missing");
        }
        return data;
    }

    public static String currentActorId() {
        return getRequired().actorId();
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Filter:

```java
public class AuditContextFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        try {
            AuditContext.set(new AuditContextData(
                    resolveActorId(),
                    resolveActorType(),
                    request.getHeader("X-Request-Id"),
                    request.getHeader("X-Correlation-Id"),
                    resolveTenantId(),
                    "WEB",
                    request.getRemoteAddr()
            ));
            filterChain.doFilter(request, response);
        } finally {
            AuditContext.clear();
        }
    }
}
```

### 17.1 Caution with ThreadLocal

ThreadLocal bisa bermasalah dengan:

- async execution,
- scheduler,
- message listener,
- virtual threads jika context propagation tidak jelas,
- thread pool reuse jika lupa clear,
- tests yang tidak reset context.

Untuk async/message processing, pass context explicit lewat command/message envelope.

---

## 18. Temporal Query Patterns

### 18.1 Current View

Untuk table history, sering dibuat view current:

```sql
create view current_licence_status as
select *
from licence_status_history
where valid_to is null;
```

Mapping read-only entity:

```java
@Entity
@Table(name = "current_licence_status")
@Immutable
public class CurrentLicenceStatusView {
    @Id
    private Long id;

    private Long licenceId;

    @Enumerated(EnumType.STRING)
    private LicenceStatus status;
}
```

`@Immutable` adalah Hibernate-specific. Alternatif portable: jangan expose save/update repository untuk view entity.

### 18.2 As-Of Query

```java
@Query("""
    select h
    from LicenceStatusHistory h
    where h.licenceId = :licenceId
      and h.validFrom <= :asOf
      and (h.validTo is null or h.validTo > :asOf)
""")
Optional<LicenceStatusHistory> findStatusAsOf(
        Long licenceId,
        Instant asOf
);
```

### 18.3 Timeline Query

```java
@Query("""
    select h
    from LicenceStatusHistory h
    where h.licenceId = :licenceId
    order by h.validFrom asc
""")
List<LicenceStatusHistory> findTimeline(Long licenceId);
```

### 18.4 Avoid Updating Historical Rows Casually

Historical rows sebaiknya immutable setelah ditulis, kecuali untuk menutup interval `valid_to` saat transition berikutnya.

Pattern:

```text
current row valid_to = transition_time
insert new row valid_from = transition_time, valid_to = null
```

Dalam satu transaksi.

---

## 19. State Transition with History

Contoh workflow application:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED/REJECTED
```

Table current:

```sql
application(
  id,
  reference_no,
  status,
  version,
  created_at,
  updated_at
)
```

Table status history:

```sql
application_status_history(
  id,
  application_id,
  from_status,
  to_status,
  changed_at,
  changed_by,
  reason_code,
  reason_text,
  request_id
)
```

Application service:

```java
@Transactional
public void approve(ApproveApplicationCommand command) {
    Application app = applicationRepository.findByIdForUpdate(command.applicationId())
            .orElseThrow(ApplicationNotFoundException::new);

    ApplicationStatus from = app.getStatus();
    app.approve(command.officerId(), command.reason());

    statusHistoryRepository.save(new ApplicationStatusHistory(
            app.getId(),
            from,
            app.getStatus(),
            command.officerId(),
            clock.instant(),
            command.reasonCode(),
            command.reasonText(),
            command.requestId()
    ));

    auditTrailRepository.append(AuditTrailEntry.statusTransition(
            "APPLICATION",
            app.getId().toString(),
            from.name(),
            app.getStatus().name(),
            command.officerId(),
            command.requestId()
    ));
}
```

Kenapa punya status history dan audit trail sekaligus?

- Status history adalah domain-specific timeline.
- Audit trail adalah generic evidence/change log.

Keduanya bisa overlap, tetapi tujuan berbeda.

---

## 20. Soft Delete and Audit Example

```java
@Transactional
public void removeDocument(RemoveDocumentCommand command) {
    Document document = documentRepository.findActiveById(command.documentId())
            .orElseThrow(DocumentNotFoundException::new);

    document.softDelete(command.actorId(), clock.instant(), command.reason());

    auditTrailRepository.append(AuditTrailEntry.builder()
            .entityType("DOCUMENT")
            .entityId(document.getId().toString())
            .action("SOFT_DELETE")
            .changedBy(command.actorId())
            .changedAt(clock.instant())
            .reasonCode(command.reasonCode())
            .reasonText(command.reasonText())
            .requestId(command.requestId())
            .change("deleted", "false", "true")
            .build());
}
```

Entity:

```java
public void softDelete(String actorId, Instant now, String reason) {
    if (deleted) {
        return;
    }

    if (!canBeDeleted()) {
        throw new InvalidDocumentDeletionException(id);
    }

    this.deleted = true;
    this.deletedAt = now;
    this.deletedBy = actorId;
    this.deleteReason = reason;
}
```

Repository:

```java
@Query("""
    select d
    from Document d
    where d.id = :id
      and d.deleted = false
""")
Optional<Document> findActiveById(Long id);
```

Important invariant:

```text
Semua use case normal harus memakai active query.
Audit/admin use case boleh query include deleted secara eksplisit.
```

---

## 21. Deletion, Retention, Legal Hold, and Erasure

Soft delete sering disalahgunakan untuk semua masalah deletion.

Dalam sistem nyata, deletion punya beberapa mode:

| Mode | Makna |
|---|---|
| deactivate | tidak aktif, bisa aktif lagi |
| soft delete | disembunyikan, masih ada |
| archive | dipindah ke cold storage/history |
| anonymize | identitas dihapus/dimasking |
| hard delete | row dihapus fisik |
| legal hold | tidak boleh dihapus karena investigasi/dispute |

Untuk data sensitif, retention policy harus jelas:

```text
Data boleh disimpan berapa lama?
Siapa boleh melihat deleted data?
Apa yang terjadi setelah retention period?
Apakah audit trail juga harus dimasking?
```

Soft delete tanpa retention policy hanya menumpuk data.

---

## 22. Historical Correctness and Authorization

Audit/history query juga harus authorized.

Contoh:

- user biasa boleh melihat current application miliknya,
- officer boleh melihat assigned case,
- supervisor boleh melihat team cases,
- auditor boleh melihat audit trail,
- admin teknis belum tentu boleh melihat PII.

Jangan expose audit trail mentah ke UI.

Gunakan projection:

```java
public record AuditTrailView(
        Instant changedAt,
        String action,
        String changedByDisplayName,
        String reason,
        List<FieldChangeView> changes
) {}
```

Masking:

```java
private String maskIfSensitive(String fieldName, String value) {
    if (Set.of("nric", "passportNo", "bankAccount").contains(fieldName)) {
        return "***MASKED***";
    }
    return value;
}
```

---

## 23. Database Trigger-Based Audit

Alternatif audit adalah database trigger.

Kelebihan:

- menangkap perubahan dari semua client,
- tidak bergantung pada aplikasi,
- sulit dilewati jika permission dikunci,
- cocok untuk critical table.

Kekurangan:

- business context sulit diperoleh,
- actor/request id harus dikirim ke session variable/context,
- logic tersembunyi di database,
- testing/versioning migration lebih kompleks,
- bisa memperlambat write,
- deployment coupling dengan DBA.

Pattern:

```text
application sets db session context:
  actor_id
  request_id
  correlation_id

trigger reads session context and writes audit table
```

Ini cocok jika:

- banyak aplikasi menulis ke DB yang sama,
- audit harus enforced di DB,
- compliance lebih penting daripada portability.

Tetapi untuk use-case semantic audit, application-level audit sering tetap dibutuhkan.

---

## 24. CDC-Based Audit and History

Change Data Capture dapat membaca database log dan mengirim perubahan ke Kafka/S3/search/index.

Kelebihan:

- tidak membebani application code,
- menangkap committed changes,
- cocok untuk replication, analytics, search, lakehouse.

Kekurangan:

- biasanya tidak punya business reason,
- raw DB changes tidak selalu domain events,
- schema evolution harus dikontrol,
- PII bisa bocor ke downstream,
- ordering dan replay perlu governance,
- deletion/tombstone semantics harus jelas.

CDC bagus untuk integration/analytics, tetapi tidak otomatis menggantikan audit trail yang defensible secara bisnis.

---

## 25. Production Failure Modes

### 25.1 Audit Missing Because Bulk Update Bypassed Entity Listener

Contoh:

```java
@Modifying
@Query("""
    update Application a
    set a.status = 'EXPIRED'
    where a.expiryDate < :today
""")
int expireApplications(LocalDate today);
```

Masalah:

- `@PreUpdate` tidak berjalan per entity,
- audit metadata mungkin tidak berubah,
- Envers/entity listener mungkin tidak mencatat expected audit,
- persistence context bisa stale.

Solusi:

- tulis audit batch secara eksplisit,
- gunakan staging table untuk affected ids,
- insert audit from select,
- buat batch job dengan chunked entity update jika audit per entity wajib,
- dokumentasikan bahwa operation bulk harus punya audit strategy.

### 25.2 Soft-Deleted Data Still Appears in Report

Penyebab:

- native SQL lupa `deleted = false`,
- materialized view tidak filter,
- query cache stale,
- search index belum invalidate,
- report memakai replica lama.

Solusi:

- centralize active predicate,
- use database view for active rows,
- test reporting queries,
- include deleted semantics in data contract,
- monitor mismatch.

### 25.3 Audit Contains Sensitive Data

Penyebab:

- request payload disimpan mentah,
- diff generator tidak punya sensitive field registry,
- JSON old/new menyimpan full document,
- audit trail diakses terlalu luas.

Solusi:

- masking strategy,
- encryption at rest,
- field allowlist,
- separate secure audit store,
- access control,
- retention policy.

### 25.4 Audit Written but Business Change Rolled Back

Penyebab:

- audit pakai `REQUIRES_NEW`,
- audit dikirim ke external log sebelum commit,
- callback melakukan side effect.

Solusi:

- entity change audit harus dalam transaction yang sama,
- gunakan after-commit hook hanya untuk side effect non-authoritative,
- gunakan outbox untuk reliable post-commit integration.

### 25.5 Current State and History Diverge

Penyebab:

- update current table tanpa history,
- history insert gagal tapi current update commit,
- manual DBA fix tanpa audit,
- bug retry double insert history,
- lack of unique/idempotency constraint.

Solusi:

- transaction atomicity,
- migration script with audit entries,
- database constraint,
- reconciliation job,
- immutable history append rules,
- admin correction workflow.

---

## 26. Performance Considerations

Audit/history bisa menjadi table terbesar di sistem.

Perhatikan:

- index by `(entity_type, entity_id, changed_at)`,
- partition by time jika volume besar,
- archive old audit ke cold storage,
- avoid indexing huge CLOB/JSON blindly,
- compress large historical payload,
- separate hot current table from cold history table,
- avoid loading audit entity graph accidentally,
- use projection for timeline UI,
- paginate audit trail,
- avoid unbounded “download all history”.

Contoh index:

```sql
create index idx_audit_entity_time
on audit_trail(entity_type, entity_id, changed_at desc);

create index idx_audit_actor_time
on audit_trail(changed_by, changed_at desc);

create index idx_audit_request
on audit_trail(request_id);
```

Untuk table sangat besar:

```text
partition by month/quarter/year
archive partition older than retention threshold
```

---

## 27. Testing Historical Correctness

Test bukan hanya “save berhasil”.

### 27.1 Audit Metadata Test

```java
@Test
void createShouldPopulateAuditMetadata() {
    withActor("officer-1", () -> {
        Application app = new Application("APP-001");
        repository.saveAndFlush(app);

        assertThat(app.getCreatedBy()).isEqualTo("officer-1");
        assertThat(app.getUpdatedBy()).isEqualTo("officer-1");
        assertThat(app.getCreatedAt()).isNotNull();
        assertThat(app.getUpdatedAt()).isNotNull();
    });
}
```

### 27.2 Audit Trail Atomicity Test

```java
@Test
void approveShouldCreateAuditInSameTransaction() {
    approveApplication(applicationId, "officer-1");

    List<AuditTrailEntry> trail = auditRepository.findByEntity("APPLICATION", applicationId);

    assertThat(trail).anySatisfy(entry -> {
        assertThat(entry.getAction()).isEqualTo("APPROVE");
        assertThat(entry.getChangedBy()).isEqualTo("officer-1");
    });
}
```

### 27.3 Rollback Test

```java
@Test
void failedApprovalShouldNotPersistBusinessAudit() {
    assertThatThrownBy(() -> approveWithFailure(applicationId))
            .isInstanceOf(RuntimeException.class);

    assertThat(applicationRepository.findById(applicationId).get().getStatus())
            .isEqualTo(ApplicationStatus.UNDER_REVIEW);

    assertThat(auditRepository.findByEntityAndAction(
            "APPLICATION", applicationId, "APPROVE"))
            .isEmpty();
}
```

### 27.4 Soft Delete Query Test

```java
@Test
void activeQueryShouldExcludeSoftDeletedDocuments() {
    Document doc = createDocument(caseId);
    documentService.removeDocument(doc.getId(), actor);

    assertThat(documentRepository.findActiveByCaseId(caseId))
            .extracting(Document::getId)
            .doesNotContain(doc.getId());

    assertThat(documentRepository.findIncludingDeleted(doc.getId()))
            .isPresent();
}
```

### 27.5 Temporal Query Test

```java
@Test
void shouldResolveStatusAsOfBusinessTime() {
    licenceStatusService.changeStatus(licenceId, ACTIVE, instant("2026-01-01T00:00:00Z"));
    licenceStatusService.changeStatus(licenceId, SUSPENDED, instant("2026-03-01T00:00:00Z"));

    assertThat(repository.findStatusAsOf(licenceId, instant("2026-02-01T00:00:00Z")))
            .hasValueSatisfying(row -> assertThat(row.getStatus()).isEqualTo(ACTIVE));

    assertThat(repository.findStatusAsOf(licenceId, instant("2026-04-01T00:00:00Z")))
            .hasValueSatisfying(row -> assertThat(row.getStatus()).isEqualTo(SUSPENDED));
}
```

---

## 28. Design Checklist

### 28.1 Audit Metadata Checklist

- [ ] Semua entity penting punya `created_at` dan `created_by`.
- [ ] Semua entity mutable punya `updated_at` dan `updated_by`.
- [ ] Timestamp memakai `Instant` atau strategi timezone yang jelas.
- [ ] Actor resolution jelas untuk web, scheduler, message consumer, batch.
- [ ] Bulk update punya strategi audit terpisah.
- [ ] Audit metadata tidak dianggap sebagai full audit trail.

### 28.2 Audit Trail Checklist

- [ ] Audit trail mencatat actor.
- [ ] Audit trail mencatat action.
- [ ] Audit trail mencatat changed_at.
- [ ] Audit trail mencatat request/correlation id.
- [ ] Audit trail mencatat reason untuk action penting.
- [ ] Sensitive field dimasking/di-encrypt.
- [ ] Audit trail atomic dengan business change.
- [ ] Audit query dipaginate.
- [ ] Audit table diindex sesuai access pattern.
- [ ] Audit retention policy jelas.

### 28.3 Temporal Data Checklist

- [ ] Valid time dibedakan dari transaction time.
- [ ] Current row bisa ditemukan deterministik.
- [ ] Interval tidak overlap.
- [ ] Correction/backdated change punya model jelas.
- [ ] As-of query diuji.
- [ ] History row tidak diupdate sembarangan.

### 28.4 Soft Delete Checklist

- [ ] Soft delete memang requirement, bukan kebiasaan.
- [ ] Query active konsisten.
- [ ] Native/reporting query aware `deleted`.
- [ ] Unique constraint dipikirkan.
- [ ] FK/relationship behavior jelas.
- [ ] Restore policy jelas.
- [ ] Retention/hard-delete/anonymization policy jelas.
- [ ] Deleted data authorization jelas.

### 28.5 Regulatory Defensibility Checklist

- [ ] Bisa menjawab siapa/kapan/apa/mengapa.
- [ ] Bisa reconstruct state saat decision dibuat.
- [ ] Bisa membuktikan user/role/authority saat action.
- [ ] Bisa trace request id/correlation id.
- [ ] Bisa membedakan technical correction vs business decision.
- [ ] Bisa menjelaskan data masking/retention.
- [ ] Bisa mendeteksi missing audit path.

---

## 29. Anti-Patterns

### 29.1 `updated_at` Dianggap Audit Trail

`updated_at` hanya metadata terakhir. Ia tidak menjelaskan apa yang berubah.

### 29.2 Audit Trail Disimpan dari Entity Callback yang Melakukan Banyak Hal

Callback terjadi saat flush. Flush bukan commit. Jangan menaruh side effect kompleks di sana.

### 29.3 Soft Delete Tanpa Query Policy

Jika setiap developer harus ingat `deleted = false`, pasti ada query yang lupa.

### 29.4 Semua Payload Request Disimpan Mentah

Ini bisa membuat audit trail menjadi tempat bocornya PII/secret.

### 29.5 Envers Dianggap Cukup untuk Regulatory Narrative

Envers bagus untuk revision history, tetapi business reason dan decision context sering tetap perlu manual audit.

### 29.6 Domain Event Dianggap Sama dengan Audit

Event menyatakan fakta bisnis. Audit menyatakan bukti perubahan dan context.

### 29.7 Physical Delete pada Data yang Masih Direferensikan Audit

Audit/history bisa kehilangan referensi jika data utama dihapus tanpa snapshot cukup.

### 29.8 History Table Tanpa Index

Audit timeline per entity akan lambat jika tidak ada index `(entity_type, entity_id, changed_at)`.

### 29.9 History Mutable Tanpa Governance

Jika audit/history bisa diedit bebas, audit tidak defensible.

### 29.10 No Backfill Audit for Migration

Migration data besar tanpa audit/correlation membuat histori terputus.

---

## 30. Practical Architecture Recommendation

Untuk sistem enterprise/case management, rekomendasi umum:

```text
1. Current state tables
   - application
   - case
   - licence
   - document

2. Audit metadata on current tables
   - created_at/by
   - updated_at/by
   - version

3. Domain-specific history tables
   - application_status_history
   - case_assignment_history
   - licence_status_history

4. Generic audit trail
   - audit_trail
   - audit_trail_change

5. Outbox table
   - outbox_event

6. Optional Envers/revision tables
   - for reconstructing entity revision when useful

7. Archive/cold storage
   - for long retention / analytics / compliance
```

Do not force one mechanism to solve all problems.

---

## 31. Scenario: Regulatory Case Management

### Requirement

Sistem harus mencatat lifecycle case:

```text
NEW -> TRIAGED -> ASSIGNED -> INVESTIGATING -> ESCALATED -> CLOSED
```

Harus bisa menjawab:

1. Siapa assigned case?
2. Kapan assigned?
3. Siapa mengubah priority?
4. Apa reason escalation?
5. Dokumen apa yang ada saat closure?
6. Apakah closure decision dibuat oleh officer yang authorized?
7. Apakah ada perubahan setelah closure?

### Design

Current table:

```sql
case_record(
  id,
  reference_no,
  status,
  priority,
  assigned_officer_id,
  version,
  created_at,
  created_by,
  updated_at,
  updated_by
)
```

Status history:

```sql
case_status_history(
  id,
  case_id,
  from_status,
  to_status,
  changed_at,
  changed_by,
  reason_code,
  reason_text,
  request_id
)
```

Assignment history:

```sql
case_assignment_history(
  id,
  case_id,
  from_officer_id,
  to_officer_id,
  assigned_at,
  assigned_by,
  reason_code,
  request_id
)
```

Audit trail:

```sql
audit_trail(
  id,
  entity_type,
  entity_id,
  action,
  changed_at,
  changed_by,
  request_id,
  correlation_id,
  reason_code,
  metadata_json
)
```

Outbox:

```sql
outbox_event(
  id,
  aggregate_type,
  aggregate_id,
  event_type,
  payload_json,
  created_at,
  published_at,
  status
)
```

Application service:

```java
@Transactional
public void escalate(EscalateCaseCommand command) {
    CaseRecord caseRecord = caseRepository.findById(command.caseId())
            .orElseThrow(CaseNotFoundException::new);

    CaseStatus fromStatus = caseRecord.getStatus();
    CasePriority oldPriority = caseRecord.getPriority();

    caseRecord.escalate(command.actorId(), command.reasonCode(), command.now());

    statusHistoryRepository.save(CaseStatusHistory.transition(
            caseRecord.getId(),
            fromStatus,
            caseRecord.getStatus(),
            command.actorId(),
            command.reasonCode(),
            command.reasonText(),
            command.requestId(),
            command.now()
    ));

    auditTrailRepository.append(AuditTrailEntry.builder()
            .entityType("CASE")
            .entityId(caseRecord.getId().toString())
            .action("ESCALATE")
            .changedBy(command.actorId())
            .changedAt(command.now())
            .requestId(command.requestId())
            .reasonCode(command.reasonCode())
            .reasonText(command.reasonText())
            .change("status", fromStatus.name(), caseRecord.getStatus().name())
            .change("priority", oldPriority.name(), caseRecord.getPriority().name())
            .build());

    outboxRepository.append(OutboxEvent.caseEscalated(
            caseRecord.getId(),
            command.actorId(),
            command.reasonCode(),
            command.requestId(),
            command.now()
    ));
}
```

Invariants:

```text
Case cannot be escalated after CLOSED.
Escalation must have reason.
Escalation must be audited.
Escalation event must be written to outbox atomically.
Only authorized actor can escalate.
```

---

## 32. Summary

Historical correctness adalah kemampuan sistem untuk menjelaskan dan membuktikan perubahan data dari waktu ke waktu.

Poin utama:

1. `created_at` dan `updated_at` bukan full audit trail.
2. `@Version` adalah concurrency token, bukan audit revision.
3. Audit trail, domain event, outbox event, temporal history, dan soft delete punya tujuan berbeda.
4. Entity lifecycle callback cocok untuk metadata ringan, bukan side effect kompleks.
5. Hibernate Envers berguna untuk revision history, tetapi business audit sering tetap perlu manual design.
6. Soft delete harus disertai query policy, constraint policy, retention policy, dan authorization policy.
7. Temporal data harus membedakan valid time dan transaction time.
8. Audit entity change sebaiknya atomic dengan business transaction.
9. Sensitive data di audit harus dimasking/dikontrol.
10. Sistem regulatory/case-management membutuhkan history yang defensible, bukan hanya current row.

---

## 33. Latihan

### Latihan 1 — Audit Metadata

Desain base entity untuk sistem multi-tenant yang mencatat:

- tenant id,
- created at/by,
- updated at/by,
- version,
- request id terakhir.

Tentukan mana field yang `updatable = false` dan mana yang boleh berubah.

### Latihan 2 — Soft Delete

Untuk entity `Document`, buat desain yang menjawab:

- active query,
- include deleted query,
- restore,
- permanent delete after retention,
- audit delete reason,
- unique constraint untuk file name aktif per case.

### Latihan 3 — Status History

Untuk workflow:

```text
DRAFT -> SUBMITTED -> REVIEW -> APPROVED/REJECTED
```

Buat table:

- current application,
- status history,
- audit trail.

Tentukan transaksi apa yang harus atomic.

### Latihan 4 — Temporal Query

Desain table untuk licence yang statusnya bisa berubah, dan buat query:

- current status,
- status as-of date,
- full timeline.

### Latihan 5 — Failure Analysis

Sebuah batch job melakukan bulk update semua expired application menjadi `EXPIRED`, tetapi audit trail kosong.

Analisis:

- kenapa terjadi,
- bagaimana mencegah,
- bagaimana memperbaiki data yang sudah terlanjur berubah.

---

## 34. Referensi

- Jakarta Persistence 3.2 Specification — Object/relational mapping and persistence standard for Jakarta EE and Java SE: https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- Jakarta Persistence EntityListeners API: https://jakarta.ee/specifications/persistence/4.0/apidocs/jakarta.persistence/jakarta/persistence/entitylisteners
- Hibernate ORM Documentation: https://hibernate.org/orm/documentation/
- Hibernate Envers: https://hibernate.org/orm/envers/
- Hibernate `@SoftDelete` Javadoc: https://docs.hibernate.org/orm/6.4/javadocs/org/hibernate/annotations/SoftDelete.html
- Spring Data JPA Auditing Reference: https://docs.spring.io/spring-data/jpa/reference/auditing.html
- Jakarta Transactions 2.0 Specification: https://jakarta.ee/specifications/transactions/2.0/jakarta-transactions-spec-2.0.html

---

## 35. Posisi dalam Seri

Kita telah menyelesaikan:

```text
Part 021 — Auditing, Temporal Data, Soft Delete, and Historical Correctness
```

Seri belum selesai.

Bagian berikutnya:

```text
Part 022 — Multi-Tenancy, Multi-Schema, Multi-Database, and Data Partitioning
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 020 — Advanced Mapping: Inheritance, Polymorphism, JSON, LOB, Custom Types](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 022 — Multi-Tenancy, Multi-Schema, Multi-Database, and Data Partitioning](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-022.md)

</div>