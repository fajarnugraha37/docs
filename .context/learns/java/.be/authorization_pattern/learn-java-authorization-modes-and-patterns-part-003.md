# Java Authorization Modes and Patterns — Advanced Engineering
## Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP

> Seri: `learn-java-authorization-modes-and-patterns`  
> File: `learn-java-authorization-modes-and-patterns-part-003.md`  
> Range Java: Java 8 sampai Java 25  
> Fokus: authorization architecture decomposition, enforcement topology, decision topology, policy administration, information retrieval, and failure modeling  
> Prasyarat seri ini: Part 0–2

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 0 kita membangun mental model dasar bahwa authorization bukan sekadar `hasRole("ADMIN")`, melainkan sistem keputusan:

```text
Can subject S perform action A on resource R under context C?
```

Pada Part 1 kita menajamkan vocabulary: subject, principal, role, permission, authority, entitlement, resource, action, context, policy, invariant, dan decision.

Pada Part 2 kita membedah primitive authorization di Java platform: `Principal`, JAAS `Subject`, `Permission`, `Policy`, `AccessController`, SecurityManager legacy, dan batasnya untuk aplikasi enterprise modern.

Part 3 ini adalah titik di mana kita naik satu level:

```text
Authorization is not just a check.
Authorization is an architecture.
```

Kalau authorization hanya dianggap sebagai check, maka desain biasanya menjadi:

```java
if (user.isAdmin()) {
    approve(caseId);
}
```

Tetapi sistem besar tidak sesederhana itu. Authorization pada aplikasi enterprise, regulatory system, case management platform, microservices, distributed system, dan multi-tenant platform membutuhkan pemisahan tanggung jawab:

```text
Where is the access enforced?
Where is the decision made?
Where is the policy authored?
Where is information fetched from?
How is the decision explained?
How does the system fail safely?
```

Empat pertanyaan itu melahirkan empat komponen klasik:

```text
PEP = Policy Enforcement Point
PDP = Policy Decision Point
PAP = Policy Administration Point
PIP = Policy Information Point
```

Model ini populer dalam arsitektur XACML/ABAC. Spesifikasi XACML OASIS mendefinisikan model pemrosesan kebijakan yang memisahkan decision, policy, request context, dan attribute retrieval. OPA juga memakai pola serupa secara konseptual: aplikasi melakukan enforcement, sedangkan OPA mengevaluasi policy sebagai general-purpose policy engine. Spring Security modern mengekspresikan konsep decision melalui `AuthorizationManager`, yang dipanggil oleh request-based, method-based, dan message-based authorization component. Referensi resmi: OASIS XACML 3.0, OPA docs, Spring Security Authorization Architecture, dan NIST ABAC/RBAC. [^xacml] [^opa] [^spring-authz] [^nist-abac] [^nist-rbac]

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan PEP, PDP, PAP, dan PIP secara presisi.
2. Mendesain flow authorization end-to-end untuk aplikasi Java monolith, modular monolith, Spring Boot service, Jakarta EE application, dan microservices.
3. Menentukan kapan decision dibuat lokal, kapan remote, kapan precomputed, dan kapan hybrid.
4. Membedakan authorization check, authorization decision, authorization policy, dan authorization evidence.
5. Mendesain authorization yang bisa diaudit dan dijelaskan.
6. Menganalisis trade-off latency, availability, consistency, cacheability, dan security.
7. Menghindari failure mode besar seperti fail-open, stale permission, PIP poisoning, inconsistent enforcement, dan bypass path.
8. Membangun skeleton Java authorization architecture yang bisa berkembang dari simple RBAC sampai external PDP.

---

## 2. Mental Model Utama

### 2.1 Authorization Sebagai Sistem Empat Tahap

Authorization bisa dipahami sebagai pipeline:

```text
[User/System Request]
        |
        v
[PEP: intercept and enforce]
        |
        v
[PDP: evaluate policy and produce decision]
        |
        v
[PIP: fetch attributes/facts/evidence]
        |
        v
[PAP: manage policies and rules]
```

Lebih lengkap:

```text
+---------------------+
| Requester           |
| user / service / job|
+----------+----------+
           |
           v
+---------------------+
| PEP                 |
| enforcement point   |
| - intercept request |
| - call PDP          |
| - enforce decision  |
+----------+----------+
           |
           | authorization request
           v
+---------------------+         +---------------------+
| PDP                 | <------ | PAP                 |
| decision point      | policy  | admin point         |
| - evaluate policy   | data    | - author policies   |
| - combine rules     |         | - approve changes   |
| - return decision   |         | - version policy    |
+----------+----------+         +---------------------+
           |
           | attribute/fact lookup
           v
+---------------------+
| PIP                 |
| information point   |
| - user attrs        |
| - resource attrs    |
| - org hierarchy     |
| - assignments       |
| - case state        |
+---------------------+
```

Namun di production, ini tidak selalu berupa empat service terpisah. Dalam aplikasi Java, semuanya bisa saja berada dalam satu process:

```text
Controller/Filter      = PEP
AuthorizationService   = PDP
Database/LDAP/Cache    = PIP
YAML/DB/Admin UI       = PAP
```

Atau di microservices:

```text
API Gateway            = coarse PEP
Service method         = fine-grained PEP
OPA sidecar            = PDP
Policy Git repo        = PAP backing store
User/org/case services = PIP
```

Yang penting bukan bentuk fisiknya, tetapi separation of responsibility.

---

## 3. Kenapa Perlu PEP/PDP/PAP/PIP?

Tanpa decomposition, authorization logic biasanya tersebar:

```java
if (user.hasRole("ADMIN")) { ... }
if (user.getDepartment().equals(case.getDepartment())) { ... }
if (case.getStatus() != CLOSED) { ... }
if (user.getId().equals(case.getAssignedOfficerId())) { ... }
if (!user.getId().equals(case.getCreatedBy())) { ... }
```

Masalahnya:

1. Rule tersebar di controller, service, repository, scheduler, listener, dan UI.
2. Tidak jelas mana rule security dan mana rule bisnis.
3. Tidak ada decision log yang konsisten.
4. Tidak ada single place untuk policy review.
5. Tidak bisa menjawab “kenapa user ini boleh approve?” secara historis.
6. Sulit menguji semua kombinasi.
7. Sulit migrasi ke ABAC/PBAC/ReBAC.
8. Sulit mengontrol bypass path.
9. Sulit menerapkan least privilege.
10. Sulit melakukan emergency revocation.

PEP/PDP/PAP/PIP memberi struktur:

```text
PEP answers: where do we stop unauthorized execution?
PDP answers: how do we decide?
PAP answers: who defines and changes policy?
PIP answers: what facts are needed to decide?
```

---

## 4. Policy Enforcement Point — PEP

### 4.1 Definisi

PEP adalah titik yang **mencegat permintaan** dan **menegakkan keputusan authorization**.

PEP bukan pihak yang harus tahu semua policy. PEP harus tahu:

1. request apa yang sedang terjadi,
2. subject/action/resource/context apa yang relevan,
3. bagaimana memanggil PDP,
4. bagaimana mengeksekusi hasil keputusan:
   - allow,
   - deny,
   - mask,
   - filter,
   - require step-up,
   - require approval,
   - log and continue,
   - fail closed.

Contoh PEP:

| Layer | Contoh PEP |
|---|---|
| API Gateway | Kong/NGINX/Envoy authorization plugin |
| Spring MVC | `AuthorizationFilter`, `SecurityFilterChain`, controller guard |
| Spring method | `@PreAuthorize`, custom method interceptor |
| Service | `authorizationService.require(...)` |
| Domain | aggregate transition guard |
| Repository | tenant/data predicate enforcement |
| Database | row-level security, view, stored procedure guard |
| Kafka consumer | message handler authorization |
| Scheduler/batch | job execution guard |
| UI | menu/button hiding; not security boundary |

### 4.2 PEP Adalah Enforcement, Bukan Dekorasi

PEP harus berada di jalur yang tidak bisa dilewati oleh operasi sensitif.

Buruk:

```java
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable Long id) {
    // No authorization. UI hides menu only.
    return caseService.getCase(id);
}
```

Lebih baik:

```java
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable Long id) {
    authorization.require(CurrentSubject.get(), Action.VIEW, ResourceRef.caseId(id));
    return caseService.getCase(id);
}
```

Tetapi masih ada problem: PEP controller hanya melindungi endpoint tersebut. Kalau `caseService.getCase(id)` dipanggil dari endpoint lain, batch export, report generator, atau internal API, check bisa terlewat.

Lebih kuat:

```java
public CaseDto getCase(Long id) {
    CaseEntity entity = caseRepository.findById(id)
        .orElseThrow(NotFoundException::new);

    authorization.require(CurrentSubject.get(), Action.VIEW, CaseResource.from(entity));

    return mapper.toDto(entity);
}
```

Lebih kuat lagi untuk list/search:

```java
public Page<CaseSummaryDto> searchCases(CaseSearchQuery query, Pageable pageable) {
    Subject subject = CurrentSubject.get();

    AuthorizationPredicate predicate = authorization.queryPredicate(
        subject,
        Action.VIEW,
        ResourceType.CASE
    );

    return caseRepository.search(query, predicate, pageable)
        .map(mapper::toSummaryDto);
}
```

Insight penting:

```text
Single-object read can use post-load object check.
List/search/export must use pre-query authorization predicate.
```

Kalau list/search mengambil semua data lalu difilter di memory, itu bisa bocor melalui count, pagination, timing, log, heap dump, trace, cache, dan accidental serialization.

### 4.3 PEP Granularity

PEP bisa coarse-grained atau fine-grained.

Coarse-grained:

```text
Only authenticated users with scope case-api can call /api/cases/**
```

Fine-grained:

```text
Officer can view case only if:
- same agency,
- assigned to the officer or officer's team,
- case is not sealed,
- officer has case.view permission for this case type,
- officer is not blocked by conflict-of-interest rule.
```

Keduanya dibutuhkan.

```text
Gateway PEP prevents obviously invalid traffic.
Service/domain PEP prevents business authorization bypass.
```

### 4.4 PEP Placement Strategy

Untuk sistem Java enterprise, gunakan layering ini:

```text
1. Edge/Gateway PEP
   - authentication required
   - token audience/scope coarse check
   - rate limit
   - endpoint class guard

2. Application request PEP
   - route-level authorization
   - user/client authority validation

3. Service method PEP
   - command/action authorization
   - business operation guard

4. Domain PEP
   - invariant/state transition guard
   - maker-checker
   - separation of duty

5. Repository/query PEP
   - row/object/data visibility
   - tenant scoping

6. Database PEP when needed
   - RLS/view/procedure for defense-in-depth
```

Jangan semua rule ditaruh di semua layer. Itu akan kacau. Gunakan prinsip:

```text
Coarse check early.
Precise check near business invariant.
Data visibility check before data leaves storage boundary.
```

---

## 5. Policy Decision Point — PDP

### 5.1 Definisi

PDP adalah komponen yang mengevaluasi authorization request terhadap policy dan mengembalikan decision.

PDP menjawab:

```text
Given subject, action, resource, and context,
what is the authorization decision?
```

Decision tidak harus hanya boolean.

Minimal:

```text
ALLOW / DENY
```

Lebih matang:

```text
decision: ALLOW | DENY | NOT_APPLICABLE | INDETERMINATE
reason: CASE_ASSIGNED_TO_OFFICER
policyVersion: 2026-06-19T10:30Z#abc123
obligations:
  - audit_access
  - mask_nric
  - require_watermark
advice:
  - show_request_access_button
```

### 5.2 Boolean Decision Itu Terlalu Miskin

Buruk:

```java
boolean allowed = authz.can(user, "APPROVE_CASE", caseId);
```

Masalah:

1. Tidak tahu kenapa allow.
2. Tidak tahu kenapa deny.
3. Tidak tahu policy mana yang digunakan.
4. Tidak tahu attribute mana yang dipakai.
5. Tidak bisa audit dengan baik.
6. Tidak bisa membedakan deny karena security, business state, missing data, atau PDP error.

Lebih baik:

```java
AuthorizationDecision decision = authorization.decide(request);

if (!decision.isAllowed()) {
    throw new AccessDeniedException(decision.safeMessage());
}
```

Dengan model:

```java
public final class AuthorizationDecision {
    private final DecisionEffect effect;
    private final String reasonCode;
    private final String policyId;
    private final String policyVersion;
    private final List<Obligation> obligations;
    private final List<Evidence> evidence;

    // Java 8-compatible constructor/getters omitted

    public boolean isAllowed() {
        return effect == DecisionEffect.ALLOW;
    }
}
```

Java 17+ bisa memakai `record`:

```java
public record AuthorizationDecision(
    DecisionEffect effect,
    String reasonCode,
    String policyId,
    String policyVersion,
    List<Obligation> obligations,
    List<Evidence> evidence
) {
    public boolean isAllowed() {
        return effect == DecisionEffect.ALLOW;
    }
}
```

### 5.3 Decision Effects

Empat effect klasik yang berguna:

```text
ALLOW
DENY
NOT_APPLICABLE
INDETERMINATE
```

Maknanya:

| Effect | Makna | Production handling |
|---|---|---|
| `ALLOW` | Ada policy yang mengizinkan | lanjutkan, jalankan obligation |
| `DENY` | Ada policy yang melarang | stop, audit deny |
| `NOT_APPLICABLE` | Tidak ada policy relevan | biasanya deny by default |
| `INDETERMINATE` | Tidak bisa decide karena error/missing facts/conflict | fail closed untuk operasi sensitif |

Dalam banyak aplikasi internal, kamu bisa menyederhanakan menjadi:

```text
ALLOW
DENY
ERROR
```

Tetapi untuk sistem besar, membedakan `DENY`, `NOT_APPLICABLE`, dan `INDETERMINATE` sangat berguna untuk operasi.

Contoh:

```text
DENY:
User is not assigned to this case.

NOT_APPLICABLE:
No policy exists for action APPEAL_REOPEN.

INDETERMINATE:
Policy requires user's department, but department service is unavailable.
```

Ketiganya tidak boleh diperlakukan sama di log internal.

### 5.4 PDP Bisa Lokal atau Remote

#### Local PDP

PDP berada di process aplikasi.

```text
Spring Boot Service
  - AuthorizationService
  - Policy classes
  - DB/cache attribute lookup
```

Kelebihan:

1. Latency rendah.
2. Mudah transactional dengan domain object.
3. Mudah debug.
4. Tidak ada network dependency.
5. Cocok untuk modular monolith dan domain-heavy system.

Kekurangan:

1. Policy tersebar jika banyak service.
2. Perlu deployment aplikasi untuk perubahan policy.
3. Governance lebih sulit.
4. Sulit konsisten lintas service.

#### Remote PDP

PDP adalah service/sidecar terpisah.

```text
Service PEP --> PDP service/OPA/Cedar engine --> decision
```

Kelebihan:

1. Policy centralized.
2. Bisa language-agnostic.
3. Bisa update policy tanpa redeploy semua aplikasi.
4. Cocok untuk multi-service platform.
5. Lebih mudah governance policy-as-code.

Kekurangan:

1. Network latency.
2. Availability dependency.
3. Attribute synchronization complexity.
4. Decision explainability harus dirancang.
5. Failure mode lebih sulit.

#### Sidecar PDP

PDP berjalan sebagai sidecar di pod yang sama.

```text
App container  -> localhost:8181 -> OPA sidecar
Policy bundle  -> sidecar cache
```

Kelebihan:

1. Latency lebih rendah daripada central remote PDP.
2. Mengurangi blast radius.
3. Bisa fail locally jika central policy service down.
4. Cocok untuk Kubernetes.

Kekurangan:

1. Operasional lebih kompleks.
2. Policy/data synchronization tetap harus benar.
3. Resource overhead per pod.
4. Debugging multi-container.

### 5.5 PDP Seharusnya Pure Decision, Bukan Executor

PDP sebaiknya tidak menjalankan business operation. PDP hanya memutuskan.

Buruk:

```text
PDP.approveCaseIfAllowed(caseId)
```

Lebih baik:

```text
PEP asks: can subject APPROVE case?
PDP answers: ALLOW/DENY + obligations.
PEP/service executes approve if allowed.
```

Alasannya:

1. Separation of concerns.
2. Audit lebih jelas.
3. Policy engine tidak perlu tahu semua side effect bisnis.
4. Menghindari coupling policy dengan domain mutation.
5. Memudahkan testing.

---

## 6. Policy Administration Point — PAP

### 6.1 Definisi

PAP adalah tempat policy dibuat, dikelola, direview, disetujui, diversi, dan dipublikasikan.

PAP bukan selalu UI. PAP bisa berupa:

1. Git repository policy-as-code.
2. Database table permission matrix.
3. Admin UI access management.
4. IAM console.
5. YAML/JSON configuration.
6. Workflow approval system.
7. Internal governance process.

### 6.2 Mengapa PAP Penting?

