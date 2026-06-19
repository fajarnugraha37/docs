# learn-http-for-web-backend-perspective-part-014.md

# Part 014 — Authentication over HTTP

> Series: `learn-http-for-web-backend-perspective`  
> Audience: Java software engineer / backend engineer  
> Focus: HTTP authentication as a production boundary: identities, credentials, token validation, session cookies, API keys, mTLS, failure semantics, trust boundaries, and Spring Security implementation.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi HTTP backend:

- semantics HTTP;
- request lifecycle;
- methods;
- status codes;
- headers;
- body/framing;
- URI/resource modeling;
- representation design;
- validation;
- error contract;
- idempotency;
- conditional request;
- caching.

Sekarang kita masuk ke area yang sering terlihat sederhana tetapi sangat rawan salah: **authentication over HTTP**.

Banyak backend engineer memperlakukan authentication sebagai annotation framework:

```java
@PreAuthorize("isAuthenticated()")
@GetMapping("/cases/{id}")
public CaseDto getCase(@PathVariable UUID id) { ... }
```

Itu belum cukup.

Dari perspektif backend production, authentication adalah jawaban atas pertanyaan:

> “Request ini datang dari subjek siapa, membawa credential apa, divalidasi oleh siapa, dipercaya sampai layer mana, berlaku untuk audience apa, dan gagal dengan semantics HTTP apa?”

Part ini fokus pada **authentication**, bukan authorization. Authorization akan dibahas lebih dalam di Part 015.

---

## 1. Core Mental Model

Authentication adalah proses membuktikan identitas atau asal request.

Dalam HTTP backend, authentication biasanya melibatkan:

1. **Client** mengirim credential.
2. **Server/gateway/application** mengekstrak credential.
3. Sistem memvalidasi credential.
4. Sistem membentuk **authenticated principal**.
5. Principal dipakai oleh downstream logic untuk authorization, auditing, personalization, rate limiting, dan observability.

Secara sederhana:

```text
HTTP request
  -> credential extraction
  -> credential validation
  -> principal construction
  -> security context
  -> authorization decision
  -> application handler
```

Tetapi di production, alurnya sering lebih panjang:

```text
Client
  -> CDN / WAF
  -> API Gateway
  -> Identity Provider / Token Introspection
  -> Reverse Proxy
  -> Service Mesh
  -> Application Service
  -> Downstream Service
```

Pertanyaan pentingnya bukan hanya:

> “Apakah user sudah login?”

Melainkan:

> “Layer mana yang melakukan authentication, artifact apa yang diteruskan, dan apakah application boleh mempercayainya?”

---

## 2. Authentication vs Authorization

Dua istilah ini sering bercampur.

### 2.1 Authentication

Authentication menjawab:

```text
Who are you?
```

Contoh hasil authentication:

```text
principal.id = user-123
principal.type = HUMAN_USER
principal.tenant = tenant-a
principal.auth_method = OIDC_BEARER_TOKEN
principal.issuer = https://idp.example.com
principal.scopes = [case:read, case:update]
```

### 2.2 Authorization

Authorization menjawab:

```text
Are you allowed to do this operation on this resource now?
```

Contoh:

```text
Can user-123 approve case-789?
```

Jawabannya tidak cukup dari authentication saja. Kita perlu domain rules:

- apakah user bagian dari tenant yang benar?
- apakah user investigator atau supervisor?
- apakah case sedang berada di state yang bisa di-approve?
- apakah user punya conflict of interest?
- apakah case sudah assigned ke user tersebut?

### 2.3 Kenapa pemisahan ini penting?

Karena banyak sistem gagal dengan pola seperti ini:

```text
User has valid token -> allow access
```

Padahal valid token hanya membuktikan bahwa credential valid. Ia belum membuktikan bahwa user boleh mengakses resource tertentu.

Authentication adalah **identity establishment**.
Authorization adalah **permission decision**.

---

## 3. HTTP Authentication Semantics

HTTP punya konsep authentication yang diekspresikan melalui header dan status code.

Header utama:

```http
Authorization: <scheme> <credentials>
```

Contoh:

```http
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

Response ketika credential tidak ada, invalid, atau tidak cukup untuk authentication biasanya memakai:

```http
401 Unauthorized
WWW-Authenticate: Bearer realm="api"
```

Nama `401 Unauthorized` agak membingungkan secara bahasa modern. Secara semantics HTTP, `401` lebih dekat ke **unauthenticated / authentication required**, bukan “authenticated but forbidden”.

Untuk user yang sudah authenticated tetapi tidak punya izin, gunakan:

```http
403 Forbidden
```

Ringkasnya:

| Situation | Typical Status |
|---|---:|
| No credential, endpoint requires authentication | `401` |
| Credential malformed | `401` |
| Token expired | `401` |
| Token invalid signature | `401` |
| Authenticated but not allowed | `403` |
| Authenticated but resource hidden by policy | `404` or `403`, depending on policy |

---

## 4. Credential Carriers in HTTP

Credential bisa dibawa lewat beberapa mekanisme.

Yang umum:

1. `Authorization` header.
2. Cookie.
3. mTLS client certificate.
4. API key header.
5. Signed request headers.
6. Query parameter, meskipun biasanya tidak direkomendasikan.

### 4.1 `Authorization` Header

Contoh:

```http
Authorization: Bearer <access_token>
```

Kelebihan:

- eksplisit;
- tidak otomatis dikirim browser seperti cookie;
- cocok untuk API dan service-to-service;
- mudah ditangani oleh gateway dan application.

Risiko:

- token leakage di log jika request headers dilog mentah;
- token replay jika bearer token dicuri;
- perlu mekanisme expiry/rotation;
- perlu audience/issuer/scope validation.

### 4.2 Cookie

Contoh:

```http
Cookie: SESSION=abc123
```

Cookie sering dipakai untuk browser-based login.

Kelebihan:

- browser otomatis mengirim cookie sesuai domain/path;
- cocok untuk session-based web app;
- session bisa dicabut server-side;
- credential asli tidak perlu dikirim setiap request jika session ID opaque.

Risiko:

- CSRF;
- session fixation;
- cookie theft jika tidak `HttpOnly`/`Secure`;
- domain/path misconfiguration;
- stateful session scaling;
- caching response user-specific secara tidak aman.

### 4.3 mTLS Client Certificate

Dalam mTLS, client juga menyajikan certificate saat TLS handshake.

Cocok untuk:

- service-to-service internal;
- high-trust machine identity;
- regulated integration;
- API yang membutuhkan strong client authentication.

Risiko:

- certificate lifecycle sulit;
- rotation harus disiplin;
- subject mapping harus jelas;
- jika TLS terminated di proxy, application harus tahu apakah certificate info yang diteruskan bisa dipercaya.

### 4.4 API Key

Contoh:

```http
X-API-Key: k_live_abc123
```

Atau:

```http
Authorization: ApiKey k_live_abc123
```

API key cocok untuk:

- machine-to-machine integration sederhana;
- tenant identification;
- rate limiting;
- developer portal style API.

Tetapi API key sering disalahpahami.

API key biasanya membuktikan **client/application identity**, bukan human user identity.

Risiko:

- key leakage;
- key tidak punya expiry;
- key tidak dibatasi scope;
- key disimpan plaintext;
- key dikirim melalui query string;
- tidak ada rotation policy.

### 4.5 Signed Request

Beberapa API menggunakan request signing.

Konsepnya:

```text
signature = HMAC(secret, canonical_method + canonical_uri + canonical_headers + body_hash + timestamp)
```

Server menghitung ulang signature dan membandingkannya.

Kelebihan:

- membantu mencegah tampering;
- bisa memasukkan timestamp untuk replay protection;
- cocok untuk high-value machine integrations.

Risiko:

- canonicalization bug;
- clock skew;
- body hash mismatch;
- proxy mengubah header/path;
- debugging lebih sulit.

---

## 5. Bearer Token Mental Model

Bearer token berarti:

> Whoever possesses the token can use it.

Tidak ada bukti tambahan bahwa pemegang token adalah pihak asli yang menerima token.

Contoh:

```http
GET /cases/123 HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

