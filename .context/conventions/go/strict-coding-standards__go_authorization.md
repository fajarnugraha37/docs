# Strict Coding Standards — Go Authorization

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go APIs, services, CLIs, workers, workflow engines, case-management systems, event processors, administrative tools  
Baseline: Go 1.24–1.26+, deny-by-default authorization, explicit policy enforcement, auditable decisions

---

## 1. Purpose

Authorization decides **whether an authenticated or anonymous actor may perform an action on a resource under specific conditions**.

The LLM MUST treat authorization as a domain and security concern, not as a simple role string check. Authorization code must be explicit, deny-by-default, testable, auditable, and resistant to object-level access control failures.

This standard exists to make Go authorization code:

- deny by default,
- least-privilege by default,
- explicit about actor/action/resource/environment,
- resistant to IDOR/BOLA and confused-deputy bugs,
- safe across tenant, role, ownership, status, and workflow boundaries,
- auditable for regulated systems,
- enforceable in handlers, services, workers, and event consumers,
- independent from authentication mechanics.

---

## 2. Source authority

Primary references:

- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Access Control overview: https://owasp.org/www-community/Access_Control
- OWASP Top 10 Broken Access Control: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
- NIST SP 800-162 Guide to Attribute Based Access Control: https://csrc.nist.gov/pubs/sp/800/162/upd2/final
- OAuth 2.0 Security Best Current Practice, RFC 9700: https://www.rfc-editor.org/rfc/rfc9700.html
- OAuth 2.0 Bearer Token Usage, RFC 6750: https://www.rfc-editor.org/rfc/rfc6750.html
- JSON Web Token, RFC 7519: https://datatracker.ietf.org/doc/html/rfc7519
- Open Policy Agent documentation: https://openpolicyagent.org/docs
- Go `context`: https://pkg.go.dev/context
- Go `net/http`: https://pkg.go.dev/net/http
- Go `database/sql`: https://pkg.go.dev/database/sql
- Go Security documentation: https://go.dev/doc/security/

If this document conflicts with enterprise policy, legal/regulatory access model, or product-specific authorization matrix, the stricter rule wins. The LLM MUST report material conflict instead of silently weakening access.

---

## 3. Authorization decision model

Every authorization decision MUST be modelled as:

```text
Can actor A perform action X on resource R under environment/context E?
```

Where:

| Component   | Examples                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Actor       | user, service account, partner system, scheduler, delegated actor, anonymous actor                |
| Action      | view, search, create, update, approve, reject, assign, export, delete, escalate, transition state |
| Resource    | case, application, document, tenant, record, workflow transition, API endpoint, event stream      |
| Environment | tenant, time, IP/network, assurance level, case state, ownership, duty segregation, risk level    |

The LLM MUST NOT reduce authorization to `role == "admin"` unless the project policy explicitly proves that role is sufficient for the specific action/resource.

---

## 4. Non-negotiable rules

### 4.1 Deny by default

All authorization checks MUST default to deny.

Forbidden:

```go
// FORBIDDEN: missing case accidentally permits.
func Can(role string, action string) bool {
    if role == "admin" {
        return true
    }
    if action == "read" {
        return true
    }
    return true
}
```

Required:

```go
func Can(actor Actor, action Action, resource Resource) bool {
    switch action {
    case ActionViewCase:
        return canViewCase(actor, resource)
    case ActionApproveCase:
        return canApproveCase(actor, resource)
    default:
        return false
    }
}
```

### 4.2 Check every protected request

Every protected endpoint, command handler, worker operation, event consumer, and administrative operation MUST perform authorization at the correct boundary.

The LLM MUST NOT rely on UI hiding, route naming, menu permissions, client-side checks, or gateway-only rules for business authorization.

### 4.3 Object-level authorization is mandatory

If a request references an object by ID, the code MUST verify access to that specific object.

Forbidden:

```go
// FORBIDDEN: authenticated user can guess another case ID.
caseRecord, err := repo.GetCase(ctx, caseID)
```

Required:

```go
caseRecord, err := repo.GetCaseForActor(ctx, actor, caseID)
if err != nil {
    return err
}
if err := authorizer.Require(ctx, actor, ActionViewCase, CaseResource(caseRecord)); err != nil {
    return err
}
```

