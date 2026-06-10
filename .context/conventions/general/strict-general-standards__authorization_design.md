# Strict General Standards: Authorization Design

> **Status:** Mandatory  
> **Audience:** LLM code agents, software engineers, reviewers, architects  
> **Scope:** Access control, permissions, policy design, object-level authorization, tenant isolation, state/action authorization, service authorization, auditability

---

## 1. Purpose

Authorization design defines **what an authenticated actor is allowed to do to a specific resource under specific conditions**.

Authorization is not a controller annotation, not a role string, not a UI flag, and not a gateway-only concern. It is a policy and enforcement architecture that must be present at every trust boundary and every resource/action boundary.

This standard exists to prevent:

- broken object-level authorization;
- IDOR vulnerabilities;
- role explosion;
- tenant data leaks;
- trusting frontend visibility as security;
- missing workflow/state transition checks;
- gateway-only authorization;
- overpowered admin/service accounts;
- inconsistent policy spread across code;
- insecure authorization caching;
- audit gaps for sensitive decisions.

---

## 2. Authentication vs Authorization

Authentication establishes identity.

Authorization evaluates access.

Mandatory rule:

```text
authenticated != authorized
```

Every protected operation MUST perform authorization after authentication.

Bad:

```text
User has valid token -> allow access to /cases/{caseId}
```

Good:

```text
User has valid token
  -> resolve subject
  -> load resource/security context
  -> evaluate tenant + permission + relationship + state + action
  -> allow or deny
```

---

## 3. Core Authorization Model

An authorization decision MUST evaluate at least:

```text
subject     who/what is acting
resource    what is being accessed
action      what operation is requested
context     tenant, state, time, channel, assurance, delegation, risk
policy      rule source that decides allow/deny
```

Decision format:

```text
can(subject, action, resource, context) -> allow | deny | require_step_up
```

Rules:

- Authorization MUST be explicit.
- Default MUST be deny.
- Absence of policy MUST deny.
- Errors in policy evaluation MUST deny unless explicitly designed otherwise for availability-critical read-only public data.
- Authorization MUST happen server-side.
- UI hiding MUST NOT be considered authorization.

---

## 4. Non-Negotiable Rules

### 4.1 Default deny

All protected resources and actions MUST deny access unless explicitly allowed.

Bad:

```java
if (!blocked) allow();
```

Good:

```java
if (policy.allows(subject, action, resource, context)) allow(); else deny();
```

---

### 4.2 Check object-level authorization

Every resource identified by ID MUST be checked against the subject.

Mandatory:

- Check ownership, tenant, assignment, delegation, role, or relationship.
- Do not rely on unscoped lookup by ID.
- Do not trust IDs from request path/body/query.
- Do not return existence details when user lacks access unless product policy allows it.

Bad:

```sql
SELECT * FROM cases WHERE id = :caseId
```

Good:

```sql
SELECT *
FROM cases c
WHERE c.id = :caseId
  AND c.tenant_id = :subjectTenant
  AND EXISTS (
      SELECT 1
      FROM case_assignments a
      WHERE a.case_id = c.id
        AND a.user_id = :subjectId
  )
```

---

### 4.3 Authorize action, not only resource

Access to view a resource does not imply permission to modify, delete, approve, export, assign, close, reopen, or escalate it.

Mandatory:

```text
case:view
case:create
case:update
case:assign
case:approve
case:close
case:reopen
case:export
case:delete
```

Bad:

```text
User can access case -> user can approve case.
```

Good:

```text
case:view is separate from case:approve.
```

---

### 4.4 Authorize state transitions

Workflow systems MUST authorize transitions, not just records.

Required transition decision:

```text
can(subject, transition, aggregate, current_state, target_state, context)
```

Rules:

- Each transition MUST have allowed actors.
- Each transition MUST validate current state.
- Each transition MUST validate business invariants.
- Transition authorization MUST be atomic with state change where possible.
- Audit must record who performed or attempted the transition.

Bad:

```text
PATCH /cases/{id} { "status": "APPROVED" }
```

Good:

```text
POST /cases/{id}/transitions/approve
```

with:

```text
current_state = PENDING_REVIEW
permission = case:approve
assurance_level >= required
no conflict with segregation-of-duties rule
```

---

### 4.5 Tenant isolation is mandatory

For multi-tenant systems, tenant boundary MUST be part of every authorization decision.

Mandatory:

- Every tenant-owned row/document/event MUST carry tenant identity.
- Queries MUST be tenant-scoped by default.
- Cross-tenant admin access MUST be explicit, audited, and minimized.
- Tenant ID from request MUST NOT be trusted blindly.
- Tenant context MUST be derived from authenticated subject/session/request routing rules.
- Background jobs MUST process data with explicit tenant scope.

Forbidden:

```sql
SELECT * FROM invoices WHERE id = :id
```

without tenant/security scope.

---

## 5. Policy Types

LLMs MUST choose the simplest sufficient policy model.

### 5.1 RBAC

Use RBAC when permissions map cleanly to job functions.

Example:

```text
role: case_officer
permissions:
  - case:view_assigned
  - case:update_assigned
```

Rules:

- Roles MUST be collections of permissions, not hardcoded conditions.
- Code MUST check permissions, not role names, where possible.
- Role names MUST not encode fragile business logic.

Bad:

```java
if (user.role == "ADMIN") allowEverything();
```

Good:

```java
if (subject.hasPermission("case:approve")) allow();
```

---

### 5.2 ABAC

Use ABAC when decisions depend on attributes.

Attributes may include:

- tenant;
- department;
- clearance level;
- resource classification;
- workflow state;
- ownership;
- channel;
- authentication assurance;
- time window;
- risk score.

Rules:

- Attributes MUST come from trusted sources.
- User-submitted attributes MUST not control authorization unless verified.
- Attribute freshness MUST be defined.
- Sensitive ABAC rules MUST be tested.

---

### 5.3 ReBAC

Use relationship-based access control when access depends on graph relationships.

Examples:

```text
user is assigned officer of case
user supervises assigned officer
user belongs to team owning queue
agency manages licensee
```

Rules:

- Relationship source of truth MUST be explicit.
- Relationship changes MUST take effect predictably.
- Cycles and inherited relationships MUST be bounded.
- Query performance MUST be considered.

---

### 5.4 ACL

Use ACL only for object-specific exceptions.

Rules:

- ACL must not become the primary permission model accidentally.
- ACL entries must have owner, reason, expiry when temporary, and audit.
- ACL evaluation order must be deterministic.

---

## 6. Permission Naming Standards

Permission names MUST be stable and action-oriented.

Format:

```text
<domain_resource>:<action>[:qualifier]
```

Examples:

```text
case:view
case:view_assigned
case:update
case:approve
case:export
license:renew
user:impersonate
policy:manage
```

Rules:

- Avoid vague permissions like `manage`, `admin`, `full_access` unless decomposed internally.
- Avoid permissions tied to UI screens only.
- Avoid role names as permissions.
- Prefer explicit high-risk permissions.

Bad:

```text
admin=true
canDoEverything=true
```

Good:

```text
case:approve
case:reassign
audit_log:export
```

---

## 7. Authorization Placement

Authorization MUST be enforced at the correct layers.

Required layers:

```text
API/controller boundary       coarse request validation
application/service layer     business/action authorization
domain/workflow layer         invariant and transition authorization
repository/query layer        tenant/object scoping
data layer                    optional defense-in-depth, e.g. RLS
```

Rules:

- Gateway authorization is not enough.
- Frontend authorization is not enough.
- Database filtering alone is not enough for business actions.
- Domain state transitions must not depend only on controller annotations.

Recommended pattern:

```text
Controller:
  authenticate request
  parse command

Application service:
  load subject context
  load resource security context
  authorize action
  execute domain operation

Repository:
  enforce scoped query

Audit:
  record decision and outcome
```

---

## 8. Policy Decision and Enforcement

Use a clear separation where appropriate:

```text
PEP = Policy Enforcement Point
PDP = Policy Decision Point
PIP = Policy Information Point
PAP = Policy Administration Point
```

Rules:

- PEP MUST exist at every entry point.
- PDP MUST produce deterministic decisions.
- PIP attributes MUST be trusted and freshness-aware.
- PAP changes MUST be audited.
- Policy changes MUST be tested before deployment.

For small systems, PDP may be a library/module. For complex systems, PDP may be a centralized policy service or engine.

Do not introduce a policy engine unless the complexity justifies it.

---

## 9. API Authorization

Every API operation MUST declare its authorization requirements.

For each endpoint:

```text
method
path
resource type
action
required permission/scope
object-level check
state precondition
tenant rule
step-up requirement
audit event
```

Example:

```text
POST /cases/{caseId}/transitions/approve
resource: case
action: approve
permission: case:approve
object check: user assigned to approving unit OR has supervisor relation
state: PENDING_APPROVAL
step-up: required for high-impact case
audit: CASE_APPROVAL_ATTEMPT + CASE_APPROVED/CASE_APPROVAL_DENIED
```

Rules:

- OpenAPI security schemes alone are insufficient.
- Endpoint descriptions MUST document permission semantics.
- Bulk endpoints MUST authorize every object or enforce scoped query semantics.
- Export endpoints MUST be treated as high-risk.

---

## 10. Frontend Authorization

Frontend authorization is only UX optimization.

Allowed:

- hide unavailable buttons;
- show disabled states;
- route guard for usability;
- display permission-aware navigation.

Forbidden:

- relying on hidden buttons as security;
- sending role/permission from browser and trusting it;
- performing sensitive authorization only in frontend;
- exposing data in API response then hiding it in UI.

Rule:

```text
If the user is not allowed to see data, the backend must not send it.
```

---

## 11. Data Access Authorization

Query design MUST prevent data leaks.

Mandatory:

- Query by security scope, not fetch-then-filter for sensitive data.
- Add tenant/resource relationship predicate at query time.
- Use pagination after authorization scope is applied.
- For search endpoints, apply authorization filters before returning count/results.
- For aggregations, ensure unauthorized data cannot be inferred.

Bad:

```java
var cases = caseRepository.findAll();
return cases.stream().filter(c -> canView(user, c)).toList();
```

Good:

```java
return caseRepository.findVisibleCases(subject, filters, page);
```

---

## 12. Bulk Operation Authorization

Bulk operations are high-risk.

Mandatory:

- Authorize operation globally and per target object.
- Define partial success behavior.
- Return safe error details.
- Audit each affected object or grouped decision with traceable object IDs.
- Prevent mixed-tenant bulk actions unless explicitly allowed.

Example:

```text
POST /cases/bulk-assign
```

Must check:

```text
case:assign permission
subject can assign from current owner/team
subject can assign to target owner/team
all cases visible and mutable
state allows assignment
tenant boundary holds for every case
```

---

## 13. Delegation and Impersonation

Delegation and impersonation MUST be explicit and audited.

Rules:

- Impersonation requires special permission.
- Original actor and effective actor MUST both be recorded.
- Impersonated sessions MUST be visually and technically distinguishable.
- Impersonation MUST have scope, reason, expiry, and audit trail.
- Privileged impersonation SHOULD require step-up and approval.
- Some actions MUST be blocked during impersonation, e.g. changing credentials or approving own actions.

Audit fields:

```text
actor_subject_id
effective_subject_id
reason
scope
started_at
ended_at
approved_by
```

---

## 14. Segregation of Duties

Regulated systems MUST model segregation-of-duties rules explicitly.

Examples:

- creator cannot approve own request;
- investigator cannot be final approver;
- same officer cannot perform both recommendation and approval;
- user cannot grant themselves privileges;
- support actor cannot impersonate user and approve financial/legal action.

Rules:

- SoD rules MUST be part of authorization/domain policy.
- SoD failures MUST be audited.
- Break-glass override MUST require reason, approval, expiry, and review.

---

## 15. Service-to-Service Authorization

Service authentication is not enough.

Mandatory:

- Every service call MUST have caller identity.
- Callee MUST authorize caller for operation.
- Machine tokens MUST include audience.
- Service permissions MUST be least-privilege.
- User delegation context MUST be explicit when acting on behalf of user.
- Background jobs MUST run with dedicated service identity.

