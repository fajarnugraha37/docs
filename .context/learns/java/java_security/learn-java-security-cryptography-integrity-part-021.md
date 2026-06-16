# learn-java-security-cryptography-integrity-part-021

# Part 21 — Authorization Integrity: Policy, Permission, and Confused Deputy

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `021 / 034`  
> Status seri: **belum selesai**  
> Fokus: authorization correctness, object-level authorization, policy enforcement, confused deputy, tenant boundary, delegation, dan authorization test matrix untuk sistem Java enterprise.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas token, JWT, JWS, JWE, OAuth2, dan OIDC. Semua itu menjawab pertanyaan besar:

> “Siapa user/client ini, bagaimana dia dibuktikan, dan apakah token/claim yang dia bawa valid?”

Tetapi setelah identity terbukti valid, sistem masih harus menjawab pertanyaan yang lebih sulit:

> “Apakah actor ini boleh melakukan action ini terhadap resource ini, dalam context ini, pada waktu ini, melalui channel ini, untuk tujuan ini?”

Itulah authorization.

Authorization sering tampak sederhana ketika contoh sistemnya kecil:

```java
if (user.hasRole("ADMIN")) {
    allow();
}
```

Tetapi di sistem nyata, terutama regulatory, case management, compliance, finance, government, atau multi-tenant platform, authorization bukan sekadar role check. Authorization adalah mekanisme menjaga **integrity of authority**.

Maksudnya:

- user tidak boleh membaca object yang bukan domain aksesnya;
- user tidak boleh mengubah state yang tidak boleh ia transisikan;
- service tidak boleh bertindak atas nama user melebihi delegation yang diberikan;
- background job tidak boleh mem-bypass business authorization;
- admin tidak otomatis boleh melakukan semua aksi tanpa purpose/audit;
- tenant boundary tidak boleh bocor walaupun ID object valid;
- resource-level permission tidak boleh hilang ketika request pindah dari API ke service, repository, queue, batch, atau event handler.

Part ini bertujuan membangun mental model authorization yang kuat untuk Java engineer senior.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. membedakan authentication, authorization, entitlement, permission, policy, dan delegation;
2. mendesain authorization sebagai invariant, bukan annotation kosmetik;
3. mengenali Broken Object Level Authorization/BOLA, IDOR, dan object property authorization;
4. memahami PDP, PEP, PIP, PAP, RBAC, ABAC, ReBAC, dan hybrid model;
5. mendesain object-level authorization untuk domain Java enterprise;
6. mencegah confused deputy di service-to-service dan background processing;
7. membuat authorization matrix yang bisa diuji;
8. membangun review checklist untuk endpoint, service, repository, batch, event, dan admin function.

---

## 2. Core Mental Model

Authorization adalah jawaban terhadap pertanyaan:

```text
Can subject S perform action A on resource R under context C?
```

Secara formal:

```text
decision = authorize(subject, action, resource, context)
```

Contoh:

```text
Can Officer-123 approve Case-987 at stage LEGAL_REVIEW from intranet channel during active assignment window?
```

Atau:

```text
Can Service-A download Document-456 on behalf of User-789 for Case-987 where User-789 belongs to Agency-X and document classification is RESTRICTED?
```

Elemen pentingnya:

| Elemen | Pertanyaan | Contoh |
|---|---|---|
| Subject | Siapa actor yang meminta? | user, service, job, integration partner |
| Action | Apa yang ingin dilakukan? | read, create, update, approve, export, assign, delete |
| Resource | Object apa yang ditargetkan? | case, application, appeal, document, audit record |
| Context | Kondisi tambahan apa yang relevan? | tenant, assignment, stage, time, channel, IP, device, purpose |
| Policy | Rule apa yang menentukan boleh/tidak? | role, ownership, workflow state, data classification |
| Decision | Hasilnya apa? | permit, deny, abstain, challenge, step-up |
| Obligation | Jika permit, syarat tambahan apa? | audit, mask field, require reason, require supervisor approval |

Kesalahan umum adalah memperlakukan authorization sebagai:

```text
role -> endpoint
```

Padahal di sistem nyata, authorization lebih tepat dimodelkan sebagai:

```text
subject + action + resource + context -> decision + obligations
```

---

## 3. Authentication vs Authorization vs Entitlement

### 3.1 Authentication

Authentication membuktikan identity.

Pertanyaan:

```text
Are you who you claim to be?
```

Contoh:

- login dengan password/MFA;
- OIDC ID token valid;
- mTLS client certificate valid;
- service identity valid;
- API key valid.

Authentication menghasilkan identity signal:

```text
subject = user:123
client = aceas-web
issuer = https://idp.example.gov
amr = [pwd, mfa]
auth_time = 2026-06-16T10:00:00Z
```

Tetapi identity signal belum berarti boleh melakukan sesuatu.

### 3.2 Authorization

Authorization menentukan hak akses.

Pertanyaan:

```text
Given who you are, what are you allowed to do here?
```

Authorization butuh identity, tetapi tidak cukup hanya identity.

Contoh:

```text
User Fajar is authenticated.
```

Itu belum menjawab:

```text
Can Fajar approve this appeal?
Can Fajar view this restricted document?
Can Fajar export this report?
Can Fajar assign the case to someone else?
Can Fajar act for another agency?
```

### 3.3 Entitlement

Entitlement adalah hak yang diberikan kepada subject.

Contoh:

```text
ROLE_CASE_OFFICER
PERMISSION_CASE_READ
PERMISSION_CASE_APPROVE
AGENCY_CEA
MODULE_APPEAL_ACCESS
```

Entitlement biasanya berasal dari:

- identity provider;
- IAM;
- user management module;
- organization hierarchy;
- workflow assignment;
- delegation table;
- case team membership;
- license/subscription;
- external registry.

Tetapi entitlement masih perlu dievaluasi terhadap resource dan context.

Contoh:

```text
PERMISSION_CASE_APPROVE
```

tidak otomatis berarti user boleh approve semua case. Mungkin hanya case yang:

- berada dalam agency-nya;
- sedang assigned ke dia;
- stage-nya `PENDING_APPROVAL`;
- belum expired;
- bukan case yang dia sendiri buat;
- tidak membutuhkan second approval;
- tidak restricted karena conflict of interest.

### 3.4 Permission

Permission adalah ability granular.

Contoh:

```text
case.read
case.update
case.approve
case.assign
case.close
document.download
audit.view
report.export
```

Permission lebih stabil daripada role.

Role adalah grouping:

```text
ROLE_CASE_OFFICER = [case.read, case.update, document.read]
ROLE_CASE_APPROVER = [case.read, case.approve, document.read]
```

Desain senior biasanya tidak menulis business rule langsung ke nama role, tetapi memakai permission/action semantics.

Buruk:

```java
if (user.hasRole("SENIOR_OFFICER")) {
    approve(caseId);
}
```

Lebih baik:

```java
authorization.require(user, Action.CASE_APPROVE, caseResource, context);
```

Kenapa?

Karena role berubah karena organisasi, sedangkan action domain lebih stabil.

---

## 4. Authorization sebagai Integrity Problem

Authorization biasanya dikategorikan sebagai access control. Tetapi untuk engineer yang membangun workflow/regulatory system, authorization lebih kuat jika dipahami sebagai integrity problem.

Integrity yang dijaga:

```text
Only authorized transitions may change protected state.
```

Contoh invariant:

```text
A case can only be approved by an authorized approver who is not the submitter, belongs to the responsible agency, has active delegation, and performs approval while the case is in APPROVAL_PENDING state.
```

Ini bukan sekadar permission. Ini menjaga integrity proses.

