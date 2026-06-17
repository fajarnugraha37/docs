# Part 32 — Production Hardening Checklist for Jakarta Security Systems

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-32-production-hardening-checklist.md`  
> Target: Java 8 sampai Java 25, Java EE `javax.*`, Jakarta EE `jakarta.*`, Servlet/JAX-RS/CDI/EJB, Jakarta Security, Jakarta Authentication, Jakarta Authorization, OIDC/OAuth2/SAML/mTLS, Spring/Keycloak/MicroProfile interoperability.

---

## 0. Tujuan Part Ini

Part sebelumnya sudah membangun pemahaman dari layer konseptual sampai domain authorization. Part ini mengubah semua itu menjadi **production hardening checklist**.

Hardening bukan berarti menambahkan sebanyak mungkin security control. Hardening berarti memastikan sistem memiliki:

1. **boundary yang jelas**,
2. **default yang aman**,
3. **authentication yang reliable**,
4. **authorization yang konsisten**,
5. **session/token yang tidak mudah disalahgunakan**,
6. **operational failure yang sudah dipikirkan**,
7. **audit trail yang defensible**,
8. **runbook yang bisa dipakai saat incident**, dan
9. **test yang membuktikan control benar-benar berjalan**.

Mental model sederhana:

```text
Production security = correct design + correct configuration + correct operation + correct evidence
```

Banyak sistem tidak gagal karena developer tidak tahu `@RolesAllowed`. Sistem gagal karena:

- TLS berhenti di proxy tapi aplikasi masih percaya header sembarang.
- Role mapping berubah di IdP tapi tidak ada regression test.
- JWKS key rotate tapi app cache tidak refresh.
- Cookie tidak `Secure` di environment tertentu.
- Endpoint admin lupa tertutup.
- Token valid secara signature tapi salah audience.
- Authorization ada di service A, tetapi service B dipanggil langsung.
- Error handling membocorkan user existence.
- Audit log ada, tetapi tidak cukup untuk menjawab “siapa melakukan apa, atas nama siapa, terhadap resource apa, dan kenapa diizinkan”.

Part ini adalah checklist desain dan operasional untuk menghindari pola-pola tersebut.

---

## 1. Scope Hardening

Checklist ini mencakup:

1. Runtime Java dan Jakarta container.
2. Servlet session dan cookie.
3. Jakarta Security authentication mechanism.
4. Jakarta Authentication / JASPIC boundary.
5. Jakarta Authorization / JACC boundary.
6. JAX-RS resource server.
7. OAuth2/OIDC token validation.
8. SAML/federation integration.
9. mTLS/client certificate.
10. Reverse proxy/API gateway/load balancer.
11. Browser security: CSRF, CORS, clickjacking.
12. Method-level authorization.
13. Domain authorization.
14. Multi-tenancy.
15. Audit/logging/monitoring.
16. Secret/key/certificate rotation.
17. Testing and release gates.
18. Incident response readiness.

Yang tidak dibahas ulang secara detail:

- teori kriptografi dasar,
- implementasi password hashing dari nol,
- detail semua OAuth/OIDC flow,
- semua fitur vendor container tertentu.

Part ini fokus pada **apa yang harus dicek sebelum sistem dianggap layak production**.

---

## 2. Hardening Mindset: Security Invariants

Sebelum checklist, tetapkan invariant. Invariant adalah kondisi yang harus selalu benar.

Contoh invariant untuk Jakarta enterprise app:

```text
1. Semua endpoint state-changing hanya dapat diakses oleh caller terautentikasi.
2. Semua authorization decision dievaluasi server-side.
3. Role eksternal tidak langsung dipakai sebagai permission domain tanpa mapping.
4. Token API hanya diterima jika issuer, audience, expiry, signature, algorithm, dan key valid.
5. Session cookie tidak pernah dikirim lewat HTTP plain.
6. Tenant boundary selalu dievaluasi pada query dan command.
7. Admin endpoint tidak pernah public meskipun gateway salah route.
8. Audit event untuk authentication, authorization denial, dan sensitive action selalu tercatat.
9. Error ke user tidak membocorkan credential validity atau existence user.
10. Jika IdP/policy/token infrastructure gagal, sistem fail closed untuk operasi sensitif.
```

Hardening checklist seharusnya membuktikan invariant tersebut.

---

## 3. Environment and Runtime Checklist

### 3.1 Java Version

Cek:

- [ ] Runtime Java yang dipakai di production diketahui dan terdokumentasi.
- [ ] Build target sesuai runtime container.
- [ ] Library security compatible dengan versi Java tersebut.
- [ ] Tidak ada dependency yang hanya support `javax.*` ketika aplikasi sudah `jakarta.*`.
- [ ] Tidak ada class file version mismatch.
- [ ] Tidak ada illegal reflective access yang diperlukan untuk security-critical path.

Java 8 sampai 25 memiliki perbedaan besar dalam runtime behavior dan ecosystem.

Contoh concern:

| Area | Java 8 | Java 11/17 | Java 21/25 |
|---|---:|---:|---:|
| TLS default | lebih tua | lebih modern | lebih modern |
| virtual thread | tidak ada | tidak ada | ada sejak Java 21 |
| SecurityManager | masih umum | deprecated menuju removal | tidak boleh dijadikan basis security app |
| library support | banyak legacy `javax` | transisi | banyak modern Jakarta |
| container support | Java EE/Jakarta EE lama | Jakarta EE 9/10 umum | Jakarta EE 11+ mulai umum |

Prinsip:

```text
Jangan menjadikan Java runtime sebagai satu-satunya security boundary aplikasi.
```

Application authorization tetap harus eksplisit.

---

### 3.2 Container Version

Cek:

- [ ] Container/app server version terdokumentasi.
- [ ] Jakarta EE profile yang dipakai jelas: Web Profile atau Platform.
- [ ] Servlet version jelas.
- [ ] Jakarta Security version jelas.
- [ ] Jakarta Authentication version jelas jika memakai JASPIC.
- [ ] Jakarta Authorization version jelas jika memakai JACC/provider custom.
- [ ] Vendor-specific security configuration terdokumentasi.
- [ ] Patch cadence jelas.
- [ ] CVE monitoring aktif.

Contoh mapping konseptual:

```text
Java EE 8      -> javax.servlet, javax.annotation, javax.security.enterprise
Jakarta EE 8   -> mostly javax namespace
Jakarta EE 9+  -> jakarta.servlet, jakarta.annotation, jakarta.security.enterprise
Jakarta EE 11  -> Jakarta Security 4.0, Jakarta Authentication 3.1, Jakarta Authorization 3.0 era
```

Production risk besar muncul ketika library dan container tidak satu generasi.

Contoh anti-pattern:

```text
Aplikasi deploy ke Jakarta EE 10 container, tetapi masih membawa javax.servlet-api di WAR.
```

Efek:

- class conflict,
- annotation tidak terbaca,
- filter tidak registered,
- security constraint tidak berlaku,
- runtime error yang terlihat seperti bug random.

---

## 4. Network and Transport Security Checklist

### 4.1 HTTPS Everywhere

Cek:

- [ ] Semua public endpoint hanya via HTTPS.
- [ ] HTTP plain redirect ke HTTPS atau ditolak.
- [ ] Internal service endpoint sensitif juga memakai TLS/mTLS sesuai risk.
- [ ] Tidak ada credential dikirim melalui HTTP.
- [ ] Health check tidak membuka sensitive info.
- [ ] HSTS dipakai pada domain browser-facing yang stabil.

Untuk REST API, OWASP menekankan HTTPS untuk melindungi credentials in transit seperti password, API key, atau JWT.

Prinsip:

```text
Token, session cookie, API key, dan authorization header harus dianggap credential.
Credential tidak boleh melewati jaringan tanpa proteksi transport.
```

---

### 4.2 TLS Termination Boundary

Cek:

- [ ] Lokasi TLS termination jelas: load balancer, ingress, reverse proxy, atau app server.
- [ ] Aplikasi tahu request original scheme lewat trusted forwarded header yang dikontrol.
- [ ] Aplikasi tidak menerima `X-Forwarded-Proto` dari internet langsung.
- [ ] Redirect URL dibangun dari configured external base URL, bukan raw untrusted header.
- [ ] OIDC redirect URI tidak bergantung pada Host header yang bisa dispoof.

Contoh bahaya:

```text
Client -> HTTPS -> ALB -> HTTP -> app
```

Jika app melihat request sebagai HTTP, app bisa:

- membuat redirect callback HTTP,
- tidak set cookie `Secure`,
- salah membangun absolute URL,
- menganggap request tidak secure,
- menciptakan OIDC redirect mismatch.

Hardening:

```text
External URL harus explicit config:
APP_EXTERNAL_BASE_URL=https://secure.example.com
```

Jangan hanya mengandalkan header dari request.

---

### 4.3 mTLS for High-Trust Service Calls

Cek:

- [ ] Service-to-service call sensitif memakai mTLS atau token kuat.
- [ ] Truststore hanya berisi CA yang diperlukan.
- [ ] Client certificate identity dimapping ke service identity yang stabil.
- [ ] Certificate expiry dimonitor.
- [ ] Rotation sudah punya runbook.
- [ ] Revocation strategy jelas.
- [ ] Jika TLS terminated di gateway, aplikasi tidak mempercayai client-cert header kecuali dari trusted proxy.

mTLS bukan pengganti authorization. mTLS menjawab:

```text
Service siapa yang memanggil?
```

Authorization tetap menjawab:

```text
Apakah service itu boleh melakukan action ini terhadap resource ini?
```

---

## 5. Reverse Proxy / API Gateway Checklist

### 5.1 Trusted Header Policy

Cek:

- [ ] Semua header identity dari client dihapus di edge.
- [ ] Gateway menambahkan identity header baru hanya setelah authentication sukses.
- [ ] App hanya percaya identity header jika request datang dari trusted network/proxy.
- [ ] Header identity ditandatangani atau dibungkus internal token untuk high-risk systems.
- [ ] Direct app access dari internet tidak mungkin.

Header raw yang berbahaya jika dipercaya:

```text
X-User
X-Email
X-Roles
X-Groups
X-Forwarded-User
X-Forwarded-Email
X-Client-Cert
X-Original-URI
```

Anti-pattern:

```java
String user = request.getHeader("X-User");
```

Tanpa trust boundary, attacker bisa kirim:

```http
X-User: admin
```

Hardening pattern:

```text
Internet client
  -> Gateway strips all inbound X-User/X-Roles
  -> Gateway authenticates caller
  -> Gateway creates signed internal identity token
  -> Jakarta app validates internal token
  -> App establishes caller principal/groups
