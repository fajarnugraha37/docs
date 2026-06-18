# Part 33 — Failure Modelling: How Jakarta Security Systems Actually Break

> Series: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-33-failure-modelling-how-security-breaks.md`  
> Scope: Java 8–25, Java EE `javax.*`, Jakarta EE `jakarta.*`, Jakarta Security, Jakarta Authentication/JASPIC, Jakarta Authorization/JACC, Servlet, JAX-RS, CDI/EJB, OIDC/OAuth2/SAML/mTLS, enterprise workflow/case-management systems.

---

## 0. Why This Part Exists

Most security learning is presented as a list of mechanisms:

- use OIDC,
- validate JWT,
- use `@RolesAllowed`,
- set `HttpOnly`,
- use HTTPS,
- configure CORS,
- enable audit logs.

That is necessary, but not enough.

A senior/top-level engineer must be able to answer a harder question:

> **How will this security design fail in production?**

Security systems rarely fail because one annotation is missing in isolation. They fail because of boundary mismatch:

- the gateway authenticates something the application does not understand,
- the token is valid but for the wrong audience,
- the user logged out but the local session remained active,
- the role was removed in the IdP but cached in the application,
- a scheduled job runs with excessive authority,
- a workflow approval checks permission before the state changes but not during commit,
- tenant ID is taken from request parameter instead of trusted context,
- async code loses the caller identity,
- a fallback path bypasses the main security filter,
- an error handler converts authorization failure into success,
- audit logs exist but cannot reconstruct who did what.

This part teaches a systematic way to model these failures.

---

## 1. Core Mental Model: Security Failure Is Usually Boundary Failure

In Jakarta/enterprise Java, security decisions cross many boundaries:

```text
Browser / API client
   ↓
CDN / WAF / reverse proxy / gateway
   ↓
TLS / mTLS termination
   ↓
Servlet container
   ↓
Jakarta Security authentication mechanism
   ↓
IdentityStore / IdP / token validator
   ↓
Jakarta Authorization / container policy
   ↓
JAX-RS / Servlet / CDI / EJB method boundary
   ↓
Domain authorization service
   ↓
Repository / database / message broker / downstream service
   ↓
Audit / monitoring / incident response
```

Every arrow is a potential mismatch.

A good failure model asks:

1. What does this layer believe?
2. Where did that belief come from?
3. Can the previous layer be spoofed, bypassed, stale, or misconfigured?
4. Is the next layer enforcing the same assumption?
5. What happens if this layer fails open?
6. Can audit reconstruct the decision later?

---

## 2. Failure Modelling Vocabulary

### 2.1 Asset

Something valuable that must be protected.

Examples:

- case record,
- document,
- user account,
- admin endpoint,
- token signing key,
- session cookie,
- audit trail,
- approval action,
- tenant data boundary.

### 2.2 Actor

The entity trying to perform an action.

Examples:

- external applicant,
- officer,
- supervisor,
- system job,
- support admin,
- integration client,
- compromised browser,
- malicious internal service,
- stale session holder.

### 2.3 Action

The operation being attempted.

Examples:

- view case,
- approve case,
- assign officer,
- export report,
- update role mapping,
- call internal API,
- refresh token,
- submit appeal.

### 2.4 Trust Boundary

A point where data or identity changes trust level.

Examples:

- browser to gateway,
- gateway to application,
- application to IdP,
- application to database,
- synchronous request to async worker,
- local service to remote service,
- user identity to system identity.

### 2.5 Security Invariant

A rule that must always be true.

Examples:

```text
A user must never access another tenant's case unless explicit cross-tenant authority exists.
```

```text
A case approver must not be the same person who prepared the case.
```

```text
A bearer token must only be accepted if issuer, audience, expiry, signature, and intended use are valid.
```

```text
A role removed from the IdP must stop granting access within the allowed revocation window.
```

### 2.6 Failure Mode

A way the invariant can be broken.

Example:

```text
Tenant ID comes from request body and is not compared with authenticated tenant membership.
```

### 2.7 Blast Radius

How much damage happens when the failure occurs.

Examples:

- one request,
- one user,
- one tenant,
- all tenants,
- all admin operations,
- full data exfiltration,
- irreversible business action.

---

## 3. A Practical Failure Modelling Template

For every security-critical flow, write this table.

```text
Flow: <name>
Asset: <what is protected>
Actor: <who is acting>
Action: <what they do>
Trusted identity source: <where identity comes from>
Authorization source: <where permission comes from>
Enforcement points: <where checked>
State dependencies: <case state / tenant / ownership / assignment>
Cache dependencies: <session / token / role cache / policy cache>
Failure modes: <how it breaks>
Detection: <what log/audit/metric detects it>
Containment: <how to limit impact>
Recovery: <how to revoke/fix/replay/reconcile>
Regression tests: <how to prevent recurrence>
```

Example:

```text
Flow: Approve case
Asset: Case approval state
Actor: Officer/Supervisor
Action: APPROVE_CASE
Trusted identity source: Jakarta Security SecurityContext from OIDC login
Authorization source: domain permission service + case assignment + SoD rule
Enforcement points: REST endpoint + service method + transactional state transition
State dependencies: case.status == PENDING_APPROVAL, actor != preparer
Cache dependencies: session roles, case assignment cache
Failure modes:
  - role is valid but actor is not assigned
  - case state changes after permission check
  - preparer obtains supervisor role and approves own case
  - async approval worker uses system identity without original actor
