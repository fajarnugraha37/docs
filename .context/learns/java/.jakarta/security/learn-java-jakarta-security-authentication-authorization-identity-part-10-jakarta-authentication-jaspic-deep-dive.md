# Part 10 — Jakarta Authentication / JASPIC Deep Dive

**Series:** `learn-java-jakarta-security-authentication-authorization-identity`  
**File:** `learn-java-jakarta-security-authentication-authorization-identity-part-10-jakarta-authentication-jaspic-deep-dive.md`  
**Scope:** Java 8–25, Java EE/Jakarta EE, Servlet container authentication SPI, JASPIC/Jakarta Authentication, integration with Jakarta Security and Jakarta Authorization.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. mental model enterprise Java security,
2. vocabulary identity/principal/subject/role/permission,
3. sejarah JAAS/JACC/JASPIC/Jakarta Security,
4. container security architecture,
5. Servlet security foundation,
6. authentication mechanisms,
7. Jakarta Security API core,
8. `SecurityContext`,
9. `IdentityStore` dan credential handling.

Sekarang kita masuk ke layer yang lebih rendah: **Jakarta Authentication**, dulu dikenal sebagai **JASPIC** atau **Java Authentication SPI for Containers**.

Di banyak aplikasi modern, developer cukup memakai:

```java
@BasicAuthenticationMechanismDefinition
@FormAuthenticationMechanismDefinition
@OpenIdAuthenticationMechanismDefinition
@DatabaseIdentityStoreDefinition
@Inject SecurityContext securityContext;
```

Namun dalam sistem enterprise yang kompleks, kadang kita perlu masuk ke level yang lebih dekat dengan container:

- login tidak mengikuti mekanisme umum,
- identity datang dari reverse proxy / gateway / SSO appliance,
- perlu integrasi proprietary dengan IAM lama,
- perlu custom protocol,
- perlu mengubah request/response pada fase authentication,
- perlu memberi tahu container tentang principal dan group secara eksplisit,
- perlu membuat authentication module yang portable antar container yang mendukung Jakarta Authentication,
- perlu memahami kenapa `getUserPrincipal()` ada tetapi `@RolesAllowed` tidak bekerja,
- perlu debugging kasus authentication sukses tetapi authorization gagal.

Part ini menjawab: **bagaimana authentication module berbicara langsung dengan container?**

---

## 1. Core Mental Model

Jakarta Authentication adalah **SPI**, bukan API high-level.

Artinya, ia bukan terutama dibuat agar business developer menulis login form sehari-hari. Ia dibuat agar **authentication mechanism provider** dapat memasang mekanisme autentikasi ke container secara standar.

Mental model sederhananya:

```text
Caller / Client
    |
    | HTTP request / message
    v
Servlet Container
    |
    | delegates authentication to
    v
ServerAuthModule
    |
    | validates credential / token / certificate / header / protocol
    v
CallbackHandler
    |
    | informs container about caller principal and groups
    v
Container Security Context
    |
    | available through Servlet / Jakarta Security / JAX-RS / EJB / CDI
    v
Application Code
```

Yang paling penting:

> Jakarta Authentication bukan hanya memvalidasi credential. Ia harus **menghubungkan hasil validasi ke container identity model**.

Kalau hanya melakukan validasi sendiri lalu menaruh user ke request attribute, aplikasi mungkin tahu usernya, tetapi container tidak tahu. Akibatnya:

- `request.getUserPrincipal()` bisa null,
- `request.isUserInRole("ADMIN")` gagal,
- `@RolesAllowed` tidak bekerja,
- security constraint di `web.xml` tidak enforcement dengan benar,
- audit container tidak punya caller identity,
- downstream container service tidak menerima identity.

---

## 2. Apa Itu Jakarta Authentication?

Jakarta Authentication mendefinisikan low-level SPI untuk authentication mechanisms yang berinteraksi dengan:

1. caller,
2. request/response message,
3. container environment,
4. callback handler,
5. subject/principal/group model.

Dalam konteks web container, profil yang paling relevan adalah **Servlet Container Profile**.

Tujuannya:

```text
Obtain credentials → validate credentials → establish caller identity → pass principal/groups to container
```

Bukan hanya:

```text
Check username/password → return true
```

Perbedaan ini besar. Authentication dalam container-managed system harus menghasilkan **container-recognized identity**.

---

## 3. Jakarta Security vs Jakarta Authentication

Keduanya sering membingungkan.

### 3.1 Jakarta Security

Jakarta Security adalah API yang lebih nyaman untuk application developer.

Biasanya kita memakai:

```java
@ApplicationScoped
public class CustomAuthenticationMechanism implements HttpAuthenticationMechanism {
    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) {
        // read credentials
        // call identity store
        // notify container via context.notifyContainerAboutLogin(...)
    }
}
```

Atau memakai built-in mechanism:

```java
@BasicAuthenticationMechanismDefinition
@DatabaseIdentityStoreDefinition(...)
```

Jakarta Security cocok untuk:

- HTTP authentication modern,
- CDI-based implementation,
- IdentityStore integration,
- application-level portability,
- business app authentication customization.

### 3.2 Jakarta Authentication

Jakarta Authentication lebih rendah.

Biasanya kita membuat:

```java
public class MyServerAuthModule implements ServerAuthModule {
    @Override
    public AuthStatus validateRequest(
            MessageInfo messageInfo,
            Subject clientSubject,
            Subject serviceSubject) throws AuthException {
        // inspect message
        // validate credential
        // invoke CallerPrincipalCallback / GroupPrincipalCallback
        return AuthStatus.SUCCESS;
    }
}
```

Jakarta Authentication cocok untuk:

- container-integrated pluggable authentication,
- vendor/framework integration,
- SSO module,
- custom gateway identity bridge,
- protocol adapter,
- security product integration,
- low-level request/response authentication handling.

### 3.3 Rule of Thumb

Gunakan Jakarta Security bila:

```text
Saya sedang membangun aplikasi Jakarta dan butuh authentication mechanism custom berbasis HTTP/CDI/IdentityStore.
```

Gunakan Jakarta Authentication bila:

```text
Saya sedang membangun module authentication yang harus berbicara langsung dengan container SPI dan menetapkan principal/groups ke runtime container.
```

Atau:

```text
Saya perlu memahami kenapa integration layer container security tidak behave seperti yang saya harapkan.
```

---

## 4. Komponen Utama Jakarta Authentication

Komponen yang perlu dipahami:

1. `ServerAuthModule`
2. `ServerAuthContext`
3. `ServerAuthConfig`
4. `AuthConfigProvider`
5. `AuthConfigFactory`
6. `MessageInfo`
7. `Subject`
8. `CallbackHandler`
9. `CallerPrincipalCallback`
10. `GroupPrincipalCallback`
11. `PasswordValidationCallback`
12. `PrivateKeyCallback`, `TrustStoreCallback`, dan callback lain
13. `AuthStatus`
14. `AuthException`

