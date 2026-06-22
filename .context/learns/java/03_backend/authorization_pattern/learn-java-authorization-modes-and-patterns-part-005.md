# learn-java-authorization-modes-and-patterns-part-005

# Part 5 — Permission and Capability Modeling

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Fokus: **mendesain permission dan capability yang stabil, eksplisit, evolvable, testable, dan aman untuk sistem Java 8–25**

---

## 0. Posisi Part Ini dalam Seri

Pada Part 4 kita sudah membahas RBAC dengan serius: user memiliki role, role membawa permission, role bisa hierarchical, dan role lifecycle harus dikontrol agar tidak berubah menjadi `ADMIN`, `SUPER_ADMIN`, `SUPER_DUPER_ADMIN`, dan seterusnya.

Namun RBAC yang baik tetap bergantung pada satu komponen yang lebih fundamental: **permission model**.

Role adalah cara mengelompokkan hak akses. Permission adalah hak akses aktual yang menentukan apa yang boleh dilakukan.

Jika permission model buruk, maka RBAC, ABAC, PBAC, ReBAC, ACL, Spring Security, Jakarta Security, OPA, Cedar, atau policy engine apa pun hanya akan menjadi wrapper di atas fondasi yang kabur.

Part ini membahas:

1. Apa itu permission.
2. Apa itu capability.
3. Bagaimana membedakan permission, role, scope, claim, authority, privilege, dan entitlement.
4. Bagaimana memberi nama permission.
5. Bagaimana mendesain permission yang domain-aware.
6. Bagaimana menghindari permission explosion dan role explosion.
7. Bagaimana permission dipakai di Java, Spring Security, Jakarta, database, API, batch, messaging, dan UI.
8. Bagaimana membuat permission model yang bisa bertahan lama pada sistem enterprise.

---

## 1. Mental Model Utama

Authorization dapat dilihat sebagai pertanyaan:

```text
Can SUBJECT perform ACTION on RESOURCE under CONTEXT?
```

Permission adalah representasi eksplisit dari sebagian jawaban atas pertanyaan tersebut.

Contoh sederhana:

```text
case.read
case.update
case.assign
case.approve
case.export
```

Namun pada sistem nyata, permission tidak cukup hanya berupa string. Permission harus membawa makna domain.

Contoh:

```text
case.approve
```

Pertanyaan yang langsung muncul:

1. Case jenis apa?
2. Dalam state apa?
3. Untuk agency mana?
4. Siapa yang membuat case tersebut?
5. Apakah approver boleh approve case yang dia buat sendiri?
6. Apakah approver sedang bertindak sebagai delegated officer?
7. Apakah approval ini final atau intermediate?
8. Apakah approval butuh second reviewer?
9. Apakah approval boleh dilakukan setelah SLA breach?
10. Apakah approval boleh dilakukan melalui API internal, UI, atau batch?

Jadi permission bukan seluruh authorization decision. Permission adalah **capability atom** yang kemudian dikombinasikan dengan resource, state, ownership, relationship, context, policy, dan constraint.

Mental model yang benar:

```text
Permission is not the decision.
Permission is one input into a decision.
```

Atau dalam bahasa desain:

```text
Role grants permission.
Permission grants capability.
Policy decides applicability.
Context decides safety.
Resource decides scope.
State decides timing.
Audit explains why.
```

---

## 2. Permission vs Capability

Keduanya sering dipakai bergantian, tetapi untuk desain enterprise sebaiknya dibedakan.

### 2.1 Permission

Permission adalah hak formal yang diberikan kepada subject, biasanya melalui role, group, assignment, delegation, atau policy.

Contoh:

```text
case.read
case.update
case.approve
report.export
user.manage
```

Permission menjawab:

```text
Apakah subject memiliki hak formal untuk mencoba aksi ini?
```

### 2.2 Capability

Capability adalah kemampuan aktual yang sistem berikan dalam konteks tertentu.

Contoh:

```text
A user has case.approve,
but cannot approve this case because the case is still DRAFT.
```

Permission formal ada. Capability aktual tidak ada.

Contoh lain:

```text
A user has report.export,
but export is disabled because the report contains restricted data and the user is outside secure network zone.
```

Permission formal ada. Capability aktual diblok oleh context.

### 2.3 Ringkasan Perbedaan

| Konsep | Pertanyaan | Stabilitas | Contoh |
|---|---|---:|---|
| Permission | Apa hak formal yang dimiliki user? | Relatif stabil | `case.approve` |
| Capability | Apa yang benar-benar bisa dilakukan sekarang? | Dinamis | approve case X pada state Y |
| Policy | Aturan apa yang menentukan boleh/tidak? | Bisa berubah | maker-checker rule |
| Context | Situasi apa yang mempengaruhi keputusan? | Dinamis | tenant, time, channel, risk |

### 2.4 Formula Praktis

```text
Capability = Permission + Resource + Context + State + Relationship + Constraints
```

Karena itu, desain Java yang matang tidak berhenti pada:

```java
if (user.hasPermission("case.approve")) {
    approve(caseId);
}
```

Tetapi bergerak ke:

```java
AuthorizationDecision decision = authorizationService.authorize(
    subject,
    Action.CASE_APPROVE,
    ResourceRef.caseId(caseId),
    AuthorizationContext.current()
);

if (!decision.allowed()) {
    throw new AccessDeniedException(decision.safeReasonCode());
}

caseApplicationService.approve(command);
```

---

## 3. Permission Bukan Role

Kesalahan umum:

```text
ADMIN can approve case.
MANAGER can approve case.
OFFICER can update case.
```

Ini terdengar wajar, tetapi jika langsung di-hardcode seperti ini:

```java
@PreAuthorize("hasRole('MANAGER')")
public void approveCase(Long caseId) { ... }
```

maka business capability dikunci ke role tertentu.

Masalahnya:

1. Role organisasi berubah.
2. Nama jabatan berubah.
3. Ada delegated officer.
4. Ada acting manager.
5. Ada special task force.
6. Ada temporary approval authority.
7. Ada role dengan scope terbatas.
8. Ada permission yang sama diberikan ke beberapa role.
9. Ada permission yang perlu dicabut tanpa menghapus role.

