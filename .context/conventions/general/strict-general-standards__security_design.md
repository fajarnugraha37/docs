# Strict General Standards: Security Design

> File: `strict-general-standards__security_design.md`  
> Category: General Engineering Standard  
> Principle: Secure-by-design architecture, threat modeling, trust boundaries, risk control, and defensible implementation  
> Status: Mandatory for LLM-assisted architecture design, implementation, refactoring, review, testing, and documentation

---

## 1. Purpose

This standard defines how an LLM code agent MUST design secure systems before writing or changing code.

The goal is to make security part of the design model itself, not a patch applied after implementation. Security design must identify assets, actors, abuse cases, trust boundaries, data flows, authorization decisions, operational controls, and failure behavior before implementation choices become fixed.

This standard applies to:

- new systems;
- new services;
- new modules;
- new endpoints;
- new background jobs;
- new event consumers/producers;
- new database schemas;
- new integrations;
- refactoring of security-sensitive flows;
- authentication and authorization changes;
- data export/import;
- file handling;
- API gateway policy;
- cloud/infrastructure changes;
- CI/CD and supply chain changes;
- LLM-generated architecture, code, tests, and documentation.

This standard MUST be read together with:

- `strict-general-standards__owasp.md`;
- `strict-general-standards__restfull_api.md`;
- `strict-general-standards__open_api.md`;
- `strict-general-standards__web.md`;
- `strict-general-standards__http_for_web.md`;
- `strict-general-standards__microservices_pattern.md`;
- `strict-general-standards__microservices_anti_pattern.md`;
- `strict-general-standards__api_gateway.md`;
- `strict-general-standards__reverse_proxy.md`;
- `strict-general-standards__forward_proxy.md`;
- `strict-general-standards__nginx.md`;
- `strict-general-standards__kong.md`.

---

## 2. Source Baseline

The LLM MUST align security design with these baseline references:

- OWASP Threat Modeling guidance.
- OWASP Application Security Verification Standard.
- OWASP Cheat Sheet Series.
- OWASP Top 10 Web Application Security Risks.
- OWASP API Security Top 10.
- NIST Secure Software Development Framework, also called SSDF.
- NIST SP 800-160 Volume 1, Engineering Trustworthy Secure Systems.
- NIST SP 800-160 Volume 2, Developing Cyber-Resilient Systems, when resilience is relevant.
- NIST Zero Trust Architecture, when identity, network segmentation, or continuous authorization is relevant.
- Enterprise security, privacy, compliance, audit, retention, and incident response policies.

---

## 3. Core Interpretation

### 3.1 Secure design is about constraints, not decoration

Security design is the discipline of shaping system behavior so that unsafe actions are hard, visible, limited, and recoverable.

The LLM MUST design controls into the system model:

- who can act;
- what they can act on;
- when they can act;
- from where they can act;
- under what state conditions;
- with what evidence;
- with what audit trace;
- with what failure behavior;
- with what recovery path.

### 3.2 Security design precedes security implementation

The LLM MUST NOT start with code before understanding the security design for any sensitive change.

Implementation details such as middleware, filters, libraries, interceptors, annotations, and plugins are not the design itself. They are enforcement mechanisms for a design.

### 3.3 Security is system behavior under adversarial conditions

The LLM MUST reason about malicious, mistaken, automated, compromised, and concurrent behavior.

The design MUST consider:

- malicious external users;
- malicious insiders;
- compromised accounts;
- compromised service credentials;
- replayed requests;
- tampered messages;
- stale sessions;
- race conditions;
- partial failures;
- dependency compromise;
- logging blind spots;
- operational mistakes;
- misconfiguration;
- abnormal volume;
- data leakage through errors, caches, exports, logs, metrics, and analytics.

### 3.4 Trust must be earned continuously

The LLM MUST NOT treat network location, service name, UI route, client type, or gateway forwarding as sufficient trust.

Trust MUST be explicit, scoped, time-limited, and verified at the correct boundary.

---

