# Part 18 — OAuth2 Resource Server Pattern for JAX-RS and Servlet APIs

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-18-oauth2-resource-server-jaxrs-servlet.md`  
> Target: Java 8–25, Java EE/Jakarta EE, Servlet, JAX-RS/Jakarta REST, Jakarta Security, Jakarta Authentication, MicroProfile-style ecosystem, enterprise API security.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas token-based security dan OIDC dari sisi login/identity. Bagian ini fokus pada sisi yang berbeda:

> **Bagaimana aplikasi Java/Jakarta bertindak sebagai OAuth2 Resource Server.**

Resource server adalah API/backend yang menerima request dari client dengan membawa access token, lalu memutuskan:

1. apakah token itu valid,
2. apakah token itu memang ditujukan untuk API ini,
3. siapa subject/caller-nya,
4. client mana yang bertindak,
5. scope/claim/role apa yang boleh digunakan,
6. resource/action apa yang diminta,
7. apakah request boleh diproses,
8. identitas apa yang harus diteruskan ke layer domain dan downstream service.

Bagian ini tidak mengulang OAuth2/OIDC secara penuh. Fokusnya adalah **resource server engineering** dalam aplikasi Jakarta:

- Servlet filter,
- JAX-RS `ContainerRequestFilter`,
- Jakarta Security `HttpAuthenticationMechanism`,
- Jakarta Authentication/JASPIC,
- gateway integration,
- JWT/opaque token validation,
- `401` vs `403`,
- `WWW-Authenticate`,
- claim/scope mapping,
- token propagation,
- testing,
- failure modelling.

Mental model utama:

```text
OAuth2 Resource Server bukan "API yang decode JWT".

Resource Server adalah enforcement boundary yang mengubah access token
menjadi keputusan akses yang aman, auditable, dan sesuai konteks API.
```

---

## 1. Resource Server Mental Model

Dalam OAuth2, ada beberapa aktor utama:

```text
+-------------------+        +------------------------+
| Client            |        | Authorization Server   |
| SPA/mobile/server | -----> | issues access token    |
+-------------------+        +------------------------+
          |
          | HTTP request + access token
          v
+-------------------+
| Resource Server   |
| Jakarta API       |
+-------------------+
          |
          | protected resource
          v
+-------------------+
| Domain/Data       |
+-------------------+
```

Resource server tidak login user secara langsung seperti OIDC RP/browser login. Ia menerima **access token** sebagai bukti otorisasi dari authorization server.

Namun ada jebakan besar:

```text
Token valid secara kriptografis belum tentu request boleh diproses.
```

Sebuah token bisa:

- signature valid,
- belum expired,
- issuer benar,
- tapi audience salah,
- scope tidak cukup,
- tenant tidak sesuai,
- subject sudah disabled,
- role mapping berubah,
- token ditujukan untuk service lain,
- token dipakai untuk action yang salah,
- token hasil client credentials tetapi diperlakukan seperti user token.

Maka resource server perlu pipeline yang lebih kaya daripada `JWT.parse()`.

---

## 2. Bedakan Login Application vs API Resource Server

### 2.1 Browser Login App

Pada browser login app:

```text
Browser -> App -> Authorization Server -> App callback -> session created
```

Aplikasi biasanya:

- redirect ke IdP,
- menerima authorization code,
- menukar code menjadi token,
- memvalidasi ID token,
- membuat server-side session,
- menyimpan identity di session.

Output utamanya:

```text
HttpSession + authenticated caller
```

### 2.2 Resource Server API

Pada resource server:

```text
Client -> API Authorization: Bearer <access_token>
```

API biasanya:

- tidak redirect ke login page,
- tidak memakai ID token sebagai login result,
- tidak membuat browser session untuk setiap bearer request,
- memvalidasi access token,
- membangun request-scoped security identity,
- mengevaluasi scope/role/domain permission.

Output utamanya:

```text
Request-scoped caller + authorization decision
```

### 2.3 Kesalahan Umum

Kesalahan yang sering terjadi:

```text
1. API menerima ID token sebagai access token.
2. API hanya decode JWT tanpa validasi signature.
3. API validasi signature tapi tidak cek audience.
4. API cek audience tapi tidak cek scope.
5. API cek scope tapi tidak cek tenant/resource ownership.
6. API menerima token dari issuer dev/staging di production.
7. API menerima token user untuk service-to-service operation yang harusnya client credentials.
8. API menganggap role token sebagai permission final.
```

Resource server yang benar harus menjawab minimal:

```text
Who issued this token?
Who/what is the subject?
For whom was this token issued?
For what API was it intended?
What operations are allowed?
What tenant/resource boundary applies?
Is the token still acceptable now?
How will this decision be audited?
```

---

## 3. Access Token Bukan ID Token

Ini salah satu invariant paling penting.

### 3.1 ID Token

ID token adalah token untuk client/RP agar client tahu bahwa end-user sudah authenticated oleh OpenID Provider.

Biasanya berisi claims seperti:

```json
{
  "iss": "https://idp.example.com/realms/main",
  "sub": "248289761001",
  "aud": "web-client",
  "exp": 1730000000,
  "iat": 1729996400,
  "nonce": "...",
  "name": "Alice"
}
```

ID token audience biasanya adalah **client application**, bukan API.

### 3.2 Access Token

Access token adalah credential untuk mengakses protected resource.

Biasanya berisi:

```json
{
  "iss": "https://idp.example.com/realms/main",
  "sub": "248289761001",
  "aud": "case-api",
  "azp": "web-client",
  "client_id": "web-client",
  "scope": "case:read case:update",
  "exp": 1730000000,
  "iat": 1729996400,
  "jti": "token-id-123",
  "tenant": "agency-a"
}
```

Access token audience harus cocok dengan API/resource server.

### 3.3 Rule of Thumb

```text
ID token digunakan oleh client untuk login.
Access token digunakan oleh API untuk authorization.
```

Jika API menerima ID token sebagai credential API, biasanya ada bug desain.

---

## 4. JWT vs Opaque Token untuk Resource Server

Resource server bisa menerima dua bentuk access token umum:

1. JWT access token,
2. opaque access token.

### 4.1 JWT Access Token

JWT access token bisa divalidasi lokal jika resource server punya key material publik/JWKS.

Keunggulan:

- cepat,
- tidak perlu network call setiap request,
- cocok untuk distributed APIs,
- claim bisa tersedia langsung.

Risiko:

- revocation tidak instant,
- claim bisa stale sampai token expired,
- key rotation harus benar,
- token besar,
- banyak engineer lupa cek `aud`, `iss`, `exp`, `alg`.

### 4.2 Opaque Token

Opaque token tidak bisa dipahami oleh API tanpa introspection.

```text
Authorization: Bearer 8d91a6b4-opaque-token-value
```

Resource server harus memanggil authorization server introspection endpoint.

Keunggulan:

- revocation lebih mudah,
- token metadata bisa dikontrol server-side,
- token tidak membocorkan claim ke client.

Risiko:

- latency,
- dependency runtime ke IdP,
- introspection endpoint outage dapat membuat API outage,
- butuh caching carefully,
- butuh client authentication dari resource server ke AS.

### 4.3 Decision Table

| Kriteria | JWT | Opaque |
|---|---:|---:|
| Local validation | Ya | Tidak |
| Runtime dependency ke AS | Rendah | Tinggi |
| Revocation cepat | Sulit | Lebih mudah |
| Token size | Besar | Kecil |
| Claim visible to client | Ya | Tidak |
| Operational simplicity | Sedang | Sedang/Sulit |
| Cocok untuk high-throughput API | Ya | Bisa, dengan cache |
| Cocok untuk strict revocation | Kurang | Lebih baik |

Tidak ada pilihan universal. Yang penting adalah contract-nya jelas.

---

## 5. Bearer Token Threat Model

Bearer token berarti:

```text
Siapa pun yang memegang token dapat menggunakannya.
```

Tidak ada proof bahwa pemegang token adalah client asli, kecuali ditambah mekanisme seperti mTLS-bound token atau DPoP/proof-of-possession.

Implikasi:

- access token tidak boleh masuk log,
- tidak boleh dikirim via query string,
- tidak boleh disimpan sembarangan di browser localStorage untuk aplikasi sensitif,
- harus dikirim via TLS,
- lifetime harus terbatas,
- audience harus spesifik,
- scope harus minimal,
- token replay harus dipertimbangkan.

API harus memperlakukan bearer token seperti credential aktif.

---

## 6. Resource Server Validation Pipeline

Pipeline minimal untuk JWT access token:

```text
1. Extract token
2. Parse token safely
3. Validate header
4. Resolve key by kid
5. Verify signature
6. Validate issuer
7. Validate audience
8. Validate time claims
9. Validate token type / usage
10. Validate client / authorized party
11. Validate scope / roles / claims
12. Map to local security identity
13. Apply endpoint/domain authorization
14. Audit decision
```

Mari bedah satu per satu.

---

## 7. Step 1 — Extract Token

Bearer token biasanya dikirim lewat header:

```http
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

