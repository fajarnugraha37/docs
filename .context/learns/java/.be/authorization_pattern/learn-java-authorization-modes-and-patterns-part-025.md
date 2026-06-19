# learn-java-authorization-modes-and-patterns-part-025

# Part 25 — Authorization Caching, Performance, and Scalability

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Bagian: **25 dari 35**  
> Target: Java 8 sampai Java 25  
> Fokus: bagaimana membuat authorization cepat, scalable, dan tetap benar ketika permission, role, policy, relationship, resource attribute, tenant, context, dan revocation berubah.

---

## 0. Posisi Part Ini Dalam Seri

Sampai bagian sebelumnya, kita sudah membahas authorization dari banyak sisi:

- mental model authorization,
- vocabulary dan invariant,
- Java platform primitives,
- PEP/PDP/PAP/PIP,
- RBAC,
- permission/capability,
- ABAC,
- PBAC,
- ReBAC,
- ACL,
- tenancy,
- IDOR/BOLA,
- layered enforcement,
- Spring Security request/method/domain authorization,
- Jakarta authorization,
- REST/GraphQL/gRPC/messaging,
- data-level authorization,
- workflow/state-machine authorization,
- delegation/impersonation/break-glass,
- hierarchical organization,
- contextual/risk-based authorization,
- microservices/distributed authorization,
- token scopes/claims/boundaries.

Bagian ini menjawab pertanyaan produksi yang sering muncul setelah authorization mulai serius:

> “Kalau setiap request harus cek permission, relationship, tenant, policy, resource attribute, dan state, apakah sistem tidak akan lambat?”

Jawaban singkatnya:

> Authorization boleh di-cache, tetapi **hanya bila cache key, freshness, invalidation, audit, dan failure semantics didesain sebagai bagian dari security model**, bukan sebagai optimasi belakangan.

Authorization caching yang salah bukan sekadar bug performance. Ia bisa menjadi privilege escalation.

---

## 1. Mental Model: Cache Authorization Tanpa Merusak Kebenaran

Caching pada authorization bukan seperti caching katalog produk atau static lookup.

Pada data biasa, cache stale sering berarti user melihat data lama.

Pada authorization, cache stale bisa berarti:

- user yang sudah dicabut aksesnya masih bisa approve,
- user pindah agency tapi masih bisa melihat data agency lama,
- break-glass sudah expired tapi masih dianggap aktif,
- delegated authority sudah revoked tapi masih digunakan,
- risk score berubah menjadi high-risk tapi sensitive action tetap diizinkan,
- tenant boundary bocor karena cache key tidak memasukkan tenant,
- policy versi baru sudah deny, tetapi cache decision lama masih allow.

Karena itu mental model yang aman:

```text
Authorization cache is not a truth source.
Authorization cache is a bounded, contextual, versioned, revocable approximation of an authorization decision or input.
```

Cache authorization harus menjawab empat pertanyaan sebelum dipakai:

1. **Apa yang di-cache?**
   - entitlement?
   - resource attributes?
   - relationship graph?
   - policy bundle?
   - final decision?

2. **Untuk siapa dan konteks apa cache valid?**
   - subject,
   - tenant,
   - actor mode,
   - resource,
   - action,
   - policy version,
   - context.

3. **Kapan cache harus invalid?**
   - role changed,
   - permission changed,
   - delegation revoked,
   - resource state changed,
   - tenant membership changed,
   - policy deployed,
   - risk context changed.

4. **Apa dampak jika stale?**
   - harmless stale deny?
   - dangerous stale allow?
   - audit inconsistency?
   - regulatory violation?

Top 1% engineer tidak bertanya “bisa di-cache atau tidak?” terlebih dahulu. Mereka bertanya:

> “Stale result jenis apa yang bisa kita toleransi, selama berapa lama, untuk action apa, dan dengan compensating control apa?”

---

## 2. Authorization Cost Model

Sebelum memilih cache, kita harus tahu biaya authorization berasal dari mana.

Authorization cost biasanya terdiri dari:

```text
Total authorization latency
= identity/context extraction
+ subject entitlement loading
+ resource attribute loading
+ relationship resolution
+ policy evaluation
+ decision combining
+ audit/logging
+ downstream propagation
```

Contoh request:

```http
POST /cases/C-2026-001/approve
```

Authorization mungkin perlu:

- user id,
- active tenant,
- agency,
- role,
- permission,
- assigned case team,
- case state,
- maker-checker relation,
- delegation/break-glass status,
- policy version,
- risk context,
- request channel,
- transaction state,
- audit correlation id.

Jika semua diambil dari database satu per satu:

```text
1 query get user role
1 query get permissions
1 query get department
1 query get case
1 query get assignment
1 query get delegation
1 query get policy config
1 query write audit
```

Maka single request bisa memicu banyak round-trip.

Masalahnya membesar pada:

- list page 50 rows,
- export 100.000 rows,
- report aggregation,
- batch approval,
- message consumer high throughput,
- GraphQL resolver dengan banyak nested field,
- microservice fan-out.

Karena itu caching bukan optional di sistem besar. Tetapi caching harus dipilih berdasarkan jenis data authorization.

---

## 3. Yang Bisa Di-Cache vs Yang Berbahaya Di-Cache

Tidak semua komponen authorization punya risiko sama.

### 3.1 Relatively Safe to Cache

Biasanya relatif aman di-cache jika:

- jarang berubah,
- bukan resource-specific sensitive state,
- invalidation jelas,
- stale result tidak langsung membuka high-risk action.

Contoh:

```text
permission catalog
role hierarchy definition
policy bundle
resource type metadata
action metadata
static route-to-permission mapping
```

Contoh Java:

```java
public final class PermissionCatalog {
    private final Map<String, PermissionDefinition> permissions;
    private final long version;

    public PermissionDefinition get(String code) {
        PermissionDefinition definition = permissions.get(code);
        if (definition == null) {
            throw new UnknownPermissionException(code);
        }
        return definition;
    }

    public long version() {
        return version;
    }
}
```

### 3.2 Safe With Versioning and Short TTL

Bisa di-cache, tetapi harus ada TTL, versioning, atau event invalidation.

Contoh:

```text
user effective permissions
user active roles
org hierarchy expansion
resource attributes
relationship tuples
policy evaluation data
```

Risiko:

- role revoked tapi cache masih allow,
- user pindah team tapi access tetap lama,
- resource state berubah tapi action masih allowed.

### 3.3 Dangerous to Cache as Final Decision

Final decision berbahaya di-cache jika decision bergantung pada konteks volatile.

Contoh:

```text
canApprove(caseId)
canExport(reportId)
canBreakGlass(patientId)
canActAs(supervisorId)
```

