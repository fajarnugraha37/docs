# Java Authorization Modes and Patterns — Advanced Engineering
## Part 30 — Designing an Authorization Domain Model in Java

> Seri: `learn-java-authorization-modes-and-patterns`  
> File: `learn-java-authorization-modes-and-patterns-part-030.md`  
> Target pembaca: Java engineer yang ingin mampu mendesain authorization domain model yang aman, eksplisit, testable, audit-ready, dan evolvable dari Java 8 sampai Java 25.  
> Fokus: model kode dan struktur domain authorization, bukan konfigurasi framework semata.

---

## 0. Posisi Part Ini Dalam Seri

Sampai part sebelumnya, kita sudah membahas authorization dari banyak sisi:

- mental model,
- vocabulary,
- Java platform primitive,
- PEP/PDP/PAP/PIP,
- RBAC,
- permission/capability,
- ABAC,
- PBAC,
- ReBAC,
- ACL,
- tenancy,
- IDOR/BOLA,
- layered authorization,
- Spring/Jakarta,
- API/messaging,
- query scoping,
- workflow/state machine,
- delegation/break-glass,
- org hierarchy,
- contextual/risk-based access,
- microservices,
- token boundary,
- caching/performance,
- failure semantics,
- auditability,
- testing,
- anti-patterns.

Part ini mulai mengubah semua itu menjadi **model Java internal**.

Tujuannya bukan membuat library authorization generic yang terlalu abstrak. Tujuannya adalah membangun **domain model authorization** yang cukup kuat untuk menjawab pertanyaan seperti:

```text
Apakah subject S boleh melakukan action A terhadap resource R dalam context C,
berdasarkan policy P, data relationship D, entitlement E, state W,
dan constraint temporal/risk/tenant yang berlaku saat ini?
```

Dengan model yang baik, authorization tidak tersebar sebagai string acak seperti:

```java
if (user.isAdmin() || user.getRole().equals("CASE_MANAGER")) {
    // allow
}
```

Tetapi menjadi keputusan eksplisit:

```java
AuthorizationDecision decision = authorizationService.authorize(
    AuthorizationRequest.of(
        subject,
        Action.named("case.approve"),
        ResourceRef.of("case", caseId),
        context
    )
);

decision.throwIfDenied();
```

Perbedaannya besar:

| Desain lemah | Desain matang |
|---|---|
| Boolean tersebar | Decision object eksplisit |
| Role string acak | Action/resource typed vocabulary |
| Denial tanpa alasan | Reason code dan evidence |
| Sulit audit | Decision trace bisa direkonstruksi |
| Sulit test | Golden decision test bisa dibuat |
| Banyak bypass | Enforcement point konsisten |
| Tidak bisa evolve | Policy composition bisa bertumbuh |

---

## 1. Mental Model: Authorization Domain Model Adalah Bahasa Keputusan

Authorization domain model bukan sekadar class `Permission`. Ia adalah **bahasa internal** yang dipakai sistem untuk mengekspresikan keputusan akses.

Minimal, bahasa itu harus dapat menyatakan:

```text
Subject       = siapa/apa yang meminta akses
Action        = operasi apa yang ingin dilakukan
Resource      = target operasi
Context       = kondisi saat request dibuat
Policy        = aturan yang mengevaluasi request
Decision      = hasil evaluasi
Reason        = kenapa hasilnya begitu
Evidence      = data apa yang mendukung keputusan
Obligation    = syarat tambahan yang harus dipenuhi saat allow
```

Dalam bentuk formula:

```text
Decision = f(Subject, Action, Resource, Context, PolicyData)
```

Tetapi dalam sistem enterprise, formula ini sering lebih kaya:

```text
Decision = combine(
  globalDenyPolicy,
  tenantBoundaryPolicy,
  rolePolicy,
  permissionPolicy,
  relationshipPolicy,
  resourceStatePolicy,
  workflowPolicy,
  contextualRiskPolicy,
  delegationPolicy,
  breakGlassPolicy
)
```

Karena itu domain model harus mendukung:

1. **type safety**,
2. **composability**,
3. **auditability**,
4. **testability**,
5. **framework independence**,
6. **migration path dari Java 8 ke Java modern**.

Framework seperti Spring Security punya `AuthorizationManager` sebagai abstraction untuk authorization decision, dan ini sangat berguna sebagai adapter. Tetapi domain authorization internal sebaiknya tidak bergantung total pada framework class supaya tetap bisa dipakai di batch job, Kafka consumer, gRPC interceptor, workflow engine, CLI, internal service, atau Jakarta EE runtime.

---

## 2. Prinsip Desain Utama

### 2.1 Deny by Default

Default harus deny, bukan allow.

Rule penting:

```text
Tidak ada policy yang memahami request => deny.
Tidak cukup data untuk membuktikan allow => deny atau indeterminate-to-deny.
Policy konflik => gunakan combiner eksplisit, bukan kebetulan ordering.
```

Jangan membuat desain seperti ini:

```java
boolean allowed = true;

if (requiresAdmin(action)) {
    allowed = user.isAdmin();
}

return allowed;
```

Masalahnya: action baru yang belum dikenal bisa lolos.

Lebih aman:

```java
AuthorizationDecision decision = policy.evaluate(request);

if (decision.isNotApplicable()) {
    return AuthorizationDecision.denied("NO_APPLICABLE_POLICY");
}

return decision;
```

### 2.2 Explicit Is Better Than Implicit

Jangan menyembunyikan authorization di helper yang tidak jelas:

```java
if (SecurityUtils.ok(user, caseEntity)) { ... }
```

Lebih baik:

```java
AuthorizationRequest request = AuthorizationRequest.builder()
    .subject(subject)
    .action(CaseActions.APPROVE)
    .resource(ResourceRef.caseRef(caseId))
    .context(context)
    .build();

AuthorizationDecision decision = authorizationService.authorize(request);
```

### 2.3 Authorization Decision Bukan Boolean

Boolean hanya menjawab `true/false`. Sistem enterprise butuh lebih dari itu:

```text
allowed?
why?
which policy decided?
which data was used?
what obligation must be enforced?
is this deny security-sensitive or business-state denial?
can it be shown to user?
should it be audited?
```

Karena itu gunakan decision object.

### 2.4 Model Harus Bisa Dipakai di Banyak Enforcement Point

Satu domain model authorization harus bisa dipakai oleh:

- REST controller,
- Spring method security,
- service command handler,
- repository query scoping,
- GraphQL resolver,
- gRPC interceptor,
- Kafka/JMS/RabbitMQ consumer,
- scheduled job,
- workflow transition guard,
- export/report generation,
- admin console,
- break-glass access flow.

Kalau model authorization hanya bisa dipakai oleh `@PreAuthorize`, maka ia terlalu framework-specific.

### 2.5 Model Harus Audit-Ready

Setiap decision sebaiknya bisa disimpan dalam bentuk audit event:

```json
{
  "decisionId": "...",
  "subject": "user:123",
  "action": "case.approve",
  "resource": "case:987",
  "tenant": "agency:CEA",
  "decision": "DENY",
  "reasonCode": "MAKER_CHECKER_VIOLATION",
  "policyId": "case-approval-policy",
  "policyVersion": "2026-06-20.1",
  "correlationId": "..."
}
```

---

## 3. Core Type Set

Model minimal yang sehat:

```text
Subject
PrincipalRef
Action
ResourceType
ResourceRef
AuthorizationContext
AuthorizationRequest
AuthorizationDecision
DecisionEffect
DecisionReason
Policy
PolicyResult
DecisionCombiner
Obligation
Evidence
```

Tambahan untuk sistem kompleks:

```text
TenantRef
OrganizationRef
DelegationRef
RiskContext
WorkflowContext
DataScope
PolicyMetadata
DecisionTrace
```

---

## 4. Java 8-Compatible Foundation

Karena target seri adalah Java 8 sampai 25, kita mulai dari desain yang kompatibel dengan Java 8.

### 4.1 Value Object Pattern

Di Java 8, tidak ada records. Jadi gunakan immutable class.

```java
package com.example.authz.model;

import java.util.Objects;

public final class Action {
    private final String value;

    private Action(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("Action value must not be blank");
        }
        this.value = normalize(value);
    }

    public static Action named(String value) {
        return new Action(value);
    }

    public String value() {
        return value;
    }

    private static String normalize(String value) {
        return value.trim().toLowerCase();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Action)) return false;
        Action action = (Action) o;
        return value.equals(action.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }

    @Override
    public String toString() {
        return value;
    }
}
```

Kenapa bukan langsung `String`?

Karena `String` terlalu bebas:

```java
"case.aprove"     // typo
"CASE_APPROVE"    // inconsistent grammar
"approve-case"    // different naming convention
"admin"           // role disguised as action
```

Value object memberi tempat untuk:

- normalisasi,
- validasi grammar,
- factory method,
- registry,
- documentation,
- type safety.

### 4.2 Resource Type

```java
package com.example.authz.model;

import java.util.Objects;

public final class ResourceType {
    private final String value;

    private ResourceType(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("Resource type must not be blank");
        }
        this.value = value.trim().toLowerCase();
    }

    public static ResourceType named(String value) {
        return new ResourceType(value);
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ResourceType)) return false;
        ResourceType that = (ResourceType) o;
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }

    @Override
    public String toString() {
        return value;
    }
}
```

### 4.3 Resource Reference

Resource reference jangan selalu memuat entity penuh. Authorization sering perlu referensi ringan:

```java
package com.example.authz.model;

import java.util.Objects;

public final class ResourceRef {
    private final ResourceType type;
    private final String id;

    private ResourceRef(ResourceType type, String id) {
        this.type = Objects.requireNonNull(type, "type");
        if (id == null || id.trim().isEmpty()) {
            throw new IllegalArgumentException("Resource id must not be blank");
        }
        this.id = id.trim();
    }

    public static ResourceRef of(ResourceType type, String id) {
        return new ResourceRef(type, id);
    }

    public static ResourceRef of(String type, String id) {
        return new ResourceRef(ResourceType.named(type), id);
    }

    public ResourceType type() {
        return type;
    }

    public String id() {
        return id;
    }

    public String canonical() {
        return type.value() + ":" + id;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ResourceRef)) return false;
        ResourceRef that = (ResourceRef) o;
        return type.equals(that.type) && id.equals(that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(type, id);
    }

    @Override
    public String toString() {
        return canonical();
    }
}
```

### 4.4 PrincipalRef

Principal reference harus membedakan jenis principal:

```java
package com.example.authz.model;

import java.util.Objects;

public final class PrincipalRef {
    private final String kind; // user, service, system, anonymous, external
    private final String id;

    private PrincipalRef(String kind, String id) {
        if (kind == null || kind.trim().isEmpty()) {
            throw new IllegalArgumentException("Principal kind must not be blank");
        }
        if (id == null || id.trim().isEmpty()) {
            throw new IllegalArgumentException("Principal id must not be blank");
        }
        this.kind = kind.trim().toLowerCase();
        this.id = id.trim();
    }

    public static PrincipalRef user(String userId) {
        return new PrincipalRef("user", userId);
    }

    public static PrincipalRef service(String serviceId) {
        return new PrincipalRef("service", serviceId);
    }

    public static PrincipalRef system(String systemId) {
        return new PrincipalRef("system", systemId);
    }

    public String kind() {
        return kind;
    }

    public String id() {
        return id;
    }

    public String canonical() {
        return kind + ":" + id;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof PrincipalRef)) return false;
        PrincipalRef that = (PrincipalRef) o;
        return kind.equals(that.kind) && id.equals(that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(kind, id);
    }

    @Override
    public String toString() {
        return canonical();
    }
}
```

Kenapa penting?

Karena user dan service account tidak boleh diperlakukan sama:

```text
user:123 boleh approve case karena assigned officer.
service:event-syncer boleh publish event karena workload permission.
system:batch-retention boleh archive data karena scheduled retention policy.
```

Kalau semua hanya `String principalId`, confused deputy lebih mudah terjadi.

---

## 5. Subject: Principal Plus Effective Authority

Subject bukan hanya principal. Subject adalah representasi authorization dari peminta akses.

```java
package com.example.authz.model;

import java.util.Collections;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;

public final class Subject {
    private final PrincipalRef principal;
    private final Set<String> roles;
    private final Set<Action> permissions;
    private final String tenantId;
    private final boolean authenticated;

    private Subject(Builder builder) {
        this.principal = Objects.requireNonNull(builder.principal, "principal");
        this.roles = Collections.unmodifiableSet(new HashSet<String>(builder.roles));
        this.permissions = Collections.unmodifiableSet(new HashSet<Action>(builder.permissions));
        this.tenantId = builder.tenantId;
        this.authenticated = builder.authenticated;
    }

    public PrincipalRef principal() {
        return principal;
    }

    public Set<String> roles() {
        return roles;
    }

    public Set<Action> permissions() {
        return permissions;
    }

    public String tenantId() {
        return tenantId;
    }

    public boolean isAuthenticated() {
        return authenticated;
    }

    public boolean hasRole(String role) {
        return role != null && roles.contains(role.trim().toUpperCase());
    }

    public boolean hasPermission(Action action) {
        return permissions.contains(action);
    }

    public static Builder builder(PrincipalRef principal) {
        return new Builder(principal);
    }

    public static final class Builder {
        private final PrincipalRef principal;
        private final Set<String> roles = new HashSet<String>();
        private final Set<Action> permissions = new HashSet<Action>();
        private String tenantId;
        private boolean authenticated = true;

        private Builder(PrincipalRef principal) {
            this.principal = principal;
        }

        public Builder role(String role) {
            if (role != null && !role.trim().isEmpty()) {
                roles.add(role.trim().toUpperCase());
            }
            return this;
        }

        public Builder permission(Action permission) {
            if (permission != null) {
                permissions.add(permission);
            }
            return this;
        }

        public Builder tenantId(String tenantId) {
            this.tenantId = tenantId;
            return this;
        }

        public Builder authenticated(boolean authenticated) {
            this.authenticated = authenticated;
            return this;
        }

        public Subject build() {
            return new Subject(this);
        }
    }
}
```

Namun hati-hati: `Subject` jangan menjadi tempat semua data user.

Jangan masukkan:

- full profile,
- email personal jika tidak perlu,
- password state,
- seluruh organization tree,
- sensitive PII,
- huge entitlement graph.

Subject sebaiknya ringkas dan aman untuk audit.

---

## 6. Authorization Context

Context adalah kondisi saat request terjadi.

Contoh data context:

- tenant aktif,
- correlation ID,
- request ID,
- channel,
- client app,
- IP/network zone,
- device posture,
- time,
- risk score,
- assurance level,
- delegated actor,
- break-glass session,
- workflow state snapshot,
- jurisdiction,
- environment.

### 6.1 Java 8 Context Map yang Aman

```java
package com.example.authz.model;

import java.time.Instant;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

public final class AuthorizationContext {
    private final String tenantId;
    private final String correlationId;
    private final Instant requestTime;
    private final Map<String, Object> attributes;

    private AuthorizationContext(Builder builder) {
        this.tenantId = builder.tenantId;
        this.correlationId = builder.correlationId;
        this.requestTime = builder.requestTime == null ? Instant.now() : builder.requestTime;
        this.attributes = Collections.unmodifiableMap(new HashMap<String, Object>(builder.attributes));
    }

    public String tenantId() {
        return tenantId;
    }

    public String correlationId() {
        return correlationId;
    }

    public Instant requestTime() {
        return requestTime;
    }

    public Map<String, Object> attributes() {
        return attributes;
    }

    public Optional<Object> attribute(String key) {
        return Optional.ofNullable(attributes.get(key));
    }

    public Optional<String> stringAttribute(String key) {
        Object value = attributes.get(key);
        return value instanceof String ? Optional.of((String) value) : Optional.empty();
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String tenantId;
        private String correlationId;
        private Instant requestTime;
        private final Map<String, Object> attributes = new HashMap<String, Object>();

        public Builder tenantId(String tenantId) {
            this.tenantId = tenantId;
            return this;
        }

        public Builder correlationId(String correlationId) {
            this.correlationId = correlationId;
            return this;
        }

        public Builder requestTime(Instant requestTime) {
            this.requestTime = requestTime;
            return this;
        }

        public Builder attribute(String key, Object value) {
            Objects.requireNonNull(key, "key");
            if (value != null) {
                attributes.put(key, value);
            }
            return this;
        }

        public AuthorizationContext build() {
            return new AuthorizationContext(this);
        }
    }
}
```

### 6.2 Jangan Membuat Context Menjadi `Map` Liar

Map fleksibel, tetapi berbahaya bila semua policy bergantung pada string key tanpa kontrak.

Anti-pattern:

```java
if (ctx.get("risk").equals("low")) { ... }
if (ctx.get("RiskScore").equals("LOW")) { ... }
if (ctx.get("risk_score").equals(1)) { ... }
```

Lebih baik definisikan key konstan:

```java
public final class ContextKeys {
    private ContextKeys() {}

    public static final String CHANNEL = "channel";
    public static final String NETWORK_ZONE = "networkZone";
    public static final String RISK_LEVEL = "riskLevel";
    public static final String ASSURANCE_LEVEL = "assuranceLevel";
    public static final String DELEGATION_ID = "delegationId";
    public static final String BREAK_GLASS_SESSION_ID = "breakGlassSessionId";
}
```

Untuk domain yang lebih kompleks, buat typed sub-context:

```java
public final class RiskContext {
    private final String level;
    private final int score;
    private final Instant assessedAt;

    // constructor, getters, validation
}
```

---

## 7. Authorization Request

Authorization request harus immutable dan lengkap.

```java
package com.example.authz.model;

import java.util.Objects;

public final class AuthorizationRequest {
    private final Subject subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    private AuthorizationRequest(Builder builder) {
        this.subject = Objects.requireNonNull(builder.subject, "subject");
        this.action = Objects.requireNonNull(builder.action, "action");
        this.resource = Objects.requireNonNull(builder.resource, "resource");
        this.context = builder.context == null
            ? AuthorizationContext.builder().build()
            : builder.context;
    }

    public Subject subject() {
        return subject;
    }

    public Action action() {
        return action;
    }

    public ResourceRef resource() {
        return resource;
    }

    public AuthorizationContext context() {
        return context;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private Subject subject;
        private Action action;
        private ResourceRef resource;
        private AuthorizationContext context;

        public Builder subject(Subject subject) {
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

### 7.1 Why Not Pass Entity Directly?

Kadang policy perlu entity penuh:

```java
canApprove(user, caseEntity)
```

Tetapi request authorization sebaiknya tetap punya `ResourceRef`, lalu attribute/resource resolver bisa mengambil data yang dibutuhkan.

Kenapa?

1. Audit butuh stable resource reference.
2. Remote PDP biasanya tidak bisa menerima JPA entity.
3. Lazy loading entity bisa menyebabkan N+1.
4. Entity penuh bisa membawa data sensitif yang tidak perlu.
5. Policy should consume intentional attributes, not accidental object graph.

Solusi:

```java
AuthorizationRequest -> ResourceRef -> ResourceAttributeProvider -> ResourceAttributes
```

---

## 8. Decision Effect

Decision tidak cukup `ALLOW` dan `DENY`. Kita butuh beberapa state.

```java
package com.example.authz.model;