Resource server harus menolak bentuk ambigu:

```text
- missing Authorization header
- multiple Authorization headers
- scheme bukan Bearer
- Bearer kosong
- token mengandung karakter invalid
- token dikirim lewat query string kecuali legacy contract sangat terbatas
```

Contoh extractor sederhana:

```java
public final class BearerTokenExtractor {

    public Optional<String> extract(String authorizationHeader) {
        if (authorizationHeader == null || authorizationHeader.isBlank()) {
            return Optional.empty();
        }

        String prefix = "Bearer ";
        if (!authorizationHeader.regionMatches(true, 0, prefix, 0, prefix.length())) {
            return Optional.empty();
        }

        String token = authorizationHeader.substring(prefix.length()).trim();
        if (token.isEmpty()) {
            return Optional.empty();
        }

        // Defensive: reject obvious malformed input early.
        if (token.length() > 8192) {
            throw new InvalidBearerTokenException("bearer_token_too_large");
        }

        return Optional.of(token);
    }
}
```

Catatan:

```text
Extractor tidak boleh log token.
```

Jika perlu observability, log hash pendek token/JTI setelah validasi, bukan token mentah.

---

## 8. Step 2 — Parse Token Safely

Parsing JWT tidak sama dengan mempercayai JWT.

```text
parse != validate
```

Parsing hanya membaca struktur:

```text
base64url(header).base64url(payload).signature
```

Resource server belum boleh memakai claim sebelum signature dan basic validation selesai.

Anti-pattern:

```java
// WRONG mental model
String role = jwt.getClaim("role");
if (role.equals("admin")) allow();
```

Sebelum token valid, claim adalah input tidak terpercaya.

---

## 9. Step 3 — Validate Header

Header JWT umumnya berisi:

```json
{
  "alg": "RS256",
  "typ": "at+jwt",
  "kid": "key-2026-01"
}
```

Yang harus diperhatikan:

| Header | Makna | Failure |
|---|---|---|
| `alg` | algoritma signature | algorithm confusion, `none`, unexpected alg |
| `kid` | key identifier | unknown key, malicious key lookup |
| `typ` | token type | ID token dipakai sebagai access token |

Resource server harus punya allowlist algorithm.

Contoh policy:

```text
Allowed algorithms: RS256, PS256
Rejected algorithms: none, HS256 unless explicitly designed
```

Kenapa HS256 sering berbahaya dalam resource server multi-party?

Karena HS256 memakai shared secret. Jika resource server dan authorization server berbagi secret, kompromi resource server dapat memungkinkan pembuatan token palsu. Dengan RS/PS/ES algorithms, resource server hanya punya public key.

---

## 10. Step 4 — Resolve JWKS and Key Rotation

Untuk JWT asymmetric, resource server butuh public key dari authorization server.

Biasanya lewat JWKS endpoint:

```text
https://idp.example.com/.well-known/jwks.json
```

JWKS berisi public keys dengan `kid`.

Resource server harus:

- cache JWKS,
- honor cache header secara wajar,
- refresh saat `kid` unknown,
- rate-limit refresh agar tidak DoS IdP,
- retain old key selama grace period jika perlu,
- alert jika key rotation gagal.

### 10.1 JWKS Failure Model

| Failure | Dampak |
|---|---|
| JWKS endpoint down | token dengan key baru gagal |
| cache terlalu lama | key baru tidak dikenal |
| cache terlalu pendek | IdP overload |
| old key langsung dibuang | active token gagal |
| tidak pin issuer/JWKS | malicious issuer risk |

### 10.2 Robust Strategy

```text
- Cache JWKS normally.
- If kid unknown, trigger one controlled refresh.
- If still unknown, reject token.
- Do not fetch arbitrary jku/x5u from token header unless explicitly trusted.
- Bind JWKS URL to configured issuer, not to token-provided URL.
```

---

## 11. Step 5 — Verify Signature

Signature verification memastikan token diterbitkan oleh pihak yang menguasai private key yang sesuai.

Tapi signature valid hanya menjawab:

```text
Token ini ditandatangani oleh key yang cocok.
```

Belum menjawab:

```text
Apakah issuer benar?
Apakah token untuk API ini?
Apakah token belum expired?
Apakah scope cukup?
Apakah subject boleh mengakses resource ini?
```

Maka jangan berhenti di signature verification.

---

## 12. Step 6 — Validate Issuer

Issuer harus exact match dengan configuration.

```json
{
  "iss": "https://idp.example.com/realms/main"
}
```

Contoh validasi:

```text
expected iss = https://idp.example.com/realms/main
actual iss   = https://idp.example.com/realms/main
```

Jangan gunakan partial match seperti:

```text
startsWith("https://idp.example.com")
contains("idp.example.com")
```

Karena issuer adalah security boundary.

Dalam multi-issuer setup, buat explicit issuer registry:

```yaml
issuers:
  - issuer: https://idp.example.com/realms/agency-a
    jwksUri: https://idp.example.com/realms/agency-a/protocol/openid-connect/certs
    audiences: [case-api]
  - issuer: https://idp.example.com/realms/agency-b
    jwksUri: https://idp.example.com/realms/agency-b/protocol/openid-connect/certs
    audiences: [case-api]
```

---

## 13. Step 7 — Validate Audience

Audience adalah claim yang menyatakan target penerima token.