Layer relasinya:

```text
AuthConfigFactory
    |
    v
AuthConfigProvider
    |
    v
ServerAuthConfig
    |
    v
ServerAuthContext
    |
    v
ServerAuthModule
```

Untuk memahami ini, jangan mulai dari class. Mulailah dari pertanyaan:

> Siapa yang memilih authentication module untuk request tertentu?

Jawabannya bukan business code, tetapi container melalui konfigurasi authentication.

---

## 5. `ServerAuthModule`

`ServerAuthModule` adalah komponen authentication utama.

Ia bertanggung jawab untuk:

1. memvalidasi request dari client,
2. menetapkan caller identity ke container,
3. mengamankan response bila diperlukan,
4. membersihkan subject setelah request selesai.

Method penting:

```java
public interface ServerAuthModule {
    void initialize(
            MessagePolicy requestPolicy,
            MessagePolicy responsePolicy,
            CallbackHandler handler,
            Map options) throws AuthException;

    Class[] getSupportedMessageTypes();

    AuthStatus validateRequest(
            MessageInfo messageInfo,
            Subject clientSubject,
            Subject serviceSubject) throws AuthException;

    AuthStatus secureResponse(
            MessageInfo messageInfo,
            Subject serviceSubject) throws AuthException;

    void cleanSubject(
            MessageInfo messageInfo,
            Subject subject) throws AuthException;
}
```

Nama method-nya memberi alur:

```text
initialize → validateRequest → secureResponse → cleanSubject
```

---

## 6. `initialize(...)`

`initialize` dipanggil container untuk menyiapkan module.

Parameter utama:

```java
void initialize(
    MessagePolicy requestPolicy,
    MessagePolicy responsePolicy,
    CallbackHandler handler,
    Map options
)
```

### 6.1 `requestPolicy`

Menjelaskan policy yang harus dipenuhi untuk request.

Contoh konseptual:

- apakah request perlu authenticated,
- apakah message perlu integrity/confidentiality,
- apakah credential mandatory.

Dalam praktik web authentication, banyak module fokus pada validasi credential dan jarang memanipulasi message policy secara kompleks.

### 6.2 `responsePolicy`

Menjelaskan security policy untuk response.

Contoh:

- apakah response harus diamankan,
- apakah perlu challenge,
- apakah response perlu diubah.

Dalam HTTP, response bisa berupa:

- 401 challenge,
- redirect ke login page,
- set-cookie,
- error response,
- response biasa setelah auth sukses.

### 6.3 `CallbackHandler`

Ini komponen sangat penting.

`CallbackHandler` adalah channel resmi untuk module memberi tahu container:

- siapa caller principal,
- caller punya group apa,
- password validation request,
- certificate/key/trust material,
- secret callback.

Tanpa callback yang benar, module mungkin validasi credential sukses tetapi container tidak mengenali identity.

### 6.4 `options`

Berisi konfigurasi module.

Contoh:

```text
issuer=https://idp.example.com
jwksUrl=https://idp.example.com/.well-known/jwks.json
audience=my-api
realmName=enterprise
trustedHeader=X-Authenticated-User
```

Hal penting:

- treat options as configuration, not mutable request state,
- avoid storing secrets in plain deployment config,
- validate options during initialize,
- fail fast for mandatory options.

### 6.5 Thread Safety

`ServerAuthModule` dapat dipakai oleh banyak request secara concurrent. Karena itu:

```text
Do not store per-request state in instance fields.
```

Buruk:

```java
public class BadModule implements ServerAuthModule {
    private String currentUser; // BUG: shared across requests
}
```

Lebih aman:

```java
public class GoodModule implements ServerAuthModule {
    private String issuer; // immutable config after initialize

    @Override
    public AuthStatus validateRequest(MessageInfo info, Subject client, Subject service) {
        String currentUser = extractUser(info); // local variable
        // ...
    }
}
```

Invariant:

```text
Instance fields may hold immutable configuration or thread-safe shared dependencies, not request-specific identity.
```

---

## 7. `getSupportedMessageTypes()`

Method ini memberi tahu container jenis message yang didukung module.

Untuk Servlet profile, biasanya message type adalah:

```java
HttpServletRequest.class
HttpServletResponse.class
```

Contoh:

```java
@Override
public Class[] getSupportedMessageTypes() {
    return new Class[] {
        HttpServletRequest.class,
        HttpServletResponse.class
    };
}
```

Mental model:

```text
Jakarta Authentication bukan hanya HTTP secara teori.
Ia adalah SPI message authentication.
Servlet profile memetakan message ke HttpServletRequest/HttpServletResponse.
```

---

## 8. `MessageInfo`

`MessageInfo` membawa request/response message dan metadata tambahan.

Pada Servlet profile, kita biasanya mengambil:

```java
HttpServletRequest request =
    (HttpServletRequest) messageInfo.getRequestMessage();

HttpServletResponse response =
    (HttpServletResponse) messageInfo.getResponseMessage();
```

`MessageInfo` juga memiliki map:

```java
Map<String, Object> map = messageInfo.getMap();
```

Map ini dapat digunakan untuk metadata authentication, misalnya:

- apakah auth mandatory,
- custom flags,
- message processing state,
- container-specific hints.

Namun hati-hati:

```text
Do not rely on non-portable map keys unless you intentionally target a specific container.
```

---

## 9. `validateRequest(...)`

Ini method utama.

```java
AuthStatus validateRequest(
    MessageInfo messageInfo,
    Subject clientSubject,
    Subject serviceSubject
) throws AuthException;
```

Tujuannya:

1. inspect request,
2. determine whether authentication is required,
3. extract credential,
4. validate credential,
5. establish caller identity via callback,
6. return status to container.

Alur umum:

```text
Request comes in
    |
    v
Is protected resource?
    |
    +-- no credential and auth not mandatory → return SUCCESS or NOT_DONE depending profile/container contract
    |
    +-- no credential and auth mandatory → send challenge → SEND_CONTINUE
    |
    +-- credential present → validate credential
            |
            +-- valid → set principal/groups → SUCCESS
            +-- invalid → send failure/challenge → SEND_FAILURE or SEND_CONTINUE
```

Contoh skeleton:

```java
public class HeaderServerAuthModule implements ServerAuthModule {

    private CallbackHandler handler;

    @Override
    public void initialize(
            MessagePolicy requestPolicy,
            MessagePolicy responsePolicy,
            CallbackHandler handler,
            Map options) {
        this.handler = handler;
    }

    @Override
    public Class[] getSupportedMessageTypes() {
        return new Class[] { HttpServletRequest.class, HttpServletResponse.class };
    }

    @Override
    public AuthStatus validateRequest(
            MessageInfo messageInfo,
            Subject clientSubject,
            Subject serviceSubject) throws AuthException {

        HttpServletRequest request =
                (HttpServletRequest) messageInfo.getRequestMessage();
        HttpServletResponse response =
                (HttpServletResponse) messageInfo.getResponseMessage();

        String user = request.getHeader("X-Authenticated-User");

        if (user == null || user.isBlank()) {
            try {
                response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
                return AuthStatus.SEND_FAILURE;
            } catch (IOException e) {
                throw (AuthException) new AuthException("Unable to send error").initCause(e);
            }
        }

        Principal principal = () -> user;
        String[] groups = resolveGroups(user);

        try {
            handler.handle(new Callback[] {
                    new CallerPrincipalCallback(clientSubject, principal),
                    new GroupPrincipalCallback(clientSubject, groups)
            });
        } catch (IOException | UnsupportedCallbackException e) {
            throw (AuthException) new AuthException("Callback failed").initCause(e);
        }

        return AuthStatus.SUCCESS;
    }

    @Override
    public AuthStatus secureResponse(MessageInfo messageInfo, Subject serviceSubject) {
        return AuthStatus.SEND_SUCCESS;
    }

    @Override
    public void cleanSubject(MessageInfo messageInfo, Subject subject) {
        subject.getPrincipals().clear();
    }

    private String[] resolveGroups(String user) {
        return new String[] { "USER" };
    }
}
```

Catatan penting:

> Contoh trusted header di atas hanya aman bila header tersebut berasal dari reverse proxy/gateway yang benar-benar trusted dan aplikasi memblokir direct access dari client.

Kalau client bisa mengirim `X-Authenticated-User` langsung, itu authentication bypass.

---

## 10. `AuthStatus`

`validateRequest` dan `secureResponse` mengembalikan `AuthStatus`.

Status yang paling sering dipikirkan:

| Status | Makna Konseptual |
|---|---|
| `SUCCESS` | Request berhasil diautentikasi atau boleh lanjut sesuai contract |
| `SEND_SUCCESS` | Response security processing sukses |
| `SEND_CONTINUE` | Module sudah mengirim challenge/redirect dan request processing belum lanjut ke resource |
| `SEND_FAILURE` | Authentication gagal dan module sudah/akan menghasilkan failure response |
| `FAILURE` | Processing gagal |

Mental model:

```text
SUCCESS       → container may continue to application
SEND_CONTINUE → authentication conversation continues, app resource not invoked
SEND_FAILURE  → authentication failed, app resource not invoked
```

Untuk HTTP:

- Basic challenge biasanya `SEND_CONTINUE` dengan status 401 + `WWW-Authenticate`,
- Form login redirect biasanya `SEND_CONTINUE` dengan status 302,
- Invalid credential bisa `SEND_FAILURE` atau challenge ulang tergantung mechanism,
- Valid token biasanya `SUCCESS`.

---

## 11. `CallerPrincipalCallback`

`CallerPrincipalCallback` digunakan module untuk memberi tahu container siapa caller-nya.

Contoh:

```java
Principal principal = new Principal() {
    @Override
    public String getName() {
        return "alice";
    }
};

handler.handle(new Callback[] {
    new CallerPrincipalCallback(clientSubject, principal)
});
```

Atau memakai nama:

```java
new CallerPrincipalCallback(clientSubject, "alice")
```

Makna:

```text
Module says to container: the authenticated caller is alice.
```

Setelah sukses, container bisa membuat identity internal sehingga application code dapat melihat:

```java
request.getUserPrincipal().getName();
securityContext.getCallerPrincipal().getName();
```

Tapi ini bergantung pada container integration.

---

## 12. `GroupPrincipalCallback`

`GroupPrincipalCallback` digunakan untuk memberi tahu container group caller.

```java
String[] groups = { "OFFICER", "CASE_REVIEWER" };

handler.handle(new Callback[] {
    new GroupPrincipalCallback(clientSubject, groups)
});
```

Mental model:

```text
GroupPrincipalCallback does not necessarily mean final application permission.
It informs the container of group membership that may be mapped to roles.
```

Dalam banyak container, group dari authentication akan dipakai untuk `isUserInRole` atau role mapping, tetapi detailnya bisa bergantung konfigurasi server.

Jangan campur:

```text
IdP group       = source attribute
Container group = authenticated group known by container
Application role = role declared/used by app
Domain permission = final business decision
```

---

## 13. `PasswordValidationCallback`

`PasswordValidationCallback` memungkinkan module meminta container memvalidasi username/password terhadap realm/container identity store.

Contoh konseptual:

```java
PasswordValidationCallback callback =
        new PasswordValidationCallback(clientSubject, username, passwordChars);

handler.handle(new Callback[] { callback });

if (callback.getResult()) {
    return AuthStatus.SUCCESS;
}
```

Ini berguna bila:

- module mengambil credential dari protocol custom,
- validasi tetap ingin didelegasikan ke container realm,
- tidak ingin module memegang password hashing sendiri.

Namun dalam Jakarta Security modern, untuk app-level username/password biasanya lebih natural memakai `IdentityStore` + `PasswordHash`.

---

## 14. `ServerAuthContext`

`ServerAuthContext` merepresentasikan context authentication untuk server side.

Ia biasanya mengelola satu atau lebih `ServerAuthModule`.

Mental model:

```text
ServerAuthContext is the runtime wrapper that the container invokes.
ServerAuthModule is the actual pluggable authentication logic.
```

Dalam banyak implementasi, developer membuat `ServerAuthModule`, sedangkan `ServerAuthContext` disediakan oleh framework/container/provider.

Tapi bila membuat provider lengkap, kita perlu memahami chain:

```text
ServerAuthConfig.getAuthContext(...) → ServerAuthContext → ServerAuthModule.validateRequest(...)
```

---

## 15. `ServerAuthConfig`

`ServerAuthConfig` menyediakan `ServerAuthContext` untuk layer tertentu.

Pertanyaan yang dijawab oleh `ServerAuthConfig`:

```text
Untuk app/context/layer ini, auth context apa yang harus dipakai?
```

Ia bisa memilih module berdasarkan:

- message layer,
- application context,
- operation,
- policy,
- container configuration,
- vendor-specific options.

---

## 16. `AuthConfigProvider`

`AuthConfigProvider` adalah provider konfigurasi authentication.

Ia menghasilkan `ServerAuthConfig`.

Mental model:

```text
AuthConfigProvider tells the container how to obtain authentication configuration.
```

Provider dapat diregistrasikan:

- statically,
- dynamically,
- through container-specific config,
- through deployment descriptor / service registration depending implementation.

Karena registrasi sangat container-specific, production implementation harus membaca dokumentasi container:

- Payara / GlassFish,
- WildFly / JBoss EAP,
- Open Liberty,
- Tomcat,
- Jetty,
- WebLogic,
- TomEE.

Portability API ada, tetapi operational registration sering berbeda.

---

