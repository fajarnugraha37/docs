# Part 14 — Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-14-roles-groups-claims-scopes-authorities-mapping.md`  
> Target: Java 8–25, Java EE/Jakarta EE, Servlet, JAX-RS, CDI/EJB, Jakarta Security, Jakarta Authentication, Jakarta Authorization, OAuth2/OIDC, SAML-style federation, MicroProfile JWT, enterprise identity integration.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah masuk ke declarative authorization dan programmatic/domain authorization. Di sana kita mulai melihat bahwa `@RolesAllowed("ADMIN")` atau `securityContext.isCallerInRole("APPROVER")` hanya aman jika istilah **role** yang dicek memang memiliki makna yang stabil, benar, dan sesuai domain.

Bagian ini membahas satu masalah yang sering menjadi akar privilege escalation di sistem enterprise:

> identity provider bicara dalam bahasa **groups/claims/scopes**, framework bicara dalam bahasa **roles/authorities**, aplikasi bicara dalam bahasa **permissions/business actions**, tetapi developer sering menyatukan semuanya menjadi satu string.

Contoh yang terlihat sederhana:

```java
@RolesAllowed("ADMIN")
public void approveCase(String caseId) { ... }
```

Terlihat aman. Tetapi pertanyaan sebenarnya:

1. `ADMIN` itu role aplikasi, group LDAP, realm role Keycloak, client role Keycloak, OAuth scope, SAML attribute, atau authority framework?
2. Siapa yang berhak memberi `ADMIN`?
3. Apakah `ADMIN` berlaku untuk semua tenant?
4. Apakah `ADMIN` berlaku untuk semua module?
5. Apakah `ADMIN` boleh approve case yang dia buat sendiri?
6. Apakah role berubah saat user pindah organisasi?
7. Apakah role lama masih tersimpan di session?
8. Apakah token lama masih membawa role lama?
9. Apakah string `ADMIN` sama artinya di service A dan service B?
10. Apakah `ADMIN` dari IdP dev accidentally diterima di production?

Topik ini bukan sekadar naming convention. Ini adalah desain kontrak security.

---

## 1. Mental Model Utama

Sistem enterprise modern biasanya memiliki beberapa bahasa authorization yang berbeda:

```text
Identity Provider Language
    groups, directory roles, realm roles, client roles, SAML attributes, OIDC claims

Protocol Language
    scopes, audience, issuer, subject, token claims

Container / Framework Language
    principal, group principal, role, authority, subject, permission

Application Language
    module role, business role, action permission, workflow state permission

Domain Language
    actor, officer, assignee, supervisor, approver, tenant admin, case owner
```

Kesalahan umum adalah membuat satu string bergerak melewati semua layer tanpa translasi yang jelas:

```text
LDAP group = OIDC claim = Jakarta role = API permission = business entitlement
```

Itu keliru.

Yang benar adalah:

```text
External identity facts
    ↓ normalize
Application security contract
    ↓ derive
Domain authorization decision
```

Artinya:

- **Group** adalah fakta eksternal tentang membership.
- **Claim** adalah fakta/token statement dari issuer.
- **Scope** adalah batas akses OAuth client/token.
- **Role** adalah abstraction aplikasi/container untuk authorization coarse-grained.
- **Authority** adalah istilah framework-specific, sering dipakai Spring Security.
- **Permission** adalah aksi konkret terhadap resource/domain object.

Role yang baik bukan sekadar string dari IdP. Role yang baik adalah kontrak aplikasi yang dipetakan secara eksplisit dari fakta identity eksternal.

---

## 2. Vocabulary: Bedanya Role, Group, Claim, Scope, Authority, Permission

### 2.1 Group

**Group** biasanya berasal dari directory/IdP:

- LDAP group,
- Active Directory group,
- Keycloak group,
- Azure/Entra group,
- Okta group,
- organisasi internal,
- SAML attribute group,
- JWT `groups` claim.

Group menjawab:

> caller adalah anggota kelompok apa menurut identity system?

Contoh:

```text
cn=cea-aceas-appeal-officer,ou=groups,dc=agency,dc=gov
/ACEAS/Compliance/Officer
GROUP_0192837465
CEA_CASE_APPROVERS_UAT
```

Group sering bersifat organisasi/operasional, bukan domain permission final.

Masalah group:

1. Nama bisa berubah.
2. ID bisa berbeda antar environment.
3. Membership bisa terlalu luas.
4. Group bisa shared oleh beberapa aplikasi.
5. Group tidak selalu punya konteks tenant/module/action.
6. Group bisa datang terlalu banyak di token.
7. Group bisa tersembunyi di opaque token atau UserInfo endpoint.
8. Group mungkin tidak cocok langsung dengan `@RolesAllowed`.

### 2.2 Role

**Role** dalam aplikasi adalah abstraction authorization.

Role menjawab:

> dalam aplikasi ini, caller boleh bertindak sebagai apa?

Contoh role aplikasi:

```text
CASE_VIEWER
CASE_OFFICER
CASE_SUPERVISOR
APPEAL_REVIEWER
APPEAL_APPROVER
TENANT_ADMIN
SYSTEM_ADMIN
REPORT_VIEWER
```

Role yang baik bersifat:

- stabil,
- domain-oriented,
- tidak bergantung pada nama group external,
- bisa didokumentasikan,
- bisa diuji,
- bisa diaudit,
- bisa dipetakan ulang tanpa mengubah business code.

Dalam Jakarta Security/Jakarta EE, role biasanya dipakai oleh:

```java
@RolesAllowed("CASE_OFFICER")
```

atau:

```java
securityContext.isCallerInRole("CASE_OFFICER")
```

Di Servlet:

```java
request.isUserInRole("CASE_OFFICER")
```

### 2.3 Claim

**Claim** adalah statement di token/assertion tentang subject atau authentication event.

Contoh OIDC/JWT claims:

```json
{
  "iss": "https://idp.example.gov/realms/agency",
  "sub": "248289761001",
  "aud": "aceas-api",
  "exp": 1760000000,
  "iat": 1759996400,
  "preferred_username": "fajar",
  "email": "fajar@example.gov",
  "groups": ["/ACEAS/Appeal/Reviewer"],
  "agency": "CEA",
  "tenant_id": "CEA",
  "amr": ["pwd", "mfa"]
}
```

Claim menjawab:

> issuer menyatakan apa tentang subject/token/authentication?

Claim bukan permission otomatis. Claim harus divalidasi dan dimaknai.

Contoh claim yang sering disalahgunakan:

- `email`: dipakai sebagai identity primary padahal bisa berubah.
- `preferred_username`: dipakai sebagai stable identifier padahal bukan stable key.
- `groups`: langsung jadi role tanpa mapping.
- `scope`: dianggap user permission padahal scope adalah grant ke client/token.
- `aud`: diabaikan sehingga token untuk service lain diterima.
- `iss`: diabaikan sehingga token dari issuer lain diterima.

### 2.4 Scope

**Scope** berasal dari OAuth2.

Scope menjawab:

> access token ini dibatasi untuk jenis akses apa terhadap resource server?

Contoh:

```text
openid profile email
case.read case.write report.export
api://aceas/case.approve
```

Dalam OAuth2, scope adalah mekanisme untuk membatasi access token yang diberikan kepada client. OAuth2 sendiri memungkinkan third-party application memperoleh limited access ke HTTP service. Dalam OIDC, request harus membawa scope `openid`, dan scope lain seperti `profile`/`email` dapat digunakan untuk meminta claims tertentu.

Scope sering keliru dianggap sama dengan role user. Padahal scope lebih dekat ke **token/client grant** dibanding **business role**.

Contoh:

```text
scope = case.write
```

Belum tentu berarti user boleh approve semua case. Itu bisa berarti token boleh memanggil endpoint write, tetapi aplikasi tetap harus mengecek:

- user role,
- tenant,
- ownership,
- assignment,
- workflow state,
- segregation of duties.

### 2.5 Authority

**Authority** bukan istilah utama Jakarta EE, tetapi sering muncul di Spring Security.

Authority biasanya berarti granted capability string yang dilekatkan ke `Authentication` object.

Contoh Spring-style:

```text
ROLE_ADMIN
SCOPE_case.read
PERMISSION_CASE_APPROVE
```

Di Spring Security, role sering direpresentasikan sebagai authority dengan prefix `ROLE_`. Di Jakarta EE, role biasanya adalah string role yang dicek oleh container via `isCallerInRole` atau `@RolesAllowed`.

Jangan menyamakan istilah framework tanpa translasi eksplisit.

### 2.6 Permission

**Permission** adalah izin aksi terhadap resource.

Permission menjawab:

> subject boleh melakukan action X terhadap resource Y dalam context Z?

Contoh:

```text
case:view
case:update
case:assign
case:approve
appeal:review
appeal:approve
report:export
user:manage-role
```

Permission bisa coarse-grained atau fine-grained.

Permission yang matang biasanya bukan hanya string, tetapi decision input:

```text
subject = current actor
action  = APPROVE
resource = Case#123
context = tenant CEA, state PENDING_APPROVAL, assignee officerA
```

---

## 3. Ringkasan Perbedaan

