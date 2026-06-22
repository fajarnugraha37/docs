# Part 31 — Interoperability with Spring Security, Keycloak, MicroProfile JWT, and Modern IdPs

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-31-interoperability-spring-security-keycloak-microprofile-jwt-idp.md`  
> Target: Java 8 sampai Java 25, Java EE/Jakarta EE, Servlet/JAX-RS/CDI/EJB, Spring Security, Keycloak, MicroProfile JWT, OIDC/OAuth2/SAML-style IdP  
> Fokus: bagaimana membuat beberapa security stack bekerja bersama tanpa konflik, tanpa identity drift, tanpa role mapping rapuh, dan tanpa authorization bypass.

---

## 1. Tujuan Bagian Ini

Pada part sebelumnya kita sudah membangun mental model dari bawah:

1. identity vocabulary,
2. container security,
3. Servlet security,
4. Jakarta Security API,
5. Jakarta Authentication/JASPIC,
6. Jakarta Authorization/JACC,
7. session/token/OIDC/OAuth2/SAML/mTLS,
8. domain authorization,
9. testing,
10. migrasi `javax` ke `jakarta`.

Part ini menjawab pertanyaan yang sangat sering muncul di sistem nyata:

> “Kalau aplikasi saya memakai Jakarta EE, Spring Security, Keycloak, MicroProfile JWT, API Gateway, dan modern IdP sekaligus, siapa yang seharusnya bertanggung jawab atas authentication dan authorization?”

Jawaban pendeknya:

> Tidak semua layer boleh menjadi security authority utama pada saat yang sama.

Jawaban panjangnya adalah isi part ini.

---

## 2. Problem Interoperability: Bukan Kurang Library, Tapi Terlalu Banyak Authority

Di aplikasi enterprise Java modern, security sering terdiri dari banyak komponen:

```text
Browser / SPA
   |
   | OIDC redirect / session cookie / bearer token
   v
API Gateway / Reverse Proxy / Ingress
   |
   | forwarded headers / validated token / mTLS / route policy
   v
Servlet Container / Jakarta Runtime
   |
   | request, session, principal, roles
   v
Jakarta Security / Jakarta Authentication / Jakarta Authorization
   |
   | SecurityContext, IdentityStore, HttpAuthenticationMechanism, policy
   v
JAX-RS / CDI / EJB / Application Service
   |
   | method security, domain authorization
   v
Database / External APIs / Message Broker
```

Jika aplikasi memakai Spring Boot atau Spring Security, gambarnya bisa menjadi:

```text
Browser / SPA
   |
   v
Spring Security FilterChain
   |
   | Authentication object, SecurityContextHolder, GrantedAuthority
   v
Controller / Service / Repository
```

Jika memakai MicroProfile JWT:

```text
Bearer JWT
   |
   v
MP-JWT implementation in Jakarta/MicroProfile runtime
   |
   | JsonWebToken, groups claim, @RolesAllowed
   v
JAX-RS resource / CDI bean
```

Jika memakai Keycloak:

```text
Keycloak
   |
   | OIDC/OAuth2/SAML token/session/claims/groups/roles
   v
