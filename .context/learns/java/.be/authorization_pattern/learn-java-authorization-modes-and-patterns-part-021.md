# Java Authorization Modes and Patterns — Part 21
# Hierarchical Organizations and Complex Role Resolution

> Seri: `learn-java-authorization-modes-and-patterns`  
> Part: `021`  
> Topik: hierarchical organizations, scoped role, position-based access, role resolution, effective permission calculation, cache invalidation, and access review  
> Target: Java 8 sampai Java 25  
> Status seri: belum selesai

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas delegation, impersonation, acting roles, dan break-glass access. Semua itu adalah bentuk authorization yang muncul ketika kewenangan tidak lagi sederhana: seseorang dapat bertindak sebagai dirinya sendiri, mewakili orang lain, memakai kewenangan sementara, atau melakukan tindakan darurat.

Bagian ini masuk ke problem enterprise yang lebih fundamental:

> Bagaimana menentukan effective access seseorang ketika organisasi memiliki hierarki, unit, posisi, role lokal, role global, team, agency, division, delegation, dan resource scope?

Di aplikasi kecil, authorization sering terlihat seperti ini:

```java
if (user.hasRole("ADMIN")) {
    allow();
}
```

Di sistem enterprise/case-management/regulatory, model tersebut cepat hancur karena realitasnya lebih dekat seperti ini:

```text
User A adalah Senior Officer di Division Enforcement.
User A juga menjadi Acting Team Lead untuk Team Investigation sampai 30 Juni.
User A boleh melihat semua case milik division-nya.
User A boleh mengubah case yang assigned ke team-nya.
User A tidak boleh approve case yang dia submit sendiri.
User A boleh melakukan emergency reassignment hanya jika ada break-glass approval.
User A boleh melihat report lintas division hanya untuk statistik agregat, bukan detail case.
```

Yang sulit bukan hanya “role apa yang user punya”, tetapi:

```text
role tersebut berlaku di scope mana?
role tersebut diwarisi dari struktur organisasi mana?
role tersebut aktif kapan?
role tersebut berlaku untuk action dan resource apa?
role tersebut bentrok dengan separation-of-duty rule apa?
role tersebut harus dievaluasi bersama assignment, relationship, tenant, dan state resource apa?
```

Tujuan part ini:

1. Membedakan role global, scoped role, org role, position role, team role, dan relationship-derived role.
2. Mendesain model hierarki organisasi untuk authorization.
3. Menghitung effective permission secara benar.
4. Menghindari role explosion.
5. Mendesain cache effective access yang aman.
6. Mengintegrasikan role hierarchy dengan Spring Security tanpa menjadikannya satu-satunya sumber kebenaran.
7. Mendesain database schema dan Java model yang cukup fleksibel.
8. Menyusun testing, audit, dan access review untuk struktur organisasi kompleks.

---

## 1. Mental Model Utama

Authorization pada organisasi kompleks bukan lagi pertanyaan:

```text
Does user have role X?
```

Melainkan:

```text
Given user U,
performing action A,
on resource R,
under organization scope S,
at time T,
through channel C,
with current assignments/delegations/position memberships,
what effective authority does U have,
and is it enough to satisfy the policy invariant?
```

Model yang lebih tepat:

```text
Identity
  -> memberships
  -> positions
  -> scoped roles
  -> inherited roles
  -> permissions/capabilities
  -> relationship-derived access
  -> constraints
  -> final authorization decision
```

Dengan kata lain:

```text
Authorization = entitlement derivation + policy evaluation + constraint enforcement
```

Bukan hanya lookup role.

---

## 2. Kenapa Hierarchical Organization Sulit

Hierarki organisasi terlihat sederhana di diagram:

```text
Agency
└── Division
    └── Department
        └── Team
```

Tetapi authorization tidak selalu mengikuti pohon tersebut secara bersih.

Contoh problem:

### 2.1 User Bisa Punya Banyak Posisi

```text
Fajar
├── Officer, Enforcement Division
├── Acting Lead, Investigation Team
└── Reviewer, Cross-Agency Taskforce
```

Jika sistem hanya menyimpan satu `department_id` pada user, maka model authorization langsung rusak.

### 2.2 Role Bisa Berlaku Hanya di Scope Tertentu

```text
ROLE_CASE_MANAGER @ Team A
ROLE_CASE_MANAGER @ Team B
ROLE_CASE_MANAGER @ Agency X
```

Nama role sama, tetapi efeknya berbeda.

`CASE_MANAGER @ Team A` tidak boleh otomatis mengelola case Team B.

### 2.3 Role Bisa Diwarisi

Jika user adalah `Division Head` di Division A, apakah dia otomatis punya access ke semua department di bawahnya?

Jawabannya tergantung policy:

```text
Can view? mungkin ya.
Can edit? belum tentu.
Can approve? biasanya tergantung SoD/state.
Can delete? mungkin tidak pernah.
```

Hierarchy inheritance harus action-specific.

### 2.4 Resource Bisa Berada di Banyak Struktur

Sebuah case mungkin memiliki:

```text
owning_agency
owning_division
handling_team
assigned_officer
review_panel
originating_channel
case_type
jurisdiction
sensitivity_level
```

Jadi “resource belongs to org” bukan satu kolom sederhana.

### 2.5 Struktur Organisasi Berubah

Orang pindah unit. Department digabung. Team dibubarkan. Role dicabut. Delegation expired.

Pertanyaan sulit:

```text
Apakah user boleh melihat historical case yang dibuat saat dia masih berada di unit lama?
Apakah audit decision masa lalu harus direkonstruksi berdasarkan struktur lama atau struktur sekarang?
```

Untuk sistem regulatory, jawabannya sering membutuhkan snapshot historis.

---

## 3. Vocabulary yang Harus Dipisahkan

Kesalahan besar dalam authorization enterprise adalah memakai satu kata “role” untuk terlalu banyak hal.

Kita perlu memisahkan beberapa konsep.

---

### 3.1 Organization Unit

Unit struktural dalam organisasi.

Contoh:

```text
Agency
Division
Department
Section
Team
Branch
Taskforce
```

Model dasar:

```text
OrgUnit {
  id
  type
  name
  parentId
  tenantId
  effectiveFrom
  effectiveTo
}
```

Catatan penting:

- Org unit biasanya membentuk tree.
- Tetapi taskforce atau matrix team bisa membentuk graph.
- Untuk authorization, kita harus tahu apakah inheritance mengikuti tree, graph, atau explicit relation.

---

### 3.2 Membership

Relasi user dengan org unit.

```text
User U is member of OrgUnit O
```

Membership sendiri belum tentu memberi permission.

Contoh:

```text
User adalah member Division Enforcement.
```

Itu tidak otomatis berarti user boleh approve semua enforcement case. Membership adalah atribut/relasi, bukan permission final.

---

### 3.3 Position

Posisi adalah jabatan/fungsi organisasi.

```text
Officer
Senior Officer
Team Lead
Division Head
Director
Case Reviewer
Legal Counsel
```

Position berbeda dari role authorization.

Position menjawab:

```text
Apa jabatan/fungsi orang ini dalam struktur organisasi?
```

Authorization role menjawab:

```text
Capability apa yang diberikan kepada orang ini?
```

Kadang position dipetakan ke role, tetapi jangan dicampur mentah-mentah.

---

### 3.4 Role

Role authorization adalah pengelompokan permission.

```text
CASE_VIEWER
CASE_EDITOR
CASE_APPROVER
REPORT_EXPORTER
ORG_ADMIN
```

Role idealnya tidak terlalu dekat dengan jabatan HR.

Bad:

```text
ROLE_SENIOR_OFFICER_GRADE_7_ENFORCEMENT_ACTING_LEAD
```