```json
{
  "aud": "case-api"
}
```

Resource server harus menolak token yang tidak menyebut API ini sebagai audience.

### 13.1 Kenapa Audience Penting?

Bayangkan token untuk `profile-api` diterima oleh `case-api`.

```text
Token valid.
Issuer valid.
Signature valid.
User valid.
Tetapi token tidak pernah dimaksudkan untuk case-api.
```

Jika `case-api` menerimanya, maka terjadi **confused audience**.

### 13.2 Multi-Audience

Beberapa token punya array audience:

```json
{
  "aud": ["case-api", "report-api"]
}
```

Tetap harus explicit:

```text
case-api ∈ aud
```

Jangan menerima token hanya karena `aud` tidak ada. Dalam resource server modern, missing `aud` untuk access token biasanya harus ditolak kecuali ada legacy compatibility yang sangat jelas.

---

## 14. Step 8 — Validate Time Claims

Claims umum:

| Claim | Makna |
|---|---|
| `exp` | expiration time |
| `nbf` | not before |
| `iat` | issued at |

Resource server perlu clock skew kecil, misalnya 30–120 detik tergantung environment.

Aturan umum:

```text
now <= exp + allowedClockSkew
now >= nbf - allowedClockSkew
iat not too far in future
```

Jangan beri skew terlalu besar karena memperpanjang masa hidup token.

### 14.1 Failure Model

| Failure | Dampak |
|---|---|
| clock server drift | mass token rejection |
| skew terlalu besar | expired token diterima terlalu lama |
| token lifetime terlalu panjang | role revocation lambat efektif |
| tidak cek `nbf` | token pre-issued bisa dipakai lebih awal |

---

## 15. Step 9 — Validate Token Type / Usage

Beberapa authorization server memakai claim/header untuk membedakan token type.

Contoh:

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

Resource server sebaiknya memastikan token memang access token, bukan ID token.

Validasi ini bergantung IdP/token profile.

---

## 16. Step 10 — Validate Client / Authorized Party

Claim yang sering relevan:

| Claim | Makna |
|---|---|
| `azp` | authorized party |
| `client_id` | client yang memperoleh token |
| `sub` | subject token |
| `act` | actor/delegation claim, jika ada |

Untuk API sensitif, resource server bisa membatasi client mana yang boleh memanggil endpoint tertentu.

Contoh:

```text
POST /cases/{id}/approve
allowed client_id: case-management-web, officer-mobile
not allowed: reporting-job-client
```

Ini penting karena scope saja kadang tidak cukup.

---

## 17. Step 11 — Validate Scope / Roles / Claims

OAuth2 scope biasanya string space-separated:

```json
{
  "scope": "case:read case:update report:export"
}
```

Atau beberapa IdP memakai array:

```json
{
  "scp": ["case:read", "case:update"]
}
```

Resource server harus tahu claim mana yang authoritative.

### 17.1 Scope Semantics

Scope sebaiknya merepresentasikan **API capability coarse-grained**, bukan domain permission detail.

Contoh baik:

```text
case:read
case:write
case:approve
report:export
```

Contoh rawan:

```text
admin
user
read
write
```

Scope terlalu generic kehilangan makna ketika API bertambah banyak.

### 17.2 Scope Bukan Domain Authorization Final

Misalnya token punya:

```text
case:update
```

Itu belum berarti user boleh update semua case.

Masih perlu cek:

```text
- case tenant sama?
- case status memungkinkan update?
- user assigned officer?
- user tidak sedang conflict of interest?
- operation boleh dalam current lifecycle?
```

Maka scope adalah gerbang API-level, bukan full business authorization.

---

## 18. Step 12 — Map Token to Local Security Identity

Setelah token valid, resource server perlu membuat identity yang dipahami aplikasi.

Minimal:

```java
public record ApiCaller(
    String issuer,
    String subject,
    String clientId,
    Optional<String> username,
    Set<String> scopes,
    Set<String> groups,
    Set<String> applicationRoles,
    Optional<String> tenantId,
    boolean serviceAccount
) {}
```

Important invariant:

```text
Stable identity key = issuer + subject
not username
not email
not display name
```

Email bisa berubah. Username bisa berubah. `sub` dari issuer yang sama biasanya lebih stabil.

### 18.1 User Token vs Service Token

User token:

```json
{
  "sub": "user-123",
  "client_id": "web-client",
  "scope": "case:read"
}
```

Service token:

```json
{
  "sub": "service-account-reporting-job",
  "client_id": "reporting-job",
  "scope": "case:read report:generate"
}
```

Aplikasi harus membedakan:

```text
human actor != technical actor
```

Audit juga berbeda.

---

## 19. Step 13 — Apply Endpoint and Domain Authorization

Endpoint authorization menjawab:

```text
Apakah caller boleh memanggil endpoint ini?
```

Domain authorization menjawab:

```text
Apakah caller boleh melakukan action ini pada resource ini dalam state ini?
```

Contoh:

```text
Endpoint:
PATCH /cases/CASE-001
requires scope case:update

Domain:
caller tenant must match case tenant
caller must be assigned officer or supervisor
case status must be DRAFT or PENDING_INFO
caller must not be maker approving own work
```

Jangan satukan semua di controller sampai kacau. Buat lapisan policy/domain authorization yang eksplisit.

---

## 20. Step 14 — Audit Decision

Untuk API enterprise, terutama regulatory/case management, minimal audit:

```text
- timestamp
- correlation id
- request id
- issuer
- subject
- client id
- tenant
- endpoint
- action
- resource id
- authorization result
- denial reason code
- token jti or token hash, if available
```

Jangan log access token mentah.

Audit authorization denial sama pentingnya dengan success.

---

## 21. Implementation Option A — Servlet Filter

Servlet filter cocok jika:

- ingin proteksi semua web/API request,
- aplikasi berbasis Servlet/JAX-RS di atas Servlet,
- ingin enforcement sebelum request masuk JAX-RS,
- tidak butuh integrasi penuh dengan container roles,
- atau sedang di embedded/custom stack.

### 21.1 Skeleton

```java
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.security.Principal;
import java.util.Set;

public final class BearerTokenAuthenticationFilter implements Filter {

    private final BearerTokenExtractor extractor;
    private final AccessTokenValidator validator;

    public BearerTokenAuthenticationFilter(
            BearerTokenExtractor extractor,
            AccessTokenValidator validator
    ) {
        this.extractor = extractor;
        this.validator = validator;
    }

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {

        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        try {
            String header = httpRequest.getHeader("Authorization");
            var tokenOpt = extractor.extract(header);

            if (tokenOpt.isEmpty()) {
                unauthorized(httpResponse, "invalid_request", "Missing bearer token");
                return;
            }

            ApiCaller caller = validator.validate(tokenOpt.get());

            HttpServletRequest wrapped = new AuthenticatedHttpServletRequest(
                    httpRequest,
                    caller
            );

            chain.doFilter(wrapped, response);

        } catch (InvalidTokenException ex) {
            unauthorized(httpResponse, "invalid_token", "Invalid access token");
        } catch (InsufficientScopeException ex) {
            forbidden(httpResponse, "insufficient_scope", ex.requiredScope());
        }
    }

    private void unauthorized(
            HttpServletResponse response,
            String error,
            String description
    ) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setHeader(
                "WWW-Authenticate",
                "Bearer error=\"" + error + "\", error_description=\"" + description + "\""
        );
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"unauthorized\"}");
    }

    private void forbidden(
            HttpServletResponse response,
            String error,
            String scope
    ) throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setHeader(
                "WWW-Authenticate",
                "Bearer error=\"" + error + "\", scope=\"" + scope + "\""
        );
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"forbidden\"}");
    }
}
```