public enum DecisionEffect {
    ALLOW,
    DENY,
    NOT_APPLICABLE,
    INDETERMINATE
}
```

Makna:

| Effect | Arti |
|---|---|
| `ALLOW` | Policy secara eksplisit mengizinkan |
| `DENY` | Policy secara eksplisit menolak |
| `NOT_APPLICABLE` | Policy tidak relevan untuk request ini |
| `INDETERMINATE` | Policy gagal mengevaluasi karena error/missing data/ambiguity |

Final decision biasanya harus mengubah `NOT_APPLICABLE` dan `INDETERMINATE` menjadi deny.

```text
Final decision default:
ALLOW only if explicitly allowed and no stronger deny applies.
DENY otherwise.
```

---

## 9. Reason Code

Reason code adalah bahasa stabil untuk denial/audit/test.

```java
package com.example.authz.model;

import java.util.Objects;

public final class DecisionReason {
    private final String code;
    private final String message;
    private final boolean safeForUser;

    private DecisionReason(String code, String message, boolean safeForUser) {
        if (code == null || code.trim().isEmpty()) {
            throw new IllegalArgumentException("Reason code must not be blank");
        }
        this.code = code.trim().toUpperCase();
        this.message = message;
        this.safeForUser = safeForUser;
    }

    public static DecisionReason of(String code, String message, boolean safeForUser) {
        return new DecisionReason(code, message, safeForUser);
    }

    public String code() {
        return code;
    }

    public String message() {
        return message;
    }

    public boolean isSafeForUser() {
        return safeForUser;
    }

    @Override
    public String toString() {
        return code;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof DecisionReason)) return false;
        DecisionReason that = (DecisionReason) o;
        return code.equals(that.code);
    }

    @Override
    public int hashCode() {
        return Objects.hash(code);
    }
}
```

Contoh reason code:

```java
public final class ReasonCodes {
    private ReasonCodes() {}

    public static final DecisionReason ALLOWED_BY_PERMISSION =
        DecisionReason.of("ALLOWED_BY_PERMISSION", "Subject has required permission", false);

    public static final DecisionReason TENANT_MISMATCH =
        DecisionReason.of("TENANT_MISMATCH", "Resource belongs to another tenant", false);

    public static final DecisionReason NOT_ASSIGNED_OFFICER =
        DecisionReason.of("NOT_ASSIGNED_OFFICER", "Subject is not assigned to this case", true);

    public static final DecisionReason MAKER_CHECKER_VIOLATION =
        DecisionReason.of("MAKER_CHECKER_VIOLATION", "Submitter cannot approve own submission", true);

    public static final DecisionReason RESOURCE_STATE_NOT_ALLOWED =
        DecisionReason.of("RESOURCE_STATE_NOT_ALLOWED", "Action is not allowed in current resource state", true);

    public static final DecisionReason POLICY_ERROR =
        DecisionReason.of("POLICY_ERROR", "Authorization policy could not be evaluated", false);

    public static final DecisionReason NO_APPLICABLE_POLICY =
        DecisionReason.of("NO_APPLICABLE_POLICY", "No applicable authorization policy", false);
}
```

Rule:

```text
Reason code boleh masuk audit.
User message harus disaring dengan safeForUser.
Jangan membocorkan keberadaan resource sensitif lewat reason message.
```

---

## 10. Obligation

Obligation adalah syarat tambahan yang harus dilakukan enforcement point ketika decision allow.

Contoh:

```text
ALLOW, tetapi:
- mask field `nationalId`,
- require step-up authentication before final submission,
- record privileged access reason,
- add watermark to exported report,
- restrict download to read-only PDF,
- notify resource owner,
- limit result to assigned cases only.
```

Model:

```java
package com.example.authz.model;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public final class Obligation {
    private final String type;
    private final Map<String, Object> parameters;

    private Obligation(String type, Map<String, Object> parameters) {
        if (type == null || type.trim().isEmpty()) {
            throw new IllegalArgumentException("Obligation type must not be blank");
        }
        this.type = type.trim();
        this.parameters = Collections.unmodifiableMap(new HashMap<String, Object>(parameters));
    }

    public static Obligation of(String type) {
        return new Obligation(type, Collections.<String, Object>emptyMap());
    }

    public static Obligation of(String type, Map<String, Object> parameters) {
        return new Obligation(type, parameters == null ? Collections.<String, Object>emptyMap() : parameters);
    }

    public String type() {
        return type;
    }

    public Map<String, Object> parameters() {
        return parameters;
    }

    @Override
    public String toString() {
        return type + parameters;
    }
}
```

Obligation penting karena authorization tidak selalu binary.

Contoh:

```text
User boleh view case, tapi field tertentu harus masked.
User boleh export report, tapi harus watermark dan audit enhanced.
User boleh perform break-glass read, tapi harus provide reason dan notify supervisor.
```

Tanpa obligation, sistem sering membuat rule duplikat di UI/service/export.

---

## 11. Evidence

Evidence menjawab: data apa yang digunakan policy untuk mengambil keputusan?

```java
package com.example.authz.model;

import java.time.Instant;
import java.util.Objects;

public final class Evidence {
    private final String type;
    private final String reference;
    private final String summary;
    private final Instant observedAt;

    private Evidence(String type, String reference, String summary, Instant observedAt) {
        this.type = Objects.requireNonNull(type, "type");
        this.reference = reference;
        this.summary = summary;
        this.observedAt = observedAt == null ? Instant.now() : observedAt;
    }

    public static Evidence of(String type, String reference, String summary) {
        return new Evidence(type, reference, summary, Instant.now());
    }

    public String type() {
        return type;
    }

    public String reference() {
        return reference;
    }

    public String summary() {
        return summary;
    }

    public Instant observedAt() {
        return observedAt;
    }
}
```

Contoh evidence:

```java
Evidence.of("role", "role:CASE_REVIEWER", "Subject has reviewer role in agency CEA");
Evidence.of("assignment", "case:123:assignedOfficer", "Subject is assigned officer");
Evidence.of("workflow", "case:123:state", "Case state is SUBMITTED");
Evidence.of("delegation", "delegation:456", "Valid delegation from supervisor");
```

Evidence tidak harus selalu disimpan lengkap. Untuk high-volume path, simpan ringkas:

```text
policyId
policyVersion
reasonCode
evidence references
```

---

## 12. Authorization Decision Object

```java
package com.example.authz.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

public final class AuthorizationDecision {
    private final DecisionEffect effect;
    private final DecisionReason reason;
    private final String policyId;
    private final String policyVersion;
    private final List<Obligation> obligations;
    private final List<Evidence> evidence;

    private AuthorizationDecision(Builder builder) {
        this.effect = Objects.requireNonNull(builder.effect, "effect");
        this.reason = builder.reason;
        this.policyId = builder.policyId;
        this.policyVersion = builder.policyVersion;
        this.obligations = Collections.unmodifiableList(new ArrayList<Obligation>(builder.obligations));
        this.evidence = Collections.unmodifiableList(new ArrayList<Evidence>(builder.evidence));
    }

    public static AuthorizationDecision allow(DecisionReason reason) {
        return builder(DecisionEffect.ALLOW).reason(reason).build();
    }

    public static AuthorizationDecision deny(DecisionReason reason) {
        return builder(DecisionEffect.DENY).reason(reason).build();
    }

    public static AuthorizationDecision notApplicable() {
        return builder(DecisionEffect.NOT_APPLICABLE)
            .reason(ReasonCodes.NO_APPLICABLE_POLICY)
            .build();
    }

    public static AuthorizationDecision indeterminate(DecisionReason reason) {
        return builder(DecisionEffect.INDETERMINATE).reason(reason).build();
    }

    public static Builder builder(DecisionEffect effect) {
        return new Builder(effect);
    }

    public DecisionEffect effect() {
        return effect;
    }

    public boolean isAllowed() {
        return effect == DecisionEffect.ALLOW;
    }

    public boolean isDeniedLike() {
        return effect == DecisionEffect.DENY
            || effect == DecisionEffect.NOT_APPLICABLE
            || effect == DecisionEffect.INDETERMINATE;
    }

    public DecisionReason reason() {
        return reason;
    }

    public String policyId() {
        return policyId;
    }

    public String policyVersion() {
        return policyVersion;
    }

    public List<Obligation> obligations() {
        return obligations;
    }

    public List<Evidence> evidence() {
        return evidence;
    }

    public void throwIfDenied() {
        if (!isAllowed()) {
            throw new AuthorizationDeniedException(this);
        }
    }

    public static final class Builder {
        private final DecisionEffect effect;
        private DecisionReason reason;
        private String policyId;
        private String policyVersion;
        private final List<Obligation> obligations = new ArrayList<Obligation>();
        private final List<Evidence> evidence = new ArrayList<Evidence>();

        private Builder(DecisionEffect effect) {
            this.effect = effect;
        }