Bad:

```text
request comes from internal network -> allow
```

Good:

```text
caller = case-service
operation = document:read_metadata
resource = document
context = tenant + purpose + delegated_user_optional
policy allows only required action
```

---

## 16. Event and Message Authorization

Event-driven systems MUST authorize message production and consumption.

Rules:

- Producers MUST be authorized to emit event type.
- Consumers MUST be authorized to consume topic/event type.
- Event payload MUST not contain data unauthorized for intended consumers.
- Commands over messaging MUST authenticate and authorize producer.
- Replay consumers MUST respect authorization and data retention rules.
- Dead-letter topics MUST be protected as sensitive data.

Bad:

```text
Any service can publish UserRoleChanged event.
```

Good:

```text
Only identity-admin-service can publish UserRoleChanged, schema validated, signed or trusted via broker identity, audited.
```

---

## 17. Authorization Caching

Authorization caching is dangerous and MUST be designed explicitly.

Allowed only when:

- cache key includes subject, tenant, resource/action, relevant attributes, and policy version;
- TTL is short and justified;
- revocation/permission change propagation is defined;
- stale deny/allow behavior is documented;
- high-risk decisions are not cached or require revalidation.

Forbidden:

- cache only by user ID;
- cache allow decisions indefinitely;
- cache permissions without tenant context;
- ignore role/permission version changes.

---

## 18. Authorization Failure Semantics

Recommended behavior:

| Scenario                                           | Status                                  |
| -------------------------------------------------- | --------------------------------------- |
| Not authenticated                                  | 401                                     |
| Authenticated but lacks permission                 | 403                                     |
| Resource inaccessible and existence must be hidden | 404                                     |
| State transition not allowed                       | 409 or 403 depending on cause           |
| Step-up required                                   | 403/401 with machine-readable challenge |

Rules:

- Do not leak sensitive resource existence.
- Use consistent error schema.
- Log detailed denial reason internally.
- Return safe external reason.

---

## 19. Audit Requirements

Authorization decisions MUST be auditable for sensitive operations.

Log:

```text
event_id
correlation_id
subject_id
actor_type
effective_subject_id if delegated
resource_type
resource_id
action
tenant_id
policy_version
decision allow|deny|step_up_required
reason_code
request_id
source_service
timestamp
```

Mandatory audit events:

- denied access to sensitive resource;
- privileged operation success/failure;
- role/permission change;
- policy change;
- delegation/impersonation;
- export/download of sensitive data;
- bulk operation;
- break-glass access;
- workflow approval/rejection/escalation.

Forbidden:

- logging sensitive resource payload unnecessarily;
- logging secrets/tokens;
- allowing audit logs to be modified by normal application users.

---

## 20. Policy Administration

Policy changes are security-sensitive.

Mandatory:

- Only authorized administrators may change policy.
- Policy changes MUST be audited.
- High-risk policy changes SHOULD require approval.
- Policy version MUST be trackable.
- Rollback plan MUST exist.
- Tests MUST validate critical policy decisions.
- Production policy must not be edited manually without change control.

---

## 21. Common Anti-Patterns

### 21.1 Role-only authorization

Bad:

```java
@RequiresRole("ADMIN")
```

Why bad:

- Too coarse.
- Encourages god role.
- Ignores tenant/resource/state.

Required:

```text
permission + object-level + context + state
```

---

### 21.2 Gateway-only authorization

Bad:

```text
Gateway validates JWT and forwards all internal requests as trusted.
```

Why bad:

- Bypass path may exist.
- Internal service cannot defend itself.
- Object-level checks are usually service/domain-specific.

Required:

- Gateway performs coarse checks.
- Service performs business/resource authorization.

---

### 21.3 Frontend-only authorization

Bad:

```text
Hide delete button for non-admins.
```

Required:

- Backend rejects unauthorized delete request.

---

### 21.4 Fetch-then-filter

Bad:

```text
Load all records then remove unauthorized records in memory.
```

Why bad:

- Data already crossed boundary.
- Pagination/count leaks.
- Performance failure.

Required:

- Scope query before data retrieval.

---