Better:

```text
Position: Senior Officer
Scoped role: CASE_REVIEWER @ Enforcement Division
Delegation: ACTING_TEAM_LEAD @ Investigation Team until date X
```

---

### 3.5 Scoped Role

Scoped role adalah role yang berlaku dalam boundary tertentu.

```text
(role, scope_type, scope_id)
```

Contoh:

```text
CASE_MANAGER @ TEAM:INVESTIGATION_A
REPORT_VIEWER @ DIVISION:ENFORCEMENT
ORG_ADMIN @ AGENCY:CEA
```

Scoped role adalah konsep pusat part ini.

Tanpa scoped role, sistem biasanya jatuh ke dua ekstrem:

1. Role global terlalu luas.
2. Role terlalu spesifik sampai role explosion.

---

### 3.6 Effective Role

Effective role adalah role yang berlaku setelah semua assignment, inheritance, delegation, activation, dan constraint dihitung.

Contoh:

```text
Direct role:
  CASE_MANAGER @ Team A

Inherited effective role:
  CASE_VIEWER @ Team A
  CASE_COMMENTER @ Team A

Inherited by org hierarchy:
  CASE_VIEWER @ Department D, if Team A is under Department D and policy allows upward/downward inheritance
```

Jangan menyimpan effective role sebagai kebenaran utama kecuali sebagai materialized/cache view yang bisa dihitung ulang.

---

### 3.7 Permission / Capability

Permission adalah atomic capability.

```text
case.view
case.update
case.assign
case.approve
report.export
```

Role mengelompokkan permission.

```text
CASE_MANAGER -> case.view, case.update, case.assign
CASE_APPROVER -> case.view, case.approve
```

---

### 3.8 Scope

Scope adalah boundary keberlakuan.

```text
GLOBAL
TENANT
AGENCY
DIVISION
DEPARTMENT
TEAM
CASE_TYPE
CASE
WORKFLOW_STAGE
```

Scope bukan hanya organization unit. Kadang permission berlaku pada:

```text
case type = licensing
jurisdiction = region-1
data classification = confidential
workflow state = pending_review
```

Namun part ini fokus pada organization hierarchy.

---

## 4. Role Global vs Scoped Role

### 4.1 Role Global

Role global berlaku untuk seluruh sistem atau tenant.

```text
SYSTEM_ADMIN
SECURITY_ADMIN
AUDITOR_GLOBAL
```

Role global harus sangat sedikit.

Jika terlalu banyak role global, berarti sistem memberi terlalu banyak kewenangan lintas boundary.

Bad:

```text
CASE_EDITOR_GLOBAL
CASE_APPROVER_GLOBAL
CASE_EXPORTER_GLOBAL
```

Itu bisa menjadi privilege escalation jika tidak benar-benar diperlukan.

---

### 4.2 Scoped Role

Scoped role berlaku hanya dalam scope tertentu.

```text
CASE_EDITOR @ Team A
CASE_APPROVER @ Division B
REPORT_VIEWER @ Agency C
```

Representasi konseptual:

```text
UserRoleAssignment
- user_id
- role_code
- scope_type
- scope_id
- valid_from
- valid_to
- status
```

Decision contoh:

```text
Can U update Case C?

Need:
- permission case.update
- applicable scope includes C.handlingTeam or C.owningDivision
- no SoD violation
- resource state allows update
```

---

## 5. Role Hierarchy vs Organization Hierarchy

Ini dua hal berbeda.

---

### 5.1 Role Hierarchy

Role hierarchy berarti role A mencakup role B.

```text
ROLE_DIVISION_ADMIN > ROLE_TEAM_ADMIN
ROLE_CASE_MANAGER > ROLE_CASE_VIEWER
ROLE_CASE_APPROVER > ROLE_CASE_VIEWER
```

Spring Security menyediakan konsep `RoleHierarchy`, di mana authority yang reachable mencakup authority langsung plus authority yang transitively reachable dari hierarchy. Contoh konsepnya: jika `ROLE_A > ROLE_B > ROLE_C`, user dengan `ROLE_A` juga dianggap memiliki `ROLE_B` dan `ROLE_C`.

Role hierarchy cocok untuk inheritance permission antar role.

---

### 5.2 Organization Hierarchy

Organization hierarchy berarti unit A mencakup unit B.

```text
Agency CEA
└── Enforcement Division
    └── Investigation Department
        └── Team Alpha
```

Jika user punya role di `Enforcement Division`, apakah role itu berlaku untuk `Team Alpha`?

Itu bukan role hierarchy. Itu scope inheritance.

---

### 5.3 Kombinasi Keduanya

Contoh:

```text
User has:
  CASE_MANAGER @ Division Enforcement

Role hierarchy:
  CASE_MANAGER > CASE_VIEWER

Org hierarchy:
  Division Enforcement includes Team Alpha

Resource:
  Case belongs to Team Alpha

Effective result:
  User has CASE_VIEWER on Case, if policy allows downward scope inheritance.
```

Perhitungan ini melibatkan dua graph:

```text
Role graph       : CASE_MANAGER -> CASE_VIEWER
Organization tree: Division -> Department -> Team
```

Jangan campur keduanya dalam satu tabel role string.

Bad:

```text
ROLE_ENFORCEMENT_DIVISION_TEAM_ALPHA_CASE_MANAGER_VIEWER
```

Better:

```text
role = CASE_MANAGER
scope = DIVISION:ENFORCEMENT
roleHierarchy = CASE_MANAGER includes CASE_VIEWER
orgHierarchy = DIVISION:ENFORCEMENT includes TEAM:ALPHA
```

---

## 6. Role Explosion: Penyebab dan Pencegahan

Role explosion terjadi ketika role dibuat untuk setiap kombinasi jabatan, unit, action, resource, status, dan exception.

Contoh buruk:

```text
ROLE_ENFORCEMENT_TEAM_A_CASE_VIEWER
ROLE_ENFORCEMENT_TEAM_A_CASE_EDITOR
ROLE_ENFORCEMENT_TEAM_A_CASE_APPROVER
ROLE_ENFORCEMENT_TEAM_B_CASE_VIEWER
ROLE_ENFORCEMENT_TEAM_B_CASE_EDITOR
ROLE_ENFORCEMENT_TEAM_B_CASE_APPROVER
ROLE_COMPLIANCE_TEAM_A_CASE_VIEWER
ROLE_COMPLIANCE_TEAM_A_CASE_EDITOR
...
```

Jika ada 20 team, 10 action, 8 case type, dan 5 data sensitivity, role bisa menjadi ribuan.

---

### 6.1 Penyebab Role Explosion

1. Tidak ada scoped role.
2. Role dipakai untuk menyimpan organization unit.
3. Role dipakai untuk menyimpan resource type.
4. Role dipakai untuk menyimpan workflow state.
5. Role dipakai untuk menyimpan data classification.
6. Role dipakai untuk menyimpan delegation sementara.
7. Role dipakai untuk menyimpan exception case-by-case.
8. Role dipakai sebagai satu-satunya primitive authorization.

---

### 6.2 Cara Mencegah

Pisahkan dimensi:

```text
Role       = what capability group?
Scope      = where does it apply?
Resource   = what object is targeted?
Context    = when/how is it requested?
Constraint = what must not be violated?
```

Contoh:

```text
Instead of:
  ROLE_ENFORCEMENT_DIVISION_CASE_APPROVER_ACTIVE_CASE

Use:
  role: CASE_APPROVER
  scope: DIVISION:ENFORCEMENT
  resource condition: case.state == PENDING_APPROVAL
  constraint: requester != submitter
```

---

## 7. Organization Modeling Patterns

