# Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Certificate, OIDC

**Series:** `learn-java-jakarta-security-authentication-authorization-identity`  
**File:** `learn-java-jakarta-security-authentication-authorization-identity-part-05-authentication-mechanisms.md`  
**Scope:** Java 8–25, Java EE / Jakarta EE, `javax.*` to `jakarta.*`, Servlet Security, Jakarta Security, Jakarta Authentication, enterprise identity integration  
**Status:** Part 05 of 35 — belum bagian terakhir

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membangun fondasi berikut:

1. **Part 00** — mental model enterprise Java security.
2. **Part 01** — vocabulary inti: identity, principal, subject, caller, group, role, permission.
3. **Part 02** — sejarah layer: JAAS, JACC/Jakarta Authorization, JASPIC/Jakarta Authentication, Java EE Security, Jakarta Security.
4. **Part 03** — container security architecture.
5. **Part 04** — Servlet Security foundation.

Sekarang kita masuk ke pertanyaan yang lebih konkret:

> Ketika request masuk ke aplikasi Java/Jakarta, mekanisme apa yang benar-benar dipakai untuk mengenali caller?

Bagian ini membahas **authentication mechanism**, bukan sekadar “fitur login”. Authentication mechanism adalah komponen yang menjembatani **protocol-level interaction** dengan **container-level identity establishment**.

Di aplikasi enterprise, login bukan hanya form HTML. Login bisa berupa:

- browser mengirim `Authorization: Basic ...`,
- browser redirect ke login page,
- client memberikan TLS certificate,
- user diarahkan ke Identity Provider via OIDC,
- SPA mendapatkan token lalu backend memvalidasi bearer token,
- API gateway sudah melakukan authentication lalu meneruskan identity header,
- aplikasi memilih mekanisme berbeda untuk URL berbeda,
- user biasa login dengan OIDC tetapi admin endpoint perlu mTLS atau step-up authentication.

Tujuan Part 05 adalah membuat kita mampu melihat authentication sebagai **state transition dan trust establishment**, bukan sebagai template konfigurasi.

---

## 1. Definisi: Apa Itu Authentication Mechanism?

Authentication mechanism adalah cara sistem:

1. **mendeteksi apakah request sudah memiliki bukti identitas**,  
2. **mengambil credential atau proof dari request**,  
3. **memvalidasi credential/proof**,  
4. **membangun caller identity**,  
5. **memberi tahu container bahwa caller sudah authenticated**,  
6. **membuat challenge atau redirect bila belum authenticated**,  
7. **menghasilkan failure response bila authentication gagal**.

Dalam Jakarta Security, konsep ini direpresentasikan oleh `HttpAuthenticationMechanism`.

Mental model sederhananya:

```text
HTTP request
   |
   v
Authentication Mechanism
   |
   +-- extract credential/proof
   +-- validate or delegate validation
   +-- produce authenticated caller + groups
   +-- tell container about identity
   v
Container security context
   |
   v
Authorization layer
```

Authentication mechanism **bukan** tempat utama untuk business authorization. Ia menjawab:

```text
Who is calling?
```

Bukan:

```text
Is this caller allowed to approve this case?
```

Authorization nanti menjawab pertanyaan kedua.

---

## 2. Authentication Mechanism vs Identity Store vs Authorization

Banyak bug security terjadi karena tiga konsep ini dicampur.

| Konsep | Pertanyaan | Contoh |
|---|---|---|
| Authentication mechanism | Bagaimana credential/proof diperoleh dari request? | Basic, Form, OIDC, Client Cert |
| Identity store | Bagaimana credential divalidasi dan group diperoleh? | DB user table, LDAP, external user service |
| Authorization | Apa yang boleh dilakukan caller? | `@RolesAllowed`, permission check, domain policy |

Contoh:

```text
Browser submits username/password form
   |
   v
Form authentication mechanism extracts username/password
   |
   v
IdentityStore validates password and returns groups
   |
   v
Container creates caller principal
   |
   v
Authorization checks role/permission
```

Untuk OIDC:

```text
Browser redirected back from IdP with authorization code
   |
   v
OIDC authentication mechanism exchanges code for tokens
   |
   v
Mechanism validates ID token / provider response
   |
   v
Groups/claims are mapped to Jakarta groups
   |
   v
Container creates caller principal
```

Untuk client certificate:

```text
TLS handshake receives client certificate
   |
   v
Container validates certificate chain/trust
   |
   v
Mechanism maps certificate subject/SAN to principal
   |
   v
Container creates caller principal
```

Jangan membangun arsitektur seperti ini:

```text
Controller checks username/password manually
   |
   v
Sets session.setAttribute("user", user)
   |
   v
Application pretends user is logged in
```

Itu mungkin “bekerja” untuk UI, tetapi sering tidak berintegrasi dengan:

- `request.getUserPrincipal()`,
- `request.isUserInRole(...)`,
- `SecurityContext`,
- `@RolesAllowed`,
- servlet constraints,
- container-managed authorization,
- audit container,
- logout container,
- propagation ke downstream component.

---

## 3. Dua Keluarga Besar: Container-Managed vs Application-Managed Authentication

### 3.1 Container-managed authentication

Container-managed authentication berarti mekanisme authentication diketahui oleh container, sehingga container dapat membangun security context resmi.

Contoh:

- Servlet `BASIC`, `FORM`, `CLIENT-CERT`,
- Jakarta Security `@BasicAuthenticationMechanismDefinition`,
- Jakarta Security `@FormAuthenticationMechanismDefinition`,
- Jakarta Security `@CustomFormAuthenticationMechanismDefinition`,
- Jakarta Security `@OpenIdAuthenticationMechanismDefinition`,
- custom `HttpAuthenticationMechanism`,
- Jakarta Authentication / JASPIC `ServerAuthModule`.

Keuntungan:

- bekerja dengan `getUserPrincipal()`,
- bekerja dengan `isUserInRole()`,
- bekerja dengan declarative authorization,
- role mapping dapat dikelola container,
- logout lebih konsisten,
- audit lebih mudah,
- portability lebih baik bila mengikuti spec.

### 3.2 Application-managed authentication

Application-managed authentication berarti aplikasi sendiri yang mengelola login state.

Contoh:

```java
@PostMapping("/login")
public Response login(LoginRequest req, HttpSession session) {
    User user = userService.verify(req.username(), req.password());
    session.setAttribute("user", user);
    return ok();
}
```

Ini umum di framework tertentu, tetapi di Jakarta EE murni perlu hati-hati. Jika hanya menyimpan user di session, container belum tentu tahu identity tersebut.

