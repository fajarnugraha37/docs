# Part 27 — Secure Error Handling, 401/403 Semantics, and User Experience

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-27-secure-error-handling-401-403-user-experience.md`  
> Fokus: secure error handling untuk authentication, authorization, token validation, browser login, API errors, auditability, dan user experience di aplikasi Java/Jakarta.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas banyak komponen security:

- authentication mechanism,
- `SecurityContext`,
- `IdentityStore`,
- Jakarta Authentication/JASPIC,
- Jakarta Authorization/JACC,
- role/group/claim/scope mapping,
- session,
- token,
- OIDC,
- SAML,
- mTLS,
- method security,
- context propagation,
- multi-tenancy,
- workflow authorization,
- gateway/reverse proxy,
- CSRF/CORS/clickjacking.

Bagian ini membahas sesuatu yang terlihat sederhana tetapi sering merusak security production: **bagaimana sistem merespons ketika authentication atau authorization gagal**.

Error handling security bukan hanya soal menampilkan pesan error. Ia adalah kontrak antara:

- browser,
- API client,
- mobile client,
- gateway,
- container,
- application code,
- identity provider,
- audit system,
- support/admin team,
- end user.

Jika error handling salah, dampaknya bisa berupa:

- user enumeration,
- token leakage,
- privilege escalation clue,
- redirect loop,
- infinite retry,
- confusing UX,
- impossible troubleshooting,
- noisy alert,
- salah membedakan login failure dan permission denial,
- API client tidak tahu harus refresh token atau stop,
- support tidak bisa membuktikan kenapa user ditolak,
- attacker mendapat informasi internal policy.

Tujuan bagian ini adalah membangun mental model agar kita bisa mendesain error contract yang:

1. **secure** — tidak membocorkan informasi sensitif.
2. **correct** — sesuai HTTP/auth semantics.
3. **usable** — user tahu tindakan berikutnya.
4. **auditable** — support/admin bisa investigasi.
5. **machine-readable** — API client bisa merespons dengan benar.
6. **domain-aware** — cocok untuk workflow/case management, tenant, dan role complex.
7. **operationally debuggable** — punya correlation ID, denial code, dan structured event.

---

## 1. Mental Model: Error Adalah Bagian dari Security Boundary

Banyak engineer memperlakukan error sebagai output sampingan:

```text
request fails → return some error message
```

Untuk security system, model ini terlalu dangkal.

Model yang lebih benar:

```text
request reaches protected resource
→ system must decide whether caller is known
→ if not known, issue authentication challenge or redirect
→ if known but not allowed, return authorization denial
→ if resource existence itself is sensitive, conceal existence
→ produce user-safe message
→ produce machine-readable error
→ produce audit event
→ produce support-debuggable correlation
→ avoid leaking sensitive internals
```

Security error handling punya dua audience:

```text
External audience:
- browser user
- API client
- attacker
- automated integration

Internal audience:
- application log
- audit trail
- security monitoring
- support/admin console
- incident responder
```

Kesalahan umum adalah mencampur keduanya.

Contoh buruk:

```json
{
  "error": "User alice@example.com exists but password hash bcrypt cost mismatch; account locked by policy AUTH-LOCK-03; last failed IP 10.4.2.8"
}
```

Ini mungkin membantu developer, tetapi membocorkan terlalu banyak kepada client.

Contoh yang lebih sehat:

External response:

```json
{
  "error": "invalid_login",
  "message": "The username or password is incorrect.",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9"
}
```

Internal audit:

```json
{
  "eventType": "AUTHENTICATION_FAILURE",
  "reason": "PASSWORD_MISMATCH",
  "subjectHintHash": "sha256:...",
  "ipAddress": "203.0.113.10",
  "userAgentHash": "sha256:...",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9",
  "timestamp": "2026-06-17T09:21:33Z"
}
```

Kuncinya: **pesan eksternal harus aman, event internal harus cukup detail**.

---

## 2. 401 vs 403: Perbedaan yang Harus Dipahami

Dalam HTTP modern:

- **401 Unauthorized** sebenarnya berarti authentication dibutuhkan atau credential tidak valid.
- **403 Forbidden** berarti server memahami request dan caller mungkin sudah dikenal, tetapi akses ditolak.

Nama `Unauthorized` pada 401 memang membingungkan karena terdengar seperti authorization. Secara praktik, 401 adalah authentication challenge.

### 2.1 Rule of Thumb

```text
Tidak ada credential / credential invalid / credential expired
→ 401 Unauthorized
→ biasanya disertai challenge atau instruksi login

Credential valid tetapi tidak punya permission
→ 403 Forbidden
→ tidak perlu login ulang kecuali permission berubah setelah reauth

Resource tidak boleh diketahui keberadaannya
→ pertimbangkan 404 Not Found
→ terutama untuk object-level/tenant-sensitive resource
```

### 2.2 Contoh API Bearer Token

Request tanpa token:

```http
GET /api/cases/123 HTTP/1.1
Host: app.example.com
```

Response:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="aceas-api"
Content-Type: application/problem+json
```

```json
{
  "type": "https://errors.example.com/authentication-required",
  "title": "Authentication required",
  "status": 401,
  "code": "AUTHENTICATION_REQUIRED",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9"
}
```

Request dengan token valid tetapi role kurang:

```http
GET /api/cases/123 HTTP/1.1
Authorization: Bearer eyJhbGciOi...
```