## 17. `AuthConfigFactory`

`AuthConfigFactory` adalah registry untuk `AuthConfigProvider`.

Mental model:

```text
Container asks AuthConfigFactory: for this layer/appContext, which AuthConfigProvider should I use?
```

Ini layer konfigurasi, bukan business logic.

Bila debugging module tidak terpanggil, pertanyaan pertama:

```text
Apakah AuthConfigProvider saya sebenarnya registered untuk message layer dan app context yang benar?
```

Bukan langsung:

```text
Apakah validateRequest saya salah?
```

---

## 18. Subject Dalam Jakarta Authentication

`validateRequest` menerima:

```java
Subject clientSubject
Subject serviceSubject
```

### 18.1 `clientSubject`

Mewakili caller/client.

Authentication module biasanya mengisi identity caller ke `clientSubject` melalui callback.

### 18.2 `serviceSubject`

Mewakili service/server side identity.

Lebih relevan untuk skenario message-level security tertentu, misalnya ketika service juga memiliki credential atau key.

Dalam HTTP authentication umum, fokus terbesar biasanya `clientSubject`.

### 18.3 Jangan Menganggap Subject Sama Dengan Domain User

`Subject` adalah security container concept.

Domain user/account sebaiknya model terpisah:

```java
record Actor(
    String subjectId,
    String displayName,
    Set<String> roles,
    Set<String> permissions,
    String activeTenant
) {}
```

Mapping:

```text
Subject/principal/groups → application actor → authorization policy
```

Jangan langsung menyebarkan `Subject` ke domain service.

---

## 19. Authentication Mandatory vs Optional

Salah satu kesulitan SPI adalah membedakan:

1. request ke resource publik,
2. request ke protected resource,
3. request dengan credential opsional,
4. request dengan credential invalid,
5. request tanpa credential tetapi auth mandatory.

Contoh:

```text
GET /public/news       → anonymous allowed
GET /profile           → auth required
GET /api/search        → anonymous or authenticated both allowed
GET /api/admin/users   → auth required + admin role
```

Dalam authentication module, keputusan auth mandatory bisa berasal dari:

- security constraint,
- container policy,
- messageInfo map,
- application config,
- path matching,
- vendor-specific signal.

Pitfall:

```text
Returning failure for every request without credential can break public resources.
```

Jadi module harus memahami contract container.

---

## 20. Challenge Semantics

Authentication mechanism tidak hanya validasi. Ia juga bisa membuat challenge.

Contoh Basic:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="my-realm"
```

Contoh Bearer:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api", error="invalid_token"
```

Contoh form/OIDC:

```http
HTTP/1.1 302 Found
Location: /login
```

atau:

```http
HTTP/1.1 302 Found
Location: https://idp.example.com/authorize?client_id=...
```

Rule:

```text
401 means caller is not authenticated or credential is invalid/missing.
403 means caller is authenticated but not authorized.
```

Authentication module harus berhati-hati agar tidak mengembalikan 403 untuk kondisi belum login.

---

## 21. `secureResponse(...)`

`secureResponse` dipanggil untuk mengamankan response.

```java
AuthStatus secureResponse(
    MessageInfo messageInfo,
    Subject serviceSubject
) throws AuthException;
```

Dalam banyak HTTP auth sederhana, method ini hanya:

```java
return AuthStatus.SEND_SUCCESS;
```

Tapi ada use case lebih kompleks:

- menambahkan authentication response header,
- melakukan message signing,
- menambahkan token/cookie,
- finalizing protocol handshake,
- wrapping/encrypting response.

Dalam aplikasi modern, sebagian besar mekanisme session/token mengatur response di `validateRequest` saat challenge atau login success. Namun secara SPI, `secureResponse` tetap bagian dari lifecycle.

---

## 22. `cleanSubject(...)`

`cleanSubject` membersihkan subject.

```java
void cleanSubject(MessageInfo messageInfo, Subject subject) throws AuthException;
```

Tujuannya:

- menghapus principal/credential dari subject,
- mencegah identity leakage,
- membersihkan state setelah logout atau authentication cleanup.

Pitfall:

```java
subject.getPrincipals().clear();
subject.getPublicCredentials().clear();
subject.getPrivateCredentials().clear();
```

Kelihatannya sederhana, tetapi hati-hati bila container menaruh principal internal. Jangan merusak state yang bukan milik module bila container punya contract khusus.

Ikuti dokumentasi container.

---

## 23. Contoh: Bearer Token `ServerAuthModule`

Berikut skeleton konseptual untuk bearer token. Ini bukan production-ready JWT library code, tetapi menunjukkan alur SPI.

```java
public final class BearerTokenServerAuthModule implements ServerAuthModule {

    private CallbackHandler handler;
    private TokenVerifier tokenVerifier;

    @Override
    public void initialize(
            MessagePolicy requestPolicy,
            MessagePolicy responsePolicy,
            CallbackHandler handler,
            Map options) throws AuthException {

        this.handler = handler;
        this.tokenVerifier = TokenVerifier.fromOptions(options);
    }

    @Override
    public Class[] getSupportedMessageTypes() {
        return new Class[] {
                HttpServletRequest.class,
                HttpServletResponse.class
        };
    }

    @Override
    public AuthStatus validateRequest(
            MessageInfo messageInfo,
            Subject clientSubject,
            Subject serviceSubject) throws AuthException {

        HttpServletRequest request =
                (HttpServletRequest) messageInfo.getRequestMessage();
        HttpServletResponse response =
                (HttpServletResponse) messageInfo.getResponseMessage();

        String authorization = request.getHeader("Authorization");

        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return challenge(response, "missing_token");
        }

        String token = authorization.substring("Bearer ".length());

        TokenClaims claims;
        try {
            claims = tokenVerifier.verify(token);
        } catch (TokenExpiredException e) {
            return challenge(response, "invalid_token");
        } catch (TokenVerificationException e) {
            return challenge(response, "invalid_token");
        }

        Principal principal = () -> claims.subject();
        String[] groups = claims.groups().toArray(String[]::new);

        try {
            handler.handle(new Callback[] {
                    new CallerPrincipalCallback(clientSubject, principal),
                    new GroupPrincipalCallback(clientSubject, groups)
            });
        } catch (IOException | UnsupportedCallbackException e) {
            throw (AuthException) new AuthException("Unable to set caller identity")
                    .initCause(e);
        }

        return AuthStatus.SUCCESS;
    }

    private AuthStatus challenge(HttpServletResponse response, String error) throws AuthException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setHeader(
                "WWW-Authenticate",
                "Bearer realm=\"api\", error=\"" + error + "\"");
        return AuthStatus.SEND_CONTINUE;
    }

    @Override
    public AuthStatus secureResponse(MessageInfo messageInfo, Subject serviceSubject) {
        return AuthStatus.SEND_SUCCESS;
    }

    @Override
    public void cleanSubject(MessageInfo messageInfo, Subject subject) {
        subject.getPrincipals().clear();
    }
}
```