## 4. Mandatory Security Design Process

For any security-relevant work, the LLM MUST follow this process.

### 4.1 Define the protected assets

The LLM MUST identify what must be protected.

Asset examples:

- user identity;
- session tokens;
- API keys;
- personal data;
- regulated data;
- case records;
- documents;
- financial data;
- audit logs;
- configuration;
- source code;
- build artifacts;
- database credentials;
- encryption keys;
- admin actions;
- workflow state;
- business decisions;
- system availability;
- third-party quotas;
- reputation and legal obligations.

The LLM MUST NOT design security without naming assets.

### 4.2 Classify the data

The LLM MUST classify data according to sensitivity.

Minimum classification model:

| Class        | Description                       | Examples                                                       | Required design response                                               |
| ------------ | --------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Public       | Intended for public access        | public docs, public status                                     | integrity and availability controls                                    |
| Internal     | Not public but low sensitivity    | internal IDs, non-sensitive metadata                           | access control and logging                                             |
| Confidential | Harmful if exposed                | user records, business data, documents                         | strict access, encryption, minimization, audit                         |
| Restricted   | High impact/regulatory/privileged | credentials, keys, regulated identifiers, privileged case data | strongest access, encryption, monitoring, approval, retention controls |

The LLM MUST minimize data collection, storage, transmission, logging, and exposure.

### 4.3 Identify actors

The LLM MUST identify actors and their security meaning.

Actor examples:

- anonymous user;
- authenticated user;
- privileged user;
- administrator;
- support operator;
- auditor;
- external partner;
- machine client;
- scheduled job;
- event consumer;
- webhook sender;
- internal service;
- database migration;
- CI/CD pipeline;
- attacker;
- compromised account;
- malicious insider.

The LLM MUST distinguish human identity, service identity, and delegated identity.

### 4.4 Draw the system boundary

The LLM MUST define what is inside and outside the system.

Boundary examples:

- browser to API gateway;
- API gateway to service;
- service to database;
- service to object storage;
- service to queue;
- internal service to external API;
- CI pipeline to artifact registry;
- admin portal to privileged endpoint;
- batch job to production database;
- support tool to customer data;
- webhook sender to receiver.

The LLM MUST explicitly mark trust boundaries.

### 4.5 Model data flows

The LLM MUST model how sensitive data moves.

A minimal flow description MUST include:

```md
Flow: <name>
Source actor/system: <source>
Entry point: <endpoint/topic/job/file>
Authentication: <mechanism>
Authorization: <decision>
Data received: <fields/classification>
Data stored: <location/classification>
Data sent: <destination/classification>
Trust boundaries crossed: <list>
Failure behavior: <safe behavior>
Audit events: <events>
```

### 4.6 Identify threats

The LLM MUST identify likely threats using a structured method.

Recommended method:

| STRIDE category        | Question                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Spoofing               | Can an actor pretend to be another actor or service?                                       |
| Tampering              | Can data, requests, messages, config, or artifacts be modified?                            |
| Repudiation            | Can an actor deny a sensitive action because evidence is missing?                          |
| Information disclosure | Can sensitive data leak through responses, logs, errors, cache, exports, or side channels? |
| Denial of service      | Can resource consumption degrade or disable service?                                       |
| Elevation of privilege | Can a lower-privilege actor gain higher privilege or access another tenant/object?         |

The LLM MAY use PASTA, attack trees, misuse cases, or other structured methods when more appropriate.

### 4.7 Define mitigations

For each material threat, the LLM MUST define:

- preventive control;
- detective control;
- recovery/response control;
- test or verification evidence;
- residual risk.

Example:

```md
Threat: user changes object ID to access another user's document.
Preventive control: server-side object-level authorization in DocumentPolicy.canRead.
Detective control: audit denied access attempts with actor ID, object ID hash, tenant, request ID.
Verification: test user A cannot access user B document by path tampering.
Residual risk: compromised privileged account can still access; mitigated by privileged audit and review.
```