### 21.2 Request Wrapper

```java
public final class AuthenticatedHttpServletRequest
        extends jakarta.servlet.http.HttpServletRequestWrapper {

    private final ApiCaller caller;
    private final Principal principal;

    public AuthenticatedHttpServletRequest(
            HttpServletRequest request,
            ApiCaller caller
    ) {
        super(request);
        this.caller = caller;
        this.principal = () -> caller.issuer() + "|" + caller.subject();
    }

    @Override
    public Principal getUserPrincipal() {
        return principal;
    }

    @Override
    public boolean isUserInRole(String role) {
        return caller.applicationRoles().contains(role);
    }

    public ApiCaller getApiCaller() {
        return caller;
    }
}
```

### 21.3 Kelemahan Servlet Filter Approach

Filter wrapper tidak selalu cukup untuk integrasi container security penuh.

Kemungkinan masalah:

- `@RolesAllowed` di EJB/CDI mungkin tidak melihat role dari wrapper,
- container principal internal tidak berubah,
- JAX-RS `SecurityContext` mungkin perlu diset manual,
- async dispatch bisa kehilangan wrapper jika tidak hati-hati,
- vendor behavior dapat berbeda.

Servlet filter cocok untuk explicit application-level authorization, tetapi bukan selalu pengganti Jakarta Security/JASPIC.

---

## 22. Implementation Option B — JAX-RS ContainerRequestFilter

JAX-RS filter cocok jika:

- API berbasis Jakarta REST/JAX-RS,
- ingin endpoint-level filtering,
- ingin name binding annotation,
- ingin akses resource method metadata,
- tidak butuh web-tier/container-wide enforcement.

### 22.1 Global Filter

```java
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.SecurityContext;
import jakarta.ws.rs.ext.Provider;
import java.io.IOException;
import java.security.Principal;

@Provider
@Priority(Priorities.AUTHENTICATION)
public final class BearerTokenJaxRsFilter implements ContainerRequestFilter {

    private final BearerTokenExtractor extractor;
    private final AccessTokenValidator validator;

    public BearerTokenJaxRsFilter(
            BearerTokenExtractor extractor,
            AccessTokenValidator validator
    ) {
        this.extractor = extractor;
        this.validator = validator;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        String authorization = requestContext.getHeaderString(HttpHeaders.AUTHORIZATION);

        try {
            var token = extractor.extract(authorization)
                    .orElseThrow(() -> new InvalidTokenException("missing_token"));

            ApiCaller caller = validator.validate(token);
            requestContext.setSecurityContext(new ApiSecurityContext(caller, requestContext));

        } catch (InvalidTokenException ex) {
            requestContext.abortWith(Response.status(Response.Status.UNAUTHORIZED)
                    .header(HttpHeaders.WWW_AUTHENTICATE,
                            "Bearer error=\"invalid_token\"")
                    .entity("{\"error\":\"unauthorized\"}")
                    .type("application/json")
                    .build());
        }
    }
}
```

### 22.2 JAX-RS SecurityContext

```java
public final class ApiSecurityContext implements SecurityContext {

    private final ApiCaller caller;
    private final ContainerRequestContext requestContext;

    public ApiSecurityContext(ApiCaller caller, ContainerRequestContext requestContext) {
        this.caller = caller;
        this.requestContext = requestContext;
    }

    @Override
    public Principal getUserPrincipal() {
        return () -> caller.issuer() + "|" + caller.subject();
    }

    @Override
    public boolean isUserInRole(String role) {
        return caller.applicationRoles().contains(role);
    }

    @Override
    public boolean isSecure() {
        return "https".equalsIgnoreCase(requestContext.getUriInfo()
                .getRequestUri()
                .getScheme());
    }

    @Override
    public String getAuthenticationScheme() {
        return "Bearer";
    }
}
```

### 22.3 Name-Bound Filter

Untuk endpoint tertentu:

```java
import jakarta.ws.rs.NameBinding;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@NameBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface BearerSecured {}
```

Filter:

```java
@Provider
@BearerSecured
@Priority(Priorities.AUTHENTICATION)
public final class BearerSecuredFilter implements ContainerRequestFilter {
    // same idea
}
```

Resource:

```java
@Path("/cases")
@BearerSecured
public class CaseResource {

    @GET
    @Path("/{id}")
    public CaseDto getCase(@PathParam("id") String id) {
        // secured by name-bound filter
    }
}
```

### 22.4 Kelemahan JAX-RS Filter Approach

JAX-RS filter terjadi di JAX-RS layer, bukan seluruh web/container boundary.

Kelemahan:

- servlet/static endpoints tidak terlindungi,
- container-managed `@RolesAllowed` bisa berbeda tergantung integration,
- authentication terjadi setelah request mencapai JAX-RS runtime,
- tidak ideal jika banyak non-JAX-RS endpoints,
- perlu konsisten dengan Servlet filter/security constraints.

---

## 23. Implementation Option C — Jakarta Security HttpAuthenticationMechanism

Jakarta Security approach lebih container-aware daripada plain filter.

Cocok jika:

- ingin membangun caller identity melalui Jakarta Security,
- ingin integrasi dengan `SecurityContext`,
- ingin container mengenali principal/groups,
- ingin authentication mechanism portable secara Jakarta Security.

### 23.1 Conceptual Flow

```text
HTTP request
  -> HttpAuthenticationMechanism.validateRequest()
  -> extract bearer token
  -> validate token
  -> notify container about caller principal/groups
  -> request continues with authenticated caller
```

### 23.2 Skeleton

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.security.enterprise.AuthenticationStatus;
import jakarta.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism;
import jakarta.security.enterprise.authentication.mechanism.http.HttpMessageContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Set;

@ApplicationScoped
public class BearerHttpAuthenticationMechanism implements HttpAuthenticationMechanism {

    @Inject
    AccessTokenValidator validator;

