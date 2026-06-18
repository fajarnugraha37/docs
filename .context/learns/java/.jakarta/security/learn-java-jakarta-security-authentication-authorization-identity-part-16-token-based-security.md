# Part 16 — Token-Based Security in Jakarta Applications

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-16-token-based-security.md`  
> Target pembaca: Java/Jakarta engineer yang sudah memahami Servlet, JAX-RS, Jakarta Security, Jakarta Authentication, Jakarta Authorization, session security, dan domain authorization.  
> Fokus: memahami token sebagai objek keamanan di aplikasi Jakarta, bukan sekadar membaca JWT dan mengambil `sub`.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas session security: login state, `HttpSession`, cookie, timeout, logout, dan failure model ketika identity berubah tetapi session masih hidup.

Part ini membahas bentuk state lain yang sangat dominan di sistem modern: **token**.

Token sering terlihat sederhana:

```http
Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6Ij... 
```

Namun secara arsitektural token adalah salah satu sumber bug security terbesar karena banyak engineer memperlakukannya sebagai:

```text
ada token = user valid = boleh akses
```

Padahal model yang benar adalah:

```text
token adalah credential atau authorization artifact

yang harus divalidasi terhadap issuer, audience, waktu, signature/introspection,
client, subject, scope, context, tenant, dan policy aplikasi

baru setelah itu dapat ditransformasikan menjadi caller identity dan authorization input
```

Satu token bisa valid secara kriptografis tetapi tetap salah dipakai untuk API tertentu. Satu ID token bisa valid tetapi tidak boleh dipakai sebagai API access token. Satu access token bisa valid tetapi audience-nya bukan service kita. Satu JWT bisa signed tetapi issuer-nya tidak trusted. Satu token bisa belum expired tetapi subject-nya sudah disabled. Satu token bisa punya scope tetapi scope-nya bukan domain permission.

Part ini akan membangun mental model dari bawah sampai production design.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan access token, ID token, refresh token, opaque token, JWT, bearer token, proof-of-possession token, dan session cookie.
2. Mendesain validasi token yang benar untuk Servlet/JAX-RS/Jakarta Security application.
3. Menentukan kapan token divalidasi di gateway, kapan di aplikasi, dan kapan harus di dua-duanya.
4. Mengubah token claims menjadi Jakarta caller identity secara aman.
5. Memahami JWKS retrieval, key rotation, algorithm validation, issuer/audience validation, clock skew, dan caching.
6. Memahami token introspection untuk opaque token atau revocation-sensitive system.
7. Memahami token propagation antar service tanpa menciptakan confused deputy.
8. Mendesain authorization setelah token validation, bukan berhenti pada validasi token.
9. Membedakan authentication token, authorization token, delegation token, service token, dan audit actor.
10. Membuat failure model production untuk token-based architecture.

---

## 2. Mental Model: Token Bukan Identity Final

Token adalah **bukti** atau **artefak** yang menyatakan sesuatu. Tetapi aplikasi tidak boleh langsung menyamakan token dengan user final.

Model yang lebih aman:

```text
Raw request
  ↓
Extract token
  ↓
Classify token type
  ↓
Validate token integrity / activity
  ↓
Validate issuer, audience, time, client, binding
  ↓
Extract subject and claims
  ↓
Normalize identity
  ↓
Map claims/scopes/groups to application role/permission input
  ↓
Create Jakarta caller principal / security context
  ↓
Run application authorization
  ↓