Jika token bocor, attacker dapat menggunakannya sampai token expired atau dicabut.

Maka bearer token harus diperlakukan seperti credential sensitif:

- jangan log penuh;
- jangan kirim via URL query;
- jangan simpan di tempat tidak aman;
- gunakan TLS;
- gunakan expiry pendek;
- validasi issuer/audience/signature/expiry;
- gunakan scope/claims minimal;
- pertimbangkan token binding atau mTLS untuk use case tertentu.

---

## 6. JWT: Structure, Strengths, and Traps

JWT sering dipakai sebagai access token, tetapi tidak semua access token harus JWT.

JWT terdiri dari tiga bagian:

```text
base64url(header).base64url(payload).base64url(signature)
```

Contoh logical payload:

```json
{
  "iss": "https://idp.example.com",
  "sub": "user-123",
  "aud": "case-management-api",
  "exp": 1760000000,
  "iat": 1759996400,
  "scope": "case:read case:update",
  "tenant_id": "tenant-a"
}
```

### 6.1 JWT Validation Checklist

Backend harus memvalidasi minimal:

| Claim / Property | Meaning | Why It Matters |
|---|---|---|
| Signature | Token benar ditandatangani issuer | Mencegah forged token |
| Algorithm | Algoritma sesuai allowlist | Mencegah algorithm confusion |
| `iss` | Issuer | Mencegah token dari IdP lain |
| `aud` | Audience | Mencegah token untuk service lain dipakai di API ini |
| `exp` | Expiry | Mencegah token lama tetap valid |
| `nbf` | Not before | Mencegah token dipakai terlalu awal |
| `iat` | Issued at | Membantu policy max age |
| `sub` | Subject | Principal identity |
| `scope`/`roles` | Permission hints | Input authorization, bukan keputusan final |
| `tenant_id` | Tenant boundary | Multi-tenant isolation |

### 6.2 Kesalahan Fatal JWT

#### 6.2.1 Decode tanpa verify

Ini salah:

```java
String payload = decodeBase64(jwt.split("\\.")[1]);
```

Decode bukan validasi.

JWT payload memang bisa dibaca tanpa secret/public key. Yang penting adalah memastikan signature valid.

#### 6.2.2 Tidak mengecek audience

Token untuk service A bisa saja valid secara signature, tetapi tidak boleh dipakai untuk service B.

```text
Token valid? yes
Audience matches this API? no
Result: reject
```

#### 6.2.3 Menerima algorithm dari token secara buta

Server tidak boleh mengikuti header `alg` tanpa allowlist.

Policy harus eksplisit:

```text
Only accept RS256 from issuer X using JWKS Y.
```

#### 6.2.4 Token terlalu besar

JWT bisa membuat request header membengkak.

Dampak:

- proxy menolak request;
- upstream menerima behavior berbeda;
- header size limit terlampaui;
- latency meningkat;
- log menjadi bising.

JWT bukan tempat menyimpan semua profil user.

#### 6.2.5 Menaruh data rahasia dalam JWT

JWT signed bukan berarti encrypted.

Payload JWT biasa dapat dibaca siapa pun yang memegang token.

Jangan simpan:

- password;
- secret;
- nomor identitas sensitif;
- data kasus confidential;
- internal authorization reasoning.

---

## 7. Opaque Token and Introspection

Tidak semua access token harus self-contained seperti JWT.

Opaque token terlihat seperti random string:

```http
Authorization: Bearer 7f9b1c3a-opaque-token
```

Application tidak bisa membaca isi token langsung. Token harus divalidasi melalui:

- authorization server;
- introspection endpoint;
- gateway;
- local token cache.

### 7.1 Kelebihan Opaque Token

- mudah dicabut;
- isi token tidak bocor ke client;
- ukuran kecil;
- policy bisa dievaluasi central;
- authorization server dapat mengontrol status token real-time.

### 7.2 Kekurangan Opaque Token

- butuh network call untuk introspection;
- authorization server menjadi dependency runtime;
- perlu cache;
- failure mode lebih kompleks;
- latency bertambah.

### 7.3 Design Trade-off

| Aspect | JWT | Opaque Token |
|---|---|---|
| Local validation | Strong | Weak/no |
| Revocation | Harder | Easier |
| Token size | Often larger | Usually smaller |
| Runtime dependency | Lower | Higher |
| Data exposure | Higher if claims rich | Lower |
| Policy update | Slower until token expiry | Faster |

---

## 8. Session Cookie Authentication

Session cookie authentication umum pada browser web app.

Alur umum:

```text
1. User login with username/password/OIDC.
2. Server creates session.
3. Server returns Set-Cookie: SESSION=...
4. Browser sends Cookie: SESSION=... on subsequent requests.
5. Server loads session and authenticates principal.
```

Contoh response:

```http
Set-Cookie: SESSION=abc123; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600
```

### 8.1 Cookie Attributes

