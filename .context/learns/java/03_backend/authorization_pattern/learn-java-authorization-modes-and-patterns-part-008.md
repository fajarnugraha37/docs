# learn-java-authorization-modes-and-patterns-part-008

# Part 8 — ReBAC: Relationship-Based Authorization

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Fokus: **Java 8–25**, enterprise authorization, distributed systems, workflow/case management, regulatory defensibility  
> Posisi seri: **Part 8 dari maksimal 35**  
> Status seri: **belum selesai**

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami **Relationship-Based Authorization / ReBAC** bukan sebagai buzzword, tetapi sebagai model formal untuk menjawab akses berdasarkan relasi antar entitas.
2. Membedakan ReBAC dari RBAC, ABAC, ACL, PBAC, dan permission matrix biasa.
3. Mendesain model authorization berbasis relasi untuk domain Java enterprise seperti case management, workflow, agency system, team assignment, document sharing, hierarchy organisasi, dan delegation.
4. Memahami ide besar dari sistem Zanzibar-inspired authorization seperti OpenFGA dan SpiceDB tanpa mengunci diri ke satu produk.
5. Mendesain representation model seperti:
   - object,
   - relation,
   - subject/user,
   - tuple,
   - permission derivation,
   - userset,
   - hierarchy traversal,
   - transitive access.
6. Mengetahui kapan ReBAC cocok, kapan terlalu kompleks, dan kapan cukup memakai RBAC/ABAC/ACL.
7. Mengimplementasikan ReBAC sederhana di Java, lalu memahami kapan harus naik ke graph/tuple-store/PDP eksternal.
8. Menghindari failure mode besar:
   - relationship drift,
   - stale assignment,
   - cyclic graph,
   - over-broad parent access,
   - tenant boundary leak,
   - recursive permission explosion,
   - inconsistent relationship writes.

---

## 1. Ringkasan Mental Model

RBAC bertanya:

> “User ini punya role apa?”

ABAC bertanya:

> “User, resource, action, dan context ini punya atribut apa?”

ACL bertanya:

> “Pada object ini, siapa saja yang punya permission?”

ReBAC bertanya:

> “Apakah ada **jalur relasi yang valid** dari subject ke resource yang membuat action ini boleh dilakukan?”

Contoh sederhana:

```text
User Fajar boleh view Document D?

Jawaban ReBAC:
Fajar member dari Team A.
Team A viewer dari Folder X.
Document D berada di Folder X.
Viewer Folder X boleh view Document D.
Maka Fajar boleh view Document D.
```

Dengan kata lain, authorization bukan lagi hanya role atau attribute, tetapi **graph reachability with semantics**.

Namun hati-hati: ReBAC bukan sekadar graph database. ReBAC adalah **authorization model** yang menggunakan relationship graph untuk menghitung permission.

---

## 2. Kenapa ReBAC Penting

Banyak sistem enterprise tidak cocok dengan RBAC murni karena access-nya tergantung hubungan antar entitas:

```text
User boleh view case jika:
- dia assignee case tersebut, atau
- dia supervisor dari assignee, atau
- dia member dari team yang menangani case, atau
- dia officer dari agency pemilik case, atau
- dia reviewer yang ditugaskan pada appeal dari case tersebut, atau
- dia punya delegated authority dari officer lain, atau
- case berada dalam portfolio unit kerjanya.
```

Jika semua ini dipaksa menjadi RBAC, hasilnya biasanya:

```text
ROLE_CASE_VIEWER
ROLE_CASE_VIEWER_AGENCY_A
ROLE_CASE_VIEWER_AGENCY_B
ROLE_CASE_REVIEWER_TYPE_X
ROLE_CASE_REVIEWER_TYPE_Y
ROLE_SUPERVISOR_TEAM_123
ROLE_TEMPORARY_CASE_ACCESS_456
ROLE_DELEGATED_OFFICER_789
...
```

Ini disebut **role explosion**.

RBAC bagus untuk authority umum. Tetapi ketika permission bergantung pada **siapa terkait dengan apa**, RBAC mulai memburuk.

ReBAC mengembalikan access control ke struktur domain:

```text
user --member_of--> team
team --handles--> case
case --contains--> document
user --supervisor_of--> user
user --delegated_by--> user
agency --owns--> case
case --has_appeal--> appeal
appeal --assigned_to--> reviewer
```

Lalu policy mendefinisikan permission dari relasi-relasi itu.

---

## 3. Definisi ReBAC

**Relationship-Based Access Control** adalah model authorization di mana keputusan akses dibuat berdasarkan hubungan antara subject, resource, dan/atau entitas lain di sekitar mereka.

Bentuk minimalnya:

```text
subject S has relation R to object O
```

Contoh:

```text
user:fajar#member_of@team:appeal-reviewers
team:appeal-reviewers#reviewer@appeal:APL-2026-0001
document:DOC-1#parent@case:CASE-1
case:CASE-1#owner@agency:CEA
user:fajar#officer@agency:CEA
```

Tetapi permission tidak selalu disimpan langsung. Permission sering **diturunkan** dari relasi.

Contoh:

```text
permission view_case = owner + assignee + reviewer + agency->officer
```

Artinya, seseorang boleh view case jika ia punya salah satu hubungan berikut:

1. owner case,
2. assignee case,
3. reviewer case,
4. officer dari agency yang memiliki case.

---

## 4. ReBAC vs RBAC vs ABAC vs ACL vs PBAC

### 4.1 RBAC

RBAC:

```text
User -> Role -> Permission
```

Cocok untuk:

```text
Admin boleh manage users.
Finance officer boleh view payment report.
System operator boleh restart service.
```

Kurang cocok untuk:

```text
Officer boleh update hanya case yang assigned ke dirinya.
Supervisor boleh view case milik bawahannya.
User boleh view document jika dia member dari folder parent.
```

Masalahnya bukan action global, tetapi hubungan user-resource.

---

### 4.2 ABAC

ABAC:

```text
allow if subject.department == resource.department
allow if subject.clearance >= resource.classification
allow if context.time within working_hours
```

Cocok ketika decision bergantung pada atribut.

Namun ABAC bisa menjadi sulit jika relasinya banyak dan transitive:

```text
allow if user belongs to any team that belongs to any department that owns any portfolio that contains this case
```

Secara teknis bisa ditulis sebagai ABAC, tetapi mental model-nya sudah menjadi relationship traversal.

---

### 4.3 ACL

ACL:

```text
Object -> list of entries

Document D:
- fajar: view
- team-a: edit
- admin: owner
```

Cocok untuk object-level grant yang sederhana.

Namun ACL bisa menjadi berat ketika:

1. permission diwariskan dari parent,
2. group nested,
3. organization hierarchy besar,
4. permission berasal dari multiple relation path,
5. butuh consistency lintas service,
6. butuh explainability lintas graph.

ReBAC dapat dianggap sebagai generalisasi dari ACL: ACL menyimpan relasi langsung, ReBAC menghitung permission dari relasi langsung dan tidak langsung.

---

### 4.4 PBAC

PBAC:

```text
policy decides allow/deny based on input
```

PBAC adalah pendekatan arsitektural: policy externalized dan dikelola sebagai policy.

ReBAC adalah model data/semantik relationship.

Keduanya bisa digabung:

```text
PBAC engine mengevaluasi policy yang memakai ReBAC relationship graph.
```

---

## 5. Model Dasar ReBAC

Komponen dasar:

```text
Object
Relation
Subject/User
Relationship Tuple
Permission
Userset
```

---

### 5.1 Object

Object adalah resource atau entity yang menjadi target relasi.

Contoh:

```text
case:CASE-001
document:DOC-100
folder:FOLDER-9
team:TEAM-APPEAL
agency:CEA
user:fajar
```

Format umum:

```text
type:id
```

Contoh:

```text
case:12345
document:abc-999
team:compliance-review
```

Object tidak harus selalu resource yang diakses langsung. Object bisa juga entitas perantara seperti team, agency, folder, organization unit, workflow step, or delegation record.

---

### 5.2 Relation

Relation menjelaskan hubungan subject terhadap object.

Contoh:

```text
owner
viewer
editor
member
assignee
reviewer
supervisor
parent
agency
handler
creator
delegate
```

Relation bukan permission final. Relation adalah fakta domain.

Contoh:

```text
user:fajar is member of team:case-officers
user:rina is assignee of case:CASE-123
case:CASE-123 belongs to agency:CEA
document:DOC-1 parent is case:CASE-123
```

---

### 5.3 Subject / User

Subject adalah entitas yang meminta akses.

Dalam ReBAC, subject bisa berupa:

```text
user:fajar
team:case-officers
agency:CEA
service:report-generator
group:admin-reviewers
```

Ini penting. Subject tidak harus manusia.

Jika hanya manusia yang dianggap subject, model akan sulit untuk:

1. group access,
2. service account access,
3. team membership,
4. delegation,
5. organization-level permission,
6. machine-to-machine authorization.

---

### 5.4 Relationship Tuple

Relationship tuple adalah fakta relasi.

Bentuk konseptual:

```text
<object>#<relation>@<subject>
```

Contoh:

```text
case:CASE-1#assignee@user:fajar
case:CASE-1#reviewer@team:appeal-reviewers
team:appeal-reviewers#member@user:rina
document:DOC-1#parent@case:CASE-1
agency:CEA#officer@user:fajar
case:CASE-1#agency@agency:CEA
```

Bisa dibaca:

```text
Pada object case:CASE-1, relation assignee dimiliki oleh user:fajar.
```

atau:

```text
user:fajar adalah assignee dari case:CASE-1.
```

---

### 5.5 Permission

Permission adalah kemampuan yang ingin dicek.

Contoh:

```text
view
edit
approve
assign
reopen
export
comment
close
```

Dalam ReBAC, permission sering didefinisikan sebagai expression di atas relation.

Contoh:

```text
case.view = assignee + reviewer + agency->officer
case.update = assignee
case.approve = reviewer - creator
case.assign = agency->supervisor
```

Artinya:

1. `view` boleh jika user assignee, reviewer, atau officer dari agency pemilik case.
2. `update` boleh jika assignee.
3. `approve` boleh jika reviewer tetapi bukan creator.
4. `assign` boleh jika supervisor dari agency terkait.

---

### 5.6 Userset

Userset adalah kumpulan subject yang memenuhi relation/permission tertentu.

Contoh:

```text
userset(case:CASE-1#viewer)
```

berarti:

```text
semua subject yang merupakan viewer case CASE-1
```

Userset bisa langsung atau computed.

```text
case:CASE-1#assignee@user:fajar
case:CASE-1#reviewer@team:appeal-reviewers
team:appeal-reviewers#member@user:rina
```

Jika `case.view = assignee + reviewer->member`, maka userset viewer case bisa mencakup:

```text
user:fajar
user:rina
```

---

## 6. Contoh Domain: Case Management Regulatory System

Kita gunakan domain yang lebih realistis.

Entitas:

```text
User
Agency
Division
Team
Case
Appeal
Document
Task
WorkflowStep
Delegation
```

Relasi:

```text
agency#officer@user
agency#supervisor@user
team#member@user
team#lead@user
case#agency@agency
case#assignee@user
case#handler_team@team
case#creator@user
case#reviewer@user
case#appeal@appeal
appeal#reviewer@user
document#parent_case@case
task#case@case
delegation#delegator@user
delegation#delegate@user
delegation#scope_case@case
```

Permission yang ingin dihitung:

```text
case.view
case.update
case.assign
case.approve
case.close
document.view
document.download
task.complete
appeal.review
```

Contoh rule:

```text
case.view = assignee + reviewer + handler_team->member + agency->officer
case.update = assignee + handler_team->lead
case.assign = agency->supervisor
case.approve = reviewer - creator
document.view = parent_case->view
document.download = parent_case->view
task.complete = case->assignee
appeal.review = reviewer
```

Perhatikan pola penting:

```text
document.view = parent_case->view
```

Artinya, document mewarisi permission view dari parent case.

Ini sangat umum dalam sistem nyata:

```text
file view = folder viewer
comment edit = issue editor
attachment download = case viewer
subtask update = parent task assignee
invoice view = account member
```

---

## 7. “Path” adalah Konsep Utama ReBAC

Dalam ReBAC, access sering dibuktikan lewat path.

Contoh:

```text
Can user:fajar view document:DOC-1?
```

Relationship facts:

```text
document:DOC-1#parent_case@case:CASE-1
case:CASE-1#agency@agency:CEA
agency:CEA#officer@user:fajar
```

Permission rule:

```text
document.view = parent_case->view
case.view = agency->officer
```

Decision path:

```text
user:fajar
  <- officer of agency:CEA
  <- agency of case:CASE-1
  <- parent_case of document:DOC-1
therefore can view document:DOC-1
```

Dalam bentuk graph:

```text
user:fajar
   ^ officer
agency:CEA
   ^ agency
case:CASE-1
   ^ parent_case
document:DOC-1
```

Atau dari resource ke subject:

```text
document:DOC-1 --parent_case--> case:CASE-1 --agency--> agency:CEA --officer--> user:fajar
```

Authorization decision menjadi:

> Apakah ada path yang sesuai schema dari `document:DOC-1#view` ke `user:fajar`?

---

## 8. Permission Derivation

Dalam ReBAC, permission jarang disimpan untuk setiap user-resource pair.

Yang disimpan adalah relasi dasar:

```text
case:CASE-1#assignee@user:fajar
case:CASE-1#agency@agency:CEA
agency:CEA#officer@user:rina
```

Lalu permission dihitung:

```text
case.view = assignee + agency->officer
```

Maka:

```text
user:fajar boleh view karena assignee
user:rina boleh view karena officer dari agency yang punya case
```

Ini sangat berbeda dari menyimpan:

```text
case:CASE-1 view user:fajar
case:CASE-1 view user:rina
```

Kenapa derivation penting?

Karena ketika relasi berubah, permission ikut berubah secara konseptual.

Contoh:

```text
agency:CEA#officer@user:rina dihapus
```

Maka Rina tidak lagi boleh view semua case agency CEA, tanpa harus menghapus ribuan record permission per case.

Namun ini juga berarti runtime check harus bisa menghitung graph dengan benar dan cepat.

---

## 9. ReBAC Expression Patterns

### 9.1 Union

```text
case.view = assignee + reviewer + handler_team->member
```

Artinya boleh jika salah satu terpenuhi.

Dalam Java mental model:

```java
return isAssignee(user, caseId)
    || isReviewer(user, caseId)
    || isMemberOfHandlerTeam(user, caseId);
```

---

### 9.2 Intersection

```text
case.approve_sensitive = reviewer & agency->senior_officer
```

Artinya user harus reviewer dan senior officer agency terkait.

Dalam Java:

```java
return isReviewer(user, caseId)
    && isSeniorOfficerOfOwningAgency(user, caseId);
```

---

### 9.3 Exclusion

```text
case.approve = reviewer - creator
```

Artinya reviewer boleh approve kecuali dia creator.

Ini sangat penting untuk maker-checker/four-eyes principle.

Dalam Java:

```java
return isReviewer(user, caseId)
    && !isCreator(user, caseId);
```

---

### 9.4 Traversal

```text
document.view = parent_case->view
```

Artinya permission document mengikuti permission parent case.

Dalam Java:

```java
CaseId parentCase = documentRepository.findParentCase(documentId);
return caseAuthorization.canView(user, parentCase);
```

---

### 9.5 Recursive / Hierarchical

```text
folder.view = viewer + parent->view
```

Artinya user boleh view folder jika viewer langsung atau boleh view parent folder.

Ini cocok untuk tree seperti folder/document.

Tapi hati-hati dengan cyclic parent:

```text
folder:A parent folder:B
folder:B parent folder:A
```

Jika traversal tidak punya cycle detection, authorization bisa infinite recursion atau denial/allow yang tidak konsisten.

---

### 9.6 Group Membership

```text
document.view = viewer + viewer_group->member
```

Contoh:

```text
document:DOC-1#viewer_group@group:reviewers
group:reviewers#member@user:fajar
```

Maka Fajar boleh view DOC-1.

---

### 9.7 Nested Group

```text
group.member = direct_member + parent_group->member
```

Nested group sering terlihat sederhana, tetapi bisa berbahaya:

```text
group:A parent group:B
group:B parent group:C
group:C parent group:A
```

Harus ada:

1. cycle detection,
2. max traversal depth,
3. validation saat write,
4. observability untuk expensive check.

---

## 10. ReBAC untuk Regulatory Case Management