Application / Gateway / Adapter / Library
```

Masalah muncul saat semua layer ini sama-sama merasa berwenang:

```text
Gateway validates token.
Spring Security validates token again.
Jakarta Security establishes principal separately.
MicroProfile JWT maps groups to @RolesAllowed.
Application has custom UserContext.
Database has its own role table.
Frontend hides menu using another role mapping.
```

Akibatnya:

1. user terlihat login di satu layer, tetapi anonymous di layer lain;
2. `@RolesAllowed` gagal karena role yang ada di token tidak sama dengan role container;
3. gateway mengizinkan request, tetapi aplikasi menolak;
4. aplikasi mengizinkan request, tetapi gateway menolak;
5. logout hanya menghapus local session, tetapi token masih hidup;
6. group berubah di IdP, tetapi session/cache masih menyimpan role lama;
7. satu endpoint memakai Spring Security, endpoint lain memakai Jakarta Security, hasilnya tidak konsisten;
8. audit actor berbeda antara gateway, application log, dan database audit.

Mental model utamanya:

> Interoperability bukan tentang “cara memasang banyak security library”. Interoperability adalah desain authority boundary: siapa melakukan authentication, siapa menetapkan principal, siapa memetakan role, siapa membuat authorization decision, siapa menulis audit, dan siapa menjadi source of truth.

---

## 3. Peta Komponen

### 3.1 Jakarta Security

Jakarta Security adalah API developer-facing untuk aplikasi Jakarta EE modern.

Komponen penting:

1. `SecurityContext`
2. `HttpAuthenticationMechanism`
3. `IdentityStore`
4. `Credential`
5. `CredentialValidationResult`
6. built-in authentication mechanism seperti Basic, Form, Custom Form, OpenID Connect
7. integrasi CDI

Cocok untuk:

1. aplikasi Jakarta EE yang ingin authentication container-friendly;
2. aplikasi WAR di application server seperti Payara/Open Liberty/WildFly/TomEE yang mendukung Jakarta Security;
3. login OIDC berbasis Jakarta Security;
4. custom authentication mechanism yang tetap ingin mengisi caller principal dan groups ke container.

Kurang cocok jika:

1. aplikasi adalah Spring Boot dengan Spring Security penuh;
2. semua security sudah dikelola gateway dan aplikasi hanya menerima signed internal identity;
3. runtime tidak mendukung Jakarta Security dengan lengkap;
4. kebutuhan authorization sangat framework-specific di Spring method security.

---

### 3.2 Jakarta Authentication / JASPIC

Jakarta Authentication adalah SPI low-level.

Dipakai saat perlu menulis mekanisme authentication container-level yang lebih rendah daripada Jakarta Security.

Cocok untuk:

1. custom container authentication module;
2. integrasi legacy SSO;
3. gateway identity header yang harus masuk ke container principal;
4. mekanisme auth khusus yang harus dipahami Servlet/EJB/JAX-RS container.

Tidak cocok untuk application code umum karena terlalu rendah dan vendor support bisa berbeda.

---

### 3.3 Jakarta Authorization / JACC

Jakarta Authorization adalah SPI authorization container-level berbasis subject/permission.

Cocok untuk:

1. custom policy provider di container;
2. integrasi enterprise policy engine;
3. audit dan enforcement authorization container;
4. transformasi security constraint ke permission model.

Namun sebagian besar aplikasi modern tidak perlu langsung mengimplementasikan JACC kecuali punya kebutuhan container-level policy yang kuat.

---

### 3.4 MicroProfile JWT

MicroProfile JWT adalah spesifikasi untuk authentication/authorization berbasis JWT di microservice/JAX-RS environment.

Karakter utamanya:

1. menerima signed JWT dari trusted issuer;
2. memverifikasi token;
3. mengekspos claims melalui `JsonWebToken`;
4. mapping claim `groups` ke role untuk `@RolesAllowed`;
5. cocok untuk resource server stateless.

Sangat cocok untuk:

1. JAX-RS API;
2. microservice yang menerima bearer token;
3. aplikasi yang tidak butuh browser login/session sendiri;
4. container yang mendukung MicroProfile.

Kurang cocok untuk:

1. server-side web app dengan form/OIDC login session;
2. authorization domain kompleks kalau hanya mengandalkan `groups`;
3. token dari banyak issuer dengan mapping berbeda tanpa adapter layer.

---

### 3.5 Spring Security

Spring Security adalah framework security sangat lengkap di ekosistem Spring.

Konsep utamanya:

1. `SecurityFilterChain`
2. `SecurityContextHolder`
3. `Authentication`
4. `GrantedAuthority`
5. `UserDetailsService`
6. OAuth2 Login
7. OAuth2 Resource Server
8. method security
9. CSRF/CORS/session management

Cocok untuk:

1. Spring Boot apps;
2. servlet applications yang dikendalikan oleh Spring MVC;
3. OAuth2 login/resource server;
4. aplikasi yang butuh ekosistem Spring lengkap;
5. fine-grained method security dengan SpEL/custom authorization manager.

Risiko jika dicampur sembarangan dengan Jakarta Security:

1. dua filter chain authentication;
2. dua security context;
3. dua role model;
4. session principal Spring tidak sama dengan container principal;
5. `request.getUserPrincipal()` berbeda dari `SecurityContextHolder.getContext().getAuthentication()`;
6. `@RolesAllowed` Jakarta tidak sama dengan `@PreAuthorize` Spring.

---

### 3.6 Keycloak

Keycloak adalah identity provider / authorization server / federation broker.

Fungsi umum:

1. OIDC provider;
2. OAuth2 authorization server;
3. SAML IdP/SP broker;
4. user federation;
5. realm role/client role;
6. group management;
7. identity brokering;
8. token issuance;
9. single sign-on;
10. logout/session management;
11. admin APIs.

Keycloak sebaiknya dilihat sebagai:

```text
Identity and token authority,
bukan otomatis application authorization authority.
```

Keycloak bisa menyimpan role, group, dan claim, tetapi aplikasi tetap harus memutuskan:

1. role mana yang valid untuk aplikasi;
2. role mana yang hanya IdP-level;
3. role mana yang tenant-scoped;
4. scope mana yang hanya API access;
5. permission domain apa yang harus dihitung dari database state;
6. kapan role perlu disnapshot ke session;
7. kapan role harus direfresh.

---

## 4. Authority Boundary: Pertanyaan Desain yang Harus Dijawab

Sebelum memilih stack, jawab pertanyaan ini.

### 4.1 Siapa melakukan authentication?

Kemungkinan:

1. Jakarta Security OIDC;
2. Spring Security OAuth2 Login;
3. MicroProfile JWT;
4. API Gateway;
5. Keycloak adapter/library;
6. reverse proxy SSO;
7. custom Jakarta Authentication module;
8. custom Servlet filter.

Rule:

> Dalam satu request path, sebaiknya hanya ada satu authentication authority utama.

Boleh ada defense-in-depth, tetapi harus jelas mana yang final.

---

### 4.2 Siapa menetapkan application principal?

Principal application sebaiknya bukan raw token subject tanpa mapping.

Raw token:

```json
{
  "iss": "https://idp.example.com/realms/gov",
  "sub": "f3a5...",
  "preferred_username": "fajar",
  "email": "fajar@example.com"
}
```

Application principal yang lebih stabil:

```java
public record ApplicationPrincipal(
    String actorId,
    String externalIssuer,
    String externalSubject,
    String username,
    String displayName,
    Set<String> applicationRoles,
    Set<String> activeTenantIds
) implements Principal {
    @Override
    public String getName() {
        return actorId;
    }
}
```

Rule:

> Jangan jadikan `preferred_username` atau email sebagai primary identity. Gunakan kombinasi issuer + subject untuk external identity, lalu map ke local actor id.

---

### 4.3 Siapa memetakan role?

Kemungkinan:

1. Keycloak mapper;
2. MicroProfile JWT `groups` mapping;
3. Spring Security converter;
4. Jakarta `IdentityStore`;
5. custom domain authorization service;
6. database role mapping;
7. gateway policy.

Rule:

> Role mapping boleh terjadi di beberapa layer, tetapi application role contract harus satu.

Contoh kontrak stabil:

```text
APP_CASE_VIEWER
APP_CASE_OFFICER
APP_CASE_SUPERVISOR
APP_CASE_APPROVER
APP_SYSTEM_ADMIN
APP_AUDITOR
```

Jangan biarkan business code bergantung pada:

```text
/keycloak/groups/agency-a/division-x/uat-role-approval-team-v2
```

---

### 4.4 Siapa membuat authorization decision?

Layer authorization:

1. gateway route-level access;
2. container URL constraint;
3. JAX-RS resource-level authorization;
4. CDI/EJB method-level authorization;
5. domain policy service;
6. repository/data-level tenant filter;
7. database row-level security;
8. downstream service authorization.

Rule:

> Route-level authorization bukan pengganti domain authorization.

Gateway bisa menjawab:

```text
Can this caller reach /api/cases?
```

Aplikasi harus menjawab:

```text
Can this caller approve case CASE-123 in tenant A at state PENDING_REVIEW assigned to officer B?
```

---

### 4.5 Siapa bertanggung jawab atas audit?

Minimal:

1. gateway access log;
2. application security audit;
3. domain action audit;
4. database audit jika perlu;
5. IdP login event.

Rule:

> Audit yang defensible harus mencatat actor aplikasi, bukan hanya token subject mentah.

---

## 5. Interoperability Pattern 1: Pure Jakarta Security + Keycloak OIDC

### 5.1 Arsitektur

```text
Browser
   |
   | redirect to Keycloak
   v
