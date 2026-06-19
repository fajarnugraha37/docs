# learn-java-authorization-modes-and-patterns-part-007.md

# Java Authorization Modes and Patterns — Part 7  
# PBAC and Policy-as-Code

> Seri: `learn-java-authorization-modes-and-patterns`  
> Part: `007`  
> Topik: Policy-Based Access Control, Policy-as-Code, externalized authorization, policy lifecycle, Java integration, dan production failure modeling  
> Target Java: Java 8 sampai Java 25  
> Level: Advanced / Principal Engineer / Top 1% Authorization Engineering

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membangun fondasi:

- Part 0: authorization sebagai decision system.
- Part 1: vocabulary, semantics, invariant.
- Part 2: Java platform authorization primitives.
- Part 3: PEP/PDP/PAP/PIP architecture.
- Part 4: RBAC yang benar.
- Part 5: permission dan capability modeling.
- Part 6: ABAC dan attribute-driven decision.

Part 7 masuk ke level berikutnya:

> Bagaimana jika authorization rule sudah terlalu kompleks, sering berubah, lintas service, butuh auditability, butuh simulation, dan tidak sehat lagi jika ditanam langsung dalam Java code?

Jawabannya sering mengarah ke:

- **PBAC**: Policy-Based Access Control.
- **Policy-as-Code**.
- **Externalized authorization**.
- **Centralized or federated policy decision architecture**.
- **Policy lifecycle engineering**.

Namun perlu hati-hati.

Policy engine bukan solusi ajaib. Banyak sistem justru menjadi lebih sulit di-debug karena policy dipindah dari Java code ke bahasa policy yang tidak dipahami tim aplikasi, tidak punya test discipline, tidak punya schema discipline, tidak punya deployment discipline, dan tidak punya failure model.

Part ini akan membangun mental model agar policy-as-code dipakai sebagai engineering tool yang matang, bukan sekadar “mari pakai OPA/Cedar supaya authorization terlihat modern”.

---

## 1. Core Mental Model

### 1.1 Authorization Rule Bisa Hidup Di Banyak Tempat

Authorization rule bisa ditulis sebagai:

```java
if (user.hasRole("CASE_OFFICER")) {
    allow();
}
```

Atau:

```java
if (caseRecord.assignedOfficerId().equals(user.id())
        && caseRecord.status() == CaseStatus.OPEN) {
    allow();
}
```

Atau:

```sql
where case_record.agency_id = :currentAgencyId
```

Atau:

```rego
allow if {
  input.subject.agency_id == input.resource.agency_id
  input.action == "case.read"
}
```

Atau:

```cedar
permit(
  principal,
  action == Action::"ViewCase",
  resource
)
when {
  principal.agency == resource.agency &&
  resource.status == "OPEN"
};
```

Semua contoh itu melakukan hal yang sama pada level abstrak:

> Menerjemahkan fakta tentang subject, action, resource, dan context menjadi decision.

Perbedaannya bukan hanya syntax. Perbedaannya adalah:

1. Di mana policy disimpan.
2. Siapa yang bisa mengubah policy.
3. Bagaimana policy diuji.
4. Bagaimana policy di-deploy.
5. Bagaimana perubahan policy diaudit.
6. Bagaimana aplikasi gagal ketika policy tidak tersedia.
7. Bagaimana policy memahami domain object.
8. Bagaimana keputusan dijelaskan kembali kepada manusia.

---

### 1.2 PBAC Bukan Pengganti RBAC/ABAC/ReBAC

Kesalahan umum:

> “Kita pakai PBAC, jadi tidak perlu RBAC/ABAC.”

Itu framing yang salah.

PBAC adalah pendekatan **mengelola authorization melalui policy**.  
RBAC, ABAC, ReBAC, ACL adalah **model bahan keputusan**.

Policy bisa berisi RBAC:

```text
permit user if user has role CaseOfficer and action is ReadCase
```

Policy bisa berisi ABAC:

```text
permit if subject.agency == resource.agency
```

Policy bisa berisi ReBAC:

```text
permit if subject is member of team assigned to case
```

Policy bisa berisi ACL-like rule:

```text
permit if resource.acl contains subject with permission READ
```

Jadi hubungan yang lebih benar:

```text
PBAC
└── policy language / policy lifecycle / decision architecture
    ├── can express RBAC
    ├── can express ABAC
    ├── can express ReBAC
    ├── can express ACL-like checks
    └── can combine them with explicit conflict rules
```

---

### 1.3 Policy-as-Code Berarti Policy Diperlakukan Seperti Software

Policy-as-code bukan hanya “policy disimpan sebagai file”.

Policy-as-code berarti policy punya disiplin engineering:

1. Version control.
2. Code review.
3. Static validation.
4. Schema validation.
5. Unit test.
6. Integration test.
7. Golden decision test.
8. Regression test.
9. CI gate.
10. Release artifact.
11. Rollback.
12. Observability.
13. Audit trail.
14. Change ownership.
15. Environment promotion.
16. Compatibility contract dengan aplikasi.

Jika policy hanya disimpan di file tetapi bisa diedit manual di production tanpa test, itu bukan policy-as-code yang sehat. Itu hanya “policy-as-text”.

---

## 2. Kapan Authorization Perlu Di-Externalize?

Tidak semua authorization perlu policy engine.

### 2.1 Sinyal Bahwa Hardcoded Authorization Mulai Tidak Sehat

Pertimbangkan externalized policy jika:

1. Rule sering berubah tanpa perubahan business flow.
2. Rule perlu disetujui oleh non-developer, security, compliance, atau policy owner.
3. Banyak service memakai rule authorization yang sama.
4. Ada kebutuhan simulation sebelum rule diterapkan.
5. Ada kebutuhan audit: “policy versi berapa yang membuat keputusan ini?”
6. Ada multi-tenant atau multi-agency variation.
7. Ada jurisdiction-specific rule.
8. Ada banyak exception rule.
9. Ada deny override yang harus konsisten.
10. Ada emergency/break-glass rule yang harus visible.
11. Ada kebutuhan decision explainability.
12. Ada kebutuhan centralized governance.
13. Ada kebutuhan policy diff dan blast radius analysis.
14. Ada kebutuhan testing matrix besar.
15. Ada terlalu banyak `@PreAuthorize` expression yang sulit dibaca.
16. Ada logic authorization yang tersebar di controller, service, repository, scheduler, dan consumer.

---

### 2.2 Sinyal Bahwa Policy Engine Mungkin Overkill

Jangan pakai policy engine hanya karena terlihat advanced.

Policy engine bisa overkill jika:

1. Rule authorization sederhana dan stabil.
2. Tim belum punya test discipline.
3. Domain model belum jelas.
4. Attribute source belum jelas.
5. Permission naming belum matang.
6. Tidak ada ownership atas policy.
7. Tidak ada observability.
8. Tidak ada rollback discipline.
9. Tidak ada latency budget.
10. Aplikasi hanya monolith kecil dengan sedikit role.
11. Semua rule sangat imperative dan penuh side effect.
12. Policy harus melakukan query kompleks langsung ke database.
13. Tim belum bisa membedakan authentication, authorization, dan business validation.
14. Policy engine dipakai untuk menyembunyikan desain domain yang buruk.

Top 1% engineer tidak memilih tool karena tool terlihat modern. Ia memilih tool karena tool memperbaiki boundary, lifecycle, operability, dan correctness.

---

## 3. Hardcoded Authorization vs Externalized Policy

### 3.1 Hardcoded Authorization

Contoh:

```java
public void approveCase(User user, CaseRecord caseRecord) {
    if (!user.hasRole("SUPERVISOR")) {
        throw new AccessDeniedException("Only supervisor can approve case");
    }

    if (caseRecord.createdBy().equals(user.id())) {
        throw new AccessDeniedException("Maker cannot approve own case");
    }

    if (caseRecord.status() != CaseStatus.PENDING_APPROVAL) {
        throw new AccessDeniedException("Case is not pending approval");
    }

    caseRecord.approve(user.id());
}
```

Kelebihan:

1. Mudah dipahami oleh Java developer.
2. Type-safe jika domain model bagus.
3. Refactor-friendly.
4. Mudah di-debug di IDE.
5. Dekat dengan invariant domain.
6. Tidak butuh network call.
7. Tidak butuh policy runtime tambahan.

Kekurangan:

1. Rule tersebar.
2. Sulit diaudit sebagai policy.
3. Perubahan butuh build/deploy aplikasi.
4. Sulit disimulasikan secara terpusat.
5. Sulit dibaca policy/compliance owner.
6. Multi-service consistency sulit.
7. Policy diff sulit.
8. Banyak duplikasi.
9. Bisa bercampur dengan business validation.
10. Bisa bypass jika ada alternate path.

---

### 3.2 Externalized Policy

Contoh pseudo policy:

```text
permit approve_case when:
  subject has permission "case.approve"
  resource.status == "PENDING_APPROVAL"
  subject.id != resource.createdBy
  subject.agency == resource.agency
```

Java code:

```java
AuthorizationDecision decision = authorizationClient.authorize(
        AuthorizationRequest.builder()
                .subject(subject)
                .action("case.approve")
                .resource(caseResource)
                .context(requestContext)
                .build()
);

if (!decision.allowed()) {
    throw new AccessDeniedException(decision.safeReasonCode());
}

caseRecord.approve(subject.id());
```

Kelebihan:

1. Policy lifecycle bisa dipisahkan dari application release.
2. Rule bisa diuji sebagai artifact.
3. Policy bisa di-review oleh security/compliance.
4. Decision bisa logged bersama policy version.
5. Bisa dipakai lintas service.
6. Bisa simulate impact.
7. Bisa enforce consistent deny override.
8. Bisa support multi-tenant variation.
9. Bisa support central governance.
10. Bisa mempermudah audit.

Kekurangan:

1. Tambah runtime dependency.
2. Tambah latency.
3. Tambah failure mode.
4. Tambah bahasa/engine yang harus dipahami.
5. Type-safety menurun jika input schema buruk.
6. Debugging lebih sulit.
7. Policy bisa drift dari domain model.
8. Bisa menjadi distributed monolith.
9. Bisa fail-open jika desain salah.
10. Bisa membuat developer “outsourcing thinking” ke policy team.

---

## 4. PBAC Dalam Model PEP/PDP/PAP/PIP

Dari Part 3:

```text
PEP = Policy Enforcement Point
PDP = Policy Decision Point
PAP = Policy Administration Point
PIP = Policy Information Point
```

Dalam PBAC:

```text
Client / User
    |
    v
Application Endpoint / Service Method
    |
    v
PEP
    |
    | authorization request
    v
PDP
    |
    | loads policy
    v
Policy Store / Bundle / Repository
    |
    | loads attributes if needed
    v
PIP
    |
    v
Decision: Permit / Deny / NotApplicable / Indeterminate
    |
    v
PEP enforces decision
```

### 4.1 PEP Tetap Harus Ada Di Aplikasi

Kesalahan umum:

> “Karena ada central PDP, aplikasi tidak perlu memikirkan authorization.”

Salah.

Aplikasi tetap harus tahu:

1. Kapan harus meminta decision.
2. Apa subject-nya.
3. Apa action-nya.
4. Apa resource-nya.
5. Apa context-nya.
6. Apa efek decision.
7. Apa yang harus dilakukan saat deny.
8. Apa yang harus dilakukan saat PDP gagal.
9. Apa yang harus diaudit.
10. Bagaimana mencegah TOCTOU.
11. Bagaimana mencegah bypass via alternate path.

PDP membuat keputusan.  
PEP bertanggung jawab menegakkan keputusan.

Jika PEP salah, policy engine tidak menyelamatkan sistem.

---

### 4.2 PDP Tidak Boleh Menjadi Database Query Engine Umum

PDP seharusnya membuat decision dari input yang cukup dan data policy yang dikelola.

PDP tidak ideal jika setiap decision melakukan:

```text
query user table
query case table
query assignment table
query workflow table
query delegation table
query risk table
query audit table
```

Jika PDP menjadi mini-application yang query semua database, sistem akan:

1. Lambat.
2. Sulit di-scale.
3. Sulit diuji.
4. Sulit diobservasi.
5. Rentan circular dependency.
6. Rentan data consistency bug.
7. Rentan boundary violation.

Better pattern:

```text
Application/PIP prepares normalized attributes
PDP evaluates deterministic policy
PEP enforces decision
```

---

## 5. Decision Vocabulary

Policy engine sering punya decision lebih kaya dari boolean.

### 5.1 Basic Decision

```text
Permit
Deny
```

Java:

```java
public enum DecisionEffect {
    PERMIT,
    DENY
}
```

Namun boolean saja tidak cukup.

---

### 5.2 XACML-Style Decision Vocabulary

Banyak architecture authorization memakai vocabulary seperti:

```text
Permit
Deny
NotApplicable
Indeterminate
```

Maknanya:

| Decision | Meaning |
|---|---|
| `Permit` | Policy secara eksplisit mengizinkan |
| `Deny` | Policy secara eksplisit menolak |
| `NotApplicable` | Tidak ada policy yang berlaku |
| `Indeterminate` | Tidak bisa membuat keputusan karena error/ambiguity/missing attribute |

Dalam sistem production, `NotApplicable` dan `Indeterminate` harus diperlakukan hati-hati.

Rule aman:

```text
If no explicit permit exists, deny.
If decision is indeterminate, deny or fail safely.
```

---

### 5.3 Decision Dengan Reason, Obligation, Advice, Evidence

Decision matang biasanya bukan hanya:

```json
{
  "allow": false
}
```

Lebih baik:

```json
{
  "effect": "DENY",
  "reasonCode": "CASE_NOT_ASSIGNED_TO_SUBJECT",
  "policyId": "case-approval-policy",
  "policyVersion": "2026.06.19-1",
  "obligations": [],
  "advice": [
    "USER_CAN_REQUEST_ASSIGNMENT"
  ],
  "evaluatedAt": "2026-06-19T10:15:30Z"
}
```

Perbedaan penting:

| Element | Purpose |
|---|---|
| `effect` | Keputusan enforcement |
| `reasonCode` | Reason aman untuk aplikasi/log |
| `policyId` | Policy mana yang membuat keputusan |
| `policyVersion` | Versi policy |
| `obligations` | Hal yang wajib dilakukan jika permit |
| `advice` | Informasi non-binding |
| `evidence` | Fakta yang dipakai untuk decision |
| `traceId` | Observability/correlation |

---

### 5.4 Obligation

Obligation adalah instruksi wajib yang melekat pada decision.

Contoh:

```json
{
  "effect": "PERMIT",
  "obligations": [
    {
      "type": "MASK_FIELD",
      "field": "applicant.nric"
    },
    {
      "type": "AUDIT_ACCESS",
      "category": "SENSITIVE_CASE_VIEW"
    }
  ]
}
```

Makna:

> Akses boleh diberikan hanya jika PEP menjalankan obligations.

Jika PEP tidak mengerti obligation, sistem harus deny atau fail safely.

Danger:

```text
PDP returns PERMIT with MASK_FIELD obligation
PEP ignores obligation
Sensitive data leaks
```

Top 1% rule:

> Obligation is part of the decision contract, not decoration.

---

### 5.5 Advice

Advice adalah informasi opsional.

Contoh:

```json
{
  "effect": "DENY",
  "advice": [
    {
      "type": "REQUEST_PERMISSION",
      "permission": "case.read.sensitive"
    }
  ]
}
```

Advice boleh diabaikan tanpa merusak security.

---

## 6. Policy Language Design Concerns

Terlepas dari memakai Rego, Cedar, custom DSL, database-driven rules, atau Java-based policy, kita harus memikirkan beberapa hal.

### 6.1 Policy Harus Deterministic

Policy authorization harus deterministic untuk input yang sama.

Bad:

```text
allow if random() > 0.5
allow if current time fetched implicitly from engine
allow if HTTP call to unstable service returns true
```

Better:

```text
input.context.requestTime = "2026-06-19T10:15:30Z"
input.context.riskScore = 37
input.resource.status = "PENDING_APPROVAL"
```

Policy memakai input yang disediakan secara eksplisit.

Kenapa?

Karena audit butuh reconstruct:

```text
Given same policy version + same input snapshot => same decision
```

---

### 6.2 Policy Harus Punya Input Schema

Policy tanpa schema akan rapuh.

Bad:

```json
{
  "user": {
    "agency": "CEA"
  },
  "case": {
    "agencyId": "CEA"
  }
}
```

Policy writer bisa salah asumsi:

```text
user.agency == case.agency
```

Padahal field sebenarnya:

```text
case.agencyId
```

Better:

```json
{
  "subject": {
    "id": "u-123",
    "type": "HUMAN_USER",
    "agencyId": "CEA",
    "roles": ["CASE_OFFICER"],
    "permissions": ["case.read", "case.update"]
  },
  "action": {
    "name": "case.approve",
    "category": "WRITE"
  },
  "resource": {
    "type": "CASE",
    "id": "case-456",
    "tenantId": "tenant-sg",
    "agencyId": "CEA",
    "status": "PENDING_APPROVAL",
    "createdBy": "u-999",
    "assignedOfficerId": "u-123"
  },
  "context": {
    "requestId": "req-abc",
    "channel": "INTRANET",
    "requestTime": "2026-06-19T10:15:30Z",
    "environment": "PROD"
  }
}
```

Input schema harus:

1. Versioned.
2. Validated.
3. Documented.
4. Tested.
5. Backward compatible.
6. Reviewed bersama policy.

---

### 6.3 Policy Harus Bebas Side Effect

Policy authorization sebaiknya tidak:

1. Update database.
2. Publish event.
3. Send email.
4. Call external service dengan side effect.
5. Mutate resource.
6. Create audit event secara langsung.

Policy membuat decision.  
PEP atau application service mengeksekusi side effect sesuai decision.

Pattern:

```text
Policy returns obligation AUDIT_ACCESS
PEP publishes audit event
```

Bukan:

```text
Policy itself inserts audit row
```

---

### 6.4 Policy Harus Explicit Tentang Default

Bahaya:

```text
if no rule matches, allow
```

Better:

```text
default allow = false
```

Default deny adalah baseline.

Namun default deny saja belum cukup. Harus jelas per action/resource:

```text
No policy matched action=case.approve resourceType=CASE
=> DENY with reason POLICY_NOT_APPLICABLE
```

---

## 7. Policy Conflict Resolution

Jika policy makin banyak, conflict akan terjadi.

Contoh:

Policy A:

```text
Permit supervisor to approve case
```

Policy B:

```text
Deny user from approving own case
```

User adalah supervisor dan creator case.

Apa decision?

Harus ada combining algorithm.

### 7.1 Common Combining Strategies

| Strategy | Meaning |
|---|---|
| Deny overrides | Jika ada deny, result deny |
| Permit overrides | Jika ada permit, result permit |
| First applicable | Rule pertama yang match menang |
| Only one applicable | Error jika lebih dari satu match |
| Most specific wins | Rule paling spesifik menang |
| Priority-based | Rule dengan priority tertinggi menang |

