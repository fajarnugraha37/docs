# learn-java-authorization-modes-and-patterns-part-001

# Part 1 — Authorization Vocabulary, Semantics, and Invariants

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Target: Java 8 hingga Java 25  
> Fokus bagian ini: membangun bahasa, semantik, dan invariant authorization yang presisi agar desain authorization tidak kabur, tidak rapuh, dan tidak berubah menjadi kumpulan `if (isAdmin())` yang sulit diaudit.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 0, kita menempatkan authorization sebagai **decision system**:

```text
Can subject S perform action A on resource R under context C according to policy P?
```

Part 1 memperdalam satu hal yang tampak sederhana tapi sangat menentukan kualitas desain:

> Authorization yang buruk sering bukan dimulai dari kode yang buruk, tetapi dari bahasa yang tidak presisi.

Jika tim tidak membedakan `role`, `permission`, `authority`, `scope`, `claim`, `ownership`, `assignment`, `delegation`, `entitlement`, dan `policy`, maka implementasi Java hampir pasti menjadi tidak stabil.

Contoh masalah nyata:

```java
if (user.hasRole("CASE_OFFICER")) {
    caseService.approve(caseId);
}
```

Kelihatannya sederhana. Tapi pertanyaan yang belum dijawab:

1. Apakah semua `CASE_OFFICER` boleh approve semua case?
2. Apakah officer boleh approve case yang dia buat sendiri?
3. Apakah officer hanya boleh approve case dalam agency yang sama?
4. Apakah officer boleh approve case dalam state `DRAFT`?
5. Apakah officer boleh approve saat acting on behalf of officer lain?
6. Apakah approval tetap valid jika assignment berubah setelah halaman dibuka?
7. Apakah action ini perlu audit reason?
8. Apakah role ini global atau scoped ke organization tertentu?
9. Apakah role ini berasal dari token, database, identity provider, atau policy engine?
10. Apakah deny harus terlihat sebagai `403`, `404`, atau business validation error?

Part ini bertujuan membuat pertanyaan-pertanyaan tersebut menjadi eksplisit.

---

## 1. Authorization Bukan Sekadar “Hak Akses”

Dalam percakapan sehari-hari, authorization sering diterjemahkan menjadi “hak akses”. Itu tidak salah, tetapi terlalu dangkal.

Secara engineering, authorization adalah:

> Mekanisme menentukan apakah suatu subject boleh melakukan action terhadap resource tertentu, dalam context tertentu, berdasarkan policy tertentu, dengan hasil keputusan yang dapat ditegakkan, dijelaskan, diuji, dan diaudit.

Jadi authorization memiliki minimal enam komponen:

| Komponen | Pertanyaan | Contoh |
|---|---|---|
| Subject | Siapa yang meminta? | user, service account, officer, system job |
| Action | Mau melakukan apa? | view, update, approve, export, assign |
| Resource | Terhadap apa? | case, appeal, document, report, payment |
| Context | Dalam kondisi apa? | tenant, agency, time, channel, state, risk |
| Policy | Aturan apa yang berlaku? | maker-checker, same agency, deny suspended user |
| Decision | Hasilnya apa? | allow, deny, abstain, error, allow with obligation |

Kalau salah satu komponen hilang, authorization menjadi tidak lengkap.

---

## 2. Vocabulary Inti yang Harus Dipisahkan

### 2.1 Actor

**Actor** adalah entitas yang melakukan aksi dari sudut pandang sistem.

Actor bisa berupa:

1. Human user.
2. Backend service.
3. Scheduled job.
4. Batch processor.
5. Integration partner.
6. Admin/support operator.
7. External agency system.

Contoh:

```text
Actor: Alice, a case officer using the web portal.
Actor: report-export-worker, a scheduled service account.
Actor: cpds-sync-service, a service calling ACEAS API.
```

Actor tidak selalu sama dengan authenticated user. Misalnya:

```text
Authenticated user: support_admin_01
Effective actor: support_admin_01 acting on behalf of user_123
Original actor: support_admin_01
Represented user: user_123
```

Dalam sistem enterprise, terutama yang punya delegation atau impersonation, membedakan actor sangat penting.

---

### 2.2 Subject

**Subject** adalah entitas keamanan yang menjadi dasar keputusan authorization.

Subject biasanya berisi:

1. Principal identity.
2. Roles.
3. Permissions.
4. Attributes.
5. Tenant/org scope.
6. Delegation information.
7. Authentication assurance level.
8. Effective identity.

Contoh model Java:

```java
public final class AuthorizationSubject {
    private final String subjectId;
    private final SubjectType subjectType;
    private final String displayName;
    private final Set<String> roles;
    private final Set<String> permissions;
    private final Map<String, String> attributes;
    private final String tenantId;

    public AuthorizationSubject(
            String subjectId,
            SubjectType subjectType,
            String displayName,
            Set<String> roles,
            Set<String> permissions,
            Map<String, String> attributes,
            String tenantId
    ) {
        this.subjectId = requireNonBlank(subjectId, "subjectId");
        this.subjectType = Objects.requireNonNull(subjectType, "subjectType");
        this.displayName = displayName;
        this.roles = Collections.unmodifiableSet(new LinkedHashSet<>(roles));
        this.permissions = Collections.unmodifiableSet(new LinkedHashSet<>(permissions));
        this.attributes = Collections.unmodifiableMap(new LinkedHashMap<>(attributes));
        this.tenantId = requireNonBlank(tenantId, "tenantId");
    }

    public String subjectId() {
        return subjectId;
    }

    public SubjectType subjectType() {
        return subjectType;
    }

    public Set<String> roles() {
        return roles;
    }

    public Set<String> permissions() {
        return permissions;
    }

    public Optional<String> attribute(String name) {
        return Optional.ofNullable(attributes.get(name));
    }

    public String tenantId() {
        return tenantId;
    }

    private static String requireNonBlank(String value, String fieldName) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value;
    }
}
```

Java 17+ bisa memakai `record`, tetapi untuk Java 8 kompatibilitas, class final immutable seperti di atas lebih portable.

---

### 2.3 Principal

**Principal** adalah representasi identitas yang sudah dikenal sistem keamanan.

Di Java, `java.security.Principal` adalah interface minimal:

```java
public interface Principal {
    String getName();
}
```

Principal menjawab:

```text
Who is this identity?
```

Tetapi principal tidak otomatis menjawab:

```text
What is this identity allowed to do?
```

Contoh salah kaprah:

```java
Principal principal = request.getUserPrincipal();
if (principal.getName().equals("admin")) {
    allow();
}
```

Masalah:

1. Identity dijadikan policy.
2. Tidak ada role/permission model.
3. Sulit diubah saat admin berganti.
4. Tidak scalable.
5. Tidak audit-friendly.

Principal adalah input. Bukan policy.

---

### 2.4 User

**User** adalah akun manusia atau representasi login manusia dalam aplikasi.

User biasanya memiliki:

1. Username/login ID.
2. Status akun.
3. Profile.
4. Organization.
5. Employment status.
6. Mapped identity provider ID.
7. Roles/assignments.

Tetapi user bukan satu-satunya subject.

Sistem yang matang harus bisa membedakan:

```text
Human user         -> officer, reviewer, administrator
Service account    -> internal API caller
System process     -> scheduler, reconciliation job
External client    -> partner integration
Anonymous subject  -> public user before login
```

Jika authorization hanya didesain untuk `User`, nanti sulit menangani service-to-service access, background job, atau system action.

---

### 2.5 Role

**Role** adalah named collection of responsibilities or permissions.

NIST RBAC menjelaskan bahwa dalam RBAC, permitted actions terhadap resources diidentifikasi melalui roles, bukan langsung melalui subject identity. Dalam model RBAC yang sehat, user-role assignment dan permission-role assignment bersifat many-to-many.

Contoh role:

```text
CASE_OFFICER
CASE_REVIEWER
AGENCY_ADMIN
SYSTEM_ADMIN
REPORT_VIEWER
APPEAL_MANAGER
```

Role menjawab:

```text
In what capacity is this subject operating?
```

Role tidak seharusnya langsung menjawab semua detail object-level.

Contoh role check yang terlalu kasar:

```java
if (subject.roles().contains("CASE_OFFICER")) {
    return ALLOW;
}
```

Ini hanya benar kalau action memang benar-benar global untuk semua case officer. Biasanya tidak.

Role yang lebih sehat:

```text
CASE_OFFICER grants ability to perform officer-level operations,
but each operation may still require resource, tenant, state, and assignment checks.
```

---

### 2.6 Authority