### 4.8 Make release decision explicit

The LLM MUST categorize unresolved risk:

| Risk state | Meaning                                          | Release decision                     |
| ---------- | ------------------------------------------------ | ------------------------------------ |
| Blocker    | Known exploitable or high-impact gap             | MUST NOT release                     |
| High       | Serious gap with compensating control incomplete | Requires explicit risk acceptance    |
| Medium     | Controlled but not ideal                         | Can release with tracked remediation |
| Low        | Minor residual risk                              | Can release with normal tracking     |
| Accepted   | Business accepted with owner/date                | Must be documented                   |

The LLM MUST NOT hide unresolved security risk in vague notes.

---

## 5. Secure Design Principles

### 5.1 Deny by default

Access MUST be denied unless explicitly allowed.

Default states:

- endpoint not listed as public means protected;
- missing role means no privilege;
- missing tenant means no access;
- missing policy means deny;
- failed token validation means unauthenticated;
- failed config validation means startup failure;
- failed key lookup means no decryption/signing;
- failed authorization dependency means deny, not allow.

### 5.2 Least privilege

Every actor, service, token, role, job, database user, CI credential, and cloud permission MUST receive only the access needed.

The LLM MUST avoid:

- global admin permissions;
- wildcard IAM policies;
- broad database grants;
- shared service accounts;
- long-lived personal tokens;
- all-tenant support access without audit;
- write permissions for read-only flows.

### 5.3 Complete mediation

Every access to a protected resource MUST be checked at the time of access.

The LLM MUST NOT rely only on:

- previous screen checks;
- cached frontend permissions;
- route visibility;
- gateway routing;
- object IDs being hard to guess;
- earlier workflow steps;
- client-provided role or tenant fields.

### 5.4 Defense in depth

The LLM MUST design multiple independent controls for high-risk paths.

Example for document download:

- authenticated session;
- object-level authorization;
- tenant isolation;
- expiring signed URL;
- safe content headers;
- audit log;
- anomaly detection for bulk downloads;
- storage bucket policy preventing public access.

### 5.5 Secure defaults

The default configuration MUST be safe.

Examples:

- debug disabled;
- no public admin endpoint;
- no default admin password;
- no wildcard CORS with credentials;
- no anonymous write access;
- no public object storage bucket;
- no verbose errors;
- no unauthenticated metrics unless intentionally protected by network and auth controls;
- no automatic trust of forwarded headers without trusted proxy configuration.

### 5.6 Fail securely

Failures MUST not bypass security controls.

Mandatory behavior:

- auth service unavailable -> protected action denied;
- policy engine unavailable -> protected action denied;
- audit log unavailable for critical action -> block or queue according to risk policy;
- token validation error -> reject;
- secret missing -> startup fails;
- schema validation fails -> reject input;
- downstream timeout -> no unsafe fallback.

### 5.7 Minimize attack surface

The LLM MUST remove unnecessary exposure.

Reduce:

- endpoints;
- public routes;
- HTTP methods;
- admin interfaces;
- dependencies;
- plugins;
- open ports;
- service permissions;
- data fields;
- logs;
- network paths;
- generated files;
- feature flags;
- debug modes.

### 5.8 Separation of duties

High-impact operations SHOULD separate request, approval, execution, and audit responsibilities.

Examples:

- privileged role assignment;
- financial approval;
- enforcement decision override;
- data deletion;
- bulk export;
- audit log access;
- production secret rotation;
- deployment approval.

### 5.9 Least common mechanism

The LLM SHOULD avoid shared components that couple security fate across unrelated domains.

Avoid:

- one shared database user for every service;
- one global admin token for all jobs;
- one shared bucket for unrelated data classes;
- one shared encryption key for all tenants and data types;
- one gateway plugin containing domain-specific authorization for every service;
- one common library with hidden privileged behavior.

### 5.10 Explicit trust boundary

Every time data crosses a boundary, the LLM MUST re-evaluate trust.

Crossing examples:

- client to server;
- gateway to service;
- service to service;
- service to database;
- service to queue;
- queue to consumer;
- service to third-party;
- partner webhook to system;
- CI to production;
- admin UI to privileged operation.

### 5.11 Zero trust compatible design

The LLM SHOULD design as if network location alone is insufficient.

Required implications:

- authenticate service-to-service calls where risk warrants;
- authorize service operations;
- scope credentials;
- validate tokens/claims;
- limit lateral movement;
- log service identity;
- avoid implicit trust in internal headers;
- segment network access.

---

## 6. Security Design by System Area

### 6.1 API endpoint design

Every endpoint design MUST define:

- public/protected/admin/internal classification;
- authentication mechanism;
- function-level authorization;
- object-level authorization;
- tenant boundary;
- request schema;
- response schema;
- rate/resource limits;
- idempotency/replay behavior;
- audit events;
- safe error responses.

Endpoint template:

```md
Endpoint: <method path>
Exposure: public | authenticated | internal | admin | partner
Authentication: <mechanism>
Authorization: <policy/action/object>
Tenant source: <server-side derived / explicitly validated>
Request constraints: <schema/limits>
Response exposure: <fields/classification>
Rate/resource limit: <limit>
Idempotency: <required/not required>
Audit: <event>
OWASP risks: <risks>
```

### 6.2 Authentication design

The LLM MUST design authentication around identity proof, token lifecycle, and session lifecycle.

Mandatory design questions:

- Who authenticates?
- What credential is used?
- Who issues the token/session?
- How is the token validated?
- What is the token audience?
- How long does it live?
- How is it revoked?
- How is credential recovery handled?
- How is brute force controlled?
- How are privileged users protected?

### 6.3 Authorization design

The LLM MUST design authorization around subject, action, object, context, and state.

Authorization decision shape:

```text
Can <subject> perform <action> on <object> in <context> while object is in <state>?
```

Examples:

```text
Can officer-123 approve case-456 in tenant-CEA when case status is SUBMITTED and officer is assigned reviewer?
```

```text
Can service-reporting export application-789 when requester has EXPORT_APPLICATION privilege and export reason is recorded?
```

Mandatory rules:

- Roles alone are not enough for object-specific decisions.
- Tenant ID from client is not trusted unless explicitly authorized.
- Domain state must be part of sensitive authorization decisions.
- Delegation and acting-on-behalf-of must be explicit.
- Break-glass access must be audited and reviewed.

### 6.4 Multi-tenancy design

The LLM MUST make tenant isolation explicit.

Required decisions:

- tenant identifier source;
- tenant resolution mechanism;
- tenant propagation;
- database isolation model;
- cache key isolation;
- object storage isolation;
- queue/topic isolation;
- search index isolation;
- audit tenant tagging;
- support/admin cross-tenant access rules.

Forbidden:

```text
Accept tenantId from request body and use it as-is for queries.
```

Required:

```text
Derive tenant from authenticated context or authorized route context; validate user/service access before applying tenant-scoped query.
```

### 6.5 State machine security

For workflows, the LLM MUST protect transitions, not only records.

Each transition MUST define:

- allowed source states;
- target state;
- actor permissions;
- object ownership/assignment;
- required evidence;
- concurrency rule;
- audit event;
- rollback/compensation rule;
- notification rule;
- timeout/expiry rule.

Forbidden:

```pseudo
case.status = request.status
```

Required:

```pseudo
transition = stateMachine.requireAllowed(currentState, requestedAction)
policy.requireCanExecute(currentUser, case, transition)
case.apply(transition)
audit.record(transition)
```

### 6.6 Event-driven design security

Events and messages MUST be treated as untrusted input unless produced and consumed within a fully controlled and authenticated boundary.

Mandatory rules:

- authenticate producers when applicable;
- authorize publishing where applicable;
- validate message schema;
- include event ID;
- ensure idempotency;
- protect against replay;
- avoid sensitive data in events unless necessary;
- encrypt or restrict sensitive topics;
- use DLQ safely;
- log processing failures without dumping sensitive payloads;
- document event ownership.

