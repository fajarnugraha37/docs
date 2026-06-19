# Java Authorization Modes and Patterns — Part 4
# RBAC Done Properly: Role-Based Access Control Beyond `ADMIN`

> Seri: `learn-java-authorization-modes-and-patterns`  
> File: `learn-java-authorization-modes-and-patterns-part-004.md`  
> Target pembaca: engineer Java yang ingin mendesain authorization enterprise-grade dari Java 8 sampai Java 25  
> Fokus: RBAC sebagai model authorization yang formal, operasional, dapat diaudit, dan tidak jatuh menjadi `isAdmin()` everywhere

---

## 0. Posisi Part Ini dalam Seri

Pada Part 0 kita membangun mental model bahwa authorization bukan sekadar role check, melainkan sistem keputusan:

```text
Can subject S perform action A on resource R under context C?
```

Pada Part 1 kita merapikan vocabulary: subject, actor, principal, permission, role, resource, action, context, policy, entitlement, obligation, dan invariant.

Pada Part 2 kita membedah primitive authorization di Java platform: `Principal`, JAAS, `Subject`, `Permission`, `Policy`, `ProtectionDomain`, dan mengapa SecurityManager tidak lagi menjadi fondasi utama authorization aplikasi modern.

Pada Part 3 kita membangun arsitektur PEP/PDP/PAP/PIP.

Part 4 masuk ke model authorization paling umum di enterprise: **RBAC — Role-Based Access Control**.

Tetapi kita tidak akan membahas RBAC secara dangkal seperti:

```java
if (user.hasRole("ADMIN")) {
    allow();
}
```

Itu bukan RBAC yang matang. Itu baru role check.

RBAC yang benar memiliki model formal, lifecycle, hierarchy, constraints, assignment governance, auditability, revocation, dan strategi mencegah role explosion.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan Part 4, kamu diharapkan mampu:

1. Membedakan role, authority, permission, entitlement, dan capability secara presisi.
2. Memahami RBAC0, RBAC1, RBAC2, dan RBAC3 sebagai model konseptual.
3. Mendesain role hierarchy tanpa menciptakan privilege escalation tersembunyi.
4. Mendesain separation of duty, baik static maupun dynamic.
5. Menghindari role explosion.
6. Menentukan kapan RBAC cukup, kapan perlu ABAC/PBAC/ReBAC/ACL.
7. Membuat model database RBAC yang evolvable.
8. Membuat service Java untuk effective permission resolution.
9. Mengintegrasikan RBAC dengan Spring Security tanpa terjebak `ROLE_` prefix dan authority ambiguity.
10. Mendesain RBAC yang bisa diaudit, direview, dan dimigrasikan.

---

## 2. Mental Model Utama: Role Adalah Abstraksi Organisasi, Bukan Policy Lengkap

RBAC sering disalahpahami sebagai:

```text
User has role -> allow access
```

Model yang lebih benar:

```text
User
  -> assigned to Role
  -> Role is assigned Permissions
  -> Permission authorizes Action on Resource Type
  -> Decision may still be constrained by resource instance and context
```

Diagram:

```text
+---------+       +------+       +------------+       +------------------+
|  User   | ----> | Role | ----> | Permission | ----> | Action + Resource |
+---------+       +------+       +------------+       +------------------+
      \                                                       |
       \                                                      v
        \                                             +---------------+
         -------------------------------------------> |   Context     |
                                                      +---------------+
```

RBAC menjawab:

```text
What is this user's organizational function or granted duty?
```

RBAC **tidak selalu cukup** untuk menjawab:

```text
Is this exact user allowed to approve this exact case right now?
```

Karena pertanyaan kedua mungkin membutuhkan:

1. Ownership.
2. Assignment.
3. Tenant boundary.
4. Case state.
5. Maker-checker rule.
6. Time window.
7. Risk context.
8. Delegation.
9. Separation of duty.

Jadi RBAC bagus sebagai **coarse-grained authorization foundation**, tetapi sering perlu dilengkapi dengan ABAC, workflow guard, relationship rule, atau object-level permission.

---

## 3. Definisi RBAC yang Presisi

Role-Based Access Control adalah model authorization di mana **permissions diasosiasikan ke roles**, dan **users diasosiasikan ke roles**, sehingga access management dilakukan melalui role assignment, bukan pemberian permission langsung ke setiap user.

Model formal klasik RBAC dari NIST/Sandhu menekankan konsep:

```text
Users      = himpunan user
Roles      = himpunan role
Permissions= himpunan permission
Sessions   = aktivasi subset role oleh user pada sesi tertentu
UA         = user-role assignment
PA         = permission-role assignment
RH         = role hierarchy
Constraints= batasan seperti separation of duty
```

Dalam bentuk sederhana:

```text
UA: User -> Role
PA: Role -> Permission
```

Effective permission user:

```text
EffectivePermissions(user) = union(Permissions(role)) for every role assigned to user
```

Jika ada role hierarchy:

```text
EffectivePermissions(user) = union(Permissions(role + inheritedRoles))
```

Jika ada constraints:

```text
Decision = permission exists AND no constraint violated
```

---

## 4. RBAC Bukan Sekadar `role` Claim di JWT

Kesalahan umum:

```json
{
  "sub": "user-123",
  "roles": ["ADMIN", "CASE_OFFICER"]
}
```

Lalu aplikasi langsung percaya:

```java
if (jwt.roles().contains("ADMIN")) {
    allow();
}
```

Masalahnya:

1. Token bisa stale.
2. Role bisa dicabut setelah token diterbitkan.
3. Role mungkin hanya berlaku untuk tenant tertentu.
4. Role mungkin hanya berlaku untuk agency tertentu.
5. Role mungkin tidak boleh aktif bersamaan dengan role lain.
6. Role mungkin memiliki expiry.
7. Role mungkin berasal dari IdP eksternal yang tidak memahami permission internal aplikasi.
8. Role mungkin terlalu coarse-grained.
9. Role mungkin bukan authority final, hanya identity attribute.

Mental model yang lebih aman:

```text
JWT role/claim = evidence/input
Authorization decision = server-side evaluated decision
```

Token claim boleh membantu, tetapi jangan selalu dianggap sebagai policy final.

---

## 5. RBAC0: Core RBAC

RBAC0 adalah model dasar:

```text
User -> Role -> Permission
```

### 5.1 Komponen

```text
User
Role
Permission
Session
UserRoleAssignment
RolePermissionAssignment
```

### 5.2 Contoh

```text
User:
- Alice
- Bob
- Cindy

Roles:
- CASE_OFFICER
- CASE_REVIEWER
- CASE_SUPERVISOR

Permissions:
- case.read
- case.update
- case.submit_review
- case.approve
- case.assign
```

Assignment:

```text
Alice -> CASE_OFFICER
Bob   -> CASE_REVIEWER
Cindy -> CASE_SUPERVISOR
```

Role-permission:

```text
CASE_OFFICER:
- case.read
- case.update
- case.submit_review

CASE_REVIEWER:
- case.read
- case.approve

CASE_SUPERVISOR:
- case.read
- case.assign
```

