# learn-java-authorization-modes-and-patterns-part-006

# Part 6 — ABAC: Attribute-Based Authorization

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Bagian: **6 dari 35**  
> Target pembaca: engineer Java yang sudah memahami authentication, RBAC dasar, permission modeling, dan ingin membangun authorization yang fine-grained, defensible, scalable, dan maintainable untuk sistem enterprise/regulatory/case-management.  
> Rentang Java: **Java 8 sampai Java 25**  

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. authorization sebagai sistem keputusan;
2. vocabulary dan invariant;
3. primitive platform Java;
4. arsitektur PEP/PDP/PAP/PIP;
5. RBAC yang benar;
6. permission dan capability modeling.

Part ini masuk ke **ABAC — Attribute-Based Authorization**.

RBAC menjawab:

> “Apakah subject memiliki role yang memberi permission?”

Permission modeling menjawab:

> “Aksi apa yang secara eksplisit boleh dilakukan terhadap resource type tertentu?”

ABAC menjawab pertanyaan yang lebih kaya:

> “Dengan atribut subject, resource, action, dan environment saat ini, apakah operasi ini boleh dilakukan?”

Contoh:

```text
Subject:
  userId        = U-1001
  agency        = CEA
  department    = Enforcement
  clearance     = SENIOR_OFFICER
  actingRole    = CASE_REVIEWER

Action:
  name          = case.approve
  sensitivity   = HIGH
  mutation      = true

Resource:
  type          = EnforcementCase
  caseId        = C-9001
  agency        = CEA
  state         = PENDING_REVIEW
  assignedTeam  = Enforcement
  createdBy     = U-1001
  riskLevel     = HIGH

Environment:
  requestTime   = 2026-06-19T10:30:00+07:00
  channel       = intranet
  networkZone   = corporate
  mfaAgeMinutes = 8
```

Keputusan policy mungkin:

```text
DENY
reason = MAKER_CANNOT_APPROVE_OWN_CASE
```

Walaupun user punya role `CASE_REVIEWER`, ABAC dapat menolak karena atribut `resource.createdBy == subject.userId`.

Itulah kekuatan ABAC: **role bukan lagi satu-satunya sumber kebenaran**.

---

## 1. Definisi Mental ABAC

Menurut definisi NIST SP 800-162, ABAC adalah metode logical access control di mana authorization ditentukan dengan mengevaluasi atribut subject, object/resource, operation, dan kadang environment terhadap policy, rule, atau relationship yang mendeskripsikan operasi yang boleh dilakukan.

Dalam bahasa engineering:

> **ABAC adalah model authorization yang mengambil keputusan berdasarkan fakta-fakta terstruktur tentang siapa yang meminta, apa yang diminta, objek apa yang disentuh, dan kondisi saat permintaan terjadi.**

ABAC bukan sekadar:

```java
if (user.department().equals(case.department())) {
    allow();
}
```

Itu hanya satu rule berbasis atribut.

ABAC yang matang adalah sistem yang memiliki:

1. **attribute taxonomy** — jenis atribut yang dipakai;
2. **attribute source of truth** — dari mana atribut berasal;
3. **attribute trust model** — seberapa atribut bisa dipercaya;
4. **attribute freshness model** — seberapa baru atribut harus dipakai;
5. **policy semantics** — bagaimana atribut dievaluasi;
6. **decision model** — bagaimana hasilnya direpresentasikan;
7. **audit model** — bagaimana keputusan bisa dijelaskan ulang;
8. **failure model** — apa yang terjadi jika atribut tidak tersedia;
9. **performance model** — bagaimana mengambil atribut tanpa membuat sistem lambat;
10. **governance model** — siapa boleh mengubah atribut dan policy.

Top 1% engineer tidak melihat ABAC sebagai “lebih fleksibel dari RBAC” saja. Mereka melihat ABAC sebagai **decision system berbasis evidence**.

---

## 2. Kenapa ABAC Diperlukan

RBAC cukup jika aturan access hanya seperti:

```text
ADMIN can manage users
CASE_OFFICER can update cases
VIEWER can read reports
```

Tetapi sistem enterprise jarang sesederhana itu.

Dalam sistem regulatory/case management, authorization sering seperti:

```text
Officer boleh melihat case jika:
- officer berasal dari agency yang sama dengan case,
- case bukan restricted case kecuali officer memiliki clearance khusus,
- officer berada dalam team yang assigned ke case,
- atau officer adalah supervisor dari assigned officer,
- dan case belum archived,
- dan request berasal dari intranet,
- dan officer tidak sedang acting dalam mode conflict-of-interest,
- dan action bukan approve terhadap case yang dibuat sendiri.
```

Mencoba memodelkan aturan seperti itu hanya dengan role akan menghasilkan:

```text
CEA_ENFORCEMENT_SENIOR_OFFICER_HIGH_RISK_INTRANET_APPROVER_NOT_CREATOR
```

Itu bukan role. Itu adalah policy yang salah tempat.

ABAC diperlukan ketika authorization bergantung pada:

1. **relasi antara subject dan resource**;
2. **state resource**;
3. **atribut organisasi**;
4. **clearance/sensitivity**;
5. **channel/network zone**;
6. **risk score**;
7. **waktu**;
8. **MFA freshness**;
9. **ownership/stewardship**;
10. **separation of duty**;
11. **data classification**;
12. **jurisdiction/tenant/agency boundary**;
13. **workflow state**.

---

## 3. ABAC Tidak Mengganti RBAC Secara Total

Kesalahan umum: menganggap RBAC vs ABAC sebagai pilihan mutlak.

Di sistem nyata, keduanya sering digabung:

```text
RBAC:
  apakah user punya capability dasar untuk melakukan action?

ABAC:
  dalam konteks subject/resource/action/environment ini, apakah capability itu boleh dipakai?
```

Contoh:

```text
Rule 1 — RBAC gate:
  subject must have permission case.approve

Rule 2 — ABAC constraint:
  resource.state must be PENDING_REVIEW

Rule 3 — ABAC constraint:
  resource.createdBy must not equal subject.userId

Rule 4 — ABAC constraint:
  subject.agency must equal resource.agency

Rule 5 — ABAC constraint:
  subject.clearance must dominate resource.sensitivity
```

Jadi role/permission bisa menjadi **coarse capability**, sedangkan ABAC menjadi **fine-grained constraint**.

Mental model yang lebih sehat:

```text
Permission says: what kind of power exists.
ABAC says: when this power is valid.
```

Contoh Java:

```java
boolean hasPermission = subject.permissions().contains("case.approve");
boolean sameAgency = subject.agencyId().equals(resource.agencyId());
boolean validState = resource.state() == CaseState.PENDING_REVIEW;
boolean notMaker = !subject.userId().equals(resource.createdBy());

return hasPermission && sameAgency && validState && notMaker;
```

Namun kode di atas masih terlalu ad-hoc. Part ini akan membawa kita dari ad-hoc condition menuju model ABAC yang bisa dirawat.

---

## 4. Empat Kategori Atribut ABAC

ABAC biasanya mengelompokkan atribut menjadi empat kategori.

```text
+----------------+----------------------------------------------------+
| Category       | Meaning                                            |
+----------------+----------------------------------------------------+
| Subject        | Siapa yang meminta                                 |
| Resource/Object| Apa yang ingin diakses                             |
| Action         | Operasi apa yang ingin dilakukan                   |
| Environment    | Kondisi saat request terjadi                       |
+----------------+----------------------------------------------------+
```

Dalam arsitektur PEP/PDP:

```text
Request
  -> PEP extracts request context
  -> PDP asks PIP for subject/resource/environment attributes
  -> PDP evaluates policy
  -> PEP enforces decision
```

---

## 5. Subject Attributes

Subject attribute adalah fakta tentang actor yang melakukan request.

Contoh:

```text
subject.userId
subject.username
subject.identityType
subject.agencyId
subject.departmentId
subject.teamIds
subject.jobGrade
subject.clearanceLevel
subject.employmentStatus
subject.permissions
subject.roles
subject.assignedCaseIds
subject.delegations
subject.actingCapacity
subject.mfaLevel
subject.lastMfaTime
subject.riskScore
subject.accountStatus
```

### 5.1 Subject Attribute Tidak Selalu Sama Dengan Token Claim

JWT/OIDC token mungkin punya claim:

```json
{
  "sub": "U-1001",
  "agency": "CEA",
  "roles": ["case_reviewer"],
  "scope": "case:read case:approve"
}
```

Tapi ABAC tidak boleh otomatis menganggap semua claim sebagai source of truth.

