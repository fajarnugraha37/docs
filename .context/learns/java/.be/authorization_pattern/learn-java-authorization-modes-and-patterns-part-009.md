# learn-java-authorization-modes-and-patterns-part-009

# Part 9 — ACL and Domain Object Security

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Bagian: **9 dari 35**  
> Status seri: **belum selesai**  
> Target pembaca: Java engineer yang ingin memahami authorization bukan sebagai dekorasi endpoint, tetapi sebagai sistem kontrol akses domain-level yang aman, scalable, dan bisa diaudit.  
> Cakupan Java: **Java 8 sampai Java 25**  

---

## 0. Ringkasan Eksekutif

**Access Control List (ACL)** adalah model authorization yang menyimpan aturan akses pada level **object instance**. Bukan hanya mengatakan:

```text
User dengan role CASE_OFFICER boleh membaca Case.
```

Tetapi mengatakan:

```text
User u-102 boleh READ terhadap Case case-9001.
User u-203 boleh WRITE terhadap Case case-9001.
Group Enforcement-Team-A boleh READ terhadap Case case-9001.
User u-999 secara eksplisit DENIED terhadap Case case-9001.
```

ACL sangat kuat ketika akses memang bervariasi per object instance, misalnya:

- dokumen tertentu dibagikan ke user tertentu,
- case tertentu hanya boleh dilihat officer yang ditugaskan,
- file tertentu punya permission berbeda dari folder induknya,
- object bisa diwariskan permission dari parent,
- resource dibuat oleh user lalu dibagikan ke user/grup lain,
- perlu audit siapa diberi akses apa terhadap object tertentu.

Namun ACL juga mudah menjadi mahal dan berantakan jika dipakai untuk semua hal. ACL bukan pengganti RBAC, ABAC, ReBAC, atau policy engine. ACL adalah salah satu mode authorization yang cocok untuk **instance-level explicit grant/deny**.

Di Java enterprise, ACL biasanya muncul dalam tiga bentuk:

1. **Spring Security ACL** — framework-level ACL support untuk domain object security.
2. **Custom domain ACL** — tabel dan service ACL sendiri, lebih fleksibel untuk domain kompleks.
3. **Hybrid ACL** — ACL digabung dengan RBAC/ABAC/ReBAC/policy engine.

Mental model penting:

```text
RBAC menjawab: role apa yang secara umum boleh melakukan action?
ABAC menjawab: atribut subject/resource/context apa yang memenuhi rule?
ReBAC menjawab: relasi apa yang menghubungkan subject dan resource?
ACL menjawab: entry eksplisit apa yang melekat pada object instance ini?
```

ACL bagus untuk **explicit exception** dan **object-level sharing**. ACL buruk untuk **global business policy** yang seharusnya diekspresikan sebagai rule/invariant.

---

## 1. Masalah yang Ingin Diselesaikan ACL

Tanpa ACL, banyak aplikasi authorization berhenti di level route atau role:

```java
@PreAuthorize("hasAuthority('case.read')")
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable UUID id) {
    return caseService.getCase(id);
}
```

Ini hanya menjawab:

```text
Apakah user punya capability umum untuk membaca case?
```

Belum menjawab:

```text
Apakah user boleh membaca case spesifik dengan id tersebut?
```

Inilah sumber klasik **Broken Object Level Authorization (BOLA)** atau **IDOR**. User punya permission umum `case.read`, lalu mengganti ID resource:

```http
GET /cases/CASE-1001
GET /cases/CASE-1002
GET /cases/CASE-1003
```

Jika sistem hanya mengecek permission umum, semua object bisa terbuka.

ACL mencoba menjawab masalah ini dengan menyimpan permission pada object instance:

```text
ACL(Case:CASE-1001):
  - User:alice -> READ, COMMENT
  - User:bob   -> READ, UPDATE
  - Group:review-team -> READ
  - User:eve   -> DENY READ
```

Dengan ACL, pertanyaan authorization menjadi:

```text
Can subject S perform action A on object O?

1. Apakah S punya capability umum untuk action A?
2. Apakah object O punya ACL?
3. Apakah ACL object O memberi allow/deny kepada S atau group milik S?
4. Apakah ada inheritance dari parent object?
5. Apakah rule global/domain tetap mengizinkan action tersebut?
```

---

## 2. ACL Mental Model

### 2.1 Object Punya Daftar Entry

ACL secara sederhana adalah daftar aturan akses yang menempel pada object.

```text
Object: Document:doc-123
ACL:
  ACE #1: Principal:user-1  -> READ
  ACE #2: Principal:user-2  -> READ, WRITE
  ACE #3: Group:legal-team  -> READ
  ACE #4: User:user-9       -> DENY WRITE
```

ACL biasanya terdiri dari:

| Komponen | Makna |
|---|---|
| Object identity | Object yang dilindungi, misalnya `Case:9001` |
| ACL owner | Pemilik ACL/object |
| ACE | Access Control Entry |
| SID/principal | Subject yang diberi entry, misalnya user atau group |
| Permission/mask | Aksi yang diizinkan/ditolak |
| Granting flag | Allow atau deny |
| Inheritance | Apakah ACL parent ikut berlaku |
| Audit flag | Apakah grant/deny perlu dicatat |

### 2.2 ACL Bukan Sekadar Tabel Permission

ACL bukan hanya table join `user_id`, `resource_id`, `permission`. ACL yang matang punya konsep:

- identity object,
- subject identity,
- permission mask,
- explicit allow/deny,
- inheritance,
- owner,
- audit behavior,
- cache,
- bulk resolution,
- lifecycle.

Tanpa lifecycle, ACL akan menjadi data sampah yang sulit dipahami.

### 2.3 ACL Adalah Exception Mechanism yang Kuat

ACL sangat cocok untuk pertanyaan:

```text
Siapa saja yang secara eksplisit diberi akses ke object ini?
```

ACL kurang cocok untuk pertanyaan:

```text
Semua officer dari agency yang sama boleh membaca semua case aktif selama bukan conflict of interest.
```

Rule kedua lebih cocok untuk ABAC/ReBAC/domain policy.

---

## 3. Kapan ACL Cocok

Gunakan ACL jika domain memiliki karakteristik berikut.

### 3.1 Access Bervariasi Per Object

Contoh:

```text
Document A bisa dilihat Alice, Bob, Legal Team.
Document B hanya bisa dilihat Alice dan Supervisor.
Document C publik untuk seluruh department.
```

Jika setiap object punya daftar akses yang berbeda, ACL natural.

### 3.2 User Bisa Share Object

Contoh:

```text
Alice membuat report draft.
Alice share report ke Bob sebagai reviewer.
Bob hanya boleh comment, bukan edit.
```

Ini sangat ACL-like.

### 3.3 Ada Object Ownership

Contoh:

```text
Creator object otomatis menjadi owner.
Owner boleh grant READ kepada user lain.
```

ACL memberi representasi eksplisit.

### 3.4 Ada Permission Inheritance

Contoh:

```text
Folder F punya ACL.
Document D di dalam Folder F mewarisi ACL dari Folder F kecuali override.
```

ACL sering dipakai pada filesystem, document management, knowledge base, dan enterprise content management.

### 3.5 Perlu Audit Access Grant

Contoh:

```text
Siapa yang memberi Bob akses WRITE ke Case 9001?
Kapan access diberikan?
Kapan dicabut?
Atas alasan apa?
```

ACL mudah diaudit jika grant/revoke dimodelkan sebagai event.

---

## 4. Kapan ACL Tidak Cocok

