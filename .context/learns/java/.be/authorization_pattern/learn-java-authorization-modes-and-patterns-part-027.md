# Java Authorization Modes and Patterns — Advanced Engineering
## Part 27 — Auditability, Explainability, and Regulatory Defensibility

> Seri: `learn-java-authorization-modes-and-patterns`  
> File: `learn-java-authorization-modes-and-patterns-part-027.md`  
> Status: Part 27 dari maksimal 35 part  
> Target pembaca: engineer Java yang ingin mampu mendesain authorization system yang bukan hanya benar saat runtime, tetapi juga bisa dibuktikan, dijelaskan, diaudit, dan dipertahankan saat incident/regulatory review.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas failure semantics: bagaimana authorization gagal dengan aman, bagaimana membedakan `401`, `403`, `404`, bagaimana fail-closed, dan bagaimana menghindari data leakage dari error response.

Part ini membahas lapisan berikutnya:

> Setelah sistem mengambil keputusan authorization, apakah kita bisa membuktikan **siapa melakukan apa, terhadap resource apa, memakai policy versi apa, berdasarkan atribut apa, pada waktu apa, dari konteks apa, dan mengapa hasilnya allow/deny/error?**

Inilah inti **auditability, explainability, dan regulatory defensibility**.

Banyak sistem enterprise memiliki authorization yang “jalan”, tetapi gagal saat ditanya:

- Kenapa user ini bisa approve case itu?
- Kenapa user itu tidak bisa melihat record tersebut?
- Role mana yang memberi permission ini?
- Apakah permission itu masih valid saat kejadian?
- Policy apa yang dipakai pada tanggal tersebut?
- Apakah subject sedang impersonating/delegated/break-glass?
- Apakah resource attribute saat itu sama dengan sekarang?
- Apakah denial terjadi karena policy, missing data, timeout, stale cache, atau bug?
- Bisakah kita rekonstruksi keputusan 6 bulan lalu?

Top 1% engineer tidak hanya menulis `if (!allowed) throw new AccessDeniedException()`.

Mereka mendesain authorization sebagai **decision system with evidence**.

---

## 1. Core Mental Model

Authorization biasa menjawab:

```text
Can subject S perform action A on resource R in context C?
```

Auditability menambahkan:

```text
Can we later prove why decision D was produced for S, A, R, C?
```

Explainability menambahkan:

```text
Can humans understand the reason without reading source code or reconstructing the entire production database?
```

Regulatory defensibility menambahkan:

```text
Can the organization defend that the decision was correct, consistent, traceable, policy-based, and not silently manipulated?
```

Jadi decision bukan hanya boolean:

```java
boolean allowed = authorizationService.can(user, action, resource);
```

Decision harus punya struktur:

```text
AuthorizationDecision
├── outcome: ALLOW | DENY | INDETERMINATE | ERROR
├── reasonCode: CASE_ASSIGNED_OFFICER | MISSING_PERMISSION | CROSS_TENANT_DENIED | ...
├── subjectSnapshot
├── resourceSnapshot
├── action
├── contextSnapshot
├── matchedPolicies
├── evaluatedRules
├── evidence
├── obligations
├── policyVersion
├── decisionTime
├── correlationId
├── requestId
├── decisionId
└── auditClassification
```

### 1.1 The central invariant

> A security-sensitive authorization decision is incomplete unless it can produce evidence.

Evidence tidak selalu harus dikirim ke user. Bahkan biasanya tidak boleh. Tetapi evidence harus tersedia untuk audit, incident response, compliance, dan debugging yang aman.

---

## 2. Auditability vs Logging vs Monitoring

Tiga istilah ini sering dicampur.

### 2.1 Logging

Logging adalah aktivitas menulis event teknis atau bisnis ke log stream.

Contoh:

```text
WARN Access denied for user=123 action=CASE_APPROVE case=9001
```

Logging bagus, tetapi logging mentah tidak otomatis menjadi audit yang baik.

Masalah umum:

- format tidak konsisten,
- tidak punya reason code,
- tidak punya policy version,
- tidak punya resource snapshot,
- tidak bisa dicari,
- terlalu banyak PII,
- tidak immutable,
- tidak punya correlation ID,
- tidak bisa membedakan allow/deny/error,
- tidak bisa menjelaskan inherited role/delegation.

### 2.2 Monitoring

Monitoring menjawab:

```text
Apakah sistem sedang sehat dan apakah ada pola mencurigakan?
```

Contoh metric:

```text
authorization_decisions_total{outcome="deny",reason="cross_tenant"} 124
pdp_latency_seconds_bucket{le="0.05"} 9812
break_glass_activations_total 2
```

Monitoring penting untuk detection dan operation, tetapi biasanya tidak cukup untuk audit keputusan individual.

### 2.3 Audit

Audit menjawab:

```text
Apa yang terjadi, oleh siapa, terhadap apa, berdasarkan aturan apa, dan apakah bisa dibuktikan?
```

Audit event harus lebih stabil, terstruktur, dan punya lifecycle penyimpanan yang lebih kuat daripada application debug log.

### 2.4 Explainability

Explainability menjawab:

```text
Mengapa decision itu terjadi?
```

Contoh:

```text
DENY because subject agency_id=CEA cannot access resource agency_id=ROM.
Policy: tenant-boundary.v4
Rule: deny-cross-agency-access
```

Explainability bisa punya beberapa level:

| Level | Audience | Isi |
|---|---|---|
| User-facing | end user | Pesan aman: “You do not have access to this case.” |
| Support-facing | support/operator | Reason code dan correlation ID |
| Security-facing | security/audit | Full policy/rule/evidence |
| Engineering-facing | developer/SRE | Trace, attributes, latency, cache status |

### 2.5 Regulatory defensibility

Regulatory defensibility adalah kemampuan organisasi untuk menunjukkan bahwa:

1. keputusan authorization mengikuti policy yang disetujui,
2. policy tersebut berlaku saat kejadian,
3. input decision berasal dari sumber yang dapat dipercaya,
4. event dicatat dengan lengkap,
5. log/audit tidak mudah dimanipulasi,
6. exception seperti break-glass/delegation punya justifikasi,
7. review dan approval lifecycle bisa ditelusuri.

---

## 3. Why Auditability Is Hard in Authorization

Authorization sulit diaudit karena decision sering bergantung pada banyak input dinamis.

Contoh sederhana:

```text
Officer boleh approve case jika:
- officer punya permission CASE_APPROVE,
- officer berada di agency yang sama dengan case,
- officer assigned ke case tersebut,
- officer bukan maker/submitter case,
- case berada di state PENDING_APPROVAL,
- officer tidak dalam suspended role,
- action dilakukan dalam valid delegation window,
- tidak sedang memakai break-glass kecuali reason diberikan,
- policy version saat itu adalah v12.
```