### 6.7 File design security

File flows MUST define:

- who can upload;
- allowed type;
- allowed size;
- storage location;
- scanning requirement;
- metadata handling;
- filename policy;
- access policy;
- retention policy;
- download audit;
- deletion policy.

### 6.8 Search and filtering design

Search endpoints are high-risk because they can expose bulk data.

Mandatory rules:

- apply tenant and authorization filters server-side;
- limit page size;
- restrict sort fields;
- restrict filter fields;
- protect expensive queries;
- avoid exposing internal query language;
- redact sensitive fields;
- audit bulk export-like behavior;
- rate limit scraping-prone endpoints.

### 6.9 Reporting/export design

Reports and exports MUST define:

- requester identity;
- purpose/reason;
- data scope;
- authorization;
- row limit;
- async job behavior;
- storage location;
- expiry;
- audit event;
- download access;
- redaction rules.

### 6.10 Admin and support tooling design

Admin tools MUST be more secure than user-facing tools, not less.

Mandatory controls:

- strong authentication;
- MFA for privileged access where appropriate;
- role separation;
- least privilege;
- approval for high-impact actions;
- break-glass procedure;
- audit logs;
- session timeout;
- IP/device restrictions where appropriate;
- no direct database mutation UI without domain validation.

### 6.11 Integration design

External integrations MUST define:

- trust relationship;
- authentication mechanism;
- authorization/scope;
- request signing if needed;
- replay protection;
- timeout;
- retry policy;
- rate/usage limits;
- data classification;
- error handling;
- reconciliation;
- audit logging;
- incident response owner.

### 6.12 CI/CD and supply chain design

The LLM MUST treat CI/CD as privileged infrastructure.

Mandatory rules:

- least-privilege pipeline credentials;
- protected branches;
- code review gates;
- dependency scanning;
- container scanning;
- secret scanning;
- artifact provenance;
- environment separation;
- deployment approval for production;
- no long-lived broad credentials in CI;
- no unpinned untrusted actions/plugins for production build.

### 6.13 Observability design

Security observability MUST be designed explicitly.

Required signals:

- failed authentication;
- failed authorization;
- privileged action;
- policy change;
- role change;
- bulk export;
- unusual access volume;
- rate limit hit;
- suspicious input rejection;
- SSRF rejection;
- file upload rejection;
- admin login;
- secret/config change;
- service-to-service auth failure.

Observability MUST avoid leaking secrets or sensitive personal data.

---

## 7. Threat Modeling Requirements

### 7.1 When threat modeling is required

The LLM MUST perform at least lightweight threat modeling when work involves:

- authentication;
- authorization;
- sensitive data;
- external exposure;
- third-party integration;
- public API;
- admin functionality;
- file upload/download;
- URL fetching;
- payment/financial workflow;
- case/enforcement/regulatory decisions;
- bulk export;
- identity provider changes;
- cryptography;
- secrets;
- infrastructure/network exposure;
- CI/CD credentials;
- multi-tenant access;
- event-driven cross-service workflows.

### 7.2 Lightweight threat model template

The LLM SHOULD include this for medium/high-risk work:

```md
## Lightweight Threat Model

### Assets

- ...

### Actors

- ...

### Entry Points

- ...

### Trust Boundaries

- ...

### Data Classification

- ...

### Main Threats

| Threat | Impact | Control | Test/Evidence | Residual Risk |
| ------ | -----: | ------- | ------------- | ------------- |
| ...    |    ... | ...     | ...           | ...           |

### Security Decision

- Blocker: ...
- Accepted assumptions: ...
- Required follow-up: ...
```

### 7.3 Data flow diagram requirement

For complex flows, the LLM MUST create or request a data flow diagram.

Minimum DFD elements:

- external entities;
- processes;
- data stores;
- data flows;
- trust boundaries;
- authentication points;
- authorization decision points;
- sensitive data locations.