Audit actor, token id, issuer, audience, client, scope, decision
```

Token validation hanya menjawab:

```text
Apakah token ini dapat dipercaya sebagai input identity/authorization?
```

Bukan:

```text
Apakah caller pasti boleh melakukan action ini?
```

Authorization tetap harus mengevaluasi:

```text
subject + action + resource + tenant + state + relationship + policy
```

---

## 3. Taxonomy Token

### 3.1 Access Token

Access token dipakai oleh client untuk mengakses protected resource/API.

Contoh:

```http
GET /api/cases/CASE-001
Authorization: Bearer <access_token>
```

Access token menjawab:

```text
Client/caller ini diberikan hak terbatas untuk memanggil resource server tertentu
selama periode tertentu
dengan scope/authorization context tertentu
```

Access token bukan bukti login UI. Access token adalah artifact authorization untuk resource server.

Validasi penting:

1. issuer,
2. audience,
3. expiry,
4. signature atau introspection active status,
5. scope,
6. client id,
7. subject,
8. token use/type,
9. not before,
10. key id,
11. algorithm.

---

### 3.2 ID Token

ID token adalah token OpenID Connect yang berisi claims tentang authentication event end-user.

ID token menjawab:

```text
User ini berhasil diautentikasi oleh OpenID Provider untuk client tertentu
```

ID token **bukan** access token untuk API.

Kesalahan umum:

```text
SPA login ke IdP → mendapatkan ID token → kirim ID token ke backend API → backend menerima sebagai authorization token
```

Ini salah secara model.

Kenapa?

Karena ID token ditujukan untuk **client/RP**, bukan untuk resource server API. Audience ID token biasanya client id, bukan API audience. Claims di dalamnya menjelaskan authentication, bukan grant akses API.

Backend API seharusnya menerima access token dengan audience API tersebut.

---

### 3.3 Refresh Token

Refresh token dipakai client untuk mendapatkan access token baru.

Refresh token memiliki risiko lebih tinggi karena lifetime-nya biasanya lebih panjang.

Prinsip:

1. Jangan kirim refresh token ke resource server.
2. Jangan simpan refresh token di browser storage tanpa desain mitigasi kuat.
3. Gunakan rotation jika didukung.
4. Deteksi reuse.
5. Perlakukan refresh token seperti long-lived secret.
6. Audit issuance, rotation, reuse, revocation.

Dalam Backend-for-Frontend/BFF pattern, refresh token idealnya tetap di server-side component, bukan di SPA.

---

### 3.4 Opaque Token

Opaque token adalah token yang tidak dapat dipahami resource server tanpa bertanya ke authorization server.

Contoh:

```text
3f72a76c-64ef-4d48-a889-61fb9858cabc
```

Opaque token biasanya divalidasi via introspection endpoint.

Kelebihan:

1. Mudah direvoke secara sentral.
2. Payload tidak bocor ke client/resource server.
3. Authorization server tetap menjadi sumber kebenaran.
4. Bisa mengubah metadata token tanpa mengubah format token.

Kekurangan:

1. Butuh network call ke authorization server.
2. Menambah latency.
3. Menambah coupling availability.
4. Perlu caching hati-hati.

---

### 3.5 JWT Access Token

JWT access token adalah access token yang payload-nya self-contained dan disigned.

Contoh struktur:

```text
base64url(header).base64url(payload).base64url(signature)
```

Header:

```json
{
  "alg": "RS256",
  "kid": "key-2026-01"
}
```

Payload:

```json
{
  "iss": "https://idp.example.com/realms/agency",
  "sub": "user-123",
  "aud": "case-management-api",
  "exp": 1790000000,
  "iat": 1789996400,
  "scope": "case.read case.update",
  "client_id": "agency-portal",
  "jti": "token-unique-id"
}
```

JWT access token bisa divalidasi lokal dengan public key issuer.

Kelebihan:

1. Tidak perlu network call per request.
2. Cocok untuk high-throughput APIs.
3. Bisa divalidasi di gateway dan aplikasi.
4. Interoperable.

Kekurangan:

1. Revocation lebih sulit.
2. Claims bisa stale sampai token expired.
3. Token bisa terlalu besar.
4. Banyak bug validasi karena engineer hanya decode tanpa verify.

---

### 3.6 Bearer Token

Bearer token berarti siapa pun yang memegang token dapat menggunakannya.

Model:

```text
possession = authorization to use
```

Risikonya jelas:

```text
Jika token bocor, attacker dapat memakainya sampai expired/revoked.
```

Karena itu bearer token harus:

1. dikirim hanya melalui TLS,
2. tidak dilog,
3. tidak disimpan sembarangan,
4. memiliki expiry pendek,
5. divalidasi ketat,
6. dibatasi audience dan scope,
7. diproteksi dari replay sesuai risiko sistem.

---

### 3.7 Proof-of-Possession Token

Proof-of-possession token mengikat token ke key atau channel tertentu.

Ide:

```text
Tidak cukup hanya membawa token.
Caller juga harus membuktikan memegang private key / binding secret.
```

Contoh konsep:

1. mTLS-bound access token,
2. DPoP-style proof,
3. token binding ke certificate thumbprint.

Dalam enterprise Java/Jakarta, ini sering muncul dalam high-assurance API, bank, gov integration, atau system-to-system integration.

---

### 3.8 Session Cookie vs Token

Session cookie juga bisa dianggap token, tetapi semantic-nya berbeda.

| Aspek | Session Cookie | Access Token |
|---|---|---|
| Primary use | Browser session | API access |
| State | Server-side session state | Self-contained atau introspected |
| Audience | Usually same web app | Resource server/API |
| Stored by | Browser cookie jar | Client/app memory/storage |
| Sent automatically by browser | Yes | Usually manually in Authorization header |
| CSRF risk | High if cookie credentials | Lower if header token, but XSS risk remains |
| Revocation | Easy if server-side session | Depends on token type |

Jangan memilih token hanya karena “stateless”. Stateless sering memindahkan kompleksitas dari server session ke token validation, revocation, key management, and stale claims.

---

## 4. Token Validation Pipeline

Token validation harus eksplisit, deterministic, dan auditable.

Pipeline umum:

```text
1. Extract
2. Parse safely
3. Identify token class
4. Validate transport context
5. Validate issuer
6. Resolve key or introspection endpoint
7. Validate signature/activity
8. Validate algorithm
9. Validate expiry/not-before/issued-at
10. Validate audience
11. Validate authorized party/client
12. Validate token type/use
13. Validate scope/claims sanity
14. Normalize subject
15. Map to application caller
16. Continue authorization
```

---

## 5. Step 1 — Extract Token

Biasanya token dikirim lewat:

```http
Authorization: Bearer <token>
```

Extraction rule harus ketat:

1. Header harus `Authorization`.
2. Scheme harus `Bearer`, case-insensitive tetapi parsing harus hati-hati.
3. Tidak boleh menerima multiple Authorization header kecuali policy jelas.
4. Tidak boleh fallback ke query parameter untuk API biasa.
5. Jangan menerima token dari cookie dan header sekaligus tanpa precedence eksplisit.
6. Jangan menerima token dari custom header yang bisa dipalsukan kecuali berasal dari trusted gateway boundary.

Contoh parsing buruk:

```java
String token = request.getHeader("Authorization").replace("Bearer ", "");
```

Masalah:

1. Null pointer.
2. Menerima prefix aneh.
3. Tidak mendeteksi malformed header.
4. Bisa salah jika ada spasi ganda.

Parsing lebih defensif:

```java
public final class BearerTokenExtractor {