Keycloak
   |
   | authorization code callback
   v
Jakarta Security OpenID Connect mechanism
   |
   | establishes caller principal + groups
   v
Servlet/JAX-RS/CDI/EJB application
   |
   | SecurityContext + @RolesAllowed + domain policy
   v
Database
```

### 5.2 Cocok untuk

1. Jakarta EE application server;
2. server-side app atau BFF;
3. aplikasi ingin container-managed principal;
4. tidak memakai Spring Security;
5. ingin `SecurityContext` dan `@RolesAllowed` bekerja natural.

### 5.3 Kelebihan

1. security context konsisten dengan container;
2. annotation Jakarta bisa bekerja;
3. session handling terintegrasi dengan Servlet;
4. tidak perlu membawa Spring Security;
5. portable secara Jakarta jika container mendukung.

### 5.4 Kekurangan

1. OIDC feature mungkin tidak selengkap Spring Security;
2. behavior antar container bisa berbeda;
3. integrasi Keycloak-specific claim/role mapping tetap perlu desain;
4. untuk API stateless bearer token, MicroProfile JWT bisa lebih natural.

### 5.5 Contoh Konseptual

```java
@OpenIdAuthenticationMechanismDefinition(
    providerURI = "${oidc.providerUri}",
    clientId = "${oidc.clientId}",
    clientSecret = "${oidc.clientSecret}",
    redirectURI = "${baseURL}/callback",
    scope = {"openid", "profile", "email"}
)
@ApplicationScoped
public class SecurityConfiguration {
}
```

Di resource:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {

    @Inject
    SecurityContext securityContext;

    @GET
    @RolesAllowed("APP_CASE_VIEWER")
    public List<CaseSummary> listCases() {
        Principal principal = securityContext.getCallerPrincipal();
        return List.of();
    }
}
```

### 5.6 Hal yang Harus Didesain

1. claim mana yang menjadi caller name;
2. apakah group dari Keycloak langsung menjadi Jakarta group;
3. apakah role perlu mapping table;
4. apakah role disimpan di session;
5. bagaimana role berubah saat user sedang login;
6. bagaimana logout OIDC;
7. bagaimana audit actor id dibuat;
8. bagaimana multi-tenant membership dimuat.

---

## 6. Interoperability Pattern 2: MicroProfile JWT + Keycloak untuk JAX-RS API

### 6.1 Arsitektur

```text
Client / SPA / service
   |
   | Authorization: Bearer access_token
   v
JAX-RS application on MicroProfile runtime
   |
   | validates JWT
   | maps groups claim to roles
   v
@RolesAllowed / JsonWebToken / domain authorization
```

### 6.2 Cocok untuk

1. stateless REST API;
2. microservice;
3. service yang menerima access token;
4. tidak butuh server-side login session;
5. runtime mendukung MicroProfile JWT.

### 6.3 Kelebihan

1. simpel untuk resource server;
2. cocok dengan `@RolesAllowed`;
3. token claims bisa diinjeksi;
4. tidak perlu session;
5. baik untuk microservice boundary.

### 6.4 Kekurangan

1. authorization sering berhenti di `groups`;
2. refresh token tidak seharusnya masuk ke API;
3. logout tidak otomatis mencabut JWT yang sudah issued;
4. token claim bisa stale sampai expiry;
5. multi-tenant mapping perlu desain ekstra.

### 6.5 Contoh

```java
@Path("/reports")
@RequestScoped
public class ReportResource {

    @Inject
    JsonWebToken jwt;

    @GET
    @RolesAllowed("APP_REPORT_VIEWER")
    public Response listReports() {
        String subject = jwt.getSubject();
        Set<String> groups = jwt.getGroups();
        return Response.ok().build();
    }
}
```

### 6.6 Mapping `groups`

MP-JWT punya convention bahwa JWT `groups` claim dapat dipakai untuk role check.

Contoh token:

```json
{
  "iss": "https://keycloak.example.com/realms/aceas",
  "sub": "dfd4f2...",
  "aud": "case-api",
  "groups": [
    "APP_CASE_VIEWER",
    "APP_CASE_OFFICER"
  ],
  "exp": 1730000000
}
```

Lalu:

```java
@RolesAllowed("APP_CASE_OFFICER")
```

bisa match.

Namun hati-hati:

> `groups` adalah input authorization, bukan keseluruhan authorization.

Untuk case management:

```text
groups contains APP_CASE_APPROVER
```

belum cukup untuk approve case tertentu.

Masih harus dicek:

```text
case.tenant == activeTenant
case.state == PENDING_APPROVAL
actor != maker
actor has assignment/delegation
case is not locked by another transaction
```

---

## 7. Interoperability Pattern 3: Spring Security + Keycloak

### 7.1 Arsitektur OAuth2 Login

```text
Browser
   |
   | redirect
   v
Keycloak
   |
   | authorization code
   v
Spring Security OAuth2 Login
   |
   | Authentication in SecurityContextHolder
   v
Spring MVC / Service / Repository
```

### 7.2 Arsitektur Resource Server

```text
Client
   |
   | Bearer token
   v
Spring Security Resource Server
   |
   | validates JWT or introspects opaque token
   v
Controller / Method Security
```

### 7.3 Cocok untuk

1. Spring Boot app;
2. Spring MVC/REST API;
3. aplikasi yang ingin memakai `SecurityFilterChain`;
4. method security Spring;
5. OAuth2/OIDC feature lengkap;
6. ekosistem Spring observability/testing.

### 7.4 Hindari Campuran Ini

Jangan lakukan ini tanpa alasan kuat:

```text
Spring Security authenticates user
Jakarta Security also authenticates same request
MicroProfile JWT also validates same token
Custom Servlet filter also sets principal
```

Karena bisa menghasilkan:

```text
Spring Authentication = fajar with ROLE_ADMIN
Servlet Principal     = anonymous
Jakarta Security      = null caller
JAX-RS SecurityContext = another principal
Audit actor           = user from header
```

### 7.5 Bridge Jika Harus Menjalankan Spring di Jakarta Container

Kadang aplikasi Spring MVC deploy sebagai WAR ke application server.

Dalam kondisi ini, pilih salah satu:

#### Opsi A — Spring Security authority utama

