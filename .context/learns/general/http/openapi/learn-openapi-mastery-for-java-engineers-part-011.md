# OpenAPI Mastery for Java Engineers — Part 011
# Modelling Domain Resources Without Leaking Persistence Models

> Filename: `learn-openapi-mastery-for-java-engineers-part-011.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `011 / 030`  
> Previous: `Part 010 — JSON Schema Composition: allOf, oneOf, anyOf, not, Discriminators, and Polymorphism`  
> Next: `Part 012 — API Design with OpenAPI: Design-First, Code-First, Contract-First, and Hybrid Workflows`

---

## 0. Why This Part Matters

Banyak tim Java gagal memakai OpenAPI dengan benar bukan karena tidak paham syntax OpenAPI, tetapi karena mereka salah menentukan **apa yang sedang dimodelkan**.

Mereka menulis schema OpenAPI dari:

- JPA entity,
- database table,
- internal DTO,
- Lombok class,
- generated projection,
- response object yang kebetulan sedang dipakai controller,
- atau object hasil copy-paste dari implementation.

Hasilnya kelihatan “berfungsi” di Swagger UI, tetapi kontraknya rapuh:

- field internal ikut bocor,
- struktur response berubah ketika refactor database,
- consumer bergantung pada detail yang tidak pernah dimaksudkan sebagai public API,
- breaking change terjadi tanpa disadari,
- security/privacy risk meningkat,
- contract sulit berkembang,
- OpenAPI menjadi dokumentasi implementation, bukan interface design.

Part ini membangun mental model yang sangat penting:

> **API resource model adalah model komunikasi antara provider dan consumer. Ia bukan model database, bukan model domain internal, dan bukan model UI.**

Untuk Java engineer, ini berarti OpenAPI harus diposisikan sebagai **boundary artifact**, bukan hasil samping dari class yang sudah ada.

---

## 1. Core Mental Model

Dalam sistem backend serius, biasanya ada beberapa model yang hidup bersamaan.

```text
External Consumer
      |
      v
API Contract Model        <-- OpenAPI schema lives here
      |
      v
API DTO / Boundary Model
      |
      v
Application Command / Query Model
      |
      v
Domain Model
      |
      v
Persistence Model
      |
      v
Database Schema
```

Model-model ini boleh mirip, tetapi tidak boleh dianggap sama.

### 1.1 API Contract Model

Ini adalah bentuk data yang dijanjikan kepada consumer.

Karakteristiknya:

- stabil,
- eksplisit,
- consumer-oriented,
- backward-compatible,
- documented,
- reviewable,
- testable,
- versioned,
- aman dari internal leakage.

OpenAPI mendeskripsikan layer ini.

### 1.2 API DTO / Boundary Model

Ini object yang dipakai implementation untuk menerima request atau mengirim response.

Di Java, biasanya berupa:

- record,
- class,
- generated model,
- manual DTO,
- request object,
- response object.

Boundary DTO boleh sangat dekat dengan OpenAPI schema, tetapi tetap bagian dari implementation.

### 1.3 Application Command / Query Model

Ini model use case internal.

Contoh:

```java
public record SubmitInvestigationCommand(
    CaseId caseId,
    InvestigatorId submittedBy,
    SubmissionNote note,
    Instant submittedAt
) {}
```

Command ini tidak harus sama dengan request body public.

Request body mungkin hanya:

```json
{
  "note": "Ready for supervisory review"
}
```

`caseId`, `submittedBy`, dan `submittedAt` bisa berasal dari path, authentication context, dan server clock.

### 1.4 Domain Model

Ini model business rule.

Contoh:

```java
public final class EnforcementCase {
    private CaseId id;
    private CaseStatus status;
    private List<Allegation> allegations;
    private AuditTrail auditTrail;

    public void submitForReview(Investigator investigator, SubmissionNote note) {
        // invariant checks
    }
}
```

Domain model punya invariant. Ia tidak wajib nyaman untuk consumer.

### 1.5 Persistence Model

Ini model penyimpanan.

Contoh:

- JPA entity,
- database row,
- MongoDB document,
- Elasticsearch document,
- projection table,
- materialized view.

Persistence model tunduk pada query performance, indexing, normalization/denormalization, migration, caching, dan storage constraints.

### 1.6 Database Schema

Ini bentuk fisik data.

Database schema bisa berubah karena:

- index optimization,
- normalization,
- sharding,
- partitioning,
- migration,
- audit table redesign,
- read model split,
- archival strategy.

Consumer API seharusnya tidak ikut rusak hanya karena struktur database berubah.

---

## 2. The Most Important Rule

> **Never expose persistence shape accidentally. Only expose contract shape intentionally.**

Bukan berarti API tidak boleh mirip database. Kadang memang wajar ada kemiripan. Tetapi kemiripan itu harus hasil desain, bukan kebocoran.

### Bad Reason

```text
Field ini ada di response karena field ini ada di table.
```

### Better Reason

```text
Field ini ada di response karena consumer butuh informasi ini untuk membuat keputusan, dan kita bersedia mempertahankan semantik field ini sebagai kontrak jangka panjang.
```

Perbedaan ini besar.

Field database adalah implementation detail. Field API adalah promise.

---

## 3. Resource Model vs Entity Model

Dalam API design, istilah “resource” sering disalahpahami.

Resource bukan selalu table. Resource adalah konsep yang consumer kenali dan interaksikan melalui API.

Contoh domain enforcement lifecycle:

| API Resource | Bisa berasal dari | Consumer meaning |
|---|---|---|
| `Case` | beberapa table case, subject, status, assignment | unit kerja enforcement |
| `EvidenceFile` | object storage + metadata table + access policy | bukti yang bisa diajukan/dilihat |
| `Allegation` | allegation table + legal taxonomy | dugaan pelanggaran |
| `Finding` | decision table + reviewer notes | hasil penilaian formal |
| `EnforcementAction` | action table + workflow state | tindakan regulator |
| `Appeal` | appeal workflow + documents | proses keberatan/banding |

Satu resource API bisa berasal dari banyak entity. Satu entity bisa muncul dalam beberapa resource representation.

---

## 4. Example: Bad Entity-Leaking API

Misalkan kita punya JPA entity:

```java
@Entity
@Table(name = "enforcement_case")
public class EnforcementCaseEntity {
    @Id
    private UUID id;

    @Column(name = "case_no")
    private String caseNo;

    @Column(name = "internal_status_code")
    private String internalStatusCode;

    @Column(name = "created_by_user_id")
    private UUID createdByUserId;

    @Column(name = "assigned_team_id")
    private UUID assignedTeamId;

    @Column(name = "risk_score")
    private BigDecimal riskScore;

    @Column(name = "risk_score_model_version")
    private String riskScoreModelVersion;

