# learn-java-authentication-modes-and-patterns-part-013

# Part 13 — OAuth 2.0 for Java Engineers: Delegated Authorization as Authentication Input

> Seri: **Java Authentication Modes and Patterns**  
> Range Java: **Java 8 sampai Java 25**  
> Fokus: **OAuth 2.0 sebagai delegated authorization framework, bukan authentication protocol murni; bagaimana aplikasi Java memakai hasil OAuth2 secara aman sebagai input identity/session/resource access**

---

## 0. Posisi Part Ini dalam Series

Pada Part 11 kita membahas **JWT Authentication** sebagai signed assertion yang perlu divalidasi secara ketat. Pada Part 12 kita membahas **opaque token** dan **token introspection** sebagai alternatif token yang state-nya dikelola authorization server.

Part ini membahas pondasi yang lebih besar: **OAuth 2.0**.

OAuth2 sering disalahpahami sebagai “protocol login”. Secara historis dan spesifikasi, OAuth2 adalah **authorization framework** yang memungkinkan client mendapatkan akses terbatas ke protected resource, baik atas nama resource owner maupun atas nama client itu sendiri. Artinya, OAuth2 terutama menjawab:

```text
Can this client access this resource with this permission?
```

bukan secara langsung:

```text
Who is this human user and how exactly was the user authenticated?
```

Untuk authentication user modern, OAuth2 biasanya dipasangkan dengan **OpenID Connect**. OIDC akan kita bahas di Part 14. Namun sebagai Java engineer, kita perlu memahami OAuth2 lebih dulu karena OIDC, resource server JWT, opaque token introspection, authorization code + PKCE, client credentials, token relay, token exchange, dan machine-to-machine identity semuanya berdiri di atas model OAuth2.

Mental model awal:

```text
OAuth2 gives a client delegated access.
OIDC gives a relying party user identity.
JWT/opaque token are token representation choices.
Spring/Jakarta/Keycloak/Okta/Entra/Auth0 are implementations/integrations.
```

Top 1% engineer tidak hanya tahu flow diagram OAuth2. Ia bisa menjawab:

- apakah flow ini cocok untuk browser, SPA, BFF, mobile, CLI, service-to-service, atau batch job,
- siapa client sebenarnya,
- siapa resource owner,
- token audience untuk siapa,
- apakah token boleh diteruskan ke downstream service,
- apa yang terjadi jika authorization server down,
- bagaimana refresh token diproteksi,
- bagaimana audit membedakan user action vs system action,
- mengapa OAuth2 access token tidak boleh dianggap sebagai bukti login user tanpa konteks tambahan.

---

## 1. Problem yang Diselesaikan OAuth2

Sebelum OAuth2 populer, pola umum untuk integrasi antar aplikasi adalah membagikan username/password milik user atau credential internal. Contoh:

```text
Aplikasi A ingin membaca data user di Aplikasi B.
User memberikan password Aplikasi B ke Aplikasi A.
Aplikasi A login sebagai user ke Aplikasi B.
```

Masalahnya besar:

1. Aplikasi A mendapat terlalu banyak kuasa.
2. User tidak bisa membatasi scope akses.
3. User tidak bisa mencabut akses Aplikasi A tanpa ganti password.
4. Aplikasi B tidak bisa membedakan login user langsung vs akses oleh third-party client.
5. Password tersebar ke sistem yang tidak perlu memilikinya.
6. Audit menjadi kabur.
7. Compromise di satu client bisa menjadi compromise seluruh akun.

OAuth2 memperkenalkan model delegasi:

```text
User tidak memberikan password ke client.
Client mengarahkan user ke authorization server.
Authorization server meminta consent / policy approval.
Client menerima authorization grant.
Client menukar grant menjadi access token.
Client memakai access token ke resource server.
```

Tujuan utamanya adalah **limited delegated access**.

### 1.1 Yang Diselesaikan

OAuth2 menyelesaikan:

- delegated access,
- limited scope,
- token-based access,
- client identification,
- separation of authorization server dan resource server,
- revocation/expiry model,
- support banyak jenis client,
- extensible grant model,
- integration dengan identity provider modern.

### 1.2 Yang Tidak Otomatis Diselesaikan

OAuth2 tidak otomatis menyelesaikan:

- user authentication semantics,
- user profile identity,
- assurance level,
- MFA semantics,
- application session management,
- authorization business policy di aplikasi,
- tenant isolation,
- fine-grained permission internal,
- audit meaning dari action,
- secure browser storage,
- secure secret distribution,
- downstream token propagation.

Inilah alasan Part 13 harus dipelajari sebagai **design discipline**, bukan sekadar “pakai Spring OAuth2 client”.

---

## 2. OAuth2 sebagai Delegated Authorization Framework

Kalimat terpenting:

```text
OAuth2 is about delegated authorization, not direct authentication.
```

OAuth2 memberikan client kemampuan untuk mengakses protected resource dengan izin tertentu. Access token adalah bukti bahwa authorization server memberikan hak akses tertentu kepada client.

Namun di dunia nyata, banyak aplikasi memakai OAuth2 login button seperti:

```text
Login with Google
Login with Microsoft
Login with GitHub
Login with Keycloak
```

Ini tampak seperti authentication. Tetapi yang membuatnya menjadi authentication secara benar adalah lapisan OIDC atau informasi identitas yang terstandar dan tervalidasi. Tanpa OIDC, aplikasi bisa tergoda memakai access token untuk memanggil endpoint user profile dan menganggap hasilnya sebagai login. Pola ini bisa bekerja secara praktis, tetapi rawan jika tidak memahami audience, issuer, client, dan token semantics.

### 2.1 OAuth2 Menjawab Pertanyaan Apa?

OAuth2 menjawab:

```text
Has this client been authorized to access this resource with this scope?
```

Contoh:

```text
Client: report-generator-service
Resource: /api/reports/export
Scope: reports.export
Authorization server: auth.example.gov
Token: access token with audience report-api
```

### 2.2 Authentication Menjawab Pertanyaan Apa?

Authentication menjawab:

```text
Who is the actor?
How was the actor proven?
When was the actor authenticated?
With what assurance?
Can the application rely on this identity?
```

OIDC menambahkan jawaban melalui ID token, issuer, subject, nonce, auth_time, acr, amr, dan discovery/JWKS.

### 2.3 Kesalahan Paling Umum

Kesalahan umum:

```text
Access token valid => user logged in
```

Yang lebih benar:

```text
Access token valid => this request may access this resource if issuer, audience, expiry, scope, client, subject, and local policy all match.
```

Untuk login user:

```text
OIDC ID token valid + nonce/state valid + issuer/audience valid + local account mapping valid => application may establish local session.
```

---

## 3. Core Actors dalam OAuth2

OAuth2 memiliki empat aktor utama:

```text
+----------------+       +----------------------+       +----------------+
| Resource Owner |       | Authorization Server |       | Resource Server |
| usually user   |       | issues tokens        |       | hosts API/data  |
+----------------+       +----------------------+       +----------------+
          ^                         ^                             ^
          |                         |                             |
          |                         v                             |
          |                   +----------+                         |
          +-------------------| Client   |-------------------------+
                              | app      |
                              +----------+
```

### 3.1 Resource Owner

Resource owner adalah entitas yang memiliki atau mengontrol resource.

