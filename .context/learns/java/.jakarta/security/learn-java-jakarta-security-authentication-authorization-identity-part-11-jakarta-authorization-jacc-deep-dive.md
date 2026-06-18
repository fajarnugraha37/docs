# Part 11 — Jakarta Authorization / JACC Deep Dive

> Series: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-11-jakarta-authorization-jacc-deep-dive.md`  
> Scope: Java 8–25, Java EE / Jakarta EE security architecture, Jakarta Authorization / JACC, Servlet/EJB container authorization, subject-permission model, policy provider, defensible authorization design.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. mental model enterprise Java security,
2. identity, principal, subject, group, role, permission,
3. sejarah JAAS, JASPIC/Jakarta Authentication, JACC/Jakarta Authorization,
4. arsitektur container security,
5. Servlet security,
6. authentication mechanisms,
7. Jakarta Security API,
8. `SecurityContext`,
9. `IdentityStore`,
10. Jakarta Authentication / JASPIC.

Part ini masuk ke sisi yang sering jauh lebih jarang dipahami developer: **Jakarta Authorization**, yang sebelumnya dikenal sebagai **JACC** — Java Authorization Contract for Containers.

Topik ini bukan tentang `@RolesAllowed` secara praktis saja. Itu sudah akan dibahas dari sudut developer API pada part deklaratif/programmatik authorization. Di sini kita masuk ke pertanyaan yang lebih dalam:

> Bagaimana container mengubah metadata security seperti `web.xml`, `@ServletSecurity`, `@RolesAllowed`, role reference, dan deployment mapping menjadi decision authorization yang bisa dievaluasi terhadap subject/caller?

Atau dalam bahasa arsitektural:

> Authentication menetapkan siapa caller-nya. Jakarta Authorization membantu container menentukan apakah subject tersebut memiliki permission untuk melakukan operasi tertentu.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. memahami kenapa Jakarta Authorization/JACC ada;
2. membedakan role check aplikasi dengan subject-permission check container;
3. memahami konsep permission repository, policy provider, dan policy configuration;
4. memahami bagaimana security constraints Servlet/EJB ditransformasi menjadi permission;
5. memahami role reference mapping dan deployment-time authorization configuration;
6. membaca bug authorization container dengan mental model yang benar;
7. membedakan Jakarta Authorization dari Jakarta Security dan Jakarta Authentication;
8. mendesain authorization yang lebih defensible untuk enterprise/regulatory systems;
9. memahami batas relevansi JACC di aplikasi modern;
10. tahu kapan tidak perlu menyentuh Jakarta Authorization langsung.

---

## 2. Apa Itu Jakarta Authorization?

**Jakarta Authorization** adalah low-level SPI untuk authorization modules. Secara konseptual, ia menyediakan kontrak agar container Jakarta EE dapat:

1. merepresentasikan operasi yang dilindungi sebagai permission;
2. mengonfigurasi policy berdasarkan metadata deployment;
3. mengevaluasi apakah suatu subject/caller memiliki permission tertentu;
4. menjembatani security model container seperti Servlet dan Enterprise Beans ke model authorization berbasis permission.

Nama historisnya adalah **JACC**: Java Authorization Contract for Containers.

Kalau Jakarta Authentication menjawab:

```text
Bagaimana container mendapatkan dan menetapkan identity caller?
```

Jakarta Authorization menjawab:

```text
Setelah caller diketahui, bagaimana container menentukan boleh/tidaknya caller mengakses resource container tertentu?
```

---

## 3. Mental Model Paling Penting

Bayangkan request berikut:

```http
GET /admin/reports/monthly HTTP/1.1
Cookie: JSESSIONID=...
```

Container harus menjawab beberapa pertanyaan:

1. Apakah path `/admin/reports/monthly` dilindungi?
2. Apakah method `GET` dilindungi?
3. Role apa yang diperbolehkan?
4. Caller sekarang siapa?
5. Caller memiliki principal/group/role apa?
6. Apakah caller memiliki permission untuk resource ini?
7. Jika tidak authenticated, apakah harus challenge/redirect?
8. Jika authenticated tapi tidak authorized, apakah harus 403?

Pada level aplikasi, developer biasanya melihat:

```java
request.isUserInRole("ADMIN")
```

atau:

```java
@RolesAllowed("ADMIN")
```

Tetapi pada level container authorization, itu bisa dipahami sebagai:

```text
Subject + requested operation + configured policy -> allow / deny
```

Lebih abstrak:

```text
authorizationDecision = policy.implies(subject, permission)
```

Inilah mental model Jakarta Authorization.

---

## 4. Layer Security Yang Harus Dibedakan

| Layer | Pertanyaan | Contoh API/Spec |
|---|---|---|
| Authentication | Siapa caller ini? | Jakarta Authentication, Jakarta Security, Servlet login |
| Identity Store | Credential valid atau tidak? Group apa? | Jakarta Security `IdentityStore` |
| Container Security | Bagaimana identity melekat ke request/thread/session? | Servlet/EJB container |
| Declarative Authorization | Metadata apa yang menyatakan akses boleh/tidak? | `web.xml`, `@ServletSecurity`, `@RolesAllowed` |
| Authorization SPI | Bagaimana metadata itu menjadi permission dan dievaluasi? | Jakarta Authorization / JACC |
| Domain Authorization | Apakah actor boleh melakukan action terhadap resource bisnis tertentu? | custom policy engine, ABAC/ReBAC/domain service |

Jakarta Authorization berada di bawah declarative authorization, bukan menggantikan domain authorization.

---

## 5. Kenapa Jakarta Authorization Tidak Populer Di Application Code?

Banyak developer senior pun jarang menulis kode Jakarta Authorization langsung. Alasannya:

1. sebagian besar use case cukup memakai Jakarta Security, Servlet security, EJB/CDI method security, atau framework seperti Spring Security;
2. JACC/Jakarta Authorization adalah SPI untuk container/provider, bukan API harian developer;
3. implementasi dan konfigurasi sering vendor-specific;
4. domain authorization modern sering lebih ekspresif jika dibuat di application layer;
5. banyak aplikasi tidak memakai full Java/Jakarta EE container authorization secara mendalam.

Namun, memahami Jakarta Authorization tetap penting karena:

1. membantu debugging authorization yang terlihat “aneh”;
2. menjelaskan kenapa role mapping deployment bisa berbeda dari group IdP;
3. menjelaskan bagaimana `@RolesAllowed` menjadi enforcement container;
4. membantu memahami perbedaan role, permission, policy, dan principal;
5. sangat berguna untuk sistem enterprise/regulatory yang butuh auditability dan defensibility.

---

## 6. Core Abstraction: Subject, Permission, Policy

Jakarta Authorization bekerja dekat dengan model klasik Java security:

```text
Subject
  -> set of Principals
  -> possibly credentials

