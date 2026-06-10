# Strict Coding Standards — Java Authentication

> **Purpose**: Mandatory rules for LLM/code-agent implementation of authentication in Java applications.
>
> Authentication answers: **"Who or what is this caller, and how was that identity proven?"**
>
> This document is an overlay for Java, Spring, Spring Boot, JAX-RS/Jersey, Quarkus, HTTP, JWT, OAuth/OIDC, logging, telemetry, validation, and security standards.

---

## 1. Scope

This standard applies to Java code that implements, configures, integrates with, or validates:

- username/password login
- session authentication
- OAuth 2.0 / OpenID Connect login
- JWT validation
- API token authentication
- mTLS / service identity
- machine-to-machine authentication
- MFA / step-up authentication
- password reset / account recovery
- logout / token revocation
- authentication events, audit, and telemetry

This standard does **not** define authorization decisions. Authorization belongs in `strict-coding-standards__java_authorization.md`.

---

## 2. Core Authentication Invariant

Every authenticated request must have a verifiable authentication context with:

1. **Subject identity**: user, client, service, device, or workload.
2. **Authentication mechanism**: password, session, OIDC, mTLS, API key, signed token, etc.
3. **Issuer / authority**: who asserted the identity.
4. **Assurance level**: how strongly identity was proven.
5. **Freshness**: when authentication happened or when credential was last verified.
6. **Expiry / revocation behavior**: when the authentication context must stop being accepted.
7. **Tenant / realm / audience boundary** if applicable.

If any of these are unclear, the implementation must fail closed.

---

## 3. Version and Framework Policy

### 3.1 Java baseline

Authentication code must follow the active project Java baseline:

- Java 11, 17, 21, or 25 as defined by the project.
- Do not introduce APIs above the project baseline.
- Do not use preview/incubator APIs for authentication infrastructure unless explicitly approved.

### 3.2 Spring Security

For Spring projects:

- Use Spring Security as the default authentication framework.
- Do not build custom servlet filters that bypass Spring Security unless the architecture explicitly requires it.
- Do not rely on deprecated `WebSecurityConfigurerAdapter` style in new code.
- Prefer explicit `SecurityFilterChain` bean configuration.
- Keep authentication provider, user lookup, password encoder, token decoder, and exception handling explicit.

### 3.3 Jakarta / JAX-RS / Quarkus

For Jakarta REST / Quarkus projects:

- Use framework-supported security mechanisms before custom filters.
- Do not mix `javax.*` and `jakarta.*` security APIs in the same module.
- Security annotations must be backed by a real runtime enforcement mechanism.
- Do not add annotations that look secure but are ignored by the runtime.

---

## 4. Mandatory Rules

### AUTH-MUST-001 — Authentication must be centralized

Authentication decision logic must be implemented in a central security layer, not copied into controllers/resources.

Allowed:

- Spring Security filter chain
- JAX-RS/Jakarta REST authentication filter/provider
- Quarkus security identity provider
- API gateway authentication plus verified downstream identity propagation

Forbidden:

```java
@GetMapping("/profile")
public Profile get(HttpServletRequest request) {
    String user = request.getHeader("X-User"); // forbidden unless verified by trusted boundary
    return profileService.get(user);
}
```

---

### AUTH-MUST-002 — Authentication is not authorization

Authenticated identity must not imply permission.

Forbidden:

```java
if (principal != null) {
    approveCase(caseId); // missing authorization
}
```

Required mental model:

```text
Authentication: caller identity is known.
Authorization: caller may perform this action on this resource in this context.
```

---

### AUTH-MUST-003 — Trust boundary must be explicit

Any inbound identity from headers, cookies, certificates, tokens, service mesh, gateway, or proxy must declare:

- who sets it
- how it is protected from client spoofing
- whether the app verifies it locally
- how failure behaves
- whether it is valid only on internal network paths

Headers such as `X-User`, `X-Email`, `X-Groups`, `X-Forwarded-*`, `X-Client-Cert`, or `Authorization` are untrusted unless verified.

---

### AUTH-MUST-004 — Fail closed

Authentication failure must result in rejection, not anonymous downgrade unless the endpoint is explicitly public.

Required:

- invalid token -> reject
- expired token -> reject
- unknown issuer -> reject
- missing required claim -> reject
- signature verification failure -> reject
- ambiguous authentication source -> reject
- duplicate/conflicting credentials -> reject

---

### AUTH-MUST-005 — Authentication code must be observable but not leaky

Every authentication failure should be measurable and diagnosable without leaking secrets.

Log allowed:

- event type
- result: success/failure
- mechanism
- issuer/realm/client id where safe
- subject id only when allowed by audit policy
- correlation id
- remote IP / user agent only if policy allows
- reason category, not raw secret/token