Pertanyaan yang harus diajukan:

1. Siapa yang menerbitkan claim?
2. Apakah issuer dipercaya untuk atribut itu?
3. Kapan claim diterbitkan?
4. Apakah atribut bisa berubah setelah token diterbitkan?
5. Apakah token lifetime terlalu panjang?
6. Apakah atribut perlu dicek ulang dari database/HR/permission service?

Contoh atribut yang relatif aman dari token:

```text
sub
issuer
audience
authentication method
session id
```

Contoh atribut yang sering perlu dicek ulang:

```text
active employment status
current role assignment
current delegation
suspension status
current team membership
privileged access approval
```

### 5.2 Subject Attribute Freshness

Atribut subject punya kebutuhan freshness berbeda.

```text
+--------------------------+-----------------------+-----------------------------+
| Attribute                | Freshness Need        | Typical Source              |
+--------------------------+-----------------------+-----------------------------+
| userId                   | stable                | identity provider/token     |
| agencyId                 | medium                | profile/HR/IdP              |
| current assignment       | high                  | case management DB          |
| suspension status        | very high             | user admin service          |
| MFA age                  | very high             | auth/session service        |
| temporary delegation     | high                  | delegation table            |
| job title                | low/medium            | HR system                   |
+--------------------------+-----------------------+-----------------------------+
```

Top 1% insight:

> Jangan menyimpan semua atribut subject di JWT hanya karena mudah. Semakin banyak policy bergantung pada claim stale, semakin besar revocation delay dan authorization drift.

---

## 6. Resource Attributes

Resource attribute adalah fakta tentang objek yang ingin diakses.

Contoh untuk `EnforcementCase`:

```text
resource.caseId
resource.agencyId
resource.departmentId
resource.assignedOfficerId
resource.assignedTeamId
resource.state
resource.caseType
resource.riskLevel
resource.sensitivity
resource.createdBy
resource.createdAt
resource.updatedAt
resource.confidentialFlag
resource.legalHold
resource.archived
resource.ownerAgencyId
resource.jurisdiction
```

Resource attribute sering lebih penting dari subject attribute karena bug authorization paling umum terjadi saat aplikasi hanya cek role, tetapi tidak cek objek.

Contoh buruk:

```java
@PreAuthorize("hasAuthority('case.read')")
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable String id) {
    return caseService.getCase(id);
}
```

Masalah:

```text
User punya case.read, tetapi apakah ia boleh membaca case dengan ID tersebut?
```

Contoh lebih benar:

```java
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable String id) {
    CaseRecord record = caseService.findCaseForAuthorization(id);
    authorizationService.authorize(
        AuthorizationRequest.of(
            currentSubject(),
            Action.CASE_READ,
            CaseResource.from(record),
            RequestEnvironment.current()
        )
    );
    return caseMapper.toDto(record);
}
```

### 6.1 Resource Attribute Minimal Projection

Untuk authorization, sering tidak perlu load seluruh entity.

Buat projection khusus:

```java
public final class CaseAuthorizationView {
    private final String caseId;
    private final String agencyId;
    private final String departmentId;
    private final String assignedOfficerId;
    private final String createdBy;
    private final CaseState state;
    private final Sensitivity sensitivity;
    private final boolean archived;

    public CaseAuthorizationView(
            String caseId,
            String agencyId,
            String departmentId,
            String assignedOfficerId,
            String createdBy,
            CaseState state,
            Sensitivity sensitivity,
            boolean archived) {
        this.caseId = caseId;
        this.agencyId = agencyId;
        this.departmentId = departmentId;
        this.assignedOfficerId = assignedOfficerId;
        this.createdBy = createdBy;
        this.state = state;
        this.sensitivity = sensitivity;
        this.archived = archived;
    }

    public String caseId() { return caseId; }
    public String agencyId() { return agencyId; }
    public String departmentId() { return departmentId; }
    public String assignedOfficerId() { return assignedOfficerId; }
    public String createdBy() { return createdBy; }
    public CaseState state() { return state; }
    public Sensitivity sensitivity() { return sensitivity; }
    public boolean archived() { return archived; }
}
```

Java 16+ bisa memakai record:

```java
public record CaseAuthorizationView(
    String caseId,
    String agencyId,
    String departmentId,
    String assignedOfficerId,
    String createdBy,
    CaseState state,
    Sensitivity sensitivity,
    boolean archived
) {}
```

Untuk Java 8, gunakan immutable class manual.

### 6.2 Resource Attribute Harus Diambil Dari Server-Side Source

Jangan percaya resource attribute dari request body untuk authorization.

Buruk:

```json
{
  "caseId": "C-9001",
  "agencyId": "CEA",
  "state": "PENDING_REVIEW"
}
```

Jika API memakai `agencyId` dari body untuk memutuskan access, attacker bisa mengubahnya.

Benar:

```text
request body boleh menyebut caseId
server load resource attributes dari database
policy mengevaluasi atribut hasil load server-side
```

---

## 7. Action Attributes

Action bukan hanya string permission. Action juga memiliki atribut.

Contoh:

```text
action.name = case.approve
action.category = CASE_WORKFLOW
action.mutation = true
action.sensitivity = HIGH
action.requiresMfa = true
action.requiresReason = true
action.requiresFourEyes = true
action.allowedStates = [PENDING_REVIEW]
```

Kenapa action attribute penting?

Karena policy sering berlaku untuk kelas action tertentu.

Contoh:

```text
All HIGH sensitivity mutations require fresh MFA.
All approval actions require maker-checker separation.
All export actions require explicit export permission and audit reason.
All delete actions are denied for archived records.
```

Daripada menulis policy satu per satu:

```text
case.approve requires MFA
appeal.approve requires MFA
license.revoke requires MFA
sanction.issue requires MFA
```

Kita bisa punya atribut:

```text
action.requiresMfa = true
```

Contoh Java:

```java
public enum ActionSensitivity {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}

public final class AuthorizationAction {
    private final String name;
    private final boolean mutation;
    private final boolean export;
    private final boolean requiresMfa;
    private final boolean requiresReason;
    private final ActionSensitivity sensitivity;

    // constructor + getters
}
```

Java 17+:

```java
public record AuthorizationAction(
    String name,
    boolean mutation,
    boolean export,
    boolean requiresMfa,
    boolean requiresReason,
    ActionSensitivity sensitivity
) {}
```

---

## 8. Environment Attributes

Environment attribute adalah fakta tentang kondisi request.

Contoh:

```text
environment.requestTime
environment.channel
environment.networkZone
environment.ipReputation
environment.deviceTrust
environment.sessionAge
environment.mfaAge
environment.correlationId
environment.requestSource
environment.deploymentZone
environment.emergencyMode
environment.maintenanceWindow
environment.featureFlagState
```

Policy example:

```text
Permit case.export only if:
- subject has report.export permission,
- resource.agency == subject.agency,
- environment.channel == intranet,
- environment.mfaAge <= 15 minutes,
- action.requiresReason == true and request.reason is present.
```

### 8.1 Environment Attribute Harus Distabilkan Dalam Request

Jangan evaluasi waktu berkali-kali di tempat berbeda.

Buruk:

```java
if (LocalDateTime.now().isBefore(deadline)) {
    // later
    service.update();
}
```

Benar:

```java
Instant requestTime = clock.instant();
AuthorizationEnvironment env = AuthorizationEnvironment.of(requestTime, ...);
```

Kenapa?

Karena audit dan repeatability. Jika keputusan mau direkonstruksi, `requestTime` harus jelas.

### 8.2 Clock Injection

Gunakan `Clock`, bukan langsung `Instant.now()` di policy.

```java
public final class AuthorizationEnvironmentFactory {
    private final Clock clock;

    public AuthorizationEnvironmentFactory(Clock clock) {
        this.clock = clock;
    }

    public AuthorizationEnvironment current(HttpServletRequest request) {
        return new AuthorizationEnvironment(
            clock.instant(),
            resolveChannel(request),
            resolveNetworkZone(request),
            resolveCorrelationId(request)
        );
    }
}
```

Ini membuat testing time-based authorization jauh lebih mudah.

---

## 9. Attribute Trust Model

Tidak semua atribut punya level kepercayaan yang sama.

```text
+----------------------------+-------------------------+-----------------------------+
| Attribute Source           | Trust Level             | Notes                       |
+----------------------------+-------------------------+-----------------------------+
| Server-side database       | high                    | jika integrity dijaga       |
| Internal entitlement svc   | high                    | jika authenticated channel  |
| IdP signed token           | medium/high             | tergantung claim            |
| Request path ID            | low                     | hanya identifier input      |
| Request body               | low                     | user-controlled             |
| HTTP header from browser   | low                     | kecuali set by trusted edge |
| Gateway-injected header    | medium/high             | jika stripped and signed    |
| Client-side UI state       | untrusted               | tidak boleh enforce         |
+----------------------------+-------------------------+-----------------------------+
```

