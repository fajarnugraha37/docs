# Part 06 — Jakarta Security API Core

**Series:** `learn-java-jakarta-security-authentication-authorization-identity`  
**File:** `learn-java-jakarta-security-authentication-authorization-identity-part-06-jakarta-security-api-core.md`  
**Scope:** Java 8–25, Java EE 8 / Jakarta EE 8–11+, `javax.security.enterprise.*` and `jakarta.security.enterprise.*`  
**Position in series:** Part 06 of 35  

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya sudah membahas authentication mechanism dari sisi konsep: Basic, Form, Custom Form, Client Certificate, dan OIDC. Bagian ini masuk ke inti API yang diberikan oleh Jakarta Security untuk membangun security di aplikasi Jakarta secara portable.

Fokus utama bagian ini:

1. Memahami **apa problem yang diselesaikan Jakarta Security**.
2. Memahami tiga pilar utama Jakarta Security:
   - `SecurityContext`
   - `HttpAuthenticationMechanism`
   - `IdentityStore`
3. Memahami model credential dan validation result.
4. Memahami hubungan Jakarta Security dengan Servlet, CDI, Jakarta Authentication, dan Jakarta Authorization.
5. Memahami authentication lifecycle dari sisi API.
6. Memahami portability trap antar container.
7. Membedakan Jakarta Security dari Spring Security dan dari custom filter buatan sendiri.
8. Membangun mental model yang cukup kuat untuk membuat desain login/authorization enterprise, bukan hanya menyalin annotation.

Bagian ini tidak bertujuan menghafalkan seluruh class API satu per satu. Tujuannya adalah memahami **kontrak arsitektural** yang disediakan Jakarta Security.

---

## 1. Apa Itu Jakarta Security?

Jakarta Security adalah standard API di Jakarta EE untuk membuat security aplikasi enterprise dengan cara yang lebih modern, portable, dan CDI-friendly.

Sebelum Jakarta Security, security Java enterprise tersebar di beberapa layer:

- Servlet security constraint.
- EJB method security.
- JAAS.
- JASPIC / Jakarta Authentication.
- JACC / Jakarta Authorization.
- Container-specific realm.
- Vendor-specific login module.
- Custom Servlet filter.

Masalahnya: banyak aplikasi akhirnya membuat login sendiri dengan Servlet filter, menyimpan user di session, lalu melakukan role check manual. Secara permukaan terlihat jalan, tetapi sering gagal berintegrasi dengan container.

Contoh masalah klasik:

```java
session.setAttribute("user", user);
```

Lalu di tempat lain:

```java
@RolesAllowed("ADMIN")
public void approve() { ... }
```

Developer mengira user sudah login karena ada object `user` di session. Tetapi container tidak tahu bahwa caller sudah authenticated. Akibatnya:

- `request.getUserPrincipal()` null.
- `request.isUserInRole("ADMIN")` false.
- `@RolesAllowed` tidak bekerja.
- audit container tidak tahu caller.
- JAX-RS/CDI/EJB security tidak konsisten.

Jakarta Security hadir untuk memberikan API standar agar aplikasi bisa:

1. Mengambil credential dari HTTP request.
2. Memvalidasi credential.
3. Menetapkan caller principal.
4. Menetapkan group/role membership.
5. Mengekspos identity ke container.
6. Memakai `SecurityContext` secara programmatic.
7. Menggunakan CDI untuk membuat mechanism dan identity store custom.

Dengan kata lain:

```text
Jakarta Security = application-facing security API untuk authentication dan identity integration
```

Bukan replacement penuh untuk semua layer security. Ia duduk di atas/di samping Servlet, CDI, Jakarta Authentication, dan container policy.

---

## 2. Mental Model Besar

Jakarta Security dapat dipahami sebagai tiga kontrak utama:

```text
HTTP request
   |
   v
HttpAuthenticationMechanism
   |  extracts credential / challenges caller / handles callback
   v
IdentityStore
   |  validates credential and returns caller principal + groups
   v
CredentialValidationResult
   |  success / invalid / not validated
   v
Container security context
   |
   +--> SecurityContext
   +--> HttpServletRequest.getUserPrincipal()
   +--> HttpServletRequest.isUserInRole()
   +--> @RolesAllowed
   +--> JAX-RS/CDI/EJB integration
```

Ada tiga pertanyaan inti:

| Pertanyaan | Komponen utama |
|---|---|
| Siapa caller ini? | `HttpAuthenticationMechanism`, `IdentityStore`, `CredentialValidationResult` |
| Apa identity caller yang dikenal container? | `CallerPrincipal`, group, container role mapping |
| Bagaimana application code membaca/mengecek caller? | `SecurityContext`, Servlet request API, method security |

Jakarta Security bukan hanya “API login”. Ia adalah cara untuk membuat hasil login menjadi **container-recognized identity**.

---

## 3. Namespace: Java EE 8 vs Jakarta EE

Salah satu sumber kebingungan adalah package name.

### 3.1 Java EE 8 / Jakarta EE 8

Di era Java EE 8 / Jakarta EE 8, API ini masih memakai namespace:

```java
javax.security.enterprise.*
```

Contoh:

```java
import javax.security.enterprise.SecurityContext;
import javax.security.enterprise.identitystore.IdentityStore;
import javax.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism;
```

### 3.2 Jakarta EE 9+

Mulai Jakarta EE 9, namespace berubah menjadi:

```java
jakarta.security.enterprise.*
```

Contoh:

```java
import jakarta.security.enterprise.SecurityContext;
import jakarta.security.enterprise.identitystore.IdentityStore;
import jakarta.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism;
```

### 3.3 Mental Model Migration

Secara konsep, model API tetap mirip:

```text
javax.security.enterprise.*  ->  jakarta.security.enterprise.*
```

Tetapi secara runtime, ini bukan sekadar rename import. Seluruh container, Servlet API, CDI API, JAX-RS API, dan dependency harus cocok.

Contoh mismatch:

- App memakai `jakarta.*`, container masih Java EE 8 `javax.*`.
- App memakai `javax.*`, container Jakarta EE 10/11 hanya expose `jakarta.*`.
- Library security lama compile ke `javax.*`, aplikasi sudah migrasi ke `jakarta.*`.

Security adalah salah satu area yang paling rentan saat migrasi karena efeknya tidak selalu compile error. Kadang aplikasi deploy, tetapi authentication/authorization diam-diam tidak aktif.

---

## 4. Pilar 1: `SecurityContext`

`SecurityContext` adalah API injectable yang dipakai application code untuk berinteraksi dengan security context.

Contoh:

```java
import jakarta.inject.Inject;
import jakarta.security.enterprise.SecurityContext;

public class CurrentUserService {

    @Inject
    private SecurityContext securityContext;

    public String currentUsername() {
        if (securityContext.getCallerPrincipal() == null) {
            return null;
        }
        return securityContext.getCallerPrincipal().getName();
    }

    public boolean isAdmin() {
        return securityContext.isCallerInRole("ADMIN");
    }
}
```

### 4.1 Fungsi Utama `SecurityContext`

Secara konseptual, `SecurityContext` menyediakan kemampuan:

1. Mengambil caller principal.
2. Mengecek role caller.
3. Memeriksa apakah caller punya akses ke web resource tertentu.
4. Melakukan authentication programmatically.

Modelnya:

```text
SecurityContext = application-facing view of container security state
```

Ia bukan database user, bukan session object, bukan token parser, dan bukan domain authorization engine.

### 4.2 `getCallerPrincipal()`

```java
Principal principal = securityContext.getCallerPrincipal();
```

Jika caller sudah authenticated, method ini mengembalikan principal. Jika belum, biasanya null.