Production requirements:

- validate issuer,
- validate audience,
- validate expiry,
- validate signature,
- validate `kid`,
- reject `alg=none`,
- cache JWKS safely,
- handle key rotation,
- handle clock skew deliberately,
- map claims to groups carefully,
- log without token value,
- produce correct 401 challenge,
- distinguish 401 vs 403,
- test malformed tokens.

---

## 24. Contoh: Trusted Gateway Header Module

Dalam enterprise, sering ada gateway atau reverse proxy yang sudah melakukan login.

Flow:

```text
Browser
  → Gateway / SSO Proxy
      validates login
      injects identity header
  → Jakarta App
      trusts gateway header only from internal network
```

Module:

```java
public final class GatewayHeaderAuthModule implements ServerAuthModule {

    private CallbackHandler handler;
    private String userHeader;
    private String groupsHeader;

    @Override
    public void initialize(
            MessagePolicy requestPolicy,
            MessagePolicy responsePolicy,
            CallbackHandler handler,
            Map options) {
        this.handler = handler;
        this.userHeader = (String) options.getOrDefault("userHeader", "X-Auth-User");
        this.groupsHeader = (String) options.getOrDefault("groupsHeader", "X-Auth-Groups");
    }

    @Override
    public Class[] getSupportedMessageTypes() {
        return new Class[] { HttpServletRequest.class, HttpServletResponse.class };
    }

    @Override
    public AuthStatus validateRequest(
            MessageInfo messageInfo,
            Subject clientSubject,
            Subject serviceSubject) throws AuthException {

        HttpServletRequest request =
                (HttpServletRequest) messageInfo.getRequestMessage();
        HttpServletResponse response =
                (HttpServletResponse) messageInfo.getResponseMessage();

        String username = request.getHeader(userHeader);
        if (username == null || username.isBlank()) {
            try {
                response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
                return AuthStatus.SEND_FAILURE;
            } catch (IOException e) {
                throw (AuthException) new AuthException("Cannot send unauthorized").initCause(e);
            }
        }

        String rawGroups = request.getHeader(groupsHeader);
        String[] groups = parseGroups(rawGroups);

        try {
            handler.handle(new Callback[] {
                    new CallerPrincipalCallback(clientSubject, username),
                    new GroupPrincipalCallback(clientSubject, groups)
            });
        } catch (IOException | UnsupportedCallbackException e) {
            throw (AuthException) new AuthException("Cannot notify container")
                    .initCause(e);
        }

        return AuthStatus.SUCCESS;
    }

    private String[] parseGroups(String raw) {
        if (raw == null || raw.isBlank()) {
            return new String[0];
        }
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isBlank())
                .toArray(String[]::new);
    }

    @Override
    public AuthStatus secureResponse(MessageInfo messageInfo, Subject serviceSubject) {
        return AuthStatus.SEND_SUCCESS;
    }

    @Override
    public void cleanSubject(MessageInfo messageInfo, Subject subject) {
        subject.getPrincipals().clear();
    }
}
```

Security invariant:

```text
The app must not be reachable directly by untrusted clients.
All incoming identity headers must be stripped/replaced by the trusted gateway.
```

Safer gateway config pattern:

```text
1. Edge gateway removes all inbound X-Auth-* headers from client.
2. Gateway authenticates caller.
3. Gateway injects fresh signed/controlled identity header.
4. App only accepts traffic from gateway network/security group.
5. App validates optional HMAC/signature header if needed.
```

Anti-pattern:

```text
Client → App with X-Auth-User: admin
```

If the app accepts that, authentication is bypassed.

---

## 25. Registration and Deployment Reality

Jakarta Authentication defines contracts, but deployment varies by container.

In a perfect portable world:

```text
Register AuthConfigProvider → container invokes ServerAuthModule
```

In real production:

- Tomcat has JASPIC/Jakarta Authentication configuration style,
- Jetty has its own module support/bridge,
- Open Liberty has feature configuration,
- WildFly/Payara/WebLogic have their own security subsystem model,
- some containers support Jakarta Security more smoothly than direct Jakarta Authentication,
- some containers expose vendor-specific adapters.

Therefore:

```text
Jakarta Authentication is standard at SPI level, but operational wiring is container-specific.
```

This is why many application teams prefer Jakarta Security unless they have a strong reason to implement direct Jakarta Authentication.

---

## 26. How Principal and Groups Become Roles

Authentication module can set:

```text
caller principal = alice
groups = [CASE_OFFICER, ADMIN]
```

Application checks:

```java
request.isUserInRole("ADMIN")
```

But this works only if container maps group/role appropriately.

Possible models:

### 26.1 Direct Group-as-Role

```text
group ADMIN → role ADMIN
```

Simple but dangerous for large enterprise because external group names leak into app code.

### 26.2 Deployment Mapping

```text
external group APP_ACEAS_ADMIN → app role ADMIN
```

Better.

### 26.3 Application Mapping After Login

```text
external group → application role → domain permission
```

Best for complex apps.

But remember:

```text
Container-level @RolesAllowed sees container roles/groups, not your custom domain permission unless integrated.
```

If you need domain permission, enforce it in domain authorization layer, not only container role.

---

## 27. Common Bug: Authentication Success, Authorization Fails

Symptom:

```text
Login succeeds.
request.getUserPrincipal() returns alice.
But @RolesAllowed("ADMIN") returns 403.
```

Possible causes:

1. `GroupPrincipalCallback` not called.
2. Group name mismatch.
3. Role not declared in application.
4. Container requires role mapping in deployment descriptor.
5. Group is set as principal but not recognized as group.
6. Wrong realm/security domain.
7. Case mismatch: `admin` vs `ADMIN`.
8. Jakarta namespace mismatch.
9. Module registered for wrong app context.
10. Multiple authentication mechanisms conflict.
11. App checks JAX-RS role context while module set only Servlet identity incorrectly.
12. Container-specific integration missing.

Debug checklist:

```text
[ ] Is validateRequest actually invoked?
[ ] Does it return SUCCESS?
[ ] Is CallerPrincipalCallback invoked?
[ ] Is GroupPrincipalCallback invoked?
[ ] What exact group names are passed?
[ ] Are roles declared in web.xml/annotations?
[ ] Does container map group to role?
[ ] Does request.getUserPrincipal() work?
[ ] Does request.isUserInRole("X") work?
[ ] Does @RolesAllowed("X") work?
[ ] Is JAX-RS using same security context?
[ ] Are there multiple security layers overriding each other?
```

---

## 28. Common Bug: Module Not Invoked

Symptom:

```text
My ServerAuthModule code never runs.
```

Possible causes:

1. Provider not registered.
2. Wrong message layer.
3. Wrong app context.
4. Container feature not enabled.
5. App uses different security mechanism overriding it.
6. Wrong package namespace (`javax` vs `jakarta`).
7. Missing API/runtime dependency.
8. Module not visible due to classloader.
9. Deployment descriptor not recognized.
10. Container does not support the expected profile.
11. Request path not protected, so module not triggered depending container behavior.
12. Wrong server version.

Debug order:

```text
1. Confirm container supports Jakarta Authentication version.
2. Confirm feature/module enabled.
3. Confirm provider/module registration.
4. Confirm message layer and app context.
5. Confirm classloader visibility.
6. Add safe startup log in initialize.
7. Add safe request log in validateRequest.
8. Test protected endpoint.
```

---

## 29. Custom Login: Jakarta Authentication vs Jakarta Security

Suppose we want a custom login form.

Option A: Jakarta Security:

```java
@ApplicationScoped
public class AppAuthMechanism implements HttpAuthenticationMechanism {
    @Inject IdentityStoreHandler identityStoreHandler;
}
```

Option B: Jakarta Authentication:

```java
public class AppServerAuthModule implements ServerAuthModule {
    // lower-level callbacks
}
```

For most application teams, choose A.

Choose B only when:

- container-level SPI integration is required,
- third-party security product integration is needed,
- mechanism must be portable as server module,
- Jakarta Security abstraction is too high-level,
- you need direct control over message authentication lifecycle,
- you are implementing a container/security extension.

---

## 30. Relationship With JAAS

JAAS introduced:

- `Subject`,
- `Principal`,
- `LoginModule`,
- `CallbackHandler`,
- `LoginContext`.

Jakarta Authentication uses `Subject` and callback patterns, but it is not simply JAAS login.

JAAS mental model:

```text
Application invokes LoginContext → LoginModule validates → Subject produced
```

Jakarta Authentication mental model:

```text
Container invokes ServerAuthModule → module validates message → container identity established
```

Key difference:

```text
JAAS is not automatically container web authentication.
Jakarta Authentication is designed for container authentication integration.
```

A `LoginModule` can be part of an implementation, but it does not automatically make Servlet/EJB/JAX-RS security work unless bridged through container.

---

## 31. Relationship With Jakarta Authorization

Authentication answers:

```text
Who is the caller?
What groups/identity attributes are known by container?
```

Authorization answers:

```text
May this caller access this resource/action?
```

Jakarta Authentication may set:

```text
principal = alice
groups = [CASE_OFFICER]
```

Jakarta Authorization/container policy may decide:

```text
CASE_OFFICER can access /cases/* GET
CASE_OFFICER cannot access /admin/*
```

Application domain policy may decide:

```text
alice can approve case C-100 only if:
- case is assigned to her team,
- case is in REVIEW_PENDING state,
- alice was not the maker,
- tenant matches,
- no conflict-of-interest flag exists.
```

Do not overload Jakarta Authentication module with all business authorization logic.

Better separation:

```text
Authentication module → establish identity and groups
Container authorization → coarse-grained resource access
Domain authorization → fine-grained business decision
```

---

## 32. Message Authentication vs HTTP Authentication

The SPI is named around message authentication because it can conceptually apply to request/response messages, not just username/password.

For Servlet:

```text
message = HttpServletRequest + HttpServletResponse
```

But conceptually authentication can involve:

- HTTP header,
- cookie,
- TLS certificate,
- bearer token,
- signed message,
- custom protocol handshake,
- response security.

This explains why API names may feel more abstract than normal web login APIs.

---

## 33. State Management

A `ServerAuthModule` should generally be stateless per request.

Allowed instance state:

- immutable config,
- thread-safe verifier,
- thread-safe cache,
- metrics handle,
- logger,
- immutable mapping table.

Avoid:

- current user,
- current token,
- current request,
- current response,
- current group set,
- mutable non-thread-safe parser,
- per-request error detail.

Bad:

```java
private Subject lastSubject;
private String currentToken;
private List<String> currentGroups;
```

Good:

```java
private volatile JwksCache jwksCache;
private TokenVerifier tokenVerifier;
private String issuer;
```

Even then, ensure thread safety.

---

## 34. Async, Dispatch, and Thread Context

Jakarta Authentication runs at container authentication boundary.

But after authentication:

- servlet may start async processing,
- request may dispatch to another servlet/JSP,
- JAX-RS may invoke resource method,
- CDI/EJB may invoke service,
- application may use executor.

The module establishes initial caller identity. It does not magically solve all context propagation issues.

Risk:

```text
Request authenticated as Alice.
Application starts CompletableFuture on unmanaged executor.
Future runs without container security context.
Audit records SYSTEM or null actor.
```

Design rule:

```text
At application boundary, map container caller to explicit domain Actor and pass Actor intentionally to domain services/events.
```

Do not rely blindly on thread-local security context in async business code.

---

## 35. Java 8–25 Considerations

Jakarta Authentication itself is a Jakarta EE API, but runtime behavior intersects Java versions.

### 35.1 Java 8

Common in older Java EE 8 / `javax` deployments.

Concerns:

- older containers,
- legacy JASPIC naming,
- `javax.security.auth.message.*`,
- JAAS-heavy integration,
- older TLS/JWT libraries,
- weaker default ecosystem.

### 35.2 Java 11/17

Common migration baseline.

Concerns:

- `javax` to `jakarta` migration,
- container upgrade,
- module path if used,
- TLS defaults improved,
- library compatibility.

### 35.3 Java 21+

Modern LTS baseline with virtual threads.

Concerns:

- thread-local assumptions,
- security context propagation,
- managed executor vs raw executor,
- high concurrency token validation pressure,
- caching and rate limiting to IdP/JWKS/introspection endpoint.

### 35.4 Java 25

Latest modern runtime line in this series range.

Concerns:

- container support maturity,
- Jakarta EE compatibility matrix,
- security provider behavior,
- dependency compatibility,
- operational testing under new JVM.

Main rule:

```text
Do not assume Java version alone determines Jakarta API version.
The app server/container determines which Jakarta EE APIs are supported.
```

---

## 36. `javax` vs `jakarta` Namespace

Older JASPIC APIs used `javax.security.auth.message.*`.

Jakarta APIs use `jakarta.security.auth.message.*`.

Conceptual migration:

```text
javax.security.auth.message.module.ServerAuthModule
→ jakarta.security.auth.message.module.ServerAuthModule
```

```text
javax.security.auth.message.callback.CallerPrincipalCallback
→ jakarta.security.auth.message.callback.CallerPrincipalCallback
```

Risks:

1. compiling against `jakarta` but deploying to Java EE 8 container,
2. compiling against `javax` but deploying to Jakarta EE 10/11 container,
3. mixed dependencies,
4. shaded libraries still referencing old namespace,
5. container classloader conflict.

Migration checklist:

```text
[ ] Know target app server version.
[ ] Know supported Jakarta EE version.
[ ] Align Servlet/Jakarta Authentication/Jakarta Security API versions.
[ ] Remove duplicate javax/jakarta APIs from app lib if container provides them.
[ ] Test authentication module loading.
[ ] Test callback behavior.
[ ] Test role mapping.
```

---

## 37. Error Handling and Logging

Authentication module sits at sensitive boundary. Logging mistakes can create security incidents.

Never log:

- raw password,
- raw bearer token,
- raw refresh token,
- full session cookie,
- private key,
- full certificate private material,
- OTP code,
- secret header.

Safe logs:

```text
auth_module=BearerTokenServerAuthModule
outcome=invalid_token
reason=expired
issuer=https://idp.example.com
client_ip_hash=...
correlation_id=...
path=/api/cases
```

Be careful with username logging:

- useful for audit,
- but can be PII,
- follow retention and privacy rules,
- log normalized subject ID where possible.

Good failure taxonomy:

```text
MISSING_CREDENTIAL
INVALID_CREDENTIAL
EXPIRED_CREDENTIAL
UNTRUSTED_ISSUER
INVALID_AUDIENCE
SIGNATURE_FAILED
USER_DISABLED
GROUP_MAPPING_FAILED
CALLBACK_FAILED
CONFIGURATION_ERROR
```

---

## 38. Observability

Metrics to collect:

```text
auth.requests.total
auth.success.total
auth.failure.total
auth.challenge.total
auth.callback.failure.total
auth.token.expired.total
auth.token.signature.failure.total
auth.config.error.total
auth.duration.ms
auth.jwks.cache.hit
auth.jwks.cache.miss
auth.identity.mapping.failure.total
```

Dimensions:

- mechanism,
- application,
- realm,
- issuer,
- path group,
- outcome,
- error category.

Avoid dimensions with high cardinality:

- raw user ID,
- raw token ID,
- full path with IDs,
- IP address unbounded.

---

## 39. Security Review Checklist for `ServerAuthModule`

Use this checklist before production:

```text
[ ] Module has no mutable per-request instance state.
[ ] Credential extraction is strict.
[ ] Missing credential behavior is correct for protected/public resources.
[ ] Invalid credential returns correct 401/challenge.
[ ] Authenticated-but-not-authorized remains 403 outside module.
[ ] CallerPrincipalCallback is invoked on success.
[ ] GroupPrincipalCallback is invoked when groups are available.
[ ] Group names are normalized.
[ ] Role mapping is tested in container.
[ ] Tokens/passwords/secrets are never logged.
[ ] Token validation checks issuer/audience/expiry/signature/algorithm.
[ ] Header-based identity only accepted from trusted gateway path.
[ ] Direct access bypass is blocked.
[ ] Callback failures produce safe error.
[ ] Module registration is tested after deployment.
[ ] Module works under concurrent load.
[ ] Module works after redeploy.
[ ] Module works with session timeout/logout behavior.
[ ] Metrics and audit events exist.
[ ] Negative tests cover missing/malformed/expired/replayed credentials.
[ ] Javax/jakarta namespace is aligned with container.
```

---

## 40. Testing Strategy

### 40.1 Unit Test

Test pure logic separately:

- token parser,
- header parser,
- group mapper,
- challenge builder,
- config validator.

Do not make all tests require real container.

### 40.2 Module-Level Test With Fake CallbackHandler

Create fake `CallbackHandler` that captures callbacks.

```java
final class CapturingCallbackHandler implements CallbackHandler {
    Principal caller;
    String[] groups;

    @Override
    public void handle(Callback[] callbacks) throws UnsupportedCallbackException {
        for (Callback callback : callbacks) {
            if (callback instanceof CallerPrincipalCallback cpc) {
                this.caller = cpc.getPrincipal();
            } else if (callback instanceof GroupPrincipalCallback gpc) {
                this.groups = gpc.getGroups();
            } else {
                throw new UnsupportedCallbackException(callback);
            }
        }
    }
}
```

Then test:

```text
valid token → CallerPrincipalCallback + GroupPrincipalCallback + SUCCESS
missing token → challenge + SEND_CONTINUE
expired token → challenge + SEND_CONTINUE
malformed token → challenge + SEND_CONTINUE
callback failure → AuthException
```

### 40.3 Container Integration Test

Must verify:

```text
GET /secure as alice → 200
GET /secure without credential → 401/redirect
GET /admin as non-admin → 403
request.getUserPrincipal() returns alice
request.isUserInRole("ADMIN") returns expected value
@RolesAllowed behaves correctly
```

### 40.4 Load Test

Specifically test concurrency:

- many users concurrently,
- no identity leakage,
- no shared mutable state bug,
- cache thread safety,
- JWKS/introspection endpoint not overloaded.

---

## 41. Production Failure Models

### 41.1 Identity Header Spoofing

Cause:

```text
Application trusts X-Auth-User from any client.
```

Impact:

```text
Authentication bypass.
```

Fix:

```text
Strip inbound identity headers at edge.
Only gateway injects identity.
Block direct access.
Optionally sign identity headers.
```

### 41.2 Group Mapping Drift

Cause:

```text
IdP group renamed from APP_ADMIN to ACEAS_ADMIN.
App still expects APP_ADMIN.
```

Impact:

```text
Admins lose access or wrong users gain access depending mapping.
```

Fix:

```text
Decouple IdP groups from app roles with explicit mapping table/config and tests.
```

### 41.3 Auth Module Registered in Wrong Context

Cause:

```text
AuthConfigProvider registered for wrong appContext.
```

Impact:

```text
Module not invoked. Container falls back to default behavior.
```

Fix:

```text
Verify message layer/app context registration and container logs.
```

### 41.4 Token Key Rotation Outage

Cause:

```text
JWKS cache never refreshes or refreshes too aggressively.
```

Impact:

```text
Mass login/API failure after IdP rotates signing key.
```

Fix:

```text
Implement bounded JWKS cache with refresh-on-kid-miss and safe retry.
```

### 41.5 Identity Leak Across Threads

Cause:

```text
Module stores current user in instance field.
```

Impact:

```text
User A request may be processed with User B identity.
```

Fix:

```text
No per-request mutable module fields. Use local variables/request context only.
```

### 41.6 Callback Not Called

Cause:

```text
Module validates credential but does not call CallerPrincipalCallback.
```

Impact:

```text
Application-specific code thinks login succeeded, but container security sees anonymous.
```

Fix:

```text
Always notify container via standard callbacks on success.
```

---

## 42. Design Heuristics

### 42.1 Keep Module Narrow

A `ServerAuthModule` should answer:

```text
Can this request establish a valid caller identity?
```

It should not become:

- business permission engine,
- tenant resolver for all use cases,
- audit pipeline,
- user profile service,
- account management service,
- policy decision point.

### 42.2 Make Identity Explicit After Boundary

