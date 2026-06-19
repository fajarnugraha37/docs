# Java Authorization Modes and Patterns — Part 20
# Delegation, Impersonation, Acting Roles, and Break-Glass Access

> Seri: `learn-java-authorization-modes-and-patterns`  
> Part: `020`  
> Rentang Java: Java 8 hingga Java 25  
> Fokus: advanced enterprise authorization untuk kewenangan sementara, acting capacity, support impersonation, emergency access, audit defensibility, dan pencegahan privilege abuse.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita membahas authorization sebagai guard workflow dan state machine. Di sistem enterprise, terutama sistem regulatory, case management, banking, healthcare, government, dan internal operations, sering muncul kebutuhan yang tidak cukup dijawab oleh RBAC/ABAC biasa:

- user A sedang cuti, user B perlu bertindak sementara;
- officer perlu bertindak atas nama unit atau posisi tertentu;
- support engineer perlu melihat data user untuk troubleshooting;
- incident commander perlu akses darurat;
- supervisor perlu override keputusan normal;
- sistem perlu membedakan siapa actor asli dan atas kewenangan siapa aksi dilakukan;
- audit harus bisa menjawab “siapa melakukan apa, atas dasar kewenangan apa, kapan, dan mengapa”.

Inilah wilayah delegation, impersonation, acting roles, dan break-glass access.

Kesalahan umum di area ini adalah menganggap semuanya sama dengan “menambahkan role admin sementara”. Itu berbahaya. Dalam authorization matang, kewenangan sementara bukan hanya role tambahan. Ia adalah authority object dengan scope, reason, expiry, approval, evidence, audit, revocation, dan batasan penggunaan.

---

## 1. Mental Model Utama

Authorization normal biasanya berbentuk:

```text
Can subject S perform action A on resource R in context C?
```

Pada delegation/impersonation/break-glass, pertanyaannya berubah menjadi:

```text
Can real actor X perform action A on resource R,
while acting as / on behalf of / under authority of Y,
for purpose P,
within scope SCOPE,
under constraints C?
```

Jadi subject tidak lagi tunggal. Kita harus memodelkan setidaknya dua identitas:

```text
real_actor       = manusia/sistem yang benar-benar menekan tombol atau menjalankan aksi
represented_as   = identity/role/unit/user yang direpresentasikan
authority_source = delegasi, assignment, emergency grant, support session, workflow mandate
```

Tanpa pemisahan ini, audit akan rusak.

Contoh salah:

```text
created_by = "supervisor01"
role       = "ADMIN"
```

Contoh lebih benar:

```text
real_actor_id       = "user-supervisor-01"
effective_subject   = "officer-unit-a"
authority_type      = "DELEGATION"
authority_id        = "delegation-2026-00091"
reason_code         = "ACTING_OFFICER_ON_LEAVE"
approved_by         = "director-01"
valid_from          = 2026-06-19T09:00:00+07:00
valid_until         = 2026-06-23T18:00:00+07:00
action              = "case.recommend"
resource            = "case:ACEAS-2026-00123"
decision            = "ALLOW"
```

Top 1% insight: delegation/impersonation/break-glass are not authentication features. They are authorization features with identity representation and accountability semantics.

---

## 2. Istilah Penting

### 2.1 Delegation

Delegation adalah pemberian kewenangan terbatas dari pihak A kepada pihak B agar B dapat melakukan aksi tertentu dalam scope tertentu.

Contoh:

```text
Senior Officer A delegates "case.review" for cases in Team X to Officer B
from 2026-06-19 to 2026-06-21.
```

Delegation harus punya:

- delegator;
- delegatee;
- scope;
- allowed actions;
- resource constraints;
- validity window;
- reason;
- revocation path;
- audit trail.

### 2.2 Impersonation

Impersonation adalah saat actor asli menggunakan sistem seolah-olah menjadi user lain.

Contoh:

```text
Support admin opens the system as user customer123 to reproduce a UI issue.
```

Impersonation sangat sensitif karena dapat membuat actor terlihat seperti user lain. Karena itu audit harus selalu menyimpan:

```text
performed_by_real_actor = support_admin_01
impersonated_user       = customer123
```

Impersonation tidak boleh menghapus jejak actor asli.

### 2.3 Acting Role / Acting Capacity

Acting role adalah saat seseorang bertindak dalam kapasitas tertentu, bukan sebagai user lain secara penuh.

Contoh:

```text
Alice acts as "Team Lead of Enforcement Unit A".
```

Ini berbeda dari impersonation. Alice tidak menjadi Bob. Alice tetap Alice, tetapi authority-nya berasal dari posisi/kapasitas/assignment tertentu.

### 2.4 On Behalf Of

On-behalf-of berarti actor melakukan aksi untuk kepentingan pihak lain, tetapi actor asli tetap eksplisit.

Contoh:

```text
Officer submits appeal supplement on behalf of applicant after receiving written consent.
```

### 2.5 Break-Glass Access

Break-glass access adalah akses darurat yang membuka kewenangan tinggi dalam kondisi luar biasa.

Contoh:

```text
Incident commander gets temporary production read access during active severity-1 incident.
```

Break-glass harus:

- jarang dipakai;
- time-bound;
- reason-bound;
- heavily audited;
- ideally reviewed after use;
- ideally trigger alert;
- never silently become permanent access.

### 2.6 Override

Override adalah keputusan untuk melampaui rule normal dengan authority tertentu.

Contoh:

```text
Supervisor overrides normal SLA lock to reopen a case due to official appeal.
```

Override bukan berarti bebas rule. Override adalah rule khusus yang punya syarat lebih ketat.

---

## 3. Perbedaan Kritis: Delegation vs Impersonation vs Acting Role vs Break-Glass

