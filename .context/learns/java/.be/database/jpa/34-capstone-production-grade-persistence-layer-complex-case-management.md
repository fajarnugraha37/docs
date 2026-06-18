# Part 34 — Capstone: Designing a Production-Grade Persistence Layer for Complex Case Management

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `34-capstone-production-grade-persistence-layer-complex-case-management.md`  
> Status: **Bagian terakhir dari seri ini**  
> Target: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM, EclipseLink

---

## 0. Tujuan Capstone

Bagian ini adalah sintesis dari seluruh seri. Kita tidak lagi membahas fitur ORM satu per satu. Kita akan menggunakannya sebagai alat desain untuk membangun persistence layer production-grade pada domain **complex case management**.

Domain ini sengaja dipilih karena ia sulit:

- Banyak state transition.
- Banyak aktor dan role.
- Banyak dokumen dan correspondence.
- Banyak audit requirement.
- Ada SLA, escalation, approval, review, rework, assignment.
- Ada data historis yang tidak boleh hilang.
- Ada query operasional yang berat.
- Ada batch job dan archival.
- Ada risiko regulatory defensibility.
- Ada kebutuhan explainability: “kenapa case ini masuk status X pada waktu Y oleh actor Z?”

Di sistem seperti ini, ORM yang dipakai secara naif akan menjadi sumber masalah:

- aggregate terlalu besar,
- cascade berlebihan,
- N+1,
- cartesian explosion,
- stale update,
- missing audit,
- hidden lazy load,
- inconsistent state,
- soft-delete leakage,
- cache stale,
- batch job memory leak,
- query model lambat,
- migration schema sulit,
- data historis tidak bisa direkonstruksi.

Target bagian ini adalah membangun mental model dan blueprint yang bisa dipakai sebagai referensi desain nyata.

---

## 1. Baseline dan Posisi Teknologi

### 1.1 Jakarta Persistence sebagai kontrak minimal

Jakarta Persistence mendefinisikan standard untuk object/relational mapping dan pengelolaan persistence di Java SE maupun Jakarta EE. Ia mendefinisikan konsep seperti entity, persistence context, `EntityManager`, lifecycle state, query language, transaction integration, locking, cache mode, schema generation, dan metadata mapping.

Namun specification tidak mendefinisikan seluruh detail runtime yang menentukan performa dan failure mode. Banyak hal penting tetap provider-specific:

- bagaimana dirty checking dioptimalkan,
- bagaimana SQL di-generate,
- bagaimana fetch plan dikompilasi,
- bagaimana query plan cache bekerja,
- bagaimana bytecode enhancement/weaving dilakukan,
- bagaimana second-level cache diintegrasikan,
- bagaimana batching diurutkan,
- bagaimana dialect menangani pagination/locking/LOB/timestamp.

Baseline stabil modern untuk seri ini adalah **Jakarta Persistence 3.2**, bagian dari Jakarta EE 11. Specification ini menjadi baseline standard modern, sedangkan implementasi open source kompatibel mencakup Hibernate ORM 7 dan EclipseLink 5. Untuk legacy Java 8, baseline umumnya masih JPA 2.1/2.2 dengan namespace `javax.persistence` dan provider generasi lama.

### 1.2 Hibernate dan EclipseLink sebagai mesin konkret

Hibernate ORM dan EclipseLink sama-sama provider JPA/Jakarta Persistence, tetapi desain internalnya berbeda.

Hibernate berpusat pada konsep:

- `SessionFactory`,
- `Session`,
- persistence context,
- action queue,
- event system,
- interceptors,
- bytecode enhancement,
- dialect dan SQL AST,
- optional second-level cache,
- provider extension seperti filters, natural id, stateless session.

EclipseLink berpusat pada konsep:

- session,
- unit of work,
- descriptor,
- weaving,
- shared cache,
- query hints,
- fetch group,
- descriptor customizer,
- advanced mapping extension.

Dalam capstone ini, desain harus bisa dibaca pada tiga lapisan:

```text
Specification Layer
  Jakarta Persistence / JPA contract

Provider Layer
  Hibernate ORM / EclipseLink behavior

Application Architecture Layer
  aggregate, service boundary, read model, workflow, audit, batch, observability
```

### 1.3 Java 8–25 compatibility lens

Untuk Java 8 legacy system:

- kemungkinan masih memakai `javax.persistence`,
- framework mungkin Spring Boot 2.x atau Jakarta EE lama,
- Hibernate 5.x/EclipseLink 2.x umum ditemukan,
- record, sealed class, modern switch, virtual thread, dan banyak fitur Java modern belum tersedia,
- migration ke `jakarta.persistence` adalah breaking namespace change.

Untuk Java 17/21/25 modern system:

- `jakarta.persistence` adalah baseline,
- Hibernate 6/7 dan EclipseLink 4/5 lebih relevan,
- Java records dapat dipertimbangkan untuk DTO/value projection/embeddable modern sesuai support provider,
- virtual threads dapat membantu concurrency blocking I/O di layer service, tetapi tidak menghapus bottleneck DB/connection pool,
- module path/classpath perlu diperhatikan jika memakai weaving/enhancement,
- AOT/native image butuh perhatian khusus pada reflection, proxy, enhancement, dan metadata.

Aturan desain penting:

> Jangan desain persistence layer berdasarkan fitur Java terbaru saja. Desain berdasarkan invariant data, transaction boundary, query pattern, dan provider behavior yang terukur.

---

## 2. Problem Domain: Complex Case Management

Kita gunakan domain berikut sebagai contoh:

- `Case`
- `Application`
- `ComplianceCheck`
- `Appeal`
- `Correspondence`
- `Document`
- `AuditTrail`
- `TaskAssignment`
- `Escalation`
- `Approval`
- `ReviewNote`
- `CaseParty`
- `Officer`
- `AgencyUnit`
- `SlaClock`
- `CaseEvent`

Sistem mendukung workflow seperti:

```text
Draft Application
  -> Submitted
  -> Screening
  -> Case Created
  -> Assigned
  -> Under Review
  -> Clarification Requested
  -> Applicant Responded
  -> Compliance Review
  -> Recommendation
  -> Approval
  -> Decision Issued
  -> Appeal Window
  -> Closed
```

Tetapi workflow nyata biasanya tidak linear:

- case bisa rework,
- assignment bisa pindah,
- approval bisa reject ke reviewer,
- document bisa diganti,
- correspondence bisa dikirim ulang,
- appeal bisa membuka lifecycle baru,
- compliance finding bisa menghasilkan enforcement action,
- SLA bisa pause/resume,
- state tertentu bisa auto-escalate,
- audit harus tetap bisa direkonstruksi.

---

## 3. First Principle: Persistence Layer Bukan Repository CRUD

Repository CRUD hanya menjawab:

```text
Bagaimana menyimpan dan membaca entity?
```

Persistence layer production-grade harus menjawab:

```text
State apa yang valid?
Siapa boleh mengubah apa?
Dalam transaction boundary mana perubahan itu sah?
Data historis apa yang harus immutable?
Query operasional apa yang harus cepat?
Apakah object graph ini aman dimuat?
Apakah perubahan ini bisa bersaing dengan perubahan user lain?
Apakah audit cukup untuk pembuktian?
Apa failure mode ketika batch berjalan terhadap jutaan row?
Apa strategi migration tanpa downtime?
```

CRUD repository bukan salah. Tetapi ia hanya alat kecil dalam desain yang lebih besar.

---

## 4. Bounded Context dan Aggregate Boundary

### 4.1 Jangan mulai dari tabel

Kesalahan umum:

```text
Ada tabel CASE, APPLICATION, DOCUMENT, APPROVAL.
Maka buat entity yang saling cascade semua.
```

Ini membuat ORM object graph menjadi mirror database schema. Hasilnya:

- aggregate membesar,
- flush mahal,
- fetch plan sulit,
- cascade berbahaya,
- concurrency conflict melebar,
- API response mudah memicu lazy loading,
- query read model menjadi lambat.

Mulai dari invariant.

Pertanyaan desain:

- Perubahan apa yang harus atomic?
- Object mana yang tidak boleh berubah tanpa parent?
- Object mana yang lifecycle-nya independen?
- Object mana yang shared?
- Object mana yang immutable setelah dibuat?
- Object mana yang hanya read model?

### 4.2 Candidate aggregate

Untuk case management, aggregate yang masuk akal:

```text
Case Aggregate
  Root: CaseRecord
  Children: CaseStatus, CaseCurrentAssignment, CaseSlaSnapshot
  Not children: Document binary, AuditTrail, Correspondence history, Approval history

Application Aggregate
  Root: ApplicationRecord
  Children: ApplicantSnapshot, SubmittedData, ApplicationItem
  Not children: CaseRecord setelah case dibuat

Document Aggregate
  Root: DocumentMetadata
  Children: DocumentVersion
  Binary storage: external/blob table/object store

Approval Aggregate
  Root: ApprovalProcess
  Children: ApprovalStep, ApprovalDecision

Correspondence Aggregate
  Root: Correspondence
  Children: Recipient, DeliveryAttempt, TemplateSnapshot

Audit/Event Aggregate
  Root: CaseEvent / AuditTrail
  Immutable append-only record
```

### 4.3 Aggregate rule

Aturan praktis:

```text
Satu aggregate = satu consistency boundary utama.
Jangan cascade lifecycle melewati consistency boundary.
Jangan fetch seluruh aggregate jika use case hanya butuh summary.
Jangan jadikan history immutable sebagai child mutable aggregate.
```

Contoh salah:

```java
@Entity
class CaseRecord {
    @OneToMany(mappedBy = "caseRecord", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<AuditTrail> auditTrails;

    @OneToMany(mappedBy = "caseRecord", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Document> documents;

    @OneToMany(mappedBy = "caseRecord", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Correspondence> correspondences;
}
```

Masalah:

- `CaseRecord` menjadi aggregate raksasa.
- Delete case bisa menghapus audit/document/correspondence.
- Loading case bisa memancing collection besar.
- Flush case bisa memeriksa terlalu banyak collection.
- Audit yang seharusnya immutable menjadi bagian dari mutable graph.

Contoh lebih aman:

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {

    @Id
    private UUID id;

    @Version
    private long version;

    @Column(nullable = false, unique = true, length = 40)
    private String caseNo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private CaseStatus status;

    @Column(nullable = false)
    private UUID currentAssigneeId;

    @Column(nullable = false)
    private Instant submittedAt;

    @Column(nullable = false)
    private Instant updatedAt;

    protected CaseRecord() {
    }

    public void assignTo(UUID officerId, Actor actor, Clock clock) {
        requireOpenCase();
        requireActorCanAssign(actor);
        this.currentAssigneeId = Objects.requireNonNull(officerId);
        this.updatedAt = clock.instant();
    }

    public void transitionTo(CaseStatus next, Actor actor, Clock clock) {
        CaseTransitionPolicy.validate(this.status, next, actor);
        this.status = next;
        this.updatedAt = clock.instant();
    }
}
```

Notice:

- `CaseRecord` menyimpan current state.
- Audit/event ditulis terpisah.
- Document/correspondence/approval tidak dicascade dari case.
- Invariant state transition dijaga di method domain/service, bukan diserahkan ke setter bebas.

---

## 5. Entity Model vs Read Model

### 5.1 Entity model untuk mutation

Entity model cocok untuk:

- enforce invariant,
- state transition,
- optimistic locking,
- transactional consistency,
- lifecycle operation.

Entity model tidak selalu cocok untuk:

- dashboard listing,
- report besar,
- search/filter kompleks,
- export ribuan row,
- audit timeline gabungan,
- cross-module query.

### 5.2 Read model untuk query operasional

Complex case management sering butuh listing seperti:

- “my pending cases”,
- “cases breaching SLA in 3 days”,
- “appeals pending approval”,
- “all open cases by agency unit”,
- “case timeline”,
- “document checklist status”.

Jangan paksa semua query ini melalui graph entity besar.

Gunakan DTO projection, database view, materialized view, denormalized read table, atau native query ketika lebih tepat.

Contoh DTO projection:

```java
public record CaseWorklistRow(
    UUID caseId,
    String caseNo,
    String status,
    String assigneeName,
    Instant receivedAt,
    Instant slaDueAt,
    boolean breached
) {}
```

JPQL projection:

```java
@Query("""
    select new com.acme.casework.CaseWorklistRow(
        c.id,
        c.caseNo,
        c.status,
        o.displayName,
        c.submittedAt,
        s.dueAt,
        case when s.dueAt < current_timestamp then true else false end
    )
    from CaseRecord c
    join Officer o on o.id = c.currentAssigneeId
    join SlaSnapshot s on s.caseId = c.id
    where c.currentAssigneeId = :officerId
      and c.status in :openStatuses
    order by s.dueAt asc
""")
List<CaseWorklistRow> findWorklist(UUID officerId, Collection<CaseStatus> openStatuses);
```

Jika provider/query syntax berbeda atau query lebih kompleks, gunakan native query/read repository.

### 5.3 Rule

```text
Command path memakai entity.
Query path memakai projection/read model.
Jangan membuat entity graph menjadi read API universal.
```

---

## 6. Suggested Physical Model

Contoh physical model konseptual:

```text
case_record
  id PK
  case_no unique
  status
  current_assignee_id
  current_unit_id
  submitted_at
  updated_at
  version

case_state_transition
  id PK
  case_id
  from_status
  to_status
  actor_id
  actor_role
  reason_code
  comment
  occurred_at
  correlation_id

case_assignment_history
  id PK
  case_id
  from_officer_id
  to_officer_id
  assigned_by
  assigned_at
  reason

case_sla_clock
  id PK
  case_id
  clock_type
  started_at
  paused_at
  resumed_at
  due_at
  stopped_at
  status
  version