Dalam Spring Security, `GrantedAuthority` sering dipakai sebagai representasi otoritas yang diberikan ke `Authentication`.

Authority bisa merepresentasikan:

1. Role.
2. Permission.
3. Scope.
4. Application-specific granted capability.

Contoh:

```text
ROLE_ADMIN
CASE_READ
CASE_APPROVE
SCOPE_report.export
```

Masalah umum:

```text
role, permission, dan OAuth scope semua dimasukkan ke GrantedAuthority tanpa naming discipline.
```

Akibatnya:

```java
hasAuthority("ADMIN")
hasRole("ADMIN")
hasAuthority("ROLE_ADMIN")
hasAuthority("case:read")
hasAuthority("SCOPE_case.read")
```

Semua bercampur.

Prinsip desain:

> `GrantedAuthority` adalah carrier teknis di Spring Security. Ia bukan vocabulary bisnis final.

Sebaiknya bedakan namespace:

```text
ROLE_CASE_OFFICER
PERM_CASE_READ
PERM_CASE_APPROVE
SCOPE_case.read
TENANT_agency-a
```

Namun lebih baik lagi, jangan biarkan semua keputusan penting hanya bergantung pada string authority. Gunakan authority sebagai input ke decision service.

---

### 2.7 Permission

**Permission** adalah izin untuk melakukan action tertentu terhadap resource type atau resource instance.

Contoh:

```text
case.read
case.create
case.update
case.submit
case.approve
case.assign
case.export
case.reopen
case.delete
```

Permission menjawab:

```text
What operation may be performed?
```

Permission belum tentu cukup untuk menjawab:

```text
On which specific object?
Under which business condition?
```

Contoh:

```text
Permission: case.approve
Additional constraints:
- case must be in PENDING_REVIEW
- approver must not be creator
- approver must belong to same agency
- approver must be assigned reviewer
```

Jadi permission adalah **necessary but not always sufficient**.

---

### 2.8 Scope

**Scope** sering muncul dalam OAuth2/OIDC ecosystem.

Scope adalah authority yang diberikan kepada client/token untuk mengakses resource server dalam batas tertentu.

Contoh:

```text
read:cases
write:cases
report.export
profile.read
```

Scope bukan selalu permission bisnis.

Perbedaan penting:

| Scope | Permission |
|---|---|
| Biasanya token/client oriented | Biasanya application/business oriented |
| Diberikan saat token diterbitkan | Bisa dihitung dinamis saat request |
| Cocok untuk API boundary | Cocok untuk domain operation |
| Sering coarse-grained | Bisa fine-grained |
| Bisa stale selama token hidup | Bisa dievaluasi real-time |

Contoh bahaya:

```text
JWT contains scope=case.write
Application assumes user may update every case.
```

Yang benar:

```text
scope=case.write means token may request write operation against case API,
but application still checks whether subject may update that specific case.
```

---

### 2.9 Claim

**Claim** adalah pernyataan tentang subject/client/token.

Contoh JWT claims:

```json
{
  "sub": "user-123",
  "iss": "https://idp.example.gov",
  "aud": "case-api",
  "exp": 1760000000,
  "agency": "CEA",
  "roles": ["CASE_OFFICER"]
}
```

Claim adalah evidence, bukan policy.

Claim bisa dipakai sebagai input authorization, tetapi jangan langsung dianggap selalu benar untuk semua konteks.

Pertanyaan yang harus diajukan:

1. Siapa issuer claim?
2. Apakah issuer dipercaya untuk claim tersebut?
3. Apakah claim masih fresh?
4. Apakah claim global atau scoped?
5. Apakah claim boleh dipakai untuk resource ini?
6. Apakah claim berasal dari token lama sebelum role dicabut?

Contoh desain lebih aman:

```java
public final class TrustedClaimSet {
    private final String issuer;
    private final String subject;
    private final String audience;
    private final Instant issuedAt;
    private final Instant expiresAt;
    private final Map<String, Object> claims;

    public boolean isFreshAt(Instant now) {
        return !now.isBefore(issuedAt) && now.isBefore(expiresAt);
    }
}
```

---

### 2.10 Entitlement

**Entitlement** adalah effective access yang dimiliki subject setelah assignment, role, permission, group, policy, delegation, dan constraint diproses.

Contoh:

```text
User Alice is entitled to:
- view cases in agency CEA
- update cases assigned to team T1
- approve cases of type LICENSE_RENEWAL, except cases created by Alice
- export monthly report if export window is open
```

Entitlement bisa:

1. Precomputed.
2. Cached.
3. Derived at request time.
4. Materialized into access table.
5. Evaluated by policy engine.

Perbedaan role dan entitlement:

```text
Role: CASE_REVIEWER
Entitlement: may approve case C-123 because she is assigned reviewer, same agency, case is pending review, and not creator.
```

Role adalah bahan mentah. Entitlement adalah hasil efektif.

---

### 2.11 Privilege

**Privilege** biasanya mengacu pada kemampuan yang lebih tinggi atau sensitif.

Contoh:

```text
SYSTEM_ADMIN privilege
BREAK_GLASS privilege
USER_IMPERSONATE privilege
CASE_FORCE_CLOSE privilege
POLICY_OVERRIDE privilege
```

Privilege perlu perlakuan khusus:

1. Tidak boleh terlalu mudah diberikan.
2. Harus time-bound jika memungkinkan.
3. Harus diaudit.
4. Harus punya reason.
5. Harus direview berkala.
6. Harus bisa dicabut cepat.

Jangan samakan privilege dengan permission biasa.

```text
case.read is normal permission.
breakglass.case.read_all is privileged emergency capability.
```

---

### 2.12 Policy

**Policy** adalah aturan yang menentukan decision.

Contoh policy natural language:

```text
A case reviewer may approve a case only if:
- the case is in PENDING_REVIEW state,
- the reviewer belongs to the same agency as the case,
- the reviewer is assigned to the case,
- the reviewer is not the creator of the case,
- the reviewer account is active,
- no conflict-of-interest flag exists.
```

Policy bisa diimplementasikan sebagai:

1. Java code.
2. Database rule/configuration.
3. Spring Security expression.
4. Jakarta container permission mapping.
5. OPA/Rego policy.
6. Cedar-like policy.
7. Workflow transition guard.
8. SQL predicate.

Policy harus dipisahkan dari:

1. Identity data.
2. UI rendering.
3. Routing.
4. Persistence details.
5. Error translation.

---

### 2.13 Rule

**Rule** adalah bagian lebih kecil dari policy.

Policy:

```text
Reviewer may approve case.
```

Rules:

```text
subject has permission case.approve
case.status == PENDING_REVIEW
case.assignedReviewerId == subject.id
case.createdBy != subject.id
case.tenantId == subject.tenantId
subject.status == ACTIVE
```

Dalam desain Java, rule bisa dimodelkan sebagai predicate yang menghasilkan decision fragment.

```java
public interface AuthorizationRule {
    RuleResult evaluate(AuthorizationRequest request);
}
```

Tetapi hati-hati: authorization rule tidak selalu boolean. Kadang perlu reason, obligation, dan evidence.

---

### 2.14 Constraint

**Constraint** adalah pembatas tambahan terhadap role/permission/action.

Contoh:

```text
Role: CASE_REVIEWER
Constraint: applies only to agency CEA
Constraint: applies only for case type LICENSING
Constraint: expires at 2026-12-31
Constraint: cannot approve own submission
```

Constraint membuat model menjadi scoped dan contextual.

Tanpa constraint, role explosion mudah terjadi:

```text
CEA_LICENSE_REVIEWER
CEA_APPEAL_REVIEWER
CEA_REPORT_VIEWER
OTHER_AGENCY_LICENSE_REVIEWER
OTHER_AGENCY_APPEAL_REVIEWER
...
```

Dengan constraint:

```text
role = CASE_REVIEWER
scope.agency = CEA
scope.caseType = LICENSE
```

---

### 2.15 Obligation

**Obligation** adalah sesuatu yang harus dilakukan jika decision diberikan.

Contoh:

```text
Allow, but mask NRIC.
Allow, but require audit log.
Allow, but require supervisor notification.
Allow, but force re-authentication.
Allow, but watermark exported document.
```

Ini penting karena tidak semua authorization hanya `allow` atau `deny`.

Model decision yang lebih kaya:

```java
public final class AuthorizationDecision {
    private final DecisionEffect effect;
    private final String reasonCode;
    private final List<AuthorizationObligation> obligations;
    private final List<String> evidence;

    private AuthorizationDecision(
            DecisionEffect effect,
            String reasonCode,
            List<AuthorizationObligation> obligations,
            List<String> evidence
    ) {
        this.effect = Objects.requireNonNull(effect, "effect");
        this.reasonCode = reasonCode;
        this.obligations = Collections.unmodifiableList(new ArrayList<>(obligations));
        this.evidence = Collections.unmodifiableList(new ArrayList<>(evidence));
    }

    public static AuthorizationDecision allow(String reasonCode) {
        return new AuthorizationDecision(DecisionEffect.ALLOW, reasonCode,
                Collections.emptyList(), Collections.emptyList());
    }

    public static AuthorizationDecision deny(String reasonCode) {
        return new AuthorizationDecision(DecisionEffect.DENY, reasonCode,
                Collections.emptyList(), Collections.emptyList());
    }

    public DecisionEffect effect() {
        return effect;
    }

    public boolean isAllowed() {
        return effect == DecisionEffect.ALLOW;
    }
}
```

---

### 2.16 Advice

**Advice** mirip obligation, tetapi tidak wajib secara enforcement.

Contoh:

```text
Deny, suggest requesting CASE_REVIEWER role.
Deny, suggest contacting agency admin.
Allow, recommend MFA enrollment.
```

Advice berguna untuk UX dan operasional, tetapi jangan membuat akses bergantung pada advice yang tidak ditegakkan.

---

### 2.17 Decision

**Decision** adalah hasil evaluasi authorization.

Minimal:

```text
ALLOW
DENY
```

Model lebih matang:

```text
ALLOW
DENY
ABSTAIN
NOT_APPLICABLE
INDETERMINATE
ERROR
```

Perbedaan penting:

| Decision | Makna |
|---|---|
| ALLOW | Policy mengizinkan |
| DENY | Policy melarang |
| ABSTAIN | Policy/rule tidak relevan atau tidak cukup informasi |
| NOT_APPLICABLE | Policy tidak berlaku untuk request ini |
| INDETERMINATE | Tidak bisa ditentukan secara aman |
| ERROR | Ada failure teknis |

Untuk sistem business application, biasanya decision akhir harus disederhanakan:

```text
ALLOW or DENY
```

Tetapi di dalam engine, membedakan `DENY`, `ABSTAIN`, dan `ERROR` sangat penting.

---

## 3. Vocabulary yang Sering Tertukar

### 3.1 Role vs Permission

Role:

```text
CASE_OFFICER
```

Permission:

```text
case.create
case.read
case.update
case.submit
case.assign
```

Role adalah wadah. Permission adalah kemampuan.

Kesalahan umum:

```java
if (hasRole("CASE_APPROVE")) { ... }
```

`CASE_APPROVE` terdengar seperti permission, bukan role.

Lebih baik:

```text
Role: CASE_REVIEWER
Permission: case.approve
```

Atau jika tetap technical authority:

```text
ROLE_CASE_REVIEWER
PERM_CASE_APPROVE
```

---

### 3.2 Permission vs Policy

Permission:

```text
case.approve
```

Policy:

```text
Subject may approve case only if subject has case.approve,
case is pending review, subject is assigned reviewer,
subject is not creator, and subject agency matches case agency.
```

Permission adalah token kemampuan. Policy adalah aturan keputusan.

Jangan memaksakan semua policy menjadi permission string.

Buruk:

```text
case.approve.pending_review.same_agency.assigned_reviewer.not_creator
```

Lebih baik:

```text
permission = case.approve
policy = Java/OPA/Cedar/business rule evaluates constraints
```

---

### 3.3 Claim vs Authority

Claim:

```json
{"agency":"CEA"}
```

Authority:

```text
PERM_CASE_APPROVE
```

Claim adalah informasi tentang subject/token. Authority adalah granted capability.

Claim bisa menjadi bahan ABAC, tetapi bukan authority langsung.

Buruk:

```java
if (jwt.getClaim("agency").equals(case.getAgency())) {
    allowApprove();
}
```

Lebih baik:

```java
if (hasPermission(subject, "case.approve")
        && sameAgency(subject, targetCase)
        && assignedReviewer(subject, targetCase)
        && notCreator(subject, targetCase)) {
    allow();
}
```

---

### 3.4 Scope vs Permission

OAuth scope sering berada di token boundary. Permission berada di domain boundary.

Contoh:

```text
Scope: case-api.write
Permission: case.approve
```

Scope bisa mengatakan token ini boleh memanggil API write. Tetapi API tetap harus mengecek permission domain.

Pattern aman:

```text
Request accepted by resource server only if token has proper audience/scope.
Domain operation allowed only if internal authorization policy allows action on resource.
```

---

### 3.5 Ownership vs Authorization

Ownership bukan authorization penuh.

Contoh:

```text
User owns document D.
```

Belum tentu user boleh:

1. Delete document.
2. Share document externally.
3. Export document.
4. Approve document.
5. Modify document after submitted.

Ownership adalah relationship. Authorization adalah decision.

Ownership bisa menjadi salah satu input:

```text
allow document.update if subject is owner and document.status == DRAFT
```

---

### 3.6 Assignment vs Ownership

Assignment:

```text
Case C-123 is assigned to officer Alice.
```

Ownership:

```text
Case C-123 belongs to agency CEA.
```

Assignment biasanya bersifat operational responsibility. Ownership biasanya lebih stabil sebagai domain boundary.

Contoh:

```text
Alice may update case because assigned.
Alice may not export all agency cases just because one case is assigned to her.
```

---

### 3.7 Delegation vs Impersonation

Delegation:

```text
Alice delegates authority to Bob to act on specific task for specific period.
```

Impersonation:

```text
Support admin acts as Alice for troubleshooting.
```

Perbedaan penting:

| Aspek | Delegation | Impersonation |
|---|---|---|
| Intent | Authorized substitute | Acting as another user |
| Audit | Bob acted under delegated authority from Alice | Admin impersonated Alice |
| Scope | Usually limited | Often dangerous if broad |
| User awareness | Often explicit | Must be strongly controlled |
| Risk | Medium/high | Very high |

Jangan mencatat impersonation hanya sebagai “Alice melakukan action”. Itu merusak audit.

Audit yang benar:

```text
effectiveSubject = Alice
originalActor = support_admin_01
mode = IMPERSONATION
reason = troubleshooting ticket INC-123
```

---

### 3.8 Authentication Assurance vs Authorization

Subject bisa authenticated, tetapi belum tentu sufficiently authenticated untuk action tertentu.

Contoh:

```text
User logged in with password.
User wants to export sensitive report.
Policy requires MFA within last 10 minutes.
```

Decision:

```text
DENY or STEP_UP_REQUIRED
```

Ini bukan authentication ulang biasa. Ini authorization yang membutuhkan context authentication assurance.

---

## 4. Authorization Semantics: Apa yang Sebenarnya Diputuskan?

Authorization decision harus punya bentuk yang eksplisit.

```text
Subject S
Action A
Resource R
Context C
Policy P
=> Decision D
```

Contoh:

```text
Subject: Alice, CASE_REVIEWER, agency=CEA
Action: case.approve
Resource: Case C-123, agency=CEA, status=PENDING_REVIEW, creator=Bob, assignedReviewer=Alice
Context: channel=web, time=2026-06-19T10:15:00Z, tenant=CEA
Policy: case approval policy v12
Decision: ALLOW
Reason: REVIEWER_ASSIGNED_AND_NOT_CREATOR
```

Decision ini jauh lebih kuat daripada:

```text
Alice has CASE_REVIEWER role.
```

Karena ia bisa diuji, dijelaskan, dan diaudit.

---

## 5. Subject Semantics

### 5.1 Subject Identity

Subject identity harus stabil.

Buruk:

```text
subjectId = email
```

Karena email bisa berubah.

Lebih baik:

```text
subjectId = internal immutable user id
externalId = IdP subject
email = attribute
```

Contoh:

```java
public final class PrincipalRef {
    private final String namespace;
    private final String id;

    public PrincipalRef(String namespace, String id) {
        this.namespace = requireNonBlank(namespace, "namespace");
        this.id = requireNonBlank(id, "id");
    }

    public String namespace() {
        return namespace;
    }

    public String id() {
        return id;
    }

    public String stableKey() {
        return namespace + ":" + id;
    }
}
```

Contoh namespace:

```text
internal-user:user-123
idp-singpass:s88xxxxx
service-account:report-worker
external-client:partner-api-01
```

---

### 5.2 Effective Subject

Dalam delegation atau impersonation, subject yang dipakai untuk policy bisa berbeda dari actor asli.

Contoh:

```java
public final class SubjectChain {
    private final AuthorizationSubject originalActor;
    private final AuthorizationSubject effectiveSubject;
    private final ActingMode actingMode;
    private final String reason;

    public boolean isActingOnBehalf() {
        return actingMode != ActingMode.SELF;
    }
}
```