Permission
  -> object representing protected operation/resource

Policy
  -> rules that say whether a Subject has a Permission
```

### 6.1 Subject

`Subject` merepresentasikan caller/security identity dalam bentuk kumpulan principal dan credential.

Contoh principal di dalam subject:

```text
CallerPrincipal("fajar")
GroupPrincipal("CASE_OFFICER")
GroupPrincipal("REPORT_VIEWER")
TenantPrincipal("CEA")
```

Dalam container, subject bukan sekadar username. Ia bisa menjadi carrier untuk:

1. user principal;
2. group principals;
3. role-mapped principals;
4. service principal;
5. run-as principal;
6. credential internal.

### 6.2 Permission

Permission adalah representasi operasi yang ingin dilakukan.

Contoh konseptual:

```text
WebResourcePermission("/admin/reports/*", "GET")
EJBMethodPermission("CaseService", "approve")
```

Permission bukan selalu “role”. Role adalah salah satu cara mengelompokkan hak. Permission lebih dekat ke operasi/resource yang ingin diakses.

### 6.3 Policy

Policy adalah aturan yang menentukan:

```text
Apakah subject S memiliki permission P?
```

Pseudo-code:

```java
boolean allowed = policy.implies(subject, permission);
```

Dalam praktik container:

```text
authenticated subject + requested servlet resource + configured security constraints
        -> allow / deny
```

---

## 7. Role Bukan Primitive Terdalam

Di application code, kita sering berpikir:

```text
User punya role ADMIN.
ADMIN boleh akses /admin.
```

Di model authorization yang lebih dalam, role adalah perantara:

```text
Subject has principals/groups
Groups map to roles
Roles map to permissions
Permission protects resource operation
Policy evaluates subject against permission
```

Rantai lengkapnya:

```text
Credential
  -> Authentication
  -> Subject / CallerPrincipal
  -> Groups
  -> Application Roles
  -> Permissions
  -> Resource access decision
```

Kesalahan umum adalah berhenti di tengah:

```text
User has group = Finance_Admin
therefore user is allowed to approve payment
```

Padahal untuk enterprise system, seharusnya:

```text
User authenticated as subject
Subject belongs to IdP group Finance_Admin
Group mapped to application role PAYMENT_APPROVER
Role grants permission payment.approve
Permission is valid only for tenant/org/account/state/amount threshold
Decision is audited
```

---

## 8. Jakarta Authorization Dalam Request Lifecycle

Untuk request web, lifecycle konseptualnya seperti ini:

```text
[1] HTTP request arrives
        |
[2] Container resolves target resource
        |
[3] Container checks if resource has security constraint
        |
[4] If authentication required, authentication mechanism runs
        |
[5] Caller principal + groups established
        |
[6] Container builds/checks permission for requested resource
        |
[7] Policy provider evaluates subject + permission
        |
[8] Allow -> invoke servlet/JAX-RS/CDI/EJB
        |
[9] Deny -> 401 or 403 depending on authentication state
```

Important distinction:

```text
401 = caller belum authenticated atau perlu challenge authentication
403 = caller sudah authenticated tapi tidak punya authorization
```

Namun redirect-based login bisa membuat behavior terlihat tidak seperti raw 401.

---

## 9. Permission Di Dunia Servlet

Servlet container memiliki konsep security constraint:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin Area</web-resource-name>
        <url-pattern>/admin/*</url-pattern>
        <http-method>GET</http-method>
        <http-method>POST</http-method>
    </web-resource-collection>
    <auth-constraint>
        <role-name>ADMIN</role-name>
    </auth-constraint>
</security-constraint>
```

Secara developer-facing, artinya:

```text
/admin/* untuk GET/POST hanya boleh ADMIN.
```

Secara authorization SPI, container perlu mengubah metadata ini menjadi permission model yang bisa dievaluasi.

Conceptual transformation:

```text
URL pattern + HTTP method + security constraint
        -> WebResourcePermission / WebUserDataPermission
        -> role-to-permission mapping
        -> policy decision
```

### 9.1 WebResourcePermission

Secara konseptual merepresentasikan akses ke resource web tertentu.

Misal:

```text
permission: access /admin/* using GET
```

### 9.2 WebUserDataPermission

Merepresentasikan requirement terhadap transport/user data constraint.

Misal:

```text
/admin/* must be accessed over CONFIDENTIAL transport
```

Ini berkaitan dengan requirement seperti HTTPS.

### 9.3 URL Pattern Matching

Servlet URL pattern tidak sesederhana string startsWith. Ada aturan pattern:

1. exact match;
2. path prefix match seperti `/admin/*`;
3. extension match seperti `*.jsp`;
4. default mapping `/`;
5. context path terpisah dari servlet path.

Kesalahan pada pattern bisa menyebabkan resource terbuka.

Contoh failure:

```text
Expected protected: /admin/report/export.csv
Constraint configured: /admin/reports/*
Actual URL: /admin/report/export.csv
Result: not protected
```

Satu huruf beda bisa menjadi bypass.

---

## 10. Permission Di Dunia Enterprise Beans