Ada beberapa model struktur organisasi.

---

### 7.1 Adjacency List

Tabel:

```sql
CREATE TABLE org_unit (
    id              BIGINT PRIMARY KEY,
    tenant_id       BIGINT NOT NULL,
    code            VARCHAR(100) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50) NOT NULL,
    parent_id       BIGINT NULL,
    effective_from  TIMESTAMP NOT NULL,
    effective_to    TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL,
    CONSTRAINT fk_org_parent
        FOREIGN KEY (parent_id) REFERENCES org_unit(id)
);
```

Kelebihan:

- Mudah dipahami.
- Mudah update parent.
- Cocok untuk tree kecil/sedang.

Kekurangan:

- Query ancestor/descendant butuh recursive query.
- Performance bisa menurun untuk authorization query high-frequency.

---

### 7.2 Closure Table

Closure table menyimpan semua ancestor-descendant.

```sql
CREATE TABLE org_unit_closure (
    ancestor_id     BIGINT NOT NULL,
    descendant_id   BIGINT NOT NULL,
    depth           INT NOT NULL,
    valid_from      TIMESTAMP NOT NULL,
    valid_to        TIMESTAMP NULL,
    PRIMARY KEY (ancestor_id, descendant_id, valid_from)
);
```

Contoh isi:

```text
Agency -> Agency depth 0
Agency -> Division depth 1
Agency -> Department depth 2
Agency -> Team depth 3
Division -> Division depth 0
Division -> Department depth 1
Division -> Team depth 2
```

Kelebihan:

- Query descendant cepat.
- Query ancestor cepat.
- Cocok untuk authorization scope matching.

Kekurangan:

- Update hierarchy lebih mahal.
- Harus menjaga konsistensi closure.
- Historical validity lebih kompleks.

Untuk authorization enterprise, closure table sering lebih cocok karena decision path butuh cepat dan eksplisit.

---

### 7.3 Materialized Path

Simpan path sebagai string.

```text
/agency-cea/division-enforcement/department-investigation/team-alpha
```

Kelebihan:

- Query descendant bisa pakai prefix.
- Mudah dibaca.

Kekurangan:

- Rename/move node bisa mahal.
- Path string rawan bug jika tidak dinormalisasi.
- Sulit untuk graph/matrix.

---

### 7.4 Graph Relation Table

Untuk organisasi matrix/taskforce.

```sql
CREATE TABLE org_relation (
    from_org_unit_id BIGINT NOT NULL,
    relation_type    VARCHAR(50) NOT NULL,
    to_org_unit_id   BIGINT NOT NULL,
    valid_from       TIMESTAMP NOT NULL,
    valid_to         TIMESTAMP NULL,
    PRIMARY KEY (from_org_unit_id, relation_type, to_org_unit_id, valid_from)
);
```

Relation type:

```text
PARENT_OF
SUPERVISES
COLLABORATES_WITH
REPORTING_LINE_TO
TASKFORCE_MEMBER_OF
```

Kelebihan:

- Fleksibel.
- Cocok untuk matrix organization.

Kekurangan:

- Authorization bisa sulit dijelaskan.
- Risiko traversal tidak terkendali.
- Harus jelas relation mana yang memberi access.

---

## 8. Schema Dasar untuk Complex Role Resolution

Berikut schema konseptual. Tidak wajib sama persis, tetapi mental model-nya penting.

---

### 8.1 User

```sql
CREATE TABLE app_user (
    id              BIGINT PRIMARY KEY,
    username        VARCHAR(100) NOT NULL UNIQUE,
    display_name    VARCHAR(255) NOT NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL
);
```

---

### 8.2 Organization Unit

```sql
CREATE TABLE org_unit (
    id              BIGINT PRIMARY KEY,
    tenant_id       BIGINT NOT NULL,
    code            VARCHAR(100) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50) NOT NULL,
    parent_id       BIGINT NULL,
    valid_from      TIMESTAMP NOT NULL,
    valid_to        TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL
);
```

---

### 8.3 Membership

```sql
CREATE TABLE org_membership (
    id              BIGINT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    org_unit_id     BIGINT NOT NULL,
    membership_type VARCHAR(50) NOT NULL,
    valid_from      TIMESTAMP NOT NULL,
    valid_to        TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL
);
```

Membership type:

```text
PRIMARY
SECONDARY
TASKFORCE
TEMPORARY
OBSERVER
```

---

### 8.4 Position Assignment

```sql
CREATE TABLE position_assignment (
    id              BIGINT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    org_unit_id     BIGINT NOT NULL,
    position_code   VARCHAR(100) NOT NULL,
    valid_from      TIMESTAMP NOT NULL,
    valid_to        TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL
);
```

Position bisa dipakai sebagai attribute input untuk policy.

---

### 8.5 Role

```sql
CREATE TABLE auth_role (
    code            VARCHAR(100) PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    description     VARCHAR(1000),
    status          VARCHAR(30) NOT NULL
);
```

---

### 8.6 Permission

```sql
CREATE TABLE auth_permission (
    code            VARCHAR(150) PRIMARY KEY,
    resource_type   VARCHAR(100) NOT NULL,
    action          VARCHAR(100) NOT NULL,
    description     VARCHAR(1000),
    status          VARCHAR(30) NOT NULL
);
```

---

### 8.7 Role Permission

```sql
CREATE TABLE auth_role_permission (
    role_code       VARCHAR(100) NOT NULL,
    permission_code VARCHAR(150) NOT NULL,
    PRIMARY KEY (role_code, permission_code)
);
```

---

### 8.8 Scoped Role Assignment

```sql
CREATE TABLE auth_scoped_role_assignment (
    id              BIGINT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    role_code       VARCHAR(100) NOT NULL,
    scope_type      VARCHAR(50) NOT NULL,
    scope_id        BIGINT NULL,
    valid_from      TIMESTAMP NOT NULL,
    valid_to        TIMESTAMP NULL,
    status          VARCHAR(30) NOT NULL,
    source_type     VARCHAR(50) NOT NULL,
    source_ref      VARCHAR(100),
    created_at      TIMESTAMP NOT NULL
);
```

`source_type` bisa:

```text
DIRECT_ASSIGNMENT
POSITION_DERIVED
GROUP_DERIVED
DELEGATION
MIGRATION
BREAK_GLASS
```

Ini penting untuk audit dan debugging.

---

### 8.9 Role Hierarchy

```sql
CREATE TABLE auth_role_hierarchy (
    parent_role_code VARCHAR(100) NOT NULL,
    child_role_code  VARCHAR(100) NOT NULL,
    valid_from       TIMESTAMP NOT NULL,
    valid_to         TIMESTAMP NULL,
    PRIMARY KEY (parent_role_code, child_role_code, valid_from)
);
```

---

### 8.10 Scope Inheritance Policy

Tidak semua role boleh diwariskan ke descendant org unit.

```sql
CREATE TABLE auth_scope_inheritance_policy (
    role_code              VARCHAR(100) NOT NULL,
    scope_type             VARCHAR(50) NOT NULL,
    descendant_scope_type  VARCHAR(50) NOT NULL,
    inheritance_mode       VARCHAR(50) NOT NULL,
    max_depth              INT NULL,
    PRIMARY KEY (role_code, scope_type, descendant_scope_type)
);
```

Contoh:

```text
CASE_VIEWER @ DIVISION -> applies to TEAM descendants
CASE_APPROVER @ DIVISION -> applies to DEPARTMENT descendants, max_depth 1
ORG_ADMIN @ AGENCY -> does not imply case.approve everywhere
```

---

## 9. Effective Permission Calculation

Mari kita desain algoritma konseptual.

Input:

```text
subject = user
resource = target resource
requiredPermission = case.update
context = tenant, time, channel, request metadata
```

Langkah:

```text
1. Load subject active assignments.
2. Expand role hierarchy.
3. Resolve permission from roles.
4. Resolve applicable scopes.
5. Resolve resource scopes.
6. Match assignment scopes against resource scopes.
7. Apply constraints.
8. Produce decision with evidence.
```

---

### 9.1 Load Active Assignments

```sql
SELECT *
FROM auth_scoped_role_assignment
WHERE user_id = :userId
  AND status = 'ACTIVE'
  AND valid_from <= :now
  AND (valid_to IS NULL OR valid_to > :now);
```

Output:

```text
CASE_MANAGER @ TEAM:10
REPORT_VIEWER @ DIVISION:3
ACTING_LEAD @ TEAM:12 until 2026-06-30
```

---

### 9.2 Expand Role Hierarchy

Jika:

```text
CASE_MANAGER > CASE_EDITOR
CASE_EDITOR > CASE_VIEWER
```

Maka:

```text
CASE_MANAGER @ TEAM:10
CASE_EDITOR  @ TEAM:10
CASE_VIEWER  @ TEAM:10
```

Catatan:

- Role hierarchy harus acyclic.
- Jika cycle ada, startup validation harus fail.
- Jangan menghitung role hierarchy secara recursive tanpa batas pada request path.

---

### 9.3 Resolve Permissions

Jika:

```text
CASE_EDITOR -> case.view, case.update
CASE_VIEWER -> case.view
```

Maka effective permission candidate:

```text
case.view @ TEAM:10
case.update @ TEAM:10
```

---

### 9.4 Resolve Resource Scopes

Resource case:

```text
case.id = 9001
case.tenantId = 1
case.owningAgencyId = 1
case.owningDivisionId = 3
case.handlingTeamId = 10
case.assignedOfficerId = 77
case.sensitivity = CONFIDENTIAL
case.state = UNDER_REVIEW
```

Resource scopes:

```text
TENANT:1
AGENCY:1
DIVISION:3
TEAM:10
USER:77
CASE:9001
```

---

### 9.5 Scope Matching

Assignment:

```text
case.update @ TEAM:10
```

Resource scope:

```text
TEAM:10
```

Match = yes.

Assignment:

```text
case.update @ DIVISION:3
```

Resource scope:

```text
TEAM:10, whose ancestor DIVISION = 3
```

Match = yes only if inheritance policy allows `DIVISION -> TEAM` for that role/permission/action.

---

### 9.6 Constraint Enforcement

Even if permission matches, constraints can deny:

```text
- requester cannot approve own submission
- case state must be PENDING_APPROVAL
- sensitivity CONFIDENTIAL requires clearance
- delegated role expired
- user suspended
- break-glass must have approval
```

Final decision:

```json
{
  "allowed": false,
  "reasonCode": "SOD_SELF_APPROVAL_DENIED",
  "matchedPermission": "case.approve",
  "matchedRole": "CASE_APPROVER",
  "matchedScope": "DIVISION:3",
  "constraint": "requester != submitter",
  "policyVersion": "authz-policy-2026.06.19"
}
```

---

## 10. Java Domain Model

### 10.1 Java 8-Compatible Value Types

```java
public final class SubjectRef {
    private final long userId;
    private final long tenantId;

    public SubjectRef(long userId, long tenantId) {
        this.userId = userId;
        this.tenantId = tenantId;
    }

    public long userId() {
        return userId;
    }

    public long tenantId() {
        return tenantId;
    }
}
```

```java
public enum ScopeType {
    GLOBAL,
    TENANT,
    AGENCY,
    DIVISION,
    DEPARTMENT,
    TEAM,
    USER,
    CASE
}
```

```java
public final class ScopeRef {
    private final ScopeType type;
    private final Long id;

    private ScopeRef(ScopeType type, Long id) {
        this.type = Objects.requireNonNull(type, "type");
        this.id = id;
    }

    public static ScopeRef global() {
        return new ScopeRef(ScopeType.GLOBAL, null);
    }

    public static ScopeRef of(ScopeType type, long id) {
        if (type == ScopeType.GLOBAL) {
            throw new IllegalArgumentException("GLOBAL scope must not have id");
        }
        return new ScopeRef(type, id);
    }

    public ScopeType type() {
        return type;
    }

    public Long id() {
        return id;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ScopeRef)) return false;
        ScopeRef scopeRef = (ScopeRef) o;
        return type == scopeRef.type && Objects.equals(id, scopeRef.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(type, id);
    }
}
```

```java
public final class ScopedRole {
    private final String roleCode;
    private final ScopeRef scope;
    private final String sourceType;

    public ScopedRole(String roleCode, ScopeRef scope, String sourceType) {
        this.roleCode = Objects.requireNonNull(roleCode, "roleCode");
        this.scope = Objects.requireNonNull(scope, "scope");
        this.sourceType = Objects.requireNonNull(sourceType, "sourceType");
    }

    public String roleCode() {
        return roleCode;
    }

    public ScopeRef scope() {
        return scope;
    }

    public String sourceType() {
        return sourceType;
    }
}
```

---

### 10.2 Java 17+ Record Variant

Untuk Java 17+, model bisa lebih ringkas:

```java
public record SubjectRef(long userId, long tenantId) {}
```

```java
public record ScopeRef(ScopeType type, Long id) {
    public ScopeRef {
        Objects.requireNonNull(type, "type");
        if (type == ScopeType.GLOBAL && id != null) {
            throw new IllegalArgumentException("GLOBAL scope must not have id");
        }
        if (type != ScopeType.GLOBAL && id == null) {
            throw new IllegalArgumentException("Non-global scope requires id");
        }
    }

    public static ScopeRef global() {
        return new ScopeRef(ScopeType.GLOBAL, null);
    }

    public static ScopeRef of(ScopeType type, long id) {
        return new ScopeRef(type, id);
    }
}
```

```java
public record ScopedRole(
        String roleCode,
        ScopeRef scope,
        String sourceType
) {
    public ScopedRole {
        Objects.requireNonNull(roleCode, "roleCode");
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(sourceType, "sourceType");
    }
}
```

Java 17+ records membantu membuat authorization model lebih immutable dan traceable.

---

## 11. Role Expansion Service

### 11.1 Contract

```java
public interface RoleHierarchyService {
    Set<String> expandRoles(Set<String> directRoleCodes);
}
```

### 11.2 Implementation with Precomputed Graph

```java
public final class InMemoryRoleHierarchyService implements RoleHierarchyService {
    private final Map<String, Set<String>> reachableRoles;

    public InMemoryRoleHierarchyService(Map<String, Set<String>> reachableRoles) {
        this.reachableRoles = deepCopy(reachableRoles);
        validateNoNulls(this.reachableRoles);
    }

    @Override
    public Set<String> expandRoles(Set<String> directRoleCodes) {
        Set<String> result = new LinkedHashSet<>();
        for (String role : directRoleCodes) {
            result.add(role);
            Set<String> reachable = reachableRoles.get(role);
            if (reachable != null) {
                result.addAll(reachable);
            }
        }
        return Collections.unmodifiableSet(result);
    }

    private static Map<String, Set<String>> deepCopy(Map<String, Set<String>> source) {
        Map<String, Set<String>> copy = new HashMap<>();
        for (Map.Entry<String, Set<String>> entry : source.entrySet()) {
            copy.put(entry.getKey(), Collections.unmodifiableSet(new LinkedHashSet<>(entry.getValue())));
        }
        return Collections.unmodifiableMap(copy);
    }

    private static void validateNoNulls(Map<String, Set<String>> graph) {
        for (Map.Entry<String, Set<String>> entry : graph.entrySet()) {
            if (entry.getKey() == null) {
                throw new IllegalArgumentException("role hierarchy contains null parent role");
            }
            if (entry.getValue().contains(null)) {
                throw new IllegalArgumentException("role hierarchy contains null child role");
            }
        }
    }
}
```