Jika 6 bulan kemudian case sudah pindah state, user pindah agency, role dicabut, delegation expired, dan policy sudah v14, maka query ke database hari ini tidak bisa menjelaskan keputusan masa lalu.

Karena itu audit authorization membutuhkan **snapshot**, bukan hanya foreign key.

---

## 4. Decision Event as a First-Class Artifact

Top-level design:

```text
Every security-relevant authorization decision emits a structured decision event.
```

Namun tidak semua decision harus disimpan dengan detail yang sama.

### 4.1 Decision categories

| Category | Example | Audit detail |
|---|---|---|
| Low-risk allow | View public page | minimal atau sampled |
| Normal business allow | View assigned case | structured event, maybe compressed |
| Sensitive allow | Approve/reject/export/delete | full decision evidence |
| Deny | Unauthorized access attempt | structured event |
| Error/indeterminate | PDP timeout, missing attribute | structured event + alert candidate |
| Privileged allow | admin/support/break-glass | full evidence + mandatory reason |
| Cross-boundary deny | tenant/agency mismatch | full evidence, security-visible |

### 4.2 Decision event minimal schema

```json
{
  "event_type": "AUTHZ_DECISION",
  "event_version": "1.0",
  "decision_id": "authz_01HX...",
  "decision_time": "2026-06-19T10:15:30.123Z",
  "outcome": "DENY",
  "reason_code": "CROSS_TENANT_DENIED",
  "subject": {
    "subject_id": "user:12345",
    "principal_type": "HUMAN_USER",
    "display_hash": "sha256:...",
    "tenant_id": "CEA",
    "agency_id": "CEA",
    "roles": ["CASE_OFFICER"],
    "permissions": ["case.read", "case.update"]
  },
  "action": "case.approve",
  "resource": {
    "resource_type": "CASE",
    "resource_id": "case:9001",
    "tenant_id": "ROM",
    "state": "PENDING_APPROVAL",
    "owner_user_id": "user:888"
  },
  "context": {
    "request_id": "req_abc",
    "correlation_id": "corr_xyz",
    "channel": "WEB",
    "client_app": "aceas-web",
    "ip_hash": "sha256:...",
    "session_id_hash": "sha256:...",
    "delegation_id": null,
    "break_glass_id": null
  },
  "policy": {
    "policy_set_id": "case-access",
    "policy_version": "2026.06.18.3",
    "matched_rules": ["deny-cross-tenant-access"]
  },
  "evaluation": {
    "pdp_mode": "LOCAL_LIBRARY",
    "cache_status": "MISS",
    "latency_ms": 4,
    "attribute_sources": ["user-directory", "case-db", "assignment-db"]
  }
}
```

Ini tidak selalu disimpan dalam bentuk JSON mentah. Tetapi struktur konseptualnya harus ada.

---

## 5. Outcome Model: More Than Allow/Deny

Authorization sering direduksi menjadi boolean. Untuk audit, boolean tidak cukup.

Gunakan outcome yang lebih eksplisit:

```java
public enum AuthorizationOutcome {
    ALLOW,
    DENY,
    INDETERMINATE,
    ERROR
}
```

### 5.1 ALLOW

Decision positif. Subject boleh melakukan action.

Tetap perlu reason untuk sensitive action.

Contoh:

```text
ALLOW: user has permission case.approve, is assigned reviewer, case is PENDING_APPROVAL, and user is not maker.
```

### 5.2 DENY

Policy berhasil dievaluasi dan hasilnya tidak boleh.

Contoh:

```text
DENY: subject agency does not match resource agency.
```

### 5.3 INDETERMINATE

Policy tidak bisa memberi jawaban pasti karena input tidak cukup atau conflict.

Contoh:

```text
INDETERMINATE: resource owner attribute missing.
```

Dalam banyak sistem high-security, `INDETERMINATE` harus diperlakukan sebagai deny pada enforcement point.

### 5.4 ERROR

Terjadi error teknis:

- PDP timeout,
- database down,
- attribute service unavailable,
- invalid policy bundle,
- serialization failure.

`ERROR` bukan deny semantik. Tetapi enforcement biasanya tetap fail-closed.

### 5.5 Why distinction matters

Jika semua gagal menjadi `403`, operator tidak bisa membedakan:

- user memang tidak punya permission,
- policy service mati,
- resource tidak ditemukan,
- data tenant corrupt,
- cache stale,
- policy conflict,
- bug runtime.

External response bisa tetap aman, tetapi internal decision event harus jelas.

---

## 6. Reason Codes

Reason code adalah vocabulary stabil untuk menjelaskan decision.

Jangan mengandalkan free-text message seperti:

```text
User cannot approve this case.
```

Gunakan code:

```text
MISSING_PERMISSION
CROSS_TENANT_DENIED
RESOURCE_NOT_ASSIGNED
STATE_TRANSITION_NOT_ALLOWED
MAKER_CHECKER_VIOLATION
DELEGATION_EXPIRED
BREAK_GLASS_REASON_REQUIRED
POLICY_INPUT_MISSING
PDP_TIMEOUT_FAIL_CLOSED
```

### 6.1 Reason code qualities

Reason code yang baik:

1. stabil,
2. machine-readable,
3. tidak mengandung PII,
4. bisa dipakai untuk metric,
5. bisa dipakai untuk support troubleshooting,
6. bisa dipakai dalam audit report,
7. bisa di-map ke user-safe message.

### 6.2 Reason taxonomy

```text
AUTHZ_REASON
├── SUBJECT
│   ├── SUBJECT_NOT_AUTHENTICATED
│   ├── SUBJECT_DISABLED
│   ├── SUBJECT_ROLE_SUSPENDED
│   └── SUBJECT_CLEARANCE_TOO_LOW
├── PERMISSION
│   ├── MISSING_PERMISSION
│   ├── MISSING_SCOPE
│   └── PERMISSION_EXPIRED
├── RESOURCE
│   ├── RESOURCE_NOT_FOUND_OR_HIDDEN
│   ├── RESOURCE_NOT_ASSIGNED
│   └── RESOURCE_STATE_NOT_ALLOWED
├── BOUNDARY
│   ├── CROSS_TENANT_DENIED
│   ├── CROSS_AGENCY_DENIED
│   └── CROSS_ORG_DENIED
├── DUTY
│   ├── MAKER_CHECKER_VIOLATION
│   ├── SEGREGATION_OF_DUTY_VIOLATION
│   └── SELF_APPROVAL_DENIED
├── CONTEXT
│   ├── OUTSIDE_ALLOWED_TIME_WINDOW
│   ├── CHANNEL_NOT_ALLOWED
│   └── STEP_UP_REQUIRED
├── DELEGATION
│   ├── DELEGATION_NOT_FOUND
│   ├── DELEGATION_EXPIRED
│   └── DELEGATION_SCOPE_TOO_NARROW
├── BREAK_GLASS
│   ├── BREAK_GLASS_REASON_REQUIRED
│   ├── BREAK_GLASS_NOT_APPROVED
│   └── BREAK_GLASS_EXPIRED
└── SYSTEM
    ├── ATTRIBUTE_MISSING
    ├── POLICY_CONFLICT
    ├── PDP_TIMEOUT_FAIL_CLOSED
    └── POLICY_BUNDLE_INVALID
```

