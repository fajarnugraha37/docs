# learn-java-authorization-modes-and-patterns-part-031

# Part 31 — Building an Internal Authorization Service

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Part: **31 / 34**  
> Target pembaca: senior/principal Java engineer, tech lead, security-minded backend engineer, regulatory/case-management platform engineer  
> Versi Java: **Java 8 sampai Java 25**  
> Fokus: membangun **internal authorization service** yang production-grade, domain-aware, auditable, testable, scalable, dan bisa menjadi fondasi sebelum/atau bersamaan dengan external policy engine.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 30, kita sudah membangun fondasi konseptual dan domain model:

- authorization sebagai sistem keputusan,
- vocabulary subject/action/resource/context/policy/decision,
- RBAC, ABAC, PBAC, ReBAC, ACL,
- data-level authorization,
- workflow/state-machine authorization,
- microservices authorization,
- token scope/claim boundaries,
- caching/performance,
- failure semantics,
- auditability,
- testing,
- anti-patterns,
- dan domain model Java untuk authorization.

Part ini menjawab pertanyaan praktis:

> “Bagaimana semua itu dijadikan satu service internal yang bisa dipakai konsisten oleh controller, service, repository/query, batch job, messaging consumer, export/report, dan internal API?”

Kata **internal** di sini penting.

Internal authorization service bukan berarti selalu service terpisah lewat network. Dalam banyak sistem Java, bentuk awal yang paling sehat justru berupa **module/library/service component di dalam aplikasi**. Ia menjadi **PDP lokal** atau **domain authorization facade** yang menyatukan rule, resolver, cache, audit, dan observability.

Nanti pada Part 32, kita bahas external policy engine integration. Part 31 adalah pondasi agar aplikasi kita punya authorization boundary yang rapi bahkan sebelum memakai OPA/Cedar/OpenFGA/Zanzibar-like service.

---

## 1. Mental Model: Internal Authorization Service Sebagai “Decision Kernel”

Internal authorization service adalah **decision kernel** untuk aplikasi.

Ia bukan:

- sekadar helper `SecurityUtils.hasRole(...)`,
- sekadar wrapper Spring Security annotation,
- sekadar table permission,
- sekadar interceptor,
- sekadar if-else besar di service layer,
- sekadar cache entitlement.

Ia adalah komponen yang menjawab pertanyaan:

```text
Given:
  subject  = siapa/apa yang bertindak
  action   = operasi yang ingin dilakukan
  resource = target operasi
  context  = kondisi request, tenant, workflow, channel, time, risk, delegation

Return:
  decision = allow / deny / indeterminate
  reason   = mengapa
  evidence = data apa yang dipakai
  obligations = apa yang wajib dilakukan jika allow
```

Dalam bentuk paling sederhana:

```java
AuthorizationDecision decision = authorizationService.authorize(
    subject,
    Action.of("case.approve"),
    ResourceRef.of("case", caseId),
    context
);

if (decision.isDenied()) {
    throw new AccessDeniedException(decision.safeMessage());
}
```

Tapi dalam sistem matang, service ini juga harus mampu:

- mengevaluasi banyak resource sekaligus,
- memfilter query/list,
- menjelaskan hasil keputusan untuk audit,
- mencatat decision event,
- menormalisasi subject/action/resource/context,
- mengambil atribut dari source of truth,
- menyelesaikan role/permission/relationship,
- memproteksi cache key,
- menangani policy version,
- fail-closed saat dependency kritis gagal,
- dan menjadi satu titik governance untuk evolusi authorization.

---

## 2. Kenapa Internal Authorization Service Dibutuhkan?

Banyak aplikasi Java enterprise mulai dari pola seperti ini:

```java
@PreAuthorize("hasRole('ADMIN')")
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable Long id) {
    caseService.approve(id);
}
```

Lalu requirement bertambah:

- approver tidak boleh maker,
- approver harus dari agency yang sama,
- case harus dalam state `PENDING_APPROVAL`,
- user harus punya role `CASE_APPROVER` pada scope team tertentu,
- case officer yang assigned boleh edit draft tapi tidak boleh approve,
- supervisor bisa reassign hanya dalam division sendiri,
- break-glass boleh view tapi harus punya justification,
- support engineer boleh impersonate hanya read-only,
- export butuh permission berbeda dari view,
- report count tidak boleh bocor cross-tenant,
- batch job harus menjalankan system authority terbatas,
- API internal tidak boleh bypass object-level authorization.

Jika semua rule ini disebar ke annotation, controller, query, mapper, UI, dan ad-hoc utility, sistem menjadi sulit diaudit.

Gejala umum:

```text
Controller A: checks role
Controller B: checks tenant
Service C: checks assignment
Repository D: filters by organization
Export job E: forgot object-level check
Report query F: leaks aggregation count
Admin endpoint G: bypasses service layer
```

Internal authorization service menyelesaikan masalah ini dengan membuat **decision boundary eksplisit**.

---

## 3. Prinsip Desain Utama

Internal authorization service harus memegang beberapa prinsip non-negotiable.

### 3.1 Deny by Default

Jika rule tidak ditemukan, atribut tidak cukup, resource tidak jelas, context tidak trusted, atau dependency kritis gagal, hasil default harus **deny** atau **indeterminate yang diperlakukan sebagai deny**.

```text
Unknown is not allowed.
Missing evidence is not allowed.
Ambiguous scope is not allowed.
```

Ini bukan hanya prinsip security. Ini juga prinsip maintainability. Saat permission baru ditambahkan tapi belum dimapping, sistem gagal aman.

### 3.2 Centralized Decision, Distributed Enforcement

Keputusan sebaiknya terpusat secara logis, tetapi enforcement tetap bisa terjadi di banyak tempat:

- controller/request filter,
- service method,
- domain command handler,
- repository/query scope,
- messaging consumer,
- batch job,
- report/export pipeline,
- file download,
- workflow transition guard.

Pattern:

```text
Many PEPs, one decision model.
```

Bukan berarti semua PEP harus memanggil remote service. Yang penting adalah semua PEP memakai model keputusan yang sama.

### 3.3 Explicit Subject, Action, Resource, Context

Jangan membuat API yang hanya menerima string permission.

Kurang baik:

```java
boolean can(String permission);
```

Lebih baik:

```java
AuthorizationDecision authorize(
    SubjectRef subject,
    Action action,
    ResourceRef resource,
    AuthorizationContext context
);
```

Kenapa?

Karena permission saja tidak cukup untuk object-level, tenant-level, state-based, contextual, delegated, dan audit-friendly authorization.

### 3.4 Decision is Data, Not Boolean

Boolean terlalu miskin.

Kurang baik:

```java
boolean allowed = authorizationService.canApprove(user, caseId);
```

Lebih baik:

```java
AuthorizationDecision decision = authorizationService.authorize(request);
```

Decision perlu membawa:

- outcome,
- reason code,
- policy id,
- policy version,
- evidence,
- obligations,
- cacheability,
- diagnostic detail untuk internal logs,
- safe public message untuk user.

### 3.5 Policy Evaluation Harus Side-Effect Free

Authorization decision sebaiknya tidak mengubah state bisnis.

Tidak ideal:

```java
boolean allowed = authz.authorizeAndMarkCaseViewed(user, caseId);
```

Lebih sehat:

```java
AuthorizationDecision decision = authz.authorize(...);
if (decision.isAllowed()) {
    caseViewAudit.recordViewed(...);
}
```

Obligation boleh dikembalikan oleh decision, tapi eksekusinya harus eksplisit oleh PEP/domain service.

### 3.6 Authorization Tidak Boleh Mengandalkan UI

UI boleh menyembunyikan tombol, tapi tidak boleh menjadi enforcement point utama.

Internal authorization service harus bisa dipakai oleh backend untuk semua operation. UI hanya consumer dari capability summary.

---

## 4. Tanggung Jawab Internal Authorization Service

Internal authorization service yang matang biasanya punya tanggung jawab berikut.

### 4.1 Normalisasi Request

Mengubah input mentah menjadi bentuk canonical.

Contoh input mentah:

```text
userId = "123"
action = "approve"
caseId = 9981
tenantHeader = "CEA"
```