### 5.3 Decision sederhana

Pertanyaan:

```text
Can Alice submit a case for review?
```

Evaluasi:

```text
Alice -> CASE_OFFICER -> case.submit_review -> allow
```

Pertanyaan:

```text
Can Alice approve a case?
```

Evaluasi:

```text
Alice -> CASE_OFFICER -> no case.approve -> deny
```

### 5.4 Batas RBAC0

RBAC0 belum menjawab:

```text
Can Alice approve case X if Alice created case X?
```

Karena itu bukan hanya role-permission. Itu adalah separation-of-duty / maker-checker / resource-context rule.

---

## 6. RBAC1: Hierarchical RBAC

RBAC1 menambahkan role hierarchy.

Contoh:

```text
CASE_SUPERVISOR inherits CASE_REVIEWER
CASE_REVIEWER   inherits CASE_OFFICER_READONLY
```

Diagram:

```text
CASE_SUPERVISOR
      |
      v
CASE_REVIEWER
      |
      v
CASE_OFFICER_READONLY
```

Jika `CASE_OFFICER_READONLY` punya `case.read`, maka `CASE_REVIEWER` dan `CASE_SUPERVISOR` juga mewarisi `case.read`.

### 6.1 Hierarchy bukan organizational chart mentah

Kesalahan umum:

```text
Director > Manager > Officer
```

Lalu semua permission officer diwariskan ke manager dan director.

Ini sering salah.

Di dunia nyata, atasan tidak selalu boleh melakukan semua aksi bawahan. Contoh:

```text
Officer boleh submit draft.
Supervisor boleh approve/reject.
Supervisor belum tentu boleh edit draft officer tanpa reassignment.
Director boleh view dashboard, belum tentu boleh approve semua case operasional.
```

Jadi role hierarchy harus merepresentasikan **permission inheritance**, bukan sekadar struktur jabatan.

### 6.2 Partial hierarchy

Daripada:

```text
DIRECTOR inherits MANAGER inherits OFFICER
```

Lebih baik:

```text
CASE_VIEWER
CASE_EDITOR inherits CASE_VIEWER
CASE_REVIEWER inherits CASE_VIEWER
CASE_ASSIGNER inherits CASE_VIEWER
CASE_SUPERVISOR inherits CASE_REVIEWER + CASE_ASSIGNER
```

Diagram:

```text
                 CASE_VIEWER
                 /    |     \
                /     |      \
        CASE_EDITOR CASE_REVIEWER CASE_ASSIGNER
                         \        /
                          \      /
                       CASE_SUPERVISOR
```

Ini lebih modular dan mengurangi privilege tidak sengaja.

---

## 7. RBAC2: Constrained RBAC

RBAC2 menambahkan constraints.

Constraint adalah aturan yang membatasi assignment atau activation role.

Dua constraint paling penting:

1. Static Separation of Duty.
2. Dynamic Separation of Duty.

---

## 8. Static Separation of Duty

Static Separation of Duty berarti user tidak boleh memiliki kombinasi role tertentu secara bersamaan.

Contoh:

```text
User tidak boleh punya role REQUESTER dan APPROVER pada modul payment yang sama.
```

Atau dalam case management:

```text
User tidak boleh sekaligus menjadi CASE_CREATOR dan CASE_FINAL_APPROVER untuk case type tertentu.
```

### 8.1 Static constraint pada assignment

Jika user sudah punya:

```text
CASE_CREATOR
```

Maka sistem menolak assignment:

```text
CASE_FINAL_APPROVER
```

untuk scope yang sama.

### 8.2 Pseudocode

```java
boolean canAssignRole(UserId userId, RoleId newRole, Scope scope) {
    Set<RoleId> currentRoles = roleRepository.findRoles(userId, scope);

    for (RoleId existing : currentRoles) {
        if (sodPolicy.conflicts(existing, newRole, scope)) {
            return false;
        }
    }

    return true;
}
```

### 8.3 Static SoD cocok untuk apa?

Cocok untuk constraint yang stabil:

```text
- requester vs approver
- maker vs final checker
- auditor vs auditee for same org scope
- payment initiator vs payment releaser
- role administrator vs privileged account user
```

### 8.4 Batas static SoD

Static SoD bisa terlalu ketat.

Contoh:

Seseorang boleh menjadi reviewer untuk case orang lain, tetapi tidak boleh review case yang dia buat sendiri.

Jika static SoD melarang user punya role `CASE_CREATOR` dan `CASE_REVIEWER` sekaligus, maka terlalu restrictive.

Untuk kasus ini gunakan dynamic SoD.

---

## 9. Dynamic Separation of Duty

Dynamic Separation of Duty berarti user boleh memiliki beberapa role, tetapi tidak boleh mengaktifkan/menggunakan kombinasi tertentu dalam konteks transaksi/resource tertentu.

Contoh:

```text
Alice punya role CASE_OFFICER dan CASE_REVIEWER.
Alice boleh review case milik orang lain.
Alice tidak boleh review case yang Alice submit sendiri.
```

### 9.1 Decision dengan dynamic SoD

```text
Can Alice approve case-123?

Check:
1. Alice has effective permission case.approve? yes.
2. case-123 submittedBy == Alice? yes.
3. dynamic SoD violated -> deny.
```

### 9.2 Java model

```java
public final class CaseApprovalPolicy {

    public AuthorizationDecision canApprove(Subject subject, CaseRecord record) {
        if (!subject.hasPermission("case.approve")) {
            return AuthorizationDecision.deny("MISSING_PERMISSION");
        }

        if (record.submittedBy().equals(subject.userId())) {
            return AuthorizationDecision.deny("MAKER_CHECKER_VIOLATION");
        }

        if (!record.status().equals(CaseStatus.PENDING_REVIEW)) {
            return AuthorizationDecision.deny("INVALID_CASE_STATE");
        }

        return AuthorizationDecision.allow("APPROVER_PERMISSION_AND_STATE_OK");
    }
}
```

### 9.3 Dynamic SoD adalah bridge ke workflow authorization

Dynamic SoD sering tidak bisa diselesaikan oleh RBAC murni.

Ia membutuhkan:

```text
role + permission + resource attribute + workflow state + actor history
```

Jadi secara arsitektur:

```text
RBAC answers: does user have approve capability?
Workflow policy answers: may this user approve this exact case now?
```

---

## 10. RBAC3: Hierarchical + Constrained RBAC

RBAC3 menggabungkan:

```text
RBAC0 core model
+ RBAC1 hierarchy
+ RBAC2 constraints
```

Inilah model RBAC enterprise yang paling realistis.

```text
User -> Role -> Permission
          ^
          |
     Role hierarchy

Constraints:
- cannot assign conflicting roles
- cannot activate conflicting roles
- cannot execute action if transaction-level conflict exists
```

---

## 11. Role, Permission, Authority, Scope: Jangan Dicampur

### 11.1 Role

Role adalah abstraksi tanggung jawab atau fungsi.