Dalam user-facing flow:

```text
resource owner = human user
```

Dalam client credentials flow:

```text
resource owner may be absent or represented by client/system ownership
```

Top 1% engineer selalu bertanya:

```text
Apakah token ini atas nama user, atas nama client, atau gabungan user + client?
```

Karena implikasinya berbeda untuk audit dan authorization.

### 3.2 Client

Client adalah aplikasi yang meminta access token.

Contoh client:

- web backend Java,
- Spring Boot BFF,
- SPA JavaScript,
- mobile app,
- CLI,
- batch job,
- internal microservice,
- partner integration,
- scheduled report exporter.

Client bukan selalu user. Ini penting.

```text
User = actor manusia
Client = software yang meminta token
```

Dalam OAuth2, client memiliki identitas sendiri:

- client id,
- client secret atau private key,
- redirect URI,
- allowed grant types,
- allowed scopes,
- allowed audiences,
- token endpoint authentication method.

### 3.3 Authorization Server

Authorization server adalah pihak yang:

- mengautentikasi resource owner jika diperlukan,
- meminta consent atau menerapkan policy,
- menerbitkan authorization code,
- menerbitkan access token,
- menerbitkan refresh token jika diizinkan,
- melakukan token introspection,
- melakukan token revocation,
- mempublikasikan metadata/JWKS jika memakai JWT/OIDC.

Contoh implementasi:

- Keycloak,
- Spring Authorization Server,
- Okta,
- Microsoft Entra ID,
- Auth0,
- PingFederate,
- ForgeRock,
- custom authorization server.

### 3.4 Resource Server

Resource server adalah API yang menerima access token dan melindungi resource.

Dalam Java:

- Spring Boot Resource Server,
- Jakarta REST/JAX-RS API dengan filter custom,
- Servlet filter,
- gateway plugin,
- gRPC service dengan interceptor,
- Kafka consumer/producer authentication layer,
- legacy Java web app behind API gateway.

Resource server tidak seharusnya “login user” ulang. Ia memvalidasi token, membangun security context untuk request, lalu menerapkan local authorization policy.

---

## 4. Core Artifacts dalam OAuth2

OAuth2 bukan hanya token. Ada beberapa artifact berbeda.

### 4.1 Authorization Request

Authorization request dikirim client ke authorization endpoint.

Biasanya mengandung:

```text
response_type=code
client_id=...
redirect_uri=...
scope=...
state=...
code_challenge=...
code_challenge_method=S256
```

Untuk OIDC nanti juga ada:

```text
nonce=...
```

### 4.2 Authorization Code

Authorization code adalah short-lived grant yang diterima client setelah user menyelesaikan authorization di authorization server.

Karakteristik:

- short-lived,
- single-use,
- tidak boleh dipakai langsung ke resource server,
- harus ditukar di token endpoint,
- harus terikat pada client dan redirect URI,
- untuk public client harus dilindungi PKCE.

Mental model:

```text
Authorization code is not access.
Authorization code is a ticket to ask for tokens.
```

### 4.3 Access Token

Access token dipakai client untuk mengakses resource server.

Karakteristik:

- bearer token atau proof-of-possession token,
- bisa JWT atau opaque,
- memiliki expiry,
- memiliki scope/audience/issuer,
- harus divalidasi oleh resource server,
- tidak boleh disimpan sembarangan di browser/local storage.

Mental model:

```text
Access token is for resource server.
It is not primarily for the client UI to read.
```

### 4.4 Refresh Token

Refresh token dipakai client untuk mendapatkan access token baru tanpa user interaction ulang.

Karakteristik:

- lebih sensitif daripada access token,
- masa hidup lebih panjang,
- harus disimpan lebih kuat,
- dapat dirotasi,
- reuse detection penting,
- tidak selalu diberikan untuk semua client.

Mental model:

```text
Access token leak is bad.
Refresh token leak is often much worse.
```

### 4.5 Scope

Scope menyatakan izin yang diberikan ke token.

Contoh:

```text
profile.read
case.write
report.export
payment.initiate
openid email profile
```

Scope bukan pengganti authorization business rule.

Scope menjawab:

```text
Token ini boleh meminta kategori akses apa?
```

Business authorization menjawab:

```text
Apakah user/service ini boleh melakukan action ini pada object ini dalam state ini?
```

Contoh:

```text
Scope: case.write
Business rule: user hanya boleh update case jika assignedOfficer == currentUser dan case.state in [DRAFT, PENDING_INFO]
```

### 4.6 Audience

Audience menyatakan intended recipient dari token.

Jika token ditujukan untuk `case-api`, maka `report-api` tidak boleh menerimanya hanya karena signature valid.

Kesalahan fatal:

```text
Resource server validates signature and expiry but ignores audience.
```

Akibat:

```text
Token minted for one API may be replayed to another API.
```

---

## 5. Grant Types sebagai Interaction Pattern

Grant type adalah cara client mendapatkan token. Jangan hafalkan sebagai daftar. Pahami sebagai pola interaksi.

```text
Grant type = how the client proves it has authorization to obtain tokens.
```

### 5.1 Authorization Code Grant

Digunakan untuk user-facing app dengan redirect browser.

Flow sederhana:

```text
1. User opens client app.
2. Client redirects browser to authorization server.
3. User authenticates and authorizes.
4. Authorization server redirects back with code.
5. Client backend exchanges code for token.
6. Client uses access token to call resource server.
```

Cocok untuk:

- server-side web app,
- BFF,
- confidential web backend,
- modern SPA with BFF,
- native app with PKCE.

Tidak cukup tanpa:

- state,
- redirect URI validation,
- PKCE for public clients,
- secure token storage,
- proper session creation.

### 5.2 Authorization Code + PKCE

PKCE menambahkan proof bahwa pihak yang menukar code adalah pihak yang memulai authorization request.

Flow mental:

```text
Client creates random code_verifier.
Client sends hash(code_verifier) as code_challenge.
Authorization server stores code_challenge with authorization code.
Client sends code_verifier at token exchange.
Authorization server verifies it matches.
```

PKCE sangat penting untuk public clients seperti mobile/SPA dan juga sering direkomendasikan secara luas untuk confidential clients sebagai defense-in-depth.

### 5.3 Client Credentials Grant

Digunakan untuk machine-to-machine.

```text
client authenticates to token endpoint
authorization server issues token for client identity
client calls resource server
```

Cocok untuk:

- internal service-to-service,
- scheduled job,
- batch export,
- integration daemon,
- backend platform service.

Tidak cocok untuk:

- user login,
- delegated user action,
- “admin user hidden behind service account” tanpa audit model.

Mental model:

```text
No user is present.
The client itself is the actor.
```

### 5.4 Refresh Token Grant

Digunakan untuk memperpanjang akses tanpa user interaction ulang.

Flow:

```text
client sends refresh token to token endpoint
authorization server validates refresh token
authorization server issues new access token
optionally rotates refresh token
```

Design concern:

- storage,
- rotation,
- reuse detection,
- revocation,
- client type,
- idle expiry,
- absolute expiry.

### 5.5 Device Authorization Grant

Digunakan untuk perangkat/CLI yang sulit input credential.

Contoh:

```text
CLI asks server for device code.
User opens browser on another device.
User enters user code.
CLI polls token endpoint.
CLI gets token after user approval.
```