### 6.3 User message mapping

Internal:

```text
CROSS_AGENCY_DENIED: subject agency CEA cannot access resource agency ROM.
```

External:

```text
You do not have access to this resource.
```

Support:

```text
Access denied. Reason code: CROSS_AGENCY_DENIED. Correlation ID: corr_xyz.
```

Audit:

```text
Denied by policy tenant-boundary.v7 rule deny-cross-agency-access because subject.agency_id != resource.agency_id.
```

---

## 7. Snapshot vs Reference

A core audit mistake is storing only IDs.

Bad audit event:

```json
{
  "user_id": "123",
  "case_id": "9001",
  "outcome": "ALLOW"
}
```

Six months later, user `123` may have different roles. Case `9001` may have different agency/state/assignment. The original decision becomes unreconstructable.

### 7.1 Reference

Reference points to current state:

```text
user_id=123
case_id=9001
role_id=CASE_OFFICER
```

### 7.2 Snapshot

Snapshot records relevant decision state at the time:

```text
subject.agency_id=CEA
subject.effective_roles=[CASE_OFFICER]
subject.effective_permissions=[case.read, case.update]
resource.case_state=PENDING_REVIEW
resource.agency_id=CEA
resource.assigned_officer_id=123
context.channel=WEB
policy_version=2026.06.19.1
```

### 7.3 Rule of thumb

Store both:

```text
reference + minimal decision snapshot
```

References allow joining to current entities. Snapshots allow reconstructing historical decision.

### 7.4 Snapshot minimization

Do not snapshot everything. Snapshot only attributes used or needed to explain the decision.

Example:

If policy evaluates:

```text
subject.agency_id == resource.agency_id
subject.id in resource.assigned_reviewer_ids
resource.state == PENDING_APPROVAL
subject.id != resource.created_by
```

Then snapshot:

```text
subject.id
subject.agency_id
resource.id
resource.agency_id
resource.assigned_reviewer_ids or derived assignment_match=true
resource.state
resource.created_by or derived self_approval=false
```

For privacy, sometimes store derived facts instead of raw attribute.

Example:

```json
{
  "assignment_match": true,
  "same_agency": true,
  "self_approval": false
}
```

This can reduce sensitive data exposure while preserving explainability.

---

## 8. Subject Snapshot

Subject snapshot captures the effective authorization identity at decision time.

### 8.1 Fields

```text
subject_id
subject_type: HUMAN_USER | SERVICE_ACCOUNT | BATCH_JOB | SYSTEM | AGENT
principal_id
account_status
tenant_id
agency_id
org_unit_id
roles
scoped_roles
permissions
clearance/risk tier if used
delegation state
impersonation state
break-glass state
assurance level if used
```

### 8.2 Human user vs service account

Human user:

```json
{
  "subject_type": "HUMAN_USER",
  "subject_id": "user:123",
  "principal_id": "idp:singpass:...",
  "agency_id": "CEA",
  "roles": ["CASE_REVIEWER"],
  "effective_permissions": ["case.read", "case.approve"]
}
```

Service account:

```json
{
  "subject_type": "SERVICE_ACCOUNT",
  "subject_id": "svc:case-syncer",
  "workload": "case-syncer",
  "namespace": "intranet-prod",
  "permissions": ["case.sync.write"]
}
```

Batch job:

```json
{
  "subject_type": "BATCH_JOB",
  "subject_id": "job:daily-case-reconciliation",
  "triggered_by": "scheduler",
  "run_id": "run_20260619_010000"
}
```

### 8.3 Acting identity

When delegation/impersonation exists, snapshot both:

```json
{
  "actor": "support:user:100",
  "effective_subject": "user:123",
  "acting_mode": "IMPERSONATION",
  "impersonation_ticket_id": "ticket:INC-1234"
}
```

Never overwrite actor with effective subject only. That destroys accountability.

---

## 9. Resource Snapshot

Resource snapshot captures the authorization-relevant state of the object.

### 9.1 Fields

```text
resource_type
resource_id
resource_tenant_id
resource_agency_id
owner_user_id
assigned_user_ids
state/status
classification/sensitivity
case_type/category
created_by
current_stage
version/revision
```

### 9.2 Avoid full payload dump

Do not dump entire business object into audit event.

Bad:

```json
{
  "case": {
    "fullName": "...",
    "address": "...",
    "financialData": "...",
    "medicalData": "..."
  }
}
```

Better:

```json
{
  "resource": {
    "resource_type": "CASE",
    "resource_id": "case:9001",
    "agency_id": "CEA",
    "state": "PENDING_APPROVAL",
    "classification": "RESTRICTED",
    "assigned_reviewer_match": true,
    "resource_version": 17
  }
}
```

### 9.3 Resource version is important

If domain object is mutable, record resource version/revision.

Example:

```text
case_id=9001
case_version=17
state=PENDING_APPROVAL
```

This helps answer:

```text
Was the resource already approved when user clicked approve?
Was authorization checked against stale state?
Was there concurrent update after authorization?
```

---

## 10. Context Snapshot

Context is often the difference between normal access and suspicious/denied access.

### 10.1 Common context fields

```text
decision_time
request_id
correlation_id
trace_id
session_id_hash
ip_hash or subnet classification
user_agent_hash or device_id
channel: WEB | API | BATCH | INTERNAL | MOBILE
client_app
tenant_context
route/method
operation/command
transaction_id
risk_score
assurance_level
step_up_status
```

### 10.2 Why hash some fields

Fields like IP address, session ID, user agent, device ID may be sensitive.

Options:

1. store raw in restricted security audit store,
2. store hashed in application audit,
3. store coarse classification only,
4. store both raw and derived in separate stores with different retention.

Example:

```json
{
  "ip_hash": "sha256:salt-version-3:...",
  "network_zone": "GOV_INTRANET",
  "geo_region": "SG"
}
```

### 10.3 Correlation ID

Every authorization decision should connect to:

```text
HTTP request
service call
database mutation
business audit event
security event
trace span
support ticket if applicable
```

This requires consistent propagation:

```text
X-Correlation-ID
traceparent
request_id
message_id
job_run_id
```

---

## 11. Policy Version and Rule Trace

A regulatory-quality decision must record which policy was used.

### 11.1 Minimum policy metadata

```json
{
  "policy_set_id": "case-approval-policy",
  "policy_version": "2026.06.19.2",
  "policy_hash": "sha256:...",
  "matched_rules": ["allow-assigned-reviewer-approve"],
  "deny_rules": [],
  "combiner": "DENY_OVERRIDES"
}
```

### 11.2 Why policy version matters

Suppose policy changed today:

```text
Old: senior reviewer may approve high-risk case.
New: high-risk case requires legal reviewer too.
```

If an approval happened yesterday, current policy cannot be used to judge yesterday’s decision.

You need:

```text
policy version at decision time
policy source/hash
policy deployment timestamp
approval record for policy change
```

### 11.3 Rule trace depth

Do not always log full policy AST/evaluation tree. That can be huge and may leak sensitive logic.

Use levels:

| Level | Content |
|---|---|
| L0 | outcome only |
| L1 | reason code |
| L2 | matched rule IDs |
| L3 | attributes used + evaluated facts |
| L4 | full trace for debug/security restricted store |

For sensitive mutations, L2/L3 is usually minimum.

---

## 12. Attribute Provenance

If decision uses attributes, audit must know where they came from.

Example attributes:

```text
subject.roles
subject.agency_id
resource.state
resource.assigned_user_ids
context.risk_score
```

### 12.1 Attribute source metadata

```json
{
  "attributes": [
    {
      "name": "subject.roles",
      "source": "iam-db",
      "source_version": "user-role-rev-9912",
      "freshness_ms": 120,
      "trust_level": "AUTHORITATIVE"
    },
    {
      "name": "resource.state",
      "source": "case-db",
      "source_version": "case-version-17",
      "freshness_ms": 4,
      "trust_level": "AUTHORITATIVE"
    },
    {
      "name": "context.risk_score",
      "source": "risk-engine",
      "freshness_ms": 900,
      "trust_level": "DERIVED"
    }
  ]
}
```

### 12.2 Why provenance matters

If a user was incorrectly allowed, possible causes:

- role assignment wrong,
- role cache stale,
- resource owner attribute stale,
- policy wrong,
- PDP bug,
- PIP source unavailable and fallback allowed,
- context spoofed,
- request carried untrusted tenant ID.

Without provenance, all look like “authorization bug”.

---

## 13. Decision Evidence Design

Evidence is the set of facts used to support decision.

### 13.1 Evidence examples

ALLOW evidence:

```json
{
  "reason_code": "ASSIGNED_REVIEWER_ALLOWED",
  "facts": {
    "has_permission_case_approve": true,
    "same_agency": true,
    "assigned_reviewer": true,
    "case_state_allowed": true,
    "self_approval": false
  }
}
```

DENY evidence:

```json
{
  "reason_code": "MAKER_CHECKER_VIOLATION",
  "facts": {
    "created_by_subject": true,
    "action": "case.approve",
    "policy_rule": "deny-self-approval"
  }
}
```

### 13.2 Evidence should be stable, not overly implementation-specific

Bad:

```text
Denied because CaseApprovalPolicy.java line 87 returned false.
```

Better:

```text
Denied because rule deny-self-approval matched: subject.id == resource.createdBy.
```

Implementation can change. Policy rule identity should remain meaningful.

### 13.3 Derived facts reduce sensitivity

Instead of storing:

```json
{
  "subject_id": "user:123",
  "created_by": "user:123"
}
```

store:

```json
{
  "self_approval": true
}
```

But for high-stakes audit you may also need references in restricted store.

Design split:

```text
business audit event: derived facts
security audit event: references + derived facts
forensic store: full restricted evidence
```

---

## 14. Obligations and Advice

Some authorization decisions are not simple allow/deny.

Policy may say:

```text
ALLOW, but mask NRIC.
ALLOW, but require audit reason.
ALLOW, but require second approver.
ALLOW, but watermark exported PDF.
ALLOW, but notify owner.
```

These are obligations/advice.

### 14.1 Obligation

Obligation is mandatory for enforcement.

Example:

```json
{
  "outcome": "ALLOW",
  "obligations": [
    { "type": "MASK_FIELD", "field": "nric" },
    { "type": "AUDIT_REASON_REQUIRED" }
  ]
}
```

If PEP cannot fulfill obligation, it must deny or error.

### 14.2 Advice

Advice is non-mandatory hint.

Example:

```json
{
  "advice": [
    { "type": "DISPLAY_WARNING", "message_code": "SENSITIVE_CASE" }
  ]
}
```

### 14.3 Audit obligations

Audit event must record whether obligations were fulfilled.

```json
{
  "obligations": [
    { "type": "MASK_FIELD", "field": "nric", "fulfilled": true },
    { "type": "WATERMARK_EXPORT", "fulfilled": true }
  ]
}
```

Otherwise an allow decision with unfulfilled masking may become data leakage.

---

## 15. Java Domain Model for Auditable Decisions

### 15.1 Java 8-compatible model

