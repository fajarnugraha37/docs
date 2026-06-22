# learn-java-authorization-modes-and-patterns-part-023

# Part 23 — Authorization for Microservices and Distributed Systems

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus: authorization ketika aplikasi tidak lagi monolith, tetapi tersebar menjadi API gateway, service mesh, microservice, message consumer, batch worker, scheduled job, dan downstream integration.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas authorization dari berbagai sudut:

- mental model authorization sebagai sistem keputusan,
- vocabulary dan invariant,
- primitive Java platform,
- PEP/PDP/PAP/PIP,
- RBAC, permission, ABAC, PBAC, ReBAC, ACL,
- ownership, tenancy, IDOR/BOLA,
- layered Java application,
- Spring/Jakarta authorization,
- REST/GraphQL/gRPC/messaging,
- query scoping,
- workflow/state-machine authorization,
- delegation, impersonation, break-glass,
- hierarchical organization,
- temporal/risk/contextual authorization.

Part ini masuk ke masalah yang berbeda: **apa yang terjadi ketika satu business action tidak dieksekusi oleh satu aplikasi saja, tetapi oleh banyak service yang saling memanggil?**

Contoh:

```text
User -> SPA -> API Gateway -> Case Service -> Document Service
                                      |-> Workflow Service
                                      |-> Notification Service
                                      |-> Audit Service
                                      |-> Report Service
```

Dalam monolith, authorization bisa terasa seperti satu function call:

```java
authorizationService.authorize(user, Action.APPROVE_CASE, caseResource);
```

Dalam microservices, pertanyaannya berubah:

1. Apakah gateway boleh memutuskan semuanya?
2. Apakah tiap service harus check ulang?
3. Apakah downstream boleh percaya upstream?
4. Bagaimana membawa identity user ke service B/C/D?
5. Bagaimana membedakan authority user, authority service, dan authority delegated action?
6. Bagaimana jika permission user dicabut saat token masih valid?
7. Bagaimana jika PDP pusat down?
8. Bagaimana jika service A authorized, tetapi service B tidak melakukan object-level check?
9. Bagaimana mencegah **confused deputy**?
10. Bagaimana menjaga audit trail end-to-end?

Jawaban top-level-nya:

> Dalam distributed system, authorization tidak boleh dipandang sebagai satu check di satu tempat. Authorization harus menjadi **contract lintas boundary**: siapa pemanggilnya, siapa subject sebenarnya, action apa yang sedang didelegasikan, resource apa yang dilindungi, konteks apa yang dipercaya, policy mana yang berlaku, dan bagaimana decision direkam.

---

## 1. Problem Utama: Authorization Tidak Lagi Punya Satu Boundary

Pada aplikasi single-service, boundary utamanya biasanya HTTP controller/service method.

Pada distributed system, boundary-nya bertambah:

1. browser to gateway,
2. gateway to backend service,
3. service to service,
4. service to database,
5. service to message broker,
6. producer to consumer,
7. job scheduler to worker,
8. worker to external system,
9. service to object storage,
10. report/export subsystem to data source,
11. observability/admin endpoint,
12. operator/support access.

Setiap boundary adalah peluang bypass.

Contoh bug:

```text
Gateway:
  GET /cases/{id}/documents -> checks user has CASE_READ

Document Service:
  GET /documents/by-case/{caseId} -> trusts gateway

Internal caller:
  Report Service -> calls Document Service directly with caseId

Result:
  Report Service accidentally leaks documents from case user should not see.
```

Di sini gateway benar, tetapi sistem tetap bocor karena downstream tidak punya authorization invariant sendiri.

### Prinsip dasar

> Semakin banyak boundary, semakin tidak cukup authorization berbasis endpoint. Setiap service yang memiliki resource sensitif harus mampu menegakkan invariant miliknya sendiri.

---

## 2. Microservice Authorization Mental Model

Dalam microservices, setiap request membawa beberapa identitas sekaligus:

```text
Human user identity      : siapa user asli?
Client application       : aplikasi/channel apa yang digunakan?
Calling service identity : service mana yang memanggil?
Target service identity  : service mana yang menerima?
Delegation context       : action atas nama siapa?
Resource context         : resource apa yang dilindungi?
Tenant context           : tenant/agency/org mana?
Policy context           : versi policy mana?
Request context          : correlation id, time, IP zone, risk, purpose.
```

Jangan menyederhanakan semuanya menjadi `sub` di JWT.

Contoh wrong model:

```json
{
  "sub": "user-123",
  "roles": ["CASE_OFFICER"]
}
```

Untuk distributed authorization, token seperti itu terlalu miskin. Ia tidak menjelaskan:

- service pemanggil,
- audience target,
- action delegated,
- tenant scope,
- purpose,
- original actor,
- impersonation/delegation chain,
- assurance level,
- policy decision yang sudah terjadi,
- apakah downstream boleh menggunakan token itu lagi.

Model yang lebih matang memisahkan:

```text
original subject : user yang memulai request
current actor    : service/human yang sedang bertindak
client           : aplikasi/channel
workload         : service identity
delegation       : apakah service ini bertindak on behalf of user?
audience         : service tujuan token/credential
scope            : batas kewenangan token
context          : tenant, resource, action, purpose, risk
```

---

## 3. Authorization Boundary Types

Distributed system biasanya punya beberapa jenis boundary. Setiap boundary punya enforcement berbeda.

| Boundary | Contoh | Risiko utama | Enforcement minimal |
|---|---|---|---|
| Edge boundary | Internet -> API Gateway | public exposure, unauthenticated access | authentication, coarse authorization, rate limit |
| Service boundary | Service A -> Service B | lateral movement, confused deputy | workload identity, audience check, service-level policy |
| Resource boundary | Service -> DB/S3/Search | data leakage | query scoping, row/object policy, signed access |
| Message boundary | Producer -> Broker -> Consumer | unauthorized command/event injection | producer authz, topic authz, message validation |
| Workflow boundary | Task/event transition | invalid state/action | state guard, actor check, SoD |
| Admin boundary | Operator -> admin API | privilege abuse | PAM/JIT/break-glass, audit, approval |
| Batch boundary | Scheduler -> worker | bypass user-level check | service privilege + purpose-bound policy |
| External boundary | Service -> partner API | data exfiltration | outbound policy, data minimization, purpose audit |

A top 1% engineer tidak bertanya “authorization pakai JWT atau tidak?”, tapi:

> Boundary apa yang sedang dilindungi, siapa yang bisa melewatinya, dan invariant apa yang harus tetap benar meski request datang dari path berbeda?

---

## 4. Centralized vs Decentralized Authorization

### 4.1 Centralized authorization

Centralized authorization berarti keputusan authorization dipusatkan di satu komponen, misalnya:

- API gateway,
- central authz service,
- policy engine/PDP,
- service mesh external authorization,
- shared platform authorization layer.

Kelebihan:

- konsistensi policy,
- mudah audit,
- mudah governance,
- policy bisa diubah tanpa redeploy semua service,
- cocok untuk cross-cutting rules.

Kekurangan:

- latency tambahan,
- availability dependency,
- sulit menangani domain-specific resource state,
- raw policy bisa jauh dari business code,
- bisa menjadi bottleneck organisasi.

### 4.2 Decentralized authorization

Decentralized authorization berarti tiap service menegakkan policy domain-nya sendiri.

Kelebihan:

- dekat dengan domain model,
- bisa menggunakan resource state lokal,
- latency rendah,
- autonomy service tinggi,
- lebih mudah menjaga invariant domain.

Kekurangan:

- risiko inkonsistensi,
- duplikasi logic,
- governance lebih sulit,
- permission naming bisa menyimpang,
- audit tersebar.

### 4.3 Hybrid model

Dalam production enterprise, model paling sehat biasanya hybrid:

```text
Gateway / Mesh:
  - authenticate request
  - validate token
  - enforce coarse-grained route/service policy
  - reject obvious invalid/unauthorized traffic

Service:
  - enforce domain/object/state/tenant authorization
  - validate resource ownership/scope
  - enforce command-specific invariant

Central PDP / Policy Engine:
  - hold cross-service policy
  - evaluate ABAC/PBAC/ReBAC where suitable
  - provide explainable decision

Data layer:
  - enforce query scoping / row/object guard
  - prevent accidental broad read
```

Rule of thumb:

> Edge authorization reduces attack surface. Service-local authorization protects domain invariants. Data-level authorization prevents leakage. Audit stitches decisions together.

---

## 5. Edge Authorization: Useful, But Not Sufficient

API gateway, ingress controller, or service mesh gateway is useful for:

1. rejecting unauthenticated traffic,
2. validating token signature,
3. checking issuer/audience/expiry,
4. enforcing route-level access,
5. applying coarse scopes,
6. request rate limiting,
7. IP/network policy,
8. request normalization,
9. correlation ID injection,
10. coarse tenant routing.

Example gateway policy:

```text
Only users with token scope `case:read` can call GET /api/cases/**
Only internal workload `report-service` can call /internal/reports/**
Only admin channel can call /admin/**
```

Tapi gateway tidak cukup untuk:

```text
Can user-123 view case CASE-987?
Can officer A approve a case submitted by officer A?
Can agency X export records belonging to agency Y?
Can support user impersonate this specific customer now?
Can this workflow transition happen from current state?
```

Kenapa?

Karena gateway biasanya tidak punya full domain state.

### Dangerous assumption

```text
"Gateway already checked, so internal services don't need authorization."
```

Ini lemah karena:

1. internal endpoints bisa dipanggil oleh service lain,
2. gateway policy bisa salah/missing,
3. service bisa expose alternate path,
4. batch/job path bypass gateway,
5. message consumer path tidak melewati gateway,
6. data export/report path punya query sendiri,
7. service mesh misconfiguration bisa terjadi,
8. compromised service bisa bergerak lateral.

Correct assumption:

> Gateway performs admission control. Owning service still enforces business authorization.

---

## 6. Service-Local Authorization

Service-local authorization berarti service yang memiliki resource/domain melakukan check sendiri.

Contoh:

```java
public CaseDetails getCase(CaseId caseId, CallerContext caller) {
    CaseRecord record = caseRepository.findById(caseId)
            .orElseThrow(NotFoundException::new);

    AuthorizationDecision decision = authorizationService.decide(
            caller,
            Action.CASE_VIEW,
            ResourceRef.caseRef(record.id(), record.tenantId(), record.ownerOrgId()),
            AuthorizationContext.from(record)
    );

    if (decision.denied()) {
        auditAuthorizationDenied(decision);
        throw new AccessDeniedException(decision.safeReasonCode());
    }

    return mapper.toDetails(record);
}
```

Kekuatan pola ini:

1. service menggunakan state aktual,
2. check dekat dengan operation,
3. object-level authorization tidak bergantung pada gateway,
4. policy bisa mengandung rule domain,
5. audit lebih bermakna.

Kelemahan:

1. logic bisa tersebar,
2. perlu discipline architecture,
3. shared vocabulary wajib,
4. perlu test matrix,
5. perlu cache/optimization untuk bulk/list.

### Invariant

> Service yang memiliki resource tidak boleh mengembalikan resource sensitif hanya karena caller berasal dari jaringan internal.

---

## 7. Shared Authorization Library: Kapan Berguna, Kapan Berbahaya

Banyak organisasi membuat shared library:

```text
common-authz.jar
```

Kegunaan:

- standard `CallerContext`,
- standard `Action`, `ResourceRef`, `Decision`,
- token parsing,
- tenant context propagation,
- helper untuk Spring Security,
- audit event schema,
- policy client,
- exception mapping,
- test utilities.

Contoh isi yang sehat:

```text
com.company.authz.core
  CallerContext
  SubjectRef
  WorkloadRef
  ResourceRef
  Action
  AuthorizationDecision
  DecisionReason
  AuthorizationClient
  AuthorizationException
  AuditEnvelope
```

Yang berbahaya:

```java
public static boolean isAdmin() { ... }
public static boolean canApproveCase() { ... }
public static boolean isAgencyUser() { ... }
```

Jika shared library berisi business policy semua domain, ia akan menjadi mini-monolith.

### Rule

Shared library sebaiknya berisi:

- vocabulary,
- protocol,
- client,
- utility teknis,
- test support,
- audit schema.

Bukan:

- semua business policy,
- semua role mapping,
- semua resource rule,
- semua workflow guard.

Business policy domain tetap milik bounded context masing-masing, kecuali policy memang cross-cutting.

---

## 8. Remote PDP

Remote PDP adalah service pusat yang menjawab authorization decision.

Flow:

```text
Service -> PDP: Can subject S perform action A on resource R with context C?
PDP -> Service: PERMIT / DENY / ERROR + reason + obligations
```

Contoh request:

```json
{
  "subject": {
    "type": "human_user",
    "id": "user-123",
    "roles": ["CASE_OFFICER"],
    "agencyId": "AGENCY-A"
  },
  "actor": {
    "type": "workload",
    "id": "case-service"
  },
  "action": "case.approve",
  "resource": {
    "type": "case",
    "id": "CASE-987",
    "tenantId": "TENANT-1",
    "agencyId": "AGENCY-A",
    "state": "PENDING_REVIEW",
    "submittedBy": "user-456"
  },
  "context": {
    "channel": "intranet",
    "time": "2026-06-19T10:15:30+07:00",
    "correlationId": "corr-abc",
    "purpose": "case-review"
  }
}
```

Contoh response:

```json
{
  "decision": "PERMIT",
  "reasonCode": "CASE_APPROVAL_ALLOWED",
  "policyVersion": "case-policy@2026-06-01",
  "obligations": [
    { "type": "AUDIT", "level": "ALLOW" },
    { "type": "MASK_FIELDS", "fields": ["internalRiskScore"] }
  ]
}
```

### Kapan remote PDP cocok?

Cocok jika:

1. banyak service memakai policy sama,
2. policy sering berubah,
3. butuh centralized governance,
4. butuh explainable decision,
5. butuh simulation/dry-run,
6. ada ABAC/PBAC kompleks,
7. policy perlu direview non-developer/security team,
8. compliance butuh policy version trace.

Tidak cocok jika:

1. decision sangat latency-sensitive,
2. policy sangat domain-local dan sederhana,
3. resource state besar/sulit dikirim,
4. PDP availability belum siap,
5. team belum punya policy testing discipline,
6. semua perubahan policy tetap butuh code deploy service.

### Java client pattern

```java
public interface AuthorizationClient {
    AuthorizationDecision decide(AuthorizationRequest request);
}
```

```java
public final class FailClosedAuthorizationClient implements AuthorizationClient {
    private final AuthorizationClient delegate;

    public FailClosedAuthorizationClient(AuthorizationClient delegate) {
        this.delegate = delegate;
    }

    @Override
    public AuthorizationDecision decide(AuthorizationRequest request) {
        try {
            AuthorizationDecision decision = delegate.decide(request);
            if (decision == null) {
                return AuthorizationDecision.errorDeny("PDP_NULL_DECISION");
            }
            return decision;
        } catch (RuntimeException ex) {
            return AuthorizationDecision.errorDeny("PDP_UNAVAILABLE");
        }
    }
}
```

Untuk Java 8, gunakan class immutable biasa. Untuk Java 17+, `record` bisa membuat request/decision lebih ringkas. Untuk Java 21/25, virtual threads bisa membantu blocking PDP calls pada throughput tinggi, tetapi tidak menghapus kebutuhan timeout, bulk decision, dan circuit breaker.

---

## 9. Sidecar PDP

Sidecar PDP berarti PDP berjalan di dekat service, misalnya:

```text
Pod:
  app container
  opa container
```

Atau via Envoy external authorization.

Keuntungan:

1. latency lebih rendah dibanding remote central PDP,
2. availability lebih baik jika policy bundle lokal,
3. policy bisa diupdate via bundle distribution,
4. service tidak perlu embed policy engine,
5. cocok dengan service mesh.