Pada Enterprise Beans/EJB, security sering berada di method-level:

```java
@Stateless
@RolesAllowed("CASE_APPROVER")
public class CaseApprovalService {

    public void approveCase(Long caseId) {
        // business operation
    }
}
```

Container perlu mengubah ini menjadi permission terhadap method tertentu:

```text
EJBMethodPermission(
  bean = CaseApprovalService,
  method = approveCase,
  parameters = [Long]
)
```

Authorization decision tidak hanya path HTTP, tapi method invocation.

Lifecycle konseptual:

```text
Client invokes EJB method
        |
Container intercepts call
        |
Resolve caller subject
        |
Resolve method permission
        |
Check policy
        |
Allow or deny
```

---

## 11. Role Reference Mapping

Salah satu bagian paling membingungkan di Java/Jakarta EE security adalah **role reference**.

Developer bisa menulis:

```java
request.isUserInRole("manager")
```

Namun `manager` bisa merupakan role reference lokal, bukan role global final.

Di deployment descriptor, role reference bisa dipetakan:

```xml
<security-role-ref>
    <role-name>manager</role-name>
    <role-link>CASE_MANAGER</role-link>
</security-role-ref>
```

Artinya:

```text
Di kode servlet ini, "manager" berarti role aplikasi CASE_MANAGER.
```

### 11.1 Kenapa Ada Role Reference?

Agar komponen bisa memakai nama role lokal tanpa hardcode role global deployment.

Misal satu komponen reusable:

```text
Component local role: approver
Deployment A maps approver -> CLAIM_APPROVER
Deployment B maps approver -> LICENSE_APPROVER
```

### 11.2 Risiko Role Reference

Role reference membuat fleksibel, tapi membuka class bug:

1. role reference tidak dimap;
2. role-link salah;
3. nama role lokal sama dengan global tapi maknanya beda;
4. code review melihat `manager`, deployment mapping sebenarnya `SUPER_ADMIN`;
5. environment DEV/UAT/PROD mapping berbeda.

### 11.3 Invariant

Untuk sistem production:

```text
Setiap role reference harus eksplisit, terdokumentasi, diuji, dan diaudit.
```

Jangan biarkan role reference menjadi magic deployment behavior.

---

## 12. Policy Configuration

Jakarta Authorization bukan hanya runtime check. Ada fase konfigurasi policy.

Mental model:

```text
Deployment metadata
  -> parse security constraints
  -> generate permissions
  -> associate permissions with roles
  -> commit policy configuration
  -> runtime policy evaluation
```

Tahapan konseptual:

```text
[Deploy application]
        |
[Container scans descriptors/annotations]
        |
[Container generates permission set]
        |
[Container configures policy provider]
        |
[Policy committed]
        |
[Runtime request checks use committed policy]
```

### 12.1 Deployment-Time Authorization

Banyak authorization metadata container bukan dihitung dari nol setiap request. Ia disiapkan saat deployment.

Keuntungannya:

1. lebih cepat saat runtime;
2. deployment bisa gagal jika config invalid;
3. permission model konsisten selama aplikasi berjalan.

Risikonya:

1. policy stale jika external role mapping berubah tapi app tidak reload;
2. dynamic policy sulit;
3. debugging lebih susah karena source authorization tersebar di annotation/descriptors/vendor config.

---

## 13. Policy Provider

Policy provider adalah komponen yang menyimpan dan mengevaluasi permission.

Secara konseptual:

```text
PolicyProvider
  - stores permissions
  - stores role-to-permission mapping
  - evaluates subject permissions
```

Pseudo-interface:

```java
interface ConceptualPolicyProvider {
    boolean implies(Subject subject, Permission permission);
}
```

Dalam container, provider ini biasanya bukan sesuatu yang kamu implementasikan untuk aplikasi biasa.

Use case custom provider:

1. application server vendor;
2. enterprise security platform;
3. centralized policy integration;
4. specialized regulated environment;
5. compatibility with legacy authorization repository.

---

## 14. Role as Named Collection of Permissions

Di model Jakarta Authorization, role bisa dipahami sebagai named collection of permissions.

Misal:

```text
Role: CASE_MANAGER
Permissions:
  - GET /cases/*
  - POST /cases/*/assign
  - invoke CaseAssignmentService.assign
```

Tetapi jangan salah: ini masih container-level permission. Belum tentu cukup untuk domain-level rule.

Misal `CASE_MANAGER` boleh akses endpoint assign, tetapi domain rule tetap perlu mengecek:

1. case ada di tenant yang sama;
2. case belum closed;
3. assignee valid;
4. actor bukan assignee jika four-eyes rule berlaku;
5. assignment tidak melanggar workload/escalation rule.

Jadi role grants access to operation class, bukan selalu final business decision.

---

## 15. Container Authorization vs Domain Authorization

Ini poin top 1% yang penting.

Container authorization cocok untuk:

1. endpoint-level access;
2. method-level access;
3. coarse-grained role access;
4. transport constraint;
5. standardized enforcement;
6. reusable Jakarta EE semantics.

Domain authorization cocok untuk:

1. object-level access;
2. row-level access;
3. tenant boundary;
4. case state;
5. assignment;
6. delegation;
7. ownership;
8. regulatory rules;
9. contextual permission;
10. auditable denial reason.

Contoh:

```java
@RolesAllowed("CASE_APPROVER")
public ApprovalResult approve(Long caseId) {
    authorizationService.requireCanApprove(actor(), caseId);
    return approvalWorkflow.approve(caseId);
}
```

Interpretasi:

```text
@RolesAllowed = coarse gate
authorizationService = domain-specific gate
```

Keduanya bukan saling menggantikan.

---

## 16. Subject-Based Security

Jakarta Authorization memfasilitasi subject-based security.

Artinya decision tidak hanya berdasarkan string username, tetapi berdasarkan subject yang berisi principals.

Contoh subject:

```text
Subject
  Principals:
    CallerPrincipal: alice
    GroupPrincipal: CASE_OFFICER
    GroupPrincipal: REPORT_VIEWER
    TenantPrincipal: agency-A
    AuthnMethodPrincipal: OIDC
```

Policy bisa mengevaluasi berdasarkan principals tersebut.

Secara teori, model subject lebih fleksibel daripada sekadar:

```text
username -> role list
```

Karena subject bisa membawa banyak jenis principal.

Namun dalam banyak container, exposed behavior ke aplikasi tetap disederhanakan menjadi:

```java
getUserPrincipal()
isUserInRole(role)
```

---

## 17. Permission Collection

Permission tidak berdiri sendiri. Ia sering dikelompokkan dalam permission collection.

Conceptual model:

```text
CASE_MANAGER role:
  PermissionCollection:
    WebResourcePermission(/cases/*, GET)
    WebResourcePermission(/cases/*, POST)
    EJBMethodPermission(CaseService, update)
```

Policy evaluation bertanya:

```text
Does subject's permission collection imply requested permission?
```

Important nuance:

```text
Permission implication can be broader than equality.
```

Misal permission `/admin/*` bisa imply `/admin/report` tergantung semantics permission class.

Karena itu matching permission harus deterministic dan dipahami.

---

## 18. Permission Implication

Permission check biasanya bukan:

```text
permissionA.equals(permissionB)
```

Melainkan:

```text
permissionA.implies(permissionB)
```

Contoh:

```text
Granted: /admin/* GET
Requested: /admin/reports GET
Result: implied / allowed
```

Contoh lain:

```text
Granted: /admin/reports GET
Requested: /admin/reports POST
Result: not implied / denied
```

Implication membuat permission bisa express wildcard/pattern/range/action set.

Namun implication juga sumber bug jika terlalu luas.

---

## 19. Default Deny vs Default Allow

Security posture terbaik:

```text
Unknown resource/action -> denied unless explicitly allowed.
```

Namun banyak aplikasi web historis punya area public by default.

Maka desain harus membedakan:

1. public resources;
2. authenticated resources;
3. role-protected resources;
4. admin-only resources;
5. internal/system resources.

Jangan hanya mengandalkan asumsi:

```text
Kalau tidak ada constraint, berarti aman karena endpoint tidak dipakai.
```

Di web app, endpoint yang tidak dikunci adalah endpoint publik.

---

## 20. Excluded, Unchecked, and Role-Protected Permissions

Dalam container authorization, biasanya ada kategori konseptual:

### 20.1 Excluded

Resource/action tidak boleh diakses siapa pun.

Contoh:

```text
DELETE /internal/debug/* -> excluded
```

### 20.2 Unchecked

Resource/action boleh diakses tanpa role tertentu.

Contoh:

```text
GET /public/* -> unchecked
```

Hati-hati: unchecked bukan berarti tidak penting. Ia berarti policy tidak membutuhkan authorization role.

### 20.3 Role-Protected

Resource/action hanya boleh untuk role tertentu.

Contoh:

```text
POST /cases/*/approve -> CASE_APPROVER
```

### 20.4 Common Misconfiguration

```text
Expected: authenticated users only
Configured: unchecked
Actual: anonymous public access
```

Atau:

```text
Expected: denied for all
Configured: no matching constraint
Actual: accessible
```

---

## 21. Authorization Metadata Sources

Authorization rule bisa datang dari banyak tempat:

1. `web.xml`;
2. `@ServletSecurity`;
3. `@RolesAllowed`;
4. `@PermitAll`;
5. `@DenyAll`;
6. EJB deployment descriptor;
7. vendor-specific deployment descriptor;
8. application server admin console;
9. identity provider group mapping;
10. custom realm mapping;
11. application-level policy table.

Top 1% debugging mindset:

```text
Jangan tanya hanya “annotation-nya apa?”
Tanya “authorization decision ini berasal dari metadata source mana, diproses oleh layer mana, dan dimapping ke role/permission mana?”
```

---

## 22. Jakarta Authorization Dengan `javax` vs `jakarta`

Secara historis:

```text
Java EE / JACC -> javax.security.jacc
Jakarta EE -> jakarta.security.jacc / Jakarta Authorization naming
```

Migration concern:

1. package namespace berubah;
2. container support berbeda;
3. dependency coordinate berubah;
4. application server version harus compatible;
5. old libraries bisa masih refer ke `javax.*`;
6. migration bukan search-replace semata karena runtime contract juga berubah.

Java version concern:

| Era | Typical Stack |
|---|---|
| Java 8 | Java EE 7/8, `javax.*`, legacy app servers |
| Java 11 | transition era, Jakarta EE 8/9 possible |
| Java 17 | Jakarta EE 10/11 baseline era |
| Java 21 | modern LTS runtime, virtual thread awareness |
| Java 25 | modern JDK runtime, Jakarta EE compatibility depends on container |

Important:

```text
Aplikasi boleh berjalan di JDK modern, tetapi API Jakarta EE yang tersedia ditentukan oleh container/app server, bukan hanya JDK.
```

---

## 23. SecurityManager Legacy Concern

Java SecurityManager secara historis dekat dengan `java.security.Policy` dan permission model Java SE.

Namun di Java modern, SecurityManager sudah deprecated for removal dan akhirnya tidak lagi menjadi fondasi yang relevan untuk sandboxing aplikasi modern.

Implikasinya:

1. jangan mendesain aplikasi baru dengan asumsi SecurityManager sebagai enforcement utama;
2. Jakarta Authorization lebih relevan sebagai container authorization contract;
3. application/domain authorization tetap harus eksplisit;
4. runtime isolation lebih banyak ditangani oleh container, OS, Kubernetes, IAM, network policy, module boundaries, dan process isolation.

---

## 24. Bagaimana `@RolesAllowed` Bisa Menjadi Permission Check?

Developer menulis:

```java
@RolesAllowed("REPORT_VIEWER")
public Report getReport(String id) {
    return repository.find(id);
}
```