    @Column(name = "deleted")
    private boolean deleted;

    @Column(name = "version")
    private long version;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    // getters/setters omitted
}
```

Lalu controller mengembalikan entity langsung:

```java
@GetMapping("/cases/{id}")
public EnforcementCaseEntity getCase(@PathVariable UUID id) {
    return repository.findById(id).orElseThrow();
}
```

Generated OpenAPI bisa menjadi seperti ini:

```yaml
EnforcementCaseEntity:
  type: object
  properties:
    id:
      type: string
      format: uuid
    caseNo:
      type: string
    internalStatusCode:
      type: string
    createdByUserId:
      type: string
      format: uuid
    assignedTeamId:
      type: string
      format: uuid
    riskScore:
      type: number
    riskScoreModelVersion:
      type: string
    deleted:
      type: boolean
    version:
      type: integer
      format: int64
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time
```

Ini tampak lengkap. Tetapi secara contract design, ini buruk.

Masalahnya:

1. `internalStatusCode` membocorkan internal workflow code.
2. `createdByUserId` mungkin tidak meaningful bagi external consumer.
3. `assignedTeamId` bisa membocorkan internal organization structure.
4. `riskScore` mungkin sensitive.
5. `riskScoreModelVersion` membocorkan model internal.
6. `deleted` adalah persistence concern.
7. `version` belum jelas apakah untuk optimistic concurrency, entity version, atau internal locking.
8. Naming `caseNo` mengikuti database/Java style, bukan contract vocabulary.
9. Semua field terlihat seakan-akan didukung sebagai public contract.
10. Refactor internal bisa menjadi breaking change external.

---

## 5. Better API Contract Model

Kita desain response berdasarkan consumer needs.

```yaml
CaseDetail:
  type: object
  required:
    - id
    - caseNumber
    - status
    - openedAt
    - links
  properties:
    id:
      type: string
      format: uuid
      description: Stable unique identifier of the case.
    caseNumber:
      type: string
      description: Human-readable case number used in correspondence.
      example: "CASE-2026-000184"
    status:
      $ref: '#/components/schemas/CaseStatus'
    priority:
      $ref: '#/components/schemas/CasePriority'
    summary:
      type: string
      maxLength: 500
      description: External-safe summary of the case.
    openedAt:
      type: string
      format: date-time
    lastUpdatedAt:
      type: string
      format: date-time
    assignedUnit:
      $ref: '#/components/schemas/PublicOrganizationalUnit'
    links:
      $ref: '#/components/schemas/CaseLinks'
```

Status schema:

```yaml
CaseStatus:
  type: string
  description: Public lifecycle status of the case.
  enum:
    - intake
    - under_review
    - investigation
    - decision_pending
    - action_issued
    - closed
```

Notice beberapa hal:

- `internalStatusCode` tidak dibocorkan.
- Public status vocabulary dibuat eksplisit.
- `riskScore` tidak otomatis muncul.
- `deleted` tidak muncul; deleted resource bisa dimodelkan dengan `404`, `410`, atau lifecycle status tergantung kebutuhan.
- `version` hanya muncul jika memang ada concurrency contract.
- `assignedUnit` bisa dibuat aman dan consumer-facing.
- `summary` punya constraint.
- `links` membantu consumer menemukan related operations.

---

## 6. The API Contract Question Set

Sebelum memasukkan field ke OpenAPI schema, tanya:

1. **Consumer need**: siapa yang membutuhkan field ini?
2. **Decision use**: keputusan apa yang dibuat consumer dengan field ini?
3. **Stability**: apakah kita sanggup mempertahankan semantik field ini?
4. **Security**: apakah field ini mengandung sensitive/internal information?
5. **Privacy**: apakah field ini termasuk personal data atau data rahasia?
6. **Authorization**: apakah semua consumer operation ini boleh melihat field ini?
7. **Lifecycle**: kapan field ini tersedia?
8. **Nullability**: apakah field ini bisa absent/null? Apa artinya?
9. **Source**: apakah field ini berasal dari user input, system-generated, derived, atau external system?
10. **Evolution**: bagaimana field ini akan berubah di masa depan?
11. **Compatibility**: apakah perubahan field ini akan merusak generated clients?
12. **Testing**: bagaimana kita memvalidasi field ini benar?
13. **Audit**: apakah field ini perlu traceability?
14. **Naming**: apakah namanya domain-facing atau implementation-facing?
15. **Removal**: jika field ini kelak harus dihapus, seberapa mahal migrasinya?

Kalau jawaban tidak jelas, field itu belum siap masuk kontrak.

---

## 7. API DTO Is Not Automatically Contract

Banyak Java engineer berpikir:

```text
Saya sudah punya DTO, berarti sudah aman untuk OpenAPI.
```

Tidak selalu.

DTO bisa berarti banyak hal:

- controller request DTO,
- controller response DTO,
- internal service DTO,
- persistence projection DTO,
- integration DTO,
- messaging DTO,
- generated OpenAPI model,
- frontend BFF DTO.

Nama DTO tidak memberi jaminan contract quality.

### 7.1 Bad DTO Example

```java
public record CaseDto(
    UUID id,
    String caseNo,
    String statusCd,
    String assignedTeam,
    BigDecimal score,
    Boolean deleted,
    Long version
) {}
```

Masalah:

- `caseNo` abbreviation tidak jelas.
- `statusCd` internal naming.
- `score` score apa?
- `deleted` persistence state.
- `version` ambiguous.

### 7.2 Better Boundary DTO

```java
public record CaseDetailResponse(
    UUID id,
    String caseNumber,
    CaseStatusResponse status,
    CasePriorityResponse priority,
    String summary,
    Instant openedAt,
    Instant lastUpdatedAt,
    PublicOrganizationalUnitResponse assignedUnit,
    CaseLinksResponse links
) {}
```

Lebih baik karena:

- role response jelas,
- vocabulary public,
- field names meaningful,
- tidak memuat persistence flag,
- tidak expose risk model internal.

Tetapi bahkan DTO ini tetap harus direview terhadap OpenAPI schema.

---

## 8. Request Model vs Response Model

Salah satu kesalahan paling umum adalah memakai schema yang sama untuk create request, update request, dan response.

### 8.1 Bad Reuse

```yaml
Case:
  type: object
  properties:
    id:
      type: string
      format: uuid
    caseNumber:
      type: string
    status:
      type: string
    summary:
      type: string
    openedAt:
      type: string
      format: date-time
    createdBy:
      type: string
