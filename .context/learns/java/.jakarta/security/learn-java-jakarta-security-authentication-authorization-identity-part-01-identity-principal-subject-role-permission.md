# Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-01-identity-principal-subject-role-permission.md`  
> Target: Java 8 sampai Java 25, Java EE / Jakarta EE, `javax.*` dan `jakarta.*`  
> Posisi: Fondasi vocabulary dan mental model sebelum masuk Jakarta Security API, Jakarta Authentication, dan Jakarta Authorization.

---

## 0. Tujuan Part Ini

Part ini membahas satu hal yang terlihat sederhana tetapi sering menjadi akar masalah security architecture:

> **Apa sebenarnya yang dimaksud dengan identity, principal, subject, caller, account, user, credential, group, role, permission, claim, dan scope?**

Banyak bug security besar tidak terjadi karena developer tidak tahu cara menulis `@RolesAllowed`, filter JWT, atau login form. Banyak bug terjadi karena sistem kehilangan makna:

- group IdP dianggap sama dengan role aplikasi,
- role dianggap sama dengan permission domain,
- token dianggap bukti final bahwa user boleh melakukan aksi,
- caller dianggap sama dengan human user,
- account dianggap sama dengan legal entity,
- principal dianggap cukup untuk audit,
- authorization dianggap selesai setelah authentication berhasil,
- `isUserInRole("ADMIN")` dipakai untuk keputusan domain yang jauh lebih granular,
- UI menyembunyikan tombol, tetapi API tetap bisa dipanggil,
- session menyimpan role lama setelah hak akses dicabut,
- background job menjalankan aksi “atas nama user” tanpa model delegation yang jelas.

Part ini akan membangun kamus konseptual yang presisi. Setelah ini, ketika nanti kita masuk ke `SecurityContext`, `IdentityStore`, `HttpAuthenticationMechanism`, JAAS `Subject`, Jakarta Authentication callback, dan Jakarta Authorization permission, kita sudah punya bahasa yang sama.

---

## 1. Peta Besar: Dari Orang Sampai Permission

Dalam sistem enterprise Java, request tidak datang sebagai “user” yang magical. Request melewati beberapa transformasi:

```text
Real-world actor
    ↓
Account / identity record
    ↓
Credential presentation
    ↓
Authentication
    ↓
Principal / caller identity established
    ↓
Group / role / claim mapping
    ↓
Authorization decision
    ↓
Domain action allowed or denied
    ↓
Audit trail
```

Contoh konkret:

```text
Siti, pegawai agency A
    ↓
Account: siti@agency-a.gov
    ↓
Credential: browser session from OIDC login
    ↓
Authentication: IdP says subject = "8f3a-123"
    ↓
Principal: CallerPrincipal("8f3a-123")
    ↓
Groups: ["agency-a-officer", "case-reviewer"]
    ↓
Application roles: ["CASE_REVIEWER"]
    ↓
Domain permission check:
       can REVIEW case #C-1023?
       tenant == agency A?
       case state == SUBMITTED?
       assigned team == reviewer team?
       not maker of the case?
    ↓
Decision: allow
    ↓
Audit:
       actor=siti@agency-a.gov,
       subject_id=8f3a-123,
       action=REVIEW_CASE,
       resource=C-1023,
       decision=ALLOW,
       reason=ASSIGNED_REVIEWER_IN_STATE_SUBMITTED
```

Perhatikan bahwa “login berhasil” hanya satu langkah awal. Ia belum menjawab pertanyaan:

> “Apakah actor ini boleh melakukan aksi ini pada resource ini pada state ini untuk tenant ini sekarang?”

Itulah inti perbedaan authentication dan authorization.

---

## 2. Vocabulary Utama

### 2.1 Identity

**Identity** adalah representasi stabil tentang “siapa” sebuah actor dalam sebuah trust domain.

Identity bisa mewakili:

- human user,
- service account,
- machine identity,
- client application,
- API consumer,
- organization,
- tenant,
- device,
- external party,
- batch job,
- delegated actor.

Identity bukan selalu “orang”. Dalam sistem enterprise, banyak request legal berasal dari non-human actor:

```text
- nightly reconciliation job
- document generation worker
- integration connector
- message consumer
- service-to-service API client
- external agency system
- robotic process automation client
```

Mental model:

```text
Identity = entity recognized by a trust domain
```

Trust domain bisa berupa:

- Jakarta application,
- application server realm,
- Keycloak realm,
- enterprise LDAP/AD,
- government identity provider,
- OAuth authorization server,
- database user table,
- tenant directory,
- internal IAM platform.

Identity harus punya identifier yang stabil. Tetapi “stabil” tidak berarti “tidak pernah berubah”. Email bisa berubah. Username bisa berubah. Nomor pegawai bisa berubah. Nama manusia bisa berubah. Maka, dalam desain serius, identity biasanya punya beberapa identifier:

```text
internal_user_id        = immutable app-local ID
external_subject_id     = subject from IdP
username                = login name, may change
email                   = contact attribute, may change
display_name            = presentation attribute, may change
tenant_id               = organization boundary
federated_identity_id   = mapping row to external provider
```

Top 1% engineer tidak bertanya hanya:

> “Usernamenya apa?”

Tetapi bertanya:

> “Identifier mana yang immutable, mana yang display-only, mana yang dari IdP, mana yang app-local, dan mana yang dipakai untuk audit serta authorization?”

---

### 2.2 User

**User** biasanya berarti human user aplikasi. Tetapi kata ini sering ambigu.

Dalam kode, `User` bisa berarti:

1. record di tabel user,
2. actor yang sedang login,
3. profile data,
4. security principal,
5. employee,
6. customer,
7. account owner,
8. DTO untuk UI,
9. row untuk authorization mapping,
10. external IdP subject.

Ini berbahaya karena satu nama membawa banyak makna.

Contoh desain yang rawan:

```java
class User {
    Long id;
    String username;
    String password;
    List<String> roles;
    String tenantId;
    String email;
}
```

Masalah:

- Apakah `id` app-local atau external?
- Apakah `username` immutable?
- Apakah `roles` berasal dari database, token, LDAP, atau hasil mapping?
- Apakah role ini masih fresh?
- Apakah `tenantId` satu atau user bisa punya banyak tenant?
- Apakah password boleh ada di object yang sama dengan profile?
- Apakah object ini aman masuk log?

Lebih baik dipisahkan secara konseptual:

```text
IdentityRecord      = stable local identity metadata
CredentialRecord    = password / MFA / external login binding
Profile             = display/contact attributes
Membership          = organization / tenant relation
RoleAssignment      = application role assignment
SessionIdentity     = identity snapshot for current session
AuthorizationActor  = actor used in policy evaluation
AuditActor          = actor representation for audit trail
```