| Attribute | Purpose |
|---|---|
| `HttpOnly` | Mencegah JavaScript membaca cookie |
| `Secure` | Cookie hanya dikirim via HTTPS |
| `SameSite` | Mengurangi risiko CSRF/cross-site send |
| `Path` | Membatasi path yang menerima cookie |
| `Domain` | Membatasi domain/subdomain |
| `Max-Age` / `Expires` | Lifetime cookie |

### 8.2 Stateful Session

Server menyimpan session data:

```text
SESSION_ID -> principal/session data
```

Bisa disimpan di:

- memory;
- Redis;
- database;
- distributed session store.

Kelebihan:

- mudah revoke;
- data session tidak terekspos ke client;
- kontrol server kuat.

Kekurangan:

- perlu storage;
- sticky session atau distributed session;
- session store outage dapat melumpuhkan login;
- perlu cleanup expiry.

### 8.3 Stateless Session

Contoh: JWT disimpan sebagai cookie.

Kelebihan:

- tidak perlu session store;
- scaling sederhana.

Kekurangan:

- revocation sulit;
- cookie besar;
- claim stale;
- token leakage tetap berbahaya;
- CSRF tetap perlu dipikirkan jika cookie otomatis dikirim browser.

---

## 9. CSRF and Authentication Coupling

CSRF lebih relevan ketika browser otomatis mengirim credential, terutama cookie.

Threat model:

```text
User logged in to api.example.com
User visits attacker.com
attacker.com causes browser to send request to api.example.com
Browser includes cookies automatically
Server sees authenticated request
```

Jika endpoint melakukan mutation dan hanya mengandalkan cookie, request bisa berbahaya.

Mitigasi:

- CSRF token;
- SameSite cookie;
- checking Origin/Referer for browser flows;
- avoid cookie auth for cross-origin APIs unless designed carefully;
- require custom header plus CORS policy for API flows;
- use bearer token in Authorization header for non-browser automatic credential behavior.

CSRF akan dibahas lebih dalam di Part 016, tetapi backend engineer harus memahami coupling ini sejak authentication design.

---

## 10. API Key Authentication

API key sederhana tetapi sering rapuh.

### 10.1 Better API Key Shape

Jangan gunakan key sebagai random string tanpa metadata.

Gunakan bentuk yang membantu operasi:

```text
key_id.secret
```

Contoh konseptual:

```text
ak_live_9F3A2B.x7mY...secret...
```

Server menyimpan:

```text
key_id
secret_hash
tenant_id
status
scopes
created_at
expires_at
last_used_at
rotation_policy
```

Saat request datang:

```text
1. Extract key_id.
2. Lookup key record.
3. Hash/check secret.
4. Check status/expiry/scope.
5. Construct client principal.
```

### 10.2 Jangan Simpan API Key Plaintext

API key harus diperlakukan seperti password.

Simpan hash, bukan plaintext secret.

Untuk lookup cepat, simpan key prefix/id terpisah.

### 10.3 API Key in Query String

Hindari:

```http
GET /cases?api_key=secret
```

Karena query string sering muncul di:

- access log;
- browser history;
- proxy logs;
- analytics;
- referrer leakage;
- monitoring tools.

Lebih baik:

```http
Authorization: ApiKey <key>
```

atau:

```http
X-API-Key: <key>
```

---

## 11. Basic Authentication

Basic auth mengirim credential sebagai base64:

```http
Authorization: Basic dXNlcjpwYXNz
```

Base64 bukan enkripsi.

Basic auth hanya masuk akal jika:

- selalu via HTTPS;
- credential punya scope terbatas;
- dipakai untuk internal/simple integration;
- rate limiting dan lockout ada;
- tidak dipakai untuk modern user-facing login tanpa pertimbangan kuat.

Risiko:

- password dikirim setiap request;
- credential mudah bocor jika log mentah;
- sulit menerapkan MFA secara native;
- rotation buruk.

Untuk machine-to-machine, API key atau OAuth2 client credentials biasanya lebih baik.

---

## 12. mTLS Authentication

mTLS membuktikan client identity melalui certificate.

Alur sederhana:

```text
1. Server presents certificate to client.
2. Client validates server certificate.
3. Client presents certificate to server.
4. Server validates client certificate chain.
5. Server maps certificate subject/SAN to client principal.
```

### 12.1 Where mTLS Terminates Matters

Jika mTLS terminate di gateway:

```text
Client --mTLS--> Gateway --HTTP--> App
```

Application tidak melihat client certificate secara langsung.

Gateway bisa meneruskan identity melalui header internal:

```http
X-Client-Cert-Subject: CN=partner-a
X-Authenticated-Client: partner-a
```

Tetapi ini aman hanya jika:

- app tidak bisa diakses langsung dari luar gateway;
- gateway menghapus incoming spoofed headers;
- network boundary jelas;
- header tersebut hanya trusted dari gateway;
- internal traffic terenkripsi/terproteksi.

Jika tidak, attacker bisa mengirim header palsu.

### 12.2 mTLS in Service Mesh

Dalam service mesh, mTLS sering dipakai untuk service identity:

```text
service-a -> service-b
```

Tetapi application tetap perlu tahu:

- apakah identity mesh cukup untuk operation ini?
- apakah perlu end-user identity juga?
- bagaimana propagate user context secara aman?

Service identity dan user identity adalah dua hal berbeda.

---

## 13. OAuth2 / OpenID Connect Backend Mental Model

Backend engineer tidak perlu menghafal semua detail OAuth/OIDC untuk mulai mendesain API dengan benar, tetapi harus paham role utama.

### 13.1 OAuth2

OAuth2 terutama tentang delegated authorization.

Role umum:

| Role | Meaning |
|---|---|
| Resource Owner | User/entity pemilik resource |
| Client | App yang meminta access |
| Authorization Server | Penerbit token |
| Resource Server | API yang menerima token |

Backend API biasanya berperan sebagai **Resource Server**.

### 13.2 OpenID Connect

OIDC menambahkan identity layer di atas OAuth2.

Artifact penting:

| Token | Purpose |
|---|---|
| ID Token | Untuk client mengetahui identity user login |
| Access Token | Untuk memanggil resource server/API |
| Refresh Token | Untuk mendapatkan access token baru |

Kesalahan umum:

> Menggunakan ID token sebagai access token ke backend API.

Backend API sebaiknya menerima access token yang audience-nya memang API tersebut.

---

## 14. Access Token vs Refresh Token

### 14.1 Access Token

Dipakai untuk memanggil API.

Properties:

- lifetime pendek;
- dikirim ke resource server;
- membawa scope/audience;
- harus divalidasi setiap request.

### 14.2 Refresh Token

Dipakai untuk mendapatkan access token baru.

Properties:

- lifetime lebih panjang;
- sangat sensitif;
- sebaiknya hanya dikirim ke authorization server;
- tidak boleh dikirim ke resource API biasa;
- perlu rotation/reuse detection.

Backend resource server normalnya tidak perlu menerima refresh token.

---

## 15. Principal Construction

Setelah credential valid, backend membentuk principal.

Contoh principal yang baik:

```java
public record AuthenticatedPrincipal(
    String subject,
    PrincipalType type,
    String issuer,
    String audience,
    String tenantId,
    Set<String> scopes,
    Set<String> roles,
    String authenticationMethod,
    Instant authenticatedAt,
    String credentialId
) {}
```

Principal tidak harus sama dengan database user entity.

Jangan langsung mencampur:

```text
JWT claims == User aggregate == Authorization decision
```

Lebih aman:

```text
Validated credential
  -> authenticated principal
  -> authorization context
  -> domain-specific access decision
```

---

## 16. Claims, Roles, Scopes, and Permissions

### 16.1 Scope

Scope biasanya menyatakan permission coarse-grained:

```text
case:read
case:write
case:approve
```

Scope cocok untuk API-level permission.

### 16.2 Role

Role menyatakan posisi atau kelompok:

```text
INVESTIGATOR
SUPERVISOR
LEGAL_REVIEWER
ADMIN
```

Role tidak selalu cukup untuk authorization.

### 16.3 Permission

Permission lebih operasional:

```text
CAN_VIEW_CASE
CAN_ASSIGN_CASE
CAN_APPROVE_CASE
```

### 16.4 Attribute

Attribute bisa berupa:

```text
tenant_id = tenant-a
region = west
department = enforcement
clearance = confidential
```

### 16.5 Backend Rule

JWT claim sebaiknya dianggap sebagai **input**, bukan keputusan final.

Misalnya:

```text
scope contains case:approve
```

belum cukup jika:

```text
case.status != READY_FOR_APPROVAL
```

atau:

```text
user is not assigned supervisor for this case
```

---

## 17. Token Validation Failure Taxonomy

Authentication failure perlu diklasifikasikan dengan rapi.

| Failure | Typical HTTP | Notes |
|---|---:|---|
| Missing token | `401` | Include challenge when appropriate |
| Malformed Authorization header | `401` | Do not parse leniently |
| Unsupported auth scheme | `401` | e.g. Basic sent to Bearer-only endpoint |
| Invalid signature | `401` | Do not disclose internals |
| Expired token | `401` | Client may refresh token |
| Token not yet valid | `401` | Clock skew issue possible |
| Wrong issuer | `401` | Security event |
| Wrong audience | `401` | Security event |
| Missing required scope | `403` | Authenticated but insufficient privilege |
| Tenant mismatch | `403` or `404` | Policy-dependent |
| Revoked token | `401` | If revocation checked |
| Introspection server unavailable | `503` or fail closed | Depends architecture and risk appetite |

---

## 18. `WWW-Authenticate` Header

When returning `401`, HTTP authentication schemes can use `WWW-Authenticate` to describe how to authenticate.

Example:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="case-api"
Content-Type: application/problem+json
```

For bearer token errors, response may include limited error metadata.

Example:

```http
WWW-Authenticate: Bearer realm="case-api", error="invalid_token"
```

Avoid overly detailed information such as:

```text
signature invalid because kid not found in issuer https://...
```

That belongs in internal logs, not public response.

---

## 19. Authentication and Error Response Body

A good `401` body can use Problem Details style:

```json
{
  "type": "https://api.example.com/problems/authentication-required",
  "title": "Authentication required",
  "status": 401,
  "detail": "A valid access token is required to access this resource.",
  "instance": "/requests/01J...",
  "code": "AUTHENTICATION_REQUIRED",
  "correlationId": "01JABC..."
}
```

For expired token:

```json
{
  "type": "https://api.example.com/problems/invalid-token",
  "title": "Invalid access token",
  "status": 401,
  "detail": "The access token is expired or invalid.",
  "code": "INVALID_TOKEN",
  "correlationId": "01JABC..."
}
```

Do not expose:

- full token;
- token claims;
- signing key id details if sensitive;
- stack trace;
- internal IdP URLs if not public;
- policy internals.

---

## 20. Trust Boundaries: Edge Auth vs Application Auth

In production, authentication might be done at several places.

### 20.1 Application-Level Authentication

Application validates credential itself.

```text
Client -> Gateway -> App validates token
```

Pros:

- app owns security decision;
- fewer hidden assumptions;
- easier local reasoning;
- service-specific audience validation.

Cons:

- repeated validation across services;
- more duplicated config;
- each service needs IdP/JWKS/introspection integration.

### 20.2 Gateway-Level Authentication

Gateway validates credential and forwards identity.

```text
Client -> Gateway validates token -> App trusts gateway header
```

Pros:

- centralized auth enforcement;
- consistent edge rejection;
- reduces app complexity;
- can protect legacy apps.

Cons:

- app may overtrust headers;
- internal bypass risk;
- service-specific authorization still needed;
- harder to test locally;
- identity propagation contract must be precise.

### 20.3 Hybrid Model

Often best for sensitive systems:

```text
Gateway validates basic token authenticity
App validates audience/tenant/scope/domain-specific requirements
```

Or:

```text
Gateway authenticates external client
App authenticates internal service identity and user context
```

---

## 21. Header-Based Identity Propagation

A gateway may forward identity:

```http
X-Authenticated-Subject: user-123
X-Authenticated-Tenant: tenant-a
X-Authenticated-Scopes: case:read case:update
```

This is dangerous unless strictly controlled.

Backend must ask:

1. Can external clients reach app directly?
2. Does gateway strip incoming `X-Authenticated-*` headers before setting its own?
3. Is traffic from gateway to app protected?
4. Is there a signed assertion instead of raw headers?
5. Is there a clear source of truth?

Safer alternatives:

- app validates JWT itself;
- gateway forwards a signed internal JWT;
- mTLS between gateway and app;
- service mesh identity plus signed user context;
- explicit allowlist of trusted proxy IPs.

---

## 22. Authentication in Microservices

A request can carry multiple identities:

1. **End-user identity**: human user initiating action.
2. **Client application identity**: frontend/mobile/partner app.
3. **Service identity**: service A calling service B.
4. **Job/system identity**: scheduled/background process.
5. **Delegated identity**: service acting on behalf of user.

Example:

```text
User Alice uses Case UI
Case UI calls Case API with Alice's token
Case API calls Evidence API
Evidence API needs to know:
  - service caller = case-api
  - end user = Alice
  - tenant = tenant-a
  - delegated action = upload evidence metadata
