# learn-java-authorization-modes-and-patterns-part-034

# Part 34 — Top 1% Authorization Engineering Playbook

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Bagian: **34 dari 34**  
> Target: Java 8–25, Spring, Jakarta EE, microservices, distributed systems, regulatory/case-management systems  
> Fokus: playbook sintesis untuk desain, review, threat modeling, readiness, maturity, dan capstone authorization architecture.

---

## 0. Status Seri

Ini adalah **bagian terakhir** dari seri **Java Authorization Modes and Patterns — Advanced Engineering**.

Seri selesai setelah bagian ini.

Bagian ini tidak dimaksudkan untuk memperkenalkan satu model authorization baru lagi. Bagian ini adalah **synthesis layer**: cara berpikir, checklist, decision framework, review framework, dan playbook yang dipakai engineer senior/principal ketika harus merancang authorization yang benar-benar tahan terhadap real-world complexity.

Kalau bagian-bagian sebelumnya membahas:

- RBAC,
- ABAC,
- PBAC,
- ReBAC,
- ACL,
- Spring Security,
- Jakarta EE,
- microservices,
- token boundary,
- caching,
- auditability,
- testing,
- migration,

maka bagian ini menjawab:

> “Bagaimana saya mengambil keputusan arsitektur authorization secara matang, defensible, scalable, dan maintainable?”

---

## 1. Mental Model Utama

Authorization engineering level tinggi bukan tentang hafal annotation, framework, atau library.

Authorization engineering level tinggi adalah kemampuan menjaga invariant ini:

```text
Untuk setiap aksi penting, sistem hanya memperbolehkan subject yang tepat,
melakukan action yang tepat,
terhadap resource yang tepat,
dalam context yang tepat,
berdasarkan policy yang tepat,
dengan evidence yang bisa diaudit,
dan dengan failure mode yang aman.
```

Top engineer tidak bertanya:

```java
if (user.hasRole("ADMIN")) { ... }
```

Mereka bertanya:

```text
1. Apa invariant bisnis dan security yang harus tidak pernah dilanggar?
2. Siapa subject sebenarnya dalam aksi ini?
3. Resource mana yang sedang dilindungi?
4. Action ini semantic-nya apa?
5. Context apa yang relevan?
6. Apakah decision ini repeatable, explainable, dan auditable?
7. Apakah ada alternate path yang bisa bypass?
8. Apakah query/list/export/job/internal API punya boundary yang sama?
9. Bagaimana permission dicabut?
10. Apa yang terjadi saat policy source/cache/PDP/attribute source gagal?
```

Authorization yang matang bukan sekadar “boleh atau tidak”. Authorization adalah **control system**.

---

## 2. Referensi dan Prinsip Dasar

Beberapa rujukan penting yang menjadi baseline playbook ini:

1. **OWASP Authorization Cheat Sheet** menekankan deny-by-default, least privilege, centralized authorization logic, dan validasi authorization pada setiap request/operation yang membutuhkan kontrol akses.
2. **OWASP Top 10 Broken Access Control** menempatkan broken access control sebagai risiko utama, termasuk bypass melalui URL, parameter tampering, force browsing, dan pelanggaran least privilege.
3. **Spring Security Authorization Architecture** memosisikan `AuthorizationManager` sebagai komponen yang dipakai request-based, method-based, dan message-based authorization untuk membuat final access-control decision.
4. **NIST RBAC** menyediakan dasar formal untuk RBAC, hierarchy, role assignment, dan separation of duties.
5. **OPA** memosisikan policy engine sebagai sistem yang mengevaluasi input terhadap policies dan data untuk menghasilkan policy decision.

Referensi ini penting, tetapi playbook ini tidak berhenti pada compliance terhadap referensi. Tujuannya adalah membangun kemampuan desain yang **operasional, defensible, dan evolvable**.

---

## 3. Authorization Design Review Framework

Setiap desain authorization harus bisa melewati review berikut.

### 3.1 Subject Review

Pertanyaan:

```text
Siapa sebenarnya yang sedang bertindak?
```

Jangan langsung jawab “user”. Dalam sistem enterprise, subject bisa berupa:

- human user,
- delegated user,
- impersonating support user,
- system account,
- scheduled job,
- service account,
- external client,
- API consumer,
- integration partner,
- workflow engine,
- message consumer,
- batch processor,
- break-glass actor.

Model minimal:

```java
public final class SubjectRef {
    private final String subjectType; // HUMAN, SERVICE, JOB, SUPPORT, DELEGATED
    private final String subjectId;
    private final String tenantId;
    private final String actingAsSubjectId;
    private final String delegationId;

    // constructors/getters omitted
}
```

Top-level insight:

> “Authenticated principal” belum tentu sama dengan “effective authorization subject”.

Contoh:

```text
Support officer login as dirinya sendiri,
tetapi sedang bertindak atas nama user lain.
Audit harus menyimpan keduanya:
- real actor,
- effective actor.
```

Kalau hanya menyimpan effective actor, audit bisa menuduh user yang salah.

Kalau hanya menyimpan real actor, business action bisa tampak tidak sah.

---

### 3.2 Action Review

Pertanyaan:

```text
Apa action semantic yang sebenarnya?
```

Jangan berhenti pada CRUD.

Buruk:

```text
case.update
```

Lebih baik:

```text
case.assign
case.reassign
case.submit_recommendation
case.approve_recommendation
case.reject_recommendation
case.close
case.reopen
case.escalate
case.export
case.download_evidence
case.view_internal_notes
```

Kenapa?

Karena action berbeda punya:

- risk berbeda,
- audit requirement berbeda,
- actor requirement berbeda,
- separation-of-duty berbeda,
- context berbeda,
- state transition berbeda.

Anti-pattern:

```java
@PreAuthorize("hasAuthority('case.update')")
public void approveCase(Long caseId) { ... }
```

Masalah:

```text
Approve bukan sekadar update.
Approve adalah decision action.
```

Top-level insight:

> Permission yang terlalu umum akan berubah menjadi privilege escalation yang legal secara teknis tetapi salah secara bisnis.

---

### 3.3 Resource Review

Pertanyaan:

```text
Resource apa yang benar-benar dilindungi?
```

Resource bukan hanya row utama.

Contoh `Case`:

```text
Case
├── applicant profile
├── internal assessment
├── officer notes
├── legal memo
├── uploaded documents
├── correspondence
├── audit trail
├── payment/revenue info
├── appeal history
└── enforcement outcome
```

User boleh melihat case belum tentu boleh melihat semua child resource.

Model buruk:

```java
canViewCase(user, caseId)
```

Lalu seluruh DTO dikirim:

```json
{
  "caseNo": "C-001",
  "applicant": {...},
  "internalNotes": "...",
  "legalMemo": "...",
  "uploadedEvidence": [...]
}
```

Model lebih baik:

```java
can(user, VIEW_CASE_SUMMARY, caseRef)
can(user, VIEW_INTERNAL_NOTES, caseRef)
can(user, VIEW_LEGAL_MEMO, caseRef)
can(user, DOWNLOAD_EVIDENCE, documentRef)
```

Top-level insight:

> Object-level authorization harus memahami object graph, bukan hanya root entity.

---

### 3.4 Context Review

Pertanyaan:

```text
Kondisi apa yang mengubah keputusan?
```

Context umum:

- tenant,
- organization,
- agency,
- department,
- case state,
- assignment,
- relationship,
- time,
- channel,
- device posture,
- network zone,
- risk level,
- MFA freshness,
- delegation window,
- emergency access status,
- request source,
- data classification.

Context harus diperlakukan sebagai **decision input**, bukan global variable liar.

Buruk:

```java
TenantContext.getCurrentTenant();
SecurityContextHolder.getContext();
LocalDateTime.now();
```

tersebar di banyak tempat.

Lebih baik:

```java
public final class AuthorizationContext {
    private final String tenantId;
    private final String channel;
    private final String requestId;
    private final Instant decisionTime;
    private final String networkZone;
    private final boolean mfaFresh;
    private final Map<String, Object> attributes;
}
```

Top-level insight:

> Context harus dibuat eksplisit supaya bisa diuji, diaudit, dan direkonstruksi.

---

### 3.5 Policy Review

Pertanyaan:

```text
Di mana policy didefinisikan, di-version, dites, dan direview?
```

Policy bisa berada di:

- code,
- database,
- configuration,
- policy engine,
- admin UI,
- identity provider,
- gateway,
- service mesh,
- database RLS,
- workflow engine.

Semua boleh, asalkan jelas:

```text
1. siapa pemilik policy,
2. bagaimana policy berubah,
3. siapa reviewer,
4. bagaimana policy diuji,
5. bagaimana policy di-deploy,
6. bagaimana rollback,
7. bagaimana audit decision mengacu ke policy version.
```

Top-level insight:

> Policy yang tidak punya lifecycle governance adalah hardcoded rule dalam bentuk lain.

---

## 4. Threat Modeling Authorization

Threat modeling authorization berbeda dari threat modeling authentication.

Authentication bertanya:

```text
Apakah subject benar-benar siapa yang ia klaim?
```

Authorization bertanya:

```text
Setelah subject dikenali, apa saja yang bisa ia lakukan secara tidak sah?
```

### 4.1 Attack Surface Authorization

Authorization attack surface meliputi:

```text
1. URL path
2. query parameter
3. request body
4. object ID
5. tenant ID
6. organization ID
7. role claim
8. scope claim
9. batch item list
10. file ID
11. export endpoint
12. report endpoint
13. search endpoint
14. admin endpoint
15. internal endpoint
16. message consumer
17. scheduled job
18. workflow transition
19. websocket subscription
20. GraphQL field/resolver
21. cache key
22. pre-signed URL
23. retry/replay path
24. fallback path
25. debug/actuator endpoint
```

Top engineer mencari **alternate path**.

Bukan hanya:

```text
Apakah endpoint utama aman?
```

Tetapi:

```text
Apakah ada endpoint lain, job lain, export lain, atau message handler lain yang menghasilkan efek sama tanpa check yang sama?
```

---

### 4.2 Authorization Threat Checklist

Gunakan checklist berikut saat review:

```text
[ ] Bisakah user mengganti object ID dan mengakses object orang lain?
[ ] Bisakah user mengganti tenantId/orgId/agencyId di request?
[ ] Bisakah user mengirim role/permission di request body?
[ ] Bisakah user memakai endpoint list/search untuk menemukan object yang tidak boleh dilihat?
[ ] Bisakah user memakai export/report untuk bypass UI authorization?
[ ] Bisakah user memakai batch endpoint untuk menyisipkan object unauthorized di tengah request?
[ ] Bisakah user mengakses child resource walau root access terbatas?
[ ] Bisakah user melakukan transition workflow dari state yang salah?
[ ] Bisakah maker approve pekerjaannya sendiri?
[ ] Bisakah support impersonation meninggalkan audit yang salah?
[ ] Bisakah stale JWT claim memberi akses setelah permission dicabut?
[ ] Bisakah cache decision bocor antar tenant?
[ ] Bisakah internal service dipanggil langsung tanpa authorization context?
[ ] Bisakah async job memproses data tanpa boundary subject/tenant?
[ ] Bisakah policy/PDP failure membuat sistem fail-open?
```

---

## 5. Invariant-First Design

Top-level authorization design dimulai dari invariant, bukan role matrix.

### 5.1 Contoh Salah

```text
Role:
- ADMIN
- OFFICER
- REVIEWER
- SUPERVISOR
```

Lalu dibuat matrix:

```text
OFFICER can update case.
REVIEWER can approve case.
SUPERVISOR can assign case.
```

Masalahnya: ini belum menjawab boundary penting.

### 5.2 Contoh Benar

Mulai dari invariant:

```text
INV-001: User tidak boleh melihat case di luar tenant/agency-nya.
INV-002: User tidak boleh approve case yang ia submit/recommend sendiri.
INV-003: Case hanya boleh di-close dari state APPROVED atau REJECTED.
INV-004: Officer hanya boleh edit case yang assigned kepadanya atau team-nya.
INV-005: Legal memo hanya boleh dilihat role tertentu dalam case yang sama agency-nya.
INV-006: Export harus memakai boundary yang sama dengan list/search.
INV-007: Support impersonation harus menyimpan real actor dan effective actor.
INV-008: Break-glass access harus time-bound, reason-bound, dan audited.
```

Baru setelah itu turunkan:

```text
role -> permission -> condition -> enforcement point -> tests -> audit evidence
```

Top-level insight:

> Role matrix tanpa invariant adalah spreadsheet yang terlihat rapi tetapi tidak menjamin security.

---

## 6. Least Privilege Engineering

Least privilege bukan hanya “beri permission minimal”.

Least privilege adalah desain supaya privilege:

```text
1. scoped,
2. time-bound,
3. purpose-bound,
4. resource-bound,
5. reviewable,
6. revocable,
7. observable,
8. non-transferable kecuali explicit delegation.
```

### 6.1 Scope-Bound Role

Buruk:

```text
ROLE_REVIEWER
```

Lebih baik:

```text
ROLE_REVIEWER scoped to:
- tenant: T1
- agency: A1
- caseType: LICENSE_RENEWAL
- stage: TECHNICAL_REVIEW
```

Model:

```java
public final class RoleAssignment {
    private final String subjectId;
    private final String roleCode;
    private final String tenantId;
    private final String organizationUnitId;
    private final String resourceType;
    private final String resourceScope;
    private final Instant validFrom;
    private final Instant validUntil;
}
```

### 6.2 Purpose-Bound Access

Support access sebaiknya punya purpose:

```text
SUPPORT_VIEW_CASE for incident INC-2026-0007 until 2026-06-21T12:00Z
```

Bukan:

```text
SUPPORT_ADMIN forever
```

### 6.3 Reviewable Access

Setiap privilege penting harus punya lifecycle:

```text
request -> approval -> activation -> usage -> review -> expiry/revocation
```

Kalau privilege tidak punya expiry/review, ia akan menjadi privilege permanen secara praktis.

---

## 7. Deny-by-Default Architecture

Deny-by-default harus muncul di beberapa level.

### 7.1 Route Level

Spring example:

```java
http.authorizeHttpRequests(auth -> auth
    .requestMatchers("/public/**").permitAll()
    .requestMatchers("/actuator/health").permitAll()
    .anyRequest().denyAll()
);
```

Lalu whitelist explicit endpoint yang benar-benar punya handler authorization.

### 7.2 Service Level

```java
public CaseDetail getCaseDetail(String caseId) {
    Case c = caseRepository.findRequired(caseId);

    authorizationService.require(
        subject(),
        Actions.CASE_VIEW_DETAIL,
        ResourceRef.caseRef(c.getTenantId(), c.getId()),
        context()
    );

    return mapper.toDetail(c);
}
```

### 7.3 Query Level

```java
Specification<CaseEntity> visibleTo(SubjectRef subject) {
    return (root, query, cb) -> cb.and(
        cb.equal(root.get("tenantId"), subject.getTenantId()),
        root.get("agencyId").in(subject.getAllowedAgencyIds())
    );
}
```

### 7.4 Failure Level

```text
PDP unavailable -> deny sensitive action
attribute unavailable -> deny if attribute is required
cache corrupted -> bypass cache or deny
policy version mismatch -> deny or route to safe fallback
```

Top-level insight:

> Deny-by-default is not a slogan. It must be visible in routes, services, queries, caches, jobs, and failure paths.

---

## 8. Separation of Duty Design

Separation of duty harus dimodelkan sebagai invariant, bukan role naming.

### 8.1 Static Separation of Duty

Contoh:

```text
User tidak boleh punya role PAYMENT_INITIATOR dan PAYMENT_APPROVER sekaligus.
```

Ini dicek saat assignment.

### 8.2 Dynamic Separation of Duty