```text
Container hanya menjalankan Servlet.
Spring Security mengurus authn/authz.
Application code memakai Spring SecurityContextHolder.
Jakarta @RolesAllowed tidak menjadi mekanisme utama.
```

#### Opsi B — Container/Jakarta authority utama

```text
Container/Jakarta Security mengurus authn.
Spring code membaca request principal/container principal.
Spring Security tidak membuat login chain independen.
```

Opsi B biasanya lebih jarang dan lebih tricky.

Rule praktis:

> Untuk Spring Boot, gunakan Spring Security sebagai primary security framework. Untuk Jakarta EE murni, gunakan Jakarta Security/MicroProfile JWT/container security sebagai primary framework.

---

## 8. Interoperability Pattern 4: Gateway-Validated Token + Application Trusts Signed Internal Identity

### 8.1 Arsitektur

```text
Client
   |
   | external token
   v
API Gateway
   |
   | validates issuer/audience/signature/scope
   | maps to internal identity
   | signs internal identity header/token
   v
Jakarta/Spring application
   |
   | validates gateway signature/mTLS
   | establishes local actor
   v
Domain authorization
```

### 8.2 Cocok untuk

1. banyak aplikasi dengan central gateway;
2. token validation policy terpusat;
3. service mesh/gateway architecture;
4. aplikasi legacy yang sulit memvalidasi OIDC langsung;
5. zero-trust internal identity propagation dengan signed assertion.

### 8.3 Bahaya

Pola buruk:

```text
Gateway adds X-User: fajar
Application trusts X-User blindly
```

Masalah:

1. header bisa di-spoof jika app reachable langsung;
2. tidak ada expiry;
3. tidak ada issuer;
4. tidak ada signature;
5. tidak ada audience;
6. tidak ada tenant binding;
7. sulit audit;
8. tidak bisa membedakan gateway resmi vs attacker.

### 8.4 Pola Lebih Aman

Gunakan salah satu atau kombinasi:

1. mTLS gateway → app;
2. network policy agar app tidak bisa diakses langsung;
3. strip inbound identity headers di gateway;
4. signed internal JWT;
5. short expiry;
6. audience internal app;
7. issuer gateway;
8. correlation ID;
9. explicit claim mapping;
10. application still validates internal assertion.

Internal assertion contoh:

```json
{
  "iss": "internal-gateway",
  "aud": "case-service",
  "sub": "actor-12345",
  "external_iss": "https://keycloak.example.com/realms/aceas",
  "external_sub": "dfd4f2...",
  "roles": ["APP_CASE_VIEWER"],
  "tenant_ids": ["CEA"],
  "iat": 1730000000,
  "exp": 1730000060,
  "jti": "..."
}
```

---

## 9. Interoperability Pattern 5: Keycloak as Broker for Multiple IdPs

### 9.1 Arsitektur

```text
External IdP A / IdP B / SAML IdP / Social IdP
       |
       v
Keycloak as broker
       |
       | normalized OIDC token
       v
Application
```

### 9.2 Kelebihan

1. aplikasi hanya integrasi ke satu OIDC provider;
2. federasi eksternal disembunyikan;
3. claim normalization dilakukan di Keycloak;
4. account linking bisa dikelola di satu tempat;
5. multi-IdP lebih manageable.

### 9.3 Risiko

1. aplikasi lupa bahwa external issuer berbeda;
2. account linking salah;
3. duplicate identity;
4. group mapping dari beberapa IdP tabrakan;
5. IdP assurance level berbeda;
6. logout lintas IdP tidak konsisten.

### 9.4 Invariant

Aplikasi harus menyimpan:

```text
local_actor_id
broker_issuer
broker_subject
external_issuer(optional)
external_subject(optional)
identity_assurance(optional)
```

Jangan hanya menyimpan username.

---

## 10. Role Model: Keycloak Realm Role, Client Role, Group, Scope, Jakarta Role, Spring Authority

### 10.1 Keycloak Realm Role

Realm role berlaku di level realm.

Contoh:

```text
realm-role: offline_access
realm-role: uma_authorization
realm-role: agency-admin
```

Bahaya jika langsung dipakai aplikasi:

1. terlalu global;
2. bisa dipakai banyak client;
3. sulit tahu role untuk aplikasi mana;
4. role governance kabur.

---

### 10.2 Keycloak Client Role

Client role lebih dekat ke aplikasi tertentu.

Contoh:

```text
client: aceas-case-api
role: case-viewer
role: case-approver
```

Lebih baik dibanding realm role untuk application-specific role.

Tetapi tetap harus dinormalisasi:

```text
case-viewer -> APP_CASE_VIEWER
case-approver -> APP_CASE_APPROVER
```

---

### 10.3 Keycloak Group

Group biasanya merepresentasikan organisasi/hierarki.

Contoh:

```text
/CEA/Enforcement/Officers
/CEA/Finance/Approvers
/ExternalAgency/ReadOnlyUsers
```

Group bagus untuk administration, tetapi buruk jika business code langsung bergantung pada path group.

Group path bisa berubah karena reorganisasi.

---

### 10.4 OAuth Scope

Scope adalah delegated access grant.

Contoh:

```text
case.read
case.write
profile
email
openid
```

Scope bagus untuk API access, terutama client/service authorization.

Tetapi scope bukan otomatis user role.

Misalnya:

```text
scope case.write
```

bisa berarti client boleh memanggil write API, bukan user boleh approve semua case.

---

### 10.5 Jakarta Role / Group

Dalam Jakarta API, role check biasanya melihat role/group yang established pada container identity.

Contoh:

```java
@RolesAllowed("APP_CASE_VIEWER")
```

atau:

```java
securityContext.isCallerInRole("APP_CASE_VIEWER")
```

---

### 10.6 Spring GrantedAuthority

Spring memakai `GrantedAuthority`, sering dengan prefix `ROLE_`.

Contoh:

```text
ROLE_APP_CASE_VIEWER
SCOPE_case.read
```

Dalam Spring, role dan authority punya convention yang perlu dipahami:

1. `hasRole("ADMIN")` biasanya mencari `ROLE_ADMIN`;
2. `hasAuthority("APP_CASE_VIEWER")` mencari authority literal;
3. resource server sering memetakan scope menjadi `SCOPE_xxx`.

### 10.7 Mapping Table