    public Optional<String> extract(HttpServletRequest request) {
        String authorization = request.getHeader("Authorization");
        if (authorization == null || authorization.isBlank()) {
            return Optional.empty();
        }

        String[] parts = authorization.trim().split("\\s+", 2);
        if (parts.length != 2) {
            throw new InvalidBearerTokenException("Malformed Authorization header");
        }

        if (!"Bearer".equalsIgnoreCase(parts[0])) {
            return Optional.empty();
        }

        String token = parts[1].trim();
        if (token.isEmpty()) {
            throw new InvalidBearerTokenException("Empty bearer token");
        }

        return Optional.of(token);
    }
}
```

Catatan: jangan log token mentah.

---

## 6. Step 2 — Jangan Decode Tanpa Verify

JWT mudah di-decode karena header dan payload hanya Base64URL, bukan encrypted.

Ini bisa membuat engineer keliru:

```java
String[] chunks = jwt.split("\\.");
String payloadJson = new String(Base64.getUrlDecoder().decode(chunks[1]));
```

Decode bukan verify.

JWT payload dari attacker bisa dibuat sendiri:

```json
{
  "sub": "attacker",
  "roles": ["ADMIN"],
  "exp": 9999999999
}
```

Jika aplikasi hanya decode dan percaya claims, authorization bypass terjadi.

Rule:

```text
Never trust JWT claims before signature and semantic validation.
```

---

## 7. Step 3 — Validate Issuer

Issuer (`iss`) adalah pihak yang menerbitkan token.

Contoh:

```json
{
  "iss": "https://idp.example.com/realms/agency"
}
```

Aplikasi harus memiliki allowlist issuer.

Jangan:

```text
terima issuer apa pun lalu download JWKS dari issuer tersebut
```

Karena attacker bisa membuat issuer sendiri:

```json
{
  "iss": "https://evil.example.com"
}
```

Lalu aplikasi mengambil JWKS attacker dan token attacker menjadi valid.

Model yang benar:

```text
issuer dalam token harus sama persis dengan trusted issuer configuration
```

Perhatikan:

1. trailing slash,
2. realm path,
3. scheme HTTPS,
4. environment DEV/UAT/PROD,
5. custom domain vs internal domain,
6. multi-tenant issuer.

---

## 8. Step 4 — Validate Audience

Audience (`aud`) menjawab:

```text
Token ini ditujukan untuk siapa?
```

API hanya boleh menerima token yang audience-nya API tersebut.

Contoh benar:

```json
{
  "aud": "case-management-api"
}
```

Contoh salah:

```json
{
  "aud": "frontend-client"
}
```

Jika backend API menerima token dengan audience frontend client, berarti backend sedang menerima token yang bukan ditujukan untuknya.

Ini salah satu penyebab token substitution attack.

Rule:

```text
Signature valid tanpa audience valid = reject.
```

---

## 9. Step 5 — Validate Expiry, Not-Before, Issued-At

Claims waktu umum:

| Claim | Arti |
|---|---|
| `exp` | token expiry |
| `nbf` | not before |
| `iat` | issued at |

Validasi:

```text
now < exp
now >= nbf, if present
iat not unreasonably in future
```

Clock skew perlu ditoleransi sedikit, misalnya 30–120 detik, tergantung sistem.

Jangan memberi skew terlalu besar karena secara efektif memperpanjang lifetime token.

Contoh bug production:

```text
IdP clock +3 menit
API clock -2 menit
nbf dianggap future
semua request gagal 401
```

Mitigasi:

1. NTP/chrony benar,
2. monitor clock drift,
3. toleransi clock skew kecil,
4. alert jika banyak token gagal karena time validation.

---

## 10. Step 6 — Validate Signature and Algorithm

JWT signed menggunakan algoritma seperti RS256, ES256, EdDSA, atau HS256.

Security invariant:

```text
Aplikasi harus menentukan algoritma yang diizinkan dari konfigurasi, bukan percaya header token.
```

Jangan menerima `alg: none`.

Jangan mengizinkan algorithm confusion:

```text
Token header bilang HS256
Aplikasi memakai public key RSA sebagai HMAC secret
Attacker bisa forge token dalam implementasi rentan
```

Rule:

1. Allowlist algorithm.
2. Resolve key berdasarkan trusted issuer + `kid`.
3. Pastikan key type sesuai algorithm.
4. Reject unknown `kid` setelah refresh JWKS sesuai policy.
5. Jangan fallback ke key pertama tanpa verifikasi.
6. Jangan ignore signature failure.

---

## 11. Step 7 — JWKS Retrieval and Caching

JWKS adalah JSON Web Key Set: kumpulan public key issuer untuk memverifikasi JWT.

Contoh flow:

```text
Token header contains kid=key-2026-01
  ↓
API lookup key in local JWKS cache
  ↓
If key found → verify signature
  ↓
If key missing → refresh JWKS from trusted issuer endpoint
  ↓
Retry key lookup
  ↓
If still missing → reject
```

### 11.1 JWKS Cache Rule

JWKS caching harus menyeimbangkan:

1. performance,
2. key rotation responsiveness,
3. IdP availability,
4. denial-of-service risk.

Design:

```java
public interface JwksKeyResolver {
    PublicKey resolve(String issuer, String keyId, String algorithm);
}
```

Policy:

1. Cache JWKS per issuer.
2. Respect cache headers jika masuk akal.
3. Punya max TTL internal.
4. Refresh on unknown `kid`, tetapi rate-limit refresh.
5. Jangan refresh JWKS untuk setiap invalid token.
6. Jangan menerima JWKS URL dari token mentah.
7. Pin issuer/discovery configuration.

### 11.2 Key Rotation Failure Model

Common incident:

```text
IdP rotates signing key
API JWKS cache masih lama
new tokens rejected
users get 401
```

Mitigasi:

1. IdP publishes new key before signing with it.
2. API refreshes on unknown `kid`.
3. Alert on unknown `kid` spike.
4. Keep previous key until old tokens expire.
5. Deploy JWKS cache with safe TTL.

---

## 12. Step 8 — Validate Token Type / Use

Beberapa issuer menyertakan token type claim:

```json
{
  "typ": "Bearer",
  "token_use": "access"
}
```

Atau header:

```json
{
  "typ": "at+jwt"
}
```

Jangan menerima ID token di endpoint API hanya karena signature valid.

Validation harus bisa membedakan:

```text
Access token untuk resource server
ID token untuk client authentication event
Refresh token untuk token endpoint
```

---

## 13. Step 9 — Validate Authorized Party / Client

Beberapa token punya claim:

```json
{
  "azp": "agency-portal-client",
  "client_id": "agency-portal-client"
}
```

Ini penting ketika beberapa client bisa mendapatkan token untuk API yang sama.

Contoh policy:

```text
case-management-api menerima token audience case-management-api
hanya jika client_id/azp berada dalam allowlist:
- agency-portal-web
- agency-mobile-app
- internal-case-worker
```

Kenapa?

Karena audience valid belum tentu semua client boleh memakai API capability yang sama.

---

## 14. Step 10 — Validate Scope

Scope adalah authorization grant dari OAuth layer.

Contoh:

```json
{
  "scope": "case.read case.update"
}
```

Scope bukan domain permission final.

Lebih tepat:

```text
scope = coarse-grained permission granted to client/caller for API surface
application permission = fine-grained authorization decision over resource/domain state
```

Contoh:

```text
Token has scope case.update
```

Belum berarti user boleh update semua case.

Aplikasi masih harus mengecek:

1. case tenant,
2. case status,
3. assigned officer,
4. delegation,
5. maker-checker rule,
6. conflict of interest,
7. lock/version,
8. regulatory workflow.

---

## 15. Token to Jakarta Identity Mapping

Setelah token valid, aplikasi perlu mengubahnya menjadi identity yang dapat dipakai Jakarta/JAX-RS layer.

Mapping umum:

```text
JWT sub → CallerPrincipal name/internal subject id
JWT preferred_username/email → display/login hint only
JWT groups/roles → Jakarta groups/application role input
JWT scope → API capability input
JWT iss → identity provider context
JWT aud → resource context
JWT client_id/azp → client context
JWT jti → audit token id
```

Jangan jadikan email sebagai primary immutable identity kecuali domain memang menjamin email immutable.

Lebih aman:

```text
issuer + subject = federated stable identity key
```

Contoh:

```text
federated_identity_key = sha256(iss + "|" + sub)
```

Atau disimpan eksplisit:

```sql
USER_EXTERNAL_IDENTITY
- id
- user_id
- issuer
- subject
- provider_type
- linked_at
- last_seen_at
```

---

## 16. Jakarta Security Integration Options

Ada beberapa cara mengintegrasikan bearer token dengan aplikasi Jakarta.

### 16.1 Servlet Filter

```java
@WebFilter("/api/*")
public class BearerTokenFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        Optional<String> token = new BearerTokenExtractor().extract(request);
        if (token.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setHeader("WWW-Authenticate", "Bearer");
            return;
        }

        // Validate token, create app identity, store in request attribute, etc.
        chain.doFilter(request, response);
    }
}
```

Kelebihan:

1. mudah,
2. portable,
3. cocok untuk custom API gateway pattern.

Kekurangan:

1. belum tentu establish caller ke container,
2. `request.getUserPrincipal()` mungkin null,
3. `@RolesAllowed` mungkin tidak bekerja,
4. harus hati-hati wrapper request/security context.

---

### 16.2 JAX-RS ContainerRequestFilter

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class BearerTokenJaxRsFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext context) {
        String authorization = context.getHeaderString("Authorization");
        // extract, validate, set SecurityContext
    }
}
```