### 4.1 Policy Global yang Berlaku ke Banyak Object

Misalnya:

```text
All compliance officers can view all active compliance cases within their agency.
```

Jangan membuat satu ACL row untuk setiap officer dan setiap case jika policy ini bisa diekspresikan sebagai rule.

Lebih baik:

```text
subject.role contains COMPLIANCE_OFFICER
AND subject.agencyId == resource.agencyId
AND resource.status == ACTIVE
```

### 4.2 Relationship Transitive Kompleks

Misalnya:

```text
User boleh melihat semua case dari unit yang berada di bawah division yang ia pimpin.
```

ACL bisa dipakai, tetapi sering menjadi mahal. ReBAC atau organization-scope policy lebih natural.

### 4.3 Permission Sangat Dinamis

Misalnya:

```text
Access berubah berdasarkan current risk score, waktu, channel, case state, conflict-of-interest, dan emergency lock.
```

Jika decision sangat contextual, ACL saja tidak cukup.

### 4.4 Query List Besar Harus Cepat

ACL sering sulit untuk:

```text
Tampilkan 10.000 case yang boleh dilihat user ini, paginated, sorted by updatedAt, dengan filter kompleks.
```

Masalahnya bukan mengecek satu object, tetapi menghasilkan query authorized secara benar dan efisien.

---

## 5. ACL vs RBAC vs ABAC vs ReBAC

| Model | Pertanyaan utama | Cocok untuk | Risiko utama |
|---|---|---|---|
| RBAC | Role apa yang dimiliki subject? | Permission umum per fungsi | Role explosion |
| ABAC | Atribut apa yang memenuhi rule? | Contextual/domain rule | Sulit diaudit jika atribut banyak |
| ReBAC | Relasi apa yang menghubungkan subject-resource? | Organization, ownership, graph, delegation | Kompleksitas graph/consistency |
| ACL | Entry eksplisit apa pada object ini? | Per-object sharing dan explicit grant | N+1, data bloat, query filtering sulit |

Cara pikir top-level:

```text
RBAC memberi coarse capability.
ABAC memberi contextual constraint.
ReBAC memberi relational reachability.
ACL memberi explicit per-object exception.
```

Dalam sistem enterprise yang matang, keempatnya sering digabung.

Contoh:

```text
User boleh APPROVE Case jika:

1. RBAC: punya permission case.approve.
2. ABAC: case.status == SUBMITTED.
3. ReBAC: user adalah assigned supervisor untuk agency case tersebut.
4. ACL: user tidak secara eksplisit diblokir dari case ini.
5. SoD: user bukan creator/submitter case.
```

---

## 6. Struktur ACL Konseptual

### 6.1 Object Identity

Object identity harus menjawab:

```text
Object apa yang sedang dilindungi?
```

Representasi umum:

```text
object_type = "CASE"
object_id   = "9001"
```

atau:

```text
class_name = "com.example.case.Case"
object_id  = 9001
```

Poin desain:

- Jangan bergantung penuh pada Java class name jika domain sering refactor.
- Gunakan stable resource type jika authorization adalah kontrak domain.
- Hindari ID ambigu antar tenant.
- Sertakan tenant jika object ID tidak global.

Lebih aman:

```text
tenant_id     = "agency-a"
resource_type = "CASE"
resource_id   = "9001"
```

### 6.2 Subject Identity / SID

SID berarti security identity. Bisa berupa:

```text
USER:alice
GROUP:legal-team
ROLE:case-reviewer
ORG_UNIT:unit-12
SERVICE:report-generator
```

Poin desain:

- Jangan hanya support user jika domain butuh group.
- Jangan hanya support role jika ACL dipakai untuk object sharing.
- Jangan campur role global dan group membership tanpa semantics jelas.
- Simpan subject type eksplisit.

Contoh:

```sql
subject_type VARCHAR(32) -- USER, GROUP, ROLE, SERVICE
subject_id   VARCHAR(128)
```

### 6.3 ACE: Access Control Entry

ACE adalah satu baris aturan.

```text
CASE:9001, USER:alice, READ, ALLOW
CASE:9001, USER:bob, WRITE, ALLOW
CASE:9001, GROUP:legal, READ, ALLOW
CASE:9001, USER:eve, READ, DENY
```

Komponen minimal:

```sql
acl_entry(
  id,
  tenant_id,
  resource_type,
  resource_id,
  subject_type,
  subject_id,
  permission,
  effect,
  created_at,
  created_by,
  expires_at
)
```

Untuk sistem matang, tambahkan:

```sql
reason_code,
source,
policy_version,
request_id,
revoked_at,
revoked_by,
revocation_reason,
audit_success,
audit_failure
```

### 6.4 Permission Mask

Banyak ACL framework memakai bit mask.

Contoh:

```text
READ    = 1
WRITE   = 2
CREATE  = 4
DELETE  = 8
ADMIN   = 16
```

Jika user punya READ + WRITE:

```text
mask = 1 | 2 = 3
```

Kelebihan:

- compact,
- cepat,
- cocok untuk permission kecil dan stabil,
- mudah untuk bitwise check.

Kekurangan:

- kurang self-explanatory,
- sulit versioning,
- raw number buruk untuk audit,
- permission expansion terbatas,
- domain action kompleks sulit dimodelkan.

Untuk sistem regulatory/case management, sering lebih baik menyimpan permission string/domain action:

```text
case.read
case.comment
case.update_assignee
case.approve
case.export
case.view_sensitive_attachment
```

Tetapi untuk Spring Security ACL, bit mask adalah model native yang perlu dipahami.

---

## 7. Spring Security ACL Architecture

Spring Security menyediakan dukungan domain object instance security berbasis ACL. Dokumentasi Spring menjelaskan bahwa setiap domain object instance dapat memiliki ACL sendiri, dan ACL mencatat siapa yang bisa atau tidak bisa bekerja dengan object tersebut.

### 7.1 Komponen Utama

Komponen konseptual Spring Security ACL:

| Komponen | Fungsi |
|---|---|
| `Acl` | Representasi ACL untuk satu object |
| `AccessControlEntry` | Satu entry permission |
| `ObjectIdentity` | Identitas object domain |
| `Sid` | Security identity, user atau authority |
| `Permission` | Permission mask |
| `AclService` | Membaca ACL |
| `MutableAclService` | Membuat/mengubah ACL |
| `PermissionGrantingStrategy` | Strategi menentukan grant/deny |
| `AclCache` | Cache ACL |
| `LookupStrategy` | Strategi lookup ACL dari storage |

### 7.2 Schema Spring Security ACL

Spring ACL tradisional memakai tabel seperti:

```text
acl_sid
acl_class
acl_object_identity
acl_entry
```

Makna umumnya:

```text
acl_sid              -> user/authority identity
acl_class            -> domain class/type
acl_object_identity  -> object instance
acl_entry            -> permission entries
```

Model ini powerful, tetapi cukup framework-centric. Untuk domain enterprise modern, perlu diputuskan:

```text
Apakah ACL schema mengikuti framework?
Atau framework adapter mengikuti domain ACL schema?
```

Jika authorization adalah bagian critical dari domain, biasanya lebih aman menjadikan ACL sebagai domain model sendiri lalu Spring Security menjadi adapter/enforcement layer.

### 7.3 `hasPermission` Style

Spring method security bisa memakai ekspresi seperti:

```java
@PreAuthorize("hasPermission(#caseId, 'CASE', 'READ')")
public CaseDto getCase(UUID caseId) {
    return caseRepository.findById(caseId)
            .map(caseMapper::toDto)
            .orElseThrow(NotFoundException::new);
}
```