Log forbidden:

- password
- OTP
- full token
- authorization code
- refresh token
- session id
- API key
- client secret
- private key
- password reset token

---

## 5. Password Authentication Rules

### AUTH-PWD-001 — Password storage must use password hashing

Passwords must never be stored using:

- plaintext
- reversible encryption
- fast hash only (`SHA-256(password)`, `MD5(password)`, etc.)
- unsalted hash
- home-grown KDF

Allowed password storage:

- Argon2id when available and approved
- bcrypt
- scrypt
- PBKDF2 where required by platform/policy

Every password hash must encode algorithm/version/parameters/salt so future migration is possible.

---

### AUTH-PWD-002 — Password verification must be constant-time where applicable

Do not compare secret-derived values with `String.equals` or early-exit loops.

Use framework password encoders or constant-time comparison utilities for token/password verifier comparison.

---

### AUTH-PWD-003 — Password policy must not be invented locally

Password rules must come from the security policy.

Prefer:

- minimum length
- block common/compromised passwords where feasible
- no arbitrary composition rules unless mandated
- no forced periodic rotation unless risk/event-based policy requires it
- MFA for higher-risk accounts/actions

---

### AUTH-PWD-004 — Login failure must resist enumeration and brute force

Required:

- generic external error message
- rate limiting / throttling / lockout policy
- monitoring for credential stuffing
- consistent response timing where feasible
- audit event for abnormal failure rate

Forbidden:

```text
"Email exists but password is wrong"
"Account does not exist"
"MFA disabled for this account"
```

Preferred external message:

```text
Invalid username or password.
```

Internal logs may include controlled reason codes.

---

## 6. Session Authentication Rules

### AUTH-SESSION-001 — Session IDs are secrets

Session IDs must be treated as bearer secrets.

Required:

- generated by framework/cryptographically secure generator
- high entropy
- transmitted only over TLS
- stored in secure cookie or approved token store
- rotated on login and privilege change
- invalidated on logout
- expired on idle and absolute timeout

Forbidden:

- session id in URL
- logging session id
- client-provided session id acceptance
- predictable session id

---

### AUTH-SESSION-002 — Cookie settings must be explicit

Authentication cookies must explicitly define:

- `Secure`
- `HttpOnly`
- `SameSite` policy
- path/domain scope
- max age/session lifetime
- name prefix if applicable

Do not rely on defaults without review.

---

### AUTH-SESSION-003 — Session fixation defense is mandatory

After successful authentication:

- rotate session id
- clear pre-authentication temporary state unless needed
- bind login result to a new authenticated session

---

### AUTH-SESSION-004 — Logout must invalidate server-side state

Logout must clear:

- local session
- remember-me token if used
- CSRF/session-bound state where applicable
- refresh token or server-side token record when used

For federated login, local logout and identity-provider logout must be treated as separate operations.

---

## 7. OAuth 2.0 / OIDC Authentication Rules

### AUTH-OIDC-001 — Use OIDC for login, not raw OAuth access tokens

OAuth 2.0 is authorization delegation. OpenID Connect adds identity assertions via ID Token.

For login/authentication:

- use OIDC authorization code flow
- validate ID Token
- bind auth response to session using `state` and `nonce`
- validate issuer, audience, expiry, issued-at, nonce, signature, and algorithm

Forbidden:

- treating an OAuth access token as proof of user login without identity validation
- using implicit flow for new browser applications
- using resource owner password credentials grant for new applications

---

### AUTH-OIDC-002 — Authorization Code + PKCE is the default

For public clients and browser/mobile flows, PKCE must be used.

Required:

- authorization code flow
- PKCE S256
- exact redirect URI matching
- `state` for CSRF binding
- `nonce` for ID Token replay mitigation
- TLS everywhere

---

### AUTH-OIDC-003 — ID Token validation must be complete

A valid ID Token requires at minimum:

- trusted issuer
- correct audience
- accepted algorithm
- valid signature using issuer key set
- non-expired token
- acceptable clock skew
- nonce match if nonce was sent
- subject present
- token type/purpose appropriate for authentication

Forbidden:

```java
String sub = jwt.getClaim("sub"); // forbidden if signature/issuer/audience not validated
```

---

### AUTH-OIDC-004 — Do not trust unsigned or weakly signed JWTs

Forbidden:

- `alg=none`
- accepting algorithm from token without allow-list
- accepting symmetric algorithm where asymmetric is expected
- accepting public key from token header without trust policy
- skipping signature validation in non-test code
- using ID token as API access token

---

### AUTH-OIDC-005 — Token exchange and identity propagation must be designed

When propagating identity between services, specify:

- whether original user identity or service identity is propagated
- whether token is forwarded, exchanged, or re-minted
- token audience for each downstream service
- whether downstream may trust upstream-authenticated identity
- replay/revocation behavior

