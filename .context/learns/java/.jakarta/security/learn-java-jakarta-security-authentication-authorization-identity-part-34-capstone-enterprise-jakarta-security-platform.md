# Part 34 — Capstone Architecture: Designing an Enterprise Jakarta Security Platform

> Series: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-34-capstone-enterprise-jakarta-security-platform.md`  
> Scope: Java 8–25, Java EE/Jakarta EE, Servlet, JAX-RS, CDI/EJB, Jakarta Security, Jakarta Authentication, Jakarta Authorization, OIDC/OAuth2/SAML-style federation, session/token, gateway, audit, domain authorization, production failure modelling.

---

## 0. Tujuan Part Ini

Part ini adalah **capstone**: kita tidak lagi membahas API satu per satu, tetapi menyusun semuanya menjadi **arsitektur security enterprise Jakarta** yang bisa dipakai untuk mendesain, mereview, menguji, mengoperasikan, dan mempertanggungjawabkan sistem nyata.

Setelah 34 part sebelumnya, target akhir bukan sekadar bisa menulis:

```java
@RolesAllowed("ADMIN")
```

atau:

```java
securityContext.isCallerInRole("CASE_OFFICER")
```

Targetnya adalah mampu menjawab pertanyaan arsitektural seperti:

1. Di mana authentication dilakukan?
2. Identity apa yang dipercaya aplikasi?
3. Dari mana role aplikasi berasal?
4. Apakah token ini benar-benar untuk API ini?
5. Apakah session masih valid setelah role user dicabut?
6. Apakah authorization decision auditable?
7. Apakah approval workflow tahan race condition?
8. Apakah gateway header bisa dipalsukan?
9. Apakah async worker membawa identity yang benar?
10. Apakah sistem fail-closed ketika IdP/JWKS/policy store bermasalah?
11. Apakah tenant isolation ditegakkan di semua path?
12. Apakah production runbook dapat menjelaskan kenapa seseorang diizinkan/ditolak melakukan aksi tertentu?

Part ini menyatukan mental model berikut:

```text
caller
  -> credential
  -> authentication mechanism
  -> authenticated identity
  -> principal/group/claim/scope
  -> normalized application role
  -> domain permission
  -> enforcement point
  -> audit event
  -> forensic evidence
```

---

## 1. Prinsip Utama Capstone

Enterprise Jakarta security platform yang baik tidak dibangun dari satu library. Ia dibangun dari beberapa kontrak yang jelas:

| Kontrak | Pertanyaan yang dijawab |
|---|---|
| Identity contract | Siapa caller ini secara stabil? |
| Authentication contract | Bagaimana caller membuktikan identity? |
| Session/token contract | Bagaimana bukti authentication dibawa antar request/service? |
| Role/group/claim mapping contract | Bagaimana atribut eksternal diterjemahkan ke bahasa aplikasi? |
| Authorization contract | Aksi apa yang boleh dilakukan terhadap resource tertentu? |
| Tenant boundary contract | Entitas/organisasi mana yang sedang aktif dan boleh diakses? |
| Enforcement contract | Di mana keputusan security benar-benar dipaksakan? |
| Audit contract | Bukti apa yang direkam untuk menjelaskan keputusan? |
| Failure contract | Jika dependency gagal, sistem deny, degrade, retry, atau bypass? |
| Operation contract | Bagaimana tim support/debug/rotate/rollback tanpa membuka celah? |

Sistem security yang rapuh biasanya gagal bukan karena tidak ada login, tetapi karena salah satu kontrak di atas tidak eksplisit.

---

## 2. Reference Architecture Besar

Bayangkan platform Jakarta enterprise dengan beberapa entry point:

1. Browser SPA untuk user internal/eksternal.
2. Server-rendered Jakarta MVC/JSF-like app.
3. Public REST API untuk partner/integrasi.
4. Internal service-to-service API.
5. Async worker dan scheduled job.
6. Admin console.
7. Audit/reporting subsystem.

Diagram konseptual:

```text
+-------------------+        +---------------------+        +----------------------+
| Browser / SPA     |        | Partner System      |        | Internal Service      |
| Cookie/BFF/OIDC   |        | OAuth2 Client       |        | mTLS + JWT/Token      |
+---------+---------+        +----------+----------+        +----------+-----------+
          |                             |                              |
          v                             v                              v
+----------------------------------------------------------------------------------+
| Edge Layer / Reverse Proxy / API Gateway / WAF / Load Balancer                    |
| - TLS termination / mTLS                                                          |
| - routing                                                                         |
| - rate limiting                                                                   |
| - optional token pre-validation                                                    |
| - forwarded header normalization                                                   |
| - request/correlation id                                                           |
+--------------------------------------+-------------------------------------------+
                                       |
                                       v
