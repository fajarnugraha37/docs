# learn-java-authentication-modes-and-patterns-part-029

# Part 29 — Authentication Failure Modeling and Attack Simulation

> Advanced series: Java Authentication Modes and Patterns  
> Scope: Java 8–25, Servlet/Jakarta, Spring Security, OAuth2/OIDC, SAML, mTLS, API keys, HMAC, JWT, opaque tokens, distributed systems, messaging, and enterprise authentication architecture.

---

## 0. Why This Part Exists

Part 0–28 introduced authentication models, protocols, runtime mechanisms, identity providers, token lifecycles, key management, microservice propagation, and event-driven authentication. This part changes perspective.

Instead of asking:

> “How do I implement authentication?”

we ask:

> “How does authentication fail, and how do I prove the design survives realistic attacks?”

A top-tier engineer does not treat authentication as a checklist of features. A top-tier engineer treats authentication as a security-critical state machine with adversarial inputs, distributed state, protocol boundaries, browser behavior, clock drift, key rotation, identity propagation, and operational failure.

Authentication failures are rarely caused by a single missing line of code. They usually emerge from mismatched assumptions:

- The frontend assumes a token belongs to the logged-in user.
- The backend assumes the gateway already authenticated the request.
- The resource server assumes `aud` validation is optional.
- The session layer assumes logout means all tokens are dead.
- The IdP assumes redirect URI validation is strict.
- The microservice assumes an internal network is trusted.
- The batch worker assumes message metadata is truthful.
- The audit layer assumes display names are stable identity.
- The operations team assumes key rotation will not break old tokens.

This part builds a disciplined way to find those assumptions before attackers do.

---

## 1. Core Mental Model: Authentication Fails at Boundaries

Authentication is not one event. It is a chain of trust transitions.

```text
Credential presentation
        ↓
Credential verification
        ↓
Principal establishment
        ↓
Session/token issuance
        ↓
Context propagation
        ↓
Authorization decision input
        ↓
Audit event generation
        ↓
Revocation / expiry / logout
```

Every arrow is a possible failure point.

A secure design must answer four questions at every boundary:

1. **What proof was presented?**  
   Password, certificate, signed request, session cookie, bearer token, SAML assertion, WebAuthn assertion, API key, Kerberos ticket, broker credential.

2. **Who verified it?**  
   Application, servlet container, Spring Security filter, gateway, IdP, broker, service mesh, database, LDAP server.

3. **What identity was established?**  
   User, client application, service account, device, tenant, organization, delegated user, system actor.

4. **What downstream component relies on it?**  
   Controller, service, repository, event consumer, audit log, policy engine, another microservice, background job.

Most authentication bugs happen when one component answers those questions differently from another component.

Example:

```text
Gateway:
  "I validated the access token and injected X-User-Id."

Backend service:
  "I trust X-User-Id because this route is internal."

Attacker:
  "Can I reach the service directly and supply my own X-User-Id?"
```

The bug is not merely “header trust”. The bug is a broken boundary contract.

---

## 2. Authentication Failure Taxonomy

Use this taxonomy to classify authentication failures during design review, threat modeling, testing, incident response, and code review.

| Category | Core Failure | Typical Example |
|---|---|---|
| Credential compromise | Secret/proof is stolen or guessed | Password stuffing, leaked API key, stolen refresh token |
| Proof replay | Valid proof is reused outside intended context | Replayed HMAC request, stolen session cookie |
| Token substitution | Token for one context accepted in another | Access token for Service A accepted by Service B |
| Identity confusion | System maps proof to wrong principal | Wrong SAML NameID mapping, reused email as unique ID |
| Session confusion | Session state is created, reused, or invalidated incorrectly | Session fixation, logout race |
| Federation confusion | IdP/client/tenant/issuer relationship is ambiguous | IdP mix-up, wrong issuer accepted |
| Context leakage | Authenticated context leaks across execution paths | ThreadLocal leak in executor or virtual thread misuse |
| Downgrade | Stronger authentication is bypassed by weaker path | MFA required in UI but not API |
| Boundary bypass | Authentication performed at one layer but bypassable at another | Direct service access bypasses gateway |
| Revocation failure | Credentials/tokens remain usable after invalidation | Refresh token reuse, stale JWKS cache |
| Audit failure | The system cannot reconstruct who authenticated | Mutable display name used as actor ID |
| Availability failure | Auth dependency outage causes unsafe behavior | IdP outage leads to fail-open resource server |

This taxonomy matters because different failures require different controls. You do not fix replay by adding better logging. You do not fix token substitution by increasing token expiry. You do not fix session fixation by using JWT. You do not fix identity confusion by adding MFA.

---

## 3. Attack Simulation as Engineering Method

Attack simulation is not “penetration testing at the end”. It is a design method.

The process:

```text
1. Pick an authentication boundary
2. Define the expected invariant
3. Identify attacker capability
4. Mutate one assumption
5. Predict system behavior
6. Build a test or review checklist
7. Define detection signal
8. Define response action
```

Example:

```text
Boundary:
  Resource server accepts access token.

Expected invariant:
  Token must be issued by trusted issuer and intended for this API audience.

Attacker capability:
  Attacker has a valid token for another API.

Mutation:
  Send token with valid signature but wrong audience.

Expected safe behavior:
  401 or 403; no business action; audit event records audience mismatch.

Test:
  Generate JWT signed by same IdP but with aud = "other-api".

Detection:
  Security metric increments invalid_audience_count.

Response:
  Alert if sudden spike indicates probing or misconfigured client.
```

That is the difference between “we validate JWT” and “we understand JWT failure modes”.

---

## 4. Core Invariants for Authentication Systems

An invariant is a rule that must remain true even under concurrency, failure, retries, partial outage, malicious input, and deployment change.

### 4.1 Principal Invariant

Once authentication completes, every downstream component must agree on the principal identity.

Bad:

```text
Controller uses email.
Service uses user_id.
Audit uses display_name.
Policy engine uses external_id.
```

Better:

```text
Canonical internal subject:
  actor_id = immutable internal UUID

External identities:
  idp_subject, issuer, tenant_id, email, display_name

Audit:
  actor_id + issuer + external_subject + authentication_method + correlation_id
```

### 4.2 Token Audience Invariant

A token must only be accepted by the resource it was issued for.

For JWT, this means strict `aud` validation. For opaque tokens, introspection metadata must bind token to expected resource/client/scope. For SAML, audience restriction must be checked. For HMAC/API key, key scope must bind to API/client/tenant.

### 4.3 Issuer Invariant