Desain yang lebih matang:

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approveCase(Long caseId) { ... }
```

Lebih baik, tetapi masih belum cukup karena object-level rule belum dipakai.

Lebih matang lagi:

```java
public void approveCase(ApproveCaseCommand command) {
    authorizationService.requireAllowed(
        command.actor(),
        Action.CASE_APPROVE,
        ResourceRef.caseId(command.caseId()),
        command.context()
    );

    caseWorkflow.approve(command);
}
```

Role berubah, permission tetap. Permission tetap, policy bisa berevolusi.

Prinsip:

```text
Never encode organization structure directly into business authorization checks.
Encode capability, then map organization structure to capability.
```

---

## 4. Permission Bukan Scope

Dalam OAuth/OIDC ecosystem, banyak sistem memakai `scope` sebagai permission.

Contoh:

```text
scope=case.read case.write
```

Ini bisa berguna untuk API-level authorization, tetapi scope tidak selalu sama dengan permission domain.

### 4.1 Scope Biasanya Menjawab

```text
Client/application ini boleh meminta akses apa?
```

Contoh:

```text
mobile-app has scope case.read
partner-api has scope report.submit
```

### 4.2 Permission Biasanya Menjawab

```text
User/workload ini boleh melakukan aksi domain apa?
```

Contoh:

```text
user Fajar has permission case.approve within agency A
```

### 4.3 Scope Tidak Boleh Menjadi Satu-satunya Authorization

Bahaya:

```java
if (jwt.getScope().contains("case.write")) {
    updateCase(caseId);
}
```

Ini bisa salah karena:

1. Token stale.
2. Scope terlalu coarse-grained.
3. Scope diberikan ke client, bukan user.
4. Scope tidak memuat tenant boundary.
5. Scope tidak tahu resource state.
6. Scope tidak tahu maker-checker constraint.

Model yang lebih benar:

```text
Token scope says: this caller may attempt this category of operation.
Authorization policy says: this subject may perform this specific action on this specific resource now.
```

---

## 5. Permission Bukan Claim

Claim adalah statement di dalam token atau identity assertion.

Contoh claim:

```json
{
  "sub": "user-123",
  "agency": "CEA",
  "roles": ["CASE_OFFICER"],
  "permissions": ["case.read", "case.update"]
}
```

Claim bisa menjadi input authorization, tetapi bukan sumber kebenaran mutlak.

Masalah claim:

1. Bisa stale sampai token expired.
2. Bisa terlalu besar jika semua permission dimasukkan ke token.
3. Bisa dibaca oleh downstream service yang salah memahami trust boundary.
4. Bisa tidak sinkron dengan entitlement database.
5. Bisa tidak memuat context runtime.

Prinsip:

```text
Claims are evidence, not policy.
```

Token boleh membawa permission untuk efisiensi, tetapi high-risk operation sebaiknya melakukan server-side entitlement/policy check.

---

## 6. Permission Bukan Authority, Tetapi Bisa Diwakili Authority

Dalam Spring Security, `GrantedAuthority` adalah representasi authority yang diberikan kepada `Authentication`.

Contoh:

```java
new SimpleGrantedAuthority("case.approve")
```

Spring Security tidak memaksa authority harus role. Authority bisa role, permission, scope, atau marker lain.

Masalah umum:

```java
hasRole("ADMIN")
```

vs

```java
hasAuthority("case.approve")
```

`hasRole` biasanya menambahkan prefix `ROLE_`, sehingga `hasRole("ADMIN")` mencari authority `ROLE_ADMIN`. Ini sering menimbulkan kebingungan saat sistem mulai mencampur role dan permission.

Strategi yang bersih:

```text
ROLE_*        -> identity/organizational grouping
permission.* -> actual business capability
scope.*      -> API/client capability
```

Contoh authority:

```text
ROLE_CASE_OFFICER
ROLE_CASE_REVIEWER
case.read
case.update
case.approve
report.export
scope.partner-api.submit
```

Tetapi pada service layer, sebaiknya business operation tidak bergantung langsung pada role name.

---

## 7. Permission Bukan Privilege

Privilege sering berarti hak tingkat tinggi, biasanya sensitif atau administratif.

Contoh:

```text
system.admin
user.impersonate
case.force-close
audit.export
policy.override
```

Semua privilege bisa dimodelkan sebagai permission, tetapi secara governance sebaiknya diberi metadata tambahan:

1. Severity.
2. Risk level.
3. Requires approval.
4. Requires MFA/step-up.
5. Requires justification.
6. Requires break-glass flow.
7. Requires audit always.
8. Requires time-bound activation.

Contoh metadata:

```yaml
permission: case.force-close
category: workflow
risk: high
requiresJustification: true
requiresStepUp: true
audit: always
allowedChannels:
  - internal-ui