Kalau invariant ini rusak:

- status case bisa berubah tidak sah;
- audit trail menjadi tidak defensible;
- decision legal/regulatory bisa dipertanyakan;
- actor bisa menyalahgunakan authority;
- downstream report, correspondence, payment, enforcement, dan notification ikut tercemar.

Authorization failure sering menjadi akar dari data integrity failure.

---

## 5. Threat Model Authorization

Authorization threat bukan hanya “hacker masuk”. Banyak authorization failure terjadi oleh authenticated user.

### 5.1 Threat Actors

| Actor | Contoh Ancaman |
|---|---|
| Anonymous attacker | mencoba endpoint tanpa login |
| Authenticated normal user | membaca object user lain |
| Internal officer | mengakses case di luar assignment |
| Privileged admin | melakukan action tanpa purpose/audit |
| Integration partner | mengirim request untuk resource bukan miliknya |
| Compromised service | memakai service credential untuk mengakses semua data |
| Background job | memproses object melewati policy runtime |
| Developer/operator | memakai script DB/API tanpa authorization control |

### 5.2 Common Attack Shape

Authorization attack sering sangat sederhana:

```http
GET /api/cases/1001
Authorization: Bearer token-of-user-A
```

ubah ID:

```http
GET /api/cases/1002
Authorization: Bearer token-of-user-A
```

Kalau `1002` milik user/agency lain dan masih bisa diakses, itu Broken Object Level Authorization.

OWASP API Security Top 10 menempatkan Broken Object Level Authorization sebagai risiko utama karena attacker dapat mengeksploitasi endpoint dengan memanipulasi object ID di request path, query, header, atau payload.

### 5.3 Authorization Attack Surface

Authorization harus diuji di semua tempat object reference muncul:

```text
/path/{id}
?caseId=...
headers
JSON body
nested object
bulk operation list
search filter
sort/filter field
export parameter
file download token
queue message
callback payload
GraphQL global ID
websocket channel
batch input file
```

Kesalahan fatal: hanya mengecek authorization di endpoint detail, tetapi lupa di export, search, download, bulk action, atau background reprocessing.

---

## 6. BOLA, IDOR, BFLA, and Object Property Authorization

### 6.1 IDOR

IDOR berarti Insecure Direct Object Reference.

Contoh:

```http
GET /documents/12345
```

Jika user bisa mengganti `12345` menjadi document lain dan mendapatkan akses, itu IDOR/BOLA.

IDOR adalah bentuk spesifik dari object-level authorization failure.

### 6.2 BOLA

Broken Object Level Authorization berarti sistem gagal memastikan subject boleh mengakses object tertentu.

Contoh buruk:

```java
@GetMapping("/cases/{caseId}")
public CaseDto getCase(@PathVariable long caseId) {
    return caseService.findById(caseId);
}
```

Mungkin endpoint sudah protected oleh login:

```java
@PreAuthorize("isAuthenticated()")
```

Tetapi itu hanya authentication-level gate. Belum membuktikan user boleh membaca `caseId` itu.

Lebih benar:

```java
@GetMapping("/cases/{caseId}")
public CaseDto getCase(@PathVariable long caseId, Authentication auth) {
    CaseResource resource = caseLookup.loadAuthorizationResource(caseId);
    authorization.require(auth, Action.CASE_READ, resource, RequestContext.current());
    return caseService.getCase(caseId);
}
```

Atau lebih kuat lagi, query-nya sendiri scoped:

```java
public Optional<Case> findReadableCase(UserId userId, CaseId caseId) {
    return repository.findByIdAndReadableBy(caseId, userId);
}
```

### 6.3 BFLA

Broken Function Level Authorization berarti user bisa memanggil function/action yang tidak seharusnya.

Contoh:

```http
POST /api/admin/users/123/disable
```

Normal user tidak boleh memanggil function admin.

BFLA biasanya action-level:

```text
Can subject perform this function at all?
```

BOLA biasanya object-level:

```text
Can subject perform this function on this object?
```

Di sistem nyata, keduanya harus ada.

```text
Function allowed?       case.approve permission
Object allowed?         this case belongs to user's agency and assignment
State allowed?          case is pending approval
Context allowed?        request from intranet and delegation active
```

### 6.4 Broken Object Property Level Authorization

Kadang user boleh melihat object, tapi tidak semua field.

Contoh:

```json
{
  "caseId": "C-1001",
  "status": "OPEN",
  "applicantName": "...",
  "internalAssessment": "...",
  "investigationNotes": "...",
  "legalAdvice": "...",
  "riskScore": 97
}
```

User mungkin boleh melihat case summary, tetapi tidak boleh melihat:

- investigation notes;
- legal advice;
- risk score;
- internal remarks;
- PII;
- enforcement strategy;
- audit metadata.

Maka authorization tidak hanya:

```text
Can read Case?
```

Tetapi juga:

```text
Can read Case.legalAdvice?
Can read Case.internalAssessment?
Can read Case.riskScore?
```

Ini penting untuk:

- search results;
- export CSV/PDF;
- detail API;
- GraphQL selection set;
- audit view;
- admin dashboard.

---

## 7. Role-Based Access Control: Useful but Insufficient Alone

RBAC memetakan user ke role dan role ke permission.

```text
User -> Roles -> Permissions
```

Contoh:

```text
Fajar -> CASE_OFFICER -> case.read, case.update
Akbar -> CASE_APPROVER -> case.read, case.approve
Admin -> USER_ADMIN -> user.create, user.disable
```

RBAC bagus untuk:

- coarse-grained module access;
- menu visibility;
- function enablement;
- stable enterprise role;
- compliance mapping;
- simple operation.

Tetapi RBAC lemah untuk:

- object ownership;
- tenant/agency boundary;
- workflow state;
- delegated authority;
- time-bound access;
- location/channel condition;
- conflict of interest;
- field-level access;
- emergency/break-glass access;
- purpose-based access.

Contoh bug:

```java
@PreAuthorize("hasRole('CASE_OFFICER')")
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable Long id) {
    return caseService.get(id);
}
```

Masalah:

```text
CASE_OFFICER dari Agency-A mungkin dapat membaca case milik Agency-B.
```

RBAC menjawab:

```text
Can this role call this endpoint?
```

Tetapi tidak menjawab:

```text
Can this subject access this object in this context?
```

---

## 8. Attribute-Based Access Control

ABAC mengambil keputusan berdasarkan attribute.

```text
subject attributes + resource attributes + action + environment attributes -> decision
```

Contoh subject attributes:

```text
userId
agencyId
roles
clearanceLevel
employmentStatus
delegations
trainingCompleted
```

Resource attributes:

```text
caseId
caseAgencyId
classification
ownerId
assignedOfficerId
stage
createdBy
conflictFlag
```

Environment/context attributes:

```text
time
channel
networkZone
deviceTrust
authenticationStrength
requestPurpose
```

Action:

```text
case.read
case.update
case.approve
document.download
report.export
```

Example policy:

```text
Permit case.approve if:
- subject has permission case.approve;
- subject.agencyId == resource.agencyId;
- resource.stage == PENDING_APPROVAL;
- subject.userId != resource.submittedBy;
- subject has active assignment or delegation;
- auth_time within last 30 minutes for high-risk approval;
- request channel is INTRANET.
```

ABAC lebih expressive daripada RBAC, tetapi lebih kompleks.

Risiko ABAC:

- policy terlalu tersebar;
- attribute source tidak konsisten;
- missing attribute default permit;
- policy sulit dites;
- debugging keputusan susah;
- performance buruk jika setiap check query banyak tabel;
- developer bypass karena API authorization terlalu berat.