---

### 7.2 Deny Overrides Untuk Security-Sensitive Domain

Untuk regulatory systems, deny override sering lebih aman.

Contoh:

```text
Permit:
  subject has permission case.approve

Deny:
  subject.id == resource.createdBy

Decision:
  DENY
```

Reason:

```text
Maker-checker invariant lebih kuat daripada general approve permission.
```

---

### 7.3 Priority-Based Policy Bisa Berbahaya

Priority terlihat fleksibel:

```text
priority 100 permit admin everything
priority 200 deny approve own case
```

Masalah:

1. Sulit dipahami.
2. Mudah salah urutan.
3. Bisa privilege escalation.
4. Review policy lebih sulit.
5. Test matrix membesar.

Jika memakai priority, wajib punya:

1. Strict convention.
2. Static lint.
3. Test untuk conflict.
4. Explicit conflict report.
5. Policy diff review.

---

## 8. Policy Granularity

### 8.1 Coarse-Grained Policy

Contoh:

```text
permit if subject has role ADMIN
```

Kelebihan:

1. Simpel.
2. Cepat.
3. Mudah di-cache.

Kekurangan:

1. Over-permissive.
2. Tidak cukup untuk object-level rule.
3. Mudah menjadi god-role.

---

### 8.2 Fine-Grained Policy

Contoh:

```text
permit approve if:
  subject has permission case.approve
  subject.agencyId == resource.agencyId
  resource.status == PENDING_APPROVAL
  subject.id != resource.createdBy
  subject.id in resource.approverPool
```

Kelebihan:

1. Lebih presisi.
2. Lebih defensible.
3. Lebih sesuai domain.

Kekurangan:

1. Input lebih besar.
2. Test lebih banyak.
3. Latency bisa naik.
4. Debugging lebih kompleks.
5. Perlu schema discipline.

---

### 8.3 Rule of Thumb

Gunakan coarse-grained policy untuk:

1. Route-level access.
2. High-level module access.
3. Admin UI entry point.
4. Feature enablement.

Gunakan fine-grained policy untuk:

1. Object read/update/delete.
2. State transition.
3. Approval.
4. Sensitive data view.
5. Export/report.
6. Cross-tenant boundary.
7. Delegation/acting role.
8. Break-glass.

---

## 9. Policy Input Design

Input design adalah bagian paling penting dalam PBAC.

Policy buruk sering bukan karena bahasa policy buruk, tapi karena input-nya buruk.

### 9.1 Canonical Input Shape

Direkomendasikan:

```json
{
  "subject": {},
  "action": {},
  "resource": {},
  "context": {}
}
```

Kenapa?

Karena ini memaksa developer berpikir:

1. Siapa yang bertindak?
2. Apa yang dilakukan?
3. Terhadap apa?
4. Dalam kondisi apa?

---

### 9.2 Subject

Subject minimal:

```json
{
  "id": "u-123",
  "type": "HUMAN_USER",
  "tenantId": "tenant-a",
  "agencyId": "agency-cea",
  "roles": ["CASE_OFFICER"],
  "permissions": ["case.read", "case.update"],
  "groups": ["investigation-team-a"]
}
```

Subject advanced:

```json
{
  "id": "u-123",
  "type": "HUMAN_USER",
  "tenantId": "tenant-a",
  "agencyId": "agency-cea",
  "departmentId": "dept-enforcement",
  "roles": [
    {
      "name": "CASE_OFFICER",
      "scope": {
        "agencyId": "agency-cea"
      },
      "activeFrom": "2026-01-01T00:00:00Z",
      "activeUntil": "2026-12-31T23:59:59Z"
    }
  ],
  "permissions": ["case.read", "case.update"],
  "delegations": [
    {
      "delegatorId": "u-999",
      "scope": "case.approve",
      "validUntil": "2026-06-30T23:59:59Z"
    }
  ],
  "risk": {
    "level": "LOW",
    "score": 12
  }
}
```

---

### 9.3 Action

Bad:

```json
"action": "update"
```

Better:

```json
{
  "name": "case.approve",
  "category": "WRITE",
  "sensitivity": "HIGH",
  "requiresAudit": true
}
```

Action should not be just HTTP method.

`POST /cases/{id}/approve` bukan hanya `POST`.  
Itu domain action: `case.approve`.

---

### 9.4 Resource

Resource minimal:

```json
{
  "type": "CASE",
  "id": "case-456"
}
```

Resource useful:

```json
{
  "type": "CASE",
  "id": "case-456",
  "tenantId": "tenant-a",
  "agencyId": "agency-cea",
  "status": "PENDING_APPROVAL",
  "createdBy": "u-999",
  "assignedOfficerId": "u-123",
  "sensitivity": "NORMAL",
  "caseType": "COMPLAINT",
  "version": 17
}
```

Resource input harus cukup untuk decision.

Jika policy butuh `createdBy` tapi input tidak membawa `createdBy`, maka engine akan menghasilkan:

1. Wrong deny.
2. Wrong allow.
3. Indeterminate.
4. Hidden extra lookup.

---

### 9.5 Context

Context:

```json
{
  "requestId": "req-123",
  "correlationId": "corr-456",
  "environment": "PROD",
  "channel": "INTRANET",
  "requestTime": "2026-06-19T10:15:30Z",
  "clientIpZone": "GOVERNMENT_NETWORK",
  "authStrength": "MFA",
  "sessionAgeMinutes": 12,
  "purpose": "CASE_PROCESSING"
}
```

Context harus eksplisit. Jangan biarkan policy engine diam-diam membaca global clock atau global environment.

---

## 10. Java Authorization Request Model

### 10.1 Java 8-Compatible Model

```java
import java.time.Instant;
import java.util.Collections;
import java.util.Map;
import java.util.Objects;

public final class AuthorizationRequest {
    private final SubjectDescriptor subject;
    private final ActionDescriptor action;
    private final ResourceDescriptor resource;
    private final AuthorizationContext context;

    private AuthorizationRequest(Builder builder) {
        this.subject = Objects.requireNonNull(builder.subject, "subject");
        this.action = Objects.requireNonNull(builder.action, "action");
        this.resource = Objects.requireNonNull(builder.resource, "resource");
        this.context = Objects.requireNonNull(builder.context, "context");
    }

    public SubjectDescriptor subject() {
        return subject;
    }

    public ActionDescriptor action() {
        return action;
    }

    public ResourceDescriptor resource() {
        return resource;
    }

    public AuthorizationContext context() {
        return context;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private SubjectDescriptor subject;
        private ActionDescriptor action;
        private ResourceDescriptor resource;
        private AuthorizationContext context;

        public Builder subject(SubjectDescriptor subject) {
            this.subject = subject;
            return this;
        }

        public Builder action(ActionDescriptor action) {
            this.action = action;
            return this;
        }

        public Builder resource(ResourceDescriptor resource) {
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

final class SubjectDescriptor {
    private final String id;
    private final String type;
    private final String tenantId;
    private final Map<String, Object> attributes;

    public SubjectDescriptor(
            String id,
            String type,
            String tenantId,
            Map<String, Object> attributes
    ) {
        this.id = Objects.requireNonNull(id, "id");
        this.type = Objects.requireNonNull(type, "type");
        this.tenantId = Objects.requireNonNull(tenantId, "tenantId");
        this.attributes = Collections.unmodifiableMap(
                Objects.requireNonNull(attributes, "attributes")
        );
    }

    public String id() {
        return id;
    }

    public String type() {
        return type;
    }

    public String tenantId() {
        return tenantId;
    }

    public Map<String, Object> attributes() {
        return attributes;
    }
}

final class ActionDescriptor {
    private final String name;
    private final Map<String, Object> attributes;

    public ActionDescriptor(String name, Map<String, Object> attributes) {
        this.name = Objects.requireNonNull(name, "name");
        this.attributes = Collections.unmodifiableMap(
                Objects.requireNonNull(attributes, "attributes")
        );
    }

    public String name() {
        return name;
    }

    public Map<String, Object> attributes() {
        return attributes;
    }
}

final class ResourceDescriptor {
    private final String type;
    private final String id;
    private final String tenantId;
    private final Map<String, Object> attributes;

    public ResourceDescriptor(
            String type,
            String id,
            String tenantId,
            Map<String, Object> attributes
    ) {
        this.type = Objects.requireNonNull(type, "type");
        this.id = Objects.requireNonNull(id, "id");
        this.tenantId = Objects.requireNonNull(tenantId, "tenantId");
        this.attributes = Collections.unmodifiableMap(
                Objects.requireNonNull(attributes, "attributes")
        );
    }

    public String type() {
        return type;
    }

    public String id() {
        return id;
    }

    public String tenantId() {
        return tenantId;
    }

    public Map<String, Object> attributes() {
        return attributes;
    }
}

final class AuthorizationContext {
    private final String requestId;
    private final Instant requestTime;
    private final Map<String, Object> attributes;

    public AuthorizationContext(
            String requestId,
            Instant requestTime,
            Map<String, Object> attributes
    ) {
        this.requestId = Objects.requireNonNull(requestId, "requestId");
        this.requestTime = Objects.requireNonNull(requestTime, "requestTime");
        this.attributes = Collections.unmodifiableMap(
                Objects.requireNonNull(attributes, "attributes")
        );
    }

    public String requestId() {
        return requestId;
    }

    public Instant requestTime() {
        return requestTime;
    }

    public Map<String, Object> attributes() {
        return attributes;
    }
}
```