| Konsep | Layer Asal | Menjawab | Contoh | Risiko Jika Disalahgunakan |
|---|---|---|---|---|
| Group | IdP/directory | User anggota kelompok apa? | `/ACEAS/Appeal/Reviewer` | Coupling ke struktur IdP |
| Role | App/container | Caller bertindak sebagai apa di aplikasi? | `APPEAL_REVIEWER` | Terlalu coarse-grained |
| Claim | Token/assertion | Issuer menyatakan apa? | `tenant_id=CEA` | Claim dipercaya tanpa validasi issuer/audience |
| Scope | OAuth token grant | Token dibatasi untuk akses apa? | `case.write` | Dianggap user permission final |
| Authority | Framework | Granted capability internal framework | `ROLE_ADMIN` | Prefix/semantik campur antar framework |
| Permission | Domain/app policy | Boleh melakukan aksi apa terhadap resource? | `case:approve` | Permission explosion jika desain buruk |

---

## 4. Chain yang Benar: Dari External Facts ke Domain Decision

Bayangkan login OIDC menghasilkan token seperti ini:

```json
{
  "iss": "https://idp.example.gov/realms/gov",
  "sub": "user-001",
  "aud": "aceas-web",
  "groups": [
    "/ACEAS/Case/Officer",
    "/ACEAS/Appeal/Approver"
  ],
  "scope": "openid profile email",
  "tenant_id": "CEA"
}
```

Chain yang sehat:

```text
1. Validate token/authentication event
   - issuer valid?
   - audience valid?
   - signature valid?
   - expiry valid?
   - nonce/state valid? for browser login

2. Extract external facts
   - subject
   - groups
   - claims
   - auth method
   - tenant claim

3. Normalize identity
   - stable user id
   - canonical tenant id
   - canonical external group names/ids

4. Map external facts to application roles
   /ACEAS/Case/Officer       -> CASE_OFFICER
   /ACEAS/Appeal/Approver    -> APPEAL_APPROVER

5. Establish container caller
   principal = user-001
   groups/roles = CASE_OFFICER, APPEAL_APPROVER

6. Enforce coarse authorization
   @RolesAllowed("APPEAL_APPROVER")

7. Enforce domain authorization
   Can this actor approve this appeal in this state for this tenant?

8. Audit decision
   actor, role source, action, resource, tenant, result, reason
```

Chain yang buruk:

```text
groups claim contains /ACEAS/Appeal/Approver
    ↓
application code checks raw string everywhere
    ↓
if group exists, approve anything
```

Masalahnya:

- raw group menjadi business contract,
- business code tahu struktur IdP,
- migration IdP merusak aplikasi,
- audit sulit menjelaskan permission final,
- role overreach sulit dikendalikan,
- multi-tenant boundary mudah bocor.

---

## 5. Layer Mapping yang Direkomendasikan

Gunakan minimal empat layer kontrak:

```text
External Identity Facts
    ↓
Security Mapping Layer
    ↓
Application Roles
    ↓
Domain Permissions / Policy Decisions
```

### 5.1 External Identity Facts

Contoh:

```text
issuer = https://idp.example.gov
subject = user-001
groups = /ACEAS/Case/Officer, /ACEAS/Appeal/Approver
tenant_id = CEA
acr = urn:gov:mfa:level2
```

Sifatnya:

- milik IdP/protocol,
- bisa berubah,
- harus divalidasi,
- tidak ideal disebar ke business code.

### 5.2 Security Mapping Layer

Layer ini menerjemahkan fakta eksternal menjadi vocabulary aplikasi.

Contoh:

```yaml
issuer: https://idp.example.gov/realms/gov
application: aceas
mappings:
  - externalGroup: /ACEAS/Case/Officer
    appRole: CASE_OFFICER
  - externalGroup: /ACEAS/Appeal/Approver
    appRole: APPEAL_APPROVER
  - externalGroup: /ACEAS/Admin/TenantAdmin
    appRole: TENANT_ADMIN
```

Atau database:

```sql
CREATE TABLE external_role_mapping (
    id                  BIGINT PRIMARY KEY,
    issuer              VARCHAR(500) NOT NULL,
    external_type       VARCHAR(50)  NOT NULL, -- GROUP, CLAIM, SCOPE, CLIENT_ROLE
    external_value      VARCHAR(500) NOT NULL,
    application_code    VARCHAR(100) NOT NULL,
    application_role    VARCHAR(100) NOT NULL,
    tenant_scope        VARCHAR(100),
    enabled             CHAR(1) DEFAULT 'Y',
    effective_from      TIMESTAMP,
    effective_until     TIMESTAMP,
    created_by          VARCHAR(100),
    created_at          TIMESTAMP,
    UNIQUE (issuer, external_type, external_value, application_code, application_role)
);
```

### 5.3 Application Roles

Role yang dipahami container dan aplikasi:

```java
public final class AppRoles {
    private AppRoles() {}

    public static final String CASE_VIEWER = "CASE_VIEWER";
    public static final String CASE_OFFICER = "CASE_OFFICER";
    public static final String CASE_SUPERVISOR = "CASE_SUPERVISOR";
    public static final String APPEAL_REVIEWER = "APPEAL_REVIEWER";
    public static final String APPEAL_APPROVER = "APPEAL_APPROVER";
    public static final String TENANT_ADMIN = "TENANT_ADMIN";
    public static final String SYSTEM_ADMIN = "SYSTEM_ADMIN";
}
```

Digunakan oleh Jakarta annotations:

```java
import jakarta.annotation.security.RolesAllowed;

@RolesAllowed(AppRoles.APPEAL_APPROVER)
public void approveAppeal(String appealId) {
    ...
}
```

Catatan: annotation value harus compile-time constant. Maka string constant masih umum dipakai.

### 5.4 Domain Permissions

Role tidak cukup untuk resource-level decision.

Contoh:

```java
public enum CaseAction {
    VIEW,
    UPDATE,
    ASSIGN,
    SUBMIT_RECOMMENDATION,
    APPROVE,
    REJECT,
    REOPEN,
    EXPORT
}
```

Policy:

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final String reasonCode;
    private final String explanation;

    private AuthorizationDecision(boolean allowed, String reasonCode, String explanation) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
        this.explanation = explanation;
    }

    public static AuthorizationDecision allow(String reasonCode) {
        return new AuthorizationDecision(true, reasonCode, "Allowed");
    }

    public static AuthorizationDecision deny(String reasonCode, String explanation) {
        return new AuthorizationDecision(false, reasonCode, explanation);
    }

    public boolean isAllowed() {
        return allowed;
    }

    public String getReasonCode() {
        return reasonCode;
    }

    public String getExplanation() {
        return explanation;
    }
}
```

Decision service:

```java
public interface CaseAuthorizationService {
    AuthorizationDecision canPerform(Actor actor, CaseAction action, CaseRecord caseRecord);
}
```

---

## 6. Role Mapping di Jakarta Security

Dalam Jakarta Security, identity biasanya muncul dari `IdentityStore` melalui `CredentialValidationResult`.

Contoh custom identity store:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.security.enterprise.credential.Credential;
import jakarta.security.enterprise.credential.UsernamePasswordCredential;
import jakarta.security.enterprise.identitystore.CredentialValidationResult;
import jakarta.security.enterprise.identitystore.IdentityStore;

import java.util.HashSet;
import java.util.Set;

@ApplicationScoped
public class ApplicationIdentityStore implements IdentityStore {

    private final UserRepository users;
    private final PasswordVerifier passwordVerifier;
    private final ExternalGroupRoleMapper roleMapper;

    public ApplicationIdentityStore(
            UserRepository users,
            PasswordVerifier passwordVerifier,
            ExternalGroupRoleMapper roleMapper) {
        this.users = users;
        this.passwordVerifier = passwordVerifier;
        this.roleMapper = roleMapper;
    }

    @Override
    public CredentialValidationResult validate(Credential credential) {
        if (!(credential instanceof UsernamePasswordCredential)) {
            return CredentialValidationResult.NOT_VALIDATED_RESULT;
        }

        UsernamePasswordCredential usernamePassword = (UsernamePasswordCredential) credential;
        String username = usernamePassword.getCaller();

        UserAccount account = users.findByUsername(username);
        if (account == null) {
            return CredentialValidationResult.INVALID_RESULT;
        }

        if (!account.isActive()) {
            return CredentialValidationResult.INVALID_RESULT;
        }

        boolean valid = passwordVerifier.verify(
                usernamePassword.getPasswordAsString(),
                account.getPasswordHash()
        );

        if (!valid) {
            return CredentialValidationResult.INVALID_RESULT;
        }

        Set<String> externalGroups = account.getExternalGroups();
        Set<String> applicationRoles = roleMapper.mapGroupsToRoles(
                account.getIssuer(),
                externalGroups,
                account.getTenantId()
        );

        return new CredentialValidationResult(
                account.getStableUserId(),
                applicationRoles
        );
    }
}
```

Yang penting: `applicationRoles` di atas bukan raw group. Itu role aplikasi yang sudah dinormalisasi.

Di Jakarta Security, authentication mechanism menggunakan identity store untuk mencocokkan credential dengan known identity; jika cocok, identity tersebut dipakai untuk membangun authenticated subject/principal. Jakarta Security 4.0 juga menyediakan API modern untuk aplikasi Jakarta EE, termasuk mechanism, identity store, dan security context.

---

## 7. Mapping Claim OIDC ke Role Jakarta

OIDC tidak menentukan standar universal untuk role aplikasi. Banyak IdP memiliki struktur claims sendiri.

Contoh token Keycloak-style:

```json
{
  "realm_access": {
    "roles": ["offline_access", "uma_authorization", "agency-user"]
  },
  "resource_access": {
    "aceas-web": {
      "roles": ["case-officer", "appeal-approver"]
    }
  },
  "groups": [
    "/ACEAS/Case/Officer",
    "/ACEAS/Appeal/Approver"
  ]
}
```

Jangan langsung cek:

```java
if (jwt.getClaim("groups").contains("/ACEAS/Appeal/Approver")) {
    approve();
}
```

Lebih sehat:

```java
public final class OidcRoleMapper {

    private final RoleMappingRepository mappingRepository;

    public OidcRoleMapper(RoleMappingRepository mappingRepository) {
        this.mappingRepository = mappingRepository;
    }

    public Set<String> map(OidcIdentityFacts facts) {
        Set<String> roles = new HashSet<>();

        for (String group : facts.getGroups()) {
            roles.addAll(mappingRepository.findApplicationRoles(
                    facts.getIssuer(),
                    "GROUP",
                    group,
                    facts.getApplicationCode(),
                    facts.getTenantId()
            ));
        }

        for (String clientRole : facts.getClientRoles()) {
            roles.addAll(mappingRepository.findApplicationRoles(
                    facts.getIssuer(),
                    "CLIENT_ROLE",
                    clientRole,
                    facts.getApplicationCode(),
                    facts.getTenantId()
            ));
        }

        return roles;
    }
}
```

Representasi facts:

```java
public final class OidcIdentityFacts {
    private final String issuer;
    private final String subject;
    private final String applicationCode;
    private final String tenantId;
    private final Set<String> groups;
    private final Set<String> clientRoles;
    private final Set<String> scopes;

    public OidcIdentityFacts(
            String issuer,
            String subject,
            String applicationCode,
            String tenantId,
            Set<String> groups,
            Set<String> clientRoles,
            Set<String> scopes) {
        this.issuer = issuer;
        this.subject = subject;
        this.applicationCode = applicationCode;
        this.tenantId = tenantId;
        this.groups = groups;
        this.clientRoles = clientRoles;
        this.scopes = scopes;
    }

    public String getIssuer() { return issuer; }
    public String getSubject() { return subject; }
    public String getApplicationCode() { return applicationCode; }
    public String getTenantId() { return tenantId; }
    public Set<String> getGroups() { return groups; }
    public Set<String> getClientRoles() { return clientRoles; }
    public Set<String> getScopes() { return scopes; }
}
```

---

## 8. Mapping MicroProfile JWT `groups` ke `@RolesAllowed`

MicroProfile JWT banyak dipakai di Jakarta EE runtimes seperti Open Liberty, Payara, WildFly/Quarkus ecosystem, dan lain-lain untuk resource server style JWT authentication.

Dalam MicroProfile JWT 2.1, mapping antara `@RolesAllowed` dan claim `groups` dinyatakan: role names yang sudah dipetakan ke group names dalam JWT `groups` claim harus menghasilkan authorization allow ketika security constraint diterapkan.

Contoh JWT:

```json
{
  "iss": "https://idp.example.gov",
  "sub": "user-001",
  "aud": "aceas-api",
  "groups": ["CASE_OFFICER", "APPEAL_APPROVER"]
}
```

JAX-RS resource:

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/appeals")
public class AppealResource {

    @GET
    @RolesAllowed("APPEAL_APPROVER")
    public List<AppealDto> listPendingApprovals() {
        return List.of();
    }
}
```

Ini bekerja dengan baik jika `groups` claim memang sudah berisi **application roles**, bukan raw IdP group yang fragile.

Jadi untuk MicroProfile JWT, ada dua strategi:

### Strategi A — Token Already Contains Application Roles

```json
"groups": ["CASE_OFFICER", "APPEAL_APPROVER"]
```

Kelebihan:

- simpel,
- cocok dengan `@RolesAllowed`,
- container integration kuat.

Risiko:

- IdP harus tahu role aplikasi,
- role mapping pindah ke IdP,
- deployment antar app/tenant bisa kompleks,
- perubahan role butuh token refresh/reissue.

### Strategi B — Token Contains External Groups, App Maps Internally

```json
"groups": ["/ACEAS/Appeal/Approver"]
```

Application mapping:

```text
/ACEAS/Appeal/Approver -> APPEAL_APPROVER
```

Kelebihan:

- aplikasi punya kontrak role sendiri,
- lebih fleksibel,
- IdP migration lebih mudah.

Risiko:

- perlu custom integration,
- `@RolesAllowed` mungkin tidak langsung bekerja kecuali mapped roles didaftarkan sebagai container groups,
- butuh audit mapping.

---

## 9. Scope Bukan Role User

Misal access token:

```json
{
  "sub": "user-001",
  "aud": "case-api",
  "scope": "case.read case.write"
}
```

Developer sering membuat:

```java
@RolesAllowed("case.write")
public void updateCase(...) { ... }
```

Ini belum tentu salah untuk resource-server sederhana, tetapi berbahaya jika tanpa desain.

Scope adalah constraint token. Role adalah posisi caller dalam aplikasi. Permission adalah authorization final terhadap resource.

Pembedaan mental:

```text
Scope:
    Token ini boleh dipakai untuk request kategori apa?

Role:
    Caller ini berperan sebagai apa dalam aplikasi?

Permission:
    Caller ini boleh melakukan action ini terhadap resource ini sekarang?
```

Contoh yang benar:

```text
Token scope check:
    Does token allow API category case.write?

Application role check:
    Is caller CASE_OFFICER or CASE_SUPERVISOR?

Domain permission check:
    Is caller assigned to this case and is case state editable?
```

Kode:

```java
public void updateCase(Actor actor, TokenContext token, CaseRecord caseRecord, CaseUpdateCommand command) {
    if (!token.hasScope("case.write")) {
        throw new UnauthorizedTokenScopeException("Token does not have case.write scope");
    }

    if (!actor.hasAnyRole("CASE_OFFICER", "CASE_SUPERVISOR")) {
        throw new ForbiddenException("Caller role cannot update case");
    }

    AuthorizationDecision decision = caseAuthorization.canPerform(actor, CaseAction.UPDATE, caseRecord);
    if (!decision.isAllowed()) {
        throw new ForbiddenException(decision.getReasonCode());
    }

    caseService.update(caseRecord, command);
}
```

Untuk API machine-to-machine, scope bisa menjadi lebih dominan, tetapi tetap harus memperhatikan client identity, audience, issuer, tenant, dan resource ownership.

---

## 10. Audience dan Issuer Adalah Bagian dari Mapping

Mapping role tanpa issuer/audience adalah celah.

Jangan:

```text
if claim groups contains ADMIN -> SYSTEM_ADMIN
```

Karena token dari issuer lain bisa membawa `ADMIN`.

Lebih aman:

```text
if issuer == trusted-issuer-A
and audience == aceas-api
and group == /ACEAS/Admin/System
then role = SYSTEM_ADMIN
```

Mapping table harus menyimpan issuer:

```sql
CREATE TABLE role_mapping_rule (
    id                  BIGINT PRIMARY KEY,
    trusted_issuer      VARCHAR(500) NOT NULL,
    required_audience   VARCHAR(200),
    claim_name          VARCHAR(100) NOT NULL,
    claim_value         VARCHAR(500) NOT NULL,
    application_code    VARCHAR(100) NOT NULL,
    application_role    VARCHAR(100) NOT NULL,
    enabled             CHAR(1) NOT NULL,
    created_at          TIMESTAMP NOT NULL
);
```

Contoh:

```text
issuer=https://idp.gov/realms/agency
claim=groups
value=/ACEAS/Appeal/Approver
application=ACEAS
role=APPEAL_APPROVER
```

Jangan menerima role dari token tanpa:

- issuer validation,
- audience validation,
- signature validation,
- expiry validation,
- environment validation,
- client/application validation.

---

## 11. Role Namespace dan Naming Convention

Role harus memiliki namespace yang jelas.

### 11.1 Buruk

```text
ADMIN
USER
APPROVER
MAKER
CHECKER
VIEWER
```

Kenapa buruk?

- terlalu generic,
- bentrok antar module,
- tidak jelas domain,
- sulit audit,
- mudah over-grant.

### 11.2 Lebih Baik

```text
CASE_VIEWER
CASE_OFFICER
CASE_SUPERVISOR
CASE_APPROVER
APPEAL_REVIEWER
APPEAL_APPROVER
COMPLIANCE_INSPECTOR
COMPLIANCE_SUPERVISOR
REPORT_EXPORTER
TENANT_USER_ADMIN
SYSTEM_SECURITY_ADMIN
```

### 11.3 Untuk Multi-Application

Tambahkan app prefix jika role dibawa lintas sistem:

```text
ACEAS_CASE_OFFICER
ACEAS_APPEAL_APPROVER
CPDS_CASE_VIEWER
```

Tetapi di dalam aplikasi, bisa dinormalisasi:

```text
ACEAS_CASE_OFFICER -> CASE_OFFICER
```

### 11.4 Untuk Scope

Scope sebaiknya action/resource-oriented:

```text
case.read
case.write
case.approve
appeal.read
appeal.approve
report.export
```

Atau URI-style:

```text
api://aceas/case.read
api://aceas/case.write
```

### 11.5 Untuk Permission

Permission domain bisa lebih eksplisit:

```text
CASE:VIEW
CASE:UPDATE
CASE:ASSIGN
CASE:APPROVE
CASE:REOPEN
APPEAL:REVIEW
APPEAL:APPROVE
REPORT:EXPORT
USER_ROLE:ASSIGN
```

---

## 12. Hierarchical Role dan Composite Role

Enterprise sering ingin role hierarchy:

```text
CASE_SUPERVISOR includes CASE_OFFICER
SYSTEM_ADMIN includes TENANT_ADMIN
TENANT_ADMIN includes USER_ADMIN
```

Hati-hati: hierarchy sering menyebabkan privilege overreach.

### 12.1 Role Hierarchy yang Aman

Gunakan hierarchy untuk coarse convenience, bukan domain permission final.

```java
public final class RoleHierarchy {