```

Do not collapse all identities into one string.

### 22.1 On-Behalf-Of Model

For service-to-service calls, you need a policy:

```text
Can service A call service B on behalf of user U?
```

This is not the same as:

```text
Does user U have access?
```

Both may need to be true.

---

## 23. Token Propagation Patterns

### 23.1 Forward Original User Token

Service A forwards the same access token to Service B.

Pros:

- simple;
- Service B sees original user;
- authorization decentralized.

Cons:

- token audience may be wrong;
- token exposed to more services;
- hard to restrict downstream use;
- increases blast radius.

### 23.2 Token Exchange

Service A exchanges user token for a downstream token for Service B.

Pros:

- correct audience;
- can reduce scope;
- better audit;
- safer delegation.

Cons:

- more infrastructure;
- more latency;
- more failure modes.

### 23.3 Internal Signed User Context

Gateway/app creates signed internal assertion.

Pros:

- compact;
- controlled claims;
- internal trust model.

Cons:

- custom security complexity;
- key rotation;
- validation burden.

---

## 24. Authentication and Multi-Tenancy

Multi-tenant backend must treat tenant identity as security-critical.

Common bad pattern:

```http
GET /tenants/{tenantId}/cases/123
Authorization: Bearer <token with tenant-a>
```

Then code trusts path `tenantId` without comparing token tenant.

Correct model:

```text
request tenant source candidates:
  - token claim tenant_id
  - path tenantId
  - host/subdomain
  - API key tenant
  - mTLS client mapping

server must reconcile them
```

Example decision:

```text
If token.tenant_id != path.tenantId -> reject 403 or 404
```

Never let caller choose tenant solely by request parameter unless authenticated principal is authorized for that tenant.

---

## 25. Authentication and Caching

Authenticated responses are dangerous to cache incorrectly.

Risk:

```text
User A requests /me
Shared cache stores response
User B requests /me
Cache returns User A response
```

Backend should use safe cache headers for user-specific response:

```http
Cache-Control: private, no-store
```

or, when revalidation is intended:

```http
Cache-Control: private, no-cache
Vary: Authorization
```

For shared caches, be extremely explicit.

If response varies by `Authorization`, missing `Vary: Authorization` can be catastrophic.

Many authenticated API responses should simply use:

```http
Cache-Control: no-store
```

especially when they contain sensitive data.

---

## 26. Authentication and Logging

Never log raw credentials.

Dangerous logs:

```text
Authorization: Bearer eyJhbGciOi...
Cookie: SESSION=abc123
X-API-Key: secret
```

Safer logs:

```json
{
  "correlationId": "01J...",
  "auth.scheme": "Bearer",
  "auth.result": "success",
  "principal.subject": "user-123",
  "principal.tenant": "tenant-a",
  "token.issuer": "https://idp.example.com",
  "token.audience": "case-api",
  "token.jti_hash": "sha256:...",
  "request.path": "/cases/123"
}
```

For failed authentication:

```json
{
  "auth.result": "failure",
  "auth.failure.reason": "expired_token",
  "client.ip": "203.0.113.10",
  "correlationId": "01J..."
}
```

Avoid logging:

- access token;
- refresh token;
- API key;
- session ID;
- full cookie;
- password;
- private certificate key;
- raw `Authorization` header.

---

## 27. Authentication and Observability

Authentication should produce metrics.

Useful metrics:

```text
http.auth.requests.total{result="success", scheme="bearer"}
http.auth.requests.total{result="failure", reason="expired_token"}
http.auth.introspection.duration
http.auth.jwks.refresh.count
http.auth.jwks.refresh.failure.count
http.auth.token.validation.duration
http.auth.api_key.lookup.duration
```

But beware high cardinality.

Do not use raw user ID as metric label.

Bad:

```text
http.requests{user_id="user-123"}
```

Better:

```text
http.requests{auth="authenticated", tenant_tier="enterprise"}
```

For logs/traces, subject ID can be included with privacy review, but metrics labels should remain bounded.

---

## 28. Authentication and Rate Limiting

Authentication result affects rate limiting.

Before authentication:

```text
limit by IP / network / user-agent fingerprint / edge signal
```

After authentication:

```text
limit by user / client_id / tenant / API key / service identity
```

Important:

- unauthenticated endpoints like login need aggressive protection;
- failed authentication should be rate-limited;
- API key usage should be quota-tracked;
- token validation endpoints can become DoS target;
- introspection failure can cascade.

---

## 29. Authentication and Time

Token validation depends on time.

Claims:

```text
exp: expires at
nbf: not before
iat: issued at
```

Backend must consider:

- clock skew;
- NTP drift;
- timezone irrelevance for epoch timestamps;
- max token age;
- session idle timeout;
- absolute session timeout;
- refresh token rotation windows.

Do not use local timezone parsing for token expiry decisions.

Use `Instant`, not `LocalDateTime`, for credential validity.

Java rule:

```java
Instant now = clock.instant();
```

Inject `Clock` for testability.

---

## 30. Authentication Failure Modes

### 30.1 JWKS Endpoint Unavailable

JWT validation often depends on public keys from JWKS.

Failure modes:

- key cache expired;
- IdP unavailable;
- new key ID not in cache;
- network timeout;
- invalid JWKS response.

Policy options:

1. Fail closed: reject tokens if key unavailable.
2. Use cached keys until max stale window.
3. Preload keys.
4. Alert on refresh failure.

Security-sensitive systems usually prefer fail closed, with controlled stale cache for availability if risk accepted.

### 30.2 Introspection Server Down

Opaque token validation may require introspection.

Options:

- fail closed with `503`;
- use cached active token result briefly;
- degrade selected endpoints;
- reject high-risk operations but allow low-risk reads.

Be explicit. Do not accidentally fail open.

### 30.3 Clock Drift

Symptoms:

- tokens seen as expired immediately;
- tokens not yet valid;
- intermittent auth failures across nodes.

Mitigation:

- NTP;
- small allowed skew;
- monitoring;
- avoid per-node custom time logic.

### 30.4 Header Stripped by Proxy

Some proxies may strip or rewrite headers.

Example:

```text
Authorization header not forwarded to upstream
```

Symptoms:

- application sees unauthenticated request;
- gateway logs success but app logs missing token;
- only certain routes affected.

Mitigation:

- explicit gateway config;
- integration tests through real proxy path;
- access logs at each hop;
- trace correlation.

---

## 31. Java/Spring Security Mental Model

Spring Security pipeline, simplified:

```text
HTTP request
  -> SecurityFilterChain
  -> authentication filter
  -> AuthenticationManager / AuthenticationProvider
  -> SecurityContext
  -> authorization filter/interceptor
  -> controller