Trade-off:

- Java 8-compatible.
- Verbose.
- Immutable.
- Bisa dipakai tanpa records.
- Map-based attributes fleksibel tetapi kurang type-safe.

---

### 10.2 Java 17+ Record-Based Model

Untuk Java 17+:

```java
import java.time.Instant;
import java.util.Map;

public record AuthorizationRequest(
        SubjectDescriptor subject,
        ActionDescriptor action,
        ResourceDescriptor resource,
        AuthorizationContext context
) {
    public AuthorizationRequest {
        if (subject == null) throw new IllegalArgumentException("subject is required");
        if (action == null) throw new IllegalArgumentException("action is required");
        if (resource == null) throw new IllegalArgumentException("resource is required");
        if (context == null) throw new IllegalArgumentException("context is required");
    }
}

public record SubjectDescriptor(
        String id,
        SubjectType type,
        String tenantId,
        Map<String, Object> attributes
) {}

public record ActionDescriptor(
        String name,
        Map<String, Object> attributes
) {}

public record ResourceDescriptor(
        String type,
        String id,
        String tenantId,
        Map<String, Object> attributes
) {}

public record AuthorizationContext(
        String requestId,
        Instant requestTime,
        Map<String, Object> attributes
) {}

public enum SubjectType {
    HUMAN_USER,
    SERVICE_ACCOUNT,
    SYSTEM_JOB,
    EXTERNAL_CLIENT
}
```

But note:

- Records are shallowly immutable.
- `Map` must still be defensively copied if mutation risk matters.
- Jangan menganggap record otomatis security-safe.

---

## 11. Java Authorization Decision Model

### 11.1 Basic Model

```java
public enum AuthorizationEffect {
    PERMIT,
    DENY,
    NOT_APPLICABLE,
    INDETERMINATE
}
```

```java
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class AuthorizationDecision {
    private final AuthorizationEffect effect;
    private final String reasonCode;
    private final String policyId;
    private final String policyVersion;
    private final List<Obligation> obligations;
    private final List<Advice> advice;
    private final Map<String, Object> evidence;
    private final Instant evaluatedAt;

    public AuthorizationDecision(
            AuthorizationEffect effect,
            String reasonCode,
            String policyId,
            String policyVersion,
            List<Obligation> obligations,
            List<Advice> advice,
            Map<String, Object> evidence,
            Instant evaluatedAt
    ) {
        this.effect = Objects.requireNonNull(effect, "effect");
        this.reasonCode = Objects.requireNonNull(reasonCode, "reasonCode");
        this.policyId = policyId;
        this.policyVersion = policyVersion;
        this.obligations = obligations;
        this.advice = advice;
        this.evidence = evidence;
        this.evaluatedAt = Objects.requireNonNull(evaluatedAt, "evaluatedAt");
    }

    public boolean isPermit() {
        return effect == AuthorizationEffect.PERMIT;
    }

    public boolean isDenyLike() {
        return effect == AuthorizationEffect.DENY
                || effect == AuthorizationEffect.NOT_APPLICABLE
                || effect == AuthorizationEffect.INDETERMINATE;
    }

    public AuthorizationEffect effect() {
        return effect;
    }

    public String reasonCode() {
        return reasonCode;
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

    public List<Advice> advice() {
        return advice;
    }

    public Map<String, Object> evidence() {
        return evidence;
    }

    public Instant evaluatedAt() {
        return evaluatedAt;
    }
}

public final class Obligation {
    private final String type;
    private final Map<String, Object> parameters;

    public Obligation(String type, Map<String, Object> parameters) {
        this.type = type;
        this.parameters = parameters;
    }

    public String type() {
        return type;
    }

    public Map<String, Object> parameters() {
        return parameters;
    }
}

public final class Advice {
    private final String type;
    private final Map<String, Object> parameters;

    public Advice(String type, Map<String, Object> parameters) {
        this.type = type;
        this.parameters = parameters;
    }

    public String type() {
        return type;
    }

    public Map<String, Object> parameters() {
        return parameters;
    }
}
```

---

### 11.2 Deny-Like Handling

Aplikasi tidak boleh memperlakukan `NOT_APPLICABLE` sebagai allow.

```java
public void enforce(AuthorizationDecision decision) {
    if (!decision.isPermit()) {
        throw new AccessDeniedException(decision.reasonCode());
    }

    executeObligations(decision.obligations());
}
```

Salah:

```java
if (decision.effect() != AuthorizationEffect.DENY) {
    allow();
}
```

Kenapa salah?

Karena `NOT_APPLICABLE` dan `INDETERMINATE` akan menjadi allow.

---

## 12. Policy Engine Integration Patterns

### 12.1 Embedded Policy Engine

Aplikasi memuat policy engine sebagai library.

```text
Java service
  ├── business code
  ├── embedded policy engine
  └── local policy bundle
```

Kelebihan:

1. Latency rendah.
2. Tidak ada network dependency.
3. Mudah fail-closed.
4. Cocok untuk high-throughput.
5. Cocok untuk offline/batch.

Kekurangan:

1. Policy engine harus compatible dengan JVM/app packaging.
2. Update policy butuh reload mechanism.
3. Setiap service bisa drift jika bundle version berbeda.
4. Observability policy harus dibangun sendiri.
5. Memory footprint di setiap service.

Use when:

1. Latency sangat sensitif.
2. Decision high-volume.
3. Policy relatif stabil.
4. Service bisa menerima bundle update.
5. Tidak ingin remote PDP sebagai SPOF.

---

### 12.2 Sidecar PDP

Aplikasi memanggil PDP lokal di same pod/host.

```text
Java service container
    |
    | localhost HTTP/gRPC
    v
Policy sidecar
    |
    v
Policy bundle
```

Kelebihan:

1. Isolasi engine dari aplikasi.
2. Latency lebih rendah dari remote PDP.
3. Policy update bisa dikelola sidecar.
4. Cocok di Kubernetes.
5. Bahasa aplikasi tidak harus support embedded engine.

Kekurangan:

1. Tambah deployment complexity.
2. Tambah local network call.
3. Sidecar health harus dimonitor.
4. Version skew masih mungkin.
5. Debugging lintas process.

Use when:

1. Kubernetes-native environment.
2. Banyak bahasa runtime.
3. Policy engine bukan Java-native.
4. Butuh centralized bundle distribution.
5. Ingin menghindari remote PDP latency.

---

### 12.3 Remote PDP Service

Aplikasi memanggil authorization service terpusat.

```text
Java service A
Java service B
Java service C
      |
      v
Central PDP service
      |
      v
Policy store + attribute services
```

Kelebihan:

1. Central governance.
2. Central audit.
3. Uniform decision behavior.
4. Easier policy rollout.
5. Easier policy simulation.
6. One place for advanced decision logic.

Kekurangan:

1. Network latency.
2. Availability dependency.
3. Potential bottleneck.
4. Need circuit breaker.
5. Need strong SLO.
6. Need multi-region strategy.
7. Dangerous if every request depends on remote PDP.
8. Risk of distributed monolith.

Use when:

1. Policy consistency lebih penting daripada local autonomy.
2. Banyak service harus share policy.
3. Butuh central audit.
4. Latency budget cukup.
5. PDP team punya operational maturity.

---

### 12.4 Hybrid

Pattern umum di enterprise matang:

```text
- Coarse route/module check: local
- Fine object/state decision: local or sidecar
- Rare admin/sensitive decision: remote PDP
- Policy bundle distribution: central
- Audit aggregation: central
```

Hybrid sering lebih realistis daripada ekstrem “semua local” atau “semua central”.

---

## 13. OPA/Rego Mental Model

Open Policy Agent adalah general-purpose policy engine. OPA menyediakan bahasa deklaratif Rego dan API untuk offload policy decision-making dari software aplikasi. Dalam arsitektur Java, OPA sering dipakai sebagai sidecar, service, atau policy evaluator di platform cloud-native.

### 13.1 Rego Thinking

Rego bukan Java.

Java biasanya berpikir:

```text
execute steps
mutate variables
return result
```

Rego lebih deklaratif:

```text
a fact is true if conditions are true
```

Contoh pseudo Rego:

```rego
package authorization.case

default allow := false

allow if {
    input.action.name == "case.approve"
    "case.approve" in input.subject.permissions
    input.resource.status == "PENDING_APPROVAL"
    input.subject.id != input.resource.createdBy
    input.subject.agencyId == input.resource.agencyId
}
```

Mental model:

```text
allow is true if all required facts are true.
Otherwise default allow is false.
```

---

### 13.2 OPA Input

OPA biasanya menerima JSON input.

Java harus membangun input dengan disiplin:

```json
{
  "subject": {
    "id": "u-123",
    "agencyId": "agency-cea",
    "permissions": ["case.approve"]
  },
  "action": {
    "name": "case.approve"
  },
  "resource": {
    "id": "case-456",
    "agencyId": "agency-cea",
    "status": "PENDING_APPROVAL",
    "createdBy": "u-999"
  },
  "context": {
    "requestTime": "2026-06-19T10:15:30Z"
  }
}
```

---

### 13.3 OPA Output

Jangan hanya minta boolean. Lebih baik policy mengembalikan object.

Pseudo:

```rego
decision := {
  "effect": effect,
  "reasonCode": reason,
  "policyId": "case-approval-policy",
  "policyVersion": data.policy.version,
}
```

Jika policy language sulit menghasilkan object yang rapi, bungkus di adapter layer.

---

### 13.4 OPA Integration from Java