ABAC yang baik harus punya:

- policy naming;
- centralized decision API;
- explainable decision;
- deny-by-default;
- typed attributes;
- test matrix;
- audit log untuk high-risk decision;
- caching yang tidak merusak freshness;
- clear separation antara decision dan enforcement.

---

## 9. Relationship-Based Access Control

ReBAC mengambil keputusan berdasarkan relationship graph.

Contoh relationship:

```text
user Fajar is assigned_to case C-1001
case C-1001 belongs_to agency CEA
document D-900 attached_to case C-1001
user Akbar supervises Fajar
user Laila is reviewer_of appeal A-700
```

Policy:

```text
User can view document if user can view parent case.
User can approve case if user supervises assigned officer and case is pending approval.
```

ReBAC cocok untuk:

- case assignment;
- organization hierarchy;
- team membership;
- document attached to parent resource;
- owner/collaborator model;
- delegation chain;
- supervisor approval;
- cross-agency access request.

Risiko ReBAC:

- graph traversal mahal;
- cycle handling;
- stale relationship;
- implicit access terlalu luas;
- hidden inherited access;
- sulit dijelaskan ke auditor jika tidak dicatat dengan baik.

---

## 10. Hybrid Authorization Model

Di enterprise Java system, model realistis biasanya hybrid:

```text
RBAC for coarse function access
+ ABAC for context/resource conditions
+ ReBAC for assignment/relationship
+ workflow guards for state transition
+ field policy for sensitive properties
+ audit obligations for high-risk actions
```

Contoh:

```text
Approve Enforcement Case
```

Keputusan:

| Layer | Check |
|---|---|
| Authentication | user session/token valid |
| RBAC | has permission `case.approve` |
| Tenant | user.agencyId == case.agencyId |
| ReBAC | user is assigned approver or delegated approver |
| Workflow | case.status == PENDING_APPROVAL |
| Separation of duty | user != case.createdBy and user != lastReviewer |
| Environment | intranet channel only |
| Freshness | MFA/auth_time recent |
| Obligation | audit decision reason and snapshot |

Dalam kode, jangan jadikan semua ini tersebar sebagai `if` liar di controller. Buat model eksplisit.

---

## 11. Policy Decision Point, Policy Enforcement Point, and Friends

ABAC/enterprise authorization sering memakai konsep:

| Komponen | Fungsi |
|---|---|
| PAP | Policy Administration Point: tempat policy dibuat/dikelola |
| PDP | Policy Decision Point: mengevaluasi request dan menghasilkan decision |
| PEP | Policy Enforcement Point: tempat decision ditegakkan |
| PIP | Policy Information Point: sumber attribute/context |
| PRP | Policy Retrieval Point: repository policy |

Flow:

```text
Request enters API
        |
        v
PEP intercepts request/action
        |
        v
PEP builds authorization request
        |
        v
PDP evaluates policy
        |
        +--> PIP fetches attributes
        |
        v
Decision: PERMIT / DENY / INDETERMINATE
        |
        v
PEP enforces decision
        |
        v
Business action runs only if permitted
```

Dalam Java application, bentuknya bisa sederhana:

```java
public interface AuthorizationService {
    AuthorizationDecision decide(
        Subject subject,
        Action action,
        ResourceRef resource,
        AuthorizationContext context
    );

    default void require(
        Subject subject,
        Action action,
        ResourceRef resource,
        AuthorizationContext context
    ) {
        AuthorizationDecision decision = decide(subject, action, resource, context);
        if (!decision.isPermit()) {
            throw new AccessDeniedException(decision.safeReason());
        }
    }
}
```

PEP bisa muncul di:

- API controller;
- application service;
- domain command handler;
- repository query scope;
- event consumer;
- scheduled job;
- file download handler;
- GraphQL resolver;
- admin tool;
- CLI/script wrapper.

PDP bisa berupa:

- in-process authorization service;
- policy engine;
- database-backed rule evaluator;
- OPA-like external service;
- IAM/entitlement service;
- custom domain authorization module.

PIP bisa berupa:

- user profile service;
- HR/organization directory;
- case assignment table;
- delegation table;
- tenant registry;
- resource metadata table;
- workflow state;
- session context;
- risk engine.

---

## 12. Deny-by-Default and Fail-Closed

Authorization harus default deny.

```text
If decision cannot be confidently permitted, deny.
```

Buruk:

```java
if (policyNotFound) {
    return Permit;
}
```

Lebih aman:

```java
if (policyNotFound) {
    return Deny("policy_not_found");
}
```

Buruk:

```java
try {
    authorization.require(...);
} catch (Exception e) {
    log.warn("Authorization failed, continuing", e);
}
```

Lebih aman:

```java
try {
    authorization.require(...);
} catch (AuthorizationUnavailableException e) {
    throw new ServiceUnavailableException("Authorization decision unavailable");
} catch (AccessDeniedException e) {
    throw e;
}
```

Fail-closed tidak selalu berarti return `403`. Kadang jika PDP down, response yang benar adalah `503`, bukan permit.

Decision taxonomy:

| Decision | Meaning | HTTP Example |
|---|---|---|
| Permit | allowed | 200/204 |
| Deny | known forbidden | 403 |
| Not authenticated | no valid subject | 401 |
| Resource hidden | deny and conceal existence | 404 |
| Indeterminate | cannot decide safely | 503 or 403 depending policy |
| Challenge | need stronger auth | 401/403 with step-up flow |

---

## 13. 401 vs 403 vs 404

Authorization API harus hati-hati dengan response.

### 13.1 401 Unauthorized

Walaupun namanya “Unauthorized”, dalam HTTP praktiknya 401 berarti unauthenticated atau authentication required.

Gunakan jika:

```text
No valid authentication credential.
```

### 13.2 403 Forbidden

Gunakan jika user authenticated tetapi tidak punya akses.

```text
Authenticated, but not allowed.
```

### 13.3 404 Not Found for Concealment

Kadang resource existence tidak boleh dibocorkan.

Contoh:

```http
GET /cases/C-Secret
```

Jika user tidak boleh tahu case itu ada, response lebih aman:

```text
404 Not Found
```

Tetapi internal audit tetap mencatat:

```text
Access denied: resource exists but subject unauthorized.
```

Rule praktis:

```text
External/user-facing response may conceal.
Internal audit must preserve truth.
```

---

## 14. Resource Loading and Authorization Order

Ada dilemma:

```text
Need resource attributes to authorize.
But loading resource may itself leak data.
```

Contoh:

```java
Case c = caseRepository.findById(caseId).orElseThrow(NotFound::new);
authorization.require(user, CASE_READ, c, ctx);
return mapper.toDto(c);
```

Risiko:

- object loaded sebelum authorization;
- lazy-loaded sensitive data mungkin sudah masuk memory/log;
- timing error membocorkan existence;
- repository method bisa dipakai ulang tanpa authorization.

Pattern lebih baik:

### 14.1 Authorization Resource Projection

Load metadata minimal untuk authorization:

```java
record CaseAuthResource(
    CaseId id,
    AgencyId agencyId,
    UserId ownerId,
    UserId assignedOfficerId,
    CaseStage stage,
    Classification classification
) {}
```

```java
CaseAuthResource authResource = caseAuthRepository.findAuthResource(caseId)
    .orElseThrow(ResourceNotFoundOrHidden::new);

authorization.require(subject, Action.CASE_READ, authResource, ctx);

CaseDetails details = caseRepository.findDetails(caseId)
    .orElseThrow(ResourceNotFound::new);
```

### 14.2 Scoped Query

Bawa authorization ke query:

```java
Optional<CaseDetails> findCaseReadableBy(CaseId caseId, SubjectId subjectId);
```

SQL idea:

```sql
select c.*
from cases c
join case_assignment a on a.case_id = c.id
where c.id = :caseId
  and c.agency_id = :subjectAgencyId
  and a.user_id = :subjectUserId
```

Kelebihan:

- existence leak lebih kecil;
- tidak perlu load full object yang tidak boleh;
- lebih natural untuk list/search.

Kekurangan:

- policy tersebar di SQL jika tidak hati-hati;
- sulit explain decision;
- rentan inkonsistensi antar query.

Pattern bagus sering menggabungkan keduanya:

```text
Central policy defines rule.
Repository provides authorized projection/query primitive.
Service enforces policy explicitly.
```

---

## 15. Authorization Placement in Layered Java Architecture

Pertanyaan besar:

> Authorization sebaiknya ditaruh di controller, service, domain, repository, atau database?

Jawaban matang:

```text
Put enforcement at every trust boundary where bypass is possible, but centralize decision semantics.
```

### 15.1 Controller/API Layer

Bagus untuk:

- authentication requirement;
- coarse function access;
- endpoint-level permission;
- request context extraction;
- early reject.

Contoh:

```java
@PreAuthorize("hasAuthority('case.read')")
@GetMapping("/cases/{id}")
public CaseDto getCase(...) { ... }
```

Tetapi controller saja tidak cukup.

Kenapa?

- service bisa dipanggil dari batch/job/event;
- endpoint lain bisa memakai service yang sama;
- internal API bisa bypass;
- object-level check sering butuh domain data.

### 15.2 Application Service Layer

Ini biasanya lokasi utama authorization use-case.

```java
public CaseDto getCase(GetCaseCommand command) {
    Subject subject = command.subject();
    CaseAuthResource resource = caseAuthRepository.get(command.caseId());
    authorization.require(subject, Action.CASE_READ, resource, command.context());
    return caseReader.getDetails(command.caseId(), subject.viewPolicy());
}
```

Application service tahu:

- actor;
- use-case;
- resource;
- transaction boundary;
- audit obligation.

### 15.3 Domain Layer

Domain layer cocok untuk invariant yang selalu benar, tidak peduli channel.

Contoh:

```java
case.approveBy(approver, clock);
```

Domain method bisa enforce:

```text
case stage must be PENDING_APPROVAL
approver must not be submitter
approval reason required
```

Namun domain entity biasanya tidak tahu semua identity context eksternal. Jadi jangan memaksa domain entity memanggil IAM.

Pattern:

```java
ApprovalAuthority authority = authorization.assertCanApprove(subject, caseResource, ctx);
case.approve(authority, reason, clock);
```

`ApprovalAuthority` adalah capability object yang membuktikan authorization sudah dilakukan.

### 15.4 Repository Layer

Repository cocok untuk data scoping.

```java
Page<CaseSummary> searchCasesVisibleTo(Subject subject, CaseSearchCriteria criteria);
```

Repository harus mencegah list/search membocorkan object tidak authorized.

Tetapi jangan jadikan repository sebagai satu-satunya authorization layer untuk state-changing action karena policy bisnis bisa hilang.

### 15.5 Database Layer

Database row-level security bisa sangat kuat untuk defense-in-depth.

Cocok untuk:

- multi-tenant hard boundary;
- reporting database;
- admin console;
- direct SQL access limitation;
- accidental query leak.

Risiko:

- policy split antara app dan DB;
- debugging sulit;
- migration complexity;
- app connection pool sering memakai satu DB user sehingga RLS butuh session variable yang aman.

### 15.6 Event/Consumer Layer

Event consumer juga harus authorize.

Misalnya message:

```json
{
  "action": "CASE_APPROVE",
  "caseId": "C-1001",
  "requestedBy": "user-123"
}
```

Consumer tidak boleh percaya message hanya karena datang dari broker.

Consumer harus memeriksa:

- producer identity;
- message integrity;
- requestedBy delegation;
- resource state;
- replay/idempotency;
- policy at processing time.

---

## 16. Capability Pattern

Capability pattern berguna untuk mencegah function dipanggil tanpa authorization.

Buruk:

```java
caseService.approve(caseId, userId, reason);
```

Service menerima raw `userId`, raw `caseId`, raw action. Semua orang bisa panggil jika punya referensi.

Lebih kuat:

```java
ApprovalCapability capability = authorization.issueApprovalCapability(subject, caseId, ctx);
caseService.approve(capability, reason);
```

`ApprovalCapability` memuat:

```java
public record ApprovalCapability(
    SubjectId subjectId,
    CaseId caseId,
    Instant issuedAt,
    PolicyVersion policyVersion,
    Set<Obligation> obligations
) {}
```

Domain service hanya menerima capability valid.

```java
public void approve(ApprovalCapability capability, ApprovalReason reason) {
    Case c = repository.get(capability.caseId());
    c.approveBy(capability.subjectId(), reason);
    audit.record(capability, "CASE_APPROVED");
}
```

Manfaat:

- authorization result menjadi explicit object;
- mengurangi bypass accidental;
- audit dapat menyimpan policy version;
- high-risk action bisa require specific capability;
- memisahkan permission check dari mutation.

Risiko:

- capability tidak boleh reusable terlalu lama;
- jangan serialisasi capability ke client sebagai bearer token tanpa crypto/signature;
- capability harus scoped, short-lived, dan bound ke subject/resource/action.

---

## 17. Confused Deputy Problem

Confused deputy terjadi ketika program/service yang punya authority tinggi dibujuk untuk menggunakan authority-nya demi actor yang tidak berhak.

Contoh sederhana:

```text
User cannot download restricted document directly.
But user can ask ReportService to generate report including that document.
ReportService has broad DB access.
ReportService returns restricted content.
```

ReportService menjadi deputy yang confused.

### 17.1 Service-to-Service Example

```text
Frontend API -> Document Service -> Storage Service
```

Jika Document Service memakai service credential superuser ke Storage Service tanpa membawa user context, Storage Service hanya tahu:

```text
caller = document-service
```

Ia tidak tahu:

```text
on behalf of user X
for case Y
for action document.download
```

Akibatnya, Document Service bisa tanpa sadar menjadi confused deputy.

### 17.2 Prevention

Gunakan konsep:

```text
caller identity + subject identity + delegation scope + purpose + resource
```

Service-to-service request harus membedakan:

| Identity | Meaning |
|---|---|
| Calling service | service teknis yang memanggil |
| End-user subject | user yang menjadi alasan request |
| Delegation | apakah service boleh bertindak on behalf of user |
| Purpose | tujuan akses |
| Resource scope | object yang boleh diakses |

Contoh context:

```json
{
  "callerService": "case-api",
  "subject": "user-123",
  "action": "document.download",
  "resource": "document-456",
  "purpose": "case-review",
  "correlationId": "...",
  "delegation": "user-delegated"
}
```

### 17.3 Do Not Use Service Credential as Universal Bypass

Buruk:

```text
If caller is internal service, allow all.
```

Lebih baik:

```text
If caller is internal service, authenticate service.
Then evaluate whether service is allowed to perform requested action for subject/resource/context.
```

Service authentication dan business authorization adalah dua hal berbeda.

---

## 18. Tenant Boundary and Agency Boundary

Multi-tenant authorization harus dianggap sebagai hard security boundary.

Tenant boundary invariant:

```text
A subject from tenant T must never read, modify, infer, export, search, or receive events for tenant U unless an explicit cross-tenant policy permits it.
```

Masalah umum:

### 18.1 Detail Endpoint Aman, Search Endpoint Bocor

Detail:

```sql
select * from cases where id = ? and tenant_id = ?
```

Search:

```sql
select * from cases where status = ?
```

Search lupa tenant filter.

### 18.2 Export Endpoint Bocor

UI list scoped, tetapi export memakai query berbeda.

```text
UI shows 50 authorized rows.
CSV export returns 10,000 rows across tenant.
```

### 18.3 Background Job Bocor

Job memproses semua tenant dan mengirim notification ke wrong party karena tenant context hilang.

### 18.4 Cache Key Tidak Include Tenant

Buruk:

```text
cache key = caseId
```

Lebih aman:

```text
cache key = tenantId + caseId + viewPolicyVersion
```

### 18.5 Object ID Global Tidak Cukup

Menggunakan UUID tidak menyelesaikan authorization.

```text
Unpredictable IDs reduce enumeration.
They do not prove access rights.
```

---

## 19. Workflow Authorization

Dalam regulatory/case workflow, authorization sering bergantung pada state.

Contoh state:

```text
DRAFT -> SUBMITTED -> REVIEWING -> PENDING_APPROVAL -> APPROVED -> CLOSED
```

Action matrix:

| State | Submitter | Officer | Approver | Admin |
|---|---:|---:|---:|---:|
| DRAFT | edit/submit | no | no | limited |
| SUBMITTED | read | assign | no | limited |
| REVIEWING | read | update/recommend | no | limited |
| PENDING_APPROVAL | read | read | approve/reject | limited |
| APPROVED | read | read | read | limited |
| CLOSED | read | read | read | limited/reopen |

Authorization rule tidak boleh hanya melihat role.

Buruk:

```java
if (user.hasRole("APPROVER")) {
    approve(caseId);
}
```

Lebih benar:

```text
role permits function
AND case state permits transition
AND user is assigned approver
AND separation of duty holds
AND required evidence exists
AND approval reason supplied
```

Workflow authorization harus dekat dengan state machine invariant.

---

## 20. Separation of Duties

Separation of duties mencegah satu actor mengontrol seluruh proses kritis.

Contoh invariant:

```text
The same user who created a case cannot approve it.
The same officer who recommended enforcement cannot be final legal approver.
Payment setup and payment approval require different users.
Emergency override requires supervisor review.
```

Implementation idea:

```java
public AuthorizationDecision canApprove(Subject subject, CaseAuthResource c, Context ctx) {
    if (!subject.hasPermission("case.approve")) return deny("missing_permission");
    if (!subject.agencyId().equals(c.agencyId())) return deny("agency_mismatch");
    if (!c.stage().equals(PENDING_APPROVAL)) return deny("invalid_stage");
    if (subject.userId().equals(c.submittedBy())) return deny("same_as_submitter");
    if (c.lastReviewedBy().equals(subject.userId())) return deny("same_as_reviewer");
    return permitWithObligation(AUDIT_DECISION_REASON);
}
```

Separation of duties harus diuji sebagai security test, bukan hanya business test.

---

## 21. Delegation and Acting on Behalf Of

Delegation berarti user/service bertindak atas authority pihak lain.

Contoh:

```text
Officer A delegates case handling to Officer B from 2026-06-01 to 2026-06-30.
Service X acts on behalf of User Y to fetch documents for report generation.
```

Delegation harus explicit:

```text
delegator
delegatee
scope
action/resource limit
start/end time
reason
revocation status
audit trail
```

Buruk:

```text
If supervisor, can act as subordinate for everything.
```

Lebih benar:

```text
Supervisor may approve specific delegated action for specific case/module/time window, with audit obligation.
```

Java model:

```java
public record Delegation(
    UserId delegator,
    UserId delegatee,
    Set<Action> actions,
    ResourceScope scope,
    Instant validFrom,
    Instant validUntil,
    DelegationStatus status
) {
    boolean isActiveAt(Instant now) {
        return status == DelegationStatus.ACTIVE
            && !now.isBefore(validFrom)
            && now.isBefore(validUntil);
    }
}
```

Authorization context should preserve both:

```text
actualActor = user-B
onBehalfOf = user-A
```

Audit must not collapse them into one.

---

## 22. Admin Access Is Not a Magic Bypass

Admin functions are dangerous because teams often implement:

```java
if (user.isAdmin()) allowAll();
```

This destroys authorization integrity.

Admin access should be:

- scoped;
- purpose-bound;
- audited;
- sometimes step-up authenticated;
- sometimes require dual control;
- sometimes read-only by default;
- sometimes prevented from acting on own record;
- separated between system admin and business admin.

Admin taxonomy:

| Admin Type | Scope |
|---|---|
| System admin | technical config, not business decision |
| User admin | user lifecycle, not case approval |
| Case admin | case reassignment, not final approval |
| Audit admin | audit review, not audit modification |
| Break-glass admin | emergency access, heavily audited |

Rule:

```text
Admin is a role with specific permissions, not permission to violate invariants.
```

---

## 23. Field-Level Authorization and Data Masking

Authorization can modify representation, not only allow/deny.

Decision can include obligations:

```text
Permit case.read, but mask NRIC.
Permit document.view, but redact legal advice.
Permit report.export, but exclude investigation notes.
```

DTO mapping must be policy-aware.

Buruk:

```java
return caseMapper.toDto(caseEntity);
```

Lebih baik:

```java
ViewPolicy viewPolicy = authorization.viewPolicy(subject, caseResource, ctx);
return caseMapper.toDto(caseEntity, viewPolicy);
```

Example:

```java
public CaseDto toDto(Case c, ViewPolicy policy) {
    return new CaseDto(
        c.id(),
        c.status(),
        policy.canViewPii() ? c.applicantName() : Masking.maskName(c.applicantName()),
        policy.canViewLegalAdvice() ? c.legalAdvice() : null,
        policy.canViewRiskScore() ? c.riskScore() : null
    );
}
```

Important:

```text
Do not fetch and serialize sensitive fields accidentally.
```

Field-level authorization must apply consistently across:

- detail API;
- list API;
- search index;
- export;
- report;
- notification;
- audit screen;
- internal dashboard.

---

## 24. Authorization for Search, List, and Export

Search/list endpoints are common leak points.

Bad:

```java
@GetMapping("/cases")
public Page<CaseSummary> search(CaseSearchCriteria criteria) {
    return repository.search(criteria);
}
```

Better:

```java
@GetMapping("/cases")
public Page<CaseSummary> search(CaseSearchCriteria criteria, Authentication auth) {
    Subject subject = subjectFactory.from(auth);
    SearchScope scope = authorization.searchScope(subject, Action.CASE_SEARCH, ctx);
    return repository.search(criteria, scope);
}
```

`SearchScope` can include:

```text
tenantId
agencyIds
allowedClassifications
assignedOnly
includeClosed
fieldMaskingPolicy
maxExportRows
```

Export must not reuse broader query than UI.

Safe pattern:

```text
Search and export must use the same authorization scope builder.
```

If export includes data not visible in UI, that must be a deliberate policy, not accidental implementation drift.

---

## 25. Authorization and Caching

Caching can silently break authorization.

### 25.1 Cached Resource Without Subject Scope

Bad:

```text
cache key = /cases/1001
```

If response differs per user, this leaks data.

Better:

```text
cache key = subjectScopeHash + action + resourceId + viewPolicyVersion
```

### 25.2 Cached Decision Too Long

Authorization decisions can become stale after:

- role revoked;
- delegation expired;
- case reassigned;
- classification changed;
- user suspended;
- policy updated;
- tenant relationship removed.

Decision cache must consider:

```text
TTL
policy version
subject version
resource version
relationship version
revocation event
```