Kelebihan:

1. bagus untuk REST resource,
2. bisa set JAX-RS `SecurityContext`,
3. bisa return JSON error.

Kekurangan:

1. tidak melindungi non-JAX-RS endpoint,
2. tidak selalu integrate dengan Jakarta container principal,
3. method security berbasis Jakarta annotations bergantung implementasi/runtime.

---

### 16.3 Jakarta Security `HttpAuthenticationMechanism`

Ini lebih aligned dengan container security.

Pseudo-design:

```java
@ApplicationScoped
public class BearerTokenAuthenticationMechanism implements HttpAuthenticationMechanism {

    @Inject
    TokenValidator tokenValidator;

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) throws AuthenticationException {

        Optional<String> bearer = extractBearer(request);

        if (bearer.isEmpty()) {
            return context.doNothing();
        }

        TokenPrincipal principal = tokenValidator.validate(bearer.get());

        return context.notifyContainerAboutLogin(
                principal,
                principal.applicationGroups()
        );
    }
}
```

Kelebihan:

1. lebih sesuai container lifecycle,
2. bisa establish caller principal,
3. `SecurityContext` dan `isCallerInRole` lebih konsisten,
4. bisa bekerja dengan Jakarta Security abstractions.

Kekurangan:

1. butuh pemahaman container behavior,
2. portability detail antar server perlu dites,
3. error handling/challenge harus dirancang.

---

### 16.4 Jakarta Authentication / JASPIC ServerAuthModule

Ini low-level.

Dipakai jika:

1. perlu plug authentication ke container secara sangat spesifik,
2. perlu integrate dengan app server security realm,
3. ada gateway identity propagation enterprise,
4. perlu standard SPI lebih rendah dari Jakarta Security.

Kekurangan:

1. lebih kompleks,
2. deployment/registration vendor-specific,
3. debugging lebih sulit.

---

## 17. Recommended Layering

Untuk aplikasi Jakarta REST modern:

```text
HTTP request
  ↓
TLS/gateway checks
  ↓
Bearer token authentication mechanism/filter
  ↓
Token validator
  ↓
Identity mapper
  ↓
Container/JAX-RS security context
  ↓
Declarative coarse authorization
  ↓
Domain authorization service
  ↓
Business operation
  ↓
Audit
```

Jangan gabungkan semuanya di satu class filter 1000 baris.

Pisahkan:

```java
interface TokenExtractor {}
interface TokenClassifier {}
interface TokenValidator {}
interface JwksKeyResolver {}
interface IntrospectionClient {}
interface ClaimsNormalizer {}
interface TokenIdentityMapper {}
interface AuthorizationInputFactory {}
```

---

## 18. Example Domain Model for Token Validation Result

```java
public record ValidatedToken(
        TokenKind kind,
        String issuer,
        String subject,
        Set<String> audience,
        String clientId,
        Instant issuedAt,
        Instant expiresAt,
        String tokenId,
        Set<String> scopes,
        Map<String, Object> claims
) {
    public boolean hasAudience(String expectedAudience) {
        return audience.contains(expectedAudience);
    }

    public boolean hasScope(String scope) {
        return scopes.contains(scope);
    }
}
```

```java
public enum TokenKind {
    ACCESS_TOKEN,
    ID_TOKEN,
    REFRESH_TOKEN,
    UNKNOWN
}
```

Mapping ke application actor:

```java
public record ApplicationActor(
        String actorId,
        String issuer,
        String externalSubject,
        String displayName,
        Set<String> applicationRoles,
        Set<String> apiScopes,
        String clientId,
        String tokenId
) {}
```

Perhatikan: `ApplicationActor` bukan raw JWT. Ia adalah hasil normalisasi.

---

## 19. Example Token Validator Policy