| Mode | Actor asli terlihat? | Effective authority dari | Scope ideal | Risiko utama |
|---|---:|---|---|---|
| Delegation | Ya | Delegator/delegation record | Terbatas | Delegasi terlalu luas atau lupa dicabut |
| Impersonation | Harus ya | User yang diimpersonate + support authority | Sangat terbatas | Audit palsu, penyalahgunaan support |
| Acting Role | Ya | Posisi/kapasitas/assignment | Role-scope tertentu | Role ambiguity, SoD bypass |
| On Behalf Of | Ya | Consent/mandate/relationship | Aksi tertentu | Consent palsu atau tidak valid |
| Break-Glass | Ya | Emergency grant | Waktu pendek | Privilege escalation permanen |
| Override | Ya | Supervisor/special policy | Aksi khusus | Business rule bypass tanpa alasan sah |

Prinsip desain:

```text
Never collapse these modes into a single boolean like isAdmin.
```

---

## 4. Kenapa `temporary ADMIN` Adalah Anti-Pattern

Banyak sistem menyelesaikan kebutuhan darurat dengan:

```text
UPDATE user_roles SET role = 'ADMIN' WHERE user_id = ?;
```

Ini buruk karena:

1. scope tidak jelas;
2. reason tidak terikat pada decision;
3. expiry sering lupa;
4. tidak ada proof approval;
5. privilege terlalu luas;
6. audit tidak bisa membedakan akses normal vs emergency;
7. cache role bisa stale;
8. user dapat melakukan aksi di luar tujuan awal;
9. sulit melakukan post-incident review;
10. sulit memenuhi prinsip least privilege.

Model yang lebih benar:

```text
EmergencyAccessGrant
- id
- actor_id
- granted_actions
- resource_scope
- reason_code
- justification
- incident_id
- approved_by
- valid_from
- valid_until
- status
- created_at
- revoked_at
```

Authorization decision kemudian membaca grant ini sebagai authority source, bukan menambahkan role permanen.

---

## 5. Core Invariant

Untuk semua mode advanced authority, invariant dasarnya:

```text
A real actor must never gain broader authority than the authority source allows.
```

Turunannya:

```text
1. Real actor must be recorded.
2. Effective subject must be recorded.
3. Authority source must be recorded.
4. Scope must be bounded.
5. Time window must be bounded.
6. Sensitive action must require stronger evidence.
7. Authority must be revocable.
8. Decision must be reconstructable historically.
9. UI indication must not hide acting/impersonation mode.
10. Audit must distinguish normal access from exceptional access.
```

---

## 6. Java Domain Model

### 6.1 Java 8-Compatible Model

```java
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;

public final class ActorContext {
    private final String realActorId;
    private final String effectiveSubjectId;
    private final ActingMode actingMode;
    private final AuthoritySource authoritySource;
    private final Instant evaluatedAt;

    public ActorContext(
            String realActorId,
            String effectiveSubjectId,
            ActingMode actingMode,
            AuthoritySource authoritySource,
            Instant evaluatedAt) {
        this.realActorId = requireText(realActorId, "realActorId");
        this.effectiveSubjectId = requireText(effectiveSubjectId, "effectiveSubjectId");
        this.actingMode = Objects.requireNonNull(actingMode, "actingMode");
        this.authoritySource = Objects.requireNonNull(authoritySource, "authoritySource");
        this.evaluatedAt = Objects.requireNonNull(evaluatedAt, "evaluatedAt");
    }

    public String realActorId() {
        return realActorId;
    }

    public String effectiveSubjectId() {
        return effectiveSubjectId;
    }

    public ActingMode actingMode() {
        return actingMode;
    }

    public AuthoritySource authoritySource() {
        return authoritySource;
    }

    public Instant evaluatedAt() {
        return evaluatedAt;
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
```

```java
public enum ActingMode {
    NORMAL,
    DELEGATED,
    IMPERSONATION,
    ACTING_ROLE,
    ON_BEHALF_OF,
    BREAK_GLASS,
    OVERRIDE
}
```

```java
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;

public final class AuthoritySource {
    private final String authorityId;
    private final AuthorityType type;
    private final String reasonCode;
    private final String justification;
    private final Instant validFrom;
    private final Instant validUntil;
    private final Set<String> allowedActions;
    private final ResourceScope resourceScope;
    private final String approvedBy;

    public AuthoritySource(
            String authorityId,
            AuthorityType type,
            String reasonCode,
            String justification,
            Instant validFrom,
            Instant validUntil,
            Set<String> allowedActions,
            ResourceScope resourceScope,
            String approvedBy) {
        this.authorityId = requireText(authorityId, "authorityId");
        this.type = Objects.requireNonNull(type, "type");
        this.reasonCode = requireText(reasonCode, "reasonCode");
        this.justification = justification;
        this.validFrom = Objects.requireNonNull(validFrom, "validFrom");
        this.validUntil = Objects.requireNonNull(validUntil, "validUntil");
        if (!validUntil.isAfter(validFrom)) {
            throw new IllegalArgumentException("validUntil must be after validFrom");
        }
        this.allowedActions = immutableCopy(allowedActions);
        this.resourceScope = Objects.requireNonNull(resourceScope, "resourceScope");
        this.approvedBy = approvedBy;
    }

    public boolean isActiveAt(Instant instant) {
        return !instant.isBefore(validFrom) && instant.isBefore(validUntil);
    }

    public boolean allowsAction(String action) {
        return allowedActions.contains(action);
    }

    public boolean containsResource(ResourceRef resourceRef) {
        return resourceScope.contains(resourceRef);
    }

    public String authorityId() {
        return authorityId;
    }

    public AuthorityType type() {
        return type;
    }

    public String reasonCode() {
        return reasonCode;
    }

    public Instant validFrom() {
        return validFrom;
    }

    public Instant validUntil() {
        return validUntil;
    }

    public String approvedBy() {
        return approvedBy;
    }

    private static Set<String> immutableCopy(Set<String> input) {
        if (input == null || input.isEmpty()) {
            throw new IllegalArgumentException("allowedActions must not be empty");
        }
        return Collections.unmodifiableSet(new LinkedHashSet<String>(input));
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
```