        public Builder reason(DecisionReason reason) {
            this.reason = reason;
            return this;
        }

        public Builder policy(String policyId, String policyVersion) {
            this.policyId = policyId;
            this.policyVersion = policyVersion;
            return this;
        }

        public Builder obligation(Obligation obligation) {
            if (obligation != null) {
                obligations.add(obligation);
            }
            return this;
        }

        public Builder evidence(Evidence item) {
            if (item != null) {
                evidence.add(item);
            }
            return this;
        }

        public AuthorizationDecision build() {
            return new AuthorizationDecision(this);
        }
    }
}
```

Exception:

```java
package com.example.authz.model;

public final class AuthorizationDeniedException extends RuntimeException {
    private final AuthorizationDecision decision;

    public AuthorizationDeniedException(AuthorizationDecision decision) {
        super(decision.reason() == null ? "Access denied" : decision.reason().code());
        this.decision = decision;
    }

    public AuthorizationDecision decision() {
        return decision;
    }
}
```

Catatan: exception membawa decision, tetapi response mapper harus hati-hati agar tidak membocorkan reason internal.

---

## 13. Policy Interface

Policy adalah rule evaluator.

```java
package com.example.authz.policy;

import com.example.authz.model.AuthorizationDecision;
import com.example.authz.model.AuthorizationRequest;

public interface AuthorizationPolicy {
    String id();
    String version();
    AuthorizationDecision evaluate(AuthorizationRequest request);
}
```

Policy sebaiknya:

- pure sejauh mungkin,
- deterministik,
- kecil,
- punya id/version,
- testable,
- tidak melempar exception untuk deny normal,
- tidak diam-diam allow ketika data hilang.

### 13.1 Permission Policy

```java
package com.example.authz.policy;

import com.example.authz.model.*;

public final class PermissionPolicy implements AuthorizationPolicy {
    private final Action requiredPermission;

    public PermissionPolicy(Action requiredPermission) {
        this.requiredPermission = requiredPermission;
    }

    @Override
    public String id() {
        return "permission-policy:" + requiredPermission.value();
    }

    @Override
    public String version() {
        return "1";
    }

    @Override
    public AuthorizationDecision evaluate(AuthorizationRequest request) {
        if (!request.action().equals(requiredPermission)) {
            return AuthorizationDecision.notApplicable();
        }

        if (request.subject().hasPermission(requiredPermission)) {
            return AuthorizationDecision.builder(DecisionEffect.ALLOW)
                .reason(ReasonCodes.ALLOWED_BY_PERMISSION)
                .policy(id(), version())
                .evidence(Evidence.of("permission", requiredPermission.value(), "Subject has required permission"))
                .build();
        }

        return AuthorizationDecision.builder(DecisionEffect.DENY)
            .reason(DecisionReason.of("MISSING_PERMISSION", "Subject lacks required permission", false))
            .policy(id(), version())
            .build();
    }
}
```

### 13.2 Tenant Boundary Policy

Tenant boundary biasanya deny override.

```java
package com.example.authz.policy;

import com.example.authz.model.*;

public final class TenantBoundaryPolicy implements AuthorizationPolicy {
    private final ResourceTenantResolver resourceTenantResolver;

    public TenantBoundaryPolicy(ResourceTenantResolver resourceTenantResolver) {
        this.resourceTenantResolver = resourceTenantResolver;
    }

    @Override
    public String id() {
        return "tenant-boundary-policy";
    }

    @Override
    public String version() {
        return "1";
    }

    @Override
    public AuthorizationDecision evaluate(AuthorizationRequest request) {
        String subjectTenant = request.subject().tenantId();
        String contextTenant = request.context().tenantId();
        String resourceTenant = resourceTenantResolver.findTenantId(request.resource());

        if (subjectTenant == null || contextTenant == null || resourceTenant == null) {
            return AuthorizationDecision.builder(DecisionEffect.INDETERMINATE)
                .reason(DecisionReason.of("TENANT_CONTEXT_MISSING", "Tenant context is incomplete", false))
                .policy(id(), version())
                .build();
        }

        if (!subjectTenant.equals(contextTenant)) {
            return AuthorizationDecision.builder(DecisionEffect.DENY)
                .reason(DecisionReason.of("ACTIVE_TENANT_MISMATCH", "Subject tenant and active tenant mismatch", false))
                .policy(id(), version())
                .build();
        }

        if (!contextTenant.equals(resourceTenant)) {
            return AuthorizationDecision.builder(DecisionEffect.DENY)
                .reason(ReasonCodes.TENANT_MISMATCH)
                .policy(id(), version())
                .evidence(Evidence.of("tenant", request.resource().canonical(), "Resource belongs to different tenant"))
                .build();
        }

        return AuthorizationDecision.notApplicable();
    }
}
```

Kenapa return `NOT_APPLICABLE` ketika tenant cocok?

Karena tenant boundary tidak memberi izin aksi. Ia hanya menolak cross-tenant. Permission lain tetap harus memberi allow.

---

## 14. Decision Combiner

Jika banyak policy dievaluasi, kita perlu combiner.

### 14.1 Deny Overrides

Rule:

```text
Jika ada DENY -> final DENY.
Jika ada INDETERMINATE -> final DENY atau INDETERMINATE-to-DENY.
Jika ada ALLOW dan tidak ada DENY/INDETERMINATE -> final ALLOW.
Jika semuanya NOT_APPLICABLE -> final DENY.
```

```java
package com.example.authz.policy;

import com.example.authz.model.*;
import java.util.ArrayList;
import java.util.List;

public final class DenyOverridesCombiner implements DecisionCombiner {
    @Override
    public AuthorizationDecision combine(List<AuthorizationDecision> decisions) {
        if (decisions == null || decisions.isEmpty()) {
            return AuthorizationDecision.deny(ReasonCodes.NO_APPLICABLE_POLICY);
        }

        List<Evidence> evidence = new ArrayList<Evidence>();
        List<Obligation> obligations = new ArrayList<Obligation>();
        AuthorizationDecision firstAllow = null;
        AuthorizationDecision firstIndeterminate = null;

        for (AuthorizationDecision decision : decisions) {
            evidence.addAll(decision.evidence());
            obligations.addAll(decision.obligations());

            if (decision.effect() == DecisionEffect.DENY) {
                return decision;
            }

            if (decision.effect() == DecisionEffect.INDETERMINATE && firstIndeterminate == null) {
                firstIndeterminate = decision;
            }

            if (decision.effect() == DecisionEffect.ALLOW && firstAllow == null) {
                firstAllow = decision;
            }
        }

        if (firstIndeterminate != null) {
            return AuthorizationDecision.builder(DecisionEffect.DENY)
                .reason(DecisionReason.of("INDETERMINATE_DENIED", "Authorization could not be safely evaluated", false))
                .policy("deny-overrides-combiner", "1")
                .build();
        }

        if (firstAllow != null) {
            AuthorizationDecision.Builder builder = AuthorizationDecision.builder(DecisionEffect.ALLOW)
                .reason(firstAllow.reason())
                .policy("deny-overrides-combiner", "1");

            for (Evidence item : evidence) {
                builder.evidence(item);
            }
            for (Obligation obligation : obligations) {
                builder.obligation(obligation);
            }
            return builder.build();
        }

        return AuthorizationDecision.builder(DecisionEffect.DENY)
            .reason(ReasonCodes.NO_APPLICABLE_POLICY)
            .policy("deny-overrides-combiner", "1")
            .build();
    }
}
```

Interface:

```java
package com.example.authz.policy;

import com.example.authz.model.AuthorizationDecision;
import java.util.List;

public interface DecisionCombiner {
    AuthorizationDecision combine(List<AuthorizationDecision> decisions);
}
```

### 14.2 Permit Overrides

Permit overrides jarang cocok untuk high-risk enterprise authorization karena satu allow bisa mengalahkan deny. Gunakan hanya jika sangat sadar:

```text
Example:
- public read policy allows everyone for public content,
- specific deny only applies to banned users,
- but if deny exists, still deny.
```

Dalam praktik security-sensitive, **deny-overrides** lebih aman.

### 14.3 First Applicable

First applicable cocok untuk routing policy, bukan policy security kompleks.

Masalah:

```text
Policy ordering berubah -> security behavior berubah.
```

Gunakan hanya jika ordering menjadi bagian eksplisit dari kontrak.

---

## 15. Authorization Service

Authorization service adalah orchestrator.

```java
package com.example.authz.service;

import com.example.authz.model.*;
import com.example.authz.policy.AuthorizationPolicy;
import com.example.authz.policy.DecisionCombiner;

import java.util.ArrayList;
import java.util.List;

public final class AuthorizationService {
    private final List<AuthorizationPolicy> policies;
    private final DecisionCombiner combiner;
    private final AuthorizationAuditSink auditSink;

    public AuthorizationService(
        List<AuthorizationPolicy> policies,
        DecisionCombiner combiner,
        AuthorizationAuditSink auditSink
    ) {
        this.policies = new ArrayList<AuthorizationPolicy>(policies);
        this.combiner = combiner;
        this.auditSink = auditSink;
    }

    public AuthorizationDecision authorize(AuthorizationRequest request) {
        List<AuthorizationDecision> decisions = new ArrayList<AuthorizationDecision>();

        for (AuthorizationPolicy policy : policies) {
            try {
                decisions.add(policy.evaluate(request));
            } catch (RuntimeException ex) {
                decisions.add(AuthorizationDecision.builder(DecisionEffect.INDETERMINATE)
                    .reason(ReasonCodes.POLICY_ERROR)
                    .policy(policy.id(), policy.version())
                    .evidence(Evidence.of("exception", ex.getClass().getName(), safeMessage(ex)))
                    .build());
            }
        }

        AuthorizationDecision finalDecision = combiner.combine(decisions);
        auditSink.record(request, finalDecision);
        return finalDecision;
    }