```java
public record TokenValidationPolicy(
        String expectedIssuer,
        String expectedAudience,
        Set<String> allowedAlgorithms,
        Set<String> allowedClientIds,
        Duration allowedClockSkew,
        boolean requireTokenId,
        boolean requireSubject,
        boolean requireExpiry
) {}
```

Validation logic harus explicit:

```java
public final class JwtAccessTokenValidator {

    private final TokenValidationPolicy policy;
    private final JwksKeyResolver keyResolver;
    private final Clock clock;

    public ValidatedToken validate(String rawToken) {
        ParsedJwt parsed = parse(rawToken);

        validateHeader(parsed.header());
        validateIssuer(parsed.claims());
        PublicKey key = keyResolver.resolve(
                policy.expectedIssuer(),
                parsed.header().keyId(),
                parsed.header().algorithm()
        );
        verifySignature(parsed, key);
        validateTime(parsed.claims());
        validateAudience(parsed.claims());
        validateClient(parsed.claims());
        validateTokenUse(parsed.claims(), parsed.header());

        return normalize(parsed.claims());
    }

    private void validateHeader(JwtHeader header) {
        if (!policy.allowedAlgorithms().contains(header.algorithm())) {
            throw new InvalidTokenException("Unsupported JWT algorithm");
        }
        if (header.keyId() == null || header.keyId().isBlank()) {
            throw new InvalidTokenException("Missing key id");
        }
    }
}
```

Jangan gunakan contoh ini sebagai copy-paste library final. Di production gunakan library JWT/OIDC mature dan bungkus dengan policy eksplisit.

---

## 20. 401 vs 403 Dalam Token-Based API

### 20.1 401 Unauthorized

Gunakan 401 jika:

1. token tidak ada,
2. token malformed,
3. token expired,
4. signature invalid,
5. issuer invalid,
6. audience invalid,
7. introspection inactive.

Header:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token"
```

Jangan terlalu detail ke client publik.

### 20.2 403 Forbidden

Gunakan 403 jika:

1. token valid,
2. caller authenticated,
3. tetapi tidak punya permission/scope/domain access.

Contoh:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "forbidden",
  "message": "You do not have access to this resource.",
  "correlationId": "req-123"
}
```

Internal audit boleh menyimpan detail:

```text
actor=user-123 action=CASE_APPROVE resource=CASE-001 reason=NOT_ASSIGNED_APPROVER
```

---

## 21. Token Introspection

Token introspection adalah mekanisme resource server bertanya ke authorization server:

```text
Apakah token ini aktif?
Apa metadata authorization context-nya?
```

Request konseptual:

```http
POST /introspect
Authorization: Basic <resource-server-client-auth>
Content-Type: application/x-www-form-urlencoded

token=<opaque-or-jwt-token>
```

Response konseptual:

```json
{
  "active": true,
  "sub": "user-123",
  "client_id": "agency-portal",
  "scope": "case.read case.update",
  "exp": 1790000000,
  "iss": "https://idp.example.com/realms/agency",
  "aud": "case-management-api"
}
```

Jika `active=false`, reject.

### 21.1 Kapan Introspection Cocok?

Gunakan introspection jika:

1. token opaque,
2. revocation harus cepat,
3. authorization server ingin kontrol sentral,
4. API volume masih manageable,
5. high-risk transaction butuh fresh status,
6. token metadata terlalu sensitif untuk JWT.

### 21.2 Kapan JWT Local Validation Lebih Cocok?

Gunakan local JWT validation jika:

1. API high throughput,
2. latency rendah penting,
3. token lifetime pendek,
4. revocation near-real-time tidak mandatory,
5. issuer key rotation mature,
6. service mesh/gateway sudah membantu.

### 21.3 Hybrid Pattern

Banyak sistem enterprise memakai hybrid:

```text
Normal read/update API → JWT local validation
High-risk action → extra introspection/fresh policy check
Admin revoke event → short token TTL + session/token cache invalidation
```

---

## 22. Token Revocation

JWT self-contained tidak otomatis tahu bahwa user dinonaktifkan setelah token diterbitkan.

Contoh:

```text
09:00 user gets JWT exp 10:00
09:10 admin disables user
09:15 user still has valid JWT
```

Solusi tergantung risiko:

1. short-lived access token,
2. introspection,
3. revocation list by `jti`,
4. user/session version claim,
5. global not-before timestamp,
6. token exchange with fresh policy,
7. event-driven cache invalidation.

### 22.1 User Version Pattern

User table:

```sql
USER_ACCOUNT
- id
- status
- token_version
- disabled_at
```

Token claim:

```json
{
  "sub": "user-123",
  "ver": 7
}
```

API checks:

```text
token.ver == user.token_version
```

If password reset/role revoke/disable:

```sql
UPDATE USER_ACCOUNT SET token_version = token_version + 1 WHERE id = ?
```

Trade-off:

1. butuh DB/cache lookup,
2. menambah latency,
3. lebih fresh.

---

## 23. Token Replay

Bearer token bisa direplay jika bocor.

Attack:

```text
Attacker obtains access token from log/browser/proxy/memory
Attacker sends same token to API
API accepts until expiry
```

Mitigasi:

1. TLS everywhere,
2. no token in logs,
3. short TTL,
4. audience restriction,
5. scope minimization,
6. sender-constrained token,
7. mTLS-bound token,
8. DPoP-like proof,
9. anomaly detection,
10. rate limiting,
11. token revocation.

Untuk high-risk APIs, bearer token saja mungkin tidak cukup.

---

## 24. Token Propagation

Token propagation adalah meneruskan identity/authorization context dari satu service ke service lain.

Contoh:

```text
Frontend → Case API → Document API → Audit API
```

Pertanyaan penting:

```text
Apakah Case API harus meneruskan token user asli?
Atau menukar token menjadi token downstream?
Atau menggunakan service credential plus on-behalf-of actor?
```

### 24.1 Forward Original User Token

```text
Case API forwards Authorization: Bearer <user-token> to Document API
```

Kelebihan:

1. downstream tahu user asli,
2. authorization per user bisa dilakukan downstream.

Kekurangan:

1. audience mungkin salah,
2. downstream menerima token yang tidak ditujukan untuknya,
3. token leak surface bertambah,
4. setiap service perlu validasi lengkap,
5. confused deputy risk.