```

Lalu dipakai untuk:

```yaml
requestBody:
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/Case'
```

Masalah:

- Bolehkah client mengirim `id`?
- Bolehkah client menentukan `caseNumber`?
- Bolehkah client menentukan `status`?
- Bolehkah client menentukan `openedAt`?
- Apakah `createdBy` dari request atau authentication context?

### 8.2 Better Split

```yaml
CreateCaseRequest:
  type: object
  required:
    - summary
    - intakeSource
  properties:
    summary:
      type: string
      minLength: 1
      maxLength: 500
    intakeSource:
      $ref: '#/components/schemas/IntakeSource'
    subjectIds:
      type: array
      items:
        type: string
        format: uuid
      minItems: 1

CaseDetail:
  type: object
  required:
    - id
    - caseNumber
    - status
    - openedAt
  properties:
    id:
      type: string
      format: uuid
    caseNumber:
      type: string
    status:
      $ref: '#/components/schemas/CaseStatus'
    summary:
      type: string
    intakeSource:
      $ref: '#/components/schemas/IntakeSource'
    openedAt:
      type: string
      format: date-time
    createdBy:
      $ref: '#/components/schemas/UserSummary'
```

Create request berisi input consumer. Response berisi representasi resource setelah server memprosesnya.

---

## 9. Resource Representations: Summary, Detail, Collection, Embedded

Satu resource sering punya banyak representation.

Contoh `Case`:

```text
CaseSummary       -> list/search result
CaseDetail        -> detail page / detail API
CaseReference     -> embedded inside another resource
CaseTimelineItem  -> timeline projection
CaseAuditView     -> audit endpoint
CaseExportView    -> export/reporting endpoint
```

Jangan memaksakan satu schema `Case` untuk semua.

### 9.1 CaseSummary

```yaml
CaseSummary:
  type: object
  required:
    - id
    - caseNumber
    - status
  properties:
    id:
      type: string
      format: uuid
    caseNumber:
      type: string
    status:
      $ref: '#/components/schemas/CaseStatus'
    title:
      type: string
    priority:
      $ref: '#/components/schemas/CasePriority'
    lastUpdatedAt:
      type: string
      format: date-time
```

### 9.2 CaseDetail

```yaml
CaseDetail:
  type: object
  required:
    - id
    - caseNumber
    - status
    - openedAt
  properties:
    id:
      type: string
      format: uuid
    caseNumber:
      type: string
    status:
      $ref: '#/components/schemas/CaseStatus'
    title:
      type: string
    summary:
      type: string
    priority:
      $ref: '#/components/schemas/CasePriority'
    openedAt:
      type: string
      format: date-time
    lastUpdatedAt:
      type: string
      format: date-time
    subjects:
      type: array
      items:
        $ref: '#/components/schemas/SubjectSummary'
    allegations:
      type: array
      items:
        $ref: '#/components/schemas/AllegationSummary'
```

### 9.3 CaseReference

```yaml
CaseReference:
  type: object
  required:
    - id
    - caseNumber
  properties:
    id:
      type: string
      format: uuid
    caseNumber:
      type: string
    displayName:
      type: string
```

### 9.4 Why This Matters

Different representations optimize for different jobs:

| Representation | Consumer job | Design priority |
|---|---|---|
| Summary | scan/list/search | compact, stable, sortable |
| Detail | inspect full resource | complete, navigable |
| Reference | identify related resource | minimal, embedded-safe |
| Audit | reconstruct history | traceable, immutable |
| Export | offline/reporting | completeness, stable columns |

One schema cannot optimize all of these well.

---

## 10. Embedded Object vs Referenced ID

A common design choice:

```json
{
  "subjectId": "4e40e1e7-7b60-4fc1-985b-b677b1b4c029"
}
```

vs

```json
{
  "subject": {
    "id": "4e40e1e7-7b60-4fc1-985b-b677b1b4c029",
    "displayName": "Acme Finance Ltd",
    "type": "organization"
  }
}
```

Neither is universally correct.

### 10.1 Use ID Reference When

- Consumer only needs identity.
- Related resource is large.
- Related resource changes frequently.
- Consumer can fetch it separately.
- Authorization differs.
- Embedding would create stale or inconsistent data.

### 10.2 Use Embedded Summary When

- Consumer almost always needs display data.
- Avoiding extra round trips matters.
- Embedded fields are stable and safe.
- Authorization is same or already filtered.
- The embedded object is clearly a summary, not full detail.

### 10.3 Use Link When

- Consumer may navigate conditionally.
- Operation availability depends on state/permission.
- You want loose coupling.

```yaml
CaseLinks:
  type: object
  properties:
    self:
      type: string
      format: uri
    evidence:
      type: string
      format: uri
    submitForReview:
      type: string
      format: uri
      description: Present only when the case can be submitted for review by the current caller.
```

### 10.4 Avoid Ambiguous Embedding

Bad:

```yaml
subject:
  $ref: '#/components/schemas/Subject'
```

If `Subject` is huge, sensitive, or unstable, this creates coupling.

Better:

```yaml
subject:
  $ref: '#/components/schemas/SubjectSummary'
```

or:

```yaml
subjectRef:
  $ref: '#/components/schemas/SubjectReference'
```

---

## 11. Stable Identifiers

Identifier design is contract design.

### 11.1 Internal ID vs Public ID

Internal database ID:

```text
123456789
```

Public stable ID:

```text
8b7f2f9a-1eb3-4f9a-8b39-0d8f5ab6d91f
```

Human-readable number:

```text
CASE-2026-000184
```

Each serves a different purpose.

| Identifier | Good for | Risk |
|---|---|---|
| Sequential DB ID | internal joins | enumeration, coupling, migration issue |
| UUID/ULID | stable external identity | less human-friendly |
| Human-readable number | correspondence | may encode business meaning accidentally |
| Slug | readable URLs | rename/uniqueness issues |
| Composite natural key | domain clarity | difficult evolution |

### 11.2 Recommended Pattern

For serious APIs:

```yaml
CaseDetail:
  type: object
  required:
    - id
    - caseNumber
  properties:
    id:
      type: string
      format: uuid
      description: Stable machine identifier.
    caseNumber:
      type: string
      description: Stable human-readable reference number.
      example: "CASE-2026-000184"
```

Use `id` for API operations. Use `caseNumber` for display/search/correspondence.

### 11.3 Do Not Encode Too Much Meaning

Bad:

```text
ENF-JKT-HIGH-AML-2026-000184
```

This exposes:

- location,
- priority,
- category,
- year,
- sequence.

If any of those changes, identifier semantics become awkward.

Better: keep ID stable and represent changing classification as fields.

---

## 12. Resource Lifecycle State

Many domains have lifecycle states.

Example:

```text
intake -> screening -> investigation -> review -> decision -> action -> closed
```

OpenAPI should expose lifecycle state carefully.

### 12.1 Internal State vs Public State

Internal state machine might be:

```text
INTAKE_DRAFT
INTAKE_SUBMITTED
SCREENING_PENDING_ASSIGNMENT
SCREENING_ASSIGNED
SCREENING_IN_PROGRESS
SCREENING_QA_REJECTED
INVESTIGATION_PENDING_SUPERVISOR
INVESTIGATION_REOPENED
LEGAL_REVIEW_PENDING
DECISION_COMMITTEE_SCHEDULED
DECISION_APPROVED
ENFORCEMENT_NOTICE_DRAFTED
ENFORCEMENT_NOTICE_SERVED
CLOSED_NO_ACTION
CLOSED_ACTION_COMPLETED
```

Public API status might be:

```yaml
CaseStatus:
  type: string
  enum:
    - intake
    - under_review
    - investigation
    - decision_pending
    - action_issued
    - closed