    private static String safeMessage(RuntimeException ex) {
        String message = ex.getMessage();
        if (message == null) {
            return "Policy evaluation failed";
        }
        return message.length() > 200 ? message.substring(0, 200) : message;
    }
}
```

Audit sink:

```java
package com.example.authz.service;

import com.example.authz.model.AuthorizationDecision;
import com.example.authz.model.AuthorizationRequest;

public interface AuthorizationAuditSink {
    void record(AuthorizationRequest request, AuthorizationDecision decision);
}
```

No-op implementation for tests or low-risk internal usage:

```java
public final class NoopAuthorizationAuditSink implements AuthorizationAuditSink {
    @Override
    public void record(AuthorizationRequest request, AuthorizationDecision decision) {
        // intentionally empty
    }
}
```

---

## 16. Avoiding Boolean Blindness

Boolean blindness terjadi ketika kode hanya punya `true/false`, lalu kehilangan konteks.

Anti-pattern:

```java
if (!authz.canApprove(user, caseId)) {
    throw new AccessDeniedException("Denied");
}
```

Problem:

```text
Kenapa denied?
Tenant mismatch?
Case state salah?
User bukan reviewer?
User submitter sendiri?
Delegation expired?
Policy error?
Resource tidak ada?
```

Better:

```java
AuthorizationDecision decision = authz.authorize(request);

if (!decision.isAllowed()) {
    auditDenied(request, decision);
    throw mapToException(decision);
}
```

Decision bisa dipakai untuk:

- audit,
- troubleshooting,
- user message,
- metrics,
- compliance evidence,
- regression test,
- policy diff.

---

## 17. Domain-Specific Action Registry

Jangan biarkan action dibuat bebas di seluruh codebase.

```java
package com.example.caseapp.authz;

import com.example.authz.model.Action;

public final class CaseActions {
    private CaseActions() {}

    public static final Action READ = Action.named("case.read");
    public static final Action SEARCH = Action.named("case.search");
    public static final Action CREATE = Action.named("case.create");
    public static final Action UPDATE = Action.named("case.update");
    public static final Action SUBMIT = Action.named("case.submit");
    public static final Action APPROVE = Action.named("case.approve");
    public static final Action REJECT = Action.named("case.reject");
    public static final Action RETURN = Action.named("case.return");
    public static final Action REASSIGN = Action.named("case.reassign");
    public static final Action EXPORT = Action.named("case.export");
    public static final Action BREAK_GLASS_READ = Action.named("case.break-glass-read");
}
```

Untuk Java 17+, enum atau sealed model bisa dipakai, tapi hati-hati jika permission harus extensible dari database/config.

### 17.1 Enum Approach

```java
public enum CasePermission {
    READ("case.read"),
    APPROVE("case.approve"),
    EXPORT("case.export");

    private final Action action;

    CasePermission(String value) {
        this.action = Action.named(value);
    }

    public Action action() {
        return action;
    }
}
```

Kelebihan:

- typo lebih sedikit,
- discoverable,
- bagus untuk core permission stabil.

Kekurangan:

- kurang fleksibel untuk plugin/multi-module/dynamic permission,
- perlu redeploy untuk permission baru.

### 17.2 Registry Approach

```java
public final class ActionRegistry {
    private final Set<Action> knownActions;

    public ActionRegistry(Set<Action> knownActions) {
        this.knownActions = new HashSet<Action>(knownActions);
    }

    public boolean isKnown(Action action) {
        return knownActions.contains(action);
    }
}
```

Policy bisa deny jika action tidak dikenal:

```java
if (!registry.isKnown(request.action())) {
    return AuthorizationDecision.deny(
        DecisionReason.of("UNKNOWN_ACTION", "Unknown action", false)
    );
}
```

---

## 18. ResourceRef Factory Per Domain

Untuk menghindari string resource type liar:

```java
package com.example.caseapp.authz;

import com.example.authz.model.ResourceRef;
import com.example.authz.model.ResourceType;

public final class CaseResources {
    private static final ResourceType CASE = ResourceType.named("case");
    private static final ResourceType CASE_DOCUMENT = ResourceType.named("case-document");
    private static final ResourceType CASE_NOTE = ResourceType.named("case-note");

    private CaseResources() {}

    public static ResourceRef caseRef(String caseId) {
        return ResourceRef.of(CASE, caseId);
    }

    public static ResourceRef documentRef(String documentId) {
        return ResourceRef.of(CASE_DOCUMENT, documentId);
    }

    public static ResourceRef noteRef(String noteId) {
        return ResourceRef.of(CASE_NOTE, noteId);
    }
}
```

---

## 19. Domain Policy Example: Maker-Checker

Maker-checker rule:

```text
A user who submitted a case cannot approve the same case.
```

Need resource attribute resolver:

```java
package com.example.caseapp.authz;

public interface CaseAuthorizationDataProvider {
    CaseAuthzSnapshot loadCaseSnapshot(String caseId);
}
```

Snapshot:

```java
package com.example.caseapp.authz;

public final class CaseAuthzSnapshot {
    private final String caseId;
    private final String tenantId;
    private final String state;
    private final String assignedOfficerId;
    private final String submittedByUserId;

    public CaseAuthzSnapshot(
        String caseId,
        String tenantId,
        String state,
        String assignedOfficerId,
        String submittedByUserId
    ) {
        this.caseId = caseId;
        this.tenantId = tenantId;
        this.state = state;
        this.assignedOfficerId = assignedOfficerId;
        this.submittedByUserId = submittedByUserId;
    }

    public String caseId() { return caseId; }
    public String tenantId() { return tenantId; }
    public String state() { return state; }
    public String assignedOfficerId() { return assignedOfficerId; }
    public String submittedByUserId() { return submittedByUserId; }
}
```

Policy:

```java
package com.example.caseapp.authz;

import com.example.authz.model.*;
import com.example.authz.policy.AuthorizationPolicy;

public final class CaseApprovalMakerCheckerPolicy implements AuthorizationPolicy {
    private final CaseAuthorizationDataProvider dataProvider;

    public CaseApprovalMakerCheckerPolicy(CaseAuthorizationDataProvider dataProvider) {
        this.dataProvider = dataProvider;
    }

    @Override
    public String id() {
        return "case-approval-maker-checker";
    }

    @Override
    public String version() {
        return "1";
    }

    @Override
    public AuthorizationDecision evaluate(AuthorizationRequest request) {
        if (!CaseActions.APPROVE.equals(request.action())) {
            return AuthorizationDecision.notApplicable();
        }

        if (!"case".equals(request.resource().type().value())) {
            return AuthorizationDecision.notApplicable();
        }

        CaseAuthzSnapshot snapshot = dataProvider.loadCaseSnapshot(request.resource().id());
        String userId = request.subject().principal().id();

        if (userId.equals(snapshot.submittedByUserId())) {
            return AuthorizationDecision.builder(DecisionEffect.DENY)
                .reason(ReasonCodes.MAKER_CHECKER_VIOLATION)
                .policy(id(), version())
                .evidence(Evidence.of("case-submitter", request.resource().canonical(), "Subject submitted this case"))
                .build();
        }

        return AuthorizationDecision.notApplicable();
    }
}
```

Perhatikan: policy ini tidak memberi allow. Ia hanya deny jika maker-checker dilanggar. Permission/role/workflow policy lain tetap diperlukan.

---

## 20. Domain Policy Example: Case State Guard

```java
package com.example.caseapp.authz;

import com.example.authz.model.*;
import com.example.authz.policy.AuthorizationPolicy;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class CaseApprovalStatePolicy implements AuthorizationPolicy {
    private final CaseAuthorizationDataProvider dataProvider;
    private final Set<String> approvableStates = new HashSet<String>(Arrays.asList("SUBMITTED", "REVIEWED"));

    public CaseApprovalStatePolicy(CaseAuthorizationDataProvider dataProvider) {
        this.dataProvider = dataProvider;
    }

    @Override
    public String id() {
        return "case-approval-state-policy";
    }

    @Override
    public String version() {
        return "1";
    }

    @Override
    public AuthorizationDecision evaluate(AuthorizationRequest request) {
        if (!CaseActions.APPROVE.equals(request.action())) {
            return AuthorizationDecision.notApplicable();
        }

        CaseAuthzSnapshot snapshot = dataProvider.loadCaseSnapshot(request.resource().id());

        if (!approvableStates.contains(snapshot.state())) {
            return AuthorizationDecision.builder(DecisionEffect.DENY)
                .reason(ReasonCodes.RESOURCE_STATE_NOT_ALLOWED)
                .policy(id(), version())
                .evidence(Evidence.of("case-state", snapshot.caseId(), "Case state is " + snapshot.state()))
                .build();
        }

        return AuthorizationDecision.notApplicable();
    }
}
```

Again: this policy denies invalid state; it does not grant permission.

---

## 21. Domain Policy Example: Assigned Officer Allow

```java
package com.example.caseapp.authz;

import com.example.authz.model.*;
import com.example.authz.policy.AuthorizationPolicy;

public final class AssignedOfficerApprovePolicy implements AuthorizationPolicy {
    private final CaseAuthorizationDataProvider dataProvider;