```java
public final class AuthorizationDecision {
    private final String decisionId;
    private final AuthorizationOutcome outcome;
    private final ReasonCode reasonCode;
    private final SubjectSnapshot subject;
    private final ResourceSnapshot resource;
    private final AuthorizationAction action;
    private final ContextSnapshot context;
    private final PolicyTrace policyTrace;
    private final Evidence evidence;
    private final List<Obligation> obligations;
    private final Instant decisionTime;

    private AuthorizationDecision(Builder builder) {
        this.decisionId = requireNonBlank(builder.decisionId, "decisionId");
        this.outcome = Objects.requireNonNull(builder.outcome, "outcome");
        this.reasonCode = Objects.requireNonNull(builder.reasonCode, "reasonCode");
        this.subject = Objects.requireNonNull(builder.subject, "subject");
        this.resource = Objects.requireNonNull(builder.resource, "resource");
        this.action = Objects.requireNonNull(builder.action, "action");
        this.context = Objects.requireNonNull(builder.context, "context");
        this.policyTrace = Objects.requireNonNull(builder.policyTrace, "policyTrace");
        this.evidence = Objects.requireNonNull(builder.evidence, "evidence");
        this.obligations = Collections.unmodifiableList(new ArrayList<>(builder.obligations));
        this.decisionTime = Objects.requireNonNull(builder.decisionTime, "decisionTime");
    }

    public boolean isAllowed() {
        return outcome == AuthorizationOutcome.ALLOW;
    }

    public AuthorizationDeniedException toDeniedException() {
        return new AuthorizationDeniedException(reasonCode.name(), decisionId);
    }

    private static String requireNonBlank(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String decisionId;
        private AuthorizationOutcome outcome;
        private ReasonCode reasonCode;
        private SubjectSnapshot subject;
        private ResourceSnapshot resource;
        private AuthorizationAction action;
        private ContextSnapshot context;
        private PolicyTrace policyTrace;
        private Evidence evidence;
        private List<Obligation> obligations = new ArrayList<>();
        private Instant decisionTime;

        public Builder decisionId(String decisionId) {
            this.decisionId = decisionId;
            return this;
        }

        public Builder outcome(AuthorizationOutcome outcome) {
            this.outcome = outcome;
            return this;
        }

        public Builder reasonCode(ReasonCode reasonCode) {
            this.reasonCode = reasonCode;
            return this;
        }

        public Builder subject(SubjectSnapshot subject) {
            this.subject = subject;
            return this;
        }

        public Builder resource(ResourceSnapshot resource) {
            this.resource = resource;
            return this;
        }

        public Builder action(AuthorizationAction action) {
            this.action = action;
            return this;
        }

        public Builder context(ContextSnapshot context) {
            this.context = context;
            return this;
        }

        public Builder policyTrace(PolicyTrace policyTrace) {
            this.policyTrace = policyTrace;
            return this;
        }

        public Builder evidence(Evidence evidence) {
            this.evidence = evidence;
            return this;
        }

        public Builder obligations(List<Obligation> obligations) {
            this.obligations = obligations == null ? new ArrayList<Obligation>() : obligations;
            return this;
        }

        public Builder decisionTime(Instant decisionTime) {
            this.decisionTime = decisionTime;
            return this;
        }

        public AuthorizationDecision build() {
            return new AuthorizationDecision(this);
        }
    }
}
```

### 15.2 Java 17+ record version

```java
public record AuthorizationDecision(
        String decisionId,
        AuthorizationOutcome outcome,
        ReasonCode reasonCode,
        SubjectSnapshot subject,
        ResourceSnapshot resource,
        AuthorizationAction action,
        ContextSnapshot context,
        PolicyTrace policyTrace,
        Evidence evidence,
        List<Obligation> obligations,
        Instant decisionTime
) {
    public AuthorizationDecision {
        Objects.requireNonNull(decisionId, "decisionId");
        Objects.requireNonNull(outcome, "outcome");
        Objects.requireNonNull(reasonCode, "reasonCode");
        Objects.requireNonNull(subject, "subject");
        Objects.requireNonNull(resource, "resource");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(context, "context");
        Objects.requireNonNull(policyTrace, "policyTrace");
        Objects.requireNonNull(evidence, "evidence");
        obligations = List.copyOf(obligations == null ? List.of() : obligations);
        Objects.requireNonNull(decisionTime, "decisionTime");
    }

    public boolean allowed() {
        return outcome == AuthorizationOutcome.ALLOW;
    }
}
```

### 15.3 Avoid boolean blindness

Bad:

```java
if (!authz.canApprove(user, caseId)) {
    throw new AccessDeniedException("Denied");
}
```

Better:

```java
AuthorizationDecision decision = authz.authorize(command);

auditPublisher.publish(decision);

if (!decision.isAllowed()) {
    throw decision.toDeniedException();
}
```

Even better: make enforcement atomic:

```java
AuthorizationDecision decision = authz.requireAllowed(command);
```

where `requireAllowed` always emits audit event before throwing.

---

## 16. Authorization Audit Publisher

### 16.1 Interface

```java
public interface AuthorizationAuditPublisher {
    void publish(AuthorizationDecision decision);
}
```

### 16.2 Composite publisher

```java
public final class CompositeAuthorizationAuditPublisher implements AuthorizationAuditPublisher {
    private final List<AuthorizationAuditPublisher> delegates;

    public CompositeAuthorizationAuditPublisher(List<AuthorizationAuditPublisher> delegates) {
        this.delegates = Collections.unmodifiableList(new ArrayList<>(delegates));
    }

    @Override
    public void publish(AuthorizationDecision decision) {
        for (AuthorizationAuditPublisher delegate : delegates) {
            try {
                delegate.publish(decision);
            } catch (RuntimeException ex) {
                // Important: do not silently lose audit failure.
                // Decide per sensitivity whether to fail closed or send to fallback.
                AuditFailureHandler.handle(decision, delegate, ex);
            }
        }
    }
}
```

### 16.3 Publisher targets

Possible targets:

```text
structured application log
security audit table
Kafka audit topic
SIEM pipeline
object storage archive
OpenTelemetry span/event
Spring application event
```

### 16.4 Should audit failure block business action?

It depends.

| Action type | Audit failure behavior |
|---|---|
| Read non-sensitive resource | may continue with fallback log |
| Read sensitive case | fail closed or degrade carefully |
| Approve/reject/delete/export | usually fail closed if audit cannot be persisted |
| Break-glass access | must fail closed if audit unavailable |
| Login page static asset | no full audit required |

For regulatory systems, sensitive mutation without audit trail is often unacceptable.

---

## 17. Transaction Boundary: Audit and Business Mutation

Critical question:

> Should authorization audit event be committed in the same transaction as business mutation?

### 17.1 Same transaction

```text
BEGIN
  authorize
  insert authz_decision_event
  update case status
COMMIT
```

Pros:

- audit and mutation are atomic,
- no mutation without audit if DB commit succeeds.

Cons:

- audit table can slow business transaction,
- high-volume read decisions are too many,
- external SIEM/event pipeline may not be transactional.

### 17.2 Outbox pattern

```text
BEGIN
  authorize
  update case status
  insert outbox AUTHZ_DECISION_EVENT
COMMIT

async publisher sends to Kafka/SIEM
```

Pros:

- reliable event publishing,
- avoids dual-write problem,
- common enterprise pattern.

Cons:

- event delivery asynchronous,
- needs outbox worker,
- must monitor stuck outbox.

### 17.3 Separate append-only audit store

```text
authorize
append audit event to audit store
perform mutation
```

Pros:

- audit can be optimized separately,
- can be immutable/tamper-evident.

Cons:

- failure ordering tricky,
- may record allow decision without successful mutation,
- needs correlation to business outcome.

### 17.4 Recommended pattern

For sensitive business mutations:

```text
same DB transaction for business record + local audit/outbox record
async fanout to SIEM/object storage
```

Record both:

```text
authorization decision
business command outcome
```

Because authorization allow does not mean mutation succeeded.

---

## 18. Allow Audit vs Deny Audit

Many systems log only denies. That is insufficient.

### 18.1 Why log denies

Denies reveal:

- attack attempts,
- misconfigured roles,
- broken UI permissions,
- cross-tenant access attempts,
- stale session/permission,
- confused deputy.