```

Public status is a semantic contract. Internal state can be more granular.

### 12.2 Why Not Expose All Internal States?

Because:

- internal workflow may change,
- some states are operational noise,
- states may reveal internal process,
- consumers may build brittle logic,
- renaming/refactoring becomes breaking change,
- permission-sensitive states may leak.

### 12.3 When to Expose More Granularity

Expose granular state when:

- consumer has legitimate workflow dependency,
- state affects allowed actions,
- state affects deadlines,
- state affects legal rights,
- state appears in official communication,
- state must be auditable.

### 12.4 Represent Available Actions Separately

Do not force consumers to infer actions only from status.

```yaml
CaseDetail:
  type: object
  properties:
    status:
      $ref: '#/components/schemas/CaseStatus'
    availableActions:
      type: array
      items:
        $ref: '#/components/schemas/CaseAction'

CaseAction:
  type: string
  enum:
    - add_evidence
    - submit_for_review
    - approve_closure
    - reopen
    - issue_notice
```

This avoids brittle client-side state machine duplication.

---

## 13. Field Visibility: Internal, External, Derived, Write-Only, Read-Only

Every field has a visibility role.

### 13.1 Internal Field

Used by backend only.

Examples:

- fraud model score,
- reviewer assignment algorithm version,
- shard key,
- soft delete flag,
- ingestion batch ID,
- database version.

Should usually not appear in public API.

### 13.2 External Field

Intended for consumer.

Examples:

- case number,
- public status,
- submission deadline,
- display name,
- decision date.

Should be documented clearly.

### 13.3 Derived Field

Computed from other data.

Example:

```yaml
isOverdue:
  type: boolean
  readOnly: true
  description: Indicates whether the case has passed its current response deadline.
```

Derived fields are useful, but require clear semantics:

- computed at what time?
- based on which timezone?
- affected by permissions?
- stale or real-time?

### 13.4 Write-Only Field

Example:

```yaml
CreateApiCredentialRequest:
  type: object
  required:
    - displayName
  properties:
    displayName:
      type: string
    secret:
      type: string
      writeOnly: true
      description: Optional caller-provided secret. It is never returned.
```

### 13.5 Read-Only Field

Example:

```yaml
createdAt:
  type: string
  format: date-time
  readOnly: true
```

Important: `readOnly` and `writeOnly` are contract annotations. Your implementation must enforce them.

---

## 14. Server-Generated Fields

Server-generated fields include:

- ID,
- case number,
- timestamps,
- status,
- audit metadata,
- createdBy,
- updatedBy,
- version token,
- links.

Do not put them casually in request schema.

### 14.1 Bad

```yaml
CreateCaseRequest:
  type: object
  properties:
    id:
      type: string
      format: uuid
    caseNumber:
      type: string
    createdAt:
      type: string
      format: date-time
    createdBy:
      type: string
```

This implies caller may provide these values.

### 14.2 Better

```yaml
CreateCaseRequest:
  type: object
  required:
    - summary
    - intakeSource
  properties:
    summary:
      type: string
    intakeSource:
      $ref: '#/components/schemas/IntakeSource'
```

Response:

```yaml
CreateCaseResponse:
  type: object
  required:
    - id
    - caseNumber
    - status
    - createdAt
  properties:
    id:
      type: string
      format: uuid
    caseNumber:
      type: string
    status:
      $ref: '#/components/schemas/CaseStatus'
    createdAt:
      type: string
      format: date-time
```

---

## 15. Optimistic Concurrency Fields

In many Java/database systems, JPA has a `@Version` field.

Bad assumption:

```text
We have entity.version, so expose version in API.
```

Maybe. But only if it is part of API concurrency contract.

### 15.1 Internal Version

```java
@Version
private long version;
```

This may be persistence-specific.

### 15.2 API Concurrency Contract Options

#### Option A: ETag Header

```yaml
responses:
  '200':
    description: Case detail.
    headers:
      ETag:
        description: Entity tag used for optimistic concurrency.
        schema:
          type: string
```

Update:

```yaml
parameters:
  - name: If-Match
    in: header
    required: true
    schema:
      type: string
```

#### Option B: Version Field

```yaml
CaseDetail:
  type: object
  required:
    - id
    - version
  properties:
    id:
      type: string
      format: uuid
    version:
      type: integer
      format: int64
      description: Version token required for optimistic concurrency updates.
```

Update request:

```yaml
UpdateCaseRequest:
  type: object
  required:
    - version
    - summary
  properties:
    version:
      type: integer
      format: int64
    summary:
      type: string
```

#### Option C: Opaque Revision Token

```yaml
revisionToken:
  type: string
  description: Opaque token required for optimistic concurrency. Clients must not interpret it.
```

### 15.3 Recommended Thinking

Expose concurrency intentionally.

Do not expose `version` because JPA happens to have one. Expose a concurrency token because consumers need safe update semantics.

---

## 16. State Transition Modelling

For workflow-heavy systems, avoid pretending every update is generic CRUD.

Bad:

```http
PATCH /cases/{caseId}
```

with body:

```json
{
  "status": "closed"
}
```

This lets consumer think state changes are field assignments.

Better:

```http
POST /cases/{caseId}/closure-requests
```

or:

```http
POST /cases/{caseId}:close
```

or:

```http
POST /cases/{caseId}/actions/close
```

depending on API style.

OpenAPI request:

```yaml
CloseCaseRequest:
  type: object
  required:
    - reason
  properties:
    reason:
      $ref: '#/components/schemas/ClosureReason'
    note:
      type: string
      maxLength: 1000
```

Response:

```yaml
CloseCaseResponse:
  type: object
  required:
    - caseId
    - status
    - closedAt
  properties:
    caseId:
      type: string
      format: uuid
    status:
      type: string
      enum:
        - closed
    closedAt:
      type: string
      format: date-time
