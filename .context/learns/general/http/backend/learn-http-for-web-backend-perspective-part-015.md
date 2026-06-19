# learn-http-for-web-backend-perspective-part-015.md

# Part 015 — Authorization and Resource-Level Security

> Seri: `learn-http-for-web-backend-perspective`  
> Perspektif: Backend / Java Software Engineer  
> Fokus: authorization sebagai kontrak keamanan per-resource, per-action, per-tenant, dan per-state — bukan sekadar `hasRole()` di controller.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 014, kita sudah memisahkan **authentication** dari **authorization**.

Authentication menjawab:

> “Siapa atau apa yang membuat request ini?”

Authorization menjawab:

> “Dengan identitas, konteks, resource, action, state, tenant, dan policy saat ini, apakah request ini boleh dijalankan?”

Part ini membahas authorization dari perspektif backend HTTP production. Ini adalah salah satu area paling sering diremehkan oleh backend engineer karena di banyak codebase authorization terlihat seperti hal sederhana:

```java
@PreAuthorize("hasRole('ADMIN')")
@GetMapping("/cases/{caseId}")
public CaseResponse getCase(@PathVariable UUID caseId) { ... }
```

Tetapi authorization production jarang sesederhana itu. Dalam sistem nyata, keputusan akses bisa tergantung pada:

- user identity;
- service identity;
- tenant;
- organization;
- role;
- permission;
- ownership;
- relationship terhadap object;
- workflow state;
- data classification;
- case assignment;
- delegation;
- conflict of interest;
- time window;
- geography;
- purpose of access;
- legal hold;
- audit policy;
- emergency override;
- source channel;
- risk score;
- downstream policy.

Authorization adalah tempat di mana model domain, model organisasi, model workflow, dan model security bertemu. Kalau salah, sistem tidak hanya “buggy”; sistem bisa membocorkan data, melanggar tenant boundary, mengizinkan tindakan tidak sah, merusak audit trail, dan menghasilkan keputusan yang tidak defensible.

---

## 1. Mental Model Utama

Authorization bukan pertanyaan tunggal:

> “Apakah user punya role X?”

Authorization adalah evaluasi policy:

```text
Can subject S perform action A on object O
under context C
according to policy P?
```

Dengan bentuk lengkap:

```text
Decision = authorize(
  subject,     // who/what is acting?
  action,      // what operation is requested?
  object,      // which resource/object is targeted?
  context,     // when, where, tenant, channel, state, risk?
  policy       // what rules apply?
)
```

Contoh:

```text
Can user:investigator-17 perform action:UPLOAD_EVIDENCE
on case:CASE-2026-8841
under context:{tenant=REG-A, assignment=current, state=UNDER_INVESTIGATION}
according to enforcement-case-policy-v3?
```

Ini jauh lebih kuat daripada:

```text
hasRole('INVESTIGATOR')
```

Karena role hanya menjawab “apa kategori umum actor”, bukan “apakah actor ini boleh melakukan action ini pada object ini sekarang”.

---

## 2. Authentication vs Authorization

### 2.1 Authentication

Authentication menghasilkan principal.

Contoh principal:

```json
{
  "subject": "user-123",
  "tenant": "agency-a",
  "roles": ["INVESTIGATOR"],
  "scopes": ["case:read", "case:update"],
  "auth_time": "2026-06-18T09:00:00Z"
}
```

Authentication memastikan token/session/client certificate valid.

### 2.2 Authorization

Authorization menggunakan principal tersebut untuk mengambil keputusan.

Contoh:

```text
Principal valid? yes.
Role investigator? yes.
Scope case:update? yes.
Assigned to this case? no.
Case belongs to same tenant? yes.
Case state allows update? yes.
Decision: deny.
```

Principal valid tidak otomatis berarti request boleh dijalankan.

---

## 3. Kenapa Authorization Sulit di Backend HTTP

Authorization sulit karena HTTP API biasanya mengekspos object identifier secara eksplisit:

```http
GET /cases/8841
GET /users/123/profile
POST /invoices/991/approve
DELETE /documents/abc
```

Client bisa mengganti identifier:

```http
GET /cases/8842
GET /users/124/profile
POST /invoices/992/approve
DELETE /documents/def
```

Jika backend hanya memeriksa “user sudah login” atau “user punya role”, tetapi tidak memeriksa hubungan user terhadap object tertentu, maka sistem rentan terhadap **Broken Object Level Authorization** atau BOLA.

Ini adalah alasan OWASP API Security Top 10 menempatkan Broken Object Level Authorization sebagai risiko API paling atas pada edisi 2023. Polanya sederhana: API menerima ID object dari request, lalu backend gagal memverifikasi apakah caller berhak mengakses object tersebut.

---

## 4. BOLA, IDOR, dan Resource-Level Security

### 4.1 IDOR

IDOR biasanya berarti **Insecure Direct Object Reference**.

Contoh:

```http
GET /api/documents/1001
Authorization: Bearer token-for-user-a
```

User A mengganti ID:

```http
GET /api/documents/1002
Authorization: Bearer token-for-user-a
```

Jika `1002` milik User B dan server tetap mengembalikan dokumen, terjadi IDOR.

### 4.2 BOLA

BOLA adalah istilah API security modern untuk kegagalan authorization pada object tertentu.

BOLA tidak hanya terjadi pada `GET`. BOLA bisa terjadi pada:

```http
GET /cases/{id}
PATCH /cases/{id}
DELETE /cases/{id}
POST /cases/{id}/approve
POST /cases/{id}/attachments
GET /cases/{id}/timeline
```

### 4.3 ID Tidak Harus Sequential

Mengganti integer sequential dengan UUID bukan authorization.

UUID membantu mengurangi guessability, tetapi tidak menggantikan policy check.

Buruk:

```text
Karena ID sudah UUID, maka aman.
```

Benar:

```text
UUID mengurangi enumerability, tetapi setiap access tetap harus diotorisasi.
```

---

## 5. Authorization as State Machine Guard

Dalam sistem workflow, authorization bukan hanya soal actor dan object. Authorization juga tergantung state.

Contoh lifecycle regulatory case:

```text
DRAFT
  -> SUBMITTED
  -> TRIAGED
  -> ASSIGNED
  -> UNDER_INVESTIGATION
  -> LEGAL_REVIEW
  -> DECISION_PENDING
  -> DECIDED
  -> APPEAL_OPEN
  -> CLOSED
```

Action yang sama bisa valid di state tertentu dan invalid di state lain.

Contoh:

```text
UPLOAD_EVIDENCE:
  allowed in UNDER_INVESTIGATION
  denied in CLOSED

APPROVE_DECISION:
  allowed in DECISION_PENDING for authorized approver
  denied in DRAFT

EDIT_CASE_SUMMARY:
  allowed in DRAFT by owner
  denied after DECIDED unless correction process opened
```

Authorization sering menjadi guard pada transition:

```text
transition(case, SUBMIT)
  requires subject is owner
  requires case.state == DRAFT
  requires required fields complete
  produces case.state = SUBMITTED
```

Jika authorization tidak dikaitkan dengan state machine, sistem sering menghasilkan permission leak:

- user boleh edit object yang sudah final;
- reviewer boleh approve case yang belum siap;
- investigator boleh mengubah case setelah legal review;
- admin teknis bisa menjalankan action domain tanpa legal authority;
- workflow transition bisa dilakukan out of order.

---

## 6. Subject, Action, Object, Context

Gunakan model eksplisit.

### 6.1 Subject

Subject adalah actor yang melakukan request.

Subject bisa berupa:

- human user;
- machine client;
- internal service;
- scheduled job;
- webhook sender;
- delegated actor;
- admin impersonating user;
- emergency access actor.

Representasi subject minimal:

```java
public record Subject(
    String subjectId,
    SubjectType type,
    String tenantId,
    Set<String> roles,
    Set<String> permissions,
    Set<String> scopes,
    Map<String, Object> attributes
) {}
```

### 6.2 Action

Action harus spesifik secara domain, bukan hanya HTTP method.

HTTP method:

```text
GET
POST
PATCH
DELETE
```

Domain action:

```text
CASE_READ
CASE_ASSIGN
CASE_UPLOAD_EVIDENCE
CASE_SUBMIT_FOR_REVIEW
CASE_APPROVE_DECISION
CASE_CLOSE
DOCUMENT_DOWNLOAD
DOCUMENT_REDACT
```

Mapping HTTP ke domain action:

```text
GET /cases/{id}                  -> CASE_READ
PATCH /cases/{id}                -> CASE_UPDATE
POST /cases/{id}/assignments     -> CASE_ASSIGN
POST /cases/{id}/evidence        -> CASE_UPLOAD_EVIDENCE
POST /cases/{id}/decision        -> CASE_APPROVE_DECISION
```

### 6.3 Object

Object adalah target authorization.

Object bisa:

- case;
- document;
- evidence item;
- assignment;
- comment;
- decision;
- report;
- tenant;
- organization;
- user profile;
- export job;
- search result row.

Object minimal biasanya punya:

```java
public record ResourceRef(
    ResourceType type,
    String id,
    String tenantId,
    String ownerId,
    String state,
    String classification
) {}
```

### 6.4 Context

Context adalah informasi tambahan yang memengaruhi decision.

Contoh:

```java
public record AuthzContext(
    Instant now,
    String requestId,
    String sourceIp,
    String channel,
    String purpose,
    boolean breakGlass,
    Map<String, Object> attributes
) {}
```

Context penting untuk policy seperti:

- hanya jam kerja;
- hanya dari jaringan internal;
- hanya untuk purpose tertentu;
- hanya jika emergency override disetujui;
- hanya jika MFA fresh;
- hanya untuk assigned region;
- hanya jika legal hold tidak aktif.

---

## 7. RBAC, ABAC, ReBAC, PBAC

### 7.1 RBAC — Role-Based Access Control

RBAC memberi permission berdasarkan role.

Contoh:

```text
ROLE_INVESTIGATOR -> CASE_READ, CASE_UPLOAD_EVIDENCE
ROLE_SUPERVISOR   -> CASE_ASSIGN, CASE_ESCALATE
ROLE_LEGAL        -> CASE_LEGAL_REVIEW
ROLE_ADMIN        -> USER_MANAGE
```

Kelebihan:

- mudah dipahami;
- mudah diimplementasi;
- cocok untuk capability kasar;
- cocok untuk UI menu visibility;
- cocok untuk coarse-grained route access.

Kelemahan:

- tidak cukup untuk object-level access;
- mudah terjadi role explosion;
- sulit menangani tenant, ownership, assignment, state, delegation;
- sering mencampur organization role dan domain authority.

RBAC cukup untuk pertanyaan:

```text
Apakah actor termasuk kategori yang secara umum boleh melakukan action ini?
```

RBAC tidak cukup untuk pertanyaan:

```text
Apakah actor ini boleh melakukan action ini pada case ini sekarang?
```

### 7.2 ABAC — Attribute-Based Access Control

ABAC menggunakan attribute subject, object, action, dan environment.

Contoh policy:

```text
Allow CASE_READ when:
  subject.tenantId == object.tenantId
  and subject.region == object.region
  and subject.clearance >= object.classification
  and object.state != SEALED
```

Kelebihan:

- ekspresif;
- cocok untuk complex policy;
- cocok untuk multi-tenant dan classification;
- mengurangi role explosion.

Kelemahan:

- policy bisa sulit dipahami;
- debugging decision lebih sulit;
- butuh attribute governance;
- rentan jika attribute tidak trustworthy.

NIST SP 800-162 mendeskripsikan ABAC sebagai metodologi authorization yang mengevaluasi attribute terkait subject, object, operation, dan kondisi lingkungan terhadap policy/rules/relationships.

### 7.3 ReBAC — Relationship-Based Access Control

ReBAC menggunakan hubungan antar entity.

Contoh:

```text
User U can read Case C if:
  U is assigned investigator of C
  or U supervises assigned investigator of C
  or U belongs to legal team reviewing C
  or U is external respondent linked to C with allowed disclosure set
```

ReBAC sangat cocok untuk:

- social graph;
- organization hierarchy;
- project membership;
- case assignment;
- document sharing;
- delegated authority;
- supervisor-subordinate rules.

### 7.4 PBAC — Policy-Based Access Control

PBAC biasanya berarti authorization decision dideklarasikan sebagai policy eksplisit.

Contoh policy pseudo-code:

```text
policy case_upload_evidence {
  allow if subject.type == HUMAN
       and subject.tenant == case.tenant
       and subject.hasPermission("CASE_EVIDENCE_WRITE")
       and relationship(subject, "assigned_to", case)
       and case.state in [UNDER_INVESTIGATION, LEGAL_REVIEW]
       and not case.legalHoldBlocksUpload
}
```

PBAC lebih merupakan arsitektur: policy dikelola sebagai artefak eksplisit, tidak tersebar sebagai `if` random di controller.

---

## 8. Coarse-Grained vs Fine-Grained Authorization

### 8.1 Coarse-Grained

Coarse-grained authorization biasanya terjadi di edge/controller.

Contoh:

```java
.requestMatchers(HttpMethod.GET, "/api/cases/**").hasAuthority("SCOPE_case:read")
.requestMatchers(HttpMethod.POST, "/api/cases/**").hasAuthority("SCOPE_case:write")
```

Ini berguna untuk menolak request jelas-jelas tidak eligible.

Namun ini belum cukup.

### 8.2 Fine-Grained

Fine-grained authorization terjadi setelah object diketahui.

```java
Case c = caseRepository.findById(caseId).orElseThrow(NotFoundException::new);
authorizationService.check(subject, CASE_READ, c);
return mapper.toResponse(c);
```

Fine-grained check perlu object context:

- tenant;
- owner;
- assignment;
- classification;
- state;
- disclosure scope;
- relationship.

### 8.3 Layered Authorization

Pattern yang baik:

```text
1. Gateway coarse authn/authz
2. Application route-level authz
3. Object-level authz
4. Field-level/data-level authz
5. Domain transition guard
6. Database/query-level constraint where possible
7. Audit decision
```

Tidak semua layer harus melakukan semua check, tetapi high-risk domain tidak boleh hanya mengandalkan satu layer.

---

## 9. Placement: Di Mana Authorization Harus Diletakkan?

### 9.1 Gateway

Gateway cocok untuk:

- token validation;
- scope coarse check;
- tenant routing;
- rate limit;
- coarse path allowlist;
- client identity enforcement.

Gateway tidak cukup untuk:

- object ownership;
- workflow state;
- row-level relationship;
- field-level redaction;
- domain-specific transition.

Gateway biasanya tidak punya full domain object.

### 9.2 Controller

Controller cocok untuk:

- mapping request ke action;
- early coarse check;
- explicit authorization call;
- returning correct status.

Tetapi controller bisa terlalu tipis untuk domain policy kompleks.

### 9.3 Application Service

Application service sering menjadi tempat terbaik untuk authorization workflow.

Contoh:

```java
@Transactional
public CaseDecisionResponse approveDecision(Subject subject, UUID caseId, ApproveDecisionCommand command) {
    Case c = caseRepository.getForUpdate(caseId);
    authz.check(subject, Action.CASE_APPROVE_DECISION, c);
    c.approveDecision(command);
    audit.record(subject, Action.CASE_APPROVE_DECISION, c.id());
    return mapper.toResponse(c);
}
```

Kelebihan:

- dekat dengan transaction;
- punya object lengkap;
- bisa enforce state transition;
- reusable antar controller/job/message handler;
- lebih testable.

### 9.4 Domain Model

Domain model cocok untuk invariant internal.

```java
case.approveDecision(actor);
```

Tetapi hati-hati: domain entity biasanya tidak boleh terlalu bergantung pada HTTP principal/framework.

Pattern yang lebih bersih:

```java
if (!policy.canApprove(subject, c)) {
    throw new ForbiddenException(...);
}
c.approveDecision(command);
```

atau:

```java
case.approveDecision(new ApprovalAuthority(subject, policyDecision));
```

### 9.5 Repository / Query Layer

Query layer sangat penting untuk list/search.

Buruk:

```java
List<Case> cases = caseRepository.search(filter);
return cases.stream()
    .filter(c -> authz.canRead(subject, c))
    .toList();
```

Masalah:

- data unauthorized sudah keluar dari database;
- pagination salah;
- total count bocor;
- performa buruk;
- bisa bocor via timing;
- raw data mungkin masuk logs/cache.

Lebih baik:

```java
Page<Case> cases = caseRepository.searchVisibleTo(subject, filter, pageable);
```

Query harus memasukkan security predicate.

---

## 10. Query Filtering vs Post-Filtering

### 10.1 Query Filtering

Query filtering berarti permission dijadikan bagian dari query.

Contoh SQL konseptual:

```sql
select c.*
from cases c
join case_assignments a on a.case_id = c.id
where c.tenant_id = :tenantId
  and a.user_id = :subjectId
  and c.status <> 'SEALED'
order by c.updated_at desc
limit :limit offset :offset;
```

Kelebihan:

- pagination benar;
- total count benar;
- data unauthorized tidak keluar dari DB;
- performa lebih baik;
- lebih aman untuk list/search/export.

### 10.2 Post-Filtering

Post-filtering hanya aman untuk kasus terbatas:

- dataset kecil;
- bukan list public contract;
- tidak ada pagination/count;
- tidak menyimpan/log unauthorized object;
- digunakan sebagai defense-in-depth, bukan primary filter.

### 10.3 Export dan Reporting

Export adalah area berisiko tinggi.

Contoh:

```http
POST /case-exports
```

Export harus enforce:

- tenant;
- role;
- field-level disclosure;
- maximum result size;
- purpose;
- audit;
- approval jika data sensitif;
- retention limit;
- secure download.

Jangan pakai query admin internal untuk user-facing export.

---

## 11. 401 vs 403 vs 404

### 11.1 401 Unauthorized

Gunakan `401` ketika authentication belum valid atau tidak ada.

Contoh:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="case-api"
```

Meaning:

```text
Server tidak memiliki authenticated principal yang valid.
```

### 11.2 403 Forbidden

Gunakan `403` ketika principal valid, tetapi tidak boleh melakukan action.

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You are not allowed to approve this case.",
  "code": "CASE_APPROVAL_NOT_ALLOWED"
}
```

### 11.3 404 Not Found untuk Hidden Resource

Kadang, sistem sengaja mengembalikan `404` untuk resource yang ada tetapi tidak boleh diketahui caller.

Contoh:

```text
GET /cases/{id}
```

Jika case ada tetapi caller beda tenant, mengembalikan `403` bisa membocorkan bahwa case ID valid. Mengembalikan `404` bisa lebih aman.

Namun ini harus konsisten.

Decision rule:

```text
If caller is not authenticated -> 401.
If caller is authenticated but object existence itself must be hidden -> 404.
If caller may know object exists but cannot perform action -> 403.
```

### 11.4 409 vs 403

Gunakan `409 Conflict` untuk konflik state/resource yang bukan authorization.

Contoh:

```text
User punya permission approve, tetapi case state masih DRAFT.
```

Ini bisa `409` atau domain validation error, bukan `403`, jika kegagalan bukan karena user authority melainkan state precondition.

Tetapi jika state menjadi bagian policy:

```text
Only legal reviewer can approve during LEGAL_REVIEW.
```

Maka kegagalan bisa `403`.

Kuncinya: pisahkan authority failure dari state conflict.

---

## 12. Authorization dan HTTP Methods

Authorization tidak boleh hanya berdasar HTTP method.

```text
GET    -> read
POST   -> write
PATCH  -> update
DELETE -> delete
```

Itu terlalu kasar.

Contoh:

```http
POST /cases/{id}/comments
POST /cases/{id}/assignments
POST /cases/{id}/decision
POST /cases/{id}/appeal
```

Semua `POST`, tetapi action-nya berbeda:

```text
COMMENT_CREATE
CASE_ASSIGN
DECISION_APPROVE
APPEAL_SUBMIT
```

Masing-masing butuh policy berbeda.

Rule:

```text
Authorize domain action, not just HTTP method.
```

---

## 13. Field-Level Authorization

Kadang user boleh membaca resource, tetapi tidak semua field.

Contoh case response:

```json
{
  "id": "CASE-8841",
  "summary": "...",
  "respondentName": "...",
  "riskScore": 92,
  "internalNotes": "...",
  "legalOpinion": "...",
  "whistleblowerIdentity": "..."
}
```

Tidak semua actor boleh melihat semua field.