```text
CASE_OFFICER
CASE_REVIEWER
CASE_SUPERVISOR
SYSTEM_ADMIN
REPORT_VIEWER
```

### 11.2 Permission

Permission adalah izin melakukan aksi terhadap resource type.

```text
case.read
case.update
case.submit
case.approve
case.assign
report.export
user.manage
```

### 11.3 Authority di Spring Security

Di Spring Security, `GrantedAuthority` adalah string authority yang diberikan ke `Authentication`.

Ia bisa merepresentasikan role atau permission, tergantung desain aplikasi.

Contoh:

```text
ROLE_CASE_OFFICER
case.read
case.update
case.submit
```

Masalah muncul saat semua disebut role.

### 11.4 Scope di OAuth2/OIDC

Scope biasanya merepresentasikan izin yang diberikan ke client untuk mengakses API tertentu.

Contoh:

```text
openid
profile
case:read
case:write
```

Scope bukan selalu business permission user.

### 11.5 Entitlement

Entitlement adalah hak akses efektif yang dimiliki subjek setelah semua assignment, role, policy, dan context diproses.

```text
Alice is entitled to approve case type A in agency X until 2026-12-31.
```

### 11.6 Capability

Capability adalah kemampuan operasional yang bisa dilakukan sistem atau user.

```text
Can export report.
Can assign case.
Can reopen closed case.
```

Capability sering lebih dekat ke business operation daripada permission mentah.

---

## 12. Permission Naming: Role Harus Stabil, Permission Harus Eksplisit

Permission buruk:

```text
read
write
manage
admin
access
use
```

Permission lebih baik:

```text
case.read
case.search
case.create
case.update_draft
case.submit_for_review
case.approve
case.reject
case.reassign
case.reopen
case.export
case.download_attachment
```

### 12.1 Grammar permission

Gunakan pola:

```text
<domain>.<action>
<domain>.<sub_resource>.<action>
<domain>.<workflow_action>
```

Contoh:

```text
case.read
case.attachment.download
case.comment.create
case.transition.approve
appeal.transition.dismiss
report.monthly.export
user.role.assign
```

### 12.2 Hindari permission yang terlalu teknis

Kurang baik:

```text
case.GET
case.POST
case.PUT
case.DELETE
```

Lebih baik:

```text
case.read
case.create
case.update
case.withdraw
```

HTTP method bukan business action.

### 12.3 Hindari permission yang terlalu UI-centric

Kurang baik:

```text
button.approve.visible
page.case.tab2.open
menu.admin.show
```

Lebih baik:

```text
case.approve
case.read_admin_section
user.manage
```

UI boleh memakai permission untuk visibility, tetapi permission jangan dibentuk dari detail UI.

---

## 13. Role Naming: Role Harus Mewakili Tanggung Jawab, Bukan Endpoint

Role buruk:

```text
GET_CASE_API_USER
CREATE_CASE_BUTTON_USER
SCREEN_14_ACCESS
MODULE_A_ADMIN_2
```

Role lebih baik:

```text
CASE_OFFICER
CASE_REVIEWER
CASE_SUPERVISOR
AGENCY_ADMIN
REPORT_AUDITOR
SYSTEM_OPERATOR
```

### 13.1 Role berbasis jabatan vs fungsi

Jabatan:

```text
MANAGER
DIRECTOR
SENIOR_OFFICER
```

Fungsi:

```text
CASE_ASSIGNER
CASE_APPROVER
CASE_AUDITOR
REPORT_EXPORTER
```

Dalam sistem authorization, role berbasis fungsi biasanya lebih stabil.

Jabatan organisasi bisa berubah, tetapi fungsi sistem lebih tahan lama.

---

## 14. Scope-Bound Role

Banyak sistem enterprise salah karena role tidak punya scope.

Contoh salah:

```text
Alice has CASE_REVIEWER
```

Pertanyaan:

```text
Reviewer untuk agency mana?
Reviewer untuk case type apa?
Reviewer sampai kapan?
Reviewer untuk tenant mana?
```

Model lebih benar:

```text
Alice has CASE_REVIEWER within AGENCY_A for CASE_TYPE_LICENSE until 2026-12-31
```

### 14.1 Scope examples

```text
Global scope
Tenant scope
Agency scope
Department scope
Team scope
Case type scope
Region scope
Jurisdiction scope
Project scope
Application module scope
```

### 14.2 Data model

```sql
CREATE TABLE user_role_assignment (
    id                  BIGINT PRIMARY KEY,
    user_id             VARCHAR(100) NOT NULL,
    role_code           VARCHAR(100) NOT NULL,
    scope_type          VARCHAR(50)  NOT NULL,
    scope_id            VARCHAR(100) NOT NULL,
    valid_from          TIMESTAMP    NOT NULL,
    valid_until         TIMESTAMP    NULL,
    assignment_status   VARCHAR(30)  NOT NULL,
    assigned_by         VARCHAR(100) NOT NULL,
    assigned_at         TIMESTAMP    NOT NULL,
    reason              VARCHAR(500) NULL,
    version             BIGINT       NOT NULL
);
```

Unique constraint yang mungkin:

```sql
CREATE UNIQUE INDEX uk_user_role_scope_active
ON user_role_assignment(user_id, role_code, scope_type, scope_id, assignment_status)
WHERE assignment_status = 'ACTIVE';
```

Catatan: syntax partial index berbeda antar database. PostgreSQL mendukung. Oracle perlu pendekatan function-based index atau constraint desain lain.

---

## 15. Role Lifecycle

RBAC enterprise bukan hanya tabel `user_roles`.

Lifecycle yang matang:

```text
Requested
 -> Approved
 -> Active
 -> Suspended
 -> Expired
 -> Revoked
 -> Archived
```

### 15.1 State machine

```text
REQUESTED
   |
   v
APPROVED ---> REJECTED
   |
   v
ACTIVE -----> SUSPENDED
   |              |
   |              v
   |----------> REVOKED
   |
   v
EXPIRED
```

### 15.2 Kenapa lifecycle penting?

Karena authorization bukan hanya runtime decision, tapi juga governance.

Pertanyaan audit:

```text
Siapa memberi role ini?
Kapan diberikan?
Untuk scope apa?
Berdasarkan request apa?
Siapa approver?
Kapan dicabut?
Apakah role masih valid?
Apakah role pernah direview?
```

Jika tabel hanya:

```sql
user_id, role
```

maka sistem tidak bisa menjawab pertanyaan di atas.

---

## 16. Role Assignment Governance

Role assignment harus punya proses.

Minimum metadata:

```text
assignedBy
assignedAt
approvedBy
approvedAt
reason
ticketId/requestId
validFrom
validUntil
scope
source
status
lastReviewedAt
```

### 16.1 Assignment source

```text
MANUAL_ADMIN
HR_SYSTEM
IDP_GROUP_SYNC
MIGRATION
TEMPORARY_DELEGATION
BREAK_GLASS
SYSTEM_BOOTSTRAP
```