Penting:

```text
principal != user entity
```

Principal adalah identity representation. Biasanya cukup berisi name. Jangan memaksakan semua profile user masuk ke principal.

Buruk:

```java
public class FatUserPrincipal implements Principal {
    private Long id;
    private String username;
    private String email;
    private String phone;
    private String department;
    private List<Permission> permissions;
    private byte[] profilePicture;
    private String accessToken;
}
```

Lebih baik:

```java
public final class ApplicationPrincipal implements Principal {
    private final String subject;

    public ApplicationPrincipal(String subject) {
        this.subject = subject;
    }

    @Override
    public String getName() {
        return subject;
    }
}
```

Lalu detail profile diambil dari service khusus:

```java
UserProfile profile = userProfileService.findBySubject(principal.getName());
```

### 4.3 `isCallerInRole(String role)`

```java
boolean allowed = securityContext.isCallerInRole("CASE_APPROVER");
```

Ini mengecek role menurut container/application security mapping.

Yang harus diingat:

```text
isCallerInRole(role) adalah role-level check, bukan domain permission final.
```

Role check cocok untuk coarse-grained access:

- boleh masuk admin module,
- boleh akses endpoint management,
- boleh membuka menu tertentu,
- boleh menjalankan operation class tertentu.

Tetapi tidak cukup untuk fine-grained domain decision:

- boleh approve case ini?
- boleh assign officer untuk agency ini?
- boleh melihat application milik tenant lain?
- boleh override escalation setelah SLA breach?
- boleh melakukan action saat state case = `PENDING_REVIEW`?

Untuk itu butuh domain authorization.

### 4.4 `hasAccessToWebResource(...)`

`SecurityContext` juga memiliki method untuk memeriksa akses caller ke web resource tertentu berdasarkan security constraint web tier.

Mental model:

```text
hasAccessToWebResource(resource, methods)
    -> asks container whether current caller has access according to Servlet security rules
```

Contoh penggunaan:

```java
boolean canAccessAdminPage = securityContext.hasAccessToWebResource(
        "/admin/dashboard",
        "GET"
);
```

Ini berguna untuk:

- conditional rendering menu,
- UI navigation hints,
- checking web resource rule secara programmatic.

Namun jangan menjadikan ini satu-satunya enforcement. UI hiding bukan security enforcement.

### 4.5 `authenticate(...)`

`SecurityContext` dapat memicu authentication programmatically dari application code.

Mental model:

```text
application asks container: please authenticate this request/response pair
```

Biasanya dipakai ketika login flow perlu dipicu dari code, bukan otomatis dari protected URL.

Namun hati-hati:

- jangan membuat login flow terlalu tersebar,
- jangan challenge user dari service layer,
- jangan memanggil authenticate setelah response committed,
- jangan campur manual session login dengan container login tanpa desain yang jelas.

---

## 5. Pilar 2: `HttpAuthenticationMechanism`

`HttpAuthenticationMechanism` adalah kontrak untuk authentication mechanism berbasis HTTP.

Secara sederhana:

```text
HttpAuthenticationMechanism = component that knows how to obtain caller credential from HTTP interaction
```

Contoh mekanisme:

- Basic auth membaca `Authorization: Basic ...`.
- Form auth membaca submitted username/password dari request parameter.
- Custom form auth membaca credential dari custom endpoint.
- OIDC mechanism memproses redirect dan callback dari Identity Provider.
- Bearer token custom mechanism membaca `Authorization: Bearer ...`.

### 5.1 Method Konseptual

Pada level konsep, mechanism harus mampu melakukan hal-hal berikut:

1. Melihat request.
2. Memutuskan apakah ada credential.
3. Jika ada, validate credential melalui identity store atau validasi sendiri.
4. Memberi tahu container apakah authentication berhasil, gagal, butuh challenge, atau tidak dilakukan.
5. Membersihkan state saat logout jika perlu.

Alur umum:

```text
validateRequest(request, response, context)
   |
   +-- no credential and resource public
   |       -> NOT_DONE
   |
   +-- no credential and resource protected
   |       -> SEND_CONTINUE / challenge / redirect login
   |
   +-- credential present and valid
   |       -> SUCCESS
   |
   +-- credential present but invalid
           -> SEND_FAILURE
```

### 5.2 Authentication Status

Authentication mechanism mengembalikan status yang menggambarkan hasil proses.

Secara mental model:

| Status | Arti |
|---|---|
| Success | Caller berhasil diautentikasi |
| Send continue | Response sudah diarahkan untuk melanjutkan auth, misalnya redirect login/challenge |
| Send failure | Authentication gagal dan response failure dikirim |
| Not done | Mechanism tidak melakukan authentication |

Hal yang sering salah:

```text
NOT_DONE bukan berarti authenticated sebagai anonymous admin.
```

`NOT_DONE` hanya berarti mechanism tidak menetapkan caller. Kalau resource protected, container tetap harus menolak atau memicu mechanism lain sesuai aturan.

### 5.3 Custom Mechanism Minimal

Contoh skeleton untuk custom bearer token mechanism:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.security.enterprise.AuthenticationStatus;
import jakarta.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism;
import jakarta.security.enterprise.authentication.mechanism.http.HttpMessageContext;
import jakarta.security.enterprise.identitystore.CredentialValidationResult;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@ApplicationScoped
public class BearerTokenAuthenticationMechanism implements HttpAuthenticationMechanism {

    @Inject
    TokenIdentityStore tokenIdentityStore;

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext httpMessageContext) {

        String authorization = request.getHeader("Authorization");

        if (authorization == null || !authorization.startsWith("Bearer ")) {
            if (httpMessageContext.isProtected()) {
                response.setHeader("WWW-Authenticate", "Bearer");
                return httpMessageContext.responseUnauthorized();
            }
            return httpMessageContext.doNothing();
        }

        String token = authorization.substring("Bearer ".length());
        TokenCredential credential = new TokenCredential(token);

        CredentialValidationResult result = tokenIdentityStore.validate(credential);

        if (result.getStatus() == CredentialValidationResult.Status.VALID) {
            return httpMessageContext.notifyContainerAboutLogin(
                    result.getCallerPrincipal(),
                    result.getCallerGroups()
            );
        }

        response.setHeader("WWW-Authenticate", "Bearer error=\"invalid_token\"");
        return httpMessageContext.responseUnauthorized();
    }
}
```

Catatan penting:

- Mechanism membaca credential dari HTTP.
- Identity store memvalidasi credential.
- Mechanism memberitahu container tentang login.
- Container kemudian punya principal dan groups.

Kalau hanya melakukan:

```java
request.setAttribute("user", user);
```

maka itu bukan container-recognized authentication.

---

## 6. Pilar 3: `IdentityStore`

`IdentityStore` adalah komponen yang memvalidasi credential dan/atau menyediakan group caller.

Mental model:

```text
IdentityStore = authority that knows whether credential is valid and what groups caller has
```

Contoh sumber identity:

- database user table,
- LDAP,
- in-memory user list,
- external IdP mapping,
- token introspection endpoint,
- certificate registry,
- legacy SSO table.

### 6.1 Tanggung Jawab `IdentityStore`

Identity store idealnya menjawab:

1. Apakah credential valid?
2. Siapa caller principal-nya?
3. Group apa yang dimiliki caller?
4. Apakah store ini hanya validate, hanya provide group, atau keduanya?

Contoh:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.security.enterprise.credential.UsernamePasswordCredential;
import jakarta.security.enterprise.identitystore.CredentialValidationResult;
import jakarta.security.enterprise.identitystore.IdentityStore;

import java.util.Set;

@ApplicationScoped
public class DatabaseIdentityStore implements IdentityStore {

    @Override
    public CredentialValidationResult validate(UsernamePasswordCredential credential) {
        String username = credential.getCaller();
        String password = credential.getPasswordAsString();

        UserRecord user = findUser(username);

        if (user == null) {
            return CredentialValidationResult.INVALID_RESULT;
        }

        if (!passwordHasher.verify(password, user.passwordHash())) {
            return CredentialValidationResult.INVALID_RESULT;
        }

        Set<String> groups = loadGroups(user.id());

        return new CredentialValidationResult(username, groups);
    }
}
```