Dalam kode nyata tidak selalu harus ada class sebanyak itu. Tetapi secara mental harus dipisahkan.

---

### 2.3 Account

**Account** adalah record yang memungkinkan identity menggunakan sistem.

Identity dan account tidak selalu 1:1.

Contoh:

```text
One human → multiple accounts
    siti.personal@example.com
    siti@agency.gov
    admin-siti@agency.gov

One account → multiple identities
    shared mailbox
    legacy shared admin account
    service account used by multiple systems

One identity → multiple login providers
    local password
    corporate SSO
    government digital identity
    passkey
```

Dalam sistem modern, account sebaiknya tidak dianggap sebagai actor final. Account adalah container untuk akses, credential, binding IdP, status, dan lifecycle.

Account properties:

```text
account_id
identity_id
status: ACTIVE / LOCKED / DISABLED / PENDING / DELETED
credential_bindings
mfa_state
last_login
risk_flags
tenant_memberships
role_assignments
```

Lifecycle account penting untuk authorization:

```text
PENDING         → belum boleh login
ACTIVE          → boleh login dan dievaluasi authorization
LOCKED          → credential benar tetapi login ditolak
DISABLED        → tidak boleh login
DEPROVISIONED   → akses dicabut, audit tetap disimpan
MERGED          → identity digabung karena duplicate account
```

Anti-pattern:

```text
if (passwordCorrect) loginSuccess();
```

Yang benar:

```text
if password correct
and account active
and tenant membership valid
and credential not expired
and required MFA satisfied
and risk policy allows
then establish authenticated caller
```

---

### 2.4 Credential

**Credential** adalah bukti yang dipresentasikan actor untuk membuktikan klaim identity.

Credential bisa berupa:

```text
- password
- OTP
- client certificate
- private key signature
- bearer access token
- ID token
- session cookie
- API key
- passkey assertion
- Kerberos ticket
- SAML assertion
- mutual TLS certificate
```

Credential bukan identity. Credential adalah evidence.

```text
Identity: "service-payment-api"
Credential: client certificate with SAN service-payment-api.internal
```

```text
Identity: "user 123"
Credential: session cookie JSESSIONID=...
```

```text
Identity: "external subject abc"
Credential: OIDC authorization code exchanged into ID token
```

Credential harus diperlakukan sebagai secret atau security-sensitive material. Tidak semua credential sama:

| Credential | Bearer? | Replay Risk | Typical Storage | Main Risk |
|---|---:|---:|---|---|
| Password | No, validated once | Medium | Hashed server-side | phishing, database leak |
| Session cookie | Usually bearer | High | Browser cookie | theft, fixation, CSRF |
| Access token | Usually bearer | High | memory/browser/server | replay, audience misuse |
| Client certificate | Proof-of-possession | Lower | keystore/HSM | key theft, expired cert |
| API key | Bearer | High | config/secret store | leakage, overprivilege |
| OTP | One-time | Medium | transient | phishing, replay window |

Top-level mental model:

```text
Credential answers:
"Can the actor prove control over something trusted?"

It does not by itself answer:
"What is this actor allowed to do?"
```

---

### 2.5 Principal

Dalam Java, **Principal** adalah abstraction dari identity name.

Di Java SE, `java.security.Principal` sangat sederhana:

```java
public interface Principal {
    String getName();
}
```

Ini terlihat trivial, tetapi konsepnya penting.

Principal bukan selalu user lengkap. Principal adalah “nama” atau identity representation yang dikenali security system.

Contoh principal:

```text
UserPrincipal("siti")
CallerPrincipal("8f3a-123")
GroupPrincipal("case-reviewer")
RolePrincipal("ADMIN")
ServicePrincipal("payment-worker")
X500Principal("CN=client-a,O=Agency")
```

Dalam JAAS/Jakarta Authentication, `Subject` bisa punya banyak principal:

```text
Subject
  Principals:
    - CallerPrincipal("siti")
    - GroupPrincipal("case-reviewer")
    - GroupPrincipal("agency-a")
    - TenantPrincipal("agency-a")
```

Masalah umum:

> Menganggap `principal.getName()` selalu username yang aman dipakai untuk lookup user.

Tidak selalu.

`getName()` bisa berupa:

- username,
- email,
- UUID,
- certificate DN,
- OIDC subject,
- service account name,
- opaque provider ID,
- composite string,
- value yang berubah tergantung provider.

Prinsip desain:

```text
Principal name is not automatically your domain user ID.
```

Lebih aman:

```text
principal_name       = raw name from runtime
identity_provider    = source
external_subject     = stable external subject
local_identity_id    = internal immutable ID
tenant_context       = active tenant
```

---

### 2.6 Subject

**Subject** berasal dari JAAS dan masih penting secara konseptual di Jakarta Authentication/Authorization.

Subject adalah container security untuk:

```text
- principals
- public credentials
- private credentials
```

Mental model:

```text
Subject = security identity bag
```

Subject bisa punya banyak principal:

```text
Subject {
  principals = [
    CallerPrincipal("user-123"),
    GroupPrincipal("CASE_REVIEWER"),
    GroupPrincipal("AGENCY_A")
  ],
  publicCredentials = [...],
  privateCredentials = [...]
}
```

Dalam Jakarta Authentication, callback seperti `CallerPrincipalCallback` digunakan oleh authentication module untuk menetapkan caller principal container, dan `GroupPrincipalCallback` untuk menetapkan group principals pada subject.

Perhatikan beda antara:

```text
Principal = satu nama/identity representation
Subject   = kumpulan principals dan credentials untuk satu security subject
```

Dalam konteks container:

```text
Authentication mechanism validates credential
    ↓
container establishes subject/caller
    ↓
container exposes caller through request/security context
    ↓
authorization uses caller/groups/roles/permissions
```

Subject sangat relevan untuk:

- custom authentication module,
- JAAS integration,
- legacy app server security,
- Jakarta Authentication,
- Jakarta Authorization,
- subject-based permission checks.

Tetapi dalam aplikasi modern, developer sering lebih banyak melihat `SecurityContext` atau `HttpServletRequest#getUserPrincipal()` daripada `Subject`.

---

### 2.7 Caller

Dalam Jakarta EE, istilah **caller** sering digunakan untuk actor yang sedang memanggil component.

Contoh:

```text
caller of servlet request
caller of EJB method
caller of JAX-RS resource
caller of service method
```

Caller bisa human user, service, atau system identity.

Kenapa bukan selalu “user”? Karena enterprise component bisa dipanggil oleh:

```text
- browser user
- another backend service
- message-driven bean
- scheduled task
- admin script
- integration connector
```

Dalam Jakarta Security, `SecurityContext` memungkinkan application code mengakses caller principal dan mengecek role caller. Dalam Servlet API, analoginya adalah:

```java
request.getUserPrincipal()
request.isUserInRole("ADMIN")
```

Dalam EJB/CDI security, caller identity bisa memengaruhi:

```text
- method access
- run-as role
- transaction behaviour indirectly through authorization guard
- audit actor
```

Desain penting:

```text
Caller = actor at current execution boundary.
```

Bukan selalu:

```text
Original human user.
```

Contoh delegation:

```text
User A clicks "Generate Report"
    ↓
Request accepted as User A
    ↓
Background job runs later as system identity
    ↓
Audit should preserve:
        initiated_by = User A
        executed_by  = report-job-service
```

Jika hanya ada satu field `createdBy`, audit menjadi ambigu.

---

### 2.8 Group

**Group** biasanya berasal dari identity provider atau directory.

Contoh:

```text
LDAP group:
  cn=case-reviewers,ou=groups,dc=company,dc=com

Keycloak group:
  /agency-a/case-reviewer

AD group:
  SG_APP_ACEAS_REVIEWER

OIDC claim:
  groups: ["agency-a-officer", "case-reviewer"]
```

Group adalah fakta dari identity system, bukan otomatis permission aplikasi.

Group menjawab:

```text
"Actor ini termasuk koleksi identity apa di directory/IdP?"
```

Group tidak otomatis menjawab:

```text
"Boleh approve case ini?"
```

Kenapa?

Karena authorization aplikasi sering butuh context:

```text
- tenant
- resource owner
- case state
- assignment
- segregation of duties
- time window
- license status
- risk score
- delegation validity
- conflict of interest
```

Group bagus untuk coarse-grained membership. Tetapi group buruk untuk fine-grained business permission jika langsung dipakai di semua kode.

Anti-pattern:

```java
if (groups.contains("CN=ACEAS_PROD_CASE_APPROVER,OU=Groups,DC=corp,DC=com")) {
    approveCase(caseId);
}
```

Masalah:

- coupling ke naming LDAP,
- environment-specific,
- sulit migrasi IdP,
- tidak bisa handle tenant/state,
- sulit audit reason,
- group rename bisa merusak production,
- role semantics tersebar di kode.

Lebih baik:

```text
External group
    ↓ mapping
Application role
    ↓ policy
Domain permission
    ↓ contextual authorization decision
```

---

### 2.9 Role

**Role** adalah abstraction aplikasi tentang kapasitas actor dalam sistem.

Contoh role:

```text
- CASE_VIEWER
- CASE_REVIEWER
- CASE_APPROVER
- AGENCY_ADMIN
- SYSTEM_ADMIN
- AUDITOR
- SUPPORT_OPERATOR
```

Role biasanya coarse-grained.

Role menjawab:

```text
"Actor punya kapasitas umum apa dalam aplikasi?"
```

Role belum cukup untuk semua keputusan.

Contoh:

```text
Role: CASE_APPROVER
```

Belum menjawab:

```text
Boleh approve case C-1023?
```

Karena perlu cek:

```text
- case ada di tenant actor?
- case state SUBMITTED?
- actor bukan maker?
- actor assigned sebagai approver?
- actor tidak sedang conflict of interest?
- case belum locked?
- approval window belum lewat?
- actor punya active delegation?
```

Role cocok untuk:

```text
- masuk menu utama,
- akses endpoint besar,
- akses module,
- memilih baseline capability,
- coarse-grained guard,
- default deny,
- admin feature gating.
```

Role tidak cukup untuk:

```text
- object-level authorization,
- row-level data access,
- workflow action,
- approval decision,
- tenant isolation,
- financial limit,
- emergency override,
- segregation of duties.
```

Mental model:

```text
Role = coarse capability label.
Permission = action/resource-specific authority.
Policy = rules that decide permission in context.
```

---

### 2.10 Permission

**Permission** adalah hak melakukan aksi terhadap resource atau operation.

Format sederhana:

```text
permission = action
```

Contoh:

```text
VIEW_CASE
CREATE_CASE
APPROVE_CASE
ASSIGN_CASE
EXPORT_REPORT
MANAGE_USERS
```

Format lebih baik:

```text
permission = resource_type + action
```

Contoh:

```text
case:view
case:create
case:update
case:approve
case:assign
report:export
user:manage
```

Format domain-aware:

```text
permission check = subject + action + resource + context
```

Contoh:

```text
can(
  subject = user-123,
  action = APPROVE,
  resource = case C-1023,
  context = {
    tenant = agency-a,
    state = SUBMITTED,
    maker = user-456,
    assignee = user-123,
    risk_level = NORMAL,
    now = 2026-06-17T10:00+07:00
  }
)
```

Permission lebih dekat ke “apa yang boleh dilakukan” daripada role.

Role dapat menghasilkan permission, tetapi tidak selalu 1:1.

```text
Role CASE_REVIEWER:
  - case:view
  - case:comment
  - case:recommend

Role CASE_APPROVER:
  - case:view
  - case:approve
  - case:reject
```

Tetapi permission domain sering conditional:

```text
CASE_APPROVER has case:approve only when:
  case.state == SUBMITTED
  and case.tenant == actor.activeTenant
  and case.maker != actor.id
  and actor.assignment includes case.approvalQueue
```

Top 1% design tidak berhenti di:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(...) { ... }
```

Tetapi menambah domain guard:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(CaseId caseId) {
    Case c = caseRepository.get(caseId);

    authorization.require(
        actor(),
        Action.APPROVE_CASE,
        c,
        ApprovalContext.from(c)
    );

    caseWorkflow.approve(c, actor());
}
```

---

### 2.11 Claim

**Claim** adalah statement tentang subject yang diberikan oleh issuer.

Dalam OIDC/JWT, claim bisa berupa:

```json
{
  "sub": "8f3a-123",
  "iss": "https://idp.example.gov",
  "aud": "aceas-web",
  "email": "siti@agency.gov",
  "name": "Siti Aminah",
  "groups": ["agency-a-officer", "case-reviewer"],
  "tenant": "agency-a",
  "exp": 1790000000
}
```

Claim bukan fakta mutlak. Claim adalah statement dari issuer yang harus dievaluasi dalam trust context.

Pertanyaan penting:

```text
Who issued this claim?
Was the token signature valid?
Was the token intended for this audience?
Is the token expired?
Is the issuer trusted?
Is the claim fresh enough?
Is the claim mapped into app semantics correctly?
```

Claim bisa dipakai untuk:

- authentication identity,
- display profile,
- group mapping,
- tenant hint,
- session bootstrap,
- risk context.

Claim sebaiknya tidak langsung menjadi domain permission tanpa mapping dan validation.

Anti-pattern:

```java
if (jwt.getClaim("role").equals("admin")) {
    allowEverything();
}
```

Masalah:

- role claim mungkin untuk client lain,
- issuer mungkin salah,
- token audience mungkin bukan API ini,
- role naming mungkin external,
- token mungkin stale,
- “admin” terlalu luas,
- tidak ada tenant constraint.

---

### 2.12 Scope

**Scope** berasal dari OAuth2. Scope adalah delegated permission string yang diberikan untuk client/application dalam token.

Contoh:

```text
openid
profile
email
case.read
case.write
report.export
```

Scope sering disalahartikan sebagai role user. Padahal OAuth2 scope umumnya menyatakan:

```text
Client ini diberi izin untuk meminta akses tertentu atas nama resource owner.
```

Dalam client credentials flow, scope bisa mewakili permission service account.

Dalam authorization code flow, scope membatasi apa yang bisa diminta client, tetapi tidak selalu berarti user boleh melakukan aksi domain.

Contoh:

```text
access token scope = case.write
user role = CASE_OFFICER
case state = CLOSED
```

Apakah user boleh update case?

Belum tentu.

Scope `case.write` mungkin hanya berarti token boleh memanggil API write secara umum. Domain policy tetap harus cek state dan resource.

Mental model:

```text
Scope = token/client grant boundary.
Role = actor/application capability.
Permission = action/resource authority.
Policy = contextual decision.
```

---

## 3. Relasi Antar Konsep

### 3.1 Layered Model

```text
┌─────────────────────────────────────────────────────────────┐
│ Real World                                                   │
│ Human, agency, service owner, legal entity                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Identity Domain / IdP                                        │
│ subject, account, credential, group, claim                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Container / Jakarta Security Runtime                         │
│ caller principal, subject, groups, security context          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Application Security Model                                   │
│ app role, tenant membership, permission, policy              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Domain Model                                                 │
│ case, workflow state, assignment, ownership, delegation      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Audit / Accountability                                       │
│ actor, action, resource, decision, reason, correlation       │
└─────────────────────────────────────────────────────────────┘
```

Kegagalan sering terjadi ketika layer dilewati.

Contoh:

```text
IdP group → direct database access
```

Atau:

```text
JWT claim → direct approve case
```

Atau:

```text
UI role → hide button only → API still open
```

---

### 3.2 Mapping Chain

Mapping yang sehat:

```text
External identity
    ↓
External subject ID
    ↓
Local identity binding
    ↓
Tenant membership
    ↓
External groups/claims
    ↓
Application role mapping
    ↓
Domain permission policy
    ↓
Resource-specific decision
```

Contoh:

```text
OIDC sub:
  "a8d9-123"

Local identity:
  user_id = 50192

External group:
  "/agency-a/reviewer"

Mapping:
  group "/agency-a/reviewer" + tenant "agency-a"
      → role CASE_REVIEWER for tenant agency-a

Permission:
  CASE_REVIEWER
      → can recommend case
      only if case.tenant = agency-a
      only if case.state in [SUBMITTED, UNDER_REVIEW]
      only if assigned or queue member

Decision:
  ALLOW recommend C-1023
```

---

## 4. Jakarta/Java Context

### 4.1 Java SE Principal

Core Java menyediakan `java.security.Principal`.

Ini bukan Jakarta-specific. Ia bagian dari Java SE dan bisa digunakan di banyak layer.

Konsepnya minimal:

```java
Principal p = request.getUserPrincipal();
String name = p.getName();
```

Tetapi minimal bukan berarti cukup untuk domain security.

Gunakan `Principal` sebagai pointer ke caller identity, bukan sebagai complete authorization model.

---

### 4.2 JAAS Subject

JAAS memperkenalkan `Subject` sebagai kumpulan principals dan credentials.

Pola klasik:

```text
LoginContext
    ↓
LoginModule validates credentials
    ↓
Subject populated with principals
    ↓
Subject used for secured action
```

Walaupun modern Jakarta apps sering tidak menulis JAAS langsung, konsep `Subject` tetap muncul di Jakarta Authentication dan Authorization.

---

### 4.3 Servlet Caller Principal

Dalam Servlet:

```java
Principal principal = request.getUserPrincipal();
boolean admin = request.isUserInRole("ADMIN");
```

Ini berarti container sudah menetapkan caller identity untuk request tersebut.

Tetapi ada pertanyaan desain:

```text
Role "ADMIN" itu role container?
Role aplikasi?
Role dari web.xml?
Role hasil mapping realm?
Role dari token?
```

Maka role harus punya kontrak yang jelas.

---

### 4.4 Jakarta Security SecurityContext

Jakarta Security menyediakan `SecurityContext` sebagai access point programmatic security untuk application code.

Contoh konseptual:

```java
@Inject
SecurityContext securityContext;

public void doSomething() {
    Principal caller = securityContext.getCallerPrincipal();

    if (securityContext.isCallerInRole("CASE_REVIEWER")) {
        // coarse-grained check
    }
}
```

`SecurityContext` berguna, tetapi tetap jangan dijadikan seluruh authorization model. Ia bagus untuk:

```text
- mengetahui caller
- mengecek role coarse-grained
- memulai authentication programmatically
- integrasi dengan container
```

Untuk domain authorization, tetap perlu policy layer sendiri.

---

### 4.5 Jakarta Authentication CallerPrincipalCallback dan GroupPrincipalCallback

Dalam authentication module level rendah, module dapat memberi tahu container:

```text
Caller principal = siapa caller-nya
Group principals = group apa yang melekat
```

Ini penting karena container butuh representasi identity dan group untuk authorization berikutnya.

Flow konseptual:

```text
ServerAuthModule.validateRequest()
    ↓
validate credential
    ↓
callback handler:
    - CallerPrincipalCallback(subject, callerName)
    - GroupPrincipalCallback(subject, groups)
    ↓
container establishes caller
```

Maknanya:

```text
Authentication module tidak hanya berkata "valid".
Ia juga harus memberi identity yang valid itu kepada container.
```

---

### 4.6 Jakarta Authorization: Subject dan Permission

Jakarta Authorization beroperasi di level permission dan subject.

Ia mendefinisikan bagaimana container constraint seperti Servlet/EJB security ditransformasikan menjadi permission yang dapat dievaluasi terhadap subject.

Mental model:

```text
Subject has principals
Container operation requires permission
Authorization provider decides:
    does subject imply permission?
```