Source penting untuk revocation dan audit.

### 16.2 Assignment risk level

```text
LOW      = viewer/report reader
MEDIUM   = editor/operator
HIGH     = approver/admin/exporter
CRITICAL = system admin/security admin/break-glass
```

Role high/critical perlu:

```text
- approval
- expiry
- justification
- review
- stronger audit
```

---

## 17. Role Explosion

Role explosion terjadi ketika role dibuat untuk setiap kombinasi kecil.

Contoh:

```text
AGENCY_A_CASE_LICENSE_REVIEWER_REGION_1
AGENCY_A_CASE_LICENSE_REVIEWER_REGION_2
AGENCY_A_CASE_LICENSE_APPROVER_REGION_1
AGENCY_A_CASE_LICENSE_APPROVER_REGION_2
AGENCY_B_CASE_LICENSE_REVIEWER_REGION_1
...
```

Jumlah role tumbuh secara kombinatorial.

### 17.1 Penyebab role explosion

1. Role dipakai untuk menyimpan scope.
2. Role dipakai untuk menyimpan resource instance.
3. Role dipakai untuk menyimpan workflow state.
4. Role dipakai untuk menyimpan department/team/region.
5. Role dipakai untuk menyimpan permission granular.
6. Tidak ada ABAC/ReBAC untuk bagian yang seharusnya context/resource-driven.

### 17.2 Solusi

Pisahkan:

```text
Role       = function
Scope      = where role applies
Attribute  = condition
Relation   = relationship to resource
Permission = action capability
```

Daripada:

```text
AGENCY_A_LICENSE_APPROVER
AGENCY_B_LICENSE_APPROVER
```

Gunakan:

```text
Role: LICENSE_APPROVER
Scope: AGENCY_A or AGENCY_B
```

Daripada:

```text
CASE_123_REVIEWER
```

Gunakan:

```text
Role: CASE_REVIEWER
Relation: assigned_to(case-123)
```

Daripada:

```text
AFTER_5PM_APPROVER
```

Gunakan:

```text
Role: APPROVER
Context condition: within approved time window
```

---

## 18. RBAC Decision Flow yang Benar

Naive flow:

```text
check role -> allow
```

Better flow:

```text
1. Resolve subject.
2. Resolve active role assignments.
3. Resolve role hierarchy.
4. Resolve permissions from roles.
5. Apply scope filter.
6. Apply static constraints.
7. Apply dynamic constraints.
8. Apply resource/context rule if needed.
9. Return decision with reason.
10. Audit if action is sensitive.
```

Diagram:

```text
Request
  |
  v
Subject Resolver
  |
  v
Role Assignment Resolver
  |
  v
Role Hierarchy Resolver
  |
  v
Permission Resolver
  |
  v
Scope Filter
  |
  v
Constraint Evaluator
  |
  v
Domain Policy Evaluator
  |
  v
Decision: ALLOW / DENY / ERROR
```

---

## 19. Java Domain Model: Java 8-Compatible Version

Karena seri mencakup Java 8 sampai 25, kita mulai dari model yang kompatibel dengan Java 8.

### 19.1 Value objects

```java
import java.util.Objects;

public final class UserId {
    private final String value;

    public UserId(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("UserId must not be blank");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof UserId)) return false;
        UserId userId = (UserId) o;
        return value.equals(userId.value);
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

```java
import java.util.Objects;

public final class RoleCode {
    private final String value;

    public RoleCode(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("RoleCode must not be blank");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof RoleCode)) return false;
        RoleCode roleCode = (RoleCode) o;
        return value.equals(roleCode.value);
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

```java
import java.util.Objects;

public final class PermissionCode {
    private final String value;

    public PermissionCode(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("PermissionCode must not be blank");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof PermissionCode)) return false;
        PermissionCode that = (PermissionCode) o;
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

### 19.2 Scope

```java
import java.util.Objects;

public final class AuthorizationScope {
    private final String type;
    private final String id;

    public AuthorizationScope(String type, String id) {
        if (type == null || type.trim().isEmpty()) {
            throw new IllegalArgumentException("Scope type must not be blank");
        }
        if (id == null || id.trim().isEmpty()) {
            throw new IllegalArgumentException("Scope id must not be blank");
        }
        this.type = type;
        this.id = id;
    }

    public String type() {
        return type;
    }

    public String id() {
        return id;
    }

    public boolean matches(AuthorizationScope required) {
        if (required == null) return false;
        return type.equals(required.type) && id.equals(required.id);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof AuthorizationScope)) return false;
        AuthorizationScope that = (AuthorizationScope) o;
        return type.equals(that.type) && id.equals(that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(type, id);
    }
}
```

### 19.3 Role assignment

```java
import java.time.Instant;

public final class RoleAssignment {
    private final UserId userId;
    private final RoleCode roleCode;
    private final AuthorizationScope scope;
    private final Instant validFrom;
    private final Instant validUntil;
    private final AssignmentStatus status;

    public RoleAssignment(
            UserId userId,
            RoleCode roleCode,
            AuthorizationScope scope,
            Instant validFrom,
            Instant validUntil,
            AssignmentStatus status
    ) {
        this.userId = userId;
        this.roleCode = roleCode;
        this.scope = scope;
        this.validFrom = validFrom;
        this.validUntil = validUntil;
        this.status = status;
    }

    public UserId userId() {
        return userId;
    }

    public RoleCode roleCode() {
        return roleCode;
    }

    public AuthorizationScope scope() {
        return scope;
    }

    public boolean isActiveAt(Instant now) {
        if (status != AssignmentStatus.ACTIVE) {
            return false;
        }
        if (validFrom != null && now.isBefore(validFrom)) {
            return false;
        }
        if (validUntil != null && !now.isBefore(validUntil)) {
            return false;
        }
        return true;
    }
}
```

```java
public enum AssignmentStatus {
    REQUESTED,
    APPROVED,
    ACTIVE,
    SUSPENDED,
    EXPIRED,
    REVOKED,
    REJECTED
}
```

### 19.4 Decision object

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final String reasonCode;

    private AuthorizationDecision(boolean allowed, String reasonCode) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
    }

    public static AuthorizationDecision allow(String reasonCode) {
        return new AuthorizationDecision(true, reasonCode);
    }

    public static AuthorizationDecision deny(String reasonCode) {
        return new AuthorizationDecision(false, reasonCode);
    }

    public boolean isAllowed() {
        return allowed;
    }

    public String reasonCode() {
        return reasonCode;
    }
}
```

---

## 20. Java 17+/21+/25-Friendly Version

Jika project memakai Java 17+, model bisa lebih ringkas dengan `record`.

```java
public record UserId(String value) {
    public UserId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("UserId must not be blank");
        }
    }
}
```

```java
public record RoleCode(String value) {
    public RoleCode {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("RoleCode must not be blank");
        }
    }
}
```

```java
public record PermissionCode(String value) {
    public PermissionCode {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("PermissionCode must not be blank");
        }
    }
}
```