### 6.2 Jangan Campur Semua Hal ke Identity Store

Identity store bukan tempat untuk semua business authorization.

Buruk:

```java
public CredentialValidationResult validate(UsernamePasswordCredential credential) {
    // validate password
    // check case assignment
    // check approval authority
    // check tenant boundary
    // check whether user can approve application
    // check workflow state
}
```

Lebih sehat:

```text
IdentityStore:
    validate caller identity
    return principal and groups

AuthorizationService:
    decide if caller can perform action on domain resource
```

Karena authentication dan domain authorization punya lifecycle berbeda:

| Concern | Pertanyaan | Lifecycle |
|---|---|---|
| Authentication | Siapa caller? | login/request/token validation |
| Group loading | Caller termasuk group apa? | login/request/cache refresh |
| Domain authorization | Caller boleh melakukan action ini pada resource ini? | setiap business operation |

### 6.3 Validation Type

`IdentityStore` dapat berperan untuk:

- validate credential,
- provide groups,
- keduanya.

Ini penting untuk desain multi-store.

Contoh desain:

```text
Store A: validate username/password against database
Store B: provide groups from LDAP
Store C: provide groups from internal role table
```

Alurnya:

```text
credential -> Store A validates caller
          -> Store B loads enterprise groups
          -> Store C loads application groups
          -> container receives principal + combined groups
```

Namun multi-store harus dirancang hati-hati supaya tidak terjadi:

- duplicate group conflict,
- group source tidak konsisten,
- performance buruk,
- fallback tidak aman,
- user berhasil validate di satu store tetapi group dari user lain terambil karena key mapping salah.

---

## 7. `Credential` Model

Credential adalah bukti yang diajukan caller untuk membuktikan identity.

Contoh credential:

- username/password,
- token,
- certificate,
- one-time code,
- signed assertion,
- API key,
- external login callback code.

Jakarta Security menyediakan beberapa credential type standar, dan aplikasi dapat membuat custom credential.

### 7.1 Username Password Credential

Contoh:

```java
UsernamePasswordCredential credential = new UsernamePasswordCredential(
        username,
        new Password(password)
);
```

Credential ini biasanya dipakai untuk form/basic authentication.

### 7.2 Caller Only Credential

Kadang caller sudah dipercaya oleh layer lain, misalnya reverse proxy atau mTLS termination yang sudah memvalidasi certificate dan meneruskan identity ke container dengan cara trusted.

Dalam desain seperti ini credential bisa berupa caller identity saja. Tetapi harus sangat hati-hati:

```text
Jika identity berasal dari header, pastikan header itu tidak bisa disuplai langsung oleh client.
```

Buruk:

```java
String username = request.getHeader("X-User");
```

Tanpa memastikan request benar-benar datang dari trusted gateway, ini authentication bypass.

### 7.3 Custom Credential

Untuk bearer token custom:

```java
import jakarta.security.enterprise.credential.Credential;

public final class TokenCredential implements Credential {
    private final String token;

    public TokenCredential(String token) {
        this.token = token;
    }

    public String token() {
        return token;
    }
}
```

Identity store:

```java
public CredentialValidationResult validate(TokenCredential credential) {
    TokenClaims claims = tokenVerifier.verify(credential.token());

    if (claims == null) {
        return CredentialValidationResult.INVALID_RESULT;
    }

    return new CredentialValidationResult(
            new CallerPrincipal(claims.subject()),
            mapClaimsToGroups(claims)
    );
}
```

Design rule:

```text
Credential object should represent proof, not final permission.
```

Jangan membuat credential seperti:

```java
public class AdminCredential implements Credential { ... }
```

Karena admin bukan credential. Admin adalah authorization result/role/permission.

---

## 8. `CredentialValidationResult`

`CredentialValidationResult` adalah hasil validasi credential.

Mental model:

```text
CredentialValidationResult = identity establishment result
```

Ia membawa:

- status validasi,
- caller principal,
- caller unique id/name,
- groups,
- optional metadata terkait store.

### 8.1 Result Status

Secara konseptual:

| Status | Arti |
|---|---|
| VALID | Credential valid dan caller berhasil dikenali |
| INVALID | Credential diperiksa dan dianggap salah |
| NOT_VALIDATED | Store tidak memvalidasi credential ini |

Perbedaan `INVALID` dan `NOT_VALIDATED` penting.

```text
INVALID = saya tahu credential ini dan credential ini salah
NOT_VALIDATED = saya bukan store yang tepat untuk credential ini / saya tidak melakukan validasi
```

Dalam multi-store setup, ini menentukan apakah container boleh mencoba store lain atau harus berhenti.

### 8.2 Principal dan Groups

Contoh:

```java
return new CredentialValidationResult(
        new CallerPrincipal("user-123"),
        Set.of("CASE_OFFICER", "APPLICATION_REVIEWER")
);
```

Di sini `user-123` adalah principal name. Groups akan menjadi basis role check container.

Namun harus jelas:

```text
groups returned by identity store are not always final application permissions
```

Mereka lebih tepat disebut coarse-grained memberships.

### 8.3 Stable Principal Name

Pilih principal name yang stabil.

Buruk:

```text
principal = email address
```

Email bisa berubah.

Lebih baik:

```text
principal = immutable subject id from IdP or internal user id
```

Namun untuk audit manusia, simpan juga display name/email pada audit snapshot:

```json
{
  "actorSubject": "idp|9a82b...",
  "actorUsername": "fajar",
  "actorDisplayName": "Fajar Abdi Nugraha",
  "actorEmail": "fajar@example.com"
}
```

Principal untuk identity consistency. Display info untuk audit readability.

---

## 9. `CallerPrincipal`

`CallerPrincipal` adalah principal representation yang disediakan Jakarta Security.

Contoh:

```java
return new CredentialValidationResult(
        new CallerPrincipal(username),
        groups
);
```

Atau cukup:

```java
return new CredentialValidationResult(username, groups);
```

### 9.1 Principal Minimalism

Prinsip:

```text
Principal should be stable, minimal, serializable enough, and safe to expose in logs with controls.
```

Jangan menyimpan:

- password,
- access token,
- refresh token,
- raw JWT,
- PII berat,
- permission snapshot besar,
- mutable domain object.

Kenapa?

1. Principal bisa masuk session replication.
2. Principal bisa muncul di log/audit/debug.
3. Principal bisa diserialisasi antar node.
4. Principal stale jika role/profile berubah.
5. Principal bukan cache semua data user.

---

## 10. Built-in Authentication Mechanism Definitions

Jakarta Security menyediakan annotation untuk mendefinisikan authentication mechanism tertentu.

Contoh pola:

```java
@BasicAuthenticationMechanismDefinition(
    realmName = "application"
)
@ApplicationScoped
public class SecurityConfiguration {
}
```

Form:

```java
@FormAuthenticationMechanismDefinition(
    loginToContinue = @LoginToContinue(
        loginPage = "/login.xhtml",
        errorPage = "/login-error.xhtml"
    )
)
@ApplicationScoped
public class SecurityConfiguration {
}
```

Custom form:

```java
@CustomFormAuthenticationMechanismDefinition(
    loginToContinue = @LoginToContinue(
        loginPage = "/login.xhtml",
        errorPage = "/login-error.xhtml"
    )
)
@ApplicationScoped
public class SecurityConfiguration {
}
```

OIDC:

```java
@OpenIdAuthenticationMechanismDefinition(
    providerURI = "https://idp.example.com/realms/example",
    clientId = "jakarta-app",
    clientSecret = "${oidc.client.secret}",
    redirectURI = "${baseURL}/callback",
    scope = { "openid", "profile", "email" }
)
@ApplicationScoped
public class SecurityConfiguration {
}
```

Catatan:

- Detail annotation bisa berbeda per versi Jakarta Security.
- Secret sebaiknya tidak hardcoded.
- OIDC config perlu memahami issuer, audience, redirect URI, state, nonce, JWKS, dan logout.

---

## 11. Built-in Identity Store Definitions

Jakarta Security juga menyediakan annotation untuk built-in identity store seperti database dan LDAP pada versi tertentu.

Contoh database identity store konseptual:

```java
@DatabaseIdentityStoreDefinition(
    dataSourceLookup = "java:global/jdbc/ApplicationDS",
    callerQuery = "select password_hash from users where username = ?",
    groupsQuery = "select role_name from user_roles where username = ?",
    hashAlgorithm = Pbkdf2PasswordHash.class
)
@ApplicationScoped
public class SecurityConfiguration {
}
```

Mental model:

```text
Database identity store = standardized way to validate username/password and load groups from SQL
```

Namun untuk enterprise-grade system, sering kali custom identity store lebih tepat karena perlu:

- user status check,
- password migration,
- tenant-aware login,
- account lockout,
- MFA state,
- external IdP linking,
- audit event,
- adaptive risk handling,
- multiple source mapping.

### 11.1 In-memory Identity Store

Jakarta Security 4.0 menambahkan standardized in-memory identity store.

Gunanya:

- demo,
- local testing,
- simple sample,
- integration test.

Jangan jadikan in-memory identity store sebagai production user management kecuali use case benar-benar sangat terbatas dan controlled.

---

## 12. CDI Integration

Salah satu kemajuan besar Jakarta Security dibanding model lama adalah integrasi dengan CDI.

Artinya authentication mechanism dan identity store dapat menjadi CDI bean:

```java
@ApplicationScoped
public class DatabaseIdentityStore implements IdentityStore {

    @Inject
    UserRepository userRepository;

    @Inject
    PasswordHash passwordHash;

    // ...
}
```

Keuntungan:

1. Bisa inject repository/service.
2. Bisa inject configuration.
3. Bisa memakai interceptor.
4. Bisa memakai producer.
5. Bisa testing lebih mudah.
6. Bisa composition dengan service lain.

Tetapi ada trap:

```text
Security mechanism dipanggil sangat awal dalam request lifecycle.
```

Jangan bergantung pada state request/application yang belum siap.

Trap lain:

- circular dependency antara security bean dan business service,
- security bean memanggil endpoint yang juga secured,
- identity store memicu transaksi berat saat login,
- interceptor security memanggil `SecurityContext` saat security context belum established.

### 12.1 Bean Discovery

Agar container menemukan custom `HttpAuthenticationMechanism` atau `IdentityStore`, class harus terdeteksi sebagai CDI bean.

Biasanya dengan:

```java
@ApplicationScoped
public class MyIdentityStore implements IdentityStore { ... }
```

atau konfigurasi bean archive.

Jika mechanism tidak jalan, salah satu hal pertama yang dicek:

```text
Apakah class ini benar-benar CDI bean dan ditemukan container?
```

---

## 13. Authentication Lifecycle dengan Jakarta Security

Mari lihat alur detail.

### 13.1 Request Public

```text
Client -> GET /public/info
Container -> asks authentication mechanism
Mechanism -> no credential
Mechanism -> doNothing / NOT_DONE
Container -> resource not protected
Application -> handles request as anonymous
```

### 13.2 Protected Request Tanpa Credential

```text
Client -> GET /admin/dashboard
Container -> resource protected
Mechanism -> no credential
Mechanism -> send challenge / redirect login
Container -> response sent
Application resource -> not called
```

### 13.3 Login dengan Credential Valid

```text
Client -> POST /login username/password
Mechanism -> extracts credential
IdentityStore -> validates credential
IdentityStore -> returns principal + groups
Mechanism -> notify container about login
Container -> establishes security context
Application -> sees caller principal
```

### 13.4 Login dengan Credential Invalid

```text
Client -> POST /login wrong password
Mechanism -> extracts credential
IdentityStore -> invalid result
Mechanism -> failure / redirect error / 401
Container -> no authenticated caller
Application protected resource -> not called
```

### 13.5 Existing Session

```text
Client -> GET /admin/dashboard with session cookie
Container -> restores security context from session
SecurityContext -> caller principal available
Application -> can check roles
```

Namun tergantung container dan mechanism, authentication mechanism tetap bisa dipanggil untuk request tertentu.

---

## 14. Relationship dengan Servlet API

Servlet API menyediakan:

```java
request.getUserPrincipal();
request.isUserInRole("ADMIN");
request.login(username, password);
request.logout();
request.authenticate(response);
```

Jakarta Security menyediakan:

```java
securityContext.getCallerPrincipal();
securityContext.isCallerInRole("ADMIN");
securityContext.authenticate(request, response, parameters);
```

Keduanya melihat state container yang sama atau seharusnya konsisten.

Mental model:

```text
Servlet API = web request-facing security API
Jakarta SecurityContext = CDI/application-facing security API
```

Jika keduanya berbeda, ada masalah integration.

Contoh red flag:

```java
request.getUserPrincipal() != null
securityContext.getCallerPrincipal() == null
```

atau sebaliknya. Ini bisa menandakan:

- context injection di luar request,
- custom filter tidak notify container,
- security mechanism tidak terdaftar,
- request async/thread context hilang,
- container-specific bug/configuration.

---

## 15. Relationship dengan Jakarta Authentication

Jakarta Security lebih nyaman untuk application developer. Jakarta Authentication adalah SPI lebih rendah untuk container authentication.

Sederhananya:

```text
Jakarta Security HttpAuthenticationMechanism
    lebih mudah, CDI-friendly, app-facing

Jakarta Authentication ServerAuthModule
    lebih rendah, message-level, container SPI
```

Kapan memakai Jakarta Security?

- Custom form login.
- Database login.
- Token authentication sederhana.
- OIDC mechanism configuration.
- Application-level identity store.
- CDI-friendly security.

Kapan mungkin perlu Jakarta Authentication langsung?

- Integrasi container-level yang sangat custom.
- Message authentication non-trivial.
- Vendor/container security extension.
- Mechanism yang perlu bekerja di layer lebih rendah.
- Cross-application auth module.

Untuk mayoritas aplikasi enterprise Jakarta, Jakarta Security adalah entry point yang lebih realistis.

---

## 16. Relationship dengan Jakarta Authorization

Jakarta Authorization mengatur kontrak authorization container berbasis subject dan permission.

Jakarta Security membantu menetapkan caller dan group. Setelah caller established, container authorization dapat menggunakan identity itu untuk memutuskan akses.

Mental flow:

```text
Jakarta Security:
    caller = fajar
    groups = CASE_OFFICER, REVIEWER

Container/Jakarta Authorization:
    resource /admin requires ADMIN
    caller groups do not include ADMIN
    deny
```

Atau:

```text
method approveCase requires CASE_APPROVER
caller groups include CASE_APPROVER
allow at coarse-grained layer
business authorization still checks case-specific rules
```