Mode:

```text
SELF
DELEGATED
IMPERSONATED
SYSTEM_TRIGGERED
SERVICE_TO_SERVICE
```

Policy harus eksplisit apakah mengevaluasi:

1. Original actor.
2. Effective subject.
3. Keduanya.

Contoh:

```text
A support admin may impersonate user to view UI,
but may not approve case while impersonating.
```

Maka action `case.approve` harus memeriksa:

```text
actingMode == SELF or DELEGATED_APPROVAL_ALLOWED
```

---

## 6. Action Semantics

Action harus merepresentasikan business operation, bukan hanya HTTP method.

Buruk:

```text
GET
POST
PUT
DELETE
```

Lebih baik:

```text
case.view
case.search
case.create
case.updateDraft
case.submit
case.approve
case.reject
case.returnForClarification
case.assignReviewer
case.export
case.downloadAttachment
```

Kenapa?

Karena satu HTTP method bisa punya banyak makna:

```text
POST /cases/{id}/submit     -> case.submit
POST /cases/{id}/approve    -> case.approve
POST /cases/{id}/comments   -> case.comment.add
```

Dan satu action bisa muncul di banyak transport:

```text
case.approve via REST
case.approve via message consumer
case.approve via batch job
case.approve via admin tool
```

Action harus portable lintas boundary.

---

## 7. Resource Semantics

Resource harus punya dua level:

```text
Resource type
Resource instance
```

Contoh:

```text
Resource type: CASE
Resource instance: C-123
```

Authorization bisa dilakukan di beberapa level:

| Level | Contoh |
|---|---|
| Type-level | user may create case |
| Instance-level | user may view case C-123 |
| Field-level | user may view sensitive fields in C-123 |
| Relation-level | user may assign reviewer to C-123 |
| Collection-level | user may search cases in agency CEA |
| Aggregate-level | user may approve case including child documents |

Contoh Java:

```java
public final class ResourceRef {
    private final String type;
    private final String id;
    private final String tenantId;

    private ResourceRef(String type, String id, String tenantId) {
        this.type = requireNonBlank(type, "type");
        this.id = id;
        this.tenantId = tenantId;
    }

    public static ResourceRef typeOnly(String type) {
        return new ResourceRef(type, null, null);
    }

    public static ResourceRef instance(String type, String id, String tenantId) {
        return new ResourceRef(type, requireNonBlank(id, "id"), requireNonBlank(tenantId, "tenantId"));
    }

    public boolean isInstance() {
        return id != null;
    }
}
```

---

## 8. Context Semantics

Context adalah informasi yang bukan subject/action/resource inti, tetapi mempengaruhi decision.

Contoh context:

```text
tenantId
requestTime
channel
ipAddress
networkZone
deviceTrust
riskScore
authenticationMethod
authenticationAssuranceLevel
mfaAge
correlationId
operationSource
featureFlag
jurisdiction
```

Context harus dianggap sebagai snapshot.

Buruk:

```java
Instant.now() dipanggil berkali-kali di rule berbeda.
```

Lebih baik:

```java
AuthorizationContext context = AuthorizationContext.capture(clock, requestMetadata);
```

Contoh:

```java
public final class AuthorizationContext {
    private final String tenantId;
    private final Instant decisionTime;
    private final String channel;
    private final String correlationId;
    private final Map<String, String> attributes;

    public AuthorizationContext(
            String tenantId,
            Instant decisionTime,
            String channel,
            String correlationId,
            Map<String, String> attributes
    ) {
        this.tenantId = requireNonBlank(tenantId, "tenantId");
        this.decisionTime = Objects.requireNonNull(decisionTime, "decisionTime");
        this.channel = requireNonBlank(channel, "channel");
        this.correlationId = requireNonBlank(correlationId, "correlationId");
        this.attributes = Collections.unmodifiableMap(new LinkedHashMap<>(attributes));
    }
}
```

Context snapshot penting untuk audit:

```text
Decision made at T with context C.
```

Bukan:

```text
Decision reconstructed later using current context.
```

---

## 9. Policy Semantics

Policy harus menjawab beberapa hal:

1. Untuk action apa policy berlaku?
2. Untuk resource type apa policy berlaku?
3. Siapa subject yang mungkin diizinkan?
4. Constraint apa yang harus terpenuhi?
5. Apakah deny eksplisit mengalahkan allow?
6. Apakah policy menghasilkan obligation?
7. Apakah policy bisa dijelaskan?
8. Apakah policy versioned?
9. Apakah policy auditable?
10. Apakah policy deterministic?

Contoh policy yang tidak cukup:

```text
Only reviewer can approve.
```

Policy yang lebih tepat:

```text
A subject may perform case.approve on a case if:
- subject account status is ACTIVE;
- subject has effective permission case.approve;
- subject tenant equals case tenant;
- case status is PENDING_REVIEW;
- subject is assigned as reviewer for the case;
- subject is not the case creator;
- no active conflict-of-interest flag exists;
- if subject is acting through delegation, delegation explicitly includes case.approve and has not expired.
```

Policy matang harus bisa diterjemahkan ke test case.

---

## 10. Authorization Invariant

### 10.1 Apa Itu Invariant?

Invariant adalah aturan yang harus selalu benar dalam sistem.

Dalam authorization:

> Authorization invariant adalah constraint akses yang tidak boleh dilanggar oleh jalur apa pun, baik UI, REST API, batch job, message consumer, admin screen, report, maupun internal service.

Contoh invariant:

```text
No user may approve their own submitted case.
```

Ini harus berlaku di:

1. Web UI approve button.
2. REST approve endpoint.
3. Bulk approve endpoint.
4. Batch auto-approval job.
5. Admin override screen.
6. Message consumer.
7. Data migration tool, kecuali explicit privileged policy.

Kalau hanya dicek di UI, itu bukan invariant. Itu hanya UX hint.

---

### 10.2 Mengapa Invariant Lebih Penting dari Role Matrix?

Role matrix biasanya seperti ini:

| Role | View Case | Update Case | Approve Case |
|---|---:|---:|---:|
| Case Officer | Yes | Yes | No |
| Reviewer | Yes | No | Yes |
| Admin | Yes | Yes | Yes |

Ini berguna, tetapi tidak cukup.

Invariant menjawab dimensi yang role matrix tidak tangkap:

```text
Reviewer may approve, but not own case.
Reviewer may approve, but only if assigned.
Reviewer may approve, but only same tenant.
Reviewer may approve, but only pending review.
Admin may override, but must provide reason and only through break-glass flow.
```

Role matrix adalah starting point. Invariant adalah safety contract.

---

### 10.3 Contoh Authorization Invariant untuk Case Management

```text
Invariant 1:
A subject must never access a case from another tenant unless an explicit cross-tenant support policy allows it.

Invariant 2:
A subject must never approve a case they created or submitted.

Invariant 3:
A case can be approved only when its state is PENDING_REVIEW.

Invariant 4:
A subject may update case content only while the case is in DRAFT or RETURNED_FOR_CLARIFICATION.

Invariant 5:
A report export must include only records the subject is authorized to view individually or via report-specific aggregate policy.

Invariant 6:
A delegated authority must not exceed the delegator's authority.

Invariant 7:
A service account must not gain broader data access than the human/system workflow it serves.

Invariant 8:
Break-glass access must always require reason, elevated privilege, time-bound session, and audit event.
```

---

## 11. Designing Invariants from Business Language

Business statement:

```text
Only assigned reviewer can approve an application.
```

Engineering decomposition:

```text
Subject must be authenticated.
Subject account must be active.
Subject must have reviewer capability.
Resource must be an application.
Application must exist.
Application must belong to same tenant/agency.
Application must be assigned to subject as reviewer.
Application must be in reviewable state.
Subject must not be applicant or submitter if maker-checker applies.
Decision must be audited.
```

Final authorization request:

```text
authorize(
  subject = Alice,
  action = application.approve,
  resource = Application A-123,
  context = tenant CEA, channel web, time T
)
```

Expected decision:

```text
ALLOW only if all required constraints hold.
```

---

## 12. The Authorization Sentence Pattern

Gunakan pola kalimat ini untuk setiap operation:

```text
A <subject kind> may <action> a/an <resource kind>
only if <conditions>,
unless <explicit exceptions>,
and must <obligations>.
```

Contoh:

```text
A case reviewer may approve a case
only if the reviewer has case.approve permission,
the case is in PENDING_REVIEW,
the reviewer is assigned to the case,
the reviewer belongs to the same tenant as the case,
and the reviewer is not the case creator,
unless a break-glass policy has been activated,
and must produce an audit event with policy version and reason code.
```