Policy:

```text
Investigator:
  can see summary, respondentName, evidence, internalNotes
  cannot see legalOpinion unless assigned to legal review
  cannot see whistleblowerIdentity unless clearance granted

External respondent:
  can see public allegations and submitted evidence subset
  cannot see internalNotes, riskScore, whistleblowerIdentity
```

### 13.1 Redaction vs Omission

Ada dua strategi:

#### Omit field

```json
{
  "id": "CASE-8841",
  "summary": "..."
}
```

#### Redact field

```json
{
  "id": "CASE-8841",
  "summary": "...",
  "whistleblowerIdentity": {
    "redacted": true,
    "reason": "INSUFFICIENT_CLEARANCE"
  }
}
```

Omission lebih sederhana. Redaction lebih audit-friendly dan explicit, tetapi bisa membocorkan bahwa field ada.

### 13.2 Field-Level Write Authorization

PATCH sangat rentan.

```http
PATCH /cases/8841
Content-Type: application/json

{
  "status": "CLOSED",
  "assignedSupervisorId": "user-9",
  "riskScore": 0
}
```

Jika DTO binding langsung ke entity, user bisa mengubah field yang tidak boleh.

Gunakan command DTO per use case:

```java
public record UpdateCaseSummaryCommand(
    String summary,
    String allegationText
) {}
```

Bukan:

```java
public class CaseEntity {
    String status;
    UUID assignedSupervisorId;
    int riskScore;
    boolean sealed;
    ...
}
```

---

## 14. Function-Level Authorization

Broken Function Level Authorization terjadi ketika caller bisa mengakses function/action yang bukan haknya.

Contoh:

```http
POST /admin/users/123/disable
```

Jika endpoint hanya memeriksa login, bukan role/permission admin, maka terjadi function-level authorization failure.

Function-level check menjawab:

```text
Apakah subject boleh menjalankan operation type ini secara umum?
```

Object-level check menjawab:

```text
Apakah subject boleh menjalankan operation ini pada object ini?
```

Keduanya diperlukan.

---

## 15. Tenant Boundary

Multi-tenancy adalah area authorization paling kritis.

Tenant boundary harus dianggap invariant keras.

```text
Subject tenant must match resource tenant unless explicit cross-tenant authority exists.
```

### 15.1 Tenant dari Token Tidak Selalu Cukup

Token mungkin berisi:

```json
{
  "sub": "user-123",
  "tenant": "agency-a"
}
```

Request:

```http
GET /tenants/agency-b/cases/8841
```

Backend harus memverifikasi:

- path tenant cocok dengan subject tenant;
- resource tenant cocok dengan path tenant;
- subject punya authority untuk tenant tersebut;
- tidak menggunakan tenant dari request body secara buta.

### 15.2 Tenant Context Injection Risk

Buruk:

```java
String tenantId = request.getHeader("X-Tenant-Id");
```

Jika header bisa dikirim client, user bisa spoof tenant.

Lebih baik:

```text
Tenant derived from verified token, mTLS client identity, trusted gateway, or server-side session.
```

Jika gateway menambahkan tenant header, backend harus hanya mempercayainya dari trusted network/source dan menghapus header user-supplied di edge.

### 15.3 Database-Level Tenant Predicate

Idealnya setiap query tenant-aware:

```sql
where tenant_id = :subjectTenantId
```

Jangan mengandalkan filter di service setelah fetch.

---

## 16. Ownership Is Not Always Enough

Ownership adalah rule umum:

```text
User can access objects they own.
```

Tetapi domain sering lebih kompleks.

Contoh:

- supervisor bisa melihat case milik subordinate;
- legal reviewer bisa melihat case walau bukan owner;
- respondent bisa melihat disclosure subset;
- auditor bisa melihat closed cases;
- investigator bisa kehilangan akses setelah reassignment;
- emergency response bisa membuka akses sementara;
- data subject request bisa membuka read-only export;
- sealed case bisa menghapus akses owner lama.

Jangan hardcode:

```java
if (case.ownerId().equals(subject.id())) allow;
```

Gunakan policy yang bisa menampung relationship dan state.

---

## 17. Delegation, Impersonation, and Break-Glass

### 17.1 Delegation

Delegation terjadi ketika user A memberi user B hak tertentu.

Contoh:

```text
Supervisor delegates review of case X to deputy for 7 days.
```

Policy harus mencatat:

- delegator;
- delegatee;
- scope;
- resource/action;
- start/end time;
- revocation;
- audit trail.

### 17.2 Impersonation

Impersonation sering dipakai support/admin.

Bahaya:

```text
Admin impersonates user and performs destructive action.
```

Harus ada:

- explicit approval;
- visible audit;
- restricted actions;
- reason required;
- session indicator;
- no privilege escalation beyond target user;
- forbidden for sensitive actions.

### 17.3 Break-Glass

Break-glass adalah emergency access.

Harus dianggap special path:

- requires justification;
- limited duration;
- high-severity audit event;
- notification;
- post-access review;
- cannot be silent;
- cannot be default fallback.

---

## 18. Policy Decision Point and Policy Enforcement Point

### 18.1 PEP — Policy Enforcement Point

PEP adalah tempat check diterapkan.

Contoh:

- gateway;
- controller;
- application service;
- repository;
- message consumer;
- scheduled job;
- file download handler.

### 18.2 PDP — Policy Decision Point

PDP adalah komponen yang memutuskan allow/deny.

Contoh:

```java
AuthorizationDecision decision = policyEngine.decide(subject, action, resource, context);
```

### 18.3 PAP — Policy Administration Point

PAP adalah tempat policy dikelola.

Contoh:

- config file;
- admin UI;
- policy repository;
- OPA bundle;
- database rules;
- code-based policy module.

### 18.4 PIP — Policy Information Point

PIP menyediakan attribute/relationship.

Contoh:

- user directory;
- group membership service;
- assignment table;
- case metadata;
- tenant registry;
- clearance registry.

### 18.5 Kenapa Separation Ini Penting

Tanpa pemisahan, authorization logic tersebar:

```text
Controller A: if user.role == ADMIN
Controller B: if user.isSupervisor()
Service C: if ownerId == userId
Repository D: tenant_id filter
```

Akibat:

- inconsistency;
- susah audit;
- susah test;
- policy drift;
- privilege leak;
- duplicated logic;
- hidden bypass path.

---

## 19. Centralized vs Distributed Authorization

### 19.1 Centralized Authorization

Satu service/policy engine mengambil decision.

Kelebihan:

- policy konsisten;
- audit terpusat;
- mudah governance;
- cocok untuk enterprise compliance.

Kelemahan:

- latency;
- availability dependency;
- coupling;
- perlu caching decision/attributes;
- failure mode rumit.

### 19.2 Distributed Authorization

Setiap service punya authorization module sendiri.

Kelebihan:

- local context lengkap;
- cepat;
- lebih resilient;
- sesuai bounded context.