Jangan berpikir Jakarta Security sudah menyelesaikan semua authorization. Ia memberi identity dan group; authorization detail tetap perlu didesain.

---

## 17. Relationship dengan JAX-RS

JAX-RS berjalan di atas web/container environment. Jika Jakarta Security berhasil establish caller, JAX-RS resource bisa memakai:

```java
@Context
SecurityContext jaxrsSecurityContext;
```

Perhatikan: ini `jakarta.ws.rs.core.SecurityContext`, bukan `jakarta.security.enterprise.SecurityContext`.

Contoh:

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.SecurityContext;

@Path("/cases")
public class CaseResource {

    @GET
    @RolesAllowed("CASE_VIEWER")
    public List<CaseDto> list(@Context SecurityContext securityContext) {
        String caller = securityContext.getUserPrincipal().getName();
        return caseService.listVisibleCases(caller);
    }
}
```

Aplikasi juga bisa inject Jakarta Security `SecurityContext` via CDI di service layer:

```java
@Inject
jakarta.security.enterprise.SecurityContext securityContext;
```

Hati-hati naming collision:

```java
jakarta.security.enterprise.SecurityContext
jakarta.ws.rs.core.SecurityContext
```

Keduanya berbeda API dengan tujuan berbeda.

---

## 18. Relationship dengan Method Security

Setelah identity established, method security seperti ini bisa bekerja:

```java
@RolesAllowed("CASE_APPROVER")
public void approve(String caseId) {
    ...
}
```

Namun ada dua lapis decision:

```text
@RolesAllowed("CASE_APPROVER")
    -> coarse-grained role gate

authorizationService.canApprove(caller, caseId)
    -> domain-specific decision
```

Contoh:

```java
@RolesAllowed("CASE_APPROVER")
public void approve(String caseId) {
    Actor actor = currentActor.requireAuthenticated();
    CaseAggregate caze = caseRepository.get(caseId);

    if (!authorizationService.canApprove(actor, caze)) {
        throw new ForbiddenException("Caller cannot approve this case");
    }

    caze.approve(actor);
}
```

Kenapa tetap perlu dua lapis?

Karena role `CASE_APPROVER` hanya mengatakan caller punya kapasitas umum sebagai approver, bukan berarti boleh approve semua case di semua tenant/state.

---

## 19. Security API Bukan Domain Authorization Engine

Ini sangat penting.

Jakarta Security menjawab:

```text
Who is the caller?
What groups/roles does the caller have at container/application level?
```

Ia tidak otomatis menjawab:

```text
Can this caller approve this exact case right now?
Can this caller see this tenant's data?
Can this caller reassign this officer after escalation?
Can this caller bypass maker-checker because of emergency override?
```

Untuk domain authorization, desain model sendiri:

```java
public interface AuthorizationService {
    boolean canViewCase(Actor actor, CaseAggregate caze);
    boolean canApproveCase(Actor actor, CaseAggregate caze);
    boolean canReassignCase(Actor actor, CaseAggregate caze, Officer target);
}
```

Dengan Actor diambil dari security context:

```java
public Actor currentActor() {
    Principal principal = securityContext.getCallerPrincipal();
    if (principal == null) {
        return Actor.anonymous();
    }

    Set<String> roles = roleService.currentRoles(principal.getName());
    return Actor.authenticated(principal.getName(), roles);
}
```

Jangan langsung menyebarkan `SecurityContext` ke seluruh domain model.

Buruk:

```java
caseAggregate.approve(securityContext);
```

Lebih baik:

```java
caseAggregate.approve(actor, decisionReason);
```

Domain tidak perlu tahu Jakarta Security API.

---

## 20. Designing a Current Actor Abstraction

Aplikasi enterprise biasanya butuh abstraction di atas `SecurityContext`.

Contoh:

```java
public final class Actor {
    private final String subject;
    private final String displayName;
    private final Set<String> roles;
    private final String tenantId;
    private final boolean system;

    // constructors/getters
}
```

Provider:

```java
@ApplicationScoped
public class CurrentActorProvider {

    @Inject
    SecurityContext securityContext;

    @Inject
    UserDirectory userDirectory;

    public Actor requireAuthenticated() {
        Principal principal = securityContext.getCallerPrincipal();

        if (principal == null) {
            throw new UnauthorizedException("Authentication required");
        }

        UserSnapshot user = userDirectory.loadSnapshot(principal.getName());

        return Actor.authenticated(
                principal.getName(),
                user.displayName(),
                user.activeTenantId(),
                user.roles()
        );
    }
}
```

Tujuan abstraction ini:

1. Mencegah Jakarta API bocor ke domain layer.
2. Menyatukan cara membaca caller.
3. Memberi tempat untuk user snapshot.
4. Memudahkan audit.
5. Memudahkan test.
6. Memisahkan role container dari permission domain.

---

## 21. Configuration Philosophy

Security configuration biasanya bisa dilakukan melalui:

1. Annotation.
2. Deployment descriptor.
3. Container admin configuration.
4. CDI beans.
5. MicroProfile Config / environment variables.
6. Vendor-specific config.

Jakarta Security mendorong annotation dan CDI bean, tetapi enterprise production sering butuh externalized config.

Contoh hal yang tidak boleh hardcoded:

- OIDC client secret.
- issuer URL per environment.
- JWKS endpoint override.
- database datasource JNDI name jika berbeda per env.
- cookie domain.
- callback base URL.
- trusted proxy config.

Prinsip:

```text
Security logic should be stable; security configuration should be environment-aware.
```

Buruk:

```java
@OpenIdAuthenticationMechanismDefinition(
    providerURI = "https://uat-idp.example.com/realms/test",
    clientSecret = "secret123"
)
```

Lebih baik gunakan indirection/config expression jika container mendukung, atau producer/config bean.

---

## 22. Portability: Janji dan Realita

Jakarta Security adalah standard. Namun portability bukan berarti semua container berperilaku identik di setiap detail.

Container yang berbeda dapat berbeda pada:

- fitur Jakarta EE version yang didukung,
- interpretasi config expression,
- default security realm,
- session behavior,
- OIDC feature maturity,
- integration dengan JAX-RS implementation,
- role mapping dari group ke role,
- error handling default,
- remember-me behavior,
- support multiple authentication mechanisms,
- built-in identity store behavior,
- classloading dan CDI discovery.

### 22.1 Portability Contract yang Relatif Aman

Biasanya cukup portable:

- `SecurityContext.getCallerPrincipal()`
- `SecurityContext.isCallerInRole()`
- custom `IdentityStore` sebagai CDI bean
- custom `HttpAuthenticationMechanism` sebagai CDI bean
- basic/form mechanism definition dasar
- `CredentialValidationResult` principal + groups

### 22.2 Area yang Perlu Integration Test di Container Target

Wajib test langsung di container target untuk:

- OIDC login/callback/logout,
- multiple authentication mechanisms,
- remember-me,
- session replication,
- async context propagation,
- CDI discovery di packaging kompleks,
- role mapping ke deployment descriptor,
- integration dengan JAX-RS method security,
- custom mechanism order,
- proxy/TLS forwarded header behavior.

Prinsip:

```text
Spec-level knowledge is necessary, but production correctness requires testing against the exact container/runtime.
```

---

## 23. Java 8–25 Considerations

Jakarta Security API sendiri bergantung pada Jakarta EE version/container, bukan semata JDK version. Tetapi Java version memengaruhi runtime behavior dan design choice.

### 23.1 Java 8

Konteks umum:

- Banyak aplikasi Java EE 8 berjalan di Java 8.
- Namespace `javax.*` masih dominan.
- Security API berasal dari Java EE Security API / JSR 375.
- Lambdas/streams tersedia, tetapi modern language features belum ada.

Concern:

- legacy app server,
- JAAS/login module lama,
- custom realm vendor-specific,
- TLS provider/cipher support perlu diperhatikan,
- migration ke Jakarta butuh effort besar.

### 23.2 Java 11/17

Konteks:

- Banyak Jakarta EE 9/10 deployment memakai Java 11/17.
- Java 17 sering jadi baseline modern enterprise.
- Stronger module/classpath awareness.

Concern:

- dependency namespace migration,
- old security libraries incompatible,
- reflection/classloading issue,
- app server support matrix.

### 23.3 Java 21

Java 21 memperkenalkan virtual threads sebagai production feature.

Security concern:

```text
Jangan asumsikan semua security context propagation berbasis ThreadLocal aman tanpa memahami runtime/container.
```

Jika menggunakan virtual threads, managed executors, atau reactive pipeline, test:

- apakah principal tersedia di execution path,
- apakah context leak terjadi,
- apakah async callback menjalankan identity yang benar.

### 23.4 Java 25

Java 25 adalah generasi lebih baru dan membawa runtime/library evolution. Namun Jakarta Security behavior tetap ditentukan oleh container compatibility.

Checklist:

- Apakah app server mendukung Java 25?
- Apakah Jakarta EE version mendukung runtime tersebut?
- Apakah third-party security provider kompatibel?
- Apakah TLS/JCA provider behavior berubah?
- Apakah reflection/config issue muncul?

Prinsip:

```text
JDK version tells you what VM can do. Jakarta EE container version tells you what enterprise security contract is available.
```

---

## 24. Comparing Jakarta Security and Spring Security

Karena banyak engineer Java modern mengenal Spring Security, penting memahami bedanya.

### 24.1 Jakarta Security

Karakter:

- Standard Jakarta EE API.
- Container-integrated.
- CDI-aware.
- Cocok untuk Jakarta EE runtime seperti Payara, WildFly, Open Liberty, WebLogic, TomEE, dll.
- Integrasi dengan Servlet/JAX-RS/EJB/CDI security.
- API lebih kecil dan standard-driven.

### 24.2 Spring Security

Karakter:

- Framework-level security.
- Sangat kaya fitur.
- Filter chain centric.
- Terintegrasi kuat dengan Spring MVC/WebFlux/Boot.
- Ecosystem OAuth2/resource server/client sangat mature.
- Biasanya berjalan di embedded container.

### 24.3 Perbedaan Mental Model

```text
Jakarta Security:
    container establishes caller
    app queries SecurityContext
    role/method security tied to Jakarta container model