Textual DFD is acceptable when diagram tooling is unavailable.

Example:

```text
[Browser User]
  -- HTTPS + session cookie -->
[API Gateway]
  -- JWT propagated, correlation ID -->
[Case Service]
  -- policy-checked SQL query -->
[Case DB]
  -- signed URL request -->
[Document Service]
  -- object read -->
[Private Object Storage]
```

### 7.4 Abuse case requirement

For sensitive features, the LLM MUST list abuse cases.

Example abuse cases:

- user changes ID to read another user's record;
- lower role calls admin endpoint directly;
- attacker automates OTP attempts;
- attacker uploads script disguised as image;
- compromised service token calls all tenants;
- support user exports excessive records;
- webhook replay creates duplicate transaction;
- stale approval link changes state after expiry;
- race condition approves same item twice;
- gateway route exposes internal endpoint.

---

## 8. Secure Design for Common Failure Modes

### 8.1 Authentication dependency unavailable

Default behavior: deny protected access.

Do not:

- allow anonymous fallback;
- trust stale token indefinitely;
- disable token validation;
- switch to default admin.

May do:

- serve public content;
- allow cached low-risk reads if policy explicitly permits;
- degrade non-sensitive functionality;
- return safe temporary error.

### 8.2 Authorization dependency unavailable

Default behavior: deny sensitive actions.

High-risk actions MUST not proceed without policy evaluation.

### 8.3 Audit logging unavailable

For high-risk operations, the design MUST choose:

- block action until audit available;
- queue audit event reliably;
- record to fallback tamper-resistant sink;
- explicitly accept risk for low-impact actions.

The LLM MUST not silently drop audit logs for privileged actions.

### 8.4 Database failure

The design MUST prevent partial security bypass.

Rules:

- failed read of policy data -> deny if required for authorization;
- failed transaction -> no state transition;
- retry only safe/idempotent operations;
- avoid duplicate side effects;
- preserve audit intent where possible.

### 8.5 Message processing failure

Event consumers MUST handle:

- duplicates;
- out-of-order messages;
- poison messages;
- schema mismatch;
- replay;
- missing referenced object;
- unauthorized producer;
- DLQ exposure.

### 8.6 Cache failure or staleness

Caches MUST not violate authorization.

Mandatory rules:

- cache key includes tenant/security-relevant dimensions;
- do not cache personalized sensitive responses publicly;
- invalidate or bound TTL for permission-sensitive data;
- do not use stale allow decisions for high-risk actions unless explicitly designed;
- safe behavior on cache miss.

### 8.7 Rate limiting failure

If rate limit infrastructure fails, high-risk flows SHOULD fail closed or degrade conservatively.

Examples:

- login attempts;
- OTP;
- password reset;
- expensive search;
- export;
- webhook ingestion;
- public write endpoint.

### 8.8 Time and replay failure

The design MUST protect time-sensitive operations.

Mandatory rules:

- tokens/links have expiry;
- expiry checked server-side;
- one-time tokens cannot be reused;
- idempotency keys prevent duplicate mutation;
- nonces or signatures used where appropriate;
- clock skew considered for distributed systems.

---

## 9. Security Design Patterns

### 9.1 Policy object / authorization service

Use explicit policy logic for domain-sensitive authorization.

```pseudo
policy.requireCanApprove(user, case)
```

Policy logic SHOULD be testable and close to domain semantics.

### 9.2 Command object for mutations

Use explicit command/request models for state changes.

```pseudo
ApproveCaseCommand(caseId, decision, reason, version)
```

Do not expose persistence entities as mutation input.

### 9.3 Server-derived ownership

Derive user, tenant, and role from trusted server-side context, not request body.

### 9.4 Security event logging

Emit structured security events for important actions.

```json
{
  "eventType": "CASE_APPROVAL_DENIED",
  "actorId": "user-123",
  "tenantId": "tenant-1",
  "resourceType": "case",
  "resourceIdHash": "...",
  "reason": "not_assigned_reviewer",
  "requestId": "...",
  "timestamp": "..."
}
```