Mari desain model lebih konkret.

### 10.1 Requirement

```text
A user can view a case if:
1. they are directly assigned to the case; or
2. they are a member of the team handling the case; or
3. they are a supervisor of the assigned officer; or
4. they are an officer of the owning agency; or
5. they have an active delegation for that case.
```

### 10.2 Relationship Facts

```text
case:CASE-100#assignee@user:fajar
case:CASE-100#handler_team@team:compliance-a
team:compliance-a#member@user:rina
user:fajar#supervisor@user:maya
case:CASE-100#agency@agency:CEA
agency:CEA#officer@user:adi
delegation:DEL-1#delegate@user:budi
delegation:DEL-1#scope_case@case:CASE-100
```

Catatan: arah `supervisor` harus diputuskan konsisten. Bisa:

```text
user:fajar#supervisor@user:maya
```

berarti Maya adalah supervisor Fajar.

Atau:

```text
user:maya#supervises@user:fajar
```

Jangan campur keduanya tanpa naming convention.

### 10.3 Permission Rule Konseptual

```text
case.view =
    assignee
  + handler_team->member
  + assignee->supervisor
  + agency->officer
  + active_delegation->delegate
```

Namun `active_delegation` biasanya butuh temporal/contextual check. ReBAC murni menyimpan hubungan, tetapi active/inactive bisa menjadi ABAC/context condition.

Maka model hybrid:

```text
case.view = assignee + handler_team->member + assignee->supervisor + agency->officer + delegation->delegate
where delegation.active_at(request_time)
```

Ini contoh ReBAC + ABAC.

---

## 11. ReBAC dan Delegation

Delegation sering disalahmodelkan sebagai role sementara.

Misalnya:

```text
ROLE_TEMP_CASE_VIEW_CASE_100
```

Ini buruk karena:

1. role menjadi instance-specific,
2. jumlah role meledak,
3. lifecycle sulit,
4. audit sulit,
5. revocation rawan terlupa.

Model ReBAC lebih bersih:

```text
delegation:DEL-1#delegator@user:fajar
delegation:DEL-1#delegate@user:budi
delegation:DEL-1#scope_case@case:CASE-100
delegation:DEL-1#permission@permission:case.view
```

Atau lebih sederhana:

```text
case:CASE-100#delegated_viewer@user:budi
```

Trade-off:

| Model | Kelebihan | Kekurangan |
|---|---|---|
| Direct case delegated viewer | Simple, cepat | Kurang expressive untuk expiry, reason, delegator |
| Delegation entity | Audit kuat, bisa time-bound, bisa scoped | Check lebih kompleks |

Untuk sistem regulatory, delegation entity biasanya lebih defensible.

---

## 12. ReBAC dan Four-Eyes / Maker-Checker

Maker-checker bukan hanya role problem.

Requirement:

```text
User boleh approve jika dia reviewer, tetapi bukan creator/submitter dari item tersebut.
```

Relationship facts:

```text
case:CASE-1#creator@user:fajar
case:CASE-1#reviewer@user:rina
case:CASE-1#reviewer@user:fajar
```

Permission:

```text
case.approve = reviewer - creator
```

Decision:

```text
rina approve? yes
fajar approve? no, because creator excluded
```

Dalam Java, jangan tulis hanya:

```java
@PreAuthorize("hasAuthority('case.approve')")
```

Karena itu hanya function-level permission.

Harus ada object relation check:

```java
authorizationService.authorize(
    subject,
    Action.APPROVE,
    ResourceRef.caseId(caseId),
    context
);
```

Lalu decision engine mengevaluasi:

```text
isReviewer(subject, caseId) && !isCreator(subject, caseId)
```

---

## 13. ReBAC dan Hierarchy

Banyak sistem punya hierarchy:

```text
Organization
  Agency
    Division
      Team
        User
```

Resource juga bisa hierarchy:

```text
Case
  Document
    Attachment
  Task
  Comment
```

ReBAC cocok untuk inheritance:

```text
document.view = parent_case->view
attachment.download = parent_document->view
task.update = parent_case->update
comment.delete = parent_case->moderate
```

Namun hierarchy membawa risiko:

1. parent-child salah tulis membuat akses bocor,
2. cyclic parent menyebabkan traversal infinite,
3. parent access terlalu luas,
4. child exception sulit,
5. moving resource antar parent mengubah permission besar-besaran.

Contoh bahaya:

```text
Document confidential dipindah ke folder umum.
```

Jika `document.view = folder->view`, maka semua viewer folder umum bisa melihat document confidential.

Solusi:

1. validate move operation dengan authorization impact analysis,
2. support explicit deny/exception jika model butuh,
3. classify resource sensitivity,
4. audit relationship change,
5. require approval for moving sensitive resource.

---

## 14. ReBAC dan Tenant Boundary

Tenant boundary harus menjadi invariant, bukan hanya relation biasa.

Contoh buruk:

```text
case.view = assignee + agency->officer
```

Jika relationship salah tulis:

```text
case:CASE-A#agency@agency:B
```

maka officer agency B bisa melihat case A.

Untuk sistem multi-tenant, ReBAC harus dikombinasikan dengan boundary guard:

```text
allow only if:
  relationship path exists
  AND subject tenant == resource tenant
  AND every traversed object is within allowed tenant boundary
```

Atau model tuple harus namespace per tenant:

```text
tenant:CEA/case:CASE-1#assignee@tenant:CEA/user:fajar
```

Prinsip:

> Relationship path tidak boleh melintasi tenant boundary kecuali relasi cross-tenant itu eksplisit, approved, scoped, dan audited.

---

## 15. Java Implementation Level 1: Explicit Domain ReBAC

Untuk banyak aplikasi, kamu tidak langsung butuh OpenFGA/SpiceDB. Kamu bisa mulai dari service domain eksplisit.

### 15.1 Core API

```java
public interface AuthorizationService {
    PolicyDecision authorize(AuthorizationRequest request);
}
```

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    public AuthorizationRequest(
            SubjectRef subject,
            Action action,
            ResourceRef resource,
            AuthorizationContext context
    ) {
        this.subject = subject;
        this.action = action;
        this.resource = resource;
        this.context = context;
    }

    public SubjectRef subject() { return subject; }
    public Action action() { return action; }
    public ResourceRef resource() { return resource; }
    public AuthorizationContext context() { return context; }
}
```

Java 8-compatible style menggunakan final class biasa. Untuk Java 16+, ini bisa menjadi `record`.

```java
public final class PolicyDecision {
    private final boolean allowed;
    private final String reasonCode;
    private final String explanation;

    private PolicyDecision(boolean allowed, String reasonCode, String explanation) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
        this.explanation = explanation;
    }

    public static PolicyDecision allow(String reasonCode, String explanation) {
        return new PolicyDecision(true, reasonCode, explanation);
    }

    public static PolicyDecision deny(String reasonCode, String explanation) {
        return new PolicyDecision(false, reasonCode, explanation);
    }

    public boolean allowed() { return allowed; }
    public String reasonCode() { return reasonCode; }
    public String explanation() { return explanation; }
}
```

---

### 15.2 Relationship Repository

```java
public interface RelationshipRepository {
    boolean caseAssignee(UserId userId, CaseId caseId);

    boolean caseReviewer(UserId userId, CaseId caseId);

    boolean caseCreator(UserId userId, CaseId caseId);

    boolean memberOfHandlerTeam(UserId userId, CaseId caseId);

    boolean officerOfOwningAgency(UserId userId, CaseId caseId);

    boolean supervisorOfAssignee(UserId supervisorUserId, CaseId caseId);

    boolean activeDelegateForCase(UserId userId, CaseId caseId, Instant at);
}
```

Ini bukan generic tuple store, tetapi domain-specific relationship repository.

Kelebihan:

1. mudah dipahami,
2. mudah ditest,
3. SQL bisa dioptimalkan,
4. tidak butuh infra baru,
5. cocok untuk monolith/modular monolith/service kecil.

Kekurangan:

1. makin banyak relation makin besar interface,
2. sulit reusable lintas service,
3. sulit untuk dynamic relation model,
4. tidak ideal untuk nested graph kompleks.

---

### 15.3 Case Authorization Policy

```java
public final class CaseAuthorizationPolicy {
    private final RelationshipRepository relationships;

    public CaseAuthorizationPolicy(RelationshipRepository relationships) {
        this.relationships = relationships;
    }

