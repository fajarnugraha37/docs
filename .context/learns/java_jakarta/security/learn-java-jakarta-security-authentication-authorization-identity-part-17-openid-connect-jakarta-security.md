# Part 17 — OpenID Connect in Jakarta Security

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-17-openid-connect-jakarta-security.md`  
> Target: Java 8 sampai Java 25, Java EE/Jakarta EE, Servlet/JAX-RS/CDI/Jakarta Security, enterprise identity, SSO, dan production-grade login architecture.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas:

1. mental model enterprise Java security,
2. vocabulary identity/principal/subject/role/permission,
3. sejarah JAAS/JASPIC/JACC/Jakarta Security,
4. container security,
5. Servlet security,
6. authentication mechanisms,
7. Jakarta Security core API,
8. `SecurityContext`,
9. `IdentityStore`,
10. credential handling,
11. Jakarta Authentication/JASPIC,
12. Jakarta Authorization/JACC,
13. declarative authorization,
14. programmatic/domain authorization,
15. roles/groups/claims/scopes mapping,
16. session security,
17. token-based security.

Part ini masuk ke **OpenID Connect** atau **OIDC** sebagai mekanisme login modern yang paling umum dipakai pada enterprise web application.

Kita tidak akan mengulang semua detail OAuth2 dan JWT dari Part 16. Fokus part ini adalah:

- bagaimana OIDC bekerja sebagai **authentication protocol**,
- bagaimana Jakarta Security mendukung OIDC,
- bagaimana authorization code flow, PKCE, state, nonce, discovery, JWKS, ID token, UserInfo, dan logout saling berhubungan,
- bagaimana claim dari IdP berubah menjadi caller principal dan group di Jakarta application,
- bagaimana merancang OIDC integration yang aman, portabel, dan debuggable.

---

## 1. The Core Mental Model

OpenID Connect adalah **identity layer di atas OAuth 2.0**.

Kalimat ini penting.

OAuth2 sendiri menjawab pertanyaan:

> “Apakah client ini boleh mendapatkan access token untuk mengakses resource tertentu?”

OIDC menjawab pertanyaan tambahan:

> “Siapa end-user yang berhasil diautentikasi oleh identity provider, dan bagaimana relying party dapat memverifikasi fakta itu?”

Dalam konteks Jakarta application:

```text
Browser/User
    |
    | 1. akses protected resource
    v
Jakarta Application / Relying Party / OIDC Client
    |
    | 2. redirect ke OpenID Provider
    v
OpenID Provider / Identity Provider
    |
    | 3. user login, MFA, consent, session IdP
    v
Jakarta Application callback endpoint
    |
    | 4. tukar authorization code ke token endpoint
    v
Jakarta Application validates ID token
    |
    | 5. establish caller principal + groups + app session
    v
Protected business operation
```

Terminologi utama:

| Istilah | Makna |
|---|---|
| End-user | manusia yang login |
| User agent | browser milik user |
| Relying Party / RP | aplikasi yang mempercayai OpenID Provider |
| Client | aplikasi terdaftar di IdP; dalam konteks OIDC web app biasanya sama dengan RP |
| OpenID Provider / OP | IdP yang mengautentikasi user dan menerbitkan ID token |
| Authorization server | komponen OAuth2 yang menerbitkan token |
| ID token | token OIDC yang menyatakan hasil authentication user |
| Access token | token OAuth2 untuk akses API/resource server |
| Refresh token | token untuk memperoleh access token baru |
| Authorization code | kode sementara yang ditukar server-side menjadi token |
| Redirect URI | endpoint callback aplikasi setelah user login di IdP |
| Scope `openid` | scope wajib untuk request OIDC |
| Claim | attribute dalam ID token/UserInfo/access token |
| Subject / `sub` | stable identifier user menurut issuer tertentu |

Mental model paling aman:

```text
OIDC login is not “the app asks the IdP for a username”.
OIDC login is “the app receives a signed assertion that a user authenticated at a trusted issuer, under specific protocol constraints”.
```

Artinya aplikasi tidak boleh hanya melihat `email`, `preferred_username`, atau `name`. Aplikasi harus memvalidasi protokol dan token secara benar.

---

## 2. OIDC Dalam Jakarta Security

Jakarta Security menyediakan abstraction untuk authentication mechanism di aplikasi Jakarta EE. Dalam OIDC, aplikasi Jakarta bertindak sebagai **Relying Party** atau **OIDC client**.

Secara konseptual, Jakarta Security OIDC mechanism melakukan beberapa hal:

1. Mendeteksi request ke protected resource.
2. Membuat authorization request ke OpenID Provider.
3. Menyimpan state/nonce/correlation data.
4. Redirect browser ke authorization endpoint.
5. Menerima callback dari IdP.
6. Memvalidasi `state`.
7. Menukar authorization code ke token endpoint.
8. Memvalidasi ID token.
9. Mengambil/memap claim.
10. Membentuk authenticated caller.
11. Menyediakan principal/groups ke container.
12. Membiarkan Servlet/JAX-RS/CDI/EJB authorization bekerja dengan caller tersebut.

Di Jakarta Security API, OIDC tersedia melalui definisi annotation seperti:

```java
@OpenIdAuthenticationMechanismDefinition(
    providerURI = "https://idp.example.com/realms/acme",
    clientId = "jakarta-app",
    clientSecret = "${oidc.client.secret}",
    redirectURI = "${baseURL}/callback",
    scope = {"openid", "profile", "email"}
)
```

Bentuk persis parameter dapat berbeda tergantung versi API/container, tetapi ide desainnya sama:

- provider/issuer metadata,
- client credentials,
- redirect URI,
- scope,
- claim mapping,
- logout configuration,
- optional behavior untuk UserInfo, response mode, prompt, display, dan sebagainya.

Important distinction:

```text
Jakarta Security OIDC mechanism authenticates the browser user into the Jakarta application.
It is not automatically a full OAuth2 resource-server solution for every API call.
```

Untuk browser login berbasis session, OIDC mechanism biasanya cocok.

Untuk stateless API bearer token validation, biasanya lebih cocok:

- JAX-RS filter,
- Servlet filter,
- MicroProfile JWT,
- custom Jakarta Authentication ServerAuthModule,
- API gateway + application-side verification,
- atau framework-specific resource server support.

---

## 3. OIDC Is Authentication, OAuth2 Is Delegated Authorization

Kesalahan besar yang sering terjadi:

> “OAuth2 login.”

OAuth2 bukan login protocol. OAuth2 adalah authorization framework. OIDC menambahkan identity/authentication layer.

Perbedaannya:

| Aspek | OAuth2 | OpenID Connect |
|---|---|---|
| Tujuan utama | delegated access | user authentication |
| Token utama | access token | ID token + access token |
| Scope wajib | tidak ada `openid` | harus request `openid` |
| Identitas user | bukan tujuan utama | direpresentasikan oleh `sub` dan claims |
| Client memverifikasi login user | tidak standar | ya, melalui ID token |
| Discovery standardized | OAuth2 punya metadata sendiri, OIDC discovery umum dipakai | OIDC discovery penting |

Dalam Jakarta application:

- login browser user → OIDC,
- akses API atas nama user → OAuth2 access token,
- internal service call → OAuth2 client credentials/token exchange/mTLS,
- authorization bisnis → role/permission/domain policy aplikasi.

Jangan jadikan OIDC sebagai pengganti seluruh authorization domain.

OIDC menjawab:

```text
Who authenticated at the trusted issuer?
```

Authorization aplikasi menjawab:

```text
Given this actor, tenant, role, state, and resource relationship, may this action happen now?
```

---

## 4. Authorization Code Flow: Flow Utama Untuk Server-Side Jakarta Web App

Untuk aplikasi Jakarta yang berjalan server-side, flow yang paling umum dan aman adalah **Authorization Code Flow**.

High-level flow:

```text
1. Browser requests /case-management
2. Jakarta app sees unauthenticated request
3. App creates OIDC authorization request
4. Browser redirected to IdP
5. User authenticates at IdP
6. IdP redirects browser to app callback with authorization code
7. App validates state
8. App sends code to token endpoint server-to-server
9. IdP returns ID token, access token, maybe refresh token
10. App validates ID token
11. App creates local authenticated session
12. User accesses /case-management as authenticated caller
```

Text sequence:

```text
Browser              Jakarta App                  OpenID Provider
   |                      |                              |
   | GET /secure          |                              |
   |--------------------->|                              |
   |                      | create state + nonce         |
   |                      | store in session             |
   | 302 authorization    |                              |
   |<---------------------|                              |
   | GET /authorize?client_id&state&nonce&scope=openid   |
   |----------------------------------------------------->|
   |                      |                              | authenticate user
   |                      |                              | create code
   | 302 /callback?code&state                            |
   |<-----------------------------------------------------|
   | GET /callback?code&state                            |
   |--------------------->|                              |
   |                      | validate state               |
   |                      | POST /token code             |
   |                      |----------------------------->|
   |                      | ID token + access token      |
   |                      |<-----------------------------|
   |                      | validate ID token            |
   |                      | establish caller/session     |
   | 302 original URL     |                              |
   |<---------------------|                              |
