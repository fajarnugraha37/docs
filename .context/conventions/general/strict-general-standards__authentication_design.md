# Strict General Standards: Authentication Design

> **Status:** Mandatory  
> **Audience:** LLM code agents, software engineers, reviewers, architects  
> **Scope:** User authentication, machine authentication, sessions, tokens, federation, recovery, step-up authentication, auditability

---

## 1. Purpose

Authentication design defines **how a system proves that an actor is who or what it claims to be**.

An LLM or developer implementing authentication MUST NOT treat authentication as a login form, a JWT helper, or a framework annotation problem. Authentication is a security protocol and lifecycle problem involving identity proof, credential binding, session continuity, token validation, recovery, revocation, monitoring, and failure handling.

This standard exists to prevent:

- weak password handling;
- unsafe token/session design;
- accidental use of OAuth as authentication without OpenID Connect semantics;
- account recovery bypasses;
- user enumeration;
- missing MFA/step-up for high-risk actions;
- unsafe JWT validation;
- insecure service-to-service authentication;
- authentication state that cannot be audited, revoked, or reasoned about.

---

## 2. Authentication vs Authorization

Authentication answers:

> **Who is this actor?**

Authorization answers:

> **What is this actor allowed to do?**

Mandatory separation:

- Authentication MUST establish a subject identity.
- Authorization MUST decide whether the authenticated subject may perform an action on a resource.
- Authentication success MUST NOT imply authorization success.
- A valid session/token MUST NOT be treated as proof of permission.
- Role, scope, group, tenant, or entitlement claims from authentication MUST still be evaluated by the authorization layer.

Bad:

```text
JWT valid -> allow delete case
```

Good:

```text
JWT valid -> subject resolved -> tenant resolved -> permission checked -> resource state checked -> action allowed/denied
```

---

## 3. Mandatory Design Principle

Authentication MUST be designed as a lifecycle:

```text
identity source
  -> credential enrollment
  -> authentication ceremony
  -> session/token issuance
  -> request authentication
  -> re-authentication / step-up
  -> credential rotation
  -> recovery
  -> revocation
  -> audit
  -> deprovisioning
```

An implementation is incomplete if it only covers login and token creation.

---

## 4. Non-Negotiable Rules

### 4.1 Do not invent custom authentication protocols

LLMs MUST NOT design custom authentication protocols unless explicitly required and reviewed by security specialists.

Allowed baselines:

- OpenID Connect for user authentication federation.
- OAuth 2.0 only for authorization delegation, not standalone user authentication.
- WebAuthn/passkeys for phishing-resistant user authentication where feasible.
- mTLS, workload identity, signed service tokens, or OAuth client credentials for machine/service authentication.
- Framework-native session management only if configured securely.

Forbidden:

- custom encrypted tokens;
- home-grown SSO;
- password-equivalent API keys for users;
- long-lived bearer tokens without rotation/revocation;
- static shared secrets between many services;
- “security through hidden endpoint names.”

---

### 4.2 Authentication must use protected channels

Every authentication flow MUST use TLS.

Mandatory:

- HTTPS only in all environments except isolated local development.
- HSTS for production web apps.
- Secure cookies.
- No credential submission over plaintext HTTP.
- No token leakage in URLs, query strings, referer headers, logs, browser history, or analytics.

Forbidden:

```http
GET /login?username=a@example.com&password=secret
GET /callback?access_token=...
```

---

### 4.3 Fail closed

If identity cannot be established with confidence, the request MUST be rejected.

Mandatory rejection cases:

- missing credential;
- malformed token;
- expired token;
- wrong issuer;
- wrong audience;
- unsupported signing algorithm;
- unknown key without valid refresh path;
- disabled subject;
- revoked session;
- tenant mismatch;
- clock skew outside allowed tolerance;
- failed MFA requirement;
- untrusted upstream identity header.

---

## 5. Identity Model

Every authenticated actor MUST resolve to a canonical subject.

Required subject fields:

```text
subject_id        stable internal identifier
subject_type      user | service | device | job | integration | support_actor
issuer            local | identity_provider | workload_identity_provider
tenant_id         when multi-tenant
status            active | locked | disabled | pending | deleted
assurance_level   contextual confidence level
created_at
updated_at
```

Rules:

- Email address MUST NOT be the primary subject key.
- Username MUST NOT be the primary subject key.
- External IdP subject MUST be mapped to an internal stable subject record.
- Subject identifiers MUST be immutable.
- Deleted/recreated accounts MUST NOT inherit old permissions unintentionally.
- Service accounts MUST be distinguishable from human users.