    public AssignedOfficerApprovePolicy(CaseAuthorizationDataProvider dataProvider) {
        this.dataProvider = dataProvider;
    }

    @Override
    public String id() {
        return "assigned-officer-approve-policy";
    }

    @Override
    public String version() {
        return "1";
    }

    @Override
    public AuthorizationDecision evaluate(AuthorizationRequest request) {
        if (!CaseActions.APPROVE.equals(request.action())) {
            return AuthorizationDecision.notApplicable();
        }

        CaseAuthzSnapshot snapshot = dataProvider.loadCaseSnapshot(request.resource().id());
        String userId = request.subject().principal().id();

        if (userId.equals(snapshot.assignedOfficerId())) {
            return AuthorizationDecision.builder(DecisionEffect.ALLOW)
                .reason(DecisionReason.of("ALLOWED_ASSIGNED_OFFICER", "Subject is assigned officer", false))
                .policy(id(), version())
                .evidence(Evidence.of("assignment", request.resource().canonical(), "Subject is assigned officer"))
                .build();
        }

        return AuthorizationDecision.builder(DecisionEffect.DENY)
            .reason(ReasonCodes.NOT_ASSIGNED_OFFICER)
            .policy(id(), version())
            .build();
    }
}
```

Apakah policy ini harus deny jika bukan assigned officer? Tergantung model.

Jika hanya assigned officer yang boleh approve, deny masuk akal.

Jika reviewer/supervisor/delegate juga boleh approve, policy ini mungkin sebaiknya `NOT_APPLICABLE` ketika bukan assigned officer, lalu policy lain bisa allow. Tetapi hati-hati dengan permit override. Biasanya lebih baik desain policy komposit per action agar semantics jelas.

---

## 22. Policy Composition Pattern

Untuk action kompleks seperti approve case:

```text
Final Case Approve Decision:
1. known action policy must pass
2. tenant boundary must not deny
3. case state must not deny
4. maker-checker must not deny
5. contextual risk must not deny
6. one positive authority must allow:
   - assigned officer
   - delegated reviewer
   - supervisor override
   - break-glass with obligation
```

Jangan membuat semua rule dalam satu method raksasa:

```java
boolean canApprove(User user, Case caseEntity) {
    // 400 lines
}
```

Lebih baik pisahkan:

```java
List<AuthorizationPolicy> policies = Arrays.asList(
    new UnknownActionDenyPolicy(actionRegistry),
    new TenantBoundaryPolicy(resourceTenantResolver),
    new CaseApprovalStatePolicy(caseDataProvider),
    new CaseApprovalMakerCheckerPolicy(caseDataProvider),
    new AssignedOfficerApprovePolicy(caseDataProvider),
    new DelegatedReviewerApprovePolicy(delegationProvider),
    new SupervisorApprovePolicy(orgProvider),
    new BreakGlassApprovePolicy(breakGlassProvider)
);
```

Tetapi composition harus punya combiner yang benar.

---

## 23. Two-Phase Decision: Guard Policies and Grant Policies

Untuk domain kompleks, satu list policy + combiner bisa ambigu. Gunakan dua fase:

```text
Phase 1: Guard policies
- unknown action deny
- tenant mismatch deny
- resource state deny
- maker-checker deny
- expired delegation deny
- high risk deny

Phase 2: Grant policies
- permission allow
- assignment allow
- supervisor allow
- delegation allow
- break-glass allow with obligation

Final:
- if any guard denies -> deny
- else if any grant allows -> allow
- else deny
```

Model:

```java
public enum PolicyKind {
    GUARD,
    GRANT
}
```

Extended policy:

```java
public interface ClassifiedAuthorizationPolicy extends AuthorizationPolicy {
    PolicyKind kind();
}
```

Service:

```java
public final class TwoPhaseAuthorizationService {
    private final List<ClassifiedAuthorizationPolicy> policies;
    private final AuthorizationAuditSink auditSink;

    public TwoPhaseAuthorizationService(
        List<ClassifiedAuthorizationPolicy> policies,
        AuthorizationAuditSink auditSink
    ) {
        this.policies = policies;
        this.auditSink = auditSink;
    }

    public AuthorizationDecision authorize(AuthorizationRequest request) {
        AuthorizationDecision firstAllow = null;

        for (ClassifiedAuthorizationPolicy policy : policies) {
            if (policy.kind() != PolicyKind.GUARD) {
                continue;
            }
            AuthorizationDecision decision = safeEvaluate(policy, request);
            if (decision.effect() == DecisionEffect.DENY || decision.effect() == DecisionEffect.INDETERMINATE) {
                auditSink.record(request, decision);
                return decision.effect() == DecisionEffect.DENY
                    ? decision
                    : AuthorizationDecision.deny(DecisionReason.of("GUARD_INDETERMINATE", "Guard policy failed", false));
            }
        }

        for (ClassifiedAuthorizationPolicy policy : policies) {
            if (policy.kind() != PolicyKind.GRANT) {
                continue;
            }
            AuthorizationDecision decision = safeEvaluate(policy, request);
            if (decision.effect() == DecisionEffect.DENY) {
                auditSink.record(request, decision);
                return decision;
            }
            if (decision.effect() == DecisionEffect.ALLOW && firstAllow == null) {
                firstAllow = decision;
            }
        }

        AuthorizationDecision finalDecision = firstAllow != null
            ? firstAllow
            : AuthorizationDecision.deny(ReasonCodes.NO_APPLICABLE_POLICY);

        auditSink.record(request, finalDecision);
        return finalDecision;
    }

    private AuthorizationDecision safeEvaluate(AuthorizationPolicy policy, AuthorizationRequest request) {
        try {
            return policy.evaluate(request);
        } catch (RuntimeException ex) {
            return AuthorizationDecision.builder(DecisionEffect.INDETERMINATE)
                .reason(ReasonCodes.POLICY_ERROR)
                .policy(policy.id(), policy.version())
                .build();
        }
    }
}
```

This is easier to reason about than generic combining for high-risk workflows.

---

## 24. Attribute Provider Boundary

Policy should not directly call arbitrary repository methods everywhere.

Bad:

```java
public AuthorizationDecision evaluate(AuthorizationRequest request) {
    CaseEntity c = caseRepository.findById(request.resource().id()).get();
    UserEntity u = userRepository.findById(request.subject().principal().id()).get();
    OrgEntity o = orgRepository.findByUserId(u.getId());
    // ...
}
```

Problems:

- hard to test,
- N+1,
- inconsistent snapshots,
- hidden DB calls,
- policy becomes data access layer,
- remote PDP migration becomes hard.

Better:

```java
public interface AuthorizationAttributeProvider {
    ResourceAttributes resourceAttributes(ResourceRef resource);
    SubjectAttributes subjectAttributes(PrincipalRef principal);
    RelationshipAttributes relationships(PrincipalRef principal, ResourceRef resource);
}
```

Example:

```java
public final class ResourceAttributes {
    private final ResourceRef resource;
    private final Map<String, Object> attributes;

    // immutable implementation
}
```

Policy consumes stable attributes:

```java
String state = attributes.string("state");
String tenantId = attributes.string("tenantId");
String ownerId = attributes.string("ownerId");
```

This makes it easier to:

- batch load attributes,
- cache attributes,
- audit attribute provenance,
- migrate to OPA/Cedar-style input document,
- avoid lazy loading.

---

## 25. Policy Input Document Pattern

Even if you do not use external policy engine, model your input like one.

Example internal representation:

```json
{
  "subject": {
    "principal": "user:123",
    "tenant": "agency:CEA",
    "roles": ["CASE_REVIEWER"],
    "permissions": ["case.approve"]
  },
  "action": "case.approve",
  "resource": {
    "ref": "case:987",
    "type": "case",
    "tenant": "agency:CEA",
    "state": "SUBMITTED",
    "assignedOfficer": "user:123",
    "submittedBy": "user:999"
  },
  "context": {
    "time": "2026-06-20T10:00:00Z",
    "channel": "intranet",
    "correlationId": "abc-123"
  }
}
```

Internal Java model should be convertible to this.

Benefit:

- easier debugging,
- easier golden tests,
- easier external PDP integration,
- easier audit reconstruction,
- easier policy simulation.

---

## 26. Java 17+ Modernization: Records and Sealed Types

For Java 17+, records reduce boilerplate for immutable data carriers.

### 26.1 Record Version of Action

```java
public record Action(String value) {
    public Action {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("Action value must not be blank");
        }
        value = value.trim().toLowerCase();
    }

    public static Action named(String value) {
        return new Action(value);
    }
}
```

### 26.2 Record Version of ResourceRef

```java
public record ResourceRef(ResourceType type, String id) {
    public ResourceRef {
        if (type == null) {
            throw new IllegalArgumentException("type must not be null");
        }
        if (id == null || id.trim().isEmpty()) {
            throw new IllegalArgumentException("id must not be blank");
        }
        id = id.trim();
    }

    public String canonical() {
        return type.value() + ":" + id;
    }
}
```

### 26.3 Sealed Decision Type

Instead of enum effect, Java 17+ can model decision as sealed hierarchy:

```java
public sealed interface AuthorizationDecision
    permits AllowDecision, DenyDecision, NotApplicableDecision, IndeterminateDecision {

    DecisionReason reason();
}

public record AllowDecision(
    DecisionReason reason,
    List<Obligation> obligations,
    List<Evidence> evidence
) implements AuthorizationDecision {}