Canonical:

```text
subject = UserSubject(id=123, tenant=CEA, authorities=[...])
action = Action("case.approve")
resource = ResourceRef(type="case", id="9981", tenant="CEA")
context = channel=INTRANET, requestId=..., clock=..., delegation=none
```

Normalisasi penting agar semua policy tidak membaca data mentah yang berbeda-beda.

### 4.2 Subject Resolution

Subject bukan hanya username.

Subject bisa mencakup:

- user id,
- account id,
- principal name,
- authenticated authorities,
- tenant/agency,
- department/team,
- active role session,
- delegation/acting capacity,
- assurance level,
- authentication method,
- workload identity,
- support impersonation state.

Service harus membedakan:

```text
real subject      = siapa yang login
effective subject = atas nama siapa aksi dilakukan
actor subject     = service/job yang mengeksekusi
```

Contoh support impersonation:

```text
real_user      = support.engineer.17
effective_user = agency.user.991
mode           = impersonation_readonly
```

Decision harus tahu keduanya.

### 4.3 Action Resolution

Action harus canonical dan domain-oriented.

Bukan:

```text
POST /api/v1/case/approve
```

Tapi:

```text
case.approve
```

Route bisa berubah, action tidak seharusnya sering berubah.

Action taxonomy:

```text
case.create
case.read
case.search
case.update
case.submit
case.assign
case.reassign
case.approve
case.reject
case.return
case.close
case.reopen
case.export
case.downloadAttachment
case.viewAuditTrail
```

Service bisa menyediakan mapper:

```java
Action action = actionRegistry.resolve("case", "approve");
```

### 4.4 Resource Resolution

ResourceRef minimal biasanya berisi:

```java
ResourceRef(type="case", id="9981")
```

Tapi decision sering butuh atribut resource:

- tenant,
- owner,
- assigned officer,
- state,
- classification,
- case type,
- sensitivity,
- createdBy,
- current approver,
- parent resource,
- workflow instance id.

Karena itu service butuh ResourceAttributeResolver.

### 4.5 Context Resolution

Context mencakup kondisi saat request:

- tenant from trusted server-side context,
- channel: internet/intranet/admin/batch,
- IP/network zone,
- device posture,
- time,
- request correlation id,
- risk level,
- step-up status,
- locale/jurisdiction,
- transaction id,
- feature flag/policy mode,
- source application.

Context harus trusted. Jangan menerima context sensitif dari client tanpa verifikasi.

### 4.6 Policy Evaluation

Policy evaluation bisa menggabungkan:

- RBAC permission,
- ABAC attributes,
- ReBAC relationship,
- ACL entries,
- workflow state guard,
- SoD rule,
- delegation rule,
- tenant boundary,
- contextual/risk rule.

Internal service tidak harus memakai satu style. Ia boleh menjadi **hybrid authorization engine**.

### 4.7 Decision Combining

Jika ada banyak policy, hasilnya harus digabung dengan aturan eksplisit.

Common strategies:

```text
DENY_OVERRIDES
PERMIT_OVERRIDES
FIRST_APPLICABLE
UNANIMOUS_PERMIT
MAJORITY -- jarang cocok untuk security
```

Untuk enterprise/security, default paling aman biasanya:

```text
DENY_OVERRIDES + DENY_BY_DEFAULT
```

### 4.8 Audit Event Publishing

Setiap decision penting perlu bisa dicatat.

Minimal:

- decision id,
- correlation id,
- subject id,
- effective subject id,
- action,
- resource ref,
- outcome,
- reason code,
- policy id/version,
- evidence summary,
- timestamp,
- application/service name,
- request source.

Tidak semua allow harus selalu disimpan detail penuh jika volume tinggi, tapi sistem harus punya strategi jelas.

### 4.9 Observability

Authorization service harus terlihat di telemetry:

- count allow/deny/indeterminate,
- latency decision,
- cache hit/miss,
- resolver latency,
- policy error,
- top denial reason,
- deny spike by endpoint/action,
- PDP dependency failure,
- fallback path activation.

### 4.10 Admin and Governance

Authorization service biasanya butuh admin lifecycle:

- register permission,
- assign role,
- assign scoped role,
- grant delegation,
- revoke delegation,
- review access,
- simulate policy,
- view decision log,
- compare policy version,
- approve privileged access,
- expire temporary grants.

---

## 5. Public API Design

API internal authorization service harus cukup ekspresif tetapi tidak terlalu sulit dipakai.

### 5.1 Core API

```java
public interface AuthorizationService {

    AuthorizationDecision authorize(AuthorizationRequest request);

    default void verify(AuthorizationRequest request) {
        AuthorizationDecision decision = authorize(request);
        if (!decision.isAllowed()) {
            throw new AuthorizationDeniedException(decision);
        }
    }

    boolean can(AuthorizationRequest request);

    BulkAuthorizationResult bulkAuthorize(List<AuthorizationRequest> requests);

    AuthorizedResourceFilter filter(AuthorizationFilterRequest request);

    AuthorizationExplanation explain(AuthorizationRequest request);
}
```

Mental model:

- `authorize` untuk mendapatkan decision lengkap.
- `verify` untuk enforcement cepat.
- `can` untuk UI/capability ringan, tapi jangan untuk audit-critical mutation.
- `bulkAuthorize` untuk menghindari N+1 decision.
- `filter` untuk data-level/query scoping.
- `explain` untuk admin/audit/troubleshooting.

### 5.2 `authorize(...)`

Method utama.

```java
AuthorizationDecision decision = authorizationService.authorize(
    AuthorizationRequest.builder()
        .subject(currentSubject)
        .action(Action.of("case.approve"))
        .resource(ResourceRef.of("case", caseId))
        .context(context)
        .build()
);
```

Output:

```java
public final class AuthorizationDecision {
    private final DecisionOutcome outcome;
    private final ReasonCode reasonCode;
    private final String policyId;
    private final String policyVersion;
    private final List<Evidence> evidence;
    private final List<Obligation> obligations;
    private final CacheDirective cacheDirective;
    private final String correlationId;

    public boolean isAllowed() {
        return outcome == DecisionOutcome.ALLOW;
    }
}
```

`DecisionOutcome` sebaiknya bukan boolean:

```java
public enum DecisionOutcome {
    ALLOW,
    DENY,
    INDETERMINATE
}
```

`INDETERMINATE` berarti service tidak bisa menentukan keputusan karena error/insufficient data. PEP harus memperlakukannya sebagai deny kecuali ada policy exception yang sangat spesifik.

### 5.3 `verify(...)`

Untuk command/mutation:

```java
public void approveCase(String caseId) {
    AuthorizationRequest request = authzRequests.caseApprove(caseId);
    authorizationService.verify(request);

    caseDomainService.approve(caseId);
}
```

`verify` harus melempar exception domain/security yang konsisten.

```java
public final class AuthorizationDeniedException extends RuntimeException {
    private final AuthorizationDecision decision;

    public AuthorizationDeniedException(AuthorizationDecision decision) {
        super(decision.safeMessage());
        this.decision = decision;
    }
}
```

Jangan menyebar `AccessDeniedException` framework terlalu dalam ke domain jika ingin portable. Buat domain exception lalu map di adapter Spring/Jakarta.

### 5.4 `can(...)`

`can` berguna untuk:

- enable/disable UI button,
- capability summary,
- non-critical conditional rendering,
- coarse decision.

Tapi hati-hati: `can` sering menyebabkan boolean blindness.

Pattern sehat:

```java
boolean canApprove = authorizationService.can(
    AuthorizationRequest.of(subject, CASE_APPROVE, caseRef, context)
);
```

Bukan:

```java
if (authz.can("APPROVER")) { ... }
```

### 5.5 `bulkAuthorize(...)`

Untuk list page:

```java
BulkAuthorizationResult result = authorizationService.bulkAuthorize(
    cases.stream()
        .map(c -> AuthorizationRequest.of(subject, CASE_READ, c.ref(), context))
        .collect(toList())
);
```

Output sebaiknya keyed by request id/resource ref:

```java
public final class BulkAuthorizationResult {
    private final Map<AuthorizationRequestKey, AuthorizationDecision> decisions;
}
```