---

## 6. Authentication Assurance

The system MUST classify flows by risk.

Recommended practical levels:

| Level    | Example                                                          | Minimum expectation                                                               |
| -------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Low      | public low-risk user account                                     | password/passkey/session with rate limits                                         |
| Medium   | internal staff, case worker, financial/account data              | MFA or federated IdP with MFA enforcement                                         |
| High     | admin, audit export, privileged configuration, impersonation     | phishing-resistant MFA or step-up authentication                                  |
| Critical | key management, production break-glass, legal/regulatory actions | hardware-backed or strongly protected MFA, explicit audit, approval when required |

Rules:

- Privileged actions MUST require stronger assurance than ordinary page access.
- Login freshness MUST be checked for sensitive operations.
- “User has a session” is not enough for high-risk actions.
- Assurance level MUST be visible to authorization and audit layers.

---

## 7. Password Authentication

Password authentication is allowed only when justified by product constraints or legacy compatibility. Passkeys/WebAuthn or federated IdP SHOULD be preferred for new high-risk systems.

### 7.1 Password policy

Mandatory:

- Minimum length MUST follow current policy baseline:
  - 15+ characters when password is the only factor.
  - 8+ characters may be allowed when password is only one factor in MFA.
- Maximum length MUST support at least 64 characters.
- Unicode MAY be accepted but MUST be normalized consistently before hashing if accepted.
- Spaces MUST be allowed.
- Composition rules MUST NOT be required.
- Periodic forced password rotation MUST NOT be required unless compromise is suspected.
- Password hints and knowledge-based security questions MUST NOT be used.
- Passwords MUST be checked against common, weak, predictable, and breached password lists during creation/reset.

Bad:

```text
Password must contain uppercase, lowercase, number, symbol, and change every 30 days.
```

Good:

```text
Password must be long, not breached, not common, and protected by MFA for high-risk access.
```

---

### 7.2 Password storage

Passwords MUST never be stored in plaintext, encrypted for later decryption, logged, transmitted to analytics, or returned by an API.

Preferred storage:

```text
Argon2id(password, unique_salt, memory_cost, iterations, parallelism)
```

Allowed alternatives when Argon2id is unavailable:

- bcrypt with appropriate cost and 72-byte handling awareness;
- scrypt;
- PBKDF2 with high iteration count where required by platform/compliance.

Mandatory:

- Unique random salt per password.
- Hash parameters versioned and stored with the hash.
- Rehash on login when parameters are outdated.
- Optional pepper stored outside the database, e.g. secret manager/HSM/KMS.
- Constant-time comparison for password verifier output.
- Password reset MUST invalidate active sessions unless explicitly risk-assessed.

Forbidden:

```text
MD5(password)
SHA256(password)
AES_encrypt(password)
base64(password)
```

---

### 7.3 Login failure handling

Mandatory:

- Rate limit by account, IP, device fingerprint where legally/ethically acceptable, and network segment.
- Detect credential stuffing.
- Use generic error messages.
- Do not reveal whether username/email exists.
- Log failed authentication events without logging secrets.
- Add progressive friction for suspicious activity.
- Lockout policies MUST not allow trivial account denial-of-service.

Bad:

```json
{ "error": "Email exists but password is wrong" }
```

Good:

```json
{ "error": "Invalid credentials" }
```

---

## 8. Multi-Factor Authentication

MFA MUST be required for:

- admin users;
- privileged operators;
- internal staff with sensitive data access;
- high-risk workflow transitions;
- security settings changes;
- account recovery completion;
- API key creation;
- data export;
- impersonation/delegated access;
- production operations.

Preferred factor order:

1. WebAuthn/passkeys/security keys.
2. App-based TOTP or push with number matching and anti-fatigue controls.
3. Hardware OTP where appropriate.
4. SMS only as legacy fallback, never as the strongest factor.

Rules:

- MFA enrollment MUST require recent authentication.
- MFA reset MUST be treated as high-risk account recovery.
- Backup codes MUST be one-time use, hashed at rest, and regenerated on rotation.
- MFA bypass MUST require explicit approval and audit.
- Users MUST be notified of MFA changes.

Forbidden:

- MFA reset by email link alone for privileged accounts.
- Push MFA without rate limit or fatigue protection.
- Reusing OTP after successful verification.
- Logging OTP or backup codes.

---

## 9. WebAuthn / Passkeys

For new high-security web applications, passkeys/WebAuthn SHOULD be supported or evaluated.

Mandatory if implemented:

- Bind credentials to the correct relying party ID.
- Validate challenge, origin, RP ID hash, signature, user presence, and when required, user verification.
- Challenges MUST be random, short-lived, single-use, and bound to the authentication transaction.
- Store only public credential data and metadata, never private keys.
- Support credential revocation and recovery.
- Treat synced passkeys and hardware-bound security keys according to risk level.
- Require step-up with stronger authenticator for privileged workflows when needed.

Forbidden:

- Accepting WebAuthn assertions without verifying challenge.
- Ignoring origin/RP ID binding.
- Assuming passkey possession automatically grants all authorization.

---

## 10. Session Design

Session design MUST be explicit.

### 10.1 Cookie-based sessions

For browser applications, secure server-side sessions using cookies are often safer than storing bearer tokens in browser storage.

Mandatory cookie flags:

```http
Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax|Strict; Path=/
```

Rules:

- Use `HttpOnly` to prevent JavaScript access.
- Use `Secure` in production.
- Use appropriate `SameSite`.
- Rotate session ID after login, privilege change, MFA completion, and recovery.
- Enforce idle timeout and absolute timeout.
- Store session state server-side or use signed/encrypted session cookies with strict size and revocation design.
- CSRF protection is mandatory when cookies authenticate state-changing requests.

---

### 10.2 Token-based sessions

Bearer tokens are high-risk because possession equals use.

Mandatory:

- Access tokens MUST be short-lived.
- Refresh tokens MUST be rotated where applicable.
- Refresh token reuse MUST trigger revocation and investigation.
- Tokens MUST not be stored in localStorage for high-risk browser apps.
- Tokens MUST not be logged.
- Tokens MUST be scoped to audience/resource.
- Token revocation strategy MUST exist before production.
- Sender-constrained tokens SHOULD be used for high-risk machine/API integrations.

Forbidden:

```text
JWT exp = 30 days
refresh token never expires
access token accepted by every service
```

---

## 11. JWT Validation

JWT validation MUST be strict.

Mandatory checks:

```text
signature valid
alg explicitly allowed
issuer expected
audience expected
expiration not exceeded
not-before valid
issued-at reasonable
subject present
key id resolved from trusted JWKS/source
scope/claims schema valid
required tenant/org claim valid when applicable
```

Rules:

- Never trust `alg` from the token without allowlisting.
- Never accept `none` algorithm.
- Never skip signature verification.
- Never decode JWT as authentication.
- JWKS must be fetched from trusted issuer metadata and cached safely.
- Key rotation must be supported.
- Clock skew must be bounded.
- JWT claims must be treated as untrusted until the token is fully validated.
- Authorization decisions must not rely on arbitrary user-controlled claims.

Bad:

```java
var claims = Jwt.decode(token); // no verification
```

Good:

```text
parse -> verify signature -> validate issuer/audience/expiry/alg/key -> map subject -> authorize
```

---

## 12. OpenID Connect

OIDC MUST be used when OAuth-based login is required.

Mandatory:

- Use Authorization Code Flow with PKCE for browser/mobile/public clients.
- Validate ID Token signature, issuer, audience, expiry, nonce when used, and authorized party where applicable.
- Validate state parameter to prevent CSRF/login injection.
- Validate redirect URI exactly.
- Use discovery metadata from trusted issuer.
- Do not use implicit flow for new systems.
- Do not treat access token as an ID token.
- Do not identify users using email alone.

Rules:

- OIDC authenticates the user to the client via ID Token semantics.
- OAuth access tokens authorize API access; they are not proof of login identity by themselves.
- UserInfo endpoint data MUST be trusted only when called with a valid token from the expected issuer and mapped carefully.

---

## 13. OAuth Client and Grant Rules

OAuth MUST be used according to current security best practices.

Allowed for new systems:

- Authorization Code + PKCE.
- Client Credentials for machine-to-machine only.
- Device Authorization Grant only for constrained-input devices.
- Token Exchange only with explicit trust boundary design.

Avoid/deprecate:

- Implicit flow.
- Resource Owner Password Credentials grant.
- Password sharing between user and client.
- Wildcard redirect URIs.
- Long-lived public-client refresh tokens without rotation.

Mandatory:

- PKCE for public clients and recommended broadly.
- Exact redirect URI matching.
- `state` for CSRF protection.
- `nonce` for OIDC ID token replay protection where applicable.
- Scope minimization.
- Audience restriction.
- Confidential clients must authenticate securely.
- Client secrets must never be shipped in SPA/mobile binaries.

---

## 14. Machine and Service Authentication