Top 1% engineer selalu bertanya:

> “Atribut ini berasal dari mana, dan siapa yang bisa memanipulasinya?”

Contoh fatal:

```java
String department = request.getHeader("X-Department");
if (department.equals(case.departmentId())) {
    allow();
}
```

Jika header berasal dari browser, attacker bisa mengirim:

```http
X-Department: Enforcement
```

Jika header berasal dari API Gateway, tetap harus ada invariant:

1. Gateway menghapus header inbound dari client.
2. Gateway hanya inject header setelah authentication.
3. Service hanya menerima traffic dari gateway/internal network.
4. Header punya signature atau mTLS channel.
5. Ada fallback deny jika header hilang.

---

## 10. Attribute Freshness Model

ABAC sering gagal karena menggunakan atribut yang benar tetapi sudah basi.

Contoh:

```text
09:00 user mendapat permission case.approve
09:05 user login, JWT berlaku 8 jam
10:00 permission case.approve dicabut
10:10 user masih bisa approve karena token claim stale
```

Solusi bukan selalu “jangan pakai JWT”. Solusi adalah membedakan atribut.

### 10.1 Attribute Freshness Tier

```text
Tier 0 — Immutable for security window
  userId, issuer, authentication event id

Tier 1 — Slow-changing
  agency, department, job grade

Tier 2 — Medium-changing
  team membership, role assignment

Tier 3 — Fast-changing
  suspension status, delegation, privileged access grant

Tier 4 — Per-resource/current
  case state, assignment, ownership, lock status

Tier 5 — Per-request
  IP, channel, MFA age, risk score, request reason
```

### 10.2 Design Implication

```text
Tier 0-1:
  boleh dari token/session cache dengan TTL yang masuk akal

Tier 2:
  cache pendek + invalidation event

Tier 3:
  cek server-side atau cache sangat pendek

Tier 4:
  load dari resource database dalam transaksi atau consistent read

Tier 5:
  compute per request
```

### 10.3 Java Pattern: Attribute Snapshot

Jangan sebar atribut sebagai parameter liar.

Buat snapshot:

```java
public final class AuthorizationAttributeSnapshot {
    private final SubjectAttributes subject;
    private final ResourceAttributes resource;
    private final ActionAttributes action;
    private final EnvironmentAttributes environment;
    private final Instant capturedAt;

    public AuthorizationAttributeSnapshot(
            SubjectAttributes subject,
            ResourceAttributes resource,
            ActionAttributes action,
            EnvironmentAttributes environment,
            Instant capturedAt) {
        this.subject = subject;
        this.resource = resource;
        this.action = action;
        this.environment = environment;
        this.capturedAt = capturedAt;
    }

    public SubjectAttributes subject() { return subject; }
    public ResourceAttributes resource() { return resource; }
    public ActionAttributes action() { return action; }
    public EnvironmentAttributes environment() { return environment; }
    public Instant capturedAt() { return capturedAt; }
}
```

Audit bisa menyimpan snapshot ringkas:

```json
{
  "decisionId": "D-20260619-001",
  "subject": {"userId":"U-1001","agency":"CEA","permissions":["case.approve"]},
  "resource": {"caseId":"C-9001","agency":"CEA","state":"PENDING_REVIEW","createdBy":"U-1001"},
  "action": {"name":"case.approve","requiresFourEyes":true},
  "environment": {"channel":"intranet","mfaAgeMinutes":8},
  "decision": "DENY",
  "reason": "MAKER_CANNOT_APPROVE_OWN_CASE"
}
```

---

## 11. Attribute Completeness: Missing Attribute Is A Security Event

ABAC policy sering butuh atribut tertentu.

Contoh:

```text
Policy requires resource.sensitivity.
```

Apa yang terjadi jika `resource.sensitivity == null`?

Pilihan:

```text
1. Treat null as low sensitivity — dangerous.
2. Ignore rule — dangerous.
3. Deny with missing attribute reason — safer.
4. Error with policy misconfiguration — sometimes appropriate.
```

Default aman:

> Jika atribut yang diperlukan untuk membuktikan allow tidak tersedia, keputusan harus deny atau indeterminate yang di-enforce sebagai deny.

Contoh decision type:

```java
public enum DecisionEffect {
    PERMIT,
    DENY,
    INDETERMINATE,
    NOT_APPLICABLE
}
```

PEP harus memperlakukan `INDETERMINATE` sebagai deny untuk operation sensitif.

```java
AuthorizationDecision decision = pdp.decide(request);

if (decision.effect() != DecisionEffect.PERMIT) {
    throw new AccessDeniedException(decision.safeMessage());
}
```

### 11.1 Null Attribute Anti-Pattern

Buruk:

```java
if (resource.getSensitivity() != Sensitivity.HIGH) {
    allow();
}
```

Jika sensitivity `null`, expression bisa accidentally allow.

Lebih baik:

```java
if (resource.getSensitivity() == null) {
    return Decision.indeterminate("MISSING_RESOURCE_SENSITIVITY");
}

if (resource.getSensitivity() == Sensitivity.HIGH && !subject.hasClearance("HIGH")) {
    return Decision.deny("INSUFFICIENT_CLEARANCE");
}
```

---

## 12. ABAC Policy Semantics

ABAC membutuhkan semantics yang jelas.

Policy bisa punya beberapa bentuk:

### 12.1 Boolean Predicate Style

```java
boolean allowed =
    subject.hasPermission("case.approve")
        && subject.agencyId().equals(resource.agencyId())
        && resource.state() == CaseState.PENDING_REVIEW
        && !subject.userId().equals(resource.createdBy());
```

Kelebihan:

1. sederhana;
2. cepat;
3. mudah dipahami untuk rule kecil.

Kekurangan:

1. sulit memberi reason detail;
2. mudah tersebar;
3. sulit audit;
4. sulit compose;
5. sulit test secara granular.

### 12.2 Rule Object Style

```java
public interface AuthorizationRule {
    RuleResult evaluate(AuthorizationAttributeSnapshot snapshot);
}
```

Contoh:

```java
public final class SameAgencyRule implements AuthorizationRule {
    @Override
    public RuleResult evaluate(AuthorizationAttributeSnapshot snapshot) {
        String subjectAgency = snapshot.subject().agencyId();
        String resourceAgency = snapshot.resource().agencyId();

        if (subjectAgency == null || resourceAgency == null) {
            return RuleResult.indeterminate("MISSING_AGENCY_ATTRIBUTE");
        }

        if (!subjectAgency.equals(resourceAgency)) {
            return RuleResult.deny("DIFFERENT_AGENCY");
        }

        return RuleResult.permit("SAME_AGENCY");
    }
}
```

### 12.3 Specification Style

```java
public interface AuthorizationSpecification {
    boolean isSatisfiedBy(AuthorizationAttributeSnapshot snapshot);
    String code();
}
```

Baik untuk domain logic, tapi jangan hilangkan reason.

### 12.4 Policy Decision Style

```java
public interface AuthorizationPolicy {
    AuthorizationDecision decide(AuthorizationAttributeSnapshot snapshot);
}
```

Ini paling fleksibel untuk enterprise.

---

## 13. Decision Combining

Jika banyak rule dievaluasi, bagaimana hasilnya digabung?

Common strategies:

```text
1. Deny overrides
2. Permit overrides
3. First applicable
4. All must permit
5. Majority — jarang cocok untuk authorization
6. Priority-based
```

### 13.1 Deny Overrides

Jika satu rule deny, keputusan akhir deny.

Cocok untuk security constraint.

```text
Rule A: has permission -> permit
Rule B: same agency -> permit
Rule C: not maker -> deny
Final: deny
```

### 13.2 All Must Permit

Semua mandatory rule harus permit.

```text
hasPermission = permit
sameAgency = permit
validState = permit
notMaker = deny
final = deny
```

### 13.3 Permit Overrides

Jika satu rule permit, final permit.

Berbahaya kecuali untuk exception model yang sangat eksplisit.

Contoh legitimate:

```text
permit if user is assigned officer
OR permit if user is supervisor
OR permit if user has approved delegation
```

Tetapi tetap harus dibungkus mandatory deny rules:

```text
Deny if account suspended.
Deny if resource archived.
Deny if cross-tenant.
Then evaluate permit alternatives.
```