Catatan:

- Jangan melakukan DFS database pada setiap request.
- Hitung transitive closure role hierarchy saat startup atau refresh policy.
- Validasi cycle.

---

## 12. Scope Matching Service

### 12.1 Contract

```java
public interface ScopeMatcher {
    boolean matches(ScopeRef assignmentScope, Collection<ScopeRef> resourceScopes, ScopeMatchContext context);
}
```

```java
public final class ScopeMatchContext {
    private final String roleCode;
    private final String permissionCode;
    private final Instant decisionTime;

    public ScopeMatchContext(String roleCode, String permissionCode, Instant decisionTime) {
        this.roleCode = Objects.requireNonNull(roleCode, "roleCode");
        this.permissionCode = Objects.requireNonNull(permissionCode, "permissionCode");
        this.decisionTime = Objects.requireNonNull(decisionTime, "decisionTime");
    }

    public String roleCode() {
        return roleCode;
    }

    public String permissionCode() {
        return permissionCode;
    }

    public Instant decisionTime() {
        return decisionTime;
    }
}
```

---

### 12.2 Direct Match

```java
public final class DirectScopeMatcher implements ScopeMatcher {
    @Override
    public boolean matches(
            ScopeRef assignmentScope,
            Collection<ScopeRef> resourceScopes,
            ScopeMatchContext context
    ) {
        if (assignmentScope.type() == ScopeType.GLOBAL) {
            return true;
        }
        return resourceScopes.contains(assignmentScope);
    }
}
```

Direct match terlalu sederhana untuk hierarchy, tetapi berguna sebagai base.

---

### 12.3 Hierarchical Scope Match

```java
public interface OrgHierarchyService {
    boolean isAncestorOf(ScopeRef ancestor, ScopeRef descendant, Instant at);
}
```

```java
public final class HierarchicalScopeMatcher implements ScopeMatcher {
    private final OrgHierarchyService orgHierarchyService;
    private final ScopeInheritancePolicyService inheritancePolicyService;

    public HierarchicalScopeMatcher(
            OrgHierarchyService orgHierarchyService,
            ScopeInheritancePolicyService inheritancePolicyService
    ) {
        this.orgHierarchyService = Objects.requireNonNull(orgHierarchyService, "orgHierarchyService");
        this.inheritancePolicyService = Objects.requireNonNull(inheritancePolicyService, "inheritancePolicyService");
    }

    @Override
    public boolean matches(
            ScopeRef assignmentScope,
            Collection<ScopeRef> resourceScopes,
            ScopeMatchContext context
    ) {
        if (assignmentScope.type() == ScopeType.GLOBAL) {
            return true;
        }

        if (resourceScopes.contains(assignmentScope)) {
            return true;
        }

        for (ScopeRef resourceScope : resourceScopes) {
            if (!inheritancePolicyService.canInherit(
                    context.roleCode(),
                    context.permissionCode(),
                    assignmentScope.type(),
                    resourceScope.type()
            )) {
                continue;
            }

            if (orgHierarchyService.isAncestorOf(
                    assignmentScope,
                    resourceScope,
                    context.decisionTime()
            )) {
                return true;
            }
        }

        return false;
    }
}
```

Key point:

- Jangan otomatis menganggap parent org memberi semua access ke child org.
- Inheritance harus policy-driven.
- Inheritance bisa berbeda per role/permission.

---

## 13. Effective Authorization Service

### 13.1 Decision Object

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final String reasonCode;
    private final List<String> evidence;

    private AuthorizationDecision(boolean allowed, String reasonCode, List<String> evidence) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
        this.evidence = Collections.unmodifiableList(new ArrayList<>(evidence));
    }

    public static AuthorizationDecision allow(String reasonCode, List<String> evidence) {
        return new AuthorizationDecision(true, reasonCode, evidence);
    }

    public static AuthorizationDecision deny(String reasonCode, List<String> evidence) {
        return new AuthorizationDecision(false, reasonCode, evidence);
    }

    public boolean allowed() {
        return allowed;
    }

    public String reasonCode() {
        return reasonCode;
    }

    public List<String> evidence() {
        return evidence;
    }
}
```

---

### 13.2 Authorization Request

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final String permissionCode;
    private final Collection<ScopeRef> resourceScopes;
    private final Instant decisionTime;

    public AuthorizationRequest(
            SubjectRef subject,
            String permissionCode,
            Collection<ScopeRef> resourceScopes,
            Instant decisionTime
    ) {
        this.subject = Objects.requireNonNull(subject, "subject");
        this.permissionCode = Objects.requireNonNull(permissionCode, "permissionCode");
        this.resourceScopes = Collections.unmodifiableList(new ArrayList<>(resourceScopes));
        this.decisionTime = Objects.requireNonNull(decisionTime, "decisionTime");
    }

    public SubjectRef subject() {
        return subject;
    }

    public String permissionCode() {
        return permissionCode;
    }

    public Collection<ScopeRef> resourceScopes() {
        return resourceScopes;
    }

    public Instant decisionTime() {
        return decisionTime;
    }
}
```

---

### 13.3 Service Skeleton

```java
public final class HierarchicalAuthorizationService {
    private final RoleAssignmentRepository roleAssignmentRepository;
    private final RoleHierarchyService roleHierarchyService;
    private final RolePermissionRepository rolePermissionRepository;
    private final ScopeMatcher scopeMatcher;
    private final ConstraintEvaluator constraintEvaluator;

    public HierarchicalAuthorizationService(
            RoleAssignmentRepository roleAssignmentRepository,
            RoleHierarchyService roleHierarchyService,
            RolePermissionRepository rolePermissionRepository,
            ScopeMatcher scopeMatcher,
            ConstraintEvaluator constraintEvaluator
    ) {
        this.roleAssignmentRepository = Objects.requireNonNull(roleAssignmentRepository, "roleAssignmentRepository");
        this.roleHierarchyService = Objects.requireNonNull(roleHierarchyService, "roleHierarchyService");
        this.rolePermissionRepository = Objects.requireNonNull(rolePermissionRepository, "rolePermissionRepository");
        this.scopeMatcher = Objects.requireNonNull(scopeMatcher, "scopeMatcher");
        this.constraintEvaluator = Objects.requireNonNull(constraintEvaluator, "constraintEvaluator");
    }

    public AuthorizationDecision decide(AuthorizationRequest request) {
        List<ScopedRole> directAssignments = roleAssignmentRepository.findActiveAssignments(
                request.subject().userId(),
                request.decisionTime()
        );

        List<String> evidence = new ArrayList<>();
        evidence.add("activeAssignments=" + directAssignments.size());

        for (ScopedRole assignment : directAssignments) {
            Set<String> expandedRoles = roleHierarchyService.expandRoles(
                    Collections.singleton(assignment.roleCode())
            );

            for (String effectiveRole : expandedRoles) {
                Set<String> permissions = rolePermissionRepository.findPermissionsByRole(effectiveRole);

                if (!permissions.contains(request.permissionCode())) {
                    continue;
                }

                ScopeMatchContext scopeContext = new ScopeMatchContext(
                        effectiveRole,
                        request.permissionCode(),
                        request.decisionTime()
                );

                boolean scopeMatched = scopeMatcher.matches(
                        assignment.scope(),
                        request.resourceScopes(),
                        scopeContext
                );

                if (!scopeMatched) {
                    continue;
                }

                ConstraintResult constraintResult = constraintEvaluator.evaluate(request, effectiveRole, assignment.scope());

                if (!constraintResult.allowed()) {
                    evidence.add("matchedRole=" + effectiveRole);
                    evidence.add("matchedScope=" + assignment.scope());
                    evidence.add("constraintDenied=" + constraintResult.reasonCode());
                    return AuthorizationDecision.deny(constraintResult.reasonCode(), evidence);
                }

                evidence.add("matchedRole=" + effectiveRole);
                evidence.add("matchedScope=" + assignment.scope());
                evidence.add("matchedPermission=" + request.permissionCode());
                return AuthorizationDecision.allow("PERMISSION_GRANTED_BY_SCOPED_ROLE", evidence);
            }
        }

        return AuthorizationDecision.deny("NO_MATCHING_EFFECTIVE_PERMISSION", evidence);
    }
}
```