Authorization bukan hanya runtime problem. Ini juga governance problem.

Pertanyaan PAP:

```text
Who can create policy?
Who can change policy?
Who approves high-risk permission?
How is policy reviewed?
How is policy versioned?
How is policy rollback done?
How do we know which policy allowed a historical action?
```

Tanpa PAP yang jelas, policy berubah lewat:

```text
- hotfix code,
- SQL manual update,
- admin giving ADMIN role,
- hidden feature flag,
- emergency production change,
- undocumented config.
```

Itu menyebabkan privilege creep.

### 6.3 PAP Maturity Level

#### Level 0 — Hardcoded Policy

```java
if (user.hasRole("SUPERVISOR")) {
    return true;
}
```

Cocok hanya untuk sistem kecil atau bootstrap.

Risiko:

1. Perubahan policy butuh code deploy.
2. Tidak ada policy inventory.
3. Sulit direview oleh non-engineer.
4. Role string typo.
5. Tidak ada audit policy change.

#### Level 1 — Config-Based Policy

```yaml
permissions:
  CASE_APPROVE:
    roles:
      - CASE_SUPERVISOR
      - AGENCY_ADMIN
```

Kelebihan:

1. Lebih terlihat.
2. Bisa direview via PR.
3. Bisa diuji di CI.

Risiko:

1. Masih butuh deployment/config rollout.
2. Expressiveness terbatas.
3. Validasi schema wajib.

#### Level 2 — Database-Managed Policy

```text
ROLE
PERMISSION
ROLE_PERMISSION
USER_ROLE
ROLE_SCOPE
```

Kelebihan:

1. Bisa diubah runtime.
2. Cocok untuk admin UI.
3. Cocok untuk enterprise access management.

Risiko:

1. Perubahan langsung bisa berbahaya.
2. Perlu approval workflow.
3. Perlu audit table.
4. Perlu cache invalidation.
5. Perlu policy snapshot untuk historical decision.

#### Level 3 — Policy-as-Code

```rego
allow if {
    input.action == "case.approve"
    input.subject.permissions[_] == "case.approve"
    input.resource.assignedSupervisorId == input.subject.id
    input.resource.status == "PENDING_REVIEW"
}
```

Kelebihan:

1. Testable.
2. Reviewable.
3. Versioned.
4. Portable.
5. Cocok untuk complex policies.

Risiko:

1. Butuh policy engineering skill.
2. Debugging bisa sulit.
3. Input schema harus stabil.
4. Policy/data sync harus benar.

#### Level 4 — Governed Policy Lifecycle

Melibatkan:

1. Policy authoring.
2. Static validation.
3. Unit tests.
4. Simulation.
5. Approval workflow.
6. Deployment rings.
7. Rollback.
8. Decision diff.
9. Periodic access review.
10. Historical reconstruction.

Ini maturity untuk sistem regulated.

### 6.4 PAP dan Separation of Duty

PAP sendiri harus punya authorization.

Contoh aturan:

```text
- Developer can propose policy.
- Security officer can review policy.
- Business owner can approve policy.
- Platform operator can deploy policy.
- No one can both request and approve their own privilege escalation.
```

Ini recursive:

```text
Authorization system needs authorization.
```

Kalau PAP tidak aman, PDP/PEP yang bagus tetap bisa dikalahkan dengan policy change berbahaya.

---

## 7. Policy Information Point — PIP

### 7.1 Definisi

PIP adalah sumber informasi yang dibutuhkan PDP untuk membuat keputusan.

PIP menyediakan facts/attributes/evidence.

Contoh:

| Attribute/fact | Sumber PIP |
|---|---|
| user id | security context/token/session |
| user roles | IAM DB, Keycloak, LDAP, internal IAM service |
| user department | HR/org service |
| agency | user profile service |
| case status | case database |
| assigned officer | case service/database |
| conflict-of-interest flag | compliance service |
| tenant id | tenant resolver/database |
| action risk level | policy metadata |
| business calendar | calendar service |
| delegation record | delegation service |
| resource classification | document metadata service |

### 7.2 PIP Adalah Sumber Kebenaran atau Cache dari Sumber Kebenaran

Salah satu pertanyaan terpenting:

```text
Which PIP is authoritative?
```

Contoh buruk:

```text
JWT claim says department = A.
Database says department = B.
Request body says department = C.
```

Mana yang dipercaya?

Desain harus eksplisit:

```text
- Request body is never trusted for authorization facts.
- Token claim is trusted only for stable identity and coarse authority.
- Department is loaded from internal user profile service.
- Case state is loaded from case database within transaction.
```

### 7.3 Attribute Freshness

Tidak semua attribute punya freshness requirement yang sama.

| Attribute | Freshness expectation |
|---|---|
| user id | current request |
| role assignment | seconds/minutes depending on risk |
| case status | transaction-current |
| assigned officer | transaction-current |
| department | minutes/hours maybe okay |
| user display name | stale acceptable |
| conflict flag | must be fresh for high-risk action |
| break-glass status | immediate revocation required |

Policy harus tahu apakah attribute boleh stale.

Contoh:

```text
Viewing public-ish dashboard:
role cache TTL 5 minutes may be acceptable.

Approving enforcement decision:
case status and assignee must be transaction-current.
```

### 7.4 PIP Failure Mode

PIP bisa gagal:

1. database unavailable,
2. user profile service timeout,
3. policy data cache stale,
4. resource not found,
5. inconsistent replication,
6. attribute missing,
7. schema mismatch,
8. corrupted data,
9. invalid tenant context.

PDP harus membedakan:

```text
DENY because policy says no.
INDETERMINATE because needed information is unavailable.
```

Contoh:

```java
try {
    UserProfile profile = userProfileProvider.load(subject.id());
    CaseSnapshot caseSnapshot = caseAttributeProvider.load(caseId);
    return policy.evaluate(subject, action, caseSnapshot, profile, context);
} catch (AttributeUnavailableException ex) {
    return AuthorizationDecision.indeterminate("ATTRIBUTE_UNAVAILABLE", ex.attributeName());
}
```

### 7.5 PIP Poisoning

PIP poisoning terjadi ketika attacker atau bug membuat PDP memakai fakta palsu.

Contoh:

```json
{
  "userId": "u123",
  "tenantId": "tenant-a",
  "role": "ADMIN"
}
```

Kalau data itu berasal dari request body dan dipercaya, authorization sudah rusak.

Rules:

```text
Never trust client-provided authorization attributes.
Never trust resource ownership from DTO.
Never trust tenantId from URL alone.
Never trust user role from frontend state.
Never trust mutable token claims for high-risk authorization without server-side validation.
```

---

## 8. Request Context Handler

Dalam XACML, sering ada konsep context handler yang menormalisasi request/response antara PEP, PDP, dan PIP. Dalam aplikasi Java, meskipun tidak disebut eksplisit, kamu tetap butuh layer ini.

### 8.1 Apa Fungsi Context Handler?

Context handler membangun authorization request canonical:

```text
HTTP request / method call / message event
        |
        v
AuthorizationRequest
```

Contoh model:

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    // getters omitted
}
```

Isi context:

```java
public final class AuthorizationContext {
    private final String tenantId;
    private final String correlationId;
    private final String channel;
    private final String sourceIp;
    private final Instant requestTime;
    private final Map<String, Object> attributes;
}
```

### 8.2 Kenapa Canonical Request Penting?

Tanpa canonical request, setiap PEP akan memanggil PDP dengan bentuk berbeda:

```text
Controller A sends userId + role string.
Controller B sends Authentication object.
Batch job sends system user string.
Kafka consumer sends headers.
Report service sends tenant id only.
```

Akibatnya:

1. PDP sulit reusable.
2. Decision log tidak konsisten.
3. Testing policy sulit.
4. PIP lookup kacau.
5. Bypass path sulit dideteksi.

Canonical request membuat semua enforcement path memakai bahasa yang sama.

---

## 9. Decision Flow End-to-End

### 9.1 Simple Flow

```text
1. Request arrives.
2. PEP extracts subject/action/resource/context.
3. PEP sends AuthorizationRequest to PDP.
4. PDP loads policy.
5. PDP asks PIP for missing attributes.
6. PDP evaluates policy.
7. PDP returns AuthorizationDecision.
8. PEP enforces decision.
9. PEP emits audit event.
10. Business operation runs only if allowed.
```

### 9.2 Sequence Diagram

```text
Client
  |
  | HTTP POST /cases/123/approve
  v
Controller / PEP
  |
  | build request: subject=u1, action=case.approve, resource=case:123
  v