```java
public enum AuthorityType {
    NORMAL_ASSIGNMENT,
    USER_DELEGATION,
    POSITION_ASSIGNMENT,
    SUPPORT_IMPERSONATION_SESSION,
    CONSENT_MANDATE,
    EMERGENCY_GRANT,
    SUPERVISOR_OVERRIDE
}
```

```java
public final class ResourceRef {
    private final String type;
    private final String id;
    private final String tenantId;

    public ResourceRef(String type, String id, String tenantId) {
        this.type = requireText(type, "type");
        this.id = requireText(id, "id");
        this.tenantId = requireText(tenantId, "tenantId");
    }

    public String type() { return type; }
    public String id() { return id; }
    public String tenantId() { return tenantId; }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
```

```java
public interface ResourceScope {
    boolean contains(ResourceRef resourceRef);
}
```

```java
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public final class TenantResourceScope implements ResourceScope {
    private final Set<String> tenantIds;
    private final Set<String> resourceTypes;

    public TenantResourceScope(Set<String> tenantIds, Set<String> resourceTypes) {
        if (tenantIds == null || tenantIds.isEmpty()) {
            throw new IllegalArgumentException("tenantIds must not be empty");
        }
        if (resourceTypes == null || resourceTypes.isEmpty()) {
            throw new IllegalArgumentException("resourceTypes must not be empty");
        }
        this.tenantIds = Collections.unmodifiableSet(new HashSet<String>(tenantIds));
        this.resourceTypes = Collections.unmodifiableSet(new HashSet<String>(resourceTypes));
    }

    @Override
    public boolean contains(ResourceRef resourceRef) {
        return tenantIds.contains(resourceRef.tenantId())
                && resourceTypes.contains(resourceRef.type());
    }
}
```

### 6.2 Java 17+ / 21+ / 25 Style

Jika baseline Anda Java 17+, model dapat dibuat lebih ekspresif memakai `record` dan `sealed interface`:

```java
import java.time.Instant;
import java.util.Set;

public record ActorContext(
        String realActorId,
        String effectiveSubjectId,
        ActingMode actingMode,
        AuthoritySource authoritySource,
        Instant evaluatedAt
) {
    public ActorContext {
        requireText(realActorId, "realActorId");
        requireText(effectiveSubjectId, "effectiveSubjectId");
        if (actingMode == null) throw new IllegalArgumentException("actingMode is required");
        if (authoritySource == null) throw new IllegalArgumentException("authoritySource is required");
        if (evaluatedAt == null) throw new IllegalArgumentException("evaluatedAt is required");
    }

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}
```

```java
public sealed interface AuthoritySource
        permits NormalAuthority,
                DelegatedAuthority,
                ImpersonationAuthority,
                ActingRoleAuthority,
                OnBehalfOfAuthority,
                BreakGlassAuthority,
                OverrideAuthority {

    String authorityId();

    boolean activeAt(java.time.Instant instant);

    boolean allows(String action, ResourceRef resource);

    String reasonCode();
}
```

Keuntungan sealed hierarchy:

- mode authority tidak bisa diam-diam ditambah tanpa disadari;
- switch expression dapat exhaustiveness check;
- tiap mode punya field wajib berbeda;
- domain lebih eksplisit daripada `Map<String, Object>`.

---

## 7. Decision Model: Jangan Return Boolean Saja

Untuk advanced authority, return boolean terlalu miskin.

Anti-pattern:

```java
boolean allowed = authorizationService.canApprove(user, caseId);
```