Ini skeleton. Di production, perlu:

- bulk decision,
- audit event,
- cache,
- policy version,
- tenant isolation,
- denial reason hygiene,
- metrics,
- tracing,
- test coverage.

---

## 14. Constraint Layer

Role dan scope yang cocok belum tentu cukup.

Constraint layer memeriksa aturan tambahan.

```java
public interface ConstraintEvaluator {
    ConstraintResult evaluate(
            AuthorizationRequest request,
            String effectiveRole,
            ScopeRef matchedScope
    );
}
```

```java
public final class ConstraintResult {
    private final boolean allowed;
    private final String reasonCode;

    private ConstraintResult(boolean allowed, String reasonCode) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
    }

    public static ConstraintResult allow() {
        return new ConstraintResult(true, "CONSTRAINTS_SATISFIED");
    }

    public static ConstraintResult deny(String reasonCode) {
        return new ConstraintResult(false, reasonCode);
    }

    public boolean allowed() {
        return allowed;
    }

    public String reasonCode() {
        return reasonCode;
    }
}
```

Contoh constraints:

```text
- user.status == ACTIVE
- assignment.valid_from <= now < assignment.valid_to
- resource.state allows action
- requester is not submitter
- clearance >= resource.sensitivity
- delegation has not expired
- org membership is active
- tenant matches
```

---

## 15. Position-Based Access Control

Position-based access sering muncul di enterprise.

Contoh:

```text
Team Lead can assign cases inside own team.
Division Head can view all division cases.
Legal Counsel can comment on cases explicitly referred to Legal.
```

Ada dua pendekatan.

---

### 15.1 Position Directly Used in Policy

```java
if (subject.hasPosition("DIVISION_HEAD", divisionId)) {
    allowViewDivisionCases();
}
```

Kelebihan:

- Dekat dengan bahasa bisnis.
- Mudah dimengerti stakeholder.

Kekurangan:

- Position berubah karena HR/org design, bukan karena access design.
- Bisa mencampur HR model dan security model.
- Sulit ketika satu position punya permission berbeda di modul berbeda.

---

### 15.2 Position Derives Scoped Role

```text
Position: DIVISION_HEAD @ Division 3
Derived role: CASE_VIEWER @ Division 3
Derived role: REPORT_APPROVER @ Division 3
```

Kelebihan:

- Authorization tetap berbasis role/permission.
- HR position menjadi input assignment.
- Bisa diaudit: role didapat dari position apa.

Kekurangan:

- Perlu mapping lifecycle.
- Perlu recomputation ketika position berubah.

Biasanya pendekatan kedua lebih maintainable.

---

## 16. Group-Based Role Resolution

Selain org/position, banyak sistem punya group.

```text
Group: Enforcement Review Panel
Members: user A, user B, user C
Role: CASE_REVIEWER @ CaseType Enforcement
```

Group bisa bersifat:

```text
STATIC
DYNAMIC
EXTERNAL_IDP
TASKFORCE
CASE_PANEL
```

Design:

```text
User -> Group Membership -> Group Role Assignment -> Scoped Role -> Permission
```

Hindari group menjadi “role terselubung” tanpa governance.

Bad:

```text
Group name: CanApproveAllCasesPleaseDoNotDelete
```

Better:

```text
Group: Enforcement Review Panel
Group scoped role: CASE_REVIEWER @ DIVISION:ENFORCEMENT
```

---

## 17. Effective Permission Materialization

Untuk performance, kadang effective permission dihitung dan disimpan.

Contoh materialized table:

```sql
CREATE TABLE auth_effective_permission (
    user_id          BIGINT NOT NULL,
    permission_code  VARCHAR(150) NOT NULL,
    scope_type       VARCHAR(50) NOT NULL,
    scope_id         BIGINT NULL,
    source_hash      VARCHAR(128) NOT NULL,
    computed_at      TIMESTAMP NOT NULL,
    valid_until      TIMESTAMP NULL,
    PRIMARY KEY (user_id, permission_code, scope_type, scope_id)
);
```

Kelebihan:

- Query cepat.
- Cocok untuk large org.
- Cocok untuk UI permission bootstrap.

Kekurangan:

- Stale permission risk.
- Revocation delay.
- Recompute complexity.
- Audit harus tahu apakah decision memakai materialized view versi apa.

Rule:

> Materialized effective permission boleh dipakai sebagai optimization, bukan sebagai satu-satunya source of truth tanpa invalidation yang benar.

---

## 18. Cache Design

Authorization cache sangat berbahaya jika key salah.

---

### 18.1 Cache Candidate

Bisa dicache:

```text
- role hierarchy closure
- org hierarchy closure
- role -> permissions mapping
- user active role assignments
- derived effective permission
- resource scope lookup
```

Lebih hati-hati:

```text
- final decision
```

Final decision bergantung pada banyak context:

```text
user
permission/action
resource id
resource state
resource scope
tenant
time
delegation state
risk context
policy version
```

---

### 18.2 Cache Key

Bad:

```text
authz:user:123:case.update
```

Kenapa buruk?

Karena tidak mengandung resource/scope/context.

Better:

```text
authz:v3:tenant:1:user:123:permission:case.update:scope:TEAM:10:policy:2026-06-19
```

Untuk decision per resource:

```text
authz-decision:v3:tenant:1:user:123:permission:case.update:resource:case:9001:resourceVersion:17:policy:2026-06-19
```

---

### 18.3 Invalidation Triggers

Invalidate ketika:

```text
- user role assignment berubah
- group membership berubah
- position assignment berubah
- org hierarchy berubah
- role hierarchy berubah
- role-permission mapping berubah
- delegation dibuat/dicabut/expired
- break-glass activated/closed
- resource scope berubah
- resource state berubah
- policy version berubah
```

Jika invalidation sulit, gunakan TTL pendek dan fail-safe for sensitive actions.

---

## 19. Spring Security RoleHierarchy: Useful but Limited

Spring Security memiliki konsep role hierarchy untuk memperluas authorities. Ini berguna untuk kasus sederhana seperti:

```text
ROLE_ADMIN > ROLE_STAFF
ROLE_STAFF > ROLE_USER
```

Namun untuk hierarchical organization, role hierarchy Spring tidak cukup karena:

1. Tidak memahami scope org.
2. Tidak memahami resource instance.
3. Tidak memahami tenant boundary.
4. Tidak memahami temporal validity.
5. Tidak memahami assignment source.
6. Tidak memahami SoD constraint.
7. Tidak menghasilkan evidence domain-level.

Gunakan Spring role hierarchy untuk authority-level convenience, bukan sebagai authorization brain untuk enterprise domain.

Contoh penggunaan yang masih masuk akal:

```java
@Bean
RoleHierarchy roleHierarchy() {
    return RoleHierarchyImpl.fromHierarchy("""
            ROLE_SECURITY_ADMIN > ROLE_USER_ADMIN
            ROLE_USER_ADMIN > ROLE_USER_VIEWER
            """);
}
```