Risiko:

- `@RolesAllowed` tidak berfungsi sesuai ekspektasi,
- role check jadi tersebar manual,
- logout tidak membersihkan semua state,
- session fixation lebih mudah terjadi,
- audit tidak konsisten,
- permission check bisa bypass lewat endpoint lain,
- integrasi dengan JAX-RS/EJB/CDI security lemah.

Application-managed authentication tidak selalu salah, tetapi harus sadar bahwa Anda sedang mengambil alih tanggung jawab container.

---

## 4. Lifecycle Umum Authentication Mechanism

Setiap mechanism, baik Basic, Form, Client-Cert, OIDC, maupun custom, bisa dipahami sebagai lifecycle ini:

```text
1. Request enters protected resource
2. Container asks: is caller already authenticated?
3. If yes:
      continue request
4. If no:
      mechanism checks whether request contains authentication material
5. If material exists:
      validate material
6. If valid:
      establish caller principal + groups
      continue request
7. If invalid:
      return authentication failure
8. If material does not exist:
      send challenge / redirect / continue negotiation
```

Dalam HTTP, hasilnya sering berupa:

| Situation | Response |
|---|---|
| Belum login browser form | `302` redirect ke login page |
| Belum login Basic API | `401` + `WWW-Authenticate` |
| Token expired API | `401` |
| Caller authenticated tapi tidak punya hak | `403` |
| Client cert tidak valid | TLS handshake failure atau `403/401` tergantung layer |
| OIDC belum login | `302` ke Authorization Server |
| OIDC callback error | error page / `401` / controlled failure |

Invariant penting:

```text
401 means authentication is required or failed.
403 means authentication may have succeeded, but authorization denied.
```

Di production, membedakan `401` dan `403` sangat penting untuk debugging, API contract, dan user experience.

---

## 5. Basic Authentication

### 5.1 Mental model

HTTP Basic Authentication adalah mekanisme di mana client mengirim header:

```http
Authorization: Basic base64(username:password)
```

Server merespons request unauthenticated dengan challenge:

```http
WWW-Authenticate: Basic realm="ExampleRealm"
```

Browser atau client HTTP lalu mengirim username/password di setiap request ke protected resource.

### 5.2 Sifat utama

Basic Authentication:

- sederhana,
- stateless dari sisi protocol,
- umum untuk API internal sederhana,
- mudah dites dengan `curl`,
- tidak membutuhkan form login,
- sangat bergantung pada TLS,
- kurang cocok untuk browser-facing app modern.

Credential tidak dienkripsi oleh Basic Auth itu sendiri. Ia hanya di-base64. Proteksi sebenarnya datang dari HTTPS/TLS.

### 5.3 Flow

```text
Client -> GET /admin
Server -> 401 WWW-Authenticate: Basic realm="admin"
Client -> GET /admin Authorization: Basic ...
Server -> validate username/password
Server -> establish principal
Server -> apply authorization
```

### 5.4 Jakarta Security-style sketch

```java
import jakarta.security.enterprise.authentication.mechanism.http.BasicAuthenticationMechanismDefinition;
import jakarta.security.enterprise.identitystore.DatabaseIdentityStoreDefinition;

@BasicAuthenticationMechanismDefinition(
    realmName = "admin-realm"
)
@DatabaseIdentityStoreDefinition(
    dataSourceLookup = "java:global/jdbc/AppDS",
    callerQuery = "select password_hash from app_user where username = ?",
    groupsQuery = "select role_name from app_user_role where username = ?"
)
public class SecurityConfig {
}
```

Catatan:

- ini hanya contoh konseptual,
- detail password hashing, caller query, dan group query bergantung implementasi,
- jangan menyimpan plaintext password.

### 5.5 Kapan cocok?

Basic Auth cocok untuk:

- endpoint internal sederhana,
- admin/debug endpoint yang dilindungi network dan TLS,
- service-to-service legacy,
- testing endpoint,
- prototyping identity store.

Basic Auth kurang cocok untuk:

- public browser app,
- app dengan logout UX yang baik,
- app dengan MFA/step-up,
- app dengan SSO,
- app yang butuh fine-grained session lifecycle,
- app yang rentan credential replay.

### 5.6 Failure model

| Failure | Penyebab | Dampak |
|---|---|---|
| Credential bocor di log | Header `Authorization` dilog | Account compromise |
| Browser cache credential | Browser menyimpan Basic credential | Logout sulit |
| Tidak pakai TLS | Credential base64 bisa dibaca | Credential theft |
| Realm salah | Browser memakai credential lama | Login loop / wrong user |
| Identity store lambat | Setiap request validasi password | Latency / DB pressure |
| Brute force | Tidak ada rate limit | Account guessing |

### 5.7 Production checklist Basic Auth

Gunakan Basic Auth hanya jika:

```text
[ ] HTTPS enforced
[ ] Authorization header redacted from logs
[ ] Rate limiting enabled
[ ] Account lockout or throttling exists
[ ] Password hashing strong
[ ] Realm name intentional
[ ] Endpoint scope narrow
[ ] No sensitive browser-facing UX expectation
[ ] Monitoring for repeated failures
```

---

## 6. Form Authentication

### 6.1 Mental model

Form Authentication adalah mekanisme di mana user mengakses protected page, container redirect ke login page, user submit username/password, lalu container membuat authenticated session.

Flow klasik:

```text
User requests /case/123
   |
   v
Not authenticated
   |
   v
Redirect to /login
   |
   v
User submits username/password
   |
   v
Container validates credential
   |
   v
Container creates/updates authenticated session
   |
   v
Redirect back to original URL
```

Form auth cocok untuk browser-based server-rendered application atau hybrid app yang masih memakai cookie session.

### 6.2 Servlet `FORM` model klasik

Di `web.xml`, model klasik terlihat seperti:

```xml
<login-config>
    <auth-method>FORM</auth-method>
    <realm-name>app-realm</realm-name>
    <form-login-config>
        <form-login-page>/login.xhtml</form-login-page>
        <form-error-page>/login-error.xhtml</form-error-page>
    </form-login-config>
</login-config>
```

Dalam model Servlet klasik, form submit biasanya memakai field dan endpoint tertentu sesuai aturan container. Banyak container historically menggunakan `j_security_check`, `j_username`, `j_password`.

### 6.3 Jakarta Security form definition sketch

```java
import jakarta.security.enterprise.authentication.mechanism.http.FormAuthenticationMechanismDefinition;
import jakarta.security.enterprise.authentication.mechanism.http.LoginToContinue;

@FormAuthenticationMechanismDefinition(
    loginToContinue = @LoginToContinue(
        loginPage = "/login",
        errorPage = "/login-error"
    )
)
public class SecurityConfig {
}
```