Lebih baik:

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final String reasonCode;
    private final String authorityId;
    private final ActingMode actingMode;
    private final String denialCategory;
    private final boolean auditRequired;
    private final boolean elevatedAccess;

    // constructor/getters omitted
}
```

Decision harus bisa menjawab:

```text
allowed?
why?
under which authority?
normal or elevated?
who is the real actor?
who is the effective subject?
what scope was evaluated?
what policy version was used?
what evidence supported this?
```

Ini penting karena advanced authority hampir selalu perlu audit, alerting, dan review.

---

## 8. Delegation Design

### 8.1 Delegation Sebagai Domain Object

```text
Delegation
- id
- delegator_user_id
- delegatee_user_id
- tenant_id
- resource_scope
- action_set
- valid_from
- valid_until
- status
- reason_code
- justification
- created_by
- approved_by
- revoked_by
- revoked_at
- created_at
- updated_at
```

Status:

```text
DRAFT
PENDING_APPROVAL
ACTIVE
EXPIRED
REVOKED
REJECTED
```

Invariant:

```text
Delegation can only be used when ACTIVE and now is within validity window.
```

### 8.2 Delegation Policy

```java
public final class DelegationPolicy {
    public AuthorizationDecision decide(
            ActorContext actor,
            String action,
            ResourceRef resource,
            Instant now) {

        AuthoritySource source = actor.authoritySource();

        if (actor.actingMode() != ActingMode.DELEGATED) {
            return AuthorizationDecision.deny("NOT_DELEGATED_MODE");
        }

        if (!source.isActiveAt(now)) {
            return AuthorizationDecision.deny("DELEGATION_NOT_ACTIVE");
        }

        if (!source.allowsAction(action)) {
            return AuthorizationDecision.deny("ACTION_NOT_DELEGATED");
        }

        if (!source.containsResource(resource)) {
            return AuthorizationDecision.deny("RESOURCE_OUTSIDE_DELEGATION_SCOPE");
        }

        return AuthorizationDecision.allow(
                "DELEGATION_ALLOWED",
                source.authorityId(),
                ActingMode.DELEGATED,
                true
        );
    }
}
```

### 8.3 Delegation Anti-Patterns

1. Delegation tanpa expiry.
2. Delegation semua aksi.
3. Delegation semua tenant.
4. Delegation tanpa approval untuk sensitive action.
5. Delegation tidak muncul di UI.
6. Delegation tidak tercatat di audit.
7. Delegation disimpan sebagai role biasa.
8. Delegation tidak bisa dicabut.
9. Delegation tetap aktif setelah delegator kehilangan authority.
10. Delegation bisa dipakai untuk membuat delegation baru tanpa rule khusus.

### 8.4 Delegator Authority Problem

Pertanyaan penting:

```text
Jika A mendelegasikan permission P ke B, apakah A harus punya P saat delegation dibuat saja,
atau juga saat B memakai delegation tersebut?
```

Ada dua model:

#### Model A — Snapshot Delegation

Delegasi tetap berlaku walaupun delegator kemudian kehilangan permission.

Cocok untuk:

- workflow continuity;
- cuti singkat;
- legal delegation yang sudah disahkan.

Risiko:

- privilege bisa bertahan terlalu lama.

#### Model B — Live Delegation

Saat delegatee memakai delegation, sistem mengecek bahwa delegator masih memiliki authority.

Cocok untuk:

- sistem security tinggi;
- permission yang sering berubah;
- akses sensitif.

Risiko:

- keputusan bisa berubah mendadak;
- membutuhkan lookup tambahan.

Rekomendasi enterprise:

```text
Use snapshot for ordinary delegated business tasks.
Use live revalidation for sensitive/high-risk actions.
Always store the chosen model explicitly.
```

---

## 9. Impersonation Design

### 9.1 Impersonation Harus Dipandang Berbahaya

Impersonation membuat satu user bisa melihat sistem dari perspektif user lain. Ini berguna untuk support, tetapi sangat berisiko.

Risiko:

1. support melihat data sensitif tanpa alasan sah;
2. support melakukan aksi destructive;
3. audit terlihat seolah user asli yang bertindak;
4. user tidak tahu akunnya diakses;
5. impersonation dipakai untuk bypass permission;
6. support session lupa ditutup;
7. hasil export/download bocor.

### 9.2 Safe Impersonation Model

```text
ImpersonationSession
- id
- support_actor_id
- target_user_id
- tenant_id
- reason_code
- ticket_id
- approved_by
- valid_from
- valid_until
- status
- allowed_actions
- forbidden_actions
- read_only
- banner_required
- user_notification_required
- created_at
- ended_at
```

### 9.3 Read-Only Default

Support impersonation sebaiknya default `read_only`.

```text
Default:
- view page: allowed if scoped
- inspect configuration: allowed if scoped
- submit transaction: denied
- approve/reject: denied
- export/download: denied unless explicitly granted
- change password/security setting: denied
```

### 9.4 Audit Semantics

Jangan pernah menulis audit seperti ini:

```text
user_id = target_user_id
```

Gunakan:

```text
real_actor_id       = support_actor_id
effective_subject   = target_user_id
acting_mode         = IMPERSONATION
authority_source_id = impersonation_session_id
```

### 9.5 UI Semantics

Saat impersonating, UI harus menampilkan banner yang tidak ambigu:

```text
You are viewing as Jane Doe.
Real actor: Support Admin A.
Session: IMP-2026-0001.
Reason: Ticket INC-12345.
```

Untuk sistem internal, banner ini penting agar operator tidak lupa sedang berada dalam mode khusus.

### 9.6 Spring Security Run-As

Spring Security memiliki konsep run-as authentication yang dapat mengganti `Authentication` selama invocation tertentu. Namun ini bukan desain lengkap support impersonation. Run-as berguna sebagai primitive internal, tetapi enterprise impersonation tetap perlu session object, scope, reason, audit, expiry, dan UI indication.

Pola aman:

```text
Spring Security Authentication
    -> contains real actor
    -> contains effective actor context
    -> never loses original actor
Domain Authorization Service
    -> checks impersonation session
    -> records decision/audit
