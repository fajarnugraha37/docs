# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-015

# Part 015 — Security I: Authentication, OIDC, Keycloak, JWT, Token Propagation

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Level: Advanced / production engineering  
> Fokus: Authentication runtime, OIDC, Keycloak, bearer token, JWT, service-to-service identity, token propagation, multi-tenancy, dan failure modelling di Quarkus.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 014, kita sudah membangun fondasi Quarkus dari sisi:

1. mental model Quarkus sebagai build-time optimized runtime,
2. version strategy Java/Quarkus,
3. internal architecture,
4. dev loop,
5. project/BOM governance,
6. configuration,
7. CDI/Arc,
8. REST layer,
9. blocking vs reactive,
10. Hibernate ORM,
11. Panache vs repository/domain-centric persistence,
12. Hibernate Reactive dan reactive SQL,
13. transaction engineering,
14. validation, serialization, DTO, dan API contract.

Sekarang kita masuk ke security.

Namun security di Quarkus tidak boleh dipahami sebagai:

```text
Tambahkan dependency security -> pasang annotation -> endpoint aman.
```

Itu terlalu dangkal.

Untuk sistem production, terutama enterprise, microservice, regulatory workflow, government integration, atau sistem dengan SSO, security harus dipahami sebagai **identity pipeline**:

```text
caller
  -> credential/token/session
  -> transport boundary
  -> Quarkus authentication mechanism
  -> identity resolution
  -> token verification
  -> claim normalization
  -> role/attribute extraction
  -> SecurityIdentity
  -> authorization decision
  -> audit/logging context
  -> outbound identity propagation
  -> downstream trust boundary
```

Part ini fokus pada **authentication**, bukan authorization detail. Authorization akan dibahas lebih dalam di Part 016.

---

## 1. Problem Yang Diselesaikan

Dalam Quarkus service, authentication menjawab pertanyaan:

> “Siapa caller dari request ini, dan apakah bukti identitasnya valid?”

Bukti identitas bisa berupa:

1. bearer access token,
2. ID token,
3. JWT internal,
4. opaque token,
5. session cookie hasil authorization code flow,
6. client credentials token,
7. mTLS client certificate,
8. API key,
9. kombinasi beberapa mekanisme.

Di aplikasi modern, kasus paling umum adalah:

```text
Frontend SPA / mobile / service lain
  -> mengirim Authorization: Bearer <access-token>
  -> Quarkus memvalidasi token
  -> Quarkus membentuk SecurityIdentity
  -> endpoint diproses sesuai identity dan role/claim
```

Dalam enterprise SSO, sering ada identity provider seperti Keycloak, Azure AD, Okta, Auth0, Ping, Cognito, atau IdP pemerintah.

Quarkus menyediakan extension OIDC untuk bearer token authentication, OIDC code flow, token verification, dan integrasi identity provider. Quarkus juga menyediakan SmallRye JWT untuk MicroProfile JWT-style RBAC, serta extension OIDC client/token propagation untuk mengambil, refresh, dan meneruskan token ke downstream service.

---

## 2. Mental Model Security Quarkus

### 2.1 Security di Quarkus Adalah Pipeline, Bukan Filter Tunggal

Mental model sederhana:

```text
HTTP request
  |
  v
HTTP security layer
  |
  +-- apakah ada credential?
  |
  +-- mekanisme apa yang cocok?
  |
  +-- validasi credential
  |
  +-- resolve identity
  |
  +-- build SecurityIdentity
  |
  v
REST resource / business layer
```

Authentication tidak sama dengan authorization.

| Concern | Pertanyaan | Contoh |
|---|---|---|
| Authentication | Siapa caller ini? | Token ini milik user A atau service B? |
| Token validation | Apakah bukti identitas valid? | Signature valid? Expired? Issuer benar? Audience benar? |
| Identity normalization | Bagaimana token menjadi identity internal? | Subject, username, email, groups, roles |
| Authorization | Apakah identity boleh melakukan action ini? | Boleh approve case? Boleh lihat agency X? |
| Auditability | Bagaimana keputusan ini bisa dibuktikan? | siapa, kapan, action, resource, result |
| Propagation | Identity apa yang diteruskan ke service lain? | original user token, exchanged token, service token |

Top 1% engineer tidak berhenti di “token valid”. Mereka bertanya:

1. token ini diterbitkan untuk siapa?
2. token ini dimaksudkan untuk service mana?
3. token ini boleh dipakai di boundary ini?
4. role/claim di token masih trustworthy?
5. bagaimana jika token revocation terjadi?
6. apakah downstream menerima token yang sama atau token hasil exchange?
7. apakah log/audit dapat membuktikan keputusan security?
8. apa yang terjadi ketika JWKS rotate?
9. apa yang terjadi ketika IdP down?
10. apakah service masih aman saat clock skew?

---

## 3. Authentication Modes di Quarkus

Quarkus mendukung beberapa mode security umum.

### 3.1 Bearer Token Authentication

Mode ini cocok untuk API service.

```text
Client -> Quarkus API
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

Quarkus memvalidasi access token. Biasanya token diterbitkan oleh OIDC provider.

Cocok untuk:

1. REST API backend,
2. microservice API,
3. backend-for-frontend,
4. service yang dipanggil SPA/mobile,
5. service-to-service dengan token.

Karakteristik:

- stateless di service,
- cocok untuk horizontal scaling,
- validasi token bisa lokal via JWKS,
- role/claim bisa langsung diekstrak,
- revocation tidak selalu immediate kecuali token introspection digunakan.

### 3.2 Authorization Code Flow

Mode ini cocok untuk web app yang melakukan login browser-based.

```text
Browser
  -> Quarkus web app
  -> redirect ke IdP
  -> user login
  -> redirect balik dengan code
  -> Quarkus exchange code ke token
  -> Quarkus membuat session cookie