Cocok untuk:

- CLI tools,
- smart TV,
- terminal app,
- constrained input device.

Akan dibahas lebih detail di Part 22.

### 5.6 JWT Bearer Grant

Client menggunakan JWT assertion untuk memperoleh token.

Cocok untuk:

- service account assertion,
- enterprise federation,
- workload identity bridge,
- private key based client authentication.

Risiko:

- assertion replay,
- weak key handling,
- wrong audience,
- long expiry,
- poor `jti` uniqueness.

### 5.7 Token Exchange

Token exchange memungkinkan client menukar satu token menjadi token lain, sering untuk downstream service atau delegation.

Mental model:

```text
Do not blindly forward one token everywhere.
Exchange it for a token intended for the next audience.
```

Contoh:

```text
frontend/BFF receives user session
BFF obtains token for case-api
case-api needs call document-api
case-api exchanges token for document-api audience
```

Token exchange penting untuk microservices, tetapi harus sangat disiplin agar tidak menciptakan confused deputy.

### 5.8 Deprecated / Discouraged Grants

Beberapa grant historis perlu dipahami untuk migration, bukan untuk dipilih pada desain baru.

#### Implicit Grant

Dulu dipakai SPA karena browser tidak dianggap bisa menjaga client secret. Namun implicit mengirim token langsung lewat front-channel, lebih rawan token leakage. Desain modern mengarah ke authorization code + PKCE, terutama dengan BFF untuk aplikasi sensitif.

#### Resource Owner Password Credentials Grant

ROPC meminta user memberikan username/password langsung ke client. Ini mengembalikan masalah yang ingin dihindari OAuth2: client memegang password user.

Kecuali kasus legacy yang sangat terbatas, hindari ROPC untuk desain baru.

---

## 6. Client Types: Confidential, Public, dan Credentialed Runtime

OAuth2 membedakan client berdasarkan kemampuannya menjaga credential.

### 6.1 Confidential Client

Confidential client bisa menjaga secret karena berjalan di environment backend yang tidak diekspos ke user.

Contoh:

- Spring Boot server-side app,
- Jakarta EE backend,
- internal Java service,
- batch job di Kubernetes,
- server-rendered web app.

Credential bisa berupa:

- client secret,
- private key JWT,
- mTLS client certificate,
- workload identity token,
- KMS-backed secret.

### 6.2 Public Client

Public client tidak bisa menjaga secret secara aman karena berjalan di device/browser user.

Contoh:

- SPA,
- mobile app,
- desktop app,
- CLI distributed to users.

Public client harus diasumsikan:

```text
Any embedded secret can be extracted.
```

Karena itu public client mengandalkan:

- PKCE,
- redirect URI constraints,
- short-lived tokens,
- external browser,
- secure platform storage where available,
- reduced trust.

### 6.3 Java Backend as Confidential Client

Java backend biasanya confidential client, tetapi hanya jika:

- secret tidak dibundel di artifact publik,
- secret disimpan di vault/secret manager,
- runtime access dibatasi,
- log tidak membocorkan secret,
- build pipeline tidak mengekspose secret,
- secret bisa dirotasi.

Jika client secret ada di `application.properties` yang masuk Git, status confidential-nya praktis rusak.

### 6.4 Kubernetes Workload as Client

Di Kubernetes, Java service sering menjadi OAuth2 client.

Pertanyaan desain:

```text
Apakah client credential disimpan sebagai Kubernetes Secret?
Apakah Secret dienkripsi at rest?
Apakah service account namespace-bound?
Apakah pod bisa membaca secret service lain?
Apakah secret rotation otomatis?
Apakah token audience spesifik per downstream API?
```

Authentication tidak berhenti di kode Java. Ia menyentuh deployment model.

---

## 7. OAuth2 dan Authentication: Kapan Boleh Dianggap Login?

OAuth2 access token sendiri bukan bukti login yang cukup untuk aplikasi client.

### 7.1 Resource Server Perspective

Resource server boleh memandang access token sebagai bukti akses jika:

- token valid,
- issuer trusted,
- audience cocok,
- expiry valid,
- signature/introspection valid,
- scope mencukupi,
- client/subject sesuai policy,
- token tidak revoked,
- local authorization lolos.

Dalam konteks resource server:

```text
Access token authentication = authenticate request carrying token.
```

Namun ini berbeda dari:

```text
User logged into web application.
```

### 7.2 Client Application Login Perspective

Client app yang ingin melakukan login user sebaiknya memakai OIDC.

Dengan OIDC, client menerima ID token yang memang dimaksudkan untuk client/relying party.

Jika hanya OAuth2 tanpa OIDC, aplikasi harus sangat berhati-hati:

- access token mungkin intended untuk resource server lain,
- subject format bisa tidak stabil,
- profile endpoint bisa vendor-specific,
- token audience mungkin bukan client,
- tidak ada nonce semantics untuk login,
- login CSRF/mix-up risk meningkat.

### 7.3 Practical Rule

Gunakan rule ini:

```text
For API access: OAuth2 access token.
For user login: OpenID Connect on top of OAuth2.
For local app continuity: application session.
```

---

## 8. OAuth2 in Java Architecture

Di sistem Java, OAuth2 biasanya muncul dalam tiga peran berbeda.

### 8.1 Java App as OAuth2 Client

Java app meminta token untuk memanggil API lain.

Contoh:

```text
Spring Boot BFF -> authorization server -> access token -> downstream API
```

Tanggung jawab:

- client registration,
- authorization request,
- token exchange,
- token storage,
- refresh token management,
- outbound request authorization,
- error handling.

Spring Security menyediakan OAuth2 Client support untuk authorization grants seperti authorization code, refresh token, client credentials, JWT bearer, dan token exchange pada dokumentasi modernnya.

### 8.2 Java App as Resource Server

Java API menerima access token.

Tanggung jawab:

- extract bearer token,
- validate JWT or introspect opaque token,
- enforce issuer/audience/expiry/scope,
- map claims to principal/authorities,
- apply local authorization,
- log audit-safe identity.

### 8.3 Java App as Authorization Server

Java app menerbitkan token.

Biasanya dilakukan dengan:

- Spring Authorization Server,
- Keycloak extension/SPI,
- custom auth server hanya jika benar-benar punya alasan kuat.

Membangun authorization server sendiri adalah high-risk karena harus menangani:

- client registration,
- redirect URI validation,
- consent,
- token issuance,
- token signing,
- token revocation,
- refresh rotation,
- discovery,
- JWKS,
- session management,
- attack prevention,
- audit.

Untuk kebanyakan organisasi, gunakan produk mature atau framework khusus.

---

## 9. Resource Server Mental Model

Resource server sering menjadi bagian Java yang paling banyak ditulis engineer. Karena itu modelnya harus tajam.

### 9.1 Request Flow

```text
HTTP request
  Authorization: Bearer <token>
        |
        v
Bearer token resolver
        |
        v
Token validation / introspection
        |
        v
Authentication object / principal
        |
        v
Scope/authority mapping
        |
        v
Local authorization rules
        |
        v
Controller / service / domain logic
```

### 9.2 Validation Is Not Authorization

Validasi token hanya menjawab:

```text
Is this token structurally and cryptographically acceptable?
```

Authorization menjawab:

```text
Can this principal/client perform this operation on this resource now?
```