Atau:

```java
@PreAuthorize("hasPermission(#caseEntity, 'WRITE')")
public void updateCase(Case caseEntity, UpdateCaseCommand command) {
    caseEntity.apply(command);
}
```

Kelebihan:

- declarative,
- dekat dengan service method,
- bisa reuse Spring Security expression.

Kekurangan:

- SpEL bisa menjadi opaque,
- compile-time safety rendah,
- self-invocation/proxy problem,
- sulit melakukan bulk decision,
- sulit menjelaskan denial reason secara kaya,
- raw permission string mudah typo.

### 7.4 PermissionEvaluator

Custom `PermissionEvaluator` sering dipakai untuk menjembatani domain ACL.

Contoh sederhana:

```java
public final class DomainPermissionEvaluator implements PermissionEvaluator {

    private final DomainAclAuthorizationService authorizationService;

    public DomainPermissionEvaluator(DomainAclAuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    @Override
    public boolean hasPermission(
            Authentication authentication,
            Object targetDomainObject,
            Object permission
    ) {
        if (targetDomainObject == null || permission == null) {
            return false;
        }

        SubjectRef subject = SubjectRef.from(authentication);
        ResourceRef resource = ResourceRef.fromDomainObject(targetDomainObject);
        Action action = Action.of(permission.toString());

        return authorizationService.can(subject, action, resource).isAllowed();
    }

    @Override
    public boolean hasPermission(
            Authentication authentication,
            Serializable targetId,
            String targetType,
            Object permission
    ) {
        if (targetId == null || targetType == null || permission == null) {
            return false;
        }

        SubjectRef subject = SubjectRef.from(authentication);
        ResourceRef resource = ResourceRef.of(targetType, targetId.toString());
        Action action = Action.of(permission.toString());

        return authorizationService.can(subject, action, resource).isAllowed();
    }
}
```

Tetapi untuk production, jangan berhenti di boolean. Di bawahnya tetap butuh decision object lengkap.

---

## 8. Custom Domain ACL Model

Untuk domain kompleks, custom ACL sering lebih tepat daripada langsung mengikuti framework schema.

### 8.1 Core Domain Types

Java 8-compatible:

```java
public final class ResourceRef {
    private final String tenantId;
    private final String type;
    private final String id;

    public ResourceRef(String tenantId, String type, String id) {
        this.tenantId = requireNonBlank(tenantId, "tenantId");
        this.type = requireNonBlank(type, "type");
        this.id = requireNonBlank(id, "id");
    }

    public String tenantId() { return tenantId; }
    public String type() { return type; }
    public String id() { return id; }
}
```

Java 17+ alternative:

```java
public record ResourceRef(
        String tenantId,
        String type,
        String id
) {
    public ResourceRef {
        requireNonBlank(tenantId, "tenantId");
        requireNonBlank(type, "type");
        requireNonBlank(id, "id");
    }
}
```

Subject:

```java
public final class SubjectRef {
    private final String type; // USER, GROUP, ROLE, SERVICE
    private final String id;

    public SubjectRef(String type, String id) {
        this.type = requireNonBlank(type, "type");
        this.id = requireNonBlank(id, "id");
    }

    public String type() { return type; }
    public String id() { return id; }
}
```

Action:

```java
public final class Action {
    private final String value;

    private Action(String value) {
        this.value = requireNonBlank(value, "value");
    }

    public static Action of(String value) {
        return new Action(value);
    }

    public String value() {
        return value;
    }
}
```

### 8.2 Effect

```java
public enum Effect {
    ALLOW,
    DENY
}
```

### 8.3 ACL Entry

```java
public final class AclEntry {
    private final ResourceRef resource;
    private final SubjectRef subject;
    private final Action action;
    private final Effect effect;
    private final Instant validFrom;
    private final Instant validUntil;
    private final String reasonCode;

    public AclEntry(
            ResourceRef resource,
            SubjectRef subject,
            Action action,
            Effect effect,
            Instant validFrom,
            Instant validUntil,
            String reasonCode
    ) {
        this.resource = Objects.requireNonNull(resource, "resource");
        this.subject = Objects.requireNonNull(subject, "subject");
        this.action = Objects.requireNonNull(action, "action");
        this.effect = Objects.requireNonNull(effect, "effect");
        this.validFrom = validFrom;
        this.validUntil = validUntil;
        this.reasonCode = reasonCode;
    }

    public boolean isCurrentlyValid(Instant now) {
        boolean startsOk = validFrom == null || !now.isBefore(validFrom);
        boolean endsOk = validUntil == null || now.isBefore(validUntil);
        return startsOk && endsOk;
    }

    public boolean matches(Action requestedAction) {
        return action.value().equals(requestedAction.value());
    }

    public boolean isDeny() {
        return effect == Effect.DENY;
    }

    public boolean isAllow() {
        return effect == Effect.ALLOW;
    }
}
```

### 8.4 Decision Object

Jangan return boolean dari core authorization service.

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

    public boolean isAllowed() { return allowed; }
    public String reasonCode() { return reasonCode; }
    public List<String> evidence() { return evidence; }
}
```

Why?

Karena production authorization butuh:

- audit,
- troubleshooting,
- policy explainability,
- denied UX,
- monitoring,
- regression testing,
- incident reconstruction.

Boolean hanya menjawab hasil, bukan alasan.

---

## 9. ACL Decision Algorithm

### 9.1 Simplified Algorithm

```text
Input:
  subject
  action
  resource
  context

Steps:
  1. Resolve all effective SIDs for subject.
  2. Load ACL entries for resource.
  3. Load parent ACL if inheritance is enabled.
  4. Filter entries by requested action.
  5. Filter entries by valid time/context.
  6. Evaluate DENY entries.
  7. Evaluate ALLOW entries.
  8. If no match, DENY by default.
  9. Return decision with reason and evidence.
```

### 9.2 Effective SID Resolution

Subject `alice` may have many identities:

```text
USER:alice
GROUP:case-team-a
GROUP:legal-reviewers
ROLE:case-officer
ORG_UNIT:unit-7
```

ACL check should not only match direct user entry.

```java
public interface EffectiveSubjectResolver {
    Set<SubjectRef> resolveEffectiveSubjects(AuthenticatedUser user);
}
```

### 9.3 Deny Override

Common secure combiner:

```text
Explicit DENY wins over ALLOW.
ALLOW only works if no DENY applies.
No match means DENY.
```

Pseudocode:

```java
public AuthorizationDecision decide(
        AuthenticatedUser user,
        Action action,
        ResourceRef resource,
        Instant now
) {
    Set<SubjectRef> subjects = subjectResolver.resolveEffectiveSubjects(user);
    List<AclEntry> entries = aclRepository.findEffectiveEntries(resource);

    List<AclEntry> matching = entries.stream()
            .filter(entry -> subjects.contains(entry.subject()))
            .filter(entry -> entry.matches(action))
            .filter(entry -> entry.isCurrentlyValid(now))
            .collect(Collectors.toList());

    List<AclEntry> denies = matching.stream()
            .filter(AclEntry::isDeny)
            .collect(Collectors.toList());

    if (!denies.isEmpty()) {
        return AuthorizationDecision.deny(
                "ACL_EXPLICIT_DENY",
                evidenceOf(denies)
        );
    }

    List<AclEntry> allows = matching.stream()
            .filter(AclEntry::isAllow)
            .collect(Collectors.toList());

    if (!allows.isEmpty()) {
        return AuthorizationDecision.allow(
                "ACL_EXPLICIT_ALLOW",
                evidenceOf(allows)
        );
    }

    return AuthorizationDecision.deny(
            "ACL_NO_MATCH_DENY_BY_DEFAULT",
            Collections.emptyList()
    );
}
```

### 9.4 Ordering Problem

Be careful dengan ordering:

```text
Entry 1: GROUP:reviewers ALLOW READ
Entry 2: USER:alice DENY READ
```

Jika Alice anggota reviewers, apakah Alice boleh READ?

Dalam model deny-override:

```text
DENY menang.
```

Dalam model first-match:

```text
Tergantung urutan entry.
```

Untuk enterprise system, first-match sering berbahaya karena outcome bergantung pada ordering data. Gunakan explicit combining algorithm.

---

## 10. ACL Inheritance

ACL inheritance berarti object child bisa mewarisi permission parent.

Contoh:

```text
Folder:enforcement-2026
  ACL:
    GROUP:enforcement-team -> READ