```

Why Authorization Code Flow is preferred for Jakarta server apps:

1. Client secret stays on server.
2. Token exchange happens server-to-server.
3. Browser does not need to receive token directly.
4. Local session can be used after authentication.
5. Token storage can be controlled server-side.
6. Better fit with Servlet/Jakarta Security container model.

---

## 5. PKCE: Why Server-Side Apps Should Care Too

PKCE stands for **Proof Key for Code Exchange**.

Original motivation: public clients such as mobile apps and SPAs cannot safely store client secret.

But modern best practice increasingly uses PKCE even for confidential clients because it protects against authorization code interception.

PKCE adds:

- `code_verifier`: high-entropy random secret generated by client/app,
- `code_challenge`: transformed value sent in authorization request,
- `code_challenge_method`: usually `S256`,
- token endpoint later requires `code_verifier`.

Flow:

```text
App creates code_verifier
App computes code_challenge = BASE64URL(SHA256(code_verifier))
App redirects to IdP with code_challenge
IdP stores challenge with authorization code
App receives code
App sends code + code_verifier to token endpoint
IdP verifies that verifier matches earlier challenge
```

Security property:

```text
An attacker who steals only the authorization code cannot redeem it without the code_verifier.
```

For Jakarta apps:

- store `code_verifier` server-side, usually in session or temporary correlation store,
- bind it to `state`,
- clear it after callback,
- use `S256`, not `plain`, unless forced by legacy IdP.

Common bug:

```text
Generating PKCE verifier, but not binding it to the same login transaction as state/nonce.
```

Better model:

```text
login_transaction_id -> {
  state,
  nonce,
  code_verifier,
  original_url,
  created_at,
  issuer,
  client_id
}
```

---

## 6. `state`: CSRF Protection For OIDC Login

`state` is a correlation value sent in the authorization request and returned in callback.

It protects against login CSRF and response injection.

Basic rule:

```text
Callback state must match a state value generated by this app for this browser session/login transaction.
```

Flow:

```text
App generates random state: s123
App stores s123 in session/correlation store
App redirects browser to IdP with state=s123
IdP redirects back with state=s123
App compares returned state with stored state
```

If state mismatch:

```text
Reject callback.
Do not create session.
Do not partially login user.
Log secure correlation event.
```

State must be:

- random,
- high entropy,
- single-use,
- time-limited,
- bound to login transaction,
- not guessable,
- not reused across tabs indefinitely.

Bad state handling:

```java
String state = "fixed";
```

```java
String state = userId;
```

```java
String state = redirectUrl;
```

Better state object:

```java
record OidcLoginTransaction(
    String state,
    String nonce,
    String codeVerifier,
    URI originalUrl,
    Instant createdAt,
    String issuer,
    String clientId
) {}
```

Do not put sensitive values directly into state unless encrypted/signed. Usually state is just an opaque correlation key.

---

## 7. `nonce`: Binding ID Token To Login Request

`nonce` protects against token replay/substitution in OIDC authentication.

The app sends nonce in authorization request. The OpenID Provider includes the nonce in the ID token. The app validates that ID token nonce equals the stored nonce for that login transaction.

Flow:

```text
App generates nonce n123
App sends nonce=n123 to authorization endpoint
IdP authenticates user and issues ID token containing nonce=n123
App validates ID token nonce equals n123
```

Why this matters:

- state binds callback response to browser/app transaction,
- nonce binds ID token to authentication request.

State and nonce are related but not the same.

| Value | Protects against | Returned where |
|---|---|---|
| state | CSRF/response injection/callback confusion | authorization response query/form |
| nonce | ID token replay/substitution | ID token claim |

Common bug:

```text
Validating state but ignoring nonce.
```

Another common bug:

```text
Using same value for state and nonce forever.
```

A pragmatic implementation may generate separate random values and bind both in one login transaction.

---

## 8. Discovery Document and Provider Metadata

OIDC Discovery allows the application to retrieve provider metadata from a standard endpoint.

Typical URL:

```text
https://idp.example.com/realms/acme/.well-known/openid-configuration
```

The metadata commonly contains:

```json
{
  "issuer": "https://idp.example.com/realms/acme",
  "authorization_endpoint": "https://idp.example.com/realms/acme/protocol/openid-connect/auth",
  "token_endpoint": "https://idp.example.com/realms/acme/protocol/openid-connect/token",
  "userinfo_endpoint": "https://idp.example.com/realms/acme/protocol/openid-connect/userinfo",
  "jwks_uri": "https://idp.example.com/realms/acme/protocol/openid-connect/certs",
  "end_session_endpoint": "https://idp.example.com/realms/acme/protocol/openid-connect/logout",
  "response_types_supported": ["code"],
  "subject_types_supported": ["public", "pairwise"],
  "id_token_signing_alg_values_supported": ["RS256"]
}
```

Why discovery matters:

1. Avoids hardcoding every endpoint.
2. Lets provider publish supported algorithms and features.
3. Enables key discovery through `jwks_uri`.
4. Reduces config drift.
5. Makes issuer verification explicit.

But discovery must be used carefully.

Dangerous pattern:

```text
Accept any providerURI submitted by user at runtime and trust its discovery metadata.
```

That creates dynamic issuer trust and can lead to authentication bypass.

Better pattern:

```text
Allowed issuers are configured explicitly.
Discovery is used only for those trusted issuers.
```

For multi-tenant/multi-IdP apps:

```text
tenant_id -> trusted issuer config -> discovery metadata -> validation rules
```

Never derive issuer trust solely from request parameter.

---

## 9. JWKS and ID Token Signature Validation

ID tokens are usually JWTs signed by the OpenID Provider.

The app validates signature using keys from the provider’s JWKS endpoint.

JWKS means **JSON Web Key Set**.

Typical JWKS shape:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "abc123",
      "use": "sig",
      "alg": "RS256",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

Validation flow:

```text
Read ID token header
Extract alg and kid
Find matching key in trusted issuer's JWKS
Verify signature
Validate claims
Establish caller only after all validation passes
```

Do not just decode JWT payload.

Bad pattern:

```java
String payload = new String(Base64.getUrlDecoder().decode(parts[1]));
// trust email from payload
```

That is not validation.

Minimum ID token validation checklist:

| Check | Why |
|---|---|
| signature valid | token came from holder of trusted private key |
| `alg` allowed | prevent algorithm confusion |
| `kid` from trusted JWKS | select correct key |
| `iss` exactly expected issuer | prevent foreign issuer tokens |
| `aud` contains client id | token is intended for this app |
| `azp` if applicable | authorized party check for multi-audience token |
| `exp` in future | token not expired |
| `iat` reasonable | token not suspiciously old/future |
| `nbf` if present | token not used before valid time |
| `nonce` matches | token belongs to this login flow |
| `sub` present | stable subject exists |
| token type/context | do not accept access token as ID token |

JWKS caching considerations:

- cache keys to avoid calling JWKS endpoint on every login,
- respect HTTP cache headers if available,
- refresh on unknown `kid`,
- do not refresh infinitely per request,
- rate-limit JWKS refresh,
- handle key rotation gracefully,
- fail closed if signature cannot be verified.

Failure model:

```text
Provider rotates signing key.
App cache does not refresh.
All logins fail.
```

Better behavior:

```text
If kid unknown:
  perform bounded JWKS refresh once
  retry key lookup
  if still missing, reject and emit operational alert