```

Jangan hanya mengganti principal lalu melupakan actor asli.

---

## 10. Acting Role / Acting Capacity

### 10.1 Masalah yang Diselesaikan

Dalam organisasi besar, user sering punya beberapa kapasitas:

```text
Alice as Enforcement Officer
Alice as Acting Team Lead
Alice as Review Board Member
Alice as System Support Operator
```

Satu user bisa memiliki beberapa role, tetapi hanya satu role aktif untuk konteks tertentu.

### 10.2 Active Capacity

```text
ActiveCapacity
- actor_id
- capacity_id
- organization_unit_id
- tenant_id
- valid_from
- valid_until
- source
```

Contoh:

```text
Alice acts as Team Lead of Unit A from 2026-06-19 to 2026-06-26.
```

### 10.3 Dynamic Separation of Duty

Acting capacity sering berhubungan dengan SoD.

Contoh:

```text
A user who created a recommendation cannot approve it,
even if they are currently acting as supervisor.
```

Rule:

```java
if (caseRecord.createdBy().equals(actor.realActorId())
        && action.equals("case.approve")) {
    return deny("MAKER_CANNOT_APPROVE_OWN_CASE");
}
```

Important: check real actor, not only effective role.

Jika Anda cek hanya effective role, acting supervisor bisa approve pekerjaan sendiri.

### 10.4 Acting Role Anti-Patterns

1. Menganggap active role sama dengan all roles.
2. Tidak menyimpan kapasitas aktif di audit.
3. Tidak memisahkan real actor dan active capacity.
4. Role acting tidak punya expiry.
5. Acting role bypass maker-checker.
6. Acting role bisa dipakai lintas unit tanpa scope.

---

## 11. On-Behalf-Of Authorization

### 11.1 Kapan Dipakai

On-behalf-of umum pada:

- officer membantu applicant;
- agent mewakili organization;
- system service menjalankan aksi untuk user;
- backend service memanggil downstream atas nama user;
- lawyer/representative bertindak untuk client;
- parent/guardian acting for minor.

### 11.2 Consent/Mandate Object

```text
Mandate
- id
- represented_party_id
- representative_actor_id
- allowed_actions
- resource_scope
- consent_document_id
- valid_from
- valid_until
- status
- verified_by
- verification_method
```

### 11.3 Token Claim Tidak Cukup

Dalam distributed system, token mungkin membawa claim:

```json
{
  "sub": "service-a",
  "obo": "user-123"
}
```

Tetapi claim ini hanyalah evidence. Policy tetap perlu memvalidasi:

```text
Is service-a allowed to act on behalf of user-123 for this action/resource?
```

Jangan percaya `obo` claim secara buta tanpa audience, issuer, trust boundary, dan server-side policy.

### 11.4 Downstream Narrowing

Saat service A memanggil service B on behalf of user, service B tidak otomatis boleh menerima semua authority user. Idealnya authority dipersempit:

```text
User has: case.read, case.update, payment.approve
Service call needs: case.read only
Downstream token/context should carry: case.read only
```

Ini mencegah confused deputy.

---

## 12. Break-Glass Access

### 12.1 Break-Glass Bukan Role Permanen

Break-glass adalah emergency authority. Ia harus diperlakukan seperti event keamanan, bukan convenience feature.

Minimal field:

```text
BreakGlassGrant
- id
- actor_id
- incident_id
- severity
- reason_code
- justification
- requested_actions
- approved_actions
- resource_scope
- valid_from
- valid_until
- status
- approved_by
- approval_mode
- mfa_verified
- created_at
- revoked_at
```

### 12.2 Activation Flow

```text
1. Actor requests emergency access.
2. System requires justification and incident/ticket reference.
3. System evaluates whether actor is eligible.
4. Optional: supervisor/security approval.
5. Optional: MFA/step-up verification.
6. Grant created with short expiry.
7. Alert emitted.
8. Every action under grant is audited.
9. Grant expires automatically.
10. Post-use review is triggered.
```

### 12.3 Expiry Strategy

Break-glass expiry should be short:

```text
15 minutes  -> highly sensitive production data
1 hour      -> incident diagnosis
4 hours     -> major incident shift
1 day       -> exceptional, must require strong approval
```

Never indefinite.

### 12.4 Break-Glass Decision Rule

```java
public AuthorizationDecision decideBreakGlass(
        ActorContext actor,
        String action,
        ResourceRef resource,
        Instant now,
        RiskContext risk) {

    if (actor.actingMode() != ActingMode.BREAK_GLASS) {
        return AuthorizationDecision.deny("NOT_BREAK_GLASS_MODE");
    }

    AuthoritySource grant = actor.authoritySource();

    if (!grant.isActiveAt(now)) {
        return AuthorizationDecision.deny("BREAK_GLASS_EXPIRED_OR_NOT_ACTIVE");
    }

    if (!grant.allowsAction(action)) {
        return AuthorizationDecision.deny("ACTION_NOT_IN_BREAK_GLASS_GRANT");
    }

    if (!grant.containsResource(resource)) {
        return AuthorizationDecision.deny("RESOURCE_OUTSIDE_BREAK_GLASS_SCOPE");
    }

    if (!risk.hasRecentStepUpVerification()) {
        return AuthorizationDecision.deny("STEP_UP_REQUIRED_FOR_BREAK_GLASS");
    }

    return AuthorizationDecision.allowElevated(
            "BREAK_GLASS_ALLOWED",
            grant.authorityId(),
            ActingMode.BREAK_GLASS
    );
}
```

### 12.5 Alerting

Break-glass activation should emit event:

```text
security.break_glass.activated
security.break_glass.action_performed
security.break_glass.expired
security.break_glass.revoked
security.break_glass.review_required
```

Include:

```text
real_actor_id
grant_id
incident_id
resource_scope
actions
valid_until
approver
correlation_id
```

### 12.6 Post-Use Review

Setelah break-glass selesai:

```text
- Was access justified?
- Were all actions related to incident?
- Was any data exported?
- Were any destructive operations performed?
- Were there denials during session?
- Did actor attempt action outside scope?
- Should permanent permission be changed instead?
```

---

## 13. Override Authorization

Override sering muncul di workflow.

Contoh:

```text
Case is locked after decision, but supervisor can reopen due to legal appeal.
```

Override policy:

```text
Normal rule: closed case cannot be reopened.
Override rule: supervisor may reopen if official appeal exists and reason is recorded.
```

Jangan implementasi:

```java
if (user.isSupervisor()) {
    case.reopen();
}
```

Lebih benar:

```java
if (!appealRepository.existsOfficialAppeal(caseId)) {
    return deny("OFFICIAL_APPEAL_REQUIRED_FOR_REOPEN_OVERRIDE");
}

if (!overrideRequest.hasReason()) {
    return deny("OVERRIDE_REASON_REQUIRED");
}