A token/assertion must be accepted only from the configured issuer for the current tenant/client/context.

This is especially important in multi-tenant systems.

Bad:

```text
Any token signed by any configured JWKS is accepted.
```

Better:

```text
Resolve tenant → expected issuer → expected JWKS → expected audience → expected claim mapping.
```

### 4.4 Session Rotation Invariant

Authentication or privilege elevation must rotate the session identifier.

Otherwise, session fixation becomes possible.

### 4.5 Proof Freshness Invariant

Authentication proof must be recent enough for the operation.

Examples:

- password login may be enough for normal browsing;
- payment, profile change, MFA reset, admin action may require step-up;
- OIDC can carry `auth_time`, `acr`, and `amr` to reason about assurance;
- session alone may not prove recent authentication.

### 4.6 Revocation Invariant

After revocation, the credential/token/session must stop being accepted within a bounded and documented time.

Not always immediately. Sometimes cache exists. But the bound must be explicit.

Bad:

```text
"Logout revokes access."  // but JWT access token remains valid for 1 hour
```

Better:

```text
Logout behavior:
  - server session invalidated immediately
  - refresh token revoked immediately
  - access token valid until expiry, max 5 minutes
  - high-risk revocation triggers deny-list by jti for remaining lifetime
```

### 4.7 Context Isolation Invariant

One request/task/user must not inherit another request/task/user's authentication context.

This is critical with:

- thread pools;
- `ThreadLocal`;
- async servlet;
- `CompletableFuture`;
- Reactor;
- virtual threads;
- scheduled jobs;
- message consumers.

### 4.8 Audit Reconstruction Invariant

For every security-relevant action, the system must be able to reconstruct:

```text
who acted,
through which authentication method,
under which tenant/client,
from which request/session/token,
at what time,
with what assurance,
on whose behalf,
through which service path.
```

If audit cannot reconstruct this, authentication is not operationally defensible.

---

## 5. Attack Class 1 — Credential Stuffing and Password Guessing

### 5.1 Scenario

Attacker obtains username/password pairs from unrelated breaches and tries them against your login endpoint.

```text
POST /login
username=victim@example.com
password=leakedPassword123
```

### 5.2 Why This Works

Users reuse passwords. Attackers automate attempts. A valid password is still a valid authentication proof unless the system adds additional controls.

### 5.3 Java/Spring/Jakarta Impact

Common weak patterns:

```java
if (passwordEncoder.matches(rawPassword, storedHash)) {
    return authenticated(user);
}
```

This is not wrong by itself. It is incomplete if the endpoint has no throttling, risk scoring, MFA, breach detection, alerting, or lockout policy.

### 5.4 Failure Invariants

The system fails if:

- unlimited login attempts are possible;
- GraphQL batching or bulk endpoint bypasses rate limit;
- error messages reveal account existence;
- password reset can be brute-forced;
- MFA is optional for high-risk accounts;
- successful credential stuffing is indistinguishable from normal login.

### 5.5 Defensive Design

Use layered controls:

```text
Per-account throttling
+ Per-IP throttling
+ Per-device / fingerprint heuristics
+ Global attack detection
+ Breached password screening
+ MFA / step-up for risky login
+ Notification for unusual login
+ Audit trail for failed and successful attempts
```

### 5.6 Test Cases

```text
Test: 100 failed attempts for same username from one IP
Expected: rate limited / delayed / temporarily locked

Test: 100 failed attempts for same IP across many usernames
Expected: IP throttled / risk score increased

Test: GraphQL batched login attempts
Expected: each logical login attempt counted

Test: existing vs non-existing username
Expected: indistinguishable error and timing behavior
```

OWASP API Security 2023 explicitly discusses broken authentication scenarios including attackers using GraphQL batching to bypass request rate limiting. Use that as a reminder that rate limiting must count logical authentication attempts, not merely HTTP requests.

---

## 6. Attack Class 2 — Username / Account Enumeration

### 6.1 Scenario

Attacker determines which accounts exist by observing:

- login error messages;
- password reset response;
- registration response;
- MFA challenge behavior;
- timing differences;
- HTTP status codes;
- email delivery side effects.

Bad:

```text
Invalid password.
```

versus:

```text
User not found.
```

### 6.2 Better Response Pattern

```text
If the account exists and the request is valid, we will send instructions.
```

For login:

```text
Invalid username or password.
```

### 6.3 Hidden Enumeration Paths

Enumeration often survives in secondary flows:

```text
/login
/forgot-password
/resend-verification
/mfa/challenge
/api/users/exists
/signup
/invite/accept
/sso/discovery
```

### 6.4 Java Design Pattern

Centralize authentication error mapping.

```java
public final class AuthenticationErrorMapper {
    public ApiError toPublicError(AuthenticationException ex) {
        return ApiError.unauthorized("Invalid credentials");
    }

    public SecurityEvent toSecurityEvent(AuthenticationException ex, LoginAttempt attempt) {
        return SecurityEvent.builder()
            .type("LOGIN_FAILED")
            .reason(internalReason(ex))
            .usernameHash(hashForSecurityAnalytics(attempt.username()))
            .ip(attempt.ip())
            .build();
    }
}
```

Public response must be generic. Internal telemetry must be specific.

---

## 7. Attack Class 3 — Session Fixation

### 7.1 Scenario

Attacker forces or tricks a victim into using a known session ID before login. If the app does not rotate the session ID after authentication, attacker can reuse the same session ID after victim logs in.

```text
1. Attacker obtains session ID S
2. Victim visits app using S
3. Victim logs in
4. App binds S to victim account
5. Attacker uses S
```

### 7.2 Root Cause

The system fails to create a new session identity at authentication time.

### 7.3 Servlet/Spring Control

In Servlet/Spring systems, successful authentication should rotate session ID. Spring Security has built-in session fixation protection when using standard session-based authentication mechanisms.

### 7.4 Test

```text
1. Start anonymous session; capture JSESSIONID=A
2. Login successfully
3. Capture post-login JSESSIONID=B
4. Assert A != B
5. Try using A
6. Assert A is not authenticated
```

### 7.5 Failure Mode in Custom Filters

If you implement a custom authentication filter and manually set security context without invoking proper session authentication strategy, session fixation protection may not happen.

Bad pattern:

```java
SecurityContextHolder.getContext().setAuthentication(auth);
chain.doFilter(request, response);
```

Better pattern:

```java
Authentication authenticated = authenticationManager.authenticate(token);
SecurityContext context = securityContextHolderStrategy.createEmptyContext();
context.setAuthentication(authenticated);
securityContextRepository.saveContext(context, request, response);
sessionAuthenticationStrategy.onAuthentication(authenticated, request, response);
```