    private final Map<String, Set<String>> impliedRoles = Map.of(
            "CASE_SUPERVISOR", Set.of("CASE_OFFICER", "CASE_VIEWER"),
            "CASE_OFFICER", Set.of("CASE_VIEWER")
    );

    public Set<String> expand(Set<String> roles) {
        Set<String> expanded = new HashSet<>(roles);
        boolean changed;

        do {
            changed = false;
            Set<String> toAdd = new HashSet<>();
            for (String role : expanded) {
                toAdd.addAll(impliedRoles.getOrDefault(role, Set.of()));
            }
            if (expanded.addAll(toAdd)) {
                changed = true;
            }
        } while (changed);

        return expanded;
    }
}
```

### 12.2 Risiko Composite Role

Misal:

```text
SYSTEM_ADMIN -> all roles
```

Ini nyaman, tapi berbahaya jika:

- system admin otomatis bisa approve business case,
- admin infra bisa bypass maker-checker,
- support user bisa melihat sensitive citizen data,
- emergency role tidak dibatasi audit/expiry.

Lebih baik:

```text
SYSTEM_ADMIN can manage configuration
SYSTEM_SECURITY_ADMIN can manage roles
BUSINESS_APPROVER can approve case
```

Admin teknis tidak otomatis menjadi business actor.

---

## 13. Temporary Role, Delegated Role, and Break-Glass Role

Tidak semua role bersifat permanen.

### 13.1 Temporary Role

Contoh:

```text
User A menjadi acting supervisor dari 2026-06-01 sampai 2026-06-14.
```

Mapping harus punya validity period:

```sql
CREATE TABLE user_role_assignment (
    user_id             VARCHAR(100) NOT NULL,
    tenant_id           VARCHAR(100) NOT NULL,
    role_code           VARCHAR(100) NOT NULL,
    effective_from      TIMESTAMP NOT NULL,
    effective_until     TIMESTAMP,
    assignment_reason   VARCHAR(500),
    assigned_by         VARCHAR(100) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, tenant_id, role_code, effective_from)
);
```

Policy:

```java
public boolean isRoleActive(UserRoleAssignment role, Instant now) {
    return !now.isBefore(role.getEffectiveFrom())
            && (role.getEffectiveUntil() == null || now.isBefore(role.getEffectiveUntil()));
}
```

### 13.2 Delegated Role

Delegation bukan sekadar memberi role yang sama.

Delegation harus punya:

- delegator,
- delegatee,
- scope,
- reason,
- time window,
- revocation,
- audit trail,
- conflict-of-interest check.

Contoh:

```text
Officer A delegates Appeal Review for tenant CEA to Officer B from 10 Jun to 14 Jun.
```

Decision input harus menyimpan on-behalf-of:

```java
public final class Actor {
    private final String userId;
    private final String tenantId;
    private final Set<String> roles;
    private final String actingOnBehalfOfUserId;

    // constructors/getters omitted
}
```

Audit:

```text
actor=user-B
onBehalfOf=user-A
action=APPEAL_REVIEW
resource=appeal-123
result=ALLOW
reason=ACTIVE_DELEGATION
```

### 13.3 Break-Glass Role

Break-glass role adalah emergency access.

Harus:

- time-limited,
- reason-required,
- strongly audited,
- alerting-enabled,
- reviewed after use,
- not silently equivalent to system admin.

Jangan:

```text
BREAK_GLASS -> all permissions forever
```

Lebih baik:

```text
BREAK_GLASS grants emergency read/support actions only, for 2 hours, with mandatory audit and supervisor review.
```

---

## 14. Environment-Specific Role Mapping

Satu kesalahan production yang sering terjadi:

```text
UAT group accidentally mapped to PROD role.
```

Contoh buruk:

```text
Group: ACEAS_ADMIN
```

Ada di DEV/UAT/PROD dengan nama sama, tetapi issuer berbeda atau realm berbeda.

Mapping harus membedakan:

```text
issuer=https://idp-dev.example.gov/realms/agency-dev
issuer=https://idp-uat.example.gov/realms/agency-uat
issuer=https://idp.example.gov/realms/agency-prod
```

Role mapping config harus punya environment guard:

```yaml
application: ACEAS
environment: PROD
trustedIssuers:
  - https://idp.example.gov/realms/agency-prod
forbiddenIssuers:
  - https://idp-dev.example.gov/realms/agency-dev
  - https://idp-uat.example.gov/realms/agency-uat
```

Runtime validation:

```java
public void validateIssuerAllowed(String issuer) {
    if (!trustedIssuers.contains(issuer)) {
        throw new InvalidTokenException("Untrusted issuer: " + issuer);
    }
}
```

---

## 15. Tenant-Specific Role Mapping

Role tanpa tenant boundary adalah celah besar.

Contoh user punya role:

```text
CASE_OFFICER
```

Pertanyaan:

- Untuk tenant apa?
- Untuk agency apa?
- Untuk branch apa?
- Untuk organization apa?

Role assignment sebaiknya scoped:

```text
user-001 has CASE_OFFICER in tenant CEA
user-001 has REPORT_VIEWER in tenant CPDS
```

Representasi actor:

```java
public final class ActorRole {
    private final String roleCode;
    private final String tenantId;

    public ActorRole(String roleCode, String tenantId) {
        this.roleCode = roleCode;
        this.tenantId = tenantId;
    }

    public String getRoleCode() { return roleCode; }
    public String getTenantId() { return tenantId; }
}
```

Check:

```java
public boolean hasRoleForTenant(Actor actor, String role, String tenantId) {
    return actor.getRoles().stream()
            .anyMatch(r -> r.getRoleCode().equals(role) && r.getTenantId().equals(tenantId));
}
```

Jangan hanya:

```java
actor.hasRole("CASE_OFFICER")
```

untuk operasi data tenant-specific.

---

## 16. Role Mapping untuk Multi-IdP

Enterprise app bisa menerima identity dari:

- internal employee IdP,
- external citizen IdP,
- business partner IdP,
- machine-to-machine client credentials,
- legacy SAML IdP,
- gateway-authenticated identity.

Satu `sub` dari issuer A tidak sama dengan `sub` dari issuer B.

Stable identity key harus:

```text
issuer + subject
```

Bukan hanya:

```text
subject
email
username
```

Contoh:

```java
public final class ExternalSubjectKey {
    private final String issuer;
    private final String subject;

    public ExternalSubjectKey(String issuer, String subject) {
        this.issuer = issuer;
        this.subject = subject;
    }

    public String asStableKey() {
        return issuer + "|" + subject;
    }
}
```

Account linking harus eksplisit:

```sql
CREATE TABLE linked_identity (
    local_user_id       VARCHAR(100) NOT NULL,
    issuer              VARCHAR(500) NOT NULL,
    subject             VARCHAR(500) NOT NULL,
    link_status         VARCHAR(50) NOT NULL,
    linked_at           TIMESTAMP NOT NULL,
    linked_by           VARCHAR(100),
    PRIMARY KEY (issuer, subject),
    UNIQUE (local_user_id, issuer)
);
```

Role mapping multi-IdP harus berbeda:

```text
Issuer A group /ACEAS/Officer -> CASE_OFFICER
Issuer B claim partner_role=agent -> EXTERNAL_AGENT
Issuer C client_id=batch-system -> SYSTEM_JOB_RUNNER
```

---

## 17. Mapping SAML Attributes ke Application Roles

SAML sering membawa attributes seperti:

```text
Attribute: urn:oid:2.5.4.10 = CEA
Attribute: Role = AppealApprover
Attribute: Department = Compliance
Attribute: Groups = CN=ACEAS Appeal Approver,OU=Groups,DC=example,DC=gov
```

Jangan langsung:

```text
Role=AppealApprover -> APPEAL_APPROVER
```

tanpa mengecek:

- issuer/entityID,
- audience/recipient,
- assertion validity,
- signature,
- attribute namespace,
- tenant/organization,
- environment,
- attribute source reliability.

Mapping sehat:

```text
SAML issuer entityID = https://idp.gov/saml
attribute name = Role
attribute value = AppealApprover
organization = CEA
application = ACEAS
    -> APPEAL_APPROVER scoped to tenant CEA
```

Karena SAML attribute names bisa berbeda antar IdP, mapping layer harus configurable dan auditable.

---

## 18. Role Mapping dengan Jakarta Authentication Callback

Jika menggunakan Jakarta Authentication/JASPIC custom module, module dapat menetapkan caller principal dan group principals melalui callback.

Pseudo-flow:

```text
ServerAuthModule.validateRequest()
    ↓
extract/validate token/header/cert
    ↓
map external identity facts to application roles
    ↓
CallerPrincipalCallback(subject, principalName)
GroupPrincipalCallback(subject, applicationRoles)
    ↓
container establishes authenticated caller
    ↓