AuthorizationService / PDP
  |
  | load user roles, delegation, org unit
  v
UserProfile PIP
  |
  | load case status, assignee, agency, creator
  v
CaseData PIP
  |
  | evaluate policy
  v
PDP returns Decision(ALLOW, reason=ASSIGNED_SUPERVISOR, obligations=[AUDIT])
  |
  v
PEP enforces obligations
  |
  v
CaseService.approve()
  |
  v
Audit event emitted
```

### 9.3 Flow with Deny

```text
Client
  |
  | POST /cases/123/approve
  v
PEP
  |
  v
PDP
  |
  | Case status = CLOSED
  v
Decision(DENY, reason=CASE_ALREADY_CLOSED)
  |
  v
PEP throws AccessDeniedException / BusinessAccessDeniedException
  |
  v
HTTP 403 or domain-specific denial response
  |
  v
Audit denial
```

Catatan:

Tidak semua deny adalah security incident. `CASE_ALREADY_CLOSED` bisa jadi business denial. Tetapi tetap authorization-relevant karena melarang action terhadap resource pada state tertentu.

---

## 10. Authorization Topologies

### 10.1 Topology A — In-Process Authorization Library

```text
+-----------------------------+
| Java Application            |
|                             |
| Controller/Service = PEP    |
| AuthorizationService = PDP  |
| DB/Cache = PIP              |
| Config/DB = PAP             |
+-----------------------------+
```

Cocok untuk:

1. monolith,
2. modular monolith,
3. domain-heavy system,
4. low latency requirement,
5. team kecil/sedang,
6. early-stage authorization maturity.

Kelebihan:

1. sederhana,
2. cepat,
3. transactional,
4. mudah test,
5. mudah refactor.

Kekurangan:

1. policy bisa tersebar kalau banyak aplikasi,
2. butuh redeploy untuk perubahan code policy,
3. sulit lintas bahasa.

### 10.2 Topology B — Shared Authorization Library

```text
Service A ----+
Service B ----+--> shared authz library
Service C ----+
```

Cocok jika:

1. semua service Java,
2. policy relatif sama,
3. kamu butuh consistency,
4. remote PDP belum justified.

Risiko:

1. version skew,
2. hidden coupling,
3. library terlalu besar,
4. migration sulit,
5. policy rollout tergantung service deployment.

Gunakan strict semantic versioning.

### 10.3 Topology C — Central Authorization Service

```text
Service A PEP --> Authz Service PDP
Service B PEP --> Authz Service PDP
Service C PEP --> Authz Service PDP
```

Cocok untuk:

1. banyak service,
2. multi-language platform,
3. governance terpusat,
4. policy sering berubah,
5. audit centralization.

Kelebihan:

1. single decision service,
2. central audit,
3. central policy versioning,
4. reusable.

Kekurangan:

1. latency,
2. availability dependency,
3. scaling pressure,
4. cache invalidation,
5. request schema harus matang.

### 10.4 Topology D — OPA/Cedar Sidecar PDP

```text
+-----------------------------+
| Pod                         |
|  +----------+  localhost    |
|  | Java App | ----------->  |
|  +----------+               |
|       |                     |
|       v                     |
|  +----------+               |
|  | OPA/Cedar|               |
|  | sidecar  |               |
|  +----------+               |
+-----------------------------+
```

Cocok untuk:

1. Kubernetes,
2. cloud-native policy,
3. low latency local decision,
4. centralized policy distribution,
5. multi-language services.

Kekurangan:

1. operational complexity,
2. policy bundle sync,
3. sidecar resource overhead,
4. local data synchronization.

### 10.5 Topology E — Gateway-Only Authorization

```text
Client --> API Gateway PEP/PDP --> Services
```

Cocok hanya untuk coarse authorization.

Tidak cukup untuk object-level authorization.

Buruk jika dipakai sebagai satu-satunya authorization:

```text
Gateway knows user has case-api scope.
Gateway does not know whether user can approve case 123.
```

Kesimpulan:

```text
Gateway authorization is necessary but not sufficient.
```

### 10.6 Topology F — Database-Enforced Authorization

```text
Application --> DB view/RLS/procedure --> authorized rows only
```

Cocok untuk:

1. data-heavy systems,
2. reporting,
3. multi-tenant row isolation,
4. defense-in-depth,
5. legacy app with many bypass paths.

Kekurangan:

1. policy expressiveness terbatas,
2. sulit mengakses user context dengan aman,
3. DB coupling tinggi,
4. testing lebih sulit,
5. tidak menggantikan domain operation authorization.

---

## 11. Java/Spring Mapping

### 11.1 Spring Security Request Authorization

Spring Security modern menggunakan `AuthorizationManager` sebagai abstraction untuk final access control decision pada request-based, method-based, dan message-based authorization. Artinya, Spring sudah memberi hook PDP-like di dalam framework. [^spring-authz]

Simplified mapping:

```text
SecurityFilterChain / AuthorizationFilter = PEP
AuthorizationManager                    = PDP-like decision component
Authentication / GrantedAuthority        = subject evidence
UserDetailsService/JwtAuthenticationConverter = partial PIP
Configuration/beans                      = PAP-lite
```

Contoh request authorization:

```java
@Bean
SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(authz -> authz
        .requestMatchers("/actuator/health").permitAll()
        .requestMatchers("/api/admin/**").hasAuthority("admin.access")
        .anyRequest().authenticated()
    );
    return http.build();
}
```

Ini route-level PEP/PDP. Tetapi belum cukup untuk object-level decision.

### 11.2 Custom AuthorizationManager

```java
public final class CaseAccessAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final AuthorizationService authorizationService;

    public CaseAccessAuthorizationManager(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext context) {

        Authentication auth = authentication.get();
        String caseId = context.getVariables().get("caseId");

        com.example.authz.AuthorizationDecision decision = authorizationService.decide(
            AuthorizationRequest.builder()
                .subject(SubjectRef.from(auth))
                .action(Action.of("case.view"))
                .resource(ResourceRef.of("case", caseId))
                .context(RequestContextExtractor.from(context))
                .build()
        );

        return new AuthorizationDecision(decision.isAllowed());
    }
}
```

Catatan:

Di Spring Security terbaru, API bisa memakai `authorize`/`AuthorizationResult` tergantung versi. Desain konseptualnya tetap sama: framework memanggil manager untuk decision.

### 11.3 Method Security as PEP

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approveCase(Long caseId) {
    ...
}
```

Ini bagus untuk coarse command permission, tetapi belum memeriksa apakah user boleh approve case tertentu.

Lebih domain-aware:

```java
@PreAuthorize("@caseAuthorization.canApprove(authentication, #caseId)")
public void approveCase(Long caseId) {
    ...
}
```

Lebih explicit dan testable:

```java
public void approveCase(Long caseId) {
    CaseEntity caseEntity = caseRepository.findByIdForUpdate(caseId)
        .orElseThrow(NotFoundException::new);

    authorization.require(
        CurrentSubject.get(),
        Action.CASE_APPROVE,
        CaseResource.from(caseEntity)
    );

    caseEntity.approve(CurrentSubject.get().id());
}
```

### 11.4 Spring PEP Placement Pattern

Recommended:

```text
SecurityFilterChain:
  - authentication required
  - coarse endpoint authorization

Controller:
  - parameter validation
  - maybe coarse request guard

Application Service:
  - command authorization
  - object/state authorization

Repository:
  - data visibility predicate

Domain:
  - non-bypassable business invariants
```

---

## 12. Jakarta EE Mapping

Jakarta EE/Jakarta Security/Jakarta Authorization mapping:

```text
Container security constraint = PEP
@RolesAllowed                 = PEP/PDP-lite
SecurityContext               = subject/caller context
Jakarta Authorization SPI      = lower-level permission decision integration
Deployment descriptor/config   = PAP-lite
Application DB/LDAP/IAM        = PIP
```

Contoh:

```java
@RolesAllowed("CASE_SUPERVISOR")
public void approveCase(Long caseId) {
    ...
}
```

Ini role-level check. Untuk domain object:

```java
public void approveCase(Long caseId) {
    CaseEntity caseEntity = caseRepository.find(caseId);

    authorization.require(
        subjectProvider.currentSubject(),
        Action.CASE_APPROVE,
        CaseResource.from(caseEntity)
    );

    caseEntity.approve();
}
```

Pelajaran penting:

```text
Container authorization is useful for coarse-grained application protection.
Domain authorization still belongs near domain operation.
```

---

## 13. Designing AuthorizationRequest