```

### Why This Is Better

It captures business semantics:

- closing is an action,
- it has permission rules,
- it has validation rules,
- it has audit implications,
- it may fail due to state conflict,
- it may trigger downstream effects.

A state transition is not just a field update.

---

## 17. Regulatory / Case-Management Style Resource Modelling

This is especially relevant for enforcement, compliance, licensing, audit, claims, fraud, dispute, and investigation platforms.

### 17.1 Typical Resource Graph

```text
Case
 ├── Subjects
 ├── Allegations
 ├── Evidence
 ├── Assignments
 ├── Reviews
 ├── Findings
 ├── Decisions
 ├── EnforcementActions
 ├── Appeals
 ├── Deadlines
 ├── Notes
 ├── Disclosures
 └── AuditEvents
```

### 17.2 Avoid One Mega Case Object

Bad:

```yaml
Case:
  type: object
  properties:
    subjects: ...
    allegations: ...
    evidence: ...
    assignments: ...
    reviews: ...
    findings: ...
    decisions: ...
    actions: ...
    appeals: ...
    auditEvents: ...
```

Problem:

- huge response,
- mixed authorization,
- unstable shape,
- performance issue,
- privacy risk,
- consumers depend on everything,
- difficult cache behavior,
- difficult partial evolution.

Better:

```text
GET /cases/{caseId}
GET /cases/{caseId}/subjects
GET /cases/{caseId}/allegations
GET /cases/{caseId}/evidence
GET /cases/{caseId}/findings
GET /cases/{caseId}/audit-events
```

Use `CaseDetail` as entry point, not full universe.

### 17.3 Case as Aggregate Root vs API Entry Point

Domain aggregate root and API root resource can align, but do not have to.

A domain `Case` aggregate may enforce invariants. API might expose multiple subresources for usability and authorization.

Example:

```yaml
CaseDetail:
  type: object
  properties:
    id:
      type: string
      format: uuid
    caseNumber:
      type: string
    status:
      $ref: '#/components/schemas/CaseStatus'
    links:
      type: object
      properties:
        subjects:
          type: string
          format: uri
        evidence:
          type: string
          format: uri
        findings:
          type: string
          format: uri
        auditEvents:
          type: string
          format: uri
```

---

## 18. Preventing Accidental Data Exposure

OpenAPI can accidentally institutionalize a data leak.

Once a field appears in public documentation and clients use it, removing it becomes breaking.

### 18.1 Common Sensitive Fields

- internal notes,
- reviewer comments,
- risk score,
- fraud score,
- model version,
- internal user IDs,
- team IDs,
- routing queue,
- SLA breach reason,
- soft delete flag,
- investigation strategy,
- legal privilege flag,
- redaction status,
- personal identifiers,
- document storage keys,
- object storage URLs,
- internal classification labels.

### 18.2 Use Explicit Safe Views

```yaml
EvidenceFileSummary:
  type: object
  required:
    - id
    - fileName
    - contentType
    - uploadedAt
  properties:
    id:
      type: string
      format: uuid
    fileName:
      type: string
    contentType:
      type: string
    sizeBytes:
      type: integer
      format: int64
    uploadedAt:
      type: string
      format: date-time
```

Do not expose:

```yaml
storageBucket:
storageKey:
avScanInternalResult:
rawExtractedText:
privilegeReviewNotes:
```

unless intentionally required and authorized.

### 18.3 Security Review Checklist for Schemas

For every response schema:

- Are all fields allowed for this caller type?
- Could a field reveal internal workflow?
- Could a field reveal personal data?
- Could a field reveal security posture?
- Could a field reveal risk scoring?
- Could a field reveal legal strategy?
- Could a field be combined with other fields for inference?
- Is field presence itself sensitive?
- Are examples safe?
- Are error schemas safe?

---

## 19. Naming: Domain Vocabulary Beats Implementation Vocabulary

Names in OpenAPI become part of consumer mental model.

### 19.1 Bad Names

```yaml
caseNo
statusCd
usrId
assigneeGrp
updTs
riskFlg
isDel
```

These reflect database/legacy/internal abbreviation.

### 19.2 Better Names

```yaml
caseNumber
status
userId
assignedUnit
lastUpdatedAt
riskIndicator
deletedAt
```

But even `deletedAt` might not belong externally.

### 19.3 Use Consumer Language

Ask:

```text
Would an external integrator understand this field without knowing our implementation?
```

If not, rename or document.

---

## 20. Enum Design and Internal Code Mapping

Enums are dangerous when they mirror internal codes.

### 20.1 Bad

```yaml
CaseStatus:
  type: string
  enum:
    - STG_001
    - STG_002
    - STG_003
    - STG_004A
```

This leaks internal workflow code and is hard for consumers.

### 20.2 Better

```yaml
CaseStatus:
  type: string
  enum:
    - intake
    - under_review
    - investigation
    - decision_pending
    - action_issued
    - closed
```

### 20.3 Mapping Layer

Java mapping:

```java
public CaseStatusResponse toPublicStatus(InternalCaseStatus internal) {
    return switch (internal) {
        case INTAKE_DRAFT, INTAKE_SUBMITTED -> CaseStatusResponse.INTAKE;
        case SCREENING_PENDING_ASSIGNMENT,
             SCREENING_ASSIGNED,
             SCREENING_IN_PROGRESS,
             SCREENING_QA_REJECTED -> CaseStatusResponse.UNDER_REVIEW;
        case INVESTIGATION_PENDING_SUPERVISOR,
             INVESTIGATION_REOPENED -> CaseStatusResponse.INVESTIGATION;
        case LEGAL_REVIEW_PENDING,
             DECISION_COMMITTEE_SCHEDULED -> CaseStatusResponse.DECISION_PENDING;
        case ENFORCEMENT_NOTICE_DRAFTED,
             ENFORCEMENT_NOTICE_SERVED -> CaseStatusResponse.ACTION_ISSUED;
        case CLOSED_NO_ACTION,
             CLOSED_ACTION_COMPLETED -> CaseStatusResponse.CLOSED;
    };
}
```

The mapping is not noise. It protects your API from internal churn.

---

## 21. Null, Missing, Empty, Unknown

When modelling resource fields, distinguish:

| Shape | Meaning |
|---|---|
| field missing | not included / not applicable / not authorized / sparse response |
| field is `null` | known to be empty/unknown depending contract |
| empty string | usually bad unless meaningful |
| empty array | known no items |
| unknown enum value | consumer compatibility challenge |

### 21.1 Bad Ambiguity

```json
{
  "assignedUnit": null
}
```

Could mean:

- not assigned yet,
- caller not authorized,
- data migration incomplete,
- not applicable,
- system error,
- field hidden.

### 21.2 Better Modelling

Option A: explicit nullable with description.

```yaml
assignedUnit:
  oneOf:
    - $ref: '#/components/schemas/PublicOrganizationalUnit'
    - type: 'null'
  description: Null when the case has not yet been assigned.
```

Option B: separate assignment state.

```yaml
assignmentStatus:
  type: string
  enum:
    - unassigned
    - assigned