@RolesAllowed / isUserInRole works
```

Contoh konseptual:

```java
import jakarta.security.auth.message.AuthException;
import jakarta.security.auth.message.AuthStatus;
import jakarta.security.auth.message.MessageInfo;
import jakarta.security.auth.message.callback.CallerPrincipalCallback;
import jakarta.security.auth.message.callback.GroupPrincipalCallback;
import jakarta.security.auth.message.module.ServerAuthModule;

import javax.security.auth.Subject;
import javax.security.auth.callback.Callback;
import javax.security.auth.callback.CallbackHandler;
import javax.security.auth.callback.UnsupportedCallbackException;
import java.io.IOException;
import java.util.Set;

public class BearerTokenServerAuthModule implements ServerAuthModule {

    private CallbackHandler handler;
    private TokenValidator tokenValidator;
    private RoleMapper roleMapper;

    @Override
    public AuthStatus validateRequest(
            MessageInfo messageInfo,
            Subject clientSubject,
            Subject serviceSubject) throws AuthException {

        HttpRequestData request = HttpRequestData.from(messageInfo);
        String token = request.getBearerToken();

        if (token == null) {
            return AuthStatus.SEND_CONTINUE;
        }

        TokenFacts facts = tokenValidator.validate(token);
        Set<String> applicationRoles = roleMapper.map(facts);

        Callback[] callbacks = new Callback[] {
                new CallerPrincipalCallback(clientSubject, facts.getStableSubject()),
                new GroupPrincipalCallback(clientSubject, applicationRoles.toArray(new String[0]))
        };

        try {
            handler.handle(callbacks);
            return AuthStatus.SUCCESS;
        } catch (IOException | UnsupportedCallbackException e) {
            throw new AuthException(e.getMessage());
        }
    }

    // other methods omitted
}
```

Catatan Java 8–25:

- `Subject` tetap dari Java SE JAAS package `javax.security.auth.Subject`.
- Jakarta Authentication package pindah ke `jakarta.security.auth.message.*` pada Jakarta namespace.
- Jangan campur dependency `javax.security.auth.message.*` lama dengan `jakarta.security.auth.message.*` baru tanpa sadar.

---

## 19. Mapping dengan Servlet Filter: Kapan Boleh, Kapan Bahaya

Kadang aplikasi memakai Servlet filter untuk membaca token dan membuat custom security context.

Contoh:

```java
public class TokenFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
        // validate token
        // put user in ThreadLocal
        // continue chain
    }
}
```

Ini bisa berguna untuk application-managed security, tetapi punya risiko besar:

- `request.getUserPrincipal()` tetap null,
- `request.isUserInRole()` tidak bekerja,
- `@RolesAllowed` tidak bekerja,
- JAX-RS container security tidak tahu identity,
- async/thread switch bisa kehilangan ThreadLocal,
- ThreadLocal leak bisa mencampur user antar request.

Jika ingin container-managed authorization, lebih baik identity diserahkan ke container via Jakarta Security/Jakarta Authentication/container-supported mechanism.

Servlet filter cocok untuk:

- logging enrichment,
- correlation id,
- pre-auth sanity check,
- gateway header validation sebelum container mechanism,
- additional domain context extraction.

Servlet filter tidak ideal sebagai satu-satunya security mechanism untuk app enterprise yang mengandalkan annotation/container authorization.

---

## 20. Role Mapping dan Session Freshness

Saat user login, role biasanya disimpan di security/session context.

Pertanyaan penting:

> Jika role user dicabut di IdP pukul 10:00, apakah aplikasi langsung tahu?

Jawaban tergantung desain:

| Model | Freshness | Performance | Risiko |
|---|---:|---:|---|
| Role stored in session until logout | rendah | tinggi | revoked role masih aktif |
| Role in short-lived token | sedang | tinggi | role aktif sampai token expire |
| Introspection every request | tinggi | rendah/sedang | IdP dependency tinggi |
| App role cache with TTL | sedang | tinggi | stale within TTL |
| Policy version check | tinggi/sedang | sedang | perlu versioning infra |

Desain yang baik menentukan role freshness berdasarkan risk.

Contoh policy:

```text
Low-risk read role:
    cached up to 15 minutes.

High-risk admin role:
    rechecked every request or every sensitive action.

Approval action:
    role + assignment + state checked live from DB.

Role management action:
    requires MFA and fresh authentication.
```

### 20.1 Role Version

Simpan role version:

```sql
CREATE TABLE user_security_version (
    user_id         VARCHAR(100) PRIMARY KEY,
    version         BIGINT NOT NULL,
    updated_at      TIMESTAMP NOT NULL
);
```

Session membawa version:

```text
session.userSecurityVersion = 42
```

Saat request sensitive:

```java
if (sessionVersion < currentVersionFromDb) {
    forceReauthenticationOrRefreshRoles();
}
```

---

## 21. Role Mapping dan Auditability

Mapping harus bisa dijelaskan setelah kejadian.

Audit yang buruk:

```text
user fajar approved appeal 123 because role APPEAL_APPROVER
```

Audit yang lebih baik:

```text
actorUserId=user-001
issuer=https://idp.gov/realms/agency
subject=user-001
externalGroup=/ACEAS/Appeal/Approver
mappedRole=APPEAL_APPROVER
mappingRuleId=rule-8812
tenant=CEA
action=APPEAL_APPROVE
resource=appeal-123
resourceState=PENDING_APPROVAL
decision=ALLOW
reason=ROLE_AND_ASSIGNMENT_MATCH
correlationId=req-abc
```

Audit role mapping perlu menyimpan:

- external input,
- mapping rule,
- mapped role,
- policy decision,
- actor,
- tenant,
- resource,
- result,
- reason.

Jangan audit token penuh karena bisa mengandung sensitive data. Simpan selected claims yang aman dan perlu.

---

## 22. Role Mapping as Code vs Role Mapping as Data

### 22.1 Mapping as Code

Contoh:

```java
if (groups.contains("/ACEAS/Appeal/Approver")) {
    roles.add("APPEAL_APPROVER");
}
```

Kelebihan:

- sederhana,
- mudah direview di code,
- cocok untuk aplikasi kecil/stabil.

Kekurangan:

- perubahan mapping butuh deploy,
- tidak cocok untuk multi-tenant,
- sulit di-admin,
- audit mapping rule kurang fleksibel.

### 22.2 Mapping as Data

Mapping di DB/config:

```yaml
mappings:
  - issuer: https://idp.gov/realms/agency
    externalType: GROUP
    externalValue: /ACEAS/Appeal/Approver
    appRole: APPEAL_APPROVER
    tenant: CEA
```

Kelebihan:

- fleksibel,
- bisa effective dated,
- bisa tenant-specific,
- bisa diaudit,
- bisa diubah tanpa redeploy.

Kekurangan:

- butuh governance,
- bisa salah konfigurasi,
- butuh testing config,
- butuh approval workflow.

### 22.3 Rekomendasi

Untuk enterprise/regulatory apps:

```text
Role constants as code.
Mapping rules as governed data/config.
Domain policy as code + data where needed.
```

Artinya:

- daftar role aplikasi didefinisikan jelas di code/documentation,
- mapping external-to-role bisa di DB/config,
- perubahan mapping harus audited dan approved,
- domain policy yang kompleks tetap explicit dan tested.

---

## 23. Anti-Pattern: Hardcoding IdP Group in Business Code

Buruk:

```java
if (currentUser.getGroups().contains("CN=ACEAS_APPROVER,OU=Groups,DC=gov")) {
    approve(caseId);
}
```

Masalah:

1. Business code coupling ke LDAP/IdP.
2. Rename group merusak authorization.
3. Migrasi IdP mahal.
4. Test sulit.
5. Audit tidak menunjukkan business role.
6. Tidak ada tenant scoping.
7. Tidak ada domain check.

Lebih baik:

```java
@RolesAllowed(AppRoles.APPEAL_APPROVER)
public void approveAppeal(String appealId) {
    Actor actor = actorResolver.currentActor();
    Appeal appeal = appealRepository.get(appealId);

    AuthorizationDecision decision = appealAuthorization.canApprove(actor, appeal);
    if (!decision.isAllowed()) {
        throw new ForbiddenException(decision.getReasonCode());
    }

    appealService.approve(actor, appeal);
}
```

Group mapping berada di satu tempat:

```java
public interface RoleMapper {
    Set<String> map(ExternalIdentityFacts facts);
}
```

---

## 24. Anti-Pattern: Role Explosion

Role explosion terjadi ketika setiap permission/context menjadi role.

Contoh:

```text
CASE_VIEW_CEA_PENDING_ASSIGNED
CASE_VIEW_CEA_PENDING_UNASSIGNED
CASE_VIEW_CEA_APPROVED_ASSIGNED
CASE_APPROVE_CEA_PENDING_ASSIGNED
CASE_APPROVE_CEA_PENDING_SUPERVISOR
CASE_APPROVE_CEA_ESCALATED_SUPERVISOR
...
```

Ini membuat role tidak dapat dikelola.

Pemisahan yang lebih baik:

```text
Role:
    CASE_OFFICER
    CASE_SUPERVISOR

Context:
    tenant = CEA
    state = PENDING_APPROVAL
    assignment = user-001

Permission decision:
    canApprove(actor, case)