Ini lebih dalam daripada sekadar `if role == ADMIN`.

---

## 5. Common Confusions and Corrections

### 5.1 “User sudah login, berarti boleh akses data”

Salah.

Login hanya membuktikan identity. Authorization tetap perlu.

```text
Authenticated != Authorized
```

Contoh:

```text
Siti login valid.
Siti bukan member agency B.
Maka Siti tidak boleh melihat case agency B.
```

---

### 5.2 “Role sama dengan permission”

Tidak selalu.

Role adalah grouping. Permission adalah kemampuan aksi/resource.

```text
Role CASE_APPROVER may imply permission case:approve,
but only under policy constraints.
```

---

### 5.3 “Group dari IdP bisa langsung dipakai di kode bisnis”

Bisa secara teknis, tetapi buruk secara arsitektur.

Lebih baik:

```text
Group → mapped role → policy → permission decision
```

---

### 5.4 “JWT claim role sudah cukup”

Tidak cukup jika:

- token audience salah,
- token issuer salah,
- token stale,
- role bukan untuk aplikasi ini,
- role tidak punya tenant context,
- action butuh state/resource check.

JWT adalah carrier, bukan policy engine.

---

### 5.5 “Principal name adalah primary key user”

Tidak aman diasumsikan.

Principal name bisa berubah, opaque, atau provider-specific.

Lebih aman punya local immutable ID.

---

### 5.6 “Admin boleh semua”

Ini sering menjadi sumber breach.

Admin pun harus dibagi:

```text
SYSTEM_ADMIN
TENANT_ADMIN
SECURITY_ADMIN
USER_ADMIN
CONFIG_ADMIN
AUDITOR
SUPPORT_READONLY
BREAK_GLASS_ADMIN
```

Dan beberapa action tetap perlu:

```text
- approval
- dual control
- audit
- reason code
- emergency window
```

---

### 5.7 “403 cukup tanpa audit”

Dalam sistem enterprise/regulatory, denial penting.

Denial bisa menunjukkan:

- malicious attempt,
- misconfiguration,
- role mapping error,
- stale session,
- user training issue,
- attack reconnaissance.

Audit minimal untuk denial sensitif:

```text
actor
tenant
action
resource
decision = DENY
reason_code
timestamp
correlation_id
source_ip / client
```

---

## 6. Identity Modelling Patterns

### 6.1 Local Identity with Federated Binding

Pattern paling umum untuk enterprise app dengan IdP external:

```text
users
  id                  local immutable ID
  status              ACTIVE / DISABLED
  display_name
  email

federated_identities
  id
  user_id
  provider            KEYCLOAK / ENTRA / SINGPASS / CORPPASS
  external_subject    sub/nameid
  external_username
  linked_at
  last_seen_at
```

Keuntungan:

- external subject bisa berubah melalui relinking policy,
- user profile app-local tetap stabil,
- bisa support multiple providers,
- audit bisa preserve both local and external identity,
- migration IdP lebih aman.

---

### 6.2 Membership as First-Class Concept

Untuk multi-tenant atau agency-based system:

```text
memberships
  user_id
  tenant_id
  status
  membership_type
  valid_from
  valid_until
```

Jangan taruh `tenantId` tunggal di user jika user bisa punya banyak organization.

```text
Bad:
  user.tenantId

Better:
  user has many memberships
  session has activeTenant
```

---

### 6.3 Role Assignment Scoped by Tenant

```text
role_assignments
  user_id
  tenant_id
  role_code
  source
  valid_from
  valid_until
```

Role biasanya perlu scope.

```text
Siti is CASE_REVIEWER in agency A.
Siti is AUDITOR in agency B.
```

Kalau role tidak scoped, mudah terjadi cross-tenant privilege leak.

---

### 6.4 Role Mapping from External Groups

```text
role_mappings
  provider
  external_group
  tenant_resolver
  app_role
  enabled
```

Contoh:

```text
provider = KEYCLOAK
external_group = /agency-a/reviewer
tenant = agency-a
app_role = CASE_REVIEWER
```

Mapping ini sebaiknya configurable dan auditable, bukan hardcoded di business method.

---

### 6.5 Permission Policy Layer

```text
Policy:
  role CASE_APPROVER grants action APPROVE_CASE when:
    resource.type == CASE
    resource.tenant == actor.activeTenant
    resource.state == SUBMITTED
    resource.maker != actor.userId
    actor is assigned to approval queue
```

Policy bisa diimplementasikan dengan:

- Java service,
- database rules,
- policy engine,
- expression evaluator,
- OPA-like external PDP,
- hybrid role + domain service.

Yang penting bukan tool-nya, tetapi invariants-nya jelas.

---

## 7. Authorization Decision Model

Keputusan authorization yang matang minimal memiliki bentuk:

```text
Decision = f(subject, action, resource, context)
```

### 7.1 Subject

```text
subject:
  localUserId
  externalSubject
  callerPrincipal
  activeTenant
  roles
  groups
  memberships
  authenticationStrength
  sessionId
```

### 7.2 Action

```text
action:
  VIEW_CASE
  UPDATE_CASE
  SUBMIT_CASE
  APPROVE_CASE
  REJECT_CASE
  ASSIGN_CASE
  EXPORT_REPORT
```

### 7.3 Resource

```text
resource:
  type = CASE
  id = C-1023
  tenant = agency-a
  state = SUBMITTED
  owner = user-456
  assignedTeam = review-team-1
  sensitivity = NORMAL
```

### 7.4 Context

```text
context:
  requestTime
  sourceIp
  channel
  authenticationMethod
  mfaSatisfied
  delegation
  riskScore
  transactionAmount
  emergencyMode
```

### 7.5 Decision Result

Jangan hanya boolean.

```text
AuthorizationDecision:
  allowed: true/false
  reasonCode: string
  evaluatedRules: list
  obligations: list
  auditData: map
```

Contoh:

```json
{
  "allowed": false,
  "reasonCode": "MAKER_CANNOT_APPROVE_OWN_CASE",
  "action": "APPROVE_CASE",
  "resource": "C-1023"
}
```

Kenapa reason code penting?

- audit,
- debugging,
- user support,
- regulatory explanation,
- consistent UI message,
- incident investigation.

---

## 8. Role-Based Access Control, Attribute-Based Access Control, Relationship-Based Access Control

### 8.1 RBAC

RBAC berbasis role.

```text
User has role CASE_APPROVER.
CASE_APPROVER can approve case.
```

Kuat untuk:

- coarse access,
- module access,
- admin functions,
- simple enterprise app.

Lemah untuk:

- tenant,
- resource ownership,
- workflow state,
- conflict of interest,
- temporal access.