Detection:
  - audit event with actor, caseId, previousState, nextState, decision inputs
Containment:
  - transactional compare-and-update
  - SoD constraint at service layer
  - denial logged with correlation ID
Recovery:
  - reverse transition only through controlled remediation workflow
Regression tests:
  - approve own case denied
  - stale state update denied
  - unassigned supervisor denied
```

---

## 4. Failure Category 1 — Authentication Bypass

Authentication bypass means the system accepts a caller as authenticated when it should not.

### 4.1 Common Causes

1. Public path accidentally exposes secured endpoint.
2. Security filter does not apply to rewritten path.
3. Gateway validates identity but backend trusts spoofable headers.
4. Custom authentication mechanism returns success without establishing principal correctly.
5. Error path skips authentication.
6. CORS preflight handling accidentally allows real request path unauthenticated.
7. Static resource pattern overlaps with API path.
8. Health/debug/admin endpoint deployed under public context.
9. Multiple authentication mechanisms conflict and weaker mechanism wins.
10. Migration from `javax.*` to `jakarta.*` silently disables annotations/interceptors.

### 4.2 Jakarta-Specific Example

Bad pattern:

```java
@WebFilter("/*")
public class AuthFilter implements Filter {
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest http = (HttpServletRequest) req;

        if (http.getRequestURI().startsWith("/public")) {
            chain.doFilter(req, res);
            return;
        }

        String user = http.getHeader("X-User");
        if (user != null) {
            // Dangerous: header is treated as identity without proof.
            chain.doFilter(req, res);
            return;
        }

        ((HttpServletResponse) res).sendError(401);
    }
}
```

Problem:

- `X-User` can be sent by external client unless stripped and re-created by a trusted gateway.
- The filter does not establish a container caller principal.
- `@RolesAllowed` may not work because container identity is not established.

Better model:

```text
External request headers are hostile.
Only a trusted gateway may create internal identity headers.
Backend must reject identity headers unless request came through trusted boundary.
Prefer signed internal token or app-level validation of original bearer token.
```

### 4.3 Failure Invariant

```text
No request may become authenticated solely because it contains a user-looking header.
```

### 4.4 Detection

Audit should record:

```json
{
  "eventType": "AUTHENTICATION_SUCCESS",
  "authMethod": "GATEWAY_HEADER",
  "caller": "alice",
  "sourceIp": "10.0.1.20",
  "gatewayVerified": true,
  "requestId": "..."
}
```

If `gatewayVerified` cannot be proven, the flow is weak.

### 4.5 Regression Tests

- Direct backend call with `X-User` must fail.
- Backend call from trusted network without gateway signature must fail.
- Gateway call with expired internal token must fail.
- Public endpoints must not overlap secured endpoints.

---

## 5. Failure Category 2 — Authorization Bypass

Authorization bypass means the user is authenticated but performs an action they should not perform.

### 5.1 Common Causes

1. Role check is too coarse.
2. UI hides button but backend does not enforce.
3. Endpoint checks role but not tenant/resource ownership.
4. Service method assumes controller already checked permission.
5. Repository fetches by ID without tenant predicate.
6. Domain state changes after authorization check.
7. Internal endpoint assumes caller is trusted.
8. Batch job runs with admin authority.
9. Method security bypassed by self-invocation.
10. Authorization annotation missing after refactor.

### 5.2 Bad Pattern: Role-Only Approval

```java
@RolesAllowed("SUPERVISOR")
public void approveCase(UUID caseId) {
    CaseRecord c = caseRepository.findById(caseId).orElseThrow();
    c.approve();
}
```

This answers only:

```text
Is caller a supervisor?
```

It does not answer:

```text
Is caller supervisor for this tenant?
Is caller assigned to this case?
Is case in approvable state?
Did caller prepare this case?
Is approval still valid at commit time?
```

Better:

```java
public void approveCase(UUID caseId, Actor actor) {
    CaseRecord c = caseRepository.findForUpdateByIdAndTenant(caseId, actor.activeTenant())
            .orElseThrow(NotFoundOrForbiddenException::new);

    authorization.require(actor, Action.APPROVE_CASE, c);

    c.approveBy(actor.userId());
    audit.recordApproval(actor, c);
}
```

### 5.3 Strong Authorization Tuple

```text
Decision = f(subject, action, resource, tenant, state, relationship, time, channel, risk)
```

For enterprise systems, `role` is only one input.

### 5.4 Failure Invariant

```text
No domain mutation may be authorized by role alone when resource ownership, tenant, assignment, or state matters.
```

---

## 6. Failure Category 3 — Role Mapping Drift

Role mapping drift happens when IdP groups, token claims, application roles, and domain permissions no longer mean the same thing.

### 6.1 Example

Initial mapping:

```text
IdP group: CEA_CASE_SUPERVISOR
Application role: SUPERVISOR
Domain permission: APPROVE_CASE
```

Later, IdP changes group meaning:

```text
CEA_CASE_SUPERVISOR now means read-only review supervisor.
```

But app still maps it to:

```text
APPROVE_CASE
```

Result:

```text
Users keep approval power they should not have.
```

### 6.2 Common Causes

1. Raw IdP group names hardcoded in code.
2. No versioned mapping contract.
3. No owner for mapping changes.
4. Role claim has different semantics per client/application.
5. Token contains stale group membership.
6. Environment-specific group names drift between DEV/UAT/PROD.
7. Composite roles expand unexpectedly.

### 6.3 Better Pattern

```text
External group -> normalized app role -> domain permission
```

Keep mapping explicit:

```yaml
issuer: https://idp.example.gov/realms/agency
client: aceas
version: 2026-06-01
mappings:
  - externalGroup: CEA_CASE_SUPERVISOR
    appRole: CASE_SUPERVISOR
    grants:
      - CASE_VIEW
      - CASE_REVIEW
      - CASE_APPROVE