### 25.3 Permission in JWT Stale

JWT may include roles/permissions. If token lifetime is long, revoked permission may remain active.

Mitigations:

- short token lifetime;
- introspection for high-risk actions;
- session revocation list;
- subject version claim;
- policy version claim;
- step-up for sensitive action;
- do not put dynamic object-level permission inside long-lived token.

---

## 26. Authorization and Event-Driven Systems

In event-driven systems, request context often disappears.

Example:

```text
User clicks Approve
API emits CaseApprovalRequested
Worker consumes and approves case
```

Security question:

```text
Who authorized the approval?
At what time?
Under what policy version?
Was the authorization still valid when processed?
Can the message be replayed?
```

Pattern:

### 26.1 Command Event Must Carry Authorization Evidence

```json
{
  "commandId": "cmd-123",
  "type": "CASE_APPROVAL_REQUESTED",
  "caseId": "C-1001",
  "requestedBy": "user-123",
  "authorizedAt": "2026-06-16T10:30:00Z",
  "policyVersion": "authz-policy-2026-06-01",
  "decisionId": "authz-dec-789",
  "reason": "meets approval policy",
  "expiresAt": "2026-06-16T10:35:00Z"
}
```

### 26.2 Consumer Must Revalidate or Validate Capability

For low-risk actions:

```text
validate signed authorization capability and expiry
```

For high-risk actions:

```text
revalidate at execution time
```

### 26.3 Replay Protection

Use:

- command ID;
- idempotency table;
- expiry;
- subject/resource binding;
- signature/MAC if crossing trust boundary;
- state transition guard.

---

## 27. Authorization and Database Transactions

Authorization and mutation must be consistent.

Bad flow:

```text
1. Load case state = PENDING_APPROVAL
2. Authorize user for approval
3. Another transaction changes assignment/state
4. Approve based on stale decision
```

Mitigations:

### 27.1 Recheck Inside Transaction

```java
@Transactional
public void approve(ApproveCommand cmd) {
    Case c = caseRepository.lockById(cmd.caseId());
    authorization.require(cmd.subject(), Action.CASE_APPROVE, CaseAuthResource.from(c), cmd.context());
    c.approve(cmd.subject().userId(), cmd.reason());
}
```

### 27.2 Optimistic Locking

```text
Approve only if version matches state used during authorization.
```

### 27.3 State Transition Guard

Even after authorization, domain object must reject invalid state transition.

```java
if (stage != PENDING_APPROVAL) {
    throw new InvalidTransitionException(...);
}
```

Security principle:

```text
Authorization permits attempt; domain invariant permits mutation.
Both are required.
```

---

## 28. Java Implementation Model

A clean Java authorization model can be built with typed concepts.

### 28.1 Subject

```java
public record Subject(
    SubjectId id,
    TenantId tenantId,
    Set<Role> roles,
    Set<Permission> permissions,
    AuthenticationStrength authenticationStrength,
    Optional<SubjectId> onBehalfOf
) {
    public boolean hasPermission(Permission p) {
        return permissions.contains(p);
    }
}
```

### 28.2 Action

```java
public enum Action {
    CASE_READ,
    CASE_UPDATE,
    CASE_APPROVE,
    CASE_ASSIGN,
    DOCUMENT_DOWNLOAD,
    REPORT_EXPORT,
    AUDIT_VIEW
}
```

### 28.3 Resource

```java
public sealed interface Resource permits CaseResource, DocumentResource, ReportResource {
    ResourceId id();
    TenantId tenantId();
    Classification classification();
}
```

```java
public record CaseResource(
    CaseId id,
    TenantId tenantId,
    AgencyId agencyId,
    CaseStage stage,
    SubjectId submittedBy,
    Optional<SubjectId> assignedOfficer,
    Classification classification
) implements Resource {}
```

### 28.4 Context

```java
public record AuthorizationContext(
    Instant now,
    Channel channel,
    NetworkZone networkZone,
    CorrelationId correlationId,
    Optional<Purpose> purpose,
    Optional<String> clientId
) {}
```

### 28.5 Decision

```java
public sealed interface AuthorizationDecision permits Permit, Deny, Indeterminate {
    boolean isPermit();
    String safeReason();
    Set<Obligation> obligations();
}
```

```java
public record Permit(Set<Obligation> obligations) implements AuthorizationDecision {
    public boolean isPermit() { return true; }
    public String safeReason() { return "permitted"; }
}

public record Deny(String code, Set<Obligation> obligations) implements AuthorizationDecision {
    public boolean isPermit() { return false; }
    public String safeReason() { return code; }
}

public record Indeterminate(String code, Set<Obligation> obligations) implements AuthorizationDecision {
    public boolean isPermit() { return false; }
    public String safeReason() { return code; }
}
```

### 28.6 Policy

```java
public interface AuthorizationPolicy<R extends Resource> {
    boolean supports(Action action, R resource);

    AuthorizationDecision decide(
        Subject subject,
        Action action,
        R resource,
        AuthorizationContext context
    );
}
```

### 28.7 Example Case Approval Policy

```java
public final class CaseApprovalPolicy implements AuthorizationPolicy<CaseResource> {

    @Override
    public boolean supports(Action action, CaseResource resource) {
        return action == Action.CASE_APPROVE;
    }

    @Override
    public AuthorizationDecision decide(
        Subject subject,
        Action action,
        CaseResource resource,
        AuthorizationContext context
    ) {
        if (!subject.hasPermission(Permission.CASE_APPROVE)) {
            return deny("missing_permission");
        }

        if (!subject.tenantId().equals(resource.tenantId())) {
            return deny("tenant_mismatch");
        }

        if (resource.stage() != CaseStage.PENDING_APPROVAL) {
            return deny("invalid_case_stage");
        }

        if (subject.id().equals(resource.submittedBy())) {
            return deny("separation_of_duties_violation");
        }

        if (context.channel() != Channel.INTRANET) {
            return deny("channel_not_allowed");
        }

        return new Permit(Set.of(
            Obligation.RECORD_AUTHORIZATION_DECISION,
            Obligation.REQUIRE_APPROVAL_REASON
        ));
    }

    private Deny deny(String code) {
        return new Deny(code, Set.of(Obligation.RECORD_DENIAL));
    }
}
```

### 28.8 Central Authorization Service

```java
public final class DefaultAuthorizationService implements AuthorizationService {

    private final List<AuthorizationPolicy<?>> policies;
    private final AuthorizationAudit audit;

    public DefaultAuthorizationService(
        List<AuthorizationPolicy<?>> policies,
        AuthorizationAudit audit
    ) {
        this.policies = List.copyOf(policies);
        this.audit = audit;
    }

    @Override
    public AuthorizationDecision decide(
        Subject subject,
        Action action,
        Resource resource,
        AuthorizationContext context
    ) {
        AuthorizationDecision decision = policies.stream()
            .filter(policy -> supports(policy, action, resource))
            .findFirst()
            .map(policy -> decideUnchecked(policy, subject, action, resource, context))
            .orElse(new Deny("policy_not_found", Set.of(Obligation.RECORD_DENIAL)));

        audit.record(subject, action, resource, context, decision);
        return decision;
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static boolean supports(AuthorizationPolicy policy, Action action, Resource resource) {
        return policy.supports(action, resource);
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static AuthorizationDecision decideUnchecked(
        AuthorizationPolicy policy,
        Subject subject,
        Action action,
        Resource resource,
        AuthorizationContext context
    ) {
        return policy.decide(subject, action, resource, context);
    }
}
```

This is a simplified shape, not a full framework. The important idea is explicit modeling.

---