```

Cocok untuk:

1. server-side web app,
2. Quarkus app yang langsung melayani UI,
3. BFF yang mengelola session,
4. internal admin console.

Untuk SPA modern, sering lebih umum SPA menggunakan Authorization Code + PKCE langsung ke IdP, lalu API menerima bearer token.

### 3.3 JWT RBAC dengan SmallRye JWT

SmallRye JWT cocok ketika aplikasi ingin mengikuti MicroProfile JWT model.

```java
@Inject
JsonWebToken jwt;
```

Cocok untuk:

1. simple JWT verification,
2. MP JWT compatibility,
3. role-based endpoint security,
4. service yang tidak butuh full OIDC discovery/client behavior.

Namun untuk OIDC provider modern seperti Keycloak, `quarkus-oidc` biasanya lebih lengkap karena mendukung OIDC discovery, JWKS, token introspection, userinfo, code flow, multi-tenancy, dan integrasi OIDC yang lebih kaya.

### 3.4 OIDC Client

OIDC client dipakai ketika Quarkus service perlu memperoleh token untuk memanggil downstream service.

Contoh:

```text
Service A
  -> perlu memanggil Service B
  -> mengambil token client credentials dari IdP
  -> mengirim Authorization: Bearer <service-token>
```

Atau:

```text
Incoming user token
  -> Service A
  -> Service A propagate token ke Service B
```

Atau:

```text
Incoming user token
  -> Service A
  -> token exchange
  -> token baru untuk audience Service B
```

---

## 4. Core Quarkus Security Objects

### 4.1 SecurityIdentity

`SecurityIdentity` adalah representasi identity internal Quarkus.

Secara konseptual:

```text
SecurityIdentity
  - Principal
  - roles
  - attributes
  - credentials
  - anonymous/authenticated flag
```

Di business layer, kamu jarang ingin bergantung langsung pada raw token. Lebih sehat jika kamu menormalisasi identity menjadi model internal.

Contoh:

```java
@ApplicationScoped
public class CurrentUserProvider {

    @Inject
    SecurityIdentity identity;

    public CurrentUser currentUser() {
        if (identity.isAnonymous()) {
            throw new IllegalStateException("Anonymous identity is not allowed here");
        }

        return new CurrentUser(
                identity.getPrincipal().getName(),
                identity.getRoles(),
                identity.getAttribute("agencyId"),
                identity.getAttribute("tenantId")
        );
    }
}
```

Namun hati-hati: attribute seperti `agencyId` tidak otomatis ada. Kamu perlu mapping dari claim token, custom augmentor, atau business lookup.

### 4.2 JsonWebToken

Jika memakai SmallRye JWT atau OIDC JWT integration, kamu bisa mengakses claim:

```java
@Inject
JsonWebToken jwt;
```

Contoh:

```java
String subject = jwt.getSubject();
String issuer = jwt.getIssuer();
Set<String> groups = jwt.getGroups();
String email = jwt.getClaim("email");
```

Namun jangan menyebarkan `JsonWebToken` ke seluruh domain service.

Lebih baik:

```text
Raw token claim
  -> normalize once
  -> CurrentUser / CallerContext / RequestSecurityContext
  -> business service
```

Agar business layer tidak tergantung pada format token vendor tertentu.

### 4.3 SecurityIdentityAugmentor

Jika identity perlu diperkaya, Quarkus menyediakan konsep augmentor.

Use case:

1. map external group ke internal role,
2. ambil tenant dari claim,
3. enrich agency profile dari database/cache,
4. attach normalized user context,
5. derive technical permission.

Mental model:

```text
Token valid
  -> base SecurityIdentity dibuat
  -> augmentor memperkaya identity
  -> endpoint menerima identity final
```

Tetapi hati-hati. Augmentor bukan tempat untuk business authorization kompleks. Jangan membuat augmentor melakukan query berat untuk setiap request tanpa cache.

---

## 5. OIDC Bearer Token Authentication

### 5.1 Dependency

Untuk Quarkus REST API dengan OIDC bearer token:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-oidc</artifactId>
</dependency>
```

Jika menggunakan REST:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-rest</artifactId>
</dependency>
```

Jika JSON:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-rest-jackson</artifactId>
</dependency>
```

### 5.2 Basic Configuration

Contoh konfigurasi sederhana:

```properties
quarkus.oidc.auth-server-url=http://localhost:8180/realms/demo
quarkus.oidc.client-id=case-api
quarkus.oidc.application-type=service
```

Makna:

| Property | Makna |
|---|---|
| `auth-server-url` | URL realm/issuer OIDC |
| `client-id` | client identifier aplikasi ini |
| `application-type=service` | service API menerima bearer token |

Untuk Keycloak lokal:

```text
http://localhost:8180/realms/demo
```

Issuer di token harus cocok dengan issuer yang Quarkus harapkan.

### 5.3 Token Verification Flow

```text
Request masuk
  |
  +-- Authorization header ditemukan?
  |
  +-- Bearer token diekstrak
  |
  +-- issuer diperiksa
  |
  +-- signature diperiksa via JWKS/public key
  |
  +-- exp/nbf/iat diperiksa
  |
  +-- audience/azp/client-id diperiksa sesuai config
  |
  +-- roles/groups/claims diekstrak
  |
  +-- SecurityIdentity dibuat
  |
  v
Resource dipanggil
```

### 5.4 Endpoint Protection

Contoh:

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CaseResource {

    @GET
    @Path("/{id}")
    @Authenticated
    public CaseResponse getCase(@PathParam("id") String id) {
        return new CaseResponse(id, "OPEN");
    }
}
```

Atau role-based:

```java
@GET
@Path("/{id}/audit")
@RolesAllowed("case-auditor")
public AuditTrailResponse getAudit(@PathParam("id") String id) {
    return auditService.getAuditTrail(id);
}
```

Part 016 akan membahas authorization lebih dalam. Di Part 015, yang penting adalah: annotation security hanya bermakna jika identity pipeline benar.

---

## 6. Keycloak Integration Mental Model

### 6.1 Keycloak Sebagai OIDC Provider

Dalam setup umum:

```text
Keycloak realm
  - users
  - clients
  - roles
  - groups
  - identity providers
  - protocol mappers
  - scopes
  - keys/JWKS
```

Quarkus service menjadi OIDC client/resource server.

```text
User login ke Keycloak
  -> mendapat token
  -> memanggil Quarkus API
  -> Quarkus verify token menggunakan metadata/JWKS Keycloak