```

Jadi privilege adalah permission berisiko tinggi dengan constraint governance lebih kuat.

---

## 8. Permission Naming Grammar

Permission name bukan dekorasi. Permission name adalah API internal authorization.

Naming buruk:

```text
EDIT
CAN_EDIT
CAN_DO_CASE
CASE_ADMIN
MANAGE
SAVE
VIEW_PAGE
MENU_CASE
```

Masalah:

1. Tidak jelas resource-nya.
2. Tidak jelas action-nya.
3. Tidak jelas domain semantics-nya.
4. Sulit dites.
5. Sulit diaudit.
6. Sulit dimigrasikan.
7. Sulit dicari di codebase.

### 8.1 Grammar Dasar

Gunakan format:

```text
<resource>.<action>
```

Contoh:

```text
case.read
case.create
case.update
case.submit
case.assign
case.approve
case.reject
case.reopen
case.close
report.export
user.invite
policy.publish
```

### 8.2 Grammar Lebih Kaya

Untuk domain besar:

```text
<bounded-context>.<resource>.<action>
```

Contoh:

```text
compliance.case.read
compliance.case.approve
appeal.application.submit
exam.candidate.review
audit.event.export
```

### 8.3 Grammar dengan Scope Domain

Jika resource punya sub-area:

```text
<domain>.<resource>.<sub-resource>.<action>
```

Contoh:

```text
case.document.upload
case.document.download
case.note.create
case.note.delete
case.assignment.transfer
case.decision.publish
```

### 8.4 Hindari Nama Berbasis UI

Buruk:

```text
menu.case.visible
button.approve.enabled
page.report.open
```

Lebih baik:

```text
case.read
case.approve
report.read
report.export
```

UI bisa menurunkan visibility dari capability, tetapi permission tidak boleh bergantung pada nama menu/button.

### 8.5 Hindari Nama Berbasis Role

Buruk:

```text
manager.approve
admin.export
supervisor.view
```

Lebih baik:

```text
case.approve
report.export
case.read
```

Role adalah siapa. Permission adalah apa.

### 8.6 Hindari Nama Terlalu Generik

Buruk:

```text
manage
write
access
execute
process
```

Lebih baik:

```text
case.assign
case.approve
policy.publish
invoice.recalculate
report.schedule
```

---

## 9. Action Vocabulary

Action harus merepresentasikan intensi bisnis, bukan sekadar operasi teknis.

### 9.1 CRUD Action

CRUD dasar:

```text
create
read
update
delete
```

Berguna untuk resource sederhana, tetapi tidak cukup untuk workflow enterprise.

Contoh salah:

```text
case.update
```

Dipakai untuk:

1. Edit draft.
2. Submit.
3. Approve.
4. Reject.
5. Reopen.
6. Close.
7. Transfer assignment.
8. Add evidence.
9. Remove document.

Ini terlalu luas.

### 9.2 Command-Oriented Action

Lebih baik:

```text
case.submit
case.approve
case.reject
case.return-for-clarification
case.assign
case.reassign
case.escalate
case.close
case.reopen
```

Kenapa lebih baik?

1. Cocok dengan audit.
2. Cocok dengan workflow/state machine.
3. Cocok dengan business policy.
4. Cocok dengan UI capability rendering.
5. Cocok dengan testing.
6. Cocok dengan separation of duty.

### 9.3 Read Action Tidak Sesederhana “View”

Banyak sistem hanya punya:

```text
case.view
```

Padahal read bisa berbeda:

```text
case.search
case.read-summary
case.read-detail
case.read-sensitive-section
case.download
case.export
case.print
case.audit-history.read
```

Kenapa perlu dibedakan?

Karena leakage surface berbeda.

| Action | Risiko |
|---|---|
| `case.search` | user tahu case exists |
| `case.read-summary` | user tahu metadata |
| `case.read-detail` | user tahu isi lengkap |
| `case.download` | data keluar dari sistem |
| `case.export` | data massal keluar dari sistem |
| `case.audit-history.read` | user tahu aktivitas internal |

### 9.4 Write Action Harus Dibedakan dari Transition

`update` berarti mengubah data. Tetapi transition mengubah state.

Contoh:

```text
case.update-draft
case.submit
case.approve
case.reject
case.close
```

Jangan semua disatukan menjadi:

```text
case.update
```

Karena approval punya risiko dan policy berbeda dari edit draft.

---

## 10. Resource Vocabulary

Resource harus cukup stabil dan domain-aware.

Contoh resource:

```text
case
appeal
application
license
inspection
investigation
report
user
role
policy
audit-event
document
notification-template
```

### 10.1 Resource Type vs Resource Instance

Resource type:

```text
case
```

Resource instance:

```text
case:12345
```

Permission biasanya berada pada type/action:

```text
case.read
```

Authorization decision terjadi pada instance:

```text
Can user read case:12345?
```

### 10.2 Resource Boundary Harus Jelas

Pertanyaan desain:

1. Apakah document adalah resource sendiri atau bagian dari case?
2. Apakah note adalah resource sendiri atau bagian dari case?
3. Apakah audit trail adalah resource sendiri?
4. Apakah report adalah resource atau query capability?
5. Apakah assignment adalah resource atau transition?

Tidak ada jawaban universal. Yang penting konsisten.

Contoh:

```text
case.document.download
```

berarti document dimodelkan sebagai sub-resource case.

Sedangkan:

```text
document.download
```

berarti document adalah resource independen.

Untuk sistem case management, sub-resource sering lebih jelas karena document authorization biasanya mengikuti case authorization, dengan pengecualian untuk sensitive document.

---

## 11. Permission Granularity

Granularity adalah seberapa kecil permission dipecah.

### 11.1 Terlalu Kasar

```text
case.manage
```

Masalah:

1. Bisa create, edit, approve, delete, export sekaligus.
2. Tidak cocok least privilege.
3. Sulit audit.
4. Sulit separation of duty.
5. Sulit revoke sebagian.

### 11.2 Terlalu Halus

```text
case.field.name.update
case.field.address.update
case.field.phone.update
case.field.email.update
case.button.save.click
case.tab.detail.open
```

Masalah:

1. Permission explosion.
2. Admin sulit memahami.
3. Test matrix membengkak.
4. UI dan backend terlalu coupling.
5. Perubahan UI memaksa migrasi permission.

### 11.3 Granularity yang Sehat

Pecah berdasarkan **business risk**, bukan berdasarkan jumlah endpoint atau field.

Contoh:

```text
case.read-summary
case.read-detail
case.update-draft
case.submit
case.approve
case.reject
case.assign
case.export
```

Reasoning:

1. Summary vs detail punya leakage berbeda.
2. Draft update vs submit punya workflow impact berbeda.
3. Approve/reject punya governance impact berbeda.
4. Export punya exfiltration risk berbeda.

### 11.4 Heuristik Granularity

Buat permission terpisah jika:

1. Aksi punya risk level berbeda.
2. Aksi butuh audit berbeda.
3. Aksi punya lifecycle approval berbeda.
4. Aksi diberikan ke role berbeda.
5. Aksi punya separation-of-duty constraint berbeda.
6. Aksi bisa menyebabkan data keluar sistem.
7. Aksi bisa mengubah state final.
8. Aksi bisa mempengaruhi user lain.
9. Aksi butuh step-up authentication/authorization.
10. Aksi sering menjadi topik compliance review.

Jangan buat permission terpisah jika:

1. Hanya beda tombol UI.
2. Hanya beda endpoint teknis tetapi capability sama.
3. Hanya beda field rendah risiko.
4. Hanya beda implementation detail.
5. Tidak pernah diberikan secara berbeda.
6. Tidak punya audit/risk/ownership semantics berbeda.

---

## 12. Permission Severity and Risk Metadata

Permission harus bisa diberi metadata, bukan hanya string.

Contoh model:

```yaml
id: case.approve
resource: case
action: approve
category: workflow
risk: high
audit: always
requiresJustification: false
requiresStepUp: false
supportsBulk: false
description: Allows approving an assigned case when policy constraints pass.
```

Contoh permission berisiko tinggi:

```yaml
id: case.force-close
resource: case
action: force-close
category: workflow
risk: critical
audit: always
requiresJustification: true
requiresStepUp: true
supportsBulk: false
```

Metadata berguna untuk:

1. UI admin permission management.
2. Access review.
3. Risk reporting.
4. Audit.
5. Policy enforcement.
6. Automated tests.
7. Privileged access monitoring.
8. Documentation.

---

## 13. Permission Lifecycle

Permission bukan hanya dibuat lalu dipakai selamanya.

Lifecycle matang:

```text
proposed -> reviewed -> approved -> active -> deprecated -> retired
```

### 13.1 Proposed

Permission baru diajukan karena ada capability baru.

Checklist:

1. Apa resource-nya?
2. Apa action-nya?
3. Kenapa permission existing tidak cukup?
4. Siapa subject yang akan memilikinya?
5. Apakah ada risk/security impact?
6. Apakah ada audit requirement?
7. Apakah perlu migration?

### 13.2 Reviewed

Security/domain architect memeriksa:

1. Naming.
2. Granularity.
3. Risk level.
4. Overlap dengan permission existing.
5. Role mapping.
6. Policy constraints.

### 13.3 Approved

Permission masuk registry dan bisa dipakai.

### 13.4 Active

Permission dipakai di production.

### 13.5 Deprecated

Permission akan diganti atau digabung.

Contoh:

```text
case.update deprecated, replaced by:
- case.update-draft
- case.submit
- case.assign
```

### 13.6 Retired

Permission tidak boleh dipakai lagi.

Checklist retirement:

1. Tidak ada role yang masih punya permission.
2. Tidak ada code reference.
3. Tidak ada policy reference.
4. Tidak ada token mapper reference.
5. Tidak ada UI menu reference.
6. Migration audit selesai.

---

## 14. Permission Registry

Untuk sistem besar, permission harus punya registry eksplisit.

Bentuk registry bisa:

1. Java enum.
2. Java constants.
3. Database table.
4. YAML/JSON file.
5. Policy schema.
6. Combination: source-of-truth file + generated Java constants + DB migration.

### 14.1 Java Enum Approach

```java
public enum Permission {
    CASE_READ("case.read"),
    CASE_UPDATE_DRAFT("case.update-draft"),
    CASE_SUBMIT("case.submit"),
    CASE_APPROVE("case.approve"),
    CASE_REJECT("case.reject"),
    CASE_EXPORT("case.export");

    private final String value;