Kelemahan:

- policy bisa drift;
- sulit governance;
- test matrix besar;
- audit tersebar.

### 19.3 Hybrid Pattern

Banyak production system memakai hybrid:

```text
Central identity + coarse policy + shared library/policy bundle
+ service-local object/state authorization
+ centralized audit event
```

Contoh:

- gateway validates JWT and coarse scope;
- service enforces object-level and workflow state;
- policy definitions versioned;
- authorization decisions logged to audit stream.

---

## 20. Authorization Decision Result

Jangan hanya boolean.

Minimal:

```java
public record AuthorizationDecision(
    boolean allowed,
    String reasonCode,
    String policyId,
    String policyVersion,
    Map<String, Object> obligations
) {}
```

Contoh deny:

```json
{
  "allowed": false,
  "reasonCode": "CASE_NOT_ASSIGNED_TO_SUBJECT",
  "policyId": "case-access-policy",
  "policyVersion": "2026-04-01"
}
```

Contoh allow dengan obligation:

```json
{
  "allowed": true,
  "reasonCode": "LEGAL_REVIEWER_ASSIGNED",
  "obligations": {
    "redactFields": ["whistleblowerIdentity"],
    "auditLevel": "HIGH"
  }
}
```

Obligation berguna untuk:

- redaction;
- masking;
- extra audit;
- step-up authentication;
- watermarked download;
- purpose capture;
- notification.

---

## 21. Jangan Bocorkan Terlalu Banyak di Error

Error authorization harus hati-hati.

Terlalu detail:

```json
{
  "detail": "Case exists but belongs to tenant agency-b and you are agency-a"
}
```

Aman untuk public/external:

```json
{
  "title": "Not Found",
  "status": 404,
  "code": "RESOURCE_NOT_FOUND"
}
```

Untuk internal authorized user:

```json
{
  "title": "Forbidden",
  "status": 403,
  "code": "CASE_NOT_ASSIGNED_TO_USER"
}
```

Untuk audit log internal:

```json
{
  "event": "AUTHZ_DENIED",
  "subject": "user-123",
  "action": "CASE_READ",
  "resource": "case-8841",
  "resourceTenant": "agency-b",
  "subjectTenant": "agency-a",
  "reason": "TENANT_MISMATCH",
  "policyVersion": "case-access-v3"
}
```

User-facing response dan internal audit detail harus berbeda.

---

## 22. Authorization and Caching

Authorization memengaruhi caching.

### 22.1 User-Specific Response

Jika response tergantung subject:

```http
Cache-Control: private, no-cache
Vary: Authorization
```

atau untuk data sangat sensitif:

```http
Cache-Control: no-store
```

### 22.2 Shared Cache Risk

Jangan cache response user-specific di shared cache.

Berbahaya:

```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=600

{
  "caseId": "CASE-8841",
  "internalNotes": "..."
}
```

Jika CDN/shared proxy menyimpan response ini, user lain bisa menerima data salah.

### 22.3 Authorization-Aware Representation

Resource sama bisa punya representation berbeda per role.

```text
GET /cases/8841 as investigator -> includes internal notes
GET /cases/8841 as respondent   -> excludes internal notes
```

Ini harus dipertimbangkan dalam cache key, Vary, atau non-cache policy.

---

## 23. Authorization and Search/List Endpoints

List endpoint sering lebih rentan daripada detail endpoint.

Detail endpoint:

```http
GET /cases/{id}
```

Developer biasanya ingat check `caseId`.

List endpoint:

```http
GET /cases?status=UNDER_INVESTIGATION
GET /cases/search?q=fraud
GET /documents?caseId=...
```

Developer sering lupa bahwa search result juga object-level.

Checklist list endpoint:

```text
- Apakah query selalu tenant-scoped?
- Apakah result hanya berisi object yang caller boleh lihat?
- Apakah total count hanya menghitung visible object?
- Apakah sort/filter tidak membocorkan hidden field?
- Apakah faceted counts tidak membocorkan existence?
- Apakah export menggunakan policy yang sama?
- Apakah pagination terjadi setelah security predicate?
```

### 23.1 Facet Leakage

Contoh:

```json
{
  "total": 0,
  "facets": {
    "status": {
      "SEALED": 3
    }
  }
}
```

Walau result kosong, facet membocorkan existence sealed case.

---

## 24. Authorization and Bulk Operations

Bulk operation sangat rawan partial authorization bug.

```http
POST /cases/bulk-close
Content-Type: application/json

{
  "caseIds": ["c1", "c2", "c3"]
}
```

Pertanyaan:

- jika user boleh close `c1` dan `c2`, tapi tidak `c3`, apa hasilnya?
- apakah entire request fail?
- apakah partial success?
- apakah response membocorkan existence `c3`?
- apakah action atomic?
- apakah audit per item?

Strategi:

### 24.1 All-Or-Nothing

```text
If any item unauthorized, reject entire request.
```

Cocok untuk operation yang harus atomic.

### 24.2 Per-Item Result

```json
{
  "results": [
    {"id": "c1", "status": "CLOSED"},
    {"id": "c2", "status": "CLOSED"},
    {"id": "c3", "status": "FORBIDDEN"}
  ]
}
```

Cocok untuk admin/internal tool, tetapi hati-hati untuk external client karena bisa membocorkan existence.

### 24.3 Pre-Filtered Operation

```text
Apply operation only to visible authorized set.
```

Berbahaya jika user tidak sadar sebagian item diabaikan. Harus jelas di contract.

---

## 25. Authorization and Async Jobs

Async jobs sering melewati controller-level authorization.

Contoh:

```http
POST /exports
```

Request membuat job. Job berjalan nanti oleh worker.

Pertanyaan penting:

- authorization dievaluasi saat job dibuat, saat job berjalan, atau keduanya?
- apakah permission snapshot atau live permission?
- jika user kehilangan akses sebelum job selesai, apakah hasil masih boleh didownload?
- siapa subject di audit: user atau worker?
- apakah worker punya overbroad service privilege?

Pattern yang aman:

```text
1. Authorize job creation.
2. Store requested subject, tenant, purpose, policy version, filter.
3. Worker runs with service identity but enforces original subject visibility.
4. Download result requires authorization again.
5. Audit both job creation and data materialization.
```

Jangan jalankan export memakai full admin repository tanpa subject filter.

---

## 26. Authorization and Internal Service Calls

Internal service bukan otomatis trusted untuk semua action.

Buruk:

```text
If request comes from internal network, allow all.
```

Lebih baik:

```text
Service identity authenticated via mTLS/JWT.
Service has explicit service permissions.
User context propagated separately when acting on behalf of user.
```

### 26.1 On-Behalf-Of

Service A menerima request dari user, lalu memanggil Service B.

Service B perlu tahu:

- caller service identity;
- original user identity;
- tenant;
- action purpose;
- delegation chain.

Model:

```text
Actor chain:
  user:user-123 -> service:case-api -> service:document-api
```