```

### 6.2 Realm, Client, Audience

Banyak bug security enterprise berasal dari salah paham antara realm, client, dan audience.

| Konsep | Makna |
|---|---|
| Realm | Security domain di Keycloak |
| Client | Aplikasi/resource/API yang dikenal oleh realm |
| User | Principal manusia |
| Service account | Principal teknis milik client |
| Role | Label privilege |
| Group | Pengelompokan user |
| Audience | Penerima token yang dimaksud |
| Issuer | Penerbit token |

Token yang diterbitkan untuk SPA belum tentu boleh digunakan untuk semua backend.

Top 1% security mindset:

```text
Valid signature saja tidak cukup.
Token harus valid untuk issuer, waktu, audience, client, dan trust boundary yang tepat.
```

### 6.3 Realm Role vs Client Role

Keycloak punya realm role dan client role.

Contoh token bisa mengandung:

```json
{
  "realm_access": {
    "roles": ["offline_access", "uma_authorization"]
  },
  "resource_access": {
    "case-api": {
      "roles": ["case-reader", "case-officer"]
    }
  }
}
```

Quarkus bisa mengekstrak role tergantung konfigurasi. Jangan asumsikan semua role otomatis menjadi `@RolesAllowed` role dengan nama yang kamu harapkan.

Rekomendasi governance:

```text
External roles/groups
  -> normalize
  -> internal application roles
  -> domain permissions
```

Jangan biarkan business code membaca `realm_access`/`resource_access` secara tersebar.

---

## 7. JWT Anatomy Untuk Engineer Quarkus

JWT terdiri dari:

```text
header.payload.signature
```

Header:

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "abc123"
}
```

Payload:

```json
{
  "iss": "https://idp.example.com/realms/demo",
  "sub": "8a1c...",
  "aud": "case-api",
  "exp": 1760000000,
  "iat": 1759996400,
  "azp": "case-frontend",
  "preferred_username": "fajar",
  "email": "fajar@example.com",
  "groups": ["case-officer"],
  "scope": "openid profile email"
}
```

Signature:

```text
sign(base64url(header) + "." + base64url(payload), private_key)
```

Quarkus memverifikasi signature menggunakan public key/JWKS dari IdP.

### 7.1 Claim Yang Wajib Dipahami

| Claim | Makna | Failure Mode |
|---|---|---|
| `iss` | issuer/penerbit token | token dari realm/environment salah diterima |
| `sub` | subject/user/service identity | user mapping salah |
| `aud` | intended audience | token untuk service lain diterima |
| `azp` | authorized party/client app | frontend/client asal tidak jelas |
| `exp` | expiry time | token expired tetap diterima jika clock skew salah |
| `nbf` | not before | token belum valid tetapi diterima |
| `iat` | issued at | token terlalu lama, replay risk |
| `jti` | token id | dedup/revocation/audit correlation |
| `scope` | OAuth scopes | scope disamakan dengan role tanpa desain |
| `groups` | groups/roles | mapping tidak konsisten |

### 7.2 Access Token vs ID Token

Kesalahan umum: memakai ID token untuk memanggil API.

| Token | Tujuan |
|---|---|
| ID token | membuktikan authentication ke client aplikasi |
| Access token | mengakses resource/API |
| Refresh token | mendapat access token baru |

API service seharusnya menerima access token, bukan ID token, kecuali ada alasan spesifik dan validasi eksplisit.

---

## 8. Opaque Token vs JWT

Tidak semua access token harus JWT.

### 8.1 JWT Access Token

Keunggulan:

- validasi lokal,
- cepat,
- cocok untuk microservice,
- tidak perlu call IdP setiap request,
- claim tersedia langsung.

Kelemahan:

- revocation tidak immediate,
- token bisa membesar,
- claim stale sampai token expired,
- audience/issuer config harus disiplin.

### 8.2 Opaque Token

Opaque token tidak bisa divalidasi lokal. Service perlu introspection ke IdP.

Keunggulan:

- revocation lebih terkontrol,
- token tidak membocorkan claim ke client,
- policy bisa lebih centralized.

Kelemahan:

- latency lebih tinggi,
- dependency runtime ke IdP,
- butuh cache,
- IdP outage bisa berdampak langsung.

### 8.3 Decision Matrix

| Kondisi | Pilihan Umum |
|---|---|
| High throughput API | JWT local verification |
| Butuh revocation immediate | Opaque/introspection atau short-lived JWT |
| Sensitive claims | Opaque token atau minimal claims |
| Banyak downstream microservice | JWT + audience discipline/token exchange |
| Regulatory audit | JWT dengan jti + correlation + audit event, atau introspection jika policy perlu centralized |

---

## 9. Token Propagation

Token propagation adalah ketika service menerima token lalu meneruskannya ke downstream.

```text
User/SPA
  -> Service A: Authorization: Bearer user-token
  -> Service A
  -> Service B: Authorization: Bearer user-token
```

Quarkus punya extension untuk token propagation pada REST client.

### 9.1 Dependency

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-rest-client-oidc-token-propagation</artifactId>
</dependency>
```

Untuk OIDC client acquiring token:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-oidc-client</artifactId>
</dependency>
```

### 9.2 REST Client Example

```java
@RegisterRestClient(configKey = "document-service")
@AccessToken
public interface DocumentClient {

    @GET
    @Path("/documents/{id}")
    DocumentResponse getDocument(@PathParam("id") String id);
}
```

Conceptually:

```text
incoming token
  -> captured by Quarkus security context
  -> REST client filter attaches Authorization header
  -> downstream receives token
```

### 9.3 Propagation Is Not Always Correct

Propagation is convenient, but dangerous if misunderstood.

Question:

> Token dari frontend untuk Service A bolehkah dipakai untuk Service B?

Jawaban: belum tentu.

Masalah utama:

1. audience token mungkin `service-a`, bukan `service-b`,
2. downstream mungkin menerima token yang tidak dimaksudkan untuknya,
3. role/scope di token terlalu luas,
4. Service A membocorkan user token ke dependency tidak trusted,
5. audit chain menjadi kabur,
6. revocation semantics tidak jelas.

### 9.4 Token Exchange

Alternatif lebih aman:

```text
Incoming user token
  -> Service A
  -> Service A meminta token baru ke IdP untuk audience Service B
  -> Service A memanggil Service B dengan exchanged token
```

Token exchange membuat boundary lebih eksplisit:

```text
Original identity: user A
Actor: service A
Audience: service B
Scope: permission yang dibutuhkan saja
```

Untuk enterprise, token exchange sering lebih defensible dibanding blind propagation.

---

## 10. Service-to-Service Authentication

Ada tiga pola umum.

### 10.1 Propagate User Token

