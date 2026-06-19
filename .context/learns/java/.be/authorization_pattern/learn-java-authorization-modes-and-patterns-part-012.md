# learn-java-authorization-modes-and-patterns-part-012

# Part 12 — Authorization in Layered Java Applications

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus: penempatan authorization check di aplikasi Java berlapis, enforcement berlapis tanpa duplikasi liar, dan pencegahan bypass lewat alternate path seperti repository, batch, export, report, internal API, async job, dan data access.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya sudah membahas:

1. mental model authorization,
2. vocabulary dan invariant,
3. primitive authorization platform Java,
4. arsitektur PEP/PDP/PAP/PIP,
5. RBAC,
6. permission/capability modeling,
7. ABAC,
8. PBAC/policy-as-code,
9. ReBAC,
10. ACL/domain object security,
11. tenancy/data boundary,
12. IDOR/BOLA/object-level authorization.

Part ini menjawab pertanyaan praktis yang hampir selalu muncul di proyek Java enterprise:

> Authorization check sebaiknya diletakkan di mana?

Jawaban pendeknya: **tidak ada satu layer tunggal yang cukup**.

Jawaban advanced-nya: authorization harus dipasang berdasarkan **jenis keputusan**, **jenis resource**, **risiko bypass**, **granularity**, **biaya evaluasi**, dan **kebutuhan audit**.

Part ini tidak sekadar membahas “pakai annotation di controller” atau “pakai method security di service”. Kita akan membangun mental model untuk menentukan layer enforcement yang benar.

---

## 1. Core Mental Model: Authorization Is a Cross-Cutting Invariant, Not a Single Filter

Aplikasi Java enterprise biasanya punya beberapa layer:

```text
Client / Browser / Mobile / External System
        |
        v
API Gateway / Reverse Proxy / WAF
        |
        v
Controller / Resource / Endpoint Layer
        |
        v
Application Service / Use Case Layer
        |
        v
Domain Model / Aggregate / Policy Layer
        |
        v
Repository / DAO / Query Layer
        |
        v
Database / Search Index / Object Storage / Message Broker
        |
        v
Batch / Scheduler / Async Worker / Report / Export
```

Authorization bug terjadi ketika engineer berpikir:

> “Endpoint ini sudah dicek, berarti aman.”

Padahal data atau aksi yang sama bisa dicapai lewat path lain:

```text
GET /cases/{id}
POST /cases/{id}/approve
POST /cases/bulk-assign
GET /reports/cases?agency=A
GET /exports/cases.csv
GET /files/{documentId}/download
Kafka consumer: CASE_APPROVE_REQUESTED
Batch job: auto-escalate overdue cases
Internal API: /internal/cases/{id}/status
Admin UI: /admin/cases/{id}
```

Kalau hanya satu path yang diberi authorization, path lain dapat menjadi bypass.

Mental model yang lebih benar:

> Authorization adalah invariant yang harus tetap benar di semua path yang dapat membaca, mengubah, mengekspor, memproses, atau menurunkan data/aksi dari resource yang dilindungi.

Dengan kata lain, authorization bukan “kode di satu tempat”, tetapi **kontrol sistemik**.

---

## 2. Layered Authorization: Bukan Duplikasi, Tapi Defense with Different Semantics

Banyak engineer takut meletakkan authorization di banyak layer karena dianggap duplikasi. Kekhawatiran ini valid jika setiap layer mengulang rule yang sama dengan cara berbeda.

Namun authorization berlapis yang benar bukan seperti ini:

```text
Controller: if user.role == ADMIN
Service:    if user.role == ADMIN
Repository: if user.role == ADMIN
```

Itu memang buruk.

Authorization berlapis yang benar adalah:

```text
Gateway:    request berasal dari client/app/channel yang boleh mengakses API family ini?
Controller: endpoint/function ini boleh dipanggil oleh subject class ini?
Service:    subject boleh menjalankan use case ini dengan input ini?
Domain:     aksi ini valid terhadap aggregate state dan business invariant?
Repository: query hanya mengambil data dalam boundary subject?
Database:   safety net untuk row/tenant boundary tertentu?
Audit:      keputusan dan bukti cukup untuk direkonstruksi?
```

Setiap layer punya **semantic responsibility** yang berbeda.

---

## 3. The Layer Responsibility Matrix

Gunakan matriks berikut sebagai mental model awal.

| Layer | Pertanyaan Authorization | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|---|
| UI | Apa yang sebaiknya ditampilkan? | UX, hiding unavailable actions | Enforcement final |
| API Gateway | Client/channel/API family boleh masuk? | coarse-grained edge control, mTLS, client allowlist, route category | object-level decision |
| Controller/Endpoint | Subject boleh memanggil endpoint/action ini? | route/function-level authorization | complex domain rule |
| Application Service | Subject boleh menjalankan use case ini terhadap input ini? | command authorization, workflow guard, orchestration | raw query filtering detail |
| Domain Model | Aksi ini valid terhadap state dan invariant domain? | state transition, SoD, maker-checker, ownership invariant | external identity lookup berat |
| Repository/DAO | Data apa yang boleh dibaca/diubah oleh subject? | tenant scoping, agency scoping, query predicate | business explanation lengkap |
| Database | Boundary apa yang harus tetap aman meski app bug? | row-level security, grants, views | rich business policy dinamis |
| Search/Report/Export | Hasil turunan apa yang boleh muncul? | result filtering before pagination/export | hanya controller check |
| Async/Batch/Consumer | Job ini memakai otoritas siapa dan batasnya apa? | delegated/system authority, event-driven guard | asumsi “internal berarti aman” |

---

## 4. UI Authorization: Helpful, Never Sufficient

UI authorization menjawab:

> Tombol, menu, field, link, dan action apa yang sebaiknya terlihat atau aktif bagi user?

Contoh:

```text
- Hide “Approve” button jika user bukan reviewer.
- Disable “Assign Case” jika case sudah closed.
- Hide “Export” menu untuk user tanpa permission report.export.
- Show read-only fields for viewer.
```

UI authorization penting untuk usability, tetapi tidak boleh dianggap enforcement final.

Kenapa?

Karena client bisa dimodifikasi:

```http
POST /api/cases/123/approve
Authorization: Bearer <valid-user-token>
```

Walaupun tombol tidak muncul, request tetap bisa dibuat manual.

### Rule

> UI boleh melakukan optimistic/hint authorization, tetapi server tetap harus melakukan authoritative authorization.

### Java/Spring Implication

FE boleh menerima capability map:

```json
{
  "caseId": "CASE-123",
  "capabilities": {
    "view": true,
    "edit": true,
    "approve": false,
    "assign": false,
    "export": false
  }
}
```

Tetapi BE tetap wajib enforce:

```java
authorizationService.require(user, Action.APPROVE_CASE, caseRef);
caseService.approve(caseId, command);
```

Capability map adalah **presentation support**, bukan security control utama.

---