```

### 6.4 Detection

- Daily diff IdP group membership vs app role grants.
- Alert when unknown group appears in token.
- Alert when mapped group disappears from IdP metadata.
- Audit role mapping version with every authorization decision.

Audit example:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "actor": "u123",
  "action": "CASE_APPROVE",
  "decision": "ALLOW",
  "roleMappingVersion": "2026-06-01",
  "sourceGroups": ["CEA_CASE_SUPERVISOR"],
  "appRoles": ["CASE_SUPERVISOR"]
}
```

### 6.5 Failure Invariant

```text
External identity-provider group names must not be used directly as business authorization rules.
```

---

## 7. Failure Category 4 — Token Accepted for the Wrong Purpose

A token can be valid cryptographically but invalid for this use.

### 7.1 Common Token Acceptance Bugs

1. Accepting ID token as API access token.
2. Not checking `aud`.
3. Not checking `iss`.
4. Accepting token from wrong realm/tenant.
5. Accepting expired token due to clock skew misconfiguration.
6. Accepting `alg=none` or unexpected algorithm.
7. Trusting unpinned JWKS from attacker-controlled issuer.
8. Not checking authorized party/client ID where needed.
9. Confusing user token and service token.
10. Propagating high-privilege token to downstream service unnecessarily.

### 7.2 Bad Pattern

```java
JwtClaims claims = jwtParser.parse(token);
String user = claims.getSubject();
// Missing issuer, audience, expiry, signature, alg, kid, intended-use checks.
```

### 7.3 Validation Pipeline

```text
1. Extract bearer token.
2. Decode header safely without trusting it.
3. Resolve expected issuer by route/tenant/config, not by token alone.
4. Fetch key from trusted issuer JWKS.
5. Verify signature.
6. Validate algorithm allowlist.
7. Validate expiry/not-before/issued-at with bounded clock skew.
8. Validate issuer.
9. Validate audience.
10. Validate authorized party/client where relevant.
11. Validate token type/use.
12. Map claims to local actor.
13. Apply domain authorization.
```

### 7.4 Failure Invariant

```text
A token is not accepted because it is a JWT. It is accepted only if it is a JWT from the expected issuer, for this audience, for this purpose, at this time, signed by trusted key, and mapped to a valid local actor.
```

---

## 8. Failure Category 5 — JWKS Rotation Outage

JWKS rotation failures are common in OIDC/OAuth2 deployments.

### 8.1 How It Breaks

1. IdP rotates signing key.
2. New tokens contain new `kid`.
3. Application cache still contains old JWKS.
4. App rejects all new tokens.
5. Users experience mass 401.

Or the opposite:

1. IdP removes compromised key.
2. Application caches old key too long.
3. App accepts tokens signed by key that should no longer be trusted.

### 8.2 Better JWKS Cache Behavior

```text
- Cache JWKS with TTL.
- On unknown kid, refresh JWKS once synchronously or with bounded retry.
- Keep old keys only within configured overlap window.
- Do not refresh JWKS on every request.
- Do not accept token if key remains unknown after refresh.
- Alert on unknown kid spike.
```

### 8.3 Detection

Metrics:

```text
jwt.validation.success
jwt.validation.failure.expired
jwt.validation.failure.unknown_kid
jwt.validation.failure.bad_signature
jwks.refresh.success
jwks.refresh.failure
jwks.cache.age
```

### 8.4 Failure Invariant

```text
Key rotation must not create either mass outage or unbounded trust in retired keys.
```

---

## 9. Failure Category 6 — Clock Skew and Time-Based Failure

Security depends heavily on time:

- token expiry,
- assertion validity,
- session timeout,
- certificate validity,
- password reset expiry,
- one-time code expiry,
- audit ordering,
- delegation period,
- temporary role validity.

### 9.1 Common Causes

1. App nodes have unsynchronized clocks.
2. IdP clock differs from app clock.
3. Database timestamp differs from application timestamp.
4. JVM timezone assumption differs by environment.
5. Token validation allows excessive skew.
6. Scheduled revocation job runs late.

### 9.2 Example

```text
IdP issues token at 10:00:00.
App server clock is 09:55:00.
Token has nbf = 10:00:00.
App rejects token as not yet valid.
```

Or:

```text
App allows 30-minute skew.
Expired tokens remain usable too long.
```

### 9.3 Failure Invariant

```text
Time tolerance must be large enough for normal infrastructure drift but small enough to preserve security semantics.
```

### 9.4 Practical Rule

Use bounded skew, often minutes, not tens of minutes. Monitor clock drift. Store security audit times consistently, usually UTC.

---

## 10. Failure Category 7 — Session Not Invalidated Correctly

Logout is deceptively hard.

### 10.1 Common Failure Modes

1. Local session invalidated but IdP session remains.
2. IdP session ended but local app session remains.
3. Browser cookie deleted with wrong `Path` or `Domain`.
4. Back-channel logout not implemented.
5. Front-channel logout blocked by browser policy.
6. Multiple tabs recreate session.
7. Remember-me cookie survives logout.
8. Token remains valid after session logout.
9. Cluster node still has replicated session.
10. Role removed but session still contains old roles.

### 10.2 Logout State Machine

```text
ACTIVE
  ↓ user clicks logout
LOCAL_LOGOUT_STARTED
  ↓ invalidate local session
LOCAL_SESSION_INVALIDATED
  ↓ redirect/call IdP logout
IDP_LOGOUT_REQUESTED
  ↓ complete
LOGGED_OUT
```

But failure can happen at each edge.

### 10.3 Better Audit

```json
{
  "eventType": "LOGOUT",
  "actor": "u123",
  "localSessionInvalidated": true,
  "idpLogoutRequested": true,
  "refreshTokenRevoked": true,
  "rememberMeCleared": true,
  "requestId": "..."
}
```

### 10.4 Failure Invariant

```text
After logout, no local session or remember-me credential may continue to authenticate the user.
```

For SSO systems, also define explicit semantics:

```text
Local logout does/does not terminate IdP session.
Global logout does/does not terminate sessions in other applications.
```

---

## 11. Failure Category 8 — Privilege Retained After Role Removal

This is one of the most important enterprise risks.

### 11.1 Scenario

1. Officer has `CASE_APPROVER` role.
2. IdP admin removes the role at 10:00.
3. Officer has active app session until 18:00.
4. App stores role in session at login.
5. Officer can still approve cases until session expires.

### 11.2 Design Question

What is the expected revocation SLA?

Examples:

```text
Role removal must take effect immediately.
Role removal must take effect within 5 minutes.
Role removal may take effect at next login.
```

Without explicit SLA, the system has no defensible behavior.

### 11.3 Mitigation Options

1. Short session duration.
2. Role mapping cache TTL.
3. Token introspection for sensitive actions.
4. Re-check IdP/group source for high-risk action.
5. Central session revocation registry.
6. Back-channel logout or admin-triggered logout.
7. Authorization version number in session.
8. User permission epoch.

### 11.4 Permission Epoch Pattern

Store per-user authorization version:

```text
user_authz_epoch = 42
```

Session stores epoch at login:

```text
session_authz_epoch = 41
```

On sensitive action:

```text
if session_authz_epoch < user_authz_epoch:
    force re-auth / refresh roles
```

### 11.5 Failure Invariant

```text
Privilege revocation must have an explicit maximum propagation delay.
```

---

## 12. Failure Category 9 — Async Security Context Leak or Loss

As discussed in Part 22, context propagation is a frequent source of subtle bugs.

### 12.1 Context Lost

```java
CompletableFuture.runAsync(() -> {
    // SecurityContext may not be available here.
    service.approveCase(caseId);
});
```

Result:

- action runs unauthenticated,
- action runs as system,
- audit actor is missing,
- method security is bypassed,
- tenant context is null.

### 12.2 Context Leaked

Thread pool reuses thread. A thread-local from previous request remains.

Result:

- user B executes with user A's context,
- MDC/correlation logs wrong user,
- tenant predicate uses stale tenant.

### 12.3 Better Pattern

Capture explicit actor snapshot:

```java
Actor actor = actorFactory.from(securityContext);

executor.execute(() -> {
    try (ActorScope ignored = actorContext.open(actor)) {
        service.performAsyncAction(command, actor);
    }
});
```

But do not blindly copy everything. Capture only what is needed and safe.

### 12.4 Failure Invariant

```text
Async work must never rely on accidental thread-local security context.
It must receive explicit actor/system identity and authorization semantics.
```

---

## 13. Failure Category 10 — Multi-Tenant Data Leakage

Multi-tenant leakage often looks like ordinary ID lookup.

### 13.1 Bad Pattern

```java
CaseRecord c = caseRepository.findById(caseId).orElseThrow();
```

If `caseId` is guessable or leaked, tenant boundary breaks.

### 13.2 Better Pattern

```java
CaseRecord c = caseRepository.findByIdAndTenant(caseId, actor.activeTenant())
        .orElseThrow(NotFoundOrForbiddenException::new);
```

### 13.3 Failure Sources

1. Tenant ID from request parameter.
2. Tenant ID from URL but not validated against membership.
3. Cache key missing tenant.
4. Search index missing tenant filter.
5. Export job missing tenant predicate.
6. Message event missing tenant context.
7. Admin endpoint uses unrestricted repository.
8. Report joins across tenants accidentally.
9. File/object storage path does not include tenant boundary.
10. Audit logs reveal cross-tenant data.

### 13.4 Cache Leak Example

Bad:

```text
cacheKey = caseId
```

Better:

```text
cacheKey = tenantId + ":" + caseId
```

### 13.5 Failure Invariant

```text
Every resource access must be constrained by trusted tenant context, not merely resource ID.
```

---

## 14. Failure Category 11 — Admin Endpoint Accidentally Public

Admin endpoints are often exposed during operations:

- health,
- metrics,
- config,
- debug,
- thread dump,
- heap dump,
- job trigger,
- cache clear,
- role reload,
- data repair.

### 14.1 Common Causes

1. `/admin/*` not covered by security constraint.
2. Gateway route exposes internal app path.
3. Actuator/debug endpoint added after security review.
4. Method annotation missing on admin resource.
5. Internal network assumed safe.
6. CORS allows admin endpoint from browser origin.
7. IP allowlist misconfigured behind proxy.
8. `X-Forwarded-For` trusted incorrectly.

### 14.2 Rule

```text
Operational endpoint is still application attack surface.
```

### 14.3 Minimum Controls

- authenticate,
- authorize separately from business users,
- restrict network if possible,
- audit all access,
- rate-limit destructive actions,
- require explicit confirmation for destructive operation,
- avoid exposing secrets/config dumps.

### 14.4 Failure Invariant

```text
No operational endpoint may be reachable without explicit authentication and authorization appropriate to its blast radius.
```

---

## 15. Failure Category 12 — Gateway Header Spoofing

Trusted headers are dangerous because they look convenient.

### 15.1 Example

Gateway sends:

```text
X-Authenticated-User: alice
X-Authenticated-Groups: CASE_APPROVER
```

Attacker sends direct request:

```text
X-Authenticated-User: attacker
X-Authenticated-Groups: ADMIN
```

If backend accepts it, authentication and authorization collapse.

### 15.2 Required Controls

1. Backend not publicly reachable.
2. Gateway strips inbound identity headers.
3. Gateway creates new identity headers after validation.
4. Backend validates request came from trusted gateway.
5. Prefer signed internal token over plain headers.
6. Audit identity source.

### 15.3 Failure Invariant

```text
Identity headers are trusted only if they are created by a trusted intermediary and protected against client injection.
```

---

## 16. Failure Category 13 — CORS Misunderstood as Authorization

CORS controls browser read access. It does not protect APIs from non-browser clients.

### 16.1 Bad Assumption

```text
Only our frontend origin is allowed by CORS, so API is safe.
```

Wrong.

An attacker can call API from curl, Postman, server-side script, or compromised allowed origin.

### 16.2 Real Controls

- authentication,
- authorization,
- CSRF protection for cookie-authenticated browser requests,
- token validation,
- tenant/resource checks,
- rate limiting,
- audit.

### 16.3 Failure Invariant

```text
CORS must never be treated as an authorization mechanism.
```

---

## 17. Failure Category 14 — CSRF on State-Changing Operation

CSRF is dangerous when browser automatically sends cookies.

### 17.1 Scenario

1. User logs into app with session cookie.
2. Attacker causes browser to submit POST to app.
3. Browser attaches session cookie.
4. App sees authenticated user.
5. State-changing operation succeeds.

### 17.2 Common Causes