---

### 8.2 ABAC

ABAC berbasis attribute.

```text
Allow if:
  subject.department == resource.department
  and subject.clearance >= resource.classification
  and currentTime within businessHours
```

Kuat untuk:

- dynamic policy,
- multi-dimensional condition,
- complex enterprise rules.

Lemah jika:

- attribute quality buruk,
- policy terlalu sulit dipahami,
- debugging susah,
- performance tidak dikontrol.

---

### 8.3 ReBAC

Relationship-Based Access Control berbasis relasi.

```text
Allow if:
  subject is assignee of case
  subject manages owner of case
  subject belongs to team assigned to case
```

Kuat untuk:

- collaboration systems,
- case management,
- workflow,
- document sharing,
- organization graph.

Lemah jika:

- graph traversal mahal,
- relationship stale,
- cycles,
- delegation tidak jelas.

---

### 8.4 PBAC / Policy-Based Access Control

PBAC adalah pendekatan di mana policy menjadi pusat keputusan.

```text
Policy:
  case.approve:
    allow when actor has CASE_APPROVER role
    and actor.tenant == case.tenant
    and case.state == SUBMITTED
    and actor.id != case.createdBy
```

Dalam sistem serius, biasanya hybrid:

```text
RBAC for coarse capability
ABAC for attributes
ReBAC for relationships
Policy service for consistency
```

---

## 9. Java/Jakarta Naming Trap: `role`, `group`, `principal`

### 9.1 Container Role

Dalam Servlet/Jakarta EE, role sering muncul di:

```text
web.xml
@DeclareRoles
@RolesAllowed
isUserInRole
```

Role ini adalah role yang dikenal container.

Tetapi dari mana asalnya?

```text
IdP groups
  → realm mapping
  → container groups
  → application roles
  → isUserInRole result
```

Setiap container bisa punya cara mapping sendiri.

### 9.2 GroupPrincipal

Dalam Jakarta Authentication, group principal callback menetapkan group principals.

Tetapi aplikasi bisa memperlakukan group itu sebagai role untuk `isUserInRole`, tergantung container mapping.

Ini alasan kenapa portable security tidak selalu portable secara semantic.

### 9.3 Principal Name

Principal name bisa “caller name”, bukan local user ID.

Jangan lakukan ini tanpa binding eksplisit:

```java
Long userId = Long.valueOf(request.getUserPrincipal().getName());
```

Lebih baik:

```java
String providerSubject = request.getUserPrincipal().getName();
Identity identity = identityResolver.resolve(provider, providerSubject);
```

---

## 10. Security Invariants

Invariants adalah aturan yang harus selalu benar.

### 10.1 Authentication Invariants

```text
- No request is considered authenticated without validated credential/session/token.
- Disabled account cannot establish new authenticated session.
- Locked credential cannot be used even if password is correct.
- Expired token/session cannot establish caller identity.
- Caller principal must be traceable to trusted source.
```

### 10.2 Identity Invariants

```text
- Local identity ID is immutable.
- External subject must be associated with at most one active local identity per provider.
- Email/display name must not be used as immutable key.
- Identity merge/linking must be auditable.
- Service identity must be distinguishable from human identity.
```

### 10.3 Role/Group Invariants

```text
- External group names are not business rules.
- Role mapping must be explicit and reviewable.
- Tenant-scoped roles must not leak across tenants.
- Role changes must eventually affect active sessions according to defined freshness policy.
- Admin roles must be separated by responsibility.
```

### 10.4 Authorization Invariants

```text
- Authorization is enforced server-side.
- Every state-changing operation has authorization check.
- Object-level access checks cannot be replaced by menu hiding.
- Deny by default.
- Permission decision must include resource and context for domain actions.
- Maker-checker constraint cannot be bypassed by admin role unless break-glass policy applies.
```

### 10.5 Audit Invariants

```text
- Audit actor is not just display name.
- Audit stores stable local identity and external identity source.
- Delegated action records both initiator and executor.
- Security-sensitive allow and deny decisions are auditable.
- Audit trail does not store raw credentials/tokens.
```

---

## 11. Failure Models

### 11.1 Principal Confusion

Symptom:

```text
User from provider A and user from provider B have same username.
System maps both to same local account.
```

Cause:

```text
username used without provider namespace
```

Prevention:

```text
federated key = provider + issuer + subject
```

---

### 11.2 Group Rename Outage

Symptom:

```text
After AD/Keycloak group rename, users lose access.
```

Cause:

```text
business code checks raw external group string
```

Prevention:

```text
central role mapping table
mapping health check
role mapping audit
```

---

### 11.3 Stale Role Session

Symptom:

```text
User removed from admin group but still can access admin feature until session expires.
```

Cause:

```text
roles copied into session without refresh/revocation strategy
```

Prevention options:

```text
short session lifetime
role version check
session invalidation on role change
periodic revalidation
token introspection
central authorization service
```

---

### 11.4 Cross-Tenant Leak

Symptom:

```text
User in tenant A accesses case in tenant B by changing URL id.
```

Cause:

```text
authorization only checks role, not resource tenant
```

Bad:

```java
@RolesAllowed("CASE_VIEWER")
GET /cases/{id}
```

Better:

```text
Require:
  role CASE_VIEWER
  and case.tenant == actor.activeTenant
```

---

### 11.5 Token Claim Overtrust

Symptom:

```text
API accepts JWT from different client/audience.
```

Cause:

```text
signature checked but audience/issuer not checked
```

Prevention:

```text
validate issuer
validate audience
validate expiration
validate algorithm
validate key id
validate authorized party/client
map claims explicitly
```

---

### 11.6 Service Account Privilege Explosion

Symptom:

```text
Internal service token can do everything.
```

Cause:

```text
one shared service account with broad role
```

Prevention:

```text
per-service identity
least privilege
scope by API
audience-specific tokens
mTLS/service mesh identity
audit service actor separately
```

---

### 11.7 Audit Actor Ambiguity

Symptom:

```text
Audit says "SYSTEM" approved case, but human user initiated it.
```

Cause:

```text
background job loses original actor
```

Prevention:

```text
initiated_by
executed_by
on_behalf_of
delegation_reason
correlation_id
```

---

## 12. Design Heuristics

### 12.1 Use Different Names for Different Concepts

Avoid one overloaded `User`.

Prefer names like:

```text
AuthenticatedCaller
LocalIdentity
ExternalIdentity
Account
UserProfile
TenantMembership
RoleAssignment
AuthorizationActor
AuditActor
```

Even if implemented compactly, naming in code should reveal intent.

---

### 12.2 Keep External Identity Separate from Application Identity

External identity can change because:

- IdP migration,
- account linking,
- government identity update,
- username/email change,
- provider consolidation,
- tenant reorganization.

Application identity should remain stable for audit and foreign keys.

---

### 12.3 Treat Roles as Coarse Gates, Not Domain Truth

Use roles for:

```text
- module access
- endpoint category
- admin console access
```

Use policy for:

```text
- action on resource
- case state transition
- tenant data access
- approval rights
```

---

### 12.4 Make Authorization Decisions Explainable

A serious authorization service should answer:

```text
Why allowed?
Why denied?
Which rule applied?
Which actor?
Which resource?
Which tenant?
Which time?
```

If you cannot explain a denial, production support becomes painful.

If you cannot explain an allow, audit becomes weak.

---

### 12.5 Do Not Let UI Become Security Source of Truth

UI is advisory.

API/domain layer is enforcement.

```text
UI: hides approve button
API: checks permission
Domain: validates transition
Database: optionally enforces tenant/ownership constraints
Audit: records decision
```

Defense in depth.

---

### 12.6 Model Human, Service, and System Actors Differently

Do not collapse all actors into `user_id`.

Use actor type:

```text
HUMAN
SERVICE
SYSTEM_JOB
EXTERNAL_SYSTEM
DELEGATED
BREAK_GLASS
```

This affects:

- authentication method,
- authorization policy,
- audit wording,
- support process,
- incident response.

---

## 13. Practical Reference Model

### 13.1 Core Identity Tables

```sql
create table identities (
    id                  bigint primary key,
    identity_type       varchar(32) not null, -- HUMAN, SERVICE, SYSTEM
    status              varchar(32) not null, -- ACTIVE, DISABLED, LOCKED
    display_name        varchar(255),
    email               varchar(255),
    created_at          timestamp not null,
    updated_at          timestamp not null
);

create table federated_identities (
    id                  bigint primary key,
    identity_id          bigint not null,
    provider             varchar(64) not null,
    issuer               varchar(512) not null,
    external_subject     varchar(512) not null,
    external_username    varchar(255),
    linked_at            timestamp not null,
    last_seen_at         timestamp,
    unique (provider, issuer, external_subject)
);

create table tenant_memberships (
    identity_id          bigint not null,
    tenant_id            varchar(64) not null,
    status               varchar(32) not null,
    valid_from           timestamp,
    valid_until          timestamp,
    primary key (identity_id, tenant_id)
);

create table role_assignments (
    identity_id          bigint not null,
    tenant_id            varchar(64),
    role_code            varchar(128) not null,
    source               varchar(64) not null, -- LOCAL, IDP_GROUP_MAPPING, DELEGATION
    valid_from           timestamp,
    valid_until          timestamp,
    primary key (identity_id, tenant_id, role_code)
);
```

Ini bukan schema wajib, tetapi reference model.

---

### 13.2 Runtime Actor Object

```java
public final class AuthorizationActor {
    private final String localIdentityId;
    private final ActorType actorType;
    private final String provider;
    private final String externalSubject;
    private final String activeTenantId;
    private final Set<String> roles;
    private final Set<String> groups;
    private final AuthenticationStrength authenticationStrength;
    private final String sessionId;
    private final String correlationId;

    // constructor/getters omitted
}
```

Catatan:

- `groups` raw dari IdP/container.
- `roles` sudah app-level.
- `activeTenantId` adalah tenant yang sedang dipakai.
- `externalSubject` untuk trace ke IdP.
- `localIdentityId` untuk domain model.
- `correlationId` untuk audit/debug.

---

### 13.3 Permission Check API

```java
public interface AuthorizationService {
    AuthorizationDecision decide(
        AuthorizationActor actor,
        Action action,
        ResourceDescriptor resource,
        AuthorizationContext context
    );

    default void require(
        AuthorizationActor actor,
        Action action,
        ResourceDescriptor resource,
        AuthorizationContext context
    ) {
        AuthorizationDecision decision = decide(actor, action, resource, context);
        if (!decision.allowed()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
    }
}
```

---

### 13.4 Decision Object

```java
public record AuthorizationDecision(
    boolean allowed,
    String reasonCode,
    Map<String, Object> auditAttributes
) {
    public static AuthorizationDecision allow(String reasonCode) {
        return new AuthorizationDecision(true, reasonCode, Map.of());
    }

    public static AuthorizationDecision deny(String reasonCode) {
        return new AuthorizationDecision(false, reasonCode, Map.of());
    }
}
```

---

### 13.5 Example Policy

```java
public AuthorizationDecision canApproveCase(
    AuthorizationActor actor,
    CaseRecord caseRecord
) {
    if (!actor.roles().contains("CASE_APPROVER")) {
        return AuthorizationDecision.deny("MISSING_CASE_APPROVER_ROLE");
    }

    if (!caseRecord.tenantId().equals(actor.activeTenantId())) {
        return AuthorizationDecision.deny("TENANT_MISMATCH");
    }

    if (!caseRecord.state().equals(CaseState.SUBMITTED)) {
        return AuthorizationDecision.deny("CASE_NOT_IN_SUBMITTED_STATE");
    }

    if (caseRecord.createdBy().equals(actor.localIdentityId())) {
        return AuthorizationDecision.deny("MAKER_CANNOT_APPROVE_OWN_CASE");
    }

    if (!caseRecord.approvalQueue().contains(actor.localIdentityId())) {
        return AuthorizationDecision.deny("NOT_IN_APPROVAL_QUEUE");
    }

    return AuthorizationDecision.allow("APPROVER_ASSIGNED_FOR_SUBMITTED_CASE");
}
```

Perhatikan bahwa role hanya satu bagian dari policy.

---

## 14. Jakarta Security Example: Coarse + Domain Authorization

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.security.enterprise.SecurityContext;

public class CaseResource {

    @Inject
    SecurityContext securityContext;

    @Inject
    ActorResolver actorResolver;

    @Inject
    AuthorizationService authorizationService;

    @Inject
    CaseRepository caseRepository;

    @RolesAllowed("CASE_APPROVER")
    public void approveCase(String caseId) {
        AuthorizationActor actor = actorResolver.from(securityContext);
        CaseRecord caseRecord = caseRepository.get(caseId);

        authorizationService.require(
            actor,
            Action.APPROVE_CASE,
            ResourceDescriptor.caseResource(caseRecord),
            AuthorizationContext.current()
        );

        // perform state transition only after authorization
        caseRepository.markApproved(caseId, actor.localIdentityId());
    }
}
```

Layering:

```text
@RolesAllowed
    coarse container/application guard

authorizationService.require(...)
    fine-grained domain guard

caseRepository.markApproved(...)
    state mutation after authorization