Contoh:

```text
User boleh punya role REVIEWER dan APPROVER,
tetapi tidak boleh approve case yang ia review sendiri.
```

Ini dicek saat decision.

### 8.3 Java Policy Example

```java
public final class MakerCheckerPolicy implements AuthorizationPolicy {
    @Override
    public AuthorizationDecision evaluate(AuthorizationRequest req) {
        if (!Actions.CASE_APPROVE.equals(req.action())) {
            return AuthorizationDecision.notApplicable("not-case-approve");
        }

        CaseSnapshot c = req.resourceAttributes().getCaseSnapshot();

        if (req.subject().subjectId().equals(c.recommendedBy())) {
            return AuthorizationDecision.deny(
                "maker-checker-violation",
                "User cannot approve own recommendation"
            );
        }

        return AuthorizationDecision.notApplicable("maker-checker-pass");
    }
}
```

Top-level insight:

> Static SoD melindungi role assignment. Dynamic SoD melindungi business action.

---

## 9. Policy Lifecycle Governance

Authorization policy harus punya SDLC.

### 9.1 Policy Lifecycle

```text
1. Proposal
2. Threat analysis
3. Business review
4. Security review
5. Test case definition
6. Implementation
7. Shadow mode
8. Decision diff
9. Enforcement rollout
10. Monitoring
11. Periodic review
12. Retirement
```

### 9.2 Policy Change Record

Setiap perubahan policy sebaiknya mencatat:

```text
policyId
policyVersion
changedBy
approvedBy
changeReason
riskLevel
affectedActions
affectedRoles
affectedResourceTypes
testEvidence
rolloutPlan
rollbackPlan
```

### 9.3 Policy Ownership

Hindari policy tanpa owner.

Contoh ownership:

```text
case.approve policy -> Case Management Product Owner + Security Reviewer
report.export policy -> Reporting Owner + Data Governance
breakglass policy -> Security Office + Operations Lead
tenant boundary policy -> Platform Architect + Data Governance
```

Top-level insight:

> Authorization policy adalah production behavior. Perlakukan seperti code, schema, dan infrastructure.

---

## 10. Security vs Usability Trade-Off

Authorization yang terlalu longgar membahayakan sistem.
Authorization yang terlalu ketat membuat user mencari bypass operasional.

Top engineer tidak memilih ekstrem. Mereka mendesain kontrol yang aman sekaligus operasional.

### 10.1 Example: Case Assignment

Strict model:

```text
Only assigned officer can edit case.
```

Masalah:

```text
Officer cuti, case urgent, SLA mendekat.
```

Naive bypass:

```text
Give supervisor ADMIN.
```

Better model:

```text
Supervisor can reassign case with reason.
Temporary acting officer can edit until validUntil.
Emergency override requires reason and audit.
```

### 10.2 Design Principle

```text
Do not remove control to support operations.
Add controlled exception path.
```

Controlled exception harus:

- explicit,
- approved jika perlu,
- time-bound,
- purpose-bound,
- audited,
- visible,
- reviewable.

---

## 11. Performance vs Correctness Trade-Off

Authorization sering ada di hot path.

Tetapi performance optimization yang salah bisa menciptakan security bug.

### 11.1 Safe Optimization Order

Urutan aman:

```text
1. Correct policy model
2. Correct enforcement point
3. Correct query scoping
4. Correct cache key
5. Correct invalidation
6. Bulk decision API
7. Precomputation
8. Local cache/sidecar
9. Advanced indexing/materialized view
```

Jangan mulai dari cache.

### 11.2 Cache Key Checklist

Cache key decision minimal harus mencakup:

```text
subject id
subject version/effective permission version
tenant id
action
resource type
resource id or resource scope
resource version if relevant
context attributes that affect decision
policy version
relationship version if relevant
```

Buruk:

```java
String key = userId + ":" + action;
```

Lebih benar:

```java
DecisionCacheKey key = new DecisionCacheKey(
    subjectId,
    subjectPermissionVersion,
    tenantId,
    action,
    resourceType,
    resourceId,
    resourceVersion,
    policyVersion,
    contextFingerprint
);
```

Top-level insight:

> Authorization cache yang salah lebih buruk daripada tidak ada cache, karena ia membuat denial/allow yang salah terlihat konsisten.

---

## 12. Centralization vs Autonomy Trade-Off

Tidak semua authorization harus dipusatkan di satu service.
Tidak semua authorization boleh dibiarkan tersebar.

### 12.1 Centralize What Must Be Consistent

Centralize:

- tenant boundary rules,
- role/permission resolution,
- policy decision model,
- audit schema,
- break-glass process,
- delegation model,
- high-risk action authorization,
- shared policy library,
- decision logging standard.

### 12.2 Decentralize What Must Be Domain-Aware

Keep domain-local:

- domain state interpretation,
- aggregate-specific invariant,
- workflow transition meaning,
- resource attribute extraction,
- domain-specific denial reason,
- query shape optimization.

### 12.3 Practical Pattern

```text
Central authorization platform:
- common Subject/Action/Resource/Context/Decision model
- policy registry
- role/permission resolver
- audit integration
- shared testing utilities

Domain service:
- resource loading
- state interpretation
- domain policy registration
- enforcement at service/query layer
```

Top-level insight:

> Centralize the language and governance. Keep domain meaning close to the domain.

---