application_record
  id PK
  application_no unique
  applicant_snapshot_json/clob
  submitted_data_json/clob
  status
  submitted_at
  version

document_metadata
  id PK
  owner_type
  owner_id
  document_type
  current_version_no
  status
  created_at
  version

document_version
  id PK
  document_id
  version_no
  storage_key
  checksum
  content_type
  size_bytes
  uploaded_by
  uploaded_at

correspondence
  id PK
  case_id
  template_code
  subject
  body_snapshot_clob
  status
  created_by
  created_at
  sent_at
  version

correspondence_recipient
  id PK
  correspondence_id
  recipient_type
  address
  delivery_status

approval_process
  id PK
  case_id
  process_type
  status
  started_at
  completed_at
  version

approval_step
  id PK
  process_id
  step_no
  approver_id
  decision
  decided_at
  comment

case_event
  id PK
  case_id
  event_type
  payload_json/clob
  actor_id
  occurred_at
  correlation_id
```

### 6.1 Why split this way?

`case_record` adalah current state untuk command.

`case_state_transition` adalah immutable transition log.

`case_assignment_history` adalah history assignment.

`case_sla_clock` bisa mutable karena clock dapat pause/resume.

`document_metadata` dan `document_version` berdiri sendiri karena dokumen punya lifecycle dan ukuran besar.

`correspondence` berdiri sendiri karena email/letter delivery punya retry dan audit sendiri.

`approval_process` berdiri sendiri karena approval dapat punya step, reject, resubmit, dan conflict sendiri.

`case_event` adalah append-only event/audit model untuk reconstruction.

---

## 7. Mapping Design

### 7.1 Root entity: CaseRecord

```java
@Entity
@Table(
    name = "case_record",
    indexes = {
        @Index(name = "idx_case_record_status_assignee", columnList = "status,current_assignee_id"),
        @Index(name = "idx_case_record_updated_at", columnList = "updated_at")
    }
)
public class CaseRecord {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "case_no", nullable = false, unique = true, length = 40, updatable = false)
    private String caseNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 40)
    private CaseStatus status;

    @Column(name = "current_assignee_id", nullable = false)
    private UUID currentAssigneeId;

    @Column(name = "current_unit_id", nullable = false)
    private UUID currentUnitId;

    @Column(name = "submitted_at", nullable = false, updatable = false)
    private Instant submittedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected CaseRecord() {
        // for ORM
    }

    public static CaseRecord create(
        UUID id,
        String caseNo,
        UUID assigneeId,
        UUID unitId,
        Instant now
    ) {
        CaseRecord c = new CaseRecord();
        c.id = Objects.requireNonNull(id);
        c.caseNo = requireNonBlank(caseNo);
        c.status = CaseStatus.CREATED;
        c.currentAssigneeId = Objects.requireNonNull(assigneeId);
        c.currentUnitId = Objects.requireNonNull(unitId);
        c.submittedAt = Objects.requireNonNull(now);
        c.updatedAt = now;
        return c;
    }

    public CaseTransition transitionTo(CaseStatus next, Actor actor, String reason, Clock clock) {
        Objects.requireNonNull(next);
        Objects.requireNonNull(actor);
        Instant now = clock.instant();

        CaseTransitionPolicy.validate(this.status, next, actor);

        CaseStatus previous = this.status;
        this.status = next;
        this.updatedAt = now;

        return CaseTransition.record(
            UUID.randomUUID(),
            this.id,
            previous,
            next,
            actor.id(),
            actor.role(),
            reason,
            now
        );
    }
}
```

Important choices:

- `@Version` protects current-state command updates.
- `caseNo` is immutable after creation.
- No direct `@OneToMany` to audit/history/document/correspondence.
- Domain method returns event/transition object to be persisted by application service.
- `Instant` used for timeline consistency.
- Enum stored as string to avoid ordinal corruption.

### 7.2 Immutable transition log

```java
@Entity
@Table(
    name = "case_state_transition",
    indexes = {
        @Index(name = "idx_case_transition_case_time", columnList = "case_id,occurred_at"),
        @Index(name = "idx_case_transition_actor_time", columnList = "actor_id,occurred_at")
    }
)
public class CaseTransition {

    @Id
    private UUID id;

    @Column(name = "case_id", nullable = false, updatable = false)
    private UUID caseId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", nullable = false, updatable = false, length = 40)
    private CaseStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", nullable = false, updatable = false, length = 40)
    private CaseStatus toStatus;

    @Column(name = "actor_id", nullable = false, updatable = false)
    private UUID actorId;

    @Column(name = "actor_role", nullable = false, updatable = false, length = 80)
    private String actorRole;

    @Column(name = "reason", nullable = true, updatable = false, length = 500)
    private String reason;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    protected CaseTransition() {}

    static CaseTransition record(
        UUID id,
        UUID caseId,
        CaseStatus from,
        CaseStatus to,
        UUID actorId,
        String actorRole,
        String reason,
        Instant occurredAt
    ) {
        CaseTransition t = new CaseTransition();
        t.id = id;
        t.caseId = caseId;
        t.fromStatus = from;
        t.toStatus = to;
        t.actorId = actorId;
        t.actorRole = actorRole;
        t.reason = reason;
        t.occurredAt = occurredAt;
        return t;
    }
}
```

Why store `caseId` instead of `@ManyToOne CaseRecord`?

Because transition log is append-only and often queried independently. It does not need to manage parent lifecycle. A `@ManyToOne(fetch = LAZY)` may be acceptable, but the foreign key ID is often enough and avoids unnecessary graph coupling.

### 7.3 Document mapping

```java
@Entity
@Table(name = "document_metadata")
public class DocumentMetadata {

    @Id
    private UUID id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(name = "owner_type", nullable = false, length = 40)
    private DocumentOwnerType ownerType;

    @Column(name = "owner_id", nullable = false)
    private UUID ownerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "document_type", nullable = false, length = 80)
    private DocumentType documentType;

    @Column(name = "current_version_no", nullable = false)
    private int currentVersionNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 40)
    private DocumentStatus status;
}
```

```java
@Entity
@Table(
    name = "document_version",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_document_version_no", columnNames = {"document_id", "version_no"})
    }
)
public class DocumentVersion {

    @Id
    private UUID id;

    @Column(name = "document_id", nullable = false, updatable = false)
    private UUID documentId;

    @Column(name = "version_no", nullable = false, updatable = false)
    private int versionNo;

    @Column(name = "storage_key", nullable = false, updatable = false, length = 500)
    private String storageKey;

    @Column(name = "checksum", nullable = false, updatable = false, length = 128)
    private String checksum;

    @Column(name = "content_type", nullable = false, updatable = false, length = 100)
    private String contentType;

    @Column(name = "size_bytes", nullable = false, updatable = false)
    private long sizeBytes;

    @Column(name = "uploaded_by", nullable = false, updatable = false)
    private UUID uploadedBy;

