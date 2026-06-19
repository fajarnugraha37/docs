# learn-java-authorization-modes-and-patterns-part-000

# Part 0 — Authorization Mental Model: From “Role Check” to Decision System

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Target: Java 8 hingga Java 25  
> Fokus part ini: membangun fondasi berpikir authorization sebagai **sistem keputusan**, bukan sekadar `hasRole("ADMIN")`.

---

## 0. Ringkasan Eksekutif

Authorization adalah proses menjawab pertanyaan:

> **Apakah subject S boleh melakukan action A terhadap resource R dalam context C berdasarkan policy P, evidence E, dan state sistem saat ini?**

Banyak sistem enterprise gagal bukan karena tidak punya authorization, tetapi karena authorization diperlakukan sebagai potongan kode kecil yang tersebar:

```java
if (user.isAdmin()) {
    // allow
}
```

atau:

```java
@PreAuthorize("hasRole('MANAGER')")
```

Padahal pada sistem nyata, terutama sistem regulatory, workflow, case management, financial, government, healthcare, SaaS multi-tenant, atau distributed microservices, authorization bukan hanya pertanyaan “role apa user ini?”, tetapi gabungan dari:

- siapa aktornya,
- bertindak sebagai siapa,
- apa aksi bisnisnya,
- resource mana yang disentuh,
- resource itu milik siapa,
- berada pada state apa,
- tenant/agency/department mana,
- apakah ada assignment,
- apakah ada conflict of interest,
- apakah action ini bagian dari state transition valid,
- apakah butuh maker-checker,
- apakah akses ini temporary/delegated,
- apakah decision bisa diaudit ulang di masa depan,
- apakah decision tetap benar ketika data berubah,
- apakah enforcement terjadi di semua jalur, bukan hanya UI/API utama.

Di level top engineer, authorization diperlakukan sebagai **domain-critical invariant** dan **decision architecture**.

---

## 1. Mengapa Authorization Harus Dipelajari Terpisah dari Authentication

Authentication menjawab:

> **Siapa kamu?**

Authorization menjawab:

> **Apa yang boleh kamu lakukan?**

Keduanya berhubungan, tetapi problem domain-nya berbeda.

Authentication menghasilkan identity evidence, misalnya:

- user id,
- username,
- subject id,
- email,
- principal,
- group,
- token claim,
- authentication method,
- session,
- client id,
- assurance level.

Authorization memakai evidence tersebut sebagai input, tetapi tidak boleh berhenti di sana.

Contoh:

```text
User sudah login sebagai officer.
```

Itu authentication + identity state.

Tetapi authorization masih harus menjawab:

```text
Apakah officer ini boleh melihat case #CASE-123?
Apakah officer ini assigned ke case tersebut?
Apakah case tersebut berasal dari agency yang sama?
Apakah case tersebut sedang dalam state yang bisa diedit?
Apakah officer ini juga submitter sehingga tidak boleh approve?
Apakah akses ini dilakukan melalui channel yang valid?
```

### 1.1 Kesalahan Umum

Kesalahan paling umum adalah menganggap token/role sudah cukup.

Misalnya JWT berisi:

```json
{
  "sub": "u123",
  "roles": ["CASE_OFFICER"]
}
```

Lalu backend mengizinkan:

```java
if (roles.contains("CASE_OFFICER")) {
    return caseRepository.findById(caseId);
}
```

Masalahnya: role `CASE_OFFICER` hanya menjawab bahwa user punya kapasitas umum sebagai officer. Role tersebut tidak membuktikan bahwa user boleh mengakses **object instance tertentu**.

Correct thinking:

```text
CASE_OFFICER boleh mengakses case hanya jika:
1. case berada dalam agency yang sama,
2. user assigned ke case atau berada dalam supervisory chain,
3. case tidak berada dalam sealed/restricted state,
4. action yang diminta sesuai dengan transition rule,
5. tidak ada separation-of-duty violation.
```

Authorization selalu membutuhkan hubungan antara **subject-action-resource-context**.

---

## 2. Authorization Sebagai Decision System

Authorization sebaiknya dimodelkan sebagai sistem keputusan.

Minimal komponennya:

```text
Subject  +  Action  +  Resource  +  Context  +  Policy  +  Evidence
   \          |          |            |           |           /
    \         |          |            |           |          /
     ---------------- Authorization Decision ----------------
                         |
                         v
                 PERMIT / DENY / ABSTAIN / ERROR
```

### 2.1 Subject

Subject adalah entitas yang meminta akses.

Subject tidak selalu manusia.

Contoh subject:

- end user,
- officer,
- supervisor,
- admin,
- service account,
- batch job,
- integration client,
- AI agent,
- delegated user,
- support operator,
- external agency user.

Dalam Java/Spring, subject sering muncul sebagai:

```java
Authentication authentication
```

Dalam Jakarta EE, subject sering muncul sebagai:

```java
Principal principal
```

Dalam domain model yang lebih matang, subject sebaiknya tidak direpresentasikan hanya sebagai string username.

Contoh model sederhana:

```java
public final class SubjectRef {
    private final String subjectId;
    private final SubjectType type;
    private final String tenantId;
    private final Set<String> roles;
    private final Set<String> permissions;
    private final Map<String, String> attributes;

    // constructor, getters
}
```

Namun hati-hati: menyimpan roles/permissions di object subject bukan berarti decision hanya berdasarkan itu. Roles/permissions hanyalah evidence.

### 2.2 Action

Action adalah operasi yang ingin dilakukan.

Action yang buruk biasanya terlalu teknis:

```text
READ
WRITE
UPDATE
DELETE
```

Action yang lebih baik merepresentasikan intention bisnis:

```text
case.view
case.assign
case.reassign
case.submitAssessment
case.approveRecommendation
case.rejectApplication
case.exportReport
case.downloadAttachment
appeal.lodge
appeal.review
appeal.decide
```

Kenapa ini penting?

Karena authorization bukan sekadar CRUD. Dua action sama-sama `UPDATE`, tetapi risk dan rule-nya berbeda:

```text
update phone number        -> low risk
update enforcement outcome -> high risk
approve own recommendation -> forbidden
reopen closed case         -> special privilege
```

Top engineer mendesain permission/action vocabulary berdasarkan business capability, bukan database operation.

### 2.3 Resource

Resource adalah objek yang ingin diakses.

Resource bisa berupa:

- case,
- application,
- appeal,
- document,
- report,
- user profile,
- payment record,
- audit trail,
- workflow task,
- message,
- tenant,
- configuration,
- API endpoint,
- file,
- search result,
- export job.

Resource punya dua level:

```text
Resource Type     : Case
Resource Instance : Case #CASE-123
```

Banyak sistem hanya mengamankan resource type:

```text
CASE_OFFICER boleh akses Case API.
```

Tetapi gagal mengamankan resource instance:

```text
CASE_OFFICER A tidak boleh membaca case milik agency B.
```

Inilah akar dari IDOR/BOLA.

### 2.4 Context

Context adalah situasi saat keputusan dibuat.

Contoh context:

- tenant id,
- agency id,
- department id,
- request channel,
- IP/network zone,
- time,
- device posture,
- risk score,
- authentication strength,
- workflow state,
- acting role,
- delegation id,
- correlation id,
- transaction boundary,
- feature flag,
- environment,
- data classification.

Context sering menjadi pembeda antara authorization sederhana dan authorization enterprise.

Contoh:

```text
Officer boleh edit case hanya jika case masih Draft atau Returned.
Officer tidak boleh edit jika case sudah Submitted for Approval.
Supervisor boleh approve hanya jika bukan pembuat recommendation.
Support admin boleh view metadata, tetapi tidak boleh view full personal data kecuali break-glass aktif.
```

### 2.5 Policy

Policy adalah aturan yang menentukan decision.

Policy bisa hidup di:

- annotation,
- Java code,
- database table,
- configuration,
- rule engine,
- external PDP,
- OPA/Rego,
- Cedar-style policy,
- ACL table,
- relationship graph,
- workflow definition,
- organization hierarchy.