Spring Security:
    Spring filter chain establishes Authentication
    app queries SecurityContextHolder
    authorization via Spring interceptors/filters/annotations
```

### 24.4 Jangan Campur Tanpa Desain

Jika menjalankan Spring Security di Jakarta EE container, hati-hati:

- Spring `SecurityContextHolder` bukan Jakarta `SecurityContext`.
- Spring `Authentication` bukan Jakarta caller principal.
- Spring authorities bukan otomatis Jakarta roles.
- Jakarta `@RolesAllowed` mungkin tidak membaca Spring security context.
- Servlet `request.getUserPrincipal()` bisa berbeda dari Spring authentication.

Jika harus coexist:

1. Pilih satu enforcement model utama.
2. Definisikan adapter jelas.
3. Pastikan principal konsisten.
4. Test method security dari dua framework.
5. Hindari double login flow.

---

## 25. Common Architecture Patterns

### 25.1 Simple Jakarta EE Form Login

```text
Browser
   -> Form login
   -> Jakarta Security form mechanism
   -> Database IdentityStore
   -> Principal + groups
   -> HttpSession
   -> @RolesAllowed / SecurityContext
```

Cocok untuk:

- internal admin app,
- simple enterprise app,
- server-rendered UI,
- legacy modernization.

Risiko:

- password handling harus benar,
- CSRF harus benar,
- session hardening wajib.

### 25.2 OIDC Login with External IdP

```text
Browser
   -> App protected URL
   -> OIDC redirect to IdP
   -> IdP authenticates user
   -> Callback with code
   -> Jakarta Security OIDC mechanism
   -> ID token validation / user info / claims mapping
   -> Principal + groups
   -> App session
```

Cocok untuk:

- SSO enterprise,
- centralized identity,
- MFA via IdP,
- multi-app environment.

Risiko:

- wrong issuer/audience,
- nonce/state handling,
- logout complexity,
- role claim mapping drift.

### 25.3 API Bearer Token Mechanism

```text
Client/API Gateway
   -> Authorization: Bearer token
   -> Custom HttpAuthenticationMechanism
   -> Token validation/introspection
   -> Principal + groups/scopes
   -> JAX-RS resource
```

Cocok untuk:

- REST API,
- service-to-service,
- SPA backend API,
- mobile API.

Risiko:

- treating ID token as access token,
- missing audience validation,
- stale JWKS,
- no revocation strategy,
- scope-role confusion.

### 25.4 Gateway Authenticated Identity

```text
Client
   -> Gateway validates token/cert
   -> Gateway forwards trusted identity header
   -> App validates gateway trust boundary
   -> Custom mechanism maps trusted header to principal