Final decision ini biasanya bergantung pada:

- state saat ini,
- assignment saat ini,
- delegation saat ini,
- risk saat ini,
- policy version saat ini,
- tenant context saat ini,
- request metadata saat ini.

Final decision boleh di-cache hanya bila:

1. cache key lengkap,
2. TTL sangat pendek,
3. stale allow risk diterima,
4. invalidation kuat,
5. action bukan high-risk, atau masih ada check ulang di mutation boundary.

---

## 4. Cache Taxonomy untuk Authorization

Authorization cache bisa dibagi menjadi beberapa jenis.

### 4.1 Permission Catalog Cache

Cache metadata permission.

```text
permission_code -> permission_definition
```

Contoh:

```text
case.read
case.update
case.approve
case.assign
report.export
```

Ini biasanya sangat cacheable karena jarang berubah.

Design:

```java
public final class PermissionDefinition {
    private final String code;
    private final String resourceType;
    private final String action;
    private final boolean highRisk;
    private final boolean requiresReason;
    private final boolean auditable;

    public PermissionDefinition(
            String code,
            String resourceType,
            String action,
            boolean highRisk,
            boolean requiresReason,
            boolean auditable
    ) {
        this.code = code;
        this.resourceType = resourceType;
        this.action = action;
        this.highRisk = highRisk;
        this.requiresReason = requiresReason;
        this.auditable = auditable;
    }
}
```

Cache rule:

```text
Refresh on deployment or permission catalog version change.
Never silently ignore unknown permission.
Unknown permission should fail closed.
```

### 4.2 Role Hierarchy Cache

Cache expansion role hierarchy.

```text
ROLE_SENIOR_OFFICER -> [ROLE_OFFICER, PERM_CASE_READ, PERM_CASE_UPDATE]
```

Pitfall:

- cyclic hierarchy,
- invalid inheritance,
- environment-specific role mapping,
- stale hierarchy after deployment.

Use version:

```java
public final class RoleHierarchySnapshot {
    private final long version;
    private final Map<String, Set<String>> expandedAuthorities;

    public Set<String> expand(String role) {
        return expandedAuthorities.getOrDefault(role, Collections.emptySet());
    }
}
```

### 4.3 Subject Entitlement Cache

Cache effective permissions untuk user atau service account.

```text
subject_id + tenant_id + actor_mode + entitlement_version -> effective_entitlements
```

Contoh:

```java
public final class SubjectEntitlements {
    private final String subjectId;
    private final String tenantId;
    private final String actorMode;
    private final long entitlementVersion;
    private final Set<String> permissions;
    private final Set<String> roles;
    private final Instant loadedAt;
    private final Instant expiresAt;

    public boolean hasPermission(String permission) {
        return permissions.contains(permission);
    }
}
```

Cache key minimal:

```java
public final class EntitlementCacheKey {
    private final String subjectId;
    private final String tenantId;
    private final String actorMode;
    private final long entitlementVersion;

    // equals/hashCode required
}
```

Jangan hanya pakai `subjectId`.

Buruk:

```java
cache.get(userId);
```

Lebih benar:

```java
cache.get(new EntitlementCacheKey(
        userId,
        tenantId,
        actorMode,
        entitlementVersion
));
```

Kenapa?

Karena user yang sama bisa punya permission berbeda untuk tenant berbeda, acting mode berbeda, atau setelah entitlement berubah.

### 4.4 Resource Attribute Cache

Cache atribut resource yang diperlukan untuk decision.

Contoh:

```text
caseId -> agencyId, state, assignedOfficerId, sensitivity, ownerOrgId, version
```

Risk:

- case state berubah dari `DRAFT` ke `SUBMITTED`, cache masih `DRAFT`,
- assigned officer berubah,
- sensitivity naik,
- agency berubah karena data correction.

Cache key harus menyertakan resource version jika mungkin.

```java
public final class CaseAuthorizationAttributes {
    private final String caseId;
    private final long caseVersion;
    private final String agencyId;
    private final String state;
    private final String assignedOfficerId;
    private final boolean sealed;
    private final String sensitivity;
}
```

Saat mutation:

```text
Check authorization using resource version that is locked/read in same transaction.
```

### 4.5 Relationship Cache

Untuk ReBAC:

```text
subject -> relationships
resource -> relationships
subject + resource -> relationship path
```

Contoh:

```text
user:123 member_of team:case-investigation
team:case-investigation assigned_to case:456
case:456 belongs_to agency:CEA
```

Relationship cache mahal karena graph bisa berubah dan transitive.

Cache harus punya:

- tuple version,
- namespace version,
- max traversal depth,
- invalidation by subject and object,
- protection terhadap recursive explosion.

### 4.6 Policy Bundle Cache

Untuk PBAC/external policy:

```text
policy bundle version -> compiled/evaluable policy
```

Biasanya aman di-cache jika immutable by version.

Rules:

```text
Never mutate policy bundle in-place.
Load new version atomically.
Decision log must include policy version.
Rollback means switching active version pointer.
```

### 4.7 Decision Cache

Cache final result:

```text
subject + action + resource + context + policy_version + data_versions -> decision
```

Ini paling berisiko.

Contoh key yang terlalu lemah:

```text
user:123 + case.approve + case:456
```

Key yang lebih benar:

```text
subject_id
actor_mode
tenant_id
action
resource_type
resource_id
resource_version
policy_version
entitlement_version
relationship_version
context_fingerprint
risk_level
time_bucket
```

Decision cache cocok untuk:

- low-risk repeated read,
- list rendering,
- UI affordance,
- short-lived request-local memoization,
- expensive ReBAC path resolution,
- bulk decision dalam satu transaction/context.

Decision cache tidak cocok untuk:

- final mutation guard high-risk,
- break-glass,
- approve/reject financial/regulatory action,
- action dengan step-up requirement,
- action dengan rapidly changing state.

---

## 5. Request-Local Memoization: Cache Paling Aman

Bentuk cache authorization paling aman adalah request-local memoization.

Artinya decision atau input authorization hanya di-cache selama satu request/transaction.

Contoh masalah:

```java
for (CaseItem item : cases) {
    if (authorizationService.canView(user, item)) {
        visible.add(item);
    }
}
```

Jika `canView` memuat entitlement user setiap kali, terjadi N+1.

Solusi:

```java
public final class AuthorizationRequestContext {
    private final Subject subject;
    private final String tenantId;
    private final Map<String, Object> memo = new HashMap<>();

    @SuppressWarnings("unchecked")
    public <T> T getOrCompute(String key, Supplier<T> supplier) {
        Object existing = memo.get(key);
        if (existing != null) {
            return (T) existing;
        }
        T value = supplier.get();
        memo.put(key, value);
        return value;
    }
}
```