## 5. API Gateway Authorization: Coarse Boundary, Not Domain Authority

API gateway cocok untuk authorization kasar:

```text
- client application boleh akses API group ini?
- request datang dari network zone yang benar?
- mTLS certificate valid?
- token audience cocok?
- service account boleh call route family ini?
- public/private/internal route separation benar?
```

Contoh:

```text
/api/public/**       -> public or anonymous limited
/api/user/**         -> authenticated user
/api/admin/**        -> admin authority required
/api/internal/**     -> internal service identity only
/api/reports/**      -> report API group permission
```

Namun gateway biasanya tidak cukup untuk:

```text
- apakah user boleh melihat case 123?
- apakah user boleh approve case yang dia sendiri buat?
- apakah agency A boleh membaca agency B?
- apakah case sudah berada pada state yang bisa di-approve?
```

Itu perlu domain/data context yang biasanya tidak tersedia lengkap di gateway.

### Anti-Pattern: Gateway-Only Authorization

```text
Gateway: /cases/** requires CASE_USER role
Backend: accepts any case id
```

Vulnerable:

```http
GET /cases/CASE-BELONGS-TO-OTHER-AGENCY
```

Gateway tahu user punya role `CASE_USER`, tapi tidak tahu object boundary.

### Better Pattern

```text
Gateway:
  - authenticate token
  - verify audience
  - enforce route family permission
  - reject obviously invalid client/channel

Backend:
  - enforce use-case permission
  - enforce object-level authorization
  - enforce tenant/agency query boundary
```

---

## 6. Controller / Endpoint Layer Authorization

Controller layer menjawab:

> Apakah subject boleh memanggil endpoint/function ini secara umum?

Contoh:

```java
@RestController
@RequestMapping("/api/cases")
public class CaseController {

    @GetMapping("/{caseId}")
    @PreAuthorize("hasAuthority('case.read')")
    public CaseResponse getCase(@PathVariable String caseId) {
        return caseApplicationService.getCase(caseId);
    }

    @PostMapping("/{caseId}/approve")
    @PreAuthorize("hasAuthority('case.approve')")
    public ApprovalResponse approve(
            @PathVariable String caseId,
            @RequestBody ApproveCaseRequest request) {
        return caseApplicationService.approve(caseId, request);
    }
}
```

Ini berguna karena:

1. cepat,
2. deklaratif,
3. mudah dibaca,
4. mengurangi accidental public endpoint,
5. cocok untuk function-level authorization.

Namun ini belum cukup.

Kode di atas hanya menjawab:

```text
User punya permission case.approve?
```

Belum menjawab:

```text
- Apakah caseId ini milik agency user?
- Apakah user adalah reviewer yang ditugaskan?
- Apakah user bukan maker dari case ini?
- Apakah state case saat ini REVIEW_PENDING?
- Apakah case sedang locked oleh proses lain?
```

### Controller Layer Best Practice

Controller sebaiknya melakukan:

```text
1. authentication presence check,
2. route/function permission check,
3. input shape validation,
4. delegation ke application service,
5. mapping error ke HTTP semantics.
```

Controller sebaiknya tidak menjadi tempat rule kompleks seperti:

```java
if (user.getAgency().equals(case.getAgency())
        && case.getStatus() == CaseStatus.PENDING_REVIEW
        && !case.getCreatedBy().equals(user.getId())
        && user.getRoles().contains("SENIOR_REVIEWER")) {
    ...
}
```

Itu rule domain/use-case, bukan controller concern.

---

## 7. Application Service Layer Authorization

Application service layer adalah tempat utama untuk **use-case authorization**.

Contoh use case:

```text
- create case
- view case detail
- assign case
- approve case
- reject appeal
- reopen closed case
- export report
- download supporting document
```

Application service menjawab:

> Apakah subject boleh menjalankan use case ini terhadap input/resource tertentu sekarang?

Contoh desain:

```java
public final class CaseApplicationService {

    private final CaseRepository caseRepository;
    private final AuthorizationService authorizationService;
    private final CasePolicy casePolicy;

    public CaseDetail getCaseDetail(UserPrincipal user, CaseId caseId) {
        CaseRecord caseRecord = caseRepository.findById(caseId)
                .orElseThrow(NotFoundException::new);

        authorizationService.require(
                user,
                CaseAction.VIEW_DETAIL,
                CaseResource.from(caseRecord)
        );

        return CaseDetail.from(caseRecord);
    }

    public ApprovalResult approve(UserPrincipal user, CaseId caseId, ApproveCaseCommand command) {
        CaseAggregate caseAggregate = caseRepository.findAggregateById(caseId)
                .orElseThrow(NotFoundException::new);

        authorizationService.require(
                user,
                CaseAction.APPROVE,
                CaseResource.from(caseAggregate)
        );

        casePolicy.assertCanApprove(user, caseAggregate);

        caseAggregate.approve(user.userId(), command.reason());
        caseRepository.save(caseAggregate);

        return ApprovalResult.approved(caseId);
    }
}
```

Perhatikan ada dua lapis:

```text
authorizationService.require(...)  -> access decision
casePolicy.assertCanApprove(...)   -> domain invariant / state rule
```

Dalam sistem kecil, keduanya bisa digabung. Dalam sistem besar, pemisahan ini berguna.

### Use-Case Authorization vs Domain Validity

Contoh:

```text
Authorization:
  User Fajar boleh approve case ini?

Domain validity:
  Case dengan status CLOSED tidak boleh di-approve lagi oleh siapa pun.
```

Keduanya sama-sama mencegah action, tapi alasannya berbeda.

### Why Application Service Is Usually the Main PEP

Application service biasanya punya konteks paling lengkap:

```text
- user/principal,
- command,
- resource id,
- loaded aggregate,
- transaction boundary,
- tenant context,
- state transition,
- audit publisher,
- repository access.
```

Karena itu application service adalah tempat alami untuk enforcement yang paling meaningful.

---

## 8. Domain Layer Authorization

Domain layer menjaga invariant yang melekat pada domain.

Contoh domain invariant:

```text
- Maker cannot approve own case.
- Closed case cannot be modified.
- Suspended user cannot be assigned as officer.
- Appeal can only be submitted after decision issued.
- Reopen requires closed state and reopen reason.
```

Pertanyaan penting:

> Apakah domain object boleh tahu tentang user dan permission?

Jawabannya: tergantung.

### Option A — Domain Object Pure dari Security Framework

```java
public final class CaseAggregate {

    private CaseStatus status;
    private UserId createdBy;
    private UserId assignedReviewer;

    public void approve(UserId approver, ApprovalReason reason) {
        if (status != CaseStatus.PENDING_REVIEW) {
            throw new InvalidCaseStateException("Case is not pending review");
        }
        if (createdBy.equals(approver)) {
            throw new SegregationOfDutiesViolation("Maker cannot approve own case");
        }
        if (!assignedReviewer.equals(approver)) {
            throw new ReviewerMismatchException("Only assigned reviewer can approve");
        }
        this.status = CaseStatus.APPROVED;
    }
}
```