    public PolicyDecision canView(UserId userId, CaseId caseId, AuthorizationContext context) {
        if (relationships.caseAssignee(userId, caseId)) {
            return PolicyDecision.allow("CASE_ASSIGNEE", "User is directly assigned to the case.");
        }

        if (relationships.memberOfHandlerTeam(userId, caseId)) {
            return PolicyDecision.allow("CASE_HANDLER_TEAM_MEMBER", "User is member of the case handler team.");
        }

        if (relationships.supervisorOfAssignee(userId, caseId)) {
            return PolicyDecision.allow("CASE_ASSIGNEE_SUPERVISOR", "User supervises the assigned officer.");
        }

        if (relationships.officerOfOwningAgency(userId, caseId)) {
            return PolicyDecision.allow("CASE_AGENCY_OFFICER", "User is officer of the owning agency.");
        }

        if (relationships.activeDelegateForCase(userId, caseId, context.requestTime())) {
            return PolicyDecision.allow("CASE_ACTIVE_DELEGATE", "User has active delegated access for this case.");
        }

        return PolicyDecision.deny("NO_CASE_VIEW_RELATION", "No valid relationship grants view access to this case.");
    }

    public PolicyDecision canApprove(UserId userId, CaseId caseId, AuthorizationContext context) {
        if (!relationships.caseReviewer(userId, caseId)) {
            return PolicyDecision.deny("NOT_CASE_REVIEWER", "User is not a reviewer for this case.");
        }

        if (relationships.caseCreator(userId, caseId)) {
            return PolicyDecision.deny("MAKER_CHECKER_VIOLATION", "Case creator cannot approve own case.");
        }

        return PolicyDecision.allow("CASE_REVIEWER_NOT_CREATOR", "User is reviewer and not the case creator.");
    }
}
```

Ini adalah ReBAC tanpa graph engine. Modelnya relationship-based karena keputusan berdasar relasi subject-resource.

---

## 16. Java Implementation Level 2: Generic Tuple Store

Ketika relation semakin banyak, kamu bisa membangun tuple store internal.

### 16.1 Tuple Model

```java
public final class RelationTuple {
    private final ObjectRef object;
    private final String relation;
    private final SubjectRef subject;

    public RelationTuple(ObjectRef object, String relation, SubjectRef subject) {
        this.object = object;
        this.relation = relation;
        this.subject = subject;
    }

    public ObjectRef object() { return object; }
    public String relation() { return relation; }
    public SubjectRef subject() { return subject; }
}
```

```java
public final class ObjectRef {
    private final String type;
    private final String id;

    public ObjectRef(String type, String id) {
        if (type == null || type.isEmpty()) throw new IllegalArgumentException("type is required");
        if (id == null || id.isEmpty()) throw new IllegalArgumentException("id is required");
        this.type = type;
        this.id = id;
    }

    public String type() { return type; }
    public String id() { return id; }

    @Override
    public String toString() {
        return type + ":" + id;
    }
}
```

```java
public final class SubjectRef {
    private final String type;
    private final String id;

    public SubjectRef(String type, String id) {
        if (type == null || type.isEmpty()) throw new IllegalArgumentException("type is required");
        if (id == null || id.isEmpty()) throw new IllegalArgumentException("id is required");
        this.type = type;
        this.id = id;
    }

    public String type() { return type; }
    public String id() { return id; }

    @Override
    public String toString() {
        return type + ":" + id;
    }
}
```

Untuk Java 16+:

```java
public record ObjectRef(String type, String id) {}
public record SubjectRef(String type, String id) {}
public record RelationTuple(ObjectRef object, String relation, SubjectRef subject) {}
```

Tetapi karena seri mencakup Java 8–25, gunakan class biasa sebagai baseline.

---

### 16.2 Tuple Repository

```java
public interface TupleRepository {
    boolean exists(ObjectRef object, String relation, SubjectRef subject);

    List<RelationTuple> findByObjectAndRelation(ObjectRef object, String relation);

    List<RelationTuple> findBySubject(SubjectRef subject);
}
```

Contoh SQL schema sederhana:

```sql
CREATE TABLE relation_tuple (
    object_type      VARCHAR(100) NOT NULL,
    object_id        VARCHAR(200) NOT NULL,
    relation_name    VARCHAR(100) NOT NULL,
    subject_type     VARCHAR(100) NOT NULL,
    subject_id       VARCHAR(200) NOT NULL,
    tenant_id        VARCHAR(100) NOT NULL,
    created_at       TIMESTAMP NOT NULL,
    created_by       VARCHAR(200) NOT NULL,
    reason           VARCHAR(500),
    PRIMARY KEY (object_type, object_id, relation_name, subject_type, subject_id, tenant_id)
);

CREATE INDEX idx_relation_tuple_subject
ON relation_tuple (tenant_id, subject_type, subject_id);

CREATE INDEX idx_relation_tuple_object_relation
ON relation_tuple (tenant_id, object_type, object_id, relation_name);
```

Tenant harus masuk key/index untuk mencegah leak dan mempercepat query.

---

### 16.3 Simple Check

```java
public final class TupleAuthorizationService {
    private final TupleRepository tuples;

    public TupleAuthorizationService(TupleRepository tuples) {
        this.tuples = tuples;
    }

    public boolean hasDirectRelation(ObjectRef object, String relation, SubjectRef subject) {
        return tuples.exists(object, relation, subject);
    }
}
```

Contoh:

```java
boolean allowed = tupleAuthorizationService.hasDirectRelation(
    new ObjectRef("case", "CASE-1"),
    "assignee",
    new SubjectRef("user", "fajar")
);
```

Ini masih direct relation, belum computed permission.

---

## 17. Java Implementation Level 3: Computed Permission

Kita buat rule sederhana:

```text
case.view = assignee + reviewer + handler_team->member
```

Secara hardcoded:

```java
public final class ComputedCasePermission {
    private final TupleRepository tuples;

    public ComputedCasePermission(TupleRepository tuples) {
        this.tuples = tuples;
    }

    public boolean canViewCase(String caseId, String userId) {
        ObjectRef kase = new ObjectRef("case", caseId);
        SubjectRef user = new SubjectRef("user", userId);

        if (tuples.exists(kase, "assignee", user)) {
            return true;
        }

        if (tuples.exists(kase, "reviewer", user)) {
            return true;
        }

        List<RelationTuple> handlerTeams = tuples.findByObjectAndRelation(kase, "handler_team");
        for (RelationTuple handlerTeam : handlerTeams) {
            SubjectRef teamSubject = handlerTeam.subject();
            ObjectRef teamObject = new ObjectRef(teamSubject.type(), teamSubject.id());
            if (tuples.exists(teamObject, "member", user)) {
                return true;
            }
        }

        return false;
    }
}
```

Ini mulai menyerupai ReBAC traversal.

Masalahnya:

1. rule masih hardcoded,
2. traversal manual,
3. belum ada cycle detection,
4. belum ada explainability path,
5. belum ada bulk check,
6. belum ada max depth,
7. belum ada versioned schema.

Tetapi sebagai stepping stone sangat bagus.

---

## 18. Java Implementation Level 4: Explainable Decision Path

Top-level authorization harus bisa menjawab:

> “Kenapa user ini boleh?”

Bukan hanya:

```text
true
```

Model:

```java
public final class DecisionPath {
    private final List<String> steps;

    public DecisionPath(List<String> steps) {
        this.steps = new ArrayList<>(steps);
    }

    public List<String> steps() {
        return Collections.unmodifiableList(steps);
    }
}
```

```java
public final class ExplainableDecision {
    private final boolean allowed;
    private final String reasonCode;
    private final DecisionPath path;

    private ExplainableDecision(boolean allowed, String reasonCode, DecisionPath path) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
        this.path = path;
    }

    public static ExplainableDecision allow(String reasonCode, DecisionPath path) {
        return new ExplainableDecision(true, reasonCode, path);
    }

    public static ExplainableDecision deny(String reasonCode, DecisionPath path) {
        return new ExplainableDecision(false, reasonCode, path);
    }

    public boolean allowed() { return allowed; }
    public String reasonCode() { return reasonCode; }
    public DecisionPath path() { return path; }
}
```

Contoh output:

```json
{
  "allowed": true,
  "reasonCode": "CASE_HANDLER_TEAM_MEMBER",
  "path": [
    "case:CASE-1#handler_team@team:compliance-a",
    "team:compliance-a#member@user:fajar"
  ]
}
```

Untuk regulatory system, path ini sangat berharga untuk audit.

---

## 19. ReBAC dan Database Query

ReBAC check satu object bisa mudah. Tantangan besar adalah list/search.

Pertanyaan:

```text
Tampilkan semua case yang boleh dilihat user:fajar.
```

Jangan lakukan:

```java
List<Case> allCases = caseRepository.findAll();
return allCases.stream()
    .filter(case -> authorization.canView(user, case.id()))
    .collect(toList());