Contoh buruk:

```java
if (jwtIsValid(token)) {
    deleteCase(caseId);
}
```

Contoh lebih benar:

```java
AuthenticatedActor actor = authenticate(token);
Case c = caseRepository.get(caseId);
policy.requireCanDeleteCase(actor, c);
caseService.delete(c, actor);
```

### 9.3 Mapping Token to Domain Actor

Jangan biarkan seluruh domain logic bergantung pada raw claim.

Lebih baik buat model internal:

```java
public sealed interface AuthenticatedActor
        permits HumanActor, ServiceActor, SystemJobActor {
    String subject();
    String issuer();
    Set<String> scopes();
    String clientId();
}

public record HumanActor(
        String subject,
        String issuer,
        String clientId,
        String userId,
        String tenantId,
        Set<String> scopes,
        Set<String> roles
) implements AuthenticatedActor {}

public record ServiceActor(
        String subject,
        String issuer,
        String clientId,
        String serviceName,
        Set<String> scopes
) implements AuthenticatedActor {}

public record SystemJobActor(
        String subject,
        String issuer,
        String clientId,
        String jobName,
        Set<String> scopes
) implements AuthenticatedActor {}
```

Untuk Java 8, sealed interface tidak tersedia. Bisa pakai interface + final classes + package-private constructors.

Intinya bukan syntax, tetapi domain separation:

```text
Human user action != service action != scheduled job action.
```

---

## 10. Authorization Server Mental Model

Authorization server adalah trust authority.

Ia tidak hanya “menghasilkan token”. Ia mengontrol:

- client identity,
- grant policy,
- user authentication requirement,
- consent/policy approval,
- token claims,
- token lifetime,
- token revocation,
- key rotation,
- metadata publication,
- audit trail.

### 10.1 Authorization Server sebagai State Machine

Flow authorization code bisa dilihat sebagai state machine:

```text
START
  -> AuthorizationRequestCreated
  -> UserAuthenticated
  -> ConsentOrPolicyEvaluated
  -> AuthorizationCodeIssued
  -> AuthorizationCodeRedeemed
  -> AccessTokenIssued
  -> RefreshTokenIssued(optional)
  -> TokenRefreshed(optional)
  -> TokenRevoked(optional)
  -> END
```

Failure state:

```text
InvalidClient
InvalidRedirectUri
InvalidScope
UserDenied
LoginFailed
CodeExpired
CodeAlreadyUsed
PkceMismatch
ClientAuthFailed
TokenRevoked
```

Top engineer melihat OAuth2 sebagai lifecycle dan state transitions, bukan endpoint terpisah.

### 10.2 Client Registration as Security Boundary

Client registration menentukan:

- allowed redirect URI,
- allowed grant type,
- allowed scope,
- token endpoint auth method,
- public/confidential classification,
- allowed post-logout redirect URI,
- consent requirement,
- access token lifetime,
- refresh token lifetime.

Kesalahan di client registration sering lebih berbahaya daripada bug kode aplikasi.

Contoh fatal:

```text
Allowed redirect URI = https://app.example.com/*
```

Jika wildcard terlalu longgar, attacker bisa menangkap authorization code melalui open redirect atau subpath berbahaya.

---

## 11. OAuth2 Flow Deep Dive: Authorization Code

### 11.1 Step-by-Step

```text
1. Browser requests /login on client app.
2. Client creates state and PKCE verifier.
3. Client stores state/verifier in server-side session or secure transient store.
4. Client redirects browser to authorization endpoint.
5. Authorization server validates client_id, redirect_uri, scope.
6. User authenticates at authorization server.
7. Authorization server applies consent/policy.
8. Authorization server redirects browser back with code and state.
9. Client validates state.
10. Client sends code + redirect_uri + PKCE verifier + client authentication to token endpoint.
11. Authorization server validates code, client, redirect_uri, PKCE.
12. Authorization server returns tokens.
13. Client stores tokens server-side or establishes app session.
14. Client calls resource server with access token.
```

### 11.2 Why State Matters

`state` protects against CSRF and response mix-up in authorization response.

Bad pattern:

```text
Client accepts any code returned to callback.
```

Better:

```text
Client accepts callback only if state matches an authorization request initiated by same browser/session.
```

### 11.3 Why Redirect URI Exactness Matters

Authorization code is delivered via redirect. If redirect URI can be manipulated, code can be stolen.

Good rule:

```text
Use exact redirect URI matching.
Avoid broad wildcard.
Avoid open redirect endpoints.
```

### 11.4 Why PKCE Matters

Without PKCE, stolen authorization code might be redeemable by attacker in some scenarios.

With PKCE:

```text
Attacker sees code but lacks code_verifier.
Token endpoint rejects exchange.
```

### 11.5 Where Java Bugs Appear

Common bugs in Java apps:

- storing state in insecure cookie,
- storing PKCE verifier in frontend local storage,
- accepting callback without state validation,
- not binding state to browser session,
- logging authorization code,
- logging token response,
- not handling code replay,
- accepting non-HTTPS redirect URI in production,
- using same client registration across environments,
- mixing issuer metadata between realms/tenants.

---

## 12. OAuth2 Flow Deep Dive: Client Credentials

### 12.1 Step-by-Step

```text
1. Java service needs call downstream API.
2. Java service authenticates to token endpoint as client.
3. Authorization server validates client credential.
4. Authorization server issues access token with client subject/scope/audience.
5. Java service calls downstream API.
6. Resource server validates token and applies policy.
```

### 12.2 Client Identity Is Actor Identity

In client credentials, there is no human user.

Audit should say:

```text
actor_type = SERVICE
client_id = report-exporter
subject = client:report-exporter
```

not:

```text
actor_type = USER
user_id = admin
```

### 12.3 Scope Design

Bad scope:

```text
api.full_access
```

Better:

```text
case.read
case.status.update
report.export
notification.send
```

Even better, combine token scope with local policy:

```text
client report-exporter has report.export
but can only export reports for tenant assigned to its registration
```

### 12.4 Token Cache

Java services should not request token for every outbound call.

Bad:

```text
For every API request:
  call token endpoint
  call downstream API
```

Problems:

- latency,
- authorization server load,
- failure amplification,
- rate limit,
- cascading outage.

Better:

```text
Cache access token until near expiry.
Refresh proactively with jitter.
Fail closed if token invalid and no cached token acceptable.
```

Pseudo-code:

```java
public final class ClientCredentialsTokenProvider {
    private final Object lock = new Object();
    private volatile CachedToken cached;

    public String accessToken() {
        CachedToken current = cached;
        if (current != null && !current.expiresSoon()) {
            return current.value();
        }
        synchronized (lock) {
            current = cached;
            if (current != null && !current.expiresSoon()) {
                return current.value();
            }
            CachedToken refreshed = requestNewToken();
            cached = refreshed;
            return refreshed.value();
        }
    }
}
```

Production refinements:

- add timeout,
- add retry with backoff,
- do not retry invalid_client,
- add singleflight/in-flight de-dup,
- add metrics,
- add circuit breaker carefully,
- never log token.

### 12.5 Secret Rotation

Client credentials must rotate without downtime.

Pattern:

```text
1. Register new secret/key while old remains valid.
2. Deploy Java service using new secret.
3. Observe token acquisition success.
4. Revoke old secret.
5. Verify no old-secret usage remains.
```

