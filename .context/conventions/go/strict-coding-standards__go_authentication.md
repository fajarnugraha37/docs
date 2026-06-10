# Strict Coding Standards — Go Authentication

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go APIs, web applications, CLIs, workers, gateways, internal services, identity adapters, regulatory workflow systems  
Baseline: Go 1.24–1.26+, security-first implementation, OAuth 2.0/OIDC/session/password handling only through approved libraries and explicit project decisions

---

## 1. Purpose

Authentication is the process of proving **who or what** is making a request.

The LLM MUST treat authentication code as security-critical. It MUST NOT implement authentication through improvised token parsing, string matching, custom password hashing, custom session generation, custom OAuth/OIDC flows, or incomplete JWT validation.

This standard exists to make Go authentication code:

- explicit about identity source and trust boundary,
- resistant to token substitution, replay, fixation, and confused-deputy bugs,
- safe under malformed credentials and adversarial requests,
- compatible with external identity providers,
- auditable without leaking secrets,
- testable using deterministic negative cases,
- maintainable across service, gateway, job, and worker contexts.

Authentication MUST be separated from authorization. Authentication establishes identity and authenticated context. Authorization decides whether that identity may perform an operation on a resource.

---

## 2. Source authority

Primary references:

- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- NIST SP 800-63B Digital Identity Guidelines — Authentication and Authenticator Lifecycle Management: https://csrc.nist.gov/pubs/sp/800/63/b/upd2/final
- OAuth 2.0 Security Best Current Practice, RFC 9700: https://www.rfc-editor.org/rfc/rfc9700.html
- OAuth 2.0 Bearer Token Usage, RFC 6750: https://www.rfc-editor.org/rfc/rfc6750.html
- JSON Web Token, RFC 7519: https://datatracker.ietf.org/doc/html/rfc7519
- OpenID Connect Core 1.0: https://openid.net/specs/openid-connect-core-1_0.html
- Go `net/http`: https://pkg.go.dev/net/http
- Go `crypto/rand`: https://pkg.go.dev/crypto/rand
- Go `crypto/subtle`: https://pkg.go.dev/crypto/subtle
- Go `crypto/tls`: https://pkg.go.dev/crypto/tls
- Go `golang.org/x/oauth2`: https://pkg.go.dev/golang.org/x/oauth2
- Go Security documentation: https://go.dev/doc/security/

If this document conflicts with project identity-provider policy, regulatory policy, or enterprise security policy, the stricter rule wins. The LLM MUST report material conflict instead of silently choosing the easier implementation.

---

## 3. Authentication model

Every authentication implementation MUST explicitly identify these elements:

| Element               | Required decision                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Principal             | Human user, service account, machine client, scheduled job, external system, anonymous user.                    |
| Credential            | Password, session cookie, bearer token, client certificate, API key, signed webhook, OAuth code, refresh token. |
| Issuer                | Local service, IdP, authorization server, gateway, partner system, certificate authority.                       |
| Audience              | Which service/API the credential is intended for.                                                               |
| Lifetime              | Expiry, refresh policy, inactivity timeout, revocation policy.                                                  |
| Binding               | Browser session, client, device, TLS channel, mTLS subject, nonce/state, PKCE verifier.                         |
| Authenticated context | Stable internal representation of the principal after validation.                                               |
| Failure mode          | 401 vs 403 vs 400 vs 429 vs 500; no information leakage.                                                        |

The LLM MUST NOT write authentication code until these elements are either present in existing architecture or explicitly represented in code/configuration.

---

## 4. Non-negotiable authentication rules

### 4.1 Do not invent authentication protocols

The LLM MUST NOT implement custom authentication protocols unless the project explicitly requires a bounded integration adapter for a legacy system.

Forbidden:

```go
// FORBIDDEN: home-grown token format.
token := base64.StdEncoding.EncodeToString([]byte(userID + ":" + time.Now().String()))
```

Required:

- use standard session management,
- use OAuth 2.0/OIDC flows through approved libraries,
- use signed tokens only with complete claim validation,
- use mTLS only with explicit certificate validation rules,
- use API keys only as opaque secrets with hashing, rotation, scope, and audit.

### 4.2 Never authenticate by trusting user-controlled fields