Document:case-note-001
  parent = Folder:enforcement-2026
  inherits = true
```

Maka `case-note-001` mewarisi READ untuk enforcement team.

### 10.1 Model Parent

```text
Resource parent relation:
Document:D1 -> Folder:F1 -> Workspace:W1
```

Decision:

```text
Check Document ACL.
If inheritance enabled, check Folder ACL.
If Folder inherits, check Workspace ACL.
```

### 10.2 Pitfall: Deep Inheritance

Jika hierarchy dalam:

```text
Workspace -> Folder -> Subfolder -> Subfolder -> Document
```

ACL lookup bisa mahal.

Mitigasi:

- limit depth,
- materialized path,
- precomputed inherited ACL,
- cache effective ACL,
- async rebuild on parent ACL change,
- avoid arbitrary hierarchy if not needed.

### 10.3 Pitfall: Inheritance Override

Pertanyaan sulit:

```text
Jika parent ALLOW READ tetapi child DENY READ, siapa menang?
Jika parent DENY READ tetapi child ALLOW READ, siapa menang?
```

Rules harus eksplisit.

Rekomendasi default:

```text
Explicit DENY at any level wins.
Explicit child ALLOW can only add access if no inherited DENY applies.
No match means deny.
```

Namun beberapa domain memilih child override parent. Yang penting: jangan implisit.

---

## 11. ACL Database Design

### 11.1 Minimal Custom Schema

```sql
CREATE TABLE acl_entry (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       VARCHAR(64)  NOT NULL,
    resource_type   VARCHAR(64)  NOT NULL,
    resource_id     VARCHAR(128) NOT NULL,
    subject_type    VARCHAR(32)  NOT NULL,
    subject_id      VARCHAR(128) NOT NULL,
    action          VARCHAR(128) NOT NULL,
    effect          VARCHAR(16)  NOT NULL,
    valid_from      TIMESTAMP NULL,
    valid_until     TIMESTAMP NULL,
    reason_code     VARCHAR(64) NULL,
    created_at      TIMESTAMP NOT NULL,
    created_by      VARCHAR(128) NOT NULL,
    revoked_at      TIMESTAMP NULL,
    revoked_by      VARCHAR(128) NULL,
    revoke_reason   VARCHAR(256) NULL
);
```

Indexes:

```sql
CREATE INDEX idx_acl_resource
ON acl_entry (tenant_id, resource_type, resource_id);

CREATE INDEX idx_acl_subject
ON acl_entry (tenant_id, subject_type, subject_id);

CREATE INDEX idx_acl_decision_lookup
ON acl_entry (tenant_id, resource_type, resource_id, action, subject_type, subject_id);
```

### 11.2 Active Entry Constraint

Untuk mencegah duplicate active ACL:

```text
tenant_id + resource_type + resource_id + subject_type + subject_id + action + active-status
```

Di beberapa DB, partial unique index bisa dipakai:

```sql
CREATE UNIQUE INDEX uq_acl_active_entry
ON acl_entry (
    tenant_id,
    resource_type,
    resource_id,
    subject_type,
    subject_id,
    action
)
WHERE revoked_at IS NULL;
```

Jika DB tidak support partial index, gunakan status column atau enforce di service transaction.

### 11.3 Append-Only vs Mutable

Untuk regulatory defensibility, pertimbangkan append-only event table:

```text
ACL_GRANTED
ACL_REVOKED
ACL_EXPIRED
ACL_INHERITANCE_CHANGED
```

Lalu materialized current state:

```text
acl_entry_current
```

Kelebihan:

- audit kuat,
- bisa reconstruct historical access,
- cocok untuk investigation.

Kekurangan:

- implementasi lebih kompleks,
- perlu projection rebuild,
- consistency harus dijaga.

---

## 12. ACL and Domain Lifecycle

ACL tidak boleh hidup terpisah dari object lifecycle.

### 12.1 Object Creation

Saat object dibuat:

```text
1. Create object.
2. Create owner ACL.
3. Create default ACL from template/policy.
4. Audit creation.
```

Transactional concern:

```text
Object created but ACL failed -> dangerous.
ACL created but object failed -> orphan ACL.
```

Idealnya satu transaction jika DB sama.

```java
@Transactional
public CaseId createCase(CreateCaseCommand command, AuthenticatedUser creator) {
    Case c = caseFactory.create(command, creator);
    caseRepository.save(c);

    aclService.grantOwner(
            ResourceRef.caseRef(c.tenantId(), c.id()),
            SubjectRef.user(creator.id()),
            "CASE_CREATOR_OWNER"
    );

    audit.logCaseCreated(c.id(), creator.id());
    return c.id();
}
```

### 12.2 Object Transfer

Jika owner berubah:

```text
Apakah owner lama kehilangan ADMIN?
Apakah owner baru otomatis mendapat ADMIN?
Apakah shared users tetap?
Apakah transfer butuh approval?
```

Jangan hanya update `owner_id` di object tanpa update ACL semantics.

### 12.3 Object Delete

Jika object dihapus:

Pilihan:

1. Hard delete ACL.
2. Soft revoke ACL.
3. Keep ACL for audit.
4. Move to archive ACL table.

Untuk regulated systems, biasanya jangan hard delete audit-relevant ACL.

### 12.4 Object State Change

Misalnya case berubah dari `DRAFT` ke `SUBMITTED`.

Pertanyaan:

```text
Apakah creator masih boleh edit?
Apakah reviewer mendapat READ?
Apakah approver mendapat APPROVE?
Apakah ACL berubah atau policy state-based yang berubah?
```

Jangan semua state transition menghasilkan ACL row baru jika sebenarnya rule bisa dihitung dari state.

---

## 13. ACL and Query Filtering Problem

Ini salah satu bagian paling penting.

Mengecek satu object mudah:

```text
can(user, READ, Case:9001)
```

Tetapi listing sulit:

```http
GET /cases?page=0&size=20&sort=updatedAt,desc
```

Pertanyaan:

```text
Bagaimana memastikan hanya case yang boleh dilihat user muncul di page?
```

### 13.1 Filter After Fetch Anti-Pattern

Buruk:

```java
Page<Case> page = caseRepository.findAll(pageable);
List<Case> allowed = page.getContent().stream()
        .filter(c -> aclService.can(user, READ, c).isAllowed())
        .collect(toList());