### 18.2 Why log allows

Allows reveal:

- who accessed sensitive data,
- who exported report,
- who approved/rejected case,
- who used break-glass,
- who acted under delegation,
- whether access was legitimate after the fact.

For sensitive systems, allow audit is often more important than deny audit.

### 18.3 Logging policy

| Decision | Low sensitivity read | Sensitive read | Mutation | Export | Break-glass |
|---|---:|---:|---:|---:|---:|
| Allow | sampled/minimal | yes | yes | yes | full |
| Deny | yes if suspicious | yes | yes | yes | full |
| Error | metric + log | yes | yes | yes | full |

---

## 19. Preventing Audit Data Leakage

Audit trails are sensitive. They can contain:

- user IDs,
- resource IDs,
- tenant/agency info,
- role/permission details,
- denial reasons,
- policy internals,
- IP/session/device info,
- break-glass reason,
- support impersonation metadata.

### 19.1 Threats against audit trail

```text
Unauthorized read of audit logs
Log injection
PII overcollection
Sensitive policy leakage
Tampering/deletion
Correlation across systems revealing hidden data
Long retention beyond purpose
```

### 19.2 Controls

1. Structured logging, not string concatenation.
2. Sanitize user-controlled fields.
3. Hash or tokenize sensitive identifiers where possible.
4. Separate business audit and security audit access.
5. Append-only storage for high-value events.
6. Strict role-based access to audit viewer.
7. Redaction in support UI.
8. Retention policy per event type.
9. Integrity protection where required.
10. Alert on audit pipeline failure.

### 19.3 Log injection example

Bad:

```java
log.info("Access denied for user " + username + " reason " + reason);
```

If username contains newline/control characters, logs become misleading.

Better:

```java
logger.atWarn()
        .addKeyValue("event", "AUTHZ_DENIED")
        .addKeyValue("subjectId", safeSubjectId)
        .addKeyValue("reasonCode", reasonCode.name())
        .addKeyValue("decisionId", decisionId)
        .log("Authorization denied");
```

If using older logging stack, serialize structured JSON with proper escaping.

---

## 20. Tamper Resistance and Integrity

Audit is weak if privileged users can alter it silently.

### 20.1 Levels of tamper resistance

| Level | Description |
|---|---|
| Basic | DB table with restricted write access |
| Better | Append-only table + no update/delete grants |
| Strong | Outbox to immutable object storage/SIEM |
| Stronger | Hash chain per event stream |
| Highest | WORM storage/legal hold/digital signatures depending on regulatory needs |

### 20.2 Hash chaining concept

Each event includes hash of previous event:

```text
event_hash_n = SHA256(event_payload_n + previous_event_hash)
```

This makes deletion/modification detectable if chain head is anchored.

### 20.3 Practical caveat

Hash chains are not magic.

They require:

- stable canonical serialization,
- secure key/hash management if HMAC is used,
- chain partitioning strategy,
- recovery process,
- monitoring for gaps,
- anchoring chain head externally.

For many enterprise apps, SIEM/object storage immutability plus restricted DB permissions is more practical.

---

## 21. Audit Event Schema Evolution

Audit schema will evolve. Design for it.

### 21.1 Include event version

```json
{
  "event_type": "AUTHZ_DECISION",
  "event_version": "2.1"
}
```

### 21.2 Compatibility rules

1. Add fields without breaking old consumers.
2. Do not rename reason codes casually.
3. Do not change semantic meaning of existing reason code.
4. Deprecate reason codes explicitly.
5. Keep parser tolerant of unknown fields.
6. Keep required fields small and stable.

### 21.3 Reason code migration

Bad:

```text
MISSING_ROLE changed to MISSING_PERMISSION with no mapping.
```

Better:

```text
MISSING_ROLE deprecated since 2026-06-01.
Mapped to MISSING_PERMISSION for reporting.
Historical events remain unchanged.
```

---

## 22. Reconstructing Historical Decisions

A mature authorization system can answer:

```text
Why was decision D made at time T?
```

### 22.1 Required artifacts

```text
Authorization decision event
Policy bundle/version/hash used at T
Relevant subject snapshot
Relevant resource snapshot
Context snapshot
Attribute provenance
Delegation/break-glass records
Business command outcome
Correlation trace/logs
```

### 22.2 Reconstruction flow

```text
1. Find decision by decision_id/correlation_id/business_event_id.
2. Load decision event.
3. Identify policy version/hash.
4. Load archived policy bundle.
5. Inspect subject/resource/context snapshot.
6. Compare matched rules and evidence.
7. Correlate business mutation outcome.
8. Determine whether decision was expected, misconfiguration, stale data, or bug.
```

### 22.3 Replay vs explain

There are two different capabilities:

```text
Explain: Use stored trace/evidence to understand past decision.
Replay: Re-run old policy against old input to verify same result.
```

Replay is harder because it requires:

- archived policy engine version,
- deterministic evaluation,
- archived data shape,
- same combiner semantics,
- stable time handling.

For most systems, explainability is mandatory; replay is optional but powerful.

---

## 23. Spring Security Integration

### 23.1 Access denied events

Spring Security has authorization events such as denied authorization events and Spring Boot Actuator can publish audit events for authentication/access denied. These are useful integration points, but they are not enough by themselves for domain-level defensibility.

A denied event may know request/security context, but not necessarily:

- resource state,
- domain policy rule,
- assignment match,
- policy version,
- delegation record,
- business command outcome.

So use framework events as signals, not as the full audit model.

### 23.2 Request-level audit

```java
@Component
public final class RequestAuthorizationAuditListener {

    @EventListener
    public void onDenied(AuthorizationDeniedEvent<?> event) {
        // Convert framework-level event to structured audit event if useful.
        // Do not assume this replaces domain-level audit.
    }
}
```

### 23.3 Domain-level audit in service

```java
@Service
public class CaseApprovalService {
    private final CaseRepository caseRepository;
    private final AuthorizationService authorizationService;
    private final AuthorizationAuditPublisher auditPublisher;

    @Transactional
    public void approve(ApproveCaseCommand command) {
        CaseEntity caseEntity = caseRepository.findForUpdate(command.caseId())
                .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

        AuthorizationDecision decision = authorizationService.decideApprove(command, caseEntity);
        auditPublisher.publish(decision);

        if (!decision.isAllowed()) {
            throw decision.toDeniedException();
        }

        caseEntity.approve(command.actorId(), command.reason());
    }
}
```