The LLM MUST NOT trust headers such as `X-User-ID`, `X-Email`, `X-Role`, `X-Tenant-ID`, or `X-Forwarded-*` unless the request is behind a trusted gateway and the gateway-to-service trust contract is documented and enforced.

Forbidden:

```go
// FORBIDDEN: caller can forge this header.
userID := r.Header.Get("X-User-ID")
```

Required:

```go
identity, ok := authn.IdentityFromContext(r.Context())
if !ok {
    http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
    return
}
```

If identity comes from gateway-injected headers, the service MUST validate that the request came through the trusted gateway path, for example by network boundary, mTLS, signed internal header, or service mesh policy.

### 4.3 Authentication is not authorization

Authenticated identity MUST NOT imply access.

Forbidden:

```go
// FORBIDDEN: login success is not permission.
if user.Authenticated {
    approveCase(caseID)
}
```

Required:

```go
if err := authorizer.Require(ctx, actor, authz.ActionApproveCase, resource); err != nil {
    return err
}
```

### 4.4 Fail closed

Authentication middleware MUST fail closed. Missing credentials, malformed credentials, expired credentials, invalid signature, invalid issuer, invalid audience, invalid nonce, or validation errors MUST result in unauthenticated request state.

No handler may proceed with a partially authenticated principal.

### 4.5 Public errors must be generic

Authentication failures MUST NOT disclose whether user ID, email, token ID, password, certificate, session, or MFA factor was the failing component.

Required public messages:

- `invalid credentials`,
- `unauthorized`,
- `authentication required`,
- `session expired` if deliberately allowed by product/security policy.

Internal logs MAY contain failure category if redacted and not containing secrets.

---

## 5. Authenticated actor model

A Go service MUST convert transport credentials into a stable internal actor type.

Required shape:

```go
package authn

type PrincipalKind string

const (
    PrincipalHuman   PrincipalKind = "human"
    PrincipalService PrincipalKind = "service"
    PrincipalSystem  PrincipalKind = "system"
    PrincipalPartner PrincipalKind = "partner"
)

type Actor struct {
    Subject      string
    Kind         PrincipalKind
    TenantID     string
    SessionID    string
    ClientID     string
    AuthTimeUnix int64
    Assurance    string
    Issuer       string
    Scopes       []string // Authenticated claim only; authorization must still evaluate policy.
}
```

Rules:

- `Subject` MUST be stable and issuer-scoped.
- Email MUST NOT be the only stable identity key unless project policy explicitly guarantees immutability.
- Display name MUST NOT be used as identity.
- Tenant MUST be explicit if the system is multi-tenant.
- Scopes/roles in actor are claims, not final authorization decisions.
- Actor MUST NOT contain raw tokens, passwords, OTPs, refresh tokens, private keys, or session secrets.

Context attachment MUST use typed private keys:

```go
type actorContextKey struct{}

func ContextWithActor(ctx context.Context, actor Actor) context.Context {
    return context.WithValue(ctx, actorContextKey{}, actor)
}

func ActorFromContext(ctx context.Context) (Actor, bool) {
    actor, ok := ctx.Value(actorContextKey{}).(Actor)
    return actor, ok
}
```

The LLM MUST NOT use string keys for context values.

---

## 6. Password authentication

### 6.1 Prefer external IdP over local password storage

New systems SHOULD delegate human authentication to an approved identity provider. Local password authentication MUST only be implemented when project policy requires it.

### 6.2 Password storage

If local password storage exists:

- passwords MUST be hashed using an approved password hashing algorithm such as Argon2id, bcrypt, scrypt, or enterprise-approved equivalent;
- plain hashes such as SHA-256, SHA-512, MD5, or unsalted hash MUST NOT be used for passwords;
- unique salt MUST be used by the password hashing algorithm;
- pepper MAY be used only if stored in a separate secret manager;
- password hash parameters MUST be versioned to allow migration;
- password verification MUST be constant-time where the library does not already guarantee safe comparison;
- old hash migration MUST happen after successful authentication, not by weakening verification rules.

Forbidden:

```go
// FORBIDDEN: fast general-purpose hash is not password hashing.
sum := sha256.Sum256([]byte(password))
```

### 6.3 Password input and logging

The LLM MUST NOT log:

- password,
- password hash,
- password reset token,
- OTP,
- MFA recovery code,
- full credential payload.

Errors MUST NOT echo submitted credential values.

### 6.4 Account enumeration

Login, password reset, account recovery, and MFA challenge endpoints MUST avoid account enumeration. Response body and timing SHOULD be consistent enough not to reveal whether an account exists.

### 6.5 Rate limiting and lockout

Authentication endpoints MUST have abuse controls:

- rate limit by account identifier and source signal,
- exponential delay or progressive throttling,
- lockout only if product/security policy avoids easy denial-of-service,
- audit suspicious activity,
- do not leak whether account exists.

---

## 7. Session authentication

### 7.1 Session identifier generation

Session IDs MUST be generated using cryptographically secure randomness from `crypto/rand` or a vetted session library.

Forbidden:

```go
// FORBIDDEN: predictable session ID.
sid := fmt.Sprintf("%d-%s", time.Now().UnixNano(), userID)
```

Required:

```go
func NewSessionID() (string, error) {
    b := make([]byte, 32)
    if _, err := rand.Read(b); err != nil {
        return "", fmt.Errorf("generate session id: %w", err)
    }
    return base64.RawURLEncoding.EncodeToString(b), nil
}
```

### 7.2 Cookie settings

Authentication cookies MUST be configured intentionally:

```go
http.SetCookie(w, &http.Cookie{
    Name:     "__Host-session",
    Value:    sessionID,
    Path:     "/",
    Secure:   true,
    HttpOnly: true,
    SameSite: http.SameSiteLaxMode,
    MaxAge:   int(sessionTTL.Seconds()),
})
```

Rules:

- `Secure` MUST be true in production.
- `HttpOnly` MUST be true for session cookies.
- `SameSite` MUST be explicitly set based on product flow.
- Cookie name SHOULD use `__Host-` prefix when browser compatibility and deployment model allow it.
- Session cookie value MUST be opaque.
- Session cookie MUST NOT contain serialized user profile, roles, permissions, or secrets.

### 7.3 Session fixation

The service MUST rotate session ID after login, privilege elevation, MFA completion, password change, or account recovery.

### 7.4 Server-side session state

Server-side session stores MUST support:

- expiry,
- revocation,
- rotation,
- audit metadata,
- device/session listing when product requires it,
- safe cleanup.

Session store errors MUST fail closed for protected endpoints.

### 7.5 CSRF

Cookie-authenticated unsafe methods MUST have CSRF protection unless SameSite and deployment policy explicitly prove the endpoint is not CSRF-reachable.

The LLM MUST NOT assume `SameSite=Lax` alone is sufficient for all flows.

---

## 8. OAuth 2.0 and OIDC

### 8.1 Use correct flow

For browser or native app login through OIDC, use Authorization Code with PKCE unless the architecture explicitly states otherwise.

The LLM MUST NOT implement or recommend:

- implicit flow for new systems,
- resource owner password credentials flow for human login,
- token exchange through query strings,
- accepting ID token as API authorization without explicit architecture decision.

### 8.2 State and nonce

OIDC/OAuth clients MUST generate and validate:

- `state` to protect authorization response correlation and CSRF,
- `nonce` for ID token replay protection when required by flow,
- PKCE verifier/challenge for authorization code protection.

State and nonce MUST be cryptographically random, bound to the initiating browser/session, single-use, and short-lived.

### 8.3 Redirect URI validation

Redirect URI MUST be exact-match configured. The LLM MUST NOT use substring, prefix, wildcard, or open redirect logic for callback URLs unless the IdP standard and project policy explicitly require a constrained pattern.

Forbidden:

```go
// FORBIDDEN: vulnerable redirect validation.
if strings.HasPrefix(callback, allowedBase) { ... }
```

### 8.4 Token endpoint and TLS

OAuth/OIDC token exchange MUST use HTTPS with normal certificate verification. The LLM MUST NOT set `InsecureSkipVerify: true` for real authentication traffic.

### 8.5 ID token validation

OIDC ID token validation MUST include:

- signature validation using trusted issuer metadata/JWKS,
- issuer validation,
- audience/client ID validation,
- expiry validation,
- not-before/issued-at policy when applicable,
- nonce validation when nonce was used,
- algorithm allowlist,
- key rotation handling.