public record DenyDecision(
    DecisionReason reason,
    List<Evidence> evidence
) implements AuthorizationDecision {}

public record NotApplicableDecision() implements AuthorizationDecision {
    @Override
    public DecisionReason reason() {
        return ReasonCodes.NO_APPLICABLE_POLICY;
    }
}

public record IndeterminateDecision(
    DecisionReason reason,
    Throwable cause
) implements AuthorizationDecision {}
```

Benefit:

- compiler knows all decision variants,
- pattern matching becomes cleaner in modern Java,
- impossible states can be reduced.

Trade-off:

- more types,
- harder for serialization if not standardized,
- Java 8 compatibility lost.

For libraries targeting Java 8–25, a pragmatic approach:

```text
Core module Java 8 compatible.
Modern adapter module Java 17+ can expose records/sealed types.
```

---

## 27. Type-Safe Permission: Enum vs Value Object vs Class Constants

### 27.1 Raw String

```java
hasPermission("case.approve")
```

Pros:

- simple,
- dynamic.

Cons:

- typo,
- no refactor safety,
- no registry,
- hard to discover.

### 27.2 Enum

```java
CasePermission.APPROVE
```

Pros:

- type-safe,
- discoverable,
- good for stable permission.

Cons:

- not dynamic,
- cross-module extensibility harder.

### 27.3 Value Object with Registry

```java
Action.named("case.approve")
```

Pros:

- flexible,
- can validate grammar,
- supports dynamic modules,
- works with DB/external policy.

Cons:

- still string inside,
- needs registry/test discipline.

### 27.4 Recommended Hybrid

```text
Core actions as constants/enum.
Runtime representation as value object.
Registry validates all known action names.
DB/external policy stores canonical string.
```

---

## 28. Modeling Data Scope

Authorization often needs not only `allow/deny`, but also **what data subset** is visible.

Example:

```text
case.search:
- admin can see all cases in tenant,
- officer can see assigned cases,
- supervisor can see team cases,
- external user can see own submitted cases.
```

Model data scope separately:

```java
public final class DataScope {
    private final String name;
    private final Map<String, Object> parameters;

    private DataScope(String name, Map<String, Object> parameters) {
        this.name = name;
        this.parameters = parameters;
    }

    public static DataScope allTenant(String tenantId) { ... }
    public static DataScope assignedTo(String userId) { ... }
    public static DataScope team(String teamId) { ... }
    public static DataScope own(String userId) { ... }
}
```

Search authorization decision:

```java
public final class DataAuthorizationDecision {
    private final AuthorizationDecision decision;
    private final DataScope scope;

    // getters
}
```

Do not overload normal action decision with query predicate details unless necessary.

---

## 29. Query Scope Specification Pattern

For JPA/Spring Data:

```java
public interface AuthorizedQueryScope<T> {
    Specification<T> toSpecification();
}
```

Example:

```java
public final class AssignedCasesScope implements AuthorizedQueryScope<CaseEntity> {
    private final String userId;

    public AssignedCasesScope(String userId) {
        this.userId = userId;
    }

    @Override
    public Specification<CaseEntity> toSpecification() {
        return new Specification<CaseEntity>() {
            @Override
            public Predicate toPredicate(Root<CaseEntity> root, CriteriaQuery<?> query, CriteriaBuilder cb) {
                return cb.equal(root.get("assignedOfficerId"), userId);
            }
        };
    }
}
```

But keep query scoping separate from object-action decision.

```text
Object decision: can user approve this case?
Query scope: which cases can user see in search?
```

They are related, but not identical.

---

## 30. Integration With Spring Security

Spring Security can be adapter around internal model.

### 30.1 Request Authorization Adapter

```java
public final class InternalAuthorizationManager<T> implements AuthorizationManager<T> {
    private final AuthorizationService authorizationService;
    private final RequestToAuthorizationRequestMapper<T> mapper;

    public InternalAuthorizationManager(
        AuthorizationService authorizationService,
        RequestToAuthorizationRequestMapper<T> mapper
    ) {
        this.authorizationService = authorizationService;
        this.mapper = mapper;
    }

    @Override
    public AuthorizationDecision check(Supplier<Authentication> authentication, T object) {
        com.example.authz.model.AuthorizationRequest internalRequest =
            mapper.map(authentication.get(), object);

        com.example.authz.model.AuthorizationDecision internalDecision =
            authorizationService.authorize(internalRequest);

        return new AuthorizationDecision(internalDecision.isAllowed());
    }
}
```

Naming conflict note:

```text
Spring Security has AuthorizationDecision.
Your domain may also have AuthorizationDecision.
Use package qualification or rename domain class to AccessDecision/AuthzDecision if needed.
```

### 30.2 Method Security Adapter

Instead of large SpEL:

```java
@PreAuthorize("hasRole('ADMIN') or @caseSecurity.canApprove(authentication, #caseId)")
```

Use explicit domain method:

```java
@PreAuthorize("@caseAuthorization.canApprove(authentication, #caseId)")
public void approveCase(String caseId) { ... }
```

Where `caseAuthorization` maps to internal model.

Better for complex command:

```java
public void approveCase(ApproveCaseCommand command) {
    AuthorizationDecision decision = authorizationService.authorize(
        requestFactory.forApproveCase(command)
    );
    decision.throwIfDenied();

    caseService.approve(command);
}
```

---

## 31. Avoiding Framework Lock-In

Bad architecture:

```text
Domain policy depends on:
- HttpServletRequest
- Authentication
- SecurityContextHolder
- @PreAuthorize SpEL
- Spring Bean lookup
```

Better architecture:

```text
Adapter layer:
  HttpServletRequest + Authentication -> Subject + AuthorizationContext

Domain authorization layer:
  AuthorizationRequest -> AuthorizationDecision

Application layer:
  command handler enforces decision
```

This allows same policy to be used in:

- REST,
- GraphQL,
- gRPC,
- Kafka,
- batch,
- workflow engine,
- CLI,
- test harness.

---

## 32. Handling Missing Resource

Authorization and resource existence can interact dangerously.

Options:

### 32.1 Resource Not Found Before Authorization

```java
Case c = repository.findById(id).orElseThrow(NotFoundException::new);
authorize(user, c);
```

Risk: timing/error behavior may reveal resource existence depending on route.

### 32.2 Authorization Resolver Returns Masked Result

```java
ResourceLookupResult result = resourceAuthzResolver.loadForAuthorization(ref);

if (result.isMissing()) {
    return denyOrNotFoundPolicy(...);
}
```

### 32.3 Repository Scoped Load

```java
Optional<Case> c = repository.findVisibleCase(userScope, caseId);
```

Good for read; for mutation still need explicit action guard.

Recommended:

```text
For sensitive resources, return 404 for unauthorized read by external users.
For internal workflows, return 403 with safe reason when resource existence is already known through authorized list/task.
Always audit actual reason internally.
```

---

## 33. Handling TOCTOU

TOCTOU: time-of-check/time-of-use.

Bad:

```java
authorizeApprove(caseId);
Case c = repository.findById(caseId).get();
c.approve();
repository.save(c);
```

Between authorize and save:

- state may change,
- assignment may change,
- delegation may expire,
- tenant may be reassigned,
- case may be withdrawn.

Better:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    Case c = repository.findByIdForUpdate(command.caseId())
        .orElseThrow(NotFoundException::new);

    AuthorizationRequest request = requestFactory.forApproveCase(command, c.toAuthzSnapshot());
    AuthorizationDecision decision = authorizationService.authorize(request);
    decision.throwIfDenied();

    c.approve(command.actorId());
    repository.save(c);
}
```

Or enforce transition condition in DB update:

```sql
UPDATE cases
SET state = 'APPROVED'
WHERE id = ?
  AND state = 'SUBMITTED'
  AND assigned_officer_id = ?
  AND submitted_by_user_id <> ?
```

Then check affected rows.

---

## 34. Snapshot Model

For high integrity workflows, authorization should use a snapshot.

```java
public final class AuthorizationSnapshot {
    private final Subject subject;
    private final ResourceAttributes resource;
    private final AuthorizationContext context;
    private final Instant capturedAt;
    private final String snapshotVersion;
}
```

Snapshot helps:

- audit,
- test repeatability,
- policy replay,
- TOCTOU mitigation,
- external PDP input stability.

But snapshot must not become stale.

Rule:

```text
For mutation, snapshot should be captured inside transaction or immediately before state change.
For read/search, snapshot can tolerate short TTL depending on risk.
```

---

## 35. Authorization Domain Events

Useful events:

```text
AuthorizationAllowed
AuthorizationDenied
AuthorizationIndeterminate
PolicyEvaluationFailed
BreakGlassAccessUsed
DelegatedAccessUsed
AccessDeniedDueToTenantMismatch
```

Model:

```java
public final class AuthorizationEvaluatedEvent {
    private final String eventId;
    private final AuthorizationRequest request;
    private final AuthorizationDecision decision;
    private final Instant occurredAt;

    // constructor, getters
}
```

But do not publish full sensitive data by default. Event payload should be safe and bounded.

---

## 36. Package Structure

Recommended Java package structure:

```text
com.example.authz
  model
    Action
    ResourceType
    ResourceRef
    PrincipalRef
    Subject
    AuthorizationContext
    AuthorizationRequest
    AuthorizationDecision
    DecisionEffect
    DecisionReason
    Obligation
    Evidence
  policy
    AuthorizationPolicy
    DecisionCombiner
    DenyOverridesCombiner
    ClassifiedAuthorizationPolicy
    PolicyKind
  service
    AuthorizationService
    AuthorizationAuditSink
  attributes
    AttributeProvider
    ResourceAttributes
    SubjectAttributes
    RelationshipAttributes
  integration
    spring
      SpringAuthorizationManagerAdapter
      AuthenticationSubjectMapper
    jakarta
      JakartaCallerSubjectMapper
  testing
    AuthorizationTestFixture
    GoldenDecisionTestSupport
```

For domain-specific module:

```text
com.example.caseapp.authz
  CaseActions
  CaseResources
  CaseAuthorizationRequestFactory
  CaseAuthorizationDataProvider
  CaseAuthzSnapshot
  CaseApprovalStatePolicy
  CaseApprovalMakerCheckerPolicy
  AssignedOfficerApprovePolicy
  CaseSearchScopePolicy
```

---

## 37. Common Design Mistakes

### 37.1 Making Role the Center of the Model

Bad:

```java
class AuthorizationRequest {
    String role;
    String url;
}
```

Role is only one possible input.

Better:

```java
Subject + Action + Resource + Context
```

### 37.2 Making Resource Just an ID

Bad:

```java
can(userId, "approve", caseId)
```

Resource ID alone loses type and tenant.

Better:

```java
ResourceRef.of("case", caseId)
```

### 37.3 Returning Boolean Everywhere

Bad:

```java
boolean canExport(...)
```

Better:

```java
AuthorizationDecision authorizeExport(...)
```

Boolean can exist as convenience adapter, not core.

### 37.4 Ignoring Not Applicable

If policy cannot tell whether it applies, it should not silently allow.

### 37.5 Mixing Authentication and Authorization Model

Bad:

```java
class Subject {
    String passwordHash;
    String loginOtpStatus;
    String idToken;
}
```

Subject should hold authorization-relevant identity and authority, not login internals.

### 37.6 Policy Pulls Too Much Data

Bad:

```java
policy.evaluate() loads entire domain graph
```

Better:

```java
policy consumes minimal authorization snapshot
```

### 37.7 Policy Without Version

Without policy version, historical decision reconstruction becomes hard.

### 37.8 No Obligation Support

Then masking, watermarking, step-up, enhanced audit become scattered.

---

## 38. Testing the Domain Model

### 38.1 Value Object Tests

```java
@Test
public void actionNormalizesValue() {
    assertEquals(Action.named("case.approve"), Action.named(" CASE.APPROVE "));
}
```

### 38.2 Policy Unit Test

```java
@Test
public void submitterCannotApproveOwnCase() {
    CaseAuthorizationDataProvider provider = caseId -> new CaseAuthzSnapshot(
        caseId,
        "agency-a",
        "SUBMITTED",
        "user-2",
        "user-1"
    );

    AuthorizationPolicy policy = new CaseApprovalMakerCheckerPolicy(provider);

    Subject subject = Subject.builder(PrincipalRef.user("user-1"))
        .tenantId("agency-a")
        .build();

    AuthorizationRequest request = AuthorizationRequest.builder()
        .subject(subject)
        .action(CaseActions.APPROVE)
        .resource(CaseResources.caseRef("case-123"))
        .context(AuthorizationContext.builder().tenantId("agency-a").build())
        .build();

    AuthorizationDecision decision = policy.evaluate(request);

    assertEquals(DecisionEffect.DENY, decision.effect());
    assertEquals("MAKER_CHECKER_VIOLATION", decision.reason().code());
}
```

### 38.3 Combiner Test

```java
@Test
public void denyOverridesAllow() {
    DecisionCombiner combiner = new DenyOverridesCombiner();

    AuthorizationDecision allow = AuthorizationDecision.allow(ReasonCodes.ALLOWED_BY_PERMISSION);
    AuthorizationDecision deny = AuthorizationDecision.deny(ReasonCodes.TENANT_MISMATCH);

    AuthorizationDecision result = combiner.combine(Arrays.asList(allow, deny));

    assertEquals(DecisionEffect.DENY, result.effect());
    assertEquals("TENANT_MISMATCH", result.reason().code());
}
```

### 38.4 Golden Decision Test

Create table:

| subject | action | resource state | tenant match | submitted by | expected |
|---|---|---|---|---|---|
| reviewer | case.approve | SUBMITTED | yes | other | ALLOW |
| reviewer | case.approve | DRAFT | yes | other | DENY |
| reviewer | case.approve | SUBMITTED | no | other | DENY |
| reviewer | case.approve | SUBMITTED | yes | same | DENY |

Golden tests protect policy semantics from accidental refactoring changes.

---

## 39. Production Checklist

Before using your authorization domain model in production:

```text
[ ] All actions have canonical names.
[ ] Unknown action denies by default.
[ ] Resource references include type and id.
[ ] Subject distinguishes user/service/system principals.
[ ] Tenant context is explicit.
[ ] Authorization request is immutable.
[ ] Decision is not boolean-only.
[ ] Deny includes reason code.
[ ] Reason messages distinguish internal vs user-safe.
[ ] Policy has id and version.
[ ] Policy exceptions become indeterminate/deny.
[ ] Combiner behavior is explicit and tested.
[ ] Tenant boundary is guard/deny-override.
[ ] Object-level authorization exists for resource operations.
[ ] Query-scope model exists for list/search/export.
[ ] Obligations are supported for masking/watermark/step-up/audit.
[ ] Evidence is captured at least by reference.
[ ] Audit sink records final decision.
[ ] Framework adapter does not leak framework dependency into domain.
[ ] Mutation authorization runs near transaction/state change.
[ ] Golden decision tests exist.
[ ] Deny-by-default behavior is tested.
```

---

## 40. Top 1% Engineering Insight

Authorization domain modeling is not about inventing many classes. It is about making security decisions **explicit, stable, explainable, and enforceable everywhere**.

A weak engineer asks:

```text
Which role can access this endpoint?
```

A stronger engineer asks:

```text
What action is being attempted?
What resource is affected?
What invariant must hold?
Which context changes the decision?
Where can this path be bypassed?
Can the decision be audited and replayed?
What happens if required data is stale or unavailable?
```

A top-level engineer designs the system so the code itself forces those questions to be answered.

The goal is not simply:

```java
boolean allowed
```

The goal is:

```text
A defensible decision system:
- precise enough for policy,
- explicit enough for code review,
- stable enough for audit,
- composable enough for growth,
- safe enough under failure,
- practical enough for real teams.
```

---

## 41. Summary

Part ini membangun authorization domain model di Java:

- `Subject`, `PrincipalRef`, `Action`, `ResourceRef`, `AuthorizationContext`, dan `AuthorizationRequest` sebagai bahasa input keputusan.
- `AuthorizationDecision`, `DecisionEffect`, `DecisionReason`, `Obligation`, dan `Evidence` sebagai bahasa output keputusan.
- `AuthorizationPolicy` dan `DecisionCombiner` sebagai struktur evaluasi rule.
- Deny-by-default, not-applicable, indeterminate, guard policy, grant policy, dan obligation sebagai model yang lebih kuat daripada boolean.
- Java 8-compatible implementation dengan opsi modern Java 17+ records/sealed types.
- Adapter ke Spring Security tanpa mengunci domain model ke framework.
- Testing, audit, query scoping, TOCTOU, dan production checklist.

Dengan model ini, bagian berikutnya bisa masuk ke **membangun internal authorization service** yang production-grade: API service, bulk decision, attribute loading, caching, audit event publishing, admin/policy management, migration, dan backward compatibility.

---

## 42. Referensi

1. Spring Security Reference — Authorization Architecture. Spring Security menjelaskan model authorization modern berbasis `AuthorizationManager`, yang dapat dipakai sebagai adapter untuk domain authorization internal.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

2. OWASP Authorization Cheat Sheet. Menekankan deny-by-default, least privilege, dan validasi authorization pada setiap request.  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

3. OWASP Broken Access Control. Menjelaskan bahwa access control/authorization adalah mekanisme yang menentukan akses user terhadap content dan function setelah authentication.  
   https://owasp.org/www-community/Broken_Access_Control

4. Open Policy Agent Documentation. OPA menyediakan policy engine dan API untuk memisahkan policy decision dari application code; konsep input/decision-nya relevan untuk desain internal policy model.  
   https://openpolicyagent.org/docs

5. Oracle Java Documentation — Records. Records berguna untuk data carrier immutable di Java modern.  
   https://docs.oracle.com/en/java/javase/17/language/records.html

6. Oracle Java Documentation — Sealed Classes. Sealed classes/interfaces membatasi subtype yang valid dan cocok untuk model decision hierarchy di Java 17+.  
   https://docs.oracle.com/en/java/javase/17/language/sealed-classes-and-interfaces.html

---

## Status Seri

Selesai:

```text
[x] Part 0  — Authorization Mental Model
[x] Part 1  — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2  — Java Platform Authorization Primitives
[x] Part 3  — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4  — RBAC Done Properly
[x] Part 5  — Permission and Capability Modeling
[x] Part 6  — ABAC
[x] Part 7  — PBAC and Policy-as-Code
[x] Part 8  — ReBAC
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
```

Berikutnya:

```text
[ ] Part 31 — Building an Internal Authorization Service
```

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-029.md">⬅️ Part 29 — Authorization Anti-Patterns and Failure Modes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-031.md">Part 31 — Building an Internal Authorization Service ➡️</a>
</div>