| Source | Raw Value | Application Meaning | Final Contract |
|---|---|---|---|
| Keycloak client role | `case-viewer` | boleh melihat case | `APP_CASE_VIEWER` |
| Keycloak group | `/CEA/Enforcement/Officer` | officer CEA | `APP_CASE_OFFICER`, tenant `CEA` |
| JWT scope | `case.read` | client boleh read case API | `API_CASE_READ` atau `SCOPE_case.read` |
| MP-JWT groups | `APP_CASE_VIEWER` | role aplikasi | `@RolesAllowed("APP_CASE_VIEWER")` |
| Spring authority | `ROLE_APP_CASE_VIEWER` | role Spring | normalize ke domain permission |

---

## 11. Decision Matrix: Pilih Stack Berdasarkan Tipe Aplikasi

| Tipe Aplikasi | Primary Stack yang Disarankan | Catatan |
|---|---|---|
| Jakarta EE server-side web app | Jakarta Security OIDC + Servlet session | baik untuk container-managed identity |
| Jakarta EE REST API stateless | MicroProfile JWT atau Jakarta Security bearer mechanism | pilih berdasarkan runtime support |
| Spring Boot web app | Spring Security OAuth2 Login | jangan campur dengan Jakarta Security login |
| Spring Boot REST API | Spring Security Resource Server | map JWT claims ke authorities |
| Legacy WAR di app server | Container auth / Jakarta Security / JASPIC | hindari double filter chain |
| API di balik gateway | Gateway validates + app validates internal assertion | jangan percaya raw headers |
| Multi-IdP enterprise | Keycloak broker + application role mapping | simpan issuer + subject |
| Case/workflow domain | Any authn stack + custom domain authorization service | role saja tidak cukup |

---

## 12. Anti-Pattern Interoperability

### 12.1 Double Authentication Without Contract

```text
Gateway validates token.
Spring validates token.
Jakarta Security validates token.
Custom filter validates token.
```

Bukan selalu salah, tetapi salah jika:

1. masing-masing punya role mapping berbeda;
2. error semantics berbeda;
3. audit actor berbeda;
4. logout/session behavior berbeda;
5. tidak jelas layer mana final.

---

### 12.2 Raw IdP Role in Business Code

Buruk:

```java
if (securityContext.isCallerInRole("/CEA/Enforcement/Approvers")) {
    approve(caseId);
}
```

Lebih baik:

```java
if (authorizationService.can(actor, APPROVE_CASE, caseId)) {
    approve(caseId);
}
```

Role mapping raw → app role dilakukan di boundary.

---

### 12.3 ID Token Used as API Access Token

Buruk:

```text
SPA sends ID token to API.
API uses it as authorization token.
```

ID token dibuat untuk client/relying party sebagai bukti authentication user.

API resource server sebaiknya menerima access token dengan audience API yang benar.

---

### 12.4 Frontend Role Check as Authorization

Buruk:

```text
Frontend hides Approve button if user lacks role.
Backend does not check approve permission.
```

Frontend role check hanya UX optimization.

Backend tetap harus enforce.

---

### 12.5 Universal Admin

Buruk:

```text
ROLE_ADMIN bypasses all checks everywhere.
```

Masalah:

1. audit sulit;
2. segregation of duties rusak;
3. tenant isolation bypass;
4. emergency access menjadi permanen;
5. blast radius besar.

Lebih baik:

1. admin capability dibatasi;
2. break-glass flow audited;
3. tenant-aware admin;
4. action-specific permission;
5. reason required;
6. expiry.

---

### 12.6 Trusting Gateway Headers Without Direct Access Control

Buruk:

```java
String user = request.getHeader("X-User");
```

Tanpa:

1. mTLS;
2. signature;
3. header stripping;
4. network isolation;
5. issuer/audience/expiry;
6. app validation.

---

### 12.7 Role Prefix Drift

Spring:

```text
ROLE_ADMIN
```

Jakarta:

```text
ADMIN
```

MP-JWT:

```json
"groups": ["admin"]
```

Keycloak:

```text
admin
```

Akhirnya `@RolesAllowed("ADMIN")` tidak pernah match.

Solusi:

1. canonical role constant;
2. mapper test;
3. integration test token sample;
4. avoid magic strings;
5. document prefix rules.

---

## 13. Canonical Security Contract

Agar interoperability sehat, buat kontrak internal.

### 13.1 Actor Contract

```java
public record Actor(
    String actorId,
    String displayName,
    String externalIssuer,
    String externalSubject,
    Set<String> roles,
    Set<String> tenantIds,
    String activeTenantId,
    AuthenticationAssurance assurance,
    boolean serviceAccount
) {}
```

### 13.2 Role Contract

```java
public final class AppRoles {
    public static final String CASE_VIEWER = "APP_CASE_VIEWER";
    public static final String CASE_OFFICER = "APP_CASE_OFFICER";
    public static final String CASE_APPROVER = "APP_CASE_APPROVER";
    public static final String CASE_SUPERVISOR = "APP_CASE_SUPERVISOR";
    public static final String SYSTEM_ADMIN = "APP_SYSTEM_ADMIN";
    public static final String AUDITOR = "APP_AUDITOR";

    private AppRoles() {}
}
```

### 13.3 Permission Contract

```java
public enum Permission {
    CASE_VIEW,
    CASE_CREATE,
    CASE_UPDATE,
    CASE_ASSIGN,
    CASE_APPROVE,
    CASE_REJECT,
    CASE_ESCALATE,
    CASE_REOPEN,
    AUDIT_VIEW
}
```

### 13.4 Identity Mapping Contract

```java
public interface ExternalIdentityMapper {
    Actor map(ExternalIdentity identity);
}
```

```java
public record ExternalIdentity(
    String issuer,
    String subject,
    String username,
    String email,
    Set<String> rawGroups,
    Set<String> rawRoles,
    Set<String> scopes,
    Map<String, Object> claims
) {}
```

### 13.5 Authorization Contract

```java
public interface AuthorizationService {
    AuthorizationDecision decide(Actor actor, Permission permission, ResourceRef resource);
}
```

```java
public record AuthorizationDecision(
    boolean allowed,
    String reasonCode,
    Map<String, Object> auditAttributes
) {}
```

---

## 14. Jakarta vs Spring Context Bridge

Jika benar-benar perlu bridge, pahami bahwa ini advanced dan harus dihindari jika tidak perlu.