Usage:

```java
public boolean canViewCase(AuthorizationRequestContext ctx, CaseSummary item) {
    SubjectEntitlements entitlements = ctx.getOrCompute(
            "entitlements:" + ctx.subject().id() + ":" + ctx.tenantId(),
            () -> entitlementService.load(ctx.subject(), ctx.tenantId())
    );

    return entitlements.hasPermission("case.read")
            && item.agencyId().equals(ctx.subject().agencyId());
}
```

Benefits:

- no cross-request stale allow,
- easy to reason about,
- no distributed invalidation,
- avoids repeated loading,
- works on Java 8+.

Caveat:

- do not store request memoization in static map,
- avoid leaking request context across threads,
- be careful with async/virtual-thread propagation.

---

## 6. Cache Key Correctness

Authorization cache is only as safe as its cache key.

A wrong cache key is a confused authorization decision.

### 6.1 Bad Cache Key Example

```java
String key = userId + ":" + permission;
```

This ignores:

- tenant,
- resource,
- action granularity,
- actor mode,
- delegation,
- resource state,
- policy version,
- entitlement version,
- context.

### 6.2 Better Cache Key

```java
public final class AuthorizationDecisionCacheKey {
    private final String subjectId;
    private final String tenantId;
    private final String actorMode;
    private final String action;
    private final String resourceType;
    private final String resourceId;
    private final Long resourceVersion;
    private final Long policyVersion;
    private final Long entitlementVersion;
    private final Long relationshipVersion;
    private final String contextFingerprint;

    public AuthorizationDecisionCacheKey(
            String subjectId,
            String tenantId,
            String actorMode,
            String action,
            String resourceType,
            String resourceId,
            Long resourceVersion,
            Long policyVersion,
            Long entitlementVersion,
            Long relationshipVersion,
            String contextFingerprint
    ) {
        this.subjectId = require(subjectId, "subjectId");
        this.tenantId = require(tenantId, "tenantId");
        this.actorMode = require(actorMode, "actorMode");
        this.action = require(action, "action");
        this.resourceType = require(resourceType, "resourceType");
        this.resourceId = require(resourceId, "resourceId");
        this.resourceVersion = resourceVersion;
        this.policyVersion = policyVersion;
        this.entitlementVersion = entitlementVersion;
        this.relationshipVersion = relationshipVersion;
        this.contextFingerprint = require(contextFingerprint, "contextFingerprint");
    }

    private static String require(String value, String name) {
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof AuthorizationDecisionCacheKey)) return false;
        AuthorizationDecisionCacheKey that = (AuthorizationDecisionCacheKey) o;
        return Objects.equals(subjectId, that.subjectId)
                && Objects.equals(tenantId, that.tenantId)
                && Objects.equals(actorMode, that.actorMode)
                && Objects.equals(action, that.action)
                && Objects.equals(resourceType, that.resourceType)
                && Objects.equals(resourceId, that.resourceId)
                && Objects.equals(resourceVersion, that.resourceVersion)
                && Objects.equals(policyVersion, that.policyVersion)
                && Objects.equals(entitlementVersion, that.entitlementVersion)
                && Objects.equals(relationshipVersion, that.relationshipVersion)
                && Objects.equals(contextFingerprint, that.contextFingerprint);
    }

    @Override
    public int hashCode() {
        return Objects.hash(
                subjectId,
                tenantId,
                actorMode,
                action,
                resourceType,
                resourceId,
                resourceVersion,
                policyVersion,
                entitlementVersion,
                relationshipVersion,
                contextFingerprint
        );
    }
}
```

### 6.3 Context Fingerprint

Context can be huge. Do not blindly put raw request data into cache key.

Build a normalized fingerprint:

```java
public final class AuthorizationContextFingerprint {
    public String fingerprint(AuthorizationContext ctx) {
        String normalized = String.join("|",
                "channel=" + ctx.channel(),
                "networkZone=" + ctx.networkZone(),
                "risk=" + ctx.riskLevel(),
                "mfa=" + ctx.mfaLevel(),
                "timeBucket=" + ctx.timeBucket()
        );
        return sha256Hex(normalized);
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
```

But remember:

```text
Hashing context does not make an incomplete context complete.
```

---

## 7. TTL Strategy

TTL adalah safety valve, bukan pengganti invalidation.

### 7.1 TTL by Risk

Different authorization data should have different TTL.

| Cache Type | Suggested TTL Mental Model | Reason |
|---|---:|---|
| Permission catalog | minutes/hours/versioned | low volatility |
| Role hierarchy | minutes/versioned | changes via admin/deploy |
| User entitlement | seconds/minutes | revocation risk |
| Resource attributes | very short/request-local | state changes matter |
| Relationship path | short/versioned | membership/assignment changes matter |
| Final decision for read UI | very short/request-local | avoid stale allow |
| Final decision for mutation | avoid cross-request cache | high correctness need |
| Break-glass/delegation | very short/no final decision cache | expiry/revocation critical |

### 7.2 TTL Should Match Business Harm

Ask:

```text
If this allow decision is stale for 30 seconds, what can happen?
```

Examples:

- stale `case.read` for non-sensitive case: maybe tolerable for 30 seconds,
- stale `case.approve`: likely not tolerable,
- stale `report.export`: dangerous,
- stale `break_glass`: dangerous,
- stale `tenant.admin`: very dangerous.

### 7.3 Hard TTL vs Soft TTL

Hard TTL:

```text
After expiry, do not use value.
```

Soft TTL:

```text
After soft expiry, refresh in background while serving old value.
```

For authorization:

- hard TTL is safer,
- soft TTL is acceptable only for low-risk data,
- stale-while-revalidate is dangerous for high-risk allow decisions.

---

## 8. Invalidation Strategy

TTL alone can leave unacceptable stale windows.

Invalidation options:

### 8.1 Manual Invalidation

Admin changes permission, app invalidates affected keys.

Pros:

- simple,
- explicit.

Cons:

- easy to miss,
- hard in distributed systems,
- rollback/error handling complicated.

### 8.2 Event-Based Invalidation

Publish events:

```text
UserRoleChanged
PermissionChanged
RoleHierarchyChanged
DelegationRevoked
PolicyPublished
CaseAssignmentChanged
CaseStateChanged
TenantMembershipChanged
```

Consumers invalidate local cache.

Example event:

```java
public final class AuthorizationInvalidationEvent {
    private final String eventId;
    private final String type;
    private final String tenantId;
    private final String subjectId;
    private final String resourceType;
    private final String resourceId;
    private final long version;
    private final Instant occurredAt;
}
```

