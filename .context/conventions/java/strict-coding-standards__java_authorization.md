# Strict Coding Standards — Java Authorization

> **Purpose**: Mandatory rules for LLM/code-agent implementation of authorization in Java applications.
>
> Authorization answers: **"Is this authenticated or anonymous caller allowed to perform this action on this resource in this context?"**
>
> This document is an overlay for Java, Spring Security, Spring Boot, JAX-RS/Jersey, Quarkus, HTTP, gRPC, persistence, security, logging, testing, and telemetry standards.

---

## 1. Scope

This standard applies to Java code that implements, configures, integrates with, or tests:

- role-based access control (RBAC)
- permission/scope checks
- attribute-based access control (ABAC)
- ownership checks
- tenant isolation
- object-level authorization
- function/action-level authorization
- policy engines
- method-level security
- endpoint security rules
- database row-level restrictions
- admin/privileged actions
- service-to-service authorization
- authorization audit events

Authentication is covered separately in `strict-coding-standards__java_authentication.md`.

---

## 2. Core Authorization Invariant

Every protected action must evaluate:

```text
subject + action + resource + context -> allow | deny
```

Where:

- **subject**: authenticated user/service/client/workload, including tenant/realm and assurance context
- **action**: operation being attempted, not just endpoint name
- **resource**: object/data/domain aggregate affected
- **context**: tenant, ownership, status/state, time, channel, assurance level, delegation, request origin, risk, and environment

If any part is missing, the decision must default to **deny**.

---

## 3. Mandatory Rules

### AUTHZ-MUST-001 — Deny by default

Access must be denied unless explicitly allowed.

Forbidden:

```java
if (!isBlocked(user)) {
    return data; // forbidden: allow-by-default
}
```

Required:

```java
if (!authorizationService.canViewCase(user, caseId)) {
    throw new AccessDeniedException("not allowed");
}
```

---

### AUTHZ-MUST-002 — Authorization is not UI logic

UI-hidden buttons, disabled fields, frontend route guards, or client-side filtering are not authorization.

Server-side authorization is mandatory for every protected operation.

---

### AUTHZ-MUST-003 — Authorization must be enforced close to the protected operation

Endpoint-level rules are necessary but often insufficient.

Required for state/data access:

- endpoint/function-level check
- object/resource ownership or tenant check
- domain state transition check
- persistence query constraint where applicable

Example:

```text
GET /cases/{caseId}
```

Must check:

- authenticated caller can call `viewCase`
- caller belongs to tenant/agency/role allowed for the case
- case status permits visibility if relevant
- query does not fetch cases across tenant boundary

---

### AUTHZ-MUST-004 — Object-level authorization is mandatory for user-controlled identifiers

Every endpoint that receives an object identifier from path, query, header, body, JWT claim, message, or event must verify authorization for that object.

High-risk identifiers:

- numeric IDs
- UUIDs
- encoded/global IDs
- file keys
- case numbers
- tenant IDs
- user IDs
- account IDs
- document IDs
- S3/object-storage keys

Forbidden:

```java
CaseEntity entity = caseRepository.findById(caseId).orElseThrow();
return mapper.toDto(entity); // missing object-level authorization
```

Required:

```java
CaseEntity entity = caseRepository.findVisibleCase(currentUser.tenantId(), currentUser.id(), caseId)
        .orElseThrow(NotFoundOrDeniedException::new);
return mapper.toDto(entity);
```

---

### AUTHZ-MUST-005 — Tenant boundary must be part of data access

For multi-tenant systems:

- tenant id must be included in queries
- tenant id from request must not be trusted blindly
- tenant id from token must be validated against issuer/context
- cross-tenant admin action must be explicit and audited
- cache keys must include tenant boundary

Forbidden:

```java
repository.findById(id); // in multi-tenant module, this is usually insufficient
```

Preferred:

```java
repository.findByTenantIdAndId(currentTenantId, id);
```

---

### AUTHZ-MUST-006 — Do not return forbidden data then filter later

Filtering unauthorized records in Java after fetching is restricted.

Forbidden by default:

```java
List<CaseEntity> all = repository.findAll();
return all.stream()
        .filter(c -> authorization.canView(user, c))
        .toList();
```

