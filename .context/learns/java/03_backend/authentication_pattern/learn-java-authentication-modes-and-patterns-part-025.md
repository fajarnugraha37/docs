# learn-java-authentication-modes-and-patterns-part-025

# Part 25 — Identity Provider Integration Patterns

> Seri: **Java Authentication Modes and Patterns**  
> Target: Java 8 sampai Java 25  
> Level: Advanced / architecture-grade / production-grade  
> Fokus: bagaimana aplikasi Java berintegrasi dengan Identity Provider sebagai boundary kepercayaan, bukan sekadar “login via Google/Keycloak/Entra/Okta”.

---

## 0. Posisi Part Ini dalam Series

Sampai Part 24, kita sudah membahas fondasi authentication dari bawah ke atas:

- Java runtime identity: `Subject`, `Principal`, credential, JAAS.
- Authentication taxonomy: proof, assertion, session, token, trust model.
- Password, session, Servlet container, Jakarta Security, Spring Security.
- Context propagation di Servlet, async, reactive, virtual thread.
- API key, HMAC, JWT, opaque token, OAuth2, OIDC, PKCE.
- Machine-to-machine auth, SAML, LDAP/AD/Kerberos, mTLS.
- Passkeys/WebAuthn, MFA/step-up.
- Non-browser clients.
- Token lifecycle.
- Key management.

Sekarang kita masuk ke lapisan yang sering menjadi realita enterprise: **aplikasi Java jarang menjadi identity authority utama**. Biasanya aplikasi Java berintegrasi dengan satu atau lebih Identity Provider seperti:

- Keycloak.
- Microsoft Entra ID.
- Okta.
- Auth0.
- Ping Identity.
- ForgeRock/Ping AM.
- Google Workspace.
- AWS Cognito.
- Enterprise LDAP/AD melalui federation.
- Government national digital identity provider.
- Custom agency IdP.
- Internal centralized SSO platform.

Part ini membahas pola integrasinya.

Bukan target utama part ini:

- Menjelaskan ulang OAuth2/OIDC flow secara detail.
- Menjelaskan ulang JWT validation.
- Menjelaskan ulang Spring Security configuration dasar.
- Menjelaskan ulang Keycloak admin UI step-by-step.

Target utama part ini:

- Membentuk mental model integrasi IdP.
- Membedakan IdP sebagai identity source, authentication authority, token issuer, policy decision point, dan broker.
- Mendesain mapping identity yang stabil.
- Mendesain claim normalization.
- Mendesain linking account yang aman.
- Mendesain role/group mapping yang defensible.
- Mendesain first-login flow.
- Mendesain attribute synchronization.
- Mendesain IdP outage behavior.
- Mendesain migration antar IdP.
- Menghindari kesalahan integrasi yang sulit dibetulkan setelah production.

---

## 1. Problem yang Diselesaikan

Pertanyaan permukaannya biasanya:

> “Bagaimana Java app login pakai IdP X?”

Tetapi pertanyaan engineering yang sebenarnya jauh lebih dalam:

> “Bagaimana aplikasi Java mempercayai identitas dari sistem eksternal, mengikat identitas itu ke user internal, memetakan hak akses, mempertahankan session/token lifecycle, menjaga auditability, dan tetap aman ketika provider berubah, claim berubah, user pindah organisasi, IdP down, atau token direplay?”

Identity Provider integration menyelesaikan beberapa masalah:

1. **Centralized authentication**  
   Aplikasi tidak perlu menyimpan password sendiri.

2. **Single Sign-On**  
   User login sekali di IdP lalu mengakses banyak aplikasi.

3. **Federated identity**  
   Identitas user berasal dari domain/organisasi eksternal.

4. **Credential lifecycle externalization**  
   Password policy, MFA, account lock, recovery, device trust, risk scoring dipindahkan ke IdP.

5. **Protocol standardization**  
   Aplikasi Java memakai OIDC, OAuth2, SAML, LDAP, Kerberos, atau mTLS.

6. **Enterprise governance**  
   Joiner/mover/leaver, deprovisioning, group membership, conditional access, audit login dikelola terpusat.

7. **Multi-application consistency**  
   Banyak aplikasi memakai identity fabric yang sama.

Namun integrasi IdP juga memperkenalkan risiko baru:

1. Aplikasi terlalu percaya claim yang tidak stabil.
2. User internal salah terhubung ke external identity.
3. Role mapping terlalu longgar.
4. Email dipakai sebagai primary key padahal bisa berubah.
5. Tenant confusion.
6. Issuer confusion.
7. Account takeover melalui first-login linking.
8. IdP outage membuat aplikasi tidak bisa dipakai.
9. Logout tidak benar-benar logout dari semua lapisan.
10. Migration IdP memutus audit lineage.

Top 1% engineer tidak bertanya “pakai library apa?”, tetapi:

> “Apa invariant identitasnya, siapa source of truth, bukti apa yang diterima, claim mana yang dipercaya, bagaimana identitas dipersist, bagaimana mapping dibuktikan, dan bagaimana sistem gagal secara aman?”

---

## 2. Mental Model: IdP sebagai Boundary Kepercayaan

Identity Provider bukan sekadar “login server”. Dalam sistem enterprise, IdP bisa menjalankan beberapa peran berbeda.

```text
+----------------------+        +----------------------+        +----------------------+
|      User/Client      | -----> |  Identity Provider   | -----> |      Java App         |
| browser/mobile/cli    |        | authn, MFA, token    |        | relying party/client  |
+----------------------+        +----------------------+        +----------------------+
                                      |
                                      v
                              +----------------+
                              | Source Systems |
                              | LDAP/AD/HR DB  |
                              +----------------+
```

Aplikasi Java tidak melihat password user. Aplikasi menerima **assertion** dari IdP:

- ID token.
- Access token.
- SAML assertion.
- UserInfo response.
- Introspection response.
- LDAP bind result.
- Kerberos ticket.
- Client certificate mapping.

Assertion itu berkata:

```text
Menurut issuer X,
subject Y telah diautentikasi,
pada waktu T,
dengan metode/assurance A,
untuk audience/client Z,
dan memiliki claim C1..Cn.
```

Aplikasi Java harus memutuskan:

1. Apakah issuer dipercaya?
2. Apakah assertion valid secara cryptographic/protocol?
3. Apakah assertion dimaksudkan untuk aplikasi ini?
4. Apakah subject dapat diikat ke akun internal?
5. Apakah claim cukup untuk membuat user/session/principal?
6. Apakah authorization harus berasal dari IdP, aplikasi, atau kombinasi?
7. Apakah event ini harus mengubah data user internal?
8. Apakah login ini harus ditolak, diterima, atau perlu step-up?

### 2.1 IdP sebagai Authentication Authority

IdP menentukan apakah user benar-benar berhasil login.

Contoh:

- Password + MFA diverifikasi di Entra ID.
- SAML assertion ditandatangani oleh corporate IdP.
- Keycloak memvalidasi username/password, WebAuthn, atau external broker.
- AD/Kerberos mengeluarkan ticket.

Java app tidak lagi melakukan credential verification langsung.

### 2.2 IdP sebagai Token Issuer

IdP mengeluarkan token/assertion yang diverifikasi aplikasi.

Contoh:

- OIDC ID token untuk authentication.
- OAuth2 access token untuk resource server.
- SAML assertion untuk SP.
- Opaque token yang harus diintrospect.

### 2.3 IdP sebagai Attribute Provider

IdP menyediakan attribute:

- `email`.
- `name`.
- `preferred_username`.
- `given_name`.
- `family_name`.
- `groups`.
- `roles`.
- `department`.
- `employee_id`.
- `agency_code`.
- `tenant_id`.
- `acr`.
- `amr`.

Tetapi attribute bukan selalu source of truth untuk semua hal.

### 2.4 IdP sebagai Policy Enforcement Point

Beberapa IdP menerapkan:

- MFA policy.
- Conditional access.
- device compliance.
- network location rules.
- sign-in risk rules.
- session lifetime rules.
- password expiry.
- account lockout.

Aplikasi Java perlu tahu policy mana yang dipercayakan ke IdP dan policy mana yang tetap harus ada di aplikasi.

### 2.5 IdP sebagai Broker

IdP bisa menjadi broker ke IdP lain.

```text
User -> Java App -> Keycloak -> External IdP -> Corporate AD
```

Dalam kasus ini, Java app mempercayai Keycloak sebagai issuer, sementara Keycloak mempercayai external IdP.

Risikonya:

- Claim dari external IdP bisa berubah bentuk.
- Identity linking terjadi di broker.
- Audit harus bisa membedakan local IdP subject dan upstream subject.
- Assurance dari upstream harus diterjemahkan dengan benar.

---

## 3. Core Concepts

### 3.1 Relying Party / Client / Service Provider

Aplikasi Java biasanya disebut:

- **Relying Party** di OIDC.
- **OAuth2 Client** saat melakukan authorization code flow.
- **Resource Server** saat memvalidasi access token.
- **Service Provider** di SAML.
- **Protected Resource** dalam OAuth2.

Satu aplikasi bisa menjalankan beberapa peran sekaligus.

Contoh aplikasi Spring Boot:

```text
Browser user login:
  Java app = OAuth2/OIDC client / relying party

API endpoint menerima bearer token:
  Java app = OAuth2 resource server

Aplikasi memanggil downstream API:
  Java app = OAuth2 client lagi
```

Kesalahan umum:

> Menganggap “client” selalu berarti browser/frontend.

Dalam OAuth/OIDC, `client` adalah aplikasi yang terdaftar di authorization server, bukan selalu user agent.

---

### 3.2 Issuer

Issuer adalah pihak yang mengeluarkan token/assertion.

Dalam OIDC/JWT, claim `iss` sangat kritikal.

Contoh:

```json
{
  "iss": "https://login.example.gov/realms/agency-a",
  "sub": "a1b2c3d4",
  "aud": "case-management-app",
  "exp": 1760000000
}
```

Aplikasi harus memvalidasi:

```text
token.iss == issuer yang dikonfigurasi untuk tenant/client/context ini
```

Jangan hanya validasi signature.

Token yang ditandatangani valid oleh issuer lain tetap harus ditolak bila issuer tidak sesuai.

---

### 3.3 Subject

`sub` adalah identifier user di issuer tersebut.

OIDC Core mendefinisikan `sub` sebagai locally unique dan tidak pernah reassigned dalam konteks issuer.

Artinya:

```text
Global stable identity key bukan hanya sub.
Global stable identity key = issuer + subject.
```

Salah:

```text
internal_user.external_id = sub
```

Lebih benar:

```text
external_identity.provider = "entra-prod"
external_identity.issuer = "https://login.microsoftonline.com/{tenant}/v2.0"
external_identity.subject = token.sub
unique(provider, issuer, subject)
```

Kenapa?

Karena dua issuer berbeda bisa punya `sub` yang sama.

---

### 3.4 Audience

Audience menunjukkan untuk siapa token itu diterbitkan.

Kesalahan fatal:

> Resource server menerima access token yang audience-nya untuk service lain.

Contoh salah:

```text
Token aud = profile-api
Dipakai untuk call payment-api
payment-api hanya cek signature dan exp
```

Payment API harus menolak karena `aud` bukan untuk dirinya.

---

### 3.5 Client ID

Client ID mengidentifikasi aplikasi yang terdaftar di IdP.

Untuk OIDC login:

```text
client_id = web-portal
```

Untuk resource server, client ID pemanggil bisa muncul sebagai:

- `azp`.
- `client_id`.
- `appid`.
- `aud` tergantung IdP.

Jangan mencampur:

- `client_id` sebagai aplikasi peminta token.
- `aud` sebagai penerima token.
- `sub` sebagai user/service subject.

---

### 3.6 Claim

Claim adalah pernyataan tentang subject atau authentication event.

Contoh claim:

```json
{
  "email": "user@example.com",
  "email_verified": true,
  "name": "Jane Doe",
  "groups": ["case-officer", "reviewer"],
  "acr": "urn:mfa",
  "amr": ["pwd", "otp"]
}
```

Claim tidak otomatis benar untuk semua keputusan.

Pertanyaan desain:

1. Siapa yang mengeluarkan claim?
2. Apakah claim diverifikasi atau self-asserted?
3. Apakah claim stabil?
4. Apakah claim bisa berubah?
5. Apakah claim sensitif?
6. Apakah claim digunakan untuk authentication, authorization, display, routing, atau audit?

---

### 3.7 Federation

Federation berarti aplikasi menerima identitas dari domain lain melalui trust relationship.

Contoh:

```text
Agency App trusts Central Gov IdP.
Central Gov IdP trusts Singpass/Corppass-like upstream.
```

Federation memperluas trust chain.

Semakin panjang chain, semakin penting:

- issuer tracking.
- upstream identity tracking.
- assurance mapping.
- audit evidence.
- lifecycle rules.

---

### 3.8 Identity Brokering

Identity brokering adalah ketika IdP A menjadi perantara IdP B.

Contoh:

```text
Java App trusts Keycloak.
Keycloak brokers to Google, Entra, SAML IdP, LDAP.
```

Aplikasi Java hanya melihat token dari Keycloak, tetapi Keycloak mungkin menambahkan claim seperti:

```text
identity_provider = entra
identity_provider_identity = upstream subject
```

Desain penting:

- Apakah aplikasi perlu tahu upstream IdP?
- Apakah role berasal dari upstream atau local Keycloak?
- Apakah account linking dilakukan otomatis?
- Apakah first login membutuhkan review?

---

## 4. Java 8–25 Relevance

Integrasi IdP bisa dilakukan di berbagai lapisan Java.

### 4.1 Java 8 Era

Di Java 8, banyak enterprise app menggunakan:

- Servlet container auth.
- JAAS.
- SAML library.
- Spring Security 4/5.
- XML security library.
- Custom filter.
- JKS keystore.
- Legacy app server integration.

Pola umum:

```text
External IdP -> SAML assertion -> Java webapp -> HttpSession
```

Atau:

```text
Corporate AD -> LDAP bind -> Spring Security -> HttpSession
```

Risiko umum Java 8 legacy:

- claim mapping hardcoded.
- XML signature validation lemah.
- `email` sebagai primary key.
- session tidak rotate.
- logout hanya local.
- no JWKS rotation handling.
- no tenant-aware issuer validation.

### 4.2 Java 11–17 Era

Muncul modernisasi:

- Spring Boot 2/3.
- OIDC adoption meningkat.
- resource server JWT validation.
- `HttpClient` standar Java 11.
- Kubernetes/cloud-native deployment.
- externalized secrets.
- SSO via Keycloak/Okta/Entra/Auth0.

Pola umum:

```text
Browser -> Spring Boot OIDC client -> IdP -> local session
API client -> bearer access token -> Spring resource server
```

### 4.3 Java 21–25 Era

Java modern membawa implikasi:

- virtual threads mengubah asumsi thread/request tetapi tidak menghapus kebutuhan context isolation.
- structured concurrency membuat propagation lebih eksplisit.
- key management makin penting karena token/mTLS/signature makin umum.
- PEM/KDF API di JDK 25 relevan untuk cryptographic object handling.
- cloud identity dan workload identity makin dominan.

Pola modern:

```text
Browser -> BFF Java -> OIDC IdP -> HttpOnly session cookie
BFF -> downstream APIs via token exchange / client credentials
Resource services validate JWT/opaque token per audience
```

### 4.4 Framework Mapping