The exact implementation depends on Spring Security version and configuration, but the invariant is stable: authentication must be saved and session strategy must be applied intentionally.

---

## 8. Attack Class 4 — Session Hijacking

### 8.1 Scenario

Attacker steals a session cookie through:

- XSS;
- insecure transport;
- missing `Secure` flag;
- malware;
- reverse proxy logs;
- subdomain cookie injection;
- overly broad cookie domain;
- local device compromise.

### 8.2 Cookie as Bearer Credential

A session cookie is effectively a bearer token. Whoever has it can act as the session owner unless additional binding or risk checks exist.

### 8.3 Defensive Layers

```text
HttpOnly
Secure
SameSite
narrow Domain
narrow Path
TLS everywhere
short idle timeout
absolute timeout
session rotation
risk-based reauthentication
server-side invalidation
XSS prevention
```

### 8.4 Simulation

```text
Test: replay stolen cookie from different IP/device
Expected: depending on risk policy, allow with alert, step-up, or terminate

Test: use cookie after logout
Expected: session invalid

Test: use cookie after password change
Expected: old sessions invalidated or stepped up
```

### 8.5 Advanced Failure

Do not over-trust IP binding. Mobile users and corporate proxies can change IPs. Device binding can create false positives. The design must balance security and usability.

Top-tier decision:

```text
High-risk operation:
  require recent authentication / step-up

Normal navigation:
  allow session continuation but record risk signal
```

---

## 9. Attack Class 5 — CSRF Against Cookie-Based Authentication

### 9.1 Scenario

Victim is logged in. Attacker causes victim browser to send an authenticated state-changing request.

```html
<form action="https://bank.example.com/transfer" method="POST">
  <input name="to" value="attacker" />
  <input name="amount" value="1000" />
</form>
<script>document.forms[0].submit()</script>
```

Browser automatically attaches cookies. The backend sees an authenticated request.

### 9.2 Authentication Lesson

CSRF is not a failure to know who the user is. The server may know the user correctly. It is a failure to know whether the user intentionally authorized this request.

### 9.3 Defensive Controls

```text
CSRF token
SameSite cookie
Origin/Referer validation
custom header for AJAX APIs
avoid state change via GET
re-authentication for critical actions
```

### 9.4 Spring Security

Spring Security enables CSRF protection by default for unsafe HTTP methods in servlet applications. Disabling CSRF globally is only safe when the application does not rely on browser cookies or other automatically attached credentials.

### 9.5 Test Cases

```text
POST with session cookie but no CSRF token
Expected: 403

POST with invalid CSRF token
Expected: 403

GET state-changing endpoint
Expected: method not allowed or no state change

Cross-origin form POST
Expected: rejected
```

### 9.6 Common Bad Reasoning

Bad:

```text
"We use JWT, so CSRF does not matter."
```

Correct:

```text
CSRF risk depends on whether credential is automatically attached by browser.

JWT in Authorization header:
  usually not automatically attached by browser → lower CSRF risk

JWT stored in cookie:
  automatically attached → CSRF risk remains
```

---

## 10. Attack Class 6 — JWT Algorithm Confusion and Weak Validation

### 10.1 Scenario

Resource server parses JWT and trusts claims without strict validation.

Bad:

```java
DecodedJWT jwt = JWT.decode(token);
String userId = jwt.getSubject();
```

This decodes. It does not verify.

### 10.2 Required Validations

A JWT used for authentication/resource access must validate:

```text
signature
issuer
algorithm allow-list
audience
expiry
not-before
issued-at reasonableness
key ID selection
claim semantics
token type / use
tenant binding
```

### 10.3 Algorithm Confusion

Bad design:

```text
Accept algorithm from token header.
```

Better:

```text
Expected issuer/client/resource configuration defines allowed algorithms.
Token header is input, not policy.
```

### 10.4 Simulation

```text
Test: unsigned JWT
Expected: rejected

Test: JWT signed with wrong key
Expected: rejected

Test: valid signature, wrong issuer
Expected: rejected

Test: valid signature, wrong audience
Expected: rejected

Test: expired JWT
Expected: rejected

Test: JWT with alg not in allow-list
Expected: rejected
```

### 10.5 Failure Signal

Record internal reasons separately:

```text
JWT_INVALID_SIGNATURE
JWT_EXPIRED
JWT_INVALID_ISSUER
JWT_INVALID_AUDIENCE
JWT_UNSUPPORTED_ALG
JWT_UNKNOWN_KID
```

But return generic public response:

```text
401 Unauthorized
```

---

## 11. Attack Class 7 — Token Substitution

### 11.1 Scenario

Attacker uses a token issued for one purpose in another context.

Examples:

```text
ID Token used as API access token
Access token for API A used on API B
SAML assertion for SP A used on SP B
Token from tenant X used on tenant Y route
Internal service token used as end-user token
```

### 11.2 Why It Happens

Developers often validate only signature and expiry.

Bad:

```text
signature valid + exp valid = authenticated
```

Correct:

```text
signature valid
+ issuer expected
+ audience expected
+ token type expected
+ client/resource binding expected
+ tenant expected
+ claim semantics expected
```

### 11.3 ID Token Misuse

OIDC ID Token proves authentication of user to the client. It is not automatically an API authorization token. Resource servers should validate access tokens intended for them.

### 11.4 Java Test Pattern

Create a token matrix.

| Token | Expected Endpoint | Mutated Endpoint | Expected Result |
|---|---|---|---|
| API A access token | API A | API B | reject |
| ID token | client login callback | resource API | reject |
| Tenant A token | Tenant A route | Tenant B route | reject |
| User token | user API | service API | reject if wrong actor type |
| Service token | service API | user API | reject if user required |

This matrix catches a large class of real production mistakes.

---

## 12. Attack Class 8 — Refresh Token Theft and Reuse

### 12.1 Scenario

Attacker steals a refresh token and uses it to mint new access tokens.

### 12.2 Why Access Token Expiry Is Not Enough

Short access token lifetime helps only if refresh token is protected. A long-lived refresh token is often the real crown jewel.

### 12.3 Defensive Controls

```text
refresh token rotation
reuse detection
sender-constrained refresh token
client binding
device binding
revocation endpoint
risk-based invalidation
secure storage
```

### 12.4 Reuse Detection Flow

```text
1. Client uses refresh_token_1
2. Server returns access_token_2 + refresh_token_2
3. refresh_token_1 is invalidated
4. Later, refresh_token_1 appears again
5. Server detects reuse
6. Revoke token family / session / device grant
7. Alert user / security team depending on risk
```