### 13.1 Java 8-Compatible Model

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    private AuthorizationRequest(Builder builder) {
        this.subject = Objects.requireNonNull(builder.subject, "subject");
        this.action = Objects.requireNonNull(builder.action, "action");
        this.resource = Objects.requireNonNull(builder.resource, "resource");
        this.context = builder.context != null
            ? builder.context
            : AuthorizationContext.empty();
    }

    public SubjectRef subject() { return subject; }
    public Action action() { return action; }
    public ResourceRef resource() { return resource; }
    public AuthorizationContext context() { return context; }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private SubjectRef subject;
        private Action action;
        private ResourceRef resource;
        private AuthorizationContext context;

        public Builder subject(SubjectRef subject) {
            this.subject = subject;
            return this;
        }

        public Builder action(Action action) {
            this.action = action;
            return this;
        }

        public Builder resource(ResourceRef resource) {
            this.resource = resource;
            return this;
        }

        public Builder context(AuthorizationContext context) {
            this.context = context;
            return this;
        }

        public AuthorizationRequest build() {
            return new AuthorizationRequest(this);
        }
    }
}
```

### 13.2 Java 17+ Record Model

```java
public record AuthorizationRequest(
    SubjectRef subject,
    Action action,
    ResourceRef resource,
    AuthorizationContext context
) {
    public AuthorizationRequest {
        Objects.requireNonNull(subject, "subject");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(resource, "resource");
        context = context == null ? AuthorizationContext.empty() : context;
    }
}
```

### 13.3 Action Type

Buruk:

```java
String action = "approve";
```

Lebih baik:

```java
public final class Action {
    public static final Action CASE_VIEW = new Action("case.view");
    public static final Action CASE_APPROVE = new Action("case.approve");
    public static final Action CASE_REASSIGN = new Action("case.reassign");

    private final String value;

    private Action(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("Action must not be blank");
        }
        this.value = value;
    }

    public static Action of(String value) {
        return new Action(value);
    }

    public String value() {
        return value;
    }
}
```

### 13.4 ResourceRef vs Loaded Resource

Untuk beberapa action, cukup resource reference:

```text
resource = case:123
```

Untuk action lain, PDP butuh snapshot resource:

```text
case id = 123
case status = PENDING_REVIEW
case agency = CEA
case assigned supervisor = u456
case created by = u123
case classification = CONFIDENTIAL
```

Desain:

```java
public final class ResourceRef {
    private final String type;
    private final String id;

    // case:123, document:abc, report:q4
}
```

```java
public final class CaseResource {
    private final Long id;
    private final String agencyId;
    private final String status;
    private final String assignedOfficerId;
    private final String createdBy;
    private final String classification;
}
```

PDP bisa memutuskan apakah perlu memanggil PIP untuk load snapshot atau PEP sudah mengirim resource snapshot.

Rule:

```text
If resource is already loaded in the transaction, pass a trusted snapshot to PDP.
If resource is not loaded, PDP/PIP may load required attributes.
Never pass client-provided resource attributes as authoritative.
```

---

## 14. Designing AuthorizationDecision

### 14.1 Decision Model

```java
public enum DecisionEffect {
    ALLOW,
    DENY,
    NOT_APPLICABLE,
    INDETERMINATE
}
```

```java
public final class AuthorizationDecision {
    private final DecisionEffect effect;
    private final String reasonCode;
    private final String policyId;
    private final String policyVersion;
    private final List<Obligation> obligations;
    private final List<Evidence> evidence;

    public boolean isAllowed() {
        return effect == DecisionEffect.ALLOW;
    }

    public boolean isDenied() {
        return effect == DecisionEffect.DENY
            || effect == DecisionEffect.NOT_APPLICABLE
            || effect == DecisionEffect.INDETERMINATE;
    }
}
```

### 14.2 Reason Code

Reason code harus stabil dan machine-readable.

Contoh:

```text
ALLOW_CASE_ASSIGNED_SUPERVISOR
ALLOW_CASE_AGENCY_ADMIN
DENY_CASE_NOT_ASSIGNED
DENY_CROSS_TENANT_ACCESS
DENY_CASE_ALREADY_CLOSED
DENY_SELF_APPROVAL_NOT_ALLOWED
DENY_PERMISSION_MISSING
INDETERMINATE_ATTRIBUTE_UNAVAILABLE
NOT_APPLICABLE_NO_POLICY
```

Jangan reason hanya natural language:

```text
"User can't approve this because not allowed"
```

Gunakan:

```text
reasonCode = DENY_SELF_APPROVAL_NOT_ALLOWED
safeMessage = You are not allowed to approve this case.
internalMessage = User u123 created case 1001 and policy CASE_APPROVAL_SOD denies self approval.
```

### 14.3 Obligations

Obligation adalah hal yang wajib dilakukan PEP jika decision allow.

Contoh:

```text
- audit access
- mask sensitive fields
- watermark exported document
- require approval workflow
- limit result to authorized fields
- show warning banner
- require step-up authentication
```

Contoh model:

```java
public final class Obligation {
    private final String type;
    private final Map<String, String> parameters;
}
```

Contoh decision:

```json
{
  "effect": "ALLOW",
  "reasonCode": "ALLOW_CASE_SUPERVISOR",
  "obligations": [
    { "type": "AUDIT_ACCESS" },
    { "type": "MASK_FIELD", "field": "nric" }
  ]
}
```

PEP harus memahami obligation. Kalau PEP tidak bisa menjalankan obligation, decision harus diperlakukan gagal.

```text
ALLOW + obligation not enforced = unsafe.
```

### 14.4 Advice

Advice mirip obligation, tetapi tidak wajib untuk security.

Contoh:

```text
- display request-access button
- show contact admin message
- suggest delegation request
```

Dalam sistem enterprise, pisahkan:

```text
Obligation = must enforce.
Advice = optional guidance.
```

---

## 15. Policy Combining

Ketika ada banyak policy, PDP harus menggabungkan hasilnya.

### 15.1 Deny Override

Jika ada satu deny, hasil akhir deny.

```text
Policy A: allow because user has case.approve
Policy B: deny because user is case creator
Final: deny
```

Cocok untuk:

1. separation of duty,
2. legal hold,
3. suspension,
4. tenant isolation,
5. conflict of interest,
6. sealed record.

### 15.2 Permit Override

Jika ada satu allow, hasil akhir allow.

Cocok untuk:

1. emergency break-glass,
2. superuser with explicit audit,
3. support override.

Tetapi berbahaya jika terlalu luas.

### 15.3 First Applicable

Policy dievaluasi berurutan. Hasil pertama yang applicable dipakai.

Risiko:

1. order-dependent,
2. sulit diaudit,
3. mudah bug saat menambah policy.

### 15.4 Only-One-Applicable

Harus tepat satu policy applicable. Kalau lebih dari satu, conflict.

Cocok untuk regulated workflows yang ingin policy deterministik.

### 15.5 Recommended Default

Untuk enterprise business authorization:

```text
Use deny-by-default.
Use deny-override for hard constraints.
Use explicit allow policies for grants.
Treat conflict as deny/indeterminate depending on cause.
```

Pseudo-code:

```java
public AuthorizationDecision combine(List<AuthorizationDecision> decisions) {
    boolean hasAllow = false;
    AuthorizationDecision allowDecision = null;

    for (AuthorizationDecision decision : decisions) {
        if (decision.effect() == DecisionEffect.DENY) {
            return decision;
        }
        if (decision.effect() == DecisionEffect.INDETERMINATE) {
            return decision;
        }
        if (decision.effect() == DecisionEffect.ALLOW) {
            hasAllow = true;
            allowDecision = decision;
        }
    }

    if (hasAllow) {
        return allowDecision;
    }

    return AuthorizationDecision.notApplicable("NOT_APPLICABLE_NO_POLICY");
}
```

---

## 16. Fail-Open vs Fail-Closed

### 16.1 Definisi

Fail-open:

```text
If authorization system fails, allow operation.
```

Fail-closed:

```text
If authorization system fails, deny operation.
```

Untuk operasi sensitif, default harus fail-closed.

### 16.2 Decision Table

| Scenario | Recommended behavior |
|---|---|
| PDP unavailable for approve payment/case/enforcement action | fail closed |
| PIP unavailable for case state | fail closed |
| Policy missing for sensitive action | deny by default |
| Audit unavailable for high-risk action requiring audit obligation | fail closed or queue with durable guarantee |
| UI menu permission API unavailable | fail closed visually or show limited UI |
| Public content personalization unavailable | fail soft, but not for protected content |
| Health endpoint authorization config error | fail closed except explicitly public health |

### 16.3 Common Bad Pattern

```java
try {
    return authorization.can(user, action, resource);
} catch (Exception e) {
    log.warn("Authorization failed, allowing request", e);
    return true;
}
```

Ini sangat berbahaya.

Lebih aman:

```java
try {
    return authorization.can(user, action, resource);
} catch (Exception e) {
    log.error("Authorization failed, denying request", e);
    return false;
}
```

Lebih matang:

```java
AuthorizationDecision decision = authorization.decide(request);