Policy yang matang harus:

- eksplisit,
- testable,
- reviewable,
- versioned,
- auditable,
- evolvable,
- tidak ambigu.

### 2.6 Evidence

Evidence adalah data yang dipakai untuk membuktikan decision.

Contoh evidence:

```text
User u123 has role CASE_OFFICER.
User u123 belongs to agency A.
Case c456 belongs to agency A.
Case c456 is assigned to u123.
Case c456 state is RETURNED.
User u123 is not the submitter.
Policy version is 2026.06.19-authorization-policy-v3.
```

Decision yang baik bukan hanya:

```text
allowed = true
```

Tetapi bisa dijelaskan:

```text
allowed = true
reason = CASE_OFFICER_ASSIGNED_TO_RETURNED_CASE
policyVersion = v3
subjectSnapshot = ...
resourceSnapshot = ...
contextSnapshot = ...
```

Ini penting untuk audit, debugging, compliance, dan incident response.

---

## 3. Decision Output: Jangan Hanya Boolean

Banyak kode authorization dimulai seperti ini:

```java
boolean allowed = authorizationService.canEditCase(user, caseId);
```

Ini berguna, tetapi tidak cukup untuk sistem kompleks.

Boolean kehilangan informasi:

- kenapa allowed,
- kenapa denied,
- apakah deny karena user tidak punya role,
- apakah deny karena resource tidak ditemukan,
- apakah deny karena tenant mismatch,
- apakah deny karena state invalid,
- apakah deny karena policy service error,
- apakah ada obligation tambahan,
- apakah perlu masking,
- apakah perlu step-up authorization,
- apakah keputusan harus diaudit.

Model yang lebih baik:

```java
public final class AuthorizationDecision {
    private final DecisionEffect effect;
    private final String reasonCode;
    private final String policyId;
    private final String policyVersion;
    private final Map<String, Object> evidence;
    private final List<Obligation> obligations;

    public boolean isPermit() {
        return effect == DecisionEffect.PERMIT;
    }
}

public enum DecisionEffect {
    PERMIT,
    DENY,
    ABSTAIN,
    ERROR
}
```

### 3.1 PERMIT

`PERMIT` berarti policy secara eksplisit mengizinkan.

Contoh:

```text
User u123 can perform case.update on case c456 because:
- user has permission case.update,
- user is assigned officer,
- case is in RETURNED state,
- agency matches,
- no separation-of-duty violation.
```

### 3.2 DENY

`DENY` berarti policy secara eksplisit menolak.

Contoh:

```text
User cannot approve own recommendation.
```

Deny lebih kuat daripada absence of permit.

### 3.3 ABSTAIN

`ABSTAIN` berarti policy tersebut tidak berlaku atau tidak bisa mengambil keputusan.

Contoh:

```text
Policy CaseAssignmentPolicy only applies to Case resource.
Request resource type is Report.
```

Dalam decision combiner, abstain perlu digabungkan dengan policy lain.

### 3.4 ERROR

`ERROR` berarti decision tidak bisa dibuat karena kegagalan sistem.

Contoh:

- resource attribute service down,
- policy bundle corrupt,
- tenant resolver missing,
- user context invalid,
- database timeout.

Untuk security-sensitive operation, error umumnya harus fail-closed.

```text
ERROR != PERMIT
```

---

## 4. Authorization Bukan UI Concern

UI boleh menyembunyikan tombol, tetapi UI bukan enforcement boundary.

Contoh UI:

```text
Jika user tidak punya permission approve, tombol Approve disembunyikan.
```

Itu bagus untuk UX.

Tetapi attacker bisa tetap memanggil API:

```http
POST /api/cases/CASE-123/approve
```

Maka backend tetap wajib enforce authorization.

OWASP menekankan bahwa access control efektif hanya jika ditegakkan pada trusted server-side code, bukan metadata yang bisa dimodifikasi client. Broken access control juga secara konsisten menjadi risiko teratas dalam OWASP Top 10 modern. Lihat referensi OWASP pada bagian akhir.

Mental model:

```text
UI authorization = guidance
Backend authorization = enforcement
Database/persistence scoping = defense-in-depth
Audit = accountability
```

---

## 5. Authorization Sebagai Business Invariant

Authorization bukan hanya security technical check. Ia sering merupakan business invariant.

Contoh invariant:

```text
A user must not approve a case they submitted.
```

Ini bukan sekadar rule security. Ini rule governance.

Contoh lain:

```text
Only the assigned officer can update investigation notes while the case is in Investigation state.
```

```text
A supervisor can return a recommendation but cannot alter the officer's submitted assessment directly.
```

```text
An agency user must never view another agency's restricted records unless an explicit cross-agency sharing record exists.
```

Kalau invariant ini rusak, dampaknya bukan hanya “bug”; bisa menjadi:

- regulatory breach,
- privacy breach,
- conflict of interest,
- invalid approval,
- audit finding,
- legal challenge,
- data leakage,
- privilege escalation,
- loss of trust.

### 5.1 Authorization Invariant Format

Gunakan format berikut:

```text
Subject with capability C may perform action A on resource R only if condition set K holds.
```

Contoh:

```text
A case officer may update a case assessment only if:
1. the officer is assigned to the case,
2. the case belongs to the officer's agency,
3. the case state is Draft or Returned,
4. the officer is not acting under a revoked delegation,
5. the case is not locked by an active approval workflow.
```

Dengan format ini, authorization menjadi bisa:

- didiskusikan dengan BA/security/business owner,
- diturunkan menjadi policy,
- diterjemahkan menjadi test case,
- diaudit,
- direview saat perubahan requirement.

---

## 6. Authorization Dimensions

Authorization yang matang biasanya memiliki beberapa dimensi sekaligus.

### 6.1 Identity Dimension

```text
Siapa subject-nya?
```

Contoh:

- user id,
- service id,
- client id,
- external party,
- internal staff,
- support operator.

### 6.2 Role Dimension

```text
Kapasitas umum apa yang dimiliki subject?
```

Contoh:

- CASE_OFFICER,
- SUPERVISOR,
- ADMIN,
- FINANCE_REVIEWER,
- LEGAL_OFFICER.

### 6.3 Permission Dimension

```text
Aksi spesifik apa yang dimiliki subject?
```

Contoh:

- `case.view`,
- `case.updateAssessment`,
- `case.approve`,
- `case.reassign`,
- `report.export`.

### 6.4 Resource Dimension

```text
Resource mana yang disentuh?
```

Contoh:

- Case #123,
- Appeal #99,
- Report #2026-01,
- Document #D-123.

### 6.5 Ownership / Relationship Dimension

```text
Apa hubungan subject dengan resource?
```

Contoh:

- owner,
- assigned officer,
- supervisor of assigned officer,
- member of same department,
- creator,
- reviewer,
- delegated approver,
- external collaborator.

### 6.6 State Dimension

```text
Resource sedang berada pada state apa?
```

Contoh:

- Draft,
- Submitted,
- Under Review,
- Returned,
- Approved,
- Closed,
- Archived,
- Locked.

### 6.7 Context Dimension

```text
Apa situasi request saat ini?
```

Contoh:

- via internet/intranet,
- during office hours,
- from trusted network,
- using high assurance login,
- under break-glass access,
- as delegated actor.

### 6.8 Data Classification Dimension

```text
Seberapa sensitif data yang diminta?
```

Contoh:

- public,
- internal,
- confidential,
- restricted,
- personal data,
- investigation-sensitive,
- legally privileged.

### 6.9 Operation Risk Dimension

```text
Seberapa besar dampak action ini?
```

Contoh:

- read metadata,
- read sensitive details,
- update draft,
- approve decision,
- delete record,
- export bulk data,
- change policy,
- impersonate user.

Top engineer tidak memodelkan authorization hanya satu dimensi.

---

## 7. Authorization Modes: Peta Besar