If using private key JWT:

```text
1. Publish new public key.
2. Deploy client with new private key and kid.
3. Allow overlap.
4. Remove old key after all clients migrated.
```

---

## 13. Access Token Design

### 13.1 Bearer Token

Most OAuth2 access tokens are bearer tokens.

Bearer means:

```text
Whoever possesses the token can use it.
```

Therefore:

- protect in transit with TLS,
- do not log,
- do not put in URL query string,
- avoid browser exposure when possible,
- minimize lifetime,
- bind audience,
- apply scope.

### 13.2 Proof-of-Possession Direction

Bearer tokens are simple but vulnerable to replay if stolen. More advanced systems bind token use to proof of key possession, for example:

- mTLS-bound access token,
- DPoP,
- private key based client authentication,
- service mesh identity + token exchange.

This will be covered more in mTLS and advanced token parts.

### 13.3 Token Format Is Not the Architecture

A system can use:

```text
JWT access token
opaque access token
JWT externally, opaque internally
opaque externally, JWT internally
JWT with introspection fallback
reference token with local cache
```

The architecture decision is about:

- validation authority,
- revocation requirement,
- latency tolerance,
- privacy,
- key distribution,
- resource server autonomy,
- operational failure mode.

---

## 14. Scope Design Deep Dive

### 14.1 Scope Is Coarse Capability

Scope should not encode every object-level permission.

Bad:

```text
case:12345:read
case:12345:update
case:12346:read
case:12346:update
```

This explodes token size and mixes resource policy into token issuance.

Better:

```text
case.read
case.update
```

Then local policy checks:

```text
Can actor update this specific case in current workflow state?
```

### 14.2 Scope Naming

Prefer stable capability language:

```text
case.read
case.create
case.update
case.submit
case.approve
report.export
profile.read
notification.send
```

Avoid UI-specific names:

```text
button.submit.enabled
screen.case.tab2.access
```

Avoid implementation-specific names:

```text
case_controller_post
sql_case_update
```

### 14.3 Scope vs Role

Role:

```text
Who/what is this actor organizationally?
```

Scope:

```text
What API capability did authorization server grant to this token?
```

Permission/policy:

```text
Can this actor perform this action on this object now?
```

Example:

```text
role = ENFORCEMENT_OFFICER
scope = case.update
policy = officer can update case only if assigned and state allows update
```

### 14.4 Scope and Consent

For third-party apps, scopes may be shown to user as consent.

For first-party/internal apps, consent may be replaced by policy:

```text
user belongs to agency X
client is internal official app
scope is allowed by client registration and user role
```

---

## 15. Audience Design Deep Dive

Audience is one of the strongest defenses against token replay across services.

### 15.1 Bad Pattern: One Token for Everything

```text
access token aud = all-apis
```

Problems:

- replay across APIs,
- overbroad blast radius,
- hard audit,
- coarse authorization,
- token leaks become more damaging.

### 15.2 Better Pattern: API-Specific Audience

```text
access token aud = case-api
```

If service needs call document API:

```text
exchange token for aud=document-api
```

or obtain separate client credentials token for document API if action is system-level.

### 15.3 Gateway Consideration

If API gateway validates token and forwards requests internally, downstream services still need a trust model.

Options:

```text
1. Gateway validates token and forwards signed internal identity header.
2. Gateway validates token and forwards original token.
3. Gateway exchanges external token for internal token.
4. Service mesh authenticates gateway-to-service and app trusts gateway claims.
5. Each service validates token independently.
```

Each has trade-off.

Danger:

```text
Any internal caller can forge X-User-Id header.
```

If using injected headers, protect with network boundary, mTLS, signature, or gateway-only ingress enforcement.

---

## 16. Token Storage Patterns in Java Applications

### 16.1 Server-Side Web App / BFF

Recommended pattern for sensitive web apps:

```text
Browser holds only session cookie.
Java backend stores tokens server-side.
Backend calls APIs.
```

Advantages:

- tokens not exposed to JavaScript,
- refresh token protected server-side,
- logout/invalidation easier,
- better audit and central control.

Risks:

- session store becomes critical,
- CSRF must be handled,
- backend must scale token/session storage,
- token cache consistency.

### 16.2 SPA Without BFF

SPA receives tokens in browser.

Risks:

- XSS token theft,
- local storage leakage,
- refresh token exposure,
- browser extension risk,
- token replay.

Modern guidance tends to prefer authorization code + PKCE and careful storage, but for high-risk enterprise apps, BFF is often better.

### 16.3 Java Service-to-Service

Java service stores client credential and caches access token in memory.

Rules:

- do not persist access token unless needed,
- do not log token,
- cache with expiry skew,
- isolate credentials per service,
- rotate secrets,
- use workload identity where possible.

### 16.4 Batch Job

Batch job may run for hours.

Design questions:

```text
Can job refresh token during run?
What if token expires mid-batch?
Are partial writes idempotent?
Is actor user or system?
Does audit record job run id?
```

---

## 17. Java Implementation Patterns

### 17.1 Spring Security OAuth2 Client

In Spring-based apps, common roles:

```text
OAuth2 Login: user login using OAuth2/OIDC provider.
OAuth2 Client: obtain/manage tokens for outbound calls.
Resource Server: validate bearer token for inbound API requests.
Authorization Server: issue tokens if using Spring Authorization Server.
```

Important separation:

```text
oauth2Login() != oauth2ResourceServer()
oauth2Client() != authorizationServer()
```

### 17.2 Resource Server JWT Validation Concept

Conceptual validation:

```java
public AuthenticatedActor authenticateJwt(String token) {
    Jwt jwt = jwtDecoder.decode(token);

    requireTrustedIssuer(jwt.getIssuer());
    requireAudience(jwt, "case-api");
    requireNotExpired(jwt);
    requireScopes(jwt, Set.of("case.read"));

    return actorMapper.toActor(jwt);
}
```

Do not stop at decode.

### 17.3 Opaque Token Introspection Concept

```java
public AuthenticatedActor authenticateOpaque(String token) {
    TokenMetadata meta = introspectionClient.introspect(token);

    if (!meta.active()) {
        throw new UnauthorizedException();
    }
    requireIssuer(meta.issuer());
    requireAudience(meta.audience(), "case-api");
    requireScopes(meta.scopes(), Set.of("case.read"));

    return actorMapper.toActor(meta);
}
```

### 17.4 Client Credentials Token Provider

A robust provider handles:

- expiry skew,
- in-flight de-dup,
- backoff,
- non-retryable errors,
- metrics,
- secret rotation support.

Pseudo-code:

```java
public interface AccessTokenProvider {
    AccessToken getToken(TokenRequestPurpose purpose);
}

public record TokenRequestPurpose(
        String audience,
        Set<String> scopes,
        String reason
) {}

public record AccessToken(
        String value,
        Instant expiresAt,
        String tokenType
) {
    boolean expiresWithin(Duration d, Clock clock) {
        return Instant.now(clock).plus(d).isAfter(expiresAt);
    }
}
```

### 17.5 Do Not Let Framework Model Leak Everywhere

Bad:

```java
public void approveCase(Jwt jwt, Long caseId) { ... }
```

Better:

```java
public void approveCase(AuthenticatedActor actor, CaseId caseId) { ... }
```

Why?