| Layer | Java/Jakarta/Spring Concept | IdP Integration Role |
|---|---|---|
| Java SE | JAAS, `Principal`, crypto APIs | low-level identity/credential model |
| Servlet | `HttpServletRequest#getUserPrincipal`, session | container principal and web session |
| Jakarta Security | `HttpAuthenticationMechanism`, `IdentityStore`, `SecurityContext` | portable app-server auth integration |
| Spring Security | `Authentication`, `SecurityContext`, OAuth2 Login, Resource Server | dominant Java app integration model |
| Gateway/Mesh | mTLS/JWT validation/header propagation | edge authentication and trust boundary |
| App code | domain user, permission model, audit actor | business identity and authorization |

---

## 5. IdP Integration Is a Mapping Problem

IdP integration is mostly a mapping problem.

Not just protocol mapping, but semantic mapping:

```text
External protocol identity
        ↓
Provider-specific claims
        ↓
Normalized identity model
        ↓
Internal user account
        ↓
Application principal
        ↓
Domain roles/permissions
        ↓
Audit actor
```

A robust Java system should make these layers explicit.

### 5.1 Bad Design: Direct Claim-to-Role

```text
JWT groups claim -> Spring GrantedAuthority -> business permission
```

This seems simple, but can be dangerous.

Problems:

- group name may change.
- IdP group semantics may not match app permission semantics.
- group claim may be missing due to token size limits.
- provider may emit different claim format per tenant.
- external group may grant too much.
- no approval workflow in application.
- no audit of why user got permission.

### 5.2 Better Design: Claim-to-Entitlement Mapping Layer

```text
External group claim
        ↓
Normalized external entitlement
        ↓
Application role mapping rule
        ↓
Effective permission
        ↓
Audit decision
```

Example:

```text
external group: "ACEAS_CASE_OFFICER_PROD"
normalized entitlement: provider=entra, type=group, value=ACEAS_CASE_OFFICER_PROD
application role: CASE_OFFICER
permissions: case.read, case.create, case.submit
```

This allows:

- mapping review.
- provider migration.
- audit trail.
- explicit least privilege.
- environment separation.

---

## 6. Reference Identity Model

A mature Java application should separate:

1. Internal user.
2. External identity.
3. Login session.
4. Credential/token event.
5. Role/permission assignment.
6. Audit actor.

### 6.1 Internal User

Represents the business/application account.

```sql
create table app_user (
    id                    uuid primary key,
    status                varchar(32) not null,
    display_name          varchar(255),
    primary_email         varchar(255),
    created_at            timestamp not null,
    updated_at            timestamp not null,
    version               bigint not null
);
```

Important: internal user ID should be stable and not tied directly to IdP `sub`.

Why?

- provider may change.
- user may link multiple IdPs.
- migration may happen.
- email may change.
- audit lineage must survive provider migration.

### 6.2 External Identity

Represents login identity from IdP.

```sql
create table external_identity (
    id                    uuid primary key,
    app_user_id            uuid not null references app_user(id),
    provider_key           varchar(100) not null,
    issuer                 varchar(500) not null,
    subject                varchar(500) not null,
    upstream_provider      varchar(100),
    upstream_subject       varchar(500),
    email_at_link_time     varchar(255),
    email_verified_at_link boolean,
    linked_at              timestamp not null,
    last_seen_at           timestamp,
    status                 varchar(32) not null,
    unique(provider_key, issuer, subject)
);
```

The stable external identity key:

```text
(provider_key, issuer, subject)
```

For multi-tenant IdP:

```text
(provider_key, issuer, tenant_id, subject)
```

But often `tenant_id` is already embedded in issuer.

### 6.3 Login Session

Represents continuity after authentication.

```sql
create table login_session (
    id                    uuid primary key,
    app_user_id            uuid not null,
    external_identity_id   uuid,
    session_handle_hash    varchar(255) not null,
    auth_time              timestamp,
    acr                    varchar(255),
    amr                    jsonb,
    created_at             timestamp not null,
    last_seen_at           timestamp not null,
    expires_at             timestamp not null,
    revoked_at             timestamp,
    revocation_reason      varchar(255)
);
```

### 6.4 Login Event

```sql
create table authentication_event (
    id                    uuid primary key,
    event_type             varchar(64) not null,
    app_user_id            uuid,
    external_identity_id   uuid,
    provider_key           varchar(100),
    issuer                 varchar(500),
    subject_hash           varchar(255),
    client_id              varchar(255),
    tenant_key             varchar(100),
    result                 varchar(32) not null,
    failure_reason         varchar(255),
    acr                    varchar(255),
    amr                    jsonb,
    ip_hash                varchar(255),
    user_agent_hash        varchar(255),
    correlation_id         varchar(100),
    occurred_at            timestamp not null
);
```

This supports audit without overlogging sensitive tokens.

---

## 7. Provider Modeling

A provider configuration should be modeled explicitly.

### 7.1 Provider Definition

```yaml
identityProviders:
  - key: entra-agency-a
    type: oidc
    issuer: https://login.microsoftonline.com/tenant-a/v2.0
    clientId: aceas-web
    jwksCacheTtl: 10m
    allowedAudiences:
      - aceas-web
    subjectClaim: sub
    usernameClaim: preferred_username
    emailClaim: email
    tenantClaim: tid
    enabled: true

  - key: keycloak-internal
    type: oidc
    issuer: https://sso.internal.example.com/realms/aceas
    clientId: aceas-web
    subjectClaim: sub
    groupsClaim: groups
    enabled: true
```

### 7.2 Provider Key vs Issuer

`provider_key` is your application configuration key.

`issuer` is protocol-level issuer.

Do not conflate them.

Why?

During migration, you may have:

```text
provider_key = primary-sso
old issuer   = https://old-idp.example.com/realms/prod
new issuer   = https://new-idp.example.com/realms/prod
```

Or:

```text
provider_key = entra-agency-a
issuer       = https://login.microsoftonline.com/{tenant}/v2.0
```

### 7.3 Per-Tenant Provider Model

For multi-tenant applications:

```yaml
tenants:
  agency-a:
    identityProvider: entra-agency-a
    allowedIssuers:
      - https://login.microsoftonline.com/tenant-a/v2.0
    allowedClientIds:
      - aceas-agency-a-web

  agency-b:
    identityProvider: keycloak-agency-b
    allowedIssuers:
      - https://sso.example.com/realms/agency-b
    allowedClientIds:
      - aceas-agency-b-web
```

Avoid:

```text
Accept any token signed by any configured IdP for any tenant.
```

That creates cross-tenant token confusion.

---

## 8. Claim Normalization

Claim normalization converts provider-specific claims into your internal identity input model.

### 8.1 Why Claim Normalization Is Required

Different IdPs emit different claim names.

Example:

| Semantic Meaning | Keycloak | Entra ID | Okta/Auth0-like | Custom IdP |
|---|---|---|---|---|
| subject | `sub` | `sub` / `oid` context-dependent | `sub` | `user_id` |
| email | `email` | `email` / `preferred_username` | `email` | `mail` |
| tenant | realm/issuer | `tid` | org claim | `agency_code` |
| groups | `groups` | `groups` / overage behavior | `groups` | `roles` |
| roles | `realm_access.roles` / `resource_access` | `roles` / `scp` | custom | custom |

A Java application should not scatter provider-specific claim parsing across controllers/services.

### 8.2 Normalized Identity Object

Example Java record:

```java
public record NormalizedIdentity(
        String providerKey,
        String issuer,
        String subject,
        String tenantKey,
        String username,
        String email,
        boolean emailVerified,
        String displayName,
        String acr,
        List<String> amr,
        List<ExternalEntitlement> entitlements,
        Map<String, Object> rawClaimsForDebugging
) {}
```

For Java 8, use immutable class instead of record.

### 8.3 Normalizer Interface

```java
public interface IdentityClaimNormalizer {
    NormalizedIdentity normalize(ProviderConfig provider, TokenClaims claims);
}
```

Provider-specific implementations:

```text
KeycloakClaimNormalizer
EntraClaimNormalizer
OktaClaimNormalizer
Auth0ClaimNormalizer
CustomGovIdpClaimNormalizer
SamlAssertionNormalizer
```