    @Inject
    BearerTokenExtractor extractor;

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context
    ) {
        try {
            var tokenOpt = extractor.extract(request.getHeader("Authorization"));

            if (tokenOpt.isEmpty()) {
                return context.responseUnauthorized();
            }

            ApiCaller caller = validator.validate(tokenOpt.get());

            return context.notifyContainerAboutLogin(
                    caller.issuer() + "|" + caller.subject(),
                    caller.applicationRoles()
            );

        } catch (InvalidTokenException ex) {
            response.setHeader("WWW-Authenticate", "Bearer error=\"invalid_token\"");
            return context.responseUnauthorized();
        }
    }
}
```

Catatan:

- API exact dapat berbeda per versi/container.
- Concept utama adalah `notifyContainerAboutLogin`.
- Groups yang diberikan ke container biasanya menjadi basis `isCallerInRole`/role checks, tergantung mapping.

### 23.3 Kapan Ini Lebih Baik?

Jakarta Security mechanism lebih tepat saat:

```text
- API ingin caller terdaftar dalam container security model.
- Method security/container role checks harus bekerja.
- SecurityContext Jakarta harus konsisten.
- Aplikasi tidak ingin membangun security context sendiri di JAX-RS.
```

### 23.4 Kapan Tidak Cukup?

Kadang tidak cukup jika:

- butuh integration sangat rendah dengan vendor container,
- butuh message-level auth khusus,
- butuh non-HTTP auth mechanism,
- butuh callback/control JASPIC lebih spesifik.

Untuk itu ada Jakarta Authentication/JASPIC.

---

## 24. Implementation Option D — Jakarta Authentication / JASPIC

JASPIC cocok untuk advanced container integration.

Biasanya dipakai jika:

- membangun authentication module reusable di container,
- butuh integrasi low-level dengan subject/principal/group callbacks,
- vendor/container punya extension point berbasis JASPIC,
- gateway/header/token auth harus menjadi container identity secara native.

Namun untuk aplikasi biasa, ini sering terlalu rendah.

Decision rule:

```text
Gunakan Jakarta Security jika cukup.
Gunakan JAX-RS/Servlet filter untuk explicit app-level control.
Gunakan JASPIC jika benar-benar butuh low-level container SPI.
```

---

## 25. 401 vs 403 Semantics

Ini penting untuk API contract.

### 25.1 401 Unauthorized

`401` berarti request belum memiliki authentication credential yang valid.

Contoh:

```text
- token missing
- token malformed
- token expired
- signature invalid
- issuer invalid
- audience invalid
```

Response sebaiknya menyertakan `WWW-Authenticate`.

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token"
Content-Type: application/json

{"error":"unauthorized"}
```

### 25.2 403 Forbidden

`403` berarti caller sudah authenticated tetapi tidak berwenang.

Contoh:

```text
- scope tidak cukup
- role tidak cukup
- tenant salah
- resource tidak boleh diakses
- action tidak boleh untuk current state
```

Response:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"forbidden","reason":"INSUFFICIENT_PERMISSION"}
```

### 25.3 Insufficient Scope

Untuk OAuth2 Bearer, insufficient scope bisa dinyatakan lewat `WWW-Authenticate`:

```http
WWW-Authenticate: Bearer error="insufficient_scope", scope="case:approve"
```

Namun berhati-hati: jangan bocorkan detail permission sensitif ke caller yang tidak boleh tahu.

---

## 26. `WWW-Authenticate` Header

`WWW-Authenticate` bukan dekorasi. Ini bagian dari protocol contract.

Contoh minimal:

```http
WWW-Authenticate: Bearer
```

Invalid token:

```http
WWW-Authenticate: Bearer error="invalid_token"
```

Insufficient scope:

```http
WWW-Authenticate: Bearer error="insufficient_scope", scope="case:read"
```

Jangan masukkan token, stack trace, internal issuer URL yang tidak perlu, atau detail signature failure.

Good external message:

```json
{
  "error": "unauthorized",
  "correlationId": "01HV..."
}
```

Good internal log:

```text
correlationId=01HV... auth_failure=invalid_audience issuer=https://idp.example.com/realms/main expectedAudience=case-api tokenJti=abc123 subject=user-123
```

---

## 27. Scope-to-Endpoint Mapping

Desain scope harus stabil.

Contoh mapping:

| Endpoint | Required API Scope | Domain Check |
|---|---|---|
| `GET /cases/{id}` | `case:read` | tenant + assignment/visibility |
| `PATCH /cases/{id}` | `case:update` | state + assignee + tenant |
| `POST /cases/{id}/submit` | `case:submit` | maker owns draft |
| `POST /cases/{id}/approve` | `case:approve` | approver role + maker-checker |
| `GET /reports/export` | `report:export` | report permission + tenant |

Pattern:

```text
Scope grants coarse API capability.
Domain policy grants contextual permission.
```

---

## 28. Annotation-Based Scope Requirement

Kita bisa membuat annotation custom:

```java
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RequiresScope {
    String[] value();
}
```

Resource:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    @RequiresScope("case:read")
    public CaseDto getCase(@PathParam("id") String id) {
        // domain check inside service
    }
}
```

Filter membaca resource method metadata:

```java
@Provider
@Priority(Priorities.AUTHORIZATION)
public class ScopeAuthorizationFilter implements ContainerRequestFilter {

    @Context
    ResourceInfo resourceInfo;

    @Context
    jakarta.ws.rs.core.SecurityContext securityContext;

    @Override
    public void filter(ContainerRequestContext ctx) {
        RequiresScope required = resolveRequiredScope(resourceInfo);
        if (required == null) {
            return;
        }

        ApiCaller caller = CurrentCaller.require();
        for (String scope : required.value()) {
            if (!caller.scopes().contains(scope)) {
                ctx.abortWith(Response.status(Response.Status.FORBIDDEN)
                        .entity("{\"error\":\"forbidden\"}")
                        .type("application/json")
                        .build());
                return;
            }
        }
    }

    private RequiresScope resolveRequiredScope(ResourceInfo info) {
        RequiresScope method = info.getResourceMethod().getAnnotation(RequiresScope.class);
        if (method != null) return method;
        return info.getResourceClass().getAnnotation(RequiresScope.class);
    }
}
```

Caution:

```text
Annotation scope check tetap bukan pengganti domain authorization.
```

---

## 29. Current Caller Holder: Use Carefully

Kadang aplikasi membuat request-scoped holder:

```java
@RequestScoped
public class CurrentCaller {
    private ApiCaller caller;

    public ApiCaller get() {
        if (caller == null) {
            throw new UnauthenticatedException();
        }
        return caller;
    }

    public void set(ApiCaller caller) {
        this.caller = caller;
    }
}
```

Lebih baik request-scoped bean daripada static `ThreadLocal` manual.

Jika memakai `ThreadLocal`, harus clear di finally:

```java
try {
    CurrentCallerThreadLocal.set(caller);
    chain.doFilter(request, response);
} finally {
    CurrentCallerThreadLocal.clear();
}
```

Kalau tidak clear, di platform dengan thread reuse bisa terjadi identity leak antar request.

---

## 30. Gateway Validation vs Application Validation

Ada dua model umum.

### 30.1 Gateway Validates Token

```text
Client -> Gateway validates token -> App receives trusted identity headers
```

Keunggulan:

- logic terpusat,
- app lebih sederhana,
- konsisten lintas service.

Risiko:

- app terlalu percaya header,
- bypass gateway = bypass auth,
- header spoofing,
- lost context,
- fine-grained authorization tetap harus di app.

### 30.2 App Validates Token

```text
Client -> App validates token
```

Keunggulan:

- app punya kontrol penuh,
- defense in depth,
- lebih jelas untuk domain authorization.

Risiko:

- logic duplikasi,
- key/cache/config harus dikelola di banyak service,
- inconsistent validation antar service.

### 30.3 Hybrid Model

```text
Gateway validates coarse token + blocks invalid traffic.
App validates token again or validates signed trusted header.
App always performs domain authorization.
```

Hybrid sering paling realistis untuk enterprise.