### 13.4 Practical Combining Model

Model yang sering sehat:

```text
1. Mandatory denies
2. Mandatory requirements
3. Permit alternatives
4. Obligations
```

Contoh:

```text
DENY if subject.suspended
DENY if resource.archived
DENY if subject.agency != resource.agency

REQUIRE subject has case.read permission

PERMIT if subject is assigned officer
PERMIT if subject is assigned team member
PERMIT if subject is supervisor of assigned officer

OBLIGATION audit reason if resource.sensitivity == HIGH
```

---

## 14. ABAC Decision Object

Jangan return boolean saja.

Boolean kehilangan informasi:

```java
boolean allowed = authorizationService.can(...);
```

Masalah:

1. Tidak tahu kenapa deny.
2. Tidak tahu rule mana yang gagal.
3. Tidak tahu atribut mana yang dipakai.
4. Tidak bisa audit dengan baik.
5. Tidak bisa troubleshoot.
6. Tidak bisa memberi obligation.

Lebih baik:

```java
public final class AuthorizationDecision {
    private final DecisionEffect effect;
    private final String reasonCode;
    private final List<String> ruleCodes;
    private final List<AuthorizationObligation> obligations;
    private final Map<String, Object> safeDiagnostics;

    private AuthorizationDecision(
            DecisionEffect effect,
            String reasonCode,
            List<String> ruleCodes,
            List<AuthorizationObligation> obligations,
            Map<String, Object> safeDiagnostics) {
        this.effect = effect;
        this.reasonCode = reasonCode;
        this.ruleCodes = ruleCodes;
        this.obligations = obligations;
        this.safeDiagnostics = safeDiagnostics;
    }

    public static AuthorizationDecision permit(String reasonCode) {
        return new AuthorizationDecision(
            DecisionEffect.PERMIT,
            reasonCode,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyMap()
        );
    }

    public static AuthorizationDecision deny(String reasonCode) {
        return new AuthorizationDecision(
            DecisionEffect.DENY,
            reasonCode,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyMap()
        );
    }

    public DecisionEffect effect() { return effect; }
    public String reasonCode() { return reasonCode; }
    public List<String> ruleCodes() { return ruleCodes; }
    public List<AuthorizationObligation> obligations() { return obligations; }
    public Map<String, Object> safeDiagnostics() { return safeDiagnostics; }
}
```

Java 17+:

```java
public record AuthorizationDecision(
    DecisionEffect effect,
    String reasonCode,
    List<String> ruleCodes,
    List<AuthorizationObligation> obligations,
    Map<String, Object> safeDiagnostics
) {}
```

---

## 15. Obligations and Advice

ABAC bukan hanya allow/deny.

Policy kadang menghasilkan **obligation**:

> “Operation boleh dilakukan, tetapi PEP harus melakukan X.”

Contoh obligation:

```text
- require audit reason
- mask sensitive fields
- add watermark
- notify supervisor
- require step-up MFA
- limit export size
- redact PII
- attach legal basis
```

Contoh:

```text
Decision: PERMIT
Obligation:
  MASK_FIELD: subject.nric
  WATERMARK_EXPORT: userId + timestamp
  AUDIT_REASON_REQUIRED: true
```

Dalam Java:

```java
public final class AuthorizationObligation {
    private final String type;
    private final Map<String, String> parameters;

    public AuthorizationObligation(String type, Map<String, String> parameters) {
        this.type = type;
        this.parameters = Collections.unmodifiableMap(new LinkedHashMap<>(parameters));
    }

    public String type() { return type; }
    public Map<String, String> parameters() { return parameters; }
}
```

PEP harus enforce obligation.

Buruk:

```java
AuthorizationDecision decision = authorizationService.authorize(request);
if (decision.isPermit()) {
    return data;
}
```

Benar:

```java
AuthorizationDecision decision = authorizationService.authorize(request);
if (!decision.isPermit()) {
    throw accessDenied(decision);
}

CaseDto dto = mapper.toDto(caseRecord);
return obligationEnforcer.apply(dto, decision.obligations());
```

Jika PEP tidak bisa memenuhi obligation, final harus deny/error.

---

## 16. Attribute-Based Field-Level Authorization

ABAC sangat berguna untuk field-level access.

Contoh:

```text
Officer boleh melihat case summary.
Senior officer boleh melihat confidential notes.
Legal officer boleh melihat legal opinion.
External agency user tidak boleh melihat internal remarks.
```

Endpoint sama:

```http
GET /cases/C-9001
```

Tapi response berbeda berdasarkan atribut.

### 16.1 Jangan Campur Dengan DTO Mapper Biasa

Buruk:

```java
CaseDto dto = caseMapper.toDto(caseEntity);
if (!subject.isSenior()) {
    dto.setConfidentialNotes(null);
}
```

Masalah:

1. masking tersebar;
2. raw sensitive data sudah masuk object response;
3. field baru mudah lupa dimasking;
4. sulit audit.

Lebih baik buat field policy:

```java
public enum CaseField {
    SUMMARY,
    STATUS,
    CONFIDENTIAL_NOTES,
    LEGAL_OPINION,
    INTERNAL_REMARKS
}
```

Lalu evaluasi:

```java
public interface FieldAuthorizationService {
    Set<CaseField> allowedFields(SubjectAttributes subject, CaseAuthorizationView resource);
}
```

DTO mapper hanya mengisi field yang allowed.

```java
Set<CaseField> fields = fieldAuthorizationService.allowedFields(subject, authView);

CaseDto dto = new CaseDto();
dto.setSummary(record.summary());
dto.setStatus(record.status());

if (fields.contains(CaseField.CONFIDENTIAL_NOTES)) {
    dto.setConfidentialNotes(record.confidentialNotes());
}

if (fields.contains(CaseField.LEGAL_OPINION)) {
    dto.setLegalOpinion(record.legalOpinion());
}
```

### 16.2 Property-Level Authorization and OWASP Risk

OWASP API Security Top 10 membahas Broken Object Property Level Authorization sebagai risiko ketika API mengekspos property sensitif yang tidak seharusnya diakses user. ABAC dapat membantu mengontrol property-level access, tetapi hanya jika field sensitivity menjadi atribut eksplisit.

---

## 17. ABAC and Search/Listing Authorization

ABAC paling sulit bukan pada `GET /cases/{id}`, tetapi pada listing:

```http
GET /cases?state=PENDING_REVIEW&page=1
```

Pertanyaan:

> Case mana saja yang boleh dilihat user?

Buruk:

```java
List<Case> cases = caseRepository.search(criteria);
return cases.stream()
    .filter(c -> authorizationService.canRead(subject, c))
    .map(mapper::toDto)
    .toList();
```

Masalah:

1. pagination salah;
2. count bocor;
3. performa buruk;
4. data unauthorized sempat di-load;
5. sorting bisa bocor;
6. aggregation bisa salah.

Benar:

> ABAC untuk listing harus diterjemahkan menjadi query predicate sejauh mungkin.

Contoh rule:

```text
subject.agencyId == case.agencyId
AND case.archived = false
AND (
  case.assignedOfficerId = subject.userId
  OR case.assignedTeamId IN subject.teamIds
  OR subject.permissions contains case.read.all-in-agency
)
```

JPA Specification:

```java
public final class CaseAuthorizationSpecifications {

    public static Specification<CaseEntity> readableBy(SubjectAttributes subject) {
        return (root, query, cb) -> {
            Predicate sameAgency = cb.equal(root.get("agencyId"), subject.agencyId());
            Predicate notArchived = cb.isFalse(root.get("archived"));

            Predicate assignedOfficer = cb.equal(root.get("assignedOfficerId"), subject.userId());
            Predicate assignedTeam = root.get("assignedTeamId").in(subject.teamIds());
            Predicate allAgency = subject.permissions().contains("case.read.all-in-agency")
                ? cb.conjunction()
                : cb.disjunction();

            return cb.and(
                sameAgency,
                notArchived,
                cb.or(assignedOfficer, assignedTeam, allAgency)
            );
        };
    }
}
```

Use:

```java
Specification<CaseEntity> businessCriteria = CaseSpecifications.from(searchRequest);
Specification<CaseEntity> authCriteria = CaseAuthorizationSpecifications.readableBy(subject);

Page<CaseEntity> page = caseRepository.findAll(
    businessCriteria.and(authCriteria),
    pageable
);
```

Top 1% insight:

> For reads, authorization must often become part of query planning, not just post-processing.

---

## 18. ABAC and Mutations

Untuk mutation, ABAC harus mengecek:

1. subject capability;
2. resource current state;
3. action validity;
4. conflict-of-interest;
5. transaction consistency;
6. expected version;
7. obligations.

Contoh approve case:

```java
@Transactional
public void approveCase(String caseId, ApproveCaseCommand command) {
    SubjectAttributes subject = subjectResolver.currentSubject();

    CaseEntity entity = caseRepository.findByIdForUpdate(caseId)
        .orElseThrow(() -> new NotFoundException("Case not found"));

    CaseAuthorizationView resource = CaseAuthorizationView.from(entity);

    AuthorizationDecision decision = authorizationService.authorize(
        AuthorizationRequest.builder()
            .subject(subject)
            .action(Actions.CASE_APPROVE)
            .resource(resource)
            .environment(environmentFactory.current())
            .build()
    );

    decisionEnforcer.enforce(decision);

    entity.approve(command.reason(), subject.userId());
    auditPublisher.publishApproval(entity, subject, decision);
}
```

Perhatikan `findByIdForUpdate`.

Kenapa?

Karena ABAC bisa bergantung pada `state`. Jika state berubah antara check dan update, terjadi TOCTOU.

### 18.1 TOCTOU Example

```text
T1: User A loads case state = PENDING_REVIEW
T2: User B approves case -> state = APPROVED
T1: User A still approves based on stale state
```

Mitigasi:

1. pessimistic lock;
2. optimistic locking with version;
3. conditional update;
4. state transition invariant in domain layer;
5. database constraint if possible.

Contoh conditional update:

```sql
UPDATE cases
SET state = 'APPROVED', approved_by = ?, approved_at = ?
WHERE case_id = ?
  AND state = 'PENDING_REVIEW'
  AND created_by <> ?
```

Jika affected rows = 0, return conflict/denied depending cause.

---

## 19. ABAC and Domain State

Resource state adalah atribut paling penting untuk workflow authorization.

Contoh:

```text
case.submit allowed only when state = DRAFT
case.assign allowed only when state IN [SUBMITTED, REOPENED]
case.approve allowed only when state = PENDING_REVIEW
case.reopen allowed only when state IN [CLOSED, REJECTED]
case.delete allowed only when state = DRAFT and createdBy = subject.userId
```

Jangan hanya taruh state guard di controller.

Domain model tetap harus menjaga invariant:

```java
public void approve(String reason, String approverId) {
    if (state != CaseState.PENDING_REVIEW) {
        throw new InvalidStateTransitionException("Case is not pending review");
    }
    if (createdBy.equals(approverId)) {
        throw new ConflictOfInterestException("Maker cannot approve own case");
    }
    this.state = CaseState.APPROVED;
    this.approvedBy = approverId;
    this.approvedAt = Instant.now();
}
```

Authorization service decides whether subject may attempt operation. Domain model protects invariant even if caller bypasses service accidentally.

Layering sehat:

```text
Controller:
  request mapping + identity context

Application service:
  load subject/resource attributes
  ask authorization
  start transaction
  call domain operation

Domain model:
  enforce business invariant

Repository/DB:
  enforce data boundary and consistency where possible
```

---

## 20. ABAC in Spring Security

Spring Security dapat mendukung ABAC melalui beberapa cara.

### 20.1 SpEL-Based Method Security

Contoh:

```java
@PreAuthorize("hasAuthority('case.approve') and @caseAuthz.canApprove(authentication, #caseId)")
public void approveCase(String caseId, ApproveCaseCommand command) {
    ...
}
```

Kelebihan:

1. cepat diterapkan;
2. declarative;
3. cocok untuk rule kecil.

Kekurangan:

1. SpEL bisa menjadi string logic yang sulit refactor;
2. debugging lebih sulit;
3. reason/audit sering hilang;
4. load resource bisa tersembunyi;
5. expression bisa terlalu panjang.

Gunakan SpEL sebagai PEP trigger, bukan tempat semua policy.

Lebih baik:

```java
@PreAuthorize("@caseAuthorizationGuard.canApprove(authentication, #caseId)")
public void approveCase(String caseId, ApproveCaseCommand command) {
    ...
}
```

Guard:

```java
@Component
public class CaseAuthorizationGuard {
    private final AuthorizationService authorizationService;
    private final CaseAuthorizationViewRepository viewRepository;
    private final SubjectResolver subjectResolver;
    private final EnvironmentFactory environmentFactory;

    public boolean canApprove(Authentication authentication, String caseId) {
        SubjectAttributes subject = subjectResolver.from(authentication);
        CaseAuthorizationView resource = viewRepository.findById(caseId)
            .orElse(null);

        if (resource == null) {
            return false;
        }

        AuthorizationDecision decision = authorizationService.authorize(
            AuthorizationRequest.of(subject, Actions.CASE_APPROVE, resource, environmentFactory.current())
        );

        return decision.effect() == DecisionEffect.PERMIT;
    }
}
```

Namun boolean guard masih kurang untuk reason/audit. Untuk operation penting, lebih baik explicit call dalam service.

### 20.2 AuthorizationManager

Spring Security modern memakai `AuthorizationManager` sebagai abstraction untuk membuat decision sebelum/atau sesudah secure object diproses.

Custom manager bisa dipakai untuk request-level ABAC:

```java
public final class NetworkZoneAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext context) {

        HttpServletRequest request = context.getRequest();
        String networkZone = request.getHeader("X-Network-Zone");

        boolean granted = "intranet".equals(networkZone)
            && authentication.get() != null
            && authentication.get().isAuthenticated();

        return new AuthorizationDecision(granted);
    }
}
```

Catatan:

1. Ini cocok untuk coarse request-level constraint.
2. Jangan taruh object-level resource logic kompleks di filter chain jika resource harus load dari DB dan transaction-aware.
3. Untuk object-level ABAC, service-level authorization sering lebih tepat.

### 20.3 PermissionEvaluator

`PermissionEvaluator` bisa menjadi bridge:

```java
@PreAuthorize("hasPermission(#caseId, 'Case', 'approve')")
public void approveCase(String caseId) {
    ...
}
```

Tetapi desainnya harus berhati-hati:

1. jangan return boolean tanpa audit untuk action penting;
2. jangan load entity besar;
3. jangan membuat N+1 untuk list;
4. jangan menyembunyikan failure.

---

## 21. ABAC in Jakarta EE

Di Jakarta EE, authorization bisa declarative:

```java
@RolesAllowed("CASE_REVIEWER")
public void approveCase(String caseId) {
    ...
}
```

Tetapi ini RBAC-level, bukan full ABAC.

ABAC biasanya perlu programmatic check:

```java
public void approveCase(String caseId, ApproveCommand command) {
    SubjectAttributes subject = subjectResolver.current();
    CaseAuthorizationView resource = caseRepository.findAuthorizationView(caseId)
        .orElseThrow(NotFoundException::new);

    AuthorizationDecision decision = authorizationService.authorize(
        AuthorizationRequest.of(subject, Actions.CASE_APPROVE, resource, environment.current())
    );

    decisionEnforcer.enforce(decision);

    // mutation
}
```

Jakarta annotations masih berguna sebagai coarse PEP:

```java
@RolesAllowed({"CASE_REVIEWER", "SENIOR_OFFICER"})
public void approveCase(...) {
    // ABAC object/state/agency/maker-checker check inside
}
```

Rule:

> Declarative role annotation boleh menjadi outer gate, tetapi tidak cukup untuk resource-level authorization.

---

## 22. ABAC Policy Implementation: Java 8-Compatible Example

Berikut mini-framework sederhana untuk ABAC internal.

### 22.1 Core Types

```java
public enum DecisionEffect {
    PERMIT,
    DENY,
    INDETERMINATE,
    NOT_APPLICABLE
}
```

```java
public final class RuleResult {
    private final DecisionEffect effect;
    private final String code;

    private RuleResult(DecisionEffect effect, String code) {
        this.effect = effect;
        this.code = code;
    }

    public static RuleResult permit(String code) {
        return new RuleResult(DecisionEffect.PERMIT, code);
    }

    public static RuleResult deny(String code) {
        return new RuleResult(DecisionEffect.DENY, code);
    }

    public static RuleResult indeterminate(String code) {
        return new RuleResult(DecisionEffect.INDETERMINATE, code);
    }

    public DecisionEffect effect() { return effect; }
    public String code() { return code; }
}
```

```java
public interface AuthorizationRule {
    String code();
    RuleResult evaluate(AuthorizationAttributeSnapshot snapshot);
}
```

### 22.2 Rule: Has Permission