Bulk API penting untuk:

- table actions,
- search result capability,
- mass update validation,
- export pre-check,
- report row filtering,
- avoid N+1 resolver calls.

### 5.6 `filter(...)`

Untuk query scoping.

```java
AuthorizedResourceFilter filter = authorizationService.filter(
    AuthorizationFilterRequest.builder()
        .subject(subject)
        .action(Action.of("case.search"))
        .resourceType(ResourceType.of("case"))
        .context(context)
        .build()
);
```

Filter bisa diterjemahkan menjadi:

- JPA Specification,
- Criteria predicate,
- SQL fragment dengan parameter binding,
- MyBatis condition object,
- Elasticsearch/OpenSearch filter,
- in-memory predicate untuk small trusted dataset.

Jangan hanya melakukan filter-after-fetch untuk data besar/sensitive.

### 5.7 `explain(...)`

`explain` untuk admin dan audit, bukan untuk end-user biasa.

```java
AuthorizationExplanation explanation = authorizationService.explain(request);
```

Output bisa berisi:

- policy trace,
- matched rules,
- missing permission,
- tenant mismatch,
- resource state mismatch,
- SoD violation,
- attribute source,
- cache status,
- reason tree.

Penting: explain detail bisa sensitive. Pisahkan:

```text
public explanation  = safe for user
operator explanation = safe for support/security
forensic explanation = internal/audit only
```

---

## 6. API Shape: Java 8-Compatible vs Java 17+

### 6.1 Java 8-Compatible Value Object

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
        this.context = Objects.requireNonNull(builder.context, "context");
    }

    public static Builder builder() {
        return new Builder();
    }

    public SubjectRef subject() { return subject; }
    public Action action() { return action; }
    public ResourceRef resource() { return resource; }
    public AuthorizationContext context() { return context; }

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

### 6.2 Java 17+ Record

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
        Objects.requireNonNull(context, "context");
    }
}
```

### 6.3 Java 17+ Sealed Decision

```java
public sealed interface AuthorizationDecision
        permits AuthorizationDecision.Allowed,
                AuthorizationDecision.Denied,
                AuthorizationDecision.Indeterminate {

    DecisionMetadata metadata();

    record Allowed(
        DecisionMetadata metadata,
        List<Obligation> obligations
    ) implements AuthorizationDecision {}

    record Denied(
        DecisionMetadata metadata,
        ReasonCode reason
    ) implements AuthorizationDecision {}

    record Indeterminate(
        DecisionMetadata metadata,
        ReasonCode reason,
        Throwable error
    ) implements AuthorizationDecision {}
}
```

Untuk Java 8, pakai class hierarchy biasa.

---

## 7. Internal Architecture

High-level architecture:

```text
┌──────────────────────────────────────────────────────────────┐
│                    Application PEPs                          │
│ Controller | Method | Domain Command | Query | Batch | Msg    │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                Internal Authorization Service                 │
│  authorize | verify | can | bulkAuthorize | filter | explain  │
└───────────────────────────────┬──────────────────────────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
┌───────────────┐       ┌────────────────┐       ┌────────────────┐
│ Request        │       │ Resolver Layer │       │ Policy Engine   │
│ Normalizer     │       │ Subject/Role/  │       │ RBAC/ABAC/      │
│ Context Builder│       │ Attr/ReBAC/ACL │       │ ReBAC/Workflow  │
└───────────────┘       └────────────────┘       └────────────────┘
        │                       │                        │
        ▼                       ▼                        ▼
┌──────────────────────────────────────────────────────────────┐
│ Cache | Decision Combiner | Audit Publisher | Metrics/Tracing │
└──────────────────────────────────────────────────────────────┘
```

Core components:

```text
AuthorizationService
  ├── AuthorizationRequestFactory
  ├── SubjectResolver
  ├── ResourceResolver
  ├── AttributeResolver
  ├── RoleResolver
  ├── PermissionResolver
  ├── RelationshipResolver
  ├── AclResolver
  ├── PolicyRegistry
  ├── PolicyEvaluator
  ├── DecisionCombiner
  ├── DecisionCache
  ├── AuditPublisher
  ├── MetricsRecorder
  └── ExplanationBuilder
```

---

## 8. Request Factory Pattern

A common problem: every caller manually constructs requests differently.

Bad:

```java
AuthorizationRequest req = AuthorizationRequest.builder()
    .subject(subject)
    .action(Action.of("approveCase"))
    .resource(ResourceRef.of("CASE", id))
    .context(ctx)
    .build();
```

Somewhere else:

```java
AuthorizationRequest req = AuthorizationRequest.builder()
    .subject(user)
    .action(Action.of("case.approve"))
    .resource(ResourceRef.of("case", id.toString()))
    .context(context)
    .build();
```

This inconsistency becomes policy bugs.

Use request factory:

```java
public final class CaseAuthorizationRequests {
    private final CurrentSubjectProvider subjectProvider;
    private final AuthorizationContextProvider contextProvider;

    public AuthorizationRequest approve(String caseId) {
        return AuthorizationRequest.builder()
            .subject(subjectProvider.currentSubject())
            .action(CaseActions.APPROVE)
            .resource(ResourceRef.of(CaseResources.CASE, caseId))
            .context(contextProvider.currentContext())
            .build();
    }

    public AuthorizationRequest read(String caseId) {
        return AuthorizationRequest.builder()
            .subject(subjectProvider.currentSubject())
            .action(CaseActions.READ)
            .resource(ResourceRef.of(CaseResources.CASE, caseId))
            .context(contextProvider.currentContext())
            .build();
    }
}
```

Benefit:

- canonical action naming,
- consistent resource type,
- central subject/context injection,
- easier refactoring,
- easier tests,
- fewer string typos.

---

## 9. Resolver Layer

Resolver adalah jantung internal authorization service.

Policy tidak boleh memanggil sembarang repository sendiri secara liar. Jika setiap policy mengambil data sendiri, kita akan mendapatkan:

- duplicate query,
- inconsistent attribute freshness,
- N+1 performance problem,
- sulit audit evidence,
- sulit caching,
- sulit testing.

Gunakan resolver layer.

### 9.1 Subject Resolver

```java
public interface SubjectResolver {
    ResolvedSubject resolve(SubjectRef subject, AuthorizationContext context);
}
```

`ResolvedSubject` bisa berisi:

```java
public final class ResolvedSubject {
    private final String subjectId;
    private final SubjectType type;
    private final String tenantId;
    private final Set<RoleAssignment> roles;
    private final Set<Permission> directPermissions;
    private final Set<GroupRef> groups;
    private final Optional<DelegationContext> delegation;
    private final Optional<ImpersonationContext> impersonation;
    private final AssuranceLevel assuranceLevel;
}
```

Important distinction:

```text
Authentication tells who the caller is.
SubjectResolver tells what authorization-relevant identity facts are trusted now.
```

### 9.2 Role Resolver

```java
public interface RoleResolver {
    Set<RoleAssignment> resolveRoles(SubjectRef subject, AuthorizationContext context);
}
```

Role assignment should include scope:

```java
public final class RoleAssignment {
    private final RoleId roleId;
    private final Scope scope;
    private final Instant validFrom;
    private final Instant validUntil;
    private final AssignmentSource source;
}
```

Role without scope is dangerous in complex organizations.

Bad:

```text
ROLE_APPROVER
```

Better:

```text
ROLE_APPROVER scoped to agency=CEA, division=Licensing, caseType=EA
```

### 9.3 Permission Resolver

```java
public interface PermissionResolver {
    EffectivePermissions resolveEffectivePermissions(
        ResolvedSubject subject,
        AuthorizationContext context
    );
}
```

Effective permission should be computed from:

- direct permissions,
- role permissions,
- inherited roles,
- active role session,
- temporary grants,
- delegation grants,
- negative grants/deny if supported,
- expiry.

### 9.4 Resource Attribute Resolver

```java
public interface ResourceAttributeResolver {
    ResourceAttributes resolve(ResourceRef resource, Set<AttributeName> requiredAttributes);
}
```

Example:

```java
ResourceAttributes attrs = resourceResolver.resolve(
    ResourceRef.of("case", "9981"),
    AttributeSet.of("tenantId", "state", "assignedOfficerId", "createdBy")
);
```

Important: resolver should support partial attributes to avoid loading whole aggregate unnecessarily.

### 9.5 Relationship Resolver

```java
public interface RelationshipResolver {
    boolean hasRelation(SubjectRef subject, Relation relation, ResourceRef resource);