assignedUnit:
  $ref: '#/components/schemas/PublicOrganizationalUnit'
```

Option C: omit when unauthorized and document it clearly.

```yaml
assignedUnit:
  $ref: '#/components/schemas/PublicOrganizationalUnit'
  description: Present only when the caller is authorized to view assignment information.
```

Be precise. Ambiguity becomes client logic bugs.

---

## 22. Avoiding Entity Exposure in Java/Spring

### 22.1 Bad Controller

```java
@RestController
@RequestMapping("/cases")
public class CaseController {
    private final CaseRepository repository;

    @GetMapping("/{id}")
    public EnforcementCaseEntity get(@PathVariable UUID id) {
        return repository.findById(id).orElseThrow();
    }
}
```

Problems:

- persistence entity serialized directly,
- lazy loading surprises,
- Jackson annotations become API design,
- JPA changes become API changes,
- security filtering hard,
- OpenAPI generation follows wrong model.

### 22.2 Better Controller Boundary

```java
@RestController
@RequestMapping("/cases")
public class CaseController {
    private final GetCaseUseCase getCaseUseCase;
    private final CaseApiMapper mapper;

    @GetMapping("/{id}")
    public CaseDetailResponse get(@PathVariable UUID id, Authentication authentication) {
        CaseView view = getCaseUseCase.getCase(new CaseId(id), CallerContext.from(authentication));
        return mapper.toDetailResponse(view);
    }
}
```

### 22.3 Mapper

```java
@Component
public class CaseApiMapper {
    public CaseDetailResponse toDetailResponse(CaseView view) {
        return new CaseDetailResponse(
            view.id().value(),
            view.caseNumber().value(),
            toPublicStatus(view.status()),
            toPriority(view.priority()),
            view.summary(),
            view.openedAt(),
            view.lastUpdatedAt(),
            toAssignedUnit(view.assignedUnit()),
            toLinks(view)
        );
    }
}
```

This mapping layer is a contract firewall.

---

## 23. Generated OpenAPI from Java: Specific Risk

When using springdoc-openapi or Swagger annotations, generated specs can reflect Java implementation too closely.

Example:

```java
public record CaseDetailResponse(
    UUID id,
    String caseNumber,
    InternalCaseStatus status,
    BigDecimal internalRiskScore
) {}
```

If this class is returned by a controller, OpenAPI generation may expose it.

### 23.1 Annotation Does Not Fix Bad Model

You can annotate fields:

```java
@Schema(description = "Internal risk score")
private BigDecimal internalRiskScore;
```

But that documents the leak. It does not solve it.

### 23.2 Use Explicit API Models

```java
public enum CaseStatusResponse {
    INTAKE,
    UNDER_REVIEW,
    INVESTIGATION,
    DECISION_PENDING,
    ACTION_ISSUED,
    CLOSED
}
```

Then map from internal status.

---

## 24. Boundary Model Design Patterns

### 24.1 Separate Request and Response Classes

```java
public record CreateCaseRequest(...) {}
public record CaseDetailResponse(...) {}
public record UpdateCaseSummaryRequest(...) {}
public record CaseSummaryResponse(...) {}
```

Avoid one `CaseDto` for everything.

### 24.2 Use Role-Based Suffixes

Good suffixes:

- `Request`,
- `Response`,
- `Summary`,
- `Detail`,
- `Reference`,
- `Patch`,
- `Command`,
- `Result`,
- `Envelope`,
- `Error`.

Bad generic names:

- `Dto`,
- `Data`,
- `Info`,
- `Object`,
- `Payload`,
- `Common`.

Not always forbidden, but often vague.

### 24.3 Use Dedicated API Enums

```java
public enum CaseStatusResponse {
    INTAKE,
    UNDER_REVIEW,
    INVESTIGATION,
    DECISION_PENDING,
    ACTION_ISSUED,
    CLOSED
}
```

Do not expose:

```java
public enum InternalWorkflowState { ... }
```

### 24.4 Use Explicit Mappers

Mapping is where you enforce:

- visibility,
- naming,
- redaction,
- enum translation,
- derived field calculation,
- link generation,
- authorization-sensitive shaping.

---

## 25. OpenAPI Schema Design Example: Full Resource Boundary

Below is a compact but production-oriented example.

```yaml
components:
  schemas:
    CaseDetail:
      type: object
      required:
        - id
        - caseNumber
        - status
        - openedAt
        - lastUpdatedAt
        - links
      properties:
        id:
          type: string
          format: uuid
          description: Stable machine identifier of the case.
        caseNumber:
          type: string
          description: Human-readable reference number used in official correspondence.
          example: "CASE-2026-000184"
        status:
          $ref: '#/components/schemas/CaseStatus'
        priority:
          $ref: '#/components/schemas/CasePriority'
        summary:
          type: string
          maxLength: 500
          description: External-safe summary of the case.
        openedAt:
          type: string
          format: date-time
        lastUpdatedAt:
          type: string
          format: date-time
        assignedUnit:
          $ref: '#/components/schemas/PublicOrganizationalUnit'
        deadlines:
          type: array
          items:
            $ref: '#/components/schemas/CaseDeadlineSummary'
        links:
          $ref: '#/components/schemas/CaseLinks'

    CreateCaseRequest:
      type: object
      required:
        - summary
        - intakeSource
      properties:
        summary:
          type: string
          minLength: 1
          maxLength: 500
        intakeSource:
          $ref: '#/components/schemas/IntakeSource'
        subjectIds:
          type: array
          minItems: 1
          items:
            type: string
            format: uuid

    UpdateCaseSummaryRequest:
      type: object
      required:
        - summary
      properties:
        summary:
          type: string
          minLength: 1
          maxLength: 500

    CaseStatus:
      type: string
      description: Public lifecycle state of a case.
      enum:
        - intake
        - under_review
        - investigation
        - decision_pending
        - action_issued
        - closed

    CasePriority:
      type: string
      enum:
        - low
        - normal
        - high
        - urgent

    PublicOrganizationalUnit:
      type: object
      required:
        - id
        - displayName
      properties:
        id:
          type: string
          format: uuid
        displayName:
          type: string

    CaseDeadlineSummary:
      type: object
      required:
        - type
        - dueAt
      properties:
        type:
          type: string
          enum:
            - response_due
            - review_due
            - appeal_due
        dueAt:
          type: string
          format: date-time
        status:
          type: string
          enum:
            - pending
            - met
            - missed
            - cancelled

    CaseLinks:
      type: object
      required:
        - self
      properties:
        self:
          type: string
          format: uri
        subjects:
          type: string
          format: uri
        evidence:
          type: string
          format: uri
        auditEvents:
          type: string
          format: uri
        submitForReview:
          type: string
          format: uri
          description: Present only when the current caller may submit the case for review.

    IntakeSource:
      type: string
      enum:
        - public_complaint
        - supervisory_referral
        - internal_detection
        - external_agency_referral