    @Column(name = "uploaded_at", nullable = false, updatable = false)
    private Instant uploadedAt;
}
```

Design rule:

```text
Do not put large binary/CLOB payload into a frequently loaded aggregate root unless the use case needs it every time.
```

For documents, metadata and binary content should usually be separated. The metadata participates in ORM. The binary may live in object storage, BLOB table, or dedicated document store.

---

## 8. Application Service Boundary

### 8.1 Transaction script for state transition

```java
@Service
public class CaseTransitionService {

    private final CaseRecordRepository caseRecords;
    private final CaseTransitionRepository transitions;
    private final CaseEventRepository events;
    private final AuthorizationPolicy authorization;
    private final Clock clock;

    @Transactional
    public void transitionCase(TransitionCaseCommand command, Actor actor) {
        CaseRecord caseRecord = caseRecords.findByIdForUpdate(command.caseId())
            .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        authorization.requireCanTransition(actor, caseRecord, command.nextStatus());

        CaseTransition transition = caseRecord.transitionTo(
            command.nextStatus(),
            actor,
            command.reason(),
            clock
        );

        transitions.save(transition);

        events.save(CaseEvent.transitioned(
            UUID.randomUUID(),
            caseRecord.id(),
            transition.id(),
            actor.id(),
            clock.instant(),
            command.correlationId()
        ));
    }
}
```

Notes:

- Authorization check happens inside transaction after loading current state.
- State transition modifies current state and creates immutable transition record.
- Event/audit is saved in same DB transaction when strict consistency is required.
- For external integration, use outbox rather than direct network call inside transaction.

### 8.2 Why not direct repository save from controller?

Bad pattern:

```java
@PostMapping("/cases/{id}")
public void update(@PathVariable UUID id, @RequestBody CaseRecord requestBody) {
    caseRepository.save(requestBody);
}
```

Risks:

- mass assignment,
- null overwrite,
- detached merge hazard,
- stale update,
- invalid transition,
- missing audit,
- security bypass,
- collection replacement deletes rows.

Better:

```java
public record TransitionCaseCommand(
    UUID caseId,
    CaseStatus nextStatus,
    String reason,
    String correlationId
) {}
```

Use command-specific service method.

---

## 9. Optimistic vs Pessimistic Locking Strategy

### 9.1 Default: optimistic locking for command aggregates

Use `@Version` on mutable aggregate roots:

- `CaseRecord`,
- `ApplicationRecord`,
- `DocumentMetadata`,
- `ApprovalProcess`,
- `SlaClock`.

Optimistic locking fits when conflicts are possible but not constant.

Example:

```java
@Version
@Column(nullable = false)
private long version;
```

When two officers update the same case:

```text
Officer A reads case version 12.
Officer B reads case version 12.
Officer A transitions to UNDER_REVIEW -> version 13.
Officer B tries to assign stale version 12 -> optimistic lock exception.
```

This is desirable. It prevents silent overwrite.

### 9.2 Pessimistic lock for high-risk transition

Use pessimistic locking when the operation cannot tolerate concurrent decision-making:

- final approval,
- decision issuance,
- SLA close computation,
- document version increment under high concurrency,
- batch claiming tasks.

Example repository method:

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("select c from CaseRecord c where c.id = :id")
Optional<CaseRecord> findByIdForUpdate(UUID id);
```

But pessimistic locking is not free:

- can block threads,
- can cause deadlock,
- consumes DB resources,
- interacts with timeout differently per database/provider,
- must use deterministic lock order.

### 9.3 Lock order rule

For multi-aggregate operations:

```text
Always lock in stable order:
1. CaseRecord
2. ApprovalProcess
3. DocumentMetadata
4. SlaClock
```

Never let two flows lock them in opposite order.

Bad:

```text
Flow A: lock Case -> Approval
Flow B: lock Approval -> Case
```

This is classic deadlock.

---

## 10. Audit and Regulatory Defensibility

### 10.1 Audit is not just `createdBy` and `updatedBy`

A defensible audit model should answer:

- Who did it?
- Acting in what role/capacity?
- On behalf of whom?
- What changed?
- From what value to what value?
- Why was the action allowed?
- What policy/rule version was used?
- What request/correlation ID triggered it?
- What was the external reference?
- Was it system-generated or user-generated?
- Can we reconstruct the timeline later?

### 10.2 Separate technical audit from domain event

Technical audit:

```text
row X changed column status from A to B
```

Domain event:

```text
Case was approved by Senior Officer after compliance review completed
```

Both can be useful, but they serve different purposes.

Recommended design:

```text
case_event
  business event stream

audit_trail
  technical/object-level changes

case_state_transition
  normalized transition history
```

### 10.3 Immutable audit design

Audit tables should usually be append-only:

```java
@Entity
@Table(name = "case_event")
public class CaseEvent {

    @Id
    private UUID id;

    @Column(name = "case_id", nullable = false, updatable = false)
    private UUID caseId;

    @Column(name = "event_type", nullable = false, updatable = false, length = 80)
    private String eventType;

    @Lob
    @Column(name = "payload", nullable = false, updatable = false)
    private String payloadJson;

    @Column(name = "actor_id", nullable = false, updatable = false)
    private UUID actorId;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    @Column(name = "correlation_id", nullable = false, updatable = false, length = 80)
    private String correlationId;
}
```

### 10.4 Avoid audit listener as only source of truth

Hibernate/EclipseLink listeners can help for technical audit, but they are risky as the only domain audit mechanism:

- bulk update can bypass lifecycle callbacks,
- native query can bypass ORM listener,
- listener may not know business intent,
- listener can create recursion or flush side effects,
- listener may miss context if actor/correlation is not propagated correctly.

Use explicit domain event writing for critical regulatory events.

---

## 11. State Machine Persistence

### 11.1 Status column is not enough

A simple status column:

```text
case_record.status = APPROVED
```

Does not explain:

- from where it came,
- who approved,
- when,
- under what policy,
- whether approval was first attempt or after rework,
- whether SLA was paused,
- whether supporting document was valid.

### 11.2 Use current state + transition history

```text
case_record.status
  current state optimized for command/query

case_state_transition
  normalized history of legal transitions

case_event
  richer business event timeline
```

### 11.3 Transition policy

```java
public final class CaseTransitionPolicy {

    private static final Map<CaseStatus, Set<CaseStatus>> ALLOWED = Map.of(
        CaseStatus.CREATED, Set.of(CaseStatus.ASSIGNED, CaseStatus.CANCELLED),
        CaseStatus.ASSIGNED, Set.of(CaseStatus.UNDER_REVIEW, CaseStatus.REASSIGNED),
        CaseStatus.UNDER_REVIEW, Set.of(CaseStatus.CLARIFICATION_REQUESTED, CaseStatus.RECOMMENDED),
        CaseStatus.CLARIFICATION_REQUESTED, Set.of(CaseStatus.APPLICANT_RESPONDED),
        CaseStatus.APPLICANT_RESPONDED, Set.of(CaseStatus.UNDER_REVIEW),
        CaseStatus.RECOMMENDED, Set.of(CaseStatus.APPROVED, CaseStatus.REJECTED),
        CaseStatus.APPROVED, Set.of(CaseStatus.DECISION_ISSUED),
        CaseStatus.DECISION_ISSUED, Set.of(CaseStatus.CLOSED, CaseStatus.APPEALED)
    );

    public static void validate(CaseStatus from, CaseStatus to, Actor actor) {
        if (!ALLOWED.getOrDefault(from, Set.of()).contains(to)) {
            throw new IllegalStateException("Illegal transition " + from + " -> " + to);
        }

        if (to.requiresSeniorOfficer() && !actor.hasRole("SENIOR_OFFICER")) {
            throw new AccessDeniedException("Transition requires Senior Officer");
        }
    }
}
```