### 14.1 Dari Spring Authentication ke Domain Actor

```java
@Component
public class SpringActorResolver {

    public Actor currentActor() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        if (authentication == null || !authentication.isAuthenticated()) {
            throw new UnauthenticatedException();
        }

        return map(authentication);
    }

    private Actor map(Authentication authentication) {
        Set<String> roles = authentication.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .map(this::normalize)
            .collect(Collectors.toUnmodifiableSet());

        return new Actor(
            authentication.getName(),
            authentication.getName(),
            "spring-security",
            authentication.getName(),
            roles,
            Set.of(),
            null,
            AuthenticationAssurance.NORMAL,
            false
        );
    }

    private String normalize(String authority) {
        if (authority.startsWith("ROLE_")) {
            return authority.substring("ROLE_".length());
        }
        return authority;
    }
}
```

### 14.2 Dari Jakarta SecurityContext ke Domain Actor

```java
@RequestScoped
public class JakartaActorResolver {

    @Inject
    SecurityContext securityContext;

    public Actor currentActor() {
        Principal principal = securityContext.getCallerPrincipal();

        if (principal == null) {
            throw new UnauthenticatedException();
        }

        Set<String> roles = AppRoleRegistry.allRoles().stream()
            .filter(securityContext::isCallerInRole)
            .collect(Collectors.toUnmodifiableSet());

        return new Actor(
            principal.getName(),
            principal.getName(),
            "jakarta-security",
            principal.getName(),
            roles,
            Set.of(),
            null,
            AuthenticationAssurance.NORMAL,
            false
        );
    }
}
```

### 14.3 Jangan Sebarkan Framework Context ke Domain

Buruk:

```java
public void approve(SecurityContext securityContext, Long caseId) { ... }
```

atau:

```java
public void approve(Authentication authentication, Long caseId) { ... }
```

Lebih baik:

```java
public void approve(Actor actor, Long caseId) { ... }
```

Framework-specific security context sebaiknya berhenti di adapter layer.

---

## 15. Keycloak Integration Design

### 15.1 Realm Design

Pertanyaan:

1. satu realm untuk semua aplikasi atau per domain besar?
2. environment DEV/UAT/PROD realm terpisah?
3. tenant menjadi realm, group, organization, atau claim?
4. client role atau realm role?
5. apakah user federation diperlukan?

Rule:

> Jangan menjadikan realm sebagai tenant jika tenant sangat banyak dan application authorization harus cross-tenant. Realm terlalu berat sebagai primitive tenancy aplikasi.

---

### 15.2 Client Design

Untuk aplikasi:

```text
aceas-web
aceas-case-api
aceas-report-api
aceas-admin-console
```

Pastikan:

1. redirect URI ketat;
2. web origins ketat;
3. public vs confidential client benar;
4. PKCE untuk public client;
5. client secret tidak masuk frontend;
6. service account dipisahkan;
7. audience token tepat.

---

### 15.3 Token Claim Design

Minimal access token untuk API:

```json
{
  "iss": "https://sso.example.com/realms/aceas",
  "sub": "external-subject",
  "aud": "case-api",
  "azp": "aceas-web",
  "exp": 1730000000,
  "iat": 1729999700,
  "scope": "openid profile case.read",
  "groups": ["APP_CASE_VIEWER"],
  "tenant_ids": ["CEA"],
  "active_tenant": "CEA"
}
```

Pertanyaan penting:

1. apakah `tenant_ids` boleh dipercaya dari token?
2. apakah tenant membership harus dicek ulang ke database?
3. berapa lama token hidup?
4. apa yang terjadi jika role dicabut?
5. apakah token audience tepat untuk API ini?

---

### 15.4 Role Mapping in Keycloak vs Application

Mapping di Keycloak cocok untuk:

1. normalisasi claim sederhana;
2. client role → token claim;
3. group → role kasar;
4. scope/audience shaping.

Mapping di aplikasi cocok untuk:

1. role yang tenant-aware;
2. domain permission;
3. workflow/state-based access;
4. delegation;
5. temporary access;
6. emergency override;
7. audit reason;
8. data ownership.

---

## 16. MicroProfile JWT vs Jakarta Security OIDC

### 16.1 Jakarta Security OIDC

Dipakai untuk login user via browser.

Flow:

```text
browser redirect -> IdP -> callback -> session established
```

State:

```text
server-side session possible
```

Cocok:

```text
web app / BFF / server-rendered app / session-oriented app
```

### 16.2 MicroProfile JWT

Dipakai untuk API menerima bearer JWT.

Flow:

```text
request with Authorization: Bearer JWT -> validate -> expose claims
```

State:

```text
stateless API
```

Cocok:

```text
JAX-RS microservice / resource server
```

### 16.3 Jangan Samakan

Jakarta Security OIDC menjawab:

```text
How does user log in to this web app?
```

MicroProfile JWT menjawab:

```text
How does this API validate a JWT access token?
```

---

## 17. Spring Security vs Jakarta Security

### 17.1 Spring Security Lebih Tepat Jika

1. aplikasi Spring Boot;
2. memakai Spring MVC/WebFlux;
3. butuh Spring AuthorizationManager/SpEL;
4. butuh tight integration dengan Spring OAuth2 client/resource server;
5. butuh ecosystem testing Spring;
6. deployment jar embedded container.

### 17.2 Jakarta Security Lebih Tepat Jika

1. aplikasi Jakarta EE murni;
2. deployment WAR/EAR di application server;
3. ingin container-managed security;
4. memakai CDI/EJB/JAX-RS standar;
5. portability Jakarta penting;
6. tidak ingin membawa Spring Security.

### 17.3 Campuran yang Masuk Akal

1. Spring Boot app memanggil Jakarta EE service via token;
2. Jakarta EE app memakai Keycloak yang juga dipakai Spring apps;
3. gateway melakukan coarse validation, app melakukan domain authorization;
4. shared role contract dan shared token claim schema;
5. separate services dengan framework berbeda tetapi token/audit contract sama.

### 17.4 Campuran yang Tidak Sehat

1. satu WAR memakai Spring Security dan Jakarta Security untuk endpoint sama;
2. dua session authority;
3. dua logout mechanism independen;
4. `@PreAuthorize` dan `@RolesAllowed` dipakai campur tanpa mapping test;
5. request principal berbeda dengan Spring authentication;
6. audit membaca identity dari layer berbeda-beda.