Because tomorrow actor may come from:

- session,
- JWT,
- opaque token,
- mTLS certificate,
- batch job,
- message metadata,
- admin impersonation.

Domain service should not depend on token format.

---

## 18. OAuth2 Error Handling

OAuth2 errors must be handled carefully because they often represent security state.

### 18.1 Token Endpoint Errors

Common errors:

```text
invalid_request
invalid_client
invalid_grant
unauthorized_client
unsupported_grant_type
invalid_scope
```

Design rules:

- `invalid_client`: do not retry blindly; credential/config likely wrong.
- `invalid_grant`: refresh token/code invalid; require re-auth or fail job.
- `invalid_scope`: deployment/config mismatch.
- timeout/5xx: retry with backoff if safe.
- rate limit: backoff and reduce token request amplification.

### 18.2 Resource Server Errors

Common responses:

```text
401 Unauthorized: no/invalid token
403 Forbidden: valid token but insufficient permission
```

Do not collapse all failures into 500.

### 18.3 Java API Response Design

Bad:

```json
{"error":"JWT expired at 2026-06-19T12:00:00Z; subject=fajar@example.com"}
```

Better:

```json
{"error":"unauthorized","message":"Authentication required or token expired"}
```

Log internally with safe fields:

```text
event=auth_failed
reason=token_expired
issuer=https://auth.example.com/realms/agency
client_id=case-web
subject_hash=...
correlation_id=...
```

---

## 19. Common Anti-Patterns

### 19.1 Treating Access Token as Session Cookie

Bad:

```text
Store access token in browser localStorage and use it as long-lived login state.
```

Problem:

- XSS exposure,
- revocation hard,
- token semantics confused with app session.

Better:

```text
Use application session for browser continuity.
Store token server-side where possible.
```

### 19.2 Not Validating Audience

Bad:

```text
Any token from trusted issuer is accepted by any API.
```

This enables cross-API token replay.

### 19.3 Scope as Full Authorization

Bad:

```text
scope=case.update => can update all cases
```

Better:

```text
scope=case.update + domain policy + tenant/state/assignment checks
```

### 19.4 One Client ID for Many Apps

Bad:

```text
case-web, mobile-app, batch-job all share one client_id and secret.
```

Problems:

- audit impossible,
- rotation risky,
- blast radius huge,
- policy cannot differ by client.

### 19.5 Refresh Token in SPA Local Storage

High-risk because XSS can steal long-lived credential.

Better options:

- BFF,
- refresh token rotation with strong controls,
- short-lived access token,
- secure browser storage pattern,
- avoid long-lived browser token for high-risk systems.

### 19.6 Token Relay Everywhere

Bad:

```text
Pass original user token through all microservices.
```

Problems:

- wrong audience,
- excessive privileges,
- confused deputy,
- hard revocation semantics,
- downstream services receive tokens not intended for them.

Better:

```text
Use token exchange or service-specific tokens.
```

### 19.7 Custom OAuth2 Server Without Security Expertise

If you write your own authorization server, you own:

- protocol correctness,
- attacks,
- key rotation,
- revocation,
- discovery,
- client registration,
- consent,
- token endpoint hardening,
- compliance.

Usually not worth it unless identity platform is your product.

---

## 20. Failure Modes and Threats

### 20.1 Authorization Code Interception

Threat:

```text
Attacker obtains authorization code from redirect.
```

Mitigation:

- PKCE,
- exact redirect URI,
- HTTPS,
- short code lifetime,
- single-use code,
- state validation.

### 20.2 CSRF on Authorization Response

Threat:

```text
Victim's browser receives attacker's authorization response.
Client links victim session to attacker's account.
```

Mitigation:

- state,
- session-bound authorization request,
- OIDC nonce for login,
- issuer validation.

### 20.3 Mix-Up Attack

Threat:

```text
Client uses response from one authorization server as if from another.
```

Mitigation:

- issuer binding,
- distinct redirect endpoints or state-bound issuer,
- metadata validation,
- strict client registration.

### 20.4 Token Substitution

Threat:

```text
Attacker presents token issued for different audience/client/context.
```

Mitigation:

- audience validation,
- issuer validation,
- authorized party/client validation,
- token binding where applicable.

### 20.5 Refresh Token Replay

Threat:

```text
Stolen refresh token used by attacker.
```

Mitigation:

- refresh token rotation,
- reuse detection,
- revoke token family,
- device/client binding,
- anomaly detection.

### 20.6 Authorization Server Outage

Impact differs:

```text
JWT resource server may continue validating existing tokens.
Opaque token resource server may fail if introspection unavailable.
Client credentials token refresh may fail.
Login flow may fail.
```

Design:

- cache JWKS,
- cache introspection carefully,
- define fail-closed/fail-open policy,
- monitor token endpoint,
- avoid token request storm,
- set timeout and bulkhead.

### 20.7 Clock Skew

OAuth2 token validation relies on time.

Mitigation:

- NTP synchronization,
- reasonable skew allowance,
- avoid long skew,
- log server time differences.

### 20.8 Over-Privileged Client

Threat:

```text
Client compromise gives broad API access.
```

Mitigation:

- least privilege scopes,
- audience binding,
- separate clients per app/service,
- short-lived tokens,
- secret rotation,
- monitoring.

---

## 21. OAuth2 and Audit Defensibility

Authentication and authorization systems must be auditable.

### 21.1 Minimum Fields for Token-Based Request Audit

For each protected action, record safe identifiers:

```text
event_type
correlation_id
request_id
timestamp
issuer
subject
subject_type
client_id
audience
scopes
actor_user_id(optional)
actor_service_id(optional)
tenant_id
resource_type
resource_id
action
outcome
policy_decision
source_ip_or_network_zone
```

Avoid logging:

- raw access token,
- raw refresh token,
- authorization code,
- client secret,
- private key,
- full sensitive claims.

### 21.2 User vs Client vs System Actor

Audit must distinguish:

```text
Human user clicked approve.
Backend service auto-synced record.
Scheduled job archived old case.
Admin impersonated user with approval.
```

OAuth2 token claims alone may not express this fully. Your application audit model must.

### 21.3 Token Issuance Audit

Authorization server should audit:

- client authentication success/failure,
- authorization code issued,
- code redeemed,
- access token issued,
- refresh token issued,
- refresh token rotated,
- token revoked,
- invalid grant attempts,
- suspicious reuse.

Resource server should audit:

- token accepted,
- token rejected reason class,
- scope insufficient,
- audience mismatch,
- policy denied,
- critical business action performed.

---

## 22. Performance and Reliability

### 22.1 Token Validation Cost

JWT validation cost includes:

- parsing,
- signature verification,
- claim validation,
- JWKS fetch/cache,
- authority mapping.

Opaque token validation cost includes:

- network call to introspection endpoint,
- parsing metadata,
- cache management,
- failure handling.

### 22.2 Avoid Authorization Server Hot Path Amplification

Bad:

```text
Every API call triggers introspection without cache.
Every outbound call triggers client_credentials token request.
Every service independently exchanges tokens repeatedly.
```

Better:

- cache introspection result with short TTL,
- cache client credentials token until near expiry,
- deduplicate in-flight token refresh,
- use proper connection pooling,
- set timeouts,
- add metrics.

### 22.3 Token Cache Invalidation Trade-Off