### 8.3 Version-Based Invalidation

Instead of deleting keys, include version in key.

Examples:

```text
entitlement_version
policy_version
relationship_version
resource_version
tenant_membership_version
```

When version changes, old cache naturally misses.

This is often safer than distributed deletion.

### 8.4 Hybrid Invalidation

Best systems often combine:

```text
short TTL
+ versioned cache key
+ event invalidation
+ fail-closed for high-risk operation
```

---

## 9. Version Stamps: The Scalable Correctness Primitive

Version stamp is one of the most powerful patterns for authorization caching.

Instead of asking:

```text
Did every cache node delete every affected key?
```

Ask:

```text
Does this decision input include current version numbers?
```

Example:

```java
public final class AuthorizationVersions {
    private final long policyVersion;
    private final long entitlementVersion;
    private final long relationshipVersion;
    private final long tenantVersion;
    private final long resourceVersion;
}
```

Decision log:

```json
{
  "subjectId": "u-123",
  "tenantId": "agency-cea",
  "action": "case.approve",
  "resource": "case:C-2026-001",
  "decision": "DENY",
  "policyVersion": 42,
  "entitlementVersion": 819,
  "relationshipVersion": 12003,
  "resourceVersion": 17
}
```

Benefits:

- cache correctness,
- audit reconstruction,
- policy rollback,
- shadow evaluation,
- decision diffing,
- debugging stale access.

---

## 10. Negative Decision Cache

Caching deny can improve performance, but has UX and correctness implications.

### 10.1 Why Cache Deny?

Deny often happens repeatedly:

- user clicks hidden endpoint,
- UI polls inaccessible resource,
- API client retries forbidden action,
- malicious probing.

Caching deny can reduce load.

### 10.2 Deny Cache Is Usually Safer Than Allow Cache

Stale deny usually causes temporary inconvenience.

Stale allow can cause unauthorized access.

But stale deny can still be problematic:

- user just got access but still denied,
- newly delegated officer cannot act,
- emergency access delayed.

### 10.3 Separate TTLs

Use shorter TTL for deny when entitlement might be newly granted.

Example:

```text
allow decision TTL: 5 seconds for low-risk read
allow decision TTL: 0 for high-risk mutation
deny decision TTL: 10-30 seconds for repeated invalid access
```

But this is domain-specific.

---

## 11. Bulk Authorization API

Many performance problems come from per-resource authorization calls.

Bad:

```java
List<CaseSummary> visible = new ArrayList<>();
for (CaseSummary c : cases) {
    if (authorizationService.canView(subject, c.id())) {
        visible.add(c);
    }
}
```

This can cause:

```text
N cases => N authorization calls => N queries => high latency
```

Better:

```java
Map<String, PolicyDecision> decisions = authorizationService.bulkAuthorize(
        subject,
        "case.read",
        cases.stream()
                .map(CaseSummary::id)
                .collect(Collectors.toList()),
        context
);
```

### 11.1 Bulk API Contract

```java
public interface AuthorizationService {
    PolicyDecision authorize(AuthorizationRequest request);

    Map<ResourceRef, PolicyDecision> bulkAuthorize(BulkAuthorizationRequest request);
}
```

### 11.2 Bulk Request

```java
public final class BulkAuthorizationRequest {
    private final SubjectRef subject;
    private final String tenantId;
    private final String action;
    private final String resourceType;
    private final List<ResourceRef> resources;
    private final AuthorizationContext context;
}
```

### 11.3 Bulk Implementation Pattern

```java
public Map<ResourceRef, PolicyDecision> bulkCanReadCases(BulkAuthorizationRequest request) {
    SubjectEntitlements entitlements = entitlementService.load(
            request.subject(),
            request.tenantId()
    );

    if (!entitlements.hasPermission("case.read")) {
        return denyAll(request.resources(), "MISSING_PERMISSION");
    }

    Map<String, CaseAuthorizationAttributes> attrsByCaseId =
            caseAttributeRepository.findAuthorizationAttributes(
                    request.tenantId(),
                    request.resources().stream()
                            .map(ResourceRef::id)
                            .collect(Collectors.toList())
            );

    Map<ResourceRef, PolicyDecision> decisions = new LinkedHashMap<>();
    for (ResourceRef resource : request.resources()) {
        CaseAuthorizationAttributes attrs = attrsByCaseId.get(resource.id());
        if (attrs == null) {
            decisions.put(resource, PolicyDecision.deny("NOT_FOUND_OR_NOT_VISIBLE"));
            continue;
        }

        if (!attrs.agencyId().equals(request.subject().agencyId())) {
            decisions.put(resource, PolicyDecision.deny("AGENCY_MISMATCH"));
            continue;
        }

        decisions.put(resource, PolicyDecision.allow("AGENCY_MATCH"));
    }

    return decisions;
}
```

### 11.4 Important Bulk Rule

Bulk authorization must preserve per-resource reason.

Do not return only:

```java
boolean allAllowed;
```

Better:

```text
resource A -> ALLOW
resource B -> DENY: AGENCY_MISMATCH
resource C -> DENY: SEALED_CASE
```

This is required for:

- audit,
- debugging,
- partial failure,
- safe UI rendering,
- export filtering.

---

## 12. Query Scoping vs Decision Caching

For list/search/export, query scoping is often better than decision caching.

Bad pattern:

```text
Fetch all rows -> check each row -> remove unauthorized rows
```

Problems:

- memory waste,
- latency,
- count leakage,
- pagination wrong,
- export leak risk,
- accidental logging of unauthorized data.

Better:

```text
Authorization predicate -> database query -> only authorized rows returned
```

Example:

```java
public Specification<CaseEntity> visibleCases(Subject subject, String tenantId) {
    return (root, query, cb) -> cb.and(
            cb.equal(root.get("tenantId"), tenantId),
            cb.equal(root.get("agencyId"), subject.agencyId()),
            cb.isFalse(root.get("sealed"))
    );
}
```

Then:

```java
Specification<CaseEntity> spec = Specification
        .where(caseFilters.fromRequest(request))
        .and(caseAuthorizationSpecs.visibleCases(subject, tenantId));

Page<CaseEntity> page = caseRepository.findAll(spec, pageable);
```

This avoids per-row final decision for many cases.

But query scoping is not enough for mutation.

For mutation:

```text
Load resource in transaction with tenant/resource constraints
+ evaluate action-specific guard
+ perform mutation
+ audit decision
```

---

## 13. Caching in Spring Security AuthorizationManager

Spring Security’s modern architecture centers around `AuthorizationManager` for request, method, and message authorization. That does not mean Spring automatically solves domain authorization caching for you.