### 6.4 Session establishment

Form auth biasanya menghasilkan server-side session:

```text
Authenticated session = proof that authentication happened earlier
```

Session kemudian diikat ke browser via cookie.

Security invariant:

```text
After successful authentication, session id must not be attacker-controlled.
```

Karena itu session fixation protection penting.

### 6.5 Login CSRF

Banyak orang hanya memikirkan CSRF setelah login. Tetapi login juga bisa menjadi target CSRF.

Login CSRF scenario:

```text
Attacker logs victim browser into attacker's account
Victim unknowingly performs actions in attacker's account
Attacker later observes effects
```

Dampaknya bergantung aplikasi, tetapi bisa serius pada app yang menyimpan sensitive data, payment, profile, atau workflow actions.

Mitigasi:

- CSRF token di login form,
- SameSite cookie,
- validate origin/referer untuk state-changing auth endpoints,
- avoid silent login side effects,
- clear pre-auth state after login.

### 6.6 Original request preservation

Form auth biasanya menyimpan original URL agar setelah login user dikembalikan.

Risiko:

- open redirect,
- redirect ke external domain,
- redirect loop,
- redirect ke URL yang sudah tidak valid,
- method/body tidak bisa dipulihkan untuk POST besar.

Rule praktis:

```text
Only redirect to local, normalized, allowed paths.
Never trust arbitrary returnUrl blindly.
```

### 6.7 Kapan cocok?

Form Auth cocok untuk:

- server-rendered Jakarta web app,
- internal enterprise app dengan simple username/password,
- app yang tidak butuh external SSO,
- app yang ingin memanfaatkan container session.

Kurang cocok untuk:

- modern SSO-first enterprise,
- SPA pure token flow,
- app dengan banyak identity provider,
- API-only backend,
- mobile client,
- passwordless/MFA-heavy environment.

### 6.8 Failure model Form Auth

| Failure | Penyebab | Dampak |
|---|---|---|
| Session fixation | Session ID tidak diganti setelah login | Account takeover |
| Open redirect | `returnUrl` tidak divalidasi | Phishing / token leak |
| Login CSRF | Login form tanpa CSRF defense | Confused session |
| Brute force | No throttling | Account compromise |
| Error detail bocor | “user exists but password wrong” | Account enumeration |
| Password di log | form body dilog | Credential leak |
| Wrong SameSite | cookie tidak terkirim / terlalu longgar | Login gagal / CSRF risk |
| Redirect loop | login page protected | User tidak bisa login |

---

## 7. Custom Form Authentication

### 7.1 Kenapa perlu custom form?

Form auth standar sering terlalu terbatas untuk aplikasi enterprise modern.

Kita mungkin perlu:

- login dengan username/email/NRIC/employee ID,
- captcha setelah gagal berkali-kali,
- MFA challenge,
- step-up authentication,
- account status check,
- password expiry,
- force change password,
- organization selection setelah login,
- SSO fallback,
- custom JSON response untuk SPA,
- custom error code,
- audit event lebih kaya,
- login throttling yang domain-specific.

Custom form authentication memberi fleksibilitas sambil tetap mencoba mempertahankan integrasi container.

### 7.2 Jakarta Security custom form sketch

```java
import jakarta.security.enterprise.authentication.mechanism.http.CustomFormAuthenticationMechanismDefinition;
import jakarta.security.enterprise.authentication.mechanism.http.LoginToContinue;

@CustomFormAuthenticationMechanismDefinition(
    loginToContinue = @LoginToContinue(
        loginPage = "/auth/login",
        errorPage = "/auth/login-error"
    )
)
public class SecurityConfig {
}
```

Dalam custom mechanism, aplikasi dapat menentukan bagaimana credential dibaca dari request.

### 7.3 Custom `HttpAuthenticationMechanism` mental model

Custom mechanism memungkinkan kita membuat logic seperti:

```java
@ApplicationScoped
public class AppAuthenticationMechanism implements HttpAuthenticationMechanism {

    @Inject
    private IdentityStoreHandler identityStoreHandler;

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) throws AuthenticationException {

        if (isLoginPost(request)) {
            String username = request.getParameter("username");
            String password = request.getParameter("password");

            CredentialValidationResult result = identityStoreHandler.validate(
                new UsernamePasswordCredential(username, new Password(password))
            );

            if (result.getStatus() == CredentialValidationResult.Status.VALID) {
                return context.notifyContainerAboutLogin(
                    result.getCallerPrincipal(),
                    result.getCallerGroups()
                );
            }

            return context.responseUnauthorized();
        }

        if (context.isProtected()) {
            return context.redirect("/auth/login");
        }

        return context.doNothing();
    }
}
```

Catatan konseptual:

- nama method dan tipe exact dapat berubah antar versi/import,
- tujuan utama adalah memahami flow,
- custom mechanism harus memberitahu container via context, bukan hanya set session manual.

### 7.4 Step-up authentication

Step-up authentication berarti caller sudah login, tetapi action tertentu membutuhkan proof tambahan.

Contoh:

```text
User login normal
   |
   v
Can view case list
   |
   v
User wants to approve enforcement action
   |
   v
System requires MFA / password re-entry / hardware token
   |
   v
If step-up success, allow action for short window
```

Step-up penting untuk:

- approval,
- payment,
- destructive admin action,
- role management,
- data export,
- confidential record access,
- emergency override.

Design invariant:

```text
Step-up status must be scoped by time, action sensitivity, and actor/session.
```

Jangan membuat step-up global permanen selama session.

### 7.5 Multi-stage login

Enterprise login sering bukan satu langkah.

Contoh:

```text
1. Username submitted
2. System detects identity provider or account type
3. Password submitted or redirected to SSO
4. MFA challenge
5. Organization selection
6. Terms acceptance / profile completion
7. Session established
```

Jebakan:

- membangun partial authenticated session terlalu awal,
- role diberikan sebelum MFA selesai,
- pre-auth state tidak dihapus,
- account enumeration lewat step 1,
- race condition saat organization selection,
- original request hilang.

### 7.6 Custom form failure model

| Failure | Penyebab | Dampak |
|---|---|---|
| Manual session identity | Tidak notify container | `@RolesAllowed` tidak bekerja |
| MFA bypass | Flag MFA disimpan client-side | Privilege escalation |
| Pre-auth state reuse | Token login step tidak single-use | Login hijack |
| Weak error handling | Error detail terlalu spesifik | Account enumeration |
| Step-up too broad | Step-up berlaku semua action | Risk expansion |
| Login state confusion | user berubah di tengah flow | Wrong account login |