Response:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json
```

```json
{
  "type": "https://errors.example.com/access-denied",
  "title": "Access denied",
  "status": 403,
  "code": "ACCESS_DENIED",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9"
}
```

### 2.3 Contoh Browser Session

Jika user belum login dan mengakses halaman protected:

```text
GET /admin/users
→ redirect ke /login?continue=/admin/users
```

Ini secara HTTP bisa berupa 302, bukan 401, karena browser UX lebih cocok diarahkan ke halaman login.

Jika user sudah login tetapi bukan admin:

```text
GET /admin/users
→ 403 page: "You do not have access to this page."
```

Jangan redirect ke login untuk semua 403. Itu membuat user mengira login ulang akan memperbaiki permission, padahal masalahnya authorization.

---

## 3. 401 Bukan Selalu Redirect Login

Untuk aplikasi Jakarta yang mendukung browser dan API, error handling harus membedakan jenis client.

### 3.1 Browser Page Request

```text
Accept: text/html
```

Biasanya:

```text
unauthenticated → redirect login
forbidden → render 403 page
```

### 3.2 API Request

```text
Accept: application/json
Authorization: Bearer ...
```

Biasanya:

```text
unauthenticated → 401 JSON problem response
forbidden → 403 JSON problem response
```

### 3.3 AJAX dari SPA

SPA sering memakai API endpoint. Jika API mengembalikan HTML login page, client menjadi kacau.

Contoh buruk:

```text
GET /api/cases
→ 302 /login
→ 200 text/html login page
→ frontend mencoba parse HTML sebagai JSON
```

Hasilnya:

```text
SyntaxError: Unexpected token '<'
```

Contoh lebih benar:

```text
GET /api/cases
→ 401 application/problem+json
→ frontend menjalankan flow login/refresh session
```

### 3.4 Pattern: Route-Aware Error Handling

Pisahkan policy berdasarkan path:

```text
/pages/**
  unauthenticated: redirect /login
  forbidden: render 403 HTML

/api/**
  unauthenticated: 401 JSON
  forbidden: 403 JSON

/oauth2/callback/**
  invalid state/nonce: safe OIDC error page + audit

/health/**
  no auth or internal auth depending deployment
```

---

## 4. `WWW-Authenticate`: Challenge Contract untuk API

Untuk 401, server biasanya perlu memberi tahu client authentication scheme yang diterima.

Contoh Basic:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="admin"
```

Contoh Bearer:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="case-api"
```

Bearer token error bisa lebih spesifik, tetapi harus hati-hati.

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="case-api", error="invalid_token", error_description="The access token expired"
```

Untuk public API machine-to-machine, `invalid_token` sering berguna. Untuk browser/public-facing app, detail `expired`, `signature_invalid`, `issuer_invalid`, dan `audience_invalid` bisa memberi attacker sinyal. Gunakan detail secukupnya.

### 4.1 Practical Contract

```text
Missing token:
401 + WWW-Authenticate: Bearer realm="api"

Malformed token:
401 + invalid_token, generic body

Expired token:
401 + invalid_token; client may refresh token

Valid token but missing scope/permission:
403 + optional insufficient_scope for OAuth-style API

Valid user but domain policy denies:
403 + ACCESS_DENIED / DOMAIN_POLICY_DENIED
```

---

## 5. 404 sebagai Concealment: Kapan Resource Disembunyikan

Ada kasus di mana 403 terlalu informatif.

Misalnya:

```text
GET /api/tenants/TENANT-B/cases/CASE-999
```

Jika caller dari `TENANT-A` mendapat:

```text
403 Forbidden
```

maka caller tahu `CASE-999` mungkin ada di tenant lain.

Untuk object-level security, kadang lebih aman:

```text
404 Not Found
```

### 5.1 Decision Rule

```text
Apakah caller boleh tahu resource itu ada?
  yes → 403 jika tidak punya permission
  no  → 404 atau generic not found
```

Contoh:

```text
Admin panel /admin/users:
  user tahu halaman ada tetapi tidak boleh akses → 403

Case detail cross-tenant:
  user tidak boleh tahu case id valid di tenant lain → 404

Application number public tracking:
  user boleh tahu application exists jika punya reference/token → 403/401 tergantung model
```

### 5.2 Risiko Overusing 404

Jangan pakai 404 untuk semua denial tanpa desain. Dampaknya:

- support sulit membedakan not found vs no access,
- client salah menghapus cache/resource,
- audit kehilangan denial signal,
- UX membingungkan.

Solusi:

```text
External: 404 Not Found
Internal audit: ACCESS_DENIED_CONCEALED_RESOURCE
```

---

## 6. Error Taxonomy untuk Jakarta Security System

Sistem besar butuh taxonomy error yang konsisten.

### 6.1 Authentication Error

Authentication error berarti caller belum established.

Contoh code:

```text
AUTHENTICATION_REQUIRED
INVALID_CREDENTIAL
INVALID_TOKEN
EXPIRED_TOKEN
INVALID_SESSION
EXPIRED_SESSION
ACCOUNT_LOCKED
ACCOUNT_DISABLED
MFA_REQUIRED
STEP_UP_REQUIRED
OIDC_LOGIN_FAILED
SAML_ASSERTION_INVALID
CLIENT_CERT_REQUIRED
CLIENT_CERT_INVALID
```

Tetapi tidak semua code harus keluar ke user.

### 6.2 Authorization Error

Authorization error berarti caller established tetapi tidak boleh melakukan aksi.

```text
ACCESS_DENIED
ROLE_REQUIRED
SCOPE_REQUIRED
PERMISSION_DENIED
TENANT_ACCESS_DENIED
RESOURCE_ACCESS_DENIED
STATE_TRANSITION_DENIED
MAKER_CHECKER_DENIED
SEPARATION_OF_DUTY_DENIED
DELEGATION_EXPIRED
BREAK_GLASS_REQUIRED
POLICY_DENIED
```

### 6.3 Security Protocol Error

```text
OIDC_STATE_INVALID
OIDC_NONCE_INVALID
OIDC_ISSUER_INVALID
OIDC_AUDIENCE_INVALID
OIDC_SIGNATURE_INVALID
SAML_SIGNATURE_INVALID
SAML_AUDIENCE_INVALID
SAML_RECIPIENT_INVALID
CSRF_TOKEN_INVALID
CORS_ORIGIN_DENIED
MTLS_CERT_CHAIN_INVALID
```

Biasanya external response harus generic:

```text
Login could not be completed. Please try again.
```

Internal audit harus detail.

### 6.4 System/Dependency Error

```text
IDP_UNAVAILABLE
JWKS_FETCH_FAILED
TOKEN_INTROSPECTION_UNAVAILABLE
LDAP_UNAVAILABLE
DATABASE_IDENTITY_STORE_UNAVAILABLE
POLICY_ENGINE_UNAVAILABLE
CLOCK_SKEW_DETECTED
```

Ini bukan selalu 401/403.

Contoh:

```text
IdP unavailable during login → 503 Service Unavailable or safe login error
Policy engine unavailable → fail closed with 403/503 depending architecture
JWKS fetch failed with no cached key → 503 or 401? depends validation model
```

Default untuk security dependency yang tidak bisa memvalidasi identity/permission: **fail closed**.

---

## 7. RFC 7807 Problem Details Style untuk API Error

Untuk API, gunakan response yang machine-readable. Salah satu format populer adalah Problem Details style.

Contoh:

```json
{
  "type": "https://errors.example.com/access-denied",
  "title": "Access denied",
  "status": 403,
  "code": "ACCESS_DENIED",
  "detail": "You do not have permission to perform this action.",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9"
}
```

Untuk security-sensitive error, hati-hati dengan `detail`.

### 7.1 Public Detail vs Internal Detail

External:

```json
{
  "status": 403,
  "code": "ACCESS_DENIED",
  "message": "You do not have permission to perform this action.",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9"
}
```

Internal:

```json
{
  "decisionId": "authz-20260617-000001",
  "subject": "user:12345",
  "tenant": "agency:CEA",
  "action": "CASE_APPROVE",
  "resource": "case:98765",
  "resourceState": "PENDING_REVIEW",
  "reason": "MAKER_CHECKER_DENIED",
  "policyVersion": "case-policy:v42",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9"
}
```

### 7.2 Recommended Fields

```text
status
code
title/message
correlationId
requestId
retryable
loginRequired
reauthRequired
supportReference
```

Avoid exposing:

```text
stack trace
SQL error
LDAP DN
full JWT
raw SAML assertion
internal role/group name if sensitive
policy expression
filesystem path
server hostname
container version
exact account existence result
```

---

## 8. Account Enumeration and Login Errors

Authentication error messages can leak whether an account exists.

Bad:

```text
Username does not exist.
Password is incorrect.
Account exists but is disabled.
MFA not configured for this user.
```

Better for public login:

```text
The username or password is incorrect.
```

But enterprise apps also need user guidance. How to balance?

### 8.1 Public Login Pattern

External message:

```text
The username or password is incorrect.
```

For locked/disabled accounts:

```text
We could not sign you in. Please contact your administrator if the problem continues.
```

Internal audit:

```text
AUTH_FAILURE_USER_NOT_FOUND
AUTH_FAILURE_PASSWORD_MISMATCH
AUTH_FAILURE_ACCOUNT_LOCKED
AUTH_FAILURE_ACCOUNT_DISABLED
```

### 8.2 Authenticated Account Management

Once user is authenticated, messages can be more specific:

```text
Your password was changed successfully.
Your current password is incorrect.
Your account requires MFA setup.
```

Because account existence is already known in that session.

### 8.3 Admin Console

Admin users may see more detail, but still not raw secret detail.

```text
Account is locked due to repeated failed sign-in attempts.
Last failure: 2026-06-17 09:21 UTC.
Unlock requires Security Admin role.
```

---

## 9. OIDC Login Error Handling

OIDC login has multiple failure points:

```text
user clicks login
→ app creates state/nonce
→ redirect to IdP
→ IdP authenticates user
→ callback returns code/state
→ app validates state
→ app exchanges code for tokens
→ app validates ID token
→ app maps claims to account
→ app creates session
```

Each step can fail.

### 9.1 Common OIDC Errors

```text
state missing
state mismatch
nonce mismatch
authorization code expired
code already used
redirect_uri mismatch
issuer mismatch
audience mismatch
signature invalid
JWKS unavailable
clock skew
group claim missing
user not provisioned
account conflict
role mapping failed
```

### 9.2 External UX

Avoid showing:

```text
OIDC nonce mismatch for state id abc; expected xyz; received jti 123
```

Better:

```text
Login could not be completed. Please try again.
Reference: 01JY6Q7A2J9Y5VP8M6Z1X4K2G9
```

For admin/support:

```text
OIDC_LOGIN_FAILED: NONCE_MISMATCH
issuer=https://idp.example.com/realms/main
clientId=case-web
correlationId=...
```

### 9.3 Redirect Loop Prevention

OIDC error handling must prevent loops:

```text
protected page → login → callback fails → redirect protected page → login → callback fails → ...
```

Pattern:

```text
If callback fails:
  invalidate partial login state
  clear auth cookies created during attempted login
  show terminal error page
  allow explicit retry
  do not auto-redirect again immediately
```

---

## 10. Token Validation Error Handling

Bearer token APIs must distinguish client-actionable errors.

### 10.1 Token Missing

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="case-api"
```

Client action: obtain token.

### 10.2 Token Expired

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="case-api", error="invalid_token"
```

Client action: refresh token if available.

External body:

```json
{
  "status": 401,
  "code": "INVALID_TOKEN",
  "message": "Authentication is required.",
  "correlationId": "..."
}
```

### 10.3 Token Audience Invalid

Do not tell unknown clients too much.

```json
{
  "status": 401,
  "code": "INVALID_TOKEN",
  "message": "Authentication is required.",
  "correlationId": "..."
}
```

Internal:

```text
TOKEN_AUDIENCE_INVALID expected=case-api actual=profile-api
```

### 10.4 Valid Token, Missing Scope

OAuth-style API may use:

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer realm="case-api", error="insufficient_scope", scope="case:approve"
```

But be careful if scope names reveal internal capabilities.

### 10.5 Valid Token, Domain Denial

```text
scope includes case:approve
but case state = CLOSED
or user is maker and cannot approve own submission
```

Return:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "status": 403,
  "code": "DOMAIN_POLICY_DENIED",
  "message": "You cannot perform this action for the current item.",
  "correlationId": "..."
}
```

Internal:

```text
reason=MAKER_CHECKER_DENIED
policy=case-approval:v17
```

---

## 11. 400 vs 401 vs 403 vs 404 vs 409 vs 422

Security errors often overlap with validation and domain state errors.

### 11.1 Practical Matrix

| Situation | Recommended HTTP | Reason |
|---|---:|---|
| Missing credential | 401 | caller not authenticated |
| Invalid/expired credential | 401 | caller identity not established |
| Valid credential, missing role/scope | 403 | identity known but not allowed |
| Valid credential, cross-tenant object concealed | 404 | avoid resource enumeration |
| Malformed request body | 400 | request cannot be parsed |
| Valid request but domain state blocks action | 409 or 403 | depends whether denial is state conflict or permission denial |
| Validation failed for business input | 422 or 400 | semantic validation issue |
| CSRF token missing/invalid | 403 | request not authorized as same-site user intent |
| CORS origin denied | no CORS headers / 403 optional | browser enforcement + server policy |
| Rate limited login attempts | 429 | throttling |
| IdP unavailable | 503 | dependency unavailable |

### 11.2 409 vs 403 in Workflow

Example:

User has permission to approve, but case is already approved.

```text
This is not authorization denial.
It is state conflict.
→ 409 Conflict
```

User does not have permission to approve pending case.

```text
Authorization denial.
→ 403 Forbidden
```

User is maker and cannot approve own case.

```text
Could be 403 because actor is not allowed by segregation policy.
→ 403 Forbidden
```

Case was updated between read and approve.

```text
Optimistic concurrency conflict.
→ 409 Conflict
```

This distinction matters because clients react differently.

---

## 12. Jakarta Implementation Pattern: Centralized Error Mapper

For Jakarta REST/JAX-RS APIs, use exception mapping.

### 12.1 Domain Exceptions

```java
public abstract class SecurityApplicationException extends RuntimeException {
    private final String code;
    private final int status;
    private final boolean retryable;

    protected SecurityApplicationException(String code, int status, boolean retryable) {
        this.code = code;
        this.status = status;
        this.retryable = retryable;
    }

    public String code() { return code; }
    public int status() { return status; }
    public boolean retryable() { return retryable; }
}
```

```java
public final class AuthenticationRequiredException extends SecurityApplicationException {
    public AuthenticationRequiredException() {
        super("AUTHENTICATION_REQUIRED", 401, false);
    }
}
```

```java
public final class AccessDeniedAppException extends SecurityApplicationException {
    public AccessDeniedAppException() {
        super("ACCESS_DENIED", 403, false);
    }
}
```

### 12.2 Error DTO

```java
public record ApiErrorResponse(
        int status,
        String code,
        String message,
        String correlationId,
        boolean retryable
) {}
```

### 12.3 ExceptionMapper

```java
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class SecurityExceptionMapper implements ExceptionMapper<SecurityApplicationException> {

    @Override
    public Response toResponse(SecurityApplicationException exception) {
        String correlationId = Correlation.currentId();

        ApiErrorResponse body = new ApiErrorResponse(
                exception.status(),
                exception.code(),
                safeMessage(exception.code()),
                correlationId,
                exception.retryable()
        );

        Response.ResponseBuilder builder = Response
                .status(exception.status())
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(body);

        if (exception.status() == 401) {
            builder.header("WWW-Authenticate", "Bearer realm=\"case-api\"");
        }

        return builder.build();
    }

    private String safeMessage(String code) {
        return switch (code) {
            case "AUTHENTICATION_REQUIRED", "INVALID_TOKEN", "EXPIRED_SESSION" ->
                    "Authentication is required.";
            case "ACCESS_DENIED", "DOMAIN_POLICY_DENIED" ->
                    "You do not have permission to perform this action.";
            default ->
                    "The request could not be completed.";
        };
    }
}
```

Important: do not blindly expose `exception.getMessage()`.

---

## 13. Jakarta Servlet Pattern: Entry Point vs Access Denied

Servlet/Jakarta Security has two kinds of security failure:

```text
authentication failure → challenge/redirect/error
authorization failure → forbidden/error page
```

In container-managed security, some handling is configured by container/deployment descriptor. In custom mechanisms, `HttpAuthenticationMechanism` can return statuses such as success, send failure, send continue, or not done depending API version and mechanism flow.

### 13.1 Browser Page Error Pages

`web.xml` can define error pages:

```xml
<error-page>
    <error-code>403</error-code>
    <location>/WEB-INF/views/errors/403.jsp</location>
</error-page>

<error-page>
    <error-code>404</error-code>
    <location>/WEB-INF/views/errors/404.jsp</location>
</error-page>

<error-page>
    <error-code>500</error-code>
    <location>/WEB-INF/views/errors/500.jsp</location>
</error-page>
```

Do not expose stack trace on error page.

### 13.2 API Paths Should Not Return JSP Error Page

If `/api/**` is handled by JAX-RS, make sure error mapping returns JSON.

Pattern:

```text
/WEB-INF/views/errors/*.jsp only for HTML routes
JAX-RS ExceptionMapper for API routes
Gateway error transformer if gateway terminates auth
```

---

## 14. Error Handling Around CSRF

CSRF invalidation is often mishandled.

Scenario:

```text
User session valid
POST /cases/123/approve
CSRF token missing/invalid
```

This is not unauthenticated. It is a request integrity failure.

Recommended:

```text
403 Forbidden
code: CSRF_TOKEN_INVALID
message: "The request could not be completed. Please refresh the page and try again."
```

Internal audit:

```text
SECURITY_REQUEST_REJECTED reason=CSRF_TOKEN_INVALID user=... session=... origin=...
```

Do not automatically log user out for every CSRF failure unless you have strong reason. It can be a stale tab, expired token, or attack. Consider risk-based action.

---

## 15. Error Handling Around CORS

CORS failures are often seen by browser as generic network errors.

Important:

```text
CORS is browser-enforced response sharing policy.
It is not server-side business authorization.
```

For disallowed origins:

- do not include `Access-Control-Allow-Origin`, or
- return 403 with no permissive CORS headers.

Do not reflect arbitrary Origin:

```http
Access-Control-Allow-Origin: <whatever request sent>
Access-Control-Allow-Credentials: true
```

That is dangerous for credentialed requests.

### 15.1 Observability

Because frontend sees vague CORS error, backend should log:

```text
CORS_ORIGIN_DENIED origin=https://evil.example path=/api/cases method=POST correlationId=...
```

But do not expose internal CORS allowlist to client.

---

## 16. User Experience Design for Security Errors

Security UX must guide legitimate users without helping attackers too much.

### 16.1 Login Page Errors

Good:

```text
We could not sign you in. Check your credentials and try again.
```

Better for enterprise SSO:

```text
Login could not be completed. Please try again or contact your administrator with reference ID 01JY6Q7A2J9Y5VP8M6Z1X4K2G9.
```

Avoid:

```text
Your account exists but role ACEAS_EXTERNAL_OFFICER missing from Keycloak group /prod/cea/officer.
```

### 16.2 Authorization Denial Page

Good:

```text
You do not have access to this page.
Reference ID: 01JY6Q7A2J9Y5VP8M6Z1X4K2G9
```

For enterprise internal apps, useful but safe:

```text
You may need a different role or organization access. Contact your administrator if you believe this is incorrect.
```

Avoid showing exact required role unless the app is internal and role names are not sensitive.

### 16.3 Workflow Action Denial

Example: Approve button visible due to stale UI, but backend denies.

Good:

```text
This action is no longer available for the current case state. Refresh the page and try again.
```

For maker-checker:

```text
You cannot approve an item that you submitted.
```

This is acceptable if the user is already inside authorized workflow context and the rule is part of business UX. It is not the same as exposing raw internal policy.

---

## 17. Denial Reason: Safe vs Sensitive

Not all denial reasons are equally sensitive.

### 17.1 Usually Safe to Show

```text
Your session has expired.
Please sign in again.
The item has already been updated.
You cannot approve your own submission.
This action is not available in the current state.
```

### 17.2 Usually Sensitive

```text
You are missing role PROD_SUPER_ADMIN.
Resource belongs to tenant CEA-INTERNAL-42.
Policy expression failed: user.group in {enforcement.directorate.secret}
JWT audience was profile-api not case-api.
SAML signature validation failed at reference URI #abc.
```

### 17.3 Context-Dependent

```text
Account locked.
MFA required.
Password expired.
User does not exist.
Role missing.
```

These may be shown after authentication or in admin console, but not necessarily during public login.

---

## 18. Audit Event Design for Security Errors

Every meaningful auth/security failure should produce structured internal event.

### 18.1 Authentication Failure Event

```json
{
  "eventType": "AUTHENTICATION_FAILURE",
  "reason": "INVALID_CREDENTIAL",
  "subjectHintHash": "sha256:...",
  "clientIp": "203.0.113.10",
  "userAgentHash": "sha256:...",
  "authMechanism": "FORM",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9",
  "timestamp": "2026-06-17T09:21:33Z"
}
```

### 18.2 Authorization Denial Event

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "subjectId": "user:12345",
  "tenantId": "agency:CEA",
  "action": "CASE_APPROVE",
  "resourceType": "CASE",
  "resourceId": "case:98765",
  "resourceState": "PENDING_APPROVAL",
  "reason": "MAKER_CHECKER_DENIED",
  "policyVersion": "case-policy:v42",
  "decisionId": "authz-01JY6Q8VMF7...",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9",
  "timestamp": "2026-06-17T09:22:01Z"
}
```

### 18.3 Token Failure Event

Never log full token.

```json
{
  "eventType": "TOKEN_VALIDATION_FAILED",
  "reason": "AUDIENCE_INVALID",
  "issuer": "https://idp.example.com/realms/main",
  "audienceExpected": "case-api",
  "audienceActualHash": "sha256:...",
  "kid": "key-2026-01",
  "tokenJtiHash": "sha256:...",
  "correlationId": "..."
}
```

### 18.4 Privacy and Minimization

Audit needs enough data to reconstruct decisions, not unlimited personal data.

Avoid:

```text
raw password
raw access token
raw refresh token
full SAML assertion
full ID token
sensitive PII claim dump
complete request body if it may contain personal data
```

---

## 19. Correlation ID and Support Reference

External error should include support reference, not internal stack trace.

```json
{
  "status": 403,
  "code": "ACCESS_DENIED",
  "message": "You do not have permission to perform this action.",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9"
}
```

Support can search logs/audit by correlation ID.

### 19.1 Correlation ID Requirements

```text
created at edge/gateway or app entry
propagated through services
included in logs
included in audit events
included in error response
not guessable if used as support reference
not treated as authentication secret
```

### 19.2 Request ID vs Correlation ID vs Decision ID

```text
requestId:
  unique per HTTP request

correlationId:
  groups related operations across services

decisionId:
  unique authorization decision reference
```

For complex workflow action:

```text
correlationId: user click approve
requestId: HTTP POST /approve
transactionId: DB transaction
outboxEventId: case approved event
authzDecisionId: permission decision
```

---

## 20. Secure Logging for Exceptions

### 20.1 Bad Logging

```java
catch (Exception e) {
    log.error("Login failed for password {} token {}", password, token, e);
}
```

### 20.2 Better Logging

```java
catch (AuthenticationException e) {
    log.warn("Authentication failed reason={} subjectHintHash={} correlationId={}",
            e.reason(),
            hash(subjectHint),
            Correlation.currentId());
}
```

### 20.3 Error Log Levels

```text
Expected invalid login:
  WARN or INFO depending volume/risk

Repeated invalid login / attack pattern:
  WARN + security alert

Authorization denial from normal user mistake:
  INFO/AUDIT

Forbidden admin endpoint attempt:
  WARN/AUDIT

IdP/JWKS/LDAP unavailable:
  ERROR + alert

Token signature invalid from internet:
  INFO/WARN depending rate
```

Be careful: too many WARN logs for normal invalid credentials can create alert fatigue.

---

## 21. Avoiding Stack Trace and Framework Leakage

Never expose:

```text
jakarta.ejb.EJBAccessException: Caller unauthorized
org.hibernate.exception.SQLGrammarException
java.lang.NullPointerException
com.nimbusds.jose.proc.BadJOSEException: Signed JWT rejected: Invalid signature
oracle.jdbc.OracleDatabaseException: ORA-00942
```

External response:

```json
{
  "status": 500,
  "code": "INTERNAL_ERROR",
  "message": "The request could not be completed.",
  "correlationId": "..."
}
```

Internal log:

```text
full stack trace with correlationId
```

For 403 from framework exception, map to safe error response.

---

## 22. Error Handling in Gateway + Jakarta App

When gateway handles authentication, the app may only see identity headers.

Failure points:

```text
gateway denies before app
app denies after gateway
backend token validation denies
downstream service denies
```

### 22.1 Consistent Error Shape

Without consistency:

```text
gateway returns {"message":"Forbidden"}
app returns {"error":"ACCESS_DENIED"}
downstream returns HTML 403
```

Frontend becomes fragile.

Pattern:

```text
gateway error transformer outputs same problem JSON
app exception mapper outputs same problem JSON
downstream errors are normalized at API boundary
```

### 22.2 Preserve Origin of Denial Internally

External:

```json
{
  "status": 403,
  "code": "ACCESS_DENIED",
  "correlationId": "..."
}
```

Internal:

```text
deniedAt=GATEWAY reason=JWT_MISSING
or deniedAt=APP reason=DOMAIN_POLICY_DENIED
or deniedAt=DOWNSTREAM reason=SCOPE_REQUIRED
```

---

## 23. Fail Open vs Fail Closed in Error Handling

Security dependency failure must be explicitly designed.

### 23.1 Identity Store Unavailable

```text
Can we authenticate user?
No.
→ fail closed
→ 503 or login failure page
```

Do not allow login because LDAP/database is down.

### 23.2 Policy Engine Unavailable

```text
Can we determine authorization?
No.
→ fail closed
→ 403 or 503 depending client contract
```

For API:

```json
{
  "status": 503,
  "code": "AUTHORIZATION_SERVICE_UNAVAILABLE",
  "message": "The request could not be completed.",
  "retryable": true,
  "correlationId": "..."
}
```

Use 503 if client can retry later and denial is due to system unavailability, not policy denial.

### 23.3 JWKS Unavailable

If key is cached and valid:

```text
continue with cached key until TTL/stale limit
```

If no key can validate:

```text
fail closed
→ 503 or 401 depending API contract
```

For internal observability, distinguish:

```text
TOKEN_INVALID_SIGNATURE
JWKS_UNAVAILABLE
KID_NOT_FOUND
```

---

## 24. Rate Limiting and Lockout Errors

Rate limiting security endpoints must avoid helping attackers.

### 24.1 Login Rate Limit

Response:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

Body:

```json
{
  "status": 429,
  "code": "TOO_MANY_ATTEMPTS",
  "message": "Too many attempts. Please try again later.",
  "correlationId": "..."
}
```

### 24.2 Account Lockout

Public login:

```text
We could not sign you in. Please try again later or contact your administrator.
```

Internal:

```text
ACCOUNT_LOCKED failedCount=10 lockExpiresAt=...
```

### 24.3 Avoiding Enumeration Through Timing

Even if messages are generic, timing can leak.

Example:

```text
unknown user → fast return
known user → bcrypt check → slow return
```

Mitigation:

```text
perform fake password hash for unknown user
normalize response time within practical bounds
avoid precise external reason
```

---

## 25. Step-Up Authentication and Reauthentication Errors

Some actions require stronger assurance.

Example:

```text
view page → normal session enough
approve high-risk case → MFA or recent login required
change bank account → reauthentication required
```

### 25.1 Error Contract

For browser:

```text
302 /reauth?continue=/cases/123/approve
```

For API:

```http
HTTP/1.1 401 Unauthorized
```

```json
{
  "status": 401,
  "code": "STEP_UP_REQUIRED",
  "message": "Additional verification is required.",
  "reauthRequired": true,
  "correlationId": "..."
}
```

### 25.2 Distinguish from 403

Step-up required is not necessarily lack of permission.

```text
User has permission but assurance level is insufficient.
→ 401/interaction required or dedicated code
```

After step-up, if still not allowed:

```text
→ 403
```

---

## 26. Domain Authorization Denial UX in Case Management

In workflow/case systems, denial is often not a simple role issue.

### 26.1 Examples

```text
User is not assigned officer.
User is maker and cannot approve own submission.
Case is no longer in review state.
User's delegation expired.
User's active organization does not match case organization.
Officer can view but cannot edit closed case.
Supervisor can approve only after officer recommendation.
```

### 26.2 External Messages

Good:

```text
You cannot perform this action for the current case.
```

Better when rule is business-visible:

```text
You cannot approve a case that you submitted.
```

For stale state:

```text
This case has changed since you opened it. Refresh the page and try again.
```

For tenant/org mismatch:

```text
You do not have access to this case.
```

### 26.3 Internal Denial Codes

```text
NOT_ASSIGNED_OFFICER
MAKER_CHECKER_DENIED
INVALID_STATE_FOR_ACTION
DELEGATION_EXPIRED
TENANT_MISMATCH
READ_ONLY_STATE
APPROVAL_SEQUENCE_NOT_READY
```

These should exist even when external message is generic.

---

## 27. Frontend Contract

Frontend needs stable codes, not English string parsing.

Bad frontend:

```javascript
if (error.message.includes("expired")) {
  refreshToken();
}
```

Better:

```javascript
switch (error.code) {
  case "EXPIRED_SESSION":
  case "INVALID_SESSION":
  case "AUTHENTICATION_REQUIRED":
    redirectToLogin();
    break;
  case "STEP_UP_REQUIRED":
    redirectToReauth();
    break;
  case "ACCESS_DENIED":
    showForbiddenPage(error.correlationId);
    break;
  case "CONFLICT_STALE_RESOURCE":
    showRefreshRequired();
    break;
  default:
    showGenericError(error.correlationId);
}
```

### 27.1 Stable Error Codes

Error codes are API contract. Do not rename casually.

Version them if needed:

```text
ACCESS_DENIED
ACCESS_DENIED_V2 rarely needed; prefer additive fields
```

---

## 28. Security Error Checklist per Layer

### 28.1 Browser HTML App

```text
[ ] unauthenticated protected page redirects to login
[ ] forbidden page does not redirect to login loop
[ ] error page includes correlation ID
[ ] stack trace hidden
[ ] login failure generic
[ ] OIDC callback failure terminal, not looping
[ ] logout failure safe
```

### 28.2 REST API

```text
[ ] missing token returns 401
[ ] invalid token returns 401
[ ] insufficient permission returns 403
[ ] cross-tenant concealed resource returns 404 if required
[ ] JSON error body consistent
[ ] `WWW-Authenticate` present for 401 where applicable
[ ] no HTML login page for API request
[ ] no stack trace
[ ] correlation ID present
```

### 28.3 Gateway

```text
[ ] gateway auth failures normalized
[ ] app auth failures normalized
[ ] trusted header spoofing denied
[ ] forwarded header parsing failure safe
[ ] upstream 401/403 not converted incorrectly
```

### 28.4 Audit/Observability

```text
[ ] authentication failure audit event
[ ] authorization denial audit event
[ ] token validation failure classified
[ ] OIDC/SAML/mTLS failure classified
[ ] correlation ID consistent
[ ] no raw secrets logged
[ ] support can search by reference ID
```

---

## 29. Testing Secure Error Handling

### 29.1 Authentication Tests

```text
missing credential → 401
invalid credential → generic login failure
unknown username → same message as wrong password
locked account → no enumeration leakage
expired session → login required
invalid CSRF → 403
```

### 29.2 Authorization Tests

```text
valid user missing role → 403
valid user wrong tenant → 404 or 403 by policy
valid user wrong state → 409 or 403 by policy
maker approving own case → 403
expired delegation → 403
admin endpoint non-admin → 403
```

### 29.3 Token Tests

```text
missing token → 401 + WWW-Authenticate
expired token → 401
invalid signature → 401 generic
wrong issuer → 401 generic
wrong audience → 401 generic
missing scope → 403
valid scope but domain denial → 403
```

### 29.4 OIDC Tests

```text
state mismatch → safe login failure page
nonce mismatch → safe login failure page
authorization code reused → safe login failure page
JWKS unavailable → safe error + alert
missing group claim → account mapping failure
```

### 29.5 Negative UX Tests

```text
API never returns HTML login page
403 does not redirect to login loop
404 concealment still audited
correlation ID exists on all errors
frontend does not parse human message
```

---

## 30. Java 8–25 Considerations

Most error handling concepts are runtime-independent, but Java/Jakarta versions affect implementation style.

### 30.1 Java 8

```text
records unavailable
switch expression unavailable
older javax namespace common
manual DTO classes needed
older app servers common
```

### 30.2 Java 11/17

```text
better TLS defaults than old Java 8 deployments
records available in Java 16+
modern logging libraries common
Jakarta EE 10 often targets Java 11+
```

### 30.3 Java 21/25

```text
virtual threads may affect MDC/security context propagation
structured concurrency style can improve request-scoped cancellation
modern language features simplify error model
but container support must be verified
```

### 30.4 `javax` vs `jakarta`

Legacy Java EE 8:

```java
import javax.ws.rs.ext.ExceptionMapper;
import javax.ws.rs.ext.Provider;
```

Modern Jakarta EE:

```java
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
```

Error design remains the same; packages and container behavior differ.

---

## 31. Production Anti-Patterns

### 31.1 Returning 200 for Security Errors

Bad:

```json
{
  "success": false,
  "error": "not authorized"
}
```

with HTTP 200.

Why bad:

- caches/proxies may treat as success,
- clients cannot rely on status,
- monitoring misreads failures,
- standards broken.

### 31.2 Redirecting API to Login Page

Bad:

```text
/api/** → 302 /login → 200 HTML
```

### 31.3 Leaking Required Role

Bad:

```json
{
  "error": "Missing role SUPER_ADMIN_PROD_ROOT"
}
```

### 31.4 Exposing Stack Trace

Bad:

```text
jakarta.ejb.EJBAccessException: Caller was not authorized
at com.sun.ejb.containers.BaseContainer.authorize(...)
```

### 31.5 Treating Authorization Failure as Validation Error

Bad:

```http
HTTP/1.1 400 Bad Request
```

for missing permission.

### 31.6 Treating State Conflict as Access Denied

Bad:

```http
HTTP/1.1 403 Forbidden
```

when case was already approved by someone else. Use 409 if user had permission but state changed.

### 31.7 Logging Full Token

Bad:

```text
Invalid token eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 31.8 Error Code Explosion

Bad:

```text
ACCESS_DENIED_ROLE_ADMIN_MISSING_FOR_CASE_APPROVE_WHEN_CASE_PENDING_AND_USER_NOT_SUPERVISOR
```

Prefer stable category + internal reason:

```text
external code: ACCESS_DENIED
internal reason: CASE_APPROVE_SUPERVISOR_REQUIRED
```

---

## 32. Reference Architecture: Secure Error Handling Flow

```text
[Client]
   |
   v
[Gateway]
   - request id / correlation id
   - optional token pre-validation
   - normalized gateway errors
   |
   v
[Jakarta Servlet Container]
   - authentication mechanism
   - session/token/cert handling
   - servlet constraints
   |
   v
[JAX-RS / Servlet / CDI Boundary]
   - exception mapper
   - safe error body
   - WWW-Authenticate
   |
   v
[Domain Authorization Service]
   - subject/action/resource/tenant/state decision
   - decision reason
   - audit event
   |
   v
[Response]
   - correct HTTP status
   - safe message
   - stable code
   - correlation id
```

---

## 33. Design Blueprint: Error Code Model

```java
public enum SecurityErrorCode {
    AUTHENTICATION_REQUIRED,
    INVALID_CREDENTIAL,
    INVALID_SESSION,
    EXPIRED_SESSION,
    INVALID_TOKEN,
    STEP_UP_REQUIRED,
    ACCESS_DENIED,
    DOMAIN_POLICY_DENIED,
    TENANT_ACCESS_DENIED,
    RESOURCE_NOT_FOUND,
    CSRF_TOKEN_INVALID,
    TOO_MANY_ATTEMPTS,
    AUTHENTICATION_SERVICE_UNAVAILABLE,
    AUTHORIZATION_SERVICE_UNAVAILABLE
}
```

Internal reason can be richer:

```java
public enum AuthorizationDenialReason {
    ROLE_MISSING,
    SCOPE_MISSING,
    TENANT_MISMATCH,
    NOT_ASSIGNED,
    MAKER_CHECKER_DENIED,
    SEPARATION_OF_DUTY_DENIED,
    INVALID_RESOURCE_STATE,
    DELEGATION_EXPIRED,
    BREAK_GLASS_REQUIRED,
    POLICY_ENGINE_UNAVAILABLE
}
```

External code should be stable. Internal reason can evolve faster.

---

## 34. Mental Model Summary

Security error handling is not cosmetic.

It decides:

```text
Should client authenticate?
Should client stop because access is denied?
Should resource existence be hidden?
Should user retry?
Should frontend refresh token?
Should user reauthenticate?
Should support investigate with correlation ID?
Should audit record a denial?
Should security monitoring alert?
```

The strongest mental model:

```text
401 = identity not established / challenge required
403 = identity established but action not allowed
404 = resource existence concealed or genuinely absent
409 = user may be allowed but resource state changed/conflicts
429 = throttled
503 = security dependency unavailable
```

But the real skill is not memorizing status codes. The real skill is designing consistent behavior across:

- browser pages,
- REST APIs,
- SPA AJAX,
- gateway,
- Jakarta container,
- IdP callback,
- downstream services,
- workflow engine,
- audit pipeline.

---

## 35. Practical Review Questions

Use these when reviewing a Jakarta security implementation:

1. Does `/api/**` ever return HTML login page?
2. Are 401 and 403 used consistently?
3. Does every 401 that needs challenge include `WWW-Authenticate`?
4. Are login errors generic enough to prevent account enumeration?
5. Are detailed denial reasons captured internally?
6. Are raw tokens, passwords, SAML assertions, or client certs logged?
7. Does 403 page include correlation ID?
8. Can support trace correlation ID to audit event?
9. Are cross-tenant resources concealed when required?
10. Is stale workflow state returned as 409 rather than misleading 403?
11. Does OIDC callback failure avoid redirect loops?
12. Does frontend rely on stable error code rather than message text?
13. Are gateway and app errors normalized?
14. Are security dependency outages fail-closed?
15. Are denial events auditable enough for regulatory defense?

---

## 36. Mini Capstone Example: Case Approval Denial

Scenario:

```text
User: officer-123
Tenant: CEA
Action: approve case
Case: CASE-2026-0001
State: PENDING_APPROVAL
Problem: user created the case and maker-checker rule denies self-approval
```

External response:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json
```

```json
{
  "type": "https://errors.example.com/domain-policy-denied",
  "title": "Action not allowed",
  "status": 403,
  "code": "DOMAIN_POLICY_DENIED",
  "message": "You cannot approve an item that you submitted.",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9"
}
```

Internal audit:

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "decisionId": "authz-01JY6Q9JHD4MNWVR7ZP",
  "subjectId": "officer-123",
  "tenantId": "CEA",
  "action": "CASE_APPROVE",
  "resourceType": "CASE",
  "resourceId": "CASE-2026-0001",
  "resourceState": "PENDING_APPROVAL",
  "reason": "MAKER_CHECKER_DENIED",
  "policyVersion": "case-authorization:v42",
  "correlationId": "01JY6Q7A2J9Y5VP8M6Z1X4K2G9",
  "timestamp": "2026-06-17T09:25:13Z"
}
```

This is the target shape: safe for user, precise for audit, useful for support, stable for frontend.

---

## 37. What This Part Enables

After this part, we can design security behavior that is not only correct when access is granted, but also correct when access is denied.

This prepares us for the next topic: **Auditing, Accountability, Non-Repudiation, and Forensic Readiness**, because secure error handling is the entry point into serious auditability.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-26-browser-security-csrf-cors-clickjacking.md">⬅️ Part 26 — CSRF, CORS, Clickjacking, and Browser Security Around Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-28-auditing-accountability-non-repudiation-forensics.md">Part 28 — Auditing, Accountability, Non-Repudiation, and Forensic Readiness ➡️</a>
</div>