```

Key abstractions:

| Spring Concept | Meaning |
|---|---|
| `SecurityFilterChain` | Security filter pipeline for matching requests |
| `Authentication` | Represents authenticated or unauthenticated principal |
| `AuthenticationManager` | Attempts authentication |
| `AuthenticationProvider` | Specific auth mechanism implementation |
| `SecurityContext` | Holds authentication for request execution |
| `GrantedAuthority` | Authority/role/scope representation |
| `JwtDecoder` | Validates JWT |
| `AuthenticationEntryPoint` | Handles unauthenticated access |
| `AccessDeniedHandler` | Handles forbidden access |

---

## 32. Spring Resource Server Example: JWT Bearer

Conceptual Spring Security config:

```java
@Configuration
@EnableWebSecurity
class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/cases/**").hasAuthority("SCOPE_case:read")
                .requestMatchers(HttpMethod.POST, "/cases/**").hasAuthority("SCOPE_case:write")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth -> oauth
                .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter()))
            )
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint(problemAuthenticationEntryPoint())
                .accessDeniedHandler(problemAccessDeniedHandler())
            )
            .build();
    }

    @Bean
    Converter<Jwt, ? extends AbstractAuthenticationToken> jwtAuthenticationConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            String scope = jwt.getClaimAsString("scope");
            if (scope == null || scope.isBlank()) return List.of();
            return Arrays.stream(scope.split(" "))
                .map(s -> new SimpleGrantedAuthority("SCOPE_" + s))
                .toList();
        });
        return converter;
    }
}
```

Important production additions:

- configure issuer URI;
- validate audience;
- configure clock skew consciously;
- customize error response;
- map tenant claim;
- avoid excessive authority mapping;
- keep domain authorization outside simple route checks.

---

## 33. Audience Validation in Spring

Many systems validate issuer but forget audience.

Conceptual custom validator:

```java
@Bean
JwtDecoder jwtDecoder() {
    NimbusJwtDecoder decoder = NimbusJwtDecoder
        .withIssuerLocation("https://idp.example.com")
        .build();

    OAuth2TokenValidator<Jwt> withIssuer = JwtValidators
        .createDefaultWithIssuer("https://idp.example.com");

    OAuth2TokenValidator<Jwt> audienceValidator = jwt -> {
        List<String> audiences = jwt.getAudience();
        if (audiences.contains("case-management-api")) {
            return OAuth2TokenValidatorResult.success();
        }
        OAuth2Error error = new OAuth2Error(
            "invalid_token",
            "Required audience is missing",
            null
        );
        return OAuth2TokenValidatorResult.failure(error);
    };

    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
        withIssuer,
        audienceValidator
    ));

    return decoder;
}
```

Core invariant:

```text
A token valid for another audience is invalid for this API.
```

---

## 34. Extracting a Domain Principal

Do not spread JWT parsing everywhere.

Bad:

```java
@GetMapping("/cases/{id}")
public CaseDto get(@AuthenticationPrincipal Jwt jwt) {
    String tenant = jwt.getClaimAsString("tenant_id");
    String subject = jwt.getSubject();
    ...
}
```

Better:

```java
public record CurrentUser(
    String subject,
    String tenantId,
    Set<String> scopes
) {}
```

Then centralize mapping:

```java
@Component
class CurrentUserFactory {
    CurrentUser from(Authentication authentication) {
        Jwt jwt = (Jwt) authentication.getPrincipal();
        return new CurrentUser(
            jwt.getSubject(),
            jwt.getClaimAsString("tenant_id"),
            extractScopes(jwt)
        );
    }
}
```

Controller stays domain-oriented:

```java
@GetMapping("/cases/{caseId}")
public CaseDto getCase(
    @PathVariable UUID caseId,
    Authentication authentication
) {
    CurrentUser user = currentUserFactory.from(authentication);
    return caseQueryService.getCase(user, caseId);
}
```

---

## 35. AuthenticationEntryPoint vs AccessDeniedHandler

In Spring Security:

- `AuthenticationEntryPoint` handles unauthenticated request -> usually `401`.
- `AccessDeniedHandler` handles authenticated but forbidden -> usually `403`.

Conceptual:

```java
class ProblemAuthenticationEntryPoint implements AuthenticationEntryPoint {
    @Override
    public void commence(
        HttpServletRequest request,
        HttpServletResponse response,
        AuthenticationException authException
    ) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/problem+json");
        response.setHeader("WWW-Authenticate", "Bearer realm=\"case-api\"");
        response.getWriter().write("""
            {
              "type":"https://api.example.com/problems/authentication-required",
              "title":"Authentication required",
              "status":401,
              "code":"AUTHENTICATION_REQUIRED"
            }
            """);
    }
}
```

Do not return `403` for missing token just because authorization failed downstream.

---

## 36. WebFlux Security Notes

Reactive stack uses different types but similar concepts.

```java
@Bean
SecurityWebFilterChain springSecurityFilterChain(ServerHttpSecurity http) {
    return http
        .csrf(ServerHttpSecurity.CsrfSpec::disable)
        .authorizeExchange(exchanges -> exchanges
            .pathMatchers("/actuator/health").permitAll()
            .pathMatchers(HttpMethod.GET, "/cases/**").hasAuthority("SCOPE_case:read")
            .anyExchange().authenticated()
        )
        .oauth2ResourceServer(oauth -> oauth.jwt(Customizer.withDefaults()))
        .build();
}
```

Reactive caveats:

- avoid blocking introspection calls on event loop;
- context propagation must be understood;
- security context is reactive, not thread-local in the same way;
- custom authentication manager must return `Mono<Authentication>`;
- downstream WebClient token propagation must be explicit.

---

## 37. Backend-to-Backend Authentication

Backend services calling other backend services should authenticate too.

Options:

1. mTLS service identity.
2. OAuth2 client credentials.
3. Signed internal JWT.
4. API keys for partner/internal clients.
5. Service mesh identity.

### 37.1 Client Credentials Flow Concept

Service obtains access token using its own client identity:

```text
service-a -> authorization server: client_id/client_secret or private_key_jwt
authorization server -> service-a: access token
service-a -> service-b: Authorization: Bearer <service-token>
```

Service B validates token and sees:

```text
subject/client_id = service-a
scope = evidence:write
audience = evidence-api
```

### 37.2 Do Not Use Human User Token for Service Identity

A service token and user token have different meanings.

Bad:

```text
scheduled-job uses admin user's token forever
```

Better:

```text
scheduled-job authenticates as service principal with limited scope
```

---

## 38. Login Endpoint Design

Although this series is backend API oriented, many systems expose login endpoints.

Login endpoints need extra care.

### 38.1 Login Failure Semantics

Do not reveal whether username exists:

```json
{
  "title": "Invalid credentials",
  "status": 401,
  "code": "INVALID_CREDENTIALS"
}
```

Avoid:

```text
User does not exist
Password incorrect for existing user
```

### 38.2 Brute Force Protection

Login endpoint should have:

- rate limiting;
- account lockout or risk-based throttling;
- MFA where appropriate;
- audit logging;
- suspicious activity detection;
- password hashing with strong algorithms;
- no credential logging.

### 38.3 Session Rotation

After successful login or privilege elevation, rotate session ID to prevent session fixation.

---

## 39. Logout and Revocation

Logout differs by authentication type.

### 39.1 Stateful Session Logout

Server invalidates session:

```text
delete SESSION_ID from store
Set-Cookie: SESSION=; Max-Age=0
```

### 39.2 JWT Logout

If access token is stateless, logout does not automatically invalidate already-issued token unless:

- token lifetime is short;
- token revocation list exists;
- token version is checked;
- session ID claim is checked against server state;
- refresh token is revoked.

### 39.3 API Key Revocation

API key should have status:

```text
ACTIVE
REVOKED
EXPIRED
ROTATING
```

Server checks status every request or via short-lived cache.

---

## 40. Authentication for Public Endpoints

Some endpoints are public:

```text
GET /health
GET /public/legal-notices
POST /auth/login
POST /webhooks/payment-provider
```

Public does not mean unprotected.

Public endpoints may still need:

- rate limiting;
- request validation;
- signature verification;
- bot protection;
- logging;
- strict method allowlist;
- CORS policy;
- size limits.

Webhook endpoints are often “public network reachable but authenticated by signature”.

---

## 41. Webhook Authentication

Webhook sender usually authenticates via signature.

Typical pattern:

```http
POST /webhooks/provider-x
X-Provider-Timestamp: 1760000000
X-Provider-Signature: v1=abc123...
Content-Type: application/json
```

Server:

```text
1. Read raw body bytes.
2. Build canonical payload: timestamp + body.
3. Compute HMAC using shared secret.
4. Constant-time compare signature.
5. Reject if timestamp outside tolerance.
6. Deduplicate event ID.
```

Important:

- signature must be verified over raw body, before JSON mutation;
- body logging should be limited;
- replay protection matters;
- webhook idempotency matters;
- secret rotation should be supported.

---

## 42. Security Anti-Patterns

### 42.1 Trusting User ID from Header

Bad:

```http
X-User-Id: user-123
```

without trusted gateway.

Any client can send it.

### 42.2 Accepting Token Without Audience Check

Bad:

```text
signature valid -> allow
```

Correct:

```text
signature valid + issuer valid + audience valid + expiry valid + policy valid
```

### 42.3 Returning Different Login Errors

Bad:

```text
username not found
password wrong
account exists but disabled
```

Can enable enumeration.

### 42.4 Logging Authorization Header

Bad:

```text
headers={Authorization=Bearer eyJ...}
```

### 42.5 Long-Lived Bearer Tokens

Long-lived bearer token increases blast radius.

### 42.6 Using API Key as User Identity

API key usually identifies app/client, not human actor.

### 42.7 Auth Only at UI

Bad:

```text
hide button in frontend -> no backend check
```

Backend must enforce authentication and authorization.

### 42.8 Fail Open on IdP Error

Bad:

```text
introspection timeout -> allow request
```

Usually catastrophic.

### 42.9 Mixing Authentication and Domain Authorization

Bad:

```java
if (jwt.getClaim("role").equals("SUPERVISOR")) approveCase();
```

without checking case assignment/state/tenant.

### 42.10 Using GET for Login with Credentials in URL

Bad:

```http
GET /login?username=alice&password=secret
```

Credentials leak everywhere.

---

## 43. Production Design Checklist

For every authenticated API, answer these questions.

### 43.1 Credential

- What credential type is accepted?
- Where is it carried?
- Is TLS mandatory?
- Is credential ever placed in URL?
- Is credential logged anywhere?
- Is credential rotated?
- Is credential revocable?

### 43.2 Validation

- Who validates credential?
- Is issuer checked?
- Is audience checked?
- Is signature checked?
- Is expiry checked?
- Is clock skew controlled?
- Are algorithms allowlisted?
- Are scopes/roles parsed consistently?
- Is tenant claim validated?

### 43.3 Trust Boundary

- Is auth performed at gateway, app, or both?
- Can app be reached bypassing gateway?
- Are forwarded identity headers stripped and re-created?
- Is internal traffic protected?
- Is there mTLS/service identity?

### 43.4 Principal

- What is the principal model?
- Does it distinguish user/client/service identity?
- Does it include tenant?
- Does it include authentication method?
- Does it avoid direct dependency on raw JWT everywhere?

### 43.5 Failure

- Missing credential returns what?
- Invalid token returns what?
- Expired token returns what?
- Insufficient scope returns what?
- IdP unavailable returns what?
- Are errors safe and consistent?
- Is `WWW-Authenticate` used when appropriate?

### 43.6 Operations

- Are auth success/failure metrics emitted?
- Are security events logged?
- Are credentials redacted?
- Are brute-force attempts rate-limited?
- Are JWKS/introspection failures alerted?
- Are token validation latencies monitored?

---

## 44. Regulatory Case Management Example

Assume system:

```text
Case Management API
Tenant: regulatory agency / department
Users: investigator, supervisor, legal reviewer, external respondent
Services: evidence-service, notification-service, audit-service
```

### 44.1 Human User Request

```http
GET /cases/CASE-123 HTTP/1.1
Host: api.regulator.example
Authorization: Bearer <access-token>
```

Token claims:

```json
{
  "iss": "https://identity.regulator.example",
  "sub": "user-456",
  "aud": "case-api",
  "tenant_id": "agency-a",
  "scope": "case:read case:update",
  "roles": ["INVESTIGATOR"],
  "exp": 1760000000
}
```

Authentication establishes:

```text
subject = user-456
tenant = agency-a
role hint = INVESTIGATOR
scope = case:read case:update
```

Authorization still checks:

```text
case tenant == agency-a
case assigned investigator == user-456 OR user has supervisor override
case confidentiality level <= user clearance
case not sealed from investigator
```

### 44.2 Service-to-Service Request

Case API calls Evidence API:

```http
POST /evidence-metadata HTTP/1.1
Host: evidence-api.internal
Authorization: Bearer <service-token>
X-End-User-Subject: user-456
X-Correlation-Id: 01J...
```

Evidence API must validate:

```text
service token audience == evidence-api
service subject == case-api
service scope includes evidence:write
end-user context is trusted/signed or comes through approved path
```

Do not trust `X-End-User-Subject` from arbitrary clients.

### 44.3 External Respondent Portal

External respondent may have limited identity:

```text
principal.type = EXTERNAL_RESPONDENT
case access = only cases where respondent_party_id matches
allowed actions = submit response, upload evidence, view own notices
```

This must not be modeled as generic `USER` with broad tenant claim.

---

## 45. Testing Authentication

Authentication tests should cover more than happy path.

### 45.1 Token Tests

- missing token;
- malformed Authorization header;
- unsupported scheme;
- expired token;
- future `nbf`;
- wrong issuer;
- wrong audience;
- invalid signature;
- unknown key ID;
- missing scope;
- wrong tenant;
- valid token but disabled user;
- valid token but revoked session.

### 45.2 Header Trust Tests

- direct request with spoofed identity header;
- request through gateway with stripped/recreated header;
- duplicate Authorization headers;
- huge token header;
- mixed case header names.

### 45.3 Session Tests

- cookie missing;
- cookie expired;
- session revoked;
- session fixation attempt;
- CSRF mutation without token;
- logout invalidates session;
- session rotation on login.

### 45.4 API Key Tests

- missing key;
- invalid key;
- revoked key;
- expired key;
- key for wrong tenant;
- key with missing scope;
- key rotation overlap;
- key leakage redaction in logs.

---

## 46. Common Interview-Level vs Production-Level Understanding

### 46.1 Interview-Level Answer

> “Use JWT in Authorization header and validate it.”

### 46.2 Production-Level Answer

> “Use access tokens in Authorization header, validate signature, issuer, audience, expiry, algorithm, and required claims. Keep token lifetime short. Redact credentials from logs. Decide whether gateway, app, or both validate. Ensure app cannot be bypassed if it trusts gateway headers. Model principal separately from domain user. Separate authentication from resource-level authorization. Return 401 with appropriate `WWW-Authenticate` for missing/invalid credentials and 403 for authenticated-but-forbidden. Monitor failure rates, JWKS refresh, introspection latency, and reject fail-open behavior.”

That is the level this series targets.

---

## 47. Minimal Reference Architecture

For a serious Java backend API:

```text
Client
  -> HTTPS
  -> WAF/CDN
  -> API Gateway
       - TLS termination
       - coarse auth validation
       - rate limiting
       - request size limit
       - strip spoofed identity headers
  -> Application Service
       - validate token audience/issuer/scope or validate signed gateway assertion
       - construct CurrentPrincipal
       - enforce domain authorization
       - audit security event
  -> Downstream Services
       - service-to-service auth via mTLS/client credentials
       - propagate user context safely
```

Key invariant:

```text
No application operation should rely on identity data that came from an untrusted client-controlled field.
```

---

## 48. Exercises

### Exercise 1 — Status Code Decision

For each case, choose `401`, `403`, `404`, or `503`:

1. No `Authorization` header on protected endpoint.
2. Expired access token.
3. Valid token, missing `case:approve` scope.
4. Valid token, correct scope, but case belongs to another tenant.
5. Token introspection service down.
6. Valid token, user tries to access sealed case hidden by policy.

Explain your policy.

### Exercise 2 — JWT Validator Design

Design a validator for `case-api` that enforces:

- issuer = `https://identity.example.com`;
- audience = `case-api`;
- accepted algorithm = `RS256`;
- required claim = `tenant_id`;
- max clock skew = 60 seconds;
- scope contains endpoint-required scope.

Write pseudocode.

### Exercise 3 — Gateway Trust Boundary

You have this architecture:

```text
Internet -> API Gateway -> Case API
```

Gateway forwards:

```http
X-User-Id
X-Tenant-Id
X-User-Roles
```

List the controls needed before Case API may trust those headers.

### Exercise 4 — API Key Model

Design table fields for API key authentication supporting:

- key rotation;
- tenant binding;
- expiry;
- scope;
- revocation;
- last used timestamp;
- hashed secret storage.

### Exercise 5 — Multi-Identity Request

Case API calls Evidence API on behalf of investigator Alice.

Model:

- service identity;
- end-user identity;
- tenant;
- allowed operation;
- audit event fields.

---

## 49. Part Summary

Authentication over HTTP is not just “check login”.

Backend engineer must reason about:

- credential carrier;
- validation authority;
- HTTP failure semantics;
- token claims;
- audience/issuer/expiry;
- trust boundaries;
- proxy/gateway behavior;
- session/cookie risks;
- API key lifecycle;
- mTLS service identity;
- principal construction;
- identity propagation;
- observability;
- failure modes;
- secure logging;
- multi-tenant implications.

A strong backend engineer does not merely ask:

```text
Is there a token?
```

They ask:

```text
Who issued it?
Who is it for?
What subject does it represent?
What type of identity is this?
Is it still valid?
Can this layer trust it?
What happens if validation infrastructure fails?
What will downstream services receive?
What is logged and audited?
```

---

## 50. What Comes Next

Next part:

```text
learn-http-for-web-backend-perspective-part-015.md
```

Topic:

```text
Authorization and Resource-Level Security
```

Authentication establishes identity. Authorization decides what that identity may do.

Part 015 will cover:

- object-level authorization;
- tenant boundary;
- ownership checks;
- relationship-based access;
- ABAC/RBAC/ReBAC;
- policy enforcement points;
- `403` vs `404`;
- auditability;
- authorization test matrix;
- regulatory workflow examples.

---

## Status Seri

Part ini adalah:

```text
Part 014 dari 032
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-013.md">⬅️ Part 013 — Caching for Backend Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-015.md">Part 015 — Authorization and Resource-Level Security ➡️</a>
</div>