```

Key design choices:

- Separate create/update/detail schemas.
- Public status enum, not internal workflow states.
- Summary is constrained.
- Server-generated fields only in response.
- `assignedUnit` is public-safe.
- `links` supports discoverability.
- Deadlines are summaries, not full internal scheduling records.

---

## 26. Domain Model Example Behind the API

The internal domain can be richer.

```java
public final class EnforcementCase {
    private final CaseId id;
    private final CaseNumber caseNumber;
    private InternalWorkflowState workflowState;
    private CasePriority priority;
    private CaseSummary summary;
    private Assignment assignment;
    private RiskAssessment riskAssessment;
    private List<Deadline> deadlines;
    private AuditTrail auditTrail;

    public void updateSummary(CaseSummary newSummary, User actor) {
        requireCanEdit(actor);
        this.summary = newSummary;
        this.auditTrail.recordSummaryChanged(actor, newSummary);
    }

    public void submitForReview(User actor, SubmissionNote note) {
        requireState(InternalWorkflowState.INVESTIGATION_IN_PROGRESS);
        requirePermission(actor, Permission.SUBMIT_CASE_FOR_REVIEW);
        this.workflowState = InternalWorkflowState.INVESTIGATION_PENDING_SUPERVISOR;
        this.auditTrail.recordSubmittedForReview(actor, note);
    }
}
```

This domain object contains things not in API response:

- internal workflow state,
- risk assessment,
- audit details,
- permission checks,
- internal invariants.

That is fine. API contract does not need to expose all truth.

It exposes the truth relevant to a consumer under a specific operation and authorization context.

---

## 27. Persistence Model Example Behind the API

Persistence might be very different.

```java
@Entity
@Table(name = "case_main")
class CaseEntity {
    @Id
    UUID id;

    String caseNo;
    String workflowStateCode;
    String priorityCode;
    String summaryText;
    UUID assignedTeamId;
    Instant openedAt;
    Instant updatedAt;
    boolean softDeleted;

    @Version
    long rowVersion;
}
```

Read projection might be different again:

```java
public record CaseListProjection(
    UUID id,
    String caseNo,
    String publicStatus,
    String priority,
    String title,
    Instant updatedAt
) {}
```

API response should be designed from consumer contract, then mapped from whichever internal representation is appropriate.

---

## 28. How to Decide Whether to Create a New Schema

Create a separate schema when:

1. request and response differ,
2. create and update differ,
3. list and detail differ,
4. authorization differs,
5. lifecycle stage differs,
6. field semantics differ,
7. nullability differs,
8. required fields differ,
9. consumers use it differently,
10. future evolution is likely to differ.

Reuse a schema when:

1. semantics are genuinely identical,
2. required fields are identical,
3. nullability is identical,
4. lifecycle is identical,
5. authorization visibility is identical,
6. future evolution should remain coupled.

That last condition matters.

> Reuse means you are intentionally coupling evolution.

---

## 29. Mapping OpenAPI Concepts to Java Layers

| OpenAPI concept | Java boundary equivalent | Should map to domain? | Should map to persistence? |
|---|---|---:|---:|
| Request schema | request record/class | via command mapper | no |
| Response schema | response record/class | via view/mapper | no |
| Enum schema | API enum | mapped from domain enum | no |
| Error schema | error response model | mapped from exceptions/result errors | no |
| Read-only field | response-only field | may derive from domain | no direct |
| Write-only field | request-only field | command input | no direct |
| Link schema | link builder output | often permission-aware | no |
| Version token | concurrency boundary | may map to aggregate version | maybe, but opaque preferred |

---

## 30. Common Anti-Patterns

### 30.1 Exposing JPA Entities

```java
public CaseEntity getCase(...) { ... }
```

Avoid.

### 30.2 One DTO for Everything

```java
CaseDto
```

used for create, update, response, list, export.

Avoid.

### 30.3 Internal Enum Leakage

```yaml
enum:
  - PENDING_SUPERVISOR_L2_QA_REJECTED
```

Avoid unless this is truly public domain vocabulary.

### 30.4 Boolean State Explosion

```yaml
isClosed:
  type: boolean
isSubmitted:
  type: boolean
isApproved:
  type: boolean
isRejected:
  type: boolean
isArchived:
  type: boolean
```

This creates impossible combinations.

Better use lifecycle state plus available actions.

### 30.5 Ambiguous Generic Names

```yaml
DataResponse
CommonDto
BaseResponse
Payload
ResultObject
```

Avoid unless carefully defined.

### 30.6 Exposing Soft Delete

```yaml
deleted:
  type: boolean
```

Usually persistence leakage.

Consider `410 Gone`, filtering, archive views, or explicit lifecycle state.

### 30.7 Risk Score Leakage

```yaml
riskScore:
  type: number