```

Ini buruk karena:

1. data leakage risk sebelum filter,
2. performa buruk,
3. pagination salah,
4. count salah,
5. memory besar,
6. audit sulit.

Harus query-scoped.

Contoh SQL konseptual:

```sql
SELECT c.*
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM relation_tuple rt
    WHERE rt.object_type = 'case'
      AND rt.object_id = c.id
      AND rt.relation_name = 'assignee'
      AND rt.subject_type = 'user'
      AND rt.subject_id = :userId
      AND rt.tenant_id = :tenantId
)
OR EXISTS (
    SELECT 1
    FROM relation_tuple rt_case_team
    JOIN relation_tuple rt_team_member
      ON rt_team_member.object_type = rt_case_team.subject_type
     AND rt_team_member.object_id = rt_case_team.subject_id
     AND rt_team_member.relation_name = 'member'
     AND rt_team_member.subject_type = 'user'
     AND rt_team_member.subject_id = :userId
     AND rt_team_member.tenant_id = rt_case_team.tenant_id
    WHERE rt_case_team.object_type = 'case'
      AND rt_case_team.object_id = c.id
      AND rt_case_team.relation_name = 'handler_team'
      AND rt_case_team.tenant_id = :tenantId
);
```

Ini menunjukkan kenapa ReBAC list operation lebih sulit daripada point check.

Untuk sistem besar, biasanya ada strategi:

1. reverse index,
2. materialized access table,
3. search index dengan access filter,
4. external authorization engine yang support list objects,
5. precomputed userset,
6. hybrid query + check.

---

## 20. Materialized Access vs Runtime Traversal

### 20.1 Runtime Traversal

Saat request:

```text
Check user -> traverse graph -> allow/deny
```

Kelebihan:

1. always near-current,
2. tidak perlu materialisasi besar,
3. mudah untuk relationship yang sering berubah.

Kekurangan:

1. latency lebih tinggi,
2. graph traversal mahal,
3. dependency ke relationship store,
4. sulit untuk list/search.

---

### 20.2 Materialized Access

Saat relationship berubah:

```text
Compute effective access -> store in table/index
```

Kelebihan:

1. query cepat,
2. pagination mudah,
3. search/export mudah,
4. cocok untuk report.

Kekurangan:

1. stale permission risk,
2. recomputation complexity,
3. storage besar,
4. invalidation sulit,
5. consistency problem.

---

### 20.3 Hybrid

Umumnya sistem matang memakai hybrid:

```text
Runtime check untuk sensitive mutation.
Materialized access untuk listing/search/report.
Final check sebelum action penting.
```

Contoh:

```text
Search case list:
  use materialized_access table.

Open case detail:
  runtime ReBAC check.

Approve case:
  runtime ReBAC + state check + maker-checker check.
```

Ini menyeimbangkan performa dan correctness.

---

## 21. ReBAC dan Consistency

Authorization adalah security-critical. Relationship consistency sangat penting.

Contoh race:

```text
T1: User removed from team.
T2: User approves case through team relation.
```

Jika removal belum terlihat oleh authorization check, user mungkin masih bisa approve.

Pertanyaan desain:

1. Apakah revocation harus immediate?
2. Apakah stale allow selama beberapa detik dapat diterima?
3. Apakah sensitive action harus bypass cache?
4. Apakah approval butuh relationship version check?
5. Apakah relationship write dan domain write satu transaksi?

Untuk regulatory action, rekomendasi:

```text
Sensitive mutation: prefer strongly consistent runtime check.
Read/list: boleh pakai bounded stale cache jika risk diterima.
Export/download: treat as sensitive read, jangan terlalu stale.
```

---

## 22. Relationship Lifecycle

Relationship bukan data biasa. Ia adalah authorization fact.

Lifecycle:

```text
requested -> approved -> active -> suspended -> expired -> revoked -> archived
```

Minimal metadata:

```text
created_at
created_by
reason
source_system
valid_from
valid_until
approval_id
revoked_at
revoked_by
revocation_reason
policy_version
```

Contoh table:

```sql
CREATE TABLE relationship_grant (
    id                VARCHAR(64) PRIMARY KEY,
    tenant_id         VARCHAR(100) NOT NULL,
    object_type       VARCHAR(100) NOT NULL,
    object_id         VARCHAR(200) NOT NULL,
    relation_name     VARCHAR(100) NOT NULL,
    subject_type      VARCHAR(100) NOT NULL,
    subject_id        VARCHAR(200) NOT NULL,
    status            VARCHAR(30) NOT NULL,
    valid_from        TIMESTAMP NOT NULL,
    valid_until       TIMESTAMP,
    created_at        TIMESTAMP NOT NULL,
    created_by        VARCHAR(200) NOT NULL,
    approved_at       TIMESTAMP,
    approved_by       VARCHAR(200),
    revoked_at        TIMESTAMP,
    revoked_by        VARCHAR(200),
    reason            VARCHAR(1000),
    source_system     VARCHAR(100) NOT NULL,
    version           BIGINT NOT NULL
);
```

Kenapa tidak cukup tuple table sederhana?

Karena dalam enterprise/regulatory system, kamu sering perlu menjawab:

```text
Siapa yang memberi akses?
Kapan mulai berlaku?
Kapan dicabut?
Berdasarkan approval mana?
Kenapa user ini bisa melihat case pada tanggal X?
```

Tuple sederhana bagus untuk runtime. Grant lifecycle table bagus untuk governance/audit.

Bisa keduanya:

```text
relationship_grant = source of truth governance
relation_tuple = active projection for fast authorization
```

---

## 23. Relationship Write Path

Access tidak boleh berubah tanpa kontrol.

Contoh command:

```text
Assign user to case.
Add user to team.
Make team handler of case.
Delegate case access.
Move document to case.
```

Semua command ini bukan hanya data mutation. Mereka mengubah authorization graph.

Maka harus ada authorization untuk mengubah authorization.

Contoh:

```java
public void assignCase(UserId actor, CaseId caseId, UserId assignee) {
    authorization.authorize(new AuthorizationRequest(
        SubjectRef.user(actor),
        Action.CASE_ASSIGN,
        ResourceRef.caseId(caseId),
        AuthorizationContext.now()
    )).throwIfDenied();

    relationshipWriter.add(
        ObjectRef.caseId(caseId),
        "assignee",
        SubjectRef.user(assignee),
        GrantMetadata.createdBy(actor)
    );
}
```

Prinsip:

> Relationship write adalah privileged operation.

Jangan biarkan sembarang service menulis tuple tanpa policy.

---

## 24. Relationship Validation

Sebelum relationship ditulis, validasi:

1. object exists,
2. subject exists,
3. tenant sama,
4. relation valid untuk object type,
5. subject type valid untuk relation,
6. tidak membuat cycle illegal,
7. tidak melanggar separation of duty,
8. tidak memberi privilege lebih tinggi dari actor,
9. tidak melewati approval requirement,
10. tidak konflik dengan deny/exclusion rule.

Contoh schema rule:

```text
case#assignee accepts user
case#handler_team accepts team
team#member accepts user
document#parent_case accepts case
agency#officer accepts user
```

Jika tidak divalidasi, tuple store bisa berisi relasi absurd:

```text
case:CASE-1#assignee@document:DOC-9
team:TEAM-A#member@case:CASE-1
```

Ini bukan hanya data quality problem. Ini security problem.

---

## 25. Schema sebagai Kontrak Authorization

ReBAC butuh schema.

Contoh schema konseptual:

```text
definition user {}

definition agency {
  relation officer: user
  relation supervisor: user
}

definition team {
  relation member: user
  relation lead: user
}