Simple HTTP client style:

```java
public interface PolicyDecisionPoint {
    AuthorizationDecision authorize(AuthorizationRequest request);
}
```

```java
public final class OpaHttpPolicyDecisionPoint implements PolicyDecisionPoint {
    private final HttpClientAdapter httpClient;
    private final ObjectMapper objectMapper;
    private final URI opaDecisionUri;

    public OpaHttpPolicyDecisionPoint(
            HttpClientAdapter httpClient,
            ObjectMapper objectMapper,
            URI opaDecisionUri
    ) {
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
        this.opaDecisionUri = opaDecisionUri;
    }

    @Override
    public AuthorizationDecision authorize(AuthorizationRequest request) {
        OpaRequest opaRequest = new OpaRequest(request);

        HttpResponse response = httpClient.postJson(opaDecisionUri, opaRequest);

        if (response.statusCode() != 200) {
            return AuthorizationDecisions.indeterminate(
                    "PDP_HTTP_ERROR",
                    "opa",
                    null
            );
        }

        try {
            OpaResponse opaResponse = objectMapper.readValue(
                    response.body(),
                    OpaResponse.class
            );
            return OpaDecisionMapper.toDecision(opaResponse);
        } catch (RuntimeException ex) {
            return AuthorizationDecisions.indeterminate(
                    "PDP_RESPONSE_PARSE_ERROR",
                    "opa",
                    null
            );
        }
    }
}
```

Key principle:

> PDP error becomes `INDETERMINATE`, and PEP must treat it as deny-like unless explicitly configured otherwise for low-risk read-only paths.

---

## 14. Cedar Mental Model

Cedar adalah policy language untuk authorization decision. Cedar banyak dikenal karena model policy yang eksplisit atas `principal`, `action`, dan `resource`, serta support condition melalui `when`/`unless`.

### 14.1 Cedar Thinking

Cedar-style policy terlihat seperti:

```cedar
permit(
  principal,
  action == Action::"ViewCase",
  resource
)
when {
  principal.agency == resource.agency &&
  resource.status == "OPEN"
};
```

Mental model:

```text
Can principal perform action on resource under optional conditions?
```

Cedar cocok untuk policy yang ingin lebih dekat dengan natural authorization tuple:

```text
principal-action-resource
```

---

### 14.2 Cedar Entities

Cedar sering berpikir dengan entities:

```json
{
  "uid": {
    "type": "User",
    "id": "u-123"
  },
  "attrs": {
    "agency": "CEA"
  },
  "parents": [
    {
      "type": "Role",
      "id": "CaseOfficer"
    }
  ]
}
```

Entities bisa memodelkan:

1. User.
2. Role.
3. Group.
4. Resource.
5. Organization.
6. Parent relationship.

---

### 14.3 Cedar Strength

Cedar-style authorization kuat untuk:

1. Principal-action-resource clarity.
2. Entity relationship.
3. Human-readable policy.
4. RBAC + ABAC combinations.
5. Application authorization.

Namun sama seperti policy engine lain, tetap butuh:

1. Input schema.
2. Entity modeling discipline.
3. Test.
4. Versioning.
5. Operational model.

---

## 15. Custom DSL vs Existing Policy Engine

Kadang tim ingin membuat DSL sendiri.

### 15.1 Custom DSL Bisa Masuk Akal Jika

1. Domain sangat spesifik.
2. Policy writer bukan developer.
3. Bahasa existing terlalu general.
4. Butuh UX policy builder.
5. Scope rule dibatasi.
6. Ada tim yang mampu maintain parser/evaluator/tester.
7. Security review sanggup memvalidasi engine.
8. Tidak butuh general-purpose computation.

Contoh domain DSL:

```text
ALLOW case.approve
WHEN subject.permission CONTAINS "case.approve"
AND resource.status IS "PENDING_APPROVAL"
AND subject.id IS_NOT resource.createdBy
AND subject.agencyId IS resource.agencyId
DENY_REASON "MAKER_CHECKER_VIOLATION"
```

---

### 15.2 Custom DSL Berbahaya Jika

1. Dibangun tanpa formal semantics.
2. Tidak punya parser yang aman.
3. Pakai dynamic eval sembarangan.
4. Tidak punya conflict resolution.
5. Tidak punya test framework.
6. Tidak punya audit format.
7. Tidak punya versioning.
8. Tidak punya explainability.
9. Tidak punya safe default.
10. Menjadi Turing-complete tanpa kontrol.

Jangan membuat policy engine sendiri hanya karena ingin menghindari belajar OPA/Cedar. Membuat policy engine adalah tanggung jawab besar.

---

## 16. Database-Driven Policy

Banyak enterprise authorization memakai policy di database.

Contoh tables:

```sql
policy_rule
-----------
id
policy_set
effect
resource_type
action
condition_expression
priority
active_from
active_until
version
created_by
approved_by

policy_condition
----------------
id
rule_id
attribute_path
operator
expected_value
```

Kelebihan:

1. Mudah dibuat admin UI.
2. Bisa diedit tanpa deploy aplikasi.
3. Cocok untuk simple rules.
4. Bisa di-audit dengan DB history.
5. Familiar untuk enterprise team.

Kekurangan:

1. Sulit express complex rule.
2. Conflict resolution sering tidak jelas.
3. Test discipline sering lemah.
4. Bisa berubah langsung di production.
5. Versioning sering buruk.
6. Rollback sering manual.
7. Hard to review as code.
8. Query/evaluation bisa lambat.
9. Bisa menjadi rule spaghetti.

Jika memakai database-driven policy, tetap perlakukan sebagai policy artifact:

1. Exportable.
2. Versioned.
3. Reviewable.
4. Testable.
5. Promoted antar environment.
6. Rollbackable.
7. Diffable.

---

## 17. Policy Versioning

Policy version bukan kosmetik.

Audit bertanya:

> Pada 2026-06-19 10:15:30, kenapa user A boleh approve case B?

Jawaban sehat:

```text
Decision: DENY
Policy set: case-approval
Policy version: 2026.06.19+build.17
Rule matched: maker-checker-deny
Input snapshot hash: sha256:...
Reason: subject.id equals resource.createdBy
```

Jawaban buruk:

```text
Karena policy saat ini deny.
```

Masalah: policy saat ini mungkin bukan policy saat keputusan dibuat.

### 17.1 Version Identifier

Gunakan immutable policy version:

```text
case-policy@2026.06.19.001
```

Atau:

```text
git commit hash
bundle digest
semantic policy version
```

Yang penting:

1. Immutable.
2. Traceable.
3. Terkait artifact.
4. Tercatat di decision log.
5. Bisa direconstruct.

---

### 17.2 Policy Bundle

Policy bundle bisa berisi:

```text
policy-bundle/
  manifest.json
  schemas/
    authorization-input.schema.json
  policies/
    case.rego
    report.rego
    delegation.rego
  data/
    permission-catalog.json
    action-catalog.json
  tests/
    case_test.rego
    golden-decisions.json
```

Manifest:

```json
{
  "bundleId": "authorization-policy",
  "version": "2026.06.19.001",
  "createdAt": "2026-06-19T09:00:00Z",
  "gitCommit": "abc123",
  "inputSchemaVersion": "authz-input.v3",
  "compatibleApplicationVersions": [
    "case-service >= 4.12.0"
  ]
}
```

---

## 18. Policy Testing Strategy

Policy tanpa test adalah risiko production.

### 18.1 Unit Test Policy

Test satu policy rule.

Example:

```json
{
  "name": "deny maker approving own case",
  "input": {
    "subject": {
      "id": "u-123",
      "permissions": ["case.approve"],
      "agencyId": "CEA"
    },
    "action": {
      "name": "case.approve"
    },
    "resource": {
      "createdBy": "u-123",
      "agencyId": "CEA",
      "status": "PENDING_APPROVAL"
    }
  },
  "expected": {
    "effect": "DENY",
    "reasonCode": "MAKER_CANNOT_APPROVE_OWN_CASE"
  }
}
```

---

### 18.2 Golden Decision Tests

Golden decision tests menjaga behavior penting.

Matrix:

| Subject | Action | Resource State | Expected |
|---|---|---|---|
| Assigned officer | case.read | OPEN same agency | PERMIT |
| Other agency officer | case.read | OPEN other agency | DENY |
| Supervisor | case.approve | Pending, not creator | PERMIT |
| Supervisor creator | case.approve | Pending, creator | DENY |
| Admin | report.export | Sensitive report | DENY unless export permission |
| Break-glass user | case.read.sensitive | Emergency active | PERMIT with audit obligation |

Golden tests harus jalan di CI.

---

### 18.3 Mutation Testing for Authorization

Mutation testing authorization:

1. Remove agency condition.
2. Flip equality to inequality.
3. Remove status condition.
4. Remove maker-checker deny.
5. Change deny override to permit.
6. Remove tenant check.
7. Remove permission requirement.

Jika test tetap pass, test tidak cukup kuat.

---

### 18.4 Policy Compatibility Test

Setiap policy version harus diuji terhadap application input schema.

Check:

1. Policy tidak membaca field yang tidak ada.
2. Policy tidak mengasumsikan wrong type.
3. Policy handle missing optional field.
4. Policy rejects missing required field.
5. Policy handles unknown action safely.
6. Policy handles unknown resource type safely.
7. Policy handles unknown subject type safely.

---

## 19. Policy Deployment

### 19.1 Deployment Pipeline

Pipeline minimal:

```text
Author policy
    |
    v
Static validation
    |
    v
Schema validation
    |
    v
Unit tests
    |
    v
Golden decision tests
    |
    v
Security review
    |
    v
Build immutable bundle
    |
    v
Deploy to staging PDP
    |
    v
Shadow/simulation
    |
    v
Promote to production
    |
    v
Monitor decision metrics
```

---

### 19.2 Shadow Mode

Shadow mode:

```text
Application enforces old policy
Application also evaluates new policy
Compare decisions
Do not enforce new policy yet
```

Decision diff:

```json
{
  "requestId": "req-123",
  "oldDecision": {
    "effect": "PERMIT",
    "policyVersion": "2026.06.01"
  },
  "newDecision": {
    "effect": "DENY",
    "policyVersion": "2026.06.19"
  },
  "diffType": "PERMIT_TO_DENY"
}
```

Shadow mode penting untuk migration.

---

### 19.3 Blast Radius Analysis

Sebelum deploy:

```text
How many historical requests would change from PERMIT to DENY?
How many would change from DENY to PERMIT?
Which tenants/agencies/modules are affected?
Which high-risk actions are affected?
Which policies caused the diff?
```

Top 1% engineer tidak hanya bertanya “apakah test pass?”  
Ia bertanya “apa blast radius perubahan policy ini?”

---

### 19.4 Rollback

Policy rollback harus cepat dan deterministic.

Rollback artifact:

```text
current: policy-bundle@2026.06.19.001
rollback: policy-bundle@2026.06.10.004
```

Rollback harus tetap memperhatikan compatibility:

```text
Policy old version compatible with current app input schema?
```

Jika aplikasi sudah mengubah input schema, rollback policy bisa gagal.

Karena itu perlu:

1. Backward-compatible input schema.
2. Version negotiation.
3. Policy/app compatibility matrix.
4. Canary release.
5. Emergency deny-safe mode.

---

## 20. Runtime Failure Modeling

Policy-as-code menambah failure mode baru.

### 20.1 PDP Timeout

Scenario:

```text
PEP calls remote PDP
PDP does not respond within 100ms
```

Options:

1. Deny.
2. Fail request as 503.
3. Use cached decision.
4. Use fallback policy.
5. Allow for low-risk read-only operation.

Default recommended:

```text
Sensitive write: deny/fail closed
Sensitive read: deny/fail closed
Low-risk read: maybe cached decision if safe
Admin/break-glass: never silently allow
```

---

### 20.2 PDP Unavailable

Decision table:

| Action Type | Resource Sensitivity | Fallback |
|---|---|---|
| Approve/reject/delete/export | Any | Fail closed |
| Sensitive read | High | Fail closed |
| Normal read | Low | Use short-lived cached permit only if revocation risk accepted |
| Public content | Public | Local allow |
| Health check | N/A | Local allow |
| Internal maintenance | High | Fail closed or require local emergency procedure |

---

### 20.3 Policy Bundle Missing

If embedded/sidecar PDP starts without policy:

```text
Do not start serving protected traffic.
```

Better:

1. Startup validation.
2. Readiness probe fails.
3. Last-known-good bundle optional.
4. Bundle signature validation.
5. Bundle version logged.

---

### 20.4 Policy Parse Error

Parse error in new policy bundle:

1. Reject bundle.
2. Keep previous known-good bundle.
3. Emit alert.
4. Block promotion.
5. Do not switch to broken policy.

---

### 20.5 Indeterminate Decision

Indeterminate means policy could not decide due to missing attribute, type error, engine error, or ambiguous rule.

PEP handling:

```java
if (decision.effect() == AuthorizationEffect.INDETERMINATE) {
    auditIndeterminate(decision);
    throw new AccessDeniedException("AUTHORIZATION_INDETERMINATE");
}
```

Do not convert indeterminate to permit.

---

## 21. Caching Policy Decisions

### 21.1 What Can Be Cached?

Maybe cache:

1. Policy bundle.
2. Parsed policy.
3. Subject effective permission.
4. Resource attributes.
5. Relationship graph segment.
6. Decision for immutable low-risk resource.
7. Negative decision for short TTL.

Avoid caching blindly:

1. Break-glass decision.
2. Delegation decision near expiry.
3. High-risk action permit.
4. Tenant boundary decision with mutable membership.
5. Sensitive export decision.
6. Decision relying on rapidly changing state.

---

### 21.2 Decision Cache Key

Bad:

```text
cacheKey = subjectId + action
```

Danger:

```text
u-123 + case.read => permit
Then user reads other agency case
```

Better:

```text
cacheKey = hash(
  subject.id,
  subject.permissionVersion,
  action.name,
  resource.type,
  resource.id,
  resource.version,
  resource.tenantId,
  context.channel,
  policyVersion
)
```

Decision cache key harus mencakup semua input yang mempengaruhi decision.

---

### 21.3 Stale Permit Is More Dangerous Than Stale Deny

Stale deny causes inconvenience.  
Stale permit causes security breach.

Karena itu permit cache harus lebih ketat daripada deny cache.

---

### 21.4 Revocation

Jika user permission dicabut, cached permit harus invalidated.

Mechanisms:

1. Short TTL.
2. Permission version in token/session.
3. Subject entitlement version.
4. Event-based invalidation.
5. Tenant policy version.
6. Explicit cache bust.
7. No cache for high-risk operation.

---

## 22. Audit and Explainability

### 22.1 What to Log

Decision audit should include:

1. Request ID.
2. Subject ID.
3. Subject type.
4. Tenant ID.
5. Action.
6. Resource type.
7. Resource ID.
8. Resource tenant/agency.
9. Decision effect.
10. Reason code.
11. Policy ID.
12. Policy version.
13. Input schema version.
14. PDP mode: embedded/sidecar/remote.
15. Evaluation duration.
16. Obligation status.
17. Error if indeterminate.
18. Timestamp.

---

### 22.2 What Not to Log Carelessly

Avoid leaking:

1. Full PII.
2. Secrets.
3. Raw tokens.
4. Sensitive document content.
5. Full request payload if unnecessary.
6. Medical/legal/private content.
7. Excessive subject attributes.

Use:

1. IDs.
2. Hashes.
3. Classification labels.
4. Minimal evidence.
5. Field-level redaction.

---

### 22.3 Explainability Levels

Different audiences need different explanation.

| Audience | Explanation |
|---|---|
| End user | “You are not assigned to this case.” |
| Support | “Denied by case-assignment policy.” |
| Security auditor | “Rule maker-checker-deny matched policy version X.” |
| Developer | Full normalized input and rule trace in non-production |
| Compliance | Policy version, approval record, audit trail |

Do not expose internal policy details directly to user if it helps attackers.

---

## 23. Governance Model

Policy-as-code needs governance.

### 23.1 Who Owns Policy?

Possible owners:

1. Engineering.
2. Security.
3. Compliance.
4. Product.
5. Business operation.
6. Agency admin.
7. Platform team.

Bad model:

```text
Everyone can change policy.
No one owns correctness.
```

Better:

```text
Policy owner defines intent.
Engineer encodes policy.
Security reviews risk.
QA validates behavior.
System logs decision.
Release manager promotes artifact.
```

---

### 23.2 Policy Change Request

A policy change should capture:

1. Business reason.
2. Affected actions.
3. Affected resource types.
4. Affected subject groups.
5. Risk classification.
6. Expected behavior examples.
7. Deny examples.
8. Rollback plan.
9. Test cases.
10. Approval record.
11. Effective date.
12. Expiry date if temporary.

---

### 23.3 Temporary Policy

Temporary policy is dangerous.

Example:

```text
Allow support team to view all cases during migration weekend.
```

Must have:

1. Expiry.
2. Approver.
3. Scope.
4. Reason.
5. Extra audit.
6. Notification.
7. Post-event review.
8. Automatic removal.

Never rely on “remember to remove later”.

---

## 24. Policy Schema Evolution

### 24.1 Input Schema Versioning

Example:

```json
{
  "schemaVersion": "authz-input.v3",
  "subject": {},
  "action": {},
  "resource": {},
  "context": {}
}
```

When adding a field:

```text
v3 adds resource.sensitivity
```

Policy must handle absence if old services still send v2.

---

### 24.2 Backward Compatibility

Compatible change:

1. Add optional field.
2. Add new action with default deny.
3. Add new resource type with default deny.
4. Add new context attribute not required by old policy.

Breaking change:

1. Rename field.
2. Change type.
3. Remove required field.
4. Change semantics.
5. Change action name.
6. Change resource type meaning.

---

### 24.3 Semantic Versioning for Policy Inputs

Example:

```text
authz-input.v1
authz-input.v2
authz-input.v3
```

But version number alone is not enough. Document semantics:

```text
resource.ownerId means creator before v2
resource.ownerId means business owner after v3
```

That is a breaking semantic change.

---

## 25. Spring Security Integration Pattern

Spring Security modern authorization often centers around `AuthorizationManager` for request, method, and message authorization. PBAC integration can wrap external PDP in a custom `AuthorizationManager`.

### 25.1 Request-Level AuthorizationManager

```java
import java.util.function.Supplier;

import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

public final class PbacRequestAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final PolicyDecisionPoint pdp;
    private final AuthorizationRequestFactory requestFactory;

    public PbacRequestAuthorizationManager(
            PolicyDecisionPoint pdp,
            AuthorizationRequestFactory requestFactory
    ) {
        this.pdp = pdp;
        this.requestFactory = requestFactory;
    }

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext context
    ) {
        var request = requestFactory.fromHttpRequest(
                authentication.get(),
                context.getRequest()
        );

        var decision = pdp.authorize(request);

        return new AuthorizationDecision(decision.isPermit());
    }
}
```