Audit harus mencatat chain, bukan hanya service terakhir.

---

## 27. Authorization and Data Ownership in Microservices

Dalam microservices, service yang memiliki data harus tetap menjadi authority atas object-level authorization yang membutuhkan data tersebut.

Contoh:

- Case Service tahu assignment dan state case.
- Document Service tahu document classification dan disclosure set.
- User Service tahu org hierarchy.
- Policy Service tahu global rule.

Jangan memaksa gateway mengambil semua decision jika data domain ada di service.

Pattern:

```text
Gateway: authn + coarse authz
Owning service: object-level + domain-state authz
Shared policy lib/service: reusable policy fragments
Audit service: centralized decision event
```

---

## 28. Java/Spring MVC Pattern

### 28.1 Request-Level Security

```java
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers(HttpMethod.GET, "/api/cases/**").hasAuthority("SCOPE_case:read")
            .requestMatchers(HttpMethod.POST, "/api/cases/**").hasAuthority("SCOPE_case:write")
            .anyRequest().authenticated()
        )
        .oauth2ResourceServer(oauth2 -> oauth2.jwt())
        .build();
}
```

Ini coarse check, bukan final authorization.

### 28.2 Application-Service Object Authorization

```java
@Service
public class CaseApplicationService {
    private final CaseRepository caseRepository;
    private final CaseAuthorizationService authorization;
    private final AuditService audit;

    @Transactional(readOnly = true)
    public CaseResponse getCase(Subject subject, UUID caseId) {
        Case c = caseRepository.findById(caseId)
            .orElseThrow(() -> new NotFoundException("case.not_found"));

        authorization.check(subject, CaseAction.READ, c);

        audit.recordAllowed(subject, CaseAction.READ, c.reference());
        return CaseMapper.toResponse(c, authorization.fieldPolicy(subject, c));
    }

    @Transactional
    public CaseResponse assignCase(Subject subject, UUID caseId, AssignCaseCommand command) {
        Case c = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(() -> new NotFoundException("case.not_found"));

        authorization.check(subject, CaseAction.ASSIGN, c);
        c.assignTo(command.assigneeId());

        audit.recordAllowed(subject, CaseAction.ASSIGN, c.reference());
        return CaseMapper.toResponse(c, authorization.fieldPolicy(subject, c));
    }
}
```

### 28.3 Policy Service

```java
@Service
public class CaseAuthorizationService {
    public void check(Subject subject, CaseAction action, Case c) {
        AuthorizationDecision decision = decide(subject, action, c);
        if (!decision.allowed()) {
            throw new ForbiddenException(decision.reasonCode());
        }
    }

    public AuthorizationDecision decide(Subject subject, CaseAction action, Case c) {
        if (!subject.tenantId().equals(c.tenantId())) {
            return AuthorizationDecision.deny("TENANT_MISMATCH");
        }

        return switch (action) {
            case READ -> canRead(subject, c);
            case UPLOAD_EVIDENCE -> canUploadEvidence(subject, c);
            case ASSIGN -> canAssign(subject, c);
            case APPROVE_DECISION -> canApproveDecision(subject, c);
        };
    }

    private AuthorizationDecision canRead(Subject subject, Case c) {
        if (subject.hasPermission("case:read:any") && subject.sameTenant(c)) {
            return AuthorizationDecision.allow("TENANT_READER");
        }
        if (c.isAssignedTo(subject.subjectId())) {
            return AuthorizationDecision.allow("ASSIGNED_INVESTIGATOR");
        }
        if (c.isVisibleToRespondent(subject.subjectId())) {
            return AuthorizationDecision.allowWithObligation(
                "RESPONDENT_DISCLOSURE",
                Map.of("redactInternalFields", true)
            );
        }
        return AuthorizationDecision.deny("NO_CASE_RELATIONSHIP");
    }
}
```

### 28.4 Controller

```java
@RestController
@RequestMapping("/api/cases")
class CaseController {
    private final CaseApplicationService service;

    @GetMapping("/{caseId}")
    CaseResponse getCase(@AuthenticationPrincipal Jwt jwt,
                         @PathVariable UUID caseId) {
        Subject subject = SubjectFactory.from(jwt);
        return service.getCase(subject, caseId);
    }
}
```

Controller tidak mengambil keputusan policy kompleks. Controller menerjemahkan HTTP ke application call.

---

## 29. Spring Method Security

Spring method security berguna untuk coarse permission.

```java
@PreAuthorize("hasAuthority('SCOPE_case:read')")
public CaseResponse getCase(Subject subject, UUID caseId) { ... }
```

Untuk object-level, bisa menggunakan custom bean:

```java
@PreAuthorize("@caseAuthz.canRead(authentication, #caseId)")
public CaseResponse getCase(UUID caseId) { ... }
```

Namun hati-hati:

- method security expression bisa menjadi tersebar dan sulit ditest;
- jika `canRead` fetch object lalu service fetch object lagi, terjadi double fetch;
- jika check hanya by ID tanpa lock, state bisa berubah sebelum action;
- expression terlalu kompleks menjadi unreadable.

Untuk state-changing action, explicit check di transactional service sering lebih defensible.

---

## 30. WebFlux Considerations

Reactive stack tidak mengubah prinsip authorization, tetapi mengubah bentuk implementasi.

Contoh:

```java
public Mono<CaseResponse> getCase(Subject subject, UUID caseId) {
    return caseRepository.findById(caseId)
        .switchIfEmpty(Mono.error(new NotFoundException("case.not_found")))
        .flatMap(c -> authorization.check(subject, CaseAction.READ, c).thenReturn(c))
        .map(c -> CaseMapper.toResponse(c));
}
```

Peringatan:

- jangan blocking call ke policy DB di event loop;
- gunakan reactive repository/client;
- context propagation harus jelas;
- audit event harus tetap tercatat;
- denial jangan tertelan sebagai empty `Mono` kecuali contract memang 404.

---

## 31. Database Row-Level Security

Beberapa sistem memakai database row-level security.

Kelebihan:

- defense-in-depth;
- policy dekat data;
- mengurangi risiko query lupa tenant predicate;
- berguna untuk multi-tenant.

Kelemahan:

- policy domain kompleks sulit diekspresikan;
- debugging lebih sulit;
- dependency pada fitur database;
- application masih perlu action/state authorization;
- tidak menyelesaikan field/action-level policy.

Row-level security bisa bagus, tetapi tidak menggantikan application authorization.

---

## 32. Authorization Testing Strategy

Authorization harus ditest sebagai matrix, bukan hanya happy path.

### 32.1 Test Dimensions

```text
Subject:
  unauthenticated
  authenticated wrong tenant
  owner
  assigned user
  unassigned same-role user
  supervisor
  legal reviewer
  admin
  external respondent
  service account

Action:
  read
  update
  assign
  upload evidence
  approve
  delete/cancel
  export

Object state:
  draft
  submitted
  assigned
  under investigation
  legal review
  decided
  closed
  sealed

Object sensitivity:
  public
  internal
  confidential
  restricted

Relationship:
  owner
  assigned
  supervisor chain
  no relation
  delegated
```