Kalimat ini bisa diturunkan menjadi:

1. Java policy class.
2. Spring method security annotation plus domain check.
3. OPA/Rego rule.
4. Test cases.
5. Audit schema.
6. Documentation.

---

## 13. Positive Permission, Negative Permission, and Deny Override

### 13.1 Positive Permission

Positive permission memberi kemampuan:

```text
case.read
case.approve
report.export
```

Model paling umum:

```text
If permission exists and constraints pass, allow.
```

---

### 13.2 Negative Permission

Negative permission melarang sesuatu walaupun ada permission lain.

Contoh:

```text
case.approve denied if conflict_of_interest=true
report.export denied if user is under suspension
```

Negative permission harus dipakai hati-hati karena bisa membuat model sulit dipahami.

---

### 13.3 Deny Override

Dalam sistem enterprise, explicit deny biasanya harus mengalahkan allow.

Contoh:

```text
User has REPORT_EXPORTER role.
But user is suspended.
Decision: DENY.
```

Decision combining:

```text
If any mandatory deny rule matches -> DENY
Else if at least one allow policy matches and all constraints pass -> ALLOW
Else -> DENY
```

Java sketch:

```java
public final class DenyOverridesCombiner {
    public AuthorizationDecision combine(List<AuthorizationDecision> decisions) {
        for (AuthorizationDecision decision : decisions) {
            if (decision.effect() == DecisionEffect.DENY) {
                return decision;
            }
        }
        for (AuthorizationDecision decision : decisions) {
            if (decision.effect() == DecisionEffect.ALLOW) {
                return decision;
            }
        }
        return AuthorizationDecision.deny("NO_APPLICABLE_ALLOW_POLICY");
    }
}
```

But be careful: not every deny is same. A rule can deny because:

1. Missing permission.
2. Suspended user.
3. Tenant mismatch.
4. Policy error.
5. Resource not found.

Reason code matters.

---

## 14. Static vs Dynamic Authorization

### 14.1 Static Authorization

Static authorization bergantung pada data yang jarang berubah.

Contoh:

```text
User has CASE_OFFICER role.
User has case.read permission.
```

Kelebihan:

1. Cepat.
2. Mudah dicache.
3. Mudah dipahami.

Kelemahan:

1. Tidak cukup untuk object-level policy.
2. Rentan role explosion.
3. Tidak menangkap state/resource context.

---

### 14.2 Dynamic Authorization

Dynamic authorization bergantung pada runtime context.

Contoh:

```text
User may approve only if assigned reviewer and case state is PENDING_REVIEW.
```

Kelebihan:

1. Presisi.
2. Cocok untuk domain kompleks.
3. Mengurangi role explosion.

Kelemahan:

1. Butuh data lookup.
2. Lebih sulit dicache.
3. Lebih sulit diaudit jika tidak didesain baik.
4. Potensi N+1 decision problem.

Top-level engineer tidak memilih static atau dynamic secara dogmatis. Biasanya menggabungkan:

```text
Static permission as gate.
Dynamic policy as final decision.
```

---

## 15. Authorization as Contract

Authorization harus dianggap sebagai contract, bukan implementation detail.

Contract minimal:

```text
Operation: case.approve
Subject required: active human user or permitted delegated actor
Required permission: case.approve
Resource constraints:
- case exists
- same tenant
- status PENDING_REVIEW
- assigned reviewer
- not creator
Context constraints:
- channel allowed
- delegation valid if acting
Decision:
- allow or deny with reason
Obligation:
- audit decision
```

Contract ini harus diketahui oleh:

1. Backend developer.
2. Frontend developer.
3. QA.
4. BA/product owner.
5. Security reviewer.
6. Auditor.
7. Support/operator.

Kalau authorization hanya hidup di kode, tim sulit melakukan review.

---

## 16. Java Naming Discipline for Authorization

Naming sangat penting karena authorization sering memakai string.

### 16.1 Permission Naming

Gunakan pola konsisten:

```text
<resource>.<action>
```

Contoh:

```text
case.read
case.search
case.create
case.update
case.submit
case.approve
case.reject
case.assign
case.export
case.attachment.download
report.generate
report.export
user.manage
policy.update
```

Hindari:

```text
READ_CASE
CAN_APPROVE_CASE
ALLOW_CASE_APPROVAL
CASE_APPROVE_PERMISSION
```

Bukan karena salah mutlak, tetapi karena campur grammar membuat matrix sulit dikelola.

---

### 16.2 Role Naming

Gunakan noun/capacity:

```text
CASE_OFFICER
CASE_REVIEWER
AGENCY_ADMIN
REPORT_ANALYST
SUPPORT_OPERATOR
POLICY_ADMIN
```

Hindari role berbentuk action:

```text
CASE_APPROVE
REPORT_EXPORT
```

Itu lebih cocok permission.

---

### 16.3 Scope Naming

OAuth scope bisa mengikuti API boundary:

```text
case-api.read
case-api.write
report-api.export
```

Atau domain-like:

```text
case.read
case.write
report.export
```

Yang penting: jangan samakan scope dengan final domain decision.

---

### 16.4 Java Constant Strategy

Untuk Java 8:

```java
public final class Permissions {
    private Permissions() {}

    public static final String CASE_READ = "case.read";
    public static final String CASE_APPROVE = "case.approve";
    public static final String CASE_ASSIGN = "case.assign";
    public static final String REPORT_EXPORT = "report.export";
}
```

Untuk Java 17+ bisa lebih type-safe:

```java
public enum Permission {
    CASE_READ("case.read"),
    CASE_APPROVE("case.approve"),
    CASE_ASSIGN("case.assign"),
    REPORT_EXPORT("report.export");

    private final String value;

    Permission(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Trade-off:

| Approach | Kelebihan | Kekurangan |
|---|---|---|
| String constants | Flexible, Java 8 friendly | Typo risk outside constants |
| Enum | Type-safe | Harder for dynamic permission registry |
| Database-driven | Admin configurable | Needs governance and migration |
| Policy engine | Flexible | Operational complexity |

---

## 17. Authorization Request Model

Agar vocabulary menjadi nyata, buat request object eksplisit.

```java
public final class AuthorizationRequest {
    private final AuthorizationSubject subject;
    private final String action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    public AuthorizationRequest(
            AuthorizationSubject subject,
            String action,
            ResourceRef resource,
            AuthorizationContext context
    ) {
        this.subject = Objects.requireNonNull(subject, "subject");
        this.action = requireNonBlank(action, "action");
        this.resource = Objects.requireNonNull(resource, "resource");
        this.context = Objects.requireNonNull(context, "context");
    }

    public AuthorizationSubject subject() {
        return subject;
    }

    public String action() {
        return action;
    }

    public ResourceRef resource() {
        return resource;
    }