### 21.5 Confused deputy

Bad:

```text
Service uses its own broad privilege to perform user-requested action without checking user's permission.
```

Required:

- Preserve delegated user context or explicitly model service-owned action.

---

### 21.6 Global admin

Bad:

```text
admin=true means all tenants, all actions, all data.
```

Required:

- Scoped admin role.
- Tenant/resource/action constraints.
- Step-up and audit.

---

### 21.7 Insecure direct object reference

Bad:

```http
GET /documents/123
```

with only authentication.

Required:

- Check subject can read document 123.

---

## 22. Testing Requirements

Authorization tests MUST include positive and negative cases.

Required tests:

- unauthenticated request rejected;
- authenticated but unauthorized request rejected;
- user cannot access another tenant's resource;
- user cannot access unassigned object;
- user with view cannot update/delete/approve;
- state transition denied from invalid state;
- creator cannot approve own request when SoD applies;
- bulk operation rejects unauthorized objects;
- search/count does not leak unauthorized data;
- frontend-hidden action still rejected by backend;
- service identity cannot call unauthorized service operation;
- expired/revoked permission no longer grants access;
- policy cache invalidates after permission change;
- delegated/impersonated access audited and constrained.

---

## 23. LLM Authorization Design Checklist

Before writing authorization code, the LLM MUST answer:

```text
1. What subjects exist?
2. What resources exist?
3. What actions exist per resource?
4. What tenant/security boundary applies?
5. Which policy model is used: RBAC, ABAC, ReBAC, ACL, hybrid?
6. What is the source of truth for permissions and relationships?
7. Where is policy enforced?
8. Are object-level checks required?
9. Are state transition checks required?
10. Are SoD rules required?
11. Is step-up authentication required for high-risk actions?
12. How are service-to-service calls authorized?
13. How are bulk/search/export endpoints protected?
14. How are denials represented externally and internally?
15. What is audited?
16. How is policy tested?
```

If these cannot be answered, the LLM MUST not proceed directly to implementation.

---

## 24. Reference Policy Matrix Template

```markdown
| Resource | Action      | Permission       | Object Rule                           | State Rule           | Tenant Rule       | Step-Up | Audit         |
| -------- | ----------- | ---------------- | ------------------------------------- | -------------------- | ----------------- | ------- | ------------- |
| Case     | View        | case:view        | assigned/supervisor/unit              | any non-deleted      | same tenant       | no      | read optional |
| Case     | Approve     | case:approve     | assigned approving unit               | PENDING_APPROVAL     | same tenant       | yes     | required      |
| Case     | Export      | case:export      | visible + export clearance            | closed/approved only | same tenant       | yes     | required      |
| User     | Impersonate | user:impersonate | target not privileged unless approved | active               | same tenant/scope | yes     | required      |
```

---

## 25. Acceptance Criteria

Authorization implementation is acceptable only if:

- default deny is enforced;
- every protected operation has server-side authorization;
- object-level authorization is implemented;
- tenant isolation is enforced in queries and commands;
- action permissions are separate from resource visibility;
- state transitions are authorized explicitly;
- roles do not directly become god-mode bypasses;
- service-to-service calls are authorized;
- frontend authorization is treated only as UX;
- bulk/search/export endpoints are protected;
- denials are safe and auditable;
- sensitive policy changes are controlled;
- negative tests prove unauthorized access is rejected.

---

## 26. Enforcement Snippet for LLM Agents

```text
When implementing authorization:
- Never assume authentication means access.
- Never trust frontend checks as security.
- Never rely only on gateway checks.
- Never fetch by raw ID without tenant/object authorization.
- Never use global admin bypass unless scoped, audited, and justified.
- Always evaluate subject + action + resource + context.
- Always enforce default deny.
- Always add negative tests for unauthorized access.
```

---

## 27. References

- OWASP Authorization Cheat Sheet.
- OWASP API Security Top 10 2023.
- OWASP Top 10 2025.
- NIST SP 800-63-4 Digital Identity Guidelines.
- OAuth 2.0 and OAuth 2.0 Security Best Current Practice.
- NIST secure software and access-control guidance where applicable.