## 13. Auditability as First-Class Requirement

A production authorization system must answer historical questions.

Not only:

```text
Is user X allowed now?
```

But:

```text
Why was user X allowed to approve case Y on 2026-06-20 at 14:03?
Who granted the permission?
What policy version was active?
What resource state was used?
Was the user acting under delegation?
Was tenant boundary satisfied?
Was break-glass used?
Was the decision cached?
```

### 13.1 Decision Audit Event

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decisionId": "dec-20260620-0001",
  "timestamp": "2026-06-20T07:03:10Z",
  "requestId": "req-abc",
  "subject": {
    "realActorId": "u-support-1",
    "effectiveActorId": "u-officer-7",
    "tenantId": "t-1",
    "delegationId": "del-77"
  },
  "action": "case.approve",
  "resource": {
    "type": "case",
    "id": "case-123",
    "tenantId": "t-1",
    "state": "PENDING_APPROVAL"
  },
  "context": {
    "channel": "WEB",
    "mfaFresh": true,
    "networkZone": "INTRANET"
  },
  "decision": "DENY",
  "reasonCode": "MAKER_CHECKER_VIOLATION",
  "policyVersion": "case-policy@2026.06.20",
  "cacheHit": false
}
```

### 13.2 What Not To Log

Jangan log sembarangan:

- full token,
- password/secret,
- sensitive PII,
- legal memo content,
- full document text,
- unnecessary request body,
- raw credentials.

Top-level insight:

> Auditability bukan berarti log everything. Auditability berarti log evidence yang cukup untuk merekonstruksi decision tanpa menciptakan data leak baru.

---

## 14. Operational Readiness Checklist

Sebelum authorization design masuk production, cek ini.

### 14.1 Enforcement Checklist

```text
[ ] Semua endpoint sensitif punya route-level authorization.
[ ] Semua business action punya service-level authorization.
[ ] Semua object-specific operation punya object-level authorization.
[ ] Semua list/search memakai authorized query scope.
[ ] Semua export/report memakai boundary yang sama dengan list/search.
[ ] Semua file download memakai resource-level authorization.
[ ] Semua batch item divalidasi per item atau per authorized scope.
[ ] Semua async job punya subject/context model yang jelas.
[ ] Semua internal API punya service/workload authorization.
[ ] Semua workflow transition punya guard.
```

### 14.2 Policy Checklist

```text
[ ] Policy punya owner.
[ ] Policy punya version.
[ ] Policy punya test.
[ ] Policy punya reviewer.
[ ] Policy punya rollback plan.
[ ] High-risk policy punya audit reason code.
[ ] Policy change masuk CI/CD atau controlled admin workflow.
```

### 14.3 Data Boundary Checklist

```text
[ ] Tenant boundary tidak bergantung pada request body.
[ ] Tenant boundary masuk query predicate.
[ ] Cache key tenant-aware.
[ ] Search index query tenant-aware.
[ ] Export query tenant-aware.
[ ] Count/aggregation tidak bocor.
[ ] Cross-tenant admin explicit dan audited.
```

### 14.4 Runtime Checklist

```text
[ ] Deny-by-default pada unknown route/action.
[ ] PDP failure behavior jelas.
[ ] Attribute source failure behavior jelas.
[ ] Cache invalidation mechanism jelas.
[ ] Permission revocation delay diketahui.
[ ] Metrics tersedia: allow/deny/error/cache hit/PDP latency.
[ ] Alert tersedia untuk spike deny/error/break-glass.
[ ] Decision logs tersedia untuk high-risk action.
```

---

## 15. Red-Team Checklist

Gunakan ini untuk menyerang desain sendiri.

```text
[ ] Saya ganti caseId di URL.
[ ] Saya ganti tenantId di query param.
[ ] Saya ganti agencyId di request body.
[ ] Saya kirim role tambahan di request body.
[ ] Saya pakai token lama setelah permission dicabut.
[ ] Saya pakai endpoint export bukan list.
[ ] Saya pakai endpoint report bukan detail.
[ ] Saya pakai search untuk menemukan hidden object.
[ ] Saya pakai batch endpoint dengan mixed authorized/unauthorized IDs.
[ ] Saya akses child document langsung dari documentId.
[ ] Saya akses websocket subscription manual.
[ ] Saya panggil internal endpoint langsung.
[ ] Saya replay request approval lama.
[ ] Saya coba approve pekerjaan sendiri.
[ ] Saya coba transition dari state ilegal.
[ ] Saya coba break-glass tanpa reason.
[ ] Saya coba impersonation tanpa audit trail.
[ ] Saya coba cache pollution antar tenant.
[ ] Saya coba policy/PDP timeout.
[ ] Saya coba fallback path saat dependency down.
```

Kalau salah satu skenario ini belum ada test atau mitigation, authorization belum matang.

---

## 16. Architecture Decision Record Template

Gunakan ADR untuk keputusan authorization besar.

```markdown
# ADR-XXX: Authorization Model for <System/Domain>

## Status
Proposed / Accepted / Deprecated / Superseded

## Context
- Domain problem:
- Protected resources:
- Sensitive actions:
- Actors/subjects:
- Tenancy/org boundary:
- Regulatory/audit requirements:

## Decision
We will use:
- Model: RBAC / ABAC / ReBAC / ACL / PBAC / hybrid
- Enforcement points:
- Policy decision location:
- Policy administration location:
- Attribute sources:
- Audit model:
- Failure behavior:

## Invariants
- INV-001:
- INV-002:
- INV-003:

## Alternatives Considered
1. Alternative A
   - Pros:
   - Cons:
2. Alternative B
   - Pros:
   - Cons:

## Consequences
Positive:
- ...

Negative:
- ...

Risk:
- ...

## Testing Strategy
- Permission matrix tests:
- Object-level tests:
- Tenant isolation tests:
- State transition tests:
- Policy tests:
- Regression tests:

## Operational Strategy
- Metrics:
- Logs:
- Alerts:
- Revocation:
- Cache invalidation:

## Rollback Strategy
- ...

## References
- ...
```

Top-level insight:

> Authorization ADR harus menyebut invariant, enforcement point, failure behavior, dan audit model. Kalau tidak, ADR hanya menjadi deskripsi teknologi.

---

## 17. Authorization Maturity Model

Gunakan maturity model ini untuk menilai sistem.

### Level 0 — Ad Hoc

Ciri:

```text
- if role == ADMIN tersebar
- authorization bercampur dengan UI
- tidak ada object-level check konsisten
- tidak ada test negative
- tidak ada audit reason
```

Risiko:

```text
Sangat rentan IDOR, privilege escalation, dan inconsistent behavior.
```

---

### Level 1 — Basic Route/Role Authorization

Ciri:

```text
- endpoint dilindungi role
- Spring/Jakarta annotation dipakai
- authentication sudah rapi
- permission masih coarse-grained
```

Risiko:

```text
Controller aman, tetapi service/query/export bisa bocor.
```

---

### Level 2 — Permission-Based Authorization

Ciri:

```text
- role dipetakan ke permission
- permission naming mulai standar
- service-level check mulai konsisten
- denial handling lebih jelas
```

Risiko:

```text
Masih rentan object-level dan tenant boundary jika tidak masuk query/resource model.
```

---

### Level 3 — Domain-Aware Authorization

Ciri:

```text
- policy service ada
- subject/action/resource/context eksplisit
- object-level check konsisten
- query scoping diterapkan
- workflow guard diterapkan
- test negative tersedia
```

Risiko:

```text
Scaling policy, cache, dan governance mulai menjadi tantangan.
```

---

### Level 4 — Governed Authorization Platform

Ciri:

```text
- policy lifecycle jelas
- audit decision lengkap
- cache/invalidation jelas
- bulk authorization tersedia
- role review tersedia
- delegation/break-glass controlled
- CI gate authorization ada
```

Risiko:

```text
Organizational maturity diperlukan; policy sprawl masih mungkin.
```

---

### Level 5 — Adaptive, Explainable, and Defensible Authorization

Ciri:

```text
- policy versioned and testable
- decision explainable
- historical reconstruction possible
- automated regression detection
- shadow decision/diff available
- contextual/risk-based access controlled
- red-team scenarios routinely tested
- authorization metrics part of operations
```

Ini level yang mendekati top 1% engineering practice.

---

## 18. Principal Engineer Discussion Prompts

Gunakan pertanyaan ini untuk melatih cara berpikir.

### 18.1 Design Prompt

```text
Kita punya 50 microservices, 20 user roles, 7 agencies, dan 200+ business actions.
Beberapa action tergantung state workflow, assignment, delegation, dan tenant boundary.
Bagaimana Anda mendesain authorization architecture?
```

Jawaban matang harus menyebut:

- subject/action/resource/context model,
- RBAC untuk coarse entitlement,
- ABAC untuk context/resource condition,
- ReBAC untuk assignment/relationship,
- policy service atau external PDP untuk governance,
- query scoping,
- audit decision,
- cache/invalidation,
- migration/shadow mode,
- failure behavior.

### 18.2 Incident Prompt

```text
User dari agency A bisa melihat export data agency B.
Detail endpoint sudah aman.
Apa root cause yang mungkin?
```

Kemungkinan:

- export query tidak memakai authorized scope,
- report service bypass service authorization,
- tenantId dari request body dipercaya,
- cache key tidak tenant-aware,
- async export job tidak membawa subject context,
- search index tidak difilter tenant,
- pre-signed URL tidak resource-bound.

### 18.3 Performance Prompt

```text
Authorization decision menyebabkan latency tinggi karena per row melakukan PDP call.
Bagaimana memperbaiki tanpa mengorbankan correctness?
```

Jawaban matang:

- jangan filter-after-fetch,
- ubah policy menjadi query predicate jika mungkin,
- gunakan bulk authorization,
- precompute effective permissions,
- cache attribute/relationship dengan version,
- decision cache dengan key benar,
- sidecar/local policy bundle,
- measure PDP latency/cache hit,
- invalidation path jelas.

### 18.4 Governance Prompt

```text
Business sering mengubah policy approval.
Hardcode membuat release lambat.
External policy engine terasa kompleks.
Apa opsi Anda?
```

Jawaban matang:

- kategorikan policy: stable invariant vs configurable rule,
- hardcode invariant fundamental di domain,
- externalize volatile business condition,
- mulai dengan internal policy registry,
- tambah admin workflow/versioning/test,
- gunakan shadow mode sebelum enforcement,
- jangan externalize semua hal membabi-buta.

---

## 19. Capstone Architecture

Berikut arsitektur authorization yang matang untuk Java enterprise/regulatory system.

```text
┌────────────────────────────────────────────────────────────────────┐
│ UI / SPA                                                            │
│ - hide disabled action                                              │
│ - show allowed operations from server                               │
│ - never trusted as enforcement                                      │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ API Gateway / Edge                                                  │
│ - authentication verification                                       │
│ - coarse route allow/deny                                           │
│ - audience/scope sanity check                                       │
│ - rate limit / mTLS / workload boundary                             │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Java Service PEP                                                    │
│ - request-level authorization                                       │
│ - method/service-level authorization                                │
│ - workflow transition guard                                         │
│ - file/export/report guard                                          │
│ - batch item guard                                                  │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Authorization Service / PDP Adapter                                 │
│ - Subject/Action/Resource/Context model                             │
│ - RBAC permission resolver                                          │
│ - ABAC attribute resolver                                           │
│ - ReBAC relationship resolver                                       │
│ - ACL/domain object resolver                                        │
│ - policy registry                                                   │
│ - decision combiner                                                 │
│ - reason/evidence/obligation                                        │
│ - cache/bulk decision                                               │
└────────────────────────────────────────────────────────────────────┘
          │                         │                         │
          ▼                         ▼                         ▼