### 12.5 Simulation

```text
Use refresh token once
Expected: success and rotation

Reuse old refresh token
Expected: reject and revoke token family

Use refresh token from different client/device
Expected: reject or step-up based on binding
```

---

## 13. Attack Class 9 — OAuth Authorization Code Interception

### 13.1 Scenario

Attacker intercepts authorization code and redeems it.

This is especially relevant for public clients, native apps, mobile apps, and browser-based apps.

### 13.2 PKCE Defense

PKCE binds authorization code redemption to the original client instance through `code_verifier` and `code_challenge`.

### 13.3 Simulation

```text
1. Start auth flow with PKCE
2. Capture authorization code
3. Redeem code without code_verifier
Expected: reject

4. Redeem code with wrong code_verifier
Expected: reject

5. Redeem same code twice
Expected: second attempt rejected
```

### 13.4 Common Failure

Bad:

```text
PKCE optional for public clients.
```

Better:

```text
PKCE required for public clients and browser/native flows.
```

---

## 14. Attack Class 10 — OAuth / OIDC State and Nonce Failures

### 14.1 State Failure

`state` protects client redirect flow from CSRF and response injection.

Failure:

```text
Client accepts callback without verifying state.
```

Consequence:

```text
Attacker can bind victim session to attacker authorization response.
```

### 14.2 Nonce Failure

`nonce` in OIDC helps bind ID Token to authentication request and mitigate replay.

Failure:

```text
Client does not verify nonce in ID Token.
```

### 14.3 Simulation

```text
Callback without state
Expected: reject

Callback with wrong state
Expected: reject

OIDC ID Token without expected nonce
Expected: reject

Replay old ID Token with old nonce
Expected: reject
```

### 14.4 Storage Decision

State/nonce must be stored server-side or in an integrity-protected, tamper-resistant form.

Bad:

```text
state = base64(returnUrl)
```

Better:

```text
state = random identifier
server/session/cache maps state → flow data
```

or:

```text
state = signed/encrypted structured value with strict expiry and audience
```

---

## 15. Attack Class 11 — Open Redirect in Authentication Flow

### 15.1 Scenario

Application accepts arbitrary redirect target after login.

```text
/login?returnUrl=https://evil.example/phish
```

After successful login, user is redirected to attacker domain.

### 15.2 Why This Matters

Open redirect can be chained with:

- phishing;
- OAuth redirect URI abuse;
- token leakage through URL fragments;
- authorization code interception;
- user trust abuse.

### 15.3 Defensive Pattern

Allow only relative internal paths or allow-listed redirect URIs.

Bad:

```java
response.sendRedirect(request.getParameter("returnUrl"));
```

Better:

```java
String target = request.getParameter("returnUrl");
if (!isSafeRelativePath(target)) {
    target = "/";
}
response.sendRedirect(target);
```

### 15.4 Test Cases

```text
returnUrl=/dashboard
Expected: allowed

returnUrl=https://evil.example
Expected: rejected/default

returnUrl=//evil.example
Expected: rejected/default

returnUrl=/\evil.example
Expected: rejected/default after normalization

returnUrl=%2f%2fevil.example
Expected: rejected/default after decoding
```

---

## 16. Attack Class 12 — IdP Mix-Up and Issuer Confusion

### 16.1 Scenario

A client supports multiple identity providers. Attacker manipulates flow so client sends authorization code/token to wrong issuer or accepts response from wrong issuer.

### 16.2 Root Cause

The client does not strongly bind authentication request to expected issuer.

### 16.3 Multi-Tenant Risk

In multi-tenant systems:

```text
Tenant A → Issuer A
Tenant B → Issuer B
```

If callback handling does not bind `state` to tenant and issuer, a token from issuer B might be processed under tenant A logic.

### 16.4 Defensive Pattern

During auth request:

```text
state_id → {
  tenant_id,
  expected_issuer,
  client_registration_id,
  redirect_uri,
  nonce,
  requested_acr,
  created_at
}
```

During callback:

```text
resolve state_id
validate issuer == expected_issuer
validate token endpoint belongs to expected issuer
validate ID Token iss == expected_issuer
validate aud/client_id
validate nonce
```

### 16.5 Simulation

```text
Start login with IdP A
Return callback carrying response from IdP B
Expected: reject

Start login for tenant A
Return token from tenant B issuer
Expected: reject
```

---

## 17. Attack Class 13 — SAML XML Signature Wrapping

### 17.1 Scenario

Attacker crafts SAML response containing both:

- a signed benign assertion;
- an unsigned malicious assertion.

If application verifies signature on one element but reads identity from another element, attacker wins.

### 17.2 Root Cause

XML parsing and signature validation are not bound to the exact node used for identity extraction.

### 17.3 Safe Invariant

```text
The exact assertion from which NameID/attributes are read must be the assertion whose signature and conditions were validated.
```

### 17.4 Defensive Pattern

Use mature SAML libraries. Avoid hand-rolled XML signature validation.

Validate:

```text
signature
issuer
audience restriction
destination
recipient
inResponseTo
notBefore / notOnOrAfter
subject confirmation
replay cache
metadata trust
```

### 17.5 Simulation

```text
SAML response with valid signed assertion and extra unsigned assertion
Expected: reject or ignore unsigned assertion; identity from signed validated assertion only

SAML response with wrong audience
Expected: reject

Replay same assertion ID
Expected: reject
```

---

## 18. Attack Class 14 — HMAC Replay and Canonicalization Bugs

### 18.1 Scenario

A signed request is captured and replayed.

```text
POST /payments
Date: old timestamp
X-Signature: valid_signature
```

If server does not enforce freshness and nonce/idempotency, signature remains valid.

### 18.2 Defensive Controls

```text
timestamp window
nonce cache
request ID
body digest
canonical path/query/header normalization
key ID
algorithm version
constant-time comparison
```

### 18.3 Canonicalization Failure

Client signs:

```text
GET /api/orders?status=open&sort=date
```

Server verifies:

```text
GET /api/orders?sort=date&status=open
```

If canonicalization differs, legitimate requests fail. Worse, if server canonicalizes less strictly than it routes, attacker may sign one logical request and execute another.

### 18.4 Simulation

```text
Replay signed request within timestamp window but same nonce
Expected: reject duplicate nonce

Replay signed request outside timestamp window
Expected: reject stale timestamp

Change body after signing
Expected: reject body digest mismatch

Reorder query params
Expected: either valid only if canonicalization specifies sorting, or rejected consistently
```

---