audit
    record actor/action/resource/decision
```

---

## 15. Mental Model for Debugging Security Issues

Ketika ada bug “user tidak bisa akses” atau “user bisa akses padahal tidak boleh”, jangan langsung lihat satu annotation. Gunakan chain ini:

```text
1. Credential
   - Apakah credential valid?
   - Expired?
   - Correct issuer?
   - Correct audience?
   - Session masih hidup?

2. Authentication
   - Apakah caller principal terbentuk?
   - Principal name apa?
   - Dari provider mana?

3. Identity binding
   - Principal ter-map ke local identity mana?
   - Duplicate?
   - Disabled?

4. Group/claim
   - Groups/claims apa yang diterima?
   - Fresh?
   - Environment benar?

5. Role mapping
   - External group menjadi role apa?
   - Tenant-scoped?
   - Mapping enabled?

6. Authorization
   - Role cukup?
   - Resource tenant cocok?
   - State cocok?
   - Assignment cocok?
   - SoD/maker-checker lolos?

7. Enforcement point
   - Check dilakukan di API?
   - Check dilakukan sebelum mutation?
   - Ada bypass endpoint lain?

8. Audit/log
   - Decision reason apa?
   - Correlation ID?
   - Actor siapa?
```

---

## 16. Checklist Desain Vocabulary

Gunakan checklist ini saat merancang modul security:

### Identity

```text
[ ] Apakah local identity immutable?
[ ] Apakah external subject disimpan dengan provider/issuer?
[ ] Apakah email tidak dipakai sebagai primary key security?
[ ] Apakah human dan service identity dibedakan?
[ ] Apakah account linking auditable?
```

### Credential

```text
[ ] Apakah credential tidak pernah dilog?
[ ] Apakah credential expiry divalidasi?
[ ] Apakah token issuer/audience/signature dicek?
[ ] Apakah session fixation dicegah?
[ ] Apakah disabled account tidak bisa login?
```

### Principal/Subject/Caller

```text
[ ] Apakah principal name diperlakukan sebagai external identifier, bukan otomatis local ID?
[ ] Apakah caller identity tersedia di semua enforcement point?
[ ] Apakah async/background flow preserve actor atau secara eksplisit memakai system identity?
[ ] Apakah delegation dimodelkan?
```

### Group/Role

```text
[ ] Apakah external groups dipetakan ke app roles secara eksplisit?
[ ] Apakah role tenant-scoped bila perlu?
[ ] Apakah role mapping tidak hardcoded di business code?
[ ] Apakah role changes punya freshness strategy?
```

### Permission/Policy

```text
[ ] Apakah state-changing operation punya server-side authorization?
[ ] Apakah object-level check ada?
[ ] Apakah tenant boundary dicek?
[ ] Apakah domain state dicek?
[ ] Apakah maker-checker/SoD dicek?
[ ] Apakah denial punya reason code?
```

### Audit

```text
[ ] Apakah audit menyimpan actor stabil?
[ ] Apakah audit menyimpan external identity source?
[ ] Apakah allow/deny untuk aksi sensitif dicatat?
[ ] Apakah delegated/system execution jelas?
[ ] Apakah audit bebas token/password/secret?
```

---

## 17. Top 1% Perspective

Developer biasa sering berpikir:

```text
Login → role → allow
```

Engineer matang berpikir:

```text
Trust source
    → credential evidence
    → authentication result
    → caller establishment
    → identity binding
    → tenant membership
    → role mapping
    → permission policy
    → resource/state/context evaluation
    → enforcement
    → audit
    → revocation/freshness
    → failure model
```

Perbedaan terbesar bukan di API. Perbedaannya ada di kemampuan menjaga makna.

Aplikasi enterprise security yang kuat bukan yang punya banyak annotation, tetapi yang punya:

```text
- identity model jelas,
- trust boundary jelas,
- mapping eksplisit,
- enforcement point konsisten,
- authorization domain-aware,
- audit defensible,
- revocation/freshness strategy,
- failure mode dipikirkan sejak awal.
```

---

## 18. Ringkasan

Part ini membangun vocabulary dasar:

| Istilah | Makna Ringkas | Jangan Disamakan Dengan |
|---|---|---|
| Identity | Entity yang dikenali trust domain | credential |
| User | Human user aplikasi | account/principal universal |
| Account | Record akses/lifecycle | identity mutlak |
| Credential | Bukti kontrol | authorization |
| Principal | Nama/representasi identity | full user profile |
| Subject | Kumpulan principals/credentials | satu role |
| Caller | Actor pada execution boundary | selalu human user |
| Group | Koleksi dari IdP/directory | app permission |
| Role | Capability label aplikasi | permission final |
| Permission | Hak melakukan action/resource | role name |
| Claim | Statement dari issuer | fakta mutlak |
| Scope | OAuth grant boundary | domain role |

Core invariant:

```text
Authentication establishes who the caller is.
Authorization decides what the caller may do.
Domain policy decides whether that action is valid for this resource, tenant, state, relationship, and context.
Audit records what happened and why.
```

---

## 19. Referensi Resmi dan Lanjutan

- Jakarta Security 4.0 Specification  
  https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0

- Jakarta Security 4.0 API: `SecurityContext`  
  https://jakarta.ee/specifications/security/4.0/apidocs/jakarta.security/jakarta/security/enterprise/securitycontext

- Jakarta Authentication 3.1 Specification  
  https://jakarta.ee/specifications/authentication/3.1/jakarta-authentication-spec-3.1

- Jakarta Authentication API: `CallerPrincipalCallback`  
  https://jakarta.ee/specifications/authentication/3.1/apidocs/jakarta.security.auth.message/jakarta/security/auth/message/callback/callerprincipalcallback

- Jakarta Authentication API: `GroupPrincipalCallback`  
  https://jakarta.ee/specifications/authentication/3.0/apidocs/jakarta.security.auth.message/jakarta/security/auth/message/callback/groupprincipalcallback

- Jakarta Authorization 3.0 Specification  
  https://jakarta.ee/specifications/authorization/3.0/jakarta-authorization-spec-3.0

- Jakarta Authorization overview  
  https://jakarta.ee/specifications/authorization/

- Java SE `Principal`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/security/Principal.html

---

## 20. Status Seri

Selesai:

```text
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
```

Belum selesai. Lanjut ke:

```text
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 00 — Orientation: Enterprise Java Security Mental Model](./learn-java-jakarta-security-authentication-authorization-identity-part-00-orientation-and-mental-model.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security](./learn-java-jakarta-security-authentication-authorization-identity-part-02-jaas-jacc-jaspic-javaee-jakarta-history.md)

</div>