Kelebihan:

```text
- domain tetap bebas dari Spring Security/Jakarta Security,
- invariant tidak bisa dilewati oleh caller lain,
- bagus untuk state machine dan business rule.
```

Kekurangan:

```text
- domain butuh input identity minimal seperti UserId,
- tidak cocok untuk policy yang butuh lookup eksternal berat,
- tidak cocok untuk role/permission graph kompleks.
```

### Option B — Domain Policy Object

```java
public final class CaseDomainPolicy {

    public void assertCanApprove(Actor actor, CaseAggregate caseAggregate) {
        if (!caseAggregate.isPendingReview()) {
            throw new InvalidCaseStateException();
        }
        if (caseAggregate.wasCreatedBy(actor.userId())) {
            throw new SegregationOfDutiesViolation();
        }
        if (!caseAggregate.isAssignedReviewer(actor.userId())) {
            throw new AuthorizationDeniedException("not_assigned_reviewer");
        }
    }
}
```

Kelebihan:

```text
- policy domain terkumpul,
- aggregate tidak terlalu gemuk,
- bisa diuji terpisah,
- tetap tidak bergantung pada framework security.
```

### Option C — External Authorization Service Only

```java
authorizationService.require(user, CaseAction.APPROVE, caseResource);
caseAggregate.approveWithoutAuthorization(...);
```

Ini berbahaya jika aggregate bisa dipakai oleh caller lain tanpa authorization.

Boleh digunakan jika:

```text
- semua mutation path dijaga ketat di application service,
- aggregate tidak terekspos ke module lain,
- test memastikan tidak ada bypass,
- domain validity tetap dicek di aggregate.
```

### Rule

> Domain layer tidak harus melakukan semua authorization, tetapi domain invariant yang bersifat absolut sebaiknya tidak hanya hidup di controller/service annotation.

---

## 9. Repository / DAO Layer Authorization

Repository layer menjawab:

> Data mana yang boleh diambil atau diubah oleh subject ini?

Ini krusial untuk read/search/list/report/export.

### Problem: Fetch Then Filter

Bad:

```java
public List<CaseSummary> searchCases(UserPrincipal user, CaseSearchCriteria criteria) {
    List<CaseRecord> records = caseRepository.search(criteria);

    return records.stream()
            .filter(record -> authorizationService.can(user, CaseAction.VIEW_SUMMARY, record))
            .map(CaseSummary::from)
            .collect(Collectors.toList());
}
```

Masalah:

1. pagination salah,
2. total count bocor,
3. sorting kacau,
4. terlalu mahal,
5. data sempat masuk memory app,
6. export bisa bocor,
7. aggregate/report bisa menghitung data yang tidak boleh dilihat.

### Better: Authorized Query Predicate

```java
public Page<CaseSummary> searchCases(UserPrincipal user, CaseSearchCriteria criteria, Pageable pageable) {
    AuthorizedCaseScope scope = authorizationScopeResolver.resolveCaseScope(user, CaseAction.SEARCH);

    return caseRepository.searchWithinScope(criteria, scope, pageable)
            .map(CaseSummary::from);
}
```

Scope bisa berisi:

```java
public final class AuthorizedCaseScope {
    private final TenantId tenantId;
    private final Set<AgencyId> agencyIds;
    private final Set<CaseType> caseTypes;
    private final boolean includeConfidential;
    private final Set<CaseStatus> visibleStatuses;
}
```

SQL/JPA:

```sql
SELECT c.*
FROM cases c
WHERE c.tenant_id = :tenantId
  AND c.agency_id IN (:agencyIds)
  AND c.case_type IN (:caseTypes)
  AND (:includeConfidential = true OR c.confidential = false)
ORDER BY c.created_at DESC
LIMIT :limit OFFSET :offset
```

### Repository Authorization Rule

> Untuk collection/list/search/export/report, authorization harus diterjemahkan menjadi query constraint sebelum pagination, sorting, aggregation, dan export.

---

## 10. Database-Level Authorization

Database-level authorization bisa menjadi safety net yang kuat, terutama untuk tenant boundary dan row-level boundary.

Contoh capability database:

```text
- schema separation,
- database grants,
- views,
- stored procedures,
- row-level security,
- tenant_id predicates,
- read-only role,
- write role,
- migration role separation.
```

PostgreSQL memiliki Row-Level Security yang dapat membatasi baris yang dapat di-return atau dimodifikasi oleh query normal berdasarkan policy per user/table. Ini berguna sebagai defense-in-depth, terutama ketika ada banyak path akses data. Namun di Java enterprise dengan connection pooling, RLS perlu desain hati-hati karena database session identity sering bukan user aplikasi individual.

### Database RLS with Java Caveat

Dalam aplikasi Java, koneksi biasanya memakai satu technical user:

```text
app_user -> HikariCP -> database role app_rw
```

Kalau RLS bergantung pada database current_user, semua request terlihat sebagai `app_rw`.

Solusinya bisa:

```text
1. SET LOCAL app.tenant_id = 'TENANT_A' per transaction,
2. SET LOCAL app.user_id = 'USER_123' per transaction,
3. policy membaca current_setting('app.tenant_id'),
4. pastikan setting dibersihkan oleh transaction boundary,
5. jangan pakai session variable tanpa reset pada connection pool.
```

### Example Conceptual SQL

```sql
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cases
ON cases
USING (tenant_id = current_setting('app.tenant_id'));
```

Java transaction wrapper concept:

```java
@Transactional
public CaseDetail getCase(UserPrincipal user, CaseId caseId) {
    databaseContext.setLocal("app.tenant_id", user.tenantId().value());
    return caseRepository.findAuthorizedCase(caseId)
            .map(CaseDetail::from)
            .orElseThrow(NotFoundException::new);
}
```

### When DB-Level Authorization Helps

```text
- multi-tenant SaaS,
- shared database with strict tenant boundary,
- reporting tools access DB,
- multiple services share DB,
- high-impact leakage risk,
- legacy code with inconsistent checks.
```

### When DB-Level Authorization Is Not Enough

```text
- state transition rule,
- maker-checker rule,
- workflow-specific rule,
- risk-based rule,
- delegation and impersonation semantics,
- dynamic policy requiring external PIP.
```

---

## 11. Search, Report, Export, and Aggregation Layers

Search/report/export are common authorization bypass points.

### Example Bug

Case detail endpoint is safe:

```text
GET /cases/123 -> checks user can view case 123
```

But export endpoint is unsafe:

```text
GET /cases/export?agency=ANY -> exports all cases matching criteria
```

Or report endpoint leaks counts:

```text
GET /reports/case-count-by-agency
```

A user cannot view individual cases but can infer sensitive data from aggregates.

### Report/Export Authorization Rules

1. Export is not just read.
2. Search is not just read.
3. Aggregation can leak information.
4. Count can leak information.
5. File generation must use the same data scope as interactive query.
6. Export should often require a stronger permission than view.
7. Export should be audited more heavily than screen view.