### 8.4 Claim Classification

Classify claims before use.

| Claim Type | Examples | Use Carefully For |
|---|---|---|
| Stable identity | `iss`, `sub`, tenant id | external identity binding |
| Display | `name`, `preferred_username` | UI only |
| Contact | `email`, `phone_number` | notification, not primary identity unless governed |
| Assurance | `acr`, `amr`, `auth_time` | step-up decision |
| Authorization | `groups`, `roles`, `scp` | mapping input only |
| Routing | `tenant`, `agency_code` | tenant resolution if trusted |
| Audit | provider, subject hash, auth method | forensic reconstruction |

### 8.5 Do Not Use Email as the Only Link Key

Email can change.

Email may be unverified.

Email can be reused.

Email may differ across providers.

Email may not be globally unique in all enterprise contexts.

Safer rule:

```text
Use issuer + subject for external identity binding.
Use email as secondary/display/contact attribute.
Use email for first-login matching only with strict controls.
```

---

## 9. Identity Linking Patterns

Identity linking answers:

> “This external identity has logged in. Which internal user account should it map to?”

### 9.1 Pattern A — Pre-Provisioned Linking

Admin/system pre-creates link:

```text
app_user_id = U123
provider = entra-agency-a
issuer = ...
subject = abc123
```

Then login only succeeds if link exists.

Pros:

- Strong control.
- Good for high-risk systems.
- No automatic account takeover via email.
- Audit-friendly.

Cons:

- Operational overhead.
- Needs provisioning pipeline.
- Poor UX if not automated.

Use when:

- Government/regulatory systems.
- Admin portals.
- Financial systems.
- High privilege roles.
- External agency access.

### 9.2 Pattern B — Just-in-Time Provisioning

On first successful IdP login, create internal user.

```text
if external identity unknown and tenant allowed:
    create app_user
    create external_identity
    assign default role
```

Pros:

- Low onboarding friction.
- Good for low-risk self-service.
- Scales well.

Cons:

- Dangerous if default role too broad.
- Needs tenant/domain allowlist.
- Needs email verification rule.
- Can create orphan accounts.

Use when:

- Low-risk apps.
- Consumer apps.
- Internal tools with controlled IdP tenant.
- Developer portals with approval workflow.

### 9.3 Pattern C — Invite-Based Linking

User receives invitation token, then logs in via IdP. The invitation links external identity to intended internal account.

```text
Admin invites user@example.com to role CASE_OFFICER.
User clicks invite.
User authenticates via IdP.
System verifies email/tenant/constraints.
External identity is linked to invitation target.
```

Pros:

- Stronger than blind JIT.
- Better UX than manual pre-link.
- Good audit trail.

Cons:

- Invitation token lifecycle required.
- Email mismatch handling needed.
- Expiry/revocation needed.

Use when:

- Partner onboarding.
- Case management portals.
- Multi-agency systems.
- SaaS admin invites.

### 9.4 Pattern D — User-Initiated Account Linking

Logged-in user links another IdP.

```text
User logged in with password/session.
User chooses “link corporate SSO”.
User authenticates at corporate IdP.
System links external identity to current app_user.
```

Pros:

- User controls linking.
- Good for optional SSO migration.

Cons:

- Requires re-authentication/step-up.
- Risk if current session hijacked.
- Needs unlinking policy.

Use when:

- Account migration.
- Optional social login.
- Bring-your-own-IdP.

### 9.5 Pattern E — Brokered Linking

A broker IdP links upstream identity before app receives token.

```text
Java App trusts Keycloak subject.
Keycloak links Google/Entra/SAML upstream identities.
```

Pros:

- App integration simpler.
- Centralized federation logic.
- Many apps benefit.

Cons:

- App may lose upstream detail.
- Broker misconfiguration affects all apps.
- First-login flow becomes critical.

Use when:

- Enterprise SSO hub.
- Multi-IdP login portal.
- Gradual provider migration.

---

## 10. First-Login Flow Design

First-login flow is one of the most dangerous parts of IdP integration.

It decides what happens when an external identity is valid but unknown to the application.

### 10.1 First-Login Decision Tree

```text
External identity authenticated by IdP
        |
        v
Is issuer trusted for this tenant/app?
        | no -> reject
        v yes
Is subject already linked?
        | yes -> login existing user
        v no
Is JIT provisioning allowed?
        | yes -> create user with minimal role
        v no
Is invite token present and valid?
        | yes -> link to invited user
        v no
Is email matching allowed?
        | yes -> require verified email + policy + step-up/review
        v no
Reject / require admin approval
```

### 10.2 Email-Based Auto-Linking Danger

Dangerous pattern:

```text
if token.email == existing_user.email:
    link automatically
```

This can be unsafe if:

- email not verified.
- email reassigned.
- attacker controls external provider with same email.
- multiple tenants share email namespace.
- old internal account has high privilege.

Safer email-based linking requires all of:

1. trusted issuer.
2. `email_verified = true` or equivalent assurance.
3. tenant/domain allowlist.
4. no existing conflicting external link.
5. user or admin confirmation.
6. audit event.
7. optional step-up.
8. risk-based review for privileged users.

### 10.3 Account Creation Minimalism

On JIT provisioning, do not assign powerful roles directly from self-asserted claims.

Better:

```text
first login -> app_user status = PENDING_PROFILE or ACTIVE_LIMITED
roles = default minimal role
then workflow grants business roles
```

For internal enterprise where IdP group is controlled, you may map groups, but still keep mapping explicit and auditable.

### 10.4 First Login Flow in Brokered IdP

Keycloak, for example, has identity brokering and first broker login flow concepts. The main design lesson is generic:

```text
When a broker receives an upstream identity for the first time,
it must decide whether to create user,
link to existing user,
ask for profile update,
require review,
or reject.
```

Do not treat broker default as automatically safe for your business domain.

---

## 11. Role and Group Mapping

Role mapping is where many systems silently become insecure.

### 11.1 Authentication vs Authorization Boundary

Authentication answer:

```text
Who is this?
```

Authorization answer:

```text
What may this actor do?
```

IdP can contribute authorization input, but app should own business authorization semantics.

### 11.2 IdP Groups Are Not Always App Roles

External group:

```text
CN=ACEAS-OPS-LEVEL2,OU=Groups,DC=example,DC=com
```

Application role:

```text
CASE_REVIEWER
```

Permission:

```text
case.review.approve
```

These are different layers.

A clean model:

```text
External group -> normalized entitlement -> app role -> permission set
```

### 11.3 Mapping Table

```sql
create table external_entitlement_mapping (
    id                    uuid primary key,
    provider_key           varchar(100) not null,
    tenant_key             varchar(100),
    entitlement_type       varchar(50) not null,
    entitlement_value      varchar(500) not null,
    app_role               varchar(100) not null,
    environment            varchar(32) not null,
    status                 varchar(32) not null,
    created_by             varchar(100) not null,
    created_at             timestamp not null,
    approved_by            varchar(100),
    approved_at            timestamp
);
```

### 11.4 Token Claim Size Problem

Large enterprises may have users in hundreds/thousands of groups.

Problems:

- token too large.
- group overage behavior.
- claim omitted.
- provider emits reference instead of full list.
- app incorrectly assumes no groups means no roles.

Design options:

1. Use app roles instead of raw groups.
2. Use IdP-specific group lookup API after login.
3. Use SCIM/provisioning to pre-sync groups.
4. Use application-owned authorization table.
5. Use introspection/UserInfo if supported.
6. Use entitlement cache with TTL.

### 11.5 Avoid Environment Confusion

Never map production privilege from non-production IdP group.

Bad:

```text
ACEAS_ADMIN -> ADMIN in all environments
```

Better:

```text
ACEAS_DEV_ADMIN  -> ADMIN only in dev
ACEAS_UAT_ADMIN  -> ADMIN only in uat
ACEAS_PROD_ADMIN -> ADMIN only in prod
```