1. No CSRF token.
2. `SameSite=None` without compensating controls.
3. GET endpoint changes state.
4. JSON endpoint accepts simple form content type.
5. CORS permits credentials too broadly.
6. Logout endpoint vulnerable to CSRF.
7. Login CSRF not considered.

### 17.3 Failure Invariant

```text
A browser-authenticated state-changing request must prove user/application intent beyond ambient cookies.
```

---

## 18. Failure Category 15 — Race Condition in Authorization

Authorization is not only about current permission. It is about permission at the moment of mutation.

### 18.1 TOCTOU

```text
TOC: Time of Check
TOU: Time of Use
```

Example:

```text
10:00:00 user checks permission to approve case
10:00:01 case is reassigned or state changes
10:00:02 user approves using stale permission result
```

### 18.2 Better Pattern

- Lock resource row.
- Re-check state inside transaction.
- Use optimistic version.
- Use compare-and-swap update.
- Put invariant in database constraint where possible.
- Audit decision inputs.

Example:

```sql
UPDATE case_record
SET status = 'APPROVED', approved_by = ?
WHERE id = ?
  AND tenant_id = ?
  AND status = 'PENDING_APPROVAL'
  AND prepared_by <> ?
  AND version = ?
```

### 18.3 Failure Invariant

```text
A domain mutation must be authorized against the same state that is mutated.
```

---

## 19. Failure Category 16 — Policy Cache Stale

Caching authorization is tempting and risky.

### 19.1 Cacheable

Usually safer to cache:

- static role mapping config,
- public JWKS keys with bounded TTL,
- read-only policy metadata,
- permission matrix version.

### 19.2 Risky to Cache

Riskier:

- user role membership,
- case assignment,
- tenant membership,
- delegation status,
- break-glass approval,
- account disabled status,
- high-risk permission result.

### 19.3 Failure Modes

1. Removed role remains in cache.
2. Changed case assignment not reflected.
3. Tenant membership revoked but still cached.
4. Policy cache differs between cluster nodes.
5. Cache invalidation event lost.
6. Cache key missing tenant/resource/action.

### 19.4 Failure Invariant

```text
Authorization cache TTL must be aligned with revocation risk and business SLA.
```

---

## 20. Failure Category 17 — Emergency Patch Becomes Permanent Bypass

Production incidents often create temporary bypasses:

```text
Disable token audience check temporarily.
Allow all users with SUPPORT role temporarily.
Skip tenant check for migration job temporarily.
Expose repair endpoint temporarily.
```

The risk is not only the bypass. The risk is that it remains.

### 20.1 Controls

1. Feature flag with expiry.
2. Break-glass approval.
3. Audit all bypass use.
4. Alert when bypass flag enabled.
5. CI check preventing permanent merge.
6. Post-incident remediation ticket.
7. Runtime startup warning.

### 20.2 Bad Pattern

```java
if (true) {
    return Decision.allow("temporary prod fix");
}
```

### 20.3 Better Pattern

```java
if (breakGlassPolicy.isEnabled("CASE_APPROVAL_BYPASS")) {
    audit.breakGlassUsed(actor, action, resource);
    return Decision.allowWithReason("BREAK_GLASS_APPROVED");
}
```

Even then, break-glass should be tightly controlled.

### 20.4 Failure Invariant

```text
Temporary bypass must have owner, expiry, audit, alert, and removal plan.
```

---

## 21. Failure Category 18 — Error Handling Turns Failure into Success

Sometimes the main security check fails correctly, but error handling hides it.

### 21.1 Examples

1. Token validation exception caught and ignored.
2. Authorization service timeout defaults to allow.
3. Null principal treated as anonymous but anonymous has broad access.
4. `Optional.empty()` from permission lookup means allow.
5. Error handler maps 403 to 200 with fallback data.
6. Gateway converts backend 401 to login HTML for API client, causing client retry loop.

### 21.2 Bad Pattern

```java
try {
    authorization.require(actor, action, resource);
} catch (Exception ex) {
    log.warn("authorization failed, continuing", ex);
}
```

### 21.3 Better Pattern

```java
try {
    authorization.require(actor, action, resource);
} catch (AuthorizationDeniedException ex) {
    audit.denied(actor, action, resource, ex.reason());
    throw ex;
} catch (Exception ex) {
    audit.authorizationError(actor, action, resource, ex);
    throw new ServiceUnavailableException("Authorization temporarily unavailable");
}
```

### 21.4 Failure Invariant

```text
Authorization uncertainty must not become authorization success.
```

---

## 22. Failure Category 19 — Audit Exists But Cannot Prove Anything

Audit failure is subtle. Logs may exist, but not answer the real question.

### 22.1 Weak Audit

```text
User approved case.
```

### 22.2 Strong Audit