```

Role sebaiknya menjawab “kapasitas umum”, bukan semua kombinasi kondisi domain.

---

## 25. Anti-Pattern: Scope Explosion

Mirip role explosion, tapi di OAuth scopes.

Buruk:

```text
case.read.cea.pending.assigned
case.read.cea.pending.unassigned
case.approve.cea.pending.supervisor
case.approve.cea.escalated.supervisor
```

Scope terlalu domain-specific akan membuat token dan consent model tidak stabil.

Lebih baik:

```text
case.read
case.write
case.approve
```

Lalu domain authorization tetap di aplikasi.

Scope bagus untuk membatasi **token/client capability**, bukan menggantikan policy engine domain.

---

## 26. Anti-Pattern: Admin Means Everything

```java
if (actor.hasRole("ADMIN")) {
    return true;
}
```

Ini salah satu sumber bypass paling umum.

Pertanyaan:

- admin apa?
- admin tenant?
- admin security?
- admin technical support?
- admin business?
- admin boleh melihat sensitive data?
- admin boleh approve case?
- admin boleh assign dirinya sendiri lalu approve?

Lebih aman:

```text
TENANT_USER_ADMIN:
    manage users and role assignments in tenant

SYSTEM_CONFIG_ADMIN:
    manage system configuration

SECURITY_AUDITOR:
    view security audit logs

BUSINESS_APPROVER:
    approve business case, subject to maker-checker

BREAK_GLASS_SUPPORT:
    emergency support, time-limited, audited
```

Jangan buat satu role `ADMIN` untuk semuanya.

---

## 27. Anti-Pattern: UI Role Check Only

Buruk:

```javascript
if (user.roles.includes('APPEAL_APPROVER')) {
  showApproveButton();
}
```

Lalu backend endpoint tidak mengecek ulang.

UI role check hanya untuk UX.

Backend tetap wajib enforce:

```java
@POST
@Path("/{id}/approve")
@RolesAllowed(AppRoles.APPEAL_APPROVER)
public Response approve(@PathParam("id") String id) {
    Actor actor = actorResolver.currentActor();
    Appeal appeal = appealRepository.get(id);
    authorization.requireCanApprove(actor, appeal);
    appealService.approve(actor, appeal);
    return Response.noContent().build();
}
```

---

## 28. Anti-Pattern: Trusting Client-Sent Roles

Buruk:

```http
POST /api/case/approve
X-User: fajar
X-Roles: APPEAL_APPROVER
```

Kalau header itu datang dari browser/public client, fatal.

Trusted identity headers hanya boleh diterima jika:

- datang dari trusted gateway,
- gateway sudah authenticate caller,
- jalur network/internal protected,
- app menolak direct access bypassing gateway,
- header disanitasi/di-overwrite gateway,
- ada mTLS atau network policy,
- app memvalidasi source.

Lebih baik menggunakan token signed atau container-authenticated principal.

---

## 29. Role Mapping untuk App Switcher / SSO Multi-App

Dalam SSO multi-application, user login sekali lalu pindah app.

Kesalahan umum:

```text
ACEAS role reused directly in CPDS.
```

Padahal role `CASE_OFFICER` di ACEAS bisa berbeda makna dari role `CASE_OFFICER` di CPDS.

Mapping sehat:

```text
External IdP group:
    /Gov/CEA/CaseOfficer

ACEAS mapping:
    -> ACEAS_CASE_OFFICER

CPDS mapping:
    -> CPDS_VIEWER or no role
```

App-specific role contract harus terpisah.

SSO menyelesaikan authentication, bukan otomatis menyelesaikan authorization antar aplikasi.

---

## 30. Designing a Stable Role Contract

Role contract harus menjawab:

1. Nama role.
2. Deskripsi business meaning.
3. Scope tenant/module.
4. Siapa yang boleh diberi role.
5. Siapa yang boleh memberi role.
6. Apakah role bisa didelegasikan.
7. Apakah role butuh MFA.
8. Apakah role time-limited.
9. Apakah role bisa digunakan untuk sensitive action.
10. Permission/domain action apa yang bisa dimulai dari role ini.
11. Domain checks tambahan apa yang tetap wajib.
12. Audit requirement.

Contoh dokumentasi role:

```text
Role: APPEAL_APPROVER

Meaning:
    User can perform approval action on appeal records within assigned tenant,
    subject to workflow state, assignment rules, and maker-checker restrictions.

External Mapping:
    IdP group /ACEAS/Appeal/Approver maps to this role for tenant CEA.

Allowed Coarse Actions:
    - Access appeal approval queue
    - Open appeal approval screen
    - Submit approve/reject decision

Mandatory Domain Checks:
    - Appeal belongs to user's active tenant
    - Appeal state is PENDING_APPROVAL
    - User is not the original maker/reviewer if segregation-of-duties applies
    - User has active assignment or supervisor override

Sensitive Requirements:
    - Fresh login within 60 minutes
    - MFA required for approval above risk threshold

Audit:
    - actor, tenant, appeal id, previous state, new state, decision, reason, mapping rule
```

---

## 31. Implementation Pattern: Role Mapper

### 31.1 Interface

```java
public interface ExternalRoleMapper {
    Set<String> mapToApplicationRoles(ExternalIdentityFacts facts);
}
```

### 31.2 Facts

```java
public final class ExternalIdentityFacts {
    private final String issuer;
    private final String subject;
    private final String audience;
    private final String tenantId;
    private final Map<String, Object> claims;
    private final Set<String> groups;
    private final Set<String> scopes;

    public ExternalIdentityFacts(
            String issuer,
            String subject,
            String audience,
            String tenantId,
            Map<String, Object> claims,
            Set<String> groups,
            Set<String> scopes) {
        this.issuer = issuer;
        this.subject = subject;
        this.audience = audience;
        this.tenantId = tenantId;
        this.claims = claims;
        this.groups = groups;
        this.scopes = scopes;
    }

    public String getIssuer() { return issuer; }
    public String getSubject() { return subject; }
    public String getAudience() { return audience; }
    public String getTenantId() { return tenantId; }
    public Map<String, Object> getClaims() { return claims; }
    public Set<String> getGroups() { return groups; }
    public Set<String> getScopes() { return scopes; }
}
```

### 31.3 Rule

```java
public final class RoleMappingRule {
    private final String issuer;
    private final String audience;
    private final String externalType;
    private final String externalValue;
    private final String applicationCode;
    private final String applicationRole;
    private final String tenantId;
    private final boolean enabled;

    public RoleMappingRule(
            String issuer,
            String audience,
            String externalType,
            String externalValue,
            String applicationCode,
            String applicationRole,
            String tenantId,
            boolean enabled) {
        this.issuer = issuer;
        this.audience = audience;
        this.externalType = externalType;
        this.externalValue = externalValue;
        this.applicationCode = applicationCode;
        this.applicationRole = applicationRole;
        this.tenantId = tenantId;
        this.enabled = enabled;
    }

    public boolean matches(ExternalIdentityFacts facts, String externalType, String externalValue) {
        if (!enabled) return false;
        if (!issuer.equals(facts.getIssuer())) return false;
        if (audience != null && !audience.equals(facts.getAudience())) return false;
        if (tenantId != null && !tenantId.equals(facts.getTenantId())) return false;
        if (!this.externalType.equals(externalType)) return false;
        return this.externalValue.equals(externalValue);
    }

    public String getApplicationRole() {
        return applicationRole;
    }
}
```

### 31.4 Mapper

```java
public final class RuleBasedExternalRoleMapper implements ExternalRoleMapper {

    private final RoleMappingRuleRepository repository;
    private final RoleHierarchy roleHierarchy;

    public RuleBasedExternalRoleMapper(
            RoleMappingRuleRepository repository,
            RoleHierarchy roleHierarchy) {
        this.repository = repository;
        this.roleHierarchy = roleHierarchy;
    }

    @Override
    public Set<String> mapToApplicationRoles(ExternalIdentityFacts facts) {
        List<RoleMappingRule> rules = repository.findEnabledRulesForIssuer(facts.getIssuer());
        Set<String> roles = new HashSet<>();

        for (String group : facts.getGroups()) {
            for (RoleMappingRule rule : rules) {
                if (rule.matches(facts, "GROUP", group)) {
                    roles.add(rule.getApplicationRole());
                }
            }
        }

        for (String scope : facts.getScopes()) {
            for (RoleMappingRule rule : rules) {
                if (rule.matches(facts, "SCOPE", scope)) {
                    roles.add(rule.getApplicationRole());
                }
            }
        }

        // Optional: role hierarchy expansion.
        return roleHierarchy.expand(roles);
    }
}
```

Important: mapping from scope to role should be used carefully. In many systems, scopes should remain token capability, not user role.

---

## 32. Implementation Pattern: Actor Resolver

Jangan sebarkan `SecurityContext` ke domain service. Buat `Actor` domain object.

```java
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.security.enterprise.SecurityContext;

import java.security.Principal;
import java.util.Set;

@RequestScoped
public class ActorResolver {

    @Inject
    SecurityContext securityContext;

    @Inject
    UserProfileRepository userProfileRepository;

    public Actor currentActor() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            throw new UnauthenticatedException("No authenticated caller");
        }

        String userId = principal.getName();
        UserProfile profile = userProfileRepository.getByUserId(userId);

        Set<String> roles = profile.getCurrentApplicationRoles();
        String activeTenantId = profile.getActiveTenantId();

        return new Actor(userId, activeTenantId, roles);
    }
}
```

Actor:

```java
public final class Actor {
    private final String userId;
    private final String activeTenantId;
    private final Set<String> roles;

    public Actor(String userId, String activeTenantId, Set<String> roles) {
        this.userId = userId;
        this.activeTenantId = activeTenantId;
        this.roles = roles;
    }