return new PageImpl<>(allowed, pageable, page.getTotalElements());
```

Masalah:

- page bisa kosong padahal ada data authorized di page berikutnya,
- total count bocor,
- sorting rusak,
- performa buruk,
- masih membaca data unauthorized dari DB,
- raw entity unauthorized sempat masuk memory.

### 13.2 Query-Time Authorization

Lebih baik: authorized predicate masuk ke query.

SQL konsep:

```sql
SELECT c.*
FROM cases c
WHERE c.tenant_id = :tenantId
  AND EXISTS (
      SELECT 1
      FROM acl_entry ae
      WHERE ae.tenant_id = c.tenant_id
        AND ae.resource_type = 'CASE'
        AND ae.resource_id = c.id
        AND ae.action = 'case.read'
        AND ae.effect = 'ALLOW'
        AND ae.revoked_at IS NULL
        AND (
            (ae.subject_type = 'USER' AND ae.subject_id = :userId)
            OR (ae.subject_type = 'GROUP' AND ae.subject_id IN (:groupIds))
        )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM acl_entry de
      WHERE de.tenant_id = c.tenant_id
        AND de.resource_type = 'CASE'
        AND de.resource_id = c.id
        AND de.action = 'case.read'
        AND de.effect = 'DENY'
        AND de.revoked_at IS NULL
        AND (
            (de.subject_type = 'USER' AND de.subject_id = :userId)
            OR (de.subject_type = 'GROUP' AND de.subject_id IN (:groupIds))
        )
  )
ORDER BY c.updated_at DESC
LIMIT :limit OFFSET :offset;
```

### 13.3 Hybrid Predicate

Real enterprise query biasanya gabungan:

```text
tenant predicate
+ state predicate
+ domain filter
+ ACL predicate
+ search keyword
+ sorting
+ pagination
```

Pseudocode:

```java
public Specification<CaseEntity> readableBy(AuthorizationQueryContext ctx) {
    return (root, query, cb) -> {
        Predicate tenant = cb.equal(root.get("tenantId"), ctx.tenantId());
        Predicate aclAllow = aclPredicateFactory.existsAllow(root, ctx, "case.read");
        Predicate aclDeny = cb.not(aclPredicateFactory.existsDeny(root, ctx, "case.read"));
        return cb.and(tenant, aclAllow, aclDeny);
    };
}
```

### 13.4 Count Leakage

Jika count query tidak diberi authorization predicate:

```text
User melihat: totalElements = 10234
Padahal dia hanya boleh lihat 12.
```

Itu leakage.

Pastikan count query juga authorized.

### 13.5 Aggregation Leakage

Contoh:

```text
Dashboard: total cases by status
```

Jika aggregation menghitung object unauthorized, user bisa mengetahui volume/situasi rahasia.

ACL harus masuk aggregation query juga.

---

## 14. ACL and N+1 Decision Problem

Bad pattern:

```java
List<Case> cases = caseRepository.findLatestCases();
for (Case c : cases) {
    aclService.can(user, READ, c);
}
```

Jika setiap `can` query DB, maka 100 case = 100 ACL lookup.

### 14.1 Bulk Decision API

Core ACL service harus punya bulk API:

```java
public interface AclAuthorizationService {
    AuthorizationDecision can(
            AuthenticatedUser user,
            Action action,
            ResourceRef resource
    );

    Map<ResourceRef, AuthorizationDecision> canAll(
            AuthenticatedUser user,
            Action action,
            Collection<ResourceRef> resources
    );
}
```

### 14.2 Bulk Load Entries

```java
public Map<ResourceRef, List<AclEntry>> findEntriesForResources(
        String tenantId,
        Collection<ResourceRef> resources
) {
    // SELECT * FROM acl_entry
    // WHERE tenant_id = ?
    //   AND (resource_type, resource_id) IN (...)
}
```

### 14.3 Better: Query Predicate for Lists

Untuk listing, lebih baik authorized query predicate daripada `canAll` setelah fetch.

`canAll` cocok untuk:

- rendering action buttons,
- secondary permission check,
- mixed resource batch,
- workflow action availability.

---

## 15. ACL and Caching

ACL sering cacheable, tetapi salah cache bisa fatal.

### 15.1 What to Cache

Bisa cache:

- ACL entries per resource,
- effective subject set per user,
- permission mask per object,
- inherited ACL resolution,
- negative lookup untuk resource yang tidak punya ACL.

### 15.2 Cache Key

Cache key harus memasukkan boundary penting:

```text
tenantId
resourceType
resourceId
policyVersion/aclVersion
```

Untuk decision cache:

```text
tenantId
subjectEffectiveSetHash
action
resourceType
resourceId
contextHash
aclVersion
```

Jika tenant tidak masuk cache key, cross-tenant leakage bisa terjadi.

### 15.3 Revocation Problem

Jika ACL dicabut, cache harus invalid.

Strategies:

1. Short TTL.
2. Versioned ACL.
3. Event-based invalidation.
4. Write-through invalidation.
5. No decision cache untuk sensitive actions.

### 15.4 Cache Rule of Thumb

```text
Cache ACL data lebih aman daripada cache final decision.
Cache decision hanya jika context kecil, version jelas, dan revocation delay acceptable.
```

### 15.5 Java Concurrency Considerations

Java 8:

- `ConcurrentHashMap`,
- Caffeine if allowed,
- careful manual invalidation.

Java 21/25:

- virtual threads can reduce blocking cost but do not remove DB/cache design problem,
- structured concurrency can help batch fetch related ACL data,
- records/sealed types improve decision model clarity,
- scoped values can carry request context carefully, but avoid hidden authorization context that bypasses explicit APIs.

---

## 16. ACL and Denial Semantics

ACL denial harus jelas.

Possible reasons:

```text
ACL_EXPLICIT_DENY
ACL_NO_ALLOW
ACL_RESOURCE_NOT_FOUND
ACL_RESOURCE_HIDDEN
ACL_EXPIRED_GRANT
ACL_SUBJECT_NOT_IN_ALLOWED_SID
ACL_INHERITED_DENY
ACL_CONTEXT_CONSTRAINT_FAILED
```

### 16.1 403 vs 404

Jika user tidak punya akses ke object:

- `403 Forbidden`: user tahu object ada, tapi tidak boleh akses.
- `404 Not Found`: sistem menyembunyikan keberadaan object.

Untuk sensitive object, `404` sering dipakai untuk mencegah enumeration.

Tapi audit internal harus tetap mencatat:

```text
DENIED_HIDDEN_RESOURCE
```

### 16.2 Jangan Bocorkan ACL Detail

Buruk:

```json
{
  "error": "You cannot access this case because Legal Team has access but you are not member of Legal Team"
}
```

Lebih aman:

```json
{
  "error": "Access denied",
  "code": "ACCESS_DENIED",
  "correlationId": "..."
}
```

Internal audit boleh lengkap.

---

## 17. ACL and Auditing

ACL harus audit dua hal:

1. **Access grant/revoke lifecycle**.
2. **Access decision** untuk action penting.

### 17.1 Grant/Revoke Audit

Audit event:

```json
{
  "eventType": "ACL_GRANTED",
  "tenantId": "agency-a",
  "resourceType": "CASE",
  "resourceId": "9001",
  "subjectType": "USER",
  "subjectId": "alice",
  "action": "case.read",
  "grantedBy": "supervisor-1",
  "reasonCode": "ASSIGNED_REVIEWER",
  "timestamp": "2026-06-19T10:15:30Z"
}
```

Revocation:

```json
{
  "eventType": "ACL_REVOKED",
  "tenantId": "agency-a",
  "resourceType": "CASE",
  "resourceId": "9001",
  "subjectType": "USER",
  "subjectId": "alice",
  "action": "case.read",
  "revokedBy": "supervisor-1",
  "reasonCode": "REVIEW_COMPLETED",
  "timestamp": "2026-06-20T09:00:00Z"
}
```

### 17.2 Decision Audit

For high-risk actions:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decision": "DENY",
  "reasonCode": "ACL_EXPLICIT_DENY",
  "subject": "USER:alice",
  "action": "case.export",
  "resource": "CASE:9001",
  "policyMode": "ACL_DENY_OVERRIDE",
  "aclVersion": 42,
  "correlationId": "req-...",
  "timestamp": "2026-06-19T10:18:00Z"
}
```

