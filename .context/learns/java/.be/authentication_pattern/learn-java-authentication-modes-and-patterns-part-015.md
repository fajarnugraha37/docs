# learn-java-authentication-modes-and-patterns-part-015

# Part 15 — Authorization Code + PKCE for Java Web and SPA Backends

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membangun fondasi OAuth 2.0 dan OpenID Connect:

- OAuth 2.0 adalah framework delegated authorization.
- OIDC menambahkan identity layer di atas OAuth 2.0.
- Token bukan bukti magis; token adalah artifact yang harus divalidasi dalam konteks issuer, audience, expiry, key, client, dan flow.

Part ini masuk ke flow yang paling penting untuk aplikasi modern:

> Authorization Code Flow dengan PKCE.

Flow ini sangat penting karena banyak aplikasi Java modern berada dalam bentuk:

- server-rendered web app,
- Spring Boot MVC app,
- Jakarta EE web app,
- SPA Vue/React/Angular dengan backend Java,
- Backend-for-Frontend atau BFF,
- mobile/native client yang memanggil Java backend,
- internal enterprise portal dengan SSO,
- government/regulatory web application dengan browser user, gateway, IdP, session, dan API backend.

Namun banyak engineer masih salah memahami PKCE. Banyak yang mengira:

- PKCE adalah pengganti client secret.
- PKCE membuat SPA otomatis aman menyimpan token.
- PKCE adalah CSRF protection penuh.
- PKCE hanya untuk mobile app.
- Authorization code aman tanpa strict redirect validation.
- Kalau sudah pakai Spring Security, semua OAuth/OIDC risk otomatis selesai.

Semua asumsi itu tidak cukup kuat untuk production-grade system.

Part ini akan membangun mental model bahwa Authorization Code + PKCE adalah:

> mekanisme untuk membuktikan bahwa pihak yang menukar authorization code adalah pihak yang sama yang memulai authorization request.

Tetapi PKCE tidak menyelesaikan semua risiko:

- token theft,
- XSS,
- malicious redirect URI,
- wrong audience,
- confused deputy,
- open redirect,
- login CSRF,
- session fixation,
- browser storage compromise,
- IdP mix-up,
- account linking bug,
- weak BFF cookie design,
- cross-tenant issuer confusion.

Top 1% engineer tidak hanya bisa mengonfigurasi `oauth2Login()`. Ia bisa menjelaskan invariant dari flow, membaca trace redirect, membedakan masalah auth code vs token vs session, dan mendesain boundary yang defensible.

---

## 1. Problem yang Diselesaikan

### 1.1 Masalah Utama

Dalam aplikasi browser modern, user perlu login melalui Authorization Server/Identity Provider, lalu aplikasi perlu memperoleh identity dan/atau token tanpa mengekspos credential user ke aplikasi.

Problem klasiknya:

```text
User ingin akses App
App tidak boleh tahu password IdP user
IdP harus authenticate user
App perlu bukti hasil authentication
App perlu memastikan response benar-benar milik flow yang dimulai App
Attacker tidak boleh bisa mencuri/menukar authorization code
Browser adalah lingkungan hostile: redirect, script, extension, history, storage, tab, dan network semua punya risiko
```

Authorization Code Flow awalnya menyelesaikan sebagian masalah:

1. Browser diarahkan ke authorization endpoint.
2. User login di IdP.
3. IdP redirect balik ke app membawa `code`.
4. Backend app menukar `code` ke token melalui back-channel.

Namun authorization code bisa menjadi target serangan. Jika attacker dapat mencuri code atau menyuntikkan code ke redirect flow korban, maka token dapat diberikan kepada pihak yang salah.

PKCE menambahkan bukti tambahan:

- client membuat secret sementara bernama `code_verifier`,
- client mengirim hash-nya sebagai `code_challenge` saat authorization request,
- authorization server menyimpan challenge tersebut,
- saat token request, client harus mengirim `code_verifier`,
- authorization server memverifikasi bahwa verifier cocok dengan challenge.

Dengan begitu, authorization code saja tidak cukup. Pihak yang menukar code harus punya verifier asli.

### 1.2 Problem yang Tidak Diselesaikan PKCE

PKCE bukan silver bullet.

PKCE tidak otomatis menyelesaikan:

- token dicuri dari browser storage,
- XSS membaca token di memory/localStorage,
- refresh token dicuri,
- cookie session tidak aman,
- redirect URI longgar,
- state tidak divalidasi,
- nonce tidak divalidasi di OIDC,
- backend salah mapping user,
- app menerima token dari issuer salah,
- SPA menjalankan OAuth logic secara tidak aman,
- open redirect di client application,
- authorization server misconfiguration.

PKCE adalah satu defense pada satu titik flow:

```text
Authorization code redemption binding
```

Bukan total browser security model.

---

## 2. Mental Model Besar

### 2.1 Authorization Code adalah Claim Ticket, Bukan Token Akhir

Authorization code dapat dipahami seperti tiket klaim sementara:

```text
Authorization code = one-time temporary ticket
```

Ia bukan token yang dipakai untuk akses API. Ia adalah artifact sementara untuk ditukar dengan token.

Sifat ideal authorization code:

- short-lived,
- one-time use,
- bound to client,
- bound to redirect URI,
- bound to PKCE challenge,
- issued only after successful authorization,
- unusable kalau flow context tidak cocok.

Kesalahan umum:

```text
“Code sudah diterima di redirect URI berarti login sukses.”
```

Yang benar:

```text
Login belum selesai sampai code berhasil ditukar, token divalidasi, state/nonce cocok, dan local session dibuat dengan identity yang benar.
```

### 2.2 PKCE Mengikat Start dan Finish

Bayangkan flow OAuth/OIDC sebagai dua fase:

```text
Phase A: Start authorization request
Phase B: Finish token request
```

PKCE mengikat keduanya:

```text
Start:
  generate code_verifier
  derive code_challenge
  send code_challenge

Finish:
  receive code
  send code + code_verifier
  AS checks verifier against stored challenge
```

Invariant:

> Pihak yang menyelesaikan flow harus memiliki rahasia sementara yang dibuat pada awal flow.

Tanpa PKCE:

```text
attacker obtains code -> attacker may redeem code if other checks weak
```

Dengan PKCE:

```text
attacker obtains code -> attacker still needs code_verifier
```

### 2.3 `state`, `nonce`, dan PKCE Memiliki Tugas Berbeda

Banyak engineer mencampuradukkan `state`, `nonce`, dan PKCE.

| Mekanisme | Digunakan di | Tujuan utama |
|---|---:|---|
| `state` | Authorization request/redirect response | Mengikat response ke browser session/request yang benar; CSRF/callback correlation |
| `nonce` | OIDC ID Token | Mengikat ID Token ke authentication request tertentu; mencegah replay/injection ID Token |
| PKCE | Authorization request/token request | Mengikat authorization code ke client instance yang memulai flow |

Mereka saling melengkapi.

Jangan memilih salah satu sebagai pengganti semua.

### 2.4 Client Type Menentukan Risiko

OAuth membedakan client berdasarkan kemampuan menjaga secret.

#### Confidential client

Contoh:

- backend Java server,
- Spring Boot MVC app,
- Jakarta EE server-side app,
- BFF server.

Bisa menyimpan client secret/private key dengan relatif aman karena berjalan di server.

#### Public client

Contoh:

- SPA murni di browser,
- mobile app,
- desktop app,
- CLI app tanpa secure backend.

Tidak bisa menjaga client secret secara kuat karena user/attacker bisa mengakses runtime/binary/storage.

PKCE awalnya dibuat untuk public client, tetapi modern best practice mendorong penggunaan PKCE juga untuk confidential clients karena PKCE menambah binding pada authorization code flow.

### 2.5 BFF Mengubah Browser dari OAuth Client Menjadi Session Client

Pada pure SPA OAuth pattern:

```text
Browser SPA = OAuth client
Browser stores/holds tokens
Browser calls APIs with access token
```

Pada BFF pattern:

```text
Browser = session client
BFF/backend Java = OAuth client
BFF stores tokens server-side
Browser holds only secure session cookie
Browser calls BFF, not resource APIs directly with OAuth tokens
```

Perubahan ini sangat besar.

Pure SPA menempatkan token di lingkungan browser yang rentan XSS. BFF memindahkan token handling ke server, lalu browser hanya memegang cookie session yang bisa diproteksi dengan `HttpOnly`, `Secure`, dan `SameSite`.

Namun BFF juga membawa risiko:

- CSRF terhadap BFF endpoint,
- session fixation,
- cookie domain terlalu luas,
- CORS salah,
- BFF menjadi high-value token holder,
- token/session mapping bug,
- logout propagation lebih kompleks.

---

## 3. Flow Authorization Code + PKCE End-to-End

### 3.1 Aktor

```text
+-------------------+       +-----------------------+       +--------------------+
| Browser/User       |       | Java App / BFF Client |       | Authorization      |
|                   |       |                       |       | Server / IdP       |
+-------------------+       +-----------------------+       +--------------------+
          |                            |                              |
          | wants login                |                              |
          |--------------------------->|                              |
          |                            | create state, nonce, PKCE     |
          |                            |                              |
          | redirect to auth endpoint  |                              |
          |<---------------------------|                              |
          |---------------------------- browser redirect ------------>|
          |                            |                              |
          | user authenticates         |                              |
          |<--------------------------- redirect with code -----------|
          |                            |                              |
          | callback code,state        |                              |
          |--------------------------->|                              |
          |                            | validate state                |
          |                            | token request code+verifier   |
          |                            |----------------------------->|
          |                            | tokens                        |
          |                            |<-----------------------------|
          |                            | validate tokens/claims        |
          |                            | create local session          |
          | authenticated response     |                              |
          |<---------------------------|                              |
```

### 3.2 Step 1 — User Starts Login

User mengakses protected resource:

```http
GET /dashboard
```

Java app belum punya authenticated local session.

App menyimpan original target:

```text
requested_uri = /dashboard
```

Namun hati-hati: original target tidak boleh menjadi open redirect. Jika setelah login app menerima parameter `returnUrl=https://evil.example`, lalu redirect ke sana, flow bisa menjadi vulnerability.

Rule:

```text
Only allow relative internal return paths or allowlisted absolute origins.
```

### 3.3 Step 2 — Client Generates Flow State

Client membuat beberapa artifact:

```text
state          = random high entropy string
nonce          = random high entropy string, for OIDC
code_verifier  = random high entropy string
code_challenge = BASE64URL(SHA256(code_verifier))
method         = S256
```

Server/BFF menyimpan correlation data:

```text
login_attempt_id -> {
  state,
  nonce,
  code_verifier,
  redirect_uri,
  requested_uri,
  created_at,
  client_id,
  tenant_context,
  issuer_context
}
```

Dalam Spring Security, banyak detail ini ditangani oleh authorization request repository dan OAuth2 client machinery. Namun sebagai engineer, kita harus tahu artifact apa yang disimpan dan mengapa.

### 3.4 Step 3 — Redirect to Authorization Endpoint

Authorization request kira-kira:

```http
GET https://idp.example.com/oauth2/authorize?
  response_type=code&
  client_id=aceas-web&
  redirect_uri=https%3A%2F%2Fapp.example.com%2Flogin%2Foauth2%2Fcode%2Fidp&
  scope=openid%20profile%20email&
  state=...&
  nonce=...&
  code_challenge=...&
  code_challenge_method=S256
```