---

## 31. Trusted Headers Pattern

Jika gateway meneruskan identity lewat header:

```http
X-Authenticated-Subject: user-123
X-Authenticated-Issuer: https://idp.example.com/realms/main
X-Authenticated-Scopes: case:read case:update
```

Aplikasi harus memastikan header hanya dipercaya dari gateway.

Minimal:

```text
- gateway strips inbound identity headers from client
- app only reachable from gateway/network boundary
- mTLS between gateway and app if possible
- signed header or internal token for stronger guarantee
- app rejects direct external traffic
```

Better pattern:

```text
Gateway sends signed internal assertion.
App validates assertion signature/audience/expiry.
```

Jangan pernah:

```text
Trust X-User header from public internet.
```

---

## 32. Token Propagation to Downstream Services

Ketika resource server memanggil service lain, ada beberapa pilihan.

### 32.1 Propagate Original User Token

```text
API A receives user token -> API A calls API B with same token
```

Keunggulan:

- downstream tahu user asli,
- audit sederhana.

Risiko:

- token audience mungkin salah untuk API B,
- API A membocorkan token user,
- downstream bisa melakukan lebih dari yang dimaksud,
- confused deputy.

### 32.2 Token Exchange

```text
API A exchanges incoming token -> gets token for API B
```

Keunggulan:

- audience benar,
- scope bisa dipersempit,
- delegation lebih eksplisit.

Risiko:

- butuh support authorization server,
- lebih kompleks.

### 32.3 Service Token Only

```text
API A calls API B using client credentials token
```

Keunggulan:

- sederhana untuk system operation,
- tidak tergantung user token.

Risiko:

- kehilangan user context,
- audit harus membawa actor separately,
- service account bisa terlalu powerful.

### 32.4 Recommended Mental Model

```text
Downstream call harus membawa dua informasi yang berbeda:
1. technical caller: service A
2. business actor: user/service yang memicu aksi
```

Contoh audit context:

```json
{
  "technicalCaller": "case-api",
  "actorType": "USER",
  "actorSubject": "issuer|user-123",
  "onBehalfOf": "issuer|user-123",
  "correlationId": "01HV..."
}
```

---

## 33. Client Credentials Flow in Resource Server Context

Machine-to-machine token biasanya tidak punya human user.

Example claims:

```json
{
  "iss": "https://idp.example.com/realms/main",
  "sub": "service-account-reporting-job",
  "client_id": "reporting-job",
  "aud": "case-api",
  "scope": "case:read report:generate",
  "exp": 1730000000
}
```

Resource server harus memperlakukan ini sebagai service identity.

Jangan memaksa semua token punya `email`, `username`, atau human group.

Policy bisa berbeda:

```text
Human user can update own assigned case.
Service account can run nightly read-only export.
Service account cannot approve case.
```

---

## 34. Multi-Audience APIs

Kadang satu service melayani beberapa logical API.

Contoh:

```text
case-api
case-internal-api
case-public-api
```

Jangan asal menerima semua audience.

Endpoint bisa punya audience requirement:

| Endpoint | Audience |
|---|---|
| `/public/cases/status` | `case-public-api` |
| `/internal/cases/sync` | `case-internal-api` |
| `/cases/{id}` | `case-api` |

Token dengan `case-public-api` tidak boleh otomatis mengakses internal endpoint.

---

## 35. Multi-Issuer and Multi-Tenant Resource Server

Enterprise app sering menerima token dari beberapa issuer/realm/tenant.

Contoh:

```text
Agency A issuer: https://idp.example.com/realms/agency-a
Agency B issuer: https://idp.example.com/realms/agency-b
Partner issuer:  https://partner-idp.example.org
```

Yang tidak boleh:

```text
Accept any issuer if signature validates with some key.
```

Yang benar:

```text
issuer registry + issuer-specific JWKS + issuer-specific audience + issuer-specific claim mapping
```

Mapping:

```java
public record IssuerConfig(
    String issuer,
    URI jwksUri,
    Set<String> acceptedAudiences,
    ClaimMapping claimMapping,
    Set<String> allowedClientIds
) {}
```

Multi-issuer increases complexity:

- different claim names,
- different group semantics,
- different subject stability,
- different key rotation behavior,
- different tenant mapping.

Normalize into internal `ApiCaller`, but retain original issuer/sub for audit.

---

## 36. Resource Server and Jakarta `@RolesAllowed`

If token groups are mapped into container groups, then `@RolesAllowed` can work.

Example:

```java
@Path("/admin")
@RolesAllowed("CASE_ADMIN")
public class AdminResource {
    @GET
    public Response list() {
        return Response.ok().build();
    }
}
```

But avoid mapping raw scopes directly as roles without thought.

Bad:

```text
@RolesAllowed("case:approve")
```

Possible but semantically confusing because role and scope mean different things.

Better:

```text
scope case:approve -> API capability
role CASE_APPROVER -> application role
permission approve_case -> domain permission
```

For simple APIs, scope-as-role may be acceptable. For enterprise workflow systems, separate concepts.

---

## 37. JAX-RS Resource Example: Layered Security

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    @Inject
    CaseApplicationService caseService;

    @Inject
    CurrentCaller currentCaller;

    @GET
    @Path("/{caseId}")
    @RequiresScope("case:read")
    public CaseDto get(@PathParam("caseId") String caseId) {
        ApiCaller caller = currentCaller.get();
        return caseService.getCase(caller, caseId);
    }

    @POST
    @Path("/{caseId}/approve")
    @RequiresScope("case:approve")
    public ApprovalResult approve(
            @PathParam("caseId") String caseId,
            ApprovalRequest request
    ) {
        ApiCaller caller = currentCaller.get();
        return caseService.approve(caller, caseId, request);
    }
}
```

Service:

```java
@ApplicationScoped
public class CaseApplicationService {

    @Inject
    CaseRepository caseRepository;

    @Inject
    CaseAuthorizationPolicy authorizationPolicy;

    @Transactional
    public ApprovalResult approve(ApiCaller caller, String caseId, ApprovalRequest request) {
        CaseRecord caseRecord = caseRepository.findForUpdate(caseId)
                .orElseThrow(() -> new NotFoundException("case_not_found"));

        authorizationPolicy.requireCanApprove(caller, caseRecord);

        caseRecord.approve(caller.subject(), request.comment());
        caseRepository.save(caseRecord);

        return ApprovalResult.success(caseId);
    }
}
```

Policy:

```java
@ApplicationScoped
public class CaseAuthorizationPolicy {