## 29. Annotation-Based Authorization: Useful but Dangerous Alone

Java/Spring applications often use annotations:

```java
@PreAuthorize("hasAuthority('case.approve')")
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable Long id) { ... }
```

Annotation is useful for:

- coarse action gate;
- readability;
- declarative access;
- common endpoint protection.

But annotation-only authorization is dangerous when:

- object-level attributes are not checked;
- method called internally bypasses proxy;
- service reused by job/consumer;
- SpEL becomes too complex;
- policy is duplicated in annotations;
- tests only cover “has role” not “has access to object”.

Better pattern:

```java
@PreAuthorize("hasAuthority('case.approve')")
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable CaseId id, @RequestBody ApproveRequest request) {
    approveCaseUseCase.execute(new ApproveCaseCommand(currentSubject(), id, request.reason(), currentContext()));
}
```

Then inside use case:

```java
CaseAuthResource resource = caseAuthRepository.get(id);
authorization.require(subject, Action.CASE_APPROVE, resource, context);
caseApprovalService.approve(id, subject, reason);
```

Coarse annotation + explicit domain authorization is safer than annotation only.

---

## 30. Authorization Matrix

Authorization matrix converts policy into testable form.

Example for case approve:

| Scenario | Role | Same Tenant | Assigned | Stage | Submitter? | Channel | Expected |
|---|---|---:|---:|---|---:|---|---|
| valid approver | approver | yes | yes | pending | no | intranet | permit |
| missing permission | officer | yes | yes | pending | no | intranet | deny |
| wrong tenant | approver | no | yes | pending | no | intranet | deny |
| not assigned | approver | yes | no | pending | no | intranet | deny |
| wrong state | approver | yes | yes | closed | no | intranet | deny |
| same submitter | approver | yes | yes | pending | yes | intranet | deny |
| internet channel | approver | yes | yes | pending | no | internet | deny |
| delegation expired | approver | yes | delegated | pending | no | intranet | deny |

This matrix should become tests.

JUnit example:

```java
@ParameterizedTest
@MethodSource("caseApprovalScenarios")
void caseApprovalPolicyMustMatchMatrix(CaseApprovalScenario s) {
    AuthorizationDecision decision = policy.decide(
        s.subject(),
        Action.CASE_APPROVE,
        s.resource(),
        s.context()
    );

    assertThat(decision.isPermit()).isEqualTo(s.expectedPermit());
}
```

---

## 31. Testing Object-Level Authorization

### 31.1 Horizontal Access Test

```text
User A can access own/assigned object.
User A cannot access User B/Agency B object.
```

### 31.2 Vertical Access Test

```text
Normal user cannot call admin/high privilege function.
```

### 31.3 Cross-Tenant Test

```text
Tenant A cannot search/export/download Tenant B data.
```

### 31.4 State-Based Test

```text
Action allowed in state X but denied in state Y.
```

### 31.5 Field-Level Test

```text
Field hidden/masked for subject lacking permission.
```

### 31.6 Bulk Operation Test

```text
If request contains [authorizedId, unauthorizedId], system must not process unauthorizedId.
```

Decision options for bulk:

```text
fail entire request
process authorized subset and report denied subset
```

Do not silently process unauthorized object.

### 31.7 Search/Export Equivalence Test

```text
Export result must be subset/equivalent to authorized search scope.
```

### 31.8 Cache Isolation Test

```text
Response cached for User A must not be served to User B.
```

### 31.9 Revocation Test

```text
After role/delegation revoked, access is denied within expected revocation window.
```

---

## 32. Security Review Heuristics

When reviewing Java code, these should trigger authorization scrutiny:

### 32.1 Raw ID Lookup

```java
repository.findById(id)
```

Ask:

```text
Where is object-level authorization checked?
```

### 32.2 Controller Has Only Role Check

```java
@PreAuthorize("hasRole('USER')")
```

Ask:

```text
Does this endpoint operate on object ID? If yes, where is object permission checked?
```

### 32.3 Export Endpoint

Ask:

```text
Does export use same authorization scope as search/list?
```

### 32.4 Bulk Operation

Ask:

```text
Are all IDs individually authorized?
What happens to mixed authorized/unauthorized IDs?
```

### 32.5 Background Job

Ask:

```text
Is this job allowed to bypass user policy?
If yes, why and how audited?
```

### 32.6 Service Credential

Ask:

```text
Does internal service credential imply all access?
Where is on-behalf-of checked?
```

### 32.7 Admin Shortcut

Ask:

```text
Does admin bypass tenant/workflow/separation-of-duty invariant?
```

### 32.8 DTO Mapper

Ask:

```text
Are sensitive fields masked based on view policy?
```

### 32.9 Cache

Ask:

```text
Does cache key include subject/scope/view policy when response is access-dependent?
```

### 32.10 Queue Consumer

Ask:

```text
Can a forged/replayed message cause unauthorized state change?
```

---

## 33. Common Anti-Patterns

### 33.1 “Authenticated Means Authorized”

```java
@PreAuthorize("isAuthenticated()")
```

This is not object-level authorization.

### 33.2 “UUID Means Safe”

UUID makes guessing harder, not authorization correct.

### 33.3 “Frontend Hides Button”

UI hiding is UX, not security.

Backend must enforce.

### 33.4 “Admin Can Do Everything”

Admin bypass can violate legal/business invariant.

### 33.5 “Internal Network Means Trusted”

Internal caller can be compromised or confused.

### 33.6 “Service Account Means Allow”

Service identity authenticates service, not business authority.

### 33.7 “Policy in Comments/Jira”

If not represented in code/tests, it will drift.

### 33.8 “Search Is Less Sensitive Than Detail”

Search often leaks more via aggregation and enumeration.

### 33.9 “Export Uses Admin Query Because Easier”

Export is one of the highest-risk data exfiltration paths.

### 33.10 “Authorization Only at Controller”

Anything that calls service outside controller can bypass.

---

## 34. Production Failure Modes

### 34.1 Role Revoked but JWT Still Valid

Impact:

```text
User keeps access until token expiry.
```

Mitigation:

- short TTL;
- high-risk introspection;
- subject version;
- revocation list;
- force re-auth for sensitive actions.

### 34.2 Case Reassigned but Old Assignee Still Can Act

Impact:

```text
Unauthorized workflow transition.
```

Mitigation:

- recheck assignment inside transaction;
- event-driven invalidation;
- authorization decision TTL;
- optimistic lock.

### 34.3 Cross-Tenant Cache Leak

Impact:

```text
Tenant A sees Tenant B data.
```

Mitigation:

- tenant-aware cache key;
- disable shared cache for sensitive responses;
- response Vary headers;
- integration tests.

### 34.4 Bulk Endpoint Partial Bypass

Impact:

```text
Attacker submits list with unauthorized IDs.
```

Mitigation:

- authorize each ID;
- fail closed;
- log denied IDs;
- set max bulk size.

### 34.5 Confused Report Generator

Impact:

```text
User obtains restricted data through generated report.
```

Mitigation:

- report-specific authorization scope;
- field-level policy;
- purpose-bound access;
- audit report data scope.

### 34.6 Debug/Admin Endpoint Exposed

Impact:

```text
Powerful operation reachable by normal/internal actor.
```

Mitigation:

- separate admin auth;
- network restriction;
- strong audit;
- dual control;
- no business invariant bypass.

---

## 35. Observability and Audit for Authorization

Authorization failures should be observable, but not leak sensitive data.

Log fields:

```text
correlationId
subjectId
actualActor
onBehalfOf
clientId
action
resourceType
resourceId or hashed resourceId
tenantId
policyVersion
decision
reasonCode
obligations
channel
```