Kekurangan:

1. operasional lebih kompleks,
2. policy/data sync harus benar,
3. observability tersebar,
4. debugging decision butuh tooling,
5. sidecar resource overhead,
6. consistency policy antar pod perlu dikelola.

### Flow sidecar

```text
Service -> localhost PDP sidecar -> evaluate local policy/data -> decision
```

Atau:

```text
Inbound request -> Envoy -> ext_authz -> OPA sidecar -> permit/deny -> app
```

### Kapan cocok?

- Kubernetes/service mesh environment,
- policy cross-cutting cukup banyak,
- latency remote PDP tidak acceptable,
- policy bisa didistribusikan sebagai bundle,
- team platform siap mengelola sidecar lifecycle.

### Caveat penting

Sidecar cocok untuk request/resource context yang tersedia di request. Untuk domain-specific object authorization, sidecar sering butuh data resource. Jika harus memanggil DB/service lain untuk setiap decision, complexity naik drastis.

---

## 10. Token-Carried Authority

Token-carried authority berarti sebagian authority dibawa di access token/JWT.

Contoh:

```json
{
  "sub": "user-123",
  "aud": "case-api",
  "scope": "case.read case.update",
  "roles": ["CASE_OFFICER"],
  "agency_id": "AGENCY-A",
  "tenant_id": "TENANT-1",
  "exp": 1781840000
}
```

Keuntungan:

1. stateless validation,
2. latency rendah,
3. cocok untuk coarse authorization,
4. bagus untuk gateway/resource server,
5. mengurangi lookup ke entitlement service.

Risiko:

1. stale permission sampai token expire,
2. token bloat,
3. claims over-trusted,
4. sulit revoke segera,
5. permission terlalu kasar,
6. object-level authorization tetap perlu lookup,
7. audience confusion,
8. token replay ke service yang salah.

### Rule

> Token should carry evidence, not replace policy.

Claims di token bisa menjadi input authorization, tetapi jangan menganggap token berisi seluruh policy.

Contoh salah:

```java
if (jwt.getClaimAsStringList("roles").contains("CASE_OFFICER")) {
    return caseRepository.findById(caseId); // dangerous
}
```

Contoh lebih benar:

```java
CallerContext caller = callerContextFactory.fromJwt(jwt);
CaseRecord record = caseRepository.findByIdScoped(caseId, caller.tenantId())
        .orElseThrow(NotFoundException::new);

authorizationService.authorize(caller, Action.CASE_VIEW, record.toResourceRef(), record.toAuthzContext());

return mapper.toDto(record);
```

### Claim freshness

Token claim seperti `roles` dan `agency_id` bisa berubah.

Mitigasi:

1. short-lived access token,
2. refresh token rotation,
3. entitlement version claim,
4. server-side revocation list untuk high-risk users,
5. introspection untuk critical action,
6. step-up/re-auth untuk sensitive operation,
7. PDP lookup untuk object/state-sensitive action.

---

## 11. Server-Side Entitlement Lookup

Alternatif token-carried authority adalah service melakukan lookup entitlement dari server-side source.

Contoh:

```text
Case Service -> Entitlement Service -> effective permissions user-123 for tenant-1
```

Keuntungan:

1. permission lebih fresh,
2. token tidak bloat,
3. revocation lebih cepat,
4. policy data tidak tersebar di token,
5. cocok untuk complex org hierarchy.

Kekurangan:

1. latency tambahan,
2. dependency runtime,
3. perlu cache,
4. perlu failure strategy,
5. entitlement service bisa bottleneck.

### Hybrid recommended

Gunakan token untuk:

- identity,
- issuer,
- audience,
- authentication assurance,
- coarse scope,
- tenant hint,
- client/channel,
- correlation evidence.

Gunakan server-side lookup/PDP untuk:

- effective permission,
- role hierarchy,
- object relationship,
- workflow state,
- delegation,
- high-risk action,
- break-glass,
- support impersonation.

---

## 12. Propagating Identity Across Services

Ada beberapa pola propagasi identity.

### 12.1 Forward original user token

```text
Gateway -> Service A -> Service B
          Authorization: Bearer original-user-token
```

Kelebihan:

- simple,
- downstream tahu user asli,
- audit mudah.

Risiko:

- token audience mungkin salah,
- Service A bisa menyalahgunakan token untuk call lain,
- scope terlalu luas,
- confused deputy,
- token exposure lebih besar,
- sulit membedakan direct user action vs service action.

Gunakan hanya jika:

- audience token valid untuk downstream,
- token scope sudah narrow,
- service-to-service channel aman,
- downstream melakukan policy sendiri,
- audit bisa membedakan caller service.

### 12.2 Token exchange / on-behalf-of

```text
Service A receives user token
Service A exchanges it for token scoped to Service B
Service A calls Service B with new token
```

Kelebihan:

- audience benar,
- scope bisa dipersempit,
- delegation chain jelas,
- downstream tidak menerima token asli terlalu luas,
- audit lebih kuat.

Kekurangan:

- butuh authorization server/token service,
- latency tambahan,
- integration lebih kompleks.

Ini model yang lebih sehat untuk enterprise.

### 12.3 Internal signed context header

Service A meneruskan context:

```http
X-Original-Subject: user-123
X-Original-Tenant: tenant-1
X-Caller-Service: case-service
X-Delegated-Action: case.approve
X-Correlation-Id: corr-123
X-Context-Signature: ...
```

Ini berbahaya jika tidak disign/ditrust boundary secara ketat.

Jangan pernah menerima header seperti ini dari public internet.

Jika digunakan:

1. strip semua incoming internal headers di gateway,
2. inject ulang oleh trusted component,
3. sign atau bind ke mTLS identity,
4. validate caller service,
5. audit original subject dan caller service,
6. jangan jadikan header sebagai sole authorization proof.

### 12.4 Workload identity only

```text
Service A calls Service B as workload `service-a`
```

Cocok untuk:

- scheduled job,
- system maintenance,
- event processor,
- backend integration.

Tetapi jika action berasal dari user, workload identity saja tidak cukup untuk audit dan least privilege.

---

## 13. Workload Identity and Service-to-Service Authorization

Dalam microservices, service juga merupakan actor.

Contoh workload identities:

```text
case-service
workflow-service
document-service
report-service
notification-service
batch-archival-worker
```

Service-to-service authorization menjawab:

```text
Can workload A call endpoint/action B on workload C?
```

Ini berbeda dari user authorization:

```text
Can user U approve case C?
```

Keduanya harus dipenuhi jika service bertindak atas nama user:

```text
Permit only if:
  workload case-service may call workflow-service.transition
AND
  original user may perform case.approve on CASE-123
AND
  request delegation context is valid
```

### Java representation

```java
public final class CallerContext {
    private final SubjectRef originalSubject;
    private final WorkloadRef callingWorkload;
    private final ClientRef client;
    private final TenantRef tenant;
    private final DelegationContext delegation;
    private final String correlationId;

    // constructors/getters omitted
}
```

### Service policy example

```text
document-service policy:
  - case-service may read documents by case id for purpose CASE_VIEW
  - report-service may read documents only through export-authorized API
  - notification-service may not read document contents, only metadata
  - public gateway may not call internal document endpoints
```

### Important invariant

> A service account should not automatically inherit all user permissions, and a user token should not automatically grant all service capabilities.

---

## 14. Confused Deputy Problem

Confused deputy terjadi ketika service yang punya privilege digunakan oleh caller yang tidak berhak untuk melakukan sesuatu.

Contoh:

```text
User cannot access Document D.
But user can call Report Service.
Report Service has broad access to Document Service.
Report Service generates report including Document D.
```

Report Service menjadi deputy yang “confused”. Ia punya privilege, tetapi tidak memastikan bahwa privilege itu digunakan untuk caller/purpose yang valid.

### Pattern penyebab