```java
public record AuthorizationScope(String type, String id) {
    public AuthorizationScope {
        if (type == null || type.isBlank()) {
            throw new IllegalArgumentException("Scope type must not be blank");
        }
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("Scope id must not be blank");
        }
    }
}
```

Java 21/25 tidak mengubah konsep RBAC, tetapi membantu expressiveness dengan:

```text
records       -> immutable value object ringkas
sealed types  -> controlled decision/result hierarchy
pattern switch-> clearer handling for decision variants
virtual thread-> useful for blocking policy/attribute lookups if properly bounded
```

Namun authorization correctness tetap berasal dari model, bukan fitur bahasa.

---

## 21. Effective Permission Resolution

Effective permission adalah permission aktual yang dimiliki user setelah role assignment, hierarchy, scope, dan validity diproses.

### 21.1 Interface repository

```java
import java.time.Instant;
import java.util.Set;

public interface RoleAssignmentRepository {
    Set<RoleAssignment> findActiveAssignments(UserId userId, Instant now);
}
```

```java
import java.util.Set;

public interface RoleHierarchyRepository {
    Set<RoleCode> findInheritedRoles(RoleCode roleCode);
}
```

```java
import java.util.Set;

public interface RolePermissionRepository {
    Set<PermissionCode> findPermissions(RoleCode roleCode);
}
```

### 21.2 Resolver

```java
import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

public final class EffectivePermissionResolver {
    private final RoleAssignmentRepository assignmentRepository;
    private final RoleHierarchyRepository hierarchyRepository;
    private final RolePermissionRepository permissionRepository;
    private final Clock clock;

    public EffectivePermissionResolver(
            RoleAssignmentRepository assignmentRepository,
            RoleHierarchyRepository hierarchyRepository,
            RolePermissionRepository permissionRepository,
            Clock clock
    ) {
        this.assignmentRepository = assignmentRepository;
        this.hierarchyRepository = hierarchyRepository;
        this.permissionRepository = permissionRepository;
        this.clock = clock;
    }

    public Set<PermissionCode> resolve(UserId userId, AuthorizationScope requiredScope) {
        Instant now = clock.instant();
        Set<RoleAssignment> assignments = assignmentRepository.findActiveAssignments(userId, now);
        Set<RoleCode> effectiveRoles = new HashSet<>();

        for (RoleAssignment assignment : assignments) {
            if (!assignment.isActiveAt(now)) {
                continue;
            }
            if (!assignment.scope().matches(requiredScope)) {
                continue;
            }
            effectiveRoles.add(assignment.roleCode());
            effectiveRoles.addAll(hierarchyRepository.findInheritedRoles(assignment.roleCode()));
        }

        Set<PermissionCode> permissions = new HashSet<>();
        for (RoleCode role : effectiveRoles) {
            permissions.addAll(permissionRepository.findPermissions(role));
        }

        return permissions;
    }
}
```

### 21.3 Kenapa resolver tidak langsung return boolean?

Karena dalam production kamu sering butuh:

```text
- audit evidence
- explanation
- debugging
- comparison
- bulk decision
- policy simulation
- cache
```

Boolean kehilangan informasi.

Lebih matang:

```java
public final class EffectiveAuthorization {
    private final UserId userId;
    private final AuthorizationScope scope;
    private final Set<RoleCode> roles;
    private final Set<PermissionCode> permissions;

    public EffectiveAuthorization(
            UserId userId,
            AuthorizationScope scope,
            Set<RoleCode> roles,
            Set<PermissionCode> permissions
    ) {
        this.userId = userId;
        this.scope = scope;
        this.roles = roles;
        this.permissions = permissions;
    }

    public boolean hasPermission(PermissionCode permission) {
        return permissions.contains(permission);
    }

    public Set<RoleCode> roles() {
        return roles;
    }

    public Set<PermissionCode> permissions() {
        return permissions;
    }
}
```

---

## 22. RBAC Authorization Service

```java
public final class RbacAuthorizationService {
    private final EffectiveAuthorizationResolver resolver;

    public RbacAuthorizationService(EffectiveAuthorizationResolver resolver) {
        this.resolver = resolver;
    }

    public AuthorizationDecision authorize(
            UserId userId,
            PermissionCode requiredPermission,
            AuthorizationScope scope
    ) {
        EffectiveAuthorization effective = resolver.resolve(userId, scope);

        if (effective.hasPermission(requiredPermission)) {
            return AuthorizationDecision.allow("PERMISSION_GRANTED_BY_ROLE");
        }

        return AuthorizationDecision.deny("MISSING_PERMISSION");
    }
}
```

Dengan interface:

```java
public interface EffectiveAuthorizationResolver {
    EffectiveAuthorization resolve(UserId userId, AuthorizationScope scope);
}
```

### 22.1 Jangan bocorkan role check ke seluruh codebase

Buruk:

```java
if (user.hasRole("CASE_SUPERVISOR") || user.hasRole("SYSTEM_ADMIN")) {
    approve(caseId);
}
```

Lebih baik:

```java
AuthorizationDecision decision = authorizationService.authorize(
    userId,
    new PermissionCode("case.approve"),
    new AuthorizationScope("AGENCY", agencyId)
);

if (!decision.isAllowed()) {
    throw new AccessDeniedException(decision.reasonCode());
}
```

Kenapa?

Karena business operation tidak perlu tahu role mana yang memberikan permission.

Jika besok `CASE_REVIEWER` juga boleh approve untuk case type tertentu, service tidak perlu diubah di banyak tempat.

---

## 23. Database Model RBAC

### 23.1 Role table

```sql
CREATE TABLE auth_role (
    role_code       VARCHAR(100) PRIMARY KEY,
    display_name    VARCHAR(200) NOT NULL,
    description     VARCHAR(1000),
    risk_level      VARCHAR(30) NOT NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL
);
```

### 23.2 Permission table

```sql
CREATE TABLE auth_permission (
    permission_code VARCHAR(150) PRIMARY KEY,
    resource_type   VARCHAR(100) NOT NULL,
    action_code     VARCHAR(100) NOT NULL,
    display_name    VARCHAR(200) NOT NULL,
    description     VARCHAR(1000),
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL
);
```

### 23.3 Role-permission assignment

```sql
CREATE TABLE auth_role_permission (
    role_code       VARCHAR(100) NOT NULL,
    permission_code VARCHAR(150) NOT NULL,
    granted_at      TIMESTAMP NOT NULL,
    granted_by      VARCHAR(100) NOT NULL,
    PRIMARY KEY (role_code, permission_code),
    FOREIGN KEY (role_code) REFERENCES auth_role(role_code),
    FOREIGN KEY (permission_code) REFERENCES auth_permission(permission_code)
);
```

### 23.4 Role hierarchy

```sql
CREATE TABLE auth_role_hierarchy (
    parent_role_code VARCHAR(100) NOT NULL,
    child_role_code  VARCHAR(100) NOT NULL,
    created_at       TIMESTAMP NOT NULL,
    created_by       VARCHAR(100) NOT NULL,
    PRIMARY KEY (parent_role_code, child_role_code),
    FOREIGN KEY (parent_role_code) REFERENCES auth_role(role_code),
    FOREIGN KEY (child_role_code) REFERENCES auth_role(role_code),
    CHECK (parent_role_code <> child_role_code)
);
```