    Set<Relationship> relationships(
        SubjectRef subject,
        ResourceRef resource,
        AuthorizationContext context
    );
}
```

Examples:

```text
user:123 assigned_to case:9981
user:123 member_of team:licensing
team:licensing owns case:9981
agency:CEA parent_of division:Licensing
user:123 delegated_by user:456 for case.approve
```

### 9.6 ACL Resolver

```java
public interface AclResolver {
    Optional<Acl> findAcl(ResourceRef resource);
}
```

Useful when specific object-instance grants exist:

```text
case:9981 grants READ to user:123
case:9981 denies EXPORT to group:contractor
```

### 9.7 Context Resolver

```java
public interface AuthorizationContextProvider {
    AuthorizationContext currentContext();
}
```

Context must not blindly trust request headers.

Header such as `X-Tenant-Id` may be accepted only after gateway/service-side validation.

---

## 10. Policy Registry and Policy Evaluation

### 10.1 Policy Interface

```java
public interface AuthorizationPolicy {
    PolicyId id();

    boolean supports(Action action, ResourceType resourceType);

    PolicyDecision evaluate(PolicyEvaluationInput input);
}
```

`PolicyEvaluationInput` should contain resolved facts:

```java
public final class PolicyEvaluationInput {
    private final ResolvedSubject subject;
    private final Action action;
    private final ResourceRef resource;
    private final ResourceAttributes resourceAttributes;
    private final AuthorizationContext context;
    private final EffectivePermissions effectivePermissions;
    private final Set<Relationship> relationships;
    private final Optional<Acl> acl;
}
```

### 10.2 Policy Registry

```java
public interface PolicyRegistry {
    List<AuthorizationPolicy> findPolicies(Action action, ResourceType resourceType);
}
```

Registry can be implemented as:

- static code registry,
- Spring bean collection,
- configuration-driven registry,
- database-backed registry,
- external policy mapping.

Spring example:

```java
@Component
public final class SpringPolicyRegistry implements PolicyRegistry {
    private final List<AuthorizationPolicy> policies;

    public SpringPolicyRegistry(List<AuthorizationPolicy> policies) {
        this.policies = policies;
    }

    @Override
    public List<AuthorizationPolicy> findPolicies(Action action, ResourceType resourceType) {
        return policies.stream()
            .filter(p -> p.supports(action, resourceType))
            .collect(Collectors.toList());
    }
}
```

### 10.3 Example Policy: Case Approve

```java
public final class CaseApprovePolicy implements AuthorizationPolicy {

    @Override
    public PolicyId id() {
        return PolicyId.of("case.approve.v1");
    }

    @Override
    public boolean supports(Action action, ResourceType resourceType) {
        return CaseActions.APPROVE.equals(action)
            && CaseResources.CASE.equals(resourceType);
    }

    @Override
    public PolicyDecision evaluate(PolicyEvaluationInput input) {
        ResolvedSubject subject = input.subject();
        ResourceAttributes attrs = input.resourceAttributes();

        if (!input.effectivePermissions().contains(Permission.of("case.approve"))) {
            return PolicyDecision.deny(id(), ReasonCode.MISSING_PERMISSION);
        }

        if (!Objects.equals(subject.tenantId(), attrs.getString("tenantId"))) {
            return PolicyDecision.deny(id(), ReasonCode.TENANT_MISMATCH);
        }

        if (!"PENDING_APPROVAL".equals(attrs.getString("state"))) {
            return PolicyDecision.deny(id(), ReasonCode.INVALID_RESOURCE_STATE);
        }

        if (Objects.equals(subject.subjectId(), attrs.getString("createdBy"))) {
            return PolicyDecision.deny(id(), ReasonCode.SEPARATION_OF_DUTY_VIOLATION);
        }

        return PolicyDecision.allow(id())
            .withEvidence(Evidence.of("permission", "case.approve"))
            .withEvidence(Evidence.of("resource.state", "PENDING_APPROVAL"))
            .withEvidence(Evidence.of("tenant", subject.tenantId()));
    }
}
```

### 10.4 Avoiding Over-Fat Policies

Policy should not become a god object.

Bad:

```java
CaseApprovePolicy loads user, case, assignment, tenant, role, delegation, audit, cache.
```

Better:

```text
Resolver layer loads facts.
Policy only evaluates facts.
```

This makes policy:

- deterministic,
- testable,
- explainable,
- easier to move to external engine later.

---

## 11. Decision Combiner

When multiple policies match, combine explicitly.

```java
public interface DecisionCombiner {
    AuthorizationDecision combine(
        AuthorizationRequest request,
        List<PolicyDecision> policyDecisions
    );
}
```

### 11.1 Deny Overrides

```java
public final class DenyOverridesCombiner implements DecisionCombiner {
    @Override
    public AuthorizationDecision combine(
            AuthorizationRequest request,
            List<PolicyDecision> decisions) {

        for (PolicyDecision decision : decisions) {
            if (decision.outcome() == DecisionOutcome.DENY) {
                return AuthorizationDecision.denied(
                    decision.reasonCode(),
                    decision.policyId(),
                    collectEvidence(decisions)
                );
            }
        }

        boolean hasAllow = decisions.stream()
            .anyMatch(d -> d.outcome() == DecisionOutcome.ALLOW);

        if (hasAllow) {
            return AuthorizationDecision.allowed(collectObligations(decisions), collectEvidence(decisions));
        }

        return AuthorizationDecision.denied(
            ReasonCode.NO_APPLICABLE_POLICY,
            PolicyId.of("combiner.deny-by-default"),
            collectEvidence(decisions)
        );
    }
}
```

### 11.2 Combining Example

For `case.approve`, policies might be:

```text
PermissionPolicy          -> ALLOW
TenantBoundaryPolicy      -> ALLOW
WorkflowStatePolicy       -> ALLOW
SeparationOfDutyPolicy    -> DENY
DelegationPolicy          -> NOT_APPLICABLE
BreakGlassRestriction     -> NOT_APPLICABLE
```

Final:

```text
DENY due to SeparationOfDutyPolicy
```

A single deny should override allow in sensitive systems.

---

## 12. Cache Design Inside Authorization Service

Authorization cache can improve performance but can also cause privilege leakage.

### 12.1 Cache Layers

Possible caches:

```text
subject cache             = user profile / org / group data
role assignment cache     = role assignments
permission cache          = effective permission
resource attribute cache  = resource metadata
relationship cache        = relationship tuples
policy cache              = compiled/effective policy definitions
decision cache            = final decision
filter cache              = query predicate/scope
```

### 12.2 Decision Cache Key

Decision cache key must include all dimensions that can change the answer.

```java
public final class DecisionCacheKey {
    private final String subjectId;
    private final String effectiveSubjectId;
    private final String tenantId;
    private final String action;
    private final String resourceType;
    private final String resourceId;
    private final String resourceVersion;
    private final String policyVersion;
    private final String roleVersion;
    private final String relationshipVersion;
    private final String contextFingerprint;
}
```

If context includes time/risk/device/channel, cache key must account for it or disable caching.

### 12.3 Cacheability as Decision Output

Policy should declare cacheability.

```java
public final class CacheDirective {
    private final boolean cacheable;
    private final Duration ttl;
    private final Set<String> invalidationTags;
}
```

Example:

```text
case.read allow due to stable tenant+assignment -> cache 30 seconds
case.approve allow with state PENDING_APPROVAL -> cache very short or no cache
break-glass allow -> no cache
risk-based allow -> no cache or context-bound cache
```

### 12.4 Cache Invalidation Events

Authorization service should subscribe to events:

```text
RoleAssigned
RoleRevoked
PermissionChanged
UserDepartmentChanged
CaseAssigned
CaseStateChanged
DelegationGranted
DelegationRevoked
PolicyPublished
PolicyRolledBack
TenantBoundaryChanged
```

Each event invalidates tags:

```text
subject:user-123
tenant:CEA
resource:case:9981
policy:case.approve
role:CASE_APPROVER
```

### 12.5 Safer Default

Cache less first. Optimize after measuring.

For mutation authorization, prefer no final decision cache unless the invariant is stable and versioned.

---

## 13. Audit Publishing

### 13.1 Audit Event Model

```java
public final class AuthorizationAuditEvent {
    private final String decisionId;
    private final String correlationId;
    private final Instant decidedAt;
    private final String serviceName;
    private final String subjectId;
    private final String effectiveSubjectId;
    private final String action;
    private final String resourceType;
    private final String resourceId;
    private final DecisionOutcome outcome;
    private final ReasonCode reasonCode;
    private final String policyId;
    private final String policyVersion;
    private final List<Evidence> evidence;
    private final Map<String, String> contextSummary;
}
```

### 13.2 Allow vs Deny Audit

Deny events are highly valuable:

- abuse detection,
- misconfiguration detection,
- support troubleshooting,
- failed privilege escalation detection.

Allow events are also important for sensitive operations:

- approval,
- export,
- download,
- privileged admin action,
- break-glass,
- impersonation,
- user management,
- permission grant/revoke.

Do not log too much sensitive data. Log stable identifiers and safe evidence summaries.

### 13.3 Async Audit

Audit publishing should not block critical path unless the action is regulated enough that missing audit means deny.

Design options:

```text
best-effort async audit       -> for low-risk read decisions
transactional outbox audit    -> for sensitive mutation decisions
synchronous audit required    -> break-glass / privileged admin / regulated actions
```

For regulated actions, recommended:

```text
authorize -> perform mutation -> write business audit + authorization audit in same transaction/outbox
```

### 13.4 Audit Obligation

Policy can return obligation:

```java
Obligation breakGlassAudit = Obligation.of("record.breakglass.justification")
    .with("justificationRequired", true)
    .with("reviewWithinHours", 24);