if (!authorization.can(actor, "case.override-reopen", caseRef).allowed()) {
    return deny("NO_OVERRIDE_AUTHORITY");
}
```

Override adalah rule alternatif, bukan bypass tanpa rule.

---

## 14. Database Schema Example

### 14.1 Delegation Table

```sql
CREATE TABLE auth_delegation (
    id                  VARCHAR(64) PRIMARY KEY,
    tenant_id            VARCHAR(64) NOT NULL,
    delegator_user_id    VARCHAR(64) NOT NULL,
    delegatee_user_id    VARCHAR(64) NOT NULL,
    reason_code          VARCHAR(64) NOT NULL,
    justification        VARCHAR(2000),
    valid_from           TIMESTAMP NOT NULL,
    valid_until          TIMESTAMP NOT NULL,
    status               VARCHAR(32) NOT NULL,
    approved_by          VARCHAR(64),
    created_at           TIMESTAMP NOT NULL,
    created_by           VARCHAR(64) NOT NULL,
    revoked_at           TIMESTAMP,
    revoked_by           VARCHAR(64),
    version              BIGINT NOT NULL,
    CONSTRAINT ck_delegation_time CHECK (valid_until > valid_from)
);

CREATE INDEX idx_auth_delegation_delegatee_active
ON auth_delegation (tenant_id, delegatee_user_id, status, valid_from, valid_until);
```

### 14.2 Delegated Actions

```sql
CREATE TABLE auth_delegation_action (
    delegation_id   VARCHAR(64) NOT NULL,
    action_code     VARCHAR(128) NOT NULL,
    PRIMARY KEY (delegation_id, action_code),
    FOREIGN KEY (delegation_id) REFERENCES auth_delegation(id)
);
```

### 14.3 Scope Table

```sql
CREATE TABLE auth_authority_scope (
    authority_id       VARCHAR(64) NOT NULL,
    authority_type     VARCHAR(32) NOT NULL,
    scope_type         VARCHAR(64) NOT NULL,
    scope_value        VARCHAR(256) NOT NULL,
    PRIMARY KEY (authority_id, authority_type, scope_type, scope_value)
);
```

Scope examples:

```text
TENANT = CEA
AGENCY = AGENCY_01
CASE_TYPE = ENFORCEMENT
CASE_ID = ACEAS-2026-00123
RESOURCE_TYPE = CASE
```

### 14.4 Break-Glass Grant

```sql
CREATE TABLE auth_break_glass_grant (
    id                  VARCHAR(64) PRIMARY KEY,
    actor_user_id        VARCHAR(64) NOT NULL,
    tenant_id            VARCHAR(64) NOT NULL,
    incident_id          VARCHAR(128) NOT NULL,
    severity             VARCHAR(32) NOT NULL,
    reason_code          VARCHAR(64) NOT NULL,
    justification        VARCHAR(4000) NOT NULL,
    valid_from           TIMESTAMP NOT NULL,
    valid_until          TIMESTAMP NOT NULL,
    status               VARCHAR(32) NOT NULL,
    approval_mode        VARCHAR(32) NOT NULL,
    approved_by          VARCHAR(64),
    mfa_verified         CHAR(1) NOT NULL,
    created_at           TIMESTAMP NOT NULL,
    revoked_at           TIMESTAMP,
    revoked_by           VARCHAR(64),
    version              BIGINT NOT NULL,
    CONSTRAINT ck_bg_time CHECK (valid_until > valid_from),
    CONSTRAINT ck_bg_mfa CHECK (mfa_verified IN ('Y', 'N'))
);

CREATE INDEX idx_bg_actor_active
ON auth_break_glass_grant (tenant_id, actor_user_id, status, valid_from, valid_until);
```

### 14.5 Audit Table

```sql
CREATE TABLE auth_decision_audit (
    id                    VARCHAR(64) PRIMARY KEY,
    occurred_at            TIMESTAMP NOT NULL,
    tenant_id              VARCHAR(64) NOT NULL,
    real_actor_id          VARCHAR(64) NOT NULL,
    effective_subject_id   VARCHAR(64) NOT NULL,
    acting_mode            VARCHAR(32) NOT NULL,
    authority_source_id    VARCHAR(64),
    action_code            VARCHAR(128) NOT NULL,
    resource_type          VARCHAR(64) NOT NULL,
    resource_id            VARCHAR(128),
    decision               VARCHAR(16) NOT NULL,
    reason_code            VARCHAR(128) NOT NULL,
    policy_version         VARCHAR(64),
    correlation_id         VARCHAR(128),
    request_id             VARCHAR(128),
    elevated_access        CHAR(1) NOT NULL,
    metadata_json          CLOB
);

CREATE INDEX idx_auth_audit_actor_time
ON auth_decision_audit (tenant_id, real_actor_id, occurred_at);

CREATE INDEX idx_auth_audit_resource_time
ON auth_decision_audit (tenant_id, resource_type, resource_id, occurred_at);
```

---

## 15. Spring Security Integration Pattern

### 15.1 Store Actor Context Separately From Authentication

Spring `Authentication` biasanya berisi principal dan authorities. Untuk advanced authority, jangan hanya menambahkan authority string.

Lebih baik simpan actor context sebagai detail eksplisit:

```java
public final class AuthorizationActorDetails {
    private final String realActorId;
    private final String effectiveSubjectId;
    private final ActingMode actingMode;
    private final String authoritySourceId;