```

---

### 5.2 Route and Path Consistency

Cek:

- [ ] Gateway route dan app route sama-sama protected.
- [ ] Tidak ada admin/internal path yang hanya dilindungi di gateway.
- [ ] Path rewrite tidak membuat constraint Servlet miss-match.
- [ ] Trailing slash, encoded slash, double slash diuji.
- [ ] HTTP method override tidak membuka bypass.

Contoh bug:

```text
Gateway protects /admin/*
App exposes /internal/admin/*
Path rewrite maps /admin -> /internal/admin
But direct internal call can hit /internal/admin without auth
```

Hardening:

```text
Sensitive route harus protected di gateway DAN app.
```

---

### 5.3 Gateway vs Application Token Validation

Ada tiga pola:

| Pola | Kelebihan | Risiko |
|---|---|---|
| gateway-only validation | central, cepat | app terlalu percaya network/header |
| app-only validation | app self-contained | setiap app harus benar config |
| gateway + app validation | defense in depth | lebih kompleks |

Checklist minimum jika gateway-only:

- [ ] App tidak reachable selain dari gateway.
- [ ] Gateway strip spoofable headers.
- [ ] Gateway pass identity dalam bentuk signed token/header protected.
- [ ] App tetap melakukan domain authorization.
- [ ] App tetap audit actor/subject.

Untuk high-risk systems, prefer:

```text
Gateway validates coarse access.
Application validates token/identity contract or signed internal assertion.
Application enforces domain authorization.
```

---

## 6. Servlet Session and Cookie Checklist

### 6.1 Session Cookie Attributes

Cek session cookie:

- [ ] `Secure=true` untuk HTTPS production.
- [ ] `HttpOnly=true` untuk session cookie.
- [ ] `SameSite` sesuai arsitektur.
- [ ] `Path` sesempit mungkin.
- [ ] `Domain` tidak terlalu luas.
- [ ] Cookie name tidak misleading.
- [ ] Tidak ada token sensitif di cookie non-HttpOnly tanpa alasan kuat.

Jakarta Servlet menyediakan konfigurasi untuk session tracking cookie dan API cookie; Servlet spec juga mewajibkan container menyediakan kemampuan konfigurasi `HttpOnly` untuk session tracking cookie.

Contoh konfigurasi `web.xml`:

```xml
<session-config>
    <session-timeout>30</session-timeout>
    <cookie-config>
        <http-only>true</http-only>
        <secure>true</secure>
        <name>APPSESSIONID</name>
        <path>/</path>
    </cookie-config>
</session-config>
```

`SameSite` sering vendor-specific atau perlu filter/proxy-level config tergantung container.

---

### 6.2 Session Fixation

Cek:

- [ ] Session ID berubah setelah login sukses.
- [ ] Pre-login session tidak membawa authorization state sensitif.
- [ ] Login flow tidak reuse attacker-controlled session.
- [ ] Logout invalidate session.

Servlet modern menyediakan `changeSessionId()`.

Contoh:

```java
request.changeSessionId();
```

Hardening invariant:

```text
Authentication changes the security identity; therefore session identifier must be rotated.
```

---

### 6.3 Session Timeout

Cek:

- [ ] Idle timeout ditentukan.
- [ ] Absolute timeout ditentukan untuk high-risk application.
- [ ] Remember-me behavior jelas.
- [ ] Sensitive action memerlukan reauthentication/step-up.
- [ ] Session timeout selaras dengan IdP session/token lifetime.

Contoh:

```text
Idle timeout       : 15–30 minutes, depends on risk
Absolute timeout   : 8–12 hours or less for privileged app
Step-up timeout    : 5–15 minutes for sensitive action
```

Jangan asal memilih angka. Pertimbangkan:

- risk data,
- user workflow,
- shared computer probability,
- regulatory expectation,
- IdP session lifetime,
- token refresh behavior.

---

### 6.4 Logout

Cek:

- [ ] Local session invalidated.
- [ ] Security context cleared.
- [ ] Remember-me token invalidated.
- [ ] CSRF token invalidated.
- [ ] Browser cache header benar untuk sensitive pages.
- [ ] OIDC RP-initiated logout jika SSO.
- [ ] Front-channel/back-channel logout support dipahami.
- [ ] Refresh token revoked jika app menyimpan refresh token.
- [ ] Logout endpoint CSRF-protected atau method-safe.

Logout invariant:

```text
Setelah logout, browser tidak boleh dapat melakukan state-changing request memakai session lama.
```

Common bug:

```text
App logout only clears local session, but SSO session remains.
User clicks login and immediately logged in again.
```

Itu bukan selalu bug, tetapi harus menjadi expected behavior yang dijelaskan.

---

## 7. Authentication Checklist

### 7.1 Authentication Mechanism

Cek:

- [ ] Mechanism yang dipakai jelas: Basic, Form, OIDC, client-cert, bearer token, custom.
- [ ] Challenge behavior benar.
- [ ] Login endpoint tidak membuka open redirect.
- [ ] Credential tidak masuk log.
- [ ] Account enumeration dicegah.
- [ ] Brute force/rate limiting tersedia.
- [ ] Lockout/throttling policy tidak mudah DoS.
- [ ] MFA/step-up diterapkan untuk privileged action.

Jakarta Security menyediakan `HttpAuthenticationMechanism` untuk authentication di servlet container dan API seperti `IdentityStore` untuk validasi credential.

---

### 7.2 Basic Auth

Cek jika memakai Basic:

- [ ] Hanya lewat HTTPS.
- [ ] Tidak untuk browser user-facing app kecuali sangat terbatas.
- [ ] Realm jelas.
- [ ] Credential rotation tersedia.
- [ ] Rate limiting tersedia.
- [ ] Tidak memakai Basic untuk long-lived human admin tanpa MFA.

Basic cocok untuk:

- internal tool sederhana,
- temporary integration,
- controlled machine call.

Tidak ideal untuk:

- modern SSO,
- MFA enterprise,
- fine-grained session control.

---

### 7.3 Form Login

Cek:

- [ ] Login form memakai HTTPS.
- [ ] CSRF protection untuk login request.
- [ ] Error generic.
- [ ] Session ID rotate setelah login.
- [ ] Password tidak tersimpan di session.
- [ ] Redirect target divalidasi.
- [ ] Failed login audit.
- [ ] Brute-force throttling.

Generic error:

```text
Invalid username or password.
```

Jangan:

```text
Username exists but password wrong.
```

---

### 7.4 OIDC Login

Cek:

- [ ] Authorization Code + PKCE untuk browser/native/SPAs where relevant.
- [ ] `state` divalidasi.
- [ ] `nonce` divalidasi untuk ID token.
- [ ] Redirect URI exact match.
- [ ] Issuer exact match.
- [ ] Audience/client ID valid.
- [ ] Signature valid.
- [ ] `exp`, `iat`, `nbf` diproses dengan clock skew terbatas.
- [ ] `issuer + sub` dipakai sebagai stable external identity key.
- [ ] Email tidak menjadi primary key identity kecuali memang guaranteed immutable oleh IdP.
- [ ] Logout behavior jelas.
- [ ] Claim mapping deterministic.

Common bug:

```text
App maps user by email.
User email changes.
New login creates duplicate account or takes over wrong account.
```

Hardening:

```text
external_identity_key = issuer + subject
```

---

### 7.5 Password Authentication

Cek:

- [ ] Password disimpan sebagai hash/verifier, bukan encrypted reversible text.
- [ ] Salt unik per password.
- [ ] Algorithm modern dan parameter versioned.
- [ ] Password migration strategy tersedia.
- [ ] Password reset token single-use dan expiry pendek.
- [ ] Password reset tidak bocorkan account existence.
- [ ] Password change invalidates relevant sessions/tokens sesuai risk.
- [ ] Compromised password blocklist dipertimbangkan.

Prinsip:

```text
Aplikasi tidak perlu tahu password asli setelah validasi selesai.
```

---

## 8. Token Validation Checklist

### 8.1 Access Token Validation

Cek untuk JWT access token:

- [ ] Signature valid.
- [ ] Algorithm allowlist.
- [ ] Tidak menerima `alg=none`.
- [ ] `kid` dipakai aman; tidak path traversal/SSRF ke JWKS arbitrary.
- [ ] Issuer exact match.
- [ ] Audience exact match.
- [ ] Expiry valid.
- [ ] Not-before valid.
- [ ] Clock skew kecil dan terdokumentasi.
- [ ] Token type/usage jelas.
- [ ] Scope/claim mapping sesuai API.
- [ ] `sub` diperlakukan sebagai subject, bukan otomatis human user.

Pseudo pipeline:

```text
extract bearer token
  -> parse header safely
  -> choose key from trusted JWKS cache
  -> verify signature
  -> validate issuer
  -> validate audience
  -> validate time claims
  -> validate token type/use
  -> map subject/claims/groups/scopes
  -> establish principal
  -> authorize action/resource
```

---

### 8.2 ID Token Misuse

Cek:

- [ ] API tidak menerima ID token sebagai access token.
- [ ] ID token hanya dipakai untuk login/client authentication context.
- [ ] Resource server hanya menerima access token.

Invariant:

```text
ID token proves authentication event to client.
Access token authorizes access to resource server.
```

Menerima ID token di API sering menciptakan audience confusion.

---

### 8.3 Opaque Token / Introspection

Cek jika memakai opaque token:

- [ ] Introspection endpoint TLS.
- [ ] Client auth untuk introspection.
- [ ] Timeout kecil.
- [ ] Circuit breaker tersedia.
- [ ] Cache active result dengan TTL pendek jika acceptable.
- [ ] Negative result tidak cache terlalu lama.
- [ ] Failure mode jelas: fail closed untuk sensitive API.

Trade-off:

| JWT | Opaque + introspection |
|---|---|
| local validation cepat | centralized status/revocation |
| revocation sulit sampai expiry | butuh network call |
| key rotation complexity | IdP availability dependency |

---

### 8.4 JWKS Caching and Key Rotation

Cek:

- [ ] JWKS URL berasal dari trusted issuer config/discovery.
- [ ] JWKS cache TTL reasonable.
- [ ] Cache refresh saat `kid` unknown.
- [ ] Key rotation tested.
- [ ] Old and new keys overlap selama rollout.
- [ ] IdP outage tidak langsung membuat semua request gagal jika cached key masih valid.
- [ ] Key removal tidak terlalu cepat.

Failure pattern:

```text
IdP rotates signing key.
App JWKS cache still old.
All login/API token validation fails.
```

Hardening pattern:

```text
On unknown kid:
  refresh JWKS once
  retry validation
  if still unknown: reject token and emit security metric
```

---

### 8.5 Token Propagation

Cek:

- [ ] Downstream service tidak menerima user token jika audience bukan downstream.
- [ ] Token exchange dipakai untuk downstream audience jika tersedia.
- [ ] Service token dibedakan dari user token.
- [ ] On-behalf-of actor dicatat.
- [ ] Confused deputy dicegah.

Anti-pattern:

```text
Frontend access token for API A forwarded to API B and API C.
All APIs accept same audience.
```

Hardening:

```text
Each resource server validates its own audience.
Use token exchange or internal signed assertion for delegation.
```

---

## 9. Authorization Checklist

### 9.1 Default Deny

Cek:

- [ ] Endpoint baru default protected.
- [ ] Method baru default protected.
- [ ] Admin/resource mutation default denied unless explicitly allowed.
- [ ] Public endpoints allowlist jelas.
- [ ] `@PermitAll` hanya untuk public-safe endpoint.
- [ ] `@DenyAll` dipakai untuk defensive base class where useful.

Principle:

```text
Unknown route, unknown action, unknown state, unknown tenant => deny.
```

---

### 9.2 Declarative Authorization

Cek:

- [ ] Servlet URL constraints lengkap.
- [ ] JAX-RS resource/method annotations jelas.
- [ ] CDI/EJB method annotations dipakai pada service boundary.
- [ ] Role names stabil dan terdokumentasi.
- [ ] Self-invocation tidak bypass interceptor.
- [ ] Private/final/static methods tidak dijadikan enforcement boundary.
- [ ] Tests membuktikan annotation bekerja di container runtime sebenarnya.

Common failure:

```java
public void approve() {
    this.validatePermission(); // internal call, interceptor may not run
}
```

Authorization check penting harus berada di method boundary yang benar atau explicit service call.

---

### 9.3 Programmatic Domain Authorization

Cek:

- [ ] Authorization tidak hanya role-based untuk object-level/resource-level decisions.
- [ ] Decision input lengkap: subject, action, resource, tenant, state, relationship, context.
- [ ] Tenant isolation dicek di query dan command.
- [ ] Assignment/ownership dicek server-side.
- [ ] Maker-checker/SoD dicek.
- [ ] Delegation punya expiry dan scope.
- [ ] Break-glass override diaudit ketat.
- [ ] Denial reason aman tetapi cukup untuk support.

Canonical model:

```java
record AuthorizationRequest(
    Actor actor,
    Action action,
    ResourceRef resource,
    TenantId tenantId,
    WorkflowState state,
    Relationship relationship,
    RequestContext context
) {}
```

Decision:

```java
record AuthorizationDecision(
    boolean allowed,
    String policyCode,
    String safeReason,
    Map<String, Object> auditAttributes
) {}
```

---

### 9.4 Role/Group/Claim Mapping

Cek:

- [ ] External IdP group tidak dipakai langsung di business logic.
- [ ] Mapping group/claim/scope ke app role terdokumentasi.
- [ ] Role mapping versioned.
- [ ] Environment-specific mapping jelas.
- [ ] Role removal mid-session behavior jelas.
- [ ] Privileged role membutuhkan stronger authentication/MFA.

Pattern:

```text
IdP group/claim -> normalized application role -> domain permission -> authorization decision
```

Bukan:

```text
if (groups.contains("CN=SG-GOV-ACEAS-PROD-CASE-APPROVER-2024")) approve();
```

---

## 10. Multi-Tenancy Checklist

Cek:

- [ ] Tenant resolution source jelas.
- [ ] Tenant dari request path/header/token/session tidak bisa dispoof.
- [ ] Active tenant switching audited.
- [ ] User membership dicek sebelum tenant switch.
- [ ] Query selalu tenant-scoped.
- [ ] Cache key include tenant.
- [ ] Events/messages include tenant context.
- [ ] Admin cross-tenant access explicit and audited.
- [ ] No global `findById(id)` for tenant-owned resource tanpa tenant predicate.

Bad repository:

```java
Optional<Case> findById(UUID id);
```

Better:

```java
Optional<Case> findByIdAndTenantId(UUID id, TenantId tenantId);
```

Hardening invariant:

```text
A caller cannot access a resource unless caller's active tenant is authorized for that resource.
```

---

## 11. Browser Security Checklist

### 11.1 CSRF

Cek:

- [ ] Cookie-authenticated state-changing endpoints CSRF-protected.
- [ ] Safe methods remain safe: GET/HEAD/OPTIONS do not mutate state.
- [ ] CSRF token bound to session or signed.
- [ ] Origin/Referer validation considered as defense-in-depth.
- [ ] SameSite set appropriately.
- [ ] Login/logout CSRF handled.
- [ ] API returning JSON tidak otomatis exempt jika memakai cookie session.

OWASP menjelaskan CSRF sebagai serangan ketika browser user yang sudah terautentikasi dipancing menjalankan action tidak diinginkan ke trusted site.

---

### 11.2 CORS

Cek:

- [ ] CORS allowlist exact, bukan wildcard untuk credentialed request.
- [ ] `Access-Control-Allow-Credentials: true` hanya untuk trusted origin.
- [ ] Origin reflection tidak digunakan tanpa validation.
- [ ] Preflight behavior diuji.
- [ ] CORS policy dikelola konsisten di gateway/app, tidak konflik.
- [ ] CORS tidak dianggap authorization.

Invariant:

```text
CORS controls browser read permission, not business authorization.
```

Server tetap harus authenticate dan authorize setiap request.

---

### 11.3 Clickjacking

Cek:

- [ ] CSP `frame-ancestors` diset untuk UI sensitif.
- [ ] `X-Frame-Options` dipertimbangkan untuk legacy browser.
- [ ] Framing hanya diizinkan untuk trusted parent jika perlu.
- [ ] Admin UI tidak bisa di-frame oleh arbitrary origin.

---

### 11.4 Security Headers

Cek header minimal:

```text
Strict-Transport-Security
Content-Security-Policy
X-Content-Type-Options: nosniff
Referrer-Policy
Permissions-Policy
Cache-Control for sensitive pages
```

Hindari header lama sebagai satu-satunya kontrol jika sudah digantikan CSP modern, tetapi bisa tetap dipakai untuk compatibility.

---

## 12. Admin and Internal Endpoint Checklist

Cek:

- [ ] Admin endpoints require strong auth.
- [ ] Admin endpoints require explicit privileged role.
- [ ] Admin endpoints not exposed publicly by accident.
- [ ] Actuator/metrics/health separated by sensitivity.
- [ ] Debug endpoints disabled in production.
- [ ] Swagger/OpenAPI UI protected or disabled.
- [ ] Job trigger endpoint protected.
- [ ] Internal callback endpoint validates source/signature/token.
- [ ] File download endpoint validates authorization per object.
- [ ] Bulk export endpoint has approval/audit/rate limit.

Common exposed endpoints:

```text
/actuator
/metrics
/health
/env
/configprops
/swagger-ui
/openapi
/admin
/internal
/jobs/run
/debug
```

Hardening:

```text
Public health: liveness only.
Private health: dependencies, build info, version, DB, IdP status.
```

---

## 13. Secret Management Checklist

Cek:

- [ ] Secrets tidak ada di source code.
- [ ] Secrets tidak ada di container image layer.
- [ ] Secrets tidak ada di frontend bundle.
- [ ] Secrets tidak tercetak di log.
- [ ] Secrets diambil dari secret manager / env / mounted secret dengan access control.
- [ ] Secret rotation runbook tersedia.
- [ ] Different env uses different secrets.
- [ ] Least privilege untuk secret access.
- [ ] Secret expiry/rotation monitored.

Examples:

```text
OIDC client secret
JWT signing/private key
mTLS private key
DB credential
API key
SAML signing/decryption key
SMTP credential
Redis password
RabbitMQ password
```

Do not log:

```text
Authorization header
Cookie
Set-Cookie
password
client_secret
refresh_token
private_key
```

---

## 14. Key and Certificate Rotation Checklist

Cek:

- [ ] Signing key rotation tested.
- [ ] JWKS exposes old and new key during overlap.
- [ ] Consumers handle unknown `kid` refresh.
- [ ] Certificate expiry alert before incident.
- [ ] Keystore/truststore update runbook exists.
- [ ] SAML metadata certificate rollover tested.
- [ ] mTLS client cert rotation tested.
- [ ] Emergency key compromise process exists.

Rotation has phases:

```text
1. Publish new key/cert.
2. Start signing/using new key.
3. Keep old key for verification until old tokens/assertions expire.
4. Remove old key.
5. Validate no consumer still depends on old key.
```

Never rotate by deleting old key first if tokens signed by old key are still valid.

---

## 15. IdP and External Dependency Resilience

Cek:

- [ ] IdP discovery cached carefully.
- [ ] JWKS cached.
- [ ] UserInfo dependency timeout small.
- [ ] Token introspection timeout small.
- [ ] Circuit breaker for external auth dependency.
- [ ] Login outage behavior known.
- [ ] Existing session behavior during IdP outage known.
- [ ] Privileged action may require fresh IdP/MFA and can fail closed.
- [ ] Operational dashboard includes IdP health.

Different paths have different tolerance:

| Flow | IdP outage behavior |
|---|---|
| new login | likely unavailable |
| existing local session | may continue until local timeout |
| token validation with cached JWKS | can continue |
| opaque token introspection | likely degraded/unavailable |
| role refresh from IdP | may use cached role briefly or fail closed |

Document explicitly.

---

## 16. Logging, Audit, and Monitoring Checklist

### 16.1 Security Logging

Cek log security events:

- [ ] Login success.
- [ ] Login failure.
- [ ] Logout.
- [ ] Token validation failure category.
- [ ] Authorization denial.
- [ ] Role mapping failure.
- [ ] Tenant access denial.
- [ ] CSRF failure.
- [ ] CORS denial where useful.
- [ ] Admin action.
- [ ] Secret/key/cert rotation.
- [ ] Policy config change.

Do not log raw secrets.

Good event fields:

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "actorId": "user-123",
  "issuer": "https://idp.example.com",
  "subject": "00uabc",
  "tenantId": "agency-1",
  "action": "CASE_APPROVE",
  "resourceType": "CASE",
  "resourceId": "case-999",
  "policyCode": "MAKER_CANNOT_APPROVE_OWN_CASE",
  "correlationId": "req-abc",
  "ip": "203.0.113.10",
  "userAgentHash": "...",
  "timestamp": "2026-06-17T10:15:30Z"
}
```

---

### 16.2 Audit Trail

Cek:

- [ ] Audit is separate from debug log.
- [ ] Audit event immutable enough for investigation.
- [ ] Actor and on-behalf-of captured.
- [ ] Before/after values captured for sensitive changes.
- [ ] Authorization decision captured for sensitive action.
- [ ] Denied sensitive actions captured.
- [ ] Audit storage access restricted.
- [ ] Retention policy defined.
- [ ] Tamper detection considered.

Audit question yang harus bisa dijawab:

```text
Who did what, to which resource, in which tenant, from where, using which authority, at what time, and what was the outcome?
```

---

### 16.3 Metrics and Alerts

Cek metrics:

```text
auth.login.success.count
auth.login.failure.count
auth.token.validation.failure.count
authz.denied.count
csrf.failure.count
cors.denied.count
jwt.unknown_kid.count
jwks.refresh.failure.count
idp.discovery.failure.count
introspection.failure.count
session.created.count
session.expired.count
admin.action.count
breakglass.used.count
```

Alert contoh:

- sudden spike login failures,
- sudden spike 403 for same role,
- unknown `kid` spike,
- JWKS refresh failure,
- IdP unavailable,
- cert expiring soon,
- admin action from unusual source,
- break-glass usage.

---

## 17. Error Handling Checklist

Cek:

- [ ] 401 for unauthenticated or invalid/expired credential.
- [ ] 403 for authenticated but unauthorized.
- [ ] 404 concealment only when intentionally designed.
- [ ] `WWW-Authenticate` correct for bearer/basic APIs.
- [ ] No stack trace to user.
- [ ] Generic login error.
- [ ] Token validation error not overly detailed to external caller.
- [ ] Correlation ID returned.
- [ ] Detailed cause logged internally safely.
- [ ] Frontend can distinguish login expired vs forbidden.

Good API response:

```json
{
  "type": "https://errors.example.com/forbidden",
  "title": "Forbidden",
  "status": 403,
  "code": "ACCESS_DENIED",
  "message": "You are not allowed to perform this action.",
  "correlationId": "req-abc"
}
```

Bad response:

```json
{
  "error": "User fajar has role CASE_OFFICER but lacks CASE_APPROVER in tenant CEA-PROD because group CN=... missing"
}
```

---

## 18. Data Access and Query Hardening Checklist

Cek:

- [ ] Authorization enforced before mutation.
- [ ] Query includes tenant/resource scope.
- [ ] Bulk/list endpoints apply data scope.
- [ ] Search endpoint cannot reveal unauthorized resource IDs.
- [ ] Count endpoint cannot leak cross-tenant data.
- [ ] Export endpoint has stricter authorization.
- [ ] Attachment/document endpoint checks object-level permission.
- [ ] Soft-deleted/archived resource access controlled.

Bad:

```sql
SELECT * FROM cases WHERE id = ?
```

Better:

```sql
SELECT *
FROM cases
WHERE id = ?
  AND tenant_id = ?
  AND status <> 'DELETED'
```

Then domain authorization still checks action/resource/state.

---

## 19. Cache Hardening Checklist

Cek:

- [ ] Cache key includes tenant.
- [ ] Cache key includes authorization-relevant dimensions.
- [ ] Authorization decision cache TTL short.
- [ ] Role/group cache invalidation strategy exists.
- [ ] Token/JWKS cache separated.
- [ ] Negative cache used carefully.
- [ ] Cache poisoning considered.
- [ ] Sensitive data not cached in browser/shared cache.

Bad:

```text
case:123 -> Case data
```

Better:

```text
tenant:CEA:case:123 -> Case data
```

For authorization decision cache:

```text
actor + tenant + action + resource + state + policyVersion -> decision
```

But beware state changes.

---

## 20. Async, Messaging, and Background Job Checklist

Cek:

- [ ] Background job has explicit system actor.
- [ ] User-triggered async task stores initiator.
- [ ] Message includes tenant and actor context where needed.
- [ ] Consumer revalidates permission if action delayed and sensitive.
- [ ] Outbox event includes audit correlation.
- [ ] MDC/security context cleared after processing.
- [ ] Thread pool reuse does not leak previous identity.
- [ ] Scheduled job permissions are least privilege.

Pattern:

```text
initiator = human/service that requested work
executor  = system component that performs work
subject   = entity being acted upon
```

Audit should not pretend background job is the human user if it is actually system execution. Use on-behalf-of.

---

## 21. File Upload/Download Security Checklist

Cek:

- [ ] Upload endpoint authenticated.
- [ ] Upload authorization checks resource/tenant.
- [ ] File type validation.
- [ ] Size limit.
- [ ] Malware scan where required.
- [ ] Filename sanitized.
- [ ] Storage path not user-controlled.
- [ ] Download endpoint object-level authorized.
- [ ] Presigned URL expiry short.
- [ ] Presigned URL generation authorized.
- [ ] Audit for sensitive download/export.

Bad:

```text
/download?path=/data/tenant-a/case-1/doc.pdf
```

Better:

```text
GET /cases/{caseId}/documents/{documentId}
```

Then server resolves document by tenant/resource and checks permission.

---

## 22. Rate Limiting and Abuse Protection Checklist

Cek:

- [ ] Login rate limit.
- [ ] Password reset rate limit.
- [ ] OTP/MFA attempt rate limit.
- [ ] Token endpoint protected by IdP.
- [ ] Expensive search endpoint rate-limited.
- [ ] Export endpoint rate-limited.
- [ ] Admin operation rate-limited/audited.
- [ ] Per-IP and per-account strategy considered.
- [ ] Lockout does not enable easy account DoS.

Pattern:

```text
soft throttle -> CAPTCHA/step-up -> temporary lock -> support/admin recovery
```

Avoid immediate permanent lockout based only on attacker-controllable input.

---

## 23. Dependency and Supply Chain Checklist

Cek:

- [ ] Dependency scanning enabled.
- [ ] Jakarta API dependencies scope correct (`provided` when container supplies).
- [ ] No duplicate `javax`/`jakarta` APIs causing shadowing.
- [ ] Security library maintained.
- [ ] JWT library rejects unsafe algorithms by config.
- [ ] XML/SAML parser hardened against XXE and signature wrapping.
- [ ] Maven/Gradle lockfile or dependency management used.
- [ ] Container base image patched.
- [ ] SBOM produced where required.

Java/Jakarta common dependency trap:

```text
Including servlet-api jar inside WAR can conflict with container's Servlet API.
```

Use `provided` for APIs supplied by app server.

---

## 24. Configuration Hardening Checklist

Cek:

- [ ] Prod config separate from dev config.
- [ ] Dev/test backdoor disabled.
- [ ] Demo users absent in prod.
- [ ] Default admin password absent.
- [ ] Feature flags security reviewed.
- [ ] Debug logging disabled for security packages unless temporary incident.
- [ ] Allowed origins/audiences/issuers are explicit.
- [ ] No wildcard issuer/audience.
- [ ] Clock skew config reasonable.
- [ ] All external URLs canonical.

Bad:

```properties
security.enabled=false
cors.allowedOrigins=*
jwt.acceptedAudience=*
oidc.validateIssuer=false
```

Production should treat these as release blockers.

---

## 25. Deployment Checklist

Before release:

- [ ] Security regression suite passes.
- [ ] Negative authorization tests pass.
- [ ] Tenant isolation tests pass.
- [ ] OIDC login test passes.
- [ ] Token validation failure tests pass.
- [ ] JWKS rotation test or simulation passes.
- [ ] Logout test passes.
- [ ] CSRF test passes.
- [ ] CORS test passes.
- [ ] Admin endpoint exposure scan passes.
- [ ] Headers verified.
- [ ] Cookie flags verified in real browser.
- [ ] Audit events verified.
- [ ] Rollback plan ready.
- [ ] Secret/key/cert dependencies verified.

Use smoke test commands:

```bash
curl -I https://app.example.com/
curl -I https://app.example.com/admin
curl -H 'Authorization: Bearer invalid' https://api.example.com/cases
curl -H 'Origin: https://evil.example' -I https://api.example.com/cases
```

Also test through real gateway, not only localhost.

---

## 26. Runtime Verification Checklist

After deployment:

- [ ] Login success works.
- [ ] Login failure generic.
- [ ] Unauthorized endpoint returns 401/redirect as expected.
- [ ] Forbidden endpoint returns 403.
- [ ] Session cookie has `Secure`, `HttpOnly`, `SameSite` expected.
- [ ] Logout invalidates session.
- [ ] Token API rejects wrong audience.
- [ ] Token API rejects expired token.
- [ ] Admin endpoint not public.
- [ ] Audit event emitted for sensitive action.
- [ ] Metrics are visible.
- [ ] Alerts are not broken.

Runtime check with browser devtools:

```text
Application -> Cookies -> verify Secure/HttpOnly/SameSite/Domain/Path
Network -> login/logout/API -> verify status/header/cache behavior
```

---

## 27. Incident Response Runbook Checklist

Have runbooks for:

- [ ] IdP outage.
- [ ] JWKS/key rotation failure.
- [ ] Certificate expired.
- [ ] Mass login failure.
- [ ] Unexpected 403 spike.
- [ ] Suspicious admin action.
- [ ] Token signing key compromise.
- [ ] User account compromise.
- [ ] Role mapping incident.
- [ ] Cross-tenant data exposure suspicion.
- [ ] Audit pipeline outage.
- [ ] Secret leakage.

Each runbook should include:

```text
1. Detection signal
2. Immediate containment
3. Impact assessment
4. Evidence collection
5. Recovery steps
6. Communication path
7. Post-incident fixes
```

Example: JWKS rotation failure

```text
Signal:
  auth.token.validation.failure spikes with unknown_kid.

Containment:
  Confirm IdP key set.
  Refresh app JWKS cache.
  Roll back IdP signing key if necessary.

Assessment:
  Which apps affected?
  Login only or API too?
  Any accepted invalid token? Usually no, but verify.

Recovery:
  Restore overlapping old/new keys.
  Restart or invalidate cache if needed.

Prevention:
  Add key rotation staging test.
  Add unknown_kid metric alert.
```

---

## 28. Production Hardening Matrix

| Control Area | Minimum | Stronger | High Assurance |
|---|---|---|---|
| Transport | HTTPS public | TLS internal | mTLS service-to-service |
| Session | Secure/HttpOnly cookie | SameSite + fixation defense | absolute timeout + step-up |
| Token | issuer/audience/signature/exp | JWKS rotation handling | token exchange + PoP/mTLS-bound |
| Authorization | `@RolesAllowed` | domain permission service | policy versioning + decision audit |
| Tenant | tenant predicate | tenant-aware cache/event | DB/RLS or separate schema support |
| Audit | sensitive action log | structured audit events | tamper-resistant audit pipeline |
| Secrets | secret manager | rotation runbook | automated rotation + break-glass |
| Gateway | strip spoofed headers | signed internal identity | app validates internal assertion |
| Testing | happy path | negative/bypass tests | attack simulation in CI/CD |
| Incident | manual docs | runbook + alert | game day exercises |

---

## 29. Example Reference Configuration Blueprint

### 29.1 External Browser App

```text
Browser
  -> HTTPS
  -> WAF / CDN optional
  -> ALB / ingress
  -> reverse proxy
  -> Jakarta web app
  -> OIDC IdP
```

Controls:

```text
- HTTPS only
- HSTS
- Secure/HttpOnly/SameSite session cookie
- OIDC auth code + PKCE
- CSRF token for state-changing form/API if cookie-authenticated
- CSP frame-ancestors
- CORS allowlist if SPA is separate origin
- server-side authorization
- audit sensitive action
```

---

### 29.2 API Resource Server

```text
Client
  -> HTTPS
  -> API Gateway
  -> Jakarta REST API
  -> Domain services
```

Controls:

```text
- Bearer access token only, no ID token
- issuer/audience/signature/time validation
- scope/role/claim mapping
- 401/403 correct semantics
- per-resource authorization
- tenant-safe query
- request correlation ID
- audit denied/sensitive actions
```

---

### 29.3 Internal Service-to-Service

```text
Service A
  -> mTLS and/or OAuth2 client credentials/token exchange
  -> Service B
```

Controls:

```text
- service identity explicit
- audience-specific token
- mTLS cert rotation
- no trust solely by network
- least privilege service role
- on-behalf-of context when user initiated
- audit downstream action
```

---

## 30. Java/Jakarta Specific Code Checklist

### 30.1 Servlet Filter

Cek:

- [ ] Filter order correct.
- [ ] Auth filter runs before authorization/domain filter.
- [ ] CSRF filter runs before mutation handler.
- [ ] MDC cleared in `finally`.
- [ ] Response committed handling correct.
- [ ] Async dispatch considered.

Example:

```java
try {
    correlation.bind(request);
    chain.doFilter(request, response);
} finally {
    correlation.clear();
    SecurityMdc.clear();
}
```

---

### 30.2 JAX-RS Filter

Cek:

- [ ] `@Priority` correct.
- [ ] Authentication before authorization.
- [ ] Name-bound filters not accidentally missing resource.
- [ ] Exception mapper does not leak details.
- [ ] 401 includes correct `WWW-Authenticate` where applicable.

---

### 30.3 CDI/EJB Method Security

Cek:

- [ ] Security interceptor active.
- [ ] Self-invocation not relied upon.
- [ ] Transaction ordering understood.
- [ ] Authorization decision inside transaction where state must be locked.
- [ ] Audit event persisted with business transaction or outbox.

---

### 30.4 Jakarta Security

Cek:

- [ ] `SecurityContext` not used as domain actor directly without normalization.
- [ ] `IdentityStore` returns stable groups.
- [ ] `CredentialValidationResult` caller principal stable.
- [ ] Custom `HttpAuthenticationMechanism` is stateless/thread-safe.
- [ ] Multiple mechanisms do not create ambiguous identity.

---

## 31. Hardening Anti-Patterns

### Anti-pattern 1: “Gateway sudah auth, app tidak perlu auth”

Problem:

```text
If app is reachable through another path or trusted headers spoofed, bypass occurs.
```

Better:

```text
Gateway auth + app verifies trusted assertion + app domain authorization.
```

---

### Anti-pattern 2: “Role equals permission”

Problem:

```text
CASE_APPROVER role may not be enough if actor created the case.
```

Better:

```text
Role is eligibility. Permission decision uses resource state and relationship.
```

---

### Anti-pattern 3: “Token signature valid means access allowed”

Problem:

```text
Wrong audience or wrong issuer can still have valid signature.
```

Better:

```text
Validate issuer, audience, time, type, scope, and domain permission.
```

---

### Anti-pattern 4: “CORS protects API”

Problem:

```text
Non-browser clients ignore CORS.
```

Better:

```text
CORS is browser read control. API must authenticate and authorize.
```

---

### Anti-pattern 5: “Audit = log.info”

Problem:

```text
Debug logs are noisy, mutable, and not designed as evidence.
```

Better:

```text
Structured audit events with actor/action/resource/tenant/outcome/correlation.
```

---

### Anti-pattern 6: “Admin endpoint hidden by URL”

Problem:

```text
Obscurity is not access control.
```

Better:

```text
Admin endpoint requires authentication, privileged authorization, network restriction, and audit.
```

---

### Anti-pattern 7: “One global cache for authorization”

Problem:

```text
Authorization depends on tenant, actor, resource, state, and policy version.
```

Better:

```text
Cache only carefully, with full dimensions and short TTL.
```

---

## 32. Final Pre-Production Checklist

Use this as condensed release gate.

### Identity and Authentication

- [ ] Authentication mechanism documented.
- [ ] OIDC/token validation exact.
- [ ] Session fixation handled.
- [ ] Logout tested.
- [ ] Account enumeration mitigated.
- [ ] Brute force throttling exists.

### Authorization

- [ ] Default deny.
- [ ] URL/method security tested.
- [ ] Domain permission service tested.
- [ ] Tenant isolation tested.
- [ ] Admin endpoints protected.
- [ ] Role/group mapping reviewed.

### Browser/API Boundary

- [ ] CSRF protected where cookie-authenticated.
- [ ] CORS allowlist exact.
- [ ] Security headers set.
- [ ] 401/403 semantics correct.
- [ ] Sensitive error details hidden.

### Token/Key/Secret

- [ ] JWKS caching/rotation tested.
- [ ] Secrets not in code/log/image.
- [ ] Certificate expiry monitored.
- [ ] Rotation runbook exists.

### Infrastructure

- [ ] HTTPS enforced.
- [ ] Forwarded headers trusted only from proxy.
- [ ] Identity headers stripped at edge.
- [ ] Direct app access blocked.
- [ ] Health/debug endpoints controlled.

### Observability

- [ ] Security metrics exist.
- [ ] Audit events exist.
- [ ] Alerts configured.
- [ ] Correlation ID end-to-end.
- [ ] Incident runbooks ready.

### Testing

- [ ] Negative auth tests pass.
- [ ] Bypass tests pass.
- [ ] Tenant tests pass.
- [ ] Token invalid tests pass.
- [ ] CSRF/CORS tests pass.
- [ ] Deployment smoke tests pass.

---

## 33. How to Think Like a Top 1% Engineer Here

A normal checklist asks:

```text
Did we enable security?
```

A stronger engineer asks:

```text
Where exactly is identity established?
Where exactly is permission evaluated?
What can bypass this path?
What happens if IdP is down?
What happens if role changes mid-session?
What happens if key rotates?
What happens if gateway strips or fails to strip headers?
What evidence do we have after the action?
Can we prove tenant isolation with tests?
Can we explain denial deterministically?
```

The highest-level mental model:

```text
Authentication establishes a caller.
Authorization constrains what the caller can do.
Session/token carries state across calls.
Gateway/container/framework provide enforcement hooks.
Domain model provides real permission meaning.
Audit provides evidence.
Operations keep the assumptions true over time.
```

Hardening is the discipline of ensuring those statements remain true under production pressure.

---

## 34. Summary

Production hardening for Jakarta security systems is not a single API call. It is a cross-layer discipline:

```text
Runtime/container
  -> network/proxy
  -> authentication
  -> session/token
  -> role/claim mapping
  -> domain authorization
  -> browser/API protection
  -> audit/monitoring
  -> testing
  -> incident response
```

A Jakarta application can use `SecurityContext`, `IdentityStore`, `HttpAuthenticationMechanism`, Servlet constraints, JAX-RS filters, CDI/EJB interceptors, Jakarta Authentication, Jakarta Authorization, OIDC, OAuth2, SAML, mTLS, and gateway integration. But production security only works if these pieces form one coherent enforcement chain.

Hardening means asking:

```text
What must never happen?
Which control prevents it?
How do we know the control works?
What happens when dependency/configuration/human operation fails?
What evidence remains afterward?
```

That is the standard for systems that need to survive real enterprise/regulatory environments.

---

## 35. Status Seri

Selesai:

```text
Part 32 — Production Hardening Checklist for Jakarta Security Systems
```

Seri belum selesai.

Berikutnya:

```text
Part 33 — Failure Modelling: How Jakarta Security Systems Actually Break
```