Important:

1. Spring `AuthorizationDecision` boolean is not enough for audit.
2. You still need to log full internal `AuthorizationDecision`.
3. Do not lose reasonCode/policyVersion.
4. Do not do expensive object-level lookup at route level unless needed.

---

### 25.2 Method-Level Policy Enforcement

Better for object/state decision:

```java
public CaseDto approveCase(String caseId) {
    CaseRecord caseRecord = caseRepository.getById(caseId);

    AuthorizationRequest request = authorizationRequestFactory.forCaseAction(
            CurrentSubject.required(),
            "case.approve",
            caseRecord
    );

    AuthorizationDecision decision = authorizationService.authorize(request);
    authorizationService.enforce(decision);

    caseRecord.approve(CurrentSubject.required().id());
    return mapper.toDto(caseRecord);
}
```

This pattern is explicit and easier to audit.

---

### 25.3 Avoid Pure SpEL for Complex Policy

Bad:

```java
@PreAuthorize("hasAuthority('case.approve') and #case.createdBy != authentication.name and #case.status == 'PENDING_APPROVAL'")
```

Problems:

1. Logic hidden in annotation.
2. Hard to reuse.
3. Hard to test deeply.
4. Hard to version.
5. Hard to audit.
6. Easy to break during refactor.
7. Not good for complex domain policy.

Better:

```java
@PreAuthorize("@authorizationGuard.canApproveCase(authentication, #caseId)")
```

Or explicit service-level enforcement.

---

## 26. Jakarta EE Integration Pattern

Jakarta EE has declarative authorization primitives like `@RolesAllowed`, `@PermitAll`, `@DenyAll`, and container-level role checks. Jakarta Authorization defines a low-level SPI around permission repositories and subject-based security.

PBAC can integrate at different levels:

1. Container role remains coarse-grained guard.
2. Application service calls PDP for fine-grained decision.
3. JAX-RS filter/interceptor enforces route-level policy.
4. CDI interceptor enforces method-level policy.
5. Domain service enforces state/object policy.

Example CDI interceptor concept:

```java
@PolicyProtected(action = "case.approve", resource = "CASE")
public CaseDto approveCase(String caseId) {
    // interceptor can perform coarse decision
    // service still should load resource and enforce object/state decision
}
```

But beware:

> An interceptor that only knows `caseId` but not loaded `CaseRecord` cannot enforce maker-checker, state, tenant, or sensitivity rule unless it loads resource attributes.

---

## 27. Policy-as-Code For Regulatory Case Management

For regulatory/case management systems, policy is not just security. It is business defensibility.

### 27.1 Example Domain Rules

```text
Case officer can view assigned open cases.
Supervisor can approve cases in their agency.
Supervisor cannot approve own submitted recommendation.
Legal officer can view cases escalated to legal review.
Compliance admin can reassign case only before final decision.
Appeal officer cannot view enforcement notes unless appeal is accepted.
External user can view only their own submitted application.
Support user can view metadata but not sensitive attachments.
Break-glass access requires active incident and produces high-severity audit.
```

These are not simple roles. They combine:

1. RBAC.
2. ABAC.
3. State machine.
4. Assignment.
5. Separation of duty.
6. Tenant/agency boundary.
7. Resource sensitivity.
8. Workflow transition.
9. Audit obligation.
10. Temporal constraint.

PBAC helps because the rule becomes explicit and testable.

---

### 27.2 Example Policy Matrix

| Action | Required Capability | Resource Condition | Deny Override |
|---|---|---|---|
| `case.read` | `case.read` | same agency OR assigned | sealed case unless special permission |
| `case.update` | `case.update` | assigned and status open | locked/finalized |
| `case.submit_recommendation` | `case.recommend` | assigned and investigation complete | conflict of interest |
| `case.approve` | `case.approve` | pending approval and same agency | maker cannot approve own case |
| `case.reassign` | `case.reassign` | not finalized | cannot reassign to self if approver |
| `report.export` | `report.export` | report allowed for agency | sensitive export needs extra permission |

---

### 27.3 Policy Decision With Obligations

For sensitive case view:

```json
{
  "effect": "PERMIT",
  "reasonCode": "ASSIGNED_OFFICER_CAN_VIEW_SENSITIVE_CASE",
  "obligations": [
    {
      "type": "AUDIT",
      "category": "SENSITIVE_CASE_VIEW"
    },
    {
      "type": "WATERMARK_RESPONSE",
      "text": "Viewed by u-123 at 2026-06-19T10:15:30Z"
    }
  ]
}
```

PEP must:

1. Write audit.
2. Apply watermark.
3. Only then return response.

---

## 28. Anti-Patterns

### 28.1 Policy Engine As God Service

Bad:

```text
Every service calls central PDP for every tiny decision.
PDP queries every database.
PDP owns business logic.
PDP becomes bottleneck.
```

Result:

1. High latency.
2. Low availability.
3. Fragile architecture.
4. Hard ownership.
5. Slow delivery.

---

### 28.2 Policy Without Domain Model

Bad:

```text
policy checks generic fields:
  attr1 == attr2
  role == "X"
  type == "Y"
```

No one knows business meaning.

Better:

```text
subject.agencyId == resource.agencyId
resource.status == "PENDING_APPROVAL"
subject.id != resource.createdBy
```

---

### 28.3 Policy Without Tests

If policy changes can reach production without test, policy-as-code is an illusion.

---

### 28.4 Policy That Allows By Default

Bad:

```text
if unknown action, allow
```

Correct:

```text
unknown action => DENY / NOT_APPLICABLE
```

---

### 28.5 Policy That Trusts Client Input

Bad:

```json
{
  "subject": {
    "permissions": ["admin"]
  }
}
```

If this comes from browser request body, disaster.

Subject attributes must come from trusted server-side source.

---

### 28.6 Overloading JWT Claims As Policy Truth

Bad:

```text
JWT says user has agencyId=CEA and permissions=case.approve
therefore allow everything until token expires
```

Problems:

1. Stale claims.
2. Revocation delay.
3. Token bloat.
4. Trust boundary confusion.
5. Hard to model object-specific rules.

Use token as evidence, not full policy.

---

### 28.7 Ignoring Obligation

As discussed:

```text
PERMIT + MASK_FIELD obligation
```

If ignored, permit becomes unsafe.

---

### 28.8 Policy Drift Between Services

If service A uses policy v1 and service B uses policy v2, user journey can become inconsistent.

Need:

1. Version visibility.
2. Rollout strategy.
3. Compatibility testing.
4. Monitoring by policy version.

---

## 29. Failure Mode Table

| Failure Mode | Example | Impact | Mitigation |
|---|---|---|---|
| Missing policy | new action no policy | accidental allow/deny | default deny, policy coverage test |
| Wrong input schema | `agency` vs `agencyId` | wrong decision | schema validation |
| Stale attribute | old role cached | stale permit | TTL, versioned entitlement |
| PDP timeout | remote call hangs | latency/failure | timeout, circuit breaker, fail closed |
| Policy conflict | permit and deny match | privilege issue | combining algorithm |
| Ignored obligation | masking not applied | data leak | obligation enforcement contract |
| Policy rollback incompatible | old policy expects old schema | outage | compatibility matrix |
| Client-supplied attributes | user sends role | privilege escalation | trusted server-side attributes |
| Decision cache too broad | cache lacks resource id | cross-resource access | complete cache key |
| Shadow mode ignored | diffs not reviewed | unsafe rollout | release gate |
| No audit version | cannot reconstruct | regulatory failure | log policy version |
| Policy edited in prod | no review/test | unpredictable | immutable artifact promotion |

---

## 30. Production-Grade PBAC Checklist

### 30.1 Design Checklist

- [ ] Subject/action/resource/context model is explicit.
- [ ] Policy input schema is versioned.
- [ ] Policy output schema is versioned.
- [ ] Unknown action denies by default.
- [ ] Unknown resource type denies by default.
- [ ] Deny override strategy is explicit.
- [ ] Obligation semantics are documented.
- [ ] Decision reason code taxonomy exists.
- [ ] Tenant boundary is always part of input.
- [ ] Attribute trust source is documented.
- [ ] PDP mode is chosen deliberately: embedded/sidecar/remote/hybrid.
- [ ] Failure behavior is defined per action risk.
- [ ] Cache key includes all relevant decision inputs.
- [ ] Policy version appears in audit.
- [ ] Policy/app compatibility matrix exists.

---

### 30.2 Testing Checklist

- [ ] Policy unit tests.
- [ ] Golden decision tests.
- [ ] Negative tests.
- [ ] Mutation tests.
- [ ] Schema compatibility tests.
- [ ] Unknown action tests.
- [ ] Unknown resource tests.
- [ ] Missing attribute tests.
- [ ] Conflict resolution tests.
- [ ] Obligation tests.
- [ ] Shadow decision diff tests.
- [ ] Performance tests.
- [ ] Failure mode tests.
- [ ] Cache invalidation tests.

---

### 30.3 Operational Checklist

- [ ] PDP health check.
- [ ] PDP readiness check.
- [ ] Policy bundle version exposed.
- [ ] Last-known-good bundle available.
- [ ] Bundle signature/digest validation.
- [ ] Decision latency metrics.
- [ ] Permit/deny/indeterminate metrics.
- [ ] Deny reason distribution.
- [ ] Policy version distribution.
- [ ] PDP timeout alert.
- [ ] Indeterminate spike alert.
- [ ] Shadow diff dashboard.
- [ ] Emergency rollback procedure.
- [ ] Audit storage protected.
- [ ] Policy change approval logged.