switch (decision.effect()) {
    case ALLOW:
        enforceObligations(decision);
        return;
    case DENY:
    case NOT_APPLICABLE:
    case INDETERMINATE:
        auditDenied(request, decision);
        throw new AccessDeniedException(decision.safeMessage());
    default:
        throw new IllegalStateException("Unknown authorization decision");
}
```

---

## 17. Latency, Availability, and Consistency Trade-Off

Authorization selalu punya trade-off:

```text
Correctness vs latency
Freshness vs availability
Centralization vs autonomy
Expressiveness vs explainability
Policy flexibility vs testability
```

### 17.1 Local PDP Latency

```text
PEP -> in-memory PDP -> DB/cache PIP
```

Cepat, tetapi policy terdistribusi.

### 17.2 Remote PDP Latency

```text
PEP -> network -> PDP -> PIP/data -> PDP -> PEP
```

Lebih fleksibel, tetapi menambah latency dan failure point.

### 17.3 Attribute Fetch Problem

Naive PDP:

```text
For each request:
  fetch user roles
  fetch user org
  fetch case
  fetch delegation
  fetch conflict flags
  fetch policy
```

Ini bisa lambat.

Solusi:

1. cache stable subject attributes,
2. pass already-loaded resource snapshot,
3. bulk load attributes,
4. materialize effective permissions,
5. use request-scoped memoization,
6. precompute read visibility for heavy list pages,
7. use sidecar with local policy cache,
8. split coarse and fine decisions.

### 17.4 Consistency Problem

Contoh:

```text
10:00 user permission revoked
10:01 user's JWT still contains old scope
10:02 local cache still says allowed
10:05 cache expires
```

Pertanyaan:

```text
Is 5-minute stale authorization acceptable?
```

Jawabannya tergantung risiko.

Untuk low-risk menu display mungkin boleh.
Untuk high-risk approval mungkin tidak.

---

## 18. Audit and Explainability in PEP/PDP Architecture

### 18.1 Apa yang Harus Diaudit?

Minimal decision audit:

```text
timestamp
correlationId
subjectId
actorType
action
resourceType
resourceId
tenantId
context summary
decision effect
reasonCode
policyId
policyVersion
PIP attribute versions/sources
obligations
PEP location
```

### 18.2 Allow dan Deny Sama-Sama Penting

Banyak sistem hanya audit mutation allow. Untuk authorization, deny juga penting.

Deny log membantu:

1. detect probing,
2. troubleshoot access issue,
3. prove enforcement,
4. identify policy misconfiguration,
5. detect compromised account.

### 18.3 Safe Explanation

Jangan bocorkan resource existence.

Untuk user:

```text
You do not have access to this resource.
```

Untuk internal audit:

```text
DENY_CROSS_TENANT_ACCESS: subject tenant A attempted to view case tenant B.
```

Untuk support authorized:

```text
User lacks case.view for agency CEA and is not assigned to case 123.
```

Layering explanation:

```text
public message < support message < audit detail < security investigation detail
```

---

## 19. Case Management Example

### 19.1 Domain

Misal regulatory case management:

```text
Case states:
DRAFT -> SUBMITTED -> UNDER_REVIEW -> PENDING_APPROVAL -> APPROVED -> CLOSED

Actors:
Applicant
Case Officer
Supervisor
Agency Admin
Compliance Reviewer
System Job
```

Action:

```text
case.view
case.update
case.submit
case.assign
case.review
case.approve
case.close
case.reopen
case.export
```

### 19.2 Policy

```text
A supervisor can approve a case if:
- user has permission case.approve;
- user belongs to same agency as case;
- case status is PENDING_APPROVAL;
- user is assigned supervisor of case;
- user is not the creator/submitter of the case;
- case is not sealed;
- no conflict-of-interest flag exists;
- request is not made through unsupported channel.
```

### 19.3 Architecture Mapping

```text
PEP:
ApproveCaseService.approve(caseId)

PDP:
CaseAuthorizationPolicy.evaluate(request, subjectAttrs, caseAttrs)

PIP:
- UserProfileProvider
- CaseAttributeProvider
- DelegationProvider
- ConflictFlagProvider

PAP:
- policy class/config in Git
- permission matrix approved by business owner
- release/change management
```

### 19.4 Java Skeleton

```java
public final class ApproveCaseUseCase {
    private final CaseRepository caseRepository;
    private final AuthorizationService authorizationService;
    private final AuditPublisher auditPublisher;

    public void approve(Long caseId) {
        SubjectRef subject = CurrentSubject.get();

        CaseEntity caseEntity = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(NotFoundException::new);

        AuthorizationRequest request = AuthorizationRequest.builder()
            .subject(subject)
            .action(Action.CASE_APPROVE)
            .resource(CaseResource.from(caseEntity))
            .context(CurrentAuthorizationContext.capture())
            .build();

        AuthorizationDecision decision = authorizationService.decide(request);

        if (!decision.isAllowed()) {
            auditPublisher.authorizationDenied(request, decision);
            throw new AccessDeniedException(decision.safeMessage());
        }

        enforceObligations(decision);

        caseEntity.approve(subject.id());
        auditPublisher.authorizationAllowed(request, decision);
    }

    private void enforceObligations(AuthorizationDecision decision) {
        // audit, watermark, masking, step-up, etc.
    }
}
```

### 19.5 Policy Evaluation Skeleton

```java
public final class CaseApprovePolicy implements AuthorizationPolicy {