## 19. Attack Class 15 — API Key Leakage and Over-Scope

### 19.1 Scenario

API key leaks from:

- Git repository;
- mobile app binary;
- browser JavaScript;
- logs;
- error reports;
- CI/CD variable exposure;
- partner mismanagement.

### 19.2 Over-Scope Failure

Bad:

```text
One API key can access all tenants and all operations.
```

Better:

```text
API key scoped to:
  tenant
  client
  environment
  allowed APIs
  allowed methods/actions
  rate limit policy
  expiry/rotation policy
```

### 19.3 Simulation

```text
Use tenant A key on tenant B resource
Expected: reject

Use read-only key for write operation
Expected: reject

Use revoked key
Expected: reject

Use key in wrong environment
Expected: reject
```

### 19.4 Detection

```text
impossible travel
unusual IP/ASN
sudden volume spike
new endpoint access pattern
repeated authorization failures
key used after rotation
```

---

## 20. Attack Class 16 — mTLS Certificate Mapping Failure

### 20.1 Scenario

TLS client certificate is valid, but application maps it incorrectly to a principal.

Bad:

```text
CN=payment-service → service identity
```

Issues:

- CN may be deprecated in favor of SAN;
- multiple certs may share naming patterns;
- certificate may be issued by trusted CA but not intended for this application;
- gateway may terminate TLS and forward untrusted headers.

### 20.2 Defensive Pattern

Validate:

```text
certificate chain
trusted CA
validity period
SAN / SPIFFE ID / expected identity field
certificate policy if applicable
revocation strategy
service registry binding
tenant/environment binding
```

### 20.3 Header Forwarding Risk

If mTLS terminates at gateway:

```text
Gateway validates cert → forwards X-Client-Cert / X-Client-Identity
```

Backend must only trust those headers if:

```text
request comes from trusted gateway path
headers are stripped from external traffic
gateway signs/integrity-protects identity headers or network boundary is strong
backend is not directly reachable
```

### 20.4 Simulation

```text
Valid cert from untrusted CA
Expected: reject

Valid cert from trusted CA but wrong SAN
Expected: reject

Direct backend request with fake X-Client-Identity
Expected: reject

Expired client cert
Expected: reject
```

---

## 21. Attack Class 17 — Gateway Bypass

### 21.1 Scenario

Authentication is enforced at gateway only. Backend services assume all traffic passed through gateway.

Attacker or internal compromised workload calls backend directly.

### 21.2 Root Cause

The backend trusts topology instead of verifying identity.

### 21.3 Defensive Pattern

```text
Edge authentication:
  validate external user/client

Internal authentication:
  validate gateway/service identity

Business authorization:
  validate actor rights for operation/object
```

Gateway and backend must both enforce appropriate layers.

### 21.4 Simulation

```text
Call backend directly without gateway identity
Expected: reject

Call backend directly with fake user headers
Expected: reject

Call backend with valid service identity but missing user context where required
Expected: reject or treat as system actor only
```

---

## 22. Attack Class 18 — Confused Deputy

### 22.1 Scenario

A privileged service is tricked into using its authority on behalf of an unprivileged caller.

Example:

```text
User calls Report Service.
Report Service calls Document Service using service token.
Document Service sees Report Service authority and returns document user should not access.
```

### 22.2 Root Cause

Downstream service authorizes only the calling service, not the original actor and requested resource.

### 22.3 Defensive Pattern

Use explicit actor model:

```text
technical caller = report-service
business actor = user-123
act mode = delegated
requested object = document-789
policy = user-123 must be allowed to read document-789
```

### 22.4 Token Exchange Pattern

OAuth token exchange can represent delegation or impersonation more explicitly than blindly forwarding a user token or using only service credentials.

### 22.5 Simulation

```text
User without document access asks privileged service to fetch document
Expected: downstream policy denies

Service token without user context calls user-scoped endpoint
Expected: reject or system-only operation
```

---

## 23. Attack Class 19 — MFA Downgrade and Recovery Bypass

### 23.1 Scenario

System requires MFA during normal login, but attacker uses weaker recovery path.

Examples:

```text
MFA login required
but password reset logs user in directly

MFA required for admin console
but API token creation endpoint does not require step-up

Web UI requires step-up
but REST endpoint allows same action with old session
```

### 23.2 Root Cause

MFA is implemented as a UI flow, not an assurance policy.

### 23.3 Defensive Pattern

Model authentication assurance in security context.

```text
actor_id=user-123
auth_methods=[password, webauthn]
auth_time=2026-06-19T10:00:00Z
acr=high
amr=[pwd, hwk]
```

Then enforce:

```text
change password → require recent auth
change MFA → require high assurance
create API key → require step-up
admin action → require high assurance
recovery → does not automatically satisfy high assurance
```

### 23.4 Simulation

```text
Perform admin action after password-only login
Expected: step-up required

Perform MFA reset through email-only recovery
Expected: additional checks / delayed effect / notification

Call API endpoint directly without step-up
Expected: reject
```

---

## 24. Attack Class 20 — Logout and Revocation Race

### 24.1 Scenario

User logs out, but token/session remains usable.

Common causes:

```text
JWT remains valid until expiry
refresh token not revoked
session invalidated on one node only
browser still has cookie
IdP session still active
back-channel logout failed
resource server cache still marks token active
```

### 24.2 Define Logout Semantics

Logout can mean many things:

```text
local app session logout
IdP session logout
all devices logout
refresh token revocation
access token invalidation
federated logout
browser cookie cleanup
```

A production system must document which one it implements.

### 24.3 Simulation

```text
Logout local session
Use old session cookie
Expected: reject

Logout local session
Use old access token
Expected: depends on documented token expiry/revocation model

Revoke refresh token
Try refresh
Expected: reject

Back-channel logout event arrives twice
Expected: idempotent success
```

### 24.4 Incident-Oriented Design

For normal logout, short-lived access token may be acceptable. For suspected compromise, stronger revocation may be required:

```text
revoke refresh token family
invalidate all sessions
add access token jti to deny-list until expiry
force password reset / MFA reset if needed
notify user/security
```

---

## 25. Attack Class 21 — ThreadLocal / Async Context Leakage

### 25.1 Scenario

Authentication context stored in `ThreadLocal` leaks across reused threads or is lost in async execution.

Bad outcomes:

```text
request B sees request A's user
async task runs without identity
background job accidentally uses last request's context
Reactor pipeline loses security context
```

### 25.2 Java/Spring Context

Spring Security’s servlet model historically uses `SecurityContextHolder`, commonly backed by `ThreadLocal`. This is safe only if context is cleared and propagated intentionally.