    public boolean hasRole(String role) {
        return roles.contains(role);
    }

    public boolean hasAnyRole(String... expectedRoles) {
        for (String role : expectedRoles) {
            if (roles.contains(role)) return true;
        }
        return false;
    }

    public String getUserId() { return userId; }
    public String getActiveTenantId() { return activeTenantId; }
    public Set<String> getRoles() { return roles; }
}
```

Domain policy memakai `Actor`, bukan langsung token/JWT/LDAP group.

---

## 33. Implementation Pattern: Permission Matrix

Role-to-permission matrix berguna untuk coarse permission.

```text
Role                case:view   case:update   case:approve   user:manage
CASE_VIEWER         yes         no            no             no
CASE_OFFICER        yes         yes           no             no
CASE_SUPERVISOR     yes         yes           yes            no
TENANT_ADMIN        yes         no            no             yes
```

Kode:

```java
public final class PermissionMatrix {

    private final Map<String, Set<String>> permissionsByRole = Map.of(
            "CASE_VIEWER", Set.of("case:view"),
            "CASE_OFFICER", Set.of("case:view", "case:update"),
            "CASE_SUPERVISOR", Set.of("case:view", "case:update", "case:approve"),
            "TENANT_ADMIN", Set.of("user:manage")
    );

    public boolean roleHasPermission(String role, String permission) {
        return permissionsByRole.getOrDefault(role, Set.of()).contains(permission);
    }

    public boolean actorHasPermission(Actor actor, String permission) {
        return actor.getRoles().stream().anyMatch(role -> roleHasPermission(role, permission));
    }
}
```

Tapi jangan berhenti di matrix untuk domain-sensitive actions.

```java
public AuthorizationDecision canApprove(Actor actor, CaseRecord caseRecord) {
    if (!permissionMatrix.actorHasPermission(actor, "case:approve")) {
        return AuthorizationDecision.deny("MISSING_PERMISSION", "Actor lacks case:approve");
    }

    if (!actor.getActiveTenantId().equals(caseRecord.getTenantId())) {
        return AuthorizationDecision.deny("TENANT_MISMATCH", "Case belongs to different tenant");
    }

    if (!caseRecord.isPendingApproval()) {
        return AuthorizationDecision.deny("INVALID_STATE", "Case is not pending approval");
    }

    if (caseRecord.getCreatedBy().equals(actor.getUserId())) {
        return AuthorizationDecision.deny("SEGREGATION_OF_DUTIES", "Creator cannot approve own case");
    }

    return AuthorizationDecision.allow("ROLE_PERMISSION_AND_DOMAIN_RULE_MATCH");
}
```

---

## 34. Testing Role Mapping

Role mapping harus dites seperti business logic.

### 34.1 Unit Test Cases

```text
Given issuer A and group X, maps to CASE_OFFICER.
Given issuer B and same group X, does not map unless explicitly configured.
Given disabled rule, does not map.
Given tenant mismatch, does not map tenant-scoped role.
Given expired temporary role, does not map.
Given unknown group, maps no role.
Given duplicate group values, output roles are deduplicated.
Given role hierarchy, implied roles are included.
```

Example JUnit-style:

```java
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RoleMapperTest {

    @Test
    void mapsTrustedIssuerGroupToApplicationRole() {
        ExternalIdentityFacts facts = new ExternalIdentityFacts(
                "https://idp.gov/realms/prod",
                "user-001",
                "aceas-api",
                "CEA",
                Map.of(),
                Set.of("/ACEAS/Case/Officer"),
                Set.of()
        );

        ExternalRoleMapper mapper = TestMappers.defaultMapper();

        Set<String> roles = mapper.mapToApplicationRoles(facts);

        assertTrue(roles.contains("CASE_OFFICER"));
    }

    @Test
    void doesNotMapSameGroupFromUntrustedIssuer() {
        ExternalIdentityFacts facts = new ExternalIdentityFacts(
                "https://idp-dev.gov/realms/dev",
                "user-001",
                "aceas-api",
                "CEA",
                Map.of(),
                Set.of("/ACEAS/Case/Officer"),
                Set.of()
        );

        ExternalRoleMapper mapper = TestMappers.prodOnlyMapper();

        Set<String> roles = mapper.mapToApplicationRoles(facts);

        assertFalse(roles.contains("CASE_OFFICER"));
    }
}
```

### 34.2 Integration Test Cases

```text
Token with groups claim can access @RolesAllowed endpoint after mapping.
Token without mapped group receives 403.
Token with wrong audience receives 401.
Token with wrong issuer receives 401.
Expired token receives 401.
Mapped role passes coarse check but domain rule can still deny.
```

### 34.3 Security Regression Tests

Every high-risk role needs tests:

```text
SYSTEM_SECURITY_ADMIN cannot approve business case unless also BUSINESS_APPROVER and domain rules pass.
TENANT_ADMIN for tenant A cannot manage tenant B.
APPEAL_APPROVER cannot approve self-created appeal.
Disabled user cannot receive roles even if token has group.
Removed role stops working after refresh/version check.
```

---

## 35. Observability and Troubleshooting

When authorization fails, developers often ask:

```text
Why does @RolesAllowed deny this user?
```

You need diagnostics without leaking sensitive data.

### 35.1 Log Safe Facts

Log:

```text
correlationId
issuer hash or allowlisted issuer id
subject hash/stable internal user id
application
role mapping rule ids
mapped roles
requested role
resource/action
result
reason code
```

Do not log:

```text
full access token
full ID token
password
refresh token
private claims containing PII
full SAML assertion
```

### 35.2 Debug Endpoint for Admin

For controlled admin-only environments, a diagnostic endpoint can show:

```json
{
  "userId": "user-001",
  "issuer": "prod-idp",
  "mappedRoles": ["CASE_OFFICER", "APPEAL_APPROVER"],
  "activeTenant": "CEA",
  "mappingRules": ["rule-8812", "rule-9921"],
  "roleVersion": 42
}
```

Protect this endpoint strongly. It is security-sensitive.

---

## 36. Failure Model

### Failure 1 — Raw Group Coupling

```text
IdP renames group /ACEAS/Appeal/Approver to /ACEAS/Appeal/ApprovalOfficer.
Application hardcoded old group.
Users lose access or wrong fallback grants access.
```

Mitigation:

- mapping layer,
- group ID where possible,
- mapping tests,
- config validation.

### Failure 2 — Dev Issuer Accepted in Prod

```text
Prod app accepts token from dev IdP because signature key was shared or issuer not checked.
Dev admin grants self ADMIN group.
Prod app maps ADMIN to SYSTEM_ADMIN.
```

Mitigation:

- strict issuer allowlist,
- strict audience check,
- environment-separated keys/realms,
- mapping includes issuer.

### Failure 3 — Role Revoked but Session Still Active

```text
User role removed at 10:00.
Existing session valid until 18:00.
User continues approving.
```

Mitigation:

- shorter session/token lifetime for high-risk roles,
- role version check,
- sensitive action revalidation,
- back-channel logout/event integration.

### Failure 4 — Scope Treated as Business Permission

```text
Token has case.write.
App allows approve because approve is write.
User not assigned to case.
```

Mitigation:

- separate scope check from domain authorization,
- explicit action permission,
- state/assignment checks.

### Failure 5 — Admin Overreach

```text
Technical admin role bypasses all authorization.
Support user approves business case.
```

Mitigation:

- split admin roles,
- no universal admin bypass,
- break-glass with audit/expiry,
- maker-checker cannot be bypassed casually.

### Failure 6 — Multi-Tenant Role Leak

```text
User has CASE_OFFICER for tenant A.
API only checks CASE_OFFICER.
User updates tenant B case.
```

Mitigation:

- tenant-scoped roles,
- tenant check in every domain decision,
- database query scoped by tenant,
- tests for tenant isolation.

### Failure 7 — Role Explosion

```text
Hundreds of roles created for every workflow condition.
Nobody understands which role grants what.
Audit becomes meaningless.
```

Mitigation:

- keep roles coarse,
- model conditions in domain policy,
- permission matrix + domain checks.

### Failure 8 — Claim Name Collision

```text
Two IdPs use claim role, but semantics differ.
App maps both to same role.
```

Mitigation:

- issuer-specific claim mapping,
- claim namespace validation,
- integration contract per IdP.

---

## 37. Practical Checklist

### 37.1 Mapping Design Checklist

```text
[ ] Are external groups/claims separated from application roles?
[ ] Does mapping include issuer?
[ ] Does mapping include audience/client/application?
[ ] Does mapping support tenant scoping?
[ ] Are role names domain-specific, not generic ADMIN/USER?
[ ] Are scopes treated as token grants, not automatically user roles?
[ ] Are high-risk roles time-limited or freshly checked?
[ ] Are role changes propagated or version-checked?
[ ] Are mapping rules audited?
[ ] Are mapping rules tested?
[ ] Are unknown groups denied by default?
[ ] Are admin roles split by responsibility?
[ ] Is domain authorization separate from coarse role check?
```

### 37.2 Code Review Checklist

```text
[ ] No raw IdP group string in business service.
[ ] No direct trust of client-sent roles.
[ ] No universal if ADMIN then allow everything.
[ ] No scope-only approval of domain-sensitive action.
[ ] No tenant-blind role check for tenant data.
[ ] No UI-only authorization.
[ ] No token claim used without issuer/audience validation.
[ ] No full token/assertion logged.
[ ] SecurityContext not leaked into domain model unnecessarily.
[ ] Domain decision returns auditable reason.
```

### 37.3 Production Readiness Checklist

```text
[ ] Role mapping config is environment-specific.
[ ] Role mapping has approval workflow.
[ ] Role mapping changes are audited.
[ ] Role cache TTL is risk-appropriate.
[ ] High-risk operations recheck authorization live.
[ ] Role removal procedure is documented.
[ ] Emergency access is time-limited and audited.
[ ] Admin diagnostic endpoint is protected.
[ ] Negative tests exist for role/tenant bypass.
[ ] Runbook exists for "user cannot access" and "user has too much access" incidents.
```

---

## 38. Reference Architecture

```text
+-------------------+
| Browser / Client  |
+---------+---------+
          |
          | OIDC login / bearer token
          v