Interpretasi:

```text
parent inherits child
```

Contoh:

```text
CASE_SUPERVISOR inherits CASE_REVIEWER
```

Maka:

```text
parent_role_code = CASE_SUPERVISOR
child_role_code  = CASE_REVIEWER
```

### 23.5 User-role assignment

```sql
CREATE TABLE auth_user_role_assignment (
    assignment_id     BIGINT PRIMARY KEY,
    user_id           VARCHAR(100) NOT NULL,
    role_code         VARCHAR(100) NOT NULL,
    scope_type        VARCHAR(50) NOT NULL,
    scope_id          VARCHAR(100) NOT NULL,
    status            VARCHAR(30) NOT NULL,
    valid_from        TIMESTAMP NOT NULL,
    valid_until       TIMESTAMP NULL,
    requested_by      VARCHAR(100),
    requested_at      TIMESTAMP,
    approved_by       VARCHAR(100),
    approved_at       TIMESTAMP,
    assigned_by       VARCHAR(100) NOT NULL,
    assigned_at       TIMESTAMP NOT NULL,
    assignment_source VARCHAR(50) NOT NULL,
    reason            VARCHAR(1000),
    last_reviewed_at  TIMESTAMP,
    version           BIGINT NOT NULL,
    FOREIGN KEY (role_code) REFERENCES auth_role(role_code)
);
```

### 23.6 SoD conflict table

```sql
CREATE TABLE auth_role_conflict (
    role_code_a    VARCHAR(100) NOT NULL,
    role_code_b    VARCHAR(100) NOT NULL,
    scope_type     VARCHAR(50) NULL,
    conflict_type  VARCHAR(30) NOT NULL,
    reason_code    VARCHAR(100) NOT NULL,
    created_at     TIMESTAMP NOT NULL,
    created_by     VARCHAR(100) NOT NULL,
    PRIMARY KEY (role_code_a, role_code_b, conflict_type)
);
```

`conflict_type`:

```text
STATIC_SOD
DYNAMIC_SOD
ASSIGNMENT_REQUIRES_APPROVAL
```

---

## 24. Role Hierarchy Cycle Detection

Role hierarchy tidak boleh punya cycle.

Buruk:

```text
A inherits B
B inherits C
C inherits A
```

Jika tidak dicegah, effective permission resolution bisa infinite loop atau memberikan privilege tidak jelas.

### 24.1 Java cycle check

```java
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public final class RoleHierarchyCycleDetector {

    public boolean hasCycle(Map<RoleCode, Set<RoleCode>> graph) {
        Set<RoleCode> visiting = new HashSet<>();
        Set<RoleCode> visited = new HashSet<>();

        for (RoleCode role : graph.keySet()) {
            if (dfs(role, graph, visiting, visited)) {
                return true;
            }
        }
        return false;
    }

    private boolean dfs(
            RoleCode role,
            Map<RoleCode, Set<RoleCode>> graph,
            Set<RoleCode> visiting,
            Set<RoleCode> visited
    ) {
        if (visited.contains(role)) {
            return false;
        }
        if (visiting.contains(role)) {
            return true;
        }

        visiting.add(role);
        Set<RoleCode> children = graph.get(role);
        if (children != null) {
            for (RoleCode child : children) {
                if (dfs(child, graph, visiting, visited)) {
                    return true;
                }
            }
        }
        visiting.remove(role);
        visited.add(role);
        return false;
    }
}
```

### 24.2 Production rule

Setiap perubahan role hierarchy harus divalidasi:

```text
- no cycle
- no self inheritance
- no inactive role reference
- no critical role inheritance without approval
- no privilege escalation beyond requested scope
```

---

## 25. Spring Security Integration

Spring Security menggunakan `GrantedAuthority` sebagai unit authority. Role hanyalah convention di atas authority.

### 25.1 `hasRole` vs `hasAuthority`

Secara umum:

```java
hasRole("ADMIN")
```

sering diasosiasikan dengan authority:

```text
ROLE_ADMIN
```

Sedangkan:

```java
hasAuthority("case.approve")
```

langsung memeriksa authority string.

### 25.2 Rekomendasi

Untuk enterprise authorization, lebih aman memakai permission sebagai authority runtime:

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approveCase(String caseId) {
    // method body
}
```

Tetapi untuk object-specific authorization, jangan berhenti di situ.

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approveCase(String caseId) {
    // masih perlu check: boleh approve case ini?
}
```

Lebih matang:

```java
public void approveCase(String caseId) {
    CaseRecord record = caseRepository.getById(caseId);

    AuthorizationDecision decision = casePolicy.canApprove(currentSubject(), record);
    if (!decision.isAllowed()) {
        throw new AccessDeniedException(decision.reasonCode());
    }

    record.approve(currentSubject().userId());
    caseRepository.save(record);
}
```

### 25.3 Mapping role ke authorities

Saat user login atau request diproses:

```text
roles -> effective permissions -> GrantedAuthority
```

Contoh:

```java
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import java.util.Set;
import java.util.stream.Collectors;

public final class GrantedAuthorityMapper {

    public Set<GrantedAuthority> toAuthorities(Set<PermissionCode> permissions) {
        return permissions.stream()
                .map(permission -> new SimpleGrantedAuthority(permission.value()))
                .collect(Collectors.toSet());
    }
}
```

### 25.4 Jangan expose semua role sebagai authority jika permission yang dicek

Jika aplikasi memutuskan check berdasarkan permission, jangan campur:

```text
ROLE_CASE_OFFICER
case.read
case.update
```

kecuali kamu punya naming convention dan rule yang jelas.

Campuran tanpa disiplin menyebabkan bug seperti:

```java
hasAuthority("CASE_OFFICER")
hasRole("CASE_OFFICER")
hasAuthority("ROLE_CASE_OFFICER")
hasAuthority("case.update")
```

Empat bentuk di atas bisa berarti empat hal berbeda.

---

## 26. RBAC di Jakarta EE

Di Jakarta EE, role biasanya muncul pada declarative security:

```java
@RolesAllowed("CASE_REVIEWER")
public void approveCase(...) {
    ...
}
```

Ini cocok untuk coarse-grained method guard.

Tetapi sama seperti Spring:

```text
@RolesAllowed hanya menjawab role-level access.
```

Ia tidak otomatis menjawab:

```text
- apakah case ini milik agency user?
- apakah user submitter-nya sendiri?
- apakah case state mengizinkan approval?
- apakah role berlaku untuk scope ini?
```

Jadi gunakan declarative role guard sebagai PEP awal, lalu domain policy tetap diperlukan.

---

## 27. RBAC dan API Gateway

API Gateway bisa melakukan coarse authorization:

```text
/admin/** requires SYSTEM_ADMIN
/reports/** requires REPORT_VIEWER or REPORT_EXPORTER
/api/cases/** requires authenticated user
```

Tetapi gateway tidak cukup untuk object-level dan domain-level rule.

Contoh:

```http
GET /api/cases/CASE-123
```

Gateway bisa tahu user authenticated dan punya `case.read`, tapi gateway biasanya tidak tahu:

```text
CASE-123 belongs to agency X
User belongs to agency Y
```

Maka object-level authorization tetap di service.

---

## 28. Caching RBAC

RBAC sering cacheable karena role-permission assignment relatif stabil.

Yang bisa dicache:

```text
- role -> permissions
- role hierarchy closure
- user -> active role assignments
- user+scope -> effective permissions
```

Yang harus hati-hati:

```text
- temporary role
- break-glass role
- revoked role
- high-risk permission
- scope-specific permission
- session-activated role
```

### 28.1 Cache key

Buruk:

```text
userId
```

Lebih baik:

```text
userId + tenantId + scopeType + scopeId + policyVersion + assignmentVersion
```

Contoh:

```java
public final class EffectivePermissionCacheKey {
    private final String userId;
    private final String tenantId;
    private final String scopeType;
    private final String scopeId;
    private final long assignmentVersion;
    private final long policyVersion;

    // constructor, equals, hashCode
}
```

### 28.2 Invalidation

Invalidate saat:

```text
- role assigned
- role revoked
- role expired
- role permission changed
- hierarchy changed
- SoD constraint changed
- tenant membership changed
- user suspended
```

### 28.3 TTL

Untuk low-risk permission:

```text
TTL 5-15 minutes may be acceptable
```

Untuk high-risk permission:

```text
short TTL or version-based invalidation
```

Untuk break-glass:

```text
avoid long cache; prefer direct validation
```

---

## 29. RBAC Audit Model

Authorization audit untuk RBAC minimal harus menjawab:

```text
Who had what role?
Who granted it?
When?
For what scope?
Why?
Which permissions did it imply at that time?
Which policy version was active?
Was the role still valid during the action?
```