### 25.3 Failure Pattern

Bad:

```java
executor.submit(() -> {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    doWork(auth);
});
```

The child task may not see the parent context, or worse, may see stale context depending on propagation strategy.

### 25.4 Defensive Pattern

Prefer explicit context passing for business-critical identity.

```java
record ActorContext(
    String actorId,
    String tenantId,
    String sessionId,
    String authMethod,
    Instant authTime
) {}
```

Then pass:

```java
executor.submit(() -> service.doWork(actorContext, command));
```

Framework context can support request-level behavior, but domain logic should not blindly depend on ambient context.

### 25.5 Simulation

```text
Run concurrent requests with different users through same executor
Expected: no cross-user identity leakage

Start async task after request completes
Expected: identity explicitly captured or absent by design

Reactive pipeline switches scheduler
Expected: security context available only through Reactor context, not ThreadLocal assumptions
```

---

## 26. Attack Class 22 — Message Identity Forgery

### 26.1 Scenario

Producer sends message with user metadata:

```json
{
  "actorId": "admin",
  "action": "APPROVE_CASE",
  "caseId": "C-123"
}
```

Consumer trusts message metadata without verifying producer identity, signature, schema, authorization, or source topic.

### 26.2 Root Cause

Message metadata is treated as truth instead of claim.

### 26.3 Defensive Pattern

For event-driven systems:

```text
broker authenticates producer
producer identity is authorized to topic/exchange
message schema defines actor fields
consumer validates trusted producer/source
high-risk command messages are signed or stored with server-side command record
consumer re-checks authorization where needed
message ID prevents replay/idempotency issues
```

### 26.4 Simulation

```text
Unauthorized producer publishes command message
Expected: broker rejects or consumer rejects

Authorized producer sends actorId inconsistent with authenticated producer context
Expected: reject / quarantine / audit anomaly

Replay old command message
Expected: idempotency/replay protection prevents duplicate action
```

---

## 27. Attack Class 23 — Tenant Confusion

### 27.1 Scenario

Token for one tenant is accepted in another tenant context.

```text
GET /tenant/billing-agency/cases/123
Authorization: Bearer token_from_real_estate_agency
```

### 27.2 Root Cause

The app authenticates the user but does not bind authentication to tenant context.

### 27.3 Defensive Pattern

```text
Route tenant
+ Token issuer
+ Token tenant claim
+ User membership
+ Client registration
+ Data partition
must all agree.
```

### 27.4 Simulation

```text
Valid token from tenant A on tenant B URL
Expected: reject

Valid user who belongs to tenant A and B but active tenant A accesses tenant B data without switch
Expected: reject or require tenant switch

Admin token from provider realm accesses tenant realm resource
Expected: only if explicit admin delegation policy exists
```

---

## 28. Attack Class 24 — Authorization Hidden Behind Authentication

### 28.1 Scenario

Team says:

```text
"Endpoint is protected."
```

Meaning:

```text
"User must be logged in."
```

But the actual risk is object-level authorization.

Example:

```text
GET /cases/{caseId}
```

Authentication answers:

```text
Who are you?
```

Authorization answers:

```text
May you access this case?
```

### 28.2 Why It Belongs in Authentication Failure Modeling

Authentication identity is the input to authorization. If authentication identity is weak, ambiguous, or incorrectly propagated, authorization fails too.

OWASP API Security 2023 ranks Broken Object Level Authorization as a top API security risk, emphasizing that object-level checks must exist wherever user-supplied object identifiers are used.

### 28.3 Simulation

```text
User A token reads User B object ID
Expected: reject

Service token reads user object without delegated actor
Expected: reject unless system operation policy allows

Admin token reads tenant object across tenant boundary
Expected: require explicit cross-tenant admin policy and audit reason
```

---

## 29. Building an Authentication Attack Simulation Matrix

For each authentication mechanism, create a matrix.

### 29.1 Session Auth Matrix

| Mutation | Expected Result |
|---|---|
| No cookie | 401 / redirect login |
| Invalid cookie | 401 / new anonymous session |
| Expired session | 401 / timeout flow |
| Pre-login session reused after login | session ID rotated |
| Cookie after logout | rejected |
| POST without CSRF token | rejected |
| Cookie from different device/IP | risk policy applied |

### 29.2 JWT Matrix

| Mutation | Expected Result |
|---|---|
| Bad signature | reject |
| Unknown `kid` | reject, maybe refresh JWKS once |
| Wrong issuer | reject |
| Wrong audience | reject |
| Expired token | reject |
| Future `nbf` | reject with clock skew tolerance |
| Unsupported algorithm | reject |
| ID token used as access token | reject |
| Tenant mismatch | reject |

### 29.3 OAuth/OIDC Matrix

| Mutation | Expected Result |
|---|---|
| Callback missing state | reject |
| Wrong state | reject |
| Reused authorization code | reject |
| Wrong PKCE verifier | reject |
| ID Token nonce mismatch | reject |
| Wrong issuer | reject |
| Wrong client ID/audience | reject |
| Open redirect return URL | reject/default |

### 29.4 SAML Matrix

| Mutation | Expected Result |
|---|---|
| Unsigned assertion | reject |
| Wrong audience | reject |
| Expired assertion | reject |
| Replay assertion ID | reject |
| Signature wrapping payload | reject |
| Wrong destination/recipient | reject |
| Unexpected IdP issuer | reject |

### 29.5 HMAC Matrix

| Mutation | Expected Result |
|---|---|
| Wrong signature | reject |
| Old timestamp | reject |
| Duplicate nonce | reject |
| Body changed after signing | reject |
| Header canonicalization mismatch | reject consistently |
| Unknown key ID | reject |
| Revoked key | reject |

### 29.6 mTLS Matrix

| Mutation | Expected Result |
|---|---|
| No client cert | reject if required |
| Expired cert | reject |
| Wrong CA | reject |
| Wrong SAN/service identity | reject |
| Revoked cert | reject according to policy |
| Fake identity header bypassing gateway | reject |

### 29.7 Messaging Matrix

| Mutation | Expected Result |
|---|---|
| Unauthorized producer | broker rejects |
| Wrong topic permission | broker rejects |
| Forged actor metadata | consumer rejects or flags |
| Replayed command | idempotency prevents duplicate |
| Poison message | quarantine/dead-letter |
| Missing correlation ID | reject or generate with degraded audit flag |

---

## 30. Java Test Harness Patterns

### 30.1 Security Regression Tests

Authentication failure modes should be automated. Do not rely only on manual penetration testing.

Test layers:

```text
unit tests
integration tests
contract tests
negative protocol tests
browser/security tests
chaos/failure tests
```

### 30.2 Spring MockMvc Example: Session Fixation

```java
@Test
void loginShouldRotateSessionId() throws Exception {
    MvcResult anonymous = mockMvc.perform(get("/login"))
        .andReturn();

    MockHttpSession oldSession = (MockHttpSession) anonymous.getRequest().getSession(false);
    String oldId = oldSession.getId();

    MvcResult loggedIn = mockMvc.perform(post("/login")
            .session(oldSession)
            .param("username", "alice")
            .param("password", "correct-password")
            .with(csrf()))
        .andExpect(status().is3xxRedirection())
        .andReturn();

    MockHttpSession newSession = (MockHttpSession) loggedIn.getRequest().getSession(false);
    assertNotEquals(oldId, newSession.getId());
}
```

The exact shape depends on your Spring Security version and test setup, but the invariant is stable.

### 30.3 JWT Negative Test Pattern

```java
@ParameterizedTest
@MethodSource("invalidTokens")
void resourceServerRejectsInvalidTokens(String token) throws Exception {
    mockMvc.perform(get("/api/cases")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isUnauthorized());
}
```

Invalid token cases should include:

```text
wrong issuer
wrong audience
expired
bad signature
unsupported algorithm
wrong tenant
ID token instead of access token
```

### 30.4 OIDC Callback Test Pattern

```java
@Test
void callbackWithWrongStateShouldBeRejected() {
    // Arrange: create auth request with state=S1
    // Act: send callback with state=S2
    // Assert: client rejects callback and does not create session
}
```

### 30.5 HMAC Replay Test Pattern

```java
@Test
void duplicateNonceShouldBeRejected() {
    SignedRequest request = signer.sign(command, now, "nonce-123");

    assertThat(verifier.verify(request)).isTrue();
    assertThat(verifier.verify(request)).isFalse();
}
```

### 30.6 Async Context Isolation Test

```java
@Test
void securityContextMustNotLeakBetweenTasks() throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(1);

    Callable<String> taskA = withSecurityContext("user-A", () -> currentUser());
    Callable<String> taskB = () -> currentUserOrAnonymous();

    assertEquals("user-A", pool.submit(taskA).get());
    assertEquals("anonymous", pool.submit(taskB).get());
}
```

The real test depends on how your application stores context. The goal is to detect stale context reuse.

---

## 31. Observability for Authentication Attacks

Security controls without telemetry create invisible failures.

### 31.1 Events to Emit

```text
LOGIN_ATTEMPT
LOGIN_SUCCESS
LOGIN_FAILURE
MFA_CHALLENGE
MFA_SUCCESS
MFA_FAILURE
SESSION_CREATED
SESSION_ROTATED
SESSION_EXPIRED
SESSION_INVALIDATED
TOKEN_ISSUED
TOKEN_REFRESHED
TOKEN_REVOKED
TOKEN_REUSE_DETECTED
JWT_VALIDATION_FAILURE
OIDC_CALLBACK_FAILURE
SAML_ASSERTION_REJECTED
API_KEY_USED
API_KEY_REVOKED
HMAC_REPLAY_DETECTED
MTLS_CERT_REJECTED
TENANT_MISMATCH
GATEWAY_BYPASS_ATTEMPT
```

### 31.2 Fields

```text
event_type
actor_id if known
external_subject
issuer
tenant_id
client_id
session_id_hash
token_jti_hash
api_key_id
authentication_method
authentication_assurance
ip
user_agent
service_name
correlation_id
request_id
failure_reason_internal
public_result
risk_score
```

Never log raw secrets:

```text
password
session cookie
access token
refresh token
API key
HMAC secret
private key
full SAML assertion if sensitive
```

### 31.3 Detection Rules

Examples:

```text
High failed login rate for one account
High failed login rate from one IP
JWT invalid audience spike
Unknown kid spike
Refresh token reuse detected
Tenant mismatch repeated
API key used from new ASN/country
HMAC replay detected
SAML assertion replay detected
mTLS cert expired spike
Gateway bypass attempt
```

---

## 32. Incident Response Playbooks

### 32.1 Stolen Session Cookie

Actions:

```text
invalidate session
rotate session store secret if systemic
force step-up for suspicious sessions
review XSS/logging/vector
notify user if impact threshold met
preserve audit evidence
```

### 32.2 Stolen Refresh Token

Actions:

```text
revoke token family
invalidate device grant
force re-authentication
check reuse logs
review client storage
notify affected user/client
```

### 32.3 Leaked API Key

Actions:

```text
revoke key
issue replacement key
identify scope and usage window
search logs for key ID usage
check abnormal operations
rotate related downstream secrets if needed
notify owner/partner
```

### 32.4 Compromised Signing Key

Actions:

```text
remove key from JWKS / metadata
publish emergency key rotation
reject tokens signed by compromised kid
shorten cache TTL / force config refresh
reissue tokens
review key custody and CI/CD exposure
notify relying parties
```

### 32.5 IdP Misconfiguration

Actions:

```text
disable affected client/realm
freeze new logins if severe
review redirect URI/client secret/claim mapping
invalidate affected sessions/tokens
re-run federation tests
communicate with dependent applications
```

---

## 33. Design Review Checklist

Use this checklist before approving authentication design.

### 33.1 Identity

- What is the canonical internal actor ID?
- Are external subjects stored with issuer and tenant?
- Are emails/display names treated as mutable attributes?
- Is service identity separated from user identity?
- Is delegated identity represented explicitly?

### 33.2 Token/Session

- Is issuer validated?
- Is audience validated?
- Is token type validated?
- Is expiry bounded?
- Is revocation behavior documented?
- Is logout behavior documented?
- Are refresh tokens rotated or sender-constrained?
- Are sessions rotated after login/step-up?

### 33.3 Federation

- Is `state` validated?
- Is `nonce` validated for OIDC?
- Are redirect URIs strict?
- Is issuer bound to tenant/client?
- Are SAML assertion conditions validated?
- Is replay cache implemented for SAML/OIDC where needed?

### 33.4 Browser

- Are cookies `HttpOnly`, `Secure`, and `SameSite`?
- Is CSRF protection enabled for cookie-authenticated unsafe requests?
- Are state-changing GET endpoints prohibited?
- Is open redirect blocked?

### 33.5 Distributed Systems

- Can backend be reached without gateway?
- Does backend validate internal caller identity?
- Is user context propagated explicitly?
- Is token relay/exchange policy defined?
- Are service tokens prevented from acting as users unintentionally?