Forward token hanya aman jika token memang punya audience downstream atau memakai token exchange.

---

### 24.2 Service Token Only

```text
Case API calls Document API with service credential
```

Kelebihan:

1. simple,
2. downstream trust service.

Kekurangan:

1. user context hilang,
2. audit melemah,
3. service bisa menjadi confused deputy,
4. authorization per user di downstream tidak terjadi.

Harus ada `onBehalfOf` audit context jika memakai pattern ini.

---

### 24.3 Token Exchange / On-Behalf-Of

Ideal untuk banyak enterprise architecture:

```text
Case API receives user token
Case API asks authorization server for downstream token
Downstream token audience = Document API
Downstream token includes actor/delegation context
```

Model:

```text
User delegated Case API to call Document API for specific purpose
```

Kelebihan:

1. audience benar,
2. scope bisa dipersempit,
3. audit lebih jelas,
4. downstream tidak menerima token sembarang.

Kekurangan:

1. kompleks,
2. butuh IdP/authorization server support,
3. caching dan latency perlu dirancang.

---

## 25. Confused Deputy Problem

Confused deputy terjadi ketika service yang punya privilege tinggi dipakai oleh caller privilege rendah untuk melakukan aksi yang caller tidak boleh lakukan.

Contoh:

```text
User A tidak boleh baca Document X
User A boleh panggil Case API
Case API punya service credential ke Document API
Case API tidak cek authorization Document X
Document API trust Case API
Document X bocor ke User A
```

Mitigasi:

1. upstream checks user authorization,
2. downstream also checks user/on-behalf-of context,
3. token exchange with constrained scope/resource,
4. audit actor + service actor,
5. never treat internal service call as automatically authorized.

---

## 26. Gateway Validation vs Application Validation

### 26.1 Gateway-Only Validation

```text
Gateway validates token
Gateway forwards request to app with identity headers
App trusts gateway
```

Kelebihan:

1. central validation,
2. consistent edge enforcement,
3. reduce duplicate code.

Risiko:

1. app vulnerable if bypass gateway,
2. header spoofing,
3. app may lose claims needed for domain auth,
4. role mapping hidden at gateway,
5. audit incomplete.

Harus ada:

1. network boundary enforcement,
2. trusted header stripping at gateway,
3. mTLS gateway-to-app,
4. app validates source,
5. app-level authorization remains.

---

### 26.2 Application Validation

```text
App validates token directly
```

Kelebihan:

1. strong app autonomy,
2. claims available,
3. better domain authorization,
4. safer if internal route exposed accidentally.

Kekurangan:

1. repeated implementation,
2. key cache per app,
3. inconsistent validation if not standardized.

---

### 26.3 Defense-in-Depth Pattern

Recommended for important systems:

```text
Gateway validates coarse token and route policy
Application validates token/audience/claims relevant to itself
Application performs domain authorization
```

Gateway protects perimeter. Application protects business invariants.

---

## 27. Token Storage in Browser and Clients

### 27.1 SPA Storage Choices

Common places:

1. memory,
2. sessionStorage,
3. localStorage,
4. cookie,
5. IndexedDB.

Trade-off:

| Storage | XSS Risk | CSRF Risk | Persistence | Notes |
|---|---:|---:|---:|---|
| Memory | Lower | Low | Lost on refresh | Better but UX complexity |
| localStorage | High | Low | Persistent | Common but risky under XSS |
| sessionStorage | High | Low | Tab session | Still readable by JS |
| HttpOnly cookie | Lower XSS read | Higher CSRF if not mitigated | Configurable | Needs SameSite/CSRF/BFF design |

No storage is magic. Browser token security is a trade-off between XSS, CSRF, UX, and architecture.

### 27.2 BFF Pattern

Backend-for-Frontend:

```text
Browser stores only HttpOnly session cookie
BFF stores/handles tokens server-side
BFF calls APIs
```

Kelebihan:

1. tokens not exposed to browser JS,
2. easier refresh token protection,
3. central session/logout,
4. better for enterprise SPA.

Kekurangan:

1. needs server-side state,
2. CSRF mitigation required,
3. BFF becomes critical component.

---

## 28. Token Logging and Observability

Never log raw tokens.

Bad:

```text
Authorization: Bearer eyJhbGciOi...
```

Better audit fields:

```text
issuer=https://idp.example.com/realms/agency
subject=user-123
client_id=agency-portal
aud=case-management-api
jti_hash=sha256(jti)
scopes=[case.read, case.update]
exp=2026-06-17T10:10:00Z
correlation_id=req-abc
```

If no `jti`, log token fingerprint only after hashing carefully:

```text
token_fingerprint = base64url(sha256(rawToken))[0..16]
```

But still avoid creating a reusable secret in logs.

---

## 29. Token-Based Authorization Anti-Patterns

### 29.1 “JWT Valid = Authorized”

Wrong:

```java
if (jwtValidator.isValid(token)) {
    approveCase(caseId);
}
```

Correct:

```java
ValidatedToken token = jwtValidator.validate(rawToken);
ApplicationActor actor = identityMapper.map(token);
caseAuthorization.require(actor, APPROVE_CASE, caseId);
approveCase(caseId);
```

---

### 29.2 Trusting `roles` Claim Directly

Wrong:

```java
if (claims.get("roles").contains("ADMIN")) allow();
```

Better:

```text
roles claim from trusted issuer + trusted client + expected audience
  ↓
normalized by mapping table/versioned policy
  ↓
application role input
  ↓
domain permission decision
```

---

### 29.3 Accepting Tokens From Multiple Issuers Without Isolation

Bad:

```text
Accept tokens from any configured issuer and merge roles by same role names.
```

Problem:

```text
Issuer A role ADMIN may not mean same as Issuer B role ADMIN.
```

Better:

```text
issuer-aware role mapping
```

---

### 29.4 Long-Lived JWT With Rich Roles

Problem:

```text
JWT expires in 8 hours
roles embedded in JWT
admin removes user's role at 09:30
token remains role-rich until 17:00
```

Better:

1. short access token lifetime,
2. refresh with updated claims,
3. role version check,
4. introspection for high-risk actions,
5. policy lookup at authorization time.