```java
// Report Service
public Report generateReport(UserId userId, CaseId caseId) {
    // checks only that user can generate report
    authorizationService.authorize(userId, REPORT_GENERATE);

    // Document Service trusts report-service workload
    List<Document> docs = documentClient.getDocumentsByCase(caseId);

    return reportRenderer.render(docs);
}
```

Bug:

- `REPORT_GENERATE` tidak sama dengan `CASE_DOCUMENT_READ`,
- Document Service hanya check workload, bukan delegated user/purpose,
- Report Service tidak membatasi resource set.

### Mitigation

1. downstream checks delegated subject,
2. use audience-bound narrow token,
3. include purpose/action in delegation context,
4. downstream enforces purpose-bound access,
5. avoid broad service account privileges,
6. report/export path uses same data authorization predicates,
7. audit original subject + calling workload + purpose.

Corrected flow:

```text
User -> Report Service:
  request export case CASE-123

Report Service:
  authorize user for report.generate
  authorize user for case.view/export scope
  call Document Service with on-behalf-of token:
    originalSubject=user
    callingWorkload=report-service
    purpose=case-report-export
    resourceScope=CASE-123

Document Service:
  authorize workload report-service for document.read-for-report
  authorize originalSubject for document.view in CASE-123
  enforce resourceScope CASE-123
```

### Top 1% insight

> In distributed systems, service privilege must be constrained by user privilege, purpose, and resource scope. Otherwise every privileged service becomes a privilege-escalation surface.

---

## 15. Downstream Narrowing

Downstream narrowing berarti setiap call ke service berikutnya membawa authority yang sama atau lebih sempit, tidak lebih luas.

Bad:

```text
User has permission: case.view CASE-123
Service A calls Service B with service-admin token that can read all cases
```

Good:

```text
User has permission: case.view CASE-123
Service A calls Service B with delegated context limited to:
  action=document.read
  resourceScope=case:CASE-123
  purpose=case-view
  expires in short time
```

### Narrowing dimensions

1. audience,
2. action,
3. resource type,
4. resource id/scope,
5. tenant,
6. purpose,
7. time window,
8. caller workload,
9. original subject,
10. allowed downstream chain.

### Java model

```java
public final class DelegatedAuthority {
    private final SubjectRef originalSubject;
    private final WorkloadRef delegatedTo;
    private final Set<Action> allowedActions;
    private final Set<ResourceScope> resourceScopes;
    private final Purpose purpose;
    private final Instant expiresAt;

    public boolean covers(Action action, ResourceRef resource, Purpose requestedPurpose, Instant now) {
        return now.isBefore(expiresAt)
                && allowedActions.contains(action)
                && resourceScopes.stream().anyMatch(scope -> scope.includes(resource))
                && purpose.equals(requestedPurpose);
    }
}
```

---

## 16. Service Account Authorization

Service accounts are needed. But service accounts are dangerous when overly broad.

Common anti-pattern:

```text
All internal services use token: internal-admin
```

This destroys accountability.

Better model:

```text
case-service account:
  may call workflow.transition for case lifecycle
  may call audit.append
  may call notification.send-case-event
  may not read payment reports

report-service account:
  may call case.search-authorized-for-report
  may call document.read-for-export with delegated context
  may call audit.append
  may not update case state
```

### Service account permission design

Permission should be workload-specific and purpose-specific:

```text
service.case.workflow.transition
service.case.audit.append
service.report.document.read-for-export
service.notification.template.render
```

Avoid:

```text
service.internal.all
system.admin
backend.full-access
```

### Runtime check

```java
public void assertWorkloadAllowed(CallerContext caller, ServiceAction action) {
    if (!servicePolicy.isAllowed(caller.callingWorkload(), action)) {
        throw new AccessDeniedException("WORKLOAD_NOT_ALLOWED");
    }
}
```

For user-originated operations:

```java
assertWorkloadAllowed(caller, ServiceAction.DOCUMENT_READ_FOR_CASE_VIEW);
assertDelegatedUserAllowed(caller, Action.DOCUMENT_VIEW, documentRef);
```

---

## 17. Authorization and Event-Driven Systems

Distributed authorization is not only synchronous request/response.

Events create special problems:

1. producer authorization,
2. topic authorization,
3. consumer authorization,
4. message-level authorization,
5. replay authorization,
6. stale event authorization,
7. command/event confusion,
8. downstream side effect authorization.

### Event vs command

Event:

```text
CaseApproved
```

Means something already happened.

Command:

```text
ApproveCase
```

Requests something to happen.

Authorization must be stricter for command consumers:

```text
Consumer must verify caller/source is allowed to command this action.
```

For events, consumer must verify:

```text
Is this event from trusted producer?
Is event schema valid?
Is event resource within consumer's allowed domain?
Is replay allowed?
Should side effect be performed for this tenant/context?
```

### Bad command consumer

```java
@KafkaListener(topics = "case-commands")
public void handle(ApproveCaseCommand command) {
    caseService.approve(command.caseId(), command.apverId());
}
```

Missing:

- producer authorization,
- command signer/source,
- original subject,
- state guard,
- maker-checker,
- tenant scope,
- idempotency,
- audit.

Better:

```java
@KafkaListener(topics = "case-commands")
public void handle(ApproveCaseCommand command) {
    MessageTrust trust = messageTrustVerifier.verify(command.envelope());
    CallerContext caller = callerContextFactory.fromCommand(command, trust);

    CaseRecord record = caseRepository.findByIdScoped(command.caseId(), caller.tenantId())
            .orElseThrow(NotFoundException::new);

    authorizationService.authorize(caller, Action.CASE_APPROVE, record.toResourceRef(), record.toAuthzContext());
    stateMachine.guardTransition(record, CaseTransition.APPROVE, caller);

    caseService.approveAuthorized(record, caller, command.idempotencyKey());
}
```

### Event replay

Replay can bypass time-sensitive authorization if not controlled.

Example:

```text
User had permission on Monday.
Event is replayed on Friday after permission revoked.
Consumer performs side effect again.
```

Need distinction:

- event represents historical fact,
- command requests current action.

For replay:

1. do not re-authorize historical fact as if new user action,
2. verify event came from trusted historical log,
3. make side effects idempotent,
4. restrict replay operators,
5. audit replay separately,
6. avoid sending sensitive data to unauthorized consumers.

---

## 18. Authorization Context Propagation

Distributed authorization requires context propagation.

Context to propagate:

```text
correlationId
traceId
originalSubject
callingWorkload
clientId/channel
tenantId
purpose
delegatedAction
resourceScope
assuranceLevel
policyDecisionId
policyVersion if already decided
impersonation/delegation chain
```

But do not propagate blindly.

### Trust levels

| Context field | Can client provide? | Trusted source |
|---|---:|---|
| correlationId | maybe | gateway normalizes |
| subject id | no | verified token/session |
| tenant id | maybe as hint | resolved server-side |
| roles | no | token issuer/entitlement source |
| purpose | maybe | server validates against operation |
| workload id | no | mTLS/service identity/token |
| delegated action | no | service-generated/token-exchange |
| resource scope | no | service/PDP generated |

### Propagation anti-pattern

```http
X-User-Id: user-123
X-Roles: ADMIN
X-Tenant-Id: tenant-1
```

If service trusts these from any caller, authorization is broken.

### Safer pattern

```text
Gateway:
  strip incoming internal headers
  validate external token
  create trusted caller context
  sign internal context or exchange token

Service:
  validate internal context provenance
  validate workload identity
  do domain authorization
```

---

## 19. Audience and Trust Boundary

JWT/resource token must have correct audience.

Bad:

```text
Token issued for frontend-api is accepted by payment-service.
```

Good:

```text
case-api accepts aud=case-api
workflow-api accepts aud=workflow-api
report-api accepts aud=report-api
```

### Why audience matters

Without audience validation, a token intended for one service can be replayed to another service.

This creates:

- token confusion,
- lateral movement,
- privilege escalation,
- unintended data access.

### Spring Security Resource Server note

In Spring Security resource server, JWT validation can verify issuer and signature; application should also ensure audience/claim mapping fits the resource server’s own trust boundary.