```text
Service A menerima user token
Service A meneruskan user token ke Service B
```

Cocok jika:

- Service B memang butuh user context asli,
- audience token valid untuk Service B,
- trust boundary jelas,
- downstream policy berbasis user.

Tidak cocok jika:

- Service B tidak seharusnya melihat user token,
- token audience hanya untuk Service A,
- service chain panjang,
- token mengandung claim sensitif.

### 10.2 Client Credentials Token

```text
Service A memakai client_id/client_secret/private_key
  -> ambil service token
  -> panggil Service B
```

Cocok untuk:

- background job,
- async consumer,
- machine-to-machine process,
- system maintenance,
- integration batch.

Kelemahan:

- tidak membawa user context,
- perlu audit actor yang jelas,
- harus membedakan “system did this” vs “user requested this”.

### 10.3 Token Exchange / Delegation

```text
User token + Service A identity
  -> exchanged token untuk Service B
```

Cocok untuk:

- user delegation,
- multi-service workflow,
- downstream butuh user dan actor,
- least privilege per audience.

Paling sehat untuk enterprise, tetapi lebih kompleks.

---

## 11. OIDC Client Credentials di Quarkus

### 11.1 Configuration Example

```properties
quarkus.oidc-client.auth-server-url=https://idp.example.com/realms/prod
quarkus.oidc-client.client-id=case-api
quarkus.oidc-client.credentials.secret=${CASE_API_CLIENT_SECRET}
quarkus.oidc-client.grant.type=client
```

### 11.2 REST Client OIDC Filter

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-rest-client-oidc-filter</artifactId>
</dependency>
```

```java
@RegisterRestClient(configKey = "notification-service")
@OidcClientFilter
public interface NotificationClient {

    @POST
    @Path("/notifications")
    void send(NotificationRequest request);
}
```

Flow:

```text
REST client call
  -> OIDC client obtains/caches access token
  -> attaches Authorization: Bearer <service-token>
  -> calls downstream
```

### 11.3 Secrets Governance

Never store client secret in source code.

Better:

```properties
quarkus.oidc-client.credentials.secret=${CASE_API_CLIENT_SECRET}
```

Production source:

1. Kubernetes Secret,
2. Vault,
3. AWS Secrets Manager,
4. AWS SSM Parameter Store,
5. mounted secret file,
6. external secret operator,
7. platform secret injection.

For high assurance, prefer private key JWT or mTLS client authentication over static client secret, if the IdP and platform support it.

---

## 12. Multi-Tenant OIDC

Multi-tenant OIDC means one Quarkus app accepts tokens from multiple tenants/issuers.

Use cases:

1. SaaS app with tenant-specific realms,
2. agency-specific identity provider,
3. customer-specific IdP,
4. migration from old IdP to new IdP,
5. internal/external realm split.

Mental model:

```text
Request arrives
  -> determine tenant
  -> select OIDC tenant config
  -> validate token against selected issuer/JWKS
  -> build identity
```

Tenant resolution strategies:

| Strategy | Example | Risk |
|---|---|---|
| Hostname | `agency-a.example.com` | DNS/proxy correctness |
| Path prefix | `/tenant-a/api` | path spoofing if not strict |
| Header | `X-Tenant-Id` | header tampering unless trusted gateway |
| Token issuer | `iss` claim | must avoid accepting unknown issuers blindly |
| Client id/audience | `aud` | insufficient alone |

High-risk anti-pattern:

```text
Accept any issuer as long as token signature validates somewhere.
```

Multi-tenancy must be allowlisted.

---

## 13. SecurityIdentity Normalization Pattern

Raw identity from token is not enough for business logic.

Recommended pattern:

```text
OIDC token
  -> Quarkus SecurityIdentity
  -> IdentityNormalizer
  -> CallerContext
  -> domain service
```

Example record:

```java
public record CallerContext(
        String subject,
        String username,
        String tenantId,
        String agencyId,
        Set<String> applicationRoles,
        boolean serviceAccount
) {
    public boolean hasRole(String role) {
        return applicationRoles.contains(role);
    }
}
```

Provider:

```java
@ApplicationScoped
public class CallerContextProvider {

    @Inject
    SecurityIdentity identity;

    public CallerContext requireCaller() {
        if (identity.isAnonymous()) {
            throw new NotAuthenticatedException("Authenticated caller required");
        }

        String subject = identity.getPrincipal().getName();
        String username = attribute("preferred_username");
        String tenantId = attribute("tenant_id");
        String agencyId = attribute("agency_id");

        return new CallerContext(
                subject,
                username,
                tenantId,
                agencyId,
                Set.copyOf(identity.getRoles()),
                Boolean.TRUE.equals(identity.getAttribute("service_account"))
        );
    }

    @SuppressWarnings("unchecked")
    private <T> T attribute(String name) {
        return (T) identity.getAttribute(name);
    }
}
```

In production, avoid unchecked blind assumptions. Validate required attributes during request entry.

---

## 14. Claim Mapping Strategy

### 14.1 Do Not Use Token Claims Directly Everywhere

Bad:

```java
public void approveCase(String caseId) {
    String agency = jwt.getClaim("agency");
    String role = jwt.getGroups().iterator().next();
    ...
}
```

Why bad?

1. business logic depends on token schema,
2. migration to new IdP becomes painful,
3. impossible to audit mapping consistently,
4. role semantics scattered,
5. tests become token-format-driven.

Better:

```java
public void approveCase(String caseId, CallerContext caller) {
    casePolicy.requireCanApprove(caller, caseId);
    ...
}
```

### 14.2 Token Claim Categories

| Category | Example | Should Business Code Use Directly? |
|---|---|---|
| protocol claim | `iss`, `aud`, `exp` | no |
| identity claim | `sub`, `preferred_username`, `email` | via normalized context |
| organization claim | `agency_id`, `tenant_id` | via normalized context + validation |
| authorization claim | `roles`, `groups`, `scope` | via policy layer |
| audit claim | `jti`, `sid`, `azp` | via audit context |

---

## 15. Common Quarkus OIDC Configuration Patterns

### 15.1 Service API

```properties
quarkus.oidc.application-type=service
quarkus.oidc.auth-server-url=https://idp.example.com/realms/prod
quarkus.oidc.client-id=case-api
```

### 15.2 Web App Code Flow

```properties
quarkus.oidc.application-type=web-app
quarkus.oidc.auth-server-url=https://idp.example.com/realms/prod
quarkus.oidc.client-id=case-admin-web
quarkus.oidc.credentials.secret=${CASE_ADMIN_CLIENT_SECRET}
```

### 15.3 Hybrid Service

Some apps need both bearer token and code flow. Be careful: hybrid apps complicate threat model because they support multiple credential types.

Use only when justified.

### 15.4 Disable Auth in Dev/Test Carefully

Bad:

```properties
%dev.quarkus.oidc.enabled=false
%test.quarkus.oidc.enabled=false
```

This creates tests that do not exercise security.

Better:

1. use test security annotation,
2. use Dev Services for Keycloak,
3. test token fixtures,
4. separate pure unit tests from security integration tests.

---

## 16. Local Development With Keycloak Dev Services

Quarkus Dev Services can start dependent services automatically during dev/test. For security, this can include Keycloak integration depending on extensions/config.

Local mental model:

```text
quarkus dev
  -> Dev Services starts Keycloak container
  -> realm/client/users can be imported
  -> app uses local OIDC config
  -> tests/dev UI can exercise authentication