---

### 29.5 Passing ID Token to API

Already covered, but worth repeating:

```text
ID token authenticates user to client.
Access token authorizes client/caller to access API.
```

---

## 30. Multi-Tenant Token Considerations

Token may contain tenant/organization claims:

```json
{
  "sub": "user-123",
  "tenant_id": "agency-a",
  "roles": ["case_officer"]
}
```

But tenant claim alone is not always enough.

Questions:

1. Is tenant selected by user at login?
2. Can user belong to multiple tenants?
3. Is token bound to active tenant?
4. Can caller switch tenant without reauth/token exchange?
5. Does resource tenant match token tenant?
6. Are roles tenant-scoped?
7. Are global admins represented safely?

Authorization tuple:

```text
subject=user-123
action=CASE_UPDATE
resource=CASE-001
resourceTenant=agency-a
tokenTenant=agency-a
relationship=assignedOfficer
state=UNDER_REVIEW
```

Never rely only on UI tenant selector.

---

## 31. Token-Based Security in Case/Workflow Systems

For regulatory/case systems, token scopes are almost always too coarse.

Example token:

```json
{
  "scope": "case.read case.update case.approve",
  "roles": ["case_manager"]
}
```

Still need domain checks:

```text
Can this actor approve this specific case right now?
```

Policy inputs:

1. actor identity,
2. actor roles,
3. actor tenant,
4. case tenant,
5. case current state,
6. assignment,
7. previous actor actions,
8. maker-checker constraints,
9. delegation,
10. escalation,
11. lock/version,
12. compliance flags.

Failure case:

```text
Token role = case_manager
Endpoint = POST /cases/{id}/approve
Code only checks role
Manager approves case they created
Segregation-of-duties violation
```

Correct:

```java
caseAuthorization.require(actor, APPROVE_CASE, caseId);
```

Inside:

```text
role case_manager? yes
same tenant? yes
case state approvable? yes
actor not maker? yes
actor assigned as approver? yes
no conflict flag? yes
case version current? yes
```

---

## 32. Java 8–25 Considerations

### 32.1 Java 8

Many legacy Jakarta/Java EE apps still run on Java 8.

Concern:

1. old TLS defaults,
2. old HTTP client ergonomics,
3. old libraries,
4. older app server constraints,
5. `javax.*` namespace common.

### 32.2 Java 11/17

Common enterprise LTS base.

Benefits:

1. better TLS defaults,
2. built-in `java.net.http.HttpClient` from Java 11,
3. mature JWT/OIDC libraries,
4. better container support.

### 32.3 Java 21+

Virtual threads make concurrency cheaper but do not eliminate security context concerns.

Token validation services must still ensure:

1. no identity stored in unsafe static/thread local without lifecycle control,
2. context propagation is explicit,
3. blocking JWKS/introspection calls are bounded by timeout,
4. high concurrency does not amplify IdP outage.

### 32.4 Java 25

For Java 25-era systems, expect stronger movement toward:

1. structured concurrency patterns,
2. newer TLS/JCA defaults,
3. containerized Jakarta EE runtimes,
4. modern OIDC/FAPI patterns,
5. short-lived tokens and sender-constrained tokens in high-assurance domains.

The architectural invariant remains unchanged:

```text
Validate token semantics before identity mapping, then perform domain authorization.
```

---

## 33. Timeout, Retry, and Circuit Breaker

Token validation may call external systems:

1. JWKS endpoint,
2. discovery endpoint,
3. introspection endpoint,
4. userinfo endpoint,
5. role mapping service.

Never call these without timeout.

Recommended:

```text
JWKS refresh timeout: short, e.g. 1–3 seconds
Introspection timeout: bounded, e.g. 500ms–2s depending SLA
Retry: limited, only safe errors
Circuit breaker: yes for IdP dependency
Fallback: never accept invalid token just because IdP down
```

Critical rule:

```text
Fail closed for authentication/authorization.
```

But fail closed carefully:

1. return correct 401/503 depending situation,
2. avoid infinite retry storm,
3. protect IdP,
4. expose operational alert.

---

## 34. Caching Token Validation

Caching can reduce cost but can break revocation/freshness.

Cache candidates:

1. JWKS keys,
2. introspection active result,
3. normalized identity mapping,
4. role mapping,
5. user account status,
6. domain permission result.

Cache key must include enough context:

```text
token hash + issuer + audience + policy version
```

For authorization result:

```text
actor + action + resource + tenant + state/version + policy version
```

Never cache broad decision like:

```text
user-123 is allowed to approve
```

Cache specific decision:

```text
user-123 allowed APPROVE_CASE on CASE-001 at version 17 under policy v42
```

Even then, be careful.

---

## 35. Example HTTP Error Strategy

### Missing Token

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="case-api"
```

### Expired Token

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token", error_description="Token expired"
```

For public clients, avoid too much detail if it helps attackers. For internal trusted clients, detail can be balanced.

### Insufficient Scope

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="case.approve"
```

### Domain Permission Denied

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "forbidden",
  "code": "CASE_APPROVAL_NOT_ALLOWED",
  "correlationId": "req-abc"
}
```

---

## 36. Testing Token-Based Security

### 36.1 Positive Tests

1. valid JWT accepted,
2. valid opaque token active accepted,
3. correct issuer accepted,
4. correct audience accepted,
5. correct scope accepted,
6. valid role mapping works.

### 36.2 Negative Tests

Test all of these:

1. missing token,
2. malformed header,
3. malformed JWT,
4. unsigned JWT,
5. wrong algorithm,
6. wrong signature,
7. wrong issuer,
8. wrong audience,
9. expired token,
10. not-before in future,
11. missing subject,
12. missing expiry,
13. wrong token type,
14. ID token used as access token,
15. unknown `kid`,
16. JWKS unavailable,
17. introspection inactive,
18. insufficient scope,
19. valid token but wrong tenant,
20. valid token but domain permission denied.

### 36.3 Attack Simulation