### 23.4 Better: include business outcome

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseEntity caseEntity = caseRepository.findForUpdate(command.caseId())
            .orElseThrow(() -> new CaseNotFoundException(command.caseId()));

    AuthorizationDecision decision = authorizationService.decideApprove(command, caseEntity);

    if (!decision.isAllowed()) {
        auditPublisher.publish(AuthorizationAuditRecord.denied(decision));
        throw decision.toDeniedException();
    }

    caseEntity.approve(command.actorId(), command.reason());

    auditPublisher.publish(AuthorizationAuditRecord.allowedAndMutationAccepted(
            decision,
            "CASE_APPROVED",
            caseEntity.version()
    ));
}
```

### 23.5 Ordering problem

If audit publish happens before mutation, audit says authorization allowed but mutation may fail.

If publish happens after mutation, authorization denial may not be recorded if exception interrupts flow.

Recommended:

```text
- Deny: record decision before throwing.
- Allow + mutation: record decision and command outcome in same transaction/outbox.
```

---

## 24. OPA / External PDP Decision Logs

External policy engines often have decision logging features.

But do not confuse PDP decision log with full business audit.

PDP knows:

```text
input document
policy package
decision result
latency
```

Application knows:

```text
business command
resource version
transaction outcome
user-facing operation
correlation to case/audit trail
obligation fulfillment
```

### 24.1 Good integration pattern

```text
Java service builds input
PDP returns decision + trace metadata
Java service enriches with business context
Java service persists application authorization audit event
PDP emits its own decision log for policy governance/debugging
```

### 24.2 Include PDP metadata

```json
{
  "pdp": {
    "engine": "OPA",
    "mode": "SIDECAR",
    "bundle_revision": "rev-20260619-3",
    "decision_id": "opa-decision-abc",
    "latency_ms": 8
  }
}
```

---

## 25. Audit Storage Design

### 25.1 Relational table example

```sql
CREATE TABLE authz_decision_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    decision_id VARCHAR(80) NOT NULL UNIQUE,
    event_time TIMESTAMP WITH TIME ZONE NOT NULL,
    outcome VARCHAR(30) NOT NULL,
    reason_code VARCHAR(100) NOT NULL,
    subject_id VARCHAR(120) NOT NULL,
    subject_type VARCHAR(40) NOT NULL,
    action VARCHAR(120) NOT NULL,
    resource_type VARCHAR(80) NOT NULL,
    resource_id VARCHAR(120),
    tenant_id VARCHAR(80),
    policy_set_id VARCHAR(120),
    policy_version VARCHAR(120),
    correlation_id VARCHAR(120),
    request_id VARCHAR(120),
    evidence_json CLOB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_authz_audit_subject_time
    ON authz_decision_audit (subject_id, event_time);

CREATE INDEX idx_authz_audit_resource_time
    ON authz_decision_audit (resource_type, resource_id, event_time);

CREATE INDEX idx_authz_audit_reason_time
    ON authz_decision_audit (reason_code, event_time);

CREATE INDEX idx_authz_audit_correlation
    ON authz_decision_audit (correlation_id);