### 17.3 Historical Reconstruction

Regulatory-grade systems should answer:

```text
On 2026-04-05 at 10:30, why was Alice allowed to export Case 9001?
```

To answer this, store:

- subject snapshot,
- group membership snapshot or version,
- ACL version,
- policy version,
- resource state/version,
- decision reason,
- request correlation id.

Without versioned evidence, audit becomes guesswork.

---

## 18. ACL and Multi-Tenancy

ACL without tenant boundary is dangerous.

Bad:

```sql
SELECT * FROM acl_entry
WHERE resource_type = 'CASE'
  AND resource_id = :caseId;
```

Good:

```sql
SELECT * FROM acl_entry
WHERE tenant_id = :tenantId
  AND resource_type = 'CASE'
  AND resource_id = :caseId;
```

### 18.1 Tenant Must Be in Every ACL Row

Even if resource ID is globally unique, tenant improves:

- query safety,
- partitioning,
- audit,
- data residency,
- migration,
- shard routing,
- blast radius isolation.

### 18.2 Tenant Context Must Be Trusted

Never trust client-provided tenant ID blindly:

```http
X-Tenant-Id: agency-b
```

Tenant context should be derived from authenticated subject/session/token + server-side mapping.

### 18.3 Cross-Tenant Admin

If support/admin can access multiple tenants, model it explicitly:

```text
SUPPORT_USER:fajar -> tenant agency-a READ under ticket INC-1001 until 2026-06-20
```

Do not give global bypass without audit.

---

## 19. ACL and Search / Indexes

Search engines complicate ACL.

### 19.1 Problem

Data copied to OpenSearch/Elasticsearch:

```text
Case 9001 indexed with title, status, content.
```

If search query does not apply ACL, unauthorized data leaks.

### 19.2 Approaches

#### Approach A — Filter at Search Query

Index ACL-readable subjects:

```json
{
  "caseId": "9001",
  "title": "...",
  "allowedSubjects": ["USER:alice", "GROUP:legal-team"]
}
```

Query includes:

```json
{
  "terms": {
    "allowedSubjects": ["USER:alice", "GROUP:legal-team"]
  }
}
```

Problem:

- ACL changes require reindex,
- allowedSubjects can grow large,
- group membership changes are hard.

#### Approach B — Search Candidate, DB Recheck

Search returns candidate IDs, then DB authorization filters.

Problem:

- pagination hard,
- relevance sorting can break,
- may require over-fetch.

#### Approach C — External Authorization Filter

Search engine integrates with authorization service/policy index.

Problem:

- architecture more complex,
- consistency and latency harder.

### 19.3 Rule

```text
Search result, count, highlight, facet, autocomplete, and export must all be authorization-aware.
```

Autocomplete leakage is often forgotten.

---

## 20. ACL and File/Document Authorization

File/document systems are ACL-heavy.

Special concerns:

1. Metadata access vs content access.
2. Preview access vs download access.
3. Attachment inherited from parent case.
4. Temporary signed URL.
5. Virus scan/quarantine state.
6. Watermarking/export control.
7. Public link/share link.
8. External recipient access.
9. Expiry.
10. Revocation after URL issued.

### 20.1 Signed URL Danger

If service issues S3 pre-signed URL:

```text
Authorization check happens before URL issuance.
URL may remain usable until expiry.
```

Mitigation:

- short expiry,
- no long-lived signed URL for sensitive files,
- proxy download through authorization service for high-risk content,
- audit download event,
- revoke by object version/key rotation if necessary.

### 20.2 Attachment Inheritance

Case attachment may inherit from case:

```text
User can read Case -> can read non-sensitive attachments.
Sensitive attachment requires extra ACL/action.
```

Do not assume all attachments inherit same permission.

---

## 21. ACL and Workflow Authorization

In regulatory/case systems, ACL often interacts with workflow.

Example:

```text
Case assigned to Officer A.
Officer A can update draft investigation note.
Supervisor can read and return note.
Approver can approve after submission.
Creator cannot approve own submission.
```

Should this be ACL?

Partly.

Better model:

```text
Assignment relation -> ReBAC/domain state rule.
Case state -> ABAC/state machine guard.
Explicit exception -> ACL.
Segregation of duty -> domain invariant.
```

Bad design:

```text
Every state transition creates dozens of ACL rows.
```

Better:

```text
ACL only stores exceptional explicit grants/denies.
Workflow engine/domain policy computes normal action eligibility.
```

---

## 22. ACL Grant Authority

Who may grant ACL?

Do not let anyone with access grant access.

Distinguish:

```text
READ object
WRITE object
ADMIN object
SHARE object
TRANSFER_OWNERSHIP
REVOKE_ACCESS
```

`WRITE` should not automatically imply `SHARE`.

### 22.1 Grant Policy

Example:

```text
User may grant READ to another user if:
  - user has case.share permission generally,
  - user has ADMIN or SHARE on the specific case,
  - target user belongs to same tenant,
  - target user is not blocked by conflict-of-interest rule,
  - grant has expiry if target is external.
```

Granting access itself is an authorized action.

```java
public void grantAccess(GrantAclCommand command, AuthenticatedUser actor) {
    AuthorizationDecision decision = authorizationService.can(
            actor,
            Action.of("case.share"),
            command.resource()
    );

    if (!decision.isAllowed()) {
        throw new AccessDeniedException(decision.reasonCode());
    }

    aclGrantPolicy.validateTarget(actor, command);
    aclRepository.insert(command.toAclEntry(actor));
    audit.logAclGranted(command, actor, decision);
}
```

---

## 23. ACL Revocation Semantics

Revocation is harder than grant.

Questions:

1. Can owner revoke own access?
2. Can admin revoke owner?
3. Does revocation affect inherited access?
4. If direct access revoked but group access remains, is user still allowed?
5. Does revoke create explicit deny or remove allow?
6. Does revoke affect already running sessions/jobs?
7. Does revoke invalidate cache immediately?

### 23.1 Remove Allow vs Add Deny

If Alice has direct allow and group allow:

```text
USER:alice ALLOW READ
GROUP:reviewers ALLOW READ
```

Removing direct allow still leaves group access.

If intent is “Alice must not access this object”, need explicit deny:

```text
USER:alice DENY READ
```

Semantics must be clear in UI:

```text
Remove direct access
```

is not same as:

```text
Block this user from access
```

---

## 24. ACL for Service-to-Service Authorization

ACL is not only for human users.

Example:

```text
SERVICE:report-exporter can READ Case:9001 attachment metadata.
SERVICE:notification-worker can READ recipient email for Correspondence:7001.
```

But be careful: service ACL can explode.

Often better:

```text
Service identity has capability to process resources assigned to its workload.
Work item contains authorized resource scope.
```

Avoid giving background services global read unless needed.

### 24.1 Async Job Bypass

Common bug:

```text
API checks ACL.
Then publishes message with resource ID.
Consumer processes resource without authorization context.
```

Fix options:

1. Consumer rechecks service authorization.
2. Message includes authorized command context and subject snapshot.
3. Job is created only after authorization and job scope is immutable.
4. Consumer enforces least privilege by job type.