    // constructor/getters
}
```

Attach ke authentication:

```java
Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
AuthorizationActorDetails details = (AuthorizationActorDetails) authentication.getDetails();
```

Namun untuk testability, jangan seluruh domain authorization bergantung langsung pada `SecurityContextHolder`. Buat adapter:

```java
public interface CurrentActorProvider {
    ActorContext currentActor();
}
```

### 15.2 Method Security Example

```java
@PreAuthorize("@caseAuthz.canAct(authentication, #caseId, 'case.reopen').allowed")
public void reopenCase(String caseId, ReopenRequest request) {
    caseService.reopen(caseId, request);
}
```

Untuk logic kompleks, hindari SpEL panjang:

```java
public void reopenCase(String caseId, ReopenRequest request) {
    ActorContext actor = currentActorProvider.currentActor();
    ResourceRef resource = caseResourceResolver.resolve(caseId);

    AuthorizationDecision decision = authorizationService.authorize(
            actor,
            "case.override-reopen",
            resource,
            AuthorizationRequestContext.from(request)
    );

    if (!decision.allowed()) {
        throw new AccessDeniedException(decision.safeUserMessage());
    }

    caseDomainService.reopen(caseId, request, decision);
}
```

### 15.3 Request Filter for Acting Mode

Jika acting mode dipilih via UI/session:

```text
HTTP request
  -> Authentication filter
  -> ActingContext filter
  -> Authorization filters/method security
  -> Controller/service