Tetapi untuk scoped role:

```text
CASE_MANAGER @ TEAM:10
```

jangan dipaksa menjadi:

```text
ROLE_CASE_MANAGER_TEAM_10
```

Kecuali sistem sangat kecil dan jumlah scope sangat terbatas. Di enterprise, itu hampir pasti menjadi role explosion.

---

## 20. Query Authorization dengan Hierarchy

Misal user punya:

```text
CASE_VIEWER @ DIVISION:3
```

Dia membuka list case.

Bad approach:

```java
List<Case> cases = caseRepository.findAll();
return cases.stream()
        .filter(c -> authz.canView(user, c))
        .toList();
```

Masalah:

- data keburu diambil,
- pagination salah,
- count bocor,
- performance buruk,
- export/report tetap rawan.

Better:

```sql
SELECT c.*
FROM case c
JOIN org_unit_closure cl
  ON cl.descendant_id = c.handling_team_id
WHERE cl.ancestor_id = :divisionId
  AND c.tenant_id = :tenantId;
```

Untuk banyak scope:

```sql
SELECT DISTINCT c.*
FROM case c
WHERE c.tenant_id = :tenantId
  AND (
      c.handling_team_id IN (:directTeamIds)
      OR c.handling_team_id IN (
          SELECT descendant_id
          FROM org_unit_closure
          WHERE ancestor_id IN (:divisionScopeIds)
      )
  );
```

Top 1% point:

> Hierarchical role resolution harus menghasilkan predicate query, bukan hanya boolean check per object.

---

## 21. Access Review dan Certification

Authorization organisasi kompleks harus bisa direview.

Pertanyaan access review:

```text
Siapa punya CASE_APPROVER?
Di scope mana?
Dari sumber apa?
Sejak kapan?
Sampai kapan?
Apakah masih sesuai posisi sekarang?
Apakah pernah dipakai?
Apakah ada conflict dengan SoD?
```

Report yang dibutuhkan:

1. User access report.
2. Role membership report.
3. Permission-to-role report.
4. Scope assignment report.
5. Delegation report.
6. Break-glass report.
7. Orphan assignment report.
8. Expired-but-active anomaly report.
9. High privilege report.
10. SoD conflict report.

Contoh query high privilege:

```sql
SELECT a.user_id, a.role_code, a.scope_type, a.scope_id, a.source_type, a.valid_from, a.valid_to
FROM auth_scoped_role_assignment a
WHERE a.role_code IN ('ORG_ADMIN', 'SECURITY_ADMIN', 'CASE_APPROVER', 'REPORT_EXPORTER')
  AND a.status = 'ACTIVE';
```

---

## 22. Historical Authorization

Regulatory systems sering butuh menjawab:

```text
Why was user U allowed to approve case C on date T?
```

Jika kita hanya menyimpan current roles, current org hierarchy, dan current policy, kita tidak bisa merekonstruksi decision masa lalu.

Minimal audit evidence:

```text
- user id
- action
- resource id
- decision time
- decision result
- matched role
- matched scope
- assignment id/source
- org hierarchy version or closure validity
- policy version
- resource state/version
- reason code
```

Untuk historical correctness, simpan:

```text
valid_from/valid_to pada assignment
valid_from/valid_to pada org hierarchy
policy version
resource state version
```

Audit event contoh:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decisionId": "01J...",
  "time": "2026-06-19T08:30:00Z",
  "tenantId": 1,
  "subjectUserId": 123,
  "permission": "case.approve",
  "resourceType": "case",
  "resourceId": 9001,
  "allowed": true,
  "matchedRole": "CASE_APPROVER",
  "matchedScope": "DIVISION:3",
  "assignmentId": 7712,
  "policyVersion": "authz-2026-06-19",
  "resourceVersion": 44,
  "reasonCode": "PERMISSION_GRANTED_BY_SCOPED_ROLE"
}
```

---

## 23. Failure Modes

### 23.1 Global Role Accident

Role yang seharusnya scoped diberikan global.

```text
CASE_APPROVER @ GLOBAL
```

Dampak:

- user bisa approve lintas agency/division,
- sulit terdeteksi jika UI hanya menampilkan subset,
- audit baru menemukan setelah incident.

Mitigation:

- deny global assignment untuk role tertentu,
- privileged role approval,
- access review,
- guardrail constraint.

---

### 23.2 Scope Ignored in Service Check

```java
@PreAuthorize("hasAuthority('case.update')")
public void updateCase(Long caseId, UpdateCaseRequest request) { ... }
```

Bug:

- permission dicek,
- scope/resource tidak dicek.

Mitigation:

```java
CaseEntity c = caseRepository.get(caseId);
authorizationService.authorize(user, "case.update", c);
```

---

### 23.3 Parent Scope Over-Inheritance

User punya `CASE_VIEWER @ Agency`, lalu sistem otomatis memberi semua action ke child unit.

Mitigation:

- inheritance policy per role/permission,
- max depth,
- sensitive action deny by default.

---

### 23.4 Org Move Without Recalculation

User pindah dari Team A ke Team B tetapi masih punya cached access Team A.

Mitigation:

- assignment validity,
- cache invalidation event,
- effective permission recomputation,
- short TTL for high-risk permission.

---

### 23.5 Historical Audit Uses Current Org

Audit menjelaskan decision masa lalu memakai hierarchy sekarang.

Mitigation:

- valid-time hierarchy,
- policy version,
- decision evidence snapshot.

---

### 23.6 Position Equals Permission

```text
All Team Leads can approve all team cases.
```

Ternyata beberapa team lead hanya administrative lead, bukan approving officer.

Mitigation:

- position derives role through mapping,
- explicit exception,
- access certification.

---

### 23.7 Group Nesting Loop

Group A includes Group B, Group B includes Group A.

Mitigation:

- cycle detection,
- max traversal depth,
- startup validation,
- admin UI prevention.

---

## 24. Testing Strategy

### 24.1 Unit Test Role Hierarchy

```java
@Test
void caseManagerIncludesViewer() {
    RoleHierarchyService service = new InMemoryRoleHierarchyService(Map.of(
            "CASE_MANAGER", Set.of("CASE_EDITOR", "CASE_VIEWER"),
            "CASE_EDITOR", Set.of("CASE_VIEWER")
    ));

    Set<String> expanded = service.expandRoles(Set.of("CASE_MANAGER"));

    assertTrue(expanded.contains("CASE_MANAGER"));
    assertTrue(expanded.contains("CASE_EDITOR"));
    assertTrue(expanded.contains("CASE_VIEWER"));
}
```

Untuk Java 8, ganti `Map.of` dan `Set.of` dengan helper builder.

---

### 24.2 Scope Match Test

Test matrix:

```text
Assignment Scope     Resource Scope      Inheritance Policy     Expected
TEAM:10              TEAM:10             n/a                    allow
DIVISION:3           TEAM:10             allow division->team   allow
DIVISION:3           TEAM:10             deny division->team    deny
AGENCY:1             TEAM:10             max_depth exceeded     deny
GLOBAL               TEAM:10             n/a                    allow only if role global-allowed
```

---

### 24.3 SoD Constraint Test

```text
User has CASE_APPROVER @ Division 3
Case belongs to Division 3
Case submittedBy = same user
Action = case.approve
Expected = deny SOD_SELF_APPROVAL_DENIED
```

---

### 24.4 Query Predicate Test

Pastikan list query hanya mengembalikan data dalam scope.

```text
Given user CASE_VIEWER @ Division 3
And cases in Team 10 under Division 3
And cases in Team 99 under Division 4
When list cases
Then only Division 3 cases returned
And count equals authorized count
And pagination stable
```

---

### 24.5 Cache Invalidation Test

```text
Given user has CASE_VIEWER @ Team A
And decision is cached
When assignment is revoked
Then subsequent decision denies
```

Untuk high-risk permission, test revocation latency explicitly.

---

## 25. Production Checklist

### 25.1 Model Checklist

- [ ] Role tidak menyimpan nama org unit di string.
- [ ] Scoped role didukung secara eksplisit.
- [ ] Org hierarchy dan role hierarchy dipisahkan.
- [ ] Assignment punya validity period.
- [ ] Assignment punya source type.
- [ ] Delegation/break-glass tidak dicampur dengan role permanen.
- [ ] Role-permission mapping versioned/governed.
- [ ] Scope inheritance policy eksplisit.
- [ ] Sensitive action deny by default.

---

### 25.2 Runtime Checklist

- [ ] Effective permission calculation memiliki evidence.
- [ ] Query list/report/export memakai authorization predicate.
- [ ] Object-level check tetap ada untuk direct access.
- [ ] Cache key mengandung tenant/scope/policy version.
- [ ] Cache invalidation dipicu oleh assignment/org/policy change.
- [ ] Decision audit menyimpan matched role/scope/source.
- [ ] Denial reason tidak membocorkan resource sensitif.
- [ ] Bulk authorization API tersedia.
- [ ] N+1 authorization dicegah.

---

### 25.3 Governance Checklist

- [ ] High privilege role perlu approval.
- [ ] Assignment expiry enforced.
- [ ] Periodic access review tersedia.
- [ ] Orphan assignment dideteksi.
- [ ] SoD conflict report tersedia.
- [ ] Emergency/break-glass report tersedia.
- [ ] Historical decision bisa direkonstruksi.
- [ ] Role explosion dipantau.

---

## 26. Design Heuristics untuk Top 1% Engineer

### 26.1 Jangan Tanya “Role Apa?” Terlalu Cepat

Tanya dulu:

```text
What invariant must hold?
```

Contoh:

```text
Only officers in the handling team can update active cases assigned to that team.
```

Dari invariant baru turunkan:

```text
permission = case.update
role = CASE_EDITOR
scope = TEAM
resource scope = handlingTeam
constraint = state active
```

---

### 26.2 Role Is Not Organization

Role menjelaskan capability group. Organization menjelaskan scope.

Jika role name mengandung terlalu banyak struktur organisasi, desain mulai membusuk.

---

### 26.3 Scope Is First-Class

Scope jangan disimpan sebagai metadata informal.

Bad:

```json
{
  "role": "CASE_MANAGER",
  "description": "for Team Alpha only"
}
```

Good:

```json
{
  "role": "CASE_MANAGER",
  "scopeType": "TEAM",
  "scopeId": 10
}
```

---

### 26.4 Inheritance Must Be Policy, Not Assumption

Jangan otomatis:

```text
parent org role applies to all children for all actions
```

Gunakan:

```text
role + permission + source scope + target scope + max depth
```

---

### 26.5 Authorization Must Produce Evidence

Top-level systems tidak cukup berkata:

```text
allowed = true
```

Harus bisa menjawab:

```text
Allowed because user had CASE_APPROVER @ Division 3 from assignment 7712,
Division 3 is ancestor of Team 10 at decision time,
policy version X allowed inheritance for case.approve,
and SoD constraints passed.
```

---

## 27. Mini Capstone: Case Management Effective Role Resolution

### Scenario

```text
Agency: CEA
Division: Enforcement
Department: Investigation
Team: Alpha