### 32.2 Negative Tests Are More Important

Authorization bug sering muncul ketika “harusnya tidak boleh”.

Test contoh:

```text
- investigator A cannot read investigator B's case in same tenant unless supervisor relationship exists.
- investigator cannot approve decision.
- supervisor cannot modify legal opinion.
- external respondent cannot see internal notes.
- old assignee loses write access after reassignment.
- user from tenant A receives 404 for tenant B case.
- export count excludes unauthorized cases.
- bulk operation fails if any item unauthorized.
```

### 32.3 Property-Based/Matrix Test

Untuk policy kompleks, buat data-driven tests:

```java
record AuthzScenario(
    String name,
    Subject subject,
    CaseResource resource,
    CaseAction action,
    boolean expectedAllowed,
    String expectedReason
) {}
```

Policy test harus bisa dibaca oleh engineer security dan domain expert.

---

## 33. Observability for Authorization

Authorization decision perlu observable, tetapi jangan membocorkan data.

### 33.1 Metrics

Contoh metric:

```text
http_authz_decision_total{action="CASE_READ", decision="allow"}
http_authz_decision_total{action="CASE_READ", decision="deny", reason="TENANT_MISMATCH"}
http_authz_latency_ms{policy="case-access"}
```

Hati-hati high cardinality. Jangan jadikan `caseId` sebagai label metric.

### 33.2 Logs

Structured log:

```json
{
  "event": "authz.denied",
  "requestId": "req-123",
  "subjectId": "user-456",
  "tenantId": "agency-a",
  "action": "CASE_APPROVE_DECISION",
  "resourceType": "CASE",
  "resourceIdHash": "sha256:...",
  "reason": "NOT_LEGAL_REVIEWER",
  "policyVersion": "case-policy-2026-04"
}
```

Untuk data sensitif, hash resource ID atau gunakan internal secure audit store.

### 33.3 Audit

Audit berbeda dari log observability.

Audit harus menjawab:

- siapa melakukan apa;
- kapan;
- pada resource apa;
- atas dasar authority apa;
- decision allow/deny;
- policy version;
- reason/purpose;
- outcome;
- delegated/impersonated/break-glass chain.

Authorization allow untuk data sensitif sering harus diaudit, bukan hanya deny.

---

## 34. Anti-Patterns

### 34.1 Only Checking Role

```java
if (user.hasRole("INVESTIGATOR")) allow;
```

Masalah: investigator mungkin tidak assigned ke case tersebut.

### 34.2 Authorization Only in UI

```text
Button disembunyikan di frontend, endpoint tetap bisa dipanggil.
```

Backend harus enforce semua decision.

### 34.3 Trusting Request Body for Ownership

```json
{
  "tenantId": "agency-a",
  "ownerId": "user-123"
}
```

Request body tidak boleh menentukan authority.

### 34.4 Fetch Then Forget to Check

```java
Case c = caseRepository.findById(caseId).orElseThrow();
return mapper.toResponse(c);
```

Semua detail endpoint harus punya object-level check.

### 34.5 Admin Role as Universal Escape Hatch

```java
if (user.hasRole("ADMIN")) return true;
```

Admin teknis belum tentu punya authority domain/legal. Buat permission spesifik.

### 34.6 Post-Filtering Lists

```java
return repository.findAll().stream().filter(authz::canRead).toList();
```

Pagination/count leak dan performa buruk.

### 34.7 Inconsistent 403/404

Endpoint A mengembalikan 403, endpoint B mengembalikan 404 untuk kasus yang sama. Ini bisa dipakai untuk existence probing.

### 34.8 Policy Logic in Random Places

Authorization tersebar di controller, mapper, repository, frontend, dan trigger database tanpa model eksplisit.

### 34.9 Missing Authorization on Secondary Resource

Endpoint:

```http
GET /cases/{caseId}/documents/{documentId}
```

Backend check case access, tapi lupa check document belongs to case dan caller can access document classification.

### 34.10 Assuming Internal Means Authorized

Internal caller tetap harus punya service permission dan user context bila acting on behalf of user.

---

## 35. Resource-Level Authorization Checklist

Untuk setiap endpoint, jawab:

```text
1. Apa subject-nya?
2. Apa domain action-nya?
3. Apa object/resource target-nya?
4. Apakah resource ID berasal dari path, query, body, header, atau derived context?
5. Apakah object existence boleh diketahui caller?
6. Apakah tenant boundary enforced sebelum data keluar?
7. Apakah caller punya coarse permission untuk action?
8. Apakah caller punya relationship/ownership/assignment yang valid?
9. Apakah object state mengizinkan action?
10. Apakah field-level redaction/write permission diperlukan?
11. Apakah list/search/export memakai security predicate di query?
12. Apakah bulk operation punya semantics jelas untuk unauthorized item?
13. Apakah async job membawa original subject dan policy context?
14. Apakah decision diaudit?
15. Apakah error response tidak membocorkan data berlebih?
16. Apakah tests mencakup negative cases?
17. Apakah policy version bisa dilacak?
18. Apakah cache behavior aman untuk response authorization-aware?
```

---

## 36. Case Study: Regulatory Enforcement Case API

### 36.1 Domain Actors

```text
Complainant
Intake Officer
Investigator
Supervisor
Legal Reviewer
Decision Approver
External Respondent
Auditor
System Integration Service
```

### 36.2 Resources

```text
Case
Evidence
Assignment
ReviewNote
LegalOpinion
Decision
Appeal
DisclosurePackage
AuditRecord
ExportJob
```

### 36.3 Actions

```text
CASE_READ
CASE_CREATE
CASE_TRIAGE
CASE_ASSIGN
CASE_UPDATE_SUMMARY
CASE_UPLOAD_EVIDENCE
CASE_VIEW_EVIDENCE
CASE_ADD_INTERNAL_NOTE
CASE_SUBMIT_LEGAL_REVIEW
CASE_ADD_LEGAL_OPINION
CASE_APPROVE_DECISION
CASE_DISCLOSE_TO_RESPONDENT
CASE_CLOSE
CASE_EXPORT
```

### 36.4 Example Policy Matrix

| Action | Intake | Investigator | Supervisor | Legal | Approver | Respondent | Auditor |
|---|---:|---:|---:|---:|---:|---:|---:|
| Create case | yes | limited | yes | no | no | no | no |
| Read assigned case | limited | yes | yes if supervises | yes if review assigned | yes if approval assigned | disclosure only | yes read-only |
| Upload evidence | no | yes if assigned and active | no | limited | no | submitted response only | no |
| Assign case | no | no | yes | no | no | no | no |
| Add legal opinion | no | no | no | yes if assigned | no | no | no |
| Approve decision | no | no | no | no | yes if approval assigned | no | no |
| Export case | limited | limited | yes | limited | limited | no | yes with audit |