### Good Export Flow

```text
1. User requests export.
2. Service checks `case.export` permission.
3. Service resolves authorized data scope.
4. Query runs inside authorized scope.
5. Export job stores snapshot metadata:
   - requested by,
   - tenant,
   - criteria,
   - authorization scope,
   - policy version,
   - record count,
   - file id.
6. Download endpoint checks file ownership/delegated access.
7. Audit logs both export creation and file download.
```

### Java Sketch

```java
public ExportJobId requestCaseExport(UserPrincipal user, CaseSearchCriteria criteria) {
    authorizationService.require(user, CaseAction.EXPORT, ResourceType.CASE_COLLECTION);

    AuthorizedCaseScope scope = scopeResolver.resolveCaseScope(user, CaseAction.EXPORT);

    ExportRequest request = ExportRequest.create(
            user.userId(),
            user.tenantId(),
            criteria,
            scope,
            clock.instant()
    );

    exportRepository.save(request);
    exportQueue.publish(request.toJobMessage());

    return request.exportJobId();
}
```

Worker:

```java
public void handleCaseExportJob(CaseExportJobMessage message) {
    ExportRequest request = exportRepository.findById(message.exportJobId())
            .orElseThrow();

    // Do not recompute scope from arbitrary worker identity.
    // Use stored, auditable, bounded authorization snapshot.
    caseExportGenerator.generate(request.criteria(), request.authorizedScope());
}
```

---

## 12. Async Jobs, Batch, and Message Consumers

Internal processing is one of the most dangerous authorization blind spots.

Bad assumption:

> “This is internal, so authorization is unnecessary.”

Better question:

> “Under whose authority is this async action performed, and what boundary limits it?”

### Types of Async Authority

| Type | Meaning | Example | Risk |
|---|---|---|---|
| User-delegated | Job acts on behalf of a user | export requested by user | stale permission, overbroad scope |
| System-authorized | Job acts as system within fixed rules | auto-close expired case | too much power |
| Service-account | Job acts as technical service | sync data to downstream | confused deputy |
| Admin-triggered | Operator triggers privileged job | reindex tenant data | audit and blast radius |

### User-Delegated Job Pattern

When user triggers an async job, store:

```text
- requester user id,
- tenant id,
- action,
- resource/scope,
- request criteria,
- policy version,
- decision id,
- expiry,
- purpose,
- correlation id.
```

Do not simply pass:

```json
{
  "runAs": "SYSTEM",
  "criteria": { "agency": "ALL" }
}
```

That destroys accountability.

### Recheck vs Snapshot

There are two valid patterns:

#### Pattern A — Recheck at Execution Time

```text
When job executes, re-evaluate whether requester still has permission.
```

Good for:

```text
- high-risk mutation,
- long queue delay,
- permission revocation must take effect quickly.
```

Risk:

```text
- job result changes due to permission change,
- harder UX,
- historical reproducibility harder.
```

#### Pattern B — Bounded Authorization Snapshot

```text
At request time, compute authorized scope and store it. Worker can only operate within that scope.
```

Good for:

```text
- report/export,
- deterministic snapshot,
- auditable result.
```

Risk:

```text
- permission revoked after request but before completion,
- need expiry and scope minimization.
```

### Top 1% Rule

> Async authorization must have an explicit authority model. “Worker runs as system” is not a complete authorization design.

---

## 13. Internal APIs and Service-to-Service Calls

Internal endpoints often bypass user authorization accidentally.

Example:

```text
External API:
  POST /cases/{id}/approve
  -> checks reviewer permission

Internal API:
  POST /internal/cases/{id}/status
  -> changes status directly
```

If internal API can be called by another service with broad service token, it may become a confused deputy.

### Internal API Authorization Checklist

Ask:

```text
1. Which services may call this endpoint?
2. Which actions may each service perform?
3. Is the service acting on its own authority or on behalf of a user?
4. Is original user context propagated?
5. Can downstream narrow authority?
6. Are resource boundaries checked again?
7. Are internal calls auditable?
8. Is endpoint reachable only from expected network zone?
9. Is mTLS/service identity verified?
10. Does service token have limited audience/scope?
```

### Pattern: Downstream Narrowing

Upstream sends:

```json
{
  "actor": {
    "type": "USER",
    "userId": "U123",
    "tenantId": "T1"
  },
  "delegation": {
    "service": "case-workflow-service",
    "purpose": "approve-case",
    "allowedActions": ["case.approve"],
    "resourceIds": ["CASE-123"]
  }
}
```

Downstream verifies:

```text
- caller service identity,
- delegated purpose,
- allowed action,
- resource id,
- tenant boundary,
- current resource state.
```

---

## 14. Transaction Boundary and Authorization

Authorization must be consistent with transaction semantics.

### TOCTOU Problem

TOCTOU = Time Of Check To Time Of Use.

Bad:

```java
if (authorizationService.canApprove(user, caseId)) {
    CaseAggregate caseAggregate = caseRepository.findById(caseId).orElseThrow();
    caseAggregate.approve(user.userId());
    caseRepository.save(caseAggregate);
}
```

Between `canApprove` and `save`, state may change.

Better:

```java
@Transactional
public ApprovalResult approve(UserPrincipal user, CaseId caseId, ApproveCaseCommand command) {
    CaseAggregate caseAggregate = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(NotFoundException::new);

    authorizationService.require(user, CaseAction.APPROVE, CaseResource.from(caseAggregate));
    caseAggregate.approve(user.userId(), command.reason());
    caseRepository.save(caseAggregate);

    return ApprovalResult.approved(caseId);
}
```

### Locking and Authorization

For sensitive mutation:

```text
1. Start transaction.
2. Load resource with appropriate lock/version.
3. Evaluate authorization on current state.
4. Perform mutation.
5. Persist.
6. Audit decision and mutation.
7. Commit.
```

### Optimistic Locking Variant

```java
@Transactional
public ApprovalResult approve(UserPrincipal user, CaseId caseId, long expectedVersion) {
    CaseAggregate caseAggregate = caseRepository.findById(caseId).orElseThrow();

    if (caseAggregate.version() != expectedVersion) {
        throw new ConcurrentModificationException();
    }

    authorizationService.require(user, CaseAction.APPROVE, CaseResource.from(caseAggregate));
    caseAggregate.approve(user.userId());
    caseRepository.save(caseAggregate);

    return ApprovalResult.approved(caseId);
}
```

Authorization should be based on the same state that mutation uses.

---

## 15. `403` vs `404` vs Masked Response

Layered authorization also affects error semantics.

### `403 Forbidden`

Use when:

```text
- user is authenticated,
- resource/action exists or is known,
- user lacks permission,
- revealing existence is acceptable.
```

Example:

```text
POST /cases/123/approve -> 403 because user can view case but cannot approve it.
```

### `404 Not Found`

Use when:

```text
- resource existence itself is sensitive,
- user should not know whether object exists,
- route behaves as scoped lookup.
```

Example:

```text
GET /cases/other-agency-case -> 404
```

Here repository can implement:

```sql
SELECT * FROM cases
WHERE id = :caseId
  AND tenant_id = :tenantId
  AND agency_id IN (:authorizedAgencyIds)
```

If no row found, return 404.

### Masked Response

Sometimes response exists but fields are masked:

```json
{
  "caseId": "CASE-123",
  "status": "OPEN",
  "complainantName": "***",
  "confidentialReason": null
}
```

Use for:

```text
- partial authorization,
- data minimization,
- field-level confidentiality,
- reports where some columns are restricted.
```

### Rule

> Error semantics are part of authorization design, not just exception handling.

---

## 16. Avoiding Duplicate Checks Without Creating Bypass

The challenge:

```text
Too few checks -> bypass.
Too many copied checks -> inconsistent policy.
```

Solution:

```text
Centralize decision logic, distribute enforcement points.
```

Meaning:

```text
- Controller may enforce route permission.
- Service may enforce use-case authorization.
- Repository may enforce data scope.
- All of them call shared authorization/scope/policy components.
```

### Bad Duplication

```java
// Controller
if (user.hasRole("REVIEWER") && user.agency().equals(caseAgency)) { ... }

// Service
if (user.getRoles().contains("REVIEWER") && case.getAgencyId().equals(user.getAgencyId())) { ... }

// Repository
WHERE role = 'REVIEWER' AND agency_id = ?
```

### Good Centralization

```java
// Controller
@PreAuthorize("hasAuthority('case.approve')")

// Service
authorizationService.require(user, CaseAction.APPROVE, CaseResource.from(caseAggregate));

// Repository
AuthorizedCaseScope scope = scopeResolver.resolve(user, CaseAction.SEARCH);
caseRepository.search(criteria, scope, pageable);
```

The logic lives in:

```text
- permission catalog,
- authorization service,
- scope resolver,
- domain policy,
- testable rules.
```

Not scattered as ad-hoc `if` statements.

---

## 17. Authorization Facade Pattern

A clean Java application benefits from an authorization facade.

### Interface

```java
public interface AuthorizationService {

    PolicyDecision decide(AuthorizationRequest request);

    default void require(AuthorizationRequest request) {
        PolicyDecision decision = decide(request);
        if (!decision.isAllowed()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
    }
}
```

### Request

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    // constructor/getters omitted
}
```

### Decision

```java
public final class PolicyDecision {
    private final boolean allowed;
    private final String reasonCode;
    private final List<String> evidence;
    private final List<Obligation> obligations;

    public boolean isAllowed() {
        return allowed;
    }
}
```

### Java 17+ Alternative

In Java 17+, records make request/decision easier:

```java
public record AuthorizationRequest(
        SubjectRef subject,
        Action action,
        ResourceRef resource,
        AuthorizationContext context
) {}

public record PolicyDecision(
        boolean allowed,
        String reasonCode,
        List<String> evidence,
        List<Obligation> obligations
) {}
```

For Java 8, use final classes.

### Why Facade Helps

```text
- controller/service/repository don't know policy internals,
- decision is auditable,
- test can assert reason codes,
- external PDP can be plugged later,
- policy evolution is easier,
- logic is not scattered.
```

---

## 18. Scope Resolver Pattern

For read/search/report/export, authorization often needs data scope, not just yes/no.

### Interface

```java
public interface AuthorizationScopeResolver {

    AuthorizedCaseScope resolveCaseScope(UserPrincipal user, CaseAction action);

    AuthorizedDocumentScope resolveDocumentScope(UserPrincipal user, DocumentAction action);
}
```

### Example

```java
public AuthorizedCaseScope resolveCaseScope(UserPrincipal user, CaseAction action) {
    if (user.hasAuthority("case.search.all")) {
        return AuthorizedCaseScope.allWithinTenant(user.tenantId());
    }

    if (user.hasAuthority("case.search.agency")) {
        return AuthorizedCaseScope.agencies(user.tenantId(), user.agencyIds());
    }

    if (user.hasAuthority("case.search.assigned")) {
        return AuthorizedCaseScope.assignedTo(user.tenantId(), user.userId());
    }

    return AuthorizedCaseScope.none(user.tenantId());
}
```

Repository:

```java
public Page<CaseRecord> search(CaseSearchCriteria criteria,
                               AuthorizedCaseScope scope,
                               Pageable pageable) {
    // translate scope into SQL/JPA predicates
}
```

### Benefit

You avoid writing:

```text
if user role X then WHERE A
if user role Y then WHERE B
if user role Z then WHERE C
```

in every query.

---

## 19. Decision Object Pattern

Avoid boolean blindness.

Bad:

```java
boolean allowed = auth.can(user, action, resource);
```

Better:

```java
PolicyDecision decision = auth.decide(user, action, resource);
```

Decision should carry:

```text
- allowed/denied,
- reason code,
- policy id,
- policy version,
- evaluated subject,
- evaluated resource,
- relevant attributes,
- obligations,
- warning/advice,
- correlation id.
```

Example:

```json
{
  "allowed": false,
  "reasonCode": "MAKER_CANNOT_APPROVE_OWN_CASE",
  "policyId": "case-approval-policy",
  "policyVersion": "2026-06-01",
  "evidence": [
    "subject.userId == case.createdBy",
    "case.status == PENDING_REVIEW"
  ],
  "obligations": []
}
```

### Why This Matters

For top-level engineering, authorization is not only runtime yes/no. It is also:

```text
- audit,
- explainability,
- debugging,
- incident response,
- policy review,
- regression testing,
- compliance evidence.
```

---

## 20. Exception Mapping and Denial Handling

Do not let every layer invent its own denial response.

### Exception Types

```java
public class AuthorizationDeniedException extends RuntimeException {
    private final String reasonCode;
    private final PolicyDecision decision;
}

public class ResourceNotVisibleException extends RuntimeException {
}

public class BusinessRuleViolationException extends RuntimeException {
    private final String ruleCode;
}
```

### Mapping

```text
AuthorizationDeniedException -> 403 or 404 depending masking policy
ResourceNotVisibleException  -> 404
BusinessRuleViolation        -> 409 or 422 depending API style
Unauthenticated              -> 401
```

### Spring Sketch

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(AuthorizationDeniedException.class)
    ResponseEntity<ErrorResponse> handleAuthorizationDenied(AuthorizationDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("ACCESS_DENIED", ex.reasonCode()));
    }

    @ExceptionHandler(ResourceNotVisibleException.class)
    ResponseEntity<ErrorResponse> handleResourceNotVisible(ResourceNotVisibleException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("NOT_FOUND", "resource_not_found"));
    }
}
```

Caution:

```text
Do not expose sensitive internal reason to untrusted user.
Log detailed reason internally, return stable public reason externally.
```

---

## 21. Layered Authorization in Spring Security