---

## 25. ACL Implementation Patterns in Java

### 25.1 Explicit Authorization Service Pattern

```java
public final class CaseApplicationService {
    private final AuthorizationService authorizationService;
    private final CaseRepository caseRepository;

    public CaseDto getCase(UUID caseId, AuthenticatedUser user) {
        Case c = caseRepository.findById(caseId)
                .orElseThrow(NotFoundException::new);

        AuthorizationDecision decision = authorizationService.can(
                user,
                Action.of("case.read"),
                ResourceRef.of(c.tenantId(), "CASE", c.id().toString())
        );

        if (!decision.isAllowed()) {
            throw AccessDenied.forDecision(decision);
        }

        return CaseDto.from(c);
    }
}
```

Pros:

- explicit,
- testable,
- rich decision,
- not tied to Spring expression.

Cons:

- repetitive if not structured,
- developer may forget check.

Mitigation:

- command handlers standardize authorization,
- architecture tests,
- code review checklist,
- repository methods require authorization scope.

### 25.2 Guarded Repository Pattern

```java
public interface AuthorizedCaseRepository {
    Optional<Case> findReadableCase(CaseId id, AuthorizationScope scope);
    Page<Case> searchReadableCases(CaseSearchCriteria criteria, AuthorizationScope scope, Pageable pageable);
}
```

This prevents raw unscoped queries in application service.

### 25.3 Domain Policy + ACL Hybrid

```java
public AuthorizationDecision canReadCase(AuthenticatedUser user, Case c) {
    AuthorizationDecision tenant = tenantPolicy.sameTenant(user, c);
    if (!tenant.isAllowed()) return tenant;

    AuthorizationDecision global = permissionPolicy.has(user, "case.read");
    if (!global.isAllowed()) return global;

    AuthorizationDecision acl = aclService.can(user, Action.of("case.read"), c.resourceRef());
    if (acl.isAllowed()) return acl;

    AuthorizationDecision assignment = assignmentPolicy.isAssignedOrSupervisor(user, c);
    if (assignment.isAllowed()) return assignment;

    return AuthorizationDecision.deny("CASE_READ_NO_MATCH", evidence(global, acl, assignment));
}
```

Important: define combiner consciously.

---

## 26. Testing ACL

### 26.1 Unit Tests for Decision Algorithm

Test matrix:

| Scenario | Expected |
|---|---|
| direct allow | allow |
| direct deny | deny |
| group allow | allow |
| group allow + direct deny | deny |
| expired allow | deny |
| inherited allow | allow |
| inherited deny + child allow | deny, if deny override |
| no entry | deny |
| wrong tenant | deny |
| revoked entry | deny |

Example:

```java
@Test
public void directDenyOverridesGroupAllow() {
    AuthenticatedUser alice = user("alice", group("reviewers"));
    ResourceRef doc = resource("tenant-a", "DOCUMENT", "D1");

    aclRepository.save(allow(doc, groupSubject("reviewers"), action("document.read")));
    aclRepository.save(deny(doc, userSubject("alice"), action("document.read")));

    AuthorizationDecision decision = aclService.can(alice, action("document.read"), doc);

    assertFalse(decision.isAllowed());
    assertEquals("ACL_EXPLICIT_DENY", decision.reasonCode());
}
```

### 26.2 Integration Tests for Query Filtering

Test:

```text
Given 100 cases
And user can read only 3 via ACL
When search cases
Then result contains only 3
And totalElements == 3
And unauthorized IDs never appear
```

### 26.3 Pagination Tests

Create data:

```text
case 1 unauthorized
case 2 unauthorized
case 3 authorized
case 4 unauthorized
case 5 authorized
```

Ensure page size 1 returns authorized results correctly, not empty first page due to filter-after-fetch.

### 26.4 Revocation Tests

```text
Grant -> allowed
Revoke -> denied
Grant via group remains -> still allowed unless explicit deny
Explicit deny -> denied even with group allow
Cache invalidated after revoke
```

### 26.5 Multi-Tenant Tests

```text
Same resource_id exists in tenant A and tenant B.
User from tenant A has ACL in tenant A.
User must not access tenant B resource.
```

### 26.6 Mutation Tests

Intentionally remove:

- tenant predicate,
- deny predicate,
- revoked predicate,
- subject group predicate,
- action predicate.

Tests should fail.

---

## 27. ACL Anti-Patterns

### 27.1 ACL for Everything

If every domain rule becomes ACL row, system becomes unmaintainable.

Bad:

```text
Generate ACL rows for every officer x every case x every state.
```

Better:

```text
Use policy/rule for default access.
Use ACL for explicit grant/deny.
```

### 27.2 Boolean-Only ACL Service

Bad:

```java
boolean canRead = aclService.canRead(user, caseId);
```

Better:

```java
AuthorizationDecision decision = aclService.can(user, CASE_READ, caseRef);
```

### 27.3 Filtering After Fetch

Already covered. This is one of the most dangerous ACL mistakes.

### 27.4 Ignoring Group Membership Version

If group membership changes but ACL cache still uses old membership, access can remain stale.

### 27.5 No Revocation Semantics

If UI says “remove access” but system only deletes direct grant, user may still have access through group.

### 27.6 Framework Schema as Domain Truth

Spring ACL schema is useful, but blindly exposing framework concepts as business semantics can make future migration hard.

### 27.7 Missing Audit for Grant/Revoke

Access changes are security-relevant events. Treat them as auditable commands.

### 27.8 Missing Tenant in ACL

Never design ACL as global `(resource_type, resource_id)` only in multi-tenant systems.

---

## 28. Design Checklist

Before using ACL, answer these questions.

### 28.1 Domain Fit

- Does access truly vary per object?
- Is object sharing a first-class feature?
- Are explicit grants/revokes required?
- Do users/groups own resources?
- Is inheritance needed?

### 28.2 Semantics

- What is subject type?
- What is resource identity?
- Are permissions strings or masks?
- Does deny override allow?
- Is no match deny?
- Can child override parent?
- Is revoke removing allow or creating deny?

### 28.3 Data and Query

- How are ACLs stored?
- What indexes are needed?
- How is query filtering done?
- How are count and aggregation protected?
- How is search index protected?
- How is pagination kept correct?

### 28.4 Lifecycle

- What ACL is created with object?
- What happens on transfer?
- What happens on archive/delete?
- What happens on state change?
- What happens on tenant migration?

### 28.5 Operations

- How is ACL cached?
- How is cache invalidated?
- What is revocation delay?
- What audit is stored?
- Can historical decision be reconstructed?
- What monitoring exists for deny spikes?

---

## 29. Production-Grade Reference Architecture

```text
                    ┌────────────────────────────┐
                    │        API / Controller     │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │   Application Service       │
                    │ command/query orchestration │
                    └─────────────┬──────────────┘
                                  │
                     authorization decision
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │ Authorization Service       │
                    │ - RBAC capability check     │
                    │ - ABAC/domain constraints   │
                    │ - ACL explicit entries      │
                    │ - ReBAC relationships       │
                    └──────┬─────────┬───────────┘
                           │         │
              ┌────────────▼───┐ ┌───▼────────────────┐
              │ ACL Repository │ │ Subject Resolver    │
              │ resource ACL   │ │ groups/roles/org    │
              └────────────┬───┘ └───┬────────────────┘
                           │         │
                           ▼         ▼
                    ┌────────────────────────────┐
                    │ DB / Cache / Directory      │
                    └────────────────────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │ Audit / Decision Log        │
                    └────────────────────────────┘
```

For list queries:

```text
Controller
  -> Application Query Service
    -> Authorized Repository
      -> SQL/JPA/MyBatis predicate includes ACL allow/deny/tenant constraints
```

Do not fetch first then filter later.

---

## 30. Java 8–25 Considerations

### Java 8

Use:

- final classes for value objects,
- explicit constructors,
- `Optional` carefully,
- `CompletableFuture` only when needed,
- immutable collections via defensive copy,
- enums for stable effect/action categories.

### Java 11

Useful improvements:

- `var` local variable readability if team accepts,
- better HTTP client if external ACL/PDP involved,
- runtime improvements.

### Java 17

Useful for authorization model clarity:

- records for `ResourceRef`, `SubjectRef`, `Decision`,
- sealed interfaces for decision/effect/result variants,
- pattern matching improvements.

Example:

```java
public sealed interface Decision permits Allow, Deny {}

public record Allow(String reasonCode, List<String> evidence) implements Decision {}
public record Deny(String reasonCode, List<String> evidence) implements Decision {}
```

### Java 21

Useful indirectly:

- virtual threads for blocking ACL/PIP calls,
- structured concurrency for parallel attribute/ACL/relationship lookup,
- sequenced collections for deterministic evidence ordering.

But virtual threads do not fix bad ACL query design.

### Java 25

Treat Java 25 mainly as modern LTS-era platform maturity. Authorization design remains mostly architectural:

- type-safe model,
- explicit context,
- robust audit,
- clear failure semantics,
- secure query scoping.

Do not depend on latest language feature for core security correctness if codebase must support Java 8.

---

## 31. Applied Example: Case Attachment ACL

Requirement:

```text
A case has attachments.
Normal attachments inherit case read access.
Sensitive attachments require explicit attachment.read_sensitive permission or explicit ACL grant.
Reviewer can comment but cannot download sensitive attachment.
Owner can share attachment read access with another user for 7 days.
```

### 31.1 Model

Resource types:

```text
CASE
ATTACHMENT
```

Actions:

```text
case.read
attachment.read_metadata
attachment.preview
attachment.download
attachment.read_sensitive
attachment.share
```

Rules:

```text
If attachment.sensitive == false:
  case.read allows attachment.preview.

If attachment.sensitive == true:
  require attachment.read_sensitive OR explicit ACL allow attachment.download.

Explicit ACL deny always wins.
```

### 31.2 Decision Flow

```text
canDownloadAttachment(user, attachment):

1. tenant must match.
2. if explicit ACL deny -> deny.
3. if explicit ACL allow attachment.download -> allow.
4. if attachment not sensitive and user can read parent case -> allow.
5. if attachment sensitive and user has attachment.read_sensitive and can read parent case -> allow.
6. else deny.
```

### 31.3 Java Sketch

```java
public AuthorizationDecision canDownloadAttachment(
        AuthenticatedUser user,
        Attachment attachment
) {
    ResourceRef attachmentRef = attachment.resourceRef();

    AuthorizationDecision tenant = tenantPolicy.sameTenant(user, attachment.tenantId());
    if (!tenant.isAllowed()) return tenant;

    AuthorizationDecision explicitDeny = aclService.hasExplicitDeny(
            user,
            Action.of("attachment.download"),
            attachmentRef
    );
    if (explicitDeny.isAllowed()) {
        // naming aside: this method could return a DenyEvidence result instead
        return AuthorizationDecision.deny("ATTACHMENT_EXPLICIT_DENY", explicitDeny.evidence());
    }

    AuthorizationDecision explicitAllow = aclService.can(
            user,
            Action.of("attachment.download"),
            attachmentRef
    );
    if (explicitAllow.isAllowed()) {
        return explicitAllow;
    }

    AuthorizationDecision caseRead = casePolicy.canReadCase(user, attachment.caseRef());
    if (!caseRead.isAllowed()) {
        return AuthorizationDecision.deny("PARENT_CASE_NOT_READABLE", caseRead.evidence());
    }

    if (!attachment.isSensitive()) {
        return AuthorizationDecision.allow("PARENT_CASE_READ_ALLOWS_ATTACHMENT", caseRead.evidence());
    }

    AuthorizationDecision sensitive = permissionPolicy.has(user, "attachment.read_sensitive");
    if (sensitive.isAllowed()) {
        return AuthorizationDecision.allow("SENSITIVE_ATTACHMENT_PERMISSION", evidence(caseRead, sensitive));
    }

    return AuthorizationDecision.deny("SENSITIVE_ATTACHMENT_NOT_ALLOWED", evidence(caseRead, sensitive));
}
```

This illustrates why ACL is not the whole authorization system. ACL participates in a broader decision pipeline.

---

## 32. Top 1% Insight

A beginner asks:

```text
How do I check if user has permission on object?
```

A senior engineer asks:

```text
Where is the object-level invariant enforced?
Can unauthorized objects appear in list/search/export/report?
What happens when access is revoked?
Can we reconstruct why access was allowed six months ago?
Does cache include tenant, subject, action, resource, and version?
Does deny override allow?
What is direct grant vs inherited grant vs group grant?
Can async jobs bypass the ACL?
Does pagination remain correct under authorization filtering?
```

A top-level engineer sees ACL as a **data model, decision algorithm, query-scoping strategy, lifecycle model, cache invalidation problem, and audit system** — not just a table of user-resource permissions.

The strongest practical heuristic:

```text
Use ACL for explicit per-object grants/denies.
Use policy/domain rules for default business access.
Use query-time enforcement for lists/search/export.
Use decision logs for defensibility.
```

---

## 33. Part 9 Checklist

You understand this part if you can explain:

- why endpoint permission is insufficient for object-level security,
- what ACL, ACE, SID, object identity, permission mask, and inheritance mean,
- when ACL is the right model,
- when ACL should be replaced by RBAC/ABAC/ReBAC/policy rules,
- how Spring Security ACL works conceptually,
- why `hasPermission` can be useful but not enough,
- why filtering after fetch is dangerous,
- how to design ACL SQL predicates,
- why count/search/export need authorization filtering,
- why ACL cache invalidation is security-critical,
- why revoke semantics are harder than grant semantics,
- how to audit ACL grants, revokes, and decisions,
- how ACL interacts with workflow/state-machine authorization.

---

## 34. References

- Spring Security Reference — Domain Object Security / ACLs: https://docs.spring.io/spring-security/reference/servlet/authorization/acls.html
- Spring Security Reference — Authorization Architecture: https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html
- OWASP API Security Top 10 2023 — API1 Broken Object Level Authorization: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- OWASP Top 10 2021 — A01 Broken Access Control: https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/
- OWASP Web Security Testing Guide — API Broken Object Level Authorization: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/12-API_Testing/02-API_Broken_Object_Level_Authorization
- NIST RBAC model background: https://csrc.nist.gov/projects/role-based-access-control
- NIST publication PDF — The NIST Model for Role Based Access Control: https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=916402

---

## 35. Status Seri

Selesai:

```text
[x] Part 0 — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
[x] Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4 — RBAC Done Properly: Role-Based Access Control Beyond ADMIN
[x] Part 5 — Permission and Capability Modeling
[x] Part 6 — ABAC: Attribute-Based Authorization
[x] Part 7 — PBAC and Policy-as-Code
[x] Part 8 — ReBAC: Relationship-Based Authorization
[x] Part 9 — ACL and Domain Object Security
```

Belum selesai. Part berikutnya:

```text
[ ] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-008.md">⬅️ Part 8 — ReBAC: Relationship-Based Authorization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-010.md">Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement ➡️</a>
</div>