### 11.4 Database constraints still matter

Application state machine is necessary but not sufficient. Add DB constraints where possible:

- non-null columns,
- valid enum check constraints if supported,
- unique case number,
- unique document version,
- FK constraints for normalized references,
- partial/filtered unique indexes when supported,
- immutable audit via permission/model discipline.

---

## 12. Fetch Plan Design

### 12.1 Use-case based fetch plan

Do not define one global fetch plan.

Use cases:

```text
Case detail page
  needs case summary + current assignment + latest SLA + document checklist summary

Case timeline
  needs events/transitions/correspondence chronological feed

Officer worklist
  needs light projection only

Approval page
  needs approval process + steps + case summary

Document page
  needs document metadata + versions, not full case graph
```

### 12.2 Avoid EAGER by default

Default rule:

```text
Most associations should be LAZY.
Fetch intentionally per query/use case.
```

But do not confuse LAZY with performance guarantee. Lazy loading can create N+1 if access pattern is uncontrolled.

### 12.3 Worklist should be projection

Bad:

```java
List<CaseRecord> cases = caseRepository.findByStatusIn(openStatuses);
return cases.stream()
    .map(c -> new Row(c.getCaseNo(), c.getAssignee().getName(), c.getDocuments().size()))
    .toList();
```

This can trigger:

- N+1 assignee query,
- N+1 document query,
- accidental collection initialization,
- serialization cascade.

Better:

```java
List<CaseWorklistRow> rows = caseWorklistRepository.findRows(actor.id(), openStatuses);
```

### 12.4 Detail page can use controlled query plan

Options:

- JPQL with join fetch for single-valued associations.
- Batch fetch for collections.
- Entity graph for controlled graph materialization.
- Separate queries for multiple collections.
- DTO aggregation when detail is read-only.

Rule:

```text
One query for root + single-valued references.
Separate controlled queries for large collections.
Never join fetch multiple large collections blindly.
```

---

## 13. Transaction Boundary Design

### 13.1 One command = one transaction

Examples:

- assign case,
- transition case,
- upload document metadata,
- approve step,
- send correspondence record,
- pause SLA,
- close case.

Each command should have a clear transaction boundary.

```java
@Transactional
public void approveCase(ApproveCaseCommand command, Actor actor) {
    // load current state
    // authorize
    // validate invariant
    // mutate aggregate
    // write event/audit
    // write outbox if needed
}
```

### 13.2 Avoid transaction boundary around whole web request

Open Session in View can hide lazy loading problems:

```text
Controller returns entity
Serializer touches lazy association
DB query happens during response rendering
No clear service transaction intent
```

In high-integrity systems, prefer:

```text
Controller -> Command/Query DTO -> Service transaction -> DTO response
```

### 13.3 External calls and transaction

Do not call external systems while holding DB transaction unless unavoidable.

Bad:

```text
begin transaction
update case
call email gateway
call document service
commit
```

Risks:

- long transaction,
- DB lock held while network waits,
- partial external side effect if rollback,
- retry ambiguity.

Better:

```text
begin transaction
update case
insert outbox message
commit
async worker sends email/document notification
mark outbox delivered
```

---

## 14. Outbox Pattern for Integration

### 14.1 Outbox table

```text
outbox_message
  id PK
  aggregate_type
  aggregate_id
  event_type
  payload_json
  status
  attempts
  next_attempt_at
  created_at
  locked_by
  locked_until
```

### 14.2 Write outbox inside same transaction

```java
@Transactional
public void issueDecision(IssueDecisionCommand command, Actor actor) {
    CaseRecord c = caseRecords.get(command.caseId());
    c.transitionTo(CaseStatus.DECISION_ISSUED, actor, command.reason(), clock);

    caseEvents.save(...);

    outbox.save(OutboxMessage.create(
        "CaseRecord",
        c.id(),
        "CaseDecisionIssued",
        payload
    ));
}
```

### 14.3 Worker processing

Use claim-and-process:

```sql
select *
from outbox_message
where status = 'PENDING'
  and next_attempt_at <= current_timestamp
order by created_at
fetch first 100 rows only
for update skip locked
```

Exact SQL differs by database. Provider/native query/dialect support must be tested.

### 14.4 ORM caution

For outbox batch processing:

- use pagination/claiming carefully,
- flush/clear every batch,
- avoid loading huge payloads unless needed,
- avoid keeping persistence context full,
- use native query if lock/skip-locked syntax is database-specific.

---

## 15. Batch Job Design

Common batch jobs:

- SLA breach detection,
- escalation creation,
- reminder notification,
- archival candidate marking,
- document cleanup,
- stale draft purge,
- outbox retry.

### 15.1 Do not process millions of entities as one persistence context

Bad:

```java
@Transactional
public void escalateAll() {
    List<CaseRecord> cases = caseRepository.findAllOpenCases();
    for (CaseRecord c : cases) {
        c.escalate(clock);
    }
}
```

Risks:

- huge memory,
- slow dirty checking,
- long transaction,
- lock contention,
- rollback too large,
- connection held too long.

Better:

```text
Process in chunks.
Each chunk has separate transaction.
Use projection to find candidate IDs.
Load only IDs to mutate.
Flush/clear per chunk.
Record job progress.
Make operation idempotent.
```

### 15.2 Batch skeleton

```java
public void runEscalationJob() {
    while (true) {
        List<UUID> ids = caseQueryRepository.findEscalationCandidateIds(500);
        if (ids.isEmpty()) {
            return;
        }
        escalationChunkService.process(ids);
    }
}
```

```java
@Service
public class EscalationChunkService {

    @Transactional
    public void process(List<UUID> caseIds) {
        List<CaseRecord> cases = caseRecords.findByIdsForUpdate(caseIds);
        for (CaseRecord c : cases) {
            if (c.isStillEscalationCandidate(clock.instant())) {
                c.escalate(clock);
                caseEvents.save(CaseEvent.escalated(...));
            }
        }
    }
}
```

### 15.3 Idempotency

Batch jobs must be safe to retry.

Use unique constraints:

```text
unique(case_id, escalation_type, escalation_date)
```

or event idempotency key:

```text
unique(idempotency_key)
```

Do not rely only on “worker will not run twice”.

---

## 16. Archival Strategy