### 11.6 Role Mapping in Spring Security

Spring Security exposes `GrantedAuthority` for authorization decisions. For OAuth2/OIDC login, authorities from `OAuth2User` or `OidcUser` can be mapped into application authorities.

But do not let mapper become unreviewed business logic blob.

Better structure:

```text
OAuth/OIDC token
  -> ClaimNormalizer
  -> ExternalEntitlementExtractor
  -> EntitlementMappingService
  -> ApplicationPrincipal
  -> GrantedAuthority set
```

---

## 12. Attribute Synchronization

Attribute synchronization answers:

> “When IdP says user name/email/department changed, should application update its user record?”

### 12.1 Attribute Categories

| Attribute | Recommended Source | Sync Strategy |
|---|---|---|
| internal user ID | app | never overwritten by IdP |
| external subject | IdP | immutable after link |
| display name | IdP or app | update on login or SCIM |
| email | IdP or app | update carefully |
| department | HR/IdP | periodic sync or login sync |
| roles | app or IdP | explicit mapping/sync |
| status | app + IdP | joiner/mover/leaver policy |
| MFA assurance | IdP | per login event only |
| auth time | IdP | per session only |

### 12.2 Login-Time Sync

On each login:

```text
read claims -> normalize -> update selected app_user attributes
```

Pros:

- simple.
- eventually up-to-date for active users.

Cons:

- inactive users stale.
- login latency increases.
- claim change can unexpectedly mutate app data.
- hard to audit if overused.

Good for:

- display name.
- last seen.
- non-critical contact info.

Bad for:

- high privilege role assignment without approval.
- irreversible identity binding.
- regulatory-sensitive attributes without audit.

### 12.3 Provisioning Sync

Use provisioning pipeline such as SCIM or custom sync.

```text
HR/Directory/IdP -> provisioning service -> app_user/external_identity/roles
```

Pros:

- user lifecycle independent of login.
- supports deprovisioning inactive users.
- better audit.
- predictable access removal.

Cons:

- more infrastructure.
- sync consistency issues.
- conflict resolution required.

### 12.4 Hybrid Sync

Common enterprise pattern:

```text
Login-time sync:
  last login, display name, auth assurance

Provisioning sync:
  account status, organization, role assignment, group membership
```

This is often the best practical design.

---

## 13. Account Status and Deprovisioning

Authentication success at IdP does not always mean application access should be granted.

A user can be valid at IdP but disabled in app.

Example:

```text
User is still employee, can access corporate SSO,
but no longer assigned to this regulatory application.
```

Therefore login decision should check:

```text
IdP authentication valid
AND external identity linked
AND app user active
AND tenant access active
AND role assignment valid
AND policy conditions satisfied
```

### 13.1 Status Model

```text
app_user.status:
  ACTIVE
  PENDING_APPROVAL
  SUSPENDED
  DISABLED
  DELETED_LOGICAL

external_identity.status:
  ACTIVE
  LINK_PENDING
  REVOKED
  STALE
  CONFLICTED
```

### 13.2 Leaver Handling

If user leaves organization:

- IdP disables user.
- Existing app sessions should be revoked or expire quickly.
- Refresh tokens should be invalidated by IdP.
- App local session may still exist unless checked.

Design options:

1. Short app session lifetime.
2. Backchannel logout/event webhook.
3. Periodic session revalidation.
4. App-side user status sync.
5. Introspection for opaque token.
6. Gateway denies disabled users.

### 13.3 Mover Handling

If user changes department/role:

- authentication still valid.
- authorization may change.
- existing sessions may have stale roles.

Design choices:

```text
Role evaluated at login only:
  simpler but stale until session refresh.

Role evaluated per request from app DB/cache:
  fresher but more overhead.

Role version embedded in session:
  invalidate session when role_version changes.
```

Recommended for high-risk apps:

```text
Store role_version in session.
On request, compare with current user role_version.
If mismatch, re-authenticate or refresh principal.
```

---

## 14. Tenant and Organization Modeling

Identity Provider integration becomes harder in multi-tenant systems.

### 14.1 Tenant Discovery

How does app know which IdP to use?

Options:

1. URL subdomain:

```text
https://agency-a.app.example.com
```

2. Path:

```text
https://app.example.com/agency-a
```

3. Email domain discovery:

```text
user enters email -> domain maps to IdP
```

4. Explicit tenant selection:

```text
Choose your agency/organization
```

5. Invite link contains tenant.

6. Client configuration per customer.

### 14.2 Avoid Trusting Tenant Claim Too Early

Dangerous:

```text
Read tenant_id claim from unvalidated token,
then choose issuer validation rule based on that tenant_id.
```

Correct order:

```text
resolve expected tenant/provider from request context or client registration
validate issuer/signature/audience
then trust tenant claim as additional evidence
```

### 14.3 Tenant-Aware External Identity

```text
unique tenant external identity:
  tenant_key + provider_key + issuer + subject
```

But be careful: same person may belong to multiple tenants.

Design decision:

```text
Same human across tenants = same app_user?
Or separate app_user per tenant?
```

For regulatory systems, often safer:

```text
app_user membership is tenant-scoped.
identity can be shared, access is tenant-specific.
```

Model:

```sql
app_user
external_identity
organization_membership
role_assignment
```

---

## 15. IdP Outage Strategy

IdP outage is not hypothetical.

Design must define behavior for:

1. New login.
2. Existing session.
3. Token refresh.
4. JWKS fetch.
5. Introspection.
6. UserInfo lookup.
7. Group lookup.
8. Logout.
9. Admin emergency access.

### 15.1 Failure Modes

| Dependency | Failure | App Impact |
|---|---|---|
| discovery endpoint | unavailable | app cannot initialize or refresh metadata |
| JWKS endpoint | unavailable | JWT validation may fail if unknown key |
| token endpoint | unavailable | login callback/token exchange fails |
| introspection endpoint | unavailable | opaque token validation fails |
| UserInfo endpoint | unavailable | profile enrichment fails |
| group API | unavailable | role mapping incomplete |
| IdP login UI | unavailable | new login impossible |

### 15.2 JWKS Caching

Resource servers must cache JWKS.

But cache must handle:

- key rotation.
- unknown `kid`.
- stale keys.
- emergency key revocation.
- cache stampede.

Common pattern:

```text
If token kid known:
    validate with cached key
If token kid unknown:
    refresh JWKS once with rate limit
If still unknown:
    reject token
```

Do not fetch JWKS per request.

### 15.3 Existing Session During IdP Outage

If app uses local session after OIDC login:

```text
Existing app sessions may continue even if IdP is down.
```

This can be desirable for availability, but risky if user was disabled at IdP.

Choose explicitly:

| Strategy | Availability | Security Freshness |
|---|---:|---:|
| Continue existing sessions | high | lower |
| Revalidate frequently | medium | higher |
| Fail closed on IdP outage | low | highest |

For most enterprise apps:

```text
Existing low-risk sessions continue until short expiry.
Privileged actions require step-up/revalidation.
New login fails if IdP unavailable.
```

### 15.4 Emergency Break-Glass Access

High-risk systems sometimes need emergency admin access.

Rules:

- Not normal password bypass.
- Hardware-backed or strongly protected.
- Very limited accounts.
- Separate audit alert.
- Time-bound.
- Requires post-incident review.

Do not silently keep a local admin password as “backup” without governance.

---

## 16. Logout and Session Coordination

Logout is multi-layered:

```text
Browser session at app
IdP session
upstream broker session
refresh token
access token
other application sessions
```

### 16.1 Local Logout

App invalidates local session.

```text
HttpSession invalidated
session cookie expired
remember-me token revoked
```

But IdP session may remain.

User clicks login again and is silently reauthenticated.

### 16.2 IdP Logout

App redirects to IdP logout endpoint or uses RP-initiated logout.

Need:

- ID token hint.
- post logout redirect URI.
- state.
- provider-specific behavior.

### 16.3 Backchannel Logout

IdP notifies app to terminate session.

Useful when:

- central logout.
- admin terminates user session.
- user logs out from SSO portal.

Need mapping:

```text
sid/sub/issuer -> app sessions
```

### 16.4 Logout Invariants

A robust design states:

1. Local logout always terminates app session.
2. Global logout attempts IdP logout but handles failure gracefully.
3. Backchannel logout terminates mapped sessions.
4. Access tokens remain valid until expiry unless introspection/revocation is used.
5. Refresh tokens must be revoked when possible.
6. Audit event records what was actually terminated.

---

## 17. Migration Between Identity Providers

Provider migration is common:

- custom login -> Keycloak.
- Keycloak -> Entra ID.
- SAML -> OIDC.
- AD/LDAP -> cloud IdP.
- Okta/Auth0 consolidation.
- realm split/merge.
- tenant migration.

### 17.1 Migration Problem

Old identity:

```text
provider = old-keycloak
issuer = https://old.example.com/realms/prod
sub = 123
```

New identity:

```text
provider = entra
issuer = https://login.microsoftonline.com/tenant/v2.0
sub = abc
```

Application must know both refer to same internal user.

### 17.2 Migration Patterns

#### Pattern A — Dual Login Window

Support old and new IdP for limited time.

```text
if old identity logs in -> allowed
if new identity logs in -> link/migrate
```

Pros:

- smoother migration.

Cons:

- larger attack surface.
- more complex support.

#### Pattern B — Pre-Migrated Mapping

Before cutover, import mapping:

```text
old external identity -> app_user -> new external identity
```

Pros:

- deterministic.
- low first-login risk.

Cons:

- requires reliable mapping source.

#### Pattern C — Invite/Re-Link Migration

Users re-link using controlled invitation.

Pros:

- safer when mapping uncertain.

Cons:

- user friction.

#### Pattern D — Broker Migration

Use Keycloak/broker to hide upstream migration from apps.

```text
App subject remains Keycloak subject.
Upstream changes behind broker.
```

Pros:

- apps less impacted.

Cons:

- broker becomes critical.
- upstream assurance must be mapped.

### 17.3 Migration Invariants

During migration:

1. Internal app user ID must remain stable.
2. Audit actor lineage must remain reconstructable.
3. Old provider should have clear sunset date.
4. Dual-provider acceptance should be tenant/client scoped.
5. High-privilege users should require stronger migration proof.
6. Rollback should be defined.
7. Conflicting links must be blocked.
8. Email-only migration should be avoided unless strongly governed.

---

## 18. Security Risks and Failure Modes

### 18.1 Issuer Confusion

App accepts token from wrong issuer.

Cause:

- validates signature against shared JWKS.
- does not check `iss`.
- multi-tenant config too broad.

Defense:

- strict issuer allowlist per tenant/client.
- validate discovery metadata.
- do not accept arbitrary issuer from request.

### 18.2 Audience Confusion

App accepts token intended for another API.

Defense:

- validate `aud` exactly.
- per-service audience.
- do not use ID token as API access token.

### 18.3 Account Linking Takeover

Attacker authenticates via trusted external IdP and gets linked to victim account.

Cause:

- email auto-link.
- unverified email.
- weak first-login flow.
- no tenant constraint.

Defense:

- issuer+subject binding.
- invite/pre-provisioning for high-risk.
- verified email only as secondary signal.
- step-up/admin review.

### 18.4 Claim Injection / Header Injection

Gateway validates user then forwards headers:

```http
X-User: admin
X-Groups: admin
```

If app accepts headers from untrusted callers, attacker can spoof them.

Defense:

- strip identity headers at edge.
- only trust headers from authenticated gateway network/mTLS.
- prefer token validation in app for high-risk.
- sign internal identity headers if needed.

### 18.5 Role Overgrant

External group grants too much app permission.

Defense:

- explicit mapping table.
- least privilege.
- approval workflow.
- environment-specific groups.
- audit role source.

### 18.6 Stale Authorization

User removed from group but app session still has old roles.

Defense:

- short session.
- role version check.
- dynamic authorization lookup.
- provisioning webhook.
- session revocation on role change.

### 18.7 Token Substitution

User swaps token from one context to another.

Defense:

- issuer/audience/client validation.
- nonce/state for OIDC login.
- token type validation.
- `azp`/authorized party checks when relevant.

### 18.8 Broker Blindness

App trusts broker but loses upstream context needed for policy.

Defense:

- include upstream provider and assurance claims.
- audit brokered identity.
- configure broker mappers explicitly.

### 18.9 IdP Downtime Fail-Open

App treats IdP validation failure as success.

Defense:

- fail closed for new auth.
- bounded cache for known keys/metadata.
- explicit degraded mode.
- alerting.

### 18.10 Subject Reassignment Assumption

App assumes external IDs are never reassigned without verifying provider contract.

Defense:

- use standard `sub` where provider guarantees non-reassignment.
- read provider docs.
- use immutable object ID when available.
- avoid username/email as stable identifier.

---

## 19. Implementation Pattern in Spring Security

### 19.1 OIDC Login Flow Concept

```text
/oauth2/authorization/{registrationId}
        ↓
Spring redirects to IdP
        ↓
IdP authenticates user
        ↓
callback /login/oauth2/code/{registrationId}
        ↓
Spring exchanges code for tokens
        ↓
Spring validates ID token
        ↓
OidcUserService loads user
        ↓
custom mapper normalizes identity
        ↓
app links/provisions user
        ↓
SecurityContext contains ApplicationPrincipal
```

### 19.2 Custom OIDC User Service Pattern

Pseudo-code:

```java
public final class ApplicationOidcUserService implements OAuth2UserService<OidcUserRequest, OidcUser> {

    private final OidcUserService delegate = new OidcUserService();
    private final IdentityClaimNormalizer normalizer;
    private final ExternalIdentityService externalIdentityService;
    private final ApplicationPrincipalFactory principalFactory;

    @Override
    public OidcUser loadUser(OidcUserRequest userRequest) throws OAuth2AuthenticationException {
        OidcUser oidcUser = delegate.loadUser(userRequest);

        ProviderConfig provider = ProviderConfig.fromRegistration(
                userRequest.getClientRegistration()
        );

        NormalizedIdentity identity = normalizer.normalize(
                provider,
                TokenClaims.from(oidcUser.getClaims())
        );

        LinkedUser linkedUser = externalIdentityService.resolveOrProvision(identity);

        ApplicationPrincipal principal = principalFactory.create(linkedUser, identity);

        return new ApplicationOidcUser(
                principal,
                oidcUser.getIdToken(),
                oidcUser.getUserInfo()
        );
    }
}
```

The important thing is not exact class names. The important architecture is:

```text
Framework OIDC user -> normalized identity -> internal user -> app principal
```

### 19.3 GrantedAuthority Mapping Pattern

```java
public final class ApplicationAuthorityMapper implements GrantedAuthoritiesMapper {

    private final EntitlementMappingService mappingService;

    @Override
    public Collection<? extends GrantedAuthority> mapAuthorities(
            Collection<? extends GrantedAuthority> authorities) {

        // In real design, use normalized identity/principal context,
        // not only raw authority strings.
        return mappingService.map(authorities).stream()
                .map(role -> new SimpleGrantedAuthority("ROLE_" + role.name()))
                .toList();
    }
}
```

For Java 8:

```java
return mappingService.map(authorities).stream()
        .map(role -> new SimpleGrantedAuthority("ROLE_" + role.name()))
        .collect(Collectors.toList());
```

### 19.4 Avoid Controller-Level Claim Parsing

Bad:

```java
@GetMapping("/cases")
public List<Case> cases(@AuthenticationPrincipal OidcUser user) {
    String agency = (String) user.getClaims().get("agency_code");
    ...
}
```