definition case {
  relation agency: agency
  relation assignee: user
  relation reviewer: user
  relation creator: user
  relation handler_team: team

  permission view = assignee + reviewer + handler_team->member + agency->officer
  permission update = assignee + handler_team->lead
  permission approve = reviewer - creator
  permission assign = agency->supervisor
}

definition document {
  relation parent_case: case

  permission view = parent_case->view
  permission download = parent_case->view
}
```

Walaupun kamu tidak memakai OpenFGA/SpiceDB, schema seperti ini tetap sangat berguna sebagai dokumentasi dan design contract.

Ini bisa disimpan dalam:

```text
authorization-schema.md
authorization-schema.yaml
architecture decision record
policy repository
```

---

## 26. Spring Security Integration Pattern

Jangan memaksa semua ReBAC ke annotation sederhana.

Contoh buruk:

```java
@PreAuthorize("hasRole('CASE_OFFICER')")
public CaseDetail getCase(String caseId) { ... }
```

Ini hanya RBAC.

Lebih baik:

```java
@PreAuthorize("@caseAuthz.canView(authentication, #caseId)")
public CaseDetail getCase(String caseId) {
    return caseService.getCase(caseId);
}
```

Atau lebih eksplisit di service:

```java
public CaseDetail getCase(UserId actor, CaseId caseId) {
    authorizationService.authorize(
        AuthorizationRequest.of(actor, Action.CASE_VIEW, ResourceRef.caseId(caseId))
    ).throwIfDenied();

    return caseRepository.findDetail(caseId);
}
```

Untuk top-level maintainability, prefer:

```text
Controller extracts actor/context.
Application service calls authorization service.
Domain operation assumes authorization already enforced or enforces invariant-sensitive guard.
Repository scopes data access.
```

Method security boleh dipakai, tetapi jangan biarkan SpEL menjadi tempat seluruh policy kompleks.

---

## 27. ReBAC dengan JPA / SQL

JPA entity relationship tidak otomatis sama dengan authorization relationship.

Contoh JPA:

```java
@Entity
public class CaseEntity {
    @ManyToOne
    private AgencyEntity agency;

    @ManyToOne
    private UserEntity assignee;

    @ManyToOne
    private TeamEntity handlerTeam;
}
```

Ini domain relationship. Bisa dipakai untuk authorization, tetapi jangan otomatis dianggap cukup.

Risiko:

1. lazy loading membuat N+1 authorization check,
2. detached entity stale,
3. entity graph terlalu besar,
4. query list sulit,
5. tenant boundary tidak enforced,
6. relation tidak punya lifecycle metadata.

Untuk relation security-critical, lebih baik ada dedicated relationship projection/table.

Contoh:

```text
case.assignee column = operational assignment
relation_tuple case#assignee@user = authorization projection
```

Write path harus sinkron:

```text
assign case transaction:
1. update case assignee
2. write relationship grant
3. write active tuple projection
4. publish audit event
```

Jika memakai outbox:

```text
1. update case assignment
2. write outbox event
3. projector updates relation_tuple
```

Maka harus sadar eventual consistency.

---

## 28. ReBAC dan Event-Driven Architecture

Dalam microservices, relationship bisa tersebar.

Contoh:

```text
User service owns user/team membership.
Case service owns case assignment.
Document service owns document parent.
Authorization service owns relationship projection.
```

Event:

```text
TeamMemberAdded
TeamMemberRemoved
CaseAssigned
CaseHandlerTeamChanged
DocumentMoved
DelegationGranted
DelegationRevoked
```

Authorization service consume event dan update graph.

Failure mode:

1. event lost,
2. event duplicated,
3. event out of order,
4. projection stale,
5. delete not processed,
6. id mapping mismatch,
7. tenant mismatch,
8. rollback tidak terkirim.

Pattern wajib:

1. outbox pattern,
2. idempotent consumer,
3. event version,
4. replay capability,
5. reconciliation job,
6. projection checksum,
7. dead-letter handling,
8. audit difference report.

Untuk authorization, projection drift adalah security incident candidate.

---

## 29. ReBAC dan External Systems: OpenFGA / SpiceDB Style

Sistem Zanzibar-inspired biasanya menggunakan konsep:

```text
authorization model/schema
relationship tuples
check API
write tuple API
list objects/users API
consistency token/revision
```

OpenFGA mendeskripsikan authorization dengan model dan relationship tuples; dokumentasinya menekankan bahwa tuple berisi object, relation, dan user/subject sebagai fakta hubungan. SpiceDB juga memisahkan schema sebagai struktur permission system dan relationship sebagai data relasinya. Google Zanzibar sendiri dipresentasikan sebagai sistem global untuk menyimpan dan mengevaluasi access control list dengan data model dan configuration language seragam untuk banyak layanan Google.

Inspirasi arsitekturalnya:

```text
Application service -> authorization engine -> tuple store/schema -> allow/deny
```

Keuntungan external engine:

1. model terpusat,
2. relation graph reusable lintas service,
3. check API konsisten,
4. policy/schema versioning,
5. advanced traversal,
6. list object/users support,
7. audit dan tooling lebih baik.

Biaya:

1. infra baru,
2. network latency,
3. availability dependency,
4. consistency model harus dipahami,
5. migration effort,
6. developer learning curve,
7. operational complexity.

Prinsip:

> Jangan memakai external ReBAC engine hanya karena modern. Pakai jika problem graph authorization benar-benar melampaui kemampuan domain service biasa.

---

## 30. Java Client Pattern untuk External ReBAC PDP

Contoh interface agar application tidak tergantung vendor:

```java
public interface RelationshipAuthorizationClient {
    CheckResult check(CheckRequest request);

    void writeRelationship(RelationshipWriteRequest request);

    void deleteRelationship(RelationshipDeleteRequest request);

    List<ObjectRef> listObjects(ListObjectsRequest request);
}
```

```java
public final class CheckRequest {
    private final SubjectRef subject;
    private final ObjectRef object;
    private final String permission;
    private final String tenantId;
    private final Map<String, Object> context;

    // constructor + getters
}
```

```java
public final class CheckResult {
    private final boolean allowed;
    private final String reason;
    private final String revision;

    // constructor + getters
}
```

Application service:

```java
public CaseDetail getCase(UserId actor, CaseId caseId) {
    CheckResult result = relationshipAuthz.check(new CheckRequest(
        SubjectRef.user(actor.value()),
        ObjectRef.of("case", caseId.value()),
        "view",
        tenantContext.tenantId(),
        Collections.emptyMap()
    ));

    if (!result.allowed()) {
        throw new AccessDeniedException("CASE_VIEW_DENIED");
    }

    return caseRepository.findDetail(caseId);
}
```

Jangan langsung sebarkan client OpenFGA/SpiceDB ke seluruh service. Bungkus dengan interface internal.

---

## 31. Fail-Closed Design untuk ReBAC PDP

Jika PDP eksternal down, apa yang terjadi?

Decision table:

| Operation | PDP unavailable | Recommended |
|---|---:|---|
| Public read | Maybe allow if not sensitive | Depends |
| Case detail read | Deny or degraded | Prefer deny |
| Export/download | Deny | Fail closed |
| Approve/reject/close | Deny | Fail closed |
| Admin grant access | Deny | Fail closed |
| Background notification | Skip/retry | Do not leak |

Implementation:

```java
public PolicyDecision authorizeWithFailClosed(CheckRequest request) {
    try {
        CheckResult result = client.check(request);
        if (result.allowed()) {
            return PolicyDecision.allow("REB AC_ALLOWED", "Allowed by relationship authorization engine.");
        }
        return PolicyDecision.deny("REB AC_DENIED", "Denied by relationship authorization engine.");
    } catch (TimeoutException ex) {
        return PolicyDecision.deny("AUTHZ_PDP_TIMEOUT", "Authorization service timeout.");
    } catch (RuntimeException ex) {
        return PolicyDecision.deny("AUTHZ_PDP_UNAVAILABLE", "Authorization service unavailable.");
    }
}
```

Catatan: reason code sebaiknya tanpa spasi, misalnya `REBAC_ALLOWED`, bukan `REB AC_ALLOWED`. Pisahkan user-facing message dan internal reason.

---

## 32. Caching ReBAC Decisions

Caching ReBAC berbahaya jika key salah.

Cache key minimal:

```text
tenant_id
subject_type
subject_id
object_type
object_id
permission
authorization_schema_version
relationship_revision_or_version
context_hash_if_contextual
```

Jangan cache hanya:

```text
userId + permission
```

Karena ReBAC object-specific.

Contoh salah:

```text
fajar can view case = true
```

Harus:

```text
fajar can view case CASE-1 = true under tenant CEA at relation revision R123
```

Negative cache juga hati-hati:

```text
User denied sekarang, lalu diberi access 1 detik kemudian.
Negative cache yang terlalu lama membuat user tetap denied.
```

Sensitive mutation sebaiknya:

1. no decision cache, atau
2. very short TTL, atau
3. use relationship revision consistency.

---

## 33. Bulk Check dan N+1 Problem

List screen:

```text
100 cases displayed.
Need canView/canEdit/canApprove badges.
```

Naif:

```java
for each case:
  check canView
  check canEdit
  check canApprove