```

---

## 10. ID Token vs Access Token vs UserInfo

OIDC commonly gives the application:

- ID token,
- access token,
- sometimes refresh token.

They have different meanings.

| Artifact | Primary purpose | Should Jakarta app use for login? | Should API use for authorization? |
|---|---|---:|---:|
| ID token | proves user authentication to client/RP | yes | generally no |
| Access token | authorizes access to resource server | no, not as login proof | yes |
| Refresh token | obtains new access token | no | no direct API use |
| UserInfo response | additional user claims | optional/enrichment | no |

Important rule:

```text
Use ID token to authenticate the user into the client application.
Use access token to call APIs/resources.
Do not use ID token as API bearer authorization token.
```

Why?

- ID token audience is usually the client application.
- Access token audience should be the API/resource server.
- ID token claims may not represent API authorization.
- Resource server validation rules differ.

UserInfo endpoint:

- can provide claims not included in ID token,
- requires access token,
- should be called only against trusted issuer’s UserInfo endpoint,
- response should be associated with the already validated subject,
- `sub` from UserInfo should match ID token `sub` if both used.

Common bug:

```text
Validate ID token for user A, call UserInfo, then trust UserInfo for user B because sub mismatch is not checked.
```

Correct invariant:

```text
ID token sub == UserInfo sub
```

---

## 11. Subject Identifier: Why `sub` Beats Email

In OIDC, the most important user identifier is usually:

```text
issuer + subject
```

Not email.

Why not email?

- email can change,
- email may be unverified,
- email may be reused after account deletion depending on provider,
- user may have multiple emails,
- enterprise IdP may expose different email aliases,
- email uniqueness may be scoped differently.

Better application identity key:

```text
external_identity_key = issuer + ":" + sub
```

Example database model:

```sql
create table external_identity (
    id bigint primary key,
    user_account_id bigint not null,
    issuer varchar(500) not null,
    subject varchar(500) not null,
    provider_name varchar(100) not null,
    created_at timestamp not null,
    last_seen_at timestamp,
    unique (issuer, subject)
);
```

Application user account:

```sql
create table app_user_account (
    id bigint primary key,
    display_name varchar(200),
    primary_email varchar(320),
    status varchar(50) not null,
    created_at timestamp not null
);
```

This allows:

- one local app account linked to multiple external identities,
- IdP migration,
- account linking,
- blocking local account without deleting external identity,
- preserving audit actor id even if email changes.

OIDC subject types:

| Subject type | Meaning |
|---|---|
| public | same `sub` for a user across clients under same issuer |
| pairwise | different `sub` per sector/client grouping |

If provider uses pairwise subject, do not expect the same user to have identical `sub` across all applications.

---

## 12. Claim Mapping Into Jakarta Principal and Groups

OIDC claims may include:

```json
{
  "iss": "https://idp.example.com/realms/acme",
  "sub": "248289761001",
  "aud": "jakarta-app",
  "preferred_username": "fajar",
  "email": "fajar@example.com",
  "email_verified": true,
  "name": "Fajar Abdi Nugraha",
  "groups": ["case-officer", "appeal-reviewer"],
  "realm_access": {
    "roles": ["admin", "officer"]
  },
  "resource_access": {
    "jakarta-app": {
      "roles": ["case-read", "case-approve"]
    }
  }
}
```

A Jakarta application needs to decide:

1. What becomes caller principal name?
2. What becomes groups/roles visible to `isCallerInRole()` or `@RolesAllowed`?
3. What becomes domain identity attributes?
4. What is only display/profile data?
5. What is not trusted for authorization?

Recommended mapping layers:

```text
OIDC validated token
    -> external identity: issuer + sub
    -> local account: app_user_account.id
    -> caller principal: stable application actor principal
    -> container groups: coarse application roles
    -> domain permission engine: fine-grained decisions
```

Do not map raw claims directly everywhere.

Bad pattern:

```java
if (claims.get("department").equals("Enforcement")) {
    approveCase();
}
```

Better pattern:

```java
Actor actor = actorResolver.fromValidatedOidcPrincipal(securityContext);
CaseResource resource = caseRepository.get(caseId);
authorizationService.require(actor, Action.APPROVE_CASE, resource);
```

Where claim mapping is centralized:

```java
public final class OidcActorMapper {
    public Actor map(ValidatedOidcIdentity identity) {
        ExternalIdentityKey key = new ExternalIdentityKey(
            identity.issuer(),
            identity.subject()
        );

        AppAccount account = accountDirectory.resolveOrProvision(key, identity.claims());

        return new Actor(
            account.id(),
            key,
            account.status(),
            resolveApplicationRoles(identity, account),
            resolveTenantMembership(identity, account)
        );
    }
}
```

---

## 13. Jakarta Security OIDC Configuration Mental Model

A production OIDC configuration should answer these questions:

| Question | Example |
|---|---|
| Who is the trusted issuer? | `https://idp.example.com/realms/acme` |
| What client id identifies this Jakarta app? | `aceas-web` |
| Is this app confidential or public? | confidential web app |
| Where is the callback endpoint? | `/oidc/callback` |
| What scopes are requested? | `openid profile email` |
| Does the app use PKCE? | yes |
| Which claims form principal name? | `sub`, or mapped local user id |
| Which claim provides groups? | provider-specific groups/roles claim |
| Does app call UserInfo? | only if extra claims needed |
| What is logout behavior? | local + optional RP-initiated OP logout |
| What is session timeout? | app-specific idle/absolute limits |
| What if IdP unavailable? | fail login, keep existing session only if policy allows |

Example conceptual annotation:

```java
@ApplicationScoped
@OpenIdAuthenticationMechanismDefinition(
    providerURI = "${oidc.provider.uri}",
    clientId = "${oidc.client.id}",
    clientSecret = "${oidc.client.secret}",
    redirectURI = "${oidc.redirect.uri}",
    scope = {"openid", "profile", "email"},
    claimsDefinition = @ClaimsDefinition(
        callerNameClaim = "sub",
        callerGroupsClaim = "groups"
    ),
    logout = @LogoutDefinition(
        notifyProvider = true,
        redirectURI = "${oidc.post.logout.redirect.uri}"
    )
)
public class SecurityConfiguration {
}
```

Treat this as conceptual, because container versions and exact annotation members can vary. Always verify against the Jakarta Security API version and your target server.

Configuration invariants:

```text
issuer is explicit
client id is exact
redirect URI is exact
secret comes from secret manager
state/nonce are generated by mechanism/app
claims mapping is centralized
logout behavior is intentional
```

---

## 14. Redirect URI Security

Redirect URI is one of the most sensitive OIDC settings.

It is where the IdP sends authorization code after successful login.

Rules:

1. Register exact redirect URIs at IdP.
2. Avoid wildcard redirect URI.
3. Use HTTPS in production.
4. Do not let arbitrary `redirect_uri` be controlled by user.
5. Keep callback endpoint dedicated and minimal.
6. Validate `state` before token exchange.
7. Do not expose authorization code in logs.
8. After callback, redirect only to safe original URL.

Open redirect risk:

```text
/login?returnUrl=https://evil.example.com
```

If your app stores this and redirects user after login, attacker can abuse trusted login domain for phishing or token leakage in some flows.

Better original URL handling:

```java
boolean isSafeRelativePath(String value) {
    return value != null
        && value.startsWith("/")
        && !value.startsWith("//")
        && !value.contains("\\")
        && !value.contains("%5c");
}
```

Store only relative paths:

```text
/case/123
/dashboard
/profile
```

Avoid storing full external URLs unless you have strict allowlist.

---

## 15. Login Transaction Store

OIDC login is not a single request. It spans:

1. initial protected request,
2. redirect to IdP,
3. callback request.

The app needs correlation state.

For simple Servlet app, `HttpSession` can store login transaction.

For clustered apps, ensure session is sticky or replicated, or store transaction in distributed cache.

Model:

```java
public final class OidcLoginTransactionStore {
    public void create(HttpServletRequest request, OidcLoginTransaction tx) {
        request.getSession(true).setAttribute("OIDC_TX_" + tx.state(), tx);
    }

    public Optional<OidcLoginTransaction> consume(HttpServletRequest request, String state) {
        HttpSession session = request.getSession(false);
        if (session == null) return Optional.empty();

        String key = "OIDC_TX_" + state;
        OidcLoginTransaction tx = (OidcLoginTransaction) session.getAttribute(key);
        if (tx != null) {
            session.removeAttribute(key);
        }
        return Optional.ofNullable(tx);
    }
}
```

Important properties:

- consume state once,
- expire old login transactions,
- tolerate multiple tabs by storing multiple transactions,
- avoid overwriting single global `state` value,
- log mismatch with correlation id, not token/code.

Common multi-tab bug:

```text
Tab A starts login -> state A stored
Tab B starts login -> state B overwrites state A
Tab A callback returns -> state mismatch
```

Better:

```text
store transactions by state key, not single session slot
```

---

## 16. Session Creation After OIDC Login

After successful OIDC validation, the Jakarta app usually creates a local application session.

This is a major architectural decision:

```text
OIDC authentication proves identity at login time.
Application session represents local login state after that.
```

Recommended post-login session contents:

```java
record AuthenticatedSession(
    long appAccountId,
    String issuer,
    String subject,
    String displayName,
    Set<String> applicationRoles,
    Set<String> tenantMemberships,
    Instant authenticatedAt,
    Instant lastRoleRefreshAt,
    String authenticationMethod,
    String idpSessionId
) {}
```

Avoid storing:

- raw ID token unless needed,
- refresh token unless absolutely needed,
- excessive claims,
- large profile object,
- sensitive PII,
- mutable authorization snapshot without refresh strategy.

Session fixation protection:

```text
Before/after establishing authenticated session, rotate session id.
```

Servlet API supports session id change through `changeSessionId()` in modern Servlet versions.

High-level flow:

```java
request.changeSessionId();
request.getSession().setAttribute("AUTH_SESSION", authenticatedSession);
```

If the Jakarta Security mechanism/container handles session establishment, understand whether it rotates session id and how it stores principal.

---

## 17. OIDC Login Does Not Eliminate Local Account Model

Many apps need a local account model even with OIDC.

Why?

- user status: active/suspended/deleted,
- local preferences,
- audit identity,
- tenant membership,
- application-specific roles,
- delegated permissions,
- data ownership,
- lifecycle independent from IdP,
- break-glass/admin policy,
- account linking/migration.

Possible provisioning strategies:

| Strategy | Description | Use case |
|---|---|---|
| Just-in-time provisioning | create local account on first successful login | internal apps with trusted IdP |
| Pre-provisioning | user must exist locally before login accepted | regulated apps |
| Hybrid | create shadow identity but require approval/role assignment | semi-open enterprise portal |
| External-only | no local account, claims drive everything | simple apps, often risky for complex systems |

Recommended for enterprise case/workflow systems:

```text
OIDC authenticates external identity.
Local account controls application eligibility and lifecycle.
Domain authorization controls actions.
```

Post-login decision:

```text
validated issuer+sub
    -> find external_identity
    -> find local account
    -> check local account status
    -> check tenant membership
    -> map app roles
    -> create session
```

If local account suspended:

```text
Authentication succeeded at IdP, but application login denied.
Return 403-like application access denied, not invalid credential.
Audit as app-level login denied.
```

---

## 18. Claim Freshness and Role Refresh

A common production problem:

```text
User logs in at 09:00 with admin role.
Admin role removed at 10:00.
User session still has admin role until 18:00.
```

OIDC login gives claims at a point in time. The app must decide freshness policy.

Options:

| Strategy | Behavior | Trade-off |
|---|---|---|
| Snapshot at login | roles fixed until logout/session expiry | simple, stale privilege risk |
| Refresh periodically | app re-checks roles every N minutes | balanced |
| Check IdP/UserInfo per request | fresh but slow/fragile | high coupling, latency |
| Use local role store | IdP only identity, app owns roles | better for complex apps |
| Event-driven revocation | IdP sends events/back-channel | robust but more complex |

Recommended for complex Jakarta apps:

```text
Use OIDC for authentication.
Use app-side role/permission model for critical authorization.
Set short/controlled session lifetime.
Refresh external claims intentionally if used.
```

Role freshness invariant:

```text
No high-risk permission should rely solely on stale browser session claims without expiry or revalidation policy.
```

Step-up strategy:

For high-risk action:

- require recent authentication time,
- check `auth_time` claim if available,
- trigger prompt/login again if authentication too old,
- require MFA at IdP if supported through `acr`/`amr`/policy.

---

## 19. `auth_time`, `acr`, and `amr`

OIDC can include authentication context information.

Common claims:

| Claim | Meaning |
|---|---|
| `auth_time` | time when user authentication occurred |
| `acr` | authentication context class reference |
| `amr` | authentication methods references |

Example:

```json
{
  "sub": "248289761001",
  "auth_time": 1760000000,
  "acr": "urn:mfa:required",
  "amr": ["pwd", "otp"]
}
```

Use cases:

- sensitive approval requires login within last 15 minutes,
- admin console requires MFA,
- payment/decision action requires higher assurance,
- user profile change requires reauthentication.

Do not blindly trust `acr/amr` unless:

- issuer is trusted,
- token validated,
- semantics agreed with IdP team,
- expected values are documented,
- IdP policy really enforces those values.

Step-up flow idea:

```text
User tries high-risk action
App checks session.authenticatedAt/auth_time/acr
If insufficient:
  redirect to OIDC authorization endpoint with prompt=login or acr_values=...
After return:
  validate nonce/state
  update session authentication strength
Continue action
```

This is where generic `@RolesAllowed("ADMIN")` is insufficient. You need domain-aware authorization plus authentication freshness.

---

## 20. Multiple IdPs

Enterprise systems often have multiple identity providers:

- internal staff IdP,
- external company user IdP,
- government digital identity provider,
- partner IdP,
- admin emergency IdP,
- legacy SAML bridged to OIDC.

Multi-IdP routing model:

```text
Request context -> tenant/realm/user type -> issuer selection -> OIDC flow
```

Examples:

```text
/admin/*       -> internal staff IdP
/portal/*      -> external user IdP
/api/internal  -> service auth, not browser OIDC
```

Danger:

```text
Let user submit arbitrary issuer URL.
```

Better:

```java
Map<String, OidcProviderConfig> trustedProviders = Map.of(
    "staff", staffProvider,
    "external", externalProvider,
    "partner-a", partnerAProvider
);
```

Login URL:

```text
/login?provider=staff
```

Validation:

```text
provider key must exist in trusted provider registry
issuer in ID token must exactly match configured issuer
client id/audience must match provider-specific client
claim mapping is provider-specific
```

Multi-IdP identity key:

```text
issuer + subject
```

Never key only by `sub`, because two issuers can produce the same subject string.

---

## 21. Account Linking

Account linking means connecting an external identity to an existing local account.

Example:

```text
Local account #1001 belongs to Fajar.
Old IdP subject: https://old-idp :: abc
New IdP subject: https://new-idp :: xyz
Both should map to same app account.
```

Risks:

- attacker links their IdP account to victim local account,
- email-based linking causes takeover,
- admin manually links wrong account,
- duplicate accounts created,
- audit identity becomes ambiguous.

Safe linking principles:

1. Existing session must be strongly authenticated.
2. New external identity must be authenticated.
3. Link action must require explicit confirmation/admin workflow if high-risk.
4. Unique `(issuer, sub)` constraint must exist.
5. Audit before/after state.
6. Never auto-link solely by unverified email.
7. For verified email auto-link, still consider organization/tenant constraints.

Link table:

```sql
create table external_identity_link (
    id bigint primary key,
    app_account_id bigint not null,
    issuer varchar(500) not null,
    subject varchar(500) not null,
    linked_by bigint,
    linked_at timestamp not null,
    status varchar(50) not null,
    unique (issuer, subject)
);
```

Failure invariant:

```text
No external identity may be linked to more than one active local account.
```

---

## 22. OIDC Logout

Logout is harder than login.

There are multiple layers:

| Layer | Meaning |
|---|---|
| Application session | local Jakarta `HttpSession` / app session |
| RP/client session | session between user and relying party |
| OP/IdP session | session at OpenID Provider |
| Other applications | other RPs sharing same IdP session |

Local logout:

```text
Invalidate Jakarta app session only.
IdP session remains alive.
User may log back in silently.
```

RP-initiated logout:

```text
App sends user to OP logout endpoint.
OP may terminate IdP session.
OP may redirect back after logout.
```

Front-channel logout:

```text
OP notifies RPs via browser iframe/front-channel requests.
```

Back-channel logout:

```text
OP sends server-to-server logout token to RP.
```

Session management check iframe:

```text
Browser-based OP/RP session state monitoring.
```

Practical enterprise model:

```text
For ordinary apps:
  local logout + optional RP-initiated logout

For SSO suite:
  local logout + RP-initiated OP logout + back-channel/front-channel handling where supported

For high-security apps:
  logout must invalidate app session, clear cookies, revoke refresh token if stored, and audit event
```

Common logout bug:

```text
App invalidates session but does not clear app-specific cookies.
```

Another bug:

```text
App redirects to OP logout but does not invalidate local session first.
If OP logout fails or user navigates back, local session remains valid.
```

Recommended ordering:

```text
1. Capture minimal logout context
2. Invalidate local app session
3. Clear local cookies
4. Revoke refresh token if applicable
5. Redirect to OP logout if configured
6. Redirect back to safe post-logout page
7. Audit logout
```

---

## 23. Back-Channel Logout Handling Conceptually

Back-channel logout is useful because it does not depend on browser front-channel behavior.

Conceptual flow:

```text
User logs out at OP
OP sends logout token to RP back-channel logout endpoint
RP validates logout token
RP finds app session by sid/sub/issuer
RP invalidates matching session(s)
```

To support this, the app may need session registry:

```java
record OidcSessionIndex(
    String issuer,
    String subject,
    String sid,
    String httpSessionId,
    Instant createdAt
) {}
```

Validation for logout token:

- signature,
- issuer,
- audience,
- event claim,
- `iat`,
- `sid` or `sub`,
- token is not normal ID token/access token,
- replay prevention if needed.

Operational caveat:

```text
If your app stores sessions only in local memory and runs multiple pods/nodes, back-channel logout must reach the node/session store that can invalidate the session.
```

For Kubernetes/clustered environments:

- use distributed session store,
- or central session registry,
- or event bus for logout propagation,
- or short session lifetime with local logout only if acceptable.

---

## 24. OIDC With SPA + Jakarta Backend

Common architecture:

```text
Vue/React/Angular SPA -> Jakarta REST API -> database/services
```

There are several patterns.

### Pattern A — SPA gets tokens directly

```text
SPA uses authorization code + PKCE
SPA stores access token in browser memory/storage
SPA calls Jakarta API with bearer token
Jakarta API validates access token
```

Pros:

- stateless API,
- common for public clients,
- works with API-first design.

Cons:

- browser token exposure risk,
- XSS impact high,
- refresh token handling complex,
- CORS required,
- logout harder.

### Pattern B — Backend-for-Frontend / BFF

```text
Browser talks to Jakarta app using secure HttpOnly session cookie
Jakarta backend performs OIDC code flow server-side
Tokens stay server-side
Jakarta backend calls APIs/server resources
```

Pros:

- tokens not exposed to JavaScript,
- aligns with Servlet session model,
- easier CSRF/SameSite control,
- good for enterprise apps.

Cons:

- backend session state,
- CSRF must be handled,
- scaling session store,
- less pure statelessness.

### Pattern C — Gateway handles OIDC

```text
Gateway authenticates user via OIDC
Gateway forwards identity/token/header to Jakarta app
Jakarta app validates trusted boundary and performs authorization
```

Pros:

- centralized login,
- app simpler,
- consistent SSO.

Cons:

- header spoofing risk,
- app may lose protocol-level visibility,
- harder local testing,
- gateway misconfig can affect all apps.

For regulated enterprise apps, BFF or server-side OIDC is often safer than storing long-lived tokens in browser JavaScript.

---

## 25. OIDC With API Gateway / Reverse Proxy

If OIDC happens at gateway, Jakarta app may receive identity via headers:

```text
X-User-Sub: 248289761001
X-User-Issuer: https://idp.example.com/realms/acme
X-User-Groups: case-officer,appeal-reviewer
```

This is dangerous unless the app enforces trust boundary.

Rules:

1. Gateway must remove incoming spoofed identity headers from external requests.
2. Gateway must set identity headers only after successful authentication.
3. Jakarta app must only accept these headers from trusted network/proxy path.
4. Prefer signed internal token over raw headers for high-risk systems.
5. App should still map identity to local account and domain permission.
6. Audit should record gateway-authenticated identity and trust source.

Better model:

```text
External request
  -> gateway validates OIDC
  -> gateway sends internal JWT or mTLS-bound identity to app
  -> app validates gateway token/header trust
  -> app maps to local actor
```

Never do this:

```java
String user = request.getHeader("X-User");
loginAs(user);
```

Unless you have a very explicit and enforced trusted boundary, this is authentication bypass.

---

## 26. 401 vs 403 in OIDC Login

OIDC changes the user experience around 401.

Browser protected page:

```text
Unauthenticated -> redirect to IdP
```

API call:

```text
Unauthenticated -> 401 JSON + WWW-Authenticate, not HTML redirect
```

Authenticated but unauthorized:

```text
403, do not redirect to login repeatedly
```

Common bug:

```text
API returns 302 login page to SPA fetch call.
SPA receives HTML instead of JSON.
User sees weird parse error.
```

Better route distinction:

| Request | Unauthenticated behavior |
|---|---|
| Browser page | 302 to OIDC authorization endpoint |
| REST API from browser session | 401 JSON `{code:"AUTH_REQUIRED"}` or 403 depending state |
| Machine API | 401 with proper `WWW-Authenticate` |
| Callback endpoint | protocol validation error page/log |

OIDC callback error should not dump raw error details to user.

Safe user message:

```text
Login could not be completed. Please try again or contact support with reference ID ABC-123.
```

Internal log:

```text
correlationId=ABC-123 event=OIDC_CALLBACK_FAILED reason=STATE_MISMATCH issuer=... clientId=...
```

Do not log authorization code, ID token, access token, refresh token, or full claim set containing sensitive data.

---

## 27. Clock Skew

OIDC token validation depends on time.

Claims:

- `exp`: expiration time,
- `iat`: issued at,
- `nbf`: not before,
- `auth_time`: authentication time.

If app server clock is wrong:

```text
All tokens may appear expired or not yet valid.
```

Operational requirements:

- synchronize clocks via NTP/chrony,
- allow small skew tolerance, e.g. 30–120 seconds depending policy,
- alert on large time drift,
- do not allow huge skew like 1 hour unless forced by broken environment.

Failure example:

```text
IdP clock correct.
App pod node clock 5 minutes behind.
ID token nbf appears in future.
Login fails only on pods scheduled to bad node.
```

Debug clue:

```text
Only some pods fail OIDC token validation.
```

Check:

- pod node time,
- container time,
- JVM timezone not same as clock but can confuse logs,
- token `iat/nbf/exp`,
- skew setting.

---

## 28. Refresh Tokens in Jakarta Web Apps

For simple login, the Jakarta app often does not need refresh token.

Use refresh token only if:

- app must call downstream APIs long after access token expires,
- user session should remain active without re-login,
- offline access is required,
- business requirement justifies risk.

Risks:

- refresh token theft gives long-lived access,
- server-side storage must be encrypted/secured,
- rotation must be handled,
- revocation must be implemented,
- logout must revoke it if appropriate.

Safer default:

```text
Use local app session for login.
Use short-lived access token for downstream call if needed.
Do not request offline_access unless required.
```

If storing refresh token:

- store server-side only,
- encrypt at rest,
- bind to user/session/client,
- rotate on use if provider supports refresh token rotation,
- revoke on logout/account disable,
- never expose to browser JavaScript,
- audit refresh usage,
- handle invalid_grant gracefully.

---

## 29. Token Propagation After OIDC Login

After browser login, Jakarta app may call downstream services.