Spring Security modern authorization architecture uses `AuthorizationManager` as a central abstraction for making access control decisions across request, method, and message security. That makes it a good integration point for layered Java applications, but it does not remove the need for domain/data authorization.

### Request Layer

```java
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/public/**").permitAll()
            .requestMatchers("/api/admin/**").hasAuthority("admin.access")
            .requestMatchers(HttpMethod.GET, "/api/cases/**").hasAuthority("case.read")
            .requestMatchers(HttpMethod.POST, "/api/cases/*/approve").hasAuthority("case.approve")
            .anyRequest().denyAll()
    );
    return http.build();
}
```

### Method Layer

```java
@PreAuthorize("hasAuthority('case.approve')")
public ApprovalResult approve(String caseId, ApproveCaseRequest request) {
    ...
}
```

### Domain/Data Layer

```java
public ApprovalResult approve(UserPrincipal user, CaseId caseId, ApproveCaseCommand command) {
    CaseAggregate caseAggregate = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(NotFoundException::new);

    authorizationService.require(user, CaseAction.APPROVE, CaseResource.from(caseAggregate));
    caseAggregate.approve(user.userId(), command.reason());

    return ApprovalResult.approved(caseId);
}
```

### Rule

> Spring Security route/method authorization is a powerful PEP, not a complete domain authorization system by itself.

---

## 22. Layered Authorization in Jakarta EE