Container melihat metadata:

```text
method getReport requires role REPORT_VIEWER
```

Deployment-time:

```text
method -> permission
role -> permission mapping
```

Runtime:

```text
caller subject -> group/role mapping -> permission evaluation
```

Sequence:

```text
[Call method]
    |
[Interceptor/container resolves required permission]
    |
[Subject current caller]
    |
[Policy check]
    |
[Allow invoke or deny]
```

Application code tidak harus tahu semua ini, tetapi architect/debugger harus tahu.

---

## 25. Why `isUserInRole` Can Lie From Business Perspective

`isUserInRole("APPROVER")` bisa benar, tapi business decision tetap harus deny.

Contoh:

```text
Caller role: APPROVER
Action: approve case
Case state: DRAFT
Rule: only SUBMITTED case can be approved
Decision: deny
```

Atau:

```text
Caller role: APPROVER
Case tenant: Agency B
Caller tenant: Agency A
Decision: deny
```

Jadi role check menjawab:

```text
Does caller belong to role APPROVER in this container/application context?
```

Bukan:

```text
Is this business operation valid and allowed under all domain constraints?
```

---

## 26. Defensible Authorization Decision Model

Untuk sistem enterprise/regulatory, authorization harus bisa dijelaskan.

Minimum decision tuple:

```text
subject: who acts?
action: what operation?
resource: what object/resource?
context: tenant/state/channel/time/authn method?
policy: which rule/version?
decision: allow/deny?
reason: why?
```

Untuk container-level authorization, tuple-nya sering:

```text
subject: caller principal/groups
permission: web resource or method permission
policy: deployed container policy
decision: allow/deny
```

Untuk domain-level authorization:

```text
subject: actor
role/permission: application entitlement
tenant: active organization/resource tenant
resource: case/application/document
state: workflow state
action: approve/assign/view/export
constraints: maker-checker, assignment, ownership, SoD
decision: allow/deny
reason: deterministic denial code
```

---

## 27. Auditability

Authorization audit bukan hanya mencatat 403.

Untuk sensitive operation, catat juga successful authorization decision.