Better:

```java
@GetMapping("/cases")
public List<Case> cases(@AuthenticationPrincipal ApplicationPrincipal principal) {
    return caseService.listForAgency(principal.tenantKey(), principal.userId());
}
```

Controllers should see application identity, not provider-specific raw claims.

---

## 20. Implementation Pattern in Jakarta Security

Jakarta Security can integrate custom identity store and authentication mechanism.

Conceptual flow:

```text
HttpAuthenticationMechanism validates incoming request/token/assertion
        ↓
IdentityStore validates/loads identity
        ↓
SecurityContext exposes caller principal/groups
        ↓
Application maps caller to domain user
```

For OIDC-capable Jakarta Security implementations, OIDC mechanism may be provided by container/spec support.

But still apply same design:

```text
Container caller principal
        ↓
Normalized identity
        ↓
Internal app user
        ↓
Domain principal
```

Do not let container group names directly become business permissions without mapping.

---

## 21. Implementation Pattern with Gateway/BFF

### 21.1 BFF Pattern

```text
Browser
  -> Java BFF
      -> OIDC login with IdP
      -> HttpOnly session cookie to browser
      -> downstream API calls with server-side token
```

Pros:

- tokens not exposed to browser JavaScript.
- central session management.
- easier CSRF/cookie design.
- good for enterprise apps.

Cons:

- BFF becomes critical.
- requires session store/scaling.
- downstream token management centralized.

### 21.2 Gateway Validates Token, App Trusts Header

```text
Client -> Gateway validates JWT -> Java service receives X-User headers
```

This can work only if:

- service is not reachable except through gateway.
- gateway strips incoming identity headers.
- service authenticates gateway via network/mTLS.
- headers are well-defined.
- audit records gateway identity source.

For high-risk systems, prefer app-level token validation or signed identity envelope.

### 21.3 Service Mesh Identity

Service mesh can authenticate workloads with mTLS.

But mTLS workload identity is not the same as end-user identity.

Need distinguish:

```text
workload caller = case-api service account
end user actor = officer U123
```

Audit should capture both when relevant.

---

## 22. Testing Strategy

### 22.1 Unit Tests

Test claim normalization:

- missing email.
- unverified email.
- missing groups.
- nested Keycloak roles.
- Entra tenant claim.
- unknown issuer.
- malformed subject.
- conflicting group claims.

Test identity linking:

- known external identity.
- unknown identity JIT disabled.
- invite token valid.
- email match but unverified.
- duplicate subject conflict.
- disabled app user.

### 22.2 Integration Tests

Use:

- WireMock for OIDC discovery/JWKS/UserInfo.
- Testcontainers for Keycloak if appropriate.
- MockMvc/WebTestClient for Spring flows.
- SAML test IdP for SAML flows.

Scenarios:

1. valid login.
2. wrong issuer.
3. wrong audience.
4. expired token.
5. unknown `kid`.
6. rotated key.
7. missing required claim.
8. first login rejected.
9. first login provisioned.
10. disabled user blocked.
11. role mapping changed.
12. logout invalidates session.

### 22.3 Contract Tests with IdP

For each provider/tenant, assert:

- issuer URL.
- discovery metadata.
- expected claims.
- group/role claim format.
- email verification behavior.
- `acr`/`amr` behavior.
- logout behavior.
- JWKS rotation behavior.

### 22.4 Security Regression Tests

Add tests for:

- account linking takeover.
- cross-tenant token use.
- token intended for another audience.
- ID token used as access token.
- untrusted identity headers.
- role overgrant.
- stale session role version.

---

## 23. Observability and Audit

### 23.1 Authentication Event Fields

Log safely:

```text
event_type=OIDC_LOGIN_SUCCESS
provider_key=entra-agency-a
issuer=https://login.microsoftonline.com/.../v2.0
subject_hash=sha256(sub + app_salt)
app_user_id=...
tenant_key=agency-a
client_id=aceas-web
acr=...
amr=[pwd,mfa]
correlation_id=...
result=success
```

Do not log:

- raw ID token.
- raw access token.
- refresh token.
- full SAML assertion.
- private claims unnecessarily.
- password/secret.

### 23.2 Linking Event

When linking external identity:

```text
event_type=EXTERNAL_IDENTITY_LINKED
app_user_id=...
provider_key=...
issuer=...
subject_hash=...
method=INVITE | ADMIN | JIT | USER_INITIATED | BROKER
approved_by=...
correlation_id=...
```

### 23.3 Role Mapping Event

When external entitlement maps to app role:

```text
event_type=AUTHORITY_MAPPED
provider_key=...
entitlement_type=GROUP
entitlement_hash=...
app_role=CASE_OFFICER
mapping_rule_id=...
```

### 23.4 Failure Event

Failure should be specific internally, but generic to user.

User-facing:

```text
Unable to sign in. Contact support if the problem continues.
```

Internal event:

```text
failure_reason=UNKNOWN_ISSUER | AUDIENCE_MISMATCH | USER_DISABLED | LINK_REQUIRED | EMAIL_UNVERIFIED
```

---

## 24. Production Checklist

### 24.1 Provider Configuration

- [ ] Each provider has explicit `provider_key`.
- [ ] Issuer is allowlisted.
- [ ] Audience/client ID validation is explicit.
- [ ] JWKS cache strategy is defined.
- [ ] Discovery metadata is pinned/validated where appropriate.
- [ ] Environments use separate clients/realms/tenants.
- [ ] Redirect URIs are exact and environment-specific.
- [ ] Logout endpoints are understood.
- [ ] IdP outage behavior is documented.

### 24.2 Identity Binding

- [ ] Internal user ID is independent from external subject.
- [ ] External identity uses issuer+subject.
- [ ] Email is not sole identity key.
- [ ] First-login behavior is explicit.
- [ ] JIT provisioning is tenant-scoped.
- [ ] Invite/pre-provisioning used for privileged access.
- [ ] Conflicting links are rejected.
- [ ] Linking event is audited.

### 24.3 Claim Normalization

- [ ] Provider-specific parsing isolated.
- [ ] Required claims validated.
- [ ] Optional claims handled safely.
- [ ] Missing group claims do not accidentally grant access.
- [ ] `acr`/`amr` mapped for assurance decisions.
- [ ] Raw claims are not spread across business code.

### 24.4 Authorization Mapping

- [ ] External groups/roles map through explicit rules.
- [ ] App owns business permissions.
- [ ] Mapping is environment-aware.
- [ ] Mapping changes are audited.
- [ ] Role version/session freshness strategy exists.
- [ ] High privilege roles require review.

### 24.5 Operations

- [ ] Login success/failure metrics exist.
- [ ] Unknown issuer/audience mismatch alerts exist.
- [ ] JWKS refresh errors monitored.
- [ ] Token validation failures categorized.
- [ ] IdP latency monitored.
- [ ] Break-glass policy exists if required.
- [ ] Runbook covers IdP outage.
- [ ] Migration/rollback plan exists for provider changes.

---

## 25. Common Mistakes

### Mistake 1 — Treating IdP Integration as Pure Framework Config

Bad thinking:

```text
Add spring.security.oauth2.client.registration.* and done.
```

Better thinking:

```text
Framework validates protocol.
Application must define identity binding, claim normalization,
role mapping, lifecycle, audit, and failure behavior.
```

### Mistake 2 — Email as Primary Key

Email is useful, but not stable enough as universal identity.

Use:

```text
issuer + subject
```

### Mistake 3 — Accepting Any Token Signed by Trusted IdP

A token can be valid but not meant for your app.

Always validate:

- issuer.
- audience.
- expiry.
- token type.
- client/authorized party where relevant.

### Mistake 4 — Direct Group-to-Admin Mapping

External group changes can instantly grant app admin.

Use explicit mapping and approval.

### Mistake 5 — No First-Login Policy

Unknown external identity should not automatically become privileged user.

### Mistake 6 — No Deprovisioning Strategy