Example custom validator concept:

```java
public final class AudienceValidator implements OAuth2TokenValidator<Jwt> {
    private final String requiredAudience;

    public AudienceValidator(String requiredAudience) {
        this.requiredAudience = requiredAudience;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        if (jwt.getAudience().contains(requiredAudience)) {
            return OAuth2TokenValidatorResult.success();
        }
        return OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "Missing required audience", null)
        );
    }
}
```

Then combine it with issuer/expiry validators.

### Principle

> A token valid somewhere is not a token valid everywhere.

---

## 20. Permission Revocation Delay

Distributed authorization has revocation latency.

User permission may be revoked at `10:00`, but:

- access token valid until `10:15`,
- entitlement cache valid until `10:10`,
- PDP sidecar data updated at `10:05`,
- service decision cache valid until `10:03`,
- async job already queued,
- event already emitted.

### Revocation-sensitive actions

Some actions tolerate delay:

```text
view non-sensitive dashboard
read public-ish metadata
receive generic notification
```

Some do not:

```text
approve case
export report
download sensitive documents
change bank/payment info
break-glass
impersonate user
modify role assignment
```

### Mitigation matrix

| Action sensitivity | Strategy |
|---|---|
| low | short token TTL + normal cache |
| medium | entitlement version + short decision cache |
| high | real-time PDP/introspection + no positive decision cache |
| critical | step-up + server-side check + approval + audit |

### Entitlement version pattern

Token contains:

```json
{
  "sub": "user-123",
  "entitlement_version": 42
}
```

Service/PDP compares with current version:

```text
if token.entitlement_version < current_user_entitlement_version:
    deny or force refresh
```

This avoids checking every permission for every request while still detecting stale grants.

### Cache invalidation

Events:

```text
UserRoleChanged
UserSuspended
DelegationRevoked
TenantMembershipChanged
PolicyUpdated
BreakGlassExpired
```

Services/PDP/sidecars listen and invalidate:

```text
subject entitlement cache
role hierarchy cache
relationship cache
decision cache
policy cache
resource visibility cache
```

Do not pretend cache invalidation is perfect. Design high-risk paths to re-check.

---

## 21. Distributed Decision Caching

Caching authorization decision is dangerous unless key is complete.

Bad key:

```text
user-123:case.view
```

Missing:

- resource id,
- tenant,
- action variant,
- context,
- purpose,
- channel,
- policy version,
- resource state,
- delegation,
- assurance level.

Better key:

```text
subject=user-123
workload=case-service
tenant=tenant-1
action=case.view
resourceType=case
resourceId=CASE-123
resourceVersion=17
purpose=case-management
channel=intranet
assurance=aal2
policyVersion=case-policy@2026-06-01
delegationId=none
```

### What can be cached?

Cacheable:

- role hierarchy expansion,
- effective permissions for low-risk actions,
- static service-to-service policy,
- public route policy,
- policy bundle,
- resource metadata if versioned,
- negative decisions for short TTL if safe.

Not safely cacheable without care:

- break-glass state,
- delegation active status,
- suspension status,
- object state transition eligibility,
- maker-checker condition,
- sensitive export/download decision,
- high-risk contextual decision.

### Decision cache rule

> Cache inputs and intermediate facts more often than final allow decision.

Why?

Final allow decision is context-sensitive. Intermediate facts like role hierarchy or organization membership can be versioned and invalidated more predictably.

---

## 22. Fail-Open vs Fail-Closed in Distributed Authorization

When PDP/cache/entitlement service is unavailable, what happens?

Options:

```text
Fail-open  : allow request if authz infrastructure unavailable
Fail-closed: deny request if authz infrastructure unavailable
Fail-soft  : allow only low-risk cached/previously known-safe operations
```

Top-level default:

> For security-sensitive operations, fail closed. For availability-sensitive low-risk reads, fail soft only if explicitly designed and audited.

### Decision table

| Scenario | Read public metadata | View sensitive case | Approve case | Export report | Admin role change |
|---|---:|---:|---:|---:|---:|
| PDP down | cached allow possible | deny or cached short allow if accepted risk | deny | deny | deny |
| Entitlement cache stale | allow if low risk | re-check or deny | deny | deny | deny |
| Policy bundle missing | deny | deny | deny | deny | deny |
| Audit sink down | maybe allow with local spool | local durable spool or deny by policy | usually deny if no audit | deny | deny |
| Attribute source down | degrade if attribute optional | deny if required | deny | deny | deny |

### Java pattern: explicit failure semantics

Do not throw random runtime exceptions and accidentally map them to 500 while some caller retries causing side effects.

Use explicit decision:

```java
public enum DecisionEffect {
    PERMIT,
    DENY,
    INDETERMINATE
}
```

```java
public final class AuthorizationDecision {
    private final DecisionEffect effect;
    private final String reasonCode;
    private final boolean safeToRetry;
    private final boolean auditRequired;

    public boolean isPermit() {
        return effect == DecisionEffect.PERMIT;
    }

    public boolean isDenyLike() {
        return effect == DecisionEffect.DENY || effect == DecisionEffect.INDETERMINATE;
    }
}
```

For enforcement:

```java
AuthorizationDecision decision = authorizationClient.decide(request);

if (!decision.isPermit()) {
    audit(decision);
    throw new AccessDeniedException(decision.reasonCode());
}
```

`INDETERMINATE` should usually behave like deny at PEP.

---

## 23. Circuit Breakers, Timeouts, and Bulk Decisions

Remote authorization call must be engineered as production dependency.

### Timeout

Never call PDP without timeout.

```java
HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofMillis(300))
        .POST(bodyPublisher)
        .build();
```

For Java 8 with Apache/OkHttp/RestTemplate, configure:

- connect timeout,
- read timeout,
- connection pool,
- max connections,
- retry policy.

### Retry

Be careful retrying authorization decision.

Safe retry:

- network timeout before decision processed,
- idempotent decision endpoint,
- same request id.

Dangerous retry:

- PDP writes audit/side effects multiple times,
- request context time changes,
- policy changes between retries,
- fallback accidentally allows.

Decision endpoint should be idempotent and side-effect minimal. Audit can be written by PEP after enforcement, or PDP can log decision with idempotency key.

### Circuit breaker

If PDP is degraded:

- open circuit,
- fail closed for high-risk operations,
- serve safe cached policy for low-risk where acceptable,
- emit alert,
- expose degraded mode metrics.

### Bulk authorization

List views create N+1 decisions:

```text
GET /cases -> 100 cases -> 100 authz calls
```

Better:

1. query scoping predicate,
2. bulk decision API,
3. materialized access view,
4. precomputed relationships,
5. service-local policy.

Bulk API:

```java
Map<ResourceRef, AuthorizationDecision> decisions = authorizationClient.bulkDecide(
        caller,
        Action.CASE_VIEW,
        resources,
        context
);
```

But for list/search, query-level authorization is usually better than fetch-then-filter.

---

## 24. Authorization in Service Mesh

Service mesh can enforce:

1. mTLS between workloads,
2. workload identity,
3. service-to-service allow/deny,
4. namespace-level policy,
5. JWT validation at proxy,
6. external authorization filter,
7. L4/L7 policy,
8. telemetry.

Examples of mesh-level policy:

```text
Only gateway may call public-api service.
Only case-service may call workflow-service transition endpoint.
Only report-service may call report-db-proxy.
Deny all cross-namespace traffic unless explicitly allowed.
```

This is powerful for coarse-grained service authorization.

But mesh cannot fully replace app authorization because:

- mesh does not know domain object state,
- mesh usually cannot evaluate complex business rule cheaply,
- mesh may see path/method but not loaded aggregate,
- message/batch paths may need app-level rules,
- report/query/export needs data-level scoping.

### Proper layering

```text
Mesh:
  workload identity + service-to-service permission
Gateway:
  external token validation + route policy
Application:
  domain/object/workflow authorization
Data layer:
  query scoping + row/object guard
Audit:
  decision evidence end-to-end
```