---

## 8. Client Certificate Authentication

### 8.1 Mental model

Client certificate authentication menggunakan TLS client certificate untuk membuktikan identity caller.

Biasanya disebut:

- client certificate auth,
- mutual TLS,
- mTLS,
- X.509 authentication.

Flow high-level:

```text
Client connects to server over TLS
   |
   v
Server presents server certificate
   |
   v
Server requests client certificate
   |
   v
Client presents certificate
   |
   v
Server/container validates certificate chain
   |
   v
Application maps certificate to principal
```

Berbeda dari username/password, bukti identity berasal dari possession private key terkait certificate.

### 8.2 Apa yang divalidasi?

Validasi certificate biasanya mencakup:

- certificate chain valid,
- certificate belum expired,
- issuer trusted,
- certificate usage sesuai,
- hostname/SAN relevance untuk server certificate,
- client cert acceptable CA,
- revocation check bila dikonfigurasi,
- optional mapping ke account internal.

Authentication tidak selesai hanya karena certificate cryptographically valid. Aplikasi masih perlu menjawab:

```text
Certificate ini milik caller mana di sistem saya?
```

### 8.3 Principal mapping

Certificate bisa memiliki subject seperti:

```text
CN=service-a, OU=Engineering, O=Example, C=SG
```

Atau SAN:

```text
URI:spiffe://example.com/ns/prod/sa/service-a
DNS:service-a.prod.example.com
EMAIL:operator@example.com
```

Mapping pilihan:

| Source | Kelebihan | Risiko |
|---|---|---|
| Subject DN | Legacy friendly | Format tidak stabil |
| CN | Simple | CN sering ambiguous/deprecated untuk identity modern |
| SAN DNS | Cocok service identity | Perlu naming discipline |
| SAN URI | Cocok workload identity | Butuh ecosystem support |
| Certificate fingerprint | Precise | Rotasi sulit |
| Issuer + serial | Precise | Lifecycle perlu dikelola |

Rule enterprise:

```text
Do not map certificate identity casually.
Define canonical certificate-to-principal mapping contract.
```

### 8.4 Servlet CLIENT-CERT

Servlet security historically mendukung `CLIENT-CERT` sebagai auth method.

Conceptual `web.xml`:

```xml
<login-config>
    <auth-method>CLIENT-CERT</auth-method>
    <realm-name>client-cert-realm</realm-name>
</login-config>
```

### 8.5 Reverse proxy termination problem

Dalam Kubernetes/AWS/enterprise deployment, TLS sering terminate di:

- ALB,
- nginx,
- HAProxy,
- Traefik,
- API gateway,
- service mesh ingress.

Jika mTLS terminate di proxy, aplikasi Java mungkin tidak melihat TLS client certificate langsung.

Proxy bisa meneruskan identity via header:

```http
X-Client-Cert: ...
X-Client-Dn: ...
X-Authenticated-User: ...
```

Risiko besar:

```text
Header can be spoofed unless the application only trusts headers from a trusted proxy path and strips incoming client-supplied versions.
```

Mitigasi:

- hanya trust header dari internal proxy yang authenticated,
- strip header identity dari public request,
- gunakan mTLS antara proxy dan app bila perlu,
- sign header atau gunakan token exchange,
- enforce network policy,
- audit source of identity.

### 8.6 Combining mTLS with token

Untuk service-to-service modern, pattern kuat adalah:

```text
mTLS authenticates workload/channel
Bearer token authenticates user/delegated authority
Authorization uses both
```

Contoh:

```text
service-a calls service-b
mTLS proves caller workload = service-a
JWT proves end-user = fajar@example.com
service-b checks:
  - service-a is allowed to call endpoint
  - user is allowed to perform action
  - service-a is allowed to act on behalf of user
```

Ini mencegah confused deputy.

### 8.7 Failure model client certificate

| Failure | Penyebab | Dampak |
|---|---|---|
| Expired cert | Rotasi gagal | Outage |
| Wrong truststore | CA tidak dikenali | Authentication failure |
| Header spoofing | Proxy identity header dipercaya tanpa boundary | Authentication bypass |
| Fingerprint mapping | Cert rotation memutus login | Operational failure |
| Revocation disabled | Compromised cert tetap diterima | Security breach |
| Incomplete chain | Client tidak mengirim intermediate | TLS failure |
| Ambiguous DN mapping | Dua cert map ke account sama | Identity confusion |

---

## 9. OpenID Connect Authentication

### 9.1 Mental model

OpenID Connect adalah authentication layer di atas OAuth 2.0. Dalam OIDC, aplikasi disebut **Relying Party** atau **Client**, sedangkan sistem login eksternal disebut **OpenID Provider** atau **Identity Provider**.

Flow umum untuk web app:

```text
User accesses app
   |
   v
App redirects browser to IdP authorization endpoint
   |
   v
User authenticates at IdP
   |
   v
IdP redirects browser back to app with authorization code
   |
   v
App exchanges code for tokens
   |
   v
App validates ID token
   |
   v
App establishes local session/principal
```

Dalam Jakarta Security, OIDC bisa dikonfigurasi dengan built-in OpenID Connect authentication mechanism pada versi modern.

### 9.2 Kenapa OIDC berbeda dari Form Login?

Form login:

```text
Application collects password
Application validates password
Application owns credential verification
```

OIDC login:

```text
Identity Provider collects/verifies primary credential
Application receives signed identity assertion/token
Application validates assertion/token
Application establishes local session
```

Konsekuensi:

- aplikasi tidak perlu menyimpan password user,
- MFA bisa ditangani IdP,
- SSO lebih mudah,
- logout lebih kompleks,
- role/claim mapping menjadi critical,
- availability IdP mempengaruhi login,
- redirect/callback security menjadi critical.

### 9.3 Core artifacts

| Artifact | Fungsi |
|---|---|
| Authorization endpoint | Tempat browser diarahkan untuk login |
| Token endpoint | Tempat app menukar authorization code dengan token |
| ID token | Token berisi authentication event dan identity claims |
| Access token | Token untuk mengakses resource server/API |
| Refresh token | Token untuk mendapatkan access token baru |
| JWKS | Public keys untuk validasi signature |
| Discovery document | Metadata endpoint dan capability provider |
| State | CSRF protection untuk authorization response |
| Nonce | Mengikat ID token ke authentication request |
| Redirect URI | Callback endpoint aplikasi |

### 9.4 Authorization Code + PKCE