```

Benefits:

1. faster onboarding,
2. fewer manual local setup steps,
3. realistic security behavior,
4. repeatable test environment.

Risks:

1. local realm differs from production,
2. local roles not matching real roles,
3. developers test with overprivileged users,
4. Dev Services hides dependency complexity.

Recommendation:

```text
Use Dev Services for feedback speed,
but store realm/test security config explicitly and review it as part of security contract.
```

---

## 17. Failure Modes in OIDC Authentication

### 17.1 Issuer Mismatch

Symptom:

```text
401 Unauthorized
issuer mismatch
```

Cause:

1. token from different realm,
2. internal vs external URL mismatch,
3. reverse proxy changes issuer URL,
4. local Keycloak URL differs from configured URL.

Fix:

- align `auth-server-url`, issuer metadata, and token `iss`,
- use proper frontend/backend URL config in Keycloak,
- avoid accepting multiple issuers casually.

### 17.2 Audience Mismatch

Symptom:

```text
Token signature valid, but service rejects audience.
```

Cause:

- access token intended for another service/client.

Correct mental model:

```text
Signature says token is real.
Audience says token is meant for me.
```

### 17.3 JWKS Rotation Failure

OIDC providers rotate signing keys. Token header contains `kid`.

Failure:

```text
Unknown key id
signature verification failed
```

Causes:

1. Quarkus JWKS cache stale,
2. IdP rotated keys unexpectedly,
3. network cannot reach JWKS endpoint,
4. proxy blocks discovery/JWKS.

Production considerations:

- monitor authentication failure spikes,
- ensure JWKS endpoint reachable,
- know cache behavior,
- coordinate key rotation.

### 17.4 Clock Skew

JWT time claims depend on clock.

Failure:

1. valid token considered expired,
2. token not yet valid,
3. inconsistent behavior across pods.

Fix:

- synchronize nodes using NTP,
- configure small clock skew allowance if necessary,
- do not use large skew as workaround.

### 17.5 Role Mapping Drift

Symptom:

```text
User can login but receives 403.
```

Causes:

1. Keycloak role changed,
2. client role not included in token,
3. group mapper removed,
4. Quarkus expects `groups`, token contains `resource_access`,
5. role renamed without code/config update.

Fix:

- define role contract,
- test token claim shape,
- version role mapping,
- include security contract tests.

### 17.6 IdP Outage

Bearer JWT local verification can continue if JWKS cache exists. Introspection/code flow/token acquisition may fail.

Questions:

1. Can existing API calls continue?
2. Can new logins continue?
3. Can service-to-service token acquisition continue?
4. Does token cache survive restart?
5. What is failure response?

Top-tier systems define IdP outage behavior explicitly.

---

## 18. Token Lifetime Design

Token lifetime is not just security setting. It affects UX, performance, outage tolerance, and revocation.

| Token | Typical Lifetime | Notes |
|---|---:|---|
| Access token | short | lower risk if leaked |
| ID token | short/medium | for client authentication context |
| Refresh token | longer | must be protected strongly |
| Service token | short | can be cached by service |

Trade-offs:

```text
Short access token
  + lower replay risk
  + stale roles expire faster
  - more refresh/token endpoint traffic
  - more sensitive to IdP outage

Long access token
  + fewer refresh calls
  + better outage tolerance
  - stale authorization
  - higher replay window
```

For high-risk admin/regulatory operations, short-lived access tokens plus proper refresh/session management is usually better than long-lived access tokens.

---

## 19. Authentication vs Session Management

Bearer token API is stateless.

Code flow web app often has session state.

### 19.1 Stateless API

```text
Every request carries token.
Service validates token.
No server-side login session required.
```

Pros:

- scalable,
- simple horizontal pods,
- good for APIs.

Cons:

- revocation harder,
- every service must validate token correctly,
- token leaks are serious.

### 19.2 Web Session

```text
Browser has session cookie.
Server stores or encodes session.
Tokens may be stored server-side.
```

Pros:

- better control over web login state,
- can hide tokens from browser,
- BFF-friendly.

Cons:

- session management complexity,
- CSRF concerns,
- cookie config matters,
- sticky/session store considerations.

---

## 20. SPA + Quarkus API Architecture

Common modern pattern:

```text
SPA
  -> OIDC provider Authorization Code + PKCE
  -> obtains access token
  -> calls Quarkus API with bearer token
```

Quarkus API:

```text
quarkus.oidc.application-type=service
```

Important decisions:

1. where refresh token lives,
2. whether SPA stores token in memory or browser storage,
3. CORS config,
4. API audience,
5. logout behavior,
6. frontend route guard vs backend authorization,
7. CSRF relevance.

Security invariant:

```text
Frontend route guard is UX only.
Backend authorization is security.
```

---

## 21. BFF Architecture With Quarkus

Backend-for-frontend pattern:

```text
Browser
  -> Quarkus BFF
  -> OIDC code flow with IdP
  -> BFF stores tokens server-side/session
  -> Browser uses secure cookie
  -> BFF calls downstream APIs