Contoh audit event:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decision": "DENY",
  "subject": "alice",
  "roles": ["CASE_APPROVER"],
  "action": "case.approve",
  "resourceType": "CASE",
  "resourceId": "CASE-2026-0001",
  "tenant": "AGENCY-A",
  "policy": "case-approval-policy-v7",
  "reason": "MAKER_CANNOT_APPROVE_OWN_CASE",
  "correlationId": "req-123"
}
```

For container-level event, you may only have:

```json
{
  "eventType": "CONTAINER_AUTHORIZATION_DENY",
  "subject": "alice",
  "resource": "/admin/reports",
  "method": "GET",
  "requiredRoles": ["ADMIN"],
  "correlationId": "req-123"
}
```

Both are useful, but they answer different questions.

---

## 28. Failure Model: Policy Not Loaded

Symptom:

```text
All protected resources return 403 after deployment.
```

Possible causes:

1. deployment descriptor parse error;
2. policy provider not initialized;
3. role mapping not committed;
4. incompatible `javax`/`jakarta` libraries;
5. application server feature not enabled;
6. custom provider registration failed.

Debugging questions:

1. Did application deploy successfully?
2. Did container log security constraint parsing?
3. Are roles declared?
4. Are role references mapped?
5. Is provider active?
6. Is this only one module or whole app?

---

## 29. Failure Model: Stale Policy

Symptom:

```text
Role mapping changed, but access behavior did not change.
```

Possible causes:

1. policy generated at deployment time;
2. server cache not refreshed;
3. old session still has old groups;
4. IdP token still contains old claims;
5. app server requires redeploy/restart;
6. role mapping changed in wrong environment.

Important distinction:

```text
Policy freshness != identity freshness != session freshness != token freshness
```

You need to know which layer is stale.

---

## 30. Failure Model: Role Reference Mismatch

Code:

```java
if (request.isUserInRole("manager")) {
    showManagerDashboard();
}
```

Expected:

```text
manager -> CASE_MANAGER
```

Actual deployment mapping:

```text
manager -> REPORT_VIEWER
```

Result:

```text
Wrong users see manager dashboard or valid managers denied.
```

Prevention:

1. avoid vague local role names;
2. test role reference mapping;
3. document mapping per module;
4. prefer explicit application roles in modern systems unless component reuse requires local role refs;
5. audit deployment descriptors.

---

## 31. Failure Model: Annotation/Descriptor Conflict

Common issue:

```text
Annotation says @PermitAll
web.xml says role required
vendor descriptor says different role
```

Depending on spec/container rules, precedence may not match developer expectation.

Debugging approach:

1. list all metadata sources;
2. determine effective security constraint;
3. verify generated policy;
4. test with anonymous/authenticated/authorized/unauthorized users;
5. do not rely only on reading one annotation.

---

## 32. Failure Model: URL Constraint Gap

Configured:

```xml
<url-pattern>/admin/*</url-pattern>
```

Unprotected endpoint:

```text
/api/admin/reports
```

Why?

```text
Pattern does not match.
```

Better practice:

1. define route inventory;
2. define security matrix;
3. add integration tests for every sensitive endpoint;
4. include negative tests;
5. monitor 404/403/200 anomalies;
6. use default-deny for API groups where possible.

---

## 33. Failure Model: Method Security Bypass

Example:

```java
@RolesAllowed("ADMIN")
public void deleteUser(String id) { ... }
```

Bypass possibility:

1. method called internally via self-invocation and interceptor not applied;
2. business logic duplicated in unprotected method;
3. endpoint calls repository directly;
4. async callback invokes operation outside security context;
5. reflection/proxy boundary bypass.

Container method security only protects invocation paths that pass through container/proxy/interceptor boundary.

Invariant:

```text
Every sensitive operation must have exactly one canonical enforcement path.
```

---

## 34. Failure Model: Group-to-Role Drift

External IdP group changed:

```text
OLD: CEA_CASE_APPROVER
NEW: CEA_CASE_APPROVAL_OFFICER
```

Application role mapping not updated.

Result:

```text
Users authenticated but lose authorization.
```

Or worse:

```text
New group accidentally mapped to broader role.
```

Prevention:

1. define stable application roles independent of IdP group names;
2. maintain mapping table/config;
3. version mapping;
4. test mapping during IdP change;
5. audit mapping changes;
6. avoid hardcoding external group names in business code.

---

## 35. Jakarta Authorization and Modern IdP Claims

Modern systems often receive claims:

```json
{
  "sub": "alice-id",
  "preferred_username": "alice",
  "groups": ["case-officer", "report-viewer"],
  "scope": "openid profile reports.read",
  "tenant": "agency-a"
}
```

Container authorization often expects roles/groups.

Mapping required:

```text
OIDC claim groups -> Jakarta groups -> application roles -> permissions
```

Do not treat token claim as final permission without validation.

Bad:

```java
if (jwt.getClaim("groups").contains("admin")) allow();
```

Better:

```text
Validate token
Validate issuer/audience/signature/expiry
Normalize groups
Map to application roles
Evaluate container/domain policy
Audit decision
```

---

## 36. Jakarta Authorization vs MicroProfile JWT

MicroProfile JWT commonly maps JWT claims into caller principal and groups for microservice/resource-server patterns.

Jakarta Authorization is lower-level container authorization SPI.

Comparison:

| Concern | Jakarta Authorization | MicroProfile JWT |
|---|---|---|
| Main purpose | Authorization SPI for container permission model | JWT-based authentication/authorization integration |
| Level | low-level container/provider | application/microservice-facing |
| Input | subject + permission | signed JWT claims |
| Common developer use | rare direct use | more common in MP apps |
| Protects | Servlet/EJB-style container operations | APIs/services using JWT groups/claims |

They can coexist, but solve different problems.

---

## 37. Jakarta Authorization vs Spring Security Authorization

Spring Security typically implements its own security filter chain, authentication manager, authorization manager, method security, expression handling, etc.

Jakarta Authorization belongs to Jakarta EE container security model.

Comparison:

| Concern | Jakarta Authorization | Spring Security |
|---|---|---|
| Execution model | Jakarta EE container | Spring filter/proxy/interceptor chain |
| Role check | container roles/policy | GrantedAuthority/AuthorizationManager |
| Domain policy | external/custom | often custom authorization service/expression |
| Portability | Jakarta EE compatible containers | Spring ecosystem |
| SPI target | container/provider | application framework extension |

If running Spring Boot embedded Tomcat, you usually rely on Spring Security rather than JACC provider.

If running full Jakarta EE application server, container security/Jakarta Security/Jakarta Authorization can be relevant.

---

## 38. Should You Implement Custom Jakarta Authorization Provider?

Usually: **no**.

Consider custom provider only if:

1. you build/extend an application server;
2. enterprise mandates centralized authorization provider at container level;
3. legacy JACC provider exists;
4. you need standardized container-level policy replacement;
5. you have strong operational control over app server runtime.

For most application teams, better approach:

```text
Use container/Jakarta/Spring/MicroProfile security for coarse authentication and role gates.
Implement domain authorization explicitly in application service layer.
```

---

## 39. Recommended Enterprise Authorization Architecture

A mature Jakarta application can use layered authorization:

```text
[Gateway]
  - TLS
  - optional token pre-validation
  - routing

[Container / Jakarta Security]
  - authenticate caller
  - establish principal/groups
  - enforce coarse endpoint/method access

[Application Authorization Service]
  - evaluate domain permissions
  - tenant isolation
  - state-machine rule
  - delegation
  - maker-checker
  - audit decision

[Database/Data Access]
  - query constrained by tenant/resource scope
  - defense-in-depth checks
```

In code:

```java
@Path("/cases/{id}/approve")
public class CaseApprovalResource {

    @Inject
    SecurityContext securityContext;

    @Inject
    DomainAuthorizationService authorization;

    @Inject
    CaseApprovalService approvalService;

    @POST
    @RolesAllowed("CASE_APPROVER")
    public Response approve(@PathParam("id") String caseId) {
        Actor actor = Actor.from(securityContext);

        authorization.requireAllowed(
            actor,
            Action.APPROVE_CASE,
            ResourceRef.caseId(caseId)
        );

        approvalService.approve(actor, caseId);
        return Response.noContent().build();
    }
}
```

Layer responsibilities:

```text
@RolesAllowed -> coarse container gate
DomainAuthorizationService -> business-specific gate
Repository query -> data isolation gate
Audit -> defensibility
```

---

## 40. Designing Permission Names

Even if Jakarta Authorization uses permission classes, application domain often needs named permissions.

Good permission naming:

```text
case.view
case.create
case.update
case.assign
case.approve
case.reject
case.reopen
case.export
report.monthly.view
report.monthly.export
document.download
user.manage
role.assign
```

Bad permission naming:

```text
admin
super
canDoStuff
module1Access
edit
viewAll
```

Permission should be:

1. action-oriented;
2. resource-aware;
3. stable;
4. not tied to UI labels;
5. not tied to external group names;
6. suitable for audit;
7. explicit enough for review.

---

## 41. Role-to-Permission Matrix

Example:

| Application Role | Permissions |
|---|---|
| CASE_VIEWER | `case.view`, `document.view` |
| CASE_OFFICER | `case.view`, `case.update`, `case.submit` |
| CASE_MANAGER | `case.view`, `case.assign`, `case.escalate` |
| CASE_APPROVER | `case.view`, `case.approve`, `case.reject` |
| REPORT_VIEWER | `report.view` |
| ADMIN | `user.manage`, `role.assign`, `system.configure` |

Then domain constraints refine:

```text
CASE_APPROVER has case.approve
BUT cannot approve own submitted case
BUT only within same tenant
BUT only if case state = SUBMITTED
BUT only if approval deadline not expired or override granted
```

This avoids role explosion.

---

## 42. Permission Explosion Problem

Naive design:

```text
CASE_APPROVER_AGENCY_A_DRAFT_SMALL_AMOUNT
CASE_APPROVER_AGENCY_A_SUBMITTED_SMALL_AMOUNT
CASE_APPROVER_AGENCY_A_SUBMITTED_HIGH_AMOUNT
CASE_APPROVER_AGENCY_B_SUBMITTED_HIGH_AMOUNT
...
```

This is role explosion.

Better:

```text
Role: CASE_APPROVER
Permission: case.approve
Attributes:
  tenant
  case state
  amount threshold
  ownership
  assignment
  risk level
Policy evaluates attributes dynamically.
```

Container authorization is usually not the best place for highly contextual authorization. Use domain policy service.

---

## 43. Policy Evaluation Caching

Authorization decisions can be cached, but carefully.

Cacheable:

1. static role-to-permission matrix;
2. IdP group-to-application-role mapping;
3. public key/JWKS;
4. policy metadata version.

Dangerous to cache blindly:

1. object-level allow decisions;
2. tenant membership if frequently changes;
3. emergency revocation;
4. delegation validity;
5. case state dependent decisions.

Cache key must include all relevant context:

```text
subject + action + resource + tenant + policyVersion + resourceVersion/state
```

Otherwise stale allow can become privilege escalation.

---

## 44. Authorization and Race Conditions

Classic bug:

```java
authorization.requireCanApprove(actor, caseId);
caseRepository.approve(caseId);
```

Between check and update, case state changes.

Better:

```text
Perform authorization and state transition atomically where possible.
```

Example database condition:

```sql
UPDATE cases
SET status = 'APPROVED'
WHERE id = ?
  AND status = 'SUBMITTED'
  AND tenant_id = ?
  AND submitted_by <> ?
```

Then verify affected row count.

Authorization is not just a pre-check. It must be consistent with the state transition.

---

## 45. Container Authorization Debugging Checklist

When authorization behaves wrongly, ask:

1. Is caller authenticated?
2. What is `getUserPrincipal()`?
3. What roles does container think caller has?
4. Is `isUserInRole()` true for expected role?
5. Are roles declared?
6. Are role references mapped?
7. Are security constraints matching the URL/method?
8. Is the endpoint actually going through container security?
9. Are annotations overridden by descriptors?
10. Is request dispatched/forwarded/async in a way that changes enforcement?
11. Is there a gateway/proxy changing path/method?
12. Is policy generated at deployment stale?
13. Are session/token claims stale?
14. Are `javax` and `jakarta` dependencies mixed?
15. Is the correct application server feature enabled?

---

## 46. Authorization Test Matrix

For each protected operation, test at least:

| Scenario | Expected |
|---|---|
| Anonymous caller | 401/login challenge |
| Authenticated no role | 403 |
| Authenticated wrong tenant | 403/domain deny |
| Correct role wrong resource state | 403/domain deny |
| Correct role correct resource | allow |
| Correct role but maker-checker violation | deny |
| Expired session/token | 401 |
| Removed role during session | depends on freshness policy, should be documented |
| URL variant/trailing slash/case/path encoding | no bypass |
| Direct method/internal path | no bypass |

Security tests must include negative cases. Positive happy path is not enough.

---

## 47. Jakarta Authorization In Regulatory Systems

For regulatory/case-management systems, authorization must survive scrutiny.

Important properties:

1. explainable decision;
2. deterministic denial reason;
3. traceable policy version;
4. actor and on-behalf-of actor captured;
5. tenant/agency boundary explicit;
6. state machine transition guarded;
7. maker-checker enforced;
8. emergency override audited;
9. role changes audited;
10. no hidden UI-only enforcement;
11. data query scoped by authorization;
12. policy reviewed with business owners.

Container authorization helps at the perimeter of application operations. Domain authorization makes regulatory logic defensible.

---

## 48. Anti-Patterns

### 48.1 UI-Only Authorization

```text
Hide approve button in UI, but backend endpoint still allows call.
```

Backend must enforce.

### 48.2 Role Hardcoded Everywhere

```java
if (user.hasRole("CEA_APPROVER_PROD_V2")) { ... }
```

External group/policy naming leaks into business code.

### 48.3 Token Claims As Final Truth

```java
if (jwt.groups.contains("admin")) allowDeleteEverything();
```

Claims must be validated, normalized, mapped, and scoped.

### 48.4 Permission Without Resource Context

```java
canApprove(actor)
```

Should usually be:

```java
canApprove(actor, caseId, tenant, state)
```

### 48.5 Authorization After Mutation

```java
case.approve();
authorization.checkCanApprove(actor, case);
```

Too late.

### 48.6 Audit Only Failures

Successful sensitive actions also need authorization evidence.

### 48.7 Assuming Container Role Equals Domain Permission

`@RolesAllowed("APPROVER")` does not enforce all domain rules.

---

## 49. Practical Design Template

For each operation, define:

```text
Operation: approve case
Endpoint: POST /cases/{id}/approve
Container role: CASE_APPROVER
Domain permission: case.approve
Resource: Case
Context:
  - tenant
  - case status
  - submitter
  - assigned officer
  - risk level
  - delegation
Rules:
  - actor must belong to same tenant
  - actor must have case.approve
  - case status must be SUBMITTED
  - actor must not be submitter
  - delegation must be valid if acting on behalf
Audit:
  - actor
  - onBehalfOf
  - caseId
  - decision
  - reason
  - policyVersion
```

This template is often more useful than arguing whether RBAC or ABAC is better.

---

## 50. Minimal Conceptual Code: Domain Policy Service

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final String reason;

    private AuthorizationDecision(boolean allowed, String reason) {
        this.allowed = allowed;
        this.reason = reason;
    }

    public static AuthorizationDecision allow() {
        return new AuthorizationDecision(true, "ALLOW");
    }

    public static AuthorizationDecision deny(String reason) {
        return new AuthorizationDecision(false, reason);
    }

    public boolean isAllowed() {
        return allowed;
    }

    public String reason() {
        return reason;
    }
}
```

```java
public interface DomainAuthorizationService {
    void requireAllowed(Actor actor, Action action, ResourceRef resource);

    AuthorizationDecision decide(Actor actor, Action action, ResourceRef resource);
}
```

```java
public class CaseAuthorizationService implements DomainAuthorizationService {

    private final CaseRepository caseRepository;
    private final PermissionRepository permissionRepository;
    private final AuditService auditService;

    public CaseAuthorizationService(
            CaseRepository caseRepository,
            PermissionRepository permissionRepository,
            AuditService auditService
    ) {
        this.caseRepository = caseRepository;
        this.permissionRepository = permissionRepository;
        this.auditService = auditService;
    }

    @Override
    public void requireAllowed(Actor actor, Action action, ResourceRef resource) {
        AuthorizationDecision decision = decide(actor, action, resource);

        auditService.recordAuthorizationDecision(actor, action, resource, decision);

        if (!decision.isAllowed()) {
            throw new ForbiddenException(decision.reason());
        }
    }

    @Override
    public AuthorizationDecision decide(Actor actor, Action action, ResourceRef resource) {
        if (!permissionRepository.hasPermission(actor.roles(), action.permissionName())) {
            return AuthorizationDecision.deny("MISSING_PERMISSION");
        }

        CaseRecord caseRecord = caseRepository.findRequired(resource.id());

        if (!caseRecord.tenantId().equals(actor.activeTenantId())) {
            return AuthorizationDecision.deny("TENANT_MISMATCH");
        }

        if (action == Action.APPROVE_CASE) {
            if (!caseRecord.status().equals(CaseStatus.SUBMITTED)) {
                return AuthorizationDecision.deny("INVALID_CASE_STATE");
            }

            if (caseRecord.submittedBy().equals(actor.userId())) {
                return AuthorizationDecision.deny("MAKER_CANNOT_APPROVE_OWN_CASE");
            }
        }

        return AuthorizationDecision.allow();
    }
}
```

Container role gate:

```java
@POST
@Path("/cases/{id}/approve")
@RolesAllowed("CASE_APPROVER")
public Response approve(@PathParam("id") String id) {
    Actor actor = actorResolver.currentActor();
    authorization.requireAllowed(actor, Action.APPROVE_CASE, ResourceRef.caseId(id));
    approvalService.approve(actor, id);
    return Response.noContent().build();
}
```

This pattern combines:

```text
Jakarta/container coarse authorization + domain-specific authorization
```

---

## 51. How To Think Like A Top 1% Engineer Here

A surface-level engineer asks:

```text
Should I use @RolesAllowed?
```

A stronger engineer asks:

```text
What is the enforcement boundary?
What identity is being evaluated?
What role/group/claim mapping exists?
What operation/resource is protected?
Is this coarse or fine-grained authorization?
What happens if policy changes mid-session?
What is the denial reason?
Can this decision be audited?
Can the operation be reached through another path?
Can race conditions invalidate the check?
```

That is the shift from API knowledge to authorization architecture.

---

## 52. Summary

Jakarta Authorization / JACC is not something most application developers use daily, but it explains a crucial layer of Jakarta EE security.

Core mental model:

```text
Authentication establishes subject.
Security metadata declares protected operations.
Container transforms metadata into permissions.
Policy provider evaluates subject + permission.
Application domain authorization handles contextual business rules.
```

Key takeaways:

1. Jakarta Authorization is low-level authorization SPI for containers.
2. It is based on subject and permission, not just simple role strings.
3. Servlet/EJB constraints can be transformed into permission checks.
4. Role is a mapping layer, not the deepest authorization primitive.
5. Container authorization is excellent for coarse-grained enforcement.
6. Domain authorization is still required for object/state/tenant/workflow rules.
7. Role reference mapping is powerful but dangerous if not documented/tested.
8. Authorization must be auditable and deterministic in enterprise/regulatory systems.
9. Most teams should not implement custom Jakarta Authorization provider directly.
10. Understanding this layer makes debugging and architecture review much stronger.

---

## 53. Practical Checklist

Use this checklist during design/review:

```text
[ ] Are all protected endpoints listed?
[ ] Are all sensitive methods protected?
[ ] Are roles declared explicitly?
[ ] Are role references mapped explicitly?
[ ] Is default behavior known for unmatched resources?
[ ] Are annotations and descriptors consistent?
[ ] Is domain authorization separate from coarse role gate?
[ ] Are tenant/resource/state constraints checked?
[ ] Are decisions audited?
[ ] Are denial reasons deterministic?
[ ] Are session/token/policy freshness rules documented?
[ ] Are negative tests included?
[ ] Are bypass paths tested?
[ ] Are external IdP groups mapped to stable application roles?
[ ] Is authorization enforced server-side, not only UI-side?
```

---

## 54. Relationship To Next Part

This part explained the low-level authorization SPI and permission mental model.

Next part moves back closer to daily developer work:

```text
Part 12 — Declarative Authorization: URL, Method, Class, Role
```

There we will focus on how to actually use declarative authorization constructs:

1. URL-level authorization;
2. `web.xml`;
3. `@ServletSecurity`;
4. `@RolesAllowed`;
5. `@PermitAll`;
6. `@DenyAll`;
7. role declaration;
8. class vs method-level rules;
9. proxy/interceptor limitations;
10. testing declarative authorization.

---

# End of Part 11

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 10 — Jakarta Authentication / JASPIC Deep Dive](./learn-java-jakarta-security-authentication-authorization-identity-part-10-jakarta-authentication-jaspic-deep-dive.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 12 — Declarative Authorization: URL, Method, Class, Role](./learn-java-jakarta-security-authentication-authorization-identity-part-12-declarative-authorization.md)

</div>