```java
public final class HasPermissionRule implements AuthorizationRule {
    private final String requiredPermission;

    public HasPermissionRule(String requiredPermission) {
        this.requiredPermission = Objects.requireNonNull(requiredPermission, "requiredPermission");
    }

    @Override
    public String code() {
        return "HAS_PERMISSION_" + requiredPermission;
    }

    @Override
    public RuleResult evaluate(AuthorizationAttributeSnapshot snapshot) {
        if (snapshot.subject() == null || snapshot.subject().permissions() == null) {
            return RuleResult.indeterminate("MISSING_SUBJECT_PERMISSIONS");
        }

        if (!snapshot.subject().permissions().contains(requiredPermission)) {
            return RuleResult.deny("MISSING_PERMISSION_" + requiredPermission);
        }

        return RuleResult.permit("PERMISSION_PRESENT_" + requiredPermission);
    }
}
```

### 22.3 Rule: Same Agency

```java
public final class SameAgencyRule implements AuthorizationRule {
    @Override
    public String code() {
        return "SAME_AGENCY";
    }

    @Override
    public RuleResult evaluate(AuthorizationAttributeSnapshot snapshot) {
        String subjectAgency = snapshot.subject().agencyId();
        String resourceAgency = snapshot.resource().agencyId();

        if (subjectAgency == null || resourceAgency == null) {
            return RuleResult.indeterminate("MISSING_AGENCY");
        }

        if (!subjectAgency.equals(resourceAgency)) {
            return RuleResult.deny("DIFFERENT_AGENCY");
        }

        return RuleResult.permit("SAME_AGENCY");
    }
}
```

### 22.4 Rule: Maker Cannot Approve Own Case

```java
public final class MakerCannotApproveOwnCaseRule implements AuthorizationRule {
    @Override
    public String code() {
        return "MAKER_CANNOT_APPROVE_OWN_CASE";
    }

    @Override
    public RuleResult evaluate(AuthorizationAttributeSnapshot snapshot) {
        String subjectUserId = snapshot.subject().userId();
        String createdBy = snapshot.resource().createdBy();

        if (subjectUserId == null || createdBy == null) {
            return RuleResult.indeterminate("MISSING_MAKER_CHECKER_ATTRIBUTES");
        }

        if (subjectUserId.equals(createdBy)) {
            return RuleResult.deny("MAKER_CANNOT_APPROVE_OWN_CASE");
        }

        return RuleResult.permit("NOT_MAKER");
    }
}
```

### 22.5 Rule: State Must Be Pending Review

```java
public final class CaseStateMustBePendingReviewRule implements AuthorizationRule {
    @Override
    public String code() {
        return "CASE_STATE_PENDING_REVIEW";
    }

    @Override
    public RuleResult evaluate(AuthorizationAttributeSnapshot snapshot) {
        CaseState state = snapshot.resource().state();

        if (state == null) {
            return RuleResult.indeterminate("MISSING_CASE_STATE");
        }

        if (state != CaseState.PENDING_REVIEW) {
            return RuleResult.deny("CASE_NOT_PENDING_REVIEW");
        }

        return RuleResult.permit("CASE_PENDING_REVIEW");
    }
}
```

### 22.6 Policy Combiner

```java
public final class AllMustPermitPolicy implements AuthorizationPolicy {
    private final String policyCode;
    private final List<AuthorizationRule> rules;

    public AllMustPermitPolicy(String policyCode, List<AuthorizationRule> rules) {
        this.policyCode = Objects.requireNonNull(policyCode, "policyCode");
        this.rules = Collections.unmodifiableList(new ArrayList<>(rules));
    }

    @Override
    public AuthorizationDecision decide(AuthorizationAttributeSnapshot snapshot) {
        List<String> evaluatedRules = new ArrayList<>();

        for (AuthorizationRule rule : rules) {
            RuleResult result = rule.evaluate(snapshot);
            evaluatedRules.add(rule.code() + ":" + result.code());

            if (result.effect() == DecisionEffect.DENY) {
                return AuthorizationDecision.deny(result.code(), evaluatedRules);
            }

            if (result.effect() == DecisionEffect.INDETERMINATE) {
                return AuthorizationDecision.indeterminate(result.code(), evaluatedRules);
            }
        }

        return AuthorizationDecision.permit(policyCode + "_PERMIT", evaluatedRules);
    }
}
```

Decision factory overload:

```java
public static AuthorizationDecision deny(String reasonCode, List<String> ruleCodes) {
    return new AuthorizationDecision(
        DecisionEffect.DENY,
        reasonCode,
        Collections.unmodifiableList(new ArrayList<>(ruleCodes)),
        Collections.emptyList(),
        Collections.emptyMap()
    );
}
```

### 22.7 Case Approve Policy

```java
AuthorizationPolicy approveCasePolicy = new AllMustPermitPolicy(
    "CASE_APPROVE_POLICY",
    Arrays.asList(
        new HasPermissionRule("case.approve"),
        new SameAgencyRule(),
        new CaseStateMustBePendingReviewRule(),
        new MakerCannotApproveOwnCaseRule()
    )
);
```

---

## 23. Java 17–25 Design Upgrade

Untuk Java 17+, model ABAC bisa dibuat lebih expressive dengan:

1. records;
2. sealed interfaces;
3. pattern matching;
4. switch expressions;
5. immutable collections;
6. virtual threads untuk remote PIP/PDP calls jika IO-bound;
7. structured concurrency untuk parallel attribute loading jika memakai Java 21+ preview/standard evolution sesuai versi yang dipakai.

### 23.1 Records

```java
public record SubjectAttributes(
    String userId,
    String agencyId,
    String departmentId,
    Set<String> teamIds,
    Set<String> permissions,
    ClearanceLevel clearanceLevel,
    boolean suspended
) {}
```

### 23.2 Sealed Resource Attributes

```java
public sealed interface ResourceAttributes
    permits CaseResourceAttributes, ReportResourceAttributes, DocumentResourceAttributes {

    String resourceId();
    String resourceType();
    String agencyId();
}
```

```java
public record CaseResourceAttributes(
    String resourceId,
    String agencyId,
    String createdBy,
    String assignedOfficerId,
    CaseState state,
    Sensitivity sensitivity
) implements ResourceAttributes {
    @Override
    public String resourceType() {
        return "case";
    }
}
```

### 23.3 Pattern Matching

```java
public RuleResult evaluate(AuthorizationAttributeSnapshot snapshot) {
    ResourceAttributes resource = snapshot.resource();

    if (resource instanceof CaseResourceAttributes caseResource) {
        return evaluateCase(snapshot.subject(), caseResource);
    }

    return RuleResult.notApplicable("RESOURCE_TYPE_NOT_CASE");
}
```

Java 8 version harus memakai `instanceof` + cast manual.

---

## 24. ABAC Attribute Loading Architecture

ABAC membutuhkan atribut. Pertanyaannya: siapa yang load?

### 24.1 Jangan Biarkan Policy Load Data Sembarangan

Buruk:

```java
public RuleResult evaluate(Snapshot snapshot) {
    User user = userRepository.findById(snapshot.subject().userId());
    CaseEntity c = caseRepository.findById(snapshot.resource().id());
    ...
}
```

Masalah:

1. policy punya side effect;
2. sulit test;
3. sulit optimize;
4. N+1 risk;
5. transaction boundary kabur;
6. remote calls tersembunyi;
7. audit snapshot tidak jelas.

Lebih baik:

```text
AttributeResolver loads attributes before policy evaluation.
Policy evaluates pure snapshot.
```

### 24.2 Attribute Resolver Pattern

```java
public interface AttributeResolver<R extends ResourceRef> {
    AuthorizationAttributeSnapshot resolve(
        SubjectRef subject,
        AuthorizationAction action,
        R resourceRef,
        RequestContext requestContext
    );
}
```

Case resolver:

```java
public final class CaseApproveAttributeResolver
        implements AttributeResolver<CaseResourceRef> {

    private final SubjectAttributeService subjectService;
    private final CaseAuthorizationViewRepository caseRepository;
    private final EnvironmentFactory environmentFactory;
    private final Clock clock;

    @Override
    public AuthorizationAttributeSnapshot resolve(
            SubjectRef subjectRef,
            AuthorizationAction action,
            CaseResourceRef resourceRef,
            RequestContext requestContext) {

        SubjectAttributes subject = subjectService.resolve(subjectRef);
        CaseResourceAttributes resource = caseRepository.findAuthorizationAttributes(resourceRef.caseId())
            .orElseThrow(() -> new ResourceNotFoundForAuthorizationException(resourceRef.caseId()));
        EnvironmentAttributes environment = environmentFactory.from(requestContext);

        return new AuthorizationAttributeSnapshot(subject, resource, action, environment, clock.instant());
    }
}
```