Service-to-service authentication MUST use a distinct mechanism from human login.

Allowed patterns:

- mTLS with workload identity.
- OAuth 2.0 client credentials with strong client authentication.
- SPIFFE/SPIRE-style workload identity where platform supports it.
- Signed short-lived service tokens issued by a trusted identity provider.
- Cloud workload identity instead of static credentials.

Mandatory:

- Every service identity MUST be unique.
- Credentials MUST be scoped to service and environment.
- Secrets MUST be rotated.
- Shared credentials across services are forbidden.
- Service tokens MUST have audience and expiry.
- Authentication of service identity MUST still be followed by authorization.

Bad:

```text
all services use INTERNAL_API_KEY=abc123
```

Good:

```text
service-a authenticates as service-a/prod, receives token for service-b audience, service-b authorizes allowed operation
```

---

## 15. Account Lifecycle

Authentication design MUST include account lifecycle states.

Required states:

```text
pending_verification
active
locked
suspended
disabled
deleted
compromised
```

Rules:

- Disabled users MUST NOT authenticate.
- Deleted users MUST NOT be silently recreated with old permissions.
- Locked users MAY recover only through approved recovery flow.
- Compromised users MUST force credential reset and session revocation.
- External IdP deprovisioning MUST propagate to application access.
- Login MUST check current account status, not only token validity.

---

## 16. Account Recovery

Account recovery is authentication. It MUST be at least as secure as login.

Mandatory:

- Recovery tokens MUST be random, single-use, short-lived, and hashed at rest.
- Recovery completion MUST rotate credentials and sessions.
- Existing sessions SHOULD be revoked after password reset or recovery.
- Users MUST be notified of recovery events.
- Privileged accounts MUST require stronger recovery verification.
- Recovery flow MUST not leak whether an account exists.
- Recovery flow MUST be rate-limited.

Forbidden:

- Security questions.
- Email-only recovery for privileged accounts without step-up or approval.
- Reusable reset tokens.
- Reset tokens in logs.
- Reset token accepted after password change.

---

## 17. Re-authentication and Step-Up

Step-up authentication MUST be required for sensitive actions.

Sensitive actions include:

- changing password;
- changing MFA;
- changing email/phone;
- creating API keys;
- exporting regulated data;
- deleting records;
- privileged workflow transitions;
- impersonating users;
- changing authorization policy;
- approving high-impact case decisions.

Rules:

- Check authentication freshness.
- Require MFA/passkey for high-risk actions.
- Bind step-up result to a short-lived transaction context.
- Do not make step-up a global indefinite privilege escalation.

---

## 18. Frontend Authentication Rules

Browser apps MUST assume JavaScript runtime can be attacked via XSS.

Mandatory:

- Prefer secure `HttpOnly` cookies for browser sessions where architecture permits.
- Do not store high-value long-lived tokens in `localStorage`.
- Do not expose refresh tokens to JavaScript unless risk-assessed and mitigated.
- Handle 401 by returning to authentication flow, not blind retry loops.
- Handle 403 as authorization failure, not login failure.
- Do not log tokens in console, telemetry, or error reports.
- Avoid token parsing in frontend except for non-security display hints.

---

## 19. Authentication Error Semantics

Use consistent error semantics.

| Scenario                      | Recommended status                                                         |
| ----------------------------- | -------------------------------------------------------------------------- |
| Missing/invalid credential    | 401                                                                        |
| Expired credential            | 401                                                                        |
| Authenticated but not allowed | 403                                                                        |
| MFA required                  | 401 or 403 with explicit machine-readable challenge, depending on protocol |
| Account locked/disabled       | 401 with generic message; audit detailed reason                            |
| Unknown route                 | 404                                                                        |

Rules:

- External error messages MUST be generic.
- Internal logs MAY contain reason codes without secrets.
- Do not reveal user existence.
- Do not reveal which factor failed.

---

## 20. Logging and Audit

Authentication events MUST be auditable.

Log security events:

- login success;
- login failure;
- MFA challenge and verification result;
- password change/reset;
- recovery request and completion;
- session revocation;
- token refresh/reuse anomaly;
- account lock/unlock;
- suspicious login;
- IdP linking/unlinking;
- service credential rotation;
- privileged step-up.

Log fields:

```text
event_id
correlation_id
subject_id when known
actor_type
client_id
issuer
ip/network metadata where allowed
user_agent/device metadata where allowed
tenant_id
authentication_method
assurance_level
result
reason_code
timestamp
```

Forbidden in logs:

- passwords;
- OTP values;
- reset tokens;
- access tokens;
- refresh tokens;
- session IDs;
- private keys;
- full Authorization header.

---

## 21. Privacy and Data Minimization

Authentication MUST minimize identity data.

Rules:

- Store only identity attributes required for product/security/legal purposes.
- Do not persist full IdP profile blindly.
- Do not expose authentication metadata to unauthorized users.
- Do not put sensitive personal data in JWT unless absolutely required.
- Prefer internal subject ID over email in logs/events.
- Define retention period for authentication logs.

---

## 22. Testing Requirements

LLM-generated authentication code MUST include tests or produce a test plan.

Required tests:

- successful login;
- invalid credential;
- unknown account with generic error;
- locked/disabled account;
- rate limit behavior;
- password reset token single-use;
- expired reset token;
- session rotation after login;
- session invalidation after password reset;
- JWT wrong issuer;
- JWT wrong audience;
- JWT expired;
- JWT unsupported algorithm;
- JWKS key rotation behavior;
- OIDC state validation;
- OIDC nonce validation where applicable;
- MFA required for privileged action;
- step-up freshness expiry;
- token not leaked to logs.

---

## 23. Common Anti-Patterns

### 23.1 OAuth used as login without OIDC

Bad:

```text
If Google access_token is valid, user is logged in.
```

Why bad:

- Access token is for resource access.
- It may not be intended for your client.
- It is not equivalent to an ID token.

Required:

- Use OIDC ID Token validation or trusted userinfo flow.

---

### 23.2 JWT decode without verification

Bad:

```text
Base64 decode JWT and trust claims.
```

Required:

- Verify signature, issuer, audience, expiry, algorithm, key, and claim schema.

---

### 23.3 Long-lived bearer tokens

Bad:

```text
Access token valid for 90 days.
```

Required:

- Short-lived access token.
- Refresh token rotation.
- Revocation strategy.
- Sender-constrained token for high-risk contexts.

---

### 23.4 Account recovery weaker than login

Bad:

```text
Admin account can reset password by clicking email link only.
```

Required:

- MFA/approval/stronger verification for privileged accounts.

---

### 23.5 Shared machine secret

Bad:

```text
One internal secret used by every service.
```

Required:

- Unique workload identities.
- Scoped credentials.
- Rotation.
- Audit.

---

## 24. LLM Implementation Checklist

Before writing authentication code, the LLM MUST answer:

```text
1. Who are the actors? users, admins, services, jobs, devices?
2. What identity provider is authoritative?
3. What is the subject identifier?
4. What assurance level is required per workflow?
5. What credential types are allowed?
6. Where are credentials stored?
7. How are sessions/tokens issued, validated, rotated, and revoked?
8. What is the MFA/step-up policy?
9. How does account recovery work?
10. How is authentication audited?
11. How are disabled/deleted users blocked?
12. How are service identities authenticated?
13. How does authorization consume the authenticated subject?
14. What tests prove unsafe flows are rejected?
```

If these cannot be answered, the LLM MUST NOT proceed directly to implementation.

---

## 25. Acceptance Criteria

Authentication implementation is acceptable only if:

- credentials are never stored or logged insecurely;
- sessions/tokens have explicit lifetime and revocation design;
- JWT/OIDC validation is strict;
- high-risk workflows require MFA/step-up;
- recovery is not weaker than login;
- login failure behavior avoids enumeration;
- service identities are unique and scoped;
- disabled/locked/deleted account states are enforced;
- authentication events are auditable;
- tests cover invalid, expired, revoked, and forged credentials;
- authorization is separate and still required.

---

## 26. Enforcement Snippet for LLM Agents

```text
When implementing authentication:
- Do not invent protocols.
- Do not store plaintext/encrypted passwords.
- Do not trust decoded JWT claims without verification.
- Do not use OAuth access tokens as proof of login identity without OIDC semantics.
- Do not place tokens in URLs/logs/localStorage for high-risk web apps.
- Do not skip MFA/step-up for privileged actions.
- Do not make recovery weaker than login.
- Always define subject model, session/token lifecycle, revocation, logging, and tests.
```

---

## 27. References

- NIST SP 800-63-4 Digital Identity Guidelines.
- NIST SP 800-63B Authentication and Authenticator Management.
- OWASP Authentication Cheat Sheet.
- OWASP Session Management Cheat Sheet.
- OpenID Connect Core 1.0.
- RFC 9700: Best Current Practice for OAuth 2.0 Security.
- RFC 9449: OAuth 2.0 Demonstrating Proof of Possession.
- W3C Web Authentication: Public Key Credentials.