Forwarding user tokens to arbitrary downstream services is forbidden by default.

---

## 8. JWT / Bearer Token Rules

### AUTH-JWT-001 — Bearer tokens are secrets

Bearer tokens grant access to whoever holds them.

Required:

- TLS
- short expiration
- audience-specific token
- issuer validation
- signature validation
- no logging
- no storage in insecure client-side locations

---

### AUTH-JWT-002 — Claims must be validated by contract

Do not interpret arbitrary claims without contract.

Required validation:

- `iss`
- `sub`
- `aud`
- `exp`
- `iat` / `nbf` where used
- token type/purpose if present
- tenant/realm where applicable
- scopes/roles only after issuer trust is established

---

### AUTH-JWT-003 — Do not use JWT when server-side revocation is mandatory

JWT is appropriate for stateless validation only when revocation/rotation semantics are acceptable.

If immediate revocation is required, use:

- opaque tokens with introspection
- short-lived access token + refresh token rotation
- server-side session
- token revocation list / denylist where justified

---

## 9. API Key and Machine Authentication Rules

### AUTH-APIKEY-001 — API keys are credentials, not identities by themselves

Every API key must map to:

- owner
- client/application
- scopes/allowed operations
- environment
- creation time
- expiration/rotation policy
- last used time
- revocation status

Forbidden:

- permanent shared API key
- API key embedded in frontend/mobile app as sole security boundary
- API key used as authorization substitute without policy

---

### AUTH-APIKEY-002 — API key verification must hash stored keys

Store only a verifier/hash of API keys.

Required:

- generate high-entropy keys
- show full key only once
- store prefix/key id for lookup
- store hashed secret part
- constant-time comparison
- rate limit failed attempts

---

### AUTH-M2M-001 — Service authentication must identify workload/client

Machine-to-machine authentication must prove service identity using one of:

- OAuth 2.0 client credentials with scoped/audience-bound token
- mTLS certificate identity
- cloud workload identity / IAM role
- signed request protocol approved by security architecture

Forbidden:

- hardcoded shared password across services
- long-lived static token without rotation
- trusting network location alone

---

## 10. MFA and Step-Up Rules

### AUTH-MFA-001 — MFA is mandatory for high-risk flows

High-risk flows include:

- admin login
- privilege escalation
- payment/financial action
- changing email/password/MFA settings
- generating API keys
- exporting sensitive data
- disabling audit/security control

MFA policy must define:

- eligible authenticators
- recovery flow
- remembered device policy
- step-up freshness window
- failure/lockout behavior

---

### AUTH-MFA-002 — OTP and recovery codes are secrets

Forbidden:

- logging OTP
- storing recovery codes plaintext
- unlimited retry
- accepting reused OTP when protocol forbids it
- weak SMS-only MFA for high-risk admin if stronger factors are available

---

## 11. Account Recovery Rules

### AUTH-RECOVERY-001 — Password reset token must be single-use and short-lived

Required:

- high entropy random token
- stored hashed server-side
- single use
- short expiry
- rate-limited request
- generic response message
- invalidate existing reset tokens after success
- notify account owner after reset

Forbidden:

- token derived from email/user id/time
- token in logs
- token reusable after password changed

---

### AUTH-RECOVERY-002 — Recovery must not bypass MFA silently

If MFA exists, account recovery must define:

- how MFA reset is approved
- whether stronger verification is needed
- notification and audit
- cooldown / risk review

---

## 12. Java Implementation Rules

### AUTH-JAVA-001 — Do not implement crypto primitives

Use framework/JCA/JCE/libraries for:

- password hashing
- random token generation
- JWT signature validation
- key management
- TLS
- certificate validation

---

### AUTH-JAVA-002 — Use `SecureRandom` for generated secrets

Use `SecureRandom` or framework equivalent for:

- reset token
- session secret
- API key
- nonce
- state
- CSRF token

Forbidden:

- `Random`
- timestamp-only token
- UUID as sole high-security secret unless explicitly approved

---

### AUTH-JAVA-003 — Authentication context must be immutable per request

After authentication succeeds, the request authentication context should be immutable.

Forbidden:

- mutable global `currentUser`
- static thread-unsafe principal holder
- changing principal mid-request without explicit re-authentication

Thread-local security context must be cleared after request/task completion.

---

### AUTH-JAVA-004 — Async/reactive context propagation must be explicit

For async/reactive/virtual-thread code:

- do not assume thread-local security context propagates automatically
- use framework-approved context propagation
- test authentication context across async boundaries
- clear context on completion

---

## 13. Spring Security Guardrails

### AUTH-SPRING-001 — Use explicit authentication mechanisms