```

Cocok jika:

- gateway is strong enforcement point,
- network boundary controlled,
- app only receives traffic from gateway,
- headers stripped/recreated by gateway.

Risiko besar:

- header spoofing,
- bypass gateway via internal route,
- missing mTLS between gateway and app,
- app trusts identity header from untrusted caller.

---

## 26. Error Semantics

Jakarta Security mechanism harus membedakan beberapa kondisi:

| Kondisi | Response umum | Arti |
|---|---|---|
| No credential, protected resource | 401 or redirect login | Authentication required |
| Invalid credential | 401 / login error | Authentication failed |
| Valid caller, insufficient role | 403 | Authenticated but forbidden |
| Public resource | 200 | No authentication required |
| IdP unavailable | 503 or controlled auth error | Infrastructure/external dependency failure |

Jangan samakan semua menjadi 500.

Buruk:

```text
Invalid password -> 500 Internal Server Error
```

Buruk:

```text
No permission -> redirect login again
```

Karena user sudah authenticated tetapi tidak authorized.

Benar:

```text
Unauthenticated -> challenge/login
Authenticated but not allowed -> forbidden
System dependency unavailable -> service unavailable/error page with correlation id
```

---

## 27. Logging and Audit Boundary

Security API code adalah salah satu lokasi paling sensitif untuk logging.

Jangan log:

- raw password,
- token,
- authorization header,
- client secret,
- full ID token/access token,
- raw SAML assertion,
- raw certificate private key,
- OTP.

Boleh log dengan hati-hati:

- authentication success/failure,
- principal subject,
- identity provider,
- client id,
- request id,
- correlation id,
- reason category,
- source IP after trusted proxy resolution,
- user agent if needed,
- failure class.

Contoh audit event:

```json
{
  "eventType": "AUTHENTICATION_SUCCESS",
  "actorSubject": "idp|user-123",
  "mechanism": "OIDC",
  "identityProvider": "corp-idp",
  "clientId": "case-management-app",
  "requestId": "req-abc",
  "timestamp": "2026-06-17T09:15:20Z"
}
```

Contoh failure:

```json
{
  "eventType": "AUTHENTICATION_FAILURE",
  "mechanism": "FORM",
  "reasonCategory": "INVALID_CREDENTIAL",
  "usernameHash": "sha256:...",
  "requestId": "req-def",
  "timestamp": "2026-06-17T09:17:11Z"
}
```

Jangan audit password salahnya apa. Jangan audit token mentah.

---

## 28. Testing Jakarta Security API

Security harus dites pada beberapa layer.

### 28.1 Unit Test Identity Store

Test:

- valid credential,
- wrong password,
- unknown user,
- disabled user,
- locked user,
- expired password,
- group mapping,
- backend unavailable.

Contoh:

```java
@Test
void validUserReturnsPrincipalAndGroups() {
    UsernamePasswordCredential credential = new UsernamePasswordCredential(
            "alice",
            new Password("correct-password")
    );

    CredentialValidationResult result = identityStore.validate(credential);

    assertEquals(CredentialValidationResult.Status.VALID, result.getStatus());
    assertEquals("alice", result.getCallerPrincipal().getName());
    assertTrue(result.getCallerGroups().contains("CASE_VIEWER"));
}
```

### 28.2 Unit Test Authentication Mechanism

Test:

- no auth header on public resource,
- no auth header on protected resource,
- malformed header,
- invalid token,
- valid token,
- response header challenge,
- status code.

### 28.3 Integration Test Container

Test di runtime target:

- actual login flow,
- `SecurityContext.getCallerPrincipal()`,
- `request.getUserPrincipal()`,
- `@RolesAllowed`,
- JAX-RS security,
- session persistence,
- logout,
- redirect behavior.

### 28.4 Negative Test

Negative tests wajib:

- unauthenticated user cannot access protected URL,
- user without role gets 403,
- invalid token rejected,
- expired token rejected,
- wrong audience rejected,
- disabled user cannot login,
- stale session invalidated after logout,
- role change handled according to policy.

Security yang hanya dites happy path biasanya rapuh.

---

## 29. Debugging Checklist

Jika Jakarta Security tidak bekerja, cek berurutan.

### 29.1 Mechanism Tidak Dipanggil

Cek:

- Apakah class mechanism CDI bean?
- Apakah bean archive terdeteksi?
- Apakah annotation mechanism definition ada di tempat yang diproses container?
- Apakah dependency API cocok dengan container?
- Apakah package `javax`/`jakarta` cocok?
- Apakah container mendukung Jakarta Security version tersebut?
- Apakah ada mechanism lain yang override?

### 29.2 Identity Store Tidak Dipanggil

Cek:

- Apakah identity store CDI bean?
- Apakah credential type cocok dengan `validate(...)` method?
- Apakah validation type benar?
- Apakah priority/order store menyebabkan store lain menang?
- Apakah identity store throw exception sebelum return result?
- Apakah datasource/JNDI tersedia?

### 29.3 Login Sukses Tapi Role Check Gagal

Cek:

- Apakah groups dikembalikan dalam `CredentialValidationResult`?
- Apakah nama group sama persis dengan role yang dicek?
- Apakah ada role mapping container?
- Apakah `@DeclareRoles`/deployment descriptor dibutuhkan?
- Apakah case-sensitive mismatch?
- Apakah prefix role berbeda, misalnya `ROLE_ADMIN` vs `ADMIN`?
- Apakah method security aktif?

### 29.4 Principal Null

Cek:

- Apakah resource benar-benar protected?
- Apakah mechanism return success?
- Apakah `notifyContainerAboutLogin` dipanggil?
- Apakah custom filter hanya set session attribute?
- Apakah request berada di thread async tanpa context?
- Apakah dipanggil dari background job?

### 29.5 Redirect Loop

Cek:

- Login page ikut diprotect?
- Callback OIDC ikut diprotect salah?
- Error page ikut diprotect?
- Session cookie tidak tersimpan?
- SameSite/CORS/cookie domain salah?
- Reverse proxy mengubah scheme host sehingga redirect URI mismatch?

---

## 30. Security Invariants untuk Jakarta Security API

Gunakan invariant berikut saat mendesain/review:

### Invariant 1 — Authentication Harus Establish Container Identity

```text
Jika aplikasi menganggap user login, container juga harus melihat caller principal.
```

Validasi:

```java
securityContext.getCallerPrincipal() != null
request.getUserPrincipal() != null
```

### Invariant 2 — Credential Tidak Boleh Menjadi Domain Permission

```text
Credential proves identity; authorization decides access.
```

### Invariant 3 — Principal Harus Stabil

```text
Principal name should not change casually.
```

Gunakan immutable subject/internal id.

### Invariant 4 — Group/Role Mapping Harus Eksplisit

```text
External group -> application role mapping is a contract, not an accident.
```

### Invariant 5 — Public Resource Harus Benar-Benar Public

```text
If resource can affect state, do not rely on accidental public access.
```

### Invariant 6 — Authentication Failure Tidak Boleh Jadi Authorization Bypass

```text
When auth backend fails, fail closed for protected resources.
```

### Invariant 7 — Security Context Tidak Boleh Bocor Antar Thread/User

```text
Context propagation must be explicit and tested.
```

### Invariant 8 — Logout Harus Menghapus State yang Relevan

```text
Local session, remember-me, token relation, and IdP session each have different logout semantics.
```

### Invariant 9 — Audit Harus Bisa Menjawab Siapa Melakukan Apa

```text
Authentication establishes actor; authorization and business action must record actor.
```

### Invariant 10 — Role Check Bukan Substitute Domain Authorization

```text
@RolesAllowed is necessary but often insufficient.
```

---

## 31. Design Example: Enterprise Case Management Login

Bayangkan aplikasi case management enterprise:

- officer login via OIDC enterprise IdP,
- admin login via internal form sebagai break-glass,
- REST API menerima bearer token dari internal service,
- domain authorization berdasarkan agency, assignment, state, dan role.

Desain Jakarta Security:

```text
Mechanism A: OIDC login for browser users
Mechanism B: Basic/Form break-glass admin on restricted path
Mechanism C: Bearer token for API clients

IdentityStore A: maps OIDC subject to internal user
IdentityStore B: validates break-glass admin credential
IdentityStore C: validates service token / introspection

SecurityContext:
    used by CurrentActorProvider

CurrentActorProvider:
    converts principal + groups into Actor snapshot

AuthorizationService:
    checks case-level permissions

AuditService:
    records authentication, authorization denial, and domain action
```

Request flow for approve case:

```text
1. Browser has session established via OIDC.
2. Container restores principal = idp|user-123.
3. @RolesAllowed("CASE_APPROVER") checks coarse role.
4. CurrentActorProvider loads actor snapshot.
5. AuthorizationService checks:
   - same agency?
   - assigned approver?
   - case state = PENDING_APPROVAL?
   - not maker of same case?
   - no conflict of interest?