```

PEP/domain service must execute it.

---

## 14. Observability Design

### 14.1 Metrics

Recommended metrics:

```text
authz.decision.count{outcome,action,resourceType,reason}
authz.decision.latency{action,resourceType}
authz.policy.latency{policyId}
authz.resolver.latency{resolver}
authz.cache.hit{cacheName}
authz.cache.miss{cacheName}
authz.decision.indeterminate.count{reason}
authz.audit.publish.failure.count
authz.policy.error.count{policyId}
authz.bulk.size{action,resourceType}
```

Cardinality warning:

Do not put raw `resourceId` or `userId` in metrics labels. Use logs/traces for high-cardinality identifiers.

### 14.2 Tracing

Trace span example:

```text
span: authz.authorize
  action=case.approve
  resource.type=case
  outcome=deny
  reason=SEPARATION_OF_DUTY_VIOLATION
  policy.id=case.approve.v1
  cache.hit=false
```

### 14.3 Logs

Structured logs:

```json
{
  "event": "authorization.decision",
  "decisionId": "d-01H...",
  "correlationId": "req-abc",
  "subjectId": "user-123",
  "action": "case.approve",
  "resourceType": "case",
  "resourceIdHash": "...",
  "outcome": "DENY",
  "reason": "SEPARATION_OF_DUTY_VIOLATION",
  "policyId": "case.approve.v1"
}
```

Hash or redact identifiers if needed.

---

## 15. Spring Integration Pattern

Internal authorization service should integrate with Spring Security without becoming dependent on SpEL everywhere.

### 15.1 Request-Level Integration

Custom `AuthorizationManager`:

```java
public final class InternalAuthzRequestAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final AuthorizationService authorizationService;
    private final HttpAuthorizationRequestMapper mapper;

    public InternalAuthzRequestAuthorizationManager(
            AuthorizationService authorizationService,
            HttpAuthorizationRequestMapper mapper) {
        this.authorizationService = authorizationService;
        this.mapper = mapper;
    }

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext object) {

        AuthorizationRequest request = mapper.toAuthorizationRequest(
            authentication.get(),
            object.getRequest()
        );

        com.example.authz.AuthorizationDecision internal =
            authorizationService.authorize(request);

        return new AuthorizationDecision(internal.isAllowed());
    }
}
```

Note naming conflict: Spring has `AuthorizationDecision`; your domain may also. Use package clarity.

### 15.2 Method-Level Integration

Annotation delegates to internal service:

```java
@PreAuthorize("@authz.canApproveCase(#caseId)")
public void approveCase(String caseId) {
    ...
}
```

Bean:

```java
@Component("authz")
public final class AuthorizationExpressionFacade {
    private final AuthorizationService authorizationService;
    private final CaseAuthorizationRequests requests;

    public boolean canApproveCase(String caseId) {
        return authorizationService.can(requests.approve(caseId));
    }
}
```

Better for complex logic:

```java
public void approveCase(String caseId) {
    authorizationService.verify(requests.approve(caseId));
    caseApplicationService.approve(caseId);
}
```

Use annotations for coarse boundaries; use explicit service call for domain-critical mutations.

### 15.3 Exception Mapping

```java
@RestControllerAdvice
public final class SecurityErrorHandler {

    @ExceptionHandler(AuthorizationDeniedException.class)
    public ResponseEntity<ProblemDetail> handle(AuthorizationDeniedException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setTitle("Access denied");
        problem.setDetail(ex.getDecision().safeMessage());
        problem.setProperty("reason", ex.getDecision().publicReasonCode());
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(problem);
    }
}
```

For hidden resources, map selected denies to 404.

---

## 16. Jakarta EE Integration Pattern

Jakarta EE can use:

- `@RolesAllowed` for coarse endpoint/method role checks,
- programmatic `SecurityContext` checks,
- CDI service for domain authorization,
- Jakarta Authorization SPI for container-level integration when needed.

Example CDI service:

```java
@ApplicationScoped
public class CaseApplicationService {

    @Inject
    AuthorizationService authorizationService;

    @Inject
    CaseAuthorizationRequests requests;

    public void approveCase(String caseId) {
        authorizationService.verify(requests.approve(caseId));
        // perform command
    }
}
```

JAX-RS resource:

```java
@Path("/cases")
public class CaseResource {

    @Inject
    CaseApplicationService service;

    @POST
    @Path("/{id}/approve")
    public Response approve(@PathParam("id") String id) {
        service.approveCase(id);
        return Response.noContent().build();
    }
}
```

Recommendation:

```text
Use container role annotations for coarse access.
Use internal authorization service for object/domain/context decisions.
```

---

## 17. Data-Level Integration

### 17.1 Filter API

Internal service should produce scoped query constraints.

```java
AuthorizedResourceFilter filter = authorizationService.filter(
    AuthorizationFilterRequest.of(subject, CaseActions.SEARCH, CaseResources.CASE, context)
);
```

Possible output:

```java
public final class AuthorizedResourceFilter {
    private final ResourceType resourceType;
    private final List<FilterPredicate> predicates;
    private final CacheDirective cacheDirective;
    private final String policyVersion;
}
```

Predicates:

```text
tenant_id = :tenantId
agency_id in (:agencyIds)
assigned_officer_id = :subjectId OR visibility = 'TEAM'
classification <= :clearance
```

### 17.2 JPA Specification Adapter

```java
public final class CaseAuthorizationSpecificationAdapter {

    public Specification<CaseEntity> toSpecification(AuthorizedResourceFilter filter) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            for (FilterPredicate fp : filter.predicates()) {
                if (fp.name().equals("tenantId")) {
                    predicates.add(cb.equal(root.get("tenantId"), fp.value()));
                } else if (fp.name().equals("assignedOfficerId")) {
                    predicates.add(cb.equal(root.get("assignedOfficerId"), fp.value()));
                }
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }
}
```

### 17.3 MyBatis Adapter

Avoid raw SQL string concatenation. Use structured parameter object.

```java
public final class AuthorizedCaseQueryScope {
    private final String tenantId;
    private final Set<String> agencyIds;
    private final String subjectId;
    private final boolean includeTeamVisible;
}
```

Mapper:

```xml
<select id="searchCases" resultType="CaseRow">
  SELECT * FROM cases
  WHERE tenant_id = #{scope.tenantId}
  <if test="scope.agencyIds != null and scope.agencyIds.size > 0">
    AND agency_id IN
    <foreach item="id" collection="scope.agencyIds" open="(" separator="," close=")">
      #{id}
    </foreach>
  </if>