---

## 25. Authorization for Internal APIs

Internal API is not automatically trusted.

Anti-pattern:

```java
@GetMapping("/internal/cases/{id}")
public CaseRecord internalGet(@PathVariable String id) {
    return caseRepository.findById(id).orElseThrow();
}
```

Why dangerous:

1. SSRF/lateral movement,
2. compromised service,
3. misconfigured ingress,
4. accidental exposure,
5. test endpoint promoted to production,
6. internal consumer bypasses domain rules.

Better:

```java
@GetMapping("/internal/cases/{id}")
public CaseRecord internalGet(@PathVariable String id, CallerContext caller) {
    serviceAuthz.assertWorkloadAllowed(caller, ServiceAction.CASE_INTERNAL_READ);

    CaseRecord record = caseRepository.findByIdScoped(id, caller.tenantId())
            .orElseThrow(NotFoundException::new);

    if (caller.hasOriginalSubject()) {
        authorizationService.authorize(caller, Action.CASE_VIEW, record.toResourceRef(), record.toAuthzContext());
    } else {
        authorizationService.authorizeSystemPurpose(caller, SystemPurpose.INTERNAL_SYNC, record);
    }

    return record;
}
```

Internal API should still require:

- workload identity,
- purpose,
- tenant/resource scope,
- allowed caller list,
- audit,
- rate limit if sensitive,
- no broad wildcard access.

---

## 26. Asynchronous Jobs and Scheduled Workers

Scheduled jobs often bypass user context.

Examples:

```text
nightly archival
SLA escalation
case auto-close
reminder notification
report generation
sync with external registry
index rebuild
```

Questions:

1. Is job acting as system or on behalf of user?
2. What resource scope can it process?
3. What tenant scope?
4. What operation permission?
5. What policy applies during replay/retry?
6. How is it audited?
7. Can operator trigger it manually?
8. Does manual trigger require extra authorization?

### System action model

```java
public final class SystemActor {
    private final String workloadId;
    private final SystemPurpose purpose;
    private final TenantScope tenantScope;
    private final String jobRunId;
}
```

Example authorization:

```text
batch-archival-worker may archive closed cases older than retention threshold
within tenant scope assigned to job run
only if legal hold is false
only if policy version is current
```

Do not give batch jobs unrestricted DB access unless absolutely necessary and compensated by:

- DB role restrictions,
- row predicates,
- dry-run mode,
- approval for destructive actions,
- audit logs,
- idempotency,
- kill switch.

---

## 27. Distributed Audit Trail

Distributed authorization audit must connect decisions across services.

Minimum fields:

```text
decisionId
correlationId
traceId
serviceName
workloadIdentity
originalSubject
currentActor
delegationId / impersonationId
tenantId
action
resourceType
resourceId or safe hash
resourceScope
context snapshot
policyVersion
decision effect
reasonCode
obligations
latencyMs
failureMode
```

### End-to-end audit example

```text
Decision 1: gateway permits user token for route /cases/CASE-123/approve
Decision 2: case-service permits user to approve CASE-123
Decision 3: workflow-service permits transition PENDING_REVIEW -> APPROVED
Decision 4: document-service permits read of attached evidence for approval context
Decision 5: audit-service appends immutable audit event
Decision 6: notification-service sends allowed notification without sensitive payload
```

If incident occurs, you need reconstruct:

1. who initiated,
2. what service acted,
3. what was authorized,
4. which resource was affected,
5. which policy allowed/denied,
6. what context was used,
7. whether delegation/impersonation existed,
8. whether any service failed open,
9. what data was exposed or mutated.

### Avoid

```text
"Access granted by admin role"
```

Too weak.

Better:

```text
PERMIT CASE_APPROVE because:
  subject user-123 has scoped role CASE_REVIEWER in agency AGENCY-A,
  case CASE-987 belongs to AGENCY-A,
  state=PENDING_REVIEW,
  submittedBy=user-456,
  subject != submittedBy,
  channel=intranet,
  policy=case-workflow-policy@2026-06-01
```

---

## 28. Observability for Distributed Authorization

Metrics:

```text
authz_decision_total{effect, action, service, reason}
authz_decision_latency_ms{service, pdp}
authz_pdp_timeout_total{service}
authz_cache_hit_ratio{cache_type}
authz_fail_closed_total{service, action}
authz_fail_open_total{service, action}  // should be rare and explicit
authz_policy_version{service}
authz_denied_total{reason}
authz_indeterminate_total{reason}
authz_delegation_used_total{type}
authz_break_glass_used_total{service}
```

Logs should be structured.

Example:

```json
{
  "eventType": "AUTHZ_DECISION",
  "effect": "DENY",
  "reasonCode": "TENANT_MISMATCH",
  "service": "case-service",
  "action": "case.view",
  "resourceType": "case",
  "resourceIdHash": "sha256:...",
  "subject": "user-123",
  "callingWorkload": "gateway",
  "tenantId": "tenant-1",
  "correlationId": "corr-abc",
  "policyVersion": "case-policy@2026-06-01"
}
```

Trace attributes:

```text
authz.effect
authz.reason_code
authz.policy_version
authz.pdp.latency_ms
authz.cache.hit
authz.failure_mode
```

Be careful not to log sensitive claims/resource data.

---

## 29. Data Minimization Across Services

Authorization is also about not sending data to services that do not need it.

Bad:

```text
Case Service publishes CaseApproved event with full applicant profile, documents, notes, risk score.
Notification Service consumes it and only needs applicant email.
```

Risk:

- unauthorized consumers receive sensitive data,
- event log becomes data lake of secrets,
- retention problem,
- replay exposes data,
- downstream access control becomes impossible.

Better:

```text
CaseApproved event:
  caseId
  tenantId
  applicantId
  notificationTemplateCode
  no sensitive document payload

Notification Service:
  fetch minimal contact data through authorized API if needed
```

### Principle

> Do not use authorization to compensate for unnecessary data distribution. Minimize data before it crosses service boundaries.

---

## 30. Multi-Tenant Microservices

Tenant boundary becomes harder in distributed systems.

Common issue:

```text
Gateway resolves tenant A.
Service A uses tenant A.
Service B receives only resource id and does not know tenant.
Service B queries global table by id and returns tenant B data.
```

### Tenant context requirements

Every service call should have tenant context if resource is tenant-scoped.

But tenant header alone is not enough.

Need:

1. tenant resolved from trusted source,
2. resource query scoped by tenant,
3. cache key includes tenant,
4. downstream token/context includes tenant,
5. audit includes tenant,
6. policy checks tenant match,
7. service account tenant scope controlled.

### Java repository pattern

```java
public Optional<CaseRecord> findByTenantAndId(TenantId tenantId, CaseId caseId) {
    return entityManager.createQuery(
            "select c from CaseRecord c where c.tenantId = :tenantId and c.id = :id",
            CaseRecord.class
    )
    .setParameter("tenantId", tenantId.value())
    .setParameter("id", caseId.value())
    .getResultStream()
    .findFirst();
}
```

Never:

```java
findById(caseId)
```

for tenant-scoped resources unless tenant is guaranteed by database key design.

---

## 31. Policy Versioning Across Services

When policy changes, services may not update simultaneously.

Problems:

1. gateway uses policy v1,
2. service A uses policy v2,
3. service B sidecar uses policy v1,
4. audit sees inconsistent decision,
5. user gets inconsistent access.

### Strategies

1. policy bundle versioning,
2. decision includes policy version,
3. rollout by environment/tenant,
4. compatibility window,
5. dry-run/shadow decision,
6. canary policy,
7. fail if required policy version missing for critical action,
8. dashboard by service/policy version.

### Shadow decision

Service enforces old policy but evaluates new policy for comparison:

```text
enforced: case-policy@2026-05-01 -> PERMIT
shadow  : case-policy@2026-06-01 -> DENY
log diff, do not enforce yet
```

Use for safe migration.

---

## 32. Distributed Authorization Design Patterns

### Pattern A — Edge coarse + service domain check