### 16.1 Archive is not delete

Case management systems often need retention:

- current operational data,
- historical closed cases,
- immutable audit,
- legal hold,
- agency-specific retention period,
- export to warehouse/S3/object storage.

Deleting rows may violate audit/legal requirements.

### 16.2 Separate hot path and cold path

Hot tables:

```text
case_record
case_sla_clock
current_assignment
open approval
open correspondence
```

Cold/historical tables:

```text
case_event
case_state_transition
assignment_history
closed_case_archive
old audit partitions
old document versions
```

### 16.3 ORM is not always right for archival

For moving millions of rows:

- use SQL/DMS/ETL/database-native tools,
- avoid entity-by-entity ORM mutation,
- maintain audit trail,
- verify counts/checksums,
- use archive marker/status before physical relocation,
- keep read path aware of archived location.

### 16.4 Archive-safe design

```text
1. Mark closed cases eligible.
2. Freeze mutation paths.
3. Export immutable data.
4. Verify exported counts and checksums.
5. Switch read path for archived cases.
6. Purge/move only when retention policy allows.
```

---

## 17. Cache Strategy

### 17.1 Default: no second-level cache for mutable workflow roots

Avoid second-level cache for:

- `CaseRecord`,
- `ApprovalProcess`,
- `SlaClock`,
- `TaskAssignment`,
- rapidly changing worklist data.

These are mutable and correctness-sensitive.

### 17.2 Cache reference data

Good candidates:

- lookup tables,
- agency unit reference,
- document type reference,
- workflow rule definitions if versioned/immutable,
- template metadata if versioned.

### 17.3 Query cache caution

Query cache is dangerous for worklists because result sets change often.

Bad candidates:

```text
my pending cases
open cases by assignee
cases breaching SLA
```

Good candidates:

```text
active document types
static reason code list
published workflow rule version metadata
```

### 17.4 Tenant/security caution

If system is multi-tenant or role-filtered:

```text
Cache key must include tenant/security dimension or cache must be disabled for sensitive data.
```

---

## 18. Multi-Tenancy and Data Isolation

### 18.1 Choose isolation model consciously

Options:

```text
Database per tenant
  strongest isolation, operationally heavier

Schema per tenant
  strong-ish isolation, migration more complex

Discriminator column
  operationally simple, leakage risk higher
```

For regulatory systems, discriminator-based tenancy must be treated carefully. ORM filters are helpful but not sufficient as sole security boundary.

### 18.2 Defense in depth

Use several layers:

- application authorization,
- tenant context validation,
- query predicates,
- provider filters where appropriate,
- database row-level security if available,
- test cases for leakage,
- cache separation,
- audit with tenant/agency context.

### 18.3 Native query bypass risk

Provider filters may not apply automatically to every native query. Every native query must be reviewed for tenant/security predicates.

Rule:

```text
Any query that can return business data must declare its tenant/security boundary explicitly.
```

---

## 19. Repository Architecture

### 19.1 Separate command repositories and query repositories

Command repository:

```java
public interface CaseRecordRepository {
    Optional<CaseRecord> findById(UUID id);
    Optional<CaseRecord> findByIdForUpdate(UUID id);
    void save(CaseRecord caseRecord);
}
```

Query repository:

```java
public interface CaseWorklistQueryRepository {
    Page<CaseWorklistRow> findOfficerWorklist(OfficerWorklistFilter filter, Pageable pageable);
    List<CaseTimelineRow> findTimeline(UUID caseId);
    CaseDetailView findCaseDetail(UUID caseId);
}
```

### 19.2 Why split?

Command repository protects aggregate mutation.

Query repository optimizes reads and may use:

- JPQL projection,
- Criteria,
- native SQL,
- database view,
- materialized view,
- search index,
- reporting replica.

Do not force both through one entity repository.

---

## 20. DTO Boundary and Merge Safety

### 20.1 Never trust detached entity from API

Do not expose entity as request body:

```java
public void updateCase(@RequestBody CaseRecord caseRecord)
```

Reasons:

- merge copies state,
- null may overwrite,
- collection replacement may delete children,
- client can set fields it should not set,
- optimistic lock semantics become unclear,
- audit intent is lost.

### 20.2 Use command DTO

```java
public record AssignCaseCommand(
    UUID caseId,
    UUID assigneeId,
    String reason,
    long expectedVersion
) {}
```

Then service:

```java
@Transactional
public void assign(AssignCaseCommand command, Actor actor) {
    CaseRecord c = caseRecords.findById(command.caseId())
        .orElseThrow();

    if (c.version() != command.expectedVersion()) {
        throw new OptimisticConflictException();
    }

    authorization.requireCanAssign(actor, c);
    c.assignTo(command.assigneeId(), actor, clock);
    events.save(...);
}
```

Provider `@Version` still protects DB race; explicit expected version improves API-level conflict response.

---

## 21. Schema Migration Strategy

### 21.1 Never rely on automatic update in production

`ddl-auto=update` or provider schema auto-update is not a production migration strategy.

Use:

- Flyway,
- Liquibase,
- controlled SQL scripts,
- deployment runbook,
- rollback/forward plan,
- test on production-like database.

### 21.2 Expand-contract for zero downtime

Example: replacing `case_record.assignee_name` with `current_assignee_id`.

```text
Phase 1: Expand
  add current_assignee_id nullable
  create index
  deploy app writing both old and new

Phase 2: Backfill
  fill current_assignee_id for old rows
  verify count and referential validity

Phase 3: Switch
  app reads new column
  keep old column for fallback

Phase 4: Contract
  enforce not null
  drop old column after safe window
```

### 21.3 Migration must include ORM regression

For every migration:

- mapping validation,
- generated SQL inspection,
- query plan regression,
- indexes check,
- lock behavior test,
- batch job test,
- rollback/forward path.

---

## 22. Observability Blueprint

### 22.1 Minimum production signals

Persistence layer should expose:

- SQL execution count per request,
- slow queries,
- bind-safe query shape,
- transaction duration,
- flush duration,
- entity load count,
- collection fetch count,
- second-level cache hit/miss if enabled,
- connection pool active/idle/wait,
- DB wait events if available,
- deadlock/lock timeout count,
- optimistic conflict count,
- batch job throughput,
- outbox pending count.

### 22.2 Correlation ID propagation

Every business command should have correlation ID:

```text
HTTP request ID
  -> service log
  -> ORM SQL comment/inspector if safe
  -> audit/event record
  -> outbox message
  -> external call log
```

Hibernate `StatementInspector` or provider-level SQL customization can help attach comments, but avoid leaking sensitive data.

### 22.3 SQL count tests

For critical endpoints:

```text
Case worklist endpoint
  expected: <= 3 SQL queries for 20 rows

Case detail endpoint
  expected: bounded queries independent of document/event count

Timeline endpoint
  expected: paginated query, no entity graph explosion
```

---

## 23. Failure Mode Review

### 23.1 Slow worklist

Symptoms:

- endpoint slow,
- DB CPU high,
- many SQL statements,
- memory high.

Likely causes:

- entity graph used for listing,
- N+1 for assignee/documents/SLA,
- no index on status/assignee/due date,
- offset pagination on huge table,
- query cache misuse.

Fix pattern:

- DTO projection,
- composite indexes,
- keyset pagination for deep pages,
- separate count strategy,
- SQL count regression test.

### 23.2 Unexpected delete

Symptoms:

- document/audit/correspondence missing,
- delete statement on child table during case update.

Likely causes:

- `orphanRemoval = true` on wrong collection,
- `CascadeType.REMOVE` crossing aggregate boundary,
- API replaced collection with partial list,
- detached merge copied incomplete graph.

Fix pattern:

- remove dangerous cascade,
- command-specific child mutation,
- do not merge API entity,
- add audit/DB safeguards,
- add integration test for collection replacement.

### 23.3 Missing update

Symptoms:

- user changed data but DB unchanged,
- no update SQL emitted.

Likely causes:

- detached entity modified outside transaction,
- field/property access mismatch,
- mutable value not tracked,
- transaction rolled back silently,
- bulk update bypass expectations.

Fix pattern:

- mutate managed entity inside transaction,
- check access strategy,
- replace mutable value object rather than mutate hidden internals,
- verify transaction boundary.

### 23.4 Stale overwrite

Symptoms:

- officer B overwrites officer A decision,
- no conflict shown.

Likely causes:

- no `@Version`,
- detached merge without expected version,
- bulk update bypasses version,
- last-write-wins repository save.

Fix pattern:

- add version,
- command DTO includes expected version,
- avoid merge for business updates,
- use optimistic lock tests.

### 23.5 Deadlock

Symptoms:

- intermittent DB deadlocks,
- retry succeeds,
- occurs under concurrent approval/escalation.

Likely causes:

- inconsistent lock order,
- long transaction,
- batch locks many rows,
- missing index causing range/table locks,
- parent/child update ordering conflict.

Fix pattern:

- deterministic lock order,
- shorter transactions,
- smaller chunks,
- proper indexes,
- retry only for safe idempotent commands.

### 23.6 Audit gap

Symptoms:

- status changed but no audit event,
- regulator asks why and system cannot explain.

Likely causes:

- update done via bulk/native query,
- listener failed/missing context,
- audit not part of same transaction,
- no domain event for transition.

Fix pattern:

- explicit event writing inside command transaction,
- restrict bulk update path,
- require actor/correlation context,
- audit reconciliation job.

---

## 24. Provider-Specific Decision Table

| Concern | Portable JPA Approach | Hibernate Option | EclipseLink Option | Design Guidance |
|---|---|---|---|---|
| Basic entity mapping | JPA annotations | Hibernate annotations when needed | EclipseLink extensions when needed | Start portable, extend intentionally |
| Fetch plan | LAZY + JPQL/entity graph | batch/subselect/fetch profiles | batch reading/fetch groups | Choose per use case |
| Dirty tracking | Provider default | bytecode enhancement | weaving/change tracking | Enable only with build/test discipline |
| Bulk processing | JPQL bulk/native SQL | StatelessSession, JDBC batching | batch writing | Avoid huge persistence context |
| Cache | JPA cache hints | L2/query/natural-id cache | shared/query cache | Cache mostly reference data |
| Multi-tenancy | App predicates | filters/multi-tenancy | multitenant annotations | Do not rely on ORM-only security |
| Auditing | lifecycle callbacks | event listeners/Envers | descriptors/events | Use explicit domain audit for critical events |
| SQL inspection | logging | StatementInspector/statistics | profiler/logging | Correlate request to SQL |

---

## 25. Testing Strategy for the Capstone

### 25.1 Mapping correctness tests

Test:

- enum string mapping,
- ID immutability,
- version increment,
- unique constraints,
- document version uniqueness,
- transition insert immutability,
- LOB behavior if used.

### 25.2 Query shape tests

Test:

- worklist SQL count,
- case detail SQL count,
- timeline pagination,
- no lazy load during serialization,
- no multiple collection join explosion.

### 25.3 Concurrency tests

Test:

- two users update same case,
- assignment vs transition conflict,
- approval finalization under race,
- batch escalation vs manual close,
- document version concurrent upload.

### 25.4 Migration tests

Test:

- schema validation,
- old data backfill,
- query plan after index changes,
- rollback/forward compatibility,
- Javax/Jakarta provider upgrade if applicable.

### 25.5 Use real database

For complex persistence behavior, avoid relying only on H2/in-memory DB.

Use production-like database via Testcontainers or equivalent environment because:

- dialect matters,
- locking differs,
- pagination differs,
- LOB differs,
- timestamp precision differs,
- constraints/indexes differ,
- deadlock behavior differs.

---

## 26. Reference Architecture

```text
API Layer
  REST/GraphQL/Message Consumer
  Request DTO
  Authentication context
  Correlation ID

Application Service Layer
  Command services
  Query services
  Authorization policy
  Transaction boundary
  Idempotency

Domain Layer
  Aggregate roots
  Value objects
  Transition policies
  Domain events
  Invariant checks

Persistence Layer
  Command repositories
  Query repositories
  ORM mappings
  Native SQL/read models where justified
  Outbox repository

Database Layer
  Current state tables
  Immutable history/event tables
  Reference tables
  Outbox table
  Indexes/constraints
  Archive partitions/tables

Integration Layer
  Outbox worker
  Email/document/external system clients
  Retry and dead-letter

Observability Layer
  Metrics
  Logs
  Traces
  SQL statistics
  Audit correlation
```

---

## 27. End-to-End Flow Example: Approve Case

### 27.1 Command

```java
public record ApproveCaseCommand(
    UUID caseId,
    String approvalComment,
    long expectedVersion,
    String correlationId
) {}
```

### 27.2 Service

```java
@Transactional
public void approve(ApproveCaseCommand command, Actor actor) {
    CaseRecord c = caseRecords.findByIdForUpdate(command.caseId())
        .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

    if (c.version() != command.expectedVersion()) {
        throw new OptimisticConflictException();
    }

    authorization.requireCanApprove(actor, c);

    CaseTransition transition = c.transitionTo(
        CaseStatus.APPROVED,
        actor,
        command.approvalComment(),
        clock
    );

    transitions.save(transition);

    approvalProcesses.recordDecision(c.id(), actor.id(), command.approvalComment(), clock.instant());

    CaseEvent event = CaseEvent.approved(
        UUID.randomUUID(),
        c.id(),
        actor.id(),
        command.correlationId(),
        clock.instant()
    );
    events.save(event);

    outbox.save(OutboxMessage.fromEvent(event));
}
```

### 27.3 Expected persistence effects

```text
case_record
  status changes RECOMMENDED -> APPROVED
  version increments
  updated_at changes

case_state_transition
  append row

approval_step / approval_process
  decision recorded

case_event
  append business event

outbox_message
  append integration event
```

### 27.4 What must not happen