+-------------------+
| Gateway / ALB /   |
| Reverse Proxy     |
+---------+---------+
          |
          v
+-------------------------------+
| Jakarta Application            |
|                               |
|  Authentication Mechanism      |
|    - validate token/session    |
|    - extract facts             |
|                               |
|  Role Mapping Layer            |
|    - issuer + claim/group      |
|    - app role normalization    |
|    - tenant scoping            |
|                               |
|  Container Security Context    |
|    - principal                 |
|    - application roles/groups  |
|                               |
|  Coarse Authorization          |
|    - @RolesAllowed             |
|    - isCallerInRole            |
|                               |
|  Domain Authorization          |
|    - action/resource/tenant    |
|    - state/assignment/SOD      |
|                               |
|  Audit                         |
|    - mapping rule              |
|    - decision reason           |
+-------------------------------+
```

Key invariant:

```text
External identity facts must not directly become business authorization without validation, normalization, mapping, and domain decision.
```

---

## 39. Java 8–25 Considerations

### 39.1 Namespace

Java EE 8 style:

```java
import javax.annotation.security.RolesAllowed;
```

Jakarta EE 9+ style:

```java
import jakarta.annotation.security.RolesAllowed;
```

JAAS `Subject` remains:

```java
import javax.security.auth.Subject;
```

Jakarta Authentication moved to:

```java
import jakarta.security.auth.message.*;
```

Jakarta Security:

```java
import jakarta.security.enterprise.SecurityContext;
```

### 39.2 Java 8

- No records.
- Use final classes for value objects.
- Be careful with older container versions.
- Java EE 8 often still uses `javax.*` APIs.

### 39.3 Java 11/17

- Common baseline for enterprise apps.
- Jakarta EE 9/10 often seen here depending container.
- Stronger TLS/default crypto ecosystem than Java 8.

### 39.4 Java 21+

- Virtual threads can affect assumptions around ThreadLocal context propagation.
- Do not assume security context is safely available in arbitrary async task.
- Prefer container-managed context propagation where supported.

### 39.5 Java 25

- Treat as modern JDK target where framework/container support must be verified.
- Security API semantics still come from Jakarta specs and runtime implementation.
- Always check container compatibility matrix.

---

## 40. Common Design Decision Matrix

| Situation | Recommended Mapping Strategy |
|---|---|
| Small internal app, one IdP, stable roles | Token/group can map directly to app roles, but document it |
| Enterprise app, multiple modules | External group → app role mapping layer |
| Multi-tenant app | Tenant-scoped role assignment + domain tenant check |
| API resource server | Validate token scopes + map user/client identity separately |
| Workflow/case management | Role only coarse; final decision via domain policy |
| Regulatory/auditable app | Mapping as governed data + audit mapping rule ID |
| Multiple IdPs | issuer+subject identity key; issuer-specific mapping |
| Technical admin vs business approver | Split roles; never universal admin bypass |
| Temporary delegation | Delegation record, time window, on-behalf-of audit |
| High-risk action | Fresh auth/MFA + live authorization check |

---

## 41. Mini Case Study: Appeal Approval

### Requirement

A user may approve an appeal only if:

1. user is authenticated,
2. user has `APPEAL_APPROVER` role for the same tenant,
3. appeal is in `PENDING_APPROVAL`,
4. user was not the maker/reviewer,
5. user is assigned or has supervisor override,
6. token/session is fresh enough,
7. action is audited.

### External Facts

```json
{
  "iss": "https://idp.gov/realms/prod",
  "sub": "user-001",
  "aud": "aceas-web",
  "groups": ["/ACEAS/Appeal/Approver"],
  "tenant_id": "CEA",
  "auth_time": 1759996400
}
```

### Mapping

```text
issuer=https://idp.gov/realms/prod
group=/ACEAS/Appeal/Approver
tenant=CEA
    -> APPEAL_APPROVER
```

### Coarse Check

```java
@RolesAllowed(AppRoles.APPEAL_APPROVER)
public void approveAppeal(String appealId) { ... }
```

### Domain Check

```java
public AuthorizationDecision canApprove(Actor actor, Appeal appeal, AuthSession session) {
    if (!actor.hasRole("APPEAL_APPROVER")) {
        return AuthorizationDecision.deny("MISSING_ROLE", "Actor is not appeal approver");
    }

    if (!actor.getActiveTenantId().equals(appeal.getTenantId())) {
        return AuthorizationDecision.deny("TENANT_MISMATCH", "Appeal belongs to another tenant");
    }

    if (!appeal.isPendingApproval()) {
        return AuthorizationDecision.deny("INVALID_STATE", "Appeal is not pending approval");
    }

    if (appeal.getMakerUserId().equals(actor.getUserId())) {
        return AuthorizationDecision.deny("MAKER_CANNOT_APPROVE", "Maker cannot approve own appeal");
    }

    if (!appeal.isAssignedTo(actor.getUserId()) && !actor.hasRole("APPEAL_SUPERVISOR")) {
        return AuthorizationDecision.deny("NOT_ASSIGNED", "Actor is not assigned to appeal");
    }

    if (!session.isFreshForSensitiveAction()) {
        return AuthorizationDecision.deny("AUTH_NOT_FRESH", "Fresh authentication required");
    }

    return AuthorizationDecision.allow("APPEAL_APPROVAL_POLICY_MATCH");
}
```

### Audit

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "actor": "user-001",
  "issuer": "https://idp.gov/realms/prod",
  "externalGroup": "/ACEAS/Appeal/Approver",
  "mappedRole": "APPEAL_APPROVER",
  "tenant": "CEA",
  "action": "APPEAL_APPROVE",
  "resourceId": "appeal-123",
  "decision": "ALLOW",
  "reason": "APPEAL_APPROVAL_POLICY_MATCH"
}
```

---

## 42. Deep Principle: Authorization Language Must Be Owned by the Application

Identity provider owns identity facts.

OAuth/OIDC owns protocol semantics.

Container owns caller/role enforcement surface.

Framework owns its internal representation.

But the application must own business authorization vocabulary.

Jika aplikasi tidak punya vocabulary sendiri, maka business security-nya akan dikendalikan oleh:

- nama LDAP group,
- bentuk JWT claim,
- convention framework,
- konfigurasi IdP,
- atau kebiasaan developer.

Itu rapuh.

Aplikasi enterprise yang baik memiliki:

```text
Stable application roles
Explicit mapping rules
Domain permission model
Tenant/resource/state-aware policy
Auditable authorization decisions
```

---

## 43. Ringkasan

Pada bagian ini kita membedah perbedaan dan mapping antara:

- **group**: fakta membership dari IdP/directory,
- **role**: abstraction aplikasi/container,
- **claim**: statement dari token/assertion,
- **scope**: grant/batas akses OAuth token,
- **authority**: istilah framework-specific,
- **permission**: izin aksi terhadap resource/domain object.

Kesimpulan utama:

1. Jangan hardcode group IdP di business code.
2. Jangan menyamakan scope dengan business permission final.
3. Jangan membuat `ADMIN` universal.
4. Jangan melakukan authorization hanya di UI.
5. Jangan menerima role dari client-sent header kecuali lewat trusted boundary yang ketat.
6. Mapping harus issuer-aware, audience-aware, application-aware, dan tenant-aware.
7. Role aplikasi harus stabil dan terdokumentasi.
8. Permission domain harus mengecek subject, action, resource, tenant, state, relationship.
9. Role mapping harus diuji dan diaudit.
10. Authentication/SSO tidak otomatis menyelesaikan authorization.

Mental model final:

```text
External group/claim/scope is input.
Application role is normalized contract.
Domain permission is final decision.
Audit explains why the decision happened.
```

---

## 44. Apa Selanjutnya

Bagian berikutnya:

```text
Part 15 — Session Security: Login State, HttpSession, Cookies, Logout
```

Kita akan masuk ke bagaimana identity yang sudah di-authenticate dan role yang sudah dipetakan dipertahankan dalam state runtime:

- `HttpSession`,
- security session,
- cookies,
- session fixation,
- idle timeout vs absolute timeout,
- concurrent session,
- remember-me,
- logout local/global,
- front-channel/back-channel logout,
- stale role/session problem,
- clustered session,
- principal serialization,
- dan failure model session security di aplikasi enterprise Jakarta.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 13 — Programmatic Authorization and Domain Permission Design](./learn-java-jakarta-security-authentication-authorization-identity-part-13-programmatic-authorization-domain-permissions.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java Jakarta Security Authentication Authorization Identity](./learn-java-jakarta-security-authentication-authorization-identity-part-15-session-security-login-cookies-logout.md)

</div>