Part berikutnya akan membahas tiap mode secara dalam. Pada Part 0, kita butuh peta mental dulu.

### 7.1 RBAC — Role-Based Access Control

Pertanyaan utama:

```text
Role apa yang dimiliki subject?
```

Contoh:

```text
CASE_OFFICER can create case note.
SUPERVISOR can approve case.
ADMIN can manage users.
```

Kelebihan:

- sederhana,
- familiar,
- mudah dijelaskan,
- mudah di-cache,
- cocok untuk permission kasar.

Kelemahan:

- role explosion,
- tidak cukup untuk object-level authorization,
- sulit menangani context/state,
- sering menjadi terlalu powerful.

RBAC tetap penting, tetapi jarang cukup sendirian.

### 7.2 Permission-Based Authorization

Pertanyaan utama:

```text
Permission spesifik apa yang dimiliki subject?
```

Contoh:

```text
case.view
case.update
case.approve
report.export
```

Kelebihan:

- lebih granular dari role,
- lebih stabil untuk API,
- role bisa menjadi kumpulan permission.

Kelemahan:

- permission terlalu banyak jika tidak didesain dengan benar,
- masih tidak otomatis menyelesaikan object-level rule.

### 7.3 ABAC — Attribute-Based Access Control

Pertanyaan utama:

```text
Apakah attribute subject/resource/context memenuhi policy?
```

Contoh:

```text
subject.agencyId == resource.agencyId
resource.classification <= subject.clearanceLevel
context.channel == INTRANET
```

Kelebihan:

- ekspresif,
- cocok untuk policy dinamis,
- cocok untuk enterprise context.

Kelemahan:

- sulit diaudit jika tidak disiplin,
- membutuhkan data attribute yang reliable,
- bisa lambat jika attribute tersebar.

### 7.4 ACL — Access Control List

Pertanyaan utama:

```text
Apakah subject ada dalam daftar akses resource ini?
```

Contoh:

```text
Case #123:
- u1: READ
- u2: READ, WRITE
- group:supervisors: APPROVE
```

Kelebihan:

- bagus untuk object instance permission,
- eksplisit,
- familiar untuk file/document-like resource.

Kelemahan:

- mahal untuk resource besar,
- sulit untuk query/filtering,
- bisa rumit dalam inheritance.

### 7.5 ReBAC — Relationship-Based Access Control

Pertanyaan utama:

```text
Apa relasi subject dengan resource?
```

Contoh:

```text
user is member of team T
team T owns project P
project P contains document D
therefore user can view document D
```

Kelebihan:

- kuat untuk graph relationship,
- cocok untuk hierarchy dan collaboration,
- bisa menangani delegation dan membership.

Kelemahan:

- consistency dan performance menantang,
- butuh model relasi yang matang.

### 7.6 PBAC — Policy-Based Access Control

Pertanyaan utama:

```text
Apa hasil evaluasi policy terhadap input request?
```

Contoh policy pseudo:

```text
permit if
  principal.role == "Supervisor" and
  action == "case.approve" and
  resource.state == "Submitted" and
  resource.submittedBy != principal.id
```

Kelebihan:

- policy bisa dieksternalisasi,
- bisa direview dan dites terpisah,
- cocok untuk sistem besar.

Kelemahan:

- butuh governance,
- butuh tooling,
- bisa over-engineered untuk aplikasi kecil.

### 7.7 Risk-Based Authorization

Pertanyaan utama:

```text
Apakah situasi ini cukup aman untuk action ini?
```

Contoh:

```text
Export bulk personal data requires high assurance session and trusted network.
```

### 7.8 Workflow/State-Based Authorization

Pertanyaan utama:

```text
Apakah action ini valid pada state resource saat ini untuk actor ini?
```

Contoh:

```text
Only reviewer can return case from UnderReview to Returned.
Only assigned officer can resubmit Returned case.
```

Ini sangat penting untuk case management.

---

## 8. Authorization is Not Just “Can Access Endpoint”

Endpoint-level authorization hanya menjawab:

```text
Boleh masuk ke URL ini?
```

Tetapi authorization yang benar harus menjawab beberapa lapis:

```text
Boleh masuk endpoint ini?
Boleh menjalankan action ini?
Boleh terhadap resource ini?
Boleh pada field ini?
Boleh melihat data hasil query ini?
Boleh mengubah state ini?
Boleh melakukan action ini sekarang?
Boleh atas nama pihak lain?
Boleh melakukan bulk/export?
```

### 8.1 Example: Endpoint Check yang Salah

```java
@PreAuthorize("hasRole('CASE_OFFICER')")
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable String id) {
    return caseService.getCase(id);
}
```

Masalah:

- semua case officer bisa mencoba semua id,
- tidak ada tenant/agency check,
- tidak ada assignment check,
- tidak ada classification check,
- tidak ada state-based restriction.

### 8.2 Improved Thinking

```java
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable String id) {
    Case c = caseService.loadCaseForAuthorization(id);
    authorizationService.authorize(
        AuthorizationRequest.builder()
            .subject(CurrentSubject.required())
            .action(Action.CASE_VIEW)
            .resource(ResourceRef.caseOf(c.getId()))
            .resourceAttributes(CaseAttributes.from(c))
            .context(RequestAuthorizationContext.current())
            .build()
    );
    return caseMapper.toDto(c);
}
```

Bahkan ini belum final, karena query list/search juga harus scoped.

---

## 9. Three Authorization Questions

Dalam desain authorization, selalu pisahkan tiga pertanyaan:

### 9.1 Can the subject perform this type of action?

```text
Apakah user punya capability umum untuk action ini?
```

Contoh:

```text
User punya permission case.approve.
```

### 9.2 Can the subject perform this action on this resource?

```text
Apakah permission tersebut berlaku untuk resource instance ini?
```

Contoh:

```text
User boleh approve case ini karena user supervisor dari assigned officer.
```

### 9.3 Can the subject perform this action in this context right now?

```text
Apakah state/context saat ini memperbolehkan action?
```

Contoh:

```text
Case harus dalam Submitted state.
User tidak boleh approve jika user adalah submitter.
Access tidak boleh dari public network untuk restricted case.
```

Banyak sistem hanya menjawab pertanyaan pertama. Sistem enterprise harus menjawab ketiganya.

---

## 10. Deny by Default

Prinsip dasar:

```text
Anything not explicitly allowed is denied.
```

Ini terdengar sederhana, tetapi implementasinya sering gagal.

### 10.1 Allow-by-Default Anti-Pattern

```java
public boolean canAccess(User user, Resource resource) {
    if (user.hasRole("ADMIN")) {
        return true;
    }

    if (resource.isPublic()) {
        return true;
    }

    // forgot other rules
    return true;
}
```

Default terakhir adalah `true`. Ini berbahaya.

### 10.2 Deny-by-Default Implementation

```java
public AuthorizationDecision decide(AuthorizationRequest request) {
    List<Policy> applicable = policyRegistry.findApplicablePolicies(request);

    if (applicable.isEmpty()) {
        return AuthorizationDecision.deny("NO_APPLICABLE_POLICY");
    }

    DecisionAccumulator acc = new DecisionAccumulator();

    for (Policy policy : applicable) {
        acc.add(policy.evaluate(request));
    }

    return acc.combineDenyOverrides();
}
```

Rule:

```text
No policy -> deny
No permission -> deny
Missing attribute -> deny or error fail-closed
Ambiguous decision -> deny
Policy conflict with explicit deny -> deny
```

---

## 11. Authorization Check Placement

Authorization harus ditempatkan berdasarkan boundary.

### 11.1 API Gateway

Cocok untuk:

- coarse-grained endpoint access,
- token presence,
- client authorization,
- coarse scope check,
- rate limiting,
- network zone control.

Tidak cukup untuk:

- object-level authorization,
- state-based rule,
- business invariant.

### 11.2 Controller / Resource Layer

Cocok untuk:

- endpoint-level action mapping,
- request authorization entry point,
- early rejection,
- mapping error ke HTTP.

Tidak cukup jika business operation bisa dipanggil dari jalur lain.

### 11.3 Service Layer

Cocok untuk:

- business action authorization,
- command authorization,
- state transition guard,
- object-level authorization.

Ini sering menjadi enforcement layer utama di Java enterprise apps.

### 11.4 Domain Layer

Cocok untuk:

- invariant yang melekat pada aggregate,
- transition rule,
- maker-checker,
- state machine guard.

Contoh:

```java
caseAggregate.approveBy(actor);
```

Method tersebut tidak boleh hanya update status; ia harus enforce invariant bisnis.

### 11.5 Repository / Query Layer

Cocok untuk:

- tenant scoping,
- data-level filtering,
- preventing list/search leakage,
- report/export scoping.

Contoh:

```sql
WHERE agency_id = :currentAgencyId
```

### 11.6 Database Layer

Cocok sebagai defense-in-depth:

- row-level security,
- view-based filtering,
- database role separation,
- audit.

Namun jangan bergantung penuh pada DB jika aplikasi punya logic authorization kompleks di atasnya.

---

## 12. Function-Level vs Object-Level Authorization

### 12.1 Function-Level Authorization

Menjawab:

```text
Apakah user boleh memanggil fungsi ini?
```

Contoh:

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approveCase(String caseId) { ... }
```

### 12.2 Object-Level Authorization

Menjawab:

```text
Apakah user boleh melakukan fungsi ini pada object ini?
```

Contoh:

```java
public void approveCase(String caseId) {
    Case c = caseRepository.findById(caseId)
        .orElseThrow(NotFoundException::new);

    authorizationService.authorize(subject, CASE_APPROVE, c);

    c.approve(subject);
}
```

### 12.3 Kenapa Object-Level Lebih Sulit

Object-level membutuhkan data resource sebelum keputusan dibuat.

Masalah:

- harus load resource untuk authorize,
- tetapi load resource sendiri bisa leak existence,
- query list harus filtered,
- bulk operation harus per-object atau predicate-based,
- cache decision harus resource-aware,
- error response harus hati-hati.

---

## 13. IDOR/BOLA Mental Model

IDOR/BOLA terjadi ketika attacker bisa mengganti identifier resource dan sistem tidak mengecek apakah resource itu boleh diakses oleh subject.

Contoh:

```http
GET /api/cases/1001
GET /api/cases/1002
GET /api/cases/1003
```

Jika user hanya boleh akses case 1001 tetapi backend mengembalikan 1002, itu object-level authorization failure.

### 13.1 BOLA Tidak Hanya Read

BOLA bisa terjadi pada:

- read,
- update,
- delete,
- approve,
- submit,
- cancel,
- download,
- export,
- assign,
- comment,
- upload attachment,
- change status.

Contoh lebih berbahaya:

```http
POST /api/cases/1002/approve
```

### 13.2 Identifier Random Tidak Menyelesaikan Authorization

UUID lebih sulit ditebak daripada integer sequence, tetapi bukan authorization.

```text
Unpredictable ID reduces discoverability.
It does not prove permission.
```

Jika user mendapatkan UUID melalui log, referer, email, browser history, shared link, search result, atau side channel, backend tetap harus authorize.

---

## 14. Authorization and State Machines

Untuk sistem workflow/case management, authorization hampir selalu terikat dengan state machine.

Contoh state:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> RETURNED -> RESUBMITTED -> APPROVED -> CLOSED
```

Action yang sama bisa valid atau invalid tergantung state.

```text
edit case:
- allowed in DRAFT
- allowed in RETURNED for assigned officer
- denied in UNDER_REVIEW
- denied in APPROVED
```

### 14.1 Transition Guard

Setiap transition sebaiknya punya guard:

```text
Transition: SUBMITTED -> APPROVED
Action: case.approve
Actor: supervisor
Guard:
1. actor has case.approve
2. actor supervises assigned officer
3. actor is not submitter
4. case has completed required checks
5. case not locked
```

Java model:

```java
public final class TransitionAuthorizationPolicy implements Policy {
    @Override
    public AuthorizationDecision evaluate(AuthorizationRequest request) {
        if (!request.action().equals(Action.CASE_APPROVE)) {
            return AuthorizationDecision.abstain("NOT_CASE_APPROVE");
        }

        CaseSnapshot c = request.resourceAs(CaseSnapshot.class);
        SubjectRef s = request.subject();

        if (c.state() != CaseState.SUBMITTED) {
            return AuthorizationDecision.deny("CASE_NOT_SUBMITTED");
        }

        if (c.submittedBy().equals(s.subjectId())) {
            return AuthorizationDecision.deny("MAKER_CANNOT_APPROVE_OWN_CASE");
        }

        if (!s.permissions().contains("case.approve")) {
            return AuthorizationDecision.deny("MISSING_CASE_APPROVE_PERMISSION");
        }

        return AuthorizationDecision.permit("SUPERVISOR_CAN_APPROVE_SUBMITTED_CASE");
    }
}
```

### 14.2 Top-Level Insight

Dalam workflow system, authorization matrix sebaiknya diturunkan dari state machine, bukan ditempel acak di controller.

---

## 15. Subject Is Not Always the Logged-In User

Dalam sistem enterprise, subject bisa kompleks.

### 15.1 Direct Actor

```text
User F directly performs action.
```

### 15.2 Delegated Actor

```text
User A acts on behalf of User B.
```

### 15.3 Impersonation

```text
Support operator temporarily acts as another user for troubleshooting.
```

### 15.4 Service Account

```text
Batch job processes cases every night.
```

### 15.5 Client Application

```text
External system calls API using client credentials.
```

### 15.6 Composite Actor

```text
User action triggers service-to-service call.
Downstream service must know both:
- original user,
- calling service.
```

Mental model:

```text
Authentication principal is not always enough.
Authorization subject may include actor chain.
```

Example:

```java
public final class ActorChain {
    private final SubjectRef effectiveSubject;
    private final SubjectRef originalUser;
    private final SubjectRef callingService;
    private final DelegationRef delegation;
}
```

---

## 16. Least Privilege and Need-to-Know

Least privilege:

```text
Subject should receive only permissions required to perform legitimate duties.
```

Need-to-know:

```text
Even if subject has general capability, they should only access data needed for their role/task.
```

Contoh:

```text
Finance officer may view payment amount, but not investigation notes.
Case officer may view case details, but not system-wide user access reports.
Support engineer may view technical metadata, but not personal content unless break-glass is approved.
```

Least privilege tidak cukup hanya dengan role kecil. Ia membutuhkan:

- permission granularity,
- scoped roles,
- object-level checks,
- data minimization,
- field-level masking,
- temporary access,
- review and revocation,
- audit.

---

## 17. Authorization and Data Exposure

Authorization bukan hanya “boleh melakukan action”. Ia juga menentukan **data apa** yang boleh terlihat.

### 17.1 Full Object Exposure Problem

```java
return caseRepository.findById(id).map(caseMapper::toDto);
```

Jika `CaseDto` berisi semua field, user mungkin melihat data yang seharusnya disembunyikan.

Contoh field:

- internal notes,
- legal advice,
- personal data,
- confidential attachments,
- investigation metadata,
- audit trail,
- risk scoring.

### 17.2 Field-Level Authorization

Contoh:

```text
Officer can view case summary.
Supervisor can view recommendation.
Legal officer can view legal note.
Support admin can view technical metadata only.
```

Field-level authorization bisa dilakukan dengan:

- DTO berbeda,
- projection berbeda,
- mapper aware of permission,
- masking policy,
- query-level projection,
- document redaction.

### 17.3 Search Result Leakage

Search sering bocor karena developer hanya mengamankan detail endpoint.

Contoh:

```http
GET /api/cases/search?keyword=abc
```

Jika hasil search mengandung case lintas tenant, meskipun detail endpoint aman, data sudah bocor.