Caching improves availability and latency but weakens immediate revocation.

Design question:

```text
Is this endpoint high-risk enough to require fresh introspection every time?
Can we tolerate revocation delay of 30 seconds?
Should write operations have stricter checks than read operations?
```

### 22.4 Login Storm

After outage or deployment, many clients may re-authenticate simultaneously.

Mitigation:

- jitter token refresh,
- stagger startup,
- avoid token request on every request,
- warm caches safely,
- rate limit login/token endpoint,
- monitor error spikes.

---

## 23. Java Version Considerations: Java 8 to Java 25

OAuth2 is mostly protocol/framework-level, but Java version affects implementation quality.

### 23.1 Java 8

Common reality:

- older Spring Security versions,
- older TLS defaults,
- less ergonomic HTTP client,
- no records/sealed classes,
- more reliance on third-party HTTP clients,
- legacy application servers.

Design advice:

- keep token validation library updated,
- enforce modern TLS via runtime/container config,
- avoid custom JWT parsing,
- isolate auth model behind interfaces.

### 23.2 Java 11+

Java 11 adds standard `java.net.http.HttpClient`, useful for token/introspection calls if not using framework client.

Still, prefer framework-managed clients where they provide:

- connection pooling,
- observability,
- retry policy,
- TLS config,
- proxy config,
- timeout config.

### 23.3 Java 17/21 LTS

Modern Java enables better domain modeling:

- records for immutable token metadata,
- sealed classes for actor types,
- pattern matching improvements,
- virtual threads in Java 21 for blocking IO style with care,
- stronger baseline ecosystem support.

### 23.4 Java 25

Java 25 continues modern platform improvements. For OAuth2/authentication implementation, relevant themes include:

- modern concurrency/context handling,
- improved key material handling ecosystem,
- stronger ability to model auth domain cleanly with modern language features,
- platform maturity around TLS/crypto.

Do not tie OAuth2 correctness to Java syntax features. Tie correctness to protocol validation, lifecycle, and operational controls.

---

## 24. Design Decision Matrix

| Scenario | Recommended OAuth2/OIDC Pattern | Notes |
|---|---|---|
| Server-rendered Java web app login | OIDC authorization code | App establishes session after ID token validation |
| SPA high-risk enterprise app | BFF + OIDC authorization code | Browser holds session cookie, backend stores tokens |
| Mobile app | Authorization code + PKCE | Use system browser, secure storage |
| Java service-to-service | Client credentials | Prefer audience-specific tokens and strong client auth |
| Partner API | Client credentials, mTLS, or signed requests | Add rate limit, tenant binding, audit |
| Java API resource server | OAuth2 resource server JWT/opaque | Validate issuer, audience, expiry, scope |
| CLI | Device authorization or authorization code loopback | Avoid password grant |
| Microservice downstream call | Token exchange or service token | Avoid blind token relay |
| Legacy password app migration | OIDC facade or phased migration | Do not jump to custom insecure bridge |
| Authorization server implementation | Mature IdP or Spring Authorization Server | Avoid ad-hoc token issuer |

---

## 25. Practical Architecture Examples

### 25.1 Enterprise Web App with BFF

```text
Browser
  -> Java BFF session cookie
  -> BFF stores OAuth2 tokens server-side
  -> BFF calls APIs with access token
  -> APIs validate token and enforce policy
```

Pros:

- token not exposed to JS,
- better session control,
- strong backend audit,
- good for regulated apps.

Cons:

- BFF complexity,
- session store required,
- CSRF protection required,
- scaling considerations.

### 25.2 Direct SPA to API

```text
Browser SPA obtains token via auth code + PKCE
SPA calls API with bearer token
API validates token
```

Pros:

- simpler backend,
- scalable static frontend,
- common for low/medium risk apps.

Cons:

- browser token exposure,
- XSS risk,
- refresh token handling difficult,
- logout semantics harder.

### 25.3 Internal Service Platform

```text
service-a obtains client_credentials token for service-b
service-a calls service-b
service-b validates aud=service-b and scope
```

Good enhancements:

- mTLS between services,
- per-service client registration,
- short token lifetime,
- token cache with jitter,
- service-specific scopes.

### 25.4 Gateway + Resource Server

```text
External request -> API Gateway validates token
Gateway forwards to Java service with internal JWT or signed headers
Java service validates internal trust boundary and applies policy
```

Risk:

```text
If internal services accept headers from arbitrary callers, identity spoofing occurs.
```

Mitigation:

- only gateway can reach service,
- mTLS gateway-service,
- signed internal headers,
- service still validates original/internal token.

---

## 26. Implementation Checklist

### 26.1 OAuth2 Client Checklist

- Client type classified correctly: confidential vs public.
- Grant type is appropriate.
- Redirect URI exact and environment-specific.
- State parameter used and validated.
- PKCE used where appropriate, preferably broadly.
- Client secret/private key stored outside code/repo.
- Token endpoint timeout configured.
- Retry policy distinguishes retryable vs non-retryable errors.
- Tokens are not logged.
- Refresh token rotation supported if applicable.
- Token cache avoids token endpoint amplification.
- Metrics and audit exist.

### 26.2 Resource Server Checklist

- Bearer token extracted only from approved location.
- JWT signature or opaque introspection validated.
- Issuer validated.
- Audience validated.
- Expiry and not-before validated with sane skew.
- Scope/authority mapped explicitly.
- Client ID considered where relevant.
- Subject type mapped to domain actor.
- Local authorization policy enforced.
- 401 vs 403 handled correctly.
- Token not logged.
- JWKS/introspection cache designed deliberately.

### 26.3 Authorization Server / IdP Integration Checklist

- Separate client registration per app/service/environment.
- Grant types minimal.
- Scopes minimal.
- Redirect URIs exact.
- Token lifetime appropriate.
- Refresh token policy explicit.
- Key rotation plan exists.
- Revocation path tested.
- Audit logs enabled.
- Metadata/JWKS availability monitored.
- Break-glass and incident response defined.

---

## 27. Design Questions for Senior Review

Gunakan pertanyaan ini saat review OAuth2 architecture.

1. Siapa resource owner dalam flow ini?
2. Siapa client sebenarnya?
3. Apakah client public atau confidential?
4. Apa grant type yang dipakai dan mengapa?
5. Apakah access token dipakai untuk intended audience yang benar?
6. Apakah access token dipakai sebagai login proof? Jika ya, apakah seharusnya OIDC?
7. Apakah refresh token diberikan? Kepada siapa? Disimpan di mana?
8. Apakah token bisa dicabut? Berapa lama revocation delay yang diterima?
9. Apakah scope terlalu luas?
10. Apakah local business authorization masih dilakukan?
11. Apakah ada token relay ke downstream service?
12. Apakah downstream token audience benar?
13. Apakah authorization server outage membuat sistem fail open atau fail closed?
14. Apakah semua token/secret/code tidak masuk log?
15. Apakah audit bisa menjelaskan user action vs service action?
16. Apakah client registration terpisah per environment?
17. Apakah redirect URI exact?
18. Apakah ada open redirect di callback path?
19. Apakah token cache bisa menyebabkan stale permission terlalu lama?
20. Apakah key/secret rotation pernah diuji?

---

## 28. Mini Case Study: Regulatory Case Management Platform

Bayangkan sistem Java enterprise untuk lifecycle enforcement case.