Options:

### Option 1 — Propagate user access token

```text
User logs in -> app receives access token -> app calls downstream API with same token
```

Pros:

- downstream sees user identity,
- simpler delegated model.

Cons:

- token audience may not match downstream,
- over-sharing user token,
- confused deputy risk,
- token scope may be wrong.

### Option 2 — Token exchange

```text
App exchanges incoming/user token for downstream-specific token
```

Pros:

- correct audience,
- least privilege,
- better audit.

Cons:

- requires IdP support,
- more complex.

### Option 3 — Service token + user context

```text
App calls downstream with service credential and passes user context separately
```

Pros:

- clear service authentication,
- useful internal systems.

Cons:

- downstream must trust user context,
- risk of spoofing if not signed/validated,
- requires audit discipline.

Recommended invariant:

```text
Downstream API should receive a token/credential whose audience and privilege are intended for that downstream API.
```

Do not blindly forward ID token to APIs.

---

## 30. Multi-Tenant OIDC

Multi-tenant OIDC can mean several things:

1. one issuer with tenant claim,
2. one issuer per tenant,
3. one client per tenant,
4. one app serving multiple organizations,
5. one user belongs to multiple tenants.

Important distinction:

```text
Authentication tenant != application tenant authorization boundary
```

Example token:

```json
{
  "iss": "https://idp.example.com/realms/external",
  "sub": "user-123",
  "org_id": "agency-a",
  "groups": ["agency-officer"]
}
```

The app must still validate:

- is issuer trusted?
- is subject linked to local account?
- is `org_id` trusted from this issuer/client?
- does local account belong to org/tenant?
- is active tenant selected?
- does resource belong to same tenant?
- is action allowed in current case state?

Do not rely solely on token tenant claim for data isolation unless your architecture explicitly trusts and validates it.

Better authorization tuple:

```text
actor_id + active_tenant_id + action + resource_id + resource_tenant_id + resource_state
```

Invariant:

```text
A valid OIDC token proves identity, not automatic access to every tenant-bearing resource.
```

---

## 31. OIDC Error Cases

OIDC callback may return error instead of code:

```text
/error?error=access_denied&error_description=...
```

Common errors:

| Error | Meaning |
|---|---|
| `access_denied` | user denied consent or IdP denied login |
| `login_required` | prompt=none failed because user not logged in |
| `interaction_required` | user interaction needed |
| `invalid_request` | malformed request |
| `invalid_client` | client authentication/config wrong |
| `invalid_grant` | code invalid/expired/reused |
| `temporarily_unavailable` | IdP temporary issue |

Application handling:

- do not create session,
- clear login transaction,
- show safe message,
- log correlation id,
- classify operational vs user-cancelled,
- alert only for systemic errors.

Do not treat all callback errors as application bugs.

Example classification:

```text
access_denied by user -> info
state mismatch -> warning/security
invalid_client -> critical config issue
invalid_grant spike -> possible replay/clock/code reuse/config issue
JWKS unavailable -> operational dependency issue
```

---

## 32. Failure Modelling: How OIDC Login Breaks in Production

### 32.1 Redirect Loop

Symptom:

```text
Browser keeps bouncing between app and IdP.
```

Possible causes:

- callback endpoint is protected incorrectly,
- app session not created,
- session cookie not saved due to SameSite/Secure/Domain issue,
- load balancer loses session without sticky/distributed session,
- wrong external URL behind proxy,
- HTTP/HTTPS mismatch,
- reverse proxy strips headers,
- app thinks callback is unauthenticated and restarts login.

Check:

- Set-Cookie response,
- cookie Domain/Path/SameSite/Secure,
- proxy `X-Forwarded-Proto`,
- session id changes,
- callback route access rule,
- pod affinity/session store.

### 32.2 State Mismatch

Possible causes:

- session lost,
- multi-tab overwrite,
- load balancer sent callback to different node without session replication,
- SameSite cookie blocked,
- browser privacy mode,
- login transaction expired,
- application restarted and lost in-memory state,
- malicious response injection.

### 32.3 Nonce Mismatch

Possible causes:

- wrong login transaction,
- stale callback,
- token substitution,
- provider bug/misconfiguration,
- app forgot to send nonce,
- app not storing nonce per transaction.

### 32.4 Invalid Audience

Possible causes:

- wrong client id,
- token from another client,
- environment config mixed DEV/UAT/PROD,
- IdP client registration changed,
- app accepts wrong provider.

### 32.5 Invalid Issuer

Possible causes:

- realm URL changed,
- reverse proxy/public issuer mismatch,
- token from another realm,
- configuration has trailing slash mismatch,
- IdP migration incomplete.

### 32.6 JWKS/KID Failure

Possible causes:

- key rotation,
- JWKS cache stale,
- network issue to JWKS endpoint,
- wrong issuer metadata,
- provider publishes new key after signing with it without overlap,
- app blocks outbound call.

### 32.7 User Logs In But Has No Roles

Possible causes:

- wrong claim mapping,
- groups claim missing from ID token,
- roles only in access token,
- UserInfo not called,
- client scope not assigned,
- IdP mapper missing,
- app expects `groups`, provider emits `realm_access.roles`,
- namespace difference.

### 32.8 Logout Does Not Actually Logout

Possible causes:

- only local logout, IdP session remains,
- OP logout endpoint missing/incorrect,
- post logout redirect not registered,
- app session not invalidated before redirect,
- cookie not cleared due to wrong Path/Domain,
- other RP sessions not notified,
- back-channel logout not implemented.

### 32.9 Role Change Not Reflected

Possible causes:

- roles snapshotted at login,
- app session too long,
- no role refresh,
- user has refresh token but claims not refreshed,
- app uses local role cache,
- IdP group changed but token unchanged.

---

## 33. Debugging OIDC in Jakarta Apps

When debugging OIDC, separate the system into layers:

```text
Browser/cookie layer
Redirect/proxy layer
OIDC protocol layer
Token validation layer
Claim mapping layer
Container identity layer
Application authorization layer
```

### 33.1 Browser/cookie checks

- Was session cookie set?
- Was session cookie sent back on callback?
- Is `Secure` correct?
- Is `SameSite` compatible with redirect flow?
- Is Domain/Path correct?
- Is cookie overwritten by another app?

### 33.2 Redirect/proxy checks

- Is external scheme HTTPS but app thinks HTTP?
- Is redirect URI exactly registered?
- Is callback URL correct behind ALB/nginx/Traefik/HAProxy?
- Are forwarded headers trusted/configured?
- Is context path correct?

### 33.3 OIDC protocol checks

- Was `state` generated and returned?
- Was `nonce` generated and returned in ID token?
- Was authorization code single-use?
- Was token endpoint called with correct client auth?
- Was PKCE verifier valid?

### 33.4 Token validation checks

- `iss`,
- `aud`,
- `azp`,
- `exp`,
- `nbf`,
- `iat`,
- `nonce`,
- signature,
- `alg`,
- `kid`,
- JWKS URI.

### 33.5 Claim mapping checks

- Which token contains groups?
- Is claim path correct?
- Is claim string/list/object?
- Is client scope configured?
- Are roles realm-level or client-level?
- Are groups prefixed?
- Does app normalize role names?

### 33.6 Container identity checks

- What does `request.getUserPrincipal()` return?
- What does `securityContext.getCallerPrincipal()` return?
- Does `isCallerInRole("X")` return expected result?
- Does `@RolesAllowed("X")` work?
- Are roles declared/mapped?
- Is request going through secured container path?

### 33.7 Authorization checks

- Is user authenticated but locally suspended?
- Is tenant membership valid?
- Is resource tenant matching active tenant?
- Is domain state valid for action?
- Is denial 403 rather than login redirect?

---

## 34. Observability and Audit

OIDC logs must be useful but safe.

Log these:

- event type,
- correlation id,
- issuer,
- client id,
- provider alias,
- result success/failure,
- failure category,
- subject hash or local account id after validation,
- session id hash,
- remote IP/proxy chain if policy allows,
- user agent if useful,
- auth_time/acr/amr summary if needed,
- latency to authorization/token/UserInfo/JWKS endpoints,
- JWKS refresh event,
- role mapping result count, not full sensitive claim dump.