```

Benefits:

1. tokens hidden from browser,
2. easier CSRF/session control,
3. centralized frontend-specific API composition,
4. can perform token exchange downstream.

Costs:

1. BFF state/session complexity,
2. scaling session store,
3. more backend responsibility,
4. risk BFF becomes god gateway.

Quarkus can support both service API and web-app OIDC mode, but architecture should be explicit.

---

## 22. Authentication For Background Jobs and Message Consumers

Not every action starts from HTTP request.

Examples:

1. scheduled job,
2. Kafka consumer,
3. RabbitMQ consumer,
4. batch process,
5. retry worker,
6. outbox publisher.

Problem:

```text
No incoming user token exists.
```

Options:

### 22.1 System Identity

```text
Job runs as service account: case-api-job
```

Audit:

```text
actor_type = SYSTEM
actor_id = case-api-job
reason = scheduled_expiry_check
```

### 22.2 Persisted Initiator Context

For async workflows triggered by a user:

```text
HTTP request by user A
  -> writes command/event with initiator user A
  -> async worker processes later as system
  -> audit records both initiator and processor
```

Audit model:

```text
initiated_by = user A
processed_by = system worker
processed_at = time
source_event_id = ...
```

Do not pretend the worker is still executing with the original user token if token expired and no delegation model exists.

---

## 23. Security Context and Audit Context

Authentication result should feed audit context.

Recommended audit fields:

| Field | Source |
|---|---|
| actor subject | `sub` claim / principal |
| actor username | normalized claim |
| actor type | user/service/system |
| tenant/agency | validated claim or lookup |
| client id | `azp`/client id |
| token id | `jti` if available |
| session id | `sid` if available |
| request id | generated/request header |
| correlation id | propagated header |
| auth mechanism | bearer/code-flow/service-token |
| authentication result | success/failure |

Important distinction:

```text
Security log proves authentication events.
Audit trail proves business action accountability.
```

Do not mix them carelessly.

---

## 24. OIDC Discovery and Metadata

OIDC provider exposes discovery metadata, often at:

```text
{issuer}/.well-known/openid-configuration
```

Metadata includes:

1. issuer,
2. authorization endpoint,
3. token endpoint,
4. JWKS URI,
5. userinfo endpoint,
6. introspection endpoint,
7. supported algorithms.

Quarkus OIDC can use this metadata to configure validation behavior.

Failure mode:

```text
App starts but cannot fetch metadata because network/proxy/DNS blocked.
```

Production checklist:

1. OIDC metadata endpoint reachable from pods,
2. JWKS endpoint reachable,
3. TLS trust configured,
4. proxy configured if needed,
5. startup behavior known if IdP unavailable,
6. health check does not create cascading failure.

---

## 25. Token Introspection

Introspection means service asks IdP:

```text
Is this token active?
What claims does it have?
```

Useful for opaque tokens or revocation-sensitive systems.

Trade-offs:

| Aspect | Local JWT Verification | Introspection |
|---|---|---|
| Latency | low | higher |
| IdP dependency per request | no | yes, unless cached |
| Revocation | delayed until expiry | can be immediate |
| Claims | embedded | returned by IdP |
| Failure mode | JWKS cache/network | IdP availability/latency |

Design question:

> Does the system need immediate revocation enough to justify runtime dependency on IdP?

Often better compromise:

```text
short-lived JWT + refresh token + session controls + risk-based revocation
```

---

## 26. UserInfo Endpoint

UserInfo can fetch additional user claims from IdP.

Use carefully.

Pros:

1. fewer claims in token,
2. fresher user profile,
3. central source for user details.

Cons:

1. extra network call,
2. IdP runtime dependency,
3. latency,
4. cache invalidation,
5. failure complexity.

Recommendation:

- do not call UserInfo in every business method,
- cache if allowed,
- decide which attributes are security-critical,
- avoid using mutable profile attributes as stable authorization keys.

---

## 27. CORS and Authentication

For SPA calling Quarkus API cross-origin, CORS matters.

But CORS is not authentication.

CORS answers:

```text
Can browser JavaScript from origin X call this API and read response?
```

It does not secure API from non-browser clients.

Security invariant:

```text
CORS is browser access control.
Authentication/authorization is API security.
```

Common bad config:

```properties
quarkus.http.cors=true
quarkus.http.cors.origins=*
quarkus.http.cors.access-control-allow-credentials=true
```

This is dangerous and often invalid/inconsistent.

Better:

```properties
quarkus.http.cors=true
quarkus.http.cors.origins=https://app.example.com
quarkus.http.cors.methods=GET,POST,PUT,PATCH,DELETE,OPTIONS
quarkus.http.cors.headers=Authorization,Content-Type,X-Request-Id
```

---

## 28. CSRF Considerations

CSRF matters primarily when browser automatically sends credentials, usually cookies.

| Architecture | CSRF Concern |
|---|---|
| SPA sends bearer token in Authorization header | lower, but XSS/token storage risk |
| BFF uses cookie session | CSRF relevant |
| Server-side web app | CSRF relevant |
| machine-to-machine bearer token | not browser CSRF |

If using cookie-based session, configure:

1. SameSite,
2. Secure,
3. HttpOnly,
4. CSRF token for unsafe methods,
5. origin/referer validation if appropriate.

---

## 29. Native Image Implications For Security

Security libraries can be sensitive to native-image constraints.

Potential areas:

1. reflection,
2. dynamic class loading,
3. crypto providers,
4. TLS trust stores,
5. resource files,
6. JWT/JWK parsing,
7. native SSL support,
8. security provider initialization.

Quarkus extensions usually provide native-image metadata when using supported paths. Risk rises when adding custom security libraries.

Checklist:

1. run native integration tests,
2. verify token validation in native binary,
3. verify TLS truststore behavior,
4. verify JWKS fetching,
5. verify OIDC client token acquisition,
6. verify crypto algorithms,
7. verify logging does not expose token.

---

## 30. Logging and Sensitive Data

Never log full tokens.

Bad:

```java
log.info("Authorization header: {}", authorizationHeader);
```

Better:

```java
log.info("Authenticated request: subject={}, issuer={}, client={}, tokenId={}",
        subject,
        issuer,
        clientId,
        tokenId);