    public AuthorizationContext context() {
        return context;
    }
}
```

Keuntungan:

1. Semua check berbicara bahasa yang sama.
2. Mudah dilog.
3. Mudah dites.
4. Bisa dikirim ke external PDP.
5. Bisa diaudit.
6. Bisa digunakan lintas transport.

---

## 18. Authorization Decision Model

Decision jangan hanya boolean.

Boolean:

```java
boolean allowed = authorizationService.canApprove(user, caseId);
```

Masalah:

1. Tidak tahu kenapa deny.
2. Tidak tahu obligation.
3. Tidak tahu policy version.
4. Tidak tahu evidence.
5. Tidak audit-friendly.

Lebih baik:

```java
AuthorizationDecision decision = authorizationService.authorize(request);
if (!decision.isAllowed()) {
    throw new AccessDeniedException(decision.reasonCode());
}
```

Decision kaya:

```text
effect = DENY
reasonCode = CASE_NOT_ASSIGNED_TO_REVIEWER
policyId = case-approval-policy
policyVersion = 12
evidence = [subjectId=user-123, caseId=C-123, assignedReviewer=user-999]
obligations = []
```

Untuk user, reason bisa dimasking:

```text
You are not allowed to approve this case.
```

Untuk audit/operator, reason lengkap disimpan.

---

## 19. Reason Code Discipline

Reason code harus stabil dan machine-readable.

Contoh:

```text
ALLOW_ASSIGNED_REVIEWER
DENY_MISSING_PERMISSION
DENY_TENANT_MISMATCH
DENY_CASE_NOT_REVIEWABLE
DENY_NOT_ASSIGNED_REVIEWER
DENY_SELF_APPROVAL_NOT_ALLOWED
DENY_SUBJECT_SUSPENDED
DENY_DELEGATION_EXPIRED
DENY_BREAK_GLASS_REASON_REQUIRED
ERROR_POLICY_EVALUATION_FAILED
```

Hindari reason berupa free text saja:

```text
"not allowed because wrong user"
```

Gunakan dua layer:

```text
reasonCode = DENY_TENANT_MISMATCH
message = Subject tenant does not match case tenant.
```

Reason code membantu:

1. Audit.
2. Dashboard.
3. Troubleshooting.
4. Test assertion.
5. Regression detection.
6. Security incident analysis.

---

## 20. Authorization Matrix vs Policy Matrix vs Decision Table

### 20.1 Authorization Matrix

Biasanya role vs action:

| Role | case.read | case.update | case.approve |
|---|---:|---:|---:|
| CASE_OFFICER | Y | Y | N |
| CASE_REVIEWER | Y | N | Y |
| AGENCY_ADMIN | Y | Y | Y |

Bagus untuk high-level entitlement.

---

### 20.2 Policy Matrix

Menambahkan constraints:

| Action | Permission | Resource Constraint | Subject Constraint | Context Constraint |
|---|---|---|---|---|
| case.approve | case.approve | status=PENDING_REVIEW | assigned reviewer, not creator | same tenant |
| case.update | case.update | status=DRAFT/RETURNED | owner/assigned officer | same tenant |
| case.export | case.export | visible records only | report exporter | export window open |

Lebih berguna untuk engineering.

---

### 20.3 Decision Table

Contoh approval:

| Has permission | Same tenant | Assigned reviewer | Not creator | Case pending | Decision |
|---:|---:|---:|---:|---:|---|
| N | Y | Y | Y | Y | DENY_MISSING_PERMISSION |
| Y | N | Y | Y | Y | DENY_TENANT_MISMATCH |
| Y | Y | N | Y | Y | DENY_NOT_ASSIGNED_REVIEWER |
| Y | Y | Y | N | Y | DENY_SELF_APPROVAL_NOT_ALLOWED |
| Y | Y | Y | Y | N | DENY_CASE_NOT_REVIEWABLE |
| Y | Y | Y | Y | Y | ALLOW_ASSIGNED_REVIEWER |

Decision table paling mudah diubah menjadi tests.

---

## 21. Domain Example: Case Approval Authorization

### 21.1 Business Requirement

```text
A reviewer can approve a case assigned to them, but cannot approve their own submitted case. The case must be pending review and belong to the same agency.
```

### 21.2 Vocabulary Extraction

Subject:

```text
reviewer
```

Action:

```text
case.approve
```

Resource:

```text
case
```

Resource attributes:

```text
case.status
case.agencyId
case.submittedBy
case.assignedReviewerId
```

Subject attributes:

```text
subject.id
subject.agencyId
subject.permissions
subject.status
```

Context:

```text
time
channel
tenant
actingMode
```

Policy:

```text
case approval policy
```

Decision:

```text
ALLOW or DENY with reason
```

---

### 21.3 Java 8-Compatible Policy Code

```java
public final class CaseApprovalPolicy {

    public AuthorizationDecision evaluate(
            AuthorizationSubject subject,
            CaseSnapshot targetCase,
            AuthorizationContext context
    ) {
        if (!"ACTIVE".equals(subject.attribute("status").orElse(""))) {
            return AuthorizationDecision.deny("DENY_SUBJECT_NOT_ACTIVE");
        }

        if (!subject.permissions().contains("case.approve")) {
            return AuthorizationDecision.deny("DENY_MISSING_PERMISSION_CASE_APPROVE");
        }

        if (!Objects.equals(subject.tenantId(), targetCase.tenantId())) {
            return AuthorizationDecision.deny("DENY_TENANT_MISMATCH");
        }

        if (!"PENDING_REVIEW".equals(targetCase.status())) {
            return AuthorizationDecision.deny("DENY_CASE_NOT_REVIEWABLE");
        }

        if (!Objects.equals(subject.subjectId(), targetCase.assignedReviewerId())) {
            return AuthorizationDecision.deny("DENY_NOT_ASSIGNED_REVIEWER");
        }

        if (Objects.equals(subject.subjectId(), targetCase.submittedBy())) {
            return AuthorizationDecision.deny("DENY_SELF_APPROVAL_NOT_ALLOWED");
        }

        return AuthorizationDecision.allow("ALLOW_ASSIGNED_REVIEWER_APPROVAL");
    }
}
```

`CaseSnapshot` sengaja dipakai, bukan entity JPA langsung.

Kenapa?

1. Mengurangi lazy loading surprises.
2. Membuat policy deterministic.
3. Memudahkan audit snapshot.
4. Memudahkan unit test.
5. Memisahkan authorization dari persistence lifecycle.

---

### 21.4 CaseSnapshot

```java
public final class CaseSnapshot {
    private final String caseId;
    private final String tenantId;
    private final String status;
    private final String submittedBy;
    private final String assignedReviewerId;

    public CaseSnapshot(
            String caseId,
            String tenantId,
            String status,
            String submittedBy,
            String assignedReviewerId
    ) {
        this.caseId = requireNonBlank(caseId, "caseId");
        this.tenantId = requireNonBlank(tenantId, "tenantId");
        this.status = requireNonBlank(status, "status");
        this.submittedBy = requireNonBlank(submittedBy, "submittedBy");
        this.assignedReviewerId = assignedReviewerId;
    }

    public String caseId() {
        return caseId;
    }

    public String tenantId() {
        return tenantId;
    }

    public String status() {
        return status;
    }

    public String submittedBy() {
        return submittedBy;
    }

    public String assignedReviewerId() {
        return assignedReviewerId;
    }
}
```

---

## 22. Hidden Assumptions Checklist

Saat membaca requirement authorization, cari hidden assumptions ini:

1. Apakah role global atau scoped?
2. Apakah permission berlaku untuk resource type atau instance?
3. Apakah tenant boundary implicit?
4. Apakah ownership sama dengan assignment?
5. Apakah admin bypass semua policy?
6. Apakah support operator boleh melihat data sensitif?
7. Apakah report/export memakai authorization yang sama dengan screen?
8. Apakah batch job boleh melakukan action atas nama user?
9. Apakah action perlu maker-checker?
10. Apakah delegated access boleh approve?
11. Apakah deny reason boleh ditampilkan ke user?
12. Apakah search result boleh menunjukkan existence resource yang tidak boleh dibuka?
13. Apakah permission revocation harus real-time?
14. Apakah token claims boleh stale?
15. Apakah policy berubah harus berlaku ke historical case?

Top 1% engineer tidak langsung coding authorization. Dia mencari assumption yang belum diucapkan.

---

## 23. Authorization and State Semantics

Dalam sistem bisnis, resource state sering menentukan authorization.

Contoh case lifecycle:

```text
DRAFT -> SUBMITTED -> PENDING_REVIEW -> APPROVED
                              |-> REJECTED
                              |-> RETURNED_FOR_CLARIFICATION
```

Authorization berbeda per state:

| State | Allowed Action | Constraint |
|---|---|---|
| DRAFT | update | creator or assigned officer |
| SUBMITTED | withdraw | submitter before review starts |
| PENDING_REVIEW | approve | assigned reviewer, not creator |
| PENDING_REVIEW | return | assigned reviewer |
| APPROVED | amend | privileged admin with reason |
| REJECTED | appeal | applicant within appeal window |

Jangan desain authorization hanya sebagai role table jika domain punya state machine.

Pattern:

```text
State transition guard = authorization + business validity.
```

Tetapi bedakan:

```text
Authorization: Are you allowed to attempt approval?
Business validation: Is the case complete enough to be approved?
```

Keduanya bisa sama-sama menolak, tetapi reason dan auditnya berbeda.

---

## 24. Authorization vs Business Validation

Keduanya sering bercampur.

Authorization:

```text
Are you allowed to perform this operation?
```

Business validation:

```text
Is this operation valid according to business data rules?
```

Contoh:

```text
User is assigned reviewer and may approve case.
But required document is missing.
```

Decision:

```text
Authorization: ALLOW
Business validation: FAIL_MISSING_REQUIRED_DOCUMENT
Operation result: rejected as business validation error
```

Kenapa dipisah?

1. Security audit lebih jelas.
2. User feedback lebih tepat.
3. Tests lebih mudah.
4. Policy tidak menjadi terlalu besar.
5. Tidak semua validation failure berarti access denied.

Namun ada area overlap:

```text
case.status != PENDING_REVIEW
```

Bisa dianggap authorization constraint atau business state validation. Pilih salah satu sebagai source of truth dan dokumentasikan.

---

## 25. Authorization vs Visibility

Boleh melihat tombol tidak sama dengan boleh menjalankan action.

UI visibility:

```text
Hide Approve button if user probably cannot approve.
```

Enforcement:

```text
Server denies approve request if policy fails.
```

UI authorization adalah convenience. Server authorization adalah enforcement.

Pattern aman:

```text
UI calls capability endpoint:
GET /cases/{id}/capabilities