### 29.1 Decision audit event

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decision": "ALLOW",
  "reasonCode": "PERMISSION_GRANTED_BY_ROLE",
  "subjectId": "user-123",
  "action": "case.approve",
  "resourceType": "case",
  "resourceId": "case-456",
  "scopeType": "AGENCY",
  "scopeId": "agency-a",
  "rolesUsed": ["CASE_REVIEWER"],
  "permissionsUsed": ["case.approve"],
  "policyVersion": "rbac-policy-2026-06-01",
  "assignmentVersion": 42,
  "correlationId": "req-abc",
  "timestamp": "2026-06-19T10:15:30Z"
}
```

### 29.2 Audit allow dan deny

Untuk sensitive action, audit keduanya:

```text
ALLOW: siapa berhasil melakukan sensitive operation
DENY : siapa mencoba melakukan sensitive operation
```

Namun deny audit harus hati-hati agar tidak menyimpan data sensitif yang seharusnya tidak diketahui user.

---

## 30. RBAC Testing Strategy

### 30.1 Permission matrix test

Buat matrix:

```text
Role             case.read  case.update  case.approve  case.assign
CASE_OFFICER     yes        yes          no            no
CASE_REVIEWER    yes        no           yes           no
CASE_SUPERVISOR  yes        no           yes           yes
```

Test:

```java
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class RbacMatrixTest {

    @Test
    void caseOfficerShouldNotApproveCase() {
        EffectiveAuthorization auth = fixture.effectiveAuthFor("CASE_OFFICER");
        assertFalse(auth.hasPermission(new PermissionCode("case.approve")));
    }

    @Test
    void caseReviewerShouldApproveCase() {
        EffectiveAuthorization auth = fixture.effectiveAuthFor("CASE_REVIEWER");
        assertTrue(auth.hasPermission(new PermissionCode("case.approve")));
    }
}
```

### 30.2 Negative test wajib

Jangan hanya test allow path.

Test:

```text
- user without role denied
- user with expired role denied
- user with role in wrong scope denied
- user with suspended assignment denied
- conflicting role assignment denied
- inherited role permission resolved correctly
- hierarchy cycle rejected
- revoked role invalidates cache
```

### 30.3 Mutation-style thinking

Bayangkan bug:

```text
scope check dihapus
validUntil check salah operator
role hierarchy inheritance terbalik
ROLE_ prefix salah
cache key tidak include tenant
```

Test harus menangkap bug tersebut.

---

## 31. RBAC Anti-Patterns

### 31.1 `isAdmin()` everywhere

```java
if (user.isAdmin()) {
    // allow everything
}
```

Masalah:

```text
- tidak least privilege
- sulit audit
- sulit review
- tidak jelas admin untuk apa
- menjadi bypass universal
```

Solusi:

```text
Gunakan permission spesifik:
- user.manage
- role.assign
- case.reopen
- system.config.update
```

### 31.2 Role sebagai permission

```text
APPROVE_CASE_ROLE
READ_CASE_ROLE
EXPORT_REPORT_ROLE
```

Ini sebenarnya permission, bukan role.

Solusi:

```text
Role: CASE_REVIEWER
Permission: case.approve
```

### 31.3 Permission sebagai role

```text
Role: ADMIN
Permission: ADMIN
```

Tidak memberi makna.

### 31.4 Role menyimpan scope

```text
AGENCY_A_CASE_REVIEWER
AGENCY_B_CASE_REVIEWER
```

Solusi:

```text
Role: CASE_REVIEWER
Scope: AGENCY_A / AGENCY_B
```

### 31.5 Role check di UI dianggap enforcement

UI boleh menyembunyikan button, tetapi server tetap harus enforce.

### 31.6 Hardcoded role di banyak tempat

```java
if (hasRole("CASE_SUPERVISOR"))
```

tersebar di controller, service, repository.

Solusi:

```text
Centralize into authorization service/policy.
```

### 31.7 Tidak ada expiry untuk privileged role

Critical role harus punya expiry atau review.

### 31.8 Tidak ada review access

RBAC tanpa access review akan membusuk.

### 31.9 Role hierarchy mengikuti org chart mentah

Organizational seniority tidak selalu sama dengan access inheritance.

### 31.10 Trust role dari request body

Fatal:

```json
{
  "userId": "alice",
  "role": "ADMIN"
}
```

Client tidak boleh menentukan authority dirinya sendiri.

---

## 32. Kapan RBAC Cukup?

RBAC cukup jika:

```text
- permission mostly based on job function
- resources not highly individualized
- tenant/scope simple
- workflow rule sederhana
- no complex relationship graph
- no high-frequency policy change
- no object-level sharing
```

Contoh:

```text
- admin dashboard module access
- report viewer/exporter
- internal tool role segmentation
- coarse API access
- standard back-office function
```

---

## 33. Kapan RBAC Tidak Cukup?

RBAC tidak cukup jika access bergantung pada:

```text
- ownership
- resource instance
- assignment relation
- case state
- maker-checker history
- tenant boundary
- organization hierarchy yang kompleks
- risk score
- time/location/device context
- delegation chain
- object sharing
- graph relationship
```

Contoh:

```text
CASE_REVIEWER boleh approve case, tetapi bukan case yang dia submit sendiri.
```

RBAC hanya menjawab:

```text
CASE_REVIEWER has case.approve
```

Policy tambahan menjawab:

```text
subject != submittedBy
case.status == PENDING_REVIEW
subject.agency == case.agency
```

---

## 34. RBAC + ABAC + ReBAC: Komposisi yang Sehat

Model matang:

```text
RBAC: user has function capability
ABAC: attributes satisfy context/resource constraints
ReBAC: user has relationship to resource
Workflow: action valid for current state
```

Decision:

```text
ALLOW if:
1. user has permission case.approve from role
2. user agency == case agency
3. user != case submittedBy
4. case status == PENDING_REVIEW
5. user assignment is active
6. no SoD violation
```

Diagram:

```text
RBAC permission      -> case.approve?
ABAC constraint      -> same agency?
ReBAC relation       -> assigned reviewer?
Workflow constraint  -> pending review?
SoD constraint       -> not submitter?
------------------------------------------------
Final decision       -> allow/deny
```

---

## 35. Production Checklist untuk RBAC

### 35.1 Modeling checklist

```text
[ ] Role merepresentasikan business function, bukan endpoint.
[ ] Permission merepresentasikan action-resource capability.
[ ] Role dan permission tidak dicampur sembarangan.
[ ] Scope role dimodelkan eksplisit.
[ ] Role hierarchy tidak mengikuti org chart secara mentah.
[ ] Role hierarchy bebas cycle.
[ ] Static SoD dimodelkan.
[ ] Dynamic SoD dimodelkan untuk transaction/resource-level conflict.
[ ] Privileged role punya risk level.
[ ] Privileged role punya expiry/review.
```

### 35.2 Runtime checklist

```text
[ ] Role assignment resolve dari source terpercaya.
[ ] Expired/suspended/revoked assignment tidak aktif.
[ ] Scope masuk ke cache key.
[ ] Tenant masuk ke cache key.
[ ] Permission check tidak bergantung pada request body.
[ ] Object-level authorization tetap dilakukan di service/domain layer.
[ ] Gateway authorization tidak dianggap cukup.
[ ] Deny-by-default.
[ ] Decision punya reason code.
[ ] Sensitive allow/deny diaudit.
```

### 35.3 Governance checklist

```text
[ ] Assignment punya assignedBy/approvedBy/reason.
[ ] Role change punya audit trail.
[ ] Role-permission change punya approval.
[ ] Access review periodik tersedia.
[ ] Orphan role dideteksi.
[ ] Unused permission dideteksi.
[ ] Toxic role combination dideteksi.
[ ] Break-glass role dimonitor.
```

### 35.4 Testing checklist

```text
[ ] Permission matrix tested.
[ ] Negative cases tested.
[ ] Wrong scope denied.
[ ] Expired role denied.
[ ] Revoked role denied.
[ ] Cache invalidation tested.
[ ] Role hierarchy tested.
[ ] SoD tested.
[ ] IDOR path tested.
[ ] Bulk operation tested.
```

---

## 36. Top 1% Engineering Insight

Engineer biasa bertanya:

```text
Role apa yang dibutuhkan endpoint ini?
```

Engineer yang lebih matang bertanya:

```text
Capability apa yang dibutuhkan operation ini?
Dari role mana capability itu boleh diperoleh?
Dalam scope apa role itu berlaku?
Apakah role assignment masih aktif?
Apakah ada conflict of duty?
Apakah resource ini berada dalam boundary yang benar?
Apakah state resource memperbolehkan aksi ini?
Apakah keputusan ini bisa diaudit dan direkonstruksi?
```

RBAC yang baik bukan soal punya banyak role.

RBAC yang baik adalah soal:

```text
stable responsibility model
+ explicit permission model
+ scoped assignment
+ controlled inheritance
+ enforceable constraints
+ auditable lifecycle
+ safe integration with domain policy
```

Jika sistem hanya punya:

```text
ADMIN, USER
```

maka itu bukan authorization architecture. Itu emergency shortcut.

Jika sistem punya ribuan role karena semua scope dan condition dimasukkan ke nama role, itu juga bukan architecture matang. Itu role explosion.

Desain yang matang memisahkan:

```text
role        = responsibility/function
permission  = capability/action
scope       = where it applies
attribute   = condition
relation    = connection to resource
policy      = rule that composes all of them
```

---

## 37. Ringkasan

RBAC adalah fondasi authorization enterprise yang sangat berguna, tetapi hanya jika dimodelkan secara benar.

Poin utama:

1. RBAC bukan sekadar `hasRole("ADMIN")`.
2. RBAC core adalah `User -> Role -> Permission`.
3. RBAC hierarchy harus merepresentasikan permission inheritance, bukan org chart mentah.
4. Static SoD mencegah assignment role yang konflik.
5. Dynamic SoD mencegah penggunaan role yang konflik dalam transaksi/resource tertentu.
6. Role harus stabil dan berbasis fungsi.
7. Permission harus eksplisit dan berbasis action-resource.
8. Scope harus eksplisit, jangan dimasukkan ke nama role.
9. Role lifecycle penting untuk audit dan governance.
10. RBAC sering perlu dikomposisikan dengan ABAC, ReBAC, ACL, dan workflow policy.
11. Dalam Spring Security, pahami perbedaan role dan authority.
12. Dalam Jakarta EE, declarative role security berguna tetapi tidak cukup untuk domain authorization.
13. Caching RBAC aman hanya jika cache key dan invalidation benar.
14. Authorization decision harus bisa dijelaskan dan diaudit.

---

## 38. Referensi

1. NIST Computer Security Resource Center — Role Based Access Control project page.  
   https://csrc.nist.gov/projects/role-based-access-control

2. Sandhu, Ferraiolo, Kuhn — The NIST Model for Role-Based Access Control: Towards a Unified Standard.  
   https://csrc.nist.gov/csrc/media/projects/role-based-access-control/documents/sandhu96.pdf

3. ANSI/INCITS 359 RBAC reference model discussion.  
   https://blog.ansi.org/ansi/role-based-access-control-rbac-incits-359/

4. Spring Security Reference — Authorization Architecture.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

5. Spring Security Reference — Method Security.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html

6. Jakarta Authorization Specification.  
   https://jakarta.ee/specifications/authorization/

7. Jakarta Security Specification.  
   https://jakarta.ee/specifications/security/

---

## 39. Status Seri

Selesai:

```text
[x] Part 0 — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
[x] Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4 — RBAC Done Properly: Role-Based Access Control Beyond ADMIN
```

Belum selesai. Part berikutnya:

```text
[ ] Part 5 — Permission and Capability Modeling
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-003.md">⬅️ Java Authorization Modes and Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-005.md">Part 5 — Permission and Capability Modeling ➡️</a>
</div>