Login works, but user removal from organization does not revoke app access quickly.

### Mistake 7 — Assuming Logout Is Simple

Logout spans app session, IdP session, tokens, broker sessions, and downstream services.

### Mistake 8 — Not Testing Provider Differences

Keycloak, Entra, Okta, Auth0, Ping, and custom IdPs differ in claims, groups, logout, and token behavior.

### Mistake 9 — Trusting Gateway Headers Without Boundary Control

Identity headers are safe only if caller cannot spoof them.

### Mistake 10 — Losing Audit Lineage During Migration

If internal user ID changes during IdP migration, historical audit becomes fragmented.

---

## 26. Design Questions

When designing IdP integration, ask:

1. Who is the identity authority?
2. Is IdP also the authorization authority?
3. Which protocol is used: OIDC, OAuth2, SAML, LDAP, Kerberos, mTLS?
4. What is the stable external identity key?
5. Is `sub` pairwise or public?
6. Is email verified?
7. Can email change?
8. Is user JIT-provisioned or pre-provisioned?
9. What happens on first login?
10. What happens if external identity conflicts with existing account?
11. How are roles mapped?
12. Are groups emitted in token or fetched separately?
13. How are high-privilege roles approved?
14. What happens if IdP is down?
15. What happens if JWKS endpoint is down?
16. What happens if IdP rotates key?
17. What happens if user is disabled at IdP?
18. How quickly must app access be revoked?
19. How is session role staleness handled?
20. How is logout coordinated?
21. How are authentication events logged?
22. How is privacy protected in logs?
23. How will provider migration be done?
24. What is rollback plan?
25. What is the break-glass policy?

---

## 27. Practical Reference Architecture

### 27.1 Enterprise Java Web App with OIDC

```text
Browser
  |
  | 1. Access app
  v
Java Web App / BFF
  |
  | 2. Redirect to IdP authorization endpoint
  v
Identity Provider
  |
  | 3. User authenticates + MFA
  v
Java Web App callback
  |
  | 4. Validate ID token: iss/aud/nonce/exp/signature
  | 5. Normalize claims
  | 6. Resolve external identity
  | 7. Load app user and role mappings
  | 8. Create local session
  v
Browser receives HttpOnly session cookie
```

### 27.2 Resource Server with External IdP

```text
API Client
  |
  | Bearer access token
  v
Java Resource Server
  |
  | Validate JWT or introspect opaque token
  | Check issuer/audience/scope
  | Normalize service/user identity
  | Map to app permissions
  v
Business API
```

### 27.3 Brokered Identity

```text
Browser
  -> Java App
  -> Keycloak broker
  -> External Corporate IdP
  -> Keycloak local subject
  -> Java App receives Keycloak token
  -> App maps Keycloak subject to internal user
```

Audit should preserve:

```text
app_user_id
broker issuer + subject
upstream provider + upstream subject if available
```

---

## 28. Java Version Notes

### Java 8

- No records.
- Use immutable classes for normalized identity.
- Legacy app servers and SAML integrations common.
- JKS still widely found.
- Be careful with old libraries and XML security.

### Java 11

- `HttpClient` available for IdP metadata/UserInfo/introspection clients.
- Better TLS defaults than older runtimes.
- Common baseline for modern enterprise apps.

### Java 17

- Common Spring Boot 3 migration target historically.
- Stronger ecosystem baseline.
- Records available for identity DTOs.

### Java 21

- Virtual threads affect context propagation assumptions.
- Be explicit with SecurityContext handling.
- Good LTS target for modern auth services.

### Java 25

- Newer crypto/key material APIs are increasingly relevant.
- Be careful to distinguish language/runtime feature from protocol correctness.
- Authentication correctness still depends on issuer/audience/token/session design, not just JDK version.

---

## 29. Summary

Identity Provider integration is not just adding OIDC/SAML config to a Java framework.

It is a trust-boundary design problem.

A production-grade Java application must explicitly model:

1. Provider.
2. Issuer.
3. Subject.
4. Tenant.
5. External identity.
6. Internal user.
7. Claim normalization.
8. First-login behavior.
9. Account linking.
10. Role/group mapping.
11. Attribute synchronization.
12. Deprovisioning.
13. Logout.
14. IdP outage.
15. Migration.
16. Audit.

The most important invariant:

```text
Application identity must be stable even when authentication provider changes.
```

That usually means:

```text
internal_user.id is the application anchor
external_identity(provider, issuer, subject) is a login binding
claims are inputs, not the domain identity itself
roles are mapped explicitly, not blindly trusted
```

Top 1% engineering mindset:

> Treat IdP integration as a distributed identity consistency problem with security, lifecycle, and audit constraints.

---

## 30. References

- OpenID Connect Core 1.0, OpenID Foundation: https://openid.net/specs/openid-connect-core-1_0.html
- OAuth 2.0 Authorization Framework, RFC 6749: https://datatracker.ietf.org/doc/html/rfc6749
- OAuth 2.0 Security Best Current Practice, RFC 9700: https://datatracker.ietf.org/doc/html/rfc9700
- OAuth 2.0 Token Introspection, RFC 7662: https://datatracker.ietf.org/doc/html/rfc7662
- OAuth 2.0 Token Revocation, RFC 7009: https://datatracker.ietf.org/doc/html/rfc7009
- Spring Security OAuth2 Login Reference: https://docs.spring.io/spring-security/reference/servlet/oauth2/login/index.html
- Spring Security OAuth2 Resource Server Reference: https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html
- Spring Security OAuth2 Client Reference: https://docs.spring.io/spring-security/reference/servlet/oauth2/client/index.html
- Keycloak Server Administration Guide, Identity Brokering and First Login Flow: https://www.keycloak.org/docs/latest/server_admin/index.html
- Microsoft Identity Platform OIDC documentation: https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc
- Microsoft Identity Platform ID token claims reference: https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference
- Jakarta Security Specification: https://jakarta.ee/specifications/security/
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP JSON Web Token for Java Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

---

## Status Series

- Part 0 selesai — Orientation: Mental Model of Authentication in Java Systems.
- Part 1 selesai — Java Runtime Security Foundations.
- Part 2 selesai — Authentication Taxonomy.
- Part 3 selesai — Password Authentication Done Properly.
- Part 4 selesai — Session-Based Authentication.
- Part 5 selesai — Servlet Container Authentication.
- Part 6 selesai — Jakarta Security and Jakarta Authentication Deep Dive.
- Part 7 selesai — Spring Security Authentication Architecture.
- Part 8 selesai — Authentication Context Propagation.
- Part 9 selesai — API Key Authentication.
- Part 10 selesai — HMAC Request Signing.
- Part 11 selesai — JWT Authentication.
- Part 12 selesai — Opaque Token and Token Introspection.
- Part 13 selesai — OAuth 2.0 for Java Engineers.
- Part 14 selesai — OpenID Connect.
- Part 15 selesai — Authorization Code + PKCE.
- Part 16 selesai — Client Credentials and Machine-to-Machine Authentication.
- Part 17 selesai — SAML 2.0 Authentication.
- Part 18 selesai — LDAP, Active Directory, Kerberos.
- Part 19 selesai — Mutual TLS Authentication.
- Part 20 selesai — Passkeys, WebAuthn, FIDO2.
- Part 21 selesai — Multi-Factor Authentication and Step-Up Authentication.
- Part 22 selesai — Authentication for Mobile, Desktop, CLI, and Device Clients.
- Part 23 selesai — Token Lifecycle Engineering.
- Part 24 selesai — Key Management for Authentication Systems.
- Part 25 selesai — Identity Provider Integration Patterns.
- Series belum selesai.
- Berikutnya: Part 26 — Multi-Tenant Authentication Architecture.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-024.md">⬅️ Part 24 — Key Management for Authentication Systems in Java 8–25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-026.md">Part 26 — Multi-Tenant Authentication Architecture ➡️</a>
</div>