Response:
{
  "canView": true,
  "canUpdate": false,
  "canApprove": true,
  "canReturn": true,
  "reasons": {
    "canUpdate": "CASE_NOT_EDITABLE"
  }
}
```

Tetapi endpoint action tetap harus enforce lagi.

---

## 26. Authorization vs Data Filtering

Bisa membuka halaman case tidak sama dengan boleh melihat semua field.

Contoh:

```text
User may view case but not sensitive identity fields.
```

Model decision:

```text
case.view = ALLOW
case.field.nric.view = DENY
```

Atau obligation:

```text
case.view = ALLOW with obligation MASK_NRIC
```

Field-level authorization penting untuk:

1. PII.
2. Financial data.
3. Investigation notes.
4. Internal comments.
5. Legal advice.
6. Audit metadata.

Jangan mengandalkan frontend untuk masking.

---

## 27. Authorization vs Audit

Audit bukan authorization, tetapi authorization harus menghasilkan audit.

Minimal audit untuk sensitive action:

```text
who requested
who was effective subject
what action
what resource
when
from where/channel
policy id/version
allow/deny
reason code
obligations
correlation id
```

Untuk regulatory systems, audit harus bisa menjawab:

```text
Why was Alice allowed to approve case C-123 on 2026-06-19?
```

Bukan hanya:

```text
Alice clicked approve.
```

---

## 28. Java Ecosystem Mapping

### 28.1 Spring Security Mapping

Spring Security authorization modern menggunakan konsep `AuthorizationManager` untuk membuat keputusan authorization pada request, method, dan message authorization.

Mapping vocabulary:

| Seri Ini | Spring Security |
|---|---|
| Subject | `Authentication` principal + authorities |
| Authority | `GrantedAuthority` |
| Action | Secure object/method/request mapping |
| Resource | Request, method target, domain object |
| Context | Request context, method args, security context |
| Decision | `AuthorizationDecision` / `AuthorizationResult` |
| Enforcement | Filter chain, method interceptor |

Tetapi Spring `AuthorizationManager` tetap perlu diberi domain semantics. Kalau hanya dipakai untuk `hasRole`, ia tidak otomatis menjadi domain authorization matang.

---

### 28.2 Jakarta EE Mapping

Jakarta Authorization mendefinisikan SPI low-level berbasis permission untuk container authorization. Jakarta EE/Jakarta Security juga punya role-based declarative security seperti `@RolesAllowed`, `@PermitAll`, dan `@DenyAll`.

Mapping vocabulary:

| Seri Ini | Jakarta Ecosystem |
|---|---|
| Principal | Caller principal |
| Role | Container/application role |
| Permission | Jakarta Authorization permission classes |
| Policy provider | Jakarta Authorization provider |
| Enforcement | Container security checks |
| Declarative role check | `@RolesAllowed` |

Untuk aplikasi enterprise modern, Jakarta declarative roles sering cukup sebagai coarse gate, tetapi domain authorization tetap perlu service/policy layer sendiri.

---

### 28.3 Java Platform Mapping

Java platform punya `Principal`, `Permission`, `Policy`, `ProtectionDomain`, dan historical `SecurityManager` model.

Untuk business authorization modern:

```text
java.security.Permission can inspire permission semantics,
but application/domain authorization usually needs richer model.
```

Jangan langsung memaksakan semua domain authorization ke `java.security.Permission` kecuali memang sedang membangun integration dengan container/security provider/plugin sandbox.

---

## 29. Failure Modes from Bad Vocabulary

### 29.1 Role Explosion

Gejala:

```text
CASE_REVIEWER_CEA_LICENSE_PENDING
CASE_REVIEWER_CEA_LICENSE_APPROVED
CASE_REVIEWER_CEA_APPEAL_PENDING
CASE_REVIEWER_OTHER_AGENCY_LICENSE_PENDING
```

Penyebab:

1. Role dipakai untuk menyimpan scope.
2. Role dipakai untuk menyimpan state.
3. Role dipakai untuk menyimpan resource attribute.
4. Tidak ada ABAC/constraint model.

Solusi:

```text
role = CASE_REVIEWER
constraints = agency, case type, assignment, state
```

---

### 29.2 God Admin

Gejala:

```java
if (isAdmin()) return true;
```

Masalah:

1. Admin bisa bypass tenant boundary.
2. Admin bisa approve own case.
3. Admin bisa export sensitive data tanpa reason.
4. Admin sulit diaudit.
5. Compromised admin account = catastrophic blast radius.

Solusi:

```text
Admin privilege must be scoped, reasoned, audited, and sometimes still constrained.
```

---

### 29.3 Claim Confusion

Gejala:

```java
if (jwt.getClaim("role").equals("admin")) allow();
```

Masalah:

1. Issuer mungkin tidak authoritative untuk role aplikasi.
2. Role mungkin stale.
3. Role mungkin global padahal harus scoped.
4. Token audience mungkin bukan service ini.

Solusi:

```text
Validate token boundary, map trusted claims to internal subject, then evaluate domain policy.
```

---

### 29.4 UI Authorization Mistaken as Enforcement

Gejala:

```text
Button hidden, therefore safe.
```

Masalah:

1. API tetap bisa dipanggil langsung.
2. Mobile client mungkin berbeda.
3. Old frontend bundle bisa masih ada.
4. Internal endpoint bisa bypass UI.

Solusi:

```text
UI can ask capabilities, but server must enforce every sensitive operation.
```

---

### 29.5 Search/Export Leakage

Gejala:

```text
Detail endpoint protected, but search/export returns unauthorized data.
```

Penyebab:

1. Object-level check hanya di detail endpoint.
2. Query scoping tidak menggunakan authorization predicate.
3. Export memakai repository/report query sendiri.

Solusi:

```text
Authorization must exist in collection/query/report paths, not only object detail paths.
```

---

## 30. How to Review an Authorization Requirement

Gunakan pertanyaan berikut:

### 30.1 Subject Questions

1. Siapa subject-nya?
2. Apakah human, service, system, external client?
3. Apakah subject aktif?
4. Apakah ada acting/delegation/impersonation?
5. Apakah role global atau scoped?
6. Apakah permission berasal dari source terpercaya?

### 30.2 Action Questions

1. Apa action bisnisnya?
2. Apakah action ini command, query, export, approval, assignment, atau admin operation?
3. Apakah action idempotent?
4. Apakah action bisa dilakukan bulk?
5. Apakah action bisa dipicu async?

### 30.3 Resource Questions

1. Resource type apa?
2. Resource instance apa?
3. Apakah resource punya tenant/agency?
4. Apakah resource punya state?
5. Apakah resource punya owner/creator/assignee?
6. Apakah ada child resource?
7. Apakah field-level access dibutuhkan?

### 30.4 Context Questions

1. Tenant apa?
2. Channel apa?
3. Time window apa?
4. Apakah MFA/step-up dibutuhkan?
5. Apakah risk-based rule berlaku?
6. Apakah support/break-glass mode aktif?

### 30.5 Decision Questions

1. Apa allow condition?
2. Apa deny condition?
3. Deny mana yang override allow?
4. Apa reason code?
5. Apa obligation?
6. Apa audit event?
7. Apa response user?

---

## 31. Practical Template: Authorization Requirement Spec

Gunakan template ini sebelum implementasi.

```text
Operation Name:

Action:

Resource Type:

Resource Instance Required:

Allowed Subject Types:

Required Role(s):

Required Permission(s):

Subject Constraints:

Resource Constraints:

Context Constraints:

Delegation/Impersonation Rules:

Explicit Deny Rules:

Obligations:

Decision Reason Codes:

Audit Requirements:

Error/Response Semantics:

Query/List Impact:

Bulk Operation Impact:

Async/Message Impact:

Test Matrix:
```

Contoh singkat:

```text
Operation Name:
Case Approval

Action:
case.approve

Resource Type:
CASE

Resource Instance Required:
Yes

Allowed Subject Types:
Human user

Required Permission(s):
case.approve

Subject Constraints:
- status ACTIVE
- assigned reviewer
- not submitter

Resource Constraints:
- same tenant
- status PENDING_REVIEW

Context Constraints:
- channel WEB or INTERNAL_PORTAL