You can wrap expensive inputs behind cache-aware services.

Example:

```java
public final class PermissionAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final EntitlementService entitlementService;
    private final String requiredPermission;

    public PermissionAuthorizationManager(
            EntitlementService entitlementService,
            String requiredPermission
    ) {
        this.entitlementService = entitlementService;
        this.requiredPermission = requiredPermission;
    }

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext context
    ) {
        Authentication auth = authentication.get();
        SubjectRef subject = SubjectRef.from(auth);
        String tenantId = TenantContext.requiredTenantId();

        SubjectEntitlements entitlements = entitlementService.loadCached(
                subject,
                tenantId
        );

        return new AuthorizationDecision(
                entitlements.hasPermission(requiredPermission)
        );
    }
}
```

Caveat:

- request-level authorization usually lacks resource state,
- do not let route-level cached allow replace service/domain check,
- include tenant/mode/version in entitlement cache,
- for object-level mutation, re-check at service/domain layer.

---

## 14. Java 8 to Java 25 Considerations

Authorization caching can be implemented across Java 8–25, but platform features change ergonomics.

### 14.1 Java 8 Baseline

Use:

- `ConcurrentHashMap`,
- immutable classes,
- explicit `equals/hashCode`,
- `CompletableFuture` carefully,
- servlet thread-local context carefully.

Example minimal TTL cache:

```java
public final class SimpleTtlCache<K, V> {
    private final ConcurrentHashMap<K, Entry<V>> map = new ConcurrentHashMap<>();
    private final long ttlMillis;

    public SimpleTtlCache(long ttlMillis) {
        if (ttlMillis <= 0) {
            throw new IllegalArgumentException("ttlMillis must be positive");
        }
        this.ttlMillis = ttlMillis;
    }

    public V get(K key, Supplier<V> loader) {
        long now = System.currentTimeMillis();
        Entry<V> existing = map.get(key);
        if (existing != null && existing.expiresAtMillis > now) {
            return existing.value;
        }

        Entry<V> loaded = new Entry<V>(loader.get(), now + ttlMillis);
        map.put(key, loaded);
        return loaded.value;
    }

    public void invalidate(K key) {
        map.remove(key);
    }

    public void clear() {
        map.clear();
    }

    private static final class Entry<V> {
        private final V value;
        private final long expiresAtMillis;

        private Entry(V value, long expiresAtMillis) {
            this.value = value;
            this.expiresAtMillis = expiresAtMillis;
        }
    }
}
```

This is okay for learning/simple apps, but production systems should use mature cache libraries or infrastructure.

### 14.2 Java 16+ Records

For Java 16+:

```java
public record EntitlementCacheKey(
        String subjectId,
        String tenantId,
        String actorMode,
        long entitlementVersion
) {}
```

Records reduce boilerplate and make cache keys safer.

### 14.3 Java 17+ Sealed Types

Decision model can use sealed types:

```java
public sealed interface PolicyDecision permits Allow, Deny, Indeterminate {}

public record Allow(String reasonCode) implements PolicyDecision {}
public record Deny(String reasonCode) implements PolicyDecision {}
public record Indeterminate(String reasonCode, Throwable cause) implements PolicyDecision {}
```

This avoids boolean blindness.

### 14.4 Java 21+ Virtual Threads

Virtual threads help with blocking IO scalability, but do not fix bad authorization architecture.

They can reduce thread exhaustion when authorization calls remote PDP or database, but:

- N+1 decisions still hurt database/PDP,
- cache stampede still hurts,
- stale cache is still security risk,
- ThreadLocal context propagation needs care.

### 14.5 Java 25 View

For Java 25-era systems, expect more structured, observable, concurrent applications. But authorization correctness still depends on:

- immutable request context,
- explicit decision model,
- versioned inputs,
- safe cache keys,
- auditable decisions.

Language/runtime improvements do not replace security design.

---

## 15. Cache Stampede and Single-Flight Loading

If many requests miss cache simultaneously, all may load the same entitlement/policy/resource data.

This is cache stampede.

Example:

```text
1000 requests for same subject after entitlement cache expires
=> 1000 DB queries
```

Pattern: single-flight loading.

In Java 8:

```java
public final class SingleFlightCache<K, V> {
    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();

    public V get(K key, Supplier<V> loader) {
        CompletableFuture<V> future = inFlight.computeIfAbsent(key, k ->
                CompletableFuture.supplyAsync(() -> {
                    try {
                        return loader.get();
                    } finally {
                        inFlight.remove(k);
                    }
                })
        );

        try {
            return future.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Interrupted while loading cache value", e);
        } catch (ExecutionException e) {
            throw new RuntimeException("Failed to load cache value", e.getCause());
        }
    }
}
```

Production improvement:

- use bounded executor,
- timeout,
- cancellation handling,
- metrics,
- do not use common pool blindly,
- avoid unbounded in-flight map.

---

## 16. Cache Invalidation Event Design

Invalidation events must be precise enough to avoid full cache flush for every change.

Bad:

```json
{
  "type": "AUTH_CHANGED"
}
```

This forces broad invalidation.

Better:

```json
{
  "eventId": "evt-123",
  "type": "USER_ROLE_CHANGED",
  "tenantId": "agency-cea",
  "subjectId": "u-123",
  "entitlementVersion": 820,
  "occurredAt": "2026-06-19T10:00:00Z"
}
```

For resource assignment:

```json
{
  "eventId": "evt-456",
  "type": "CASE_ASSIGNMENT_CHANGED",
  "tenantId": "agency-cea",
  "resourceType": "case",
  "resourceId": "C-2026-001",
  "resourceVersion": 18,
  "relationshipVersion": 12004
}
```

Event consumers should be idempotent.

```java
public void handle(AuthorizationInvalidationEvent event) {
    if (processedEventStore.alreadyProcessed(event.eventId())) {
        return;
    }

    switch (event.type()) {
        case "USER_ROLE_CHANGED":
            entitlementCache.invalidateSubject(event.tenantId(), event.subjectId());
            break;
        case "POLICY_PUBLISHED":
            policyCache.activateVersion(event.policyVersion());
            decisionCache.clear();
            break;
        case "CASE_ASSIGNMENT_CHANGED":
            resourceAttributeCache.invalidate(event.resourceType(), event.resourceId());
            relationshipCache.invalidateResource(event.resourceType(), event.resourceId());
            break;
        default:
            safeBroadInvalidation(event);
    }

    processedEventStore.markProcessed(event.eventId());
}
```

---

## 17. Revocation Delay Budget

Every cached authorization system has a revocation delay.

Even if you do not document it, it exists.

Define explicitly:

```text
Revocation delay = maximum time after access is revoked during which old access might still be accepted.
```

For each permission/action, define acceptable delay.

| Action | Max Revocation Delay | Reason |
|---|---:|---|
| View low-risk list | 30s | acceptable stale UI |
| View sensitive record | 5s or request-local only | privacy risk |
| Export report | 0s / re-check | bulk data risk |
| Approve case | 0s / transaction check | irreversible state change |
| Break-glass access | 0s / re-check | emergency privilege |
| Admin role grant/revoke | near-zero | privilege escalation risk |

If the business cannot tolerate stale allow, do not use cross-request allow decision cache.

---

## 18. Final Mutation Guard Pattern

For important mutations, use final guard inside transaction.

Pattern:

```text
1. Begin transaction
2. Load resource row with tenant scope and lock/version
3. Load current authorization inputs or versions
4. Evaluate decision
5. If deny -> rollback and audit deny
6. Mutate
7. Commit
8. Audit allow with versions
```

Example:

```java
@Transactional
public void approveCase(String caseId, ApproveCommand command) {
    Subject subject = securityContext.currentSubject();
    String tenantId = tenantContext.requiredTenantId();

    CaseEntity entity = caseRepository.findForUpdateByTenantAndId(tenantId, caseId)
            .orElseThrow(() -> new NotFoundException("Case not found"));

    AuthorizationRequest authz = AuthorizationRequest.builder()
            .subject(subject)
            .tenantId(tenantId)
            .action("case.approve")
            .resource(ResourceRef.of("case", entity.getId(), entity.getVersion()))
            .resourceAttributes(CaseAuthorizationAttributes.from(entity))
            .context(authorizationContextFactory.current())
            .build();

    PolicyDecision decision = authorizationService.authorizeFresh(authz);

    if (!decision.isAllowed()) {
        auditAuthorizationDeny(authz, decision);
        throw new AccessDeniedException(decision.primaryReasonCode());
    }

    entity.approve(subject.id(), command.reason());
    auditAuthorizationAllow(authz, decision);
}
```

Important:

```text
authorizeFresh means no cross-request final decision cache for this mutation.
```

It may still use cached stable inputs like permission catalog, but not stale final allow.

---

## 19. Decision Cache vs Entitlement Cache

Many systems over-cache final decisions when they should cache entitlements.

### 19.1 Better Pattern

Cache:

```text
subject entitlements
role hierarchy
policy bundle
```

Do not cache:

```text
canApprove(caseId)
```

Then evaluate final decision cheaply in memory using current resource state.

Example:

```java
public PolicyDecision canApproveCase(
        SubjectEntitlements entitlements,
        CaseAuthorizationAttributes caseAttrs,
        AuthorizationContext ctx
) {
    if (!entitlements.hasPermission("case.approve")) {
        return PolicyDecision.deny("MISSING_PERMISSION");
    }
    if (!caseAttrs.tenantId().equals(ctx.tenantId())) {
        return PolicyDecision.deny("TENANT_MISMATCH");
    }
    if (!"SUBMITTED".equals(caseAttrs.state())) {
        return PolicyDecision.deny("INVALID_STATE");
    }
    if (caseAttrs.submittedBy().equals(ctx.subjectId())) {
        return PolicyDecision.deny("MAKER_CHECKER_VIOLATION");
    }
    return PolicyDecision.allow("APPROVER_ALLOWED");
}
```

This is fast without unsafe final-decision caching.

---

## 20. Distributed Cache Considerations

Authorization cache may be:

- local in-memory,
- distributed Redis/Hazelcast/Infinispan,
- database materialized table,
- sidecar policy cache,
- gateway cache.

### 20.1 Local Cache

Pros:

- low latency,
- no network hop,
- simple failure mode.

Cons:

- each node has its own stale values,
- invalidation fan-out needed,
- memory duplication.

Use for:

- permission catalog,
- policy bundle,
- role hierarchy,
- short TTL entitlements.

### 20.2 Distributed Cache

Pros:

- shared state,
- centralized invalidation,
- useful across nodes.

Cons:

- network latency,
- cache outage becomes authorization dependency,
- serialization/versioning issues,
- tenant isolation risk,
- operational complexity.

Use for:

- effective entitlements,
- policy data,
- relationship expansion,
- expensive derived authorization inputs.

Avoid using distributed cache as unquestioned truth for high-risk final allow decisions.

### 20.3 Materialized Authorization Table

For large systems, effective permissions may be materialized.

Example table:

```sql
CREATE TABLE subject_effective_permission (
    tenant_id              VARCHAR(64)  NOT NULL,
    subject_id             VARCHAR(64)  NOT NULL,
    actor_mode             VARCHAR(32)  NOT NULL,
    permission_code        VARCHAR(128) NOT NULL,
    scope_type             VARCHAR(64)  NOT NULL,
    scope_id               VARCHAR(128) NOT NULL,
    entitlement_version    BIGINT       NOT NULL,
    valid_from             TIMESTAMP    NOT NULL,
    valid_until            TIMESTAMP    NULL,
    PRIMARY KEY (tenant_id, subject_id, actor_mode, permission_code, scope_type, scope_id)
);
```

Pros:

- fast query,
- inspectable,
- auditable,
- scalable for read-heavy systems.

Cons:

- update complexity,
- eventual consistency,
- revocation delay,
- backfill/rebuild needed,
- scope explosion.

---

## 21. Authorization Cache and Audit

Caching must not remove auditability.

Every important decision should log:

```text
subject
actor mode
tenant
action
resource
result
reason code
policy version
entitlement version
relationship version
resource version
cache hit/miss
cache source
context fingerprint
correlation id
```