┌───────────────────┐   ┌─────────────────────┐   ┌────────────────────┐
│ Policy Store/PAP  │   │ Attribute/PIP        │   │ Relationship Store │
│ - versioned       │   │ - org/tenant/user    │   │ - assignment       │
│ - tested          │   │ - resource state     │   │ - membership       │
│ - reviewed        │   │ - risk/context       │   │ - delegation       │
└───────────────────┘   └─────────────────────┘   └────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Data Access Layer                                                   │
│ - authorized query scope                                            │
│ - tenant predicate                                                  │
│ - search index filter                                               │
│ - report/export scope                                               │
│ - optional DB RLS defense-in-depth                                  │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Audit / Observability                                               │
│ - decision event                                                    │
│ - policy version                                                    │
│ - subject/resource/context snapshot                                 │
│ - reason code                                                       │
│ - correlation id                                                    │
│ - metrics allow/deny/error/cache/PDP latency                        │
└────────────────────────────────────────────────────────────────────┘
```

---

## 20. Java Implementation Skeleton

### 20.1 Core Types

Java 8-compatible style:

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    public AuthorizationRequest(
            SubjectRef subject,
            Action action,
            ResourceRef resource,
            AuthorizationContext context
    ) {
        this.subject = subject;
        this.action = action;
        this.resource = resource;
        this.context = context;
    }

    public SubjectRef subject() { return subject; }
    public Action action() { return action; }
    public ResourceRef resource() { return resource; }
    public AuthorizationContext context() { return context; }
}
```

Java 17+ style:

```java
public record AuthorizationRequest(
    SubjectRef subject,
    Action action,
    ResourceRef resource,
    AuthorizationContext context
) {}
```

### 20.2 Decision

```java
public final class AuthorizationDecision {
    public enum Effect {
        PERMIT,
        DENY,
        NOT_APPLICABLE,
        ERROR
    }

    private final Effect effect;
    private final String reasonCode;
    private final String message;
    private final String policyVersion;
    private final Map<String, Object> evidence;

    private AuthorizationDecision(
            Effect effect,
            String reasonCode,
            String message,
            String policyVersion,
            Map<String, Object> evidence
    ) {
        this.effect = effect;
        this.reasonCode = reasonCode;
        this.message = message;
        this.policyVersion = policyVersion;
        this.evidence = evidence;
    }

    public static AuthorizationDecision permit(String reasonCode) {
        return new AuthorizationDecision(Effect.PERMIT, reasonCode, null, null, Collections.emptyMap());
    }

    public static AuthorizationDecision deny(String reasonCode, String message) {
        return new AuthorizationDecision(Effect.DENY, reasonCode, message, null, Collections.emptyMap());
    }

    public boolean isPermit() {
        return effect == Effect.PERMIT;
    }
}
```

### 20.3 Service Facade

```java
public interface AuthorizationService {
    AuthorizationDecision decide(AuthorizationRequest request);

    default void require(AuthorizationRequest request) {
        AuthorizationDecision decision = decide(request);
        if (!decision.isPermit()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
    }

    Map<ResourceRef, AuthorizationDecision> decideBulk(List<AuthorizationRequest> requests);
}
```

### 20.4 Deny Override Combiner

```java
public final class DenyOverrideCombiner {
    public AuthorizationDecision combine(List<AuthorizationDecision> decisions) {
        AuthorizationDecision permit = null;

        for (AuthorizationDecision d : decisions) {
            if (d.effect() == AuthorizationDecision.Effect.DENY) {
                return d;
            }
            if (d.effect() == AuthorizationDecision.Effect.ERROR) {
                return AuthorizationDecision.deny("POLICY_ERROR", "Authorization policy failed safely");
            }
            if (d.effect() == AuthorizationDecision.Effect.PERMIT) {
                permit = d;
            }
        }

        if (permit != null) {
            return permit;
        }

        return AuthorizationDecision.deny("NO_APPLICABLE_POLICY", "No policy permitted the action");
    }
}
```

Top-level insight:

> A top-level authorization model should be explicit enough to reason about, test, audit, and evolve.

---

## 21. Final Top 1% Checklist

Jika Anda ingin mengukur apakah authorization design sudah matang, gunakan checklist terakhir ini.