Modern OIDC login untuk browser-based application sebaiknya memakai Authorization Code flow, dan PKCE menjadi komponen penting terutama untuk public client/SPA/mobile.

Mental model PKCE:

```text
Client generates code_verifier
Client sends code_challenge in auth request
IdP stores challenge
Client later sends code_verifier to token endpoint
IdP verifies verifier matches challenge
```

Tujuannya untuk mengurangi risiko authorization code interception.

### 9.5 Jakarta Security OIDC sketch

Contoh konseptual:

```java
import static jakarta.security.enterprise.authentication.mechanism.http.openid.OpenIdConstant.PROMPT_LOGIN;

import jakarta.security.enterprise.authentication.mechanism.http.OpenIdAuthenticationMechanismDefinition;
import jakarta.security.enterprise.authentication.mechanism.http.openid.ClaimsDefinition;
import jakarta.security.enterprise.authentication.mechanism.http.openid.LogoutDefinition;

@OpenIdAuthenticationMechanismDefinition(
    providerURI = "https://idp.example.com/realms/acme",
    clientId = "jakarta-app",
    clientSecret = "${oidc.client.secret}",
    redirectURI = "${baseURL}/callback",
    scope = {"openid", "profile", "email"},
    claimsDefinition = @ClaimsDefinition(
        callerNameClaim = "preferred_username",
        callerGroupsClaim = "groups"
    ),
    logout = @LogoutDefinition(
        redirectURI = "${baseURL}/logged-out"
    )
)
public class SecurityConfig {
}
```

Catatan:

- syntax detail bisa berbeda mengikuti versi spec/container,
- jangan hardcode secret,
- gunakan secret management,
- callback URL harus match registration di IdP,
- mapping claims harus eksplisit.

### 9.6 ID token bukan access token

Kesalahan umum:

```text
Frontend sends ID token to backend API as bearer authorization token.
```

Masalah:

- ID token ditujukan untuk client/RP, bukan resource server,
- audience berbeda,
- semantic token berbeda,
- authorization API bisa salah membaca authentication assertion sebagai API authority.

Rule:

```text
Use ID token to authenticate user to the client application.
Use access token to authorize API access.
```

Untuk server-side Jakarta web app, app bisa memakai OIDC untuk login lalu membuat local session. Untuk API resource server, validasi access token perlu model tersendiri.

### 9.7 Claims to roles/groups

OIDC memberikan claims seperti:

```json
{
  "sub": "248289761001",
  "preferred_username": "fajar",
  "email": "fajar@example.com",
  "groups": ["case-officer", "appeal-reviewer"],
  "iss": "https://idp.example.com/realms/acme",
  "aud": "jakarta-app"
}
```

Aplikasi harus memutuskan:

```text
Which claim becomes principal name?
Which claims become Jakarta groups?
Which groups become application roles?
Which roles become domain permissions?
```

Jangan asal mengambil `email` sebagai immutable identity. Email bisa berubah. `sub` biasanya lebih stabil dalam satu issuer, tetapi bisa berubah saat migrasi IdP. Karena itu account linking perlu desain.

### 9.8 OIDC callback security

OIDC callback adalah endpoint berisiko tinggi.

Harus dicek:

```text
[ ] state valid
[ ] nonce valid
[ ] issuer valid
[ ] audience valid
[ ] signature valid
[ ] token not expired
[ ] token not before satisfied
[ ] redirect URI exact match
[ ] code single-use
[ ] code exchanged server-side where appropriate
[ ] correlation with original auth request
```

### 9.9 Logout complexity

Form auth logout lokal relatif sederhana:

```text
invalidate local session
```

OIDC logout bisa melibatkan:

- local app session,
- IdP session,
- other relying parties,
- front-channel logout,
- back-channel logout,
- post-logout redirect,
- refresh token revocation,
- browser cookie state.

Invariant:

```text
Local logout does not automatically mean global IdP logout.
Global logout does not automatically mean every application session is already invalidated unless protocol/integration supports it correctly.
```

### 9.10 Failure model OIDC

| Failure | Penyebab | Dampak |
|---|---|---|
| Redirect loop | Callback/login path protected salah | User tidak bisa login |
| Wrong issuer | Misconfigured realm/provider | Token rejected / wrong trust |
| Wrong audience | Token untuk client lain | Security failure |
| Missing nonce | Replay/session mix-up risk | Login injection |
| State mismatch | CSRF protection triggered | Login failure |
| JWKS stale | Key rotation IdP | Mass login outage |
| Clock skew | Server time berbeda | Token dianggap expired/not yet valid |
| Role claim missing | Claim mapping salah | User login tapi unauthorized |
| Using email as ID | Email berubah | Duplicate/wrong account |
| Logout incomplete | Session lokal/IdP tidak sinkron | User appears still logged in |

---

## 10. Multiple Authentication Mechanisms

### 10.1 Kenapa perlu multiple mechanisms?

Aplikasi enterprise sering melayani beberapa jenis caller:

| Caller | Mechanism |
|---|---|
| Browser user | OIDC/Form |
| Internal service | mTLS/Bearer token |
| Legacy integration | Basic |
| Admin operator | OIDC + step-up |
| Health check | unauthenticated or mTLS |
| Batch job | client credentials token |

Jika hanya satu mechanism global, desain sering jadi buruk:

- Basic auth terbuka untuk browser endpoint,
- OIDC redirect terjadi pada API endpoint,
- API client menerima HTML login page,
- service account diperlakukan seperti human user,
- admin endpoint tidak punya stronger auth.

### 10.2 Mechanism selection problem

Pertanyaan inti:

```text
Given a request, which authentication mechanism should handle it?
```

Selection bisa berdasarkan:

- path,
- HTTP method,
- presence of Authorization header,
- Accept header,
- host/subdomain,
- client certificate presence,
- route/gateway,
- annotation/qualifier,
- deployment descriptor.

### 10.3 Example strategy

```text
/admin/**
  -> OIDC + step-up / strong role check

/api/internal/**
  -> mTLS + service token

/api/public/**
  -> Bearer token resource server validation

/legacy/**
  -> Basic Auth with narrow realm

/health
  -> unauthenticated liveness, authenticated readiness depending environment
```

### 10.4 401 vs redirect problem

If API endpoint uses browser form/OIDC mechanism incorrectly:

```text
API client -> GET /api/cases
Server -> 302 /login
Client -> receives HTML login page instead of JSON 401
```

This is a contract failure.

API should usually return:

```http
401 Unauthorized
WWW-Authenticate: Bearer
Content-Type: application/json
```