    public void requireCanApprove(ApiCaller caller, CaseRecord caseRecord) {
        if (!caller.applicationRoles().contains("CASE_APPROVER")) {
            throw new ForbiddenException("NOT_CASE_APPROVER");
        }

        if (!caller.tenantId().orElseThrow().equals(caseRecord.tenantId())) {
            throw new ForbiddenException("TENANT_MISMATCH");
        }

        if (!caseRecord.status().equals(CaseStatus.PENDING_APPROVAL)) {
            throw new ForbiddenException("INVALID_CASE_STATE");
        }

        if (caseRecord.createdBy().equals(caller.subject())) {
            throw new ForbiddenException("MAKER_CANNOT_APPROVE_OWN_CASE");
        }
    }
}
```

Pattern:

```text
Filter/mechanism: authenticate token
Annotation: coarse endpoint capability
Domain policy: resource-specific authorization
Transaction: lock/check/mutate together
Audit: record actor/action/result
```

---

## 38. Transactional Authorization

Authorization and mutation must be consistent.

Bad flow:

```text
1. Load case.
2. Check status = PENDING_APPROVAL.
3. Another transaction changes status.
4. Current transaction approves stale case.
```

Better:

```text
1. Start transaction.
2. Load case with lock or optimistic version.
3. Check authorization against current state.
4. Mutate.
5. Commit.
```

For case/workflow systems, authorization often depends on mutable state.

Therefore:

```text
Authorization must be evaluated near the state transition, not only at HTTP edge.
```

---

## 39. Caching Authorization Data

Resource server often caches:

- JWKS,
- introspection result,
- user role mapping,
- tenant membership,
- permission matrix.

Caching improves performance but creates staleness.

### 39.1 Cache Risk Table

| Cached Data | Risk |
|---|---|
| JWKS | new key unknown or old key accepted too long |
| Introspection active result | revoked token accepted during cache TTL |
| Role mapping | removed role remains active |
| Tenant membership | ex-member accesses tenant data |
| Permission matrix | policy change delayed |

### 39.2 Suggested Rules

```text
- Cache public keys longer than access decisions.
- Cache introspection only for short TTL, usually <= token remaining lifetime.
- Cache role/permission with explicit invalidation if possible.
- For high-risk action, re-check fresh policy or require step-up.
- Include policy version in audit if possible.
```

---

## 40. Opaque Token Introspection Flow

Flow:

```text
Client -> API with opaque token
API -> AS introspection endpoint
AS -> active=true + metadata
API -> builds ApiCaller
```

Pseudo-code:

```java
public final class OpaqueTokenValidator implements AccessTokenValidator {

    private final TokenIntrospectionClient introspectionClient;
    private final IntrospectionCache cache;

    @Override
    public ApiCaller validate(String token) {
        IntrospectionResponse response = cache.get(token)
                .orElseGet(() -> introspectionClient.introspect(token));

        if (!response.active()) {
            throw new InvalidTokenException("inactive_token");
        }

        validateIssuer(response.issuer());
        validateAudience(response.audience());
        validateExpiry(response.expiry());

        return mapToCaller(response);
    }
}
```

Security concerns:

```text
- Resource server must authenticate to introspection endpoint.
- Token must not be logged.
- Cache key should be token hash, not raw token.
- inactive token must not be cached too long unless carefully designed.
- network failure semantics must be explicit: fail closed for protected API.
```

---

## 41. Error Handling Matrix

| Condition | Status | Header | External Body |
|---|---:|---|---|
| Missing token | 401 | `Bearer` | `unauthorized` |
| Malformed token | 401 | `Bearer error="invalid_token"` | `unauthorized` |
| Expired token | 401 | `Bearer error="invalid_token"` | `unauthorized` |
| Invalid signature | 401 | `Bearer error="invalid_token"` | `unauthorized` |
| Wrong issuer | 401 | `Bearer error="invalid_token"` | `unauthorized` |
| Wrong audience | 401 | `Bearer error="invalid_token"` | `unauthorized` |
| Missing scope | 403 | optionally `insufficient_scope` | `forbidden` |
| Tenant mismatch | 403 or 404 | none | `forbidden` or `not_found` |
| Resource not found | 404 | none | `not_found` |
| IdP/JWKS outage | 503 or 401 depending stage | none/minimal | `service_unavailable` or `unauthorized` |

Tenant mismatch sometimes returns 404 to avoid resource existence leakage. But internal audit must record actual reason.

---

## 42. Observability Without Leaking Secrets

Do log:

```text
- correlation id
- issuer
- subject hash or stable subject if acceptable
- client id
- audience
- scope count or required scope
- jti if non-sensitive
- token hash prefix
- failure reason code
- endpoint
- latency of token validation
- JWKS cache hit/miss
- introspection latency
```

Do not log:

```text
- raw Authorization header
- raw access token
- refresh token
- client secret
- private key
- full PII claims unnecessarily
```

Structured log example:

```json
{
  "event": "AUTHZ_DENIED",
  "correlationId": "01HV...",
  "issuer": "https://idp.example.com/realms/main",
  "subject": "user-123",
  "clientId": "case-web",
  "endpoint": "POST /cases/{id}/approve",
  "resourceId": "CASE-001",
  "reason": "MAKER_CANNOT_APPROVE_OWN_CASE",
  "tokenJti": "abc-123"
}
```

---

## 43. Security Tests for Resource Server

### 43.1 Token Validation Tests

Test cases:

```text
- missing token -> 401
- malformed token -> 401
- expired token -> 401
- nbf in future -> 401
- wrong issuer -> 401
- wrong audience -> 401
- wrong algorithm -> 401
- unknown kid -> 401 after refresh attempt
- valid token -> request proceeds
```

### 43.2 Authorization Tests

```text
- valid token missing scope -> 403
- valid scope but wrong tenant -> 403/404
- valid scope and tenant but wrong state -> 403
- valid approver but maker == approver -> 403
- service token cannot perform human-only action -> 403
```

### 43.3 Gateway Header Tests

```text
- client-supplied X-Authenticated-Subject is stripped/rejected
- direct app access without gateway assertion rejected
- signed gateway assertion expired rejected
- wrong gateway issuer rejected
```

### 43.4 JWKS Rotation Tests

```text
- old key token works until expiry/grace
- new key token triggers refresh
- unknown kid rejected
- JWKS outage with cached key still works for known key
- JWKS outage with unknown key fails closed
```

---

## 44. Performance Concerns

Token validation can become hot path.

Watch:

```text
- signature verification CPU cost
- JWKS cache behavior
- introspection latency
- JSON parsing allocation
- large token size
- per-request DB role lookup
- synchronized key refresh bottleneck
```

Strategies:

```text
- cache JWKS
- avoid introspection per request without cache
- cache mapped authorization data cautiously
- avoid blocking IdP call on every request
- use bulkhead/timeouts for introspection
- fail closed but return controlled response
- track validation latency metrics
```

Java 8–25 considerations:

```text
- Java 8 enterprise apps may use older javax/JAX-RS libraries.
- Java 11/17/21 are common LTS baselines for modern Jakarta runtimes.
- Java 21 virtual threads do not remove need for request-scoped context discipline.
- Java 25 does not change OAuth2 semantics; library/container compatibility remains more important than language syntax.
```

---

## 45. Common Production Failure Cases

### 45.1 API Accepts Token for Another Audience

Symptom:

```text
User can call case-api with token issued for profile-api.
```

Root cause:

```text
Only signature/issuer checked. Audience ignored.
```

Fix:

```text
Require exact audience per API/endpoint.
```

### 45.2 JWKS Rotation Outage

Symptom:

```text
Sudden wave of 401 after IdP key rotation.
```

Root cause:

```text
JWKS cache never refreshed or refresh blocked by firewall.
```

Fix:

```text
Controlled refresh on unknown kid + monitoring + runbook.
```

### 45.3 Scope Used as Full Permission

Symptom:

```text
Any user with case:update can update other tenant's case.
```

Root cause:

```text
No domain authorization after scope check.
```

Fix:

```text
Layer endpoint scope + domain policy.
```

### 45.4 Gateway Header Spoofing

Symptom:

```text
Caller sends X-User: admin and becomes admin.
```

Root cause:

```text
App trusts public header.
```

Fix:

```text
Strip headers at gateway, restrict app network, validate signed internal assertion.
```

### 45.5 Token Propagated to Wrong Downstream

Symptom:

```text
API B accepts token intended for API A.
```

Root cause:

```text
Downstream audience not checked or original token blindly forwarded.
```

Fix:

```text
Use token exchange or service-specific audience validation.
```

### 45.6 Expired Role Still Works

Symptom:

```text
User removed from approver role but can approve for 30 minutes.
```

Root cause:

```text
Role embedded in long-lived token/session.
```

Fix options:

```text
- shorter access token lifetime
- introspection for sensitive action
- role version claim
- policy cache invalidation
- step-up/fresh check for high-risk action
```

---

## 46. Recommended Reference Architecture

```text
                 +----------------------+
                 | Authorization Server |
                 | OIDC/OAuth2 IdP      |
                 +----------+-----------+
                            |
                            | JWKS / introspection
                            v