```

May expose internal scoring, bias-sensitive logic, or security-sensitive prioritization.

Use public risk category only if appropriate.

### 30.8 Schema Mirrors Table

If your OpenAPI schema has the same fields and names as your DB table, inspect carefully. It may be accidental coupling.

---

## 31. Practical Step-by-Step Design Method

When designing a new resource schema:

### Step 1: Define Consumer Job

Example:

```text
Consumer needs to view case detail to decide whether to upload additional evidence or submit for review.
```

### Step 2: Identify Resource Identity

```text
Resource: Case
Machine ID: id
Human reference: caseNumber
```

### Step 3: Define Representation Role

```text
CaseDetail, not CaseEntity, not CaseDto.
```

### Step 4: List Candidate Fields

Brainstorm fields, including internal possibilities.

### Step 5: Classify Fields

| Field | Consumer needs? | Sensitive? | Server-generated? | Include? |
|---|---:|---:|---:|---:|
| id | yes | no | yes | yes |
| caseNumber | yes | no | yes | yes |
| internalStatusCode | no | yes | yes | no |
| publicStatus | yes | no | yes | yes |
| riskScore | no | yes | yes | no |
| summary | yes | maybe | mixed | yes, redacted |
| assignedTeamId | maybe | yes | yes | no |
| assignedUnitName | yes | no | yes | yes |

### Step 6: Define Required Fields

Only require fields that are always present for this representation and caller context.

### Step 7: Define Nullability and Absence Semantics

Do not leave null semantics implicit.

### Step 8: Define Examples

Examples should be safe and realistic.

### Step 9: Check Evolution

Ask what happens if:

- field is renamed internally,
- state machine changes,
- database splits,
- authorization changes,
- consumer caches response,
- generated SDK uses the schema.

### Step 10: Add Tests and Review Rules

Validate that implementation matches contract.

---

## 32. Review Checklist

Before approving a resource schema:

- [ ] Does the schema represent consumer-facing contract, not persistence shape?
- [ ] Are request and response schemas separated where needed?
- [ ] Are list/detail/reference schemas separated where needed?
- [ ] Are internal fields excluded?
- [ ] Are sensitive fields excluded or explicitly justified?
- [ ] Are enum values public vocabulary?
- [ ] Are server-generated fields absent from request schemas?
- [ ] Are read-only/write-only fields correctly marked?
- [ ] Are nullability semantics documented?
- [ ] Are required fields truly always present?
- [ ] Are identifiers stable and appropriate?
- [ ] Are lifecycle states public-safe?
- [ ] Are state transitions modelled as actions where needed?
- [ ] Are examples safe and valid?
- [ ] Is the schema evolvable without database coupling?
- [ ] Is there a mapping layer in implementation?
- [ ] Is there a test ensuring response shape matches contract?

---

## 33. Design Heuristics for Top-Tier Engineers

### Heuristic 1: Contract First, Entity Last

Start from consumer need. Only later map to entity.

### Heuristic 2: Every Field Is a Promise

If you expose it, consumers may depend on it.

### Heuristic 3: Reuse Means Shared Fate

If two endpoints share schema, changing one affects the other.

### Heuristic 4: Internal State Is Not Public State

Map internal workflow to public lifecycle vocabulary.

### Heuristic 5: Generic Update APIs Hide Business Rules

Important state transitions deserve explicit operations.

### Heuristic 6: Null Is a State, Not a Shrug

Document null meaning or avoid it.

### Heuristic 7: Generated Docs Do Not Equal Designed Contract

Generation is useful after modelling discipline, not instead of it.

### Heuristic 8: Mapping Is Not Boilerplate

Mapping is where architecture protects the boundary.

---

## 34. Mini Case Study: From Entity Leak to Contract Model

### 34.1 Starting Point

A team has this endpoint:

```http
GET /investigations/{id}
```

Response generated from entity:

```json
{
  "id": "0d7f9f5b-2b29-4377-86c4-d57d8421e046",
  "invNo": "INV-9918",
  "statusCd": "L2_PENDING_QA",
  "queueId": "queue-17",
  "riskScore": 87.229,
  "modelVersion": "risk-model-v14.3",
  "softDeleted": false,
  "rowVersion": 12,
  "createdTs": "2026-06-20T03:12:00Z"
}
```

### 34.2 Problems

- `invNo` unclear abbreviation.
- `statusCd` leaks internal state.
- `queueId` internal routing.
- `riskScore` sensitive.
- `modelVersion` internal ML/analytics detail.
- `softDeleted` persistence detail.
- `rowVersion` ambiguous.
- `createdTs` inconsistent naming.

### 34.3 Redesigned Response

```json
{
  "id": "0d7f9f5b-2b29-4377-86c4-d57d8421e046",
  "investigationNumber": "INV-2026-009918",
  "status": "under_review",
  "priority": "high",
  "openedAt": "2026-06-20T03:12:00Z",
  "lastUpdatedAt": "2026-06-20T05:45:00Z",
  "availableActions": ["add_evidence", "submit_for_review"],
  "links": {
    "self": "/investigations/0d7f9f5b-2b29-4377-86c4-d57d8421e046",
    "evidence": "/investigations/0d7f9f5b-2b29-4377-86c4-d57d8421e046/evidence"
  }
}
```

Better because:

- vocabulary is public,
- sensitive internals removed,
- state is consumer-meaningful,
- available actions reduce client inference,
- links provide navigation,
- timestamps are named clearly.

---

## 35. How This Connects to Previous Parts

From previous parts:

- Part 003 taught OpenAPI document anatomy.
- Part 004 taught operations as capabilities.
- Part 005 taught parameters.
- Part 006 taught request bodies.
- Part 007 taught responses.
- Part 008 taught components and reuse.
- Part 009 taught schema constraints.
- Part 010 taught composition and polymorphism.

This part connects them into domain modelling:

```text
Operation capability
  -> request schema
  -> response schema
  -> component reuse
  -> schema constraints
  -> domain boundary
  -> implementation mapping
```

OpenAPI mastery is not knowing every keyword. It is knowing what not to expose.

---

## 36. Key Takeaways

1. API resource model is not database entity model.
2. DTO is not automatically a good contract.
3. Request and response schemas usually deserve separation.
4. Summary/detail/reference schemas usually deserve separation.
5. Internal state should be mapped to public lifecycle vocabulary.
6. Server-generated fields should not appear in request schemas casually.
7. Sensitive/internal fields must be excluded by default.
8. Mapping layers protect API stability.
9. Reuse creates shared evolution fate.
10. Every field in OpenAPI is a long-term promise.

---

## 37. Practice Exercises

### Exercise 1: Entity Leak Detection

Take an existing Java entity or DTO from a project. Mark every field as:

- public contract,
- internal only,
- sensitive,
- derived,
- server-generated,
- authorization-dependent,
- persistence-only.

Then design a better OpenAPI response schema.

### Exercise 2: Request/Response Split

Pick one endpoint that uses the same schema for create and response. Split it into:

- `CreateXRequest`,
- `XDetail`,
- `XSummary`,
- `XReference`.

Explain why each field belongs where it belongs.

### Exercise 3: State Mapping

Given internal states:

```text
DRAFT
SUBMITTED
ASSIGNED_L1
ASSIGNED_L2
QA_REJECTED
LEGAL_REVIEW
APPROVED
NOTICE_SENT
CLOSED_ACTIONED
CLOSED_NO_ACTION
```

Create a public status enum with fewer values. Explain what gets hidden and why.

### Exercise 4: Sensitive Field Review

Design an `EvidenceFileDetail` schema. Decide whether to expose:

- storage key,
- file hash,
- malware scan result,
- uploader ID,
- redaction status,
- privilege review note,
- download URL,
- expiration time.

Justify each choice.

---

## 38. References

- OpenAPI Specification v3.2.0 — Schema Object, Components Object, Operation Object, Request Body Object, Response Object, Security Scheme Object.
- JSON Schema Draft 2020-12 — data modelling, validation keywords, composition semantics.
- RFC 9110 — HTTP semantics, resource and representation concepts.
- RFC 9457 — Problem Details for HTTP APIs.
- Common Java ecosystem practices: Spring Boot, Jackson, Bean Validation, JPA, generated API models, and mapping layers.

---

## 39. Series Progress

```text
Current part: 011 / 030
Status: In progress
Series complete: No
Remaining parts: 19
Next: Part 012 — API Design with OpenAPI: Design-First, Code-First, Contract-First, and Hybrid Workflows
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-010.md">⬅️ OpenAPI Mastery for Java Engineers — Part 010</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-012.md">OpenAPI Mastery for Java Engineers — Part 012 ➡️</a>
</div>