---

## 31. Principal Engineer Design Heuristics

### 31.1 Do Not Externalize What You Cannot Name

If you cannot name:

1. Subject.
2. Action.
3. Resource.
4. Context.
5. Invariant.
6. Reason code.
7. Attribute source.

You are not ready to externalize policy.

---

### 31.2 Keep Domain Invariants Close To Domain

Some rules are pure authorization:

```text
Only assigned officer can view case.
```

Some rules are domain validity:

```text
Cannot approve a case that is already finalized.
```

Some rules are both:

```text
Supervisor can approve only pending case and cannot approve own recommendation.
```

When a rule is a core business invariant, do not hide it entirely in external policy without domain-level protection.

Better:

```text
Policy decides whether subject may attempt action.
Domain aggregate still protects invalid state transition.
```

Example:

```java
authorizationService.enforce(subject, "case.approve", caseRecord);
caseRecord.approve(subject.id());
```

Inside aggregate:

```java
public void approve(String approverId) {
    if (status != CaseStatus.PENDING_APPROVAL) {
        throw new InvalidStateTransitionException();
    }
    if (createdBy.equals(approverId)) {
        throw new MakerCheckerViolationException();
    }
    this.status = CaseStatus.APPROVED;
}
```

Why duplicate maker-checker?

Because it may be both:

1. Authorization invariant.
2. Domain integrity invariant.

Defense-in-depth is acceptable when each layer has clear responsibility.

---

### 31.3 Policy Engine Should Not Become A Place To Hide Messy Domain

If case state machine is unclear, PBAC will not fix it.

It will create policy like:

```text
allow if status in ["PENDING", "PENDING_2", "WAITING", "WAITING_APPROVAL", "PA", "P_APPROVE"]
```

That is not top 1% engineering. That is moving entropy.

Fix domain vocabulary first.

---

### 31.4 Prefer Explicit Decision Over Magic Annotation

For high-risk operation, explicit enforcement is often better:

```java
AuthorizationDecision decision = authorizationService.authorize(...);
authorizationService.enforce(decision);
```

Compared to hiding everything in annotation.

Annotations are good for:

1. Coarse route.
2. Simple method role.
3. Consistent infrastructure guard.

Explicit authorization is better for:

1. Object-level decision.
2. State transition.
3. Sensitive operation.
4. Obligation.
5. Audit evidence.
6. Complex denial reason.

---

## 32. Mini Capstone: Case Approval Policy

### 32.1 Requirement

A supervisor may approve a case if:

1. Subject is authenticated human user.
2. Subject has permission `case.approve`.
3. Resource is a case.
4. Case is in `PENDING_APPROVAL`.
5. Subject belongs to same agency as case.
6. Subject is not the creator.
7. Subject is not the recommendation submitter.
8. Case is not locked.
9. If case sensitivity is high, subject needs `case.approve.sensitive`.
10. Decision must be audited.
11. Deny reason must be safe.
12. PDP failure must not allow approval.

---

### 32.2 Authorization Input

```json
{
  "schemaVersion": "authz-input.v3",
  "subject": {
    "id": "u-123",
    "type": "HUMAN_USER",
    "tenantId": "tenant-sg",
    "agencyId": "CEA",
    "permissions": [
      "case.approve",
      "case.read"
    ]
  },
  "action": {
    "name": "case.approve",
    "category": "WRITE",
    "sensitivity": "HIGH"
  },
  "resource": {
    "type": "CASE",
    "id": "case-456",
    "tenantId": "tenant-sg",
    "agencyId": "CEA",
    "status": "PENDING_APPROVAL",
    "createdBy": "u-999",
    "recommendationSubmittedBy": "u-888",
    "locked": false,
    "sensitivity": "NORMAL",
    "version": 12
  },
  "context": {
    "requestId": "req-abc",
    "correlationId": "corr-def",
    "environment": "PROD",
    "channel": "INTRANET",
    "requestTime": "2026-06-19T10:15:30Z"
  }
}
```

---

### 32.3 Policy Intent

```text
default deny

deny if subject.type != HUMAN_USER
deny if action.name != case.approve
deny if resource.type != CASE
deny if subject.tenantId != resource.tenantId
deny if subject.agencyId != resource.agencyId
deny if resource.status != PENDING_APPROVAL
deny if resource.locked == true
deny if subject.id == resource.createdBy
deny if subject.id == resource.recommendationSubmittedBy
deny if resource.sensitivity == HIGH and subject lacks case.approve.sensitive

permit if subject has case.approve

permit decision includes AUDIT_CASE_APPROVAL_ATTEMPT obligation
```

---

### 32.4 Java Service Enforcement

```java
public CaseDto approveCase(String caseId) {
    SubjectDescriptor subject = currentSubjectProvider.requiredSubject();

    CaseRecord caseRecord = caseRepository.getByIdForUpdate(caseId);

    AuthorizationRequest request = authorizationRequestFactory.forCase(
            subject,
            "case.approve",
            caseRecord,
            RequestContext.current()
    );

    AuthorizationDecision decision = authorizationService.authorize(request);
    authorizationService.enforce(decision);

    // Domain invariant still protects state transition.
    caseRecord.approve(subject.id());

    caseRepository.save(caseRecord);

    auditPublisher.publishCaseApproval(
            subject.id(),
            caseRecord.id(),
            decision.policyId(),
            decision.policyVersion(),
            decision.reasonCode()
    );

    return caseMapper.toDto(caseRecord);
}
```

---

### 32.5 Important TOCTOU Note

If authorization checks case status before mutation, another transaction might change the case after decision.

Mitigation:

1. Load row with lock for high-risk mutation.
2. Include resource version in decision.
3. Revalidate domain invariant inside aggregate.
4. Commit transaction atomically.
5. Avoid check-before-load patterns.
6. For remote PDP latency, consider short transaction window carefully.

---

## 33. PBAC Learning Summary

PBAC is powerful because it turns authorization from scattered code into governed policy artifacts.

But PBAC is dangerous if:

1. Policy input is poorly modeled.
2. Policy has no tests.
3. Policy deployment is uncontrolled.
4. PDP failure behavior is undefined.
5. PEP ignores obligations.
6. Domain invariants are removed from domain.
7. Policy owner is unclear.
8. Audit cannot reconstruct historical decisions.

Top 1% understanding:

> Policy-as-code is not about moving `if` statements into another language. It is about creating a disciplined decision system where policy intent, decision execution, audit evidence, operational failure, and domain invariants are all explicitly modeled.

---

## 34. Practical Exercises

### Exercise 1 — Convert Hardcoded Logic To Policy Input

Given:

```java
if (user.hasRole("SUPERVISOR")
        && caseRecord.getAgencyId().equals(user.getAgencyId())
        && caseRecord.getStatus() == PENDING_APPROVAL
        && !caseRecord.getCreatedBy().equals(user.getId())) {
    allow();
}
```

Task:

1. Define subject/action/resource/context JSON.
2. Define policy rules.
3. Define deny reason codes.
4. Define tests.
5. Define audit fields.

---

### Exercise 2 — Failure Model

For each action below, define PDP failure behavior:

1. `case.read`
2. `case.read.sensitive`
3. `case.update`
4. `case.approve`
5. `report.export`
6. `user.permission.grant`
7. `health.read`

---

### Exercise 3 — Policy Conflict

Rules:

```text
Permit admin all case actions.
Deny all users from approving own case.
Permit delegated approver to approve assigned case.
Deny approval if case is locked.
```

Task:

1. Choose combining algorithm.
2. Explain why.
3. Create 8 test cases.
4. Identify which deny rule must override admin.

---

### Exercise 4 — Cache Key Design

Design decision cache key for:

```text
subject u-123 approving case-456
```

Include:

1. Subject entitlement version.
2. Resource version.
3. Policy version.
4. Tenant.
5. Action.
6. Context attributes.

Explain why each key component exists.

---

## 35. References

Official and authoritative references used for this part:

1. Open Policy Agent documentation — policy-as-code and decision offloading  
   <https://openpolicyagent.org/docs>

2. Open Policy Agent project overview  
   <https://openpolicyagent.org/>

3. Cedar Policy Language Reference Guide  
   <https://docs.cedarpolicy.com/>

4. Cedar open-source project organization  
   <https://github.com/cedar-policy>

5. Spring Security Authorization Architecture  
   <https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html>

6. Spring Security `AuthorizationManager` API reference  
   <https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/authorization/AuthorizationManager.html>

7. Jakarta Authorization Specification page  
   <https://jakarta.ee/specifications/authorization/>

8. Jakarta Security, Jakarta Authorization, and Jakarta Authentication explained  
   <https://jakarta.ee/learn/specification-guides/security-authorization-and-authentication-explained/>

---

## 36. Status Seri

Selesai:

- Part 0 — Authorization Mental Model: From “Role Check” to Decision System
- Part 1 — Authorization Vocabulary, Semantics, and Invariants
- Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
- Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
- Part 4 — RBAC Done Properly: Role-Based Access Control Beyond `ADMIN`
- Part 5 — Permission and Capability Modeling
- Part 6 — ABAC: Attribute-Based Authorization
- Part 7 — PBAC and Policy-as-Code

Belum selesai. Part berikutnya:

- Part 8 — ReBAC: Relationship-Based Authorization


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-006.md">⬅️ Part 6 — ABAC: Attribute-Based Authorization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-008.md">Part 8 — ReBAC: Relationship-Based Authorization ➡️</a>
</div>