Key points:

- `response_type=code` berarti Authorization Code Flow.
- `scope=openid` berarti OIDC ikut aktif.
- `state` untuk callback correlation.
- `nonce` untuk ID Token replay/injection defense.
- `code_challenge` untuk PKCE.
- `redirect_uri` harus exact match dengan registered URI.

### 3.5 Step 4 — User Authenticates at IdP

User login di IdP.

IdP dapat melakukan:

- password auth,
- MFA,
- passkey,
- enterprise SSO,
- Kerberos/SPNEGO,
- social login,
- risk-based auth,
- consent.

Aplikasi Java tidak boleh tahu password user. Ia hanya menerima hasil dari IdP setelah flow selesai.

### 3.6 Step 5 — Authorization Server Redirects Back with Code

Callback:

```http
GET https://app.example.com/login/oauth2/code/idp?
  code=abc123&
  state=xyz789
```

Client harus melakukan minimal:

```text
1. locate saved authorization request by state/session
2. verify state exactly
3. verify callback path maps to expected registration/provider
4. verify no duplicate/replay flow state
5. prepare token request using stored code_verifier
```

Jangan langsung membuat user session hanya karena `code` ada.

### 3.7 Step 6 — Token Request with Code Verifier

Backend Java/BFF mengirim request server-to-server:

```http
POST https://idp.example.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

 grant_type=authorization_code&
 code=abc123&
 redirect_uri=https%3A%2F%2Fapp.example.com%2Flogin%2Foauth2%2Fcode%2Fidp&
 client_id=aceas-web&
 code_verifier=original-random-secret
```

Untuk confidential client, request juga dapat menyertakan client authentication:

- `client_secret_basic`,
- `client_secret_post`,
- `private_key_jwt`,
- mTLS client authentication.

Important:

```text
PKCE does not replace confidential client authentication.
```

Untuk public client, client secret biasanya tidak digunakan karena tidak bisa dirahasiakan.

### 3.8 Step 7 — Authorization Server Validates

Authorization server memvalidasi:

```text
code exists
code not expired
code not used
code belongs to client_id
code belongs to redirect_uri
code bound to code_challenge
hash(code_verifier) == stored code_challenge
client authentication valid if required
```

Jika valid, token diterbitkan:

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 300,
  "refresh_token": "...",
  "id_token": "..."
}
```

### 3.9 Step 8 — Client Validates Tokens

Untuk OIDC, client harus memvalidasi ID Token:

- signature,
- issuer,
- audience,
- expiry,
- issued-at,
- nonce,
- authorized party jika relevant,
- algorithm sesuai allowlist,
- key from trusted JWKS.

Untuk access token:

- jika JWT: resource server validates signature/issuer/audience/expiry/scope.
- jika opaque: resource server introspects or delegates validation.

Client tidak boleh hanya decode JWT tanpa validasi.

### 3.10 Step 9 — Local Session Created

Pada server-side web/BFF:

```text
Validated identity -> local authenticated session
```

Session should contain stable local identity reference, not raw huge token dump.

Better:

```text
session_id -> server-side session data -> principal_id, tenant_id, authorities, token reference/encrypted token record
```

Browser receives cookie:

```http
Set-Cookie: SESSION=...; HttpOnly; Secure; SameSite=Lax; Path=/
```

For cross-site IdP redirect, `SameSite=Lax` often works for top-level navigation callback, but complex architectures may require careful cookie strategy.

---

## 4. PKCE Internals

### 4.1 Code Verifier

`code_verifier` adalah random string berentropi tinggi.

Properti:

- generated per authorization request,
- not reused,
- stored securely until callback,
- deleted after success/failure/timeout,
- never logged,
- never sent to browser unnecessarily in BFF/server-side pattern.

### 4.2 Code Challenge

Recommended method:

```text
code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
code_challenge_method = S256
```

Avoid `plain` unless forced by legacy compatibility. `S256` adalah metode yang seharusnya digunakan di production.

### 4.3 Minimal Java Implementation Example

Contoh ini untuk memahami mekanisme, bukan untuk menggantikan framework.

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

public final class PkceUtil {
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private PkceUtil() {
    }

    public static String generateCodeVerifier() {
        byte[] random = new byte[32];
        SECURE_RANDOM.nextBytes(random);
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(random);
    }

    public static String deriveS256CodeChallenge(String codeVerifier) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(codeVerifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(hash);
        } catch (Exception e) {
            throw new IllegalStateException("Unable to derive PKCE code challenge", e);
        }
    }
}
```

Important details:

- use `SecureRandom`,
- use URL-safe Base64,
- no padding,
- use ASCII for verifier hashing,
- do not log verifier,
- generate per flow.

### 4.4 PKCE Storage Decision

#### Server-side web/BFF

Store verifier server-side:

```text
HTTP session / server-side auth request repository / distributed session store
```

Browser gets only session/correlation cookie.

#### Pure SPA

Verifier must exist in browser runtime because SPA itself is OAuth client.

This creates risk:

- XSS can steal verifier before callback,
- browser storage choice matters,
- token also likely exposed to JS.

PKCE helps code interception but not browser compromise.

---

## 5. State, Nonce, and Redirect URI

### 5.1 `state` as Callback Correlation

`state` should be:

- high entropy,
- unique per authorization request,
- bound to browser session/login attempt,
- validated exactly,
- invalidated after use,
- time-limited.

A weak state implementation can allow login CSRF or callback confusion.

Bad:

```text
state = tenantId
state = userId
state = static string
state = unsigned returnUrl
```

Better:

```text
state = random opaque value -> server-side stored flow context
```

### 5.2 `nonce` in OIDC

`nonce` is included in authorization request, then expected in ID Token claim.

Purpose:

```text
bind ID Token to the authentication request
```

If app ignores nonce, attacker may inject a previously issued ID Token in some classes of flow bugs.

### 5.3 Redirect URI Strictness

Redirect URI must be validated exactly at Authorization Server.

Dangerous patterns:

```text
https://app.example.com/*
https://*.example.com/callback
redirect_uri prefix matching
allowing arbitrary query-controlled callback
```

Better:

```text
Exact registered redirect URI per client/environment/provider
```

Example:

```text
DEV:  https://dev.example.com/login/oauth2/code/company-idp
UAT:  https://uat.example.com/login/oauth2/code/company-idp
PROD: https://app.example.com/login/oauth2/code/company-idp
```

Do not share callback domains loosely across tenants unless tenant routing is explicitly modeled.

---

## 6. Java Architecture Patterns

### 6.1 Pattern A — Traditional Server-Side Web App

```text
Browser -> Java Web App -> IdP
Browser <- Session Cookie <- Java Web App
```

Characteristics:

- Java app is confidential OAuth/OIDC client.
- Tokens stay server-side.
- Browser holds session cookie.
- Good fit for Spring MVC, Thymeleaf, JSF, Jakarta MVC/server-rendered UI.

Pros:

- simple token handling,
- strong server control,
- less token exposure to JS,
- easier audit.

Cons:

- session state required,
- scaling needs session strategy,
- CSRF protection needed,
- not ideal for many independent frontends.

### 6.2 Pattern B — SPA as OAuth Client

```text
Browser SPA -> IdP
Browser SPA receives tokens
Browser SPA -> Resource API with Bearer token
```

Characteristics:

- SPA is public OAuth client.
- PKCE required.
- Tokens handled in browser.
- Resource server validates access token.

Pros:

- backend can be stateless resource server,
- frontend independently owns auth flow,
- works for pure static hosting.

Cons:

- browser token exposure,
- XSS risk high,
- refresh token handling complex,
- logout/session behavior complex,
- harder forensic boundary.

### 6.3 Pattern C — SPA + Java BFF

```text
Browser SPA -> Java BFF -> IdP
Browser SPA <- HttpOnly Session Cookie <- Java BFF
Browser SPA -> Java BFF -> APIs
```

Characteristics:

- BFF is OAuth client.
- Browser is not OAuth token holder.
- Tokens stored server-side.
- Browser uses session cookie.

Pros:

- reduces token exposure to JavaScript,
- centralized token exchange,
- easier enterprise policy enforcement,
- good for complex government/regulatory app.

Cons:

- BFF is stateful,
- CSRF must be handled,
- BFF becomes bottleneck,
- API calls may need token relay/exchange,
- multi-frontend scaling needs careful design.

### 6.4 Pattern D — Gateway OAuth Client + Backend Session/Headers

```text
Browser -> Gateway -> IdP
Gateway authenticates user
Gateway forwards identity headers to Java apps
```

This can be useful, but dangerous if backend trusts headers without boundary control.

Required controls:

- backend only accepts traffic from trusted gateway,
- strip incoming identity headers at edge,
- sign/encrypt forwarded identity or use internal token,
- audit gateway decision,
- avoid direct backend exposure.

Failure mode:

```text
Attacker calls backend directly with X-User-Id: admin
```

### 6.5 Pattern E — Java Resource Server Only

```text
Client obtains token elsewhere
Client -> Java API with access token
Java API validates token
```

This pattern is not login. Java API is not OAuth client for user login; it is resource server.

Good for:

- microservice API,
- backend API behind SPA/BFF/mobile,
- machine-to-machine API.

Responsibilities:

- validate JWT or introspect opaque token,
- check audience,
- check issuer,
- enforce scopes/roles,
- avoid trusting ID Token as API access token.

---

## 7. Spring Security Mapping

### 7.1 Spring OAuth2 Login

Typical Spring Boot server-side login:

```java
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http
            .authorizeHttpRequests(auth -> auth
                    .requestMatchers("/public/**").permitAll()
                    .anyRequest().authenticated()
            )
            .oauth2Login(oauth2 -> oauth2
                    .loginPage("/oauth2/authorization/company-idp")
            )
            .build();
}
```

This config says:

```text
Use OAuth2/OIDC login as browser authentication mechanism.
After successful external authentication, create Spring Authentication in SecurityContext.
```

Under the hood, Spring handles:

- authorization request construction,
- state storage,
- redirect,
- callback processing,
- code exchange,
- OIDC user loading,
- security context creation.

But you still own:

- provider configuration,
- redirect URI registration,
- authority mapping,
- tenant/issuer selection,
- session policy,
- CSRF policy,
- token storage policy,
- logout policy,
- audit event model.

### 7.2 Spring PKCE Behavior

Spring Security supports PKCE for public clients and OAuth2 client flows. In Spring configuration, public client is typically represented by:

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          spa-client:
            client-id: spa-client
            client-authentication-method: none
            authorization-grant-type: authorization_code
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
            scope: openid, profile, email