+----------------------------------------------------------------------------------+
| Jakarta Application Boundary                                                      |
|                                                                                  |
|  +----------------------+    +----------------------+    +---------------------+ |
|  | Servlet Container    |    | JAX-RS Runtime       |    | CDI/EJB Container    | |
|  | URL constraints      |    | Resource filters     |    | Method security      | |
|  | HttpSession          |    | API endpoint auth    |    | Transactions         | |
|  +----------+-----------+    +----------+-----------+    +----------+----------+ |
|             |                           |                           |            |
|             v                           v                           v            |
|  +--------------------------------------------------------------------------------+
|  | Jakarta Security / Authentication / Authorization Integration                  |
|  | - HttpAuthenticationMechanism                                                  |
|  | - IdentityStore                                                                |
|  | - SecurityContext                                                              |
|  | - Jakarta Authentication SPI / JASPIC where needed                             |
|  | - Jakarta Authorization / JACC-like provider where needed                       |
|  +--------------------------------------------------------------------------------+
|             |                           |                           |            |
|             v                           v                           v            |
|  +----------------------+    +----------------------+    +---------------------+ |
|  | Role Mapping Service |    | Domain AuthZ Service |    | Audit Service        | |
|  | groups/claims->roles |    | subject/action/res   |    | immutable events     | |
|  +----------+-----------+    +----------+-----------+    +----------+----------+ |
|             |                           |                           |            |
|             v                           v                           v            |
|  +----------------------+    +----------------------+    +---------------------+ |
|  | Business Services    |    | Repositories         |    | Outbox/Event Bus     | |
|  | Workflow/Case Logic  |    | tenant-safe queries  |    | async audit/events   | |
|  +----------------------+    +----------------------+    +---------------------+ |
+----------------------------------------------------------------------------------+
                                       |
                                       v
+-------------------+    +-------------------+    +-------------------+    +------+
| Identity Provider |    | Policy Store      |    | Database          |    | SIEM |
| OIDC/SAML/LDAP    |    | role/permission   |    | domain data       |    | SOC  |
+-------------------+    +-------------------+    +-------------------+    +------+
```

Key insight:

> Gateway boleh membantu security, tetapi aplikasi tetap harus tahu apa yang dipercaya, apa yang diverifikasi, dan apa yang hanya metadata transport.

---

## 3. Layer 1 — Edge/Gateway Boundary

### 3.1 Tanggung jawab gateway

Gateway/reverse proxy/load balancer biasanya menangani:

1. TLS termination.
2. Routing path/host.
3. WAF rule.
4. Rate limit.
5. Request size limit.
6. Header normalization.
7. Forwarded headers.
8. Optional OAuth2 token validation.
9. Optional mTLS client certificate validation.
10. Correlation/request ID injection.
11. Security response headers.

Namun gateway bukan pengganti application authorization.

Gateway tahu:

```text
request datang dari client mana
path apa yang diminta
token valid secara teknis atau tidak
sertifikat client trusted atau tidak
rate limit kena atau tidak
```

Aplikasi tahu:

```text
case ini milik tenant mana
user ini assigned officer atau bukan
state case sekarang apa
aksi approve boleh dilakukan dari state ini atau tidak
maker dan checker boleh orang yang sama atau tidak
field tertentu boleh dilihat oleh role ini atau tidak
```

Karena itu, gateway cocok untuk **coarse-grained security**, sedangkan aplikasi tetap wajib melakukan **fine-grained authorization**.

### 3.2 Trusted header rule

Jika gateway meneruskan identity lewat header seperti:

```http
X-Authenticated-User: alice
X-Authenticated-Groups: case-officer,approver
X-Tenant: agency-a
```

maka rule wajib:

```text
Aplikasi hanya boleh mempercayai header identity jika:
1. request datang dari network/proxy yang trusted,
2. gateway menghapus semua inbound identity header dari client,
3. gateway menulis ulang header identity sendiri,
4. aplikasi menolak request langsung yang melewati gateway,
5. header identity ditandatangani atau dibungkus token internal jika melewati banyak hop.
```

Anti-pattern:

```java
String user = request.getHeader("X-Authenticated-User");
// langsung dianggap authenticated user
```

Lebih aman:

```text
client request
  -> gateway validates external credential
  -> gateway issues short-lived internal signed identity token
  -> Jakarta app validates internal token issuer/audience/signature/expiry
  -> app establishes caller principal/groups
```

### 3.3 Gateway auth vs app auth

| Model | Cocok untuk | Risiko utama |
|---|---|---|
| Gateway-only auth | legacy app, centralized enterprise gateway | app percaya header tanpa cukup validasi |
| App-only auth | app punya OIDC/token validation sendiri | duplicated config, inconsistent policy |
| Hybrid | enterprise production modern | perlu kontrak jelas siapa memvalidasi apa |

Hybrid paling umum:

```text
Gateway:
- TLS/mTLS
- rate limit
- coarse route authorization
- optional token precheck
- normalize headers

Application:
- verify app session/token
- map identity
- enforce domain authorization
- audit decision
```

---

## 4. Layer 2 — Authentication Architecture

### 4.1 Jenis entry point dan mechanism

| Entry point | Recommended mechanism |
|---|---|
| Browser SPA | OIDC Authorization Code + PKCE, often BFF/session |
| Server-rendered web app | Jakarta Security OIDC/Form/Container login |
| Partner API | OAuth2 access token, JWT or introspection |
| Internal service | mTLS + OAuth2 client credentials/token exchange |
| Admin console | OIDC + MFA/step-up + strict role/domain checks |
| Scheduled job | System actor/service account, no human session |
| Async worker | propagated actor snapshot + system executor identity |

### 4.2 Authentication mechanism selection

Di Jakarta application, authentication bisa dilakukan melalui:

1. Servlet built-in authentication.
2. Jakarta Security `HttpAuthenticationMechanism`.
3. Jakarta Authentication/JASPIC `ServerAuthModule`.
4. JAX-RS `ContainerRequestFilter`.
5. Framework-specific stack seperti Spring Security.
6. Gateway/broker IdP pattern.

Decision rule:

```text
Use Jakarta Security if:
- web application runs inside Jakarta EE container,
- need standard app-facing API,
- need IdentityStore/SecurityContext integration,
- want portability across Jakarta-compatible runtimes.

Use Jakarta Authentication/JASPIC if:
- need low-level container authentication integration,
- need custom message authentication,
- need to pass principal/group into container in non-standard way.