Do not log:

- authorization code,
- ID token,
- access token,
- refresh token,
- client secret,
- full raw claims with PII,
- cookies,
- nonce/state raw values unless hashed/truncated and policy allows.

Audit events:

| Event | Example |
|---|---|
| LOGIN_STARTED | OIDC flow started |
| LOGIN_SUCCEEDED | external identity mapped to local account |
| LOGIN_FAILED | protocol/token/local account failure |
| LOGOUT_LOCAL | app session invalidated |
| LOGOUT_PROVIDER_INITIATED | RP initiated OP logout |
| LOGOUT_BACK_CHANNEL | OP back-channel logout received |
| ROLE_MAPPING_CHANGED | mapping config changed |
| ACCOUNT_LINKED | external identity linked |
| ACCOUNT_PROVISIONED | JIT account created |
| STEP_UP_REQUIRED | sensitive action required stronger auth |
| STEP_UP_SUCCEEDED | stronger authentication completed |

For regulatory systems, distinguish:

```text
authentication event != authorization event != business action event
```

Example:

```text
10:00 LOGIN_SUCCEEDED actor=1001 issuer=... sub_hash=...
10:05 AUTHZ_GRANTED actor=1001 action=APPROVE_CASE case=ABC tenant=T1 policy=P9
10:05 BUSINESS_ACTION_COMPLETED actor=1001 action=APPROVE_CASE case=ABC oldState=REVIEW newState=APPROVED
```

---

## 35. Testing Strategy

### 35.1 Unit tests

Test pure functions:

- claim mapping,
- role normalization,
- issuer/tenant provider selection,
- original URL safety,
- account linking rules,
- authorization after login.

Example:

```java
@Test
void shouldNotUseEmailAsExternalIdentityKey() {
    OidcClaims claims = claims()
        .issuer("https://idp.example.com/realms/acme")
        .subject("sub-123")
        .email("changed@example.com")
        .build();

    ExternalIdentityKey key = mapper.toExternalKey(claims);

    assertEquals("https://idp.example.com/realms/acme", key.issuer());
    assertEquals("sub-123", key.subject());
}
```

### 35.2 Integration tests with mock IdP

Use a controllable test IdP or mocked OIDC server to test:

- discovery document,
- authorization endpoint,
- token endpoint,
- JWKS,
- ID token signing,
- key rotation,
- invalid issuer,
- invalid audience,
- expired token,
- nonce mismatch,
- missing groups,
- UserInfo mismatch.

### 35.3 Browser tests

Test:

- redirect to IdP,
- callback,
- session cookie creation,
- original URL restoration,
- logout,
- multi-tab login,
- expired login transaction,
- SameSite behavior,
- HTTPS/proxy path.

### 35.4 Security regression tests

Must-have negative tests:

```text
callback without state -> reject
callback with wrong state -> reject
ID token wrong issuer -> reject
ID token wrong audience -> reject
ID token expired -> reject
ID token nonce mismatch -> reject
unsigned token -> reject
access token used as ID token -> reject
UserInfo sub mismatch -> reject
unverified email auto-link -> reject
open redirect returnUrl -> reject
raw group not mapped -> no privilege
```

### 35.5 Authorization tests after login

Login success is not enough.

Test:

- authenticated user with no role gets 403,
- staff role cannot access external tenant resource,
- suspended local account cannot login despite valid IdP token,
- removed role loses permission after refresh/session expiry,
- step-up required for sensitive action.

---

## 36. Java 8 to Java 25 Considerations

OIDC itself is protocol-level, but Java/Jakarta platform version matters.

### Java 8

Characteristics:

- common for legacy Java EE 8 apps,
- `javax.*` namespace,
- older TLS/JCA defaults depending update level,
- old app servers may not support Jakarta Security OIDC mechanism,
- often requires external library/framework or container-specific adapter.

Design implication:

```text
Use OIDC via container adapter, servlet filter, reverse proxy, or framework-specific integration.
Be careful with TLS versions, cipher support, and JWT library versions.
```

### Java 11

Characteristics:

- common LTS baseline,
- better TLS defaults,
- `java.net.http.HttpClient` available,
- still many Java EE/Jakarta transition deployments.

### Java 17

Characteristics:

- common modern LTS,
- strong baseline for Jakarta EE 10-era apps,
- sealed classes/records useful for domain model if allowed,
- better runtime support.

### Java 21

Characteristics:

- LTS,
- virtual threads,
- modern runtime,
- Jakarta EE 11 implementations increasingly align with modern Java baselines.

OIDC concern with virtual threads:

```text
Do not assume thread-local security context automatically propagates into arbitrary async/virtual-thread work unless container/framework supports it.
```

### Java 25

Characteristics:

- current future-facing platform in this series,
- be aware of newer runtime behavior, TLS/JCA updates, library compatibility,
- OIDC code should still be based on protocol invariants, not Java-version tricks.

Cross-version rule:

```text
Protocol validation invariants stay the same.
Implementation APIs, namespace, container support, TLS defaults, and library versions change.
```

---

## 37. `javax` vs `jakarta`

Legacy Java EE 8:

```java
import javax.servlet.http.HttpServletRequest;
import javax.annotation.security.RolesAllowed;
```

Modern Jakarta EE:

```java
import jakarta.servlet.http.HttpServletRequest;
import jakarta.annotation.security.RolesAllowed;
import jakarta.security.enterprise.SecurityContext;
import jakarta.security.enterprise.authentication.mechanism.http.OpenIdAuthenticationMechanismDefinition;
```

Migration concern:

- package rename is not the whole migration,
- app server must support target Jakarta Security version,
- old OIDC adapters may be tied to `javax.servlet`,
- libraries compiled for `javax` may not work in `jakarta` runtime,
- test security behavior after migration, not just compile success.

OIDC-specific migration checks:

```text
Does new container support built-in OIDC mechanism?
Are annotation names/members the same?
Does callback path still work under new context path?
Do SameSite/session cookie defaults change?
Does role mapping behave identically?
Does JAX-RS/CDI/EJB authorization still see caller groups?
```

---

## 38. Production Design Checklist

### Protocol

- [ ] Use authorization code flow.
- [ ] Use PKCE where supported.
- [ ] Generate high-entropy state.
- [ ] Generate high-entropy nonce.
- [ ] Validate state once.
- [ ] Validate nonce in ID token.
- [ ] Validate issuer exactly.
- [ ] Validate audience/client id.
- [ ] Validate expiration/not-before/issued-at.
- [ ] Validate signature.
- [ ] Restrict allowed algorithms.
- [ ] Validate `azp` when relevant.
- [ ] Do not accept access token as ID token.
- [ ] Check UserInfo `sub` matches ID token `sub` if used.

### Configuration

- [ ] Trusted issuers are explicit.
- [ ] Redirect URIs are exact.
- [ ] Client secret is stored in secret manager.
- [ ] Environment configs cannot cross DEV/UAT/PROD accidentally.
- [ ] JWKS caching and refresh strategy exists.
- [ ] Clock synchronization is monitored.

### Session

- [ ] Session id rotated after login.
- [ ] Cookie `Secure` enabled in production.
- [ ] Cookie `HttpOnly` enabled.
- [ ] SameSite policy understood.
- [ ] Idle and absolute timeout configured.
- [ ] Local logout invalidates session.
- [ ] Provider logout behavior intentional.
- [ ] Refresh token storage avoided or secured.

### Identity mapping

- [ ] Local identity key uses issuer + subject.
- [ ] Email is not primary identity key.
- [ ] Local account status checked.
- [ ] Role mapping centralized.
- [ ] Raw IdP groups not scattered in business code.
- [ ] Tenant membership validated locally/domain-wise.
- [ ] Claim freshness policy defined.

### Authorization

- [ ] Authentication and authorization separated.
- [ ] `@RolesAllowed` only for coarse gates.
- [ ] Domain authorization handles object/tenant/state.
- [ ] Sensitive actions require fresh/strong auth if needed.
- [ ] Denials produce 403, not login loop.

### Observability

- [ ] Safe OIDC event logging.
- [ ] Tokens/codes/secrets never logged.
- [ ] Correlation ID on login flow.
- [ ] Audit events for login/logout/linking/provisioning.
- [ ] Metrics for IdP latency/error rate/JWKS refresh.