1. Forge JWT with admin role and no signature.
2. Change `alg` from RS256 to HS256.
3. Use token from another environment.
4. Use token for frontend client as API token.
5. Replay token after logout.
6. Use expired token around clock skew boundary.
7. Rotate JWKS and test unknown `kid` refresh.
8. Disable user while token active.
9. Remove role while token active.
10. Attempt cross-tenant resource access.

---

## 37. Observability and Runbook

Metrics:

1. token validation success count,
2. token validation failure by reason,
3. issuer distribution,
4. audience mismatch count,
5. expired token count,
6. signature failure count,
7. unknown `kid` count,
8. JWKS refresh success/failure,
9. introspection latency,
10. introspection failure,
11. insufficient scope count,
12. domain authorization deny count,
13. token replay suspicion,
14. 401/403 rate.

Logs should include:

1. correlation id,
2. endpoint,
3. issuer,
4. subject hash/internal id,
5. client id,
6. audience,
7. token id hash,
8. decision,
9. denial reason category.

Do not log:

1. raw token,
2. refresh token,
3. authorization header,
4. sensitive claims,
5. PII unless justified and protected.

---

## 38. Production Checklist

Token validation checklist:

```text
[ ] Authorization header parsing strict
[ ] Bearer scheme required
[ ] Raw token never logged
[ ] JWT signature verified
[ ] Algorithm allowlist enforced
[ ] `alg=none` rejected
[ ] Trusted issuer allowlist enforced
[ ] Audience validated
[ ] Expiry validated
[ ] Not-before validated
[ ] Issued-at sanity checked
[ ] Clock skew bounded
[ ] Token type/use validated
[ ] Client/azp validated if needed
[ ] Scope parsed and normalized
[ ] Claims not trusted before validation
[ ] JWKS cache per issuer
[ ] JWKS refresh on unknown kid with rate limit
[ ] Introspection timeout configured if used
[ ] Introspection result cache TTL bounded if used
[ ] Token mapped to application actor explicitly
[ ] Role/group mapping issuer-aware
[ ] ID token rejected for API access
[ ] Domain authorization runs after token validation
[ ] 401/403 semantics correct
[ ] Audit event emitted
[ ] Token validation metrics emitted
[ ] Revocation strategy documented
[ ] Key rotation tested
[ ] Cross-tenant tests exist
[ ] Negative attack tests exist
```

---

## 39. Core Design Heuristics

1. **Token validation is authentication input validation, not full authorization.**
2. **ID token is not access token.**
3. **Signature valid is not enough; issuer and audience matter.**
4. **Scope is not domain permission.**
5. **JWT claims are stale by design until token expiry.**
6. **Opaque token improves central control but adds runtime dependency.**
7. **Gateway validation does not remove application authorization responsibility.**
8. **Never accept issuer/JWKS location from untrusted token data.**
9. **Never log raw tokens.**
10. **Always audit actor, client, issuer, token id, action, resource, and decision.**
11. **Propagating original token downstream is not always correct; audience matters.**
12. **Internal network is not an authorization model.**
13. **Short token lifetime is a security control, not just configuration.**
14. **Revocation is a system design problem, not a JWT library option.**
15. **For workflow systems, final authorization must be domain/state-aware.**

---

## 40. Final Mental Model

Token-based security in Jakarta applications should be understood as a pipeline:

```text
HTTP credential extraction
  ↓
cryptographic / introspection validation
  ↓
semantic validation
  ↓
identity normalization
  ↓
Jakarta caller establishment
  ↓
coarse authorization
  ↓
domain authorization
  ↓
audit and observability
```

The most common mistake is stopping too early:

```text
JWT decoded → sub exists → roles claim exists → allow
```

A top-tier engineer thinks instead:

```text
Which issuer produced this token?
Was it intended for this API?
Is this token type acceptable?
Is the signature valid under trusted keys?
Is the token still temporally valid?
Which client obtained it?
What scopes were granted?
How do those scopes map to API capabilities?
Which stable application actor does this represent?
What tenant/resource/state relationship is being accessed?
What policy version produced the decision?
How will we audit and debug this later?
What happens if the IdP rotates keys, goes down, or user roles change?
```

That is the mental model required for secure enterprise Java/Jakarta systems.

---

## 41. What We Intentionally Did Not Repeat

We did not repeat general cryptography details such as RSA internals, ECDSA math, hashing primitives, TLS handshake internals, or password hashing internals because those belong to the earlier Java security/cryptography series.

This part focused on the enterprise application security concern:

```text
How token artifacts enter Jakarta applications,
how they become caller identity,
how they should not be confused with final authorization,
and how they fail in production.
```

---

## 42. Part Summary

In this part, we learned:

1. Token is not final identity or final permission.
2. Access token, ID token, refresh token, JWT, opaque token, bearer token, and session cookie have different semantics.
3. JWT must be verified and semantically validated, not merely decoded.
4. Issuer and audience validation are mandatory.
5. JWKS caching and key rotation are production-critical.
6. Opaque token introspection gives central control but adds dependency.
7. Token claims must be normalized before becoming application identity.
8. Jakarta integration can happen via Servlet filter, JAX-RS filter, Jakarta Security `HttpAuthenticationMechanism`, or Jakarta Authentication module.
9. Gateway validation is useful but insufficient for domain authorization.
10. Token propagation must avoid confused deputy and audience misuse.
11. Revocation, replay, caching, and stale claims require explicit architecture.
12. For case/workflow systems, domain authorization remains mandatory after token validation.

---

## 43. Status Seri

Selesai:

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
Part 11 — Jakarta Authorization / JACC Deep Dive
Part 12 — Declarative Authorization: URL, Method, Class, Role
Part 13 — Programmatic Authorization and Domain Permission Design
Part 14 — Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning
Part 15 — Session Security: Login State, HttpSession, Cookies, Logout
Part 16 — Token-Based Security in Jakarta Applications
```

Berikutnya:

```text
Part 17 — OpenID Connect in Jakarta Security
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java Jakarta Security Authentication Authorization Identity](./learn-java-jakarta-security-authentication-authorization-identity-part-15-session-security-login-cookies-logout.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 17 — OpenID Connect in Jakarta Security](./learn-java-jakarta-security-authentication-authorization-identity-part-17-openid-connect-jakarta-security.md)