```json
{
  "eventType": "CASE_APPROVED",
  "actorUserId": "u123",
  "actorSessionId": "s789",
  "onBehalfOf": null,
  "tenantId": "agency-a",
  "caseId": "case-456",
  "previousState": "PENDING_APPROVAL",
  "nextState": "APPROVED",
  "authorizationDecisionId": "authz-001",
  "policyVersion": "2026-06-01",
  "roleMappingVersion": "2026-06-01",
  "requestId": "req-abc",
  "sourceIp": "203.0.113.10",
  "userAgentHash": "...",
  "occurredAt": "2026-06-17T10:15:30Z"
}
```

### 22.3 Audit Questions

A real audit should answer:

- Who acted?
- Were they authenticated?
- What identity source was used?
- What action was attempted?
- What resource was affected?
- Which tenant/entity was involved?
- Was the action allowed or denied?
- Why was it allowed or denied?
- What policy version was used?
- What was the before/after state?
- Was the action delegated or on behalf of someone else?
- Which request/trace caused it?
- Can the record be tampered with?

### 22.4 Failure Invariant

```text
For security-critical actions, audit must reconstruct actor, action, resource, decision, state, and time.
```

---

## 23. Incident Response Model for Jakarta Security Failure

When a security failure is suspected, avoid random debugging. Use structured response.

### 23.1 Triage Questions

```text
1. What invariant may have been violated?
2. Which asset is affected?
3. Which actor/action/resource/tenant is involved?
4. Is this authentication failure, authorization failure, session failure, token failure, propagation failure, or audit failure?
5. Is the issue ongoing?
6. What is the blast radius?
7. Can we contain without destroying evidence?
8. What logs/audit events are needed immediately?
9. What credentials/tokens/sessions/keys must be revoked?
10. What regression test will prevent recurrence?
```

### 23.2 Containment Options

Depending on failure:

- disable affected endpoint,
- revoke sessions,
- rotate signing keys,
- reduce token TTL,
- disable role mapping,
- remove gateway route,
- block tenant access temporarily,
- force re-authentication,
- disable break-glass flag,
- patch authorization rule,
- deploy deny-by-default fallback.

### 23.3 Evidence Preservation

Preserve:

- audit logs,
- application logs,
- gateway logs,
- IdP logs,
- token validation errors,
- session store snapshots if allowed,
- role mapping config version,
- deployment version,
- database change history,
- message broker events,
- trace/correlation IDs.

### 23.4 Root Cause Format

```text
Invariant violated:
Impact:
First bad version:
Affected actors:
Affected resources:
Trigger:
Why existing control failed:
Why tests missed it:
Why monitoring missed it:
Containment:
Permanent fix:
Regression tests:
Audit/reporting follow-up:
```

---

## 24. Security Failure Review Checklist

Use this checklist during design review or incident review.

### 24.1 Authentication

- Is every protected endpoint covered?
- Can any path bypass authentication due to rewrite/filter/order?
- Is identity established in the container, not just custom variable?
- Are trusted headers protected from spoofing?
- Are multiple authentication mechanisms deterministic?
- Are anonymous endpoints explicitly listed?

### 24.2 Token

- Is issuer checked?
- Is audience checked?
- Is token type/use checked?
- Is expiry checked?
- Is signature checked?
- Is algorithm allowlisted?
- Is JWKS cache bounded?
- Is unknown `kid` handled safely?
- Are ID tokens rejected for API authorization?

### 24.3 Authorization

- Is authorization enforced server-side?
- Is default deny used?
- Are tenant/resource/state/relationship checked?
- Are domain mutations checked inside transaction?
- Are method security annotations actually invoked through proxy/container?
- Does repository enforce tenant predicate?
- Are internal endpoints protected?

### 24.4 Session

- Is session fixation prevented?
- Are cookie flags correct?
- Is timeout appropriate?
- Is logout complete?
- Is role revocation SLA defined?
- Is remember-me controlled?
- Is session cluster behavior tested?

### 24.5 Async/Propagation

- Is actor context explicit for async jobs?
- Are thread-locals cleared?
- Is system identity separated from user identity?
- Is on-behalf-of recorded?
- Are scheduled jobs least-privileged?

### 24.6 Multi-Tenancy

- Is tenant context trusted?
- Is tenant membership checked?
- Are cache keys tenant-scoped?
- Are search/export/report paths tenant-scoped?
- Are object storage paths tenant-safe?
- Is cross-tenant admin explicitly modelled?

### 24.7 Audit

- Are allow and deny decisions audited where needed?
- Is policy version recorded?
- Is role mapping version recorded?
- Is actor/on-behalf-of/system identity recorded?
- Is request/correlation ID recorded?
- Are logs protected from tampering?

---

## 25. Failure Modelling Exercise

For every critical feature, write at least five failure cases.

Example feature:

```text
Officer downloads case document.
```

Failure cases:

```text
1. Officer can download document from another tenant by changing documentId.
2. Officer loses role but session still allows download.
3. Document URL is pre-signed and shared externally without expiry.
4. Audit logs only documentId, not caseId/tenant/actor.
5. Search index exposes document metadata cross-tenant.
6. Gateway allows direct object storage path bypassing app authorization.
7. Async virus scan result attaches document to wrong tenant due to missing tenant context.
```

For each failure:

```text
- invariant broken,
- enforcement point,
- detection,
- containment,
- regression test.
```

---

## 26. Java 8–25 Considerations

### 26.1 Java 8

Typical constraints:

- older Java EE stacks,
- `javax.*` namespace,
- older servlet containers,
- older TLS defaults,
- no virtual threads,
- more legacy JAAS/JASPIC usage,
- older JWT/OIDC libraries in some systems.

Failure risk:

```text
Security is often split between container config, XML descriptor, filters, and custom libraries.
```

### 26.2 Java 11–17

Typical transition zone:

- stronger TLS defaults,
- modern libraries,
- many apps migrate to Jakarta or Spring Boot 3+,
- `javax`/`jakarta` split becomes operationally important.

Failure risk:

```text
Namespace migration disables security annotations/interceptors or mixes incompatible libraries.
```

### 26.3 Java 21+

New concurrency realities:

- virtual threads,
- structured concurrency concepts,
- more async/reactive designs,
- context propagation becomes more explicit.

Failure risk:

```text
Thread-local security assumptions break or become misleading.
```

### 26.4 Java 25

By Java 25-era systems, the security challenge is usually less about syntax and more about platform composition:

- Jakarta EE 11/12-era APIs,
- Spring/Jakarta interop,
- external IdP,
- token-based service mesh,
- multi-tenant SaaS/government systems,
- audit and regulatory defensibility.

Failure risk:

```text
Too many layers each assume another layer already enforced the rule.
```

---

## 27. Final Mental Model

A secure Jakarta system is not secure because it uses Jakarta Security, OIDC, JWT, mTLS, or `@RolesAllowed`.

It is secure when these invariants hold:

```text
Identity is established from a trusted source.
```

```text
Authentication result is correctly bound to container/application context.
```

```text
Authorization is enforced at every relevant boundary.
```

```text
Domain decisions include tenant, state, ownership, assignment, and relationship where relevant.
```

```text
Tokens and sessions expire, rotate, revoke, and fail safely.
```

```text
Async/background work has explicit actor/system semantics.
```

```text
Caches have bounded staleness aligned with business risk.
```

```text
Failures deny access rather than silently allowing it.
```

```text
Audit can reconstruct what happened.
```

```text
Tests prove the system denies what it must deny.
```

Security engineering at this level is not about memorizing APIs. It is about preserving invariants across layers, time, state changes, deployments, migrations, and failures.

---

## 28. References

- Jakarta Security 4.0 Specification — `HttpAuthenticationMechanism`, `SecurityContext`, identity store, and Jakarta EE 11 security API model.
- Jakarta Authorization 3.0 Specification — low-level authorization SPI based on subject and permission, including transformation of Servlet/EJB constraints into permissions.
- OWASP Authorization Cheat Sheet — deny-by-default, fail safely, and robust authorization testing.
- OWASP Logging Cheat Sheet — security event logging guidance.
- OWASP Authentication Cheat Sheet — authentication concepts and secure authentication guidance.
- RFC 6750 — OAuth 2.0 Bearer Token Usage.
- RFC 9068 — JWT Profile for OAuth 2.0 Access Tokens.
- RFC 7662 — OAuth 2.0 Token Introspection.
- OpenID Connect Core — ID token, issuer, subject, nonce, and authentication semantics.
- Jakarta Servlet Specification — web security constraints, session, request lifecycle.

---

## 29. Summary

Part 33 taught how Jakarta security systems actually break:

- authentication bypass,
- authorization bypass,
- role mapping drift,
- wrong token acceptance,
- JWKS rotation outage,
- clock skew,
- incomplete logout,
- stale privileges,
- async context leak/loss,
- multi-tenant data leakage,
- public admin endpoint,
- trusted header spoofing,
- CORS misconception,
- CSRF,
- authorization race condition,
- stale policy cache,
- permanent temporary bypass,
- fail-open error handling,
- weak audit.

The core lesson:

```text
Security architecture must be judged not by its happy path, but by how it behaves when assumptions fail.
```

Next:

```text
Part 34 — Capstone Architecture: Designing an Enterprise Jakarta Security Platform
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 32 — Production Hardening Checklist for Jakarta Security Systems](./learn-java-jakarta-security-authentication-authorization-identity-part-32-production-hardening-checklist.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 34 — Capstone Architecture: Designing an Enterprise Jakarta Security Platform](./learn-java-jakarta-security-authentication-authorization-identity-part-34-capstone-enterprise-jakarta-security-platform.md)

</div>