User: Alice
Assignments:
- CASE_MANAGER @ Team Alpha
- REPORT_VIEWER @ Division Enforcement
- Acting CASE_APPROVER @ Department Investigation until 2026-06-30

Case:
- caseId = 9001
- handlingTeam = Team Alpha
- owningDepartment = Investigation
- owningDivision = Enforcement
- state = PENDING_APPROVAL
- submittedBy = Bob
```

### Question 1: Can Alice view the case?

Likely yes.

Evidence:

```text
CASE_MANAGER @ Team Alpha
CASE_MANAGER includes CASE_VIEWER
case handlingTeam = Team Alpha
permission case.view matched
```

### Question 2: Can Alice approve the case?

Maybe yes.

Need:

```text
Acting CASE_APPROVER @ Department Investigation active now
case belongs to Department Investigation
case state PENDING_APPROVAL
submittedBy != Alice
acting assignment valid
```

If all true, allow.

### Question 3: Can Alice export all division reports?

Maybe yes if:

```text
REPORT_VIEWER @ Division Enforcement includes report.export or report.view?
```

But report export should often be separate permission:

```text
report.view != report.export
```

If Alice only has `REPORT_VIEWER`, deny export.

---

## 28. Summary

Hierarchical organization authorization is not just RBAC with bigger role names.

The correct mental model is:

```text
subject
  -> direct assignments
  -> derived assignments
  -> role hierarchy
  -> scoped roles
  -> organization hierarchy
  -> resource scopes
  -> constraints
  -> decision with evidence
```

The most important lessons:

1. Separate role hierarchy from organization hierarchy.
2. Use scoped roles instead of encoding scope into role names.
3. Treat scope inheritance as explicit policy.
4. Generate query predicates for list/report/export authorization.
5. Cache carefully with correct keys and invalidation.
6. Store decision evidence for audit and historical reconstruction.
7. Avoid making position, group, delegation, and emergency access indistinguishable from permanent role assignment.
8. Design for access review from the beginning.

A top 1% engineer does not only ask whether a user has a role. They ask:

```text
What authority is effective, in which scope, from which source, under which policy version, against which resource state, with which constraints, and with what evidence?
```

---

## 29. References

- NIST RBAC project and RBAC standard background: https://csrc.nist.gov/projects/role-based-access-control
- NIST model for role-based access control: https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=916402
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Top 10 2021 A01 Broken Access Control: https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/
- Spring Security `RoleHierarchy` API: https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/access/hierarchicalroles/RoleHierarchy.html
- Spring Security `RoleHierarchyImpl` API: https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/access/hierarchicalroles/RoleHierarchyImpl.html
- Google Zanzibar paper: https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/

---

## 30. Status Seri

Selesai:

- [x] Part 0 — Authorization Mental Model
- [x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
- [x] Part 2 — Java Platform Authorization Primitives
- [x] Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
- [x] Part 4 — RBAC Done Properly
- [x] Part 5 — Permission and Capability Modeling
- [x] Part 6 — ABAC
- [x] Part 7 — PBAC and Policy-as-Code
- [x] Part 8 — ReBAC
- [x] Part 9 — ACL and Domain Object Security
- [x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
- [x] Part 11 — IDOR, BOLA, and Object-Level Authorization
- [x] Part 12 — Authorization in Layered Java Applications
- [x] Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
- [x] Part 14 — Spring Method Security: Service-Level Authorization
- [x] Part 15 — Spring Domain Authorization Patterns
- [x] Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization
- [x] Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging
- [x] Part 18 — Data-Level Authorization and Query Scoping
- [x] Part 19 — Workflow, State Machine, and Case Management Authorization
- [x] Part 20 — Delegation, Impersonation, Acting Roles, and Break-Glass Access
- [x] Part 21 — Hierarchical Organizations and Complex Role Resolution

Belum selesai. Part berikutnya:

- [ ] Part 22 — Temporal, Risk-Based, and Contextual Authorization


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-020.md">⬅️ Java Authorization Modes and Patterns — Part 20</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-022.md">Part 22 — Temporal, Risk-Based, and Contextual Authorization ➡️</a>
</div>