```

### 25.2 Partitioning

High-volume audit table should usually be partitioned by time:

```text
monthly partition
daily partition for very high volume
retention/archival by partition
```

### 25.3 JSON/CLOB caveat

Storing evidence JSON is convenient but can become expensive.

Common hybrid:

```text
important searchable fields as columns
detailed evidence as JSON/CLOB/object storage
```

### 25.4 Event streaming

For larger systems:

```text
application -> transactional outbox -> Kafka topic -> SIEM/data lake/object storage
```

Important:

- define schema,
- version schema,
- avoid raw PII,
- monitor lag,
- monitor dead-letter queue,
- ensure consumers do not become authorization dependency.

---

## 26. Metrics and Alerts

Audit records individual decisions. Metrics detect patterns.

### 26.1 Core metrics

```text
authz_decisions_total{outcome, reason_code, action, resource_type}
authz_decision_latency_seconds{pdp_mode, action}
authz_pdp_errors_total{error_type}
authz_cache_hit_total{cache_type}
authz_cache_stale_deny_total
authz_break_glass_total{outcome}
authz_cross_tenant_denied_total
authz_delegation_used_total
authz_obligation_failure_total
```

### 26.2 Alerts

Alert candidates:

```text
Spike in CROSS_TENANT_DENIED
Any BREAK_GLASS_ALLOW
PDP timeout rate above threshold
Policy bundle invalid
Audit publisher failure
Outbox stuck
Unexpected allow for privileged action outside business hours
High deny rate after deployment
```

### 26.3 Beware metric cardinality

Do not put `user_id`, `case_id`, or raw `resource_id` as metric labels.

Bad:

```text
authz_denied_total{user_id="123", case_id="9001"}
```

Good:

```text
authz_denied_total{reason_code="CROSS_TENANT_DENIED", resource_type="CASE"}
```

Use logs/audit for per-user/per-resource investigation.

---

## 27. Privacy and Data Minimization

Audit needs data, but not unlimited data.

### 27.1 Principles

1. Collect what is necessary to explain decision.
2. Prefer derived facts over raw sensitive attributes where possible.
3. Separate high-sensitivity forensic details from normal app audit.
4. Restrict access to audit viewer.
5. Apply retention by event class.
6. Mask support views.
7. Avoid logging secrets/tokens/passwords/session cookies.

### 27.2 Never log

```text
passwords
raw access tokens
refresh tokens
private keys
full session cookies
full authorization headers
complete PII payloads unless explicitly justified
```

### 27.3 Token audit

Instead of raw JWT:

```json
{
  "token_jti": "jti:abc",
  "issuer": "https://idp.example",
  "audience": "case-api",
  "scope": ["case.approve"],
  "token_hash": "sha256:..."
}
```

---

## 28. Common Anti-Patterns

### 28.1 “We have logs, so we have audit”

Application logs are often incomplete, mutable, inconsistent, and not retention-managed.

### 28.2 “Only denials matter”

Sensitive allows are often the most important audit events.

### 28.3 “Current DB state can explain past decision”

Mutable state destroys historical reconstruction.

### 28.4 “Reason is just an exception message”

Exception messages are unstable and often not machine-readable.

### 28.5 “Store full object payload for safety”

This creates privacy and data leakage risk.

### 28.6 “Policy version not needed”

Without policy version/hash, historical decisions cannot be judged accurately.

### 28.7 “Audit in finally block is enough”

Finally block may not know decision semantics or business outcome. It may also fail silently.

### 28.8 “Support impersonation can reuse normal user audit”

Impersonation must record actor and effective subject separately.

### 28.9 “Break-glass is just admin role”

Break-glass must have reason, time bound, approval/review, alerting, and full audit.

### 28.10 “Debug-level logs contain decision details”

Debug logs may be disabled, rotated quickly, or inaccessible during audit.

---

## 29. Failure Modes

### 29.1 Audit pipeline down

Question:

```text
Can sensitive authorization continue when audit cannot be persisted?
```

For high-risk mutation, answer is often no.

### 29.2 Audit event emitted but mutation failed

If not correlated with business outcome, audit falsely implies action happened.

Record:

```text
authorization allowed
business mutation failed with reason X
```

### 29.3 Mutation happened but audit missing

This is severe. Need alert and reconciliation.

### 29.4 Policy version lost

You can no longer prove which rule applied.

### 29.5 Attribute source not captured

You cannot tell whether wrong decision came from policy bug or stale/wrong data.

### 29.6 Audit event has too much PII

Audit store becomes high-risk data store.

### 29.7 Audit viewer leaks hidden resource existence

If support user can search audit by resource ID and infer hidden case existence, audit viewer itself needs authorization.

### 29.8 Cross-service correlation missing

In microservices, decision in service A cannot be connected to mutation in service B.

### 29.9 Decision cache hides revocation

Audit must capture cache status/version to explain stale allow.

### 29.10 Reason code drift

Same reason code starts meaning different things after deployment.

---

## 30. Testing Auditability

Auditability must be tested, not assumed.

### 30.1 Unit tests

Test decision contains required fields:

```java
@Test
void denyCrossAgencyDecisionContainsAuditEvidence() {
    AuthorizationDecision decision = policy.decide(input);

    assertEquals(AuthorizationOutcome.DENY, decision.outcome());
    assertEquals(ReasonCode.CROSS_AGENCY_DENIED, decision.reasonCode());
    assertEquals("case-access", decision.policyTrace().policySetId());
    assertTrue(decision.evidence().facts().containsKey("same_agency"));
    assertEquals(false, decision.evidence().facts().get("same_agency"));
}
```

### 30.2 Integration tests

Test audit is persisted on deny:

```java
@Test
void deniedApprovalPersistsAuditRecord() {
    assertThrows(AuthorizationDeniedException.class, () -> {
        caseApprovalService.approve(commandFromWrongAgency());
    });

    AuthzDecisionAuditRecord record = auditRepository.findLatestByCorrelationId(correlationId);

    assertEquals("DENY", record.outcome());
    assertEquals("CROSS_AGENCY_DENIED", record.reasonCode());
    assertEquals("case.approve", record.action());
}
```

### 30.3 Mutation tests

Introduce missing audit publishing and ensure tests fail.

### 30.4 Contract tests

If audit events go to Kafka/SIEM, schema contract should be tested.

### 30.5 Replay/explain test

Given stored decision event and policy version, explanation should be renderable.

```text
Decision authz_123 denied because subject agency CEA did not match case agency ROM under policy tenant-boundary.v4.
```

### 30.6 Redaction tests

Ensure audit payload does not contain forbidden fields:

```text
Authorization header
access_token
refresh_token
password
raw NRIC
raw cookie
```

---

## 31. Production Checklist

### 31.1 Decision model

- [ ] Decision outcome is not just boolean.
- [ ] Reason code exists and is stable.
- [ ] Decision ID exists.
- [ ] Correlation/request/trace IDs exist.
- [ ] Policy version/hash is captured.
- [ ] Subject snapshot is captured.
- [ ] Resource snapshot is captured.
- [ ] Context snapshot is captured.
- [ ] Evidence/facts are captured for sensitive decisions.
- [ ] Obligations are captured and fulfillment is recorded.

### 31.2 Audit pipeline

- [ ] Sensitive denies are persisted.
- [ ] Sensitive allows are persisted.
- [ ] Break-glass events are fully audited.
- [ ] Delegation/impersonation records actor and effective subject.
- [ ] Audit write failures are handled explicitly.
- [ ] Outbox/queue lag is monitored.
- [ ] Audit event schema is versioned.
- [ ] Audit retention is defined.
- [ ] Audit access is restricted.
- [ ] Audit data is redacted/minimized.

### 31.3 Explainability

- [ ] Support-safe message exists.
- [ ] Security/audit explanation exists.
- [ ] User-facing denial does not leak hidden resource existence.
- [ ] Historical policy versions are archived.
- [ ] Attribute provenance is available for high-risk decisions.
- [ ] Decision can be found by business event/correlation ID.

### 31.4 Regulatory defensibility

- [ ] Policy change approval is traceable.
- [ ] Policy deployment is traceable.
- [ ] Role/permission assignment lifecycle is traceable.
- [ ] Emergency access has reason/time-bound/review.
- [ ] Sensitive actions have allow audit.
- [ ] Audit tamper-resistance level is appropriate.
- [ ] Audit viewer itself enforces authorization.

---

## 32. Top 1% Insight

A normal engineer asks:

```text
Is this user allowed?
```

A stronger engineer asks:

```text
Where should we enforce this authorization?
```

A senior engineer asks:

```text
What policy, data, and context decide this authorization?
```

A top 1% engineer asks:

```text
Can we prove, six months later, that this decision was correct under the policy and facts that existed at the time, without leaking sensitive data or depending on mutable current state?
```

That is the difference between authorization code and authorization system engineering.

---

## 33. Key Takeaways

1. Authorization decision should be treated as a first-class artifact.
2. Boolean allow/deny is insufficient for auditability.
3. Reason codes are essential for explainability, metrics, support, and audit.
4. Store references plus decision-relevant snapshots.
5. Historical reconstruction requires policy version, subject snapshot, resource snapshot, context snapshot, and evidence.
6. Allows matter as much as denies for sensitive operations.
7. Audit trail is sensitive and needs its own authorization, retention, and redaction model.
8. External PDP decision logs do not replace application business audit.
9. Sensitive mutation should not happen without reliable audit persistence.
10. Regulatory defensibility is designed up front, not patched after incident.

---

## 34. References

- OWASP Logging Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Top 10 2021 A09: Security Logging and Monitoring Failures — https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/
- Spring Security `AuthorizationDeniedEvent` API — https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/authorization/event/AuthorizationDeniedEvent.html
- Spring Boot Actuator Auditing — https://docs.spring.io/spring-boot/reference/actuator/auditing.html
- Open Policy Agent Decision Logs — https://www.openpolicyagent.org/docs/management-decision-logs
- NIST RBAC Project — https://csrc.nist.gov/projects/role-based-access-control
- NIST RBAC Glossary — https://csrc.nist.gov/glossary/term/role_based_access_control

---

## 35. Status Seri

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
- Part 26 — Authorization Failure Semantics and Error Handling
- Part 27 — Auditability, Explainability, and Regulatory Defensibility

Berikutnya:

- Part 28 — Secure Authorization Testing Strategy

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-026.md">⬅️ Java Authorization Modes and Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-028.md">Part 28 — Secure Authorization Testing Strategy ➡️</a>
</div>