Configuration must make clear which mechanisms are enabled:

- form login
- HTTP Basic
- OAuth2 login
- resource server JWT
- opaque token introspection
- session management
- remember-me
- mTLS

Do not leave accidental default login mechanism enabled in APIs.

---

### AUTH-SPRING-002 — API services should be stateless unless sessions are intentional

For REST APIs/resource servers:

- prefer stateless token validation
- disable CSRF only when no browser-cookie authentication exists
- do not create sessions accidentally
- return consistent `401` for unauthenticated API access

---

### AUTH-SPRING-003 — Password encoder must be explicit

Use `PasswordEncoder` with algorithm migration support.

Forbidden:

```java
NoOpPasswordEncoder.getInstance();
```

Allowed only in test fixtures with clear test scope.

---

### AUTH-SPRING-004 — Test security configuration

Every protected endpoint category must have tests for:

- unauthenticated request
- malformed credentials
- expired credentials
- insufficient/missing authentication mechanism
- successful authentication
- security context correctness

---

## 14. Error Response Rules

### AUTH-ERROR-001 — Use correct HTTP status codes

Typical API behavior:

- `401 Unauthorized`: authentication missing/invalid/expired
- `403 Forbidden`: authenticated but not authorized
- `400 Bad Request`: malformed auth request where applicable
- `429 Too Many Requests`: throttling/rate limit

Do not return `200` with error payload for authentication failure.

---

### AUTH-ERROR-002 — External error must be generic

External responses must not reveal:

- account existence
- password validity
- MFA enrollment
- token validation internals
- exact lockout threshold
- whether email/phone is registered

Internal audit can use controlled reason codes.

---

## 15. Testing Requirements

Authentication code must include tests for:

- happy path
- missing credentials
- malformed credentials
- wrong issuer/audience
- expired token/session
- future `nbf` token
- invalid JWT signature
- algorithm confusion attempt
- missing nonce/state
- replay attempt where applicable
- password hash upgrade path
- account lockout/rate limit
- reset token single-use
- logout invalidation
- async/reactive context propagation

Security tests must be deterministic and not depend on wall-clock time directly; inject `Clock` where possible.

---

## 16. Forbidden Patterns

Forbidden by default:

- custom password hashing
- storing plaintext/reversible passwords
- accepting unsigned JWT
- disabling token signature validation
- using OAuth access token as login proof without OIDC validation
- trusting client-supplied identity headers
- logging secrets/tokens/session ids
- session id in URL
- authentication decision in controller/resource methods
- permanent API keys without owner/expiry/revocation
- password reset token stored plaintext
- treating authentication as authorization
- disabling TLS certificate/hostname validation
- using `NoOpPasswordEncoder` outside tests
- implicit flow for new browser login
- resource owner password credentials grant for new apps

---

## 17. LLM Implementation Protocol

Before implementing authentication, the agent must answer:

```text
1. What identity type is authenticated? user, service, device, workload, external client?
2. What mechanism proves identity? session, OIDC, JWT, API key, mTLS, password, etc.?
3. Who is the trusted issuer/authority?
4. What claims/session fields are required?
5. What is token/session lifetime and revocation behavior?
6. What are unauthenticated vs invalid vs expired error responses?
7. How are secrets stored, rotated, and redacted?
8. How is this tested, including failure/replay cases?
```

If the agent cannot answer, it must not invent authentication logic.

---

## 18. Reviewer Checklist

- [ ] Authentication and authorization are separated.
- [ ] Trust boundary is explicit.
- [ ] Authentication is centralized in framework/security layer.
- [ ] Token/session validation fails closed.
- [ ] Password storage uses approved password hashing.
- [ ] Secret/token/session identifiers are never logged.
- [ ] JWT/OIDC validation includes issuer, audience, expiry, signature, algorithm, nonce/state where applicable.
- [ ] API keys are generated securely and stored hashed.
- [ ] MFA/step-up exists for high-risk flows.
- [ ] Password reset is single-use, short-lived, rate-limited, and audited.
- [ ] Async/reactive security context propagation is tested.
- [ ] HTTP status codes distinguish `401` and `403` correctly.
- [ ] Tests cover negative and replay cases.

---

## 19. References

- OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Multifactor Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- NIST SP 800-63B Digital Identity Guidelines — https://pages.nist.gov/800-63-4/sp800-63b.html
- OpenID Connect Core 1.0 — https://openid.net/specs/openid-connect-core-1_0.html
- RFC 9700 OAuth 2.0 Security Best Current Practice — https://datatracker.ietf.org/doc/rfc9700/
- RFC 8725 JSON Web Token Best Current Practices — https://www.rfc-editor.org/rfc/rfc8725
- Spring Security Reference — https://docs.spring.io/spring-security/reference/index.html