### 36.5 State Guard

```text
CASE_UPLOAD_EVIDENCE allowed if:
  subject.role includes INVESTIGATOR
  subject is assigned investigator
  subject.tenant == case.tenant
  case.state in [ASSIGNED, UNDER_INVESTIGATION]
  case.notSealed
  evidence upload window open
```

### 36.6 Endpoint Design

```http
GET /cases/{caseId}
POST /cases/{caseId}/assignments
POST /cases/{caseId}/evidence
POST /cases/{caseId}/legal-review-submissions
POST /cases/{caseId}/legal-opinions
POST /cases/{caseId}/decisions
POST /cases/{caseId}/disclosure-packages
POST /case-exports
```

Each endpoint maps to a domain action, not just CRUD.

### 36.7 Secure Read Flow

```text
1. Authenticate token.
2. Build Subject.
3. Parse caseId.
4. Load case by id and tenant-aware visibility strategy.
5. If not found or hidden, return 404.
6. Decide CASE_READ.
7. Build field policy.
8. Map response with redaction.
9. Add cache header appropriate for sensitivity.
10. Audit read if high sensitivity.
```

### 36.8 Secure Transition Flow

```text
1. Authenticate token.
2. Build Subject.
3. Parse command.
4. Load case for update.
5. Decide domain action.
6. Validate state transition.
7. Apply domain change.
8. Persist in transaction.
9. Emit audit event/outbox event.
10. Return correct status/representation.
```

---

## 37. Implementation Blueprint

A strong backend authorization architecture often has:

```text
- SubjectFactory
- Action enum per bounded context
- ResourceRef or domain object adapter
- AuthorizationService
- Policy module
- Relationship resolver
- Tenant resolver
- Field redaction policy
- Query predicate builder
- Audit decision recorder
- Test scenario matrix
```

Example package structure:

```text
com.example.caseapi.security
  Subject.java
  SubjectFactory.java
  AuthorizationDecision.java
  AuthorizationDeniedException.java

com.example.caseapi.caseauthz
  CaseAction.java
  CaseAuthorizationService.java
  CasePolicy.java
  CaseRelationshipResolver.java
  CaseFieldPolicy.java
  CaseVisibilityPredicateBuilder.java

com.example.caseapi.caseapp
  CaseApplicationService.java
  CaseController.java
```

---

## 38. Practical Rule of Thumb

Untuk backend engineer, rule paling penting:

```text
Every endpoint that accepts, derives, or returns an object identifier must have object-level authorization.
```

Dan:

```text
Every list/search/export endpoint must apply authorization before pagination/count/materialization.
```

Dan:

```text
Every state-changing endpoint must authorize domain action against current resource state inside the transaction boundary.
```

Jika tiga rule ini diterapkan konsisten, sebagian besar bug authorization serius bisa dikurangi drastis.

---

## 39. Exercises

### Exercise 1 — Identify Missing Authorization

Endpoint:

```java
@GetMapping("/cases/{caseId}/documents/{documentId}")
public DocumentResponse getDocument(@PathVariable UUID caseId,
                                    @PathVariable UUID documentId) {
    Case c = caseRepository.findById(caseId).orElseThrow(NotFoundException::new);
    authz.check(subject, CASE_READ, c);
    Document d = documentRepository.findById(documentId).orElseThrow(NotFoundException::new);
    return mapper.toResponse(d);
}
```

Pertanyaan:

1. Authorization apa yang kurang?
2. Apa risiko jika `documentId` milik case lain?
3. Apa risiko jika document classification lebih tinggi dari case access?
4. Bagaimana memperbaikinya?

Expected direction:

```text
- verify document belongs to case;
- authorize DOCUMENT_READ on document;
- enforce classification/disclosure;
- avoid leaking existence;
- audit if sensitive.
```

### Exercise 2 — Design Policy Matrix

Buat policy matrix untuk action:

```text
CASE_ADD_INTERNAL_NOTE
CASE_ADD_LEGAL_OPINION
CASE_DISCLOSE_TO_RESPONDENT
CASE_REOPEN
```

Dimension:

```text
role, relationship, tenant, case state, classification.
```

### Exercise 3 — Fix Bulk Authorization

Endpoint:

```http
POST /cases/bulk-assign
```

Body:

```json
{
  "caseIds": ["c1", "c2", "c3"],
  "assigneeId": "u9"
}
```

Tentukan:

- all-or-nothing atau per-item;
- response shape;
- audit design;
- unauthorized item behavior;
- transaction boundary.

### Exercise 4 — 403 or 404?

Untuk skenario berikut, tentukan response:

1. Unauthenticated caller reads `/cases/123`.
2. Authenticated tenant A caller reads tenant B case.
3. Assigned investigator tries approving decision.
4. Legal reviewer reads assigned legal opinion.
5. External respondent accesses internal note.
6. User reads case ID that truly does not exist.

---

## 40. Summary

Authorization di backend HTTP adalah sistem decision, bukan annotation tunggal.

Key takeaways:

1. Authentication menghasilkan principal; authorization memutuskan allowed/denied.
2. Role check saja tidak cukup untuk resource-level security.
3. BOLA terjadi ketika backend menerima object ID dari request tetapi tidak memverifikasi hak caller terhadap object tersebut.
4. Authorization harus mengevaluasi subject, action, object, context, dan policy.
5. HTTP method bukan domain action; `POST` bisa berarti banyak hal.
6. Tenant boundary harus menjadi invariant keras.
7. List/search/export harus menerapkan security predicate sebelum pagination/count/materialization.
8. State-changing action harus diotorisasi terhadap current resource state, idealnya dalam transaction boundary.
9. Field-level read/write authorization penting untuk data sensitif.
10. Async job dan internal service call tetap perlu membawa original subject dan policy context.
11. Error response harus aman; audit log boleh lebih detail, tetapi harus terlindungi.
12. Authorization harus ditest dengan matrix negative cases.
13. Top-tier backend engineer mendesain authorization sebagai bagian dari domain model, workflow model, dan operability model.

---

## 41. Referensi

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- OWASP API Security Top 10 2023 — API1 Broken Object Level Authorization: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- NIST SP 800-162 — Guide to Attribute Based Access Control: https://csrc.nist.gov/pubs/sp/800/162/upd2/final
- Spring Security Reference — Authorize HttpServletRequests: https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html
- Spring Security Reference — Method Security: https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html

---

## 42. Status Seri

Part ini adalah **Part 015 dari 032**.

Seri **belum selesai**.

Part berikutnya:

```text
learn-http-for-web-backend-perspective-part-016.md
```

Judul:

```text
Cookies, Sessions, CSRF, and Browser-Coupled Backend
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-014.md">⬅️ Part 014 — Authentication over HTTP</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-016.md">Part 016 — Cookies, Sessions, CSRF, and Browser-Coupled Backend ➡️</a>
</div>