---

## 25. Attribute Source of Truth

Setiap atribut harus punya source of truth.

Contoh catalog:

```text
+----------------------------+---------------------------+-----------------------------+
| Attribute                  | Source of Truth           | Notes                       |
+----------------------------+---------------------------+-----------------------------+
| subject.userId             | IdP                       | from token sub              |
| subject.agencyId           | User profile service      | token allowed as cache      |
| subject.permissions        | Entitlement service/DB    | cache with invalidation     |
| subject.suspended          | User admin service        | must be fresh               |
| resource.caseId            | Case DB                   | server-side load            |
| resource.state             | Case DB                   | transaction-sensitive       |
| resource.createdBy         | Case DB                   | for maker-checker           |
| resource.sensitivity       | Case DB / classification  | deny if missing             |
| environment.networkZone    | Gateway/service mesh      | trust boundary required     |
| environment.mfaAge         | Session/auth service      | fresh                       |
+----------------------------+---------------------------+-----------------------------+
```

Atribut tanpa source of truth adalah red flag.

---

## 26. Attribute Poisoning

Attribute poisoning terjadi ketika attacker atau sistem yang tidak trusted bisa mempengaruhi atribut yang dipakai authorization.

Contoh:

```http
POST /cases/C-9001/approve
X-Agency-Id: CEA
X-User-Clearance: HIGH
```

Jika service memakai header ini langsung, ABAC bisa dibypass.

### 26.1 Poisoning Sources

```text
1. Client-provided request body
2. Client-provided header
3. Query parameter
4. Unsigned cookie
5. Stale localStorage/sessionStorage
6. Untrusted upstream service
7. Misconfigured API gateway
8. Compromised internal service
9. Incorrect data sync
10. Admin UI without validation
```

### 26.2 Defenses

1. Server-side attribute retrieval.
2. Signed tokens only for claims from trusted issuer.
3. Gateway strips spoofable headers.
4. mTLS/service identity for internal calls.
5. Attribute validation at write time.
6. Attribute provenance in audit.
7. Deny if attribute provenance is unknown.
8. Separate user input from authorization attributes.

---

## 27. ABAC and Caching

ABAC caching is tricky because decision depends on many attributes.

### 27.1 What Can Be Cached?

```text
Subject permissions       -> yes, short TTL / event invalidation
Subject department        -> yes, medium TTL
Resource attributes       -> yes for read, careful for mutation
Policy definitions        -> yes, versioned
Decision result           -> sometimes, with precise key
Environment attributes    -> mostly no
```

### 27.2 Decision Cache Key

Bad key:

```text
userId + action + resourceId
```

Missing:

1. policy version;
2. resource state;
3. resource sensitivity;
4. subject permissions version;
5. tenant;
6. environment channel;
7. MFA age bucket;
8. delegation state.

Safer key:

```text
tenantId
subjectId
subjectEntitlementVersion
actionName
resourceType
resourceId
resourceVersion
policyVersion
contextClass
```

For mutation, decision caching should usually be avoided or extremely short-lived.

### 27.3 Cache Invalidation Events

```text
USER_ROLE_CHANGED
USER_SUSPENDED
DELEGATION_GRANTED
DELEGATION_REVOKED
CASE_ASSIGNED
CASE_STATE_CHANGED
CASE_SENSITIVITY_CHANGED
POLICY_VERSION_DEPLOYED
```

Top 1% insight:

> Authorization cache correctness is more important than hit rate. A fast stale permit is a security bug.

---

## 28. ABAC and Audit

ABAC decisions are harder to audit than RBAC because many attributes contribute.

Audit must capture enough evidence without leaking sensitive data.

### 28.1 Decision Audit Fields

```text
- decisionId
- correlationId
- timestamp
- subject id
- subject attribute summary
- action
- resource type
- resource id
- resource attribute summary
- environment summary
- policy id
- policy version
- effect
- reason code
- rule results
- obligations
- enforcement result
```

### 28.2 Do Not Log Everything Blindly

Sensitive attributes may include:

```text
PII
health data
investigation notes
legal privilege data
risk scoring detail
internal remarks
```

Log codes and hashes where possible.

Example:

```json
{
  "decisionId": "AUTHZ-20260619-0001",
  "correlationId": "REQ-abc",
  "subjectId": "U-1001",
  "action": "case.approve",
  "resourceType": "case",
  "resourceId": "C-9001",
  "policyId": "case-approve-policy",
  "policyVersion": "2026.06.19.1",
  "effect": "DENY",
  "reason": "MAKER_CANNOT_APPROVE_OWN_CASE",
  "rules": [
    "HAS_PERMISSION_case.approve:PERMISSION_PRESENT_case.approve",
    "SAME_AGENCY:SAME_AGENCY",
    "CASE_STATE_PENDING_REVIEW:CASE_PENDING_REVIEW",
    "MAKER_CANNOT_APPROVE_OWN_CASE:MAKER_CANNOT_APPROVE_OWN_CASE"
  ]
}
```

---

## 29. ABAC Failure Modes

### 29.1 Missing Attribute Allow

Policy treats missing attribute as safe value.

```java
if (!Boolean.TRUE.equals(resource.isConfidential())) {
    allow();
}
```

If `isConfidential == null`, allow.

Safer:

```java
if (resource.isConfidential() == null) {
    return indeterminate("MISSING_CONFIDENTIALITY_FLAG");
}
```

### 29.2 Stale Attribute Permit

Permission revoked, cached decision still permit.

Mitigation:

1. short TTL;
2. versioned entitlement;
3. invalidation event;
4. check high-risk permission fresh.

### 29.3 Attribute Trust Boundary Violation

Using browser header as trusted attribute.

Mitigation:

1. header stripping;
2. trusted gateway;
3. mTLS;
4. signature;
5. server-side lookup.

### 29.4 Policy Drift

Code condition and policy document disagree.

Mitigation:

1. central policy definitions;
2. golden tests;
3. ADR;
4. policy version audit.

### 29.5 Query Bypass

Detail endpoint checks ABAC; search endpoint does not.

Mitigation:

1. query predicate authorization;
2. repository-level scoping;
3. API security tests.

### 29.6 Export Bypass

UI page masks fields, export includes all fields.

Mitigation:

1. field-level policy reused by export;
2. export-specific permission;
3. watermark/audit obligation.

### 29.7 Async Job Bypass

User triggers job; job runs later without checking current authorization.

Mitigation:

1. check at request time;
2. store authorization snapshot;
3. check again at execution time for sensitive jobs;
4. define policy for revocation between submit and execute.

---

## 30. ABAC Testing Strategy

### 30.1 Rule Unit Tests

Each rule should be tested independently.

```java
@Test
public void deniesWhenMakerApprovesOwnCase() {
    SubjectAttributes subject = subject("U-1");
    CaseResourceAttributes resource = caseResourceCreatedBy("U-1");

    RuleResult result = new MakerCannotApproveOwnCaseRule()
        .evaluate(snapshot(subject, resource));

    assertEquals(DecisionEffect.DENY, result.effect());
    assertEquals("MAKER_CANNOT_APPROVE_OWN_CASE", result.code());
}
```

### 30.2 Missing Attribute Tests

```java
@Test
public void indeterminateWhenCreatedByMissing() {
    SubjectAttributes subject = subject("U-1");
    CaseResourceAttributes resource = caseResourceCreatedBy(null);

    RuleResult result = new MakerCannotApproveOwnCaseRule()
        .evaluate(snapshot(subject, resource));

    assertEquals(DecisionEffect.INDETERMINATE, result.effect());
}
```

### 30.3 Policy Matrix Tests

```text
+------------+----------+---------------+---------------+----------+
| Permission | Agency   | State         | CreatedBySelf | Expected |
+------------+----------+---------------+---------------+----------+
| yes        | same     | pending       | no            | permit   |
| no         | same     | pending       | no            | deny     |
| yes        | different| pending       | no            | deny     |
| yes        | same     | approved      | no            | deny     |
| yes        | same     | pending       | yes           | deny     |
+------------+----------+---------------+---------------+----------+
```

### 30.4 Property-Based Tests

Useful invariant:

```text
For any subject/resource/action:
  if subject.agency != resource.agency, decision must not be PERMIT.
```

Another:

```text
For any approve action:
  if subject.userId == resource.createdBy, decision must not be PERMIT.
```

### 30.5 API Tests

Test both:

```text
GET /cases/{id}
GET /cases?page=...
POST /cases/{id}/approve
POST /cases/bulk-approve
GET /cases/export
```

Authorization test must cover alternate paths.

---

## 31. ABAC Production Checklist

Before deploying ABAC policy, check:

```text
[ ] Is each attribute defined?
[ ] Does each attribute have source of truth?
[ ] Is attribute trust level documented?
[ ] Is freshness requirement documented?
[ ] Are missing attributes deny/indeterminate by default?
[ ] Are resource attributes loaded server-side?
[ ] Are request-body attributes never trusted directly?
[ ] Are query/listing endpoints scoped?
[ ] Are export/report endpoints scoped?
[ ] Is decision audit produced?
[ ] Is policy version logged?
[ ] Are obligations enforced?
[ ] Are cache keys complete?
[ ] Are revocation paths tested?
[ ] Are high-risk actions protected by fresh attributes?
[ ] Are bulk operations authorized per object or safely scoped?
[ ] Are async jobs re-authorized appropriately?
[ ] Are tests covering negative cases?
```

---

## 32. ABAC vs Other Models

```text
+-------+-----------------------------+--------------------------------+
| Model | Best For                    | Weakness                       |
+-------+-----------------------------+--------------------------------+
| RBAC  | stable job functions         | role explosion                 |
| ABAC  | contextual constraints       | audit/performance complexity   |
| ACL   | per-object grants            | expensive at scale             |
| ReBAC | graph relationships          | consistency/model complexity   |
| PBAC  | externalized policy          | governance/tooling complexity  |
+-------+-----------------------------+--------------------------------+
```

ABAC is strongest when:

1. attributes are reliable;
2. policy is explainable;
3. query scoping is handled;
4. audit evidence is first-class;
5. caching is conservative;
6. failure defaults are safe.

---

## 33. Common ABAC Anti-Patterns

### Anti-Pattern 1 — ABAC as Random `if` Statements

```java
if (user.getDepartment().equals(case.getDepartment())) { ... }
if (user.isSenior()) { ... }
if (case.isHighRisk()) { ... }
```

Symptoms:

1. no central policy;
2. no reason code;
3. no audit;
4. inconsistent semantics;
5. impossible review.

Fix:

```text
policy object + decision object + attribute snapshot + tests
```

### Anti-Pattern 2 — Attribute in JWT Everything

Symptoms:

1. token too large;
2. stale privilege;
3. revocation delay;
4. claim semantics unclear.

Fix:

```text
token carries identity evidence;
server resolves high-risk/current attributes.
```

### Anti-Pattern 3 — Filter After Fetch

Symptoms:

1. wrong pagination;
2. data leakage risk;
3. poor performance.

Fix:

```text
translate ABAC read constraints into query predicates.
```

### Anti-Pattern 4 — Environment Attribute From Untrusted Header

Fix:

```text
trusted edge strips and injects;
service verifies trust boundary;
unknown means deny.
```

### Anti-Pattern 5 — Boolean Decision Only

Fix:

```text
structured decision with effect, reason, rules, obligations, evidence.
```

---

## 34. Design Example: Case Approval ABAC End-to-End

### 34.1 Business Policy

```text
A user may approve a case only if:
1. user has permission case.approve;
2. user belongs to the same agency as the case;
3. case state is PENDING_REVIEW;
4. user is not the creator of the case;
5. user has clearance >= case sensitivity;
6. request is from intranet;
7. if case sensitivity is HIGH, MFA must be fresh within 15 minutes;
8. approval reason must be present.
```

### 34.2 Attribute Mapping

```text
subject.permissions            -> entitlement service
subject.agencyId               -> user profile
subject.userId                 -> identity provider
subject.clearance              -> user profile/security admin
resource.agencyId              -> case DB
resource.state                 -> case DB
resource.createdBy             -> case DB
resource.sensitivity           -> case DB/classification
environment.networkZone        -> trusted gateway/service mesh
environment.mfaAge             -> auth/session service
request.reason                 -> command input, validated as obligation input
```

### 34.3 Policy Rules

```text
HAS_PERMISSION(case.approve)
SAME_AGENCY
CASE_PENDING_REVIEW
NOT_MAKER
CLEARANCE_DOMINATES_SENSITIVITY
INTRANET_ONLY
FRESH_MFA_FOR_HIGH_SENSITIVITY
APPROVAL_REASON_REQUIRED
```

### 34.4 Enforcement Flow

```text
POST /cases/{id}/approve
  Controller parses command
  Application service loads subject
  Application service locks/loads case auth view
  Attribute resolver builds snapshot
  Authorization service evaluates policy
  Decision enforcer handles deny/obligations
  Domain model performs approve transition
  Audit logs business action + authz decision
  Transaction commits
```

### 34.5 Failure Table

```text
+-----------------------------------+-------------------------------+
| Condition                         | Decision                      |
+-----------------------------------+-------------------------------+
| Missing permission                | DENY                          |
| Different agency                  | DENY                          |
| Case not pending review           | DENY or business conflict     |
| Maker approves own case           | DENY                          |
| Missing sensitivity               | INDETERMINATE -> DENY         |
| Insufficient clearance            | DENY                          |
| Unknown network zone              | INDETERMINATE -> DENY         |
| High sensitivity, stale MFA       | DENY or STEP_UP_REQUIRED      |
| Missing reason                    | DENY / obligation failure     |
+-----------------------------------+-------------------------------+
```

---

## 35. How Top 1% Engineers Think About ABAC

Top engineers do not ask only:

> “Can I express this rule?”

They ask:

1. **Is the attribute trustworthy?**
2. **Is it fresh enough for this decision?**
3. **Can this rule be audited?**
4. **Can this rule be tested independently?**
5. **Can this rule be applied to listing/export/bulk paths?**
6. **What happens if the attribute source is down?**
7. **Can the decision be reconstructed later?**
8. **Does this create role explosion or reduce it?**
9. **Does this create policy spaghetti?**
10. **Is the authorization check inside the correct transaction boundary?**
11. **Could an attacker manipulate any input attribute?**
12. **What is the revocation delay?**
13. **Does cache correctness depend on hidden assumptions?**
14. **Are deny reasons safe to expose?**
15. **Does this policy remain understandable six months later?**

ABAC is powerful, but power increases design responsibility.

---

## 36. Summary

ABAC adalah model authorization yang mengevaluasi atribut subject, resource, action, dan environment terhadap policy.

ABAC membantu ketika authorization bergantung pada:

1. ownership;
2. tenant/agency boundary;
3. resource state;
4. sensitivity;
5. clearance;
6. department/team;
7. time;
8. network zone;
9. MFA freshness;
10. conflict-of-interest;
11. workflow transition;
12. field-level access.

Namun ABAC berbahaya jika:

1. atribut tidak punya source of truth;
2. atribut bisa dimanipulasi client;
3. atribut stale;
4. missing attribute dianggap allow;
5. policy tersebar sebagai random `if`;
6. listing/export tidak discoped;
7. decision tidak diaudit;
8. caching tidak memperhitungkan versi atribut/policy.

Mental model inti:

```text
ABAC = authorization by evaluated evidence.
```

Bukan:

```text
ABAC = many if statements.
```

Formula praktis:

```text
PERMIT only if:
  subject has base capability
  AND subject/resource/action/environment attributes satisfy policy
  AND required attributes are present and trusted
  AND obligations can be enforced
  AND decision is made within correct consistency boundary
```

---

## 37. References

Referensi konseptual dan dokumentasi resmi yang relevan:

1. NIST SP 800-162 — *Guide to Attribute Based Access Control (ABAC) Definition and Considerations*.
2. Spring Security Reference — Authorization Architecture and `AuthorizationManager`.
3. Spring Security Reference — Method Security and expression-based authorization.
4. OWASP API Security Top 10 2023 — Broken Object Level Authorization.
5. OWASP API Security Top 10 2023 — Broken Object Property Level Authorization.
6. Open Policy Agent documentation — policy-based control and externalized authorization concepts.
7. Jakarta Authorization specification.
8. Jakarta Security specification.

---

## 38. Status Seri

Selesai:

```text
[x] Part 0 — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
[x] Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4 — RBAC Done Properly: Role-Based Access Control Beyond ADMIN
[x] Part 5 — Permission and Capability Modeling
[x] Part 6 — ABAC: Attribute-Based Authorization
```

Berikutnya:

```text
[ ] Part 7 — PBAC and Policy-as-Code
```

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-005.md">⬅️ Part 5 — Permission and Capability Modeling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-007.md">Java Authorization Modes and Patterns — Part 7 ➡️</a>
</div>