The LLM MUST NOT decode JWT payload and treat it as authenticated.

Forbidden:

```go
// FORBIDDEN: decoding is not verification.
parts := strings.Split(token, ".")
payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
```

### 8.6 Access token validation

Resource servers validating bearer tokens MUST validate according to token type and deployment contract:

- opaque tokens: introspect with authorization server or gateway-approved validator;
- JWT access tokens: verify signature, issuer, audience, expiry, scope/claim semantics, algorithm, and key ID;
- proof-of-possession tokens: validate binding material;
- gateway-validated tokens: validate trusted boundary and signed/internal identity contract.

Access token validation MUST NOT be replaced with ID token validation unless architecture explicitly says so.

### 8.7 Refresh tokens

Refresh tokens MUST be stored only where project policy permits. They MUST be protected as high-value secrets.

Rules:

- never log refresh tokens,
- encrypt or protect at rest when stored server-side,
- rotate refresh tokens when provider supports it,
- revoke on logout/password reset/account compromise,
- limit by client/session/device,
- do not expose refresh token to JavaScript in browser apps.

---

## 9. JWT rules

JWTs are not inherently safe. They are safe only if validation is complete.

### 9.1 Mandatory JWT validation

Any accepted JWT MUST validate:

- structure,
- signature,
- `alg` allowlist,
- key lookup by trusted `kid`,
- issuer `iss`,
- audience `aud`,
- expiration `exp`,
- not-before `nbf` when present,
- issued-at `iat` according to policy,
- subject `sub`,
- token use/type claim if issuer provides one,
- tenant/client constraints when applicable.

The LLM MUST NOT accept `alg=none` or derive accepted algorithm from attacker-controlled header without allowlist.

### 9.2 Claim semantics

Claims MUST be mapped into internal actor fields through explicit code. The LLM MUST NOT pass raw claim maps across application layers.

Forbidden:

```go
// FORBIDDEN: untyped claims spread across service code.
ctx = context.WithValue(ctx, "claims", claims)
```

Required:

```go
actor := authn.Actor{
    Subject:  claims.Subject,
    Issuer:   claims.Issuer,
    TenantID: tenantFromClaims(claims),
    Scopes:   normalizeScopes(claims),
}
```

### 9.3 Time skew

Clock skew allowance MUST be small, explicit, and tested. Large skew allowances weaken expiry semantics.

### 9.4 Token storage

Bearer tokens MUST be treated as secrets. Do not place access tokens in URLs, logs, traces, metrics labels, panic messages, or error bodies.

---

## 10. API keys

API keys are bearer credentials. They MUST be treated as secrets.

Rules:

- API keys MUST be generated using `crypto/rand`.
- Store only a hash of the API key where feasible.
- Show full API key only once at creation.
- Support key ID/prefix for lookup without exposing full secret.
- Associate key with owner, tenant, scopes, status, creation time, last-used time, expiry, and rotation metadata.
- Compare secrets using constant-time comparison where applicable.
- Rate-limit and audit API key usage.
- Do not use API keys as replacement for user authentication.

Example key storage model:

```go
type APIKeyRecord struct {
    ID         string
    Prefix     string
    SecretHash []byte
    TenantID   string
    OwnerID    string
    Scopes     []string
    Status     string
    ExpiresAt  time.Time
    CreatedAt  time.Time
    LastUsedAt time.Time
}
```

---

## 11. Service-to-service authentication

Service-to-service authentication MUST be explicit.

Allowed patterns:

- mTLS with certificate identity and trusted CA,
- OAuth 2.0 client credentials flow,
- signed internal tokens with strict issuer/audience/lifetime,
- service mesh identity propagated to application layer through trusted policy,
- signed webhook-style messages for asynchronous inbound calls.

Rules:

- internal network location alone MUST NOT be treated as authentication;
- service identity MUST be distinct from human identity;
- scheduled jobs MUST use system actors with bounded permissions;
- cross-service calls MUST propagate correlation ID but MUST NOT blindly propagate end-user privileges without a delegation model.

---

## 12. mTLS and certificate authentication

When using mTLS:

- client certificate verification MUST be enabled;
- trusted CA roots MUST be explicit;
- subject/SAN mapping to service identity MUST be deterministic;
- certificate expiry and rotation MUST be planned;
- certificate identity MUST still pass authorization;
- logs MUST not dump full certificate content unless explicitly safe and redacted.

Forbidden:

```go
// FORBIDDEN in production.
tls.Config{InsecureSkipVerify: true}
```

---

## 13. Webhook authentication

Inbound webhooks MUST authenticate the sender.

Required controls:

- signature verification using documented algorithm,
- constant-time signature comparison,
- timestamp validation,
- replay window,
- body bytes must be verified exactly as received,
- key rotation support,
- event ID idempotency,
- source allowlisting only as defense-in-depth, not primary auth.

Forbidden:

```go
// FORBIDDEN: source IP alone is not enough.
if allowedIP(r.RemoteAddr) { acceptWebhook() }
```

---

## 14. MFA and step-up authentication

MFA state MUST be explicit in actor/session metadata.

Rules:

- high-risk operations SHOULD require step-up authentication;
- MFA completion MUST rotate session or update session assurance atomically;
- recovery codes MUST be hashed and one-time use;
- MFA bypass MUST require explicit break-glass policy and audit;
- do not log OTPs, recovery codes, device secrets, or enrollment QR secrets.

For regulatory workflows, step-up SHOULD be considered for approval, enforcement action, financial impact, destructive action, privilege administration, and sensitive export.

---

## 15. Logout, revocation, and account lifecycle

Logout MUST invalidate server-side session state where possible.

Credential revocation MUST be handled for:

- password change,
- account disablement,
- tenant deactivation,
- role/permission revocation when session claims are stale,
- suspected compromise,
- refresh token revocation,
- API key revocation,
- certificate revocation/rotation when applicable.

Long-lived tokens MUST have a strategy for revocation or short enough lifetime to satisfy risk requirements.

---

## 16. Authentication middleware design

Authentication middleware MUST:

- parse credentials from exactly defined locations;
- reject malformed credentials;
- validate credential completely;
- create internal actor;
- attach actor to context;
- record sanitized audit/telemetry;
- call next handler only when authentication is valid or anonymous access is explicitly allowed.

Example shape:

```go
type Authenticator interface {
    Authenticate(ctx context.Context, r *http.Request) (authn.Actor, error)
}

func Middleware(a Authenticator, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        actor, err := a.Authenticate(r.Context(), r)
        if err != nil {
            http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
            return
        }
        next.ServeHTTP(w, r.WithContext(authn.ContextWithActor(r.Context(), actor)))
    })
}
```

Do not make middleware silently create privileged system actors.

---

## 17. Anonymous and optional authentication

Endpoints that allow anonymous access MUST be explicit.

Rules:

- no implicit fallback to admin/system user;
- anonymous actor MUST have kind `anonymous` or no actor;
- optional authentication MUST not mask invalid credentials;
- if a credential is present but invalid, fail as unauthorized instead of treating request as anonymous.

---

## 18. Error mapping

Authentication error taxonomy SHOULD separate internal cause from public response.

```go
type Reason string

const (
    ReasonMissingCredential Reason = "missing_credential"
    ReasonMalformedToken    Reason = "malformed_token"
    ReasonInvalidSignature  Reason = "invalid_signature"
    ReasonExpiredCredential Reason = "expired_credential"
    ReasonInvalidAudience   Reason = "invalid_audience"
    ReasonInvalidIssuer     Reason = "invalid_issuer"
    ReasonRevokedCredential Reason = "revoked_credential"
)

type Error struct {
    Reason Reason
    Err    error
}

func (e *Error) Error() string { return "authentication failed" }
func (e *Error) Unwrap() error { return e.Err }
```

Public response MUST remain generic.

---

## 19. Logging and audit

Authentication logs MUST include safe metadata only:

Allowed:

- event name,
- actor subject after successful authentication,
- credential type,
- issuer,
- client ID,
- tenant ID,
- result category,
- reason code,
- remote address after proxy normalization,
- user agent if required and redacted policy permits,
- correlation/request ID.

Forbidden:

- password,
- OTP,
- session ID,
- access token,
- refresh token,
- API key,
- full JWT,
- authorization code,
- PKCE verifier,
- private key,
- raw certificate private material.