Repository-level filtering MAY be used as defense-in-depth, but domain/application authorization MUST remain explicit for state-changing operations.

### 4.4 Authentication claims are not final permission

Roles, groups, scopes, and permissions inside tokens are claims. They MUST be normalized and evaluated against policy.

Forbidden:

```go
// FORBIDDEN: raw string claim becomes final authority everywhere.
if slices.Contains(claims.Roles, "manager") { approve() }
```

Required:

```go
if err := authorizer.Require(ctx, actor, ActionApproveCase, resource); err != nil {
    return err
}
```

### 4.5 Tenant boundary must be explicit

Multi-tenant systems MUST include tenant in authorization evaluation. Tenant ID from request path/body MUST NOT override authenticated tenant context without policy.

Forbidden:

```go
// FORBIDDEN: tenant chosen by caller.
tenantID := r.URL.Query().Get("tenantId")
```

Required:

```go
actor, _ := authn.ActorFromContext(r.Context())
resource, err := repo.GetTenantScopedCase(ctx, actor.TenantID, caseID)
```

---

## 5. Action naming standard

Actions MUST be named by business capability, not by HTTP verb alone.

Preferred:

```go
type Action string

const (
    ActionViewCase        Action = "case.view"
    ActionSearchCase      Action = "case.search"
    ActionAssignCase      Action = "case.assign"
    ActionApproveCase     Action = "case.approve"
    ActionRejectCase      Action = "case.reject"
    ActionEscalateCase    Action = "case.escalate"
    ActionExportCase      Action = "case.export"
    ActionDeleteDocument  Action = "document.delete"
    ActionAdminGrantRole  Action = "admin.role.grant"
)
```

Rules:

- use stable names;
- do not couple authorization action names to handler function names;
- distinguish read/search/export;
- distinguish update/approve/reject/transition;
- distinguish admin operation from normal operation;
- distinguish self-service action from staff action;
- distinguish human action from system automation when audit requires it.

---

## 6. Resource modelling standard

Authorization resources MUST expose attributes needed for policy decisions without leaking persistence models everywhere.

Example:

```go
type CaseResource struct {
    ID            string
    TenantID      string
    OwnerUserID   string
    AssignedTeam  string
    Status        CaseStatus
    Classification string
    CreatedBy     string
    LockedBy      string
    IsSealed      bool
}
```

Rules:

- resource ID alone is insufficient;
- tenant, owner, state, classification, and assignment must be available if policy depends on them;
- authorization must use domain vocabulary, not raw SQL rows;
- sensitive resource attributes must not be logged unless explicitly safe.

---

## 7. Authorizer interface

Authorization dependency MUST be small and explicit.

Preferred:

```go
type Authorizer interface {
    Require(ctx context.Context, actor authn.Actor, action Action, resource Resource) error
    Can(ctx context.Context, actor authn.Actor, action Action, resource Resource) (Decision, error)
}

type Decision struct {
    Allowed bool
    Reason  string
    Policy  string
}
```

Rules:

- `Require` should return an authorization error on deny;
- `Can` may be used when callers need decision details;
- decision reasons in public errors must be generic;
- internal audit may record sanitized reason and policy ID;
- authorizer must be deterministic for same input unless policy explicitly depends on time/environment.

Forbidden:

```go
// FORBIDDEN: global authorization state hidden from tests.
if authz.GlobalCan("approve") { ... }
```

---

## 8. Error taxonomy

Authorization errors MUST be distinguishable internally but safe externally.

```go
type DenyReason string

const (
    DenyUnauthenticated DenyReason = "unauthenticated"
    DenyNoPermission    DenyReason = "no_permission"
    DenyWrongTenant     DenyReason = "wrong_tenant"
    DenyWrongState      DenyReason = "wrong_state"
    DenyOwnership       DenyReason = "ownership_required"
    DenySegregation     DenyReason = "segregation_of_duties"
    DenyStepUpRequired  DenyReason = "step_up_required"
)

type Error struct {
    Action Action
    Reason DenyReason
    Policy string
}

func (e *Error) Error() string { return "access denied" }
```

Mapping:

| Internal condition                 | HTTP mapping                         |
| ---------------------------------- | ------------------------------------ |
| missing/invalid authentication     | 401                                  |
| authenticated but denied           | 403                                  |
| object hidden to avoid enumeration | 404 by explicit policy only          |
| malformed request                  | 400                                  |
| policy evaluation failure          | 500 or fail-closed operational error |

The LLM MUST NOT return detailed policy internals to public clients unless product explicitly requires explainable authorization and redaction is applied.

---

## 9. RBAC, ABAC, ReBAC, and policy engines

### 9.1 RBAC

RBAC is acceptable for coarse-grained capabilities, but MUST NOT be the only model when decisions depend on tenant, ownership, state, classification, assignment, or relationship.

Example RBAC-only bug:

```go
// FORBIDDEN: any officer can approve any case in any state.
return actor.HasRole("officer")
```

### 9.2 ABAC

ABAC SHOULD be used when decisions depend on subject, resource, action, and environment attributes.

Example:

```go
func canApproveCase(actor Actor, c CaseResource, now time.Time) bool {
    return actor.TenantID == c.TenantID &&
        actor.HasPermission("case.approve") &&
        c.Status == CaseStatusPendingApproval &&
        c.CreatedBy != actor.Subject &&
        actor.Assurance >= AssuranceMFA
}
```

### 9.3 Relationship-based authorization

Use relationship/ownership checks when access depends on links such as owner, assignee, team, supervisor, case participant, representative, or organization membership.

### 9.4 Policy engines

OPA or another policy engine MAY be used when policies are large, cross-cutting, externally governed, or need independent deployment.

Rules:

- policy input must be explicit and versioned;
- policy output must be typed and validated;
- policy failure must fail closed;
- policy bundles must be tested and versioned;
- policy evaluation must have latency and timeout controls;
- do not spread raw `map[string]any` policy input throughout application code;
- maintain Go-side defense for critical invariants if required by domain safety.

---

## 10. Scope and permission handling

Scopes and permissions MUST be normalized into stable internal values.

Rules:

- scope strings from tokens are external claims;
- use allowlist mapping from external scope to internal action;
- do not use substring matching;
- do not treat `admin` substring as administrative access;
- distinguish user consent scopes from resource-server authorization;
- scope absence must deny access.

Forbidden:

```go
// FORBIDDEN: substring permission check.
if strings.Contains(scope, "admin") { allow() }
```

Required:

```go
var scopeToActions = map[string][]Action{
    "cases:read":  {ActionViewCase, ActionSearchCase},
    "cases:write": {ActionAssignCase},
}
```

---

## 11. State-machine authorization

Workflow/state transitions MUST be authorized explicitly.

A transition is allowed only if:

- actor is authenticated as required;
- actor has capability for transition;
- actor has access to the resource;
- current state permits transition;
- segregation-of-duties rules pass;
- required assurance/MFA is satisfied;
- required preconditions are met;
- audit event can be recorded.

Example:

```go
func (s *CaseService) Approve(ctx context.Context, actor Actor, id CaseID) error {
    c, err := s.repo.Get(ctx, id)
    if err != nil {
        return err
    }
    if err := s.authz.Require(ctx, actor, ActionApproveCase, CaseResourceFrom(c)); err != nil {
        return err
    }
    if err := c.Approve(actor.Subject, s.clock.Now()); err != nil {
        return err
    }
    return s.repo.Save(ctx, c)
}
```

The domain transition MUST still validate state invariants. Authorization alone is not state validation.

---

## 12. Segregation of duties

Regulated workflows often require separation between maker and checker.

Rules:

- actor who created/requested a sensitive action may be forbidden from approving it;
- actor who last modified a record may need separate reviewer;
- supervisor override must be explicit and audited;
- service/system actors must not bypass segregation unless policy says so;
- batch approvals need per-item authorization.

Example:

```go
if resource.CreatedBy == actor.Subject && action == ActionApproveCase {
    return deny(DenySegregation, "maker cannot approve own case")
}
```

---

## 13. Ownership and IDOR/BOLA prevention

For every endpoint accepting IDs:

- load resource in tenant/actor-scoped manner where possible;
- check object-level access;
- do not expose whether resource exists across tenant boundary unless policy allows;
- do not use sequential IDs as authorization control;
- never trust client-supplied owner ID;
- test access with another user's resource ID.

Forbidden:

```go
// FORBIDDEN: owner ID supplied by caller.
ownerID := r.FormValue("ownerId")
```

Required:

```go
actor, _ := authn.ActorFromContext(ctx)
cmd.ActorID = actor.Subject
```

---

## 14. Data access filtering

List/search endpoints MUST apply authorization to the query itself, not only to individual results after loading.

Rules:

- tenant filter must be mandatory;
- user/team/role visibility filters must be included;
- pagination counts must not leak hidden records;
- sorting/filtering must not allow inference of inaccessible data;
- export must use stricter policy than view when data volume/sensitivity increases.

Post-filtering MAY be added as defense-in-depth, but not as primary access control for large datasets.

---

## 15. Field-level authorization

Some actors may view a resource but not every field.

Rules:

- field masking must be explicit;
- response DTO must be built after authorization decision;
- do not rely on `json:"-"` alone for dynamic field-level access;
- logs/traces must not contain masked fields;
- exports must reapply field-level policy.

Example:

```go
func MapCaseResponse(actor Actor, c Case, p FieldPolicy) CaseResponse {
    res := CaseResponse{ID: c.ID.String(), Status: string(c.Status)}
    if p.CanViewSensitiveNotes(actor, c) {
        res.SensitiveNotes = c.SensitiveNotes
    }
    return res
}
```

---

## 16. Administrative authorization

Admin features are high-risk and MUST have stronger controls.

Required:

- explicit admin actions;
- MFA/step-up for privilege changes;
- break-glass path separated from normal admin;
- no self-granting critical privileges unless policy explicitly allows;
- dual control for high-impact role grants where required;
- audit log for grant, revoke, impersonate, export, delete, override;
- deny-by-default on unknown admin action.

---

## 17. Impersonation and delegation

Impersonation/delegation MUST preserve both identities.

Actor model MUST distinguish:

- authenticated operator,
- effective subject,
- delegation reason,
- delegation scope,
- start/end time,
- approval/reference ID if required.

Forbidden:

```go
// FORBIDDEN: overwrites identity and destroys audit trail.
actor.Subject = targetUserID
```

Required:

```go
type DelegatedActor struct {
    OperatorSubject string
    EffectiveSubject string
    Reason string
    Scope []Action
    ExpiresAt time.Time
}
```

---

## 18. System and worker authorization

Background jobs, event consumers, and schedulers MUST use explicit system actors.

Rules:

- no hidden superuser behavior;
- system actor must have bounded purpose;
- event handler must authorize operation if it changes protected state;
- replayed events must not bypass authorization-sensitive invariants;
- operator-triggered batch job must record triggering actor;
- per-item authorization is required when batch includes multiple tenants or owners.

---

## 19. Caching authorization decisions

Authorization decision caching is dangerous and MUST be deliberate.

Rules:

- cache only decisions with clear invalidation model;
- include actor, action, resource, tenant, policy version, and relevant attributes in cache key;
- use short TTL;
- invalidate on role/permission/resource state changes;
- never cache denial/allowance across tenants;
- do not cache decisions that depend on rapidly changing workflow state unless versioned.

---

## 20. Public API and error handling

Authorization failures MUST not leak resource existence unless product policy permits it.

Guideline:

- use `403` when actor knows/owns context but lacks permission;
- use `404` to hide cross-tenant or private resource existence only by explicit policy;
- use generic body: `access denied` or `not found`;
- include correlation ID;
- do not include role names, policy details, or required permission in public error unless API contract says so.

---

## 21. Logging and audit

Authorization decisions for sensitive actions MUST produce structured audit events.

Allowed fields:

- actor subject,
- effective subject if delegated,
- tenant,
- action,
- resource type,
- resource ID,
- decision allow/deny,
- sanitized reason code,
- policy ID/version,
- request ID/correlation ID,
- timestamp,
- assurance level,
- source system.

Forbidden fields:

- raw token,
- session ID,
- API key,
- password,
- sensitive resource content,
- unredacted document/body payload.

Example:

```go
logger.InfoContext(ctx, "authz.decision",
    slog.String("action", string(action)),
    slog.String("resource_type", resource.Type()),
    slog.String("resource_id", resource.ID()),
    slog.Bool("allowed", decision.Allowed),
    slog.String("reason", decision.Reason),
)
```

---

## 22. Testing requirements

Authorization tests MUST prove denial as strongly as allowance.

Required matrix:

- unauthenticated actor denied;
- authenticated actor without permission denied;
- wrong tenant denied;
- wrong owner denied;
- wrong resource state denied;
- maker/checker violation denied;
- required MFA absent denied;
- disabled/suspended actor denied;
- expired delegation denied;
- admin privilege self-grant denied when policy forbids;
- allowed actor/action/resource succeeds;
- list/search does not return inaccessible resources;
- export applies stricter policy;
- field-level masking works;
- public error does not leak policy details;
- audit event emitted for sensitive allow and deny.

Tests SHOULD be table-driven.

Example:

```go
func TestCanApproveCase(t *testing.T) {
    tests := []struct {
        name  string
        actor Actor
        res   CaseResource
        want  bool
    }{
        {"deny wrong tenant", actorTenantA, caseTenantB, false},
        {"deny maker checker", makerActor, makerCase, false},
        {"allow reviewer", reviewerActor, pendingCase, true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := canApproveCase(tt.actor, tt.res, fixedTime)
            if got != tt.want {
                t.Fatalf("got %v want %v", got, tt.want)
            }
        })
    }
}
```

---

## 23. Fuzz and property testing

Authorization parsers and policy inputs SHOULD be fuzzed when they accept external policy data, expression language, JSON claims, or dynamic attributes.

Property checks SHOULD assert:

- unknown action denies;
- unknown resource type denies;
- empty actor denies;
- tenant mismatch always denies;
- missing required attribute denies;
- policy evaluation failure denies;
- adding unrelated attributes does not unexpectedly allow access;
- cross-tenant records never appear in search result.

---

## 24. Migration and compatibility

Authorization changes are breaking behavioral changes.

The LLM MUST include migration notes when:

- action names change,
- permission names change,
- role mapping changes,
- policy engine input changes,
- tenant or ownership semantics change,
- field-level masking changes,
- response code changes from 403 to 404 or vice versa.

Backward compatibility MUST NOT preserve insecure access unless a documented temporary exception exists with expiry and owner.

---

## 25. Forbidden shortcuts

The LLM MUST NOT:

- rely on frontend/menu visibility as access control;
- use authentication success as permission;
- trust user/role/tenant from request body or query without verifying against authenticated actor;
- use role string equality as the only check for object-level actions;
- skip authorization in internal endpoints;
- skip authorization in workers/event consumers;
- authorize lists after fetching all data without tenant/resource filter;
- use substring permission matching;
- treat `admin` as universal bypass without explicit break-glass/admin policy;
- hide authorization failure by silently doing nothing;
- cache authorization decisions without policy/version/invalidation model;
- log raw tokens or sensitive resource content in authorization logs;
- allow unknown action/resource by default;
- implement policy with global mutable maps that tests cannot isolate;
- add OPA/dynamic policy without typed input/output boundary and fail-closed behavior.

---

## 26. Required PR checklist

Before completing Go authorization work, the LLM MUST verify:

- [ ] Authorization is separate from authentication.
- [ ] Decision model includes actor, action, resource, and environment.
- [ ] Unknown action/resource denies by default.
- [ ] Object-level authorization is present for ID-based operations.
- [ ] Tenant boundary cannot be bypassed by request input.
- [ ] State-changing operations check both authorization and domain state invariants.
- [ ] Search/list/export queries apply authorization filters before returning results.
- [ ] Field-level masking is handled where required.
- [ ] Admin, impersonation, delegation, and system actors are explicitly modelled.
- [ ] Public errors do not leak sensitive policy details.
- [ ] Sensitive allow/deny decisions emit audit events.
- [ ] Denial tests exist for wrong tenant, wrong owner, wrong state, missing permission, and missing MFA when relevant.
- [ ] `go test ./...`, `go vet ./...`, and `govulncheck ./...` are expected gates.