Jakarta-style applications often use declarative authorization:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    @RolesAllowed("CASE_USER")
    public CaseDto getCase(@PathParam("id") String id) {
        return caseService.getCase(id);
    }
}
```

This handles coarse role/function-level access, but the service still needs object-level authorization:

```java
public CaseDto getCase(String id) {
    Caller caller = callerContext.currentCaller();
    CaseRecord record = caseRepository.findById(id)
            .orElseThrow(NotFoundException::new);

    authorizationService.require(caller, CaseAction.VIEW_DETAIL, CaseResource.from(record));

    return mapper.toDto(record);
}
```

Jakarta annotations such as `@RolesAllowed`, `@PermitAll`, and `@DenyAll` are useful, but they should not become the only representation of domain authorization.

---

## 23. Layer Placement by Operation Type

### 23.1 View Single Object

Recommended:

```text
Controller: requires general read permission.
Service: loads object in scoped way or loads then checks object-level authorization.
Repository: includes tenant/agency predicate if existence should be hidden.
Audit: optional allow/deny depending sensitivity.
```

### 23.2 Search/List

Recommended:

```text
Controller: requires search/list permission.
Service: resolves authorized scope.
Repository: applies scope before pagination/sorting.
Audit: usually query metadata, not every row.
```

### 23.3 Mutate Object

Recommended:

```text
Controller: requires action permission.
Service: transaction starts, loads current state, checks authorization, invokes domain mutation.
Domain: enforces invariant.
Repository: saves with optimistic/pessimistic concurrency.
Audit: log decision + mutation.
```

### 23.4 Export

Recommended:

```text
Controller: requires export permission.
Service: resolves export scope.
Repository/query: filters before export.
Worker: uses bounded authorization snapshot.
Audit: mandatory.
Download: separate authorization.
```

### 23.5 File Download

Recommended:

```text
Controller: requires document download permission.
Service: loads document metadata.
Authorization: checks parent resource and document classification.
Storage: object key must not be directly guessable public URL.
Audit: mandatory for sensitive docs.
```

### 23.6 Batch Operation

Recommended:

```text
Controller: requires bulk action permission.
Service: validates each target or resolves allowed subset explicitly.
Repository: fetch only authorized targets.
Result: report per item allowed/denied/skipped.
Audit: aggregate + individual high-risk action.
```

---

## 24. Common Failure Modes in Layered Java Apps

### Failure 1 — Annotation-Only Security

```java
@PreAuthorize("hasRole('OFFICER')")
@GetMapping("/cases/{id}")
public CaseDto get(@PathVariable String id) {
    return caseService.get(id);
}
```

Missing:

```text
- object-level ownership,
- tenant boundary,
- agency scope,
- confidentiality flag.
```

### Failure 2 — Repository Method Without Scope

```java
caseRepository.findById(caseId)
```

Better for scoped read:

```java
caseRepository.findVisibleById(caseId, authorizedScope)
```

### Failure 3 — Export Reuses Admin Query

```java
SELECT * FROM cases WHERE created_at BETWEEN ? AND ?
```

Missing user scope.

### Failure 4 — Async Worker Runs as God

```text
Worker consumes job and processes all IDs without requester scope.
```

### Failure 5 — Internal Endpoint Trusts Network

```text
/internal/** only checks source IP, no service identity, no delegated authority.
```

### Failure 6 — Cache Key Missing Tenant/User/Scope

```java
cache.get("case:" + caseId)
```

Better:

```java
cache.get("tenant:" + tenantId + ":case:" + caseId + ":view:" + subjectScopeHash)
```

Or cache raw object only in trusted internal cache and apply authorization before returning.

### Failure 7 — Count/Aggregate Leakage

```text
User cannot view cases, but report count reveals sensitive agency workload.
```

### Failure 8 — Domain Rule Only in UI

```text
Approve button hidden after CLOSED, but API still accepts approve request.
```

### Failure 9 — `403` Reveals Existence

```text
GET /cases/secret-id -> 403 tells attacker the ID exists.
```

Sometimes scoped 404 is safer.

### Failure 10 — Policy Split Across Layers Without Shared Vocabulary

```text
Controller says role REVIEWER.
Service says permission APPROVE_CASE.
Repository says team_id.
Domain says assignedReviewer.
```

Not wrong by itself, but dangerous if there is no shared mapping and test matrix.

---

## 25. Advanced Design: Authorization as an Application Pipeline

A robust use-case pipeline can be modeled as:

```text
1. Resolve subject
2. Resolve tenant/context
3. Validate command shape
4. Load resource/current state
5. Resolve authorization facts
6. Decide authorization
7. Enforce obligations
8. Execute domain operation
9. Persist state
10. Emit audit event
11. Return response with appropriate masking
```

Example:

```java
@Transactional
public ApprovalResult approve(UserPrincipal user, CaseId caseId, ApproveCaseCommand command) {
    RequestContext context = requestContextFactory.current();

    commandValidator.validate(command);

    CaseAggregate caseAggregate = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(() -> notFoundOrInvisible(caseId));

    AuthorizationRequest authRequest = AuthorizationRequest.builder()
            .subject(SubjectRef.user(user.userId(), user.tenantId()))
            .action(CaseAction.APPROVE)
            .resource(CaseResource.from(caseAggregate))
            .context(AuthorizationContext.from(context))
            .build();

    PolicyDecision decision = authorizationService.decide(authRequest);
    auditAuthorizationDecision(decision, authRequest);

    if (!decision.isAllowed()) {
        throw new AuthorizationDeniedException(decision);
    }

    obligationExecutor.execute(decision.obligations());

    caseAggregate.approve(user.userId(), command.reason());
    caseRepository.save(caseAggregate);

    auditMutation(user, caseAggregate, "CASE_APPROVED");

    return ApprovalResult.approved(caseId);
}
```

This makes authorization explicit, auditable, and composable.

---

## 26. Testing Layered Authorization

### 26.1 Controller Tests

Verify:

```text
- public endpoints are intentionally public,
- protected endpoints reject anonymous users,
- function-level permission works,
- default deny works,
- wrong authority returns 403.
```

### 26.2 Service Tests

Verify:

```text
- user with permission but wrong object scope denied,
- user with object scope but wrong action denied,
- maker cannot approve own case,
- wrong state denied,
- assigned reviewer allowed,
- tenant mismatch denied.
```

### 26.3 Repository Tests

Verify:

```text
- search returns only authorized rows,
- pagination count matches authorized rows,
- sorting does not leak unauthorized rows,
- export query uses same scope,
- tenant predicate always applied.
```

### 26.4 Integration Tests

Verify path equivalence:

```text
If user cannot view CASE-123 via detail endpoint,
then user also cannot see it via search, export, report, file download, batch, websocket, or internal proxy path.
```

### 26.5 Mutation Tests

Introduce intentional missing checks and ensure tests fail.

Example:

```text
Remove service-level authorization from approve.
Expected: tests fail.
```

If tests still pass, coverage is not strong enough.

---

## 27. Practical Authorization Placement Heuristics

Use these rules in design review.

### Rule 1 — Route Permission at Edge/Controller

Every non-public endpoint should have explicit route/function authorization.

### Rule 2 — Object/Use-Case Permission in Service

Every operation involving a specific resource must authorize that subject-action-resource-context tuple.

### Rule 3 — Collection Read Must Be Scoped in Query

Search/list/report/export must filter before pagination/aggregation/export.

### Rule 4 — Domain Invariant Must Live Near Domain

Rules like maker-checker, state transition validity, and assignment constraints should not live only in UI/controller.

### Rule 5 — Async Must Carry Authority

Every async/batch/message operation must define whether it acts as user, system, service, or admin.

### Rule 6 — Internal Does Not Mean Authorized

Internal endpoint still needs caller identity, action boundary, and resource boundary.

### Rule 7 — Audit High-Risk Decisions

Mutation/export/download/break-glass/delegation should log authorization decision evidence.

### Rule 8 — Default Deny

Unknown route, unknown action, unknown resource type, unknown policy result: deny.

### Rule 9 — Centralize Decision, Not Enforcement

Do not centralize all checks in one physical layer. Centralize policy logic, distribute enforcement according to layer semantics.

### Rule 10 — Test Alternate Paths

For every protected resource, enumerate all paths that can reveal or mutate it.

---

## 28. Design Review Checklist

Use this before approving a feature.

### Subject

```text
[ ] Who is the subject?
[ ] Is it user, service, system, delegated actor, or admin?
[ ] Is original actor preserved across async/internal calls?
```

### Action

```text
[ ] What action is being authorized?
[ ] Is it read/search/export/download/mutate/admin/bulk?
[ ] Is action name stable and explicit?
```

### Resource

```text
[ ] What resource type is protected?
[ ] Is the decision per collection, type, or object instance?
[ ] Are parent resources considered?
[ ] Are documents/files tied to parent authorization?
```

### Context

```text
[ ] Tenant/agency/org boundary present?
[ ] State/workflow status considered?
[ ] Time/risk/channel considered if relevant?
[ ] Delegation/impersonation considered?
```

### Layering

```text
[ ] Gateway/controller has coarse/function check?
[ ] Service has use-case/object check?
[ ] Domain invariant is protected?
[ ] Repository query is scoped?
[ ] Export/report uses same scope?
[ ] Async/internal path protected?
```

### Error and Audit

```text
[ ] 401/403/404 semantics chosen intentionally?
[ ] Denial reason not leaking sensitive data?
[ ] Decision logged for high-risk action?
[ ] Policy version/evidence available?
```

### Testing

```text
[ ] Positive test exists?
[ ] Negative test exists?
[ ] Cross-tenant test exists?
[ ] Object-level test exists?
[ ] Search/export/report path tested?
[ ] Async/internal path tested?
```

---

## 29. Mini Case Study: Case Approval in Regulatory System

### Requirement

```text
Officer can create case.
Reviewer can approve case only if assigned.
Reviewer cannot approve own created case.
Agency user cannot access other agency case.
Closed case cannot be changed.
Export requires stronger permission.
```

### Bad Design

```java
@PostMapping("/cases/{id}/approve")
@PreAuthorize("hasRole('REVIEWER')")
public void approve(@PathVariable String id) {
    caseService.approve(id);
}
```

Service:

```java
public void approve(String id) {
    Case c = caseRepository.findById(id).orElseThrow();
    c.setStatus(APPROVED);
    caseRepository.save(c);
}
```

Problems:

```text
- no tenant check,
- no agency check,
- no assigned reviewer check,
- no maker-checker,
- no state guard,
- no transaction locking,
- no audit decision,
- no 404 masking strategy.
```

### Better Layered Design

Controller:

```java
@PostMapping("/cases/{id}/approve")
@PreAuthorize("hasAuthority('case.approve')")
public ApprovalResponse approve(@PathVariable String id,
                                @RequestBody ApproveCaseRequest request,
                                Authentication authentication) {
    UserPrincipal user = principalMapper.from(authentication);
    return mapper.toResponse(caseAppService.approve(user, new CaseId(id), mapper.toCommand(request)));
}
```

Service:

```java
@Transactional
public ApprovalResult approve(UserPrincipal user, CaseId caseId, ApproveCaseCommand command) {
    CaseAggregate c = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(NotFoundException::new);

    AuthorizationRequest request = AuthorizationRequest.of(
            SubjectRef.user(user.userId(), user.tenantId()),
            CaseAction.APPROVE,
            CaseResource.from(c),
            AuthorizationContext.current()
    );

    PolicyDecision decision = authorizationService.decide(request);
    audit.logDecision(request, decision);

    if (!decision.isAllowed()) {
        throw new AuthorizationDeniedException(decision);
    }

    c.approve(user.userId(), command.reason());
    caseRepository.save(c);

    audit.logMutation(user.userId(), caseId, "CASE_APPROVED");
    return ApprovalResult.approved(caseId);
}
```

Domain:

```java
public void approve(UserId approver, String reason) {
    if (status != CaseStatus.PENDING_REVIEW) {
        throw new InvalidCaseStateException("CASE_NOT_PENDING_REVIEW");
    }
    if (createdBy.equals(approver)) {
        throw new SegregationOfDutiesViolation("MAKER_CANNOT_APPROVE_OWN_CASE");
    }
    if (!assignedReviewer.equals(approver)) {
        throw new AuthorizationDeniedException("NOT_ASSIGNED_REVIEWER");
    }
    this.status = CaseStatus.APPROVED;
    this.approvedBy = approver;
    this.approvedAt = Instant.now();
    this.approvalReason = reason;
}
```

Repository for search:

```java
public Page<CaseSummary> search(UserPrincipal user, CaseSearchCriteria criteria, Pageable pageable) {
    AuthorizedCaseScope scope = scopeResolver.resolveCaseScope(user, CaseAction.SEARCH);
    return caseRepository.search(criteria, scope, pageable).map(CaseSummary::from);
}
```

Export:

```java
public ExportJobId export(UserPrincipal user, CaseSearchCriteria criteria) {
    authorizationService.require(user, CaseAction.EXPORT, ResourceType.CASE_COLLECTION);
    AuthorizedCaseScope scope = scopeResolver.resolveCaseScope(user, CaseAction.EXPORT);
    return exportService.createCaseExport(user, criteria, scope);
}
```

Now each layer protects what it should.

---

## 30. Java 8–25 Considerations

### Java 8

Use:

```text
- final classes for value objects,
- Optional carefully,
- immutable collections via defensive copies,
- explicit builder classes,
- Spring Security/Jakarta depending stack.
```

Avoid:

```text
- framework-specific security types leaking into domain,
- mutable static context for authorization,
- ThreadLocal misuse in async code.
```

### Java 11

Better HTTP client for remote PDP integration, but core layered model unchanged.

### Java 17

Useful:

```text
- records for request/decision/context objects,
- sealed classes for decision result hierarchy,
- pattern matching improvements depending version,
- stronger baseline for modern Spring Boot.
```

Example:

```java
public sealed interface AuthorizationOutcome permits Allowed, Denied {
}

public record Allowed(List<Obligation> obligations) implements AuthorizationOutcome {
}

public record Denied(String reasonCode, List<String> evidence) implements AuthorizationOutcome {
}
```

### Java 21

Virtual threads can change concurrency economics, but not authorization correctness.

Caution:

```text
- ThreadLocal-based security context must be understood carefully.
- Async/virtual-thread boundaries need explicit context propagation.
- Remote PDP calls may become cheaper to block on, but failure semantics still matter.
```

### Java 25

Platform evolution helps expressiveness and runtime ergonomics, but authorization invariants remain the same:

```text
subject + action + resource + context -> decision
```

Do not confuse language feature modernization with authorization model correctness.

---

## 31. Top 1% Insights

1. **The question is not “which layer should check authorization?” but “which authorization question belongs to which layer?”**

2. **Controller authorization prevents accidental public functions; service authorization protects use cases; repository authorization protects collections; domain authorization protects invariants.**

3. **Search/export/report are not secondary features. They are often the easiest way to bypass object-level authorization.**

4. **Internal APIs and async workers must have explicit authority models. Internal traffic is not automatically trusted.**

5. **Centralize policy logic, not enforcement points. Enforcement must exist wherever protected action/data can be reached.**

6. **Authorization decision should be an auditable object, not a boolean lost in an `if` statement.**

7. **Repository scoping must happen before pagination, sorting, aggregation, and export.**

8. **TOCTOU matters: authorize against the same state you mutate.**

9. **Error semantics are security semantics. `403`, `404`, and masking must be intentionally chosen.**

10. **Layered authorization is not about paranoia. It is about making bypass structurally difficult.**

---

## 32. Production Checklist

```text
[ ] Every endpoint is explicitly permit/deny/protect; no accidental default allow.
[ ] Controller enforces route/function-level permission.
[ ] Application service enforces subject-action-resource-context authorization.
[ ] Domain model/policy enforces state and business invariants.
[ ] Repository scopes collection queries before pagination/sorting.
[ ] Export/report/download paths use same or stronger authorization than UI views.
[ ] Async jobs store authority model: user/system/service/admin.
[ ] Internal APIs verify caller service identity and delegated authority.
[ ] Tenant/agency/org boundary is applied in all data access paths.
[ ] Cache keys include tenant/scope or cache only raw internal data safely.
[ ] Transactional mutation checks authorization against current locked/versioned state.
[ ] Denial handling has consistent 401/403/404/masking semantics.
[ ] High-risk decisions are audited with reason/evidence/policy version.
[ ] Tests cover alternate paths: detail, search, export, report, file, batch, internal API.
[ ] Unknown route/action/resource/policy result denies by default.
```

---

## 33. Summary

Authorization in layered Java applications should not be treated as a single annotation, a single gateway rule, or a single role check. A mature system separates concerns:

```text
UI                  -> user guidance
Gateway             -> coarse route/client/channel boundary
Controller          -> function-level access
Application Service -> use-case and object-level decision
Domain              -> state/business invariant
Repository          -> data scope before query result materialization
Database            -> defense-in-depth for critical boundaries
Async/Internal      -> explicit authority and delegation model
Audit               -> reconstructable decision evidence
```

The most important principle:

> Centralize authorization decision logic, but enforce authorization wherever protected data or actions can be reached.

That is how layered applications avoid both extremes: chaotic duplicate checks and dangerous single-layer bypass.

---

## 34. References

1. Spring Security Reference — Authorization Architecture. `AuthorizationManager` is the central abstraction used by Spring Security authorization components for access control decisions.  
   <https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html>

2. OWASP Authorization Cheat Sheet. Recommends deny-by-default and centralized handling of access control checks.  
   <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>

3. OWASP Top 10:2021 — A01 Broken Access Control. Emphasizes deny-by-default and reusable access control mechanisms.  
   <https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/>

4. OWASP API Security 2023 — API1 Broken Object Level Authorization. Notes that APIs exposing object identifiers create a wide attack surface and need object-level authorization checks.  
   <https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/>

5. PostgreSQL Documentation — Row Security Policies. Describes row-level policies that restrict which rows normal queries and data modification commands can access.  
   <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>

6. PostgreSQL Documentation — CREATE POLICY. Defines row-level security policies for SELECT, INSERT, UPDATE, and DELETE.  
   <https://www.postgresql.org/docs/current/sql-createpolicy.html>

---

## 35. Status Seri

```text
[x] Part 0  — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1  — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2  — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
[x] Part 3  — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4  — RBAC Done Properly: Role-Based Access Control Beyond ADMIN
[x] Part 5  — Permission and Capability Modeling
[x] Part 6  — ABAC: Attribute-Based Authorization
[x] Part 7  — PBAC and Policy-as-Code
[x] Part 8  — ReBAC: Relationship-Based Authorization
[x] Part 9  — ACL and Domain Object Security
[x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
[x] Part 11 — IDOR, BOLA, and Object-Level Authorization
[x] Part 12 — Authorization in Layered Java Applications
[ ] Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
```

Seri belum selesai. Lanjut ke Part 13.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-011.md">⬅️ Part 11 — IDOR, BOLA, and Object-Level Authorization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-013.md">Part 13 — Spring Security Authorization: Servlet Stack Deep Dive ➡️</a>
</div>