```text
[ ] Subject model membedakan real actor, effective actor, service account, delegation, dan impersonation.
[ ] Action model semantic, bukan CRUD generik.
[ ] Resource model memahami root object dan child resource.
[ ] Context eksplisit dan bisa diaudit.
[ ] Policy punya owner, version, test, dan rollout.
[ ] Deny-by-default diterapkan di route/service/query/failure path.
[ ] Tenant/org boundary masuk query dan cache key.
[ ] Object-level authorization diterapkan untuk detail/update/delete/download.
[ ] List/search/export/report tidak bocor.
[ ] Workflow transition punya guard dan state invariant.
[ ] Maker-checker/separation-of-duty dites.
[ ] Delegation/impersonation/break-glass time-bound dan audited.
[ ] Token claims tidak dipercaya sebagai full policy.
[ ] Permission revocation delay diketahui dan diterima secara eksplisit.
[ ] Authorization cache key benar dan invalidation jelas.
[ ] PDP/policy/attribute failure behavior fail-secure.
[ ] Decision logs punya reason/evidence/policy version.
[ ] Negative tests tersedia untuk IDOR/BOLA/tenant bypass.
[ ] Bulk/batch authorization tidak memakai all-or-nothing sembarangan.
[ ] Migration menggunakan shadow/diff/gradual enforcement.
[ ] Architecture decision terdokumentasi lewat ADR.
```

Kalau sebagian besar checklist ini terpenuhi, Anda tidak lagi berada di level “menggunakan security framework”. Anda sudah berada di level **mendesain authorization system**.

---

## 22. Kesimpulan Seri

Authorization bukan fitur tambahan.

Authorization adalah salah satu pilar utama correctness di sistem enterprise.

Di sistem biasa, authorization bug menyebabkan user melihat tombol yang salah.

Di sistem regulatory, financial, government, healthcare, legal, dan case-management, authorization bug bisa berarti:

- data leak,
- keputusan tidak sah,
- audit failure,
- privilege abuse,
- regulatory breach,
- incident security,
- loss of trust,
- sistem tidak defensible.

Mental model terakhir:

```text
Authentication proves who is present.
Authorization proves what that presence is allowed to affect.
Audit proves why the system believed that decision was correct.
```

Engineer top-level menguasai ketiganya, tetapi tidak mencampuradukkannya.

---

## 23. Seri Selesai

Dengan Part 34 ini, seri **Java Authorization Modes and Patterns — Advanced Engineering** selesai.

Daftar bagian yang telah selesai:

```text
[x] Part 0  — Authorization Mental Model
[x] Part 1  — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2  — Java Platform Authorization Primitives
[x] Part 3  — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4  — RBAC Done Properly
[x] Part 5  — Permission and Capability Modeling
[x] Part 6  — ABAC: Attribute-Based Authorization
[x] Part 7  — PBAC and Policy-as-Code
[x] Part 8  — ReBAC: Relationship-Based Authorization
[x] Part 9  — ACL and Domain Object Security
[x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
[x] Part 11 — IDOR, BOLA, and Object-Level Authorization
[x] Part 12 — Authorization in Layered Java Applications
[x] Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
[x] Part 14 — Spring Method Security: Service-Level Authorization
[x] Part 15 — Spring Domain Authorization Patterns
[x] Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization
[x] Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging
[x] Part 18 — Data-Level Authorization and Query Scoping
[x] Part 19 — Workflow, State Machine, and Case Management Authorization
[x] Part 20 — Delegation, Impersonation, Acting Roles, and Break-Glass Access
[x] Part 21 — Hierarchical Organizations and Complex Role Resolution
[x] Part 22 — Temporal, Risk-Based, and Contextual Authorization
[x] Part 23 — Authorization for Microservices and Distributed Systems
[x] Part 24 — Token Scopes, Claims, and Authorization Boundaries
[x] Part 25 — Authorization Caching, Performance, and Scalability
[x] Part 26 — Authorization Failure Semantics and Error Handling
[x] Part 27 — Auditability, Explainability, and Regulatory Defensibility
[x] Part 28 — Secure Authorization Testing Strategy
[x] Part 29 — Authorization Anti-Patterns and Failure Modes
[x] Part 30 — Designing an Authorization Domain Model in Java
[x] Part 31 — Building an Internal Authorization Service
[x] Part 32 — External Policy Engine Integration from Java
[x] Part 33 — Authorization Migration and Refactoring Legacy Systems
[x] Part 34 — Top 1% Authorization Engineering Playbook
```

---

## 24. References

- Spring Security Reference — Authorization Architecture: https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Top 10 — Broken Access Control: https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/
- NIST Role Based Access Control Project: https://csrc.nist.gov/projects/role-based-access-control
- Open Policy Agent Documentation: https://openpolicyagent.org/docs
- Open Policy Agent Decision Logs: https://www.openpolicyagent.org/docs/latest/management-decision-logs/
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110
- RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens: https://datatracker.ietf.org/doc/html/rfc9068
- RFC 8707 — OAuth 2.0 Resource Indicators: https://datatracker.ietf.org/doc/html/rfc8707
- RFC 8693 — OAuth 2.0 Token Exchange: https://datatracker.ietf.org/doc/html/rfc8693


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-033.md">⬅️ Part 33 — Authorization Migration and Refactoring Legacy Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