Required:

- push tenant/ownership/state constraints into query where possible
- fetch only authorized records
- use database index-friendly predicates
- test that unauthorized rows are not returned

---

### AUTHZ-MUST-007 — Authorization decision must be explicit and testable

Authorization logic must live in:

- policy/service object
- method security expression backed by tested methods
- domain policy
- external policy engine adapter
- database row-level security policy where intentionally used

It must not be scattered as ad hoc conditions across controllers.

---

## 4. Authorization Model Rules

### AUTHZ-MODEL-001 — RBAC alone is insufficient for object access

Roles answer: **"What category of capability does the subject have?"**

Object authorization also needs:

- ownership
- assignment
- tenant
- organization/agency
- case state
- delegation
- resource classification
- separation of duties

Forbidden:

```java
@PreAuthorize("hasRole('OFFICER')")
public CaseDto getCase(UUID caseId) { ... } // missing object-level check
```

Better:

```java
@PreAuthorize("@caseAuthorization.canView(authentication, #caseId)")
public CaseDto getCase(UUID caseId) { ... }
```

---

### AUTHZ-MODEL-002 — Permission names must be action-oriented

Permission names should express capabilities, not implementation details.

Preferred:

```text
case:view
case:create
case:update
case:approve
case:assign
case:close
document:download
document:delete
user:impersonate
```

Forbidden:

```text
CASE_CONTROLLER_GET
HAS_BUTTON_17
ADMIN_SCREEN_ACCESS
```

---

### AUTHZ-MODEL-003 — Scope is not automatically permission

OAuth scopes indicate delegated permission claims from an issuer.

A scope is only usable if:

- token issuer is trusted
- token audience is correct
- scope semantics are defined locally
- resource/action/context check still passes

Forbidden:

```java
if (jwt.getClaimAsStringList("scope").contains("case:write")) {
    updateAnyCase(caseId);
}
```

---

### AUTHZ-MODEL-004 — ABAC must be deterministic

Attribute-based access must define:

- allowed attributes
- authoritative source for attributes
- freshness/caching rules
- behavior when attribute is missing
- behavior when attribute conflicts
- test matrix

Missing attributes must deny unless explicitly documented otherwise.

---

### AUTHZ-MODEL-005 — Domain state transitions require authorization

State-changing operations must validate:

- actor may perform action
- resource is in valid state
- actor satisfies assignment/role/tenant rules
- transition is allowed by state machine
- side effects are allowed

Example:

```text
Only assigned enforcement officer may submit draft inspection report.
Only supervisor may approve submitted report.
Closed case cannot be edited except reopen flow.
```

---

## 5. Spring Security Authorization Rules

### AUTHZ-SPRING-001 — Endpoint rules must be ordered and explicit

Spring Security request matchers must:

- permit only explicitly public endpoints
- authenticate protected endpoints
- deny all unmatched endpoints
- avoid broad wildcard before specific rules