Browser page can return:

```http
302 Location: /login
```

Design rule:

```text
Authentication challenge must match caller type.
```

---

## 11. Fallback Authentication

Fallback authentication means if one mechanism does not authenticate the caller, another mechanism may be attempted.

Example:

```text
If Authorization: Bearer exists -> validate bearer token
Else if session exists -> use session
Else if browser request -> redirect OIDC
Else -> 401
```

Fallback is useful but dangerous.

Risk:

- weak fallback accidentally allows access,
- attacker chooses weaker mechanism,
- API endpoint falls back to cookie session unexpectedly,
- admin endpoint accepts Basic because fallback chain includes it,
- mechanism order differs by container.

Invariant:

```text
Mechanism fallback must be explicit, ordered, path-scoped, and auditable.
```

Bad design:

```text
Try every possible authentication mechanism everywhere.
```

Better design:

```text
For each route/security zone, define accepted mechanisms and failure behavior.
```

---

## 12. Step-Up Authentication

Step-up bukan mechanism tunggal, melainkan pola yang menambahkan assurance level.

### 12.1 Assurance level

Kita bisa memodelkan authentication dengan level:

```text
AAL0: anonymous
AAL1: password/session
AAL2: MFA completed
AAL3: hardware-backed / strong cryptographic proof
```

Aplikasi tidak harus memakai istilah AAL secara formal, tapi mental modelnya berguna.

### 12.2 Domain example

Dalam case management:

```text
View case             -> authenticated user + case access
Edit draft            -> authenticated user + assignment
Submit recommendation -> authenticated user + assignment + role
Approve enforcement   -> role + segregation of duties + step-up within 5 minutes
Emergency override    -> senior role + step-up + reason + audit
```

### 12.3 Step-up state storage

Step-up state sebaiknya menyimpan:

```text
subject/caller id
session id
authentication method used
assurance level
completion time
expiry time
scope/action
correlation id
```

Jangan menyimpan hanya:

```text
session.setAttribute("mfa", true)
```

Karena terlalu global dan sulit diaudit.

---

## 13. Challenge Design

Authentication mechanism bukan hanya validasi credential. Ia juga menentukan **challenge**.

Challenge adalah cara server mengatakan:

```text
I need authentication, and this is how you should authenticate.
```

Contoh challenge:

| Mechanism | Challenge |
|---|---|
| Basic | `401 WWW-Authenticate: Basic realm="..."` |
| Bearer | `401 WWW-Authenticate: Bearer error="invalid_token"` |
| Form | `302 /login` |
| OIDC | `302 Authorization Endpoint` |
| Client Cert | TLS certificate request during handshake |

Challenge yang salah menyebabkan client behavior salah.

Common bug:

```text
API endpoint returns OIDC redirect instead of 401.
```

Atau:

```text
Browser endpoint returns JSON 401 instead of login redirect.
```

---

## 14. Authentication Mechanism and Authorization Boundary

Authentication mechanism boleh melakukan checks tertentu, tetapi jangan mengubahnya menjadi authorization engine besar.

Boleh di authentication mechanism:

- validate credential,
- reject disabled account,
- reject locked account,
- enforce password expired flow,
- require MFA before establishing full identity,
- map caller groups,
- attach authentication metadata.

Sebaiknya tidak di authentication mechanism:

- decide whether user can approve a specific case,
- decide row-level access,
- decide workflow transition,
- decide tenant-specific domain permission,
- contain large business policy.

Kenapa?

Karena authentication mechanism bekerja di boundary awal. Ia tidak selalu punya full domain context, dan mencampur domain authorization ke auth mechanism membuat policy sulit dites, sulit diaudit, dan sulit digunakan ulang.

---

## 15. Mechanism-Specific Comparison

| Mechanism | Best for | Strength | Main risk |
|---|---|---|---|
| Basic | Simple API/internal legacy | Simple, stateless | Credential replay, browser caching |
| Form | Server-side web app | Good session UX | CSRF, session fixation |
| Custom Form | Enterprise login flow | Flexible | Container bypass if wrong |
| Client Cert | Strong service/user auth | Cryptographic possession | Operational complexity |
| OIDC | SSO/federated login | External IdP, MFA, SSO | Redirect/callback/token mapping errors |
| Bearer token custom | API resource server | API friendly | Token validation mistakes |
| Gateway header | Centralized auth | Simplifies apps | Header spoofing/trust boundary |

---

## 16. Java 8–25 Considerations

Authentication mechanism concept spans Java versions, but runtime concerns evolve.

### 16.1 Java 8 era

Common environment:

- Java EE 7/8,
- `javax.servlet.*`,
- JAAS/JASPIC/JACC still visible in older app servers,
- app server-managed realms common,
- custom filters common,
- pre-Jakarta namespace.

Concern:

- older TLS defaults,
- legacy cipher configuration,
- weaker password hashing in old apps,
- custom login servlets bypassing container,
- container-specific realm configuration.

### 16.2 Java 11/17 era

Common environment:

- transition to Jakarta,
- Spring Boot/Security coexistence,
- Keycloak/OIDC adoption,
- cloud container deployment,
- reverse proxy/gateway boundary becomes normal.

Concern:

- `javax` to `jakarta` migration,
- OIDC callback behind proxy,
- SameSite cookie behavior,
- token validation in microservices,
- session clustering in Kubernetes.

### 16.3 Java 21/25 era

Common environment:

- virtual threads,
- modern Jakarta EE 11+,
- container and cloud-native deployment,
- stronger identity federation,
- multiple auth mechanisms,
- more async/background processing.

Concern:

- security context propagation with virtual threads/async,
- ThreadLocal assumptions,
- structured concurrency context design,
- token/session propagation across services,
- audit correlation across async pipelines.

Authentication mechanism itself may not change drastically, but execution model around it changes.

---

## 17. Designing Authentication Mechanisms by Security Zone

A strong enterprise design starts by dividing the app into security zones.

Example:

```text
Zone A: Public unauthenticated pages
Zone B: Browser authenticated user pages
Zone C: Browser admin pages
Zone D: External API
Zone E: Internal service API
Zone F: Health/metrics/admin ops
Zone G: OIDC callback/logout endpoints
```

For each zone define:

```text
[ ] Accepted caller type
[ ] Accepted authentication mechanism
[ ] Challenge behavior
[ ] Session/token behavior
[ ] Required assurance level
[ ] Authorization entry point
[ ] Audit event
[ ] Failure response
```

Example table:

| Zone | Path | Mechanism | Challenge | Notes |
|---|---|---|---|---|
| Public | `/`, `/assets/**` | none | none | no identity required |
| User Web | `/app/**` | OIDC/session | redirect IdP | browser only |
| Admin Web | `/admin/**` | OIDC + step-up | redirect/step-up | stronger audit |
| API | `/api/**` | bearer token | JSON 401 | no HTML redirect |
| Internal | `/internal/**` | mTLS + service token | 401/403 | no public route |
| Callback | `/oidc/callback` | OIDC callback | controlled error | must be reachable |
| Logout | `/logout` | session/OIDC logout | redirect | careful CSRF |

---

## 18. Implementation Pattern: Authentication Decision Pipeline

A robust mechanism can be modeled as a pipeline:

```text
1. Classify request
2. Determine security zone
3. Determine expected mechanism
4. Extract authentication material
5. Validate material
6. Normalize identity
7. Map groups/claims
8. Establish container identity
9. Attach authentication metadata
10. Continue or challenge/fail
```

Pseudo-code:

```java
AuthenticationResult authenticate(Request request) {
    SecurityZone zone = classify(request);
    Mechanism mechanism = selectMechanism(zone, request);

    Optional<AuthMaterial> material = mechanism.extract(request);

    if (material.isEmpty()) {
        return mechanism.challenge(zone, request);
    }

    ValidationResult validation = mechanism.validate(material.get());

    if (!validation.valid()) {
        return mechanism.failure(validation.reason());
    }

    CallerIdentity identity = normalize(validation);
    Set<String> groups = mapGroups(validation.claims());

    return establish(identity, groups, validation.metadata());
}
```

Core invariant:

```text
Do not let request classification be attacker-controlled without normalization.
```

Example: using `X-Forwarded-Proto` or `Host` blindly can break redirect URI and security zone selection.

---

## 19. Anti-Patterns

### 19.1 Login controller that bypasses container

```java
session.setAttribute("user", user);
```

Problem:

- container principal not established,
- declarative security does not know user,
- role mapping disconnected,
- logout incomplete.

### 19.2 One global mechanism for all endpoints

```text
Everything redirects to login page.
```

Problem:

- API clients receive HTML,
- internal services break,
- unauthenticated callback endpoints misbehave.

### 19.3 Trusting IdP claims without local contract

```text
groups claim = application permissions
```

Problem:

- IdP group rename breaks app,
- role explosion,
- external admin accidentally grants internal permission,
- no audit of mapping decision.

### 19.4 Accepting identity headers from anywhere

```text
X-User: admin
```

Problem:

- direct client can spoof header,
- authentication bypass.

### 19.5 Treating authentication as authorization

```text
Valid token means allowed to do anything in token tenant.
```

Problem:

- no object-level check,
- no state-machine check,
- no segregation-of-duties check.

### 19.6 Token validation by decoding only

```java
String payload = decodeJwtWithoutVerifyingSignature(token);
```

Problem:

- attacker can forge claims.

### 19.7 Login page protected by same constraint

```text
/login requires authentication
```

Problem:

- redirect loop.

### 19.8 Callback endpoint blocked

```text
/oidc/callback requires existing session but callback creates session
```

Problem:

- OIDC login fails.

---

## 20. Testing Authentication Mechanisms

Authentication mechanism tests should include positive and negative paths.

### 20.1 Basic Auth tests

```text
[ ] no Authorization header -> 401 + Basic challenge
[ ] wrong password -> 401
[ ] correct password -> principal established
[ ] disabled user -> 401/403 based policy
[ ] Authorization header redacted from logs
```

### 20.2 Form Auth tests

```text
[ ] protected page redirects to login
[ ] successful login redirects to original path
[ ] session id changes after login
[ ] login CSRF defense works
[ ] invalid password does not reveal user existence
[ ] logout invalidates session
[ ] old session cannot access protected page
```

### 20.3 Custom Form tests

```text
[ ] partial login cannot access protected resources
[ ] MFA required for selected users/actions
[ ] MFA bypass attempt fails
[ ] step-up expires
[ ] account lockout works
[ ] container principal is established
```

### 20.4 Client Certificate tests

```text
[ ] valid cert accepted
[ ] expired cert rejected
[ ] unknown CA rejected
[ ] revoked cert rejected if revocation required
[ ] spoofed proxy header rejected
[ ] cert rotation does not break mapped identity unexpectedly
```

### 20.5 OIDC tests

```text
[ ] authorization request includes state
[ ] authorization request includes nonce
[ ] callback with invalid state rejected
[ ] callback with invalid nonce rejected
[ ] wrong issuer rejected
[ ] wrong audience rejected
[ ] expired token rejected
[ ] JWKS rotation handled
[ ] missing role claim handled safely
[ ] logout clears local session
```

---

## 21. Observability and Audit

Authentication events should be observable.

Audit-worthy events:

- login success,
- login failure,
- logout,
- session timeout,
- password expired,
- account locked,
- MFA challenge issued,
- MFA success/failure,
- OIDC callback failure,
- token validation failure,
- client certificate failure,
- role/group mapping failure,
- step-up success/failure.

Each event should include, where safe:

```text
timestamp
correlation id
request id
source IP / trusted proxy chain
user agent
mechanism
principal/candidate principal
issuer/client id for OIDC
certificate fingerprint or subject for mTLS
failure category
not raw credential
not raw token
not password
```

Never log:

```text
password
Authorization header
raw access token
raw refresh token
client secret
full ID token unless redacted and explicitly justified
```

---

## 22. Production Debugging Playbook

When authentication fails, ask in order:

### 22.1 Is the request reaching the app?

Check:

- gateway route,
- TLS termination,
- path rewrite,
- host header,
- forwarded proto,
- callback path,
- health check path.

### 22.2 Which mechanism handled the request?

Check:

- path constraint,
- annotation,
- deployment descriptor,
- selected mechanism,
- challenge response,
- log category.

### 22.3 Was authentication material present?

Check:

- Authorization header,
- cookie,
- form fields,
- client cert,
- OIDC code/state,
- session id.

### 22.4 Did validation fail?

Check:

- password mismatch,
- locked account,
- token signature,
- issuer,
- audience,
- expiry,
- nonce,
- state,
- certificate chain,
- identity store availability.

### 22.5 Was identity established in container?

Check:

- `getUserPrincipal()`,
- `SecurityContext.getCallerPrincipal()`,
- groups,
- `isUserInRole()`,
- session attributes,
- container logs.

### 22.6 Is it actually authorization failure?

If authentication succeeded but access denied:

- check `403`,
- role mapping,
- `@RolesAllowed`,
- URL constraints,
- method constraints,
- tenant/domain policy.