After container authentication, map to explicit domain actor:

```java
Actor actor = actorResolver.from(securityContext);
caseService.approve(actor, caseId);
```

This is better than domain service calling security context everywhere.

### 42.3 Separate Coarse and Fine Authorization

```text
Container role → coarse access
Domain permission → business action
Database constraint → data isolation
Audit → accountability
```

### 42.4 Treat Authentication as Protocol

Authentication is not a boolean.

It has protocol states:

```text
missing credential
challenge sent
credential submitted
credential valid
credential invalid
credential expired
identity established
session created
logout requested
subject cleaned
```

Modeling these states prevents bugs.

---

## 43. Mini Architecture Pattern: Custom Enterprise SSO Bridge

Scenario:

```text
Enterprise has legacy SSO appliance.
SSO authenticates user.
SSO forwards request to Jakarta application with signed identity headers.
Application needs container principal/groups so @RolesAllowed works.
```

Architecture:

```text
Browser
  |
  v
SSO Gateway
  - authenticates user
  - strips inbound identity headers
  - injects X-User, X-Groups, X-Signature, X-Timestamp
  |
  v
Jakarta App
  - ServerAuthModule validates gateway signature/timestamp
  - extracts user/groups
  - calls CallerPrincipalCallback
  - calls GroupPrincipalCallback
  |
  v
Container Security
  - getUserPrincipal works
  - isUserInRole works
  - @RolesAllowed works
  |
  v
Domain Authorization
  - maps role + tenant + case state to permission
```

Important invariants:

```text
[ ] Gateway is the only trusted identity injector.
[ ] Header signature prevents spoofing inside network.
[ ] Timestamp prevents replay.
[ ] App rejects direct client access.
[ ] App maps external groups to stable internal roles.
[ ] Domain authorization still checks tenant/resource/state.
```

---

## 44. Anti-Patterns

### 44.1 Validating Credential Without Container Notification

```java
if (validPassword(username, password)) {
    request.setAttribute("user", username);
    return AuthStatus.SUCCESS;
}
```

Problem:

```text
Container identity is not established.
```

### 44.2 Doing Business Authorization Inside Authentication Module

```java
if (!caseService.canApprove(user, caseId)) {
    return AuthStatus.SEND_FAILURE;
}
```

Problem:

```text
Authentication module becomes domain policy engine and confuses 401/403 semantics.
```

### 44.3 Trusting Raw Gateway Headers

```java
String user = request.getHeader("X-User");
```

without network/header controls.

Problem:

```text
Spoofable identity.
```

### 44.4 Storing User in Static/Instance Field

```java
private static String currentUser;
```

Problem:

```text
Cross-request identity leak.
```

### 44.5 Treating Groups as Final Permissions

```java
if (groups.contains("CASE_APPROVER")) approve(caseId);
```

Problem:

```text
Ignores tenant, assignment, maker-checker, state, delegation, conflict-of-interest.
```

---

## 45. Practical Decision Tree

```text
Need normal app login with username/password?
    → Jakarta Security + IdentityStore

Need custom HTTP auth in app code?
    → Jakarta Security HttpAuthenticationMechanism

Need OIDC login?
    → Jakarta Security OIDC mechanism or external IdP integration

Need JWT resource server?
    → MicroProfile JWT / Jakarta Security custom mechanism / framework-specific support

Need custom module plugged directly into container?
    → Jakarta Authentication ServerAuthModule

Need proprietary SSO/gateway bridge to container identity?
    → Jakarta Authentication may be appropriate

Need authorization policy customization at container permission level?
    → Jakarta Authorization/JACC area

Need domain permission like approve/reassign/escalate case?
    → Application domain authorization service
```

---

## 46. Summary Mental Model

Jakarta Authentication is the **container authentication SPI**.

Its job is not merely:

```text
credential valid? true/false
```

Its real job is:

```text
Given a request/response message, perform authentication protocol work and establish caller identity inside the container security model.
```

The most important implementation act is:

```java
handler.handle(new Callback[] {
    new CallerPrincipalCallback(clientSubject, principal),
    new GroupPrincipalCallback(clientSubject, groups)
});
```

Without that, authentication may be application-local but not container-recognized.

Final invariant:

```text
A successful authentication module must produce a container-recognized caller identity with predictable group/role mapping, correct protocol response semantics, no credential leakage, no request-state leakage, and clear separation from domain authorization.
```

---

## 47. What You Should Be Able To Explain After This Part

You should be able to explain:

1. what Jakarta Authentication is,
2. why it is lower-level than Jakarta Security,
3. what `ServerAuthModule` does,
4. how `validateRequest` works,
5. what `MessageInfo` carries,
6. why `CallbackHandler` is critical,
7. how `CallerPrincipalCallback` establishes identity,
8. how `GroupPrincipalCallback` influences roles,
9. why authentication success can still lead to authorization failure,
10. how module registration can fail,
11. why per-request instance state is dangerous,
12. how trusted gateway header authentication can be safe or unsafe,
13. how Java 8–25 and `javax`/`jakarta` affect implementation,
14. when to choose Jakarta Security vs Jakarta Authentication,
15. how to test and debug custom container authentication.

---

## 48. References

- Jakarta Authentication 3.1 Specification: https://jakarta.ee/specifications/authentication/3.1/jakarta-authentication-spec-3.1
- Jakarta Authentication 3.1 Release Page: https://jakarta.ee/specifications/authentication/3.1/
- Jakarta Security 4.0 Specification: https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0
- Jakarta Security Specifications: https://jakarta.ee/specifications/security/
- Jakarta Servlet Specifications: https://jakarta.ee/specifications/servlet/
- Apache Tomcat Jakarta Authentication/JASPIC documentation: https://tomcat.apache.org/tomcat-11.0-doc/config/jaspic.html
- Jetty JASPI support documentation: https://jetty.org/docs/jetty/12.1/operations-guide/security/jaspi-support.html
- Open Liberty Jakarta Authentication feature documentation: https://www.ibm.com/docs/en/was-liberty/core?topic=features-jakarta-authentication-31

---

## 49. Status Seri

Selesai sampai:

```text
Part 00 — Orientation: Enterprise Java Security Mental Model
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
Part 03 — Container Security Architecture
Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Cert, OIDC
Part 06 — Jakarta Security API Core
Part 07 — SecurityContext Deep Dive
Part 08 — IdentityStore Deep Dive
Part 09 — Credentials and Password Handling in Jakarta Applications
Part 10 — Jakarta Authentication / JASPIC Deep Dive
```

Berikutnya:

```text
Part 11 — Jakarta Authorization / JACC Deep Dive
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-09-credentials-password-handling.md">⬅️ Part 09 — Credentials and Password Handling in Jakarta Applications</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-11-jakarta-authorization-jacc-deep-dive.md">Part 11 — Jakarta Authorization / JACC Deep Dive ➡️</a>
</div>