Delegation/Impersonation Rules:
- Delegation allowed only if delegation includes case.approve
- Impersonation cannot approve

Explicit Deny Rules:
- suspended user
- tenant mismatch
- conflict of interest

Obligations:
- write audit event

Decision Reason Codes:
- ALLOW_ASSIGNED_REVIEWER_APPROVAL
- DENY_MISSING_PERMISSION_CASE_APPROVE
- DENY_TENANT_MISMATCH
- DENY_CASE_NOT_REVIEWABLE
- DENY_NOT_ASSIGNED_REVIEWER
- DENY_SELF_APPROVAL_NOT_ALLOWED
- DENY_IMPERSONATION_APPROVAL_NOT_ALLOWED

Audit Requirements:
- subject id
- actor id
- case id
- case status
- policy version
- decision
- reason code
```

---

## 32. Testing Vocabulary and Semantics

Authorization tests harus menguji vocabulary, bukan hanya happy path.

### 32.1 Unit Test Example

```java
@Test
public void reviewerCannotApproveOwnCase() {
    AuthorizationSubject subject = subjectBuilder()
            .id("user-1")
            .tenant("agency-a")
            .permission("case.approve")
            .attribute("status", "ACTIVE")
            .build();

    CaseSnapshot targetCase = new CaseSnapshot(
            "case-1",
            "agency-a",
            "PENDING_REVIEW",
            "user-1",
            "user-1"
    );

    AuthorizationDecision decision = new CaseApprovalPolicy()
            .evaluate(subject, targetCase, context("agency-a"));

    assertEquals(DecisionEffect.DENY, decision.effect());
    assertEquals("DENY_SELF_APPROVAL_NOT_ALLOWED", decision.reasonCode());
}
```

### 32.2 Matrix Test

```text
For every action:
- missing permission -> deny
- wrong tenant -> deny
- wrong state -> deny
- wrong assignment -> deny
- self-approval -> deny
- all constraints valid -> allow
```

### 32.3 Naming Test

Tambahkan test/linter sederhana:

```text
All permissions must match regex: ^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$
All roles must match regex: ^[A-Z][A-Z0-9_]*$
No role may end with action verb if it is actually permission.
```

---

## 33. Version Differences: Java 8 to Java 25

Authorization concepts sama lintas versi Java, tetapi gaya implementasi bisa berubah.

### 33.1 Java 8 Baseline

Gunakan:

1. Final immutable classes.
2. `Optional` secara hati-hati.
3. `Collections.unmodifiable*`.
4. `java.time` untuk time context.
5. Interface-based policies.
6. Explicit constructors.

Hindari bergantung pada record/sealed types.

---

### 33.2 Java 11/17+

Bisa mulai memakai:

1. `var` untuk local readability jika cocok.
2. Records untuk request/decision/value object.
3. Sealed interface untuk decision hierarchy.
4. Pattern matching secara bertahap.
5. Stronger module boundary jika library authorization dipaketkan.

Contoh Java 17+:

```java
public record AuthorizationRequest(
        AuthorizationSubject subject,
        String action,
        ResourceRef resource,
        AuthorizationContext context
) {}
```

---

### 33.3 Java 21/25 Era

Virtual threads dan runtime modern bisa membantu throughput authorization service jika banyak IO lookup ke PIP/PDP, tetapi tidak mengubah semantics.

Prinsip:

```text
New Java features can reduce implementation friction,
but cannot fix unclear authorization vocabulary.
```

---

## 34. Production Checklist

Sebelum implementasi authorization dianggap matang, pastikan:

1. Subject, action, resource, context didefinisikan eksplisit.
2. Role dan permission tidak tercampur.
3. Scope/token claim tidak dijadikan final domain decision.
4. Resource instance authorization jelas.
5. Tenant boundary menjadi invariant.
6. Ownership, assignment, delegation, impersonation dibedakan.
7. State-based constraints terdokumentasi.
8. Positive dan negative rules punya combining semantics.
9. Decision reason code stabil.
10. Deny reason ke user tidak membocorkan informasi sensitif.
11. Audit mencatat policy version dan evidence penting.
12. Query/list/export/report path tidak bypass authorization.
13. Batch/message/internal endpoint tetap enforce policy.
14. Admin/break-glass tidak menjadi bypass diam-diam.
15. Tests mencakup negative cases dan matrix cases.
16. Cache key memasukkan tenant/context jika decision dicache.
17. Permission naming punya grammar konsisten.
18. Authorization requirement bisa dibaca oleh BA/QA/security, bukan hanya developer.

---

## 35. Top 1% Mental Model

Engineer biasa bertanya:

```text
Role apa yang boleh akses endpoint ini?
```

Engineer lebih matang bertanya:

```text
Subject dalam kapasitas apa boleh melakukan action apa terhadap resource apa dalam context apa?
```

Engineer top-level bertanya:

```text
Invariant apa yang harus selalu benar di semua jalur eksekusi,
bagaimana invariant itu ditegakkan,
bagaimana decision-nya dijelaskan,
bagaimana failure-nya aman,
bagaimana audit membuktikan bahwa decision itu benar,
dan bagaimana desain ini tetap evolvable saat role, tenant, workflow, policy, dan integrasi berubah?
```

Authorization bukan fitur kecil. Authorization adalah salah satu sistem kontrol utama dalam aplikasi enterprise.

Jika vocabulary-nya buruk, policy akan ambigu. Jika policy ambigu, implementasi akan inconsistent. Jika implementasi inconsistent, security bug akan muncul di jalur yang paling jarang dites: export, report, async job, admin tool, migration script, dan integration endpoint.

---

## 36. Ringkasan

Part ini membangun fondasi bahasa:

1. Actor tidak selalu sama dengan subject.
2. Principal adalah identity, bukan permission.
3. Role adalah capacity, bukan action.
4. Permission adalah ability, bukan full policy.
5. Scope adalah token/API boundary, bukan domain authorization final.
6. Claim adalah evidence, bukan policy.
7. Ownership adalah relationship, bukan authorization penuh.
8. Assignment adalah operational responsibility, bukan ownership.
9. Delegation dan impersonation harus dibedakan untuk audit.
10. Policy harus mengevaluasi subject, action, resource, dan context.
11. Decision harus lebih kaya dari boolean.
12. Invariant adalah aturan akses yang harus benar di semua jalur.
13. Role matrix berguna, tetapi tidak cukup untuk domain kompleks.
14. Authorization requirement harus bisa diterjemahkan menjadi decision table dan tests.
15. Java implementation harus memodelkan authorization request/decision secara eksplisit.

---

## 37. Latihan Praktis

Ambil satu operation dari sistem nyata, misalnya:

```text
case.reassignReviewer
```

Jawab:

1. Siapa subject yang boleh melakukan action ini?
2. Apa action name yang tepat?
3. Apa resource type dan instance?
4. Apa subject constraints?
5. Apa resource constraints?
6. Apa context constraints?
7. Apakah delegation boleh?
8. Apakah admin boleh bypass?
9. Apa explicit deny rules?
10. Apa obligations?
11. Apa reason codes?
12. Apa audit fields?
13. Apa test matrix?
14. Apakah action ini bisa lewat API, UI, batch, atau message?
15. Apa invariant yang tidak boleh dilanggar?

Jika jawaban masih berupa “role admin boleh”, berarti requirement belum cukup matang.

---

## 38. Referensi

1. Spring Security Reference — Authorization Architecture  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

2. Spring Security Reference — Authentication Architecture, especially `SecurityContextHolder` and authenticated principal model  
   https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html

3. Jakarta Authorization Specification 3.0  
   https://jakarta.ee/specifications/authorization/3.0/jakarta-authorization-spec-3.0

4. Jakarta Authorization project page  
   https://jakarta.ee/specifications/authorization/

5. NIST Role Based Access Control project  
   https://csrc.nist.gov/projects/role-based-access-control

6. NIST glossary — Role Based Access Control  
   https://csrc.nist.gov/glossary/term/role_based_access_control

7. NIST SP 800-162 — Guide to Attribute Based Access Control Definition and Considerations  
   https://www.nist.gov/publications/guide-attribute-based-access-control-abac-definition-and-considerations-1

8. NIST Attribute Based Access Control project  
   https://csrc.nist.gov/projects/attribute-based-access-control

---

## 39. Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
[x] Part 0 — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
[ ] Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
...
[ ] Part 34 — Top 1% Authorization Engineering Playbook
```

Part berikutnya:

```text
Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-000.md">⬅️ Part 0 — Authorization Mental Model: From “Role Check” to Decision System</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-002.md">Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t ➡️</a>
</div>