```text
Gateway:
  validate JWT
  require scope case-api

Case Service:
  check tenant/object/state/user permission
```

Use for most systems.

### Pattern B — Central PDP for cross-cutting policy

```text
All services call central PDP for common ABAC/PBAC decision.
Domain service still provides resource context.
```

Use when policy governance matters.

### Pattern C — Sidecar policy engine

```text
Each service has local PDP sidecar with policy bundle.
```

Use when latency/availability and platform maturity support it.

### Pattern D — Token exchange with downstream narrowing

```text
Service A exchanges user token for Service B token with narrowed audience/scope/resource.
```

Use for high-security service-to-service calls.

### Pattern E — Workload policy + delegated user policy

```text
Permit only if workload can call AND original user can act.
```

Use for user-originated internal calls.

### Pattern F — Materialized access for list/search/report

```text
Precompute accessible resource ids/scopes or inject predicates into query.
```

Use for high-volume reads.

### Pattern G — Purpose-bound service account

```text
Service account can act only for specific purpose and operation.
```

Use for batch/system tasks.

---

## 33. Java Implementation Blueprint

### 33.1 Core model

Java 8-compatible style:

```java
public final class AuthorizationRequest {
    private final CallerContext caller;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    public AuthorizationRequest(
            CallerContext caller,
            Action action,
            ResourceRef resource,
            AuthorizationContext context
    ) {
        this.caller = Objects.requireNonNull(caller, "caller");
        this.action = Objects.requireNonNull(action, "action");
        this.resource = Objects.requireNonNull(resource, "resource");
        this.context = Objects.requireNonNull(context, "context");
    }

    public CallerContext caller() { return caller; }
    public Action action() { return action; }
    public ResourceRef resource() { return resource; }
    public AuthorizationContext context() { return context; }
}
```

Java 17+ style:

```java
public record AuthorizationRequest(
        CallerContext caller,
        Action action,
        ResourceRef resource,
        AuthorizationContext context
) {
    public AuthorizationRequest {
        Objects.requireNonNull(caller, "caller");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(resource, "resource");
        Objects.requireNonNull(context, "context");
    }
}
```

### 33.2 Caller context

```java
public final class CallerContext {
    private final Optional<SubjectRef> originalSubject;
    private final WorkloadRef callingWorkload;
    private final Optional<ClientRef> client;
    private final TenantRef tenant;
    private final Optional<DelegationContext> delegation;
    private final String correlationId;
    private final Map<String, String> trustedAttributes;

    // constructor/getters omitted
}
```

### 33.3 Decision object

```java
public final class AuthorizationDecision {
    private final DecisionEffect effect;
    private final String reasonCode;
    private final String policyVersion;
    private final List<Obligation> obligations;
    private final boolean indeterminate;

    public static AuthorizationDecision permit(String reasonCode, String policyVersion) {
        return new AuthorizationDecision(
                DecisionEffect.PERMIT,
                reasonCode,
                policyVersion,
                Collections.emptyList(),
                false
        );
    }

    public static AuthorizationDecision deny(String reasonCode, String policyVersion) {
        return new AuthorizationDecision(
                DecisionEffect.DENY,
                reasonCode,
                policyVersion,
                Collections.emptyList(),
                false
        );
    }

    public static AuthorizationDecision indeterminateDeny(String reasonCode) {
        return new AuthorizationDecision(
                DecisionEffect.INDETERMINATE,
                reasonCode,
                "unknown",
                Collections.emptyList(),
                true
        );
    }

    public boolean permitted() {
        return effect == DecisionEffect.PERMIT;
    }
}
```

### 33.4 Enforcement helper

```java
public final class AuthorizationEnforcer {
    private final AuthorizationClient client;
    private final AuthorizationAudit audit;

    public void enforce(AuthorizationRequest request) {
        AuthorizationDecision decision = client.decide(request);
        audit.record(request, decision);

        if (!decision.permitted()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
    }
}
```

### 33.5 Spring integration sketch

```java
@Component
public final class CaseAuthorization {
    private final AuthorizationEnforcer enforcer;

    public void enforceView(CallerContext caller, CaseRecord record) {
        enforcer.enforce(new AuthorizationRequest(
                caller,
                Action.of("case.view"),
                ResourceRef.caseRef(record.id(), record.tenantId()),
                AuthorizationContext.builder()
                        .put("state", record.state())
                        .put("agencyId", record.agencyId())
                        .put("assignedOfficerId", record.assignedOfficerId())
                        .build()
        ));
    }
}
```

### 33.6 Downstream client with context

```java
public final class DocumentClient {
    private final HttpClient httpClient;
    private final DelegationTokenService delegationTokenService;

    public List<DocumentMetadata> getDocumentsForCase(CallerContext caller, CaseId caseId) {
        String token = delegationTokenService.issueToken(
                caller,
                Audience.of("document-service"),
                Action.of("document.read-metadata"),
                ResourceScope.caseScope(caseId),
                Purpose.of("case-view")
        );

        // Java 11+ HttpClient example. Java 8 can use OkHttp/Apache HttpClient.
        // Build request with Authorization: Bearer token and correlation id.
        return Collections.emptyList();
    }
}
```

---

## 34. Threat Model Checklist

For each service:

1. What resources does this service own?
2. What actions does it expose?
3. Which endpoints are public, partner, internal, admin, batch?
4. Which callers are allowed?
5. Is caller a human, workload, or delegated actor?
6. Does service validate workload identity?
7. Does service validate original subject?
8. Does service validate token audience?
9. Does service check tenant/resource scope?
10. Does service perform object-level authorization?
11. Does service have alternate paths bypassing check?
12. Do message consumers enforce authorization for commands?
13. Can report/export bypass normal query scoping?
14. Are decision caches keyed correctly?
15. What happens when PDP is unavailable?
16. What happens when permission is revoked?
17. Is policy version recorded?
18. Is audit correlated across services?
19. Can a privileged service become confused deputy?
20. Are service accounts least-privilege?

---

## 35. Testing Strategy

### 35.1 Contract tests for service boundary

For every protected internal endpoint:

```text
- no credential -> deny
- invalid workload -> deny
- valid workload but wrong purpose -> deny
- valid workload but missing original subject for user action -> deny
- valid workload + original subject but wrong tenant -> deny
- valid workload + original subject + allowed resource -> permit
```

### 35.2 Confused deputy tests

Simulate:

```text
User cannot view document D.
User can call report generation.
Report service has workload access to document service.
Assert report does not include D.
```

### 35.3 Revocation tests

```text
1. User has role.
2. Token issued.
3. Role revoked.
4. High-risk action attempted with old token.
5. Assert denied or forced refresh.
```

### 35.4 Cache key tests

```text
Same user, same action, different tenant -> different cache key
Same user, same action, same resource, different purpose -> different cache key
Same user, same action, same resource, policy version changed -> recompute
Same user, same action, resource state changed -> recompute or deny
```

### 35.5 Policy failure tests

```text
PDP timeout -> high-risk action denied
Policy bundle missing -> denied
Attribute source down -> denied if attribute required
Audit sink down -> local spool or deny according to policy
```

### 35.6 Message authorization tests

```text
Unauthenticated command -> deny
Command from unauthorized producer -> deny
Command with tenant mismatch -> deny
Command replay without replay permission -> deny
Event replay with historical mode -> no duplicate side effect
```

---

## 36. Production Readiness Checklist

A distributed authorization design is not production-ready until it answers:

### Identity and context

- [ ] User identity and workload identity are separated.
- [ ] Original subject is preserved for delegated calls.
- [ ] Token audience is validated by every resource service.
- [ ] Tenant context is resolved from trusted source.
- [ ] Internal headers are stripped at boundary and re-injected only by trusted component.
- [ ] Delegation/impersonation chain is explicit.

### Enforcement

- [ ] Gateway performs coarse authorization.
- [ ] Owning service performs object/domain/state authorization.
- [ ] Data-level query scoping prevents list/report/export leakage.
- [ ] Internal endpoints require workload authorization.
- [ ] Message consumers validate command authorization.
- [ ] Batch jobs have explicit system purpose and scope.