6. Domain performs approve.
7. Audit records actor, decision, case id, previous state, new state.
```

This is the correct layering:

```text
Jakarta Security establishes identity.
Container enforces coarse role.
Domain service enforces business permission.
Audit records accountability.
```

---

## 32. Anti-Patterns

### 32.1 Session Attribute Login

```java
session.setAttribute("user", user);
```

Without notifying container, this is not Jakarta authentication.

### 32.2 Role Hardcoded from IdP Group Everywhere

```java
if (groups.contains("CN=SG-GOV-APP-ACEAS-PROD-APPROVER,OU=Groups,..."))
```

This leaks IdP structure into business code.

### 32.3 Token Parsed in Every Resource Method

```java
String token = request.getHeader("Authorization");
Claims claims = jwt.parse(token);
```

Repeated parsing across endpoints creates inconsistent validation and bypass risk.

### 32.4 Fat Principal

Principal contains profile, roles, permissions, tokens, and domain state. This becomes stale and dangerous.

### 32.5 Authentication Mechanism Does Business Authorization

Login rejects user because user cannot approve a particular case. That mixes lifecycle.

### 32.6 All Failures Become 500

Invalid password, insufficient role, token expired, IdP down, and database down need different handling.

### 32.7 Only UI Authorization

Menu hidden but endpoint still accessible.

### 32.8 Trusting Identity Header Without Boundary

```java
String user = request.getHeader("X-Authenticated-User");
```

This is safe only if infrastructure guarantees client cannot send/override that header.

---

## 33. Checklist: When Building Jakarta Security API Integration

### 33.1 Authentication Design

- [ ] What mechanisms are used?
- [ ] Which paths use which mechanism?
- [ ] What is the challenge behavior?
- [ ] What is the login callback path?
- [ ] Are login/error/callback assets accessible?
- [ ] Is there step-up authentication?
- [ ] Is there break-glass admin?

### 33.2 Identity Design

- [ ] What is stable principal name?
- [ ] Where does user profile live?
- [ ] How are external identities linked?
- [ ] How are disabled/locked users handled?
- [ ] How is account rename handled?
- [ ] How is duplicate identity prevented?

### 33.3 Group/Role Design

- [ ] What groups does identity store return?
- [ ] Are group names stable?
- [ ] Are external groups mapped to app roles?
- [ ] Is role prefix consistent?
- [ ] Are role changes reflected mid-session or next login?

### 33.4 Session/Token Design

- [ ] Is session fixation handled?
- [ ] What is idle timeout?
- [ ] What is absolute timeout?
- [ ] What happens on logout?
- [ ] Are token and session lifetimes aligned?
- [ ] Are cookies secure?

### 33.5 Authorization Design

- [ ] Which checks are declarative?
- [ ] Which checks are domain-specific?
- [ ] Is default deny applied?
- [ ] Are tenant boundaries checked server-side?
- [ ] Are state-machine transitions authorized?

### 33.6 Observability

- [ ] Are auth success/failure audited?
- [ ] Are denials audited?
- [ ] Are request/correlation IDs included?
- [ ] Are secrets redacted?
- [ ] Can support team distinguish 401/403/500/IdP outage?

### 33.7 Testing

- [ ] Unit test identity store.
- [ ] Unit test custom mechanism.
- [ ] Integration test on target container.
- [ ] Negative test protected resources.
- [ ] Test role mismatch.
- [ ] Test logout.
- [ ] Test expired token/session.
- [ ] Test proxy/callback URL in real environment.

---

## 34. Decision Framework: Which Jakarta Security API Should I Use?

### Use built-in form/basic if:

- simple server-side web app,
- username/password stored internally,
- no SSO requirement,
- container-supported behavior enough.

### Use custom `IdentityStore` if:

- user data in custom database,
- password hash/migration custom,
- group loading custom,
- user status/lockout rules custom,
- tenant-aware identity mapping.

### Use custom `HttpAuthenticationMechanism` if:

- credential source custom,
- bearer token support custom,
- gateway identity mapping needed,
- login flow custom beyond built-in definitions,
- multi-step auth flow.

### Use OIDC built-in mechanism if:

- external IdP supports standard OIDC,
- container implementation mature enough,
- configuration fits requirements,
- logout/session behavior acceptable.

### Use Jakarta Authentication directly if:

- you need lower-level container SPI,
- message authentication beyond Jakarta Security abstraction,
- cross-application mechanism,
- vendor/container integration requires it.

### Use Spring Security instead if:

- application is Spring Boot-centric,
- needs rich OAuth2 resource server/client support,
- uses Spring authorization model,
- deployment is not Jakarta EE container-oriented.

But do not choose based on fashion. Choose based on enforcement boundary.

---

## 35. Mini Reference Map

```text
jakarta.security.enterprise.SecurityContext
    Application-facing security context.

jakarta.security.enterprise.CallerPrincipal
    Principal implementation for caller identity.

jakarta.security.enterprise.credential.Credential
    Marker/contract for credential types.

jakarta.security.enterprise.credential.UsernamePasswordCredential
    Username/password credential.

jakarta.security.enterprise.credential.Password
    Password wrapper.

jakarta.security.enterprise.identitystore.IdentityStore
    Validates credential and/or provides groups.

jakarta.security.enterprise.identitystore.CredentialValidationResult
    Result of credential validation.

jakarta.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism
    HTTP authentication mechanism.

jakarta.security.enterprise.authentication.mechanism.http.HttpMessageContext
    Context helper for notifying container, sending response, checking protected status.

jakarta.security.enterprise.AuthenticationStatus
    Result status from authentication mechanism.
```

---

## 36. Practical Mental Model Summary

At top 1% level, jangan melihat Jakarta Security sebagai kumpulan annotation. Lihat sebagai kontrak untuk menghubungkan empat dunia:

```text
HTTP world
    request, response, header, cookie, redirect, TLS

Identity world
    credential, principal, subject, group, IdP, account

Container world
    session, security context, role check, method security, policy

Domain world
    tenant, case, workflow state, assignment, approval, audit
```

Jakarta Security terutama menghubungkan HTTP world, identity world, dan container world.

Domain world tetap harus didesain eksplisit.

Jika diringkas:

```text
HttpAuthenticationMechanism obtains proof.
IdentityStore validates proof.
CredentialValidationResult establishes caller identity and groups.
Container stores/exposes caller.
SecurityContext lets application query caller.
Declarative security gates coarse access.
Domain authorization decides business permission.
Audit records accountability.
```

Itulah inti Jakarta Security API Core.

---

## 37. What You Should Be Able to Explain After This Part

Setelah bagian ini, kamu harus bisa menjelaskan:

1. Kenapa `session.setAttribute("user", user)` bukan authentication container.
2. Perbedaan `SecurityContext`, `HttpAuthenticationMechanism`, dan `IdentityStore`.
3. Apa yang dibawa `CredentialValidationResult`.
4. Kenapa principal harus minimal dan stabil.
5. Kenapa groups bukan permission final.
6. Kenapa role check tidak cukup untuk domain authorization.
7. Bagaimana authentication mechanism berinteraksi dengan identity store.
8. Bagaimana container mengetahui caller setelah login.
9. Apa portability trap antar container.
10. Kapan memakai Jakarta Security, Jakarta Authentication, atau Spring Security.
11. Bagaimana mendesain current actor abstraction.
12. Bagaimana debug login sukses tapi `@RolesAllowed` gagal.

---

## 38. References

- Jakarta Security 4.0 Specification: https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0
- Jakarta Security 4.0 API Docs — `SecurityContext`: https://jakarta.ee/specifications/security/4.0/apidocs/jakarta.security/jakarta/security/enterprise/securitycontext
- Jakarta Security 4.0 API Docs — `HttpAuthenticationMechanism`: https://jakarta.ee/specifications/security/4.0/apidocs/jakarta.security/jakarta/security/enterprise/authentication/mechanism/http/httpauthenticationmechanism
- Jakarta Security 4.0 Release Page: https://jakarta.ee/specifications/security/4.0/
- Jakarta EE Tutorial — Introduction to Security: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security-intro/security-intro.html
- Jakarta Authentication 3.1 Specification: https://jakarta.ee/specifications/authentication/3.1/
- Jakarta Authorization 3.0 Specification: https://jakarta.ee/specifications/authorization/3.0/

---

# Status Seri

Selesai:

1. Part 00 — Orientation: Enterprise Java Security Mental Model
2. Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
3. Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
4. Part 03 — Container Security Architecture
5. Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
6. Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Cert, OIDC
7. Part 06 — Jakarta Security API Core

Belum selesai. Berikutnya:

```text
Part 07 — SecurityContext Deep Dive
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Certificate, OIDC](./learn-java-jakarta-security-authentication-authorization-identity-part-05-authentication-mechanisms.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 07 — SecurityContext Deep Dive](./learn-java-jakarta-security-authentication-authorization-identity-part-07-securitycontext-deep-dive.md)

</div>