### 9.5 Idempotent mutation

Use idempotency keys or natural idempotency for retry-prone operations.

Required for:

- payment;
- submission;
- approval;
- webhook processing;
- external side effects;
- event consumers;
- long-running job creation.

### 9.6 Transactional outbox

Use transactional outbox when a database state change must reliably produce an event.

Avoid dual-write:

```text
DB commit succeeded, event publish failed.
```

### 9.7 Anti-corruption layer

Use an anti-corruption layer when consuming external or legacy models.

Security benefit:

- validates external data;
- prevents leaking external trust assumptions into domain model;
- isolates unsafe or unstable integration semantics.

### 9.8 Secure facade for dangerous capability

Wrap dangerous operations behind a narrow interface.

Examples:

- URL fetcher with SSRF protection;
- file storage service with safe naming and access control;
- crypto service using approved primitives;
- audit service preventing secret logging;
- email template renderer with context escaping.

### 9.9 Break-glass access

Break-glass access MUST be explicit and audited.

Required fields:

- actor;
- reason;
- resource;
- duration;
- approval if required;
- event log;
- post-action review.

### 9.10 Privileged workflow approval

Use dual control for high-impact actions.

Examples:

- role assignment;
- data deletion;
- mass export;
- enforcement override;
- production config change;
- key rotation;
- user impersonation.

---

## 10. Security Design Anti-Patterns

The LLM MUST reject these designs.

### 10.1 Security after implementation

Writing code first, then asking how to secure it.

### 10.2 Trusting the frontend

Relying on UI state, hidden buttons, disabled fields, frontend routes, or local storage permissions.

### 10.3 Role-only authorization

Using coarse roles without object, tenant, action, and state context.

### 10.4 Client-supplied tenant

Using `tenantId`, `organizationId`, `ownerId`, or `userId` from request body as trusted security context.

### 10.5 Gateway-only authorization

Putting all authorization in the gateway while backend services accept trusted headers blindly.

### 10.6 Shared admin service account

Using one powerful credential across services, jobs, and deployments.

### 10.7 Audit as debug logs

Treating normal application logs as sufficient audit evidence.

### 10.8 Encryption as a substitute for access control

Encrypting data but allowing overly broad access to keys or decrypted views.

### 10.9 Validation as authorization

Checking that an ID is well-formed but not checking whether the actor can access it.

### 10.10 Availability without abuse control

Exposing expensive endpoints without limits, assuming normal users only.

### 10.11 Hidden privileged path

Adding maintenance endpoints, debug routes, backdoors, or feature flags without authentication, authorization, and audit.

### 10.12 Unsafe fallback

Allowing access when auth, policy, config, or audit dependencies fail.

### 10.13 Security by obscurity

Depending on unguessable URLs, hidden IDs, private route names, or non-public documentation.

### 10.14 Copy-pasted security snippets

Copying security filters, annotations, middleware, or gateway plugins without understanding the protected asset and policy.

### 10.15 Unreviewed dependency magic

Adding a security library and assuming it solves the design problem automatically.

---

## 11. Required Security Design Output

For medium/high-risk work, the LLM MUST produce a security design section.

Template:

```md
## Security Design

### Assets

- ...

### Actors

- ...

### Data Classification

- ...

### Trust Boundaries

- ...

### Authorization Model

- Subject: ...
- Action: ...
- Object: ...
- Context: ...
- State constraints: ...

### Main Threats and Controls

| Threat | Control | Verification |
| ------ | ------- | ------------ |
| ...    | ...     | ...          |

### Failure Behavior

- ...

### Audit and Monitoring

- ...

### Residual Assumptions

- ...
```

For low-risk work, the LLM SHOULD at least mention security assumptions if any exist.

---

## 12. Security Review Checklist

### 12.1 Asset and boundary