    Permission(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Kelebihan:

1. Type-safe.
2. Mudah dicari.
3. Cocok untuk monolith/modular monolith.
4. Mengurangi typo.

Kekurangan:

1. Butuh deploy untuk permission baru.
2. Kurang cocok jika policy dikelola eksternal.
3. Bisa coupling antar module.

### 14.2 Constants Approach

```java
public final class Permissions {
    private Permissions() {}

    public static final String CASE_READ = "case.read";
    public static final String CASE_UPDATE_DRAFT = "case.update-draft";
    public static final String CASE_SUBMIT = "case.submit";
    public static final String CASE_APPROVE = "case.approve";
    public static final String CASE_REJECT = "case.reject";
    public static final String CASE_EXPORT = "case.export";
}
```

Kelebihan:

1. Java 8 friendly.
2. Sederhana.
3. Tidak perlu enum parsing.

Kekurangan:

1. Tidak sekuat enum.
2. Bisa menyebar jika tidak disiplin.

### 14.3 Rich Metadata Registry

```java
public final class PermissionDefinition {
    private final String id;
    private final String resource;
    private final String action;
    private final RiskLevel riskLevel;
    private final AuditMode auditMode;
    private final boolean requiresJustification;
    private final boolean supportsBulk;
    private final String description;

    public PermissionDefinition(
            String id,
            String resource,
            String action,
            RiskLevel riskLevel,
            AuditMode auditMode,
            boolean requiresJustification,
            boolean supportsBulk,
            String description
    ) {
        this.id = id;
        this.resource = resource;
        this.action = action;
        this.riskLevel = riskLevel;
        this.auditMode = auditMode;
        this.requiresJustification = requiresJustification;
        this.supportsBulk = supportsBulk;
        this.description = description;
    }

    public String id() { return id; }
    public String resource() { return resource; }
    public String action() { return action; }
    public RiskLevel riskLevel() { return riskLevel; }
    public AuditMode auditMode() { return auditMode; }
    public boolean requiresJustification() { return requiresJustification; }
    public boolean supportsBulk() { return supportsBulk; }
    public String description() { return description; }
}
```

Untuk Java 17+, bisa lebih ringkas dengan record:

```java
public record PermissionDefinition(
    String id,
    String resource,
    String action,
    RiskLevel riskLevel,
    AuditMode auditMode,
    boolean requiresJustification,
    boolean supportsBulk,
    String description
) {}
```

Namun karena seri ini mencakup Java 8–25, desain utama harus tetap bisa ditulis dalam Java 8, lalu modernisasi bisa dibahas sebagai opsi.

---

## 15. Permissions as Code vs Permissions as Data

### 15.1 Permissions as Code

Permission didefinisikan di codebase.

Kelebihan:

1. Review lewat pull request.
2. Versioned bersama aplikasi.
3. Mudah dicari.
4. Cocok untuk permission yang mengikuti domain code.
5. Cocok untuk compile-time safety.

Kekurangan:

1. Butuh deploy untuk perubahan.
2. Admin tidak bisa fleksibel membuat permission baru.
3. Kurang cocok untuk dynamic policy administration.

### 15.2 Permissions as Data

Permission didefinisikan di database/config/policy store.

Kelebihan:

1. Bisa dikelola runtime.
2. Bisa punya UI admin.
3. Cocok untuk enterprise IAM/IGA.
4. Cocok untuk multi-tenant customization.

Kekurangan:

1. Risiko typo/string mismatch.
2. Butuh governance kuat.
3. Butuh migration/versioning.
4. Bisa menjadi tidak sinkron dengan code.

### 15.3 Hybrid Approach

Untuk sistem enterprise Java, pendekatan paling sehat sering hybrid:

```text
Permission identifiers are code-defined.
Role/assignment mapping is data-defined.
Policy constraints may be code-defined or externalized.
```

Contoh:

1. `case.approve` didefinisikan di code/registry.
2. Role `CASE_REVIEWER` diberi `case.approve` lewat DB/admin UI.
3. Constraint “cannot approve own case” didefinisikan di policy service.
4. Emergency override dikelola lewat privileged access workflow.

---

## 16. Permission Matrix

Permission matrix adalah artefak yang menghubungkan role, permission, resource, dan constraint.

Contoh sederhana:

| Role | Permission | Resource Scope | Constraint |
|---|---|---|---|
| Case Officer | `case.read` | assigned cases | same agency |
| Case Officer | `case.update-draft` | assigned draft cases | not submitted |
| Case Reviewer | `case.read` | review queue | same agency |
| Case Reviewer | `case.approve` | assigned review cases | not maker |
| Case Supervisor | `case.reassign` | agency cases | active only |
| Audit Officer | `audit-event.read` | agency records | read-only |

Matrix yang matang tidak hanya berisi role vs permission. Harus memuat:

1. Resource scope.
2. State constraints.
3. Relationship constraints.
4. Tenant constraints.
5. Separation-of-duty constraints.
6. Audit requirements.
7. Risk level.

### 16.1 Permission Matrix Buruk

| Role | Case | Report | User |
|---|---|---|---|
| Admin | Y | Y | Y |
| Officer | Y | N | N |

Masalah:

1. Terlalu coarse-grained.
2. Tidak tahu action.
3. Tidak tahu object-level boundary.
4. Tidak tahu state.
5. Tidak bisa diuji secara presisi.

### 16.2 Permission Matrix Lebih Baik

| Role | Action | Resource | Condition | Result |
|---|---|---|---|---|
| Officer | read | case | assigned + same agency | allow |
| Officer | approve | case | any | deny |
| Reviewer | approve | case | assigned + not maker + submitted | allow |
| Reviewer | approve | case | self-created | deny |
| Supervisor | reassign | case | same agency + active | allow |

Matrix ini bisa diterjemahkan ke test case.

---

## 17. Permission and Workflow State

Permission tanpa state sering terlalu permisif.

Contoh:

```text
case.update-draft
```

Harus berlaku hanya saat:

```text
case.status == DRAFT
```

Contoh:

```text
case.approve
```

Harus berlaku hanya saat:

```text
case.status == SUBMITTED_FOR_REVIEW
```

Maka authorization decision:

```text
hasPermission(case.approve)
AND case.status == SUBMITTED_FOR_REVIEW
AND subject != case.createdBy
AND subject is assigned reviewer
AND subject.agency == case.agency
```

Dalam Java:

```java
public AuthorizationDecision canApproveCase(Subject subject, CaseRecord record) {
    if (!subject.hasPermission("case.approve")) {
        return AuthorizationDecision.deny("MISSING_PERMISSION");
    }

    if (!record.isSubmittedForReview()) {
        return AuthorizationDecision.deny("INVALID_CASE_STATE");
    }

    if (record.createdBy().equals(subject.userId())) {
        return AuthorizationDecision.deny("MAKER_CHECKER_VIOLATION");
    }

    if (!record.assignedReviewer().equals(subject.userId())) {
        return AuthorizationDecision.deny("NOT_ASSIGNED_REVIEWER");
    }

    if (!record.agencyId().equals(subject.agencyId())) {
        return AuthorizationDecision.deny("TENANT_BOUNDARY_VIOLATION");
    }

    return AuthorizationDecision.allow("CASE_APPROVAL_ALLOWED");
}
```

Prinsip:

```text
Permission names should describe capability.
Policy code should decide applicability.
```

---

## 18. Permission and Data Filtering

Permission tidak hanya untuk command. Read path juga perlu permission.

Contoh:

```text
case.search
case.read-summary
case.read-detail
```

Problem umum:

```java
if (user.hasPermission("case.read")) {
    return caseRepository.findAll();
}
```

Ini salah untuk multi-tenant/case management.

Lebih benar:

```java
CaseSearchCriteria scopedCriteria = authorizationScopeService.scopeCaseSearch(
    subject,
    originalCriteria
);

return caseRepository.search(scopedCriteria);
```

Permission menjawab apakah user boleh search. Scope menjawab record mana yang boleh muncul.

```text
Permission: case.search
Scope: agency = subject.agency AND assignedTo = subject.id OR queue contains subject.team
```

Read authorization sering lebih sulit daripada write authorization karena data leakage bisa terjadi lewat:

1. Search results.
2. Count results.
3. Pagination metadata.
4. Aggregation.
5. Report.
6. Export.
7. Autocomplete.
8. Dropdown reference data.
9. Audit logs.
10. File previews.

---

## 19. Permission and API Design

Endpoint tidak selalu satu-ke-satu dengan permission.

Contoh endpoint:

```http
POST /cases/{id}/actions/approve
```

Permission:

```text
case.approve
```

Contoh endpoint:

```http
PATCH /cases/{id}
```

Bisa butuh permission berbeda tergantung field:

```text
case.update-draft
case.update-sensitive-field
case.update-assignment
```

Maka jangan mengandalkan path saja. Harus lihat command intent.

Contoh command:

```java
public final class UpdateCaseCommand {
    private final String caseId;
    private final Map<String, Object> changes;
    private final String intent;
}
```

Lebih matang:

```java
sealed-like command hierarchy in Java 8 style:

interface CaseCommand {}

final class UpdateDraftCaseCommand implements CaseCommand { ... }
final class SubmitCaseCommand implements CaseCommand { ... }
final class ApproveCaseCommand implements CaseCommand { ... }
final class ReassignCaseCommand implements CaseCommand { ... }
```

Java 17+ bisa memakai sealed interface, tetapi Java 8 bisa tetap memakai interface + final class + visitor/dispatcher.

---

## 20. Permission in Spring Security

Spring Security memakai `GrantedAuthority` sebagai unit authority. Permission bisa dimasukkan sebagai authority.

Contoh:

```java
Collection<GrantedAuthority> authorities = List.of(
    new SimpleGrantedAuthority("ROLE_CASE_REVIEWER"),
    new SimpleGrantedAuthority("case.read"),
    new SimpleGrantedAuthority("case.approve")
);
```

Untuk Java 8:

```java
List<GrantedAuthority> authorities = Arrays.asList(
    new SimpleGrantedAuthority("ROLE_CASE_REVIEWER"),
    new SimpleGrantedAuthority("case.read"),
    new SimpleGrantedAuthority("case.approve")
);
```

### 20.1 Request-Level Check

```java
http.authorizeHttpRequests(auth -> auth
    .requestMatchers(HttpMethod.GET, "/cases/**").hasAuthority("case.read")
    .requestMatchers(HttpMethod.POST, "/cases/*/approve").hasAuthority("case.approve")
    .anyRequest().authenticated()
);
```

Ini bagus sebagai first gate, tetapi tidak cukup untuk object-level authorization.

### 20.2 Method-Level Check

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approveCase(String caseId) {
    ...
}
```

Lebih dekat ke business operation, tetapi masih belum cukup jika tidak mengecek case instance.

### 20.3 Domain-Level Check

```java
public void approveCase(ApproveCaseCommand command) {
    authorizationService.requireAllowed(
        command.subject(),
        "case.approve",
        ResourceRef.caseId(command.caseId()),
        command.context()
    );

    caseWorkflow.approve(command);
}
```

Ini lebih matang karena permission hanya satu bagian dari decision.

---

## 21. Permission in Jakarta EE

Jakarta EE sering memakai role-based declarative authorization:

```java
@RolesAllowed("CASE_REVIEWER")
public void approveCase(String caseId) { ... }
```

Ini bisa menjadi outer gate, tetapi sama seperti Spring, tidak cukup untuk object-level decision.

Strategi:

1. Gunakan container role untuk coarse-grained boundary.
2. Gunakan application authorization service untuk domain decision.
3. Jangan mengunci domain decision hanya pada `@RolesAllowed`.

Contoh:

```java
@RolesAllowed({"CASE_REVIEWER", "CASE_SUPERVISOR"})
public void approveCase(String caseId) {
    authorizationService.requireAllowed(
        currentSubject(),
        Permission.CASE_APPROVE,
        ResourceRef.caseId(caseId),
        currentContext()
    );

    caseService.approve(caseId);
}
```

---

## 22. Permission Storage Model

Relational schema dasar:

```sql
CREATE TABLE permission (
    id              VARCHAR(128) PRIMARY KEY,
    resource        VARCHAR(128) NOT NULL,
    action          VARCHAR(128) NOT NULL,
    risk_level      VARCHAR(32)  NOT NULL,
    audit_mode      VARCHAR(32)  NOT NULL,
    description     VARCHAR(1000),
    status          VARCHAR(32)  NOT NULL,
    created_at      TIMESTAMP    NOT NULL,
    updated_at      TIMESTAMP    NOT NULL
);

CREATE TABLE role_permission (
    role_id         VARCHAR(128) NOT NULL,
    permission_id   VARCHAR(128) NOT NULL,
    created_at      TIMESTAMP    NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);
```

Jika butuh scoped permission:

```sql
CREATE TABLE subject_permission_assignment (
    subject_id      VARCHAR(128) NOT NULL,
    permission_id   VARCHAR(128) NOT NULL,
    scope_type      VARCHAR(64)  NOT NULL,
    scope_id        VARCHAR(128) NOT NULL,
    valid_from      TIMESTAMP,
    valid_until     TIMESTAMP,
    created_at      TIMESTAMP NOT NULL,
    PRIMARY KEY (subject_id, permission_id, scope_type, scope_id)
);
```

Contoh:

```text
subject_id: user-123
permission_id: case.approve
scope_type: agency
scope_id: CEA
valid_until: 2026-12-31
```

---

## 23. Scoped Permission

Permission sering tidak global.

Buruk:

```text
user has case.approve globally
```

Lebih benar:

```text
user has case.approve within agency CEA
```

Atau:

```text
user has case.approve for case type LICENSING within region EAST
```

Model:

```java
public final class PermissionGrant {
    private final String subjectId;
    private final String permissionId;
    private final Scope scope;
    private final Instant validFrom;
    private final Instant validUntil;
}
```

Java 8 tanpa `Instant`? `java.time.Instant` sudah ada sejak Java 8, jadi bisa dipakai.

Scope:

```java
public final class Scope {
    private final String type;
    private final String id;

    public static Scope global() {
        return new Scope("global", "*");
    }

    public static Scope agency(String agencyId) {
        return new Scope("agency", agencyId);
    }

    public static Scope department(String departmentId) {
        return new Scope("department", departmentId);
    }
}
```

Decision:

```text
subject has permission P in scope S
AND resource belongs to scope S
```

---

## 24. Negative Permission and Deny Override

Be careful with negative permissions.

Contoh:

```text
case.read
case.read.denied
```

Atau:

```text
allow case.read for department A
deny case.read for restricted case type X
```

Negative permission bisa berguna, tetapi meningkatkan kompleksitas.

### 24.1 Deny Override Model

Jika ada allow dan deny, deny menang.

```text
ALLOW if explicit allow exists AND no explicit deny applies.
```

Contoh:

```java
if (denyRules.match(subject, action, resource, context)) {
    return AuthorizationDecision.deny("EXPLICIT_DENY");
}

if (allowRules.match(subject, action, resource, context)) {
    return AuthorizationDecision.allow("EXPLICIT_ALLOW");
}

return AuthorizationDecision.deny("NO_ALLOW_RULE");
```

### 24.2 Risiko Negative Permission

1. Sulit dijelaskan ke admin.
2. Sulit diuji.
3. Bisa conflict dengan role hierarchy.
4. Bisa menyebabkan surprise denial.
5. Bisa menjadi patch untuk model yang buruk.

Prinsip:

```text
Prefer positive permission plus clear constraints.
Use explicit deny only for strong policy exceptions.
```

---

## 25. Permission Composition

Kadang satu action butuh beberapa permission.

Contoh export case:

```text
case.export
case.read-detail
```

Atau publish decision:

```text
case.decision.publish
case.read-detail
notification.send
```

Tapi hati-hati. Jika terlalu sering membutuhkan komposisi manual, mungkin action model belum tepat.

Contoh Java:

```java
public AuthorizationDecision canExportCase(Subject subject, CaseRecord record) {
    List<String> required = Arrays.asList("case.read-detail", "case.export");

    for (String permission : required) {
        if (!subject.hasPermission(permission)) {
            return AuthorizationDecision.deny("MISSING_PERMISSION:" + permission);
        }
    }

    if (record.isRestricted() && !subject.hasPermission("case.export-restricted")) {
        return AuthorizationDecision.deny("RESTRICTED_EXPORT_NOT_ALLOWED");
    }

    return AuthorizationDecision.allow("EXPORT_ALLOWED");
}
```

Alternative:

```text
case.export-summary
case.export-detail
case.export-restricted
```

Pilih berdasarkan risk dan governance.

---

## 26. Permission for Bulk Operations

Bulk operation harus dianggap berbeda dari single operation.

Contoh:

```text
case.assign
case.bulk-assign
```

Kenapa?

Bulk operation bisa:

1. Mempengaruhi banyak record.
2. Membuat blast radius besar.
3. Sulit rollback.
4. Membutuhkan audit berbeda.
5. Membutuhkan approval berbeda.
6. Membutuhkan partial failure handling.

Jangan otomatis mengizinkan bulk hanya karena user boleh single action.

Rule:

```text
Single permission does not imply bulk permission.
```

Contoh:

```java
if (command.isBulk() && !subject.hasPermission("case.bulk-assign")) {
    throw new AccessDeniedException("BULK_ASSIGN_NOT_ALLOWED");
}
```

Namun tetap harus mengecek setiap item:

```java
for (String caseId : command.caseIds()) {
    authorizationService.requireAllowed(
        subject,
        "case.assign",
        ResourceRef.caseId(caseId),
        context
    );
}
```

Outer permission mengizinkan operasi bulk. Inner permission memastikan setiap resource boleh disentuh.

---

## 27. Permission for Export, Print, Download, and Integration

Data egress action harus diperlakukan khusus.

Contoh:

```text
case.export
case.print
case.document.download
case.attachment.download
report.export
api.partner.push
```

Kenapa lebih berisiko daripada read?

1. Data keluar dari controlled UI.
2. Bisa disalin/disimpan di luar sistem.
3. Bisa massal.
4. Bisa mengandung PII/sensitive data.
5. Bisa sulit ditarik kembali.

Prinsip:

```text
Read permission does not imply export/download permission.
```

Contoh buruk:

```java
if (subject.hasPermission("case.read")) {
    return exportCase(caseId);
}
```

Lebih benar:

```java
authorizationService.requireAllowed(
    subject,
    "case.export",
    ResourceRef.caseId(caseId),
    context
);
```

Untuk restricted data:

```text
case.export-restricted
```

atau policy:

```text
case.export allowed only if subject.clearance >= resource.classification
```

---

## 28. Permission for Administration

Admin permission harus lebih hati-hati daripada business permission.

Contoh:

```text
user.create
user.disable
user.assign-role
role.create
role.assign-permission
permission.view
policy.publish
system.configure
```

High-risk admin permissions:

```text
user.assign-role
role.assign-permission
policy.publish
user.impersonate
breakglass.activate
```

Karena permission ini bisa mengubah authorization itu sendiri.

Prinsip:

```text
Authorization administration is part of the protected domain.
```

Jangan pernah menganggap admin UI aman hanya karena internal.

Governance:

1. Maker-checker untuk role/permission changes.
2. Audit always.
3. Approval workflow.
4. Effective date.
5. Expiry.
6. Separation of duty.
7. Review report.
8. Break-glass logging.

---

## 29. Permission and UI Capability Rendering

UI boleh memakai permission untuk menyembunyikan/menampilkan menu, tetapi UI bukan enforcement.

Contoh API:

```http
GET /me/capabilities
```

Response:

```json
{
  "case": {
    "canSearch": true,
    "canCreate": true,
    "canApprove": false,
    "canExport": false
  }
}
```

Namun ini hanya untuk UX. Backend tetap harus enforce.

UI capability bisa dynamic per resource:

```http
GET /cases/123/capabilities
```

Response:

```json
{
  "caseId": "123",
  "actions": {
    "read": true,
    "updateDraft": false,
    "submit": false,
    "approve": true,
    "reject": true,
    "reassign": false
  }
}
```

Useful untuk workflow UI, tetapi jangan menjadi satu-satunya guard.

---

## 30. Permission Typos and Type Safety

String permission raw sangat rentan typo.

Buruk:

```java
hasAuthority("case.aprove")
```

Typo `aprove` bisa menyebabkan denial atau, lebih buruk, jika ada fallback allow, bypass.

Strategi:

1. Central constants.
2. Enum.
3. Generated constants dari registry.
4. Startup validation.
5. Test scanning.
6. CI rule untuk permission references.

Contoh startup validation:

```java
public void validateRolePermissions(Collection<RoleDefinition> roles) {
    Set<String> known = permissionRegistry.allPermissionIds();

    for (RoleDefinition role : roles) {
        for (String permission : role.permissions()) {
            if (!known.contains(permission)) {
                throw new IllegalStateException(
                    "Unknown permission " + permission + " in role " + role.id()
                );
            }
        }
    }
}
```

---

## 31. Permission Decision Object

Boolean terlalu miskin.

Buruk:

```java
boolean allowed = authorizationService.canApprove(user, caseId);
```

Lebih baik:

```java
AuthorizationDecision decision = authorizationService.authorize(...);
```

Model Java 8:

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final String reasonCode;
    private final String policyId;
    private final String permissionId;

    private AuthorizationDecision(
            boolean allowed,
            String reasonCode,
            String policyId,
            String permissionId
    ) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
        this.policyId = policyId;
        this.permissionId = permissionId;
    }

    public static AuthorizationDecision allow(String reasonCode) {
        return new AuthorizationDecision(true, reasonCode, null, null);
    }

    public static AuthorizationDecision deny(String reasonCode) {
        return new AuthorizationDecision(false, reasonCode, null, null);
    }

    public boolean allowed() { return allowed; }
    public String reasonCode() { return reasonCode; }
    public String policyId() { return policyId; }
    public String permissionId() { return permissionId; }
}
```

Decision object mendukung:

1. Audit.
2. Debugging.
3. UI denial message mapping.
4. Test assertion.
5. Policy explainability.
6. Security review.

---

## 32. Permission Model for Java 8–25

### 32.1 Java 8 Baseline

Gunakan:

1. Final classes.
2. Immutable fields.
3. Static factories.
4. `java.time`.
5. Collections defensive copy.
6. Constants/enums.

Contoh:

```java
public final class Action {
    public static final Action CASE_APPROVE = new Action("case.approve");

    private final String value;

    private Action(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("Action value is required");
        }
        this.value = value;
    }

    public static Action of(String value) {
        return new Action(value);
    }

    public String value() {
        return value;
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
        return value.hashCode();
    }
}
```

### 32.2 Java 17+ Option

Gunakan record/sealed jika baseline memungkinkan:

```java
public record Action(String value) {
    public Action {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Action value is required");
        }
    }
}
```

### 32.3 Java 21/25 Consideration

Modern Java membantu implementasi authorization service lewat:

1. Records untuk value object.
2. Sealed types untuk decision/result/action hierarchy.
3. Pattern matching untuk dispatcher.
4. Virtual threads untuk remote PDP calls jika I/O-bound.
5. Structured concurrency untuk parallel attribute loading jika tersedia dan stabil pada target runtime.

Tetapi prinsip authorization tidak bergantung pada fitur terbaru. Permission model harus stabil lintas runtime.

---

## 33. Example: End-to-End Permission Modeling for Case Management

### 33.1 Domain Actions

```text
case.search
case.read-summary
case.read-detail
case.create
case.update-draft
case.submit
case.assign
case.reassign
case.approve
case.reject
case.return-for-clarification
case.close
case.reopen
case.export
case.audit-history.read
```

### 33.2 Roles

```text
CASE_OFFICER
CASE_REVIEWER
CASE_SUPERVISOR
AUDIT_OFFICER
SYSTEM_ADMIN
```

### 33.3 Role-Permission Mapping

| Role | Permissions |
|---|---|
| CASE_OFFICER | `case.search`, `case.read-summary`, `case.read-detail`, `case.create`, `case.update-draft`, `case.submit` |
| CASE_REVIEWER | `case.search`, `case.read-summary`, `case.read-detail`, `case.approve`, `case.reject`, `case.return-for-clarification` |
| CASE_SUPERVISOR | `case.search`, `case.read-summary`, `case.read-detail`, `case.assign`, `case.reassign`, `case.reopen` |
| AUDIT_OFFICER | `case.read-summary`, `case.read-detail`, `case.audit-history.read`, `case.export` |
| SYSTEM_ADMIN | admin permissions only, not automatically all business permissions |

Important point:

```text
SYSTEM_ADMIN should not automatically be business approver.
```

Administering system configuration is different from approving regulated cases.

### 33.4 Policy Constraints

| Permission | Constraint |
|---|---|
| `case.update-draft` | case state is DRAFT, subject is creator or assigned officer |
| `case.submit` | case state is DRAFT, required fields complete |
| `case.approve` | state is SUBMITTED, subject is assigned reviewer, subject is not creator |
| `case.reject` | state is SUBMITTED, subject is assigned reviewer, subject is not creator |
| `case.reassign` | same agency, active case, subject is supervisor |
| `case.export` | subject has export permission, export reason provided, audit always |

### 33.5 Decision Trace Example

```text
Request:
  subject: user-123
  action: case.approve
  resource: case-9001
  context: agency=CEA, channel=internal-ui

Evaluation:
  permission exists? yes
  resource same agency? yes
  case state submitted? yes
  assigned reviewer? yes
  maker-checker violation? no
  risk policy passed? yes

Decision:
  allow
  reason: CASE_APPROVAL_ALLOWED
```

Deny example:

```text
Request:
  subject: user-123
  action: case.approve
  resource: case-9002

Evaluation:
  permission exists? yes
  resource same agency? yes
  case state submitted? yes
  assigned reviewer? yes
  maker-checker violation? yes

Decision:
  deny
  reason: MAKER_CHECKER_VIOLATION
```

---

## 34. Testing Permission Model

Permission model harus dites seperti business logic.

### 34.1 Registry Test

```java
@Test
public void allPermissionsShouldFollowNamingConvention() {
    for (PermissionDefinition permission : registry.all()) {
        assertTrue(permission.id().matches("[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+"));
    }
}
```

### 34.2 Unknown Permission Test

```java
@Test(expected = IllegalStateException.class)
public void roleWithUnknownPermissionShouldFailStartupValidation() {
    RoleDefinition role = new RoleDefinition("BROKEN_ROLE", Arrays.asList("case.aprove"));
    validator.validate(Collections.singletonList(role));
}
```

### 34.3 Matrix Test

```java
@Test
public void reviewerCanApproveAssignedSubmittedCaseNotCreatedBySelf() {
    Subject reviewer = subjectWith("case.approve", "agency:CEA", "user-1");
    CaseRecord record = submittedCase("case-1", "agency:CEA", "creator-2", "user-1");

    AuthorizationDecision decision = policy.canApproveCase(reviewer, record);

    assertTrue(decision.allowed());
}
```

### 34.4 Negative Test

```java
@Test
public void reviewerCannotApproveOwnCase() {
    Subject reviewer = subjectWith("case.approve", "agency:CEA", "user-1");
    CaseRecord record = submittedCase("case-1", "agency:CEA", "user-1", "user-1");

    AuthorizationDecision decision = policy.canApproveCase(reviewer, record);

    assertFalse(decision.allowed());
    assertEquals("MAKER_CHECKER_VIOLATION", decision.reasonCode());
}
```

### 34.5 Golden Matrix Test

Buat file matrix:

```csv
role,permission,caseState,sameAgency,isMaker,isAssigned,expected
CASE_REVIEWER,case.approve,SUBMITTED,true,false,true,ALLOW
CASE_REVIEWER,case.approve,DRAFT,true,false,true,DENY
CASE_REVIEWER,case.approve,SUBMITTED,true,true,true,DENY
CASE_REVIEWER,case.approve,SUBMITTED,false,false,true,DENY
```

Lalu jalankan parameterized test.

Tujuan:

1. Business bisa review matrix.
2. QA bisa membuat scenario.
3. Developer punya regression safety.
4. Security bisa melihat denial path.

---

## 35. Production Checklist

Sebelum permission model dianggap matang, cek hal berikut:

### 35.1 Naming

- [ ] Permission memakai grammar konsisten.
- [ ] Permission tidak berbasis nama UI.
- [ ] Permission tidak berbasis role.
- [ ] Permission tidak terlalu generik.
- [ ] Permission command-oriented untuk workflow penting.

### 35.2 Granularity

- [ ] Permission dipecah berdasarkan risk/business capability.
- [ ] Bulk action punya permission terpisah jika blast radius besar.
- [ ] Export/download/print punya permission terpisah dari read.
- [ ] Admin permission dipisah dari business permission.

### 35.3 Registry

- [ ] Semua permission terdaftar di registry.
- [ ] Tidak ada raw string tersebar tanpa kontrol.
- [ ] Unknown permission gagal saat startup/CI.
- [ ] Metadata risk/audit tersedia untuk permission sensitif.

### 35.4 Mapping

- [ ] Role-permission mapping eksplisit.
- [ ] Scoped permission didukung jika diperlukan.
- [ ] Permission assignment punya validity period jika temporary.
- [ ] Permission revoke bisa dilakukan tanpa deploy besar.

### 35.5 Enforcement

- [ ] Permission tidak hanya dicek di UI.
- [ ] Endpoint check tidak menggantikan object-level check.
- [ ] Read/search/export path punya authorization scoping.
- [ ] Batch/messaging/internal API tidak bypass permission.

### 35.6 Audit

- [ ] High-risk permission diaudit always.
- [ ] Decision reason terekam.
- [ ] Permission version/mapping bisa direkonstruksi.
- [ ] Admin changes pada permission/role diaudit.

### 35.7 Testing

- [ ] Permission naming test.
- [ ] Unknown permission test.
- [ ] Role-permission matrix test.
- [ ] Negative authorization test.
- [ ] Object-level authorization test.
- [ ] Export/bulk/admin permission test.

---

## 36. Common Anti-Patterns

### 36.1 `isAdmin()` Everywhere

```java
if (user.isAdmin()) {
    approveCase(caseId);
}
```

Masalah:

1. Tidak jelas capability apa.
2. Admin terlalu powerful.
3. Sulit audit.
4. Sulit least privilege.

Perbaikan:

```java
authorizationService.requireAllowed(subject, "case.approve", caseRef, context);
```

### 36.2 CRUD Permission untuk Semua Hal

```text
case.create
case.read
case.update
case.delete
```

Tidak cukup untuk workflow kompleks.

Perbaikan:

```text
case.update-draft
case.submit
case.approve
case.reject
case.reopen
```

### 36.3 UI Permission sebagai Backend Enforcement

```text
Button hidden = secure
```

Salah. Backend tetap harus enforce.

### 36.4 Permission Tanpa Scope

```text
case.read globally
```

Sering menyebabkan cross-tenant leakage.

### 36.5 Permission dari Request Body

```json
{
  "caseId": "123",
  "permission": "case.approve"
}
```

Client tidak boleh menentukan permission yang dipakai server. Server harus derive action dari command/endpoint.

### 36.6 Permission Terlalu Mirip

```text
case.view
case.read
case.read-case
case.detail.view
```

Ini tanda governance buruk.

### 36.7 `manage` sebagai Tempat Sampah

```text
case.manage
user.manage
system.manage
```

Jika tetap ada `manage`, definisikan dengan sangat jelas atau gunakan hanya sebagai admin aggregate yang di-expand menjadi permission nyata.

---

## 37. Top 1% Engineering Insights

### Insight 1 — Permission adalah Domain API

Permission bukan string random. Permission adalah API internal yang menghubungkan domain, security, UI, audit, test, dan operations.

Jika permission naming buruk, seluruh authorization architecture akan ikut buruk.

### Insight 2 — Capability Lebih Penting daripada Role

Role menjawab “siapa kamu dalam organisasi”. Capability menjawab “apa yang bisa kamu lakukan”.

Sistem matang mendesain capability dulu, baru memetakan role ke capability.

### Insight 3 — Permission Bukan Authorization Decision

Permission hanya satu input. Keputusan final butuh resource, state, relationship, tenant, context, dan policy.

### Insight 4 — Granularity Harus Berbasis Risiko

Jangan pecah permission berdasarkan endpoint, button, atau field tanpa alasan. Pecah berdasarkan risiko bisnis, audit, separation of duty, dan blast radius.

### Insight 5 — Export/Download/Bulk/Admin adalah Kelas Khusus

Banyak breach terjadi karena sistem menganggap read berarti export, single berarti bulk, dan admin berarti boleh semua.

Engineer matang tidak melakukan itu.

### Insight 6 — Permission Registry adalah Control Plane

Tanpa registry, permission akan menyebar sebagai string liar. Dengan registry, permission bisa diuji, diaudit, didokumentasikan, dan dimigrasikan.

### Insight 7 — Permission Model Harus Bisa Menjelaskan Denial

Top-level authorization tidak hanya berkata no. Ia bisa menjelaskan reason code yang aman:

```text
MISSING_PERMISSION
TENANT_BOUNDARY_VIOLATION
INVALID_RESOURCE_STATE
MAKER_CHECKER_VIOLATION
NOT_ASSIGNED_REVIEWER
```

Reason ini penting untuk audit, test, dan support.

---

## 38. Ringkasan

Permission and capability modeling adalah fondasi authorization yang sering diremehkan.

Model yang lemah biasanya terlihat seperti:

```text
ADMIN
USER
MANAGER
case.manage
report.view
```

Model yang kuat terlihat seperti:

```text
case.search
case.read-summary
case.read-detail
case.update-draft
case.submit
case.approve
case.reject
case.reassign
case.export
case.audit-history.read
```

Namun bahkan model permission yang kuat tetap belum cukup sendirian. Ia harus digabung dengan:

1. Resource instance.
2. Tenant boundary.
3. State machine.
4. Relationship.
5. Context.
6. Policy constraints.
7. Audit.
8. Testing.

Formula akhir:

```text
Role grants permission.
Permission represents capability.
Policy checks applicability.
Context checks safety.
Resource scope prevents leakage.
State machine prevents invalid transition.
Audit makes decision defensible.
```

---

## 39. Referensi

1. Spring Security Reference — Authorization Architecture  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

2. Spring Security Reference — Authorize HttpServletRequests  
   https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html

3. OWASP Authorization Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

4. NIST CSRC — Role Based Access Control  
   https://csrc.nist.gov/projects/role-based-access-control

5. NIST Glossary — Role-Based Access Control  
   https://csrc.nist.gov/glossary/term/role_based_access_control

6. Cedar Policy Language — Authorization Request Model  
   https://docs.cedarpolicy.com/auth/authorization.html

7. Cedar Policy Language — Terms and Concepts  
   https://docs.cedarpolicy.com/overview/terminology.html

---

## 40. Status Seri

Selesai:

```text
[x] Part 0 — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
[x] Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4 — RBAC Done Properly: Role-Based Access Control Beyond ADMIN
[x] Part 5 — Permission and Capability Modeling
```

Belum selesai. Part berikutnya:

```text
[ ] Part 6 — ABAC: Attribute-Based Authorization
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-004.md">⬅️ Java Authorization Modes and Patterns — Part 4</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-006.md">Part 6 — ABAC: Attribute-Based Authorization ➡️</a>
</div>