Search, listing, report, export, autocomplete, count, dashboard, dan analytics harus ikut authorization model.

---

## 18. Authorization and Time-of-Check/Time-of-Use

TOCTOU terjadi ketika kondisi saat authorization check berbeda dari kondisi saat action dilakukan.

Contoh:

```text
10:00:00 user authorized to approve case because state = SUBMITTED
10:00:01 another process returns case to officer
10:00:02 approval still executes using stale assumption
```

### 18.1 Java Transaction Boundary

Authorization untuk mutation sebaiknya berada dalam transaction boundary yang konsisten.

```java
@Transactional
public void approveCase(String caseId) {
    Case c = caseRepository.findByIdForUpdate(caseId)
        .orElseThrow(NotFoundException::new);

    authorizationService.authorize(currentSubject(), Action.CASE_APPROVE, c);

    c.approve(currentSubject());
}
```

Poin penting:

- load resource dengan lock jika perlu,
- authorize berdasarkan state terkini,
- mutate dalam transaction yang sama,
- re-check invariant di domain method,
- optimistic locking untuk detect race.

### 18.2 Delayed Approval Problem

Jika action disetujui sekarang tetapi dieksekusi nanti, authorization harus dievaluasi ulang saat eksekusi.

Contoh:

```text
User schedules bulk export at 10:00.
Export executes at 10:15.
Permissions changed at 10:05.
```

Harus jelas apakah memakai:

- decision at request time,
- decision at execution time,
- both,
- signed authorization grant with expiry.

Untuk high-risk action, biasanya revalidate at execution time.

---

## 19. Authorization in Java 8–25

Authorization design sebagian besar bukan tergantung versi Java. Namun platform evolution mempengaruhi cara implementasi.

### 19.1 Java 8 Baseline

Java 8 masih umum di legacy enterprise.

Relevant features:

- lambdas,
- streams,
- `Optional`,
- default methods,
- `CompletableFuture`,
- mature collections/concurrency primitives.

Java 8-friendly authorization design:

```java
public interface Policy {
    AuthorizationDecision evaluate(AuthorizationRequest request);
}
```

Hindari fitur record/sealed jika harus Java 8.

### 19.2 Java 9+ Modules

Java Platform Module System mempengaruhi packaging dan encapsulation, tetapi tidak menggantikan business authorization.

Useful for:

- internal API encapsulation,
- limiting accidental access between modules,
- clearer runtime boundaries.

Not enough for:

- user permission,
- object authorization,
- tenant boundary,
- business policy.

### 19.3 Java 17

Java 17 adalah LTS penting. SecurityManager dideprecated for removal melalui JEP 411. Ini penting karena beberapa engineer lama masih menganggap SecurityManager sebagai platform-level authorization mechanism. Untuk server-side business authorization modern, jangan mendesain solusi baru yang bergantung pada SecurityManager.

Useful Java 17 features:

- records untuk immutable request/decision object,
- sealed classes untuk decision/effect hierarchy,
- pattern matching improvements,
- stronger baseline runtime.

### 19.4 Java 21

Java 21 membawa virtual threads sebagai fitur final. Ini tidak mengubah semantics authorization, tetapi mempengaruhi scalability untuk IO-bound attribute lookup atau remote PDP calls.

Caution:

```text
Virtual threads help concurrency, not authorization correctness.
```

### 19.5 Java 25

JDK 25 adalah Java SE 25 reference implementation dan sudah GA pada 16 September 2025 menurut OpenJDK. Untuk authorization, ini berarti target modern Java dapat memakai fitur platform terbaru, tetapi desain authorization tetap harus portable secara konseptual dari Java 8 hingga 25.

Prinsip:

```text
Authorization model should be version-independent.
Implementation ergonomics may improve with newer Java.
```

---

## 20. Spring Security Mental Model

Spring Security modern menggunakan konsep yang selaras dengan decision model.

Menurut dokumentasi resmi Spring Security, `AuthorizationManager` dipakai oleh komponen authorization berbasis request, method, dan message untuk membuat final access control decision.

Mental model Spring:

```text
Authentication + Secure Object -> AuthorizationManager -> AuthorizationDecision
```

Mapping ke model kita:

```text
Authentication   -> Subject evidence
Secure object    -> request/method/message/resource context
AuthorizationManager -> PDP-ish decision component
AuthorizationDecision -> permit/deny result
```

### 20.1 Spring Security Bukan Policy Design Otomatis

Spring menyediakan mechanism, bukan automatically correct policy.

Contoh:

```java
.requestMatchers("/api/admin/**").hasRole("ADMIN")
```

Ini hanya route-level authorization.

Untuk object-level/domain authorization, tetap perlu domain-aware checks.

### 20.2 `hasRole` vs `hasAuthority`

`hasRole("ADMIN")` biasanya memetakan ke authority `ROLE_ADMIN`.

`hasAuthority("case.approve")` lebih cocok untuk permission-style authorization.

Namun baik role maupun authority tetap belum cukup untuk:

- object ownership,
- tenant boundary,
- workflow state,
- maker-checker,
- field masking.

### 20.3 Direction of Travel

Untuk sistem enterprise modern, gunakan Spring Security sebagai enforcement framework, tetapi bangun domain authorization model di atasnya.

```text
Spring Security = integration/enforcement skeleton
Domain Authorization = business policy brain
```

---

## 21. Jakarta EE / Jakarta Authorization Mental Model

Jakarta Authorization mendefinisikan low-level SPI untuk authorization modules, repository of permissions, dan mekanisme untuk menentukan apakah subject memiliki permission tertentu. Ini berguna pada container-level authorization, terutama di dunia Jakarta EE.

Namun untuk application-level business authorization, kita tetap perlu model yang eksplisit.

Mapping:

```text
Jakarta Principal/caller identity -> subject evidence
Jakarta roles/permissions -> coarse authorization
Application policy service -> business authorization
```

Contoh annotation:

```java
@RolesAllowed("SUPERVISOR")
public void approveCase(String caseId) { ... }
```

Ini belum cukup jika rule sebenarnya:

```text
Supervisor boleh approve hanya jika:
- case dalam state Submitted,
- supervisor bukan submitter,
- supervisor berada dalam same agency,
- supervisor punya assignment scope untuk case type tersebut.
```

---

## 22. Policy Enforcement Point and Policy Decision Point

Walaupun detail PEP/PDP/PAP/PIP akan dibahas di Part 3, Part 0 perlu memperkenalkan pola dasarnya.

### 22.1 PEP — Policy Enforcement Point

Tempat yang menegakkan decision.

Contoh:

- Spring filter,
- controller,
- service method,
- domain method,
- repository query,
- Kafka consumer,
- API gateway,
- batch job.

PEP bertugas:

```text
Ask decision, enforce decision.
```

PEP tidak ideal jika menyimpan seluruh policy kompleks langsung di dalamnya.

### 22.2 PDP — Policy Decision Point

Tempat yang membuat keputusan.

Contoh:

- Java authorization service,
- Spring AuthorizationManager,
- OPA sidecar,
- Cedar engine,
- custom policy evaluator.

PDP bertugas:

```text
Evaluate policy against input and return decision.
```

### 22.3 PAP — Policy Administration Point

Tempat policy dikelola.

Contoh:

- admin UI,
- Git repository,
- database policy table,
- policy deployment pipeline.

### 22.4 PIP — Policy Information Point

Tempat attribute/evidence diambil.

Contoh:

- user directory,
- organization service,
- case service,
- assignment service,
- tenant registry,
- risk engine,
- delegation table.

### 22.5 Why This Matters

Tanpa pemisahan ini, policy sering tersebar:

```text
some in controller
some in service
some in SQL
some in frontend
some in batch job
some in report query
some in Keycloak role mapping
```

Akhirnya tidak ada yang tahu policy sebenarnya.

---

## 23. Authorization Decision Pipeline

Gunakan pipeline mental berikut.