### 33.6 Messaging

- Does broker authenticate producers/consumers?
- Are topic/exchange permissions least-privilege?
- Is actor metadata trusted only from trusted producers?
- Are commands idempotent?
- Is replay detected?

### 33.7 Operations

- Are auth failures observable?
- Are security events privacy-safe?
- Are incident playbooks defined?
- Are key rotations tested?
- Are outage modes fail-closed by default?
- Are caches bounded and invalidation-aware?

---

## 34. Practical Design Exercise

Imagine a Java regulatory case-management platform with:

```text
SPA frontend
Spring Boot BFF
OIDC login via external IdP
internal microservices
Kafka/RabbitMQ events
admin users
agency tenants
audit requirements
```

Attack simulation questions:

1. Can a token from tenant A access tenant B route?
2. Can an ID Token be used against resource APIs?
3. Does BFF rotate session after login and step-up?
4. Does logout revoke refresh token or only local session?
5. Can internal services be reached without gateway?
6. If reached directly, do they trust user headers?
7. Can a service token fetch user-scoped data without delegated actor?
8. Can Kafka producer forge `actorId`?
9. Can old command messages be replayed?
10. Can admin action be performed after password-only login?
11. Are OAuth callback `state` and OIDC `nonce` validated?
12. Are open redirects impossible after login?
13. Is key rotation tested with old/new `kid` overlap?
14. Does JWT validation reject wrong `aud`?
15. Can audit reconstruct original user, service, tenant, session, and request?

A strong architecture has explicit answers and tests for all of these.

---

## 35. Common Anti-Patterns

### 35.1 “Valid Signature Means Authenticated”

Wrong. Signature is only one validation. You still need issuer, audience, expiry, type, tenant, and semantic claim validation.

### 35.2 “Internal Network Is Trusted”

Wrong. Internal network reduces exposure but does not replace authentication.

### 35.3 “MFA Is Implemented Because Login Has OTP”

Wrong. MFA must be tied to assurance policy and high-risk operations, not only login UI.

### 35.4 “Logout Revokes JWT”

Not necessarily. Stateless JWT remains valid until expiry unless deny-list/introspection/key revocation changes behavior.

### 35.5 “Gateway Auth Is Enough”

Not if backend can be reached directly, if headers can be spoofed, or if service-to-service identity matters.

### 35.6 “Audit Logs Show Username, So We Are Fine”

Wrong. Usernames/emails/display names can change. Audit needs stable actor ID and context.

### 35.7 “We Use OAuth, So Authentication Is Solved”

OAuth is primarily delegated authorization. OIDC adds authentication. Both still require correct validation and integration.

### 35.8 “CSRF Does Not Matter for APIs”

It depends on credential transport. Cookie-authenticated APIs still need CSRF protection.

### 35.9 “API Key Is Simple”

API key is still a credential. It needs storage, hashing, scope, rotation, revocation, detection, and audit.

### 35.10 “Async Processing Does Not Need User Identity”

Sometimes true, sometimes false. The design must distinguish system actor, original user, delegated actor, and audit actor.

---

## 36. Production-Grade Authentication Failure Model Template

Use this template for every authentication design.

```text
Authentication mechanism:
  Session / JWT / OIDC / SAML / API Key / HMAC / mTLS / LDAP / Kerberos / WebAuthn / Broker Auth

Protected boundary:
  What boundary does this mechanism protect?

Trust anchor:
  Password hash / signing key / CA / IdP / broker / directory / HSM / KMS

Established principal:
  User / service / client / device / tenant / delegated actor

Proof type:
  Bearer / proof-of-possession / challenge-response / shared secret / federated assertion

Validation rules:
  Signature / issuer / audience / expiry / nonce / state / scope / tenant / cert chain / replay

State model:
  Stateless / server-side session / introspected / cached / distributed

Revocation model:
  Immediate / bounded by TTL / deny-list / introspection / token family / key rotation

Replay defense:
  Nonce / timestamp / one-time code / jti / assertion ID / idempotency key

Context propagation:
  ThreadLocal / Reactor context / explicit actor context / message metadata / token exchange

Failure modes:
  List top 10 realistic failures

Detection:
  Events, metrics, alerts

Response:
  Operational playbook

Tests:
  Automated negative test matrix
```

---

## 37. Summary

Authentication failure modeling is the discipline of proving that identity establishment remains correct under adversarial conditions.

The most important lessons:

1. Authentication fails at boundaries, not only at login forms.
2. Signature validation is not the same as token validation.
3. Session cookies and bearer tokens are replayable unless constrained or short-lived.
4. OAuth/OIDC/SAML require strict state, nonce, issuer, audience, and replay validation.
5. MFA must be modeled as assurance, not a UI step.
6. Microservices need both user context and service identity.
7. Message-driven systems need producer identity, actor semantics, and replay protection.
8. ThreadLocal and async execution can lose or leak authentication context.
9. Logout and revocation must have documented semantics.
10. Audit must reconstruct identity, method, tenant, session/token, service path, and delegation.

A top 1% engineer does not merely ask whether authentication works. They ask:

```text
What can an attacker replay?
What can be substituted?
What boundary can be bypassed?
What identity can be confused?
What state can race?
What context can leak?
What revocation can fail?
What audit cannot prove?
```

If the system has explicit invariants, negative tests, telemetry, and incident playbooks for those questions, authentication design becomes defensible.

---

## 38. References

- OWASP Authentication Cheat Sheet
- OWASP Session Management Cheat Sheet
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet
- OWASP API Security Top 10 2023
- OWASP SAML Security Cheat Sheet
- RFC 9700 — OAuth 2.0 Security Best Current Practice
- RFC 6749 — OAuth 2.0 Authorization Framework
- RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients
- RFC 7662 — OAuth 2.0 Token Introspection
- RFC 7009 — OAuth 2.0 Token Revocation
- RFC 8693 — OAuth 2.0 Token Exchange
- RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens
- RFC 7519 — JSON Web Token
- RFC 8725 — JSON Web Token Best Current Practices
- OpenID Connect Core 1.0
- Spring Security Reference — Servlet Authentication Architecture, CSRF, OAuth2 Resource Server, Session Management
- Jakarta Security / Servlet references

---

## 39. Series Status

- Part 0–29 completed.
- This is not the final part.
- Next part: **Part 30 — Observability, Audit, and Forensics for Authentication**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-028.md">⬅️ Part 28 — Authentication for Messaging, Jobs, and Event-Driven Java Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-030.md">Part 30 — Observability, Audit, and Forensics for Authentication ➡️</a>
</div>