Avoid logging:

- access token;
- full PII;
- secrets;
- sensitive document content;
- overly detailed denial reason to external user.

External response:

```json
{
  "error": "forbidden",
  "correlationId": "..."
}
```

Internal audit:

```json
{
  "event": "AUTHORIZATION_DENIED",
  "subject": "user-123",
  "action": "CASE_APPROVE",
  "resource": "case:C-1001",
  "reason": "separation_of_duties_violation",
  "policyVersion": "2026-06-01",
  "correlationId": "..."
}
```

Authorization audit is especially important for:

- denied high-risk actions;
- admin access;
- break-glass access;
- cross-tenant attempts;
- export/report generation;
- delegated action;
- policy changes.

---

## 36. Mini Case Study: Regulatory Case Approval

### 36.1 Scenario

A regulatory case system has:

- cases;
- officers;
- approvers;
- agencies;
- evidence documents;
- audit trail;
- workflow state;
- report export;
- delegated approvals.

Requirement:

```text
Only assigned approvers from the same agency may approve a case in PENDING_APPROVAL. The approver must not be the submitter or last reviewer. Approval from internet channel is not allowed. Every approval requires reason and audit record.
```

### 36.2 Threats

| Threat | Example |
|---|---|
| BOLA | approver changes caseId to another agency case |
| BFLA | officer calls approve endpoint |
| State bypass | approve CLOSED case |
| Separation violation | submitter approves own case |
| Confused deputy | report service exposes restricted evidence |
| Delegation abuse | expired delegation still works |
| Export leak | export ignores agency scope |

### 36.3 Policy

```text
Permit CASE_APPROVE if:
1. subject is authenticated;
2. subject has permission case.approve;
3. subject.tenantId == case.tenantId;
4. subject.agencyId == case.agencyId;
5. case.stage == PENDING_APPROVAL;
6. subject is assigned approver or active delegated approver;
7. subject != case.submittedBy;
8. subject != case.lastReviewedBy;
9. context.channel == INTRANET;
10. approval reason is supplied;
11. audit obligation can be fulfilled.
Otherwise deny.
```

### 36.4 Application Flow

```text
HTTP POST /cases/{id}/approve
        |
        v
Authenticate token/session
        |
        v
Check coarse permission case.approve
        |
        v
Load CaseAuthResource with minimal fields
        |
        v
AuthorizationService.require(CASE_APPROVE)
        |
        v
Start transaction / lock case
        |
        v
Recheck authorization-relevant state
        |
        v
Domain transition approve
        |
        v
Write audit record with decisionId/policyVersion
        |
        v
Publish CaseApproved event
```

### 36.5 Why Recheck Inside Transaction?

Because between the initial check and mutation:

- case could be reassigned;
- case could be approved by another approver;
- delegation could be revoked;
- case state could change.

For high-integrity workflow, authorization must be tied to the state being mutated.

---

## 37. Production Checklist

Before releasing an authorization-sensitive Java feature, verify:

### Model

- [ ] Subject, action, resource, and context are explicit.
- [ ] Authentication is not treated as authorization.
- [ ] Role is not the only control for object-level access.
- [ ] Tenant/agency boundary is represented as invariant.
- [ ] Workflow state is part of authorization where relevant.
- [ ] Separation of duties is explicit.
- [ ] Delegation is explicit, scoped, time-bound, and auditable.

### Enforcement

- [ ] Endpoint has coarse permission gate.
- [ ] Application service enforces object-level policy.
- [ ] Repository query is scoped for list/search/export.
- [ ] High-risk mutation rechecks authorization-relevant state inside transaction.
- [ ] Background job/consumer has equivalent authorization model.
- [ ] Service-to-service calls avoid confused deputy.
- [ ] Admin functions do not bypass core invariants.

### Data

- [ ] Sensitive fields have field-level policy.
- [ ] DTO mapping is policy-aware.
- [ ] Export/report uses same or stricter scope than UI/search.
- [ ] Cache keys include tenant/subject/scope where needed.
- [ ] Search index does not expose unauthorized fields.

### Failure Behavior

- [ ] Default is deny.
- [ ] Policy not found denies.
- [ ] PDP unavailable does not permit.
- [ ] 401/403/404 behavior is deliberate.
- [ ] External denial message does not leak sensitive info.
- [ ] Internal audit captures reason code.

### Testing

- [ ] Horizontal access tests exist.
- [ ] Vertical access tests exist.
- [ ] Cross-tenant tests exist.
- [ ] State-based tests exist.
- [ ] Bulk operation tests exist.
- [ ] Search/export scope tests exist.
- [ ] Field-level masking tests exist.
- [ ] Revocation/delegation expiry tests exist.
- [ ] Cache isolation tests exist.

---

## 38. Review Questions

Use these questions during design/PR review:

1. What is the protected resource?
2. What action is being performed?
3. Who is the actual actor?
4. Is anyone acting on behalf of someone else?
5. What tenant/agency/org boundary applies?
6. What workflow state must hold?
7. What relationship must exist between subject and resource?
8. What field-level restrictions apply?
9. Does search/list/export use the same authorization scope?
10. Can a background job or event consumer bypass this check?
11. Can an internal service become a confused deputy?
12. What happens if authorization data is missing?
13. What happens if policy engine is unavailable?
14. Is the denial externally safe but internally auditable?
15. How is this authorization rule tested?
16. How is revocation handled?
17. Does cache respect authorization scope?
18. Does admin access preserve core invariants?
19. Does bulk operation authorize every object?
20. What audit evidence proves the decision was authorized?

---

## 39. Key Takeaways

Authorization is not merely checking role names. It is preserving authority integrity across subject, action, resource, context, workflow state, tenant boundary, field visibility, delegation, and audit obligations.

The most important model:

```text
authorize(subject, action, resource, context) -> decision + obligations
```

Authentication proves who the actor is. Authorization proves whether that actor may do this specific thing to this specific resource under this specific context.

RBAC is useful but insufficient alone. Real systems usually need a hybrid of RBAC, ABAC, ReBAC, workflow guards, field-level rules, and audit obligations.

Broken Object Level Authorization is dangerous because IDs appear everywhere: path, query, body, headers, bulk requests, search, export, queue messages, reports, and callbacks. Every object reference crossing a trust boundary must be authorized.

Service-to-service authorization must avoid confused deputy. Internal service identity is not enough. Preserve caller, subject, delegation, purpose, and resource scope.

High-integrity systems should treat authorization as part of state integrity. Authorization permits the attempt; domain invariants permit the mutation. Both are required.

---

## 40. References

- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP API Security Top 10 2023 — API1 Broken Object Level Authorization: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- OWASP API Security Top 10 2023 — API3 Broken Object Property Level Authorization: https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/
- OWASP Access Control Community Page: https://owasp.org/www-community/Access_Control
- NIST SP 800-162 — Guide to Attribute Based Access Control: https://csrc.nist.gov/pubs/sp/800/162/upd2/final
- NIST SP 800-53 Rev. 5 — Security and Privacy Controls for Information Systems and Organizations: https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final
- RFC 6749 — OAuth 2.0 Authorization Framework: https://datatracker.ietf.org/doc/html/rfc6749
- RFC 9700 — Best Current Practice for OAuth 2.0 Security: https://datatracker.ietf.org/doc/html/rfc9700
- CWE-639 — Authorization Bypass Through User-Controlled Key: https://cwe.mitre.org/data/definitions/639.html
- CWE-862 — Missing Authorization: https://cwe.mitre.org/data/definitions/862.html
- CWE-863 — Incorrect Authorization: https://cwe.mitre.org/data/definitions/863.html