- [ ] Are protected assets named?
- [ ] Is data classified?
- [ ] Are actors identified?
- [ ] Are trust boundaries identified?
- [ ] Are entry points identified?
- [ ] Are data stores identified?

### 12.2 Access control

- [ ] Is authentication defined?
- [ ] Is function-level authorization defined?
- [ ] Is object-level authorization defined?
- [ ] Is tenant isolation defined?
- [ ] Is delegated access defined if applicable?
- [ ] Is break-glass access controlled?
- [ ] Are privileged actions audited?

### 12.3 Input/output

- [ ] Is all external input identified?
- [ ] Is validation allowlist-based where possible?
- [ ] Are dangerous sinks protected?
- [ ] Is output minimized?
- [ ] Is output encoded/sanitized correctly?
- [ ] Are file flows safe?
- [ ] Is SSRF considered for URL fetches?

### 12.4 State and workflow

- [ ] Are allowed state transitions defined?
- [ ] Are transition permissions defined?
- [ ] Are concurrency rules defined?
- [ ] Are replay/idempotency rules defined?
- [ ] Are partial failure rules defined?
- [ ] Are compensation rules defined if needed?

### 12.5 Resilience and abuse

- [ ] Are rate limits defined?
- [ ] Are resource limits defined?
- [ ] Are timeouts defined?
- [ ] Are retry budgets defined?
- [ ] Are circuit breakers needed?
- [ ] Are abuse cases considered?
- [ ] Are high-volume flows monitored?

### 12.6 Operations

- [ ] Are secrets managed safely?
- [ ] Are logs safe and useful?
- [ ] Are audit events defined?
- [ ] Are alerts defined?
- [ ] Are config defaults secure?
- [ ] Are dependencies controlled?
- [ ] Are deployment credentials least-privilege?

---

## 13. Acceptance Criteria

A design satisfies this standard only if:

- protected assets are named;
- data sensitivity is classified;
- actors and trust boundaries are identified;
- authentication assumptions are explicit;
- authorization model includes subject, action, object, context, and state where relevant;
- data flows are understood;
- major threats are identified;
- mitigations are mapped to threats;
- tests or verification evidence are defined;
- safe failure behavior is defined;
- audit and monitoring are defined for sensitive actions;
- secrets and dependencies are handled safely;
- residual risk is documented;
- no security design anti-pattern is introduced.

---

## 14. Enforcement Snippet for LLM Code Agents

Use this snippet in coding-agent instructions:

```md
Before implementing security-relevant code, produce or infer a security design.
Identify assets, actors, data classification, entry points, trust boundaries, data flows, authorization model, abuse cases, failure behavior, audit events, and residual assumptions.
Do not treat security as annotations, middleware, gateway config, or scanner output only.
Do not trust the frontend, client-supplied tenant/user IDs, internal network location, gateway headers, or hidden routes.
For protected actions, design authorization as: subject + action + object + context + state.
If a required security dependency fails, fail closed unless a documented risk decision says otherwise.
Never leave security-critical TODOs in production paths.
```

---

## 15. References

- OWASP Threat Modeling Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- OWASP Threat Modeling: https://owasp.org/www-community/Threat_Modeling
- OWASP Security Culture Threat Modeling: https://owasp.org/www-project-security-culture/v10/6-Threat_Modelling/
- OWASP Application Security Verification Standard: https://owasp.org/www-project-application-security-verification-standard/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- OWASP Top 10 Web Application Security Risks: https://owasp.org/www-project-top-ten/
- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- NIST SP 800-218 Secure Software Development Framework: https://csrc.nist.gov/pubs/sp/800/218/final
- NIST SP 800-160 Volume 1 Revision 1 Engineering Trustworthy Secure Systems: https://doi.org/10.6028/NIST.SP.800-160v1r1
- NIST SP 800-160 Volume 2 Revision 1 Developing Cyber-Resilient Systems: https://doi.org/10.6028/NIST.SP.800-160v2r1
- NIST SP 800-207 Zero Trust Architecture: https://doi.org/10.6028/NIST.SP.800-207