+--------+       +----------+----------+       +---------------------+
| Client | ----> | Gateway / Ingress   | ----> | Jakarta Resource API|
+--------+       +---------------------+       +----------+----------+
 Authorization       optional coarse auth                  |
 Bearer token        rate limit / mTLS                     |
                                                              v
                                                   +----------+----------+
                                                   | Auth Pipeline       |
                                                   | token validation    |
                                                   | scope mapping       |
                                                   | caller identity     |
                                                   +----------+----------+
                                                              |
                                                              v
                                                   +----------+----------+
                                                   | Domain Policy       |
                                                   | tenant/state/rule   |
                                                   +----------+----------+
                                                              |
                                                              v
                                                   +----------+----------+
                                                   | Business Service    |
                                                   | transactional write |
                                                   +----------+----------+
                                                              |
                                                              v
                                                   +----------+----------+
                                                   | Audit               |
                                                   +---------------------+
```

Key invariants:

```text
- Gateway may reduce invalid traffic, but app owns domain authorization.
- Token validation is explicit and issuer/audience aware.
- Scope is coarse API capability, not final business permission.
- Domain authorization is checked close to mutation.
- Audit records actor, client, resource, action, result.
- No raw token in logs.
```

---

## 47. Decision Framework

Choose implementation style:

| Need | Suggested Approach |
|---|---|
| All Servlet endpoints protected | Servlet Filter or Jakarta Security mechanism |
| JAX-RS-only API | JAX-RS `ContainerRequestFilter` possible |
| Container role integration | Jakarta Security `HttpAuthenticationMechanism` |
| Low-level portable container SPI | Jakarta Authentication/JASPIC |
| Gateway-authenticated app | Trusted signed assertion + app domain policy |
| MicroProfile stack | MicroProfile JWT + Jakarta/JAX-RS policy layer |
| High-risk regulatory workflow | Token validation + domain authorization + audit + transactional checks |

---

## 48. Production Checklist

### Token Acceptance

```text
[ ] Authorization header only, unless documented exception.
[ ] Bearer scheme parsed strictly.
[ ] Missing/malformed token returns 401.
[ ] Raw token never logged.
```

### JWT Validation

```text
[ ] Signature verified.
[ ] Algorithm allowlisted.
[ ] Issuer exact matched.
[ ] Audience exact matched.
[ ] Expiry checked.
[ ] Not-before checked if present.
[ ] Clock skew bounded.
[ ] Token type/access-token use checked where possible.
[ ] Client id/azp policy checked where needed.
```

### JWKS

```text
[ ] JWKS URI configured per issuer.
[ ] JWKS cached.
[ ] Unknown kid triggers controlled refresh.
[ ] Arbitrary token-provided key URL not trusted.
[ ] Rotation tested.
[ ] Metrics exist for cache hit/miss/refresh failure.
```

### Opaque Token

```text
[ ] Introspection endpoint uses resource server authentication.
[ ] Active flag checked.
[ ] Metadata validated like JWT claims.
[ ] Cache TTL short and bounded by token expiry.
[ ] Introspection failure policy defined.
```

### Authorization

```text
[ ] Endpoint scope required.
[ ] Role/group mapping normalized.
[ ] Domain authorization implemented separately.
[ ] Tenant boundary checked.
[ ] Mutable state checked transactionally.
[ ] Maker-checker/SoD checks where needed.
```

### Error Handling

```text
[ ] 401 for authentication failure.
[ ] 403 for authenticated-but-denied.
[ ] WWW-Authenticate present for 401 bearer challenge.
[ ] External error does not leak internals.
[ ] Internal logs have correlation id and reason code.
```

### Downstream

```text
[ ] Original token not blindly propagated.
[ ] Downstream audience correct.
[ ] Token exchange considered.
[ ] Technical caller and business actor both auditable.
```

### Operations

```text
[ ] Metrics for 401/403 by reason.
[ ] Alert on sudden invalid_token spike.
[ ] Alert on JWKS refresh failure.
[ ] Alert on introspection latency/failure.
[ ] Runbook for IdP outage and key rotation.
```

---

## 49. Mental Model Summary

Resource server engineering is about turning this:

```text
Authorization: Bearer <token>
```

into this safely:

```text
issuer       = trusted issuer
subject      = stable actor identity
client       = authorized client
audience     = this API
scopes       = coarse API capabilities
roles        = normalized app roles
tenant       = resolved boundary
permission   = domain-specific decision
result       = allow/deny with audit
```

A mature Jakarta resource server does not merely validate tokens. It creates a **controlled identity boundary** between external authorization infrastructure and internal business rules.

Top 1% engineering intuition:

```text
The token is evidence, not the policy.
The gateway is a boundary, not the whole security model.
The scope is capability, not object permission.
The role is application vocabulary, not raw IdP group.
The authorization decision must be close to the resource state it protects.
```

---

## 50. What You Should Be Able to Explain After This Part

You should now be able to explain:

1. What an OAuth2 resource server is.
2. Why access token and ID token must not be confused.
3. How JWT and opaque token validation differ.
4. Why signature validation alone is insufficient.
5. Why issuer and audience validation are mandatory.
6. How `401` and `403` differ.
7. Why `WWW-Authenticate` matters.
8. How JAX-RS filter differs from Servlet filter.
9. When Jakarta Security `HttpAuthenticationMechanism` is more appropriate.
10. Why scope is not final domain authorization.
11. How to map token claims to local caller identity.
12. How gateway-authenticated identity can fail.
13. Why token propagation can cause confused deputy problems.
14. How to test resource server authorization.
15. How to model production failures around JWKS, audience, scope, and tenant.

---

## 51. Status Seri

Selesai:

```text
Part 18 — OAuth2 Resource Server Pattern for JAX-RS and Servlet APIs
```

Seri belum selesai.

Berikutnya:

```text
Part 19 — SAML, Enterprise SSO, and Legacy Federation Integration
```