---

## 23. Decision Framework: Which Mechanism Should You Choose?

Use this decision tree:

```text
Is caller a browser human user?
  Yes:
    Need enterprise SSO/MFA?
      Yes -> OIDC/SAML via IdP
      No  -> Form/Custom Form if local account acceptable
  No:
    Is caller service-to-service?
      Yes:
        Need strong workload identity?
          Yes -> mTLS + token
          No  -> Bearer token/client credentials
    Is caller legacy/simple script?
      Yes -> Basic only if narrow, TLS, throttled
```

Then ask:

```text
[ ] Does the mechanism integrate with container identity?
[ ] Does it produce principal and groups consistently?
[ ] Does challenge match caller type?
[ ] Does logout/session lifecycle make sense?
[ ] Can failures be audited?
[ ] Can role mapping change safely?
[ ] Can the mechanism be tested negatively?
```

---

## 24. Reference Architecture Example

Imagine an enterprise regulatory case management system.

### 24.1 Security zones

```text
/public/**
  anonymous

/app/**
  OIDC browser login

/admin/**
  OIDC + step-up + admin role

/api/mobile/**
  OAuth2 bearer access token

/api/internal/**
  mTLS + service token

/oidc/callback
  OIDC callback mechanism

/logout
  local + IdP logout handling
```

### 24.2 Identity mapping

```text
OIDC issuer + sub
   -> internal account
   -> active organization membership
   -> application roles
   -> domain permissions
```

### 24.3 Authentication metadata

Store for audit:

```text
mechanism = OIDC
issuer = https://idp.example.com/realms/agency
subject = abc-123
client_id = case-management
acr/amr = mfa/password/etc when available
login_time = timestamp
session_id_hash = hash(session id)
correlation_id = request correlation id
```

### 24.4 Authorization is separate

Even after login:

```text
Can user approve case?
  subject = user
  action = APPROVE_CASE
  resource = case
  tenant = agency
  state = UNDER_REVIEW
  relationship = assigned approver?
  constraints = not maker, not conflicted, step-up fresh
```

Authentication only established the caller. Domain authorization decides the action.

---

## 25. Key Mental Models to Keep

### 25.1 Authentication mechanism is a protocol adapter

It adapts HTTP/TLS/OIDC/form/token protocol details into container identity.

```text
Protocol proof -> validated identity -> container principal/groups
```

### 25.2 Authentication is not authorization

Authentication says:

```text
This caller is Fajar.
```

Authorization says:

```text
Fajar may approve this case now, under this tenant, given this state and relationship.
```

### 25.3 Challenge is part of the contract

Wrong challenge breaks clients and can leak security assumptions.

```text
Browser challenge != API challenge != TLS challenge
```

### 25.4 Trust boundary matters more than mechanism name

OIDC, Basic, mTLS, Form can all be misused if trust boundary is wrong.

### 25.5 Establish identity in the container

If using Jakarta EE declarative security, make sure authentication mechanism informs the container, not only application session.

### 25.6 Mechanism selection must be explicit

Do not let every mechanism apply everywhere.

### 25.7 Production security fails at integration seams

Most real failures occur at:

- proxy boundary,
- callback endpoint,
- role mapping,
- session lifecycle,
- token validation,
- fallback mechanism,
- async context propagation,
- logout.

---

## 26. Part 05 Summary

Authentication mechanisms are the bridge between external proof and internal application identity.

In Jakarta/Java enterprise systems, you must understand:

- Basic Auth is simple but risky and TLS-dependent.
- Form Auth is session-oriented and useful for browser apps but needs CSRF/session fixation protection.
- Custom Form gives enterprise flexibility but can accidentally bypass container security.
- Client Certificate/mTLS provides strong cryptographic caller proof but is operationally complex.
- OIDC enables modern SSO/federation but introduces redirect, token, claim, and logout complexity.
- Multiple mechanisms are often necessary but must be path-scoped and explicitly ordered.
- Challenge behavior must match the caller type.
- Authentication must establish container identity if you want Jakarta declarative security to work.
- Authentication is only the beginning; authorization, audit, and domain policy come after.

The top-level engineer does not ask only:

```text
How do I configure login?
```

They ask:

```text
What proof does this request carry?
Who validates it?
What trust boundary does it cross?
How is caller identity normalized?
How does the container know?
Which mechanisms are accepted for this zone?
What is the challenge/failure behavior?
What can go wrong in production?
How do we audit and test it?
```

---

## 27. References

Primary references and specifications:

1. Jakarta Security 4.0 Specification — https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0
2. Jakarta Security 4.0 API — `HttpAuthenticationMechanism` — https://jakarta.ee/specifications/security/4.0/apidocs/jakarta.security/jakarta/security/enterprise/authentication/mechanism/http/httpauthenticationmechanism
3. Jakarta Security 4.0 API — `OpenIdAuthenticationMechanismDefinition` — https://jakarta.ee/specifications/security/4.0/apidocs/jakarta.security/jakarta/security/enterprise/authentication/mechanism/http/openidauthenticationmechanismdefinition
4. Jakarta Security 4.0 Release Page — https://jakarta.ee/specifications/security/4.0/
5. Jakarta Authentication Specification — https://jakarta.ee/specifications/authentication/
6. Jakarta Servlet Specification — https://jakarta.ee/specifications/servlet/
7. Jakarta EE Tutorial — Security — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security.html
8. OpenID Connect Core 1.0 — https://openid.net/specs/openid-connect-core-1_0.html
9. OAuth 2.0 Authorization Framework — RFC 6749 — https://www.rfc-editor.org/rfc/rfc6749
10. OAuth 2.0 Bearer Token Usage — RFC 6750 — https://www.rfc-editor.org/rfc/rfc6750
11. OAuth 2.0 for Native Apps / PKCE-related ecosystem — RFC 7636 — https://www.rfc-editor.org/rfc/rfc7636
12. OAuth 2.0 Security Best Current Practice — RFC 9700 — https://www.rfc-editor.org/rfc/rfc9700
13. OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
14. OWASP Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
15. OWASP CSRF Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

---

## 28. Status Seri

Selesai sampai titik ini:

```text
Part 00 — Orientation: Enterprise Java Security Mental Model
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
Part 03 — Container Security Architecture
Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Cert, OIDC
```

Berikutnya:

```text
Part 06 — Jakarta Security API Core
```

Seri belum selesai. Ini baru Part 05 dari 35.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-04-servlet-security-foundation.md">⬅️ Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-06-jakarta-security-api-core.md">Part 06 — Jakarta Security API Core ➡️</a>
</div>