### Failure readiness

- [ ] Runbook for redirect loop.
- [ ] Runbook for state mismatch spike.
- [ ] Runbook for JWKS key rotation failure.
- [ ] Runbook for invalid issuer/audience.
- [ ] Runbook for IdP outage.
- [ ] Test for role removal/stale session.

---

## 39. Design Heuristics For Top-Level Engineers

### Heuristic 1 — OIDC Authenticates, Your App Authorizes

Do not let a valid login token become universal access.

```text
Valid OIDC login means “this external identity authenticated”.
It does not mean “this actor may approve this case”.
```

### Heuristic 2 — Use `issuer + sub` As External Identity

Email is profile data. Username is display/alias data. `issuer + sub` is identity key.

### Heuristic 3 — State and Nonce Are Not Optional Details

They are core protocol defenses.

### Heuristic 4 — Browser Login and API Token Validation Are Different Problems

Jakarta Security OIDC mechanism may solve browser login beautifully, but API bearer token validation still needs resource-server thinking.

### Heuristic 5 — Logout Must Be Designed, Not Assumed

Local session, IdP session, and other app sessions are different objects.

### Heuristic 6 — Role Mapping Is A Contract

Document claim-to-role mapping as a versioned integration contract. Do not scatter it across controller methods.

### Heuristic 7 — Assume Claims Go Stale

Define freshness explicitly. Especially for admin, approval, enforcement, financial, or regulatory actions.

### Heuristic 8 — Make Failures Classifiable

An OIDC failure should be classifiable as:

```text
user cancelled
protocol validation failed
token validation failed
provider unavailable
configuration error
local account denied
authorization denied
```

If all errors become “login failed”, operations will suffer.

---

## 40. Reference Architecture

For enterprise Jakarta web app:

```text
Browser
  |
  | HTTPS
  v
Reverse Proxy / ALB / Gateway
  |
  | forwarded headers sanitized
  v
Jakarta Web Application
  |
  | Jakarta Security OIDC mechanism
  v
OpenID Provider
  |
  | ID token / access token
  v
Jakarta App validates authentication result
  |
  | issuer + sub
  v
Local Account Directory
  |
  | account status + tenant membership + app role mapping
  v
Authenticated HttpSession
  |
  | SecurityContext / Principal / Groups
  v
Servlet / JAX-RS / CDI / EJB
  |
  | coarse @RolesAllowed + domain authorization
  v
Business Operation
  |
  | audit actor/action/resource/state
  v
Database / Services
```

For API calls:

```text
SPA/API Client
  |
  | Bearer access token
  v
Jakarta API / Gateway
  |
  | validate access token as resource server
  v
Actor Mapping
  |
  | domain authorization
  v
Resource Operation
```

Do not mix the two without clear boundaries.

---

## 41. Mini Capstone: Secure OIDC Login Decision Flow

Pseudo-flow:

```java
public LoginResult handleOidcCallback(OidcCallback callback, HttpServletRequest request) {
    OidcLoginTransaction tx = loginTransactionStore
        .consume(request, callback.state())
        .orElseThrow(() -> new SecurityException("Invalid state"));

    TokenResponse tokenResponse = tokenClient.exchangeAuthorizationCode(
        callback.code(),
        tx.codeVerifier(),
        configuredRedirectUri
    );

    ValidatedIdToken idToken = idTokenValidator.validate(
        tokenResponse.idToken(),
        new ExpectedTokenProperties(
            tx.issuer(),
            clientId,
            tx.nonce()
        )
    );

    UserInfo userInfo = maybeFetchUserInfo(tokenResponse.accessToken());
    if (userInfo != null && !userInfo.subject().equals(idToken.subject())) {
        throw new SecurityException("UserInfo subject mismatch");
    }

    ExternalIdentityKey externalKey = new ExternalIdentityKey(
        idToken.issuer(),
        idToken.subject()
    );

    AppAccount account = accountService.resolveLogin(externalKey, idToken.claims(), userInfo);

    if (!account.isActive()) {
        audit.loginDenied(account.id(), "LOCAL_ACCOUNT_NOT_ACTIVE");
        return LoginResult.denied();
    }

    Set<ApplicationRole> roles = roleMappingService.map(account, idToken.claims(), userInfo);

    request.changeSessionId();
    sessionService.establish(request, new AuthenticatedSession(
        account.id(),
        externalKey.issuer(),
        externalKey.subject(),
        account.displayName(),
        roles,
        Instant.now(),
        idToken.authTime(),
        idToken.acr(),
        idToken.amr()
    ));

    audit.loginSucceeded(account.id(), externalKey.issuer(), hash(externalKey.subject()));

    return LoginResult.redirectTo(tx.originalUrl());
}
```

This pseudo-flow shows the invariant chain:

```text
state validated
code exchanged
ID token validated
nonce validated
subject established
local account checked
roles mapped
session rotated
session created
audit written
```

Break any link and the system becomes weaker.

---

## 42. Common Anti-Patterns

### Anti-pattern 1 — Decode JWT Without Verification

```text
Base64 decode is not token validation.
```

### Anti-pattern 2 — Use Email As Primary Identity

Email is not stable enough for identity binding.

### Anti-pattern 3 — Use ID Token As API Access Token

ID token is for the client/RP, not resource server authorization.

### Anti-pattern 4 — Trust Any Issuer Dynamically

Dynamic issuer without trust registry can become authentication bypass.

### Anti-pattern 5 — Put Raw IdP Groups In Business Logic

Group names change. Business permission should be stable.

### Anti-pattern 6 — Treat OIDC Login As Sufficient Authorization

Authenticated does not mean allowed.

### Anti-pattern 7 — Ignore Logout Complexity

Local logout does not necessarily mean global SSO logout.

### Anti-pattern 8 — Store Tokens In Browser LocalStorage For Enterprise Session Apps

XSS impact becomes severe. Prefer BFF/server-side session where appropriate.

### Anti-pattern 9 — No Role Freshness Strategy

Privileges can remain after removal.

### Anti-pattern 10 — No Negative Tests

Most OIDC vulnerabilities are validation omissions, not syntax errors.

---

## 43. Summary Mental Model

OpenID Connect in Jakarta Security is best understood as a bridge:

```text
External authentication event at trusted issuer
    -> validated OIDC protocol result
    -> Jakarta caller identity
    -> application account
    -> roles/groups
    -> domain authorization
    -> auditable business action
```

OIDC gives you a strong way to authenticate users, but it does not eliminate:

- local account lifecycle,
- role mapping,
- tenant isolation,
- domain permission,
- session management,
- logout design,
- auditability,
- failure modelling.

A top-level engineer does not merely configure an OIDC client. They can explain:

1. what each artifact means,
2. what must be validated,
3. where identity becomes application actor,
4. where authorization begins,
5. how session and logout behave,
6. how role freshness is handled,
7. how the system fails under key rotation, proxy mismatch, stale session, or IdP outage.

That is the difference between “OIDC works on my machine” and a production-grade enterprise security architecture.

---

## 44. References

- Jakarta Security 4.0 Specification and API Documentation — OpenID Connect authentication mechanism, `SecurityContext`, `HttpAuthenticationMechanism`, claims/logout definitions.
- OpenID Connect Core 1.0 — identity layer over OAuth 2.0, authorization code flow, ID token, claims, nonce, authentication semantics.
- OpenID Connect Discovery 1.0 — provider metadata discovery including authorization endpoint, token endpoint, UserInfo endpoint, and JWKS URI.
- OAuth 2.0 Authorization Framework — access token, authorization code, client, resource owner, authorization server concepts.
- OAuth 2.0 Security Best Current Practice and PKCE guidance — modern security recommendations around authorization code interception and public/confidential clients.
- OpenID Connect RP-Initiated Logout, Front-Channel Logout, Back-Channel Logout — logout models for SSO systems.
- JSON Web Token / JSON Web Key standards — JWT claims, signatures, key discovery, `kid`, `alg`, JWKS concepts.

---

# End of Part 17

Part berikutnya:

```text
Part 18 — OAuth2 Resource Server Pattern for JAX-RS and Servlet APIs
```