    @Override
    public AuthorizationDecision evaluate(AuthorizationEvaluation eval) {
        SubjectAttributes subject = eval.subjectAttributes();
        CaseAttributes resource = eval.caseAttributes();

        if (!subject.hasPermission("case.approve")) {
            return AuthorizationDecision.deny("DENY_PERMISSION_MISSING", "CASE_APPROVE_POLICY");
        }

        if (!Objects.equals(subject.tenantId(), resource.tenantId())) {
            return AuthorizationDecision.deny("DENY_CROSS_TENANT_ACCESS", "CASE_APPROVE_POLICY");
        }

        if (!Objects.equals(subject.agencyId(), resource.agencyId())) {
            return AuthorizationDecision.deny("DENY_AGENCY_MISMATCH", "CASE_APPROVE_POLICY");
        }

        if (!"PENDING_APPROVAL".equals(resource.status())) {
            return AuthorizationDecision.deny("DENY_INVALID_CASE_STATE", "CASE_APPROVE_POLICY");
        }

        if (!Objects.equals(subject.userId(), resource.assignedSupervisorId())) {
            return AuthorizationDecision.deny("DENY_NOT_ASSIGNED_SUPERVISOR", "CASE_APPROVE_POLICY");
        }

        if (Objects.equals(subject.userId(), resource.createdBy())) {
            return AuthorizationDecision.deny("DENY_SELF_APPROVAL_NOT_ALLOWED", "CASE_APPROVE_POLICY");
        }

        if (resource.sealed()) {
            return AuthorizationDecision.deny("DENY_CASE_SEALED", "CASE_APPROVE_POLICY");
        }

        return AuthorizationDecision.allow("ALLOW_ASSIGNED_SUPERVISOR", "CASE_APPROVE_POLICY")
            .withObligation(Obligation.auditAccess());
    }
}
```

---

## 20. Avoiding Bypass Paths

### 20.1 Typical Bypass Paths

Authorization sering benar di satu jalur tetapi hilang di jalur lain.

Contoh bypass:

```text
- normal endpoint checks permission, export endpoint does not;
- UI hides button, API still allows;
- service method has check, batch job directly calls repository;
- REST endpoint checks tenant, GraphQL resolver does not;
- application checks view permission, file download controller does not;
- case update endpoint checks status, admin bulk update bypasses state guard;
- internal API trusts upstream too much;
- async listener processes command without verifying actor authority;
- report query bypasses repository predicate;
- cache returns data without tenant-aware key.
```

### 20.2 Bypass Prevention Strategy

Use multiple PEPs intentionally:

```text
1. API layer prevents unauthenticated/coarse unauthorized calls.
2. Service/use-case layer protects business action.
3. Domain layer protects irreversible invariant.
4. Query/repository layer protects data visibility.
5. Audit layer observes allow/deny.
```

Do not rely on only one:

```text
Only UI authorization      = insecure
Only gateway authorization = insufficient
Only controller check      = bypass-prone
Only DB row filter         = insufficient for command authorization
Only token scope           = stale and coarse
```

---

## 21. Authorization for Read vs Write vs Transition

Different operation types require different architecture.

### 21.1 Single Read

```text
GET /cases/123
```

Recommended:

```text
load minimal trusted resource attributes -> PDP decision -> return or deny
```

### 21.2 Search/List

```text
GET /cases?status=OPEN
```

Recommended:

```text
build authorization predicate -> apply in query -> return only visible records
```

### 21.3 Export

```text
GET /cases/export
```

Export is high risk because it amplifies leakage.

Need:

```text
- export permission,
- data visibility predicate,
- field-level masking obligation,
- row count limits,
- audit,
- watermark,
- async job authorization snapshot.
```

### 21.4 Mutation

```text
PUT /cases/123
```

Need:

```text
- action permission,
- object authorization,
- state authorization,
- transaction-current resource,
- TOCTOU protection.
```

### 21.5 State Transition

```text
POST /cases/123/approve
```

Need strongest enforcement:

```text
- permission,
- state guard,
- assignee/role/relationship,
- SoD,
- conflict checks,
- audit,
- transaction lock/version check.
```

---

## 22. TOCTOU in Authorization

TOCTOU = Time Of Check To Time Of Use.

Bad flow:

```text
1. Check user can approve case 123.
2. Another transaction changes case status to CLOSED.
3. Current transaction approves anyway.
```

Fix:

```text
1. Load case for update / optimistic version.
2. Evaluate authorization using transaction-current state.
3. Mutate immediately in same transaction.
4. Commit.
```

Java/Spring example:

```java
@Transactional
public void approve(Long caseId) {
    CaseEntity caseEntity = caseRepository.findByIdForUpdate(caseId)
        .orElseThrow(NotFoundException::new);

    authorization.require(
        CurrentSubject.get(),
        Action.CASE_APPROVE,
        CaseResource.from(caseEntity)
    );

    caseEntity.approve(CurrentSubject.get().id());
}
```

If using optimistic locking:

```java
@Transactional
public void approve(Long caseId, long expectedVersion) {
    CaseEntity caseEntity = caseRepository.findById(caseId)
        .orElseThrow(NotFoundException::new);

    if (caseEntity.version() != expectedVersion) {
        throw new ConcurrentModificationException();
    }

    authorization.require(...);
    caseEntity.approve(...);
}
```

---

## 23. Bulk Authorization

### 23.1 Problem

Naive code:

```java
for (CaseEntity c : cases) {
    if (authorization.can(subject, Action.CASE_VIEW, CaseResource.from(c))) {
        result.add(mapper.toDto(c));
    }
}
```

Problem:

1. N+1 decision.
2. Filter-after-fetch leakage.
3. Pagination wrong.
4. Count wrong.
5. Slow.

### 23.2 Better Pattern

```java
AuthorizationPredicate predicate = authorization.queryPredicate(
    subject,
    Action.CASE_VIEW,
    ResourceType.CASE
);

Page<CaseEntity> page = caseRepository.search(query, predicate, pageable);
```

### 23.3 Bulk Decision API

For operations like bulk approve:

```java
BulkAuthorizationDecision decisions = authorization.decideBulk(
    subject,
    Action.CASE_APPROVE,
    caseResources
);
```

Handling:

```text
- all-or-nothing for atomic action;
- partial success for independent items;
- report per-item denial reason;
- audit each denied/allowed item or grouped safely.
```

---

## 24. Caching Architecture

### 24.1 Cache Positions

```text
PEP cache:
  - risky unless key is precise and invalidation correct

PDP policy cache:
  - usually safe if policy versioned

PIP attribute cache:
  - depends on freshness requirement

Decision cache:
  - high risk; use carefully
```

### 24.2 Cache Key

A decision cache key must include everything that affects decision:

```text
subject id
subject roles/permissions version
tenant id
action
resource type
resource id
resource version/state
context attributes
policy version
delegation version
risk/session factors
```

If key misses resource state, bug:

```text
ALLOW case.approve when status=PENDING_APPROVAL
cached decision reused after status=CLOSED
```

### 24.3 Safer Caching

Safer:

```text
- cache policy document by version;
- cache stable user attributes briefly;
- cache role-permission mapping;
- cache organization hierarchy;
- avoid caching high-risk final decisions;
- use request-scoped memoization.
```

---

## 25. PEP/PDP/PAP/PIP in Microservices

### 25.1 Service-to-Service Authorization

In microservices, subject can be:

```text
- human user,
- service account,
- batch job,
- event processor,
- delegated actor,
- system on behalf of user.
```

Authorization request should preserve actor chain:

```json
{
  "subject": {
    "type": "SERVICE",
    "id": "case-worker"
  },
  "onBehalfOf": {
    "type": "USER",
    "id": "u123"
  },
  "action": "case.close",
  "resource": "case:1001"
}
```

### 25.2 Confused Deputy

Confused deputy terjadi ketika service yang punya privilege tinggi dipakai untuk melakukan sesuatu yang user sebenarnya tidak boleh lakukan.

Example:

```text
User cannot export all cases.
Report service can query all cases.
User calls report service.
Report service exports all cases without checking user authority.
```

Fix:

```text
Downstream service must authorize using original user context or narrowed delegated authority.
```

### 25.3 Downstream Narrowing

Upstream should not pass overly broad authority.

Bad:

```text
Gateway says user authenticated.
All downstream services trust it for all actions.
```

Better:

```text
Gateway validates authentication and coarse scopes.
Each service enforces local object/domain authorization.
Downstream calls include actor context and intended action.
```

---

## 26. Testing PEP/PDP/PAP/PIP

### 26.1 PEP Tests

Test that enforcement exists:

```text
- unauthenticated request denied;
- missing authority denied;
- unauthorized object denied;
- alternate path denied;
- export path denied;
- async path denied;
- internal endpoint denied or protected.
```

### 26.2 PDP Tests

Use decision table:

| User | Resource | Context | Expected |
|---|---|---|---|
| assigned supervisor | pending case | normal | allow |
| creator supervisor | pending case | normal | deny self approval |
| other agency supervisor | pending case | normal | deny agency mismatch |
| assigned supervisor | closed case | normal | deny invalid state |
| assigned supervisor | pending sealed case | normal | deny sealed |
| assigned supervisor | pending case | conflict flag | deny conflict |

### 26.3 PAP Tests

If policy-as-code/config:

```text
- schema validation;
- unknown permission rejected;
- duplicate policy rejected;
- invalid action rejected;
- policy tests pass in CI;
- policy diff generated;
- rollback tested.
```

### 26.4 PIP Tests

```text
- attribute source is authoritative;
- missing attribute causes indeterminate/deny;
- request body attribute ignored;
- stale cache behavior known;
- tenant mismatch detected;
- resource version considered.
```

### 26.5 Integration Tests

```text
Given user A from tenant X
When requesting case from tenant Y
Then API returns 403/404 and no case data is serialized/logged/cached
```

---

## 27. Production Checklist

### 27.1 Architecture Checklist

- [ ] Semua sensitive operation punya PEP.
- [ ] PEP tidak hanya di UI.
- [ ] Object-level authorization ada untuk read/update/delete/transition.
- [ ] List/search/export memakai query-time authorization predicate.
- [ ] PDP menghasilkan structured decision, bukan boolean saja.
- [ ] Policy source jelas.
- [ ] PIP authoritative jelas.
- [ ] Fail-closed untuk high-risk operations.
- [ ] Deny-by-default untuk missing policy.
- [ ] Audit allow/deny tersedia untuk sensitive action.
- [ ] Decision mencatat policy version.
- [ ] Cache key mencakup tenant/action/resource/context/policy version.
- [ ] Async/batch/message path juga authorized.
- [ ] Internal API tidak blindly trusted.
- [ ] Break-glass/impersonation punya audit khusus.

### 27.2 Code Checklist

- [ ] Tidak ada `isAdmin()` tersebar tanpa policy abstraction.
- [ ] Tidak trust role/tenant dari request body.
- [ ] Tidak trust frontend permission.
- [ ] Tidak filter-after-fetch untuk list besar.
- [ ] Tidak catch authorization error lalu allow.
- [ ] Tidak mengembalikan denial reason sensitif ke user biasa.
- [ ] Tidak menggunakan stale resource state untuk mutation.
- [ ] Tidak lupa file/report/export endpoint.
- [ ] Tidak lupa scheduled job dan listener.

### 27.3 Operational Checklist

- [ ] Policy change punya audit.
- [ ] Permission change punya audit.
- [ ] Role assignment punya expiry/review jika privileged.
- [ ] PDP metrics tersedia.
- [ ] PIP latency/error metrics tersedia.
- [ ] Deny spike alert tersedia.
- [ ] Policy deployment rollback tersedia.
- [ ] Emergency revocation tested.
- [ ] Authorization incident runbook tersedia.

---

## 28. Common Mistakes

### Mistake 1 — Menganggap PDP Harus Service Terpisah

Tidak. PDP adalah responsibility. Bisa in-process.

```text
Small/modular monolith: in-process PDP is often better.
Large multi-service platform: sidecar/remote PDP may be better.
```

### Mistake 2 — Gateway Authorization Dianggap Cukup

Gateway tidak tahu business object state.

```text
Gateway can know user has case-api scope.
Gateway usually cannot know whether user can approve case 123 now.
```

### Mistake 3 — Semua Policy Dimasukkan Token

JWT claim bisa stale, besar, dan coarse.

Token bagus untuk evidence awal, bukan seluruh authorization truth.

### Mistake 4 — PDP Mengambil Data Dari Request Body

Request body adalah input user. Jangan jadikan PIP authoritative.

### Mistake 5 — Boolean Decision

Boolean terlalu miskin untuk audit, debug, dan governance.

### Mistake 6 — Filter After Fetch

Berbahaya untuk search/list/report/export.

### Mistake 7 — Fail Open

Authorization failure bukan alasan untuk allow.

### Mistake 8 — Tidak Ada Policy Version

Tanpa policy version, historical decision sulit direkonstruksi.

---

## 29. Top 1% Mental Model

Engineer biasa bertanya:

```text
Where do I put hasRole?
```

Engineer senior bertanya:

```text
What invariant am I protecting?
Where are all execution paths?
What facts are authoritative?
What is the decision model?
What happens if facts are missing?
What happens if policy is stale?
Can I reconstruct the decision later?
Can the decision be bypassed through search/export/batch/message/internal API?
```

Engineer top-level melihat authorization sebagai **distributed decision system with governance and auditability**.

Formula mental:

```text
Authorization correctness =
  complete enforcement coverage
  + correct decision logic
  + trustworthy facts
  + governed policy lifecycle
  + safe failure behavior
  + audit/explainability
  + performance consistency