### Least privilege

- [ ] Service accounts are purpose-bound.
- [ ] No shared internal admin token.
- [ ] Downstream calls narrow authority.
- [ ] Sensitive actions require fresh decision.
- [ ] Break-glass/impersonation is separately controlled.

### Reliability

- [ ] PDP calls have timeout.
- [ ] Failure mode is explicit.
- [ ] High-risk actions fail closed.
- [ ] Cache keys include tenant/resource/context/policy version.
- [ ] Revocation events invalidate relevant caches.
- [ ] Policy rollout supports versioning and rollback.

### Audit and observability

- [ ] Authorization decisions include correlation/trace id.
- [ ] Decision logs include policy version and reason code.
- [ ] Allow, deny, and indeterminate are observable.
- [ ] Distributed audit can reconstruct end-to-end action.
- [ ] Sensitive resource data is not over-logged.

---

## 37. Common Anti-Patterns

### Anti-pattern 1 — Gateway-only authorization

```text
"All requests go through gateway, so services trust everything."
```

Fails when:

- internal call bypasses gateway,
- message/job path exists,
- service compromised,
- gateway policy incomplete.

### Anti-pattern 2 — Internal admin service account

```text
All services use internal-admin with all permissions.
```

Destroys least privilege and audit.

### Anti-pattern 3 — Forwarding broad user token everywhere

```text
Every downstream receives original token with broad scopes.
```

Creates audience confusion and lateral movement risk.

### Anti-pattern 4 — Trusting `X-User-Id`

```text
Service accepts X-User-Id from any caller.
```

Classic spoofing issue.

### Anti-pattern 5 — Authorization only on commands, not reads

Read/list/export leaks are often more damaging than mutation.

### Anti-pattern 6 — Fetch-then-filter for distributed data

Bad for pagination, count, performance, and leakage.

### Anti-pattern 7 — Service mesh as replacement for domain authz

Mesh knows workloads and routes. It usually does not know domain invariants.

### Anti-pattern 8 — Caching allow decision too broadly

A cached allow without resource/context/policy version can become privilege escalation.

### Anti-pattern 9 — Treating event replay as user action

Replay requires different authorization semantics.

### Anti-pattern 10 — Missing audit on deny/indeterminate

Deny spikes and indeterminate decisions are security signals.

---

## 38. Mental Model Summary

Distributed authorization must combine multiple checks:

```text
PERMIT only if:
  external request is authenticated and admitted
AND caller workload is allowed to call target service/action
AND original subject is allowed to perform business action
AND delegation/impersonation context is valid
AND tenant/resource scope matches
AND target resource state allows action
AND context/risk/time requirements are satisfied
AND downstream authority is narrowed
AND decision is auditable
```

This is why simplistic rules fail:

```text
hasRole("ADMIN")
hasScope("case.read")
trusted internal network
valid JWT
called from gateway
```

Each is only a fragment.

A top-level design sees authorization as an end-to-end chain of custody:

```text
identity -> delegation -> service boundary -> resource boundary -> data boundary -> decision -> obligation -> audit
```

---

## 39. Top 1% Engineering Insights

1. **Authorization does not become simpler in microservices; it becomes distributed.** If you split a monolith without moving the authorization model carefully, you create invisible bypass paths.

2. **Gateway authorization is admission control, not domain authorization.** It is necessary, but rarely sufficient.

3. **Workload identity and user identity are different.** A service being allowed to call another service does not mean the original user is allowed to access the target resource.

4. **Downstream narrowing is one of the strongest defenses.** Every hop should carry authority no broader than needed.

5. **Confused deputy is the central distributed authorization failure mode.** Privileged services must be constrained by purpose, resource scope, and original subject.

6. **Token claims are evidence, not policy.** Claims help evaluate policy; they should not replace object/state/tenant checks.

7. **Revocation delay is unavoidable; design by action sensitivity.** Low-risk actions can tolerate cache; high-risk actions need fresh decision.

8. **Internal APIs still need authorization.** Internal is not synonymous with trusted.

9. **Authorization cache keys are security boundaries.** Missing tenant/resource/context/policy version in cache key can leak access.

10. **Audit must be distributed too.** A single service log is not enough to reconstruct multi-hop authorization.

11. **Service mesh is powerful for workload policy, weak for business policy.** Use it as a layer, not the whole design.

12. **Event-driven authorization requires separating command, event, replay, and side effect.** Treating all messages the same leads to incorrect enforcement.

13. **Purpose is a first-class authorization dimension.** The same data access may be allowed for case review but denied for report export.

14. **Fail-closed is not a slogan; it must be encoded per action.** Otherwise outages silently become access-control bypasses.

15. **Distributed authorization requires governance.** Policy versioning, rollout, dry-run, audit, and test matrix are part of the architecture, not afterthoughts.

---

## 40. Practical Architecture Example

Imagine regulatory case system:

```text
Services:
  gateway
  case-service
  workflow-service
  document-service
  report-service
  notification-service
  audit-service
  entitlement-service
  policy-service/PDP
```

### User approves case

Flow:

```text
1. User calls POST /cases/CASE-123/approve.
2. Gateway validates token, audience, route scope.
3. Gateway injects trusted context/correlation id.
4. Case Service loads CASE-123 scoped by tenant.
5. Case Service asks authorization:
     can user approve this case in current state?
6. Case Service checks maker-checker:
     submitter != approver.
7. Case Service calls Workflow Service with narrowed delegated token:
     originalSubject=user
     delegatedAction=workflow.transition
     resourceScope=CASE-123
     purpose=case-approval
8. Workflow Service validates workload case-service.
9. Workflow Service validates delegated user/action/resource.
10. Workflow Service transitions state if guard passes.
11. Document Service may be called to mark supporting docs as finalized.
12. Document Service validates workload and resource scope.
13. Audit Service receives structured event with decision ids.
14. Notification Service sends minimal notification payload.
```

Permit requires all relevant layers to pass.

If PDP is down during step 5:

```text
case.approve is high-risk -> deny/indeterminate -> no transition
```

If Notification Service cannot send:

```text
approval may remain valid; notification retry is separate side effect
```

This distinction matters: authorization protects the business action, not every non-critical side effect equally.

---

## 41. References

- OWASP Authorization Cheat Sheet — guidance on robust, centralized, deny-by-default authorization and validating authorization on every request.
- OWASP API Security 2023 — especially Broken Object Level Authorization and object-level enforcement.
- Spring Security Reference — OAuth2 Resource Server JWT support and authorization architecture.
- Open Policy Agent documentation — policy engine and Envoy/sidecar authorization integration.
- Envoy External Authorization filter documentation — external authorization service pattern.
- Istio Authorization Policy and RequestAuthentication documentation — mesh-level workload/JWT authorization concepts.
- NIST SP 800-207 Zero Trust Architecture — contextual and per-request access decision mindset.
- Google Zanzibar paper — relationship/tuple-based authorization and consistency trade-offs for distributed authorization systems.

---

## 42. Closing

Part ini membangun mental model distributed authorization: edge, service, workload, user, delegation, tenant, resource, policy, cache, failure mode, and audit.

Kunci utamanya:

> Dalam microservices, authorization bukan lagi pertanyaan “apakah request ini boleh masuk?” tetapi “apakah setiap hop dalam chain of custody ini masih membawa authority yang benar, lebih sempit, tervalidasi, dan bisa diaudit?”

Pada part berikutnya kita akan masuk ke **Part 24 — Token Scopes, Claims, and Authorization Boundaries**, yaitu membedah lebih dalam token sebagai evidence authorization: scope vs permission, claim vs authority, token bloat, stale claim, audience, consent, token exchange, on-behalf-of, dan boundary antara token validation dengan policy decision.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-022.md">⬅️ Part 22 — Temporal, Risk-Based, and Contextual Authorization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-024.md">Learn Java Authorization Modes and Patterns — Part 24 ➡️</a>
</div>