```text
No document collection loaded.
No correspondence collection loaded.
No audit history loaded.
No external email call inside transaction.
No detached merge.
No cross-aggregate cascade delete.
```

---

## 28. Review Checklist: Production-Grade Persistence Layer

### 28.1 Entity design

- [ ] Aggregate roots are explicit.
- [ ] Mutable roots have `@Version`.
- [ ] Shared/reference data is not cascade-removed.
- [ ] History/audit/event rows are append-only.
- [ ] Large payloads are separated from frequently loaded roots.
- [ ] Enum mapping avoids ordinal corruption.
- [ ] Temporal mapping uses consistent timezone policy.

### 28.2 Association design

- [ ] Ownership is understood.
- [ ] Bidirectional helper methods maintain both sides.
- [ ] Cascades do not cross aggregate boundary.
- [ ] Collections are not blindly exposed to API.
- [ ] Large collections are paginated/query-based.

### 28.3 Query design

- [ ] Worklists use projection/read model.
- [ ] Detail pages have explicit fetch plan.
- [ ] Timeline/history is paginated.
- [ ] SQL count is bounded.
- [ ] Indexes match query predicates/order.
- [ ] Native queries include tenant/security predicates.

### 28.4 Transaction design

- [ ] One command has clear transaction boundary.
- [ ] External calls use outbox or safe after-commit strategy.
- [ ] Long-running batch uses chunks.
- [ ] Lock order is deterministic.
- [ ] Retry is idempotent.

### 28.5 Audit/security

- [ ] Business event audit exists for critical transitions.
- [ ] Actor, role, reason, timestamp, correlation ID are captured.
- [ ] Bulk/native updates are controlled and audited.
- [ ] Tenant/security boundaries are tested.
- [ ] Cache does not leak tenant/security data.

### 28.6 Operations

- [ ] SQL logging is safe and usable.
- [ ] Metrics expose ORM and DB pressure.
- [ ] Slow query diagnosis connects request to SQL.
- [ ] Migration process is controlled.
- [ ] Production failure playbook exists.

---

## 29. Anti-Patterns to Ban

### 29.1 Entity as API contract

```text
Entity in request/response body.
```

Ban because it leaks persistence model, triggers lazy loading, enables mass assignment, and encourages detached merge.

### 29.2 Cascade all everywhere

```java
cascade = CascadeType.ALL
```

Ban as default. Allow only inside true aggregate boundary.

### 29.3 EAGER by habit

```java
@ManyToOne(fetch = FetchType.EAGER)
```

Ban as default. Fetch intentionally.

### 29.4 Repository save as business operation

```java
caseRepository.save(caseRecord)
```

Ban for complex commands unless wrapped in command method enforcing invariant/audit/security.

### 29.5 One entity graph for everything

Ban because command, listing, detail, timeline, report, and export have different data shapes.

### 29.6 Bulk update without audit plan

Ban because bulk operations bypass entity lifecycle, versioning expectations, and domain event logic.

---

## 30. Mental Model Summary

The top-level model:

```text
ORM is a state synchronization engine.
It synchronizes a managed object graph with relational state through a persistence context.
```

For complex case management, this means:

```text
Do not let the object graph define the business boundary accidentally.
Choose aggregate boundaries deliberately.
Use entity mutation for commands.
Use projection/read models for queries.
Use immutable event/history for defensibility.
Use optimistic locking for current state.
Use explicit transaction boundaries.
Use outbox for integration.
Use batch chunks for volume.
Use provider-specific features intentionally.
Measure SQL, flush, cache, lock, and memory behavior.
```

The most important engineering shift:

```text
From “How do I map this table?”
To “What state must remain correct under concurrency, history, audit, migration, and operational load?”
```

---

## 31. Final Top 1% Persistence Engineer Checklist

A strong persistence engineer can:

1. Explain the difference between entity identity, database identity, persistence context identity, and business identity.
2. Predict when flush will happen and what SQL it may emit.
3. Read generated SQL and map it back to entity mapping/fetch plan.
4. Detect N+1 and avoid replacing it with cartesian explosion.
5. Design aggregate boundaries that prevent cascade and merge disasters.
6. Use DTO/read model boundaries without turning the system into an anemic mess.
7. Choose optimistic vs pessimistic locking based on conflict model.
8. Design audit/event history that can survive regulatory scrutiny.
9. Keep batch jobs from destroying memory, locks, and transaction logs.
10. Use second-level cache only when correctness is clear.
11. Migrate provider/version/schema with regression strategy.
12. Diagnose production symptoms from endpoint to ORM to SQL to DB wait.
13. Know when to leave ORM and use native SQL/read model/ETL.
14. Understand provider-specific behavior enough to use it safely.
15. Treat persistence as a correctness boundary, not a convenience layer.

---

## 32. Series Completion

This is the final part of the series:

`learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`

Parts completed:

0. Orientation: ORM as State Synchronization Engine
1. JPA Specification vs Provider Reality
2. Persistence Unit, Bootstrap, Metadata, and Provider Initialization
3. Entity Identity
4. Persistence Context
5. Dirty Checking
6. Flush Semantics
7. SQL Generation and Dialect
8. Mapping Strategy
9. Association Mapping
10. Collection Mapping
11. Cascades and Orphan Removal
12. Inheritance Mapping
13. Embeddables, Value Objects, and Type Systems
14. Fetching Mental Model
15. N+1 and Fetch Plan Engineering
16. JPQL/HQL/Criteria/Native Query
17. Bulk Operations and Batching
18. Transaction Integration
19. Concurrency Control
20. Merge, Detach, DTO Boundary
21. Second-Level Cache and Query Cache
22. Schema Generation and Migration
23. Provider Enhancement and Weaving
24. Hibernate ORM Deep Dive
25. EclipseLink Deep Dive
26. Hibernate vs EclipseLink
27. Observability
28. Performance Engineering
29. Domain Modeling with ORM
30. Multi-Tenancy and Data Leakage Prevention
31. Testing ORM Correctness
32. Migration Engineering
33. Production Failure Playbook
34. Capstone Production-Grade Persistence Layer

The series is now complete.

---

## References

- Jakarta Persistence 3.2 Specification — official Jakarta EE specification for Java persistence and object/relational mapping.
- Hibernate ORM User Guide — official Hibernate documentation covering architecture, mapping, fetching, batching, caching, events, and provider-specific behavior.
- EclipseLink Documentation — official EclipseLink documentation covering sessions, descriptors, weaving, cache, query hints, and JPA extensions.
- Hibernate ORM release documentation — official source for stable/development version context and migration guides.
- EclipseLink release documentation — official source for Jakarta Persistence 3.2 / Jakarta EE 11 modernization context.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 33 — Production Failure Playbook: Symptoms, Root Causes, and Fix Patterns](./33-production-failure-playbook-symptoms-root-causes-fix-patterns.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 0 — Orientation: Database Change as Engineering Discipline](../migration/00-orientation-database-change-engineering.md)

</div>