Aktor:

```text
- Public user
- Agency officer
- Supervisor
- Legal officer
- System scheduler
- Notification service
- Reporting service
- External partner agency
```

### 28.1 Salah Desain

```text
Semua app memakai satu OAuth2 client_id: aceas-app.
Semua token punya scope: full_access.
Semua API menerima token dari issuer yang sama tanpa audience check.
Batch job memakai token admin user.
Gateway inject X-User-Id dan service percaya tanpa validasi boundary.
Refresh token disimpan di browser localStorage.
```

Dampak:

- audit tidak defensible,
- compromise satu app berdampak semua,
- token replay antar API,
- job terlihat seperti admin human action,
- tenant leakage risk,
- revocation lambat,
- incident response sulit.

### 28.2 Lebih Baik

```text
Public web:
  OIDC auth code via BFF, server-side session.

Officer portal:
  OIDC with agency IdP, step-up for sensitive actions.

Case API:
  Resource server requiring aud=case-api.

Document API:
  Resource server requiring aud=document-api.

Notification service:
  client_credentials with notification.send only.

Reporting service:
  client_credentials with report.export and tenant binding.

Case API -> Document API:
  token exchange to document-api audience or service token depending action semantics.

Batch archival job:
  service actor, not admin user.

Audit:
  actor_type, subject, client_id, tenant, action, resource, workflow state, decision.
```

### 28.3 Reasoning

This design separates:

- user identity,
- client identity,
- service identity,
- API audience,
- coarse token scope,
- fine domain policy,
- audit actor semantics.

That separation is what makes the system defensible under security review, incident investigation, and regulatory audit.

---

## 29. Mental Model Summary

OAuth2 should live in your head as the following layered model:

```text
Layer 1: Actor
  human user / service / job / device / client

Layer 2: Client registration
  who is allowed to request what using which grant

Layer 3: Grant flow
  how authorization is obtained

Layer 4: Token issuance
  what token is issued, for whom, to which audience, with what scope

Layer 5: Token validation
  issuer, audience, expiry, signature/introspection, scope

Layer 6: Application actor mapping
  convert protocol claims to domain actor

Layer 7: Domain authorization
  decide if actor can perform action on object in current state

Layer 8: Audit and lifecycle
  record, monitor, revoke, rotate, investigate
```

If any layer is skipped, the architecture becomes fragile.

---

## 30. Key Takeaways

1. OAuth2 is delegated authorization, not authentication protocol by itself.
2. Access token is for resource server, not a generic user login proof.
3. For login, use OIDC; that is Part 14.
4. Client identity and user identity are different.
5. Client credentials means service actor, not hidden admin user.
6. Scope is coarse capability, not full business authorization.
7. Audience validation is mandatory for serious systems.
8. Refresh token is highly sensitive and needs lifecycle controls.
9. Token relay across microservices is dangerous without audience/token-exchange design.
10. Java code should map token data into domain actor model instead of leaking raw framework token everywhere.
11. OAuth2 security depends as much on client registration and operations as on code.
12. Production OAuth2 engineering requires threat modeling, audit, cache strategy, secret rotation, and failure handling.

---

## 31. Latihan Pemahaman

Jawab sendiri sebelum lanjut ke Part 14.

### 31.1 Conceptual

1. Mengapa OAuth2 access token tidak otomatis membuktikan user login ke aplikasi client?
2. Apa perbedaan client, resource owner, authorization server, dan resource server?
3. Mengapa audience validation penting?
4. Mengapa scope tidak boleh menjadi satu-satunya business authorization?
5. Mengapa client credentials tidak boleh dipakai untuk action yang sebenarnya dilakukan user?

### 31.2 Design

1. Desain flow login untuk Java BFF + SPA enterprise.
2. Desain service-to-service auth antara case-api dan document-api.
3. Desain token cache untuk client credentials agar tidak membebani authorization server.
4. Desain audit model untuk membedakan officer action dan scheduled job action.
5. Desain migration dari legacy Basic Auth partner API ke OAuth2 client credentials.

### 31.3 Failure Analysis

1. Apa yang terjadi jika authorization server down?
2. Apa yang terjadi jika JWKS endpoint lambat?
3. Apa yang terjadi jika refresh token dicuri?
4. Apa yang terjadi jika redirect URI terlalu longgar?
5. Apa yang terjadi jika semua service menerima token dengan audience yang sama?

---

## 32. Referensi Resmi dan Lanjutan

Referensi utama:

1. RFC 6749 — The OAuth 2.0 Authorization Framework  
   `https://datatracker.ietf.org/doc/html/rfc6749`

2. RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage  
   `https://datatracker.ietf.org/doc/html/rfc6750`

3. RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients  
   `https://datatracker.ietf.org/doc/html/rfc7636`

4. RFC 7662 — OAuth 2.0 Token Introspection  
   `https://datatracker.ietf.org/doc/html/rfc7662`

5. RFC 7009 — OAuth 2.0 Token Revocation  
   `https://datatracker.ietf.org/doc/html/rfc7009`

6. RFC 9700 — Best Current Practice for OAuth 2.0 Security  
   `https://datatracker.ietf.org/doc/rfc9700/`

7. RFC 8252 — OAuth 2.0 for Native Apps  
   `https://www.rfc-editor.org/info/rfc8252`

8. Spring Security OAuth2 Client Reference  
   `https://docs.spring.io/spring-security/reference/servlet/oauth2/client/index.html`

9. Spring Security OAuth2 Resource Server Reference  
   `https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html`

10. Spring Authorization Server Reference  
    `https://docs.spring.io/spring-authorization-server/reference/overview.html`

---

## 33. Penutup Part 13

Part ini membangun fondasi OAuth2 sebagai authorization framework. Kita sudah memisahkan:

```text
OAuth2 access delegation
OIDC user authentication
JWT/opaque token representation
session continuity
resource server validation
business authorization
service-to-service authentication
```

Di Part 14, kita akan naik ke **OpenID Connect**: bagaimana authentication user dibangun di atas OAuth2 secara benar melalui ID token, discovery, JWKS, nonce, subject, claims, acr/amr/auth_time, userinfo, session, dan logout.

---

## Status Series

- Part 0 selesai — Orientation: Mental Model of Authentication in Java Systems
- Part 1 selesai — Java Runtime Security Foundations
- Part 2 selesai — Authentication Taxonomy
- Part 3 selesai — Password Authentication Done Properly
- Part 4 selesai — Session-Based Authentication
- Part 5 selesai — Servlet Container Authentication
- Part 6 selesai — Jakarta Security and Jakarta Authentication Deep Dive
- Part 7 selesai — Spring Security Authentication Architecture
- Part 8 selesai — Authentication Context Propagation
- Part 9 selesai — API Key Authentication
- Part 10 selesai — HMAC Request Signing
- Part 11 selesai — JWT Authentication
- Part 12 selesai — Opaque Token Authentication and Token Introspection
- Part 13 selesai — OAuth 2.0 for Java Engineers
- Series belum selesai
- Berikutnya: Part 14 — OpenID Connect: Authentication on Top of OAuth2

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-012.md">⬅️ Part 12 — Opaque Token Authentication and Token Introspection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-014.md">Part 14 — OpenID Connect: Authentication on Top of OAuth 2.0 ➡️</a>
</div>