Use JAX-RS filter if:
- specific API layer validation is needed,
- app is lightweight,
- container role integration is not required or handled manually.

Use Spring Security if:
- application is Spring Boot/Spring-centric,
- need Spring ecosystem features,
- do not mix blindly with Jakarta container security.

Use gateway IdP integration if:
- enterprise centralizes SSO at gateway,
- legacy apps cannot implement OIDC cleanly,
- must still validate trust boundary inside app.
```

### 4.3 Authentication output contract

Authentication must produce a normalized internal identity:

```java
public record AuthenticatedCaller(
    String subjectId,
    String issuer,
    String displayName,
    String email,
    Set<String> externalGroups,
    Set<String> claims,
    Set<String> scopes,
    Set<String> applicationRoles,
    Instant authenticatedAt,
    Instant credentialExpiresAt,
    AuthenticationMethod method,
    AssuranceLevel assuranceLevel
) {}
```

Do not let every service parse token/session differently.

Bad:

```java
String userId = jwt.getClaim("preferred_username");
```

Better:

```java
AuthenticatedCaller caller = callerResolver.resolve(securityContext);
```

Because stable identity is often:

```text
issuer + subject
```

not username, email, or display name.

---

## 5. Layer 3 — Session and Token Strategy

### 5.1 Browser: session vs token

For browser apps, avoid simplistic advice like “JWT is stateless therefore better”. Browser security is dominated by:

1. XSS.
2. CSRF.
3. token theft.
4. cookie configuration.
5. logout semantics.
6. session timeout.
7. SSO interaction.

Common enterprise-safe pattern:

```text
Browser SPA
  -> talks to Backend-for-Frontend using secure HttpOnly SameSite cookie
  -> BFF stores/handles OIDC tokens server-side
  -> API sees session/caller, not browser-held access token
```

Alternative:

```text
SPA stores token in memory only
  -> token used directly for API
  -> strong CSP/XSS controls required
  -> refresh token rotation required if refresh token is browser-visible
```

For highly regulated systems, BFF/session often gives better operational control.

### 5.2 API: access token validation

A resource server must validate at least:

```text
signature or introspection active status
issuer
specific audience
expiry
not-before
algorithm allowlist
key id / JWKS key
client/application identity where relevant
scope/claim contract
```

Never accept token only because signature is valid.

A valid token for another API is still invalid for this API.

### 5.3 Session lifetime model

Recommended explicit model:

| Concept | Meaning |
|---|---|
| Idle timeout | no activity for N minutes |
| Absolute timeout | session cannot exceed N hours |
| Authentication age | when user authenticated at IdP/app |
| Step-up age | when strong auth was last performed |
| Role snapshot age | when role/permission was last refreshed |
| Authorization cache TTL | how long permission evaluation can be reused |

For sensitive systems:

```text
Login session may last 60 minutes,
but approving a case may require step-up if auth age > 15 minutes.
```

### 5.4 Logout model

Logout has multiple layers:

```text
local app session logout
  != OIDC provider logout
  != token revocation
  != downstream service cache invalidation
  != browser back-button page cleanup
```

A production logout design should specify:

1. Which session is invalidated?
2. Which cookie is removed?
3. Is IdP logout called?
4. Are refresh tokens revoked?
5. Are distributed sessions removed?
6. Are authorization caches cleared?
7. Are front-channel/back-channel logout events handled?
8. What happens if IdP logout fails?
9. What audit event is written?

---

## 6. Layer 4 — Role Mapping and Permission Model

### 6.1 Do not expose IdP semantics everywhere

External identity provider might produce:

```json
{
  "iss": "https://idp.example.gov/realms/agency",
  "sub": "a9f8...",
  "preferred_username": "alice",
  "groups": ["/ACEAS/Officer", "/ACEAS/Approver"],
  "scope": "openid profile email case.read case.write"
}
```

Application should not scatter this logic everywhere:

```java
if (groups.contains("/ACEAS/Approver")) { ... }
```

Instead:

```text
IdP group/claim/scope
  -> normalized role mapping
  -> domain permission
  -> decision explanation
```

Example:

```java
public record RoleMappingInput(
    String issuer,
    String clientId,
    String tenantId,
    Set<String> groups,
    Set<String> scopes,
    Map<String, Object> claims
) {}

public record RoleMappingOutput(
    Set<ApplicationRole> roles,
    Set<String> warnings,
    Instant evaluatedAt,
    String mappingVersion
) {}
```

### 6.2 Role vs permission

Role answers:

```text
What broad capability category does this subject have?
```

Permission answers:

```text
Can this subject perform this action on this resource in this context now?
```

Example:

```text
Role: CASE_APPROVER
Permission: approve case #123 if:
- case.tenant == activeTenant
- case.state == PENDING_APPROVAL
- subject != case.submittedBy
- subject belongs to approval unit
- no conflict-of-interest flag
- approval window still open
```

### 6.3 Permission tuple

For workflow/case-management systems, a robust authorization decision usually needs:

```text
subject
actor mode
active tenant / organization
resource type
resource id
resource tenant
resource state
action
relationship
assignment
role
claim/scope
risk/assurance
request channel
time
policy version
```

Possible Java model:

```java
public record AuthorizationRequest(
    Actor actor,
    TenantId activeTenant,
    Action action,
    ResourceRef resource,
    Map<String, Object> resourceAttributes,
    RequestContext requestContext
) {}