Example:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decisionId": "authz-20260619-0001",
  "subjectId": "u-123",
  "actorMode": "SELF",
  "tenantId": "agency-cea",
  "action": "case.approve",
  "resourceType": "case",
  "resourceId": "C-2026-001",
  "decision": "DENY",
  "reasonCode": "MAKER_CHECKER_VIOLATION",
  "policyVersion": 42,
  "entitlementVersion": 820,
  "resourceVersion": 18,
  "cache": {
    "entitlements": "HIT",
    "resourceAttributes": "BYPASS_FOR_MUTATION",
    "finalDecision": "NOT_USED"
  },
  "correlationId": "req-abc"
}
```

This is critical for regulatory systems.

If you cannot explain why stale allow happened, your cache design is not production-ready.

---

## 22. Metrics for Authorization Performance

Measure authorization as its own subsystem.

Metrics:

```text
authorization.decision.count
authorization.decision.latency
authorization.decision.allow.count
authorization.decision.deny.count
authorization.decision.indeterminate.count
authorization.cache.hit.count
authorization.cache.miss.count
authorization.cache.stale_rejected.count
authorization.cache.invalidation.count
authorization.cache.load.latency
authorization.bulk.size
authorization.policy.version
authorization.entitlement.version
authorization.revocation.delay.observed
authorization.pdp.timeout.count
authorization.fail_closed.count
```

Recommended dimensions:

- action,
- resource type,
- tenant,
- decision,
- reason code,
- policy version,
- cache type.

Be careful:

```text
Do not put high-cardinality userId/resourceId as metric labels.
```

Use logs/traces for exact IDs.

---

## 23. Benchmarking Authorization

Benchmark not only average latency.

Measure:

- p50,
- p90,
- p95,
- p99,
- p99.9,
- DB query count,
- cache hit ratio,
- remote PDP latency,
- authorization decisions per request,
- allocation rate,
- lock contention,
- GC impact,
- failure behavior.

### 23.1 Example Performance Budget

```text
Route-level permission check:         < 1 ms local
Entitlement cache load hit:           < 1 ms
Entitlement DB load miss:             5-30 ms
Resource attribute query:             2-20 ms
External PDP local sidecar:           1-5 ms
External PDP remote network:          5-50+ ms
Bulk authorization 50 resources:      < 50 ms target
High-risk mutation final guard:       correctness over latency
```

These are not universal targets. They are thinking aids.

### 23.2 Test Case Matrix

Benchmark:

1. warm cache,
2. cold cache,
3. permission revoked,
4. policy version changed,
5. resource state changed,
6. high concurrency same subject,
7. high concurrency many subjects,
8. large org hierarchy,
9. bulk list 20/50/100 rows,
10. remote PDP timeout,
11. cache unavailable,
12. invalidation lag.

---

## 24. Failure Modes

### 24.1 Stale Allow

User still allowed after revoke.

Causes:

- TTL too long,
- no version key,
- invalidation missed,
- final decision cache used for mutation,
- token claim trusted as current entitlement.

Mitigation:

- short TTL,
- version stamps,
- mutation fresh check,
- event invalidation,
- deny high-risk stale decisions.

### 24.2 Stale Deny

User remains denied after grant.

Causes:

- deny cache TTL too long,
- event invalidation missed,
- role expansion cache stale.

Mitigation:

- shorter deny TTL,
- admin-triggered invalidation,
- self-service refresh,
- clear UX message.

### 24.3 Cross-Tenant Cache Leakage

User sees another tenant’s decision/data.

Causes:

- tenant not in cache key,
- shared cache key namespace,
- serialized object missing tenant,
- ThreadLocal tenant leak.

Mitigation:

- tenant in every key,
- tenant-aware cache namespace,
- validation on read,
- tests for tenant cache isolation.

### 24.4 Actor Mode Confusion

Self access and delegated/impersonated access share cache.

Causes:

- actor mode not in key,
- effective permissions merged incorrectly.

Mitigation:

- actor mode in key,
- separate entitlements per acting capacity,
- audit actual actor and effective subject.

### 24.5 Policy Version Drift

Different nodes evaluate different policy versions.

Causes:

- non-atomic policy rollout,
- partial sidecar update,
- failed reload.

Mitigation:

- policy version in decision,
- canary rollout,
- version pinning,
- reject unknown policy version for high-risk action,
- monitoring active policy version per node.

### 24.6 Cache Stampede

Massive load after expiry.

Mitigation:

- jitter TTL,
- single-flight,
- prewarm critical entries,
- bounded loader concurrency,
- request-local memoization.

### 24.7 Fail Open During Cache/PDP Outage

Authorization allows because dependency fails.

Mitigation:

- fail closed for protected actions,
- narrow fallback only for known low-risk read,
- emergency mode explicitly controlled,
- alert on indeterminate.

---

## 25. Security Rules for Authorization Cache

Use these as hard rules.

### Rule 1 — Never Cache Without Tenant Boundary

Every authorization cache key in multi-tenant systems must include tenant or equivalent boundary.

### Rule 2 — Never Let Cached Route Allow Replace Object Guard

Route-level allow is not object-level allow.

### Rule 3 — Prefer Caching Inputs Over Final Decisions

Cache entitlements/policy/resource metadata where safe. Evaluate final decision fresh when possible.

### Rule 4 — High-Risk Mutation Needs Fresh Final Guard

Approve, reject, export, delete, assign, break-glass, impersonate, and admin changes should not rely on stale final decision cache.

### Rule 5 — Decision Logs Must Include Versions

If you cache and cannot reconstruct the versions used, your audit is weak.

### Rule 6 — Cache Key Must Include Actor Mode

Self, delegated, impersonated, service-account, and break-glass modes must not share cache.

### Rule 7 — Unknown or Stale Critical Input Must Deny or Indeterminate

Do not silently allow because cache is missing or dependency is down.

### Rule 8 — TTL Is Not Governance

TTL reduces stale duration. It does not prove correctness.

---

## 26. Practical Architecture Blueprint

For a serious Java enterprise system:

```text
Request
  -> Authentication already resolved
  -> TenantContext resolved
  -> AuthorizationRequestContext created
  -> Request-local memoization starts
  -> Route-level PEP checks coarse permission
  -> Service method starts
  -> Load entitlements from local/distributed cache using versioned key
  -> Query resource with tenant scoping
  -> For reads/list: apply authorization predicate in query
  -> For mutation: final guard inside transaction using fresh resource state
  -> Evaluate policy using cached stable inputs + fresh volatile inputs
  -> Emit audit event with versions and cache hit/miss
  -> Return allowed result or denial
```

### Suggested Cache Layers

```text
L0 request-local memoization
L1 local in-memory cache
L2 distributed cache/materialized entitlement table
Source of truth database/policy repository/relationship store
```

### Suggested Use

| Layer | Use |
|---|---|
| L0 request-local | repeated checks in same request |
| L1 local | permission catalog, policy bundle, role hierarchy |
| L2 distributed | effective entitlements, relationship expansion |
| DB/source | final mutation state, authoritative revocation, audit |

---

## 27. Example End-to-End Java Design

### 27.1 Decision Model

```java
public final class PolicyDecision {
    public enum Effect {
        ALLOW,
        DENY,
        INDETERMINATE
    }

    private final Effect effect;
    private final String reasonCode;
    private final AuthorizationEvidence evidence;

    private PolicyDecision(Effect effect, String reasonCode, AuthorizationEvidence evidence) {
        this.effect = effect;
        this.reasonCode = reasonCode;
        this.evidence = evidence;
    }

    public static PolicyDecision allow(String reasonCode, AuthorizationEvidence evidence) {
        return new PolicyDecision(Effect.ALLOW, reasonCode, evidence);
    }