```

Even token fragments can be risky. If you must correlate token, use `jti` or hash.

Recommended:

```text
token_hash = SHA-256(token) truncated for correlation only
```

But avoid unless necessary.

Sensitive claims:

1. email,
2. phone,
3. NRIC/NIK/passport,
4. address,
5. government identifier,
6. agency-specific attributes,
7. groups revealing sensitive affiliation.

Log only what is needed for operations/audit.

---

## 31. Authentication Error Contract

Security errors must be intentionally shaped.

Typical status codes:

| Code | Meaning |
|---|---|
| 401 | not authenticated / invalid credential |
| 403 | authenticated but not allowed |
| 400 | malformed request, sometimes invalid auth parameter |
| 500 | internal auth subsystem error, avoid leaking detail |
| 503 | dependency unavailable if auth dependency critical |

Do not leak:

1. “user exists but password wrong”,
2. exact role missing in public response,
3. full token validation reason to untrusted client,
4. stack trace,
5. internal IdP URL if sensitive.

But log internally with enough detail:

```text
auth_failure_type=ISSUER_MISMATCH
issuer=https://...
client_id=...
request_id=...
```

---

## 32. Security Testing Strategy

### 32.1 Unit Test

Test pure mappers and normalizers.

```java
@Test
void shouldMapGroupsToApplicationRoles() {
    var claims = Map.of("groups", List.of("case-officer"));

    var roles = mapper.map(claims);

    assertTrue(roles.contains("CASE_READ"));
}
```

### 32.2 Quarkus Test With Mock Security

Use Quarkus test support for endpoint behavior.

```java
@TestSecurity(user = "alice", roles = {"case-reader"})
@Test
void shouldAllowCaseReader() {
    given()
      .when().get("/cases/CASE-001")
      .then().statusCode(200);
}
```

### 32.3 Token Shape Tests

Validate real-like JWT claims.

Test cases:

1. missing issuer,
2. wrong issuer,
3. wrong audience,
4. expired token,
5. missing role,
6. service account token,
7. user token,
8. multi-tenant token,
9. old role mapper,
10. unknown `kid`.

### 32.4 Integration Test With Keycloak

Use real Keycloak/Dev Services/Testcontainers for:

1. code flow,
2. bearer token,
3. client credentials,
4. role mapping,
5. token propagation,
6. token exchange if used.

### 32.5 Security Regression Matrix

Example matrix:

| Scenario | Expected |
|---|---|
| No token | 401 |
| Malformed token | 401 |
| Expired token | 401 |
| Wrong issuer | 401 |
| Wrong audience | 401 |
| Valid token no role | 403 |
| Valid role wrong agency | 403 |
| Valid service account | allowed only for service endpoints |
| User token propagated to downstream | accepted only if audience valid |
| IdP JWKS unavailable after startup | behavior documented/tested |

---

## 33. Production Readiness Checklist

### 33.1 OIDC Configuration

- [ ] `auth-server-url` correct per environment.
- [ ] issuer matches token `iss`.
- [ ] audience/client-id validation intentionally configured.
- [ ] JWKS endpoint reachable from pods.
- [ ] TLS truststore configured if internal CA used.
- [ ] proxy configuration tested if needed.
- [ ] token lifetimes approved.
- [ ] clock skew small and justified.
- [ ] multi-tenant issuers allowlisted.

### 33.2 Token and Claims

- [ ] access token used for APIs, not ID token.
- [ ] claim mapping documented.
- [ ] role/group mapper versioned.
- [ ] business code does not parse raw token everywhere.
- [ ] service account tokens distinguished from user tokens.
- [ ] sensitive claims minimized.
- [ ] token does not contain unnecessary PII.

### 33.3 Service-to-Service

- [ ] propagation vs client credentials vs token exchange chosen explicitly.
- [ ] downstream audience validated.
- [ ] service client secrets stored in secret manager.
- [ ] token refresh behavior tested.
- [ ] IdP outage behavior documented.
- [ ] retries to token endpoint bounded.

### 33.4 Observability

- [ ] authentication failure metrics exist.
- [ ] 401 vs 403 tracked separately.
- [ ] issuer/audience mismatch logged internally.
- [ ] JWKS refresh failures observable.
- [ ] token endpoint latency monitored.
- [ ] no full token logged.
- [ ] request ID/correlation ID included.

### 33.5 Testing

- [ ] endpoint security tests exist.
- [ ] role mapping tests exist.
- [ ] wrong issuer/audience tests exist.
- [ ] expired token tests exist.
- [ ] service account tests exist.
- [ ] native image auth tests exist if native deployment is planned.
- [ ] Keycloak/IdP integration tests exist for critical flows.

---

## 34. Anti-Patterns

### 34.1 “JWT Signature Valid = Request Allowed”

Wrong.

Correct:

```text
valid signature
+ valid issuer
+ valid audience
+ valid time claims
+ valid token type
+ trusted claims
+ authorization decision
= request may proceed
```

### 34.2 Blind Token Propagation

Bad:

```text
Forward incoming Authorization header to every downstream service.
```

Better:

```text
Decide per downstream:
- propagate original token,
- exchange token,
- use service token,
- call without user token but include audited initiator context.
```

### 34.3 Business Logic Reads Raw JWT Everywhere

Bad because token schema becomes hidden coupling.

Use normalized caller context.

### 34.4 Dev/Test Security Disabled

If tests bypass security, production security bugs survive.

Use mock/test security intentionally, and have real IdP integration tests for critical paths.

### 34.5 Frontend Role Guard As Security

Frontend role guard improves UX only.

Backend must enforce authorization.

### 34.6 Long-Lived Access Tokens For Convenience

Long token lifetime reduces login/refresh friction but increases replay and stale permission risk.

### 34.7 Logging Authorization Header

Never log bearer tokens.

### 34.8 Accepting Multiple Issuers Without Allowlist

Multi-tenant does not mean accepting arbitrary issuer.

### 34.9 Treating Service Account As Admin User

Service account must have limited technical permissions, not broad human-admin privileges.

---

## 35. Mini Case Study: Regulatory Case Management API

Imagine Quarkus service:

```text
case-management-api
```

Endpoints:

```text
GET    /cases/{id}
POST   /cases/{id}/assign
POST   /cases/{id}/approve
POST   /cases/{id}/escalate
GET    /cases/{id}/audit-trail
```

Callers:

1. internal officer via SPA,
2. supervisor via SPA,
3. scheduled escalation job,
4. document service,
5. notification service,
6. reporting service.

### 35.1 Authentication Design

SPA:

```text
Authorization Code + PKCE with Keycloak
Access token audience: case-management-api
```

Quarkus API:

```properties
quarkus.oidc.application-type=service
quarkus.oidc.auth-server-url=https://sso.example.gov/realms/agency
quarkus.oidc.client-id=case-management-api
```

### 35.2 Caller Normalization

Token claims:

```json
{
  "sub": "user-123",
  "preferred_username": "officer.a",
  "agency_id": "CEA",
  "groups": ["case-officer"],
  "azp": "case-frontend",
  "jti": "token-abc"
}
```

Normalize to:

```java
CallerContext(
  subject="user-123",
  username="officer.a",
  tenantId="agency-realm",
  agencyId="CEA",
  applicationRoles=["CASE_READ", "CASE_UPDATE"],
  serviceAccount=false
)
```

### 35.3 Downstream Calls

When approving case:

```text
case-management-api
  -> document-service
  -> notification-service
  -> audit-service