---

## 18. Modern IdP: Entra ID, Okta, Auth0-like, Government IdP, Corporate SSO

Walau implementasi berbeda, aplikasi harus memperlakukan semua IdP dengan pola yang sama:

```text
External IdP emits identity assertions.
Application validates assertion.
Application maps external identity to local actor.
Application computes domain authorization.
Application audits using local actor + external identity reference.
```

### 18.1 Variasi yang Harus Diantisipasi

1. claim name berbeda;
2. group claim terlalu besar;
3. group overage claim;
4. opaque token;
5. JWT access token;
6. SAML assertion;
7. pairwise subject;
8. rotating signing key;
9. conditional access/MFA claim;
10. tenant ID claim;
11. app role claim;
12. scope claim.

### 18.2 Mapping Adapter Per IdP

Buat adapter:

```java
public interface IdentityProviderClaimMapper {
    boolean supports(String issuer);
    ExternalIdentity map(TokenClaims claims);
}
```

Implementasi:

```text
KeycloakClaimMapper
EntraClaimMapper
OktaClaimMapper
GovernmentIdpClaimMapper
SamlBrokerClaimMapper
```

Jangan sebar claim-specific logic ke semua service.

---

## 19. Logout Interoperability

Logout sering gagal karena tiap layer punya session sendiri.

Layer yang mungkin punya state:

1. browser cookie app;
2. Jakarta `HttpSession`;
3. Spring session;
4. Keycloak SSO session;
5. IdP upstream session;
6. refresh token;
7. gateway session;
8. distributed cache;
9. WebSocket connection;
10. SPA memory state.

### 19.1 Local Logout

```text
Invalidate application session only.
```

Tidak otomatis logout dari IdP.

### 19.2 RP-Initiated Logout

```text
Application redirects user to IdP logout endpoint.
```

### 19.3 Front-Channel Logout

```text
IdP notifies browser-based clients through iframe/redirect style mechanism.
```

### 19.4 Back-Channel Logout

```text
IdP sends server-to-server logout notification.
```

### 19.5 Resource Server Reality

Stateless API tidak punya session, jadi logout berarti:

1. token expiry pendek;
2. refresh token revocation;
3. introspection untuk opaque token;
4. denylist jika sangat diperlukan;
5. session version claim;
6. risk-based revocation.

---

## 20. Testing Interoperability

### 20.1 Test Sample Token

Simpan sample token claims sebagai fixture:

```json
{
  "iss": "https://sso.example.com/realms/aceas",
  "sub": "user-123",
  "aud": "case-api",
  "groups": ["APP_CASE_VIEWER", "APP_CASE_OFFICER"],
  "tenant_ids": ["CEA"],
  "active_tenant": "CEA",
  "exp": 4102444800
}
```

Test mapping:

```java
@Test
void mapsKeycloakGroupsToApplicationRoles() {
    ExternalIdentity identity = mapper.map(sampleClaims);
    Actor actor = actorMapper.map(identity);

    assertThat(actor.roles()).contains("APP_CASE_VIEWER");
    assertThat(actor.activeTenantId()).isEqualTo("CEA");
}
```

### 20.2 Negative Token Tests

Test wajib:

1. wrong issuer;
2. wrong audience;
3. expired token;
4. not-before in future;
5. missing subject;
6. missing required role;
7. missing tenant;
8. unsigned token;
9. `alg=none`;
10. wrong key id;
11. stale JWKS;
12. token from DEV realm to PROD API;
13. ID token used as access token.

### 20.3 Role Prefix Tests

```java
@ParameterizedTest
@ValueSource(strings = {
    "APP_CASE_VIEWER",
    "ROLE_APP_CASE_VIEWER",
    "case-viewer"
})
void roleMappingIsExplicit(String rawRole) {
    // assert mapping behavior intentionally, not accidentally
}
```

### 20.4 Cross-Framework Tests

Jika Spring dan Jakarta coexist:

1. assert `request.getUserPrincipal()` expected;
2. assert Spring `Authentication` expected;
3. assert `@RolesAllowed` behavior;
4. assert `@PreAuthorize` behavior;
5. assert audit actor same;
6. assert logout clears expected states.

---

## 21. Observability and Debugging

### 21.1 Log yang Aman

Log:

```text
correlation_id
request_id
issuer
audience
subject hash / local actor id
client_id / azp
token type
role count
tenant id
mapping version
authorization decision id
```

Jangan log:

```text
raw access token
raw ID token
refresh token
client secret
full certificate private key
password
OTP
session cookie
```

### 21.2 Debug Checklist

Jika request ditolak, cek:

1. apakah request sampai ke app?
2. apakah gateway menolak dulu?
3. apakah token valid?
4. issuer benar?
5. audience benar?
6. token expired?
7. clock skew?
8. JWKS key tersedia?
9. claim role ada?
10. role prefix sesuai?
11. `@RolesAllowed` memakai role yang sama?
12. active tenant sesuai?
13. domain policy menolak?
14. session stale?
15. principal berbeda antar layer?
16. audit actor sesuai?

---

## 22. Production Failure Scenarios

### 22.1 Key Rotation Outage

Gejala:

```text
Semua API tiba-tiba return 401.
```

Kemungkinan:

1. JWKS cache stale;
2. IdP rotated key;
3. app tidak refresh JWKS;
4. firewall block JWKS endpoint;
5. wrong realm URL.

Mitigasi:

1. cache JWKS dengan refresh strategy;
2. support multiple keys;
3. alert on unknown `kid`;
4. fail closed, but clear runbook;
5. monitor IdP metadata endpoint.

---

### 22.2 Role Mapping Drift

Gejala:

```text
User login sukses, tetapi semua menu hilang atau API 403.
```

Penyebab:

1. Keycloak role renamed;
2. group path changed;
3. mapper removed claim;
4. Spring prefix changed;
5. MP-JWT expects `groups`, token uses `roles`.

Mitigasi:

1. contract test token;
2. role mapping version;
3. deployment checklist;
4. IdP change governance;
5. monitoring denial spike.

---

### 22.3 Gateway Header Spoofing

Gejala:

```text
Attacker accesses app directly with X-User: admin.
```

Penyebab:

1. app exposed directly;
2. no mTLS;
3. no signature;
4. gateway does not strip inbound headers;
5. app trusts raw headers.

Mitigasi:

1. network isolation;
2. mTLS;
3. signed internal assertion;
4. strip headers;
5. reject request if gateway proof missing.

---

### 22.4 Logout Incomplete

Gejala:

```text
User clicks logout but can still access API in another tab.
```

Penyebab:

1. local session cleared, access token still valid;
2. SPA kept token in memory/localStorage;
3. IdP session still alive;
4. refresh token not revoked;
5. API stateless and token still unexpired.

Mitigasi:

1. short access token lifetime;
2. revoke refresh token;
3. clear app session;
4. clear SPA state;
5. implement OIDC logout if needed;
6. high-risk action requires reauth.

---

## 23. Design Blueprint

Recommended high-level architecture for mixed enterprise Java landscape:

```text
              +----------------+
              | Modern IdP     |
              | Keycloak/etc   |
              +-------+--------+
                      |
                      | OIDC/OAuth2/SAML
                      v
+---------+     +-----+------+       +-------------------+
| Browser | --> | Gateway    | ----> | Jakarta/Spring App |
+---------+     +------------+       +---------+---------+
                                             |
                                             | Actor
                                             v
                                  +----------+-----------+
                                  | Domain Authz Service |
                                  +----------+-----------+
                                             |
                                             | Decision + Audit
                                             v
                                  +----------+-----------+
                                  | Audit / DB / Events  |
                                  +----------------------+
```

Principle:

1. IdP authenticates external identity.
2. Gateway may do coarse protection.
3. Application maps external identity to local actor.
4. Framework security protects route/method boundary.
5. Domain authorization protects business action.
6. Repository/data layer protects tenant boundary.
7. Audit records actor/action/resource/decision.

---

## 24. Practical Selection Rules

Use these rules as defaults:

1. Spring Boot app → Spring Security.
2. Jakarta EE web app → Jakarta Security.
3. Jakarta REST microservice → MicroProfile JWT or Jakarta Security bearer mechanism.
4. Keycloak → identity provider, not full domain authorization engine.
5. Gateway → coarse-grained boundary, not replacement for application authorization.
6. `@RolesAllowed` → good for coarse method/resource role checks.
7. Domain authorization service → required for case/workflow/tenant/state-based decisions.
8. Raw IdP group → never use directly in core business logic.
9. ID token → do not use as API access token.
10. `issuer + subject` → stable external identity key.
11. Local actor id → stable application identity.
12. Audit → use local actor + external identity reference.
13. Logout → design all state layers explicitly.
14. Tests → verify mapping and denial, not only happy path.

---

## 25. Final Mental Model

Interoperability security yang matang memiliki bentuk seperti ini:

```text
External Identity
   -> validated by protocol layer
   -> normalized by identity mapper
   -> represented as local actor
   -> enriched with application roles/tenant memberships
   -> checked by framework boundary
   -> checked again by domain authorization
   -> enforced in repository/data access
   -> audited with decision reason
```

Bukan seperti ini:

```text
Token has admin claim -> allow everything
```

Atau:

```text
Gateway already checked -> app trusts everything
```

Atau:

```text
Spring says authenticated -> Jakarta annotations must magically work
```

Top-level engineer harus bisa melihat:

1. mana identity provider;
2. mana authentication mechanism;
3. mana principal establishment;
4. mana role mapping;
5. mana authorization enforcement;
6. mana domain policy;
7. mana audit source;
8. mana trust boundary;
9. mana state yang perlu logout/revocation;
10. mana failure yang akan terjadi saat claim berubah, key rotate, atau gateway salah konfigurasi.

---

## 26. Checklist Review Arsitektur

Sebelum production, jawab semua ini:

- [ ] Apakah primary authentication authority jelas?
- [ ] Apakah application principal stabil dan tidak bergantung pada username/email?
- [ ] Apakah `issuer + subject` disimpan?
- [ ] Apakah role mapping terdokumentasi?
- [ ] Apakah raw IdP group tidak dipakai langsung di business logic?
- [ ] Apakah token audience divalidasi?
- [ ] Apakah ID token tidak dipakai sebagai API access token?
- [ ] Apakah Spring/Jakarta/MicroProfile context tidak konflik?
- [ ] Apakah `@RolesAllowed` dan framework role prefix sudah dites?
- [ ] Apakah gateway identity header dilindungi signature/mTLS?
- [ ] Apakah direct access ke app dicegah?
- [ ] Apakah logout mencakup app session, IdP session, refresh token, dan frontend state sesuai kebutuhan?
- [ ] Apakah domain authorization tetap dilakukan di backend?
- [ ] Apakah tenant isolation diuji negatif?
- [ ] Apakah audit actor konsisten antar gateway/app/domain?
- [ ] Apakah key rotation/JWKS failure punya runbook?
- [ ] Apakah denial spike dimonitor?
- [ ] Apakah sample token contract masuk CI?

---

## 27. Ringkasan

Part ini membahas interoperability antara Jakarta Security, Spring Security, Keycloak, MicroProfile JWT, gateway, dan modern IdP.

Inti pemahamannya:

1. jangan membuat semua layer menjadi authority tanpa kontrak;
2. pilih primary authentication framework berdasarkan tipe aplikasi;
3. jadikan Keycloak/IdP sebagai identity/token authority, bukan otomatis domain authorization authority;
4. canonical role dan actor contract wajib ada;
5. framework context harus diadaptasi menjadi domain actor;
6. gateway security harus dilindungi dari header spoofing;
7. `@RolesAllowed`, Spring authority, MP-JWT `groups`, Keycloak role, dan OAuth scope tidak identik;
8. domain authorization tetap diperlukan untuk workflow, tenant, dan case-level decision;
9. audit harus memakai actor aplikasi yang stabil;
10. interoperability harus diuji dengan token/claim/role/session failure scenario.

---

## 28. Status Seri

Selesai:

```text
Part 31 — Interoperability with Spring Security, Keycloak, MicroProfile JWT, and Modern IdPs
```

Seri belum selesai.

Berikutnya:

```text
Part 32 — Production Hardening Checklist for Jakarta Security Systems
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-30-migration-javax-to-jakarta-security.md">⬅️ Part 30 — Migration Guide: Java EE `javax` Security to Jakarta `jakarta` Security</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-32-production-hardening-checklist.md">Part 32 — Production Hardening Checklist for Jakarta Security Systems ➡️</a>
</div>