</select>
```

### 17.4 Search Index Adapter

For OpenSearch/Elasticsearch:

```json
{
  "bool": {
    "filter": [
      { "term": { "tenantId": "CEA" }},
      { "terms": { "agencyId": ["CEA-LIC", "CEA-COMP"] }}
    ]
  }
}
```

Never search broadly and filter sensitive results after returning from search engine unless dataset is small and trusted.

---

## 18. Bulk Authorization and Capability Summary

UI often needs capabilities:

```text
For each case row:
  can view?
  can edit?
  can approve?
  can assign?
  can export?
```

Naive implementation:

```java
for (CaseRow row : rows) {
    row.setCanApprove(authz.canApprove(row.id()));
}
```

This causes N+1 authorization.

Better:

```java
List<AuthorizationRequest> requests = new ArrayList<>();
for (CaseRow row : rows) {
    requests.add(requestsFactory.read(row.id()));
    requests.add(requestsFactory.update(row.id()));
    requests.add(requestsFactory.approve(row.id()));
}

BulkAuthorizationResult result = authorizationService.bulkAuthorize(requests);
```

Capability DTO:

```java
public final class CaseCapabilities {
    private final boolean canRead;
    private final boolean canUpdate;
    private final boolean canApprove;
    private final boolean canAssign;
    private final boolean canExport;
}
```

Important:

Capability summary is not enforcement. It is UI hint. Backend must still verify mutation.

---

## 19. Admin API and Governance

Internal authorization service often needs admin-facing APIs.

### 19.1 Permission Catalog

```text
GET /admin/authorization/permissions
POST /admin/authorization/permissions
PATCH /admin/authorization/permissions/{permission}
```

Permission metadata:

```json
{
  "name": "case.approve",
  "resourceType": "case",
  "riskLevel": "HIGH",
  "description": "Approve case pending review",
  "ownerTeam": "Case Management",
  "introducedIn": "2026.3",
  "deprecated": false
}
```

### 19.2 Role Management

```text
GET /admin/authorization/roles
POST /admin/authorization/roles
POST /admin/authorization/roles/{role}/permissions
```

### 19.3 Role Assignment

```text
POST /admin/authorization/assignments
DELETE /admin/authorization/assignments/{id}
```

Assignment should have:

- subject,
- role,
- scope,
- valid from/until,
- justification,
- approver,
- source,
- status.

### 19.4 Delegation Management

```text
POST /admin/authorization/delegations
POST /admin/authorization/delegations/{id}/revoke
```

### 19.5 Policy Simulation

```text
POST /admin/authorization/simulate
```

Input:

```json
{
  "subjectId": "user-123",
  "action": "case.approve",
  "resource": { "type": "case", "id": "9981" },
  "context": { "channel": "INTRANET" }
}
```

Output:

```json
{
  "outcome": "DENY",
  "reason": "SEPARATION_OF_DUTY_VIOLATION",
  "matchedPolicies": ["case.approve.v1", "sod.maker-checker.v1"],
  "evidence": [
    { "name": "createdBy", "value": "user-123" },
    { "name": "subject", "value": "user-123" }
  ]
}
```

### 19.6 Governance Workflow

Permission/policy changes should follow review:

```text
Draft -> Review -> Approved -> Published -> Active -> Deprecated -> Retired
```

For high-risk systems, do not let production permissions be modified without approval/audit.

---

## 20. Database Model Sketch

A simple internal authorization DB can start with:

```sql
CREATE TABLE authz_permission (
    permission_name VARCHAR(150) PRIMARY KEY,
    resource_type VARCHAR(100) NOT NULL,
    action_name VARCHAR(100) NOT NULL,
    risk_level VARCHAR(30) NOT NULL,
    description VARCHAR(500),
    owner_team VARCHAR(100),
    created_at TIMESTAMP NOT NULL,
    deprecated_at TIMESTAMP NULL
);

CREATE TABLE authz_role (
    role_id VARCHAR(100) PRIMARY KEY,
    role_name VARCHAR(150) NOT NULL,
    description VARCHAR(500),
    created_at TIMESTAMP NOT NULL,
    deprecated_at TIMESTAMP NULL
);

CREATE TABLE authz_role_permission (
    role_id VARCHAR(100) NOT NULL,
    permission_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (role_id, permission_name)
);