public record AuthorizationDecision(
    boolean allowed,
    String reasonCode,
    String humanMessage,
    String policyVersion,
    List<String> evaluatedRules,
    Instant decidedAt
) {}
```

The key rule:

> Authorization service returns a decision. Business service still owns transaction, state transition, and audit.

---

## 7. Layer 5 — Domain Authorization for Workflow

### 7.1 State-machine-aware authorization

In case-management/regulatory systems, permission is state-dependent.

Example state machine:

```text
DRAFT
  -> SUBMITTED
  -> SCREENING
  -> ASSIGNED
  -> INVESTIGATION
  -> PENDING_APPROVAL
  -> APPROVED
  -> CLOSED
```

Action rules:

| Action | Allowed state | Additional rule |
|---|---|---|
| submit | DRAFT | actor owns application |
| assign | SCREENING | actor is supervisor in tenant |
| investigate | ASSIGNED/INVESTIGATION | actor is assigned officer |
| recommend | INVESTIGATION | actor is assigned officer |
| approve | PENDING_APPROVAL | actor is approver and not maker |
| close | APPROVED | actor has closure permission |
| reopen | CLOSED | actor has exceptional permission and reason |

### 7.2 Authorization inside transaction

Dangerous pattern:

```text
1. Read case state.
2. Check authorization.
3. User waits or concurrent update happens.
4. Update case.
```

Safer pattern:

```text
transaction begins
  -> SELECT case FOR UPDATE / optimistic version check
  -> evaluate authorization against locked/current state
  -> apply state transition
  -> write audit/outbox event
transaction commits
```

Pseudo-code:

```java
@Transactional
public void approveCase(CaseId caseId, ApprovalCommand command) {
    Actor actor = actorResolver.currentActor();

    CaseRecord record = caseRepository.findForUpdate(caseId)
        .orElseThrow(NotFoundException::new);

    AuthorizationDecision decision = authorizationService.decide(
        AuthorizationRequest.of(actor, Action.APPROVE_CASE, record)
    );

    if (!decision.allowed()) {
        auditService.recordDenied(actor, Action.APPROVE_CASE, record, decision);
        throw new ForbiddenException(decision.safeMessage());
    }

    record.approve(actor.userId(), command.comment());

    caseRepository.save(record);

    auditService.recordAllowed(actor, Action.APPROVE_CASE, record, decision);
    outbox.publish(new CaseApprovedEvent(caseId, actor.userId(), decision.policyVersion()));
}
```

### 7.3 Maker-checker invariant

Invariant:

```text
The same human actor must not both submit/recommend and approve the same case,
unless an explicit break-glass rule applies and is audited.
```

Implementation should not rely only on frontend disabling a button.

Database-level support can help:

```text
case_history(actor_id, action, case_id, timestamp)
case_assignment(case_id, assigned_to, role)
approval_record(case_id, approver_id, decision, policy_version)
```

Authorization rule can query history:

```java
boolean sameMaker = caseHistory.exists(caseId, actor.userId(), Action.RECOMMEND);
if (sameMaker) deny("SEGREGATION_OF_DUTIES_VIOLATION");
```

---

## 8. Layer 6 — Multi-Tenancy and Organization Boundary

### 8.1 Active tenant is not optional

If user can belong to multiple tenants:

```text
Alice belongs to Agency A and Agency B.
```

Then every request needs active tenant context:

```text
authenticated user = Alice
active tenant = Agency A
resource tenant = Agency A
```

Do not infer tenant only from user membership. The same user can legitimately access multiple organizations.

### 8.2 Tenant resolution precedence

A robust system should define exactly where tenant comes from:

1. Host/subdomain.
2. Path segment.
3. Token claim.
4. Session active tenant.
5. Header written by trusted gateway.
6. Explicit switch-organization operation.
7. Resource ownership.

Bad:

```text
Sometimes tenant from token, sometimes from URL, sometimes from request body.
```

Better:

```text
For browser session:
- tenant selected after login
- stored in server session
- every resource access checks resource.tenant == activeTenant