```

300 network calls.

Lebih baik:

1. bulk check API,
2. list objects API,
3. precomputed authorization projection,
4. query scoping,
5. decision batching.

Internal API:

```java
public interface BulkAuthorizationService {
    Map<AuthorizationRequestKey, PolicyDecision> authorizeAll(List<AuthorizationRequest> requests);
}
```

UI tidak selalu perlu semua permission. Jangan over-check.

Contoh:

```text
List page: only view/update affordance.
Detail page: detailed action-level check.
Submit action: final runtime check.
```

---

## 34. ReBAC dan Search Index

Search index seperti OpenSearch/Elasticsearch sering bocor jika authorization tidak masuk filter.

Pilihan:

1. index hanya data public untuk tenant,
2. index dengan access control fields,
3. query-time filter berdasarkan authorized object IDs,
4. post-filter plus final check untuk small result only,
5. materialized access index.

Bahaya:

```text
Search result title/snippet menampilkan data unauthorized walaupun detail page protected.
```

Prinsip:

> Search result itself is data access.

Jika user tidak boleh view case, user juga tidak boleh melihat case itu muncul di hasil search, kecuali policy eksplisit memperbolehkan metadata exposure.

---

## 35. ReBAC dan Audit

Audit decision ReBAC harus menyimpan:

```text
request_id
correlation_id
tenant_id
subject
action/resource/permission
object
context snapshot
schema version
relationship revision
allowed/denied
reason code
decision path if allowed
failed paths if safe
PDP latency
PDP source
cache hit/miss
```

Contoh audit JSON:

```json
{
  "requestId": "REQ-20260619-001",
  "tenantId": "CEA",
  "subject": "user:fajar",
  "permission": "case.view",
  "object": "case:CASE-100",
  "allowed": true,
  "reasonCode": "CASE_HANDLER_TEAM_MEMBER",
  "schemaVersion": "authz-schema-2026-06-19.1",
  "relationshipRevision": "rev-882991",
  "path": [
    "case:CASE-100#handler_team@team:compliance-a",
    "team:compliance-a#member@user:fajar"
  ],
  "latencyMs": 7,
  "cache": "MISS"
}
```

Untuk denial, jangan selalu expose path ke user. Namun simpan internal audit reason yang cukup.

---

## 36. Testing ReBAC

### 36.1 Unit Test Direct Relation

```java
@Test
public void assigneeCanViewCase() {
    tuples.add("case", "CASE-1", "assignee", "user", "fajar");

    boolean allowed = policy.canViewCase("CASE-1", "fajar");

    assertTrue(allowed);
}
```

---

### 36.2 Traversal Test

```java
@Test
public void teamMemberCanViewHandledCase() {
    tuples.add("case", "CASE-1", "handler_team", "team", "compliance-a");
    tuples.add("team", "compliance-a", "member", "user", "fajar");

    boolean allowed = policy.canViewCase("CASE-1", "fajar");

    assertTrue(allowed);
}
```

---

### 36.3 Exclusion Test

```java
@Test
public void creatorCannotApproveOwnCaseEvenIfReviewer() {
    tuples.add("case", "CASE-1", "creator", "user", "fajar");
    tuples.add("case", "CASE-1", "reviewer", "user", "fajar");

    boolean allowed = policy.canApproveCase("CASE-1", "fajar");

    assertFalse(allowed);
}
```

---

### 36.4 Tenant Boundary Test

```java
@Test
public void relationAcrossTenantMustNotGrantAccess() {
    tuples.add("tenant-a", "case", "CASE-1", "agency", "agency", "AGENCY-X");
    tuples.add("tenant-b", "agency", "AGENCY-X", "officer", "user", "fajar");

    boolean allowed = policy.canViewCase("tenant-a", "CASE-1", "fajar");

    assertFalse(allowed);
}
```

---

### 36.5 Cycle Test

```java
@Test
public void cyclicFolderHierarchyDoesNotCauseInfiniteTraversal() {
    tuples.add("folder", "A", "parent", "folder", "B");
    tuples.add("folder", "B", "parent", "folder", "A");

    Decision decision = policy.canViewFolder("A", "fajar");

    assertFalse(decision.allowed());
    assertEquals("RELATIONSHIP_CYCLE_DETECTED", decision.reasonCode());
}
```

---

### 36.6 Revocation Test

```java
@Test
public void removedTeamMemberCannotUsePreviousTeamAccess() {
    tuples.add("case", "CASE-1", "handler_team", "team", "compliance-a");
    tuples.add("team", "compliance-a", "member", "user", "fajar");

    assertTrue(policy.canViewCase("CASE-1", "fajar"));

    tuples.remove("team", "compliance-a", "member", "user", "fajar");

    assertFalse(policy.canViewCase("CASE-1", "fajar"));
}
```

---

## 37. ReBAC Threat Model

Threats:

1. Attacker creates relationship tuple directly.
2. Attacker modifies resource parent to inherit access.
3. Attacker adds self to group/team.
4. Attacker exploits stale cache after revocation.
5. Attacker uses old token with stale relation claim.
6. Attacker triggers async job that bypasses ReBAC.
7. Attacker searches unauthorized metadata.
8. Attacker exploits IDOR endpoint not using object check.
9. Attacker abuses delegation without expiry.
10. Attacker creates cycle to cause DoS.
11. Attacker uses cross-tenant relation ID collision.
12. Attacker exploits overly broad group nesting.

Mitigations:

1. protect relationship write path,
2. validate schema and tenant boundary,
3. audit all relationship mutations,
4. use fail-closed checks for sensitive operations,
5. enforce final check before mutation,
6. set cache TTL carefully,
7. use relationship revision for consistency,
8. add cycle detection,
9. limit traversal depth,
10. use bulk/list authorization correctly,
11. include authorization in search/export/report,
12. run periodic access review.

---

## 38. When ReBAC is the Right Choice

Gunakan ReBAC jika:

1. access tergantung assignment user-resource,
2. access diwariskan dari parent resource,
3. access berasal dari team/group membership,
4. group bisa nested,
5. resource hierarchy penting,
6. delegation/acting authority penting,
7. tenant/org/agency relationship kompleks,
8. permission harus dihitung dari graph,
9. role explosion mulai terjadi,
10. object-level authorization dominan,
11. banyak service butuh authorization semantics yang sama,
12. audit harus menjelaskan path access.

---

## 39. When ReBAC is Overkill

ReBAC mungkin berlebihan jika:

1. aplikasi kecil dengan 3 role global,
2. tidak ada object-level permission,
3. tidak ada team/group hierarchy,
4. tidak ada sharing/delegation,
5. policy jarang berubah,
6. semua access cukup tenant + role,
7. team belum siap mengoperasikan graph/PDP,
8. list/search authorization tidak kompleks,
9. latency budget sangat ketat dan model sederhana.

Dalam kasus seperti ini:

```text
RBAC + tenant scoping + beberapa ABAC check mungkin cukup.
```

Top 1% engineering bukan memakai model paling advanced. Top 1% engineering adalah memilih model paling tepat dengan risiko paling kecil.

---

## 40. ReBAC Design Checklist

Sebelum implementasi ReBAC, jawab:

### Domain

1. Entitas apa saja yang menjadi object?
2. Entitas apa saja yang bisa menjadi subject?
3. Relation apa saja yang valid?
4. Permission apa saja yang dihitung dari relation?
5. Apakah ada hierarchy?
6. Apakah ada group nesting?
7. Apakah ada delegation?
8. Apakah ada tenant boundary?
9. Apakah ada SoD/maker-checker?
10. Apakah ada temporal/contextual condition?

### Runtime

1. Point check latency target berapa?
2. List/search authorization bagaimana?
3. Bulk check diperlukan?
4. Cache boleh stale berapa lama?
5. Sensitive action harus strongly consistent?
6. Apa fail behavior saat PDP unavailable?
7. Bagaimana audit decision disimpan?

### Data

1. Relationship source of truth di mana?
2. Relationship projection di mana?
3. Bagaimana write path divalidasi?
4. Bagaimana revocation diproses?
5. Bagaimana event replay/reconciliation?
6. Bagaimana schema versioning?
7. Bagaimana migrate relationship model?

### Security

1. Siapa boleh membuat relation?
2. Siapa boleh menghapus relation?
3. Apakah relation mutation butuh approval?
4. Apakah relationship graph bisa cycle?
5. Apakah tenant crossing mungkin?
6. Apakah broad group bisa memberi privilege terlalu besar?
7. Apakah search/export/report memakai authorization yang sama?

---

## 41. Production Readiness Checklist

Sebelum ReBAC production:

```text
[ ] Authorization schema terdokumentasi.
[ ] Relation naming convention disepakati.
[ ] Object type dan subject type tervalidasi.
[ ] Tenant boundary enforced.
[ ] Relationship write path protected.
[ ] Relationship mutation audited.
[ ] Revocation path tested.
[ ] Cycle detection tersedia jika hierarchy/nesting ada.
[ ] Max traversal depth ditentukan.
[ ] Point check performance diuji.
[ ] Bulk/list strategy jelas.
[ ] Search/export/report tidak bypass.
[ ] Sensitive mutation fail-closed.
[ ] PDP/cache failure behavior jelas.
[ ] Decision audit menyimpan schema/revision/path.
[ ] Integration tests mencakup allow dan deny.
[ ] Negative tests untuk cross-tenant, creator-approve, stale delegation.
[ ] Reconciliation job tersedia untuk projection drift.
[ ] Admin UI/ops punya visibility ke effective access.
```

---

## 42. Common Anti-Patterns

### 42.1 Menyebut ReBAC tetapi Implementasinya Role Check

```java
if (user.hasRole("CASE_VIEWER")) allow();
```

Ini bukan ReBAC.

---

### 42.2 Relationship Tanpa Lifecycle

```text
case:CASE-1#viewer@user:fajar
```

Tapi tidak ada:

```text
created_by
reason
valid_until
revoked_at
```

Untuk enterprise, ini akan menyulitkan audit.

---

### 42.3 Graph Traversal Tanpa Boundary

```text
parent->parent->parent->viewer
```

Tanpa max depth/cycle detection dapat menjadi DoS atau leakage.

---

### 42.4 Relationship Store Menjadi Dumping Ground

Semua hal dimasukkan sebagai relation:

```text
user#age@value:30
user#country@value:ID
case#status@value:OPEN
```

Atribut bukan selalu relation. Jangan mengubah ReBAC menjadi graph sampah.

Gunakan ABAC untuk attribute yang memang attribute.

---

### 42.5 Permission Derived dari Parent Tanpa Sensitivity Check

```text
document.view = folder->view
```

Lalu dokumen confidential masuk folder public.

Perlu sensitivity/classification guard.

---

### 42.6 Hanya Point Check, Lupa List Check

Detail endpoint aman, tapi list/search bocor.

---

### 42.7 Menganggap External PDP Menghapus Tanggung Jawab Aplikasi

PDP memberi decision. Aplikasi tetap harus:

1. memanggil PDP di semua path,
2. enforce deny,
3. scope query,
4. audit,
5. handle failure,
6. validate relationship writes.

---

## 43. Top 1% Insight

Engineer biasa bertanya:

> “Role apa yang dibutuhkan endpoint ini?”

Engineer kuat bertanya:

> “Relasi apa antara actor dan resource yang membuat action ini sah?”

Engineer top-tier bertanya lebih jauh:

1. Apakah relasi itu fakta domain atau shortcut teknis?
2. Siapa sumber kebenaran relasi itu?
3. Siapa boleh mengubah relasi itu?
4. Apakah relasi punya lifecycle?
5. Apakah relasi bisa cross-tenant?
6. Apakah relasi diwariskan?
7. Apakah ada exception atau separation of duty?
8. Apakah list/search/export memakai model yang sama?
9. Apakah decision bisa dijelaskan 1 tahun kemudian?
10. Apakah revocation benar-benar berlaku saat dibutuhkan?

ReBAC bukan sekadar teknik authorization. ReBAC adalah cara memodelkan **struktur sosial, organisasi, kepemilikan, assignment, dan tanggung jawab** ke dalam sistem akses.

Dalam regulatory/case management system, ini sangat kuat karena authorization sering bergantung pada:

```text
siapa menangani case,
siapa supervisor,
siapa reviewer,
siapa pemilik agency,
siapa mendapat delegation,
case berada di state apa,
document berada di bawah case apa,
dan apakah actor boleh melakukan transition tertentu.
```

RBAC saja tidak cukup untuk itu. ABAC bisa membantu, tetapi jika relasinya dominan, ReBAC memberi model yang lebih natural.

---

## 44. Ringkasan

ReBAC adalah model authorization berbasis relasi.

Inti ReBAC:

```text
subject --relation/path--> resource => permission
```

Komponen penting:

1. object,
2. subject,
3. relation,
4. tuple,
5. permission,
6. userset,
7. traversal,
8. schema,
9. decision path.

ReBAC unggul untuk:

1. object-level authorization,
2. group/team access,
3. resource hierarchy,
4. organization hierarchy,
5. delegation,
6. ownership,
7. assignment,
8. maker-checker,
9. cross-service fine-grained authorization.

Tantangan ReBAC:

1. graph traversal performance,
2. list/search authorization,
3. consistency,
4. cache invalidation,
5. relationship lifecycle,
6. auditability,
7. tenant boundary,
8. schema governance,
9. operational complexity.

Prinsip desain:

```text
Model relasi sebagai fakta domain.
Hitung permission dari relasi.
Lindungi mutation relasi.
Audit decision path.
Fail closed untuk action sensitif.
Jangan lupa list/search/export.
```

---

## 45. Referensi

1. Google Research — **Zanzibar: Google's Consistent, Global Authorization System**. Paper ini mempresentasikan desain dan deployment sistem global untuk menyimpan dan mengevaluasi access control list dengan model data dan configuration language seragam untuk banyak layanan Google.  
   <https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/>

2. OpenFGA Documentation — **Authorization Concepts**. Dokumentasi OpenFGA menjelaskan ReBAC sebagai authorization yang bergantung pada relasi antara users dan objects, serta relasi antar objects.  
   <https://openfga.dev/docs/authorization-concepts>

3. OpenFGA Documentation — **Managing User Access**. Menjelaskan relationship tuple sebagai inti pemberian akses: authorization model mendefinisikan relasi yang mungkin, relationship tuples merepresentasikan fakta relasi.  
   <https://openfga.dev/docs/interacting/managing-user-access>

4. Authzed SpiceDB Documentation — **Relationships**. Menjelaskan bahwa permission system di SpiceDB terdiri dari schema sebagai struktur dan relationships sebagai data.  
   <https://authzed.com/docs/spicedb/concepts/relationships>

5. Authzed SpiceDB Documentation — **Schema Language Reference**. Menjelaskan schema sebagai definisi object types, relation antar object, dan permissions yang dihitung dari relation.  
   <https://authzed.com/docs/spicedb/concepts/schema>

6. CNCF — **OpenFGA Project Page**. OpenFGA adalah authorization/permission system yang terinspirasi Google Zanzibar dan telah masuk CNCF.  
   <https://www.cncf.io/projects/openfga/>

7. Syed Zain Rizvi, Philip W. L. Fong, Jason Crampton, James Sellwood — **Relationship-Based Access Control for OpenMRS**. Paper ini membahas penerapan ReBAC di sistem medical records dengan backward compatibility terhadap RBAC legacy.  
   <https://arxiv.org/abs/1503.06154>

---

## 46. Status Seri

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
```

Belum selesai. Part berikutnya:

```text
[ ] Part 9 — ACL and Domain Object Security
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-007.md">⬅️ Java Authorization Modes and Patterns — Part 7</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-009.md">Part 9 — ACL and Domain Object Security ➡️</a>
</div>