Audit events SHOULD be immutable and structured:

```go
logger.InfoContext(ctx, "authn.login.failed",
    slog.String("reason", string(reason)),
    slog.String("credential_type", "password"),
    slog.String("request_id", requestID),
)
```

---

## 20. Testing requirements

Authentication code MUST include negative tests.

Required test cases:

- missing credential,
- malformed credential,
- expired credential,
- future/not-yet-valid credential,
- wrong issuer,
- wrong audience,
- wrong algorithm,
- unknown key ID,
- invalid signature,
- replayed state/nonce,
- reused authorization code or verifier when modelled,
- revoked session/token/key,
- disabled user,
- cross-tenant token,
- anonymous endpoint with invalid credential,
- public error body does not leak sensitive detail,
- logs do not contain token/secret values.

Time-dependent tests MUST use injectable clock or controlled time source.

---

## 21. Fuzzing requirements

The LLM MUST add fuzz tests or malformed-input tests for parsers that handle:

- authorization headers,
- cookies,
- JWT strings,
- PEM/certificates,
- webhook signatures,
- API key formats,
- callback query parameters,
- session payloads.

Fuzz tests MUST assert no panic and fail-closed behavior.

---

## 22. Configuration rules

Authentication configuration MUST be explicit, validated at startup, and safe by default.

Required config validation:

- issuer URL present and HTTPS in production,
- audience/client ID present,
- JWKS URL or discovery URL present,
- allowed algorithms configured,
- token TTL/session TTL configured,
- cookie secure setting cannot be false in production,
- callback URLs exact-match configured,
- secret values loaded from secret manager/environment, not source code,
- test fixtures separated from production config.

The LLM MUST NOT add default test secrets to production config.

---

## 23. Dependency rules

Authentication dependencies MUST be justified.

Rules:

- prefer well-maintained libraries with clear security posture;
- pin versions through Go modules;
- run `go test ./...`, `go vet ./...`, and `govulncheck ./...` after dependency changes;
- do not add JWT/OIDC/session libraries casually if existing project framework already provides a standard;
- do not use abandoned packages for credential validation.

---

## 24. Regulatory workflow considerations

For enforcement lifecycle and complex case-management systems, authentication MUST preserve defensibility:

- actor identity must be stable across audit logs;
- delegated actions must distinguish original user, delegated user, and system actor;
- batch jobs must be traceable to scheduler/service identity;
- administrative impersonation must be explicit, time-bound, and audited;
- break-glass access must be separately marked and reviewed;
- step-up authentication should be used for high-impact transitions;
- session expiry must not silently convert user action into system action.

---

## 25. Forbidden shortcuts

The LLM MUST NOT:

- decode JWT without verifying signature and claims;
- trust `X-User-ID` from public requests;
- store raw tokens in context;
- store passwords or API keys in logs;
- use `math/rand` for secrets;
- use timestamp/user ID as session secret;
- accept tokens without expiry;
- skip audience or issuer validation;
- accept any signing algorithm dynamically;
- use `InsecureSkipVerify` in production auth paths;
- place access token in URL query parameter;
- make authentication middleware return admin/system actor on failure;
- use authentication success as authorization success;
- implement password hashing with SHA/MD5/general hash;
- leave authentication endpoints without rate limiting.

---

## 26. Required PR checklist

Before completing Go authentication work, the LLM MUST verify:

- [ ] Identity source and credential type are explicit.
- [ ] Authentication and authorization are separate.
- [ ] All credentials are validated completely.
- [ ] Tokens validate issuer, audience, expiry, algorithm, and signature.
- [ ] Sessions use secure random IDs and secure cookie settings.
- [ ] No raw secret/token/password is logged, traced, returned, or stored in context.
- [ ] Auth failures fail closed with generic public errors.
- [ ] Callback/state/nonce/PKCE handling is tested when OAuth/OIDC is used.
- [ ] MFA/step-up requirements are represented when high-risk actions exist.
- [ ] Revocation/session invalidation behavior is defined.
- [ ] Multi-tenant actor fields cannot be forged by request parameters.
- [ ] Negative tests cover malformed, expired, wrong issuer/audience, and revoked credentials.
- [ ] `go test ./...`, `go vet ./...`, and `govulncheck ./...` are expected gates.