Required pattern:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/actuator/health", "/actuator/info").permitAll()
    .requestMatchers(HttpMethod.GET, "/api/cases/**").authenticated()
    .anyRequest().denyAll()
)
```

---

### AUTHZ-SPRING-002 — Method security must be used for domain-sensitive operations

Endpoint-level security is insufficient for:

- object ownership
- tenant isolation
- admin operation
- state transition
- export/download
- mass update

Use method security or explicit authorization service.

Examples:

```java
@PreAuthorize("@caseAuthorization.canView(authentication, #caseId)")
public CaseDto getCase(UUID caseId) { ... }
```

```java
authorization.requireCanApprove(currentUser, caseEntity);
caseEntity.approve(currentUser.id());
```

---

### AUTHZ-SPRING-003 — Do not trust `hasRole` for full policy

`hasRole` or `hasAuthority` is acceptable only for simple function-level access.

It is not enough for:

- object-level access
- tenant-level access
- ownership
- record state
- admin impersonation
- data export

---

### AUTHZ-SPRING-004 — SpEL expressions must not become unreadable policy code

Complex policy logic must be moved to named policy methods.

Forbidden:

```java
@PreAuthorize("hasRole('ADMIN') or (hasAuthority('CASE_VIEW') and #tenantId == authentication.details.tenantId and @svc.check(authentication,#id) and !@risk.blocked(#id))")
```

Preferred:

```java
@PreAuthorize("@caseAuthorization.canView(authentication, #caseId)")
```

---

## 6. JAX-RS / Jersey / Quarkus Authorization Rules

### AUTHZ-JAXRS-001 — Security annotations must be verified against runtime

Annotations such as:

- `@RolesAllowed`
- `@PermitAll`
- `@DenyAll`
- Quarkus security annotations

must be confirmed active in the runtime.

Forbidden:

- adding annotation without enabling security integration
- assuming annotation works in tests only
- using annotation for object-level policy alone

---

### AUTHZ-JAXRS-002 — Resource methods remain thin

Authorization in resource methods may call policy service, but must not embed complex policy.

Allowed:

```java
caseAuthorization.requireCanView(currentUser, caseId);
return caseService.get(caseId);
```

Forbidden:

```java
if (user.getRole().equals("OFFICER") && case.getAgency().equals(user.getAgency()) && ... ) {
    ...
}
```

---

## 7. Database and Persistence Rules

### AUTHZ-DATA-001 — Queries must encode authorization constraints

For read operations, queries should include authorization constraints where possible:

- tenant id
- owner id
- assignment id
- agency id
- visibility status
- classification level

This reduces accidental data exposure and improves performance.

---

### AUTHZ-DATA-002 — Do not rely on hidden ORM filters without tests

Hibernate filters, tenant resolvers, soft-delete filters, and row-level policies are allowed only if:

- enabled consistently in all entry points
- tested for bypass
- documented
- included in integration tests
- included in admin/batch jobs behavior

---

### AUTHZ-DATA-003 — Caches must preserve authorization boundary

Cache keys must include every authorization dimension that affects data visibility.

High-risk cache keys:

```text
case:{caseId}                         // unsafe if tenant/visibility differs
profile:{userId}                       // unsafe if caller-specific redaction exists
search:{queryHash}                     // unsafe if caller/tenant not included
```

Preferred:

```text
tenant:{tenantId}:case:{caseId}
user:{userId}:visible-cases:{queryHash}
```

Do not cache authorization decisions beyond their safe freshness window.

---

## 8. API Authorization Rules

### AUTHZ-API-001 — `401` and `403` must be used correctly

- `401`: unauthenticated, invalid, missing, or expired credentials
- `403`: authenticated but not allowed

For object-level denial, returning `404` may be acceptable to prevent object enumeration, but must be consistent and documented.

---

### AUTHZ-API-002 — Mass assignment must be blocked

DTOs must not allow users to set protected fields.

Forbidden request fields from normal users:

- `role`
- `permissions`
- `ownerId`
- `tenantId`
- `approvedBy`
- `status` when state transition must be controlled
- `createdBy`
- `isAdmin`
- `priceOverrideApproved`

Use command-specific DTOs.

---

### AUTHZ-API-003 — Bulk operations require per-item authorization

Bulk operations must verify every item.

Required:

- reject entire batch on any unauthorized item, or
- return per-item result with no unauthorized side effect

Do not authorize only the collection endpoint.

---

### AUTHZ-API-004 — Export/download endpoints are high risk

Export/download must validate:

- caller can export
- caller can access every included record
- export size/rate limits
- tenant boundary
- data classification
- audit event
- redaction policy

---

## 9. Service-to-Service Authorization Rules

### AUTHZ-SERVICE-001 — Service identity is not user authority

A service token identifies the calling service, not necessarily the end user.

Required:

- define whether action is service-initiated or user-delegated
- validate token audience
- validate service/client permission
- validate user context if delegated
- prevent confused deputy problem

---

### AUTHZ-SERVICE-002 — Downstream services must enforce their own authorization

Do not assume upstream authorization is sufficient unless architecture explicitly defines a trusted boundary and signed/verified decision.

Preferred:

- downstream validates token/identity
- downstream validates resource/action policy
- gateway policy is defense-in-depth, not sole control for sensitive object access

---

## 10. Policy Engine Rules

### AUTHZ-POLICY-001 — External policy engine must fail closed

If using OPA, Cedar, XACML, custom PDP, or remote policy service:

- define input schema
- validate policy response signature/trust where applicable
- timeout explicitly
- fail closed for protected operations
- cache only safe decisions
- include policy version in audit
- test policy drift

---

### AUTHZ-POLICY-002 — Policy decision must be explainable

Authorization denial should produce internal reason code:

- missing role/permission
- wrong tenant
- not owner/assignee
- invalid state
- insufficient assurance
- policy service unavailable

External response must not leak sensitive policy internals.

---

## 11. Audit and Telemetry Rules

### AUTHZ-AUDIT-001 — Sensitive authorization decisions must be audited

Audit required for:

- admin action
- privilege change
- role/permission grant/revoke
- tenant switch
- impersonation
- data export
- failed access to sensitive object
- policy override
- emergency/break-glass access

Audit event should include:

- actor subject
- action
- resource id/type
- tenant/context
- decision
- reason code
- policy version
- correlation id
- timestamp

Do not include sensitive payload unless explicitly required and protected.

---

## 12. Testing Requirements

Authorization tests must include:

- unauthenticated caller
- authenticated but no permission
- correct role but wrong tenant
- correct role but wrong owner/assignee
- correct role but invalid resource state
- horizontal privilege escalation attempt
- vertical privilege escalation attempt
- user-controlled ID tampering
- batch with mixed authorized/unauthorized IDs
- cache boundary test
- method security direct-call test
- repository query tenant isolation test
- admin override audit test

At least one negative test must prove that changing an object id does not expose another user's/tenant's object.

---

## 13. Forbidden Patterns

Forbidden by default:

- allow-by-default authorization
- controller-only ad hoc checks for complex policy
- `hasRole('USER')` as object authorization
- trusting frontend hidden fields/buttons
- trusting user-supplied tenant/owner/role
- fetching by id without tenant/ownership constraint in multi-tenant modules
- returning all data then filtering in Java for authorization
- caching data without tenant/caller dimension
- using JWT scopes as full authorization without local resource policy
- assuming API gateway check is enough for object-level access
- silent authorization fallback on policy service failure
- admin/batch job bypass without explicit documented policy
- disabling method security tests
- returning different object-existence errors inconsistently

---

## 14. LLM Implementation Protocol

Before implementing protected behavior, the agent must answer:

```text
1. What action is being protected?
2. What resource/object is affected?
3. Who is the subject?
4. What tenant/realm/organization boundary applies?
5. What role/permission/scope is necessary but not sufficient?
6. What object-level rule applies? owner, assignee, agency, state, classification?
7. Where is the authorization enforced? endpoint, service, repository, policy engine?
8. What is the fail-closed behavior?
9. What audit event is emitted?
10. What negative tests prove denial?
```

If the agent cannot answer, it must not implement protected functionality.

---

## 15. Reviewer Checklist

- [ ] Authentication and authorization are separated.
- [ ] Access is deny-by-default.
- [ ] Every protected action has subject/action/resource/context policy.
- [ ] Object-level authorization exists for every user-controlled id.
- [ ] Tenant boundary is enforced in data access.
- [ ] Roles/scopes are not used as the only object-level check.
- [ ] Queries fetch only authorized data where possible.
- [ ] Cache keys preserve tenant/caller/policy boundary.
- [ ] Bulk/export operations check every affected resource.
- [ ] Policy failure fails closed.
- [ ] Sensitive decisions emit audit events.
- [ ] Negative tests cover horizontal and vertical escalation.
- [ ] `401` and `403` behavior is correct and documented.

---

## 16. References

- OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Top 10 2025 Broken Access Control — https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/
- OWASP API Security Top 10 2023 Broken Object Level Authorization — https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- OWASP API Security Top 10 2023 — https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- Spring Security Authorization Reference — https://docs.spring.io/spring-security/reference/servlet/authorization/index.html
- Spring Security Reference — https://docs.spring.io/spring-security/reference/index.html
- RFC 9110 HTTP Semantics — https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9700 OAuth 2.0 Security Best Current Practice — https://datatracker.ietf.org/doc/rfc9700/