```

Atau:

```text
PEP without PDP = scattered checks.
PDP without PIP = decisions without facts.
PDP without PAP = unmanaged policy.
PAP without audit = invisible privilege drift.
PIP without trust model = poisoned authorization.
PEP without coverage = bypass.
```

---

## 30. Mini Capstone: Designing Authorization Architecture for Case Approval

### 30.1 Requirements

```text
A supervisor may approve a case only if:
- authenticated subject is active;
- subject has case.approve permission;
- subject belongs to same tenant and agency as case;
- case is in PENDING_APPROVAL;
- subject is assigned supervisor;
- subject did not create or submit the case;
- case is not sealed;
- no active conflict-of-interest exists;
- decision must be audited;
- if authorization subsystem cannot decide, approval must fail closed.
```

### 30.2 Architecture

```text
PEP:
ApproveCaseUseCase.approve()

PDP:
AuthorizationService -> CaseApprovePolicy

PIP:
- SubjectAttributeProvider
- CaseAttributeProvider
- ConflictProvider
- DelegationProvider

PAP:
- Permission matrix in Git/DB
- Policy versioned in code/config
- Changes approved by business/security owner

Decision:
- effect
- reasonCode
- policyId
- policyVersion
- obligations
- evidence
```

### 30.3 Flow

```text
1. Lock/load case.
2. Build canonical authorization request.
3. Resolve subject attributes.
4. Resolve resource attributes from locked entity.
5. Resolve conflict/delegation facts.
6. Evaluate deny constraints.
7. Evaluate allow grant.
8. Return structured decision.
9. Enforce obligations.
10. Mutate case.
11. Audit decision and mutation.
```

### 30.4 Why This Is Strong

Karena desain ini:

1. tidak bergantung pada UI,
2. tidak hanya gateway,
3. tidak hanya token scope,
4. memakai transaction-current case state,
5. melindungi state transition,
6. mencegah self-approval,
7. punya deny-by-default,
8. bisa diaudit,
9. bisa dites sebagai decision table,
10. bisa dimigrasikan ke external PDP jika perlu.

---

## 31. Ringkasan

PEP/PDP/PAP/PIP adalah pattern arsitektur untuk memecah authorization menjadi tanggung jawab yang jelas:

```text
PEP = where enforcement happens.
PDP = where decision is made.
PAP = where policy is managed.
PIP = where facts are obtained.
```

Dalam Java application, ini tidak harus menjadi service terpisah. Yang penting adalah tanggung jawabnya tidak tercampur.

Key takeaways:

1. Authorization bukan hanya role check.
2. PEP harus berada di semua jalur sensitif.
3. PDP harus menghasilkan structured decision.
4. PAP harus punya governance.
5. PIP harus punya trust and freshness model.
6. Gateway authorization tidak cukup untuk object-level authorization.
7. Query/list/export butuh data-level authorization.
8. Fail-closed adalah default untuk high-risk action.
9. Decision harus bisa diaudit dan dijelaskan.
10. Architecture yang benar memungkinkan evolusi dari RBAC sederhana ke ABAC/PBAC/ReBAC/ACL tanpa rewrite total.

---

## 32. Latihan Praktis

### Latihan 1 — Identify PEP

Ambil satu endpoint:

```text
POST /cases/{id}/approve
```

Identifikasi semua PEP yang mungkin:

1. gateway,
2. Spring filter,
3. controller,
4. service,
5. domain aggregate,
6. repository/database,
7. audit obligation.

Tentukan mana yang wajib dan mana yang optional.

### Latihan 2 — Build AuthorizationRequest

Buat model canonical request untuk:

```text
subject: current user
actor type: human
operation: case.approve
resource: case 123
context: tenant, agency, channel, correlation id, request time
```

### Latihan 3 — Decision Table

Buat table untuk `case.approve`:

| Condition | Expected decision |
|---|---|
| user lacks permission | deny |
| user different tenant | deny |
| user same agency but not assigned | deny |
| case already closed | deny |
| user is creator | deny |
| assigned supervisor, pending case | allow |

### Latihan 4 — PIP Trust Model

Untuk setiap attribute berikut, tentukan authoritative source:

```text
user id
user role
tenant id
agency id
case status
assigned supervisor
case creator
conflict flag
request channel
```

### Latihan 5 — Failure Mode

Tentukan behavior jika:

```text
- user profile service timeout;
- case database unavailable;
- conflict service unavailable;
- policy config missing;
- audit sink unavailable;
- PDP sidecar unavailable.
```

---

## 33. Referensi

[^xacml]: OASIS, *eXtensible Access Control Markup Language (XACML) Version 3.0 Core Specification*, yang mendefinisikan model policy evaluation termasuk peran policy decision, policy information, policy administration, dan request context. https://docs.oasis-open.org/xacml/3.0/xacml-3.0-core-spec-os-en.html

[^opa]: Open Policy Agent documentation, mendeskripsikan OPA sebagai general-purpose policy engine untuk unified policy enforcement across the stack. https://openpolicyagent.org/docs

[^spring-authz]: Spring Security Reference, *Authorization Architecture*, menjelaskan `AuthorizationManager` sebagai komponen yang dipanggil oleh request-based, method-based, dan message-based authorization components untuk membuat final access control decisions. https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

[^nist-abac]: NIST SP 800-162, *Guide to Attribute Based Access Control (ABAC) Definition and Considerations*, menjelaskan ABAC sebagai model access control berdasarkan evaluasi atribut subject, object, action, dan environment. https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-162.pdf

[^nist-rbac]: NIST RBAC project page, menjelaskan model RBAC NIST dan standardisasi ANSI/INCITS 359. https://csrc.nist.gov/projects/role-based-access-control

---

## 34. Status Seri

Selesai:

```text
[x] Part 0 — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
[x] Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
```

Belum selesai. Part berikutnya:

```text
[ ] Part 4 — RBAC Done Properly: Role-Based Access Control Beyond ADMIN
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-002.md">⬅️ Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-004.md">Java Authorization Modes and Patterns — Part 4 ➡️</a>
</div>