```

Filter harus:

1. membaca selected acting mode;
2. memvalidasi session/grant/delegation masih aktif;
3. membangun ActorContext;
4. menolak jika invalid;
5. menaruh context untuk request lifecycle;
6. tidak percaya header dari browser tanpa server-side validation.

---

## 16. Cache and Revocation

Advanced authority sering bersifat temporary. Cache salah bisa sangat berbahaya.

### 16.1 Cache Key

Cache decision harus memasukkan:

```text
real_actor_id
effective_subject_id
acting_mode
authority_source_id
authority_version
action
resource_type
resource_id or scope key
tenant_id
context hash
```

Jangan cache hanya berdasarkan:

```text
user_id + action
```

Karena user yang sama bisa punya beberapa mode acting.

### 16.2 Revocation

Jika delegation atau break-glass dicabut, cache harus invalid.

Strategi:

```text
- short TTL for elevated authority decision;
- authority version in cache key;
- event-based invalidation;
- revalidate high-risk action every time;
- never cache break-glass destructive action too long.
```

### 16.3 Time Boundary

Jika grant valid sampai 10:00, cached allow tidak boleh tetap valid sampai 10:05.

Decision cache TTL harus:

```text
min(configured_ttl, authority_valid_until - now)
```

---

## 17. Concurrency and Race Conditions

### 17.1 TOCTOU

Time-of-check/time-of-use muncul saat:

```text
1. authorization check allowed;
2. grant revoked;
3. action executed anyway.
```

Untuk action sensitif:

```text
- check inside transaction;
- lock authority row if needed;
- check resource state and authority together;
- record decision and mutation atomically when possible.
```

### 17.2 Double Use

Delegation atau override mungkin hanya boleh dipakai sekali.

Tambahkan:

```text
usage_limit
usage_count
last_used_at
```

Dan update dengan optimistic locking.

### 17.3 Java Virtual Threads Note

Java 21+ virtual threads dapat membuat request concurrency jauh lebih tinggi. Authorization service harus:

- tidak menyimpan actor context di mutable static;
- hati-hati dengan `ThreadLocal` lifecycle;
- membersihkan context setelah request;
- tidak mengandalkan thread identity sebagai session identity;
- memakai request-scoped/context object eksplisit bila memungkinkan.

Untuk Java 8–17 traditional thread pool, problem ThreadLocal leak juga tetap ada, terutama jika context acting tidak dibersihkan.

---

## 18. Audit and Non-Repudiation

### 18.1 Minimum Audit Fields

```text
occurred_at
real_actor_id
effective_subject_id
acting_mode
authority_source_id
authority_type
action
resource_ref
decision
reason_code
policy_version
attribute_snapshot_ref
request_id
correlation_id
ip/device/channel if relevant
```

### 18.2 Audit Allow and Deny

Untuk elevated access, audit both allow and deny.

Kenapa deny penting?

- attempted abuse;
- misconfigured grant;
- actor mencoba keluar scope;
- possible compromised account;
- noisy support behavior.

### 18.3 Non-Repudiation

Dalam konteks ini, non-repudiation berarti sistem dapat membuktikan bahwa:

```text
- actor asli adalah X;
- X bertindak dalam mode M;
- authority source adalah Y;
- policy version adalah Z;
- action dilakukan terhadap resource R;
- reason/justification tercatat;
- waktu dan correlation ID jelas.
```

Jangan membuat audit yang hanya menyimpan effective user.

---

## 19. Privacy and Data Minimization

Impersonation dan break-glass sering membuka data sensitif. Prinsip:

```text
Even if access is authorized, exposure must be minimized.
```

Controls:

1. read-only default;
2. field masking;
3. export disabled;
4. screenshot/download watermark;
5. reason required before viewing sensitive tab;
6. per-screen audit;
7. high-risk field reveal button;
8. data category policy;
9. session timeout shorter;
10. automatic notification where appropriate.

---

## 20. Failure Modes

### 20.1 Actor Identity Lost

Symptom:

```text
audit shows target user, not support admin.
```

Impact:

```text
Cannot prove who actually performed action.
```

Fix:

```text
Always store real_actor and effective_subject.
```

### 20.2 Scope Too Broad

Symptom:

```text
Delegation grants all cases, all actions.
```

Fix:

```text
Require scope and action set. Deny unscoped elevated grants.
```

### 20.3 Expiry Ignored

Symptom:

```text
Grant expired but cached decision still allows.
```

Fix:

```text
Cache TTL must not exceed grant validity.
```

### 20.4 Break-Glass Becomes Normal

Symptom:

```text
Users frequently activate emergency access for daily work.
```

Fix:

```text
Post-use review. Track frequency. Convert legitimate repeated need into proper role/policy.
```

### 20.5 Support Can Mutate Data

Symptom:

```text
Impersonation session allows submit/approve/delete.
```

Fix:

```text
Read-only default. Explicit approval for mutation.
```

### 20.6 SoD Bypass

Symptom:

```text
Maker acts as supervisor and approves own item.
```

Fix:

```text
SoD must check real actor, not only effective role.
```

### 20.7 Delegation Chain Explosion

Symptom:

```text
A delegates to B, B delegates to C, C delegates to D.
```

Fix:

```text
Set max delegation depth. Often depth 1 only for regulated systems.
```

---

## 21. Testing Strategy

### 21.1 Unit Tests

Test matrix:

```text
normal actor cannot use delegated authority
expired delegation denied
revoked delegation denied
wrong action denied
wrong tenant denied
wrong resource type denied
valid delegated action allowed
maker cannot approve own case even as acting supervisor
break-glass without step-up denied
break-glass outside incident scope denied
impersonation mutation denied by default
```

### 21.2 Property-Based Thinking

Invariant:

```text
For every elevated decision, authority_source_id must be present.
```

Invariant:

```text
For every impersonation decision, real_actor_id != effective_subject_id unless explicitly allowed by NORMAL mode.
```

Invariant:

```text
No allowed elevated decision may have now >= valid_until.
```

### 21.3 Integration Tests

- request with active delegation;
- request after revocation;
- concurrent revocation/action;
- cache invalidation;
- audit event produced;
- UI session acting mode reset;
- background job cannot inherit stale actor context.

### 21.4 Security Regression Tests

Attack cases:

```text
change actingMode in browser request
change targetUserId during impersonation
reuse expired session id
use delegation id from another tenant
use break-glass grant for different incident
use support impersonation to export data
approve own work via acting role
```

---

## 22. Production Checklist

Before shipping delegation/impersonation/break-glass:

```text
[ ] Real actor and effective subject are separate.
[ ] Authority source is mandatory for elevated modes.
[ ] Expiry is mandatory.
[ ] Scope is mandatory.
[ ] Reason/justification is mandatory for elevated modes.
[ ] Approval is required for sensitive grants.
[ ] Step-up verification exists for high-risk access.
[ ] UI clearly shows acting/impersonation/break-glass mode.
[ ] All elevated allow decisions are audited.
[ ] Elevated deny decisions are audited.
[ ] Cache key includes acting mode and authority source.
[ ] Cache TTL cannot exceed authority validity.
[ ] Revocation invalidates decision cache.
[ ] SoD checks use real actor.
[ ] Support impersonation is read-only by default.
[ ] Export/download is explicitly controlled.
[ ] Break-glass activation emits alert.
[ ] Break-glass post-use review exists.
[ ] Delegation cannot silently become permanent role.
[ ] Background jobs cannot inherit user acting context accidentally.
```

---

## 23. Design Review Questions

Use these questions in architecture review:

1. Who is the real actor?
2. Who is the effective subject?
3. What is the authority source?
4. What exact actions are granted?
5. What resource scope is granted?
6. Is the authority time-bound?
7. Who approved it?
8. Can it be revoked?
9. What happens to cached decisions after revocation?
10. Does UI indicate special acting mode?
11. Does audit store allow and deny?
12. Can this bypass maker-checker?
13. Can this cross tenant boundary?
14. Can this enable export/download?
15. Can this be used by async/background job accidentally?
16. Can this authority create another authority?
17. Can this survive role removal of the delegator?
18. Can historical decisions be reconstructed?

---

## 24. Top 1% Insight

Engineer biasa melihat delegation/impersonation/break-glass sebagai “fitur admin”.

Engineer matang melihatnya sebagai **authority lifecycle problem**:

```text
request -> approve -> activate -> enforce -> audit -> revoke/expire -> review
```

Engineer top-level melihatnya sebagai **accountability-preserving authorization model**:

```text
No elevated authority without scope.
No scope without time bound.
No time-bound authority without audit.
No impersonation without real actor.
No break-glass without review.
No override without reason.
No delegation without revocation.
No acting role without SoD validation.
```

The hard part is not granting access. The hard part is granting the minimum exceptional authority while preserving accountability, defensibility, and revocability.

---

## 25. Ringkasan

Delegation, impersonation, acting roles, on-behalf-of, override, dan break-glass access adalah mode authorization advanced yang tidak boleh dicampur menjadi satu konsep `admin`.

Model yang benar harus menyimpan:

- real actor;
- effective subject;
- acting mode;
- authority source;
- scope;
- time window;
- reason;
- approval;
- audit trail;
- revocation path.

Dalam Java, desain yang baik memisahkan `ActorContext`, `AuthoritySource`, `ResourceScope`, dan `AuthorizationDecision`. Di Spring Security, `Authentication` boleh menjadi carrier, tetapi domain authorization sebaiknya tetap eksplisit dan testable.

Part berikutnya akan membahas **Hierarchical Organizations and Complex Role Resolution**, yaitu bagaimana role, organization tree, scoped authority, team membership, dan effective permission dihitung dalam organisasi besar tanpa menyebabkan role explosion dan cache inconsistency.

---

## 26. Referensi

- OWASP Authorization Cheat Sheet — guidance untuk least privilege, deny-by-default, centralized authorization, dan access control review.
- OWASP Logging Cheat Sheet — guidance untuk security logging dan audit event design.
- NIST RBAC Model — fondasi role, permission, hierarchy, session, dan separation of duty.
- Spring Security Run-As Authentication — primitive untuk replacement `Authentication` selama secure invocation tertentu.
- Spring Security Authorization Architecture — `AuthorizationManager`, request/method authorization, dan decision flow.
- AWS Prescriptive Guidance: implementing PDP with OPA — contoh policy decoupling dan externalized PDP.
- Open Policy Agent documentation — policy engine dan Rego untuk policy-as-code.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-019.md">⬅️ Learn Java Authorization Modes and Patterns — Part 19</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-021.md">Java Authorization Modes and Patterns — Part 21 ➡️</a>
</div>