For API token:
- tenant claim or API client binding defines tenant scope
- request body tenant cannot expand access
```

### 8.3 Tenant-safe repository pattern

Do not let business code forget tenant filter.

Bad:

```java
caseRepository.findById(caseId);
```

Better:

```java
caseRepository.findByTenantAndId(activeTenant, caseId);
```

Even better:

```java
TenantScopedRepository tenantRepo = repositoryFactory.forTenant(activeTenant);
CaseRecord caseRecord = tenantRepo.cases().findById(caseId);
```

For sensitive systems, consider defense-in-depth:

1. application tenant filter,
2. DB row-level security where appropriate,
3. tenant-aware indexes,
4. audit event includes tenant,
5. test matrix includes cross-tenant attempts.

---

## 9. Layer 7 — Method, URL, and Domain Enforcement Combined

### 9.1 Three enforcement layers

| Layer | Example | Purpose |
|---|---|---|
| URL/API route | `/api/admin/**` requires admin | coarse perimeter |
| Method/class | `@RolesAllowed("CASE_OFFICER")` | service capability boundary |
| Domain policy | `can approve case #123 now` | business-specific decision |

They are complementary.

```text
URL route says: this API requires authenticated user.
Method annotation says: this service requires broad role.
Domain authorization says: this actor can perform this action on this exact resource now.
```

### 9.2 Recommended layering

Example for `approveCase`:

```java
@Path("/cases/{caseId}/approve")
@POST
@RolesAllowed("CASE_APPROVER")
public Response approve(@PathParam("caseId") String id, ApproveRequest request) {
    caseWorkflowService.approveCase(new CaseId(id), request.toCommand());
    return Response.noContent().build();
}
```

Inside service:

```java
@Transactional
public void approveCase(CaseId id, ApproveCommand command) {
    Actor actor = actorResolver.currentActor();
    CaseRecord record = caseRepository.findForUpdate(id).orElseThrow(NotFoundException::new);
    authorizationGuard.requireAllowed(actor, Action.APPROVE_CASE, record);
    record.approve(actor.userId(), command.comment());
    audit.recordCaseApproved(actor, record);
}
```

Do not rely only on `@RolesAllowed`, because it cannot know:

1. case state,
2. assignment,
3. tenant ownership,
4. maker-checker history,
5. delegated authority,
6. conflict-of-interest flag,
7. emergency override requirement.

---

## 10. Layer 8 — Audit and Forensic Architecture

### 10.1 Audit event as first-class domain artifact

Audit is not just log text:

```text
INFO User alice approved case 123
```

A defensible audit event should be structured:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "eventId": "01HX...",
  "timestamp": "2026-06-17T12:00:00Z",
  "correlationId": "req-abc",
  "actor": {
    "subjectId": "idp|a9f8",
    "displayName": "Alice",
    "issuer": "https://idp.example.gov/realms/agency",
    "tenantId": "agency-a",
    "actorMode": "HUMAN"
  },
  "action": "APPROVE_CASE",
  "resource": {
    "type": "CASE",
    "id": "CASE-123",
    "tenantId": "agency-a",
    "state": "PENDING_APPROVAL"
  },
  "decision": {
    "allowed": true,
    "reasonCode": "CASE_APPROVER_ASSIGNED_AND_NOT_MAKER",
    "policyVersion": "case-authz-v17"
  },
  "request": {
    "ip": "203.0.113.10",
    "userAgentHash": "...",
    "channel": "WEB"
  }
}
```

### 10.2 Audit categories

At minimum:

1. Authentication success/failure.
2. Logout/session expiration.
3. Token validation failure.
4. Role mapping result.
5. Authorization allowed/denied for sensitive action.
6. Data access to sensitive resource.
7. Admin configuration change.
8. Tenant switch.
9. Delegation creation/use/revocation.
10. Break-glass access.
11. Policy change.
12. Secret/key/certificate rotation.
13. Security exception/fail-closed event.

### 10.3 Audit consistency

For state-changing actions:

```text
business state change and audit event must be transactionally consistent.
```

Use outbox pattern:

```text
transaction:
  update case
  insert audit_outbox event
commit:
  async publisher ships event to audit pipeline/SIEM
```

This avoids:

```text
case approved but audit event missing
```

or:

```text
audit says approved but transaction rolled back
```

---

## 11. Layer 9 — Context Propagation Architecture

### 11.1 Actor model

For async and distributed systems, never rely only on current thread principal.

Represent actor explicitly:

```java
public record Actor(
    String subjectId,
    String issuer,
    TenantId tenantId,
    ActorType type,
    Optional<String> onBehalfOfSubjectId,
    Set<ApplicationRole> roles,
    String sessionId,
    String correlationId
) {}
```

Actor types:

```text
HUMAN
SYSTEM
SERVICE
DELEGATED
BREAK_GLASS
SCHEDULED_JOB
MESSAGE_CONSUMER
```

### 11.2 Async event propagation

When request creates async work:

```text
HTTP request by Alice
  -> approves case
  -> outbox event created with actor snapshot
  -> async worker sends email / updates report / calls downstream
```

Worker should not pretend Alice is currently logged in.

Better:

```text
initiator = Alice
executor = NotificationWorker service account
onBehalfOf = Alice where relevant
```

Audit should record both.

### 11.3 Avoid identity leak

Thread pools can reuse threads. Therefore:

1. Do not store user identity in static mutable field.
2. Do not forget clearing ThreadLocal.
3. Do not pass `HttpServletRequest` to async task.
4. Do not assume MDC magically resets.
5. Prefer explicit immutable actor snapshot.

---

## 12. Layer 10 — Testing Architecture

### 12.1 Security test pyramid

```text
                  attack simulation / red-team-like tests
                integration tests with real IdP/container
              API tests: 401/403/token/session/csrf/cors
            domain authorization matrix tests
          unit tests for policy functions
        static config checks / dependency scans
```

### 12.2 Must-have test categories

| Category | Example |
|---|---|
| Authentication | invalid password/token/cert denied |
| Token validation | wrong issuer/audience/expired token rejected |
| Role mapping | IdP group maps to expected application role |
| Declarative authorization | route/method denies missing role |
| Domain authorization | approver cannot approve own recommendation |
| Tenant isolation | user from tenant A cannot read tenant B case |
| Session | logout invalidates session and cookie |
| CSRF | cookie-auth POST without CSRF token denied |
| CORS | untrusted origin cannot read credentialed response |
| Gateway boundary | spoofed identity header ignored/denied |
| Async context | audit records initiator and executor correctly |
| Audit | denial and approval produce structured audit event |
| Race condition | concurrent approval cannot bypass state rule |
| Migration | `javax` to `jakarta` keeps same authorization behavior |

### 12.3 Permission matrix testing

Use table-driven tests:

```text
role, tenant, state, relationship, action, expected
CASE_OFFICER, same, ASSIGNED, assignedOfficer, INVESTIGATE, ALLOW
CASE_OFFICER, same, PENDING_APPROVAL, maker, APPROVE, DENY
CASE_APPROVER, same, PENDING_APPROVAL, notMaker, APPROVE, ALLOW
CASE_APPROVER, different, PENDING_APPROVAL, notMaker, APPROVE, DENY
```

This catches drift better than scattered hand-written tests.

---

## 13. Layer 11 — Operational Runbook

A platform is not production-ready if only developers understand it.

### 13.1 Login failure runbook

Questions:

1. Is IdP reachable?
2. Did discovery endpoint change?
3. Is redirect URI correct?
4. Is client secret expired/rotated?
5. Is clock skew causing token rejection?
6. Is state/nonce mismatch happening?
7. Is callback route routed correctly by gateway?
8. Is session cookie blocked by SameSite/Secure/domain/path?
9. Is user authenticated but role mapping empty?
10. Is application denying after successful login?

### 13.2 Token validation failure runbook

Questions:

1. What token type was sent: access token or ID token?
2. Is issuer expected?
3. Is audience expected?
4. Is token expired/not yet valid?
5. Is JWKS reachable?
6. Is key rotation in progress?
7. Is algorithm allowlisted?
8. Was token issued for another client/API?
9. Is gateway stripping Authorization header?
10. Is app using stale JWKS cache?

### 13.3 Authorization denial runbook

Questions:

1. Who is actor?
2. What active tenant?
3. What resource tenant?
4. What action?
5. What resource state?
6. What application roles?
7. What policy version?
8. What rule denied?
9. Was role mapping recently changed?
10. Is permission cache stale?
11. Did assignment/delegation expire?
12. Is denial expected after workflow state change?

### 13.4 Incident response runbook

For suspected privilege escalation:

```text
1. Freeze relevant audit logs.
2. Identify actor subject id, issuer, tenant, session id.
3. Identify token/session used.
4. Reconstruct request timeline by correlation id.
5. Re-evaluate historical authorization decision with policy version at time.
6. Check role/group mapping at time.
7. Check gateway headers and source path.
8. Check resource state and assignment at time.
9. Identify whether bug is authn, mapping, authz, tenant, cache, or UI-only enforcement.
10. Patch with regression test.
11. Invalidate sessions/tokens if needed.
12. Record incident report.
```

---

## 14. Reference Implementation Blueprint

### 14.1 Package structure

```text
com.example.security
  authentication
    OidcCallerResolver.java
    BearerTokenAuthenticationMechanism.java
    TrustedGatewayAuthenticationMechanism.java
    CertificatePrincipalMapper.java
  identity
    AuthenticatedCaller.java
    Actor.java
    ActorResolver.java
    TenantContext.java
  mapping
    RoleMappingService.java
    ClaimMappingRules.java
    RoleMappingVersion.java
  authorization
    AuthorizationService.java
    AuthorizationRequest.java
    AuthorizationDecision.java
    AuthorizationGuard.java
    PermissionMatrix.java
    PolicyVersionProvider.java
  session
    SessionSecurityService.java
    StepUpAuthenticationService.java
  audit
    SecurityAuditService.java
    AuditEvent.java
    AuditOutboxRepository.java
  web
    SecurityHeadersFilter.java
    CsrfFilter.java
    CorrelationIdFilter.java
    ErrorMapper.java
  config
    SecurityProperties.java
    IdpConfiguration.java
    TrustedProxyConfiguration.java
```

### 14.2 Core interfaces

```java
public interface ActorResolver {
    Actor currentActor();
}

public interface RoleMappingService {
    RoleMappingOutput map(RoleMappingInput input);
}

public interface AuthorizationService {
    AuthorizationDecision decide(AuthorizationRequest request);
}

public interface AuthorizationGuard {
    void requireAllowed(Actor actor, Action action, SecuredResource resource);
}

public interface SecurityAuditService {
    void authenticationSucceeded(AuthenticatedCaller caller, RequestContext request);
    void authenticationFailed(AuthenticationFailure failure, RequestContext request);
    void authorizationDecision(AuthorizationRequest request, AuthorizationDecision decision);
    void sensitiveActionCompleted(Actor actor, DomainEvent event);
}
```

### 14.3 Request lifecycle implementation

```text
1. Edge receives request.
2. Edge normalizes request and forwards safely.
3. CorrelationIdFilter establishes correlation id.
4. Authentication mechanism validates session/token/header/cert.
5. Identity is normalized into caller principal/groups.
6. RoleMappingService maps external attributes to application roles.
7. SecurityContext becomes usable by Servlet/JAX-RS/CDI/EJB.
8. URL/method-level security performs coarse checks.
9. Business service loads resource in transaction.
10. AuthorizationService evaluates domain permission.
11. Decision is audited.
12. Business state transition occurs.
13. Audit/outbox event is persisted.
14. Response/error is mapped safely.
```

---

## 15. Threat Model Summary

### 15.1 Assets

1. User identity.
2. Session cookie.
3. Access token.
4. Refresh token.
5. Client certificate private key.
6. Case/resource data.
7. Tenant boundary.
8. Role mapping configuration.
9. Authorization policy.
10. Audit log.
11. Admin console.
12. Secrets/keys/JWKS/certificates.

### 15.2 Threats

| Threat | Control |
|---|---|
| Token replay | TLS, short TTL, mTLS/PoP for high assurance, audience validation |
| Wrong token accepted | issuer/audience/algorithm validation |
| Session theft | Secure/HttpOnly/SameSite, session rotation, idle/absolute timeout |
| CSRF | CSRF token, SameSite, Origin validation |
| XSS token theft | BFF/session, CSP, avoid localStorage token |
| Header spoofing | strip inbound headers, signed internal token, trusted network only |
| Role drift | mapping version, tests, audit, review workflow |
| Tenant leak | tenant-safe repository, resource tenant checks, cross-tenant tests |
| Authorization bypass | domain authorization service, deny-by-default, negative tests |
| Race condition | transactional check, lock/versioning |
| Async identity leak | explicit actor snapshot, clear context |
| Audit tampering | append-only store, restricted access, integrity controls |
| IdP outage | fail-closed, cached sessions policy, runbook |
| JWKS rotation outage | cache strategy, refresh-on-kid-miss, retry/backoff |

---

## 16. Failure Model Summary

The architecture should explicitly define these failure decisions:

| Failure | Recommended behavior |
|---|---|
| IdP discovery unreachable during login | fail login safely, show generic error |
| Existing app session while IdP down | allow only if session still valid and policy permits |
| JWKS unreachable with cached valid key | use cache until TTL/grace policy, alert |
| JWKS kid unknown | refresh JWKS once, then deny if still unknown |
| Role mapping service unavailable | deny sensitive action; do not assume default role |
| Authorization policy store unavailable | fail-closed for protected action |
| Audit write fails for sensitive mutation | usually rollback or outbox local persistence required |
| Tenant context missing | deny |
| Active tenant mismatches resource tenant | deny and audit |
| Gateway header missing | deny if gateway-auth route requires it |
| CSRF token missing | deny state-changing browser request |
| Clock skew detected | deny invalid token but alert ops |
| Permission cache stale suspicion | bypass cache, reload, or deny sensitive action |

Golden rule:

```text
For authentication and authorization uncertainty, prefer explicit denial over silent allowance.
```

---

## 17. Java 8–25 Considerations

### 17.1 Java 8 legacy

Common constraints:

1. Java EE 8 / `javax.*` ecosystem.
2. Older app servers.
3. Legacy JAAS/JASPIC/JACC APIs.
4. Older TLS defaults.
5. Older JWT/OIDC libraries.
6. Less modern concurrency support.
7. No virtual threads.

Design implication:

```text
Keep core authorization model pure Java and portable.
Separate Jakarta API adapter from domain authorization engine.
```

### 17.2 Java 11/17/21/25 modern baseline

Modern Java enables:

1. records for immutable security DTOs,
2. sealed interfaces for action/resource types,
3. pattern matching for cleaner policy code,
4. virtual threads for scalable blocking IO,
5. stronger TLS/JCA defaults,
6. better container support in modern Jakarta runtimes.

However:

```text
virtual threads do not remove the need for explicit security context propagation.
```

### 17.3 Compatibility architecture

Keep layers separated:

```text
jakarta-web-adapter
  -> converts SecurityContext/HttpServletRequest/token into Actor

security-domain-core
  -> pure Java authorization, role mapping, policy, audit DTO

infrastructure-adapters
  -> DB, IdP, JWKS, policy store, audit sink
```

This allows migration:

```text
Java EE 8 javax app
  -> same domain authorization core
  -> adapter rewritten for Jakarta EE 10/11
```

---

## 18. Design Review Checklist

Use this as a final architecture review checklist.

### 18.1 Identity

- [ ] Is stable subject defined as issuer + subject?
- [ ] Are username/email/display name treated as mutable?
- [ ] Is account linking explicit and auditable?
- [ ] Are multiple IdPs handled safely?
- [ ] Is active tenant/organization explicit?

### 18.2 Authentication

- [ ] Are mechanisms defined per entry point?
- [ ] Are OIDC state/nonce/PKCE validated?
- [ ] Are tokens validated with issuer/audience/expiry/signature/algorithm?
- [ ] Is mTLS identity mapped safely?
- [ ] Are trusted headers protected against spoofing?

### 18.3 Session/token

- [ ] Are cookies Secure/HttpOnly/SameSite/path/domain configured?
- [ ] Is session fixation prevented?
- [ ] Are idle and absolute timeout defined?
- [ ] Is logout local/global/token behavior defined?
- [ ] Is refresh token handling safe?

### 18.4 Authorization

- [ ] Is default deny used?
- [ ] Are URL/method/domain enforcement layers clear?
- [ ] Is domain authorization evaluated against current resource state?
- [ ] Are tenant checks mandatory?
- [ ] Are maker-checker and separation-of-duty rules enforced server-side?
- [ ] Are permission decisions audited?

### 18.5 Gateway/proxy

- [ ] Are inbound identity headers stripped?
- [ ] Are forwarded headers trusted only from known proxies?
- [ ] Is direct app access blocked?
- [ ] Are route rewrites tested?
- [ ] Is TLS/mTLS termination understood?

### 18.6 Audit/forensics

- [ ] Are authentication and authorization events structured?
- [ ] Is actor/on-behalf-of/executor recorded?
- [ ] Is policy version recorded?
- [ ] Are denied sensitive actions audited?
- [ ] Is audit write transactionally consistent?
- [ ] Are sensitive values redacted?

### 18.7 Testing

- [ ] Are negative tests first-class?
- [ ] Are cross-tenant tests present?
- [ ] Are token invalid cases tested?
- [ ] Are role mapping tests versioned?
- [ ] Are CSRF/CORS/session/logout tests present?
- [ ] Are race condition tests present for workflow transitions?

### 18.8 Operations

- [ ] Is IdP outage runbook available?
- [ ] Is JWKS rotation runbook available?
- [ ] Is role mapping change reviewed?
- [ ] Are secrets/certs rotated safely?
- [ ] Are alerts tied to auth failures/denials/anomalies?
- [ ] Is break-glass process controlled and audited?

---

## 19. Common Architecture Anti-Patterns

### Anti-pattern 1 — “The gateway already validates token, so app trusts everything”

Problem:

```text
Internal path or header spoofing can bypass identity establishment.
```

Fix:

```text
Define gateway-app trust contract, strip headers, sign internal identity, block direct access, still enforce domain auth in app.
```

### Anti-pattern 2 — “Role is enough”

Problem:

```text
Role cannot represent tenant, resource state, assignment, maker-checker, relationship, time, and delegation.
```

Fix:

```text
Use role for coarse capability, domain authorization for exact decision.
```

### Anti-pattern 3 — “JWT is stateless, so logout is solved”

Problem:

```text
Stateless tokens are hard to revoke instantly.
```

Fix:

```text
Short TTL, refresh token control, introspection for high-risk APIs, session/BFF for browser where appropriate.
```

### Anti-pattern 4 — “Authorization only in frontend”

Problem:

```text
API can be called directly.
```

Fix:

```text
Server-side authorization on every protected action.
```

### Anti-pattern 5 — “Audit is just logs”

Problem:

```text
Logs may be incomplete, unstructured, mutable, or not tied to transaction.
```

Fix:

```text
Structured audit events with actor/action/resource/decision/policy version and transactional outbox.
```

### Anti-pattern 6 — “Async job uses current user magically”

Problem:

```text
Thread-local context may be gone or wrong.
```

Fix:

```text
Explicit actor snapshot, executor identity, on-behalf-of model.
```

### Anti-pattern 7 — “Email is primary key”

Problem:

```text
Email changes, can be reused, may not be unique across issuers.
```

Fix:

```text
Use issuer + subject as federated identity key.
```

---

## 20. Final Mental Model

Enterprise Jakarta security platform is not one decision. It is a chain of decisions.

```text
Can this request be accepted?
  -> transport/gateway decision

Can this caller be authenticated?
  -> authentication mechanism decision

Who is this caller in stable application terms?
  -> identity normalization decision

What broad capabilities does caller have?
  -> role/group/claim mapping decision

What tenant/entity context is active?
  -> tenant resolution decision

Can this actor perform this action on this exact resource now?
  -> domain authorization decision

Can this decision be explained later?
  -> audit/forensic decision

What happens when one dependency is down or stale?
  -> failure-mode decision
```

A top-tier engineer does not only ask:

```text
Is there authentication?
```

They ask:

```text
Where is identity established?
What exactly is trusted?
Where is the boundary?
How is role mapped?
How is tenant enforced?
Is authorization evaluated at the same time as state transition?
What is audited?
How does it fail?
How do we test the bypass path?
How do we migrate without changing security behavior?
```

That is the difference between **using security APIs** and **designing a defensible security platform**.

---

## 21. End of Series Summary

This series has progressed through:

1. mental model,
2. vocabulary,
3. JAAS/JASPIC/JACC/Jakarta history,
4. container architecture,
5. Servlet security,
6. authentication mechanisms,
7. Jakarta Security core,
8. SecurityContext,
9. IdentityStore,
10. credential handling,
11. Jakarta Authentication,
12. Jakarta Authorization,
13. declarative authorization,
14. programmatic/domain authorization,
15. role/group/claim/scope mapping,
16. session security,
17. token security,
18. OIDC,
19. OAuth2 resource server,
20. SAML/legacy federation,
21. mTLS,
22. method security,
23. context propagation,
24. multi-tenancy,
25. workflow/case authorization,
26. gateway/proxy boundary,
27. browser security,
28. secure error handling,
29. audit/forensics,
30. security testing,
31. javax-to-jakarta migration,
32. interoperability,
33. production hardening,
34. failure modelling,
35. capstone architecture.

If you understand and can apply this capstone, you are no longer operating at “I know how to add login” level.

You are operating at:

```text
I can design, migrate, review, test, debug, and defend an enterprise Java/Jakarta security architecture.
```

---

## 22. References

Official/specification-oriented references useful for this capstone:

1. Jakarta Security 4.0 Specification — https://jakarta.ee/specifications/security/4.0/
2. Jakarta Security API Docs — https://jakarta.ee/specifications/security/4.0/apidocs/
3. Jakarta Authentication 3.1 Specification — https://jakarta.ee/specifications/authentication/3.1/
4. Jakarta Authorization 3.0 Specification — https://jakarta.ee/specifications/authorization/3.0/
5. Jakarta Servlet 6.1 Specification — https://jakarta.ee/specifications/servlet/6.1/
6. Jakarta EE Security Tutorial — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security-intro/security-intro.html
7. OpenID Connect Core — https://openid.net/specs/openid-connect-core-1_0.html
8. OAuth 2.0 Bearer Token Usage RFC 6750 — https://www.rfc-editor.org/rfc/rfc6750
9. OAuth 2.0 Token Introspection RFC 7662 — https://www.rfc-editor.org/rfc/rfc7662
10. JWT Profile for OAuth 2.0 Access Tokens RFC 9068 — https://www.rfc-editor.org/rfc/rfc9068
11. OAuth 2.0 Mutual-TLS Client Authentication RFC 8705 — https://www.rfc-editor.org/rfc/rfc8705
12. OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
13. OWASP Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
14. OWASP CSRF Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
15. OWASP Logging Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

---

## 23. Status

```text
Status: SERIES COMPLETE
Current part: Part 34 of 34 planned content parts
Series: learn-java-jakarta-security-authentication-authorization-identity
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 33 — Failure Modelling: How Jakarta Security Systems Actually Break](./learn-java-jakarta-security-authentication-authorization-identity-part-33-failure-modelling-how-security-breaks.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 000 — Mental Model Server-Side Java Web Runtime](../servlet/learn-java-servlet-websocket-web-container-runtime-part-000.md)