    public static PolicyDecision deny(String reasonCode, AuthorizationEvidence evidence) {
        return new PolicyDecision(Effect.DENY, reasonCode, evidence);
    }

    public static PolicyDecision indeterminate(String reasonCode, AuthorizationEvidence evidence) {
        return new PolicyDecision(Effect.INDETERMINATE, reasonCode, evidence);
    }

    public boolean isAllowed() {
        return effect == Effect.ALLOW;
    }

    public Effect effect() {
        return effect;
    }

    public String reasonCode() {
        return reasonCode;
    }

    public AuthorizationEvidence evidence() {
        return evidence;
    }
}
```

### 27.2 Evidence Model

```java
public final class AuthorizationEvidence {
    private final long policyVersion;
    private final long entitlementVersion;
    private final Long relationshipVersion;
    private final Long resourceVersion;
    private final boolean entitlementCacheHit;
    private final boolean decisionCacheHit;

    public AuthorizationEvidence(
            long policyVersion,
            long entitlementVersion,
            Long relationshipVersion,
            Long resourceVersion,
            boolean entitlementCacheHit,
            boolean decisionCacheHit
    ) {
        this.policyVersion = policyVersion;
        this.entitlementVersion = entitlementVersion;
        this.relationshipVersion = relationshipVersion;
        this.resourceVersion = resourceVersion;
        this.entitlementCacheHit = entitlementCacheHit;
        this.decisionCacheHit = decisionCacheHit;
    }
}
```

### 27.3 Authorization Service

```java
public final class CaseAuthorizationService {
    private final EntitlementService entitlementService;
    private final PolicyVersionProvider policyVersionProvider;

    public PolicyDecision canReadCase(
            Subject subject,
            String tenantId,
            CaseAuthorizationAttributes attrs,
            AuthorizationContext ctx
    ) {
        CachedValue<SubjectEntitlements> cachedEntitlements =
                entitlementService.loadCached(subject, tenantId, ctx.actorMode());

        SubjectEntitlements entitlements = cachedEntitlements.value();
        long policyVersion = policyVersionProvider.currentVersion();

        AuthorizationEvidence evidence = new AuthorizationEvidence(
                policyVersion,
                entitlements.entitlementVersion(),
                null,
                attrs.version(),
                cachedEntitlements.cacheHit(),
                false
        );

        if (!entitlements.hasPermission("case.read")) {
            return PolicyDecision.deny("MISSING_PERMISSION", evidence);
        }
        if (!tenantId.equals(attrs.tenantId())) {
            return PolicyDecision.deny("TENANT_MISMATCH", evidence);
        }
        if (!subject.agencyId().equals(attrs.agencyId())) {
            return PolicyDecision.deny("AGENCY_MISMATCH", evidence);
        }
        if (attrs.sealed() && !entitlements.hasPermission("case.read.sealed")) {
            return PolicyDecision.deny("SEALED_CASE", evidence);
        }
        return PolicyDecision.allow("CASE_VISIBLE", evidence);
    }
}
```

This design caches entitlements but still evaluates resource-specific decision using current resource attributes.

---

## 28. Checklist: Production Authorization Cache Review

Before approving authorization cache design, ask:

1. What exactly is cached?
2. Is it input cache or final decision cache?
3. What is the cache key?
4. Does the key include tenant?
5. Does the key include actor mode?
6. Does the key include policy version?
7. Does the key include entitlement version?
8. Does the key include resource version when needed?
9. Does the key include context fingerprint when context matters?
10. What is TTL?
11. What is max revocation delay?
12. Is stale allow acceptable?
13. Which actions bypass final decision cache?
14. How is invalidation triggered?
15. Are invalidation events idempotent?
16. What happens if invalidation is missed?
17. What happens if cache is down?
18. What happens if PDP is down?
19. Is deny cached separately from allow?
20. Is audit logging recording cache hit/miss and versions?
21. Are high-cardinality metrics avoided?
22. Are tenant isolation tests present?
23. Are role revocation tests present?
24. Are policy deployment tests present?
25. Are mutation guards fresh?
26. Is request-local memoization used before distributed caching?
27. Is there protection against cache stampede?
28. Is there a rollback plan for policy/cache bug?
29. Can historical decisions be reconstructed?
30. Is the design understandable by security, ops, and auditors?

---

## 29. Top 1% Insight

Most engineers think authorization performance is solved by caching decisions.

Better engineers know that final decision caching is often the most dangerous optimization.

Top-tier engineers separate authorization into:

```text
stable inputs       -> cache aggressively with versioning
volatile inputs     -> cache carefully or request-locally
final decisions     -> cache only when the stale-allow risk is explicitly accepted
high-risk mutations -> fresh guard inside transaction
```

They do not ask:

```text
How do we make authorization fast?
```

They ask:

```text
Which part of authorization is stable enough to reuse,
which part must be fresh,
what stale result can harm the business,
and how do we prove which version of truth was used?
```

That is the difference between performance tuning and security engineering.

---

## 30. Summary

Di bagian ini kita mempelajari:

- authorization cache adalah security-sensitive optimization,
- cost model authorization,
- jenis cache authorization,
- request-local memoization,
- cache key correctness,
- TTL strategy,
- invalidation strategy,
- version stamps,
- negative decision cache,
- bulk authorization API,
- query scoping,
- Spring Security integration,
- Java 8–25 implications,
- cache stampede,
- revocation delay budget,
- final mutation guard,
- distributed cache trade-off,
- audit dan metrics,
- failure modes,
- production checklist.

Prinsip utama:

```text
Cache authorization inputs more than final decisions.
Version everything important.
Never let cache erase tenant, actor mode, resource state, or policy version.
For high-risk mutation, check fresh inside the transaction.
```

---

## 31. References

- Spring Security Reference — Authorization Architecture: `https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html`
- OWASP Authorization Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html`
- OWASP Broken Access Control: `https://owasp.org/www-community/Broken_Access_Control`
- OWASP API Security 2023 — Broken Object Level Authorization: `https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/`
- Open Policy Agent Documentation: `https://openpolicyagent.org/docs`
- Caffeine Cache Eviction Documentation: `https://github.com/ben-manes/caffeine/wiki/Eviction`
- Java Platform Documentation: `https://docs.oracle.com/en/java/`

---

## 32. Status Seri

Selesai:

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

Belum selesai. Berikutnya:

- Part 26 — Authorization Failure Semantics and Error Handling


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-024.md">⬅️ Learn Java Authorization Modes and Patterns — Part 24</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-026.md">Java Authorization Modes and Patterns — Advanced Engineering ➡️</a>
</div>