```text
1. Resolve subject
2. Resolve action
3. Resolve resource reference
4. Load minimal resource attributes
5. Resolve context
6. Resolve applicable policies
7. Evaluate policies
8. Combine decisions
9. Enforce result
10. Apply obligations
11. Audit decision
```

### 23.1 Resolve Subject

Ambil subject dari trusted server-side context.

Jangan percaya:

```json
{
  "userId": "admin"
}
```

dari request body.

Subject harus berasal dari:

- authenticated session,
- validated token,
- internal trusted context,
- mTLS workload identity,
- server-side delegation record.

### 23.2 Resolve Action

Action harus ditentukan oleh server berdasarkan endpoint/command, bukan client bebas.

Bad:

```json
{
  "action": "case.approve"
}
```

Good:

```java
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable String id) {
    authorizationService.authorize(subject, Action.CASE_APPROVE, resource);
}
```

### 23.3 Resolve Resource

Resource identifier dari client belum membuktikan access.

```text
caseId from path = claim, not permission
```

### 23.4 Load Minimal Resource Attributes

Authorization sering butuh resource attributes:

- owner id,
- tenant id,
- state,
- classification,
- assigned user,
- created by,
- submitted by,
- locked flag.

Load minimal attribute untuk decision, jangan selalu load full sensitive object.

### 23.5 Resolve Context

Context harus server-derived:

- tenant context,
- request channel,
- auth strength,
- IP/network zone,
- request time,
- correlation id.

### 23.6 Resolve Policy

Cari policy yang berlaku.

Contoh:

```text
case.approve policies
case state transition policies
separation-of-duty policies
tenant boundary policies
break-glass policies
```

### 23.7 Evaluate

Evaluasi policy secara deterministic.

### 23.8 Combine

Jika banyak policy:

- deny overrides,
- permit overrides,
- first applicable,
- unanimous permit,
- priority-based.

Untuk security-critical domain, deny-overrides sering lebih aman.

### 23.9 Enforce

Jika deny/error:

- throw `AccessDeniedException`,
- return HTTP 403/404 sesuai strategy,
- stop mutation,
- do not publish event,
- do not return partial data unless explicitly allowed.

### 23.10 Apply Obligations

Obligation adalah kewajiban tambahan.

Contoh:

- mask field,
- log reason,
- require re-authentication,
- require approval,
- watermark exported file,
- limit result size.

### 23.11 Audit

Audit decision untuk action penting.

Minimal:

- subject,
- action,
- resource,
- result,
- reason,
- policy version,
- timestamp,
- correlation id.

---

## 24. Building a First-Class Authorization Request

Jangan biarkan authorization API menjadi terlalu primitif.

Bad:

```java
boolean can(String username, String role);
```

Better:

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final Action action;
    private final ResourceRef resource;
    private final Map<String, Object> resourceAttributes;
    private final AuthorizationContext context;
}
```

Even better with builder:

```java
AuthorizationRequest request = AuthorizationRequest.builder()
    .subject(subject)
    .action(Action.CASE_APPROVE)
    .resource(ResourceRef.of("Case", caseId))
    .putResourceAttribute("agencyId", c.getAgencyId())
    .putResourceAttribute("state", c.getState())
    .putResourceAttribute("submittedBy", c.getSubmittedBy())
    .context(context)
    .build();
```

### 24.1 Why Request Object Matters

Request object membuat authorization:

- testable,
- loggable,
- serializable ke external PDP,
- extensible,
- reviewable,
- less error-prone.

---

## 25. Example: Case Approval Decision

### 25.1 Requirement

```text
A supervisor can approve a submitted case only if:
1. supervisor has case.approve permission,
2. case belongs to the same agency,
3. case is in SUBMITTED state,
4. supervisor is not the submitter,
5. supervisor has supervision scope over assigned officer,
6. case is not locked,
7. no active conflict-of-interest flag exists.
```

### 25.2 Naive Implementation

```java
@PreAuthorize("hasRole('SUPERVISOR')")
public void approve(String caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    c.setStatus(APPROVED);
}
```

Failures:

- any supervisor can approve any case,
- no agency boundary,
- no state check,
- can approve own submission,
- no lock check,
- no conflict check,
- no audit reason,
- no concurrency handling.

### 25.3 Better Implementation

```java
@Transactional
public void approve(String caseId) {
    SubjectRef subject = currentSubjectProvider.requireSubject();

    Case c = caseRepository.findByIdForUpdate(caseId)
        .orElseThrow(() -> new NotFoundException("Case not found"));

    AuthorizationDecision decision = authorizationService.decide(
        AuthorizationRequest.builder()
            .subject(subject)
            .action(Action.CASE_APPROVE)
            .resource(ResourceRef.of("Case", c.getId()))
            .putResourceAttribute("agencyId", c.getAgencyId())
            .putResourceAttribute("state", c.getState().name())
            .putResourceAttribute("submittedBy", c.getSubmittedBy())
            .putResourceAttribute("assignedOfficer", c.getAssignedOfficerId())
            .putResourceAttribute("locked", c.isLocked())
            .putResourceAttribute("conflictFlag", c.hasConflictFlag())
            .context(AuthorizationContext.current())
            .build()
    );

    decision.throwIfDenied();

    c.approveBy(subject.subjectId());
    auditPublisher.publishAuthorizationDecision(decision);
}
```

### 25.4 Domain Method Still Checks Invariant

```java
public void approveBy(String supervisorId) {
    if (state != CaseState.SUBMITTED) {
        throw new InvalidStateTransitionException("Only submitted case can be approved");
    }
    if (submittedBy.equals(supervisorId)) {
        throw new SeparationOfDutyViolation("Submitter cannot approve own case");
    }
    this.state = CaseState.APPROVED;
}
```

Why duplicate some checks?

Because domain invariant must survive alternate entry paths.

Authorization service answers “may actor do it?”. Domain aggregate protects “is this transition valid at all?”.

---

## 26. Authorization and Error Response Strategy

### 26.1 401 Unauthorized

Despite the name, HTTP 401 means unauthenticated or authentication required.

Use when:

```text
No valid authentication.
```

### 26.2 403 Forbidden

Use when:

```text
Authenticated but not allowed.
```

### 26.3 404 Not Found

Sometimes use 404 to avoid revealing resource existence.

Example:

```text
If user tries to access case from another tenant, return 404 instead of 403.
```

But be consistent.

### 26.4 Internal Reason vs External Message

Internal:

```text
DENY: TENANT_MISMATCH expected=A actual=B
```

External:

```json
{
  "error": "Resource not found"
}
```

Never leak sensitive reason to unauthorized caller.

---

## 27. Authorization and Audit

Audit is not optional for serious authorization.

### 27.1 What to Audit

For sensitive decisions:

```text
subject id
actor chain
action
resource type
resource id
resource tenant
context
result
reason code
policy id
policy version
correlation id
timestamp
source IP/channel if relevant
```

### 27.2 Allow and Deny

Audit only denies is insufficient.

Important allows must also be audited:

- approve case,
- export data,
- impersonate user,
- break-glass access,
- change role,
- view restricted data,
- delete/archive record.

### 27.3 Reconstructability

A mature system can answer later:

```text
Why was user u123 allowed to approve case c456 on 2026-06-19 at 10:20?
```

To answer this, you need:

- policy version,
- subject snapshot,
- resource snapshot or reference to immutable state,
- context snapshot,
- decision reason.

---

## 28. Authorization Testing Mental Model

Authorization testing should not be ad hoc.

### 28.1 Matrix Testing

Example:

| Role | Case State | Assigned? | Same Agency? | Submitter? | Expected |
|---|---:|---:|---:|---:|---:|
| Officer | Draft | Yes | Yes | Yes | Permit edit |
| Officer | Submitted | Yes | Yes | Yes | Deny edit |
| Supervisor | Submitted | No | Yes | No | Permit approve if in scope |
| Supervisor | Submitted | No | Yes | Yes | Deny approve |
| Supervisor | Submitted | No | No | No | Deny |

### 28.2 Negative Tests Are More Important

Authorization tests must prove denial.

Test:

- wrong tenant,
- wrong agency,
- wrong state,
- wrong resource id,
- missing permission,
- stale delegation,
- self-approval,
- locked resource,
- bulk mixed allowed/denied,
- search leakage,
- export leakage.

### 28.3 Mutation Testing Mindset

Ask:

```text
If someone removes this check, will a test fail?
```

If not, your authorization test suite is weak.

---

## 29. Authorization Design Smells

### 29.1 `isAdmin()` Everywhere

If `isAdmin()` appears everywhere, the system probably lacks permission vocabulary.

### 29.2 Role Names in Business Logic Everywhere

```java
if (user.hasRole("ROLE_SUPERVISOR")) { ... }
```

This couples policy to code.

Better:

```java
authorizationService.authorize(subject, Action.CASE_APPROVE, caseResource);
```

### 29.3 No Object-Level Check

Endpoint has role check but no resource check.

### 29.4 Filter After Fetch

```java
List<Case> all = caseRepository.findAll();
return all.stream().filter(c -> canView(user, c)).toList();
```

Problems:

- performance,
- count leakage,
- pagination incorrect,
- memory blowup,
- accidental logging of unauthorized data.

### 29.5 Client-Provided Tenant

```json
{
  "tenantId": "agency-a"
}
```

Never trust this as authority. Tenant must be resolved server-side and checked.

### 29.6 Token Claim Overtrust

JWT claim says agency=A. But if user moved agency after token issuance, claim may be stale.

For high-risk actions, server-side lookup may be required.

### 29.7 Authorization Hidden in Mapper

If sensitive field masking happens accidentally in DTO mapper without clear policy, it becomes hard to audit.

### 29.8 Report/Export Bypass

Main CRUD API secure, but report endpoint leaks all data.

### 29.9 Batch Job Bypass

Human action secure, async worker executes without rechecking permission/scope.

---

## 30. Authorization Design Principles

### 30.1 Deny by Default

No explicit allow means deny.

### 30.2 Server-Side Enforcement

Client hints are not enforcement.

### 30.3 Object-Level by Default

Any resource id from request requires object-level authorization.

### 30.4 Tenant Boundary First

Tenant/agency/org boundary should be among the earliest checks.

### 30.5 Policy Must Be Testable

If you cannot test it, you probably cannot trust it.

### 30.6 Decision Must Be Explainable

At least internally.

### 30.7 Separate Capability from Applicability

Capability:

```text
User has case.approve.
```

Applicability:

```text
This permission applies to this case in this state.
```

### 30.8 Separate Access from Data Shape

User may access resource but not all fields.

### 30.9 Revalidate on Mutation

Mutation authorization should be based on current state.

### 30.10 Audit High-Risk Decisions

Especially allow decisions.

---

## 31. Minimal Java Authorization Kernel

Berikut skeleton sederhana yang bisa berjalan dari Java 8 dengan sedikit penyesuaian.

```java
public interface AuthorizationService {
    AuthorizationDecision decide(AuthorizationRequest request);