```

Design:

| Downstream | Token Strategy | Reason |
|---|---|---|
| document-service | token exchange with user delegation | document access depends on user/agency |
| notification-service | service token | notification is technical side effect |
| audit-service | service token + explicit actor context | audit event carries actor data in payload |

### 35.4 Audit Event

```json
{
  "eventType": "CASE_APPROVED",
  "caseId": "CASE-001",
  "actorSubject": "user-123",
  "actorUsername": "officer.a",
  "actorType": "USER",
  "clientId": "case-frontend",
  "tokenId": "token-abc",
  "correlationId": "req-789",
  "occurredAt": "2026-06-20T10:15:30Z"
}
```

This is stronger than storing only `created_by = officer.a`.

---

## 36. Top 1% Engineering Exercises

### Exercise 1 — Draw Your Identity Pipeline

For one Quarkus service, draw:

```text
caller -> token -> Quarkus OIDC -> SecurityIdentity -> CallerContext -> authorization -> audit -> downstream token
```

Then answer:

1. where is issuer checked?
2. where is audience checked?
3. where are roles normalized?
4. where is tenant resolved?
5. where is service account distinguished?
6. where is token propagated/exchanged?
7. where is audit actor captured?

### Exercise 2 — Build Failure Matrix

Create test cases for:

1. no token,
2. malformed token,
3. expired token,
4. wrong issuer,
5. wrong audience,
6. missing role,
7. wrong agency,
8. valid user,
9. service account,
10. unknown JWKS key id.

### Exercise 3 — Choose Token Strategy Per Downstream

For each downstream dependency, choose:

1. propagate original token,
2. token exchange,
3. client credentials,
4. no token + signed internal message,
5. mTLS-only.

Justify based on:

1. user context need,
2. trust boundary,
3. audit requirement,
4. least privilege,
5. token exposure risk.

### Exercise 4 — Security Incident Simulation

Simulate:

```text
Keycloak rotates signing key unexpectedly.
```

Answer:

1. how does Quarkus behave?
2. what metrics spike?
3. what logs appear?
4. which users are affected?
5. can existing tokens still work?
6. what runbook action is needed?

---

## 37. Invariants

Security invariants for Quarkus authentication:

1. **Authentication is identity proof, not permission proof.**
2. **Valid JWT signature alone is not enough.**
3. **Issuer and audience are security boundaries.**
4. **Access token is for API access; ID token is not a generic API credential.**
5. **Raw token claims should be normalized before entering business logic.**
6. **Frontend authorization is not security.**
7. **Token propagation is an architectural decision, not a default convenience.**
8. **Service account actions must be distinguishable from user actions.**
9. **Security failures must be observable without leaking secrets.**
10. **Native-image security behavior must be tested, not assumed.**
11. **Multi-tenant OIDC must be allowlisted.**
12. **IdP outage behavior must be designed explicitly.**
13. **Authorization and audit depend on authentication correctness.**

---

## 38. References

Primary documentation to deepen this part:

1. Quarkus — OpenID Connect Bearer Token Authentication  
   `https://quarkus.io/guides/security-oidc-bearer-token-authentication`

2. Quarkus — OpenID Connect Client and Token Propagation  
   `https://quarkus.io/guides/security-openid-connect-client`

3. Quarkus — OIDC and OAuth2 Client and Filters Reference  
   `https://quarkus.io/guides/security-openid-connect-client-reference`

4. Quarkus — Using JWT RBAC  
   `https://quarkus.io/guides/security-jwt`

5. Quarkus — Keycloak Authorization Services  
   `https://quarkus.io/guides/security-keycloak-authorization`

6. Quarkus — OIDC Configuration Properties Reference  
   `https://quarkus.io/guides/security-oidc-configuration-properties-reference`

7. Keycloak — Authorization Services Guide  
   `https://www.keycloak.org/docs/latest/authorization_services/`

---

## 39. Ringkasan

Part ini membangun fondasi authentication di Quarkus.

Poin terpenting:

1. Quarkus security harus dipahami sebagai identity pipeline.
2. OIDC bearer token adalah mode utama untuk API service.
3. Keycloak/IdP menerbitkan token, Quarkus memvalidasi dan membentuk `SecurityIdentity`.
4. JWT harus divalidasi dari sisi signature, issuer, audience, waktu, dan trust boundary.
5. Claim token harus dinormalisasi sebelum masuk ke business logic.
6. Token propagation harus dipilih dengan sadar; tidak semua downstream boleh menerima token original.
7. Service-to-service identity bisa memakai propagation, client credentials, atau token exchange.
8. Audit context harus menangkap actor, client, token id, request/correlation id, dan mekanisme authentication.
9. Failure mode seperti issuer mismatch, audience mismatch, JWKS rotation, clock skew, role mapping drift, dan IdP outage harus diuji.
10. Security test harus mencakup 401, 403, wrong issuer, wrong audience, expired token, service account, dan native-image behavior.

Setelah part ini, kita siap masuk ke Part 016: authorization model, policy enforcement, RBAC/ABAC, method security, dan domain-level permission.

---

# Status Seri

- Part 015 selesai.
- Seri belum selesai.
- Berikutnya: Part 016 — Security II: Authorization Model, Policy Enforcement, RBAC/ABAC, Method Security.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-014.md">⬅️ Part 014 — Validation, Serialization, DTO, and API Contract Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-016.md">Part 016 — Security II: Authorization Model, Policy Enforcement, RBAC/ABAC, Method Security ➡️</a>
</div>