CREATE TABLE authz_role_assignment (
    assignment_id VARCHAR(100) PRIMARY KEY,
    subject_id VARCHAR(100) NOT NULL,
    role_id VARCHAR(100) NOT NULL,
    scope_type VARCHAR(50) NOT NULL,
    scope_id VARCHAR(100) NOT NULL,
    valid_from TIMESTAMP NOT NULL,
    valid_until TIMESTAMP NULL,
    status VARCHAR(30) NOT NULL,
    justification VARCHAR(1000),
    approved_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE authz_delegation (
    delegation_id VARCHAR(100) PRIMARY KEY,
    delegator_subject_id VARCHAR(100) NOT NULL,
    delegate_subject_id VARCHAR(100) NOT NULL,
    permission_name VARCHAR(150) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(100),
    valid_from TIMESTAMP NOT NULL,
    valid_until TIMESTAMP NOT NULL,
    status VARCHAR(30) NOT NULL,
    justification VARCHAR(1000),
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE authz_decision_audit (
    decision_id VARCHAR(100) PRIMARY KEY,
    correlation_id VARCHAR(100),
    decided_at TIMESTAMP NOT NULL,
    subject_id VARCHAR(100) NOT NULL,
    effective_subject_id VARCHAR(100),
    action_name VARCHAR(150) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(100),
    outcome VARCHAR(30) NOT NULL,
    reason_code VARCHAR(100) NOT NULL,
    policy_id VARCHAR(150),
    policy_version VARCHAR(100),
    evidence_json CLOB,
    context_json CLOB
);
```

This is not universal schema. It is a starting point.

Do not force all authorization models into role tables if you need relationship tuples, ACL, or external policy.

---

## 21. Policy Versioning

Authorization decisions should record policy version.

Why?

Because audit questions often look like:

```text
“Why was user X allowed to approve case Y on 2026-06-20?”
```

If current policy is different from past policy, current explanation is not enough.

Policy version options:

```text
code version       = Git commit/build version
config version     = DB/config revision
bundle version     = OPA/Cedar policy bundle version
migration version  = Flyway/Liquibase migration id
```

Decision metadata:

```java
public final class DecisionMetadata {
    private final String decisionId;
    private final Instant decidedAt;
    private final String policySetId;
    private final String policySetVersion;
    private final String applicationVersion;
}
```

---

## 22. Failure Handling

Internal authorization service must fail safely.

### 22.1 Resolver Failure

Example:

```text
ResourceAttributeResolver failed to load case state.
```

Decision:

```text
INDETERMINATE -> deny at PEP
reason = RESOURCE_ATTRIBUTE_UNAVAILABLE
```

### 22.2 Cache Failure

If cache unavailable:

- try source of truth,
- if source available, continue,
- if source unavailable, deny for sensitive action.

Do not fail-open just because Redis is down.

### 22.3 Policy Registry Failure

If no policy loaded:

```text
DENY / INDETERMINATE
reason = NO_POLICY_AVAILABLE
```

### 22.4 Audit Failure

For sensitive action:

```text
if audit required and audit cannot be guaranteed -> deny or queue via transactional outbox
```

For low-risk action:

```text
allow but emit audit failure metric/log
```

### 22.5 External Dependency Failure

Even internal authorization service may call external org directory/relationship service.

Classify dependencies:

```text
critical for decision   -> fail closed
optional enrichment     -> degrade safely
cacheable source        -> use bounded stale cache if policy allows
```

---

## 23. Security Boundaries

### 23.1 Never Trust Client-Supplied Authorization Facts

Bad:

```json
{
  "caseId": "9981",
  "tenantId": "CEA",
  "role": "CASE_APPROVER"
}
```

The backend must derive tenant/role from trusted server-side sources.

### 23.2 Avoid `subjectId` Override

Admin APIs may need acting subject for simulation, but normal APIs should never accept arbitrary subject id for enforcement.

### 23.3 Protect Admin Authorization APIs

Authorization admin endpoints are high-risk.

They require:

- strong authentication,
- privileged role,
- SoD approval,
- audit,
- rate limit,
- tamper-resistant logs,
- possibly step-up authentication,
- production change workflow.

### 23.4 Meta-Authorization

Who can change authorization?

This is authorization about authorization.

Examples:

```text
Only SecurityAdmin can create permission.
Only RoleOwner can propose role permission changes.
Only AccessApprover can approve grants.
Requester cannot approve own access grant.
BreakGlassAdmin cannot delete own audit records.
```

---

## 24. Migration Strategy From Legacy Authorization

Most organizations do not start clean.

### 24.1 Inventory Existing Checks

Find:

- `hasRole`,
- `hasAuthority`,
- `@RolesAllowed`,
- custom `isAdmin`,
- controller if-checks,
- service if-checks,
- repository tenant filters,
- frontend capability flags,
- report/export checks,
- scheduled job checks,
- stored procedure security,
- DB views/RLS.

### 24.2 Build Permission Catalog

From existing behavior:

```text
Endpoint/action -> current role check -> intended permission -> resource type -> risk level
```

### 24.3 Introduce Authorization Service in Shadow Mode

Shadow mode:

```text
legacy decision is enforced
new authorization service decision is logged only
compare differences
```

Example:

```java
boolean legacyAllowed = legacyCheck(user, action);
AuthorizationDecision newDecision = authorizationService.authorize(request);

diffPublisher.publish(legacyAllowed, newDecision);

if (!legacyAllowed) {
    throw new AccessDeniedException("Denied");
}
```

### 24.4 Decision Diffing

Log cases:

```text
legacy allow, new deny -> possible tightened policy / false deny
legacy deny, new allow -> possible privilege expansion / dangerous
both deny, different reason -> review
both allow -> ok
```

### 24.5 Gradual Enforcement

Phases:

```text
1. Inventory
2. Permission catalog
3. New service shadow mode
4. Diff analysis
5. Enforce low-risk read operations
6. Enforce sensitive mutations
7. Enforce query scoping
8. Enforce report/export
9. Remove old checks
10. Lock governance
```

### 24.6 Avoid Big Bang Migration

Authorization migration is high-risk. Use feature flags by:

- action,
- resource type,
- tenant,
- environment,
- user group,
- endpoint.

But never let feature flag accidentally fail-open.

---

## 25. Production Readiness Checklist

### 25.1 API and Domain Model

- [ ] Authorization request has explicit subject/action/resource/context.
- [ ] Decision is not boolean-only.
- [ ] Deny, allow, indeterminate are distinct internally.
- [ ] Reason codes are stable.
- [ ] Public vs internal explanation is separated.
- [ ] Obligations are represented explicitly.
- [ ] Policy version is recorded.

### 25.2 Enforcement

- [ ] Controller/request PEP exists for coarse checks.
- [ ] Service/domain PEP exists for business-critical commands.
- [ ] Query/data-level PEP exists for search/list/report/export.
- [ ] Batch/messaging/internal API PEP exists.
- [ ] UI capability is not treated as enforcement.

### 25.3 Resolver and Source of Truth

- [ ] Subject facts come from trusted server-side source.
- [ ] Resource attributes come from source of truth.
- [ ] Tenant context cannot be spoofed by client.
- [ ] Role/permission/delegation expiry is enforced.
- [ ] Relationship changes invalidate relevant cache.

### 25.4 Policy

- [ ] No applicable policy means deny.
- [ ] Deny override is used for sensitive systems.
- [ ] Policies are unit-tested.
- [ ] Policy changes are reviewed.
- [ ] Policy simulation exists for high-risk operations.

### 25.5 Cache

- [ ] Cache keys include subject, action, resource, tenant, policy version, context dimensions.
- [ ] Sensitive decisions are not over-cached.
- [ ] Revocation events invalidate cache.
- [ ] Stale cache behavior is explicit.
- [ ] Cache failure does not fail-open.

### 25.6 Audit and Observability

- [ ] Deny events are logged/audited.
- [ ] Sensitive allow events are audited.
- [ ] Decision id/correlation id exists.
- [ ] Policy id/version is captured.
- [ ] Metrics exist for allow/deny/latency/error/cache.
- [ ] Logs avoid leaking sensitive details.

### 25.7 Operations

- [ ] Admin permission changes require authorization.
- [ ] Role grants require approval for high-risk roles.
- [ ] Temporary grants expire automatically.
- [ ] Break-glass has justification and review.
- [ ] Decision diff/shadow mode is available for migration.
- [ ] Rollback strategy exists.

---

## 26. Common Anti-Patterns

### 26.1 `AuthorizationService` as `SecurityUtils`

Bad:

```java
SecurityUtils.isAdmin();
```

This does not model action/resource/context.

### 26.2 God Policy

One class with all checks:

```java
if action = A and resource = B and role = C ...
```

This becomes untestable and unreviewable.

### 26.3 Policy Loads Everything Itself

Policy should evaluate facts, not become repository orchestrator.

### 26.4 Boolean Decision Everywhere

You lose reason, evidence, audit, and explainability.

### 26.5 Final Decision Cache Without Versioning

Stale authorization is privilege leakage.

### 26.6 Externalizing Too Early

If your internal model is messy, adding OPA/Cedar/OpenFGA will not fix it. It may only move the mess outside Java.

### 26.7 UI Capability as Backend Enforcement

Frontend `canApprove=true` is only a hint.

### 26.8 Admin Bypass

Admin endpoints often accidentally bypass the same service they manage.

### 26.9 Query Scoping Outside Authorization

If each repository invents its own tenant/visibility filter, data leakage will happen.

### 26.10 No Shadow Mode Migration

Replacing legacy authorization in one step is dangerous.

---

## 27. Example End-to-End Flow: Approve Case

```text
1. HTTP request POST /cases/9981/approve
2. Controller calls CaseApplicationService.approve("9981")
3. Application service builds canonical AuthorizationRequest
4. AuthorizationService receives request
5. SubjectResolver resolves user, roles, delegation, tenant
6. ResourceResolver resolves case tenant/state/createdBy/assignedOfficer
7. PermissionResolver computes effective permissions
8. PolicyRegistry finds policies for case.approve/case
9. Policies evaluate:
   - PermissionPolicy
   - TenantBoundaryPolicy
   - WorkflowStatePolicy
   - SeparationOfDutyPolicy
   - DelegationPolicy
10. DecisionCombiner applies deny-overrides
11. AuditPublisher emits decision event
12. MetricsRecorder records outcome/latency
13. Service receives ALLOW
14. Domain command performs approval
15. Business audit records approval
```

If maker tries to approve own case:

```text
PermissionPolicy       -> ALLOW
TenantBoundaryPolicy   -> ALLOW
WorkflowStatePolicy    -> ALLOW
SeparationOfDutyPolicy -> DENY
Final                  -> DENY
Reason                 -> SEPARATION_OF_DUTY_VIOLATION
```

---

## 28. Example End-to-End Flow: Search Cases

```text
1. HTTP request GET /cases?status=PENDING
2. Controller calls caseQueryService.search(...)
3. Query service asks AuthorizationService.filter(case.search, case)
4. AuthorizationService resolves subject roles/scopes
5. Filter policy returns tenant/agency/team predicates
6. Query service converts filter to JPA Specification/MyBatis scope
7. DB query only returns authorized rows
8. Optional bulkAuthorize calculates row-level capabilities
9. Response returns rows + capability hints
```

Important:

```text
Search authorization happens before DB query, not after returning all cases.
```

---

## 29. Internal Authorization Service vs External Policy Engine

Internal service can coexist with external engine.

### Internal Service Strengths

- strong domain integration,
- easier Java debugging,
- direct repository access,
- easier transaction/context integration,
- simpler deployment,
- easier migration from legacy,
- lower latency.

### External Engine Strengths

- policy managed outside app release,
- cross-service consistency,
- policy-as-code governance,
- better policy simulation tooling,
- language/runtime neutrality,
- centralized authorization across stack.

### Mature Architecture

```text
Application PEP
  -> Internal Authorization Service
      -> Local Java policies
      -> External PDP adapter for selected policy sets
      -> Resolver/cache/audit/observability shared
```

Do not let every caller directly call OPA/Cedar/OpenFGA with ad-hoc input. Keep an internal facade.

---

## 30. Top 1% Engineering Insights

### Insight 1: Authorization Service Is a Product, Not a Utility

It needs API design, versioning, documentation, tests, metrics, governance, and operational ownership.

### Insight 2: Decision Quality Depends on Fact Quality

Bad subject/resource/context resolution creates bad authorization even if policy syntax is beautiful.

### Insight 3: Query Authorization Is Where Many “Correct” Systems Leak

Single-object checks are not enough. Search, count, report, export, and aggregation must be scoped.

### Insight 4: Explainability Is Not Optional in Enterprise Systems

If you cannot explain why a decision happened, you cannot confidently operate, audit, or refactor authorization.

### Insight 5: Cache Is a Security Feature and a Security Risk

A cache key is part of the security model. Missing one dimension can become cross-tenant or stale-permission leakage.

### Insight 6: Internal Service First, External Engine Later

A clean internal authorization service makes external policy engine integration safer. A messy model externalized becomes distributed mess.

### Insight 7: Migration Needs Shadow Mode

Authorization changes are too risky for big bang replacement. Compare old/new decisions before enforcing.

### Insight 8: Authorization Must Be Designed Around Invariants

Do not start from framework annotations. Start from invariants:

```text
Who may do what to which resource under which conditions, and why?
```

---

## 31. Practical Design Template

When designing an internal authorization service, answer these questions:

```text
1. What is the canonical action vocabulary?
2. What are the resource types and identifiers?
3. What subject facts are trusted?
4. What context facts are trusted?
5. What resource attributes are needed for each action?
6. Which policies apply to each action/resource?
7. Which resolver owns each fact?
8. Which decisions are cacheable?
9. Which decisions require audit?
10. Which failures must deny?
11. Which query/list/report/export paths need filters?
12. How are decisions explained?
13. How are permission/policy changes governed?
14. How do we test negative cases?
15. How do we migrate existing checks?
```

If you cannot answer these, do not start by writing `@PreAuthorize` expressions everywhere.

---

## 32. Minimal Reference Implementation Structure

Suggested packages:

```text
com.example.authz
  ├── api
  │   ├── AuthorizationService.java
  │   ├── AuthorizationRequest.java
  │   ├── AuthorizationDecision.java
  │   ├── AuthorizationFilterRequest.java
  │   └── BulkAuthorizationResult.java
  ├── model
  │   ├── SubjectRef.java
  │   ├── Action.java
  │   ├── ResourceRef.java
  │   ├── AuthorizationContext.java
  │   ├── Permission.java
  │   ├── RoleAssignment.java
  │   ├── Evidence.java
  │   ├── Obligation.java
  │   └── ReasonCode.java
  ├── resolver
  │   ├── SubjectResolver.java
  │   ├── RoleResolver.java
  │   ├── PermissionResolver.java
  │   ├── ResourceAttributeResolver.java
  │   ├── RelationshipResolver.java
  │   └── AclResolver.java
  ├── policy
  │   ├── AuthorizationPolicy.java
  │   ├── PolicyRegistry.java
  │   ├── PolicyEvaluationInput.java
  │   └── DecisionCombiner.java
  ├── audit
  │   ├── AuthorizationAuditEvent.java
  │   └── AuthorizationAuditPublisher.java
  ├── cache
  │   ├── DecisionCache.java
  │   └── DecisionCacheKey.java
  ├── spring
  │   ├── InternalAuthzAuthorizationManager.java
  │   └── AuthorizationExpressionFacade.java
  └── domain
      └── caseaccess
          ├── CaseAuthorizationRequests.java
          ├── CaseActions.java
          ├── CaseResources.java
          ├── CaseApprovePolicy.java
          └── CaseSearchFilterPolicy.java
```

---

## 33. Summary

Internal authorization service adalah fondasi penting untuk authorization modern di Java enterprise.

Ia menyatukan:

- subject/action/resource/context,
- RBAC/ABAC/ReBAC/ACL/workflow rules,
- decision object,
- resolver layer,
- decision combiner,
- cache,
- audit,
- observability,
- query scoping,
- bulk authorization,
- admin governance,
- dan migration strategy.

Desain yang baik bukan sekadar membuat satu class `AuthorizationService`. Desain yang baik membuat authorization menjadi **sistem keputusan eksplisit** yang bisa:

```text
correct by construction,
secure by default,
auditable by evidence,
scalable by design,
and evolvable under change.
```

Jika Part 30 membangun model bahasanya, Part 31 membangun mesinnya.

---

## 34. Referensi

- Spring Security Reference — Authorization Architecture. `AuthorizationManager` digunakan oleh komponen request-based, method-based, dan message-based authorization untuk membuat keputusan access control.  
  https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

- OWASP Authorization Cheat Sheet. Rekomendasi penting: deny by default, centralized access control, least privilege, validasi authorization pada setiap request.  
  https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

- OWASP Logging Cheat Sheet. Referensi untuk security logging, event logging, dan penghindaran sensitive data leakage dalam log.  
  https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

- Open Policy Agent Documentation. Referensi konsep policy decoupling, policy decision, dan externalized authorization.  
  https://www.openpolicyagent.org/docs/latest/

- Cedar Policy Language Documentation. Referensi konsep principal/action/resource/entity/schema untuk policy-based authorization modern.  
  https://docs.cedarpolicy.com/

- PostgreSQL Row Security Policies. Referensi database-level row visibility sebagai defense-in-depth untuk data-level authorization.  
  https://www.postgresql.org/docs/current/ddl-rowsecurity.html

- Spring Data JPA Specifications. Referensi query predicate reusable untuk data-level authorization di JPA.  
  https://docs.spring.io/spring-data/jpa/reference/jpa/specifications.html

---

## 35. Status Seri

Selesai sampai:

- Part 0 — Authorization Mental Model
- Part 1 — Authorization Vocabulary, Semantics, and Invariants
- Part 2 — Java Platform Authorization Primitives
- Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
- Part 4 — RBAC Done Properly
- Part 5 — Permission and Capability Modeling
- Part 6 — ABAC
- Part 7 — PBAC and Policy-as-Code
- Part 8 — ReBAC
- Part 9 — ACL and Domain Object Security
- Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
- Part 11 — IDOR, BOLA, and Object-Level Authorization
- Part 12 — Authorization in Layered Java Applications
- Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
- Part 14 — Spring Method Security: Service-Level Authorization
- Part 15 — Spring Domain Authorization Patterns
- Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization
- Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging
- Part 18 — Data-Level Authorization and Query Scoping
- Part 19 — Workflow, State Machine, and Case Management Authorization
- Part 20 — Delegation, Impersonation, Acting Roles, and Break-Glass Access
- Part 21 — Hierarchical Organizations and Complex Role Resolution
- Part 22 — Temporal, Risk-Based, and Contextual Authorization
- Part 23 — Authorization for Microservices and Distributed Systems
- Part 24 — Token Scopes, Claims, and Authorization Boundaries
- Part 25 — Authorization Caching, Performance, and Scalability
- Part 26 — Authorization Failure Semantics and Error Handling
- Part 27 — Auditability, Explainability, and Regulatory Defensibility
- Part 28 — Secure Authorization Testing Strategy
- Part 29 — Authorization Anti-Patterns and Failure Modes
- Part 30 — Designing an Authorization Domain Model in Java
- Part 31 — Building an Internal Authorization Service

Seri belum selesai. Part berikutnya:

**Part 32 — External Policy Engine Integration from Java**



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-030.md">⬅️ Java Authorization Modes and Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-032.md">Java Authorization Modes and Patterns — Advanced Engineering ➡️</a>
</div>