```

For confidential server-side clients, you may still configure PKCE depending on framework/provider support. Modern security guidance increasingly treats PKCE as valuable beyond public clients.

### 7.3 Customizing Authorization Request

You may need custom parameters:

- `prompt`,
- `login_hint`,
- `acr_values`,
- tenant hint,
- locale,
- custom IdP routing.

Be careful:

```text
Custom parameter must not become an injection path that changes issuer/client/redirect unexpectedly.
```

### 7.4 OIDC User Mapping

Spring may return an `OidcUser` with claims.

Do not blindly map:

```java
String email = oidcUser.getEmail();
```

as stable identity.

Better identity keys:

```text
issuer + subject
```

Reason:

- email can change,
- email may not be verified,
- two IdPs can issue same email,
- tenant migration can change attributes,
- username/display name not stable.

### 7.5 Session Creation

For browser login, Spring usually creates session.

You need decide:

```text
SessionCreationPolicy.IF_REQUIRED for browser login
SessionCreationPolicy.STATELESS for pure bearer API
```

Do not mix without understanding filter chain boundaries.

Common architecture:

```text
/           browser routes      -> oauth2Login + session
/api/**     API routes          -> oauth2ResourceServer + bearer token
```

But if same app handles both, ensure filter chains do not fight each other.

---

## 8. Jakarta/Spring Neutral Implementation Model

Even if using Spring or Jakarta, think in this model:

```java
record LoginAttempt(
        String state,
        String nonce,
        String codeVerifier,
        String redirectUri,
        String clientId,
        String issuer,
        String tenantId,
        String requestedPath,
        long createdAtMillis
) {}
```

Lifecycle:

```text
create -> store -> redirect -> callback -> validate -> redeem -> token validate -> session create -> delete attempt
```

Invariant:

```text
A LoginAttempt may be consumed once and only once.
```

Pseudo-flow:

```java
public RedirectResponse startLogin(HttpServletRequest request) {
    LoginAttempt attempt = loginAttemptFactory.create(request);
    loginAttemptStore.save(attempt);

    URI authorizationUri = authorizationUriBuilder.build(attempt);
    return RedirectResponse.to(authorizationUri);
}

public LoginResult finishLogin(HttpServletRequest callbackRequest) {
    String state = required(callbackRequest.getParameter("state"));
    String code = required(callbackRequest.getParameter("code"));

    LoginAttempt attempt = loginAttemptStore.consumeByState(state)
            .orElseThrow(() -> new InvalidLoginCallbackException("Unknown or expired state"));

    TokenResponse tokenResponse = tokenClient.exchangeCode(
            code,
            attempt.redirectUri(),
            attempt.codeVerifier(),
            attempt.clientId()
    );

    ValidatedIdentity identity = tokenValidator.validate(tokenResponse, attempt);
    return sessionService.createSession(identity, attempt.requestedPath());
}
```

This mental model helps debug any framework.

---

## 9. Browser and Cookie Considerations

### 9.1 Cookie Used for Local Session

For BFF/server-side pattern:

```http
Set-Cookie: APPSESSION=...; HttpOnly; Secure; SameSite=Lax; Path=/
```

Important:

- `HttpOnly` prevents normal JavaScript access.
- `Secure` requires HTTPS.
- `SameSite` helps reduce CSRF.
- `Path` and `Domain` control where cookie is sent.

### 9.2 SameSite and OIDC Redirect

`SameSite=Strict` may break login callback in some cross-site redirect situations.

`SameSite=Lax` often allows top-level GET navigation from IdP back to app.

`SameSite=None` requires `Secure` and should be used carefully when cross-site iframe/embedded flows are unavoidable.

### 9.3 CSRF with BFF

BFF using cookies must protect state-changing endpoints.

Because browser automatically sends cookies, attacker site may trigger requests.

Controls:

- SameSite cookie,
- CSRF token,
- Origin/Referer validation,
- no unsafe GET mutation,
- CORS allowlist,
- content-type restrictions.

### 9.4 CORS Misconfiguration

Bad:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

This is invalid/insecure pattern conceptually.

For credentialed BFF calls:

```text
allow only exact frontend origin
allow credentials only when necessary
never reflect Origin blindly
```

---

## 10. Failure Modes

### 10.1 Authorization Code Interception

Scenario:

```text
Attacker obtains code from redirect
Attacker tries to redeem code
```

PKCE defense:

```text
Attacker lacks code_verifier
Token endpoint rejects request
```

But if attacker also steals verifier from browser due to XSS in pure SPA, PKCE protection collapses.

### 10.2 Authorization Code Injection

Scenario:

```text
Attacker starts login with attacker's account
Attacker obtains code
Attacker injects code into victim callback
Victim app creates session for attacker's identity or links wrong account
```

Defenses:

- state validation,
- PKCE,
- nonce validation,
- login attempt correlation,
- do not accept unsolicited callback,
- account linking requires explicit authenticated confirmation.

### 10.3 Login CSRF

Victim is forced into login flow and ends up logged in as attacker.

Impact:

- victim actions recorded under attacker account,
- attacker may later observe data created by victim in attacker's account,
- account confusion.

Defenses:

- state,
- nonce,
- interaction checks for sensitive account linking,
- session rotation.

### 10.4 Open Redirect

If app supports:

```http
/login?returnUrl=https://evil.example
```

after successful login it may redirect token/session context to attacker-controlled page.

Controls:

- relative-only return URL,
- allowlist,
- canonicalize path,
- reject scheme-relative URL like `//evil.example`,
- reject encoded bypass.

### 10.5 Redirect URI Mix-Up

Multi-provider apps can confuse which provider issued response.

Example:

```text
/oidc/callback accepts response from provider A and B
state does not bind issuer/provider
app validates with wrong metadata
```

Controls:

- bind state to provider registration,
- separate redirect paths per provider or strong provider binding,
- issuer validation,
- discovery metadata isolation.

### 10.6 Code Replay

Authorization code should be one-time use.

If reused:

```text
first token request succeeds
second token request fails
```

If second succeeds, authorization server is broken or misconfigured.

Client should also consume login attempt once.

### 10.7 Session Fixation After Login

If pre-login session ID remains the same after authentication, attacker may pre-set session.

Defenses:

- rotate session ID after login,
- invalidate pre-auth state,
- separate login attempt ID from authenticated session.

### 10.8 Token Stored in Browser LocalStorage

Pure SPA often stores token in localStorage.

Risk:

- XSS reads token,
- browser extension reads data,
- token survives tab close,
- hard to revoke immediately.

PKCE does not solve this.

### 10.9 Weak Token Audience

If access token issued for API A is accepted by API B, authentication boundary fails.

Resource server must verify:

```text
audience == this API
issuer == trusted issuer
scope/role sufficient
```

### 10.10 Wrong Identity Key

Bad local account key:

```text
email
preferred_username
display_name
```

Better:

```text
issuer + subject
```

For multi-tenant:

```text
tenant + issuer + subject
```

---

## 11. Threat Model by Architecture

### 11.1 Server-Side Java Web App

Main risks:

- session fixation,
- CSRF,
- wrong redirect URI,
- stale token server-side,
- broken logout,
- bad user mapping,
- IdP outage.

Controls:

- session rotation,
- CSRF protection,
- PKCE,
- state/nonce validation,
- exact redirect URI,
- server-side token encryption/reference,
- audit login events.

### 11.2 Pure SPA

Main risks:

- XSS token theft,
- refresh token exposure,
- browser storage compromise,
- CORS misconfiguration,
- silent renew complexity,
- logout inconsistency.

Controls:

- PKCE,
- short access token lifetime,
- refresh token rotation if used,
- avoid localStorage where possible,
- strict CSP,
- dependency hygiene,
- backend token validation,
- consider BFF.

### 11.3 SPA + Java BFF

Main risks:

- CSRF against BFF,
- BFF token store compromise,
- session store compromise,
- CORS/cookie domain bug,
- scaling bottleneck,
- ambiguous end-user vs service token propagation.

Controls:

- HttpOnly Secure SameSite cookie,
- CSRF token,
- server-side token vault,
- token exchange downstream,
- session rotation,
- strict CORS,
- per-request audit principal.

---

## 12. Token Handling After PKCE

### 12.1 ID Token Is for Client, Not API Authorization

ID Token answers:

```text
Who authenticated at the IdP for this client?
```

Access token answers:

```text
What access is granted to a resource server?
```

Do not use ID Token as bearer token for backend API.

### 12.2 Access Token Storage

In BFF:

```text
server-side encrypted token store or session-associated token
```

In pure SPA:

```text
in-memory preferred over persistent storage, but refresh behavior is hard
```

In Java server-side app:

```text
store only if app needs to call downstream resource APIs
```

### 12.3 Refresh Token Strategy

Refresh tokens are high-value credentials.

For server-side/BFF:

- store server-side,
- encrypt at rest,
- rotate where supported,
- detect reuse,
- revoke on logout/security event.

For SPA:

- use refresh token rotation only if provider supports browser-based security controls,
- avoid long-lived browser-held refresh token if possible,
- consider BFF.

---

## 13. Multi-Tenant and Multi-IdP Concerns

### 13.1 Tenant Discovery

How does app know which IdP/issuer to use?

Options:

- domain-based tenant discovery,
- path-based tenant discovery,
- user input email domain,
- explicit organization selection,
- invitation link.

Risk:

```text
attacker chooses tenant context to confuse account mapping
```

Bind tenant context into login attempt.

```text
state -> tenant_id + issuer + client_id + redirect_uri
```

### 13.2 Issuer Validation

For each tenant/provider:

```text
expected issuer must match token iss
JWKS must belong to issuer
client ID/audience must match registration
```

Never validate token signature against one JWKS and ignore issuer semantics.

### 13.3 Account Linking

Dangerous flow:

```text
same email from different IdP auto-links account
```

Better:

- link by verified issuer+subject,
- require logged-in confirmation for linking,
- require admin approval for high-risk enterprise mapping,
- audit linking event.

---

## 14. Operational Observability

### 14.1 Events to Log

Log security events, not secrets.

Recommended event model:

```text
AUTH_LOGIN_STARTED
AUTH_LOGIN_REDIRECTED
AUTH_CALLBACK_RECEIVED
AUTH_STATE_VALIDATED
AUTH_CODE_EXCHANGE_STARTED
AUTH_CODE_EXCHANGE_FAILED
AUTH_TOKEN_VALIDATION_FAILED
AUTH_LOGIN_SUCCEEDED
AUTH_LOGIN_FAILED
AUTH_SESSION_CREATED
AUTH_LOGOUT_STARTED
AUTH_LOGOUT_COMPLETED
```

Fields:

```text
event_time
correlation_id
login_attempt_id
client_id
registration_id
issuer
tenant_id
result
failure_reason_code
remote_ip_hash_or_classification
user_agent_hash/classification
principal_id after validation only
```

Never log:

- authorization code,
- code verifier,
- access token,
- refresh token,
- ID token,
- client secret,
- full PII claims.

### 14.2 Debugging Callback Problems

Common symptoms:

```text
invalid_state
invalid_grant
redirect_uri_mismatch
invalid_client
invalid_request
invalid_nonce
JWT signature validation failed
issuer mismatch
audience mismatch
```

Debug sequence:

```text
1. Was login attempt created?
2. Was state saved?
3. Did browser keep correlation cookie/session?
4. Did callback return same state?
5. Did redirect_uri exactly match original?
6. Was code already used?
7. Was code_verifier found?
8. Did token endpoint reject client authentication?
9. Did ID Token nonce match?
10. Did issuer/audience match expected provider?
```

### 14.3 Metrics

Useful metrics:

```text
login_started_total
login_success_total
login_failure_total by reason
code_exchange_latency
token_endpoint_error_rate
state_mismatch_total
nonce_mismatch_total
invalid_grant_total
session_creation_total
logout_total
idp_availability
jwks_refresh_failure_total
```

---

## 15. Production Design Rules

### Rule 1 — Use Authorization Code + PKCE, Not Implicit Flow

Implicit flow exposes token through browser redirect and is no longer the preferred approach for modern browser apps.

### Rule 2 — Use `S256`, Not `plain`

`plain` exposes verifier-equivalent material in request.

### Rule 3 — Treat PKCE as Additional Binding, Not Complete Auth Security

PKCE does not replace:

- state,
- nonce,
- exact redirect URI,
- client authentication,
- token validation,
- session security,
- CSRF protection.

### Rule 4 — Prefer BFF for High-Risk Browser Apps

For enterprise/regulatory systems, BFF is often more defensible than browser-held tokens.

### Rule 5 — Never Trust Callback Without Stored Login Attempt

Unsolicited callback should fail.

### Rule 6 — Bind Login Attempt to Provider/Tenant/Redirect

State should resolve to full expected context.

### Rule 7 — Store Tokens According to Risk

High-value tokens should stay server-side where possible.

### Rule 8 — Separate Browser Session from OAuth Token Lifecycle

Local session expiration and token expiration are related but not identical.

### Rule 9 — Validate ID Token and Access Token for Their Own Purpose

Do not use ID Token as API access token.

### Rule 10 — Design Logout Explicitly

Logout may involve:

- local session invalidation,
- token revocation,
- IdP logout,
- front-channel logout,
- back-channel logout,
- downstream session cleanup.

---

## 16. Java 8–25 Considerations

### 16.1 Java 8

Common reality:

- old Spring Security versions,
- older servlet containers,
- older TLS defaults,
- less modern library ergonomics,
- many enterprise apps still on Java 8.

Guidance:

- use maintained OAuth/OIDC libraries compatible with Java 8,
- avoid hand-rolled JWT validation,
- ensure TLS/cipher config is acceptable,
- use `SecureRandom`, `MessageDigest`, `Base64.getUrlEncoder().withoutPadding()`.

### 16.2 Java 11/17

Common baseline for modern enterprise.

Advantages:

- better TLS/platform updates,
- long-term support versions,
- modern Spring Boot compatibility depending version,
- better HTTP client if needed.

### 16.3 Java 21

Relevant because many modern Java stacks standardize here.

Consider:

- virtual threads may change assumptions about thread-local context if used carelessly,
- modern Spring Security/Spring Boot support,
- better runtime performance/observability.

### 16.4 Java 25

Java 25 introduces more modern platform capabilities, including security/key material improvements in the broader JDK roadmap. For this part, the main relevance remains:

- secure random generation,
- TLS/JCA/JCE provider behavior,
- context propagation in modern concurrency,
- compatibility with framework versions that implement OAuth/OIDC flows.

Do not tie protocol correctness to Java version alone. Protocol correctness depends more on framework/library behavior and configuration than language version.

---

## 17. Implementation Checklist

### 17.1 Authorization Request Checklist

- [ ] Use `response_type=code`.
- [ ] Use PKCE `S256`.
- [ ] Generate unique `state` per login attempt.
- [ ] Generate OIDC `nonce` when using OIDC.
- [ ] Store flow context server-side if using backend/BFF.
- [ ] Bind flow to provider/tenant/client/redirect URI.
- [ ] Avoid arbitrary return URL.
- [ ] Use HTTPS redirect URI.
- [ ] Register exact redirect URI at IdP.

### 17.2 Callback Checklist

- [ ] Require `state`.
- [ ] Reject unknown/expired state.
- [ ] Consume state once.
- [ ] Validate callback registration/provider.
- [ ] Exchange code via back-channel.
- [ ] Include exact redirect URI.
- [ ] Include original code verifier.
- [ ] Do not log code/verifier.

### 17.3 Token Validation Checklist

- [ ] Validate ID Token signature.
- [ ] Validate issuer.
- [ ] Validate audience/client ID.
- [ ] Validate expiry and nbf if present.
- [ ] Validate nonce.
- [ ] Validate algorithm allowlist.
- [ ] Validate key source.
- [ ] Use issuer+subject as stable identity key.

### 17.4 Session Checklist

- [ ] Rotate session after login.
- [ ] Use `HttpOnly` cookie.
- [ ] Use `Secure` cookie.
- [ ] Use appropriate `SameSite`.
- [ ] Protect state-changing endpoints with CSRF controls.
- [ ] Set idle and absolute timeout.
- [ ] Avoid storing raw tokens in browser session cookie.

### 17.5 BFF Checklist

- [ ] Tokens stored server-side.
- [ ] Browser receives only session cookie.
- [ ] CORS restricted to exact frontend origin.
- [ ] CSRF protection enabled.
- [ ] Downstream API calls use proper access token/token exchange.
- [ ] Logout clears local session and optionally revokes tokens.
- [ ] Audit maps browser session to principal and token usage.

---

## 18. Common Mistakes

### Mistake 1 — “PKCE Means No Need for Client Secret”

PKCE is not client authentication. Confidential clients should still authenticate to token endpoint when required.

### Mistake 2 — “PKCE Makes SPA Token Storage Safe”

PKCE protects code redemption. It does not protect tokens stored in browser from XSS.

### Mistake 3 — “State and PKCE Are the Same”

They bind different things.

### Mistake 4 — “ID Token Can Be Used as API Bearer Token”

Wrong token purpose. API should require access token.

### Mistake 5 — “JWT Decode Equals Validate”

Decoding only reads data. Validation checks trust.

### Mistake 6 — “Email Is Stable User ID”

Use issuer + subject.

### Mistake 7 — “Redirect URI Prefix Matching Is Fine”

It is dangerous. Use exact match.

### Mistake 8 — “OAuth Login Is Stateless”

Authorization Code Flow requires transient state at least during login. BFF/server-side login usually creates local session.

### Mistake 9 — “Logout Is Just Delete Cookie”

Sometimes enough for local logout, but not for federated/session/token logout requirements.

### Mistake 10 — “Framework Configuration Replaces Threat Modeling”

Framework handles mechanics. You still own trust boundaries and policy.

---

## 19. Design Questions for Real Projects

Use these questions during architecture review:

1. Is the browser an OAuth client or only a session client?
2. Where is the `code_verifier` stored?
3. Where are access/refresh tokens stored?
4. Is PKCE using `S256`?
5. Is `state` random, one-time, and server-bound?
6. Is OIDC `nonce` validated?
7. Is redirect URI exact-match registered?
8. Does callback bind to provider/tenant/client?
9. What is the stable local user key?
10. Is email used only as attribute, not identity key?
11. Are sessions rotated after login?
12. Are cookies `HttpOnly`, `Secure`, and correctly `SameSite`?
13. Are state-changing BFF endpoints CSRF-protected?
14. Does API validate access token audience?
15. Are ID Token and Access Token used for correct purposes?
16. What happens if IdP token endpoint is down?
17. What happens if JWKS refresh fails?
18. What happens if login callback arrives twice?
19. What happens if user opens login in two tabs?
20. How is logout propagated?
21. How are auth failures logged without secrets?
22. Can support/audit reconstruct login event chain?
23. How are tenant-specific issuers validated?
24. How is account linking controlled?
25. What is the incident response if refresh tokens leak?

---

## 20. Capstone Example: SPA + Java BFF for Enterprise Portal

### 20.1 Requirement

A Vue/React SPA should authenticate users through enterprise IdP. Backend APIs are Java Spring Boot services. Security team does not want OAuth tokens in browser storage.

### 20.2 Recommended Shape

```text
Browser SPA
  -> Java BFF over same-site HTTPS
  -> Authorization Server via Authorization Code + PKCE
  -> Downstream APIs with server-side access token
```

### 20.3 Flow

```text
1. Browser GET /dashboard
2. BFF sees no session
3. BFF creates login attempt: state, nonce, code_verifier
4. BFF redirects browser to IdP authorize endpoint with code_challenge
5. User authenticates at IdP
6. IdP redirects browser to BFF callback with code/state
7. BFF validates state
8. BFF exchanges code + code_verifier at token endpoint
9. BFF validates ID Token nonce/issuer/audience/signature
10. BFF maps issuer+subject to local principal
11. BFF creates session and rotates session ID
12. Browser receives HttpOnly Secure SameSite cookie
13. Browser calls BFF APIs using cookie
14. BFF calls downstream APIs with access token or token exchange
```

### 20.4 Security Controls

```text
PKCE S256
state one-time
nonce validation
exact redirect URI
issuer validation
JWKS cache with safe refresh
HttpOnly Secure SameSite cookie
CSRF token for mutation
strict CORS
server-side token store
audit events
session rotation
logout invalidation
```

### 20.5 Failure Handling

| Failure | Handling |
|---|---|
| state mismatch | reject callback, log security event |
| code exchange invalid_grant | reject login, do not retry blindly |
| nonce mismatch | reject login, possible replay/injection |
| issuer mismatch | reject token |
| JWKS unavailable | use cached key if valid policy allows; otherwise fail closed |
| token endpoint down | login temporarily unavailable |
| callback replay | reject because state consumed/code used |
| downstream API token expired | refresh server-side or require re-login depending policy |

---

## 21. Summary

Authorization Code + PKCE adalah flow inti untuk login modern berbasis OAuth/OIDC. Tetapi untuk menjadi engineer yang benar-benar kuat, pahami bahwa flow ini terdiri dari beberapa binding berbeda:

```text
state  -> binds callback to browser/session login attempt
nonce  -> binds ID Token to OIDC authentication request
PKCE   -> binds authorization code redemption to original client instance
redirect_uri -> binds code to registered callback endpoint
client authentication -> authenticates confidential client to token endpoint
token validation -> turns token artifact into trusted identity/access decision
local session -> turns federated authentication into app continuity
```

PKCE menyelesaikan authorization code interception class, tetapi tidak menyelesaikan seluruh browser security problem. Untuk high-risk Java web systems, terutama enterprise/regulatory system, pattern SPA + Java BFF sering lebih defensible daripada browser-held tokens.

Top 1% mental model:

> Login bukan satu event. Login adalah rangkaian state transition yang harus mempertahankan identity, client, tenant, issuer, redirect, token, dan session invariants dari awal sampai akhir.

Jika satu invariant hilang, authentication flow dapat berubah menjadi account confusion, token theft, login CSRF, open redirect, confused deputy, atau audit failure.

---

## 22. Referensi Utama

- RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients.
- RFC 6749 — The OAuth 2.0 Authorization Framework.
- RFC 9700 — OAuth 2.0 Security Best Current Practice.
- OpenID Connect Core 1.0.
- OAuth 2.0 for Browser-Based Applications draft.
- Spring Security OAuth2 Client and Login Reference.
- Spring Authorization Server PKCE guide.
- OWASP Session Management Cheat Sheet.
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet.
- OWASP HTML5 Security Cheat Sheet.

---

## 23. Status Series

Part 15 selesai.

Series belum selesai.

Berikutnya:

**Part 16 — Client Credentials and Machine-to-Machine Authentication**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-014.md">⬅️ Part 14 — OpenID Connect: Authentication on Top of OAuth 2.0</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-016.md">Part 16 — Client Credentials and Machine-to-Machine Authentication ➡️</a>
</div>