    default void authorize(AuthorizationRequest request) {
        AuthorizationDecision decision = decide(request);
        if (!decision.isPermit()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
    }
}
```

```java
public interface Policy {
    boolean supports(AuthorizationRequest request);
    AuthorizationDecision evaluate(AuthorizationRequest request);
}
```

```java
public final class DefaultAuthorizationService implements AuthorizationService {
    private final List<Policy> policies;
    private final DecisionCombiner combiner;

    public DefaultAuthorizationService(List<Policy> policies, DecisionCombiner combiner) {
        this.policies = policies;
        this.combiner = combiner;
    }

    @Override
    public AuthorizationDecision decide(AuthorizationRequest request) {
        List<AuthorizationDecision> decisions = new ArrayList<>();

        for (Policy policy : policies) {
            if (policy.supports(request)) {
                decisions.add(policy.evaluate(request));
            }
        }

        if (decisions.isEmpty()) {
            return AuthorizationDecision.deny("NO_APPLICABLE_POLICY");
        }

        return combiner.combine(decisions);
    }
}
```

```java
public final class DenyOverridesCombiner implements DecisionCombiner {
    @Override
    public AuthorizationDecision combine(List<AuthorizationDecision> decisions) {
        for (AuthorizationDecision d : decisions) {
            if (d.effect() == DecisionEffect.DENY) {
                return d;
            }
            if (d.effect() == DecisionEffect.ERROR) {
                return AuthorizationDecision.deny("POLICY_ERROR_FAIL_CLOSED");
            }
        }

        for (AuthorizationDecision d : decisions) {
            if (d.effect() == DecisionEffect.PERMIT) {
                return d;
            }
        }

        return AuthorizationDecision.deny("NO_PERMIT_DECISION");
    }
}
```

### 31.1 Java 17+ Version

Dengan record:

```java
public record AuthorizationRequest(
    SubjectRef subject,
    Action action,
    ResourceRef resource,
    Map<String, Object> resourceAttributes,
    AuthorizationContext context
) {}
```

Dengan sealed type:

```java
public sealed interface AuthorizationDecision
    permits PermitDecision, DenyDecision, AbstainDecision, ErrorDecision {

    DecisionEffect effect();
    String reasonCode();
}
```

Namun konsepnya sama.

---

## 32. What Top 1% Engineers Notice Early

### 32.1 They Ask “What Is the Resource?”

Jika requirement berbunyi:

```text
Supervisor can approve.
```

Mereka bertanya:

```text
Approve what?
Under which state?
For which department?
Can they approve their own submission?
What if delegated?
What if case is locked?
What if supervisor changes during approval?
```

### 32.2 They Separate Authentication Evidence from Authorization Policy

Token claim bukan policy final.

### 32.3 They Design Permission Vocabulary Carefully

Permission naming adalah architecture decision.

### 32.4 They Protect Search/Export, Not Only Detail API

Data leakage sering terjadi di list/report/export.

### 32.5 They Think About Revocation

Authorization bukan hanya grant. Revocation harus cepat dan predictable.

### 32.6 They Think About Audit Before Incident

Kalau audit baru dipikirkan setelah incident, biasanya sudah terlambat.

### 32.7 They Avoid Boolean Blindness

Decision harus punya reason dan evidence.

### 32.8 They Model Failure

Apa yang terjadi jika policy service down? Attribute source down? Cache stale? Token stale? DB timeout?

### 32.9 They Consider All Entry Paths

- UI,
- REST API,
- internal API,
- batch,
- event consumer,
- report job,
- admin script,
- data migration,
- support tool.

Authorization harus konsisten.

### 32.10 They Treat Authorization as Product Behavior

Access denied bukan hanya security. Itu juga UX, supportability, business process, audit, and trust.

---

## 33. Practical Checklist for Part 0

Gunakan checklist ini saat melihat sistem Java apa pun.

### 33.1 Subject

- [ ] Apakah subject jelas?
- [ ] Apakah subject berasal dari trusted context?
- [ ] Apakah ada actor chain/delegation?
- [ ] Apakah service account dibedakan dari human user?

### 33.2 Action

- [ ] Apakah action business-oriented?
- [ ] Apakah action terlalu CRUD-generic?
- [ ] Apakah high-risk action dipisah?

### 33.3 Resource

- [ ] Apakah resource type jelas?
- [ ] Apakah resource instance dicek?
- [ ] Apakah tenant/agency/org boundary dicek?
- [ ] Apakah existence leak dipertimbangkan?

### 33.4 Context

- [ ] Apakah state resource dipakai?
- [ ] Apakah request channel dipakai bila relevan?
- [ ] Apakah auth strength/risk dipakai untuk high-risk action?
- [ ] Apakah time/delegation/acting role dipakai bila relevan?

### 33.5 Policy

- [ ] Apakah policy eksplisit?
- [ ] Apakah policy testable?
- [ ] Apakah policy versioned?
- [ ] Apakah deny-by-default?

### 33.6 Enforcement

- [ ] Apakah enforcement server-side?
- [ ] Apakah service layer aman dari alternate path?
- [ ] Apakah query/list/export/report ikut secure?
- [ ] Apakah async/batch path ikut secure?

### 33.7 Decision

- [ ] Apakah decision bukan hanya boolean?
- [ ] Apakah reason code tersedia?
- [ ] Apakah error fail-closed?
- [ ] Apakah obligation didukung?

### 33.8 Audit

- [ ] Apakah allow penting diaudit?
- [ ] Apakah deny penting diaudit?
- [ ] Apakah policy version tercatat?
- [ ] Apakah subject/resource/context snapshot cukup untuk rekonstruksi?

### 33.9 Testing

- [ ] Apakah negative tests lebih banyak dari happy path?
- [ ] Apakah tenant mismatch dites?
- [ ] Apakah self-approval dites?
- [ ] Apakah state invalid dites?
- [ ] Apakah search/export leakage dites?

---

## 34. Mini Case Study: Regulatory Case Management

Bayangkan sistem regulatory case management.

### 34.1 Entities

```text
User
Agency
Department
Case
Assignment
Recommendation
Approval
Appeal
Document
AuditTrail
```

### 34.2 Roles

```text
CASE_OFFICER
SUPERVISOR
LEGAL_OFFICER
FINANCE_OFFICER
AGENCY_ADMIN
SYSTEM_ADMIN
SUPPORT_OPERATOR
```

### 34.3 Actions

```text
case.create
case.view
case.updateAssessment
case.submitRecommendation
case.approveRecommendation
case.returnRecommendation
case.reassign
case.close
case.reopen
case.export
case.viewRestrictedNote
document.download
audit.view
user.manageRole
```

### 34.4 Rules

```text
CASE_OFFICER can update assessment only for assigned cases in Draft or Returned state.
SUPERVISOR can approve recommendation only for cases in Submitted state and cannot approve own submission.
LEGAL_OFFICER can view legal notes only for cases explicitly routed to Legal.
AGENCY_ADMIN can manage users only within same agency.
SYSTEM_ADMIN can manage system config but cannot automatically view restricted case content.
SUPPORT_OPERATOR can view technical metadata but needs break-glass for personal/restricted data.
```

### 34.5 Why Simple RBAC Fails

If you only model:

```text
SUPERVISOR can approve cases
```

you miss:

- same agency,
- same department/scope,
- case state,
- self-approval,
- conflict flag,
- lock state,
- delegation,
- audit.

### 34.6 Better Model

```text
Role grants capability.
Permission names action.
Relationship scopes resource.
State machine gates transition.
ABAC checks context and attributes.
Audit records decision.
```

This hybrid thinking is the real-world norm.

---

## 35. Summary Mental Model

Authorization bukan:

```text
Does user have role ADMIN?
```

Authorization adalah:

```text
Given subject S,
trying to perform action A,
on resource R,
under context C,
using policy P,
with evidence E,
what is the decision D,
and how do we enforce, explain, audit, test, and evolve it safely?
```

Formula:

```text
Decision = f(Subject, Action, Resource, Context, Policy, Evidence)
```

Engineering target:

```text
Correct by design.
Deny by default.
Object-aware.
Context-aware.
State-aware.
Tenant-safe.
Auditable.
Testable.
Evolvable.
Operationally safe.
```

---

## 36. Latihan Berpikir

Gunakan latihan ini sebelum masuk Part 1.

### Exercise 1

Ambil satu endpoint:

```http
POST /cases/{id}/approve
```

Jawab:

1. Subject-nya siapa?
2. Action-nya apa?
3. Resource-nya apa?
4. Attribute resource apa yang dibutuhkan?
5. Context apa yang relevan?
6. Policy apa yang berlaku?
7. Apa saja reason deny?
8. Apa yang harus diaudit?
9. Apa race condition yang mungkin terjadi?
10. Test negatif apa yang wajib ada?

### Exercise 2

Ambil satu search API:

```http
GET /cases?status=SUBMITTED
```

Jawab:

1. Bagaimana tenant scoping dilakukan?
2. Apakah user boleh melihat semua submitted case?
3. Bagaimana pagination tetap benar setelah authorization filtering?
4. Apakah count boleh ditampilkan?
5. Apakah result field perlu masking?
6. Apakah export memakai rule yang sama?

### Exercise 3

Ambil satu admin feature:

```http
POST /users/{id}/roles
```

Jawab:

1. Siapa boleh assign role?
2. Role apa yang boleh di-assign?
3. Dalam tenant/agency mana?
4. Apakah admin boleh assign role yang lebih tinggi dari dirinya?
5. Apakah butuh approval?
6. Apakah role punya expiry?
7. Bagaimana audit dilakukan?

---

## 37. Key Takeaways

1. Authorization harus dimodelkan sebagai decision system.
2. Role hanya salah satu input, bukan jawaban final.
3. Object-level authorization adalah keharusan untuk API modern.
4. State machine dan authorization sering tidak bisa dipisahkan.
5. Tenant/agency/org boundary harus menjadi invariant utama.
6. Search, list, export, report, batch, dan async path harus ikut enforcement.
7. Decision sebaiknya tidak hanya boolean; reason dan evidence penting.
8. Deny-by-default adalah baseline.
9. Auditability harus didesain dari awal.
10. Java framework menyediakan mechanism, tetapi correctness policy tetap tanggung jawab desain aplikasi.

---

## 38. Referensi

1. Spring Security Reference — Authorization Architecture. `AuthorizationManager` digunakan oleh request-based, method-based, dan message-based authorization components untuk membuat final access control decisions.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

2. Spring Security Reference — ACL / Domain Object Security. Spring Security menyediakan ACL support untuk domain object instance authorization.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/acls.html

3. Jakarta Authorization Specification. Jakarta Authorization mendefinisikan low-level SPI untuk authorization modules dan permission repositories.  
   https://jakarta.ee/specifications/authorization/

4. Jakarta Security / Authorization / Authentication Explained.  
   https://jakarta.ee/learn/specification-guides/security-authorization-and-authentication-explained/

5. OWASP Top 10 — Broken Access Control. Access control harus ditegakkan pada trusted server-side code; broken access control adalah risiko utama aplikasi web modern.  
   https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/  
   https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/

6. NIST RBAC Model — Sandhu, Ferraiolo, Kuhn. Model RBAC formal mencakup user-role assignment dan permission-role assignment many-to-many.  
   https://csrc.nist.gov/CSRC/media/Publications/conference-paper/2000/07/26/the-nist-model-for-role-based-access-control-towards-a-unified-/documents/sandhu-ferraiolo-kuhn-00.pdf

7. Open Policy Agent Documentation. OPA adalah general-purpose policy engine untuk policy-as-code dan offloading policy decision-making.  
   https://openpolicyagent.org/docs

8. Cedar Policy Language. Cedar adalah language untuk mendefinisikan permissions/policies dan digunakan oleh Amazon Verified Permissions.  
   https://cedarpolicy.com/  
   https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/terminology.html

9. OpenJDK JEP 411 / JEP 486 — SecurityManager deprecation and disabling path. SecurityManager tidak lagi menjadi basis yang tepat untuk server-side business authorization modern.  
   https://openjdk.org/jeps/411  
   https://openjdk.org/jeps/486

10. OpenJDK JDK 25 Project. JDK 25 adalah reference implementation Java SE 25 dan mencapai General Availability pada 16 September 2025.  
    https://openjdk.org/projects/jdk/25/

---

## Status Seri

Part 0 selesai.  
Seri **belum selesai**. Ini adalah bagian 0 dari rencana maksimal 35 part.

Part berikutnya:

> **Part 1 — Authorization Vocabulary, Semantics, and Invariants**



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-001.md">Part 1 — Authorization Vocabulary, Semantics, and Invariants ➡️</a>
</div>
